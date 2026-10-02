//go:build integration

package testsupport

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
)

func TestRealEngineCleanupLeavesOtherInstallation(t *testing.T) {
	endpoint := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if endpoint == "" {
		endpoint = "unix:///var/run/docker.sock"
	}
	engine, err := client.NewClientWithOpts(client.WithHost(endpoint), client.WithAPIVersionNegotiation())
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if _, err := engine.Ping(ctx, client.PingOptions{}); err != nil {
		t.Fatalf("test Engine unavailable: %v", err)
	}
	images, err := engine.ImageList(ctx, client.ImageListOptions{Filters: make(client.Filters).Add("reference", "python:3.13-slim")})
	if err != nil || len(images.Items) == 0 {
		t.Fatal("integration requires the existing python:3.13-slim fixture image")
	}
	first, err := NewScope()
	if err != nil {
		t.Fatal(err)
	}
	other, err := NewScope()
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("installation scope: %s; protected fixture: %s", first.ID(), other.ID())
	for _, scope := range []*Scope{first, other} {
		t.Cleanup(func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if err := scope.Cleanup(ctx, engine); err != nil {
				t.Errorf("fixture cleanup failed: %v", err)
			}
		})
		labels, _ := scope.Labels()
		if _, err := engine.VolumeCreate(ctx, client.VolumeCreateOptions{Name: scope.ID() + "-volume", Labels: labels}); err != nil {
			t.Fatal(err)
		}
		if _, err := engine.NetworkCreate(ctx, scope.ID()+"-network", client.NetworkCreateOptions{Driver: "bridge", Internal: true, Labels: labels}); err != nil {
			t.Fatal(err)
		}
		if _, err := engine.ContainerCreate(ctx, client.ContainerCreateOptions{Name: scope.ID() + "-container", Config: &container.Config{Image: images.Items[0].ID, Labels: labels, Cmd: []string{"/bin/true"}}, HostConfig: &container.HostConfig{NetworkMode: "none", ReadonlyRootfs: true}}); err != nil {
			t.Fatal(err)
		}
	}
	if err := first.Cleanup(ctx, engine); err != nil {
		t.Fatal(err)
	}
	if _, err := engine.ContainerInspect(ctx, other.ID()+"-container", client.ContainerInspectOptions{}); err != nil {
		t.Fatal("another installation's container was removed", err)
	}
	if _, err := engine.NetworkInspect(ctx, other.ID()+"-network", client.NetworkInspectOptions{}); err != nil {
		t.Fatal("another installation's network was removed", err)
	}
	if _, err := engine.VolumeInspect(ctx, other.ID()+"-volume", client.VolumeInspectOptions{}); err != nil {
		t.Fatal("another installation's volume was removed", err)
	}
	filters, _ := first.Filters()
	remaining, err := engine.ContainerList(ctx, client.ContainerListOptions{All: true, Filters: filters})
	if err != nil || len(remaining.Items) != 0 {
		t.Fatal("owned container not cleaned", err)
	}
}

func TestExistingDeterministicSDKFixture(t *testing.T) {
	if err := RequireDeterministicModel(DeterministicProvider, DeterministicModel, "acceptance"); err != nil {
		t.Fatal(err)
	}
	_, source, _, _ := runtime.Caller(0)
	repo := filepath.Dir(filepath.Dir(filepath.Dir(source)))
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, "node", "--test", "--test-name-pattern=each SDK Run binds a fresh package loader", "apps/agentd/dist/pi-sdk-executor.test.js")
	command.Dir = repo
	// This is a development test runner, not a platform runtime subprocess.
	// No provider key, operator credential or user's Pi settings is forwarded.
	command.Env = []string{"PATH=" + os.Getenv("PATH"), "PIWORK_AGENT_VARIANT=acceptance"}
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("retained deterministic SDK fixture failed: %v\n%s", err, output)
	}
	t.Log(string(output))
}
