package coreapp

import (
	"context"
	"database/sql"
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
	"piwork/internal/dockerengine"
	"piwork/internal/internaltls"
	"piwork/internal/workruntime"
)

func preparationFixture(t *testing.T, configure func(*runtimePreparation)) (*Application, string, string) {
	t.Helper()
	initialization := runtimeInitializationFixture()
	a, err := New(context.Background(), Options{DataDirectory: t.TempDir(), Initialization: initialization, FileHelperImage: "fixture/file", SnapshotHelperImage: "fixture/snapshot"})
	if err != nil {
		t.Fatal(err)
	}
	a.preparation.executeForTest = func(context.Context, string, RuntimeProfile) error { return nil }
	a.preparation.probeForTest = func(context.Context) error { return nil }
	configure(a.preparation)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := a.Close(ctx); err != nil {
			t.Fatal(err)
		}
	})
	address, err := a.Listen(ListenAddress{"127.0.0.1", 0})
	if err != nil {
		t.Fatal(err)
	}
	operator, _ := os.ReadFile(filepath.Join(a.options.DataDirectory, "operator.credential"))
	return a, address.URL(), "Operator " + strings.TrimSpace(string(operator))
}

func waitPreparation(t *testing.T, a *Application, condition func(Preparation) bool) Preparation {
	t.Helper()
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	for {
		a.mu.Lock()
		changed := a.preparation.changed
		a.mu.Unlock()
		value := a.Preparation()
		if condition(value) {
			return value
		}
		select {
		case <-deadline.C:
			t.Fatal("preparation did not reach expected state", a.Status(), value)
		case <-changed:
		}
	}
}

func TestPreparationSlowDependenciesDoNotBlockProbesOrDuplicateAttempts(t *testing.T) {
	gate := make(chan struct{})
	defer close(gate)
	var active, maximum atomic.Int32
	a, base, _ := preparationFixture(t, func(p *runtimePreparation) {
		p.executeForTest = func(ctx context.Context, name string, _ RuntimeProfile) error {
			current := active.Add(1)
			defer active.Add(-1)
			for previous := maximum.Load(); current > previous && !maximum.CompareAndSwap(previous, current); previous = maximum.Load() {
			}
			if name == "agent" || name == "packageHelper" {
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-gate:
				}
			}
			return nil
		}
	})
	waitPreparation(t, a, func(p Preparation) bool {
		return p.Components["agent"].State == "preparing" && p.Components["packageHelper"].State == "preparing"
	})
	started := time.Now()
	for i := 0; i < 12; i++ {
		if code, _ := httpCall(t, base, "/healthz", "GET", "", nil); code != 200 {
			t.Fatal(code)
		}
		if code, _ := httpCall(t, base, "/readyz", "GET", "", nil); code != 503 {
			t.Fatal(code)
		}
		if code, body := httpCall(t, base, "/control/status", "GET", "", nil); code != 200 || body["preparation"] == nil {
			t.Fatal(code, body)
		}
	}
	if time.Since(started) > time.Second || maximum.Load() > 3 || a.Preparation().Components["agent"].Attempt != 1 {
		t.Fatal("queries blocked or rescheduled preparation", time.Since(started), maximum.Load(), a.Preparation())
	}
}

func TestPreparationSlowDefaultsDoNotStarveFileOrSnapshotHelpers(t *testing.T) {
	blocked := make(chan struct{})
	defer close(blocked)
	a, _, _ := preparationFixture(t, func(p *runtimePreparation) {
		p.executeForTest = func(ctx context.Context, name string, _ RuntimeProfile) error {
			if name == "agent" || name == "packageHelper" {
				select {
				case <-blocked:
				case <-ctx.Done():
					return ctx.Err()
				}
			}
			return nil
		}
	})
	preparation := waitPreparation(t, a, func(value Preparation) bool {
		return value.Components["fileHelper"].State == "ready" && value.Components["snapshotHelper"].State == "ready" && value.Components["agent"].State == "preparing"
	})
	if a.Status().Ready || preparation.Components["defaultContext"].State == "ready" {
		t.Fatal("blocked default image incorrectly reported ready")
	}
}

func TestPreparationRetriesHelpersAndSeparatesBaseReadiness(t *testing.T) {
	var files, snapshots atomic.Int32
	allowFile := make(chan struct{})
	defer close(allowFile)
	a, base, _ := preparationFixture(t, func(p *runtimePreparation) {
		p.retryDelay = func(int) time.Duration { return 20 * time.Millisecond }
		p.executeForTest = func(ctx context.Context, name string, _ RuntimeProfile) error {
			switch name {
			case "fileHelper":
				if files.Add(1) == 1 {
					return errors.New("registry secret /private/path")
				}
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-allowFile:
					return nil
				}
			case "snapshotHelper":
				snapshots.Add(1)
				return dockerengine.ErrImageIncompatible
			}
			return nil
		}
	})
	waitPreparation(t, a, func(p Preparation) bool {
		return p.Components["fileHelper"].Attempt >= 2 && p.Components["snapshotHelper"].State == "failed" && a.Status().Ready
	})
	if code, body := httpCall(t, base, "/readyz", "GET", "", nil); code != 200 || body["preparation"] != nil || len(body) != 5 {
		t.Fatal("default readiness contract changed", code, body)
	}
	if code, body := httpCall(t, base, "/readyz?profile=docker-delivery", "GET", "", nil); code != 503 || body["reason"] != "DEPENDENCY_FAILED" || body["state"] != "READY" || strings.Contains(fmtJSON(body), "private") {
		t.Fatal(code, body)
	}
	if snapshots.Load() != 1 {
		t.Fatal("incompatible helper was retried", snapshots.Load())
	}
}

func TestPreparationFullProfileUnconfiguredInvalidAndShutdownContracts(t *testing.T) {
	a, base, _ := preparationFixture(t, func(*runtimePreparation) {})
	waitPreparation(t, a, func(p Preparation) bool { return p.Ready && a.Status().Ready })
	if code, body := httpCall(t, base, "/readyz?profile=docker-delivery", "GET", "", nil); code != 200 || body["ready"] != true || len(body) != 6 {
		t.Fatal(code, body)
	}
	for _, query := range []string{"?profile=private-secret", "?profile=", "?profile=docker-delivery&profile=docker-delivery"} {
		if code, body := httpCall(t, base, "/readyz"+query, "GET", "", nil); code != 400 || body["code"] != "INVALID_REQUEST" || body["field"] != "profile" || strings.Contains(fmtJSON(body), "private-secret") {
			t.Fatal(code, body)
		}
	}
	if err := a.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, component := range a.Preparation().Components {
		if component.Code == nil || *component.Code != "SHUTTING_DOWN" || component.State != "failed" || component.RetryAfterSeconds != nil {
			t.Fatal(component)
		}
	}
	empty, emptyBase, _ := appFixture(t, Options{})
	value := empty.Preparation()
	for _, component := range value.Components {
		if component.State != "unconfigured" || component.Attempt != 0 || component.Code == nil || *component.Code != "RUNTIME_UNCONFIGURED" {
			t.Fatal(component)
		}
	}
	if code, _ := httpCall(t, emptyBase, "/readyz?profile=docker-delivery", "GET", "", nil); code != 503 {
		t.Fatal(code)
	}
}

func TestPreparationConfigurationSaveCancelsOldGenerationAndKeepsAdminDTO(t *testing.T) {
	oldGate, newGate := make(chan struct{}), make(chan struct{})
	defer close(newGate)
	a, base, operator := preparationFixture(t, func(p *runtimePreparation) {
		p.executeForTest = func(ctx context.Context, name string, profile RuntimeProfile) error {
			if name == "agent" {
				if profile.Revision == 1 {
					<-oldGate
					return nil
				}
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-newGate:
				}
			}
			return nil
		}
	})
	waitPreparation(t, a, func(p Preparation) bool { return p.Components["agent"].State == "preparing" })
	input := map[string]string{"provider": "fixture", "model": "saved", "credential": "private-new-key"}
	started := time.Now()
	code, body := httpCall(t, base, "/control/runtime", "PUT", operator, input)
	if code != 200 || body["revision"] != float64(2) || time.Since(started) > time.Second {
		close(oldGate)
		t.Fatal("saved config waited for preparation", code, body)
	}
	close(oldGate)
	waitPreparation(t, a, func(p Preparation) bool {
		return p.Components["agent"].State == "preparing" && p.Components["docker"].State == "ready"
	})
	if a.Status().Ready {
		t.Fatal("old generation published ready for the new profile")
	}
	login, err := a.Identity.Login(context.Background(), "admin", "private-initial-password", "admin-contract")
	if err != nil {
		t.Fatal(err)
	}
	_, admin := httpCall(t, base, "/api/v1/admin/status", "GET", "Bearer "+login.Token, nil)
	if _, err := contracts.Decode[contracts.AdminStatus](strings.NewReader(fmtJSON(admin)), "AdminStatusSchema", 1<<20); err != nil {
		t.Fatal("strict AdminStatus changed", err, admin)
	}
}

func TestPreparationAttemptDeadlineHeartbeatRecoveryAndClose(t *testing.T) {
	if preparationAttemptTimeout != 10*time.Minute {
		t.Fatal("unexpected preparation deadline")
	}
	for index, want := range []time.Duration{time.Second, 5 * time.Second, 15 * time.Second, 30 * time.Second, time.Minute, time.Minute} {
		if preparationRetryDelay(index+1) != want {
			t.Fatal(index, want)
		}
	}
	var unavailable atomic.Bool
	a, _, _ := preparationFixture(t, func(p *runtimePreparation) {
		p.probeInterval, p.probeTimeout = 20*time.Millisecond, 30*time.Millisecond
		p.retryDelay = func(int) time.Duration { return 20 * time.Millisecond }
		p.executeForTest = func(ctx context.Context, name string, _ RuntimeProfile) error {
			if name == "docker" && unavailable.Load() {
				return dockerengine.ErrUnavailable
			}
			return nil
		}
		p.probeForTest = func(context.Context) error {
			if unavailable.Load() {
				return dockerengine.ErrUnavailable
			}
			return nil
		}
	})
	waitPreparation(t, a, func(p Preparation) bool { return p.Ready && a.Status().Ready })
	unavailable.Store(true)
	waitPreparation(t, a, func(p Preparation) bool { return p.Components["docker"].State == "retrying" && !a.Status().Ready })
	unavailable.Store(false)
	waitPreparation(t, a, func(p Preparation) bool { return p.Ready && a.Status().Ready })
	b, _, _ := preparationFixture(t, func(p *runtimePreparation) {
		p.attemptTimeout = 20 * time.Millisecond
		p.retryDelay = func(int) time.Duration { return 20 * time.Millisecond }
		p.executeForTest = func(ctx context.Context, name string, _ RuntimeProfile) error {
			if name == "agent" {
				<-ctx.Done()
				return ctx.Err()
			}
			return nil
		}
	})
	waitPreparation(t, b, func(p Preparation) bool { return p.Components["agent"].Attempt >= 2 })
	started := time.Now()
	if err := b.Close(context.Background()); err != nil || time.Since(started) > time.Second {
		t.Fatal("shutdown did not cancel preparation", err, time.Since(started))
	}
}

func TestPreparationEngineReplacementCancelsRecoveryAndFencesPublication(t *testing.T) {
	var identity atomic.Int32
	identity.Store(1)
	firstStarted, firstCancelled, secondStarted := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var attempts atomic.Int32
	a, _, _ := preparationFixture(t, func(p *runtimePreparation) {
		p.probeInterval = 20 * time.Millisecond
		p.retryDelay = func(int) time.Duration { return 20 * time.Millisecond }
		p.identityForTest = func(context.Context) (string, uint64, error) {
			if identity.Load() == 1 {
				return "first-engine", 1, nil
			}
			return "replacement-engine", 2, nil
		}
		p.recoveryForTest = func(ctx context.Context) error {
			if attempts.Add(1) == 1 {
				close(firstStarted)
				<-ctx.Done()
				close(firstCancelled)
				return ctx.Err()
			}
			select {
			case <-secondStarted:
			default:
				close(secondStarted)
			}
			return nil
		}
	})
	select {
	case <-firstStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("initial recovery did not start")
	}
	old := a.captureWorkRouteEpoch(context.Background())
	identity.Store(2)
	select {
	case <-firstCancelled:
	case <-time.After(3 * time.Second):
		t.Fatal("Engine replacement did not cancel old recovery")
	}
	select {
	case <-secondStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("recovery did not restart on the new Engine")
	}
	if err := a.publishWorkRoute(old, internaltls.Scope{}, "", workruntime.Started{}); !errors.Is(err, errWorkSuperseded) {
		t.Fatalf("old Engine attempt could publish: %v", err)
	}
	if err := a.publishWorkRoute(a.captureWorkRouteEpoch(context.Background()), internaltls.Scope{}, "", workruntime.Started{}); !errors.Is(err, workruntime.ErrRouteUnavailable) {
		t.Fatalf("current epoch did not reach route validation: %v", err)
	}
}

func TestPreparationImagePullsAreDeduplicatedRetryableAndImmutable(t *testing.T) {
	p := newRuntimePreparation(&Application{})
	gate := make(chan struct{})
	var calls atomic.Int32
	p.pullForTest = func(ctx context.Context, ref string) (dockerengine.PreparedImage, error) {
		calls.Add(1)
		<-gate
		return dockerengine.PreparedImage{Reference: ref, ID: "sha256:captured"}, nil
	}
	var group sync.WaitGroup
	for i := 0; i < 2; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			image, err := p.pullImage(context.Background(), "fixture/shared")
			if err != nil || image.ID != "sha256:captured" {
				t.Error(image, err)
			}
		}()
	}
	deadline := time.Now().Add(time.Second)
	for calls.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	close(gate)
	group.Wait()
	if calls.Load() != 1 {
		t.Fatal("duplicate exact-reference pull", calls.Load())
	}
	if image, err := p.pullImage(context.Background(), "fixture/shared"); err != nil || image.ID != "sha256:captured" || calls.Load() != 1 {
		t.Fatal("tag was resolved again", image, err)
	}
	newRevision := context.WithValue(context.Background(), preparationRevisionKey{}, int64(2))
	if _, err := p.pullImage(newRevision, "fixture/shared"); err != nil || calls.Load() != 2 {
		t.Fatal("new runtime revision reused an old reference resolution", calls.Load(), err)
	}
	calls.Store(1)
	p.pullForTest = func(context.Context, string) (dockerengine.PreparedImage, error) {
		if calls.Add(1) == 2 {
			return dockerengine.PreparedImage{}, dockerengine.ErrImagePull
		}
		return dockerengine.PreparedImage{ID: "sha256:recovered"}, nil
	}
	if _, err := p.pullImage(context.Background(), "fixture/retry"); err == nil {
		t.Fatal("first pull did not fail")
	}
	if image, err := p.pullImage(context.Background(), "fixture/retry"); err != nil || image.ID != "sha256:recovered" {
		t.Fatal("failed pull was cached permanently", image, err)
	}
}

func TestPreparationPullWaitersCancelIndependentlyAndEngineChangeInvalidates(t *testing.T) {
	app := &Application{}
	p := newRuntimePreparation(app)
	t.Cleanup(func() { _ = p.images.Close(context.Background()) })
	started, release := make(chan struct{}), make(chan struct{})
	var pulls atomic.Int32
	p.pullForTest = func(ctx context.Context, _ string) (dockerengine.PreparedImage, error) {
		if pulls.Add(1) == 1 {
			close(started)
			select {
			case <-release:
			case <-ctx.Done():
				return dockerengine.PreparedImage{}, ctx.Err()
			}
		}
		return dockerengine.PreparedImage{ID: "sha256:fixture", Labels: map[string]string{"label": "original"}, RepoDigests: []string{"digest"}}, nil
	}
	firstCtx, cancel := context.WithCancel(context.Background())
	firstDone := make(chan error, 1)
	go func() { _, err := p.pullImage(firstCtx, "fixture/agent"); firstDone <- err }()
	<-started
	secondDone := make(chan error, 1)
	go func() { _, err := p.pullImage(context.Background(), "fixture/agent"); secondDone <- err }()
	deadline := time.Now().Add(time.Second)
	for p.images.Stats().Waiters < 2 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if p.images.Stats().Waiters != 2 {
		close(release)
		t.Fatal("second waiter did not join the shared pull")
	}
	cancel()
	if err := <-firstDone; !errors.Is(err, context.Canceled) {
		close(release)
		t.Fatal("cancelled waiter did not return", err)
	}
	close(release)
	if err := <-secondDone; err != nil || pulls.Load() != 1 {
		t.Fatal("one waiter cancelled another", err, pulls.Load())
	}
	copy, err := p.pullImage(context.Background(), "fixture/agent")
	if err != nil {
		t.Fatal(err)
	}
	copy.Labels["label"], copy.RepoDigests[0] = "changed", "changed"
	again, err := p.pullImage(context.Background(), "fixture/agent")
	if err != nil || again.Labels["label"] != "original" || again.RepoDigests[0] != "digest" {
		t.Fatal("shared pull returned mutable cached state", err)
	}
	app.mu.Lock()
	p.engineEpoch++
	app.mu.Unlock()
	if _, err := p.pullImage(context.Background(), "fixture/agent"); err != nil || pulls.Load() != 2 {
		t.Fatal("new Engine reused a previous reference resolution", err, pulls.Load())
	}
}

func TestPreparationEngineLossCancelsOldComponentAttempt(t *testing.T) {
	var identity atomic.Int32
	identity.Store(1)
	started, cancelled := make(chan struct{}), make(chan struct{})
	var attempts atomic.Int32
	a, _, _ := preparationFixture(t, func(p *runtimePreparation) {
		p.probeInterval = 20 * time.Millisecond
		p.retryDelay = func(int) time.Duration { return 20 * time.Millisecond }
		p.identityForTest = func(context.Context) (string, uint64, error) {
			if identity.Load() == 1 {
				return "engine-one", 1, nil
			}
			return "engine-two", 2, nil
		}
		p.executeForTest = func(ctx context.Context, name string, _ RuntimeProfile) error {
			if name == "agent" && attempts.Add(1) == 1 {
				close(started)
				<-ctx.Done()
				close(cancelled)
				return ctx.Err()
			}
			return nil
		}
	})
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("old component did not start")
	}
	identity.Store(2)
	select {
	case <-cancelled:
	case <-time.After(3 * time.Second):
		t.Fatal("Engine replacement left the old component running")
	}
	waitPreparation(t, a, func(value Preparation) bool {
		return value.Components["agent"].State == "ready" && attempts.Load() >= 2
	})
}

func TestPreparationRealEngineSlowPullStatusAndProtocolFailure(t *testing.T) {
	// Real Go Engine client against a controllable Unix API fixture. No runnable
	// image is fabricated: incompatible labels must fail before image execution.
	socketDir, err := os.MkdirTemp("", "piwork-prep-engine-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(socketDir) })
	socket := filepath.Join(socketDir, "engine.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	gate := make(chan struct{})
	var pulled atomic.Bool
	var pulls atomic.Int32
	id := "sha256:" + strings.Repeat("a", 64)
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/info"):
			json.NewEncoder(w).Encode(map[string]string{"ID": "fixture-daemon", "Driver": "overlay2", "DockerRootDir": "/var/lib/docker"})
		case strings.HasSuffix(r.URL.Path, "/_ping"):
			w.Header().Set("API-Version", "1.51")
			w.WriteHeader(200)
		case strings.HasSuffix(r.URL.Path, "/version"):
			json.NewEncoder(w).Encode(map[string]string{"ApiVersion": "1.51", "MinAPIVersion": "1.44", "Os": "linux", "Arch": "amd64"})
		case strings.HasSuffix(r.URL.Path, "/images/create"):
			pulls.Add(1)
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte("{\"status\":\"waiting\"}\n"))
			w.(http.Flusher).Flush()
			select {
			case <-r.Context().Done():
				return
			case <-gate:
				pulled.Store(true)
			}
		case strings.Contains(r.URL.Path, "/images/") && strings.HasSuffix(r.URL.Path, "/json"):
			if !pulled.Load() {
				http.Error(w, "missing", 404)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"Id": id, "Os": "linux", "Architecture": "amd64", "Config": map[string]any{"Labels": map[string]string{"io.piwork.agent.protocol": "incompatible"}}})
		default:
			http.NotFound(w, r)
		}
	})}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close(); listener.Close() })
	initialization := runtimeInitializationFixture()
	a, err := New(context.Background(), Options{DataDirectory: t.TempDir(), Initialization: initialization, DockerOptions: dockerengine.SelectionOptions{DockerHost: "unix://" + socket, DockerConfig: t.TempDir()}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { closeSettingsApp(t, a) })
	address, err := a.Listen(ListenAddress{"127.0.0.1", 0})
	if err != nil {
		t.Fatal(err)
	}
	waitPreparation(t, a, func(p Preparation) bool {
		return p.Components["agent"].State == "preparing" && p.Components["packageHelper"].State == "preparing" && pulls.Load() == 1
	})
	if code, body := httpCall(t, address.URL(), "/control/status", "GET", "", nil); code != 200 || body["ready"] != false {
		t.Fatal(code, body)
	}
	close(gate)
	waitPreparation(t, a, func(p Preparation) bool {
		return p.Components["agent"].State == "failed" && p.Components["packageHelper"].State == "failed"
	})
	if pulls.Load() != 1 {
		t.Fatal("shared image was pulled twice", pulls.Load())
	}
}

func TestPreparationRecoveryRunsBeforeDefaultsAndSurvivesConfigChange(t *testing.T) {
	started, recoveryGate, recoveryDone := make(chan struct{}), make(chan struct{}), make(chan struct{})
	agentGate := make(chan struct{})
	cancelled := make(chan struct{}, 1)
	var first atomic.Bool
	a, base, operator := preparationFixture(t, func(p *runtimePreparation) {
		p.recoveryForTest = func(ctx context.Context) error {
			if !first.CompareAndSwap(false, true) {
				return nil
			}
			close(started)
			select {
			case <-ctx.Done():
				cancelled <- struct{}{}
				return ctx.Err()
			case <-recoveryGate:
				close(recoveryDone)
				return nil
			}
		}
		p.executeForTest = func(ctx context.Context, name string, _ RuntimeProfile) error {
			if name == "agent" {
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-agentGate:
				}
			}
			return nil
		}
	})
	defer func() {
		select {
		case <-recoveryGate:
		default:
			close(recoveryGate)
		}
		select {
		case <-agentGate:
		default:
			close(agentGate)
		}
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("recovery waited for default agent")
	}
	if a.Status().Ready {
		t.Fatal("default dependency should keep global readiness false")
	}
	code, _ := httpCall(t, base, "/control/runtime", "PUT", operator, map[string]string{"provider": "fixture", "model": "new-default", "credential": "synthetic-only"})
	if code != 200 {
		t.Fatal("default update failed", code)
	}
	select {
	case <-cancelled:
		t.Fatal("default update cancelled an unrelated recovery")
	case <-time.After(150 * time.Millisecond):
	}
	close(recoveryGate)
	select {
	case <-recoveryDone:
	case <-time.After(3 * time.Second):
		t.Fatal("recovery did not complete")
	}
	if a.Status().Ready {
		t.Fatal("global readiness skipped default preparation")
	}
	close(agentGate)
	waitPreparation(t, a, func(p Preparation) bool { return p.Components["defaultContext"].State == "ready" && a.Status().Ready })
}

func TestPreparationRunsRecoveryWhenDefaultRuntimeIsMissing(t *testing.T) {
	ctx := context.Background()
	init := runtimeInitializationFixture()
	init.Runtime = nil
	a, err := New(ctx, Options{DataDirectory: t.TempDir(), Initialization: init, Shutdown: func(context.Context, *Application) error { return nil }})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { closeSettingsApp(t, a) })
	login, err := a.Identity.Login(ctx, init.Administrator.Account, init.Administrator.Password, "recovery-without-default")
	if err != nil {
		t.Fatal(err)
	}
	now := packageNow()
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at) VALUES(?,?,?,'running','unknown',1,1,?,?)`, "work-existing-no-default", login.User.ID, "Existing Work", now, now)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	started, packagesStarted := make(chan struct{}), make(chan struct{})
	var once, packagesOnce sync.Once
	a.preparation.executeForTest = func(context.Context, string, RuntimeProfile) error { return nil }
	a.preparation.probeForTest = func(context.Context) error { return nil }
	a.preparation.recoveryForTest = func(context.Context) error { once.Do(func() { close(started) }); return nil }
	a.preparation.packageRecoveryForTest = func(context.Context) error { packagesOnce.Do(func() { close(packagesStarted) }); return nil }
	if _, err := a.Listen(ListenAddress{"127.0.0.1", 0}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("missing default prevented recovery")
	}
	select {
	case <-packagesStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("missing default prevented package cleanup")
	}
	status := a.Status()
	if status.Ready || status.State != "RUNTIME_NOT_CONFIGURED" {
		t.Fatal("missing default reported globally ready", status)
	}
	if entry := a.Preparation().Components["docker"]; entry.State != "ready" {
		t.Fatal("Docker not initialized for retained Work", entry)
	}
}

func TestCorePackageRecoveryIsSharedAndFencedByEngineEpoch(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	a, _, _ := preparationFixture(t, func(p *runtimePreparation) {
		p.packageRecoveryForTest = func(ctx context.Context) error {
			if calls.Add(1) == 1 {
				close(started)
				select {
				case <-release:
				case <-ctx.Done():
					return ctx.Err()
				}
			}
			return nil
		}
	})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("package recovery did not start")
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if err := a.ensureCorePackageRecovery(cancelled); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled waiter was not released: %v", err)
	}
	close(release)
	if err := a.ensureCorePackageRecovery(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatalf("same Engine recovered packages %d times", calls.Load())
	}
	a.mu.Lock()
	a.preparation.engineEpoch++
	a.mu.Unlock()
	if err := a.ensureCorePackageRecovery(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatalf("new Engine did not revalidate package recovery: %d", calls.Load())
	}
}

func TestRecoverySignalsReevaluateOnlyAffectedWorks(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	a := &Application{ctx: ctx, cancel: cancel}
	p := newRuntimePreparation(a)
	a.preparation = p
	p.engineOnline = true
	p.engineEpoch = 1
	p.recoveryStarted = true
	events := make(chan []string, 4)
	p.recoveryTargetsForTest = func(_ context.Context, ids []string) error {
		events <- append([]string(nil), ids...)
		return nil
	}
	a.recoveryWG.Add(1)
	go p.recoveryLoop()
	defer func() { cancel(); a.recoveryWG.Wait() }()
	a.mu.Lock()
	p.wakeRecoveryLocked()
	a.mu.Unlock()
	select {
	case ids := <-events:
		if len(ids) != 0 {
			t.Fatalf("startup inventory was not full: %v", ids)
		}
	case <-time.After(time.Second):
		t.Fatal("startup inventory did not run")
	}
	a.wakeWorkRecovery("affected", "affected")
	select {
	case ids := <-events:
		if len(ids) != 1 || ids[0] != "affected" {
			t.Fatalf("cleanup woke unrelated Work or duplicated work: %v", ids)
		}
	case <-time.After(time.Second):
		t.Fatal("affected Work was not rechecked")
	}
}

func TestPreparationRecoveryFailureDoesNotPublishGlobalReady(t *testing.T) {
	var fail atomic.Bool
	fail.Store(true)
	a, base, _ := preparationFixture(t, func(p *runtimePreparation) {
		p.retryDelay = func(int) time.Duration { return 25 * time.Millisecond }
		p.recoveryForTest = func(context.Context) error {
			if fail.Load() {
				return errors.New("synthetic recovery failure")
			}
			return nil
		}
	})
	waitPreparation(t, a, func(p Preparation) bool {
		return p.Components["defaultContext"].State == "ready" && a.Status().State == "RUNTIME_UNAVAILABLE"
	})
	if code, _ := httpCall(t, base, "/readyz?profile=docker-delivery", "GET", "", nil); code != 503 {
		t.Fatal("failed recovery reported ready", code)
	}
	fail.Store(false)
	waitPreparation(t, a, func(p Preparation) bool { return p.Ready && a.Status().Ready })
}
