package coreapp

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"piwork/internal/corestore"
)

func offlineCleanupFixture(t *testing.T) (*Application, corestore.TemporaryServiceRecord) {
	t.Helper()
	a, _, work := serviceAcceptFixture(t)
	ctx := context.Background()
	owner := corestore.TemporaryRunOwner{WorkID: work, RunID: "run-offline-00000001", Generation: 1, InstanceID: "agent-offline-000001"}
	lease, err := a.Store.OpenTemporaryRunLease(ctx, owner, packageNow())
	if err != nil {
		t.Fatal(err)
	}
	record := corestore.TemporaryServiceRecord{Version: 1, Owner: owner, ServiceID: "service-offline-000001", CreateOperationID: "operation-create-000001", Mode: "once", State: "accepted", UpdatedAt: packageNow()}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.AcceptTemporaryServiceTx(tx, record, lease.LeaseID); err != nil {
			return err
		}
		limit := int64(10)
		return corestore.ReserveQuota(tx, corestore.QuotaReservation{WorkID: work, SubjectKind: "service", SubjectID: record.ServiceID, ServiceSlots: 1}, corestore.QuotaLimits{CPUMillis: 128000, MemoryBytes: 256 * 1024 * 1024 * 1024, MaxServices: &limit}, corestore.QuotaLimits{CPUMillis: 128000, MemoryBytes: 256 * 1024 * 1024 * 1024, MaxServices: &limit})
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.ensureTemporaryCleanupOperation(ctx, record, "run-cancelled"); err != nil {
		t.Fatal(err)
	}
	a.mu.Lock()
	a.preparation.engineEpoch = 10
	a.preparation.engineOnline = false
	a.preparation.engineContext = nil
	entry := a.preparation.entries["docker"]
	entry.State = "retrying"
	// Keep this confirmed synthetic outage until after the bounded observation.
	entry.retryAt = time.Now().Add(time.Minute)
	entry.Code = preparationCode("DOCKER_UNAVAILABLE")
	a.preparation.entries["docker"] = entry
	a.mu.Unlock()
	return a, record
}
func TestConfirmedEngineOutageAdvancesOriginalCleanupWithoutEffects(t *testing.T) {
	a, record := offlineCleanupFixture(t)
	a.recoveryOnce.Do(func() { a.recoveryWG.Add(1); go a.runtimeRecoveryLoop() })
	deadline := time.Now().Add(4 * time.Second)
	for {
		var cleanup corestore.TemporaryCleanupRecord
		if err := a.Store.Read(context.Background(), func(tx *sql.Tx) error {
			var err error
			cleanup, _, err = corestore.ReadTemporaryCleanupTx(tx, record.Owner.WorkID, record.ServiceID)
			if err != nil {
				return err
			}
			quota, err := corestore.ReadQuotaReservation(tx, record.Owner.WorkID, "service", record.ServiceID)
			if err == nil && quota.ServiceSlots != 1 {
				t.Error("offline observation released capacity")
			}
			return err
		}); err != nil {
			t.Fatal(err)
		}
		if cleanup.State == "pending" && cleanup.ErrorCode == "DOCKER_UNAVAILABLE" {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("original cleanup not observed: state=%s stage=%s code=%s", cleanup.State, cleanup.Stage, cleanup.ErrorCode)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestOfflineCleanupObservationPreservesChangedOwnersAndEngine(t *testing.T) {
	for _, change := range []string{"online", "epoch", "unconfirmed", "operation", "owner", "create", "pending", "completed"} {
		t.Run(change, func(t *testing.T) {
			a, record := offlineCleanupFixture(t)
			ctx := context.Background()
			var original corestore.TemporaryCleanupRecord
			if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
				var err error
				original, _, err = corestore.ReadTemporaryCleanupTx(tx, record.Owner.WorkID, record.ServiceID)
				return err
			}); err != nil {
				t.Fatal(err)
			}
			operationID := original.OperationID
			a.mu.Lock()
			if change == "online" {
				a.preparation.engineOnline = true
			}
			if change == "epoch" {
				a.preparation.engineEpoch++
			}
			if change == "unconfirmed" {
				entry := a.preparation.entries["docker"]
				entry.Code = nil
				a.preparation.entries["docker"] = entry
			}
			a.mu.Unlock()
			if change == "operation" {
				operationID = "operation-replaced-000001"
			}
			if change == "owner" {
				record.Owner.Generation++
			}
			if change == "create" {
				record.CreateOperationID = "operation-replaced-000001"
			}
			expectedState := "requested"
			if change == "pending" || change == "completed" {
				expectedState = change
				if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
					return corestore.AppendTemporaryCleanupEventTx(tx, record.Owner.WorkID, record.ServiceID, change, corestore.TemporaryCleanupEvent{At: packageNow(), Stage: "inspect", Outcome: "succeeded"})
				}); err != nil {
					t.Fatal(err)
				}
			}
			if err := a.observeUnavailableTemporaryCleanup(ctx, 10, record, operationID); err != nil {
				t.Fatal(err)
			}
			if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
				cleanup, _, err := corestore.ReadTemporaryCleanupTx(tx, record.Owner.WorkID, record.ServiceID)
				if err != nil {
					return err
				}
				if cleanup.State != expectedState || cleanup.ErrorCode != "" {
					t.Errorf("changed owner was overwritten: state=%s code=%s", cleanup.State, cleanup.ErrorCode)
				}
				quota, err := corestore.ReadQuotaReservation(tx, record.Owner.WorkID, "service", record.ServiceID)
				if err == nil && quota.ServiceSlots != 1 {
					t.Error("observation released quota")
				}
				return err
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestOfflineCleanupRechecksEngineAfterWaitingForStoreWriter(t *testing.T) {
	a, record := offlineCleanupFixture(t)
	ctx := context.Background()
	var cleanup corestore.TemporaryCleanupRecord
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		cleanup, _, err = corestore.ReadTemporaryCleanupTx(tx, record.Owner.WorkID, record.ServiceID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	held, release, finished := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	go func() { finished <- a.Store.Write(ctx, func(*sql.Tx) error { close(held); <-release; return nil }) }()
	<-held
	observed := make(chan error, 1)
	go func() { observed <- a.observeUnavailableTemporaryCleanup(ctx, 10, record, cleanup.OperationID) }()
	a.mu.Lock()
	a.preparation.engineEpoch++
	a.preparation.engineOnline = true
	a.mu.Unlock()
	close(release)
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	if err := <-observed; err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		current, _, err := corestore.ReadTemporaryCleanupTx(tx, record.Owner.WorkID, record.ServiceID)
		if current.State != "requested" {
			t.Error("stale Engine observation committed")
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
}
