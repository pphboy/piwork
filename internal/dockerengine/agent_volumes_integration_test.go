//go:build integration

package dockerengine

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"piwork/internal/testsupport"
)

// A newly created Work must be writable by the Agent's real UID without
// granting it the host's private Core files or merging its two data volumes.
func TestNativeAgentVolumeOwnershipAndSeparation(t *testing.T) {
	imageRef := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE")
	if imageRef == "" {
		t.Skip("set PIWORK_TEST_NATIVE_AGENT_IMAGE to the built native Agent image")
	}
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	t.Setenv("PATH", filepath.Join(t.TempDir(), "no-host-tools"))
	endpoint, err := SelectEndpoint(SelectionOptions{DockerHost: host, DockerConfig: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	engine, err := Connect(context.Background(), endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	scope, err := testsupport.NewScope()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := scope.Cleanup(ctx, engine.api); err != nil {
			t.Error(err)
		}
	})
	runtime, err := NewRuntime(engine, scope.ID(), func(context.Context, ResourcePlan) error { return nil }, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	image, err := engine.InspectImage(ctx, imageRef)
	if err != nil {
		t.Fatal(err)
	}
	private, err := runtime.EnsureVolume(ctx, "work-volume-owner", "work-private")
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := runtime.EnsureVolume(ctx, "work-volume-owner", "work-workspace")
	if err != nil {
		t.Fatal(err)
	}
	identity := ContainerIdentity{WorkID: "work-volume-owner", Kind: "agent", LogicalID: "agentd"}
	_, err = runtime.EnsureContainer(ctx, ContainerSpec{
		Identity: identity, Image: image.ID, User: "10001:10001", Entrypoint: []string{"/bin/sh", "-c"},
		Command: []string{"test -w /var/data && test -w /var/data/workspace && touch /var/data/private-test /var/data/workspace/shared-test"},
		Mounts: []ContainerMount{
			{Type: "volume", Source: private.Name, Target: "/var/data", CopyImageData: true},
			{Type: "volume", Source: workspace.Name, Target: "/var/data/workspace", CopyImageData: true},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.StartContainer(ctx, identity); err != nil {
		t.Fatal(err)
	}
	if err := waitContainerExit(ctx, runtime, identity); err != nil {
		t.Fatal("Agent UID cannot write its two volumes:", err)
	}
	// A service with only the workspace mount sees the shared file but has no
	// access to the Agent-private file in the other managed volume.
	service := ContainerIdentity{WorkID: "work-volume-owner", Kind: "service", LogicalID: "checker"}
	_, err = runtime.EnsureContainer(ctx, ContainerSpec{
		Identity: service, Image: image.ID, User: "10001:10001", Entrypoint: []string{"/bin/sh", "-c"},
		Command: []string{"test -f /var/data/workspace/shared-test && test ! -e /var/data/private-test"},
		Mounts:  []ContainerMount{{Type: "volume", Source: workspace.Name, Target: "/var/data/workspace"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.StartContainer(ctx, service); err != nil {
		t.Fatal(err)
	}
	if err := waitContainerExit(ctx, runtime, service); err != nil {
		t.Fatal("workspace visibility or private volume separation failed:", err)
	}
	readOnly := ContainerIdentity{WorkID: "work-volume-owner", Kind: "service", LogicalID: "read-only-checker"}
	_, err = runtime.EnsureContainer(ctx, ContainerSpec{
		Identity: readOnly, Image: image.ID, User: "10001:10001", Entrypoint: []string{"/bin/sh", "-c"},
		Command: []string{"test -f /var/data/workspace/shared-test && ! touch /var/data/workspace/denied && test ! -e /var/data/workspace/denied"},
		Mounts:  []ContainerMount{{Type: "volume", Source: workspace.Name, Target: "/var/data/workspace", ReadOnly: true}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.StartContainer(ctx, readOnly); err != nil {
		t.Fatal(err)
	}
	if err := waitContainerExit(ctx, runtime, readOnly); err != nil {
		t.Fatal("read-only grant was not enforced", err)
	}
}

func waitContainerExit(ctx context.Context, runtime *Runtime, identity ContainerIdentity) error {
	for {
		view, err := runtime.InspectContainer(ctx, identity)
		if err != nil {
			return err
		}
		if view == nil || view.State == nil {
			return ErrStateUnknown
		}
		if !view.State.Running && view.State.Status == "exited" {
			if view.State.ExitCode == 0 {
				return nil
			}
			return ErrSpecificationConflict
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(50 * time.Millisecond):
		}
	}
}
