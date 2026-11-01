import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const { exportPanelModel, renderExportPanel, renderExportRecoveryPanel } = await import(new URL('../browser/export-panel.js', import.meta.url).href);
const { chooseLocale } = await import(new URL('../browser/locale.js', import.meta.url).href);

function fixture(longName = false) {
  const work = { id: 'work-original', name: longName ? 'Very long original Work 名称 '.repeat(12) : 'Original Work' };
  const snapshot = { id: 'snapshot-original', workId: work.id, operationId: 'operation-original', status: 'verified', size: '42 bytes', filename: 'original.work', expiresAt: '2100-01-01T00:00:00Z' };
  const flow = { id: 'flow-original', workId: work.id, workName: work.name, identityEpoch: 1, mode: 'new', stopConfirmed: true, stopOperationId: 'stop-original', exportOperationId: snapshot.operationId, snapshotId: snapshot.id, transferId: 'transfer-original', phase: 'preparing', paused: false, terminal: false, error: '', autoDeliveryConsumed: false };
  const transfer = { transferId: flow.transferId, snapshotId: snapshot.id, workId: work.id, phase: 'receiving', transferred: 21, total: 42, pending: true, ready: false };
  return { work, flow, snapshot, transfer, activeFlow: flow, snapshots: [snapshot, { ...snapshot, id: 'snapshot-older' }, { ...snapshot, id: 'foreign-snapshot', workId: 'foreign-work' }], snapshotQuery: '' };
}

test('direct production renderer: progress Details has only same-task progress and controls', () => {
  chooseLocale('en');
  const input = fixture();
  const before = structuredClone(input);
  const panel = renderExportPanel(exportPanelModel(input));
  for (const id of [input.flow.stopOperationId, input.flow.exportOperationId, input.snapshot.id, input.transfer.transferId, 'snapshot-older']) {
    assert.ok(!panel.body.replace(/<[^>]*>/g, '').includes(id), `progress body excludes visible technical identity ${id}`);
  }
  assert.doesNotMatch(panel.body, /snapshot-query|export-snapshot|view-snapshot|lookup-snapshot|feedback/);
  assert.match(panel.body, /value="21" max="42"/);
  assert.match(panel.body, /data-action="check-export-flow"/);
  assert.match(panel.body, /data-action="pause-export-flow"/);
  assert.match(panel.body, /aria-busy="true"/);
  assert.match(panel.body, /private|credential/i);
  assert.match(panel.footer, />Hide<\/button>/);
  assert.deepEqual(input, before, 'rendering cannot mutate the flow or input');
  assert.deepEqual(renderExportPanel(exportPanelModel(input)), panel, 'hide/reopen reads the same task without effects');
});

test('unknown/paused/failed stop motion but retain original controls and locks', () => {
  const input = fixture();
  for (const phase of ['unknown', 'failed', 'revoked']) {
    input.flow.phase = phase;
    const panel = renderExportPanel(exportPanelModel(input));
    assert.doesNotMatch(panel.body, /aria-busy="true"/);
  }
  input.flow.phase = 'preparing';
  input.flow.paused = true;
  const panel = renderExportPanel(exportPanelModel(input));
  assert.match(panel.body, /data-action="resume-export-flow"/);
  assert.doesNotMatch(panel.body, /aria-busy="true"/);
  assert.equal(input.flow.paused, true);
});

test('original read issue remains local truth through notice dismissal and Resume start', () => {
  const input = fixture();
  const flow = Object.assign(input.flow, { feedbackIssue: 'read' as const, feedbackError: 'Original read unavailable' });
  flow.error = 'Waiting for original stop';
  flow.paused = true;
  assert.equal(exportPanelModel(input).error, flow.feedbackError);
  flow.paused = false;
  flow.error = '';
  const panel = renderExportPanel(exportPanelModel(input));
  assert.match(panel.body, /Original read unavailable/);
  assert.doesNotMatch(panel.body, /aria-busy="true"/);
  assert.equal(exportPanelModel(input).flow, flow);
  delete (flow as Partial<typeof flow>).feedbackIssue;
  delete (flow as Partial<typeof flow>).feedbackError;
  assert.equal(exportPanelModel(input).error, '');
});

test('read-only model rejects another transfer, preserves original snapshot and expiry admission', () => {
  const input = fixture();
  input.transfer.ready = true;
  assert.equal(exportPanelModel(input).canSave, true);
  assert.equal(exportPanelModel({ ...input, activeFlow: { ...input.flow, workId: 'foreign-work' } }).busy, false);
  input.transfer.transferId = 'another-transfer';
  assert.equal(exportPanelModel(input).transfer, undefined);
  assert.equal(exportPanelModel(input).canSave, false);
  input.transfer.transferId = input.flow.transferId;
  input.transfer.snapshotId = 'another-snapshot';
  assert.equal(exportPanelModel(input).canSave, false);
  input.transfer.snapshotId = input.snapshot.id;
  input.transfer.workId = 'another-work';
  assert.equal(exportPanelModel(input).canSave, false);
  input.transfer.workId = input.work.id;
  input.snapshot.expiresAt = '2000-01-01T00:00:00Z';
  assert.equal(exportPanelModel(input).canSave, false);
  input.snapshot.workId = 'another-work';
  assert.equal(exportPanelModel(input).snapshot, undefined);
});

test('separately opened recovery preserves scoped IDs, lookup, old packages and privacy', () => {
  const input = fixture();
  const panel = renderExportRecoveryPanel(input);
  for (const id of [input.flow.stopOperationId, input.flow.exportOperationId, input.snapshot.id, input.transfer.transferId, 'snapshot-older']) assert.ok(panel.body.includes(id));
  assert.ok(!panel.body.includes('foreign-snapshot'));
  assert.match(panel.footer, /data-action="show-export-progress" data-id="flow-original" data-work-id="work-original"/);
  assert.match(panel.body, /id="snapshot-query"/);
  assert.match(panel.body, /data-action="lookup-snapshot" data-work-id="work-original"/);
  assert.match(panel.body, /private|credential/i);
  const withoutWork = renderExportRecoveryPanel({ snapshot: input.snapshot, transfer: input.transfer });
  assert.match(withoutWork.body, /data-action="lookup-snapshot" data-work-id="work-original"/);
  assert.ok(withoutWork.body.includes(input.snapshot.id));
});

test('locale is read at render time and unavailable bytes never invent a percentage', () => {
  const input = fixture();
  chooseLocale('zh-CN');
  assert.match(renderExportPanel(exportPanelModel(input)).body, /详情/);
  chooseLocale('en');
  assert.match(renderExportPanel(exportPanelModel(input)).body, /Details/);
  for (const total of [0, -1, NaN, Infinity]) {
    input.transfer.total = total;
    assert.doesNotMatch(renderExportPanel(exportPanelModel(input)).body, /<progress/);
  }
  const unknownBytes = { ...input, transfer: { ...input.transfer, transferred: undefined, total: 42 } };
  assert.doesNotMatch(renderExportPanel(exportPanelModel(unknownBytes)).body, /<progress/);
});

// Browser coverage uses the directly imported production renderer, not app source extraction.
function shell(panel: { title: string; body: string; footer: string }, kind = 'export-panel') {
  return `<button id="background">Background action</button><dialog id="modal" aria-modal="false" aria-labelledby="modal-title" class="modal ${kind}"><div class="modal-head"><h2 id="modal-title">${panel.title}</h2></div><div class="modal-body">${panel.body}</div><div class="modal-footer">${panel.footer}</div></dialog>`;
}

test('nonmodal progress stays keyboard-accessible at 360px/wide and in both languages', async t => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PIWORK_TEST_BROWSER_BIN || '/usr/bin/chromium' });
  t.after(() => browser.close());
  const css = await readFile(new URL('../public/style.css', import.meta.url), 'utf8');
  const page = await browser.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const locale of ['en', 'zh-CN']) for (const width of [1440, 360]) {
    chooseLocale(locale);
    const input = fixture(true);
    const panel = renderExportPanel(exportPanelModel(input));
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(`<style>${css}</style>${shell(panel)}`);
    await page.locator('dialog').evaluate(dialog => (dialog as HTMLDialogElement).show());
    assert.equal(await page.locator('dialog').evaluate(dialog => dialog.matches(':modal')), false);
    await page.locator('#background').click();
    await expect(page.locator('#background')).toBeFocused();
    await page.locator('.export-details summary').click();
    const check = page.locator('[data-action="check-export-flow"]');
    await check.focus();
    await expect(check).toBeFocused();
    const geometry = await page.locator('dialog').evaluate(dialog => ({
      left: dialog.getBoundingClientRect().left, right: dialog.getBoundingClientRect().right,
      overflow: document.documentElement.scrollWidth > innerWidth,
      bodyOverflow: dialog.querySelector('.modal-body')!.scrollWidth > dialog.querySelector('.modal-body')!.clientWidth,
    }));
    assert.equal(geometry.overflow, false);
    assert.equal(geometry.bodyOverflow, false);
    assert.ok(geometry.left >= 0 && geometry.right <= width);
    await page.locator('dialog').evaluate(dialog => (dialog as HTMLDialogElement).close());
    await page.locator('dialog').evaluate(dialog => (dialog as HTMLDialogElement).show());
    await expect(page.locator('[data-action="pause-export-flow"]')).toHaveAttribute('data-id', input.flow.id);
  }
  chooseLocale('en');
});


test('independent recovery keeps long original identities readable and controls reachable', async t => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PIWORK_TEST_BROWSER_BIN || '/usr/bin/chromium' });
  t.after(() => browser.close());
  const css = await readFile(new URL('../public/style.css', import.meta.url), 'utf8');
  const page = await browser.newPage();
  for (const width of [1440, 360]) {
    const input = fixture();
    const suffix = 'a8'.repeat(96);
    input.snapshot.id += suffix;
    input.snapshot.operationId += suffix;
    input.flow.snapshotId = input.snapshot.id;
    input.flow.exportOperationId = input.snapshot.operationId;
    input.flow.stopOperationId += suffix;
    input.transfer.snapshotId = input.snapshot.id;
    input.transfer.transferId += suffix;
    input.flow.transferId = input.transfer.transferId;
    const panel = renderExportRecoveryPanel(input);
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(`<style>${css}</style>${shell(panel, 'inspector-drawer')}`);
    await page.locator('dialog').evaluate(dialog => (dialog as HTMLDialogElement).show());
    const rows = await page.locator('.export-snapshot dd').evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      const text = range.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, textLeft: text.left, textRight: text.right, textTop: text.top, textBottom: text.bottom };
    }));
    assert.equal(rows.length, 7);
    for (const row of rows) {
      assert.ok(row.textLeft >= row.left - 1 && row.textRight <= row.right + 1);
      assert.ok(row.textTop >= row.top - 1 && row.textBottom <= row.bottom + 1);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const originalStop = page.locator('[data-action="operation"]').first();
    await originalStop.focus();
    await expect(originalStop).toBeFocused();
    assert.notEqual(await originalStop.evaluate(element => getComputedStyle(element).outlineStyle), 'none');
    await expect(originalStop).toHaveAttribute('data-id', input.flow.stopOperationId);
    const copy = page.locator('[data-action="copy"]').first();
    await copy.scrollIntoViewIfNeeded();
    await copy.focus();
    await expect(copy).toBeFocused();
    await expect(copy).toHaveAttribute('data-copy', input.snapshot.id);
    await page.locator('[data-action="lookup-snapshot"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-action="lookup-snapshot"]')).toBeVisible();
  }
});
