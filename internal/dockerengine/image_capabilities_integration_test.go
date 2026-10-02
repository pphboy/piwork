//go:build integration

package dockerengine

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
	"piwork/internal/buildinfo"
	"piwork/internal/corestore"
	"piwork/internal/imagestatic"
	"piwork/internal/safefs"
	"piwork/internal/testsupport"
)

func TestRealNativeAgentImageStaticCapabilitiesAndBuildEvidence(t *testing.T) {
	t.Setenv("PATH", filepath.Join(t.TempDir(), "no-host-tools"))
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
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
	t.Log("inspection installation:", scope.ID())
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := scope.Cleanup(ctx, engine.api); err != nil {
			t.Error(err)
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	store, err := corestore.Open(ctx, corestore.Options{Directory: t.TempDir(), InstallationID: scope.ID()})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	directory := t.TempDir()
	os.Chmod(directory, 0700)
	root, err := safefs.OpenRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if root.Lock() != nil {
		t.Fatal("spool lock")
	}
	inspector, err := NewImageInspector(ctx, engine, root, store)
	if err != nil {
		t.Fatal(err)
	}
	labels, _ := scope.Labels()
	var previous imagestatic.Capabilities
	for _, variant := range []string{"production", "acceptance"} {
		image, err := engine.InspectImage(ctx, "piwork-agentd:go-migration-"+variant)
		if err != nil {
			t.Fatal("build both native Agent targets before this test", err)
		}
		if image.Labels["io.piwork.agent.variant"] != variant {
			t.Fatal(image.Labels)
		}
		caps, err := inspector.InspectNativeAgent(ctx, image.ID)
		if err != nil {
			t.Fatal(variant, err)
		}
		if caps.Environment == nil || caps.Environment.NodeAbi != "137" || caps.Environment.PiSdkVersion != "0.86.1" {
			t.Fatal("static image environment", caps.Environment)
		}
		t.Logf("%s image %s native helper %s MCP %s", variant, image.ID, caps.PackageHelperSHA256, caps.ServiceMCPSHA256)
		if previous.PackageHelper && (previous.PackageHelperSHA256 != caps.PackageHelperSHA256 || previous.ServiceMCPSHA256 != caps.ServiceMCPSHA256) {
			t.Fatal("two targets did not deliver identical native programs")
		}
		previous = caps
		names, err := root.Entries()
		if err != nil || len(names) != 0 {
			t.Fatal("named archive remains", names, err)
		}
		jobs, err := store.ActiveImageInspections(ctx)
		if err != nil || len(jobs) != 0 {
			t.Fatal("inspection registry remains", jobs, err)
		}
		// These separately labelled smoke containers run only trusted --version
		// entry points AFTER the entirely static Engine inspection has finished.
		for _, program := range []string{"piwork-package-helper", "piwork-service-mcp"} {
			pids := int64(64)
			created, err := engine.api.ContainerCreate(ctx, client.ContainerCreateOptions{Name: scope.ID() + "-" + variant + "-" + program, Config: &container.Config{Image: image.ID, User: "10001:10001", Entrypoint: []string{"/usr/local/bin/" + program}, Cmd: []string{"--version"}, Labels: labels}, HostConfig: &container.HostConfig{ReadonlyRootfs: true, CapDrop: []string{"ALL"}, SecurityOpt: []string{"no-new-privileges:true"}, NetworkMode: "none", Resources: container.Resources{Memory: 128 << 20, PidsLimit: &pids}}})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := engine.api.ContainerStart(ctx, created.ID, client.ContainerStartOptions{}); err != nil {
				t.Fatal(err)
			}
			for {
				view, err := engine.api.ContainerInspect(ctx, created.ID, client.ContainerInspectOptions{})
				if err != nil {
					t.Fatal(err)
				}
				if !view.Container.State.Running {
					if view.Container.State.ExitCode != 0 {
						t.Fatal("native version failed", view.Container.State.ExitCode)
					}
					break
				}
				select {
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				case <-time.After(20 * time.Millisecond):
				}
			}
			logs, err := engine.api.ContainerLogs(ctx, created.ID, client.ContainerLogsOptions{ShowStdout: true, ShowStderr: true})
			if err != nil {
				t.Fatal(err)
			}
			var stdout, stderr bytes.Buffer
			err = Demultiplex(ctx, logs, &stdout, &stderr)
			logs.Close()
			if err != nil || stderr.Len() != 0 {
				t.Fatal(err, stderr.String())
			}
			var info buildinfo.Info
			if json.Unmarshal(stdout.Bytes(), &info) != nil || info.Program != program || info.GoVersion != "go1.25.5" || info.OS != "linux" || info.Architecture != image.Architecture || info.Commit == "unknown" {
				t.Fatal("native build evidence", stdout.String())
			}
			t.Log(program, info.GoVersion, info.Commit, info.Modified)
			if _, err := engine.api.ContainerRemove(ctx, created.ID, client.ContainerRemoveOptions{}); err != nil {
				t.Fatal(err)
			}
		}
	}
	old, err := engine.InspectImage(ctx, "piwork-agentd:acceptance")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := inspector.InspectNativeAgent(ctx, old.ID); !errors.Is(err, ErrImageIncompatible) {
		t.Fatal("old TS helper image accepted", err)
	}
	containers, err := engine.api.ContainerList(ctx, client.ContainerListOptions{All: true, Filters: filtersFor(labels)})
	if err != nil || len(containers.Items) != 0 {
		t.Fatal("inspection/smoke containers remain", err)
	}
}
