// Combined Desktop catalog: shared terms, app strings and adapter feedback.
import { sharedStrings } from './shared.js';
import { appStrings } from './app.js';
import { adapterStrings } from './adapter.js';

function merge(...parts) {
  const out = { en: {}, 'zh-CN': {} };
  for (const part of parts) {
    for (const locale of ['en', 'zh-CN']) Object.assign(out[locale], part[locale] || {});
  }
  return out;
}

export const catalog = merge(sharedStrings, appStrings, adapterStrings);
