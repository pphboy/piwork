package coreapp

import (
	"encoding/json"
	"strings"
	"testing"

	"google.golang.org/protobuf/proto"
	"piwork/internal/contracts"
	"piwork/internal/rpc/agentv1"
)

func TestRuntimePackageObservationVerifiesResourcesAndSuppressesRawDiagnostics(t *testing.T) {
	config := contracts.WorkConfig{Tools: contracts.ToolPolicy{Allowed: []contracts.WorkToolPolicyKey{}, Denied: []contracts.WorkToolPolicyKey{}}, Packages: contracts.PiPackageSelection{{Name: "tools", Enabled: true}}}
	metadata := contracts.WorkContextMetadata{PackageBindings: []struct {
		Name     string                              `json:"name"`
		NameKey  string                              `json:"nameKey"`
		Artifact contracts.PiPackageArtifactMetadata `json:"artifact"`
	}{{Name: "tools", Artifact: contracts.PiPackageArtifactMetadata{ContentDigest: contracts.Digest("sha256:" + strings.Repeat("a", 64)), ResourceCounts: contracts.PiPackageResourceCounts{Prompts: 1}}}}}
	ready := &agentv1.ReadinessResponse{InitializationComplete: true, AcceptingRuns: true, ResolvedTools: []string{"read", "bash", "edit", "write", "grep", "find", "ls"}, LoadedPackages: []*agentv1.LoadedPackage{{Name: "tools", ContentDigest: string(metadata.PackageBindings[0].Artifact.ContentDigest), Prompts: 1}}, PackageResources: []*agentv1.PackageResource{{PackageName: "tools", Kind: "prompt", Name: "review"}}}
	for _, test := range []struct {
		name, state string
		change      func(*agentv1.ReadinessResponse)
	}{
		{"ready", "ready", func(*agentv1.ReadinessResponse) {}},
		{"missing package", "failed", func(r *agentv1.ReadinessResponse) { r.LoadedPackages = nil }},
		{"wrong digest", "failed", func(r *agentv1.ReadinessResponse) {
			r.LoadedPackages[0].ContentDigest = "sha256:" + strings.Repeat("b", 64)
		}},
		{"duplicate package", "failed", func(r *agentv1.ReadinessResponse) { r.LoadedPackages = append(r.LoadedPackages, r.LoadedPackages[0]) }},
		{"missing prompt", "failed", func(r *agentv1.ReadinessResponse) { r.PackageResources = nil }},
		{"forbidden tool", "failed", func(r *agentv1.ReadinessResponse) { r.ResolvedTools = append(r.ResolvedTools, "package:other:secret") }},
		{"load diagnostic", "failed", func(r *agentv1.ReadinessResponse) {
			r.PackageDiagnostics = []*agentv1.PackageDiagnostic{{PackageName: "tools", Code: "/private/credential", Message: "password=fixture-secret"}}
		}},
		{"not initialized", "failed", func(r *agentv1.ReadinessResponse) { r.InitializationComplete = false }},
		{"draining", "unavailable", func(r *agentv1.ReadinessResponse) { r.Draining = true }},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := proto.Clone(ready).(*agentv1.ReadinessResponse)
			test.change(response)
			result := projectRuntimeResources(contracts.RuntimeSkillState{State: "unavailable", CheckedAt: json.RawMessage(`null`), Skills: []contracts.RuntimeSkill{}}, config, metadata, response)
			if result.State != test.state || !result.Packages.Present || len(result.Packages.Value) != 1 {
				t.Fatal(result)
			}
			raw, _ := json.Marshal(result)
			if strings.Contains(string(raw), "credential") || strings.Contains(string(raw), "fixture-secret") {
				t.Fatal("unsafe diagnostic", string(raw))
			}
			if _, err := contracts.Decode[contracts.RuntimeSkillState](strings.NewReader(string(raw)), "RuntimeSkillStateSchema", 64<<10); err != nil {
				t.Fatal(err, string(raw))
			}
			if test.name == "load diagnostic" && result.Packages.Value[0].Diagnostics[0] != "PACKAGE_LOAD_FAILED" {
				t.Fatal(result)
			}
		})
	}
}
