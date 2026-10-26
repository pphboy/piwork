//go:build integration

package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/internaltls"
)

func TestNativeTemporaryCommandOutcomeAndCleanup(t *testing.T) {
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
	for _, code := range []int{0, 7} {
		owner := corestore.TemporaryRunOwner{WorkID: workID, RunID: fmt.Sprintf("run-probe-%d", code), Generation: generation, InstanceID: instance}
		lease, err := a.Store.OpenTemporaryRunLease(ctx, owner, packageNow())
		if err != nil {
			t.Fatal(err)
		}
		definition, _ := json.Marshal(map[string]any{"name": fmt.Sprintf("probe-%d", code), "image": map[string]string{"reference": a.options.Initialization.Runtime.AgentImage}, "command": "node", "args": []string{"-e", fmt.Sprintf("console.log('probe-output-%d sk-fixture-probe Authorization: Bearer fixture-token /private/fixture');setTimeout(()=>process.exit(%d),150)", code, code)}, "workingDirectory": "/"})
		admission := temporaryServiceAdmission{Owner: owner, LeaseID: lease.LeaseID, Mode: "once"}
		accepted, err := a.acceptServiceDefinitionScoped(ctx, serviceActor{Runtime: &scope}, workID, "", 0, definition, fmt.Sprintf("probe-%d", code), &admission)
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
		var record corestore.TemporaryServiceRecord
		deadline := time.Now().Add(15 * time.Second)
		for {
			if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
				var err error
				record, _, err = corestore.ReadTemporaryServiceTx(tx, workID, accepted.ServiceID)
				return err
			}); err != nil {
				t.Fatal(err)
			}
			_ = a.observeTemporaryCommand(ctx, record)
			op, err = a.Store.Operation(ctx, accepted.OperationID)
			if err != nil {
				t.Fatal(err)
			}
			if op.State == "succeeded" || op.State == "failed" {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("one-time result remained unknown", op.State)
			}
			time.Sleep(100 * time.Millisecond)
		}
		want := "succeeded"
		if code != 0 {
			want = "failed"
		}
		if op.State != want {
			t.Fatal("incorrect command outcome", op.State)
		}
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			var err error
			record, _, err = corestore.ReadTemporaryServiceTx(tx, workID, accepted.ServiceID)
			return err
		}); err != nil {
			t.Fatal(err)
		}
		if record.ExitCode == nil || *record.ExitCode != code {
			t.Fatal("incorrect original exit code")
		}
		status, serviceView := packageHTTPCall(t, base, "/api/v1/works/"+workID+"/services/"+accepted.ServiceID, "GET", auth, nil)
		temporary, _ := serviceView["temporary"].(map[string]any)
		if status != 200 || temporary["state"] != "completed" || temporary["exitCode"] != float64(code) {
			t.Fatal("one-time result is not readable", status, serviceView)
		}
		status, logs := packageHTTPCall(t, base, "/api/v1/works/"+workID+"/services/"+accepted.ServiceID+"/logs?tailLines=100", "GET", auth, nil)
		if status != 200 || !strings.Contains(logs["text"].(string), fmt.Sprintf("probe-output-%d", code)) {
			t.Fatal("original command output was not readable", status, logs)
		}
		status, workView := packageHTTPCall(t, base, "/api/v1/works/"+workID, "GET", auth, nil)
		if status != 200 || workView["observedState"] != "ready" {
			t.Fatal("temporary command degraded Work", status, workView)
		}
		if err := a.closeTemporaryRunAndRequestCleanup(ctx, owner, "run-succeeded"); err != nil {
			t.Fatal(err)
		}
		if err := a.cleanupTemporaryService(ctx, record); err != nil {
			t.Fatal("cleanup failed", err)
		}
		status, cleanupView := packageHTTPCall(t, base, "/api/v1/works/"+workID+"/temporary-cleanups/"+accepted.ServiceID, "GET", auth, nil)
		if status != 200 || cleanupView["state"] != "completed" || cleanupView["operationId"] == "" {
			t.Fatal("cleanup history unavailable", status, cleanupView)
		}
		view, _, err := a.inspectServiceRuntime(ctx, workID, accepted.ServiceID)
		if err != nil || view != nil {
			t.Fatal("exact instance remained after cleanup", err)
		}
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			cleanup, found, err := corestore.ReadTemporaryCleanupTx(tx, workID, accepted.ServiceID)
			if err != nil {
				return err
			}
			if !found || cleanup.State != "completed" || cleanup.RunID != owner.RunID || cleanup.CreateOperationID != accepted.OperationID {
				t.Fatal("cleanup association missing", cleanup)
			}
			raw, _ := json.Marshal(cleanup)
			for _, forbidden := range []string{lease.LeaseID, "setTimeout", "probe-output", "sk-fixture-probe", "Authorization", "fixture-token", "/private/fixture"} {
				if strings.Contains(string(raw), forbidden) {
					t.Fatal("private command, output, or lease leaked into safe cleanup log")
				}
			}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestNativeTemporaryServiceCleanupAfterRunCancellation(t *testing.T) {
	a, base, auth, workID, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + workID
	status, session := packageHTTPCall(t, base, path+"/sessions", "POST", auth, map[string]string{"idempotencyKey": "cancel-temp-session"})
	if status != 201 {
		t.Fatal(status, session)
	}
	status, submitted := packageHTTPCall(t, base, path+"/runs", "POST", auth, map[string]string{"sessionId": session["sessionId"].(string), "submissionKey": "cancel-temp-run", "prompt": "wait for abort"})
	if status != 202 {
		t.Fatal(status, submitted)
	}
	runID := submitted["run"].(map[string]any)["runId"].(string)
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil {
		t.Fatal(err)
	}
	generation, instance, err := a.selectAgentGeneration(ctx, work)
	if err != nil {
		t.Fatal(err)
	}
	scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: workID, Generation: generation, InstanceID: instance}
	owner := corestore.TemporaryRunOwner{WorkID: workID, RunID: runID, Generation: generation, InstanceID: instance}
	lease, err := a.Store.OpenTemporaryRunLease(ctx, owner, packageNow())
	if err != nil {
		t.Fatal(err)
	}
	definition, _ := json.Marshal(map[string]any{"name": "temporary-listener", "image": map[string]string{"reference": a.options.Initialization.Runtime.AgentImage}, "command": "node", "args": []string{"-e", "setInterval(()=>{},1000)"}, "workingDirectory": "/"})
	admission := temporaryServiceAdmission{Owner: owner, LeaseID: lease.LeaseID, Mode: "listener"}
	accepted, err := a.acceptServiceDefinitionScoped(ctx, serviceActor{Runtime: &scope}, workID, "", 0, definition, "cancel-temp-create", &admission)
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
	op, err = a.Store.Operation(ctx, accepted.OperationID)
	if err != nil || op.State != "succeeded" {
		t.Fatal("temporary listener not ready", op.State, err)
	}
	status, result := packageHTTPCall(t, base, path+"/runs/"+runID+"/cancel", "POST", auth, map[string]string{"idempotencyKey": "cancel-temp"})
	if status != 200 {
		t.Fatal(status, result)
	}
	deadline := time.Now().Add(35 * time.Second)
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
			if cleanup.Trigger != "run-cancelled" || cleanup.RunID != runID {
				t.Fatal("cleanup lost original Run", cleanup)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("cancelled Run cleanup not confirmed", cleanup)
		}
		time.Sleep(100 * time.Millisecond)
	}
	status, run := packageHTTPCall(t, base, path+"/runs/"+runID, "GET", auth, nil)
	if status != 200 || run["state"] != float64(6) {
		t.Fatal("cleanup changed the cancelled Run", status, run)
	}
	view, _, err := a.inspectServiceRuntime(ctx, workID, accepted.ServiceID)
	if err != nil || view != nil {
		t.Fatal("cancelled Run left its container", err)
	}
	status, current := packageHTTPCall(t, base, path, "GET", auth, nil)
	if status != 200 || current["observedState"] != "ready" {
		t.Fatal("cleanup degraded Work", status, current)
	}
}

func TestNativeTemporaryServiceCleanupAfterAgentCrash(t *testing.T) {
	a, base, auth, workID, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + workID
	status, session := packageHTTPCall(t, base, path+"/sessions", "POST", auth, map[string]string{"idempotencyKey": "crash-temp-session"})
	if status != 201 {
		t.Fatal(status, session)
	}
	status, submitted := packageHTTPCall(t, base, path+"/runs", "POST", auth, map[string]string{"sessionId": session["sessionId"].(string), "submissionKey": "crash-temp-run", "prompt": "wait for abort"})
	if status != 202 {
		t.Fatal(status, submitted)
	}
	runID := submitted["run"].(map[string]any)["runId"].(string)
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil {
		t.Fatal(err)
	}
	generation, instance, err := a.selectAgentGeneration(ctx, work)
	if err != nil {
		t.Fatal(err)
	}
	scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: workID, Generation: generation, InstanceID: instance}
	owner := corestore.TemporaryRunOwner{WorkID: workID, RunID: runID, Generation: generation, InstanceID: instance}
	lease, err := a.Store.OpenTemporaryRunLease(ctx, owner, packageNow())
	if err != nil {
		t.Fatal(err)
	}
	definition, _ := json.Marshal(map[string]any{"name": "crash-listener", "image": map[string]string{"reference": a.options.Initialization.Runtime.AgentImage}, "command": "node", "args": []string{"-e", "setInterval(()=>{},1000)"}, "workingDirectory": "/"})
	admission := temporaryServiceAdmission{Owner: owner, LeaseID: lease.LeaseID, Mode: "listener"}
	accepted, err := a.acceptServiceDefinitionScoped(ctx, serviceActor{Runtime: &scope}, workID, "", 0, definition, "crash-temp-create", &admission)
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
	agent := dockerengine.ContainerIdentity{WorkID: workID, Kind: "agent", LogicalID: "agentd"}
	if err := a.dockerRuntime.KillContainer(ctx, agent); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(50 * time.Second)
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
			if cleanup.Trigger != "run-interrupted" && cleanup.Trigger != "agent-replaced" {
				t.Fatal("crash cleanup has incorrect trigger", cleanup.Trigger)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("Agent crash cleanup not confirmed", cleanup)
		}
		time.Sleep(100 * time.Millisecond)
	}
	view, _, err := a.inspectServiceRuntime(ctx, workID, accepted.ServiceID)
	if err != nil || view != nil {
		t.Fatal("Agent crash left the temporary container", err)
	}
}

func TestNativeWorkDeleteCleansTemporaryAndRetainsSafeHistory(t *testing.T) {
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
	owner := corestore.TemporaryRunOwner{WorkID: workID, RunID: "run-work-delete", Generation: generation, InstanceID: instance}
	lease, err := a.Store.OpenTemporaryRunLease(ctx, owner, packageNow())
	if err != nil {
		t.Fatal(err)
	}
	definition, _ := json.Marshal(map[string]any{"name": "delete-listener", "image": map[string]string{"reference": a.options.Initialization.Runtime.AgentImage}, "command": "node", "args": []string{"-e", "setInterval(()=>{},1000)"}, "workingDirectory": "/"})
	admission := temporaryServiceAdmission{Owner: owner, LeaseID: lease.LeaseID, Mode: "listener"}
	created, err := a.acceptServiceDefinitionScoped(ctx, serviceActor{Runtime: &scope}, workID, "", 0, definition, "delete-temp", &admission)
	if err != nil {
		t.Fatal(err)
	}
	op, err := a.Store.Operation(ctx, created.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.processServiceOperation(ctx, op); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/works/" + workID
	status, deleted := packageHTTPCall(t, base, path+"/delete", "POST", auth, map[string]string{"idempotencyKey": "delete-with-temp"})
	if status != 202 {
		t.Fatal("Work delete rejected", status, deleted)
	}
	waitWorkOperation(t, ctx, a, deleted["operationId"].(string))
	status, cleanup := packageHTTPCall(t, base, path+"/temporary-cleanups/"+created.ServiceID, "GET", auth, nil)
	if status != 200 || cleanup["state"] != "completed" || cleanup["trigger"] != "work-delete" || cleanup["runId"] != owner.RunID {
		t.Fatal("deleted Work lost its cleanup history", status, cleanup)
	}
	view, _, err := a.inspectServiceRuntime(ctx, workID, created.ServiceID)
	if err != nil || view != nil {
		t.Fatal("Work delete left the temporary container", err)
	}
}

func TestNativeTemporaryCleanupRecoversAfterLimitedCoreShutdown(t *testing.T) {
	a, _, _, workID, ctx := nativeApplyFixture(t)
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil {
		t.Fatal(err)
	}
	generation, instance, err := a.selectAgentGeneration(ctx, work)
	if err != nil {
		t.Fatal(err)
	}
	scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: workID, Generation: generation, InstanceID: instance}
	owner := corestore.TemporaryRunOwner{WorkID: workID, RunID: "run-limited-shutdown", Generation: generation, InstanceID: instance}
	lease, err := a.Store.OpenTemporaryRunLease(ctx, owner, packageNow())
	if err != nil {
		t.Fatal(err)
	}
	definition, _ := json.Marshal(map[string]any{"name": "shutdown-listener", "image": map[string]string{"reference": a.options.Initialization.Runtime.AgentImage}, "command": "node", "args": []string{"-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"}, "workingDirectory": "/"})
	admission := temporaryServiceAdmission{Owner: owner, LeaseID: lease.LeaseID, Mode: "listener"}
	created, err := a.acceptServiceDefinitionScoped(ctx, serviceActor{Runtime: &scope}, workID, "", 0, definition, "shutdown-temp", &admission)
	if err != nil {
		t.Fatal(err)
	}
	op, err := a.Store.Operation(ctx, created.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.processServiceOperation(ctx, op); err != nil {
		t.Fatal(err)
	}
	a.options.WorkDrainTimeout = 100 * time.Millisecond
	a.options.WorkStopTimeout = 100 * time.Millisecond
	a.options.ShutdownTimeout = 300 * time.Millisecond
	started := time.Now()
	closeErr := a.Close(context.Background())
	if time.Since(started) > 2*time.Second {
		t.Fatal("Core shutdown exceeded its restricted budget")
	}
	if closeErr == nil {
		t.Log("restricted shutdown completed within budget")
	} else {
		t.Log("restricted shutdown reported unconfirmed work")
	}
	waitForShutdownStoreRelease(t, a.options.DataDirectory)
	options := a.options
	options.WorkDrainTimeout = 30 * time.Second
	options.WorkStopTimeout = 10 * time.Second
	options.ShutdownTimeout = 45 * time.Second
	next, _, _ := appFixture(t, options)
	deadline := time.Now().Add(50 * time.Second)
	for {
		var cleanup corestore.TemporaryCleanupRecord
		var found bool
		err := next.Store.Read(ctx, func(tx *sql.Tx) error {
			var err error
			cleanup, found, err = corestore.ReadTemporaryCleanupTx(tx, workID, created.ServiceID)
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
		if found && cleanup.State == "completed" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("temporary cleanup did not recover after restricted shutdown", cleanup)
		}
		time.Sleep(100 * time.Millisecond)
	}
	view, _, err := next.inspectServiceRuntime(ctx, workID, created.ServiceID)
	if err != nil || view != nil {
		t.Fatal("temporary listener remained after Core recovery", err)
	}
}

func TestNativeWorkStopCleansTemporaryAndPreservesOrdinaryServiceAndWorkspace(t *testing.T) {
	if testing.Short() {
		t.Skip("Docker lifecycle test")
	}
	if image := os.Getenv("PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE"); image == "" {
		t.Fatal("file helper fixture image required")
	}
	if image := os.Getenv("PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE"); image == "" {
		t.Fatal("snapshot helper fixture image required")
	}
	a, base, auth, workID, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + workID
	status, ordinary := packageHTTPCall(t, base, path+"/services", "POST", auth, map[string]any{"definition": map[string]any{"name": "sb-probe3", "image": map[string]string{"reference": a.options.Initialization.Runtime.AgentImage}, "command": "node", "args": []string{"-e", "setInterval(()=>{},1000)"}, "workingDirectory": "/", "restartPolicy": "never"}, "idempotencyKey": "ordinary-service"})
	if status != 202 {
		t.Fatal(status, ordinary)
	}
	waitWorkOperation(t, ctx, a, ordinary["operationId"].(string))
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil {
		t.Fatal(err)
	}
	generation, instance, err := a.selectAgentGeneration(ctx, work)
	if err != nil {
		t.Fatal(err)
	}
	scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: workID, Generation: generation, InstanceID: instance}
	owner := corestore.TemporaryRunOwner{WorkID: workID, RunID: "run-work-stop-00000001", Generation: generation, InstanceID: instance}
	lease, err := a.Store.OpenTemporaryRunLease(ctx, owner, packageNow())
	if err != nil {
		t.Fatal(err)
	}
	definition, _ := json.Marshal(map[string]any{"name": "stop-listener", "image": map[string]string{"reference": a.options.Initialization.Runtime.AgentImage}, "command": "node", "args": []string{"-e", "require('fs').writeFileSync('/var/data/workspace/temporary-proof','workspace preserved');setInterval(()=>{},1000)"}, "workingDirectory": "/var/data/workspace", "mounts": []any{map[string]any{"source": "workspace", "target": "/var/data/workspace", "readOnly": false}}})
	admission := temporaryServiceAdmission{Owner: owner, LeaseID: lease.LeaseID, Mode: "listener"}
	created, err := a.acceptServiceDefinitionScoped(ctx, serviceActor{Runtime: &scope}, workID, "", 0, definition, "stop-temp", &admission)
	if err != nil {
		t.Fatal(err)
	}
	op, err := a.Store.Operation(ctx, created.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.processServiceOperation(ctx, op); err != nil {
		t.Fatal(err)
	}
	status, stopped := packageHTTPCall(t, base, path+"/stop", "POST", auth, map[string]string{"idempotencyKey": "stop-with-temp"})
	if status != 202 {
		t.Fatal(status, stopped)
	}
	waitWorkOperation(t, ctx, a, stopped["operationId"].(string))
	var cleanup corestore.TemporaryCleanupRecord
	var found bool
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		cleanup, found, err = corestore.ReadTemporaryCleanupTx(tx, workID, created.ServiceID)
		return err
	}); err != nil || !found || cleanup.State != "completed" || cleanup.Trigger != "work-stop" {
		t.Fatal("Work Stop skipped temporary cleanup", cleanup, err)
	}
	status, exported := packageHTTPCall(t, base, path+"/exports", "POST", auth, map[string]string{"idempotencyKey": "export-after-temp"})
	if status != 202 {
		t.Fatal("completed cleanup blocked cold export", status, exported)
	}
	waitWorkOperation(t, ctx, a, exported["operationId"].(string))
	var sourcePackage string
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT package_id FROM snapshot_jobs WHERE snapshot_id=?`, exported["snapshotId"]).Scan(&sourcePackage)
	}); err != nil {
		t.Fatal(err)
	}
	status, imported := packageHTTPCall(t, base, "/api/v1/work-imports", "POST", auth, map[string]string{"packageId": sourcePackage, "name": "Imported temporary fixture", "idempotencyKey": "import-after-temp"})
	if status != 202 {
		t.Fatal("cold import rejected", status, imported)
	}
	target := imported["workId"].(string)
	waitWorkOperation(t, ctx, a, imported["operationId"].(string))
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		records, err := corestore.ListTemporaryServicesTx(tx, target, "")
		if err != nil {
			return err
		}
		if len(records) != 0 {
			t.Fatal("import copied live source Run authorization", records)
		}
		var leases int
		if err := tx.QueryRow(`SELECT count(*) FROM control_metadata WHERE key LIKE ?`, "run-temporary-service:lease:"+target+":%").Scan(&leases); err != nil {
			return err
		}
		if leases != 0 {
			t.Fatal("import copied source Run leases", leases)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	importedWork, err := a.Store.Work(ctx, target, false)
	if err != nil || importedWork.DesiredState != "stopped" || importedWork.ObservedState != "stopped" {
		t.Fatal("imported Work did not remain stopped", importedWork, err)
	}
	status, started := packageHTTPCall(t, base, path+"/start", "POST", auth, map[string]string{"idempotencyKey": "restart-after-temp"})
	if status != 202 {
		t.Fatal(status, started)
	}
	waitWorkOperation(t, ctx, a, started["operationId"].(string))
	status, stable := packageHTTPCall(t, base, path+"/services/"+ordinary["serviceId"].(string), "GET", auth, nil)
	if status != 200 || stable["observedState"] != "ready" {
		t.Fatal("ordinary Service did not recover", status, stable)
	}
	if view, _, err := a.inspectServiceRuntime(ctx, workID, created.ServiceID); err != nil || view != nil {
		t.Fatal("temporary Service restarted", err)
	}
	request, err := http.NewRequestWithContext(ctx, "GET", base+path+"/files/temporary-proof", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", auth)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1024))
	if err != nil || response.StatusCode != 200 || string(body) != "workspace preserved" {
		t.Fatal("workspace data was not retained", response.StatusCode, err)
	}
}
