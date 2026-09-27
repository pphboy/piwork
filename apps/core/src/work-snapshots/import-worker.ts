import { createHash, randomUUID } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { CoreStore } from "@piwork/core-store";
import { encodeWorkJson, WorkBlobDirectory, type NormalizedImage } from "@piwork/work-package";
import { managedVolumeName, type DockerRuntime, type SnapshotHelperSpec } from "@piwork/runtime-docker";
import type { WorkControlHistory, WorkImportBindings, WorkSourceIdentityMap } from "@piwork/contracts";
import { WorkContextStore, packageNameKey } from "../configuration/work-context.js";
import type { RuntimeProfileStore } from "../configuration/runtime-profile.js";
import { errorEnvelope, safeDiagnostic } from "../work-management/diagnostics.js";
import { revalidateCapturedWorkBindings, type BoundWorkModel, type ResolvedWorkBindings } from "./bindings.js";
import { prepareImportedContexts, type ImportedImageSelection, type VerifiedContextMaterial } from "./import-contexts.js";
import type { WorkIdentityTargets } from "./metadata.js";
import { stageVerifiedPackage } from "./package-stage.js";
import { publishImportedWork, type StagedImportVolume } from "./publish.js";

type ImportRuntime = Pick<DockerRuntime, "inspectHostPlatform" | "loadVerifiedImage" | "ensureManagedVolume" | "deleteManagedVolume"
  | "createSnapshotHelper" | "startSnapshotHelper" | "removeSnapshotHelper">;
function jobSegment(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/.test(value)) throw new Error("SNAPSHOT_JOB_INVALID");
  return value;
}
function journal<T>(store: CoreStore, operationId: string, key: string, kind: string): T {
  const entry = store.snapshots.listArtifacts(operationId).find((item) => item.artifactKey === key);
  if (entry?.kind !== kind || entry.state !== "ready") throw new Error("SNAPSHOT_JOURNAL_INVALID");
  return JSON.parse(entry.logicalId) as T;
}
function helperName(operationId: string, suffix: string): string {
  return `snapshot-${createHash("sha256").update(operationId).digest("hex").slice(0, 16)}-${suffix}`;
}
async function readSmallBlob(blobs: WorkBlobDirectory, digest: string, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of blobs.read(digest)) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("PACKAGE_LIMIT_EXCEEDED");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

/** Restore only unpublished artifacts, then expose the complete stopped Work in one SQL transaction. */
export async function executeImportSnapshot(input: {
  readonly store: CoreStore; readonly contexts: WorkContextStore; readonly profiles: RuntimeProfileStore;
  readonly runtime: ImportRuntime; readonly installationId: string; readonly helperImageId: string;
  readonly snapshotsDirectory: string; readonly operationId: string; readonly epoch: number;
  readonly now?: () => Date; readonly signal?: AbortSignal;
}): Promise<string> {
  const { store, contexts, profiles, runtime, installationId, helperImageId, operationId, epoch } = input;
  const job = store.snapshots.assertFence(operationId, epoch);
  if (job.kind !== "import" || !job.targetWorkId || !job.packageId || job.phase !== "accepted") throw new Error("SNAPSHOT_JOB_INVALID");
  const packageRecord = store.snapshots.getPackage(job.packageId);
  if (!packageRecord || packageRecord.state !== "ready" || !packageRecord.digest || packageRecord.ownerUserId !== job.ownerUserId) throw new Error("PACKAGE_NOT_READY");
  const targets = journal<WorkIdentityTargets>(store, operationId, "identity-map", "identity-map");
  const captured = journal<{ bindings: WorkImportBindings; models: [string, BoundWorkModel][] }>(store, operationId, "bindings", "bindings");
  const capturedBindings: ResolvedWorkBindings = { bindings: captured.bindings, models: new Map(captured.models), secrets: new Map() };
  if (targets.workId !== job.targetWorkId) throw new Error("SNAPSHOT_JOURNAL_INVALID");
  const now = input.now ?? (() => new Date());
  const deadlineSignal = AbortSignal.timeout(Math.max(1, Date.parse(job.deadlineAt) - now().getTime()));
  const signal = input.signal ? AbortSignal.any([input.signal, deadlineSignal]) : deadlineSignal;
  const jobPath = join(input.snapshotsDirectory, "jobs", jobSegment(operationId));
  const packagePath = join(input.snapshotsDirectory, "packages", `${jobSegment(job.packageId)}.work`);
  const volumes: StagedImportVolume[] = [];
  const images = new Map<string, ImportedImageSelection>();
  let prepared: ReturnType<typeof prepareImportedContexts> | undefined;
  let committed = false;
  const runHelper = async (suffix: string, action: SnapshotHelperSpec["action"], volumeName?: string, treeDigest?: string, contextKey?: string, packageKey?: string) => {
    const name = helperName(operationId, suffix);
    const spec: SnapshotHelperSpec = { installationId, jobId: operationId, name, imageId: helperImageId, spoolDirectory: jobPath,
      action, ...(volumeName === undefined ? {} : { volumeName }), ...(treeDigest === undefined ? {} : { treeDigest }),
      ...(contextKey === undefined ? {} : { contextKey }), ...(packageKey === undefined ? {} : { packageKey }) };
    store.snapshots.insertArtifact({ operationId, artifactKey: name, kind: "helper", logicalId: name, state: "planned" }, epoch);
    await runtime.createSnapshotHelper(spec);
    try { return await runtime.startSnapshotHelper(name, operationId, signal); }
    finally {
      await runtime.removeSnapshotHelper(name, operationId);
      store.snapshots.updateArtifact(operationId, epoch, name, "cleaned");
    }
  };
  try {
    await mkdir(jobPath, { recursive: true, mode: 0o700 });
    store.snapshots.updateJobPhase(operationId, epoch, "verifying", now().toISOString());
    const { verified, blobs } = await stageVerifiedPackage({ packagePath, spoolDirectory: jobPath,
      expectedDigest: packageRecord.digest, expectedSize: packageRecord.size, signal });
    const spec = verified.spec;
    const hostPlatform = await runtime.inspectHostPlatform();
    if (spec.compatibility.os !== hostPlatform.os || spec.compatibility.architecture !== hostPlatform.architecture
      || spec.compatibility.variant !== hostPlatform.variant) throw new Error("PACKAGE_INCOMPATIBLE");
    const history = verified.metadata.get(spec.history.control) as WorkControlHistory;
    const identities = verified.metadata.get(spec.history.sourceIdentityMap) as WorkSourceIdentityMap;
    if (!history || !identities) throw new Error("PACKAGE_INVALID");
    const resolved = revalidateCapturedWorkBindings(store, profiles, job.ownerUserId, spec.bindings, capturedBindings);
    store.snapshots.updateJobPhase(operationId, epoch, "restoring", now().toISOString());
    for (const image of spec.images) {
      const normalized: NormalizedImage = { image: { imageId: image.imageId, platform: image.platform, config: image.config, layers: image.layers },
        blobs: [image.config, ...image.layers].map((digest) => {
          const descriptor = spec.blobs.find((blob) => blob.digest === digest);
          if (!descriptor) throw new Error("PACKAGE_INVALID");
          return { digest, size: descriptor.size };
        }) };
      const loaded = await runtime.loadVerifiedImage(normalized, blobs, signal);
      if (loaded.imageId !== image.imageId) throw new Error("SNAPSHOT_IMAGE_INCOMPATIBLE");
      const selection = { identity: image.imageId, selectionId: `owned-image-${randomUUID()}` };
      images.set(image.key, selection);
      store.snapshots.insertArtifact({ operationId, artifactKey: `image-${image.key}`, kind: "image", logicalId: image.imageId, state: "ready" }, epoch);
    }
    for (const volume of spec.volumes) {
      const logicalId = volume.role === "agent-private" ? "work-private" : "work-workspace";
      const staged: StagedImportVolume = { role: volume.role, id: `volume-${randomUUID()}`,
        runtimeName: managedVolumeName(installationId, targets.workId, logicalId) };
      const artifactKey = `volume-${volume.role}`;
      store.snapshots.insertArtifact({ operationId, artifactKey, kind: "volume", logicalId: JSON.stringify({ ...staged, logicalId }), state: "planned" }, epoch);
      const ensured = await runtime.ensureManagedVolume(targets.workId, logicalId, { snapshotJobId: operationId });
      if (!ensured.created || ensured.volumeName !== staged.runtimeName) throw new Error("SNAPSHOT_VOLUME_CONFLICT");
      volumes.push(staged);
      store.snapshots.updateArtifact(operationId, epoch, artifactKey, "created");
      const response = await runHelper(`restore-${volume.role}`, "restore", staged.runtimeName, volume.tree) as { tree?: unknown } | null;
      if (!response || response.tree !== volume.tree) throw new Error("SNAPSHOT_RESTORE_INVALID");
      store.snapshots.updateArtifact(operationId, epoch, artifactKey, "ready");
    }
    const requestFile = await open(join(jobPath, "history-request.json"), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await requestFile.writeFile(encodeWorkJson({ sourceWorkId: identities.sourceWorkId, contextIds: identities.contexts.map((item) => item.sourceId),
      targetWorkId: targets.workId, contexts: identities.contexts.map((item) => ({ sourceId: item.sourceId, targetId: targets.contexts.find((target) => target.key === item.key)?.id })) }));
      await requestFile.sync();
    } finally { await requestFile.close(); }
    const historyResult = await runHelper("restore-history", "restore-history", volumes.find((item) => item.role === "agent-private")!.runtimeName) as { historyPresent?: unknown } | null;
    if (!historyResult || typeof historyResult.historyPresent !== "boolean" || (spec.activeContext !== null && !historyResult.historyPresent)) throw new Error("SNAPSHOT_HISTORY_INVALID");
    const materials = new Map<string, VerifiedContextMaterial>();
    for (const context of spec.contexts) {
      const skillsDirectory = join(jobPath, "contexts", context.key);
      await mkdir(skillsDirectory, { recursive: true, mode: 0o700 });
      const response = await runHelper(`restore-context-${context.key}`, "restore-context", undefined, context.skillsTree, context.key) as { tree?: unknown } | null;
      if (!response || response.tree !== context.skillsTree) throw new Error("SNAPSHOT_CONTEXT_INVALID");
      const packagesDirectory = join(jobPath, "context-packages", context.key);
      await mkdir(packagesDirectory, { recursive: true, mode: 0o700 });
      for (const binding of context.packageBindings) {
        const artifact = spec.piPackageArtifacts.find((item) => item.key === binding.artifactKey);
        if (!artifact) throw new Error("SNAPSHOT_CONTEXT_INVALID");
        const nameKey = packageNameKey(binding.name);
        await mkdir(join(packagesDirectory, nameKey), { mode: 0o700 });
        const restored = await runHelper(`restore-package-${context.key}-${nameKey.slice(0, 12)}`, "restore-package",
          undefined, artifact.treeDigest, context.key, nameKey) as { tree?: unknown } | null;
        if (!restored || restored.tree !== artifact.treeDigest) throw new Error("SNAPSHOT_CONTEXT_INVALID");
      }
      materials.set(context.key, { skillsDirectory, packagesDirectory, agentsBytes: await readSmallBlob(blobs, context.agentsBlob, 4 * 1024 * 1024) });
      store.snapshots.insertArtifact({ operationId, artifactKey: `context-${context.key}`, kind: "context", logicalId: targets.contexts.find((target) => target.key === context.key)?.id ?? "",
        state: "planned" }, epoch);
    }
    prepared = prepareImportedContexts({ contextStore: contexts, spec, history, identities, targets, bindings: resolved, materials, images, createdAt: now().toISOString() });
    for (const context of spec.contexts) store.snapshots.updateArtifact(operationId, epoch, `context-${context.key}`, "ready");
    store.snapshots.updateJobPhase(operationId, epoch, "publishing", now().toISOString());
    if (now().toISOString() >= job.deadlineAt) throw new Error("SNAPSHOT_DEADLINE_EXCEEDED");
    const workId = publishImportedWork({ store, operationId, epoch, verified, targets, prepared, images, volumes, installationId, now: now().toISOString(),
      revalidateBindings: () => { revalidateCapturedWorkBindings(store, profiles, job.ownerUserId, spec.bindings, capturedBindings); } });
    committed = true;
    await rm(jobPath, { recursive: true, force: true }).catch(() => undefined);
    return workId;
  } catch (error) {
    if (committed) throw error;
    let cleanupFailure: unknown;
    try {
      for (const artifact of store.snapshots.listArtifacts(operationId).filter((item) => item.kind === "helper" && item.state !== "cleaned")) {
        await runtime.removeSnapshotHelper(artifact.logicalId, operationId);
        store.snapshots.updateArtifact(operationId, epoch, artifact.artifactKey, "cleaned");
      }
      for (const artifact of store.snapshots.listArtifacts(operationId).filter((item) => item.kind === "volume" && ["planned", "created", "ready", "cleaning"].includes(item.state))) {
        const volume = JSON.parse(artifact.logicalId) as { logicalId: string };
        await runtime.deleteManagedVolume(targets.workId, volume.logicalId, { snapshotJobId: operationId });
        store.snapshots.updateArtifact(operationId, epoch, artifact.artifactKey, "cleaned");
      }
      for (const context of targets.contexts) {
        contexts.remove(targets.workId, context.id);
        if (existsSync(join(contexts.rootDirectory, targets.workId, "contexts", context.id))) throw new Error("SNAPSHOT_CONTEXT_CLEANUP_PENDING");
      }
      await rm(jobPath, { recursive: true, force: true });
    } catch (failed) { cleanupFailure = failed; }
    if (cleanupFailure !== undefined) {
      const fenced = store.snapshots.fenceWorker(operationId, now().toISOString());
      store.snapshots.updateJobPhase(operationId, fenced.workerEpoch, "cleanup-pending", now().toISOString(), "SNAPSHOT_CLEANUP_REQUIRED");
    } else {
      store.snapshots.withFence(operationId, epoch, (tx) => {
        store.snapshots.releaseReservations(operationId, epoch);
        tx.run("DELETE FROM quota_reservations WHERE work_id = ? AND subject_kind = 'import' AND subject_id = 'import'", targets.workId);
        tx.run("UPDATE snapshot_jobs SET phase = 'cleaned', updated_at = ? WHERE operation_id = ?", now().toISOString(), operationId);
        tx.run("UPDATE operations SET state = 'failed', error_json = ?, updated_at = ? WHERE id = ?",
          errorEnvelope(safeDiagnostic(error instanceof Error && error.message === "PACKAGE_INCOMPATIBLE" ? "PACKAGE_INCOMPATIBLE"
            : (error as { code?: string }).code === "TARGET_MODEL_UNAVAILABLE" ? "TARGET_MODEL_UNAVAILABLE" : "WORK_OPERATION_FAILED", "runtime-prepare")), now().toISOString(), operationId);
      });
    }
    throw error;
  }
}
