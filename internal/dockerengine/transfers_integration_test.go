//go:build integration

package dockerengine

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/testsupport"
)

func TestRealAttachArchiveLogsAndImageSaveLoad(t *testing.T) {
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
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	image, err := engine.PrepareImage(ctx, "python:3.13-slim")
	if err != nil {
		t.Fatal(err)
	}
	volume, err := runtime.EnsureVolume(ctx, "work-transfer", "work-workspace")
	if err != nil {
		t.Fatal(err)
	}
	spec := fixtureSpec()
	spec.Identity.WorkID = "work-transfer"
	spec.DisplayName = ""
	spec.Image = image.ID
	spec.Stdin = true
	spec.Command = []string{"python", "-c", "import sys;data=sys.stdin.buffer.read();sys.stdout.buffer.write(data);sys.stdout.buffer.flush();sys.stderr.write('e'*80000+'ERR_END');sys.stderr.flush()"}
	spec.Mounts = []ContainerMount{{Type: "volume", Source: volume.Name, Target: "/var/data/workspace"}}
	ensured, err := runtime.EnsureContainer(ctx, spec)
	if err != nil {
		t.Fatal(err)
	}
	attached, err := runtime.Attach(ctx, spec.Identity)
	if err != nil {
		t.Fatal(err)
	}
	defer attached.Close()
	if _, err := runtime.StartContainer(ctx, spec.Identity); err != nil {
		t.Fatal(err)
	}
	payload := bytes.Repeat([]byte{0, 255, 128, 1, 4, 0, 13, 5}, 32768)
	var inputTar bytes.Buffer
	writer := tar.NewWriter(&inputTar)
	if err := writer.WriteHeader(&tar.Header{Name: "echo.bin", Size: int64(len(payload)), Mode: 0640, Uid: 65532, Gid: 65532}); err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := runtime.ArchiveTo(ctx, spec.Identity, "/var/data/workspace", bytes.NewReader(inputTar.Bytes()), 1<<20); err != nil {
		t.Fatal(err)
	}
	var copied bytes.Buffer
	if _, err := runtime.ArchiveFrom(ctx, spec.Identity, "/var/data/workspace/echo.bin", &copied, 1<<20); err != nil {
		t.Fatal(err)
	}
	tree := tar.NewReader(bytes.NewReader(copied.Bytes()))
	header, err := tree.Next()
	if err != nil || header.Size != int64(len(payload)) || header.Mode&0777 != 0640 || header.Uid != 65532 {
		t.Fatal(header, err)
	}
	restored, err := io.ReadAll(tree)
	if err != nil || !bytes.Equal(restored, payload) {
		t.Fatal("archive binary mismatch", err)
	}
	var stdout bytes.Buffer
	stderr := newTail(65536)
	result := make(chan error, 1)
	go func() { result <- attached.CopyOutputs(&stdout, stderr) }()
	if _, err := attached.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := attached.CloseWrite(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("attach never completed")
	}
	if !bytes.Equal(stdout.Bytes(), payload) || !stderr.truncated || !bytes.HasSuffix(stderr.bytes, []byte("ERR_END")) {
		view, _ := runtime.InspectContainer(ctx, spec.Identity)
		t.Fatalf("attach mismatch: stdout=%d expected=%d stderr=%d truncated=%v state=%+v", stdout.Len(), len(payload), len(stderr.bytes), stderr.truncated, view.State)
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		view, err := runtime.InspectContainer(ctx, spec.Identity)
		if err != nil {
			t.Fatal(err)
		}
		if !view.State.Running {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("echo process never exited")
		}
		time.Sleep(5 * time.Millisecond)
	}
	logs, err := runtime.Logs(ctx, spec.Identity, 200, ensured.ID)
	if err != nil || !logs.Truncated || len(logs.Text) != 65536 {
		t.Fatal("logs mismatch", len(logs.Text), logs.Truncated, err)
	}
	// Existing immutable image bytes are saved to a private file and loaded back;
	// no image execution, replacement, tag creation, or broad cleanup is involved.
	before, err := engine.api.ImageInspect(ctx, image.ID)
	if err != nil {
		t.Fatal(err)
	}
	imageFile, err := os.CreateTemp(t.TempDir(), "image-*.tar")
	if err != nil {
		t.Fatal(err)
	}
	defer imageFile.Close()
	hash := sha256.New()
	size, err := engine.SaveImage(ctx, image.ID, io.MultiWriter(imageFile, hash), 256<<20)
	if err != nil || size == 0 {
		t.Fatal(size, err)
	}
	if err := imageFile.Sync(); err != nil {
		t.Fatal(err)
	}
	if _, err := imageFile.Seek(0, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	if err := engine.LoadImage(ctx, imageFile, 256<<20); err != nil {
		t.Fatal(err)
	}
	after, err := engine.api.ImageInspect(ctx, image.ID)
	if err != nil || after.ID != before.ID || !reflect.DeepEqual(after.RepoTags, before.RepoTags) {
		t.Fatal("saved image identity/tags changed", err)
	}
	t.Logf("attach/archive/logs and streamed image (%d bytes, sha256=%s) passed in %s", size, hex.EncodeToString(hash.Sum(nil)), scope.ID())
}
