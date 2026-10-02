package diagnostics

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"piwork/internal/contracts"
)

func TestAgentOutputAcceptsOnlyMatchingSafeInitializationFields(t *testing.T) {
	input := strings.Join([]string{
		`{"component":"agentd","stage":"skill-load","outcome":"failed","code":"SKILL_LOAD_FAILED","workId":"work-diagnostic-fixture","correlationId":"operation-diagnostic-fixture","skillName":"safe-skill","message":"password-secret /private/context SKILL BODY"}`,
		`{"component":"agentd","stage":"skill-load","outcome":"failed","code":"SKILL_LOAD_FAILED","workId":"foreign-work","correlationId":"operation-diagnostic-fixture"}`,
		`{"component":"agentd","stage":"skill-load","outcome":"failed","code":"invented","workId":"work-diagnostic-fixture","correlationId":"operation-diagnostic-fixture"}`,
		`{"component":"agentd","stage":"skill-load","outcome":"failed","code":"SKILL_LOAD_FAILED","workId":"work-diagnostic-fixture","correlationId":"operation-diagnostic-fixture","skillName":"../../secret"}`,
	}, "\n")
	events := ParseAgentLines(input, "work-diagnostic-fixture", "operation-diagnostic-fixture")
	if len(events) != 1 || events[0].SkillName != "safe-skill" {
		t.Fatal(events)
	}
	var output bytes.Buffer
	Write(&output, events[0], "work-diagnostic-fixture", "operation-diagnostic-fixture", "operation-diagnostic-fixture")
	for _, secret := range []string{"password-secret", "/private/", "SKILL BODY", "../../"} {
		if strings.Contains(output.String(), secret) {
			t.Fatal("untrusted text escaped", secret)
		}
	}
	var event map[string]any
	if err := json.Unmarshal(output.Bytes(), &event); err != nil {
		t.Fatal(err)
	}
	if event["level"] != "error" || event["code"] != "SKILL_LOAD_FAILED" || event["skillName"] != "safe-skill" {
		t.Fatal(event)
	}
}
func TestRetainedDiagnosticBoundsPreserveRollbackAndCollection(t *testing.T) {
	d := Empty()
	d.Rollback.State = "failed"
	m, r, retry, _ := Text("ROLLBACK_FAILED")
	d.Rollback.Error = contracts.Supplied(contracts.SafeDiagnostic{Code: "ROLLBACK_FAILED", Stage: "rollback", Message: m, Remediation: r, Retryable: retry})
	d.DiagnosticCollection = contracts.DiagnosticCollection{State: "unavailable", Code: contracts.Supplied("DIAGNOSTIC_COLLECTION_FAILED")}
	for i := 0; i < 140; i++ {
		d = Append(d, Event{Component: "agentd", Stage: "skill-load", Outcome: "failed", Code: "SKILL_LOAD_FAILED", SkillName: fmt.Sprintf("skill-%d", i)})
	}
	if len(d.Stages) != 64 || !d.Truncated || d.Stages[0].SkillName.Value != "skill-76" || d.Rollback.State != "failed" || d.DiagnosticCollection.State != "unavailable" {
		t.Fatal(d)
	}
	raw, _ := json.Marshal(d)
	if len(raw) > 64<<10 || contracts.Validate("OperationDiagnosticsSchema", d) != nil {
		t.Fatal("diagnostic bounds/contract", len(raw))
	}
}
