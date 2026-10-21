package corestore

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"golang.org/x/sys/unix"
	"piwork/internal/safefs"
)

const (
	testWorkID   = "work-000000000000001"
	testOwnerID  = "user-000000000000001"
	testExportID = "log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	testSourceID = "log-source-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
)

func requireLogKey(t *testing.T, key string, ok bool) string {
	t.Helper()
	if !ok {
		t.Fatal("invalid test log identity")
	}
	return key
}

func populateLogTestWork(t *testing.T, store *Store) {
	t.Helper()
	ctx := context.Background()
	now := "2026-10-21T00:00:00Z"
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`INSERT INTO users(id,account,password_digest,role,enabled,created_at,updated_at) VALUES(?,?,?,?,1,?,?)`, testOwnerID, "admin", "digest", "admin", now, now); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at) VALUES(?,?,?,?,?,0,0,?,?)`, testWorkID, testOwnerID, "work", "stopped", "stopped", now, now)
		return err
	}); err != nil {
		t.Fatal(err)
	}
}

func readLogTestWork(t *testing.T, store *Store) (string, string) {
	t.Helper()
	var owner, state string
	if err := store.Read(context.Background(), func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT owner_user_id,desired_state FROM works WHERE id=?`, testWorkID).Scan(&owner, &state)
	}); err != nil {
		t.Fatal(err)
	}
	return owner, state
}

func TestLogStorageUpgradePreservesExistingInstallation(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "install")
	store := openTestStore(t, directory)
	populateLogTestWork(t, store)
	installation := store.InstallationID()
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Join(directory, "logs")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "operator.credential"), []byte("operator-secret"), 0600); err != nil {
		t.Fatal(err)
	}
	before := map[string]string{}
	for _, name := range []string{"core-format.json", "operator.credential"} {
		raw, err := os.ReadFile(filepath.Join(directory, name))
		if err != nil {
			t.Fatal(err)
		}
		before[name] = string(raw)
	}

	store = openTestStore(t, directory)
	defer store.Close()
	if store.InstallationID() != installation {
		t.Fatal("installation identity changed")
	}
	if owner, state := readLogTestWork(t, store); owner != testOwnerID || state != "stopped" {
		t.Fatalf("existing Work changed: %s/%s", owner, state)
	}
	for name, want := range before {
		raw, err := os.ReadFile(filepath.Join(directory, name))
		if err != nil || string(raw) != want {
			t.Fatalf("%s changed during upgrade", name)
		}
	}
	info, err := os.Stat(filepath.Join(directory, "logs"))
	if err != nil || info.Mode().Perm() != 0700 {
		t.Fatalf("logs namespace not private: %v %v", info, err)
	}
	if err := store.RecoverLogStorage(); err != nil {
		t.Fatalf("recover existing installation: %v", err)
	}
}

func TestLogStorageRejectsLinks(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "install")
	store := openTestStore(t, directory)
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Join(directory, "logs")); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "outside")
	if err := os.MkdirAll(outside, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(directory, "logs")); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(context.Background(), Options{Directory: directory}); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("linked logs namespace accepted: %v", err)
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatal("link target modified")
	}

	// A link below the managed namespace must fail recovery without following it.
	if err := os.Remove(filepath.Join(directory, "logs")); err != nil {
		t.Fatal(err)
	}
	store = openTestStore(t, directory)
	defer store.Close()
	work, err := store.OpenWorkLogsDir(testWorkID)
	if err != nil {
		t.Fatal(err)
	}
	work.Close()
	staging := filepath.Join(directory, "logs", "works", testWorkID, ".staging-source")
	if err := os.Symlink(outside, staging); err != nil {
		t.Fatal(err)
	}
	if err := store.RecoverLogStorage(); !errors.Is(err, ErrStorage) {
		t.Fatalf("staging link accepted: %v", err)
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatal("link target modified")
	}
}

func TestRecoverLogStorageRemovesOnlyUnfinishedStaging(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "install")
	store := openTestStore(t, directory)
	defer store.Close()
	work, err := store.OpenWorkLogsDir(testWorkID)
	if err != nil {
		t.Fatal(err)
	}
	if err := work.EnsureDirectory(".staging-source"); err != nil {
		t.Fatal(err)
	}
	stagingDir, err := work.OpenPrivateDirectory(".staging-source")
	if err != nil {
		t.Fatal(err)
	}
	stagedFile, err := stagingDir.OpenFile("stdout.log", unix.O_CREAT|unix.O_WRONLY)
	if err != nil {
		t.Fatal(err)
	}
	stagedFile.Close()
	stagingDir.Close()
	work.Close()
	export, err := store.OpenLogExportDir(testExportID)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"bundle.zip.part", "seal-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.tmp", "bundle.zip", "seal.json"} {
		file, err := export.OpenFile(name, unix.O_CREAT|unix.O_WRONLY)
		if err != nil {
			t.Fatal(err)
		}
		file.Close()
	}
	export.Close()

	if err := store.RecoverLogStorage(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{".staging-source"} {
		if _, err := os.Lstat(filepath.Join(directory, "logs", "works", testWorkID, name)); !os.IsNotExist(err) {
			t.Fatalf("unfinished %s was retained", name)
		}
	}
	for _, name := range []string{"bundle.zip.part", "seal-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.tmp"} {
		if _, err := os.Lstat(filepath.Join(directory, "runtime", "log-exports", testExportID, name)); !os.IsNotExist(err) {
			t.Fatalf("unfinished %s was retained", name)
		}
	}
	for _, name := range []string{"bundle.zip", "seal.json"} {
		if _, err := os.Stat(filepath.Join(directory, "runtime", "log-exports", testExportID, name)); err != nil {
			t.Fatalf("published %s was removed", name)
		}
	}
}

func TestLogRecordRoundTripAndBounds(t *testing.T) {
	store := openTestStore(t, filepath.Join(t.TempDir(), "install"))
	defer store.Close()
	ctx := context.Background()
	taskKey, taskKeyOK := LogTaskKey(testExportID)
	taskKey = requireLogKey(t, taskKey, taskKeyOK)
	complete := false
	task := LogExportTask{
		Version: logRecordVersion, ExportID: testExportID, OwnerUserID: testOwnerID,
		CorrelationID: "correlation-1", CutoffTime: "2026-10-21T00:00:00Z", State: "ready",
		Scope:     LogScope{IncludeCoreLogs: true, OwnedWorkCount: 1, SourceCount: 1},
		CreatedAt: "2026-10-21T00:00:00Z", UpdatedAt: "2026-10-21T00:01:00Z", WorkerEpoch: 1,
		Progress: LogProgress{ProcessedSources: 1, TotalSources: 1, CollectedBytes: 10},
		Complete: &complete, WarningCount: 1, Warnings: []LogWarning{{Code: "SOURCE_UNAVAILABLE", Message: "missing"}},
		Result: &LogResult{Filename: "logs.zip", Size: 10, Digest: strings.Repeat("a", 64), ReadyAt: "2026-10-21T00:01:00Z", ExpiresAt: "2026-10-22T00:01:00Z"},
	}
	sourceKey, sourceKeyOK := LogSourceKey(testSourceID)
	sourceKey = requireLogKey(t, sourceKey, sourceKeyOK)
	source := LogSource{
		Version: logRecordVersion, SourceID: testSourceID, InstallationID: store.InstallationID(), OwnerUserID: testOwnerID,
		WorkID: testWorkID, Kind: "agent", Generation: 1, InstanceID: "instance-1", ContainerID: "container-1", PolicyVersion: 1,
		State: "bound", CreatedAt: "2026-10-21T00:00:00Z", BoundAt: "2026-10-21T00:00:01Z",
	}
	itemKey, itemKeyOK := LogTaskSourceKey(testExportID, 0)
	itemKey = requireLogKey(t, itemKey, itemKeyOK)
	item := LogTaskSource{
		Version: logRecordVersion, ExportID: testExportID, SourceID: testSourceID, Sequence: 0, OwnerUserID: testOwnerID,
		WorkID: testWorkID, Kind: "agent", State: "available", Bytes: 10, Entries: []string{"works/x/stdout.log"},
	}
	archiveKey, archiveKeyOK := LogArchiveKey(testSourceID)
	archiveKey = requireLogKey(t, archiveKey, archiveKeyOK)
	archive := LogArchive{Version: logRecordVersion, SourceID: testSourceID, State: "published", StdoutBytes: 10, StdoutDigest: strings.Repeat("b", 64), PublishedAt: "2026-10-21T00:00:02Z"}
	idempotencyKey, idempotencyKeyOK := LogIdempotencyKey(testOwnerID, "client-key")
	idempotencyKey = requireLogKey(t, idempotencyKey, idempotencyKeyOK)
	idempotency := LogIdempotency{Version: logRecordVersion, OwnerUserID: testOwnerID, ExportID: testExportID, CreatedAt: "2026-10-21T00:00:00Z"}
	resultKey, resultKeyOK := LogResultKey(testExportID)
	resultKey = requireLogKey(t, resultKey, resultKeyOK)
	result := LogResultRecord{Version: logRecordVersion, ExportID: testExportID, OwnerUserID: testOwnerID, WorkerEpoch: 1, CutoffTime: "2026-10-21T00:00:00Z", Filename: "logs.zip", Size: 10, Digest: strings.Repeat("a", 64), ReadyAt: "2026-10-21T00:01:00Z", ExpiresAt: "2026-10-22T00:01:00Z", ManifestHash: strings.Repeat("c", 64)}

	if err := store.Write(ctx, func(tx *sql.Tx) error {
		for _, record := range []struct {
			key   string
			value LogRecord
		}{{taskKey, task}, {sourceKey, source}, {itemKey, item}, {archiveKey, archive}, {idempotencyKey, idempotency}, {resultKey, result}} {
			if err := PutLogRecordTx(tx, record.key, record.value); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	gotTask, ok, err := GetLogRecord[LogExportTask](ctx, store, taskKey)
	if err != nil || !ok || !reflect.DeepEqual(gotTask, task) {
		t.Fatalf("task record mismatch: %v %v %#v", err, ok, gotTask)
	}
	gotSource, ok, err := GetLogRecord[LogSource](ctx, store, sourceKey)
	if err != nil || !ok || !reflect.DeepEqual(gotSource, source) {
		t.Fatalf("source record mismatch: %v %v %#v", err, ok, gotSource)
	}
	for _, pair := range []struct {
		key   string
		check func() bool
	}{
		{itemKey, func() bool {
			v, ok, err := GetLogRecord[LogTaskSource](ctx, store, itemKey)
			return err == nil && ok && reflect.DeepEqual(v, item)
		}},
		{archiveKey, func() bool {
			v, ok, err := GetLogRecord[LogArchive](ctx, store, archiveKey)
			return err == nil && ok && reflect.DeepEqual(v, archive)
		}},
		{idempotencyKey, func() bool {
			v, ok, err := GetLogRecord[LogIdempotency](ctx, store, idempotencyKey)
			return err == nil && ok && reflect.DeepEqual(v, idempotency)
		}},
		{resultKey, func() bool {
			v, ok, err := GetLogRecord[LogResultRecord](ctx, store, resultKey)
			return err == nil && ok && reflect.DeepEqual(v, result)
		}},
	} {
		if !pair.check() {
			t.Fatalf("record %s did not round trip", pair.key)
		}
	}
	keys, err := store.ListLogRecordKeys(ctx, "log_task_")
	if err != nil || len(keys) != 1 || keys[0] != taskKey {
		t.Fatalf("task listing: %v %v", keys, err)
	}
	keys, err = store.ListLogRecordKeys(ctx, "log_")
	if err != nil {
		t.Fatal(err)
	}
	if len(keys) == 0 || len(keys) != 6 {
		t.Fatalf("unexpected log record count: %v", keys)
	}

	if err := store.PutLogRecord(ctx, "log_task_bad key", task); !errors.Is(err, ErrStorage) {
		t.Fatal("unsafe record key accepted")
	}
	unsupported := task
	unsupported.Version = 2
	if err := store.PutLogRecord(ctx, taskKey, unsupported); !errors.Is(err, ErrStorage) {
		t.Fatal("unsupported record version accepted")
	}
	if err := PutLogRecordTx(nil, taskKey, unsupported); !errors.Is(err, ErrStorage) {
		t.Fatal("unsupported record version accepted in transaction")
	}
	if _, _, err := GetLogRecord[LogTaskSource](ctx, store, taskKey); !errors.Is(err, ErrStorage) {
		t.Fatal("record decoded as the wrong schema")
	}
	for _, invalid := range []string{"short", "log-export-XYZ", "log-export-" + strings.Repeat("a", 31)} {
		if _, ok := LogTaskKey(invalid); ok {
			t.Fatalf("invalid export identity accepted: %s", invalid)
		}
		if _, err := store.OpenLogExportDir(invalid); !errors.Is(err, ErrStorage) {
			t.Fatalf("invalid export directory accepted: %s", invalid)
		}
	}
	if _, err := store.OpenWorkLogsDir("../escape"); !errors.Is(err, ErrStorage) {
		t.Fatal("unsafe Work directory accepted")
	}
}

func TestLogDirectoryPermissions(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "install")
	store := openTestStore(t, directory)
	defer store.Close()
	for _, open := range []func() (*safefs.Root, error){
		store.OpenLogsRoot, store.OpenCoreLogDir, store.OpenWorkLogsRoot, store.OpenLogExportsRoot,
	} {
		root, err := open()
		if err != nil {
			t.Fatal(err)
		}
		root.Close()
	}
	for _, name := range []string{"logs", "logs/core", "logs/works", "runtime/log-exports"} {
		info, err := os.Stat(filepath.Join(directory, name))
		if err != nil || info.Mode().Perm() != 0700 {
			t.Fatalf("%s permissions: %v %v", name, info, err)
		}
	}
}
