import type { LocalizedMessage } from './locale.js';
import type { ActionRecord } from './action-state.js';
import type { NoticeEvent } from './notices.js';

/** Projection only: the ActionState remains the sole request/unknown-lock owner. */
export function actionNotice(
  record: Readonly<ActionRecord>,
  identity: string,
  message: () => string,
  recovery?: NoticeEvent['recovery'],
): NoticeEvent | undefined {
  if (record.pending || record.notificationProjection) return;
  const tone = record.blocked || record.resultTone === 'unknown' ? 'unknown' : record.error || record.refresh === 'failed' ? 'error' : record.result && record.kind !== 'read' ? record.resultTone || 'success' : undefined;
  if (!tone || tone === 'success' && !!record.successFeedback) return;
  return {
    identity,
    object: record.work || record.resource || 'identity',
    task: record.key,
    generation: `${record.generation}:${record.token}`,
    key: tone === 'success' ? 'success' : `${tone}:${record.refresh}`,
    tone,
    message,
    recovery,
  };
}

/** Only a confirmed read of the same key can retire its earlier read failure. */
export function confirmedReadRecovery(record: Readonly<ActionRecord>): string | undefined {
  return record.kind === 'read' && !record.pending && !record.error && !record.blocked &&
    record.refresh !== 'failed' && !!record.checkedAt ? record.key : undefined;
}

/** Preserve message identity until display time; no view or request state is captured. */
export function noticeMessage(value: string | LocalizedMessage | (() => string)): () => string {
  return typeof value === 'function' ? value : () => String(value);
}
