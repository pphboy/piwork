package coreapp

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/safefs"
)

func TestLogExportCollectsCoreAndReportsUnavailableSource(t *testing.T) {
	a, source, _, directory := archiveFixture(t)
	exportID := "log-export-99999999999999999999999999999999"
	item := corestore.LogTaskSource{
		Version: 1, ExportID: exportID, SourceID: source.SourceID, Sequence: 0, OwnerUserID: source.OwnerUserID,
		WorkID: source.WorkID, Kind: source.Kind, ServiceID: source.ServiceID, State: "pending",
	}
	task, reused, err := a.Store.AcceptLogExport(context.Background(), corestore.LogExportAcceptRequest{
		ExportID: exportID, OwnerUserID: source.OwnerUserID, CorrelationID: "correlation-export",
		CutoffTime: time.Now().UTC().Format(time.RFC3339Nano), IdempotencyKey: "worker-key",
		Scope:     corestore.LogScope{IncludeCoreLogs: true, OwnedWorkCount: 1, SourceCount: 1},
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Sources: []corestore.LogTaskSource{item},
	})
	if err != nil || reused {
		t.Fatal(task, reused, err)
	}
	a.RecordAppEvent("test.export", "info", map[string]string{"marker": "core-content"})
	a.fullLogReaderForTest = &fakeFullLogReader{err: dockerengine.ErrResourceMissing}
	a.runLogExport(exportID)
	task, found, err := a.Store.LogExportTask(context.Background(), exportID)
	if err != nil || !found || task.State != "ready" || task.Complete == nil || *task.Complete || task.WarningCount == 0 {
		t.Fatalf("unexpected task result: %#v %v %v", task, found, err)
	}
	export, err := a.Store.OpenLogExportDir(exportID)
	if err != nil {
		t.Fatal(err)
	}
	defer export.Close()
	raw, err := export.ReadFile("bundle.zip", 1<<30)
	if err != nil {
		t.Fatal(err)
	}
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	foundManifest, foundCore := false, false
	for _, file := range reader.File {
		switch {
		case file.Name == "manifest.json":
			foundManifest = true
			content, _ := file.Open()
			manifestRaw, _ := io.ReadAll(content)
			content.Close()
			var manifest logManifest
			if json.Unmarshal(manifestRaw, &manifest) != nil || manifest.Complete {
				t.Fatalf("manifest should report an incomplete export: %s", manifestRaw)
			}
			if len(manifest.Sources) != 1 || manifest.Sources[0].State != "unavailable" {
				t.Fatalf("unavailable source missing from manifest: %#v", manifest.Sources)
			}
		case strings.HasPrefix(file.Name, "core/"):
			foundCore = true
		}
	}
	if !foundManifest || !foundCore {
		t.Fatalf("archive layout missing: %v", reader.File)
	}
	if stored, _, _ := a.Store.LogSource(context.Background(), source.SourceID); stored.State != "bound" {
		t.Fatalf("export changed the source lifecycle state: %#v", stored)
	}
	if entries, err := os.ReadDir(filepath.Join(directory, "logs", "works", source.WorkID, source.SourceID)); err != nil || len(entries) != 0 {
		if !os.IsNotExist(err) {
			t.Fatalf("export created or changed archives: %v %v", entries, err)
		}
	}
}

func TestArchiveCopyFiltersRecordsAfterCutoff(t *testing.T) {
	directory := t.TempDir()
	root, err := safefs.OpenRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	if err := root.Lock(); err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	source, err := root.OpenFile("stdout.log", os.O_CREATE|os.O_EXCL|os.O_WRONLY)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := source.WriteString("2026-10-21T00:00:00Z keep one\n2026-10-21T00:00:02Z drop\nmalformed without timestamp\n2026-10-21T00:00:01Z keep two\n"); err != nil {
		t.Fatal(err)
	}
	source.Close()
	targetPath := filepath.Join(t.TempDir(), "filtered.log")
	target, err := os.OpenFile(targetPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	written, _, _, unknown, err := copyArchiveFile(root, "stdout.log", target, time.Date(2026, 10, 21, 0, 0, 1, 0, time.UTC), 1<<20)
	target.Close()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(targetPath)
	if err != nil {
		t.Fatal(err)
	}
	if !unknown || written != int64(len(raw)) || strings.Contains(string(raw), "drop") || !strings.Contains(string(raw), "keep one") || !strings.Contains(string(raw), "keep two") || !strings.Contains(string(raw), "malformed") {
		t.Fatalf("archive filter mismatch: %q", raw)
	}
}

func TestLogExportByteBudgetMarksPartialAndOmitsRemainingSources(t *testing.T) {
	a, source, _, _ := archiveFixture(t)
	second, err := a.Store.RegisterLogSource(context.Background(), corestore.LogSourceRegistration{
		SourceID: "log-source-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", OwnerUserID: source.OwnerUserID, WorkID: source.WorkID,
		Kind: "agent", Generation: 1, InstanceID: "instance-2", CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.Store.BindLogSource(context.Background(), second.SourceID, "container-second", 1, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	limits := defaultLogExportLimits()
	limits.perSourceBytes = 64
	limits.totalBytes = 64
	a.logLimitsForTest = limits
	exportID := "log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaac"
	items := []corestore.LogTaskSource{
		{Version: 1, ExportID: exportID, SourceID: source.SourceID, Sequence: 0, OwnerUserID: source.OwnerUserID, WorkID: source.WorkID, Kind: source.Kind, ServiceID: source.ServiceID, State: "pending"},
		{Version: 1, ExportID: exportID, SourceID: second.SourceID, Sequence: 1, OwnerUserID: source.OwnerUserID, WorkID: second.WorkID, Kind: second.Kind, State: "pending"},
	}
	if _, _, err := a.Store.AcceptLogExport(context.Background(), corestore.LogExportAcceptRequest{
		ExportID: exportID, OwnerUserID: source.OwnerUserID, CorrelationID: "c",
		CutoffTime: time.Now().UTC().Format(time.RFC3339Nano), IdempotencyKey: "budget-key",
		Scope:     corestore.LogScope{IncludeCoreLogs: true, OwnedWorkCount: 1, SourceCount: 2},
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Sources: items,
	}); err != nil {
		t.Fatal(err)
	}
	var stderr strings.Builder
	_ = stderr
	a.fullLogReaderForTest = &fakeFullLogReader{stdout: [][]byte{[]byte(strings.Repeat("x", 200))}}
	a.runLogExport(exportID)
	items, err = a.Store.LogTaskSources(context.Background(), exportID)
	if err != nil || len(items) != 2 {
		t.Fatalf("items: %#v %v", items, err)
	}
	if items[0].State != "partial" || items[0].Bytes > 64 || items[1].State != "omitted" {
		t.Fatalf("budget states wrong: %#v", items)
	}
	task, _, _ := a.Store.LogExportTask(context.Background(), exportID)
	if task.State != "ready" || task.Complete == nil || *task.Complete || task.WarningCount < 2 {
		t.Fatalf("partial export result wrong: %#v", task)
	}
}

func TestLogExportSourceLimitAndAreaCapacity(t *testing.T) {
	a, source, _, directory := archiveFixture(t)
	limits := defaultLogExportLimits()
	limits.sourceCount = 0
	a.logLimitsForTest = limits
	_, _, err := a.logExportScope(context.Background(), source.OwnerUserID, "log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaad", time.Now().UTC())
	if status, _ := contracts.ProjectError(err); status != 409 {
		t.Fatalf("source limit not enforced: %v", err)
	}
	limits.sourceCount = 10
	limits.areaLimit = 1
	a.logLimitsForTest = limits
	if err := os.MkdirAll(filepath.Join(directory, "runtime", "log-exports", "log-export-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "runtime", "log-exports", "log-export-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "bundle.zip"), []byte("0123456789"), 0600); err != nil {
		t.Fatal(err)
	}
	if status, _ := contracts.ProjectError(a.checkLogExportCapacity()); status != 503 {
		t.Fatalf("area capacity not enforced: %v", a.checkLogExportCapacity())
	}
}

func publishTestArchive(t *testing.T, a *Application, source corestore.LogSource, stdout, stderr string) {
	t.Helper()
	root, err := a.Store.OpenLogSourceStaging(source.WorkID, source.SourceID)
	if err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{"stdout.log": stdout, "stderr.log": stderr} {
		file, err := root.OpenFile(name, 0x40|0x1|0x200)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.WriteString(content); err != nil {
			t.Fatal(err)
		}
		if err := file.Sync(); err != nil {
			t.Fatal(err)
		}
		file.Close()
	}
	metadata := archiveMetadata{Version: 1, SourceID: source.SourceID, WorkID: source.WorkID, Kind: source.Kind, ServiceID: source.ServiceID, Generation: source.Generation, InstanceID: source.InstanceID, ContainerID: source.ContainerID, State: "archived", StdoutBytes: int64(len(stdout)), StderrBytes: int64(len(stderr)), StdoutDigest: sha256Hex([]byte(stdout)), StderrDigest: sha256Hex([]byte(stderr)), ArchivedAt: packageNow()}
	raw, _ := json.Marshal(metadata)
	meta, err := root.OpenFile("metadata.json", os.O_CREATE|os.O_EXCL|os.O_WRONLY)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = meta.Write(raw); err != nil {
		t.Fatal(err)
	}
	meta.Sync()
	meta.Close()
	if err := a.Store.RecordLogArchive(context.Background(), source.SourceID, corestore.LogArchive{Version: 1, SourceID: source.SourceID, State: "archived", PublishedAt: metadata.ArchivedAt, StdoutBytes: metadata.StdoutBytes, StderrBytes: metadata.StderrBytes, StdoutDigest: metadata.StdoutDigest, StderrDigest: metadata.StderrDigest}, "archived", metadata.ArchivedAt); err != nil {
		t.Fatal(err)
	}
	if err := root.Sync(); err != nil {
		t.Fatal(err)
	}
	root.Close()
	if err := a.Store.PublishLogSourceStaging(source.WorkID, source.SourceID); err != nil {
		t.Fatal(err)
	}
}

func TestLogExportArchivedUnknownTimestampMarksPartial(t *testing.T) {
	a, source, _, _ := archiveFixture(t)
	publishTestArchive(t, a, source, "line without docker timestamp\n2026-10-21T00:00:01Z kept\n", "2026-10-21T00:00:02Z err\n")
	exportID := "log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaae"
	item := corestore.LogTaskSource{Version: 1, ExportID: exportID, SourceID: source.SourceID, Sequence: 0, OwnerUserID: source.OwnerUserID, WorkID: source.WorkID, Kind: source.Kind, ServiceID: source.ServiceID, State: "pending"}
	if _, _, err := a.Store.AcceptLogExport(context.Background(), corestore.LogExportAcceptRequest{
		ExportID: exportID, OwnerUserID: source.OwnerUserID, CorrelationID: "c", CutoffTime: time.Now().UTC().Format(time.RFC3339Nano),
		IdempotencyKey: "unknown-time", Scope: corestore.LogScope{IncludeCoreLogs: true, OwnedWorkCount: 1, SourceCount: 1},
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Sources: []corestore.LogTaskSource{item},
	}); err != nil {
		t.Fatal(err)
	}
	a.fullLogReaderForTest = &fakeFullLogReader{err: dockerengine.ErrResourceMissing}
	a.runLogExport(exportID)
	items, err := a.Store.LogTaskSources(context.Background(), exportID)
	if err != nil || len(items) != 1 || items[0].State != "partial" || items[0].Reason == "" {
		t.Fatalf("unknown timestamp archive was not partial: %#v %v", items, err)
	}
	task, _, _ := a.Store.LogExportTask(context.Background(), exportID)
	if task.Complete == nil || *task.Complete || task.WarningCount == 0 {
		t.Fatalf("unknown coverage did not make the export incomplete: %#v", task)
	}
}

func TestLogExportFallsBackToArchiveWhenLiveSourceIsReplaced(t *testing.T) {
	a, source, _, _ := archiveFixture(t)
	publishTestArchive(t, a, source, "2026-10-21T00:00:01Z archived-output\n", "")
	exportID := "log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaf"
	item := corestore.LogTaskSource{Version: 1, ExportID: exportID, SourceID: source.SourceID, Sequence: 0, OwnerUserID: source.OwnerUserID, WorkID: source.WorkID, Kind: source.Kind, ServiceID: source.ServiceID, State: "pending"}
	if _, _, err := a.Store.AcceptLogExport(context.Background(), corestore.LogExportAcceptRequest{
		ExportID: exportID, OwnerUserID: source.OwnerUserID, CorrelationID: "c", CutoffTime: time.Now().UTC().Format(time.RFC3339Nano),
		IdempotencyKey: "replacement", Scope: corestore.LogScope{IncludeCoreLogs: true, OwnedWorkCount: 1, SourceCount: 1},
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Sources: []corestore.LogTaskSource{item},
	}); err != nil {
		t.Fatal(err)
	}
	a.fullLogReaderForTest = &fakeFullLogReader{err: dockerengine.ErrResourceMissing}
	a.runLogExport(exportID)
	items, err := a.Store.LogTaskSources(context.Background(), exportID)
	if err != nil || len(items) != 1 || items[0].State != "available" {
		t.Fatalf("replacement did not fall back to archive: %#v %v", items, err)
	}
	raw, err := os.ReadFile(filepath.Join(a.options.DataDirectory, "runtime", "log-exports", exportID, "bundle.zip"))
	if err != nil {
		t.Fatal(err)
	}
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, file := range reader.File {
		if strings.HasSuffix(file.Name, "/stdout.log") {
			content, _ := file.Open()
			data, _ := io.ReadAll(content)
			content.Close()
			found = strings.Contains(string(data), "archived-output")
		}
	}
	if !found {
		t.Fatal("archive fallback content missing from ZIP")
	}
}

func TestLogExportWithoutDockerStillCollectsCoreLogs(t *testing.T) {
	a, source, _, _ := archiveFixture(t)
	a.RecordAppEvent("test.export", "info", map[string]string{"marker": "docker-unavailable"})
	exportID := "log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1"
	item := corestore.LogTaskSource{Version: 1, ExportID: exportID, SourceID: source.SourceID, Sequence: 0, OwnerUserID: source.OwnerUserID, WorkID: source.WorkID, Kind: source.Kind, ServiceID: source.ServiceID, State: "pending"}
	if _, _, err := a.Store.AcceptLogExport(context.Background(), corestore.LogExportAcceptRequest{
		ExportID: exportID, OwnerUserID: source.OwnerUserID, CorrelationID: "c", CutoffTime: time.Now().UTC().Format(time.RFC3339Nano),
		IdempotencyKey: "no-docker", Scope: corestore.LogScope{IncludeCoreLogs: true, OwnedWorkCount: 1, SourceCount: 1},
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Sources: []corestore.LogTaskSource{item},
	}); err != nil {
		t.Fatal(err)
	}
	a.fullLogReaderForTest = nil
	a.dockerRuntime = nil
	a.runLogExport(exportID)
	task, _, _ := a.Store.LogExportTask(context.Background(), exportID)
	if task.State != "ready" || task.Complete == nil || *task.Complete || task.WarningCount == 0 || task.Result == nil {
		t.Fatalf("Docker-unavailable export did not preserve Core results: %#v", task)
	}
	items, _ := a.Store.LogTaskSources(context.Background(), exportID)
	if len(items) != 1 || items[0].State != "unavailable" {
		t.Fatalf("unavailable source not reported: %#v", items)
	}
}

func TestLogExportPackFailureFailsWithoutPublishingPartialArchive(t *testing.T) {
	a, source, _, directory := archiveFixture(t)
	a.RecordAppEvent("test.export", "info", map[string]string{"marker": "pack-failure"})
	exportID := "log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2"
	item := corestore.LogTaskSource{Version: 1, ExportID: exportID, SourceID: source.SourceID, Sequence: 0, OwnerUserID: source.OwnerUserID, WorkID: source.WorkID, Kind: source.Kind, ServiceID: source.ServiceID, State: "pending"}
	if _, _, err := a.Store.AcceptLogExport(context.Background(), corestore.LogExportAcceptRequest{
		ExportID: exportID, OwnerUserID: source.OwnerUserID, CorrelationID: "c", CutoffTime: time.Now().UTC().Format(time.RFC3339Nano),
		IdempotencyKey: "pack-failure", Scope: corestore.LogScope{IncludeCoreLogs: true, OwnedWorkCount: 1, SourceCount: 1},
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Sources: []corestore.LogTaskSource{item},
	}); err != nil {
		t.Fatal(err)
	}
	a.fullLogReaderForTest = &fakeFullLogReader{stdout: [][]byte{[]byte("2026-10-21T00:00:01Z live\n")}}
	a.logExportFaultForTest = func(stage string) error {
		if stage == "zip" {
			return errors.New("injected disk failure")
		}
		return nil
	}
	a.runLogExport(exportID)
	task, _, _ := a.Store.LogExportTask(context.Background(), exportID)
	if task.State != "failed" || task.Result != nil || task.Error == nil {
		t.Fatalf("pack failure did not fail the task: %#v", task)
	}
	for _, name := range []string{"bundle.zip", "bundle.zip.part"} {
		if _, err := os.Stat(filepath.Join(directory, "runtime", "log-exports", exportID, name)); !os.IsNotExist(err) {
			t.Fatalf("%s was published after failure", name)
		}
	}
}

func TestLogExportCoreRecordsAfterCutoffAreExcluded(t *testing.T) {
	a, _, _, _ := archiveFixture(t)
	a.RecordAppEvent("test.cutoff", "info", map[string]string{"marker": "BEFORE_CUTOFF"})
	exportID := "log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3"
	if _, _, err := a.Store.AcceptLogExport(context.Background(), corestore.LogExportAcceptRequest{
		ExportID: exportID, OwnerUserID: "user-000000000000001", CorrelationID: "c", CutoffTime: time.Now().UTC().Format(time.RFC3339Nano),
		IdempotencyKey: "cutoff", Scope: corestore.LogScope{IncludeCoreLogs: true}, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(2 * time.Millisecond)
	a.RecordAppEvent("test.cutoff", "info", map[string]string{"marker": "AFTER_CUTOFF"})
	a.runLogExport(exportID)
	raw, err := os.ReadFile(filepath.Join(a.options.DataDirectory, "runtime", "log-exports", exportID, "bundle.zip"))
	if err != nil {
		t.Fatal(err)
	}
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range reader.File {
		if !strings.HasPrefix(file.Name, "core/") {
			continue
		}
		content, _ := file.Open()
		data, _ := io.ReadAll(content)
		content.Close()
		if strings.Contains(string(data), "AFTER_CUTOFF") || !strings.Contains(string(data), "BEFORE_CUTOFF") {
			t.Fatalf("Core cutoff was not applied: %s", data)
		}
	}
}

func TestLogExportPreservesKnownPartialArchiveGap(t *testing.T) {
	a, source, identity, _ := archiveFixture(t)
	a.fullLogReaderForTest = &fakeFullLogReader{stdout: [][]byte{[]byte("2026-10-21T00:00:00Z retained prefix\n")}, err: io.ErrUnexpectedEOF}
	archived, _ := a.archiveLogSource(context.Background(), source, identity, time.Second)
	if archived.State != "partial" {
		t.Fatalf("fixture archive: %#v", archived)
	}
	exportID := "log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4"
	item := corestore.LogTaskSource{Version: 1, ExportID: exportID, SourceID: source.SourceID, Sequence: 0, OwnerUserID: source.OwnerUserID, WorkID: source.WorkID, Kind: source.Kind, ServiceID: source.ServiceID, State: "pending"}
	if _, _, err := a.Store.AcceptLogExport(context.Background(), corestore.LogExportAcceptRequest{
		ExportID: exportID, OwnerUserID: source.OwnerUserID, CorrelationID: "c", CutoffTime: time.Now().UTC().Format(time.RFC3339Nano),
		IdempotencyKey: "partial-archive", Scope: corestore.LogScope{IncludeCoreLogs: true, OwnedWorkCount: 1, SourceCount: 1},
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Sources: []corestore.LogTaskSource{item},
	}); err != nil {
		t.Fatal(err)
	}
	a.fullLogReaderForTest = &fakeFullLogReader{err: dockerengine.ErrResourceMissing}
	a.runLogExport(exportID)
	items, _ := a.Store.LogTaskSources(context.Background(), exportID)
	if len(items) != 1 || items[0].State != "partial" || items[0].Reason == "" {
		t.Fatalf("known partial archive lost its gap: %#v", items)
	}
	task, _, _ := a.Store.LogExportTask(context.Background(), exportID)
	if task.Complete == nil || *task.Complete || task.WarningCount == 0 {
		t.Fatalf("partial archive produced a complete export: %#v", task)
	}
}

func TestLogExportArchiveBudgetProducesPartialResult(t *testing.T) {
	a, source, _, _ := archiveFixture(t)
	publishTestArchive(t, a, source, "2026-10-21T00:00:01Z "+strings.Repeat("x", 300)+"\n", "")
	limits := defaultLogExportLimits()
	limits.totalBytes = 64
	a.logLimitsForTest = limits
	exportID := "log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa5"
	item := corestore.LogTaskSource{Version: 1, ExportID: exportID, SourceID: source.SourceID, Sequence: 0, OwnerUserID: source.OwnerUserID, WorkID: source.WorkID, Kind: source.Kind, ServiceID: source.ServiceID, State: "pending"}
	if _, _, err := a.Store.AcceptLogExport(context.Background(), corestore.LogExportAcceptRequest{
		ExportID: exportID, OwnerUserID: source.OwnerUserID, CorrelationID: "c", CutoffTime: time.Now().UTC().Format(time.RFC3339Nano),
		IdempotencyKey: "archive-budget", Scope: corestore.LogScope{IncludeCoreLogs: true, OwnedWorkCount: 1, SourceCount: 1},
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Sources: []corestore.LogTaskSource{item},
	}); err != nil {
		t.Fatal(err)
	}
	a.fullLogReaderForTest = &fakeFullLogReader{err: dockerengine.ErrResourceMissing}
	a.runLogExport(exportID)
	items, _ := a.Store.LogTaskSources(context.Background(), exportID)
	if len(items) != 1 || items[0].State != "partial" || items[0].Reason == "" {
		t.Fatalf("archive budget did not produce a partial source: %#v", items)
	}
	task, _, _ := a.Store.LogExportTask(context.Background(), exportID)
	if task.Complete == nil || *task.Complete || task.WarningCount == 0 {
		t.Fatalf("archive budget produced a complete export: %#v", task)
	}
}
