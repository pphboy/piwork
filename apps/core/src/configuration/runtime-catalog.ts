import type { WorkConfig } from "@piwork/contracts";
import { CoreStore, type CatalogEntryRecord } from "@piwork/core-store";
import { InputValidationError } from "../input-validation.js";
import type { RuntimeProfile } from "./runtime-profile.js";

interface RuntimeModelMetadata {
  readonly version: 1;
  readonly provider: string;
  readonly id: string;
  readonly baseUrl?: string;
  readonly credentialRef: string;
  readonly sourceRuntimeRevision: number;
  readonly updatedAt: string;
}

export function registerRuntimeProfileCatalog(store: CoreStore, profile: RuntimeProfile): void {
  const now = profile.updatedAt;
  ensureEntry(store, {
    id: runtimeImageCatalogId(profile.revision),
    kind: "agent_image",
    name: `Runtime image revision ${profile.revision}`,
    mutableReference: profile.agentImage,
    resolvedDigest: null,
    metadataJson: JSON.stringify({ version: 1, sourceRuntimeRevision: profile.revision }),
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  ensureEntry(store, {
    id: runtimeModelCatalogId(profile.revision),
    kind: "model",
    name: `Runtime model revision ${profile.revision}`,
    mutableReference: null,
    resolvedDigest: null,
    metadataJson: JSON.stringify({
      version: 1,
      provider: profile.model.provider,
      id: profile.model.id,
      ...(profile.model.baseUrl === undefined ? {} : { baseUrl: profile.model.baseUrl }),
      credentialRef: profile.model.credentialRef,
      sourceRuntimeRevision: profile.revision,
      updatedAt: profile.updatedAt,
    } satisfies RuntimeModelMetadata),
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
}

export function runtimeImageCatalogId(revision: number): string {
  return `runtime-image-${String(revision).padStart(8, "0")}`;
}

export function runtimeModelCatalogId(revision: number): string {
  return `runtime-model-${String(revision).padStart(8, "0")}`;
}

export function resolveRuntimeProfileFromWorkConfig(
  store: CoreStore,
  configuration: WorkConfig,
): { readonly profile: RuntimeProfile; readonly sourceRuntimeRevision: number } {
  const image = store.getCatalogEntry(configuration.agentImage.catalogId);
  if (image === undefined || image.kind !== "agent_image" || !image.enabled || image.mutableReference === null) {
    throw new InputValidationError("Work agent image reference is unavailable");
  }
  const model = store.getCatalogEntry(configuration.modelRef);
  if (model === undefined || model.kind !== "model" || !model.enabled) {
    throw new InputValidationError("Work model reference is unavailable");
  }
  const metadata = parseModelMetadata(model);
  return {
    profile: {
      version: 1,
      revision: metadata.sourceRuntimeRevision,
      agentImage: image.resolvedDigest ?? image.mutableReference,
      model: {
        provider: metadata.provider,
        id: metadata.id,
        ...(metadata.baseUrl === undefined ? {} : { baseUrl: metadata.baseUrl }),
        credentialRef: metadata.credentialRef,
      },
      updatedAt: metadata.updatedAt,
    },
    sourceRuntimeRevision: metadata.sourceRuntimeRevision,
  };
}

function ensureEntry(store: CoreStore, entry: CatalogEntryRecord): void {
  const existing = store.getCatalogEntry(entry.id);
  if (existing === undefined) {
    store.createCatalogEntry(entry);
    return;
  }
  if (existing.kind !== entry.kind || existing.metadataJson !== entry.metadataJson || existing.mutableReference !== entry.mutableReference) {
    throw new Error(`runtime catalog entry ${entry.id} conflicts with persisted data`);
  }
}

function parseModelMetadata(entry: CatalogEntryRecord): RuntimeModelMetadata {
  let value: unknown;
  try {
    value = JSON.parse(entry.metadataJson);
  } catch {
    throw new InputValidationError("Work model metadata is malformed");
  }
  if (value === null || typeof value !== "object") throw new InputValidationError("Work model metadata is malformed");
  const metadata = value as Partial<RuntimeModelMetadata>;
  if (metadata.version !== 1 || typeof metadata.provider !== "string" || typeof metadata.id !== "string"
    || typeof metadata.credentialRef !== "string" || !Number.isInteger(metadata.sourceRuntimeRevision)
    || (metadata.sourceRuntimeRevision ?? 0) < 1 || typeof metadata.updatedAt !== "string"
    || (metadata.baseUrl !== undefined && typeof metadata.baseUrl !== "string")) {
    throw new InputValidationError("Work model metadata is malformed");
  }
  return metadata as RuntimeModelMetadata;
}
