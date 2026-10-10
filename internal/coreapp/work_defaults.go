package coreapp

import (
	"fmt"

	"piwork/internal/contracts"
)

func runtimeImageCatalogID(revision int64) contracts.ResourceId {
	return contracts.ResourceId(fmt.Sprintf("runtime-image-%08d", revision))
}
func runtimeModelCatalogID(revision int64) contracts.ResourceId {
	return contracts.ResourceId(fmt.Sprintf("runtime-model-%08d", revision))
}
func defaultModelReference(profile RuntimeProfile) contracts.ResourceId {
	if profile.ModelRef != "" {
		return contracts.ResourceId(profile.ModelRef)
	}
	return runtimeModelCatalogID(profile.Revision)
}

// defaultWorkConfiguration is the existing pre-release product default. A
// Work captures its own copy at creation; later runtime/default edits do not
// mutate that Work's desired configuration.
func defaultWorkConfiguration(profile RuntimeProfile) contracts.WorkConfig {
	return contracts.WorkConfig{
		AgentImage: contracts.ImageSelection{CatalogId: runtimeImageCatalogID(profile.Revision)},
		Skills:     contracts.SkillSelection{},
		Packages:   contracts.PiPackageSelection{{Name: "piwork-brain", Enabled: true}},
		AgentsMd:   "",
		ModelRef:   defaultModelReference(profile),
		McpServers: []contracts.McpServer{{
			ServerId: "work-services", Transport: "stdio", Required: true,
			Command: contracts.Supplied("/usr/local/bin/piwork-service-mcp"),
			Args:    contracts.Supplied([]string{}), TimeoutMs: contracts.Supplied(int64(30_000)),
		}},
		Resources: contracts.ResourcePolicy{
			CpuMillis: 2_000, MemoryBytes: 1_536 * 1_024 * 1_024,
			AgentCpuMillis: 1_000, AgentMemoryBytes: 768 * 1_024 * 1_024,
			MaxServices: 4, MaxRetainedVolumes: 2,
		},
		Tools: contracts.ToolPolicy{Allowed: []contracts.WorkToolPolicyKey{}, Denied: []contracts.WorkToolPolicyKey{}},
	}
}
