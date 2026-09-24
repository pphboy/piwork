import { Type } from "typebox";
import { Check } from "typebox/value";
import { ResourceIdSchema, TimestampSchema } from "../common.js";
import { WorkBindingRequirementsSchema, WorkBlobDigestSchema, WorkByteSizeSchema, WorkLogicalKeySchema } from "./portable-work.js";
import { OperationStateSchema } from "./operations.js";

const exact = { additionalProperties: false } as const;
export const WORK_PACKAGE_MIME = "application/vnd.piwork.work-package";
export const SnapshotIdempotencyKeySchema = Type.String({ minLength: 1, maxLength: 256, pattern: "^(?=.*\\S)[^\\u0000]+$" });
export const WorkImportBindingsSchema = Type.Object({
  models: Type.Record(WorkLogicalKeySchema, ResourceIdSchema, exact),
  secrets: Type.Record(WorkLogicalKeySchema, ResourceIdSchema, exact),
}, exact);
export const ExportWorkRequestSchema = Type.Object({ idempotencyKey: SnapshotIdempotencyKeySchema }, exact);
export const ImportWorkRequestSchema = Type.Object({
  packageId: ResourceIdSchema, name: Type.Optional(Type.String({ minLength: 1, maxLength: 128, pattern: "^(?=.*\\S)[^\\u0000]+$" })),
  idempotencyKey: SnapshotIdempotencyKeySchema,
}, exact);
export const AcceptedWorkImportSchema = Type.Object({
  workId: ResourceIdSchema, name: Type.String({ minLength: 1, maxLength: 128 }), operationId: ResourceIdSchema, correlationId: ResourceIdSchema, reused: Type.Boolean(),
}, exact);
export const AcceptedWorkExportSchema = Type.Object({ workId: ResourceIdSchema, operationId: ResourceIdSchema,
  correlationId: ResourceIdSchema, reused: Type.Boolean(), snapshotId: ResourceIdSchema }, exact);
export const WorkSnapshotErrorSchema = Type.Object({
  code: Type.String({ pattern: "^[A-Z][A-Z0-9_]+$", maxLength: 128 }),
  message: Type.String({ minLength: 1, maxLength: 2048 }), field: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
}, exact);
export const WorkSnapshotSchema = Type.Object({
  workId: ResourceIdSchema, snapshotId: ResourceIdSchema, operationId: ResourceIdSchema, state: OperationStateSchema,
  digest: Type.Union([WorkBlobDigestSchema, Type.Null()]), size: Type.Union([WorkByteSizeSchema, Type.Null()]),
  expiresAt: Type.Union([TimestampSchema, Type.Null()]), error: Type.Union([WorkSnapshotErrorSchema, Type.Null()]),
}, exact);
export const UploadedWorkPackageSchema = Type.Object({
  packageId: ResourceIdSchema, digest: WorkBlobDigestSchema, size: WorkByteSizeSchema,
  expiresAt: TimestampSchema, bindingRequirements: WorkBindingRequirementsSchema,
}, exact);
export const WorkImportProvenanceSchema = Type.Object({
  sourcePackageDigest: WorkBlobDigestSchema, importOperationId: ResourceIdSchema,
  operationMap: Type.Array(Type.Object({ sourceOperationId: ResourceIdSchema, operationId: ResourceIdSchema }, exact)),
}, exact);
export type WorkImportBindings = Type.Static<typeof WorkImportBindingsSchema>;
export type ExportWorkRequest = Type.Static<typeof ExportWorkRequestSchema>;
export type ImportWorkRequest = Type.Static<typeof ImportWorkRequestSchema>;
export type AcceptedWorkImport = Type.Static<typeof AcceptedWorkImportSchema>;
export type AcceptedWorkExport = Type.Static<typeof AcceptedWorkExportSchema>;
export type WorkSnapshot = Type.Static<typeof WorkSnapshotSchema>;
export type UploadedWorkPackage = Type.Static<typeof UploadedWorkPackageSchema>;
export type WorkImportProvenance = Type.Static<typeof WorkImportProvenanceSchema>;

export function validateSnapshotIdempotencyKey(value: unknown): string {
  if (!Check(SnapshotIdempotencyKeySchema, value) || Buffer.byteLength(value as string, "utf8") > 256) throw new TypeError("Invalid idempotencyKey");
  return value as string;
}

/** Missing maps are empty; unknown top-level fields never get discarded. */
export function normalizeWorkImportBindings(value: unknown): WorkImportBindings {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => key !== "models" && key !== "secrets")) throw new TypeError("Invalid bindings");
  const input = value as { models?: unknown; secrets?: unknown };
  const bindings = { models: input.models === undefined ? {} : input.models, secrets: input.secrets === undefined ? {} : input.secrets };
  if (!Check(WorkImportBindingsSchema, bindings)) throw new TypeError("Invalid bindings");
  return bindings as WorkImportBindings;
}
