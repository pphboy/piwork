//go:build integration

package coreapp

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httputil"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/dockerengine"
)

func TestNativeInvalidServiceExecutableDiagnosticSurvivesRemovalAndRestart(t *testing.T) {
	a, base, auth, work, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + work
	definition := map[string]any{"name": "invalid-program", "image": map[string]string{"reference": a.options.Initialization.Runtime.AgentImage}, "command": "/missing-application-executable", "args": []string{}, "workingDirectory": "/"}
	status, accepted := packageHTTPCall(t, base, path+"/services", "POST", auth, map[string]any{"definition": definition, "idempotencyKey": "invalid-program"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	operation, service := accepted["operationId"].(string), accepted["serviceId"].(string)
	waitApplyFailure(t, ctx, a, operation)
	status, before := packageHTTPCall(t, base, "/api/v1/operations/"+operation, "GET", auth, nil)
	if status != 200 || contracts.Validate("PublicOperationSchema", before) != nil {
		t.Fatal("invalid service public diagnostic", status, before)
	}
	diagnostic, _ := before["error"].(map[string]any)
	if diagnostic["code"] != "SERVICE_EXITED" && diagnostic["code"] != "SERVICE_START_FAILED" {
		t.Fatal("missing executable misclassified", diagnostic)
	}
	for _, raw := range []string{"/missing-application-executable", "OCI runtime", "runc create failed", a.options.DataDirectory} {
		encoded, _ := json.Marshal(before)
		if strings.Contains(string(encoded), raw) {
			t.Fatal("unsafe Docker diagnostic exposed", raw)
		}
	}
	// Explicit Stop disables recovery without erasing the failed Operation.
	status, stopped := packageHTTPCall(t, base, path+"/services/"+service+"/stop", "POST", auth, map[string]string{"idempotencyKey": "disable-invalid"})
	if status != 202 {
		t.Fatal(status, stopped)
	}
	waitWorkOperation(t, ctx, a, stopped["operationId"].(string))
	if err := a.dockerRuntime.RemoveContainer(ctx, dockerengine.ContainerIdentity{WorkID: work, Kind: "service", LogicalID: service}); err != nil {
		t.Fatal(err)
	}
	opts := a.options
	opts.Initialization = Initialization{}
	shutdown, cancel := context.WithTimeout(ctx, 45*time.Second)
	if err := a.Close(shutdown); err != nil {
		cancel()
		t.Fatal(err)
	}
	cancel()
	next, nextBase, _ := appFixture(t, opts)
	status, after := packageHTTPCall(t, nextBase, "/api/v1/operations/"+operation, "GET", auth, nil)
	left, _ := json.Marshal(before)
	right, _ := json.Marshal(after)
	if status != 200 || string(left) != string(right) {
		t.Fatal("service diagnostic lost after removal/restart", status, after)
	}
	if actual, _, err := next.inspectServiceRuntime(ctx, work, service); err != nil || actual != nil {
		t.Fatal("disabled invalid service restored", err)
	}
	t.Log("safe missing-executable diagnostic retained after exact container removal and Core restart", operation, service)
}

func TestNativeServiceDiagnosticsPreserveReadinessWhenLogCollectionFails(t *testing.T) {
	upstream := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if upstream == "" {
		upstream = "unix:///var/run/docker.sock"
	}
	if !strings.HasPrefix(upstream, "unix://") {
		t.Fatal("Unix Engine required")
	}
	directory, err := os.MkdirTemp("/tmp", "piwork-service-diag-")
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("unix", filepath.Join(directory, "engine.sock"))
	if err != nil {
		t.Fatal(err)
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", strings.TrimPrefix(upstream, "unix://"))
	}}
	proxy := &httputil.ReverseProxy{Transport: transport, Rewrite: func(r *httputil.ProxyRequest) { r.Out.URL.Scheme = "http"; r.Out.URL.Host = "engine" }}
	var mode atomic.Int32
	var collections atomic.Int32
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fault := mode.Load()
		if fault != 0 && r.Method == "GET" && strings.HasSuffix(r.URL.Path, "/logs") && strings.Contains(r.URL.Path, "/containers/") {
			collections.Add(1)
			if fault == 2 {
				select {
				case <-r.Context().Done():
					return
				case <-time.After(5 * time.Second):
				}
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(500)
			w.Write([]byte(`{"message":"SECRET_LOG_TOKEN /private/host/path forged Skill body"}`))
			return
		}
		proxy.ServeHTTP(w, r)
	})}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close(); transport.CloseIdleConnections(); os.RemoveAll(directory) })
	t.Setenv("PIWORK_TEST_DOCKER_HOST", "unix://"+filepath.Join(directory, "engine.sock"))
	a, base, auth, id, ctx := nativeApplyFixture(t)
	for _, fault := range []int32{1, 2} {
		mode.Store(fault)
		name := "log-error"
		if fault == 2 {
			name = "log-timeout"
		}
		before := collections.Load()
		script := `const http=require('node:http');http.createServer((req,res)=>{res.writeHead(503);res.end('not ready');}).listen(8099,'0.0.0.0');`
		definition := map[string]any{"name": name, "image": map[string]string{"reference": a.options.Initialization.Runtime.AgentImage}, "command": "node", "args": []string{"-e", script}, "workingDirectory": "/", "ports": []any{map[string]any{"name": "web", "containerPort": 8099, "protocol": "tcp"}}, "readiness": map[string]any{"kind": "http", "portName": "web", "path": "/health", "deadlineMs": 1000}}
		status, accepted := packageHTTPCall(t, base, "/api/v1/works/"+id+"/services", "POST", auth, map[string]any{"definition": definition, "idempotencyKey": name})
		if status != 202 {
			t.Fatal(status, accepted)
		}
		began := time.Now()
		failed := waitApplyFailure(t, ctx, a, accepted["operationId"].(string))
		view := operationEnvelopeView(failed).(map[string]any)
		diagnostic := view["diagnostics"].(map[string]any)
		collection := diagnostic["diagnosticCollection"].(map[string]any)
		if view["error"].(map[string]any)["code"] != "SERVICE_READINESS_TIMEOUT" || collection["state"] != "unavailable" || collection["code"] != "DIAGNOSTIC_COLLECTION_FAILED" || collections.Load() <= before {
			t.Fatal("collection replaced failure or disappeared", view)
		}
		if time.Since(began) > 15*time.Second {
			t.Fatal("collection not bounded", time.Since(began))
		}
		raw, _ := json.Marshal(view)
		if strings.Contains(string(raw), "SECRET_LOG_TOKEN") || strings.Contains(string(raw), "/private/host") {
			t.Fatal("untrusted logs escaped", string(raw))
		}
		mode.Store(0)
		status, removed := packageHTTPCall(t, base, "/api/v1/works/"+id+"/services/"+accepted["serviceId"].(string)+"/remove", "POST", auth, map[string]string{"idempotencyKey": "remove-" + name})
		if status != 202 {
			t.Fatal(status, removed)
		}
		waitWorkOperation(t, ctx, a, removed["operationId"].(string))
		t.Log(name, "operation", accepted["operationId"], "collection", collection)
	}
}
