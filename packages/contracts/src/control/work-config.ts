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

export const WorkConfigSchema = Type.Object(
  {
    revision: Type.Integer({ minimum: 1 }),
    agentImage: ArtifactReferenceSchema,
    skills: Type.Array(ArtifactReferenceSchema, { maxItems: 128 }),
    modelRef: ResourceIdSchema,
    mcpServers: Type.Array(McpServerSchema, { maxItems: 128 }),
    resources: ResourcePolicySchema,
    tools: ToolPolicySchema,
  },
  { additionalProperties: false },
);

export type ArtifactReference = Type.Static<typeof ArtifactReferenceSchema>;
export type McpServer = Type.Static<typeof McpServerSchema>;
export type ResourcePolicy = Type.Static<typeof ResourcePolicySchema>;
export type WorkConfig = Type.Static<typeof WorkConfigSchema>;
