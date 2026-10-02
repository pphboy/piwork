package coreapp

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestShutdownBudgetsDefaultsOverridesAndRejectBeforeOpeningStore(t *testing.T) {
	defaults, err := shutdownOptionsFromEnvironment(map[string]string{})
	if err != nil || defaults.WorkDrainTimeout != 30*time.Second || defaults.WorkStopTimeout != 10*time.Second || defaults.ShutdownTimeout != 45*time.Second {
		t.Fatal(defaults, err)
	}
	changed, err := shutdownOptionsFromEnvironment(map[string]string{"PIWORK_DRAIN_TIMEOUT_MS": "250", "PIWORK_STOP_TIMEOUT_MS": "100", "PIWORK_SHUTDOWN_TIMEOUT_MS": "2000"})
	if err != nil || changed.WorkDrainTimeout != 250*time.Millisecond || changed.WorkStopTimeout != 100*time.Millisecond || changed.ShutdownTimeout != 2*time.Second {
		t.Fatal(changed, err)
	}
	for _, value := range []string{"", "0", "-1", "0.5", "600001", "9223372036854775807"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("PIWORK_SHUTDOWN_TIMEOUT_MS", value)
			directory := filepath.Join(t.TempDir(), "not-created")
			var stdout, stderr bytes.Buffer
			if code := RunServe(context.Background(), []string{"--data-dir", directory, "--listen", "127.0.0.1:0"}, &stdout, &stderr); code != 2 || stdout.Len() != 0 {
				t.Fatal(code, stdout.String(), stderr.String())
			}
			if _, err := os.Stat(directory); !os.IsNotExist(err) {
				t.Fatal("invalid budget created an installation", err)
			}
		})
	}
}

func TestShutdownBoundsUnresponsiveCleanupAndReleasesStore(t *testing.T) {
	a, _, _ := appFixture(t, Options{ShutdownTimeout: 50 * time.Millisecond, Shutdown: func(ctx context.Context, _ *Application) error { <-ctx.Done(); return ctx.Err() }})
	started := time.Now()
	if err := a.Close(context.Background()); err == nil || time.Since(started) > 500*time.Millisecond {
		t.Fatal("stalled shutdown not bounded", err, time.Since(started))
	}
	b, err := New(context.Background(), Options{DataDirectory: a.options.DataDirectory})
	if err != nil {
		t.Fatal("failed shutdown retained directory lock", err)
	}
	if err := b.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestWorkLockWaitHonorsCancellation(t *testing.T) {
	var lock sync.Mutex
	lock.Lock()
	defer lock.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	started := time.Now()
	if err := lockWorkContext(ctx, &lock); !errors.Is(err, context.DeadlineExceeded) || time.Since(started) > 300*time.Millisecond {
		t.Fatal("Work lock outlived shutdown deadline", err)
	}
}
