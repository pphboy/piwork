import { ReadFeedbackEpisodes } from './read-feedback.js';
export class SettingsReadFeedback {
    episodes = new ReadFeedbackEpisodes();
    observe(facts, recovery) {
        return this.episodes.observe({ owner: {
                identity: facts.identity, object: facts.source.startsWith('catalog-') ? 'core-catalog' : facts.workId || '',
                task: `settings-read:${facts.source}`, generation: 0,
            }, reading: facts.reading, error: facts.error, confirmedVersion: facts.checkedAt }, recovery);
    }
}
export function settingsReadMatches(record, facts) {
    if (record.kind !== 'read' || !record.error || !facts.error || String(record.errorMessage?.() || record.error) !== String(facts.error))
        return false;
    if (facts.source.startsWith('catalog-'))
        return record.action === 'check-catalog';
    if (record.work !== facts.workId)
        return false;
    return facts.source === 'configuration' ? ['settings', 'refresh-config'].includes(record.action || '') : record.action === 'refresh-packages';
}
//# sourceMappingURL=settings-read-feedback.js.map