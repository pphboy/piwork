package corestore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestTemporaryCleanupRequestResultIsAtomicAndIdempotent(t *testing.T) {
	store := openTestStore(t, t.TempDir())
	defer store.Close()
	ctx := context.Background()
	owner := TemporaryRunOwner{WorkID: "work-request", RunID: "run-request", Generation: 1, InstanceID: "agent-request"}
	record := TemporaryServiceRecord{Version: 1, Owner: owner, ServiceID: "service-request", CreateOperationID: "operation-create", Mode: "once", State: "accepted", UpdatedAt: "2026-01-01T00:00:00Z"}
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		return BeginTemporaryCleanupTx(tx, record, "run-cancelled", "2026-01-01T00:00:00Z")
	}); err != nil {
		t.Fatal(err)
	}
	injected := errors.New("injected rollback")
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		if err := BindTemporaryCleanupOperationTx(tx, owner.WorkID, record.ServiceID, "operation-cleanup", "2026-01-01T00:00:01Z"); err != nil {
			return err
		}
		return injected
	}); !errors.Is(err, injected) {
		t.Fatal("binding did not roll back", err)
	}
	check := func(wantOperation string, count int) {
		t.Helper()
		if err := store.Read(ctx, func(tx *sql.Tx) error {
			cleanup, found, err := ReadTemporaryCleanupTx(tx, owner.WorkID, record.ServiceID)
			if err != nil || !found || cleanup.OperationID != wantOperation || len(cleanup.Events) != count {
				return fmt.Errorf("unexpected cleanup after binding: %+v: %v", cleanup, err)
			}
			if count == 2 && (cleanup.Events[0].Stage != "request" || cleanup.Events[0].Outcome != "started" || cleanup.Events[1].Stage != "request" || cleanup.Events[1].Outcome != "succeeded") {
				return fmt.Errorf("request start/result missing: %+v", cleanup.Events)
			}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	check("", 1)
	for range 2 {
		if err := store.Write(ctx, func(tx *sql.Tx) error {
			return BindTemporaryCleanupOperationTx(tx, owner.WorkID, record.ServiceID, "operation-cleanup", "2026-01-01T00:00:02Z")
		}); err != nil {
			t.Fatal(err)
		}
	}
	check("operation-cleanup", 2)
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		return BindTemporaryCleanupOperationTx(tx, owner.WorkID, record.ServiceID, "operation-other", "2026-01-01T00:00:03Z")
	}); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatal("different cleanup operation was accepted", err)
	}
	// An already-bound record from the previous version remains readable and
	// replaying it does not fabricate a new historical event or alter state.
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		old, _, err := ReadTemporaryCleanupTx(tx, owner.WorkID, record.ServiceID)
		if err != nil {
			return err
		}
		old.Events = old.Events[:1]
		old.State, old.Stage, old.ErrorCode = "pending", "inspect", "DOCKER_UNAVAILABLE"
		return writeTemporaryJSON(tx, temporaryCleanupKey(owner.WorkID, record.ServiceID), old.UpdatedAt, old)
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		return BindTemporaryCleanupOperationTx(tx, owner.WorkID, record.ServiceID, "operation-cleanup", "2026-01-01T00:00:04Z")
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Read(ctx, func(tx *sql.Tx) error {
		old, _, err := ReadTemporaryCleanupTx(tx, owner.WorkID, record.ServiceID)
		if err != nil || old.State != "pending" || old.Stage != "inspect" || old.ErrorCode != "DOCKER_UNAVAILABLE" || len(old.Events) != 1 {
			return fmt.Errorf("legacy history changed during replay: %+v: %v", old, err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestTemporaryCleanupRecordsAreBoundedSafeAndSurviveRestart(t *testing.T) {
	directory := t.TempDir()
	store := openTestStore(t, directory)
	ctx := context.Background()
	owner := TemporaryRunOwner{WorkID: "work-cleanup", RunID: "run-cleanup", Generation: 1, InstanceID: "agent-cleanup"}
	lease, err := store.OpenTemporaryRunLease(ctx, owner, "2026-01-01T00:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	service := TemporaryServiceRecord{Version: 1, Owner: owner, ServiceID: "service-cleanup", CreateOperationID: "operation-create", Mode: "once", State: "accepted", UpdatedAt: "2026-01-01T00:00:00Z"}
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		if err := AcceptTemporaryServiceTx(tx, service, lease.LeaseID); err != nil {
			return err
		}
		return BeginTemporaryCleanupTx(tx, service, "run-cancelled", "2026-01-01T00:00:00Z")
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Read(ctx, func(tx *sql.Tx) error { return AssertTemporaryCleanupConfirmedTx(tx, owner.WorkID) }); !errors.Is(err, ErrTemporaryCleanupPending) {
		t.Fatal("cold snapshot accepted unfinished cleanup", err)
	}
	for i := 0; i < 40; i++ {
		stamp := time.Date(2026, 1, 1, 0, 0, i+1, 0, time.UTC).Format(time.RFC3339Nano)
		err := store.Write(ctx, func(tx *sql.Tx) error {
			return AppendTemporaryCleanupEventTx(tx, owner.WorkID, service.ServiceID, "pending", TemporaryCleanupEvent{At: stamp, Stage: "retry", Outcome: "unconfirmed", Code: "TEMPORARY_CREATE_UNCONFIRMED"})
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		return AppendTemporaryCleanupEventTx(tx, owner.WorkID, service.ServiceID, "pending", TemporaryCleanupEvent{At: "2026-01-01T00:01:00Z", Stage: "retry", Outcome: "failed", Code: "synthetic-key-secret"})
	}); !errors.Is(err, ErrTemporaryIdentity) {
		t.Fatal("untrusted diagnostic was accepted", err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store = openTestStore(t, directory)
	defer store.Close()
	if err := store.Read(ctx, func(tx *sql.Tx) error {
		cleanup, found, err := ReadTemporaryCleanupTx(tx, owner.WorkID, service.ServiceID)
		if err != nil {
			return err
		}
		if !found || cleanup.RunID != owner.RunID || cleanup.CreateOperationID != service.CreateOperationID || cleanup.State != "pending" || !cleanup.Truncated || len(cleanup.Events) != maxTemporaryCleanupEvents {
			t.Fatal("cleanup history did not survive", cleanup)
		}
		encoded, _ := json.Marshal(cleanup)
		if strings.Contains(string(encoded), "synthetic-key-secret") || strings.Contains(string(encoded), lease.LeaseID) {
			return fmt.Errorf("private value entered cleanup history")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		return AppendTemporaryCleanupEventTx(tx, owner.WorkID, service.ServiceID, "completed", TemporaryCleanupEvent{At: "2026-01-01T00:01:01Z", Stage: "release", Outcome: "succeeded"})
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Read(ctx, func(tx *sql.Tx) error { return AssertTemporaryCleanupConfirmedTx(tx, owner.WorkID) }); err != nil {
		t.Fatal("completed cleanup blocked a cold snapshot", err)
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		return AppendTemporaryCleanupEventTx(tx, owner.WorkID, service.ServiceID, "running", TemporaryCleanupEvent{At: "2026-01-01T00:01:02Z", Stage: "retry", Outcome: "started"})
	}); !errors.Is(err, ErrOperationFinal) {
		t.Fatal("completed cleanup was rewritten", err)
	}
}

func TestTemporaryHistoryRetentionNeverDropsUnconfirmedTargets(t *testing.T) {
	store := openTestStore(t, t.TempDir())
	defer store.Close()
	ctx := context.Background()
	owner := TemporaryRunOwner{WorkID: "work-retention", RunID: "run-retention", Generation: 1, InstanceID: "agent-retention"}
	lease, err := store.OpenTemporaryRunLease(ctx, owner, "2026-01-01T00:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		for i := 0; i < maxTemporaryServicesPerWork; i++ {
			record := TemporaryServiceRecord{Version: 1, Owner: owner, ServiceID: fmt.Sprintf("service-%03d", i), CreateOperationID: fmt.Sprintf("operation-%03d", i), Mode: "once", State: "accepted", UpdatedAt: "2026-01-01T00:00:00Z"}
			if err := writeTemporaryJSON(tx, temporaryRecordKey(owner.WorkID, record.ServiceID), record.UpdatedAt, record); err != nil {
				return err
			}
			if err := BeginTemporaryCleanupTx(tx, record, "explicit", "2026-01-01T00:00:00Z"); err != nil {
				return err
			}
			if i == 0 {
				if err := AppendTemporaryCleanupEventTx(tx, owner.WorkID, record.ServiceID, "completed", TemporaryCleanupEvent{At: "2026-01-01T00:00:01Z", Stage: "release", Outcome: "succeeded"}); err != nil {
					return err
				}
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	newRecord := TemporaryServiceRecord{Version: 1, Owner: owner, ServiceID: "service-new", CreateOperationID: "operation-new", Mode: "once", State: "accepted", UpdatedAt: "2026-01-01T00:00:02Z"}
	if err := store.Write(ctx, func(tx *sql.Tx) error { return AcceptTemporaryServiceTx(tx, newRecord, lease.LeaseID) }); err != nil {
		t.Fatal(err)
	}
	if err := store.Read(ctx, func(tx *sql.Tx) error {
		_, removed, err := ReadTemporaryServiceTx(tx, owner.WorkID, "service-000")
		if err != nil {
			return err
		}
		_, retained, err := ReadTemporaryServiceTx(tx, owner.WorkID, "service-001")
		if err != nil {
			return err
		}
		retention, err := TemporaryHistoryRetentionTx(tx, owner.WorkID)
		if err != nil {
			return err
		}
		if removed || !retained || retention.Dropped != 1 {
			t.Fatal("history retention dropped an unfinished cleanup", removed, retained, retention)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	more := newRecord
	more.ServiceID = "service-overflow"
	more.CreateOperationID = "operation-overflow"
	if err := store.Write(ctx, func(tx *sql.Tx) error { return AcceptTemporaryServiceTx(tx, more, lease.LeaseID) }); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatal("unconfirmed cleanup history was not protected", err)
	}
}
