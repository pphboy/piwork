//go:build integration

package coreapp

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"
	"testing"
	"time"

	"github.com/moby/moby/client"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/testsupport"
)

func TestNativeCorePackageJobsSurviveSignalsWithoutReinstallation(t *testing.T) {
	for _, test := range []struct {
		name      string
		signal    os.Signal
		cleanExit bool
	}{{"shutdown", syscall.SIGTERM, true}, {"crash", syscall.SIGKILL, false}} {
		t.Run(test.name, func(t *testing.T) {
			image := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE")
			if image == "" {
				t.Fatal("native acceptance image required")
			}
			_, file, _, _ := runtime.Caller(0)
			binary := filepath.Join(filepath.Dir(file), "..", "..", "dist", "go", "piwork-serve")
			if _, err := os.Stat(binary); err != nil {
				t.Fatal("build native Core first", err)
			}
			host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
			if host == "" {
				host = "unix:///var/run/docker.sock"
			}
			raw, err := client.NewClientWithOpts(client.WithHost(host), client.WithAPIVersionNegotiation())
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { raw.Close() })
			scope, err := testsupport.NewScope()
			if err != nil {
				t.Fatal(err)
			}
			t.Log("package signal installation:", scope.ID())
			t.Cleanup(func() {
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				defer cancel()
				if err := scope.Cleanup(ctx, raw); err != nil {
					t.Error(err)
				}
			})
			directory := t.TempDir()
			ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
			defer cancel()
			initial, err := corestore.Open(ctx, corestore.Options{Directory: directory, InstallationID: scope.ID()})
			if err != nil {
				t.Fatal(err)
			}
			initial.Close()
			start := func() (*exec.Cmd, string) {
				t.Helper()
				process := exec.CommandContext(ctx, binary, "serve", "--data-dir", directory, "--listen", "127.0.0.1:0", "--agent-grpc-listen", "0.0.0.0:0")
				process.Env = []string{"PATH=" + filepath.Join(t.TempDir(), "no-host-platform-tools"), "DOCKER_HOST=" + host, "DOCKER_CONFIG=" + t.TempDir(), "PIWORK_ADMIN_ACCOUNT=admin", "PIWORK_ADMIN_PASSWORD=development-fixture-pass", "PIWORK_AGENT_IMAGE=" + image, "PIWORK_PACKAGE_HELPER_IMAGE=" + image, "PIWORK_MODEL_PROVIDER=piwork-deterministic", "PIWORK_MODEL=fixture-v1", "PIWORK_API_KEY=acceptance-only"}
				stdout, err := process.StdoutPipe()
				if err != nil {
					t.Fatal(err)
				}
				// Diagnostics stay in a fixture file; no concurrent bytes.Buffer access.
				stderrPath := filepath.Join(t.TempDir(), "core-errors.log")
				stderr, err := os.Create(stderrPath)
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
					if json.Unmarshal(line, &announcement) != nil || announcement.Event != "core.listening" || announcement.URL == "" {
						t.Fatal("listener announcement missing")
					}
				case <-time.After(45 * time.Second):
					t.Fatal("listener startup timed out")
				}
				var lastStatus int
				var lastReadiness map[string]any
				for deadline := time.Now().Add(60 * time.Second); time.Now().Before(deadline); time.Sleep(100 * time.Millisecond) {
					lastStatus, lastReadiness = packageHTTPCall(t, announcement.URL, "/readyz", "GET", "", nil)
					if lastStatus == 200 {
						return process, announcement.URL
					}
				}
				stderrBytes, _ := os.ReadFile(stderrPath)
				t.Fatalf("Core did not recover package resources and become ready: status=%d readiness=%v process=%v diagnostics=%s",
					lastStatus, lastReadiness, process.ProcessState, stderrBytes)
				return nil, ""
			}
			process, base := start()
			status, login := packageHTTPCall(t, base, "/api/v1/login", "POST", "", map[string]string{"account": "admin", "password": "development-fixture-pass"})
			if status != 200 {
				t.Fatal(status, login)
			}
			auth := "Bearer " + login["token"].(string)
			source := packageZip(t, map[string]string{"package.json": `{"name":"signal-package","scripts":{"postinstall":"node -e \"require('fs').writeFileSync('attempt-marker','once');setTimeout(()=>{},600000)\""}}`})
			sum := sha256.Sum256(source)
			request, err := http.NewRequestWithContext(ctx, "POST", base+"/api/v1/admin/package-uploads", bytes.NewReader(source))
			if err != nil {
				t.Fatal(err)
			}
			request.Header.Set("Authorization", auth)
			request.Header.Set("Content-Type", "application/zip")
			request.Header.Set("X-Piwork-Sha256", hex.EncodeToString(sum[:]))
			request.Header.Set("X-Piwork-Package-Source", "zip")
			request.Header.Set("X-Piwork-Package-Name", "signal.zip")
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			var uploaded map[string]any
			decodeErr := json.NewDecoder(response.Body).Decode(&uploaded)
			response.Body.Close()
			if decodeErr != nil || response.StatusCode != 201 {
				t.Fatal(response.StatusCode, uploaded, decodeErr)
			}
			input := map[string]any{"source": map[string]any{"kind": "upload", "uploadId": uploaded["uploadId"]}, "idempotencyKey": "signal-once"}
			status, accepted := packageHTTPCall(t, base, "/api/v1/admin/packages", "POST", auth, input)
			if status != 202 {
				t.Fatal(status, accepted)
			}
			operationID := accepted["operationId"].(string)
			running := false
			for !running {
				items, err := raw.ContainerList(ctx, client.ContainerListOptions{All: true})
				if err != nil {
					t.Fatal(err)
				}
				for _, item := range items.Items {
					if item.Labels[dockerengine.InstallationLabel] == scope.ID() && item.Labels[dockerengine.PackageJobLabel] == operationID && item.Labels["piwork.package_action"] == "prepare" && item.State == "running" {
						running = true
						break
					}
				}
				if ctx.Err() != nil {
					t.Fatal("actual prepare helper did not run", ctx.Err())
				}
				if !running {
					time.Sleep(100 * time.Millisecond)
				}
			}
			// Kill only this fixture process while its durable helper is running.
			if err := process.Process.Signal(test.signal); err != nil {
				t.Fatal(err)
			}
			waited := process.Wait()
			if test.cleanExit && waited != nil {
				t.Fatal("package shutdown did not confirm cleanup", waited)
			}
			next, nextBase := start()
			status, operation := packageHTTPCall(t, nextBase, "/api/v1/admin/operations/"+operationID, "GET", auth, nil)
			if status != 200 || operation["state"] != "failed" || operation["error"].(map[string]any)["code"] != "PI_PACKAGE_INTERRUPTED" {
				t.Fatal("interrupted preparation resumed scripts or lost error identity", status, operation)
			}
			status, replay := packageHTTPCall(t, nextBase, "/api/v1/admin/packages", "POST", auth, input)
			if status != 202 || replay["operationId"] != operationID || replay["reused"] != true {
				t.Fatal("restart lost accepted idempotency identity", status, replay)
			}
			if err := next.Process.Signal(syscall.SIGTERM); err != nil {
				t.Fatal(err)
			}
			if err := next.Wait(); err != nil {
				t.Fatal("recovered Core did not shut down", err)
			}
			reopened, err := corestore.Open(ctx, corestore.Options{Directory: directory})
			if err != nil {
				t.Fatal(err)
			}
			defer reopened.Close()
			if err := reopened.Read(ctx, func(tx *sql.Tx) error {
				var leases, bindings, heads int
				if err := tx.QueryRow(`SELECT COALESCE(SUM(lease_count),0) FROM pi_package_uploads`).Scan(&leases); err != nil {
					return err
				}
				if err := tx.QueryRow(`SELECT count(*) FROM resource_bindings WHERE resource_kind LIKE 'package-%'`).Scan(&bindings); err != nil {
					return err
				}
				if err := tx.QueryRow(`SELECT count(*) FROM pi_package_catalog`).Scan(&heads); err != nil {
					return err
				}
				if leases != 0 || bindings != 0 || heads != 0 {
					t.Fatal("package shutdown/recovery leaked reservations or published incomplete content", leases, bindings, heads)
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			items, err := raw.ContainerList(ctx, client.ContainerListOptions{All: true})
			if err != nil {
				t.Fatal(err)
			}
			for _, item := range items.Items {
				if item.Labels[dockerengine.InstallationLabel] == scope.ID() && item.Labels[dockerengine.PackageJobLabel] == operationID {
					t.Fatal("helper was retained or recreated after recovery", item.ID)
				}
			}
		})
	}
}

func TestNativeWorkStopCancelsPackagePreparationWithoutPublishing(t *testing.T) {
	nativeWorkActionCancelsPackage(t, "stop")
}

func TestNativeWorkDeleteCancelsPackagePreparationWithoutPublishing(t *testing.T) {
	nativeWorkActionCancelsPackage(t, "delete")
}

func nativeWorkActionCancelsPackage(t *testing.T, action string) {
	t.Helper()
	a, base, auth, id, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + id
	before, err := a.Store.Configuration(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	source := packageZip(t, map[string]string{"package.json": `{"name":"work-signal-package","scripts":{"postinstall":"node -e \"setTimeout(()=>{},600000)\""}}`})
	sum := sha256.Sum256(source)
	request, err := http.NewRequestWithContext(ctx, "POST", base+path+"/package-uploads", bytes.NewReader(source))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", auth)
	request.Header.Set("Content-Type", "application/zip")
	request.Header.Set("X-Piwork-Sha256", hex.EncodeToString(sum[:]))
	request.Header.Set("X-Piwork-Package-Source", "zip")
	request.Header.Set("X-Piwork-Package-Name", "signal.zip")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	var uploaded map[string]any
	decodeErr := json.NewDecoder(response.Body).Decode(&uploaded)
	response.Body.Close()
	if decodeErr != nil || response.StatusCode != 201 {
		t.Fatal(response.StatusCode, uploaded, decodeErr)
	}
	status, accepted := packageHTTPCall(t, base, path+"/packages", "POST", auth, map[string]any{"source": map[string]any{"kind": "upload", "uploadId": uploaded["uploadId"]}, "idempotencyKey": "work-signal-once"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	operationID := accepted["operationId"].(string)
	for {
		spec := dockerengine.PackageHelperSpec{PackageIdentity: dockerengine.PackageIdentity{WorkID: id, JobID: operationID}, Epoch: 1, Action: "prepare", SourceDirectory: filepath.Join(a.options.DataDirectory, "pi-packages", "jobs", operationID, "source")}
		// Resolve image identity from the durable job; never a mutable image tag.
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			job, err := corestore.ReadPackageJob(tx, operationID)
			if err != nil {
				return err
			}
			spec.ImageID = job.PrepareImageID
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(spec.SourceDirectory); os.IsNotExist(err) {
			if ctx.Err() != nil {
				t.Fatal(ctx.Err())
			}
			time.Sleep(50 * time.Millisecond)
			continue
		} else if err != nil {
			t.Fatal(err)
		}
		container, err := a.dockerRuntime.InspectPackageHelper(ctx, spec)
		if err != nil {
			t.Fatal(err)
		}
		if container != nil && container.State != nil && container.State.Running {
			break
		}
		if ctx.Err() != nil {
			t.Fatal(ctx.Err())
		}
		time.Sleep(50 * time.Millisecond)
	}
	status, stopped := packageHTTPCall(t, base, path+"/"+action, "POST", auth, map[string]string{"idempotencyKey": action + "-package"})
	if status != 202 {
		t.Fatal(status, stopped)
	}
	for {
		operation, err := a.Store.Operation(ctx, stopped["operationId"].(string))
		if err != nil {
			t.Fatal(err)
		}
		if operation.State == "succeeded" {
			break
		}
		if operation.State == "failed" || operation.State == "superseded" || ctx.Err() != nil {
			var job corestore.PackageJob
			var bindings []string
			readErr := a.Store.Read(ctx, func(tx *sql.Tx) error {
				var err error
				job, err = corestore.ReadPackageJob(tx, operationID)
				if err != nil {
					return err
				}
				rows, err := tx.Query(`SELECT resource_kind,logical_id FROM resource_bindings WHERE work_id=? AND resource_kind LIKE 'package-%' ORDER BY resource_kind,logical_id`, id)
				if err != nil {
					return err
				}
				defer rows.Close()
				for rows.Next() {
					var kind, logicalID string
					if err := rows.Scan(&kind, &logicalID); err != nil {
						return err
					}
					bindings = append(bindings, kind+":"+logicalID)
				}
				return rows.Err()
			})
			var diagnostic, cleanup string
			if operation.ErrorJSON != nil {
				diagnostic = *operation.ErrorJSON
			}
			if job.CleanupError != nil {
				cleanup = *job.CleanupError
			}
			measure := dockerengine.PackageHelperSpec{PackageIdentity: dockerengine.PackageIdentity{WorkID: id, JobID: operationID}, Epoch: job.WorkerEpoch, Action: "measure", ImageID: job.TrustedHelperImageID}
			view, inspectErr := a.dockerRuntime.InspectPackageHelper(ctx, measure)
			var measureState any
			if view != nil {
				measureState = view.State
			}
			t.Fatalf("Work %s failed to settle package: operation=%s diagnostic=%v packagePhase=%s cleanupError=%v leasesReleased=%t bindings=%v measureState=%v inspectError=%v readError=%v context=%v",
				action, operation.State, diagnostic, job.Phase, cleanup, job.LeasesReleased, bindings, measureState, inspectErr, readErr, ctx.Err())
		}
		time.Sleep(50 * time.Millisecond)
	}
	original, err := a.Store.Operation(ctx, operationID)
	if err != nil || original.State != "superseded" {
		t.Fatal("package completion escaped lifecycle fence", original, err)
	}
	after, err := a.Store.Work(ctx, id, true)
	if err != nil || *after.DesiredContextID != *before.DesiredContextID || *after.ActiveContextID != *before.ActiveContextID {
		t.Fatal("cancelled preparation published a context", after, err)
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		job, err := corestore.ReadPackageJob(tx, operationID)
		if err != nil {
			return err
		}
		if !job.LeasesReleased || job.Phase != "superseded" {
			t.Fatal("superseded package helper cleanup unconfirmed", job)
		}
		var leases, bindings int
		if err := tx.QueryRow(`SELECT lease_count FROM pi_package_uploads WHERE id=?`, uploaded["uploadId"]).Scan(&leases); err != nil {
			return err
		}
		if err := tx.QueryRow(`SELECT count(*) FROM resource_bindings WHERE resource_kind LIKE 'package-%' AND work_id=?`, id).Scan(&bindings); err != nil {
			return err
		}
		if leases != 0 || bindings != 0 {
			t.Fatal("Stop released too early or leaked helper ownership", leases, bindings)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
