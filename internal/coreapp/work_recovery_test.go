package coreapp

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/corestore"
)

func TestRecoveryRespectsPersistedRetryDeadlineAndExhaustion(t *testing.T) {
	now := time.Date(2026, 9, 20, 0, 0, 0, 0, time.UTC)
	due := now.Add(5 * time.Second).Format(time.RFC3339Nano)
	start := now.Format(time.RFC3339Nano)
	if runtimeRetryPermitted(corestore.RuntimeGeneration{State: "recovering", NextRetryAt: &due}, now) {
		t.Fatal("Core restart bypassed persisted backoff")
	}
	if !runtimeRetryPermitted(corestore.RuntimeGeneration{State: "recovering", NextRetryAt: &due}, now.Add(5*time.Second)) {
		t.Fatal("due recovery was never admitted")
	}
	failed := corestore.RuntimeGeneration{State: "failed", RetryCount: 3, RetryWindowStartedAt: &start}
	if runtimeRetryPermitted(failed, now.Add(9*time.Minute)) {
		t.Fatal("Core restart replenished exhausted budget")
	}
	if runtimeRetryPermitted(failed, now.Add(10*time.Minute)) {
		t.Fatal("Core restart after the old window bypassed explicit retry")
	}
}

func TestRecoveryFailureObservationFollowsScheduledRetry(t *testing.T) {
	ctx := context.Background()
	a, err := New(ctx, Options{DataDirectory: t.TempDir(), Shutdown: func(context.Context, *Application) error { return nil }})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close(ctx)
	owner, err := a.Identity.Bootstrap(ctx, "owner", "development-fixture-pass")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		for _, id := range []string{"retry", "stopped", "newer", "no-generation"} {
			if err := corestore.InsertWork(tx, corestore.WorkRecord{ID: id, OwnerUserID: string(owner.Id), Name: id, DesiredState: "running", ObservedState: "starting", DesiredRevision: 1, ControlVersion: 1, CreatedAt: now, UpdatedAt: now}); err != nil {
				return err
			}
			if id != "no-generation" {
				if _, err := tx.Exec(`INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,created_at,updated_at) VALUES(?,1,'fixture','starting',0,?,?)`, id, now, now); err != nil {
					return err
				}
			}
		}
		_, err := tx.Exec(`INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,created_at,updated_at) VALUES('newer',2,'new-fixture','ready',0,?,?)`, now, now)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	for attempt := 1; attempt <= 4; attempt++ {
		if err := a.recordRecoveryFailure(ctx, "retry", 1, 1); err != nil {
			t.Fatal(err)
		}
		work, err := a.Store.Work(ctx, "retry", false)
		if err != nil {
			t.Fatal(err)
		}
		generation, err := a.Store.RuntimeGeneration(ctx, "retry", 1)
		if err != nil {
			t.Fatal(err)
		}
		if attempt <= 3 {
			if work.ObservedState != "unknown" || generation.State != "recovering" || generation.RetryCount != attempt || generation.NextRetryAt == nil {
				t.Fatalf("attempt %d: work=%+v generation=%+v", attempt, work, generation)
			}
		} else if work.ObservedState != "failed" || generation.State != "failed" || generation.RetryCount != 3 || generation.NextRetryAt != nil {
			t.Fatalf("exhausted: work=%+v generation=%+v", work, generation)
		}
	}
	if err := a.recordRecoveryFailure(ctx, "newer", 1, 1); err != nil {
		t.Fatal(err)
	}
	work, err := a.Store.Work(ctx, "newer", false)
	if err != nil || work.ObservedState != "starting" {
		t.Fatalf("old generation overwrote new: %+v %v", work, err)
	}
	oldGeneration, err := a.Store.RuntimeGeneration(ctx, "newer", 1)
	if err != nil || oldGeneration.State != "starting" || oldGeneration.RetryCount != 0 {
		t.Fatalf("old generation was rescheduled: %+v %v", oldGeneration, err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE works SET desired_state='stopped',observed_state='stopping' WHERE id='stopped'`)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.recordRecoveryFailure(ctx, "stopped", 1, 1); err != nil {
		t.Fatal(err)
	}
	// The desired target may change after the caller's preflight read.
	if _, err := a.Store.RecordRuntimeFailure(ctx, "stopped", 1, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	work, err = a.Store.Work(ctx, "stopped", false)
	if err != nil || work.ObservedState != "stopping" {
		t.Fatalf("stop target overwritten: %+v %v", work, err)
	}
	stoppedGeneration, err := a.Store.RuntimeGeneration(ctx, "stopped", 1)
	if err != nil || stoppedGeneration.State != "starting" || stoppedGeneration.RetryCount != 0 {
		t.Fatalf("stop target was rescheduled: %+v %v", stoppedGeneration, err)
	}
	if err := a.recordRecoveryFailure(ctx, "no-generation", 1, 1); err != nil {
		t.Fatal(err)
	}
	work, err = a.Store.Work(ctx, "no-generation", false)
	if err != nil || work.ObservedState != "failed" {
		t.Fatalf("missing generation failure lost: %+v %v", work, err)
	}
}

func TestRecoveryWorkersIsolateSlowWorkAndBoundConcurrency(t *testing.T) {
	blocked := make(chan struct{})
	release := make(chan struct{})
	fast := make(chan struct{})
	var active, maximum atomic.Int32
	failure := errors.New("fixture failure")
	done := make(chan error, 1)
	go func() {
		done <- recoverWorksConcurrently(context.Background(), []string{"slow", "fast", "failure"}, func(id string) error {
			current := active.Add(1)
			defer active.Add(-1)
			for old := maximum.Load(); current > old && !maximum.CompareAndSwap(old, current); old = maximum.Load() {
			}
			switch id {
			case "slow":
				close(blocked)
				<-release
			case "fast":
				close(fast)
			case "failure":
				return failure
			}
			return nil
		})
	}()
	select {
	case <-blocked:
	case <-time.After(time.Second):
		t.Fatal("slow work not started")
	}
	select {
	case <-fast:
	case <-time.After(time.Second):
		t.Fatal("slow work blocked sibling")
	}
	close(release)
	if err := <-done; !errors.Is(err, failure) {
		t.Fatal("failure not retained", err)
	}
	if maximum.Load() > 2 {
		t.Fatal("recovery exceeded bound", maximum.Load())
	}
}

func TestRecoveryLockedWorksYieldBothSlots(t *testing.T) {
	var first, second sync.Mutex
	first.Lock()
	second.Lock()
	defer first.Unlock()
	defer second.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	ctx = context.WithValue(ctx, nonblockingRecoveryKey{}, true)
	var deferred atomic.Int32
	err := recoverWorksConcurrently(ctx, []string{"first", "second", "unblocked"}, func(id string) error {
		var lock *sync.Mutex
		switch id {
		case "first":
			lock = &first
		case "second":
			lock = &second
		default:
			return nil
		}
		if err := lockWorkContext(ctx, lock); errors.Is(err, errWorkRecoveryDeferred) {
			deferred.Add(1)
			return nil
		} else if err != nil {
			return err
		}
		lock.Unlock()
		return errors.New("held Work lock was acquired")
	})
	if err != nil || deferred.Load() != 2 {
		t.Fatalf("locked Works consumed recovery slots: %d %v", deferred.Load(), err)
	}
}

func TestRecoveryYieldsBeforeSelectingAnOperationOwnedByLiveCoordinator(t *testing.T) {
	var app Application
	var live sync.Mutex
	live.Lock()
	defer live.Unlock()
	app.workOperationLocks.Store("work-live", &live)
	ctx := context.WithValue(context.Background(), nonblockingRecoveryKey{}, true)
	if processed, err := app.processOneWorkOperation(ctx, "work-live"); processed || !errors.Is(err, errWorkRecoveryDeferred) {
		t.Fatal("recovery entered an operation already owned by the live queue", processed, err)
	}
}
