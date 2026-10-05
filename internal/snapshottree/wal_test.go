package snapshottree

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestTreePreservesCommittedWALAndIndependentRestores(t *testing.T) {
	source, target, blobs := fixture(t)
	ctx := context.Background()
	open := func(root string) *sql.DB {
		t.Helper()
		db, err := sql.Open("sqlite", filepath.Join(root, "retained.sqlite"))
		if err != nil {
			t.Fatal(err)
		}
		db.SetMaxOpenConns(1)
		t.Cleanup(func() { db.Close() })
		return db
	}
	original := open(source)
	if _, err := original.Exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE retained(value TEXT); INSERT INTO retained VALUES('committed in WAL')`); err != nil {
		t.Fatal(err)
	}
	wal, err := os.Stat(filepath.Join(source, "retained.sqlite-wal"))
	if err != nil || wal.Size() <= 32 {
		t.Fatal("fixture must retain committed WAL frames", err)
	}
	// The fixture has no open transaction or other writer. Keep its idle
	// connection open to prevent SQLite's close-time checkpoint from hiding WAL.
	captured, err := Capture(ctx, source, blobs)
	if err != nil {
		t.Fatal(err)
	}
	second := filepath.Join(filepath.Dir(target), "second")
	if err := os.Mkdir(second, 0700); err != nil {
		t.Fatal(err)
	}
	for _, root := range []string{target, second} {
		if _, err := Restore(ctx, root, blobs, captured.Tree, false); err != nil {
			t.Fatal(err)
		}
		bytes, err := os.ReadFile(filepath.Join(root, "retained.sqlite-wal"))
		originalBytes, sourceErr := os.ReadFile(filepath.Join(source, "retained.sqlite-wal"))
		if err != nil || sourceErr != nil || string(bytes) != string(originalBytes) {
			t.Fatal("committed WAL bytes omitted or changed", err, sourceErr)
		}
	}
	firstDB, secondDB := open(target), open(second)
	read := func(db *sql.DB) string {
		t.Helper()
		var value string
		if err := db.QueryRow(`SELECT value FROM retained`).Scan(&value); err != nil {
			t.Fatal("committed WAL record not restored", err)
		}
		return value
	}
	if read(firstDB) != "committed in WAL" || read(secondDB) != "committed in WAL" {
		t.Fatal("restored logical records differ")
	}
	if _, err := firstDB.Exec(`UPDATE retained SET value='first copy only'`); err != nil {
		t.Fatal(err)
	}
	if read(secondDB) != "committed in WAL" || read(original) != "committed in WAL" {
		t.Fatal("changing one restored database affected another tree")
	}
}
