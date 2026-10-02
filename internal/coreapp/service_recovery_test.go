package coreapp

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"piwork/internal/corestore"
)

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
