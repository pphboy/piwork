import type { DiagnosticCode, DiagnosticStage } from "@piwork/contracts";

export interface JsonLineLogger {
  write(line: string): void;
}

const stderrLogger: JsonLineLogger = { write: (line) => process.stderr.write(line) };
const skillNamePattern = /^[a-z0-9][a-z0-9-]{0,63}$/;

const messages: Record<DiagnosticCode, string> = {
  CONTEXT_COPY_FAILED: "The Work context could not be prepared.",
  CONTEXT_NOT_FOUND: "The required Work context is unavailable.",
  CONTEXT_FORMAT_UNSUPPORTED: "The Work context format is unsupported.",
  SKILL_VALIDATION_FAILED: "The selected Skill content is invalid.",
  SKILL_LOAD_FAILED: "Work context Skill initialization failed.",
  SKILL_DIRECTORY_MISMATCH: "A Skill was loaded from an unexpected directory.",
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
  WORK_OPERATION_FAILED: "The Work operation failed.",
};

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
