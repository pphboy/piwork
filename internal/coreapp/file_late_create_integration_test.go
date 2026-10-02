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
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
)

func TestNativeCoreFileCreateCancellationRetainsLateContainer(t *testing.T) {
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
	started, allow, settled := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var triggered atomic.Bool
	var release sync.Once
	var containerID string
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/containers/create") {
			body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
			if err != nil {
				w.WriteHeader(500)
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(body))
			var input struct{ Labels map[string]string }
			_ = json.Unmarshal(body, &input)
			if input.Labels[dockerengine.KindLabel] == "file-helper" && triggered.CompareAndSwap(false, true) {
				close(started)
				<-allow
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
				data, _ := io.ReadAll(io.LimitReader(response.Body, 64<<10))
				var created struct{ ID string }
				_ = json.Unmarshal(data, &created)
				containerID = created.ID
				w.WriteHeader(response.StatusCode)
				_, _ = w.Write(data)
				close(settled)
				return
			}
		}
		proxy.ServeHTTP(w, r)
	})}
	go server.Serve(listener)
	t.Cleanup(func() { release.Do(func() { close(allow) }); server.Close(); transport.CloseIdleConnections() })
	t.Setenv("PIWORK_TEST_DOCKER_HOST", "unix://"+socket)
	a, base, auth, id, ctx := nativeApplyFixture(t)
	requestContext, cancelRequest := context.WithCancel(ctx)
	request, err := http.NewRequestWithContext(requestContext, "PUT", base+"/api/v1/works/"+id+"/files/late", strings.NewReader("not-published"))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", auth)
	done := make(chan error, 1)
	go func() {
		response, err := http.DefaultClient.Do(request)
		if response != nil {
			response.Body.Close()
		}
		done <- err
	}()
	select {
	case <-started:
	case <-time.After(15 * time.Second):
		t.Fatal("file create boundary missing")
	}
	cancelRequest()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("cancelled client unexpectedly succeeded")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("client cancellation blocked")
	}
	var job corestore.FileJob
	// The Engine create request has its own ten-second deadline, followed by
	// durable cleanup. Allow both stages before declaring the intent lost.
	for deadline := time.Now().Add(25 * time.Second); ; time.Sleep(20 * time.Millisecond) {
		var pending []corestore.FileJob
		err := a.Store.Read(ctx, func(tx *sql.Tx) error { var err error; pending, err = corestore.PendingFileJobs(tx, &id); return err })
		if err != nil {
			t.Fatal(err)
		}
		if len(pending) == 1 && pending[0].State == "cleanup-pending" {
			job = pending[0]
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("cancelled create intent was forgotten", pending)
		}
	}
	// Stop cannot prove the deferred create absent and must report failure.
	status, accepted := packageHTTPCall(t, base, "/api/v1/works/"+id+"/stop", "POST", auth, map[string]string{"idempotencyKey": "stop-unknown-file"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	for {
		op, err := a.Store.Operation(ctx, accepted["operationId"].(string))
		if err != nil {
			t.Fatal(err)
		}
		if op.State == "failed" {
			break
		}
		if op.State == "succeeded" || ctx.Err() != nil {
			t.Fatal("unknown create reported stopped", op.State, ctx.Err())
		}
		time.Sleep(20 * time.Millisecond)
	}
	release.Do(func() { close(allow) })
	select {
	case <-settled:
	case <-time.After(10 * time.Second):
		t.Fatal("late Engine create did not finish")
	}
	if containerID == "" {
		t.Fatal("late container was not created")
	}
	if err := a.recoverFileJob(ctx, job.ID, true); err != nil {
		t.Fatal("late exact helper not retired", err)
	}
	var attempts []corestore.FileAttempt
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error { var err error; attempts, err = corestore.FileAttempts(tx, job.ID); return err }); err != nil {
		t.Fatal(err)
	}
	if len(attempts) != 1 || attempts[0].State != "removed" {
		t.Fatal(attempts)
	}
	if err := a.dockerRuntime.ConfirmContainerAbsent(ctx, containerID, attempts[0].ContainerName); err != nil {
		t.Fatal(err)
	}
	status, accepted = packageHTTPCall(t, base, "/api/v1/works/"+id+"/start", "POST", auth, map[string]string{"idempotencyKey": "start-after-late-file"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	waitWorkOperation(t, ctx, a, accepted["operationId"].(string))
	request, err = http.NewRequestWithContext(ctx, "GET", base+"/api/v1/works/"+id+"/files/late", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", auth)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 404 {
		t.Fatal("late PUT was replayed", response.StatusCode)
	}
}
