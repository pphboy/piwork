import type { Snapshot } from './models.js';
import type { ExportTransfer } from './export-flow.js';
import { exportSnapshotAvailable } from './export-admission.js';
import { t } from './locale.js';

/** Manual file delivery revalidates original facts; it never creates a snapshot/transfer. */
export interface ExportFilePort {
  readonly identityEpoch: number;
  fetchSnapshot(id: string): Promise<Snapshot>;
  checkTransfer(snapshotId: string): Promise<ExportTransfer | undefined>;
  currentSnapshot(id: string): Snapshot | undefined;
  currentTransfer(snapshotId: string): ExportTransfer | undefined;
  deliver(url: string, workId: string): void;
}

export async function saveExportFile(snapshotId: string, port: ExportFilePort): Promise<{ snapshotId: string; transferId: string; identityEpoch: number }> {
  const epoch = port.identityEpoch;
  const snapshot = await port.fetchSnapshot(snapshotId);
  if (port.identityEpoch !== epoch || snapshot.id !== snapshotId) throw new Error(t('export.notConfirmed'));
  const transfer = await port.checkTransfer(snapshotId);
  if (port.identityEpoch !== epoch || port.currentSnapshot(snapshotId) !== snapshot ||
      port.currentTransfer(snapshotId) !== transfer || !exportSnapshotAvailable(snapshot) ||
      !transfer?.ready || !transfer.transferId || transfer.snapshotId !== snapshot.id ||
      transfer.workId !== snapshot.workId) {
    throw new Error(t('export.notConfirmed'));
  }
  port.deliver(`/_desktop/api/downloads/${encodeURIComponent(transfer.transferId)}/content`, snapshot.workId);
  return { snapshotId, transferId: transfer.transferId, identityEpoch: epoch };
}
