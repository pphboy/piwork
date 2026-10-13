import type { ActionRecord } from './action-state.js';
import type { Snapshot } from './models.js';

/** A flow owns its own combined Stop record, never another pending/unknown control. */
export function exportWorkConflict(records: Iterable<ActionRecord>, workId: string, ownFlowId?: string) {
  return [...records].find(record => record.work === workId && record.kind === 'lifecycle' && (record.pending || record.blocked) &&
    !(ownFlowId && record.businessId === ownFlowId));
}
/** Evaluate again at the content boundary, after every awaited metadata read. */
export function exportSnapshotAvailable(snapshot: Snapshot, now = Date.now()) {
  return snapshot.status === 'verified' && (snapshot.expiresAt == null || Number.isFinite(Date.parse(snapshot.expiresAt)) && Date.parse(snapshot.expiresAt) > now);
}
