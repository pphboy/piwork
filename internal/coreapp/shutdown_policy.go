package coreapp

import (
	"context"
	"errors"
	"sync"
	"time"
)

var errShutdownConfiguration = errors.New("Core shutdown budgets must be positive milliseconds; drain is at most sixty seconds, stop at most thirty seconds and total at most ten minutes")

func normalizeShutdownOptions(options *Options) error {
	for _, item := range []struct {
		value    *time.Duration
		fallback time.Duration
	}{
		{&options.WorkDrainTimeout, 30 * time.Second},
		{&options.WorkStopTimeout, 10 * time.Second},
		{&options.ShutdownTimeout, 45 * time.Second},
	} {
		if *item.value == 0 {
			*item.value = item.fallback
		}
		if *item.value < time.Millisecond || *item.value > 10*time.Minute {
			return errShutdownConfiguration
		}
	}
	if options.WorkDrainTimeout > 60*time.Second || options.WorkStopTimeout > 30*time.Second {
		return errShutdownConfiguration
	}
	return nil
}

// Shutdown must not block forever behind a canceled lifecycle worker's lock.
// Keeping sync.Mutex permits test fixtures to freeze a real acceptance boundary.
func lockWorkContext(ctx context.Context, lock *sync.Mutex) error {
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		if lock.TryLock() {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}
