// Globals for functions extracted from the compiled app module and evaluated in
// a vm sandbox. The real translator keeps English assertions byte-identical;
// menu builders are presentation-only and covered by browser tests.
const { t, stateText, i18n, LocalizedMessage, messageText, formatDateTime, formatTime, formatNumber } = await import(
  new URL('../browser/locale.js', import.meta.url).href
);

export const localeSandbox = {
  t,
  stateText,
  currentLocale: () => i18n.locale,
  languageChoices: () => i18n.choices(),
  languageTrigger: () => '',
  languageMenuItems: () => '',
  languageOptions: () => '',
  applyDocumentTitle: () => undefined,
  LocalizedMessage,
  messageText,
  formatDateTime,
  formatTime,
  formatNumber,
};
