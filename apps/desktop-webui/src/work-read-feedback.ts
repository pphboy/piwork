import type { ActionRecord } from './action-state.js';
import type { NoticeEvent } from './notices.js';
import { ReadFeedbackEpisodes, type ReadFeedbackFacts } from './read-feedback.js';

export type WorkReadSource = 'works' | 'status' | 'services';
export interface WorkReadFacts {
  readonly identity: string;
  readonly workId?: string;
  readonly source: WorkReadSource;
  readonly reading: boolean;
  readonly error?: ReadFeedbackFacts['error'];
  readonly checkedAt?: string;
}
export class WorkReadFeedback {
  private episodes = new ReadFeedbackEpisodes();
  observe(facts: WorkReadFacts, recovery: NoticeEvent['recovery']) {
    return this.episodes.observe({ owner: {
      identity: facts.identity, object: facts.source === 'works' ? 'works' : facts.workId || '',
      task: `work-read:${facts.source}`, generation: 0,
    }, reading: facts.reading, error: facts.error, confirmedVersion: facts.checkedAt }, recovery);
  }
}
/** A resource failure can replace only its matching read, never a mutation's readback. */
export function workReadMatches(record: Readonly<ActionRecord>, facts: WorkReadFacts): boolean {
  if (record.kind !== 'read' || !record.error || !facts.error || String(record.errorMessage?.() || record.error) !== String(facts.error)) return false;
  if (facts.source === 'works') return record.action === 'retry-works';
  if (record.work !== facts.workId) return false;
  if (facts.source === 'services') return ['retry-services', 'tab-Services'].includes(record.action || '');
  return ['open-work', 'retry-work-read', 'check-work', 'check-work-progress'].includes(record.action || '') || record.key.startsWith('route:');
}
