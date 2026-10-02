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
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/pipackage"
	"piwork/internal/testsupport"
)

func TestCorePackageHTTPPublishesAndReplaysFrozenContent(t *testing.T) {
	image := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE")
	if image == "" {
		t.Fatal("set PIWORK_TEST_NATIVE_AGENT_IMAGE to native acceptance image")
	}
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	raw, err := client.NewClientWithOpts(client.WithHost(host), client.WithAPIVersionNegotiation())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { raw.Close() })
	scope, err := testsupport.NewScope()
	if err != nil {
		t.Fatal(err)
	}
	t.Log("Core package installation:", scope.ID())
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := scope.Cleanup(ctx, raw); err != nil {
			t.Error(err)
		}
	})
	directory := t.TempDir()
	store, err := corestore.Open(context.Background(), corestore.Options{Directory: directory, InstallationID: scope.ID()})
	if err != nil {
		t.Fatal(err)
	}
	store.Close()
	options := Options{DataDirectory: directory, PackageHelperImage: image, DockerOptions: dockerengine.SelectionOptions{DockerHost: host, DockerConfig: t.TempDir()}, Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}, Runtime: &RuntimeInput{AgentImage: image, Provider: testsupport.DeterministicProvider, Model: testsupport.DeterministicModel, Credential: "acceptance-only"}}}
	a, base, operator := appFixture(t, options)
	if !a.Status().Ready {
		t.Fatal(a.Status())
	}
	login, err := a.Identity.Login(context.Background(), "admin", "development-fixture-pass", "test")
	if err != nil {
		t.Fatal(err)
	}
	auth := "Bearer " + login.Token
	t.Setenv("PATH", filepath.Join(t.TempDir(), "no-host-tools"))
	_, file, _, _ := runtime.Caller(0)
	repository := filepath.Join(filepath.Dir(file), "..", "..")
	fixtureZip := func(version string) []byte {
		t.Helper()
		tree, err := pipackage.OpenTree(context.Background(), filepath.Join(repository, "fixtures/pi-packages/tools-"+version))
		if err != nil {
			t.Fatal(err)
		}
		defer tree.Close()
		path := filepath.Join(t.TempDir(), "tools.zip")
		if _, err := pipackage.PackArchive(context.Background(), tree, path); err != nil {
			t.Fatal(err)
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	upload := func(data []byte) string {
		t.Helper()
		sum := sha256.Sum256(data)
		req, err := http.NewRequest(http.MethodPost, base+"/api/v1/admin/package-uploads", bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", auth)
		req.Header.Set("Content-Type", "application/zip")
		req.Header.Set("X-Piwork-Sha256", hex.EncodeToString(sum[:]))
		req.Header.Set("X-Piwork-Package-Source", "zip")
		req.Header.Set("X-Piwork-Package-Name", "tools.zip")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var body map[string]any
		if json.NewDecoder(res.Body).Decode(&body) != nil || res.StatusCode != 201 {
			t.Fatal("upload failed", res.StatusCode, body)
		}
		return body["uploadId"].(string)
	}
	install := func(path, upload, key string, add bool) (int, map[string]any) {
		t.Helper()
		body := map[string]any{"source": map[string]string{"kind": "upload", "uploadId": upload}, "idempotencyKey": key}
		if !strings.HasSuffix(path, "/update") {
			body["addToDefaults"] = add
		}
		return packageHTTPCall(t, base, path, "POST", auth, body)
	}
	wait := func(id string, state, code string) map[string]any {
		t.Helper()
		deadline := time.Now().Add(60 * time.Second)
		for {
			status, body := packageHTTPCall(t, base, "/api/v1/admin/operations/"+id, "GET", auth, nil)
			if status != 200 {
				t.Fatal(status, body)
			}
			serialized, _ := json.Marshal(body)
			for _, secret := range []string{"/package/", "/workspace/", "input.zip", "npm install", "helperId", "sha256:", "acceptance-only"} {
				if bytes.Contains(serialized, []byte(secret)) {
					t.Fatal("operation leaked internal data", string(serialized))
				}
			}
			if body["state"] == "succeeded" || body["state"] == "failed" {
				if body["state"] != state || body["packagePhase"] != state {
					t.Fatal(body)
				}
				if code != "" && body["error"].(map[string]any)["code"] != code {
					t.Fatal(body)
				}
				return body
			}
			if time.Now().After(deadline) {
				t.Fatal("package not settled", body)
			}
			time.Sleep(100 * time.Millisecond)
		}
	}
	v1 := fixtureZip("v1")
	firstUpload := upload(v1)
	status, accepted := install("/api/v1/admin/packages", firstUpload, "install-v1", true)
	if status != 202 {
		t.Fatal(status, accepted)
	}
	id := accepted["operationId"].(string)
	result := wait(id, "succeeded", "")
	if result["result"].(map[string]any)["name"] != "@piwork/fixture-tools" {
		t.Fatal(result)
	}
	name := url.PathEscape("@piwork/fixture-tools")
	if status, body := packageHTTPCall(t, base, "/control/packages/"+name, "GET", "Operator "+operator, nil); status != 200 || body["version"] != "1.0.0" || body["isDefault"] != true {
		t.Fatal(status, body)
	}
	labels, _ := scope.Labels()
	containerFixture, err := raw.ContainerCreate(context.Background(), client.ContainerCreateOptions{Name: scope.ID() + "-incompatible-image", Config: &container.Config{Image: image, Labels: labels}, HostConfig: &container.HostConfig{NetworkMode: "none"}})
	if err != nil {
		t.Fatal(err)
	}
	badImage, err := raw.ContainerCommit(context.Background(), containerFixture.ID, client.ContainerCommitOptions{Changes: []string{"LABEL io.piwork.package-helper.contract=1"}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if _, err := raw.ImageRemove(ctx, badImage.ID, client.ImageRemoveOptions{}); err != nil {
			t.Error(err)
		}
	})
	var beforeRejected int
	if err := a.Store.Read(context.Background(), func(tx *sql.Tx) error { return tx.QueryRow(`SELECT count(*) FROM operations`).Scan(&beforeRejected) }); err != nil {
		t.Fatal(err)
	}
	a.options.PackageHelperImage = badImage.ID
	if status, body := install("/api/v1/admin/packages", firstUpload, "incompatible-helper", false); status != 409 || body["code"] != "PI_PACKAGE_HELPER_INCOMPATIBLE" {
		t.Fatal("non-native helper image was accepted", status, body)
	}
	if status, body := install("/api/v1/admin/packages", firstUpload, "install-v1", true); status != 202 || body["operationId"] != id || body["reused"] != true {
		t.Fatal("accepted replay rechecked helper capability", status, body)
	}
	a.options.PackageHelperImage = image
	var afterRejected int
	if err := a.Store.Read(context.Background(), func(tx *sql.Tx) error { return tx.QueryRow(`SELECT count(*) FROM operations`).Scan(&afterRejected) }); err != nil || beforeRejected != afterRejected {
		t.Fatal("rejected image created an Operation", beforeRejected, afterRejected, err)
	}
	defaults, err := a.Store.DefaultWork(context.Background())
	if err != nil || defaults.Configuration == nil {
		t.Fatal(defaults, err)
	}
	workConfig := *defaults.Configuration
	// The full Service backend belongs to stage 7. This package gate runs the
	// real SDK with no configured MCP server and does not emulate that backend.
	workConfig.McpServers = []contracts.McpServer{}
	status, created := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]any{"name": "独立包 Work", "idempotencyKey": "create-package-work", "configuration": workConfig})
	if status != 202 {
		t.Fatal("Work did not capture default package", status, created)
	}
	workID := created["workId"].(string)
	waitWorkOperation := func(id, state string) {
		t.Helper()
		deadline := time.Now().Add(90 * time.Second)
		for {
			status, body := packageHTTPCall(t, base, "/api/v1/operations/"+id, "GET", auth, nil)
			if status != 200 {
				t.Fatal(status, body)
			}
			if body["state"] == "succeeded" || body["state"] == "failed" || body["state"] == "superseded" {
				if body["state"] != state {
					t.Fatal(body)
				}
				return
			}
			if time.Now().After(deadline) {
				t.Fatal("Work Operation not settled", body)
			}
			time.Sleep(100 * time.Millisecond)
		}
	}
	waitWorkOperation(created["operationId"].(string), "succeeded")
	workPackagePath := "/api/v1/works/" + workID + "/packages/" + name
	if status, entry := packageHTTPCall(t, base, workPackagePath, "GET", auth, nil); status != 200 || entry["active"].(map[string]any)["version"] != "1.0.0" || entry["runtime"].(map[string]any)["loaded"] != true || entry["pendingApply"] != false {
		t.Fatal("Go-prepared artifact was not loaded by actual TS SDK", status, entry)
	}
	if status, body := install("/api/v1/works/"+workID+"/packages", firstUpload, "cross-scope", false); status != 400 {
		t.Fatal("Work accepted addToDefaults field", status, body)
	}
	if status, body := packageHTTPCall(t, base, "/api/v1/works/"+workID+"/packages", "POST", auth, map[string]any{"source": map[string]string{"kind": "upload", "uploadId": firstUpload}, "idempotencyKey": "cross-scope"}); status != 404 || body["code"] != "PI_PACKAGE_NOT_FOUND" {
		t.Fatal("Core upload escaped its scope", status, body)
	}
	if status, entry := packageHTTPCall(t, base, workPackagePath+"/disable", "POST", auth, nil); status != 200 || entry["desired"].(map[string]any)["enabled"] != false || entry["active"].(map[string]any)["enabled"] != true || entry["runtime"].(map[string]any)["loaded"] != true {
		t.Fatal("disable changed loaded context", status, entry)
	}
	stateBeforeNoOp, err := a.Store.Configuration(context.Background(), workID)
	if err != nil {
		t.Fatal(err)
	}
	if status, _ := packageHTTPCall(t, base, workPackagePath+"/disable", "POST", auth, nil); status != 200 {
		t.Fatal(status)
	}
	stateAfterNoOp, err := a.Store.Configuration(context.Background(), workID)
	if err != nil || stateBeforeNoOp.DesiredRevision != stateAfterNoOp.DesiredRevision {
		t.Fatal("idempotent disable allocated revision", err)
	}
	// Accepted replay happens before runtime availability or image inspection.
	a.setState("RUNTIME_UNAVAILABLE", true, true, false)
	if status, body := install("/api/v1/admin/packages", firstUpload, "install-v1", true); status != 202 || body["operationId"] != id || body["reused"] != true {
		t.Fatal("accepted replay depended on runtime", status, body)
	}
	a.setState("READY", true, true, true)
	secondUpload := upload(v1)
	if status, body := install("/api/v1/admin/packages", secondUpload, "install-v1", true); status != 202 || body["operationId"] != id || body["reused"] != true {
		t.Fatal("identical bytes were not replayed", status, body)
	}
	if status, body := install("/api/v1/admin/packages", secondUpload, "install-v1", false); status != 409 || body["code"] != "IDEMPOTENCY_CONFLICT" {
		t.Fatal(status, body)
	}
	status, duplicate := install("/api/v1/admin/packages", secondUpload, "duplicate-v1", false)
	if status != 202 {
		t.Fatal(status, duplicate)
	}
	wait(duplicate["operationId"].(string), "failed", "PI_PACKAGE_ALREADY_INSTALLED")
	// Default protection applies to both role surfaces.
	if status, body := packageHTTPCall(t, base, "/api/v1/admin/packages/"+name+"/disable", "POST", auth, nil); status != 409 || body["code"] != "PI_PACKAGE_IN_DEFAULTS" {
		t.Fatal(status, body)
	}
	if _, err := a.Store.UpdateDefaultWork(context.Background(), func(_ *sql.Tx, current corestore.DefaultWorkConfiguration) (contracts.WorkConfig, error) {
		config := *current.Configuration
		config.Packages = contracts.PiPackageSelection{}
		return config, nil
	}); err != nil {
		t.Fatal(err)
	}
	if status, body := packageHTTPCall(t, base, "/control/packages/"+name+"/disable", "POST", "Operator "+operator, nil); status != 200 || body["enabled"] != false {
		t.Fatal(status, body)
	}
	v2upload := upload(fixtureZip("v2"))
	status, update := install("/api/v1/admin/packages/"+name+"/update", v2upload, "update-v2", false)
	if status != 202 {
		t.Fatal(status, update)
	}
	wait(update["operationId"].(string), "succeeded", "")
	if status, body := packageHTTPCall(t, base, "/control/packages/"+name, "GET", "Operator "+operator, nil); status != 200 || body["version"] != "2.0.0" || body["enabled"] != false || body["isDefault"] != false {
		t.Fatal("update changed selection", status, body)
	}
	// from-core only accepts enabled heads, and captures the chosen artifact
	// in its acceptance transaction. It never follows catalog edits afterward.
	fromCore := map[string]any{"source": map[string]string{"kind": "core", "name": "@piwork/fixture-tools"}, "idempotencyKey": "work-from-core-v2"}
	if status, body := packageHTTPCall(t, base, workPackagePath+"/update", "POST", auth, fromCore); status != 404 || body["code"] != "PI_PACKAGE_NOT_FOUND" {
		t.Fatal("disabled Core head could be captured", status, body)
	}
	if status, _ := packageHTTPCall(t, base, "/control/packages/"+name+"/enable", "POST", "Operator "+operator, nil); status != 200 {
		t.Fatal(status)
	}
	status, workUpdate := packageHTTPCall(t, base, workPackagePath+"/update", "POST", auth, fromCore)
	if status != 202 {
		t.Fatal(status, workUpdate)
	}
	workUpdateID := workUpdate["operationId"].(string)
	waitWorkOperation(workUpdateID, "succeeded")
	if status, entry := packageHTTPCall(t, base, workPackagePath, "GET", auth, nil); status != 200 || entry["desired"].(map[string]any)["version"] != "2.0.0" || entry["desired"].(map[string]any)["enabled"] != false || entry["active"].(map[string]any)["version"] != "1.0.0" || entry["runtime"].(map[string]any)["loaded"] != true || entry["pendingApply"] != true {
		t.Fatal("Work update modified active or enabled", status, entry)
	}
	if status, body := packageHTTPCall(t, base, "/api/v1/admin/operations/"+workUpdateID, "GET", auth, nil); status != 404 {
		t.Fatal("admin Core Operation endpoint exposed a Work job", status, body)
	}
	if status, body := packageHTTPCall(t, base, workPackagePath+"/update", "POST", auth, fromCore); status != 202 || body["operationId"] != workUpdateID || body["reused"] != true {
		t.Fatal("Work accepted replay not retained", status, body)
	}
	if status, _ := packageHTTPCall(t, base, "/control/packages/"+name, "DELETE", "Operator "+operator, nil); status != 204 {
		t.Fatal(status)
	}
	if status, entry := packageHTTPCall(t, base, workPackagePath, "GET", auth, nil); status != 200 || entry["desired"].(map[string]any)["version"] != "2.0.0" {
		t.Fatal("Core removal changed Work-owned content", status, entry)
	}
	if status, _ := packageHTTPCall(t, base, workPackagePath, "DELETE", auth, nil); status != 200 {
		t.Fatal(status)
	}
	if status, entry := packageHTTPCall(t, base, workPackagePath, "GET", auth, nil); status != 200 || entry["desired"] != nil || entry["active"].(map[string]any)["version"] != "1.0.0" || entry["pendingApply"] != true {
		t.Fatal("remove hid active/history package", status, entry)
	}
	if status, body := packageHTTPCall(t, base, "/api/v1/works/"+workID+"/configuration/packages", "PUT", auth, map[string]any{"packages": []map[string]any{{"name": "@piwork/fixture-tools", "enabled": true}}}); status != 400 || body["code"] != "PI_PACKAGE_NOT_INSTALLED" {
		t.Fatal("Save reselected removed package without install", status, body)
	}
	// Real npm lifecycle failure stays classified and does not publish a head.
	bad := upload(packageZip(t, map[string]string{"package.json": `{"name":"bad-dependencies","scripts":{"postinstall":"node -e \"process.exit(1)\""}}`}))
	status, failed := install("/api/v1/admin/packages", bad, "dependency-failure", true)
	if status != 202 {
		t.Fatal(status, failed)
	}
	wait(failed["operationId"].(string), "failed", "PI_PACKAGE_DEPENDENCY_INSTALL_FAILED")
	postFailureDefaults, err := a.Store.DefaultWork(context.Background())
	if err != nil || len(postFailureDefaults.Configuration.Packages) != 0 {
		t.Fatal("failed install changed default selection", postFailureDefaults, err)
	}
	var leases, bindings int
	if err := a.Store.Read(context.Background(), func(tx *sql.Tx) error {
		if err := tx.QueryRow(`SELECT sum(lease_count) FROM pi_package_uploads`).Scan(&leases); err != nil {
			return err
		}
		return tx.QueryRow(`SELECT count(*) FROM resource_bindings WHERE resource_kind LIKE 'package-%'`).Scan(&bindings)
	}); err != nil || leases != 0 || bindings != 0 {
		t.Fatal("job resources or leases remain", leases, bindings, err)
	}
	closing, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	if err := a.Close(closing); err != nil {
		t.Fatal(err)
	}
	cancel()
	a, base, _ = appFixture(t, options)
	if !a.Status().Ready {
		t.Fatal("terminal package records blocked restart", a.Status(), a.RefreshRuntime(context.Background()))
	}
	if status, body := packageHTTPCall(t, base, "/api/v1/admin/operations/"+id, "GET", auth, nil); status != 200 || body["state"] != "succeeded" {
		t.Fatal("accepted operation did not survive restart", status, body)
	}
	if status, body := install("/api/v1/admin/packages", secondUpload, "install-v1", true); status != 202 || body["operationId"] != id || body["reused"] != true {
		t.Fatal("replay lost after restart", status, body)
	}
}

func packageHTTPCall(t *testing.T, base, path, method, authorization string, body any) (int, map[string]any) {
	t.Helper()
	var data []byte
	if body != nil {
		data, _ = json.Marshal(body)
	}
	request, err := http.NewRequest(method, base+path, bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", authorization)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := (&http.Client{Timeout: 2 * time.Minute}).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var result map[string]any
	if response.StatusCode != 204 {
		if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
			t.Fatal(err)
		}
	}
	return response.StatusCode, result
}
