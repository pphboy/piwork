import { Type } from "typebox";
import { ResourceIdSchema } from "../common.js";

export const ErrorCodeSchema = Type.Union([
  Type.Literal("AUTHENTICATION_FAILED"),
  Type.Literal("PERMISSION_DENIED"),
  Type.Literal("NOT_FOUND"),
  Type.Literal("CONFLICT"),
  Type.Literal("REVISION_CONFLICT"),
  Type.Literal("IDEMPOTENCY_CONFLICT"),
  Type.Literal("RATE_LIMITED"),
  Type.Literal("DEPENDENCY_UNAVAILABLE"),
  Type.Literal("STORAGE_UNAVAILABLE"),
  Type.Literal("UNSUPPORTED_LIMIT"),
  Type.Literal("QUOTA_EXCEEDED"),
  Type.Literal("WORK_BUSY"),
  Type.Literal("WORK_NOT_READY"),
  Type.Literal("CURSOR_EXPIRED"),
  Type.Literal("INVALID_ARGUMENT"),
  Type.Literal("PRECONDITION_FAILED"),
  Type.Literal("INTERNAL"),
]);

export const ApiErrorSchema = Type.Object(
  {
    code: ErrorCodeSchema,
    message: Type.String({ minLength: 1, maxLength: 2_048 }),
    retryable: Type.Boolean(),
    operationId: Type.Optional(ResourceIdSchema),
    field: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    retryAfterMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export type ErrorCode = Type.Static<typeof ErrorCodeSchema>;
export type ApiError = Type.Static<typeof ApiErrorSchema>;
