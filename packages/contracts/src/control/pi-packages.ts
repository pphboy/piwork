import { Type } from "typebox";
import { DigestSchema, ResourceIdSchema, TimestampSchema } from "../common.js";

/** Pi's package.json.name is the public lifecycle identity in both scopes. */
export const PiPackageNameSchema = Type.String({
  minLength: 1,
  maxLength: 214,
  pattern: "^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$",
});

export const PiPackageToolPolicyKeySchema = Type.String({
  minLength: 11,
  maxLength: 512,
  pattern: "^package:(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*:[A-Za-z0-9_-]{1,64}$",
});

export function parsePiPackageToolPolicyKey(value: string): { packageName: string; toolName: string } | undefined {
  const matched = /^package:((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*):([A-Za-z0-9_-]{1,64})$/.exec(value);
  if (!matched || value.length > 512) return undefined;
  return { packageName: matched[1]!, toolName: matched[2]! };
}

export const PiPackageSelectionEntrySchema = Type.Object({
  name: PiPackageNameSchema,
  enabled: Type.Boolean(),
}, { additionalProperties: false });

export const PiPackageSelectionSchema = Type.Array(PiPackageSelectionEntrySchema, {
  maxItems: 64,
  uniqueItems: true,
});

export const PiPackageSourceKindSchema = Type.Union([
  Type.Literal("npm"), Type.Literal("git"), Type.Literal("local"), Type.Literal("zip"),
]);

export const PiPackagePhaseSchema = Type.Union([
  Type.Literal("queued"), Type.Literal("source"), Type.Literal("prepare"),
  Type.Literal("validate"), Type.Literal("publish"), Type.Literal("cleanup-pending"),
  Type.Literal("succeeded"), Type.Literal("failed"), Type.Literal("superseded"),
]);

export const PiPackageSourceSchema = Type.Union([
  Type.Object({ kind: Type.Literal("npm"), spec: Type.String({ minLength: 1, maxLength: 4096 }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("git"), spec: Type.String({ minLength: 1, maxLength: 4096 }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("upload"), uploadId: ResourceIdSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("core"), name: PiPackageNameSchema }, { additionalProperties: false }),
]);

export const PiPackageResourceCountsSchema = Type.Object({
  extensions: Type.Integer({ minimum: 0, maximum: 100_000 }),
  skills: Type.Integer({ minimum: 0, maximum: 100_000 }),
  prompts: Type.Integer({ minimum: 0, maximum: 100_000 }),
  themes: Type.Integer({ minimum: 0, maximum: 100_000 }),
}, { additionalProperties: false });

export const PiPackagePreparedEnvironmentSchema = Type.Object({
  os: Type.Literal("linux"),
  architecture: Type.String({ minLength: 1, maxLength: 64 }),
  variant: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
  nodeAbi: Type.String({ minLength: 1, maxLength: 64 }),
  piSdkVersion: Type.String({ minLength: 1, maxLength: 64 }),
}, { additionalProperties: false });

export const PiPackageArtifactMetadataSchema = Type.Object({
  name: PiPackageNameSchema,
  version: Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()]),
  sourceKind: PiPackageSourceKindSchema,
  resolvedSource: Type.String({ minLength: 1, maxLength: 4096 }),
  preparedEnvironment: PiPackagePreparedEnvironmentSchema,
  resourceCounts: PiPackageResourceCountsSchema,
  contentDigest: DigestSchema,
}, { additionalProperties: false });

export const PiPackageCatalogEntrySchema = Type.Object({
  name: PiPackageNameSchema,
  version: Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()]),
  sourceKind: PiPackageSourceKindSchema,
  enabled: Type.Boolean(),
  isDefault: Type.Boolean(),
  resourceCounts: PiPackageResourceCountsSchema,
}, { additionalProperties: false });

export const PiPackageWorkVersionSchema = Type.Object({
  version: Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()]),
  enabled: Type.Boolean(),
}, { additionalProperties: false });

export const PiPackageRuntimeStateSchema = Type.Object({
  availability: Type.Union([Type.Literal("available"), Type.Literal("unavailable")]),
  loaded: Type.Union([Type.Boolean(), Type.Null()]),
  diagnostics: Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 128 }),
}, { additionalProperties: false });

export const PiPackageWorkEntrySchema = Type.Object({
  name: PiPackageNameSchema,
  desired: Type.Union([PiPackageWorkVersionSchema, Type.Null()]),
  active: Type.Union([PiPackageWorkVersionSchema, Type.Null()]),
  pendingApply: Type.Boolean(),
  runtime: PiPackageRuntimeStateSchema,
}, { additionalProperties: false });

export const PiPackageOperationAcceptanceSchema = Type.Object({
  operationId: ResourceIdSchema,
  workId: Type.Union([ResourceIdSchema, Type.Null()]),
  correlationId: ResourceIdSchema,
  reused: Type.Boolean(),
  scope: Type.Union([Type.Literal("core"), Type.Literal("work")]),
  kind: Type.Union([Type.Literal("pi-package-install"), Type.Literal("pi-package-update")]),
  name: Type.Union([PiPackageNameSchema, Type.Null()]),
}, { additionalProperties: false });

export const PiPackageUploadResultSchema = Type.Object({
  uploadId: ResourceIdSchema,
  expiresAt: TimestampSchema,
}, { additionalProperties: false });

export const PiPackageInstallRequestSchema = Type.Object({
  source: PiPackageSourceSchema,
  addToDefaults: Type.Optional(Type.Boolean()),
  idempotencyKey: Type.String({ minLength: 1, maxLength: 256 }),
}, { additionalProperties: false });

export const PiPackageUpdateRequestSchema = Type.Object({
  source: PiPackageSourceSchema,
  idempotencyKey: Type.String({ minLength: 1, maxLength: 256 }),
}, { additionalProperties: false });

export type PiPackageName = Type.Static<typeof PiPackageNameSchema>;
export type PiPackageSelectionEntry = Type.Static<typeof PiPackageSelectionEntrySchema>;
export type PiPackageSource = Type.Static<typeof PiPackageSourceSchema>;
export type PiPackageSourceKind = Type.Static<typeof PiPackageSourceKindSchema>;
export type PiPackageResourceCounts = Type.Static<typeof PiPackageResourceCountsSchema>;
export type PiPackagePreparedEnvironment = Type.Static<typeof PiPackagePreparedEnvironmentSchema>;
export type PiPackageArtifactMetadata = Type.Static<typeof PiPackageArtifactMetadataSchema>;
export type PiPackageCatalogEntry = Type.Static<typeof PiPackageCatalogEntrySchema>;
export type PiPackageWorkEntry = Type.Static<typeof PiPackageWorkEntrySchema>;
export type PiPackageOperationAcceptance = Type.Static<typeof PiPackageOperationAcceptanceSchema>;
export type PiPackageUploadResult = Type.Static<typeof PiPackageUploadResultSchema>;

/** JSON Schema uniqueItems compares whole objects; lifecycle identity is only name. */
export function validatePiPackageSelection(entries: readonly PiPackageSelectionEntry[]): void {
  if (entries.length > 64) throw new RangeError("packages exceeds 64 entries");
  const names = new Set<string>();
  for (const entry of entries) {
    if (names.has(entry.name)) throw new TypeError(`duplicate package ${entry.name}`);
    names.add(entry.name);
  }
}

export function sortPiPackageSelection(entries: readonly PiPackageSelectionEntry[]): PiPackageSelectionEntry[] {
  validatePiPackageSelection(entries);
  return [...entries].sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
}
