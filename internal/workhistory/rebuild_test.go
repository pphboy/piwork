package workhistory

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestRebuildMapsManagedIdentityAndPreservesOpaqueContent(t *testing.T) {
	test := oracle(t)[0]
	root := t.TempDir()
	source := filepath.Join(root, "source")
	copyFixture(t, test.Name, source)
	business := []byte("unrecognized user SQLite contents must remain opaque\x00" + test.SourceWorkID)
	if err := os.WriteFile(filepath.Join(source, "business.sqlite"), business, 0600); err != nil {
		t.Fatal(err)
	}
	snapshot, err := Open(context.Background(), source, scopeFor(test, root))
	if err != nil || snapshot == nil {
		t.Fatal(err)
	}
	defer snapshot.Close()
	before := fingerprint(t, source)
	for _, work := range []string{"work-target-000000000001", "work-target-000000000002"} {
		target := filepath.Join(root, work)
		copyFixture(t, test.Name, target)
		os.WriteFile(filepath.Join(target, "business.sqlite"), business, 0600)
		contextID := "context-" + work
		if err := snapshot.Rebuild(context.Background(), target, work, map[string]string{test.ContextIDs[0]: contextID}); err != nil {
			t.Fatal(err)
		}
		for _, name := range files[1:] {
			if _, err := os.Stat(filepath.Join(target, name)); !os.IsNotExist(err) {
				t.Fatal("sidecar retained", name, err)
			}
		}
		db, err := database(filepath.Join(target, files[0]), true)
		if err != nil {
			t.Fatal(err)
		}
		var workID, contextIdentity, text string
		if err := db.QueryRow("SELECT work_id,context_identity,final_text FROM runs").Scan(&workID, &contextIdentity, &text); err != nil {
			t.Fatal(err)
		}
		if workID != work || contextIdentity != contextID || text != test.SourceWorkID+" "+test.ContextIDs[0] {
			t.Fatal("managed map or opaque text changed", workID, contextIdentity, text)
		}
		rows, err := db.Query("SELECT payload_json FROM run_events ORDER BY sequence")
		if err != nil {
			t.Fatal(err)
		}
		var payloads []string
		for rows.Next() {
			var payload string
			rows.Scan(&payload)
			payloads = append(payloads, payload)
		}
		rows.Close()
		db.Close()
		if len(payloads) != 2 {
			t.Fatal(payloads)
		}
		var value map[string]any
		json.Unmarshal([]byte(payloads[0]), &value)
		if value["workId"] != "user text "+test.SourceWorkID {
			t.Fatal("event payload identity rewritten", payloads)
		}
		if after := fingerprint(t, target); after["sessions/one.jsonl"] != before["sessions/one.jsonl"] || after["business.sqlite"] != before["business.sqlite"] {
			t.Fatal("opaque file bytes changed", after, before)
		}
		verified, err := Open(context.Background(), target, Scope{SourceWorkID: work, ContextIDs: map[string]bool{contextID: true}, ScratchDirectory: root})
		if err != nil || verified == nil {
			t.Fatal("rebuilt schema cannot be read", err)
		}
		if !reflect.DeepEqual(verified.Summary, snapshot.Summary) {
			t.Fatal(verified.Summary)
		}
		verified.Close()
	}
	if !reflect.DeepEqual(before, fingerprint(t, source)) {
		t.Fatal("source changed during rebuild")
	}
}
