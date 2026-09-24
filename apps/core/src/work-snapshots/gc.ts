import { rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { CoreStore } from "@piwork/core-store";
import type { DockerRuntime } from "@piwork/runtime-docker";

function segment(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/.test(value)) throw new Error("SNAPSHOT_JOURNAL_INVALID");
  return value;
}
function ignoreMissing(error: unknown): void { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

/** Periodic TTL collection. Package tombstones remain for owner-only 410 and idempotency replay. */
export async function collectSnapshotGarbage(input: {
  readonly store: CoreStore; readonly runtime: Pick<DockerRuntime, "removeSnapshotHelper">;
  readonly snapshotsDirectory: string; readonly now?: () => Date;
}): Promise<{ packages: number; transfers: number; pending: number }> {
  const { store, runtime, snapshotsDirectory } = input, now = (input.now ?? (() => new Date()))().toISOString();
  let packages = 0, transfers = 0, pending = 0;
  for (const record of store.snapshots.listPackages()) {
    if (record.state === "ready" && record.expiresAt !== null && record.expiresAt <= now) store.snapshots.expirePackage(record.id, now);
    const current = store.snapshots.getPackage(record.id);
    if (current?.state !== "expired" || store.snapshots.packageInUse(record.id)) continue;
    try {
      await unlink(join(snapshotsDirectory, "packages", `${segment(record.id)}.work`)).catch(ignoreMissing);
      packages++;
    } catch { pending++; }
  }
  for (const transfer of store.snapshots.listTransfers()) {
    if (transfer.deadlineAt > now) continue;
    try {
      if (transfer.helperId) await runtime.removeSnapshotHelper(segment(transfer.helperId), transfer.id);
      if (transfer.kind === "upload" && transfer.packageId) {
        const record = store.snapshots.getPackage(transfer.packageId);
        if (record?.state === "staging") {
          await unlink(join(snapshotsDirectory, "packages", `${segment(transfer.packageId)}.work`)).catch(ignoreMissing);
          store.exec(`UPDATE snapshot_packages SET state = 'expired' WHERE id = '${segment(transfer.packageId)}' AND state = 'staging'`);
        }
      }
      await rm(join(snapshotsDirectory, "transfers", segment(transfer.id)), { recursive: true, force: true });
      store.snapshots.finishTransfer(transfer.id); transfers++;
    } catch {
      store.snapshots.updateTransfer(transfer.id, "cleanup-pending", now, transfer.helperId); pending++;
    }
  }
  return { packages, transfers, pending };
}
