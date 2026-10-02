package servicedefinition

import (
	"bytes"
	"encoding/json"
	"path"
	"regexp"
	"strings"

	"piwork/internal/contracts"
)

const RequestLimit = 1 << 20
const workspacePath = "/var/data/workspace"

var serviceImageURL = regexp.MustCompile(`(?i)^[a-z][a-z0-9+.-]*://|//[^/]*@|^[^/@]+:[^/@]+@`)

type ValidationError struct{ Code, Field string }

func (*ValidationError) Error() string { return "service definition is invalid" }
func serviceDefinitionError(field string, unsupported bool) error {
	code := "INVALID_SERVICE_DEFINITION"
	if unsupported {
		code = "UNSUPPORTED_SERVICE_OPTION"
	}
	return &ValidationError{Code: code, Field: field}
}
func canonicalServicePath(value string) bool {
	if !strings.HasPrefix(value, "/") || strings.ContainsRune(value, 0) {
		return false
	}
	normalized := path.Clean(value)
	if normalized != "/" && strings.HasSuffix(value, "/") {
		normalized += "/"
	}
	return normalized == value
}

// Normalize before assigning IDs or accepting mutations. Optional omissions
// and their explicit defaults have the same semantic idempotency request.
func Normalize(raw json.RawMessage) (contracts.ServiceDefinitionInput, error) {
	var zero contracts.ServiceDefinitionInput
	value, err := contracts.ParseJSON(bytes.NewReader(raw), RequestLimit)
	if err != nil {
		return zero, serviceDefinitionError("request", false)
	}
	fields, object := value.(map[string]any)
	if object {
		supported := map[string]bool{"name": true, "image": true, "command": true, "args": true, "environment": true, "secretRefs": true, "workingDirectory": true, "mounts": true, "ports": true, "cpuMillis": true, "memoryBytes": true, "enabled": true, "required": true, "readiness": true, "restartPolicy": true}
		for key := range fields {
			if !supported[key] {
				return zero, serviceDefinitionError(key, true)
			}
		}
		if refs, array := fields["secretRefs"].([]any); array && len(refs) > 0 {
			return zero, serviceDefinitionError("secretRefs", true)
		}
	}
	input, err := contracts.Decode[contracts.ServiceDefinitionInput](bytes.NewReader(raw), "ServiceDefinitionInputSchema", RequestLimit)
	if err != nil {
		return zero, serviceDefinitionError("definition", false)
	}
	if serviceImageURL.MatchString(input.Image.Reference) {
		return zero, serviceDefinitionError("image.reference", false)
	}
	if len(input.Command) > 4096 || strings.ContainsRune(input.Command, 0) {
		return zero, serviceDefinitionError("command", false)
	}
	if input.Name == "agentd" || input.Name == "piwork-core" {
		return zero, serviceDefinitionError("name", false)
	}
	args := append([]string{}, input.Args.Value...)
	for _, arg := range args {
		if len(arg) > 4096 || strings.ContainsRune(arg, 0) {
			return zero, serviceDefinitionError("args", false)
		}
	}
	environment := map[string]json.RawMessage{}
	for key, raw := range input.Environment.Value {
		var text string
		if json.Unmarshal(raw, &text) != nil || len(text) > 16384 || strings.ContainsRune(text, 0) {
			return zero, serviceDefinitionError("environment", false)
		}
		environment[key] = append(json.RawMessage(nil), raw...)
	}
	directory := workspacePath
	if input.WorkingDirectory.Present {
		directory = input.WorkingDirectory.Value
	}
	if !canonicalServicePath(directory) {
		return zero, serviceDefinitionError("workingDirectory", false)
	}
	mounts := append([]contracts.ServiceMount{}, input.Mounts.Value...)
	if len(mounts) == 0 && directory != "/" || len(mounts) == 1 && directory != workspacePath && !strings.HasPrefix(directory, workspacePath+"/") {
		return zero, serviceDefinitionError("workingDirectory", false)
	}
	ports := append([]contracts.ServicePort{}, input.Ports.Value...)
	names, pairs := map[contracts.Identifier]bool{}, map[string]bool{}
	for _, port := range ports {
		pairRaw, _ := json.Marshal([]any{port.Protocol, port.ContainerPort})
		pair := string(pairRaw)
		if names[port.Name] || pairs[pair] {
			return zero, serviceDefinitionError("ports", false)
		}
		names[port.Name] = true
		pairs[pair] = true
	}
	if input.Readiness.Present {
		probe := input.Readiness.Value
		if !probe.DeadlineMs.Present {
			probe.DeadlineMs = contracts.Supplied(int64(120000))
		}
		if !probe.TimeoutMs.Present {
			probe.TimeoutMs = contracts.Supplied(int64(2000))
		}
		if probe.Kind == "exec" {
			if !probe.Command.Present || probe.PortName.Present || probe.Path.Present {
				return zero, serviceDefinitionError("readiness", false)
			}
			for _, arg := range probe.Command.Value {
				if len(arg) > 4096 || strings.ContainsRune(arg, 0) {
					return zero, serviceDefinitionError("readiness.command", false)
				}
			}
		} else {
			if !probe.PortName.Present || probe.Command.Present {
				return zero, serviceDefinitionError("readiness.portName", false)
			}
			found := false
			for _, port := range ports {
				if port.Name == probe.PortName.Value && port.Protocol == "tcp" {
					found = true
				}
			}
			if !found {
				return zero, serviceDefinitionError("readiness.portName", false)
			}
			if probe.Kind == "tcp" && probe.Path.Present {
				return zero, serviceDefinitionError("readiness.path", false)
			}
			if probe.Kind == "http" && (!probe.Path.Present || len(probe.Path.Value) > 2048 || !canonicalServicePath(probe.Path.Value)) {
				return zero, serviceDefinitionError("readiness.path", false)
			}
		}
		input.Readiness = contracts.Supplied(probe)
	}
	input.Args = contracts.Supplied(args)
	input.Environment = contracts.Supplied(environment)
	input.SecretRefs = contracts.Supplied([]json.RawMessage{})
	input.WorkingDirectory = contracts.Supplied(directory)
	input.Mounts = contracts.Supplied(mounts)
	input.Ports = contracts.Supplied(ports)
	if !input.CpuMillis.Present {
		input.CpuMillis = contracts.Supplied(int64(250))
	}
	if !input.MemoryBytes.Present {
		input.MemoryBytes = contracts.Supplied(int64(128 << 20))
	}
	if !input.Enabled.Present {
		input.Enabled = contracts.Supplied(true)
	}
	if !input.Required.Present {
		input.Required = contracts.Supplied(false)
	}
	if !input.RestartPolicy.Present {
		input.RestartPolicy = contracts.Supplied("bounded")
	}
	return input, nil
}
