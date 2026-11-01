import { ReadFeedbackEpisodes } from './read-feedback.js';
/** Display only two original bootstrap reads, never connection mutations or task history. */
export class BootstrapReadFeedback {
    episodes = new ReadFeedbackEpisodes();
    observe(facts, recovery) {
        return this.episodes.observe({ owner: {
                identity: facts.identity, object: facts.source, task: `bootstrap-read:${facts.source}`, generation: 0,
            }, reading: facts.reading, error: facts.error, confirmedVersion: facts.receipt }, recovery);
    }
}
//# sourceMappingURL=bootstrap-read-feedback.js.map