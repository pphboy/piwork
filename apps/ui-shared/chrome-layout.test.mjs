import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tokens = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const desktop = readFileSync(new URL('../desktop-webui/public/style.css', import.meta.url), 'utf8');

test('V14 chrome tokens share 52/88px identity headers and 39px secondary rows', () => {
  assert.match(tokens, /--chrome-height:\s*52px;/);
  assert.match(tokens, /--chrome-narrow-height:\s*88px;/);
  assert.match(tokens, /--service-toolbar-height:\s*39px;/);
});

test('V14 narrow Work and Works grids allocate 48 plus 39 pixels inside their one-pixel border', () => {
  const compact = desktop.slice(desktop.indexOf('/* V14 compact chrome:'));
  assert.equal((compact.match(/grid-template-rows: 48px 39px;/g) || []).length, 2);
  assert.match(compact, /row-gap: 0;\s*padding: 0 12px;/);
  assert.match(desktop, /\.work-header\s*\{[^}]*border-bottom: 1px solid var\(--border\);/);
});

test('V14 Work navigation retains dedicated 18px icons and six-pixel label spacing', () => {
  assert.match(desktop, /\.work-header > \.work-tabs \.tab\s*\{[^}]*padding: 0 13px;[^}]*gap: 6px;/);
  assert.match(desktop, /\.work-header > \.work-tabs \.tab > svg\s*\{[^}]*width: 18px;[^}]*height: 18px;/);
  assert.match(desktop, /\.work-header > \.work-tabs \.tab \{ padding-inline: 10px; \}/);
});
