// Localize the static HTML entry before the application module loads.
// The page id comes from <body data-boot-page="desktop|console|setup">.
import { applyBootLocale } from './i18n.js';

const page = globalThis.document?.body?.dataset.bootPage || 'desktop';
applyBootLocale(page);
