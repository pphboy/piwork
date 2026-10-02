//go:build integration

package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"os"
	"path/filepath"
	"piwork/internal/contracts"
	"piwork/internal/workpackage"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/moby/moby/client"
	"piwork/internal/dockerengine"
)

func TestNativeServiceImageFailureRetryAndUnknownDocker(t *testing.T) {
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	if !strings.HasPrefix(host, "unix://") {
		t.Fatal("Unix Engine required")
	}
	directory, err := os.MkdirTemp("/tmp", "pw-dependency-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(directory) })
	listener, err := net.Listen("unix", filepath.Join(directory, "engine.sock"))
	if err != nil {
		t.Fatal(err)
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", strings.TrimPrefix(host, "unix://"))
	}}
	proxy := &httputil.ReverseProxy{Transport: transport, Rewrite: func(r *httputil.ProxyRequest) { r.Out.URL.Scheme = "http"; r.Out.URL.Host = "engine" }}
	var inaccessible atomic.Value
	inaccessible.Store("")
	var creates atomic.Int64
	var rejectAgentStart atomic.Bool
	engineHTTP := &http.Client{Transport: transport}
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/containers/create") {
			creates.Add(1)
		}
		if rejectAgentStart.Load() && r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/start") && strings.Contains(r.URL.Path, "/containers/") {
			req, _ := http.NewRequestWithContext(r.Context(), "GET", "http://engine"+strings.TrimSuffix(r.URL.Path, "/start")+"/json", nil)
			res, err := engineHTTP.Do(req)
			if err == nil {
				var view struct {
					Config struct{ Labels map[string]string }
				}
				err = json.NewDecoder(res.Body).Decode(&view)
				res.Body.Close()
				if err == nil && view.Config.Labels[dockerengine.KindLabel] == "agent" && rejectAgentStart.CompareAndSwap(true, false) {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(500)
					_, _ = w.Write([]byte(`{"message":"controlled compatible image entry failure"}`))
					return
				}
			}
		}
		blocked := inaccessible.Load().(string)
		if (r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/images/create") && strings.HasPrefix(r.URL.Query().Get("fromImage"), "invalid.example/")) || (blocked != "" && r.Method == "GET" && strings.HasSuffix(r.URL.Path, "/containers/"+blocked+"/json")) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(503)
			_, _ = w.Write([]byte(`{"message":"controlled Engine dependency failure"}`))
			return
		}
		proxy.ServeHTTP(w, r)
	})}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close(); transport.CloseIdleConnections() })
	t.Setenv("PIWORK_TEST_DOCKER_HOST", "unix://"+filepath.Join(directory, "engine.sock"))
	a, base, auth, work, ctx := nativeApplyFixture(t)
	reference := "invalid.example/" + a.Store.InstallationID() + ":repair"
	root := "/api/v1/works/" + work + "/services"
	definition := map[string]any{"name": "repair", "image": map[string]string{"reference": reference}, "command": "node", "args": []string{"-e", "require('http').createServer((q,r)=>r.end('ok')).listen(8099,'0.0.0.0')"}, "workingDirectory": "/", "restartPolicy": "never", "ports": []any{map[string]any{"name": "http", "protocol": "tcp", "containerPort": 8099}}, "readiness": map[string]any{"kind": "http", "portName": "http", "path": "/", "deadlineMs": 10000}}
	status, accepted := packageHTTPCall(t, base, root, "POST", auth, map[string]any{"definition": definition, "idempotencyKey": "fail-image"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	failed := waitApplyFailure(t, ctx, a, accepted["operationId"].(string))
	if failed.ErrorJSON == nil || !strings.Contains(*failed.ErrorJSON, "IMAGE_UNAVAILABLE") {
		t.Fatal("image failure reason missing", failed)
	}
	service := accepted["serviceId"].(string)
	record, err := a.Store.Service(ctx, work, service, false)
	if err != nil || record.ObservedState != "failed" {
		t.Fatal("image failure reported ready", record, err)
	}
	raw, err := client.NewClientWithOpts(client.WithHost(host), client.WithAPIVersionNegotiation())
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	if _, err := raw.ImageTag(ctx, client.ImageTagOptions{Source: a.options.Initialization.Runtime.AgentImage, Target: reference}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = raw.ImageRemove(context.Background(), reference, client.ImageRemoveOptions{}) })
	status, retry := packageHTTPCall(t, base, root+"/"+service+"/retry", "POST", auth, map[string]string{"idempotencyKey": "repaired-image"})
	if status != 202 {
		t.Fatal(status, retry)
	}
	waitWorkOperation(t, ctx, a, retry["operationId"].(string))
	var containerID string
	views, err := raw.ContainerList(ctx, client.ContainerListOptions{All: true})
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range views.Items {
		if v.Labels[dockerengine.InstallationLabel] == a.Store.InstallationID() && v.Labels[dockerengine.LogicalLabel] == service {
			containerID = v.ID
		}
	}
	// The public labels use the common logical resource ID, resolve it from binding.
	if containerID == "" {
		for _, v := range views.Items {
			if v.Labels[dockerengine.InstallationLabel] == a.Store.InstallationID() && v.Labels[dockerengine.KindLabel] == "service" {
				containerID = v.ID
			}
		}
	}
	if containerID == "" {
		t.Fatal("repaired container absent")
	}
	before := creates.Load()
	inaccessible.Store(containerID)
	for deadline := time.Now().Add(20 * time.Second); ; time.Sleep(100 * time.Millisecond) {
		status, view := packageHTTPCall(t, base, root+"/"+service, "GET", auth, nil)
		encoded := view["observedState"]
		if status == 200 && encoded == "unknown" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("Docker failure not observed unknown", status, view)
		}
	}
	if creates.Load() != before {
		t.Fatal("unknown inspection launched replacement")
	}
	inaccessible.Store("")
	original, err := raw.ContainerInspect(ctx, containerID, client.ContainerInspectOptions{})
	if err != nil || !original.Container.State.Running {
		t.Fatal("dependency fault replaced original", err)
	}
	// An accepted compatible-image entry can fail before the SDK creates a DB.
	state, err := a.Store.Configuration(ctx, work)
	if err != nil {
		t.Fatal(err)
	}
	var config contracts.WorkConfig
	if json.Unmarshal([]byte(state.DesiredConfigJSON), &config) != nil {
		t.Fatal("config")
	}
	rejectAgentStart.Store(true)
	status, initial := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]any{"name": "Never initialized", "configuration": config, "idempotencyKey": "initial-entry-failure"})
	if status != 202 {
		t.Fatal(status, initial)
	}
	waitApplyFailure(t, ctx, a, initial["operationId"].(string))
	never := initial["workId"].(string)
	neverRoot := "/api/v1/works/" + never
	neverState, err := a.Store.Configuration(ctx, never)
	if err != nil || neverState.ActiveContextID != nil || neverState.DesiredContextID == nil {
		t.Fatal("failed entry did not retain desired", neverState, err)
	}
	action := func(path, key string) map[string]any {
		t.Helper()
		code, result := packageHTTPCall(t, base, path, "POST", auth, map[string]string{"idempotencyKey": key})
		if code != 202 {
			t.Fatal(code, result)
		}
		waitWorkOperation(t, ctx, a, result["operationId"].(string))
		return result
	}
	action(neverRoot+"/stop", "stop-never-started")
	exported := action(neverRoot+"/exports", "export-empty-history")
	req, _ := http.NewRequestWithContext(ctx, "GET", base+"/api/v1/work-snapshots/"+exported["snapshotId"].(string)+"/content", nil)
	req.Header.Set("Authorization", auth)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(res.Body)
	res.Body.Close()
	if err != nil || res.StatusCode != 200 {
		t.Fatal(res.StatusCode, err)
	}
	verified, err := workpackage.Read(ctx, bytes.NewReader(data), workpackage.ReadOptions{})
	if err != nil {
		t.Fatal(err)
	}
	specJSON, _ := json.Marshal(verified.Spec)
	if !bytes.Contains(specJSON, []byte(`"activeContext":null`)) {
		t.Fatal("export invented active context")
	}
	var pack string
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT package_id FROM snapshot_jobs WHERE operation_id=?`, exported["operationId"]).Scan(&pack)
	}); err != nil {
		t.Fatal(err)
	}
	status, imported := packageHTTPCall(t, base, "/api/v1/work-imports", "POST", auth, map[string]string{"packageId": pack, "idempotencyKey": "import-empty-history"})
	if status != 202 {
		t.Fatal(status, imported)
	}
	waitWorkOperation(t, ctx, a, imported["operationId"].(string))
	importedWork := imported["workId"].(string)
	importedState, err := a.Store.Configuration(ctx, importedWork)
	if err != nil || importedState.ActiveContextID != nil {
		t.Fatal("import invented active", importedState, err)
	}
	action("/api/v1/works/"+importedWork+"/start", "start-empty-import")
	importedState, err = a.Store.Configuration(ctx, importedWork)
	if err != nil || importedState.ActiveContextID == nil {
		t.Fatal("explicit Start not activated", importedState, err)
	}
	t.Log("accepted image failure stays failed; explicit repair/retry succeeds; unavailable inspection reports unknown without container replacement")
}
