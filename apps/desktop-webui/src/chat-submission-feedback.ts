import type { ActionRecord } from './action-state.js';

export interface OriginalChatSubmission {
  readonly work: string;
  readonly key: string;
  readonly kind: 'run' | 'session';
  readonly sessionId?: string;
}
interface AcceptedSubmissionReceipt {
  readonly kind?: string;
  readonly key?: string;
  readonly status?: string;
  readonly run?: Readonly<{ workId?: string; sessionId?: string; submissionKey?: string; runId?: string }>;
  readonly session?: Readonly<{ workId?: string; sessionId?: string }>;
}
/** Proof only. Caller must also fence identity/current ActionRecord before changing ownership. */
export function acceptedChatSubmissionOwns(
  record: Readonly<ActionRecord>, original: OriginalChatSubmission, receipt: AcceptedSubmissionReceipt | undefined,
): boolean {
  if (!record.blocked || record.pending || record.kind !== 'agent' || record.work !== original.work
    || record.businessId !== `submission:${original.key}` || !original.key
    || receipt?.kind !== original.kind || receipt.key !== original.key || receipt.status !== 'accepted') return false;
  if (original.kind === 'run') return ['send-message', 'retry-chat-submission'].includes(record.action || '')
    && !!original.sessionId && receipt.run?.workId === original.work && receipt.run.sessionId === original.sessionId
    && receipt.run.submissionKey === original.key && typeof receipt.run.runId === 'string' && !!receipt.run.runId;
  return ['new-session', 'send-message'].includes(record.action || '') && receipt.session?.workId === original.work
    && typeof receipt.session.sessionId === 'string' && !!receipt.session.sessionId;
}
