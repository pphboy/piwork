import { operationKindMatches } from './operation-recovery.js';
/** Presentation of an original receipt, never runtime readiness or lock admission. */
export function operationFeedback(owner, operation) {
    if (!operation || operation.id !== owner.operationId || operation.workId !== owner.workId)
        return;
    if (operation.observationError)
        return { tone: 'unknown', key: 'observation-unknown', state: 'unknown', reason: operation.observationError, terminal: false };
    if (operation.terminalHint || !owner.workId || operation.checkedWorkId !== owner.workId || !operation.checkedKind || !operationKindMatches(owner.kind, operation.checkedKind))
        return;
    if (owner.serviceId && operation.checkedServiceId !== owner.serviceId)
        return;
    switch (operation.state) {
        case 'unknown': return { tone: 'unknown', key: 'unknown', state: 'unknown', reason: operation.error, terminal: false };
        case 'failed': return { tone: 'error', key: 'failed', state: 'failed', reason: operation.error, terminal: true };
        case 'succeeded': return { tone: 'success', key: 'succeeded', state: 'succeeded', terminal: true };
        case 'superseded': return { tone: 'warning', key: 'superseded', state: 'superseded', terminal: true };
        default: return;
    }
}
/** Only this UI's accepted operations; no history scan, requests, polling, or mutation ownership. */
export class OperationFeedbackRegistry {
    identity = '';
    accepted = new Map();
    setIdentity(identity) {
        if (identity === this.identity)
            return;
        this.identity = identity;
        this.accepted.clear();
    }
    accept(operation, generation) {
        const previous = this.accepted.get(operation.id);
        if (previous)
            return previous;
        const owner = Object.freeze({ identity: this.identity, object: operation.workId, task: `operation:${operation.id}`, generation,
            operationId: operation.id, workId: operation.workId, kind: operation.kind, serviceId: operation.serviceId });
        this.accepted.set(operation.id, owner);
        return owner;
    }
    get(operationId) { return this.accepted.get(operationId); }
    owners() { return [...this.accepted.values()]; }
    published(owner, outcome, accepted) {
        if (accepted && outcome.terminal && this.accepted.get(owner.operationId) === owner)
            this.accepted.delete(owner.operationId);
    }
}
/** Notification priority only; it cannot release or rewrite the original request lock. */
export function operationFeedbackSource(outcome, action) {
    if (action.blocked)
        return 'action';
    if (outcome?.tone === 'unknown' || outcome?.state === 'failed')
        return 'operation';
    if (action.error || action.refresh === 'failed')
        return 'action';
    return outcome ? 'operation' : 'action';
}
export function importReadbackRecovered(owner, operation, record, facts) {
    if (!facts.currentRecord || owner.identity !== facts.identity || owner.generation !== `${record.generation}:${record.token}` ||
        !operationKindMatches(owner.kind, 'import_work') || record.action !== 'confirm-import' || record.kind !== 'transfer' ||
        record.businessId !== owner.operationId || !record.result || record.pending || record.blocked || record.error ||
        record.resultTone === 'unknown' || record.refresh !== 'failed' || record.refreshFailedAt === undefined)
        return false;
    if (operationFeedback(owner, operation)?.state !== 'succeeded' || facts.synchronizationPending ||
        facts.work?.id !== owner.workId || facts.work.statusError || facts.worksError || facts.worksLoading)
        return false;
    return Date.parse(facts.work.checkedAt || '') > record.refreshFailedAt && Date.parse(facts.worksCheckedAt || '') > record.refreshFailedAt;
}
//# sourceMappingURL=operation-feedback.js.map