// Single locale state shared by the Console app, onboarding and quick setup. Rendering
// re-reads the current locale on every pass; switching only notifies listeners.
import { createI18n } from './i18n.js';
import { catalog } from './i18n/catalog.js';
export const i18n = createI18n({ catalog });
export const t = (key, params) => i18n.t(key, params);
export const currentLocale = () => i18n.locale;
const listeners = new Set();
let initialized = false;
/** Register the app's re-render callback. Listeners run in insertion order. */
export function onLocaleChange(listener) {
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
export function chooseLocale(locale) {
    const applied = i18n.setLocale(locale);
    for (const listener of [...listeners])
        listener();
    return applied;
}
/** `{ id, label, selected }` for the language menu, in stable display order. */
export function languageChoices() {
    return i18n.choices();
}
/** BCP 47 tag used for locale-aware dates and numbers. */
export function localeTag() {
    return i18n.locale === 'zh-CN' ? 'zh-CN' : 'en-US';
}
export function formatDateTime(value, options) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(localeTag(), options);
}
export function formatTime(value, options) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(localeTag(), options);
}
export function formatNumber(value, options) {
    return Number.isFinite(value) ? value.toLocaleString(localeTag(), options) : String(value);
}
/** Localized text for the current page title (also updates <html lang>). */
export function applyDocumentTitle(title) {
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
    key;
    params;
    raw;
    constructor(key, params, raw) {
        this.key = key;
        this.params = params;
        this.raw = raw;
    }
    toString() {
        const text = t(this.key, this.params);
        return this.raw ? `${text} ${this.raw}` : text;
    }
    /** Serialize as readable text when a message crosses a structured boundary. */
    toJSON() {
        return this.toString();
    }
}
/** Render a cached feedback value in the current locale. */
export function messageText(value) {
    return value == null ? '' : String(value);
}
//# sourceMappingURL=locale.js.map