package coreapp

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/moby/moby/api/types/container"
	"piwork/internal/corestore"
)

func TestObservedServiceFailureDistinguishesExitAndMissing(t *testing.T) {
	for _, code := range []int{0, 7} {
		failure := observedServiceFailure(&container.InspectResponse{State: &container.State{Status: "exited", ExitCode: code}})
		if failure == nil || failure.Code != "SERVICE_EXITED" || failure.Stage != "service-recovery" || failure.ExitCode == nil || *failure.ExitCode != code {
			t.Fatalf("lost confirmed exit %d: %+v", code, failure)
		}
	}
	missing := observedServiceFailure(nil)
	if missing == nil || missing.Code != "SERVICE_INSTANCE_MISSING" || missing.ExitCode != nil {
		t.Fatalf("missing container misclassified: %+v", missing)
	}
	if got := observedServiceFailure(&container.InspectResponse{State: &container.State{Status: "created"}}); got != nil {
		t.Fatalf("unstarted container has no confirmed exit: %+v", got)
	}
}

func TestServiceRecoveryRetainsSafeExitCodeAndOriginalOperation(t *testing.T) {
	a, actor, workID := serviceAcceptFixture(t)
	ctx := context.Background()
	accepted, err := a.acceptServiceDefinition(ctx, actor, workID, "", 0, serviceRaw("exit-check", 250), "exit-check")
	if err != nil {
		t.Fatal(err)
	}
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE operations SET state='succeeded' WHERE id=?`, accepted.OperationID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	before, err := a.Store.Operation(ctx, accepted.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	exit := 0
	target := serviceTarget{WorkID: workID, ServiceID: accepted.ServiceID, Control: work.ControlVersion, Revision: 1, Enabled: true}
	if err := a.serviceFailure(ctx, target, &serviceRuntimeError{Code: "SERVICE_EXITED", Stage: "service-recovery", ExitCode: &exit}, false); err != nil {
		t.Fatal(err)
	}
	service, err := a.Store.Service(ctx, workID, accepted.ServiceID, false)
	if err != nil {
		t.Fatal(err)
	}
	diagnostic, ok := safeServiceDiagnostic(service.LastErrorJSON, accepted.ServiceID).(map[string]any)
	if !ok || diagnostic["code"] != "SERVICE_EXITED" || diagnostic["exitCode"] != 0 || diagnostic["stage"] != "service-recovery" {
		t.Fatalf("exit diagnosis lost: %v", diagnostic)
	}
	rpc, err := rpcServiceView(publicServiceView{WorkID: workID, ServiceID: accepted.ServiceID, LastError: diagnostic})
	if err != nil || rpc.LastError == nil || rpc.LastError.Code != "SERVICE_EXITED" || rpc.LastError.CorrelationId != "" || rpc.LastError.ExitCode == nil || *rpc.LastError.ExitCode != 0 || rpc.LastError.Stage == nil || *rpc.LastError.Stage != "service-recovery" {
		t.Fatalf("RPC lost cause or invented correlation: %+v %v", rpc, err)
	}
	after, err := a.Store.Operation(ctx, accepted.OperationID)
	if err != nil || after.State != before.State || after.ErrorJSON != nil {
		t.Fatalf("recovery changed original operation: %+v %v", after, err)
	}
	exit = 7
	if err := a.serviceFailure(ctx, target, &serviceRuntimeError{Code: "SERVICE_EXITED", Stage: "service-readiness", ExitCode: &exit}, false); err != nil {
		t.Fatal(err)
	}
	service, err = a.Store.Service(ctx, workID, accepted.ServiceID, false)
	if err != nil {
		t.Fatal(err)
	}
	diagnostic = safeServiceDiagnostic(service.LastErrorJSON, accepted.ServiceID).(map[string]any)
	if diagnostic["code"] != "SERVICE_EXITED" || diagnostic["exitCode"] != 7 || diagnostic["stage"] != "service-readiness" {
		t.Fatalf("readiness diagnosis lost: %v", diagnostic)
	}
	if err := a.serviceFailure(ctx, target, errors.New("private Docker failure"), true); err != nil {
		t.Fatal(err)
	}
	service, err = a.Store.Service(ctx, workID, accepted.ServiceID, false)
	if err != nil {
		t.Fatal(err)
	}
	diagnostic = safeServiceDiagnostic(service.LastErrorJSON, accepted.ServiceID).(map[string]any)
	if diagnostic["code"] != "DOCKER_UNAVAILABLE" || diagnostic["exitCode"] != nil || service.ObservedState != "unknown" {
		t.Fatalf("unknown Docker state misclassified: %v", diagnostic)
	}
	cause, ok := diagnostic["cause"].(map[string]any)
	if !ok || cause["code"] != "SERVICE_EXITED" || cause["exitCode"] != 7 {
		t.Fatalf("runtime uncertainty erased the original cause: %v", diagnostic)
	}
	rpc, err = rpcServiceView(publicServiceView{WorkID: workID, ServiceID: accepted.ServiceID, LastError: diagnostic})
	if err != nil || rpc.LastError == nil || rpc.LastError.Cause == nil || rpc.LastError.Cause.GetExitCode() != 7 {
		t.Fatalf("RPC lost original cause: %+v %v", rpc, err)
	}
}

func TestServiceWorkObservationAccountsForEveryCurrentService(t *testing.T) {
	a, actor, workID := serviceAcceptFixture(t)
	ctx := context.Background()
	first, err := a.acceptServiceDefinition(ctx, actor, workID, "", 0, serviceRaw("first-app", 250), "first-app")
	if err != nil {
		t.Fatal(err)
	}
	second, err := a.acceptServiceDefinition(ctx, actor, workID, "", 0, serviceRaw("second-app", 250), "second-app")
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE works SET desired_state='running',observed_state='ready' WHERE id=?`, workID); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,created_at,updated_at) VALUES(?,1,'agent-current','ready',0,?,?)`, workID, packageNow(), packageNow()); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE service_heads SET observed_state='failed',last_error_json='{"code":"SERVICE_EXITED","stage":"service-recovery","exitCode":0}' WHERE work_id=?`, workID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	check := func(want string) {
		t.Helper()
		if err := a.updateServiceWorkObservation(ctx, workID); err != nil {
			t.Fatal(err)
		}
		work, err := a.Store.Work(ctx, workID, false)
		if err != nil || work.ObservedState != want {
			t.Fatalf("Work state: got %s, want %s (%v)", work.ObservedState, want, err)
		}
	}
	check("degraded")
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE service_heads SET observed_state='ready',last_error_json=NULL WHERE work_id=? AND service_id=?`, workID, first.ServiceID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	check("degraded")
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE service_heads SET enabled=0,observed_state='disabled',last_error_json=NULL WHERE work_id=? AND service_id=?`, workID, second.ServiceID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	check("ready")
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE service_revisions SET definition_json=json_set(definition_json,'$.required',json('true')) WHERE work_id=? AND service_id=?`, workID, first.ServiceID); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE service_heads SET observed_state='failed' WHERE work_id=? AND service_id=?`, workID, first.ServiceID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	check("failed")
}

func TestStaleServiceRecoveryCannotOverwriteNewTarget(t *testing.T) {
	a, actor, workID := serviceAcceptFixture(t)
	ctx := context.Background()
	accepted, err := a.acceptServiceDefinition(ctx, actor, workID, "", 0, serviceRaw("fenced-app", 250), "fenced-app")
	if err != nil {
		t.Fatal(err)
	}
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil {
		t.Fatal(err)
	}
	target := serviceTarget{WorkID: workID, ServiceID: accepted.ServiceID, Control: work.ControlVersion, Revision: 1, Enabled: true}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE works SET control_version=control_version+1 WHERE id=?`, workID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	exit := 7
	if err := a.serviceFailure(ctx, target, &serviceRuntimeError{Code: "SERVICE_EXITED", Stage: "service-recovery", ExitCode: &exit}, false); !errors.Is(err, errWorkSuperseded) {
		t.Fatalf("stale recovery was not fenced: %v", err)
	}
	service, err := a.Store.Service(ctx, workID, accepted.ServiceID, false)
	if err != nil || service.LastErrorJSON != nil {
		t.Fatalf("stale recovery overwrote newer target: %+v %v", service, err)
	}
}

func TestAutomaticServiceRecoveryPreservesOriginalFailure(t *testing.T) {
	a, actor, workID := serviceAcceptFixture(t)
	ctx := context.Background()
	accepted, err := a.acceptServiceDefinition(ctx, actor, workID, "", 0, serviceRaw("recover-app", 250), "recover-app")
	if err != nil {
		t.Fatal(err)
	}
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil {
		t.Fatal(err)
	}
	const original = `{"code":"SERVICE_EXITED","stage":"service-recovery","exitCode":0}`
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE service_heads SET observed_state='starting',last_error_json=? WHERE work_id=? AND service_id=?`, original, workID, accepted.ServiceID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	target := serviceTarget{WorkID: workID, ServiceID: accepted.ServiceID, Control: work.ControlVersion, Revision: 1, Enabled: true}
	if err := a.serviceFailure(ctx, target, &serviceRuntimeError{Code: "SERVICE_START_FAILED", Stage: "service-start"}, false); err != nil {
		t.Fatal(err)
	}
	service, err := a.Store.Service(ctx, workID, accepted.ServiceID, false)
	if err != nil || service.ObservedState != "failed" || service.LastErrorJSON == nil || *service.LastErrorJSON != original {
		t.Fatalf("automatic recovery replaced original cause: %+v %v", service, err)
	}
}

func TestServiceRecoveryBudgetPersistsAcrossCoreRestart(t *testing.T) {
	a, actor, workID := serviceAcceptFixture(t)
	ctx := context.Background()
	service, err := a.acceptServiceDefinition(ctx, actor, workID, "", 0, serviceRaw("counter", 250), "counter")
	if err != nil {
		t.Fatal(err)
	}
	binding := corestore.ServiceRuntimeBinding{WorkID: workID, ServiceID: service.ServiceID, Revision: 1}
	now := time.Now().UTC()
	for index, delay := range []time.Duration{time.Second, 5 * time.Second, 15 * time.Second} {
		var run bool
		binding, run = nextServiceRecovery(binding, now, false, "bounded")
		if run || binding.NextRetryAt == nil {
			t.Fatal("retry was not scheduled", index)
		}
		due, err := time.Parse(time.RFC3339Nano, *binding.NextRetryAt)
		if err != nil || due.Sub(now) != delay {
			t.Fatal("incorrect recovery delay", due.Sub(now), delay, err)
		}
		before, run := nextServiceRecovery(binding, due.Add(-time.Millisecond), false, "bounded")
		if run || before.RecoveryCount != int64(index) {
			t.Fatal("early retry consumed budget")
		}
		binding, run = nextServiceRecovery(binding, due, false, "bounded")
		if !run || binding.RecoveryCount != int64(index+1) {
			t.Fatal("retry did not consume budget", binding)
		}
		now = due
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error { return corestore.PutServiceRuntimeBinding(tx, binding) }); err != nil {
		t.Fatal(err)
	}
	directory := a.options.DataDirectory
	if err := a.Close(ctx); err != nil {
		t.Fatal(err)
	}
	store, err := corestore.Open(ctx, corestore.Options{Directory: directory})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		binding, err = corestore.ReadServiceRuntimeBinding(tx, workID, service.ServiceID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	binding, run := nextServiceRecovery(binding, now.Add(24*time.Hour), false, "bounded")
	if run || binding.RecoveryCount != 3 || binding.NextRetryAt != nil {
		t.Fatal("restart or elapsed time replenished budget")
	}
	since := now.Format(time.RFC3339Nano)
	binding.ReadySince = &since
	binding, run = nextServiceRecovery(binding, now.Add(10*time.Minute-time.Millisecond), true, "bounded")
	if run || binding.RecoveryCount != 3 {
		t.Fatal("budget reset before continuous ready interval")
	}
	binding, _ = nextServiceRecovery(binding, now.Add(10*time.Minute), true, "bounded")
	if binding.RecoveryCount != 0 || binding.RecoveryWindowStartedAt != nil {
		t.Fatal("stable runtime did not reset budget")
	}
	binding, run = nextServiceRecovery(binding, now, false, "never")
	if run || binding.NextRetryAt != nil {
		t.Fatal("restartPolicy never scheduled recovery")
	}
}

func TestServiceStartupPreservesPendingRecoveryBudget(t *testing.T) {
	a, actor, workID := serviceAcceptFixture(t)
	ctx := context.Background()
	accepted, err := a.acceptServiceDefinition(ctx, actor, workID, "", 0, serviceRaw("counter", 250), "startup-counter")
	if err != nil {
		t.Fatal(err)
	}
	due := time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano)
	binding := corestore.ServiceRuntimeBinding{WorkID: workID, ServiceID: accepted.ServiceID, Revision: 1, RecoveryCount: 2, NextRetryAt: &due}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE works SET desired_state='running',observed_state='starting' WHERE id=?`, workID); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE service_heads SET observed_state='failed',last_error_json='{"code":"SERVICE_START_FAILED"}' WHERE work_id=?`, workID); err != nil {
			return err
		}
		return corestore.PutServiceRuntimeBinding(tx, binding)
	}); err != nil {
		t.Fatal(err)
	}
	state, err := a.restoreWorkServicesLocked(ctx, workID)
	if err != nil || state != "degraded" {
		t.Fatal("pending recovery started eagerly", state, err)
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		binding, err = corestore.ReadServiceRuntimeBinding(tx, workID, accepted.ServiceID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if binding.RecoveryCount != 2 || binding.NextRetryAt == nil || *binding.NextRetryAt != due {
		t.Fatal("startup changed pending retry budget", binding)
	}
}

func TestServiceExplicitRetryResetsBudgetWithoutChangingDefinition(t *testing.T) {
	a, actor, workID := serviceAcceptFixture(t)
	ctx := context.Background()
	accepted, err := a.acceptServiceDefinition(ctx, actor, workID, "", 0, serviceRaw("counter", 250), "retry-counter")
	if err != nil {
		t.Fatal(err)
	}
	before, err := a.Store.Service(ctx, workID, accepted.ServiceID, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.PutServiceRuntimeBinding(tx, corestore.ServiceRuntimeBinding{WorkID: workID, ServiceID: accepted.ServiceID, Revision: 1, RecoveryCount: 3})
	}); err != nil {
		t.Fatal(err)
	}
	retry, err := a.acceptServiceAction(ctx, actor, workID, accepted.ServiceID, "retry", "explicit-retry")
	if err != nil {
		t.Fatal(err)
	}
	replay, err := a.acceptServiceAction(ctx, actor, workID, accepted.ServiceID, "retry", "explicit-retry")
	if err != nil || !replay.Reused || replay.OperationID != retry.OperationID {
		t.Fatal("retry lost idempotency", replay, err)
	}
	var binding corestore.ServiceRuntimeBinding
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		binding, err = corestore.ReadServiceRuntimeBinding(tx, workID, accepted.ServiceID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	after, err := a.Store.Service(ctx, workID, accepted.ServiceID, false)
	if err != nil || binding.RecoveryCount != 0 || binding.NextRetryAt != nil || before.DefinitionJSON != after.DefinitionJSON || before.DesiredRevision != after.DesiredRevision {
		t.Fatal("explicit retry changed definition or failed to reset budget", binding, err)
	}
}
