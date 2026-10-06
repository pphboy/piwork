//go:build integration

package coreapp

import (
	"bufio"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
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

type snapshotProcessGate struct {
	action  string
	hit     chan struct{}
	release chan struct{}
	claimed atomic.Bool
	once    sync.Once
}

func (g *snapshotProcessGate) unblock() { g.once.Do(func() { close(g.release) }) }

// The gate only pauses the start of a confirmed helper in this installation.
// Core and all other Engine traffic are real; production code has no test hook.
func snapshotProcessEngine(t *testing.T, installation, upstream string) (string, func(string) *snapshotProcessGate) {
	t.Helper()
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", strings.TrimPrefix(upstream, "unix://"))
	}}
	proxy := &httputil.ReverseProxy{Transport: transport, Rewrite: func(r *httputil.ProxyRequest) { r.Out.URL.Scheme = "http"; r.Out.URL.Host = "engine" }}
	client := &http.Client{Transport: transport}
	directory, err := os.MkdirTemp("/tmp", "piwork-snapshot-crash-")
	if err != nil {
		t.Fatal(err)
	}
	socket := filepath.Join(directory, "engine.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	var active atomic.Pointer[snapshotProcessGate]
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete && strings.Contains(r.URL.Path, "/images/") {
			t.Error("snapshot recovery attempted to delete a shared image")
			http.Error(w, "fixture protects shared images", http.StatusForbidden)
			return
		}
		gate := active.Load()
		if gate != nil && !gate.claimed.Load() && r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/start") && strings.Contains(r.URL.Path, "/containers/") {
			req, _ := http.NewRequestWithContext(r.Context(), "GET", "http://engine"+strings.TrimSuffix(r.URL.Path, "/start")+"/json", nil)
			response, err := client.Do(req)
			if err == nil {
				raw, _ := io.ReadAll(io.LimitReader(response.Body, 2<<20))
				response.Body.Close()
				var view struct {
					Config struct{ Labels map[string]string }
				}
				if json.Unmarshal(raw, &view) == nil && view.Config.Labels[dockerengine.InstallationLabel] == installation && view.Config.Labels["piwork.snapshot_action"] == gate.action && gate.claimed.CompareAndSwap(false, true) {
					close(gate.hit)
					select {
					case <-gate.release:
					case <-r.Context().Done():
						return
					}
					if r.Context().Err() != nil {
						return
					}
				}
			}
		}
		proxy.ServeHTTP(w, r)
	})}
	go server.Serve(listener)
	t.Cleanup(func() {
		if gate := active.Load(); gate != nil {
			gate.unblock()
		}
		server.Close()
		transport.CloseIdleConnections()
		_ = os.RemoveAll(directory)
	})
	return "unix://" + socket, func(action string) *snapshotProcessGate {
		g := &snapshotProcessGate{action: action, hit: make(chan struct{}), release: make(chan struct{})}
		active.Store(g)
		return g
	}
}

func TestNativeCoreSnapshotJobsRecoverAcrossActualProcessCrashes(t *testing.T) {
	image, fileImage, snapshotImage := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE"), os.Getenv("PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE"), os.Getenv("PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE")
	if image == "" || fileImage == "" || snapshotImage == "" {
		t.Fatal("native acceptance images required")
	}
	_, caller, _, _ := runtime.Caller(0)
	binary := filepath.Join(filepath.Dir(caller), "../../dist/go/piwork-serve")
	if _, err := os.Stat(binary); err != nil {
		t.Fatal("build current Go Core first", err)
	}
	upstream := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if upstream == "" {
		upstream = "unix:///var/run/docker.sock"
	}
	if !strings.HasPrefix(upstream, "unix://") {
		t.Fatal("Unix Engine required")
	}
	raw, err := client.NewClientWithOpts(client.WithHost(upstream), client.WithAPIVersionNegotiation())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { raw.Close() })
	scope, err := testsupport.NewScope()
	if err != nil {
		t.Fatal(err)
	}
	t.Log("snapshot crash installation:", scope.ID())
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := scope.Cleanup(ctx, raw); err != nil {
			t.Error(err)
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
	defer cancel()
	directory := t.TempDir()
	store, err := corestore.Open(ctx, corestore.Options{Directory: directory, InstallationID: scope.ID()})
	if err != nil {
		t.Fatal(err)
	}
	store.Close()
	endpoint, arm := snapshotProcessEngine(t, scope.ID(), upstream)
	start := func() (*exec.Cmd, string) {
		t.Helper()
		process := exec.CommandContext(ctx, binary, "serve", "--data-dir", directory, "--listen", "127.0.0.1:0", "--agent-grpc-listen", "0.0.0.0:0")
		process.Env = []string{"PATH=" + filepath.Join(t.TempDir(), "no-host-tools"), "DOCKER_HOST=" + endpoint, "DOCKER_CONFIG=" + t.TempDir(), "PIWORK_ADMIN_ACCOUNT=admin", "PIWORK_ADMIN_PASSWORD=development-fixture-pass", "PIWORK_AGENT_IMAGE=" + image, "PIWORK_PACKAGE_HELPER_IMAGE=" + image, "PIWORK_FILE_HELPER_IMAGE=" + fileImage, "PIWORK_SNAPSHOT_HELPER_IMAGE=" + snapshotImage, "PIWORK_MODEL_PROVIDER=piwork-deterministic", "PIWORK_MODEL=fixture-v1", "PIWORK_API_KEY=acceptance-only"}
		stdout, err := process.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		stderr, err := os.Create(filepath.Join(t.TempDir(), "core-errors.log"))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { stderr.Close() })
		process.Stderr = stderr
		if err := process.Start(); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = process.Process.Kill() })
		announced := make(chan []byte, 1)
		go func() {
			scanner := bufio.NewScanner(stdout)
			if scanner.Scan() {
				announced <- append([]byte(nil), scanner.Bytes()...)
			} else {
				announced <- nil
			}
			for scanner.Scan() {
			}
		}()
		var announcement struct{ Event, URL string }
		select {
		case line := <-announced:
			if json.Unmarshal(line, &announcement) != nil || announcement.Event != "core.listening" {
				diagnostic, _ := os.ReadFile(stderr.Name())
				t.Fatal("missing Core announcement", string(diagnostic))
			}
		case <-time.After(60 * time.Second):
			t.Fatal("Core startup exceeded budget")
		}
		for deadline := time.Now().Add(60 * time.Second); time.Now().Before(deadline); time.Sleep(100 * time.Millisecond) {
			if status, _ := packageHTTPCall(t, announcement.URL, "/readyz?profile=docker-delivery", "GET", "", nil); status == 200 {
				return process, announcement.URL
			}
		}
		diagnostic, _ := os.ReadFile(stderr.Name())
		t.Fatal("Core recovery not ready", string(diagnostic))
		return nil, ""
	}
	process, base := start()
	status, login := packageHTTPCall(t, base, "/api/v1/login", "POST", "", map[string]string{"account": "admin", "password": "development-fixture-pass"})
	if status != 200 {
		t.Fatal(status, login)
	}
	auth := "Bearer " + login["token"].(string)
	wait := func(id, want string) {
		t.Helper()
		for {
			status, op := packageHTTPCall(t, base, "/api/v1/operations/"+id, "GET", auth, nil)
			if status != 200 {
				t.Fatal(status, op)
			}
			if op["state"] == "succeeded" || op["state"] == "failed" || op["state"] == "superseded" {
				if op["state"] != want {
					t.Fatal(op)
				}
				return
			}
			select {
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			case <-time.After(50 * time.Millisecond):
			}
		}
	}
	accept := func(path, key string) map[string]any {
		t.Helper()
		status, result := packageHTTPCall(t, base, path, "POST", auth, map[string]string{"idempotencyKey": key})
		if status != 202 {
			t.Fatal(path, status, result)
		}
		return result
	}
	status, created := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]string{"name": "Snapshot crash", "idempotencyKey": "create"})
	if status != 202 {
		t.Fatal(status, created)
	}
	work := created["workId"].(string)
	path := "/api/v1/works/" + work
	wait(created["operationId"].(string), "succeeded")
	wait(accept(path+"/stop", "stop")["operationId"].(string), "succeeded")
	observer, err := sql.Open("sqlite", "file:"+filepath.Join(directory, corestore.DatabaseName)+"?mode=ro&_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	defer observer.Close()
	kill := func() {
		t.Helper()
		if err := process.Process.Signal(syscall.SIGKILL); err != nil {
			t.Fatal(err)
		}
		if err := process.Wait(); err == nil {
			t.Fatal("SIGKILL reported clean exit")
		}
	}
	restart := func() { t.Helper(); process, base = start() }
	hit := func(g *snapshotProcessGate) {
		t.Helper()
		select {
		case <-g.hit:
		case <-time.After(45 * time.Second):
			t.Fatal("snapshot helper boundary not reached", g.action)
		}
	}
	assertReleased := func(operation, target string) {
		t.Helper()
		var phase string
		var epoch int
		var holds, exposed int
		if err := observer.QueryRowContext(ctx, `SELECT phase,worker_epoch FROM snapshot_jobs WHERE operation_id=?`, operation).Scan(&phase, &epoch); err != nil {
			t.Fatal(err)
		}
		if err := observer.QueryRowContext(ctx, `SELECT (SELECT count(*) FROM work_snapshot_locks WHERE operation_id=?)+(SELECT count(*) FROM work_import_names WHERE operation_id=?)+(SELECT count(*) FROM quota_reservations WHERE work_id=? AND subject_kind='import'),(SELECT count(*) FROM works WHERE id=?)`, operation, operation, target, target).Scan(&holds, &exposed); err != nil {
			t.Fatal(err)
		}
		if phase != "cleaned" || epoch != 2 || holds != 0 || target != "" && exposed != 0 {
			t.Fatal("crash retained publication or holds", phase, epoch, holds, exposed)
		}
		items, err := raw.ContainerList(ctx, client.ContainerListOptions{All: true})
		if err != nil {
			t.Fatal(err)
		}
		for _, item := range items.Items {
			if item.Labels[dockerengine.InstallationLabel] == scope.ID() && item.Labels[dockerengine.SnapshotJobLabel] == operation {
				t.Fatal("crash helper retained", item.ID)
			}
		}
	}
	// An actual capture helper exists, but has not started. Killing Core must
	// fence its old worker and release the source lock after exact cleanup.
	gate := arm("capture")
	interruptedExport := accept(path+"/exports", "export-crash")
	hit(gate)
	kill()
	gate.unblock()
	restart()
	wait(interruptedExport["operationId"].(string), "failed")
	assertReleased(interruptedExport["operationId"].(string), "")
	replay := accept(path+"/exports", "export-crash")
	if replay["snapshotId"] != interruptedExport["snapshotId"] || replay["reused"] != true {
		t.Fatal("interrupted acceptance was duplicated", replay)
	}
	t.Log("capture crash recovered without replay")
	exported := accept(path+"/exports", "complete-export")
	wait(exported["operationId"].(string), "succeeded")
	var pack string
	if err := observer.QueryRowContext(ctx, `SELECT package_id FROM snapshot_jobs WHERE operation_id=?`, exported["operationId"]).Scan(&pack); err != nil {
		t.Fatal(err)
	}
	kill()
	restart()
	wait(exported["operationId"].(string), "succeeded")
	status, snapshot := packageHTTPCall(t, base, "/api/v1/work-snapshots/"+exported["snapshotId"].(string), "GET", auth, nil)
	if status != 200 || snapshot["state"] != "succeeded" {
		t.Fatal(status, snapshot)
	}
	req, err := http.NewRequestWithContext(ctx, "GET", base+"/api/v1/work-snapshots/"+exported["snapshotId"].(string)+"/content", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", auth)
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.New()
	size, err := io.CopyBuffer(hash, response.Body, make([]byte, 1<<20))
	response.Body.Close()
	if err != nil || response.StatusCode != 200 || hex.EncodeToString(hash.Sum(nil)) != snapshot["digest"] || float64(size) != snapshot["size"] {
		t.Fatal("published export did not survive crash", response.StatusCode, size, err)
	}
	t.Log("published snapshot survived crash:", snapshot["digest"], size)
	// Both isolated target volumes and rewritten history already exist at this
	// boundary; no Work is visible until the subsequent publication transaction.
	gate = arm("restore-context")
	status, interruptedImport := packageHTTPCall(t, base, "/api/v1/work-imports", "POST", auth, map[string]string{"packageId": pack, "idempotencyKey": "import-crash"})
	if status != 202 {
		t.Fatal(status, interruptedImport)
	}
	hit(gate)
	target := interruptedImport["workId"].(string)
	var readyVolumes int
	if err := observer.QueryRowContext(ctx, `SELECT count(*) FROM snapshot_artifacts WHERE operation_id=? AND kind='volume' AND state='ready'`, interruptedImport["operationId"]).Scan(&readyVolumes); err != nil || readyVolumes != 2 {
		t.Fatal("did not reach isolated restore boundary", readyVolumes, err)
	}
	kill()
	gate.unblock()
	restart()
	wait(interruptedImport["operationId"].(string), "failed")
	assertReleased(interruptedImport["operationId"].(string), target)
	volumes, err := raw.VolumeList(ctx, client.VolumeListOptions{})
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range volumes.Items {
		if v.Labels[dockerengine.InstallationLabel] == scope.ID() && v.Labels[dockerengine.WorkLabel] == target {
			t.Fatal("unpublished target volume retained", v.Name)
		}
	}
	t.Log("restored unpublished import cleaned after crash")
	status, imported := packageHTTPCall(t, base, "/api/v1/work-imports", "POST", auth, map[string]string{"packageId": pack, "idempotencyKey": "complete-import"})
	if status != 202 {
		t.Fatal(status, imported)
	}
	wait(imported["operationId"].(string), "succeeded")
	kill()
	restart()
	wait(imported["operationId"].(string), "succeeded")
	status, workView := packageHTTPCall(t, base, "/api/v1/works/"+imported["workId"].(string), "GET", auth, nil)
	if status != 200 || workView["desiredState"] != "stopped" || workView["observedState"] != "stopped" {
		t.Fatal("published target not retained", status, workView)
	}
	var published int
	if err := observer.QueryRowContext(ctx, `SELECT count(*) FROM work_import_provenance WHERE import_operation_id=?`, imported["operationId"]).Scan(&published); err != nil || published != 1 {
		t.Fatal("duplicate import publication", published, err)
	}
	status, reused := packageHTTPCall(t, base, "/api/v1/work-imports", "POST", auth, map[string]string{"packageId": pack, "idempotencyKey": "complete-import"})
	if status != 202 || reused["workId"] != imported["workId"] || reused["operationId"] != imported["operationId"] || reused["reused"] != true {
		t.Fatal("published import replay lost identity", status, reused)
	}
	// A live accepted helper request must be cancelled and precisely retired
	// during SIGTERM, while the original source desired state remains stopped.
	gate = arm("capture")
	shutdownExport := accept(path+"/exports", "shutdown-pending-export")
	hit(gate)
	shutdownStart := time.Now()
	if err := process.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	shutdownDone := make(chan error, 1)
	go func() { shutdownDone <- process.Wait() }()
	select {
	case err := <-shutdownDone:
		if err != nil {
			t.Fatal("pending snapshot shutdown", err)
		}
	case <-time.After(50 * time.Second):
		t.Fatal("snapshot shutdown exceeded total Core budget")
	}
	gate.unblock()
	if time.Since(shutdownStart) > 50*time.Second {
		t.Fatal("unbounded shutdown")
	}
	restart()
	wait(shutdownExport["operationId"].(string), "failed")
	var retainedWork, retainedPackage int
	if err := observer.QueryRow(`SELECT (SELECT count(*) FROM works WHERE id=?),(SELECT count(*) FROM snapshot_packages WHERE id=? AND state='ready')`, imported["workId"], pack).Scan(&retainedWork, &retainedPackage); err != nil || retainedWork != 1 || retainedPackage != 1 {
		t.Fatal("shutdown discarded published objects", retainedWork, retainedPackage, err)
	}
	if err := process.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	if err := process.Wait(); err != nil {
		t.Fatal("recovered Core shutdown", err)
	}
	t.Log("published import survived crash as one stopped Work:", imported["workId"])
}
