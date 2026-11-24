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
/** Independent presentation facts. This never updates requests, locks or the
 * Core's pendingApply; equal JSON is deliberately not an input. */
export function settingsStatus(facts) {
    const confirmed = facts.confirmed && !facts.configurationError;
    const save = facts.saveUnknown ? 'unknown' : facts.saving ? 'saving' : facts.dirty ? 'unsaved' : 'saved';
    const application = facts.applyUnknown ? 'unknown' : facts.applying ? (facts.applyWaiting ? 'waiting' : 'applying')
        : !confirmed ? 'unconfirmed' : facts.activeNull ? 'never-applied'
            : facts.pendingApply === true ? 'pending' : facts.pendingApply === false ? 'applied' : 'unconfirmed';
    return {
        save, application,
        steady: confirmed && save === 'saved' && application === 'applied' && !facts.applyFailed && !facts.runtimeFailed,
        canApply: confirmed && facts.pendingApply === true && !facts.dirty && !facts.saving && !facts.saveUnknown && !facts.applying && !facts.applyUnknown,
    };
}
/** A known historical Apply failure may retire only after fresh configured
 * and verified running facts. Unknown writes and failed recovery remain. */
export function settingsApplyFailureResolved(facts) {
    return facts.originalFailed && !facts.unknown && facts.pendingApply === false && !facts.configurationError &&
        !facts.workFailed && facts.runtimeReady && !!facts.checkedAt && Date.parse(facts.checkedAt) > facts.originalStarted;
}
//# sourceMappingURL=settings-read-feedback.js.map