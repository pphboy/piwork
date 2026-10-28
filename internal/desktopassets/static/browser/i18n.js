// Shared browser language rules for the Desktop and Console/Serve UIs.
// No external dependencies: both WebUI builds copy this module next to their
// compiled browser entry points (see apps/*/scripts/copy-static.mjs).

export const LOCALES = ['zh-CN', 'en'];
export const DEFAULT_LOCALE = 'en';
export const LOCALE_STORAGE_KEY = 'piwork.ui-locale';
export const LOCALE_NAMES = { 'zh-CN': '简体中文', en: 'English' };

/**
 * Map a BCP 47 language tag onto the two supported locales.
 * Chinese variants all resolve to Simplified Chinese; English variants to `en`.
 */
export function normalizeLocale(value) {
  if (typeof value !== 'string') return null;
  const tag = value.trim().toLowerCase();
  if (!tag) return null;
  if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-CN';
  if (tag === 'en' || tag.startsWith('en-')) return 'en';
  return null;
}

/** First entry of the browser preference list that maps to a supported locale. */
export function matchLocale(languages) {
  if (Array.isArray(languages)) {
    for (const language of languages) {
      const locale = normalizeLocale(language);
      if (locale) return locale;
    }
  }
  return DEFAULT_LOCALE;
}

/** localStorage access that never throws when storage is denied or absent. */
export function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readStoredLocale(storage) {
  try {
    const value = storage?.getItem(LOCALE_STORAGE_KEY);
    return LOCALES.includes(value) ? value : null;
  } catch {
    return null;
  }
}

/** Persist an explicit choice. Returns whether the value is really stored. */
export function writeStoredLocale(locale, storage) {
  const normalized = normalizeLocale(locale);
  if (!normalized) return false;
  try {
    if (!storage) return false;
    storage.setItem(LOCALE_STORAGE_KEY, normalized);
    return storage.getItem(LOCALE_STORAGE_KEY) === normalized;
  } catch {
    return false;
  }
}

export function browserLanguages() {
  try {
    if (Array.isArray(globalThis.navigator?.languages) && globalThis.navigator.languages.length) {
      return globalThis.navigator.languages;
    }
    const language = globalThis.navigator?.language;
    return typeof language === 'string' && language ? [language] : [];
  } catch {
    return [];
  }
}

/**
 * Explicit saved choice wins; otherwise browser preferences in order; otherwise `en`.
 */
export function resolveLocale(options = {}) {
  // An explicitly undefined value means "not supplied"; only a real value
  // (including null for storage) overrides the browser defaults.
  const storage = options.storage === undefined ? safeStorage() : options.storage;
  const languages = options.languages === undefined ? browserLanguages() : options.languages;
  const saved = readStoredLocale(storage);
  return { locale: saved ?? matchLocale(languages), saved: saved !== null };
}

/** Replace `{name}` placeholders. Missing parameters keep their placeholder. */
export function interpolate(template, params) {
  if (typeof template !== 'string' || !params) return template;
  return template.replace(/\{([A-Za-z0-9_.-]+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

export function applyDocumentLanguage(locale) {
  try {
    if (globalThis.document?.documentElement) globalThis.document.documentElement.lang = locale;
  } catch {
    /* presentation only */
  }
}

/** Choose a catalog value: current locale, then English, then the key itself. */
export function lookup(catalog, locale, key) {
  const table = catalog?.[locale];
  if (table && typeof table[key] === 'string') return table[key];
  const fallback = catalog?.[DEFAULT_LOCALE];
  if (fallback && typeof fallback[key] === 'string') return fallback[key];
  return key;
}

export function createI18n(options = {}) {
  const catalog = options.catalog || {};
  const storage = options.storage === undefined ? safeStorage() : options.storage;
  const initial = resolveLocale(
    options.languages === undefined ? { storage } : { storage, languages: options.languages },
  );
  let locale = normalizeLocale(options.locale) || initial.locale;
  let saved = initial.saved && locale === initial.locale;
  let preference = initial.saved ? locale : 'auto';
  const t = (key, params) => interpolate(lookup(catalog, locale, key), params);
  const api = {
    get locale() { return locale; },
    get saved() { return saved; },
    get preference() { return preference; },
    t,
    setLocale(next) {
      if (next === 'auto') {
        preference = 'auto';
        locale = matchLocale(options.languages === undefined ? browserLanguages() : options.languages);
        saved = false;
        try { storage?.removeItem(LOCALE_STORAGE_KEY); } catch { /* this page still follows the browser */ }
        applyDocumentLanguage(locale);
        return locale;
      }
      const normalized = normalizeLocale(next);
      if (!normalized) return locale;
      locale = normalized;
      preference = normalized;
      saved = typeof options.onPersist === 'function'
        ? Boolean(options.onPersist(normalized))
        : writeStoredLocale(normalized, storage);
      applyDocumentLanguage(locale);
      return locale;
    },
    choices() {
      const automatic = lookup(catalog, locale, 'lang.auto');
      return [{ id: 'auto', label: automatic === 'lang.auto' ? (locale === 'zh-CN' ? '跟随浏览器' : 'Follow browser') : automatic, selected: preference === 'auto' },
        ...LOCALES.map((id) => ({ id, label: LOCALE_NAMES[id], selected: id === preference }))];
    },
    setDocumentLanguage() { applyDocumentLanguage(locale); },
  };
  applyDocumentLanguage(locale);
  return api;
}

/**
 * Stable object terminology shared by both WebUIs. Each app catalog must carry
 * these keys with exactly these values so the same object never gets two names.
 */
export const SHARED_TERMS = {
  'term.core': { en: 'Core', 'zh-CN': 'Core' },
  'term.work': { en: 'Work', 'zh-CN': 'Work' },
  'term.works': { en: 'Works', 'zh-CN': 'Works' },
  'term.service': { en: 'Service', 'zh-CN': 'Service' },
  'term.session': { en: 'Session', 'zh-CN': 'Session' },
  'term.run': { en: 'Run', 'zh-CN': 'Run' },
  'term.operation': { en: 'Operation', 'zh-CN': 'Operation' },
  'term.skill': { en: 'Skill', 'zh-CN': 'Skill' },
  'term.package': { en: 'Pi Package', 'zh-CN': 'Pi Package' },
  'term.runtime': { en: 'Runtime', 'zh-CN': 'Runtime' },
  'term.defaultWork': { en: 'Default Work', 'zh-CN': 'Default Work' },
  'term.workspaceFiles': { en: 'Workspace files', 'zh-CN': 'Workspace files' },
  'term.language': { en: 'Language', 'zh-CN': '语言' },
};

/** Terms that each app catalog must include verbatim. */
export function sharedTermCatalog() {
  const en = {}, zh = {};
  for (const [key, value] of Object.entries(SHARED_TERMS)) {
    en[key] = value.en;
    zh[key] = value['zh-CN'];
  }
  return { en, 'zh-CN': zh };
}

/** Pre-application loading labels for the three HTML entry points. */
export const BOOT_TEXT = {
  desktop: {
    en: { title: 'PiWork Desktop', loading: 'Opening Piwork…' },
    'zh-CN': { title: 'PiWork Desktop', loading: '正在打开 Piwork…' },
  },
  console: {
    en: { title: 'Piwork Core', loading: 'Opening Piwork…' },
    'zh-CN': { title: 'Piwork Core', loading: '正在打开 Piwork…' },
  },
  setup: {
    en: { title: 'Piwork setup', loading: 'Opening Piwork…' },
    'zh-CN': { title: 'Piwork setup', loading: '正在打开 Piwork…' },
  },
};

/**
 * Localize an HTML entry before the application module has loaded. The module
 * only updates presentation: a failure here leaves the static English text.
 */
export function applyBootLocale(page, options = {}) {
  const locale = resolveLocale(options).locale;
  try {
    const doc = globalThis.document;
    if (!doc) return locale;
    doc.documentElement.lang = locale;
    const text = BOOT_TEXT[page]?.[locale] || BOOT_TEXT[page]?.en;
    if (text) {
      doc.title = text.title;
      const slot = doc.querySelector('[data-boot-loading]');
      if (slot && doc.documentElement.dataset.bootState !== 'failed') slot.textContent = text.loading;
      const recovery = doc.querySelector('[data-boot-recovery]');
      if (recovery) recovery.textContent = locale === 'zh-CN' ? '重新加载' : 'Reload';
      const home = doc.querySelector('[data-boot-home]');
      if (home) home.textContent = locale === 'zh-CN' ? '返回首页' : 'Home';
    }
  } catch {
    /* static fallback remains readable */
  }
  return locale;
}

/** Anchored, nonmodal single-value picker shared by both WebUIs. */
export function createLanguagePicker(options) {
  let panel = null, anchor = null, restore = null, events = null;
  const visible = node => node?.isConnected && node.getClientRects().length && !node.closest('[hidden],[inert]');
  function close(returnFocus = false) {
    if (!panel) return;
    events?.abort();
    panel.remove(); panel = null;
    anchor?.setAttribute('aria-expanded', 'false');
    if (returnFocus) {
      const destination = restore?.();
      if (visible(destination)) destination.focus({ preventScroll: true });
      else if (visible(anchor)) anchor.focus({ preventScroll: true });
    }
    anchor = null; restore = null;
  }
  function open(trigger, settings = {}) {
    if (panel && anchor === trigger) { close(true); return; }
    close();
    const box = settings.anchorRect || trigger.getBoundingClientRect();
    settings.beforeOpen?.();
    anchor = trigger;
    restore = settings.restoreFocus || (() => {
      const key = trigger.dataset.languageTrigger;
      return key ? document.querySelector(`[data-language-trigger="${CSS.escape(key)}"]`) : trigger;
    });
    panel = document.createElement('div');
    panel.className = 'language-picker';
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-label', options.label());
    panel.setAttribute('popover', 'manual');
    for (const choice of options.choices()) {
      const row = document.createElement('button');
      row.type = 'button'; row.className = 'language-picker-option'; row.tabIndex = -1;
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(choice.selected));
      row.dataset.locale = choice.id;
      const label = document.createElement('span'); label.textContent = choice.label; row.append(label);
      if (choice.selected) row.insertAdjacentHTML('beforeend', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>');
      row.addEventListener('click', event => {
        event.stopPropagation();
        const focus = restore;
        close();
        options.onChoose(choice.id);
        const destination = focus?.();
        if (visible(destination)) destination.focus({ preventScroll: true });
      });
      panel.append(row);
    }
    document.body.append(panel);
    panel.showPopover?.();
    const width = panel.offsetWidth, height = panel.offsetHeight;
    panel.style.left = `${Math.max(8, Math.min(box.right - width, innerWidth - width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(box.bottom + 6, innerHeight - height - 8))}px`;
    anchor.setAttribute('aria-expanded', 'true');
    events = new AbortController();
    const listen = { signal: events.signal, capture: true };
    document.addEventListener('pointerdown', event => {
      if (!panel?.contains(event.target) && !anchor?.contains(event.target)) close();
    }, listen);
    document.addEventListener('keydown', event => {
      if (!panel || event.isComposing) return;
      const rows = [...panel.querySelectorAll('[role=option]')];
      const index = rows.indexOf(document.activeElement);
      let next = -1;
      if (event.key === 'ArrowDown') next = (index + 1) % rows.length;
      if (event.key === 'ArrowUp') next = (index - 1 + rows.length) % rows.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = rows.length - 1;
      if (next >= 0) { event.preventDefault(); event.stopImmediatePropagation(); rows[next].focus({ preventScroll: true }); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true); }
      else if (event.key === 'Tab') close(true);
      else if (index >= 0 && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); rows[index].click(); }
    }, listen);
    document.addEventListener('focusin', event => {
      if (panel && !panel.contains(event.target) && !anchor?.contains(event.target)) close();
    }, listen);
    window.addEventListener('resize', () => close(), listen);
    window.addEventListener('pagehide', () => close(), listen);
    (panel.querySelector('[aria-selected=true]') || panel.firstElementChild)?.focus({ preventScroll: true });
  }
  if (typeof document !== 'undefined') document.addEventListener('keydown', event => {
    const trigger = event.target.closest?.('[data-language-trigger]');
    if (!panel && trigger && trigger.getAttribute('role') !== 'menuitem' && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); trigger.click();
    }
  });
  return { open, close, get isOpen() { return !!panel; } };
}
