package corestore

import (
	"context"
	"database/sql"
	"testing"
	"time"
)

func TestRuntimeFailureBudgetSurvivesReopenAndStableReset(t *testing.T) {
	directory := t.TempDir()
	store := openTestStore(t, directory)
	seedMutationWork(t, store)
	ctx := context.Background()
	clock := time.Date(2026, 9, 20, 0, 0, 0, 0, time.UTC)
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,created_at,updated_at) VALUES(?,1,'agent-1','ready',0,?,?)`, mutationWorkID, clock.Format(time.RFC3339Nano), clock.Format(time.RFC3339Nano))
		return err
	}); err != nil {
		t.Fatal(err)
	}
	for index, advance := range []time.Duration{0, time.Second, 6 * time.Second} {
		at := clock.Add(advance)
		value, err := store.RecordRuntimeFailure(ctx, mutationWorkID, 1, at)
		if err != nil || value.State != "recovering" || value.RetryCount != index+1 || value.NextRetryAt == nil {
			t.Fatal("retry budget was not stored", index, err, value)
		}
		if due, err := store.DueRuntimeRetries(ctx, at); err != nil || len(due) != 0 {
			t.Fatal("retry became due too early", index, err, due)
		}
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store = openTestStore(t, directory)
	defer store.Close()
	if due, err := store.DueRuntimeRetries(ctx, clock.Add(21*time.Second)); err != nil || len(due) != 1 || due[0].RetryCount != 3 {
		t.Fatal("retry deadline lost on Core restart", err, due)
	}
	exhausted, err := store.RecordRuntimeFailure(ctx, mutationWorkID, 1, clock.Add(21*time.Second))
	if err != nil || exhausted.State != "failed" || exhausted.NextRetryAt != nil || exhausted.RetryCount != 3 {
		t.Fatal("fourth failure did not exhaust budget", err, exhausted)
	}
	reset, err := store.ResetRuntimeRetryBudget(ctx, mutationWorkID, 1, clock.Add(22*time.Second))
	if err != nil || reset.RetryCount != 0 || reset.State != "preparing" {
		t.Fatal("explicit retry did not reset budget", err, reset)
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE runtime_generations SET state='ready',retry_count=2,ready_since=? WHERE work_id=? AND generation=1`, clock.Format(time.RFC3339Nano), mutationWorkID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	stable, err := store.ResetStableRuntimeRetryBudget(ctx, mutationWorkID, 1, clock.Add(10*time.Minute))
	if err != nil || stable.RetryCount != 0 || stable.RetryWindowStartedAt != nil {
		t.Fatal("stable readiness did not clear old failures", err, stable)
	}
}
