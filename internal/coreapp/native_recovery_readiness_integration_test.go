//go:build integration

package coreapp

import (
	"context"
	"testing"
	"time"
)

// Listen starts recovery asynchronously. Observe the original persisted owners
// within the caller's existing budget before exercising their actual endpoints.
func waitRecoveredWorkReady(t *testing.T, ctx context.Context, a *Application, workID, serviceID string) {
	t.Helper()
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for !a.Status().Ready {
		select {
		case <-ctx.Done():
			t.Fatal("Core recovery not ready within original budget", "cancelled", ctx.Err() == context.Canceled, "deadlineExceeded", ctx.Err() == context.DeadlineExceeded)
		case <-ticker.C:
		}
	}
	for {
		work, workErr := a.Store.Work(ctx, workID, false)
		serviceReady := serviceID == ""
		var serviceErr error
		if serviceID != "" {
			service, err := a.Store.Service(ctx, workID, serviceID, false)
			serviceErr = err
			serviceReady = err == nil && service.Enabled && service.ObservedState == "ready"
		}
		if workErr == nil && work.DesiredState == "running" && work.ObservedState == "ready" && serviceReady {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal("original owners did not recover", workID, serviceID, "desiredRunning", work.DesiredState == "running", "workReady", work.ObservedState == "ready", "serviceReady", serviceReady, "workReadFailed", workErr != nil, "serviceReadFailed", serviceErr != nil, "deadlineExceeded", ctx.Err() == context.DeadlineExceeded)
		case <-ticker.C:
		}
	}
}
