package corestore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"testing"
)

func queryRows(tx *sql.Tx, query string, args ...any) ([]map[string]any, error) {
	rows, err := tx.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0)
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		item := make(map[string]any)
		for i, name := range columns {
			item[name] = values[i]
		}
		result = append(result, item)
	}
	return result, rows.Err()
}
func sameJSON(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	var left, right any
	_ = json.Unmarshal(x, &left)
	_ = json.Unmarshal(y, &right)
	return reflect.DeepEqual(left, right)
}
func TestFinalSchemaMatchesTSConstraints(t *testing.T) {
	raw, err := os.ReadFile("testdata/ts-schema.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Objects []map[string]any
		Tables  []struct {
			Name        string
			Columns     []map[string]any
			ForeignKeys []map[string]any
			Indexes     []map[string]any
		}
		SeedMetadata []map[string]any
	}
	if json.Unmarshal(raw, &fixture) != nil {
		t.Fatal("invalid schema oracle")
	}
	store := openTestStore(t, t.TempDir())
	defer store.Close()
	if err := store.Read(context.Background(), func(tx *sql.Tx) error {
		objects, err := queryRows(tx, "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name != 'go_core_metadata' AND sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END,rowid")
		if err != nil {
			return err
		}
		if !sameJSON(objects, fixture.Objects) {
			return errors.New("final business schema changed")
		}
		for _, table := range fixture.Tables {
			columns, err := queryRows(tx, fmt.Sprintf("PRAGMA table_xinfo('%s')", table.Name))
			if err != nil {
				return err
			}
			foreignKeys, err := queryRows(tx, fmt.Sprintf("PRAGMA foreign_key_list('%s')", table.Name))
			if err != nil {
				return err
			}
			indexes, err := queryRows(tx, fmt.Sprintf("PRAGMA index_list('%s')", table.Name))
			if err != nil {
				return err
			}
			for _, index := range indexes {
				index["columns"], err = queryRows(tx, fmt.Sprintf("PRAGMA index_xinfo('%s')", index["name"]))
				if err != nil {
					return err
				}
			}
			if !sameJSON(columns, table.Columns) || !sameJSON(foreignKeys, table.ForeignKeys) || !sameJSON(indexes, table.Indexes) {
				return fmt.Errorf("table constraints changed: %s", table.Name)
			}
		}
		metadata, err := queryRows(tx, "SELECT key,value_json FROM control_metadata ORDER BY key")
		if err != nil {
			return err
		}
		if !sameJSON(metadata, fixture.SeedMetadata) {
			return errors.New("default storage metadata changed")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestRealSQLiteRollbackForeignKeysAndReopen(t *testing.T) {
	directory := t.TempDir()
	store := openTestStore(t, directory)
	ctx := context.Background()
	user := UserRecord{ID: "user-000000000001", Account: "owner", PasswordDigest: "digest-only", Role: "user", Enabled: true, CreatedAt: "2026-09-30T00:00:00Z", UpdatedAt: "2026-09-30T00:00:00Z"}
	rollback := errors.New("abort transaction")
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		if err := InsertUser(tx, user); err != nil {
			return err
		}
		return rollback
	}); !errors.Is(err, rollback) {
		t.Fatal(err)
	}
	if _, err := store.User(ctx, user.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("rollback leaked a user")
	}
	work := WorkRecord{ID: "work-000000000001", OwnerUserID: user.ID, Name: "中文工作单元", DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 1, ControlVersion: 1, CreatedAt: user.CreatedAt, UpdatedAt: user.UpdatedAt}
	if err := store.Write(ctx, func(tx *sql.Tx) error { return InsertWork(tx, work) }); err == nil {
		t.Fatal("foreign key bypassed")
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error { return InsertUser(tx, user) }); err != nil {
		t.Fatal(err)
	}
	duplicate := user
	duplicate.ID = "user-000000000002"
	if err := store.Write(ctx, func(tx *sql.Tx) error { return InsertUser(tx, duplicate) }); err == nil {
		t.Fatal("duplicate account accepted")
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		if err := InsertWork(tx, work); err != nil {
			return err
		}
		one := int64(1)
		two := int64(2)
		for _, version := range []struct {
			Revision int64
			JSON     string
			Context  string
		}{{1, `{"agentsMd":"旧内容","skills":[],"packages":[]}`, "context-00000001"}, {2, `{"agentsMd":"中文新内容","skills":["review"],"packages":[]}`, "context-00000002"}} {
			if err := InsertConfiguration(tx, ConfigurationRevision{WorkID: work.ID, Revision: version.Revision, ConfigJSON: version.JSON, CreatedByUserID: user.ID, CreatedAt: user.CreatedAt}); err != nil {
				return err
			}
			if err := InsertContext(tx, ContextSnapshot{SnapshotID: version.Context, WorkID: work.ID, InternalRevision: &version.Revision, ConfigurationJSON: version.JSON, ImageIdentity: "sha256:fixture", CreatedByUserID: user.ID, CreatedAt: user.CreatedAt}); err != nil {
				return err
			}
		}
		if _, err := tx.Exec("UPDATE works SET desired_revision=?,active_revision=?,desired_context_id=?,active_context_id=? WHERE id=?", two, one, "context-00000002", "context-00000001", work.ID); err != nil {
			return err
		}
		return InsertLoginSession(tx, LoginSessionRecord{ID: "session-000000001", UserID: user.ID, TokenDigest: "only-a-digest", ExpiresAt: "2026-10-01T00:00:00Z", CreatedAt: user.CreatedAt})
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store = openTestStore(t, directory)
	defer store.Close()
	gotUser, err := store.User(ctx, user.ID)
	if err != nil || !reflect.DeepEqual(gotUser, user) {
		t.Fatalf("user did not survive: %#v %v", gotUser, err)
	}
	gotWork, err := store.Work(ctx, work.ID, false)
	if err != nil || gotWork.Name != work.Name || gotWork.ControlVersion != 1 {
		t.Fatal(gotWork, err)
	}
	configuration, err := store.Configuration(ctx, work.ID)
	if err != nil || configuration.DesiredRevision != 2 || configuration.ActiveRevision == nil || *configuration.ActiveRevision != 1 || !configuration.PendingApply || configuration.DesiredContextID == nil || *configuration.DesiredContextID != "context-00000002" || configuration.ActiveContextID == nil || *configuration.ActiveContextID != "context-00000001" {
		t.Fatal(configuration, err)
	}
	if configuration.DesiredConfigJSON != `{"agentsMd":"中文新内容","skills":["review"],"packages":[]}` || configuration.ActiveConfigJSON == nil || *configuration.ActiveConfigJSON != `{"agentsMd":"旧内容","skills":[],"packages":[]}` {
		t.Fatal("desired/active bytes changed")
	}
	if err := store.Read(ctx, func(tx *sql.Tx) error {
		var digest string
		if err := tx.QueryRow("SELECT token_digest FROM login_sessions WHERE id=?", "session-000000001").Scan(&digest); err != nil {
			return err
		}
		if digest != "only-a-digest" {
			return errors.New("token digest changed")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
