import {t} from './locale.js';

const phaseKeys = ['package.phase.accepted', 'package.phase.resolving', 'package.phase.preparing', 'package.phase.validating', 'package.phase.publishing', 'package.phase.published'];
const fallbackSteps = ['Accepted', 'Resolving', 'Preparing', 'Validating', 'Publishing', 'Published'];
const phases = ['queued', 'source', 'prepare', 'validate', 'publish', 'succeeded'];

/**
 * Localized display labels for the six known phases. Indexing reads the
 * current locale, so callers can keep using this as a plain array.
 */
export const packageSteps: string[] = new Proxy(fallbackSteps, {
  get(target, property, receiver) {
    if (typeof property === 'string' && /^\d+$/.test(property)) {
      const key = phaseKeys[Number(property)];
      if (key) return t(key);
    }
    return Reflect.get(target, property, receiver);
  },
});

/** Raw Core phases are never replaced by these presentation labels. */
export function packagePhaseView(raw: string, state: string) {
  const index = phases.indexOf(raw);
  const terminalError = state === 'failed' || state === 'superseded' || raw === 'failed' || raw === 'superseded';
  return {
    index: terminalError ? -1 : index,
    label: raw === '' ? t('package.phase.submissionAccepted') : raw === 'cleanup-pending' ? t('package.phase.cleanupPending') : raw === 'failed' ? t('package.phase.failed') : raw === 'superseded' ? t('package.phase.superseded') : index >= 0 ? t(phaseKeys[index]!) : t('package.phase.unrecognized', {phase: raw}),
    cleanupPending: raw === 'cleanup-pending',
  };
}
