//go:build integration

package coreapp

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"piwork/internal/dockerengine"
)

func TestNativeServiceLateCreateAndMissingAgentStop(t *testing.T) {
	upstream := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if upstream == "" {
		upstream = "unix:///var/run/docker.sock"
	}
	if !strings.HasPrefix(upstream, "unix://") {
		t.Fatal("fixture requires Unix Engine")
	}
	socketDirectory, err := os.MkdirTemp("/tmp", "piwork-engine-fixture-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(socketDirectory) })
	socket := filepath.Join(socketDirectory, "engine.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", strings.TrimPrefix(upstream, "unix://"))
	}}
	proxy := &httputil.ReverseProxy{Transport: transport, Rewrite: func(r *httputil.ProxyRequest) { r.Out.URL.Scheme = "http"; r.Out.URL.Host = "engine" }}
	started := make(chan struct{})
	allow := make(chan struct{})
	settled := make(chan struct{})
	var triggered atomic.Bool
	var release sync.Once
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/containers/create") {
			body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
			if err != nil {
				w.WriteHeader(500)
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(body))
			var input struct{ Labels map[string]string }
			json.Unmarshal(body, &input)
			if input.Labels[dockerengine.KindLabel] == "service" && triggered.CompareAndSwap(false, true) {
				close(started)
				<-allow // Simulate an Engine that completes create after client cancellation.
				request := r.Clone(context.Background())
				request.Body = io.NopCloser(bytes.NewReader(body))
				request.URL.Scheme = "http"
				request.URL.Host = "engine"
				request.RequestURI = ""
				response, err := transport.RoundTrip(request)
				if err != nil {
					w.WriteHeader(502)
					close(settled)
					return
				}
				defer response.Body.Close()
				for key, values := range response.Header {
					w.Header()[key] = values
				}
				w.WriteHeader(response.StatusCode)
				io.Copy(w, response.Body)
				close(settled)
				return
			}
		}
		proxy.ServeHTTP(w, r)
	})}
	go server.Serve(listener)
	t.Cleanup(func() { release.Do(func() { close(allow) }); server.Close(); transport.CloseIdleConnections() })
	t.Setenv("PIWORK_TEST_DOCKER_HOST", "unix://"+socket)
	a, base, auth, workID, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + workID
	definition := map[string]any{"name": "late", "image": map[string]string{"reference": a.options.Initialization.Runtime.AgentImage}, "command": "node", "args": []string{"-e", `require('node:http').createServer((q,s)=>s.end('ok')).listen(8099,'0.0.0.0')`}, "workingDirectory": "/", "ports": []any{map[string]any{"name": "web", "protocol": "tcp", "containerPort": 8099}}, "readiness": map[string]any{"kind": "http", "portName": "web", "path": "/", "deadlineMs": 10000}}
	status, accepted := packageHTTPCall(t, base, path+"/services", "POST", auth, map[string]any{"definition": definition, "idempotencyKey": "late-create"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	status, stop := packageHTTPCall(t, base, path+"/stop", "POST", auth, map[string]string{"idempotencyKey": "stop-unanswered-create"})
	if status != 202 {
		t.Fatal(status, stop)
	}
	failed := waitApplyFailure(t, ctx, a, stop["operationId"].(string))
	if failed.State != "failed" {
		t.Fatal("unconfirmed create became stopped")
	}
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil || work.ObservedState == "stopped" {
		t.Fatal("unknown creation falsely released Work", work, err)
	}
	release.Do(func() { close(allow) })
	select {
	case <-settled:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	serviceID := accepted["serviceId"].(string)
	actual, _, err := a.inspectServiceRuntime(ctx, workID, serviceID)
	if err != nil || actual == nil || actual.State.Running {
		t.Fatal("late create was started after stop", actual, err)
	}
	old, err := a.Store.Operation(ctx, accepted["operationId"].(string))
	if err != nil || old.State != "superseded" {
		t.Fatal("late completion overwrote newer control", old.State, err)
	}
	agent := dockerengine.ContainerIdentity{WorkID: workID, Kind: "agent", LogicalID: "agentd"}
	if _, err := a.dockerRuntime.StopContainer(ctx, agent, 1); err != nil {
		t.Fatal(err)
	}
	if err := a.dockerRuntime.RemoveContainer(ctx, agent); err != nil {
		t.Fatal(err)
	}
	if err := a.confirmMissingAgent(ctx, workID); err != nil {
		t.Fatal("confirmed Agent absence", err)
	}
	status, confirmed := packageHTTPCall(t, base, path+"/stop", "POST", auth, map[string]string{"idempotencyKey": "stop-after-late-create"})
	if status != 202 {
		t.Fatal(status, confirmed)
	}
	waitWorkOperation(t, ctx, a, confirmed["operationId"].(string))
	service, err := a.Store.Service(ctx, workID, serviceID, false)
	actual, _, inspectErr := a.inspectServiceRuntime(ctx, workID, serviceID)
	if err != nil || inspectErr != nil || !service.Enabled || service.ObservedState != "stopped" || actual == nil || actual.State.Running {
		t.Fatal("Agent absence skipped Service stop", service, err, inspectErr)
	}
	status, deleted := packageHTTPCall(t, base, path+"/delete", "POST", auth, map[string]string{"idempotencyKey": "delete-late-service"})
	if status != 202 {
		t.Fatal(status, deleted)
	}
	waitWorkOperation(t, ctx, a, deleted["operationId"].(string))
	actual, _, err = a.inspectServiceRuntime(ctx, workID, serviceID)
	if err != nil || actual != nil {
		t.Fatal("late exact instance remained after delete", actual, err)
	}
	t.Log("unanswered create is unknown; late matching instance never starts, Stop works without Agent, Delete removes only exact instance")
}
