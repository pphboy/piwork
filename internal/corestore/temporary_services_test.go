package corestore

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"testing"
)

func TestTemporaryLeaseFencesCreationAcrossRestart(t *testing.T) {
	directory := t.TempDir()
	store := openTestStore(t, directory)
	ctx := context.Background()
	owner := TemporaryRunOwner{WorkID: "work-fixture", RunID: "run-fixture", Generation: 2, InstanceID: "agent-current"}
	lease, err := store.OpenTemporaryRunLease(ctx, owner, "2026-01-01T00:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	replay, err := store.OpenTemporaryRunLease(ctx, owner, "2026-01-01T00:00:01Z")
	if err != nil || replay.LeaseID != lease.LeaseID {
		t.Fatal("lease replay changed identity", err)
	}
	foreign := owner
	foreign.Generation++
	if _, err := store.OpenTemporaryRunLease(ctx, foreign, "2026-01-01T00:00:01Z"); !errors.Is(err, ErrTemporaryIdentity) {
		t.Fatal("foreign generation acquired lease", err)
	}
	record := TemporaryServiceRecord{Version: 1, Owner: owner, ServiceID: "service-probe", CreateOperationID: "operation-create", Mode: "once", State: "accepted", UpdatedAt: "2026-01-01T00:00:02Z"}
	if err := store.Write(ctx, func(tx *sql.Tx) error { return AcceptTemporaryServiceTx(tx, record, "lease-forged") }); !errors.Is(err, ErrTemporaryIdentity) {
		t.Fatal("forged lease accepted", err)
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error { return AcceptTemporaryServiceTx(tx, record, lease.LeaseID) }); err != nil {
		t.Fatal(err)
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error { return AcceptTemporaryServiceTx(tx, record, lease.LeaseID) }); err != nil {
		t.Fatal("exact replay failed", err)
	}
	conflict := record
	conflict.Mode = "listener"
	if err := store.Write(ctx, func(tx *sql.Tx) error { return AcceptTemporaryServiceTx(tx, conflict, lease.LeaseID) }); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatal("conflicting service replay accepted", err)
	}
	if err := store.CloseTemporaryRunLease(ctx, owner, "2026-01-01T00:00:03Z"); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store = openTestStore(t, directory)
	defer store.Close()
	if _, err := store.OpenTemporaryRunLease(ctx, owner, "2026-01-01T00:00:04Z"); !errors.Is(err, ErrTemporaryLeaseClosed) {
		t.Fatal("restart reopened a closed lease", err)
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error { return AcceptTemporaryServiceTx(tx, record, lease.LeaseID) }); !errors.Is(err, ErrTemporaryLeaseClosed) {
		t.Fatal("late creation escaped the fence", err)
	}
	if err := store.Read(ctx, func(tx *sql.Tx) error {
		var saved TemporaryServiceRecord
		found, err := readTemporaryJSON(tx, temporaryRecordKey(owner.WorkID, record.ServiceID), &saved)
		if err != nil {
			return err
		}
		if !found || saved != record {
			t.Fatal("original accepted target was not retained")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestTemporaryCloseAndAcceptAreAtomicallyOrdered(t *testing.T) {
	store := openTestStore(t, t.TempDir())
	defer store.Close()
	ctx := context.Background()
	owner := TemporaryRunOwner{WorkID: "work-race", RunID: "run-race", Generation: 1, InstanceID: "agent-race"}
	lease, err := store.OpenTemporaryRunLease(ctx, owner, "2026-01-01T00:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	record := TemporaryServiceRecord{Version: 1, Owner: owner, ServiceID: "service-race", CreateOperationID: "operation-race", Mode: "once", State: "accepted", UpdatedAt: "2026-01-01T00:00:01Z"}
	start := make(chan struct{})
	var wg sync.WaitGroup
	var accepted, closed error
	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		accepted = store.Write(ctx, func(tx *sql.Tx) error { return AcceptTemporaryServiceTx(tx, record, lease.LeaseID) })
	}()
	go func() {
		defer wg.Done()
		<-start
		closed = store.CloseTemporaryRunLease(ctx, owner, "2026-01-01T00:00:02Z")
	}()
	close(start)
	wg.Wait()
	if closed != nil || accepted != nil && !errors.Is(accepted, ErrTemporaryLeaseClosed) {
		t.Fatal("creation or closure failed", accepted, closed)
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error { return AcceptTemporaryServiceTx(tx, record, lease.LeaseID) }); !errors.Is(err, ErrTemporaryLeaseClosed) {
		t.Fatal("closed lease admitted creation", err)
	}
	if err := store.Read(ctx, func(tx *sql.Tx) error {
		var saved TemporaryServiceRecord
		found, err := readTemporaryJSON(tx, temporaryRecordKey(owner.WorkID, record.ServiceID), &saved)
		if err != nil {
			return err
		}
		if found != (accepted == nil) {
			t.Fatal("accepted target was not durable")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	missing := TemporaryRunOwner{WorkID: "work-race", RunID: "run-lost-response", Generation: 1, InstanceID: "agent-race"}
	if err := store.CloseTemporaryRunLease(ctx, missing, "2026-01-01T00:00:03Z"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.OpenTemporaryRunLease(ctx, missing, "2026-01-01T00:00:04Z"); !errors.Is(err, ErrTemporaryLeaseClosed) {
		t.Fatal("late lease escaped closure", err)
	}
}

func TestTemporaryLaunchIntentIsDurableAndCannotReplay(t *testing.T) {
	directory := t.TempDir()
	store := openTestStore(t, directory)
	ctx := context.Background()
	owner := TemporaryRunOwner{WorkID: "work-once", RunID: "run-once", Generation: 1, InstanceID: "agent-once"}
	lease, err := store.OpenTemporaryRunLease(ctx, owner, "2026-01-01T00:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	record := TemporaryServiceRecord{Version: 1, Owner: owner, ServiceID: "service-once", CreateOperationID: "operation-once", Mode: "once", State: "accepted", UpdatedAt: "2026-01-01T00:00:01Z"}
	if err := store.Write(ctx, func(tx *sql.Tx) error { return AcceptTemporaryServiceTx(tx, record, lease.LeaseID) }); err != nil {
		t.Fatal(err)
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		return MarkTemporaryLaunchingTx(tx, owner.WorkID, record.ServiceID, "2026-01-01T00:00:02Z")
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store = openTestStore(t, directory)
	defer store.Close()
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		return MarkTemporaryLaunchingTx(tx, owner.WorkID, record.ServiceID, "2026-01-01T00:00:03Z")
	}); !errors.Is(err, ErrTemporaryIdentity) {
		t.Fatal("launch intent could be replayed", err)
	}
	if err := store.CloseTemporaryRunLease(ctx, owner, "2026-01-01T00:00:04Z"); err != nil {
		t.Fatal(err)
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		return ConfirmTemporaryContainerTx(tx, owner.WorkID, record.ServiceID, "container-original", "2026-01-01T00:00:05Z")
	}); err != nil {
		t.Fatal("late confirmed instance was lost", err)
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		return CompleteTemporaryCommandTx(tx, owner.WorkID, record.ServiceID, 0, "2026-01-01T00:00:06Z")
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Read(ctx, func(tx *sql.Tx) error {
		got, found, err := ReadTemporaryServiceTx(tx, owner.WorkID, record.ServiceID)
		if err != nil {
			return err
		}
		if !found || got.State != "completed" || got.ContainerID != "container-original" || got.ExitCode == nil || *got.ExitCode != 0 {
			t.Fatal("original exit not retained", got)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
