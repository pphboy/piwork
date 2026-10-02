//go:build integration

package coreapp

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/dockerengine"
	"piwork/internal/identity"
	"piwork/internal/skillartifact"
)

func TestNativeSkillFailuresRemainSpecificAfterRollbackAndCoreRestart(t *testing.T) {
	a, base, auth, id, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + id
	state, err := a.Store.Configuration(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	activeRoot := filepath.Join(a.options.DataDirectory, "works", id, "contexts", *state.ActiveContextID)
	raw, err := os.ReadFile(filepath.Join(activeRoot, "metadata.json"))
	if err != nil {
		t.Fatal(err)
	}
	var metadata contracts.WorkContextMetadata
	if json.Unmarshal(raw, &metadata) != nil || len(metadata.Skills) != 1 {
		t.Fatal("expected deployment Skill", string(raw))
	}
	skillName := metadata.Skills[0].Name
	// Success must be an SDK result for the named Skill, never just a Save result.
	var creation string
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT id FROM operations WHERE work_id=? AND kind='create-work'`, id).Scan(&creation)
	}); err != nil {
		t.Fatal(err)
	}
	status, success := packageHTTPCall(t, base, "/api/v1/operations/"+creation, "GET", auth, nil)
	successBytes, _ := json.Marshal(success)
	if status != 200 || !strings.Contains(string(successBytes), `"stage":"skill-load"`) || !strings.Contains(string(successBytes), `"skillName":"`+skillName+`"`) {
		t.Fatal("named SDK success absent", success)
	}
	var retainedID string
	for _, fault := range []string{"missing-manifest", "sdk-load-and-rollback"} {
		status, saved := packageHTTPCall(t, base, path+"/configuration/agents", "PUT", auth, map[string]string{"agentsMd": "# Diagnostic " + fault})
		if status != 200 {
			t.Fatal(status, saved)
		}
		state, err = a.Store.Configuration(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		desiredRoot := filepath.Join(a.options.DataDirectory, "works", id, "contexts", *state.DesiredContextID)
		skillRoot := filepath.Join(desiredRoot, "skills", skillName)
		manifest := filepath.Join(skillRoot, "SKILL.md")
		original, err := os.ReadFile(manifest)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(skillRoot, 0755); err != nil {
			t.Fatal(err)
		}
		expected := "SKILL_VALIDATION_FAILED"
		if fault == "missing-manifest" {
			if err := os.Remove(manifest); err != nil {
				t.Fatal(err)
			}
		} else {
			expected = "SKILL_LOAD_FAILED"
			if err := os.Chmod(manifest, 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(manifest, []byte("---\nname: "+skillName+"\ndescription: [unterminated\n---\nSECRET_SKILL_BODY_MUST_NOT_ESCAPE\n"), 0600); err != nil {
				t.Fatal(err)
			}
			snapshot, err := skillartifact.Scan(skillRoot, skillName)
			if err != nil {
				t.Fatal(err)
			}
			metadataRaw, err := os.ReadFile(filepath.Join(desiredRoot, "metadata.json"))
			if err != nil {
				t.Fatal(err)
			}
			var candidate contracts.WorkContextMetadata
			if json.Unmarshal(metadataRaw, &candidate) != nil {
				t.Fatal("metadata")
			}
			candidate.Skills[0].Identity = snapshot.Identity
			updated, _ := json.Marshal(candidate)
			if err := os.Chmod(filepath.Join(desiredRoot, "metadata.json"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(desiredRoot, "metadata.json"), updated, 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(manifest, 0444); err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(filepath.Join(desiredRoot, "metadata.json"), 0444); err != nil {
				t.Fatal(err)
			}
			// Damage only this installation's prior context, independently of the SDK failure.
			if err := os.Chmod(filepath.Join(activeRoot, "config.json"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(activeRoot, "config.json"), []byte("{}"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		status, accepted := packageHTTPCall(t, base, path+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": fault})
		if status != 202 {
			t.Fatal(status, accepted)
		}
		retainedID = accepted["operationId"].(string)
		failed := waitApplyFailure(t, ctx, a, retainedID)
		view := operationEnvelopeView(failed).(map[string]any)
		encoded, _ := json.Marshal(view)
		if _, err := contracts.Decode[contracts.PublicOperation](bytes.NewReader(encoded), "PublicOperationSchema", 64<<10); err != nil {
			t.Fatal(err, string(encoded))
		}
		primary := view["error"].(map[string]any)
		diagnostics := view["diagnostics"].(map[string]any)
		rollback := diagnostics["rollback"].(map[string]any)
		expectedRollback := "succeeded"
		if fault != "missing-manifest" {
			expectedRollback = "failed"
		}
		if primary["code"] != expected || primary["skillName"] != skillName || primary["exitCode"] == nil || rollback["state"] != expectedRollback || diagnostics["diagnosticCollection"].(map[string]any)["state"] != "available" {
			t.Fatal("Skill cause/exit/collection/rollback lost", view)
		}
		if strings.Contains(string(encoded), "SECRET_SKILL_BODY") || strings.Contains(string(encoded), a.options.DataDirectory) || strings.Contains(string(encoded), "sha256:") || strings.Contains(string(encoded), *state.DesiredContextID) || strings.Contains(string(encoded), *state.ActiveContextID) {
			t.Fatal("private context escaped", string(encoded))
		}
		if err := os.Chmod(manifest, 0600); err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
		if err := os.WriteFile(manifest, original, 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(manifest, 0444); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(skillRoot, 0755); err != nil {
			t.Fatal(err)
		}
	}
	container, err := a.dockerRuntime.InspectContainer(ctx, dockerengine.ContainerIdentity{WorkID: id, Kind: "agent", LogicalID: "agentd"})
	if err != nil || container != nil {
		t.Fatal("failed candidate/rollback container retained", err)
	}
	beforeStatus, before := packageHTTPCall(t, base, "/api/v1/operations/"+retainedID, "GET", auth, nil)
	if beforeStatus != 200 {
		t.Fatal(beforeStatus, before)
	}
	if err := a.Close(ctx); err != nil {
		t.Fatal(err)
	}
	// Deliberately omit Docker configuration: diagnostic reads require only durable identity/store.
	reopened, err := New(ctx, Options{DataDirectory: a.options.DataDirectory})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := reopened.Close(ctx)
		if err == nil || err.Error() != "Core workload shutdown was not confirmed" {
			t.Error("Docker-unavailable shutdown must not claim runtime confirmation", err)
		}
	}()
	nextAddress, err := reopened.Listen(ListenAddress{"127.0.0.1", 0})
	if err != nil {
		t.Fatal(err)
	}
	nextBase := nextAddress.URL()
	afterStatus, after := packageHTTPCall(t, nextBase, "/api/v1/operations/"+retainedID, "GET", auth, nil)
	beforeBytes, _ := json.Marshal(before)
	afterBytes, _ := json.Marshal(after)
	if afterStatus != 200 || !bytes.Equal(beforeBytes, afterBytes) {
		t.Fatal("diagnostic changed after container removal/restart", afterStatus, before, after)
	}
	t.Log("retained Skill failure", retainedID, "work", id)
}

func TestNativePreacceptCopyFailureSharesCorrelationWithoutRecords(t *testing.T) {
	a, base, auth, _, ctx := nativeApplyFixture(t)
	name := "copy-fault-skill"
	source := filepath.Join(t.TempDir(), name)
	if err := os.MkdirAll(source, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "SKILL.md"), []byte("---\nname: copy-fault-skill\ndescription: Diagnostic fixture.\n---\nFixture"), 0600); err != nil {
		t.Fatal(err)
	}
	snapshot, err := skillartifact.Scan(source, name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.publishSkillSnapshot(ctx, identity.OperatorPrincipal(), snapshot, false); err != nil {
		t.Fatal(err)
	}
	digest := snapshot.Identity
	manifest := filepath.Join(a.options.DataDirectory, "skills", name, "artifacts", strings.TrimPrefix(digest, "sha256:"), "SKILL.md")
	parent := filepath.Dir(manifest)
	if err := os.Chmod(parent, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(manifest, manifest+".fixture-hidden"); err != nil {
		t.Fatal(err)
	}
	defer func() { os.Rename(manifest+".fixture-hidden", manifest); os.Chmod(parent, 0700) }()
	counts := func() (works, operations int) {
		t.Helper()
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			if err := tx.QueryRow(`SELECT COUNT(*) FROM works`).Scan(&works); err != nil {
				return err
			}
			return tx.QueryRow(`SELECT COUNT(*) FROM operations`).Scan(&operations)
		}); err != nil {
			t.Fatal(err)
		}
		return
	}
	works, operations := counts()
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	priorStderr := os.Stderr
	os.Stderr = writer
	captured := make(chan []byte, 1)
	go func() { raw, _ := io.ReadAll(reader); captured <- raw }()
	status, failed := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]any{"name": "Copy fails atomically", "skills": []string{name}, "idempotencyKey": "copy-failure"})
	os.Stderr = priorStderr
	writer.Close()
	logs := <-captured
	reader.Close()
	afterWorks, afterOperations := counts()
	correlation, ok := failed["correlationId"].(string)
	if status < 400 || !ok || correlation == "" || works != afterWorks || operations != afterOperations {
		t.Fatal("preaccept failure invented identity or lost correlation", status, failed, afterWorks, afterOperations)
	}
	found := false
	for _, line := range bytes.Split(logs, []byte("\n")) {
		var event map[string]any
		if json.Unmarshal(line, &event) == nil && event["stage"] == "context-copy" && event["outcome"] == "failed" && event["correlationId"] == correlation {
			found = true
			if event["workId"] != nil || event["operationId"] != nil {
				t.Fatal("preaccept log invented identity", event)
			}
		}
	}
	if !found || bytes.Contains(logs, []byte(manifest)) {
		t.Fatal("missing safe correlated copy log", string(logs))
	}
	t.Log("preaccept correlation", correlation)
}

func TestNativeRunningAgentReportsReadinessTimeoutWithoutExit(t *testing.T) {
	a, base, auth, id, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + id
	_, view := packageHTTPCall(t, base, path+"/configuration", "GET", auth, nil)
	config := view["desired"].(map[string]any)
	config["mcpServers"] = []any{map[string]any{"serverId": "waiting", "transport": "stdio", "required": true, "command": "node", "args": []string{"-e", "setTimeout(()=>{},600000)"}, "timeoutMs": 60000}}
	status, saved := packageHTTPCall(t, base, path+"/configuration", "PUT", auth, map[string]any{"configuration": config})
	if status != 200 {
		t.Fatal(status, saved)
	}
	status, accepted := packageHTTPCall(t, base, path+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": "full-readiness-deadline"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	failed := waitApplyFailure(t, ctx, a, accepted["operationId"].(string))
	projected := operationEnvelopeView(failed).(map[string]any)
	primary := projected["error"].(map[string]any)
	diagnostic := projected["diagnostics"].(map[string]any)
	if primary["code"] != "AGENT_READINESS_TIMEOUT" || primary["exitCode"] != nil || diagnostic["diagnosticCollection"].(map[string]any)["state"] != "unrecognized" || diagnostic["rollback"].(map[string]any)["state"] != "succeeded" {
		t.Fatal("live daemon misdiagnosed", projected)
	}
	envelope := decodeDiagnosticEnvelope(failed.ResultJSON, failed.ID)
	var began, ended time.Time
	for _, stage := range envelope.Diagnostics.Stages {
		if stage.Stage == "runtime-start" && began.IsZero() {
			began, _ = time.Parse(time.RFC3339Nano, string(stage.Timestamp))
		}
		if stage.Stage == "readiness" && stage.Outcome == "failed" && ended.IsZero() {
			ended, _ = time.Parse(time.RFC3339Nano, string(stage.Timestamp))
		}
	}
	if began.IsZero() || ended.IsZero() || ended.Sub(began) < 29*time.Second || ended.Sub(began) > 34*time.Second {
		t.Fatal("readiness deadline not 30 seconds", began, ended)
	}
	t.Log("live non-ready Agent deadline", ended.Sub(began), "operation", failed.ID)
}
