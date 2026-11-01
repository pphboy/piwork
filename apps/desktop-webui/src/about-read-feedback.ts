import type { NoticeEvent } from './notices.js';
import { ReadFeedbackEpisodes, type ReadFeedbackFacts } from './read-feedback.js';

/** Version read ownership is independent for the local CLI and connected Core. */
export interface AboutReadFacts {
  readonly identity: string;
  readonly side: 'local' | 'core';
  readonly reading: boolean;
  readonly error?: ReadFeedbackFacts['error'];
  readonly confirmedVersion?: object;
}
export class AboutReadFeedback {
  private episodes = new ReadFeedbackEpisodes();
  observe(facts: AboutReadFacts, recovery: NoticeEvent['recovery']) {
    return this.episodes.observe({
      owner: { identity: facts.identity, object: 'product-information', task: `about:${facts.side}`, generation: 0 },
      reading: facts.reading, error: facts.error, confirmedVersion: facts.confirmedVersion,
    }, recovery);
  }
}
