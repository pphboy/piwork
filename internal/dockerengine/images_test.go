package dockerengine

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/moby/moby/client"
)

func imageFixture(t *testing.T) (*Engine, *atomic.Int64, func(string)) {
	t.Helper()
	path := shortEngineSocket(t, "engine.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	first := "sha256:" + strings.Repeat("a", 64)
	second := "sha256:" + strings.Repeat("b", 64)
	var tagLock sync.Mutex
	tag := first
	pulls := &atomic.Int64{}
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		path := strings.TrimPrefix(req.URL.Path, "/v1.45")
		if path == "/images/create" {
			pulls.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, "{\"status\":\"progress\"}\n{\"errorDetail\":{\"message\":\"registry password secret\"}}\n")
			return
		}
		if strings.HasPrefix(path, "/images/") && strings.HasSuffix(path, "/json") {
			ref := strings.TrimSuffix(strings.TrimPrefix(path, "/images/"), "/json")
			id := ref
			if ref == "example:latest" {
				tagLock.Lock()
				id = tag
				tagLock.Unlock()
			}
			if id != first && id != second {
				http.Error(w, `{"message":"missing"}`, 404)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"Id": id, "Os": "linux", "Architecture": "amd64", "Config": map[string]any{"Labels": map[string]string{"example": "fixed"}}})
			return
		}
		http.NotFound(w, req)
	})}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close(); listener.Close() })
	api, err := client.NewClientWithOpts(client.WithHost("unix://"+path), client.WithVersion("1.45"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { api.Close() })
	return &Engine{api: api, Endpoint: Endpoint{ConfigDirectory: t.TempDir()}}, pulls, func(value string) { tagLock.Lock(); tag = value; tagLock.Unlock() }
}
func TestPreparedImageIdentityNeverFollowsChangedTag(t *testing.T) {
	engine, pulls, change := imageFixture(t)
	writeConfig(t, engine.Endpoint.ConfigDirectory, `{"credsStore":"unsupported-host-helper"}`)
	captured, err := engine.PrepareImage(context.Background(), "example:latest")
	if err != nil {
		t.Fatal(err)
	}
	change("sha256:" + strings.Repeat("b", 64))
	same, err := engine.PrepareImage(context.Background(), captured.ID)
	if err != nil || same.ID != captured.ID || pulls.Load() != 0 {
		t.Fatal(same, err, pulls.Load())
	}
	newer, err := engine.PrepareImage(context.Background(), "example:latest")
	if err != nil || newer.ID == captured.ID {
		t.Fatal(newer, err)
	}
	if _, err := engine.PrepareImage(context.Background(), "sha256:"+strings.Repeat("c", 64)); !errors.Is(err, ErrResourceMissing) || pulls.Load() != 0 {
		t.Fatal("captured ID pulled a replacement", err)
	}
	if _, err := engine.PrepareImage(context.Background(), "missing:latest"); !errors.Is(err, ErrCredentialHelper) || pulls.Load() != 0 {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(engine.Endpoint.ConfigDirectory, "config.json")); err != nil {
		t.Fatal(err)
	}
	_, err = engine.PrepareImage(context.Background(), "missing:latest")
	if !errors.Is(err, ErrImagePull) || strings.Contains(err.Error(), "secret") || pulls.Load() != 1 {
		t.Fatal(err, pulls.Load())
	}
}
func TestImageProgressHTTP200ErrorAndBoundedFrames(t *testing.T) {
	for _, content := range []string{"", "truncated", "{}\n{", "{\"status\":\"ok\"}\n{\"error\":\"secret\"}\n", "{\"errorDetail\":{\"code\":500}}\n", strings.Repeat("x", 1<<20) + "\n"} {
		if err := readImageProgress(context.Background(), strings.NewReader(content), ErrImagePull); !errors.Is(err, ErrImagePull) {
			t.Fatal("bad progress accepted", err)
		}
	}
	if err := readImageProgress(context.Background(), strings.NewReader("{\"status\":\"Downloading\"}\n{\"status\":\"Done\"}\n"), ErrImagePull); err != nil {
		t.Fatal(err)
	}
}
func dockerFrame(kind byte, payload []byte) []byte {
	header := make([]byte, 8)
	header[0] = kind
	binary.BigEndian.PutUint32(header[4:], uint32(len(payload)))
	return append(header, payload...)
}
func TestDockerMultiplexBinaryTruncationAndTailLimit(t *testing.T) {
	payload := []byte{0, 255, 1, 2, 3, 0}
	stream := append(dockerFrame(1, payload), dockerFrame(2, []byte("stderr"))...)
	var stdout, stderr bytes.Buffer
	if err := Demultiplex(context.Background(), bytes.NewReader(stream), &stdout, &stderr); err != nil || !bytes.Equal(stdout.Bytes(), payload) || stderr.String() != "stderr" {
		t.Fatal(stdout.Bytes(), stderr.String(), err)
	}
	for _, bad := range [][]byte{stream[:4], stream[:9], dockerFrame(9, nil), dockerFrame(3, []byte("daemon error secret"))} {
		if err := Demultiplex(context.Background(), bytes.NewReader(bad), io.Discard, io.Discard); !errors.Is(err, ErrStream) {
			t.Fatal(err)
		}
	}
	tail := newTail(65536)
	if err := Demultiplex(context.Background(), bytes.NewReader(dockerFrame(2, []byte(strings.Repeat("a", 65536)+"TAIL"))), io.Discard, tail); err != nil || len(tail.bytes) != 65536 || !tail.truncated || !bytes.HasSuffix(tail.bytes, []byte("TAIL")) {
		t.Fatal(len(tail.bytes), tail.truncated, err)
	}
}
