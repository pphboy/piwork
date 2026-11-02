//go:build integration

package coreapp

import (
	"context"
	"encoding/json"
	"testing"
)

// Read the selected immutable image's validated capability, not a historical
// fixture's hard-coded version or the database value we are checking.
func nativeImageHistorySchema(t *testing.T, ctx context.Context, a *Application, reference string) int {
	t.Helper()
	image, err := a.engine.InspectImage(ctx, reference)
	if err != nil {
		t.Fatal(err)
	}
	capabilities, err := a.inspector.InspectNativeAgent(ctx, image.ID)
	if err != nil || capabilities.WorkHistorySchema < 1 {
		t.Fatal("image history capability", err)
	}
	return int(capabilities.WorkHistorySchema)
}

// Terminal rows include the accepted context, result and submission key. Keep
// every old row byte-equivalent when a manual Session continues after Apply.
func nativeSessionRunFacts(t *testing.T, ctx context.Context, a *Application, workID, session string) map[string]json.RawMessage {
	t.Helper()
	program := `import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync('/var/data/work.sqlite',{readOnly:true});console.log(JSON.stringify(Object.fromEntries(d.prepare('SELECT * FROM runs WHERE work_id=? AND session_id=? ORDER BY run_id').all(` + stringMustJSON(workID) + `,` + stringMustJSON(session) + `).map(r=>[r.run_id,r]))));d.close();`
	var rows map[string]json.RawMessage
	if err := json.Unmarshal([]byte(nativeAgentEval(t, ctx, a, workID, program)), &rows); err != nil {
		t.Fatal(err)
	}
	return rows
}

func assertNativeSessionContinued(t *testing.T, ctx context.Context, a *Application, workID, session, newRun string, before map[string]json.RawMessage) {
	t.Helper()
	after := nativeSessionRunFacts(t, ctx, a, workID, session)
	if len(after) != len(before)+1 {
		t.Fatal("continuation did not create exactly one Run", len(before), len(after))
	}
	for id, row := range before {
		if string(after[id]) != string(row) {
			t.Fatal("continuation rewrote a historical Run", id)
		}
	}
	var row struct {
		Context string `json:"context_identity"`
	}
	if err := json.Unmarshal(after[newRun], &row); err != nil {
		t.Fatal(err)
	}
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil || work.ActiveContextID == nil || row.Context != *work.ActiveContextID {
		t.Fatal("new Run did not capture current active context", err)
	}
	for _, old := range before {
		var prior struct {
			Context string `json:"context_identity"`
		}
		if err := json.Unmarshal(old, &prior); err != nil {
			t.Fatal(err)
		}
		if prior.Context == row.Context {
			t.Fatal("fixture did not change accepted context across Apply")
		}
	}
}
