import { constants, closeSync, fstatSync, openSync } from "node:fs";
import { CoreStore } from "@piwork/core-store";
import { normalizeWorkImportBindings, type WorkBindingRequirements, type WorkImportBindings } from "@piwork/contracts";
import type { RuntimeProfile, RuntimeProfileStore } from "../configuration/runtime-profile.js";

export class WorkBindingError extends Error {
  constructor(readonly field: string, readonly code = "PACKAGE_BINDING_INVALID") {
    super(code); this.name = "WorkBindingError";
  }
}
export interface BoundWorkModel { readonly catalogId: string; readonly profile: Omit<RuntimeProfile, "agentImage"> }
export interface ResolvedWorkBindings {
  readonly bindings: WorkImportBindings;
  readonly models: ReadonlyMap<string, BoundWorkModel>;
  readonly secrets: ReadonlyMap<string, string>;
}
function fail(field: string): never { throw new WorkBindingError(field); }
function normalizedUrl(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail(field);
  try { return new URL(value).href; } catch { return fail(field); }
}
function verifyReadableFile(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { if (!fstatSync(fd).isFile()) fail("secrets"); } finally { closeSync(fd); }
}

/** Select recipient-owned catalog entries; package logical keys are never catalog IDs. */
export function autoResolveWorkBindings(store: CoreStore, profiles: Pick<RuntimeProfileStore, "credentialPath">,
  ownerUserId: string, requirements: WorkBindingRequirements): ResolvedWorkBindings {
  if (requirements.secrets.length > 0) throw new WorkBindingError("secrets", "EXTERNAL_MCP_SECRET_UNAVAILABLE");
  const bindings: WorkImportBindings = { models: {}, secrets: {} };
  for (const requirement of requirements.models) {
    const field = `models.${requirement.key}`;
    const matches = store.listCatalogEntries(true).filter((entry) => {
      if (entry.kind !== "model") return false;
      try {
        const metadata = JSON.parse(entry.metadataJson) as { version?: unknown; provider?: unknown; id?: unknown; baseUrl?: unknown;
          credentialRef?: unknown; sourceRuntimeRevision?: unknown; updatedAt?: unknown };
        if (metadata.version !== 1 || metadata.provider !== requirement.provider || metadata.id !== requirement.model
          || normalizedUrl(metadata.baseUrl, field) !== normalizedUrl(requirement.baseUrl, field)
          || typeof metadata.credentialRef !== "string" || !Number.isSafeInteger(metadata.sourceRuntimeRevision)
          || (metadata.sourceRuntimeRevision as number) < 1 || typeof metadata.updatedAt !== "string") return false;
        const profile: RuntimeProfile = { version: 1, revision: metadata.sourceRuntimeRevision as number,
          agentImage: `sha256:${"0".repeat(64)}`, model: { provider: requirement.provider, id: requirement.model,
            ...(metadata.baseUrl === undefined ? {} : { baseUrl: metadata.baseUrl as string }), credentialRef: metadata.credentialRef },
          updatedAt: metadata.updatedAt };
        verifyReadableFile(profiles.credentialPath(profile));
        return true;
      } catch { return false; }
    }).sort((a, b) => {
      const revisionA = (JSON.parse(a.metadataJson) as { sourceRuntimeRevision: number }).sourceRuntimeRevision;
      const revisionB = (JSON.parse(b.metadataJson) as { sourceRuntimeRevision: number }).sourceRuntimeRevision;
      return revisionB - revisionA || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
    const selected = matches[0];
    if (!selected) throw new WorkBindingError(field, "TARGET_MODEL_UNAVAILABLE");
    bindings.models[requirement.key] = selected.id;
  }
  try { return resolveWorkBindings(store, profiles, ownerUserId, requirements, bindings); }
  catch { throw new WorkBindingError("models", "TARGET_MODEL_UNAVAILABLE"); }
}

export function revalidateCapturedWorkBindings(store: CoreStore, profiles: Pick<RuntimeProfileStore, "credentialPath">,
  ownerUserId: string, requirements: WorkBindingRequirements, captured: ResolvedWorkBindings): ResolvedWorkBindings {
  let current: ResolvedWorkBindings;
  try { current = resolveWorkBindings(store, profiles, ownerUserId, requirements, captured.bindings); }
  catch { throw new WorkBindingError("models", "TARGET_MODEL_UNAVAILABLE"); }
  for (const [key, original] of captured.models) {
    const next = current.models.get(key);
    if (!next || JSON.stringify(next) !== JSON.stringify(original)) throw new WorkBindingError(`models.${key}`, "TARGET_MODEL_UNAVAILABLE");
  }
  return current;
}

/** Call on acceptance and immediately before publication. No source catalog/name/default fallback. */
export function resolveWorkBindings(store: CoreStore, profiles: Pick<RuntimeProfileStore, "credentialPath">,
  ownerUserId: string, requirements: WorkBindingRequirements, input: unknown): ResolvedWorkBindings {
  let bindings: WorkImportBindings;
  try { bindings = normalizeWorkImportBindings(input); } catch { return fail("bindings"); }
  if (!store.listManagedUsers().some((user) => user.id === ownerUserId && user.enabled)) fail("owner");
  for (const kind of ["models", "secrets"] as const) {
    const expected = requirements[kind].map((record) => record.key).sort(), actual = Object.keys(bindings[kind]).sort();
    if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index]) || new Set(expected).size !== expected.length) fail(kind);
  }
  const models = new Map<string, BoundWorkModel>(), secrets = new Map<string, string>();
  for (const requirement of requirements.models) {
    const field = `models.${requirement.key}`, catalogId = bindings.models[requirement.key]!;
    const entry = store.getCatalogEntry(catalogId);
    if (!entry || entry.kind !== "model" || !entry.enabled) fail(field);
    let metadata: { version?: unknown; provider?: unknown; id?: unknown; baseUrl?: unknown; credentialRef?: unknown; sourceRuntimeRevision?: unknown; updatedAt?: unknown };
    try { metadata = JSON.parse(entry.metadataJson) as typeof metadata; } catch { return fail(field); }
    if (!metadata || metadata.version !== 1 || metadata.provider !== requirement.provider || metadata.id !== requirement.model
      || (metadata.baseUrl !== undefined && typeof metadata.baseUrl !== "string")
      || normalizedUrl(metadata.baseUrl, field) !== normalizedUrl(requirement.baseUrl, field)
      || typeof metadata.credentialRef !== "string" || !Number.isSafeInteger(metadata.sourceRuntimeRevision) || (metadata.sourceRuntimeRevision as number) < 1 || typeof metadata.updatedAt !== "string") fail(field);
    const profile: RuntimeProfile = { version: 1, revision: metadata.sourceRuntimeRevision as number, agentImage: `sha256:${"0".repeat(64)}`,
      model: { provider: requirement.provider, id: requirement.model, ...(metadata.baseUrl === undefined ? {} : { baseUrl: metadata.baseUrl as string }), credentialRef: metadata.credentialRef }, updatedAt: metadata.updatedAt };
    try { verifyReadableFile(profiles.credentialPath(profile)); } catch { return fail(field); }
    const { agentImage: _image, ...captured } = profile;
    models.set(requirement.key, { catalogId, profile: captured });
  }
  for (const requirement of requirements.secrets) {
    const field = `secrets.${requirement.key}`, id = bindings.secrets[requirement.key]!;
    const secret = store.getSecretReference(id);
    if (!secret || (secret.ownerUserId !== null && secret.ownerUserId !== ownerUserId)) fail(field);
    try { verifyReadableFile(secret.storagePath); } catch { return fail(field); }
    secrets.set(requirement.key, id);
  }
  return { bindings, models, secrets };
}

export function captureImportedRuntimeProfile(bindings: ResolvedWorkBindings, modelBindingKey: string, imageIdentity: string): RuntimeProfile {
  const model = bindings.models.get(modelBindingKey);
  if (!model || !/^sha256:[a-f0-9]{64}$/.test(imageIdentity)) fail("context");
  return { ...model.profile, agentImage: imageIdentity };
}
