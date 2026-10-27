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

func TestNativeCredentialCutoverProcessCrash(t *testing.T) {
	gateway, image := nativeModelGateway(t)
	for _, phase := range []string{"before-remove", "after-remove", "after-create"} {
		t.Run(phase, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 6*time.Minute)
			defer cancel()
			gateway.mu.Lock()
			gateway.allowedKey = "synthetic-crash-a"
			gateway.mu.Unlock()
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
			engine, err := client.NewClientWithOpts(client.WithHost(host), client.WithAPIVersionNegotiation())
			if err != nil {
				t.Fatal(err)
			}
			defer engine.Close()
			t.Cleanup(func() {
				cleanup, done := context.WithTimeout(context.Background(), 30*time.Second)
				defer done()
				if err := scope.Cleanup(cleanup, engine); err != nil {
					t.Error(err)
				}
			})
			directory := t.TempDir()
			initial, err := corestore.Open(ctx, corestore.Options{Directory: directory, InstallationID: scope.ID()})
			if err != nil {
				t.Fatal(err)
			}
			files, err := initial.OpenPlatformFiles()
			if err != nil {
				t.Fatal(err)
			}
			baseURL := gateway.URL + "/v1"
			if _, err := NewSettings(initial, files).ConfigureRuntime(RuntimeInput{AgentImage: image, Provider: "openai", Model: "gpt-5.1", BaseURL: &baseURL, Credential: "synthetic-crash-a"}); err != nil {
				t.Fatal(err)
			}
			files.Close()
			initial.Close()
			socketDir, err := os.MkdirTemp("/tmp", "pw-credential-crash-")
			if err != nil {
				t.Fatal(err)
			}
			defer os.RemoveAll(socketDir)
			socket := filepath.Join(socketDir, "engine.sock")
			listener, err := net.Listen("unix", socket)
			if err != nil {
				t.Fatal(err)
			}
			transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, "unix", strings.TrimPrefix(host, "unix://"))
			}}
			defer transport.CloseIdleConnections()
			proxy := &httputil.ReverseProxy{Transport: transport, Rewrite: func(r *httputil.ProxyRequest) { r.Out.URL.Scheme = "http"; r.Out.URL.Host = "engine" }}
			var armed atomic.Bool
			hit := make(chan struct{}, 1)
			release := make(chan struct{})
			block := func(ctx context.Context) {
				if armed.CompareAndSwap(true, false) {
					hit <- struct{}{}
					select {
					case <-release:
					case <-ctx.Done():
					}
				}
			}
			matches := func(id string) bool {
				view, err := engine.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
				return err == nil && view.Container.Config != nil && view.Container.Config.Labels[dockerengine.InstallationLabel] == scope.ID() && view.Container.Config.Labels[dockerengine.KindLabel] == "agent"
			}
			proxy.ModifyResponse = func(res *http.Response) error {
				if !armed.Load() {
					return nil
				}
				path := res.Request.URL.Path
				if phase == "after-remove" && res.Request.Method == "DELETE" && strings.Contains(path, "/containers/") && res.StatusCode >= 200 && res.StatusCode < 300 {
					block(res.Request.Context())
				}
				if phase == "after-create" && res.Request.Method == "POST" && strings.HasSuffix(path, "/containers/create") && res.StatusCode == 201 {
					body, err := io.ReadAll(res.Body)
					if err != nil {
						return err
					}
					res.Body.Close()
					res.Body = io.NopCloser(bytes.NewReader(body))
					var created struct {
						ID string `json:"Id"`
					}
					if json.Unmarshal(body, &created) == nil && matches(created.ID) {
						block(res.Request.Context())
					}
				}
				return nil
			}
			server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				if phase == "before-remove" && armed.Load() && req.Method == "DELETE" && strings.Contains(req.URL.Path, "/containers/") {
					id := req.URL.Path[strings.LastIndex(req.URL.Path, "/")+1:]
					if matches(id) {
						block(req.Context())
						if req.Context().Err() != nil {
							return
						}
					}
				}
				proxy.ServeHTTP(w, req)
			})}
			go server.Serve(listener)
			defer server.Close()
			binary := processFixtureBinary(t, image, image, os.Getenv("PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE"), os.Getenv("PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE"))
			start := func() (*exec.Cmd, string) {
				t.Helper()
				cmd := exec.CommandContext(ctx, binary, processStartupArgs(t, directory)...)
				cmd.Env = []string{"PATH=/nonexistent", "DOCKER_HOST=unix://" + socket, "DOCKER_CONFIG=" + t.TempDir(), "PIWORK_ADMIN_ACCOUNT=admin", "PIWORK_ADMIN_PASSWORD=development-fixture-pass"}
				stdout, err := cmd.StdoutPipe()
				if err != nil {
					t.Fatal(err)
				}
				var diagnostic bytes.Buffer
				cmd.Stderr = &diagnostic
				if err := cmd.Start(); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = cmd.Process.Kill() })
				line := make(chan []byte, 1)
				go func() {
					scan := bufio.NewScanner(stdout)
					if scan.Scan() {
						line <- append([]byte(nil), scan.Bytes()...)
					} else {
						line <- nil
					}
				}()
				var announcement struct {
					Event string
					URL   string `json:"coreUrl"`
				}
				select {
				case raw := <-line:
					if json.Unmarshal(raw, &announcement) != nil || announcement.Event != "app.listening" {
						_ = cmd.Wait()
						t.Fatal("Core listener missing", diagnostic.String())
					}
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				}
				for {
					status, _ := httpCall(t, announcement.URL, "/readyz", "GET", "", nil)
					if status == 200 {
						return cmd, announcement.URL
					}
					if ctx.Err() != nil {
						t.Fatal("Core readiness timeout")
					}
					time.Sleep(100 * time.Millisecond)
				}
			}
			waitOperation := func(base, auth, id string) {
				for {
					status, op := httpCall(t, base, "/api/v1/operations/"+id, "GET", auth, nil)
					if status == 200 && op["state"] == "succeeded" {
						return
					}
					if status != 200 || op["state"] == "failed" || ctx.Err() != nil {
						t.Fatal("Work operation failed", status, op["state"])
					}
					time.Sleep(100 * time.Millisecond)
				}
			}
			first, base := start()
			login := modelNativeCall(t, base, "", "/api/v1/login", "POST", map[string]any{"account": "admin", "password": "development-fixture-pass"}, 200)
			auth := "Bearer " + login["token"].(string)
			created := modelNativeCall(t, base, auth, "/api/v1/works", "POST", map[string]any{"name": "Credential crash", "idempotencyKey": "crash-create"}, 202)
			workID := created["workId"].(string)
			path := "/api/v1/works/" + workID
			waitOperation(base, auth, created["operationId"].(string))
			session := modelNativeCall(t, base, auth, path+"/sessions", "POST", map[string]string{"idempotencyKey": "crash-session"}, 201)["sessionId"].(string)
			modelNativeRun(t, ctx, base, auth, workID, session, "before-crash")
			count := gateway.count()
			stop := modelNativeCall(t, base, auth, path+"/stop", "POST", map[string]string{"idempotencyKey": "crash-stop"}, 202)
			waitOperation(base, auth, stop["operationId"].(string))
			models := modelNativeCall(t, base, auth, "/api/v1/admin/models", "GET", nil, 200)["models"].([]any)
			modelID := models[0].(map[string]any)["id"].(string)
			modelNativeCall(t, base, auth, "/api/v1/admin/models/"+modelID, "PATCH", map[string]any{"credential": "synthetic-crash-b"}, 200)
			gateway.mu.Lock()
			gateway.allowedKey = "synthetic-crash-b"
			gateway.mu.Unlock()
			armed.Store(true)
			modelNativeCall(t, base, auth, path+"/start", "POST", map[string]string{"idempotencyKey": "crash-start"}, 202)
			select {
			case <-hit:
			case <-ctx.Done():
				t.Fatal("cutover boundary was not reached")
			}
			modelNativeCall(t, base, auth, "/api/v1/admin/models/"+modelID, "PATCH", map[string]any{"credential": "synthetic-crash-c"}, 200)
			gateway.mu.Lock()
			gateway.allowedKey = "synthetic-crash-c"
			gateway.mu.Unlock()
			if err := first.Process.Signal(syscall.SIGKILL); err != nil {
				t.Fatal(err)
			}
			_ = first.Wait()
			close(release)
			stored, err := corestore.Open(ctx, corestore.Options{Directory: directory, InstallationID: scope.ID()})
			if err != nil {
				t.Fatal(err)
			}
			var plan corestore.RuntimeReplacement
			var found bool
			err = stored.Read(ctx, func(tx *sql.Tx) error {
				var e error
				plan, found, e = corestore.ReadRuntimeReplacementTx(tx, workID)
				return e
			})
			stored.Close()
			if err != nil || !found {
				t.Fatal("durable target missing after Core crash", err)
			}
			second, next := start()
			for {
				status, work := httpCall(t, next, path, "GET", auth, nil)
				if status == 200 && work["observedState"] == "ready" {
					break
				}
				if ctx.Err() != nil {
					t.Fatal("cutover did not recover", status)
				}
				time.Sleep(100 * time.Millisecond)
			}
			items, err := engine.ContainerList(ctx, client.ContainerListOptions{All: true})
			if err != nil {
				t.Fatal(err)
			}
			countAgent := 0
			targetID := ""
			for _, item := range items.Items {
				if item.Labels[dockerengine.InstallationLabel] == scope.ID() && item.Labels[dockerengine.WorkLabel] == workID && item.Labels[dockerengine.KindLabel] == "agent" {
					countAgent++
					targetID = item.ID
					if item.Labels["piwork.instance_id"] != plan.Target.InstanceID {
						t.Fatal("target identity changed")
					}
				}
			}
			if countAgent != 1 || gateway.count() != count {
				t.Fatal("duplicate Agent or replayed model request")
			}
			view, err := engine.ContainerInspect(ctx, targetID, client.ContainerInspectOptions{})
			if err != nil {
				t.Fatal(err)
			}
			var credentialPath string
			for _, mount := range view.Container.Mounts {
				if mount.Destination == "/run/secrets/model-api-key" {
					credentialPath = mount.Source
				}
			}
			mounted, err := os.ReadFile(credentialPath)
			if err != nil || string(mounted) != "synthetic-crash-b\n" {
				t.Fatal("recovery changed the fixed launch material", err)
			}
			modelNativeRun(t, ctx, next, auth, workID, session, "after-crash")
			if gateway.last().Key != "synthetic-crash-c" {
				t.Fatal("new Run did not use current credential")
			}
			if phase == "after-create" {
				original, err := os.ReadFile(credentialPath)
				if err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(credentialPath, []byte("synthetic-crash-tampered\n"), 0644); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = os.WriteFile(credentialPath, original, 0644) })
				if err := second.Process.Signal(syscall.SIGKILL); err != nil {
					t.Fatal(err)
				}
				_ = second.Wait()
				third, latest := start()
				status, _ := httpCall(t, latest, path+"/sessions", "GET", auth, nil)
				if status == http.StatusOK {
					t.Fatal("Core adopted an Agent with tampered credential material")
				}
				if err := os.WriteFile(credentialPath, original, 0644); err != nil {
					t.Fatal(err)
				}
				if err := third.Process.Signal(syscall.SIGTERM); err != nil {
					t.Fatal(err)
				}
				if err := third.Wait(); err != nil {
					t.Fatal(err)
				}
				return
			}
			if err := second.Process.Signal(syscall.SIGTERM); err != nil {
				t.Fatal(err)
			}
			if err := second.Wait(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
