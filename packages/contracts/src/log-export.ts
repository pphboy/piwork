import { Type } from "typebox";
import { IdentifierSchema, ResourceIdSchema, TimestampSchema } from "./harness.js";

// Admin-only log export wire contract. Scope is always derived by Core; clients
// can only supply an idempotency key and a fixed export identity afterwards.
export const LOG_EXPORT_LIMITS = Object.freeze({
  idempotencyKeyChars: 256,
  warnings: 20,
  sources: 4096,
  readyHours: 24,
});

export const LOG_EXPORT_ERROR_CODES = Object.freeze([
  "LOG_EXPORT_NOT_READY",
  "LOG_EXPORT_EXPIRED",
  "LOG_EXPORT_CONTENT_UNAVAILABLE",
  "LOG_EXPORT_BUSY",
  "LOG_EXPORT_SOURCE_LIMIT",
  "LOG_EXPORT_STORAGE_UNAVAILABLE",
  "LOG_EXPORT_TIMEOUT",
  "LOG_EXPORT_INTERRUPTED",
] as const);
export type LogExportErrorCode = typeof LOG_EXPORT_ERROR_CODES[number];

const strict = { additionalProperties: false } as const;
const safeMessage = Type.String({ minLength: 1, maxLength: 2048 });
const safeCode = Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Z][A-Z0-9_]*$" });

export const LogExportStateSchema = Type.Union([
  Type.Literal("collecting"),
  Type.Literal("packing"),
  Type.Literal("ready"),
  Type.Literal("failed"),
  Type.Literal("interrupted"),
  Type.Literal("expired"),
]);

export const LogExportScopeSchema = Type.Object({
  includeCoreLogs: Type.Literal(true),
  ownedWorkCount: Type.Integer({ minimum: 0 }),
  sourceCount: Type.Integer({ minimum: 0, maximum: LOG_EXPORT_LIMITS.sources }),
}, strict);

export const LogExportProgressSchema = Type.Object({
  processedSources: Type.Integer({ minimum: 0 }),
  totalSources: Type.Integer({ minimum: 0 }),
  collectedBytes: Type.Integer({ minimum: 0 }),
}, strict);

export const LogExportWarningSchema = Type.Object({
  code: safeCode,
  message: safeMessage,
}, strict);

export const LogExportTaskErrorSchema = Type.Object({
  code: safeCode,
  message: safeMessage,
  correlationId: IdentifierSchema,
  retryAfterMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 3_600_000 })),
}, strict);

export const LogExportResultSchema = Type.Object({
  filename: Type.String({ minLength: 1, maxLength: 255 }),
  size: Type.Integer({ minimum: 0, maximum: 1 << 30 }),
  digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  readyAt: TimestampSchema,
  expiresAt: TimestampSchema,
}, strict);

export const LogExportCreateInputSchema = Type.Object({
  idempotencyKey: Type.String({ minLength: 1, maxLength: LOG_EXPORT_LIMITS.idempotencyKeyChars }),
}, strict);

export const LogExportAcceptedSchema = Type.Object({
  exportId: ResourceIdSchema,
  correlationId: IdentifierSchema,
  cutoffTime: TimestampSchema,
  state: LogExportStateSchema,
  scope: LogExportScopeSchema,
  reused: Type.Boolean(),
}, strict);

export const LogExportViewSchema = Type.Object({
  exportId: ResourceIdSchema,
  correlationId: IdentifierSchema,
  cutoffTime: TimestampSchema,
  state: LogExportStateSchema,
  scope: LogExportScopeSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  progress: LogExportProgressSchema,
  complete: Type.Union([Type.Boolean(), Type.Null()]),
  warningCount: Type.Integer({ minimum: 0 }),
  warnings: Type.Array(LogExportWarningSchema, { maxItems: LOG_EXPORT_LIMITS.warnings }),
  warningsTruncated: Type.Boolean(),
  result: Type.Union([LogExportResultSchema, Type.Null()]),
  error: Type.Union([LogExportTaskErrorSchema, Type.Null()]),
  cleanupPending: Type.Boolean(),
}, strict);
