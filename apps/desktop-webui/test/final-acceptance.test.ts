import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
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
async function fixture(t: { after: (fn: () => Promise<void>) => void }, handler: (record: RequestRecord) => Reply | undefined | Promise<Reply | undefined>, anonymous = false, waitForInitialRead = true) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); t.after(() => page.close());
  // Shared synthetic HTTP shape copied with the recovery fixture owner's agreement.
  // Cases that compare normal/reduced motion override this before opening overlays.
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
      else if (/^works\/[^/]+\/configuration$/.test(r.path)) { if (r.method === 'PUT') desired = JSON.parse(r.body).configuration; reply = { json: { desired, active: desired, pendingApply: false, runtime: { state: 'ready' } } }; }
      else if (r.path.endsWith('/services')) reply = { json: { services: [] } };
      else if (r.path.endsWith('/packages')) reply = { json: { packages: [] } };
      else if (r.path.endsWith('/models')) reply = { json: {models:[{modelRef:'model-test-0000000001',label:'Test model',provider:'fixture',model:'one'}],defaultModel:{modelRef:null,label:'Work model',provider:'fixture',model:'one'},checkedAt:new Date().toISOString(),availability:'available'} };
      else if (r.path.endsWith('/sessions')) reply = { json: { sessions: [{ sessionId: 'session-1' }] } };
      else if (r.path.endsWith('/sessions/session-1')) reply = { json: {session:{sessionId:'session-1',workId:r.path.split('/')[1],modelPreference:null,source:{kind:'chat'}}, messages: [{ role: 'user', text: 'original prompt' }],runs:[] } };
      else if (r.path.startsWith('operations/')) reply = { json: { state: 'succeeded', operationId: r.path.split('/')[1] } };
      else reply = { status: 404, json: { code: 'NOT_FOUND' } };
    }
    if (reply.abort) await route.abort('failed');
    else await route.fulfill({ status: reply.status ?? 200, headers: reply.headers, ...(reply.json !== undefined ? { contentType: 'application/json', body: JSON.stringify(reply.json) } : { body: reply.body ?? '' }) });
  });
  await page.goto(base + (anonymous ? '/' : '/#/work/work-1'));
  await expect(page.getByRole('heading', { name: anonymous ? 'Connect to your Core' : 'Recovery Work', exact: true })).toBeVisible();
  if (!anonymous && waitForInitialRead) {
    await expect.poll(()=>api(page, "const w=adapter.getWork('work-1');return !!(w?.resourceChecked?.services || w?.resourceErrors?.services);")).toBe(true);
    await expect(page.locator('.work-read-feedback')).toHaveCount(0);
    await expect.poll(() => api(page, "const w=adapter.getWork('work-1');return !!w?.resourceChecked?.agent && !Object.values(w.resourceLoading || {}).some(Boolean) && !!w.sessions[0]?.checkedAt;")).toBe(true);
  }
  return { page, requests };
}
const api = (page: Page, code: string): Promise<any> => page.evaluate(`(async () => { const { adapter } = await import('/desktop/browser/adapter.js'); ${code} })()`);
const button = (page: Page, action: string) => page.locator(`[data-action="${action}"]:visible`).first();

// Only the remaining browser evidence is added here. Existing acceptance is reused:
// - recovery: “UX revision late Work defaults…”, “UX revision Files and ordinary Chat…”;
//   Focus iframe/reading preservation, standalone no Chat, R1 dirty-file recovery;
//   R2 rejected/unknown saves and “Reconcile configuration: delayed Save…”;
//   “B file chooser result cannot target a different directory…”, C naming/IME.
// - feedback: C01 empty-Service/reentry/missing-directory, DWUI-017 pause/visibility,
//   Chat images identity cleanup, DWUI-012 original-object late callbacks.
// - modal-presentation: immediate dismissal, one focus restoration, no exit timers.
// This file does not claim real Core, OS IME or assistive-technology coverage.

function deferred(t: { after: (fn: () => Promise<void>) => void }) {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  t.after(async () => release());
  return { promise, release };
}
const work = (id = 'work-1', version = 1) => ({ id, name: id === 'work-1' ? 'Recovery Work' : 'Other Work', observedState: 'ready', desiredState: 'running', controlVersion: version });
const service = (id: string, observedState = 'ready', enabled = true, ports = [80], name = `Tool ${id.toUpperCase()}`) => ({
  serviceId: `service-${id}`, name, enabled, observedState,
  access: { hostname: `${id}.work.test`, ports: ports.map(port => ({ port, url: `http://${id}.work.test:${port}`, name: 'web' })) },
});
function appFixture(r: RequestRecord): Reply | undefined {
  if (r.path.endsWith('/services')) return { json: { services: [service('a'), service('b')] } };
  if (r.path === 'service-entries') {
    const target = JSON.parse(r.body), entryId = `${target.workId}-${target.serviceId}-${target.port}`;
    return { json: { ...target, entryId, origin: base, entryUrl: `${base}/_desktop/final-app/${entryId}/`, embed: 'allowed' } };
  }
  if (r.path.startsWith('service-entries/')) return { json: { embed: 'allowed' } };
  if (r.path.startsWith('/_desktop/final-app/')) return { body: '<html><body><input aria-label="Application draft"><p>Original application</p></body></html>', headers: { 'Content-Type': 'text/html' } };
  if (r.path.endsWith('/logs')) return { json: { status: 'available', text: 'Current bounded log', collectedAt: '2026-10-14T00:00:00Z', truncated: false } };
}
function filesFixture(r: RequestRecord): Reply | undefined {
  if (!r.path.startsWith('/_desktop/files/')) return;
  if (r.method === 'PROPFIND') {
    const workId = r.path.split('/')[4], inTree = r.path.endsWith('/tree/');
    const path = `/_desktop/files/works/${workId}/files/`;
    const row = (name: string, directory: boolean) => `<d:response><d:href>${path}${name}</d:href><d:propstat><d:prop><d:resourcetype>${directory ? '<d:collection/>' : ''}</d:resourcetype><d:getcontentlength>13</d:getcontentlength><d:getlastmodified>${mtime1}</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
    return { status: 207, body: `<d:multistatus xmlns:d="DAV:">${inTree ? row('tree/note.txt', false) : row('tree/', true) + row('note.txt', false)}</d:multistatus>`, headers: { 'Content-Type': 'application/xml' } };
  }
  if (r.method === 'GET') return { body: 'original file', headers: { 'Last-Modified': mtime1 } };
}
const businessWrites = (requests: RequestRecord[]) => requests.filter(r =>
  ['POST', 'PUT', 'PATCH', 'DELETE', 'MKCOL', 'MOVE', 'COPY'].includes(r.method) &&
  !['service-entries', 'login', 'logout', 'connection'].includes(r.path));
async function visible(page: Page, state: 'visible' | 'hidden') {
  await page.evaluate(state => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}
async function signInAgain(page: Page) {
  await page.evaluate(() => { location.hash = '/works'; });
  await api(page, "await adapter.signIn('http://core.test','owner','synthetic-password');");
  await expect(page.locator('.work-name[data-id="work-1"]')).toBeVisible();
  await page.locator('.work-name[data-id="work-1"]').click();
  await expect(page.locator('.work-read-feedback')).toHaveCount(0);
}

test('Final 5.1 no-Operation Works refresh discovers external membership, retains search on failure and rejects an older control version', async t => {
  const gate = deferred(t);
  let rows = [work()], fail = false, hold = false, detail = work();
  const { page, requests } = await fixture(t, async r => {
    if (r.path === 'works') {
      const captured = structuredClone(rows);
      if (hold) await gate.promise;
      return fail ? { status: 503, json: { message: 'External list temporarily unavailable' } } : { json: { works: captured } };
    }
    if (r.path === 'works/work-1') return { json: detail };
  });
  assert.deepEqual(await api(page, 'return adapter.state.operations;'), []);
  rows = [work(), work('work-2')];
  const beforeReturn = requests.filter(r => r.path === 'works').length;
  await button(page, 'back-works').click();
  await expect(page.locator('.work-row')).toHaveCount(2);
  assert.equal(requests.filter(r => r.path === 'works').length, beforeReturn + 1);
  await page.getByLabel('Search Works', { exact: true }).fill('Recovery');
  await visible(page, 'hidden'); rows = [work()];
  const beforeVisible = requests.filter(r => r.path === 'works').length;
  await visible(page, 'visible');
  await expect.poll(() => api(page, 'return adapter.state.works.map(w=>w.id);')).toEqual(['work-1']);
  assert.equal(requests.filter(r => r.path === 'works').length, beforeVisible + 1);
  await expect(page.getByLabel('Search Works', { exact: true })).toHaveValue('Recovery');
  fail = true; await button(page, 'retry-works').click();
  await expect(page.getByText('Works could not be refreshed.', { exact: false })).toBeVisible();
  await expect(page.locator('.work-row')).toHaveCount(1);
  await expect(page.getByLabel('Search Works', { exact: true })).toHaveValue('Recovery');
  fail = false; hold = true;
  await api(page, 'window.finalOldWorks = adapter.listWorks();');
  await expect.poll(() => api(page, 'return adapter.worksLoading;')).toBe(true);
  detail = { ...work('work-1', 9), observedState: 'stopped', desiredState: 'stopped' };
  await api(page, "await adapter.refreshWorkStatus('work-1');");
  gate.release(); await api(page, 'await window.finalOldWorks;');
  assert.deepEqual(await api(page, "const w=adapter.getWork('work-1');return [w.controlVersion,w.desired,w.status];"), [9, 'stopped', 'Stopped']);
  await expect(page.locator('.work-row')).toContainText('Stopped');
  await expect(page.getByLabel('Search Works', { exact: true })).toHaveValue('Recovery');
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
  assert.equal(requests.filter(r => r.path.startsWith('operations/')).length, 0);
});

test('Final 7.1 Work-specific area and path restore independently and identity change clears the remembered area', async t => {
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works') return { json: { works: [work(), work('work-2')] } };
    if (r.path === 'works/work-2') return { json: work('work-2') };
    return filesFixture(r) ?? appFixture(r);
  });
  await button(page, 'tab-Files').click();
  await page.locator('[data-action="open-file"][data-path="/tree"]').click();
  await expect(page.locator('.breadcrumbs')).toContainText('tree');
  await button(page, 'back-works').click(); await page.locator('.work-name[data-id="work-2"]').click();
  await button(page, 'tab-Chat').click(); await expect(button(page, 'tab-Chat')).toHaveClass(/active/);
  await button(page, 'back-works').click(); await page.locator('.work-name[data-id="work-1"]').click();
  await expect(button(page, 'tab-Files')).toHaveClass(/active/);
  await expect(page.locator('.breadcrumbs')).toContainText('tree');
  await button(page, 'back-works').click(); await page.locator('.work-name[data-id="work-2"]').click();
  await expect(button(page, 'tab-Chat')).toHaveClass(/active/);
  await api(page, 'await adapter.signOut();');
  await signInAgain(page);
  await expect(button(page, 'tab-Services')).toHaveClass(/active/);
  await button(page, 'tab-Files').click();
  await expect(page.locator('.breadcrumbs [data-path="/tree"]')).toHaveCount(0);
  assert.equal(businessWrites(requests).length, 0);
});

test('Final 7.1 a late initial Work read does not replace an explicit Files area or its open command menu', async t => {
  const gate = deferred(t);
  const { page, requests } = await fixture(t, async r => {
    if (r.path.endsWith('/configuration')) await gate.promise;
    return filesFixture(r) ?? appFixture(r);
  }, false, false);
  await button(page, 'tab-Files').click();
  await expect(page.locator('[data-action="open-file"][data-path="/tree"]')).toBeVisible();
  await button(page, 'file-add').click();
  await expect(page.getByRole('menu', { name: 'File actions' })).toBeVisible();
  gate.release(); await expect(page.locator('.work-read-feedback')).toHaveCount(0);
  await expect(button(page, 'tab-Files')).toHaveClass(/active/);
  await expect(page.getByRole('menu', { name: 'File actions' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Upload files' })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.locator('#file-add-trigger')).toBeFocused();
  assert.equal(businessWrites(requests).length, 0);
});

test('Final 12.3 ordinary Hide/Show preserves iframe, split, Session, text and image draft and reading position', async t => {
  const bytes = await readFile(new URL('../../../../fixtures/chat-images/png.png', import.meta.url));
  const history = Array.from({ length: 35 }, (_, i) => ({ entryId: `ordinary-${i}`, role: 'assistant', text: `Paragraph ${i}. ${'Keep this reading position. '.repeat(20)}` }));
  const { page, requests } = await fixture(t, r => {
    if (r.path.endsWith('/sessions/session-1')) return { json: { session: { workId: 'work-1', sessionId: 'session-1', modelPreference: null, source: { kind: 'chat' } }, messages: history, runs: [] } };
    if (r.path.endsWith('/chat-image-capabilities')) return { json: { profile: 'chat-images-v1', defaultModel: { modelRef: null, availability: 'supported' }, models: [] } };
    return appFixture(r);
  });
  await expect(page.locator('iframe')).toBeVisible();
  await page.frameLocator('iframe').getByLabel('Application draft').fill('same document');
  await page.locator('#workspace-splitter').focus(); await page.keyboard.press('ArrowLeft');
  const split = await page.locator('#workspace-splitter').getAttribute('aria-valuenow');
  await page.locator('#composer').fill('ordinary Chat draft');
  await page.locator('#chat-image-input').setInputFiles({ name: 'ordinary.png', mimeType: 'image/png', buffer: bytes });
  await expect(page.locator('.chat-image-draft')).toHaveCount(1);
  await expect(page.locator('.chat-image-drafts')).not.toContainText('Checking');
  await page.locator('#composer').evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(3, 11));
  await page.locator('#messages').evaluate(node => { node.scrollTop = node.scrollHeight / 2; node.dispatchEvent(new Event('scroll')); });
  const reading = await page.locator('#messages').evaluate(node => node.scrollTop);
  const entries = requests.filter(r => r.path === 'service-entries').length;
  await page.evaluate(() => {
    const frame = document.querySelector('iframe')!;
    (window as any).ordinary = { frame, document: frame.contentDocument, composer: document.querySelector('#composer'), loads: 0 };
    frame.addEventListener('load', () => { (window as any).ordinary.loads++; });
  });
  for (let i = 0; i < 2; i++) {
    await button(page, 'toggle-workspace-chat').click();
    await expect(page.locator('#composer')).toBeHidden(); await expect(page.locator('.work-tabs')).toBeVisible();
    await expect(button(page, 'toggle-workspace-chat')).toHaveAttribute('aria-expanded', 'false');
    await button(page, 'toggle-workspace-chat').click();
    await expect(page.locator('#composer')).toHaveValue('ordinary Chat draft');
    await expect(page.locator('.chat-image-draft')).toHaveCount(1);
    await expect(page.locator('#workspace-splitter')).toHaveAttribute('aria-valuenow', split!);
    assert.deepEqual(await page.locator('#composer').evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd]), [3, 11]);
    assert.ok(Math.abs(await page.locator('#messages').evaluate(node => node.scrollTop) - reading) < 2);
    assert.equal(await page.evaluate(() => { const saved = (window as any).ordinary, frame = document.querySelector('iframe'); return frame === saved.frame && frame?.contentDocument === saved.document && document.querySelector('#composer') === saved.composer && saved.loads === 0; }), true);
  }
  await expect(page.frameLocator('iframe').getByLabel('Application draft')).toHaveValue('same document');
  assert.equal(requests.filter(r => r.path === 'service-entries').length, entries);
  await button(page, 'back-works').click(); await page.locator('.work-name[data-id="work-1"]').click();
  await expect(page.locator('#composer')).toHaveValue('ordinary Chat draft');
  await expect(page.locator('.chat-image-draft')).toHaveCount(1);
  await expect(page.locator('#workspace-splitter')).toHaveAttribute('aria-valuenow', split!);
  // Leaving a Work is navigation, not a layout-only iframe identity guarantee.
  await api(page, 'await adapter.signOut();'); await signInAgain(page);
  await expect(page.locator('#composer')).toHaveValue(''); await expect(page.locator('.chat-image-draft')).toHaveCount(0);
  assert.equal(businessWrites(requests).length, 0);
});

test('Final 12.5 Service picker reports all real states and multi-port late preparation cannot replace the newer Service', async t => {
  const gate = deferred(t), longName = 'Tool A with a deliberately long readable application name '.repeat(3);
  const services = [service('a', 'ready', true, [80, 81], longName), service('b'), service('starting', 'starting'), service('stopped', 'stopped'), service('failed', 'failed'), service('disabled', 'ready', false), service('nonweb', 'ready', true, []), service('removed', 'removed')];
  const { page, requests } = await fixture(t, async r => {
    if (r.path.endsWith('/services')) return { json: { services } };
    if (r.path === 'service-entries' && JSON.parse(r.body).port === 81) await gate.promise;
    return appFixture(r);
  });
  await page.locator('#composer').fill('same Session');
  await page.setViewportSize({ width: 360, height: 800 });
  await page.locator('#service-select').click();
  await expect(page.getByRole('listbox', { name: 'Services' }).getByRole('option')).toHaveCount(6);
  await expect(page.locator('[data-action="select-service"][data-id="service-a"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#modal')).toContainText(longName.trim());
  await expect(page.locator('#modal [data-id="service-nonweb"], #modal [data-id="service-removed"]')).toHaveCount(0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  for (const [id, label] of [['starting', 'Starting'], ['stopped', 'Stopped'], ['failed', 'Failed'], ['disabled', 'Disabled']] as const) {
    await expect(page.locator(`#modal [data-id="service-${id}"]`)).toContainText(label);
  }
  await page.keyboard.press('Escape'); await expect(page.locator('#service-select')).toBeFocused();
  const entryCount = requests.filter(r => r.path === 'service-entries').length;
  for (const id of ['starting', 'stopped', 'failed', 'disabled']) {
    await page.locator('#service-select').click(); await page.locator(`#modal [data-id="service-${id}"]`).click();
    await expect(page.locator('#service-select')).toHaveAttribute('data-service-id', `service-${id}`);
    await expect(page.locator('iframe')).toHaveCount(0);
  }
  assert.equal(requests.filter(r => r.path === 'service-entries').length, entryCount);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#service-select').click(); await page.locator('#modal [data-id="service-a"]').click();
  await button(page, 'service-menu').click(); await button(page, 'manage-services').click();
  await page.locator('[data-action="service-details"][data-id="service-a"]').click();
  await page.getByRole('combobox', { name: 'Web entry', exact: true }).selectOption('81');
  await expect.poll(() => requests.filter(r => r.path === 'service-entries' && JSON.parse(r.body).port === 81).length).toBe(1);
  await button(page, 'close-modal').click();
  await page.locator('#service-select').click(); await page.locator('#modal [data-id="service-b"]').click();
  await expect(page.locator('iframe')).toHaveAttribute('src', /work-1-service-b-80/);
  gate.release();
  await expect.poll(() => api(page, "return adapter.serviceEntryPending('work-1','service-a',81);")).toBe(false);
  await expect(page.locator('#service-select')).toHaveAttribute('data-service-id', 'service-b');
  await expect(page.locator('iframe')).toHaveAttribute('src', /work-1-service-b-80/);
  await expect(page.locator('#composer')).toHaveValue('same Session');
  await expect(page.locator('.session-line')).toContainText('Session 1');
  const targets = requests.filter(r => r.path === 'service-entries').map(r => JSON.parse(r.body));
  assert.deepEqual(targets, [{ workId: 'work-1', serviceId: 'service-a', port: 80 }, { workId: 'work-1', serviceId: 'service-a', port: 81 }, { workId: 'work-1', serviceId: 'service-b', port: 80 }]);
  assert.equal(businessWrites(requests).length, 0);
});

for (const change of ['path', 'identity'] as const) test(`Final 13.2/17.2 Files menu keyboard and stale ${change} context never execute old commands`, async t => {
  const { page, requests } = await fixture(t, filesFixture);
  await page.setViewportSize({ width: 360, height: 800 }); await button(page, 'tab-Files').click();
  const trigger = page.locator('#file-add-trigger'), menu = page.getByRole('menu', { name: 'File actions' });
  await trigger.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Upload files' })).toBeFocused();
  await page.keyboard.press('End'); await expect(page.getByRole('menuitem', { name: 'Connect with WebDAV' })).toBeFocused();
  await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'New folder' })).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.locator('#form-name')).toBeFocused();
  await expect(menu).toHaveCount(0); await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await trigger.click(); await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await trigger.click(); await page.keyboard.press('Tab');
  await expect(menu).toHaveCount(0);
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest('#file-actions')), false);
  await trigger.click(); await page.getByRole('heading', { name: 'Recovery Work', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await trigger.click();
  const chooserEvent = page.waitForEvent('filechooser'); await page.getByRole('menuitem', { name: 'Upload files' }).click();
  const chooser = await chooserEvent; await chooser.setFiles([]);
  assert.equal(requests.filter(r => ['HEAD', 'PUT'].includes(r.method)).length, 0);
  await trigger.click();
  const stale = await page.getByRole('menuitem', { name: 'New folder' }).elementHandle(); assert.ok(stale);
  if (change === 'path') {
    // At 360px the anchored menu covers the first row. Dispatch the existing
    // button's click without an outside pointer/focus dismissal, so this checks
    // path-context invalidation itself rather than the already-tested close path.
    await page.locator('[data-action="open-file"][data-path="/tree"]').evaluate(node => (node as HTMLButtonElement).click());
    await expect(page.locator('.breadcrumbs')).toContainText('tree');
  } else {
    await api(page, 'await adapter.signOut();');
    await expect(page.getByRole('heading', { name: 'Connect to your Core' })).toBeVisible();
  }
  await expect(menu).toHaveCount(0);
  assert.equal(await stale.evaluate(node => node.isConnected), false);
  await stale.evaluate(node => (node as HTMLButtonElement).click());
  await expect(page.locator('#form-name')).toHaveCount(0);
  assert.equal(businessWrites(requests).length, 0);
});

for (const source of ['Services', 'Files', 'Chat'] as const) test(`Final 13.3 Settings returns to ${source} and dirty refresh/Keep editing retain the draft without Save or Apply`, async t => {
  const { page, requests } = await fixture(t, r => filesFixture(r) ?? appFixture(r));
  await button(page, `tab-${source}`).click();
  if (source === 'Files') {
    await page.locator('[data-action="open-file"][data-path="/tree"]').click();
    await expect(page.locator('.breadcrumbs')).toContainText('tree');
  }
  await button(page, 'settings').click();
  await button(page, 'back-work').click();
  await expect(button(page, `tab-${source}`)).toHaveClass(/active/);
  if (source === 'Files') await expect(page.locator('.breadcrumbs')).toContainText('tree');
  await button(page, 'settings').click(); await page.locator('[data-tab="AGENTS.md"]').click();
  const draft = `Unsaved settings from ${source}`;
  await page.locator('#agents-editor').fill(draft);
  const reads = requests.filter(r => r.path.endsWith('/configuration') && r.method === 'GET').length;
  await button(page, 'refresh-config').click();
  await expect.poll(() => requests.filter(r => r.path.endsWith('/configuration') && r.method === 'GET').length).toBe(reads + 1);
  await expect(page.locator('#agents-editor')).toHaveValue(draft);
  await button(page, 'back-work').click(); await expect(page.locator('#modal')).toContainText('Save configuration changes?');
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.locator('#agents-editor')).toHaveValue(draft);
  await button(page, 'back-work').click(); await button(page, 'dirty-config-discard').click();
  await expect(button(page, `tab-${source}`)).toHaveClass(/active/);
  if (source === 'Files') await expect(page.locator('.breadcrumbs')).toContainText('tree');
  assert.equal(businessWrites(requests).length, 0);
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) test(`Final 15.3/17.3 ${reducedMotion} late overlay read preserves the new modal after navigation; identity change clears presentation`, async t => {
  const gate = deferred(t);
  const { page, requests } = await fixture(t, async r => {
    if (r.path === 'works/work-1/services/service-a/logs') { await gate.promise; return { json: { status: 'available', text: 'Late original A log', collectedAt: '2026-10-14T00:00:00Z', truncated: false } }; }
    return filesFixture(r) ?? appFixture(r);
  });
  await page.emulateMedia({ reducedMotion });
  await button(page, 'service-menu').click(); await button(page, 'manage-services').click();
  await page.locator('[data-action="service-details"][data-id="service-a"]').click();
  const pendingLogs = page.locator('#modal [data-pending-action~="refresh-logs"]');
  await expect(pendingLogs).toContainText('Reading Tool A log snapshot');
  await expect(pendingLogs).toHaveAttribute('aria-busy', 'true');
  await expect(pendingLogs.locator('.pending-dots')).toHaveCount(1);
  await button(page, 'close-modal').click(); await button(page, 'tab-Files').click();
  await button(page, 'file-add').click(); await page.getByRole('menuitem', { name: 'New folder' }).click();
  await page.locator('#form-name').fill('new modal keeps focus');
  await page.evaluate(() => { (window as any).newAcceptanceModal = document.querySelector('#modal'); });
  gate.release();
  await expect.poll(() => api(page, "return adapter.serviceLogs('work-1','service-a')?.loading;")).toBe(false);
  await expect(page.locator('#form-name')).toHaveValue('new modal keeps focus'); await expect(page.locator('#form-name')).toBeFocused();
  assert.equal(await page.evaluate(() => document.querySelector('#modal') === (window as any).newAcceptanceModal), true);
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await expect(page.locator('#modal')).not.toContainText('Late original A log');
  await expect(page.locator('#modal [data-pending-action~="refresh-logs"]')).toHaveCount(0);
  const motion = await page.locator('#modal').evaluate(node => ({ animation: getComputedStyle(node).animationName, transition: getComputedStyle(node).transitionDuration }));
  assert.equal(motion.animation, 'none'); assert.match(motion.transition, /^0s(?:, 0s)*$/);
  await page.keyboard.press('Escape'); await expect(page.locator('#file-add-trigger')).toBeFocused();
  await expect(page.locator('dialog[open], [inert], .modal-exit-layer, .modal-exit-backdrop')).toHaveCount(0);
  await button(page, 'file-add').click(); await page.getByRole('menuitem', { name: 'New folder' }).click();
  await api(page, 'await adapter.signOut();');
  await expect(page.locator('dialog[open], [inert], .modal-exit-layer, .modal-exit-backdrop')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Connect to your Core' })).toBeVisible();
  assert.equal(requests.filter(r => r.path === 'works/work-1/services/service-a/logs').length, 1);
  assert.equal(businessWrites(requests).length, 0);
});
