/** Display episodes only. It never starts reads, changes errors, or releases business locks. */
export class ReadFeedbackEpisodes {
    identity = '';
    episodes = new Map();
    observe(facts, recovery) {
        if (facts.owner.identity !== this.identity) {
            this.identity = facts.owner.identity;
            this.episodes.clear();
        }
        const key = JSON.stringify([facts.owner.object, facts.owner.task, facts.owner.generation]);
        const episode = this.episodes.get(key) ?? { failed: false, reading: false, proofToken: 0 };
        this.episodes.set(key, episode);
        if (facts.reading && !episode.reading || facts.error || facts.confirmedVersion !== episode.currentVersion)
            episode.proofToken++;
        episode.reading = facts.reading;
        episode.currentVersion = facts.confirmedVersion;
        if (facts.error) {
            if (!episode.failed) {
                episode.failed = true;
                episode.failureVersion = facts.confirmedVersion;
            }
            episode.error = facts.error;
            episode.tone = facts.tone || 'error';
        }
        const confirmed = facts.confirmedVersion !== undefined && facts.confirmedVersion !== '';
        const fresh = facts.confirmedVersion !== episode.failureVersion;
        const recovered = episode.failed && !facts.reading && !facts.error && confirmed && fresh;
        if (recovered) {
            episode.failed = false;
            episode.error = undefined;
        }
        const error = episode.error, proofToken = episode.proofToken;
        const currentConfirmation = recovered ? () => this.identity === facts.owner.identity && this.episodes.get(key) === episode && !episode.failed && !episode.reading && episode.proofToken === proofToken : undefined;
        return { owner: facts.owner, recovered, currentConfirmation, event: episode.failed ? {
                ...facts.owner, key: `read-${episode.tone || 'error'}`, tone: episode.tone || 'error', message: () => String(error || ''), recovery,
            } : undefined };
    }
}
/** Exact attribution lets a fresh resource read retire only its earlier read record. */
export class ReadFeedbackBindings {
    owners = new WeakMap();
    bind(record, owner) {
        if (record.kind === 'read')
            this.owners.set(record, owner);
    }
    has(record) { return this.owners.has(record); }
    matches(record, owner) {
        const original = this.owners.get(record);
        return !!original && original.identity === owner.identity && original.object === owner.object && original.task === owner.task && original.generation === owner.generation;
    }
}
//# sourceMappingURL=read-feedback.js.map