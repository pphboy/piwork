package coreapp

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
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
		_, _ = a.environmentCache.Get(context.Background(), environmentKey{imageID: "fixture", version: 1}, func(ctx context.Context) (contracts.PiPackagePreparedEnvironment, error) {
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

func TestEnvironmentPreparationPersistsAcrossCoreRestart(t *testing.T) {
	ctx := context.Background()
	archive, id, labels := preparationHelperArchive(t, "agent")
	socketDir, err := os.MkdirTemp("", "piwork-env-engine-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(socketDir)
	socket := filepath.Join(socketDir, "engine.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	var saves atomic.Int32
	var missing atomic.Bool
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/_ping"):
			w.Header().Set("API-Version", "1.51")
		case strings.HasSuffix(r.URL.Path, "/version"):
			_ = json.NewEncoder(w).Encode(map[string]string{"ApiVersion": "1.51", "MinAPIVersion": "1.44", "Os": "linux", "Arch": "amd64"})
		case strings.HasSuffix(r.URL.Path, "/info"):
			_ = json.NewEncoder(w).Encode(map[string]string{"ID": "fixture-daemon", "Driver": "overlay2", "DockerRootDir": "/var/lib/docker"})
		case strings.HasSuffix(r.URL.Path, "/images/"+id+"/json"):
			if missing.Load() {
				http.NotFound(w, r)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"Id": id, "Os": "linux", "Architecture": "amd64", "Config": map[string]any{"Labels": labels}})
		case strings.HasSuffix(r.URL.Path, "/images/get"):
			saves.Add(1)
			_, _ = w.Write(archive)
		default:
			http.NotFound(w, r)
		}
	})}
	go server.Serve(listener)
	defer server.Close()
	dir := t.TempDir()
	runtime := &probeRuntimeFixture{}
	setup := func() *Application {
		a, err := New(ctx, Options{DataDirectory: dir})
		if err != nil {
			t.Fatal(err)
		}
		a.engine, err = dockerengine.Connect(ctx, dockerengine.Endpoint{Host: "unix://" + socket, ConfigDirectory: t.TempDir()})
		if err != nil {
			t.Fatal(err)
		}
		a.inspector, err = dockerengine.NewImageInspectorWithLifecycle(ctx, a.ctx, a.engine, a.inspectionRoot, a.Store)
		if err != nil {
			t.Fatal(err)
		}
		a.dockerRuntime, err = dockerengine.NewRuntime(a.engine, a.Store.InstallationID(), nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		a.envRuntimeForTest = runtime
		return a
	}
	a := setup()
	first, err := a.probePackageEnvironment(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.started.Load() != 1 || saves.Load() != 1 {
		t.Fatal("cold preparation counts", runtime.started.Load(), saves.Load())
	}
	closeSettingsApp(t, a)
	b := setup()
	defer closeSettingsApp(t, b)
	second, err := b.probePackageEnvironment(ctx, id)
	if err != nil || second.NodeAbi != first.NodeAbi {
		t.Fatal("reopen", err)
	}
	if runtime.started.Load() != 1 || saves.Load() != 1 {
		t.Fatal("repeated probe or export", runtime.started.Load(), saves.Load())
	}
	scope, generation, err := b.engine.VerificationIdentity(ctx)
	if err != nil {
		t.Fatal(err)
	}
	key := corestore.PreparationKey{Engine: scope, Image: id, Kind: "environment", Platform: "linux/amd64/", Version: 1}
	raw, found, err := b.Store.ReadPreparation(ctx, key)
	if err != nil || !found {
		t.Fatal("missing persisted environment", err)
	}
	nextRule := key
	nextRule.Version++
	if _, hit, err := b.Store.ReadPreparation(ctx, nextRule); err != nil || hit {
		t.Fatal("changed rule reused old result", err)
	}
	if saved, err := b.Store.WritePreparation(ctx, nextRule, raw, nil); err != nil || !saved {
		t.Fatal("write next rule", err)
	}
	if err := b.Store.DeletePreparation(ctx, key); err != nil {
		t.Fatal(err)
	}
	b.environmentCache.Invalidate(environmentKey{imageID: id, version: 1, scope: scope, generation: generation})
	if _, err := b.probePackageEnvironment(ctx, id); err != nil {
		t.Fatal("reprobe after rule invalidation", err)
	}
	if runtime.started.Load() != 2 || saves.Load() != 1 {
		t.Fatal("rule invalidation did not reprobe", runtime.started.Load(), saves.Load())
	}
	missing.Store(true)
	if _, err := b.probePackageEnvironment(ctx, id); !errors.Is(err, dockerengine.ErrResourceMissing) {
		t.Fatal("missing image accepted", err)
	}
	missing.Store(false)
	runtime.remove = func(context.Context) error { return errors.New("synthetic cleanup failure") }
	if _, err := b.probePackageEnvironment(ctx, id); err == nil {
		t.Fatal("cleanup failure was accepted")
	}
	runtime.remove = nil
	if _, err := b.probePackageEnvironment(ctx, id); err != nil {
		t.Fatal(err)
	}
	if runtime.started.Load() != 4 || saves.Load() != 2 {
		t.Fatal("missing image did not invalidate", runtime.started.Load(), saves.Load())
	}
}
