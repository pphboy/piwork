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
before(async () => { await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const address = server.address(); assert(address && typeof address !== 'string'); base = `http://127.0.0.1:${address.port}`; browser = await chromium.launch(process.env.PIWORK_TEST_BROWSER_BIN ? { headless: true, executablePath: process.env.PIWORK_TEST_BROWSER_BIN } : { headless: true, channel: 'chromium' }); });
after(async () => { await browser.close(); await new Promise<void>(done => server.close(() => done())); });
type Record = { path: string; method: string; body: string; headers: { [key: string]: string } };
type Reply = { status?: number; json?: any; abort?: boolean };
const signedOut = (generation = 1, csrf = 'current-csrf') => ({ state: 'signed-out', coreUrl: 'https://current.example', generation, csrf });
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

test('default Core: first read, offline save, late input and independent current connection', async t => {
  let saved: string|null = null; const gate = pending(); t.after(async () => gate.resolve());
  const { page, records } = await fixture(t, async r => {
    if (r.path === 'session') return { json: signedOut() };
    if (r.path === 'preferences') {
      if (r.method === 'PUT') { await gate.promise; saved = JSON.parse(r.body).coreUrl; }
      return { json: { coreUrl: saved } };
    }
  });
  await expect(page.locator('.default-core-preferences')).toContainText('Not set');
  await page.locator('#auth-core').fill('http://remote.example');
  await button(page,'save-default-core').click();
  await expect(button(page,'save-default-core')).toBeDisabled();
  await expect(button(page,'clear-default-core')).toBeDisabled();
  await expect(button(page,'sign-in')).toBeEnabled();
  await page.locator('#auth-core').fill('https://later-input.example');
  gate.resolve();
  await expect(page.locator('.default-core-preferences')).toContainText('http://remote.example');
  await expect(page.locator('#auth-core')).toHaveValue('https://later-input.example');
  assert.equal(await api(page, 'return adapter.state.core.address'), 'https://current.example');
  assert.equal(records.filter(r => ['login','connection'].includes(r.path)).length,0);
  assert.equal(records.filter(r => r.path === 'preferences' && r.method === 'PUT').length,1);
});

test('default Core: lost mutation reply stays protected until successful readonly confirmation', async t => {
  let saved: string|null = null, readFails = false;
  const { page, records } = await fixture(t, r => {
    if (r.path === 'session') return { json: signedOut() };
    if (r.path === 'preferences') {
      if (r.method === 'PUT') { saved = JSON.parse(r.body).coreUrl; readFails = true; return { abort:true }; }
      if (r.method === 'DELETE') { saved = null; return { json:{coreUrl:null} }; }
      return readFails ? { status:500,json:{code:'DESKTOP_PREFERENCES_UNAVAILABLE'} } : { json:{coreUrl:saved} };
    }
  });
  await expect(page.locator('.default-core-preferences')).toContainText('Not set');
  await page.locator('#auth-core').fill('http://saved.example');
  await button(page,'save-default-core').click();
  await expect(page.locator('.default-core-preferences')).toContainText('not yet confirmed');
  await button(page,'read-default-core').click();
  await expect(button(page,'save-default-core')).toBeDisabled();
  assert.equal(records.filter(r=>r.method==='PUT').length,1);
  readFails=false;
  await page.locator('#auth-core').fill('https://draft-kept.example');
  await button(page,'read-default-core').click();
  await expect(button(page,'save-default-core')).toBeEnabled();
  await expect(page.locator('#auth-core')).toHaveValue('https://draft-kept.example');
  await button(page,'clear-default-core').click();
  await expect(page.locator('.default-core-preferences')).toContainText('Not set');
  assert.equal(records.find(r=>r.method==='DELETE')?.body,'');
  assert.equal(await api(page,'return adapter.state.core.address'),'https://current.example');
});

test('default Core: read failure retains confirmed value and invalid input never writes', async t => {
  let fail=false;
  const { page, records } = await fixture(t,r=>r.path==='session'?{json:signedOut()}:r.path==='preferences'?fail?{status:500,json:{code:'DESKTOP_PREFERENCES_UNAVAILABLE'}}:{json:{coreUrl:'http://saved.example'}}:undefined);
  await expect(page.locator('.default-core-preferences')).toContainText('http://saved.example');
  fail=true; await button(page,'read-default-core').click();
  await expect(page.locator('.default-core-preferences')).toContainText('http://saved.example');
  await expect(page.locator('.default-core-preferences')).toContainText('unavailable');
  await page.locator('#auth-core').fill('http://remote.example/path');
  await button(page,'save-default-core').click();
  await expect(page.locator('.default-core-preferences')).toContainText('HTTP(S) Core origin without credentials, a path, query, or fragment');
  await expect(page.locator('#auth-core')).toHaveValue('http://remote.example/path');
  assert.equal(records.filter(r=>r.method==='PUT').length,0);
});

test('default Core: slow confirmation remains usable and success notice expires', async t => {
  const gate = pending(); t.after(async()=>gate.resolve());
  const { page } = await fixture(t,async r=>r.path==='session'?{json:signedOut()}:r.path==='preferences'?r.method==='PUT'?(await gate.promise,{json:{coreUrl:'http://remote.example'}}):{json:{coreUrl:null}}:undefined);
  await expect(page.locator('.default-core-preferences')).toContainText('Not set');
  await page.clock.install();
  await page.locator('#auth-core').fill('http://remote.example');
  await button(page,'save-default-core').click();
  await page.clock.fastForward(10001);
  await expect(page.locator('.default-core-preferences')).toContainText('Still waiting');
  await expect(button(page,'sign-in')).toBeEnabled();
  gate.resolve();
  await expect(page.locator('.default-core-preferences')).toContainText('Default Core saved for next launch.');
  await page.clock.fastForward(3001);
  await expect(page.locator('.default-core-preferences')).not.toContainText('Default Core saved for next launch.');
  await expect(page.locator('.default-core-preferences')).toContainText('http://remote.example');
});

test('default Core: an old GET cannot replace a newer successful save', async t => {
  let reads=0; const gate=pending(); t.after(async()=>gate.resolve());
  const {page}=await fixture(t,async r=>{
    if(r.path==='session')return {json:signedOut()};
    if(r.path==='preferences'){
      if(r.method==='GET'&&++reads===2){await gate.promise;return {json:{coreUrl:'https://old.example'}};}
      return {json:{coreUrl:r.method==='PUT'?'https://new.example':null}};
    }
  });
  await expect(page.locator('.default-core-preferences')).toContainText('Not set');
  await api(page,'window.oldPreferenceRead = adapter.loadPreferences();');
  await expect.poll(()=>reads).toBe(2);
  await api(page,"await adapter.savePreferences('https://new.example');");
  gate.resolve(); await api(page,'await window.oldPreferenceRead;');
  assert.equal(await api(page,'return adapter.preferences.coreUrl'),'https://new.example');
});

test('default Core: independent instances read the latest value and unknown commit requires GET', async t => {
  let saved:string|null=null, unknown=false;
  const handler=(r:Record):Reply|undefined=>{
    if(r.path==='session')return {json:signedOut()};
    if(r.path==='preferences'){
      if(r.method==='PUT'){saved=JSON.parse(r.body).coreUrl;if(unknown)return {status:500,json:{code:'DESKTOP_PREFERENCES_OUTCOME_UNKNOWN'}};}
      if(r.method==='DELETE')saved=null;
      return {json:{coreUrl:saved}};
    }
  };
  const a=await fixture(t,handler),b=await fixture(t,handler);
  await expect(a.page.locator('.default-core-preferences')).toContainText('Not set');
  await expect(b.page.locator('.default-core-preferences')).toContainText('Not set');
  await api(a.page,"await adapter.savePreferences('https://from-a.example');");
  await api(b.page,'await adapter.loadPreferences();');
  assert.equal(await api(b.page,'return adapter.preferences.coreUrl'),'https://from-a.example');
  unknown=true; await api(b.page,"await adapter.savePreferences('https://from-b.example');");
  assert.equal(await api(b.page,'return adapter.preferences.phase'),'unconfirmed');
  await api(b.page,'await adapter.savePreferences(null);');
  assert.equal(b.records.filter(r=>r.method==='DELETE').length,0);
  await api(b.page,'await adapter.loadPreferences();');
  assert.equal(await api(b.page,'return adapter.preferences.phase'),'idle');
  await api(a.page,'await adapter.loadPreferences();');
  assert.equal(await api(a.page,'return adapter.preferences.coreUrl'),'https://from-b.example');
  assert.equal(await api(a.page,'return adapter.state.core.address'),'https://current.example');
});

test('default Core: save and same-Core first login retain the actual anonymous Inspect', async t => {
  let loggedIn=false;
  const {page,records}=await fixture(t,r=>{
    if(r.path==='session')return {json:loggedIn?signedIn(2):signedOut()};
    if(r.path==='login'){loggedIn=true;return {json:signedIn(2)};}
    if(r.path==='preferences')return {json:{coreUrl:r.method==='PUT'?'http://remote.example':null}};
    if(r.path==='work-packages'&&r.method==='POST')return {json:{transferId:r.headers['x-piwork-transfer-id'],summary:{name:'Inspected locally',size:8}}};
  });
  await expect(page.locator('.default-core-preferences')).toContainText('Not set');
  const transfer=await api(page,"return await adapter.inspectWork(new File(['fixture!'],'private.work'));");
  await api(page,"await adapter.savePreferences('http://remote.example'); await adapter.signIn(adapter.state.core.address,'owner','fixture');");
  assert.deepEqual(await api(page,'return {id:adapter.inspectionTransfer,summary:adapter.inspection,anonymous:adapter.inspectionContext.anonymous}'),{id:transfer,summary:{name:'Inspected locally',size:8},anonymous:false});
  assert.equal(records.filter(r=>r.path==='connection'||r.path==='work-imports'||r.method==='DELETE').length,0);
  assert.equal(records.filter(r=>r.path==='work-packages'&&r.method==='POST').length,1);
});


test('current connection: remote HTTP switch uses the selected origin without changing the saved default', async t => {
  const {page,records}=await fixture(t,r=>{
    if(r.path==='session')return {json:signedOut()};
    if(r.path==='preferences')return {json:{coreUrl:'https://saved.example'}};
    if(r.path==='connection')return {json:{...signedOut(2),coreUrl:JSON.parse(r.body).coreUrl}};
  });
  await expect(page.locator('.default-core-preferences')).toContainText('https://saved.example');
  await api(page,"await adapter.switchCore('http://192.168.14.134:7171');");
  assert.equal(await api(page,'return adapter.state.core.address'),'http://192.168.14.134:7171');
  assert.deepEqual(records.filter(r=>r.path==='connection').map(r=>({method:r.method,body:JSON.parse(r.body)})),[{method:'PUT',body:{coreUrl:'http://192.168.14.134:7171'}}]);
  assert.equal(records.filter(r=>r.path==='login'||r.path==='preferences'&&r.method!=='GET').length,0);
  assert.equal(await api(page,'return adapter.preferences.coreUrl'),'https://saved.example');
});
