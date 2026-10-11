package preparationcache

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func testCache[K comparable, V any](t *testing.T, options Options[V]) *Cache[K, V] {
	t.Helper()
	c := New[K](context.Background(), options)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := c.Close(ctx); err != nil {
			t.Error(err)
		}
	})
	return c
}

func waitStats[K comparable, V any](t *testing.T, c *Cache[K, V], predicate func(Stats) bool) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for !predicate(c.Stats()) {
		if time.Now().After(deadline) {
			t.Fatal("cache did not reach expected state", c.Stats())
		}
		time.Sleep(time.Millisecond)
	}
}

func TestSuccessBoundPinAndIndependentCopies(t *testing.T) {
	c := testCache[int](t, Options[[]byte]{Clone: func(value []byte) []byte { return append([]byte(nil), value...) }})
	if err := c.Pin(0); err != nil {
		t.Fatal(err)
	}
	var calls int
	work := func(context.Context) ([]byte, error) { calls++; return []byte("original"), nil }
	for i := 0; i < 70; i++ {
		value, err := c.Get(context.Background(), i, work)
		if err != nil {
			t.Fatal(err)
		}
		value[0] = 'x'
	}
	if c.Stats().Entries != 64 {
		t.Fatal(c.Stats())
	}
	value, err := c.Get(context.Background(), 0, work)
	if err != nil || string(value) != "original" || calls != 70 {
		t.Fatal(string(value), calls, err)
	}
	if err := c.Pin(); err != nil {
		t.Fatal(err)
	}
	for i := 70; i < 135; i++ {
		if _, err := c.Get(context.Background(), i, work); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := c.Get(context.Background(), 0, work); err != nil || calls != 136 {
		t.Fatal(calls, err)
	}
}

func TestFailuresAndTimeoutsRemainRetryable(t *testing.T) {
	c := testCache[string](t, Options[int]{Timeout: 20 * time.Millisecond})
	failure := errors.New("prepare failed")
	if _, err := c.Get(context.Background(), "failed", func(context.Context) (int, error) { return 0, failure }); !errors.Is(err, failure) {
		t.Fatal(err)
	}
	if _, err := c.Get(context.Background(), "timeout", func(ctx context.Context) (int, error) { <-ctx.Done(); return 0, ctx.Err() }); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
	if c.Stats().Entries != 0 {
		t.Fatal("failure cached", c.Stats())
	}
	for _, key := range []string{"failed", "timeout"} {
		value, err := c.Get(context.Background(), key, func(context.Context) (int, error) { return 7, nil })
		if err != nil || value != 7 {
			t.Fatal(value, err)
		}
	}
}

func TestFirstCallerCancellationDoesNotCancelOtherWaiter(t *testing.T) {
	c := testCache[string](t, Options[int]{})
	first, cancel := context.WithCancel(context.Background())
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	work := func(ctx context.Context) (int, error) {
		calls.Add(1)
		close(started)
		select {
		case <-release:
			return 9, nil
		case <-ctx.Done():
			return 0, ctx.Err()
		}
	}
	done1, done2 := make(chan error, 1), make(chan error, 1)
	go func() { _, err := c.Get(first, "same", work); done1 <- err }()
	<-started
	go func() {
		value, err := c.Get(context.Background(), "same", work)
		if err == nil && value != 9 {
			err = errors.New("wrong result")
		}
		done2 <- err
	}()
	waitStats(t, c, func(s Stats) bool { return s.Waiters == 2 })
	cancel()
	if err := <-done1; !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if c.Stats().Flights != 1 {
		t.Fatal("first caller cancelled shared work")
	}
	close(release)
	if err := <-done2; err != nil || calls.Load() != 1 {
		t.Fatal(err, calls.Load())
	}
}

func TestAllCancelledWaitForCleanupBeforeNewFlight(t *testing.T) {
	c := testCache[string](t, Options[int]{})
	caller, cancel := context.WithCancel(context.Background())
	started, cancelled, cleanup := make(chan struct{}), make(chan struct{}), make(chan struct{})
	done := make(chan error, 1)
	go func() {
		_, err := c.Get(caller, "same", func(ctx context.Context) (int, error) {
			close(started)
			<-ctx.Done()
			close(cancelled)
			<-cleanup
			return 0, ctx.Err()
		})
		done <- err
	}()
	<-started
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	<-cancelled
	newStarted, newDone := make(chan struct{}), make(chan error, 1)
	go func() {
		_, err := c.Get(context.Background(), "same", func(context.Context) (int, error) { close(newStarted); return 11, nil })
		newDone <- err
	}()
	select {
	case <-newStarted:
		t.Fatal("new flight overlapped unconfirmed cleanup")
	case <-time.After(20 * time.Millisecond):
	}
	close(cleanup)
	if err := <-newDone; err != nil {
		t.Fatal(err)
	}
	if c.Stats().Entries != 1 {
		t.Fatal(c.Stats())
	}
}

func TestCapacityWaitIsCancellableAndDoesNotCreateWork(t *testing.T) {
	c := testCache[string](t, Options[int]{MaxFlights: 1})
	started, release := make(chan struct{}), make(chan struct{})
	done := make(chan error, 1)
	go func() {
		_, err := c.Get(context.Background(), "first", func(context.Context) (int, error) { close(started); <-release; return 1, nil })
		done <- err
	}()
	<-started
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	var called bool
	if _, err := c.Get(ctx, "second", func(context.Context) (int, error) { called = true; return 2, nil }); !errors.Is(err, context.DeadlineExceeded) || called {
		t.Fatal(err, called)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	value, err := c.Get(context.Background(), "second", func(context.Context) (int, error) { return 2, nil })
	if err != nil || value != 2 {
		t.Fatal(value, err)
	}
}

func TestCloseWaitsForCleanupAndRejectsAdmission(t *testing.T) {
	c := testCache[string](t, Options[int]{})
	started, cleanup := make(chan struct{}), make(chan struct{})
	done := make(chan error, 1)
	go func() {
		_, err := c.Get(context.Background(), "same", func(ctx context.Context) (int, error) { close(started); <-ctx.Done(); <-cleanup; return 0, ctx.Err() })
		done <- err
	}()
	<-started
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := c.Close(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("unconfirmed cleanup reported success", err)
	}
	if _, err := c.Get(context.Background(), "new", func(context.Context) (int, error) { t.Fatal("work admitted after close"); return 0, nil }); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	close(cleanup)
	if err := c.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestConcurrentCallersShareOnePreparation(t *testing.T) {
	c := testCache[string](t, Options[int]{})
	var calls atomic.Int32
	release := make(chan struct{})
	var group sync.WaitGroup
	for i := 0; i < 20; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			value, err := c.Get(context.Background(), "same", func(context.Context) (int, error) { calls.Add(1); <-release; return 42, nil })
			if err != nil || value != 42 {
				t.Error(value, err)
			}
		}()
	}
	waitStats(t, c, func(s Stats) bool { return s.Waiters == 20 })
	close(release)
	group.Wait()
	if calls.Load() != 1 {
		t.Fatal(calls.Load())
	}
}

func TestLifecycleIsNotAnInitializationAttempt(t *testing.T) {
	lifecycle, stop := context.WithCancel(context.Background())
	defer stop()
	c := New[string](lifecycle, Options[int]{})
	defer c.Close(context.Background())
	attempt, cancel := context.WithCancel(lifecycle)
	if _, err := c.Get(attempt, "first", func(context.Context) (int, error) { return 1, nil }); err != nil {
		t.Fatal(err)
	}
	cancel()
	if value, err := c.Get(lifecycle, "second", func(context.Context) (int, error) { return 2, nil }); err != nil || value != 2 {
		t.Fatal(value, err)
	}
	c.Invalidate("first")
	if value, err := c.Get(lifecycle, "first", func(context.Context) (int, error) { return 3, nil }); err != nil || value != 3 {
		t.Fatal(value, err)
	}
}
