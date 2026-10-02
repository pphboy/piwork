//go:build integration

package dockerengine

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/moby/moby/client"
	"piwork/internal/corestore"
	"piwork/internal/testsupport"
	"piwork/internal/workpackage"
)

func TestNativeSnapshotHelperTwoVolumeRoundTripAndIsolation(t *testing.T) {
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	helper := os.Getenv("PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE")
	if helper == "" {
		t.Fatal("native snapshot helper image required")
	}
	t.Setenv("PATH", filepath.Join(t.TempDir(), "no-host-tools"))
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	endpoint, err := SelectEndpoint(SelectionOptions{DockerHost: host, DockerConfig: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	engine, err := Connect(ctx, endpoint)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { engine.Close() })
	scope, err := testsupport.NewScope()
	if err != nil {
		t.Fatal(err)
	}
	t.Log("Snapshot helper installation:", scope.ID())
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := scope.Cleanup(cleanup, engine.api); err != nil {
			t.Error(err)
		}
	})
	root := t.TempDir()
	store, err := corestore.Open(ctx, corestore.Options{Directory: root, InstallationID: scope.ID()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	spool := filepath.Join(root, "snapshot-test-spool")
	if err := os.Mkdir(spool, 0700); err != nil {
		t.Fatal(err)
	}
	runtime, err := NewRuntime(engine, scope.ID(), func(ctx context.Context, plan ResourcePlan) error {
		return store.RecordResourceIntent(ctx, corestore.ResourceIntent{WorkID: plan.WorkID, Kind: plan.Kind, LogicalID: plan.LogicalID, Name: plan.Name, Labels: plan.Labels})
	}, []string{root})
	if err != nil {
		t.Fatal(err)
	}
	image, err := engine.InspectImage(ctx, helper)
	if err != nil {
		t.Fatal(err)
	}
	t.Log("Snapshot image:", image.ID)
	platform, err := store.OpenPlatformFiles()
	if err != nil {
		t.Fatal(err)
	}
	defer platform.Close()
	inspectionRoot, err := platform.OpenInspectionRoot()
	if err != nil {
		t.Fatal(err)
	}
	defer inspectionRoot.Close()
	inspector, err := NewImageInspector(ctx, engine, inspectionRoot, store)
	if err != nil {
		t.Fatal(err)
	}
	capabilities, err := inspector.InspectNativeSnapshotHelper(ctx, image.ID)
	if err != nil || !capabilities.SnapshotHelper {
		t.Fatal(capabilities, err)
	}
	agent, native := migrationAgentImage(t, engine, ctx)
	if !native {
		t.Fatal("native Agent fixture required")
	}
	sequence := 0
	run := func(work, volume, logical, action, digest, contextKey, packageKey string) json.RawMessage {
		t.Helper()
		sequence++
		spec := SnapshotHelperSpec{WorkID: work, JobID: "snapshot-job-1234567890", AttemptID: fmt.Sprintf("snapshot-attempt-%08d", sequence), Epoch: 1, ImageID: image.ID, SpoolDirectory: spool, VolumeName: volume, VolumeLogicalID: logical, Action: action, TreeDigest: digest, ContextKey: contextKey, PackageKey: packageKey}
		ensured, err := runtime.EnsureSnapshotHelper(ctx, spec)
		if err != nil {
			t.Fatal(action, "ensure", err)
		}
		output, err := runtime.RunSnapshotHelper(ctx, spec)
		if err != nil {
			t.Fatal(action, "run", err)
		}
		if _, err := runtime.RunSnapshotHelper(ctx, spec); err == nil {
			t.Fatal("exited action replayed")
		}
		if err := runtime.RemoveSnapshotHelper(ctx, spec, ensured.ID); err != nil {
			t.Fatal(action, "remove", err)
		}
		return output
	}
	var captures []struct {
		Tree                        string
		Size, Entries, LogicalBytes int64
	}
	for i, logical := range []string{"work-private", "work-workspace"} {
		work := "snapshot-source-work-123456789"
		source, err := runtime.EnsureVolume(ctx, work, logical)
		if err != nil {
			t.Fatal(err)
		}
		targetPath := "/var/data"
		if logical == "work-workspace" {
			targetPath += "/workspace"
		}
		code := `const fs=require('fs'),p=process.argv[1];fs.mkdirSync(p+'/empty-dir');fs.mkdirSync(p+'/node_modules');fs.writeFileSync(p+'/.env',Buffer.from([0,255,1,0]));fs.linkSync(p+'/.env',p+'/hardlink');fs.writeFileSync(p+'/script',"throw Error('do not execute');",{mode:0o751});fs.writeFileSync(p+'/node_modules/dependency.js','opaque dependency');fs.symlinkSync('/outside/secret',p+'/absolute');fs.symlinkSync('missing',p+'/broken');`
		seed := ContainerSpec{Identity: ContainerIdentity{WorkID: work, Kind: "agent", LogicalID: "snapshot-seed-" + strconv.Itoa(i)}, Image: agent.ID, Entrypoint: []string{"node"}, Command: []string{"-e", code, targetPath}, User: "10001:10001", Mounts: []ContainerMount{{Type: "volume", Source: source.Name, Target: targetPath, CopyImageData: true}}}
		if _, err := runtime.EnsureContainer(ctx, seed); err != nil {
			t.Fatal(err)
		}
		if _, err := runtime.StartContainer(ctx, seed.Identity); err != nil {
			t.Fatal(err)
		}
		for {
			view, err := runtime.InspectContainer(ctx, seed.Identity)
			if err != nil {
				t.Fatal(err)
			}
			if view != nil && view.State != nil && view.State.Status == "exited" {
				if view.State.ExitCode != 0 {
					logs, _ := runtime.Logs(ctx, seed.Identity, 20, view.ID)
					t.Fatal("seed", logs.Text)
				}
				break
			}
			select {
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			case <-time.After(20 * time.Millisecond):
			}
		}
		if err := runtime.RemoveContainer(ctx, seed.Identity); err != nil {
			t.Fatal(err)
		}
		var captured struct {
			Tree                        string
			Size, Entries, LogicalBytes int64
		}
		output := run(work, source.Name, logical, "capture", "", "", "")
		if err := json.Unmarshal(output, &captured); err != nil {
			t.Fatal(err)
		}
		captures = append(captures, captured)
		targetWork := "snapshot-target-work-123456789"
		target, err := runtime.EnsureVolume(ctx, targetWork, logical)
		if err != nil {
			t.Fatal(err)
		}
		run(targetWork, target.Name, logical, "restore", captured.Tree, "", "")
		var after struct {
			Tree                        string
			Size, Entries, LogicalBytes int64
		}
		if err := json.Unmarshal(run(targetWork, target.Name, logical, "capture", "", "", ""), &after); err != nil {
			t.Fatal(err)
		}
		if after != captured {
			t.Fatal("volume metadata/byte identity changed", logical, captured, after)
		}
	}
	blobs, err := workpackage.OpenBlobDirectory(spool)
	if err != nil {
		t.Fatal(err)
	}
	defer blobs.Close()
	for i, captured := range captures {
		raw, err := blobs.ReadMetadata(ctx, captured.Tree)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Contains(raw, []byte(`"type":"hardlink"`)) || !bytes.Contains(raw, []byte(`"targetBase64"`)) {
			t.Fatal("links absent", i, string(raw))
		}
	}
	contextKey := "c-restored"
	if err := os.MkdirAll(filepath.Join(spool, "contexts", contextKey), 0700); err != nil {
		t.Fatal(err)
	}
	run("snapshot-target-work-123456789", "", "", "restore-context", captures[1].Tree, contextKey, "")
	info, err := os.Stat(filepath.Join(spool, "contexts", contextKey, ".env"))
	if err != nil {
		t.Fatal(err)
	}
	if !info.Mode().IsRegular() {
		t.Fatal("context file missing")
	}
	if data, err := os.ReadFile(filepath.Join(spool, "contexts", contextKey, ".env")); err != nil || !bytes.Equal(data, []byte{0, 255, 1, 0}) {
		t.Fatal("context ownership/content", err, data)
	}
	packageKey := "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
	packagePath := filepath.Join(spool, "context-packages", contextKey, packageKey)
	if err := os.MkdirAll(packagePath, 0700); err != nil {
		t.Fatal(err)
	}
	run("snapshot-target-work-123456789", "", "", "restore-package", captures[1].Tree, contextKey, packageKey)
	if data, err := os.ReadFile(filepath.Join(packagePath, "node_modules", "dependency.js")); err != nil || string(data) != "opaque dependency" {
		t.Fatal("dependency bytes", err, string(data))
	}
	remaining, err := engine.api.ContainerList(ctx, client.ContainerListOptions{All: true, Filters: make(client.Filters).Add("label", InstallationLabel+"="+scope.ID()).Add("label", KindLabel+"=snapshot-helper")})
	if err != nil || len(remaining.Items) != 0 {
		t.Fatal("snapshot helpers leaked", err, len(remaining.Items))
	}
}
