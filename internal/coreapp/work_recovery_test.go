package coreapp

import (
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
