//go:build integration

package coreapp

import (
	"context"
	"database/sql"
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

	"piwork/internal/corestore"
	"piwork/internal/internaltls"
)

func TestNativeTemporaryCleanupRetriesAfterEngineReturns(t *testing.T) {
	upstream := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if upstream == "" {
		upstream = "unix:///var/run/docker.sock"
	}
	if !strings.HasPrefix(upstream, "unix://") {
		t.Fatal("Unix Engine required")
	}
	directory, err := os.MkdirTemp("/tmp", "piwork-temporary-outage-")
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
	var unavailable atomic.Bool
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if unavailable.Load() {
			http.Error(w, "synthetic Engine outage", http.StatusServiceUnavailable)
			return
		}
		proxy.ServeHTTP(w, r)
	})}
	go server.Serve(listener)
	t.Cleanup(func() { _ = server.Close(); transport.CloseIdleConnections() })
	t.Setenv("PIWORK_TEST_DOCKER_HOST", "unix://"+filepath.Join(directory, "engine.sock"))
	a, base, auth, workID, ctx := nativeApplyFixture(t)
	defer unavailable.Store(false)
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil {
		t.Fatal(err)
	}
	generation, instance, err := a.selectAgentGeneration(ctx, work)
	if err != nil {
		t.Fatal(err)
	}
	scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: workID, Generation: generation, InstanceID: instance}
	owner := corestore.TemporaryRunOwner{WorkID: workID, RunID: "run-engine-outage", Generation: generation, InstanceID: instance}
	lease, err := a.Store.OpenTemporaryRunLease(ctx, owner, packageNow())
	if err != nil {
		t.Fatal(err)
	}
	definition, _ := json.Marshal(map[string]any{"name": "outage-listener", "image": map[string]string{"reference": a.options.Initialization.Runtime.AgentImage}, "command": "node", "args": []string{"-e", "setInterval(()=>{},1000)"}, "workingDirectory": "/"})
	admission := temporaryServiceAdmission{Owner: owner, LeaseID: lease.LeaseID, Mode: "listener"}
	accepted, err := a.acceptServiceDefinitionScoped(ctx, serviceActor{Runtime: &scope}, workID, "", 0, definition, "outage-create", &admission)
	if err != nil {
		t.Fatal(err)
	}
	op, err := a.Store.Operation(ctx, accepted.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.processServiceOperation(ctx, op); err != nil {
		t.Fatal(err)
	}
	unavailable.Store(true)
	if err := a.closeTemporaryRunAndRequestCleanup(ctx, owner, "run-cancelled"); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(20 * time.Second)
	for {
		var cleanup corestore.TemporaryCleanupRecord
		var quota corestore.QuotaReservation
		var found bool
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
		if found && cleanup.State == "pending" && cleanup.ErrorCode == "DOCKER_UNAVAILABLE" {
			if quota.ServiceSlots != 1 {
				t.Fatal("outage released unconfirmed capacity")
			}
			status, current := packageHTTPCall(t, base, "/api/v1/works/"+workID+"/temporary-cleanups/"+accepted.ServiceID, "GET", auth, nil)
			if status != 200 || current["errorCode"] != "DOCKER_UNAVAILABLE" {
				t.Fatal("outage reason was not queryable", status, current)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("Engine outage did not remain pending", cleanup)
		}
		time.Sleep(100 * time.Millisecond)
	}
	unavailable.Store(false)
	deadline = time.Now().Add(45 * time.Second)
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
				t.Fatal("Engine recovery retry was not recorded", cleanup.Events)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("cleanup did not resume after Engine recovery", cleanup)
		}
		time.Sleep(100 * time.Millisecond)
	}
	view, _, err := a.inspectServiceRuntime(ctx, workID, accepted.ServiceID)
	if err != nil || view != nil {
		t.Fatal("cleanup left the listener behind", err)
	}
}
