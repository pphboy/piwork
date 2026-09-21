import { Type } from "typebox";
import { ResourceIdSchema, TimestampSchema } from "../common.js";
import { SkillNameSchema, WorkConfigurationViewSchema, RuntimeSkillStateSchema } from "./work-config.js";

export const DiagnosticStageSchema = Type.Union([
  Type.Literal("context-copy"), Type.Literal("context-validate"),
  Type.Literal("runtime-prepare"), Type.Literal("runtime-start"),
  Type.Literal("skill-validate"), Type.Literal("skill-load"),
  Type.Literal("readiness"), Type.Literal("activation"), Type.Literal("rollback"),
]);

export const DiagnosticCodeSchema = Type.Union([
  Type.Literal("CONTEXT_COPY_FAILED"), Type.Literal("CONTEXT_NOT_FOUND"),
  Type.Literal("CONTEXT_FORMAT_UNSUPPORTED"), Type.Literal("SKILL_VALIDATION_FAILED"),
  Type.Literal("SKILL_LOAD_FAILED"), Type.Literal("SKILL_DIRECTORY_MISMATCH"),
  Type.Literal("RUNTIME_PREPARE_FAILED"), Type.Literal("RUNTIME_START_FAILED"),
  Type.Literal("AGENT_CONTEXT_INCOMPATIBLE"), Type.Literal("AGENT_CONTEXT_MISMATCH"),
  Type.Literal("AGENT_EXITED"), Type.Literal("AGENT_READINESS_TIMEOUT"),
  Type.Literal("WORK_BUSY"), Type.Literal("ROLLBACK_FAILED"),
  Type.Literal("DIAGNOSTIC_COLLECTION_FAILED"), Type.Literal("DIAGNOSTIC_PERSIST_FAILED"),
  Type.Literal("WORK_OPERATION_FAILED"),
]);

export const SafeDiagnosticSchema = Type.Object({
  code: DiagnosticCodeSchema,
  stage: DiagnosticStageSchema,
  message: Type.String({ minLength: 1, maxLength: 1_024 }),
  retryable: Type.Boolean(),
  remediation: Type.String({ minLength: 1, maxLength: 1_024 }),
  field: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  skillName: Type.Optional(SkillNameSchema),
  exitCode: Type.Optional(Type.Integer()),
}, { additionalProperties: false });

export const SafeTerminalStageEventSchema = Type.Object({
  timestamp: TimestampSchema,
  component: Type.Union([Type.Literal("core"), Type.Literal("agentd")]),
  stage: DiagnosticStageSchema,
  outcome: Type.Union([Type.Literal("succeeded"), Type.Literal("failed"), Type.Literal("interrupted")]),
  code: DiagnosticCodeSchema,
  message: Type.String({ minLength: 1, maxLength: 1_024 }),
  skillName: Type.Optional(SkillNameSchema),
}, { additionalProperties: false });

export const DiagnosticCollectionSchema = Type.Object({
  state: Type.Union([
    Type.Literal("not-attempted"), Type.Literal("available"),
    Type.Literal("unavailable"), Type.Literal("unrecognized"), Type.Literal("truncated"),
  ]),
  code: Type.Optional(Type.Union([DiagnosticCodeSchema, Type.Literal("DIAGNOSTIC_COLLECTION_FAILED")])),
}, { additionalProperties: false });

export const OperationDiagnosticsSchema = Type.Object({
  stages: Type.Array(SafeTerminalStageEventSchema, { maxItems: 64 }),
  truncated: Type.Boolean(),
  rollback: Type.Object({
    state: Type.Union([Type.Literal("not-required"), Type.Literal("succeeded"), Type.Literal("failed")]),
    error: Type.Optional(SafeDiagnosticSchema),
  }, { additionalProperties: false }),
  diagnosticCollection: DiagnosticCollectionSchema,
}, { additionalProperties: false });

export const WorkSkillStateSchema = Type.Object({
  desired: Type.Array(SkillNameSchema, { maxItems: 128, uniqueItems: true }),
  active: Type.Array(SkillNameSchema, { maxItems: 128, uniqueItems: true }),
  pendingApply: Type.Boolean(),
  runtime: RuntimeSkillStateSchema,
}, { additionalProperties: false });

export const AcceptedWorkOperationSchema = Type.Object({
  workId: ResourceIdSchema,
  operationId: ResourceIdSchema,
  reused: Type.Boolean(),
}, { additionalProperties: false });

export const PublicOperationSchema = Type.Object({
  operationId: ResourceIdSchema,
  workId: ResourceIdSchema,
  kind: Type.String({ minLength: 1, maxLength: 128 }),
  state: Type.Union([
    Type.Literal("pending"), Type.Literal("running"), Type.Literal("succeeded"),
    Type.Literal("failed"), Type.Literal("superseded"),
  ]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  correlationId: ResourceIdSchema,
  result: Type.Union([Type.Null(), Type.Object({
    configuration: Type.Optional(WorkConfigurationViewSchema),
    observedState: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  }, { additionalProperties: false })]),
  error: Type.Union([Type.Null(), SafeDiagnosticSchema]),
  diagnostics: OperationDiagnosticsSchema,
}, { additionalProperties: false });

export type DiagnosticStage = Type.Static<typeof DiagnosticStageSchema>;
export type DiagnosticCode = Type.Static<typeof DiagnosticCodeSchema>;
export type SafeDiagnostic = Type.Static<typeof SafeDiagnosticSchema>;
export type SafeTerminalStageEvent = Type.Static<typeof SafeTerminalStageEventSchema>;
export type OperationDiagnostics = Type.Static<typeof OperationDiagnosticsSchema>;
export type WorkSkillState = Type.Static<typeof WorkSkillStateSchema>;
export type AcceptedWorkOperation = Type.Static<typeof AcceptedWorkOperationSchema>;
export type PublicOperation = Type.Static<typeof PublicOperationSchema>;
