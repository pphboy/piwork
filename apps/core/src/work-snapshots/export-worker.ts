import { constants } from "node:fs";
import { link, mkdir, open, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { CoreStore } from "@piwork/core-store";
import type { DockerRuntime, SnapshotHelperSpec } from "@piwork/runtime-docker";
import { WorkContextStore } from "../configuration/work-context.js";
import { errorEnvelope, operationEnvelope, safeDiagnostic } from "../work-management/diagnostics.js";
import { captureWorkPackage, type SnapshotCaptureRuntime } from "./capture.js";
import { preflightWorkSnapshot } from "./preflight.js";

type ExportRuntime = Pick<DockerRuntime, "listManagedContainers" | "requireManagedVolume" | "inspectCapturedImage" | "createSnapshotHelper"
  | "startSnapshotHelper" | "removeSnapshotHelper" | "saveCapturedImage">;
function safeJobSegment(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/.test(value)) throw new Error("SNAPSHOT_JOB_INVALID");
  return value;
}
async function syncDirectory(path: string): Promise<void> {
  const file = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await file.sync(); } finally { await file.close(); }
}

/** Run an already accepted export. Ready bytes and the successful Operation share one fenced DB commit. */
export async function executeExportSnapshot(input: {
  readonly store: CoreStore; readonly contexts: WorkContextStore; readonly runtime: ExportRuntime;
  readonly installationId: string; readonly helperImageId: string; readonly snapshotsDirectory: string;
  readonly operationId: string; readonly epoch: number; readonly now?: () => Date; readonly signal?: AbortSignal;
}): Promise<{ readonly packageId: string; readonly snapshotId: string; readonly digest: string; readonly size: number }> {
  const { store, contexts, runtime, installationId, helperImageId, operationId, epoch } = input;
  const job = store.snapshots.assertFence(operationId, epoch);
  if (job.kind !== "export" || !job.sourceWorkId || !job.packageId || !job.snapshotId || job.phase !== "accepted") throw new Error("SNAPSHOT_JOB_INVALID");
  const jobPath = join(input.snapshotsDirectory, "jobs", safeJobSegment(operationId));
  const readyDirectory = join(input.snapshotsDirectory, "packages");
  const readyPath = join(readyDirectory, `${safeJobSegment(job.packageId)}.work`);
  const now = input.now ?? (() => new Date());
  const deadlineSignal = AbortSignal.timeout(Math.max(1, Date.parse(job.deadlineAt) - now().getTime()));
  const signal = input.signal ? AbortSignal.any([input.signal, deadlineSignal]) : deadlineSignal;
  let committed = false;
  const runtimeWithJournal: SnapshotCaptureRuntime = {
    ...runtime,
    createSnapshotHelper: (spec) => runtime.createSnapshotHelper(spec),
    startSnapshotHelper: (name, id, helperSignal) => runtime.startSnapshotHelper(name, id, helperSignal),
    removeSnapshotHelper: async (name, id) => {
      await runtime.removeSnapshotHelper(name, id);
      store.snapshots.updateArtifact(operationId, epoch, name, "cleaned");
    },
    saveCapturedImage: (imageId, blobs, signal) => runtime.saveCapturedImage(imageId, blobs, signal),
  };
  try {
    await mkdir(jobPath, { recursive: true, mode: 0o700 });
    await mkdir(readyDirectory, { recursive: true, mode: 0o700 });
    store.snapshots.updateJobPhase(operationId, epoch, "capturing", now().toISOString());
    const metadata = await preflightWorkSnapshot({ store, contexts, runtime, installationId, workId: job.sourceWorkId, currentExportOperationId: operationId });
    const captured = await captureWorkPackage({ metadata, runtime: runtimeWithJournal, installationId, jobId: operationId,
      helperImageId, spoolDirectory: jobPath, createdAt: now().toISOString(), signal,
      beforeHelper: (spec: SnapshotHelperSpec) => store.snapshots.insertArtifact({ operationId, artifactKey: spec.name,
        kind: "helper", logicalId: spec.name, state: "planned" }, epoch) });
    store.snapshots.updateJobPhase(operationId, epoch, "sealing", now().toISOString());
    if (now().toISOString() >= job.deadlineAt) throw new Error("SNAPSHOT_DEADLINE_EXCEEDED");
    store.snapshots.assertFence(operationId, epoch);
    await link(captured.stagingPath, readyPath);
    await syncDirectory(readyDirectory);
    const readyAt = now().toISOString(), expiresAt = new Date(Date.parse(readyAt) + 24 * 60 * 60_000).toISOString();
    store.snapshots.insertArtifact({ operationId, artifactKey: "sealed-package", kind: "sealed-package",
      logicalId: JSON.stringify({ digest: captured.verified.digest, size: captured.verified.size, readyAt, expiresAt }), state: "ready" }, epoch);
    store.snapshots.withFence(operationId, epoch, (tx) => {
      store.snapshots.sealPackage(job.packageId!, captured.verified.digest, captured.verified.size, readyAt, expiresAt);
      store.snapshots.releaseReservations(operationId, epoch);
      tx.run("UPDATE snapshot_jobs SET phase = 'succeeded', updated_at = ? WHERE operation_id = ?", readyAt, operationId);
      tx.run("UPDATE operations SET state = 'succeeded', result_json = ?, updated_at = ? WHERE id = ?",
        operationEnvelope({ correlationId: operationId, result: { observedState: "stopped" } }), readyAt, operationId);
    });
    committed = true;
    // The package and Operation are already committed. A spool cleanup error must not turn success into failure.
    await rm(jobPath, { recursive: true, force: true }).catch(() => undefined);
    return { packageId: job.packageId, snapshotId: job.snapshotId, digest: captured.verified.digest, size: captured.verified.size };
  } catch (error) {
    if (committed) throw error;
    let cleanupFailure: unknown;
    try {
      for (const artifact of store.snapshots.listArtifacts(operationId).filter((entry) => entry.kind === "helper" && entry.state !== "cleaned")) {
        await runtime.removeSnapshotHelper(artifact.logicalId, operationId);
        store.snapshots.updateArtifact(operationId, epoch, artifact.artifactKey, "cleaned");
      }
      const packageRecord = store.snapshots.getPackage(job.packageId);
      if (packageRecord?.state !== "ready") await unlink(readyPath).catch((unlinkError: NodeJS.ErrnoException) => { if (unlinkError.code !== "ENOENT") throw unlinkError; });
      await rm(jobPath, { recursive: true, force: true });
    } catch (failed) { cleanupFailure = failed; }
    if (cleanupFailure !== undefined) {
      const fenced = store.snapshots.fenceWorker(operationId, now().toISOString());
      store.snapshots.updateJobPhase(operationId, fenced.workerEpoch, "cleanup-pending", now().toISOString(), "SNAPSHOT_CLEANUP_REQUIRED");
    } else {
      store.snapshots.withFence(operationId, epoch, (tx) => {
        store.snapshots.releaseReservations(operationId, epoch);
        tx.run("UPDATE snapshot_packages SET state = 'expired' WHERE id = ? AND state = 'staging'", job.packageId);
        tx.run("UPDATE snapshot_jobs SET phase = 'cleaned', updated_at = ? WHERE operation_id = ?", now().toISOString(), operationId);
        tx.run("UPDATE operations SET state = 'failed', error_json = ?, updated_at = ? WHERE id = ?",
          errorEnvelope(safeDiagnostic("WORK_OPERATION_FAILED", "runtime-prepare")), now().toISOString(), operationId);
      });
    }
    throw error;
  }
}
