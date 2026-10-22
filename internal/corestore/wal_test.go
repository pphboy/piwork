package corestore

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"piwork/internal/safefs"
	"piwork/internal/testsupport/sqlitefixture"
)

func TestSQLiteReaderChild(t *testing.T) { sqlitefixture.ReaderChild(t) }

func walStoreFixture(t *testing.T) (string, string) {
	t.Helper()
	directory := t.TempDir()
	store := openTestStore(t, directory)
	id := store.InstallationID()
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	release := sqlitefixture.PartialWAL(t, filepath.Join(directory, DatabaseName))
	if got := sqlitefixture.QuickCheck(t, filepath.Join(directory, DatabaseName), true); got == "ok" {
		t.Fatal("fixture main database unexpectedly passes without WAL")
	}
	if got := sqlitefixture.QuickCheck(t, filepath.Join(directory, DatabaseName), false); got != "ok" {
		t.Fatal("fixture committed snapshot is invalid", got)
	}
	release()
	return directory, id
}

func TestWALFixtureExposesImmutableStartupFailure(t *testing.T) {
	directory, _ := walStoreFixture(t)
	root, err := safefs.OpenExistingRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	marker, err := readMarker(root, MarkerName)
	if err != nil {
		t.Fatal(err)
	}
	if err := verifyDatabase(context.Background(), root, DatabaseName, marker, true); !errors.Is(err, ErrUnsupported) {
		t.Fatal("immutable validation did not reproduce failure", err)
	}
}

func assertWALValue(t *testing.T, store *Store, id string) {
	t.Helper()
	if store.InstallationID() != id {
		t.Fatal("installation identity changed")
	}
	if err := store.Read(context.Background(), func(tx *sql.Tx) error {
		var value string
		if err := tx.QueryRow("SELECT value_json FROM control_metadata WHERE key='wal-fixture-00999'").Scan(&value); err != nil {
			return err
		}
		if value != sqlitefixture.Value(999) {
			t.Fatal("committed WAL value changed")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestOpenRecoversPartiallyCheckpointedWAL(t *testing.T) {
	for _, shm := range []string{"original", "absent", "empty", "stale"} {
		t.Run(shm, func(t *testing.T) {
			directory, id := walStoreFixture(t)
			path := filepath.Join(directory, DatabaseName+"-shm")
			switch shm {
			case "absent":
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
			case "empty", "stale":
				var data []byte
				if shm == "stale" {
					data = make([]byte, 32768)
					data[0] = 255
				}
				if err := os.WriteFile(path, data, 0600); err != nil {
					t.Fatal(err)
				}
			}
			store := openTestStore(t, directory)
			defer store.Close()
			assertWALValue(t, store, id)
		})
	}
}

func TestInitializationPublishedDatabaseRecoversWAL(t *testing.T) {
	directory := t.TempDir()
	injected := errors.New("stop after publication")
	_, err := Open(context.Background(), Options{Directory: directory, fault: func(stage string) error {
		if stage == "after-database-publish" {
			return injected
		}
		return nil
	}})
	if !errors.Is(err, injected) {
		t.Fatal(err)
	}
	root, err := safefs.OpenExistingRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	marker, err := readMarker(root, MarkerName)
	root.Close()
	if err != nil || marker.Phase != "initializing" {
		t.Fatal(marker, err)
	}
	release := sqlitefixture.PartialWAL(t, filepath.Join(directory, DatabaseName))
	release()
	store := openTestStore(t, directory)
	defer store.Close()
	assertWALValue(t, store, marker.InstallationID)
}

func TestWALPreflightRejectsWithoutChangingOriginalFiles(t *testing.T) {
	for _, fixture := range []string{"identity", "version", "schema", "corrupt", "wal-permission", "shm-symlink", "wal-hardlink"} {
		t.Run(fixture, func(t *testing.T) {
			directory, _ := walStoreFixture(t)
			path := filepath.Join(directory, DatabaseName)
			statements := map[string]string{
				"identity": "UPDATE go_core_metadata SET installation_id='installation-foreign-00000001'",
				"version":  "PRAGMA user_version=99",
				"schema":   "CREATE TABLE unexpected_wal_table(value TEXT)",
				"corrupt":  "PRAGMA writable_schema=ON; UPDATE sqlite_master SET rootpage=999999 WHERE name='control_metadata'; PRAGMA writable_schema=OFF",
			}
			if statement := statements[fixture]; statement != "" {
				db := sqlitefixture.Open(t, path, false, false)
				release := sqlitefixture.HoldReader(t, path)
				sqlitefixture.Exec(t, db, statement)
				if err := db.Close(); err != nil {
					t.Fatal(err)
				}
				release()
			} else {
				switch fixture {
				case "wal-permission":
					if err := os.Chmod(path+"-wal", 0644); err != nil {
						t.Fatal(err)
					}
				case "shm-symlink":
					outside := filepath.Join(t.TempDir(), "shm")
					if err := os.Rename(path+"-shm", outside); err != nil {
						t.Fatal(err)
					}
					if err := os.Symlink(outside, path+"-shm"); err != nil {
						t.Fatal(err)
					}
				case "wal-hardlink":
					if err := os.Link(path+"-wal", filepath.Join(t.TempDir(), "wal")); err != nil {
						t.Fatal(err)
					}
				}
			}
			before := snapshotDirectory(t, directory)
			store, err := Open(context.Background(), Options{Directory: directory})
			if store != nil {
				store.Close()
				t.Fatal("unsupported WAL accepted")
			}
			if !errors.Is(err, ErrUnsupported) {
				t.Fatal("unexpected rejection", err)
			}
			if !reflect.DeepEqual(before, snapshotDirectory(t, directory)) {
				t.Fatal("rejected original directory changed")
			}
		})
	}
}

func TestWALPreflightFailuresCleanScratchAndPreserveOriginal(t *testing.T) {
	for _, failure := range []string{"create", "copy", "cancel", "validate"} {
		t.Run(failure, func(t *testing.T) {
			directory, _ := walStoreFixture(t)
			temporary := t.TempDir()
			location := temporary
			if failure == "create" {
				location = filepath.Join(temporary, "missing")
			}
			t.Setenv("TMPDIR", location)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			injected := errors.New("synthetic preflight failure")
			options := Options{Directory: directory, fault: func(stage string) error {
				if failure == "copy" && stage == "wal-validation-copy" {
					return injected
				}
				if failure == "validate" && stage == "wal-validation-created" {
					return injected
				}
				if failure == "cancel" && stage == "wal-validation-copy" {
					cancel()
				}
				return nil
			}}
			before := snapshotDirectory(t, directory)
			store, err := Open(ctx, options)
			if store != nil {
				store.Close()
				t.Fatal("incomplete preflight accepted")
			}
			if err == nil {
				t.Fatal("preflight failure swallowed")
			}
			if failure == "cancel" && !errors.Is(err, context.Canceled) {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(before, snapshotDirectory(t, directory)) {
				t.Fatal("failed preflight changed original")
			}
			entries, err := os.ReadDir(temporary)
			if err != nil || len(entries) != 0 {
				t.Fatal("preflight leaked scratch", entries, err)
			}
		})
	}
}

func TestCoreStoreWALCrashChild(t *testing.T) {
	directory := os.Getenv("PIWORK_WAL_CRASH_CHILD")
	if directory == "" {
		return
	}
	store := openTestStore(t, directory)
	if err := store.Write(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec("INSERT INTO control_metadata(key,value_json,updated_at) VALUES('crash-committed','1','synthetic')")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	tx, err := store.writer.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec("INSERT INTO control_metadata(key,value_json,updated_at) VALUES('crash-uncommitted','2','synthetic')"); err != nil {
		t.Fatal(err)
	}
	fmt.Println("wal-crash-ready")
	_, _ = io.Copy(io.Discard, os.Stdin)
	tx.Rollback()
	store.Close()
}

func TestWALCrashRecoversCommittedTransactionsOnly(t *testing.T) {
	directory := t.TempDir()
	store := openTestStore(t, directory)
	id := store.InstallationID()
	store.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestCoreStoreWALCrashChild$")
	command.Env = append(os.Environ(), "PIWORK_WAL_CRASH_CHILD="+directory)
	input, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	output, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	command.Stderr = os.Stderr
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if command.ProcessState == nil {
			command.Process.Kill()
			command.Wait()
		}
	})
	line, err := bufio.NewReader(output).ReadString('\n')
	if err != nil || strings.TrimSpace(line) != "wal-crash-ready" {
		t.Fatal("child not ready", line, err)
	}
	if err := command.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = command.Wait()
	store = openTestStore(t, directory)
	defer store.Close()
	if store.InstallationID() != id {
		t.Fatal("crash changed installation identity")
	}
	if err := store.Read(context.Background(), func(tx *sql.Tx) error {
		var value string
		if err := tx.QueryRow("SELECT value_json FROM control_metadata WHERE key='crash-committed'").Scan(&value); err != nil {
			return err
		}
		if value != "1" {
			t.Fatal("committed data changed")
		}
		var count, version int
		if err := tx.QueryRow("SELECT count(*) FROM control_metadata WHERE key='crash-uncommitted'").Scan(&count); err != nil {
			return err
		}
		if err := tx.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
			return err
		}
		if count != 0 || version != SchemaVersion {
			t.Fatal("uncommitted data or wrong schema recovered", count, version)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestWALPreflightPreservesReadyMarker(t *testing.T) {
	directory, id := walStoreFixture(t)
	store := openTestStore(t, directory)
	defer store.Close()
	raw, err := os.ReadFile(filepath.Join(directory, MarkerName))
	if err != nil {
		t.Fatal(err)
	}
	var marker Marker
	if err := json.Unmarshal(raw, &marker); err != nil || marker.Phase != "ready" || marker.InstallationID != id || marker.SchemaVersion != 1 {
		t.Fatal(marker, err)
	}
}
