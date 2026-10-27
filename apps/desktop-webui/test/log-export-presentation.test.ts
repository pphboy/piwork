import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../browser/app.js', import.meta.url), 'utf8');
const { catalog } = await import(new URL('../browser/i18n/catalog.js', import.meta.url).href);

test('admin account menu owns the single global Export logs entry', () => {
  const account = source.slice(source.indexOf('case "account":'), source.indexOf('case "connection":'));
  assert.match(account, /adapter\.state\.core\.role === "admin" \? btn\(`\$\{icon\("download"\)\} \$\{t\('account\.exportLogs'\)\}`, "export-logs"\)/);
  assert.equal(catalog.en['account.exportLogs'], 'Export logs');
  assert.equal((account.match(/"export-logs"/g) ?? []).length, 1);
});

test('log export panel reports real stages, gaps and original delivery controls', () => {
  const panel = source.slice(source.indexOf('case "log-export":'), source.indexOf('case "export":'));
  const keys = ['logs.collecting', 'logs.packing', 'logs.delivered', 'logs.ready', 'logs.unknown', 'logs.downloadAgain', 'logs.retrySame', 'logs.exportAgain', 'logs.gaps', 'logs.footnote'];
  for (const key of keys) assert.ok(panel.includes(`t('${key}')`) || panel.includes(`t('${key}',`), key);
  assert.equal(catalog.en['logs.collecting'], 'Collecting logs');
  assert.equal(catalog.en['logs.packing'], 'Creating archive');
  assert.equal(catalog.en['logs.unknown'], 'Export creation not confirmed');
  assert.match(catalog.en['logs.gaps'], /\{count\} gap\(s\) recorded/);
  assert.match(catalog.en['logs.footnote'], /does not cancel the Core task/);
});

test('log export actions never stop, apply or cancel another Work', () => {
  const start = source.indexOf('case "export-logs":');
  const end = source.indexOf('case \'export\':', start);
  const actions = source.slice(start, end);
  assert.match(actions, /adapter\.startLogExport\(\)/);
  assert.match(actions, /adapter\.deliverLogExport\(\)/);
  assert.match(actions, /adapter\.retryLogExportSameKey\(\)/);
  assert.doesNotMatch(actions, /lifecycle|stop-work|apply|cancelRun|ensureService/);
});
