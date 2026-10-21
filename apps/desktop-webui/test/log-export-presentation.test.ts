import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../browser/app.js', import.meta.url), 'utf8');

test('admin account menu owns the single global Export logs entry', () => {
  const account = source.slice(source.indexOf('case "account":'), source.indexOf('case "connection":'));
  assert.match(account, /adapter\.state\.core\.role === "admin" \? btn\(`\$\{icon\("download"\)\} Export logs`, "export-logs"\)/);
  assert.equal((account.match(/"export-logs"/g) ?? []).length, 1);
});

test('log export panel reports real stages, gaps and original delivery controls', () => {
  const panel = source.slice(source.indexOf('case "log-export":'), source.indexOf('case "export":'));
  for (const text of ['Collecting logs', 'Creating archive', 'Download started', 'Ready to download', 'Export creation not confirmed', 'Download again', 'Retry same key', 'Export again', 'gap(s) recorded', 'does not stop, start or apply any Work']) {
    assert.ok(panel.includes(text), text);
  }
  assert.match(panel, /documents the Core task|does not cancel the Core task/);
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
