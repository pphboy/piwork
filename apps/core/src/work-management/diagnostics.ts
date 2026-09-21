import type {
  DiagnosticCode,
  DiagnosticStage,
  OperationDiagnostics,
  PublicOperation,
  SafeDiagnostic,
  SafeTerminalStageEvent,
} from "@piwork/contracts";
import type { OperationRecord } from "@piwork/core-store";

const messages: Record<DiagnosticCode, readonly [string, string, boolean]> = {
  CONTEXT_COPY_FAILED: ["The selected Work context could not be copied.", "Check the selected managed Skill and retry selection.", false],
  CONTEXT_NOT_FOUND: ["The required Work context is unavailable.", "Select a current Work context and retry.", false],
  CONTEXT_FORMAT_UNSUPPORTED: ["The Work context format is unsupported.", "Create or select a current-format Work context.", false],
  SKILL_VALIDATION_FAILED: ["The selected Skill content is invalid.", "Correct the named Skill tree, reselect it, and apply.", false],
  SKILL_LOAD_FAILED: ["The selected Skill could not be loaded.", "Correct SDK-compatible Skill content, reselect it, and apply.", false],
  SKILL_DIRECTORY_MISMATCH: ["The Skill was loaded from an unexpected directory.", "Correct Work context binding and retry.", false],
  RUNTIME_PREPARE_FAILED: ["The Work runtime could not be prepared.", "Restore the runtime dependency and retry with a new key.", true],
  RUNTIME_START_FAILED: ["The Work runtime could not be started.", "Restore the runtime dependency and retry with a new key.", true],
  AGENT_CONTEXT_INCOMPATIBLE: ["The agent runtime does not support this Work context contract.", "Deploy a compatible Core and agentd image, then explicitly select it for this Work.", false],
  AGENT_CONTEXT_MISMATCH: ["The agent runtime reported a different Work context.", "Correct runtime context binding before retrying.", false],
  AGENT_EXITED: ["The agent runtime exited before becoming ready.", "Inspect this Operation and correct the runtime cause before retrying.", true],
  AGENT_READINESS_TIMEOUT: ["The agent runtime did not become ready in time.", "Inspect this Operation and correct the runtime cause before retrying.", true],
  WORK_BUSY: ["The Work has an active Run.", "Wait for the active Run to finish, then apply with a new key.", true],
  ROLLBACK_FAILED: ["The previous Work runtime could not be restored.", "Restore the runtime dependency and retry the retained active context.", true],
  DIAGNOSTIC_COLLECTION_FAILED: ["Runtime diagnostics could not be collected.", "Restore Docker access before retrying.", true],
  DIAGNOSTIC_PERSIST_FAILED: ["Operation diagnostics could not be persisted.", "Restore Core storage before retrying.", true],
  WORK_OPERATION_FAILED: ["The Work operation failed.", "Inspect the identified stage and correct the configuration before retrying.", false],
};

export function emptyOperationDiagnostics(): OperationDiagnostics {
  return { stages: [], truncated: false, rollback: { state: "not-required" }, diagnosticCollection: { state: "not-attempted" } };
}

export function safeDiagnostic(code: DiagnosticCode, stage: DiagnosticStage, input: {
  readonly field?: string;
  readonly skillName?: string;
  readonly exitCode?: number;
} = {}): SafeDiagnostic {
  const [message, remediation, retryable] = messages[code];
  return { code, stage, message, remediation, retryable, ...input };
}

export function diagnosticFromError(error: unknown, stage: DiagnosticStage, input: { readonly skillName?: string; readonly field?: string; readonly exitCode?: number } = {}): SafeDiagnostic {
  const item = error as { code?: unknown; name?: unknown; stage?: unknown; skillName?: unknown; exitCode?: unknown };
  const code = typeof item.code === "string" && item.code in messages
    ? item.code as DiagnosticCode
    : item.name === "RequiredSkillError" ? "SKILL_LOAD_FAILED"
      : item.name === "WorkContextError" ? "SKILL_VALIDATION_FAILED"
        : "WORK_OPERATION_FAILED";
  const resolvedStage = typeof item.stage === "string" && [
    "context-copy", "context-validate", "runtime-prepare", "runtime-start", "skill-validate",
    "skill-load", "readiness", "activation", "rollback",
  ].includes(item.stage) ? item.stage as DiagnosticStage : stage;
  return safeDiagnostic(code, resolvedStage, {
    ...input,
    ...(input.skillName === undefined && typeof item.skillName === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(item.skillName)
      ? { skillName: item.skillName } : {}),
    ...(input.exitCode === undefined && typeof item.exitCode === "number" && Number.isInteger(item.exitCode)
      ? { exitCode: item.exitCode } : {}),
  });
}

export function appendStage(diagnostics: OperationDiagnostics, stage: DiagnosticStage, outcome: SafeTerminalStageEvent["outcome"], diagnostic: SafeDiagnostic, now: string, component: "core" | "agentd" = "core"): OperationDiagnostics {
  const stages = [...diagnostics.stages, {
    timestamp: now, component, stage, outcome, code: diagnostic.code,
    message: outcome === "failed" ? diagnostic.message : terminalStageMessage(stage, outcome),
    ...(diagnostic.skillName === undefined ? {} : { skillName: diagnostic.skillName }),
  }];
  let truncated = diagnostics.truncated;
  while (stages.length > 64 || Buffer.byteLength(JSON.stringify(stages), "utf8") > 64 * 1024) {
    stages.shift(); truncated = true;
  }
  return { ...diagnostics, stages, truncated };
}

function terminalStageMessage(stage: DiagnosticStage, outcome: "succeeded" | "failed" | "interrupted"): string {
  if (outcome === "interrupted") return "Work operation stage was interrupted and will be recovered.";
  const messagesByStage: Record<DiagnosticStage, string> = {
    "context-copy": "Work context content was copied.",
    "context-validate": "Work context ownership and metadata were validated.",
    "runtime-prepare": "Work runtime dependencies were prepared.",
    "runtime-start": "Work runtime was started.",
    "skill-validate": "Work Skill directories were validated.",
    "skill-load": "Work Skills were validated by the agent SDK.",
    readiness: "Work runtime readiness was verified.",
    activation: "Work configuration activation completed.",
    rollback: "The previous Work runtime was restored.",
  };
  return messagesByStage[stage];
}

export function publicOperation(record: OperationRecord): PublicOperation {
  const resultEnvelope = parseResult(record.resultJson);
  const error = parseError(record.errorJson);
  return {
    operationId: record.id,
    workId: record.workId ?? "work-unavailable",
    kind: record.kind,
    state: record.state,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    correlationId: resultEnvelope.correlationId ?? record.id,
    result: resultEnvelope.result,
    error,
    diagnostics: resultEnvelope.diagnostics,
  };
}

/**
 * Adds a terminal stage without trusting or exposing arbitrary persisted JSON.
 * The returned envelope can be committed with the Operation state in one store
 * update, so a restart always sees either the previous envelope or this one.
 */
export function operationWithStage(input: {
  readonly record: OperationRecord;
  readonly stage: DiagnosticStage;
  readonly outcome: SafeTerminalStageEvent["outcome"];
  readonly diagnostic: SafeDiagnostic;
  readonly timestamp: string;
  readonly result?: PublicOperation["result"];
  readonly component?: "core" | "agentd";
  readonly rollback?: OperationDiagnostics["rollback"];
  readonly diagnosticCollection?: OperationDiagnostics["diagnosticCollection"];
}): { readonly resultJson: string; readonly diagnostics: OperationDiagnostics } {
  const existing = parseResult(input.record.resultJson);
  const appended = appendStage(
    existing.diagnostics,
    input.stage,
    input.outcome,
    input.diagnostic,
    input.timestamp,
    input.component,
  );
  const diagnostics: OperationDiagnostics = {
    ...appended,
    rollback: input.rollback ?? appended.rollback,
    diagnosticCollection: input.diagnosticCollection ?? appended.diagnosticCollection,
  };
  return {
    diagnostics,
    resultJson: operationEnvelope({
      correlationId: existing.correlationId ?? input.record.id,
      result: input.result ?? existing.result,
      diagnostics,
    }),
  };
}

export function operationEnvelope(input: {
  readonly correlationId: string;
  readonly result?: PublicOperation["result"];
  readonly diagnostics?: OperationDiagnostics;
}): string {
  return JSON.stringify({ correlationId: input.correlationId, result: input.result ?? null, diagnostics: input.diagnostics ?? emptyOperationDiagnostics() });
}

export function errorEnvelope(error: SafeDiagnostic): string { return JSON.stringify(error); }

export interface JsonLineLogger {
  write(line: string): void;
}

const stderrLogger: JsonLineLogger = { write: (line) => process.stderr.write(line) };
const skillNamePattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const nonFailureMessages: Partial<Record<`${DiagnosticStage}:${"started" | "succeeded" | "interrupted"}`, string>> = {
  "context-copy:started": "Work context copy started.",
  "context-copy:succeeded": "Work context content was copied.",
  "context-validate:succeeded": "Work context ownership and metadata were validated.",
  "runtime-prepare:started": "Work runtime preparation started.",
  "runtime-prepare:succeeded": "Work runtime dependencies were prepared.",
  "runtime-start:started": "Work runtime reconciliation started.",
  "runtime-start:succeeded": "Work runtime was started.",
  "skill-validate:succeeded": "Work Skill directories were validated.",
  "skill-load:succeeded": "Work Skills were validated by the agent SDK.",
  "activation:succeeded": "Work configuration activation completed.",
  "readiness:succeeded": "Work runtime readiness was verified.",
  "rollback:succeeded": "The previous Work runtime was restored.",
  "runtime-start:interrupted": "Work runtime reconciliation was interrupted and will be recovered.",
};

export function emitDiagnostic(input: {
  readonly timestamp: string;
  readonly level: "info" | "warn" | "error";
  readonly component: "core" | "agentd";
  readonly stage: DiagnosticStage;
  readonly outcome: "started" | "succeeded" | "failed" | "interrupted";
  readonly correlationId: string;
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly workId?: string;
  readonly operationId?: string;
  readonly skillName?: string;
}, logger: JsonLineLogger = stderrLogger): void {
  const skillName = input.skillName !== undefined && skillNamePattern.test(input.skillName)
    ? input.skillName
    : undefined;
  const diagnostic = safeDiagnostic(input.code, input.stage, ...(skillName === undefined ? [] : [{ skillName }]));
  const message = input.outcome === "failed"
    ? diagnostic.message
    : nonFailureMessages[`${input.stage}:${input.outcome}`] ?? "Work operation state changed.";
  logger.write(`${JSON.stringify({
    timestamp: input.timestamp, level: input.level, component: input.component,
    stage: input.stage, outcome: input.outcome, correlationId: input.correlationId,
    code: diagnostic.code, message,
    ...(input.workId === undefined ? {} : { workId: input.workId }),
    ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
    ...(diagnostic.skillName === undefined ? {} : { skillName: diagnostic.skillName }),
  })}\n`);
}

function parseResult(value: string | null): { readonly correlationId?: string; readonly result: PublicOperation["result"]; readonly diagnostics: OperationDiagnostics } {
  try {
    const parsed = JSON.parse(value ?? "null") as Partial<{ correlationId: string; result: PublicOperation["result"]; diagnostics: OperationDiagnostics }>;
    return { correlationId: parsed.correlationId, result: parsed.result ?? null, diagnostics: parsed.diagnostics ?? emptyOperationDiagnostics() };
  } catch { return { result: null, diagnostics: emptyOperationDiagnostics() }; }
}

function parseError(value: string | null): SafeDiagnostic | null {
  try {
    const parsed = JSON.parse(value ?? "null") as Partial<SafeDiagnostic> | null;
    if (parsed === null || typeof parsed.code !== "string" || !(parsed.code in messages) || typeof parsed.stage !== "string") return null;
    return safeDiagnostic(parsed.code as DiagnosticCode, parsed.stage as DiagnosticStage, {
      ...(typeof parsed.field === "string" ? { field: parsed.field } : {}),
      ...(typeof parsed.skillName === "string" ? { skillName: parsed.skillName } : {}),
      ...(typeof parsed.exitCode === "number" ? { exitCode: parsed.exitCode } : {}),
    });
  } catch { return null; }
}
