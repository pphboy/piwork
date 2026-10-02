package workruntime

import (
	"context"
	"errors"
	"strings"
	"time"

	"piwork/internal/agentclient"
	"piwork/internal/contracts"
	"piwork/internal/diagnostics"
)

func (r *Runtime) initializationFailure(ctx context.Context, spec StartSpec, id string, cause error, stage, code string) *diagnostics.Failure {
	f := &diagnostics.Failure{Cause: cause, Code: code, Stage: stage, Collection: contracts.DiagnosticCollection{State: "unrecognized"}}
	if errors.Is(cause, ErrAgentExited) {
		f.Code = "AGENT_EXITED"
	}
	if errors.Is(cause, ErrAgentTimeout) {
		f.Code = "AGENT_READINESS_TIMEOUT"
	}
	if errors.Is(cause, agentclient.ErrReadiness) {
		f.Code = "AGENT_CONTEXT_MISMATCH"
	}
	if errors.Is(cause, agentclient.ErrContextIncompatible) {
		f.Code = "AGENT_CONTEXT_INCOMPATIBLE"
		f.Stage = "context-validate"
	}
	collect, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	identity := agentIdentity(spec.Scope, spec.ContextID)
	view, err := r.Docker.InspectContainer(collect, identity)
	if err == nil && view != nil && view.ID == id && view.State != nil && !view.State.Running {
		exit := int64(view.State.ExitCode)
		f.ExitCode = &exit
		if f.Code == "AGENT_READINESS_TIMEOUT" {
			f.Code = "AGENT_EXITED"
		}
	}
	logs, err := r.Docker.Logs(collect, identity, 200, id)
	if err != nil {
		f.Collection = contracts.DiagnosticCollection{State: "unavailable", Code: contracts.Supplied("DIAGNOSTIC_COLLECTION_FAILED")}
		return f
	}
	events := diagnostics.ParseAgentLines(logs.Text, spec.Scope.WorkID, spec.CorrelationID)
	for _, event := range events {
		if spec.Observe != nil {
			if err := spec.Observe(event); err != nil {
				f.Cause = errors.Join(f.Cause, err)
			}
		}
		if event.Outcome == "failed" {
			f.Code, f.Stage, f.SkillName = event.Code, event.Stage, event.SkillName
			f.Collection.State = "available"
		}
	}
	// Compatibility with the previous daemon's fixed descriptor failure text.
	// Never project the untrusted line itself or infer other causes from prose.
	if f.Collection.State == "unrecognized" && strings.Contains(logs.Text, "invalid Work Skill descriptor") {
		f.Code = "AGENT_CONTEXT_INCOMPATIBLE"
		f.Stage = "context-validate"
		f.Collection.State = "available"
	}
	if logs.Truncated {
		f.Collection.State = "truncated"
	}
	return f
}
