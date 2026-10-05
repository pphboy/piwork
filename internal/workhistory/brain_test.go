package workhistory

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"piwork/internal/contracts"
)

func brainFixture(t *testing.T) (string, Scope) {
	t.Helper()
	test := historyCases(t)[0]
	root := t.TempDir()
	private := filepath.Join(root, "private")
	copyFixture(t, test.Name, private)
	db, err := database(filepath.Join(private, files[0]), false)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	work := test.SourceWorkID
	service := "service-source-000000001"
	now := "2026-10-03T00:00:00.000Z"
	event := map[string]any{"contractVersion": int64(1), "eventId": "service-event-1", "origin": map[string]any{"workId": work, "serviceId": service}, "serviceName": "todo", "type": "agent.requested", "occurredAt": now, "stateVersion": "v1", "payload": map[string]any{"reason": "review", "goal": "Verify review", "evidenceRefs": []any{}}}
	raw, err := contracts.EncodeCanonicalJSON(event)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec("BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON")
	exec("INSERT INTO service_events VALUES(?,?,?,?,?,?,'live',?,?)", work, "event-pk", service, "service-event-1", hex.EncodeToString(sum[:]), string(raw), "request-1", now)
	exec(`INSERT INTO agent_requests(work_id,request_id,submission_key,request_digest,source_kind,service_name,source_service_id,source_event_pk,goal,state,disposition,phase,expires_at,created_at,updated_at) VALUES(?,'request-1','event-key','digest','service','todo',?,'event-pk','Verify review','completed','live','verifying','2026-10-04T00:00:00Z',?,?)`, work, service, now, now)
	exec(`INSERT INTO agent_request_runs VALUES('request-1','run-local','verifying','live',?)`, now)
	exec(`UPDATE runs SET source_json='{"kind":"service","requestId":"request-1","serviceName":"todo","phase":"verifying"}',model_selector_json='{"kind":"work-default"}',actual_model_json='{"modelRef":null,"label":"Default","provider":"fixture","model":"local"}',adopted_experience_version=1`)
	exec(`INSERT INTO agent_evidence(work_id,evidence_id,request_id,run_id,service_name,kind,object_ref,observed_at,state_version,code_version,summary,verified,details_json) VALUES(?,'evidence-1','request-1','run-local','todo','query','review',?,'v1','c1','Actual review checked',1,'{"checks":[{"name":"review","passed":true}]}')`, work, now)
	exec(`INSERT INTO brain_experience_revisions VALUES(?,1,'review','work','Prefer completed tasks first','["evidence-1"]','request-1','effective',?)`, work, now)
	exec("INSERT INTO brain_experience_heads VALUES(?,1,?)", work, now)
	exec("COMMIT")
	return private, scopeFor(test, root)
}
func TestCurrentThirteenTableFeedbackGraph(t *testing.T) {
	private, scope := brainFixture(t)
	before := fingerprint(t, private)
	snapshot, err := Open(context.Background(), private, scope)
	if err != nil || snapshot == nil {
		t.Fatal(err)
	}
	snapshot.Close()
	db, err := database(filepath.Join(private, files[0]), true)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var n int
	if err := db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table'").Scan(&n); err != nil || n != 13 {
		t.Fatal(n, err)
	}
	if !reflect.DeepEqual(before, fingerprint(t, private)) {
		t.Fatal("current validation changed source bytes")
	}
}
func TestCurrentFeedbackGraphRejectsScopeAndProofTampering(t *testing.T) {
	for _, mutation := range []string{
		"UPDATE agent_evidence SET verified=0",
		"UPDATE agent_evidence SET request_id=NULL",
		"UPDATE agent_requests SET state='failed'",
		"UPDATE runs SET source_json='{}'",
		"UPDATE service_events SET source_service_id='another-service'",
		"UPDATE service_events SET event_digest='forged'",
		"UPDATE brain_experience_heads SET version=2",
		"UPDATE brain_experience_revisions SET evidence_ids_json='[\"missing\"]'",
		"UPDATE runs SET adopted_experience_version=2",
		"UPDATE runs SET actual_model_json='{\"modelRef\":null,\"label\":\"Default\",\"provider\":\"fixture\",\"model\":\"local\",\"credential\":\"secret\"}'",
		"UPDATE agent_requests SET state='waiting_result',wait_ref_json='{}'",
		"UPDATE agent_requests SET package_submission_json='{\"submissionKey\":\"missing-target\"}'",
		"UPDATE brain_experience_revisions SET rule='" + strings.Repeat("中", 1400) + "'",
	} {
		t.Run(mutation[:min(len(mutation), 75)], func(t *testing.T) {
			private, scope := brainFixture(t)
			db, err := database(filepath.Join(private, files[0]), false)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(mutation); err != nil {
				t.Fatal(err)
			}
			db.Close()
			before := fingerprint(t, private)
			snapshot, err := Open(context.Background(), private, scope)
			if snapshot != nil {
				snapshot.Close()
			}
			if err != ErrInvalid {
				t.Fatal("tampering accepted", err)
			}
			if !reflect.DeepEqual(before, fingerprint(t, private)) {
				t.Fatal("rejected validation changed source bytes")
			}
		})
	}
}
func TestCurrentCompletedJobProofRequiresOriginalActionAndJob(t *testing.T) {
	for _, mismatch := range []string{"none", "action", "job", "missing-action"} {
		t.Run(mismatch, func(t *testing.T) {
			private, scope := brainFixture(t)
			db, err := database(filepath.Join(private, files[0]), false)
			if err != nil {
				t.Fatal(err)
			}
			refs := `[{"serviceName":"todo","actionId":"action-original","actionName":"export","input":{},"expectedStateVersion":null,"verificationQuery":"review","status":"known","jobId":"job-original"}]`
			if _, err := db.Exec("UPDATE agent_requests SET action_refs_json=?", refs); err != nil {
				t.Fatal(err)
			}
			details := map[string]any{"state": "succeeded", "jobId": "job-original", "actionId": "action-original"}
			switch mismatch {
			case "action":
				details["actionId"] = "action-another"
			case "job":
				details["jobId"] = "job-another"
			case "missing-action":
				delete(details, "actionId")
			}
			raw, err := json.Marshal(details)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(`INSERT INTO agent_evidence(work_id,evidence_id,request_id,run_id,service_name,kind,object_ref,observed_at,summary,verified,details_json)
				VALUES(?,'evidence-job','request-1','run-local','todo','job','job-original','2026-10-03T00:00:00.000Z','Original Job result',1,?)`, scope.SourceWorkID, string(raw)); err != nil {
				t.Fatal(err)
			}
			db.Close()
			before := fingerprint(t, private)
			snapshot, err := Open(context.Background(), private, scope)
			if snapshot != nil {
				snapshot.Close()
			}
			if mismatch == "none" && err != nil || mismatch != "none" && err != ErrInvalid {
				t.Fatalf("Job proof %s: %v", mismatch, err)
			}
			if !reflect.DeepEqual(before, fingerprint(t, private)) {
				t.Fatal("Job proof validation changed source bytes")
			}
		})
	}
}

func TestCurrentSchemaRejectsDuplicateAndForeignReferences(t *testing.T) {
	private, _ := brainFixture(t)
	db, err := database(filepath.Join(private, files[0]), false)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, q := range []string{"INSERT INTO service_events SELECT * FROM service_events", "INSERT INTO agent_requests SELECT * FROM agent_requests", "INSERT INTO agent_request_runs VALUES('missing','run-local','handling','live','2026-10-03T00:00:00Z')", "INSERT INTO brain_experience_heads VALUES('other-work',0,'2026-10-03T00:00:00Z')"} {
		if _, err := db.Exec(q); err == nil {
			t.Fatal("invalid key accepted", q)
		}
	}
}

func TestCurrentEmptyDatabaseSameVersionRecovery(t *testing.T) {
	root := t.TempDir()
	private := filepath.Join(root, "private")
	if err := os.Mkdir(private, 0700); err != nil {
		t.Fatal(err)
	}
	db, err := database(filepath.Join(private, files[0]), false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(schemaSQL); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO schema_migrations VALUES(4,'2026-10-03T00:00:00Z')"); err != nil {
		t.Fatal(err)
	}
	db.Close()
	for i := 0; i < 2; i++ {
		s, err := Open(context.Background(), private, Scope{SourceWorkID: "work-source-000000000001", ContextIDs: map[string]bool{}, ScratchDirectory: root})
		if err != nil || s == nil {
			t.Fatal(err)
		}
		if s.Summary != (Summary{}) {
			t.Fatal(s.Summary)
		}
		s.Close()
	}
}

func TestCurrentFeedbackRecoveryAndHistoricalCopies(t *testing.T) {
	private, scope := brainFixture(t)
	db, err := database(filepath.Join(private, files[0]), false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE sessions SET model_preference_json='{"modelRef":"model-source-0000000001","label":"Original","provider":"fixture","model":"local","baseUrl":"https://models.example","availability":"available"}'`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	snapshot, err := Open(context.Background(), private, scope)
	if err != nil {
		t.Fatal(err)
	}
	defer snapshot.Close()
	for _, suffix := range []string{"a", "b", "c"} {
		target := filepath.Join(scope.ScratchDirectory, "target-"+suffix)
		copyFixture(t, "valid", target)
		binding := RestoreBindings{}
		if suffix == "a" {
			binding.Models = []map[string]any{{"modelRef": "model-target-0000000001", "label": "Target", "provider": "fixture", "model": "local", "baseUrl": "https://MODELS.example:443/a/../"}}
		}
		if suffix == "c" {
			binding.Models = []map[string]any{
				{"modelRef": "model-target-0000000001", "label": "Target one", "provider": "fixture", "model": "local", "baseUrl": "https://models.example"},
				{"modelRef": "model-target-0000000002", "label": "Target two", "provider": "fixture", "model": "local", "baseUrl": "https://MODELS.example:443/"},
			}
		}

		workID := "work-target-00000000000" + suffix
		contextID := "context-target-" + suffix
		if err := snapshot.Rebuild(context.Background(), target, workID, map[string]string{historyCases(t)[0].ContextIDs[0]: contextID}, binding); err != nil {
			t.Fatal(err)
		}
		reopened, err := Open(context.Background(), target, Scope{SourceWorkID: workID, ContextIDs: map[string]bool{contextID: true}, ScratchDirectory: scope.ScratchDirectory})
		if err != nil {
			t.Fatal(err)
		}
		reopened.Close()
		targetDB, err := database(filepath.Join(target, files[0]), true)
		if err != nil {
			t.Fatal(err)
		}
		var disposition, eventJSON, preference string
		if err := targetDB.QueryRow("SELECT disposition,event_json FROM service_events").Scan(&disposition, &eventJSON); err != nil {
			t.Fatal(err)
		}
		if disposition != "historical" || !strings.Contains(eventJSON, scope.SourceWorkID) {
			t.Fatal("source event or historical disposition changed", disposition, eventJSON)
		}
		if err := targetDB.QueryRow("SELECT model_preference_json FROM sessions").Scan(&preference); err != nil {
			t.Fatal(err)
		}
		availability := "unavailable"
		if suffix == "a" {
			availability = "available"
		}
		if !strings.Contains(preference, `"availability":"`+availability+`"`) {
			t.Fatal(preference)
		}
		if err := targetDB.QueryRow("SELECT disposition FROM agent_requests").Scan(&disposition); err != nil || disposition != "historical" {
			t.Fatal(disposition, err)
		}
		targetDB.Close()
	}
}

func TestNativeCandidateProofRequiresActualSDKInputAndChecks(t *testing.T) {
	for _, damage := range []string{"valid", "wrong-input", "missing-input", "wrong-tool", "failed-check", "missing-check", "wrong-run"} {
		t.Run(damage, func(t *testing.T) {
			private, scope := brainFixture(t)
			db, err := database(filepath.Join(private, files[0]), false)
			if err != nil {
				t.Fatal(err)
			}
			work := scope.SourceWorkID
			contextID := ""
			if err := db.QueryRow(`SELECT context_identity FROM runs WHERE run_id='run-local'`).Scan(&contextID); err != nil {
				t.Fatal(err)
			}
			target := map[string]any{"contractVersion": 1, "toolName": "package:piwork-brain:review_probe", "input": map[string]any{"mode": "review"}, "checkNames": []any{"review-format"}}
			artifact := "sha256:" + strings.Repeat("c", 64)
			source := "sha256:" + strings.Repeat("b", 64)
			descriptor := map[string]any{"submissionKey": "candidate-fixed", "requestId": "request-1", "verificationGoal": "Verify review", "verificationTarget": target, "expectedSourceDigest": source, "activeDigest": artifact, "desiredDigest": artifact, "activeContextId": contextID}
			details := map[string]any{"verificationContractVersion": 1, "adoptionVerified": true, "requestId": "request-1", "runId": "run-local", "verificationTarget": target, "toolName": target["toolName"], "input": target["input"], "toolCallId": "actual-call", "artifactDigest": artifact, "contextIdentity": contextID, "checks": []any{map[string]any{"name": "review-format", "passed": true, "summary": "Actual review validated"}}}
			start := map[string]any{"toolName": "review_probe", "toolCallId": "actual-call", "args": target["input"]}
			switch damage {
			case "wrong-input":
				start["args"] = map[string]any{"mode": "other"}
			case "missing-input":
				delete(start, "args")
			case "wrong-tool":
				start["toolName"] = "other_probe"
			case "failed-check":
				details["checks"] = []any{map[string]any{"name": "review-format", "passed": false, "summary": "Failed"}}
			case "missing-check":
				details["checks"] = []any{map[string]any{"name": "unrelated", "passed": true, "summary": "Other check"}}
			case "wrong-run":
				details["runId"] = "run-another"
			}
			encoded := func(v any) string {
				raw, err := json.Marshal(v)
				if err != nil {
					t.Fatal(err)
				}
				return string(raw)
			}
			exec := func(q string, args ...any) {
				if _, err := db.Exec(q, args...); err != nil {
					t.Fatal(err)
				}
			}
			exec(`UPDATE agent_requests SET package_submission_json=? WHERE request_id='request-1'`, encoded(descriptor))
			exec(`UPDATE agent_evidence SET kind='sdk',object_ref=?,code_version='1.0.0',details_json=? WHERE evidence_id='evidence-1'`, target["toolName"], encoded(details))
			exec(`INSERT INTO agent_evidence(work_id,evidence_id,request_id,kind,object_ref,observed_at,summary,verified,details_json) VALUES(?,'package-receipt','request-1','package','candidate-fixed','2026-10-03T00:00:00Z','Frozen receipt',0,?)`, work, encoded(map[string]any{"requestId": "request-1", "candidateArtifactDigest": artifact, "sourceDigest": source}))
			exec(`DELETE FROM run_events WHERE run_id='run-local'`)
			exec(`INSERT INTO run_events VALUES('run-local',1,'tool-start',?,'2026-10-03T00:00:00Z')`, encoded(start))
			exec(`INSERT INTO run_events VALUES('run-local',2,'tool-end',?,'2026-10-03T00:00:00Z')`, encoded(map[string]any{"toolName": "review_probe", "toolCallId": "actual-call", "isError": false}))
			exec(`INSERT INTO run_events VALUES('run-local',3,'state','{"state":"succeeded"}','2026-10-03T00:00:00Z')`)
			exec(`UPDATE runs SET earliest_available_sequence=1,latest_sequence=3 WHERE run_id='run-local'`)
			db.Close()
			snapshot, err := Open(context.Background(), private, scope)
			if snapshot != nil {
				snapshot.Close()
			}
			if damage == "valid" {
				if err != nil {
					t.Fatal("current actual input proof rejected", err)
				}
			} else if err != ErrInvalid {
				t.Fatal("forged SDK proof admitted", err)
			}
		})
	}
}

func TestCurrentHistoryChatMetadataValidatesWithoutSchemaChange(t *testing.T) {
	for _, level := range []string{`"off"`, `"high"`, `"max"`, `null`, `3`, `"invalid"`} {
		t.Run(level, func(t *testing.T) {
			private, scope := brainFixture(t)
			db, err := database(filepath.Join(private, files[0]), false)
			if err != nil {
				t.Fatal(err)
			}
			model := `{"modelRef":null,"label":"Default","provider":"fixture","model":"local","thinkingLevel":` + level + `}`
			if _, err = db.Exec(`UPDATE runs SET actual_model_json=?,model_selector_json='{"kind":"session-preference","inputMode":"command"}'`, model); err != nil {
				t.Fatal(err)
			}
			db.Close()
			before := fingerprint(t, private)
			snapshot, err := Open(context.Background(), private, scope)
			if snapshot != nil {
				snapshot.Close()
			}
			valid := level == `"off"` || level == `"high"` || level == `"max"`
			if valid && err != nil || !valid && err != ErrInvalid {
				t.Fatal("chat metadata validation", err)
			}
			if !reflect.DeepEqual(before, fingerprint(t, private)) {
				t.Fatal("source changed")
			}
		})
	}
}
