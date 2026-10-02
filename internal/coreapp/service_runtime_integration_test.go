//go:build integration

package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
)

func TestNativeServiceRevisionsCounterAndRemoval(t *testing.T) {
	a, _, auth, workID, ctx := nativeApplyFixture(t)
	session, err := a.Identity.Authenticate(ctx, strings.TrimPrefix(auth, "Bearer "))
	if err != nil {
		t.Fatal(err)
	}
	principal := session.Principal()
	actor := serviceActor{User: &principal}
	image := a.options.Initialization.Runtime.AgentImage
	script := `const fs=require('node:fs'),http=require('node:http'); const file='/var/data/workspace/service-counter.txt'; const server=http.createServer((req,res)=>{if(req.url==='/health'){res.end('ok');return;}let n=fs.existsSync(file)?Number(fs.readFileSync(file,'utf8')):0;fs.writeFileSync(file,String(++n));res.end(JSON.stringify({count:n}));});server.listen(8099,'0.0.0.0');process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`
	input := map[string]any{"name": "counter", "image": map[string]string{"reference": image}, "command": "node", "args": []string{"-e", script}, "mounts": []any{map[string]any{"source": "workspace", "target": "/var/data/workspace", "readOnly": false}}, "ports": []any{map[string]any{"name": "web", "protocol": "tcp", "containerPort": 8099}}, "readiness": map[string]any{"kind": "http", "portName": "web", "path": "/health", "deadlineMs": 10000}}
	raw := func() json.RawMessage {
		encoded, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		return encoded
	}
	created, err := a.acceptServiceDefinition(ctx, actor, workID, "", 0, raw(), "counter-create")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if a.closed {
			return
		}
		cleanup, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if err := a.stopServiceRuntime(cleanup, workID, created.ServiceID, true); err != nil {
			t.Error(err)
		}
	})
	process := func(accepted acceptedServiceOperation, want string) corestore.OperationRecord {
		t.Helper()
		operation, err := a.Store.Operation(ctx, accepted.OperationID)
		if err != nil {
			t.Fatal(err)
		}
		if err := a.processServiceOperation(ctx, operation); err != nil {
			t.Fatal(err)
		}
		operation, err = a.Store.Operation(ctx, accepted.OperationID)
		if err != nil || operation.State != want {
			t.Fatal("service operation", operation.State, operation.ErrorJSON, err)
		}
		return operation
	}
	process(created, "succeeded")
	view, binding, err := a.inspectServiceRuntime(ctx, workID, created.ServiceID)
	if err != nil || view == nil || binding == nil || !view.State.Running {
		t.Fatal(err)
	}
	firstID := view.ID
	if !strings.HasSuffix(view.Name, "_counter") || len(view.HostConfig.PortBindings) != 0 || len(view.HostConfig.Mounts) != 2 || len(view.NetworkSettings.Networks) != 1 {
		t.Fatal("unsafe service container configuration")
	}
	count := func(want int) {
		t.Helper()
		network, err := a.dockerRuntime.EnsureNetwork(ctx, workID)
		if err != nil {
			t.Fatal(err)
		}
		address, err := a.dockerRuntime.ContainerAddress(ctx, serviceContainerIdentity(workID, created.ServiceID, 0), network.Name)
		if err != nil {
			t.Fatal(err)
		}
		request, err := http.NewRequestWithContext(ctx, "GET", "http://"+address+":8099/", nil)
		if err != nil {
			t.Fatal(err)
		}
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var body struct {
			Count int `json:"count"`
		}
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil || body.Count != want {
			t.Fatal("durable counter", body.Count, want, err)
		}
	}
	count(1)
	count(2)
	restart, err := a.acceptServiceAction(ctx, actor, workID, created.ServiceID, "restart", "restart")
	if err != nil {
		t.Fatal(err)
	}
	process(restart, "succeeded")
	count(3)
	view, _, err = a.inspectServiceRuntime(ctx, workID, created.ServiceID)
	if err != nil || view.ID == firstID {
		t.Fatal("restart did not replace exact instance", err)
	}
	workAction := func(action, key string) {
		t.Helper()
		accepted, err := a.acceptWorkAction(ctx, principal, workID, action, key)
		if err != nil {
			t.Fatal(err)
		}
		waitWorkOperation(t, ctx, a, accepted.OperationID)
	}
	workAction("stop", "work-stop-counter")
	view, _, err = a.inspectServiceRuntime(ctx, workID, created.ServiceID)
	if err != nil || view == nil || view.State.Running {
		t.Fatal("Work stop left service running", err)
	}
	recordBefore, err := a.Store.Service(ctx, workID, created.ServiceID, false)
	if err != nil || !recordBefore.Enabled {
		t.Fatal("Work stop disabled service", err)
	}
	workAction("start", "work-start-counter")
	count(4)
	input["command"] = "/not-an-executable"
	failed, err := a.acceptServiceDefinition(ctx, actor, workID, created.ServiceID, 1, raw(), "bad-update")
	if err != nil {
		t.Fatal(err)
	}
	operation := process(failed, "failed")
	if operation.ErrorJSON == nil || !strings.Contains(*operation.ErrorJSON, "SERVICE_START_FAILED") {
		t.Fatal("startup classification", operation.ErrorJSON)
	}
	record, err := a.Store.Service(ctx, workID, created.ServiceID, false)
	if err != nil || record.DesiredRevision != 2 || record.AppliedRevision == nil || *record.AppliedRevision != 1 || record.ObservedState != "failed" {
		t.Fatal("lost applied history", record, err)
	}
	input["command"] = "node"
	recovered, err := a.acceptServiceDefinition(ctx, actor, workID, created.ServiceID, 2, raw(), "recover-update")
	if err != nil {
		t.Fatal(err)
	}
	process(recovered, "succeeded")
	count(5)
	disable, err := a.acceptServiceAction(ctx, actor, workID, created.ServiceID, "stop", "disable")
	if err != nil {
		t.Fatal(err)
	}
	process(disable, "succeeded")
	view, _, err = a.inspectServiceRuntime(ctx, workID, created.ServiceID)
	if err != nil || view == nil || view.State.Running {
		t.Fatal("disable not confirmed", err)
	}
	workAction("stop", "work-stop-disabled")
	workAction("start", "work-start-disabled")
	view, _, err = a.inspectServiceRuntime(ctx, workID, created.ServiceID)
	if err != nil || view == nil || view.State.Running {
		t.Fatal("Work start restored disabled service", err)
	}
	if _, err := a.acceptServiceAction(ctx, actor, workID, created.ServiceID, "restart", "disabled-restart"); err == nil {
		t.Fatal("disabled service restarted")
	}
	enable, err := a.acceptServiceAction(ctx, actor, workID, created.ServiceID, "start", "enable")
	if err != nil {
		t.Fatal(err)
	}
	process(enable, "succeeded")
	count(6)
	options := a.options
	if err := a.Close(ctx); err != nil {
		t.Fatal("Core shutdown with service", err)
	}
	a, err = New(ctx, options)
	if err != nil {
		t.Fatal("Core service recovery", err)
	}
	t.Cleanup(func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		if err := a.Close(closeCtx); err != nil {
			t.Error(err)
		}
	})
	if _, err := a.Listen(ListenAddress{Host: "127.0.0.1", Port: 0}); err != nil {
		t.Fatal(err)
	}
	if status := a.Status(); !status.Ready {
		t.Fatal("reopened Core did not recover", status)
	}
	count(7)
	// An externally removed, previously confirmed instance can be recreated.
	// A missing instance whose create was never confirmed must remain unknown.
	func() {
		value, _ := a.workLocks.LoadOrStore(workID, &sync.Mutex{})
		lock := value.(*sync.Mutex)
		lock.Lock()
		defer lock.Unlock()
		view, _, err = a.inspectServiceRuntime(ctx, workID, created.ServiceID)
		if err != nil || view == nil {
			t.Fatal(err)
		}
		missingID := view.ID
		if _, err := a.dockerRuntime.StopContainer(ctx, serviceContainerIdentity(workID, created.ServiceID, 0), 1); err != nil {
			t.Fatal(err)
		}
		if err := a.dockerRuntime.RemoveContainer(ctx, serviceContainerIdentity(workID, created.ServiceID, 0)); err != nil {
			t.Fatal(err)
		}
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			_, err := tx.Exec(`UPDATE service_runtime_bindings SET container_id=NULL WHERE work_id=? AND service_id=?`, workID, created.ServiceID)
			return err
		}); err != nil {
			t.Fatal(err)
		}
		if err := a.stopServiceRuntime(ctx, workID, created.ServiceID, true); !errors.Is(err, dockerengine.ErrStateUnknown) {
			t.Fatal("unanswered create was released", err)
		}
		quotaBefore, err := a.Store.QuotaReservation(ctx, workID, "service", created.ServiceID)
		if err != nil || quotaBefore.OccupiedCPUMillis == 0 {
			t.Fatal("unknown create released occupation", quotaBefore, err)
		}
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			_, err := tx.Exec(`UPDATE service_runtime_bindings SET container_id=? WHERE work_id=? AND service_id=?`, missingID, workID, created.ServiceID)
			return err
		}); err != nil {
			t.Fatal(err)
		}
	}()
	for deadline := time.Now().Add(15 * time.Second); ; {
		current, err := a.Store.Service(ctx, workID, created.ServiceID, false)
		view, _, err = a.inspectServiceRuntime(ctx, workID, created.ServiceID)
		inspectErr := err
		if err == nil && inspectErr == nil && current.ObservedState == "ready" && view != nil && view.State.Running {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("missing confirmed service did not recover", current, err, inspectErr)
		}
		time.Sleep(100 * time.Millisecond)
	}
	count(8)
	removed, err := a.acceptServiceAction(ctx, actor, workID, created.ServiceID, "remove", "remove")
	if err != nil {
		t.Fatal(err)
	}
	process(removed, "succeeded")
	view, _, err = a.inspectServiceRuntime(ctx, workID, created.ServiceID)
	if err != nil || view != nil {
		t.Fatal("remove left instance", err)
	}
	if _, err := a.Store.Service(ctx, workID, created.ServiceID, false); err != corestore.ErrNotFound {
		t.Fatal("removed service visible", err)
	}
	workspace, err := a.dockerRuntime.EnsureVolume(ctx, workID, "work-workspace")
	if err != nil || workspace.Name == "" {
		t.Fatal("remove lost workspace", err)
	}
	quota, err := a.Store.QuotaReservation(ctx, workID, "service", created.ServiceID)
	if err != nil || quota.OccupiedCPUMillis != 0 || quota.DesiredCPUMillis != 0 || quota.ServiceSlots != 0 {
		t.Fatal("remove kept quota", quota, err)
	}
}
