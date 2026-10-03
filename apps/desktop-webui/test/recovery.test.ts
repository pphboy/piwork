import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium, expect, type Page, type Route } from '@playwright/test';

let browser: Awaited<ReturnType<typeof chromium.launch>>;
let base = '';
const server = createServer(async (request, response) => {
  const path = request.url?.startsWith('/desktop/browser/') ? '../browser/' + request.url.slice('/desktop/browser/'.length) : '../public/' + (request.url === '/style.css' ? 'style.css' : 'index.html');
  try { response.setHeader('Content-Type', path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html'); response.end(await readFile(new URL(path, import.meta.url))); }
  catch { response.writeHead(404); response.end(); }
});
before(async () => { await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const address = server.address(); assert(address && typeof address !== 'string'); base = `http://127.0.0.1:${address.port}`; browser = await chromium.launch({ headless: true, channel: 'chromium' }); });
after(async () => { await browser.close(); await new Promise<void>(done => server.close(() => done())); });

type RequestRecord = { bytes?: Buffer | null; path: string; method: string; headers: Record<string, string>; body: string };
type Reply = { status?: number; json?: unknown; body?: string; headers?: Record<string, string>; abort?: boolean };
const mtime1 = 'Sat, 03 Oct 2026 01:00:00 GMT';
const mtime2 = 'Sat, 03 Oct 2026 01:00:02 GMT';
const mtime3 = 'Sat, 03 Oct 2026 01:00:04 GMT';
async function fixture(t: { after: (fn: () => Promise<void>) => void }, handler: (record: RequestRecord) => Reply | undefined | Promise<Reply | undefined>, anonymous = false) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); t.after(() => page.close());
  const requests: RequestRecord[] = [];
  let generation = 1, signedIn = !anonymous, core = 'http://core.test';
  let desired: Record<string, any> = { skills: ['saved'], packages: [{ name: 'pkg', enabled: true }], agentsMd: 'saved agents', modelRef: 'original', mcp: { servers: [] } };
  const session = () => ({ state: signedIn ? 'authenticated' : 'signed-out', generation, csrf: 'local-session-csrf', coreUrl: core, ...(signedIn ? { user: { account: 'owner', role: 'user' } } : {}) });
  await page.route('**/_desktop/**', async (route: Route) => {
    const r: RequestRecord = { path: new URL(route.request().url()).pathname.replace('/_desktop/api/', ''), method: route.request().method(), bytes: route.request().postDataBuffer(), headers: route.request().headers(), body: route.request().postData() ?? '' }; requests.push(r);
    let reply = await handler(r);
    if (!reply) {
      if (r.path === 'session') reply = { json: session() };
      else if (r.path === 'login') { signedIn = true; generation++; reply = { json: session() }; }
      else if (r.path === 'connection') { core = JSON.parse(r.body).coreUrl; signedIn = false; generation++; reply = { json: session() }; }
      else if (r.path === 'logout') { signedIn = false; generation++; reply = { json: { view: session(), remoteRevocationConfirmed: true } }; }
      else if (r.path === 'status') reply = { json: { health: { available: true }, readiness: { available: true, value: { ready: true } } } };
      else if (r.path === 'works') reply = { json: { works: [{ id: 'work-1', name: 'Recovery Work', observedState: 'ready', desiredState: 'running' }] } };
      else if (r.path === 'works/work-1') reply = { json: { id: 'work-1', name: 'Recovery Work', observedState: 'ready', desiredState: 'running' } };
      else if (r.path === 'skills') reply = { json: { skills: [{ name: 'saved' }, { name: 'new' }] } };
      else if (r.path === 'packages') reply = { json: { packages: [{ name: 'pkg' }, { name: 'new-pkg' }] } };
      else if (r.path === 'known-operations') reply = { json: { operations: [] } };
      else if (r.path === 'works/work-1/configuration') { if (r.method === 'PUT') desired = JSON.parse(r.body).configuration; reply = { json: { desired, active: desired, pendingApply: false, runtime: { state: 'ready' } } }; }
      else if (r.path.endsWith('/services')) reply = { json: { services: [] } };
      else if (r.path.endsWith('/packages')) reply = { json: { packages: [] } };
      else if (r.path.endsWith('/sessions')) reply = { json: { sessions: [{ sessionId: 'session-1' }] } };
      else if (r.path.endsWith('/sessions/session-1')) reply = { json: { messages: [{ role: 'user', text: 'original prompt' }] } };
      else if (r.path.startsWith('operations/')) reply = { json: { state: 'succeeded', operationId: r.path.split('/')[1] } };
      else reply = { status: 404, json: { code: 'NOT_FOUND' } };
    }
    if (reply.abort) await route.abort('failed');
    else await route.fulfill({ status: reply.status ?? 200, headers: reply.headers, ...(reply.json !== undefined ? { contentType: 'application/json', body: JSON.stringify(reply.json) } : { body: reply.body ?? '' }) });
  });
  await page.goto(base + (anonymous ? '/' : '/#/work/work-1'));
  await expect(page.getByRole('heading', { name: anonymous ? 'Connect to your Core' : 'Recovery Work', exact: true })).toBeVisible();
  return { page, requests };
}
const api = (page: Page, code: string): Promise<any> => page.evaluate(`(async () => { const { adapter } = await import('/desktop/browser/adapter.js'); ${code} })()`);
const button = (page: Page, action: string) => page.locator(`[data-action="${action}"]`).first();
function listing(body: string, modified: string) { return `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/_desktop/files/works/work-1/files/note.txt</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>${Buffer.byteLength(body)}</d:getcontentlength><d:getlastmodified>${modified}</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`; }

test('R1 editor binds the original version; dirty refresh and 412 readback never write or discard draft', async t => {
  let body = 'original', modified = mtime1;
  const { page, requests } = await fixture(t, (r): Reply | undefined => {
    if (!r.path.startsWith('/_desktop/files/')) return;
    if (r.method === 'PROPFIND') return { status: 207, body: listing(body, modified), headers: { 'Content-Type': 'application/xml' } };
    if (r.method === 'GET') return { body, headers: { 'Last-Modified': modified } };
    if (r.method === 'PUT') {
      if (r.headers['if-unmodified-since'] !== modified) return { status: 412, json: { message: 'changed' } };
      body = r.body; modified = mtime3; return { status: 204 }; // GET confirms next baseline
    }
  });
  await button(page, 'tab-Files').click(); await button(page, 'open-file').click(); await page.locator('#file-editor').fill('my draft');
  body = 'other writer'; modified = mtime2;
  await button(page, 'refresh-files').click(); await expect(page.locator('#file-editor')).toHaveValue('my draft'); await expect(page.locator('.file-reread pre')).toHaveText('other writer');
  await button(page, 'save-file').click(); const puts = () => requests.filter(r => r.method === 'PUT'); assert.equal(puts()[0]?.headers['if-unmodified-since'], mtime1); assert.equal(body, 'other writer');
  await expect(page.locator('#file-editor')).toHaveValue('my draft');
  const count = puts().length; await button(page, 'refresh-files').click(); assert.equal(puts().length, count);
  await button(page, 'use-reread-version').click(); await button(page, 'save-file').click(); assert.equal(puts()[1]?.headers['if-unmodified-since'], mtime2); assert.equal(body, 'my draft');
  await page.locator('#file-editor').fill('second draft'); await button(page, 'save-file').click(); assert.equal(puts()[2]?.headers['if-unmodified-since'], mtime3); await expect(page.locator('#file-editor')).toHaveValue('second draft');
  await page.locator('#file-editor').fill('keep editable draft'); body='\0binary'; modified='Sat, 03 Oct 2026 01:00:06 GMT'; await button(page, 'refresh-files').click(); await expect(page.locator('#file-editor')).toHaveValue('keep editable draft'); await expect(button(page, 'use-reread-version')).toBeDisabled();
});

test('R1 missing time requires consent; lost save response retains input without automatic PUT', async t => {
  let fail = true;
  const { page, requests } = await fixture(t, (r): Reply | undefined => {
    if (!r.path.startsWith('/_desktop/files/')) return;
    if (r.method === 'PROPFIND') return { status: 207, body: listing('original', '') };
    if (r.method === 'GET') return { body: 'original' };
    if (r.method === 'PUT') return fail ? { abort: true } : { status: 204 };
  });
  await button(page, 'tab-Files').click(); await button(page, 'open-file').click(); await page.locator('#file-editor').fill('keep me'); await button(page, 'save-file').click(); assert.equal(requests.filter(r => r.method === 'PUT').length, 0);
  await button(page, 'allow-unprotected-file').click(); await button(page, 'save-file').click(); await expect(page.locator('#file-editor')).toHaveValue('keep me');
  await button(page, 'save-file').click(); assert.equal(requests.filter(r => r.method === 'PUT').length, 1); fail = false;
});

test('R1 serial upload preserves File bytes and confirmation version across creation/overwrite races and HEAD errors', async t => {
  let head: 'absent' | 'present' | 'error' = 'absent', version = mtime1;
  let conflict = true;
  const { page, requests } = await fixture(t, (r): Reply | undefined => {
    if (!r.path.startsWith('/_desktop/files/')) return;
    if (r.method === 'PROPFIND') return { status: 207, body: '<d:multistatus xmlns:d="DAV:"/>' };
    if (r.method === 'HEAD') return head === 'error' ? { status: 503 } : head === 'absent' ? { status: 404 } : { headers: version ? { 'Last-Modified': version } : {} };
    if (r.method === 'PUT') return { status: conflict ? 412 : 204 };
  });
  await api(page, `window.uploadFile = new File([new Uint8Array([0,255,1,2])], 'raw.bin'); return adapter.upload('work-1','/',[window.uploadFile]);`);
  let puts = requests.filter(r => r.method === 'PUT'); assert.equal(puts.length, 1); assert.equal(puts[0]?.headers['if-none-match'], '*');
  head = 'present'; await api(page, `return adapter.upload('work-1','/',[window.uploadFile]);`);
  version = mtime2; const result = await api(page, `return adapter.upload('work-1','/',[window.uploadFile],true);`); assert.equal(result[0].needsConsent, true); assert.equal(requests.filter(r => r.method === 'PUT').length, 1);
  conflict = false; await api(page, `return adapter.upload('work-1','/',[window.uploadFile],true);`); puts = requests.filter(r => r.method === 'PUT'); assert.equal(puts[1]?.headers['if-unmodified-since'], mtime2);
  version = ''; const missing = await api(page, `return adapter.upload('work-1','/',[window.uploadFile]);`); assert.match(missing[0].message, /without a modification time/);
  await api(page, `return adapter.upload('work-1','/',[window.uploadFile],true);`); assert.equal(requests.filter(r => r.method === 'PUT').length, 3);
  head = 'error'; await api(page, `return adapter.upload('work-1','/',[window.uploadFile],true);`); assert.equal(requests.filter(r => r.method === 'PUT').length, 3);
  assert.deepEqual(await api(page, `return [...new Uint8Array(await window.uploadFile.arrayBuffer())];`), [0,255,1,2]); assert.deepEqual([...puts[1]!.bytes!], [0,255,1,2]);
});

test('R2 Advanced and simple forms share a complete draft; empty values, last edit and invalid JSON survive tabs', async t => {
  const { page, requests } = await fixture(t, () => undefined);
  await button(page, 'settings').click(); await page.locator('[data-tab="Advanced"]').click();
  const draft = { skills: ['new'], packages: [], agentsMd: '', modelRef: 'edited', mcp: { servers: [{ name: 'retained' }] } };
  await page.locator('#advanced-editor').fill(JSON.stringify(draft)); await page.locator('[data-tab="Skills"]').click(); await expect(page.locator('[data-skill="new"]')).toBeChecked();
  await button(page, 'save-config').click(); assert.deepEqual(JSON.parse(requests.find(r => r.method === 'PUT')!.body).configuration, draft);
  await page.locator('[data-skill="new"]').uncheck(); await page.locator('[data-tab="AGENTS.md"]').click(); await page.locator('#agents-editor').fill('latest agents');
  await page.locator('[data-tab="Advanced"]').click(); const raw = JSON.parse(await page.locator('#advanced-editor').inputValue()); assert.deepEqual(raw.skills, []); assert.equal(raw.agentsMd, 'latest agents'); assert.deepEqual(raw.mcp, draft.mcp);
  raw.agentsMd = 'JSON wins'; await page.locator('#advanced-editor').fill(JSON.stringify(raw)); await page.locator('[data-tab="AGENTS.md"]').click(); await expect(page.locator('#agents-editor')).toHaveValue('JSON wins'); await page.locator('#agents-editor').fill('form wins'); await button(page, 'save-config').click();
  assert.equal(JSON.parse(requests.filter(r => r.method === 'PUT').at(-1)!.body).configuration.agentsMd, 'form wins');
  await page.locator('[data-tab="Advanced"]').click(); await page.locator('#advanced-editor').fill('{invalid'); await page.locator('[data-tab="Skills"]').click(); await expect(page.locator('#advanced-editor')).toHaveValue('{invalid');
  const count = requests.filter(r => r.method === 'PUT').length; await button(page, 'save-config').click(); assert.equal(requests.filter(r => r.method === 'PUT').length, count); assert.equal(requests.filter(r => r.path.endsWith('/apply')).length, 0);
  await button(page, 'discard-config').click(); await expect(page.locator('#advanced-editor')).not.toHaveValue('{invalid');
});

test('R2 failed and unknown saves retain the whole JSON draft, including imported explicit empties', async t => {
  let lost = false;
  const { page, requests } = await fixture(t, r => r.path === 'works/work-1/configuration' && r.method === 'PUT' ? lost ? { abort: true } : { status: 422, json: { message: 'invalid model' } } : undefined);
  await button(page, 'settings').click(); await page.locator('[data-tab="Advanced"]').click();
  const draft = { skills: [], packages: [], agentsMd: '', modelRef: 'keep-on-error', tools: { mode: 'retained' } };
  await page.locator('#json-input').setInputFiles({ name: 'config.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await button(page, 'save-config').click(); assert.deepEqual(JSON.parse(await page.locator('#advanced-editor').inputValue()), draft);
  lost = true; await page.locator('[data-tab="Skills"]').click(); await button(page, 'save-config').click(); await page.locator('[data-tab="Advanced"]').click(); assert.deepEqual(JSON.parse(await page.locator('#advanced-editor').inputValue()), draft);
  assert.equal(requests.filter(r => r.path.endsWith('/apply')).length, 0);
});

async function beginExpiredRun(page: Page) { await api(page, `const w=adapter.getWork('work-1'); w.run={id:'original-run',sessionId:'session-1',status:'running',cursor:77,created:''}; return adapter.resumeRun('work-1');`); }
test('R3 expired cursor terminal readback replaces history exactly once and never reconnects or resubmits', async t => {
  const { page, requests } = await fixture(t, (r): Reply | undefined => {
    if (r.path.endsWith('/events')) return { status: 410 };
    if (r.path.endsWith('/runs/original-run')) return { json: { run: { state: 4, finalText: 'final answer' } } };
    if (r.path.endsWith('/sessions/session-1')) return { json: { messages: [{ role: 'user', text: 'original prompt' }, { role: 'assistant', text: 'final answer' }] } };
  });
  await beginExpiredRun(page); await page.waitForTimeout(2200);
  const value = await api(page, `return adapter.getWork('work-1');`); assert.equal(value.run.status, 'succeeded'); assert.equal(value.run.error, undefined); assert.equal(value.sessions[0].messages.filter((m: any) => m.text === 'final answer').length, 1);
  assert.equal(requests.filter(r => r.path.endsWith('/events')).length, 1); assert.equal(requests.filter(r => r.method === 'POST').length, 0); assert(requests.some(r => r.path.endsWith('/sessions/session-1')));
});

test('R3 active history recovery polls serially with backoff, recovers network errors and stops at terminal', async t => {
  let reads = 0, historyReads = 0, active = 0, maxActive = 0; const times: number[] = [];
  const { page, requests } = await fixture(t, async r => {
    if (r.path.endsWith('/events')) return { status: 410 };
    if (r.path.endsWith('/runs/original-run')) { times.push(Date.now()); maxActive = Math.max(maxActive, ++active); await new Promise(done => setTimeout(done, 100)); active--; reads++; return reads === 1 ? { status: 503, json: { message: 'offline' } } : { json: { run: { state: reads < 4 ? 2 : 4, finalText: 'recovered' } } }; }
    if (r.path.endsWith('/sessions/session-1')) { historyReads++; return { json: { messages: [{ role: 'assistant', text: reads < 4 ? 'partial history' : 'recovered' }] } }; }
  });
  await beginExpiredRun(page); await expect.poll(() => api(page, `return adapter.getWork('work-1').run.status;`), { timeout: 12000 }).toBe('succeeded');
  assert.equal(maxActive, 1); assert(times[1]! - times[0]! >= 1900); const count = reads; await page.waitForTimeout(2200); assert.equal(reads, count); assert(historyReads >= 3); assert.equal(requests.filter(r => r.path.endsWith('/events')).length, 1);
});

test('R3 terminal history failure is explicit and late responses after identity change are discarded', async t => {
  let failHistory = false, delayed = false;
  const { page } = await fixture(t, async r => {
    if (r.path.endsWith('/events')) return { status: 410 };
    if (r.path.endsWith('/runs/original-run')) { if (delayed) await new Promise(done => setTimeout(done, 500)); return { json: { run: { state: 4, finalText: 'final' } } }; }
    if (r.path.endsWith('/sessions/session-1') && failHistory) return { status: 503, json: { message: 'history unavailable' } };
  });
  failHistory = true; await beginExpiredRun(page); const run = await api(page, `return adapter.getWork('work-1').run;`); assert.equal(run.status, 'succeeded'); assert.match(run.error, /History recovery failed/);
  failHistory = false; await api(page, `return adapter.resumeRun('work-1');`); assert.equal(await api(page, `return adapter.getWork('work-1').run.error;`), undefined);
  delayed = true; await api(page, `adapter.getWork('work-1').run.status='running'; void adapter.resumeRun('work-1');`); await api(page, `await adapter.switchCore('http://another.test');`); await page.waitForTimeout(650); assert.deepEqual(await api(page, `return adapter.state.works;`), []);
});

test('R4 anonymous inspection survives failed login then same-Core first login, and explicit import uses one original upload', async t => {
  let failLogin = true;
  const { page, requests } = await fixture(t, (r): Reply | undefined => {
    if (r.path === 'login' && failLogin) return { status: 401, json: { message: 'wrong password' } };
    if (r.path === 'work-packages' && r.method === 'POST') return { json: { transferId: r.headers['x-piwork-transfer-id'], summary: { name: 'verified locally' } } };
    if (r.path === 'work-imports') return { status: 202, json: { operationId: 'import-original', workId: 'imported' } };
  }, true);
  await button(page, 'import').click(); await page.locator('#work-file-input').setInputFiles({ name: 'sample.work', mimeType: 'application/vnd.piwork.work-package', buffer: Buffer.from('local bytes') });
  await expect(page.locator('.inspection-summary')).toContainText('verified locally'); const id = requests.find(r => r.path === 'work-packages')!.headers['x-piwork-transfer-id']; assert.equal(requests.filter(r => r.path === 'works').length, 0);
  await button(page, 'import-sign-in').click(); await page.locator('#auth-account').fill('owner'); await page.locator('#auth-password').fill('password'); await button(page, 'sign-in').click(); assert.equal(await api(page, `return adapter.inspectionTransfer;`), id);
  await api(page, `return adapter.checkConnection();`); assert.equal(await api(page, `return adapter.inspectionTransfer;`), id); failLogin = false; await button(page, 'sign-in').click(); await expect(page.locator('.inspection-summary')).toContainText('verified locally'); assert.equal(requests.filter(r => r.path === 'work-imports').length, 0);
  await button(page, 'confirm-import').click(); assert.equal(JSON.parse(requests.find(r => r.path === 'work-imports')!.body).transferId, id); assert.equal(requests.filter(r => r.path === 'work-packages' && r.method === 'POST').length, 1); assert.equal(requests.filter(r => r.method === 'DELETE').length, 0); await button(page, 'close-modal').click(); assert.equal(requests.filter(r => r.path === 'work-imports').length, 1); assert.equal(requests.filter(r => r.method === 'DELETE').length, 0);
});

test('R4 Core/account/logout changes never preserve another identity inspection', async t => {
  const { page } = await fixture(t, r => r.path === 'work-packages' ? { json: { transferId: r.headers['x-piwork-transfer-id'], summary: { name: 'private summary' } } } : undefined, true);
  await api(page, `await adapter.inspectWork(new File(['x'],'x.work')); await adapter.switchCore('http://other.test'); return adapter.inspection;`).then(value => assert.equal(value, null));
  await api(page, `await adapter.signIn('http://other.test','owner','pass'); await adapter.inspectWork(new File(['x'],'x.work')); await adapter.signIn('http://other.test','other-account','pass');`); assert.equal(await api(page, `return adapter.inspection;`), null);
  await api(page, `await adapter.inspectWork(new File(['x'],'x.work')); await adapter.signOut();`); assert.equal(await api(page, `return adapter.inspection;`), null);
});

test('R5 replace/Cancel/Escape release exact IDs; failed DELETE retains independent retry record and 404 confirms cleanup', async t => {
  let cleanupStatus = 503;
  const { page, requests } = await fixture(t, (r): Reply | undefined => {
    if (r.path === 'work-packages') return { json: { transferId: r.headers['x-piwork-transfer-id'], summary: { name: 'local' } } };
    if (r.method === 'DELETE') return { status: cleanupStatus, json: {} };
  });
  await page.goto(base + '/#/works'); await button(page, 'import').click(); const input = page.locator('#work-file-input');
  await input.setInputFiles({ name: 'first.work', mimeType: 'application/octet-stream', buffer: Buffer.from('first') }); await expect(page.locator('.inspection-summary')).toBeVisible(); const first = await api(page, `return adapter.inspectionTransfer;`);
  await input.setInputFiles({ name: 'second.work', mimeType: 'application/octet-stream', buffer: Buffer.from('second') }); await expect.poll(() => api(page, `return adapter.inspectionTransfer;`)).not.toBe(first);
  assert(requests.some(r => r.method === 'DELETE' && r.path === 'work-packages/' + first)); assert.equal(await api(page, `return adapter.cleanupPending.has('${first}');`), true);
  const second = await api(page, `return adapter.inspectionTransfer;`); await page.keyboard.press('Escape'); await expect.poll(() => api(page, `return adapter.inspection;`)).toBe(null); assert(requests.some(r => r.method === 'DELETE' && r.path === 'work-packages/' + second));
  cleanupStatus = 404; await page.locator(`[data-action="retry-inspection-cleanup"][data-id="${first}"]`).click(); assert.equal(await api(page, `return adapter.cleanupPending.has('${first}');`), false);
  await api(page, `await adapter.cleanupInspection('${second}');`); assert.equal(await api(page, `return adapter.cleanupPending.size;`), 0);
  await button(page, 'import').click(); await input.setInputFiles({ name: 'cancel.work', mimeType: 'application/octet-stream', buffer: Buffer.from('cancel') }); await expect(page.locator('.inspection-summary')).toBeVisible(); await button(page, 'close-modal').click(); await expect.poll(() => api(page, `return adapter.inspection;`)).toBe(null);
});

test('R5 upload cancellation and late callback cannot resurrect abandoned inspection; unknown/accepted imports cannot resubmit or delete', async t => {
  let uploadDelay = true, lostImport = true, lostDelete = true;
  const { page, requests } = await fixture(t, async r => {
    if (r.path === 'work-packages' && r.method === 'POST') { if (uploadDelay) await new Promise(done => setTimeout(done, 500)); return { json: { transferId: r.headers['x-piwork-transfer-id'], summary: { name: 'local' } } }; }
    if (r.method === 'DELETE') return lostDelete ? { abort: true } : { status: 200, json: {} };
    if (r.path === 'work-imports') return lostImport ? { abort: true } : { status: 202, json: { operationId: 'original-operation' } };
  });
  await api(page, `void adapter.inspectWork(new File(['x'],'x.work'));`); await expect.poll(() => api(page, `return adapter.inspectionTransfer;`)).not.toBe(''); const id = await api(page, `return adapter.inspectionTransfer;`); await api(page, `return adapter.abandonInspection();`); await page.waitForTimeout(700); assert.equal(await api(page, `return adapter.inspection;`), null); assert.equal(await api(page, `return adapter.cleanupPending.has('${id}');`), true);
  lostDelete = false; await api(page, `return adapter.cleanupInspection('${id}');`); assert.equal(await api(page, `return adapter.cleanupPending.size;`), 0);
  uploadDelay = false; await api(page, `await adapter.inspectWork(new File(['y'],'y.work')); try { await adapter.importWork(''); } catch {} return adapter.inspectionContext.importState;`).then(value => assert.equal(value, 'unknown'));
  const deletes = requests.filter(r => r.method === 'DELETE').length; await api(page, `await adapter.abandonInspection(); try { await adapter.importWork(''); } catch {} try { await adapter.inspectWork(new File(['z'],'z.work')); } catch {}`); assert.equal(requests.filter(r => r.path === 'work-imports').length, 1); assert.equal(requests.filter(r => r.method === 'DELETE').length, deletes);
  await api(page, `await adapter.signOut(); await adapter.signIn('http://core.test','owner','pass');`); lostImport = false;
  await api(page, `await adapter.inspectWork(new File(['a'],'a.work')); await adapter.importWork(''); await adapter.abandonInspection();`); assert.equal(await api(page, `return adapter.inspectionContext.operationId;`), 'original-operation'); assert.equal(requests.filter(r => r.method === 'DELETE').length, deletes);
});

test('R7 catalog errors recover independently, reject malformed arrays, accept empty and preserve drafts/readiness', async t => {
  let skillReply: Reply | undefined, packageReply: Reply | undefined;
  const { page } = await fixture(t, r => r.path === 'skills' ? skillReply : r.path === 'packages' ? packageReply : undefined);
  await button(page, 'settings').click(); await page.locator('[data-tab="AGENTS.md"]').click(); await page.locator('#agents-editor').fill('dirty instructions');
  skillReply = { status: 503, json: { message: 'skills offline' } }; await api(page, `adapter.state.scenario='env-not-ready'; return adapter.checkCatalog();`);
  let facts = await api(page, `return {catalog:adapter.catalog,scenario:adapter.state.scenario,skills:adapter.getSkills()};`); assert.match(facts.catalog.skills.error, /skills offline/); assert.equal(facts.catalog.packages.error, ''); assert.equal(facts.scenario, 'env-not-ready'); assert.equal(facts.skills.length, 2);
  await page.locator('[data-tab="Skills"]').click(); await expect(page.locator('[data-action="core-skill-copy"]').first()).toBeDisabled();
  skillReply = { json: {} }; await api(page, `return adapter.checkCatalog();`); assert.match(await api(page, `return adapter.catalog.skills.error;`), /incomplete/);
  skillReply = { json: { skills: [{ name: 'saved' }, { name: 'new' }] } }; packageReply = { json: { packages: 'bad' } }; await button(page, 'check-catalog').click(); await expect(page.locator('[data-action="core-skill-copy"]').first()).toBeEnabled(); assert.equal(await api(page, `return adapter.catalog.skills.error;`), ''); assert.match(await api(page, `return adapter.catalog.packages.error;`), /incomplete/);
  await page.locator('[data-tab="AGENTS.md"]').click(); await expect(page.locator('#agents-editor')).toHaveValue('dirty instructions');
  packageReply = { json: { packages: [] } }; skillReply = { json: { skills: [] } }; await api(page, `return adapter.checkCatalog();`); facts = await api(page, `return {catalog:adapter.catalog,scenario:adapter.state.scenario,packages:adapter.getPackages()};`); assert.equal(facts.catalog.skills.error, ''); assert.equal(facts.catalog.packages.error, ''); assert.equal(facts.scenario, 'env-not-ready'); assert.deepEqual(facts.packages, []); await api(page, `adapter.acceptSession({state:'authenticated',generation:1,csrf:'local-session-csrf',coreUrl:'http://core.test',user:{account:'owner',role:'user'}});`); assert.equal(await api(page, `return adapter.state.scenario;`), 'env-not-ready');
  await api(page, `adapter.state.scenario='core-offline'; return adapter.checkCatalog();`); assert.equal(await api(page, `return adapter.state.scenario;`), 'core-offline');
});

test('R3 forbidden/deleted Runs stop automatic history reads; successive transient failures use 2/4 second backoff', async t => {
  let status = 503, reads = 0; const times: number[] = [];
  const { page, requests } = await fixture(t, r => {
    if (r.path.endsWith('/events')) return { status: 410 };
    if (r.path.endsWith('/runs/original-run')) { reads++; times.push(Date.now()); return reads <= 2 ? { status: 503, json: { message: 'retryable' } } : { status, json: { code: status === 403 ? 'FORBIDDEN' : 'NOT_FOUND' } }; }
  });
  status = 403; await beginExpiredRun(page); await expect.poll(() => reads, { timeout: 9000 }).toBe(3);
  assert(times[1]! - times[0]! >= 1900); assert(times[2]! - times[1]! >= 3900);
  await page.waitForTimeout(2200); assert.equal(reads, 3); status = 404; await api(page, `return adapter.resumeRun('work-1');`); await page.waitForTimeout(2200); assert.equal(reads, 4);
  assert.equal(requests.filter(r => r.path.endsWith('/events')).length, 1); assert.equal(requests.filter(r => r.method === 'POST').length, 0);
});

test('R5 inspection nonce rejects a forced late XHR completion after replacement', async t => {
  const {page,requests} = await fixture(t, r => r.method === 'DELETE' ? {status:200,json:{}} : undefined);
  await api(page, `window.fakeUploads=[]; window.XMLHttpRequest=class {
    headers={}; responseText=''; status=200; open(){} setRequestHeader(k,v){this.headers[k]=v;} send(){window.fakeUploads.push(this);} abort(){}
  }; void adapter.inspectWork(new File(['old'],'old.work'));`);
  await expect.poll(() => api(page, `return window.fakeUploads.length;`)).toBe(1);
  const old = await api(page, `return adapter.inspectionTransfer;`);
  await api(page, `void adapter.inspectWork(new File(['new'],'new.work'));`);
  await expect.poll(() => api(page, `return window.fakeUploads.length;`)).toBe(2);
  const fresh = await api(page, `return adapter.inspectionTransfer;`);
  await api(page, `const latest=window.fakeUploads[1]; latest.responseText=JSON.stringify({transferId:latest.headers['X-Piwork-Transfer-Id'],summary:{name:'new'}}); latest.onload();`);
  await expect.poll(() => api(page, `return adapter.inspection?.name;`)).toBe('new');
  await api(page, `const stale=window.fakeUploads[0]; stale.responseText=JSON.stringify({transferId:stale.headers['X-Piwork-Transfer-Id'],summary:{name:'old'}}); stale.onload();`);
  await page.waitForTimeout(100);
  assert.equal(await api(page, `return adapter.inspectionTransfer;`), fresh); assert.equal(await api(page, `return adapter.inspection.name;`), 'new'); assert(requests.filter(r => r.method === 'DELETE' && r.path === 'work-packages/'+old).length >= 2);
});
