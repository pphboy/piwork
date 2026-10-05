import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium, expect, type Page, type Route } from '@playwright/test';

let browser: Awaited<ReturnType<typeof chromium.launch>>, base = '';
const server = createServer(async (request, response) => {
  const path = request.url?.startsWith('/desktop/browser/') ? '../browser/' + request.url.slice('/desktop/browser/'.length) : '../public/' + (request.url === '/style.css' ? 'style.css' : 'index.html');
  try { response.setHeader('Content-Type', path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html'); response.end(await readFile(new URL(path, import.meta.url))); }
  catch { response.writeHead(404); response.end(); }
});
before(async () => { await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const address = server.address(); assert(address && typeof address !== 'string'); base = `http://127.0.0.1:${address.port}`; browser = await chromium.launch({ headless: true, channel: 'chromium' }); });
after(async () => { await browser.close(); await new Promise<void>(done => server.close(() => done())); });
type Record = { path: string; method: string; body: string; headers: { [key: string]: string } };
type Reply = { status?: number; json?: any; abort?: boolean };
const signedOut = (generation = 1, csrf = 'current-csrf') => ({ state: 'signed-out', coreUrl: 'http://core.test', generation, csrf });
const signedIn = (generation = 1, account = 'owner') => ({ ...signedOut(generation), state: 'authenticated', user: { account, role: 'user' } });
const denied = { status: 401, json: { code: 'LOCAL_AUTH_REQUIRED' } };
const pending = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(t: { after: (fn: () => Promise<void>) => void }, handler: (record: Record) => Reply | undefined | Promise<Reply | undefined>, ticket = '') {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); t.after(() => page.close()); page.setDefaultTimeout(5000);
  const records: Record[] = [];
  await page.route('**/_desktop/api/**', async (route: Route) => {
    const record = { path: new URL(route.request().url()).pathname.slice('/_desktop/api/'.length), method: route.request().method(), body: route.request().postData() ?? '', headers: route.request().headers() }; records.push(record);
    let reply = await handler(record);
    reply ??= record.path === 'status' ? { json: { health: { available: true }, readiness: { available: true, value: { ready: true } } } } : record.path === 'works' ? { json: { works: [] } } : record.path === 'skills' ? { json: { skills: [] } } : record.path === 'packages' ? { json: { packages: [] } } : record.path === 'known-operations' ? { json: { operations: [] } } : { status: 404, json: { code: 'NOT_FOUND' } };
    if (reply.abort) await route.abort('failed'); else await route.fulfill({ status: reply.status ?? 200, contentType: 'application/json', body: JSON.stringify(reply.json ?? {}) });
  });
  await page.goto(base + (ticket ? '/#ticket=' + ticket : '/'));
  return { page, records };
}
const api = (page: Page, code: string): Promise<any> => page.evaluate(`(async () => { const { adapter } = await import('/desktop/browser/adapter.js'); ${code} })()`);
const button = (page: Page, action: string) => page.locator(`[data-action="${action}"]`).last();

test('local auth: checking is visible and valid Cookie discards an old ticket without bootstrap', async t => {
  const gate = pending(); t.after(async () => gate.resolve());
  const { page, records } = await fixture(t, async r => { if (r.path === 'session') { await gate.promise; return { json: signedIn() }; } }, 'used-or-expired');
  await expect(page.getByRole('heading', { name: 'Opening workspace…' })).toBeVisible();
  assert.equal(await page.locator('[data-action="account"]').count(), 0);
  assert.equal(new URL(page.url()).hash, ''); gate.resolve();
  await expect(page.getByRole('heading', { name: 'Make room for your next idea' })).toBeVisible();
  assert.equal(records.filter(r => r.path === 'bootstrap').length, 0);
});
for (const ticket of ['', 'expired', 'replayed', 'prior-process']) test(`local auth: ${ticket || 'missing Cookie'} gives actionable access recovery and explicit readonly check`, async t => {
  let allowed = false;
  const { page, records } = await fixture(t, r => r.path === 'session' ? allowed ? { json: signedOut() } : denied : r.path === 'bootstrap' ? { status: 403, json: { code: 'LOCAL_BOOTSTRAP_DENIED' } } : undefined, ticket);
  await expect(page.getByRole('heading', { name: 'Browser access required' })).toBeVisible();
  for (const action of ['account', 'sign-in', 'sign-out', 'import', 'operations']) assert.equal(await page.locator(`[data-action="${action}"]`).count(), 0);
  assert.equal(records.filter(r => r.path === 'bootstrap').length, ticket ? 1 : 0);
  await expect(page.locator('body')).toContainText(`desktop open --port ${new URL(base).port} --no-open`);
  await expect(page.locator('body')).toContainText(`desktop logout --port ${new URL(base).port}`);
  allowed = true; await button(page, 'check-browser-access').click();
  await expect(page.getByRole('heading', { name: 'Connect to your Core' })).toBeVisible();
  assert.equal(await page.locator('[data-action="import"]').count(), 1);
  assert.equal(records.filter(r => r.method !== 'GET').length, ticket ? 1 : 0);
});
test('local auth: initial network failure does not exchange ticket; manual check and deduplicated reads recover', async t => {
  let online = false; const gate = pending(); t.after(async () => gate.resolve());
  const { page, records } = await fixture(t, async r => { if (r.path === 'session') { if (!online) return { abort: true }; await gate.promise; return { json: signedOut() }; } }, 'ticket');
  await expect(page.getByRole('heading', { name: 'Desktop connection unavailable' })).toBeVisible();
  online = true;
  const checked = api(page, 'await Promise.all([adapter.checkBrowserAccess(), adapter.checkBrowserAccess()])');
  await expect.poll(() => records.filter(r => r.path === 'session').length).toBe(2); gate.resolve(); await checked;
  await expect(page.getByRole('heading', { name: 'Connect to your Core' })).toBeVisible();
  assert.equal(records.filter(r => r.path === 'bootstrap').length, 0);
});
for (const lost of [false, true]) test(`local auth: exchange ${lost ? 'response lost' : 'confirmed'} is followed by actual Cookie check and no replay`, async t => {
  let allowed = false;
  const { page, records } = await fixture(t, r => {
    if (r.path === 'session') return allowed ? { json: signedOut() } : denied;
    if (r.path === 'bootstrap') { allowed = true; return lost ? { abort: true } : { json: { authorized: true, csrf: 'not-trusted-alone' } }; }
  }, 'fresh');
  await expect(page.getByRole('heading', { name: 'Connect to your Core' })).toBeVisible();
  assert.deepEqual(records.slice(0, 3).map(r => r.path), ['session', 'bootstrap', 'session']);
  assert.equal(records.filter(r => r.path === 'bootstrap').length, 1);
  assert.equal(await api(page, 'return adapter.state.signedIn'), false);
});
test('local auth: Cookie rejection and session capacity have separate safe diagnostics', async t => {
  for (const code of ['', 'LOCAL_SESSION_CAPACITY']) {
    const { page, records } = await fixture(t, r => r.path === 'session' ? denied : r.path === 'bootstrap' ? code ? { status: 503, json: { code } } : { json: { authorized: true } } : undefined, 'fresh');
    await expect(page.getByRole('heading', { name: 'Browser access required' })).toBeVisible();
    await expect(page.locator('body')).toContainText(code ? '128 active browser sessions' : 'did not retain its Cookie');
    assert.equal(records.filter(r => r.path === 'bootstrap').length, 1);
  }
});
test('local auth: stale CSRF updates from readonly session, preserves account input and does not retry login', async t => {
  let csrf = 'old-csrf';
  const { page, records } = await fixture(t, r => {
    if (r.path === 'session') return { json: signedOut(1, csrf) };
    if (r.path === 'login') { csrf = 'new-csrf'; return { status: 403, json: { code: 'LOCAL_CSRF_OR_AUTH_REQUIRED' } }; }
  });
  await expect(page.getByRole('heading', { name: 'Connect to your Core' })).toBeVisible();
  await page.getByLabel('Account', { exact: true }).fill('keep-input'); await page.getByLabel('Password').fill('secret');
  await button(page, 'sign-in').click();
  await expect(page.locator('body')).toContainText('original action was rejected locally');
  await expect(page.getByLabel('Account', { exact: true })).toHaveValue('keep-input');
  assert.equal(await api(page, 'return adapter.state.browserAccess'), 'authorized');
  assert.equal(records.filter(r => r.path === 'login').length, 1);
  assert.equal(records.filter(r => r.path === 'session').length, 2);
});
test('local auth: offline Core retains local authorization and last known identity', async t => {
  const { page } = await fixture(t, r => r.path === 'session' ? { json: { ...signedOut(), state: 'offline', lastKnownUser: { account: 'owner', role: 'user' }, lastConfirmedAt: '2026-10-03T00:00:00Z' } } : r.path === 'status' ? { json: { health: { available: false } } } : undefined);
  await expect(page.locator('body')).toContainText('Core is unreachable');
  assert.equal(await api(page, 'return adapter.state.browserAccess'), 'authorized');
  assert.equal(await page.locator('[data-action="account"]').count(), 1);
});
test('local auth: reset cancellation has no mutation; confirmed reset hides identity and ends all browser controls', async t => {
  let local = true; const gate = pending(); t.after(async () => gate.resolve());
  const { page, records } = await fixture(t, async r => {
    if (r.path === 'session') return local ? { json: signedIn() } : denied;
    if (r.path === 'browser-access/reset') { await gate.promise; local = false; return { json: { browserAccessCleared: true, coreSessionRetained: true } }; }
  });
  await expect(button(page, 'account')).toBeVisible(); await button(page, 'account').click(); await button(page, 'reset-browser-access').click();
  await expect(page.getByRole('heading', { name: 'Reset browser access?' })).toBeVisible();
  await expect(page.locator('#modal')).toContainText('all windows of this Desktop'); await button(page, 'close-modal').click();
  assert.equal(records.filter(r => r.path === 'browser-access/reset').length, 0);
  await button(page, 'account').click(); await button(page, 'reset-browser-access').click(); await button(page, 'confirm-reset-browser-access').click();
  await expect(button(page, 'confirm-reset-browser-access')).toBeDisabled();
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-action="confirm-reset-browser-access"]')?.click());
  assert.equal(records.filter(r => r.path === 'browser-access/reset').length, 1); gate.resolve();
  await expect(page.getByRole('heading', { name: 'Browser access required' })).toBeVisible();
  assert.equal(await page.locator('[data-action="account"]').count(), 0);
  await expect(page.locator('body')).toContainText('saved Core login and running Works are retained');
});
test('local auth: unknown reset is checked without replay; normal sign out retains local control and reports disk cleanup', async t => {
  let signed = true;
  const { page, records } = await fixture(t, r => {
    if (r.path === 'session') return { json: signed ? signedIn() : { ...signedOut(2), cleanupRequired: true } };
    if (r.path === 'browser-access/reset') return { abort: true };
    if (r.path === 'logout') { signed = false; return { json: { view: { ...signedOut(2), cleanupRequired: true }, localCleared: true, credentialCleared: false, remoteRevocationConfirmed: false } }; }
  });
  await expect(button(page, 'account')).toBeVisible();
  await api(page, 'await adapter.resetBrowserAccess().catch(() => undefined)');
  assert.equal(records.filter(r => r.path === 'browser-access/reset').length, 1);
  assert.equal(await api(page, 'return adapter.state.browserAccess'), 'authorized');
  await button(page, 'account').click(); await button(page, 'sign-out').click();
  await expect(page.getByRole('heading', { name: 'Connect to your Core' })).toBeVisible();
  await expect(page.locator('body')).toContainText('saved credential cleanup is incomplete');
  assert.equal(await api(page, 'return adapter.state.browserAccess'), 'authorized');
  await expect(button(page, 'sign-in')).toBeVisible();
});
test('local auth: an old access check cannot overwrite a new account or release a new identity lock', async t => {
  const gate = pending(); t.after(async () => gate.resolve()); let armed = false, held = false, loggedIn = false;
  const { page, records } = await fixture(t, async r => {
    if (r.path === 'session') {
      if (armed && !held) { held = true; await gate.promise; return { json: signedOut(1) }; }
      return { json: loggedIn ? signedIn(2, 'new-owner') : signedOut(1) };
    }
    if (r.path === 'login') { loggedIn = true; return { json: signedIn(2, 'new-owner') }; }
  });
  await expect(button(page, 'sign-in')).toBeVisible(); armed = true;
  const old = api(page, 'await adapter.checkBrowserAccess().catch(() => undefined)');
  await expect.poll(() => held).toBe(true);
  await page.getByLabel('Account', { exact: true }).fill('new-owner'); await page.getByLabel('Password').fill('secret'); await button(page, 'sign-in').click();
  await expect.poll(() => api(page, 'return adapter.state.core.account')).toBe('new-owner');
  await expect.poll(() => api(page, 'return !!adapter.worksChecked')).toBe(true);
  assert.equal(records.filter(r => r.path === 'works').length, 1);
  await page.getByRole('button', { name: 'New Work', exact: true }).first().click();
  await page.locator('#create-name').fill('new-owner draft');
  gate.resolve(); await old;
  assert.equal(await api(page, 'return adapter.state.core.account'), 'new-owner');
  assert.notEqual(await api(page, 'return adapter.state.scenario'), 'list-error');
  await expect(page.locator('#create-name')).toHaveValue('new-owner draft');
  assert.equal(records.filter(r => r.path === 'login' && r.method === 'POST').length, 1);
});

test('local auth: completing an obsolete check does not release the current check deduplication', async t => {
  const oldGate = pending(), freshGate = pending(); let armed = false, held = false, loggedIn = false;
  t.after(async () => { oldGate.resolve(); freshGate.resolve(); });
  const { page, records } = await fixture(t, async r => {
    if (r.path === 'session') {
      if (armed && !held) { held = true; await oldGate.promise; return { json: signedOut(1) }; }
      if (loggedIn) { await freshGate.promise; return { json: signedIn(2, 'new-owner') }; }
      return { json: signedOut(1) };
    }
    if (r.path === 'login') { loggedIn = true; return { json: signedIn(2, 'new-owner') }; }
  });
  await expect(button(page, 'sign-in')).toBeVisible(); armed = true;
  const before = records.filter(r => r.path === 'session').length;
  const old = api(page, 'await adapter.checkBrowserAccess().catch(() => undefined)');
  await expect.poll(() => held).toBe(true);
  await api(page, `await adapter.signIn('http://core.test', 'new-owner', 'secret')`);
  await expect.poll(() => records.filter(r => r.path === 'session').length).toBe(before + 2);
  oldGate.resolve(); await old;
  await api(page, 'void adapter.checkBrowserAccess().catch(() => undefined)');
  assert.equal(records.filter(r => r.path === 'session').length, before + 2);
  freshGate.resolve();
  await expect.poll(() => api(page, 'return !!adapter.worksChecked')).toBe(true);
  assert.notEqual(await api(page, 'return adapter.state.scenario'), 'list-error');
});
test('local auth: a delayed business 401 readback cannot abandon a newer reopen initialization', async t => {
  const oldReadback = pending(), freshSession = pending(); let armed = false, readbacks = 0, freshStarted = false;
  t.after(() => { oldReadback.resolve(); freshSession.resolve(); });
  const { page, records } = await fixture(t, async r => {
    if (r.path === 'session') {
      if (!armed) return { json: signedIn() };
      if (++readbacks === 1) { await oldReadback.promise; return { json: signedOut(2) }; }
      freshStarted = true; await freshSession.promise; return { json: signedOut(2) };
    }
    if (r.path === 'status') return { json: { health: { available: false } } };
    if (r.path === 'works' && armed) return { status: 401, json: { code: 'AUTH_REQUIRED' } };
  });
  await expect(page.locator('body')).toContainText('Core is unreachable'); armed = true;
  const epoch = await api(page, 'return adapter.identityEpoch');
  const originalRead = api(page, `return adapter.request('works').catch(error => error.code)`);
  await expect.poll(() => readbacks).toBe(1);
  const reopen = api(page, 'await adapter.initialize()');
  await expect.poll(() => freshStarted).toBe(true);
  oldReadback.resolve(); assert.equal(await originalRead, 'CONNECTION_CHANGED');
  assert.equal(await api(page, 'return adapter.identityEpoch'), epoch);
  freshSession.resolve(); await reopen;
  await expect(page.getByRole('heading', { name: 'Connect to your Core' })).toBeVisible();
  assert.equal(await api(page, 'return adapter.state.browserAccess'), 'authorized');
  assert.equal(records.filter(r => r.path === 'works').length, 1);
  assert.equal(records.filter(r => r.method !== 'GET').length, 0);
});

test('local auth: a delayed business 401 readback cannot clear a newly logged-in account or draft', async t => {
  const gate = pending(); let armed = false, held = false, loggedIn = false;
  t.after(() => gate.resolve());
  const { page, records } = await fixture(t, async r => {
    if (r.path === 'session') {
      if (armed && !held) { held = true; await gate.promise; return { json: signedOut(2) }; }
      return { json: loggedIn ? signedIn(3, 'new-owner') : signedIn() };
    }
    if (r.path === 'works' && armed && !loggedIn) return { status: 401, json: { code: 'AUTH_REQUIRED' } };
    if (r.path === 'login') { loggedIn = true; return { json: signedIn(3, 'new-owner') }; }
  });
  await expect.poll(() => api(page, 'return !!adapter.worksChecked')).toBe(true); armed = true;
  const originalRead = api(page, `await adapter.request('works').catch(() => undefined)`);
  await expect.poll(() => held).toBe(true);
  await api(page, `await adapter.signIn('http://core.test', 'new-owner', 'secret')`);
  await expect.poll(() => api(page, 'return !!adapter.worksChecked')).toBe(true);
  await page.getByRole('button', { name: 'New Work', exact: true }).first().click();
  await page.locator('#create-name').fill('new identity draft'); gate.resolve(); await originalRead;
  assert.equal(await api(page, 'return adapter.state.core.account'), 'new-owner');
  assert.equal(await api(page, 'return adapter.state.browserAccess'), 'authorized');
  assert.notEqual(await api(page, 'return adapter.state.scenario'), 'auth-expired');
  await expect(page.locator('#create-name')).toHaveValue('new identity draft');
  assert.equal(records.filter(r => r.method !== 'GET').length, 1);
  assert.equal(records.filter(r => r.path === 'login' && r.method === 'POST').length, 1);
});

test('local auth: initialization losing its identity epoch leaves an explicit recovery action', async t => {
  const gate = pending(); let armed = false, held = false;
  t.after(() => gate.resolve());
  const { page, records } = await fixture(t, async r => {
    if (r.path === 'session') {
      if (armed && !held) { held = true; await gate.promise; }
      return { json: signedOut(2) };
    }
  });
  await expect(button(page, 'sign-in')).toBeVisible(); armed = true;
  const reopen = api(page, 'await adapter.initialize()');
  await expect.poll(() => held).toBe(true);
  await api(page, 'adapter.clearIdentity()'); gate.resolve(); await reopen;
  await expect(page.getByRole('heading', { name: 'Desktop connection unavailable' })).toBeVisible();
  await expect(button(page, 'check-browser-access')).toBeEnabled();
  await button(page, 'check-browser-access').click();
  await expect(page.getByRole('heading', { name: 'Connect to your Core' })).toBeVisible();
  assert.equal(records.filter(r => r.method !== 'GET').length, 0);
});

for (const offline of [false, true]) test(`local auth: current business 401 readback ${offline ? 'retains offline identity' : 'clears an expired Core identity'} and keeps browser access`, async t => {
  let armed = false;
  const { page, records } = await fixture(t, r => {
    if (r.path === 'session') return { json: !armed ? signedIn() : offline ? { ...signedOut(), state: 'offline', lastKnownUser: { account: 'owner', role: 'user' } } : signedOut(2) };
    if (r.path === 'works' && armed) return { status: 401, json: { code: 'AUTH_REQUIRED' } };
  });
  await expect.poll(() => api(page, 'return !!adapter.worksChecked')).toBe(true); armed = true;
  const code = await api(page, `return adapter.request('works').catch(error => error.code)`);
  assert.equal(await api(page, 'return adapter.state.browserAccess'), 'authorized');
  assert.equal(await api(page, 'return adapter.state.signedIn'), offline);
  if (offline) {
    assert.equal(code, 'CORE_UNAVAILABLE'); assert.equal(await api(page, 'return adapter.state.core.account'), 'owner');
    await expect(page.locator('body')).toContainText('Core is unreachable');
  } else {
    assert.equal(code, 'AUTH_REQUIRED'); assert.equal(await api(page, 'return adapter.state.core.account'), '');
    await expect(page.getByRole('heading', { name: 'Connect to your Core' })).toBeVisible();
    assert.equal(await api(page, 'return adapter.state.works.length + adapter.state.operations.length'), 0);
  }
  assert.equal(records.filter(r => r.method !== 'GET').length, 0);
});

test('local auth: recovery commands and readonly check remain keyboard accessible without narrow overflow', async t => {
  const { page } = await fixture(t, r => r.path === 'session' ? denied : undefined);
  await expect(page.getByRole('heading', { name: 'Browser access required' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 850 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await button(page, 'copy-reopen-command').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#toast')).toContainText(/Copied|Clipboard unavailable/);
  assert.equal(await page.locator('[aria-live="polite"]').count() > 0, true);
});
