//go:build integration

package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/moby/moby/client"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/internaltls"
)

func TestNativeCredentialRotationRestoresLegacyWork(t *testing.T) {
	gateway, image := nativeModelGateway(t)
	t.Setenv("PIWORK_TEST_NATIVE_AGENT_IMAGE", image)
	gateway.mu.Lock()
	gateway.allowedKey = "synthetic-old-key"
	gateway.mu.Unlock()
	baseURL := gateway.URL + "/v1"
	a, base, auth, workID, _ := nativeApplyFixture(t, RuntimeInput{Provider: "openai", Model: "gpt-5.1", BaseURL: &baseURL, Credential: "synthetic-old-key"})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	path := "/api/v1/works/" + workID
	session := modelNativeCall(t, base, auth, path+"/sessions", "POST", map[string]string{"idempotencyKey": "credential-session"}, 201)["sessionId"].(string)
	modelNativeRun(t, ctx, base, auth, workID, session, "before-rotation")
	if gateway.last().Key != "synthetic-old-key" {
		t.Fatal("original Run did not use the fixture credential")
	}
	identity := dockerengine.ContainerIdentity{WorkID: workID, Kind: "agent", LogicalID: "agentd"}
	before, err := a.dockerRuntime.InspectContainer(ctx, identity)
	if err != nil || before == nil {
		t.Fatal("original Agent unavailable", err)
	}
	emitCredentialFixtureLog(t, ctx, before.ID, "synthetic-old-key")
	beforeWork, err := a.Store.Work(ctx, workID, false)
	if err != nil || beforeWork.ActiveContextID == nil {
		t.Fatal("original active context unavailable", err)
	}
	modelID := ""
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		reg, err := modelRegistryTx(tx)
		if err != nil {
			return err
		}
		var modelRef string
		if err := tx.QueryRow(`SELECT json_extract(configuration_json,'$.modelRef') FROM work_context_snapshots WHERE work_id=? AND snapshot_id=?`, workID, *beforeWork.ActiveContextID).Scan(&modelRef); err != nil {
			return err
		}
		modelID = reg.References[modelRef]
		return nil
	}); err != nil || modelID == "" {
		t.Fatal("default model identity unavailable", err)
	}
	stop := modelNativeCall(t, base, auth, path+"/stop", "POST", map[string]string{"idempotencyKey": "credential-stop-same"}, 202)
	waitWorkOperation(t, ctx, a, stop["operationId"].(string))
	start := modelNativeCall(t, base, auth, path+"/start", "POST", map[string]string{"idempotencyKey": "credential-start-same"}, 202)
	waitWorkOperation(t, ctx, a, start["operationId"].(string))
	same, err := a.dockerRuntime.InspectContainer(ctx, identity)
	if err != nil || same == nil || same.ID != before.ID {
		t.Fatal("unchanged credential did not reuse Agent", err)
	}
	stop = modelNativeCall(t, base, auth, path+"/stop", "POST", map[string]string{"idempotencyKey": "credential-stop-rotate"}, 202)
	waitWorkOperation(t, ctx, a, stop["operationId"].(string))
	// Model a Work created before launch-binding metadata existed.
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`DELETE FROM control_metadata WHERE key LIKE 'runtime_launch_%' AND json_extract(value_json,'$.workId')=?`, workID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	modelNativeCall(t, base, auth, "/api/v1/admin/models/"+modelID, "PATCH", map[string]any{"credential": "synthetic-new-key"}, 200)
	gateway.mu.Lock()
	gateway.allowedKey = "synthetic-new-key"
	gateway.mu.Unlock()
	start = modelNativeCall(t, base, auth, path+"/start", "POST", map[string]string{"idempotencyKey": "credential-start-rotate"}, 202)
	waitWorkOperation(t, ctx, a, start["operationId"].(string))
	after, err := a.dockerRuntime.InspectContainer(ctx, identity)
	if err != nil || after == nil || after.ID == before.ID || after.Config.Labels["piwork.generation"] == before.Config.Labels["piwork.generation"] || after.Config.Image != before.Config.Image {
		t.Fatal("rotation did not replace the exact Agent generation", err)
	}
	for _, target := range []string{"/var/data", "/var/data/workspace"} {
		oldVolume, newVolume := "", ""
		for _, item := range before.HostConfig.Mounts {
			if item.Target == target {
				oldVolume = item.Source
			}
		}
		for _, item := range after.HostConfig.Mounts {
			if item.Target == target {
				newVolume = item.Source
			}
		}
		if oldVolume == "" || oldVolume != newVolume {
			t.Fatal("rotation changed a retained Work volume")
		}
	}
	afterWork, err := a.Store.Work(ctx, workID, false)
	if err != nil || afterWork.ActiveContextID == nil || *afterWork.ActiveContextID != *beforeWork.ActiveContextID {
		t.Fatal("rotation changed the active context", err)
	}
	modelNativeRun(t, ctx, base, auth, workID, session, "after-rotation")
	if gateway.last().Key != "synthetic-new-key" {
		t.Fatal("new Run did not use the current credential")
	}
	emitCredentialFixtureLog(t, ctx, after.ID, "synthetic-new-key")
	history := modelNativeCall(t, base, auth, path+"/sessions/"+session, "GET", nil, 200)
	if len(history["runs"].([]any)) < 2 {
		t.Fatal("session history was not restored")
	}
	secretPath := ""
	for _, item := range after.HostConfig.Mounts {
		if item.Target == "/run/secrets/model-api-key" {
			secretPath = item.Source
		}
	}
	if secretPath == "" {
		t.Fatal("generation credential mount missing")
	}
	stop = modelNativeCall(t, base, auth, path+"/stop", "POST", map[string]string{"idempotencyKey": "credential-stop-missing"}, 202)
	waitWorkOperation(t, ctx, a, stop["operationId"].(string))
	credential, err := os.ReadFile(secretPath)
	if err != nil || os.Remove(secretPath) != nil {
		t.Fatal("could not prepare missing credential fixture", err)
	}
	start = modelNativeCall(t, base, auth, path+"/start", "POST", map[string]string{"idempotencyKey": "credential-start-missing"}, 202)
	waitApplyFailure(t, ctx, a, start["operationId"].(string))
	if err := os.WriteFile(secretPath, credential, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(secretPath, 0644); err != nil {
		t.Fatal(err)
	}
	stop = modelNativeCall(t, base, auth, path+"/stop", "POST", map[string]string{"idempotencyKey": "credential-stop-corrupt"}, 202)
	waitWorkOperation(t, ctx, a, stop["operationId"].(string))
	if err := os.WriteFile(secretPath, []byte("synthetic-tampered-key\n"), 0644); err != nil {
		t.Fatal(err)
	}
	start = modelNativeCall(t, base, auth, path+"/start", "POST", map[string]string{"idempotencyKey": "credential-start-corrupt"}, 202)
	waitApplyFailure(t, ctx, a, start["operationId"].(string))
	if view, err := a.dockerRuntime.InspectContainer(ctx, identity); err != nil || view == nil || view.ID != after.ID || view.State.Running {
		t.Fatal("unsafe material was bypassed by replacing the Agent", err)
	}
	if err := os.WriteFile(secretPath, credential, 0644); err != nil {
		t.Fatal(err)
	}
	deleted := modelNativeCall(t, base, auth, path+"/delete", "POST", map[string]string{"idempotencyKey": "credential-delete"}, 202)
	waitWorkOperation(t, ctx, a, deleted["operationId"].(string))
	sources, err := a.Store.LogSources(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []struct{ containerID, secret string }{{before.ID, "synthetic-old-key"}, {after.ID, "synthetic-new-key"}} {
		found := false
		for _, source := range sources {
			if source.ContainerID != want.containerID || source.State != "archived" {
				continue
			}
			raw, err := os.ReadFile(filepath.Join(a.options.DataDirectory, "logs", "works", workID, source.SourceID, "stdout.log"))
			if err != nil || !strings.Contains(string(raw), "CREDENTIAL-LOG-MARKER") || strings.Contains(string(raw), want.secret) || !strings.Contains(string(raw), "[redacted]") {
				t.Fatal("Agent output was not safely archived")
			}
			found = true
		}
		if !found {
			t.Fatal("Agent archive was not retained")
		}
	}
}

func TestNativeCredentialAdoptionRejectsTamperedBinding(t *testing.T) {
	gateway, image := nativeModelGateway(t)
	t.Setenv("PIWORK_TEST_NATIVE_AGENT_IMAGE", image)
	baseURL := gateway.URL + "/v1"
	a, _, _, workID, ctx := nativeApplyFixture(t, RuntimeInput{Provider: "openai", Model: "gpt-5.1", BaseURL: &baseURL, Credential: "synthetic-adopt-a"})
	identity := dockerengine.ContainerIdentity{WorkID: workID, Kind: "agent", LogicalID: "agentd"}
	view, err := a.dockerRuntime.InspectContainer(ctx, identity)
	if err != nil || view == nil {
		t.Fatal("running Agent unavailable", err)
	}
	generation, err := strconv.ParseInt(view.Config.Labels["piwork.generation"], 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	instance, contextID := view.Config.Labels["piwork.instance_id"], view.Config.Labels["piwork.context_identity"]
	var path string
	for _, mount := range view.HostConfig.Mounts {
		if mount.Target == "/run/secrets/model-api-key" {
			path = mount.Source
		}
	}
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.WriteFile(path, original, 0644) })
	if err := os.WriteFile(path, []byte("synthetic-adopt-tampered\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := a.resolveWorkStartLocked(ctx, workID, generation, instance, contextID); !errors.Is(err, internaltls.ErrMaterial) {
		t.Fatal("adoption accepted material inconsistent with its binding", err)
	}
}

func TestNativeCredentialStartFailureBeforeConcurrentRecovery(t *testing.T) {
	gateway, image := nativeModelGateway(t)
	t.Setenv("PIWORK_TEST_NATIVE_AGENT_IMAGE", image)
	baseURL := gateway.URL + "/v1"
	a, base, auth, workID, ctx := nativeApplyFixture(t, RuntimeInput{Provider: "openai", Model: "gpt-5.1", BaseURL: &baseURL, Credential: "synthetic-ordered-a"})
	path := "/api/v1/works/" + workID
	session := modelNativeCall(t, base, auth, path+"/sessions", "POST", map[string]string{"idempotencyKey": "ordered-session"}, 201)["sessionId"].(string)
	stop := modelNativeCall(t, base, auth, path+"/stop", "POST", map[string]string{"idempotencyKey": "ordered-stop"}, 202)
	waitWorkOperation(t, ctx, a, stop["operationId"].(string))
	models := modelNativeCall(t, base, auth, "/api/v1/admin/models", "GET", nil, 200)["models"].([]any)
	modelID := models[0].(map[string]any)["id"].(string)
	modelNativeCall(t, base, auth, "/api/v1/admin/models/"+modelID, "PATCH", map[string]any{"credential": "synthetic-ordered-b"}, 200)
	gateway.mu.Lock()
	gateway.allowedKey = "synthetic-ordered-b"
	gateway.mu.Unlock()
	reached, release := make(chan struct{}), make(chan struct{})
	var inject, unblockOnce sync.Once
	unblock := func() { unblockOnce.Do(func() { close(release) }) }
	t.Cleanup(unblock)
	a.workResumeFaultForTest = func(stage string) error {
		if stage == "target-created" {
			var err error
			inject.Do(func() { err = errors.New("synthetic ordered start failure") })
			return err
		}
		if stage == "operation-failure" {
			close(reached)
			select {
			case <-release:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		return nil
	}
	start := modelNativeCall(t, base, auth, path+"/start", "POST", map[string]string{"idempotencyKey": "ordered-start"}, 202)
	select {
	case <-reached:
	case <-ctx.Done():
		t.Fatal("Start failure did not reach publication")
	}
	plan, found, err := a.runtimeReplacement(ctx, workID)
	if err != nil || !found {
		t.Fatal("replacement target missing", err)
	}
	done := make(chan error, 1)
	go func() {
		_, err, writeErr := a.startCapturedWorkForRecovery(ctx, workID, plan.Target.Generation, plan.Target.InstanceID, plan.ControlVersion)
		done <- errors.Join(err, writeErr)
	}()
	select {
	case err := <-done:
		t.Fatal("recovery passed the unpublished Start failure", err)
	case <-time.After(100 * time.Millisecond):
	}
	unblock()
	failed := waitApplyFailure(t, ctx, a, start["operationId"].(string))
	if failed.ErrorJSON == nil {
		t.Fatal("Start failure diagnostic missing")
	}
	if err := <-done; err != nil {
		t.Fatal("later recovery failed", err)
	}
	a.workResumeFaultForTest = nil
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil || work.ObservedState != "ready" {
		t.Fatal("Start failure overwrote recovered Work", err)
	}
	modelNativeRun(t, ctx, base, auth, workID, session, "ordered-recovered")
	if gateway.last().Key != "synthetic-ordered-b" {
		t.Fatal("recovered Run did not use rotated credential")
	}
}

func emitCredentialFixtureLog(t *testing.T, ctx context.Context, containerID, value string) {
	t.Helper()
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	engine, err := client.NewClientWithOpts(client.WithHost(host), client.WithAPIVersionNegotiation())
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	emit, err := engine.ExecCreate(ctx, containerID, client.ExecCreateOptions{Cmd: []string{"node", "-e", `require('node:fs').writeFileSync('/proc/1/fd/1',process.argv[1]+'\n')`, "CREDENTIAL-LOG-MARKER " + value}, AttachStdout: true, AttachStderr: true})
	if err != nil {
		t.Fatal(err)
	}
	stream, err := engine.ExecAttach(ctx, emit.ID, client.ExecAttachOptions{})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, stream.Reader)
	stream.Close()
}

func TestNativeCredentialReplacementRecoversInterruptedStages(t *testing.T) {
	gateway, image := nativeModelGateway(t)
	t.Setenv("PIWORK_TEST_NATIVE_AGENT_IMAGE", image)
	for _, stage := range []string{"replacement-prepared", "old-removed", "target-created"} {
		t.Run(stage, func(t *testing.T) {
			gateway.mu.Lock()
			gateway.allowedKey = "synthetic-stage-a"
			gateway.mu.Unlock()
			baseURL := gateway.URL + "/v1"
			a, base, auth, workID, _ := nativeApplyFixture(t, RuntimeInput{Provider: "openai", Model: "gpt-5.1", BaseURL: &baseURL, Credential: "synthetic-stage-a"})
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()
			path := "/api/v1/works/" + workID
			session := modelNativeCall(t, base, auth, path+"/sessions", "POST", map[string]string{"idempotencyKey": "stage-session"}, 201)["sessionId"].(string)
			modelNativeRun(t, ctx, base, auth, workID, session, "before-stage")
			requestCount := gateway.count()
			models := modelNativeCall(t, base, auth, "/api/v1/admin/models", "GET", nil, 200)["models"].([]any)
			if len(models) != 1 {
				t.Fatal("expected one fixture model")
			}
			modelID := models[0].(map[string]any)["id"].(string)
			stop := modelNativeCall(t, base, auth, path+"/stop", "POST", map[string]string{"idempotencyKey": "stage-stop"}, 202)
			waitWorkOperation(t, ctx, a, stop["operationId"].(string))
			modelNativeCall(t, base, auth, "/api/v1/admin/models/"+modelID, "PATCH", map[string]any{"credential": "synthetic-stage-b"}, 200)
			gateway.mu.Lock()
			gateway.allowedKey = "synthetic-stage-b"
			gateway.mu.Unlock()
			reached, proceed := make(chan struct{}), make(chan struct{})
			a.workResumeFaultForTest = func(actual string) error {
				if actual == stage {
					close(reached)
					<-proceed
					return errors.New("synthetic interrupted replacement")
				}
				return nil
			}
			start := modelNativeCall(t, base, auth, path+"/start", "POST", map[string]string{"idempotencyKey": "stage-start"}, 202)
			select {
			case <-reached:
			case <-ctx.Done():
				t.Fatal("replacement did not reach the selected boundary")
			}
			modelNativeCall(t, base, auth, "/api/v1/admin/models/"+modelID, "PATCH", map[string]any{"credential": "synthetic-stage-c"}, 200)
			gateway.mu.Lock()
			gateway.allowedKey = "synthetic-stage-c"
			gateway.mu.Unlock()
			close(proceed)
			waitApplyFailure(t, ctx, a, start["operationId"].(string))
			a.workResumeFaultForTest = nil
			plan, found, err := a.runtimeReplacement(ctx, workID)
			if err != nil || !found {
				t.Fatal("interrupted target was not retained", err)
			}
			data := a.options.DataDirectory
			options := a.options
			port := a.serviceListener.Addr().(*net.TCPAddr).Port
			options.AgentGRPCListen = net.JoinHostPort("0.0.0.0", strconv.Itoa(port))
			options.AgentGRPCAdvertise = ""
			options.DataDirectory = data
			options.Initialization = Initialization{}
			if err := a.Close(ctx); err != nil {
				t.Fatal("fixture Core shutdown failed", err)
			}
			a, base, _ = appFixture(t, options)
			for {
				status, work := httpCall(t, base, path, "GET", auth, nil)
				if status == 200 && work["observedState"] == "ready" {
					break
				}
				if ctx.Err() != nil || status != 200 || work["observedState"] == "failed" {
					t.Fatal("interrupted Work did not resume", status, work["observedState"], ctx.Err())
				}
				time.Sleep(100 * time.Millisecond)
			}
			view, err := a.dockerRuntime.InspectContainer(ctx, dockerengine.ContainerIdentity{WorkID: workID, Kind: "agent", LogicalID: "agentd"})
			if err != nil || view == nil || view.Config.Labels["piwork.generation"] != strconv.FormatInt(plan.Target.Generation, 10) || view.Config.Labels["piwork.instance_id"] != plan.Target.InstanceID {
				t.Fatal("recovery created a different target", err)
			}
			containers, err := a.dockerRuntime.ListContainers(ctx, "")
			if err != nil {
				t.Fatal(err)
			}
			running := 0
			for _, candidate := range containers {
				if candidate.Config != nil && candidate.Config.Labels[dockerengine.WorkLabel] == workID && candidate.Config.Labels[dockerengine.KindLabel] == "agent" && candidate.State != nil && candidate.State.Running {
					running++
				}
			}
			if running != 1 {
				t.Fatal("recovery did not leave exactly one running Agent")
			}
			credentialPath := ""
			for _, item := range view.HostConfig.Mounts {
				if item.Target == "/run/secrets/model-api-key" {
					credentialPath = item.Source
				}
			}
			mounted, err := os.ReadFile(credentialPath)
			if err != nil || string(mounted) != "synthetic-stage-b\n" {
				t.Fatal("in-flight launch binding changed during rotation", err)
			}
			if gateway.count() != requestCount {
				t.Fatal("recovery replayed a previous model request")
			}
			modelNativeRun(t, ctx, base, auth, workID, session, "after-stage")
			if gateway.count() != requestCount+1 {
				t.Fatal("new Run was not executed exactly once")
			}
			if gateway.last().Key != "synthetic-stage-c" {
				t.Fatal("new Run did not use the latest credential")
			}
			history := modelNativeCall(t, base, auth, path+"/sessions/"+session, "GET", nil, 200)
			if len(history["runs"].([]any)) < 2 {
				t.Fatal("recovery lost session history")
			}
		})
	}
}

func TestNativeCredentialReplacementSupersededByControl(t *testing.T) {
	gateway, image := nativeModelGateway(t)
	t.Setenv("PIWORK_TEST_NATIVE_AGENT_IMAGE", image)
	for _, action := range []string{"stop", "delete", "apply", "apply-unchanged"} {
		t.Run(action, func(t *testing.T) {
			gateway.mu.Lock()
			gateway.allowedKey = "synthetic-control-a"
			gateway.mu.Unlock()
			baseURL := gateway.URL + "/v1"
			a, base, auth, workID, _ := nativeApplyFixture(t, RuntimeInput{Provider: "openai", Model: "gpt-5.1", BaseURL: &baseURL, Credential: "synthetic-control-a"})
			ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
			defer cancel()
			path := "/api/v1/works/" + workID
			models := modelNativeCall(t, base, auth, "/api/v1/admin/models", "GET", nil, 200)["models"].([]any)
			modelID := models[0].(map[string]any)["id"].(string)
			stop := modelNativeCall(t, base, auth, path+"/stop", "POST", map[string]string{"idempotencyKey": "control-initial-stop"}, 202)
			waitWorkOperation(t, ctx, a, stop["operationId"].(string))
			modelNativeCall(t, base, auth, "/api/v1/admin/models/"+modelID, "PATCH", map[string]any{"credential": "synthetic-control-b"}, 200)
			gateway.mu.Lock()
			gateway.allowedKey = "synthetic-control-b"
			gateway.mu.Unlock()
			if action == "apply" {
				modelNativeCall(t, base, auth, path+"/configuration/agents", "PUT", map[string]any{"agentsMd": "# Explicitly applied after rotation"}, 200)
			}
			reached, proceed := make(chan struct{}), make(chan struct{})
			a.workResumeFaultForTest = func(actual string) error {
				if actual == "replacement-prepared" {
					close(reached)
					<-proceed
				}
				return nil
			}
			start := modelNativeCall(t, base, auth, path+"/start", "POST", map[string]string{"idempotencyKey": "control-start"}, 202)
			select {
			case <-reached:
			case <-ctx.Done():
				t.Fatal("replacement did not reach control boundary")
			}
			if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
				return a.Store.LockSnapshotWork(tx, corestore.SnapshotLock{WorkID: workID, OperationID: "operation-fixture", WorkerEpoch: 1})
			}); err == nil || !strings.Contains(err.Error(), "WORK_BUSY") {
				t.Fatal("snapshot was not fenced during replacement", err)
			}
			endpoint := "/stop"
			if action == "delete" {
				endpoint = "/delete"
			} else if action != "stop" {
				endpoint = "/configuration/apply"
			}
			latest := modelNativeCall(t, base, auth, path+endpoint, "POST", map[string]string{"idempotencyKey": "control-latest"}, 202)
			close(proceed)
			waitWorkOperation(t, ctx, a, latest["operationId"].(string))
			a.workResumeFaultForTest = nil
			prior, err := a.Store.Operation(ctx, start["operationId"].(string))
			if err != nil || prior.State != "superseded" {
				t.Fatal("later control did not supersede Start", err, prior.State)
			}
			if _, found, err := a.runtimeReplacement(ctx, workID); err != nil || found {
				t.Fatal("superseded target was not retired", err)
			}
			view, err := a.dockerRuntime.InspectContainer(ctx, dockerengine.ContainerIdentity{WorkID: workID, Kind: "agent", LogicalID: "agentd"})
			if err != nil || action == "delete" && view != nil || action == "stop" && view != nil && view.State.Running || strings.HasPrefix(action, "apply") && (view == nil || !view.State.Running) {
				t.Fatal("latest control did not determine runtime state", err)
			}
			if action == "apply" {
				config := modelNativeCall(t, base, auth, path+"/configuration", "GET", nil, 200)
				if config["active"].(map[string]any)["agentsMd"] != "# Explicitly applied after rotation" {
					t.Fatal("explicit Apply did not activate its captured configuration")
				}
			}
		})
	}
}

func TestNativeCredentialRetryAfterExhaustedBudget(t *testing.T) {
	gateway, image := nativeModelGateway(t)
	t.Setenv("PIWORK_TEST_NATIVE_AGENT_IMAGE", image)
	gateway.mu.Lock()
	gateway.allowedKey = "synthetic-budget-a"
	gateway.mu.Unlock()
	baseURL := gateway.URL + "/v1"
	a, base, auth, workID, _ := nativeApplyFixture(t, RuntimeInput{Provider: "openai", Model: "gpt-5.1", BaseURL: &baseURL, Credential: "synthetic-budget-a"})
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	path := "/api/v1/works/" + workID
	identity := dockerengine.ContainerIdentity{WorkID: workID, Kind: "agent", LogicalID: "agentd"}
	before, err := a.dockerRuntime.InspectContainer(ctx, identity)
	if err != nil || before == nil {
		t.Fatal("original Agent unavailable", err)
	}
	oldGeneration, err := strconv.ParseInt(before.Config.Labels["piwork.generation"], 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	stop := modelNativeCall(t, base, auth, path+"/stop", "POST", map[string]string{"idempotencyKey": "budget-stop"}, 202)
	waitWorkOperation(t, ctx, a, stop["operationId"].(string))
	models := modelNativeCall(t, base, auth, "/api/v1/admin/models", "GET", nil, 200)["models"].([]any)
	modelID := models[0].(map[string]any)["id"].(string)
	modelNativeCall(t, base, auth, "/api/v1/admin/models/"+modelID, "PATCH", map[string]any{"credential": "synthetic-budget-b"}, 200)
	gateway.mu.Lock()
	gateway.allowedKey = "synthetic-budget-b"
	gateway.mu.Unlock()
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE works SET desired_state='running',observed_state='failed' WHERE id=?`, workID); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE runtime_generations SET state='failed',retry_count=3,retry_window_started_at=?,next_retry_at=NULL,ready_since=NULL WHERE work_id=? AND generation=?`, time.Now().UTC().Format(time.RFC3339Nano), workID, oldGeneration)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(500 * time.Millisecond)
	old, err := a.Store.RuntimeGeneration(ctx, workID, oldGeneration)
	if err != nil || old.RetryCount != 3 || old.State != "failed" {
		t.Fatal("rotation unexpectedly reset exhausted budget", err)
	}
	retry := modelNativeCall(t, base, auth, path+"/retry", "POST", map[string]string{"idempotencyKey": "budget-retry"}, 202)
	waitWorkOperation(t, ctx, a, retry["operationId"].(string))
	after, err := a.dockerRuntime.InspectContainer(ctx, identity)
	if err != nil || after == nil || after.ID == before.ID {
		t.Fatal("explicit Retry did not restore the Work", err)
	}
	newGeneration, _ := strconv.ParseInt(after.Config.Labels["piwork.generation"], 10, 64)
	target, err := a.Store.RuntimeGeneration(ctx, workID, newGeneration)
	if err != nil || target.RetryCount != 0 || target.State != "ready" {
		t.Fatal("Retry did not reset the target budget", err)
	}
	old, err = a.Store.RuntimeGeneration(ctx, workID, oldGeneration)
	if err != nil || old.NextRetryAt != nil {
		t.Fatal("old generation remained due", err)
	}
	session := modelNativeCall(t, base, auth, path+"/sessions", "POST", map[string]string{"idempotencyKey": "budget-session"}, 201)["sessionId"].(string)
	run := modelNativeRun(t, ctx, base, auth, workID, session, "budget-recovered")
	operation := modelNativeCall(t, base, auth, "/api/v1/operations/"+retry["operationId"].(string), "GET", nil, 200)
	history := modelNativeCall(t, base, auth, path+"/sessions/"+session, "GET", nil, 200)
	for _, public := range []any{operation, history} {
		raw, _ := json.Marshal(public)
		if strings.Contains(string(raw), "synthetic-budget-a") || strings.Contains(string(raw), "synthetic-budget-b") {
			t.Fatal("public output exposed a fixture credential")
		}
	}
	request, err := http.NewRequestWithContext(ctx, "GET", base+path+"/runs/"+run["runId"].(string)+"/events?after=0", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", auth)
	response, err := (&http.Client{Timeout: 20 * time.Second}).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	events, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil || response.StatusCode != 200 || len(events) == 0 || strings.Contains(string(events), "synthetic-budget-a") || strings.Contains(string(events), "synthetic-budget-b") {
		t.Fatal("Run event stream was unavailable or exposed a fixture credential", err)
	}
}

func TestNativeCredentialRotationPeriodicRecovery(t *testing.T) {
	gateway, image := nativeModelGateway(t)
	t.Setenv("PIWORK_TEST_NATIVE_AGENT_IMAGE", image)
	gateway.mu.Lock()
	gateway.allowedKey = "synthetic-periodic-a"
	gateway.mu.Unlock()
	baseURL := gateway.URL + "/v1"
	a, base, auth, workID, _ := nativeApplyFixture(t, RuntimeInput{Provider: "openai", Model: "gpt-5.1", BaseURL: &baseURL, Credential: "synthetic-periodic-a"})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	path := "/api/v1/works/" + workID
	identity := dockerengine.ContainerIdentity{WorkID: workID, Kind: "agent", LogicalID: "agentd"}
	before, err := a.dockerRuntime.InspectContainer(ctx, identity)
	if err != nil || before == nil {
		t.Fatal("original Agent unavailable", err)
	}
	models := modelNativeCall(t, base, auth, "/api/v1/admin/models", "GET", nil, 200)["models"].([]any)
	modelID := models[0].(map[string]any)["id"].(string)
	modelNativeCall(t, base, auth, "/api/v1/admin/models/"+modelID, "PATCH", map[string]any{"credential": "synthetic-periodic-b"}, 200)
	gateway.mu.Lock()
	gateway.allowedKey = "synthetic-periodic-b"
	gateway.mu.Unlock()
	userSession, err := a.Identity.Authenticate(ctx, strings.TrimPrefix(auth, "Bearer "))
	if err != nil {
		t.Fatal(err)
	}
	generation, err := strconv.ParseInt(before.Config.Labels["piwork.generation"], 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	fileInput := fileExecutionInput{Identity: fileAccessIdentity{WorkID: workID, OwnerUserID: userSession.User.ID, SessionID: userSession.SessionID, RuntimeGeneration: generation}, Action: "PUT", Path: []string{"never-published"}, Conditions: emptyFileConditions()}
	job, attempt, err := a.acceptFileJob(ctx, fileInput)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.UpdateFileJobState(tx, job.ID, "accepted", "starting", packageNow(), nil); err != nil {
			return err
		}
		return corestore.UpdateFileAttempt(tx, attempt.ID, "planned", "creating", packageNow(), nil)
	}); err != nil {
		t.Fatal(err)
	}
	attempt.State = "creating"
	if _, err := a.dockerRuntime.StopContainer(ctx, identity, 1); err != nil {
		t.Fatal(err)
	}
	time.Sleep(3 * time.Second)
	if view, err := a.dockerRuntime.InspectContainer(ctx, identity); err != nil || view == nil || view.ID != before.ID || view.State.Running {
		t.Fatal("recovery bypassed an unconfirmed file helper", err)
	}
	created, err := a.dockerRuntime.EnsureFileHelper(ctx, fileAttemptSpec(job, attempt))
	if err != nil {
		t.Fatal(err)
	}
	if err := a.recoverFileJob(ctx, job.ID, true); err != nil {
		t.Fatal("late file helper was not retired", err)
	}
	if err := a.dockerRuntime.ConfirmContainerAbsent(ctx, created.ID, attempt.ContainerName); err != nil {
		t.Fatal(err)
	}
	for {
		view, err := a.dockerRuntime.InspectContainer(ctx, identity)
		work, workErr := a.Store.Work(ctx, workID, false)
		if err == nil && workErr == nil && view != nil && view.State != nil && view.State.Running && view.ID != before.ID && work.ObservedState == "ready" {
			break
		}
		if ctx.Err() != nil {
			t.Fatal("periodic recovery did not replace the Agent", ctx.Err())
		}
		time.Sleep(100 * time.Millisecond)
	}
	readyAgent, err := a.dockerRuntime.InspectContainer(ctx, identity)
	if err != nil || readyAgent == nil {
		t.Fatal("recovered Agent unavailable", err)
	}
	readyGeneration, err := strconv.ParseInt(readyAgent.Config.Labels["piwork.generation"], 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil {
		t.Fatal(err)
	}
	_, staleErr, writeErr := a.startCapturedWorkForRecovery(ctx, workID, readyGeneration, readyAgent.Config.Labels["piwork.instance_id"], work.ControlVersion)
	if !errors.Is(staleErr, errWorkSuperseded) || writeErr != nil {
		t.Fatal("already-ready recovery was not ignored", staleErr, writeErr)
	}
	work, err = a.Store.Work(ctx, workID, false)
	if err != nil || work.ObservedState != "ready" {
		t.Fatal("stale recovery changed the successful state", err)
	}
	session := modelNativeCall(t, base, auth, path+"/sessions", "POST", map[string]string{"idempotencyKey": "periodic-session"}, 201)["sessionId"].(string)
	modelNativeRun(t, ctx, base, auth, workID, session, "periodic-recovered")
	if gateway.last().Key != "synthetic-periodic-b" {
		t.Fatal("periodic recovery did not use the current credential")
	}
}
