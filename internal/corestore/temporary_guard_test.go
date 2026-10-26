package corestore

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
)

func TestTemporaryServiceGuardBeforeIncompatibleRecords(t *testing.T) {
	directory := t.TempDir()
	store := openTestStore(t, directory)
	var workers sync.WaitGroup
	failures := make(chan error, 12)
	for range 12 {
		workers.Add(1)
		go func() { defer workers.Done(); failures <- store.EnableTemporaryServiceStorage() }()
	}
	workers.Wait()
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal(err)
		}
	}
	if raw, err := os.ReadFile(filepath.Join(directory, temporaryServiceGuard)); err != nil || len(raw) != 0 {
		t.Fatal("guard was not safely published", err)
	}
	if err := store.Write(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?)`, temporaryServiceNamespace+"fixture", `{}`, "2026-01-01T00:00:00Z")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store = openTestStore(t, directory)
	if err := store.EnableTemporaryServiceStorage(); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(directory, temporaryServiceGuard)); err != nil {
		t.Fatal(err)
	}
	before := snapshotDirectory(t, directory)
	if store, err := Open(context.Background(), Options{Directory: directory}); !errors.Is(err, ErrUnsupported) {
		if store != nil {
			store.Close()
		}
		t.Fatalf("unguarded incompatible records were accepted: %v", err)
	}
	if !reflect.DeepEqual(before, snapshotDirectory(t, directory)) {
		t.Fatal("rejection changed the installation")
	}
}

func TestTemporaryServiceGuardRejectsUntrustedFiles(t *testing.T) {
	for _, unsafe := range []string{"nonempty", "symlink"} {
		t.Run(unsafe, func(t *testing.T) {
			directory := t.TempDir()
			store := openTestStore(t, directory)
			path := filepath.Join(directory, temporaryServiceGuard)
			if unsafe == "nonempty" {
				if err := os.WriteFile(path, []byte("unexpected"), 0600); err != nil {
					t.Fatal(err)
				}
			} else if err := os.Symlink(MarkerName, path); err != nil {
				t.Fatal(err)
			}
			if err := store.EnableTemporaryServiceStorage(); err == nil {
				t.Fatal("unsafe guard accepted")
			}
			if err := store.Close(); err != nil {
				t.Fatal(err)
			}
			before := snapshotDirectory(t, directory)
			if store, err := Open(context.Background(), Options{Directory: directory}); !errors.Is(err, ErrUnsupported) {
				if store != nil {
					store.Close()
				}
				t.Fatalf("unsafe guard accepted on open: %v", err)
			}
			if !reflect.DeepEqual(before, snapshotDirectory(t, directory)) {
				t.Fatal("rejection changed the installation")
			}
		})
	}
}
