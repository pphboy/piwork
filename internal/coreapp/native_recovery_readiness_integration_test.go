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
	waitDefaultReady(t, ctx, a)
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		work, workErr := a.Store.Work(ctx, workID, false)
		serviceReady := serviceID == ""
		serviceState := "not-requested"
		var serviceErr error
		if serviceID != "" {
			service, err := a.Store.Service(ctx, workID, serviceID, false)
			serviceErr, serviceState = err, service.ObservedState
			serviceReady = err == nil && service.Enabled && service.ObservedState == "ready"
		}
		if workErr == nil && work.DesiredState == "running" && work.ObservedState == "ready" && serviceReady {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal("original owners did not recover", workID, serviceID, work.DesiredState, work.ObservedState, serviceState, workErr, serviceErr, ctx.Err())
		case <-ticker.C:
		}
	}
}
