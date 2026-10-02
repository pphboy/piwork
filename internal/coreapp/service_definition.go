package coreapp

import (
	"encoding/json"
	"piwork/internal/contracts"
	"piwork/internal/servicedefinition"
)

const serviceRequestLimit = servicedefinition.RequestLimit

type serviceDefinitionValidationError = servicedefinition.ValidationError

func normalizeServiceDefinition(raw json.RawMessage) (contracts.ServiceDefinitionInput, error) {
	return servicedefinition.Normalize(raw)
}

func assignServiceDefinition(input contracts.ServiceDefinitionInput, id string, revision int64) contracts.ServiceDefinition {
	return contracts.ServiceDefinition{ServiceId: contracts.ResourceId(id), Revision: revision, Name: input.Name, Image: input.Image, Command: input.Command, Args: input.Args.Value, Environment: input.Environment.Value, SecretRefs: input.SecretRefs.Value, WorkingDirectory: input.WorkingDirectory.Value, Mounts: input.Mounts.Value, Ports: input.Ports.Value, CpuMillis: input.CpuMillis.Value, MemoryBytes: input.MemoryBytes.Value, Enabled: input.Enabled.Value, Required: input.Required.Value, Readiness: input.Readiness, RestartPolicy: input.RestartPolicy.Value}
}
