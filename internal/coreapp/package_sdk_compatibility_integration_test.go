//go:build integration

package coreapp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/dockerengine"
)

func uploadNativePackageFixture(t *testing.T, base, auth string, files map[string]string) string {
	t.Helper()
	data := packageZip(t, files)
	sum := sha256.Sum256(data)
	request, err := http.NewRequest("POST", base+"/api/v1/admin/package-uploads", bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", auth)
	request.Header.Set("Content-Type", "application/zip")
	request.Header.Set("X-Piwork-Sha256", hex.EncodeToString(sum[:]))
	request.Header.Set("X-Piwork-Package-Source", "zip")
	request.Header.Set("X-Piwork-Package-Name", "sdk-proof.zip")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var body map[string]any
	if json.NewDecoder(response.Body).Decode(&body) != nil || response.StatusCode != 201 {
		t.Fatal("fixture upload", response.StatusCode, body)
	}
	return body["uploadId"].(string)
}

func TestNativeOldSDKRejectsPublishedPeerAndUpgradePreservesFrozenWork(t *testing.T) {
	current := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE")
	old := os.Getenv("PIWORK_TEST_NATIVE_OLD_SDK_IMAGE")
	if current == "" || old == "" {
		t.Fatal("current and actual Pi 0.86.0 Agent images are required")
	}
	t.Setenv("PIWORK_TEST_NATIVE_AGENT_IMAGE", old)
	a, base, auth, work, _ := nativeApplyFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
	defer cancel()
	image, err := a.engine.InspectImage(ctx, old)
	if err != nil {
		t.Fatal(err)
	}
	caps, err := a.inspector.InspectNativeAgent(ctx, image.ID)
	if err != nil || caps.Environment == nil || caps.Environment.PiSdkVersion != "0.86.0" {
		t.Fatal("fixture did not contain actual old SDK", caps.Environment, err)
	}
	// The genuine fixed published package requires >=0.86.1. This request
	// contacts the registry and fails the selected 0.86.0 image peer check.
	status, accepted := packageHTTPCall(t, base, "/api/v1/admin/packages", "POST", auth, map[string]any{"source": map[string]string{"kind": "npm", "spec": "pi-subagents@0.71.0"}, "idempotencyKey": "old-published-peer"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	op := waitApplyFailure(t, ctx, a, accepted["operationId"].(string))
	var diagnostic map[string]any
	if op.ErrorJSON == nil || json.Unmarshal([]byte(*op.ErrorJSON), &diagnostic) != nil || diagnostic["code"] != "PI_PACKAGE_SDK_VERSION_UNSUPPORTED" {
		t.Fatal("old SDK failure classification", diagnostic)
	}
	if status, _ := packageHTTPCall(t, base, "/api/v1/admin/packages/pi-subagents", "GET", auth, nil); status != 404 {
		t.Fatal("incompatible package was published", status)
	}
	upload := uploadNativePackageFixture(t, base, auth, map[string]string{
		"package.json":      `{"name":"frozen-old-sdk","version":"1.0.0","peerDependencies":{"@earendil-works/pi-coding-agent":"0.86.0"},"pi":{"prompts":["prompts"]}}`,
		"prompts/frozen.md": "---\ndescription: Frozen compatibility proof\n---\nDo not change these original bytes.\n",
	})
	status, accepted = packageHTTPCall(t, base, "/api/v1/admin/packages", "POST", auth, map[string]any{"source": map[string]string{"kind": "upload", "uploadId": upload}, "idempotencyKey": "old-frozen"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	waitWorkOperation(t, ctx, a, accepted["operationId"].(string))
	status, frozen := packageHTTPCall(t, base, "/api/v1/admin/packages/frozen-old-sdk", "GET", auth, nil)
	if status != 200 || frozen["version"] != "1.0.0" || frozen["preparedEnvironment"] != nil {
		t.Fatal("artifact environment not frozen", status, frozen)
	}
	var metadataJSON string
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT a.metadata_json FROM pi_package_catalog c JOIN pi_package_artifacts a ON a.id=c.head_artifact_id WHERE c.name='frozen-old-sdk'`).Scan(&metadataJSON)
	}); err != nil {
		t.Fatal(err)
	}
	var metadata contracts.PiPackageArtifactMetadata
	if json.Unmarshal([]byte(metadataJSON), &metadata) != nil || metadata.PreparedEnvironment.PiSdkVersion != "0.86.0" {
		t.Fatal("internal frozen environment did not retain old SDK", metadata.PreparedEnvironment)
	}
	path := "/api/v1/works/" + work
	status, accepted = packageHTTPCall(t, base, path+"/packages", "POST", auth, map[string]any{"source": map[string]string{"kind": "core", "name": "frozen-old-sdk"}, "idempotencyKey": "work-old-frozen"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	waitWorkOperation(t, ctx, a, accepted["operationId"].(string))
	status, applied := packageHTTPCall(t, base, path+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": "old-sdk-apply"})
	if status != 202 {
		t.Fatal(status, applied)
	}
	waitWorkOperation(t, ctx, a, applied["operationId"].(string))
	_, before := packageHTTPCall(t, base, path+"/packages/frozen-old-sdk", "GET", auth, nil)
	if before["runtime"].(map[string]any)["loaded"] != true {
		t.Fatal("actual old SDK did not load frozen package", before)
	}
	// Changing installation defaults does not rewrite any existing Work's
	// image/context/package capture. Stop/start must still use the old SDK.
	runtime := *a.options.Initialization.Runtime
	runtime.AgentImage = current
	if _, err := a.Settings.ConfigureRuntime(runtime); err != nil {
		t.Fatal(err)
	}
	if err := a.RefreshRuntime(ctx); err != nil {
		t.Fatal(err)
	}
	for _, action := range []string{"stop", "start"} {
		status, accepted = packageHTTPCall(t, base, path+"/"+action, "POST", auth, map[string]string{"idempotencyKey": "upgrade-" + action})
		if status != 202 {
			t.Fatal(status, accepted)
		}
		waitWorkOperation(t, ctx, a, accepted["operationId"].(string))
	}
	agent, err := a.dockerRuntime.InspectContainer(ctx, dockerengine.ContainerIdentity{WorkID: work, Kind: "agent", LogicalID: "agentd"})
	if err != nil || agent == nil || agent.Image != image.ID {
		t.Fatal("installation upgrade changed existing Work image", err)
	}
	_, after := packageHTTPCall(t, base, path+"/packages/frozen-old-sdk", "GET", auth, nil)
	left, _ := json.Marshal(before["active"])
	right, _ := json.Marshal(after["active"])
	if !bytes.Equal(left, right) || after["runtime"].(map[string]any)["loaded"] != true {
		t.Fatal("installation upgrade changed frozen artifact or SDK load", after)
	}
	defaults, err := a.Store.DefaultWork(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, configuration := packageHTTPCall(t, base, path+"/configuration", "GET", auth, nil)
	desired := configuration["desired"].(map[string]any)
	desired["agentImage"] = defaults.Configuration.AgentImage
	status, incompatible := packageHTTPCall(t, base, path+"/configuration", "PUT", auth, map[string]any{"configuration": desired})
	if status != 409 || incompatible["code"] != "PI_PACKAGE_ENVIRONMENT_MISMATCH" {
		t.Fatal("old artifact moved to incompatible SDK", status, incompatible)
	}
	t.Log("actual Pi 0.86.0 peer failure and frozen Work retention after 0.86.1 defaults", image.ID, work)
}

func TestNativeUnavailableRegistryFailsWithoutPublishing(t *testing.T) {
	image := os.Getenv("PIWORK_TEST_NATIVE_UNAVAILABLE_REGISTRY_IMAGE")
	if image == "" {
		t.Fatal("unreachable-registry native Agent image is required")
	}
	t.Setenv("PIWORK_TEST_NATIVE_AGENT_IMAGE", image)
	a, base, auth, _, ctx := nativeApplyFixture(t)
	status, accepted := packageHTTPCall(t, base, "/api/v1/admin/packages", "POST", auth, map[string]any{"source": map[string]string{"kind": "npm", "spec": "pi-subagents@0.71.0"}, "idempotencyKey": "unavailable-registry"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	failed := waitApplyFailure(t, ctx, a, accepted["operationId"].(string))
	var diagnostic map[string]any
	if failed.ErrorJSON == nil || json.Unmarshal([]byte(*failed.ErrorJSON), &diagnostic) != nil || diagnostic["code"] != "PI_PACKAGE_SOURCE_FETCH_FAILED" {
		t.Fatal("registry failure was skipped or misreported", diagnostic)
	}
	for _, unsafe := range []string{"ECONNREFUSED", "npm ERR", "/package/", "127.0.0.1:9", "acceptance-only"} {
		if strings.Contains(*failed.ErrorJSON, unsafe) {
			t.Fatal("registry failure leaked process output", unsafe)
		}
	}
	if status, _ := packageHTTPCall(t, base, "/api/v1/admin/packages/pi-subagents", "GET", auth, nil); status != 404 {
		t.Fatal("unavailable registry published package", status)
	}
	t.Log("real npm registry connection failure retained as failed Operation", failed.ID)
}
