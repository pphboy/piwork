import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import {
  validatePortableWorkSpec, validateWorkHistory, WorkPackageValidationError,
  type PortableWorkSpec, type WorkControlHistory, type WorkSourceIdentityMap, type WorkConfig,
} from "@piwork/contracts";
import { WorkContextStore, type WorkContextSnapshot } from "../configuration/work-context.js";
import { captureImportedRuntimeProfile, type ResolvedWorkBindings } from "./bindings.js";
import { restorePortableConfiguration, type WorkIdentityTargets } from "./metadata.js";

export interface VerifiedContextMaterial {
  /** Root restored by the trusted package helper from a verified skillsTree. */
  readonly skillsDirectory: string;
  readonly agentsBytes: Uint8Array;
}
export interface ImportedImageSelection { readonly identity: string; readonly selectionId: string }
export interface PreparedImportedContext {
  readonly key: string; readonly revision: number; readonly snapshot: WorkContextSnapshot;
  readonly configuration: WorkConfig; readonly runtimeProfileJson: string; readonly sourceRuntimeRevision: number;
}
export interface PreparedImportedContexts {
  readonly contexts: readonly PreparedImportedContext[];
  readonly activeContextId: string | null;
  readonly desiredContextId: string;
}
function invalid(field: string): never { throw new WorkPackageValidationError("PACKAGE_INVALID", field); }
function exactKeys<T>(items: readonly T[], key: (item: T) => string, expected: readonly string[], field: string): Map<string, T> {
  const map = new Map(items.map((item) => [key(item), item]));
  if (map.size !== items.length || map.size !== expected.length || expected.some((value) => !map.has(value))) invalid(field);
  return map;
}

/** Prepare all package-owned contexts before the target Work becomes visible. No global Skill lookup occurs. */
export function prepareImportedContexts(input: {
  readonly contextStore: WorkContextStore; readonly spec: PortableWorkSpec;
  readonly history: WorkControlHistory; readonly identities: WorkSourceIdentityMap;
  readonly targets: WorkIdentityTargets; readonly bindings: ResolvedWorkBindings;
  readonly materials: ReadonlyMap<string, VerifiedContextMaterial>;
  readonly images: ReadonlyMap<string, ImportedImageSelection>;
  readonly createdAt: string;
}): PreparedImportedContexts {
  const { contextStore, spec, history, identities, targets, bindings, materials, images, createdAt } = input;
  validatePortableWorkSpec(spec); validateWorkHistory(spec, history, identities);
  const keys = spec.contexts.map((context) => context.key);
  const targetContexts = exactKeys(targets.contexts, (entry) => entry.key, keys, "import.contextTargets");
  const targetServices = exactKeys(targets.services, (entry) => entry.key, spec.services.map((service) => service.key), "import.serviceTargets");
  const revisions = exactKeys(history.configurationRevisions, (entry) => entry.contextKey, keys, "import.contextRevisions");
  if (materials.size !== keys.length || keys.some((key) => !materials.has(key))) invalid("import.contextMaterials");
  if (images.size !== spec.images.length || spec.images.some((image) => images.get(image.key)?.identity !== image.imageId)) invalid("import.images");
  const services = new Map([...targetServices].map(([key, target]) => [key, target.id]));
  const prepared: PreparedImportedContext[] = [];
  try {
    for (const context of spec.contexts) {
      const material = materials.get(context.key)!, image = images.get(context.imageKey);
      const model = bindings.models.get(context.configuration.modelBindingKey);
      if (!material || !image || !model) invalid("import.contextBinding");
      if (createHash("sha256").update(material.agentsBytes).digest("hex") !== context.agentsBlob) invalid("import.agentsBlob");
      let agentsMd: string;
      try { agentsMd = new TextDecoder("utf-8", { fatal: true }).decode(material.agentsBytes); }
      catch { invalid("import.agentsUtf8"); }
      const configuration = restorePortableConfiguration(context.configuration, agentsMd, model.catalogId, image.selectionId, services, bindings.secrets);
      const profile = captureImportedRuntimeProfile(bindings, context.configuration.modelBindingKey, image.identity);
      const snapshot = contextStore.buildImported({ workId: targets.workId, snapshotId: targetContexts.get(context.key)!.id,
        configuration, imageIdentity: image.identity, verifiedSkillsDirectory: material.skillsDirectory,
        agentsBytes: material.agentsBytes, createdAt });
      prepared.push({ key: context.key, revision: revisions.get(context.key)!.revision, snapshot, configuration,
        runtimeProfileJson: JSON.stringify(profile), sourceRuntimeRevision: profile.revision });
    }
  } catch (error) {
    for (const item of prepared) contextStore.remove(targets.workId, item.snapshot.snapshotId);
    throw error;
  }
  return { contexts: prepared,
    activeContextId: spec.activeContext === null ? null : targetContexts.get(spec.activeContext)!.id,
    desiredContextId: targetContexts.get(spec.desiredContext)!.id };
}
