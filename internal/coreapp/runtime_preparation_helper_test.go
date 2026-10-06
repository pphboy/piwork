package coreapp

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
)

// These archives exercise the real static inspector, not helper execution.
// The minimal ELF is an inspection fixture and is never run as a container.
func preparationHelperArchive(t *testing.T, kind string) ([]byte, string, map[string]string) {
	t.Helper()
	elf := make([]byte, 128)
	copy(elf, "\x7fELF")
	elf[4], elf[5], elf[6] = 2, 1, 1
	binary.LittleEndian.PutUint16(elf[16:], 2)
	binary.LittleEndian.PutUint16(elf[18:], 62)
	binary.LittleEndian.PutUint32(elf[20:], 1)
	binary.LittleEndian.PutUint64(elf[24:], 0x400000)
	binary.LittleEndian.PutUint64(elf[32:], 64)
	binary.LittleEndian.PutUint16(elf[52:], 64)
	binary.LittleEndian.PutUint16(elf[54:], 56)
	binary.LittleEndian.PutUint16(elf[56:], 1)
	binary.LittleEndian.PutUint32(elf[64:], 1)
	binary.LittleEndian.PutUint32(elf[68:], 5)
	binary.LittleEndian.PutUint64(elf[80:], 0x400000)
	binary.LittleEndian.PutUint64(elf[96:], 128)
	binary.LittleEndian.PutUint64(elf[104:], 128)
	archive := func(files map[string][]byte) []byte {
		var buffer bytes.Buffer
		writer := tar.NewWriter(&buffer)
		for name, data := range files {
			if err := writer.WriteHeader(&tar.Header{Name: name, Mode: 0755, Size: int64(len(data))}); err != nil {
				t.Fatal(err)
			}
			if _, err := writer.Write(data); err != nil {
				t.Fatal(err)
			}
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		return buffer.Bytes()
	}
	path := "usr/local/bin/piwork-" + kind + "-helper"
	layer := archive(map[string][]byte{path: elf})
	labels := map[string]string{"piwork." + kind + "_protocol": "1"}
	config, _ := json.Marshal(map[string]any{"os": "linux", "architecture": "amd64", "config": map[string]any{"Entrypoint": []string{"/" + path}, "Labels": labels}, "rootfs": map[string]any{"type": "layers", "diff_ids": []string{fmt.Sprintf("sha256:%x", sha256.Sum256(layer))}}})
	manifest, _ := json.Marshal([]map[string]any{{"Config": "config.json", "Layers": []string{"layer.tar"}}})
	return archive(map[string][]byte{"config.json": config, "manifest.json": manifest, "layer.tar": layer}), fmt.Sprintf("sha256:%x", sha256.Sum256(config)), labels
}

func TestPreparationRealHelperCaptureRecoversAfterFirstPullFailure(t *testing.T) {
	directory, err := os.MkdirTemp("", "piwork-helper-engine-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(directory) })
	socket := filepath.Join(directory, "engine.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	type imageFixture struct {
		archive []byte
		id      string
		labels  map[string]string
		pulled  atomic.Bool
		pulls   atomic.Int32
	}
	images := map[string]*imageFixture{}
	for _, kind := range []string{"file", "snapshot"} {
		archive, id, labels := preparationHelperArchive(t, kind)
		images["fixture/"+kind] = &imageFixture{archive: archive, id: id, labels: labels}
	}
	var available atomic.Bool
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/_ping") {
			w.Header().Set("API-Version", "1.51")
			return
		}
		if strings.HasSuffix(r.URL.Path, "/version") {
			json.NewEncoder(w).Encode(map[string]string{"ApiVersion": "1.51", "MinAPIVersion": "1.44", "Os": "linux", "Arch": "amd64"})
			return
		}
		for ref, image := range images {
			if strings.HasSuffix(r.URL.Path, "/images/create") && strings.HasSuffix(r.URL.Query().Get("fromImage"), ref) {
				image.pulls.Add(1)
				if !available.Load() {
					http.Error(w, "fixture registry unavailable", 503)
					return
				}
				image.pulled.Store(true)
				w.Header().Set("Content-Type", "application/json")
				w.Write([]byte("{\"status\":\"complete\"}\n"))
				return
			}
			if strings.HasSuffix(r.URL.Path, "/images/"+ref+"/json") || strings.HasSuffix(r.URL.Path, "/images/"+image.id+"/json") {
				if !image.pulled.Load() {
					http.NotFound(w, r)
					return
				}
				json.NewEncoder(w).Encode(map[string]any{"Id": image.id, "Os": "linux", "Architecture": "amd64", "Config": map[string]any{"Labels": image.labels}})
				return
			}
			if strings.HasSuffix(r.URL.Path, "/images/get") && strings.Contains(r.URL.Query().Get("names"), image.id) {
				w.Header().Set("Content-Type", "application/x-tar")
				w.Write(image.archive)
				return
			}
		}
		http.NotFound(w, r)
	})}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close(); listener.Close() })
	initialization, _ := InitializationFromEnvironment(dockerInitializationEnvironment())
	a, err := New(context.Background(), Options{DataDirectory: t.TempDir(), Initialization: initialization, FileHelperImage: "fixture/file", SnapshotHelperImage: "fixture/snapshot"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { closeSettingsApp(t, a) })
	endpoint, err := dockerengine.SelectEndpoint(dockerengine.SelectionOptions{DockerHost: "unix://" + socket, DockerConfig: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	a.engine, err = dockerengine.Connect(context.Background(), endpoint)
	if err != nil {
		t.Fatal(err)
	}
	a.inspector, err = dockerengine.NewImageInspector(context.Background(), a.engine, a.inspectionRoot, a.Store)
	if err != nil {
		t.Fatal(err)
	}
	a.preparation.retryDelay = func(int) time.Duration { return 100 * time.Millisecond }
	a.preparation.probeForTest = func(context.Context) error { return nil }
	a.preparation.executeForTest = func(ctx context.Context, name string, _ RuntimeProfile) error {
		switch name {
		case "fileHelper":
			return a.captureFileHelper(ctx)
		case "snapshotHelper":
			return a.captureSnapshotHelper(ctx)
		default:
			return nil
		}
	}
	address, err := a.Listen(ListenAddress{"127.0.0.1", 0})
	if err != nil {
		t.Fatal(err)
	}
	waitPreparation(t, a, func(p Preparation) bool {
		return a.Status().Ready && p.Components["fileHelper"].State == "retrying" && p.Components["snapshotHelper"].State == "retrying"
	})
	if a.fileImageCaptured || a.snapshotImageCaptured || a.fileCapability().(map[string]any)["available"] != false {
		t.Fatal("failed attempts published helper identities")
	}
	if status, _ := httpCall(t, address.URL(), "/readyz", "GET", "", nil); status != 200 {
		t.Fatal("helper failure blocked base readiness", status)
	}
	ctx := context.Background()
	login, err := a.Identity.Login(ctx, initialization.Administrator.Account, initialization.Administrator.Password, "helper-recovery")
	if err != nil {
		t.Fatal(err)
	}
	principal, err := a.Identity.Authenticate(ctx, login.Token)
	if err != nil {
		t.Fatal(err)
	}
	owner, now := string(login.User.ID), packageNow()
	fileWork, snapshotWork, otherWork := "work-helper-file", "work-helper-snapshot", "work-helper-independent"
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		for _, id := range []string{fileWork, snapshotWork, otherWork} {
			desired, observed := "running", "ready"
			if id == snapshotWork {
				desired, observed = "stopped", "stopped"
			}
			if err := corestore.InsertWork(tx, corestore.WorkRecord{ID: id, OwnerUserID: owner, Name: id, DesiredState: desired, ObservedState: observed, DesiredRevision: 1, ControlVersion: 1, CreatedAt: now, UpdatedAt: now}); err != nil {
				return err
			}
		}
		_, err := corestore.AcceptFileJob(tx, corestore.FileJob{ID: "file-helper-delayed", WorkID: fileWork, OwnerUserID: owner, SessionID: principal.SessionID, CoreEpoch: a.fileEpoch, RuntimeGeneration: 1, Kind: "PUT", State: "accepted", TrustedImageID: images["fixture/file"].id, VolumeName: "fixture-volume", PathSegmentsJSON: `["unpublished"]`, AcceptedAt: now, DeadlineAt: time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano), UpdatedAt: now}, nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: owner, WorkScope: snapshotWork, Kind: "export-work", IdempotencyKey: "helper-delayed-export", RequestJSON: `{}`, TargetVersion: 1, Now: now}, func(tx *sql.Tx, id string) (corestore.MutationEffect, error) {
		if err := corestore.InsertSnapshotJob(tx, corestore.SnapshotJob{OperationID: id, OwnerUserID: owner, Kind: "export", SourceWorkID: &snapshotWork, RequestDigest: "helper-delayed", Phase: "accepted", DeadlineAt: time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano), WorkerEpoch: 1, CreatedAt: now, UpdatedAt: now}); err != nil {
			return corestore.MutationEffect{}, err
		}
		if err := corestore.UpdateSnapshotPhase(tx, id, 1, "cleanup-pending", now, nil); err != nil {
			return corestore.MutationEffect{}, err
		}
		if err := a.Store.LockSnapshotWork(tx, corestore.SnapshotLock{WorkID: snapshotWork, OperationID: id, WorkerEpoch: 1}); err != nil {
			return corestore.MutationEffect{}, err
		}
		return corestore.MutationEffect{ResourceID: snapshotWork}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	blocked, err := a.recoverCoreFiles(ctx)
	if err != nil || !blocked[fileWork] || blocked[otherWork] {
		t.Fatal("helper wait did not isolate the affected Work", blocked, err)
	}
	if err := a.recoverSnapshotJobs(ctx, true); err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		job, err := corestore.ReadFileJob(tx, "file-helper-delayed")
		if err != nil {
			return err
		}
		gate, err := corestore.ReadFileGate(tx, fileWork)
		if err != nil {
			return err
		}
		snapshot, err := corestore.ReadSnapshotJob(tx, accepted.OperationID)
		if err != nil {
			return err
		}
		if job.State != "accepted" || gate.Closed || snapshot.Phase != "cleanup-pending" || snapshot.WorkerEpoch != 1 {
			t.Error("unavailable helpers consumed durable recovery intents", job, gate, snapshot)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	available.Store(true)
	waitPreparation(t, a, func(p Preparation) bool { return p.Ready && a.Status().Ready })
	fileID, err := a.requireFileImage()
	if err != nil || fileID != images["fixture/file"].id || !a.fileImageCaptured {
		t.Fatal("file helper did not recover", fileID, err)
	}
	snapshotID, err := a.requireSnapshotImage()
	if err != nil || snapshotID != images["fixture/snapshot"].id || !a.snapshotImageCaptured {
		t.Fatal("snapshot helper did not recover", snapshotID, err)
	}
	if images["fixture/file"].pulls.Load() < 2 || images["fixture/snapshot"].pulls.Load() < 2 {
		t.Fatal("failed first pulls were not retried")
	}
	blocked, err = a.recoverCoreFiles(ctx)
	if err != nil || len(blocked) != 0 {
		t.Fatal("available file helper did not settle retained intent", blocked, err)
	}
	if err := a.recoverSnapshotJobs(ctx, false); err != nil {
		t.Fatal(err)
	}
	operation, err := a.Store.Operation(ctx, accepted.OperationID)
	if err != nil || operation.State != "failed" {
		t.Fatal("interrupted export invented success", operation, err)
	}
	if err := a.recoverSnapshotJobs(ctx, false); err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		job, err := corestore.ReadFileJob(tx, "file-helper-delayed")
		if err != nil {
			return err
		}
		other, err := corestore.ReadWork(tx, otherWork, false)
		if err != nil {
			return err
		}
		var count int
		if err := tx.QueryRow(`SELECT count(*) FROM works`).Scan(&count); err != nil {
			return err
		}
		if job.State != "cleaned" || other.ObservedState != "ready" || count != 3 {
			t.Error("recovery changed unrelated Work or repeated objects", job, other, count)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.captureFileHelper(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := a.captureSnapshotHelper(context.Background()); err != nil {
		t.Fatal(err)
	}
	if status, _ := httpCall(t, address.URL(), "/readyz?profile=docker-delivery", "GET", "", nil); status != 200 {
		t.Fatal("delivery readiness did not recover", status)
	}
}
