//go:build integration

package coreapp

import (
	"context"
	"testing"
	"time"

	"github.com/moby/moby/client"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
)

func TestNativeShutdownConfirmsOtherWorksAfterFailedAgentDrain(t *testing.T) {
	a, base, auth, first, ctx := nativeApplyFixture(t)
	defaults, err := a.Store.DefaultWork(ctx)
	if err != nil {
		t.Fatal(err)
	}
	config := *defaults.Configuration
	config.McpServers = []contracts.McpServer{}
	status, created := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]any{"name": "Second Shutdown Work", "configuration": config, "idempotencyKey": "second-shutdown"})
	if status != 202 {
		t.Fatal(status, created)
	}
	second := created["workId"].(string)
	waitWorkOperation(t, ctx, a, created["operationId"].(string))
	a.options.WorkDrainTimeout = 250 * time.Millisecond
	a.options.WorkStopTimeout = 100 * time.Millisecond
	a.options.ShutdownTimeout = 3 * time.Second
	agents := map[string]string{}
	for _, id := range []string{first, second} {
		container, err := a.dockerRuntime.InspectContainer(ctx, dockerengine.ContainerIdentity{WorkID: id, Kind: "agent", LogicalID: "agentd"})
		if err != nil || container == nil || !container.State.Running {
			t.Fatal(err, id)
		}
		agents[id] = container.ID
	}
	if err := a.dockerRuntime.KillContainer(ctx, dockerengine.ContainerIdentity{WorkID: first, Kind: "agent", LogicalID: "agentd"}); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	if err := a.Close(context.Background()); err == nil {
		t.Fatal("unconfirmed drain was reported as clean shutdown")
	}
	if time.Since(started) > 4*time.Second {
		t.Fatal("configured process deadline exceeded", time.Since(started))
	}
	raw, err := client.NewClientWithOpts(client.WithHost(a.options.DockerOptions.DockerHost), client.WithAPIVersionNegotiation())
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	for id, containerID := range agents {
		view, err := raw.ContainerInspect(ctx, containerID, client.ContainerInspectOptions{})
		if err != nil || view.Container.State.Running {
			t.Fatal("another Work was skipped after failed drain", id, err)
		}
	}
	reopened, err := corestore.Open(ctx, corestore.Options{Directory: a.options.DataDirectory})
	if err != nil {
		t.Fatal("shutdown retained store lock", err)
	}
	defer reopened.Close()
	for _, id := range []string{first, second} {
		work, err := reopened.Work(ctx, id, false)
		if err != nil || work.DesiredState != "running" || work.ActiveContextID == nil {
			t.Fatal("process shutdown changed user target or configuration", id, work, err)
		}
	}
}
