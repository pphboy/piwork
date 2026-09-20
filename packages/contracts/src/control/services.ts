import { Type } from "typebox";
import {
  IdentifierSchema,
  ResourceIdSchema,
  SecretReferenceSchema,
} from "../common.js";
import { ArtifactReferenceSchema } from "./work-config.js";

export const ServiceMountSchema = Type.Object(
  {
    volumeId: ResourceIdSchema,
    target: Type.String({ pattern: "^/[^.].*", maxLength: 4_096 }),
    readOnly: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const ServicePortSchema = Type.Object(
  {
    name: IdentifierSchema,
    containerPort: Type.Integer({ minimum: 1, maximum: 65_535 }),
    protocol: Type.Union([Type.Literal("tcp"), Type.Literal("udp")]),
    alias: Type.Optional(IdentifierSchema),
  },
  { additionalProperties: false },
);

export const ReadinessProbeSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal("tcp"), Type.Literal("http"), Type.Literal("exec")]),
    portName: Type.Optional(IdentifierSchema),
    path: Type.Optional(Type.String({ pattern: "^/", maxLength: 2_048 })),
    command: Type.Optional(Type.Array(Type.String({ maxLength: 4_096 }), { minItems: 1, maxItems: 128 })),
    timeoutMs: Type.Integer({ minimum: 1, maximum: 120_000 }),
  },
  { additionalProperties: false },
);

export const ServiceDefinitionSchema = Type.Object(
  {
    serviceId: ResourceIdSchema,
    name: IdentifierSchema,
    revision: Type.Integer({ minimum: 1 }),
    image: ArtifactReferenceSchema,
    command: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096 })),
    args: Type.Array(Type.String({ maxLength: 4_096 }), { maxItems: 128 }),
    environment: Type.Record(IdentifierSchema, Type.String({ maxLength: 16_384 })),
    secretRefs: Type.Array(SecretReferenceSchema, { maxItems: 64 }),
    mounts: Type.Array(ServiceMountSchema, { maxItems: 64 }),
    ports: Type.Array(ServicePortSchema, { maxItems: 64 }),
    cpuMillis: Type.Integer({ minimum: 10, maximum: 128_000 }),
    memoryBytes: Type.Integer({ minimum: 16 * 1_024 * 1_024 }),
    enabled: Type.Boolean(),
    required: Type.Boolean(),
    readiness: Type.Optional(ReadinessProbeSchema),
    restartPolicy: Type.Union([Type.Literal("never"), Type.Literal("bounded")]),
  },
  { additionalProperties: false },
);

export const ServiceDefinitionInputSchema = Type.Omit(ServiceDefinitionSchema, [
  "serviceId",
  "revision",
]);

export type ServiceDefinition = Type.Static<typeof ServiceDefinitionSchema>;
export type ServiceDefinitionInput = Type.Static<typeof ServiceDefinitionInputSchema>;
