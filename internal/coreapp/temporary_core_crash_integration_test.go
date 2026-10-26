//go:build integration

package coreapp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/moby/moby/client"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/testsupport"
)

// A Core process crash does not end an Agent Run. Recovery must adopt the
// original listener and wait for a real terminal Run before cleaning it.
func TestNativeTemporaryListenerSurvivesCoreCrashUntilRunCancellation(t *testing.T) {
	testNativeTemporaryCoreCrash(t, false)
}

func TestNativeTemporaryCleanupSurvivesCoreCrash(t *testing.T) {
	testNativeTemporaryCoreCrash(t, true)
}

func testNativeTemporaryCoreCrash(t *testing.T, duringCleanup bool) {
	t.Helper()
	image := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE")
	if image == "" {
		t.Fatal("native Agent acceptance image is required")
	}
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	raw, err := client.NewClientWithOpts(client.WithHost(host), client.WithAPIVersionNegotiation())
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	scope, err := testsupport.NewScope()
	if err != nil {
		t.Fatal(err)
	}
	t.Log("Core crash installation:", scope.ID())
	var gate *temporaryCrashEngineGate
	if duringCleanup {
		gate = newTemporaryCrashEngineGate(t, host, scope.ID())
		host = gate.host
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := scope.Cleanup(ctx, raw); err != nil {
			t.Error(err)
		}
	})
	directory := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	initial, err := corestore.Open(ctx, corestore.Options{Directory: directory, InstallationID: scope.ID()})
	if err != nil {
		t.Fatal(err)
	}
	if err := initial.Close(); err != nil {
		t.Fatal(err)
	}
	seedProcessRuntime(t, directory, image)
	binary := processFixtureBinary(t, image, image, os.Getenv("PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE"), os.Getenv("PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE"))
	start := func() (*exec.Cmd, string) {
		cmd := exec.CommandContext(ctx, binary, processStartupArgs(t, directory)...)
		cmd.Env = []string{"PATH=" + filepath.Join(t.TempDir(), "no-host-tools"), "DOCKER_HOST=" + host, "DOCKER_CONFIG=" + t.TempDir(), "PIWORK_ADMIN_ACCOUNT=admin", "PIWORK_ADMIN_PASSWORD=development-fixture-pass"}
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		stderr, err := os.Create(filepath.Join(t.TempDir(), "core.log"))
		if err != nil {
			t.Fatal(err)
		}
		cmd.Stderr = stderr
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = cmd.Process.Kill(); _ = stderr.Close() })
		line := make(chan []byte, 1)
		go func() {
			scanner := bufio.NewScanner(stdout)
			if scanner.Scan() {
				line <- append([]byte(nil), scanner.Bytes()...)
			} else {
				line <- nil
			}
		}()
		var announcement struct {
			Event string
			URL   string `json:"coreUrl"`
		}
		select {
		case rawLine := <-line:
			if json.Unmarshal(rawLine, &announcement) != nil || announcement.Event != "app.listening" || announcement.URL == "" {
				t.Fatal("Core did not announce its listener")
			}
		case <-time.After(45 * time.Second):
			t.Fatal("Core listener did not start")
		}
		for deadline := time.Now().Add(45 * time.Second); time.Now().Before(deadline); time.Sleep(200 * time.Millisecond) {
			if status, _ := httpCall(t, announcement.URL, "/readyz", http.MethodGet, "", nil); status == 200 {
				return cmd, announcement.URL
			}
		}
		t.Fatal("Core did not become ready")
		return nil, ""
	}
	first, base := start()
	status, login := httpCall(t, base, "/api/v1/login", http.MethodPost, "", map[string]any{"account": "admin", "password": "development-fixture-pass"})
	if status != 200 {
		t.Fatal("login rejected", status)
	}
	auth := "Bearer " + login["token"].(string)
	status, accepted := httpCall(t, base, "/api/v1/works", http.MethodPost, auth, map[string]any{"name": "Temporary crash fixture", "idempotencyKey": "temporary-crash-work"})
	if status != 202 {
		t.Fatal("Work rejected", status)
	}
	workID := accepted["workId"].(string)
	deadline := time.Now().Add(90 * time.Second)
	for {
		status, op := httpCall(t, base, "/api/v1/operations/"+accepted["operationId"].(string), http.MethodGet, auth, nil)
		if status == 200 && op["state"] == "succeeded" {
			break
		}
		if time.Now().After(deadline) || op["state"] == "failed" {
			t.Fatal("Work did not start", status, op)
		}
		time.Sleep(200 * time.Millisecond)
	}
	path := "/api/v1/works/" + workID
	status, session := httpCall(t, base, path+"/sessions", http.MethodPost, auth, map[string]string{"idempotencyKey": "temporary-crash-session"})
	if status != 201 {
		t.Fatal("session rejected", status)
	}
	status, submission := httpCall(t, base, path+"/runs", http.MethodPost, auth, map[string]any{"sessionId": session["sessionId"], "submissionKey": "temporary-crash-run", "prompt": "run temporary listener and wait fixture"})
	if status != 202 {
		t.Fatal("Run rejected", status)
	}
	runID := submission["run"].(map[string]any)["runId"].(string)
	var serviceID string
	deadline = time.Now().Add(45 * time.Second)
	for {
		status, services := httpCall(t, base, path+"/services", http.MethodGet, auth, nil)
		items, _ := services["services"].([]any)
		if status == 200 && len(items) == 1 && items[0].(map[string]any)["observedState"] == "ready" {
			serviceID = items[0].(map[string]any)["serviceId"].(string)
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("listener did not become ready", status, services)
		}
		time.Sleep(200 * time.Millisecond)
	}
	containerID := func() string {
		containers, err := raw.ContainerList(ctx, client.ContainerListOptions{All: true})
		if err != nil {
			t.Fatal(err)
		}
		for _, item := range containers.Items {
			if item.Labels[dockerengine.InstallationLabel] == scope.ID() && item.Labels[dockerengine.WorkLabel] == workID && item.Labels[dockerengine.KindLabel] == "service" && item.Labels[dockerengine.LogicalLabel] == serviceID {
				return item.ID
			}
		}
		return ""
	}
	original := containerID()
	if original == "" {
		t.Fatal("temporary listener container missing")
	}
	if duringCleanup {
		gate.arm(original)
		status, _ = httpCall(t, base, path+"/runs/"+runID+"/cancel", http.MethodPost, auth, map[string]string{"idempotencyKey": "temporary-crash-cancel"})
		if status != 200 {
			t.Fatal("Run cancel rejected", status)
		}
		select {
		case <-gate.hit:
		case <-time.After(45 * time.Second):
			t.Fatal("cleanup did not reach Docker stop")
		}
		status, history := httpCall(t, base, path+"/temporary-cleanups?runId="+runID, http.MethodGet, auth, nil)
		items, _ := history["items"].([]any)
		if status != 200 || len(items) != 1 {
			t.Fatal("cleanup record missing before crash", status, history)
		}
		pending := items[0].(map[string]any)
		if pending["state"] != "running" || pending["stage"] != "stop" || pending["operationId"] == "" || pending["trigger"] != "run-cancelled" {
			t.Fatal("cleanup was not durably in progress", pending)
		}
		if containerID() != original {
			t.Fatal("listener changed before crash")
		}
	}
	if err := first.Process.Signal(syscall.SIGKILL); err != nil {
		t.Fatal(err)
	}
	_ = first.Wait()
	if duringCleanup {
		gate.unblock()
	}
	second, base := start()
	if duringCleanup {
		deadline = time.Now().Add(60 * time.Second)
		for {
			status, history := httpCall(t, base, path+"/temporary-cleanups?runId="+runID, http.MethodGet, auth, nil)
			items, _ := history["items"].([]any)
			if status == 200 && len(items) == 1 && items[0].(map[string]any)["state"] == "completed" {
				if items[0].(map[string]any)["trigger"] != "run-cancelled" {
					t.Fatal("recovery changed cleanup trigger", items)
				}
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("in-flight cleanup did not recover", status, history)
			}
			time.Sleep(200 * time.Millisecond)
		}
		if containerID() != "" || gate.creates.Load() != 1 {
			t.Fatal("recovery leaked or recreated listener", gate.creates.Load())
		}
		status, run := httpCall(t, base, path+"/runs/"+runID, http.MethodGet, auth, nil)
		if status != 200 || run["state"] != float64(6) {
			t.Fatal("cancelled Run changed during recovery", status, run)
		}
		if err := second.Process.Signal(syscall.SIGTERM); err != nil {
			t.Fatal(err)
		}
		if err := second.Wait(); err != nil {
			t.Fatal("recovered Core did not stop cleanly", err)
		}
		return
	}
	deadline = time.Now().Add(30 * time.Second)
	for {
		status, run := httpCall(t, base, path+"/runs/"+runID, http.MethodGet, auth, nil)
		if status == 200 && run["state"] == float64(2) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("active Run was not adopted", status, run)
		}
		time.Sleep(200 * time.Millisecond)
	}
	if containerID() != original {
		t.Fatal("Core recovery removed or replayed the active listener")
	}
	status, history := httpCall(t, base, path+"/temporary-cleanups?runId="+runID, http.MethodGet, auth, nil)
	if status != 200 || len(history["items"].([]any)) != 0 {
		t.Fatal("active Run received premature cleanup", status, history)
	}
	status, _ = httpCall(t, base, path+"/runs/"+runID+"/cancel", http.MethodPost, auth, map[string]string{"idempotencyKey": "temporary-crash-cancel"})
	if status != 200 {
		t.Fatal("Run cancel rejected", status)
	}
	deadline = time.Now().Add(45 * time.Second)
	for {
		status, history = httpCall(t, base, path+"/temporary-cleanups?runId="+runID, http.MethodGet, auth, nil)
		items, _ := history["items"].([]any)
		if status == 200 && len(items) == 1 && items[0].(map[string]any)["state"] == "completed" {
			if items[0].(map[string]any)["trigger"] != "run-cancelled" {
				t.Fatal("cleanup lost its real trigger", items)
			}
			break
		}
		if time.Now().After(deadline) {
			raw, _ := json.Marshal(history)
			t.Fatal("cancelled Run was not cleaned after Core recovery", status, string(bytes.TrimSpace(raw)))
		}
		time.Sleep(200 * time.Millisecond)
	}
	if containerID() != "" {
		t.Fatal("temporary listener remained after cancellation")
	}
	if err := second.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	if err := second.Wait(); err != nil {
		t.Fatal("recovered Core did not stop cleanly", err)
	}
}

// Gate the exact listener's Docker stop while leaving all other Engine calls
// untouched, so SIGKILL occurs after a real persisted cleanup request.
type temporaryCrashEngineGate struct {
	host    string
	hit     chan struct{}
	release chan struct{}
	once    sync.Once
	mu      sync.RWMutex
	target  string
	creates atomic.Int32
}

func (g *temporaryCrashEngineGate) arm(id string) { g.mu.Lock(); g.target = id; g.mu.Unlock() }
func (g *temporaryCrashEngineGate) unblock()      { g.once.Do(func() { close(g.release) }) }
func newTemporaryCrashEngineGate(t *testing.T, upstream, installation string) *temporaryCrashEngineGate {
	t.Helper()
	if !strings.HasPrefix(upstream, "unix://") {
		t.Fatal("Unix Engine required")
	}
	dir, err := os.MkdirTemp("/tmp", "piwork-crash-engine-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	listener, err := net.Listen("unix", filepath.Join(dir, "engine.sock"))
	if err != nil {
		t.Fatal(err)
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", strings.TrimPrefix(upstream, "unix://"))
	}}
	proxy := &httputil.ReverseProxy{Transport: transport, Rewrite: func(r *httputil.ProxyRequest) { r.Out.URL.Scheme = "http"; r.Out.URL.Host = "engine" }}
	g := &temporaryCrashEngineGate{host: "unix://" + filepath.Join(dir, "engine.sock"), hit: make(chan struct{}), release: make(chan struct{})}
	var hit sync.Once
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/containers/create") {
			body, err := io.ReadAll(r.Body)
			if err != nil {
				w.WriteHeader(500)
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(body))
			var input struct{ Labels map[string]string }
			_ = json.Unmarshal(body, &input)
			if input.Labels[dockerengine.InstallationLabel] == installation && input.Labels[dockerengine.KindLabel] == "service" {
				g.creates.Add(1)
			}
		}
		g.mu.RLock()
		target := g.target
		g.mu.RUnlock()
		if target != "" && r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/containers/"+target+"/stop") {
			hit.Do(func() { close(g.hit) })
			select {
			case <-g.release:
			case <-r.Context().Done():
				return
			}
		}
		proxy.ServeHTTP(w, r)
	})}
	go server.Serve(listener)
	t.Cleanup(func() { g.unblock(); _ = server.Close(); transport.CloseIdleConnections() })
	return g
}
