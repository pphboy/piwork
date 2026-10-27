// Browser-facing declaration for the shared apps/ui-shared/i18n.js module that
// each WebUI copies next to its compiled browser output.
export type Locale = 'zh-CN' | 'en';
export type LanguagePreference = Locale | 'auto';
export type Catalog = Record<Locale, Record<string, string>>;
export interface LocaleChoice { id: LanguagePreference; label: string; selected: boolean; }
export interface I18n {
  readonly locale: Locale;
  readonly saved: boolean;
  readonly preference: LanguagePreference;
  t(key: string, params?: Record<string, string | number>): string;
  setLocale(next: unknown): Locale;
  choices(): LocaleChoice[];
  setDocumentLanguage(): void;
}
export declare const LOCALES: readonly Locale[];
export declare const DEFAULT_LOCALE: Locale;
export declare const LOCALE_STORAGE_KEY: string;
export declare const LOCALE_NAMES: Record<Locale, string>;
export declare function normalizeLocale(value: unknown): Locale | null;
export declare function matchLocale(languages: readonly string[] | undefined): Locale;
export declare function safeStorage(): Storage | null;
export declare function readStoredLocale(storage?: Storage | null): Locale | null;
export declare function writeStoredLocale(locale: Locale, storage?: Storage | null): boolean;
export declare function browserLanguages(): readonly string[];
export declare function resolveLocale(options?: { storage?: Storage | null; languages?: readonly string[] }): { locale: Locale; saved: boolean };
export declare function interpolate(template: string, params?: Record<string, string | number>): string;
export declare function applyDocumentLanguage(locale: Locale): void;
export declare function lookup(catalog: Partial<Catalog> | undefined, locale: Locale, key: string): string;
export declare function createI18n(options?: {
  catalog?: Partial<Catalog>;
  storage?: Storage | null;
  languages?: readonly string[];
  locale?: Locale;
  onPersist?: (locale: Locale) => boolean;
}): I18n;
export declare const SHARED_TERMS: Record<string, Record<Locale, string>>;
export declare function sharedTermCatalog(): Catalog;
export declare const BOOT_TEXT: Record<string, Record<Locale, { title: string; loading: string }>>;
export declare function applyBootLocale(page: string, options?: { storage?: Storage | null; languages?: readonly string[] }): Locale;

export declare function createLanguagePicker(options: {
  choices: () => LocaleChoice[];
  label: () => string;
  onChoose: (choice: string) => void;
}): {
  open(trigger: HTMLElement, options?: { anchorRect?: DOMRect; beforeOpen?: () => void; restoreFocus?: () => HTMLElement | null }): void;
  close(restoreFocus?: boolean): void;
  readonly isOpen: boolean;
};
