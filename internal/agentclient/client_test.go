package agentclient

import (
	"errors"
	"testing"

	"piwork/internal/internaltls"
	"piwork/internal/rpc/agentv1"
)

func TestReadinessRequiresCurrentIdentityAndContracts(t *testing.T) {
	scope := internaltls.Scope{InstallationID: "installation-1", WorkID: "work-1", Generation: 7, InstanceID: "agent-1"}
	base := &agentv1.ReadinessResponse{WorkId: scope.WorkID, Generation: 7, InstanceId: scope.InstanceID, ProtocolVersion: "v2", ContextContractVersion: 1, PackageContractVersion: 1, RunModelContractVersion: 1, WorkFeedbackContractVersion: 1, WorkHistorySchemaVersion: 4, ContextIdentity: "context-1", InitializationComplete: true, AcceptingRuns: true}
	if err := VerifyReadiness(scope, "context-1", false, base); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name   string
		change func(*agentv1.ReadinessResponse)
	}{
		{"different-work", func(r *agentv1.ReadinessResponse) { r.WorkId = "work-2" }},
		{"old-generation", func(r *agentv1.ReadinessResponse) { r.Generation = 6 }},
		{"different-instance", func(r *agentv1.ReadinessResponse) { r.InstanceId = "agent-2" }},
		{"old-protocol", func(r *agentv1.ReadinessResponse) { r.ProtocolVersion = "v1" }},
		{"old-context-contract", func(r *agentv1.ReadinessResponse) { r.ContextContractVersion = 0 }},
		{"old-history", func(r *agentv1.ReadinessResponse) { r.WorkHistorySchemaVersion = 3 }},
		{"no-model-contract", func(r *agentv1.ReadinessResponse) { r.RunModelContractVersion = 0 }},
		{"no-feedback-contract", func(r *agentv1.ReadinessResponse) { r.WorkFeedbackContractVersion = 0 }},
		{"old-package-contract", func(r *agentv1.ReadinessResponse) { r.PackageContractVersion = 0 }},
		{"different-context", func(r *agentv1.ReadinessResponse) { r.ContextIdentity = "context-2" }},
		{"still-initializing", func(r *agentv1.ReadinessResponse) { r.InitializationComplete = false }},
		{"draining", func(r *agentv1.ReadinessResponse) { r.Draining = true }},
		{"not-accepting", func(r *agentv1.ReadinessResponse) { r.AcceptingRuns = false }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			value := *base
			test.change(&value)
			if test.name != "still-initializing" && test.name != "draining" && test.name != "not-accepting" {
				if !errors.Is(VerifyObservation(scope, "context-1", &value), ErrReadiness) {
					t.Fatal("diagnostic observation accepted stale identity")
				}
			} else if err := VerifyObservation(scope, "context-1", &value); err != nil {
				t.Fatal("current failed or draining Agent diagnostics unavailable", err)
			}
			if err := VerifyReadiness(scope, "context-1", false, &value); !errors.Is(err, ErrReadiness) {
				t.Fatal("stale or incomplete Agent became ready", err)
			}
		})
	}
	init := *base
	init.AcceptingRuns = false
	if err := VerifyReadiness(scope, "context-1", true, &init); err != nil {
		t.Fatal("initialization-only Agent was rejected", err)
	}
	if err := VerifyReadiness(scope, "context-1", true, base); !errors.Is(err, ErrReadiness) {
		t.Fatal("initialization-only Agent accepted Runs", err)
	}
}
