// Combined Console catalog: shared terms, admin app strings and setup strings.
import { sharedStrings } from './shared.js';
import { appStrings } from './app.js';
import { setupStrings } from './setup.js';

function merge(...parts) {
  const out = { en: {}, 'zh-CN': {} };
  for (const part of parts) {
    for (const locale of ['en', 'zh-CN']) Object.assign(out[locale], part[locale] || {});
  }
  return out;
}

export const catalog = merge(sharedStrings, appStrings, setupStrings);
