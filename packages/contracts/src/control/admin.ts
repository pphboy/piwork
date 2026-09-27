import { Type } from "typebox";
import { Check } from "typebox/value";
import { ResourceIdSchema, TimestampSchema } from "../common.js";
import { OperationStateSchema } from "./operations.js";
import { PiPackageCatalogEntrySchema, PiPackageNameSchema, PiPackagePhaseSchema,
  PiPackageResourceCountsSchema, PiPackageSourceKindSchema, PiPackageUploadResultSchema } from "./pi-packages.js";
import { OperatorSkillSchema } from "./skills.js";
import { UserSchema, CreateUserRequestSchema, ResetUserPasswordRequestSchema } from "./users.js";
import { AGENTS_MD_MAX_BYTES, SkillSelectionSchema, WorkConfigSchema, normalizeAgentsMd } from "./work-config.js";

/** Applies to /api/v1/admin JSON request bodies, including JSON-escaped AGENTS.md. */
export const ADMIN_JSON_MAX_BYTES = 2 * 1024 * 1024;
export const ADMIN_API_VERSION = 1 as const;

export const AdminStatusSchema = Type.Object({
  adminApiVersion: Type.Literal(ADMIN_API_VERSION),
  state: Type.Union([
    Type.Literal("STORE_OPEN"), Type.Literal("LISTENING"), Type.Literal("ADMIN_REQUIRED"),
    Type.Literal("RUNTIME_NOT_CONFIGURED"), Type.Literal("RUNTIME_UNAVAILABLE"),
    Type.Literal("FILESYSTEM_MIGRATION_REQUIRED"), Type.Literal("RECOVERING"),
    Type.Literal("READY"), Type.Literal("SHUTTING_DOWN"),
  ]),
  ready: Type.Boolean(),
  checks: Type.Object({
    administrator: Type.Boolean(),
    runtimeConfigured: Type.Boolean(),
    runtimeAvailable: Type.Boolean(),
    filesystemMigrationReady: Type.Boolean(),
  }, { additionalProperties: false }),
}, { additionalProperties: false });

export const AdminRuntimeViewSchema = Type.Union([
  Type.Object({ configured: Type.Literal(false) }, { additionalProperties: false }),
  Type.Object({
    configured: Type.Literal(true),
    agentImage: Type.String({ minLength: 1, maxLength: 4096 }),
    model: Type.Object({
      provider: Type.String({ minLength: 1, maxLength: 256 }),
      id: Type.String({ minLength: 1, maxLength: 512 }),
      baseUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
      credentialAvailable: Type.Boolean(),
    }, { additionalProperties: false }),
    updatedAt: TimestampSchema,
  }, { additionalProperties: false }),
]);

export const AdminRuntimeInputSchema = Type.Object({
  agentImage: Type.String({ minLength: 1, maxLength: 4096 }),
  provider: Type.String({ minLength: 1, maxLength: 256 }),
  model: Type.String({ minLength: 1, maxLength: 512 }),
  baseUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
  credential: Type.String({ minLength: 1, maxLength: 64 * 1024 }),
}, { additionalProperties: false });

export const AdminRuntimeResultSchema = Type.Object({
  runtime: AdminRuntimeViewSchema,
  status: AdminStatusSchema,
}, { additionalProperties: false });

export const AdminDefaultWorkViewSchema = Type.Object({
  configuration: Type.Union([WorkConfigSchema, Type.Null()]),
  baseImage: Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]),
}, { additionalProperties: false });

export const AdminDefaultWorkPatchSchema = Type.Object({
  baseImage: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
  skills: Type.Optional(SkillSelectionSchema),
  packages: Type.Optional(Type.Array(PiPackageNameSchema, { maxItems: 64, uniqueItems: true })),
  agentsMd: Type.Optional(Type.String({ maxLength: AGENTS_MD_MAX_BYTES })),
}, { additionalProperties: false, minProperties: 1 });

/** JSON Schema counts code points; enforce the UTF-8 byte cap separately. */
export function validateAdminDefaultWorkPatch(value: unknown): AdminDefaultWorkPatch {
  if (!Check(AdminDefaultWorkPatchSchema, value)) throw new TypeError("default Work patch is invalid");
  if (value.agentsMd !== undefined) normalizeAgentsMd(value.agentsMd);
  return value;
}

export const AdminUsersSchema = Type.Object({ users: Type.Array(UserSchema) }, { additionalProperties: false });
export const AdminCreateUserRequestSchema = CreateUserRequestSchema;
export const AdminResetCredentialRequestSchema = ResetUserPasswordRequestSchema;
export const AdminUserEnabledResultSchema = Type.Object({ userId: ResourceIdSchema, enabled: Type.Boolean() }, { additionalProperties: false });
export const AdminCredentialResetResultSchema = Type.Object({ userId: ResourceIdSchema, credentialReset: Type.Literal(true) }, { additionalProperties: false });
export const AdminEmptyActionSchema = Type.Object({}, { additionalProperties: false });

/** The admin projection has the same public fields as the existing operator projection. */
export const ManagedSkillSchema = OperatorSkillSchema;
export const AdminSkillsSchema = Type.Object({ skills: Type.Array(ManagedSkillSchema) }, { additionalProperties: false });
export const AdminPackagesSchema = Type.Object({ packages: Type.Array(PiPackageCatalogEntrySchema) }, { additionalProperties: false });
export const AdminPackageDetailSchema = Type.Object({
  name: PiPackageNameSchema,
  version: Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()]),
  sourceKind: PiPackageSourceKindSchema,
  enabled: Type.Boolean(),
  isDefault: Type.Boolean(),
  resourceCounts: PiPackageResourceCountsSchema,
  resolvedSource: Type.String({ minLength: 1, maxLength: 4096 }),
}, { additionalProperties: false });
export const AdminPackageUploadResultSchema = PiPackageUploadResultSchema;

/** Work-only source kind=core is excluded at the admin boundary. */
export const AdminPackageSourceSchema = Type.Union([
  Type.Object({ kind: Type.Literal("npm"), spec: Type.String({ minLength: 1, maxLength: 4096 }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("git"), spec: Type.String({ minLength: 1, maxLength: 4096 }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("upload"), uploadId: ResourceIdSchema }, { additionalProperties: false }),
]);
export const AdminPackageInstallRequestSchema = Type.Object({
  source: AdminPackageSourceSchema,
  idempotencyKey: Type.String({ minLength: 1, maxLength: 256 }),
  addToDefaults: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
export const AdminPackageUpdateRequestSchema = Type.Object({
  source: AdminPackageSourceSchema,
  idempotencyKey: Type.String({ minLength: 1, maxLength: 256 }),
}, { additionalProperties: false });
export const AdminPackageOperationAcceptanceSchema = Type.Object({
  operationId: ResourceIdSchema, workId: Type.Null(), correlationId: ResourceIdSchema,
  reused: Type.Boolean(), scope: Type.Literal("core"),
  kind: Type.Union([Type.Literal("pi-package-install"), Type.Literal("pi-package-update")]),
  name: Type.Union([PiPackageNameSchema, Type.Null()]),
}, { additionalProperties: false });
export const AdminPackageOperationSchema = Type.Object({
  operationId: ResourceIdSchema, workId: Type.Null(),
  kind: Type.Union([Type.Literal("pi-package-install"), Type.Literal("pi-package-update")]),
  state: OperationStateSchema, packagePhase: PiPackagePhaseSchema,
  name: Type.Union([PiPackageNameSchema, Type.Null()]),
  result: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  error: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  createdAt: TimestampSchema, updatedAt: TimestampSchema,
}, { additionalProperties: false });

export const AdminErrorSchema = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Z][A-Z0-9_]*$" }),
  message: Type.String({ minLength: 1, maxLength: 2048 }),
  correlationId: ResourceIdSchema,
  field: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  retryAfterMs: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: false });

/** Encode an entire resource name as one path segment, including a scoped package slash. */
export function encodeAdminPathSegment(name: string): string { return encodeURIComponent(name); }

export type AdminStatus = Type.Static<typeof AdminStatusSchema>;
export type AdminRuntimeView = Type.Static<typeof AdminRuntimeViewSchema>;
export type AdminRuntimeInput = Type.Static<typeof AdminRuntimeInputSchema>;
export type AdminRuntimeResult = Type.Static<typeof AdminRuntimeResultSchema>;
export type AdminDefaultWorkView = Type.Static<typeof AdminDefaultWorkViewSchema>;
export type AdminDefaultWorkPatch = Type.Static<typeof AdminDefaultWorkPatchSchema>;
export type ManagedSkill = Type.Static<typeof ManagedSkillSchema>;
export type AdminPackageSource = Type.Static<typeof AdminPackageSourceSchema>;
export type AdminPackageInstallRequest = Type.Static<typeof AdminPackageInstallRequestSchema>;
export type AdminPackageUpdateRequest = Type.Static<typeof AdminPackageUpdateRequestSchema>;
export type AdminPackageOperationAcceptance = Type.Static<typeof AdminPackageOperationAcceptanceSchema>;
export type AdminPackageOperation = Type.Static<typeof AdminPackageOperationSchema>;
export type AdminError = Type.Static<typeof AdminErrorSchema>;
