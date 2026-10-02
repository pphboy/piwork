//go:build integration

package packageprepare

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/mount"
	"github.com/moby/moby/client"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/pipackage"
	"piwork/internal/testsupport"
)

func TestNativePackagePreparationUsesDurableEngineResources(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	endpoint, err := dockerengine.SelectEndpoint(dockerengine.SelectionOptions{DockerHost: host, DockerConfig: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	engine, err := dockerengine.Connect(ctx, endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	api, err := client.NewClientWithOpts(client.WithHost(endpoint.Host), client.WithVersion("1.45"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { api.Close() })
	scope, err := testsupport.NewScope()
	if err != nil {
		t.Fatal(err)
	}
	t.Log("preparation installation:", scope.ID())
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := scope.Cleanup(cleanup, api); err != nil {
			t.Error(err)
		}
	})
	store, err := corestore.Open(ctx, corestore.Options{Directory: t.TempDir(), InstallationID: scope.ID()})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	directory := t.TempDir()
	native, err := dockerengine.NewRuntime(engine, scope.ID(), func(ctx context.Context, plan dockerengine.ResourcePlan) error {
		return store.RecordResourceIntent(ctx, corestore.ResourceIntent{WorkID: plan.WorkID, Kind: plan.Kind, LogicalID: plan.LogicalID, Name: plan.Name, Labels: plan.Labels})
	}, []string{directory})
	if err != nil {
		t.Fatal(err)
	}
	native.SetPackageSettler(func(ctx context.Context, plan dockerengine.ResourcePlan) error {
		return store.SettlePackageCreation(ctx, plan.WorkID, plan.Kind, plan.LogicalID, plan.Name)
	})
	reference := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE")
	if reference == "" {
		reference = "piwork-agentd:go-migration-acceptance"
	}
	image, err := engine.InspectImage(ctx, reference)
	if err != nil {
		t.Fatal("native acceptance image required", err)
	}
	labels, _ := scope.Labels()
	// This test probe is retained Node/Pi environment inspection in the image.
	// All preparation operations below use the actual Go helper entrypoint.
	runProbe := func(command []string, mounts []mount.Mount) []byte {
		t.Helper()
		pids := int64(64)
		created, err := api.ContainerCreate(ctx, client.ContainerCreateOptions{Name: scope.ID() + "-probe-" + uuid.NewString(), Config: &container.Config{Image: image.ID, User: "10001:10001", Entrypoint: command[:1], Cmd: command[1:], Labels: labels}, HostConfig: &container.HostConfig{ReadonlyRootfs: true, NetworkMode: "none", CapDrop: []string{"ALL"}, SecurityOpt: []string{"no-new-privileges:true"}, Resources: container.Resources{Memory: 128 << 20, PidsLimit: &pids}, Mounts: mounts}})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := api.ContainerStart(ctx, created.ID, client.ContainerStartOptions{}); err != nil {
			t.Fatal(err)
		}
		waiting := api.ContainerWait(ctx, created.ID, client.ContainerWaitOptions{Condition: container.WaitConditionNotRunning})
		select {
		case result := <-waiting.Result:
			if result.StatusCode != 0 {
				t.Fatal("image probe failed", result.StatusCode)
			}
		case err := <-waiting.Error:
			t.Fatal(err)
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
		logs, err := api.ContainerLogs(ctx, created.ID, client.ContainerLogsOptions{ShowStdout: true, ShowStderr: true})
		if err != nil {
			t.Fatal(err)
		}
		defer logs.Close()
		var output bytes.Buffer
		if err := dockerengine.Demultiplex(ctx, logs, &output, io.Discard); err != nil {
			t.Fatal(err)
		}
		if _, err := api.ContainerRemove(ctx, created.ID, client.ContainerRemoveOptions{}); err != nil {
			t.Fatal(err)
		}
		return output.Bytes()
	}
	probe := `const fs=require('fs');const sdk=JSON.parse(fs.readFileSync('/workspace/node_modules/@earendil-works/pi-coding-agent/package.json')).version;console.log(JSON.stringify({os:process.platform,architecture:process.arch==='x64'?'amd64':process.arch,variant:null,nodeAbi:process.versions.modules,piSdkVersion:sdk}));`
	environment, err := pipackage.ValidateEnvironment(bytes.TrimSpace(runProbe([]string{"node", "-e", probe}, nil)))
	if err != nil {
		t.Fatal(err)
	}
	_, file, _, _ := runtime.Caller(0)
	repository := filepath.Join(filepath.Dir(file), "..", "..")
	t.Setenv("PATH", filepath.Join(t.TempDir(), "no-host-tools"))
	for _, sourceKind := range []string{"local", "zip"} {
		t.Run(sourceKind, func(t *testing.T) {
			jobID := uuid.NewString()
			jobDir := filepath.Join(directory, jobID)
			sourceDir := filepath.Join(jobDir, "source")
			spoolDir := filepath.Join(jobDir, "spool")
			if err := os.MkdirAll(sourceDir, 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.Mkdir(spoolDir, 0700); err != nil {
				t.Fatal(err)
			}
			tree, err := pipackage.OpenTree(ctx, filepath.Join(repository, "fixtures/pi-packages/tools-v1"))
			if err != nil {
				t.Fatal(err)
			}
			_, err = pipackage.PackArchive(ctx, tree, filepath.Join(sourceDir, "input.zip"))
			tree.Close()
			if err != nil {
				t.Fatal(err)
			}
			os.Chmod(filepath.Join(sourceDir, "input.zip"), 0644)
			request, _ := json.Marshal(map[string]any{"source": map[string]string{"kind": sourceKind, "displayName": "tools.zip"}})
			if err := os.WriteFile(filepath.Join(sourceDir, "request.json"), request, 0644); err != nil {
				t.Fatal(err)
			}
			identity := dockerengine.PackageIdentity{WorkID: "core", JobID: jobID}
			input := Input{Runtime: native, Identity: identity, Epoch: 1, PrepareImageID: image.ID, TrustedImageID: image.ID, SourceDirectory: sourceDir, SpoolDirectory: spoolDir, Environment: environment,
				OnPlanned: func(context.Context, dockerengine.PackageHelperSpec) error { return nil },
				OnRemoved: func(ctx context.Context, spec dockerengine.PackageHelperSpec) error {
					return store.ReleaseResourceIntent(ctx, spec.WorkID, "package-helper", spec.JobID+"-1-"+spec.Action, true)
				},
				OnResourcesRemoved: func(ctx context.Context) error {
					if err := native.ConfirmPackageAbsence(ctx, identity); err != nil {
						return err
					}
					if err := store.ReleaseResourceIntent(ctx, identity.WorkID, "package-network", jobID, true); err != nil {
						return err
					}
					return store.ReleaseResourceIntent(ctx, identity.WorkID, "package-volume", jobID, true)
				}}
			prepared, err := Prepare(ctx, input)
			if err != nil {
				t.Fatal("native preparation failed", err)
			}
			if prepared.Artifact.Metadata.Name != "@piwork/fixture-tools" || prepared.Artifact.Metadata.ResourceCounts.Extensions != 1 || prepared.ZipBytes <= 0 {
				t.Fatal(prepared)
			}
			var bindings int
			if err := store.Read(ctx, func(tx *sql.Tx) error { return tx.QueryRow(`SELECT count(*) FROM resource_bindings`).Scan(&bindings) }); err != nil || bindings != 0 {
				t.Fatal("durable resources not released", bindings, err)
			}
			restore := filepath.Join(jobDir, "artifact")
			if _, err := pipackage.ExtractArchive(ctx, prepared.ZipPath, restore); err != nil {
				t.Fatal(err)
			}
			if body, err := os.ReadFile(filepath.Join(restore, "prepared.txt")); err != nil || string(body) != "prepared-v1\n" {
				t.Fatal("lifecycle script did not prepare", err)
			}
			os.Chmod(restore, 0755)
			metadata, _ := json.Marshal(prepared.Artifact.Metadata)
			validation := `const {validatePiPackageArtifact}=await import('/workspace/packages/pi-package/dist/artifact.js');const m=` + string(metadata) + `;const r=await validatePiPackageArtifact({root:'/fixture',sourceKind:m.sourceKind,resolvedSource:m.resolvedSource,preparedEnvironment:m.preparedEnvironment,expectedDigest:m.contentDigest});console.log(JSON.stringify(r));`
			raw := runProbe([]string{"node", "--input-type=module", "-e", validation}, []mount.Mount{{Type: mount.TypeBind, Source: restore, Target: "/fixture", ReadOnly: true}})
			var oracle pipackage.Artifact
			if json.Unmarshal(raw, &oracle) != nil {
				t.Fatal("TS validator rejected Go artifact")
			}
			left, _ := json.Marshal(oracle)
			right, _ := json.Marshal(prepared.Artifact)
			if !bytes.Equal(left, right) {
				t.Fatal("TS/Go artifact mismatch")
			}
			if err := native.ConfirmPackageAbsence(ctx, identity); err != nil {
				t.Fatal("resources remain", err)
			}
		})
	}
	// A stopped action cannot be rerun with its old identity.
	identity := dockerengine.PackageIdentity{WorkID: "core", JobID: uuid.NewString()}
	if _, err := native.EnsurePackageResources(ctx, identity); err != nil {
		t.Fatal(err)
	}
	spec := dockerengine.PackageHelperSpec{PackageIdentity: identity, Epoch: 1, Action: "init", ImageID: image.ID}
	if _, err := native.EnsurePackageHelper(ctx, spec); err != nil {
		t.Fatal(err)
	}
	if _, err := native.RunPackageHelper(ctx, spec); err != nil {
		t.Fatal(err)
	}
	if _, err := native.RunPackageHelper(ctx, spec); !errors.Is(err, dockerengine.ErrStateUnknown) {
		t.Fatal("terminated helper restarted", err)
	}
	if err := native.RemovePackageHelper(ctx, spec); err != nil {
		t.Fatal(err)
	}
	if err := native.RemovePackageResources(ctx, identity); err != nil {
		t.Fatal(err)
	}
}
