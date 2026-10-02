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

func TestNativeSnapshotRecoveryRetainsUnknownCreateUntilLateHelperExists(t *testing.T) {
	upstream := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if upstream == "" {
		upstream = "unix:///var/run/docker.sock"
	}
	if !strings.HasPrefix(upstream, "unix://") {
		t.Fatal("local Unix Engine required")
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", strings.TrimPrefix(upstream, "unix://"))
	}}
	proxy := &httputil.ReverseProxy{Transport: transport, Rewrite: func(r *httputil.ProxyRequest) { r.Out.URL.Scheme = "http"; r.Out.URL.Host = "engine" }}
	client := &http.Client{Transport: transport}
	directory, err := os.MkdirTemp("/tmp", "piwork-late-snapshot-")
	if err != nil {
		t.Fatal(err)
	}
	socket := filepath.Join(directory, "engine.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	var installation atomic.Value
	installation.Store("")
	var armed atomic.Bool
	var creates atomic.Int64
	release := make(chan struct{})
	created := make(chan error, 1)
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/containers/create") {
			raw, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
			if err != nil {
				http.Error(w, "fixture body unavailable", 400)
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(raw))
			var spec struct{ Labels map[string]string }
			if json.Unmarshal(raw, &spec) == nil && spec.Labels[dockerengine.InstallationLabel] == installation.Load().(string) && spec.Labels[dockerengine.KindLabel] == "snapshot-helper" {
				creates.Add(1)
				if armed.CompareAndSwap(true, false) {
					path := r.URL.RequestURI()
					go func() {
						<-release
						ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
						defer cancel()
						request, err := http.NewRequestWithContext(ctx, "POST", "http://engine"+path, bytes.NewReader(raw))
						if err != nil {
							created <- err
							return
						}
						request.Header.Set("Content-Type", "application/json")
						response, err := client.Do(request)
						if err != nil {
							created <- err
							return
						}
						defer response.Body.Close()
						_, _ = io.Copy(io.Discard, response.Body)
						if response.StatusCode != 201 {
							created <- dockerengine.ErrUnavailable
							return
						}
						created <- nil
					}()
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(500)
					_, _ = w.Write([]byte(`{"message":"fixture loses the create result"}`))
					return
				}
			}
		}
		proxy.ServeHTTP(w, r)
	})}
	go server.Serve(listener)
	t.Cleanup(func() { unblock(); server.Close(); transport.CloseIdleConnections(); os.RemoveAll(directory) })
	t.Setenv("PIWORK_TEST_DOCKER_HOST", "unix://"+socket)
	a, base, auth, work, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + work
	status, stopped := packageHTTPCall(t, base, path+"/stop", "POST", auth, map[string]string{"idempotencyKey": "late-create-stop"})
	if status != 202 {
		t.Fatal(status, stopped)
	}
	waitWorkOperation(t, ctx, a, stopped["operationId"].(string))
	installation.Store(a.Store.InstallationID())
	armed.Store(true)
	status, accepted := packageHTTPCall(t, base, path+"/exports", "POST", auth, map[string]string{"idempotencyKey": "late-create-export"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	id := accepted["operationId"].(string)
	waitApplyFailure(t, ctx, a, id)
	var job corestore.SnapshotJob
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error { var err error; job, err = corestore.ReadSnapshotJob(tx, id); return err }); err != nil {
		t.Fatal(err)
	}
	if job.Phase != "cleanup-pending" || creates.Load() != 1 {
		t.Fatal("unknown creation released or resubmitted", job.Phase, creates.Load())
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error { return corestore.AssertWorkMutable(tx, work) }); err != corestore.ErrSnapshotBusy {
		t.Fatal("source lock released before confirmation", err)
	}
	if root, err := a.openSnapshotJobRoot(id); err != nil {
		t.Fatal("unknown helper spool removed", err)
	} else {
		root.Close()
	}
	unblock()
	select {
	case err := <-created:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if err := a.recoverSnapshotJobs(ctx, true); err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error { var err error; job, err = corestore.ReadSnapshotJob(tx, id); return err }); err != nil {
		t.Fatal(err)
	}
	if job.Phase != "cleaned" || creates.Load() != 1 {
		t.Fatal("late helper not precisely retired", job.Phase, creates.Load())
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error { return corestore.AssertWorkMutable(tx, work) }); err != nil {
		t.Fatal("confirmed cleanup retained source lock", err)
	}
	items, err := a.dockerRuntime.ListContainers(ctx, "snapshot-helper")
	if err != nil || len(items) != 0 {
		t.Fatal("late helper retained", len(items), err)
	}
	t.Log("late snapshot helper cleaned without replay:", a.Store.InstallationID(), id)
}
