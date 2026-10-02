package corestore

import (
	"bufio"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"piwork/internal/safefs"
)

func openTestStore(t *testing.T, directory string) *Store {
	t.Helper()
	store, err := Open(context.Background(), Options{Directory: directory})
	if err != nil {
		t.Fatal(err)
	}
	return store
}
func TestFreshStoreAndSameFormatReopen(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "new")
	store := openTestStore(t, directory)
	id := store.InstallationID()
	if !identityPattern.MatchString(id) {
		t.Fatal("invalid installation identity")
	}
	if err := store.Read(context.Background(), func(tx *sql.Tx) error {
		var users, works int
		if err := tx.QueryRow("SELECT count(*) FROM users").Scan(&users); err != nil {
			return err
		}
		if err := tx.QueryRow("SELECT count(*) FROM works").Scan(&works); err != nil {
			return err
		}
		if users != 0 || works != 0 {
			return errors.New("fresh store unexpectedly contains business resources")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(directory, MarkerName))
	if err != nil {
		t.Fatal(err)
	}
	var marker Marker
	if json.Unmarshal(raw, &marker) != nil || marker.Format != Format || marker.SchemaVersion != 1 || marker.Phase != "ready" || marker.InstallationID != id {
		t.Fatal("marker not published", marker)
	}
	store = openTestStore(t, directory)
	defer store.Close()
	if store.InstallationID() != id {
		t.Fatal("installation identity changed")
	}
}

func snapshotDirectory(t *testing.T, root string) map[string]string {
	t.Helper()
	result := make(map[string]string)
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		name, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		value := fmt.Sprintf("%v:%d", info.Mode(), info.Size())
		if entry.Type()&os.ModeSymlink != 0 {
			link, err := os.Readlink(path)
			if err != nil {
				return err
			}
			value += ":" + link
		} else if !entry.IsDir() {
			raw, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			hash := sha256.Sum256(raw)
			value += ":" + hex.EncodeToString(hash[:])
		}
		result[name] = value
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return result
}
func TestUnsupportedDirectoriesRemainUnchanged(t *testing.T) {
	for _, fixture := range []string{"old-ts", "unknown-version", "corrupt-marker", "duplicate-key", "unknown-field", "unmarked-db", "foreign-db", "missing-db", "unexpected-init-file"} {
		t.Run(fixture, func(t *testing.T) {
			directory := t.TempDir()
			marker := Marker{Format: Format, SchemaVersion: 1, InstallationID: "installation-0000000000000001", Phase: "ready"}
			switch fixture {
			case "old-ts":
				if err := os.WriteFile(filepath.Join(directory, DatabaseName), []byte("old TS database"), 0600); err != nil {
					t.Fatal(err)
				}
			case "unmarked-db":
				if err := os.WriteFile(filepath.Join(directory, DatabaseName), []byte("unrecognized database"), 0600); err != nil {
					t.Fatal(err)
				}
			case "foreign-db":
				db, err := sql.Open("sqlite", filepath.Join(directory, DatabaseName))
				if err != nil {
					t.Fatal(err)
				}
				if _, err := db.Exec("CREATE TABLE schema_migrations(version INTEGER)"); err != nil {
					t.Fatal(err)
				}
				db.Close()
				os.Chmod(filepath.Join(directory, DatabaseName), 0600)
			case "unknown-version":
				marker.SchemaVersion = 99
			case "unexpected-init-file":
				marker.Phase = "initializing"
				os.WriteFile(filepath.Join(directory, "user-data"), []byte("do not remove"), 0600)
			}
			if fixture != "old-ts" && fixture != "unmarked-db" {
				raw, _ := json.Marshal(marker)
				if fixture == "corrupt-marker" {
					raw = []byte("not a marker")
				}
				if fixture == "duplicate-key" {
					raw = []byte(`{"format":"piwork-go-core","format":"piwork-go-core","schemaVersion":1,"installationId":"installation-0000000000000001","phase":"ready"}`)
				}
				if fixture == "unknown-field" {
					raw = append(raw[:len(raw)-1], []byte(`,"extra":true}`)...)
				}
				if err := os.WriteFile(filepath.Join(directory, MarkerName), raw, 0600); err != nil {
					t.Fatal(err)
				}
			}
			before := snapshotDirectory(t, directory)
			if store, err := Open(context.Background(), Options{Directory: directory}); err == nil {
				store.Close()
				t.Fatal("unsupported directory accepted")
			}
			if !reflect.DeepEqual(before, snapshotDirectory(t, directory)) {
				t.Fatal("rejected directory was modified")
			}
		})
	}
}

func TestInitializationInterruptionsRecoverOnlyRegisteredFiles(t *testing.T) {
	for _, point := range []string{"before-marker", "after-marker", "after-database-file", "before-database-commit", "after-database-commit", "after-database-publish", "after-marker-publish"} {
		t.Run(point, func(t *testing.T) {
			directory := t.TempDir()
			interrupted := errors.New("injected interruption")
			_, err := Open(context.Background(), Options{Directory: directory, fault: func(stage string) error {
				if stage == point {
					return interrupted
				}
				return nil
			}})
			if !errors.Is(err, interrupted) {
				t.Fatalf("fault not reached: %v", err)
			}
			if point == "before-marker" {
				entries, _ := os.ReadDir(directory)
				if len(entries) != 0 {
					t.Fatal("business files precede marker")
				}
			}
			store := openTestStore(t, directory)
			defer store.Close()
			if err := store.Read(context.Background(), func(tx *sql.Tx) error {
				var count int
				if err := tx.QueryRow("SELECT count(*) FROM go_core_metadata").Scan(&count); err != nil {
					return err
				}
				if count != 1 {
					return errors.New("initialization duplicated identity")
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestOSLockRejectsSecondProcessAndReleasesAfterCrash(t *testing.T) {
	directory := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestStoreLockChild$")
	command.Env = append(os.Environ(), "PIWORK_GO_LOCK_CHILD="+directory)
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if command.ProcessState == nil {
			command.Process.Kill()
			command.Wait()
		}
	}()
	line, err := bufio.NewReader(stdout).ReadString('\n')
	if err != nil || strings.TrimSpace(line) != "locked" {
		t.Fatalf("lock child failed: %q %v", line, err)
	}
	before := snapshotDirectory(t, directory)
	if _, err := Open(context.Background(), Options{Directory: directory}); !errors.Is(err, safefs.ErrLocked) {
		t.Fatalf("second owner not rejected: %v", err)
	}
	if !reflect.DeepEqual(before, snapshotDirectory(t, directory)) {
		t.Fatal("second process wrote store")
	}
	if err := command.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = command.Wait()
	store := openTestStore(t, directory)
	defer store.Close()
}
func TestStoreLockChild(t *testing.T) {
	if directory := os.Getenv("PIWORK_GO_LOCK_CHILD"); directory != "" {
		store := openTestStore(t, directory)
		defer store.Close()
		fmt.Println("locked")
		for {
			time.Sleep(time.Second)
		}
	}
}

func TestManagedSymlinksAndHardlinksAreRejected(t *testing.T) {
	for _, target := range []string{"root", MarkerName, DatabaseName, "runtime"} {
		t.Run(target, func(t *testing.T) {
			parent := t.TempDir()
			directory := filepath.Join(parent, "store")
			store := openTestStore(t, directory)
			store.Close()
			if target == "root" {
				link := filepath.Join(parent, "link")
				if err := os.Symlink(directory, link); err != nil {
					t.Fatal(err)
				}
				directory = link
			} else {
				original := filepath.Join(directory, target)
				moved := filepath.Join(parent, "preserved")
				if err := os.Rename(original, moved); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(moved, original); err != nil {
					t.Fatal(err)
				}
			}
			if opened, err := Open(context.Background(), Options{Directory: directory}); err == nil {
				opened.Close()
				t.Fatal("managed symlink accepted")
			}
		})
	}
	directory := t.TempDir()
	store := openTestStore(t, directory)
	store.Close()
	if err := os.Link(filepath.Join(directory, DatabaseName), filepath.Join(t.TempDir(), "outside")); err != nil {
		t.Fatal(err)
	}
	if opened, err := Open(context.Background(), Options{Directory: directory}); err == nil {
		opened.Close()
		t.Fatal("database hardlink accepted")
	}
}

func TestCorruptOrMismatchedGoDatabaseRejectedWithoutWrites(t *testing.T) {
	for _, fixture := range []string{"identity", "version", "missing-table", "trigger", "corrupt"} {
		t.Run(fixture, func(t *testing.T) {
			directory := t.TempDir()
			store := openTestStore(t, directory)
			if err := store.Close(); err != nil {
				t.Fatal(err)
			}
			if fixture == "corrupt" {
				if err := os.WriteFile(filepath.Join(directory, DatabaseName), []byte("corrupt SQLite"), 0600); err != nil {
					t.Fatal(err)
				}
			} else {
				db, err := sql.Open("sqlite", filepath.Join(directory, DatabaseName))
				if err != nil {
					t.Fatal(err)
				}
				statement := map[string]string{"identity": "UPDATE go_core_metadata SET installation_id='installation-foreign-00000001'", "version": "PRAGMA user_version=99", "missing-table": "DROP TABLE users", "trigger": "CREATE TRIGGER hostile AFTER INSERT ON users BEGIN DELETE FROM works; END"}[fixture]
				if _, err := db.Exec(statement); err != nil {
					t.Fatal(err)
				}
				if err := db.Close(); err != nil {
					t.Fatal(err)
				}
			}
			before := snapshotDirectory(t, directory)
			if opened, err := Open(context.Background(), Options{Directory: directory}); !errors.Is(err, ErrUnsupported) {
				if opened != nil {
					opened.Close()
				}
				t.Fatalf("mismatched Go database accepted: %v", err)
			}
			if !reflect.DeepEqual(before, snapshotDirectory(t, directory)) {
				t.Fatal("rejected Go database was modified")
			}
		})
	}
}
