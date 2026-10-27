const { catalog } = await import(new URL('../browser/i18n/catalog.js', import.meta.url).href);
const { localeSandbox } = await import(new URL('./locale-sandbox.js', import.meta.url).href);
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { chromium, expect, type Page } from '@playwright/test';

const { pendingDots } = await import(new URL('../browser/pending.js', import.meta.url).href);
const { overlayRole } = await import(new URL('../browser/overlay-role.js', import.meta.url).href);
const { exportSnapshotAvailable } = await import(new URL('../browser/export-admission.js', import.meta.url).href);
const source = readFileSync(new URL('../browser/app.js', import.meta.url), 'utf8');
const evidence = new URL('../../../../dist/server-ui-core-flow/export-details/', import.meta.url);

// Render the production panel and its real modal shell; no copied export markup or CSS.
function fixture(longToken = false) {
  const suffix = longToken ? 'a8'.repeat(96) : '8714ad1e-23ad-4046-90dd-eff97ae25863';
  const work = { id: 'work-export-layout', name: 'Export layout fixture' };
  const snapshot = { id: `snapshot-${suffix}`, workId: work.id, operationId: `operation-export-${suffix}`, status: 'preparing', size: '', expiresAt: '' };
  const saved = { ...snapshot, id: `snapshot-saved-${suffix}`, status: 'verified' };
  const flow = { id: 'export-layout-flow', workId: work.id, workName: work.name, stopOperationId: `operation-stop-${suffix}`, exportOperationId: snapshot.operationId, snapshotId: snapshot.id, phase: 'exporting', paused: false, terminal: false };
  const context: any = {
    ...localeSandbox,
    pendingDots, overlayRole, exportSnapshotAvailable, innerWidth: 1440,
    adapter: { getWork: () => work, getSnapshot: () => snapshot, downloads: new Map(), state: { snapshots: [snapshot, saved] } },
    exportFlows: { get: () => flow, forWork: () => flow },
    route: () => ['work', work.id], current: () => work, isRequestInspector: () => false,
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('const esc ='), source.indexOf('let view =')), context);
  context.view = { modal: 'export', modalError: '', data: { flowId: flow.id, workId: work.id } };
  for (const name of ['progressText', 'downloadProgressMarkup', 'exportPanel', 'modalMarkup']) {
    const implementation = source.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}`, 'm'));
    assert.ok(implementation, `${name} production renderer`);
    vm.runInContext(implementation[0], context);
  }
  return { context, flow, snapshot, saved, html: () => context.modalMarkup() as string };
}

test('export details retains full original IDs, collapsed disclosure and existing flow controls', () => {
  const f = fixture();
  let html = f.html();
  assert.match(html, /<details class="export-details"><summary>Details<\/summary>/);
  for (const id of [f.flow.stopOperationId, f.flow.exportOperationId]) {
    assert.ok(html.includes(`data-action="operation" data-id="${id}">${id}</button>`));
  }
  assert.ok(html.includes(`<code>${f.snapshot.id}</code>`));
  assert.ok(html.includes(`data-action="view-snapshot" data-id="${f.saved.id}"`));
  assert.match(html, /data-action="pause-export-flow"[^>]*>Pause<\/button>/);
  assert.match(html, /data-action="check-export-flow"[^>]*>Check status<\/button>/);
  assert.match(html, /data-action="close-modal"[^>]*>Hide<\/button>/);
  assert.match(html, /aria-busy="true" data-pending-label="Starting export"/);
  assert.match(html, /Starting export<\/span><\/span> You can keep working/);
  f.flow.paused = true;
  html = f.html();
  assert.match(html, /data-action="resume-export-flow"[^>]*>Resume<\/button>/);
  assert.doesNotMatch(html, /data-pending-label="Starting export"/);
  assert.match(html, /Paused\. Resume in Details/);
  assert.match(source, /data-copy="\$\{op\.id\}" aria-label="\$\{t\('ops\.copyId'\)\}"/);
  assert.equal(catalog.en['ops.copyId'], 'Copy Operation ID');
});

async function assertDetailsGeometry(page: Page) {
  const geometry = await page.locator('.export-details').evaluate(details => {
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const values = [...details.querySelectorAll('dl > dd')];
    return {
      viewportWidth: innerWidth,
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
      bodyOverflow: details.closest('.modal-body')!.scrollWidth > details.closest('.modal-body')!.clientWidth,
      panel: box(details.closest('dialog')!),
      summary: box(details.querySelector('summary')!),
      rows: values.map(value => {
        const range = document.createRange();
        range.selectNodeContents(value);
        const content = range.getBoundingClientRect();
        const button = value.querySelector('button');
        return {
          label: value.previousElementSibling!.textContent,
          labelBox: box(value.previousElementSibling!), value: box(value),
          content: { left: content.left, right: content.right, top: content.top, bottom: content.bottom },
          button: button ? { ...box(button), overflowing: button.scrollHeight > button.clientHeight + 1 } : undefined,
        };
      }),
      saved: [...details.querySelectorAll('.menu-list .button')].map(button => ({ ...box(button), overflowing: button.scrollHeight > button.clientHeight + 1 })),
    };
  });
  assert.equal(geometry.pageOverflow, false, 'no viewport horizontal overflow');
  assert.equal(geometry.bodyOverflow, false, 'no export body horizontal overflow');
  assert.ok(geometry.panel.left >= 0 && geometry.panel.right <= geometry.viewportWidth, 'panel remains within viewport');
  assert.equal(geometry.rows.length, 6);
  let previousBottom = geometry.summary.bottom;
  for (const row of geometry.rows) {
    assert.ok(row.value.top >= previousBottom - 1, `${row.label} cannot overlap the preceding metadata row`);
    assert.ok(row.content.left >= row.value.left - 1 && row.content.right <= row.value.right + 1, `${row.label} text remains inside the value column`);
    assert.ok(row.content.top >= row.value.top - 1 && row.content.bottom <= row.value.bottom + 1, `${row.label} row grows to contain its complete text`);
    if (row.button) {
      assert.ok(Math.abs(row.button.width - row.value.width) <= 1 && row.button.width > 100, `${row.label} is a full-width link, not a 27px copy icon`);
      assert.ok(row.button.height >= 32 && row.button.bottom <= row.value.bottom + 1, `${row.label} link height belongs to its row`);
      assert.equal(row.button.overflowing, false, `${row.label} ID has no clipped or overflowing lines`);
    }
    previousBottom = Math.max(row.value.bottom, row.labelBox.bottom, row.content.bottom);
  }
  for (const saved of geometry.saved) {
    assert.ok(saved.left >= geometry.panel.left && saved.right <= geometry.panel.right, 'saved package link remains in panel');
    assert.equal(saved.overflowing, false, 'saved package link grows with its long identity');
  }
  return geometry;
}

test('export details long identities fit auto-sized rows at 1440px and 360px', async t => {
  const browser = await chromium.launch(process.env.PIWORK_TEST_BROWSER_BIN
    ? { headless: true, executablePath: process.env.PIWORK_TEST_BROWSER_BIN }
    : { headless: true, channel: 'chromium' });
  t.after(() => browser.close());
  const css = await readFile(new URL('../public/style.css', import.meta.url), 'utf8');
  const page = await browser.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [1440, 360]) for (const phase of ['exporting', 'preparing']) for (const longToken of phase === 'exporting' ? [false, true] : [false]) {
    const f = fixture(longToken);
    f.flow.phase = phase;
    if (phase === 'preparing') {
      f.snapshot.status = 'verified';
      f.context.adapter.downloads.set(f.snapshot.id, { transferId: 'download-8714ad1e-23ad-4046-90dd-eff97ae25863', phase: 'preparing', pending: true, ready: false });
    }
    f.context.innerWidth = width;
    const screenshotName = `export-${phase === 'exporting' ? 'starting' : 'preparing'}-${longToken ? 'token' : 'uuid'}-${width}`;
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${f.html()}</body></html>`);
    await page.locator('#modal').evaluate(dialog => (dialog as HTMLDialogElement).show());
    await expect(page.locator('.export-summary')).toContainText(`${phase === 'exporting' ? 'Starting export' : 'Transferring and verifying'} You can keep working`);
    const details = page.locator('.export-details');
    await expect(details).not.toHaveAttribute('open', '');
    await details.locator('summary').click();
    await expect(details).toHaveAttribute('open', '');
    const geometry = await assertDetailsGeometry(page);
    await details.locator('summary').focus();
    for (const id of [f.flow.stopOperationId, f.flow.exportOperationId]) {
      const link = details.getByRole('button', { name: id, exact: true });
      await expect(link).toHaveAttribute('data-action', 'operation');
      await expect(link).toHaveAttribute('data-id', id);
      await page.keyboard.press('Tab');
      await expect(link).toBeFocused();
      assert.notEqual(await link.evaluate(element => getComputedStyle(element).outlineStyle), 'none');
    }
    await details.getByRole('button', { name: 'Pause', exact: true }).scrollIntoViewIfNeeded();
    for (const name of ['Check status', 'Pause']) {
      const control = details.getByRole('button', { name, exact: true });
      await expect(control).toBeVisible();
      for (const focused of [false, true]) {
        if (focused) { await control.focus(); await expect(control).toBeFocused(); }
        const visibleTarget = await control.evaluate(button => {
          const rect = button.getBoundingClientRect(), body = button.closest('.modal-body')!;
          const viewport = body.getBoundingClientRect(), footer = button.closest('dialog')!.querySelector('.modal-footer')!.getBoundingClientRect();
          const left = viewport.left + body.clientLeft, top = viewport.top + body.clientTop;
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return {
            contained: rect.left >= left - 1 && rect.right <= left + body.clientWidth + 1 && rect.top >= top - 1 && rect.bottom <= top + body.clientHeight + 1,
            aboveFooter: rect.bottom <= footer.top + 1,
            hit: hit === button || !!hit && button.contains(hit),
          };
        });
        assert.deepEqual(visibleTarget, { contained: true, aboveFooter: true, hit: true }, `${name} is fully reachable ${focused ? 'with focus' : 'after normal scrolling'}`);
      }
    }
    await expect(page.getByRole('button', { name: 'Hide', exact: true })).toBeVisible();
    if (process.env.PIWORK_EXPORT_EVIDENCE && !longToken) {
      await mkdir(evidence, { recursive: true });
      await details.getByRole('button', { name: f.flow.exportOperationId, exact: true }).focus();
      await page.locator('.modal-body').evaluate(body => { body.scrollTop = 0; });
      await page.screenshot({ path: fileURLToPath(new URL(`${screenshotName}-expanded.png`, evidence)), fullPage: true });
    }
    assert.ok(geometry.rows[0]!.button!.height > 32 || !longToken, 'stress IDs require and receive growing link rows');
  }
});
