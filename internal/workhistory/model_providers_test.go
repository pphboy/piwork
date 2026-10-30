//go:build linux

package workhistory

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestManagedModelHistoryAcceptsKnownPrivateDescriptorsOnly(t *testing.T) {
	model := map[string]any{"modelRef": "model-config-fixture-00001", "label": "Provider / Model", "provider": "openai", "model": "gpt-5.1", "api": "openai-responses", "baseUrl": "https://fixture.invalid/v1", "capabilities": map[string]any{"kind": "sdk", "provider": "openai", "model": "gpt-5.1"}, "executionBindingId": "model-execution-fixture-00001", "thinkingLevel": "high"}
	if !validHistoryModel(model) {
		t.Fatal("managed descriptor rejected")
	}
	for _, change := range []map[string]any{{"api": "openai-completions"}, {"provider": "anthropic"}, {"credential": "synthetic-must-not-persist"}, {"executionBindingId": "../secret"}, {"capabilities": map[string]any{"kind": "explicit", "defaultThinking": "high"}}} {
		copy := map[string]any{}
		for k, v := range model {
			copy[k] = v
		}
		for k, v := range change {
			copy[k] = v
		}
		if validHistoryModel(copy) {
			t.Fatal("invalid private model field admitted")
		}
	}
}

func TestCompatibleProfileSurvivesManagedRebinding(t *testing.T) {
	private, scope := memoryFixture(t)
	db, err := database(filepath.Join(private, "work.sqlite"), false)
	if err != nil {
		t.Fatal(err)
	}
	const pref = `{"modelRef":"model-source-12345678","label":"Alias","provider":"openai","model":"future-model","api":"openai-responses","baseUrl":"https://fixture.invalid/v1","thinkingLevel":"high","thinkingProfile":"responses-effort-v1","availability":"available"}`
	if _, err := db.Exec(schemaV6SQL[strings.Index(schemaV6SQL, "CREATE TABLE run_output_chunks"):] + "; UPDATE schema_migrations SET version=6; UPDATE sessions SET model_preference_json='" + pref + "'"); err != nil {
		t.Fatal(err)
	}
	db.Close()
	snapshot, err := Open(context.Background(), private, scope)
	if err != nil {
		t.Fatal(err)
	}
	defer snapshot.Close()
	for _, ambiguous := range []bool{false, true} {
		target := filepath.Join(t.TempDir(), "private")
		if err := os.MkdirAll(filepath.Join(target, "sessions"), 0700); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"work.sqlite", "memory.sqlite", "sessions/one.jsonl"} {
			data, err := os.ReadFile(filepath.Join(private, name))
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(target, name), data, 0600); err != nil {
				t.Fatal(err)
			}
		}
		candidate := map[string]any{"modelRef": "model-target-12345678", "label": "Target", "provider": "openai", "model": "future-model", "api": "openai-responses", "baseUrl": "https://fixture.invalid/v1"}
		models := []map[string]any{candidate}
		if ambiguous {
			models = append(models, map[string]any{"modelRef": "model-target-87654321", "label": "Other", "provider": "openai", "model": "future-model", "api": "openai-responses", "baseUrl": "https://fixture.invalid/v1"})
		}
		work, contextID := "work-memory-target-2222", "context-memory-target"
		if err := snapshot.Rebuild(context.Background(), target, work, map[string]string{"context-memory-source": contextID}, RestoreBindings{Models: models}); err != nil {
			t.Fatal(err)
		}
		result, err := database(filepath.Join(target, "work.sqlite"), true)
		if err != nil {
			t.Fatal(err)
		}
		var raw string
		if err := result.QueryRow("SELECT model_preference_json FROM sessions").Scan(&raw); err != nil {
			t.Fatal(err)
		}
		result.Close()
		var got map[string]any
		if err := json.Unmarshal([]byte(raw), &got); err != nil {
			t.Fatal(err)
		}
		want := "available"
		if ambiguous {
			want = "unavailable"
		}
		if got["thinkingProfile"] != "responses-effort-v1" || got["thinkingLevel"] != "high" || got["availability"] != want {
			t.Fatal(got)
		}
	}
}

func TestCompatibleHistoryRejectsWrongProtocolAndLevel(t *testing.T) {
	base := map[string]any{"modelRef": nil, "label": "Alias", "provider": "openai", "model": "future", "api": "openai-responses", "thinkingLevel": "high", "thinkingProfile": "responses-effort-v1"}
	if !validHistoryModel(base) {
		t.Fatal("valid compatible descriptor rejected")
	}
	for _, change := range []map[string]any{{"thinkingProfile": "messages-adaptive-v1"}, {"thinkingProfile": "unknown-profile"}, {"thinkingLevel": nil}, {"thinkingLevel": "unknown-level"}} {
		candidate := map[string]any{}
		for k, v := range base {
			candidate[k] = v
		}
		for k, v := range change {
			candidate[k] = v
		}
		if validHistoryModel(candidate) {
			t.Fatalf("invalid compatible descriptor accepted: %v", change)
		}
	}
}

func TestCompatibleProfileRequiresHistoryVersionSix(t *testing.T) {
	private, scope := memoryFixture(t)
	db, err := database(filepath.Join(private, "work.sqlite"), false)
	if err != nil {
		t.Fatal(err)
	}
	const pref = `{"modelRef":null,"label":"Alias","provider":"openai","model":"future-model","api":"openai-responses","thinkingLevel":"high","thinkingProfile":"responses-effort-v1","availability":"available"}`
	if _, err := db.Exec("UPDATE sessions SET model_preference_json=?", pref); err != nil {
		t.Fatal(err)
	}
	db.Close()
	if s, err := Open(context.Background(), private, scope); err == nil {
		s.Close()
		t.Fatal("schema 5 accepted version 6 profile")
	}
	db, err = database(filepath.Join(private, "work.sqlite"), false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(schemaV6SQL[strings.Index(schemaV6SQL, "CREATE TABLE run_output_chunks"):] + "; UPDATE schema_migrations SET version=6"); err != nil {
		t.Fatal(err)
	}
	db.Close()
	snapshot, err := Open(context.Background(), private, scope)
	if err != nil {
		t.Fatal(err)
	}
	defer snapshot.Close()
	if snapshot.SchemaVersion != 6 {
		t.Fatal(snapshot.SchemaVersion)
	}
}
