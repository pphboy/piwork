import type { Operation } from './models.js';
import type { NoticeEvent } from './notices.js';
import { operationKindMatches } from './operation-recovery.js';

type AcceptedOperation = Pick<Operation, 'id' | 'workId' | 'kind' | 'serviceId'>;
type ObservedOperation = Pick<Operation, 'id' | 'workId' | 'checkedWorkId' | 'checkedKind' | 'checkedServiceId' | 'state' | 'terminalHint' | 'observationError' | 'error'>;
export interface OperationFeedbackOwner extends Pick<NoticeEvent, 'identity' | 'object' | 'task' | 'generation'> {
  readonly operationId: string;
  readonly workId: string;
  readonly kind: string;
  readonly serviceId?: string;
}
export interface OperationFeedback {
  readonly tone: NoticeEvent['tone'];
  readonly key: string;
  readonly state: 'succeeded' | 'failed' | 'superseded' | 'unknown';
  readonly reason?: string;
  readonly terminal: boolean;
}

/** Presentation of an original receipt, never runtime readiness or lock admission. */
export function operationFeedback(owner: OperationFeedbackOwner, operation: ObservedOperation | undefined): OperationFeedback | undefined {
  if (!operation || operation.id !== owner.operationId || operation.workId !== owner.workId) return;
  if (operation.observationError) return { tone: 'unknown', key: 'observation-unknown', state: 'unknown', reason: operation.observationError, terminal: false };
  if (operation.terminalHint || !owner.workId || operation.checkedWorkId !== owner.workId || !operation.checkedKind || !operationKindMatches(owner.kind, operation.checkedKind)) return;
  if (owner.serviceId && operation.checkedServiceId !== owner.serviceId) return;
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
  private identity = '';
  private accepted = new Map<string, OperationFeedbackOwner>();
  setIdentity(identity: string): void {
    if (identity === this.identity) return;
    this.identity = identity;
    this.accepted.clear();
  }
  accept(operation: AcceptedOperation, generation: string): OperationFeedbackOwner {
    const previous = this.accepted.get(operation.id);
    if (previous) return previous;
    const owner = Object.freeze({ identity: this.identity, object: operation.workId, task: `operation:${operation.id}`, generation,
      operationId: operation.id, workId: operation.workId, kind: operation.kind, serviceId: operation.serviceId });
    this.accepted.set(operation.id, owner);
    return owner;
  }
  get(operationId: string): OperationFeedbackOwner | undefined { return this.accepted.get(operationId); }
  owners(): readonly OperationFeedbackOwner[] { return [...this.accepted.values()]; }
  published(owner: OperationFeedbackOwner, outcome: OperationFeedback, accepted: boolean): void {
    if (accepted && outcome.terminal && this.accepted.get(owner.operationId) === owner) this.accepted.delete(owner.operationId);
  }
}

/** Notification priority only; it cannot release or rewrite the original request lock. */
export function operationFeedbackSource(outcome: OperationFeedback | undefined, action: {
  readonly blocked?: boolean;
  readonly error?: string;
  readonly refresh?: string;
}): 'action' | 'operation' {
  if (action.blocked) return 'action';
  if (outcome?.tone === 'unknown' || outcome?.state === 'failed') return 'operation';
  if (action.error || action.refresh === 'failed') return 'action';
  return outcome ? 'operation' : 'action';
}
