//go:build integration

package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestNativeIndependentMemorySDKAdoptionRevisionInvalidationAndPackageSeparation(t *testing.T) {
	a, base, auth, work, _ := nativeApplyFixtureConfig(t, true)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	f := brainAcceptance{t: t, a: a, base: base, auth: auth, work: work, path: "/api/v1/works/" + work, ctx: ctx}
	var generation int64
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow("SELECT MAX(generation) FROM runtime_generations WHERE work_id=?", work).Scan(&generation)
	}); err != nil {
		t.Fatal(err)
	}
	digestProgram := `import {digestPiPackageTree} from '/workspace/packages/pi-package/dist/index.js';console.log(await digestPiPackageTree('/var/data/workspace/.pi/packages/piwork-brain'));`
	before := strings.TrimSpace(f.agentEval(digestProgram))
	learned := f.chat("remember deterministic preference Use dark theme", "memory-learn")
	if !strings.Contains(learned["finalText"].(string), "memory-effective:") {
		t.Fatal(learned)
	}
	if learned["adoptedExperienceVersion"] != float64(0) {
		t.Fatal("learning changed its accepted Memory snapshot", learned)
	}
	remembered := f.chat(`invoke package tool brain_experience with {"operation":"recall","query":"theme"}`, "memory-recall")
	if !strings.Contains(remembered["finalText"].(string), "Use dark theme") {
		t.Fatal(remembered)
	}
	f.control("stop", "memory-stop")
	f.control("start", "memory-start")
	f.session = ""
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow("SELECT MAX(generation) FROM runtime_generations WHERE work_id=?", work).Scan(&generation)
	}); err != nil {
		t.Fatal(err)
	}
	read := f.chat(`invoke package tool brain_experience with {"operation":"read","entryId":"ui-preference"}`, "memory-after-restart")
	if !strings.Contains(read["finalText"].(string), "Use dark theme") {
		t.Fatal(read)
	}
	changed := f.chat("revise deterministic preference Use light theme", "memory-revise")
	if !strings.Contains(changed["finalText"].(string), "memory-effective:") {
		t.Fatal(changed)
	}
	invalid := f.chat("invalidate deterministic preference", "memory-invalidate")
	if !strings.Contains(invalid["finalText"].(string), "memory-effective:") {
		t.Fatal(invalid)
	}
	after := f.chat(`invoke package tool brain_experience with {"operation":"read","entryId":"ui-preference"}`, "memory-invalid-read")
	if !strings.Contains(after["finalText"].(string), `"status":"invalidated"`) {
		t.Fatal(after)
	}
	if got := strings.TrimSpace(f.agentEval(digestProgram)); got != before {
		t.Fatal("Memory changed Brain package", before, got)
	}
	var applies, prepares int
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRow("SELECT COUNT(*) FROM operations WHERE work_id=? AND kind=?", work, applyOperationKind).Scan(&applies); err != nil {
			return err
		}
		return tx.QueryRow("SELECT COUNT(*) FROM operations WHERE work_id=? AND kind LIKE '%package%'", work).Scan(&prepares)
	}); err != nil {
		t.Fatal(err)
	}
	if applies != 0 || prepares != 0 {
		t.Fatal("cognition used software update", applies, prepares)
	}
	var latest int64
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow("SELECT MAX(generation) FROM runtime_generations WHERE work_id=?", work).Scan(&latest)
	}); err != nil {
		t.Fatal(err)
	}
	if latest != generation {
		t.Fatal("Memory caused an unrelated runtime replacement", generation, latest)
	}
	physical := f.agentEval(`import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync('/var/data/work.sqlite');d.prepare('ATTACH DATABASE ? AS memory').run('/var/data/memory.sqlite');console.log(JSON.stringify({version:d.prepare('SELECT version FROM schema_migrations').get(),mainTables:d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),head:d.prepare('SELECT * FROM memory.memory_head').get(),candidates:d.prepare('SELECT entry_id,status,operation,source_request_id,evidence_ids_json FROM memory.memory_candidates ORDER BY candidate_version').all()}));d.close();`)
	var actual map[string]any
	if json.Unmarshal([]byte(physical), &actual) != nil || strings.Contains(physical, "brain_experience_revisions") {
		t.Fatal("not independent physical Memory", physical)
	}
	t.Log("Actual SDK request/Run/Evidence and Memory receipts:", learned["runId"], remembered["runId"], changed["runId"], invalid["runId"])
	t.Log("Physical Memory schema and lifecycle:", actual)
	f.control("stop", "memory-export-stop")
	status, exported := packageHTTPCall(t, base, f.path+"/exports", "POST", auth, map[string]string{"idempotencyKey": "memory-only-export"})
	if status != 202 {
		t.Fatal(status, exported)
	}
	waitWorkOperation(t, ctx, a, exported["operationId"].(string))
}
