package dockerengine

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/moby/moby/client"
	"piwork/internal/corestore"
	"piwork/internal/safefs"
)

func inspectionFixture(t *testing.T, labels map[string]string, save http.HandlerFunc) (*ImageInspector, *atomic.Int64, *safefs.Root) {
	t.Helper()
	socket := shortEngineSocket(t, "engine.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	calls := &atomic.Int64{}
	id := "sha256:" + strings.Repeat("a", 64)
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/v1.45")
		if r.Method != "GET" {
			t.Error("image inspection attempted a mutation", r.Method, p)
			http.Error(w, "forbidden", 403)
			return
		}
		switch p {
		case "/images/" + id + "/json":
			json.NewEncoder(w).Encode(map[string]any{"Id": id, "Os": "linux", "Architecture": "amd64", "Config": map[string]any{"Labels": labels}})
		case "/images/get":
			calls.Add(1)
			if r.URL.Query().Get("names") != id {
				t.Error("save did not pin image ID")
			}
			save(w, r)
		default:
			t.Error("image inspection attempted unexpected API", p)
			http.NotFound(w, r)
		}
	})}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close(); listener.Close() })
	api, err := client.NewClientWithOpts(client.WithHost("unix://"+socket), client.WithVersion("1.45"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { api.Close() })
	directory := t.TempDir()
	os.Chmod(directory, 0700)
	root, err := safefs.OpenRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })
	if root.Lock() != nil {
		t.Fatal("root lock")
	}
	store, err := corestore.Open(context.Background(), corestore.Options{Directory: t.TempDir(), InstallationID: "installation-inspection-test"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	i, err := NewImageInspector(context.Background(), &Engine{api: api}, root, store)
	if err != nil {
		t.Fatal(err)
	}
	return i, calls, root
}
func nativeLabels() map[string]string {
	return map[string]string{"io.piwork.agent.protocol": "v2", "io.piwork.package-helper.contract": "2", "io.piwork.service-mcp.contract": "1"}
}
func TestImageInspectionNoContainerOrCommandExecution(t *testing.T) {
	t.Setenv("PATH", "/no-host-tools")
	id := "sha256:" + strings.Repeat("a", 64)
	i, calls, root := inspectionFixture(t, nativeLabels(), func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, "private raw archive error source /secret")
	})
	_, err := i.InspectNativeAgent(context.Background(), id)
	if !errors.Is(err, ErrImageIncompatible) || strings.Contains(err.Error(), "secret") || calls.Load() != 1 {
		t.Fatal(err, calls.Load())
	}
	names, err := root.Entries()
	if err != nil || len(names) != 0 {
		t.Fatal(names, err)
	}
	old, oldCalls, _ := inspectionFixture(t, map[string]string{"io.piwork.agent.protocol": "v2", "io.piwork.package-helper.contract": "1"}, func(w http.ResponseWriter, r *http.Request) { t.Error("old labels should fail before save") })
	if _, err := old.InspectNativeAgent(context.Background(), id); !errors.Is(err, ErrImageIncompatible) || oldCalls.Load() != 0 {
		t.Fatal(err)
	}
	oldProtocol, protocolCalls, _ := inspectionFixture(t, map[string]string{"io.piwork.agent.protocol": "v1", "io.piwork.package-helper.contract": "2", "io.piwork.service-mcp.contract": "1"}, func(w http.ResponseWriter, r *http.Request) { t.Error("old Agent protocol should fail before save") })
	if _, err := oldProtocol.InspectNativeAgent(context.Background(), id); !errors.Is(err, ErrImageIncompatible) || protocolCalls.Load() != 0 {
		t.Fatal("old Agent protocol was accepted", err)
	}
	if _, err := i.InspectNativeAgent(context.Background(), "example:latest"); !errors.Is(err, ErrSpecification) {
		t.Fatal(err)
	}
}
func TestImageInspectionCancelReleasesScratchAndCancellableGate(t *testing.T) {
	started := make(chan struct{})
	closed := make(chan struct{})
	i, _, root := inspectionFixture(t, nativeLabels(), func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
		close(closed)
	})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	id := "sha256:" + strings.Repeat("a", 64)
	go func() { _, err := i.InspectNativeAgent(ctx, id); done <- err }()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("save did not start")
	}
	queued, stop := context.WithCancel(context.Background())
	stop()
	if _, err := i.InspectNativeAgent(queued, id); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("cancel accepted incomplete archive")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("inspection remained blocked")
	}
	select {
	case <-closed:
	case <-time.After(3 * time.Second):
		t.Fatal("Engine stream was not cancelled")
	}
	names, err := root.Entries()
	if err != nil || len(names) != 0 {
		t.Fatal(names, err)
	}
}
