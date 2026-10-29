//go:build integration

package dockerengine

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestRealEngineWithNoDockerCLI(t *testing.T) {
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
	defer engine.Close()
	t.Logf("local Engine negotiated API %s; no resources created", engine.APIVersion)
}

// This fixture restarts only the uniquely named disposable inner daemon. It
// never restarts or modifies the host Engine used by other installations.
func TestIsolatedRealEngineIdentitySurvivesDaemonRestart(t *testing.T) {
	image := os.Getenv("PIWORK_TEST_ISOLATED_DIND_IMAGE")
	if image == "" {
		t.Skip("set PIWORK_TEST_ISOLATED_DIND_IMAGE to a local Docker-in-Docker fixture")
	}
	if out, err := exec.Command("docker", "image", "inspect", image).CombinedOutput(); err != nil || len(out) == 0 {
		t.Fatal("isolated Engine fixture image is not present locally")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	directory := t.TempDir()
	name := "piwork-identity-fixture-" + uuid.NewString()
	command := exec.CommandContext(ctx, "docker", "run", "--detach", "--privileged", "--name", name, "--label", "piwork.test_fixture="+name, "--env", "DOCKER_TLS_CERTDIR=", "--mount", "type=bind,src="+directory+",dst=/var/run", image, "--host=unix:///var/run/docker.sock", "--tls=false")
	out, err := command.Output()
	if err != nil {
		t.Fatal("isolated Engine fixture did not start")
	}
	containerID := strings.TrimSpace(string(out))
	if len(containerID) != 64 {
		t.Fatal("invalid isolated Engine container identity")
	}
	t.Cleanup(func() {
		cleanup, done := context.WithTimeout(context.Background(), 30*time.Second)
		defer done()
		if err := exec.CommandContext(cleanup, "docker", "rm", "--force", "--volumes", containerID).Run(); err != nil {
			t.Error("isolated Engine fixture cleanup was not confirmed")
		}
		// The daemon creates root-owned files in the disposable bind mount.
		// Make only that exact test directory removable by the test owner.
		if err := exec.CommandContext(cleanup, "docker", "run", "--rm", "--network", "none", "--label", "piwork.test_fixture="+name+"-cleanup", "--entrypoint", "chmod", "--mount", "type=bind,src="+directory+",dst=/fixture", image, "-R", "a+rwX", "/fixture").Run(); err != nil {
			t.Error("isolated Engine directory cleanup was not confirmed")
		}
	})
	socket := filepath.Join(directory, "docker.sock")
	waitSocket := func() {
		t.Helper()
		for {
			if ctx.Err() != nil {
				t.Fatal("isolated Engine did not become available")
			}
			if _, err := os.Stat(socket); err == nil && exec.CommandContext(ctx, "docker", "exec", containerID, "chmod", "666", "/var/run/docker.sock").Run() == nil {
				endpoint, err := SelectEndpoint(SelectionOptions{DockerHost: "unix://" + socket, DockerConfig: t.TempDir()})
				if err == nil {
					probe, err := Connect(ctx, endpoint)
					if err == nil {
						_ = probe.Close()
						return
					}
				}
			}
			time.Sleep(200 * time.Millisecond)
		}
	}
	waitSocket()
	endpoint, err := SelectEndpoint(SelectionOptions{DockerHost: "unix://" + socket, DockerConfig: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	engine, err := Connect(ctx, endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	before, generation, err := engine.VerificationIdentity(ctx)
	if err != nil || before == "" {
		t.Fatal("isolated Engine identity unavailable")
	}
	if err := exec.CommandContext(ctx, "docker", "stop", "--time", "15", containerID).Run(); err != nil {
		t.Fatal("isolated Engine could not be stopped")
	}
	if err := engine.Ping(ctx); err == nil {
		t.Fatal("stopped Engine remained available")
	}
	if err := exec.CommandContext(ctx, "docker", "start", containerID).Run(); err != nil {
		t.Fatal("isolated Engine could not be restarted")
	}
	waitSocket()
	after, next, err := engine.VerificationIdentity(ctx)
	if err != nil || before != after || next <= generation {
		t.Fatal("same Engine identity was not retained and connection fenced")
	}
}

func TestRealEngineVerificationIdentityAcrossConnections(t *testing.T) {
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	endpoint, err := SelectEndpoint(SelectionOptions{DockerHost: host, DockerConfig: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	first, err := Connect(context.Background(), endpoint)
	if err != nil {
		t.Fatal(err)
	}
	scope, generation, err := first.VerificationIdentity(context.Background())
	if err != nil || scope == "" || generation == 0 {
		first.Close()
		t.Fatal("identity unavailable", err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	second, err := Connect(context.Background(), endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	again, _, err := second.VerificationIdentity(context.Background())
	if err != nil || again != scope {
		t.Fatal("daemon identity changed across connections", err)
	}
}
