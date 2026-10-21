//go:build integration

package dockerengine

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/testsupport"
)

func TestRealFullLogsReadsCompleteSplitStreamsAndBoundedPolicy(t *testing.T) {
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
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
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
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	image, err := engine.PrepareImage(ctx, "python:3.13-slim")
	if err != nil {
		t.Fatal(err)
	}
	spec := fixtureSpec()
	spec.Identity.WorkID = "work-log-stream"
	spec.DisplayName = ""
	spec.Image = image.ID
	spec.Command = []string{"python", "-c", "import sys;print('stdout-line');print('stderr-line', file=sys.stderr);sys.stdout.flush();sys.stderr.flush()"}
	ensured, err := runtime.EnsureContainer(ctx, spec)
	if err != nil {
		t.Fatal(err)
	}
	if ensured.LogPolicyVersion != ManagedContainerLogPolicyVersion {
		t.Fatalf("new container did not record the managed log policy: %#v", ensured)
	}
	if _, err := runtime.StartContainer(ctx, spec.Identity); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(30 * time.Second)
	for {
		view, err := runtime.InspectContainer(ctx, spec.Identity)
		if err != nil {
			t.Fatal(err)
		}
		if view != nil && view.State != nil && !view.State.Running {
			if view.HostConfig == nil || view.HostConfig.LogConfig.Type != "json-file" || view.HostConfig.LogConfig.Config["max-size"] != "16m" || view.HostConfig.LogConfig.Config["max-file"] != "4" {
				t.Fatalf("actual container log policy differs: %#v", view.HostConfig)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("container did not exit")
		}
		time.Sleep(50 * time.Millisecond)
	}
	var stdout, stderr bytes.Buffer
	result, err := runtime.FullLogs(ctx, spec.Identity, FullLogRequest{ExpectedContainerID: ensured.ID, Until: time.Now().UTC().Add(time.Second), MaxBytes: 1 << 20}, &stdout, &stderr)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(stdout.String(), "stdout-line") || strings.Contains(stdout.String(), "stderr-line") {
		t.Fatalf("stdout stream mismatch: %q", stdout.String())
	}
	if !strings.Contains(stderr.String(), "stderr-line") {
		t.Fatalf("stderr stream mismatch: %q", stderr.String())
	}
	if result.StdoutBytes != int64(stdout.Len()) || result.StderrBytes != int64(stderr.Len()) || result.StdoutDigest == "" || result.StderrDigest == "" {
		t.Fatalf("unexpected full log result: %#v", result)
	}
	var wrong bytes.Buffer
	if _, err := runtime.FullLogs(ctx, spec.Identity, FullLogRequest{ExpectedContainerID: "different-container", Until: time.Now().UTC(), MaxBytes: 1024}, &wrong, &wrong); !errors.Is(err, ErrIdentity) {
		t.Fatalf("replacement identity accepted: %v", err)
	}
	// The legacy bounded tail remains unchanged and cannot substitute for FullLogs.
	tail, err := runtime.Logs(ctx, spec.Identity, 1, ensured.ID)
	if err != nil || strings.Count(strings.TrimSpace(tail.Text), "\n") > 0 {
		t.Fatalf("legacy tail changed: %#v %v", tail, err)
	}
}
