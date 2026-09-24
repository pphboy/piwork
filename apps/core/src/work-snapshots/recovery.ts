import { createReadStream, existsSync } from "node:fs";
import { rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { CoreStore } from "@piwork/core-store";
import type { DockerRuntime } from "@piwork/runtime-docker";
import { readWorkPackage } from "@piwork/work-package";
import { WorkContextStore } from "../configuration/work-context.js";
import { errorEnvelope, operationEnvelope, safeDiagnostic } from "../work-management/diagnostics.js";
import type { WorkIdentityTargets } from "./metadata.js";

type CleanupRuntime = Pick<DockerRuntime, "removeSnapshotHelper" | "deleteManagedVolume">;
function segment(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/.test(value)) throw new Error("SNAPSHOT_JOURNAL_INVALID");
  return value;
}
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === "ENOENT"; }

/** Startup and timeout recovery only follows durable, job-owned artifact intents. */
export async function recoverSnapshotJobs(input: {
  readonly store: CoreStore; readonly contexts: WorkContextStore; readonly runtime: CleanupRuntime;
  readonly snapshotsDirectory: string; readonly now?: () => Date; readonly onlyCleanupPending?: boolean;
}): Promise<{ cleaned: number; pending: number }> {
  const { store, contexts, runtime, snapshotsDirectory } = input, now = input.now ?? (() => new Date());
  let cleaned = 0, pending = 0;
  for (const previous of store.snapshots.listJobs(true).filter((job) => !input.onlyCleanupPending || job.phase === "cleanup-pending")) {
    const job = store.snapshots.fenceWorker(previous.operationId, now().toISOString()), epoch = job.workerEpoch;
    try {
      for (const artifact of store.snapshots.listArtifacts(job.operationId).filter((item) => item.kind === "helper" && item.state !== "cleaned")) {
        await runtime.removeSnapshotHelper(segment(artifact.logicalId), job.operationId);
        store.snapshots.updateArtifact(job.operationId, epoch, artifact.artifactKey, "cleaned");
      }
      if (job.kind === "export" && job.packageId && previous.phase !== "cleanup-pending") {
        const sealed = store.snapshots.listArtifacts(job.operationId).find((item) => item.artifactKey === "sealed-package" && item.kind === "sealed-package" && item.state === "ready");
        if (sealed) {
          const marker = JSON.parse(sealed.logicalId) as { digest?: unknown; size?: unknown; readyAt?: unknown; expiresAt?: unknown };
          if (typeof marker.digest !== "string" || !/^[a-f0-9]{64}$/.test(marker.digest)
            || typeof marker.size !== "number" || !Number.isSafeInteger(marker.size) || marker.size < 0
            || typeof marker.readyAt !== "string" || !Number.isFinite(Date.parse(marker.readyAt))
            || typeof marker.expiresAt !== "string" || !Number.isFinite(Date.parse(marker.expiresAt))) throw new Error("SNAPSHOT_JOURNAL_INVALID");
          const readyPath = join(snapshotsDirectory, "packages", `${segment(job.packageId)}.work`);
          const verified = await readWorkPackage(createReadStream(readyPath)).catch(() => undefined);
          if (verified?.digest === marker.digest && verified.size === marker.size) {
            store.snapshots.withFence(job.operationId, epoch, (tx) => {
              store.snapshots.sealPackage(job.packageId!, marker.digest as string, marker.size as number, marker.readyAt as string, marker.expiresAt as string);
              store.snapshots.releaseReservations(job.operationId, epoch);
              tx.run("UPDATE snapshot_jobs SET phase = 'succeeded', cleanup_error = NULL, updated_at = ? WHERE operation_id = ?", now().toISOString(), job.operationId);
              tx.run("UPDATE operations SET state = 'succeeded', result_json = ?, updated_at = ? WHERE id = ? AND state IN ('pending','running')",
                operationEnvelope({ correlationId: job.operationId, result: { observedState: "stopped" } }), now().toISOString(), job.operationId);
            });
            await rm(join(snapshotsDirectory, "jobs", segment(job.operationId)), { recursive: true, force: true }).catch(() => undefined);
            cleaned++;
            continue;
          }
        }
      }
      if (job.kind === "import" && job.targetWorkId) {
        // A crash can land after Docker creates the target volume but before
        // its journal row advances from planned to created. Removal is idempotent
        // and requires this exact job label, so an unrelated same-name volume survives.
        for (const artifact of store.snapshots.listArtifacts(job.operationId).filter((item) => item.kind === "volume" && ["planned", "created", "ready", "cleaning"].includes(item.state))) {
          const volume = JSON.parse(artifact.logicalId) as { logicalId?: unknown };
          if (volume.logicalId !== "work-private" && volume.logicalId !== "work-workspace") throw new Error("SNAPSHOT_JOURNAL_INVALID");
          await runtime.deleteManagedVolume(job.targetWorkId, volume.logicalId, { snapshotJobId: job.operationId });
          store.snapshots.updateArtifact(job.operationId, epoch, artifact.artifactKey, "cleaned");
        }
        const identity = store.snapshots.listArtifacts(job.operationId).find((item) => item.artifactKey === "identity-map");
        if (!identity || identity.kind !== "identity-map") throw new Error("SNAPSHOT_JOURNAL_INVALID");
        const targets = JSON.parse(identity.logicalId) as WorkIdentityTargets;
        if (targets.workId !== job.targetWorkId || !Array.isArray(targets.contexts)) throw new Error("SNAPSHOT_JOURNAL_INVALID");
        for (const context of targets.contexts) {
          contexts.remove(job.targetWorkId, segment(context.id));
          if (existsSync(join(contexts.rootDirectory, job.targetWorkId, "contexts", context.id))) throw new Error("SNAPSHOT_CONTEXT_CLEANUP_PENDING");
        }
      }
      const spool = join(snapshotsDirectory, "jobs", segment(job.operationId));
      await rm(spool, { recursive: true, force: true });
      const packageRecord = job.packageId === null ? undefined : store.snapshots.getPackage(job.packageId);
      if (job.kind === "export" && job.packageId && packageRecord?.state !== "ready")
        await unlink(join(snapshotsDirectory, "packages", `${segment(job.packageId)}.work`)).catch((error) => { if (!missing(error)) throw error; });
      store.snapshots.withFence(job.operationId, epoch, (tx) => {
        store.snapshots.releaseReservations(job.operationId, epoch);
        if (job.kind === "import" && job.targetWorkId)
          tx.run("DELETE FROM quota_reservations WHERE work_id = ? AND subject_kind = 'import' AND subject_id = 'import'", job.targetWorkId);
        if (job.kind === "export" && job.packageId)
          tx.run("UPDATE snapshot_packages SET state = 'expired' WHERE id = ? AND state = 'staging'", job.packageId);
        tx.run("UPDATE snapshot_jobs SET phase = 'cleaned', cleanup_error = NULL, updated_at = ? WHERE operation_id = ?", now().toISOString(), job.operationId);
        tx.run("UPDATE operations SET state = 'failed', error_json = ?, updated_at = ? WHERE id = ? AND state IN ('pending','running')",
          errorEnvelope(safeDiagnostic("WORK_OPERATION_FAILED", "runtime-prepare")), now().toISOString(), job.operationId);
      });
      cleaned++;
    } catch {
      store.snapshots.updateJobPhase(job.operationId, epoch, "cleanup-pending", now().toISOString(), "SNAPSHOT_CLEANUP_REQUIRED");
      pending++;
    }
  }
  for (const transfer of input.onlyCleanupPending ? [] : store.snapshots.listTransfers()) {
    try {
      if (transfer.helperId) await runtime.removeSnapshotHelper(segment(transfer.helperId), transfer.id);
      const packageRecord = transfer.packageId === null ? undefined : store.snapshots.getPackage(transfer.packageId);
      if (transfer.kind === "upload" && transfer.packageId && packageRecord?.state !== "ready") {
        await unlink(join(snapshotsDirectory, "packages", `${segment(transfer.packageId)}.work`)).catch((error) => { if (!missing(error)) throw error; });
        store.exec(`UPDATE snapshot_packages SET state = 'expired' WHERE id = '${segment(transfer.packageId)}' AND state = 'staging'`);
      }
      await rm(join(snapshotsDirectory, "transfers", segment(transfer.id)), { recursive: true, force: true });
      store.snapshots.finishTransfer(transfer.id);
      cleaned++;
    } catch {
      store.snapshots.updateTransfer(transfer.id, "cleanup-pending", now().toISOString(), transfer.helperId);
      pending++;
    }
  }
  return { cleaned, pending };
}
