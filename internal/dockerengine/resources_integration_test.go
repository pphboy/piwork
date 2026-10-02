//go:build integration

package dockerengine

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
	"piwork/internal/corestore"
	"piwork/internal/testsupport"
)

func TestRealManagedResourceLifecycleAndOwnership(t *testing.T) {
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
	scope, err := testsupport.NewScope()
	if err != nil {
		t.Fatal(err)
	}
	other, err := testsupport.NewScope()
	if err != nil {
		t.Fatal(err)
	}
	for _, owned := range []*testsupport.Scope{scope, other} {
		t.Cleanup(func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if err := owned.Cleanup(ctx, engine.api); err != nil {
				t.Error(err)
			}
		})
	}
	s, err := corestore.Open(context.Background(), corestore.Options{Directory: t.TempDir(), InstallationID: scope.ID()})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	record := func(ctx context.Context, plan ResourcePlan) error {
		generation := int64(0)
		if raw := plan.Labels["piwork.generation"]; raw != "" {
			var err error
			generation, err = strconv.ParseInt(raw, 10, 64)
			if err != nil {
				return ErrIdentity
			}
		}
		return s.RecordResourceIntent(ctx, corestore.ResourceIntent{WorkID: plan.WorkID, Kind: plan.Kind, LogicalID: plan.LogicalID, Name: plan.Name, Generation: generation, Labels: plan.Labels})
	}
	runtime, err := NewRuntime(engine, scope.ID(), record, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	net, err := runtime.EnsureNetwork(ctx, "work-fixture")
	if err != nil {
		t.Fatal(err)
	}
	again, err := runtime.EnsureNetwork(ctx, "work-fixture")
	if err != nil || again.ID != net.ID {
		t.Fatal(again, err)
	}
	volume, err := runtime.EnsureVolume(ctx, "work-fixture", "work-workspace")
	if err != nil {
		t.Fatal(err)
	}
	againVolume, err := runtime.EnsureVolume(ctx, "work-fixture", "work-workspace")
	if err != nil || againVolume.Name != volume.Name {
		t.Fatal(againVolume, err)
	}
	images, err := engine.api.ImageList(ctx, client.ImageListOptions{Filters: make(client.Filters).Add("reference", "python:3.13-slim")})
	if err != nil || len(images.Items) == 0 {
		t.Fatal("existing fixture image is required", err)
	}
	spec := fixtureSpec()
	spec.Image = images.Items[0].ID
	spec.DisplayName = "w-" + strings.ReplaceAll(strings.TrimPrefix(scope.ID(), "piwork-test-"), "-", "") + "_counter"
	spec.Command = []string{"python", "-c", "import time;time.sleep(60)"}
	spec.Network = &ContainerNetwork{Name: net.Name, WorkID: "work-fixture", Aliases: []string{"svc-counter"}}
	spec.Mounts = []ContainerMount{{Type: "volume", Source: volume.Name, Target: "/var/data/workspace"}}
	var group sync.WaitGroup
	var values [6]EnsuredContainer
	var failures [6]error
	for i := range values {
		group.Add(1)
		go func(i int) { defer group.Done(); values[i], failures[i] = runtime.EnsureContainer(ctx, spec) }(i)
	}
	group.Wait()
	created := 0
	for i, value := range values {
		if failures[i] != nil {
			t.Fatal(failures[i])
		}
		if value.ID != values[0].ID {
			t.Fatal("multiple instances", values)
		}
		if value.Created {
			created++
		}
	}
	if created != 1 {
		t.Fatal(created)
	}
	view, err := runtime.StartContainer(ctx, spec.Identity)
	if err != nil || view == nil || !view.State.Running {
		t.Fatal(view, err)
	}
	if view.HostConfig.NanoCPUs != 100000000 || view.HostConfig.Memory != 64<<20 || len(view.HostConfig.PortBindings) != 0 || view.Config.User != "65532:65532" || !view.HostConfig.ReadonlyRootfs || len(view.Mounts) != 1 || view.Mounts[0].Destination != "/var/data/workspace" {
		t.Fatal("container policy mismatch")
	}
	containers, listErr := runtime.ListContainers(ctx, "service")
	if listErr != nil || len(containers) != 1 {
		t.Fatal(len(containers), listErr)
	}
	networks, listErr := runtime.ListNetworks(ctx)
	if listErr != nil || len(networks) != 1 {
		t.Fatal(len(networks), listErr)
	}
	volumes, listErr := runtime.ListVolumes(ctx)
	if listErr != nil || len(volumes) != 1 {
		t.Fatal(len(volumes), listErr)
	}
	if err := runtime.RemoveContainer(ctx, spec.Identity); !errors.Is(err, ErrResourceRunning) {
		t.Fatal(err)
	}
	// Name collision in another installation never grants ownership or cleanup.
	foreignLabels, _ := other.Labels()
	foreignName := resourceName("vol", scope.ID(), "foreign-work", "work-workspace")
	if _, err := engine.api.VolumeCreate(ctx, client.VolumeCreateOptions{Name: foreignName, Labels: foreignLabels}); err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.EnsureVolume(ctx, "foreign-work", "work-workspace"); !errors.Is(err, ErrIdentity) {
		t.Fatal(err)
	}
	if err := runtime.RemoveVolume(ctx, foreignName, "foreign-work", "work-workspace"); !errors.Is(err, ErrIdentity) {
		t.Fatal(err)
	}
	if _, err := engine.api.VolumeInspect(ctx, foreignName, client.VolumeInspectOptions{}); err != nil {
		t.Fatal("foreign volume disappeared", err)
	}
	foreignContainerName := "w-" + strings.ReplaceAll(strings.TrimPrefix(other.ID(), "piwork-test-"), "-", "") + "_foreign"
	if _, err := engine.api.ContainerCreate(ctx, client.ContainerCreateOptions{Name: foreignContainerName, Config: &container.Config{Image: spec.Image, Labels: foreignLabels, Cmd: []string{"/bin/true"}}, HostConfig: &container.HostConfig{NetworkMode: "none"}}); err != nil {
		t.Fatal(err)
	}
	collision := spec
	collision.Identity.LogicalID = "collision"
	collision.DisplayName = foreignContainerName
	if _, err := runtime.EnsureContainer(ctx, collision); !errors.Is(err, ErrSpecificationConflict) {
		t.Fatal(err)
	}
	if err := runtime.KillContainer(ctx, spec.Identity); err != nil {
		t.Fatal(err)
	}
	view, err = runtime.StopContainer(ctx, spec.Identity, 2)
	if err != nil || view == nil || view.State.Running {
		t.Fatal(view, err)
	}
	if err := runtime.RemoveContainer(ctx, spec.Identity); err != nil {
		t.Fatal(err)
	}
	if err := runtime.RemoveContainer(ctx, spec.Identity); err != nil {
		t.Fatal(err)
	}
	if err := runtime.RemoveNetwork(ctx, net.ID, "work-fixture"); err != nil {
		t.Fatal(err)
	}
	if err := runtime.RemoveVolume(ctx, volume.Name, "work-fixture", "work-workspace"); err != nil {
		t.Fatal(err)
	}
	t.Logf("managed lifecycle passed with installation %s; foreign resources protected under %s", scope.ID(), other.ID())
}
