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

/** Only a confirmed Save's associated configuration GET may own its readback error. */
export class SettingsSaveReadback {
  private bindings = new WeakMap<Readonly<ActionRecord>, { identity: string; workId: string; receipt?: string; failed?: boolean }>();
  bind(record: Readonly<ActionRecord>, facts: SettingsReadFacts): void {
    if (record.kind !== 'configuration' || !['save-config', 'dirty-config-save'].includes(record.action || '') || !record.result || record.pending || record.blocked || record.resultTone === 'unknown' || record.error || facts.source !== 'configuration' || record.work !== facts.workId) return;
    this.bindings.set(record, { identity: facts.identity, workId: facts.workId!, receipt: facts.checkedAt });
  }
  observe(record: Readonly<ActionRecord>, facts: SettingsReadFacts, current: boolean): { owned: boolean; recovered: boolean } {
    const binding = this.bindings.get(record);
    const eligible = current && binding && binding.identity === facts.identity && binding.workId === facts.workId && facts.source === 'configuration'
      && !record.pending && !record.blocked && record.resultTone !== 'unknown' && !record.error && record.refresh === 'failed';
    if (!eligible) return { owned: false, recovered: false };
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
export function configurationReadAllowsApply(error: SettingsReadFacts['error']): boolean {
  return !error;
}

export interface SettingsStatusFacts {
  readonly dirty: boolean;
  readonly confirmed: boolean;
  readonly configurationError: boolean;
  readonly pendingApply?: boolean;
  readonly activeNull: boolean;
  readonly saving: boolean;
  readonly saveUnknown: boolean;
  readonly applying: boolean;
  readonly applyWaiting: boolean;
  readonly applyUnknown: boolean;
  readonly applyFailed: boolean;
  readonly runtimeFailed: boolean;
}

/** Independent presentation facts. This never updates requests, locks or the
 * Core's pendingApply; equal JSON is deliberately not an input. */
export function settingsStatus(facts: SettingsStatusFacts) {
  const confirmed = facts.confirmed && !facts.configurationError;
  const save = facts.saveUnknown ? 'unknown' : facts.saving ? 'saving' : facts.dirty ? 'unsaved' : 'saved';
  const application = facts.applyUnknown ? 'unknown' : facts.applying ? (facts.applyWaiting ? 'waiting' : 'applying')
    : !confirmed ? 'unconfirmed' : facts.activeNull ? 'never-applied'
      : facts.pendingApply === true ? 'pending' : facts.pendingApply === false ? 'applied' : 'unconfirmed';
  return {
    save, application,
    steady: confirmed && save === 'saved' && application === 'applied' && !facts.applyFailed && !facts.runtimeFailed,
    canApply: confirmed && facts.pendingApply === true && !facts.dirty && !facts.saving && !facts.saveUnknown && !facts.applying && !facts.applyUnknown,
  } as const;
}

/** A known historical Apply failure may retire only after fresh configured
 * and verified running facts. Unknown writes and failed recovery remain. */
export function settingsApplyFailureResolved(facts: {
  originalFailed: boolean; unknown: boolean; pendingApply?: boolean; configurationError: boolean;
  workFailed: boolean; runtimeReady: boolean; checkedAt?: string; originalStarted: number;
}): boolean {
  return facts.originalFailed && !facts.unknown && facts.pendingApply === false && !facts.configurationError &&
    !facts.workFailed && facts.runtimeReady && !!facts.checkedAt && Date.parse(facts.checkedAt) > facts.originalStarted;
}
