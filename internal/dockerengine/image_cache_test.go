package dockerengine

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/moby/moby/client"
	"piwork/internal/corestore"
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
	labels["io.piwork.work-history.schema"], labels["io.piwork.run-model.contract"], labels["io.piwork.work-feedback.contract"], labels["fixture.marker"] = "4", "1", "1", marker
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
