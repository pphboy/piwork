package corestore

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestRuntimeLaunchAndReplacementSurviveReopen(t *testing.T) {
	directory := t.TempDir()
	store := openTestStore(t, directory)
	seedMutationWork(t, store)
	ctx := context.Background()
	launch := RuntimeLaunchBinding{Version: 1, WorkID: mutationWorkID, Generation: 2, InstanceID: "agent-target", ControlVersion: 1, ContextID: "context-a", ImageID: "sha256:" + strings.Repeat("a", 64), ModelRef: "model-ref-a", CredentialRef: "model-11111111-1111-4111-8111-111111111111.secret"}
	replacement := RuntimeReplacement{Version: 1, WorkID: mutationWorkID, ControlVersion: 1, SourceGeneration: 1, SourceInstanceID: "agent-original", Target: launch, Stage: "prepared"}
	if err := store.Write(ctx, func(tx *sql.Tx) error { return PutRuntimeReplacementTx(tx, replacement) }); err != nil {
		t.Fatal(err)
	}
	// Replaying after an unknown transaction result is idempotent. A newly
	// rotated credential cannot silently replace the already captured target.
	if err := store.Write(ctx, func(tx *sql.Tx) error { return PutRuntimeReplacementTx(tx, replacement) }); err != nil {
		t.Fatal(err)
	}
	changed := replacement
	changed.Target.CredentialRef = "model-22222222-2222-4222-8222-222222222222.secret"
	if err := store.Write(ctx, func(tx *sql.Tx) error { return PutRuntimeReplacementTx(tx, changed) }); !errors.Is(err, ErrRevisionConflict) {
		t.Fatal("replacement rebound after rotation", err)
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error { return PutRuntimeLaunchTx(tx, launch) }); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store = openTestStore(t, directory)
	defer store.Close()
	if err := store.Read(ctx, func(tx *sql.Tx) error {
		got, found, err := ReadRuntimeReplacementTx(tx, mutationWorkID)
		if err != nil || !found || got != replacement {
			t.Fatalf("replacement not retained: %+v found=%v err=%v", got, found, err)
		}
		captured, found, err := ReadRuntimeLaunchTx(tx, mutationWorkID, 2)
		if err != nil || !found || captured != launch {
			t.Fatalf("launch not retained: %+v found=%v err=%v", captured, found, err)
		}
		var raw string
		if err := tx.QueryRow(`SELECT value_json FROM control_metadata WHERE key=?`, runtimeLaunchKey(mutationWorkID, 2)).Scan(&raw); err != nil {
			return err
		}
		if strings.Contains(raw, "synthetic-secret") {
			t.Fatal("credential value was persisted")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	launch.CredentialRef = "synthetic-secret"
	if err := store.Write(ctx, func(tx *sql.Tx) error { return PutRuntimeLaunchTx(tx, launch) }); !errors.Is(err, ErrStorage) {
		t.Fatal("raw secret accepted as a reference", err)
	}
}

func TestRuntimeReplacementTransfersRetryBudgetAtomically(t *testing.T) {
	store := openTestStore(t, t.TempDir())
	defer store.Close()
	seedMutationWork(t, store)
	ctx := context.Background()
	now := time.Date(2026, 10, 27, 0, 0, 0, 0, time.UTC)
	start := now.Add(-time.Minute).Format(time.RFC3339Nano)
	due := now.Format(time.RFC3339Nano)
	launch := RuntimeLaunchBinding{Version: 1, WorkID: mutationWorkID, Generation: 2, InstanceID: "agent-target", ControlVersion: 1, ContextID: "context-a", ImageID: "sha256:" + strings.Repeat("a", 64), ModelRef: "model-ref-a", CredentialRef: "model-11111111-1111-4111-8111-111111111111.secret"}
	plan := RuntimeReplacement{Version: 1, WorkID: mutationWorkID, ControlVersion: 1, SourceGeneration: 1, SourceInstanceID: "agent-original", Target: launch, Stage: "prepared"}
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE works SET desired_state='running' WHERE id=?`, mutationWorkID); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,retry_window_started_at,next_retry_at,created_at,updated_at) VALUES(?,1,'agent-original','recovering',2,?,?,?,?)`, mutationWorkID, start, due, start, start); err != nil {
			return err
		}
		return PutRuntimeReplacementTx(tx, plan)
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		_, err := AdvanceRuntimeReplacementTx(tx, mutationWorkID, 2, "starting", now)
		return err
	}); !errors.Is(err, ErrRevisionConflict) {
		t.Fatal("registered target before cleanup", err)
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		_, err := AdvanceRuntimeReplacementTx(tx, mutationWorkID, 2, "old-removed", now)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	injected := errors.New("transaction interrupted")
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := AdvanceRuntimeReplacementTx(tx, mutationWorkID, 2, "starting", now); err != nil {
			return err
		}
		return injected
	}); !errors.Is(err, injected) {
		t.Fatal("interrupted transition did not roll back", err)
	}
	if _, err := store.RuntimeGeneration(ctx, mutationWorkID, 2); !errors.Is(err, ErrNotFound) {
		t.Fatal("partial target persisted", err)
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		_, err := AdvanceRuntimeReplacementTx(tx, mutationWorkID, 2, "starting", now)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	source, err := store.RuntimeGeneration(ctx, mutationWorkID, 1)
	if err != nil || source.State != "stopped" || source.NextRetryAt != nil {
		t.Fatal("source remained retryable", source, err)
	}
	target, err := store.RuntimeGeneration(ctx, mutationWorkID, 2)
	if err != nil || target.RetryCount != 2 || target.RetryWindowStartedAt == nil || *target.RetryWindowStartedAt != start || target.NextRetryAt == nil || *target.NextRetryAt != due {
		t.Fatal("retry budget was not transferred", target, err)
	}
	failed, err := store.RecordRuntimeFailure(ctx, mutationWorkID, 2, now)
	if err != nil || failed.RetryCount != 3 || failed.NextRetryAt == nil || *failed.NextRetryAt != now.Add(15*time.Second).Format(time.RFC3339Nano) {
		t.Fatal("third failure did not retain backoff", failed, err)
	}
	if dueItems, err := store.DueRuntimeRetries(ctx, now.Add(15*time.Second)); err != nil || len(dueItems) != 1 || dueItems[0].Generation != 2 {
		t.Fatal("source was still due", dueItems, err)
	}
	failed, err = store.RecordRuntimeFailure(ctx, mutationWorkID, 2, now.Add(15*time.Second))
	if err != nil || failed.State != "failed" || failed.RetryCount != 3 {
		t.Fatal("retry budget was renewed", failed, err)
	}
	reset, err := store.ResetRuntimeRetryBudget(ctx, mutationWorkID, 2, now.Add(16*time.Second))
	if err != nil || reset.State != "preparing" || reset.RetryCount != 0 || reset.RetryWindowStartedAt != nil {
		t.Fatal("explicit retry did not reset the target budget", reset, err)
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE runtime_generations SET state='ready',retry_count=2,ready_since=? WHERE work_id=? AND generation=2`, now.Format(time.RFC3339Nano), mutationWorkID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	stable, err := store.ResetStableRuntimeRetryBudget(ctx, mutationWorkID, 2, now.Add(10*time.Minute))
	if err != nil || stable.RetryCount != 0 {
		t.Fatal("stable target did not reset its budget", stable, err)
	}
}

func TestRuntimeLaunchRebindRequiresUnpublishedNewControl(t *testing.T) {
	store := openTestStore(t, t.TempDir())
	defer store.Close()
	seedMutationWork(t, store)
	ctx := context.Background()
	old := RuntimeLaunchBinding{Version: 1, WorkID: mutationWorkID, Generation: 1, InstanceID: "agent-original", ControlVersion: 1, ContextID: "context-a", ImageID: "sha256:" + strings.Repeat("a", 64), ModelRef: "model-ref-a", CredentialRef: "model-11111111-1111-4111-8111-111111111111.secret"}
	next := old
	next.ControlVersion = 2
	next.CredentialRef = "model-22222222-2222-4222-8222-222222222222.secret"
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		if err := PutRuntimeLaunchTx(tx, old); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE works SET desired_state='running',control_version=2 WHERE id=?`, mutationWorkID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error { return ReplaceUnpublishedRuntimeLaunchTx(tx, old, next, time.Now()) }); err != nil {
		t.Fatal(err)
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		return MarkRuntimeLaunchPublishedTx(tx, mutationWorkID, 1, next.InstanceID, time.Now())
	}); err != nil {
		t.Fatal(err)
	}
	next.Published = true
	later := next
	later.ControlVersion++
	later.Published = false
	if err := store.Write(ctx, func(tx *sql.Tx) error { return ReplaceUnpublishedRuntimeLaunchTx(tx, next, later, time.Now()) }); !errors.Is(err, ErrRevisionConflict) {
		t.Fatal("published credential was rebound", err)
	}
}

func TestRuntimeRetryResetIsIdempotentAcrossWorkerReplay(t *testing.T) {
	store := openTestStore(t, t.TempDir())
	defer store.Close()
	seedMutationWork(t, store)
	ctx := context.Background()
	now := time.Date(2026, 10, 27, 0, 0, 0, 0, time.UTC)
	stamp := now.Format(time.RFC3339Nano)
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE works SET desired_state='running',control_version=2 WHERE id=?`, mutationWorkID); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,created_at,updated_at) VALUES(?,1,'agent-original','failed',3,?,?)`, mutationWorkID, stamp, stamp); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO operations(id,work_id,kind,state,target_version,request_json,created_at,updated_at) VALUES('operation-retry',?,'retry-work','running',2,'{}',?,?)`, mutationWorkID, stamp, stamp)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ResetRuntimeRetryBudgetOnce(ctx, mutationWorkID, 1, "operation-retry", now); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RecordRuntimeFailure(ctx, mutationWorkID, 1, now); err != nil {
		t.Fatal(err)
	}
	value, err := store.ResetRuntimeRetryBudgetOnce(ctx, mutationWorkID, 1, "operation-retry", now.Add(time.Second))
	if err != nil || value.RetryCount != 1 || value.State != "recovering" {
		t.Fatal("replayed Retry granted a second budget", value, err)
	}
}

func TestRuntimeReplacementRebaseKeepsPinnedTarget(t *testing.T) {
	store := openTestStore(t, t.TempDir())
	defer store.Close()
	seedMutationWork(t, store)
	ctx := context.Background()
	launch := RuntimeLaunchBinding{Version: 1, WorkID: mutationWorkID, Generation: 2, InstanceID: "agent-target", ControlVersion: 1, ContextID: "context-a", ImageID: "sha256:" + strings.Repeat("a", 64), ModelRef: "model-ref-a", CredentialRef: "model-11111111-1111-4111-8111-111111111111.secret"}
	plan := RuntimeReplacement{Version: 1, WorkID: mutationWorkID, ControlVersion: 1, SourceGeneration: 1, SourceInstanceID: "agent-original", Target: launch, Stage: "prepared"}
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		if err := PutRuntimeReplacementTx(tx, plan); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE works SET desired_state='running',control_version=2 WHERE id=?`, mutationWorkID); err != nil {
			return err
		}
		return RebaseRuntimeReplacementTx(tx, mutationWorkID, "operation-retry", "context-a", 2, time.Now())
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Read(ctx, func(tx *sql.Tx) error {
		got, found, err := ReadRuntimeReplacementTx(tx, mutationWorkID)
		if err != nil || !found || got.ControlVersion != 2 || got.OperationID != "operation-retry" || got.Target != launch {
			t.Fatal("Retry changed its pinned replacement", got, err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
