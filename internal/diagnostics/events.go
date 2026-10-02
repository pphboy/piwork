package diagnostics

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	"piwork/internal/contracts"
)

type Event struct {
	Component, Stage, Outcome, Code, SkillName, ServiceID string
}

type Failure struct {
	Cause                  error
	Code, Stage, SkillName string
	ExitCode               *int64
	Collection             contracts.DiagnosticCollection
}

func (f *Failure) Error() string { return f.Code }
func (f *Failure) Unwrap() error { return f.Cause }

func SafeEvent(e Event) (Event, bool) {
	if contracts.Validate("DiagnosticStageSchema", e.Stage) != nil || contracts.Validate("DiagnosticCodeSchema", e.Code) != nil || (e.Component != "core" && e.Component != "agentd") {
		return Event{}, false
	}
	if e.Outcome != "started" && e.Outcome != "succeeded" && e.Outcome != "failed" && e.Outcome != "interrupted" {
		return Event{}, false
	}
	if e.SkillName != "" && contracts.Validate("SkillNameSchema", e.SkillName) != nil {
		return Event{}, false
	}
	if e.ServiceID != "" && contracts.Validate("ResourceIdSchema", e.ServiceID) != nil {
		return Event{}, false
	}
	return e, true
}
func Message(e Event) string {
	if e.Outcome == "started" {
		return "Work operation stage started."
	}
	if e.Outcome == "interrupted" {
		return "Work operation stage was interrupted and will be recovered."
	}
	if e.Outcome == "failed" {
		m, _, _, _ := Text(e.Code)
		return m
	}
	switch e.Stage {
	case "skill-validate":
		return "Work Skill directories were validated."
	case "skill-load":
		return "Work Skills were validated by the agent SDK."
	case "package-load":
		return "Work packages were loaded by the agent SDK."
	case "mcp-initialize":
		return "Required Work MCP servers were initialized."
	case "readiness":
		return "Work runtime readiness was verified."
	case "activation":
		return "Work configuration activation completed."
	}
	return "Work operation stage completed."
}

func Write(w io.Writer, e Event, workID, operationID, correlationID string) {
	e, ok := SafeEvent(e)
	if !ok {
		return
	}
	level := "info"
	if e.Outcome == "failed" {
		level = "error"
	}
	v := map[string]any{"timestamp": time.Now().UTC().Format(time.RFC3339Nano), "level": level, "component": e.Component, "stage": e.Stage, "outcome": e.Outcome, "code": e.Code, "message": Message(e), "correlationId": correlationID}
	if workID != "" {
		v["workId"] = workID
	}
	if operationID != "" {
		v["operationId"] = operationID
	}
	if e.SkillName != "" {
		v["skillName"] = e.SkillName
	}
	if e.ServiceID != "" {
		v["serviceId"] = e.ServiceID
	}
	raw, _ := json.Marshal(v)
	fmt.Fprintln(w, string(raw))
}

// Agent output is untrusted. Ignore text and all fields other than validated
// identity, codes and stages; never publish its message or exception details.
func ParseAgentLines(text, work, correlation string) []Event {
	result := []Event{}
	for _, line := range strings.Split(text, "\n") {
		var item struct{ Component, Stage, Outcome, Code, WorkID, CorrelationID, SkillName string }
		if json.Unmarshal([]byte(line), &item) != nil || item.Component != "agentd" || item.WorkID != work || item.CorrelationID != correlation {
			continue
		}
		e, ok := SafeEvent(Event{Component: item.Component, Stage: item.Stage, Outcome: item.Outcome, Code: item.Code, SkillName: item.SkillName})
		if !ok || (e.Stage != "skill-load" && e.Stage != "package-load" && e.Stage != "mcp-initialize" && e.Stage != "context-validate" && e.Stage != "skill-validate") {
			continue
		}
		result = append(result, e)
	}
	return result
}

func Empty() contracts.OperationDiagnostics {
	d := contracts.OperationDiagnostics{Stages: []contracts.SafeTerminalStageEvent{}, DiagnosticCollection: contracts.DiagnosticCollection{State: "not-attempted"}}
	d.Rollback.State = "not-required"
	return d
}
func Append(d contracts.OperationDiagnostics, e Event) contracts.OperationDiagnostics {
	e, ok := SafeEvent(e)
	if !ok || e.Outcome == "started" {
		return d
	}
	s := contracts.SafeTerminalStageEvent{Timestamp: contracts.Timestamp(time.Now().UTC().Format(time.RFC3339Nano)), Component: e.Component, Stage: contracts.DiagnosticStage(e.Stage), Outcome: e.Outcome, Code: contracts.DiagnosticCode(e.Code), Message: Message(e)}
	if e.SkillName != "" {
		s.SkillName = contracts.Supplied(contracts.SkillName(e.SkillName))
	}
	if e.ServiceID != "" {
		s.ServiceId = contracts.Supplied(contracts.ResourceId(e.ServiceID))
	}
	d.Stages = append(d.Stages, s)
	for {
		raw, _ := json.Marshal(d)
		if len(d.Stages) <= 64 && len(raw) <= 64<<10 {
			break
		}
		if len(d.Stages) == 0 {
			break
		}
		d.Stages = d.Stages[1:]
		d.Truncated = true
	}
	return d
}
