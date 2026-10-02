//go:build integration

package dockerengine

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/moby/moby/client"
	"piwork/internal/corestore"
	"piwork/internal/testsupport"
)

func TestRealHTTP_TCP_ExecReadinessAndFixedImage(t *testing.T) {
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	t.Setenv("PATH", filepath.Join(t.TempDir(), "no-tools"))
	endpoint, err := SelectEndpoint(SelectionOptions{DockerHost: host, DockerConfig: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	engine, err := Connect(context.Background(), endpoint)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { engine.Close() })
	scope, err := testsupport.NewScope()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		if err := scope.Cleanup(ctx, engine.api); err != nil {
			t.Error(err)
		}
	})
	store, err := corestore.Open(context.Background(), corestore.Options{Directory: t.TempDir(), InstallationID: scope.ID()})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	runtime, err := NewRuntime(engine, scope.ID(), func(ctx context.Context, plan ResourcePlan) error {
		return store.RecordResourceIntent(ctx, corestore.ResourceIntent{WorkID: plan.WorkID, Kind: plan.Kind, LogicalID: plan.LogicalID, Name: plan.Name, Labels: plan.Labels})
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	image, err := engine.PrepareImage(ctx, "python:3.13-slim")
	if err != nil {
		t.Fatal(err)
	}
	same, err := engine.PrepareImage(ctx, image.ID)
	if err != nil || same.ID != image.ID {
		t.Fatal(same, err)
	}
	bridge, err := runtime.EnsureNetwork(ctx, "work-probe")
	if err != nil {
		t.Fatal(err)
	}
	spec := fixtureSpec()
	spec.Identity.WorkID = "work-probe"
	spec.Identity.LogicalID = "probe-service"
	spec.Image = image.ID
	spec.DisplayName = ""
	spec.Network = &ContainerNetwork{Name: bridge.Name, WorkID: "work-probe", Aliases: []string{"svc-probe"}}
	spec.Command = []string{"python", "-c", `from http.server import BaseHTTPRequestHandler,HTTPServer
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  self.send_response(200 if self.path=='/healthy' else 503)
  self.end_headers()
  self.wfile.write(b'ok')
HTTPServer(('0.0.0.0',8000),Handler).serve_forever()`}
	if _, err := runtime.EnsureContainer(ctx, spec); err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.StartContainer(ctx, spec.Identity); err != nil {
		t.Fatal(err)
	}
	healthy := Probe{Kind: "http", NetworkName: bridge.Name, Port: 8000, Path: "/healthy", Timeout: time.Second}
	deadline := time.Now().Add(5 * time.Second)
	for {
		ready, err := runtime.Probe(ctx, spec.Identity, healthy)
		if err != nil {
			t.Fatal(err)
		}
		if ready {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("HTTP never ready")
		}
		time.Sleep(50 * time.Millisecond)
	}
	tests := []struct {
		probe Probe
		ready bool
	}{
		{Probe{Kind: "tcp", NetworkName: bridge.Name, Port: 8000, Timeout: time.Second}, true},
		{Probe{Kind: "http", NetworkName: bridge.Name, Port: 8000, Path: "/unavailable", Timeout: time.Second}, false},
		{Probe{Kind: "tcp", NetworkName: bridge.Name, Port: 8001, Timeout: time.Second}, false},
		{Probe{Kind: "exec", Command: []string{"python", "-c", "raise SystemExit(0)"}, Timeout: time.Second}, true},
		{Probe{Kind: "exec", Command: []string{"python", "-c", "raise SystemExit(7)"}, Timeout: time.Second}, false},
		{Probe{Kind: "exec", Command: []string{"python", "-c", "import sys;sys.stderr.write('x'*1048576)"}, Timeout: time.Second}, true},
	}
	for _, test := range tests {
		ready, err := runtime.Probe(ctx, spec.Identity, test.probe)
		if err != nil || ready != test.ready {
			t.Fatalf("probe %s: ready=%v wanted=%v error=%v", test.probe.Kind, ready, test.ready, err)
		}
	}
	invalid := healthy
	invalid.Path = "http://outside.example/"
	if _, err := runtime.Probe(ctx, spec.Identity, invalid); !errors.Is(err, ErrSpecification) {
		t.Fatal(err)
	}
	// A peer on another Work bridge cannot reach this otherwise healthy app.
	address, err := runtime.ContainerAddress(ctx, spec.Identity, bridge.Name)
	if err != nil {
		t.Fatal(err)
	}
	otherBridge, err := runtime.EnsureNetwork(ctx, "work-other-probe")
	if err != nil {
		t.Fatal(err)
	}
	peer := spec
	peer.Identity.WorkID = "work-other-probe"
	peer.Identity.LogicalID = "peer-service"
	peer.Network = &ContainerNetwork{Name: otherBridge.Name, WorkID: peer.Identity.WorkID, Aliases: []string{"svc-peer"}}
	if _, err := runtime.EnsureContainer(ctx, peer); err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.StartContainer(ctx, peer.Identity); err != nil {
		t.Fatal(err)
	}
	cross := `import urllib.request
try:
 urllib.request.urlopen('http://` + address + `:8000/healthy',timeout=.3)
except Exception:
 raise SystemExit(0)
raise SystemExit(1)`
	peerView, err := runtime.InspectContainer(ctx, peer.Identity)
	if err != nil {
		t.Fatal(err)
	}
	crossCtx, crossCancel := context.WithTimeout(ctx, 10*time.Second)
	defer crossCancel()
	created, err := engine.api.ExecCreate(crossCtx, peerView.ID, client.ExecCreateOptions{Cmd: []string{"python", "-c", cross}, AttachStdout: true, AttachStderr: true})
	if err != nil {
		t.Fatal(err)
	}
	attached, err := engine.api.ExecAttach(crossCtx, created.ID, client.ExecAttachOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if err := Demultiplex(crossCtx, attached.Reader, io.Discard, io.Discard); err != nil {
		attached.Close()
		t.Fatal(err)
	}
	attached.Close()
	for {
		observed, err := engine.api.ExecInspect(crossCtx, created.ID, client.ExecInspectOptions{})
		if err != nil {
			t.Fatal(err)
		}
		if !observed.Running {
			if observed.ExitCode != 0 {
				t.Fatal("another Work reached private app", observed.ExitCode)
			}
			break
		}
		if crossCtx.Err() != nil {
			t.Fatal("cross-Work check deadline")
		}
		time.Sleep(20 * time.Millisecond)
	}
	execCode := func(containerID, code string) {
		t.Helper()
		bounded, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		job, err := engine.api.ExecCreate(bounded, containerID, client.ExecCreateOptions{Cmd: []string{"python", "-c", code}, AttachStdout: true, AttachStderr: true})
		if err != nil {
			t.Fatal(err)
		}
		stream, err := engine.api.ExecAttach(bounded, job.ID, client.ExecAttachOptions{})
		if err != nil {
			t.Fatal(err)
		}
		err = Demultiplex(bounded, stream.Reader, io.Discard, io.Discard)
		stream.Close()
		if err != nil {
			t.Fatal(err)
		}
		for {
			view, err := engine.api.ExecInspect(bounded, job.ID, client.ExecInspectOptions{})
			if err != nil {
				t.Fatal(err)
			}
			if !view.Running {
				if view.ExitCode != 0 {
					t.Fatal("temporary storage assertion", view.ExitCode)
				}
				return
			}
			time.Sleep(20 * time.Millisecond)
		}
	}
	beforeRebuild, err := runtime.InspectContainer(ctx, spec.Identity)
	if err != nil {
		t.Fatal(err)
	}
	execCode(beforeRebuild.ID, "from pathlib import Path; Path('/dev/shm/temporary-only').write_text('discard me')")
	started := time.Now()
	ready, err := runtime.Probe(ctx, spec.Identity, Probe{Kind: "exec", Command: []string{"python", "-c", "import time;time.sleep(5)"}, Timeout: 100 * time.Millisecond})
	if err != nil || ready || time.Since(started) > time.Second {
		t.Fatal("unbounded exec observation", ready, err, time.Since(started))
	}
	if _, err := runtime.StopContainer(ctx, spec.Identity, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.Probe(ctx, spec.Identity, healthy); !errors.Is(err, ErrStateUnknown) {
		t.Fatal("stopped container marked ready", err)
	}
	// A mutable source tag is never substituted for a captured image identity.
	tag := scope.ID() + ":mutable"
	if _, err := engine.api.ImageTag(ctx, client.ImageTagOptions{Source: image.ID, Target: tag}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = engine.api.ImageRemove(context.Background(), tag, client.ImageRemoveOptions{}) })
	captured, err := engine.PrepareImage(ctx, tag)
	if err != nil || captured.ID != image.ID {
		t.Fatal(captured, err)
	}
	other, err := engine.PrepareImage(ctx, os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := engine.api.ImageTag(ctx, client.ImageTagOptions{Source: other.ID, Target: tag}); err != nil {
		t.Fatal(err)
	}
	if err := runtime.RemoveContainer(ctx, spec.Identity); err != nil {
		t.Fatal(err)
	}
	if err := store.ReleaseResourceIntent(ctx, spec.Identity.WorkID, "service", spec.Identity.LogicalID, true); err != nil {
		t.Fatal(err)
	}
	spec.Image = captured.ID
	if _, err := runtime.EnsureContainer(ctx, spec); err != nil {
		t.Fatal(err)
	}
	view, err := runtime.InspectContainer(ctx, spec.Identity)
	if err != nil || view.Image != image.ID {
		t.Fatal("changed tag replaced captured image", view, err)
	}
	if _, err := runtime.StartContainer(ctx, spec.Identity); err != nil {
		t.Fatal(err)
	}
	execCode(view.ID, "from pathlib import Path; assert not Path('/dev/shm/temporary-only').exists()")
	listed, err := engine.api.ContainerList(ctx, client.ContainerListOptions{All: true, Filters: filtersFor(map[string]string{InstallationLabel: scope.ID()})})
	if err != nil || len(listed.Items) != 2 {
		t.Fatal("unexpected probe container count", len(listed.Items), err)
	}
	t.Logf("fixed image plus real HTTP/TCP/exec readiness passed in %s", scope.ID())
}
