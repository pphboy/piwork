import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium, expect } from '@playwright/test';

const evidence = new URL('../../../../dist/server-ui-core-flow/shared-pending/', import.meta.url);
const dots = '<span class="pending-dots" aria-hidden="true"><i></i><i></i><i></i></span>';

test('shared Pending browser contract: opacity, fixed slot, terminal states and continuity', async t => {
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url || '/', 'http://fixture').pathname;
      if (path === '/fixture') {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<!doctype html><html lang="en"><head><link rel="stylesheet" href="/desktop/style.css"></head><body>
          <main style="padding:24px;max-width:720px;margin:auto"><h1>Shared pending fixture</h1><p>Synthetic UI only · no Core or model request</p>
          <div id="sample" style="display:flex;align-items:center;gap:12px"><button id="save" class="button primary" aria-busy="true">${dots}<span>Saving configuration</span></button><span id="neighbour">Current data stays visible</span></div>
          <button id="open" class="button" style="margin-top:24px">Open dialog</button>
          <dialog id="dialog" class="modal" aria-labelledby="title"><div class="modal-head"><h2 id="title">Fixture dialog</h2></div><div class="modal-body">${dots}Checking the current object</div><div class="modal-footer"><button id="close" class="button">Close</button></div></dialog>
          <section id="state" style="margin-top:24px"><div class="work-card"><button id="action" class="button" data-action="save-file">Save file</button></div></section>
          </main><script>document.querySelector('#open').onclick=()=>document.querySelector('#dialog').showModal();document.querySelector('#close').onclick=()=>document.querySelector('#dialog').close();</script></body></html>`);
        return;
      }
      // Only stub the application entry; nested catalog modules also end in app.js.
      if (path === '/browser/app.js') { res.setHeader('Content-Type', 'application/javascript'); res.end('// Hold the real initial HTML shell for this fixture.'); return; }
      const desktop = path.startsWith('/desktop/');
      const name = path.split('/').pop() || '';
      // Browser modules may live in nested catalog folders (i18n/catalog.js),
      // so preserve the subpath instead of flattening to the basename.
      const browserPath = path.startsWith('/browser/') ? path.slice('/browser/'.length) : '';
      const url = browserPath
        ? new URL(`../browser/${browserPath}`, import.meta.url)
        : name === 'style.css' || name === 'index.html'
          ? new URL(desktop ? `../public/${name}` : `../../../console-webui/dist/public/${name}`, import.meta.url)
          : null;
      if (!url) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(await readFile(url));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch(process.env.PIWORK_TEST_BROWSER_BIN
    ? { headless: true, executablePath: process.env.PIWORK_TEST_BROWSER_BIN }
    : { headless: true, channel: 'chromium' });
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  try {
    await t.test('both existing initial shells contain one decorative local wait', async () => {
      for (const app of ['desktop', 'console']) {
        await page.route('**/style.css', route => route.continue({ url: `${base}/${app}/style.css` }));
        await page.goto(`${base}/${app}/index.html`);
        await expect(page.locator('.pending-dots')).toHaveCount(1);
        await expect(page.locator('.pending-dots > i')).toHaveCount(3);
        await expect(page.locator('.pending-dots')).toHaveAttribute('aria-hidden', 'true');
        await expect(page.locator('.app-loading')).toHaveAttribute('aria-busy', 'true');
        assert.equal(await page.locator('.app-loading').evaluate(node => getComputedStyle(node).position), 'static');
        await page.unroute('**/style.css');
      }
    });

    await page.goto(`${base}/fixture`);
    await t.test('one 1.2-second cycle changes only dot opacity with fixed geometry', async () => {
      const styles = await page.locator('#save .pending-dots > i').evaluateAll(nodes => nodes.map(node => {
        const s = getComputedStyle(node);
        return { duration: s.animationDuration, delay: s.animationDelay, transform: s.transform, width: s.width, height: s.height };
      }));
      assert.deepEqual(styles.map(s => s.duration), ['1.2s', '1.2s', '1.2s']);
      assert.deepEqual(styles.map(s => s.delay), ['0s', '0.2s', '0.4s']);
      assert.ok(styles.every(s => s.transform === 'none' && s.width === '4px' && s.height === '4px'));
      assert.deepEqual(await page.locator('#save .pending-dots').evaluate(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })), { width: 24, height: 16 });
      const frames = await page.evaluate(async () => {
        const frames: { time: number; boxes: number[][]; opacity: string[]; transforms: string[] }[] = [];
        const start = performance.now();
        while (performance.now() - start < 1400) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          frames.push({ time: performance.now() - start,
            boxes: [...document.querySelectorAll('#save, #save > span, #neighbour')].map(node => { const r = node.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }),
            opacity: [...document.querySelectorAll('#save i')].map(node => getComputedStyle(node).opacity),
            transforms: [...document.querySelectorAll('#save i')].map(node => getComputedStyle(node).transform) });
        }
        return frames;
      });
      assert.ok(frames.length > 5);
      assert.ok(frames.every(frame => JSON.stringify(frame.boxes) === JSON.stringify(frames[0]!.boxes)));
      assert.ok(frames.every(frame => frame.transforms.every(value => value === 'none')));
      for (let dot = 0; dot < 3; dot++) assert.ok(new Set(frames.map(frame => frame.opacity[dot])).size > 2);
      if (process.env.PIWORK_PENDING_EVIDENCE) {
        await mkdir(evidence, { recursive: true });
        await writeFile(new URL('animation-samples.json', evidence), JSON.stringify({ fixture: 'Real Chromium rendering of shared UI; synthetic UI only, no Core/model', frames }, null, 2));
        for (const width of [1440, 360]) {
          await page.setViewportSize({ width, height: 800 });
          await page.screenshot({ path: fileURLToPath(new URL(`pending-${width}.png`, evidence)), fullPage: true });
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        }
        await page.setViewportSize({ width: 960, height: 600 });
        // Real screenshots of the running CSS animation, never drawn stand-ins.
        for (let i = 0; i < 12; i++) {
          await page.screenshot({ path: fileURLToPath(new URL(`frame-${String(i).padStart(2, '0')}.png`, evidence)) });
          await page.waitForTimeout(100);
        }
      }
    });

    await t.test('reduced motion retains visible static dots and the Modal has no transition', async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const staticDots = await page.locator('#save i').evaluateAll(nodes => nodes.map(node => ({ animation: getComputedStyle(node).animationName, opacity: Number(getComputedStyle(node).opacity) })));
      assert.ok(staticDots.every(dot => dot.animation === 'none' && dot.opacity >= .5));
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.locator('#open').click();
      const presentation = await page.locator('#dialog').evaluate(node => ['','::backdrop'].map(pseudo => {
        const s = getComputedStyle(node, pseudo || null); return { animation: s.animationName, transition: s.transitionDuration };
      }));
      assert.ok(presentation.every(style => style.animation === 'none' && style.transition === '0s'));
      await page.locator('#close').click();
      assert.equal(await page.locator('#dialog').evaluate(node => (node as HTMLDialogElement).open), false);
    });

    await t.test('local renderer retains dots across updates and stops immediately without unlocking unknown writes', async () => {
      const result = await page.evaluate(async () => {
        const path = '/browser/action-state.js';
        const { ActionState, renderActionStates } = await import(path);
        const root = document.querySelector<HTMLElement>('#state')!;
        const actions = new ActionState();
        const intent = { key:'save-one', kind:'files', work:'one', resource:'file', action:'save-file', target:'File one', label:'Saving', anchor:'#action' };
        const render = () => renderActionStates(root, actions, '', () => intent);
        const record = actions.begin(intent); render();
        const node = root.querySelector('[data-action-status]'), dots = node!.querySelector('.pending-dots');
        const animation = dots!.querySelector('i')!.getAnimations()[0];
        actions.update(record, 'Waiting for confirmation'); render(); render();
        const retained = node === root.querySelector('[data-action-status]') && dots === node!.querySelector('.pending-dots') && animation === dots!.querySelector('i')!.getAnimations()[0];
        const began = performance.now(); actions.confirm(record, 'Saved'); render();
        const completedImmediately = performance.now() - began < 1200 && !root.querySelector('.pending-dots') && !(root.querySelector('#action') as HTMLButtonElement).disabled;
        const next = actions.begin(intent); render();
        actions.fail(next, Object.assign(new Error('Read back the original result'), { code:'RESULT_UNKNOWN' })); render(); render();
        const unknownStopped = !root.querySelector('.pending-dots') && !!actions.conflict(intent) && (root.querySelector('#action') as HTMLButtonElement).disabled && root.querySelector('#action')!.getAttribute('aria-busy') === 'false';
        const retainedText = root.textContent!.includes('Read back the original result');
        actions.clear(); render();
        return { retained, completedImmediately:!!completedImmediately, unknownStopped, retainedText, removed:!root.querySelector('[data-action-status]') };
      });
      assert.deepEqual(result, { retained:true, completedImmediately:true, unknownStopped:true, retainedText:true, removed:true });
    });

    await t.test('a module-owned request has one primary wait but does not hide another object or unknown result', async () => {
      const result = await page.evaluate(async () => {
        const path = '/browser/action-state.js'; const { ActionState, renderActionStates } = await import(path);
        const root = document.querySelector<HTMLElement>('#state')!;
        root.innerHTML = '<div class="work-card"><button id="first">Save first</button><span data-pending-action="save-file" aria-busy="true">Saving first</span></div><div class="work-card"><button id="second">Save second</button></div>';
        const actions = new ActionState();
        const intent = { key:'first',kind:'files',work:'first',action:'save-file',target:'First',label:'Saving',anchor:'#first' };
        const first = actions.begin(intent);
        const second = actions.begin({ ...intent, key:'second',work:'second',target:'Second',anchor:'#second' });
        const render = () => renderActionStates(root, actions, '', () => undefined);
        render();
        const primaryKeys = [...root.querySelectorAll<HTMLElement>('[data-action-status]')].map(node => node.dataset.actionStatus);
        actions.fail(first, Object.assign(new Error('Unknown first result'),{ code:'RESULT_UNKNOWN' })); render();
        const unknownVisible = !!root.querySelector('[data-action-status="first"]') && !root.querySelector('[data-action-status="first"] .pending-dots');
        actions.finish(second); actions.clear(); render();
        return { primaryKeys, unknownVisible };
      });
      assert.deepEqual(result, { primaryKeys:['second'], unknownVisible:true });
    });

    await t.test('a Dialog body owns its footer request without suppressing another Dialog', async () => {
      const result = await page.evaluate(async () => {
        const path = '/browser/action-state.js', pendingPath = '/browser/pending.js';
        const { ActionState, renderActionStates } = await import(path);
        const { pendingDots } = await import(pendingPath);
        const root = document.querySelector<HTMLElement>('#state')!;
        root.innerHTML = `<dialog open class="modal" id="first-dialog"><div class="modal-body"><span data-pending-action="check-connection" aria-busy="true">${pendingDots()}Checking first Core</span></div><div class="modal-footer"><button id="first-check">Check first Core</button></div></dialog><dialog open class="modal" id="second-dialog"><div class="modal-body">Second Core</div><div class="modal-footer"><button id="second-check">Check second Core</button></div></dialog>`;
        const actions = new ActionState();
        const intent = { key:'first-check',kind:'read',action:'check-connection',target:'First Core',label:'Checking',anchor:'#first-check' };
        actions.begin(intent);
        actions.begin({ ...intent, key:'second-check',target:'Second Core',anchor:'#second-check' });
        renderActionStates(root, actions, '', () => undefined);
        const firstDots = root.querySelectorAll('#first-dialog .pending-dots').length;
        const secondDots = root.querySelectorAll('#second-dialog .pending-dots').length;
        const genericKeys = [...root.querySelectorAll<HTMLElement>('[data-action-status]')].map(node => node.dataset.actionStatus);
        actions.clear(); renderActionStates(root, actions, '', () => undefined);
        return { firstDots, secondDots, genericKeys };
      });
      assert.deepEqual(result, { firstDots:1, secondDots:1, genericKeys:['second-check'] });
    });
  } finally {
    await browser.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
