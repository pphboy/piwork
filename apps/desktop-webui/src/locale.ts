// Single locale state shared by the Desktop app and its adapter. Rendering
// re-reads the current locale on every pass; switching only notifies listeners.
import { createI18n, type Locale } from './i18n.js';
import { catalog } from './i18n/catalog.js';

export const i18n = createI18n({ catalog });
export const t = (key: string, params?: Record<string, string | number>): string => i18n.t(key, params);
export const currentLocale = (): Locale => i18n.locale;

/** Render protocol states without changing their identity or CSS class. */
export function stateText(state: string): string {
  if (currentLocale() === 'en') return state;
  const keys: Record<string, string> = {
    preparing: 'stateLabel.preparing', starting: 'stateLabel.starting', recovering: 'stateLabel.recovering', ready: 'stateLabel.ready',
    running: 'stateLabel.running', degraded: 'stateLabel.degraded', stopping: 'stateLabel.stopping',
    stopped: 'stateLabel.stopped', failed: 'stateLabel.failed', deleted: 'stateLabel.deleted',
    unknown: 'stateLabel.unknown', disabled: 'stateLabel.disabled', enabled: 'stateLabel.enabled', pending: 'stateLabel.pending',
    accepted: 'stateLabel.accepted', succeeded: 'stateLabel.succeeded', superseded: 'stateLabel.superseded',
    interrupted: 'stateLabel.interrupted', cancelling: 'stateLabel.cancelling', cancelled: 'stateLabel.cancelled',
    queued: 'stateLabel.queued', removed: 'stateLabel.removed', completed: 'stateLabel.completed',
  };
  const key = keys[state.toLowerCase()];
  return key ? t(key) : state;
}

const listeners = new Set<() => void>();
let initialized = false;

/** Register the app's re-render callback. Listeners run in insertion order. */
export function onLocaleChange(listener: () => void): void {
  listeners.add(listener);
  if (!initialized) {
    initialized = true;
    i18n.setDocumentLanguage();
  }
}

/**
 * Apply an explicit language choice. Presentation updates synchronously; the
 * preference is best-effort persisted for this origin only.
 */
export function chooseLocale(locale: unknown): Locale {
  const applied = i18n.setLocale(locale);
  for (const listener of [...listeners]) listener();
  return applied;
}

/** `{ id, label, selected }` for the language menu, in stable display order. */
export function languageChoices(): ReturnType<typeof i18n.choices> {
  return i18n.choices();
}

/** BCP 47 tag used for locale-aware dates and numbers. */
export function localeTag(): string {
  return i18n.locale === 'zh-CN' ? 'zh-CN' : 'en-US';
}

export function formatDateTime(value: string | number | Date, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(localeTag(), options);
}

export function formatTime(value: string | number | Date, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(localeTag(), options);
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return Number.isFinite(value) ? value.toLocaleString(localeTag(), options) : String(value);
}

/** Localized text for the current page title (also updates <html lang>). */
export function applyDocumentTitle(title: string): void {
  document.title = title;
  i18n.setDocumentLanguage();
}

/**
 * A message identity that renders in the locale active at display time, so a
 * cached error or notice is not frozen in the language it was created in.
 * `toString()` keeps existing `esc(value)` call sites working; `raw` carries an
 * untrusted server diagnostic as secondary data.
 */
export class LocalizedMessage {
  constructor(
    readonly key: string,
    readonly params?: Record<string, string | number>,
    readonly raw?: string,
  ) {}
  toString(): string {
    const text = t(this.key, this.params);
    return this.raw ? `${text} ${this.raw}` : text;
  }
  /** Serialize as readable text when a message crosses a structured boundary. */
  toJSON(): string {
    return this.toString();
  }
}

export type Feedback = string | LocalizedMessage | null | undefined;

/** Render a cached feedback value in the current locale. */
export function messageText(value: Feedback): string {
  return value == null ? '' : String(value);
}
