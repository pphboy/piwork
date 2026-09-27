import { Type } from "typebox";
import { Check } from "typebox/value";
import { DigestSchema, IdentifierSchema, ResourceIdSchema, TimestampSchema } from "../common.js";
import { SafeDiagnosticSchema } from "./diagnostics.js";
import { ServiceDefinitionSchema, normalizeServiceDefinitionInput } from "./services.js";
import { McpServerSchema, WorkConfigSchema, validateResourcePolicy } from "./work-config.js";
import { PiPackageArtifactMetadataSchema, PiPackageNameSchema, validatePiPackageSelection } from "./pi-packages.js";

const exact = { additionalProperties: false } as const;
export const WorkLogicalKeySchema = Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" });
export const WorkBlobDigestSchema = Type.String({ pattern: "^[a-f0-9]{64}$" });
export const WorkByteSizeSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const revision = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const nullableTime = Type.Union([TimestampSchema, Type.Null()]);
const nullableKey = Type.Union([WorkLogicalKeySchema, Type.Null()]);
export const WORK_BLOB_KINDS = ["file", "tree", "control-history", "identity-map", "image-config", "image-layer"] as const;
export const WorkBlobSchema = Type.Object({
  digest: WorkBlobDigestSchema, size: WorkByteSizeSchema,
  kinds: Type.Array(Type.Union([
    Type.Literal("file"), Type.Literal("tree"), Type.Literal("control-history"),
    Type.Literal("identity-map"), Type.Literal("image-config"), Type.Literal("image-layer"),
  ]), { minItems: 1, uniqueItems: true }),
}, exact);
export const PortableMcpServerSchema = Type.Object({
  ...Type.Omit(McpServerSchema, ["requiredServiceId", "secretRefs"]).properties,
  requiredServiceKey: Type.Optional(WorkLogicalKeySchema),
  secretRefs: Type.Optional(Type.Array(Type.Object({
    bindingKey: WorkLogicalKeySchema, key: Type.Optional(IdentifierSchema),
  }, exact), { maxItems: 64 })),
}, exact);
export const PortableWorkConfigurationSchema = Type.Object({
  ...Type.Omit(WorkConfigSchema, ["agentImage", "modelRef", "agentsMd", "mcpServers"]).properties,
  modelBindingKey: WorkLogicalKeySchema,
  mcpServers: Type.Array(PortableMcpServerSchema, { maxItems: 128 }),
}, exact);
export const PortableWorkContextSchema = Type.Object({
  key: WorkLogicalKeySchema, createdAt: TimestampSchema,
  configuration: PortableWorkConfigurationSchema,
  skillsTree: WorkBlobDigestSchema, agentsBlob: WorkBlobDigestSchema, imageKey: WorkLogicalKeySchema,
  packageBindings: Type.Array(Type.Object({ name: PiPackageNameSchema, artifactKey: DigestSchema }, exact), { maxItems: 64 }),
}, exact);
export const PortablePiPackageArtifactSchema = Type.Object({
  key: DigestSchema,
  ...PiPackageArtifactMetadataSchema.properties,
  treeDigest: WorkBlobDigestSchema,
  resourceInventory: Type.Object({
    extensions: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 100_000 }),
    skills: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 100_000 }),
    prompts: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 100_000 }),
    themes: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 100_000 }),
  }, exact),
}, exact);
export const PortableServiceDefinitionSchema = Type.Omit(ServiceDefinitionSchema, ["serviceId", "revision"], exact);
export const PortableWorkServiceSchema = Type.Object({
  key: WorkLogicalKeySchema, name: ServiceDefinitionSchema.properties.name,
  desiredRevision: revision, appliedRevision: Type.Union([revision, Type.Null()]),
  enabled: Type.Boolean(), tombstonedAt: nullableTime,
  revisions: Type.Array(Type.Object({
    revision, createdAt: TimestampSchema, definition: PortableServiceDefinitionSchema, imageKey: nullableKey,
  }, exact), { minItems: 1 }),
  recovery: Type.Object({ count: WorkByteSizeSchema, windowStartedAt: nullableTime, nextRetryAt: nullableTime, readySince: nullableTime }, exact),
  sourceObservation: Type.Object({ state: Type.String({ minLength: 1 }), lastError: Type.Union([SafeDiagnosticSchema, Type.Null()]) }, exact),
}, exact);
export const PortableWorkQuotaReservationSchema = Type.Object({
  subjectKind: Type.Union([Type.Literal("agent"), Type.Literal("service")]),
  subjectKey: WorkLogicalKeySchema,
  desiredCpuMillis: WorkByteSizeSchema,
  desiredMemoryBytes: WorkByteSizeSchema,
  serviceSlots: WorkByteSizeSchema,
  volumeSlots: WorkByteSizeSchema,
}, exact);
export const WorkImagePlatformSchema = Type.Object({
  os: Type.Literal("linux"), architecture: Type.String({ minLength: 1, maxLength: 64 }),
  variant: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
}, exact);
export const PortableWorkImageSchema = Type.Object({
  key: WorkLogicalKeySchema, imageId: DigestSchema, platform: WorkImagePlatformSchema,
  config: WorkBlobDigestSchema, layers: Type.Array(WorkBlobDigestSchema),
}, exact);
export const WorkBindingRequirementsSchema = Type.Object({
  models: Type.Array(Type.Object({
    key: WorkLogicalKeySchema, provider: Type.String({ minLength: 1 }), model: Type.String({ minLength: 1 }),
    baseUrl: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  }, exact)),
  secrets: Type.Array(Type.Object({ key: WorkLogicalKeySchema, uses: Type.Array(Type.Object({
    contextKey: WorkLogicalKeySchema, serverId: IdentifierSchema,
    key: Type.Union([IdentifierSchema, Type.Null()]),
  }, exact), { minItems: 1, uniqueItems: true }) }, exact)),
}, exact);
export const PortableWorkSpecSchema = Type.Object({
  formatVersion: Type.Literal(1), snapshotKind: Type.Literal("cold-full"),
  createdAt: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$" }),
  sourceName: Type.String({ minLength: 1, maxLength: 128 }),
  compatibility: Type.Object({ ...WorkImagePlatformSchema.properties,
    agentProtocol: Type.Literal("v2"), workHistorySchema: Type.Literal(3), storageLayout: Type.Literal(2),
    piPackageContract: Type.Literal(1),
  }, exact),
  activeContext: nullableKey, desiredContext: WorkLogicalKeySchema,
  contexts: Type.Array(PortableWorkContextSchema, { minItems: 1 }),
  piPackageArtifacts: Type.Array(PortablePiPackageArtifactSchema),
  services: Type.Array(PortableWorkServiceSchema),
  quotaReservations: Type.Array(PortableWorkQuotaReservationSchema, { minItems: 1 }),
  images: Type.Array(PortableWorkImageSchema),
  volumes: Type.Tuple([
    Type.Object({ role: Type.Literal("agent-private"), tree: WorkBlobDigestSchema, serviceRefKeys: Type.Array(WorkLogicalKeySchema) }, exact),
    Type.Object({ role: Type.Literal("workspace"), tree: WorkBlobDigestSchema, serviceRefKeys: Type.Array(WorkLogicalKeySchema) }, exact),
  ]),
  bindings: WorkBindingRequirementsSchema,
  history: Type.Object({ control: WorkBlobDigestSchema, sourceIdentityMap: WorkBlobDigestSchema }, exact),
  blobs: Type.Array(WorkBlobSchema),
}, exact);

// Historical payloads are strings, deliberately not a union of executable requests.
export const ArchivedWorkOperationSchema = Type.Object({
  id: ResourceIdSchema, workId: ResourceIdSchema, serviceId: Type.Union([ResourceIdSchema, Type.Null()]),
  kind: Type.String({ minLength: 1, maxLength: 128 }),
  state: Type.Union([Type.Literal("succeeded"), Type.Literal("failed"), Type.Literal("superseded")]),
  targetVersion: revision, requestJson: Type.String(),
  resultJson: Type.Union([Type.String(), Type.Null()]), errorJson: Type.Union([Type.String(), Type.Null()]),
  createdAt: TimestampSchema, updatedAt: TimestampSchema,
}, exact);
export const ArchivedWorkIdempotencySchema = Type.Object({
  principalKey: WorkLogicalKeySchema,
  principalKind: Type.Union([Type.Literal("owner"), Type.Literal("admin"), Type.Literal("agent")]),
  workScope: Type.String({ minLength: 1 }), operationKind: Type.String({ minLength: 1, maxLength: 128 }),
  idempotencyKey: Type.String(), requestDigest: WorkBlobDigestSchema,
  resourceId: ResourceIdSchema, operationId: ResourceIdSchema, createdAt: TimestampSchema,
}, exact);
export const WorkControlHistorySchema = Type.Object({
  version: Type.Literal(1), work: Type.Object({ name: PortableWorkSpecSchema.properties.sourceName, createdAt: TimestampSchema }, exact),
  configurationRevisions: Type.Array(Type.Object({ revision, contextKey: WorkLogicalKeySchema }, exact)),
  operations: Type.Array(ArchivedWorkOperationSchema), idempotency: Type.Array(ArchivedWorkIdempotencySchema),
}, exact);
const identityEntries = Type.Array(Type.Object({ sourceId: ResourceIdSchema, key: WorkLogicalKeySchema }, exact));
export const WorkSourceIdentityMapSchema = Type.Object({
  version: Type.Literal(1), sourceWorkId: ResourceIdSchema,
  contexts: identityEntries, services: identityEntries, operations: identityEntries,
}, exact);

export type PortableWorkSpec = Type.Static<typeof PortableWorkSpecSchema>;
export type PortableWorkContext = Type.Static<typeof PortableWorkContextSchema>;
export type PortablePiPackageArtifact = Type.Static<typeof PortablePiPackageArtifactSchema>;
export type PortableWorkService = Type.Static<typeof PortableWorkServiceSchema>;
export type PortableWorkQuotaReservation = Type.Static<typeof PortableWorkQuotaReservationSchema>;
export type PortableWorkImage = Type.Static<typeof PortableWorkImageSchema>;
export type PortableWorkConfiguration = Type.Static<typeof PortableWorkConfigurationSchema>;
export type WorkBindingRequirements = Type.Static<typeof WorkBindingRequirementsSchema>;
export type WorkBlob = Type.Static<typeof WorkBlobSchema>;
export type WorkBlobKind = typeof WORK_BLOB_KINDS[number];
export type WorkControlHistory = Type.Static<typeof WorkControlHistorySchema>;
export type WorkSourceIdentityMap = Type.Static<typeof WorkSourceIdentityMapSchema>;

export class WorkPackageValidationError extends Error {
  constructor(readonly code: "PACKAGE_INVALID" | "PACKAGE_FORMAT_UNSUPPORTED" | "PACKAGE_LIMIT_EXCEEDED" | "PACKAGE_INCOMPATIBLE", readonly field: string) {
    super(`Work package validation failed: ${field}`);
    this.name = "WorkPackageValidationError";
  }
}
function invalid(field: string): never { throw new WorkPackageValidationError("PACKAGE_INVALID", field); }
function sortedUnique<T>(items: readonly T[], key: (item: T) => string | number, field: string): void {
  for (let i = 1; i < items.length; i++) if (key(items[i - 1]!) >= key(items[i]!)) invalid(field);
}
function safeNumbers(value: unknown, depth = 0): void {
  if (depth > 128) invalid("nesting");
  if (typeof value === "number" && !Number.isSafeInteger(value)) invalid("integer");
  if (value !== null && typeof value === "object") for (const entry of Object.values(value)) safeNumbers(entry, depth + 1);
}

/** Structural schema + relationships. Blob contents are checked by work-package. */
export function validatePortableWorkSpec(value: unknown): PortableWorkSpec {
  safeNumbers(value);
  if (value !== null && typeof value === "object" && "formatVersion" in value && value.formatVersion !== 1) {
    throw new WorkPackageValidationError("PACKAGE_FORMAT_UNSUPPORTED", "formatVersion");
  }
  if (!Check(PortableWorkSpecSchema, value)) invalid("manifest");
  const spec = value as PortableWorkSpec;
  if (!Number.isFinite(Date.parse(spec.createdAt))) invalid("createdAt");
  const contexts = new Map(spec.contexts.map((item) => [item.key, item]));
  sortedUnique(spec.piPackageArtifacts, (item) => item.key, "piPackageArtifacts");
  const packageArtifacts = new Map(spec.piPackageArtifacts.map((item) => [item.key, item]));
  const usedPackageArtifacts = new Set<string>();
  for (const artifact of spec.piPackageArtifacts) {
    if (artifact.key !== artifact.contentDigest) invalid("piPackageArtifacts.key");
    for (const kind of ["extensions", "skills", "prompts", "themes"] as const) {
      if (artifact.resourceInventory[kind].length !== artifact.resourceCounts[kind]) invalid("piPackageArtifacts.resourceCounts");
      sortedUnique(artifact.resourceInventory[kind], (path) => path, `piPackageArtifacts.${kind}`);
    }
  }
  const services = new Map(spec.services.map((item) => [item.key, item]));
  const images = new Map(spec.images.map((item) => [item.key, item]));
  const models = new Map(spec.bindings.models.map((item) => [item.key, item]));
  const secrets = new Map(spec.bindings.secrets.map((item) => [item.key, item]));
  for (const [items, field] of [[spec.contexts, "contexts"], [spec.services, "services"], [spec.images, "images"], [spec.bindings.models, "models"], [spec.bindings.secrets, "secrets"]] as const) {
    sortedUnique<{ key: string }>(items, (item) => item.key, field);
  }
  if (spec.quotaReservations.length !== spec.services.length + 1) invalid("quotaReservations");
  const agentReservation = spec.quotaReservations[0]!;
  if (agentReservation.subjectKind !== "agent" || agentReservation.subjectKey !== "agentd") invalid("quotaReservations.agent");
  for (let i = 0; i < spec.services.length; i++) {
    const row = spec.quotaReservations[i + 1]!;
    if (row.subjectKind !== "service" || row.subjectKey !== spec.services[i]!.key) invalid("quotaReservations.service");
  }
  if (spec.volumes[0].serviceRefKeys.length !== 0) invalid("volumes.agentPrivateReferences");
  sortedUnique(spec.volumes[1].serviceRefKeys, (key) => key, "volumes.workspaceReferences");
  for (const key of spec.volumes[1].serviceRefKeys) if (!services.has(key)) invalid("volumes.workspaceReferences");
  if (!contexts.has(spec.desiredContext) || (spec.activeContext !== null && !contexts.has(spec.activeContext))) invalid("context");
  sortedUnique(spec.blobs, (blob) => blob.digest, "blobs");
  const blobs = new Map(spec.blobs.map((blob) => [blob.digest, blob]));
  for (const blob of spec.blobs) sortedUnique(blob.kinds, (kind) => WORK_BLOB_KINDS.indexOf(kind), "blob.kinds");
  const ref = (digest: string, kind: WorkBlobKind) => { if (!blobs.get(digest)?.kinds.includes(kind)) invalid(`blob.${kind}`); };
  ref(spec.history.control, "control-history"); ref(spec.history.sourceIdentityMap, "identity-map");
  for (const volume of spec.volumes) ref(volume.tree, "tree");
  for (const context of spec.contexts) {
    if (!images.has(context.imageKey) || !models.has(context.configuration.modelBindingKey)) invalid("context.binding");
    ref(context.skillsTree, "tree"); ref(context.agentsBlob, "file");
    try { validatePiPackageSelection(context.configuration.packages); }
    catch { invalid("context.packages"); }
    if (context.packageBindings.length !== context.configuration.packages.length) invalid("context.packageBindings");
    for (const [index, binding] of context.packageBindings.entries()) {
      const artifact = packageArtifacts.get(binding.artifactKey);
      if (binding.name !== context.configuration.packages[index]?.name || artifact?.name !== binding.name) invalid("context.packageBindings");
      usedPackageArtifacts.add(binding.artifactKey);
      ref(artifact.treeDigest, "tree");
    }
    try { validateResourcePolicy(context.configuration.resources); } catch { invalid("context.resources"); }
    const serverIds = new Set<string>();
    for (const server of context.configuration.mcpServers) {
      if (serverIds.has(server.serverId)) invalid("mcp.serverId"); serverIds.add(server.serverId);
      if (server.requiredServiceKey !== undefined && !services.has(server.requiredServiceKey)) invalid("mcp.requiredServiceKey");
      for (const secret of server.secretRefs ?? []) {
        if (!secrets.get(secret.bindingKey)?.uses.some((use) => use.contextKey === context.key && use.serverId === server.serverId && use.key === (secret.key ?? null))) invalid("mcp.secretRefs");
      }
    }
  }
  if (usedPackageArtifacts.size !== spec.piPackageArtifacts.length) invalid("piPackageArtifacts.unused");
  for (const secret of spec.bindings.secrets) for (const use of secret.uses) {
    const server = contexts.get(use.contextKey)?.configuration.mcpServers.find((server) => server.serverId === use.serverId);
    if (!server?.secretRefs?.some((ref) => ref.bindingKey === secret.key && (ref.key ?? null) === use.key)) invalid("secret.uses");
  }
  for (const model of spec.bindings.models) if (!spec.contexts.some((context) => context.configuration.modelBindingKey === model.key)) invalid("model.unused");
  const names = new Set<string>();
  for (const service of spec.services) {
    if (names.has(service.name)) invalid("service.name"); names.add(service.name);
    sortedUnique(service.revisions, (item) => item.revision, "service.revisions");
    if (!service.revisions.some((item) => item.revision === service.desiredRevision)
      || (service.appliedRevision !== null && !service.revisions.some((item) => item.revision === service.appliedRevision))) invalid("service.head");
    for (const entry of service.revisions) {
      if (entry.definition.name !== service.name || (entry.imageKey !== null && !images.has(entry.imageKey))) invalid("service.revision");
      try { normalizeServiceDefinitionInput(entry.definition); } catch { invalid("service.definition"); }
    }
  }
  for (const image of spec.images) {
    if (image.imageId !== `sha256:${image.config}`) invalid("image.identity");
    if (image.platform.os !== spec.compatibility.os || image.platform.architecture !== spec.compatibility.architecture || image.platform.variant !== spec.compatibility.variant) invalid("image.platform");
    ref(image.config, "image-config"); for (const layer of image.layers) ref(layer, "image-layer");
  }
  return spec;
}

export function validateWorkHistory(spec: PortableWorkSpec, historyValue: unknown, identityValue: unknown): { history: WorkControlHistory; identities: WorkSourceIdentityMap } {
  safeNumbers(historyValue); safeNumbers(identityValue);
  if (!Check(WorkControlHistorySchema, historyValue) || !Check(WorkSourceIdentityMapSchema, identityValue)) invalid("history");
  const history = historyValue as WorkControlHistory, identities = identityValue as WorkSourceIdentityMap;
  if (history.work.name !== spec.sourceName) invalid("history.work");
  for (const [entries, keys, field] of [
    [identities.contexts, spec.contexts.map((item) => item.key), "contexts"],
    [identities.services, spec.services.map((item) => item.key), "services"],
  ] as const) {
    sortedUnique(entries, (item) => item.sourceId, field);
    if (entries.length !== keys.length || new Set(entries.map((item) => item.key)).size !== entries.length || entries.some((item) => !keys.includes(item.key))) invalid(`history.${field}`);
  }
  sortedUnique(identities.operations, (item) => item.sourceId, "operation.map");
  sortedUnique(history.operations, (item) => item.id, "operations");
  sortedUnique(history.configurationRevisions, (item) => item.revision, "configurationRevisions");
  const revisionKeys = history.configurationRevisions.map((item) => item.contextKey);
  if (new Set(revisionKeys).size !== revisionKeys.length || spec.contexts.some((context) => !revisionKeys.includes(context.key)) || revisionKeys.some((key) => !spec.contexts.some((context) => context.key === key))) invalid("history.context");
  const operations = new Map(history.operations.map((operation) => [operation.id, operation]));
  if (identities.operations.length !== operations.size || new Set(identities.operations.map((item) => item.key)).size !== operations.size || identities.operations.some((item) => !operations.has(item.sourceId))) invalid("history.operationMap");
  const serviceIds = new Set(identities.services.map((item) => item.sourceId));
  for (const operation of history.operations) if (operation.workId !== identities.sourceWorkId || (operation.serviceId !== null && !serviceIds.has(operation.serviceId))) invalid("history.scope");
  const seen = new Set<string>();
  const principals = new Map<string, string>();
  let previous: string[] | undefined;
  for (const record of history.idempotency) {
    const parts = [record.principalKey, record.workScope, record.operationKind, record.idempotencyKey];
    const key = JSON.stringify(parts);
    if (seen.has(key)) invalid("history.idempotency"); seen.add(key);
    if (previous !== undefined) {
      const differing = parts.findIndex((part, i) => part !== previous![i]);
      if (differing < 0 || Buffer.compare(Buffer.from(previous[differing]!), Buffer.from(parts[differing]!)) >= 0) invalid("history.idempotencyOrder");
    }
    previous = parts;
    if (principals.has(record.principalKey) && principals.get(record.principalKey) !== record.principalKind) invalid("history.principal");
    principals.set(record.principalKey, record.principalKind);
    if (operations.get(record.operationId)?.kind !== record.operationKind || (record.resourceId !== identities.sourceWorkId && !serviceIds.has(record.resourceId))) invalid("history.idempotencyReference");
  }
  return { history, identities };
}
