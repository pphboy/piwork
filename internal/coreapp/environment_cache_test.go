package coreapp

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/dockerengine"
)

type probeRuntimeFixture struct {
	ensure  func(context.Context) error
	run     func(context.Context) (json.RawMessage, error)
	remove  func(context.Context) error
	started atomic.Int32
	removed atomic.Int32
}

func (r *probeRuntimeFixture) EnsurePackageHelper(ctx context.Context, _ dockerengine.PackageHelperSpec) (string, error) {
	r.started.Add(1)
	if r.ensure != nil {
		return "probe-fixture", r.ensure(ctx)
	}
	return "probe-fixture", nil
}
func (r *probeRuntimeFixture) RunPackageHelper(ctx context.Context, _ dockerengine.PackageHelperSpec) (json.RawMessage, error) {
	if r.run != nil {
		return r.run(ctx)
	}
	return json.RawMessage(`{"os":"linux","architecture":"amd64","variant":null,"nodeAbi":"137","piSdkVersion":"0.86.1"}`), nil
}
func (r *probeRuntimeFixture) RemovePackageHelper(ctx context.Context, _ dockerengine.PackageHelperSpec) error {
	r.removed.Add(1)
	if r.remove != nil {
		return r.remove(ctx)
	}
	return nil
}

func TestEnvironmentProbeFailuresRequireConfirmedCleanup(t *testing.T) {
	failure := errors.New("fixture failed")
	for _, stage := range []string{"ensure", "run", "invalid", "remove", "release"} {
		t.Run(stage, func(t *testing.T) {
			runtime := &probeRuntimeFixture{}
			released := false
			release := func(context.Context) error {
				released = true
				if stage == "release" {
					return failure
				}
				return nil
			}
			switch stage {
			case "ensure":
				runtime.ensure = func(context.Context) error { return failure }
			case "run":
				runtime.run = func(context.Context) (json.RawMessage, error) { return nil, failure }
			case "invalid":
				runtime.run = func(context.Context) (json.RawMessage, error) { return json.RawMessage(`{"secret":"unsafe"}`), nil }
			case "remove":
				runtime.remove = func(context.Context) error { return failure }
			}
			result, err := probeEnvironment(context.Background(), runtime, dockerengine.PackageHelperSpec{}, release)
			if err == nil || runtime.removed.Load() != 1 || (stage == "remove" && released) || (stage != "remove" && !released) {
				t.Fatal(result, err, released, runtime.removed.Load())
			}
			if stage == "release" || stage == "remove" {
				if result.NodeAbi != "" {
					t.Fatal("unconfirmed cleanup returned success data", result)
				}
			}
		})
	}
}

func TestEnvironmentCacheSharesRealProbeAndReturnsIndependentEnvironment(t *testing.T) {
	a, _, _ := appFixture(t, Options{})
	runtime := &probeRuntimeFixture{}
	a.envRuntimeForTest = runtime
	a.envInspectForTest = func(context.Context, string) error { return nil }
	// Simulate a caller already owning the ordinary package prepare slots.
	a.packageSlots <- struct{}{}
	a.packageSlots <- struct{}{}
	defer func() { <-a.packageSlots; <-a.packageSlots }()
	first, err := a.probePackageEnvironment(context.Background(), "image-fixture")
	if err != nil {
		t.Fatal(err)
	}
	first.Variant[0] = 'x'
	var group sync.WaitGroup
	for i := 0; i < 20; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			value, err := a.probePackageEnvironment(context.Background(), "image-fixture")
			if err != nil || string(value.Variant) != "null" || value.NodeAbi != "137" {
				t.Error(value, err)
			}
		}()
	}
	group.Wait()
	if runtime.started.Load() != 1 || runtime.removed.Load() != 1 {
		t.Fatal(runtime.started.Load(), runtime.removed.Load())
	}
	a.envInspectForTest = func(context.Context, string) error { return dockerengine.ErrResourceMissing }
	if _, err := a.probePackageEnvironment(context.Background(), "image-fixture"); !errors.Is(err, dockerengine.ErrResourceMissing) {
		t.Fatal(err)
	}
	a.envInspectForTest = func(context.Context, string) error { return nil }
	if _, err := a.probePackageEnvironment(context.Background(), "image-fixture"); err != nil || runtime.started.Load() != 2 {
		t.Fatal(err, runtime.started.Load())
	}
}

func TestEnvironmentCacheDoesNotPublishBeforeCleanupOrCacheFailure(t *testing.T) {
	a, _, _ := appFixture(t, Options{})
	cleanupStarted, releaseCleanup := make(chan struct{}), make(chan struct{})
	var fail atomic.Bool
	fail.Store(true)
	runtime := &probeRuntimeFixture{remove: func(ctx context.Context) error {
		if fail.Load() {
			close(cleanupStarted)
			select {
			case <-releaseCleanup:
				return errors.New("cleanup failed")
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		return nil
	}}
	a.envRuntimeForTest = runtime
	a.envInspectForTest = func(context.Context, string) error { return nil }
	done := make(chan error, 1)
	go func() { _, err := a.probePackageEnvironment(context.Background(), "image-fixture"); done <- err }()
	<-cleanupStarted
	if a.environmentCache.Stats().Entries != 0 {
		t.Fatal("cached before cleanup")
	}
	close(releaseCleanup)
	if err := <-done; err == nil || a.environmentCache.Stats().Entries != 0 {
		t.Fatal(err)
	}
	fail.Store(false)
	if _, err := a.probePackageEnvironment(context.Background(), "image-fixture"); err != nil || runtime.started.Load() != 2 {
		t.Fatal(err, runtime.started.Load())
	}
}

func TestEnvironmentCacheLimitsDistinctProbesToTwo(t *testing.T) {
	a, _, _ := appFixture(t, Options{})
	var active, peak atomic.Int32
	release := make(chan struct{})
	runtime := &probeRuntimeFixture{run: func(ctx context.Context) (json.RawMessage, error) {
		n := active.Add(1)
		defer active.Add(-1)
		for old := peak.Load(); n > old && !peak.CompareAndSwap(old, n); old = peak.Load() {
		}
		select {
		case <-release:
			return json.RawMessage(`{"os":"linux","architecture":"amd64","variant":null,"nodeAbi":"137","piSdkVersion":"0.86.1"}`), nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}}
	a.envRuntimeForTest = runtime
	a.envInspectForTest = func(context.Context, string) error { return nil }
	var group sync.WaitGroup
	for _, key := range []string{"one", "two", "three", "four"} {
		group.Add(1)
		go func(key string) {
			defer group.Done()
			if _, err := a.probePackageEnvironment(context.Background(), key); err != nil {
				t.Error(err)
			}
		}(key)
	}
	deadline := time.Now().Add(time.Second)
	for active.Load() < 2 {
		if time.Now().After(deadline) {
			t.Fatal("probes did not start")
		}
		time.Sleep(time.Millisecond)
	}
	if runtime.started.Load() != 2 {
		t.Fatal("exceeded distinct probe admission", runtime.started.Load())
	}
	close(release)
	group.Wait()
	if peak.Load() != 2 || runtime.started.Load() != 4 {
		t.Fatal(peak.Load(), runtime.started.Load())
	}
}

func TestCoreCloseRetainsDependenciesUntilSharedCleanupReturns(t *testing.T) {
	a, err := New(context.Background(), Options{DataDirectory: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	started, cleanup := make(chan struct{}), make(chan struct{})
	var once sync.Once
	t.Cleanup(func() {
		once.Do(func() { close(cleanup) })
		if err := a.Close(context.Background()); err != nil {
			t.Error(err)
		}
	})
	go func() {
		_, _ = a.environmentCache.Get(context.Background(), environmentKey{"fixture", 1}, func(ctx context.Context) (contracts.PiPackagePreparedEnvironment, error) {
			close(started)
			<-ctx.Done()
			<-cleanup
			return contracts.PiPackagePreparedEnvironment{}, ctx.Err()
		})
	}()
	<-started
	budget, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()
	if err := a.Close(budget); err == nil {
		t.Fatal("unconfirmed shutdown reported success")
	}
	if _, err := a.Store.DefaultWork(context.Background()); err != nil {
		t.Fatal("storage closed during shared cleanup", err)
	}
	once.Do(func() { close(cleanup) })
	if err := a.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
}
