package diagnostics

// Server-authored public messages preserve the existing diagnostic contract.
type wording struct {
	message, remediation string
	retryable            bool
}

var words = map[string]wording{
	"CONTEXT_COPY_FAILED":             {"The selected Work context could not be copied.", "Check the selected managed Skill and retry selection.", false},
	"CONTEXT_NOT_FOUND":               {"The required Work context is unavailable.", "Select a current Work context and retry.", false},
	"CONTEXT_FORMAT_UNSUPPORTED":      {"The Work context format is unsupported.", "Create or select a current-format Work context.", false},
	"SKILL_VALIDATION_FAILED":         {"The selected Skill content is invalid.", "Correct the named Skill tree, reselect it, and apply.", false},
	"SKILL_LOAD_FAILED":               {"The selected Skill could not be loaded.", "Correct SDK-compatible Skill content, reselect it, and apply.", false},
	"SKILL_DIRECTORY_MISMATCH":        {"The Skill was loaded from an unexpected directory.", "Correct Work context binding and retry.", false},
	"PACKAGE_LOAD_FAILED":             {"A selected package could not be loaded.", "Update the package for the selected agent image and retry.", false},
	"MCP_INITIALIZATION_FAILED":       {"A required Work MCP server could not be initialized.", "Inspect the MCP server configuration and retry the Work operation.", true},
	"RUNTIME_PREPARE_FAILED":          {"The Work runtime could not be prepared.", "Restore the runtime dependency and retry with a new key.", true},
	"RUNTIME_START_FAILED":            {"The Work runtime could not be started.", "Restore the runtime dependency and retry with a new key.", true},
	"AGENT_CONTEXT_INCOMPATIBLE":      {"The agent runtime does not support this Work context contract.", "Deploy a compatible Core and agentd image, then explicitly select it for this Work.", false},
	"AGENT_CONTEXT_MISMATCH":          {"The agent runtime reported a different Work context.", "Correct runtime context binding before retrying.", false},
	"AGENT_EXITED":                    {"The agent runtime exited before becoming ready.", "Inspect this Operation and correct the runtime cause before retrying.", true},
	"AGENT_READINESS_TIMEOUT":         {"The agent runtime did not become ready in time.", "Inspect this Operation and correct the runtime cause before retrying.", true},
	"WORK_BUSY":                       {"The Work has an active Run.", "Wait for the active Run to finish, then apply with a new key.", true},
	"ROLLBACK_FAILED":                 {"The previous Work runtime could not be restored.", "Restore the runtime dependency and retry the retained active context.", true},
	"DIAGNOSTIC_COLLECTION_FAILED":    {"Runtime diagnostics could not be collected.", "Restore Docker access before retrying.", true},
	"DIAGNOSTIC_PERSIST_FAILED":       {"Operation diagnostics could not be persisted.", "Restore Core storage before retrying.", true},
	"HISTORY_BACKUP_CLEANUP_REQUIRED": {"Obsolete history backup cleanup needs retry.", "Core retries cleanup during Work reconciliation; inspect storage permissions if it persists.", true},
	"INVALID_SERVICE_DEFINITION":      {"The service definition is invalid.", "Correct the identified service field and submit a new request.", false},
	"UNSUPPORTED_SERVICE_OPTION":      {"The service definition contains an unsupported option.", "Remove the unsupported option and submit a new request.", false},
	"SERVICE_FORMAT_UNSUPPORTED":      {"The stored service format is unsupported.", "Create a new service definition with the current pre-0.1 version.", false},
	"IMAGE_UNAVAILABLE":               {"The selected service image is unavailable.", "Restore access to the captured image and retry the service.", true},
	"MOUNT_DENIED":                    {"The requested service storage mount is not allowed.", "Use only the Work workspace mount and retry.", false},
	"QUOTA_EXCEEDED":                  {"The service exceeds an available resource quota.", "Reduce the service allocation or free Work capacity before retrying.", true},
	"SERVICE_START_FAILED":            {"The service runtime could not be started.", "Inspect the service Operation and bounded logs, then retry.", true},
	"SERVICE_EXITED":                  {"The service exited before it became ready.", "Inspect bounded service logs and correct the startup command before retrying.", true},
	"SERVICE_READINESS_TIMEOUT":       {"The service did not become ready before its deadline.", "Inspect the readiness probe and bounded service logs before retrying.", true},
	"DOCKER_UNAVAILABLE":              {"The service container runtime is unavailable.", "Restore Docker access and retry the service.", true},
	"OPERATION_SUPERSEDED":            {"The service Operation was superseded by a newer target.", "Observe the newer service Operation instead.", false},
	"WORK_OPERATION_FAILED":           {"The Work operation failed.", "Inspect the identified stage and correct the configuration before retrying.", false},
	"PACKAGE_INCOMPATIBLE":            {"The Work package does not match the target Docker platform.", "Import into a compatible Docker installation.", false},
	"TARGET_MODEL_UNAVAILABLE":        {"The target Core model needed by this Work is unavailable.", "Configure an enabled matching model with a readable credential on the target Core, then import again.", false},
}

func Text(code string) (string, string, bool, bool) {
	w, ok := words[code]
	return w.message, w.remediation, w.retryable, ok
}
