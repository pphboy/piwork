import { ReadFeedbackEpisodes } from './read-feedback.js';
export class AboutReadFeedback {
    episodes = new ReadFeedbackEpisodes();
    observe(facts, recovery) {
        return this.episodes.observe({
            owner: { identity: facts.identity, object: 'product-information', task: `about:${facts.side}`, generation: 0 },
            reading: facts.reading, error: facts.error, confirmedVersion: facts.confirmedVersion,
        }, recovery);
    }
}
//# sourceMappingURL=about-read-feedback.js.map