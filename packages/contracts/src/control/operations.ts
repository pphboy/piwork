import { Type } from "typebox";
import { ResourceIdSchema, TimestampSchema } from "../common.js";
import { ApiErrorSchema } from "./errors.js";

export const OperationStateSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("running"),
  Type.Literal("succeeded"),
  Type.Literal("failed"),
  Type.Literal("superseded"),
]);

export const OperationSchema = Type.Object(
  {
    id: ResourceIdSchema,
    workId: ResourceIdSchema,
    kind: Type.String({ minLength: 1, maxLength: 128 }),
    state: OperationStateSchema,
    targetVersion: Type.Integer({ minimum: 1 }),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    error: Type.Optional(ApiErrorSchema),
  },
  { additionalProperties: false },
);

export const QuotaSchema = Type.Object(
  {
    maxWorks: Type.Integer({ minimum: 0 }),
    maxServicesPerWork: Type.Integer({ minimum: 0 }),
    maxRetainedVolumesPerWork: Type.Integer({ minimum: 0 }),
    totalCpuMillis: Type.Integer({ minimum: 0 }),
    totalMemoryBytes: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type Operation = Type.Static<typeof OperationSchema>;
export type Quota = Type.Static<typeof QuotaSchema>;
