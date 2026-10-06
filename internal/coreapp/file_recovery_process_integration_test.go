//go:build integration

package coreapp

import (
	"bufio"
	"bytes"
	"context"
	"database/sql"
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

func TestNativeCoreFileJobsSurviveCrashBeforeAndAfterCommit(t *testing.T) {
	for _, phase := range []string{"before-commit", "after-commit"} {
		t.Run(phase, func(t *testing.T) {
			image, fileImage := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE"), os.Getenv("PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE")
			if image == "" || fileImage == "" {
				t.Fatal("native acceptance images required")
			}
			_, source, _, _ := runtime.Caller(0)
			binary := filepath.Join(filepath.Dir(source), "..", "..", "dist", "go", "piwork-serve")
			if _, err := os.Stat(binary); err != nil {
				t.Fatal("build native Core first", err)
			}
			upstream := os.Getenv("PIWORK_TEST_DOCKER_HOST")
			if upstream == "" {
				upstream = "unix:///var/run/docker.sock"
			}
			if !strings.HasPrefix(upstream, "unix://") {
				t.Fatal("Unix Engine fixture required")
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
			t.Log("file crash installation:", scope.ID())
			t.Cleanup(func() {
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				defer cancel()
				if err := scope.Cleanup(ctx, raw); err != nil {
					t.Error(err)
				}
			})
			ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
			defer cancel()
			directory := t.TempDir()
			store, err := corestore.Open(ctx, corestore.Options{Directory: directory, InstallationID: scope.ID()})
			if err != nil {
				t.Fatal(err)
			}
			store.Close()
			transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, "unix", strings.TrimPrefix(upstream, "unix://"))
			}}
			proxy := &httputil.ReverseProxy{Transport: transport, Rewrite: func(r *httputil.ProxyRequest) { r.Out.URL.Scheme = "http"; r.Out.URL.Host = "engine" }}
			socketDirectory, err := os.MkdirTemp("/tmp", "piwork-file-recovery-")
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { os.RemoveAll(socketDirectory) })
			socket := filepath.Join(socketDirectory, "engine.sock")
			listener, err := net.Listen("unix", socket)
			if err != nil {
				t.Fatal(err)
			}
			var block atomic.Bool
			var hitOnce, releaseOnce sync.Once
			hit, release := make(chan struct{}), make(chan struct{})
			server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if block.Load() && r.Method == "DELETE" && strings.Contains(r.URL.Path, "/containers/") {
					id := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
					inspect, err := raw.ContainerInspect(r.Context(), id, client.ContainerInspectOptions{})
					if err == nil && inspect.Container.Config != nil && inspect.Container.Config.Labels[dockerengine.InstallationLabel] == scope.ID() && inspect.Container.Config.Labels[dockerengine.KindLabel] == "file-helper" {
						hitOnce.Do(func() { close(hit) })
						<-release
						w.WriteHeader(503)
						return
					}
				}
				proxy.ServeHTTP(w, r)
			})}
			go server.Serve(listener)
			t.Cleanup(func() { releaseOnce.Do(func() { close(release) }); server.Close(); transport.CloseIdleConnections() })
			start := func() (*exec.Cmd, string) {
				t.Helper()
				process := exec.CommandContext(ctx, binary, "serve", "--data-dir", directory, "--listen", "127.0.0.1:0", "--agent-grpc-listen", "0.0.0.0:0")
				process.Env = []string{"PATH=" + filepath.Join(t.TempDir(), "no-host-tools"), "DOCKER_HOST=unix://" + socket, "DOCKER_CONFIG=" + t.TempDir(), "PIWORK_ADMIN_ACCOUNT=admin", "PIWORK_ADMIN_PASSWORD=development-fixture-pass", "PIWORK_AGENT_IMAGE=" + image, "PIWORK_PACKAGE_HELPER_IMAGE=" + image, "PIWORK_FILE_HELPER_IMAGE=" + fileImage, "PIWORK_MODEL_PROVIDER=piwork-deterministic", "PIWORK_MODEL=fixture-v1", "PIWORK_API_KEY=acceptance-only"}
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
				t.Cleanup(func() { process.Process.Kill() })
				announced := make(chan []byte, 1)
				go func() {
					scanner := bufio.NewScanner(stdout)
					if scanner.Scan() {
						announced <- append([]byte(nil), scanner.Bytes()...)
					} else {
						announced <- nil
					}
				}()
				var announcement struct{ Event, URL string }
				select {
				case line := <-announced:
					if json.Unmarshal(line, &announcement) != nil || announcement.Event != "core.listening" {
						t.Fatal("Core announcement missing")
					}
				case <-time.After(60 * time.Second):
					t.Fatal("Core startup exceeded budget")
				}
				for deadline := time.Now().Add(60 * time.Second); time.Now().Before(deadline); time.Sleep(100 * time.Millisecond) {
					if status, _ := packageHTTPCall(t, announcement.URL, "/readyz", "GET", "", nil); status == 200 {
						_, control := packageHTTPCall(t, announcement.URL, "/control/status", "GET", "", nil)
						components := control["preparation"].(map[string]any)["components"].(map[string]any)
						if components["fileHelper"].(map[string]any)["state"] == "ready" && components["defaultContext"].(map[string]any)["state"] == "ready" {
							return process, announcement.URL
						}
					}
				}
				diagnostic, _ := os.ReadFile(stderr.Name())
				t.Fatal("Core recovery not ready", string(diagnostic))
				return nil, ""
			}
			process, base := start()
			t.Log("initial Core ready")
			status, login := packageHTTPCall(t, base, "/api/v1/login", "POST", "", map[string]string{"account": "admin", "password": "development-fixture-pass"})
			if status != 200 {
				t.Fatal(status, login)
			}
			auth := "Bearer " + login["token"].(string)
			status, created := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]string{"name": "File crash", "idempotencyKey": "create"})
			if status != 202 {
				t.Fatal(status, created)
			}
			workID := created["workId"].(string)
			for {
				status, op := packageHTTPCall(t, base, "/api/v1/operations/"+created["operationId"].(string), "GET", auth, nil)
				if status != 200 {
					t.Fatal(status, op)
				}
				if op["state"] == "succeeded" {
					break
				}
				if op["state"] == "failed" || ctx.Err() != nil {
					t.Fatal(op, ctx.Err())
				}
				time.Sleep(50 * time.Millisecond)
			}
			path := "/api/v1/works/" + workID + "/files/value"
			call := func(method string, body io.Reader) (int, []byte, error) {
				r, err := http.NewRequestWithContext(ctx, method, base+path, body)
				if err != nil {
					return 0, nil, err
				}
				r.Header.Set("Authorization", auth)
				response, err := http.DefaultClient.Do(r)
				if err != nil {
					return 0, nil, err
				}
				defer response.Body.Close()
				data, err := io.ReadAll(response.Body)
				return response.StatusCode, data, err
			}
			if status, data, err := call("PUT", strings.NewReader("original")); err != nil || status != 201 {
				t.Fatal(status, string(data), err)
			}
			observer, err := sql.Open("sqlite", "file:"+filepath.Join(directory, corestore.DatabaseName)+"?mode=ro&_pragma=busy_timeout(5000)")
			if err != nil {
				t.Fatal(err)
			}
			defer observer.Close()
			var writer *io.PipeWriter
			done := make(chan error, 1)
			if phase == "before-commit" {
				var reader *io.PipeReader
				reader, writer = io.Pipe()
				go func() { _, _, err := call("PUT", reader); done <- err }()
				go func() { _, _ = writer.Write(bytes.Repeat([]byte("partial"), 10000)) }()
				for deadline := time.Now().Add(15 * time.Second); ; time.Sleep(20 * time.Millisecond) {
					var count int
					err := observer.QueryRowContext(ctx, `SELECT count(*) FROM work_file_temporaries t JOIN work_file_jobs j ON j.id=t.job_id WHERE j.work_id=? AND j.state!='cleaned' AND t.state='created'`, workID).Scan(&count)
					if err != nil {
						t.Fatal(err)
					}
					if count > 0 {
						break
					}
					if time.Now().After(deadline) {
						t.Fatal("upload temp identity not durable")
					}
				}
			} else {
				block.Store(true)
				go func() { _, _, err := call("PUT", strings.NewReader("committed")); done <- err }()
				select {
				case <-hit:
				case <-time.After(15 * time.Second):
					t.Fatal("commit exit/removal boundary not reached")
				}
				var count int
				if err := observer.QueryRowContext(ctx, `SELECT count(*) FROM work_file_jobs WHERE work_id=? AND state='committing'`, workID).Scan(&count); err != nil || count != 1 {
					t.Fatal("commit permission not durable", count, err)
				}
			}
			if err := process.Process.Signal(syscall.SIGKILL); err != nil {
				t.Fatal(err)
			}
			if err := process.Wait(); err == nil {
				t.Fatal("SIGKILL reported clean exit")
			}
			if writer != nil {
				writer.Close()
			}
			block.Store(false)
			releaseOnce.Do(func() { close(release) })
			select {
			case <-done:
			case <-time.After(10 * time.Second):
				t.Fatal("lost request did not close")
			}
			t.Log("Core killed at", phase, "; starting recovery")
			next, nextBase := start()
			base = nextBase
			want := "original"
			if phase == "after-commit" {
				want = "committed"
			}
			if status, data, err := call("GET", nil); err != nil || status != 200 || string(data) != want {
				t.Fatal("crash recovery changed committed outcome", status, string(data), want, err)
			}
			for deadline := time.Now().Add(10 * time.Second); ; time.Sleep(20 * time.Millisecond) {
				var pending int
				if err := observer.QueryRowContext(ctx, `SELECT count(*) FROM work_file_jobs WHERE work_id=? AND state!='cleaned'`, workID).Scan(&pending); err != nil {
					t.Fatal(err)
				}
				if pending == 0 {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("crash journals retained", pending)
				}
			}
			if err := next.Process.Signal(syscall.SIGTERM); err != nil {
				t.Fatal(err)
			}
			if err := next.Wait(); err != nil {
				t.Fatal("recovered Core shutdown failed", err)
			}
			items, err := raw.ContainerList(ctx, client.ContainerListOptions{All: true})
			if err != nil {
				t.Fatal(err)
			}
			for _, item := range items.Items {
				if item.Labels[dockerengine.InstallationLabel] == scope.ID() && item.Labels[dockerengine.KindLabel] == "file-helper" {
					t.Fatal("file helper leaked", item.ID)
				}
			}
		})
	}
}
