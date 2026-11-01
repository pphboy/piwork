import { exportSnapshotAvailable } from './export-admission.js';
import { t } from './locale.js';
export async function saveExportFile(snapshotId, port) {
    const epoch = port.identityEpoch;
    const snapshot = await port.fetchSnapshot(snapshotId);
    if (port.identityEpoch !== epoch || snapshot.id !== snapshotId)
        throw new Error(t('export.notConfirmed'));
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
//# sourceMappingURL=export-panel-controls.js.map