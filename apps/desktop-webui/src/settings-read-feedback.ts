import type { ActionRecord } from './action-state.js';
import type { NoticeEvent } from './notices.js';
import { ReadFeedbackEpisodes, type ReadFeedbackFacts } from './read-feedback.js';

export type SettingsReadSource = 'configuration' | 'packages' | 'catalog-skills' | 'catalog-packages';
export interface SettingsReadFacts {
  readonly identity: string;
  readonly workId?: string;
  readonly source: SettingsReadSource;
  readonly reading: boolean;
  readonly error?: ReadFeedbackFacts['error'];
  readonly checkedAt?: string;
}
export class SettingsReadFeedback {
  private episodes = new ReadFeedbackEpisodes();
  observe(facts: SettingsReadFacts, recovery: NoticeEvent['recovery']) {
    return this.episodes.observe({ owner: {
      identity: facts.identity, object: facts.source.startsWith('catalog-') ? 'core-catalog' : facts.workId || '',
      task: `settings-read:${facts.source}`, generation: 0,
    }, reading: facts.reading, error: facts.error, confirmedVersion: facts.checkedAt }, recovery);
  }
}
export function settingsReadMatches(record: Readonly<ActionRecord>, facts: SettingsReadFacts): boolean {
  if (record.kind !== 'read' || !record.error || !facts.error || String(record.errorMessage?.() || record.error) !== String(facts.error)) return false;
  if (facts.source.startsWith('catalog-')) return record.action === 'check-catalog';
  if (record.work !== facts.workId) return false;
  return facts.source === 'configuration' ? ['settings', 'refresh-config'].includes(record.action || '') : record.action === 'refresh-packages';
}
