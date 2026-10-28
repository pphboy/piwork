import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium, expect, type Page, type Route } from '@playwright/test';

let browser: Awaited<ReturnType<typeof chromium.launch>>, base = '';
const server = createServer(async (request, response) => {
  const path = request.url?.startsWith('/desktop/browser/') ? '../browser/' + request.url.slice('/desktop/browser/'.length) : '../public/' + (request.url === '/style.css' ? 'style.css' : (request.url === '/piwork-logo.png' || request.url === '/desktop/piwork-logo.png') ? 'piwork-logo.png' : 'index.html');
  try { response.setHeader('Content-Type', path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.png') ? 'image/png' : 'text/html'); response.end(await readFile(new URL(path, import.meta.url))); }
  catch { response.writeHead(404); response.end(); }
});
before(async () => { await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const address = server.address(); assert(address && typeof address !== 'string'); base = `http://127.0.0.1:${address.port}`; browser = await chromium.launch(process.env.PIWORK_TEST_BROWSER_BIN ? { headless: true, executablePath: process.env.PIWORK_TEST_BROWSER_BIN } : { headless: true, channel: 'chromium' }); });
after(async () => { await browser.close(); await new Promise<void>(done => server.close(() => done())); });
type Record = { path: string; method: string; body: string; headers: { [key: string]: string } };
type Reply = { status?: number; json?: any; abort?: boolean };
const signedOut = (generation = 1, csrf = 'current-csrf') => ({ state: 'signed-out', coreUrl: 'http://core.test', generation, csrf });
const signedIn = (generation = 1, account = 'owner') => ({ ...signedOut(generation), state: 'authenticated', user: { account, role: 'user' } });
const denied = { status: 401, json: { code: 'LOCAL_AUTH_REQUIRED' } };
const pending = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(t: { after: (fn: () => Promise<void>) => void }, handler: (record: Record) => Reply | undefined | Promise<Reply | undefined>, ticket = '', hosted = false, clock = false, hash = '') {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); t.after(() => page.close()); page.setDefaultTimeout(5000);
  if (clock) await page.clock.install();
  const records: Record[] = [];
  await page.route('**/_desktop/api/**', async (route: Route) => {
    const record = { path: new URL(route.request().url()).pathname.slice('/_desktop/api/'.length), method: route.request().method(), body: route.request().postData() ?? '', headers: route.request().headers() }; records.push(record);
    let reply = await handler(record);
    reply ??= record.path === 'status' ? { json: { health: { available: true }, readiness: { available: true, value: { ready: true } } } } : record.path === 'works' ? { json: { works: [] } } : record.path === 'skills' ? { json: { skills: [] } } : record.path === 'packages' ? { json: { packages: [] } } : record.path === 'known-operations' ? { json: { operations: [] } } : { status: 404, json: { code: 'NOT_FOUND' } };
    if (reply.abort) await route.abort('failed'); else await route.fulfill({ status: reply.status ?? 200, contentType: 'application/json', body: JSON.stringify(reply.json ?? {}) });
  });
  if (hosted) await page.route(base + '/', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><meta name="piwork-mode" content="hosted">') });
  });
  await page.goto(base + (ticket ? '/#ticket=' + ticket : '/' + hash));
  return { page, records };
}
for (const hosted of [false, true]) test(`deep link uses neutral startup before ${hosted ? 'hosted' : 'native'} identity is confirmed`, async t => {
  const gate = pending(); t.after(async () => gate.resolve());
  const { page } = await fixture(t, async r => { if (r.path === 'session') { await gate.promise; return { json: signedIn() }; } }, '', hosted, false, '#/work/missing-work');
  await expect(page.locator('.app-loading')).toContainText('Opening Piwork');
  await expect(page.locator('[data-action="account"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Works', exact: true })).toHaveCount(0);
  gate.resolve(); await expect(button(page, 'retry-work-read')).toBeVisible();
});
const api = (page: Page, code: string): Promise<any> => page.evaluate(`(async () => { const { adapter } = await import('/desktop/browser/adapter.js'); ${code} })()`);
const button = (page: Page, action: string) => page.locator(`[data-action="${action}"]`).last();

test('local auth: checking is visible and valid Cookie discards an old ticket without bootstrap', async t => {
  const gate = pending(); t.after(async () => gate.resolve());
  const { page, records } = await fixture(t, async r => { if (r.path === 'session') { await gate.promise; return { json: signedIn() }; } }, 'used-or-expired');
  await expect(page.locator('.app-loading')).toContainText('Opening Piwork');
  assert.equal(await page.locator('[data-action="account"]').count(), 0);
  assert.equal(new URL(page.url()).hash, ''); gate.resolve();
  await expect(page.getByRole('heading', { name: 'Make room for your next idea' })).toBeVisible();
  assert.equal(records.filter(r => r.path === 'bootstrap').length, 0);
});
for (const ticket of ['', 'expired', 'replayed', 'prior-process']) test(`ordinary session: ${ticket || 'plain address'} opens normal sign-in without a gate`, async t => {
  const { page, records } = await fixture(t, r => r.path === 'session' ? { json: signedOut() } : undefined, ticket);
  await expect(page.getByRole('heading', { name: 'Connect to your Core' })).toBeVisible();
  await expect(button(page,'sign-in')).toBeVisible(); await expect(button(page,'import')).toBeVisible();
  assert.equal(new URL(page.url()).hash,'');
  assert.equal(records.filter(r=>r.method!=='GET').length,0);
  assert.equal(records.filter(r=>r.path==='bootstrap').length,0);
  await expect(page.locator('body')).not.toContainText('Browser access required');
  await expect(button(page,'check-browser-access')).toHaveCount(0);
  await expect(button(page,'reset-browser-access')).toHaveCount(0);
});
test('local auth: initial network failure does not exchange ticket; manual check and deduplicated reads recover', async t => {
  let online = false; const gate = pending(); t.after(async () => gate.resolve());
  const { page, records } = await fixture(t, async r => { if (r.path === 'session') { if (!online) return { abort: true }; await gate.promise; return { json: signedOut() }; } }, 'ticket');
  await expect(page.getByRole('heading', { name: 'Desktop connection unavailable' })).toBeVisible();
  online = true;
  const checked = api(page, 'await Promise.all([adapter.checkSession(), adapter.checkSession()])');
  await expect.poll(() => records.filter(r => r.path === 'session').length).toBe(2); gate.resolve(); await checked;
  await expect(page.getByRole('heading', { name: 'Connect to your Core' })).toBeVisible();
  assert.equal(records.filter(r => r.path === 'bootstrap').length, 0);
});
for (const hosted of [false, true]) test(`ordinary session: hung ${hosted ? 'hosted' : 'native'} initialization offers a fresh readonly retry after ten seconds`, async t => {
  const gate = pending(); t.after(async () => gate.resolve()); let reads = 0;
  const { page, records } = await fixture(t, async r => {
    if (r.path !== 'session') return;
    if (++reads === 1) { await gate.promise; return { json: signedIn(1, 'obsolete-owner') }; }
    return { json: signedIn(2, 'current-owner') };
  }, '', hosted, true);
  await expect(page.locator('.app-loading')).toContainText('Opening Piwork');
  await expect(button(page, 'retry-session')).toHaveCount(0);
  await page.clock.fastForward(10000);
  await expect(page.locator('body')).toContainText('The read timed out. The current state has not been confirmed.');
  await expect(button(page, 'retry-session')).toBeVisible();
  await button(page, 'retry-session').click();
  await expect(page.getByRole('heading', { name: 'Works', exact: true })).toBeVisible();
  assert(reads >= 2, 'retry reused the original hung read');
  gate.resolve();
  await expect.poll(() => api(page, 'return adapter.state.core.account')).toBe('current-owner');
  assert.equal(records.filter(r => r.method !== 'GET').length, 0);
  assert.equal(await page.getByRole('button', { name: 'Retry connection', exact: true }).count(), 0);
});
test('ordinary session: a timed-out startup read automatically retries without a write', async t => {
  const gate = pending(); t.after(async () => gate.resolve()); let reads = 0;
  const { page, records } = await fixture(t, async r => {
    if (r.path !== 'session') return;
    if (++reads === 1) { await gate.promise; return { json: signedIn(1, 'old-owner') }; }
    return { json: signedIn(2, 'current-owner') };
  }, '', false, true);
  await page.clock.fastForward(10000);
  await expect(page.locator('body')).toContainText('The read timed out');
  await page.clock.fastForward(1000);
  await expect(page.getByRole('heading', { name: 'Works', exact: true })).toBeVisible();
  gate.resolve();
  await expect.poll(() => api(page, 'return adapter.state.core.account')).toBe('current-owner');
  assert.equal(records.filter(r => r.method !== 'GET').length, 0);
});
test('ordinary session: hung automatic Cookie confirmation can be replaced without a mutation', async t => {
  const gate = pending(); t.after(async () => gate.resolve()); let reads = 0;
  const { page, records } = await fixture(t, async r => {
    if (r.path !== 'session') return;
    reads++;
    if (reads === 1) return { json: { ...signedOut(), sessionCreated: true } };
    if (reads === 2) { await gate.promise; return { json: signedIn(1, 'obsolete-owner') }; }
    return { json: signedOut(2, 'renewed-csrf') };
  }, '', false, true);
  await expect.poll(() => reads).toBe(2);
  await page.clock.fastForward(11000);
  await button(page, 'retry-session').click();
  await expect(page.getByRole('heading', { name: 'Connect to your Core' })).toBeVisible();
  gate.resolve();
  assert.equal(reads, 3);
  assert.equal(await api(page, 'return adapter.state.signedIn'), false);
  assert.equal(records.filter(r => r.method !== 'GET').length, 0);
});
test('ordinary session: creation verifies the automatic Cookie without an exchange', async t => {
  let reads=0;
  const {page,records}=await fixture(t,r=>r.path==='session'?{json:{...signedOut(),...(++reads===1?{sessionCreated:true}:{})}}:undefined);
  await expect(page.getByRole('heading',{name:'Connect to your Core'})).toBeVisible();
  assert.equal(records.filter(r=>r.path==='session').length,2);
  assert.equal(records.filter(r=>r.method!=='GET').length,0);
});
test('ordinary session: a lost read can retry without replaying a write',async t=>{
  let reads=0;
  const {page,records}=await fixture(t,r=>r.path==='session'?++reads===1?{abort:true}:{json:signedOut()}:undefined);
  await expect(page.getByRole('heading',{name:'Desktop connection unavailable'})).toBeVisible();
  await button(page,'retry-session').click();
  await expect(page.getByRole('heading',{name:'Connect to your Core'})).toBeVisible();
  assert.equal(records.filter(r=>r.method!=='GET').length,0);
});
test('a lost sign-in response is read back and never submitted automatically again', async t => {
  let sent = false, allowReadback = false;
  const { page, records } = await fixture(t, r => {
    if (r.path === 'session') return sent && !allowReadback ? { abort: true } : { json: signedOut() };
    if (r.path === 'login') { sent = true; return { abort: true }; }
  });
  await expect(button(page, 'sign-in')).toBeVisible();
  await page.getByLabel('Account', { exact: true }).fill('owner');
  await page.getByLabel('Password').fill('synthetic-password');
  await button(page, 'sign-in').click();
  await expect(page.locator('body')).toContainText('sign-in result is not confirmed');
  assert.equal(records.filter(r => r.path === 'login' && r.method === 'POST').length, 1);
  allowReadback = true;
  await button(page, 'retry-session').click();
  await expect(button(page, 'sign-in')).toBeEnabled();
  await expect(page.getByLabel('Account', { exact: true })).toHaveValue('owner');
  assert.equal(records.filter(r => r.path === 'login' && r.method === 'POST').length, 1);
});
test('ordinary session: blocked Cookies and capacity show connection diagnostics without Access',async t=>{
  for(const capacity of [false,true]) {
    const {page,records}=await fixture(t,r=>r.path==='session'?capacity?{status:503,json:{code:'LOCAL_SESSION_CAPACITY'}}:{json:{...signedOut(),sessionCreated:true}}:undefined);
    await expect(page.getByRole('heading',{name:'Desktop connection unavailable'})).toBeVisible();
    await expect(page.locator('body')).toContainText(capacity?'128 active browser sessions':'did not retain its session Cookie');
    await expect(page.locator('body')).not.toContainText('Browser access required');
    await expect(button(page,'reset-browser-access')).toHaveCount(0);
    assert.equal(records.filter(r=>r.path==='session').length,capacity?1:2);
    assert.equal(records.filter(r=>r.method!=='GET').length,0);
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
  assert.equal(await api(page, 'return adapter.state.sessionState'), 'ready');
  assert.equal(records.filter(r => r.path === 'login').length, 1);
  assert.equal(records.filter(r => r.path === 'session').length, 2);
});
test('local auth: offline Core retains its normal session and last known identity', async t => {
  const { page } = await fixture(t, r => r.path === 'session' ? { json: { ...signedOut(), state: 'offline', lastKnownUser: { account: 'owner', role: 'user' }, lastConfirmedAt: '2026-10-03T00:00:00Z' } } : r.path === 'status' ? { json: { health: { available: false } } } : undefined);
  await expect(page.locator('body')).toContainText('Core is unreachable');
  assert.equal(await api(page, 'return adapter.state.sessionState'), 'ready');
  assert.equal(await page.locator('[data-action="account"]').count(), 1);
});
test('ordinary session: the account menu has normal sign-out and no browser reset', async t => {
  let signed=true;const gate=pending();t.after(async()=>gate.resolve());
  const {page,records}=await fixture(t,async r=>{
    if(r.path==='session')return {json:signed?signedIn():signedOut(2)};
    if(r.path==='logout'){await gate.promise;signed=false;return {json:{view:signedOut(2),localCleared:true,credentialCleared:true,remoteRevocationConfirmed:true}};}
  });
  await expect(button(page,'account')).toBeVisible();await button(page,'account').click();
  await expect(button(page,'reset-browser-access')).toHaveCount(0);
  await button(page,'sign-out').click();
  await expect(button(page,'sign-out')).toBeDisabled();
  assert.equal(records.filter(r=>r.path==='logout').length,1);gate.resolve();
  await expect(page.getByRole('heading',{name:'Connect to your Core'})).toBeVisible();
  await expect(button(page,'sign-in')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Browser access required');
});
test('ordinary session: sign-out reports pending saved-credential cleanup', async t => {
  const {page}=await fixture(t,r=>r.path==='session'?{json:signedIn()}:r.path==='logout'?{json:{view:{...signedOut(2),cleanupRequired:true},localCleared:true,credentialCleared:false,remoteRevocationConfirmed:false}}:undefined);
  await expect(button(page,'account')).toBeVisible();await button(page,'account').click();await button(page,'sign-out').click();
  await expect(page.getByRole('heading',{name:'Connect to your Core'})).toBeVisible();
  await expect(page.locator('body')).toContainText('saved credential cleanup is incomplete');
  assert.equal(await api(page,'return adapter.state.sessionState'),'ready');
});
test('local auth: an old session read cannot overwrite a new account or release a new identity lock', async t => {
  const gate = pending(); t.after(async () => gate.resolve()); let armed = false, held = false, loggedIn = false;
  const { page, records } = await fixture(t, async r => {
    if (r.path === 'session') {
      if (armed && !held) { held = true; await gate.promise; return { json: signedOut(1) }; }
      return { json: loggedIn ? signedIn(2, 'new-owner') : signedOut(1) };
    }
    if (r.path === 'login') { loggedIn = true; return { json: signedIn(2, 'new-owner') }; }
  });
  await expect(button(page, 'sign-in')).toBeVisible(); armed = true;
  const old = api(page, 'await adapter.checkSession().catch(() => undefined)');
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
  const old = api(page, 'await adapter.checkSession().catch(() => undefined)');
  await expect.poll(() => held).toBe(true);
  await api(page, `await adapter.signIn('http://core.test', 'new-owner', 'secret')`);
  await expect.poll(() => records.filter(r => r.path === 'session').length).toBe(before + 2);
  oldGate.resolve(); await old;
  await api(page, 'void adapter.checkSession().catch(() => undefined)');
  assert.equal(records.filter(r => r.path === 'session').length, before + 2);
  freshGate.resolve();
  await expect.poll(() => api(page, 'return !!adapter.worksChecked')).toBe(true);
  assert.notEqual(await api(page, 'return adapter.state.scenario'), 'list-error');
});
test('local auth: a delayed business 401 readback cannot abandon a newer new initialization', async t => {
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
  await expect(page.locator('body')).toContainText('Core is unreachable');
  await expect.poll(() => api(page, 'return !!adapter.worksChecked')).toBe(true);
  const initialWorksReads = records.filter(r => r.path === 'works').length;
  assert.equal(initialWorksReads, 1, 'initial authenticated list must finish before the delayed 401 is armed');
  armed = true;
  const epoch = await api(page, 'return adapter.identityEpoch');
  const originalRead = api(page, `return adapter.request('works').catch(error => error.code)`);
  await expect.poll(() => readbacks).toBe(1);
  const reopen = api(page, 'await adapter.initialize()');
  await expect.poll(() => freshStarted).toBe(true);
  oldReadback.resolve(); assert.equal(await originalRead, 'CONNECTION_CHANGED');
  assert.equal(await api(page, 'return adapter.identityEpoch'), epoch);
  freshSession.resolve(); await reopen;
  await expect(page.getByRole('heading', { name: 'Connect to your Core' })).toBeVisible();
  assert.equal(await api(page, 'return adapter.state.sessionState'), 'ready');
  assert.equal(records.filter(r => r.path === 'works').length, initialWorksReads + 1, 'only the explicit business read may run; stale/new initialization must not add a list read');
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
  assert.equal(await api(page, 'return adapter.state.sessionState'), 'ready');
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
  await expect(button(page, 'retry-session')).toBeEnabled();
  await button(page, 'retry-session').click();
  await expect(page.getByRole('heading', { name: 'Connect to your Core' })).toBeVisible();
  assert.equal(records.filter(r => r.method !== 'GET').length, 0);
});

for (const offline of [false, true]) test(`local auth: current business 401 readback ${offline ? 'retains offline identity' : 'clears an expired Core identity'} and keeps normal sign-in`, async t => {
  let armed = false;
  const { page, records } = await fixture(t, r => {
    if (r.path === 'session') return { json: !armed ? signedIn() : offline ? { ...signedOut(), state: 'offline', lastKnownUser: { account: 'owner', role: 'user' } } : signedOut(2) };
    if (r.path === 'works' && armed) return { status: 401, json: { code: 'AUTH_REQUIRED' } };
  });
  await expect.poll(() => api(page, 'return !!adapter.worksChecked && !adapter.connectionRequest && !adapter.authCheck')).toBe(true); armed = true;
  const code = await api(page, `return adapter.request('works').catch(error => error.code)`);
  assert.equal(await api(page, 'return adapter.state.sessionState'), 'ready');
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

test('ordinary session: connection retry is keyboard accessible without narrow overflow',async t=>{
  let online=false;
  const {page}=await fixture(t,r=>r.path==='session'?online?{json:signedOut()}:{abort:true}:undefined);
  await expect(page.getByRole('heading',{name:'Desktop connection unavailable'})).toBeVisible();
  await page.setViewportSize({width:390,height:850});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  online=true;await button(page,'retry-session').focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('heading',{name:'Connect to your Core'})).toBeVisible();
});

for (const rejectedCode of ['LOCAL_CSRF_OR_AUTH_REQUIRED', 'LOCAL_AUTH_REQUIRED']) test(`Reconcile auth: an old ${rejectedCode} rejection cannot supersede a newer initialization`, async t => {
  const rejected = pending(), fresh = pending();
  let armed = false, entered = false, sessionReads = 0;
  t.after(() => { rejected.resolve(); fresh.resolve(); });
  const { page, records } = await fixture(t, async r => {
    if (r.path === 'session') {
      if (!armed) return { json: signedIn() };
      if (++sessionReads === 1) { entered = true; await fresh.promise; return { json: signedOut(2) }; }
      return { json: signedIn() };
    }
    if (r.path === 'status') return { json: { health: { available: false } } };
    if (r.path === 'old-mutation') {
      await rejected.promise;
      return { status: rejectedCode === 'LOCAL_AUTH_REQUIRED' ? 401 : 403, json: { code: rejectedCode } };
    }
  });
  await expect(page.locator('body')).toContainText('Core is unreachable');
  armed = true;
  const original = api(page, "return adapter.request('old-mutation', 'POST').catch(error => error.code)");
  await expect.poll(() => records.some(r => r.path === 'old-mutation')).toBe(true);
  const reopen = api(page, 'await adapter.initialize()');
  await expect.poll(() => entered).toBe(true);
  rejected.resolve();
  assert.equal(await original, 'CONNECTION_CHANGED');
  assert.equal(sessionReads, 1, 'old rejection started a competing session check');
  fresh.resolve(); await reopen;
  await expect(page.getByRole('heading', { name: 'Connect to your Core' })).toBeVisible();
  assert.equal(await api(page, 'return adapter.state.sessionState'), 'ready');
  assert.equal(await api(page, 'return adapter.state.signedIn'), false);
  assert.equal(records.filter(r => r.path === 'old-mutation').length, 1);
  assert.equal(records.filter(r => r.path === 'bootstrap' || r.path === 'login').length, 0);
});

test('Reconcile auth: an obsolete CSRF readback is discarded after initialization takes ownership', async t => {
  const stale = pending(), fresh = pending();
  let armed = false, sessionReads = 0;
  t.after(() => { stale.resolve(); fresh.resolve(); });
  const { page, records } = await fixture(t, async r => {
    if (r.path === 'session') {
      if (!armed) return { json: signedIn() };
      if (++sessionReads === 1) { await stale.promise; return { json: signedOut(2) }; }
      await fresh.promise; return { json: signedOut(2) };
    }
    if (r.path === 'status') return { json: { health: { available: false } } };
    if (r.path === 'old-mutation') return { status: 403, json: { code: 'LOCAL_CSRF_OR_AUTH_REQUIRED' } };
  });
  await expect(page.locator('body')).toContainText('Core is unreachable'); armed = true;
  const original = api(page, "return adapter.request('old-mutation','POST').catch(error=>error.code)");
  await expect.poll(() => sessionReads).toBe(1);
  const reopen = api(page, 'await adapter.initialize()');
  await expect.poll(() => sessionReads).toBe(2);
  stale.resolve(); assert.equal(await original, 'CONNECTION_CHANGED');
  fresh.resolve(); await reopen;
  await expect(page.getByRole('heading', { name: 'Connect to your Core' })).toBeVisible();
  assert.equal(await api(page, 'return adapter.state.sessionState'), 'ready');
  assert.equal(records.filter(r => r.path === 'old-mutation').length, 1);
  assert.equal(records.filter(r => r.path === 'bootstrap' || r.path === 'login').length, 0);
});

test('pending Core: initial and manual checks have one local indicator, end on failure and do not claim to start Core', async t => {
  let statusCalls = 0, fail = false; const first = pending(), manual = pending(); t.after(async () => { first.resolve(); manual.resolve(); });
  const { page, records } = await fixture(t, async r => {
    if (r.path === 'session') return { json: signedIn() };
    if (r.path === 'status') { statusCalls++; await (statusCalls === 1 ? first.promise : manual.promise); return fail ? { status: 503, json: { message: 'Connection test failed' } } : { json: { health: { available: true }, readiness: { available: true, value: { ready: true } } } }; }
  });
  await expect(button(page, 'connection').locator('.pending-dots')).toHaveCount(1);
  await expect(page.locator('.loading-list .skeleton')).toHaveCount(3); await expect(page.locator('.loading-list')).toHaveText('');
  await expect(page.locator('.pending-dots')).toHaveCount(1);
  await expect(button(page, 'connection')).not.toContainText('Connected');
  await expect(page.locator('.works-footer')).toContainText('Works not yet read');
  await expect(page.locator('.works-footer')).not.toContainText('0 Works');
  if (process.env.PIWORK_UI_EVIDENCE === '1') {
    await expect(page.locator('.brand-logo')).toHaveJSProperty('complete', true);
    await expect.poll(() => page.locator('.brand-logo').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await mkdir('dist/server-ui-core-flow/desktop', { recursive: true });
    await page.screenshot({ path: 'dist/server-ui-core-flow/desktop/core-checking-fixture-wide.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'dist/server-ui-core-flow/desktop/core-checking-fixture-narrow.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await expect(page.locator('#app')).not.toContainText('Starting Core');
  const checking = api(page, 'await Promise.all([adapter.checkConnection(), adapter.checkConnection()])');
  first.resolve(); await checking; await expect(button(page, 'connection')).toContainText('Connected');
  await expect(page.locator('.works-footer')).toContainText('0 Works');
  await expect(page.locator('.works-footer')).not.toContainText('Works not yet read');
  assert.equal(records.filter(r => r.path === 'status').length, 1);
  await button(page, 'connection').click(); fail = true; await button(page, 'check-connection').click();
  await expect(page.locator('#modal .pending-dots')).toHaveCount(1);
  manual.resolve(); await expect(page.locator('#modal')).toContainText('Connection test failed');
  await expect(page.locator('#modal .pending-dots')).toHaveCount(0); await expect(button(page, 'check-connection')).toBeEnabled();
  assert.equal(records.filter(r => r.path === 'status').length, 2);
});

async function captureWorksEvidence(page: Page, name: string) {
  // Capture the stable page after its existing transient toast naturally ends.
  if (process.env.PIWORK_UI_EVIDENCE === '1') await expect(page.locator('#toast')).not.toHaveClass(/visible/);
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await expect(page.locator('.connection > .pending-icon-slot > i')).toHaveCount(1);
    if (process.env.PIWORK_UI_EVIDENCE === '1') {
      await expect.poll(() => page.locator('.brand-logo').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
      await mkdir('dist/server-ui-core-flow/desktop', { recursive: true });
      await page.screenshot({ path: `dist/server-ui-core-flow/desktop/${name}-${width}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test('Works first-read static skeleton stays visible without duplicate pending or unknown zero count', async t => {
  const first = pending(); t.after(async () => first.resolve());
  const { page, records } = await fixture(t, async r => {
    if (r.path === 'session') return { json: signedIn() };
    if (r.path === 'works') { await first.promise; return { json: { works: [] } }; }
  });
  await expect.poll(() => records.filter(r => r.path === 'works').length).toBeGreaterThan(0);
  const skeleton = page.locator('.loading-list');
  await expect(skeleton).toBeVisible(); await expect(skeleton).toHaveAttribute('aria-label', 'Loading your Works');
  await expect(skeleton).toHaveAttribute('aria-busy', 'true'); await expect(skeleton).toHaveText('');
  await expect(skeleton.locator('.skeleton')).toHaveCount(3); await expect(page.locator('.pending-dots')).toHaveCount(0);
  await expect(page.locator('.works-footer')).toContainText('Works not yet read');
  await expect(page.locator('.works-footer')).not.toContainText('0 Works');
  await expect(page.getByRole('heading', { name: 'Make room for your next idea' })).toHaveCount(0);
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    const style = await skeleton.locator('.skeleton').first().evaluate(row => ({ animation: getComputedStyle(row).animationName, opacity: getComputedStyle(row).opacity, fill: getComputedStyle(row.querySelector('i')!).backgroundColor, surface: getComputedStyle(row.parentElement!).backgroundColor }));
    assert.equal(style.animation, 'none'); assert.equal(style.opacity, '1'); assert.notEqual(style.fill, style.surface);
    const before = await skeleton.boundingBox(); await page.waitForTimeout(250); assert.deepEqual(await skeleton.boundingBox(), before);
    await captureWorksEvidence(page, `works-initial-skeleton-${reducedMotion}`);
  }
  first.resolve();
  await expect(page.getByRole('heading', { name: 'Make room for your next idea' })).toBeVisible();
  await expect(skeleton).toHaveCount(0); await expect(page.locator('.works-footer')).toContainText('0 Works');
  assert.equal(records.filter(r => r.method !== 'GET').length, 0);
});

test('Works initial error has one cause and retry; retries stay local and confirmed-empty refresh failures remain visible', async t => {
  const failedRetry = pending(), successfulRetry = pending(); t.after(async () => { failedRetry.resolve(); successfulRetry.resolve(); });
  let mode = 'initial';
  const longError = `Retry unavailable: ${'upstream-'.repeat(32)}<script>not executed</script>`;
  const { page, records } = await fixture(t, async r => {
    if (r.path === 'session') return { json: signedIn() };
    if (r.path !== 'works') return;
    if (mode === 'retry-failure') { await failedRetry.promise; return { status: 503, json: { message: longError } }; }
    if (mode === 'retry-success') { await successfulRetry.promise; return { json: { works: [] } }; }
    return { status: 503, json: { message: mode === 'refresh-failure' ? 'Confirmed empty list refresh unavailable' : 'Initial Works read unavailable' } };
  });
  await expect(page.getByRole('heading', { name: 'Works could not be loaded' })).toBeVisible();
  await expect.poll(() => records.filter(r => r.path === 'works').length).toBeGreaterThan(0);
  await expect.poll(() => api(page, 'return !adapter.worksLoading && !adapter.connectionRequest;')).toBe(true);
  await expect(page.locator('.works-error-cause')).toContainText('Initial Works read unavailable');
  await expect(page.getByRole('button', { name: 'Retry loading', exact: true })).toHaveCount(1);
  await expect(page.locator('.works-page > .feedback')).toHaveCount(0); await expect(page.locator('.pending-dots')).toHaveCount(0);
  await expect(page.locator('.works-footer')).toContainText('Works not yet read');
  await captureWorksEvidence(page, 'works-initial-error');
  const initialReads = records.filter(r => r.path === 'works').length;
  mode = 'retry-failure'; await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reading Works…', exact: true })).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.page-heading .pending-dots')).toHaveCount(1); await expect(page.locator('.pending-dots')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Retry loading', exact: true })).toBeDisabled();
  await expect(page.locator('.loading-list')).toHaveCount(0); await expect(page.locator('.works-page > .feedback')).toHaveCount(0);
  await page.locator('[data-action="retry-works"]').evaluateAll(nodes => nodes.forEach(node => (node as HTMLButtonElement).click()));
  assert.equal(records.filter(r => r.path === 'works').length, initialReads + 1);
  await captureWorksEvidence(page, 'works-initial-error-retrying');
  failedRetry.resolve(); await expect(page.locator('.works-error-cause')).toContainText(longError);
  await expect(page.locator('.works-page script')).toHaveCount(0); await expect(page.locator('.pending-dots')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry loading', exact: true })).toBeEnabled();
  await expect(page.locator('.works-page > .feedback')).toHaveCount(0);
  await captureWorksEvidence(page, 'works-initial-error-long');
  await page.setViewportSize({ width: 360, height: 900 });
  assert.equal(await page.locator('.works-error-cause').evaluate(node => node.scrollWidth <= node.clientWidth), true);
  mode = 'retry-success'; await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
  await expect(page.locator('.page-heading .pending-dots')).toHaveCount(1); successfulRetry.resolve();
  await expect(page.getByRole('heading', { name: 'Make room for your next idea' })).toBeVisible();
  await expect(page.locator('.works-error-cause')).toHaveCount(0); await expect(page.locator('.pending-dots')).toHaveCount(0);
  await expect(page.locator('.works-footer')).toContainText('0 Works');
  mode = 'refresh-failure'; await page.getByRole('button', { name: 'Refresh Works', exact: true }).click();
  await expect(page.locator('.works-page > .feedback')).toContainText('Works could not be refreshed.');
  await expect(page.locator('.works-page > .feedback')).toContainText('Confirmed empty list refresh unavailable');
  await expect(page.getByRole('heading', { name: 'Make room for your next idea' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Works could not be loaded' })).toHaveCount(0);
  await expect(page.locator('.loading-list')).toHaveCount(0); await expect(page.locator('.pending-dots')).toHaveCount(0);
  await captureWorksEvidence(page, 'works-confirmed-empty-refresh-error');
  assert.equal(records.filter(r => r.method !== 'GET').length, 0);
});


test('Works failed initial Core check leaves an unconfirmed list with explicit read recovery', async t => {
  const { page, records } = await fixture(t, r => {
    if (r.path === 'session') return { json: signedIn() };
    if (r.path === 'status') return { status: 503, json: { message: 'Initial Core check unavailable' } };
  });
  await expect(page.getByRole('heading', { name: 'Works have not been read' })).toBeVisible();
  await expect.poll(() => api(page, 'return !adapter.connectionCheck.checking && !adapter.connectionRequest;')).toBe(true);
  await expect(page.getByRole('heading', { name: 'No matching Works' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Make room for your next idea' })).toHaveCount(0);
  await expect(page.locator('.works-footer')).toContainText('Works not yet read');
  await expect(page.locator('.loading-list')).toHaveCount(0); await expect(page.locator('.pending-dots')).toHaveCount(0);
  assert.equal(records.filter(r => r.path === 'works').length, 0);
  await captureWorksEvidence(page, 'works-unconfirmed-core-error');
  await page.getByRole('button', { name: 'Read Works', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make room for your next idea' })).toBeVisible();
  await expect(page.locator('.works-footer')).toContainText('0 Works');
  assert.equal(records.filter(r => r.path === 'works').length, 1);
  assert.equal(records.filter(r => r.method !== 'GET').length, 0);
});
