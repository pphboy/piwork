import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect, type Page, type Route } from '@playwright/test';

let browser: Awaited<ReturnType<typeof chromium.launch>>;
let base = '';
let nativeDownloadHandler: ((request: IncomingMessage, response: ServerResponse) => Promise<boolean>) | undefined;
const server = createServer(async (request, response) => {
  if (nativeDownloadHandler && await nativeDownloadHandler(request, response)) return;
  const path = request.url?.startsWith('/desktop/browser/') ? '../browser/' + request.url.slice('/desktop/browser/'.length) : '../public/' + (request.url === '/style.css' ? 'style.css' : 'index.html');
  try { response.setHeader('Content-Type', path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html'); response.end(await readFile(new URL(path, import.meta.url))); }
  catch { response.writeHead(404); response.end(); }
});
before(async () => { await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const address = server.address(); assert(address && typeof address !== 'string'); base = `http://127.0.0.1:${address.port}`; browser = await chromium.launch({ headless: true, ...(process.env.PIWORK_TEST_BROWSER_BIN?{executablePath:process.env.PIWORK_TEST_BROWSER_BIN}:{channel:'chromium'}) }); });
after(async () => {
  try { await browser?.close(); }
  finally { if (server.listening) await new Promise<void>(done => server.close(() => done())); }
});

type RequestRecord = { search: string; bytes?: Buffer | null; path: string; method: string; headers: Record<string, string>; body: string };
type Reply = { status?: number; json?: unknown; body?: string; headers?: Record<string, string>; abort?: boolean };
const mtime1 = 'Sat, 03 Oct 2026 01:00:00 GMT';
const mtime2 = 'Sat, 03 Oct 2026 01:00:02 GMT';
const mtime3 = 'Sat, 03 Oct 2026 01:00:04 GMT';
async function fixture(t: { after: (fn: () => Promise<void>) => void }, handler: (record: RequestRecord) => Reply | undefined | Promise<Reply | undefined>, anonymous = false, waitForInitialRead = true, beforeNavigation?: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); t.after(() => page.close());
  // These protocol/fake-clock tests use the supported immediate presentation path.
  // Real motion/race behavior has its own modal-presentation and GUI acceptance coverage.
  await page.emulateMedia({reducedMotion:'reduce'});
  const requests: RequestRecord[] = [];
  nativeDownloadHandler = async (request, response) => {
    const url = new URL(request.url || '/', base);
    if (request.method !== 'GET' || !url.pathname.startsWith('/_desktop/files/')) return false;
    const r: RequestRecord = {search:url.search,path:url.pathname,method:'GET',headers:request.headers as Record<string,string>,body:''};
    requests.push(r);const reply=await handler(r);
    if(!reply || reply.abort){response.writeHead(404);response.end();return true;}
    response.writeHead(reply.status ?? 200,reply.headers);response.end(reply.json === undefined ? reply.body ?? '' : JSON.stringify(reply.json));return true;
  };
  t.after(async()=>{nativeDownloadHandler=undefined;});

  let generation = 1, signedIn = !anonymous, core = 'http://core.test';
  let desired: Record<string, any> = { skills: ['saved'], packages: [{ name: 'pkg', enabled: true }], agentsMd: 'saved agents', modelRef: 'original', mcp: { servers: [] } };
  const session = () => ({ state: signedIn ? 'authenticated' : 'signed-out', generation, csrf: 'local-session-csrf', coreUrl: core, ...(signedIn ? { user: { account: 'owner', role: 'user' } } : {}) });
  await page.route('**/_desktop/**', async (route: Route) => {
    const r: RequestRecord = { search: new URL(route.request().url()).search, path: new URL(route.request().url()).pathname.replace('/_desktop/api/', ''), method: route.request().method(), bytes: route.request().postDataBuffer(), headers: route.request().headers(), body: route.request().postData() ?? '' }; requests.push(r);
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
      else if (r.path.endsWith('/models')) reply = { json: {models:[{modelRef:'model-test-0000000001',label:'Test model',provider:'fixture',model:'one'}],defaultModel:{modelRef:null,label:'Work model',provider:'fixture',model:'one'},checkedAt:new Date().toISOString(),availability:'available'} };
      else if (r.path.endsWith('/chat-options') && r.method === 'GET') reply = { json: { sessionId: r.path.split('/sessions/')[1]?.split('/')[0] || 'session-1', modelRef: null, thinkingLevel: 'off', model: chatModel, availability: 'available', checkedAt: new Date().toISOString() } };
      else if (r.path.endsWith('/sessions')) reply = { json: { sessions: [{ sessionId: 'session-1' }] } };
      else if (r.path.endsWith('/sessions/session-1')) reply = { json: {session:{sessionId:'session-1',workId:'work-1',modelPreference:null,source:{kind:'chat'}}, messages: [{ role: 'user', text: 'original prompt' }],runs:[] } };
      else if (r.path.startsWith('operations/')) reply = { json: { state: 'succeeded', operationId: r.path.split('/')[1] } };
      else reply = { status: 404, json: { code: 'NOT_FOUND' } };
    }
    if (reply.abort) await route.abort('failed');
    else await route.fulfill({ status: reply.status ?? 200, headers: reply.headers, ...(reply.json !== undefined ? { contentType: 'application/json', body: JSON.stringify(reply.json) } : { body: reply.body ?? '' }) });
  });
  await beforeNavigation?.(page);
  await page.goto(base + (anonymous ? '/' : '/#/work/work-1'));
  await expect(page.getByRole('heading', { name: anonymous ? 'Connect to your Core' : 'Recovery Work', exact: true })).toBeVisible();
  if (!anonymous && waitForInitialRead) {
    await expect.poll(()=>api(page, "const w=adapter.getWork('work-1');return !!(w?.resourceChecked?.services || w?.resourceErrors?.services);")).toBe(true);
    await expect(page.locator('.work-read-feedback')).toHaveCount(0);
  }
  return { page, requests };
}
const api = (page: Page, code: string): Promise<any> => page.evaluate(`(async () => { const { adapter } = await import('/desktop/browser/adapter.js'); ${code} })()`);
const button = (page: Page, action: string) => page.locator(`[data-action="${action}"]:visible`).first();
async function openFullscreenOptions(page: Page) {
  if(await button(page,'service-fullscreen').isVisible())return;
  const serviceMenu=page.locator('.service-toolbar [data-action="service-menu"]:visible').first();
  if(await serviceMenu.isVisible())await serviceMenu.click();else await button(page,'agent-menu').click();
  await expect(button(page,'service-fullscreen')).toBeVisible();
}
async function openResponseSettings(page: Page, kind?: 'model' | 'thinking') {
  if (!await page.locator('#modal').count()) await page.locator('#response-settings-trigger').click();
  await expect(page.locator('#modal')).toHaveClass(/chat-response-settings/);
  if (kind && await page.locator(`#${kind}-select`).getAttribute('aria-expanded') !== 'true') await page.locator(`#${kind}-select`).click();
}
async function closeResponseSettings(page: Page) {
  await page.locator('#modal .modal-footer [data-action=close-modal]').click();
  await expect(page.locator('#modal')).toHaveCount(0);
}
async function expectThinkingEditable(page: Page) {
  await openResponseSettings(page);
  await expect(page.locator('#thinking-select')).toBeEnabled();
  await closeResponseSettings(page);
}
async function chooseThinking(page: Page, level: string, keepOpen = false) {
  await openResponseSettings(page, 'thinking');
  await page.locator(`#modal [data-action=choose-chat-setting][data-kind=thinking][data-option-value="${level}"]`).click();
  await expect(page.locator('#modal [role=listbox]')).toHaveCount(0);
  if (!keepOpen) await closeResponseSettings(page);
}
async function chooseModel(page: Page, ref: string, keepOpen = false) {
  await openResponseSettings(page, 'model');
  await page.locator(`#modal [data-action=choose-chat-setting][data-kind=model][data-option-value="${ref}"]`).click();
  await expect(page.locator('#modal [role=listbox]')).toHaveCount(0);
  if (!keepOpen) await closeResponseSettings(page);
}
async function uiuxEvidence(page: Page, name: string) {
  const directory = process.env.PIWORK_UIUX_EVIDENCE_DIR;
  if (directory) {
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: resolve(directory, `${name}.png`) });
  }
}
const chatWrites = (requests: RequestRecord[]) => requests.filter(r => r.method === 'PATCH' || r.method === 'POST' && /\/(sessions|runs)$/.test(r.path));
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
  await expect(page.locator('[data-action-status][aria-busy="true"]')).toHaveCount(0);
  await page.locator('#file-editor').fill('second draft'); await button(page, 'save-file').click(); assert.equal(puts()[2]?.headers['if-unmodified-since'], mtime3); await expect(page.locator('#file-editor')).toHaveValue('second draft');
  // A recorded PUT is acceptance, not completion of its confirming GET.
  await expect(page.locator('[data-action-status][aria-busy="true"]')).toHaveCount(0);
  await page.locator('#file-editor').fill('keep editable draft'); body='\0binary'; modified='Sat, 03 Oct 2026 01:00:06 GMT'; await button(page, 'refresh-files').click(); await expect(page.locator('#file-editor')).toHaveValue('keep editable draft');
  await expect(page.locator('.main-panel')).toContainText('no longer editable text');
  await expect(page.locator('[data-action="use-reread-version"]')).toHaveCount(0);
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
  await expect(button(page, 'save-file')).toBeDisabled(); await button(page, 'save-file').evaluate((el: HTMLButtonElement)=>el.click()); assert.equal(requests.filter(r => r.method === 'PUT').length, 1); await expect(page.locator('#file-editor')).toHaveValue('keep me'); fail = false;
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
    if (r.path.endsWith('/sessions/session-1')) return { json: { messages: [{ entryId:'original-user',runId:'original-run',role:'user',text:'original prompt' }, { entryId:'original-answer',runId:'original-run',role:'assistant',blocks:[{blockId:'original-run-final',type:'text',text:'final answer'}] }] } };
  });
  await beginExpiredRun(page); await page.waitForTimeout(2200);
  const value = await api(page, `return adapter.getWork('work-1');`); assert.equal(value.run.status, 'succeeded'); assert.equal(value.run.error, undefined); assert.equal(value.sessions[0].messages.filter((m: any) => m.text === 'final answer').length, 1);
  assert.equal(requests.filter(r => r.path.endsWith('/events')).length, 1); assert.equal(requests.filter(r => r.method === 'POST').length, 0); assert(requests.some(r => r.path.endsWith('/sessions/session-1')));
});

test('legacy 410 recovery keeps visible partial reply with its cancelled Run and does not submit', async t => {
  const { page, requests } = await fixture(t, (r): Reply | undefined => {
    if (r.path.endsWith('/history-capabilities')) return { status:501,json:{code:'HISTORY_UNSUPPORTED'} };
    if (r.path.endsWith('/events')) return { status:410,json:{code:'CURSOR_EXPIRED'} };
    if (r.path.endsWith('/runs/original-run')) return { json:{run:{state:6,finalText:''}} };
    if (r.path.endsWith('/sessions/session-1')) return { json:{messages:[]} };
  });
  await api(page, `const session=adapter.getWork('work-1').sessions.find(s=>s.id==='session-1');session.messages=[{id:'original-user',runId:'original-run',role:'user',text:'Question'},{id:'original-run-text-1',runId:'original-run',role:'assistant',text:'Partial reply'}];adapter.emit();`);
  await beginExpiredRun(page);
  await expect(page.locator('#messages')).toContainText('Partial reply');
  await expect(page.locator('#messages')).toContainText('Run cancelled');
  const messages=await api(page, `return adapter.getWork('work-1').sessions[0].messages;`);
  const answer=messages.find((message:any)=>message.text==='Partial reply');assert.equal(answer.runId,'original-run');assert.equal(answer.historyRecoveryUnconfirmed,true);
  assert.equal(requests.filter(r=>r.method==='POST').length,0);
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
    if (r.path === 'work-packages' && r.method === 'POST') return { json: { transferId: r.headers['x-piwork-transfer-id'], summary: { sourceName: 'verified locally', integrityVerified: true } } };
    if (r.path === 'work-imports') return { status: 202, json: { operationId: 'import-original', workId: 'imported' } };
  }, true);
  await button(page, 'import').click(); await page.locator('#work-file-input').setInputFiles({ name: 'sample.work', mimeType: 'application/vnd.piwork.work-package', buffer: Buffer.from('local bytes') });
  await expect(page.locator('.import-result')).toContainText('verified locally'); const id = requests.find(r => r.path === 'work-packages')!.headers['x-piwork-transfer-id']; assert.equal(requests.filter(r => r.path === 'works').length, 0);
  await button(page, 'import-sign-in').click(); await page.locator('#auth-account').fill('owner'); await page.locator('#auth-password').fill('password'); await button(page, 'sign-in').click(); assert.equal(await api(page, `return adapter.inspectionTransfer;`), id);
  await api(page, `return adapter.checkConnection();`); assert.equal(await api(page, `return adapter.inspectionTransfer;`), id); failLogin = false; await button(page, 'sign-in').click(); await expect(page.locator('.import-result')).toContainText('verified locally'); assert.equal(requests.filter(r => r.path === 'work-imports').length, 0);
  await button(page, 'confirm-import').click(); assert.equal(JSON.parse(requests.find(r => r.path === 'work-imports')!.body).transferId, id); assert.equal(requests.filter(r => r.path === 'work-packages' && r.method === 'POST').length, 1); assert.equal(requests.filter(r => r.method === 'DELETE').length, 0); await button(page, 'close-modal').click(); assert.equal(requests.filter(r => r.path === 'work-imports').length, 1); assert.equal(requests.filter(r => r.method === 'DELETE').length, 0);
});

test('R4 Core/account/logout changes never preserve another identity inspection', async t => {
  const { page } = await fixture(t, r => r.path === 'work-packages' ? { json: { transferId: r.headers['x-piwork-transfer-id'], summary: { sourceName: 'private summary', integrityVerified: true } } } : undefined, true);
  await api(page, `await adapter.inspectWork(new File(['x'],'x.work')); await adapter.switchCore('http://other.test'); return adapter.inspection;`).then(value => assert.equal(value, null));
  await api(page, `await adapter.signIn('http://other.test','owner','pass'); await adapter.checkConnection(); await adapter.inspectWork(new File(['x'],'x.work')); await adapter.signIn('http://other.test','other-account','pass');`); assert.equal(await api(page, `return adapter.inspection;`), null);
  await api(page, `await adapter.checkConnection(); await adapter.inspectWork(new File(['x'],'x.work')); await adapter.signOut();`); assert.equal(await api(page, `return adapter.inspection;`), null);
});

test('R5 replace/Cancel/Escape release exact IDs; failed DELETE retains independent retry record and 404 confirms cleanup', async t => {
  let cleanupStatus = 503;
  const { page, requests } = await fixture(t, (r): Reply | undefined => {
    if (r.path === 'work-packages') return { json: { transferId: r.headers['x-piwork-transfer-id'], summary: { sourceName: 'local', integrityVerified: true } } };
    if (r.method === 'DELETE') return { status: cleanupStatus, json: {} };
  });
  await page.goto(base + '/#/works'); await button(page, 'import').click(); const input = page.locator('#work-file-input');
  await input.setInputFiles({ name: 'first.work', mimeType: 'application/octet-stream', buffer: Buffer.from('first') }); await expect(page.locator('.import-result')).toBeVisible(); const first = await api(page, `return adapter.inspectionTransfer;`);
  await input.setInputFiles({ name: 'second.work', mimeType: 'application/octet-stream', buffer: Buffer.from('second') }); await expect.poll(() => api(page, `return adapter.inspectionTransfer;`)).not.toBe(first);
  assert(requests.some(r => r.method === 'DELETE' && r.path === 'work-packages/' + first)); assert.equal(await api(page, `return adapter.cleanupPending.has('${first}');`), true);
  const second = await api(page, `return adapter.inspectionTransfer;`); await page.keyboard.press('Escape'); await expect.poll(() => api(page, `return adapter.inspection;`)).toBe(null); assert(requests.some(r => r.method === 'DELETE' && r.path === 'work-packages/' + second));
  cleanupStatus = 404; await page.locator(`[data-action="retry-inspection-cleanup"][data-id="${first}"]`).click(); assert.equal(await api(page, `return adapter.cleanupPending.has('${first}');`), false);
  await api(page, `await adapter.cleanupInspection('${second}');`); assert.equal(await api(page, `return adapter.cleanupPending.size;`), 0);
  await button(page, 'import').click(); await input.setInputFiles({ name: 'cancel.work', mimeType: 'application/octet-stream', buffer: Buffer.from('cancel') }); await expect(page.locator('.import-result')).toBeVisible(); await button(page, 'close-modal').click(); await expect.poll(() => api(page, `return adapter.inspection;`)).toBe(null);
});

test('R5 upload cancellation and late callback cannot resurrect abandoned inspection; unknown/accepted imports cannot resubmit or delete', async t => {
  let uploadDelay = true, lostImport = true, lostDelete = true;
  const { page, requests } = await fixture(t, async r => {
    if (r.path === 'work-packages' && r.method === 'POST') { if (uploadDelay) await new Promise(done => setTimeout(done, 500)); return { json: { transferId: r.headers['x-piwork-transfer-id'], summary: { sourceName: 'local', integrityVerified: true } } }; }
    if (r.method === 'DELETE') return lostDelete ? { abort: true } : { status: 200, json: {} };
    if (r.path === 'work-imports') return lostImport ? { abort: true } : { status: 202, json: { operationId: 'original-operation' } };
  });
  await api(page, `void adapter.inspectWork(new File(['x'],'x.work'));`); await expect.poll(() => api(page, `return adapter.inspectionTransfer;`)).not.toBe(''); const id = await api(page, `return adapter.inspectionTransfer;`); await api(page, `return adapter.abandonInspection();`); await page.waitForTimeout(700); assert.equal(await api(page, `return adapter.inspection;`), null); assert.equal(await api(page, `return adapter.cleanupPending.has('${id}');`), true);
  lostDelete = false; await api(page, `return adapter.cleanupInspection('${id}');`); assert.equal(await api(page, `return adapter.cleanupPending.size;`), 0);
  uploadDelay = false; await api(page, `await adapter.inspectWork(new File(['y'],'y.work')); try { await adapter.importWork(''); } catch {} return adapter.inspectionContext.importState;`).then(value => assert.equal(value, 'unknown'));
  const deletes = requests.filter(r => r.method === 'DELETE').length; await api(page, `await adapter.abandonInspection(); try { await adapter.importWork(''); } catch {} try { await adapter.inspectWork(new File(['z'],'z.work')); } catch {}`); assert.equal(requests.filter(r => r.path === 'work-imports').length, 1); assert.equal(requests.filter(r => r.method === 'DELETE').length, deletes);
  await api(page, `await adapter.signOut(); await adapter.signIn('http://core.test','owner','pass'); await adapter.checkConnection();`); lostImport = false;
  await api(page, `await adapter.inspectWork(new File(['a'],'a.work')); await adapter.importWork(''); await adapter.abandonInspection();`); assert.equal(await api(page, `return adapter.inspectionContext.operationId;`), 'original-operation'); assert.equal(requests.filter(r => r.method === 'DELETE').length, deletes);
});

test('R7 catalog errors recover independently, reject malformed arrays, accept empty and preserve drafts/readiness', async t => {
  let skillReply: Reply | undefined, packageReply: Reply | undefined;
  const { page } = await fixture(t, r => r.path === 'skills' ? skillReply : r.path === 'packages' ? packageReply : undefined);
  await button(page, 'settings').click(); await page.locator('[data-tab="AGENTS.md"]').click(); await page.locator('#agents-editor').fill('dirty instructions');
  skillReply = { status: 503, json: { message: 'skills offline' } }; await api(page, `adapter.state.scenario='env-not-ready'; return adapter.checkCatalog();`);
  // Cached feedback is a localizable message identity; its raw server text and
  // catalog key both remain inspectable across the browser boundary.
  const feedbackText = (value: any): string => typeof value === 'string' ? value : value?.raw || value?.key || '';
  let facts = await api(page, `return {catalog:adapter.catalog,scenario:adapter.state.scenario,skills:adapter.getSkills()};`); assert.match(feedbackText(facts.catalog.skills.error), /skills offline/); assert.equal(feedbackText(facts.catalog.packages.error), ''); assert.equal(facts.scenario, 'env-not-ready'); assert.equal(facts.skills.length, 2);
  await page.locator('[data-tab="Skills"]').click(); await expect(page.locator('[data-action="core-skill-copy"]').first()).toBeDisabled();
  skillReply = { json: {} }; await api(page, `return adapter.checkCatalog();`); assert.match(feedbackText(await api(page, `return adapter.catalog.skills.error;`)), /incomplete/i);
  skillReply = { json: { skills: [{ name: 'saved' }, { name: 'new' }] } }; packageReply = { json: { packages: 'bad' } }; await button(page, 'check-catalog').click(); await expect(page.locator('[data-action="core-skill-copy"]').first()).toBeEnabled(); assert.equal(feedbackText(await api(page, `return adapter.catalog.skills.error;`)), ''); assert.match(feedbackText(await api(page, `return adapter.catalog.packages.error;`)), /incomplete/i);
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

test('Brain model save lost reply blocks sending and reads the original Session without PATCH replay',async t=>{
  const preference={modelRef:'model-test-0000000001',label:'Test model',provider:'fixture',model:'one',availability:'available'};
  let saved=false;
  const {page,requests}=await fixture(t,r=>{
    if(r.path.endsWith('/sessions/session-1/model')){saved=true;return{abort:true};}
    if(r.path.endsWith('/sessions/session-1'))return{json:{session:{workId:'work-1',sessionId:'session-1',modelPreference:saved?preference:null,source:{kind:'chat'}},messages:[],runs:[]}};
  });
  await button(page,'tab-Chat').click();await page.locator('#composer').fill('keep my message');
  await chooseModel(page,'model-test-0000000001');await expect(button(page,'send-message')).toBeDisabled();
  await expect(button(page,'check-session-model')).toBeVisible();await expect(button(page,'send-message')).toBeDisabled();
  assert.equal(requests.filter(r=>r.method==='PATCH').length,1);assert.equal(requests.filter(r=>r.path.endsWith('/runs')).length,0);
  await button(page,'check-session-model').click();await expect(button(page,'send-message')).toBeEnabled();await expect(page.locator('#composer')).toHaveValue('keep my message');
  assert.equal(requests.filter(r=>r.method==='PATCH').length,1);assert.equal(await api(page,"return adapter.getWork('work-1').sessions[0].modelPreference.modelRef"),preference.modelRef);
});

test('Brain saving preference survives a concurrent Session refresh and does not alter accepted Run metadata',async t=>{
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);t.after(async()=>release());
 const model={modelRef:'model-test-0000000001',label:'Test model',provider:'fixture',model:'one'};
 const {page}=await fixture(t,async r=>{
  if(r.path.endsWith('/sessions/session-1/model')){await gate;return{json:{workId:'work-1',sessionId:'session-1',modelPreference:{...model,availability:'available'}}};}
  if(r.path.endsWith('/sessions/session-1'))return{json:{session:{workId:'work-1',sessionId:'session-1',modelPreference:null,source:{kind:'chat'}},messages:[],runs:[{runId:'run-original',sessionId:'session-1',state:4,actualModel:{...model,model:'original'},source:{kind:'chat'}}]}};
 });
 await api(page,"adapter.selectModel('work-1','session-1','model-test-0000000001'); window.modelSave=adapter.saveModel('work-1','session-1');");
 await api(page,"await adapter.loadSessions('work-1')");release();await api(page,"await window.modelSave");
 assert.equal(await api(page,"return adapter.modelSelection('work-1','session-1').phase"),'clean');
 assert.equal(await api(page,"return adapter.getWork('work-1').sessions[0].modelPreference.modelRef"),model.modelRef);
 assert.equal(await api(page,"return adapter.getWork('work-1').sessions[0].runs[0].actualModel.model"),'original');
});

test('Brain rejected preference preserves confirmed value and message; foreign Session reply cannot confirm',async t=>{
 let foreign=false;
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/sessions/session-1/model'))return foreign?{json:{workId:'work-foreign',sessionId:'session-1',modelPreference:null}}:{status:409,json:{code:'MODEL_UNAVAILABLE',message:'Model was disabled'}};
 });
 await button(page,'tab-Chat').click();await page.locator('#composer').fill('draft survives');await chooseModel(page,'model-test-0000000001');await expect(button(page,'save-model')).toBeVisible();
 assert.equal(await api(page,"return adapter.getWork('work-1').sessions[0].modelPreference"),null);await expect(page.locator('#composer')).toHaveValue('draft survives');await expect(button(page,'send-message')).toBeDisabled();
 foreign=true;await button(page,'save-model').click();await expect(button(page,'check-session-model')).toBeVisible();assert.equal(requests.filter(r=>r.method==='PATCH').length,2);
});

test('Brain request pages use original IDs, historical retry stays readonly and lost live Retry uses one original-key GET',async t=>{
 const request={requestId:'req-original',goal:'Fix completed review',source:{kind:'service',serviceName:'workstation'},state:'needs_attention',disposition:'historical',runIds:[]};
 let historical=true,originalKey='';
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/agent-requests/req-original'))return{json:{request:{...request,disposition:historical?'historical':'live'},evidence:{items:[],nextCursor:null}}};
  if(r.path.endsWith('/agent-requests/req-original/retry')){originalKey=JSON.parse(r.body).submissionKey;return{abort:true};}
  if(r.path.endsWith('/retry-submission')){
   assert.equal(new URLSearchParams(r.search).get('submissionKey'),originalKey);
   return{json:{workId:'work-1',requestId:'req-original',submissionKey:originalKey,status:'accepted',request:{...request,requestId:'req-new',retryOf:'req-original',disposition:'live'}}};
  }
 });
 await assert.rejects(api(page,"await adapter.retryRequest('work-1','req-original')"));assert.equal(requests.filter(r=>r.method==='POST').length,0);
 historical=false;await assert.rejects(api(page,"await adapter.retryRequest('work-1','req-original')"));
 await assert.rejects(api(page,"await adapter.retryRequest('work-1','req-original')"));
 assert.equal(requests.filter(r=>r.method==='POST').length,1);
 const result=await api(page,"return adapter.checkRequestRetry('work-1','req-original')");
 assert.equal(result.requestId,'req-new');assert.equal(requests.filter(r=>r.method==='POST').length,1);
 assert.equal(requests.filter(r=>r.path.endsWith('/retry-submission')).length,1);
});

test('Brain request details keep imported history readonly and closing does not cancel',async t=>{
 const request={requestId:'request-historical',goal:'Original imported review',source:{kind:'service',serviceName:'workstation'},state:'needs_attention',disposition:'historical',runIds:[],expiresAt:'2026-10-05T00:00:00Z',waitRef:{kind:'job',serviceName:'workstation',id:'job-original',deadlineAt:'2026-10-05T00:00:00Z'}};
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/agent-requests'))return{json:{items:[request],nextCursor:null}};
  if(r.path.endsWith('/agent-requests/request-historical'))return{json:{request,evidence:{items:[{evidenceId:'proof-original',kind:'query',objectRef:'review',stateVersion:'2',verified:true}],nextCursor:null},runs:[]}};
 });
 await button(page,'tab-Chat').click();await button(page,'pi-requests').click();await expect(page.locator('#modal')).toContainText('Historical · Read only');await button(page,'pi-request-detail').click();
 await expect(page.locator('#modal')).toContainText('job-original');await expect(page.locator('#modal')).toContainText('Historical · Read only');await expect(page.locator('[data-action="retry-pi-request"]')).toHaveCount(0);await expect(page.locator('[data-action="cancel-pi-request"]')).toHaveCount(0);
 await button(page,'close-modal').click();assert.equal(requests.filter(r=>r.method==='POST').length,0);
});

const brainCandidate = {source:'Work files',operationId:'operation-candidate-original',requestId:'req-original',preparation:'succeeded',desired:true,active:false,adoption:'not-confirmed',
 baseline:{activeSelected:true,desiredSelected:true,activeMatchesCurrent:true,desiredMatchesCurrent:false},
 verification:{goal:'Verify the personal review export',toolName:'package:piwork-brain:review_probe',inputSummary:'{"mode":"review"}',checkNames:['review-success','export-present']},
 apply:{availability:'not-applied'}};

test('Brain package details expose acceptance and fixed checks, and open the original Apply and request',async t=>{
 const apply={availability:'available',operationId:'operation-apply-original',state:'failed',error:{code:'WORK_OPERATION_FAILED',message:'The prior active package was restored.'}};
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/configuration'))return{json:{desired:{skills:[],packages:[{name:'piwork-brain',enabled:true}],agentsMd:'',mcp:{servers:[]}},active:{},pendingApply:true,runtime:{state:'ready'}}};
  if(r.path.endsWith('/packages'))return{json:{packages:[{name:'piwork-brain',pendingApply:true,runtime:{availability:'available',loaded:true},candidate:{...brainCandidate,apply}}]}};
  if(r.path==='operations/operation-apply-original')return{json:{operationId:'operation-apply-original',workId:'work-1',kind:'apply-work-configuration',state:'failed',error:apply.error}};
  if(r.path.endsWith('/agent-requests/req-original'))return{json:{request:{requestId:'req-original',goal:'Verify the personal review export',source:{kind:'chat'},state:'needs_attention',disposition:'live',evidenceIds:[],runIds:[],error:{code:'PI_PACKAGE_CANDIDATE_CONFLICT',message:'Apply failed'}},evidence:{items:[],nextCursor:null},runs:[]}};
 });
 await button(page,'settings').click();await page.locator('[data-action="settings-section"][data-tab="Pi Packages"]').click();await expect(page.locator('#app')).toContainText('Saved · Not applied · Loaded');await expect(page.locator('#app')).toContainText('Behavior not confirmed');await button(page,'package-detail').click();await expect(page.locator('#modal')).toContainText('.pi/packages/piwork-brain/');
 const modal=page.locator('#modal');
 for(const text of ['Active selection at acceptance','Enabled at acceptance · Still matches','Saved selection at acceptance','Changed since acceptance','Verify the personal review export','package:piwork-brain:review_probe','{"mode":"review"}','review-success','export-present','Published','Apply failed','operation-apply-original','The prior active package was restored.'])await expect(modal).toContainText(text);
 for(const privateField of ['artifactDigest','contextId','credentialRef','sha256:'])assert.equal((await modal.innerText()).includes(privateField),false);
 await page.locator('[data-action="operation"][data-id="operation-apply-original"]').click();await expect(modal).toContainText('operation-apply-original');await expect(modal).toContainText('failed');assert.ok(requests.some(r=>r.path==='operations/operation-apply-original'&&r.method==='GET'));
 await button(page,'close-modal').click();await button(page,'package-detail').click();await button(page,'pi-request-detail').click();await expect(modal).toContainText('Verify the personal review export');assert.ok(requests.some(r=>r.path.endsWith('/agent-requests/req-original')&&r.method==='GET'));
 assert.equal(requests.filter(r=>r.path.endsWith('/apply')).length,0);
 assert.equal(requests.filter(r=>['POST','PUT','PATCH','DELETE'].includes(r.method)).length,0);
});

test('Brain details distinguish no Apply, observation failure and loaded behavior failure, retaining last confirmed details',async t=>{
 let fail=false,candidate={...brainCandidate} as Record<string,any>;
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/configuration'))return{json:{desired:{skills:[],packages:[{name:'piwork-brain',enabled:true}],agentsMd:'',mcp:{servers:[]}},active:{},pendingApply:true,runtime:{state:'ready'}}};
  if(r.path.endsWith('/packages'))return fail?{status:503,json:{message:'Package state unavailable'}}:{json:{packages:[{name:'piwork-brain',pendingApply:true,runtime:{availability:'available',loaded:true},candidate}]}};
 });
 await button(page,'settings').click();await page.locator('[data-action="settings-section"][data-tab="Pi Packages"]').click();await button(page,'package-detail').click();const modal=page.locator('#modal');await expect(modal).toContainText('No matching Apply');
 fail=true;await button(page,'refresh-package-detail').click();await expect(modal).toContainText('Package observation unavailable. Last confirmed details');await expect(modal).toContainText('Verify the personal review export');
 fail=false;candidate={...brainCandidate,adoption:'unavailable',apply:{availability:'unavailable'}};await button(page,'refresh-package-detail').click();await expect(modal).toContainText('Apply observation unavailable');await expect(modal).toContainText('Behavior observation unavailable');await expect(modal).not.toContainText('Package observation unavailable. Last confirmed details');await expect(modal).not.toContainText('No matching Apply');
 candidate={...brainCandidate,active:true,adoption:'failed',apply:{availability:'available',operationId:'operation-apply-original',state:'succeeded'}};await button(page,'refresh-package-detail').click();await expect(modal).toContainText('Apply succeeded');await expect(modal).toContainText('Behavior checks failed');await expect(modal).not.toContainText('Apply failed');
 assert.equal(requests.filter(r=>['POST','PUT','PATCH','DELETE'].includes(r.method)).length,0);
});

test('opening and refreshing the existing candidate detail action preserves the Service iframe document',async t=>{
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/services'))return{json:{services:[{serviceId:'service-todo',name:'Todo',enabled:true,observedState:'ready',access:{hostname:'todo.work',defaultPortName:'web',ports:[{name:'web',port:8080,url:'http://todo.work/'}]}}]}};
  if(r.path==='service-entries')return{json:{entryId:'entry-todo',entryUrl:base+'/_desktop/frame-app/',origin:base+'/_desktop/frame-app',embed:'allowed'}};
  if(r.path==='service-entries/entry-todo')return{json:{embed:'allowed'}};
  if(r.path==='/_desktop/frame-app/')return{headers:{'Content-Type':'text/html'},body:'<!doctype html><h1>Todo app</h1>'};
  if(r.path.endsWith('/packages'))return{json:{packages:[{name:'piwork-brain',runtime:{availability:'available',loaded:true},candidate:brainCandidate}]}};
 });
 await button(page,'tab-Services').click();const frame=page.frameLocator('iframe');await expect(frame.getByRole('heading',{name:'Todo app'})).toBeVisible();await frame.locator('body').evaluate(node=>{node.dataset.kept='same-document';});
 await api(page,"await adapter.loadPackages('work-1');");const writes=requests.filter(r=>['POST','PUT','PATCH','DELETE'].includes(r.method)).length;const loads=requests.filter(r=>r.path==='/_desktop/frame-app/').length;
 // Exercise the registered detail action while the Work's application remains
 // mounted; the action is normally reached from the Pi Packages selection.
 await page.evaluate(()=>{const action=document.createElement('button');action.dataset.action='package-detail';action.dataset.id='piwork-brain';document.querySelector('#app')!.append(action);action.click();});
 await expect(page.locator('#modal')).toContainText('Verify the personal review export');await button(page,'refresh-package-detail').click();await button(page,'close-modal').click();
 assert.equal(await frame.locator('body').getAttribute('data-kept'),'same-document');assert.equal(requests.filter(r=>r.path==='/_desktop/frame-app/').length,loads);assert.equal(requests.filter(r=>['POST','PUT','PATCH','DELETE'].includes(r.method)).length,writes);
});

const chatModel={modelRef:null as string|null,label:'Default chat model',provider:'fixture',model:'one',thinkingLevels:['off','low','high'],defaultThinkingLevel:'off'};
const chatModels=()=>({contractVersion:1,models:[],defaultModel:chatModel,availability:'available',checkedAt:new Date().toISOString()});

test('multi-provider Chat keeps other models and Thinking selectable when the Work default is unavailable',async t=>{
  const alternative={...chatModel,modelRef:'model-provider-00000001',label:'Other provider / Reasoning',provider:'openai',model:'gpt-5.1'};
  let ref:string|null=null,thinking='high';
  const {page,requests}=await fixture(t,r=>{
    if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:2}};
    if(r.path.endsWith('/chat-models'))return{json:{contractVersion:2,models:[alternative],defaultModel:null,defaultUnavailableReason:'Work default is disabled.',availability:'available',checkedAt:new Date().toISOString()}};
    if(r.path.endsWith('/chat-options')){if(r.method==='PATCH'){const input=JSON.parse(r.body);ref=input.modelRef;thinking=input.thinkingLevel;}return{json:{sessionId:'session-1',modelRef:ref,thinkingLevel:thinking,model:ref?alternative:chatModel,availability:ref?'available':'unavailable',checkedAt:new Date().toISOString()}};}
  });
  await button(page,'tab-Chat').click();await page.locator('#composer').fill('draft survives default revocation');await expect(button(page,'send-message')).toBeDisabled();
  await openResponseSettings(page,'model');await expect(page.locator('#modal')).toContainText('Work default is disabled');await page.locator(`[data-option-value="${alternative.modelRef}"]`).click();
  await expect.poll(()=>ref).toBe(alternative.modelRef);await expect(page.locator('#thinking-select')).toContainText('High');await closeResponseSettings(page);
  await expect(button(page,'send-message')).toBeEnabled();await expect(page.locator('#composer')).toHaveValue('draft survives default revocation');
  assert.equal(requests.filter(r=>r.method==='POST'&&r.path.endsWith('/runs')).length,0);assert.equal(thinking,'high');
});

test('multi-provider empty catalog preserves draft and saved Thinking through disable and reenable',async t=>{
  const alternative={...chatModel,modelRef:'model-provider-00000001',label:'Provider / Saved model',provider:'openai',model:'gpt-5.1'};
  let enabled=true,readFailure=false;
  const {page,requests}=await fixture(t,r=>{
    if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:2}};
    if(r.path.endsWith('/chat-models'))return readFailure?{status:503,json:{code:'MODEL_LIST_UNAVAILABLE',message:'Fixture read failed.'}}:{json:{contractVersion:2,models:enabled?[alternative]:[],defaultModel:null,defaultUnavailableReason:'No enabled models are available. Ask an administrator to enable a provider and model in AI models.',availability:'available',checkedAt:new Date().toISOString()}};
    if(r.path.endsWith('/chat-options'))return{json:{sessionId:'session-1',modelRef:alternative.modelRef,thinkingLevel:'high',model:alternative,availability:enabled?'available':'unavailable',checkedAt:new Date().toISOString()}};
  });
  await button(page,'tab-Chat').click();await page.locator('#composer').fill('preserved across all models disabled');await expect(button(page,'send-message')).toBeEnabled();
  enabled=false;await api(page,"await adapter.loadModels('work-1');");await openResponseSettings(page);
  await expect(page.locator('#response-settings-status')).toContainText('No enabled models');await expect(page.locator('#response-settings-status')).not.toContainText('Models are unconfirmed');await expect(button(page,'send-message')).toBeDisabled();
  const selection=await api(page,"return adapter.modelSelection('work-1','session-1');");assert.equal(selection.ref,alternative.modelRef);assert.equal(selection.thinking,'high');
  await closeResponseSettings(page);await expect(page.locator('#composer')).toHaveValue('preserved across all models disabled');await expect(page.locator('#messages')).toContainText('original prompt');
  enabled=true;await api(page,"await adapter.loadModels('work-1');");await expect(button(page,'send-message')).toBeEnabled();await openResponseSettings(page);await expect(page.locator('#thinking-select')).toContainText('High');await closeResponseSettings(page);
  readFailure=true;await api(page,"await adapter.loadModels('work-1').catch(()=>{});");await openResponseSettings(page);await expect(page.locator('#response-settings-status')).toContainText('Models are unconfirmed');await closeResponseSettings(page);
  assert.equal(chatWrites(requests).length,0);await expect(page.locator('#composer')).toHaveValue('preserved across all models disabled');
});

test('multi-provider Chat explains capability and SDK recovery without offering unsupported models',async t=>{
  const unavailableModels=[
    {modelRef:'model-custom-00000001',label:'Provider / Custom',provider:'openai',model:'custom',reason:'capabilities-unconfirmed',recovery:'Capabilities unconfirmed. Ask an administrator to configure a compatible model definition in AI models.'},
    {modelRef:'model-unsupported-00001',label:'Provider / New model',provider:'openai',model:'new-model',reason:'sdk-unsupported',recovery:'Unsupported by this Work Agent. Ask an administrator to check the model definition or update the Agent image, then Apply.'},
  ];
  const {page,requests}=await fixture(t,r=>{
    if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:2}};
    if(r.path.endsWith('/chat-models'))return{json:{...chatModels(),contractVersion:2,unavailableModels}};
    if(r.path.endsWith('/chat-options'))return{json:chatOptions('high')};
  });
  await button(page,'tab-Chat').click();await page.locator('#composer').fill('draft with compatibility hints');await openResponseSettings(page,'model');
  await expect(page.locator('#response-settings-status')).toContainText('Provider / Custom: Capabilities unconfirmed');await expect(page.locator('#response-settings-status')).toContainText('AI models');await expect(page.locator('#response-settings-status')).toContainText('Agent image, then Apply');
  await expect(page.locator('[data-option-value="model-custom-00000001"]')).toHaveCount(0);await expect(page.locator('#thinking-select')).toContainText('High');
  await closeResponseSettings(page);await expect(button(page,'send-message')).toBeEnabled();await expect(page.locator('#composer')).toHaveValue('draft with compatibility hints');assert.equal(chatWrites(requests).length,0);
});

for(const version of [0,1])test(`legacy Work Agent contract ${version} offers an explicit image upgrade and Apply recovery hint`,async t=>{
  const {page}=await fixture(t,r=>{
    if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:version}};
    if(r.path.endsWith('/chat-models'))return{json:chatModels()};
    if(r.path.endsWith('/chat-options'))return{json:chatOptions('high')};
  });
  await button(page,'tab-Chat').click();await openResponseSettings(page);await expect(page.locator('#response-settings-status')).toContainText('Update the Work Agent image and Apply');
});

test('multi-provider Chat contract retains active resource commands and explicit text semantics',async t=>{
  const submitted:Record<string,any>[]=[];
  const {page}=await fixture(t,r=>{
    if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:2}};
    if(r.path.endsWith('/chat-models'))return{json:chatModels()};
    if(r.path.endsWith('/commands'))return{json:{contractVersion:1,commands:[{kind:'skill',command:'/skill:managed',name:'managed',description:'Active skill',sourceName:'managed'}],checkedAt:new Date().toISOString()}};
    if(r.path.endsWith('/chat-options'))return{json:{sessionId:'session-1',modelRef:null,thinkingLevel:'off',model:chatModel,availability:'available',checkedAt:new Date().toISOString()}};
    if(r.path.endsWith('/runs')&&r.method==='POST'){submitted.push(JSON.parse(r.body));return{status:409,json:{code:'WORK_BUSY',message:'Fixture rejected acceptance after checking the request.'}};}
  });
  await button(page,'tab-Chat').click();
  await page.locator('#composer').fill('/skill:managed preserved');await expect(button(page,'send-message')).toBeEnabled();await page.locator('#composer').press('Escape');await button(page,'send-message').click();await expect.poll(()=>submitted.length).toBe(1);assert.equal(submitted[0]!.inputMode,'command');assert.equal(submitted[0]!.prompt,'/skill:managed preserved');
  await page.locator('#composer').fill('ordinary text');await button(page,'send-message').click();await expect.poll(()=>submitted.length).toBe(2);assert.equal(submitted[1]!.inputMode,'text');
});
const chatOptions=(thinkingLevel='off',model:Pick<typeof chatModel,'modelRef'|'label'|'provider'|'model'>=chatModel)=>({sessionId:'session-1',modelRef:model.modelRef,model:{modelRef:model.modelRef,label:model.label,provider:model.provider,model:model.model},thinkingLevel,availability:'available',checkedAt:new Date().toISOString()});

test('UX composer serializes complete pairs, retains latest revision, and defaults work with an empty catalog',async t=>{
 let release!:()=>void;const gate=new Promise<void>(done=>release=done);t.after(async()=>release());let active=0,max=0;const pairs:any[]=[];
 const {page}=await fixture(t,async r=>{
  if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:3}};
  if(r.path.endsWith('/chat-models'))return{json:chatModels()};
  if(r.path.endsWith('/chat-options') && r.method==='PATCH'){const pair=JSON.parse(r.body);pairs.push(pair);max=Math.max(max,++active);if(pairs.length===1)await gate;active--;return{json:chatOptions(pair.thinkingLevel)};}
 });
 await button(page,'tab-Chat').click();await expectThinkingEditable(page);await page.locator('#composer').fill('draft survives');await expect(button(page,'send-message')).toBeEnabled();
 await page.locator('#composer').fill('draft survives');await chooseThinking(page,'low',true);await chooseThinking(page,'high',true);
 await expect(page.locator('#modal #thinking-select')).toContainText('High');await expect(page.locator('#modal .options-status')).toContainText('Saving');
 await closeResponseSettings(page);await expect(button(page,'send-message')).toBeDisabled();assert.equal(pairs.length,1);release();await expect(button(page,'send-message')).toBeEnabled();
 assert.deepEqual(pairs,[{modelRef:null,thinkingLevel:'low'},{modelRef:null,thinkingLevel:'high'}]);assert.equal(max,1);await expect(page.locator('#composer')).toHaveValue('draft survives');assert.equal(await button(page,'save-model').count(),0);
});

test('UX unknown options only read original pair and never resend PATCH',async t=>{
 let saved='off';const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:3}};if(r.path.endsWith('/chat-models'))return{json:chatModels()};
  if(r.path.endsWith('/chat-options')){if(r.method==='PATCH'){saved=JSON.parse(r.body).thinkingLevel;return{abort:true};}return{json:chatOptions(saved)};}
 });
 await button(page,'tab-Chat').click();await expectThinkingEditable(page);await page.locator('#composer').fill('keep draft');await chooseThinking(page,'high');await expect(button(page,'check-session-model')).toBeVisible();await expect(button(page,'send-message')).toBeDisabled();
 await button(page,'check-session-model').click();await expect(button(page,'send-message')).toBeEnabled();assert.equal(requests.filter(r=>r.method==='PATCH').length,1);await expect(page.locator('.response-thinking')).toHaveText('· High');await expect(page.locator('#composer')).toHaveValue('keep draft');
});

test('UX slash menu fills on Enter, executes on next submit, preserves arguments and excludes Service identity',async t=>{
 const commands=[{kind:'prompt',command:'/review',name:'review',description:'Review supplied files',sourceName:'Work prompts'}];
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:3}};if(r.path.endsWith('/chat-models'))return{json:chatModels()};if(r.path.endsWith('/commands'))return{json:{contractVersion:1,commands,checkedAt:new Date().toISOString()}};
  if(r.path==='works/work-1/runs' && r.method==='POST')return{json:{run:{runId:'run-command',sessionId:'session-1',state:1}}};if(r.path.endsWith('/events'))return{abort:true};
 });
 await button(page,'tab-Chat').click();await page.locator('#composer').fill('/rev');await expect(button(page,'send-message')).toBeEnabled();await expect(page.locator('[role=option]').filter({hasText:'/review'})).toBeVisible();await page.locator('#composer').press('Enter');await expect(page.locator('#composer')).toHaveValue('/review ');assert.equal(requests.filter(r=>r.method==='POST').length,0);
 await page.locator('#composer').fill('/review "first argument"\tsecond');await button(page,'chat-input-options').click();await page.locator('#include-identity').check();await button(page,'close-modal').click();await page.locator('#composer').press('Enter');await expect.poll(()=>requests.filter(r=>r.path==='works/work-1/runs').length).toBe(1);
 const body=JSON.parse(requests.find(r=>r.path==='works/work-1/runs')!.body);assert.equal(body.inputMode,'command');assert.equal(body.prompt,'/review "first argument"\tsecond');assert.ok(body.submissionKey);assert.ok(!body.prompt.includes('Selected Service'));
});

test('UX web commands open controls without a Run, reject arguments and allow literal slash',async t=>{
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:3}};if(r.path.endsWith('/chat-models'))return{json:chatModels()};if(r.path.endsWith('/commands'))return{json:{contractVersion:1,commands:[],checkedAt:new Date().toISOString()}};
  if(r.path.endsWith('/runs') && r.method==='POST')return{json:{run:{runId:'run-literal',sessionId:'session-1',state:1}}};if(r.path.endsWith('/events'))return{abort:true};
 });
 await button(page,'tab-Chat').click();await page.locator('#composer').fill('/model');await expect(button(page,'send-message')).toBeEnabled();await page.locator('#composer').press('Escape');await button(page,'send-message').click();await expect(page.getByRole('heading',{name:'Response settings',exact:true})).toBeVisible();assert.equal(requests.filter(r=>r.method==='POST').length,0);await expect(page.locator('#composer')).toHaveValue('/model');await page.keyboard.press('Escape');await expect(page.locator('#composer')).toBeFocused();
 await page.locator('#composer').fill('/new extra');await button(page,'send-message').click();await expect(page.locator('#composer')).toHaveValue('/new extra');assert.equal(requests.filter(r=>r.method==='POST').length,0);
 await page.locator('#composer').fill('/arbitrary extension');await button(page,'toggle-slash-mode').click();await button(page,'send-message').click();const body=JSON.parse(requests.find(r=>r.path.endsWith('/runs') && r.method==='POST')!.body);assert.equal(body.inputMode,'text');assert.equal(body.prompt,'/arbitrary extension');
});

test('UX lost creation uses its original key; not-found stays unknown and recovery never submits a Run',async t=>{
 let found=false,key='';const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:3}};if(r.path.endsWith('/chat-models'))return{json:chatModels()};
  if(r.path.endsWith('/sessions')){if(r.method==='POST'){key=JSON.parse(r.body).idempotencyKey;return{abort:true};}return{json:{sessions:[]}};}
  if(r.path.includes('/sessions/submissions/'))return{json:found?{kind:'session',key,status:'accepted',session:{workId:'work-1',sessionId:'session-recovered',modelPreference:null,thinkingLevel:'off'}}:{kind:'session',key,status:'not-found'}};
 });
 await button(page,'tab-Chat').click();await page.locator('#composer').fill('original draft');await expect(button(page,'send-message')).toBeEnabled();await chooseThinking(page,'high');await button(page,'send-message').click();await expect(button(page,'check-chat-submission')).toBeVisible();await button(page,'check-chat-submission').click();await expect(button(page,'send-message')).toBeDisabled();found=true;await button(page,'check-chat-submission').click();await expect.poll(()=>api(page,"return adapter.getWork('work-1').sessions.length")).toBe(1);
 await expect(page.locator('.response-thinking')).toHaveText('· High');await expect(page.locator('#composer')).toHaveValue('original draft');await expect(button(page,'send-message')).toBeDisabled();await expect(button(page,'save-model')).toBeVisible();assert.equal(requests.filter(r=>r.method==='PATCH').length,0);
 assert.equal(requests.filter(r=>r.method==='POST').length,1);assert.ok(key);assert.equal(requests.filter(r=>r.path.endsWith('/runs')).length,0);assert.equal(await api(page,"return adapter.getWork('work-1').sessions[0].id"),'session-recovered');
});

test('UX Focus changes preserve Service document, Chat node, draft and expanded Activity at 360px',async t=>{
 const {page}=await fixture(t,r=>{
  if(r.path.endsWith('/services'))return{json:{services:[{serviceId:'service-a',name:'Tool A',enabled:true,observedState:'ready',access:{hostname:'a.w-one.work',ports:[{port:80,url:'http://a.w-one.work',name:'web'}]}}]}};
  if(r.path==='service-entries')return{json:{entryId:'entry-a',origin:'http://service.test',entryUrl:'about:blank',embed:'allowed'}};if(r.path==='service-entries/entry-a')return{json:{embed:'allowed'}};
 });
 await button(page,'tab-Services').click();await expect(page.locator('iframe')).toBeVisible();await page.locator('#composer').fill('unsaved draft');
 await api(page,"adapter.getWork('work-1').sessions[0].messages=[{id:'call-one',runId:'run-one',role:'assistant',text:'',tool:{id:'call-one',name:'read',status:'Completed',content:'result'}}];adapter.subscribe(()=>{});await adapter.loadModels('work-1');");
 await page.locator('.activity summary').first().click();await page.evaluate(()=>{(window as any).originalFrame=document.querySelector('iframe');(window as any).originalComposer=document.querySelector('#composer');(document.querySelector('iframe')!.contentDocument!.body as HTMLElement).dataset.unsaved='same';});
 await button(page,'service-focus').click();await button(page,'focus-toggle-chat').click();await expect(page.locator('#composer')).toBeHidden();await button(page,'focus-toggle-chat').click();await expect(page.locator('#composer')).toHaveValue('unsaved draft');assert.equal(await page.locator('.activity').evaluate((node:HTMLDetailsElement)=>node.open),true);
 await page.setViewportSize({width:360,height:800});await expect(button(page,'exit-service-focus')).toBeVisible();assert.equal(await page.evaluate(()=>document.querySelector('iframe')===(window as any).originalFrame),true);assert.equal(await page.evaluate(()=>document.querySelector('#composer')===(window as any).originalComposer),true);assert.equal(await page.locator('iframe').evaluate((node:HTMLIFrameElement)=>node.contentDocument!.body.dataset.unsaved),'same');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.evaluate(()=>{Object.defineProperty(document.querySelector('#app'),'requestFullscreen',{configurable:true,value:()=>Promise.reject(new Error('denied'))});});await openFullscreenOptions(page);await button(page,'service-fullscreen').click();await expect(page.locator('.service-toolbar')).toContainText('Focus remains available');await button(page,'exit-service-focus').click();await expect(button(page,'service-focus')).toBeVisible();
});

test('UX full screen is independent from Focus and browser exit keeps the original frame',async t=>{
 const {page}=await fixture(t,r=>{
  if(r.path.endsWith('/services'))return{json:{services:[{serviceId:'service-a',name:'Tool A',enabled:true,observedState:'ready',access:{hostname:'a.w-one.work',ports:[{port:80,url:'http://a.w-one.work',name:'web'}]}}]}};
  if(r.path==='service-entries')return{json:{entryId:'entry-a',origin:'http://service.test',entryUrl:'about:blank',embed:'allowed'}};if(r.path==='service-entries/entry-a')return{json:{embed:'allowed'}};
 });
 await button(page,'tab-Services').click();await expect(page.locator('iframe')).toBeVisible();await page.evaluate(()=>{(window as any).focusFrame=document.querySelector('iframe')});await button(page,'service-focus').click();assert.equal(await page.evaluate(()=>!!document.fullscreenElement),false);await openFullscreenOptions(page);await button(page,'service-fullscreen').click();await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
 await page.evaluate(()=>document.exitFullscreen());await expect(button(page,'exit-service-focus')).toBeVisible();assert.equal(await page.evaluate(()=>document.querySelector('iframe')===(window as any).focusFrame),true);await openFullscreenOptions(page);await button(page,'service-fullscreen').click();await button(page,'exit-service-focus').click();await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);await expect(button(page,'service-focus')).toBeVisible();
});

function focusFixture(r: RequestRecord): Reply | undefined {
  if (r.path.endsWith('/services')) return { json: { services: ['a','b'].map(id => ({ serviceId:`service-${id}`,name:`Tool ${id.toUpperCase()}`,enabled:true,observedState:'ready',access:{hostname:`${id}.work.test`,ports:[{port:80,url:`http://${id}.work.test`,name:'web'}]} })) } };
  if (r.path === 'service-entries') return { json: {entryId:'entry-focus',origin:base,entryUrl:base+'/_desktop/focus-app/',embed:'allowed'} };
  if (r.path === 'service-entries/entry-focus') return { json: { embed:'allowed' } };
  if (r.path === '/_desktop/focus-app/') return { body:'<html><body><input aria-label="Application draft"><p>Original application</p></body></html>',headers:{'Content-Type':'text/html'} };
}

test('an opened application survives temporary Service Starting without retaining stopped or disabled frames', async t => {
  let observed = 'ready', enabled = true;
  let port = 80;
  const { page } = await fixture(t, r => {
    if (r.path === 'works/work-1') return { json: { id: 'work-1', name: 'Recovery Work', desiredState: 'running', observedState: observed === 'starting' ? 'degraded' : 'ready' } };
    if (r.path.endsWith('/services')) return { json: { services: [{ serviceId: 'service-a', name: 'Tool A', enabled, observedState: observed,
      access: { hostname: 'a.work.test', ports: [{ port, url: 'http://a.work.test', name: 'web' }] } }] } };
    return focusFixture(r);
  });
  await expect(page.locator('iframe')).toBeVisible();
  await page.frameLocator('iframe').getByLabel('Application draft').fill('keep this open input');
  await page.evaluate(() => { (window as any).startingFrame = document.querySelector('iframe'); });
  observed = 'starting'; await api(page, "await adapter.refreshVisibleWork('work-1');");
  await expect(page.locator('.service-trigger')).toContainText('Starting');
  assert.equal(await page.evaluate(() => document.querySelector('iframe') === (window as any).startingFrame), true);
  await expect(page.frameLocator('iframe').getByLabel('Application draft')).toHaveValue('keep this open input');
  observed = 'ready'; await api(page, "await adapter.refreshVisibleWork('work-1');");
  assert.equal(await page.evaluate(() => document.querySelector('iframe') === (window as any).startingFrame), true);
  await expect(page.frameLocator('iframe').getByLabel('Application draft')).toHaveValue('keep this open input');
  observed = 'stopped'; await api(page, "await adapter.loadServices('work-1');");
  await expect(page.locator('iframe')).toHaveCount(0);
  observed = 'starting'; await api(page, "await adapter.loadServices('work-1');");
  await expect(page.locator('iframe')).toHaveCount(0);
  observed = 'ready'; await api(page, "await adapter.loadServices('work-1');");
  await expect(page.locator('iframe')).toBeVisible();
  enabled = false; observed = 'starting'; await api(page, "await adapter.loadServices('work-1');");
  await expect(page.locator('iframe')).toHaveCount(0);
  enabled = true; observed = 'ready'; await api(page, "await adapter.refreshVisibleWork('work-1');");
  await expect(page.locator('iframe')).toBeVisible();
  port = 81; observed = 'starting'; await api(page, "await adapter.refreshVisibleWork('work-1');");
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('UX revision late Work defaults retain a chosen Service and focused Files draft', async t => {
  let release!:()=>void;const gate=new Promise<void>(done=>release=done);t.after(async()=>release());
  const {page}=await fixture(t,async r=>{
    if(r.path.endsWith('/configuration'))await gate;
    if(r.path.startsWith('/_desktop/files/'))return r.method==='PROPFIND'?{status:207,body:listing('original file',mtime1),headers:{'Content-Type':'application/xml'}}:{body:'original file',headers:{'Last-Modified':mtime1}};
    return focusFixture(r);
  }, false, false);
  await page.locator('#service-select').click();await page.locator('[data-action=select-service][data-id=service-b]').click();
  await button(page,'tab-Files').click();await button(page,'open-file').click();await page.locator('#file-editor').fill('edit made before Work finished opening');
  await button(page,'focus-chat').click();release();await expect(page.locator('#response-settings-trigger')).toBeEnabled();await page.waitForLoadState('networkidle');
  await expect(page.locator('#app')).toHaveAttribute('data-layout','chat-only');await button(page,'restore-layout').click();
  await expect(button(page,'tab-Files')).toHaveClass(/active/);await expect(page.locator('#file-editor')).toHaveValue('edit made before Work finished opening');
  await page.locator('#file-editor').fill('original file');await button(page,'tab-Services').click();await expect(page.locator('#service-select')).toHaveAttribute('data-service-id','service-b');
});

test('UX revision Focus chat restores its prior layout or directly exits without reloading any ancestor', async t => {
  const {page,requests} = await fixture(t, focusFixture);
  await expect(page.locator('iframe')).toBeVisible();
  await page.frameLocator('iframe').getByLabel('Application draft').fill('unsaved application');
  await page.locator('#composer').fill('unsaved chat');
  const messages = Array.from({length:35},(_,i)=>({id:`focus-prose-${i}`,role:'assistant',text:`Paragraph ${i} ${'Saved conversation. '.repeat(18)}`}));
  messages.splice(10,0,{id:'focus-activity',runId:'focus-run',role:'assistant',text:'',tool:{id:'focus-tool',name:'read',status:'Completed',content:'saved tool result'}} as any);
  await api(page,`adapter.getWork('work-1').sessions[0].messages=${JSON.stringify(messages)};await adapter.loadModels('work-1');`);
  await page.locator('.activity summary').first().click();
  await page.locator('#messages').evaluate(node=>{node.scrollTop=node.scrollHeight/2;node.dispatchEvent(new Event('scroll'));});
  await page.waitForTimeout(30);
  await page.evaluate(()=>{
    const frame=document.querySelector('iframe')!; const ancestors:Node[]=[];
    for(let node:Node|null=frame;node;node=node.parentNode) ancestors.push(node);
    (window as any).focusOriginal={frame,ancestors,composer:document.querySelector('#composer'),messages:document.querySelector('#messages'),loads:0};
    frame.addEventListener('load',()=>{(window as any).focusOriginal.loads++;});
  });
  const anchor = await page.locator('#messages').evaluate(node=>{const top=node.getBoundingClientRect().top;const first=[...node.querySelectorAll<HTMLElement>('[data-message-key]')].find(item=>item.getBoundingClientRect().bottom>top)!;return{key:first.dataset.messageKey,offset:first.getBoundingClientRect().top-top};});
  const entries=requests.filter(r=>r.path==='service-entries').length, mutations=requests.filter(r=>['POST','PATCH','PUT','DELETE'].includes(r.method)).length;
  const assertKept=async()=>{
    assert.equal(await page.evaluate(()=>{const saved=(window as any).focusOriginal;let node:Node|null=document.querySelector('iframe');return saved.ancestors.every((ancestor:Node)=>{const same=node===ancestor;node=node?.parentNode ?? null;return same;}) && document.querySelector('#composer')===saved.composer && document.querySelector('#messages')===saved.messages && saved.loads===0;}),true);
    await expect(page.frameLocator('iframe').getByLabel('Application draft')).toHaveValue('unsaved application');
    await expect(page.locator('#composer')).toHaveValue('unsaved chat');
    assert.equal(await page.locator('.activity').evaluate((node:HTMLDetailsElement)=>node.open),true);
    assert.equal(requests.filter(r=>r.path==='service-entries').length,entries);
    assert.equal(requests.filter(r=>['POST','PATCH','PUT','DELETE'].includes(r.method)).length,mutations);
  };
  await button(page,'service-focus').click(); await button(page,'focus-chat').click();
  await expect(page.locator('#app')).toHaveAttribute('data-layout','chat-only');
  await expect(page.getByRole('button',{name:'Restore layout',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Exit focus',exact:true})).toBeVisible();
  await expect(page.locator('iframe')).toBeHidden();
  await assertKept();
  await button(page,'agent-menu').click(); await expect(page.getByRole('menuitem',{name:'Restore layout',exact:true})).toBeVisible(); await expect(page.getByRole('menuitem',{name:'Focus chat',exact:true})).toHaveCount(0); await page.keyboard.press('Escape');
  await expect(page.locator('#modal')).toHaveCount(0);
  await button(page,'restore-layout').click(); await expect(page.locator('#app')).toHaveAttribute('data-layout','service-chat');
  await assertKept();
  const offset=await page.locator('#messages').evaluate((node,key)=>{const item=[...node.querySelectorAll<HTMLElement>('[data-message-key]')].find(item=>item.dataset.messageKey===key)!;return item.getBoundingClientRect().top-node.getBoundingClientRect().top;},anchor.key);
  assert.ok(Math.abs(offset-anchor.offset)<2,`Layout moved reading anchor ${offset-anchor.offset}px`);
  await button(page,'exit-service-focus').click(); await expect(page.locator('.work-tabs')).toBeVisible(); await assertKept();
  await button(page,'service-focus').click(); await button(page,'focus-chat').click(); await button(page,'exit-service-focus').click();
  await expect(page.locator('#app')).toHaveAttribute('data-layout','workspace'); await expect(page.locator('.work-tabs')).toBeVisible(); await assertKept();
  await button(page,'service-focus').click(); await button(page,'focus-toggle-chat').click();
  await button(page,'service-menu').click(); await page.getByRole('menuitem',{name:'Focus chat',exact:true}).click();
  await button(page,'restore-layout').click(); await expect(page.locator('#app')).toHaveAttribute('data-layout','service-only'); await expect(page.locator('#composer')).toBeHidden();
  await button(page,'exit-service-focus').click(); await assertKept();
});

test('UX revision Files and ordinary Chat remain distinct from Focus chat and preserve explicit selections', async t => {
  const {page}=await fixture(t,r=>{
    if(r.path.startsWith('/_desktop/files/')) return r.method==='PROPFIND'?{status:207,body:listing('original file',mtime1),headers:{'Content-Type':'application/xml'}}:{body:'original file',headers:{'Last-Modified':mtime1}};
    if(r.path.endsWith('/sessions')) return{json:{sessions:[{sessionId:'session-1'},{sessionId:'session-2'}]}};
    if(r.path.endsWith('/sessions/session-2')) return{json:{session:{sessionId:'session-2',workId:'work-1',modelPreference:null,source:{kind:'chat'}},messages:[{role:'user',text:'Other saved conversation'}],runs:[]}};
    return focusFixture(r);
  });
  await button(page,'tab-Files').click();await button(page,'open-file').click();await page.locator('#file-editor').fill('unsaved file edit');
  await page.evaluate(()=>{(window as any).originalFileEditor=document.querySelector('#file-editor');});
  await button(page,'focus-chat').click();await expect(page.locator('#file-editor')).toBeHidden();
  await button(page,'restore-layout').click();await expect(page.locator('#file-editor')).toHaveValue('unsaved file edit');
  assert.equal(await page.evaluate(()=>document.querySelector('#file-editor')===(window as any).originalFileEditor),true);
  await page.locator('#file-editor').fill('original file');await button(page,'tab-Chat').click();await expect(page.locator('.work-tabs')).toBeVisible();
  await button(page,'focus-chat').click();await button(page,'restore-layout').click();await expect(button(page,'tab-Chat')).toHaveClass(/active/);await expect(page.locator('.work-tabs')).toBeVisible();
  await button(page,'tab-Services').click();await button(page,'service-focus').click();await page.locator('#service-select').click();await page.locator('[data-action=select-service][data-id=service-b]').click();
  await button(page,'sessions').click();await page.locator('[data-action=select-session][data-id=session-2]').click();
  await button(page,'focus-chat').click();await button(page,'exit-service-focus').click();
  await expect(page.locator('#service-select')).toHaveAttribute('data-service-id','service-b');
  assert.equal(await api(page,"return adapter.getWork('work-1').sessions.find(s=>s.id==='session-2').messages[0].text"),'Other saved conversation');
  await expect(page.locator('.session-line')).toContainText('Session 2');
});

test('UX revision Focus icons use their toolbar roles and Escape closes exactly one level', async t => {
  const {page,requests}=await fixture(t,r=>{
    if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:3}};
    if(r.path.endsWith('/chat-models'))return{json:chatModels()};
    return focusFixture(r);
  });
  await expect(page.locator('#response-settings-trigger')).toBeEnabled();
  const shape=async(action:string)=>button(page,action).evaluate(node=>{const box=node.getBoundingClientRect(),css=getComputedStyle(node);return{width:box.width,height:box.height,borderRadius:css.borderRadius,padding:css.padding};});
  assert.deepEqual(await shape('service-focus'),await shape('service-menu'));
  assert.deepEqual(await shape('service-focus'),await shape('open-app'));
  await expect(button(page,'service-focus')).toHaveClass(/icon-button quiet/);
  await expect(button(page,'service-focus')).toHaveAttribute('title','Focus');
  await expect(button(page,'service-focus')).toHaveAttribute('aria-label','Focus');
  await button(page,'service-focus').focus();await page.keyboard.press('Enter');
  await expect(button(page,'focus-toggle-chat')).toHaveAttribute('aria-pressed','true');
  await button(page,'focus-chat').click();
  for(const action of ['restore-layout','exit-service-focus']) {
    assert.deepEqual(await shape(action),await shape('agent-menu'));
    await expect(button(page,action)).toHaveClass(/icon-button quiet/);
    await expect(button(page,action).locator('svg')).toHaveCount(1);
    assert.equal(await button(page,action).getAttribute('title'),await button(page,action).getAttribute('aria-label'));
  }
  await expect(page.locator('.agent-header [data-action=service-fullscreen]')).toHaveCount(0);
  await openResponseSettings(page,'thinking');await page.keyboard.press('Escape');
  await expect(page.locator('#response-settings-trigger')).toBeFocused();await expect(page.locator('#app')).toHaveAttribute('data-layout','chat-only');
  assert.equal(requests.filter(r=>r.method==='PATCH').length,0);
  await page.locator('#composer').fill('/mo');await expect(page.locator('.command-palette')).toBeVisible();await page.locator('#composer').press('Escape');
  await expect(page.locator('.command-palette')).toHaveCount(0);await expect(page.locator('#app')).toHaveAttribute('data-layout','chat-only');
  await page.keyboard.press('Escape');await expect(page.locator('#app')).toHaveAttribute('data-layout','service-chat');
  await expect(button(page,'focus-chat')).toBeFocused();
  await page.setViewportSize({width:360,height:800});
  await expect(button(page,'focus-chat')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-layout','service-only');await expect(page.locator('#composer')).toBeHidden();
  await page.keyboard.press('Escape');await expect(page.locator('#app')).toHaveAttribute('data-layout','workspace');
  await expect(button(page,'service-focus')).toBeFocused();
});

test('UX revision fullscreen failures keep Chat exits and browser exit preserves the Focus layout', async t => {
  const {page}=await fixture(t,r=>{
    if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:3}};
    if(r.path.endsWith('/chat-models'))return{json:chatModels()};
    return focusFixture(r);
  });
  await button(page,'service-focus').click();await button(page,'focus-chat').click();
  await page.evaluate(()=>{const root=document.querySelector('#app')!;(window as any).nativeFullscreen=root.requestFullscreen;Object.defineProperty(root,'requestFullscreen',{configurable:true,value:()=>Promise.reject(new Error('denied'))});});
  await openFullscreenOptions(page);await button(page,'service-fullscreen').click();await expect(page.locator('.agent-panel')).toContainText('Focus remains available');
  await expect(button(page,'restore-layout')).toBeVisible();await expect(button(page,'exit-service-focus')).toBeVisible();
  await page.evaluate(()=>{Object.defineProperty(document.querySelector('#app'),'requestFullscreen',{configurable:true,value:(window as any).nativeFullscreen});});
  await openFullscreenOptions(page);await button(page,'service-fullscreen').click();await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
  await openResponseSettings(page,'model');await page.keyboard.press('Escape');
  await expect(page.locator('#modal')).toHaveCount(0);await expect(page.locator('#response-settings-trigger')).toBeFocused();
  assert.equal(await page.evaluate(()=>!!document.fullscreenElement),true);await expect(page.locator('#app')).toHaveAttribute('data-layout','chat-only');
  await page.evaluate(()=>document.exitFullscreen());await openFullscreenOptions(page);await expect(button(page,'service-fullscreen')).toHaveAttribute('aria-pressed','false');await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-layout','chat-only');
  await openFullscreenOptions(page);await button(page,'service-fullscreen').click();await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
  await page.evaluate(()=>{(window as any).nativeExit=document.exitFullscreen;Object.defineProperty(document,'exitFullscreen',{configurable:true,value:()=>Promise.reject(new Error('denied'))});});
  await button(page,'exit-service-focus').click();await expect(page.locator('.agent-panel')).toContainText('Full screen could not be closed');
  await expect(page.locator('#app')).toHaveAttribute('data-layout','chat-only');assert.equal(await page.evaluate(()=>!!document.fullscreenElement),true);
  await page.evaluate(()=>{Object.defineProperty(document,'exitFullscreen',{configurable:true,value:(window as any).nativeExit});});
  await button(page,'exit-service-focus').click();await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);
  await expect(page.locator('#app')).toHaveAttribute('data-layout','workspace');
});

test('UX revision cross-origin keys and lost preview or Work qualification always retain an exit', async t => {
  let stopped=false,denied=false;
  const {page}=await fixture(t,r=>{
    if(r.path==='works/work-1' && stopped)return{json:{id:'work-1',name:'Recovery Work',observedState:'stopped',desiredState:'stopped'}};
    if(r.path==='service-entries')return{json:{entryId:'entry-focus',origin:'http://frame.work.test',entryUrl:'http://frame.work.test/',embed:'allowed'}};
    if(r.path==='service-entries/entry-focus')return{json:{embed:denied?'denied':'allowed'}};
    return focusFixture(r);
  });
  await page.route('http://frame.work.test/**',route=>route.fulfill({contentType:'text/html',body:'<input aria-label="Cross origin draft">'}));
  // Explicitly reload the fixture document after installing its cross-origin route.
  await page.locator('iframe').evaluate((frame:HTMLIFrameElement)=>frame.src='http://frame.work.test/');
  await page.frameLocator('iframe').getByLabel('Cross origin draft').fill('retained across layout');
  await button(page,'service-focus').click();await page.frameLocator('iframe').getByLabel('Cross origin draft').press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-layout','service-chat');await expect(button(page,'exit-service-focus')).toBeVisible();
  denied=true;await api(page,"await adapter.serviceFrameLoaded('work-1','service-a',80);");
  await expect(page.locator('iframe')).toHaveCount(0);await expect(button(page,'exit-service-focus')).toBeVisible();
  await button(page,'focus-chat').click();stopped=true;await api(page,"await adapter.refreshWorkStatus('work-1');");
  await expect(page.locator('.focus-unavailable')).toBeVisible();await expect(button(page,'exit-service-focus')).toBeVisible();
  await button(page,'exit-service-focus').click();await expect(page.locator('#app')).toHaveAttribute('data-layout','workspace');
  await expect(page.locator('.work-tabs')).toBeVisible();
});

test('UX revision standalone Service Focus never reads Chat settings or creates a conversation', async t => {
  let stopped=false;
  const {page,requests}=await fixture(t,r=>{
    if(r.path==='works/work-1' && stopped)return{json:{id:'work-1',name:'Recovery Work',observedState:'stopped',desiredState:'stopped'}};
    return focusFixture(r);
  });
  await expect(page.locator('iframe')).toBeVisible();const before=requests.length;
  await page.goto(base+'/#/app/work-1/service-a/80');await expect(page.locator('.standalone-app')).toBeVisible();
  await button(page,'service-focus').click();await expect(page.locator('#app')).toHaveAttribute('data-layout','service-only');
  assert.equal(await page.locator('#composer').count(),0);assert.equal(await button(page,'focus-toggle-chat').count(),0);
  await button(page,'exit-service-focus').click();await expect(page.locator('#app')).toHaveAttribute('data-layout','workspace');
  stopped=true;await api(page,"await adapter.refreshVisibleWork('work-1');");stopped=false;await api(page,"await adapter.refreshVisibleWork('work-1');");
  await expect(page.locator('iframe')).toBeVisible();
  assert.equal(requests.slice(before).filter(r=>/\/(sessions|runs|models|chat-models|chat-capabilities|commands)(\/|$)/.test(r.path)).length,0);
  await page.getByRole('button',{name:'Back to Work',exact:true}).click();await expect(page.locator('.work-tabs')).toBeVisible();
});

test('UX revision composer geometry aligns all controls and long model names remain usable at 360px', async t => {
  const label='DeepSeek Flash with a deliberately long model name for a narrow composer';
  const {page}=await fixture(t,r=>{
    if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:3}};
    if(r.path.endsWith('/chat-models'))return{json:{...chatModels(),defaultModel:{...chatModel,label,thinkingLevels:['off','low','high','max']}}};
  });
  await button(page,'tab-Chat').click();await expectThinkingEditable(page);
  const boxes=await page.locator('#response-settings-trigger,[data-action=send-message],[data-action=chat-input-options]').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{action:node.getAttribute("data-action"),top:r.top,height:r.height,center:r.top+r.height/2,width:r.width};}));
  assert.equal(boxes.length,3);for(const rect of boxes) {assert.equal(rect.height,rect.action==='send-message'?34:31,JSON.stringify(boxes));assert.ok(Math.abs(rect.center-boxes[0]!.center)<1);}
  assert.ok(boxes[0]!.width<=320);
  await expect(page.locator('#response-settings-trigger')).toHaveAttribute('title',label+' (one) · Work default · Thinking Off');
  await page.setViewportSize({width:360,height:800});await openResponseSettings(page,'model');
  await expect(page.locator('#modal [role=option]')).toHaveText(label+' (one)Use Work default');
  await expect(page.locator('#modal .response-setting-value').first()).toHaveText(label+' (one)Work default');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.ok(await page.locator('#modal [role=option]').evaluate(node=>node.scrollWidth<=node.clientWidth));
  await page.keyboard.press('Escape');await expect(button(page,'send-message')).toBeVisible();
  await api(page,"const state=adapter.modelSelection('work-1','session-1');state.phase='unknown';state.error='Chat settings could not be confirmed. Your draft is kept.';await adapter.loadModels('work-1');");
  await expect(button(page,'check-session-model')).toBeVisible();await expect(page.locator('.options-status')).toContainText('could not be confirmed');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const send=await button(page,'send-message').boundingBox(),retry=await button(page,'check-session-model').boundingBox();
  assert(send && retry && send.x>=0 && send.x+send.width<=360 && retry.x>=0 && retry.x+retry.width<=360);
});

test('UX revision slash Thinking opens the actual SDK choices and consumes only confirmed selections', async t => {
  let release!:()=>void;const gate=new Promise<void>(done=>release=done);t.after(async()=>release());let saved='off';
  const {page,requests}=await fixture(t,async r=>{
    if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:3}};
    if(r.path.endsWith('/chat-models'))return{json:{...chatModels(),defaultModel:{...chatModel,thinkingLevels:['off','low','high','max']}}};
    if(r.path.endsWith('/commands'))return{json:{contractVersion:1,commands:[],checkedAt:new Date().toISOString()}};
    if(r.path.endsWith('/chat-options')){if(r.method==='PATCH'){saved=JSON.parse(r.body).thinkingLevel;await gate;}return{json:chatOptions(saved)};}
    return focusFixture(r);
  });
  await expectThinkingEditable(page);await button(page,'service-focus').click();await button(page,'focus-chat').click();
  await api(page,"adapter.getWork('work-1').run={id:'current-run',sessionId:'session-1',status:'running',actualModel:{label:'Previous model',model:'one'},thinkingLevel:'off'};await adapter.loadModels('work-1');");
  const actual=await api(page,"return JSON.stringify(adapter.getWork('work-1').run);");
  await openResponseSettings(page,'thinking');const direct=await page.locator('#modal [role=option]').allTextContents();await page.keyboard.press('Escape');
  await page.locator('#composer').fill('/thinking');await page.locator('#composer').press('Escape');await button(page,'send-message').click();
  assert.deepEqual(await page.locator('#modal [role=option]').allTextContents(),direct);assert.deepEqual(direct,['Off','Low','High','Max']);
  assert.equal(requests.filter(r=>r.method==='PATCH').length,0);
  await page.keyboard.press('End');await expect(page.locator('#modal [data-option-value=max]')).toBeFocused();
  await page.locator('#modal [data-option-value=max]').evaluate(node=>{node.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));});
  assert.equal(requests.filter(r=>r.method==='PATCH').length,0);
  await page.keyboard.press('Enter');await expect(page.locator('#modal .options-status')).toContainText('Saving');
  await expect(page.locator('#composer')).toHaveValue('/thinking');release();await expect(page.locator('#composer')).toHaveValue('');
  await expect(page.locator('.response-thinking')).toHaveText('· Max');
  assert.equal(await api(page,"return JSON.stringify(adapter.getWork('work-1').run);"),actual);
  assert.equal(requests.filter(r=>r.path.endsWith('/runs') && r.method==='POST').length,0);
  await closeResponseSettings(page);
  await page.locator('#composer').fill('/model');await page.locator('#composer').press('Escape');await button(page,'send-message').click();await page.keyboard.press('Escape');
  await expect(page.locator('#composer')).toHaveValue('/model');assert.equal(requests.filter(r=>r.method==='PATCH').length,1);await expect(page.locator('#app')).toHaveAttribute('data-layout','chat-only');
});

test('UX revision truly nonreasoning and unavailable capabilities show distinct reasons without fabricated levels', async t => {
  let mode='plain';
  const {page,requests}=await fixture(t,r=>{
    if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:3}};
    if(r.path.endsWith('/chat-models'))return mode==='plain'?{json:{...chatModels(),defaultModel:{...chatModel,thinkingLevels:['off']}}}:{status:503,json:{code:'MODEL_NOT_SUPPORTED',message:'Thinking capabilities could not be confirmed'}};
  });
  await button(page,'tab-Chat').click();await openResponseSettings(page);await expect(page.locator('#thinking-select')).toBeDisabled();await expect(page.locator('#thinking-select')).toContainText('Off');await closeResponseSettings(page);
  await expect(page.locator('.options-status')).toContainText('Thinking is not supported by this model');await page.locator('#composer').fill('A valid ordinary draft');await expect(button(page,'send-message')).toBeEnabled();
  mode='unknown';await api(page,"await adapter.loadModels('work-1').catch(()=>undefined);");await expect(page.locator('.options-status')).toContainText('could not be confirmed');
  await expect(button(page,'send-message')).toBeDisabled();await openResponseSettings(page);await expect(page.locator('#thinking-select')).toBeDisabled();await closeResponseSettings(page);
  assert.equal(await page.locator('#modal [role=option]').count(),0);assert.equal(requests.filter(r=>r.method==='PATCH').length,0);
});

test('UX revision lost slash settings preserve edited drafts and recover with one readonly check', async t => {
  let saved='off';
  const {page,requests}=await fixture(t,r=>{
    if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:3}};
    if(r.path.endsWith('/chat-models'))return{json:chatModels()};
    if(r.path.endsWith('/commands'))return{json:{contractVersion:1,commands:[],checkedAt:new Date().toISOString()}};
    if(r.path.endsWith('/chat-options')){if(r.method==='PATCH'){saved=JSON.parse(r.body).thinkingLevel;return{abort:true};}return{json:chatOptions(saved)};}
  });
  await button(page,'tab-Chat').click();await expectThinkingEditable(page);
  await page.locator('#composer').fill('/thinking');await page.locator('#composer').press('Escape');await button(page,'send-message').click();
  await page.locator('#modal [data-option-value=high]').click();await expect(page.locator('#modal [data-action=check-session-model]')).toBeVisible();await closeResponseSettings(page);
  await expect(page.locator('#composer')).toHaveValue('/thinking');await page.locator('#composer').fill('a revised draft made during recovery');
  const reads=requests.filter(r=>r.path.endsWith('/chat-options') && r.method==='GET').length;
  await button(page,'check-session-model').click();await expect(button(page,'send-message')).toBeEnabled();
  await expect(page.locator('#composer')).toHaveValue('a revised draft made during recovery');await expect(page.locator('.response-thinking')).toHaveText('· High');
  assert.equal(requests.filter(r=>r.path.endsWith('/chat-options') && r.method==='GET').length,reads+1);
  assert.equal(requests.filter(r=>r.method==='PATCH').length,1);assert.equal(requests.filter(r=>r.path.endsWith('/runs') && r.method==='POST').length,0);
});

test('UX revision Activity failures remain visible and secondary Service identity preserves its command boundary', async t => {
  const {page}=await fixture(t,r=>{
    if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:3}};
    if(r.path.endsWith('/chat-models'))return{json:chatModels()};
    if(r.path.endsWith('/commands'))return{json:{contractVersion:1,commands:[{kind:'prompt',command:'/review',name:'review',description:'Review supplied files',sourceName:'Work prompts'}],checkedAt:new Date().toISOString()}};
    return focusFixture(r);
  });
  await expectThinkingEditable(page);
  await expect.poll(()=>api(page,"return adapter.getWork('work-1').sessions.find(s=>s.id==='session-1')?.checkedAt || ''; ")).not.toBe('');
  await page.waitForLoadState('networkidle');
  await api(page,"const w=adapter.getWork('work-1');w.sessions[0].messages=[{id:'failed-tool',runId:'technical-run-id',role:'assistant',text:'',tool:{id:'technical-tool-id',name:'read',status:'Failed',content:'File could not be read. Choose another file.'}}];w.sessions[0].runs=[{id:'technical-run-id',status:'failed',thinkingLevel:'off',actualModel:{label:'Runtime model revision 123',model:'deepseek-flash'}}];await adapter.loadModels('work-1');");
  await expect(page.locator('.activity > summary')).toContainText('1 failed');await expect(page.locator('.activity > summary')).toContainText('File could not be read');
  await expect(page.locator('.tool-event pre')).toBeHidden();assert.equal(await page.locator('.activity').evaluate((node:HTMLDetailsElement)=>node.open),false);
  const visible=await page.locator('#messages').innerText();assert.ok(!visible.includes('technical-run-id') && !visible.includes('Runtime revision'));
  await button(page,'chat-input-options').click();await page.locator('#include-identity').check();await button(page,'close-modal').click();
  await expect(button(page,'chat-input-options')).toHaveAttribute('aria-expanded','false');assert.equal(await page.locator('#include-identity').count(),0);
  await page.locator('#composer').fill('/rev');await expect(page.locator('.command-palette')).toHaveClass(/menu-list/);await page.locator('#composer').press('Tab');
  await page.locator('#composer').fill('/review "unchanged argument"');await page.locator('#composer').press('Escape');
  await expect(page.locator('.composer-caption')).toContainText('Service identity is not added');await button(page,'chat-input-options').click();
  await expect(page.locator('#include-identity')).toBeChecked();await expect(page.locator('#modal')).toContainText('Only command arguments are sent');await button(page,'close-modal').click();
  await page.locator('#composer').fill('ordinary text');await expect(button(page,'chat-input-options')).toHaveAttribute('aria-expanded','false');await button(page,'chat-input-options').click();await expect(page.locator('#include-identity')).toBeChecked();await page.keyboard.press('Escape');
  await expect(page.locator('.run-history')).toHaveCount(0);await button(page,'run-details').click();await expect(page.locator('#modal')).toContainText('deepseek-flash');await expect(page.locator('#modal details').first()).toContainText('technical-run-id');
});

test('UX commands preserve existing parameters and IME/Shift Enter do not execute',async t=>{
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:3}};if(r.path.endsWith('/chat-models'))return{json:chatModels()};if(r.path.endsWith('/commands'))return{json:{contractVersion:1,commands:[{kind:'prompt',command:'/review',name:'review',description:'Review',sourceName:'Work prompts'}],checkedAt:new Date().toISOString()}};
 });
 await button(page,'tab-Chat').click();await page.locator('#composer').fill('/rev keep\tthese arguments');await expect(button(page,'send-message')).toBeEnabled();await page.locator('#composer').evaluate((input:HTMLTextAreaElement)=>{input.setSelectionRange(4,4);input.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowLeft',bubbles:true}));});await expect(page.locator('[role=option]').filter({hasText:'/review'})).toBeVisible();await page.locator('#composer').press('Tab');await expect(page.locator('#composer')).toHaveValue('/review keep\tthese arguments');
 await page.locator('#composer').evaluate(input=>{input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));});await page.locator('#composer').press('Shift+Enter');assert.equal(requests.filter(r=>r.method==='POST').length,0);
});

test('UX Activity and reading anchor survive a history refresh with new preceding messages',async t=>{
 const {page}=await fixture(t,()=>undefined);await button(page,'tab-Chat').click();await page.locator('#composer').fill('Preserved reading draft');await expect(button(page,'send-message')).toBeEnabled();
 const messages=Array.from({length:50},(_,i)=>({id:`prose-${i}`,runId:'run-history',role:'assistant',text:`Paragraph ${i}: ${'Saved conversation text. '.repeat(12)}`}));
 messages.splice(20,0,{id:'activity-anchor',runId:'run-history',role:'assistant',text:'',tool:{id:'tool-anchor',name:'read',status:'Completed',content:'<img src=x onerror="window.uxInjected=true">\n[Preview limited to 64 KiB]'}} as any);
 await api(page,`adapter.getWork('work-1').sessions[0].messages=${JSON.stringify(messages)};await adapter.loadModels('work-1');`);
 await page.locator('.activity > summary').click();await page.locator('.tool-event > summary').click();await expect(page.locator('.tool-event pre')).toContainText('[Preview limited to 64 KiB]');assert.equal(await page.evaluate(()=>(window as any).uxInjected),undefined);
 await page.locator('#messages').evaluate(node=>{node.scrollTop=node.scrollHeight/2;node.dispatchEvent(new Event('scroll'));});await page.waitForTimeout(50);
 const anchor=await page.locator('#messages').evaluate(node=>{const top=node.getBoundingClientRect().top;const first=[...node.querySelectorAll<HTMLElement>('[data-message-key]')].find(item=>item.getBoundingClientRect().bottom>top)!;return{key:first.dataset.messageKey,offset:first.getBoundingClientRect().top-top};});
 await api(page,"adapter.getWork('work-1').sessions[0].messages.unshift({id:'earlier-prose',runId:'run-earlier',role:'assistant',text:'Newly recovered preceding paragraph. '.repeat(15)});await adapter.loadModels('work-1');");
 const offset=await page.locator('#messages').evaluate((node,key)=>{const item=[...node.querySelectorAll<HTMLElement>('[data-message-key]')].find(item=>item.dataset.messageKey===key)!;return item.getBoundingClientRect().top-node.getBoundingClientRect().top;},anchor.key);
 assert.ok(Math.abs(offset-anchor.offset)<2,`Reading anchor moved ${offset-anchor.offset}px`);assert.equal(await page.locator('.activity').evaluate((node:HTMLDetailsElement)=>node.open),true);assert.equal(await page.locator('.tool-event').evaluate((node:HTMLDetailsElement)=>node.open),true);
});

test('UX runtime recovery rereads optional capabilities and replaces a stale command directory',async t=>{
 let ready=false;const {page}=await fixture(t,r=>{
  if(r.path.endsWith('/chat-capabilities'))return ready?{json:{contractVersion:1}}:{status:409,json:{code:'WORK_UNAVAILABLE'}};
  if(r.path.endsWith('/chat-models'))return{json:chatModels()};
  if(r.path.endsWith('/commands'))return{json:{contractVersion:1,commands:[{kind:'skill',command:'/skill:restored',name:'restored',description:'Restored Skill',sourceName:'Work skills'}],checkedAt:new Date().toISOString()}};
 });
 await button(page,'tab-Chat').click();await page.locator('#composer').fill('Ordinary text');await expect(button(page,'send-message')).toBeEnabled();assert.equal(await api(page,"return adapter.chatCapabilities.get('work-1')"),0);
 ready=true;await api(page,"await adapter.loadModels('work-1');");await expectThinkingEditable(page);await page.locator('#composer').fill('/skill:res');await expect(page.locator('[role=option]').filter({hasText:'/skill:restored'})).toBeVisible();
});

test('UX incompatible Session settings stay unavailable while web navigation remains reachable',async t=>{
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:3}};
  if(r.path.endsWith('/chat-models'))return{json:chatModels()};
  if(r.path.endsWith('/chat-options'))return{json:{...chatOptions(),availability:'unavailable'}};
 });
 await button(page,'tab-Chat').click();await expect(button(page,'send-message')).toBeDisabled();await expect(page.locator('.options-status')).toContainText('environment or saved settings');await page.locator('#composer').fill('keep my earlier draft');await api(page,"await adapter.loadSession('work-1','session-1');");await expect(page.locator('#composer')).toHaveValue('keep my earlier draft');
 await page.locator('#composer').fill('/resume');await page.locator('#composer').press('Escape');await expect(button(page,'send-message')).toBeEnabled();assert.equal(requests.filter(r=>['POST','PATCH'].includes(r.method)).length,0);
});

test('Compact settings summary shares the confirmed pair across containers; inspection preserves draft, caret, reading anchor and iframe', async t => {
  const { page, requests } = await fixture(t, r => {
    if (r.path.endsWith('/chat-capabilities')) return { json: { contractVersion: 3 } };
    if (r.path.endsWith('/chat-models')) return { json: chatModels() };
    if (r.path.endsWith('/chat-options')) return { json: chatOptions('high') };
    return focusFixture(r);
  });
  await expect(page.locator('.response-thinking')).toHaveText('· High');
  await page.frameLocator('iframe').getByLabel('Application draft').fill('unsaved application input');
  await api(page, "adapter.getWork('work-1').sessions[0].messages=Array.from({length:30},(_,i)=>({id:'compact-message-'+i,role:'assistant',text:'Saved paragraph '+i+' '+ 'Conversation. '.repeat(25)}));await adapter.loadModels('work-1');");
  await page.locator('#composer').fill('a draft kept while inspecting response settings');
  await page.evaluate(() => {
    (window as any).compactFrame = document.querySelector('iframe');
    (window as any).compactComposer = document.querySelector('#composer');
    (document.querySelector('#composer') as HTMLTextAreaElement).setSelectionRange(2, 8);
    document.querySelector('#messages')!.scrollTop = 180;
  });
  await expect(button(page, 'scroll-bottom')).toBeVisible();
  const scroll = await page.locator('#messages').evaluate(node => node.scrollTop);
  const writes = chatWrites(requests).length;
  for (const container of ['sidebar', 'focus', 'chat']) {
    if (container === 'chat') await button(page, 'tab-Chat').click();
    if (container === 'focus') await button(page, 'focus-chat').click();
    await expect(page.locator('#response-settings-trigger')).toHaveCount(1);
    await expect(page.locator('.composer [data-action=open-chat-settings]')).toHaveCount(1);
    await expect(page.locator('.composer small,.composer #model-select,.composer #thinking-select')).toHaveCount(0);
    await expect(page.locator('#response-settings-trigger')).toHaveAccessibleName('Response settings: Default chat model (one); Thinking High. For your next message');
    await expect(page.locator('.composer-wrap > .options-status')).toBeEmpty();
    await openResponseSettings(page);
    await expect(page.locator('#model-select')).toBeFocused();
    await expect(page.locator('.response-setting-group .response-setting-label')).toHaveText(['Model', 'Thinking']);
    await expect(page.locator('#modal [role=listbox]')).toHaveCount(0);
    await expect(page.locator('#modal .modal-footer')).toHaveText('Close');
    await page.locator('#model-select').click();
    await expect(page.locator('#modal [role=listbox]')).toHaveCount(1);
    await page.locator('#thinking-select').click();
    await expect(page.locator('#model-select')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#thinking-select')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#modal [role=listbox]')).toHaveAccessibleName('Thinking levels');
    await page.locator('#thinking-select').click();
    await expect(page.locator('#modal [role=listbox]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('#response-settings-trigger')).toBeFocused();
    assert.equal(chatWrites(requests).length, writes);
    await expect(page.locator('#composer')).toHaveValue('a draft kept while inspecting response settings');
    assert.deepEqual(await page.locator('#composer').evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd]), [2, 8]);
    if (container === 'sidebar') assert.ok(Math.abs(await page.locator('#messages').evaluate(node => node.scrollTop) - scroll) < 2);
    if (container !== 'chat') {
      assert.equal(await page.evaluate(() => document.querySelector('iframe') === (window as any).compactFrame), true);
      await expect(page.frameLocator('iframe').getByLabel('Application draft')).toHaveValue('unsaved application input');
    }
    if (container === 'focus') await button(page, 'restore-layout').click();
  }
  assert.equal(await page.evaluate(() => document.querySelector('#composer') === (window as any).compactComposer), true);
  assert.equal(chatWrites(requests).length, writes);
});

test('Compact settings confirmed repeats consume matching web commands without PATCH or Run', async t => {
  const { page, requests } = await fixture(t, r => {
    if (r.path.endsWith('/chat-capabilities')) return { json: { contractVersion: 3 } };
    if (r.path.endsWith('/chat-models')) return { json: chatModels() };
    if (r.path.endsWith('/chat-options')) return { json: chatOptions('high') };
  });
  await button(page, 'tab-Chat').click();
  await expect(page.locator('.response-thinking')).toHaveText('· High');
  await chooseThinking(page, 'high', true);
  await expect(page.locator('#thinking-select')).toBeFocused();
  await chooseModel(page, '', true);
  await expect(page.locator('#model-select')).toBeFocused();
  await closeResponseSettings(page);
  for (const kind of ['model', 'thinking']) {
    await page.locator('#composer').fill(`/${kind}`);
    await page.locator('#composer').press('Escape');
    await button(page, 'send-message').click();
    await expect(page.locator(`#${kind}-select`)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#modal [aria-selected=true]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#composer')).toHaveValue('');
    await expect(page.locator('#modal [role=listbox]')).toHaveCount(0);
    await closeResponseSettings(page);
    await expect(page.locator('#composer')).toBeFocused();
  }
  assert.equal(chatWrites(requests).length, 0);
  await expect(page.locator('.composer [data-action-status]')).toHaveCount(0);
});

test('Compact settings saving survives close, reopen and same pending selection without replay', async t => {
  let release!: () => void;
  const gate = new Promise<void>(done => release = done);
  t.after(async () => release());
  let saved = 'off';
  const { page, requests } = await fixture(t, async r => {
    if (r.path.endsWith('/chat-capabilities')) return { json: { contractVersion: 3 } };
    if (r.path.endsWith('/chat-models')) return { json: chatModels() };
    if (r.path.endsWith('/chat-options')) {
      if (r.method === 'PATCH') { await gate; saved = JSON.parse(r.body).thinkingLevel; }
      return { json: chatOptions(saved) };
    }
    return focusFixture(r);
  });
  await button(page, 'tab-Chat').click();
  await page.locator('#composer').fill('first draft');
  await chooseThinking(page, 'low', true);
  await expect(page.locator('#thinking-select')).toBeFocused();
  await expect(page.locator('#modal .options-status')).toContainText('Saving');
  await expect(page.locator('.options-status[role=status]')).toHaveCount(1);
  await closeResponseSettings(page);
  await expect(button(page, 'send-message')).toBeDisabled();
  await expect(page.locator('.composer-wrap > .options-status')).toContainText('Saving');
  await expect(page.locator('.response-thinking')).toHaveText('· Low');
  await uiuxEvidence(page, '13-saving-closed');
  await page.locator('#composer').fill('draft revised during saving');
  await openResponseSettings(page);
  await expect(page.locator('#modal .options-status')).toContainText('Saving');
  await chooseThinking(page, 'low', true);
  assert.equal(requests.filter(r => r.method === 'PATCH').length, 1);
  await closeResponseSettings(page);
  release();
  await expect(button(page, 'send-message')).toBeEnabled();
  await expect(page.locator('.composer-wrap > .options-status')).toBeEmpty();
  await expect(page.locator('#composer')).toHaveValue('draft revised during saving');
  await openResponseSettings(page, 'thinking');
  await expect(page.locator('#modal [aria-selected=true]')).toHaveText('Low');
  await closeResponseSettings(page);
  assert.equal(requests.filter(r => r.method === 'PATCH').length, 1);
  assert.equal(requests.filter(r => r.method === 'POST' && /\/(runs|sessions)$/.test(r.path)).length, 0);
});

test('Compact settings rejected saves retain the pair and confirmed preference, with retry inside the panel', async t => {
  let reject = true, saved = 'off';
  const { page, requests } = await fixture(t, r => {
    if (r.path.endsWith('/chat-capabilities')) return { json: { contractVersion: 3 } };
    if (r.path.endsWith('/chat-models')) return { json: chatModels() };
    if (r.path.endsWith('/chat-options')) {
      if (r.method === 'PATCH') {
        if (reject) return { status: 400, json: { code: 'MODEL_NOT_SUPPORTED', message: 'Selected settings were rejected.' } };
        saved = JSON.parse(r.body).thinkingLevel;
      }
      return { json: chatOptions(saved) };
    }
  });
  await button(page, 'tab-Chat').click();
  await page.locator('#composer').fill('draft retained after rejection');
  await chooseThinking(page, 'high');
  await expect(page.locator('.options-status')).toContainText('Not saved');
  await expect(page.locator('.options-status')).toContainText('rejected');
  await expect(page.locator('.response-thinking')).toHaveText('· High');
  await expect(button(page, 'send-message')).toBeDisabled();
  assert.equal(await api(page, "return adapter.getWork('work-1').sessions[0].thinkingLevel;"), 'off');
  await page.setViewportSize({ width: 360, height: 800 });
  await uiuxEvidence(page, '14-not-saved-closed');
  await openResponseSettings(page);
  await expect(page.locator('#modal .options-status')).toContainText('Not saved');
  await expect(page.locator('.options-status[role=status]')).toHaveCount(1);
  reject = false;
  await page.locator('#modal [data-action=save-model]').click();
  await expect(page.locator('#modal .options-status')).toBeEmpty();
  await closeResponseSettings(page);
  await expect(button(page, 'send-message')).toBeEnabled();
  await expect(page.locator('#composer')).toHaveValue('draft retained after rejection');
  assert.equal(requests.filter(r => r.method === 'PATCH').length, 2);
  assert.equal(requests.filter(r => r.method === 'POST' && r.path.endsWith('/runs')).length, 0);
});

test('Compact settings unknown recovery reads only the original Session, including a failed check and actual differing pair', async t => {
  let saved = 'off', failCheck = false;
  const { page, requests } = await fixture(t, r => {
    if (r.path.endsWith('/chat-capabilities')) return { json: { contractVersion: 3 } };
    if (r.path.endsWith('/chat-models')) return { json: chatModels() };
    if (r.path.endsWith('/chat-options')) {
      if (r.method === 'PATCH') { saved = 'low'; return { abort: true }; }
      if (failCheck) return { status: 503, json: { code: 'CORE_UNAVAILABLE', message: 'Original settings cannot be read yet.' } };
      return { json: chatOptions(saved) };
    }
  });
  await button(page, 'tab-Chat').click();
  await page.locator('#composer').fill('keep this draft on unknown outcome');
  await chooseThinking(page, 'high');
  await expect(page.locator('.options-status')).toContainText('Unconfirmed');
  await expect(page.locator('#response-settings-trigger')).toBeEnabled();
  await expect(button(page, 'send-message')).toBeDisabled();
  await page.setViewportSize({ width: 360, height: 800 });
  await uiuxEvidence(page, '15-unconfirmed-closed');
  const reads = requests.filter(r => r.method === 'GET' && r.path.endsWith('/chat-options')).length;
  await openResponseSettings(page);
  for (const kind of ['model', 'thinking']) await expect(page.locator(`#${kind}-select`)).toBeDisabled();
  await expect(page.locator('#modal [data-action=check-session-model]')).toBeFocused();
  await expect(page.locator('#modal [role=listbox]')).toHaveCount(0);
  await expect(page.locator('.options-status[role=status]')).toHaveCount(1);
  assert.equal(requests.filter(r => r.method === 'GET' && r.path.endsWith('/chat-options')).length, reads);
  failCheck = true;
  await page.locator('#modal [data-action=check-session-model]').click();
  await expect(page.locator('#modal .options-status')).toContainText('Unconfirmed');
  await expect(page.locator('#model-select')).toBeDisabled();
  await closeResponseSettings(page);
  await expect(page.locator('#composer')).toHaveValue('keep this draft on unknown outcome');
  await openResponseSettings(page);
  failCheck = false;
  await page.locator('#modal [data-action=check-session-model]').click();
  await expect(page.locator('#thinking-select')).toContainText('Low');
  await expect(page.locator('#model-select')).toBeEnabled();
  await expect(page.locator('#modal .options-status')).toBeEmpty();
  await closeResponseSettings(page);
  await expect(button(page, 'send-message')).toBeEnabled();
  await expect(page.locator('.response-thinking')).toHaveText('· Low');
  assert.equal(requests.filter(r => r.method === 'GET' && r.path.endsWith('/chat-options')).length, reads + 2);
  assert.equal(requests.filter(r => r.method === 'PATCH').length, 1);
  assert.equal(requests.filter(r => r.method === 'POST' && r.path.endsWith('/runs')).length, 0);
});

test('Compact settings first catalogue loading and failure remain inspectable without invented choices', async t => {
  let release!: () => void;
  const gate = new Promise<void>(done => release = done);
  t.after(async () => release());
  let available = false;
  const { page, requests } = await fixture(t, async r => {
    if (r.path.endsWith('/chat-capabilities')) return { json: { contractVersion: 3 } };
    if (r.path.endsWith('/chat-models')) {
      if (!available) { await gate; return { status: 503, json: { code: 'MODEL_LIST_UNAVAILABLE', message: 'Models could not be confirmed.' } }; }
      return { json: chatModels() };
    }
    if (r.path.endsWith('/chat-options')) return { json: chatOptions() };
  }, false, false);
  await button(page, 'tab-Chat').click();
  await expect(page.locator('#response-settings-trigger')).toHaveAttribute('aria-busy','true');
  // While the settings popover is closed the trigger keeps one glyph-sized box:
  // the wait takes the glyph's place and the name lives in the accessible label,
  // so the trigger cannot change width for the read.
  await expect(page.locator('#response-settings-trigger')).toHaveAttribute('aria-label', /Loading response settings/);
  await expect(page.locator('#response-settings-trigger .pending-dots')).toHaveCount(1);
  await expect(button(page, 'send-message')).toBeDisabled();
  await uiuxEvidence(page, '11-loading-models-closed');
  await openResponseSettings(page);
  await expect(page.locator('#response-settings-trigger .pending-dots')).toHaveCount(0);
  await expect(page.locator('#modal .options-status [aria-busy="true"] .pending-dots')).toHaveCount(1);
  await expect(page.locator('#model-select')).toBeDisabled();
  await expect(page.locator('#thinking-select')).toBeDisabled();
  await expect(page.locator('#modal [role=option]')).toHaveCount(0);
  await expect(page.locator('#modal .modal-footer .button')).toBeFocused();
  await closeResponseSettings(page);
  await page.locator('#composer').fill('typing continues while models are read');
  release();
  await expect(page.locator('.options-status')).toContainText('Models could not be confirmed');
  await expect(page.locator('.composer-wrap .pending-dots')).toHaveCount(0);
  await expect(page.locator('.options-status')).toContainText('last known settings');
  await expect(page.locator('.composer-wrap [role=status]').filter({ hasText: 'Models could not be confirmed' })).toHaveCount(1);
  await uiuxEvidence(page, '12-models-unconfirmed-closed');
  await openResponseSettings(page);
  await expect(page.locator('#modal [data-action=load-models]')).toBeFocused();
  await expect(page.locator('#modal [role=option]')).toHaveCount(0);
  available = true;
  await page.locator('#modal [data-action=load-models]').click();
  await expect(page.locator('#thinking-select')).toBeEnabled();
  await expect(page.locator('#modal .options-status')).toBeEmpty();
  await closeResponseSettings(page);
  await expect(page.locator('#composer')).toHaveValue('typing continues while models are read');
  await expect(button(page, 'send-message')).toBeEnabled();
  await openResponseSettings(page, 'model');
  await expect(page.locator('#modal [role=option]')).toHaveText('Default chat model (one)Use Work default');
  await closeResponseSettings(page);
  assert.equal(chatWrites(requests).length, 0);
});

test('Compact settings unsupported Thinking commands distinguish Off, missing contract and unconfirmed capability', async t => {
  for (const mode of ['off', 'legacy', 'unconfirmed']) {
    await t.test(mode, async subtest => {
      const { page, requests } = await fixture(subtest, r => {
        if (r.path.endsWith('/chat-capabilities')) return mode === 'legacy' ? { status: 404, json: { code: 'NOT_FOUND' } } : { json: { contractVersion: 1 } };
        if (r.path.endsWith('/chat-models')) return { json: { ...chatModels(), defaultModel: { ...chatModel, thinkingLevels: mode === 'off' ? ['off'] : undefined } } };
        if (r.path.endsWith('/chat-options')) return { json: chatOptions() };
      });
      await button(page, 'tab-Chat').click();
      const value = mode === 'off' ? 'Off' : mode === 'legacy' ? 'Unavailable' : 'Unconfirmed';
      const reason = mode === 'off' ? 'Thinking is not supported by this model' : mode === 'legacy' ? 'Thinking unavailable in this Work' : 'Thinking capabilities are unconfirmed';
      await expect(page.locator('.response-thinking')).toHaveText(`· ${value}`);
      await expect(page.locator('.options-status')).toContainText(reason);
      await page.locator('#composer').fill('/thinking');
      await page.locator('#composer').press('Escape');
      await button(page, 'send-message').click();
      await expect(page.getByRole('heading', { name: 'Response settings' })).toBeVisible();
      await expect(page.locator('#thinking-select')).toBeDisabled();
      await expect(page.locator('#thinking-select')).toContainText(value);
      await expect(page.locator('#modal .options-status')).toContainText(reason);
      await expect(page.locator('#modal [role=option]')).toHaveCount(0);
      await expect(page.locator('#modal .modal-footer .button')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.locator('#composer')).toBeFocused();
      await expect(page.locator('#composer')).toHaveValue('/thinking');
      await page.locator('#composer').fill('ordinary basic chat remains usable');
      await expect(button(page, 'send-message')).toBeEnabled();
      await expect(page.locator('.composer [data-action-status]')).toHaveCount(0);
      if (mode === 'off') await uiuxEvidence(page, '16-off-unsupported-closed');
      assert.equal(chatWrites(requests).length, 0);
    });
  }
});

test('Compact settings model transition shows the real fallback Thinking and saves one atomic pair without changing the current Run', async t => {
  let release!: () => void;
  const gate = new Promise<void>(done => release = done);
  t.after(async () => release());
  const plain = { ...chatModel, modelRef: 'model-plain', label: 'Plain model', model: 'plain', thinkingLevels: ['off'], defaultThinkingLevel: 'off' };
  let saved = chatOptions('high');
  const { page, requests } = await fixture(t, async r => {
    if (r.path.endsWith('/chat-capabilities')) return { json: { contractVersion: 3 } };
    if (r.path.endsWith('/chat-models')) return { json: { ...chatModels(), models: [plain] } };
    if (r.path.endsWith('/chat-options')) {
      if (r.method === 'PATCH') {
        await gate;
        saved = { ...chatOptions('off'), modelRef: plain.modelRef, model: plain };
      }
      return { json: saved };
    }
  });
  await button(page, 'tab-Chat').click();
  await expect(page.locator('.response-thinking')).toHaveText('· High');
  await api(page, "adapter.getWork('work-1').run={id:'already-accepted',sessionId:'session-1',status:'running',actualModel:{label:'Run model',model:'one'},thinkingLevel:'high'};await adapter.loadModels('work-1');");
  const run = await api(page, "return JSON.stringify(adapter.getWork('work-1').run);");
  await chooseModel(page, plain.modelRef, true);
  await expect(page.locator('#model-select')).toContainText('Plain model');
  await expect(page.locator('#thinking-select')).toContainText('Off');
  await expect(page.locator('#thinking-select')).toBeDisabled();
  await expect(page.locator('#modal .options-status')).toContainText('Saving');
  await expect(page.locator('#modal .options-status')).toContainText('Thinking adjusted');
  assert.deepEqual(JSON.parse(requests.find(r => r.method === 'PATCH')!.body), { modelRef: 'model-plain', thinkingLevel: 'off' });
  await closeResponseSettings(page);
  await expect(button(page, 'send-message')).toBeDisabled();
  release();
  await expect.poll(() => api(page, "return adapter.modelSelection('work-1','session-1').phase;")).toBe('clean');
  await expect(page.locator('#response-settings-trigger')).toContainText('Plain model· Off');
  assert.equal(await api(page, "return JSON.stringify(adapter.getWork('work-1').run);"), run);
  assert.equal(requests.filter(r => r.method === 'PATCH').length, 1);
  assert.equal(requests.filter(r => r.method === 'POST' && r.path.endsWith('/runs')).length, 0);
});

test('Compact settings no-Session selections stay local until one explicit creation confirms the pair', async t => {
  let created = false, saved = 'off';
  const { page, requests } = await fixture(t, r => {
    if (r.path.endsWith('/chat-capabilities')) return { json: { contractVersion: 3 } };
    if (r.path.endsWith('/chat-models')) return { json: chatModels() };
    if (r.path.endsWith('/sessions')) {
      if (r.method === 'POST') { created = true; return { json: { sessionId: 'session-1', thinkingLevel: 'off' } }; }
      return { json: { sessions: created ? [{ sessionId: 'session-1' }] : [] } };
    }
    if (r.path.endsWith('/chat-options')) {
      if (r.method === 'PATCH') saved = JSON.parse(r.body).thinkingLevel;
      return { json: chatOptions(saved) };
    }
  });
  await button(page, 'tab-Chat').click();
  await expect(page.locator('.session-line')).toContainText('No Session yet');
  await page.locator('#composer').fill('new Session draft');
  await chooseThinking(page, 'high', true);
  await expect(page.locator('#modal')).toContainText('For new session');
  await chooseModel(page, '', true);
  await closeResponseSettings(page);
  await expect(page.locator('#response-settings-trigger')).toHaveAccessibleName('Response settings: Default chat model (one); Thinking High. For your next message. For new session');
  await expect(page.locator('.options-status')).toContainText('For new session');
  assert.equal(chatWrites(requests).length, 0);
  await button(page, 'agent-menu').click();
  await button(page, 'new-session').click();
  await expect.poll(() => api(page, "return adapter.modelSelection('work-1','session-1').phase;")).toBe('clean');
  await expect(page.locator('.response-thinking')).toHaveText('· High');
  await expect(page.locator('#composer')).toHaveValue('new Session draft');
  assert.equal(requests.filter(r => r.method === 'POST' && r.path.endsWith('/sessions')).length, 1);
  assert.equal(requests.filter(r => r.method === 'PATCH').length, 1);
  assert.deepEqual(JSON.parse(requests.find(r => r.method === 'PATCH')!.body), { modelRef: null, thinkingLevel: 'high' });
  assert.equal(requests.filter(r => r.method === 'POST' && r.path.endsWith('/runs')).length, 0);
});

test('Compact settings context changes close the panel and late saves update only the original Session', async t => {
  let release!: () => void;
  const gate = new Promise<void>(done => release = done);
  t.after(async () => release());
  let saved = 'off';
  const { page, requests } = await fixture(t, async r => {
    if (r.path.endsWith('/chat-capabilities')) return { json: { contractVersion: 3 } };
    if (r.path.endsWith('/chat-models')) return { json: chatModels() };
    if (r.path.endsWith('/sessions')) return { json: { sessions: [{ sessionId: 'session-1', thinkingLevel: 'off' }, { sessionId: 'session-2', thinkingLevel: 'low' }] } };
    if (r.path.endsWith('/sessions/session-2')) return { json: { session: { sessionId: 'session-2', workId: 'work-1', thinkingLevel: 'low', modelPreference: null }, messages: [], runs: [] } };
    if (r.path.endsWith('/chat-options')) {
      if (r.method === 'PATCH') { await gate; saved = JSON.parse(r.body).thinkingLevel; }
      return { json: r.path.includes('/session-2/') ? { ...chatOptions('low'), sessionId: 'session-2' } : chatOptions(saved) };
    }
  });
  await button(page, 'tab-Chat').click();
  await page.locator('#composer').fill('original Session draft');
  await chooseThinking(page, 'high', true);
  // External context changes can occur while the native modal is open.
  await page.evaluate(() => {
    const action = document.createElement('button'); action.dataset.action = 'select-session'; action.dataset.id = 'session-2';
    document.querySelector('#app')!.append(action); action.click();
  });
  await expect(page.locator('#modal')).toHaveCount(0);
  await expect(page.locator('.response-thinking')).toHaveText('· Low');
  await page.locator('#composer').fill('new Session draft');
  await page.locator('#composer').focus();
  release();
  await expect.poll(() => api(page, "return adapter.modelSelection('work-1','session-1').phase;")).toBe('clean');
  await expect(page.locator('#modal')).toHaveCount(0);
  await expect(page.locator('#composer')).toBeFocused();
  await expect(page.locator('#composer')).toHaveValue('new Session draft');
  await expect(page.locator('.response-thinking')).toHaveText('· Low');
  assert.equal(await api(page, "return adapter.getWork('work-1').sessions.find(s=>s.id==='session-1').thinkingLevel;"), 'high');
  assert.equal(await api(page, "return adapter.modelSelection('work-1','session-2').thinking;"), 'low');
  await openResponseSettings(page);
  await page.evaluate(() => { const action = document.createElement('button'); action.dataset.action = 'tab-Files'; document.querySelector('#app')!.append(action); action.click(); });
  await expect(page.locator('#modal')).toHaveCount(0);
  await button(page, 'tab-Chat').click();
  await openResponseSettings(page);
  await page.evaluate(() => { location.hash = '/works'; });
  await expect(page.locator('#modal')).toHaveCount(0);
  assert.equal(requests.filter(r => r.method === 'PATCH').length, 1);
  assert.equal(requests.filter(r => r.method === 'POST' && r.path.endsWith('/runs')).length, 0);
});

test('Compact settings Core and account changes discard an open panel and ignore late results', async t => {
  for (const change of ['core', 'account']) {
    await t.test(change, async subtest => {
      let release!: () => void;
      const gate = new Promise<void>(done => release = done);
      subtest.after(async () => release());
      const { page, requests } = await fixture(subtest, async r => {
        if (r.path.endsWith('/chat-capabilities')) return { json: { contractVersion: 3 } };
        if (r.path.endsWith('/chat-models')) return { json: chatModels() };
        if (r.path.endsWith('/chat-options')) { if (r.method === 'PATCH') await gate; return { json: chatOptions(r.method === 'PATCH' ? 'high' : 'off') }; }
      });
      await button(page, 'tab-Chat').click();
      await chooseThinking(page, 'high', true);
      const epoch = await api(page, 'return adapter.identityEpoch;');
      await api(page, change === 'core' ? "await adapter.switchCore('http://another.test');" : 'await adapter.signOut();');
      await expect(page.locator('#modal')).toHaveCount(0);
      assert.notEqual(await api(page, 'return adapter.identityEpoch;'), epoch);
      release();
      await expect(page.getByRole('heading', { name: 'Connect to your Core' })).toBeVisible();
      await page.waitForLoadState('networkidle');
      assert.deepEqual(await api(page, 'return adapter.state.works;'), []);
      assert.equal(await api(page, 'return adapter.models.size;'), 0);
      assert.equal(requests.filter(r => r.method === 'PATCH').length, 1);
      assert.equal(requests.filter(r => r.method === 'POST' && r.path.endsWith('/runs')).length, 0);
    });
  }
});

test('Compact settings keyboard keeps list navigation, IME, Tab, focus return and response updates in the same dialog', async t => {
  let saved = 'off', levels = ['off', 'low', 'high'];
  const { page, requests } = await fixture(t, r => {
    if (r.path.endsWith('/chat-capabilities')) return { json: { contractVersion: 3 } };
    if (r.path.endsWith('/chat-models')) return { json: { ...chatModels(), defaultModel: { ...chatModel, thinkingLevels: levels } } };
    if (r.path.endsWith('/chat-options')) { if (r.method === 'PATCH') saved = JSON.parse(r.body).thinkingLevel; return { json: chatOptions(saved) }; }
    return focusFixture(r);
  });
  await button(page, 'focus-chat').click();
  await page.locator('#composer').fill('keyboard draft with a selected portion');
  await page.locator('#composer').evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(3, 9));
  await page.locator('#response-settings-trigger').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#model-select')).toBeFocused();
  await expect(page.locator('#model-select')).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#model-select')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('#modal [aria-selected=true]')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('#model-select')).toBeFocused();
  await expect(page.locator('#modal [role=listbox]')).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(page.locator('#thinking-select')).toBeFocused();
  const outline = await page.locator('#thinking-select').evaluate(node => { const css = getComputedStyle(node); return { style: css.outlineStyle, width: css.outlineWidth }; });
  assert.equal(outline.style, 'solid'); assert.equal(outline.width, '2px');
  await uiuxEvidence(page, '17-keyboard-focus');
  await page.keyboard.press('Enter');
  await expect(page.locator('#modal [data-option-value=off]')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#modal [data-option-value=high]')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.locator('#modal [data-option-value=off]')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.locator('#modal [data-option-value=high]')).toBeFocused();
  await api(page, "await adapter.loadModels('work-1');");
  await expect(page.locator('#modal [data-option-value=high]')).toBeFocused();
  await page.locator('#modal [data-option-value=high]').evaluate(node => node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await page.keyboard.press('Enter');
  assert.equal(requests.filter(r => r.method === 'PATCH').length, 0);
  await expect(page.locator('#modal [role=listbox]')).toHaveCount(1);
  await page.locator('#modal [data-option-value=high]').evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#modal [data-option-value=low]')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('#thinking-select')).toBeFocused();
  await expect(page.locator('#thinking-select')).toContainText('Low');
  await expect.poll(() => api(page, "return adapter.modelSelection('work-1','session-1').phase;")).toBe('clean');
  await expect(page.locator('#thinking-select')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#modal .modal-footer .button')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#modal')).toHaveAttribute('aria-modal','false');
  assert.equal(await page.locator('#modal').evaluate(node=>node.contains(document.activeElement)),false,'Popover must not trap Tab at its footer');
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#modal .modal-footer .button')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#response-settings-trigger')).toBeFocused();
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'chat-only');
  assert.deepEqual(await page.locator('#composer').evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd]), [3, 9]);
  await page.locator('#composer').fill('/thinking');
  await page.locator('#composer').press('Escape');
  await page.locator('#composer').press('Enter');
  await expect(page.locator('#modal [data-option-value=low]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#composer')).toBeFocused();
  await expect(page.locator('#composer')).toHaveValue('/thinking');
  assert.deepEqual(await page.locator('#composer').evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd]), [9, 9]);
  await page.locator('#composer').fill('draft remains after capability change');
  await openResponseSettings(page);
  await page.locator('#thinking-select').focus();
  await api(page, "await adapter.loadModels('work-1');");
  await expect(page.locator('#thinking-select')).toBeFocused();
  levels = ['off']; saved = 'off';
  await api(page, "await adapter.loadModels('work-1');");
  await expect(page.locator('#thinking-select')).toBeDisabled();
  await expect(page.locator('#modal .modal-footer .button')).toBeFocused();
  await api(page, "await adapter.loadModels('work-1');");
  await expect(page.locator('#modal .modal-footer .button')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#composer')).toHaveValue('draft remains after capability change');
  assert.equal(requests.filter(r => r.method === 'PATCH').length, 1);
  assert.equal(requests.filter(r => r.method === 'POST' && r.path.endsWith('/runs')).length, 0);
});

for (const destination of ['composer', 'close', 'replace', 'session', 'work', 'identity']) test(`Compact settings late capability update preserves ${destination} focus ownership`, async t => {
  let delayed = false, release!: () => void;
  const gate = new Promise<void>(done => release = done); t.after(async () => release());
  const { page, requests } = await fixture(t, async r => {
    if (r.path === 'works') return { json: { works: ['1', '2'].map(id => ({ id: `work-${id}`, name: id === '1' ? 'Recovery Work' : 'Other Work', observedState: 'ready', desiredState: 'running' })) } };
    if (r.path === 'works/work-2') return { json: { id: 'work-2', name: 'Other Work', observedState: 'ready', desiredState: 'running' } };
    if (r.path.endsWith('/chat-capabilities')) return { json: { contractVersion: 3 } };
    if (r.path.endsWith('/chat-models')) {
      if (delayed && r.path.includes('work-1')) await gate;
      return { json: { ...chatModels(), defaultModel: { ...chatModel, thinkingLevels: delayed && r.path.includes('work-1') ? ['off'] : ['off', 'low', 'high'] } } };
    }
    if (r.path.endsWith('/sessions')) return { json: { sessions: [{ sessionId: 'session-1' }, { sessionId: 'session-2' }] } };
    if (/\/sessions\/session-[12]$/.test(r.path)) return { json: { session: { workId: r.path.split('/')[1], sessionId: r.path.split('/')[3], modelPreference: null, thinkingLevel: 'off' }, messages: [], runs: [] } };
    if (r.path.endsWith('/chat-options')) return { json: { ...chatOptions('off'), workId: r.path.split('/')[1], sessionId: r.path.split('/')[3] } };
    return focusFixture(r);
  });
  await button(page, 'focus-chat').click();
  await page.locator('#composer').fill('draft kept across a capability read');
  await openResponseSettings(page); await page.locator('#thinking-select').focus();
  delayed = true;
  const request = page.waitForRequest(r => new URL(r.url()).pathname.endsWith('/works/work-1/chat-models'));
  const pending = api(page, "try { await adapter.loadModels('work-1'); return ''; } catch (error) { return error.code; }");
  await request;
  if (destination === 'close' || destination === 'replace') await closeResponseSettings(page);
  if (destination === 'replace') { await button(page, 'agent-menu').click(); await expect(page.locator('#modal')).toHaveAttribute('role', 'menu'); }
  if (destination === 'session') {
    await closeResponseSettings(page); await button(page, 'sessions').click();
    await page.locator('[data-action=select-session][data-id=session-2]').click();
    await expect(page.locator('#modal')).toHaveCount(0);
  }
  if (destination === 'work') {
    await closeResponseSettings(page); await page.evaluate(() => { location.hash = '/work/work-2'; });
    await expect(page.getByRole('heading', { name: 'Other Work', exact: true })).toBeVisible();
    await expect(page.locator('.work-read-feedback')).toHaveCount(0);
  }
  if (destination === 'identity') { await api(page, 'await adapter.signOut();'); await page.getByLabel('Account', { exact: true }).focus(); }
  else if (!['close', 'replace'].includes(destination)) await page.locator('#composer').focus();
  await page.evaluate(() => { (window as any).capabilityFocus = document.activeElement; });
  release(); const error = await pending;
  if (destination !== 'identity') assert.equal(error, '');
  assert.equal(await page.evaluate(() => document.activeElement === (window as any).capabilityFocus), true);
  if (destination === 'composer') { await expect(page.locator('#modal')).toHaveCount(0); await expect(page.locator('#composer')).toHaveValue('draft kept across a capability read'); }
  else if (destination === 'replace') await expect(page.locator('#modal')).toHaveAttribute('role', 'menu');
  else await expect(page.locator('#modal')).toHaveCount(0);
  assert.equal(requests.filter(r => r.method === 'PATCH' || r.method === 'POST' && r.path.endsWith('/runs')).length, 0);
});

test('Compact settings UIUX evidence covers content width, container roles, long names, 360px and low height', async t => {
  let longName = false;
  const label = 'Work model with a deliberately long descriptive name that remains readable in response settings';
  const { page, requests } = await fixture(t, r => {
    if (r.path.endsWith('/chat-capabilities')) return { json: { contractVersion: 3 } };
    if (r.path.endsWith('/chat-models')) return { json: { ...chatModels(), defaultModel: { ...chatModel, label: longName ? label : 'Work model', thinkingLevels: ['off', 'low', 'medium', 'high'] }, models: Array.from({ length: 14 }, (_, i) => ({ ...chatModel, modelRef: `model-option-${i}`, label: `Available model ${i + 1}`, thinkingLevels: ['off', 'low', 'medium', 'high'] })) } };
    if (r.path.endsWith('/chat-options')) return { json: chatOptions('medium') };
    return focusFixture(r);
  });
  await expect(page.locator('.response-thinking')).toHaveText('· Medium');
  await page.locator('#composer').fill('Build a notes app for this Work');
  await uiuxEvidence(page, '01-agent-sidebar');
  const geometry = () => page.locator('#response-settings-trigger,[data-action=chat-input-options],[data-action=send-message]').evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect(); return { action: node.getAttribute("data-action"), x: box.x, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height, center: box.y + box.height / 2 };
  }));
  const aligned = async () => {
    const boxes = await geometry(); assert.equal(boxes.length, 3);
    for (const box of boxes) assert.equal(box.height, box.action === 'send-message' ? 34 : 31, JSON.stringify(boxes));
    assert.ok(Math.abs(boxes[1]!.center - boxes[2]!.center) < 1, 'toolbar icons share a row');
    assert.ok(Math.abs(boxes[0]!.center - boxes[1]!.center) < 1 || boxes[0]!.bottom <= boxes[1]!.top, 'settings align with the toolbar or wrap above it');
    return boxes;
  };
  await aligned();
  await button(page, 'tab-Chat').click();
  const normal = await aligned();
  assert.ok(normal[0]!.width < 250);
  assert.ok(normal[1]!.x - normal[0]!.right >= 6);
  await uiuxEvidence(page, '02-chat-wide');
  await page.setViewportSize({ width: 2200, height: 1000 });
  const wider = await aligned();
  assert.ok(Math.abs(wider[0]!.width - normal[0]!.width) < 1);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await button(page, 'focus-chat').click();
  await uiuxEvidence(page, '03-focus-chat');
  await openResponseSettings(page);
  await expect(page.locator('#modal [role=listbox]')).toHaveCount(0);
  await uiuxEvidence(page, '04-response-settings');
  await page.locator('#thinking-select').click();
  await expect(page.locator('#modal [role=listbox]')).toHaveAccessibleName('Thinking levels');
  await uiuxEvidence(page, '05-thinking-options');
  await closeResponseSettings(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await aligned();
  await uiuxEvidence(page, '06-chat-360');
  await openResponseSettings(page, 'thinking');
  await uiuxEvidence(page, '07-settings-360');
  await closeResponseSettings(page);
  longName = true;
  await api(page, "await adapter.loadModels('work-1');");
  await expect(page.locator('.response-model-name')).toHaveText(label + ' (one)');
  assert.ok(await page.locator('.response-model-name').evaluate(node => node.scrollWidth > node.clientWidth));
  const narrow = await aligned();
  for (const box of narrow) assert.ok(box.x >= 0 && box.right <= 360);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await uiuxEvidence(page, '08-long-model-360');
  await openResponseSettings(page, 'model');
  await expect(page.locator('#modal .response-setting-value').first()).toHaveText(label + ' (one)Work default');
  await expect(page.locator('#modal [role=option]').first()).toHaveText(label + ' (one)Use Work default');
  assert.ok(await page.locator('#modal [role=option]').first().evaluate(node => node.scrollHeight <= node.clientHeight));
  assert.ok(await page.locator('#modal [role=listbox]').evaluate(node => node.scrollHeight > node.clientHeight && node.clientHeight <= 240));
  await uiuxEvidence(page, '09-long-model-panel-360');
  await page.setViewportSize({ width: 800, height: 300 });
  await expect(page.locator('#modal .modal-footer .button')).toBeInViewport();
  const bounds = await page.locator('#modal').boundingBox(); assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 300);
  assert.ok(await page.locator('#modal .modal-body').evaluate(node => node.scrollHeight > node.clientHeight));
  await uiuxEvidence(page, '10-settings-low-height');
  await page.keyboard.press('End');
  await expect(page.locator('#modal [role=option]').last()).toBeFocused();
  await expect(page.locator('#modal [role=option]').last()).toBeInViewport();
  await uiuxEvidence(page, '10b-settings-low-height-scrolled');
  await page.keyboard.press('Escape');
  assert.equal(chatWrites(requests).length, 0);
});

test('Compact settings both fields adjust in one panel and serialize the latest complete pair using model supplied levels', async t => {
  let release!: () => void;
  const gate = new Promise<void>(done => release = done);
  t.after(async () => release());
  const other = { ...chatModel, modelRef: 'model-special', label: 'Special model', model: 'special', thinkingLevels: ['off', 'balanced', 'deep'], defaultThinkingLevel: 'balanced' };
  const pairs: { modelRef: string | null; thinkingLevel: string }[] = [];
  let active = 0, max = 0, saved = chatOptions('high');
  const { page, requests } = await fixture(t, async r => {
    if (r.path.endsWith('/chat-capabilities')) return { json: { contractVersion: 3 } };
    if (r.path.endsWith('/chat-models')) return { json: { ...chatModels(), models: [other] } };
    if (r.path.endsWith('/chat-options')) {
      if (r.method === 'PATCH') {
        const pair = JSON.parse(r.body); pairs.push(pair); max = Math.max(max, ++active);
        if (pairs.length === 1) await gate;
        saved = chatOptions(pair.thinkingLevel, other); active--;
      }
      return { json: saved };
    }
  });
  await button(page, 'tab-Chat').click();
  await expect(page.locator('.response-thinking')).toHaveText('· High');
  await page.locator('#composer').fill('draft while editing both response settings');
  await chooseModel(page, other.modelRef, true);
  await expect(page.locator('#model-select')).toBeFocused();
  await expect(page.locator('#thinking-select')).toContainText('Balanced');
  await openResponseSettings(page, 'thinking');
  await expect(page.locator('#modal [role=option]')).toHaveText(['Off', 'Balanced', 'Deep']);
  await page.locator('#modal [data-option-value=deep]').click();
  await expect(page.locator('#thinking-select')).toBeFocused();
  await expect(page.locator('#modal [role=listbox]')).toHaveCount(0);
  await expect(page.locator('.response-setting-group .response-setting-label')).toHaveText(['Model', 'Thinking']);
  await expect(page.locator('#modal .options-status')).toContainText('Saving');
  assert.deepEqual(pairs, [{ modelRef: other.modelRef, thinkingLevel: 'balanced' }]);
  await closeResponseSettings(page);
  await expect(page.locator('#response-settings-trigger')).toContainText('Special model· Deep');
  await expect(button(page, 'send-message')).toBeDisabled();
  release();
  await expect(button(page, 'send-message')).toBeEnabled();
  assert.deepEqual(pairs, [{ modelRef: other.modelRef, thinkingLevel: 'balanced' }, { modelRef: other.modelRef, thinkingLevel: 'deep' }]);
  assert.equal(max, 1);
  await expect(page.locator('#composer')).toHaveValue('draft while editing both response settings');
  assert.equal(requests.filter(r => r.method === 'POST' && /\/(runs|sessions)$/.test(r.path)).length, 0);
});

test('Compact settings switching Work closes the original panel and late saves preserve the new Work pair and draft', async t => {
  let release!: () => void;
  const gate = new Promise<void>(done => release = done);
  t.after(async () => release());
  let saved = 'off';
  const other = { ...chatModel, label: 'Other Work model' };
  const { page, requests } = await fixture(t, async r => {
    if (r.path === 'works') return { json: { works: ['1', '2'].map(id => ({ id: `work-${id}`, name: id === '1' ? 'Recovery Work' : 'Other Work', observedState: 'ready', desiredState: 'running' })) } };
    if (r.path === 'works/work-2') return { json: { id: 'work-2', name: 'Other Work', observedState: 'ready', desiredState: 'running' } };
    if (r.path.endsWith('/chat-capabilities')) return { json: { contractVersion: 3 } };
    if (r.path.endsWith('/chat-models')) return { json: { ...chatModels(), defaultModel: r.path.includes('work-2') ? other : chatModel } };
    if (r.path === 'works/work-2/sessions') return { json: { sessions: [{ sessionId: 'session-other', thinkingLevel: 'low' }] } };
    if (r.path === 'works/work-2/sessions/session-other') return { json: { session: { sessionId: 'session-other', workId: 'work-2', modelPreference: null, thinkingLevel: 'low' }, messages: [], runs: [] } };
    if (r.path === 'works/work-1/sessions/session-1') return { json: { session: { sessionId: 'session-1', workId: 'work-1', modelPreference: null, thinkingLevel: saved }, messages: [], runs: [] } };
    if (r.path.endsWith('/chat-options')) {
      if (r.path.includes('work-2')) return { json: { ...chatOptions('low', other), sessionId: 'session-other' } };
      if (r.method === 'PATCH') { await gate; saved = JSON.parse(r.body).thinkingLevel; }
      return { json: chatOptions(saved) };
    }
  });
  await button(page, 'tab-Chat').click();
  await page.locator('#composer').fill('first Work draft');
  await chooseThinking(page, 'high', true);
  await page.evaluate(() => { location.hash = '/work/work-2'; });
  await expect(page.getByRole('heading', { name: 'Other Work', exact: true })).toBeVisible();
  await expect(page.locator('#modal')).toHaveCount(0);
  await expect(page.locator('#response-settings-trigger')).toContainText('Other Work model (one)· Low');
  await page.locator('#composer').fill('second Work draft');
  await page.locator('#composer').focus();
  release();
  await expect.poll(() => api(page, "return adapter.modelSelection('work-1','session-1').phase;")).toBe('clean');
  await expect(page.locator('#composer')).toBeFocused();
  await expect(page.locator('#composer')).toHaveValue('second Work draft');
  await expect(page.locator('#response-settings-trigger')).toContainText('Other Work model (one)· Low');
  await expect(page.locator('#modal')).toHaveCount(0);
  await button(page, 'back-works').click();
  await page.locator('[data-action=open-work][data-id=work-1]').first().click();
  await expect(page.locator('#response-settings-trigger')).toContainText('Default chat model (one)· High');
  await expect(page.locator('#composer')).toHaveValue('first Work draft');
  assert.equal(requests.filter(r => r.method === 'PATCH').length, 1);
  assert.ok(requests.find(r => r.method === 'PATCH')!.path.includes('work-1/sessions/session-1/chat-options'));
  assert.equal(requests.filter(r => r.method === 'POST' && /\/(runs|sessions)$/.test(r.path)).length, 0);
});

test('unknown model stays selectable and requires explicit Normal before replacing saved High',async t=>{
 const unknown={modelRef:'model-unknown-0000001',label:'Custom model',provider:'anthropic',model:'custom-unknown',thinkingAvailability:'unknown',thinkingLevels:[],defaultThinkingLevel:null};
 let ref:string|null=null,thinking:string|null='high';
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:3}};
  if(r.path.endsWith('/chat-models'))return{json:{contractVersion:3,models:[unknown],defaultModel:chatModel,availability:'available',checkedAt:new Date().toISOString()}};
  if(r.path.endsWith('/chat-options')){if(r.method==='PATCH'){const v=JSON.parse(r.body);ref=v.modelRef;thinking=v.thinkingLevel;}return{json:{sessionId:'session-1',modelRef:ref,thinkingLevel:thinking,model:ref?unknown:chatModel,availability:'available',checkedAt:new Date().toISOString()}};}
 });
 await button(page,'tab-Chat').click();await page.locator('#composer').fill('draft kept through explicit ordinary confirmation');
 await chooseModel(page,unknown.modelRef,true);assert.equal(chatWrites(requests).length,0);assert.equal(thinking,'high');await expect(page.locator('#response-settings-status')).toContainText('Choose Normal');await expect(button(page,'send-message')).toBeDisabled();
 await page.locator('#thinking-select').click();await page.locator('[data-option-value="normal"]').click();await expect.poll(()=>ref).toBe(unknown.modelRef);assert.equal(thinking,null);await closeResponseSettings(page);await expect(button(page,'send-message')).toBeEnabled();await expect(page.locator('#composer')).toHaveValue('draft kept through explicit ordinary confirmation');
 const writes=requests.filter(r=>r.method==='PATCH');assert.equal(writes.length,1);assert.deepEqual(JSON.parse(writes[0]!.body),{modelRef:unknown.modelRef,thinkingLevel:null});
 await api(page,"await adapter.loadModels('work-1');");assert.equal((await api(page,"return adapter.modelSelection('work-1','session-1');")).thinking,null);
});

test('reopening Chat restores the original active Run, its cancel button and event cursor without submitting again',async t=>{
 let release!:()=>void;const gate=new Promise<void>(done=>release=done);t.after(async()=>release());let cancelled=false;
 const run=()=>({workId:'work-1',sessionId:'session-1',runId:'run-original',submissionKey:'original-key',state:cancelled?6:2,acceptedAt:mtime1,latestSequence:'1',actualModel:null});
 const {page,requests}=await fixture(t,async r=>{
  if(r.path==='works/work-1/sessions/session-1')return{json:{session:{workId:'work-1',sessionId:'session-1',modelPreference:null,thinkingLevel:'off'},messages:[{entryId:'original-user',runId:'run-original',role:'user',blocks:[{blockId:'original-user',type:'text',text:'Original user request'}]}],runs:[run()]}};
  if(r.path==='works/work-1/runs/run-original/events'){await gate;return{body:JSON.stringify({sequence:'1',kind:{$case:'state',state:{state:6}}})+'\n',headers:{'Content-Type':'application/x-ndjson'}};}
  if(r.path==='works/work-1/runs/run-original/cancel'){cancelled=true;release();return{json:run()};}
  if(r.path==='works/work-1/runs/run-original')return{json:run()};
 });
 await button(page,'tab-Chat').click();await expect(button(page,'cancel-run')).toBeVisible();await expect(button(page,'send-message')).toBeDisabled();
 assert.equal((await api(page,"return adapter.getWork('work-1').run;")).id,'run-original');
 await page.locator('#composer').fill('Draft kept while cancelling');await button(page,'cancel-run').click();await expect.poll(()=>requests.filter(r=>r.path.endsWith('/run-original/cancel')&&r.method==='POST').length).toBe(1);
 assert.equal(requests.filter(r=>r.path.endsWith('/runs')&&r.method==='POST').length,0);await expect(page.locator('#composer')).toHaveValue('Draft kept while cancelling');
});

test('busy submission recovers the original Run and cancellation instead of presenting legacy rate limiting or replaying',async t=>{
 let active=false;let release!:()=>void;const gate=new Promise<void>(done=>release=done);t.after(async()=>release());
 const run={workId:'work-1',sessionId:'session-1',runId:'run-existing',submissionKey:'original',state:2,acceptedAt:mtime1};
 const {page,requests}=await fixture(t,async r=>{
  if(r.path==='works/work-1/runs'&&r.method==='POST'){active=true;return{status:429,json:{code:'RATE_LIMITED',message:'rate limited'}};}
  if(r.path==='works/work-1/sessions/session-1')return{json:{session:{workId:'work-1',sessionId:'session-1',modelPreference:null,thinkingLevel:'off'},messages:[],runs:active?[run]:[]}};
  if(r.path==='works/work-1/runs/run-existing/events'){await gate;return{body:'',headers:{'Content-Type':'application/x-ndjson'}};}
  if(r.path==='works/work-1/runs/run-existing')return{json:run};
 });
 await button(page,'tab-Chat').click();await api(page,"await adapter.loadModels('work-1');");
 const error=await api(page,"try{await adapter.send('work-1','session-1','new prompt',false);}catch(e){return {code:e.code,message:e.message};}");
 assert.equal(error.code,'WORK_BUSY');assert.match(error.message,/already active.*Cancel run/);await expect(button(page,'cancel-run')).toBeVisible();
 assert.equal(requests.filter(r=>r.path==='works/work-1/runs'&&r.method==='POST').length,1);
});

test('late known default capabilities initialize only the untouched new-session draft to the confirmed SDK suggestion',async t=>{
 let release!:()=>void;const gate=new Promise<void>(done=>release=done);t.after(async()=>release());
 const model={...chatModel,model:'claude-opus-5',label:'Opus 5',thinkingLevels:['minimal','low','medium','high','xhigh','max'],defaultThinkingLevel:'minimal'};
 const {page,requests}=await fixture(t,async r=>{
  if(r.path.endsWith('/sessions'))return{json:{sessions:[]}};
  if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:3}};
  if(r.path.endsWith('/chat-models')){await gate;return{json:{contractVersion:1,models:[],defaultModel:model,checkedAt:new Date().toISOString(),availability:'available'}};}
 }, false, false);
 await button(page,'tab-Chat').click();await page.locator('#composer').fill('new session draft');await api(page,"adapter.modelSelection('work-1','');");release();
 await expect.poll(async()=>api(page,"return adapter.modelSelection('work-1','').thinking;")).toBe('minimal');await openResponseSettings(page);await expect(page.locator('#thinking-select')).toContainText('Minimal');await closeResponseSettings(page);await expect(page.locator('#composer')).toHaveValue('new session draft');assert.equal(chatWrites(requests).length,0);
});

test('explicit creation confirms an untouched SDK suggestion and lost acceptance retains it without replay',async t=>{
 for(const lost of [false,true])await t.test(lost?'lost acceptance':'confirmed acceptance',async t=>{
  const model={...chatModel,model:'claude-opus-5',thinkingLevels:['minimal','high'],defaultThinkingLevel:'minimal'};let created=false,saved='off';
  const {page,requests}=await fixture(t,r=>{
   if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:3}};
   if(r.path.endsWith('/chat-models'))return{json:{contractVersion:1,models:[],defaultModel:model,checkedAt:new Date().toISOString(),availability:'available'}};
   if(r.path==='works/work-1/sessions'){
    if(r.method==='POST'){created=true;return lost?{abort:true}:{json:{workId:'work-1',sessionId:'session-new',thinkingLevel:'off',modelPreference:null}};}
    return{json:{sessions:created?[{sessionId:'session-new'}]:[]}};
   }
   if(r.path.includes('/sessions/submissions/'))return{json:{kind:'session',key:r.path.split('/').at(-1),status:'accepted',session:{workId:'work-1',sessionId:'session-new',thinkingLevel:'off',modelPreference:null}}};
   if(r.path.endsWith('/session-new/chat-options')){if(r.method==='PATCH')saved=JSON.parse(r.body).thinkingLevel;return{json:{sessionId:'session-new',modelRef:null,model,thinkingLevel:saved,availability:'available',checkedAt:new Date().toISOString()}};}
  });
  await button(page,'tab-Chat').click();await api(page,"await adapter.loadModels('work-1');adapter.modelSelection('work-1','');");
  await api(page,"try{await adapter.newSession('work-1');}catch{};");
  if(lost){await api(page,"await adapter.recoverChatSubmission('work-1');");const state=await api(page,"return adapter.modelSelection('work-1','session-new');");assert.equal(state.thinking,'minimal');assert.equal(state.phase,'dirty');assert.equal(requests.filter(r=>r.method==='PATCH').length,0);}
  await api(page,"await adapter.saveModel('work-1','session-new');");assert.equal(saved,'minimal');assert.equal((await api(page,"return adapter.modelSelection('work-1','session-new');")).phase,'clean');
  assert.equal(requests.filter(r=>r.method==='POST'&&r.path==='works/work-1/sessions').length,1);assert.equal(requests.filter(r=>r.method==='PATCH').length,1);assert.equal(requests.filter(r=>r.method==='POST'&&r.path.endsWith('/runs')).length,0);
 });
});

test('Work default shows the captured ID after directory rename without changing stored choices or history',async t=>{
 let renamed=false;const oldId='old-id-'+'x'.repeat(249),newId='new-id';const model=()=>({...chatModel,model:oldId,label:renamed?'Friendly new':'Friendly old'});
 const head=()=>({...chatModel,modelRef:'model-new-head-000001',model:newId,label:'Friendly new'});
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:3}};
  if(r.path.endsWith('/chat-models'))return{json:{...chatModels(),models:[head()],defaultModel:model()}};
  if(r.path.endsWith('/chat-options'))return{json:chatOptions('high',model())};
 });
 await button(page,'tab-Chat').click();await expect(page.locator('#response-settings-trigger')).toContainText(oldId);
 const before=await api(page,"return {ref:adapter.modelSelection('work-1','session-1').ref,thinking:adapter.modelSelection('work-1','session-1').thinking,messages:adapter.getWork('work-1').sessions[0].messages};");
 renamed=true;await api(page,"await adapter.loadModels('work-1');");await expect(page.locator('#response-settings-trigger')).toContainText('Friendly new ('+oldId+')');await expect(page.locator('#response-settings-trigger')).toHaveAttribute('title',new RegExp(oldId));
 await page.setViewportSize({width:360,height:800});await openResponseSettings(page,'model');await expect(page.locator('#model-select')).toContainText(oldId);await expect(page.locator('#modal [data-option-value=""]')).toContainText(oldId);await expect(page.locator('#modal [data-option-value="model-new-head-000001"]')).toContainText(newId);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await closeResponseSettings(page);
 const after=await api(page,"return {ref:adapter.modelSelection('work-1','session-1').ref,thinking:adapter.modelSelection('work-1','session-1').thinking,messages:adapter.getWork('work-1').sessions[0].messages};");assert.deepEqual(after,before);assert.equal(chatWrites(requests).length,0);
});

test('Work naming: creation conflict is local to Name, keeps advanced drafts and does not guess other conflicts', async t => {
  for (const code of ['WORK_NAME_CONFLICT', 'CONFLICT']) {
    await t.test(code, async t => {
      const { page, requests } = await fixture(t, r => r.path === 'works' && r.method === 'POST'
        ? { status: 409, json: { code, message: code === 'CONFLICT' ? 'A different state conflict' : 'Legacy name conflict', ...(code === 'WORK_NAME_CONFLICT' ? { field: 'name' } : {}) } } : undefined);
      await button(page, 'back-works').click(); await button(page, 'new-work').click();
      await page.setViewportSize({ width: 360, height: 780 });
      const name = '<img src=x onerror="alert(1)">';
      await page.locator('#create-name').fill(name);
      await button(page, 'toggle-create-advanced').click();
      await page.locator('#create-image').fill('fixture/image:one');
      await page.locator('#create-agents').fill('Keep these instructions');
      await page.locator('#create-json').fill('{"agentsMd":"Keep this JSON"}');
      await button(page, 'create-work').focus(); await button(page, 'create-work').press('Enter');
      if (code === 'WORK_NAME_CONFLICT') {
        await expect(page.locator('#create-name-error')).toContainText('Choose a different name.');
        await expect(page.locator('#create-name')).toHaveAttribute('aria-invalid', 'true');
        await expect(page.locator('#create-name')).toHaveAttribute('aria-describedby', 'create-name-error');
        await expect(page.locator('#modal [role=alert]')).toHaveCount(1);
        await expect(page.locator('[data-action-status]')).toHaveCount(0);
      } else {
        await expect(page.locator('#modal')).toContainText('A different state conflict');
        await expect(page.locator('#create-name-error')).toHaveCount(0);
        await expect(page.locator('#create-name')).not.toHaveAttribute('aria-invalid', 'true');
      }
      await expect(page.locator('#create-name')).toHaveValue(name);
      await expect(page.locator('#create-image')).toHaveValue('fixture/image:one');
      await expect(page.locator('#create-agents')).toHaveValue('Keep these instructions');
      await expect(page.locator('#create-json')).toHaveValue('{"agentsMd":"Keep this JSON"}');
      await expect(page.locator('#modal img')).toHaveCount(0);
      assert.equal(requests.filter(r => r.path === 'works' && r.method === 'POST').length, 1);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (code === 'WORK_NAME_CONFLICT') {
        await button(page, 'close-modal').click();
        await expect(page.locator('[data-action-status]')).toHaveCount(0);
        await button(page, 'new-work').click();
        await expect(page.locator('#create-name')).toHaveValue(name);
      }
      await page.locator('#create-name').fill('Another name');
      await expect(page.locator('#create-name-error')).toHaveCount(0);
      assert.equal(requests.filter(r => r.path === 'works' && r.method === 'POST').length, 1);
    });
  }
});

async function inspectedNamingWork(page: Page, sourceName?: string) {
  await button(page, 'back-works').click(); await button(page, 'import').click();
  await api(page, `adapter.inspection=${JSON.stringify({ ...(sourceName ? { sourceName } : {}), integrityVerified: true })};adapter.inspectionTransfer='transfer-name';adapter.inspectionContext={id:'transfer-name',nonce:1,core:'http://core.test',localSession:'local-session-csrf',ready:true,anonymous:false,importState:'unsubmitted'};adapter.emit();`);
  await expect(page.locator('#import-name-help')).toContainText('Core adds a suffix');
}

test('Work naming: delayed creation conflict identifies the submitted name without invalidating the edited draft', async t => {
  let release!: () => void;
  const gate = new Promise<void>(done => release = done); t.after(async () => release());
  const { page, requests } = await fixture(t, async r => {
    if (r.path === 'works' && r.method === 'POST') {
      await gate;
      return { status: 409, json: { code: 'WORK_NAME_CONFLICT', field: 'name' } };
    }
  });
  await button(page, 'back-works').click(); await button(page, 'new-work').click();
  const submitted = 'Taken <img src=x onerror="alert(1)">';
  const name = page.locator('#create-name');
  await name.fill(` ${submitted} `);
  await button(page, 'toggle-create-advanced').click();
  await page.locator('#create-json').fill('{"agentsMd":"Keep this draft"}');
  await button(page, 'create-work').click();
  await expect.poll(() => requests.filter(r => r.path === 'works' && r.method === 'POST').length).toBe(1);
  await expect(name).toBeEnabled(); await name.fill('New available draft');
  release();
  await expect(page.locator('#modal')).toContainText(`The request for Work name "${submitted}" was rejected.`);
  await expect(name).toHaveValue('New available draft');
  await expect(name).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#create-name-error')).toHaveCount(0);
  await expect(page.locator('#modal .feedback.warning[role=status]')).toHaveCount(1);
  await expect(page.locator('[data-action-status]')).toHaveCount(0);
  await expect(page.locator('#modal img')).toHaveCount(0);
  await expect(page.locator('#create-json')).toHaveValue('{"agentsMd":"Keep this draft"}');
  const posts = requests.filter(r => r.path === 'works' && r.method === 'POST');
  assert.equal(posts.length, 1); assert.equal(JSON.parse(posts[0]!.body).name, submitted);
  await name.fill('Final available draft');
  await expect(page.locator('#modal .feedback.warning')).toHaveCount(0);
  await expect(page.locator('[data-action-status]')).toHaveCount(0);
  await button(page, 'close-modal').click(); await button(page, 'new-work').click();
  await expect(name).toHaveValue('Final available draft');
  await expect(page.locator('[data-action-status]')).toHaveCount(0);
  assert.equal(requests.filter(r => r.path === 'works' && r.method === 'POST').length, 1);
});

test('Work naming: older creation rejection cannot clear the newer name conflict', async t => {
  let releaseA!: () => void, releaseB!: () => void;
  const gateA = new Promise<void>(done => releaseA = done);
  const gateB = new Promise<void>(done => releaseB = done);
  t.after(async () => { releaseA(); releaseB(); });
  const { page, requests } = await fixture(t, async r => {
    if (r.path === 'works' && r.method === 'POST') {
      await (JSON.parse(r.body).name === 'A taken' ? gateA : gateB);
      return { status: 409, json: { code: 'WORK_NAME_CONFLICT', field: 'name' } };
    }
  });
  await button(page, 'back-works').click(); await button(page, 'new-work').click();
  const name = page.locator('#create-name');
  await name.fill('A taken'); await button(page, 'create-work').click();
  await expect.poll(() => requests.filter(r => r.path === 'works' && r.method === 'POST').length).toBe(1);
  await name.fill('B taken'); await button(page, 'toggle-create-advanced').click();
  await page.locator('#create-json').fill('{"agentsMd":"Keep B draft"}');
  await button(page, 'create-work').click();
  await expect.poll(() => requests.filter(r => r.path === 'works' && r.method === 'POST').length).toBe(2);
  releaseB();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#create-name-error')).toContainText('Choose a different name.');
  const olderResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.request().postDataJSON()?.name === 'A taken');
  releaseA(); await (await olderResponse).finished();
  await expect(page.locator('[data-action-status][aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => done())));
  await expect(name).toHaveValue('B taken');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(name).toHaveAttribute('aria-describedby', 'create-name-error');
  await expect(page.locator('#create-name-error')).toContainText('Choose a different name.');
  await expect(page.locator('#modal [role=alert]')).toHaveCount(1);
  await expect(page.locator('#modal')).not.toContainText('The request for Work name "A taken" was rejected.');
  await expect(page.locator('#create-json')).toHaveValue('{"agentsMd":"Keep B draft"}');
  const posts = requests.filter(r => r.path === 'works' && r.method === 'POST').map(r => JSON.parse(r.body));
  assert.deepEqual(posts.map(post => post.name), ['A taken', 'B taken']);
  assert.equal(posts[1].configuration.agentsMd, 'Keep B draft');
});

test('Work naming: delayed Import conflict preserves a cleared name until the user explicitly submits again', async t => {
  let release!: () => void;
  const gate = new Promise<void>(done => release = done); t.after(async () => release());
  let imports = 0;
  const { page, requests } = await fixture(t, async r => {
    if (r.path === 'work-packages/transfer-name') return { json: { phase: 'ready' } };
    if (r.path === 'work-imports' && r.method === 'POST') {
      if (++imports === 1) {
        await gate;
        return { status: 409, json: { code: 'WORK_NAME_CONFLICT', field: 'name' } };
      }
      return { status: 202, json: { operationId: 'operation-name-import', workId: 'work-name-import', name: '笔记-3' } };
    }
  });
  await inspectedNamingWork(page, '笔记');
  const name = page.locator('#import-name');
  await name.fill('Taken'); await button(page, 'confirm-import').click();
  await expect.poll(() => imports).toBe(1);
  await expect(name).toBeEnabled(); await name.fill('');
  release();
  await expect(page.locator('#modal')).toContainText('The request for Work name "Taken" was rejected.');
  await expect(name).toHaveValue('');
  await expect(name).not.toHaveAttribute('aria-invalid', 'true');
  await expect(name).toHaveAttribute('aria-describedby', 'import-name-help');
  await expect(page.locator('#import-name-error')).toHaveCount(0);
  await expect(page.locator('.import-result')).toBeVisible();
  await expect(page.locator('#modal .feedback.warning[role=status]')).toHaveCount(1);
  await expect(page.locator('[data-action-status]')).toHaveCount(0);
  assert.equal(imports, 1);
  await button(page, 'confirm-import').click();
  await expect(page.locator('.import-name-feedback')).toContainText('笔记-3');
  const posts = requests.filter(r => r.path === 'work-imports' && r.method === 'POST').map(r => JSON.parse(r.body));
  assert.equal(posts.length, 2); assert.equal(posts[0].name, 'Taken'); assert.equal('name' in posts[1], false);
  assert.equal(posts[0].transferId, posts[1].transferId);
  assert.equal(requests.filter(r => r.method === 'POST' && r.path === 'work-packages').length, 0);
});

test('Work naming: delayed conflicts still mark the field when only surrounding whitespace changes', async t => {
  for (const importing of [false, true]) {
    await t.test(importing ? 'Import' : 'creation', async t => {
      let release!: () => void;
      const gate = new Promise<void>(done => release = done); t.after(async () => release());
      const path = importing ? 'work-imports' : 'works';
      const { page, requests } = await fixture(t, async r => {
        if (r.path === 'work-packages/transfer-name') return { json: { phase: 'ready' } };
        if (r.path === path && r.method === 'POST') {
          await gate;
          return { status: 409, json: { code: 'WORK_NAME_CONFLICT', field: 'name' } };
        }
      });
      if (importing) await inspectedNamingWork(page, '笔记');
      else { await button(page, 'back-works').click(); await button(page, 'new-work').click(); }
      const name = page.locator(importing ? '#import-name' : '#create-name');
      await name.fill(' Taken '); await button(page, importing ? 'confirm-import' : 'create-work').click();
      await expect.poll(() => requests.filter(r => r.path === path && r.method === 'POST').length).toBe(1);
      await name.fill('Taken '); release();
      await expect(name).toHaveValue('Taken ');
      await expect(name).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator(importing ? '#import-name-error' : '#create-name-error')).toContainText('Choose a different name.');
      await expect(page.locator('#modal [role=alert]')).toHaveCount(1);
      const posts = requests.filter(r => r.path === path && r.method === 'POST');
      assert.equal(posts.length, 1); assert.equal(JSON.parse(posts[0]!.body).name, 'Taken');
    });
  }
});

test('Work naming: explicit Import conflict keeps the inspected package and only resubmits on user action', async t => {
  let imports = 0;
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'work-packages/transfer-name') return { json: { phase: 'ready' } };
    if (r.path === 'work-imports' && r.method === 'POST') {
      imports++;
      return imports === 1 ? { status: 409, json: { code: 'WORK_NAME_CONFLICT', field: 'name', message: 'Name reserved' } }
        : { status: 202, json: { operationId: 'operation-name-import', workId: 'work-name-import', name: '笔记-3' } };
    }
  });
  await inspectedNamingWork(page, '笔记');
  await api(page, `adapter.inspection.bindingRequirements={models:Array.from({length:20},()=>({provider:'fixture',model:'one'}))};adapter.emit();`);
  await page.locator('#import-name').fill('Taken'); await button(page, 'confirm-import').click();
  await expect(page.locator('#import-name-error')).toContainText('let Core choose one');
  await expect(page.locator('#import-name-error')).toBeInViewport();
  await expect(page.locator('#import-name')).toHaveValue('Taken');
  await expect(page.locator('#import-name')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#import-name')).toHaveAttribute('aria-describedby', /import-name-error/);
  await expect(page.locator('.import-result')).toBeVisible();
  await expect(page.locator('#modal [role=alert]')).toHaveCount(1);
  await expect(page.locator('[data-action-status]')).toHaveCount(0);
  assert.equal(imports, 1);
  await page.locator('#import-name').fill('');
  await expect(page.locator('#import-name-error')).toHaveCount(0);
  assert.equal(imports, 1);
  await button(page, 'confirm-import').click();
  await expect(page.locator('.import-name-feedback')).toContainText('笔记-3');
  const posts = requests.filter(r => r.path === 'work-imports' && r.method === 'POST').map(r => JSON.parse(r.body));
  assert.equal(posts.length, 2); assert.equal(posts[0].name, 'Taken'); assert.equal('name' in posts[1], false);
  assert.equal(posts[0].transferId, posts[1].transferId);
  assert.equal(requests.filter(r => r.method === 'POST' && r.path === 'work-packages').length, 0);
});

test('Work naming: Import uses the actual Core name and preserves it across stage updates', async t => {
  for (const entry of [
    { source: '笔记', input: '', actual: '笔记-3', renamed: true },
    { source: '笔记', input: '研究笔记', actual: '研究笔记', renamed: false },
    { source: '笔记', input: '', actual: '笔记', renamed: false },
    { source: undefined, input: '', actual: 'Recovered name', renamed: false },
    { source: '笔记', input: '', actual: undefined, renamed: false },
  ]) {
    await t.test(entry.actual || 'name not confirmed', async t => {
      let state = 'running';
      const { page, requests } = await fixture(t, r => {
        if (r.path === 'work-imports' && r.method === 'POST') return { status: 202, json: { operationId: 'operation-name-import', workId: 'work-name-import', ...(entry.actual ? { name: entry.actual } : {}) } };
        if (r.path === 'operations/operation-name-import') return { json: { operationId: 'operation-name-import', workId: 'work-name-import', kind: 'import-work', state, ...(state === 'failed' ? { error: { message: 'Import failed safely' } } : {}) } };
        if (r.path === 'works/work-name-import') return state === 'succeeded'
          ? { json: { id: 'work-name-import', name: entry.actual || 'Confirmed later', desiredState: 'stopped', observedState: 'stopped' } }
          : { status: 404, json: { code: 'NOT_FOUND' } };
      });
      await inspectedNamingWork(page, entry.source);
      await page.locator('#import-name').fill(entry.input); await button(page, 'confirm-import').click();
      const feedback = page.locator('.import-name-feedback');
      await expect(feedback).toContainText(entry.actual || 'has not been confirmed');
      await expect(feedback).not.toContainText('Imported as');
      assert.equal((await feedback.textContent())!.includes('because the source name was unavailable'), entry.renamed);
      await button(page, 'check-operation').click();
      await expect(feedback).toContainText(entry.actual || 'has not been confirmed');
      assert.equal(await api(page, `return adapter.getOperation('operation-name-import').importName;`), entry.actual);
      state = 'failed'; await button(page, 'check-operation').click();
      await expect(page.locator('#modal')).toContainText('Import failed safely');
      await expect(feedback).not.toContainText('Imported as');
      state = 'succeeded'; await button(page, 'check-operation').click();
      if (!entry.actual) await api(page, `await adapter.refreshWorkStatus('work-name-import');`);
      await expect(feedback).toContainText('Imported as');
      await expect(feedback).toContainText(entry.actual || 'Confirmed later');
      assert.equal(requests.filter(r => r.path === 'work-imports' && r.method === 'POST').length, 1);
      assert.equal(requests.filter(r => r.path === 'work-packages' && r.method === 'POST').length, 0);
    });
  }
});

const controlRun=(id='run-background',state=2,sessionId='session-auto',source:any={kind:'service',serviceName:'Tool A',requestId:'request-a'})=>({workId:'work-1',sessionId,runId:id,submissionKey:'original-key',state,acceptedAt:'2026-10-12T00:00:00Z',actualModel:chatModel,thinkingLevel:'high',source,finalText:state===4?'Original associated reply':''});

test('model authentication failure stays visible in Run history with role-appropriate guidance', async t => {
  for (const role of ['user', 'admin'] as const) await t.test(role, async t => {
    const failure = { code: 'MODEL_AUTHENTICATION_FAILED', message: 'Model authentication failed. Check the API Key.', retryable: false };
    const run = { ...controlRun('run-auth', 5, 'session-1', { kind: 'chat' }), error: failure };
    const { page, requests } = await fixture(t, r => {
      if (r.path === 'session') return { json: { state: 'authenticated', generation: 1, csrf: 'local-session-csrf', coreUrl: 'http://core.test', user: { account: 'fixture', role } } };
      if (r.path === 'works/work-1/sessions/session-1') return { json: { session: { workId: 'work-1', sessionId: 'session-1', modelPreference: null, source: { kind: 'chat' } }, messages: [{ entryId: 'user-auth', runId: 'run-auth', role: 'user', blocks: [{ blockId: 'user-auth', type: 'text', text: 'Original prompt' }] }], runs: [run] } };
      if (r.path === 'works/work-1/runs/run-auth') return { json: run };
      return focusFixture(r);
    });
    const execution = page.locator('.message-execution').filter({ hasText: 'Model authentication failed' });
    await expect(execution).toContainText(role === 'admin' ? 'Open Administration on the connected Core' : 'Ask an administrator');
    await execution.locator('[data-action="run-details"]').click();
    await expect(page.locator('#modal')).toContainText('Model authentication failed');
    await expect(page.locator('#modal')).toContainText(role === 'admin' ? 'Open Administration' : 'Ask an administrator');
    assert.equal(requests.filter(r => r.path === 'logout' || r.path.endsWith('/runs') && r.method === 'POST').length, 0);
  });
});

test('model authentication classification survives live events and original Run readback', async t => {
  const failure = { code: 'MODEL_AUTHENTICATION_FAILED', message: 'Model authentication failed. Check the API Key.', retryable: false };
  const run = { ...controlRun('run-auth-live', 5, 'session-1', { kind: 'chat' }), error: failure };
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works/work-1/runs/run-auth-live/events') return { body: JSON.stringify({ sequence: '1', kind: { $case: 'state', state: { state: 5, error: failure } } }) + '\n', headers: { 'Content-Type': 'application/x-ndjson' } };
    if (r.path === 'works/work-1/runs/run-auth-live') return { json: run };
    if (r.path === 'works/work-1/sessions/session-1') return { json: { session: { workId: 'work-1', sessionId: 'session-1', modelPreference: null, source: { kind: 'chat' } }, messages: [{ entryId: 'user-live', runId: 'run-auth-live', role: 'user', blocks: [{ blockId: 'user-live', type: 'text', text: 'Original prompt' }] }], runs: [run] } };
    return focusFixture(r);
  });
  await api(page, "adapter.getWork('work-1').run={id:'run-auth-live',sessionId:'session-1',status:'running',cursor:0,created:'',source:{kind:'chat'}};await adapter.resumeRun('work-1');");
  assert.equal(await api(page, "return adapter.getWork('work-1').run.errorCode"), 'MODEL_AUTHENTICATION_FAILED');
  assert.equal(await api(page, "return adapter.getWork('work-1').run.errorRetryable"), false);
  await expect(page.locator('.message-execution').filter({ hasText: 'Model authentication failed' })).toContainText('Ask an administrator');
  assert.equal(requests.filter(r => r.path === 'logout' || r.path.endsWith('/runs') && r.method === 'POST').length, 0);
});

test('expired Run cursor restores model permission failure without resending', async t => {
  const failure = { code: 'MODEL_PERMISSION_DENIED', message: 'Model access was denied. Check model permissions.', retryable: false };
  const { page, requests } = await fixture(t, r => {
    if (r.path.endsWith('/runs/original-run/events')) return { status: 410 };
    if (r.path.endsWith('/runs/original-run')) return { json: { run: { state: 5, error: failure } } };
    if (r.path.endsWith('/sessions/session-1')) return { json: { messages: [{ role: 'user', text: 'original prompt' }] } };
  });
  await beginExpiredRun(page);
  const run = await api(page, "return adapter.getWork('work-1').run");
  assert.equal(run.errorCode, 'MODEL_PERMISSION_DENIED');
  assert.equal(run.errorRetryable, false);
  assert.equal(run.executionError, failure.message);
  assert.equal(requests.filter(r => r.path === 'logout' || r.path.endsWith('/runs') && r.method === 'POST').length, 0);
});

test('legacy Run error is shown without inventing an authentication category', async t => {
  const run = { ...controlRun('run-old-agent', 5, 'session-1', { kind: 'chat' }), error: { code: 'MODEL_EXECUTION_FAILED', message: 'The model execution failed.', retryable: true } };
  const { page } = await fixture(t, r => {
    if (r.path === 'works/work-1/sessions/session-1') return { json: { session: { workId: 'work-1', sessionId: 'session-1', modelPreference: null, source: { kind: 'chat' } }, messages: [{ entryId: 'user-old', runId: 'run-old-agent', role: 'user', blocks: [{ blockId: 'user-old', type: 'text', text: 'Original prompt' }] }], runs: [run] } };
    if (r.path === 'works/work-1/runs/run-old-agent') return { json: run };
    return focusFixture(r);
  });
  const execution = page.locator('.message-execution').filter({ hasText: 'The model execution failed.' });
  await expect(execution).toBeVisible();
  await expect(execution).not.toContainText('Ask an administrator');
  await expect(execution).not.toContainText('API Key');
});
const controlRequest=(state='waiting_result',disposition='live')=>({requestId:'request-a',goal:'Build the requested report',source:{kind:'service',serviceName:'Tool A'},state,disposition,createdAt:'2026-10-12T00:00:00Z',updatedAt:'2026-10-12T00:01:00Z',runIds:['run-background'],result:null,error:null,waitRef:state==='waiting_result'?{kind:'job',id:'job-original',deadlineAt:'2026-10-12T00:05:00Z'}:null});
function controlFixture(r:RequestRecord):Reply|undefined {
 if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:3,cancelAndSendContractVersion:1}};
 if(r.path.endsWith('/chat-models'))return{json:chatModels()};
 if(r.path.endsWith('/sessions/session-1/chat-options'))return{json:{workId:'work-1',sessionId:'session-1',modelRef:null,model:chatModel,availability:'available',thinkingLevel:'off',source:{kind:'chat'}}};
 if(r.path.endsWith('/runs/active'))return{json:{run:null}};
 return focusFixture(r);
}

test('Controls Service presence is bounded, discovers the first record, preserves terminal history and stops when hidden',async t=>{
 let present=false,fail=false;
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/agent-requests'))return fail?{status:503,json:{message:'Request status unavailable'}}:{json:{items:present?[controlRequest('completed','historical')]:[],nextCursor:null}};
  return controlFixture(r);
 });
 await expect(page.locator('iframe')).toBeVisible();await page.clock.install();
 await expect.poll(()=>api(page,"return adapter.requestPresence.get('work-1:Tool A')?.confirmed")).toBe(true);
 await expect(button(page,'service-requests')).toHaveCount(0);present=true;await page.clock.runFor(5100);
 await expect(button(page,'service-requests')).toBeVisible();
 const actions=page.locator('.service-toolbar .actions');await expect(actions.locator('button').first()).toHaveAttribute('aria-label','Agent requests');await expect(actions.locator('button').first()).toHaveAttribute('title','Agent requests');
 fail=true;await page.clock.runFor(5100);await expect(button(page,'service-requests')).toBeVisible();
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
 const reads=requests.filter(r=>r.path.endsWith('/agent-requests')).length;await page.clock.runFor(15000);assert.equal(requests.filter(r=>r.path.endsWith('/agent-requests')).length,reads);
 for(const r of requests.filter(r=>r.path.endsWith('/agent-requests'))){const q=new URLSearchParams(r.search);assert.equal(q.get('limit'),'1');assert.equal(q.get('serviceName'),'Tool A');}
 assert.equal(chatWrites(requests).length,0);
});

test('Controls Service detail reads only associated replies, returns list focus and preserves iframe, Main draft and reading position',async t=>{
 let state='waiting_result';
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/agent-requests'))return{json:{items:[controlRequest(state)],nextCursor:null}};
  if(r.path.endsWith('/agent-requests/request-a/cancel')){state='cancelled';return{json:{requestId:'request-a',state}};}
  if(r.path.endsWith('/agent-requests/request-a'))return{json:{request:controlRequest(state),evidence:{items:[],nextCursor:null}}};
  if(r.path.endsWith('/runs/run-background'))return{json:controlRun('run-background',4)};
  return controlFixture(r);
 });
 await expect(button(page,'service-requests')).toBeVisible();await expect(page.locator('iframe')).toBeVisible();await page.locator('#composer').fill('Keep this Main draft');
 await page.evaluate(()=>{(window as any).controlFrame=document.querySelector('iframe');(window as any).controlComposer=document.querySelector('#composer');});
 const loads=requests.filter(r=>r.path==='/_desktop/focus-app/').length;
 await button(page,'service-requests').click();await expect(page.locator('#pi-service-filter')).toHaveValue('Tool A');
 await button(page,'pi-request-detail').click();await expect(page.locator('#modal')).toContainText('Original associated reply');await expect(page.locator('#modal')).toContainText('job-original');
 await expect(page.locator('#modal')).toContainText('Waiting for result');await expect(page.locator('#modal input, #modal textarea')).toHaveCount(0);await expect(button(page,'retry-pi-request')).toHaveCount(0);
 await page.evaluate(()=>{(window as any).requestCheckButton=document.querySelector('#modal .modal-footer [data-action=pi-request-detail]');});
 await button(page,'cancel-pi-request').click();await expect(page.locator('#modal')).toContainText(/[Cc]ancelled/);await expect(button(page,'cancel-pi-request')).toHaveCount(0);
 assert.equal(await page.evaluate(()=>document.querySelector('#modal .modal-footer [data-action=pi-request-detail]')===(window as any).requestCheckButton),true);await button(page,'pi-request-detail').click();await expect(page.locator('#modal h2')).toHaveText('Agent request');
 await button(page,'back-pi-requests').click();await expect(page.locator('#pi-service-filter')).toHaveValue('Tool A');await expect(page.locator('[data-action=pi-request-detail]')).toBeFocused();
 await button(page,'close-modal').click();await expect(button(page,'service-requests')).toBeFocused();await expect(page.locator('#composer')).toHaveValue('Keep this Main draft');
 assert.equal(await page.evaluate(()=>document.querySelector('iframe')===(window as any).controlFrame),true);assert.equal(await page.evaluate(()=>document.querySelector('#composer')===(window as any).controlComposer),true);assert.equal(requests.filter(r=>r.path==='/_desktop/focus-app/').length,loads);
 assert.equal(requests.filter(r=>r.path.includes('/sessions/session-auto')).length,0);assert.equal(chatWrites(requests).length,0);
 assert.equal(requests.filter(r=>r.path.endsWith('/cancel')).length,1);
 await button(page,'service-focus').click();await button(page,'focus-toggle-chat').click();await page.setViewportSize({width:360,height:800});await expect(button(page,'service-requests')).toBeVisible();await expect(button(page,'exit-service-focus')).toBeVisible();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
});

test('Controls cancelling request is observed to its actual terminal result; lost cancel receipt is checked without retry',async t=>{
 let state='running',lose=true;
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/agent-requests'))return{json:{items:[controlRequest(state)],nextCursor:null}};
  if(r.path.endsWith('/agent-requests/request-a/cancel')){state='cancelling';return lose?{abort:true}:{json:{requestId:'request-a'}};}
  if(r.path.endsWith('/agent-requests/request-a'))return{json:{request:controlRequest(state),evidence:{items:[],nextCursor:null}}};
  if(r.path.endsWith('/runs/run-background'))return{json:controlRun('run-background',state==='running'?2:state==='cancelling'?3:6)};
  return controlFixture(r);
 });
 await expect(button(page,'service-requests')).toBeVisible();await button(page,'service-requests').click();await button(page,'pi-request-detail').click();await button(page,'cancel-pi-request').click();
 await expect(page.locator('#modal')).toContainText('response was lost');await button(page,'pi-request-detail').click();await expect(page.locator('#modal')).toContainText(/[Cc]ancelling/);await expect(button(page,'cancel-pi-request')).toBeDisabled();
 await page.clock.install();state='completed';await page.clock.runFor(5100);await expect(page.locator('#modal')).toContainText(/[Cc]ompleted/);await expect(button(page,'cancel-pi-request')).toHaveCount(0);
 assert.equal(requests.filter(r=>r.path.endsWith('/cancel')).length,1);assert.equal(chatWrites(requests).length,0);
});

for(const target of [{session:'session-1',source:{kind:'chat'}},{session:'session-other',source:{kind:'chat'}},{session:'session-auto',source:{kind:'service',serviceName:'Tool A'}}])test(`Controls Stop and send binds ${target.session} and keeps the user Session and later edits`,async t=>{
 let active:any=controlRun('old-run',2,target.session,target.source),release!:()=>void,submitted=false;
 const gate=new Promise<void>(resolve=>release=resolve);t.after(()=>release());
 const {page,requests}=await fixture(t,async r=>{
  if(r.path.endsWith('/runs/active'))return{json:{run:active}};
  if(r.path.endsWith('/runs')&&r.method==='POST'){submitted=true;await gate;const input=JSON.parse(r.body);active=null;return{status:202,json:{run:{...controlRun('new-run',4,'session-1',{kind:'chat'}),submissionKey:input.submissionKey}}};}
  if(r.path.endsWith('/runs/new-run/events'))return{body:'',headers:{'Content-Type':'application/x-ndjson'}};
  if(r.path.endsWith('/runs/new-run'))return{json:controlRun('new-run',4,'session-1',{kind:'chat'})};
  return controlFixture(r);
 });
 await button(page,'tab-Chat').click();await page.locator('#composer').fill('First message');await expect(page.getByRole('button',{name:'Stop and send',exact:true})).toBeEnabled();
 await page.locator('#composer').fill('First message');await page.locator('#composer').press('Shift+Enter');assert.equal(chatWrites(requests).length,0);await page.locator('#composer').fill('First message');
 if(target.session==='session-1')await page.locator('#composer').press('Enter');else await button(page,'send-message').click();await expect.poll(()=>submitted).toBe(true);await expect(page.locator('.message-submission.sending')).toHaveAttribute('aria-label',/Stopping the previous Run/);
 await page.locator('#composer').fill('Later edit');release();await expect.poll(()=>api(page,"return adapter.getWork('work-1').run?.id")).toBe('new-run');await expect(page.locator('#composer')).toHaveValue('Later edit');
 const posts=requests.filter(r=>r.path.endsWith('/runs')&&r.method==='POST');assert.equal(posts.length,1);assert.equal(JSON.parse(posts[0]!.body).cancelRunId,'old-run');assert.equal(JSON.parse(posts[0]!.body).sessionId,'session-1');assert.equal(JSON.parse(posts[0]!.body).prompt,'First message');assert.equal(requests.filter(r=>r.path.endsWith('/cancel')).length,0);
 assert.equal(requests.filter(r=>r.path.endsWith(`/sessions/${target.session}`)&&target.session!=='session-1').length,0);
});

test('Controls timeout preserves draft and late old completion cannot send; unknown acceptance uses original key GET',async t=>{
 let mode='timeout',active:any=controlRun(),originalKey='';
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/runs/active'))return{json:{run:active}};
  if(r.path.endsWith('/runs')&&r.method==='POST'){originalKey=JSON.parse(r.body).submissionKey;return mode==='timeout'?{status:409,json:{code:'CANCEL_TIMEOUT',message:'The previous Run has not stopped; your message was not sent. Check its status'}}:{abort:true};}
  if(r.path.includes('/runs/submissions/'))return{json:{kind:'run',status:'accepted',key:originalKey,run:{...controlRun('recovered-run',4,'session-1',{kind:'chat'}),submissionKey:originalKey}}};
  if(r.path.endsWith('/runs/recovered-run/events'))return{body:'',headers:{'Content-Type':'application/x-ndjson'}};
  if(r.path.endsWith('/runs/recovered-run'))return{json:controlRun('recovered-run',4,'session-1',{kind:'chat'})};
  return controlFixture(r);
 });
 await button(page,'tab-Chat').click();await page.locator('#composer').fill('Keep original');await expect(button(page,'send-message')).toBeEnabled();await button(page,'send-message').click();await page.locator('.message-submission.failed button').click();await expect(page.locator('#modal')).toContainText('your message was not sent');await page.keyboard.press('Escape');await expect(page.locator('#composer')).toHaveValue('Keep original');await expect(page.locator('.message.user').filter({hasText:'Keep original'}).locator('.message-submission.failed button')).toHaveAttribute('aria-label','Message not sent');
 active=null;await api(page,"await adapter.loadActiveRun('work-1',true)");assert.equal(requests.filter(r=>r.path.endsWith('/runs')&&r.method==='POST').length,1);await expect(button(page,'send-message')).toHaveAttribute('aria-label','Send message');
 mode='lost';active=controlRun();await api(page,"await adapter.loadActiveRun('work-1',true)");await button(page,'send-message').click();await page.locator('.message-submission.unknown button').click();await expect(button(page,'check-chat-submission')).toBeVisible();await expect(page.locator('.message-submission.unknown button')).toHaveAttribute('aria-label','Message status unconfirmed');await page.keyboard.press('Escape');await page.locator('#composer').fill('Next draft');await page.locator('.message-submission.unknown button').click();await button(page,'check-chat-submission').click();await expect(page.locator('#composer')).toHaveValue('Next draft');
 await expect.poll(()=>api(page,"return adapter.getWork('work-1').run?.id")).toBe('recovered-run');
 assert.equal(requests.filter(r=>r.path.endsWith('/runs')&&r.method==='POST').length,2);assert.equal(requests.filter(r=>r.path.includes('/runs/submissions/')).length,1);assert.ok(requests.some(r=>r.path.endsWith(`/runs/submissions/${originalKey}`)));
});

test('Controls historical Run information is on demand and never replaces the current observation or shows IDs in the body',async t=>{
 const old=controlRun('historical-run',4,'session-1',{kind:'chat'});
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/sessions/session-1'))return{json:{session:{sessionId:'session-1',workId:'work-1',modelPreference:null},messages:[{role:'user',text:'Original prompt'}],runs:[old]}};
  if(r.path.endsWith('/runs/historical-run'))return{json:old};
  return controlFixture(r);
 });
 await button(page,'tab-Chat').click();await expect(page.locator('#messages .run-history')).toHaveCount(0);assert.ok(!(await page.locator('#messages').textContent())!.includes('historical-run'));
 const current=await api(page,"return adapter.getWork('work-1').run?.id || null");const details=page.locator('[data-action=run-details][data-run-id=historical-run]');await expect(details).toHaveCount(1);if(!await details.isVisible())await page.locator('.unmatched-executions > details > summary').click();await details.click();await expect(page.locator('#modal')).toContainText('Actual model');await expect(page.locator('#modal')).toContainText('high');assert.equal(await api(page,"return adapter.getWork('work-1').run?.id || null"),current);assert.equal(chatWrites(requests).length,0);
});

test('Controls Service scopes discard late reads, share ports, retain list scroll and clear prior identity',async t=>{
 let release!:()=>void,delayed=true;const gate=new Promise<void>(resolve=>release=resolve);t.after(async()=>release());
 const {page,requests}=await fixture(t,async r=>{
  if(r.path.endsWith('/services'))return{json:{services:['a','b'].map(id=>({serviceId:`service-${id}`,name:`Tool ${id.toUpperCase()}`,enabled:true,observedState:'ready',access:{hostname:`${id}.work.test`,ports:[{port:80,url:`http://${id}.work.test`,name:'web'},{port:81,url:`http://${id}.work.test`,name:'extra'}]}}))}};
  if(r.path.endsWith('/agent-requests')){const q=new URLSearchParams(r.search);if(q.get('serviceName')==='Tool A'&&delayed){await gate;return{json:{items:[controlRequest()],nextCursor:null}};}return{json:{items:[],nextCursor:null}};}
  return controlFixture(r);
 });
 await expect(page.locator('#service-select')).toBeVisible();await expect.poll(()=>requests.filter(r=>r.path.endsWith('/agent-requests')).length).toBeGreaterThan(0);
 await page.locator('#service-select').click();await page.locator('[data-action=select-service][data-id=service-b]').click();await expect.poll(()=>api(page,"return adapter.requestPresence.get('work-1:Tool B')?.confirmed")).toBe(true);release();await page.waitForTimeout(100);await expect(button(page,'service-requests')).toHaveCount(0);
 assert.equal(await api(page,"return adapter.requestPresence.get('work-1:Tool A')?.hasRecords || false"),false);
 delayed=false;await button(page,'service-menu').click();await button(page,'manage-services').click();await page.locator('[data-action=service-details][data-id=service-b]').click();await page.getByRole('combobox',{name:'Web entry',exact:true}).selectOption('81');await button(page,'close-modal').click();assert.ok(requests.filter(r=>r.path.endsWith('/agent-requests')).every(r=>!new URLSearchParams(r.search).has('port')));
 await api(page,"await adapter.signOut()");assert.equal(await api(page,"return adapter.requestPresence.size"),0);await expect(button(page,'service-requests')).toHaveCount(0);
});

for(const state of ['pending','waiting_result'])test(`Controls ${state} cancellation completes original record and Close never cancels`,async t=>{
 let current=state;const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/agent-requests'))return{json:{items:[{...controlRequest(current),runIds:[]}],nextCursor:null}};
  if(r.path.endsWith('/agent-requests/request-a'))return{json:{request:{...controlRequest(current),runIds:[]},evidence:{items:[],nextCursor:null}}};
  if(r.path.endsWith('/agent-requests/request-a/cancel')){current='cancelled';return{json:{requestId:'request-a'}};}
  return controlFixture(r);
 });
 await expect(button(page,'service-requests')).toBeVisible();await button(page,'service-requests').click();await button(page,'pi-request-detail').click();await button(page,'back-pi-requests').click();await button(page,'close-modal').click();assert.equal(requests.filter(r=>r.path.endsWith('/cancel')).length,0);
 await button(page,'service-requests').click();await button(page,'pi-request-detail').click();await button(page,'cancel-pi-request').click();await expect(page.locator('#modal')).toContainText(/[Cc]ancelled/);assert.equal(requests.filter(r=>r.path.endsWith('/cancel')).length,1);assert.equal(chatWrites(requests).length,0);
});

test('Controls active read failure stays unconfirmed; empty, unknown commands and IME cannot cancel',async t=>{
 let fail=true;const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/runs/active'))return fail?{status:503,json:{message:'Active status unavailable'}}:{json:{run:controlRun()}};
  return controlFixture(r);
 });
 await button(page,'tab-Chat').click();await expect(button(page,'send-message')).toBeDisabled();await expect(button(page,'check-active-run')).toBeVisible();fail=false;await button(page,'check-active-run').click();await expect(button(page,'send-message')).toHaveAttribute('aria-label','Stop and send');
 await page.locator('#composer').fill('');await expect(button(page,'send-message')).toBeDisabled();await page.locator('#composer').press('Enter');await page.locator('#composer').fill('/unknown');await page.locator('#composer').press('Escape');await button(page,'send-message').click();
 await page.locator('#composer').fill('A valid message');await page.locator('#composer').evaluate(input=>{input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));});assert.equal(chatWrites(requests).length,0);assert.equal(requests.filter(r=>r.path.endsWith('/cancel')).length,0);
 for(const command of ['model','thinking','resume','settings']){await page.locator('#composer').fill('/'+command);await page.locator('#composer').press('Escape');await expect(button(page,'send-message')).toHaveAttribute('aria-label','Send message');}
});

test('older Agent keeps ordinary Send and does not offer Stop and send',async t=>{
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:3}};
  return controlFixture(r);
 });
 await button(page,'tab-Chat').click();
 await api(page,"adapter.getWork('work-1').run={id:'old-run',sessionId:'session-1',status:'running',cursor:0,created:''};await adapter.loadModels('work-1');");
 await expect(button(page,'send-message')).toHaveAttribute('aria-label','Send message');
 await expect(button(page,'send-message')).toBeDisabled();
 assert.equal(requests.filter(r=>r.path.endsWith('/cancel')||r.path.endsWith('/runs')&&r.method==='POST').length,0);
});

test('Controls request pagination, filter and exact list reading position survive details and cancellation',async t=>{
 const rows=Array.from({length:25},(_,i)=>({...controlRequest('pending'),requestId:`request-${i}`,goal:`Request ${i} ${'report details '.repeat(8)}`,runIds:[]}));
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/agent-requests')){const more=new URLSearchParams(r.search).get('cursor')==='page-two';return{json:{items:more?[{...controlRequest('pending'),requestId:'request-25',runIds:[]}]:rows,nextCursor:more?null:'page-two'}};}
  if(r.path.includes('/agent-requests/request-')){const id=r.path.split('/').at(-1);return{json:{request:{...controlRequest('completed'),requestId:id,runIds:[]},evidence:{items:[],nextCursor:null}}};}
  return controlFixture(r);
 });
 await expect(button(page,'service-requests')).toBeVisible();await button(page,'service-requests').click();await button(page,'next-pi-requests').click();await expect(page.locator('#modal [data-action=pi-request-detail]')).toHaveCount(26);
 await page.locator('#modal [data-action=pi-request-detail]').first().focus();await page.locator('.modal-body').evaluate(node=>node.scrollTop=135);
 const before=await page.locator('.modal-body').evaluate(node=>node.scrollTop);
 await page.locator('#modal [data-action=pi-request-detail]').first().evaluate(node=>(node as HTMLButtonElement).click());await button(page,'back-pi-requests').click();
 assert.equal(await page.locator('.modal-body').evaluate(node=>node.scrollTop),before);await expect(page.locator('#modal [data-action=pi-request-detail]')).toHaveCount(26);await expect(page.locator('#pi-service-filter')).toHaveValue('Tool A');await expect(page.locator('#modal [data-action=pi-request-detail]').first()).toBeFocused();
 assert.ok(requests.some(r=>new URLSearchParams(r.search).get('cursor')==='page-two'));assert.equal(chatWrites(requests).length,0);
});

test('Controls recovery: failed reread retains a confirmed Agent reply',async t=>{
 let fail=false;
 const {page}=await fixture(t,r=>{
  if(r.path.endsWith('/agent-requests'))return{json:{items:[controlRequest('completed')],nextCursor:null}};
  if(r.path.endsWith('/agent-requests/request-a'))return{json:{request:controlRequest('completed'),evidence:{items:[],nextCursor:null}}};
  if(r.path.endsWith('/runs/run-background'))return fail?{status:503,json:{message:'Run read temporarily unavailable'}}:{json:controlRun('run-background',4)};
  return controlFixture(r);
 });
 await expect(button(page,'service-requests')).toBeVisible();await button(page,'service-requests').click();await button(page,'pi-request-detail').click();await expect(page.locator('#modal')).toContainText('Original associated reply');
 fail=true;await button(page,'pi-request-detail').click();await expect(page.locator('#modal')).toContainText('reply refresh failed');
 await expect(page.locator('#modal')).toContainText('Original associated reply');
});
test('Controls recovery: another active Run does not hide the current Chat failure',async t=>{
 const {page}=await fixture(t,r=>{
  if(r.path.endsWith('/runs/active'))return{json:{run:controlRun('background-active',2)}};
  return controlFixture(r);
 });
 await button(page,'tab-Chat').click();await expect(button(page,'send-message')).toHaveAttribute('aria-label','Stop and send');
 await api(page,"const w=adapter.getWork('work-1');w.run={id:'failed-manual',sessionId:'session-1',status:'failed',created:'2026-10-12T00:00:00Z',cursor:0,error:'The manual answer failed',source:{kind:'chat'}};w.sessions[0].runs=[w.run];await adapter.loadModels('work-1');");
 await expect(page.locator('.message-execution').filter({has:page.locator('[data-run-id=failed-manual]')})).toContainText('The manual answer failed');
});
for (const timing of ['virtual', 'real'] as const) test(`Controls recovery: cancellation from list follows its terminal state (${timing} time)`,async t=>{
 let state='running';
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/agent-requests'))return{json:{items:[controlRequest(state)],nextCursor:null}};
  if(r.path.endsWith('/agent-requests/request-a/cancel')){state='cancelling';return{json:{requestId:'request-a'}};}
  if(r.path.endsWith('/agent-requests/request-a'))return{json:{request:controlRequest(state),evidence:{items:[],nextCursor:null}}};
  if(r.path.endsWith('/runs/run-background'))return{json:controlRun('run-background',state==='cancelling'?3:6)};
  return controlFixture(r);
 }, false, true, timing === 'virtual' ? page => page.clock.install() : undefined);
 await expect(button(page,'service-requests')).toBeVisible();await button(page,'service-requests').click();await button(page,'pi-request-detail').click();await button(page,'cancel-pi-request').click();await expect(page.locator('#modal')).toContainText(/[Cc]ancelling/);
 await expect.poll(()=>api(page,"return adapter.requestCancellation('work-1','request-a')?.phase;")).toBe('accepted');
 await expect(button(page,'cancel-pi-request')).not.toHaveAttribute('aria-busy','true');
 const reads=()=>requests.filter(r=>r.path.endsWith('/agent-requests/request-a') && r.method==='GET').length;
 const before=reads();state='cancelled';
 if(timing==='virtual')await page.clock.runFor(6000);
 // Execution details can already contain a cancelled Run while the request is
 // still cancelling. Wait for the original request's own terminal state.
 await expect(page.locator('#modal .request-overview .status')).toHaveText('Cancelled',{timeout:10000});
 assert.ok(reads()>before,'the original request must actually be reread to confirm cancellation');
 await expect(button(page,'cancel-pi-request')).toHaveCount(0);
 const terminal=reads();
 if(timing==='virtual')await page.clock.runFor(15000);else await page.waitForTimeout(5500);
 assert.equal(reads(),terminal,'a terminal request must stop automatic detail reads');
 assert.equal(requests.filter(r=>r.path.endsWith('/cancel') && r.method==='POST').length,1);
 assert.equal(chatWrites(requests).length,0);
});

test('Controls recovery: lost Retry receipt resolves only through the original read key',async t=>{
 const original={...controlRequest('failed'),source:{kind:'chat'},runIds:[]};
 const retried={...original,requestId:'request-retried',retryOf:'request-a',state:'completed',result:'Retried once'};
 let originalKey='',lookupMode='not-found';
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/agent-requests'))return{json:{items:[original],nextCursor:null}};
  if(r.path.endsWith('/agent-requests/request-a/retry')){originalKey=JSON.parse(r.body).submissionKey;return{abort:true};}
  if(r.path.endsWith('/retry-submission')){
   assert.equal(new URLSearchParams(r.search).get('submissionKey'),originalKey);
   if(lookupMode==='unsupported')return{status:501,json:{code:'RETRY_SUBMISSION_LOOKUP_UNSUPPORTED',message:'Lookup unsupported'}};
   if(lookupMode==='old-core')return{status:404,json:{code:'NOT_FOUND',message:'Old Core has no lookup route'}};
   if(lookupMode==='foreign-work')return{json:{workId:'foreign-work',requestId:'request-a',submissionKey:originalKey,status:'accepted',request:retried}};
   return{json:{workId:'work-1',requestId:'request-a',submissionKey:originalKey,status:lookupMode==='foreign'?'accepted':lookupMode,request:lookupMode==='accepted'?retried:lookupMode==='foreign'?{...retried,retryOf:'wrong-original'}:null}};
  }
  if(r.path.endsWith('/agent-requests/request-a'))return{json:{request:original,evidence:{items:[],nextCursor:null}}};
  if(r.path.endsWith('/agent-requests/request-retried'))return{json:{request:retried,evidence:{items:[],nextCursor:null}}};
  return controlFixture(r);
 });
 await button(page,'tab-Chat').click();await button(page,'pi-requests').click();await button(page,'pi-request-detail').click();
 await button(page,'retry-pi-request').click();await expect(page.locator('#modal')).toContainText('response was lost');
 const key=await api(page,"return adapter.requestRetries.get('work-1:request-a').submissionKey");
 await api(page,"adapter.requestRetries.set('work-1:unrelated',{submissionKey:'unrelated-key',error:'unknown',unknown:true})");
 for(const mode of ['not-found','unsupported','old-core','foreign-work','foreign']){
  lookupMode=mode;await button(page,'pi-request-detail').click();
  await expect(button(page,'retry-pi-request')).toBeDisabled();
  assert.equal(await api(page,"return adapter.requestRetries.get('work-1:request-a').submissionKey"),key);
 }
 lookupMode='accepted';await button(page,'pi-request-detail').click();
 await expect(page.locator('#modal')).toContainText('Retried once');
 assert.equal(await api(page,"return adapter.requestRetries.has('work-1:request-a')"),false);
 assert.equal(requests.filter(r=>r.path.endsWith('/retry')&&r.method==='POST').length,1);
 assert.equal(requests.filter(r=>r.path.endsWith('/retry-submission')&&r.method==='GET').length,6);
 assert.equal(await api(page,"return adapter.requestRetries.get('work-1:unrelated').submissionKey"),'unrelated-key');
});

test('Controls recovery: partial reply reads retain independent values and exclude removed associations',async t=>{
 let failed=false,version=1,ids=['run-background','run-second'];
 const {page}=await fixture(t,r=>{
  const request={...controlRequest('completed'),runIds:ids};
  if(r.path.endsWith('/agent-requests'))return{json:{items:[request],nextCursor:null}};
  if(r.path.endsWith('/agent-requests/request-a'))return{json:{request,evidence:{items:[],nextCursor:null}}};
  if(r.path.endsWith('/runs/run-background'))return failed?{status:503,json:{message:'Temporarily offline'}}:{json:{...controlRun('run-background',4),finalText:'First reply '+version}};
  if(r.path.endsWith('/runs/run-second'))return{json:{...controlRun('run-second',4),finalText:'Second reply '+version}};
  return controlFixture(r);
 });
 await expect(button(page,'service-requests')).toBeVisible();await button(page,'service-requests').click();await button(page,'pi-request-detail').click();
 await expect(page.locator('#modal')).toContainText('First reply 1');await expect(page.locator('#modal')).toContainText('Second reply 1');
 failed=true;version=2;await button(page,'pi-request-detail').click();
 await expect(page.locator('#modal')).toContainText('reply refresh failed');await expect(page.locator('#modal')).toContainText('First reply 1');await expect(page.locator('#modal')).toContainText('Second reply 2');await expect(page.locator('#modal')).toContainText('Last confirmed');
 failed=false;version=3;await button(page,'pi-request-detail').click();await expect(page.locator('#modal')).toContainText('First reply 3');await expect(page.locator('#modal')).not.toContainText('reply refresh failed');
 ids=['run-second'];await button(page,'pi-request-detail').click();await expect(page.locator('#modal')).not.toContainText('First reply');
});

test('Controls recovery: original interrupted observer actions stay bound while another Session is active',async t=>{
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/runs/active'))return{json:{run:controlRun('background-active',2)}};
  if(r.path.endsWith('/runs/interrupted-manual'))return{json:{...controlRun('interrupted-manual',2,'session-1',{kind:'chat'}),error:{message:'Observer interrupted'}}};
  return controlFixture(r);
 });
 await button(page,'tab-Chat').click();await expect(button(page,'send-message')).toHaveAttribute('data-cancel-run-id','background-active');
 await api(page,"const w=adapter.getWork('work-1');w.run={id:'interrupted-manual',sessionId:'session-1',status:'running',created:'2026-10-12T00:00:00Z',cursor:7,error:'Observer interrupted',source:{kind:'chat'}};w.sessions[0].runs=[w.run];await adapter.loadModels('work-1');");
 await expect(page.locator('.message-execution').filter({has:page.locator('[data-run-id=interrupted-manual]')})).toContainText('Observer interrupted');
 const original=page.locator('[data-action=run-details][data-run-id=interrupted-manual]');await expect(original).toHaveAttribute('data-run-id','interrupted-manual');await original.click();
 await expect(page.locator('#modal')).toContainText('interrupted-manual');
 await expect.poll(()=>requests.some(r=>r.path.endsWith('/runs/interrupted-manual')&&r.method==='GET')).toBe(true);
 assert.equal(await api(page,"return adapter.activeRuns.get('work-1').run.id"),'background-active');
 assert.equal(await api(page,"return adapter.getWork('work-1').run.id"),'interrupted-manual');
 assert.equal(requests.filter(r=>r.method==='POST'&&r.path.endsWith('/runs')).length,0);
});

test('Controls recovery: closing or hiding cancellation list stops reads and reopening checks original once',async t=>{
 let state='running',fail=false;
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/agent-requests'))return{json:{items:[controlRequest(state)],nextCursor:null}};
  if(r.path.endsWith('/agent-requests/request-a/cancel')){state='cancelling';return{abort:true};}
  if(r.path.endsWith('/agent-requests/request-a'))return fail?{status:503,json:{message:'Read temporarily failed'}}:{json:{request:controlRequest(state),evidence:{items:[],nextCursor:null}}};
  if(r.path.endsWith('/runs/run-background'))return{json:controlRun('run-background',state==='cancelled'?6:3)};
  return controlFixture(r);
 });
 await expect(button(page,'service-requests')).toBeVisible();await button(page,'service-requests').click();
 await button(page,'pi-request-detail').click();await button(page,'cancel-pi-request').click();await expect(page.locator('#modal')).toContainText('response was lost');await button(page,'back-pi-requests').click();
 await page.clock.install();
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
 await page.clock.runFor(5100);await expect(page.locator('#modal')).toContainText(/[Cc]ancelling/);
 fail=true;await page.clock.runFor(5100);await expect(page.locator('#modal')).toContainText('Cancellation status not confirmed');await expect(page.locator('#modal')).toContainText(/[Cc]ancelling/);
 await button(page,'close-modal').click();const reads=()=>requests.filter(r=>r.path.endsWith('/agent-requests/request-a')).length,closed=reads();
 await page.clock.runFor(15000);assert.equal(reads(),closed);
 fail=false;state='cancelled';await button(page,'service-requests').click();await expect(page.locator('#modal')).toContainText(/[Cc]ancelled/);
 await expect(button(page,'cancel-pi-request')).toHaveCount(0);assert.equal(requests.filter(r=>r.path.endsWith('/cancel')).length,1);
});

test('Controls recovery: late reply and Retry lookups cannot repopulate a new identity',async t=>{
 let releaseReply!:()=>void,releaseLookup!:()=>void;
 const replyGate=new Promise<void>(resolve=>releaseReply=resolve),lookupGate=new Promise<void>(resolve=>releaseLookup=resolve);
 t.after(()=>{releaseReply();releaseLookup();});
 let delayed=false,lookupStarted=false;
 const original={...controlRequest('failed'),source:{kind:'chat'}};
 const {page}=await fixture(t,async r=>{
  if(r.path.endsWith('/agent-requests'))return{json:{items:[original],nextCursor:null}};
  if(r.path.endsWith('/agent-requests/request-a'))return{json:{request:original,evidence:{items:[],nextCursor:null}}};
  if(r.path.endsWith('/runs/run-background')){if(delayed)await replyGate;return{json:controlRun('run-background',4)};}
  if(r.path.endsWith('/retry-submission')){lookupStarted=true;await lookupGate;return{json:{workId:'work-1',requestId:'request-a',submissionKey:'original-key',status:'accepted',request:{...original,requestId:'retried',retryOf:'request-a'}}};}
  return controlFixture(r);
 });
 await button(page,'tab-Chat').click();await button(page,'pi-requests').click();await button(page,'pi-request-detail').click();await expect(page.locator('#modal')).toContainText('Original associated reply');
 delayed=true;
 const pending=api(page,"void adapter.loadRequest('work-1','request-a');adapter.requestRetries.set('work-1:request-a',{submissionKey:'original-key',error:'unknown',unknown:true});try{await adapter.checkRequestRetry('work-1','request-a');}catch{}");
 await expect.poll(()=>lookupStarted).toBe(true);await api(page,"await adapter.signOut()");releaseReply();releaseLookup();await pending;
 assert.equal(await api(page,"return adapter.requestResponses.size"),0);assert.equal(await api(page,"return adapter.requestRetries.size"),0);
 await expect(page.locator('#app')).not.toContainText('Original associated reply');
});

test('Controls recovery: first unconfirmed reply differs from a failed refresh and recovers',async t=>{
 let fail=true;
 const {page}=await fixture(t,r=>{
  if(r.path.endsWith('/agent-requests'))return{json:{items:[controlRequest('completed')],nextCursor:null}};
  if(r.path.endsWith('/agent-requests/request-a'))return{json:{request:controlRequest('completed'),evidence:{items:[],nextCursor:null}}};
  if(r.path.endsWith('/runs/run-background'))return fail?{status:503,json:{message:'Not yet readable'}}:{json:controlRun('run-background',4)};
  return controlFixture(r);
 });
 await expect(button(page,'service-requests')).toBeVisible();await button(page,'service-requests').click();await button(page,'pi-request-detail').click();
 await expect(page.locator('#modal')).toContainText('reply has not been confirmed');await expect(page.locator('#modal')).not.toContainText('last confirmed content retained');await expect(page.locator('#modal')).not.toContainText('Last confirmed');
 fail=false;await button(page,'pi-request-detail').click();await expect(page.locator('#modal')).toContainText('Original associated reply');await expect(page.locator('#modal')).toContainText('Last confirmed');await expect(page.locator('#modal')).not.toContainText('reply refresh failed');
});

test('Controls recovery: a changed association during an in-flight read loads only its current replies',async t=>{
 let ids=['run-background'],started=false,release!:()=>void;
 const gate=new Promise<void>(resolve=>release=resolve);t.after(()=>release());
 const {page}=await fixture(t,async r=>{
  const request={...controlRequest('completed'),runIds:ids};
  if(r.path.endsWith('/agent-requests'))return{json:{items:[request],nextCursor:null}};
  if(r.path.endsWith('/agent-requests/request-a'))return{json:{request,evidence:{items:[],nextCursor:null}}};
  if(r.path.endsWith('/runs/run-background')){started=true;await gate;return{json:{...controlRun('run-background',4),finalText:'Removed reply'}};}
  if(r.path.endsWith('/runs/run-current'))return{json:{...controlRun('run-current',4),finalText:'Current associated reply'}};
  return controlFixture(r);
 });
 await expect(button(page,'service-requests')).toBeVisible();await button(page,'service-requests').click();await button(page,'pi-request-detail').click();await expect.poll(()=>started).toBe(true);
 ids=['run-current'];await button(page,'pi-request-detail').click();release();
 await expect(page.locator('#modal')).toContainText('Current associated reply');await expect(page.locator('#modal')).not.toContainText('Removed reply');
});

test('Controls pagination: late evidence preserves the confirmed terminal and original list context',async t=>{
 let state='running',started=false,release!:()=>void;
 const gate=new Promise<void>(resolve=>release=resolve);t.after(()=>release());
 const record=()=>({...controlRequest(state),updatedAt:state==='cancelled'?'2026-10-13T00:02:00Z':'2026-10-13T00:01:00Z',
  result:state==='cancelled'?'Final checked result':null,error:state==='cancelled'?{code:'FINAL_DIAGNOSTIC',message:'Final checked diagnostic'}:null});
 const filler=Array.from({length:24},(_,i)=>({...controlRequest('completed'),requestId:`other-${i}`,goal:`Other report ${i}`,runIds:[]}));
 const {page,requests}=await fixture(t,async r=>{
  if(r.path.endsWith('/agent-requests')){
   const q=new URLSearchParams(r.search);
   return{json:{items:q.get('limit')==='1'?[record()]:q.get('cursor')?[{...filler[0],requestId:'second-list-page'}]:[record(),...filler],nextCursor:q.get('cursor')?null:'list-page-two'}};
  }
  if(r.path.endsWith('/agent-requests/request-a/cancel')){state='cancelling';return{json:{requestId:'request-a'}};}
  if(r.path.endsWith('/agent-requests/request-a')){
   const captured=record();
   if(new URLSearchParams(r.search).has('cursor')){started=true;await gate;return{json:{request:captured,checkedAt:'2026-10-13T00:01:00Z',evidence:{items:[{evidenceId:'second',kind:'query',summary:'Delayed second evidence page'}],nextCursor:null}}};}
   return{json:{request:captured,checkedAt:state==='cancelled'?'2026-10-13T00:02:00Z':'2026-10-13T00:01:00Z',evidence:{items:[{evidenceId:'first',kind:'query',summary:'First evidence page'}],nextCursor:'evidence-page-two'}}};
  }
  if(r.path.endsWith('/runs/run-background'))return{json:controlRun('run-background',4)};
  return controlFixture(r);
 });
 await expect(button(page,'service-requests')).toBeVisible();await expect(page.locator('iframe')).toBeVisible();
 await page.locator('#composer').fill('Keep draft during evidence pagination');
 await page.evaluate(()=>{(window as any).paginationFrame=document.querySelector('iframe');(window as any).paginationFrameLoads=0;document.querySelector('iframe')!.addEventListener('load',()=>{(window as any).paginationFrameLoads++;});});
 await page.clock.install();await button(page,'service-requests').click();await button(page,'next-pi-requests').click();
 await expect(page.locator('#modal [data-action=pi-request-detail]')).toHaveCount(26);
 await page.locator('#modal [data-action=pi-request-detail][data-id=request-a]').click();await button(page,'cancel-pi-request').click();await expect(page.locator('#modal')).toContainText(/[Cc]ancelling/);await button(page,'back-pi-requests').click();
 const detail=page.locator('#modal [data-action=pi-request-detail][data-id=request-a]');
 await detail.focus();await page.locator('.modal-body').evaluate(node=>node.scrollTop=135);
 const listScroll=await page.locator('.modal-body').evaluate(node=>node.scrollTop);
 await detail.evaluate(node=>(node as HTMLButtonElement).click());await page.locator('#modal .request-evidence > summary').click();
 const more=button(page,'next-pi-evidence').click();await expect.poll(()=>started).toBe(true);
 state='cancelled';await api(page,"await adapter.loadRequest('work-1','request-a',false,false)");
 await expect(page.locator('#modal')).toContainText(/[Cc]ancelled/);await expect(page.locator('#modal')).toContainText('Original associated reply');
 const confirmed=await api(page,"const d=adapter.requestDetails.get('work-1:request-a');return {request:d.request,checkedAt:d.checkedAt}");
 release();await more;await expect(page.locator('#modal')).toContainText('Delayed second evidence page');
 assert.deepEqual(await api(page,"const d=adapter.requestDetails.get('work-1:request-a');return {request:d.request,checkedAt:d.checkedAt}"),confirmed);
 await expect(page.locator('#modal')).toContainText(/[Cc]ancelled/);await expect(page.locator('#modal')).toContainText('Final checked result');await expect(page.locator('#modal')).toContainText('Final checked diagnostic');
 assert.deepEqual(await api(page,"const d=adapter.requestDetails.get('work-1:request-a');return {request:d.request,checkedAt:d.checkedAt}"),confirmed);
 assert.deepEqual(await api(page,"return adapter.requestDetails.get('work-1:request-a').evidence.items.map(e=>e.evidenceId)"),['first','second']);
 assert.equal(await api(page,"return adapter.requestDetails.get('work-1:request-a').evidence.nextCursor"),null);
 assert.equal(await api(page,"return adapter.cancellingRequests.has('work-1:request-a')"),false);
 await button(page,'back-pi-requests').click();
 await expect(page.locator('#pi-service-filter')).toHaveValue('Tool A');await expect(page.locator('#modal [data-action=pi-request-detail]')).toHaveCount(26);await expect(detail).toBeFocused();
 assert.equal(await page.locator('.modal-body').evaluate(node=>node.scrollTop),listScroll);
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
 const readbacks=()=>requests.filter(r=>r.path.endsWith('/agent-requests/request-a')).length,before=readbacks();
 await page.clock.runFor(6000);
 assert.equal(await api(page,"return adapter.requestPage('work-1','Tool A').items.find(r=>r.requestId==='request-a').state"),'cancelled');
 assert.equal(readbacks(),before);await expect(button(page,'cancel-pi-request')).toHaveCount(0);
 await button(page,'close-modal').click();await expect(button(page,'service-requests')).toBeFocused();await expect(page.locator('#composer')).toHaveValue('Keep draft during evidence pagination');
 assert.equal(await page.evaluate(()=>document.querySelector('iframe')===(window as any).paginationFrame && (window as any).paginationFrameLoads===0),true);
 assert.equal(requests.filter(r=>r.path.endsWith('/cancel')).length,1);assert.equal(chatWrites(requests).length,0);
});

test('Controls pagination: late evidence retains current replies, status errors and newly confirmed evidence',async t=>{
 let latest=false,started=false,release!:()=>void;
 const gate=new Promise<void>(resolve=>release=resolve);t.after(()=>release());
 const record=()=>({...controlRequest(latest?'failed':'pending'),runIds:latest?['run-current']:[],result:latest?'Latest result':null,error:latest?{code:'LATEST_ERROR',message:'Latest execution error'}:null});
 const {page,requests}=await fixture(t,async r=>{
  if(r.path.endsWith('/agent-requests'))return{json:{items:[record()],nextCursor:null}};
  if(r.path.endsWith('/agent-requests/request-a')){
   const captured=record();
   if(new URLSearchParams(r.search).has('cursor')){started=true;await gate;return{json:{request:captured,checkedAt:'2026-10-13T00:01:00Z',evidence:{items:[{evidenceId:'current',kind:'query',summary:'Stale proof copy'},{evidenceId:'second',kind:'query',summary:'Delayed proof'}],nextCursor:null}}};}
   return{json:{request:captured,checkedAt:latest?'2026-10-13T00:02:00Z':'2026-10-13T00:01:00Z',evidence:{items:[{evidenceId:'first',kind:'query',summary:'Initial proof'},...(latest?[{evidenceId:'current',kind:'query',summary:'Newly confirmed proof'}]:[])],nextCursor:'evidence-page-two'}}};
  }
  if(r.path.endsWith('/runs/run-current'))return{json:{...controlRun('run-current',5),finalText:'Latest associated reply'}};
  return controlFixture(r);
 });
 await expect(button(page,'service-requests')).toBeVisible();await button(page,'service-requests').click();await button(page,'pi-request-detail').click();await page.locator('#modal .request-evidence > summary').click();
 const more=button(page,'next-pi-evidence').click();await expect.poll(()=>started).toBe(true);
 latest=true;await api(page,"await adapter.loadRequest('work-1','request-a',false,false)");
 await expect(page.locator('#modal')).toContainText('Latest associated reply');
 await expect.poll(()=>api(page,"return adapter.requestResponses.get('work-1:request-a').loading")).toBe(false);
 // Seed the existing status-observation error; evidence success cannot confirm status.
 await api(page,"adapter.requestDetails.get('work-1:request-a').readError='Original status read is unconfirmed';adapter.requestReadErrors.set('work-1:request-a','Original status read is unconfirmed');");
 const confirmed=await api(page,"return {reply:adapter.requestResponses.get('work-1:request-a'),request:adapter.requestDetails.get('work-1:request-a').request}");
 release();await more;await expect(page.locator('#modal')).toContainText('Delayed proof');
 for(const text of ['Latest associated reply','Newly confirmed proof','Latest result','Latest execution error','Original status read is unconfirmed'])await expect(page.locator('#modal')).toContainText(text);
 assert.deepEqual(await api(page,"return {reply:adapter.requestResponses.get('work-1:request-a'),request:adapter.requestDetails.get('work-1:request-a').request}"),confirmed);
 assert.equal(await api(page,"return adapter.requestReadErrors.get('work-1:request-a')"),'Original status read is unconfirmed');
 await expect(page.locator('#modal')).not.toContainText('Stale proof copy');
 assert.deepEqual(await api(page,"return adapter.requestDetails.get('work-1:request-a').evidence.items.map(e=>e.evidenceId)"),['first','current','second']);
 assert.equal(requests.filter(r=>r.path.endsWith('/runs/run-current')).length,1);assert.equal(chatWrites(requests).length,0);
});

for(const scope of ['view','identity'])test(`Controls pagination: late evidence is discarded after ${scope} changes`,async t=>{
 let started=false,release!:()=>void;
 const gate=new Promise<void>(resolve=>release=resolve);t.after(()=>release());
 const {page,requests}=await fixture(t,async r=>{
  if(r.path.endsWith('/agent-requests'))return{json:{items:[{...controlRequest('completed'),runIds:[]}],nextCursor:null}};
  if(r.path.endsWith('/agent-requests/request-a')){
   if(new URLSearchParams(r.search).has('cursor')){started=true;await gate;return{json:{request:{...controlRequest('completed'),runIds:[]},evidence:{items:[{evidenceId:'late',kind:'query',summary:'Abandoned evidence'}],nextCursor:null}}};}
   return{json:{request:{...controlRequest('completed'),runIds:[]},evidence:{items:[],nextCursor:'more'}}};
  }
  return controlFixture(r);
 });
 await expect(button(page,'service-requests')).toBeVisible();await button(page,'service-requests').click();await button(page,'pi-request-detail').click();await page.locator('#modal .request-evidence > summary').click();
 const more=api(page,"try{await adapter.loadRequest('work-1','request-a',true);}catch{}");await expect.poll(()=>started).toBe(true);
 if(scope==='view'){await button(page,'back-pi-requests').click();await expect(page.locator('#modal h2')).toHaveText('Agent requests');}
 else await api(page,"await adapter.signOut()");
 release();await more;
 if(scope==='view')assert.deepEqual(await api(page,"return adapter.requestDetails.get('work-1:request-a').evidence.items"),[]);
 else assert.equal(await api(page,"return adapter.requestDetails.size"),0);
 await expect(page.locator('#app')).not.toContainText('Abandoned evidence');assert.equal(chatWrites(requests).length,0);
});

test('Reconcile history: 410 readback remains bound to the original Run beside an active Service', async t => {
  let recovering = false, failRunRead = false, historyReads = 0, entered = false, release!: () => void;
  const gate = new Promise<void>(done => release = done); t.after(() => release());
  const { page, requests } = await fixture(t, async r => {
    if (r.path.endsWith('/runs/active')) return { json: { run: controlRun() } };
    if (r.path.endsWith('/runs/run-original/events')) return { status: 410 };
    if (r.path.endsWith('/runs/run-original')) return failRunRead ? { status: 503, json: { message: 'Original Run read unavailable' } } : { json: { ...controlRun('run-original', 5, 'session-1', { kind: 'chat' }), error: { message: 'Original execution failed' } } };
    if (recovering && r.path.endsWith('/sessions/session-1')) {
      if (++historyReads === 1) { entered = true; await gate; return { status: 503, json: { message: 'Original history unavailable' } }; }
      return { json: { messages: [{ role: 'user', text: 'original prompt' }, { role: 'assistant', text: 'Original recovered reply' }] } };
    }
    return controlFixture(r);
  });
  await expect(page.locator('iframe')).toBeVisible();
  await page.locator('#composer').fill('Preserve next message');
  await api(page, "window.reconcileFrame=document.querySelector('iframe');");
  recovering = true;
  await api(page, "adapter.getWork('work-1').run={id:'run-original',sessionId:'session-1',status:'running',cursor:77,created:'',source:{kind:'chat'}};window.reconcileRecovery=adapter.resumeRun('work-1');");
  await expect.poll(() => entered).toBe(true);
  await api(page, "await adapter.loadActiveRun('work-1',true);");
  release(); await api(page, 'await window.reconcileRecovery;');
  await expect(page.locator('.message-execution').filter({has:page.locator('[data-run-id=run-original]')})).toContainText('History recovery failed');
  await expect(page.locator('.message-execution').filter({has:page.locator('[data-run-id=run-original]')})).toContainText('Original execution failed');
  await expect(page.locator('[data-action=run-details][data-run-id=run-original]')).toHaveAttribute('data-run-id', 'run-original');
  await expect(button(page, 'send-message')).toHaveAttribute('data-cancel-run-id', 'run-background');
  failRunRead = true; await api(page, "await adapter.resumeRun('work-1');");
  await expect(page.locator('.message-execution').filter({has:page.locator('[data-run-id=run-original]')})).toContainText('Original execution failed');
  await expect(page.locator('.message-execution').filter({has:page.locator('[data-run-id=run-original]')})).toContainText('History recovery failed');
  failRunRead = false;
  await api(page, "await adapter.resumeRun('work-1');");
  const facts = await api(page, "const w=adapter.getWork('work-1');return {run:w.run.id,status:w.run.status,error:w.run.error,replies:w.sessions[0].messages.filter(m=>m.text==='Original recovered reply').length,active:adapter.activeRuns.get('work-1').run.id,frame:window.reconcileFrame===document.querySelector('iframe')};");
  assert.deepEqual(facts, { run: 'run-original', status: 'failed', error: 'Original execution failed', replies: 1, active: 'run-background', frame: true });
  await expect(page.locator('.message-execution').filter({has:page.locator('[data-run-id=run-original]')})).toContainText('Original execution failed');
  await expect(page.locator('#composer')).toHaveValue('Preserve next message');
  assert.equal(requests.filter(r => r.path.endsWith('/runs/run-original/events')).length, 1);
  assert.equal(requests.filter(r => r.path.endsWith('/sessions/session-auto')).length, 0);
  assert.equal(chatWrites(requests).length, 0);
});

test('Reconcile configuration: delayed Save confirms only its captured draft and preserves later Advanced edits', async t => {
  let submitted: any, release!: () => void;
  const gate = new Promise<void>(done => release = done); t.after(() => release());
  const { page, requests } = await fixture(t, async r => {
    if (r.path.endsWith('/configuration') && r.method === 'PUT') {
      submitted = JSON.parse(r.body).configuration; await gate;
      return { json: { desired: submitted, active: submitted, pendingApply: false } };
    }
  });
  await button(page, 'settings').click(); await page.locator('[data-tab="Advanced"]').click();
  const original = { skills: [], packages: [], agentsMd: '', modelRef: 'preserved-extra', mcp: { servers: [] } };
  await page.locator('#advanced-editor').fill(JSON.stringify(original));
  await button(page, 'save-config').click(); await expect.poll(() => !!submitted).toBe(true);
  const later = { ...original, agentsMd: 'Later unsaved instructions', modelRef: 'later-extra' };
  await page.locator('#advanced-editor').fill(JSON.stringify(later)); release();
  await expect(page.locator('[data-action-status][aria-busy="true"]')).toHaveCount(0);
  assert.deepEqual(submitted, original);
  assert.deepEqual(JSON.parse(await page.locator('#advanced-editor').inputValue()), later);
  await expect(page.locator('.settings-page')).toContainText('Unsaved changes');
  assert.equal(requests.filter(r => r.path.endsWith('/configuration') && r.method === 'PUT').length, 1);
  assert.equal(requests.filter(r => r.path.endsWith('/configuration/apply')).length, 0);
});

test('Reconcile import: anonymous Inspect survives login, a name conflict and a lost acceptance without another upload', async t => {
  let imports = 0, transfer = '', phase = 'ready';
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'work-packages' && r.method === 'POST') {
      transfer = r.headers['x-piwork-transfer-id']!;
      return { json: { transferId: transfer, summary: { sourceName: 'Original archive', integrityVerified: true } } };
    }
    if (r.path.startsWith('work-packages/') && r.method === 'GET') return { json: { phase } };
    if (r.path === 'work-imports') {
      imports++;
      if (imports === 1) return { status: 409, json: { code: 'WORK_NAME_CONFLICT', field: 'name', message: 'Name occupied' } };
      phase = 'accepted'; return { abort: true };
    }
  }, true);
  await api(page, "await adapter.inspectWork(new File(['archive'],'original.work'));");
  assert.equal(requests.filter(r => r.path === 'work-imports').length, 0);
  await api(page, "await adapter.signIn('http://core.test','owner','pass');");
  await api(page, 'await adapter.checkConnection();');
  assert.equal(await api(page, 'return adapter.inspectionTransfer;'), transfer);
  assert.equal(await api(page, 'return adapter.inspection.sourceName;'), 'Original archive');
  await assert.rejects(api(page, "await adapter.importWork('Taken');"));
  assert.equal(await api(page, 'return adapter.inspectionContext.importState;'), 'unsubmitted');
  assert.equal(imports, 1);
  await assert.rejects(api(page, "await adapter.importWork('');"));
  assert.equal(await api(page, 'return adapter.inspectionContext.importState;'), 'accepted');
  await api(page, "await adapter.abandonInspection();try{await adapter.importWork('another');}catch{}try{await adapter.inspectWork(new File(['new'],'new.work'));}catch{}");
  const posts = requests.filter(r => r.path === 'work-imports').map(r => JSON.parse(r.body));
  assert.deepEqual(posts, [{ transferId: transfer, name: 'Taken' }, { transferId: transfer }]);
  assert.equal(requests.filter(r => r.path === 'work-packages' && r.method === 'POST').length, 1);
  assert.equal(requests.filter(r => r.method === 'DELETE').length, 0);
  assert.equal(await api(page, 'return adapter.inspectionTransfer;'), transfer);
});

test('B continuity preserves a mounted application and composer through Work 503, but not accepted Stop', async t => {
  let offline = false;
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works/work-1' && offline) return { status: 503, json: { code: 'UNAVAILABLE', message: 'Temporary Work read failure' } };
    if (r.path === 'works/work-1/stop') return { status: 202, json: { operationId: 'stop-original', workId: 'work-1' } };
    return focusFixture(r);
  });
  await expect(page.locator('iframe')).toBeVisible();
  await page.frameLocator('iframe').getByLabel('Application draft').fill('retained application input');
  await page.locator('#composer').fill('retained Chat draft');
  const original = await page.locator('iframe').elementHandle();
  const composer = await page.locator('#composer').elementHandle();
  const document = await page.frameLocator('iframe').locator('body').elementHandle();
  offline = true; await api(page, "await adapter.refreshWorkStatus('work-1').catch(() => undefined);");
  await expect(page.locator('.work-layout')).toBeVisible(); await expect(button(page, 'send-message')).toBeDisabled();
  assert.equal(await original!.evaluate(node => node.isConnected), true);
  assert.equal(await composer!.evaluate(node => node.isConnected), true);
  assert.equal(await document!.evaluate(node => node.isConnected), true);
  await expect(page.frameLocator('iframe').getByLabel('Application draft')).toHaveValue('retained application input');
  offline = false; await api(page, "await adapter.refreshWorkStatus('work-1');");
  assert.equal(await document!.evaluate(node => node.isConnected), true);
  await expect(page.locator('#composer')).toHaveValue('retained Chat draft');
  await button(page, 'work-menu').click(); await button(page, 'stop-work').click(); await button(page, 'confirm-stop').click();
  await expect(page.locator('iframe')).toHaveCount(0);
  assert.equal(requests.filter(r => r.path === 'works/work-1/stop').length, 1);
});

test('B selected Service Starting to Ready prepares exactly one entry without reselection', async t => {
  let observed = 'starting';
  const { page, requests } = await fixture(t, r => {
    if (r.path.endsWith('/services')) return { json: { services: [{ serviceId: 'service-a', name: 'Tool A', enabled: true, observedState: observed, access: { hostname: 'a.work.test', ports: [{ port: 80, url: 'http://a.work.test' }] } }] } };
    return focusFixture(r);
  });
  await button(page, 'tab-Services').click();
  assert.equal(requests.filter(r => r.path === 'service-entries' && r.method === 'POST').length, 0);
  observed = 'ready'; await api(page, "await adapter.loadServices('work-1');");
  await expect(page.locator('iframe')).toBeVisible();
  await expect(page.frameLocator('iframe').getByLabel('Application draft')).toBeVisible();
  for (let i = 0; i < 3; i++) await api(page, "await adapter.loadServices('work-1');");
  assert.equal(requests.filter(r => r.path === 'service-entries' && r.method === 'POST').length, 1);
});

const degradedWork = { json: { id: 'work-1', name: 'Recovery Work', desiredState: 'running', observedState: 'degraded' } };
const webPort = (hostname: string) => ({ hostname, ports: [{ port: 80, url: `http://${hostname}`, name: 'web' }] });
const noServiceControls = (requests: RequestRecord[]) => requests.filter(r => /\/(start|stop|restart|retry|remove)$/.test(r.path)).length;

test('Service feedback: a failed non-required Service is explicit while the Work and other Services stay usable', async t => {
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works/work-1') return degradedWork;
    if (r.path.endsWith('/services')) return { json: { services: [
      { serviceId: 'service-a', name: 'Tool A', enabled: true, observedState: 'ready', access: webPort('a.work.test') },
      { serviceId: 'service-b', name: 'Tool B', enabled: true, observedState: 'failed', access: webPort('b.work.test'),
        lastError: { code: 'SERVICE_START_FAILED', stage: 'service-start', message: 'The service could not start.', remediation: 'Correct the executable or runtime configuration and retry the service.', retryable: true, exitCode: 0, correlationId: 'corr-b' } },
    ] } };
    return focusFixture(r);
  });
  const notice = page.locator('.work-notice');
  await expect(notice).toContainText('Tool B failed');
  await expect(notice).not.toContainText('capabilities');
  await expect(notice.locator('[data-action="service-details"][data-id="service-b"]')).toHaveCount(1);
  // The ready Service keeps its normal entry and the Agent stays usable.
  await expect(page.locator('iframe')).toBeVisible();
  await expect(page.locator('#composer')).toBeEnabled();
  await notice.locator('[data-action="service-details"][data-id="service-b"]').click();
  await expect(page.locator('#modal-title')).toHaveText('Tool B');
  await expect(page.locator('#modal .service-explanation')).toContainText('Tool B failed to start');
  await expect(page.locator('#modal .service-explanation')).toContainText('The service could not start.');
  await page.locator('#modal .service-diagnostics > summary').click();
  const diagnostics = page.locator('#modal .service-diagnostics');
  for (const value of ['SERVICE_START_FAILED', 'service-start', 'Exit code', 'corr-b', 'Correct the executable', 'Retryable']) await expect(diagnostics).toContainText(value);
  await expect(diagnostics.locator('code', { hasText: '0' })).toHaveCount(1);
  await expect(page.locator('#modal [data-action="operation"]')).toHaveCount(0);
  await uiuxEvidence(page, 'service-failed-details');
  await button(page, 'close-modal').click();
  await page.locator('#service-select').click();
  await page.locator('[data-action="select-service"][data-id="service-b"]').click();
  await expect(page.locator('.empty')).toContainText('Tool B failed to start');
  await expect(page.locator('.empty')).toContainText('The service could not start.');
  await uiuxEvidence(page, 'service-failed-placeholder');
  assert.equal(noServiceControls(requests), 0);
  assert.equal(chatWrites(requests).length, 0);
});

test('Service feedback: a confirmed Starting Service reads as starting and never as a failure', async t => {
  let observed = 'starting';
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works/work-1') return observed === 'starting' ? degradedWork : undefined;
    if (r.path.endsWith('/services')) return { json: { services: [{ serviceId: 'service-a', name: 'Tool A', enabled: true, observedState: observed, access: webPort('a.work.test') }] } };
    return focusFixture(r);
  });
  const notice = page.locator('.work-notice');
  await expect(notice).toContainText('Tool A is starting');
  await expect(notice).not.toContainText('failed');
  await expect(notice).not.toContainText('capabilities');
  await button(page, 'tab-Services').click();
  await expect(page.locator('.startup-placeholder')).toContainText('Tool A is starting');
  await expect(page.locator('iframe')).toHaveCount(0);
  observed = 'ready'; await api(page, "await adapter.refreshVisibleWork('work-1');");
  await expect(page.locator('iframe')).toBeVisible();
  await expect(page.locator('.startup-placeholder')).toHaveCount(0);
  await expect(page.locator('.work-notice')).toHaveCount(0);
  assert.equal(noServiceControls(requests), 0);
});

test('Service feedback: recovery preserves its original cause until Ready', async t => {
  let observed = 'recovering';
  const { page } = await fixture(t, r => {
    if (r.path === 'works/work-1') return observed === 'recovering' ? degradedWork : undefined;
    if (r.path.endsWith('/services')) return { json: { services: [{ serviceId: 'service-a', name: 'Tool A', enabled: true, observedState: observed, access: webPort('a.work.test'), ...(observed === 'recovering' ? { lastError: { code: 'SERVICE_EXITED', stage: 'service-recovery', message: 'The service process exited.', remediation: 'Inspect service logs.', exitCode: 0, retryable: true } } : { lastError: null }) }] } };
    return focusFixture(r);
  });
  const notice = page.locator('.work-notice');
  await expect(notice).toContainText('Tool A is recovering');
  await expect(notice).toContainText('The service process exited.');
  await page.evaluate(async () => { const path = '/desktop/browser/locale.js'; const locale = await import(path); locale.chooseLocale('zh-CN'); });
  await expect(notice).toContainText('Tool A 正在恢复');
  await expect(notice).toContainText('The service process exited.');
  await page.evaluate(async () => { const path = '/desktop/browser/locale.js'; const locale = await import(path); locale.chooseLocale('en'); });
  await notice.locator('[data-action="service-details"]').click();
  await expect(page.locator('#modal .service-explanation')).toContainText('The service process exited.');
  await button(page, 'close-modal').click();
  observed = 'ready'; await api(page, "await adapter.refreshVisibleWork('work-1');");
  await expect(page.locator('.work-notice')).toHaveCount(0);
});

test('temporary cleanup remains visible when Service logs fail and refresh confirms completion', async t => {
  let state = 'pending';
  const cleanup = () => ({ workId:'work-1', serviceId:'service-probe', runId:'run-probe', createOperationId:'operation-create', operationId:'operation-cleanup', trigger:'run-cancelled', state, stage:state==='completed'?'release':'remove', ...(state==='pending'?{errorCode:'DOCKER_UNAVAILABLE'}:{}), logState:'unavailable', updatedAt:'2026-10-12T00:01:00Z', truncated:false, events:[{at:'2026-10-12T00:01:00Z',stage:state==='completed'?'release':'remove',outcome:state==='completed'?'succeeded':'unconfirmed'}] });
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works/work-1/services') return { json: { services:[
      { serviceId:'service-a',name:'Tool A',enabled:true,observedState:'ready',access:webPort('a.work.test') },
      { serviceId:'service-probe',name:'Probe',enabled:true,observedState:'failed',access:{hostname:'probe.work.test',ports:[]},temporary:{mode:'once',state:'completed',exitCode:7,cleanupState:state} },
    ] } };
    if (r.path === 'works/work-1/temporary-cleanups/service-probe') return { json:cleanup() };
    if (r.path === 'works/work-1/services/service-probe/logs') return { status:503,json:{message:'Log snapshot unavailable'} };
    return focusFixture(r);
  });
  await button(page,'service-menu').click(); await button(page,'manage-services').click();
  await page.locator('#modal [data-action="service-details"][data-id="service-probe"]').click();
  const modal=page.locator('#modal');
  await expect(modal).toContainText('Exit code'); await expect(modal).toContainText('7');
  await expect(modal).toContainText('Waiting to retry'); await expect(modal).toContainText('Docker is unavailable');
  await expect(modal).toContainText('Service output could not be archived');
  await page.evaluate(async () => { const path = '/desktop/browser/locale.js'; const locale = await import(path); locale.chooseLocale('zh-CN'); });
  await expect(modal).toContainText('等待重试');
  await expect(modal).toContainText('Docker 不可用');
  await page.evaluate(async () => { const path = '/desktop/browser/locale.js'; const locale = await import(path); locale.chooseLocale('en'); });
  await expect(modal.locator('[data-action="check-operation"][data-id="operation-cleanup"]')).toHaveCount(1);
  await expect(modal.locator('[data-control="retry"]')).toHaveCount(0);
  state='completed'; await button(page,'refresh-temporary-cleanups').click();
  await expect(modal).toContainText('Confirmed complete'); await expect(modal).not.toContainText('Docker is unavailable');
  assert.equal(noServiceControls(requests),0);
});

test('temporary cleanup is associated with the original Run and hides stale data when its read fails', async t => {
  let failed = false;
  const run = { ...controlRun('run-cleanup', 6, 'session-1', { kind: 'chat' }) };
  const cleanup = { workId:'work-1',serviceId:'service-probe',runId:'run-cleanup',createOperationId:'operation-create',operationId:'operation-cleanup',trigger:'run-cancelled',state:'pending',stage:'remove',errorCode:'TEMPORARY_CREATE_UNCONFIRMED',updatedAt:'2026-10-12T00:01:00Z',truncated:false,events:[{at:'2026-10-12T00:01:00Z',stage:'remove',outcome:'unconfirmed'}] };
  const { page } = await fixture(t,r=>{
    if(r.path==='works/work-1/sessions/session-1')return{json:{session:{workId:'work-1',sessionId:'session-1',modelPreference:null,source:{kind:'chat'}},messages:[{entryId:'user-cleanup',runId:'run-cleanup',role:'user',blocks:[{blockId:'user-cleanup',type:'text',text:'Original prompt'}]}],runs:[run]}};
    if(r.path==='works/work-1/runs/run-cleanup')return{json:run};
    if(r.path==='works/work-1/temporary-cleanups')return failed?{status:503,json:{message:'Cleanup read unavailable'}}:{json:{items:[cleanup],truncated:false}};
    return focusFixture(r);
  });
  await page.locator('.message-execution').filter({hasText:'cancelled'}).locator('[data-action="run-details"]').click();
  const modal=page.locator('#modal'); await expect(modal).toContainText('The original container creation has not been confirmed');
  failed=true; await button(page,'refresh-temporary-cleanups').click();
  await expect(modal).toContainText('Cleanup status is not confirmed');
  await expect(modal).not.toContainText('Waiting to retry');
});

test('late temporary cleanup response cannot repopulate a changed Core identity', async t => {
  const { page } = await fixture(t, async r => {
    if (r.path === 'works/work-1/temporary-cleanups') {
      await new Promise(done => setTimeout(done, 500));
      return { json:{items:[{workId:'work-1',serviceId:'service-old',runId:'run-old',createOperationId:'operation-old',state:'pending',stage:'remove',trigger:'run-cancelled',updatedAt:'2026-10-12T00:01:00Z',truncated:false,events:[]}],truncated:false} };
    }
    return focusFixture(r);
  });
  await api(page, "void adapter.loadTemporaryCleanups('work-1','run','run-old').catch(()=>undefined)");
  await api(page, "await adapter.switchCore('http://another.test')");
  await page.waitForTimeout(700);
  assert.equal(await api(page, "return adapter.temporaryCleanups.size"), 0);
});

test('Service feedback: multiple failures and a Web-less failure use the Service management direction', async t => {
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works/work-1') return degradedWork;
    if (r.path.endsWith('/services')) return { json: { services: [
      { serviceId: 'service-a', name: 'Tool A', enabled: true, observedState: 'ready', access: webPort('a.work.test') },
      { serviceId: 'service-b', name: 'Tool B', enabled: true, observedState: 'failed', access: webPort('b.work.test') },
      { serviceId: 'service-c', name: 'Tool C', enabled: true, observedState: 'failed', access: { hostname: 'c.work.test', ports: [] } },
    ] } };
    return focusFixture(r);
  });
  const notice = page.locator('.work-notice');
  await expect(notice).toContainText('2 Services failed');
  await expect(notice.locator('[data-action="manage-services"]')).toHaveCount(1);
  await notice.locator('[data-action="manage-services"]').click();
  await expect(page.locator('#modal-title')).toHaveText('Manage services');
  await page.locator('#modal [data-action="service-details"][data-id="service-c"]').click();
  await expect(page.locator('#modal-title')).toHaveText('Tool C');
  await expect(page.locator('#modal .service-explanation')).toContainText('Tool C failed');
  assert.equal(noServiceControls(requests), 0);
});

test('Service feedback: an interrupted Service catalog keeps the last confirmed facts, stops booting and recovers', async t => {
  let interrupted = false;
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works/work-1') return degradedWork;
    if (r.path.endsWith('/services')) {
      if (interrupted) return { status: 503, json: { code: 'UNAVAILABLE', message: 'Service listing unavailable' } };
      return { json: { services: [{ serviceId: 'service-a', name: 'Tool A', enabled: true, observedState: 'starting', access: webPort('a.work.test') }] } };
    }
    return focusFixture(r);
  });
  await button(page, 'tab-Services').click();
  await expect(page.locator('.startup-placeholder')).toHaveCount(1);
  interrupted = true; await api(page, "await adapter.loadServices('work-1').catch(() => undefined);");
  await expect(page.locator('.work-notice')).toHaveCount(0);
  await expect(page.locator('.service-workspace .feedback')).toContainText('Service listing unavailable');
  await expect(page.locator('.service-workspace .feedback [data-action="retry-services"]')).toHaveCount(1);
  await expect(page.locator('.startup-placeholder')).toHaveCount(0);
  await expect(page.locator('.empty')).toContainText('Tool A is starting');
  interrupted = false; await api(page, "await adapter.loadServices('work-1');");
  await expect(page.locator('.work-notice')).toContainText('Tool A is starting');
  await expect(page.locator('.startup-placeholder')).toHaveCount(1);
  assert.equal(noServiceControls(requests), 0);
});

const composerOutline = (page: Page) => page.locator('.composer').evaluate(node => { const style = getComputedStyle(node); return { style: style.outlineStyle, width: style.outlineWidth, offset: style.outlineOffset, color: style.outlineColor }; });
const composerOutlineClipped = (page: Page) => page.locator('.composer').evaluate(node => {
  const box = node.getBoundingClientRect(), style = getComputedStyle(node);
  const margin = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
  for (let ancestor: Element | null = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const overflow = getComputedStyle(ancestor);
    if (overflow.overflowX === 'visible' && overflow.overflowY === 'visible') continue;
    const clip = ancestor.getBoundingClientRect();
    return box.left - margin < clip.left || box.right + margin > clip.right || box.top - margin < clip.top || box.bottom + margin > clip.bottom;
  }
  return false;
});

test('Chat composer owns the input focus outline while toolbar controls keep their own focus', async t => {
  const label = 'DeepSeek Flash with a deliberately long model name for a narrow composer';
  const { page, requests } = await fixture(t, r => {
    if (r.path.endsWith('/chat-capabilities')) return { json: { contractVersion: 3 } };
    if (r.path.endsWith('/chat-models')) return { json: { ...chatModels(), defaultModel: { ...chatModel, label, thinkingLevels: ['off', 'low', 'high', 'max'] } } };
  });
  const accent = await page.evaluate(() => { const probe = document.createElement('span'); probe.style.color = 'var(--accent)'; document.body.appendChild(probe); const value = getComputedStyle(probe).color; probe.remove(); return value; });
  const check = async (name: string, width: number) => {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('#composer')).toBeVisible();
    await page.locator('#composer').click();
    assert.deepEqual(await composerOutline(page), { style: 'solid', width: '2px', offset: '2px', color: accent });
    assert.equal(await page.locator('#composer').evaluate(node => getComputedStyle(node).outlineStyle), 'none');
    assert.equal(await composerOutlineClipped(page), false);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.keyboard.press('Tab');
    await expect(page.locator('#response-settings-trigger')).toBeFocused();
    assert.equal((await composerOutline(page)).style, 'none');
    assert.equal(await page.locator('#response-settings-trigger').evaluate(node => getComputedStyle(node).outlineStyle), 'solid');
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#composer')).toBeFocused();
    assert.equal((await composerOutline(page)).style, 'solid');
    await uiuxEvidence(page, `composer-focus-${name}-${width}`);
    assert.equal(chatWrites(requests).length, 0);
    assert.equal(requests.filter(r => r.method !== 'GET' && r.path.includes('configuration')).length, 0);
  };
  await check('workspace', 1440);
  await check('workspace', 360);
  await button(page, 'tab-Chat').click();
  await check('chat', 1440);
  await check('chat', 360);
  await page.setViewportSize({ width: 1440, height: 900 });
  await button(page, 'focus-chat').click();
  await check('focus', 1440);
  await check('focus', 360);
});

test('Chat composer keeps a long model name and Stop and send reachable at 360px', async t => {
  const label = 'DeepSeek Flash with a deliberately long model name for a narrow composer';
  const { page, requests } = await fixture(t, r => {
    if (r.path.endsWith('/chat-capabilities')) return { json: { contractVersion: 3, cancelAndSendContractVersion: 1 } };
    if (r.path.endsWith('/chat-models')) return { json: { ...chatModels(), defaultModel: { ...chatModel, label, thinkingLevels: ['off', 'low', 'high', 'max'] } } };
    if (r.path.endsWith('/runs/active')) return { json: { run: controlRun('old-run', 2, 'session-1', { kind: 'chat' }) } };
    return controlFixture(r);
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await button(page, 'tab-Chat').click();
  await page.locator('#composer').fill('A valid replacement');
  await expect(page.getByRole('button', { name: 'Stop and send', exact: true })).toBeEnabled();
  const stopSend = page.getByRole('button', { name: 'Stop and send', exact: true });
  await expect(stopSend).toHaveAttribute('title', 'Stop and send');
  await expect(stopSend.locator('svg rect[fill="currentColor"]')).toHaveCount(1);
  const alignment = await stopSend.evaluate(node => { const b=node.getBoundingClientRect(), i=node.querySelector('svg')!.getBoundingClientRect();return {x:i.left+i.width/2-b.left-b.width/2,y:i.top+i.height/2-b.top-b.height/2}; });
  assert.ok(Math.abs(alignment.x)<1 && Math.abs(alignment.y)<1);
  await expect(page.locator('#response-settings-trigger')).toContainText(label);
  const boxes = await page.locator('#composer, #response-settings-trigger, [data-action="chat-input-options"], [data-action="send-message"]').evaluateAll(nodes => nodes.map(node => { const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, height: rect.height }; }));
  assert.equal(boxes.length, 4);
  for (const box of boxes) assert.ok(box.left >= 0 && box.right <= 360, `control must stay inside 360px: ${JSON.stringify(box)}`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('#composer').click();
  assert.equal((await composerOutline(page)).style, 'solid');
  assert.equal(await composerOutlineClipped(page), false);
  await uiuxEvidence(page, 'composer-stop-and-send-360');
  assert.equal(chatWrites(requests).length, 0);
});

test('Service startup placeholder fades only its four squares and ends on the first confirmed fact', async t => {
  let observed = 'starting', enabled = true, interrupted = false;
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works/work-1') return degradedWork;
    if (r.path.endsWith('/services')) {
      if (interrupted) return { status: 503, json: { message: 'Service listing unavailable' } };
      return { json: { services: [{ serviceId: 'service-a', name: 'Tool A', enabled, observedState: observed, access: webPort('a.work.test') }] } };
    }
    return focusFixture(r);
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await button(page, 'tab-Services').click();
  const placeholder = page.locator('.startup-placeholder'), main = page.locator('#workspace-main');
  await expect(placeholder).toHaveCount(1);
  await expect(placeholder).toHaveAttribute('role', 'status');
  await expect(placeholder).toHaveAttribute('aria-busy', 'true');
  await expect(placeholder.locator('.pending-dots')).toHaveCount(0);
  await expect(placeholder.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  const rects = placeholder.locator(':scope > svg > rect');
  await expect(rects).toHaveCount(4);
  const motion = () => rects.evaluateAll(nodes => nodes.map(node => { const style = getComputedStyle(node); return { name: style.animationName, duration: style.animationDuration, delay: style.animationDelay, opacity: Number(style.opacity) }; }));
  const running = await motion();
  for (const item of running) assert.deepEqual([item.name, item.duration], ['startup-square-fade', '1.2s']);
  assert.deepEqual(running.map(item => item.delay), ['0s', '0.2s', '0.6s', '0.4s']);
  const samples = [running.map(item => item.opacity)];
  for (let round = 0; round < 4; round++) { await page.waitForTimeout(140); samples.push((await motion()).map(item => item.opacity)); }
  assert.ok(samples.some(sample => sample.some((value, index) => value !== samples[0]![index])), 'the four squares must actually fade');
  assert.equal(await page.locator('.service-toolbar .status').evaluate(node => getComputedStyle(node).animationName), 'none');
  await uiuxEvidence(page, 'service-startup-placeholder');
  const geometry = await placeholder.locator(':scope > svg').boundingBox();
  assert.deepEqual([geometry?.width, geometry?.height], [32, 32]);
  const placeholderNode = await placeholder.elementHandle(), rectNode = await rects.first().elementHandle();
  await api(page, "await adapter.refreshVisibleWork('work-1');");
  await expect(placeholder).toHaveCount(1);
  assert.equal(await placeholderNode!.evaluate(node => node.isConnected), true);
  assert.equal(await rectNode!.evaluate(node => node.isConnected), true);
  assert.deepEqual(await placeholder.locator(':scope > svg').boundingBox(), geometry);
  // Every terminal or unconfirmed fact ends the booting placeholder immediately.
  for (const next of ['failed', 'stopped'] as const) {
    observed = next; await api(page, "await adapter.loadServices('work-1');");
    await expect(page.locator('.startup-placeholder')).toHaveCount(0);
    await expect(main.locator('.empty')).toContainText(next === 'failed' ? 'Tool A failed' : 'Tool A is stopped');
  }
  observed = 'starting'; enabled = false; await api(page, "await adapter.loadServices('work-1');");
  await expect(page.locator('.startup-placeholder')).toHaveCount(0);
  await expect(main.locator('.empty')).toContainText('Tool A is disabled');
  enabled = true; await api(page, "await adapter.loadServices('work-1');");
  await expect(page.locator('.startup-placeholder')).toHaveCount(1);
  interrupted = true; await api(page, "await adapter.loadServices('work-1').catch(() => undefined);");
  await expect(page.locator('.startup-placeholder')).toHaveCount(0);
  interrupted = false; await api(page, "await adapter.loadServices('work-1');");
  await expect(page.locator('.startup-placeholder')).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(async () => (await motion()).map(item => [item.name, item.opacity])).toEqual(Array.from({ length: 4 }, () => ['none', 0.7]));
  // A retained application keeps its document instead of the booting placeholder.
  observed = 'ready'; await api(page, "await adapter.refreshVisibleWork('work-1');");
  await expect(page.locator('.startup-placeholder')).toHaveCount(0);
  await expect(page.locator('iframe')).toBeVisible();
  observed = 'starting'; await api(page, "await adapter.refreshVisibleWork('work-1');");
  await expect(page.locator('iframe')).toBeVisible();
  await expect(page.locator('.startup-placeholder')).toHaveCount(0);
  assert.equal(noServiceControls(requests), 0);
});

test('Service details: explanation, safe diagnostics and bounded logs stay bound to the original Service', async t => {
  const hostile = '<img src=x onerror="window.__serviceLeak=1">';
  let release!: () => void; const gate = new Promise<void>(done => release = done); t.after(async () => release());
  const { page, requests } = await fixture(t, async r => {
    if (r.path === 'works/work-1') return degradedWork;
    if (r.path.endsWith('/services')) return { json: { services: [
      { serviceId: 'service-a', name: `Tool A ${hostile}`, enabled: true, observedState: 'failed', access: webPort('a.work.test'),
        lastError: { code: 'SERVICE_EXITED', stage: 'service-start', message: `Process exited ${hostile}`, remediation: `Correct it ${hostile}`, retryable: false, exitCode: 1, correlationId: 'corr-a' } },
      { serviceId: 'service-b', name: 'Tool B', enabled: true, observedState: 'ready', access: webPort('b.work.test') },
    ] } };
    if (r.path === 'works/work-1/services/service-a/logs') { await gate; return { json: { serviceId: 'service-a', status: 'available', text: `Late A log ${hostile}`, collectedAt: '2026-10-20T00:00:00Z', truncated: false } }; }
    if (r.path === 'works/work-1/services/service-b/logs') return { json: { serviceId: 'service-b', status: 'available', text: 'B bounded log', collectedAt: '2026-10-20T00:00:00Z', truncated: false } };
    return focusFixture(r);
  });
  await page.locator('.work-notice [data-action="service-details"][data-id="service-a"]').click();
  await expect(page.locator('#modal-title')).toHaveText(`Tool A ${hostile}`);
  await expect(page.locator('#modal .service-explanation')).toContainText(`Process exited ${hostile}`);
  const markup = await page.locator('#modal').evaluate(node => node.innerHTML);
  assert.ok(markup.includes('&lt;img src=x'), 'diagnostic text must be escaped'); assert.ok(!markup.includes('<img src=x'), 'diagnostic text must never become markup');
  await expect(page.locator('#modal .service-diagnostics dl')).toBeHidden();
  await page.locator('#modal .service-diagnostics > summary').click();
  await expect(page.locator('#modal .service-diagnostics')).toContainText(`Correct it ${hostile}`);
  await expect(page.locator('#modal .service-diagnostics code', { hasText: 'corr-a' })).toHaveCount(1);
  await expect(page.locator('#modal .service-diagnostics code', { hasText: '1' })).toHaveCount(1);
  await expect(page.locator('#modal [data-action="operation"]')).toHaveCount(0);
  await expect(page.locator('#modal [data-pending-action~="refresh-logs"]')).toHaveAttribute('title', /log snapshot/);
  assert.equal(await page.evaluate(() => (window as any).__serviceLeak), undefined);
  await button(page, 'close-modal').click();
  await button(page, 'service-menu').click(); await button(page, 'manage-services').click();
  await page.locator('#modal [data-action="service-details"][data-id="service-b"]').click();
  await expect(page.locator('#modal-title')).toHaveText('Tool B');
  await expect(page.locator('#modal .logs')).toContainText('B bounded log');
  release();
  await expect.poll(() => api(page, "return adapter.serviceLogs('work-1','service-a')?.value?.text;")).toContain('Late A log');
  await expect(page.locator('#modal-title')).toHaveText('Tool B');
  await expect(page.locator('#modal .logs')).toContainText('B bounded log');
  await expect(page.locator('#modal .logs')).not.toContainText('Late A log');
  assert.deepEqual([...new Set(requests.filter(r => r.path.endsWith('/logs')).map(r => r.path))].sort(), ['works/work-1/services/service-a/logs', 'works/work-1/services/service-b/logs']);
  assert.equal(noServiceControls(requests), 0);
  assert.equal(requests.filter(r => r.method === 'PATCH' || r.method === 'PUT' || r.path.endsWith('/configuration/apply')).length, 0);
});

test('B accepted New Work defaults reset only on the next explicit New Work', async t => {
  const { page, requests } = await fixture(t, r => r.path === 'works' && r.method === 'POST' ? { status: 202, json: { operationId: 'create-a', workId: 'new-a' } } : undefined);
  await button(page, 'back-works').click();
  await button(page, 'new-work').click(); await page.locator('#create-name').fill('A');
  await button(page, 'toggle-create-advanced').click(); await page.locator('#create-image').fill('synthetic/image');
  await page.locator('#create-agents').fill('only A'); await button(page, 'create-work').click();
  await expect(page.locator('#modal')).toContainText('create-a'); await button(page, 'close-modal').click();
  await button(page, 'new-work').click(); await expect(page.locator('#create-name')).toHaveValue('');
  await button(page, 'toggle-create-advanced').click(); await expect(page.locator('#create-image')).toHaveValue('');
  await expect(page.locator('#create-agents')).toHaveValue('');
  assert.equal(requests.filter(r => r.path === 'works' && r.method === 'POST').length, 1);
});

test('B Delete mixed 204 and real 207 retries only the explicitly selected failed path', async t => {
  let retry = false;
  const root = '/_desktop/files/works/work-1/files/';
  const xml = `<d:multistatus xmlns:d="DAV:">${['a.txt', 'b.txt'].map(name => `<d:response><d:href>${root}${name}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>1</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join('')}</d:multistatus>`;
  const { page, requests } = await fixture(t, r => {
    if (r.method === 'PROPFIND') return { status: 207, body: xml, headers: { 'Content-Type': 'application/xml' } };
    if (r.method === 'DELETE' && r.path === root + 'a.txt') return { status: 204 };
    if (r.method === 'DELETE' && r.path === root + 'b.txt') return retry ? { status: 204 } : { status: 207, headers: { 'Content-Type': 'application/xml' }, body: `<d:multistatus xmlns:d="DAV:" xmlns:p="urn:piwork:files"><d:response><d:href>${root}b.txt</d:href><d:status>HTTP/1.1 403 Forbidden</d:status><d:error><p:code>PERMISSION_DENIED</p:code></d:error><d:responsedescription>Cannot delete B</d:responsedescription></d:response></d:multistatus>` };
  });
  await button(page, 'tab-Files').click(); await page.locator('[data-file-select="/a.txt"]').check(); await page.locator('[data-file-select="/b.txt"]').check();
  await button(page, 'file-delete').click(); await button(page, 'confirm-file-delete').click();
  await expect(page.locator('#modal')).toContainText('PERMISSION_DENIED');await expect(page.locator('#modal')).toContainText('/b.txt'); await expect(page.locator('#modal')).toContainText('/b.txt');
  await expect(button(page, 'confirm-file-delete')).toBeDisabled();
  await expect(page.locator('[data-retry-source="/a.txt"]')).toHaveCount(0);
  // A can be recreated externally: the original successful DELETE still must not replay.
  retry = true; await page.locator('[data-retry-source="/b.txt"]').check(); await button(page, 'retry-selected-files').click();
  await expect(page.locator('#modal')).toHaveCount(0);
  assert.equal(requests.filter(r => r.method === 'DELETE' && r.path === root + 'a.txt').length, 1);
  assert.equal(requests.filter(r => r.method === 'DELETE' && r.path === root + 'b.txt').length, 2);
});

for (const fail of [false, true]) test(`B Service details appear while their isolated log read is still pending (${fail ? 'failure' : 'success'})`, async t => {
  let release!: () => void, releaseRetry!: () => void, reads = 0;
  const gate = new Promise<void>(done => release = done), retryGate = new Promise<void>(done => releaseRetry = done);
  t.after(async () => { release(); releaseRetry(); });
  const { page } = await fixture(t, async r => {
    if (r.path.endsWith('/services/service-a/logs')) { await (++reads === 1 ? gate : retryGate); return fail ? { status: 503, json: { message: 'Only logs unavailable' } } : { json: { serviceId:'service-a', status:'available', text:'Confirmed log', collectedAt:'2026-10-20T00:00:00Z', truncated:false } }; }
    return focusFixture(r);
  });
  await button(page, 'service-menu').click(); await button(page, 'manage-services').click(); await page.locator('[data-action="service-details"][data-id="service-a"]').click();
  await expect(page.locator('#modal')).toContainText('Tool A'); await expect(page.locator('#modal .service-controls')).toBeVisible();
  const reading = page.locator('#modal [data-pending-action~="refresh-logs"]');
  await expect(reading).toHaveAttribute('title', /Reading Tool A log snapshot/); await expect(reading).toHaveAttribute('aria-busy', 'true');
  await expect(reading.locator('.pending-dots')).toHaveCount(1);
  const slow = reading.locator('.action-slow-status');
  await expect(slow).toBeVisible({timeout: 12000});
  await expect(slow).toContainText('Reading Tool A log snapshot');
  await expect(slow).toContainText('Still waiting');
  release();
  await expect(page.locator('#modal')).toContainText(fail ? 'Only logs unavailable' : 'Confirmed log'); await expect(button(page, 'refresh-logs')).toBeEnabled();
  await expect(reading).toHaveCount(0); await expect(page.locator('#modal .service-controls')).toBeVisible();
  if (!fail) {
    await button(page, 'refresh-logs').click(); await expect(reading.locator('.pending-dots')).toHaveCount(1);
    await page.waitForTimeout(100); await expect(reading.locator('.action-slow-status')).toHaveCount(0);
    releaseRetry(); await expect(reading).toHaveCount(0);
  }
});

test('B a failed-only retry does not inherit another path unknown lock', async t => {
  const root = '/_desktop/files/works/work-1/files/'; let b = 0;
  const xml = `<d:multistatus xmlns:d="DAV:">${['a.txt', 'b.txt', 'c.txt'].map(name => `<d:response><d:href>${root}${name}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>1</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join('')}</d:multistatus>`;
  const { page, requests } = await fixture(t, r => {
    if (r.method === 'PROPFIND') return { status: 207, body: xml };
    if (r.method !== 'DELETE') return;
    if (r.path === root + 'a.txt') return { status: 204 };
    if (r.path === root + 'b.txt') return ++b < 3 ? { status: 403, body: 'Known B denial' } : { status: 204 };
    if (r.path === root + 'c.txt') return { status: 207, body: '<d:multistatus xmlns:d="DAV:"><incomplete' };
  });
  await button(page, 'tab-Files').click();
  for (const path of ['/a.txt', '/b.txt', '/c.txt']) await page.locator(`[data-file-select="${path}"]`).check();
  await button(page, 'file-delete').click(); await button(page, 'confirm-file-delete').click();
  await expect(page.locator('#modal')).toContainText('unknown');
  for (let retry = 0; retry < 2; retry++) {
    await page.locator('[data-retry-source="/b.txt"]').check();
    await expect(button(page, 'retry-selected-files')).toBeEnabled();
    await button(page, 'retry-selected-files').click();
    await expect.poll(() => b).toBe(retry + 2);
    if(retry===0)await expect(page.locator('[data-retry-source="/b.txt"]')).not.toBeChecked();
  }
  await expect(page.locator('#modal')).toContainText('2 paths confirmed; 1 need review');
  await expect(page.locator('#modal')).not.toContainText('1 paths confirmed; 2 need review');
  assert.equal(requests.filter(r => r.method === 'DELETE' && r.path === root + 'a.txt').length, 1);
  assert.equal(requests.filter(r => r.method === 'DELETE' && r.path === root + 'c.txt').length, 1);
});

test('B unsent Chat text participates in native beforeunload and cancelling keeps the draft', async t => {
  const { page, requests } = await fixture(t, () => undefined);
  await page.locator('#composer').click();
  await page.locator('#composer').fill('unsent text stays in this page');
  const dialog = page.waitForEvent('dialog'); const navigation = page.reload({ waitUntil: 'commit' }).catch(() => null);
  const confirmation = await dialog; assert.equal(confirmation.type(), 'beforeunload'); await confirmation.dismiss(); await navigation;
  await expect(page.locator('#composer')).toHaveValue('unsent text stays in this page');
  assert.equal(requests.filter(r => r.method === 'POST' && /\/(sessions|runs)$/.test(r.path)).length, 0);
});

test('B native beforeunload Settings positive control cancels without saving', async t => {
  const { page, requests } = await fixture(t, () => undefined);
  await button(page, 'settings').click();
  await page.locator('[data-tab="AGENTS.md"]').click();
  await page.locator('#agents-editor').click();
  await page.locator('#agents-editor').fill('unsaved Settings positive control');
  const dialog = page.waitForEvent('dialog', { timeout: 10000 });
  const navigation = page.reload({ waitUntil: 'commit' }).catch(() => null);
  const confirmation = await dialog; assert.equal(confirmation.type(), 'beforeunload');
  await confirmation.dismiss(); await navigation;
  await expect(page.locator('#agents-editor')).toHaveValue('unsaved Settings positive control');
  assert.equal(requests.filter(r => r.method === 'PUT' || r.method === 'POST').length, 0);
});

test('B independent app preserves an invalid requested port instead of opening default 3000', async t => {
  const { page, requests } = await fixture(t, r => r.path.endsWith('/services') ? { json: { services: [{ serviceId: 'service-a', name: 'Tool A', enabled: true, observedState: 'ready', access: { hostname: 'a.work.test', ports: [{ port: 3000, url: 'http://a.work.test' }] } }] } } : focusFixture(r));
  await expect(page.locator('iframe')).toBeVisible();
  const before = requests.filter(r => r.path === 'service-entries' && r.method === 'POST').length;
  for (const port of ['0', 'bogus', '65536']) {
    await page.goto(`${base}/#/app/work-1/service-a/${port}`);
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.getByText('The requested port is no longer declared', { exact: false })).toBeVisible();
  }
  assert.equal(requests.filter(r => r.path === 'service-entries' && r.method === 'POST').length, before);
});

test('B file chooser result cannot target a different directory than its original Upload click', async t => {
  const { page, requests } = await fixture(t, r => r.method === 'PROPFIND' ? { status: 207, body: `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/_desktop/files/works/work-1/files/dest/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>` } : undefined);
  await button(page, 'tab-Files').click();
  await button(page, 'file-add').click(); const chooser = page.waitForEvent('filechooser'); await button(page, 'upload').click(); const original = await chooser;
  await page.locator('[data-action="open-file"][data-path="/dest"]').click();
  await expect(page.locator('.breadcrumbs [data-path="/dest"]')).toBeVisible();
  const before = requests.filter(r => ['HEAD', 'PUT'].includes(r.method)).length;
  await original.setFiles({ name: 'chosen.txt', mimeType: 'text/plain', buffer: Buffer.from('chosen for root') });
  await expect(page.getByText('Upload not submitted:', { exact: false }).first()).toBeVisible();
  assert.equal(requests.filter(r => ['HEAD', 'PUT'].includes(r.method)).length, before);
});

for (const scenario of ['dirty-discard', 'read-error-retry']) test(`B brain source ${scenario} commits its own new file path before leaving Settings`, async t => {
  const source = '/.pi/packages/piwork-brain/brain.md', href = '/_desktop/files/works/work-1/files' + source;
  let fail = scenario === 'read-error-retry';
  const desired = { skills: [], packages: [{ name: 'piwork-brain', enabled: true }], agentsMd: 'original instructions' };
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works/work-1/configuration') return { json: { desired, active: desired, pendingApply: false } };
    if (r.path === 'works/work-1/packages') return { json: { packages: [{ name: 'piwork-brain' }] } };
    if (r.method === 'PROPFIND') return { status: 207, body: `<d:multistatus xmlns:d="DAV:"><d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>11</d:getcontentlength><d:getlastmodified>${mtime1}</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>` };
    if (r.method === 'GET' && r.path === href) return fail ? { status: 503, json: { message: 'Source temporarily unavailable' } } : { body: 'brain source', headers: { 'Last-Modified': mtime1 } };
  });
  await button(page, 'settings').click();
  if (scenario === 'dirty-discard') { await page.locator('[data-tab="AGENTS.md"]').click(); await page.locator('#agents-editor').fill('keep until I discard'); }
  await page.locator('[data-tab="Pi Packages"]').click(); await page.locator('[data-action="package-detail"][data-id="piwork-brain"]').click();
  await button(page, 'open-source').click();
  if (scenario === 'dirty-discard') {
    await expect(page.locator('#modal')).toContainText('Save configuration changes?'); await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(page.locator('#modal')).toContainText('Editable source:'); assert.equal(requests.filter(r => r.path === href && r.method === 'GET').length, 0);
    await button(page, 'open-source').click(); await button(page, 'dirty-config-discard').click();
  } else {
    await expect(page.locator('.file-target-toolbar')).toContainText('brain.md');
    await expect(page.locator('.main-panel')).toContainText('503'); fail = false;
    await page.locator('[data-action="retry-file-preview"]').click();
  }
  await expect(page.locator('#modal')).toHaveCount(0); await expect(page.locator('#file-editor')).toHaveValue('brain source');
  assert.equal(new URL(page.url()).hash, '#/work/work-1/files/%2F.pi%2Fpackages%2Fpiwork-brain%2Fbrain.md');
  assert.equal(requests.filter(r => r.method === 'PUT' || r.path.endsWith('/apply')).length, 0);
});

// C fixture remains native-shaped synthetic HTTP; browser events, geometry and bytes are asserted separately.
const cFileRoot = '/_desktop/files/works/work-1/files/';
function cFilesReply(r: RequestRecord): Reply | undefined {
  if (r.method === 'PROPFIND') return { status: 207, body: `<d:multistatus xmlns:d="DAV:">${['note.txt', 'archive.tar.gz', '.env'].map(name => `<d:response><d:href>${cFileRoot}${name}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>14</d:getcontentlength><d:getlastmodified>${mtime1}</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join('')}</d:multistatus>` };
  if (r.method === 'GET' && r.path.startsWith(cFileRoot)) return { body: 'saved version\n', headers: { 'Content-Type': 'text/plain', 'Last-Modified': mtime1 } };
}

test('C New folder focuses the field and local Enter submits only once while pending', async t => {
  let release!: () => void; const held = new Promise<void>(done => release = done); t.after(() => release());
  const { page, requests } = await fixture(t, async r => r.method === 'MKCOL' ? (await held, { status: 201 }) : cFilesReply(r));
  await button(page, 'tab-Files').click(); await button(page, 'file-add').click(); await button(page, 'new-folder').click();
  await expect(page.locator('#form-name')).toBeFocused(); await page.locator('#form-name').fill('中文 folder');
  const before = await button(page, 'confirm-folder').boundingBox();
  await page.locator('#form-name').press('Enter');
  await expect.poll(() => requests.filter(r => r.method === 'MKCOL').length).toBe(1);
  await expect(button(page, 'confirm-folder')).toBeDisabled(); await page.locator('#form-name').press('Enter');
  const pending = await button(page, 'confirm-folder').boundingBox(); assert.ok(before && pending); assert.ok(Math.abs(before.y - pending.y) <= 1);
  assert.equal(requests.filter(r => r.method === 'MKCOL').length, 1); release(); await expect(page.locator('#modal')).toHaveCount(0);
});

test('C Rename preselects the basename and composing Enter never submits', async t => {
  const { page, requests } = await fixture(t, cFilesReply);
  await button(page, 'tab-Files').click(); await page.getByRole('button', { name: 'Actions for archive.tar.gz', exact: true }).click();
  await button(page, 'file-rename').click(); const input = page.locator('#form-name');
  await expect(input).toHaveValue('archive.tar.gz'); await expect(input).toBeFocused();
  assert.deepEqual(await input.evaluate((element: HTMLInputElement) => [element.selectionStart, element.selectionEnd]), [0, 11]);
  // This is a synthetic event-guard regression, not proof of a particular OS IME.
  await input.dispatchEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true });
  assert.equal(requests.filter(r => r.method === 'MOVE').length, 0); await expect(page.locator('#modal')).toBeVisible();
});

test('C Files selection has an independent hit target and no first or last row jump', async t => {
  const { page } = await fixture(t, cFilesReply); await button(page, 'tab-Files').click();
  const checkbox = page.locator('[data-file-select="/note.txt"]'), row = checkbox.locator('xpath=../..'), label = checkbox.locator('..');
  const before = await row.boundingBox(), hit = await label.boundingBox(); assert.ok(before && hit); assert.ok(hit.width >= 32 && hit.height >= 32);
  await label.click({ position: { x: 1, y: 1 } }); await expect(checkbox).toBeChecked();
  const selected = await row.boundingBox(); assert.ok(selected); assert.ok(Math.abs(before.y - selected.y) <= 1);
  await checkbox.press('Space'); await expect(checkbox).not.toBeChecked();
  const cleared = await row.boundingBox(); assert.ok(cleared); assert.ok(Math.abs(before.y - cleared.y) <= 1);
});

test('C Download saved version returns server bytes without saving or changing editor selection', async t => {
  const { page, requests } = await fixture(t, cFilesReply); await button(page, 'tab-Files').click();
  await page.locator('[data-action="open-file"][data-path="/note.txt"]').click(); const editor = page.locator('#file-editor');
  await editor.fill('different unsaved draft'); await editor.press('Home'); await editor.press('ArrowRight');
  const selection = await editor.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd]);
  const before = requests.filter(r => r.method === 'GET' && r.path === cFileRoot + 'note.txt').length;
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download saved version', exact: true }).click();
  const downloaded = await pending, path = await downloaded.path(); assert.ok(path); assert.equal(await readFile(path, 'utf8'), 'saved version\n');
  await expect(editor).toHaveValue('different unsaved draft'); assert.deepEqual(await editor.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd]), selection);
  assert.equal(requests.filter(r => r.method === 'PUT').length, 0); assert.equal(requests.filter(r => r.method === 'GET' && r.path === cFileRoot + 'note.txt').length, before + 1);
});

for (const ending of ['success','failure','focus-moved'] as const) test(`Files slow refresh ${ending} preserves keyboard intent and rejects duplicate reads`,async t=>{
 let armed=false,release!:()=>void;const gate=new Promise<void>(done=>release=done);t.after(async()=>release());
 const {page,requests}=await fixture(t,async r=>{
  if(r.method==='PROPFIND' && armed){await gate;if(ending==='failure')return{status:503,json:{message:'Original directory temporarily unavailable'}};}
  return cFilesReply(r);
 });
 await page.setViewportSize({width:ending==='focus-moved'?1440:360,height:900});await button(page,'tab-Files').click();await expect(page.locator('[data-action=open-file][data-path="/note.txt"]')).toBeVisible();await page.clock.install();
 const refresh=page.locator('.file-refresh[data-action=refresh-files]'),before=requests.filter(r=>r.method==='PROPFIND').length;armed=true;await refresh.focus();await refresh.press('Enter');
 await expect(refresh).toHaveAttribute('aria-disabled','true');await expect(refresh).toBeFocused();await expect.poll(()=>requests.filter(r=>r.method==='PROPFIND').length).toBe(before+1);
 await refresh.press('Enter');await refresh.evaluate((node:HTMLButtonElement)=>node.click());await page.clock.runFor(10001);
 await expect(refresh).toHaveAttribute('aria-label','Still reading files…');await expect(refresh).toBeFocused();assert.equal(requests.filter(r=>r.method==='PROPFIND').length,before+1);
 if(ending==='focus-moved')await page.locator('#composer').focus();release();await expect(refresh).not.toHaveAttribute('aria-disabled','true');await expect(refresh).toBeEnabled();
 await expect(ending==='focus-moved'?page.locator('#composer'):refresh).toBeFocused();assert.equal(requests.filter(r=>r.method==='PROPFIND').length,before+1);
 if(ending==='failure')await expect(page.locator('.read-failure')).toContainText('Workspace cannot be read (503)');
 assert.equal(requests.filter(r=>['PUT','DELETE','MOVE','COPY','MKCOL'].includes(r.method)).length,0);
});

for(const gesture of ['double-click','enter-then-click'] as const)test(`C New folder ${gesture} submits exactly once while its first write is pending`,async t=>{
 let release!:()=>void;const gate=new Promise<void>(done=>release=done);t.after(async()=>release());
 const {page,requests}=await fixture(t,async r=>r.method==='MKCOL'?(await gate,{status:201}):cFilesReply(r));
 await button(page,'tab-Files').click();await button(page,'file-add').click();await button(page,'new-folder').click();await page.locator('#form-name').fill('single-request');
 const create=button(page,'confirm-folder'),box=await create.boundingBox();assert.ok(box);
 if(gesture==='double-click')await create.dblclick();else{await page.locator('#form-name').press('Enter');await page.mouse.click(box.x+box.width/2,box.y+box.height/2);}
 await expect.poll(()=>requests.filter(r=>r.method==='MKCOL').length).toBe(1);await expect(create).toBeDisabled();release();await expect(page.locator('#modal')).toHaveCount(0);assert.equal(requests.filter(r=>r.method==='MKCOL').length,1);
});
test('C dangerous Work deletion never treats generic Enter as confirmation',async t=>{
 const {page,requests}=await fixture(t,()=>undefined);await button(page,'work-menu').click();await button(page,'delete-work').click();
 await page.locator('#delete-confirm').check();await expect(button(page,'confirm-delete')).toBeEnabled();await page.locator('#delete-confirm').press('Enter');
 await expect(page.locator('#modal')).toBeVisible();await expect(page.locator('#delete-confirm')).toBeChecked();assert.equal(requests.filter(r=>r.method==='DELETE').length,0);
});

test('Focused Chat stays visible during the narrow breakpoint before resize reconciliation',async t=>{
 const page=await browser.newPage({viewport:{width:1440,height:900}});t.after(()=>page.close());
 // The confirmed layout exists before the resize listener can add narrow-chat.
 // Use the real stylesheet without the app listener to observe that exact interval.
 await page.setContent('<main class="service-focused" data-layout="service-chat"><div class="work-layout service-workspace"><section class="main-panel"></section><aside class="agent-side"><button id="focus-return">Focus chat</button></aside></div></main>');
 await page.addStyleTag({url:base+'/style.css'});
 const anchor=page.locator('#focus-return');await anchor.focus();await expect(anchor).toBeFocused();
 await page.setViewportSize({width:360,height:900});
 await expect(page.locator('.agent-side')).toHaveCSS('display','block');await expect(anchor).toBeFocused();
 await expect(page.locator('.work-layout')).not.toHaveClass(/narrow-chat/);
 await page.locator('main').evaluate(node=>node.dataset.layout='service-only');
 await expect(page.locator('.agent-side')).toHaveCSS('display','none');
});

test('Chat reload keeps a cancelled older turn before successful numeric messages',async t=>{
 const segment=(runId:string,order:number,text:string)=>({entryId:`${runId}-user`,entryOrder:order,role:'user',runId,blockId:`${runId}-user-0`,blockIndex:0,blockCount:1,type:'text',text,byteOffset:0,totalBytes:new TextEncoder().encode(text).length,complete:true});
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/history-capabilities'))return{json:{contractVersion:1,profile:'session-history-v1',pageBytes:524288}};
  if(r.path.endsWith('/history'))return{json:{contractVersion:1,session:{workId:'work-1',sessionId:'session-1',modelPreference:null,thinkingLevel:'off',source:{kind:'chat'}},snapshotId:'snapshot-new',segments:[segment('one',10,'1'),segment('four',11,'4')],runs:[controlRun('one',4,'session-1',{kind:'chat'}),controlRun('four',4,'session-1',{kind:'chat'})],nextCursor:null,hasMore:false}};
  return controlFixture(r);
 });
 await button(page,'tab-Chat').click();
 await api(page,`const w=adapter.getWork('work-1'),session=w.sessions.find(s=>s.id==='session-1');
  session.runs.push({id:'old',sessionId:session.id,status:'cancelled',cursor:0,created:''});
  session.messages=[{id:'old-user',runId:'old',role:'user',text:'Earlier request'},
   {id:'old-tool',runId:'old',role:'assistant',text:'',tool:{id:'old-tool',name:'read',status:'Completed',content:'Old result'}},
   {id:'one-user',runId:'one',role:'user',text:'1'},{id:'four-user',runId:'four',role:'user',text:'4'}];
  await adapter.loadEarlierHistory(w.id,session.id,true);`);
 const order=await page.locator('#messages .message.user .message-text').allTextContents();
 assert.deepEqual(order,['Earlier request','1','4']);
 const cancelled=page.locator('.message-execution').filter({hasText:'Run cancelled'});
 await expect(cancelled).toHaveCount(1);
 assert.equal(await cancelled.evaluate(el=>!!(el.compareDocumentPosition(document.querySelectorAll('#messages .message.user')[1]!)&Node.DOCUMENT_POSITION_FOLLOWING)),true);
 assert.equal(chatWrites(requests).length,0);
});

test('History pages: recent-only opening, earlier anchor, draft and partial Markdown remain safe',async t=>{
  let pages=0;
  const segment=(id:string,order:number,text:string,offset=0,total=new TextEncoder().encode(text).length)=>({entryId:id,entryOrder:order,role:'assistant',runId:'',blockId:`${id}-0`,blockIndex:0,blockCount:1,type:'text',text,byteOffset:offset,totalBytes:total,complete:offset+new TextEncoder().encode(text).length===total});
  const history=(segments:any[],cursor:string|null)=>({contractVersion:1,session:{workId:'work-1',sessionId:'session-1',modelPreference:null,thinkingLevel:'off',source:{kind:'chat'}},snapshotId:'snapshot',segments,runs:[],nextCursor:cursor,hasMore:!!cursor});
  const {page,requests}=await fixture(t,r=>{
    if(r.path.endsWith('/history-capabilities'))return{json:{contractVersion:1,profile:'session-history-v1',pageBytes:524288}};
    if(r.path.endsWith('/history')){pages++;return{json:r.search.includes('cursor=')?history([segment('older',0,'Earlier saved message')],null):history([segment('partial',1,'[unfinished](https://example.test)',3,37),...Array.from({length:30},(_,i)=>segment(`recent-${i}`,i+2,`Recent ${i}\n\n`+'Saved line. '.repeat(20)))],'older')};}
    return undefined;
  });
  await expect(page.locator('[data-action=load-earlier-history]')).toHaveCount(1);
  assert.ok(pages>=1);assert.equal(requests.some(r=>r.path.endsWith('/history')&&r.search.includes('cursor=')),false);assert.equal(requests.some(r=>r.path.endsWith('/sessions/session-1')),false);const initialPages=pages;
  await page.locator('#composer').fill('Keep this draft');
  await page.locator('#messages').evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
  await expect(page.locator('#messages a[href="https://example.test"]')).toHaveCount(0);
  await expect(page.locator('.message-history-status').first()).toBeVisible();
  const anchor=page.locator('[data-message-key]').filter({hasText:'Recent 0'}).first();
  const before=(await anchor.boundingBox())!.y;
  await page.locator('[data-action=load-earlier-history]').click();
  await expect(page.locator('#messages')).toContainText('Earlier saved message');
  await expect(page.locator('#composer')).toHaveValue('Keep this draft');
  const after=(await anchor.boundingBox())!.y;assert.ok(Math.abs(after-before)<5,`reading anchor moved ${after-before}`);
  assert.equal(pages,initialPages+1);
});

test('History compatibility: old Agent explains update and Apply while preserving messages and draft',async t=>{
 let fail=false,reads=0;
 const {page}=await fixture(t,r=>{
  if(r.path.endsWith('/history-capabilities'))return{status:501,json:{code:'HISTORY_UNSUPPORTED'}};
  if(r.path.endsWith('/sessions/session-1')){
   reads++;return fail?{status:502,json:{code:'RESPONSE_TOO_LARGE',message:'Legacy history is too large'}}:{json:{session:{workId:'work-1',sessionId:'session-1',modelPreference:null,source:{kind:'chat'}},messages:[{entryId:'known',role:'assistant',text:'Known saved answer'}],runs:[]}};
  }
  return undefined;
 });
 await expect(page.locator('#messages')).toContainText('Known saved answer');
 // DWUI-HISTORY-RECOVERY-001: no permanent capability banner while Chat works.
 await expect(page.locator('.agent-panel')).not.toContainText('Legacy history reads have size limits');
 await page.locator('#composer').fill('Keep my draft');
 const before=reads;fail=true;
 await api(page,`try { await adapter.loadSession('work-1','session-1'); } catch {}`);
 await expect(page.locator('.agent-panel')).toContainText('Conversation could not be read');
 // The real failure explains the limit at the operation that would read more.
 await expect(page.locator('.read-failure')).toContainText('Legacy history reads have size limits');
 await expect(page.locator('.read-failure')).toContainText('explicitly Apply');
 await expect(page.locator('#messages')).toContainText('Known saved answer');
 await expect(page.locator('#composer')).toHaveValue('Keep my draft');
 assert.equal(reads,before+1);
});

test('History compatibility: event precheck capacity failure stops reconnecting and keeps the original Run',async t=>{
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/history-capabilities'))return{status:501,json:{code:'HISTORY_UNSUPPORTED'}};
  if(r.path.endsWith('/sessions/session-1'))return{json:{session:{workId:'work-1',sessionId:'session-1',modelPreference:null,source:{kind:'chat'}},messages:[{role:'assistant',text:'Known saved answer'}],runs:[]}};
  if(r.path.endsWith('/events'))return{status:503,json:{code:'RESPONSE_TOO_LARGE',message:'Legacy history limit'}};
  return undefined;
 });
 await expect(page.locator('#messages')).toContainText('Known saved answer');
 await page.locator('#composer').fill('Keep my draft');await page.clock.install();
 await api(page,`const w=adapter.getWork('work-1');w.run={id:'original-run',sessionId:'session-1',status:'running',cursor:7,created:''};return adapter.resumeRun('work-1');`);
 await page.clock.runFor(7000);
 assert.equal(requests.filter(r=>r.path.endsWith('/events')).length,1);
 assert.equal(requests.filter(r=>r.method==='POST').length,0);
 const run=await api(page,`return adapter.getWork('work-1').run;`);
 assert.equal(run.id,'original-run');assert.equal(run.status,'running');assert.equal(run.cursor,7);
 assert.match(run.error,/Legacy history limit/);assert.match(run.error,/explicitly Apply/);
 await expect(page.locator('#messages')).toContainText('Known saved answer');
 await expect(page.locator('#composer')).toHaveValue('Keep my draft');
});

test('History pages: mixed final result readback preserves complete Markdown and one tool',async t=>{
 const runId='mixed-run',entryId='mixed-final';
 const part=(index:number,text:string,type='text')=>({entryId,entryOrder:0,role:'assistant',runId,blockId:`${entryId}-${index}`,blockIndex:index,blockCount:3,type,text,byteOffset:0,totalBytes:new TextEncoder().encode(text).length,complete:true});
 const first=part(0,'**Before**'),tool={...part(1,'','tool-call'),toolCallId:'call-1',toolName:'read'},last=part(2,'**After**');
 const ref={workId:'work-1',sessionId:'session-1',runId,content:'result',entryId};
 const summary={workId:'work-1',sessionId:'session-1',runId,state:6,resultRef:ref};
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/history-capabilities'))return{json:{contractVersion:1,profile:'session-history-v1',pageBytes:524288}};
  if(r.path.endsWith('/history'))return{json:{contractVersion:1,session:{workId:'work-1',sessionId:'session-1',modelPreference:null,thinkingLevel:'off',source:{kind:'chat'}},snapshotId:'snapshot',segments:r.search.includes('content=result')?[first,last]:[first,tool,last],runs:[summary],nextCursor:null,hasMore:false}};
  return undefined;
 });
 await expect(page.locator('.message-text strong')).toHaveCount(2);
 await page.locator('#composer').fill('Keep my draft');
 await api(page,`return adapter.loadSavedRun('work-1',{id:'mixed-run',sessionId:'session-1',status:'cancelled',cursor:0,created:'',resultRef:${JSON.stringify(ref)}});`);
 await expect(page.locator('.history-partial')).toHaveCount(0);
 await expect(page.locator('.message-text strong')).toHaveCount(2);
 await expect(page.locator('.tool-event')).toHaveCount(1);
 await expect(page.locator('#composer')).toHaveValue('Keep my draft');
 assert.ok(requests.some(r=>r.path.endsWith('/history')&&r.search.includes('content=result')));
 assert.equal(requests.filter(r=>r.method==='POST').length,0);
 assert.equal(requests.some(r=>r.path.endsWith('/sessions/session-1')),false);
});

test('History pages: tool-only cancelled Run recovers its complete empty result without a blank reply',async t=>{
 const runId='original-run',entryId='sdk-tool',resultId=`${runId}-final`;
 const basePart={entryOrder:0,role:'assistant',runId,blockIndex:0,blockCount:1,text:'',byteOffset:0,totalBytes:0,complete:true};
 const tool={...basePart,entryId,blockId:`${entryId}-0`,type:'tool-call',toolCallId:'call-1',toolName:'read'};
 const result={...basePart,entryId:resultId,entryOrder:1,blockId:`${resultId}-0`,type:'run-result'};
 const ref={workId:'work-1',sessionId:'session-1',runId,content:'result',entryId:resultId};
 const summary={workId:'work-1',sessionId:'session-1',runId,state:6,resultRef:ref};
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/history-capabilities'))return{json:{contractVersion:1,profile:'session-history-v1',pageBytes:524288}};
  if(r.path.endsWith('/history'))return{json:{contractVersion:1,session:{workId:'work-1',sessionId:'session-1',modelPreference:null,thinkingLevel:'off',source:{kind:'chat'}},snapshotId:'snapshot',segments:r.search.includes('content=result')?[result]:[tool,result],runs:[summary],nextCursor:null,hasMore:false}};
  if(r.path.endsWith('/events'))return{status:410,json:{code:'CURSOR_EXPIRED'}};
  if(r.path.endsWith('/runs/original-run'))return{json:summary};
  return undefined;
 });
 await expect(page.locator('.tool-event')).toHaveCount(1);await page.locator('#composer').fill('Keep my draft');
 await page.clock.install();await beginExpiredRun(page);await page.clock.runFor(7000);
 const run=await api(page,`return adapter.getWork('work-1').run;`);
 assert.equal(run.status,'cancelled');assert.equal(run.error,undefined);
 assert.equal(await api(page,`return adapter.readRunResult('work-1',adapter.getWork('work-1').run);`),'');
 await expect(page.locator('.history-partial')).toHaveCount(0);
 await expect(page.locator('.tool-event')).toHaveCount(1);await expect(page.locator('.message.assistant')).toHaveCount(0);
 await expect(page.locator('#composer')).toHaveValue('Keep my draft');
 assert.equal(requests.filter(r=>r.path.endsWith('/events')).length,1);
 assert.equal(requests.some(r=>r.path.endsWith('/sessions/session-1')),false);
 assert.equal(requests.filter(r=>r.method==='POST').length,0);
});

test('Import dialog: verified facts replace the raw inspection JSON and focus the name once', async t => {
  const { page } = await fixture(t, r => {
    if (r.path === 'work-packages' && r.method === 'POST') return { json: { transferId: r.headers['x-piwork-transfer-id'], summary: { sourceName: '笔记项目', size: 1048576, counts: { entries: 12, packages: 1 }, bindingRequirements: { models: [{ provider: 'fixture', model: 'one' }], secrets: [{ key: 'token' }] }, integrityVerified: true } } };
    if (r.path === 'work-packages/transfer-ready' && r.method === 'GET') return { json: { transferId: 'transfer-ready', phase: 'ready', transferred: 1048576, total: 1048576 } };
    if (r.path === 'work-imports' && r.method === 'POST') return { status: 202, json: { operationId: 'operation-focus', workId: 'work-import' } };
  });
  await page.setViewportSize({ width: 360, height: 900 });
  await button(page, 'back-works').click(); await button(page, 'import').click();
  await page.locator('#work-file-input').setInputFiles({ name: 'sample.work', mimeType: 'application/vnd.piwork.work-package', buffer: Buffer.from('package') });
  await expect(page.locator('.import-result')).toContainText('笔记项目');
  // Readable facts only: no raw object, no foldable JSON and no original-task finder.
  await expect(page.locator('#modal pre')).toHaveCount(0);
  await expect(page.locator('#modal details')).toHaveCount(0);
  await expect(page.locator('#modal')).not.toContainText('"integrityVerified"');
  await expect(page.locator('#modal')).not.toContainText('Check original import');
  await expect(page.locator('#modal')).not.toContainText('Find an original Import task');
  await expect(page.locator('.import-facts')).toContainText('1 MB');
  await expect(page.locator('.import-facts')).toContainText('Model bindings');
  await expect(page.locator('.import-facts')).toContainText('External credentials');
  // The name field appears with the verified result and takes focus once.
  await expect(page.locator('#import-name')).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Import Work' })).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#import-name').fill('自定义');
  // A later state update keeps the input, the caret and the user's own focus.
  const cancel = page.locator('#modal [data-action="close-modal"]').last();
  await cancel.focus();
  await api(page, `adapter.inspection={sourceName:'笔记项目',size:1048576,counts:{entries:12,packages:1}};adapter['emit']();`);
  await expect(page.locator('#import-name')).toHaveValue('自定义');
  await expect(cancel).toBeFocused();
  // Submitting is explicit and happens once for this transfer.
  await button(page, 'confirm-import').click();
  await expect(page.locator('#modal .import-name-feedback')).toBeVisible();
  await expect(page.locator('[data-action="confirm-import"]')).toHaveCount(0);
});

test('Import dialog: pending handoff and the original operation remain in the same dialog', async t => {
  let release!: () => void;
  const gate = new Promise<void>(done => release = done); t.after(async () => release());
  let succeeded = false;
  const { page, requests } = await fixture(t, async r => {
    if (r.path === 'work-packages' && r.method === 'POST') return { json: { transferId: r.headers['x-piwork-transfer-id'], summary: { sourceName: 'example' } } };
    if (r.path.startsWith('work-packages/') && r.method === 'GET') return { json: { phase: 'uploading', transferred: 1000, total: 1000 } };
    if (r.path === 'work-imports' && r.method === 'POST') { await gate; return { status: 202, json: { operationId: 'original-import', workId: 'imported', name: 'Chosen' } }; }
    if (r.path === 'operations/original-import') return { json: { operationId: 'original-import', workId: 'imported', kind: 'import-work', state: succeeded ? 'succeeded' : 'running' } };
    if (r.path === 'works/imported') return { json: { id: 'imported', name: 'Chosen', desiredState: 'stopped', observedState: 'stopped' } };
  });
  await button(page, 'back-works').click(); await button(page, 'import').click();
  await page.locator('#work-file-input').setInputFiles({ name: 'sample.work', mimeType: 'application/vnd.piwork.work-package', buffer: Buffer.from('package') });
  await page.locator('#import-name').fill('Chosen');
  await button(page, 'confirm-import').click();
  await expect(page.locator('#modal')).toContainText('Sending the package to Core');
  await expect(page.locator('#modal progress')).toHaveCount(0);
  await expect(page.locator('#modal')).not.toContainText('Imported as');
  release();
  await expect(page.locator('.import-name-feedback')).toContainText('Chosen');
  await expect(page.locator('#modal')).not.toContainText('Operation ID');
  succeeded = true; await button(page, 'check-operation').click();
  await expect(page.locator('#modal')).toContainText('Imported as');
  assert.equal(requests.filter(r => r.path === 'work-imports' && r.method === 'POST').length, 1);
});

test('Import dialog: user focus during inspection is not taken on completion or later refresh', async t => {
  let release!: () => void;
  const gate = new Promise<void>(done => release = done); t.after(async () => release());
  const { page } = await fixture(t, async r => {
    if (r.path === 'work-packages' && r.method === 'POST') { await gate; return { json: { transferId: r.headers['x-piwork-transfer-id'], summary: { sourceName: 'example' } } }; }
  });
  await button(page, 'back-works').click(); await button(page, 'import').click();
  await page.locator('#work-file-input').setInputFiles({ name: 'sample.work', mimeType: 'application/vnd.piwork.work-package', buffer: Buffer.from('package') });
  await page.keyboard.press('Tab');
  const close = page.locator('#modal [data-action="close-modal"]').first(); await close.focus();
  release(); await expect(page.locator('#import-name')).toBeVisible(); await expect(close).toBeFocused();
  await api(page, "adapter['emit']();"); await expect(close).toBeFocused();
});

test('Import dialog: a completed import does not prevent a later new package', async t => {
  let submissions = 0;
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'work-packages' && r.method === 'POST') return { json: { transferId: r.headers['x-piwork-transfer-id'], summary: { sourceName: 'package' } } };
    if (r.path === 'work-imports' && r.method === 'POST') return { status: 202, json: { operationId: `import-${++submissions}`, workId: 'imported', name: 'Chosen' } };
    if (r.path === 'operations/import-1') return { json: { operationId: 'import-1', workId: 'imported', kind: 'import-work', state: 'succeeded' } };
    if (r.path === 'works/imported') return { json: { id: 'imported', name: 'Chosen', desiredState: 'stopped', observedState: 'stopped' } };
  });
  await button(page, 'back-works').click(); await button(page, 'import').click();
  await page.locator('#work-file-input').setInputFiles({ name: 'first.work', mimeType: 'application/vnd.piwork.work-package', buffer: Buffer.from('first') });
  await page.locator('#import-name').fill('Chosen'); await button(page, 'confirm-import').click(); await button(page, 'check-operation').click();
  await expect(page.locator('#modal')).toContainText('Imported as');
  await button(page, 'close-modal').click(); await button(page, 'import').click();
  await expect(button(page, 'choose-work-file')).toBeEnabled(); await expect(page.locator('#import-name')).toHaveCount(0);
  await page.locator('#work-file-input').setInputFiles({ name: 'second.work', mimeType: 'application/vnd.piwork.work-package', buffer: Buffer.from('second') });
  await expect(page.locator('#import-name')).toHaveValue('');
  assert.equal(await api(page, "return adapter.getOperation('import-1')?.state;"), 'succeeded');
  assert.equal(requests.filter(r => r.path === 'work-imports' && r.method === 'POST').length, 1);
  assert.equal(requests.filter(r => r.path.startsWith('work-packages/') && r.method === 'DELETE').length, 0);
});

test('Import dialog: closing stops original observation and reopening resumes without resubmission', async t => {
  let release!: () => void;
  const gate = new Promise<void>(done => release = done); t.after(async () => release());
  const { page, requests } = await fixture(t, async r => {
    if (r.path === 'work-packages' && r.method === 'POST') return { json: { transferId: r.headers['x-piwork-transfer-id'], summary: { sourceName: 'example' } } };
    if (r.path.startsWith('work-packages/') && r.method === 'GET') return { json: { phase: 'uploading' } };
    if (r.path === 'work-imports' && r.method === 'POST') { await gate; return { status: 202, json: { operationId: 'import-paused', workId: 'imported', name: 'Chosen' } }; }
    if (r.path === 'operations/import-paused') return { json: { operationId: 'import-paused', workId: 'imported', kind: 'import-work', state: 'running' } };
  });
  await button(page, 'back-works').click(); await button(page, 'import').click();
  await page.locator('#work-file-input').setInputFiles({ name: 'sample.work', mimeType: 'application/vnd.piwork.work-package', buffer: Buffer.from('package') });
  await page.locator('#import-name').fill('Chosen'); await button(page, 'confirm-import').click();
  await expect(page.locator('#modal')).toContainText('Sending the package to Core');
  await button(page, 'close-modal').click();
  const transferReads = requests.filter(r => r.path.startsWith('work-packages/') && r.method === 'GET').length;
  await page.waitForTimeout(1200);
  assert.equal(requests.filter(r => r.path.startsWith('work-packages/') && r.method === 'GET').length, transferReads);
  release(); await expect.poll(() => api(page, "return adapter.inspectionContext?.operationId;")).toBe('import-paused');
  await page.waitForTimeout(2500);
  assert.equal(requests.filter(r => r.path === 'operations/import-paused').length, 0);
  await button(page, 'import').click();
  await expect.poll(() => requests.filter(r => r.path === 'operations/import-paused').length, { timeout: 8000 }).toBeGreaterThan(0);
  // The task's recovery hint observes the same identity and must
  // pause again when its own operation dialog is closed.
  await button(page, 'close-modal').click();
  await button(page, 'works-tasks').click();
  await page.locator('.recovery-task[data-operation-id="import-paused"] [data-action="operation"]').click();
  const beforeClose = requests.filter(r => r.path === 'operations/import-paused').length;
  await expect.poll(() => requests.filter(r => r.path === 'operations/import-paused').length, { timeout: 8000 }).toBeGreaterThan(beforeClose);
  await button(page, 'close-modal').click();
  const afterClose = requests.filter(r => r.path === 'operations/import-paused').length;
  await page.waitForTimeout(2500);
  assert.equal(requests.filter(r => r.path === 'operations/import-paused').length, afterClose);
  await button(page, 'works-tasks').click();
  await page.locator('.recovery-task[data-operation-id="import-paused"] [data-action="operation"]').click();
  await expect.poll(() => requests.filter(r => r.path === 'operations/import-paused').length, { timeout: 8000 }).toBeGreaterThan(afterClose);
  assert.equal(requests.filter(r => r.path === 'work-imports' && r.method === 'POST').length, 1);
  assert.equal(requests.filter(r => r.path.startsWith('work-packages/') && r.method === 'DELETE').length, 0);
});

test('Import dialog: a confirmed name conflict clears the pending handoff stage', async t => {
  let release!: () => void;
  const gate = new Promise<void>(done => release = done); t.after(async () => release());
  let pending = false;
  const { page } = await fixture(t, async r => {
    if (r.path === 'work-packages' && r.method === 'POST') return { json: { transferId: r.headers['x-piwork-transfer-id'], summary: { sourceName: 'example' } } };
    if (r.path.startsWith('work-packages/') && r.method === 'GET') return { json: { phase: pending ? 'submitting' : 'ready' } };
    if (r.path === 'work-imports' && r.method === 'POST') { pending = true; await gate; pending = false; return { status: 409, json: { code: 'NAME_CONFLICT', field: 'name', message: 'Name already in use' } }; }
  });
  await button(page, 'back-works').click(); await button(page, 'import').click();
  await page.locator('#work-file-input').setInputFiles({ name: 'sample.work', mimeType: 'application/vnd.piwork.work-package', buffer: Buffer.from('package') });
  await page.locator('#import-name').fill('Taken'); await button(page, 'confirm-import').click();
  await expect(page.locator('#modal')).toContainText('Starting the import');
  release();
  await expect(page.locator('#import-name')).toHaveValue('Taken');
  await expect(button(page, 'confirm-import')).toBeVisible();
  await expect(page.locator('#modal')).not.toContainText('Starting the import');
});

test('Import dialog: a lost response confirmed ready permits a new explicit submission', async t => {
  let attempts = 0;
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'work-packages' && r.method === 'POST') return { json: { transferId: r.headers['x-piwork-transfer-id'], summary: { sourceName: 'example' } } };
    if (r.path.startsWith('work-packages/') && r.method === 'GET') return { json: { phase: 'ready' } };
    if (r.path === 'work-imports' && r.method === 'POST') return ++attempts === 1 ? { abort: true } : { status: 202, json: { operationId: 'retried-import', workId: 'imported', name: 'Chosen' } };
  });
  await button(page, 'back-works').click(); await button(page, 'import').click();
  await page.locator('#work-file-input').setInputFiles({ name: 'sample.work', mimeType: 'application/vnd.piwork.work-package', buffer: Buffer.from('package') });
  await page.locator('#import-name').fill('Chosen'); await button(page, 'confirm-import').click();
  await expect.poll(() => api(page, "return adapter.inspectionContext?.importState;")).toBe('unsubmitted');
  await expect(button(page, 'confirm-import')).toBeEnabled(); await button(page, 'confirm-import').click();
  await expect(page.locator('.import-name-feedback')).toContainText('Chosen');
  assert.equal(requests.filter(r => r.path === 'work-imports' && r.method === 'POST').length, 2);
  assert.equal(requests.filter(r => r.path === 'work-packages' && r.method === 'POST').length, 1);
});

test('Import dialog: reopening reviews the same lost response without submitting again', async t => {
  let release!: () => void;
  const gate = new Promise<void>(done => release = done); t.after(async () => release());
  const { page, requests } = await fixture(t, async r => {
    if (r.path === 'work-packages' && r.method === 'POST') return { json: { transferId: r.headers['x-piwork-transfer-id'], summary: { sourceName: 'example' } } };
    if (r.path.startsWith('work-packages/') && r.method === 'GET') return { json: { phase: 'ready' } };
    if (r.path === 'work-imports' && r.method === 'POST') { await gate; return { abort: true }; }
  });
  await button(page, 'back-works').click(); await button(page, 'import').click();
  await page.locator('#work-file-input').setInputFiles({ name: 'sample.work', mimeType: 'application/vnd.piwork.work-package', buffer: Buffer.from('package') });
  await page.locator('#import-name').fill('Chosen'); await button(page, 'confirm-import').click();
  await expect.poll(() => requests.filter(r => r.path === 'work-imports' && r.method === 'POST').length).toBe(1);
  await button(page, 'close-modal').click(); release();
  await expect.poll(() => api(page, "return adapter.inspectionContext?.importState;")).toBe('unknown');
  await button(page, 'import').click();
  await expect.poll(() => api(page, "return adapter.inspectionContext?.importState;")).toBe('unsubmitted');
  await expect(button(page, 'confirm-import')).toBeEnabled();
  assert.equal(requests.filter(r => r.path === 'work-imports' && r.method === 'POST').length, 1);
  assert.equal(requests.filter(r => r.path === 'work-packages' && r.method === 'POST').length, 1);
});

test('Import dialog: an old ready progress read cannot unlock an accepted lost response', async t => {
  let releaseOld!: () => void, oldStarted!: () => void;
  const oldGate = new Promise<void>(done => releaseOld = done), started = new Promise<void>(done => oldStarted = done);
  t.after(async () => releaseOld()); let reads = 0;
  const { page, requests } = await fixture(t, async r => {
    if (r.path === 'work-packages' && r.method === 'POST') return { json: { transferId: r.headers['x-piwork-transfer-id'], summary: { sourceName: 'example' } } };
    if (r.path.startsWith('work-packages/') && r.method === 'GET') {
      if (++reads === 1) { oldStarted(); await oldGate; return { json: { phase: 'ready' } }; }
      return { json: { phase: 'accepted' } };
    }
    if (r.path === 'work-imports' && r.method === 'POST') { await started; return { abort: true }; }
  });
  await button(page, 'back-works').click(); await button(page, 'import').click();
  await page.locator('#work-file-input').setInputFiles({ name: 'sample.work', mimeType: 'application/vnd.piwork.work-package', buffer: Buffer.from('package') });
  await page.locator('#import-name').fill('Chosen'); await button(page, 'confirm-import').click();
  await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
  await expect.poll(() => api(page, "return adapter.inspectionContext?.importState;")).toBe('accepted');
  releaseOld(); await page.waitForTimeout(200);
  await expect(button(page, 'confirm-import')).toHaveCount(0);
  assert.equal(requests.filter(r => r.path === 'work-imports' && r.method === 'POST').length, 1);
});

test('Import dialog: stale recovery after reopening cannot unlock a newer submission', async t => {
  let releaseFirst!: () => void, releaseOld!: () => void, releaseSecond!: () => void;
  const firstGate = new Promise<void>(done => releaseFirst = done), oldGate = new Promise<void>(done => releaseOld = done), secondGate = new Promise<void>(done => releaseSecond = done);
  t.after(async () => { releaseFirst(); releaseOld(); releaseSecond(); });
  let reads = 0, attempts = 0;
  const { page } = await fixture(t, async r => {
    if (r.path === 'work-packages' && r.method === 'POST') return { json: { transferId: r.headers['x-piwork-transfer-id'], summary: { sourceName: 'example' } } };
    if (r.path.startsWith('work-packages/') && r.method === 'GET') {
      if (++reads === 1) { await oldGate; return { json: { phase: 'ready' } }; }
      return { json: { phase: 'ready' } };
    }
    if (r.path === 'work-imports' && r.method === 'POST') {
      if (++attempts === 1) { await firstGate; return { abort: true }; }
      await secondGate; return { status: 202, json: { operationId: 'new-import', workId: 'imported', name: 'Chosen' } };
    }
  });
  await button(page, 'back-works').click(); await button(page, 'import').click();
  await page.locator('#work-file-input').setInputFiles({ name: 'sample.work', mimeType: 'application/vnd.piwork.work-package', buffer: Buffer.from('package') });
  await page.locator('#import-name').fill('Chosen'); await button(page, 'confirm-import').click();
  await expect.poll(() => attempts).toBe(1); await button(page, 'close-modal').click(); releaseFirst();
  await expect.poll(() => api(page, "return adapter.inspectionContext?.importState;")).toBe('unknown');
  await button(page, 'import').click(); await expect.poll(() => reads).toBe(1);
  await button(page, 'close-modal').click(); await button(page, 'import').click();
  await expect.poll(() => api(page, "return adapter.inspectionContext?.importState;")).toBe('unsubmitted');
  await button(page, 'confirm-import').click(); await expect.poll(() => attempts).toBe(2);
  releaseOld(); await page.waitForTimeout(200);
  assert.equal(await api(page, "return adapter.inspectionContext?.importState;"), 'submitting');
  await expect(button(page, 'confirm-import')).toBeDisabled();
  await expect(button(page, 'confirm-import').locator('[role="status"]')).toHaveCount(1);
  releaseSecond(); await expect(page.locator('.import-name-feedback')).toContainText('Chosen');
  assert.equal(attempts, 2);
});

test('Import dialog: only trustworthy receive progress is quantified, later stages are not', async t => {
  let release!: () => void;
  const gate = new Promise<void>(done => release = done); t.after(async () => release());
  let enabled = false;
  const { page } = await fixture(t, async r => {
    if (r.path === 'work-packages' && r.method === 'POST') { await gate; return { json: { transferId: r.headers['x-piwork-transfer-id'], summary: { sourceName: 'package' } } }; }
    if (r.path.startsWith('work-packages/') && r.method === 'GET') return { json: enabled
      ? { transferId: r.path.split('/')[1], phase: 'validating', transferred: 900, total: 1000 }
      : { transferId: r.path.split('/')[1], phase: 'receiving', transferred: 500, total: 1000 } };
  });
  await button(page, 'back-works').click(); await button(page, 'import').click();
  await page.locator('#work-file-input').setInputFiles({ name: 'sample.work', mimeType: 'application/vnd.piwork.work-package', buffer: Buffer.from('package') });
  // A known completed/total pair is shown in readable units with a percentage.
  await expect(page.locator('.import-transfer-bytes')).toContainText('500 B / 1 KB · 50%');
  await expect(page.locator('#modal progress[aria-label="Transfer bytes"]')).toHaveAttribute('max', '1000');
  // Checking has no trustworthy denominator, so no percentage is invented.
  enabled = true;
  await expect(page.locator('.import-transfer-bytes')).toHaveCount(0, { timeout: 8000 });
  await expect(page.locator('#modal progress')).toHaveCount(0);
  await expect(page.locator('#modal')).toContainText('Checking the package');
  release();
  await expect(page.locator('.import-result')).toContainText('package');
  // A finished receive is never presented as a finished import.
  await expect(page.locator('#modal')).not.toContainText('Import complete');
});

test('unknown model exposes explicit compatible Thinking choices and keeps the draft',async t=>{
 const model={modelRef:null,label:'New model',provider:'anthropic',model:'unknown-model',thinkingAvailability:'unknown',thinkingLevels:[],defaultThinkingLevel:null,compatibleThinkingProfiles:[{profile:'messages-adaptive-v1',levels:['off','high','max']},{profile:'messages-budget-v1',levels:['off','high'],budgets:{high:6144}}]};
 let level:string|null=null,profile:string|undefined;
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:4}};
  if(r.path.endsWith('/chat-models'))return{json:{contractVersion:4,models:[],defaultModel:model,availability:'available',checkedAt:new Date().toISOString()}};
  if(r.path.endsWith('/chat-options')){
   if(r.method==='PATCH'){const input=JSON.parse(r.body);level=input.thinkingLevel;profile=input.thinkingProfile ?? undefined;}
   return{json:{sessionId:'session-1',modelRef:null,model,thinkingLevel:level,...(profile?{thinkingProfile:profile}:{}),availability:'available',checkedAt:new Date().toISOString()}};
  }
 });
 await page.setViewportSize({width:360,height:900});await button(page,'tab-Chat').click();await expectThinkingEditable(page);
 await page.locator('#composer').fill('draft survives');await openResponseSettings(page,'thinking');
 const options=page.locator('#modal [role=listbox]');await expect(options).toContainText('Adaptive');await expect(options).toContainText('6144 tokens');
 assert.equal(requests.filter(r=>r.method==='PATCH').length,0);
 await page.locator('#modal [data-option-value="messages-budget-v1:high"]').click();await closeResponseSettings(page);
 await expect.poll(()=>requests.filter(r=>r.method==='PATCH').length).toBe(1);
 const sent=JSON.parse(requests.find(r=>r.method==='PATCH')!.body);assert.equal(sent.thinkingProfile,'messages-budget-v1');assert.equal(sent.thinkingLevel,'high');
 await chooseModel(page,'',true);
 const repeated=await api(page,"return adapter.modelSelection('work-1','session-1');");
 assert.equal(repeated.profile,'messages-budget-v1');assert.equal(repeated.thinking,'high');assert.equal(repeated.phase,'clean');
 assert.equal(requests.filter(r=>r.method==='PATCH').length,1);await closeResponseSettings(page);
 await expect(page.locator('#composer')).toHaveValue('draft survives');await expect(page.locator('.response-thinking')).toContainText('Compatible');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.setViewportSize({width:1440,height:900});
 await page.evaluate(async()=>{const path='/desktop/browser/locale.js';const locale=await import(path);locale.chooseLocale('zh-CN');});
 await expect(page.locator('.response-thinking')).toContainText('兼容');await expect(page.locator('.response-thinking')).toContainText('预算');
 await openResponseSettings(page,'thinking');
 await expect(page.locator('#modal [role=listbox]')).toContainText('自适应');
 await page.locator('#modal [data-option-value="messages-budget-v1:high"]').focus();
 await expect(page.locator('#modal [data-option-value="messages-budget-v1:high"]')).toBeFocused();
 assert.equal(requests.filter(r=>r.method==='PATCH').length,1);
});

for (const level of ['high','off'] as const) test(`saved compatible ${level} survives SDK recognition and same-model confirmation`,async t=>{
 const unknown={modelRef:null,label:'Future model',provider:'anthropic',model:'future',thinkingAvailability:'unknown',thinkingLevels:[],defaultThinkingLevel:null,compatibleThinkingProfiles:[{profile:'messages-adaptive-v1',levels:['off','high']}]};
 const known={modelRef:null,label:'Future model',provider:'anthropic',model:'future',thinkingLevels:['off'],defaultThinkingLevel:'off'};
 let recognized=false,thinking:string|null=null,profile:string|undefined;
 const {page,requests}=await fixture(t,r=>{
  const model=recognized?known:unknown;
  if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:4}};
  if(r.path.endsWith('/chat-models'))return{json:{contractVersion:4,models:[],defaultModel:model,availability:'available',checkedAt:new Date().toISOString()}};
  if(r.path.endsWith('/chat-options')){if(r.method==='PATCH'){const value=JSON.parse(r.body);thinking=value.thinkingLevel;profile=value.thinkingProfile ?? undefined;}return{json:{sessionId:'session-1',modelRef:null,model,thinkingLevel:thinking,...(profile?{thinkingProfile:profile}:{}),availability:'available'}};}
 });
 await button(page,'tab-Chat').click();await expectThinkingEditable(page);
 await chooseThinking(page,`messages-adaptive-v1:${level}`);await expect.poll(()=>requests.filter(r=>r.method==='PATCH').length).toBe(1);
 recognized=true;await api(page,"await adapter.loadModels('work-1');");
 await page.locator('#composer').fill('Use the saved compatible Thinking preference');
 await expect(button(page,'send-message')).toBeEnabled();
 await chooseModel(page,'',true);
 const state=await api(page,"return adapter.modelSelection('work-1','session-1');");
 assert.equal(state.profile,'messages-adaptive-v1');assert.equal(state.thinking,level);assert.equal(state.phase,'clean');
 assert.equal(requests.filter(r=>r.method==='PATCH').length,1);
 await expect(page.locator('#thinking-select')).toBeEnabled();
 await chooseThinking(page,'off',true);
 await expect.poll(()=>requests.filter(r=>r.method==='PATCH').length).toBe(2);
 const changed=JSON.parse(requests.filter(r=>r.method==='PATCH').at(-1)!.body);
 assert.equal(changed.thinkingLevel,'off');assert.equal(changed.thinkingProfile,null);
 await closeResponseSettings(page);
});

test('switching models during a compatible save requires explicit confirmation of the new model',async t=>{
 const first={modelRef:null,label:'First',provider:'openai',model:'future-first',thinkingAvailability:'unknown',thinkingLevels:[],defaultThinkingLevel:null,compatibleThinkingProfiles:[{profile:'responses-effort-v1',levels:['high']}]};
 const second={...first,modelRef:'model-future-second',label:'Second',model:'future-second'};
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});t.after(async()=>release());
 let ref:string|null=null,thinking:string|null=null,profile:string|undefined;
 const {page,requests}=await fixture(t,async r=>{
  if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:4}};
  if(r.path.endsWith('/chat-models'))return{json:{contractVersion:4,models:[second],defaultModel:first,availability:'available',checkedAt:new Date().toISOString()}};
  if(r.path.endsWith('/chat-options')){if(r.method==='PATCH'){const value=JSON.parse(r.body);if(!requests.filter(x=>x.method==='PATCH' && x.path.endsWith('/chat-options')).slice(1).length)await gate;ref=value.modelRef;thinking=value.thinkingLevel;profile=value.thinkingProfile ?? undefined;}return{json:{sessionId:'session-1',modelRef:ref,model:ref?second:first,thinkingLevel:thinking,...(profile?{thinkingProfile:profile}:{}),availability:'available'}};}
 });
 await button(page,'tab-Chat').click();await expectThinkingEditable(page);
 await page.locator('#composer').fill('Preserve this draft while changing models');
 await chooseThinking(page,'responses-effort-v1:high',true);
 await chooseModel(page,second.modelRef,true);
 release();await expect.poll(async()=>(await api(page,"return adapter.modelSelection('work-1','session-1');")).phase).toBe('dirty');
 assert.equal(requests.filter(r=>r.method==='PATCH').length,1);await expect(button(page,'send-message')).toBeDisabled();
 await expect(page.locator('#modal [data-action=save-model]')).toHaveCount(0);
 await chooseThinking(page,'responses-effort-v1:high',true);
 await expect.poll(()=>requests.filter(r=>r.method==='PATCH').length).toBe(2);
 const changed=JSON.parse(requests.filter(r=>r.method==='PATCH').at(-1)!.body);
 assert.deepEqual([changed.modelRef,changed.thinkingLevel,changed.thinkingProfile],[second.modelRef,'high','responses-effort-v1']);
 await closeResponseSettings(page);await expect(button(page,'send-message')).toBeEnabled();
});

test('a new-session model command remains until compatible Thinking is confirmed for the new model',async t=>{
 const first={modelRef:null,label:'First',provider:'openai',model:'future-first',thinkingAvailability:'unknown',thinkingLevels:[],defaultThinkingLevel:null,compatibleThinkingProfiles:[{profile:'responses-effort-v1',levels:['high']}]};
 const second={...first,modelRef:'model-future-second',label:'Second',model:'future-second'};
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/sessions'))return{json:{sessions:[]}};
  if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:4}};
  if(r.path.endsWith('/chat-models'))return{json:{contractVersion:4,models:[second],defaultModel:first,availability:'available',checkedAt:new Date().toISOString()}};
 });
 await button(page,'tab-Chat').click();await expect(page.locator('.session-line')).toContainText('No Session yet');
 await chooseThinking(page,'responses-effort-v1:high');
 await page.locator('#composer').fill('/model');await page.locator('#composer').press('Escape');await button(page,'send-message').click();
 await chooseModel(page,second.modelRef,true);
 await expect(page.locator('#composer')).toHaveValue('/model');assert.equal(await api(page,"return adapter.modelReady('work-1','');"),false);
 assert.equal(chatWrites(requests).length,0);
 await chooseThinking(page,'responses-effort-v1:high',true);
 await expect(page.locator('#composer')).toHaveValue('');
 assert.equal(chatWrites(requests).length,0);await closeResponseSettings(page);
});

test('a rejected compatible request remains visible and the user can adjust settings without resending',async t=>{
 const model={modelRef:null,label:'New model',provider:'anthropic',model:'unknown-model',thinkingAvailability:'unknown',thinkingLevels:[],defaultThinkingLevel:null,compatibleThinkingProfiles:[{profile:'messages-adaptive-v1',levels:['off','high']},{profile:'messages-budget-v1',levels:['off','high'],budgets:{high:6144}}]};
 const failure={code:'MODEL_COMPATIBLE_REQUEST_REJECTED',message:'The model provider rejected the request. Check the compatible Thinking settings.',retryable:false};
 const run={...controlRun('run-compatible-rejected',5,'session-1',{kind:'chat'}),actualModel:model,thinkingLevel:'high',thinkingProfile:'messages-adaptive-v1',error:failure};
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:4}};
  if(r.path.endsWith('/chat-models'))return{json:{contractVersion:4,models:[],defaultModel:model,availability:'available',checkedAt:new Date().toISOString()}};
  if(r.path.endsWith('/chat-options'))return{json:{sessionId:'session-1',modelRef:null,model,thinkingLevel:'high',thinkingProfile:'messages-adaptive-v1',availability:'available',checkedAt:new Date().toISOString()}};
  if(r.path==='works/work-1/sessions/session-1')return{json:{session:{workId:'work-1',sessionId:'session-1',modelPreference:{...model,availability:'available'},thinkingLevel:'high',thinkingProfile:'messages-adaptive-v1',source:{kind:'chat'}},messages:[{entryId:'user-rejected',runId:'run-compatible-rejected',role:'user',blocks:[{blockId:'user-rejected',type:'text',text:'Original prompt'}]}],runs:[run]}};
  if(r.path==='works/work-1/runs/run-compatible-rejected')return{json:run};
  return focusFixture(r);
 });
 await expect(page.locator('.message-execution').filter({hasText:'The model provider rejected the request'})).toBeVisible();
 await page.locator('#composer').fill('next draft');await openResponseSettings(page,'thinking');
 await expect(page.locator('#modal [role=listbox]')).toContainText('Adaptive');
 await closeResponseSettings(page);await expect(page.locator('#composer')).toHaveValue('next draft');
 assert.equal(requests.filter(r=>r.method==='POST' && r.path.endsWith('/runs')).length,0);
 assert.equal(requests.filter(r=>r.method==='PATCH' && r.path.endsWith('/chat-options')).length,0);
});

for(const language of ['en','zh-CN'])test(`refresh chooses sendable user Session and keeps explicit history (${language})`,async t=>{
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:4}};
  if(r.path.endsWith('/chat-models'))return{json:{contractVersion:4,defaultModel:chatModel,models:[]}};
  if(r.path.endsWith('/sessions'))return{json:{sessions:['session-1','session-2','session-service'].map(sessionId=>({sessionId,modelPreference:{...chatModel,availability:'available'},thinkingLevel:'off',source:{kind:sessionId==='session-service'?'service':'chat'}}))}};
  if(r.path.endsWith('/chat-options'))return{json:{sessionId:r.path.split('/')[3],modelRef:null,model:chatModel,thinkingLevel:'off',availability:r.path.includes('/session-1/')?'unavailable':'available'}};
  const match=r.path.match(/\/sessions\/(session-[^/]+)$/);
  if(match)return{json:{session:{workId:'work-1',sessionId:match[1],modelPreference:{...chatModel,availability:'available'},thinkingLevel:'off',source:{kind:'chat'}},messages:[{role:'user',text:match[1]==='session-1'?'Old preserved history':'New conversation'}],runs:[]}};
 });
 if(language==='zh-CN'){await page.evaluate(()=>localStorage.setItem('piwork.ui-locale','zh-CN'));await page.reload();}
 await expect(page.locator('[data-action="sessions"]').last()).toContainText('2');
 await page.locator('#composer').fill('unsent draft');await expect(button(page,'send-message')).toBeEnabled();
 await page.locator('[data-action="sessions"]').last().click();await page.locator('[data-action="select-session"][data-id="session-1"]').click();
 await expect(page.locator('.options-status').first()).toContainText(language==='en'?'environment or saved settings':'环境或已保存设置');
 await expect(page.locator('body')).toContainText('Old preserved history');await expect(button(page,'send-message')).toBeDisabled();
 await expect(page.locator('body')).not.toContainText(language==='en'?'Choose an available model.':'请选择可用模型。');
 await page.reload();await expect(page.locator('[data-action="sessions"]').last()).toContainText('2');
 assert.equal(requests.filter(r=>['POST','PATCH','PUT','DELETE'].includes(r.method)).length,0);
 assert.equal(requests.filter(r=>r.path.includes('/session-service/chat-options')).length,0);
});

test('all unavailable Sessions retain history and expose Session recovery without creating or sending',async t=>{
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:4}};
  if(r.path.endsWith('/chat-models'))return{json:{contractVersion:4,defaultModel:chatModel,models:[]}};
  if(r.path.endsWith('/chat-options'))return{json:{sessionId:'session-1',modelRef:null,model:chatModel,thinkingLevel:'off',availability:'unavailable'}};
 });
 await expect(page.locator('.options-status').first()).toContainText('environment or saved settings');
 await page.locator('#composer').fill('keep this draft');await expect(button(page,'send-message')).toBeDisabled();
 await page.locator('.options-status [data-action="sessions"]').click();await expect(button(page,'new-session')).toBeVisible();
 await button(page,'close-modal').click();await expect(page.locator('#composer')).toHaveValue('keep this draft');
 assert.equal(requests.filter(r=>['POST','PATCH','PUT','DELETE'].includes(r.method)).length,0);
});
