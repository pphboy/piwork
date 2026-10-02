package nativecheck_test

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/moby/moby/client"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"golang.org/x/crypto/argon2"
	"golang.org/x/sys/unix"
	"golang.org/x/term"
	_ "modernc.org/sqlite"
)

// This foundation gate compiles and exercises the selected runtime dependencies
// with CGO_ENABLED=0. It does not claim that Core or an Agent is implemented.
func TestPureGoDependencies(t *testing.T) {
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "native.sqlite")+"?_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.Exec("CREATE TABLE evidence (id TEXT PRIMARY KEY, value INTEGER NOT NULL)"); err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec("INSERT INTO evidence VALUES ('rolled-back', 1)"); err != nil {
		t.Fatal(err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM evidence").Scan(&count); err != nil || count != 0 {
		t.Fatalf("SQLite rollback failed: %d %v", count, err)
	}
	var enabled int
	if err := db.QueryRow("PRAGMA foreign_keys").Scan(&enabled); err != nil || enabled != 1 {
		t.Fatalf("SQLite foreign keys disabled: %d %v", enabled, err)
	}

	engine, err := client.NewClientWithOpts(client.WithHost("unix:///nonexistent/piwork-native-check.sock"), client.WithAPIVersionNegotiation())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = engine.Close() })
	if mcp.NewServer(&mcp.Implementation{Name: "native-dependency-check", Version: "1"}, nil) == nil {
		t.Fatal("MCP server construction failed")
	}
	if len(argon2.IDKey([]byte("fixture"), []byte("native-check-salt"), 1, 64, 1, 32)) != 32 {
		t.Fatal("Argon2 unavailable")
	}
	if unix.Getpid() <= 0 || term.IsTerminal(-1) {
		t.Fatal("Unix/terminal dependencies unavailable")
	}
}
