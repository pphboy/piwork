//go:build linux

package workhistory

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestSharedImageInputColdHistory(t *testing.T) {
	raw, err := os.ReadFile("../../fixtures/chat-images/history-validation.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name             string
		Input            json.RawMessage
		PromptDigest     string
		Valid            bool
		MemoryPreference bool
		BadEvidence      bool
	}
	if json.Unmarshal(raw, &cases) != nil {
		t.Fatal("invalid fixture")
	}
	for _, scenario := range cases {
		t.Run(scenario.Name, func(t *testing.T) {
			private, scope := memoryFixture(t)
			db, err := database(filepath.Join(private, "work.sqlite"), false)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec("UPDATE runs SET prompt_digest=?,latest_sequence=1 WHERE run_id='run'", scenario.PromptDigest); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec("INSERT INTO run_events VALUES('run',1,'run.input',?,'2026-10-08T00:00:00Z')", string(scenario.Input)); err != nil {
				t.Fatal(err)
			}
			db.Close()
			if scenario.MemoryPreference {
				db, err = database(filepath.Join(private, "work.sqlite"), false)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := db.Exec("ATTACH DATABASE ? AS memory", filepath.Join(private, "memory.sqlite")); err != nil {
					t.Fatal(err)
				}
				proofDigest := scenario.PromptDigest
				if scenario.BadEvidence {
					proofDigest = "wrong"
				}
				details, _ := json.Marshal(map[string]any{"userPreferenceVerified": true, "promptDigest": proofDigest})
				if _, err := db.Exec("UPDATE agent_evidence SET kind='sdk',details_json=? WHERE evidence_id='proof'", string(details)); err != nil {
					t.Fatal(err)
				}
				if _, err := db.Exec("UPDATE memory.memory_entries SET kind='preference'"); err != nil {
					t.Fatal(err)
				}
				db.Close()
			}
			snapshot, err := Open(context.Background(), private, scope)
			if snapshot != nil {
				snapshot.Close()
			}
			if (err == nil) != scenario.Valid {
				t.Fatalf("valid=%v: %v", scenario.Valid, err)
			}
		})
	}
}
