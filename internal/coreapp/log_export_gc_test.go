package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"piwork/internal/corestore"
)

func TestLogExportGCExpiresReadyResultsAndPurgesOldSummaries(t *testing.T) {
	a, base, admin, _, _ := logExportHTTPFixture(t)
	_ = base
	ctx := context.Background()
	owner := string(admin.User.ID)
	expiredID := "log-export-22222222222222222222222222222223"
	installReadyExport(t, a, owner, expiredID, []byte("expires"))
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		key, _ := corestore.LogTaskKey(expiredID)
		task, _, err := corestore.GetLogRecordTx[corestore.LogExportTask](tx, key)
		if err != nil {
			return err
		}
		task.Result.ExpiresAt = time.Now().Add(-time.Minute).UTC().Format(time.RFC3339Nano)
		task.UpdatedAt = time.Now().Add(-time.Hour).UTC().Format(time.RFC3339Nano)
		return corestore.PutLogRecordTx(tx, key, task)
	}); err != nil {
		t.Fatal(err)
	}
	a.collectLogExportGarbage(ctx)
	task, found, err := a.Store.LogExportTask(ctx, expiredID)
	if err != nil || !found || task.State != "expired" {
		t.Fatalf("ready result did not expire: %#v %v %v", task, found, err)
	}
	if _, err := os.Stat(filepath.Join(a.options.DataDirectory, "runtime", "log-exports", expiredID)); !os.IsNotExist(err) {
		t.Fatal("expired archive files were retained")
	}

	oldID := "log-export-33333333333333333333333333333334"
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, _, err := a.Store.AcceptLogExport(ctx, corestore.LogExportAcceptRequest{
		ExportID: oldID, OwnerUserID: owner, CorrelationID: "c", CutoffTime: now, IdempotencyKey: "old-summary",
		Scope: corestore.LogScope{IncludeCoreLogs: true}, CreatedAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		key, _ := corestore.LogTaskKey(oldID)
		task, _, err := corestore.GetLogRecordTx[corestore.LogExportTask](tx, key)
		if err != nil {
			return err
		}
		task.State = "interrupted"
		task.Error = &corestore.LogTaskError{Code: "LOG_EXPORT_INTERRUPTED", Message: "restart", CorrelationID: task.CorrelationID}
		task.UpdatedAt = time.Now().Add(-8 * 24 * time.Hour).UTC().Format(time.RFC3339Nano)
		return corestore.PutLogRecordTx(tx, key, task)
	}); err != nil {
		t.Fatal(err)
	}
	a.collectLogExportGarbage(ctx)
	if _, found, _ := a.Store.LogExportTask(ctx, oldID); found {
		t.Fatal("old task summary was retained")
	}
	idempotencyKey, _ := corestore.LogIdempotencyKey(owner, "old-summary")
	if _, found, _ := corestore.GetLogRecord[corestore.LogIdempotency](ctx, a.Store, idempotencyKey); found {
		t.Fatal("old idempotency mapping was retained")
	}
}

func TestLogArchiveGCRemovesExpiredArchiveAndKeepsGapSummary(t *testing.T) {
	a, source, identity, directory := archiveFixture(t)
	a.fullLogReaderForTest = &fakeFullLogReader{stdout: [][]byte{[]byte("2026-10-21T00:00:01Z old archive\n")}}
	if _, err := a.archiveLogSource(context.Background(), source, identity, time.Second); err != nil {
		t.Fatal(err)
	}
	metadataPath := filepath.Join(directory, "logs", "works", source.WorkID, source.SourceID, "metadata.json")
	raw, err := os.ReadFile(metadataPath)
	if err != nil {
		t.Fatal(err)
	}
	var metadata archiveMetadata
	if err := json.Unmarshal(raw, &metadata); err != nil {
		t.Fatal(err)
	}
	metadata.ArchivedAt = time.Now().Add(-8 * 24 * time.Hour).UTC().Format(time.RFC3339Nano)
	raw, _ = json.Marshal(metadata)
	if err := os.WriteFile(metadataPath, raw, 0600); err != nil {
		t.Fatal(err)
	}
	a.collectLogArchiveGarbage(context.Background())
	if _, err := os.Stat(filepath.Join(directory, "logs", "works", source.WorkID, source.SourceID)); !os.IsNotExist(err) {
		t.Fatal("expired Work archive was retained")
	}
	stored, found, err := a.Store.LogSource(context.Background(), source.SourceID)
	if err != nil || !found || stored.State != "expired" || stored.Reason == "" || stored.OwnerUserID != source.OwnerUserID {
		t.Fatalf("archive gap summary missing: %#v %v %v", stored, found, err)
	}
}
