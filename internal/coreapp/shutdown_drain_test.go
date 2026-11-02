package coreapp

import (
	"context"
	"errors"
	"testing"
	"time"

	"piwork/internal/internaltls"
	"piwork/internal/workruntime"
)

type controlledDrainClient struct {
	calls     int
	confirmed bool
	failure   error
	closed    bool
	timeout   time.Duration
}

func (c *controlledDrainClient) Drain(ctx context.Context, timeout time.Duration) (bool, error) {
	c.calls++
	c.timeout = timeout
	if c.closed {
		return false, errors.New("transport already closed")
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	return c.confirmed, c.failure
}
func (c *controlledDrainClient) Close() error { c.closed = true; return nil }

func TestCapturedShutdownDrainRequiresOriginalConfirmedReceipt(t *testing.T) {
	scope := internaltls.Scope{InstallationID: "install", WorkID: "work", Generation: 7, InstanceID: "instance"}
	for _, outcome := range []string{"confirmed", "unconfirmed", "failed", "closed", "cancelled"} {
		t.Run(outcome, func(t *testing.T) {
			client := &controlledDrainClient{confirmed: outcome == "confirmed", closed: outcome == "closed"}
			if outcome == "failed" {
				client.failure = errors.New("connection lost")
			}
			route := &workruntime.DrainRoute{Scope: scope, ContextID: "context", Client: client}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if outcome == "cancelled" {
				cancel()
			}
			err := drainCapturedRoute(ctx, route, scope, "context", 30*time.Second)
			if (err == nil) != (outcome == "confirmed") {
				t.Fatal("incorrect drain receipt", outcome, err)
			}
			if client.calls != 1 || client.timeout != 30*time.Second {
				t.Fatal("drain replayed or budget changed", client.calls, client.timeout)
			}
		})
	}
	for _, mismatch := range []string{"work", "installation", "generation", "instance", "context", "missing"} {
		t.Run(mismatch, func(t *testing.T) {
			client := &controlledDrainClient{confirmed: true}
			route := &workruntime.DrainRoute{Scope: scope, ContextID: "context", Client: client}
			switch mismatch {
			case "work":
				route.Scope.WorkID = "other"
			case "installation":
				route.Scope.InstallationID = "other"
			case "generation":
				route.Scope.Generation++
			case "instance":
				route.Scope.InstanceID = "other"
			case "context":
				route.ContextID = "other"
			case "missing":
				route = nil
			}
			if err := drainCapturedRoute(context.Background(), route, scope, "context", 30*time.Second); err == nil {
				t.Fatal("foreign/missing authority confirmed drain")
			}
			if client.calls != 0 {
				t.Fatal("drained a different runtime")
			}
		})
	}
}

func TestShutdownDeadlineCannotConfirmPendingWorkload(t *testing.T) {
	entered := make(chan struct{})
	finished := make(chan struct{})
	app, err := New(context.Background(), Options{DataDirectory: t.TempDir(),
		WorkDrainTimeout: 20 * time.Millisecond, WorkStopTimeout: 20 * time.Millisecond, ShutdownTimeout: 80 * time.Millisecond,
		Shutdown: func(ctx context.Context, _ *Application) error {
			close(entered)
			<-ctx.Done()
			close(finished)
			return ctx.Err()
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := app.Close(context.Background()); err == nil {
		t.Fatal("pending workload was reported as confirmed shutdown")
	}
	select {
	case <-entered:
	default:
		t.Fatal("shutdown skipped workload attempt")
	}
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("workload did not receive the original shutdown deadline")
	}
}
