type DiagnosticStage =
  | "context-copy" | "context-validate" | "runtime-prepare" | "runtime-start"
  | "skill-validate" | "skill-load" | "package-load" | "mcp-initialize"
  | "readiness" | "activation" | "rollback" | "service-accept"
  | "service-image" | "service-storage" | "service-start" | "service-readiness"
  | "service-recovery" | "service-stop" | "service-remove";

export interface JsonLineLogger {
  write(line: string): void;
}

const stderrLogger: JsonLineLogger = { write: (line) => process.stderr.write(line) };
const skillNamePattern = /^[a-z0-9][a-z0-9-]{0,63}$/;

const messages = {
  CONTEXT_COPY_FAILED: "The Work context could not be prepared.",
  CONTEXT_NOT_FOUND: "The required Work context is unavailable.",
  CONTEXT_FORMAT_UNSUPPORTED: "The Work context format is unsupported.",
  SKILL_VALIDATION_FAILED: "The selected Skill content is invalid.",
  SKILL_LOAD_FAILED: "Work context Skill initialization failed.",
  SKILL_DIRECTORY_MISMATCH: "A Skill was loaded from an unexpected directory.",
  PACKAGE_LOAD_FAILED: "A selected package could not be loaded in this agent environment.",
  MCP_INITIALIZATION_FAILED: "Required Work MCP tools could not be initialized.",
  RUNTIME_PREPARE_FAILED: "The Work runtime could not be prepared.",
  RUNTIME_START_FAILED: "The Work runtime could not be started.",
  AGENT_CONTEXT_INCOMPATIBLE: "The agent runtime does not support this Work context contract.",
  AGENT_CONTEXT_MISMATCH: "The agent runtime reported a different Work context.",
  AGENT_EXITED: "The agent runtime exited during initialization.",
  AGENT_READINESS_TIMEOUT: "The agent runtime did not become ready in time.",
  WORK_BUSY: "The Work has an active Run.",
  ROLLBACK_FAILED: "The previous Work runtime could not be restored.",
  DIAGNOSTIC_COLLECTION_FAILED: "Runtime diagnostics could not be collected.",
  DIAGNOSTIC_PERSIST_FAILED: "Operation diagnostics could not be persisted.",
  INVALID_SERVICE_DEFINITION: "The service definition is invalid.",
  UNSUPPORTED_SERVICE_OPTION: "The service definition contains an unsupported option.",
  SERVICE_FORMAT_UNSUPPORTED: "The stored service format is unsupported.",
  IMAGE_UNAVAILABLE: "The selected service image is unavailable.",
  MOUNT_DENIED: "The requested service storage mount is not allowed.",
  QUOTA_EXCEEDED: "The service exceeds an available resource quota.",
  SERVICE_START_FAILED: "The service runtime could not be started.",
  SERVICE_EXITED: "The service exited before it became ready.",
  SERVICE_READINESS_TIMEOUT: "The service did not become ready before its deadline.",
  DOCKER_UNAVAILABLE: "The service container runtime is unavailable.",
  OPERATION_SUPERSEDED: "The service Operation was superseded.",
  WORK_OPERATION_FAILED: "The Work operation failed.",
  PACKAGE_INCOMPATIBLE: "The Work package does not match the target Docker platform.",
  TARGET_MODEL_UNAVAILABLE: "The target Core model needed by this Work is unavailable.",
} satisfies Record<string, string>;

type DiagnosticCode = keyof typeof messages;

/** Emits only server-authored text. Callers must never include caught errors here. */
export function emitAgentDiagnostic(input: {
  readonly stage: DiagnosticStage;
  readonly outcome: "started" | "succeeded" | "failed" | "interrupted";
  readonly code: DiagnosticCode;
  readonly correlationId: string;
  readonly workId?: string;
  readonly skillName?: string;
}, logger: JsonLineLogger = stderrLogger): void {
  const skillName = input.skillName !== undefined && skillNamePattern.test(input.skillName)
    ? input.skillName
    : undefined;
  const message = input.outcome === "succeeded" && input.stage === "skill-load"
    ? "Work context Skills were validated by the SDK."
    : input.outcome === "succeeded" && input.stage === "package-load"
      ? "Selected Work packages were loaded."
    : input.outcome === "succeeded" && input.stage === "mcp-initialize"
      ? "Required Work MCP tools were initialized."
    : messages[input.code];
  logger.write(`${JSON.stringify({
    timestamp: new Date().toISOString(),
    level: input.outcome === "failed" ? "error" : "info",
    component: "agentd",
    stage: input.stage,
    outcome: input.outcome,
    correlationId: input.correlationId,
    code: input.code,
    message,
    ...(input.workId === undefined ? {} : { workId: input.workId }),
    ...(skillName === undefined ? {} : { skillName }),
  })}\n`);
}
