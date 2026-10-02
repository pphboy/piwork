//go:build integration

package coreapp

import (
	"context"
	"database/sql"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"os"
	"path/filepath"
	"piwork/internal/contracts"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
)

func TestNativeUnconfirmedFileHelperStopStillStopsAgentAndService(t *testing.T) {
	upstream := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if upstream == "" {
		upstream = "unix:///var/run/docker.sock"
	}
	if !strings.HasPrefix(upstream, "unix://") {
		t.Fatal("Unix Engine required")
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", strings.TrimPrefix(upstream, "unix://"))
	}}
	proxy := &httputil.ReverseProxy{Transport: transport, Rewrite: func(r *httputil.ProxyRequest) { r.Out.URL.Scheme = "http"; r.Out.URL.Host = "engine" }}
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
	var blocked atomic.Pointer[string]
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := blocked.Load()
		if id != nil && r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/containers/"+*id+"/stop") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(500)
			_, _ = w.Write([]byte(`{"message":"fixture stop unconfirmed"}`))
			return
		}
		proxy.ServeHTTP(w, r)
	})}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close(); transport.CloseIdleConnections() })
	t.Setenv("PIWORK_TEST_DOCKER_HOST", "unix://"+socket)
	a, base, auth, id, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + id
	script := `const fs=require('node:fs');require('node:http').createServer((q,s)=>{if(q.url==='/health'){s.end('ok');return;}if(q.url==='/write')fs.writeFileSync('/var/data/workspace/value','from-service');s.end(fs.readFileSync('/var/data/workspace/value'));}).listen(8099,'0.0.0.0')`
	definition := map[string]any{"name": "files", "image": map[string]string{"reference": a.options.Initialization.Runtime.AgentImage}, "command": "node", "args": []string{"-e", script}, "mounts": []any{map[string]any{"source": "workspace", "target": "/var/data/workspace", "readOnly": false}}, "workingDirectory": "/var/data/workspace", "ports": []any{map[string]any{"name": "web", "protocol": "tcp", "containerPort": 8099}}, "readiness": map[string]any{"kind": "http", "portName": "web", "path": "/health", "deadlineMs": 10000}}
	status, accepted := packageHTTPCall(t, base, path+"/services", "POST", auth, map[string]any{"definition": definition, "idempotencyKey": "file-stop-service"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	waitWorkOperation(t, ctx, a, accepted["operationId"].(string))
	serviceID := accepted["serviceId"].(string)
	session, err := a.Identity.Authenticate(ctx, strings.TrimPrefix(auth, "Bearer "))
	if err != nil {
		t.Fatal(err)
	}
	var generation int64
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT max(generation) FROM runtime_generations WHERE work_id=?`, id).Scan(&generation)
	}); err != nil {
		t.Fatal(err)
	}
	accessIdentity := fileAccessIdentity{WorkID: id, OwnerUserID: session.User.ID, SessionID: session.SessionID, RuntimeGeneration: generation}
	if result, err := a.executeFileJob(ctx, fileExecutionInput{Identity: accessIdentity, Action: "PUT", Path: []string{"value"}, Conditions: emptyFileConditions(), Body: io.NopCloser(strings.NewReader("from-dav"))}); err != nil || result.Status != 201 {
		t.Fatal("DAV seed", result, err)
	}
	status, serviceView := packageHTTPCall(t, base, path+"/services/"+serviceID, "GET", auth, nil)
	if status != 200 {
		t.Fatal(status, serviceView)
	}
	gateway := "/api/v1/service-gateway/" + serviceView["access"].(map[string]any)["hostname"].(string) + "/80"
	for _, part := range []string{"/read", "/write"} {
		response := gatewayRequest(t, base, strings.TrimPrefix(auth, "Bearer "), gateway+part, nil, nil)
		body, err := io.ReadAll(response.Body)
		response.Body.Close()
		want := "from-dav"
		if part == "/write" {
			want = "from-service"
		}
		if err != nil || response.StatusCode != 200 || string(body) != want {
			t.Fatal("Service shared volume", string(body), err)
		}
	}
	var readBack strings.Builder
	if _, err := a.executeFileJob(ctx, fileExecutionInput{Identity: accessIdentity, Action: "GET", Path: []string{"value"}, Conditions: emptyFileConditions(), OnMeta: func(contracts.FileHelperMeta) error { return nil }, OnData: func(data []byte) error { _, err := readBack.Write(data); return err }}); err != nil || readBack.String() != "from-service" {
		t.Fatal("DAV did not read Service file", readBack.String(), err)
	}
	job, attempt, err := a.acceptFileJob(ctx, fileExecutionInput{Identity: accessIdentity, Action: "GET", Path: []string{"value"}, Conditions: emptyFileConditions()})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.UpdateFileJobState(tx, job.ID, "accepted", "starting", packageNow(), nil); err != nil {
			return err
		}
		return corestore.UpdateFileAttempt(tx, attempt.ID, "planned", "creating", packageNow(), nil)
	}); err != nil {
		t.Fatal(err)
	}
	attempt.State = "creating"
	spec := fileAttemptSpec(job, attempt)
	created, err := a.dockerRuntime.EnsureFileHelper(ctx, spec)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.UpdateFileAttempt(tx, attempt.ID, "creating", "created", packageNow(), &created.ID)
	}); err != nil {
		t.Fatal(err)
	}
	stream, err := a.dockerRuntime.AttachFileHelper(ctx, spec)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	if _, err := a.dockerRuntime.StartContainer(ctx, dockerengine.FileHelperIdentity(spec)); err != nil {
		t.Fatal(err)
	}
	blocked.Store(&created.ID)
	t.Cleanup(func() { blocked.Store(nil) })
	status, accepted = packageHTTPCall(t, base, path+"/stop", "POST", auth, map[string]string{"idempotencyKey": "unconfirmed-file-stop"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	for {
		operation, err := a.Store.Operation(ctx, accepted["operationId"].(string))
		if err != nil {
			t.Fatal(err)
		}
		if operation.State == "failed" {
			break
		}
		if operation.State == "succeeded" || ctx.Err() != nil {
			t.Fatal("unconfirmed stop reported success", operation.State, ctx.Err())
		}
		time.Sleep(20 * time.Millisecond)
	}
	view, err := a.dockerRuntime.InspectFileHelper(ctx, spec)
	if err != nil || view == nil || view.State == nil || !view.State.Running {
		t.Fatal("fault helper state not retained", err)
	}
	agent, err := a.dockerRuntime.InspectContainer(ctx, dockerengine.ContainerIdentity{WorkID: id, Kind: "agent", LogicalID: "agentd"})
	if err != nil || agent == nil || agent.State == nil || agent.State.Running {
		t.Fatal("helper failure skipped Agent stop", err)
	}
	service, _, err := a.inspectServiceRuntime(ctx, id, serviceID)
	if err != nil || service == nil || service.State == nil || service.State.Running {
		t.Fatal("helper failure skipped Service stop", err)
	}
	work, err := a.Store.Work(ctx, id, false)
	if err != nil || work.ObservedState != "failed" {
		t.Fatal("unconfirmed Work reported stopped", work, err)
	}
	blocked.Store(nil)
	if err := a.recoverFileJob(ctx, job.ID, true); err != nil {
		t.Fatal("explicit recovery did not retire fault helper", err)
	}
}
