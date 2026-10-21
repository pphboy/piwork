//go:build integration

package coreapp

import (
	"context"
	"encoding/json"
	"github.com/moby/moby/client"
	"io"
	"os"
	"path/filepath"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"strings"
	"testing"
)

func TestNativeLogExportRollbackRedactsActualPriorContext(t *testing.T) {
	a, base, auth, id, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + id
	prior, err := a.Store.Configuration(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	_, view := packageHTTPCall(t, base, path+"/configuration", "GET", auth, nil)
	config := view["desired"].(map[string]any)
	if _, err := a.Settings.ConfigureRuntime(RuntimeInput{AgentImage: a.options.Initialization.Runtime.AgentImage, Provider: "piwork-deterministic", Model: "fixture-v2", Credential: "round2-candidate-key"}); err != nil {
		t.Fatal(err)
	}
	profile, _, err := a.Settings.LoadRuntime()
	if err != nil {
		t.Fatal(err)
	}
	if err := a.ensureRuntimeCatalog(ctx, profile); err != nil {
		t.Fatal(err)
	}
	config["modelRef"] = string(runtimeModelCatalogID(profile.Revision))

	config["mcpServers"] = []any{map[string]any{"serverId": "unavailable", "transport": "stdio", "required": true, "command": "/no-such-piwork-mcp", "args": []string{}, "timeoutMs": 1000}}
	status, saved := packageHTTPCall(t, base, path+"/configuration", "PUT", auth, map[string]any{"configuration": config})
	if status != 200 || saved["pendingApply"] != true {
		t.Fatal("invalid-runtime candidate did not save", status, saved)
	}
	status, accepted := packageHTTPCall(t, base, path+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": "failed-mcp-apply"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	operation := waitApplyFailure(t, ctx, a, accepted["operationId"].(string))
	if operation.ErrorJSON == nil || operation.ResultJSON == nil {
		t.Fatal("primary or rollback diagnostics lost", operation)
	}
	projection := operationEnvelopeView(operation).(map[string]any)
	encoded, err := json.Marshal(projection)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := contracts.Decode[contracts.PublicOperation](strings.NewReader(string(encoded)), "PublicOperationSchema", 64<<10); err != nil {
		t.Fatal("failed Apply public contract", err, string(encoded))
	}
	if projection["diagnostics"].(map[string]any)["rollback"].(map[string]any)["state"] != "succeeded" {
		t.Fatal("rollback was not confirmed", projection)
	}
	if projection["error"].(map[string]any)["code"] != "MCP_INITIALIZATION_FAILED" || projection["diagnostics"].(map[string]any)["diagnosticCollection"].(map[string]any)["state"] != "available" {
		t.Fatal("recognized MCP cause or collection lost", projection)
	}
	after, err := a.Store.Configuration(ctx, id)
	if err != nil || after.ActiveContextID == nil || *after.ActiveContextID != *prior.ActiveContextID || !after.PendingApply {
		t.Fatal("failed candidate replaced prior active", after, err)
	}
	work, err := a.Store.Work(ctx, id, false)
	if err != nil || work.ObservedState != "ready" {
		t.Fatal("prior runtime did not recover", work, err)
	}
	status, sessions := packageHTTPCall(t, base, path+"/sessions", "GET", auth, nil)
	if status != 200 {
		t.Fatal("prior conversation route not restored", status, sessions)
	}

	sources, err := a.Store.LogSources(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var latest *corestore.LogSource
	for i := range sources {
		source := &sources[i]
		if source.WorkID == id && source.Kind == "agent" && source.State == "bound" && (latest == nil || source.Generation > latest.Generation) {
			latest = source
		}
	}
	if latest == nil || work.ActiveRevision == nil {
		t.Fatal("rollback did not retain an active Agent source")
	}

	if latest.ConfigRevision != *work.ActiveRevision || latest.ConfigRevision == work.DesiredRevision {
		t.Fatal("rollback source is not bound to actual configuration")
	}
	// Emit into the actual Agent main process output via Engine exec, then use
	// normal Work removal. No model call or fake log reader is involved.
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	engine, err := client.NewClientWithOpts(client.WithHost(host), client.WithAPIVersionNegotiation())
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	emit, err := engine.ExecCreate(ctx, latest.ContainerID, client.ExecCreateOptions{Cmd: []string{"node", "-e", `require('node:fs').writeFileSync('/proc/1/fd/1','ROLLBACK-LOG-MARKER acceptance-only\n')`}, AttachStdout: true, AttachStderr: true})
	if err != nil {
		t.Fatal(err)
	}
	stream, err := engine.ExecAttach(ctx, emit.ID, client.ExecAttachOptions{})
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, stream.Reader)
	stream.Close()
	status, deleted := packageHTTPCall(t, base, path+"/delete", "POST", auth, map[string]string{"idempotencyKey": "remove-rollback-agent"})
	if status != 202 {
		t.Fatal(status, deleted)
	}
	waitWorkOperation(t, ctx, a, deleted["operationId"].(string))
	stored, found, err := a.Store.LogSource(ctx, latest.SourceID)
	if err != nil || !found || stored.State != "archived" {
		t.Fatal("rollback source not archived before removal", stored, err)
	}
	if _, err := engine.ContainerInspect(context.Background(), latest.ContainerID, client.ContainerInspectOptions{}); err == nil {
		t.Fatal("fixture container was not removed")
	}
	raw, err := os.ReadFile(filepath.Join(a.options.DataDirectory, "logs", "works", id, latest.SourceID, "stdout.log"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "ROLLBACK-LOG-MARKER") || strings.Contains(string(raw), "acceptance-only") || !strings.Contains(string(raw), "[redacted]") {
		t.Fatal("actual rollback output was missing or not redacted")
	}
	exportID := createLogExportHTTP(t, base, auth, "rollback-archived-export")
	exported := waitLogExportHTTP(t, base, auth, exportID)
	_, entries := downloadLogExportHTTP(t, base, auth, exportID, exported)
	body := string(entries["works/"+id+"/"+latest.SourceID+"/stdout.log"])
	if !strings.Contains(body, "ROLLBACK-LOG-MARKER") || strings.Contains(body, "acceptance-only") {
		t.Fatal("ZIP did not preserve safe rollback archive")
	}
	t.Log("actual rollback configuration, Engine stdout, archive-before-removal and ZIP redaction verified")
}
