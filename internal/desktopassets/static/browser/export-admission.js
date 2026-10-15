/** A flow owns its own combined Stop record, never another pending/unknown control. */
export function exportWorkConflict(records, workId, ownFlowId) {
    return [...records].find(record => record.work === workId && record.kind === 'lifecycle' && (record.pending || record.blocked) &&
        !(ownFlowId && record.businessId === ownFlowId));
}
/** Evaluate again at the content boundary, after every awaited metadata read. */
export function exportSnapshotAvailable(snapshot, now = Date.now()) {
    return snapshot.status === 'verified' && (snapshot.expiresAt == null || Number.isFinite(Date.parse(snapshot.expiresAt)) && Date.parse(snapshot.expiresAt) > now);
}
//# sourceMappingURL=export-admission.js.map