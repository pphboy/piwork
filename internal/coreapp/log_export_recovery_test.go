package coreapp

import (
	"context"
	"database/sql"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"piwork/internal/corestore"
)

func acceptCoreOnlyExport(t *testing.T, a *Application, exportID, owner, key string) corestore.LogExportTask {
	t.Helper()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO users(id,account,password_digest,role,enabled,created_at,updated_at) VALUES(?,?,?,'admin',1,?,?) ON CONFLICT(id) DO NOTHING`, owner, "fixture-"+owner, "fixture-digest", now, now)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	task, reused, err := a.Store.AcceptLogExport(context.Background(), corestore.LogExportAcceptRequest{
		ExportID: exportID, OwnerUserID: owner, CorrelationID: "correlation-" + exportID,
		CutoffTime: now, IdempotencyKey: key, Scope: corestore.LogScope{IncludeCoreLogs: true},
		CreatedAt: now, Sources: nil,
	})
	if err != nil || reused {
		t.Fatal(task, reused, err)
	}
	return task
}

func TestLogExportRestartInterruptsUnsealedTasksAndKeepsIdempotency(t *testing.T) {
	directory := t.TempDir()
	a, err := New(context.Background(), Options{DataDirectory: directory, Stdout: io.Discard, Stderr: io.Discard})
	if err != nil {
		t.Fatal(err)
	}
	owner := "user-000000000000001"
	exportID := "log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab"
	task := acceptCoreOnlyExport(t, a, exportID, owner, "restart-key")
	if task.State != "collecting" {
		t.Fatalf("unexpected accepted state: %#v", task)
	}
	if err := a.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	reopened, err := New(context.Background(), Options{DataDirectory: directory, Stdout: io.Discard, Stderr: io.Discard})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close(context.Background())
	stored, found, err := reopened.Store.LogExportTask(context.Background(), exportID)
	if err != nil || !found || stored.State != "interrupted" || stored.Error == nil || stored.Error.Code != "LOG_EXPORT_INTERRUPTED" {
		t.Fatalf("unsealed task not interrupted: %#v %v %v", stored, found, err)
	}
	replay, reused, err := reopened.Store.AcceptLogExport(context.Background(), corestore.LogExportAcceptRequest{
		ExportID: "log-export-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", OwnerUserID: owner, CorrelationID: "c",
		CutoffTime: time.Now().UTC().Format(time.RFC3339Nano), IdempotencyKey: "restart-key",
		Scope: corestore.LogScope{IncludeCoreLogs: true}, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil || !reused || replay.ExportID != exportID || replay.State != "interrupted" {
		t.Fatalf("replay started a new collection: %#v %v %v", replay, reused, err)
	}
}

func TestLogExportRestartReusesVerifiedResultAndRejectsCorruption(t *testing.T) {
	directory := t.TempDir()
	a, err := New(context.Background(), Options{DataDirectory: directory, Stdout: io.Discard, Stderr: io.Discard})
	if err != nil {
		t.Fatal(err)
	}
	owner := "user-000000000000001"
	exportID := "log-export-cccccccccccccccccccccccccccccccd"
	a.RecordAppEvent("test.export", "info", map[string]string{"marker": "sealed-content"})
	acceptCoreOnlyExport(t, a, exportID, owner, "sealed-key")
	a.runLogExport(exportID)
	task, found, err := a.Store.LogExportTask(context.Background(), exportID)
	if err != nil || !found || task.State != "ready" || task.Result == nil {
		t.Fatalf("export did not seal: %#v %v %v", task, found, err)
	}
	if err := a.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	reopened, err := New(context.Background(), Options{DataDirectory: directory, Stdout: io.Discard, Stderr: io.Discard})
	if err != nil {
		t.Fatal(err)
	}
	stored, found, err := reopened.Store.LogExportTask(context.Background(), exportID)
	if err != nil || !found || stored.State != "ready" || stored.Result == nil || stored.Result.Digest != task.Result.Digest {
		t.Fatalf("verified result was not restored: %#v %v %v", stored, found, err)
	}
	if err := reopened.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	bundle := filepath.Join(directory, "runtime", "log-exports", exportID, "bundle.zip")
	if err := os.WriteFile(bundle, []byte("corrupt"), 0600); err != nil {
		t.Fatal(err)
	}
	reopened, err = New(context.Background(), Options{DataDirectory: directory, Stdout: io.Discard, Stderr: io.Discard})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close(context.Background())
	stored, _, err = reopened.Store.LogExportTask(context.Background(), exportID)
	if err != nil || stored.State != "failed" || stored.Error == nil || stored.Error.Code != "LOG_EXPORT_CONTENT_UNAVAILABLE" || stored.Result != nil {
		t.Fatalf("corrupt result was served: %#v %v", stored, err)
	}
}

func TestLogExportRecoversSealedPackingTaskWithoutRecollecting(t *testing.T) {
	directory := t.TempDir()
	a, err := New(context.Background(), Options{DataDirectory: directory, Stdout: io.Discard, Stderr: io.Discard})
	if err != nil {
		t.Fatal(err)
	}
	owner := "user-000000000000001"
	exportID := "log-export-ccccccccccccccccccccccccccccccce"
	a.RecordAppEvent("test.export", "info", map[string]string{"marker": "sealed-packing"})
	acceptCoreOnlyExport(t, a, exportID, owner, "sealed-packing-key")
	a.runLogExport(exportID)
	task, _, err := a.Store.LogExportTask(context.Background(), exportID)
	if err != nil || task.State != "ready" || task.Result == nil {
		t.Fatalf("fixture export did not seal: %#v %v", task, err)
	}
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		key, _ := corestore.LogTaskKey(exportID)
		current, found, err := corestore.GetLogRecordTx[corestore.LogExportTask](tx, key)
		if err != nil || !found {
			return err
		}
		current.State = "packing"
		current.Result = nil
		current.Complete = nil
		if err := corestore.PutLogRecordTx(tx, key, current); err != nil {
			return err
		}
		resultKey, _ := corestore.LogResultKey(exportID)
		return corestore.DeleteLogRecordTx(tx, resultKey)
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	reopened, err := New(context.Background(), Options{DataDirectory: directory, Stdout: io.Discard, Stderr: io.Discard})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close(context.Background())
	got, _, err := reopened.Store.LogExportTask(context.Background(), exportID)
	if err != nil || got.State != "ready" || got.Result == nil || got.Result.Digest != task.Result.Digest || got.Complete == nil {
		t.Fatalf("sealed packing task did not recover ready: %#v %v", got, err)
	}
}
