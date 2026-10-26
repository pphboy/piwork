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
	"piwork/internal/internaltls"
)

func TestNativeTemporaryLateCreateRemainsPendingUntilExactCleanup(t *testing.T) {
	testNativeTemporaryLateCreate(t, false)
}

func TestNativeWorkStopFencesLateTemporaryCreate(t *testing.T) {
	testNativeTemporaryLateCreate(t, true)
}

func testNativeTemporaryLateCreate(t *testing.T, stopWork bool) {
	t.Helper()
	upstream := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if upstream == "" {
		upstream = "unix:///var/run/docker.sock"
	}
	if !strings.HasPrefix(upstream, "unix://") {
		t.Fatal("Unix Engine required")
	}
	directory, err := os.MkdirTemp("/tmp", "piwork-temporary-engine-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(directory) })
	listener, err := net.Listen("unix", filepath.Join(directory, "engine.sock"))
	if err != nil {
		t.Fatal(err)
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", strings.TrimPrefix(upstream, "unix://"))
	}}
	proxy := &httputil.ReverseProxy{Transport: transport, Rewrite: func(r *httputil.ProxyRequest) { r.Out.URL.Scheme = "http"; r.Out.URL.Host = "engine" }}
	started, allow, settled := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var creates atomic.Int32
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
			_ = json.Unmarshal(body, &input)
			if input.Labels[dockerengine.KindLabel] == "service" {
				count := creates.Add(1)
				if count == 1 {
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
					for key, values := range response.Header {
						w.Header()[key] = values
					}
					w.WriteHeader(response.StatusCode)
					_, _ = io.Copy(w, response.Body)
					close(settled)
					return
				}
			}
		}
		proxy.ServeHTTP(w, r)
	})}
	go server.Serve(listener)
	t.Cleanup(func() { release.Do(func() { close(allow) }); _ = server.Close(); transport.CloseIdleConnections() })
	t.Setenv("PIWORK_TEST_DOCKER_HOST", "unix://"+filepath.Join(directory, "engine.sock"))
	a, base, auth, workID, ctx := nativeApplyFixture(t)
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil {
		t.Fatal(err)
	}
	generation, instance, err := a.selectAgentGeneration(ctx, work)
	if err != nil {
		t.Fatal(err)
	}
	scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: workID, Generation: generation, InstanceID: instance}
	owner := corestore.TemporaryRunOwner{WorkID: workID, RunID: "run-late-temporary-00001", Generation: generation, InstanceID: instance}
	lease, err := a.Store.OpenTemporaryRunLease(ctx, owner, packageNow())
	if err != nil {
		t.Fatal(err)
	}
	definition, _ := json.Marshal(map[string]any{"name": "late-temporary", "image": map[string]string{"reference": a.options.Initialization.Runtime.AgentImage}, "command": "node", "args": []string{"-e", "setInterval(()=>{},1000)"}, "workingDirectory": "/"})
	admission := temporaryServiceAdmission{Owner: owner, LeaseID: lease.LeaseID, Mode: "once"}
	accepted, err := a.acceptServiceDefinitionScoped(ctx, serviceActor{Runtime: &scope}, workID, "", 0, definition, "late-temp", &admission)
	if err != nil {
		t.Fatal(err)
	}
	a.enqueueWork(workID)
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("Docker create did not start")
	}
	if stopWork {
		status, result := packageHTTPCall(t, base, "/api/v1/works/"+workID+"/stop", "POST", auth, map[string]string{"idempotencyKey": "stop-during-temporary-create"})
		if status != 202 {
			t.Fatal("Work Stop was not accepted", status, result)
		}
		if _, err := a.acceptServiceDefinitionScoped(ctx, serviceActor{Runtime: &scope}, workID, "", 0, definition, "late-after-stop", &admission); err == nil {
			t.Fatal("Work Stop admitted a new temporary Service")
		}
	} else if err := a.closeTemporaryRunAndRequestCleanup(ctx, owner, "run-cancelled"); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(20 * time.Second)
	for {
		var cleanup corestore.TemporaryCleanupRecord
		var found bool
		var quota corestore.QuotaReservation
		err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			var err error
			cleanup, found, err = corestore.ReadTemporaryCleanupTx(tx, workID, accepted.ServiceID)
			if err != nil {
				return err
			}
			quota, err = corestore.ReadQuotaReservation(tx, workID, "service", accepted.ServiceID)
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
		if found && cleanup.State == "pending" && cleanup.ErrorCode == "TEMPORARY_CREATE_UNCONFIRMED" {
			if quota.ServiceSlots != 1 {
				t.Fatal("quota released before confirmation")
			}
			if stopWork {
				work, err := a.Store.Work(ctx, workID, false)
				if err != nil || work.DesiredState != "stopped" || work.ObservedState == "stopped" {
					t.Fatal("Work Stop falsely confirmed an unanswered create", work.ObservedState, err)
				}
				if cleanup.Trigger != "work-stop" {
					t.Fatal("cleanup did not preserve Work Stop trigger", cleanup.Trigger)
				}
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("unanswered create was not held pending", cleanup)
		}
		time.Sleep(100 * time.Millisecond)
	}
	release.Do(func() { close(allow) })
	select {
	case <-settled:
	case <-ctx.Done():
		t.Fatal("late create did not settle")
	}
	deadline = time.Now().Add(25 * time.Second)
	for {
		var cleanup corestore.TemporaryCleanupRecord
		var found bool
		err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			var err error
			cleanup, found, err = corestore.ReadTemporaryCleanupTx(tx, workID, accepted.ServiceID)
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
		if found && cleanup.State == "completed" {
			started, succeeded := false, false
			for _, event := range cleanup.Events {
				started = started || event.Stage == "retry" && event.Outcome == "started"
				succeeded = succeeded || event.Stage == "retry" && event.Outcome == "succeeded"
			}
			if !started || !succeeded {
				t.Fatal("cleanup retry was not durably recorded", cleanup.Events)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("late instance was not cleaned", cleanup)
		}
		time.Sleep(100 * time.Millisecond)
	}
	view, _, err := a.inspectServiceRuntime(ctx, workID, accepted.ServiceID)
	if err != nil || view != nil || creates.Load() != 1 {
		t.Fatal("late instance survived or creation replayed", creates.Load(), err)
	}
}
