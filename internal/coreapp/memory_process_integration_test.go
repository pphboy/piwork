//go:build integration

package coreapp

import (
	"bufio"
	"context"
	"encoding/json"
	"github.com/moby/moby/client"
	"os"
	"os/exec"
	"path/filepath"
	"piwork/internal/corestore"
	"piwork/internal/testsupport"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
)

// Pause a real Engine removal after the migration writer has exited and before
// active publication. No production hooks, fake stores or schema edits are used.
func TestNativeMemoryMigrationProcessRecoveryAndStopSupersession(t *testing.T) {
	for _, mode := range []string{"crash", "stop", "delete", "apply"} {
		t.Run(mode, func(t *testing.T) {
			next := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE")
			if next == "" {
				t.Skip("native images required")
			}
			upstream := os.Getenv("PIWORK_TEST_DOCKER_HOST")
			if upstream == "" {
				upstream = "unix:///var/run/docker.sock"
			}
			raw, err := client.NewClientWithOpts(client.WithHost(upstream), client.WithAPIVersionNegotiation())
			if err != nil {
				t.Fatal(err)
			}
			defer raw.Close()
			scope, err := testsupport.NewScope()
			if err != nil {
				t.Fatal(err)
			}
			t.Log("migration recovery installation", scope.ID())
			t.Cleanup(func() {
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				defer cancel()
				if err := scope.Cleanup(ctx, raw); err != nil {
					t.Error(err)
				}
			})
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
			defer cancel()
			directory := t.TempDir()
			store, err := corestore.Open(ctx, corestore.Options{Directory: directory, InstallationID: scope.ID()})
			if err != nil {
				t.Fatal(err)
			}
			store.Close()
			endpoint, arm := snapshotProcessEngine(t, scope.ID(), upstream)
			_, source, _, _ := runtime.Caller(0)
			binary := filepath.Join(filepath.Dir(source), "../../dist/go/piwork-serve")
			image := "piwork-memory-history4:acceptance"
			start := func() (*exec.Cmd, string) {
				p := exec.CommandContext(ctx, binary, "serve", "--data-dir", directory, "--listen", "127.0.0.1:0", "--agent-grpc-listen", "0.0.0.0:0")
				p.Env = []string{"PATH=" + filepath.Join(t.TempDir(), "no-host-tools"), "DOCKER_HOST=" + endpoint, "DOCKER_CONFIG=" + t.TempDir(), "PIWORK_ADMIN_ACCOUNT=admin", "PIWORK_ADMIN_PASSWORD=development-fixture-pass", "PIWORK_AGENT_IMAGE=" + image, "PIWORK_PACKAGE_HELPER_IMAGE=" + next, "PIWORK_FILE_HELPER_IMAGE=" + os.Getenv("PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE"), "PIWORK_SNAPSHOT_HELPER_IMAGE=" + os.Getenv("PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE"), "PIWORK_MODEL_PROVIDER=piwork-deterministic", "PIWORK_MODEL=fixture-v1", "PIWORK_API_KEY=acceptance-only"}
				stdout, err := p.StdoutPipe()
				if err != nil {
					t.Fatal(err)
				}
				log, err := os.Create(filepath.Join(t.TempDir(), "core.log"))
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { log.Close() })
				p.Stderr = log
				if err := p.Start(); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = p.Process.Kill() })
				announced := make(chan string, 1)
				go func() {
					s := bufio.NewScanner(stdout)
					if s.Scan() {
						announced <- s.Text()
					} else {
						announced <- ""
					}
					for s.Scan() {
					}
				}()
				var address struct{ Event, URL string }
				select {
				case line := <-announced:
					if json.Unmarshal([]byte(line), &address) != nil || address.URL == "" {
						data, _ := os.ReadFile(log.Name())
						t.Fatal("Core announcement", string(data))
					}
				case <-time.After(60 * time.Second):
					t.Fatal("Core announcement timeout")
				}
				for deadline := time.Now().Add(60 * time.Second); time.Now().Before(deadline); time.Sleep(100 * time.Millisecond) {
					if status, _ := packageHTTPCall(t, address.URL, "/readyz?profile=docker-delivery", "GET", "", nil); status == 200 {
						return p, address.URL
					}
				}
				data, _ := os.ReadFile(log.Name())
				t.Fatal("Core ready timeout", string(data))
				return nil, ""
			}
			process, base := start()
			status, login := packageHTTPCall(t, base, "/api/v1/login", "POST", "", map[string]string{"account": "admin", "password": "development-fixture-pass"})
			if status != 200 {
				t.Fatal(status, login)
			}
			auth := "Bearer " + login["token"].(string)
			wait := func(id string, want string) {
				for {
					status, op := packageHTTPCall(t, base, "/api/v1/operations/"+id, "GET", auth, nil)
					if status != 200 {
						t.Fatal(status, op)
					}
					state := op["state"]
					if state == "succeeded" || state == "failed" || state == "superseded" {
						if state != want {
							t.Fatal("operation", op)
						}
						return
					}
					if ctx.Err() != nil {
						t.Fatal(ctx.Err())
					}
					time.Sleep(50 * time.Millisecond)
				}
			}
			accept := func(path, key string) map[string]any {
				status, v := packageHTTPCall(t, base, path, "POST", auth, map[string]string{"idempotencyKey": key})
				if status != 202 {
					t.Fatal(path, status, v)
				}
				return v
			}
			status, created := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]string{"name": "Memory crash", "idempotencyKey": "create"})
			if status != 202 {
				t.Fatal(status, created)
			}
			wait(created["operationId"].(string), "succeeded")
			work := created["workId"].(string)
			path := "/api/v1/works/" + work
			status, view := packageHTTPCall(t, base, path+"/configuration", "GET", auth, nil)
			if status != 200 {
				t.Fatal(status, view)
			}
			priorActive := view["active"]
			// End the first Core without stopping its already idle legacy Work, then
			// change only installation defaults offline. Frozen active must remain old.
			if err := process.Process.Kill(); err != nil {
				t.Fatal(err)
			}
			_ = process.Wait()
			settingsStore, err := corestore.Open(ctx, corestore.Options{Directory: directory})
			if err != nil {
				t.Fatal(err)
			}
			files, err := settingsStore.OpenPlatformFiles()
			if err != nil {
				t.Fatal(err)
			}
			_, err = NewSettings(settingsStore, files).ConfigureRuntime(RuntimeInput{AgentImage: next, Provider: "piwork-deterministic", Model: "fixture-v1", Credential: "acceptance-only"})
			files.Close()
			settingsStore.Close()
			if err != nil {
				t.Fatal(err)
			}
			image = next
			process, base = start()
			status, view = packageHTTPCall(t, base, path+"/configuration", "GET", auth, nil)
			if status != 200 || stringMustJSON(view["active"]) != stringMustJSON(priorActive) {
				t.Fatal("defaults changed frozen Work", status, view)
			}
			config := view["desired"].(map[string]any)
			config["agentImage"] = map[string]any{"catalogId": runtimeImageCatalogID(2)}
			status, view = packageHTTPCall(t, base, path+"/configuration", "PUT", auth, map[string]any{"configuration": config})
			if status != 200 {
				t.Fatal(status, view)
			}
			gate := arm("history-migration-agent-remove")
			applied := accept(path+"/configuration/apply", "migration")
			select {
			case <-gate.hit:
			case <-ctx.Done():
				t.Fatal("never reached unpublished migration", ctx.Err())
			}
			if mode == "crash" {
				if err := process.Process.Kill(); err != nil {
					t.Fatal(err)
				}
				_ = process.Wait()
				gate.unblock()
				process, base = start()
				wait(applied["operationId"].(string), "succeeded")
				status, view = packageHTTPCall(t, base, path+"/configuration", "GET", auth, nil)
				if status != 200 || view["pendingApply"] != false {
					t.Fatal("migration did not publish once", status, view)
				}
			} else if mode == "delete" {
				deleted := accept(path+"/delete", "delete-unpublished-migration")
				gate.unblock()
				wait(deleted["operationId"].(string), "succeeded")
				wait(applied["operationId"].(string), "superseded")
				status, _ := packageHTTPCall(t, base, path, "GET", auth, nil)
				if status != 404 {
					t.Fatal("deleted migration still visible", status)
				}
				if err := process.Process.Signal(syscall.SIGTERM); err != nil {
					t.Fatal(err)
				}
				if err := process.Wait(); err != nil {
					t.Fatal(err)
				}
				return
			} else if mode == "apply" {
				newer := accept(path+"/configuration/apply", "newer-migration")
				gate.unblock()
				wait(newer["operationId"].(string), "succeeded")
				wait(applied["operationId"].(string), "superseded")
				status, view = packageHTTPCall(t, base, path+"/configuration", "GET", auth, nil)
				if status != 200 || view["pendingApply"] != false {
					t.Fatal("new Apply did not recover original migration", status, view)
				}
			} else {
				stopped := accept(path+"/stop", "supersede-migration")
				gate.unblock()
				wait(stopped["operationId"].(string), "succeeded")
				wait(applied["operationId"].(string), "superseded")
				status, view = packageHTTPCall(t, base, path+"/configuration", "GET", auth, nil)
				if status != 200 || stringMustJSON(view["active"]) != stringMustJSON(priorActive) {
					t.Fatal("Stop retained unpublished candidate", status, view)
				}
				// A successful start of the original schema-4 image proves restored storage
				// is readable by the frozen old runtime rather than a replacement image.
				started := accept(path+"/start", "start-restored")
				wait(started["operationId"].(string), "succeeded")
			}
			stopped := accept(path+"/stop", "final-stop")
			wait(stopped["operationId"].(string), "succeeded")
			if err := process.Process.Signal(syscall.SIGTERM); err != nil {
				t.Fatal(err)
			}
			if err := process.Wait(); err != nil && !strings.Contains(err.Error(), "signal") {
				t.Fatal(err)
			}
		})
	}
}
