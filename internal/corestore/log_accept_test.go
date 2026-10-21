package corestore

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func registerTestSource(t *testing.T, store *Store, sourceID, workID, owner string) LogSource {
	t.Helper()
	source, err := store.RegisterLogSource(context.Background(), LogSourceRegistration{
		SourceID: sourceID, OwnerUserID: owner, WorkID: workID, Kind: "agent",
		Generation: 1, InstanceID: "instance-1", PolicyVersion: 1, CreatedAt: "2026-10-21T00:00:00Z",
	})
	if err != nil {
		t.Fatal(err)
	}
	return source
}

func acceptTestRequest(exportID, owner, key, cutoff string, sourceID, workID string) LogExportAcceptRequest {
	return LogExportAcceptRequest{
		ExportID: exportID, OwnerUserID: owner, CorrelationID: "correlation-1", CutoffTime: cutoff,
		IdempotencyKey: key, Scope: LogScope{IncludeCoreLogs: true, OwnedWorkCount: 1},
		CreatedAt: "2026-10-21T00:00:01Z",
		Sources: []LogTaskSource{{
			Version: logRecordVersion, ExportID: exportID, SourceID: sourceID, Sequence: 0, OwnerUserID: owner,
			WorkID: workID, Kind: "agent", State: "pending", Entries: []string{"works/" + workID + "/" + sourceID + "/stdout.log"},
		}},
	}
}

func TestLogSourceRegistrationAndBinding(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "install")
	store := openTestStore(t, directory)
	ctx := context.Background()
	populateLogTestWork(t, store)

	if _, err := store.RegisterLogSource(ctx, LogSourceRegistration{
		SourceID: testSourceID, OwnerUserID: testOwnerID, WorkID: "work-000000000000999", Kind: "agent",
		Generation: 1, InstanceID: "instance-1", CreatedAt: "2026-10-21T00:00:00Z",
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("source registered for a missing Work: %v", err)
	}
	if _, err := store.RegisterLogSource(ctx, LogSourceRegistration{
		SourceID: testSourceID, OwnerUserID: "user-000000000000009", WorkID: testWorkID, Kind: "agent",
		Generation: 1, InstanceID: "instance-1", CreatedAt: "2026-10-21T00:00:00Z",
	}); err == nil {
		t.Fatal("source registered under the wrong owner")
	}
	source := registerTestSource(t, store, testSourceID, testWorkID, testOwnerID)
	if source.State != "registered" || source.InstallationID != store.InstallationID() || source.OwnerUserID != testOwnerID {
		t.Fatalf("unexpected registered source: %#v", source)
	}
	if _, err := store.RegisterLogSource(ctx, LogSourceRegistration{
		SourceID: testSourceID, OwnerUserID: testOwnerID, WorkID: testWorkID, Kind: "service", ServiceID: "svc",
		Generation: 1, InstanceID: "instance-1", CreatedAt: "2026-10-21T00:00:00Z",
	}); err == nil {
		t.Fatal("source identity changed on re-registration")
	}
	installation := store.InstallationID()
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	// Registration survives restart with unchanged identity and state.
	store = openTestStore(t, directory)
	defer store.Close()
	if store.InstallationID() != installation {
		t.Fatal("installation identity changed")
	}
	recovered, found, err := store.LogSource(ctx, testSourceID)
	if err != nil || !found || recovered.State != "registered" || recovered.OwnerUserID != testOwnerID {
		t.Fatalf("registered source not recovered: %#v %v %v", recovered, found, err)
	}
	bound, err := store.BindLogSource(ctx, testSourceID, "container-1", 1, "2026-10-21T00:00:02Z")
	if err != nil || bound.State != "bound" || bound.ContainerID != "container-1" {
		t.Fatalf("bind failed: %#v %v", bound, err)
	}
	// Re-registration after a bind must ignore the mutable observed policy and
	// remain idempotent for the same immutable instance identity.
	if _, err := store.RegisterLogSource(ctx, LogSourceRegistration{
		SourceID: testSourceID, OwnerUserID: testOwnerID, WorkID: testWorkID, Kind: "agent",
		Generation: 1, InstanceID: "instance-1", PolicyVersion: 0, CreatedAt: "2026-10-21T00:00:02Z",
	}); err != nil {
		t.Fatalf("re-registration after bind failed: %v", err)
	}
	again, err := store.BindLogSource(ctx, testSourceID, "container-1", 1, "2026-10-21T00:00:03Z")
	if err != nil || again.BoundAt != "2026-10-21T00:00:02Z" {
		t.Fatalf("idempotent bind changed the record: %#v %v", again, err)
	}
	if _, err := store.BindLogSource(ctx, testSourceID, "container-2", 1, "2026-10-21T00:00:04Z"); err == nil {
		t.Fatal("source rebound to a different container instance")
	}
	if _, err := store.BindLogSource(ctx, "log-source-cccccccccccccccccccccccccccccccc", "container-1", 1, "2026-10-21T00:00:04Z"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown source bound: %v", err)
	}
}

func TestDeletedWorkKeepsSourceOwnershipButRejectsNewRegistration(t *testing.T) {
	store := openTestStore(t, t.TempDir())
	defer store.Close()
	ctx := context.Background()
	populateLogTestWork(t, store)
	registerTestSource(t, store, testSourceID, testWorkID, testOwnerID)
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE works SET deleted_at=? WHERE id=?`, "2026-10-21T00:00:05Z", testWorkID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RegisterLogSource(ctx, LogSourceRegistration{
		SourceID: "log-source-cccccccccccccccccccccccccccccccc", OwnerUserID: testOwnerID, WorkID: testWorkID, Kind: "agent",
		Generation: 1, InstanceID: "instance-2", CreatedAt: "2026-10-21T00:00:06Z",
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted Work gained a new source: %v", err)
	}
	exportID := "log-export-dddddddddddddddddddddddddddddddd"
	if _, _, err := store.AcceptLogExport(ctx, acceptTestRequest(exportID, testOwnerID, "deleted-work", "2026-10-21T00:00:06Z", testSourceID, testWorkID)); err != nil {
		t.Fatalf("retained source of a deleted Work was not exportable: %v", err)
	}
}

func TestAcceptLogExportReplayRollbackAndBounds(t *testing.T) {
	store := openTestStore(t, t.TempDir())
	defer store.Close()
	ctx := context.Background()
	populateLogTestWork(t, store)
	registerTestSource(t, store, testSourceID, testWorkID, testOwnerID)
	exportID := "log-export-dddddddddddddddddddddddddddddddd"
	request := acceptTestRequest(exportID, testOwnerID, "client-key", "2026-10-21T00:00:00Z", testSourceID, testWorkID)
	task, reused, err := store.AcceptLogExport(ctx, request)
	if err != nil || reused || task.ExportID != exportID || task.State != "collecting" || task.Progress.TotalSources != 1 || task.Scope.SourceCount != 1 {
		t.Fatalf("accept failed: %#v %v %v", task, reused, err)
	}
	if key, _ := LogTaskSourceKey(exportID, 0); func() bool {
		item, found, err := GetLogRecord[LogTaskSource](ctx, store, key)
		return err == nil && found && item.SourceID == testSourceID
	}() != true {
		t.Fatal("source item not persisted")
	}

	replay := acceptTestRequest("log-export-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", testOwnerID, "client-key", "2026-10-21T01:00:00Z", testSourceID, testWorkID)
	original, reused, err := store.AcceptLogExport(ctx, replay)
	if err != nil || !reused || original.ExportID != exportID || original.CutoffTime != "2026-10-21T00:00:00Z" {
		t.Fatalf("replay did not return the original task: %#v %v %v", original, reused, err)
	}
	if keys, err := store.ListLogRecordKeys(ctx, "log_task_"); err != nil || len(keys) != 1 {
		t.Fatalf("replay created a second task: %v %v", keys, err)
	}
	duplicate := acceptTestRequest(exportID, testOwnerID, "another-key", "2026-10-21T00:00:00Z", testSourceID, testWorkID)
	if _, _, err := store.AcceptLogExport(ctx, duplicate); err == nil {
		t.Fatal("duplicate export identity with a new key was accepted")
	}

	otherOwner := "user-000000000000002"
	bad := acceptTestRequest("log-export-ffffffffffffffffffffffffffffffff", otherOwner, "bad-key", "2026-10-21T00:00:00Z", testSourceID, testWorkID)
	bad.Scope.OwnedWorkCount = 1
	if _, _, err := store.AcceptLogExport(ctx, bad); err == nil {
		t.Fatal("acceptance for another owner's source succeeded")
	}
	for _, key := range []string{"log_task_", "log_idem_", "log_item_"} {
		keys, err := store.ListLogRecordKeys(ctx, key)
		if err != nil {
			t.Fatal(err)
		}
		if len(keys) != 1 {
			t.Fatalf("failed acceptance persisted %s records: %v", key, keys)
		}
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		key, _ := LogTaskKey(exportID)
		current, _, err := GetLogRecordTx[LogExportTask](tx, key)
		if err != nil {
			return err
		}
		current.State = "failed"
		return PutLogRecordTx(tx, key, current)
	}); err != nil {
		t.Fatal(err)
	}
	invalidSequence := acceptTestRequest("log-export-11111111111111111111111111111111", testOwnerID, "sequence-key", "2026-10-21T00:00:00Z", testSourceID, testWorkID)
	invalidSequence.Sources[0].Sequence = 3
	if _, _, err := store.AcceptLogExport(ctx, invalidSequence); !errors.Is(err, ErrStorage) {
		t.Fatalf("non-contiguous item sequence accepted: %v", err)
	}
	invalidPath := acceptTestRequest("log-export-22222222222222222222222222222222", testOwnerID, "path-key", "2026-10-21T00:00:00Z", testSourceID, testWorkID)
	invalidPath.Sources[0].Entries = []string{"../escape.log"}
	if _, _, err := store.AcceptLogExport(ctx, invalidPath); !errors.Is(err, ErrStorage) {
		t.Fatalf("path traversal entry accepted: %v", err)
	}
	oversized := acceptTestRequest("log-export-33333333333333333333333333333333", testOwnerID, "oversized-key", "2026-10-21T00:00:00Z", testSourceID, testWorkID)
	oversized.Sources[0].Entries = []string{"works/" + strings.Repeat("a", 2<<20)}
	if _, _, err := store.AcceptLogExport(ctx, oversized); !errors.Is(err, ErrStorage) {
		t.Fatalf("oversized item accepted: %v", err)
	}
	if task, found, err := store.LogExportTask(ctx, exportID); err != nil || !found || task.ExportID != exportID {
		t.Fatalf("original task changed by rejected attempts: %#v %v %v", task, found, err)
	}
}

func TestConcurrentAcceptSameKeyReturnsOriginalTask(t *testing.T) {
	store := openTestStore(t, t.TempDir())
	defer store.Close()
	ctx := context.Background()
	populateLogTestWork(t, store)
	registerTestSource(t, store, testSourceID, testWorkID, testOwnerID)
	ids := []string{
		"log-export-44444444444444444444444444444444",
		"log-export-55555555555555555555555555555555",
	}
	type result struct {
		task   LogExportTask
		reused bool
		err    error
	}
	results := make(chan result, len(ids))
	var start sync.WaitGroup
	start.Add(1)
	var done sync.WaitGroup
	for _, exportID := range ids {
		done.Add(1)
		go func(exportID string) {
			defer done.Done()
			start.Wait()
			task, reused, err := store.AcceptLogExport(ctx, acceptTestRequest(exportID, testOwnerID, "shared-key", "2026-10-21T00:00:00Z", testSourceID, testWorkID))
			results <- result{task, reused, err}
		}(exportID)
	}
	start.Done()
	done.Wait()
	close(results)
	var first, second result
	for item := range results {
		if item.err != nil {
			t.Fatal(item.err)
		}
		if first.task.ExportID == "" {
			first = item
		} else {
			second = item
		}
	}
	if first.reused || !second.reused || first.task.ExportID != second.task.ExportID {
		t.Fatalf("concurrent replay diverged: %#v %#v", first, second)
	}
	if keys, err := store.ListLogRecordKeys(ctx, "log_task_"); err != nil || len(keys) != 1 {
		t.Fatalf("concurrent replay created extra tasks: %v %v", keys, err)
	}
}

func TestAcceptLogExportSingleActiveTaskAndReplayPriority(t *testing.T) {
	store := openTestStore(t, t.TempDir())
	defer store.Close()
	ctx := context.Background()
	populateLogTestWork(t, store)
	registerTestSource(t, store, testSourceID, testWorkID, testOwnerID)
	first, reused, err := store.AcceptLogExport(ctx, acceptTestRequest("log-export-66666666666666666666666666666666", testOwnerID, "first-key", "2026-10-21T00:00:00Z", testSourceID, testWorkID))
	if err != nil || reused {
		t.Fatalf("first accept failed: %v %v", first, err)
	}
	second := acceptTestRequest("log-export-77777777777777777777777777777777", testOwnerID, "second-key", "2026-10-21T00:00:00Z", testSourceID, testWorkID)
	if _, _, err := store.AcceptLogExport(ctx, second); !errors.Is(err, repositoryFailure("LOG_EXPORT_BUSY")) {
		t.Fatalf("second active task accepted: %v", err)
	}
	replay, reused, err := store.AcceptLogExport(ctx, acceptTestRequest("log-export-88888888888888888888888888888888", testOwnerID, "first-key", "2026-10-21T01:00:00Z", testSourceID, testWorkID))
	if err != nil || !reused || replay.ExportID != first.ExportID || replay.CutoffTime != first.CutoffTime {
		t.Fatalf("replay was blocked or diverged: %#v %v %v", replay, reused, err)
	}
}
