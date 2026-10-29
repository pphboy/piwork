package dockerengine

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/moby/moby/client"
	"piwork/internal/corestore"
	"piwork/internal/diagnostics"
	"piwork/internal/imagestatic"
	"piwork/internal/safefs"
)

type cachedImageFixture struct {
	id      string
	archive []byte
	labels  map[string]string
	saves   atomic.Int32
}

func cacheImage(t *testing.T, marker string) *cachedImageFixture {
	return cacheImageWithHistory(t, marker, "4")
}

func cacheImageWithHistory(t *testing.T, marker, history string) *cachedImageFixture {
	t.Helper()
	elf := make([]byte, 128)
	copy(elf, "\x7fELF")
	elf[4], elf[5], elf[6] = 2, 1, 1
	binary.LittleEndian.PutUint16(elf[16:], 2)
	binary.LittleEndian.PutUint16(elf[18:], 62)
	binary.LittleEndian.PutUint32(elf[20:], 1)
	binary.LittleEndian.PutUint64(elf[24:], 0x400000)
	binary.LittleEndian.PutUint64(elf[32:], 64)
	binary.LittleEndian.PutUint16(elf[52:], 64)
	binary.LittleEndian.PutUint16(elf[54:], 56)
	binary.LittleEndian.PutUint16(elf[56:], 1)
	binary.LittleEndian.PutUint32(elf[64:], 1)
	binary.LittleEndian.PutUint32(elf[68:], 5)
	binary.LittleEndian.PutUint64(elf[80:], 0x400000)
	binary.LittleEndian.PutUint64(elf[96:], 128)
	binary.LittleEndian.PutUint64(elf[104:], 128)
	archive := func(files map[string][]byte) []byte {
		var buffer bytes.Buffer
		writer := tar.NewWriter(&buffer)
		for name, data := range files {
			if err := writer.WriteHeader(&tar.Header{Name: name, Mode: 0755, Size: int64(len(data))}); err != nil {
				t.Fatal(err)
			}
			if _, err := writer.Write(data); err != nil {
				t.Fatal(err)
			}
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		return buffer.Bytes()
	}
	layer := archive(map[string][]byte{imagestatic.PackageHelperPath: elf, imagestatic.ServiceMCPPath: elf,
		"usr/local/include/node/node_version.h":                               []byte("#define NODE_MODULE_VERSION 137\n"),
		"workspace/node_modules/@earendil-works/pi-coding-agent/package.json": []byte(`{"version":"0.86.1"}`)})
	labels := nativeLabels()
	labels["io.piwork.work-history.schema"], labels["io.piwork.run-model.contract"], labels["io.piwork.work-feedback.contract"], labels["fixture.marker"] = history, "1", "1", marker
	config, _ := json.Marshal(map[string]any{"os": "linux", "architecture": "amd64", "config": map[string]any{"Labels": labels, "User": "10001:10001", "Entrypoint": []string{"node", "/workspace/apps/agentd/dist/main.js"}}, "rootfs": map[string]any{"type": "layers", "diff_ids": []string{fmt.Sprintf("sha256:%x", sha256.Sum256(layer))}}})
	manifest, _ := json.Marshal([]map[string]any{{"Config": "config.json", "Layers": []string{"layer.tar"}}})
	return &cachedImageFixture{id: fmt.Sprintf("sha256:%x", sha256.Sum256(config)), archive: archive(map[string][]byte{"config.json": config, "manifest.json": manifest, "layer.tar": layer}), labels: labels}
}

func cachedInspector(t *testing.T, images []*cachedImageFixture, inspect func(http.ResponseWriter, string) bool, save func(*cachedImageFixture, http.ResponseWriter, *http.Request)) (*ImageInspector, *Engine) {
	t.Helper()
	socket := shortEngineSocket(t, "cache.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Error("inspection executed image code", r.Method)
			w.WriteHeader(403)
			return
		}
		p := strings.TrimPrefix(r.URL.Path, "/v1.45")
		if p == "/info" {
			json.NewEncoder(w).Encode(map[string]string{"ID": "fixture-daemon", "Driver": "overlay2", "DockerRootDir": "/var/lib/docker"})
			return
		}
		if strings.HasPrefix(p, "/images/") && strings.HasSuffix(p, "/json") {
			ref := strings.TrimSuffix(strings.TrimPrefix(p, "/images/"), "/json")
			if inspect != nil && inspect(w, ref) {
				return
			}
			for _, image := range images {
				if image.id == ref {
					json.NewEncoder(w).Encode(map[string]any{"Id": image.id, "Os": "linux", "Architecture": "amd64", "Config": map[string]any{"Labels": image.labels}})
					return
				}
			}
		} else if p == "/images/get" {
			for _, image := range images {
				if image.id == r.URL.Query().Get("names") {
					image.saves.Add(1)
					if save != nil {
						save(image, w, r)
					} else {
						w.Write(image.archive)
					}
					return
				}
			}
		}
		http.NotFound(w, r)
	})}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close(); listener.Close() })
	api, err := client.NewClientWithOpts(client.WithHost("unix://"+socket), client.WithVersion("1.45"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { api.Close() })
	store, err := corestore.Open(context.Background(), corestore.Options{Directory: t.TempDir(), InstallationID: "installation-image-cache"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	directory := t.TempDir()
	os.Chmod(directory, 0700)
	root, err := safefs.OpenRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })
	if err := root.Lock(); err != nil {
		t.Fatal(err)
	}
	engine := &Engine{api: api}
	i, err := NewImageInspector(context.Background(), engine, root, store)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := i.Close(ctx); err != nil {
			t.Error(err)
		}
	})
	return i, engine
}

func TestImageCacheReusesValidatedArchiveAndClonesCapabilities(t *testing.T) {
	image := cacheImage(t, "first")
	i, _ := cachedInspector(t, []*cachedImageFixture{image}, nil, nil)
	first, err := i.InspectNativeAgent(context.Background(), image.id)
	if err != nil || first.Environment == nil {
		t.Fatal(first, err)
	}
	first.Environment.NodeAbi = "changed"
	first.Environment.Variant[0] = 'x'
	next, err := i.InspectNativeAgent(context.Background(), image.id)
	if err != nil || next.Environment.NodeAbi != "137" || string(next.Environment.Variant) != "null" || image.saves.Load() != 1 {
		t.Fatal(next, err, image.saves.Load())
	}
	if _, err := i.InspectNativeFileHelper(context.Background(), image.id); !errors.Is(err, ErrImageIncompatible) || image.saves.Load() != 1 {
		t.Fatal(err)
	}
}

func TestImageCacheHitDoesNotWaitForOtherArchiveAndSameKeyMerges(t *testing.T) {
	a, b := cacheImage(t, "a"), cacheImage(t, "b")
	blocked, release := make(chan struct{}), make(chan struct{})
	i, _ := cachedInspector(t, []*cachedImageFixture{a, b}, nil, func(image *cachedImageFixture, w http.ResponseWriter, r *http.Request) {
		if image == b {
			close(blocked)
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
		}
		w.Write(image.archive)
	})
	if _, err := i.InspectNativeAgent(context.Background(), a.id); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 2)
	go func() { _, err := i.InspectNativeAgent(context.Background(), b.id); done <- err }()
	<-blocked
	go func() { _, err := i.InspectNativeAgent(context.Background(), b.id); done <- err }()
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	if _, err := i.InspectNativeAgent(ctx, a.id); err != nil {
		close(release)
		t.Fatal("hit blocked behind unrelated scan", err)
	}
	close(release)
	for range 2 {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	if a.saves.Load() != 1 || b.saves.Load() != 1 {
		t.Fatal(a.saves.Load(), b.saves.Load())
	}
}

func TestImagePersistentHitDoesNotWaitForUnrelatedArchive(t *testing.T) {
	a, b := cacheImage(t, "persistent-hit"), cacheImage(t, "blocked-scan")
	blocked, release := make(chan struct{}), make(chan struct{})
	first, engine := cachedInspector(t, []*cachedImageFixture{a, b}, nil, func(image *cachedImageFixture, w http.ResponseWriter, r *http.Request) {
		if image == b {
			close(blocked)
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
		}
		w.Write(image.archive)
	})
	if _, err := first.InspectNativeAgent(context.Background(), a.id); err != nil {
		t.Fatal(err)
	}
	if err := first.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	second, err := NewImageInspector(context.Background(), engine, first.root, first.registry)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close(context.Background())
	done := make(chan error, 1)
	go func() { _, err := second.InspectNativeAgent(context.Background(), b.id); done <- err }()
	<-blocked
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, err = second.InspectNativeAgent(ctx, a.id)
	close(release)
	if err != nil {
		t.Fatal("persistent hit waited for another image's scan", err)
	}
	if err := <-done; err != nil || a.saves.Load() != 1 || b.saves.Load() != 1 {
		t.Fatal("unexpected scan count", err, a.saves.Load(), b.saves.Load())
	}
}

func TestImageCacheRechecksAvailabilityIdentityAndTag(t *testing.T) {
	a, b := cacheImage(t, "a"), cacheImage(t, "b")
	var mode atomic.Int32
	i, engine := cachedInspector(t, []*cachedImageFixture{a, b}, func(w http.ResponseWriter, ref string) bool {
		if ref == "fixture:current" {
			image := a
			if mode.Load() == 4 {
				image = b
			}
			json.NewEncoder(w).Encode(map[string]any{"Id": image.id, "Os": "linux", "Architecture": "amd64", "Config": map[string]any{"Labels": image.labels}})
			return true
		}
		switch mode.Load() {
		case 1:
			w.WriteHeader(404)
			return true
		case 2:
			w.WriteHeader(500)
			return true
		case 3:
			json.NewEncoder(w).Encode(map[string]any{"Id": ref, "Os": "linux", "Architecture": "arm64", "Config": map[string]any{"Labels": a.labels}})
			return true
		}
		return false
	}, nil)
	if _, err := i.InspectNativeAgent(context.Background(), a.id); err != nil {
		t.Fatal(err)
	}
	mode.Store(2)
	if _, err := i.InspectNativeAgent(context.Background(), a.id); err == nil {
		t.Fatal("cache bypassed unavailable Engine")
	}
	mode.Store(0)
	if _, err := i.InspectNativeAgent(context.Background(), a.id); err != nil || a.saves.Load() != 1 {
		t.Fatal(err, a.saves.Load())
	}
	mode.Store(1)
	if _, err := i.InspectNativeAgent(context.Background(), a.id); !errors.Is(err, ErrResourceMissing) {
		t.Fatal(err)
	}
	mode.Store(0)
	if _, err := i.InspectNativeAgent(context.Background(), a.id); err != nil || a.saves.Load() != 2 {
		t.Fatal(err, a.saves.Load())
	}
	mode.Store(3)
	if _, err := i.InspectNativeAgent(context.Background(), a.id); !errors.Is(err, ErrImageIncompatible) {
		t.Fatal(err)
	}
	mode.Store(0)
	if _, err := i.InspectNativeAgent(context.Background(), a.id); err != nil || a.saves.Load() != 3 {
		t.Fatal("incompatible observation did not invalidate durable result", err, a.saves.Load())
	}
	selected, err := engine.PrepareImage(context.Background(), "fixture:current")
	if err != nil || selected.ID != a.id {
		t.Fatal(err)
	}
	mode.Store(4)
	selected, err = engine.PrepareImage(context.Background(), "fixture:current")
	if err != nil || selected.ID != b.id {
		t.Fatal(err)
	}
	if _, err := i.InspectNativeAgent(context.Background(), selected.ID); err != nil || b.saves.Load() != 1 {
		t.Fatal(err, b.saves.Load())
	}
}

type failingInspectionRegistry struct {
	InspectionRegistry
	fail atomic.Bool
}

func (r *failingInspectionRegistry) CompleteImageInspection(ctx context.Context, id string) error {
	if r.fail.Load() {
		return errors.New("cleanup failed")
	}
	return r.InspectionRegistry.CompleteImageInspection(ctx, id)
}

func TestImageCacheDoesNotCacheUnconfirmedInspectionCleanup(t *testing.T) {
	image := cacheImage(t, "cleanup")
	i, _ := cachedInspector(t, []*cachedImageFixture{image}, nil, nil)
	registry := &failingInspectionRegistry{InspectionRegistry: i.registry}
	registry.fail.Store(true)
	i.registry = registry
	if _, err := i.InspectNativeAgent(context.Background(), image.id); !errors.Is(err, ErrInspectionStorage) {
		t.Fatal(err)
	}
	registry.fail.Store(false)
	if _, err := i.InspectNativeAgent(context.Background(), image.id); err != nil || image.saves.Load() != 2 {
		t.Fatal(err, image.saves.Load())
	}
}

func TestImageCacheDoesNotPublishAfterStoreCommitFailure(t *testing.T) {
	ctx := context.Background()
	image := cacheImage(t, "failed-publication")
	inspector, _ := cachedInspector(t, []*cachedImageFixture{image}, nil, nil)
	store := inspector.registry.(*corestore.Store)
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`CREATE TEMP TRIGGER reject_preparation BEFORE INSERT ON control_metadata WHEN NEW.key GLOB 'internal_preparation_v1/*' BEGIN SELECT RAISE(ABORT,'fixture'); END`)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := inspector.InspectNativeAgent(ctx, image.id); !errors.Is(err, ErrInspectionStorage) {
		t.Fatal("failed publication was accepted", err)
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error { _, err := tx.Exec(`DROP TRIGGER reject_preparation`); return err }); err != nil {
		t.Fatal(err)
	}
	if _, err := inspector.InspectNativeAgent(ctx, image.id); err != nil || image.saves.Load() != 2 {
		t.Fatal("failed publication was reused", err, image.saves.Load())
	}
}

func TestStoredCapabilitiesRequireCompleteValidatedFacts(t *testing.T) {
	image := cacheImage(t, "persistent-validation")
	inspector, _ := cachedInspector(t, []*cachedImageFixture{image}, nil, nil)
	capability, err := inspector.InspectNativeAgent(context.Background(), image.id)
	if err != nil {
		t.Fatal(err)
	}
	if !validStoredCapabilities(capability, capability.Identity, "agent") {
		t.Fatal("validated result rejected")
	}
	modified := capability
	modified.ServiceMCP = false
	if validStoredCapabilities(modified, capability.Identity, "agent") {
		t.Fatal("missing executable accepted")
	}
	modified = capability
	for _, schema := range []int64{4, 5, 6} {
		modified.WorkHistorySchema = schema
		if !validStoredCapabilities(modified, capability.Identity, "agent") {
			t.Fatal("supported history version rejected", schema)
		}
	}
	modified.WorkHistorySchema = 7
	if validStoredCapabilities(modified, capability.Identity, "agent") {
		t.Fatal("unknown history version accepted")
	}
	modified = capability
	modified.PackageHelperSHA256 = "sha256:broken"
	if validStoredCapabilities(modified, capability.Identity, "agent") {
		t.Fatal("bad digest accepted")
	}
	wrong := capability.Identity
	wrong.ID = "sha256:" + strings.Repeat("a", 64)
	if validStoredCapabilities(capability, wrong, "agent") || validStoredCapabilities(capability, capability.Identity, "file") {
		t.Fatal("incorrect identity or kind accepted")
	}
}

func TestImageCachePersistsAcrossInspectorRestart(t *testing.T) {
	for _, history := range []string{"4", "5", "6"} {
		t.Run("schema-"+history, func(t *testing.T) {
			image := cacheImageWithHistory(t, "persisted", history)
			first, engine := cachedInspector(t, []*cachedImageFixture{image}, nil, nil)
			if _, err := first.InspectNativeAgent(context.Background(), image.id); err != nil {
				t.Fatal(err)
			}
			if image.saves.Load() != 1 {
				t.Fatal("first verification missing")
			}
			if err := first.Close(context.Background()); err != nil {
				t.Fatal(err)
			}
			second, err := NewImageInspector(context.Background(), engine, first.root, first.registry)
			if err != nil {
				t.Fatal(err)
			}
			defer second.Close(context.Background())
			capability, err := second.InspectNativeAgent(context.Background(), image.id)
			if err != nil || !validStoredCapabilities(capability, capability.Identity, "agent") || image.saves.Load() != 1 {
				t.Fatal("durable result not reused", err, image.saves.Load())
			}
		})
	}
}

func TestImageCacheRechecksOnlyNewImageAndMismatchedRule(t *testing.T) {
	ctx := context.Background()
	images := []*cachedImageFixture{cacheImage(t, "version-a"), cacheImage(t, "version-b"), cacheImage(t, "version-c"), cacheImage(t, "version-new")}
	first, engine := cachedInspector(t, images, nil, nil)
	for _, image := range images[:3] {
		if _, err := first.InspectNativeAgent(ctx, image.id); err != nil {
			t.Fatal(err)
		}
	}
	if err := first.Close(ctx); err != nil {
		t.Fatal(err)
	}
	scope, _, err := engine.VerificationIdentity(ctx)
	if err != nil {
		t.Fatal(err)
	}
	store := first.registry.(*corestore.Store)
	key := corestore.PreparationKey{Engine: scope, Image: images[0].id, Kind: "agent", Platform: "linux/amd64/", Version: agentInspectionRuleVersion}
	raw, found, err := store.ReadPreparation(ctx, key)
	if err != nil || !found {
		t.Fatal("missing original rule result", found, err)
	}
	if err := store.DeletePreparation(ctx, key); err != nil {
		t.Fatal(err)
	}
	oldRule := key
	oldRule.Version++
	if saved, err := store.WritePreparation(ctx, oldRule, raw, nil); err != nil || !saved {
		t.Fatal("different rule fixture", saved, err)
	}
	second, err := NewImageInspector(ctx, engine, first.root, first.registry)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close(ctx)
	for _, image := range images {
		if _, err := second.InspectNativeAgent(ctx, image.id); err != nil {
			t.Fatal(err)
		}
	}
	for index, image := range images {
		want := int32(1)
		if index == 0 {
			want = 2
		}
		if image.saves.Load() != want {
			t.Fatalf("image %d exported %d times, want %d", index, image.saves.Load(), want)
		}
	}
}

func TestImagePreparationMetricsDistinguishMemoryDiskAndActualWork(t *testing.T) {
	image := cacheImage(t, "metrics")
	first, engine := cachedInspector(t, []*cachedImageFixture{image}, nil, nil)
	var output bytes.Buffer
	ctx := diagnostics.WithPerformanceWriter(diagnostics.WithPerformance(context.Background(), diagnostics.PerformanceIdentity{CorrelationID: "startup-fixture-123456"}), &output)
	if _, err := first.InspectNativeAgent(ctx, image.id); err != nil {
		t.Fatal(err)
	}
	if _, err := first.InspectNativeAgent(ctx, image.id); err != nil {
		t.Fatal(err)
	}
	count := func(phase, outcome, cache string) int {
		t.Helper()
		total := 0
		for _, line := range strings.Split(strings.TrimSpace(output.String()), "\n") {
			var event map[string]any
			if json.Unmarshal([]byte(line), &event) == nil && event["phase"] == phase && event["outcome"] == outcome && (cache == "" || event["cacheState"] == cache) {
				total++
			}
		}
		return total
	}
	if count("image-export", "started", "") != 1 || count("image-scan", "started", "") != 1 || count("image-inspection", "succeeded", "hit") != 1 {
		t.Fatal("heavy work or memory hit counted incorrectly", output.String())
	}
	if err := first.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	output.Reset()
	second, err := NewImageInspector(context.Background(), engine, first.root, first.registry)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close(context.Background())
	if _, err := second.InspectNativeAgent(ctx, image.id); err != nil {
		t.Fatal(err)
	}
	if count("agent-image-persistent-hit", "succeeded", "") != 1 || count("image-export", "started", "") != 0 || count("image-scan", "started", "") != 0 {
		t.Fatal("durable hit was not distinguished from heavy work", output.String())
	}
}

func TestImageCacheInvalidationFencesLatePublication(t *testing.T) {
	image := cacheImage(t, "late-invalidation")
	started, release := make(chan struct{}), make(chan struct{})
	var missing atomic.Bool
	inspector, _ := cachedInspector(t, []*cachedImageFixture{image}, func(w http.ResponseWriter, ref string) bool {
		if ref == image.id && missing.Load() {
			w.WriteHeader(http.StatusNotFound)
			return true
		}
		return false
	}, func(image *cachedImageFixture, w http.ResponseWriter, r *http.Request) {
		if image.saves.Load() == 1 {
			close(started)
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
		}
		_, _ = w.Write(image.archive)
	})
	done := make(chan error, 1)
	go func() { _, err := inspector.InspectNativeAgent(context.Background(), image.id); done <- err }()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("verification did not start")
	}
	missing.Store(true)
	if _, err := inspector.InspectNativeAgent(context.Background(), image.id); !errors.Is(err, ErrResourceMissing) {
		t.Fatal("missing image accepted", err)
	}
	close(release)
	if err := <-done; err == nil {
		t.Fatal("invalidated inspection returned success")
	}
	missing.Store(false)
	if _, err := inspector.InspectNativeAgent(context.Background(), image.id); err != nil {
		t.Fatal(err)
	}
	if image.saves.Load() != 2 {
		t.Fatal("late inspection published reusable result", image.saves.Load())
	}
}

func TestImageCachePersistsAcrossProcesses(t *testing.T) {
	if os.Getenv("PIWORK_INSPECTION_CHILD") == "1" {
		ctx := context.Background()
		api, err := client.NewClientWithOpts(client.WithHost(os.Getenv("PIWORK_INSPECTION_SOCKET")), client.WithVersion("1.45"))
		if err != nil {
			t.Fatal(err)
		}
		defer api.Close()
		store, err := corestore.Open(ctx, corestore.Options{Directory: os.Getenv("PIWORK_INSPECTION_STORE"), InstallationID: "installation-process-cache"})
		if err != nil {
			t.Fatal(err)
		}
		defer store.Close()
		root, err := safefs.OpenRoot(os.Getenv("PIWORK_INSPECTION_ROOT"))
		if err != nil {
			t.Fatal(err)
		}
		defer root.Close()
		if err := root.Lock(); err != nil {
			t.Fatal(err)
		}
		inspector, err := NewImageInspector(ctx, &Engine{api: api}, root, store)
		if err != nil {
			t.Fatal(err)
		}
		defer inspector.Close(ctx)
		for _, id := range strings.Split(os.Getenv("PIWORK_INSPECTION_IMAGE"), ",") {
			if _, err := inspector.InspectNativeAgent(ctx, id); err != nil {
				t.Fatal(err)
			}
		}
		return
	}
	images := []*cachedImageFixture{cacheImage(t, "process-a"), cacheImage(t, "process-b"), cacheImage(t, "process-c")}
	_, engine := cachedInspector(t, images, nil, nil)
	ids := []string{images[0].id, images[1].id, images[2].id}
	dir := t.TempDir()
	root := filepath.Join(dir, "scratch")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	store := filepath.Join(dir, "store")
	for attempt := 0; attempt < 2; attempt++ {
		cmd := exec.Command(os.Args[0], "-test.run=^TestImageCachePersistsAcrossProcesses$")
		cmd.Env = append(os.Environ(), "PIWORK_INSPECTION_CHILD=1", "PIWORK_INSPECTION_SOCKET="+engine.api.DaemonHost(), "PIWORK_INSPECTION_STORE="+store, "PIWORK_INSPECTION_ROOT="+root, "PIWORK_INSPECTION_IMAGE="+strings.Join(ids, ","))
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("child %d: %v\n%s", attempt, err, output)
		}
	}
	for _, image := range images {
		if image.saves.Load() != 1 {
			t.Fatalf("expected one full export per image across processes, got %d", image.saves.Load())
		}
	}
}

func TestImageCacheProcessInterruptedBeforePublication(t *testing.T) {
	completed, interrupted := cacheImage(t, "completed-before-crash"), cacheImage(t, "interrupted-before-publication")
	started := make(chan struct{})
	var block atomic.Bool
	block.Store(true)
	_, engine := cachedInspector(t, []*cachedImageFixture{completed, interrupted}, nil, func(image *cachedImageFixture, w http.ResponseWriter, r *http.Request) {
		if image == interrupted && block.Load() {
			close(started)
			<-r.Context().Done()
			return
		}
		w.Write(image.archive)
	})
	dir := t.TempDir()
	root, store := filepath.Join(dir, "scratch"), filepath.Join(dir, "store")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	child := func(ids ...string) *exec.Cmd {
		cmd := exec.Command(os.Args[0], "-test.run=^TestImageCachePersistsAcrossProcesses$")
		cmd.Env = append(os.Environ(), "PIWORK_INSPECTION_CHILD=1", "PIWORK_INSPECTION_SOCKET="+engine.api.DaemonHost(), "PIWORK_INSPECTION_STORE="+store, "PIWORK_INSPECTION_ROOT="+root, "PIWORK_INSPECTION_IMAGE="+strings.Join(ids, ","))
		return cmd
	}
	if output, err := child(completed.id).CombinedOutput(); err != nil {
		t.Fatalf("initial success: %v\n%s", err, output)
	}
	crashed := child(interrupted.id)
	if err := crashed.Start(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		_ = crashed.Process.Kill()
		_ = crashed.Wait()
		t.Fatal("inspection did not reach the interrupted export")
	}
	if err := crashed.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = crashed.Wait()
	block.Store(false)
	if output, err := child(completed.id, interrupted.id).CombinedOutput(); err != nil {
		t.Fatalf("recovery after interrupted inspection: %v\n%s", err, output)
	}
	if completed.saves.Load() != 1 || interrupted.saves.Load() != 2 {
		t.Fatal("interrupted record was reused or completed record was lost", completed.saves.Load(), interrupted.saves.Load())
	}
}
