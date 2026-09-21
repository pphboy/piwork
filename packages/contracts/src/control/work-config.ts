import { Type } from "typebox";
import {
  DigestSchema,
  IdentifierSchema,
  ResourceIdSchema,
  SecretReferenceSchema,
} from "../common.js";

export const ArtifactReferenceSchema = Type.Object(
  {
    catalogId: ResourceIdSchema,
    digest: Type.Optional(DigestSchema),
  },
  { additionalProperties: false },
);

/** Public image selection. Resolved image identities are internal snapshot data. */
export const ImageSelectionSchema = Type.Object(
  { catalogId: ResourceIdSchema },
  { additionalProperties: false },
);

export const SkillNameSchema = Type.String({
  pattern: "^[a-z0-9][a-z0-9-]{0,63}$",
  minLength: 1,
  maxLength: 64,
});

export const SkillSelectionSchema = Type.Array(SkillNameSchema, {
  maxItems: 128,
  uniqueItems: true,
});

export const McpServerSchema = Type.Object(
  {
    serverId: IdentifierSchema,
    transport: Type.Union([Type.Literal("stdio"), Type.Literal("streamable-http")]),
    required: Type.Boolean(),
    command: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096 })),
    args: Type.Optional(Type.Array(Type.String({ maxLength: 4_096 }), { maxItems: 128 })),
    url: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096 })),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 300_000 })),
    secretRefs: Type.Optional(Type.Array(SecretReferenceSchema, { maxItems: 64 })),
    requiredServiceId: Type.Optional(ResourceIdSchema),
  },
  { additionalProperties: false },
);

export const ResourcePolicySchema = Type.Object(
  {
    cpuMillis: Type.Integer({ minimum: 100, maximum: 128_000 }),
    memoryBytes: Type.Integer({ minimum: 64 * 1_024 * 1_024 }),
    maxServices: Type.Integer({ minimum: 0, maximum: 1_000 }),
    maxRetainedVolumes: Type.Integer({ minimum: 0, maximum: 10_000 }),
  },
  { additionalProperties: false },
);

export const ToolPolicySchema = Type.Object(
  {
    allowed: Type.Array(IdentifierSchema, { maxItems: 256, uniqueItems: true }),
    denied: Type.Array(IdentifierSchema, { maxItems: 256, uniqueItems: true }),
  },
  { additionalProperties: false },
);

/** Pi SDK tools that are available inside the isolated Work container. */
export const BUILT_IN_WORK_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

export type BuiltInWorkTool = typeof BUILT_IN_WORK_TOOLS[number];

export const AGENTS_MD_MAX_BYTES = 256 * 1024;

export function normalizeAgentsMd(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("agentsMd must be a string");
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > AGENTS_MD_MAX_BYTES) throw new RangeError(`agentsMd exceeds ${AGENTS_MD_MAX_BYTES} bytes`);
  return value;
}

export function resolveBuiltInWorkTools(policy: WorkConfig["tools"]): BuiltInWorkTool[] {
  const allowed = new Set(policy.allowed);
  const denied = new Set(policy.denied);
  const names = BUILT_IN_WORK_TOOLS.filter((name) => (allowed.size === 0 || allowed.has(name)) && !denied.has(name));
  return [...names];
}

export const WorkConfigSchema = Type.Object(
  {
    agentImage: ImageSelectionSchema,
    skills: SkillSelectionSchema,
    agentsMd: Type.String({ maxLength: AGENTS_MD_MAX_BYTES }),
    modelRef: ResourceIdSchema,
    mcpServers: Type.Array(McpServerSchema, { maxItems: 128 }),
    resources: ResourcePolicySchema,
    tools: ToolPolicySchema,
  },
  { additionalProperties: false },
);

export const RuntimeSkillSchema = Type.Object(
  {
    name: SkillNameSchema,
    loaded: Type.Literal(true),
    modelVisible: Type.Boolean(),
    visibilityReason: Type.Union([
      Type.Null(), Type.Literal("model-invocation-disabled"), Type.Literal("read-tools-disabled"),
    ]),
  },
  { additionalProperties: false },
);

export const RuntimeSkillStateSchema = Type.Object(
  {
    state: Type.Union([Type.Literal("ready"), Type.Literal("initializing"), Type.Literal("failed"), Type.Literal("unavailable")]),
    checkedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    skills: Type.Array(RuntimeSkillSchema, { maxItems: 128 }),
  },
  { additionalProperties: false },
);

/** Revision-free public state for one Work's effective context. */
export const WorkConfigurationViewSchema = Type.Object(
  {
    workId: ResourceIdSchema,
    active: Type.Union([WorkConfigSchema, Type.Null()]),
    desired: WorkConfigSchema,
    pendingApply: Type.Boolean(),
    runtime: RuntimeSkillStateSchema,
  },
  { additionalProperties: false },
);

/** Whole-context replacement. Unknown legacy revision fields are rejected. */
export const SetWorkConfigurationRequestSchema = Type.Object(
  { configuration: WorkConfigSchema },
  { additionalProperties: false },
);

/** Presence of skills is significant: omitted preserves/inherits; [] clears. */
export const WorkConfigurationPatchSchema = Type.Partial(WorkConfigSchema, {
  additionalProperties: false,
});

export const SetWorkSkillsRequestSchema = Type.Object(
  { skills: SkillSelectionSchema },
  { additionalProperties: false },
);

export const SetWorkAgentsRequestSchema = Type.Object(
  { agentsMd: Type.String({ maxLength: AGENTS_MD_MAX_BYTES }) },
  { additionalProperties: false },
);

export type ArtifactReference = Type.Static<typeof ArtifactReferenceSchema>;
export type ImageSelection = Type.Static<typeof ImageSelectionSchema>;
export type SkillName = Type.Static<typeof SkillNameSchema>;
export type SkillSelection = Type.Static<typeof SkillSelectionSchema>;
export type McpServer = Type.Static<typeof McpServerSchema>;
export type ResourcePolicy = Type.Static<typeof ResourcePolicySchema>;
export type WorkConfig = Type.Static<typeof WorkConfigSchema>;
export type RuntimeSkill = Type.Static<typeof RuntimeSkillSchema>;
export type RuntimeSkillState = Type.Static<typeof RuntimeSkillStateSchema>;
export type WorkConfigurationView = Type.Static<typeof WorkConfigurationViewSchema>;
export type SetWorkConfigurationRequest = Type.Static<typeof SetWorkConfigurationRequestSchema>;
export type WorkConfigurationPatch = Type.Static<typeof WorkConfigurationPatchSchema>;
export type SetWorkSkillsRequest = Type.Static<typeof SetWorkSkillsRequestSchema>;
export type SetWorkAgentsRequest = Type.Static<typeof SetWorkAgentsRequestSchema>;
