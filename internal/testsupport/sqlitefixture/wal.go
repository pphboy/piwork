// Package sqlitefixture provides synthetic SQLite data and cross-process locks
// for storage tests. Production commands must not import it.
package sqlitefixture

import (
	"bufio"
	"context"
	"database/sql"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

const childVariable = "PIWORK_SQLITE_FIXTURE_READER"

// ReaderChild is called by TestSQLiteReaderChild in each consuming test binary.
func ReaderChild(t *testing.T) {
	filename := os.Getenv(childVariable)
	if filename == "" {
		return
	}
	db := Open(t, filename, true, false)
	defer db.Close()
	tx, err := db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	var n int
	if err := tx.QueryRow("SELECT count(*) FROM control_metadata").Scan(&n); err != nil {
		t.Fatal(err)
	}
	fmt.Println("sqlite-reader-ready")
	_, _ = io.Copy(io.Discard, os.Stdin)
}

func Open(t *testing.T, filename string, readonly, immutable bool) *sql.DB {
	t.Helper()
	query := url.Values{"mode": {"rw"}, "_pragma": {"busy_timeout(50)"}}
	if readonly {
		query.Set("mode", "ro")
	}
	if immutable {
		query.Set("immutable", "1")
	}
	db, err := sql.Open("sqlite", (&url.URL{Scheme: "file", Path: filename, RawQuery: query.Encode()}).String())
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// HoldReader returns only once the child has acquired a real SQLite snapshot.
// Never inspect files from inside this child: closing any fd for the same inode
// would release that process's POSIX locks and invalidate the test.
func HoldReader(t *testing.T, filename string) func() {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestSQLiteReaderChild$")
	command.Env = append(os.Environ(), childVariable+"="+filename)
	input, err := command.StdinPipe()
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	output, err := command.StdoutPipe()
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	command.Stderr = os.Stderr
	if err := command.Start(); err != nil {
		cancel()
		t.Fatal(err)
	}
	var once sync.Once
	release := func() {
		once.Do(func() {
			_ = input.Close()
			if err := command.Wait(); err != nil && !t.Failed() {
				t.Errorf("SQLite reader child failed: %v", err)
			}
			cancel()
		})
	}
	t.Cleanup(release)
	line, err := bufio.NewReader(output).ReadString('\n')
	if err != nil || strings.TrimSpace(line) != "sqlite-reader-ready" {
		cancel()
		t.Fatalf("SQLite reader did not acquire snapshot: %q %v", line, err)
	}
	return release
}

func Value(index int) string {
	return `{"fixture":"` + strings.Repeat("y", 180+index%13*30) + `"}`
}

// PartialWAL adds synthetic rows to an initialized Core database. A separate
// read process prevents complete backfill while newer commits extend the WAL.
func PartialWAL(t *testing.T, filename string) func() {
	t.Helper()
	db := Open(t, filename, false, false)
	Exec(t, db, "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0")
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	for index := range 512 {
		if _, err := tx.Exec("INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?)", fmt.Sprintf("wal-fixture-%05d", index), `{"fixture":"`+strings.Repeat("x", 160+index%11*50)+`"}`, "2026-10-22T00:00:00Z"); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if row := Checkpoint(t, db, "TRUNCATE"); row != [3]int{} {
		t.Fatal("initial fixture checkpoint", row)
	}
	Exec(t, db, "DELETE FROM control_metadata WHERE key LIKE 'wal-fixture-%' AND CAST(substr(key,13) AS INTEGER)%2=0")
	release := HoldReader(t, filename)
	tx, err = db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	for index := 512; index < 1000; index++ {
		if _, err := tx.Exec("INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?)", fmt.Sprintf("wal-fixture-%05d", index), Value(index), "2026-10-22T00:00:01Z"); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	row := Checkpoint(t, db, "PASSIVE")
	if row[1] <= row[2] || row[2] == 0 {
		t.Fatal("fixture did not leave a partially backfilled WAL", row)
	}
	row = Checkpoint(t, db, "TRUNCATE")
	if row[0] != 1 || row[1] <= row[2] {
		t.Fatal("external reader did not block checkpoint", row)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	return release
}

func Exec(t *testing.T, db *sql.DB, statement string, args ...any) {
	t.Helper()
	if _, err := db.Exec(statement, args...); err != nil {
		t.Fatal(err)
	}
}

func Checkpoint(t *testing.T, db *sql.DB, mode string) [3]int {
	t.Helper()
	var result [3]int
	if mode != "TRUNCATE" && mode != "PASSIVE" {
		t.Fatal("invalid fixture checkpoint mode")
	}
	if err := db.QueryRow("PRAGMA wal_checkpoint("+mode+")").Scan(&result[0], &result[1], &result[2]); err != nil {
		t.Fatal(err)
	}
	return result
}

func QuickCheck(t *testing.T, filename string, immutable bool) string {
	t.Helper()
	db := Open(t, filename, true, immutable)
	defer db.Close()
	var value string
	if err := db.QueryRow("PRAGMA quick_check").Scan(&value); err != nil {
		return err.Error()
	}
	return value
}
