//go:build integration

package dockerengine

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/fileprotocol"
	"piwork/internal/testsupport"
)

func TestNativeFileHelperEngineAttachAndWorkspaceIsolation(t *testing.T) {
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	helperImage := os.Getenv("PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE")
	if helperImage == "" {
		t.Fatal("native file helper image is required")
	}
	seedImage := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE")
	if seedImage == "" {
		t.Fatal("native Agent image seeds ordinary Work volume ownership")
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
	t.Cleanup(func() { engine.Close() })
	scope, err := testsupport.NewScope()
	if err != nil {
		t.Fatal(err)
	}
	t.Log("File helper installation:", scope.ID())
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
	t.Cleanup(func() { store.Close() })
	runtime, err := NewRuntime(engine, scope.ID(), func(ctx context.Context, plan ResourcePlan) error {
		return store.RecordResourceIntent(ctx, corestore.ResourceIntent{WorkID: plan.WorkID, Kind: plan.Kind, LogicalID: plan.LogicalID, Name: plan.Name, Labels: plan.Labels})
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	image, err := engine.PrepareImage(ctx, helperImage)
	if err != nil {
		t.Fatal(err)
	}
	platform, err := store.OpenPlatformFiles()
	if err != nil {
		t.Fatal(err)
	}
	defer platform.Close()
	root, err := platform.OpenInspectionRoot()
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	inspector, err := NewImageInspector(ctx, engine, root, store)
	if err != nil {
		t.Fatal(err)
	}
	capabilities, err := inspector.InspectNativeFileHelper(ctx, image.ID)
	if err != nil || !capabilities.FileHelper {
		t.Fatal(capabilities, err)
	}
	workID := "work-1234567890123456"
	volume, err := runtime.EnsureVolume(ctx, workID, "work-workspace")
	if err != nil {
		t.Fatal(err)
	}
	seed, err := engine.PrepareImage(ctx, seedImage)
	if err != nil {
		t.Fatal(err)
	}
	// Docker copy-up is the normal Work initialization; the Agent itself, its
	// private volume, network and RPC server are unnecessary for file access.
	seedSpec := ContainerSpec{Identity: ContainerIdentity{WorkID: workID, Kind: "agent", LogicalID: "volume-seed"}, Image: seed.ID, Entrypoint: []string{"/usr/local/bin/piwork-service-mcp"}, Command: []string{"--version"}, User: "10001:10001", Mounts: []ContainerMount{{Type: "volume", Source: volume.Name, Target: "/var/data/workspace", CopyImageData: true}}}
	if _, err := runtime.EnsureContainer(ctx, seedSpec); err != nil {
		t.Fatal(err)
	}
	if err := runtime.RemoveContainer(ctx, seedSpec.Identity); err != nil {
		t.Fatal(err)
	}
	sequence := 0
	var preparedCount int
	run := func(action string, path []string, change func(map[string]any), upload []byte, deny bool) (contracts.FileHelperResult, []contracts.FileHelperMeta, []byte, []contracts.FileHelperError) {
		t.Helper()
		sequence++
		jobID, attemptID := fmt.Sprintf("filejob-123456789%08d", sequence), fmt.Sprintf("fileattempt-123456789%08d", sequence)
		spec := FileHelperSpec{WorkID: workID, JobID: jobID, AttemptID: attemptID, Epoch: 1, ImageID: image.ID, VolumeName: volume.Name, ReadOnly: !fileprotocol.Mutation(action)}
		ensured, err := runtime.EnsureFileHelper(ctx, spec)
		if err != nil {
			t.Fatal(err)
		}
		if ensured.Name != FileHelperName(scope.ID(), jobID, attemptID) {
			t.Fatal("helper name mismatch", ensured)
		}
		view, err := runtime.InspectContainer(ctx, FileHelperIdentity(spec))
		if err != nil {
			t.Fatal(err)
		}
		if err := runtime.validateFileHelper(ctx, spec, view); err != nil {
			t.Fatal(err)
		}
		if len(view.HostConfig.Tmpfs) != 1 || view.HostConfig.Tmpfs["/tmp"] != "rw,noexec,nosuid,nodev,size=16m,mode=1777" || view.Config.Labels[FileJobLabel] != jobID || view.Config.Labels[FileAttemptLabel] != attemptID {
			t.Fatal("helper confinement mismatch")
		}
		stream, err := runtime.AttachFileHelper(ctx, spec)
		if err != nil {
			t.Fatal(err)
		}
		defer stream.Close()
		if _, err := runtime.StartContainer(ctx, FileHelperIdentity(spec)); err != nil {
			t.Fatal(err)
		}
		request := map[string]any{"version": 1, "jobId": jobID, "workId": workID, "epoch": 1, "action": action, "pathSegments": path, "destinationSegments": nil, "depth": nil, "overwrite": nil, "conditions": map[string]any{"ifMatch": nil, "ifNoneMatch": nil, "ifModifiedSince": nil, "ifUnmodifiedSince": nil}, "range": nil, "expectedLength": nil}
		if change != nil {
			change(request)
		}
		if err := fileprotocol.Write(stream, fileprotocol.Request, request, true); err != nil {
			t.Fatal(err)
		}
		var result contracts.FileHelperResult
		var entries []contracts.FileHelperMeta
		var data bytes.Buffer
		var failures []contracts.FileHelperError
	terminal:
		for {
			frame, err := fileprotocol.Read(stream, false)
			if err != nil {
				t.Fatal("invalid native helper frame", err)
			}
			switch frame.Kind {
			case fileprotocol.Prepared:
				notice, err := fileprotocol.Decode[contracts.FileHelperPrepared](frame, "FileHelperPreparedSchema")
				if err != nil {
					t.Fatal(err)
				}
				preparedCount++
				if deny && notice.Phase == "commit" {
					if err := fileprotocol.Write(stream, fileprotocol.Cancel, map[string]any{}, true); err != nil {
						t.Fatal(err)
					}
					continue
				}
				if err := fileprotocol.Write(stream, fileprotocol.Ack, map[string]any{"epoch": notice.Epoch, "phase": notice.Phase, "temporaryId": notice.TemporaryId}, true); err != nil {
					t.Fatal(err)
				}
				if action == "PUT" && notice.Phase == "temporary" && string(notice.Device) != "null" {
					for start := 0; start < len(upload); start += fileprotocol.MaxData {
						end := start + fileprotocol.MaxData
						if end > len(upload) {
							end = len(upload)
						}
						if err := fileprotocol.Write(stream, fileprotocol.DataIn, upload[start:end], true); err != nil {
							t.Fatal(err)
						}
					}
					if err := fileprotocol.Write(stream, fileprotocol.End, map[string]any{}, true); err != nil {
						t.Fatal(err)
					}
				}
			case fileprotocol.Meta:
				entry, err := fileprotocol.Decode[contracts.FileHelperMeta](frame, "FileHelperMetaSchema")
				if err != nil {
					t.Fatal(err)
				}
				entries = append(entries, entry)
			case fileprotocol.DataOut:
				data.Write(frame.Data)
			case fileprotocol.Result:
				result, err = fileprotocol.Decode[contracts.FileHelperResult](frame, "FileHelperResultSchema")
				if err != nil {
					t.Fatal(err)
				}
				break terminal
			case fileprotocol.Error:
				failure, err := fileprotocol.Decode[contracts.FileHelperError](frame, "FileHelperErrorSchema")
				if err != nil {
					t.Fatal(err)
				}
				failures = append(failures, failure)
				if string(failure.PathSegments) == "null" {
					break terminal
				}
			default:
				t.Fatal("unexpected native helper output", frame.Kind)
			}
		}
		wait, stop := context.WithTimeout(ctx, 10*time.Second)
		defer stop()
		code, err := runtime.WaitFileHelperExit(wait, spec)
		if err != nil || (len(failures) == 0 && code != 0) || (len(failures) > 0 && result.Status == 0 && code == 0) {
			t.Fatal("helper process result mismatch", code, err, failures)
		}
		stream.Close()
		if err := runtime.RemoveContainer(ctx, FileHelperIdentity(spec)); err != nil {
			t.Fatal(err)
		}
		if err := runtime.ConfirmContainerAbsent(ctx, ensured.ID, ensured.Name); err != nil {
			t.Fatal(err)
		}
		return result, entries, data.Bytes(), failures
	}
	result, _, _, failures := run("MKCOL", []string{"中文"}, nil, nil, false)
	if result.Status != 201 || len(failures) != 0 {
		t.Fatal(result, failures)
	}
	payload := bytes.Repeat([]byte{0, 255, 7, 128, 13, 10, 3, 1}, 400000)
	result, _, _, failures = run("PUT", []string{"中文", "binary"}, func(r map[string]any) { r["expectedLength"] = len(payload) }, payload, false)
	if result.Status != 201 || result.Bytes != int64(len(payload)) || len(failures) != 0 {
		t.Fatal(result, failures)
	}
	result, _, data, failures := run("GET", []string{"中文", "binary"}, nil, nil, false)
	if result.Status != 200 || !bytes.Equal(data, payload) || len(failures) != 0 {
		t.Fatal(result, len(data), failures)
	}
	result, _, data, failures = run("GET", []string{"中文", "binary"}, func(r map[string]any) { r["range"] = map[string]any{"start": 1023, "end": 2053} }, nil, false)
	if result.Status != 206 || !bytes.Equal(data, payload[1023:2054]) || len(failures) != 0 {
		t.Fatal(result, failures)
	}
	result, metadata, data, failures := run("HEAD", []string{"中文", "binary"}, nil, nil, false)
	if result.Status != 200 || len(data) != 0 || len(metadata) != 1 || len(failures) != 0 {
		t.Fatal(result, failures)
	}
	_, _, _, failures = run("PUT", []string{"中文", "binary"}, nil, []byte("denied"), true)
	if len(failures) != 1 || failures[0].Code != "FILE_TRANSFER_TIMEOUT" {
		t.Fatal(failures)
	}
	result, metadata, _, failures = run("PROPFIND", []string{"中文"}, func(r map[string]any) { r["depth"] = 1 }, nil, false)
	if result.Status != 207 || len(metadata) != 2 || !reflect.DeepEqual(metadata[1].PathSegments, []string{"中文", "binary"}) || len(failures) != 0 {
		t.Fatal(result, metadata, failures)
	}
	result, _, data, _ = run("GET", []string{"中文", "binary"}, nil, nil, false)
	if !bytes.Equal(data, payload) {
		t.Fatal("denied commit changed file")
	}
	result, _, _, failures = run("COPY", []string{"中文"}, func(r map[string]any) { r["destinationSegments"] = []string{"copy"} }, nil, false)
	if result.Status != 201 || len(failures) != 0 {
		t.Fatal(result, failures)
	}
	result, _, _, failures = run("MOVE", []string{"copy", "binary"}, func(r map[string]any) { r["destinationSegments"] = []string{"moved"}; r["overwrite"] = false }, nil, false)
	if result.Status != 201 || len(failures) != 0 {
		t.Fatal(result, failures)
	}
	result, _, _, failures = run("DELETE", []string{"copy"}, nil, nil, false)
	if result.Status != 204 || len(failures) != 0 {
		t.Fatal(result, failures)
	}
	_, _, _, failures = run("GET", []string{"..", "core.sqlite"}, nil, nil, false)
	if len(failures) != 1 || failures[0].Code != "FILE_PATH_INVALID" {
		t.Fatal(failures)
	}
	private, err := runtime.EnsureVolume(ctx, workID, "work-data")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.EnsureFileHelper(ctx, FileHelperSpec{WorkID: workID, JobID: "filejob-private123456789", AttemptID: "fileattempt-private123456789", Epoch: 1, ImageID: image.ID, VolumeName: private.Name}); err == nil {
		t.Fatal("Agent private volume exposed")
	}
	remaining, err := runtime.ListContainers(ctx, "file-helper")
	if err != nil || len(remaining) != 0 {
		t.Fatal("helpers left behind", len(remaining), err)
	}
	serialized, _ := json.Marshal(capabilities)
	t.Logf("Go file helper image %s; %d ACK notices; confinement, binary/range, denial, namespace and no-host-tools verified: %s", image.ID, preparedCount, serialized)
}
