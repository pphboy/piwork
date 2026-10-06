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
	"piwork/internal/dockerengine"
)

func preparationFixture(t *testing.T, configure func(*runtimePreparation)) (*Application, string, string) {
	t.Helper()
	initialization, _ := InitializationFromEnvironment(dockerInitializationEnvironment())
	a, err := New(context.Background(), Options{DataDirectory: t.TempDir(), Initialization: initialization, FileHelperImage: "fixture/file", SnapshotHelperImage: "fixture/snapshot"})
	if err != nil {
		t.Fatal(err)
	}
	a.preparation.executeForTest = func(context.Context, string, RuntimeProfile) error { return nil }
	a.preparation.probeForTest = func(context.Context) error { return nil }
	configure(a.preparation)
	t.Cleanup(func() { closeSettingsApp(t, a) })
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
	if time.Since(started) > time.Second || maximum.Load() > 2 || a.Preparation().Components["agent"].Attempt != 1 {
		t.Fatal("queries blocked or rescheduled preparation", time.Since(started), maximum.Load(), a.Preparation())
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
	input := map[string]string{"agentImage": "fixture/new", "provider": "fixture", "model": "saved", "credential": "private-new-key"}
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
	initialization, _ := InitializationFromEnvironment(dockerInitializationEnvironment())
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
