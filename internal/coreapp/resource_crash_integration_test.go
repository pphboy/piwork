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
	"runtime"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/moby/moby/client"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/testsupport"
)

func TestNativeCoreRecoversInterruptedCreateServiceAndDelete(t *testing.T) {
	for _, phase := range []string{"agent-create", "service-create", "delete"} {
		t.Run(phase, func(t *testing.T) {
			image := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE")
			if image == "" {
				t.Fatal("native Agent image required")
			}
			host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
			if host == "" {
				host = "unix:///var/run/docker.sock"
			}
			if !strings.HasPrefix(host, "unix://") {
				t.Fatal("Unix Engine required")
			}
			scope, err := testsupport.NewScope()
			if err != nil {
				t.Fatal(err)
			}
			raw, err := client.NewClientWithOpts(client.WithHost(host), client.WithAPIVersionNegotiation())
			if err != nil {
				t.Fatal(err)
			}
			defer raw.Close()
			t.Cleanup(func() {
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				defer cancel()
				if err := scope.Cleanup(ctx, raw); err != nil {
					t.Error(err)
				}
			})
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()
			dir := t.TempDir()
			store, err := corestore.Open(ctx, corestore.Options{Directory: dir, InstallationID: scope.ID()})
			if err != nil {
				t.Fatal(err)
			}
			store.Close()
			sockets, err := os.MkdirTemp("/tmp", "pw-crash-")
			if err != nil {
				t.Fatal(err)
			}
			defer os.RemoveAll(sockets)
			listener, err := net.Listen("unix", filepath.Join(sockets, "engine.sock"))
			if err != nil {
				t.Fatal(err)
			}
			transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, "unix", strings.TrimPrefix(host, "unix://"))
			}}
			proxy := &httputil.ReverseProxy{Transport: transport, Rewrite: func(r *httputil.ProxyRequest) { r.Out.URL.Scheme = "http"; r.Out.URL.Host = "engine" }}
			var armed atomic.Bool
			hit, release := make(chan string, 1), make(chan struct{})
			proxy.ModifyResponse = func(res *http.Response) error {
				if !armed.Load() || phase == "delete" || res.Request.Method != "POST" || !strings.HasSuffix(res.Request.URL.Path, "/containers/create") || res.StatusCode != 201 {
					return nil
				}
				body, err := io.ReadAll(res.Body)
				if err != nil {
					return err
				}
				res.Body.Close()
				res.Body = io.NopCloser(bytes.NewReader(body))
				var created struct {
					ID string `json:"Id"`
				}
				if json.Unmarshal(body, &created) != nil {
					return nil
				}
				view, err := raw.ContainerInspect(ctx, created.ID, client.ContainerInspectOptions{})
				if err != nil {
					return err
				}
				kind := "agent"
				if phase == "service-create" {
					kind = "service"
				}
				if view.Container.Config.Labels[dockerengine.InstallationLabel] == scope.ID() && view.Container.Config.Labels[dockerengine.KindLabel] == kind && armed.CompareAndSwap(true, false) {
					hit <- created.ID
					select {
					case <-release:
					case <-res.Request.Context().Done():
					}
				}
				return nil
			}
			server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if armed.Load() && phase == "delete" && r.Method == "DELETE" && strings.Contains(r.URL.Path, "/containers/") {
					id := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
					view, err := raw.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
					if err == nil && view.Container.Config.Labels[dockerengine.InstallationLabel] == scope.ID() && armed.CompareAndSwap(true, false) {
						hit <- id
						select {
						case <-release:
						case <-r.Context().Done():
							return
						}
					}
				}
				proxy.ServeHTTP(w, r)
			})}
			go server.Serve(listener)
			defer server.Close()
			defer transport.CloseIdleConnections()
			_, caller, _, _ := runtime.Caller(0)
			binary := filepath.Join(filepath.Dir(caller), "../../dist/go/piwork-serve")
			start := func() (*exec.Cmd, string) {
				t.Helper()
				cmd := exec.CommandContext(ctx, binary, "serve", "--data-dir", dir, "--listen", "127.0.0.1:0", "--agent-grpc-listen", "0.0.0.0:0")
				cmd.Env = []string{"PATH=/nonexistent", "DOCKER_HOST=unix://" + filepath.Join(sockets, "engine.sock"), "DOCKER_CONFIG=" + t.TempDir(), "PIWORK_ADMIN_ACCOUNT=admin", "PIWORK_ADMIN_PASSWORD=development-fixture-pass", "PIWORK_AGENT_IMAGE=" + image, "PIWORK_PACKAGE_HELPER_IMAGE=" + image, "PIWORK_MODEL_PROVIDER=piwork-deterministic", "PIWORK_MODEL=fixture-v1", "PIWORK_API_KEY=acceptance-only"}
				output, err := cmd.StdoutPipe()
				if err != nil {
					t.Fatal(err)
				}
				diagnostic, err := os.Create(filepath.Join(t.TempDir(), "core.log"))
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { diagnostic.Close() })
				cmd.Stderr = diagnostic
				if err := cmd.Start(); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = cmd.Process.Kill() })
				line := make(chan string, 1)
				go func() {
					scanner := bufio.NewScanner(output)
					if scanner.Scan() {
						line <- scanner.Text()
					} else {
						line <- ""
					}
				}()
				var announcement struct{ URL string }
				select {
				case first := <-line:
					if json.Unmarshal([]byte(first), &announcement) != nil || announcement.URL == "" {
						t.Fatal("Core listener failed")
					}
				case <-time.After(time.Minute):
					t.Fatal("Core listener deadline")
				}
				for deadline := time.Now().Add(time.Minute); ; time.Sleep(100 * time.Millisecond) {
					status, _ := packageHTTPCall(t, announcement.URL, "/readyz", "GET", "", nil)
					if status == 200 {
						break
					}
					if time.Now().After(deadline) {
						t.Fatal("Core startup recovery deadline")
					}
				}
				return cmd, announcement.URL
			}
			first, base := start()
			status, login := packageHTTPCall(t, base, "/api/v1/login", "POST", "", map[string]string{"account": "admin", "password": "development-fixture-pass"})
			if status != 200 {
				t.Fatal(status)
			}
			auth := "Bearer " + login["token"].(string)
			wait := func(base, id string) {
				t.Helper()
				for deadline := time.Now().Add(time.Minute); ; time.Sleep(100 * time.Millisecond) {
					status, op := packageHTTPCall(t, base, "/api/v1/operations/"+id, "GET", auth, nil)
					if status != 200 {
						t.Fatal(status, op)
					}
					if op["state"] == "succeeded" {
						return
					}
					if op["state"] == "failed" || op["state"] == "superseded" || time.Now().After(deadline) {
						t.Fatal("recovered Operation did not succeed", op)
					}
				}
			}
			if phase == "agent-create" {
				armed.Store(true)
			}
			status, created := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]string{"name": "Crash boundary", "idempotencyKey": "create-once"})
			if status != 202 {
				t.Fatal(status, created)
			}
			work := created["workId"].(string)
			operation := created["operationId"].(string)
			var service string
			if phase != "agent-create" {
				wait(base, operation)
				armed.Store(true)
				if phase == "service-create" {
					definition := map[string]any{"name": "durable", "image": map[string]string{"reference": image}, "command": "node", "args": []string{"-e", "require('http').createServer((q,r)=>r.end('ok')).listen(8099,'0.0.0.0')"}, "workingDirectory": "/", "ports": []any{map[string]any{"name": "http", "protocol": "tcp", "containerPort": 8099}}, "readiness": map[string]any{"kind": "http", "portName": "http", "path": "/", "deadlineMs": 10000}}
					status, result := packageHTTPCall(t, base, "/api/v1/works/"+work+"/services", "POST", auth, map[string]any{"definition": definition, "idempotencyKey": "service-once"})
					if status != 202 {
						t.Fatal(status, result)
					}
					operation = result["operationId"].(string)
					service = result["serviceId"].(string)
				} else {
					status, result := packageHTTPCall(t, base, "/api/v1/works/"+work+"/delete", "POST", auth, map[string]string{"idempotencyKey": "delete-once"})
					if status != 202 {
						t.Fatal(status, result)
					}
					operation = result["operationId"].(string)
				}
			}
			var original string
			select {
			case original = <-hit:
			case <-time.After(time.Minute):
				t.Fatal("Engine crash boundary not reached")
			}
			if err := first.Process.Signal(syscall.SIGKILL); err != nil {
				t.Fatal(err)
			}
			_ = first.Wait()
			close(release)
			second, secondBase := start()
			wait(secondBase, operation)
			containers, err := raw.ContainerList(ctx, client.ContainerListOptions{All: true})
			if err != nil {
				t.Fatal(err)
			}
			count := 0
			kind := "agent"
			if phase == "service-create" {
				kind = "service"
			}
			for _, v := range containers.Items {
				if v.Labels[dockerengine.InstallationLabel] == scope.ID() && v.Labels[dockerengine.WorkLabel] == work && (phase == "delete" || v.Labels[dockerengine.KindLabel] == kind) {
					count++
					if phase != "delete" && v.ID != original {
						t.Fatal("crash recovery replaced original resource")
					}
				}
			}
			if phase == "delete" {
				if count != 0 {
					t.Fatal("delete recovery left runtime", count)
				}
				status, _ := packageHTTPCall(t, secondBase, "/api/v1/works/"+work, "GET", auth, nil)
				if status != 404 {
					t.Fatal("deleted Work visible", status)
				}
			} else {
				if count != 1 {
					t.Fatal("recovery lost/duplicated resource", count)
				}
				endpoint := "/api/v1/works/" + work + "/sessions"
				if service != "" {
					endpoint = "/api/v1/works/" + work + "/services/" + service
				}
				status, _ := packageHTTPCall(t, secondBase, endpoint, "GET", auth, nil)
				if status != 200 {
					t.Fatal("recovered access unavailable", status)
				}
			}
			if phase == "service-create" {
				var agentID string
				for _, v := range containers.Items {
					if v.Labels[dockerengine.InstallationLabel] == scope.ID() && v.Labels[dockerengine.WorkLabel] == work && v.Labels[dockerengine.KindLabel] == "agent" {
						agentID = v.ID
					}
				}
				if agentID == "" {
					t.Fatal("ready daemon absent")
				}
				_ = second.Process.Signal(syscall.SIGKILL)
				_ = second.Wait()
				if _, err := raw.ContainerRemove(ctx, original, client.ContainerRemoveOptions{Force: true}); err != nil {
					t.Fatal(err)
				}
				third, thirdBase := start()
				status, _ := packageHTTPCall(t, thirdBase, "/api/v1/works/"+work+"/services/"+service, "GET", auth, nil)
				if status != 200 {
					t.Fatal("missing service not recovered", status)
				}
				views, err := raw.ContainerList(ctx, client.ContainerListOptions{All: true})
				if err != nil {
					t.Fatal(err)
				}
				var adopted, restored bool
				for _, v := range views.Items {
					if v.Labels[dockerengine.InstallationLabel] != scope.ID() || v.Labels[dockerengine.WorkLabel] != work {
						continue
					}
					if v.Labels[dockerengine.KindLabel] == "agent" {
						if v.ID != agentID {
							t.Fatal("existing daemon replaced")
						}
						adopted = true
					}
					if v.Labels[dockerengine.KindLabel] == "service" {
						if v.ID == original || v.State != "running" {
							t.Fatal("missing service not recreated")
						}
						restored = true
					}
				}
				if !adopted || !restored {
					t.Fatal("partial Work recovery", adopted, restored)
				}
				second = third
			}
			second.Process.Signal(syscall.SIGTERM)
			if err := second.Wait(); err != nil {
				t.Fatal("recovered Core shutdown", err)
			}
			t.Log("actual SIGKILL after Engine resource effect, original Operation and resource identity recovered:", phase)
		})
	}
}
