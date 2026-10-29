package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/dockerengine"
	"piwork/internal/internaltls"
	"piwork/internal/workruntime"
)

// Exercise both real preparation paths after cleanup, while a Work activation
// holds the writer and is about to publish its route through the Engine fence.
func TestStartupPreparationPublicationDoesNotBlockWorkActivation(t *testing.T) {
	for _, environment := range []bool{false, true} {
		name, kind, publicationInspect := "static-image", "file", int32(4)
		if environment {
			name, kind, publicationInspect = "package-environment", "agent", 3
		}
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()
			archive, imageID, labels := preparationHelperArchive(t, kind)
			dir, err := os.MkdirTemp("", "piwork-publication-")
			if err != nil {
				t.Fatal(err)
			}
			defer os.RemoveAll(dir)
			socket := filepath.Join(dir, "engine.sock")
			listener, err := net.Listen("unix", socket)
			if err != nil {
				t.Fatal(err)
			}
			ready, resume := make(chan struct{}), make(chan struct{})
			var releaseOnce sync.Once
			release := func() { releaseOnce.Do(func() { close(resume) }) }
			defer release()
			var armed atomic.Bool
			var inspections, exports atomic.Int32
			server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch {
				case strings.HasSuffix(r.URL.Path, "/_ping"):
					w.Header().Set("API-Version", "1.51")
				case strings.HasSuffix(r.URL.Path, "/version"):
					_ = json.NewEncoder(w).Encode(map[string]string{"ApiVersion": "1.51", "MinAPIVersion": "1.44", "Os": "linux", "Arch": "amd64"})
				case strings.HasSuffix(r.URL.Path, "/info"):
					_ = json.NewEncoder(w).Encode(map[string]string{"ID": "publication-daemon", "Driver": "overlay2", "DockerRootDir": "/var/lib/docker"})
				case strings.HasSuffix(r.URL.Path, "/images/"+imageID+"/json"):
					// Static inspection includes a SaveImage identity check; the
					// environment path reuses its prewarmed static capabilities.
					// Pause at each path's final, post-cleanup image observation.
					if armed.Load() && inspections.Add(1) == publicationInspect {
						close(ready)
						select {
						case <-resume:
						case <-r.Context().Done():
							return
						}
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"Id": imageID, "Os": "linux", "Architecture": "amd64", "Config": map[string]any{"Labels": labels}})
				case strings.HasSuffix(r.URL.Path, "/images/get"):
					exports.Add(1)
					_, _ = w.Write(archive)
				default:
					http.NotFound(w, r)
				}
			})}
			go server.Serve(listener)
			defer server.Close()
			a, err := New(ctx, Options{DataDirectory: t.TempDir()})
			if err != nil {
				t.Fatal(err)
			}
			defer closeSettingsApp(t, a)
			a.engine, err = dockerengine.Connect(ctx, dockerengine.Endpoint{Host: "unix://" + socket, ConfigDirectory: t.TempDir()})
			if err != nil {
				t.Fatal(err)
			}
			a.inspector, err = dockerengine.NewImageInspectorWithLifecycle(ctx, a.ctx, a.engine, a.inspectionRoot, a.Store)
			if err != nil {
				t.Fatal(err)
			}
			runtime := &probeRuntimeFixture{}
			if environment {
				a.dockerRuntime, err = dockerengine.NewRuntime(a.engine, a.Store.InstallationID(), nil, nil)
				if err != nil {
					t.Fatal(err)
				}
				a.envRuntimeForTest = runtime
				if _, err := a.inspector.InspectNativeAgent(ctx, imageID); err != nil {
					t.Fatal(err)
				}
			}
			scope, generation, err := a.engine.VerificationIdentity(ctx)
			if err != nil {
				t.Fatal(err)
			}
			a.setWorkRoutesOnline(scope, generation)
			routeCtx := a.captureWorkRouteEpoch(ctx)
			armed.Store(true)
			prepared := make(chan error, 1)
			prepare := func() error {
				if environment {
					_, err := a.probePackageEnvironment(ctx, imageID)
					return err
				}
				_, err := a.inspector.InspectNativeFileHelper(ctx, imageID)
				return err
			}
			go func() { prepared <- prepare() }()
			select {
			case <-ready:
			case <-ctx.Done():
				t.Fatal("preparation did not reach its post-cleanup publication check")
			}
			held, activate := make(chan struct{}), make(chan struct{})
			var activateOnce sync.Once
			activateNow := func() { activateOnce.Do(func() { close(activate) }) }
			defer activateNow()
			activated := make(chan error, 1)
			go func() {
				activated <- a.Store.Write(ctx, func(*sql.Tx) error {
					close(held)
					select {
					case <-activate:
					case <-ctx.Done():
						return ctx.Err()
					}
					// Validation fails immediately after the identity fence; this
					// exercises the same locked prefix as a valid Start/Apply route.
					_ = a.publishWorkRoute(routeCtx, internaltls.Scope{}, "", workruntime.Started{})
					return nil
				})
			}()
			<-held
			release()
			// Give the independent preparation an opportunity to request its
			// writer. The old ordering holds Engine identity for its 2s timeout.
			time.Sleep(100 * time.Millisecond)
			activateNow()
			select {
			case err := <-activated:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(time.Second):
				t.Error("Work activation waited for an unrelated preparation publication timeout")
				<-activated
			}
			if err := <-prepared; err != nil {
				t.Fatal("successful preparation could not publish", err)
			}
			if err := prepare(); err != nil || exports.Load() != 1 || environment && runtime.started.Load() != 1 {
				t.Fatal("success was not reusable without repeating preparation", err, exports.Load(), runtime.started.Load())
			}

			// Force durable hits in both callers, then hold the only SQL writer.
			// Access-time bookkeeping must not put these hits back on that queue.
			armed.Store(false)
			if err := a.inspector.Close(ctx); err != nil {
				t.Fatal(err)
			}
			a.inspector, err = dockerengine.NewImageInspectorWithLifecycle(ctx, a.ctx, a.engine, a.inspectionRoot, a.Store)
			if err != nil {
				t.Fatal(err)
			}
			if environment {
				a.environmentCache.Invalidate(environmentKey{imageID: imageID, scope: scope, generation: generation, version: packageEnvironmentRuleVersion})
			}
			hitHeld, hitRelease := make(chan struct{}), make(chan struct{})
			var hitOnce sync.Once
			releaseHitWriter := func() { hitOnce.Do(func() { close(hitRelease) }) }
			defer releaseHitWriter()
			hitWriterDone := make(chan error, 1)
			go func() {
				hitWriterDone <- a.Store.Write(ctx, func(*sql.Tx) error {
					close(hitHeld)
					select {
					case <-hitRelease:
						return nil
					case <-ctx.Done():
						return ctx.Err()
					}
				})
			}()
			<-hitHeld
			hitDone := make(chan error, 1)
			go func() { hitDone <- prepare() }()
			select {
			case err := <-hitDone:
				if err != nil {
					releaseHitWriter()
					t.Fatal("durable hit failed", err)
				}
			case <-time.After(time.Second):
				releaseHitWriter()
				<-hitDone
				t.Fatal("durable hit waited for an unrelated writer")
			}
			releaseHitWriter()
			if err := <-hitWriterDone; err != nil {
				t.Fatal(err)
			}
			if exports.Load() != 1 || environment && runtime.started.Load() != 1 {
				t.Fatal("durable hit repeated preparation", exports.Load(), runtime.started.Load())
			}
		})
	}
}
