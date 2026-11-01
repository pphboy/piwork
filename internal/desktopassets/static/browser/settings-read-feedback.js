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
/** Only a confirmed Save's associated configuration GET may own its readback error. */
export class SettingsSaveReadback {
    bindings = new WeakMap();
    bind(record, facts) {
        if (record.kind !== 'configuration' || !['save-config', 'dirty-config-save'].includes(record.action || '') || !record.result || record.pending || record.blocked || record.resultTone === 'unknown' || record.error || facts.source !== 'configuration' || record.work !== facts.workId)
            return;
        this.bindings.set(record, { identity: facts.identity, workId: facts.workId, receipt: facts.checkedAt });
    }
    observe(record, facts, current) {
        const binding = this.bindings.get(record);
        const eligible = current && binding && binding.identity === facts.identity && binding.workId === facts.workId && facts.source === 'configuration'
            && !record.pending && !record.blocked && record.resultTone !== 'unknown' && !record.error && record.refresh === 'failed';
        if (!eligible)
            return { owned: false, recovered: false };
        if (!binding.failed) {
            binding.receipt = facts.checkedAt;
            binding.failed = true;
        }
        const owned = !!facts.error && String(facts.error) === String(record.refreshErrorMessage?.() || record.refreshError);
        const recovered = !facts.reading && !facts.error && !!facts.checkedAt && facts.checkedAt !== binding.receipt;
        return { owned, recovered };
    }
}
/** A retained pendingApply value is not current admission after its GET failed. */
export function configurationReadAllowsApply(error) {
    return !error;
}
//# sourceMappingURL=settings-read-feedback.js.map