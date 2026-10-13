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

func TestNativeShutdownRestartPreservesEnabledAndDisabledServices(t *testing.T) {
	a, base, auth, workID, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + workID
	services := make([]string, 0, 2)
	for _, name := range []string{"shutdown-enabled", "shutdown-disabled"} {
		status, accepted := packageHTTPCall(t, base, path+"/services", "POST", auth, map[string]any{
			"idempotencyKey": name,
			"definition": map[string]any{
				"name": name, "image": map[string]string{"reference": a.options.Initialization.Runtime.AgentImage},
				"workingDirectory": "/",
				"command":          "node", "args": []string{"-e", "require('node:http').createServer((q,s)=>s.end('ready')).listen(8099,'0.0.0.0')"},
				"ports":     []any{map[string]any{"name": "web", "protocol": "tcp", "containerPort": 8099}},
				"readiness": map[string]any{"kind": "http", "portName": "web", "path": "/", "deadlineMs": 10000},
			},
		})
		if status != 202 {
			t.Fatal("service acceptance", status, accepted)
		}
		waitWorkOperation(t, ctx, a, accepted["operationId"].(string))
		services = append(services, accepted["serviceId"].(string))
	}
	status, stopped := packageHTTPCall(t, base, path+"/services/"+services[1]+"/stop", "POST", auth, map[string]string{"idempotencyKey": "disable-before-core-shutdown"})
	if status != 202 {
		t.Fatal(status, stopped)
	}
	waitWorkOperation(t, ctx, a, stopped["operationId"].(string))
	before, err := a.Store.Work(ctx, workID, false)
	if err != nil || before.DesiredState != "running" || before.ActiveContextID == nil {
		t.Fatal("Work before shutdown", before, err)
	}
	containerIDs := make([]string, 0, 3)
	for _, identity := range []dockerengine.ContainerIdentity{
		{WorkID: workID, Kind: "agent", LogicalID: "agentd"},
		{WorkID: workID, Kind: "service", LogicalID: services[0]},
		{WorkID: workID, Kind: "service", LogicalID: services[1]},
	} {
		view, err := a.dockerRuntime.InspectContainer(ctx, identity)
		if err != nil || view == nil {
			t.Fatal("managed container before shutdown", identity.Kind, err)
		}
		containerIDs = append(containerIDs, view.ID)
	}
	if err := a.Close(context.Background()); err != nil {
		t.Fatal("normal Core shutdown", err)
	}
	raw, err := client.NewClientWithOpts(client.WithHost(a.options.DockerOptions.DockerHost), client.WithAPIVersionNegotiation())
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	for _, id := range containerIDs {
		view, err := raw.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
		if err != nil || view.Container.State.Running {
			t.Fatal("successful shutdown left a managed container running", err)
		}
	}
	next, _, _ := appFixture(t, a.options)
	after, err := next.Store.Work(ctx, workID, false)
	if err != nil || after.DesiredState != before.DesiredState || after.ActiveContextID == nil || *after.ActiveContextID != *before.ActiveContextID {
		t.Fatal("Core shutdown changed durable Work intent or configuration", after, err)
	}
	for index, id := range services {
		record, err := next.Store.Service(ctx, workID, id, false)
		if err != nil || record.Enabled != (index == 0) {
			t.Fatal("Core restart changed Service selection", index, err)
		}
		view, err := next.dockerRuntime.InspectContainer(ctx, dockerengine.ContainerIdentity{WorkID: workID, Kind: "service", LogicalID: id})
		if err != nil || view == nil || view.State.Running != (index == 0) {
			t.Fatal("Core restart did not follow Service selection", index, err)
		}
	}
	t.Log("normal Core shutdown confirmed Agent and Services stopped; same Work/context and enabled/disabled selections restored")
}

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
