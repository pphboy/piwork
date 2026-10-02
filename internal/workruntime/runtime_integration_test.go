//go:build integration

package workruntime

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/moby/moby/client"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/agentv1"
	"piwork/internal/safefs"
	"piwork/internal/testsupport"
)

// Run against the full retained TS harness, using only the native Engine API
// and the actual Go-generated runtime config, certificates, and Docker mounts.
func TestNativeCoreStartsRealTSAgent(t *testing.T) {
	imageRef := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE")
	if imageRef == "" {
		t.Skip("set PIWORK_TEST_NATIVE_AGENT_IMAGE to a built acceptance image")
	}
	t.Setenv("PATH", filepath.Join(t.TempDir(), "no-host-tools"))
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	endpoint, err := dockerengine.SelectEndpoint(dockerengine.SelectionOptions{DockerHost: host, DockerConfig: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	engine, err := dockerengine.Connect(context.Background(), endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	raw, err := client.NewClientWithOpts(client.WithHost(endpoint.Host), client.WithAPIVersionNegotiation())
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	scope, err := testsupport.NewScope()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := scope.Cleanup(ctx, raw); err != nil {
			t.Error(err)
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	image, err := engine.InspectImage(ctx, imageRef)
	if err != nil {
		t.Fatal(err)
	}
	if image.Labels["io.piwork.agent.variant"] != "acceptance" {
		t.Fatal("real harness test requires deterministic acceptance image")
	}
	dataDir := t.TempDir()
	store, err := corestore.Open(ctx, corestore.Options{Directory: dataDir, InstallationID: scope.ID()})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	manager, err := internaltls.Open(filepath.Join(dataDir, "runtime"), store)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	spoolDir := t.TempDir()
	if err := os.Chmod(spoolDir, 0700); err != nil {
		t.Fatal(err)
	}
	spool, err := safefs.OpenRoot(spoolDir)
	if err != nil {
		t.Fatal(err)
	}
	defer spool.Close()
	if err := spool.Lock(); err != nil {
		t.Fatal(err)
	}
	inspector, err := dockerengine.NewImageInspector(ctx, engine, spool, store)
	if err != nil {
		t.Fatal(err)
	}
	spec := fixtureContext(t)
	spec.Scope.InstallationID = scope.ID()
	spec.ImageID = image.ID
	metadataPath := filepath.Join(spec.ContextDirectory, "metadata.json")
	metadata, err := os.ReadFile(metadataPath)
	if err != nil {
		t.Fatal(err)
	}
	metadata = []byte(strings.Replace(string(metadata), "sha256:"+strings.Repeat("a", 64), image.ID, 1))
	if err := os.WriteFile(metadataPath, metadata, 0644); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"config.json", "metadata.json", "AGENTS.md"} {
		if err := os.Chmod(filepath.Join(spec.ContextDirectory, name), 0644); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"", "skills", "packages"} {
		if err := os.Chmod(filepath.Join(spec.ContextDirectory, name), 0755); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := readCaptured(spec); err != nil {
		t.Fatalf("prepared captured context: %v; metadata=%s; image=%s", err, metadata, image.ID)
	}
	resources, err := dockerengine.NewRuntime(engine, scope.ID(), func(ctx context.Context, plan dockerengine.ResourcePlan) error {
		return store.RecordResourceIntent(ctx, corestore.ResourceIntent{WorkID: plan.WorkID, Kind: plan.Kind, LogicalID: plan.LogicalID, Name: plan.Name, Labels: plan.Labels})
	}, []string{dataDir, spec.ContextDirectory})
	if err != nil {
		t.Fatal(err)
	}
	runtime := &Runtime{Docker: resources, Inspector: inspector, TLS: manager}
	wrong := spec
	wrong.ImageID = "sha256:" + strings.Repeat("f", 64)
	if started, err := runtime.Start(ctx, wrong); !errors.Is(err, ErrContext) || started.Client != nil {
		t.Fatal("foreign image/context gained an Agent route", err)
	}
	filters, err := scope.Filters()
	if err != nil {
		t.Fatal(err)
	}
	before, err := raw.ContainerList(ctx, client.ContainerListOptions{All: true, Filters: filters})
	if err != nil || len(before.Items) != 0 {
		t.Fatal("foreign context created an Agent container", err)
	}
	started, err := runtime.Start(ctx, spec)
	if err != nil {
		filters, filterErr := scope.Filters()
		if filterErr == nil {
			containers, listErr := raw.ContainerList(ctx, client.ContainerListOptions{All: true, Filters: filters})
			if listErr == nil {
				for _, item := range containers.Items {
					logs, logErr := raw.ContainerLogs(ctx, item.ID, client.ContainerLogsOptions{ShowStdout: true, ShowStderr: true, Tail: "40"})
					if logErr == nil {
						var output bytes.Buffer
						_ = dockerengine.Demultiplex(ctx, logs, &output, &output)
						logs.Close()
						t.Logf("Agent startup logs: %s", output.String())
					}
				}
			}
		}
		t.Fatal("real TS Agent startup:", err)
	}
	defer started.Client.Close()
	var routes Routes
	if _, err := routes.Agent(spec.Scope, spec.ContextID); !errors.Is(err, ErrRouteUnavailable) {
		t.Fatal("route appeared before readiness publication", err)
	}
	if err := routes.Publish(spec.Scope, spec.ContextID, started); err != nil {
		t.Fatal("verified route publication:", err)
	}
	if _, err := routes.Agent(spec.Scope, "other-context"); !errors.Is(err, ErrRouteUnavailable) {
		t.Fatal("foreign context gained route", err)
	}
	otherGeneration := spec.Scope
	otherGeneration.Generation++
	if _, err := routes.Agent(otherGeneration, spec.ContextID); !errors.Is(err, ErrRouteUnavailable) {
		t.Fatal("stale generation gained route", err)
	}
	if _, err := routes.Agent(spec.Scope, spec.ContextID); err != nil {
		t.Fatal("verified route missing:", err)
	}
	_, admission, err := routes.Admission(spec.Scope, spec.ContextID)
	if err != nil {
		t.Fatal(err)
	}
	ready, err := started.Client.Readiness(ctx, spec.ContextID, false)
	if err != nil {
		t.Fatal("readiness after route publication:", err)
	}
	if !ready.GetAcceptingRuns() || started.ContainerID == "" || started.Address == "" {
		t.Fatal("ready Agent route was incomplete")
	}
	session, err := started.Client.CreateSession(ctx, "native-runtime-session")
	if err != nil {
		t.Fatal("real TS Agent Session RPC:", err)
	}
	if session.GetSessionId() == "" || session.GetWorkId() != spec.Scope.WorkID {
		t.Fatal("Agent returned wrong Session identity")
	}
	sessions, err := started.Client.ListSessions(ctx, 10, "")
	if err != nil || len(sessions.GetSessions()) != 1 || sessions.GetSessions()[0].GetSessionId() != session.GetSessionId() {
		t.Fatal("TS harness did not persist Session", err)
	}
	accepted, err := started.Client.SubmitRun(ctx, session.GetSessionId(), "native-runtime-run", "hello")
	if err != nil || accepted.GetRun().GetRunId() == "" || accepted.GetReused() {
		t.Fatal("real TS SDK Run was not accepted", err)
	}
	var sawText, sawTerminal bool
	watchContext, stopWatch := context.WithTimeout(ctx, 20*time.Second)
	defer stopWatch()
	err = started.Client.WatchRun(watchContext, accepted.GetRun().GetRunId(), nil, func(event *agentv1.RunEvent) error {
		if event.GetText() != nil {
			sawText = true
		}
		if event.GetState() != nil && event.GetState().GetState() == agentv1.RunState_RUN_STATE_SUCCEEDED {
			sawTerminal = true
		}
		return nil
	})
	if err != nil || !sawText || !sawTerminal {
		t.Fatal("real TS SDK Run event stream was incomplete", err, sawText, sawTerminal)
	}
	completed, err := started.Client.GetRun(ctx, accepted.GetRun().GetRunId())
	if err != nil || completed.GetState() != agentv1.RunState_RUN_STATE_SUCCEEDED || completed.GetFinalText() != "skill-read:none" {
		t.Fatal("real TS SDK Run did not persist expected result", err, completed)
	}
	if routes.Revoke(spec.Scope.WorkID) != started.Client {
		t.Fatal("route revocation lost Agent connection")
	}
	select {
	case <-admission.Done():
	default:
		t.Fatal("route revocation left active observers admitted")
	}
	if _, err := routes.Agent(spec.Scope, spec.ContextID); !errors.Is(err, ErrRouteUnavailable) {
		t.Fatal("revoked route remains accessible", err)
	}
	if err := runtime.StopAgent(ctx, spec.Scope, spec.ContextID, 10*time.Second); err != nil {
		t.Fatal("exact Agent stop was not confirmed:", err)
	}
	if err := manager.Close(); err != nil {
		t.Fatal("close original Core TLS manager:", err)
	}
	reopened, err := internaltls.Open(filepath.Join(dataDir, "runtime"), store)
	if err != nil {
		t.Fatal("reopen Core TLS manager:", err)
	}
	defer reopened.Close()
	runtime.TLS = reopened
	resumed, err := runtime.Start(ctx, spec)
	if err != nil {
		t.Fatal("same-generation restart after confirmed stop:", err)
	}
	defer resumed.Client.Close()
	if resumed.ContainerID != started.ContainerID {
		t.Fatal("restart created a duplicate Agent container")
	}
	retained, err := resumed.Client.ListSessions(ctx, 10, "")
	if err != nil || len(retained.GetSessions()) != 1 || retained.GetSessions()[0].GetSessionId() != session.GetSessionId() {
		t.Fatal("TS harness Session was lost across stopped-container recovery", err)
	}
	t.Logf("real TS Agent ready: container=%s context=%s session=%s", started.ContainerID, spec.ContextID, session.GetSessionId())
}
