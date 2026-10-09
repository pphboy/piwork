//go:build linux

package workhistory

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func memoryFixture(t *testing.T) (string, Scope) {
	t.Helper()
	root := t.TempDir()
	private := filepath.Join(root, "private")
	if os.MkdirAll(filepath.Join(private, "sessions"), 0700) != nil {
		t.Fatal("mkdir")
	}
	if os.WriteFile(filepath.Join(private, "sessions", "one.jsonl"), []byte("{\"type\":\"session\"}\n"), 0600) != nil {
		t.Fatal("SDK fixture")
	}
	work, contextID, now := "work-memory-source-1111", "context-memory-source", "2026-10-08T00:00:00Z"
	db, err := database(filepath.Join(private, "work.sqlite"), false)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(query, args...); err != nil {
			t.Fatal(err, query)
		}
	}
	exec(currentSchemaSQL)
	exec("ATTACH DATABASE ? AS memory", filepath.Join(private, "memory.sqlite"))
	exec(strings.ReplaceAll(strings.ReplaceAll(memorySchemaSQL, "CREATE TABLE ", "CREATE TABLE memory."), "CREATE INDEX ", "CREATE INDEX memory."))
	exec("INSERT INTO schema_migrations VALUES(5,?)", now)
	exec("INSERT INTO work_memory_binding VALUES(?,'store-memory-source',1)", work)
	exec("INSERT INTO memory.memory_meta VALUES(1,1,?,'store-memory-source')", work)
	exec("INSERT INTO memory.memory_versions VALUES(0,?,0),(2,?,0)", now, now)
	exec("INSERT INTO memory.memory_head VALUES(1,2,?)", now)
	exec("INSERT INTO sessions(work_id,session_id,sdk_history_path,created_at,updated_at,active_context_identity) VALUES(?,?,?,?,?,?)", work, "session", "/var/data/sessions/one.jsonl", now, now, contextID)
	exec("INSERT INTO runs(work_id,session_id,run_id,submission_key,prompt_digest,state,accepted_at,finished_at,context_identity,adopted_memory_selection_json) VALUES(?,?,?,?,?,'succeeded',?,?,?,'{\"entryIds\":[],\"matchedCount\":0,\"truncated\":false}')", work, "session", "run", "submit", "digest", now, now, contextID)
	exec("INSERT INTO agent_requests(work_id,request_id,submission_key,request_digest,source_kind,source_run_id,goal,state,disposition,phase,expires_at,created_at,updated_at) VALUES(?,?,?,?,'chat','run','Remember verified result','completed','live','handling',?,?,?)", work, "request", "key", "digest", now, now, now)
	exec("INSERT INTO agent_request_runs VALUES('request','run','handling','live',?)", now)
	exec(`UPDATE runs SET source_json='{"kind":"chat","requestId":"request","phase":"handling"}'`)
	exec("INSERT INTO agent_evidence(work_id,evidence_id,request_id,run_id,kind,object_ref,observed_at,summary,verified,details_json) VALUES(?,'proof','request','run','query','summary',?,'Verified state',1,'{\"checks\":[{\"name\":\"state\",\"passed\":true}]}')", work, now)
	exec("INSERT INTO memory.memory_entries VALUES(2,'lesson','experience','work','Reusable verified knowledge','[\"proof\"]','request',?)", now)
	return private, Scope{SourceWorkID: work, ContextIDs: map[string]bool{contextID: true}, ScratchDirectory: root}
}

func TestSharedMemoryIntegrityCases(t *testing.T) {
	raw, err := os.ReadFile("testdata/memory-integrity-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name     string `json:"name"`
		Accepted bool   `json:"accepted"`
		SQL      string `json:"sql"`
		Setup    string `json:"setup"`
	}
	if json.Unmarshal(raw, &cases) != nil {
		t.Fatal("invalid cases")
	}
	seed, err := os.ReadFile("testdata/memory-integrity.sql")
	if err != nil {
		t.Fatal(err)
	}
	carry, err := os.ReadFile("testdata/memory-integrity-carry.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, scenario := range cases {
		t.Run(scenario.Name, func(t *testing.T) {
			root := t.TempDir()
			private := filepath.Join(root, "private")
			if os.MkdirAll(filepath.Join(private, "sessions"), 0700) != nil {
				t.Fatal("mkdir")
			}
			if os.WriteFile(filepath.Join(private, "sessions", "one.jsonl"), []byte("{\"type\":\"session\"}\n"), 0600) != nil {
				t.Fatal("SDK history")
			}
			db, err := database(filepath.Join(private, "work.sqlite"), false)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(currentSchemaSQL); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec("ATTACH DATABASE ? AS memory", filepath.Join(private, "memory.sqlite")); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(strings.ReplaceAll(strings.ReplaceAll(memorySchemaSQL, "CREATE TABLE ", "CREATE TABLE memory."), "CREATE INDEX ", "CREATE INDEX memory.")); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(string(seed)); err != nil {
				t.Fatal(err)
			}
			if scenario.Setup == "carry" {
				if _, err := db.Exec(string(carry)); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := db.Exec(scenario.SQL); err != nil {
				t.Fatal(err)
			}
			db.Close()
			before := fingerprint(t, private)
			snapshot, err := Open(context.Background(), private, Scope{SourceWorkID: "work-memory-source-1111", ContextIDs: map[string]bool{"context-memory-source": true}, ScratchDirectory: root})
			if snapshot != nil {
				snapshot.Close()
			}
			if (err == nil) != scenario.Accepted {
				t.Fatal("Go/TS fixture outcome differs", scenario.Name, err)
			}
			if !reflect.DeepEqual(before, fingerprint(t, private)) {
				t.Fatal("static validation changed input")
			}
		})
	}
}

func openMemoryFixture(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := database(filepath.Join(path, "work.sqlite"), false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("ATTACH DATABASE ? AS memory", filepath.Join(path, "memory.sqlite")); err != nil {
		db.Close()
		t.Fatal(err)
	}
	return db
}

func TestMemoryHistoryValidatesPairAndReadsOriginalEvidence(t *testing.T) {
	private, scope := memoryFixture(t)
	db := openMemoryFixture(t, private)
	for name, check := range map[string]func() error{"schema": func() error { return validateSchema(context.Background(), db) }, "memory": func() error { return validateMemoryHistory(context.Background(), db, scope) }, "brain": func() error { return validateBrainHistory(context.Background(), db, scope) }} {
		if err := check(); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	db.Close()
	snapshot, err := Open(context.Background(), private, scope)
	if err != nil {
		t.Fatal(err)
	}
	defer snapshot.Close()
	if snapshot.SchemaVersion != 5 || snapshot.Summary.Runs != 1 {
		t.Fatal(snapshot.SchemaVersion, snapshot.Summary)
	}
}

func TestMemoryHistoryRejectsBrokenPairSourceVersionsAndSchema(t *testing.T) {
	for _, query := range []string{
		"UPDATE memory.memory_meta SET work_id='other-work'",
		"DELETE FROM work_memory_binding",
		"UPDATE memory.memory_meta SET store_id='other-store'",
		"UPDATE memory.memory_entries SET source_request_id='missing'",
		"UPDATE memory.memory_entries SET evidence_ids_json='[\"missing\"]'",
		"UPDATE agent_requests SET state='failed'",
		"UPDATE runs SET adopted_memory_selection_json='{\"entryIds\":[\"missing\"],\"matchedCount\":1,\"truncated\":false}'",
		"UPDATE runs SET adopted_experience_version=99",
		"CREATE TABLE memory.extra(value TEXT)",
		"CREATE TRIGGER memory.extra AFTER INSERT ON memory_entries BEGIN DELETE FROM memory_head; END",
	} {
		t.Run(query, func(t *testing.T) {
			private, scope := memoryFixture(t)
			db := openMemoryFixture(t, private)
			if _, err := db.Exec(query); err != nil {
				db.Close()
				t.Fatal(err)
			}
			db.Close()
			if snapshot, err := Open(context.Background(), private, scope); err == nil {
				if snapshot != nil {
					snapshot.Close()
				}
				t.Fatal("accepted invalid Memory")
			}
		})
	}
}

func TestMemoryHistoryRebuildRemapsOnlyManagedOwnerAndStore(t *testing.T) {
	private, scope := memoryFixture(t)
	ctx := context.Background()
	snapshot, err := Open(ctx, private, scope)
	if err != nil {
		t.Fatal(err)
	}
	defer snapshot.Close()
	// A real import has already restored the private tree before managed rebinding.
	target := filepath.Join(t.TempDir(), "private")
	if os.MkdirAll(filepath.Join(target, "sessions"), 0700) != nil {
		t.Fatal("mkdir")
	}
	for _, name := range []string{"work.sqlite", "memory.sqlite", "sessions/one.jsonl"} {
		data, err := os.ReadFile(filepath.Join(private, name))
		if err != nil {
			t.Fatal(err)
		}
		if os.WriteFile(filepath.Join(target, name), data, 0600) != nil {
			t.Fatal("copy")
		}
	}
	work, contextID := "work-memory-target-2222", "context-memory-target"
	if err := snapshot.Rebuild(ctx, target, work, map[string]string{"context-memory-source": contextID}); err != nil {
		t.Fatal(err)
	}
	restored, err := Open(ctx, target, Scope{SourceWorkID: work, ContextIDs: map[string]bool{contextID: true}, ScratchDirectory: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	db := openMemoryFixture(t, target)
	defer db.Close()
	var owner, store, disposition string
	if db.QueryRow("SELECT work_id,store_id FROM memory.memory_meta").Scan(&owner, &store) != nil || owner != work || store == "store-memory-source" {
		t.Fatal(owner, store)
	}
	if db.QueryRow("SELECT disposition FROM agent_requests").Scan(&disposition) != nil || disposition != "historical" {
		t.Fatal(disposition)
	}
}
