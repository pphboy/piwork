import { Type } from "typebox";
import { IdentifierSchema, ResourceIdSchema, TimestampSchema } from "./harness.js";
import { Check } from "typebox/value";

export const WORK_FEEDBACK_CONTRACT_VERSION = 1;
export const RUN_MODEL_CONTRACT_VERSION = 1;
export const BRAIN_PACKAGE_NAME = "piwork-brain";
export const BRAIN_LIMITS = Object.freeze({
  eventBytes: 64 * 1024, goalBytes: 8 * 1024, liveRequests: 100,
  autoRuns: 4, runTimeoutMs: 30 * 60 * 1000, requestTimeoutMs: 24 * 60 * 60 * 1000,
  applyTimeoutMs: 7 * 24 * 60 * 60 * 1000, pollMs: 5000, interactiveYieldMs: 1000,
  experienceEntries: 100, experienceRuleBytes: 4 * 1024, cognitionBytes: 64 * 1024,
});
const strict = { additionalProperties: false } as const;
const nullableId = Type.Union([IdentifierSchema, Type.Null()]);
const name = Type.String({ pattern: "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$" });
const jsonObject = Type.Record(Type.String(), Type.Unknown());

export const RunModelDescriptionSchema = Type.Object({
  modelRef: Type.Union([ResourceIdSchema, Type.Null()]),
  label: Type.String({ minLength: 1, maxLength: 256 }),
  provider: Type.String({ minLength: 1, maxLength: 128 }),
  model: Type.String({ minLength: 1, maxLength: 256 }),
}, strict);
export const RunModelListSchema = Type.Object({
  models: Type.Array(RunModelDescriptionSchema, { maxItems: 256 }),
  defaultModel: RunModelDescriptionSchema,
  checkedAt: TimestampSchema,
  availability: Type.Union([Type.Literal("available"), Type.Literal("unavailable")]),
}, strict);
export const SubmitRunInputSchema = Type.Object({
  sessionId: IdentifierSchema,
  submissionKey: Type.String({ minLength: 1, maxLength: 256 }),
  prompt: Type.String({ minLength: 1 }),
  modelRef: Type.Optional(Type.Union([ResourceIdSchema, Type.Null()])),
}, strict);
export const SetSessionModelSchema = Type.Object({
  modelRef: Type.Union([ResourceIdSchema, Type.Null()]),
}, strict);
export const RunModelSelectorSchema = Type.Union([
  Type.Object({ kind: Type.Literal("session-preference") }, strict),
  Type.Object({ kind: Type.Literal("work-default") }, strict),
  Type.Object({ kind: Type.Literal("model"), modelRef: ResourceIdSchema }, strict),
]);
export const AgentRunSourceSchema = Type.Object({
  kind: Type.Union([Type.Literal("chat"), Type.Literal("service")]),
  requestId: Type.Optional(IdentifierSchema),
  serviceName: Type.Optional(name),
  phase: Type.Optional(Type.Union([Type.Literal("handling"), Type.Literal("verifying"), Type.Literal("adopting")])),
}, strict);

export const ServiceConnectionSchema = Type.Object({
  contractVersion: Type.Literal(1), serviceName: name, apiPortName: name,
  mode: Type.Union([Type.Literal("pi-managed"), Type.Literal("external")]),
}, strict);
const query = Type.Object({ inputSchema: jsonObject, description: Type.String({ maxLength: 2048 }) }, strict);
const action = Type.Object({
  inputSchema: jsonObject, description: Type.String({ maxLength: 2048 }),
  mutation: Type.Boolean(), requiresExpectedStateVersion: Type.Boolean(),
  verificationQuery: name,
  mode: Type.Union([Type.Literal("sync"), Type.Literal("async")]),
  maxWaitMs: Type.Integer({ minimum: 1, maximum: BRAIN_LIMITS.requestTimeoutMs }),
}, strict);
export const ServiceCapabilitiesSchema = Type.Object({
  contractVersion: Type.Literal(1), logicalServiceName: name,
  codeVersion: IdentifierSchema, stateVersion: IdentifierSchema,
  queries: Type.Record(name, query), actions: Type.Record(name, action),
  events: Type.Object({
    facts: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 128 }),
    requestReasons: Type.Array(name, { maxItems: 64 }),
  }, strict),
  jobs: Type.Boolean(),
}, strict);
export const ServiceEventSchema = Type.Object({
  contractVersion: Type.Literal(1), eventId: IdentifierSchema,
  origin: Type.Object({ workId: ResourceIdSchema, serviceId: ResourceIdSchema }, strict),
  serviceName: name, type: Type.String({ minLength: 1, maxLength: 128 }),
  occurredAt: TimestampSchema, stateVersion: IdentifierSchema,
  entityRef: Type.Optional(nullableId), actionId: Type.Optional(nullableId),
  jobId: Type.Optional(nullableId), causationRequestId: Type.Optional(nullableId),
  actor: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("agent"), Type.Literal("service")])),
  payload: jsonObject,
}, strict);
export const AgentRequestedPayloadSchema = Type.Object({
  reason: name, goal: Type.String({ minLength: 1, maxLength: BRAIN_LIMITS.goalBytes }),
  evidenceRefs: Type.Array(IdentifierSchema, { maxItems: 100 }),
}, strict);
export const BusinessOperationStateSchema = Type.Union(
  [Type.Literal("accepted"), Type.Literal("running"), Type.Literal("succeeded"), Type.Literal("failed"), Type.Literal("cancelled")],
);
export const ServiceQueryResultSchema = Type.Object({
  stateVersion: IdentifierSchema, codeVersion: IdentifierSchema, observedAt: TimestampSchema,
  value: Type.Unknown(),
  checks: Type.Optional(Type.Array(Type.Object({
    name: IdentifierSchema, passed: Type.Boolean(), summary: Type.String({ maxLength: 2048 }),
  }, strict), { maxItems: 100 })),
}, strict);
export const ServiceActionResultSchema = Type.Object({
  actionId: IdentifierSchema, actionName: name, input: Type.Unknown(),
  expectedStateVersion: Type.Union([IdentifierSchema, Type.Null()]),
  state: BusinessOperationStateSchema, stateVersion: IdentifierSchema, observedAt: TimestampSchema,
  result: Type.Optional(Type.Unknown()), jobId: Type.Optional(nullableId),
  error: Type.Optional(Type.Object({ code: IdentifierSchema, message: Type.String({ maxLength: 2048 }) }, strict)),
}, strict);
export const ServiceJobResultSchema = Type.Object({
  jobId: IdentifierSchema, actionId: IdentifierSchema, state: BusinessOperationStateSchema,
  observedAt: TimestampSchema, deadlineAt: TimestampSchema,
  artifacts: Type.Array(Type.String({ minLength: 1, maxLength: 1024 }), { maxItems: 100 }),
  result: Type.Optional(Type.Unknown()),
  error: Type.Optional(Type.Object({ code: IdentifierSchema, message: Type.String({ maxLength: 2048 }) }, strict)),
}, strict);

export const AgentRequestStateSchema = Type.Union(
  [Type.Literal("pending"), Type.Literal("running"), Type.Literal("waiting_result"), Type.Literal("waiting_apply"), Type.Literal("cancelling"),
    Type.Literal("completed"), Type.Literal("failed"), Type.Literal("cancelled"), Type.Literal("needs_attention")],
);
export const AgentRequestDispositionSchema = Type.Union([Type.Literal("live"), Type.Literal("historical")]);
export const AgentWaitRefSchema = Type.Object({
  kind: Type.Union([Type.Literal("job"), Type.Literal("action"), Type.Literal("package-operation"), Type.Literal("apply")]),
  serviceName: Type.Optional(name), id: IdentifierSchema,
  deadlineAt: TimestampSchema,
  nextPhase: Type.Union([Type.Literal("verifying"), Type.Literal("adopting")]),
  verificationGoal: Type.String({ minLength: 1, maxLength: BRAIN_LIMITS.goalBytes }),
}, strict);
export const AgentEvidenceSchema = Type.Object({
  evidenceId: IdentifierSchema, runId: Type.Union([IdentifierSchema, Type.Null()]),
  requestId: Type.Union([IdentifierSchema, Type.Null()]), serviceName: Type.Optional(name),
  kind: Type.Union([Type.Literal("query"), Type.Literal("action"), Type.Literal("job"), Type.Literal("artifact"), Type.Literal("event"), Type.Literal("package"), Type.Literal("sdk")]),
  objectRef: Type.String({ minLength: 1, maxLength: 1024 }),
  observedAt: TimestampSchema, stateVersion: Type.Optional(IdentifierSchema), codeVersion: Type.Optional(IdentifierSchema),
  summary: Type.String({ maxLength: 8192 }), verified: Type.Boolean(),
}, strict);
export const AgentRequestSchema = Type.Object({
  requestId: IdentifierSchema, source: AgentRunSourceSchema, goal: Type.String({ minLength: 1, maxLength: BRAIN_LIMITS.goalBytes }),
  state: AgentRequestStateSchema, disposition: AgentRequestDispositionSchema,
  createdAt: TimestampSchema, updatedAt: TimestampSchema, expiresAt: TimestampSchema,
  retryOf: Type.Union([IdentifierSchema, Type.Null()]),
  autoRunCount: Type.Integer({ minimum: 0, maximum: BRAIN_LIMITS.autoRuns }),
  waitRef: Type.Union([AgentWaitRefSchema, Type.Null()]),
  runIds: Type.Array(IdentifierSchema), evidenceIds: Type.Array(IdentifierSchema),
  evidenceCount: Type.Optional(Type.Integer({ minimum: 0 })), evidenceTruncated: Type.Optional(Type.Boolean()),
  result: Type.Union([Type.String({ maxLength: 32768 }), Type.Null()]),
  error: Type.Union([Type.Object({ code: IdentifierSchema, message: Type.String({ maxLength: 2048 }) }, strict), Type.Null()]),
}, strict);
export const AgentRequestQuerySchema = Type.Object({
  serviceName: Type.Optional(name), state: Type.Optional(AgentRequestStateSchema),
  disposition: Type.Optional(AgentRequestDispositionSchema),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
}, strict);
export const RetryAgentRequestSchema = Type.Object({ submissionKey: Type.String({ minLength: 1, maxLength: 256 }) }, strict);
export const AgentEvidenceQuerySchema = Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })), cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })) }, strict);
export const AgentRequestPageSchema = Type.Object({ items: Type.Array(AgentRequestSchema, { maxItems: 100 }),
  nextCursor: Type.Union([Type.String(), Type.Null()]), checkedAt: TimestampSchema, availability: Type.Literal("available") }, strict);
export const AgentRequestDetailSchema = Type.Object({ request: AgentRequestSchema,
  evidence: Type.Object({ items: Type.Array(AgentEvidenceSchema, { maxItems: 100 }), nextCursor: Type.Union([Type.String(), Type.Null()]) }, strict),
  checkedAt: TimestampSchema, availability: Type.Literal("available") }, strict);
/** Current-agent mTLS only; these descriptors are never public package DTOs. */
export const BrainVerificationTargetSchema = Type.Object({
  contractVersion: Type.Literal(1),
  toolName: Type.String({ pattern: "^package:piwork-brain:(?!brain_feedback$|brain_package_update$)[a-zA-Z][a-zA-Z0-9_-]{0,63}$" }),
  input: jsonObject,
  checkNames: Type.Array(Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$" }), { minItems: 1, maxItems: 8, uniqueItems: true }),
}, strict);
export type BrainVerificationTarget = Type.Static<typeof BrainVerificationTargetSchema>;
export const BrainBehaviorChecksSchema = Type.Array(Type.Object({
  name: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$" }), passed: Type.Boolean(), summary: Type.String({ maxLength: 2048 }),
}, strict), { minItems: 1, maxItems: 100 });
export type BrainBehaviorCheck = Type.Static<typeof BrainBehaviorChecksSchema>[number];
export function isBrainVerificationTarget(value: unknown): value is BrainVerificationTarget {
  if (!Check(BrainVerificationTargetSchema, value)) return false;
  const safeJson = (v: unknown): boolean => {
    if (v === null || typeof v === "boolean") return true;
    if (typeof v === "number") return Number.isFinite(v);
    if (typeof v === "string") return !/(?:https?:\/\/|\bBearer\s+\S+|\/(?:home|run|var|tmp|etc|proc|root|mnt|opt)\/)/i.test(v);
    if (Array.isArray(v)) return v.every(safeJson);
    if (v && typeof v === "object") return Object.entries(v).every(([key, item]) => !/(?:token|credential|secret|password|authorization|privateKey|certificate|hostPath)/i.test(key) && safeJson(item));
    return false;
  };
  try {
    const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
    return bytes(value.input) <= 8 * 1024 && bytes(value) <= 16 * 1024 && safeJson(value.input);
  } catch { return false; }
}
export const BrainCandidateSubmissionSchema = Type.Object({ submissionKey: Type.String({ minLength: 1, maxLength: 256 }),
  requestId: IdentifierSchema, verificationGoal: Type.String({ minLength: 1, maxLength: BRAIN_LIMITS.goalBytes }),
  verificationTarget: BrainVerificationTargetSchema,
  expectedSourceDigest: Type.String({ pattern: "^sha256:[a-f0-9]{64}$" }),
  activeDigest: Type.String({ pattern: "^sha256:[a-f0-9]{64}$" }),
  desiredDigest: Type.String({ pattern: "^sha256:[a-f0-9]{64}$" }), activeContextId: IdentifierSchema }, strict);
export type BrainCandidateSubmission = Type.Static<typeof BrainCandidateSubmissionSchema>;
export interface BrainCandidateState {
  readonly workId: string; readonly active: { digest: string; version: string | null; enabled: boolean; contextId: string } | null;
  readonly desired: { digest: string; version: string | null; enabled: boolean; contextId: string } | null;
  readonly candidate: { operationId: string; state: string; phase: string; sourceDigest: string;
    artifactDigest?: string; version?: string | null; requestId: string; apply?: { operationId: string; state: string }; error?: { code: string; message: string } | null } | null;
}

export type RunModelDescription = Type.Static<typeof RunModelDescriptionSchema>;
/** Private, non-secret descriptor. Endpoint is omitted from public projections. */
export interface RunModelSnapshot extends RunModelDescription { readonly baseUrl?: string }
/** Work-private runtime authority. Never serialize this type in public DTOs. */
export interface ServiceInteractionBinding {
  readonly workId: string; readonly serviceId: string; readonly serviceName: string;
  readonly containerId: string; readonly token: string; readonly address: string;
  readonly ports: readonly { readonly name: string; readonly port: number; readonly protocol: "tcp" | "udp" }[];
}
export function publicRunModel(value: RunModelSnapshot): RunModelDescription {
  return { modelRef: value.modelRef, label: value.label, provider: value.provider, model: value.model };
}
export function normalizeModelBaseUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error("Invalid model endpoint");
  return url.toString().replace(/\/+$/, "");
}
export type RunModelList = Type.Static<typeof RunModelListSchema>;
export function isRunModelList(value: unknown): value is RunModelList { return Check(RunModelListSchema, value); }
export type RunModelSelector = Type.Static<typeof RunModelSelectorSchema>;
export type AgentRunSource = Type.Static<typeof AgentRunSourceSchema>;
export type ServiceConnection = Type.Static<typeof ServiceConnectionSchema>;
export type ServiceCapabilities = Type.Static<typeof ServiceCapabilitiesSchema>;
export type ServiceEvent = Type.Static<typeof ServiceEventSchema>;
export type ServiceQueryResult = Type.Static<typeof ServiceQueryResultSchema>;
export type ServiceActionResult = Type.Static<typeof ServiceActionResultSchema>;
export type ServiceJobResult = Type.Static<typeof ServiceJobResultSchema>;
export type AgentRequestState = Type.Static<typeof AgentRequestStateSchema>;
export type AgentRequestDisposition = Type.Static<typeof AgentRequestDispositionSchema>;
export type AgentWaitRef = Type.Static<typeof AgentWaitRefSchema>;
export type AgentEvidence = Type.Static<typeof AgentEvidenceSchema>;
export type AgentRequest = Type.Static<typeof AgentRequestSchema>;
export type AgentRequestQuery = Type.Static<typeof AgentRequestQuerySchema>;
export type AgentRequestPage = Type.Static<typeof AgentRequestPageSchema>;
export type AgentRequestDetail = Type.Static<typeof AgentRequestDetailSchema>;
export function isAgentRequestPage(value: unknown): value is AgentRequestPage { return Check(AgentRequestPageSchema, value); }
export function isAgentRequestDetail(value: unknown): value is AgentRequestDetail { return Check(AgentRequestDetailSchema, value); }
export function isAgentRequest(value: unknown): value is AgentRequest { return Check(AgentRequestSchema, value); }
export function isAgentEvidence(value: unknown): value is AgentEvidence { return Check(AgentEvidenceSchema, value); }
