import type { NoticeEvent } from './notices.js';
import { ReadFeedbackEpisodes, type ReadFeedbackFacts } from './read-feedback.js';

export type BootstrapReadSource = 'status' | 'known-operations';
export interface BootstrapReadFacts {
  readonly identity: string;
  readonly source: BootstrapReadSource;
  readonly reading: boolean;
  readonly error?: ReadFeedbackFacts['error'];
  readonly receipt?: object;
}

/** Display only two original bootstrap reads, never connection mutations or task history. */
export class BootstrapReadFeedback {
  private episodes = new ReadFeedbackEpisodes();
  observe(facts: BootstrapReadFacts, recovery: NoticeEvent['recovery']) {
    return this.episodes.observe({ owner: {
      identity: facts.identity, object: facts.source, task: `bootstrap-read:${facts.source}`, generation: 0,
    }, reading: facts.reading, error: facts.error, confirmedVersion: facts.receipt }, recovery);
  }
}
