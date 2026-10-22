package coreapp

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestShutdownBudgetsDefaultsAndRejectBeforeOpeningStore(t *testing.T) {
	defaults := Options{}
	err := normalizeShutdownOptions(&defaults)
	if err != nil || defaults.WorkDrainTimeout != 30*time.Second || defaults.WorkStopTimeout != 10*time.Second || defaults.ShutdownTimeout != 45*time.Second {
		t.Fatal(defaults, err)
	}
	changed := Options{WorkDrainTimeout: 250 * time.Millisecond, WorkStopTimeout: 100 * time.Millisecond, ShutdownTimeout: 2 * time.Second}
	if normalizeShutdownOptions(&changed) != nil || changed.ShutdownTimeout != 2*time.Second {
		t.Fatal("explicit internal shutdown budget changed")
	}
	for _, value := range []time.Duration{-time.Millisecond, time.Nanosecond, 10*time.Minute + time.Millisecond} {
		directory := filepath.Join(t.TempDir(), "not-created")
		if _, err := New(context.Background(), Options{DataDirectory: directory, ShutdownTimeout: value}); err == nil {
			t.Fatal("invalid shutdown budget accepted")
		}
		if _, err := os.Stat(directory); !os.IsNotExist(err) {
			t.Fatal("invalid budget created installation")
		}
	}
}

func TestShutdownBoundsUnresponsiveCleanupAndReleasesStore(t *testing.T) {
	a, _, _ := appFixture(t, Options{ShutdownTimeout: 50 * time.Millisecond, Shutdown: func(ctx context.Context, _ *Application) error { <-ctx.Done(); return ctx.Err() }})
	started := time.Now()
	if err := a.Close(context.Background()); err == nil || time.Since(started) > 500*time.Millisecond {
		t.Fatal("stalled shutdown not bounded", err, time.Since(started))
	}
	waitForShutdownStoreRelease(t, a.options.DataDirectory)
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
