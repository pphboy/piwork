import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium, expect, type Page, type Route } from '@playwright/test';
import { createHash } from 'node:crypto';

let browser: Awaited<ReturnType<typeof chromium.launch>>;
let base = '';
let nativeDownloadHandler: ((request: IncomingMessage, response: ServerResponse) => Promise<void>) | undefined;
let nativeUploadHandler: ((request: IncomingMessage, response: ServerResponse) => Promise<void>) | undefined;
const server = createServer(async (request, response) => {
  if (nativeUploadHandler && request.method === 'PUT' && request.url?.startsWith('/_desktop/files/')) { await nativeUploadHandler(request, response); return; }
  if (request.method === 'GET' && request.url === '/desktop/piwork-logo.png') {
    try { response.setHeader('Content-Type', 'image/png'); response.end(await readFile(new URL('../public/piwork-logo.png', import.meta.url))); }
    catch { response.writeHead(404); response.end(); }
    return;
  }
  if (request.method === 'GET' && /^\/_desktop\/api\/downloads\/[^/]+\/content$/.test(request.url || '')) {
    if (nativeDownloadHandler) await nativeDownloadHandler(request, response);
    else { response.writeHead(404); response.end(); }
    return;
  }
  const path = request.url?.startsWith('/desktop/browser/') ? '../browser/' + request.url.slice('/desktop/browser/'.length) : '../public/' + (request.url === '/style.css' ? 'style.css' : 'index.html');
  try { response.setHeader('Content-Type', path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html'); response.end(await readFile(new URL(path, import.meta.url))); }
  catch { response.writeHead(404); response.end(); }
});
before(async () => { await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const address = server.address(); assert(address && typeof address !== 'string'); base = `http://127.0.0.1:${address.port}`; browser = await chromium.launch(process.env.PIWORK_TEST_BROWSER_BIN ? { headless: true, executablePath: process.env.PIWORK_TEST_BROWSER_BIN } : { headless: true, channel: 'chromium' }); });
after(async () => { await browser.close(); await new Promise<void>(done => server.close(() => done())); });

async function openWorkForRecovery(page: Page) {
  if (await page.locator('#modal').count()) await button(page, 'close-modal').click();
  if (!await button(page, 'work-menu').count()) await page.locator('.work-name[data-action="open-work"]').first().click();
}
async function findPreviousExport(page: Page) {
  await openWorkForRecovery(page);
  await button(page, 'work-menu').click(); await button(page, 'find-previous-export').click();
}
/** Tasks without a visible Work live behind the Works header entry, not in front of the list. */
async function openWorksTasks(page: Page) {
  // Reload restores the original tasks asynchronously; wait for the fixed entry.
  const entry = page.locator('[data-action="works-tasks"]').first();
  await entry.waitFor({ state: 'attached', timeout: 10000 });
  // Closing a task detail keeps the disclosure; only reopen when it is shut.
  const open = page.locator('#modal[aria-labelledby="modal-title"]');
  const drawerOpen = await open.count() && (await open.getAttribute('class') || '').includes('inspector-drawer');
  if (!drawerOpen) await entry.click();
  // The tail of the list is collapsed behind "Show N more tasks".
  const more = page.locator('.recovery-tasks > details');
  if (await more.count() && !(await more.first().evaluate(node => (node as HTMLDetailsElement).open))) await more.first().locator('summary').click();
}
async function workTasks(page: Page) {
  await openWorkForRecovery(page);
  await button(page, 'work-menu').click(); await button(page, 'work-info').click(); await button(page, 'find-work-task').click();
}
async function exportDetails(page: Page) {
  if (!await page.locator('.export-details').evaluate(el => el.hasAttribute('open'))) await page.locator('.export-details > summary').click();
}

type RequestRecord = { bytes?: Buffer | null; path: string; search?:string; method: string; headers: Record<string, string>; body: string };
type Reply = { passthrough?: boolean; status?: number; json?: unknown; body?: string | Buffer; headers?: Record<string, string>; abort?: boolean };
const mtime1 = 'Sat, 03 Oct 2026 01:00:00 GMT';
const mtime2 = 'Sat, 03 Oct 2026 01:00:02 GMT';
const mtime3 = 'Sat, 03 Oct 2026 01:00:04 GMT';
async function fixture(t: { after: (fn: () => Promise<void>) => void }, handler: (record: RequestRecord) => Reply | undefined | Promise<Reply | undefined>, anonymous = false, waitForInitialWork = true, duringInitial?: (page: Page) => Promise<void>, gatePage = false) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); t.after(() => page.close()); page.setDefaultTimeout(5000);
  const requests: RequestRecord[] = [];
  const baseline = process.env.PIWORK_SESSION_BASELINE_DIR;
  if (baseline) {
    await page.route('**/desktop/browser/app.js', async route => route.fulfill({ contentType: 'application/javascript', body: await readFile(`${baseline}/before-app.js`) }));
    await page.route('**/style.css', async route => route.fulfill({ contentType: 'text/css', body: await readFile(`${baseline}/before-style.css`) }));
  }
  // Browser-managed attachment downloads do not reliably pass through page.route.
  // Serve content over HTTP and record it once at the server, never as the SPA fallback.
  nativeDownloadHandler = async (request, response) => {
    const url = new URL(request.url!, base);
    const r: RequestRecord = { path: url.pathname.replace('/_desktop/api/', ''), search: url.search, method: request.method!, headers: Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value || ''])), body: '' };
    requests.push(r);
    const reply = await handler(r);
    if (!reply || reply.passthrough) { response.writeHead(404); response.end(); return; }
    if (reply.abort) { response.destroy(); return; }
    response.writeHead(reply.status ?? 200, reply.headers);
    response.end(reply.json !== undefined ? JSON.stringify(reply.json) : reply.body ?? '');
  };
  t.after(async () => { nativeDownloadHandler = undefined; });
  let generation = 1, signedIn = !anonymous, core = 'http://core.test';
  let desired: Record<string, any> = { skills: ['saved'], packages: [{ name: 'pkg', enabled: true }], agentsMd: 'saved agents', modelRef: 'original', mcp: { servers: [] } };
  const session = () => ({ state: signedIn ? 'authenticated' : 'signed-out', generation, csrf: 'local-session-csrf', coreUrl: core, ...(signedIn ? { user: { account: 'owner', role: 'user' } } : {}) });
  await page.route('**/_desktop/**', async (route: Route) => {
    if (/\/_desktop\/api\/downloads\/[^/]+\/content$/.test(new URL(route.request().url()).pathname)) { await route.continue(); return; }
    const r: RequestRecord = { path: new URL(route.request().url()).pathname.replace('/_desktop/api/', ''), search:new URL(route.request().url()).search, method: route.request().method(), bytes: route.request().postDataBuffer(), headers: route.request().headers(), body: route.request().postData() ?? '' }; requests.push(r);
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
      else if (r.path.endsWith('/models')) reply = {json:{models:[{modelRef:'model-test-0000000001',label:'Test model',provider:'fixture',model:'one'}],defaultModel:{modelRef:null,label:'Work model',provider:'fixture',model:'one'},availability:'available',checkedAt:new Date().toISOString()}};
      else if (r.path.endsWith('/sessions')) reply = { json: { sessions: [{ sessionId: 'session-1' }] } };
      else if (r.path.endsWith('/sessions/session-1')) reply = { json: {session:{workId:'work-1',sessionId:'session-1',modelPreference:null,source:{kind:'chat'}},messages:[{role:'user',text:'original prompt'}],runs:[]} };
      else if (r.path.startsWith('operations/')) reply = { json: { state: 'succeeded', operationId: r.path.split('/')[1] } };
      else reply = { status: 404, json: { code: 'NOT_FOUND' } };
    }
    if (reply.passthrough) await route.continue();
    else if (reply.abort) await route.abort('failed');
    else await route.fulfill({ status: reply.status ?? 200, headers: reply.headers, ...(reply.json !== undefined ? { contentType: 'application/json', body: JSON.stringify(reply.json) } : { body: reply.body ?? '' }) });
  });
  await page.goto(base + (anonymous ? '/' : '/#/work/work-1'));
  if (duringInitial) await duringInitial(page);
  if (gatePage) return {page,requests};
  await expect(page.getByRole('heading', { name: anonymous ? 'Connect to your Core' : 'Recovery Work', exact: true })).toBeVisible();
  if (!anonymous && waitForInitialWork) await expect.poll(() => api(page, `
    const work = adapter.getWork('work-1');
    if (!work || ['services', 'configuration', 'packages'].some(key => !work.resourceChecked?.[key] && !work.resourceErrors?.[key]) || Object.values(work.resourceLoading || {}).some(Boolean)) return false;
    if (['Ready', 'Degraded'].includes(work.status)) {
      const models = adapter.models.get(work.id), session = work.sessions[0];
      if (!work.resourceChecked?.agent || !models || models.loading || session && (!session.checkedAt && !session.error || session.loading)) return false;
    }
    return true;
  `)).toBe(true);
  return { page, requests };
}
test('unconfirmed session uses a neutral startup shell until its real state arrives', async t => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    await fixture(t, async r => { if (r.path === 'session') await gate; }, true, true, async page => {
      await expect(page.locator('.app-loading')).toContainText('Opening Piwork');
      await expect(page.getByRole('heading', { name: 'Connect to your Core' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Works', exact: true })).toHaveCount(0);
      release();
    });
  } finally { release(); }
});
test('default Core saving stays in its button without moving the sign-in fields', async t => {
  const { page } = await fixture(t, () => undefined, true);
  await api(page, "Object.assign(adapter.preferences,{phase:'idle',reading:false,error:'',notice:''}); adapter.emit()");
  const save = button(page, 'save-default-core'), account = page.locator('#auth-account');
  const before = await save.boundingBox(), accountBefore = await account.boundingBox();
  await api(page, "Object.assign(adapter.preferences,{phase:'saving',reading:false,error:'',notice:''}); adapter.emit()");
  await expect(save).toHaveAttribute('aria-busy', 'true'); await expect(save.locator('.pending-dots')).toHaveCount(1);
  assert.deepEqual(await save.boundingBox(), before); assert.deepEqual(await account.boundingBox(), accountBefore);
  await api(page, "Object.assign(adapter.preferences,{phase:'idle',reading:false}); adapter.emit()");
  assert.deepEqual(await save.boundingBox(), before); assert.deepEqual(await account.boundingBox(), accountBefore);
});
test('Core check retains the Works connection trigger geometry during a delayed read', async t => {
  const gate = deferred(); t.after(() => gate.resolve()); let armed = false;
  const { page } = await fixture(t, async r => { if (armed && r.path === 'status') await gate.promise; });
  await button(page, 'back-works').click(); const connection = button(page, 'connection');
  const before = await connection.boundingBox(); await connection.click(); armed = true; await button(page, 'check-connection').click();
  await expect(connection).toHaveAttribute('aria-busy', 'true'); assert.deepEqual(await connection.boundingBox(), before);
  gate.resolve(); await expect(connection).not.toHaveAttribute('aria-busy', 'true'); assert.deepEqual(await connection.boundingBox(), before);
});
const api = (page: Page, code: string): Promise<any> => page.evaluate(`(async () => { const { adapter } = await import('/desktop/browser/adapter.js'); ${code} })()`);
const button = (page: Page, action: string) => page.locator(`[data-action="${action}"]`).last();
function listing(body: string, modified: string) { return `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/_desktop/files/works/work-1/files/note.txt</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>${Buffer.byteLength(body)}</d:getcontentlength><d:getlastmodified>${modified}</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`; }

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

test('standalone account menu retains Core and browser controls without hosted management links',async t=>{
 const {page}=await fixture(t,()=>undefined);
 await button(page,'back-works').click();await button(page,'account').click();const menu=page.getByRole('menu');
 for(const name of ['About Piwork','Switch Core','Sign out'])await expect(menu.getByRole('menuitem',{name,exact:true})).toBeVisible();
 await expect(menu.getByRole('menuitem',{name:'Known operations',exact:true})).toHaveCount(0);
 await expect(menu.getByRole('menuitem',{name:'Reset browser access',exact:true})).toHaveCount(0);
 for(const name of ['Administration','Quick setup'])await expect(menu.getByRole('menuitem',{name,exact:true})).toHaveCount(0);
 await page.keyboard.press('End');await expect(menu.getByRole('menuitem',{name:'Sign out',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(button(page,'account')).toBeFocused();
});

for (const hosted of [false, true]) for (const role of ['user', 'admin']) test(`DWUI-OPREC-001 ${hosted ? 'hosted' : 'standalone'} ${role} account has no global tasks entry`, async t => {
  const { page } = await fixture(t, () => undefined);
  await api(page, `adapter.hosted=${hosted}; adapter.state.core.role=${JSON.stringify(role)}; adapter.emit()`);
  await button(page, 'back-works').click(); await button(page, 'account').click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Known operations', exact: true })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'About Piwork', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Sign out', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Administration', exact: true })).toHaveCount(hosted && role === 'admin' ? 1 : 0);
  await expect(menu.getByRole('menuitem', { name: 'Switch Core', exact: true })).toHaveCount(hosted ? 0 : 1);
});

for(const method of ['picker','paste','drop','stop-and-send'])test(`Chat images: ${method} adds without side effects and sends a pure image`,async t=>{
 const bytes=await readFile(new URL('../../../../fixtures/chat-images/png.png',import.meta.url));
 let accepted=false,submitted:any;
 const {page,requests}=await fixture(t,r=>{
  if(method==='stop-and-send' && r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:0,cancelAndSendContractVersion:1}};
  if(method==='stop-and-send' && r.path.endsWith('/runs/active'))return{json:{run:{runId:'old-image-run',workId:'work-1',sessionId:'another-session',state:2}}};
  if(r.path.endsWith('/chat-image-capabilities'))return {json:{profile:'chat-images-v1',defaultModel:{modelRef:null,availability:'supported'},models:[]}};
  if(r.path==='works/work-1/runs' && r.method==='POST'){submitted=JSON.parse(r.body);accepted=true;return {json:{run:{workId:'work-1',sessionId:'session-1',runId:'run-images',submissionKey:submitted.submissionKey,state:4,finalText:'Seen'}}};}
  if(r.path==='works/work-1/runs/run-images')return {json:{run:{workId:'work-1',sessionId:'session-1',runId:'run-images',submissionKey:submitted?.submissionKey,state:4,finalText:'Seen'}}};
  if(r.path.endsWith('/sessions/session-1') && accepted)return {json:{session:{workId:'work-1',sessionId:'session-1'},messages:[{entryId:'accepted',role:'user',runId:'run-images',blocks:[{blockId:'image',type:'image',image:{imageIndex:0,mimeType:'image/png',byteSize:bytes.length,sha256:'unused'}}]}],runs:[]}};
 });
 await page.locator('#composer').waitFor();const before=requests.filter(r=>r.method==='POST').length;
 if(method==='picker'||method==='stop-and-send')await page.locator('#chat-image-input').setInputFiles({name:'image.png',mimeType:'image/png',buffer:bytes});
 else await page.evaluate(({data,method})=>{const file=new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],'image.png',{type:'image/png'}),transfer=new DataTransfer();transfer.items.add(file);if(method==='paste')document.querySelector('#composer')!.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));else document.querySelector('.composer')!.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));},{data:bytes.toString('base64'),method});
 await expect(page.locator('.chat-image-draft')).toHaveCount(1);await expect(page.locator('.chat-image-drafts')).not.toContainText('Checking');
 await expect(page.locator('#app')).not.toContainText('This configuration file is not valid UTF-8');
 assert.equal(requests.filter(r=>r.method==='POST').length,before);
 await button(page,'send-message').click();await expect.poll(()=>submitted?.images?.length).toBe(1);
 if(method==='stop-and-send')assert.equal(submitted.cancelRunId,'old-image-run');
 assert.equal(submitted.prompt,'');assert.equal(submitted.inputMode,'text');assert.equal(submitted.images[0].data,bytes.toString('base64'));
 await expect(page.locator('.chat-image-draft')).toHaveCount(0);assert.equal(requests.filter(r=>r.path==='works/work-1/runs' && r.method==='POST').length,1);
});

test('a pending picked image follows automatic initial Session discovery and finishes checking',async t=>{
 const sessions=deferred();t.after(()=>sessions.resolve());const bytes=await readFile(new URL('../../../../fixtures/chat-images/png.png',import.meta.url));let submitted:any;
 const {page,requests}=await fixture(t,async r=>{
  if(r.path==='works/work-1/sessions'){await sessions.promise;return {json:{sessions:[{sessionId:'session-1'}]}};}
  if(r.path.endsWith('/chat-image-capabilities'))return {json:{profile:'chat-images-v1',defaultModel:{modelRef:null,availability:'supported'},models:[]}};
  if(r.path==='works/work-1/runs'&&r.method==='POST'){submitted=JSON.parse(r.body);return {json:{run:{workId:'work-1',sessionId:'session-1',runId:'run-discovered',submissionKey:submitted.submissionKey,state:4}}};}
 }, false, false);
 await page.evaluate(()=>{const original=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(){const file=this;return new Promise<ArrayBuffer>(resolve=>{(window as any).releaseImageRead=()=>{File.prototype.arrayBuffer=original;resolve(original.call(file));};});};});
 await page.locator('#chat-image-input').setInputFiles({name:'early.png',mimeType:'image/png',buffer:bytes});await expect(page.locator('.chat-image-draft')).toContainText('Checking');await expect(page.locator('.chat-image-draft .pending-dots')).toHaveCount(1);sessions.resolve();await expect(page.locator('.messages')).toContainText('original prompt');await page.evaluate(()=>(window as any).releaseImageRead());await expect(page.locator('.chat-image-drafts')).not.toContainText('Checking');await expect(page.locator('.chat-image-draft .pending-dots')).toHaveCount(0);await button(page,'send-message').click();await expect.poll(()=>submitted?.sessionId).toBe('session-1');assert.equal(requests.filter(r=>r.path==='works/work-1/sessions'&&r.method==='POST').length,0);
});

test('Create Work geometry stays stable during delayed feedback on a narrow viewport',async t=>{
 const gate=deferred();t.after(()=>gate.resolve());
 const {page,requests}=await fixture(t,async r=>{if(r.path==='works'&&r.method==='POST'){await gate.promise;return {status:400,json:{code:'INVALID_REQUEST',message:'A long rejected creation message '.repeat(30)}};}});
 await page.setViewportSize({width:360,height:800});await button(page,'back-works').click();await button(page,'new-work').first().click();await page.locator('#create-name').fill('Long work name '.repeat(7));
 const before=await button(page,'create-work').boundingBox();await button(page,'create-work').click();await expect(button(page,'create-work').locator('[role="status"]')).toContainText('Creating Work');
 const waiting=await button(page,'create-work').boundingBox();for(const key of ['x','y','width','height'] as const)assert.ok(Math.abs(before![key]-waiting![key])<=1,`${key} moved`);
 await expect(button(page,'create-work').locator('[role="status"]')).toContainText('Still waiting',{timeout:12000});const longWait=await button(page,'create-work').boundingBox();for(const key of ['x','y','width','height'] as const)assert.ok(Math.abs(before![key]-longWait![key])<=1,`${key} moved on long wait`);
 gate.resolve();await expect(button(page,'create-work')).toBeEnabled();const failed=await button(page,'create-work').boundingBox();for(const key of ['x','y','width','height'] as const)assert.ok(Math.abs(before![key]-failed![key])<=1,`${key} moved on error`);
 assert.equal(requests.filter(r=>r.path==='works'&&r.method==='POST').length,1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
});

for (const width of [1440, 360]) for (const locale of ['en', 'zh-CN']) for (const reducedMotion of ['no-preference', 'reduce'] as const) test(`Create Work pending keeps buttons fixed at ${width}px ${locale} ${reducedMotion}`, async t => {
 const gate=deferred();t.after(()=>gate.resolve());
 const {page}=await fixture(t,async r=>{if(r.path==='works'&&r.method==='POST'){await gate.promise;return {status:400,json:{code:'INVALID_REQUEST'}};}});
 await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion});
 await page.evaluate(`import('/desktop/browser/locale.js').then(m => m.chooseLocale('${locale}'))`);
 await button(page,'back-works').click();await button(page,'new-work').click();await page.locator('#create-name').fill('Synthetic');
 const submit=button(page,'create-work'),cancel=page.locator('#modal .modal-footer [data-action="close-modal"]').first();
 const before=await submit.boundingBox(),neighbor=await cancel.boundingBox();await submit.click();await expect(submit.locator('.pending-dots')).toHaveCount(1);
 assert.deepEqual(await submit.boundingBox(),before);assert.deepEqual(await cancel.boundingBox(),neighbor);
 if(reducedMotion==='reduce')assert.equal(await submit.locator('.pending-dots i').first().evaluate(el=>getComputedStyle(el).animationName),'none');
 gate.resolve();await expect(submit).toBeEnabled();
});

for (const width of [1440, 360]) for (const locale of ['en', 'zh-CN']) for (const reducedMotion of ['no-preference', 'reduce'] as const) test(`workspace refresh controls keep geometry at ${width}px ${locale} ${reducedMotion}`, async t => {
 let held = '', gate = deferred(); t.after(() => gate.resolve());
 const {page}=await fixture(t,async r=>{
   if(held && (held === 'files' ? r.method === 'PROPFIND' : held === 'sessions' ? r.path.endsWith('/sessions') && r.method === 'GET' : r.path === held)) await gate.promise;
   if(r.method === 'PROPFIND') return {status:207,body:listing('original',mtime1)};
   if(r.path.endsWith('/services')) return {json:{services:[{serviceId:'tool',name:'Tool',enabled:true,observedState:'ready',access:{ports:[]}}]}};
   if(r.path.includes('/logs')) return {json:{text:'fixture log',status:'collected'}};
   if(r.path.endsWith('/agent-requests')) return {json:{items:[],checkedAt:'2026-10-28T00:00:00Z'}};
 });
 await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion});await page.evaluate(`import('/desktop/browser/locale.js').then(m => m.chooseLocale('${locale}'))`);
 await button(page,'tab-Files').click();await expect(page.locator('.file-row')).toHaveCount(1);
 let trigger=button(page,'refresh-files');let before=await trigger.boundingBox();let neighbor=await page.locator('.file-row').first().boundingBox();held='files';gate=deferred();await trigger.click();await expect(trigger).toHaveAttribute('aria-busy','true');assert.deepEqual(await trigger.boundingBox(),before);assert.deepEqual(await page.locator('.file-row').first().boundingBox(),neighbor);gate.resolve();held='';await expect(trigger).not.toHaveAttribute('aria-busy','true');assert.deepEqual(await trigger.boundingBox(),before);
 await button(page,'settings').click();trigger=button(page,'check-catalog');before=await trigger.boundingBox();held='skills';gate=deferred();await trigger.click();await expect(trigger).toHaveAttribute('aria-busy','true');assert.deepEqual(await trigger.boundingBox(),before);gate.resolve();held='';await expect(trigger).not.toHaveAttribute('aria-busy','true');assert.deepEqual(await trigger.boundingBox(),before);
 await button(page,'back-work').click();await button(page,'tab-Services').click();await button(page,'manage-services').click();await button(page,'service-details').click();trigger=button(page,'refresh-logs');before=await trigger.boundingBox();held='works/work-1/services/tool/logs';gate=deferred();await trigger.click();await expect(trigger).toHaveAttribute('aria-busy','true');assert.deepEqual(await trigger.boundingBox(),before);gate.resolve();held='';await expect(trigger).not.toHaveAttribute('aria-busy','true');assert.deepEqual(await trigger.boundingBox(),before);await button(page,'close-modal').click();
 await button(page,'tab-Chat').click();await page.locator('#composer').fill('retained draft');trigger=button(page,'sessions');before=await trigger.boundingBox();held='sessions';gate=deferred();await trigger.click();await expect(page.locator('#modal .session-list')).toHaveAttribute('aria-busy','true');assert.deepEqual(await trigger.boundingBox(),before);gate.resolve();held='';await expect(page.locator('#modal .session-list')).toHaveAttribute('aria-busy','false');assert.deepEqual(await trigger.boundingBox(),before);await page.keyboard.press('Escape');await expect(page.locator('#composer')).toHaveValue('retained draft');
 await button(page,'pi-requests').click();await expect(page.locator('#modal .request-list')).toBeVisible();trigger=button(page,'pi-requests');before=await trigger.boundingBox();held='works/work-1/agent-requests';gate=deferred();await trigger.click();await expect(trigger).toHaveAttribute('aria-busy','true');assert.deepEqual(await trigger.boundingBox(),before);gate.resolve();held='';await expect(trigger).not.toHaveAttribute('aria-busy','true');assert.deepEqual(await trigger.boundingBox(),before);await page.keyboard.press('Escape');
 await button(page,'back-works').click();trigger=button(page,'retry-works');before=await trigger.boundingBox();neighbor=await page.locator('.work-row').first().boundingBox();held='works';gate=deferred();await trigger.click();await expect(trigger).toHaveAttribute('aria-busy','true');assert.deepEqual(await trigger.boundingBox(),before);assert.deepEqual(await page.locator('.work-row').first().boundingBox(),neighbor);gate.resolve();held='';await expect(trigger).not.toHaveAttribute('aria-busy','true');assert.deepEqual(await trigger.boundingBox(),before);
});

test('Advanced Create Work keeps feedback visible and buttons stable when the result is unknown',async t=>{
 const gate=deferred();t.after(()=>gate.resolve());
 const {page,requests}=await fixture(t,async r=>{if(r.path==='works'&&r.method==='POST'){await gate.promise;return {abort:true};}});
 await button(page,'back-works').click();await button(page,'new-work').first().click();await page.locator('#create-name').fill('Advanced creation');await button(page,'toggle-create-advanced').click();await page.locator('#create-agents').fill('Long advanced instructions\n'.repeat(80));
 const before=await button(page,'create-work').boundingBox();await button(page,'create-work').click();await expect(button(page,'create-work').locator('[role="status"]')).toContainText('Creating Work');await expect(button(page,'create-work')).toBeInViewport();gate.resolve();await expect(page.locator('.create-action-status')).toContainText(/unknown|lost|not confirmed/i);
 const after=await button(page,'create-work').boundingBox();for(const key of ['x','y','width','height'] as const)assert.ok(Math.abs(before![key]-after![key])<=1,`${key} moved`);await expect(button(page,'create-work')).toBeDisabled();assert.equal(requests.filter(r=>r.path==='works'&&r.method==='POST').length,1);
});

test('About displays local version while Core is delayed and escapes embedded notes',async t=>{
 const gate=deferred();t.after(()=>gate.resolve());
 const about=(program:string,version:string)=>({aboutApiVersion:1,build:{program,version,commit:'fixture',modified:true,os:'linux',architecture:'amd64'},releaseNotes:{version,title:'Update',sections:[{title:'Fixes',items:['<script>window.notesExecuted=true</script>']}]},releasesUrl:'https://github.com/pphboy/piwork/releases'});
 const {page,requests}=await fixture(t,async r=>{if(r.path==='about')return {json:about('piwork-cli','client-test')};if(r.path==='core-about'){await gate.promise;return {json:about('piwork-core','core-test')};}});
 await button(page,'back-works').click();await button(page,'account').click();await button(page,'about-piwork').click();await expect(page.locator('#modal')).toContainText('client-test');await expect(page.locator('#modal')).not.toContainText('core-test');
 gate.resolve();await expect(page.locator('#modal')).toContainText('core-test');await page.locator('#modal details').first().locator('summary').click();await expect(page.locator('#modal')).toContainText('<script>');assert.equal(await page.evaluate(()=>(window as any).notesExecuted),undefined);
 await expect(page.locator('#modal a').first()).toHaveAttribute('href','https://github.com/pphboy/piwork/releases');assert.equal(requests.filter(r=>r.method==='POST').length,0);
});

test('image mixed batches retain valid files and let the user remove only one',async t=>{
 const png=await readFile(new URL('../../../../fixtures/chat-images/png.png',import.meta.url)),jpg=await readFile(new URL('../../../../fixtures/chat-images/jpeg.jpg',import.meta.url));
 const {page,requests}=await fixture(t,r=>r.path.endsWith('/chat-image-capabilities')?{json:{profile:'chat-images-v1',defaultModel:{modelRef:null,availability:'supported'},models:[]}}:undefined);
 await page.locator('#chat-image-input').setInputFiles([{name:'first.png',mimeType:'image/png',buffer:png},{name:'unsafe.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')},{name:'next.jpg',mimeType:'image/jpeg',buffer:jpg}]);
 await expect(page.locator('.chat-image-draft')).toHaveCount(2);await expect(page.locator('.composer')).toContainText('unsafe.svg');await expect(page.locator('.chat-image-drafts')).not.toContainText('Checking');
 await page.getByRole('button',{name:'Remove first.png',exact:true}).click();await expect(page.locator('.chat-image-draft')).toHaveCount(1);await expect(page.locator('.chat-image-draft')).toContainText('next.jpg');assert.equal(requests.filter(r=>r.method==='POST').length,0);
});

for(const nextCaption of ['new caption','original caption'])test(`image acceptance consumes the original snapshot and preserves a revised ${nextCaption}`,async t=>{
 const gate=deferred();t.after(()=>gate.resolve());const png=await readFile(new URL('../../../../fixtures/chat-images/png.png',import.meta.url)),jpg=await readFile(new URL('../../../../fixtures/chat-images/jpeg.jpg',import.meta.url));let submitted:any;
 const {page,requests}=await fixture(t,async r=>{if(r.path.endsWith('/chat-image-capabilities'))return {json:{profile:'chat-images-v1',defaultModel:{modelRef:null,availability:'supported'},models:[]}};if(r.path==='works/work-1/runs'&&r.method==='POST'){submitted=JSON.parse(r.body);await gate.promise;return {json:{run:{runId:'run-snapshot',workId:'work-1',sessionId:'session-1',submissionKey:submitted.submissionKey,state:4}}};}});
 await page.locator('#chat-image-input').setInputFiles({name:'first.png',mimeType:'image/png',buffer:png});await expect(page.locator('.chat-image-drafts')).not.toContainText('Checking');await page.locator('#composer').fill('original caption');await button(page,'send-message').click();await expect.poll(()=>submitted?.images?.length).toBe(1);
 await expect(page.locator('.message.user').filter({hasText:'original caption'}).locator('.pending-chat-image')).toHaveCount(1);
 await expect(page.locator('.message.user').filter({hasText:'original caption'}).locator('.message-submission')).toHaveAttribute('aria-label','Sending');
 await page.locator('#composer').fill('');await page.locator('#composer').fill(nextCaption);await page.locator('#chat-image-input').setInputFiles({name:'next.jpg',mimeType:'image/jpeg',buffer:jpg});await expect(page.locator('.chat-image-draft')).toHaveCount(2);await expect(page.locator('.chat-image-drafts')).not.toContainText('Checking');gate.resolve();
 await expect(page.locator('.chat-image-draft')).toHaveCount(1);await expect(page.locator('.chat-image-draft')).toContainText('next.jpg');await expect(page.locator('#composer')).toHaveValue(nextCaption);assert.equal(requests.filter(r=>r.path==='works/work-1/runs'&&r.method==='POST').length,1);assert.equal(submitted.images[0].data,png.toString('base64'));
});

test('unknown image acceptance is recovered by the original key and history retries only the binary read',async t=>{
 const bytes=await readFile(new URL('../../../../fixtures/chat-images/png.png',import.meta.url));let submitted:any,failImage=true;const descriptor={mimeType:'image/png',byteSize:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),imageIndex:0};
 const run=()=>({workId:'work-1',sessionId:'session-1',runId:'run-original-image',submissionKey:submitted?.submissionKey,state:4,finalText:'Seen'});
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/chat-image-capabilities'))return {json:{profile:'chat-images-v1',defaultModel:{modelRef:null,availability:'supported'},models:[]}};
  if(r.path==='works/work-1/runs'&&r.method==='POST'){submitted=JSON.parse(r.body);return {abort:true};}
  if(r.path.includes('/runs/submissions/'))return {json:{kind:'run',key:submitted.submissionKey,status:'accepted',run:run()}};
  if(r.path.endsWith('/sessions/session-1')&&submitted)return {json:{session:{workId:'work-1',sessionId:'session-1'},messages:[{entryId:'saved',role:'user',runId:'run-original-image',blocks:[{blockId:'image-0',type:'image',image:descriptor}]}],runs:[run()]}};
  if(r.path.endsWith('/runs/run-original-image'))return {json:run()};
  if(r.path.endsWith('/images/0'))return failImage?{status:503,json:{code:'RUNTIME_UNAVAILABLE',message:'Image temporarily unavailable'}}:{body:bytes,headers:{'Content-Type':'image/png','Content-Length':String(bytes.length)}};
 });
 await page.locator('#chat-image-input').setInputFiles({name:'original.png',mimeType:'image/png',buffer:bytes});await expect(page.locator('.chat-image-drafts')).not.toContainText('Checking');await button(page,'send-message').click();await page.locator('.message-submission.unknown button').click();await expect(button(page,'check-chat-submission')).toBeVisible();await expect(page.locator('.chat-image-draft')).toHaveCount(1);
 await expect(page.locator('.message.user .message-submission button')).toHaveAttribute('aria-label','Message status unconfirmed');
 await expect(page.locator('.message.user .pending-chat-image')).toHaveCount(1);
 await button(page,'check-chat-submission').click();await expect(page.locator('.chat-image-draft')).toHaveCount(0);await expect(button(page,'retry-chat-image')).toBeVisible();failImage=false;await button(page,'retry-chat-image').click();await expect(page.locator('.chat-history-image img')).toBeVisible();await button(page,'preview-chat-image').click();await expect(page.getByRole('heading',{name:'Image preview',exact:true})).toBeVisible();assert.equal(requests.filter(r=>r.path==='works/work-1/runs'&&r.method==='POST').length,1);
});

test('slow image discovery leaves text usable and then upgrades history to image metadata',async t=>{
 const gate=deferred();t.after(()=>gate.resolve());const bytes=await readFile(new URL('../../../../fixtures/chat-images/png.png',import.meta.url)),sha256=createHash('sha256').update(bytes).digest('hex');
 const {page,requests}=await fixture(t,async r=>{
  if(r.path.endsWith('/chat-image-capabilities')){await gate.promise;return {json:{profile:'chat-images-v1',defaultModel:{modelRef:null,availability:'supported'},models:[]}};}
  if(r.path.endsWith('/sessions/session-1'))return {json:{session:{workId:'work-1',sessionId:'session-1'},messages:[{entryId:'old',role:'user',runId:'run-historical',blocks:r.search?.includes('imageProfile=')?[{blockId:'image',type:'image',image:{imageIndex:0,mimeType:'image/png',byteSize:bytes.length,sha256}}]:[{blockId:'text',type:'text',text:'Original caption'}]}],runs:[]}};
  if(r.path.endsWith('/images/0'))return {body:bytes,headers:{'Content-Type':'image/png','Content-Length':String(bytes.length)}};
 });
 await expect(page.locator('.messages')).toContainText('Original caption');await page.locator('#composer').fill('Text is still editable');gate.resolve();await expect(page.locator('.chat-history-image img')).toBeVisible();await expect(page.locator('#composer')).toHaveValue('Text is still editable');assert.equal(requests.filter(r=>r.method==='POST').length,0);
});

test('accepted image cleanup after navigation preserves the new modal and consumes only the original draft',async t=>{
 const gate=deferred();t.after(()=>gate.resolve());const bytes=await readFile(new URL('../../../../fixtures/chat-images/png.png',import.meta.url));let submitted:any;
 const run=()=>({workId:'work-1',sessionId:'session-1',runId:'run-left-view',submissionKey:submitted?.submissionKey,state:4});
 const {page,requests}=await fixture(t,async r=>{if(r.path.endsWith('/chat-image-capabilities'))return {json:{profile:'chat-images-v1',defaultModel:{modelRef:null,availability:'supported'},models:[]}};if(r.path==='works/work-1/runs'&&r.method==='POST'){submitted=JSON.parse(r.body);await gate.promise;return {json:{run:run()}};}if(r.path.endsWith('/runs/run-left-view'))return {json:run()};});
 await page.locator('#chat-image-input').setInputFiles({name:'original.png',mimeType:'image/png',buffer:bytes});await expect(page.locator('.chat-image-drafts')).not.toContainText('Checking');await page.locator('#composer').fill('Original image caption');await button(page,'send-message').click();await expect.poll(()=>submitted?.images?.length).toBe(1);
 await button(page,'back-works').click();await button(page,'new-work').first().click();await page.locator('#create-name').fill('Keep this new form');gate.resolve();await expect.poll(()=>api(page,"return adapter.chatSubmissions.has('work-1');")).toBe(false);await expect(page.locator('#create-name')).toHaveValue('Keep this new form');
 await button(page,'close-modal').click();await page.locator('.work-name[data-action="open-work"][data-id="work-1"]').click();await expect(page.locator('.chat-image-draft')).toHaveCount(0);await expect(page.locator('#composer')).toHaveValue('');assert.equal(requests.filter(r=>r.path==='works/work-1/runs'&&r.method==='POST').length,1);
});

test('DWUI-004 image-only drafts in another Session or Work trigger native beforeunload without uploads or persistence', async t => {
  const bytes = await readFile(new URL('../../../../fixtures/chat-images/png.png', import.meta.url));
  const work = (id: string) => ({ id, name: id === 'work-1' ? 'Recovery Work' : 'Other Work', observedState: 'ready', desiredState: 'running' });
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works') return { json: { works: [work('work-1'), work('work-2')] } };
    if (r.path === 'works/work-2') return { json: work('work-2') };
    if (r.path === 'works/work-2/configuration') return { json: { desired: { skills: [], packages: [], agentsMd: '', mcp: { servers: [] } }, active: {}, pendingApply: false, runtime: { state: 'ready' } } };
    if (r.path.endsWith('/sessions')) return { json: { sessions: [{ sessionId: 'session-1' }, { sessionId: 'session-2' }] } };
    const session = /^works\/(work-[12])\/sessions\/(session-[12])$/.exec(r.path);
    if (session) return { json: { session: { workId: session[1], sessionId: session[2], modelPreference: null, source: { kind: 'chat' } }, messages: [], runs: [] } };
    if (r.path.endsWith('/chat-image-capabilities')) return { json: { profile: 'chat-images-v1', defaultModel: { modelRef: null, availability: 'supported' }, models: [] } };
  });
  const auditPersistence = () => page.evaluate(() => {
    (window as any).draftPersistenceWrites = [];
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key: string, value: string) { (window as any).draftPersistenceWrites.push(key); return setItem.call(this, key, value); };
    const open = indexedDB.open;
    indexedDB.open = function(...args: Parameters<IDBFactory['open']>) { (window as any).draftPersistenceWrites.push(`indexedDB:${args[0]}`); return Reflect.apply(open, this, args); };
  });
  const expectNoPersistence = async () => { assert.deepEqual(await page.evaluate(() => (window as any).draftPersistenceWrites), []); };
  const addImage = async (name: string) => {
    await page.locator('#composer').click(); await expect(page.locator('#composer')).toHaveValue('');
    await page.locator('#chat-image-input').setInputFiles({ name, mimeType: 'image/png', buffer: bytes });
    await expect(page.locator('.chat-image-draft')).toHaveCount(1); await expect(page.locator('.chat-image-drafts')).not.toContainText('Checking');
  };
  const cancelReload = async () => {
    const previous = page.url(), confirmation = page.waitForEvent('dialog', { timeout: 10000 });
    const navigation = page.reload({ waitUntil: 'commit' }).catch(() => null);
    const dialog = await confirmation; assert.equal(dialog.type(), 'beforeunload'); await dialog.dismiss(); await navigation;
    assert.equal(page.url(), previous);
  };
  const cleanReload = async () => {
    const dialogs: string[] = [];
    const onDialog = (dialog: import('@playwright/test').Dialog) => { dialogs.push(dialog.type()); void dialog.accept(); };
    page.on('dialog', onDialog); await page.reload({ waitUntil: 'load' }); page.off('dialog', onDialog);
    assert.deepEqual(dialogs, [], 'no drafts must mean no native leave confirmation');
  };
  await auditPersistence(); await addImage('private-image-draft.png');
  await button(page, 'sessions').click(); await page.locator('[data-action="select-session"][data-id="session-2"]').click();
  await expect(page.locator('.chat-image-draft')).toHaveCount(0); await expect(page.locator('#composer')).toHaveValue('');
  await cancelReload(); await expect(page.locator('#messages')).toHaveAttribute('data-reading-key', /session-2$/);
  await button(page, 'back-works').click(); await page.locator('.work-name[data-id="work-2"]').click();
  await expect(page.getByRole('heading', { name: 'Other Work', exact: true })).toBeVisible(); await expect(page.locator('.chat-image-draft')).toHaveCount(0);
  await page.locator('#composer').click(); await cancelReload(); await expect(page.getByRole('heading', { name: 'Other Work', exact: true })).toBeVisible();
  await button(page, 'back-works').click(); await page.locator('.work-name[data-id="work-1"]').click();
  await button(page, 'sessions').click(); await page.locator('[data-action="select-session"][data-id="session-1"]').click();
  await expect(page.locator('.chat-image-draft')).toContainText('private-image-draft.png'); await expect(page.locator('#composer')).toHaveValue('');
  await page.getByRole('button', { name: 'Remove private-image-draft.png', exact: true }).click(); await expect(page.locator('.chat-image-draft')).toHaveCount(0);
  await expectNoPersistence(); await cleanReload();
  await auditPersistence(); await addImage('identity-private-draft.png');
  await api(page, "await adapter.switchCore('http://other-core.test')"); await expect(page.getByRole('heading', { name: 'Connect to your Core', exact: true })).toBeVisible();
  await expect(page.locator('.chat-image-draft')).toHaveCount(0); await expect(page.locator('#app')).not.toContainText('identity-private-draft.png');
  await page.locator('#auth-core').fill('http://other-core.test'); await page.locator('#auth-account').fill('owner'); await page.locator('#auth-password').fill('synthetic-password'); await button(page, 'sign-in').click();
  await expect(page.getByRole('heading', { name: 'Recovery Work', exact: true })).toBeVisible();
  await button(page, 'back-works').click(); await page.locator('.work-name[data-id="work-1"]').click();
  await expect(page.locator('#composer')).toHaveValue(''); await expect(page.locator('.chat-image-draft')).toHaveCount(0);
  await expectNoPersistence(); await cleanReload(); await expect(page.locator('.chat-image-draft')).toHaveCount(0);
  assert.deepEqual(requests.filter(r => !['GET', 'HEAD', 'PROPFIND'].includes(r.method)).map(r => `${r.method} ${r.path}`), ['PUT connection', 'POST login']);
});

for (const action of ['start', 'retry', 'stop', 'delete', 'create'] as const) test(`D02/D03 ${action}: first paint, duplicate prevention and acceptance before readback`, async t => {
  const submitting = deferred(), refreshing = deferred(); t.after(async () => { submitting.resolve(); refreshing.resolve(); });
  let armed = false, accepted = false;
  const status = action === 'start' ? 'stopped' : action === 'retry' ? 'failed' : 'ready';
  const raw = { id: 'work-1', name: 'Recovery Work', observedState: status, desiredState: status === 'stopped' ? 'stopped' : 'running' };
  const { page, requests } = await fixture(t, async r => {
    if (r.path === 'works' && r.method === 'GET') { if (accepted) await refreshing.promise; return { json: { works: [raw] } }; }
    if (r.path === 'works/work-1') { if (accepted) await refreshing.promise; return { json: raw }; }
    if (r.method === 'POST' && (r.path === `works/work-1/${action}` || action === 'create' && r.path === 'works')) {
      await submitting.promise; accepted = true; return { json: { operationId: `op-${action}`, workId: 'work-1' } };
    }
  });
  if (action === 'create') { await button(page, 'back-works').click(); await button(page, 'new-work').click(); await page.locator('#create-name').fill('New tool'); }
  if (action === 'stop') { await button(page, 'work-menu').click(); await button(page, 'stop-work').click(); }
  if (action === 'delete') { await button(page, 'work-menu').click(); await button(page, 'delete-work').click(); await page.locator('#delete-confirm').check(); }
  armed = true;
  const trigger = action === 'create' ? 'create-work' : action === 'stop' ? 'confirm-stop' : action === 'delete' ? 'confirm-delete' : 'start-work';
  const tabsBefore = ['start','retry'].includes(action) ? await page.locator('.work-tabs').boundingBox() : null;
  await button(page, trigger).click();
  await expect(button(page, trigger).locator('[role="status"]')).toContainText(action === 'create' ? 'Creating' : action === 'stop' ? 'Stopping' : action === 'delete' ? 'Deleting' : 'Starting');
  if (tabsBefore) assert.deepEqual(await page.locator('.work-tabs').boundingBox(), tabsBefore);
  if (action === 'start' || action === 'retry') await expect(page.locator('[data-action="start-work"] .pending-dots')).toHaveCount(1);
  await expect(button(page, trigger)).toBeDisabled();
  await page.evaluate(action => document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.click(), trigger);
  assert.equal(requests.filter(r => r.method === 'POST' && (r.path.includes(`/${action}`) || action === 'create' && r.path === 'works')).length, 1);
  submitting.resolve();
  if (action === 'start' || action === 'retry') {
    // Accepted is visible in the object's existing status slot; the original
    // Operation ID is reachable on demand from that Work's own menu.
    await expect(page.locator('.object-control-state')).toContainText(action === 'retry' ? 'Retry Work' : 'Start Work');
    await expect(page.locator('.object-control-progress')).toHaveCount(0);
    await expect(page.locator('#modal')).toHaveCount(0);
  } else { await expect(page.locator('#modal')).toContainText(`op-${action}`); await expect(page.getByRole('button', { name: 'Close dialog' })).toBeEnabled(); }
  assert.equal(armed, true); refreshing.resolve();
});

test('D14 configuration confirms before failed refresh and preserves newer edits', async t => {
  const save = deferred(), readback = deferred(); t.after(async () => { save.resolve(); readback.resolve(); });
  let submitted = false;
  const { page, requests } = await fixture(t, async r => {
    if (r.path === 'works/work-1/configuration' && r.method === 'PUT') { await save.promise; submitted = true; return { json: {} }; }
    if (r.path === 'works/work-1/configuration' && submitted) { await readback.promise; return { status: 503, json: { message: 'readback offline' } }; }
  });
  await button(page, 'work-menu').click(); await page.locator('#modal [data-action="settings"]').click();
  await page.locator('[data-action="settings-section"][data-tab="AGENTS.md"]').click();
  await page.locator('#agents-editor').fill('submitted'); await button(page, 'save-config').click();
  await expect(button(page, 'save-config').locator('[role="status"]')).toContainText('Saving settings');
  await expect(page.locator('[data-action="save-config"] .pending-dots')).toHaveCount(1);
  await page.locator('#agents-editor').fill('newer unsaved draft'); save.resolve();
  await expect(page.locator('[data-action-status]').filter({hasText:'Settings saved'})).toBeVisible();
  await expect(page.locator('#agents-editor')).toHaveValue('newer unsaved draft');
  readback.resolve(); await expect(page.locator('[data-action-status]').filter({hasText:'refresh not confirmed'})).toBeVisible();
  assert.equal(requests.filter(r => r.method === 'PUT').length, 1);
});

test('D19 close preserves one automatic original download and a manual same-transfer fallback', async t => {
  const preparation = deferred(); t.after(async () => preparation.resolve());
  const bytes = Buffer.alloc(1000, 'p'), digest = createHash('sha256').update(bytes).digest('hex');
  let id = '', ready = false, reads = 0, downloadEvents = 0;
  const metadata = { snapshotId: 'snap-1', operationId: 'op-export', workId: 'work-1', state: 'succeeded', size: bytes.length, digest, expiresAt: '2099-01-01T00:00:00Z' };
  const transfer = () => ({ transferId: id, workId: 'work-1', snapshotId: 'snap-1', size: bytes.length, digest, ready });
  const { page, requests } = await fixture(t, async r => {
    if (r.path === 'works' || r.path === 'works/work-1') { const work = { id: 'work-1', name: 'Recovery Work', observedState: 'stopped', desiredState: 'stopped' }; return { json: r.path === 'works' ? { works: [work] } : work }; }
    if (r.path === 'work-snapshots/snap-1') return { json: metadata };
    if (r.path === 'operations/op-export') return { json: { operationId: 'op-export', workId: 'work-1', type: 'export_work', state: 'succeeded', result: { snapshotId: 'snap-1' } } };
    if (r.path === 'work-snapshots/snap-1/downloads' && r.method === 'POST') { id = r.headers['x-piwork-transfer-id']!; await preparation.promise; ready = true; return { json: transfer() }; }
    if (id && r.path === `downloads/${id}/content`) return { body: bytes, headers: { 'content-type': 'application/vnd.piwork.work-package', 'content-disposition': 'attachment; filename="original.work"' } };
    if (id && r.path === `downloads/${id}`) { reads++; return { json: { transferId: id, kind: 'download', phase: ready ? 'ready' : 'downloading', transferred: ready ? bytes.length : 400, total: bytes.length, ...(ready ? transfer() : {}) } }; }
  });
  page.on('download', () => { downloadEvents++; });
  await findPreviousExport(page);
  await page.locator('#snapshot-query').fill('snap-1'); await button(page, 'lookup-snapshot').click();
  await expect(page.locator('.export-snapshot')).toContainText('snap-1');
  await button(page, 'download-work').click(); await exportDetails(page);
  await expect(page.locator('#modal')).toContainText('400 / 1000 bytes'); assert.ok(reads > 0);
  assert.equal(downloadEvents, 0); assert.equal(requests.filter(r => r.path.endsWith('/content')).length, 0);
  await expect(button(page, 'close-modal')).toBeEnabled(); await button(page, 'close-modal').click();
  if (await button(page, 'back-works').count()) await button(page, 'back-works').click();
  const automaticDownload = page.waitForEvent('download'); preparation.resolve();
  const download = await automaticDownload;
  assert.equal(download.url(), `${base}/_desktop/api/downloads/${id}/content`);
  assert.equal(await download.failure(), null); assert.deepEqual(await readFile((await download.path())!), bytes); assert.equal(createHash('sha256').update(await readFile((await download.path())!)).digest('hex'), digest); assert.equal(download.suggestedFilename(), 'original.work');
  await expect(page.locator('#modal')).toHaveCount(0);
  await expect(page.locator('.works-page')).toBeVisible();
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(downloadEvents, 1);
  assert.deepEqual(requests.filter(r => r.method === 'POST').map(r => r.path), ['work-snapshots/snap-1/downloads']);
  assert.deepEqual(requests.filter(r => r.path.endsWith('/content')).map(r => r.path), [`downloads/${id}/content`]);
  await findPreviousExport(page); await page.locator('#snapshot-query').fill('snap-1'); await button(page, 'lookup-snapshot').click();
  await exportDetails(page); await button(page, 'check-download').click(); await expect(button(page, 'save-export-file')).toBeEnabled();
  assert.equal(downloadEvents, 1, 'reopening and checking the original transfer must not auto-download again');
  const manualDownload = page.waitForEvent('download'); await button(page, 'save-export-file').click();
  const again = await manualDownload;
  assert.equal(again.url(), download.url()); assert.equal(await again.failure(), null);
  assert.deepEqual(await readFile((await again.path())!), bytes); assert.equal(createHash('sha256').update(await readFile((await again.path())!)).digest('hex'), digest);
  assert.equal(downloadEvents, 2);
  assert.deepEqual(requests.filter(r => r.method === 'POST').map(r => r.path), ['work-snapshots/snap-1/downloads']);
  assert.deepEqual(requests.filter(r => r.path.endsWith('/content')).map(r => r.path), [`downloads/${id}/content`, `downloads/${id}/content`]);
});

test('DWUI-OPREC-001 paused Export recovers interrupted transfer observation without another submission', async t => {
  const preparation = deferred(); t.after(async () => preparation.resolve());
  const bytes = Buffer.from('same original package'), digest = createHash('sha256').update(bytes).digest('hex');
  const snapshot = { snapshotId: 'snap-paused', operationId: 'op-export-paused', workId: 'work-1', state: 'succeeded', size: bytes.length, digest, expiresAt: '2099-01-01T00:00:00Z' };
  let transferId = '', ready = false, offline = true, downloads = 0;
  const transfer = () => ({ transferId, workId: 'work-1', snapshotId: 'snap-paused', size: bytes.length, digest, ready });
  const { page, requests } = await fixture(t, async r => {
    if (r.path === 'work-snapshots/snap-paused') return { json: snapshot };
    if (r.path === 'operations/op-export-paused') return { json: { operationId: 'op-export-paused', workId: 'work-1', kind: 'export-work', state: 'succeeded', result: { snapshotId: 'snap-paused' } } };
    if (r.path === 'work-snapshots/snap-paused/downloads' && r.method === 'POST') { transferId = r.headers['x-piwork-transfer-id']!; await preparation.promise; ready = true; return { json: transfer() }; }
    if (transferId && r.path === `downloads/${transferId}`) return offline ? { status: 503, json: { message: 'Transfer status interrupted' } } : { json: { ...transfer(), kind: 'download', phase: ready ? 'ready' : 'downloading', transferred: ready ? bytes.length : 1, total: bytes.length } };
    if (transferId && r.path === `downloads/${transferId}/content`) return { body: bytes, headers: { 'content-type': 'application/vnd.piwork.work-package', 'content-disposition': 'attachment; filename="paused.work"' } };
  });
  page.on('download', () => { downloads++; });
  await findPreviousExport(page); await page.locator('#snapshot-query').fill('snap-paused'); await button(page, 'lookup-snapshot').click();
  await button(page, 'download-work').click(); await exportDetails(page);
  await expect(button(page, 'pause-export-flow')).toBeVisible(); await button(page, 'pause-export-flow').click();
  await button(page, 'check-download').click(); await expect(page.locator('#modal')).toContainText('Transfer status interrupted');
  offline = false; await button(page, 'check-download').click(); await expect(button(page, 'resume-export-flow')).toBeVisible();
  preparation.resolve(); await expect.poll(() => api(page, "return adapter.downloads.get('snap-paused')?.ready")).toBe(true);
  assert.equal(downloads, 0);
  const completed = page.waitForEvent('download'); await button(page, 'resume-export-flow').click();
  assert.deepEqual(await readFile((await (await completed).path())!), bytes);
  assert.equal(downloads, 1);
  assert.deepEqual(requests.filter(r => r.method === 'POST').map(r => r.path), ['work-snapshots/snap-paused/downloads']);
});

test('stopped Export delivers current content once despite a known old snapshot, and exact old selection stays old', async t => {
  const packages: Record<string, Buffer> = { 'snap-old': Buffer.from('old snapshot bytes'), 'snap-new': Buffer.from('current snapshot bytes') };
  const transfers = new Map<string, string>(); let downloadEvents = 0;
  const metadata = (id: string) => ({ snapshotId: id, operationId: `op-${id}`, workId: 'work-1', state: 'succeeded', size: packages[id]!.length, digest: createHash('sha256').update(packages[id]!).digest('hex'), expiresAt: '2099-01-01T00:00:00Z' });
  const ready = (snapshotId: string, transferId: string) => { const value = metadata(snapshotId); return { transferId, workId: value.workId, snapshotId, size: value.size, digest: value.digest, ready: true }; };
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works' || r.path === 'works/work-1') { const work = { id: 'work-1', name: 'Recovery Work', observedState: 'stopped', desiredState: 'stopped' }; return { json: r.path === 'works' ? { works: [work] } : work }; }
    if (r.path === 'works/work-1/exports' && r.method === 'POST') return { json: { workId: 'work-1', operationId: 'op-snap-new', snapshotId: 'snap-new' } };
    for (const snapshotId of Object.keys(packages)) {
      if (r.path === `work-snapshots/${snapshotId}`) return { json: metadata(snapshotId) };
      if (r.path === `operations/op-${snapshotId}`) return { json: { operationId: `op-${snapshotId}`, workId: 'work-1', type: 'export_work', state: 'succeeded', result: { snapshotId } } };
      if (r.path === `work-snapshots/${snapshotId}/downloads` && r.method === 'POST') { const transferId = r.headers['x-piwork-transfer-id']!; transfers.set(snapshotId, transferId); return { json: ready(snapshotId, transferId) }; }
      const transferId = transfers.get(snapshotId);
      if (transferId && r.path === `downloads/${transferId}`) return { json: { ...ready(snapshotId, transferId), kind: 'download', phase: 'ready', transferred: packages[snapshotId]!.length, total: packages[snapshotId]!.length } };
      if (transferId && r.path === `downloads/${transferId}/content`) return { body: packages[snapshotId], headers: { 'content-type': 'application/vnd.piwork.work-package', 'content-disposition': `attachment; filename="${snapshotId}.work"` } };
    }
  });
  page.on('download', () => { downloadEvents++; });
  await findPreviousExport(page);
  await page.locator('#snapshot-query').fill('snap-old'); await button(page, 'lookup-snapshot').click();
  await expect(page.locator('.export-snapshot')).toContainText('snap-old');
  assert.equal(requests.filter(r => r.method === 'POST').length, 0, 'looking up an old snapshot must be read-only');
  await button(page, 'close-modal').click(); await button(page, 'work-menu').click();
  const currentDownload = page.waitForEvent('download'); await button(page, 'export').click();
  const current = await currentDownload;
  assert.equal(await current.failure(), null); assert.deepEqual(await readFile((await current.path())!), packages['snap-new']);
  assert.equal(current.url(), `${base}/_desktop/api/downloads/${transfers.get('snap-new')}/content`);
  assert.equal(current.suggestedFilename(), 'snap-new.work'); assert.equal(createHash('sha256').update(await readFile((await current.path())!)).digest('hex'), metadata('snap-new').digest);
  await expect(page.locator('.export-snapshot')).toContainText('snap-new');
  await expect(page.locator('.export-snapshot')).not.toContainText('snap-old');
  await expect(button(page, 'prepare-export')).toHaveCount(0);
  await exportDetails(page);
  await expect(button(page, 'save-export-file')).toHaveText('Download again');
  await button(page, 'check-download').click(); assert.equal(downloadEvents, 1);
  await page.locator('[data-action="view-snapshot"][data-id="snap-old"]').click();
  await expect(page.locator('.export-snapshot')).toContainText('snap-old');
  await expect(page.locator('.export-snapshot')).not.toContainText('snap-new');
  assert.equal(downloadEvents, 1, 'selecting an existing snapshot must not start a new delivery');
  const oldDownload = page.waitForEvent('download'); await button(page, 'download-work').click();
  const old = await oldDownload;
  assert.equal(await old.failure(), null); assert.deepEqual(await readFile((await old.path())!), packages['snap-old']);
  assert.equal(old.url(), `${base}/_desktop/api/downloads/${transfers.get('snap-old')}/content`);
  assert.equal(old.suggestedFilename(), 'snap-old.work'); assert.equal(createHash('sha256').update(await readFile((await old.path())!)).digest('hex'), metadata('snap-old').digest);
  assert.notEqual(transfers.get('snap-old'), transfers.get('snap-new')); assert.equal(downloadEvents, 2);
  assert.deepEqual(requests.filter(r => r.method === 'POST').map(r => r.path), ['works/work-1/exports', 'work-snapshots/snap-new/downloads', 'work-snapshots/snap-old/downloads']);
  assert.deepEqual(requests.filter(r => r.path.endsWith('/content')).map(r => r.path), [`downloads/${transfers.get('snap-new')}/content`, `downloads/${transfers.get('snap-old')}/content`]);
});

for (const race of ['close-switch-work', 'lost-preparation', 'ready-before-post'] as const) test(`D19 export relay ${race} delivers the original package exactly once across late reads`, async t => {
  const preparation = deferred(); t.after(async () => preparation.resolve());
  const bytes = Buffer.from(`verified original package for ${race}`), digest = createHash('sha256').update(bytes).digest('hex');
  const snapshotId = 'snap-current-race', oldSnapshotId = 'snap-older-race', operationId = 'export-original-race';
  let transferId = '', ready = false, downloadEvents = 0, observationFailure = race === 'lost-preparation';
  const snapshotResponses: string[] = [];
  const stopped = { id: 'work-1', name: 'Recovery Work', observedState: 'stopped', desiredState: 'stopped' };
  const other = { id: 'work-2', name: 'Other Work', observedState: 'stopped', desiredState: 'stopped' };
  const packageMetadata = (id: string) => ({ snapshotId: id, operationId: id === snapshotId ? operationId : 'export-older-race', workId: 'work-1', state: 'succeeded', size: bytes.length, digest, expiresAt: '2099-01-01T00:00:00Z' });
  const transfer = () => ({ transferId, snapshotId, workId: 'work-1', size: bytes.length, digest, ready: true });
  const { page, requests } = await fixture(t, async r => {
    if (r.path === 'works') return { json: { works: [stopped, other] } };
    if (r.path === 'works/work-1') return { json: stopped };
    if (r.path === 'works/work-2') return { json: other };
    if (r.path === 'works/work-1/exports' && r.method === 'POST') return { json: { workId: 'work-1', operationId, snapshotId } };
    if (r.path === `operations/${operationId}`) return { json: { operationId, workId: 'work-1', kind: 'export-work', state: 'succeeded', result: { snapshotId } } };
    if (r.path === `work-snapshots/${snapshotId}` || r.path === `work-snapshots/${oldSnapshotId}`) return { json: packageMetadata(r.path.split('/')[1]!) };
    if (r.path === `work-snapshots/${snapshotId}/downloads` && r.method === 'POST') {
      transferId = r.headers['x-piwork-transfer-id']!;
      if (race === 'lost-preparation') return { abort: true };
      await preparation.promise; return { json: transfer() };
    }
    if (transferId && r.path === `downloads/${transferId}`) return observationFailure ? { status: 503, json: { message: 'Original transfer observation unavailable' } } : { json: { transferId, kind: 'download', phase: ready ? 'ready' : 'downloading', transferred: ready ? bytes.length : 1, total: bytes.length, ...(ready ? transfer() : {}) } };
    if (transferId && r.path === `downloads/${transferId}/content`) return { body: bytes, headers: { 'content-type': 'application/vnd.piwork.work-package', 'content-disposition': 'attachment; filename="original-race.work"', 'content-length': String(bytes.length) } };
  });
  page.on('download', () => { downloadEvents++; });
  page.on('response', response => { const match = /^\/_desktop\/api\/work-snapshots\/([^/]+)$/.exec(new URL(response.url()).pathname); if (match) snapshotResponses.push(match[1]!); });
  if (race !== 'ready-before-post') await api(page, `await adapter.fetchSnapshot('${oldSnapshotId}')`);
  await button(page, 'work-menu').click(); await button(page, 'export').click(); await exportDetails(page);
  await expect.poll(() => transferId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.locator('.export-snapshot')).toContainText(snapshotId);
  if (race === 'ready-before-post') await api(page, `await adapter.fetchSnapshot('${oldSnapshotId}')`);
  // Assert actual browser response arrival, not the adapter's presentation order:
  // accepted Export may prepend its snapshot even when old metadata arrived first.
  assert.ok(snapshotResponses.includes(snapshotId)); assert.ok(snapshotResponses.includes(oldSnapshotId));
  assert.equal(snapshotResponses.indexOf(oldSnapshotId) < snapshotResponses.indexOf(snapshotId), race !== 'ready-before-post');
  assert.deepEqual(new Set(await api(page, "return adapter.state.snapshots.map(snapshot => snapshot.id)")), new Set([snapshotId, oldSnapshotId]));
  await expect(page.locator('.export-snapshot')).toContainText(snapshotId);
  assert.equal(downloadEvents, 0); assert.equal(requests.filter(r => r.path.endsWith('/content')).length, 0);
  const delivered = page.waitForEvent('download');
  if (race === 'close-switch-work') {
    await button(page, 'close-modal').click(); await button(page, 'back-works').click();
    await page.locator('.work-name[data-id="work-2"]').click(); await expect(page.getByRole('heading', { name: 'Other Work', exact: true })).toBeVisible();
    ready = true; preparation.resolve();
  } else if (race === 'lost-preparation') {
    await expect.poll(() => api(page, `return !!adapter.downloads.get('${snapshotId}')?.error`)).toBe(true);
    await expect(page.locator('#modal')).toContainText('Original transfer observation unavailable');
    observationFailure = false; ready = true;
    const beforeCheck = requests.length; await button(page, 'check-export-flow').click();
    assert.ok(requests.slice(beforeCheck).every(r => r.method === 'GET'), 'Check must only read the original IDs');
  } else {
    ready = true; await button(page, 'check-download').click();
  }
  const download = await delivered, saved = await readFile((await download.path())!);
  assert.equal(await download.failure(), null); assert.equal(download.url(), `${base}/_desktop/api/downloads/${transferId}/content`);
  assert.equal(download.suggestedFilename(), 'original-race.work'); assert.deepEqual(saved, bytes); assert.equal(createHash('sha256').update(saved).digest('hex'), digest);
  if (race === 'ready-before-post') {
    assert.equal(await api(page, `return adapter.downloads.get('${snapshotId}').pending`), true, 'GET must deliver while the original POST is still pending');
    preparation.resolve();
  }
  await expect.poll(() => api(page, `return adapter.downloads.get('${snapshotId}').pending`)).toBe(false);
  await api(page, `await adapter.checkDownload('${snapshotId}'); await adapter.checkDownload('${snapshotId}');`);
  assert.equal(downloadEvents, 1, 'late POST and repeated original GETs cannot repeat delivery');
  assert.deepEqual(requests.filter(r => r.method === 'POST').map(r => r.path), ['works/work-1/exports', `work-snapshots/${snapshotId}/downloads`]);
  assert.deepEqual(requests.filter(r => r.path.endsWith('/content')).map(r => r.path), [`downloads/${transferId}/content`]);
  const snapshotReads = requests.filter(r => /^work-snapshots\/[^/]+$/.test(r.path));
  assert.equal(snapshotReads.filter(r => r.path === `work-snapshots/${oldSnapshotId}`).length, 1);
  assert.ok(snapshotReads.filter(r => r.path === `work-snapshots/${snapshotId}`).length >= 1);
  assert.ok(requests.filter(r => r.path.startsWith('downloads/')).every(r => r.path === `downloads/${transferId}` || r.path === `downloads/${transferId}/content`));
  assert.equal(requests.filter(r => r.path === `work-snapshots/${oldSnapshotId}/downloads`).length, 0);
  if (race === 'close-switch-work') { await expect(page).toHaveURL(/#\/work\/work-2$/); await expect(page.locator('#modal')).toHaveCount(0); }
  if (race === 'ready-before-post') {
    await page.locator(`[data-action="view-snapshot"][data-id="${oldSnapshotId}"]`).click();
    await expect(page.locator('.export-snapshot')).toContainText(oldSnapshotId); await expect(page.locator('.export-snapshot')).not.toContainText(snapshotId);
    await expect(button(page, 'download-work')).toHaveAttribute('data-id', oldSnapshotId);
    assert.equal(downloadEvents, 1, 'selecting the late old snapshot is read-only');
    assert.equal(requests.filter(r => r.method === 'POST').length, 2);
  }
  t.diagnostic(JSON.stringify({ race, export: operationId, snapshotId, transferId, snapshotResponseOrder: snapshotResponses, requests: requests.filter(r => r.path.endsWith('/exports') || r.path.startsWith('work-snapshots/') || r.path.startsWith('downloads/')).map(r => `${r.method} ${r.path}`) }));
});

test('D10 unknown preview preserves iframe; popup blocking offers protected link and entry failure allows retry', async t => {
  let failed = true;
  const { page } = await fixture(t, r => {
    if (r.path.endsWith('/services')) return { json: { services: [{ serviceId: 'counter', name: 'Counter', enabled: true, observedState: 'ready', access: { hostname: 'counter.w-one.work', ports: [{ port: 8000, url: 'http://counter.w-one.work:8000', name: 'http' }] } }] } };
    if (r.path === 'service-entries') return failed ? { status: 503, json: { message: 'entry unavailable' } } : { json: { entryId: 'entry-1', origin: 'http://service.test', entryUrl: 'about:blank', embed: 'unknown' } };
    if (r.path === 'service-entries/entry-1') return { json: { embed: 'unknown' } };
  });
  await expect(button(page, 'retry-service-entry')).toBeVisible(); failed = false; await button(page, 'retry-service-entry').click();
  await expect(page.locator('iframe')).toHaveCount(1); await page.locator('iframe').evaluate(frame => frame.setAttribute('data-test-retained', 'yes'));
  const frameTop = (await page.locator('iframe').boundingBox())!.y;
  await expect(button(page, 'check-preview')).toBeVisible();
  assert.equal((await page.locator('iframe').boundingBox())!.y, frameTop, 'Background preview feedback must not move the application');
  await button(page, 'check-preview').click();
  await expect(page.locator('iframe')).toHaveAttribute('data-test-retained', 'yes');
  await page.evaluate(() => { window.open = () => null; }); await button(page, 'open-app').click();
  await expect(page.locator('#app')).toContainText('browser blocked'); await expect(button(page, 'copy-local')).toBeVisible();
  assert.doesNotMatch(await button(page, 'copy-local').getAttribute('data-copy') || '', /ticket|token/);
});

for (const entry of ['connection', 'readiness', 'retry-works', 'open-work', 'settings', 'services', 'files', 'sessions', 'new-session', 'select-session', 'catalog', 'refresh-config', 'lookup', 'snapshot', 'check-operation', 'resume-operation'] as const) test(`D01/D04–D06/D14–D15/D20 ${entry} waits visibly for its own request`, async t => {
  const gate = deferred(); t.after(async () => gate.resolve()); let armed = false;
  const operation = { id: 'op-read', workId: 'work-1', kind: 'Operation', state: 'running', phase: 'running', scope: 'http://core.test · owner' };
  const endpoint: Record<string, string> = { connection:'status', readiness:'status', 'retry-works':'works', 'open-work':'works/work-1', settings:'works/work-1/configuration', services:'works/work-1/services', sessions:'works/work-1/sessions', 'new-session':'works/work-1/sessions', 'select-session':'works/work-1/sessions/session-2', catalog:'skills', 'refresh-config':'works/work-1/configuration', known:'known-operations', lookup:'operations/op-read', snapshot:'work-snapshots/snap-read', 'check-operation':'operations/op-read', 'resume-operation':'operations/op-read', clear:'known-operations/op-read', files:'/_desktop/files/works/work-1/files/' };
  const { page, requests } = await fixture(t, async r => {
    if (armed && r.path === endpoint[entry]) await gate.promise;
    if (r.path.startsWith('/_desktop/files/')) return { status:207, body:listing('original',mtime1) };
    if (r.path.endsWith('/sessions') && r.method==='POST') return { json:{sessionId:'session-new'} };
    if (r.path.endsWith('/sessions')) return { json:{sessions:[{sessionId:'session-1'},{sessionId:'session-2'}]} };
    if (r.path.endsWith('/sessions/session-2')) return {json:{session:{workId:'work-1',sessionId:'session-2',modelPreference:null,source:{kind:'chat'}},messages:[],runs:[]}};
    if (r.path === 'operations/op-read') return {json:{operationId:'op-read',state:'running',workId:'work-1'}};
    if (r.path === 'known-operations/op-read') return {json:{}};
    if (r.path === 'work-snapshots/snap-read') return {json:{snapshotId:'snap-read',workId:'work-1',operationId:'op-read',state:'succeeded'}};
  });
  let trigger = '';
  if (['connection','readiness','retry-works','open-work'].includes(entry)) {
    await button(page,'back-works').click();
    if (entry==='open-work') trigger='open-work';
    else if (entry==='retry-works') { await api(page,"adapter.state.scenario='list-error'; adapter.state.works=[]; adapter.state.lastChecked='previous'"); await button(page,'connection').click(); await button(page,'close-modal').click(); trigger='retry-works'; }
    else { await button(page,'connection').click(); trigger='check-connection'; }
  } else if (entry==='settings' || entry==='catalog' || entry==='refresh-config') {
    await button(page,'work-menu').click();
    if(entry==='settings') trigger='settings';
    else {await page.locator('#modal [data-action="settings"]').click(); trigger=entry==='catalog'?'check-catalog':'refresh-config';}
  } else if (entry==='services' || entry==='files') trigger=entry==='services'?'tab-Services':'tab-Files';
  else if (entry==='sessions') trigger='sessions';
  else if (entry==='new-session') {await button(page,'agent-menu').click();trigger='new-session';}
  else if (entry==='select-session') {await button(page,'sessions').click();trigger='select-session';}
  else {
    await api(page,`adapter.state.operations.push(${JSON.stringify(operation)})`);
    if (entry==='snapshot') await findPreviousExport(page); else await workTasks(page);
    if(entry==='lookup') {await page.locator('#operation-query').fill('op-read');trigger='lookup-operation';}
    else if(entry==='snapshot') {await page.locator('#snapshot-query').fill('snap-read');trigger='lookup-snapshot';}
    else {await button(page,'operation').click(); if(entry==='resume-operation') await button(page,'pause-operation').click(); trigger=entry;}
  }
  armed = true; const before = requests.filter(r=>r.path===endpoint[entry]).length;
  const catalogGeometry = entry === 'catalog' ? await button(page,trigger).boundingBox() : null;
  await button(page,trigger).click();
  if (entry==='retry-works') { await expect(page.locator('.works-toolbar [data-action="retry-works"]')).toHaveAttribute('aria-busy','true'); await expect(page.locator('.works-toolbar [data-action="retry-works"]')).toBeDisabled(); }
  else if (entry==='open-work') { await expect(page.locator('.work-header .work-read-feedback[role="status"][aria-busy="true"]')).toBeVisible(); await expect(page.getByRole('heading',{name:'Recovery Work',exact:true})).toBeVisible(); }
  else if (entry==='files') { await expect(button(page,'refresh-files')).toHaveAttribute('aria-busy','true'); await expect(page.locator('.main-panel .read-placeholder[aria-busy="true"]')).toBeVisible(); }
  else if (entry==='sessions'||entry==='select-session') await expect(page.locator('.agent-header [data-action="sessions"]')).toHaveAttribute('aria-busy','true');
  else await expect(page.locator('[aria-busy="true"]').filter({ has: page.locator('.pending-dots') }).first()).toBeVisible();
  if(catalogGeometry) assert.deepEqual(await button(page,trigger).boundingBox(),catalogGeometry);
  await expect.poll(()=>requests.filter(r=>r.path===endpoint[entry]).length-before).toBe(1);
  // Input/keyboard paths share the same in-flight action, while closing remains legal.
  if (await button(page,trigger).count()) { if(entry!=='open-work') await expect(button(page,trigger)).toBeDisabled(); await page.evaluate(action=>document.querySelector<HTMLElement>(`[data-action="${action}"]`)?.click(),trigger); }
  assert.equal(requests.filter(r=>r.path===endpoint[entry]).length-before,1);
  gate.resolve();
});

for (const control of ['start','stop','restart','retry','remove'] as const) test(`D08 ${control} confirms its original Service Operation before readback`, async t=>{
  const mutation=deferred(),refresh=deferred();t.after(async()=>{mutation.resolve();refresh.resolve();});let accepted=false;
  const {page,requests}=await fixture(t,async r=>{
    if(r.path.endsWith('/services')&&r.method==='GET') {if(accepted)await refresh.promise;return {json:{services:[{serviceId:'service-a',name:'Tool A',enabled:control!=='start',observedState:control==='retry'?'failed':control==='start'?'stopped':'ready',access:{hostname:'a.w-one.work',ports:[]}}]}};}
    if(r.path.includes('/logs')) return {json:{text:'bounded logs',status:'collected',collectedAt:'2026-10-03T00:00:00Z'}};
    if(r.method==='POST'&&r.path.endsWith('/'+control)) {await mutation.promise;accepted=true;return{json:{operationId:'op-service-'+control,workId:'work-1'}};}
  });
  await button(page,'tab-Services').click();await button(page,'manage-services').click();await button(page,'service-details').click();
  await page.locator(`[data-action="service-action"][data-control="${control}"]`).click();
  if(control==='stop'||control==='remove') await button(page,'confirm-service-control').click();
  const owner = control==='stop'||control==='remove' ? button(page,'confirm-service-control') : page.locator(`[data-action="service-action"][data-control="${control}"]`);
  await expect(owner.locator('[role="status"]')).toContainText('service-a');
  mutation.resolve();await expect(page.locator(`#modal .object-control-progress [data-action=operation][data-id="op-service-${control}"]`)).toBeVisible();assert.equal(requests.filter(r=>r.method==='POST').length,1);refresh.resolve();
});

test('D02 acceptance allows Stop to supersede Start while Work readback is still pending',async t=>{
  const readback=deferred();t.after(async()=>readback.resolve());let accepted=false;
  const {page,requests}=await fixture(t,async r=>{
    if(r.path==='works'||r.path==='works/work-1'){if(accepted)await readback.promise;const raw={id:'work-1',name:'Recovery Work',observedState:'stopped',desiredState:'stopped'};return{json:r.path==='works'?{works:[raw]}:raw};}
    if(r.path.endsWith('/start')){accepted=true;return{json:{operationId:'op-start',workId:'work-1'}};}
    if(r.path.endsWith('/stop'))return{json:{operationId:'op-stop',workId:'work-1'}};
    if(r.path==='operations/op-start')return{json:{state:'superseded',operationId:'op-start',workId:'work-1'}};
  });
  await button(page,'start-work').click();await expect(page.locator('.object-control-state')).toContainText('Start Work');await expect(page.locator('.object-control-progress')).toHaveCount(0);await expect(page.locator('#modal')).toHaveCount(0);
  await button(page,'work-menu').click(); await button(page,'stop-work').click();await button(page,'confirm-stop').click();await expect(page.locator('#modal')).toContainText('op-stop');
  assert.equal(requests.filter(r=>r.path.endsWith('/start')).length,1);assert.equal(requests.filter(r=>r.path.endsWith('/stop')).length,1);readback.resolve();
});

for(const action of ['detail','refresh'] as const)test(`D09 ${action} reports logs read without inventing an empty snapshot`,async t=>{
  const gate=deferred();t.after(async()=>gate.resolve());let armed=false;
  const {page,requests}=await fixture(t,async r=>{
    if(r.path.endsWith('/services'))return{json:{services:[{serviceId:'tool',name:'Tool',enabled:true,observedState:'ready',access:{ports:[]}}]}};
    if(r.path.includes('/logs')){if(armed)await gate.promise;return{json:{text:'',status:'empty',collectedAt:'2026-10-03T01:00:00Z'}};}
  });
  await button(page,'tab-Services').click();await button(page,'manage-services').click();if(action==='refresh')await button(page,'service-details').click();
  armed=true;const before=requests.filter(r=>r.path.includes('/logs')).length;const geometry=action==='refresh'?await button(page,'refresh-logs').boundingBox():null;await button(page,action==='detail'?'service-details':'refresh-logs').click();
  if(action==='refresh'){await expect(button(page,'refresh-logs')).toHaveAttribute('aria-busy','true');await expect(button(page,'refresh-logs').locator('.pending-dots')).toHaveCount(1);assert.deepEqual(await button(page,'refresh-logs').boundingBox(),geometry);}
  else await expect(page.locator('[aria-busy="true"]').filter({has:page.locator('.pending-dots'),hasText:'tool'}).first()).toBeVisible();assert.equal(requests.filter(r=>r.path.includes('/logs')).length-before,1);gate.resolve();
});

for (const action of ['read','path','refresh','save','folder','rename','move','copy','delete','upload'] as const) test(`D11–D13 ${action} keeps path feedback and confirms before directory refresh`, async t=>{
  const operation=deferred(),refresh=deferred();t.after(async()=>{operation.resolve();refresh.resolve();});let armed=false,confirmed=false;
  const listingWithDirectory=listing('original',mtime1).replace('</d:multistatus>','<d:response><d:href>/_desktop/files/works/work-1/files/archive/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>');
  const method=action==='folder'?'MKCOL':action==='rename'||action==='move'?'MOVE':action==='copy'?'COPY':action==='delete'?'DELETE':action==='save'||action==='upload'?'PUT':action==='read'?'GET':'PROPFIND';
  let uploadedBytes: Buffer | undefined;
  if (action === 'upload') { nativeUploadHandler = async (request, response) => { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk); uploadedBytes = Buffer.concat(chunks); await operation.promise; confirmed = true; response.writeHead(201, { 'Last-Modified': mtime2 }); response.end(); }; t.after(async () => { nativeUploadHandler = undefined; }); }
  const {page,requests}=await fixture(t,async r=>{
    if(r.path.startsWith('/_desktop/files/')){
      if (action === 'upload' && r.method === 'PUT') return { passthrough: true };
      if(armed&&r.method===method){await operation.promise;confirmed=true;}
      else if(confirmed&&r.method==='PROPFIND')await refresh.promise;
      if(r.method==='PROPFIND')return{status:207,body:listingWithDirectory};
      if(r.method==='HEAD')return{status:404};
      if(r.method==='GET')return{body:'original',headers:{'Last-Modified':mtime1}};
      return{status:201,headers:{'Last-Modified':mtime2}};
    }
  });
  await button(page,'tab-Files').click();
  let trigger='';
  if(action==='read')trigger='open-file';
  else if(action==='path')trigger='file-path';
  else if(action==='refresh')trigger='refresh-files';
  else if(action==='save'){await page.locator('[data-action="open-file"][data-path="/note.txt"]').click();await page.locator('#file-editor').fill('submitted');trigger='save-file';}
  else if(action==='folder'){await button(page,'file-add').click();await button(page,'new-folder').click();await page.locator('#form-name').fill('research');trigger='confirm-folder';}
  else if(action!=='upload'){
    await page.locator('[data-action="file-menu"][data-path="/note.txt"]').click();await button(page,'file-'+action).click();
    if(action==='rename')await page.locator('#form-name').fill('renamed.txt');
    if(action==='move'||action==='copy')await page.locator('#form-destination').selectOption('/archive');
    trigger=action==='delete'?'confirm-file-delete':'confirm-transfer';
  }
  armed=true;const before=requests.filter(r=>r.method===method&&r.path.startsWith('/_desktop/files/')).length;
  if(action==='upload'){await button(page,'file-add').click();await page.locator('[data-action=upload]').click();await page.locator('#upload-input').setInputFiles({name:'binary.dat',mimeType:'application/octet-stream',buffer:Buffer.from([0,255,1,128])});}
  else if(action==='read')await page.locator('[data-action="open-file"][data-path="/note.txt"]').click();else await button(page,trigger).click();
  if(action==='read') { await expect(page.locator('.file-target-toolbar')).toContainText('note.txt'); await expect(page.locator('.read-placeholder')).toHaveAttribute('aria-label','Reading note.txt…'); }
  else if(action==='path'||action==='refresh') { await expect(button(page,'refresh-files')).toHaveAttribute('aria-busy','true'); await expect(button(page,'refresh-files')).toHaveAccessibleName('Reading files…'); }
  else await expect(page.locator('[aria-busy="true"]').filter({has:page.locator('.pending-dots')}).first()).toBeVisible();
  if(action==='upload'){await button(page,'file-add').click();await page.locator('.file-upload-details summary').click();await expect(page.locator('#app')).toContainText('File 1 of 1');await expect(page.locator('#app')).toContainText('Waiting for confirmation');}
  await expect.poll(()=>requests.filter(r=>r.method===method&&r.path.startsWith('/_desktop/files/')).length-before).toBe(1);
  if(action==='save'){await page.locator('#file-editor').fill('newer unsaved');operation.resolve();await expect(page.locator('#file-editor')).toHaveValue('newer unsaved');await expect(page.locator('#app')).toContainText('Unsaved');}
  else {operation.resolve();if(['folder','rename','move','copy','delete','upload'].includes(action)){await expect(page.locator('.toast')).toContainText(action==='folder'?'Folder created.':action==='upload'?'Upload complete.':'File changes saved.');await expect.poll(()=>confirmed).toBe(true);await expect(button(page,'refresh-files')).toHaveAttribute('aria-busy','true');}}
  if(action==='upload'){const put=requests.find(r=>r.method==='PUT')!;assert.deepEqual(uploadedBytes,Buffer.from([0,255,1,128]));assert.equal(put.headers['if-none-match'],'*');}
  refresh.resolve();
});

for (const source of ['Core','npm','Git','Local directory','ZIP'] as const) for (const update of [false,true]) test(`D16 ${source} ${update?'update':'install'} shows submission before original Operation`,async t=>{
  const gate=deferred(),readback=deferred();t.after(async()=>{gate.resolve();readback.resolve();});let accepted=false;
  const {page,requests}=await fixture(t,async r=>{
    if(r.path==='works/work-1/package-uploads')return{json:{uploadId:'upload-original'}};
    if(r.path===`works/work-1/packages${update?'/pkg/update':''}`&&r.method==='POST'){await gate.promise;accepted=true;return{json:{operationId:'op-package',workId:'work-1'}};}
    if(r.path==='operations/op-package')return{json:{operationId:'op-package',workId:'work-1',kind:update?'pi-package-update':'pi-package-install',state:'running'}};
    if(accepted&&r.path==='works/work-1/configuration')await readback.promise;
  });
  await button(page,'settings').click();await page.locator('[data-action="settings-section"][data-tab="Pi Packages"]').click();
  await button(page,update?'update-package':'install-package').click();await page.locator('#install-type').selectOption(source);
  if(source==='npm'||source==='Git')await page.locator('#install-source').fill(source==='npm'?'pkg@1.0.0':'https://example.test/pkg.git');
  else if(source==='ZIP')await page.locator('#package-zip-input').setInputFiles({name:'pkg.zip',mimeType:'application/zip',buffer:Buffer.from('original ZIP fixture bytes')});
  else if(source==='Local directory')await page.evaluate(()=>{const transfer=new DataTransfer();const file=new File(['{"name":"pkg"}'],'package.json');Object.defineProperty(file,'webkitRelativePath',{value:'pkg/package.json'});transfer.items.add(file);const input=document.querySelector<HTMLInputElement>('#package-directory-input')!;input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));});
  await button(page,'confirm-install').click();await expect(button(page,'confirm-install').locator('[role="status"]')).toContainText('Submitting package');
  await expect(button(page,'confirm-install')).toBeDisabled();gate.resolve();await expect(page.locator('#modal')).toHaveCount(0);
  await expect(page.locator('.settings-page [data-action="operation"][data-id="op-package"]')).toBeVisible();
  assert.equal(requests.filter(r=>r.path===`works/work-1/packages${update?'/pkg/update':''}`&&r.method==='POST').length,1);
  if(source==='ZIP'||source==='Local directory')assert.equal(requests.filter(r=>r.path.endsWith('/package-uploads')).length,1);else assert.equal(requests.filter(r=>r.path.endsWith('/package-uploads')).length,0);
  readback.resolve();
});

for(const action of ['apply','skill-copy','remove-package'])test(`D14/D16 ${action} confirmation does not wait for configuration readback`,async t=>{
  const gate=deferred(),read=deferred();t.after(async()=>{gate.resolve();read.resolve();});let accepted=false;
  const endpoint=action==='apply'?'works/work-1/configuration/apply':action==='skill-copy'?'works/work-1/configuration/skills':'works/work-1/packages/pkg';
  const {page,requests}=await fixture(t,async r=>{
    if(r.path===endpoint&&r.method!=='GET'){await gate.promise;accepted=true;return{json:action==='skill-copy'?{}:{operationId:'op-'+action,workId:'work-1'}};}
    if(accepted&&r.path==='works/work-1/configuration')await read.promise;
    if(action==='apply'&&r.path==='works/work-1/configuration')return{json:{desired:{skills:[],packages:[],agentsMd:'saved',mcp:{servers:[]}},active:{},pendingApply:true,runtime:{state:'ready'}}};
  });
  await button(page,'settings').click();
  let trigger='apply-config';
  if(action==='skill-copy'){await page.locator('[data-action="settings-section"][data-tab="Skills"]').click();await button(page,'core-skill-copy').click();trigger='confirm-core-skills';}
  if(action==='remove-package'){await page.locator('[data-action="settings-section"][data-tab="Pi Packages"]').click();await button(page,'remove-package').click();trigger='confirm-remove-package';}
  await button(page,trigger).click();await expect(page.locator('[aria-busy="true"]').filter({ has: page.locator('.pending-dots') }).filter({ hasText: action === 'apply' ? 'Submitting Apply' : action === 'skill-copy' ? 'Copying Skill' : 'Removing package' }).first()).toBeVisible();gate.resolve();
  if (action==='skill-copy') await expect(page.locator('body')).toContainText('Skill copy saved');
  else await expect(page.locator(`.settings-page [data-action="operation"][data-id="op-${action}"]`)).toBeVisible();
  assert.equal(requests.filter(r=>r.path===endpoint&&r.method!=='GET').length,1);read.resolve();
});

test('D19 lost preparation response and observation failure recover the original transfer without another POST',async t=>{
  let ready=false,readFailure=true,postID='';
  const digest='a'.repeat(64);
  const {page,requests}=await fixture(t,r=>{
    if(r.path==='work-snapshots/snap-recover')return{json:{snapshotId:'snap-recover',workId:'work-1',operationId:'op-recover',state:'succeeded',size:30,digest,expiresAt:'2099-01-01T00:00:00Z'}};
    if(r.path==='work-snapshots/snap-recover/downloads'&&r.method==='POST'){postID=r.headers['x-piwork-transfer-id']!;return{abort:true};}
    if(r.path===`downloads/${postID}`)return readFailure?{status:503,json:{message:'observation offline'}}:{json:{transferId:postID,kind:'download',phase:ready?'ready':'validating',transferred:30,total:30,...(ready?{workId:'work-1',snapshotId:'snap-recover',size:30,digest,ready:true}:{})}};
  });
  await api(page,"await adapter.fetchSnapshot('snap-recover'); await adapter.downloadSnapshot('snap-recover').catch(()=>{});");await expect.poll(()=>api(page,"return !!adapter.downloads.get('snap-recover').error")).toBe(true);
  await assert.rejects(api(page,"await adapter.checkDownload('snap-recover')"));
  readFailure=false;await api(page,"await adapter.checkDownload('snap-recover');adapter.observeDownload('snap-recover')");await expect.poll(()=>api(page,"return adapter.downloads.get('snap-recover').phase")).toBe('validating');
  ready=true;await expect.poll(()=>api(page,"return !!adapter.downloads.get('snap-recover').ready")).toBe(true);
  const url=await api(page,"return await adapter.downloadSnapshot('snap-recover')");assert.equal(url,`/_desktop/api/downloads/${postID}/content`);assert.equal(requests.filter(r=>r.method==='POST').length,1);
});

test('D10 user gesture reserves an opener-isolated window; failed async authorization closes only that window',async t=>{
  const gate=deferred();t.after(async()=>gate.resolve());let armed=false;
  const {page,requests}=await fixture(t,async r=>{
    if(r.path.endsWith('/services'))return{json:{services:[{serviceId:'secure',name:'Secure',enabled:true,observedState:'ready',access:{ports:[{port:80,url:'http://secure.work'}]}}]}};
    if(r.path==='service-entries'){if(armed){await gate.promise;return{status:403,json:{message:'authorization denied'}};}return{json:{entryId:'entry-secure',origin:'http://secure.test',entryUrl:'about:blank',embed:'blocked'}};}
    if(r.path==='service-entries/entry-secure')return{json:{embed:'blocked'}};
  });
  await expect(button(page,'open-app')).toBeVisible();await expect(page.locator('#app')).toContainText('security policy');
  await page.evaluate(()=>{(window as any).prepared={opener:'original',location:{href:'about:blank'},closed:false,close(){this.closed=true;}};window.open=()=>(window as any).prepared;});
  armed=true;await button(page,'open-app').click();assert.equal(await page.evaluate(()=>(window as any).prepared.opener),null);assert.equal(await page.evaluate(()=>(window as any).prepared.closed),false);
  gate.resolve();await expect.poll(()=>page.evaluate(()=>(window as any).prepared.closed)).toBe(true);await expect(page.locator('body')).toContainText('authorization denied');assert.equal(requests.filter(r=>r.path.endsWith('/stop')).length,0);
});

for(const type of ['agents-input','json-input','create-agents-input'])test(`D15 ${type} shows local read and discards a replaced selection or a closed view`,async t=>{
  const {page}=await fixture(t,()=>undefined);
  if(type==='create-agents-input'){await button(page,'back-works').click();await button(page,'new-work').click();await button(page,'toggle-create-advanced').click();}
  else{await button(page,'settings').click();await page.locator(`[data-action="settings-section"][data-tab="${type==='json-input'?'Advanced':'AGENTS.md'}"]`).click();}
  await page.evaluate(()=>{const read=File.prototype.arrayBuffer;(window as any).releaseRead=()=>{};File.prototype.arrayBuffer=function(){if(this.name==='slow.txt')return new Promise<ArrayBuffer>(resolve=>{(window as any).releaseRead=()=>resolve(new TextEncoder().encode('stale file').buffer)});return read.call(this);};});
  await page.locator('#'+type).setInputFiles({name:'slow.txt',mimeType:'text/plain',buffer:Buffer.from('old')});await expect(page.locator('[data-action-status][aria-busy="true"]')).toContainText('Reading selected file');
  const text=type==='json-input'?'{}':'new file';await page.locator('#'+type).setInputFiles({name:'new.txt',mimeType:'text/plain',buffer:Buffer.from(text)});
  await page.evaluate(()=>(window as any).releaseRead());
  const field=type==='json-input'?'#advanced-editor':type==='create-agents-input'?'#create-agents':'#agents-editor';await expect(page.locator(field)).toHaveValue(text);
});

for(const entry of ['login','logout','switch'] as const)test(`D01 ${entry} first paint uses current identity and does not claim remote revocation`,async t=>{
  const gate=deferred();t.after(async()=>gate.resolve());let armed=false;
  const endpoint=entry==='login'?'login':entry==='logout'?'logout':'connection';
  const {page,requests}=await fixture(t,async r=>{if(armed&&r.path===endpoint){await gate.promise;if(entry==='logout')return{json:{view:{state:'signed-out',generation:2,csrf:'local-session-csrf',coreUrl:'http://core.test'},remoteRevocationConfirmed:false}};}},entry==='login');
  if(entry==='login'){await page.locator('#auth-account').fill('owner');await page.locator('#auth-password').fill('test-password');}
  else {await button(page,'back-works').click();await button(page,'account').click();if(entry==='switch'){await button(page,'switch-core').click();await page.locator('#auth-core').fill('http://new-core.test');}}
  armed=true;const trigger=entry==='login'?'sign-in':entry==='logout'?'sign-out':'confirm-switch-core';await button(page,trigger).click();await expect(button(page,trigger).locator('[role="status"]')).toContainText(entry==='login'?'Signing in':entry==='logout'?'Signing out':'Switching Core');await expect(button(page,trigger)).toBeDisabled();
  gate.resolve();if(entry==='logout')await expect(page.locator('#app')).toContainText('Remote revocation could not be confirmed');else await expect(page.locator('[data-action-status][aria-busy="true"]')).toHaveCount(0);assert.equal(requests.filter(r=>r.path===endpoint&&r.method!=='GET').length,1);
});

for(const method of ['mouse','keyboard'] as const)test(`D07 Send ${method} confirms original Run, retains newer draft, duplicate submission is blocked`,async t=>{
  const gate=deferred(),events=deferred();t.after(async()=>{gate.resolve();events.resolve();});
  const {page,requests}=await fixture(t,async r=>{
    if(r.path==='works/work-1/runs'&&r.method==='POST'){await gate.promise;return{json:{run:{runId:'run-original',sessionId:'session-1',state:1}}};}
    if(r.path.endsWith('/events')){await events.promise;return{status:503};}
  });
  await page.locator('#composer').fill('submitted prompt');if(method==='mouse')await button(page,'send-message').click();else await page.locator('#composer').press('Enter');
  const original=page.locator('.message.user').filter({hasText:'submitted prompt'});
  await expect(original).toHaveCount(1);await expect(original.locator('.message-submission')).toHaveAttribute('aria-label','Sending');await expect(original.locator('.message-submission > svg')).toHaveCount(1);
  await expect(original.locator('.message-submission')).toHaveText('');
  await expect(button(page,'send-message')).toBeDisabled();await page.locator('#composer').fill('newer draft');await page.locator('#composer').press('Enter');assert.equal(requests.filter(r=>r.method==='POST').length,1);
  gate.resolve();const accepted=page.locator('[data-action-status]').filter({hasText:'Message accepted'});await expect(accepted).toHaveCount(0);await expect(page.locator('#composer')).toHaveValue('newer draft');await expect(original).toHaveCount(1);await expect(original.locator('.message-submission')).toHaveCount(0);events.resolve();
});

test('pending Chat submission cannot reappear after identity is cleared',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());let posted=false;
  const {page}=await fixture(t,async r=>{
    if(r.path==='works/work-1/runs'&&r.method==='POST'){posted=true;await gate.promise;return{json:{run:{runId:'old-identity-run',sessionId:'session-1',state:1}}};}
  });
  await page.locator('#composer').fill('Private pending message');await button(page,'send-message').click();
  await expect.poll(()=>posted).toBe(true);await expect(page.locator('.message-submission.sending')).toBeVisible();
  await api(page,'adapter.clearIdentity();');gate.resolve();
  await expect.poll(()=>api(page,'return adapter.state.works.length')).toBe(0);
  await expect(page.locator('#app')).not.toContainText('Private pending message');
});

for(const action of ['cancel','resume'] as const)test(`D07 ${action} original Run has visible request and never resends the prompt`,async t=>{
  const gate=deferred();t.after(async()=>gate.resolve());
  const {page,requests}=await fixture(t,async r=>{
    if(r.path.endsWith('/cancel')){await gate.promise;return{json:{}};}
    if(r.path.endsWith('/events')){await gate.promise;return{body:'',headers:{'Content-Type':'application/x-ndjson'}};}
    if(r.path==='works/work-1/runs/run-original')return{json:{run:{runId:'run-original',sessionId:'session-1',state:2}}};
  });
  await api(page,`adapter.getWork('work-1').run={id:'run-original',sessionId:'session-1',status:'${action==='cancel'?'running':'interrupted'}',cursor:3,created:'',error:'Check the original Run'};`);await button(page,'agent-menu').click();await page.keyboard.press('Escape');
  const owner=button(page,action==='cancel'?'cancel-run':'resume-run');await owner.click();await expect(owner.locator('[role="status"]')).toContainText(action==='cancel'?'Requesting cancellation':'Reconnecting Run');gate.resolve();
  if(action==='cancel')await expect(button(page,'cancel-run')).toHaveText('Cancelling…');else await expect(page.locator('[data-action-status]').filter({hasText:'Reconnected'})).toBeVisible();assert.equal(requests.filter(r=>r.path==='works/work-1/runs'&&r.method==='POST').length,0);
  if(action==='cancel'){await expect(button(page,'cancel-run')).toBeDisabled();assert.equal(await api(page,"return adapter.getWork('work-1').run.status"),'running');}
});

for(const action of ['inspect','import','query','cleanup','export'] as const)test(`D17/D18 ${action} retains original transfer or acceptance identity through delayed response`,async t=>{
  const gate=deferred(),read=deferred();t.after(async()=>{gate.resolve();read.resolve();});let armed=false,accepted=false,id='transfer-original';
  const {page,requests}=await fixture(t,async r=>{
    if(r.path==='works'||r.path==='works/work-1'){if(accepted)await read.promise;const raw={id:'work-1',name:'Recovery Work',observedState:'stopped',desiredState:'stopped'};return{json:r.path==='works'?{works:[raw]}:raw};}
    if(r.path==='work-packages'&&r.method==='POST'){id=r.headers['x-piwork-transfer-id']!;await gate.promise;return{json:{transferId:id,summary:{sourceName:'actual inspected'}}};}
    if(r.path===`work-packages/${id}`){if(armed)await gate.promise;return{json:{transferId:id,phase:action==='query'?'accepted':'ready',transferred:4}};}
    if(r.path==='work-imports'||r.path==='works/work-1/exports'){await gate.promise;accepted=true;return{json:{operationId:'op-'+action,workId:'work-1',...(action==='export'?{snapshotId:'snapshot-original'}:{})}};}
    if(action==='export'&&r.path==='operations/op-export')return{json:{operationId:'op-export',workId:'work-1',type:'export_work',state:'running',result:{snapshotId:'snapshot-original'}}};
    if(action==='export'&&r.path==='work-snapshots/snapshot-original'){await read.promise;return{json:{snapshotId:'snapshot-original',workId:'work-1',operationId:'op-export',state:'preparing',size:null,digest:null,expiresAt:null}};}
  });
  await button(page,'back-works').click();
  if(action==='export'){await button(page,'work-menu').click();armed=true;await button(page,'export').click();}
  else if(action==='cleanup'){
    await api(page,`adapter.cleanupPending.set('${id}',{message:'Cleanup not confirmed',localSession:'local-session-csrf'})`);await button(page,'connection').click();await button(page,'close-modal').click();armed=true;await button(page,'retry-inspection-cleanup').click();
  }else{
    await button(page,'import').click();
    if(action==='inspect'){armed=true;await page.locator('#work-file-input').setInputFiles({name:'fixture.work',mimeType:'application/vnd.piwork.work-package',buffer:Buffer.from('byte')});}
    else{
      await api(page,`adapter.inspection={sourceName:'fixture'};adapter.inspectionTransfer='${id}';adapter.inspectionContext={id:'${id}',nonce:1,core:'http://core.test',localSession:'local-session-csrf',ready:true,anonymous:false,importState:'${action==='query'?'unknown':'unsubmitted'}'};`);
      await api(page,"adapter['emit']()");
      if(action==='import'){armed=true;await button(page,'confirm-import').click();}
      else armed=true;
    }
  }
  if(action==='export'){await expect(page.locator('#modal')).toContainText('Starting export');await expect(button(page,'prepare-export')).toHaveCount(0);}
  else if(action==='inspect'){
    const transfer=page.locator('#modal [data-pending-action~="work-file-input"]');
    await expect(transfer).toHaveAttribute('aria-busy','true');await expect(transfer.locator('.pending-dots')).toHaveCount(1);
    await expect(transfer).toContainText('Uploading the package');await expect(page.locator('#modal')).toContainText('0 B / 4 B');
    await expect(page.locator('#modal progress[aria-label="Transfer bytes"]')).toHaveAttribute('max','4');
    await expect(page.locator('#modal progress[aria-label="Transfer bytes"]')).toHaveAttribute('value','0');
    await expect.poll(()=>requests.filter(r=>r.path==='work-packages'&&r.method==='POST').length).toBe(1);
    assert.equal(await api(page,'return adapter.inspectionTransfer'),id);assert.equal(await api(page,'return adapter.inspectionContext.id'),id);
  }
  else if(action==='query'){
    // An unknown import keeps its identity and offers no second submission.
    await expect(page.locator('#modal')).toContainText('not confirmed');
    await expect(button(page,'confirm-import')).toHaveCount(0);
    await expect(page.locator('#modal [data-action="check-inspection-import"]')).toHaveCount(0);
    assert.equal(requests.filter(r=>r.path==='work-imports').length,0);
    gate.resolve();
  }
  else if(action==='import') await expect(button(page,'confirm-import').locator('[role="status"]')).toHaveCount(1);
  else await expect(button(page,'retry-inspection-cleanup').locator('[role="status"]')).toHaveCount(1);
  gate.resolve();
  if(action==='export'||action==='import'){
    if(action==='export') await expect(page.locator('#modal')).toContainText('op-export');
    else { await expect(page.locator('#modal .import-name-feedback')).toBeVisible(); assert.equal(await api(page,"return adapter.inspectionContext.operationId"),'op-import'); }
    assert.equal(requests.filter(r=>r.path==='work-imports'||r.path.endsWith('/exports')).length,1);read.resolve();
  }
  else if(action==='inspect'){
    await expect(page.locator('#modal')).toContainText('verified locally');await expect(page.locator('#modal [data-pending-action~="work-file-input"]')).toHaveCount(0);
    await expect(page.locator('.import-result')).toContainText('actual inspected');
    await expect(page.locator('#modal progress')).toHaveCount(0);
    assert.equal(await api(page,'return adapter.inspectionTransfer'),id);
    assert.equal(requests.filter(r=>r.path==='work-packages'&&r.method==='POST').length,1);
  }
});

test('DWUI-012 pending Service A permits unrelated B; closing and reopening details rejects A late modal callback',async t=>{
  const gate=deferred();t.after(async()=>gate.resolve());
  const {page,requests}=await fixture(t,async r=>{
    if(r.path.endsWith('/services'))return{json:{services:['a','b'].map(id=>({serviceId:id,name:'Tool '+id,enabled:false,observedState:'stopped',access:{ports:[]}}))}};
    if(r.path.includes('/logs'))return{json:{text:'snapshot',status:'collected'}};
    if(r.path==='works/work-1/services/a/start'){await gate.promise;return{json:{operationId:'op-a',workId:'work-1'}};}
    if(r.path==='works/work-1/services/b/start')return{json:{operationId:'op-b',workId:'work-1'}};
  });
  await button(page,'tab-Services').click();await button(page,'manage-services').click();await page.locator('[data-action="service-details"][data-id="a"]').click();await page.locator('[data-action="service-action"][data-control="start"]').click();
  await expect(page.locator('[data-action="service-action"][data-id="a"][data-control="start"] [role="status"]')).toContainText('service:a');await button(page,'close-modal').click();await button(page,'manage-services').click();await page.locator('[data-action="service-details"][data-id="b"]').click();
  gate.resolve();await expect(page.locator('#modal-title')).toHaveText('Tool b');await page.locator('[data-action="service-action"][data-control="start"]').click();await expect(page.locator('#modal .object-control-progress [data-action=operation][data-id="op-b"]')).toBeVisible();
  assert.equal(requests.filter(r=>r.path==='works/work-1/services/a/start').length,1);assert.equal(requests.filter(r=>r.path==='works/work-1/services/b/start').length,1);
});

test('W1 Service control stays locked across port changes while another Service remains usable', async t => {
  const gate = deferred(); t.after(async () => gate.resolve());
  const { page, requests } = await fixture(t, async r => {
    if (r.path.endsWith('/services')) return { json: { services: ['a', 'b'].map(id => ({ serviceId: id, name: 'Tool ' + id, enabled: true, observedState: 'ready', access: { hostname: `${id}.w-one.work`, ports: [80, 8080].map(port => ({ port, url: `http://${id}.w-one.work:${port}`, name: String(port) })) } })) } };
    if (r.path.includes('/logs')) return { json: { text: 'logs', status: 'collected' } };
    if (r.path === 'service-entries') return { json: { entryId: 'entry', origin: 'http://service.test', entryUrl: 'about:blank', embed: 'allowed' } };
    if (r.path === 'service-entries/entry') return { json: { embed: 'allowed' } };
    if (r.path === 'works/work-1/services/a/restart') { await gate.promise; return { json: { operationId: 'op-a', workId: 'work-1' } }; }
    if (r.path === 'works/work-1/services/b/restart') return { json: { operationId: 'op-b', workId: 'work-1' } };
  });
  const details = async (id: string) => { await button(page, 'service-menu').click(); await button(page, 'manage-services').click(); await page.locator(`[data-action="service-details"][data-id="${id}"]`).click(); };
  await details('a'); await page.locator('[data-control="restart"]').click();
  await expect(page.locator('[data-action="service-action"][data-id="a"][data-control="restart"] [role="status"]')).toContainText('service:a');
  await button(page, 'close-modal').click(); await details('a'); await page.getByRole('combobox', { name: 'Web entry', exact: true }).selectOption('8080'); await button(page, 'close-modal').click(); await details('a');
  await expect(page.locator('[data-control="restart"]')).toBeDisabled();
  await page.locator('[data-control="restart"]').evaluate((el: HTMLButtonElement) => el.click());
  assert.equal(requests.filter(r => r.path === 'works/work-1/services/a/restart').length, 1);
  await expect(page.locator('[data-action="service-action"][data-id="a"][data-control="restart"] [role="status"]')).toContainText('service:a');
  await button(page, 'close-modal').click(); await details('b');
  await expect(page.locator('[data-control="restart"]')).toBeEnabled(); await page.locator('[data-control="restart"]').click();
  await expect(page.locator('#modal .object-control-progress [data-action=operation][data-id="op-b"]')).toBeVisible();
  assert.equal(requests.filter(r => r.path === 'works/work-1/services/b/restart').length, 1);
  assert.ok(requests.some(r => r.path === 'service-entries' && JSON.parse(r.body).port === 8080));
});

test('DWUI-OPREC-001 recovered Service controls stay with the confirmed Service and preserve the mounted application', async t => {
  const records = [
    { operationId: 'service-a-op', workId: 'work-1', serviceId: 'a', type: 'Service action' },
    { operationId: 'service-gone-op', workId: 'work-1', serviceId: 'gone', type: 'Service action' },
    { operationId: 'service-unknown-op', workId: 'work-1', type: 'Service action' },
  ];
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'known-operations') return { json: { operations: records } };
    if (r.path.startsWith('operations/')) {
      const id = r.path.split('/')[1]!;
      return { json: { operationId: id, workId: 'work-1', kind: id === 'service-gone-op' ? 'remove-service' : 'restart-service', state: id === 'service-gone-op' ? 'failed' : 'running' } };
    }
    if (r.path.endsWith('/services')) return { json: { services: ['a', 'b'].map(id => ({ serviceId: id, name: `Tool ${id}`, enabled: true, observedState: 'ready', access: { hostname: `${id}.example`, ports: [{ port: 80, url: `http://${id}.example:80`, name: 'web' }] } })) } };
    if (r.path.includes('/logs')) return { json: { text: 'safe log', status: 'collected' } };
    if (r.path === 'service-entries') return { json: { entryId: 'entry', origin: 'http://service.test', entryUrl: 'about:blank', embed: 'allowed' } };
    if (r.path === 'service-entries/entry') return { json: { embed: 'allowed' } };
  });
  await page.reload();
  await api(page, "await Promise.all(adapter.state.operations.map(op => adapter.checkOperation(op.id)))");
  await expect(page.locator('iframe')).toHaveCount(1);
  await page.locator('iframe').evaluate(frame => { (window as any).recoveryFrame = frame; });
  await button(page, 'service-menu').click(); await button(page, 'manage-services').click();
  await expect(page.locator('#modal')).toContainText('The original Service has not been confirmed.');
  await expect(page.locator('#modal')).toContainText('The Service is no longer in the current list.');
  await page.locator('#modal [data-action="service-details"][data-id="a"]').click();
  await expect(page.locator('#modal .object-control-progress [data-id="service-a-op"]')).toBeVisible();
  await expect(page.locator('#modal [data-control="restart"]')).toBeDisabled();
  await page.locator('#modal [data-action="check-service-progress"]').click();
  await button(page, 'manage-services').click(); await page.locator('#modal [data-action="service-details"][data-id="b"]').click();
  await expect(page.locator('#modal .object-control-progress')).toHaveCount(0);
  await expect(page.locator('#modal [data-control="restart"]')).toBeEnabled();
  assert.equal(await page.locator('iframe').evaluate(frame => frame === (window as any).recoveryFrame), true);
  assert.equal(requests.filter(r => r.method === 'POST' && r.path.includes('/services/')).length, 0);
});

test('W2 unrelated or unidentified Operations cannot unlock unknown Start; only original Work facts restore its admission', async t => {
  let state = 'stopped', wrongWork = false;
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works' || r.path === 'works/work-1') { const work = { id: wrongWork && r.path !== 'works' ? 'work-2' : 'work-1', name: 'Recovery Work', observedState: state, desiredState: state === 'ready' ? 'running' : 'stopped' }; return { json: r.path === 'works' ? { works: [work] } : work }; }
    if (r.path === 'works/work-1/start') return { abort: true };
    if (r.path === 'operations/other-work') return { json: { operationId: 'other-work', workId: 'work-2', type: 'start', state: 'succeeded' } };
    if (r.path === 'operations/same-work') return { json: { operationId: 'same-work', workId: 'work-1', type: 'start', state: 'succeeded' } };
    if (r.path === 'operations/no-work') return { json: { operationId: 'no-work', state: 'succeeded' } };
  });
  await button(page, 'start-work').click(); await expect(button(page, 'start-work')).toBeDisabled();
  for (const id of ['other-work', 'same-work', 'no-work']) {
    await workTasks(page); await page.locator('#operation-query').fill(id); await button(page, 'lookup-operation').click();
    if (id === 'same-work') { await expect(page.locator('#modal')).toContainText(id); await button(page, 'check-operation').click(); await expect(button(page, 'check-operation')).toBeEnabled(); }
    else await expect(page.locator('#modal')).toContainText('belongs to another Work');
    await button(page, 'close-modal').click();
    await expect(button(page, 'start-work')).toBeDisabled();
    await button(page, 'start-work').evaluate((el: HTMLButtonElement) => el.click());
    assert.equal(requests.filter(r => r.path === 'works/work-1/start').length, 1);
  }
  await expect(button(page, 'start-work')).toBeDisabled();
  await button(page, 'start-work').evaluate((el: HTMLButtonElement) => el.click());
  assert.equal(requests.filter(r => r.path === 'works/work-1/start').length, 1);
  await button(page, 'work-menu').click(); await button(page, 'work-info').click();
  wrongWork = true; await button(page, 'check-work').click(); await expect(page.locator('#modal')).toContainText('does not match the original Work');
  wrongWork = false; await button(page, 'check-work').click(); await expect(button(page, 'check-work')).toBeEnabled();
  await button(page, 'close-modal').click(); await expect(button(page, 'start-work')).toBeDisabled();
  state = 'ready'; await button(page, 'work-menu').click(); await button(page, 'work-info').click(); await button(page, 'check-work').click();
  await expect(button(page, 'check-work')).toHaveCount(0);
  await expect(page.locator('[data-action-status]').filter({ hasText: 'Previous result unknown; current object checked' })).toBeVisible();
  assert.equal(requests.filter(r => r.path === 'works/work-1/start').length, 1);
});

test('DWUI-012 readonly file callback after Core switch cannot reopen a file or expose its contents',async t=>{
  const gate=deferred();t.after(async()=>gate.resolve());
  const {page}=await fixture(t,async r=>{
    if(r.path.startsWith('/_desktop/files/')){if(r.method==='GET'){await gate.promise;return{body:'original private file'};}return{status:207,body:listing('original private file',mtime1)};}
  });
  await button(page,'tab-Files').click();await page.locator('[data-action="open-file"][data-path="/note.txt"]').click();
  await expect(page.locator('.file-target-toolbar')).toContainText('note.txt');await expect(page.locator('.read-placeholder')).toHaveAttribute('aria-label','Reading note.txt…');
  await api(page,"await adapter.switchCore('http://new-core.test')");gate.resolve();await expect(page.getByRole('heading',{name:'Connect to your Core'})).toBeVisible();await expect(page.locator('#app')).not.toContainText('original private file');await expect(page.locator('#file-editor')).toHaveCount(0);
});

test('DWUI-011/012 a timed-out configuration read preserves focus, draft and local retry',async t=>{
  const gate=deferred();t.after(async()=>gate.resolve());let armed=false;
  const {page,requests}=await fixture(t,async r=>{if(armed&&r.path==='works/work-1/configuration'){await gate.promise;return{status:503,json:{message:'Configuration readback unavailable. '+ 'A bounded diagnostic detail. '.repeat(8)}};}});
  await button(page,'settings').click();await page.locator('[data-action="settings-section"][data-tab="AGENTS.md"]').click();
  await page.locator('#agents-editor').fill('draft retained while checking');await page.locator('#agents-editor').evaluate((input:HTMLTextAreaElement)=>input.setSelectionRange(3,9));
  armed=true;await button(page,'refresh-config').click();await page.locator('#agents-editor').focus();await page.locator('#agents-editor').evaluate((input:HTMLTextAreaElement)=>input.setSelectionRange(3,9));
  await expect(button(page,'refresh-config')).toHaveAttribute('aria-busy','true');await expect(button(page,'refresh-config').locator('[role="status"]')).toHaveCount(1);
  await expect(page.locator('.settings-page')).toContainText('The read timed out',{timeout:12000});await expect(page.locator('#agents-editor')).toBeFocused();assert.deepEqual(await page.locator('#agents-editor').evaluate((input:HTMLTextAreaElement)=>[input.selectionStart,input.selectionEnd]),[3,9]);
  const screenshots='/tmp/piwork-feedback-screens';await mkdir(screenshots,{recursive:true});
  for(const width of [1440,360]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${screenshots}/desktop-wait-${width}.png`,fullPage:true});}
  gate.resolve();await expect(page.locator('.settings-page')).not.toContainText('Configuration readback unavailable');await expect(page.locator('[data-action-status]')).toHaveCount(0);await expect(page.locator('#agents-editor')).toHaveValue('draft retained while checking');
  armed=false;await button(page,'refresh-config').click();await expect(page.locator('.settings-page')).not.toContainText('The read timed out');await expect(page.locator('#agents-editor')).toHaveValue('draft retained while checking');assert.equal(requests.filter(r=>r.method==='PUT').length,0);
});

test('DWUI-016/017 Create and Stop during preparation converge in list and detail without reload', async t => {
  let created = false, observed = 'provisioning', desired = 'running', version = 1;
  let state = 'running';
  const work = () => ({ id: 'work-1', name: 'Recovery Work', observedState: observed, desiredState: desired, controlVersion: version });
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works' && r.method === 'POST') { created = true; return { json: { operationId: 'op-created', workId: 'work-1', localRecordSaved: false } }; }
    if (r.path === 'works') return { json: { works: created ? [work()] : [] } };
    if (r.path === 'works/work-1') return { json: work() };
    if (r.path === 'works/work-1/stop') { desired = 'stopped'; version++; return { json: { operationId: 'op-stop', workId: 'work-1' } }; }
    if (r.path.startsWith('operations/')) return { json: { operationId: r.path.split('/')[1], workId: 'work-1', kind: r.path.endsWith('op-stop') ? 'stop-work' : 'create-work', state } };
  }, true);
  await page.getByLabel('Account', { exact: true }).fill('owner'); await page.getByLabel('Password').fill('password'); await button(page, 'sign-in').click();
  await button(page, 'new-work').first().click(); await page.locator('#create-name').fill('Recovery Work'); await button(page, 'create-work').click();
  await expect(page.locator('#modal')).toContainText('op-created'); await expect(page.locator('#modal')).toContainText('automatic recovery after reload is not guaranteed');
  await button(page, 'close-modal').click(); await expect(page.locator('.work-row')).toContainText('Preparing');
  await page.locator('[data-action="open-work"]').first().click(); await expect(page.locator('.work-state')).toContainText('Preparing');
  await button(page, 'work-menu').click(); await button(page, 'stop-work').click(); await button(page, 'confirm-stop').click(); await expect(page.locator('#modal')).toContainText('op-stop'); await button(page, 'close-modal').click();
  await expect(page.locator('.work-header')).toContainText('Stop accepted'); assert.equal(await button(page, 'start-work').count(), 0);
  observed = 'stopping'; await api(page, "await adapter.refreshWorkStatus('work-1')"); await expect(page.locator('.work-header')).toContainText('Stopping');
  observed = 'stopped'; state = 'succeeded'; await api(page, "await adapter.checkOperation('op-stop'); await adapter.listWorks(); await adapter.refreshWorkStatus('work-1')");
  await expect(page.getByRole('heading', { name: 'This Work is stopped' })).toBeVisible(); await expect(button(page, 'start-work')).toBeEnabled();
  await button(page, 'back-works').click(); await expect(page.locator('.work-row')).toContainText('Stopped');
  assert.equal(requests.filter(r => r.method === 'POST' && r.path === 'works').length, 1);
  assert.equal(requests.filter(r => r.method === 'POST' && r.path.endsWith('/stop')).length, 1);
});

test('DWUI-016/017 Start to Ready, terminal readback failure and retry preserve original ID and drafts', async t => {
  let observed = 'stopped', desired = 'stopped', accepted = false, terminal = false, fail = false;
  const raw = () => ({ id: 'work-1', name: 'Recovery Work', observedState: observed, desiredState: desired, controlVersion: accepted ? 2 : 1 });
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works/work-1/start') { accepted = true; desired = 'running'; return { json: { operationId: 'original-start', workId: 'work-1' } }; }
    if (r.path === 'operations/original-start') return { json: { operationId: 'original-start', workId: 'work-1', kind: 'start-work', state: terminal ? 'succeeded' : 'running' } };
    if (r.path === 'works' || r.path === 'works/work-1') return fail ? { status: 503, json: { message: 'Work readback unavailable' } } : { json: r.path === 'works' ? { works: [raw()] } : raw() };
  });
  await button(page, 'start-work').click(); await expect(page.locator('.object-control-state')).toContainText('Start Work'); await expect(page.locator('.object-control-progress')).toHaveCount(0); await expect(page.locator('#modal')).toHaveCount(0);
  observed = 'starting'; await api(page, "await adapter.refreshWorkStatus('work-1')"); await expect(page.locator('.work-header')).toContainText('Starting');
  terminal = true; fail = true; await api(page, "await adapter.checkOperation('original-start'); await adapter.refreshWorkStatus('work-1').catch(()=>{}); await adapter.listWorks().catch(()=>{})");
  assert.equal(await api(page, "return adapter.state.operations[0].state"), 'succeeded');
  await expect(page.locator('.work-state')).toContainText('Work readback unavailable');
  fail = false; observed = 'ready'; await api(page, "await adapter.refreshWorkStatus('work-1'); await adapter.listWorks()");
  await expect(page.locator('.work-header')).toContainText('Ready'); await expect(page.locator('#composer')).toBeVisible();
  await page.locator('#composer').fill('keep my task'); await api(page, "await adapter.refreshWorkStatus('work-1')"); await expect(page.locator('#composer')).toHaveValue('keep my task');
  await button(page, 'back-works').click();
  await expect(page.locator('.work-row')).toContainText('Ready');
  await expect(page.locator('.work-row')).not.toContainText('Start Work');
  assert.equal(await api(page, "return adapter.getOperation('original-start')?.id"), 'original-start');
  assert.equal(requests.filter(r => r.method === 'POST' && r.path.endsWith('/start')).length, 1);
});

test('DWUI-019 Files navigation leaves no Checked/ISO stack and Refresh confirmation expires', async t => {
  const { page, requests } = await fixture(t, r => {
    if (r.method !== 'PROPFIND') return;
    const path = r.path.includes('/files/apps') ? r.path.includes('/child') ? '' : 'apps/child/' : 'apps/';
    return { body: `<d:multistatus xmlns:d="DAV:">${path ? `<d:response><d:href>/_desktop/files/works/work-1/files/${path}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>` : ''}</d:multistatus>` };
  });
  await button(page, 'tab-Files').click(); await expect(page.locator('[data-action-status]')).toHaveCount(0);
  await page.locator('[data-action="open-file"][data-path="/apps"]').click(); await expect(page.locator('[data-action-status]')).toHaveCount(0);
  await page.locator('[data-action="open-file"][data-path="/apps/child"]').click(); await expect(page.locator('[data-action-status]')).toHaveCount(0);
  await page.locator('[data-action="file-path"][data-path="/"]').click(); await expect(page.locator('[data-action-status]')).toHaveCount(0);
  await button(page, 'refresh-files').click(); await expect(page.locator('[data-action-status]')).toHaveCount(0, { timeout: 4000 });
  await button(page, 'tab-Services').click(); await expect(page.locator('[data-action-status]')).toHaveCount(0);
  assert.doesNotMatch(await page.locator('#app').innerText(), /· Checked · \d{4}-|Not confirmed.*Checked/);
});

test('DWUI-017 hidden page stops metadata, visible resumes, user Pause survives Close and Back', async t => {
  const { page, requests } = await fixture(t, r => r.path === 'operations/original' ? { json: { operationId: 'original', workId: 'work-1', kind: 'start-work', state: 'running' } } : undefined);
  await api(page, "adapter.accepted({ operationId: 'original', workId: 'work-1' }, 'work-1', 'Start Work'); adapter.pauseOperation('original'); adapter.observePage('work-1', false)");
  const before = requests.length;
  await api(page, "await adapter.pollOperations()"); assert.equal(requests.length, before);
  await api(page, "adapter.observePage('work-1', true); await adapter.pollOperations()");
  assert.equal(requests.filter(r => r.path === 'operations/original').length, 0);
  await button(page, 'work-operations').click(); await expect(button(page, 'resume-operation')).toBeVisible();
  await button(page, 'close-modal').click(); await button(page, 'back-works').click();
  assert.equal(await api(page, "return adapter.operationPaused('original')"), true);
  await api(page, "adapter.resumeOperation('original'); await adapter.pollOperations()");
  assert.ok(requests.some(r => r.path === 'operations/original'));
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
});

test('DWUI-018 reload recovers original Stop through canonical kind and reaches Stopped in list', async t => {
  let stopped = false;
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'known-operations') return { json: { operations: [{ operationId: 'persisted-stop', workId: 'work-1', type: 'Work action' }] } };
    if (r.path === 'operations/persisted-stop') return { json: { operationId: 'persisted-stop', workId: 'work-1', kind: 'stop-work', state: stopped ? 'succeeded' : 'running' } };
    if (r.path === 'works' || r.path === 'works/work-1') { const raw = { id: 'work-1', name: 'Recovery Work', desiredState: 'stopped', observedState: stopped ? 'stopped' : 'stopping', controlVersion: 3 }; return { json: r.path === 'works' ? { works: [raw] } : raw }; }
  });
  await page.reload(); await expect(page.locator('.work-header')).toContainText('Stopping');
  await button(page, 'work-operations').click(); await expect(page.locator('#modal')).toContainText('persisted-stop'); await button(page, 'close-modal').click();
  await button(page, 'back-works').click(); await expect(page.locator('.work-row')).toContainText('Stopping');
  stopped = true; await expect(page.locator('.work-row')).toContainText('Stopped', { timeout: 10000 });
  await expect(page.locator('.work-row [data-action="start-work"]')).toBeEnabled();
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
});

test('DWUI-OPREC-001 recovered Work control is available on its own row and checks only the original task', async t => {
  const raw = { id: 'work-1', name: 'Recovery Work', desiredState: 'stopped', observedState: 'stopping', controlVersion: 3 };
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'known-operations') return { json: { operations: [{ operationId: 'original-stop', workId: 'work-1', type: 'Work action' }] } };
    if (r.path === 'operations/original-stop') return { json: { operationId: 'original-stop', workId: 'work-1', kind: 'stop-work', state: 'running' } };
    if (r.path === 'works' || r.path === 'works/work-1') return { json: r.path === 'works' ? { works: [raw] } : raw };
  });
  await api(page, "await adapter.checkOperation('original-stop')");
  await button(page, 'back-works').click();
  const row = page.locator('.work-row').filter({ hasText: 'Recovery Work' });
  // The row keeps one compact state; original details and the read-only check
  // are on demand from that Work's own menu.
  await expect(row.locator('.object-control-state')).toContainText('Stop Work');
  await expect(row.locator('.object-control-progress')).toHaveCount(0);
  await row.locator('[data-action="work-menu"]').click();
  await button(page,'work-current-tasks').click();
  await page.locator('#modal [data-action="operation"][data-id="original-stop"]').click();
  await button(page,'check-operation').click();
  assert.ok(requests.some(r => r.method === 'GET' && r.path === 'operations/original-stop'));
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
});

test('DWUI-OPREC-001 a converged successful Work task leaves the row while its original details remain reachable', async t => {
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'known-operations') return { json: { operations: [{ operationId: 'finished-start', workId: 'work-1', type: 'Work action' }] } };
    if (r.path === 'operations/finished-start') return { json: { operationId: 'finished-start', workId: 'work-1', kind: 'start-work', state: 'succeeded' } };
  });
  await api(page, "await adapter.checkOperation('finished-start'); await adapter.refreshWorkStatus('work-1'); await adapter.listWorks()");
  await button(page, 'back-works').click();
  await expect(page.locator('.work-row .object-control-progress')).toHaveCount(0);
  await expect(page.locator('.work-row .object-control-state')).toHaveCount(0);
  await workTasks(page); await page.locator('#operation-query').fill('finished-start'); await button(page, 'lookup-operation').click();
  await page.locator('.operation-technical > summary').click(); await expect(page.locator('.operation-technical')).toContainText('finished-start');
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
});

test('DWUI-OPREC-001 a newer Stop replaces the older Start in the Work progress area', async t => {
  const stopped = { id: 'work-1', name: 'Recovery Work', desiredState: 'stopped', observedState: 'stopped', controlVersion: 1 };
  const { page } = await fixture(t, r => {
    if (r.path === 'works' || r.path === 'works/work-1') return { json: r.path === 'works' ? { works: [stopped] } : stopped };
    if (r.path === 'works/work-1/start') return { json: { operationId: 'old-start', workId: 'work-1' } };
    if (r.path === 'works/work-1/stop') return { json: { operationId: 'new-stop', workId: 'work-1' } };
  });
  await button(page, 'back-works').click(); await button(page, 'start-work').click();
  await api(page, "await adapter.lifecycle('work-1', 'stop')");
  // One task shows one state in the row's existing status slot; the original
  // Operation details and the read-only check stay in that Work's own menu.
  const progress = page.locator('.work-row .object-control-state');
  await expect(progress).toContainText('Stop Work');
  await expect(page.locator('.work-row .object-control-progress')).toHaveCount(0);
  await page.locator('.work-row').filter({ hasText: 'Recovery Work' }).locator('[data-action="work-menu"]').click();
  await button(page,'work-current-tasks').click();
  await expect(page.locator('#modal')).toContainText('Stop Work');
  await expect(page.locator('#modal [data-id="new-stop"]')).toBeVisible();
  // The superseded Start is not the current target, so the menu does not present
  // it as the Work's outstanding task; its original result stays queryable.
  await expect(page.locator('#modal .operation-list [data-id="new-stop"]')).toHaveCount(1);
});

test('DWUI-OPREC-002 orphaned imports and deletions remain reachable after reload, search and an empty list', async t => {
  let empty = false;
  const records = [
    { operationId: 'import-original', workId: 'work-import', type: 'Import Work' },
    { operationId: 'delete-original', workId: 'work-deleted', type: 'Work action' },
    ...['2', '3', '4'].map(id => ({ operationId: `import-${id}`, workId: `work-import-${id}`, type: 'Import Work' })),
  ];
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'known-operations') return { json: { operations: records } };
    if (r.path.startsWith('operations/')) {
      const id = r.path.split('/')[1]!;
      const record = records.find(item => item.operationId === id)!;
      return { json: { operationId: id, workId: record.workId, kind: id === 'delete-original' ? 'delete-work' : 'import-work', state: id === 'delete-original' ? 'failed' : 'running', ...(id === 'delete-original' ? { error: { message: 'Cleanup failed safely' } } : {}) } };
    }
    if (r.path === 'works') return { json: { works: empty ? [] : [{ id: 'work-1', name: 'Recovery Work', observedState: 'ready', desiredState: 'running' }] } };
  });
  await button(page, 'back-works').click();
  await api(page, "await Promise.all(adapter.state.operations.map(op => adapter.checkOperation(op.id)))");
  await openWorksTasks(page);
  await expect(page.locator('.recovery-task[data-operation-id="import-original"]')).toContainText('Import Work');
  await expect(page.locator('.recovery-task[data-operation-id="import-original"]')).toContainText('Task 1');
  await expect(page.locator('.recovery-task[data-operation-id="delete-original"]')).toContainText('Cleanup failed safely');
  await expect(page.locator('.recovery-tasks > details')).toContainText('Show 2 more tasks');
  // The helper already expanded the tail; a second toggle would collapse it.
  await expect(page.locator('.recovery-task[data-operation-id="import-4"]')).toBeVisible();
  await expect(page.locator('.recovery-task[data-operation-id="import-4"]')).toContainText('Task 5');
  await page.locator('#search').fill('not-a-match');
  await expect(page.locator('.recovery-task[data-operation-id="import-original"]')).toBeVisible();
  empty = true; await api(page, 'await adapter.listWorks()');
  await expect(page.locator('.recovery-task[data-operation-id="delete-original"]')).toBeVisible();
  await page.reload();
  await openWorksTasks(page);
  await expect(page.locator('.recovery-task[data-operation-id="import-original"]')).toBeVisible();
  await page.locator('.recovery-task[data-operation-id="import-original"] [data-action="check-task-operation"]').click();
  await page.locator('.recovery-task[data-operation-id="import-original"] [data-action="operation"]').click();
  await expect(page.locator('#modal')).toContainText('Import Work');
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
});

test('DWUI-OPREC-002 an accepted Create remains on Works when its object cannot be read', async t => {
  let listFails = false;
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works' && listFails) return { status: 503, json: { message: 'List unavailable' } };
    if (r.path === 'operations/create-original') return { json: { operationId: 'create-original', workId: 'work-new', kind: 'create-work', state: 'running' } };
    if (r.path === 'works/work-new') return { status: 503, json: { message: 'Work unavailable' } };
  });
  await button(page, 'back-works').click();
  await api(page, "adapter.accepted({ operationId: 'create-original', workId: 'work-new' }, '', 'Create Work'); await adapter.checkOperation('create-original')");
  listFails = true; await api(page, 'await adapter.listWorks().catch(() => {})');
  await openWorksTasks(page);
  await expect(page.locator('.recovery-task[data-operation-id="create-original"]')).toContainText('Create Work');
  await expect(page.locator('.works-error-cause, .feedback').filter({ hasText: 'List unavailable' }).first()).toBeVisible();
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
});

test('DWUI-OPREC-002 reload restores original tasks while the first Work list is delayed or fails', async t => {
  let listFails = false;
  const gate = deferred(); t.after(async () => gate.resolve());
  const records = [
    { operationId: 'reload-create', workId: 'work-new', type: 'Create Work', kind: 'create-work' },
    { operationId: 'reload-import', workId: 'work-import', type: 'Import Work', kind: 'import-work' },
    { operationId: 'reload-delete', workId: 'work-deleted', type: 'Work action', kind: 'delete-work' },
  ];
  const { page, requests } = await fixture(t, async r => {
    if (r.path === 'known-operations') return { json: { operations: records } };
    const task = records.find(item => r.path === `operations/${item.operationId}`);
    if (task) return { json: { operationId: task.operationId, workId: task.workId, kind: task.kind, state: 'running' } };
    if (r.path === 'works' && listFails) { await gate.promise; return { status: 503, json: { message: 'List unavailable' } }; }
  });
  await button(page, 'back-works').click();
  await openWorksTasks(page);
  await expect(page.locator('.recovery-task[data-operation-id="reload-import"]')).toBeVisible();
  const previousReads = requests.filter(r => r.path === 'known-operations').length;
  listFails = true; await page.reload();
  await expect.poll(() => requests.filter(r => r.path === 'known-operations').length).toBeGreaterThan(previousReads);
  await openWorksTasks(page);
  for (const task of records) await expect(page.locator(`.recovery-task[data-operation-id="${task.operationId}"]`)).toBeVisible();
  gate.resolve(); await expect(page.locator('.works-error-cause')).toBeVisible();
  for (const task of records) await expect(page.locator(`.recovery-task[data-operation-id="${task.operationId}"]`)).toBeVisible();
  await page.locator('.recovery-task[data-operation-id="reload-import"] [data-action="operation"]').click();
  await expect(page.locator('#modal')).toContainText('Import Work');
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
});

test('DWUI-OPREC-002 a confirmed created Work takes over its original task from the temporary hint', async t => {
  let published = false;
  const existing = { id: 'work-1', name: 'Recovery Work', observedState: 'ready', desiredState: 'running' };
  const created = { id: 'work-new', name: 'New Work', observedState: 'starting', desiredState: 'running' };
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works') return { json: { works: published ? [existing, created] : [existing] } };
    if (r.path === 'operations/create-original') return { json: { operationId: 'create-original', workId: 'work-new', kind: 'create-work', state: 'running' } };
  });
  await button(page, 'back-works').click();
  await api(page, "adapter.accepted({ operationId: 'create-original', workId: 'work-new' }, '', 'Create Work'); await adapter.checkOperation('create-original')");
  await openWorksTasks(page);
  await expect(page.locator('.recovery-task[data-operation-id="create-original"]')).toBeVisible();
  published = true; await api(page, 'await adapter.listWorks()');
  await expect(page.locator('.recovery-task[data-operation-id="create-original"]')).toHaveCount(0);
  // The created Work takes the task over in its own status slot; the original
  // Operation ID stays reachable from that Work's menu.
  // The task left the temporary list even while the disclosure stays open.
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal')).toHaveCount(0);
  const created_row = page.locator('.work-row').filter({ hasText: 'New Work' });
  await expect(created_row.locator('.object-control-state')).toContainText('Create Work');
  await created_row.locator('[data-action="work-menu"]').click();
  await button(page,'work-current-tasks').click();
  await expect(page.locator('#modal [data-action="operation"][data-id="create-original"]')).toBeVisible();
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
});

for (const suspended of [false, true]) test(`DWUI-OPREC-002 an unknown Import recovers acceptance with dialog observation ${suspended ? 'paused' : 'active'}`, async t => {
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'work-packages/transfer-original') return { json: { transferId: 'transfer-original', phase: 'accepted', operationId: 'import-recovered', workId: 'work-import', name: 'Imported name', localRecordSaved: true } };
    if (r.path === 'operations/import-recovered') return { json: { operationId: 'import-recovered', workId: 'work-import', kind: 'import-work', state: 'running' } };
  });
  await button(page, 'back-works').click();
  await api(page, "adapter.inspectionTransfer='transfer-original'; adapter.inspectionContext={id:'transfer-original',nonce:1,core:'http://core.test',localSession:'local-session-csrf',ready:true,anonymous:false,importState:'unknown'}; adapter.emit()");
  if (suspended) await api(page, 'adapter.suspendImportObservation()');
  await openWorksTasks(page);
  await expect(page.locator('.recovery-task[data-transfer-id="transfer-original"]')).toContainText('Result unknown');
  await page.locator('.recovery-task[data-transfer-id="transfer-original"] [data-action="check-inspection-import"]').click();
  await expect(page.locator('.recovery-task[data-operation-id="import-recovered"]')).toContainText('Imported name');
  assert.equal(await api(page, "return adapter.inspectionContext.operationId"), 'import-recovered');
  assert.equal(requests.filter(r => r.method === 'POST' && r.path === 'work-imports').length, 0);
});

test('DWUI-OPREC-002 create can find a copied original ID without a saved record or Work', async t => {
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'operations/wrong-kind') return { json: { operationId: 'wrong-kind', workId: 'work-other', kind: 'import-work', state: 'running' } };
    if (r.path === 'operations/original-no-record') return { json: { operationId: 'original-no-record', workId: 'work-unpublished', kind: 'create-work', state: 'failed', error: { message: 'Original task failed' } } };
  });
  await page.setViewportSize({ width: 360, height: 900 });
  await button(page, 'back-works').click(); await button(page, 'new-work').click();
  await page.locator('.original-task-lookup > summary').click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('#operation-query').fill('wrong-kind'); await button(page, 'lookup-create-operation').click();
  await expect(page.locator('#modal')).toContainText('does not match the original action');
  assert.equal(await api(page, "return !!adapter.getOperation('wrong-kind')"), false);
  if (!await page.locator('.original-task-lookup').evaluate(el => el.hasAttribute('open'))) await page.locator('.original-task-lookup > summary').click();
  await page.locator('#operation-query').fill('original-no-record'); await button(page, 'lookup-create-operation').click();
  await expect(page.locator('#modal')).toContainText('Original task failed');
  await page.locator('.operation-technical > summary').click(); await expect(page.locator('.operation-technical')).toContainText('original-no-record');
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
});

test('DWUI-OPREC-001 a previous snapshot is found only within the original Work', async t => {
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'work-snapshots/snapshot-other') return { json: { snapshotId: 'snapshot-other', workId: 'work-other', operationId: 'op-other', state: 'succeeded', size: 4, digest: 'hash', expiresAt: '2099-01-01T00:00:00Z' } };
    if (r.path === 'work-snapshots/snapshot-original') return { json: { snapshotId: 'snapshot-original', workId: 'work-1', operationId: 'op-original', state: 'succeeded', size: 4, digest: 'hash', expiresAt: '2099-01-01T00:00:00Z' } };
  });
  await button(page, 'work-menu').click(); await button(page, 'find-previous-export').click();
  await page.locator('#snapshot-query').fill('snapshot-other'); await button(page, 'lookup-snapshot').click();
  await expect(page.locator('#modal')).toContainText('does not match');
  assert.equal(await api(page, "return !!adapter.getSnapshot('snapshot-other')"), false);
  await page.locator('#snapshot-query').fill('snapshot-original'); await button(page, 'lookup-snapshot').click();
  await page.locator('.export-details > summary').click();
  await expect(page.locator('.export-snapshot')).toContainText('snapshot-original');
  assert.equal(requests.filter(r => r.method === 'POST' && r.path.endsWith('/exports')).length, 0);
});

test('DWUI-016 create validation retains field and execution failure offers Retry only for running goal', async t => {
  let failed = false, stoppedGoal = false;
  const { page } = await fixture(t, r => {
    if (r.path === 'works' && r.method === 'POST') return { status: 400, json: { message: 'Image is unavailable. Choose a supported image.' } };
    if (r.path === 'works/work-1' && failed) return { json: { id: 'work-1', name: 'Recovery Work', observedState: 'failed', desiredState: stoppedGoal ? 'stopped' : 'running', controlVersion: stoppedGoal ? 3 : 2, lastError: { message: 'readiness failure' } } };
  });
  await button(page, 'back-works').click(); await button(page, 'new-work').first().click(); await page.locator('#create-name').fill('Do not lose this name'); await button(page, 'create-work').click();
  await expect(page.locator('#modal')).toContainText('Image is unavailable'); await expect(page.locator('#create-name')).toHaveValue('Do not lose this name'); await expect(button(page, 'create-work')).toBeEnabled();
  await button(page, 'close-modal').click(); await page.locator('[data-action="open-work"]').first().click();
  await expect(page.locator('#composer')).toBeVisible(); failed = true; await api(page, "await adapter.refreshWorkStatus('work-1')");
  await expect(page.locator('.work-state')).toContainText('readiness failure'); await expect(button(page, 'start-work')).toHaveText('Retry Work');
  stoppedGoal = true; await api(page, "await adapter.refreshWorkStatus('work-1')");
  await expect(button(page, 'check-work').first()).toBeEnabled(); assert.equal(await button(page, 'start-work').count(), 0);
});

test('DWUI-016 accepted Stop also prevents Apply while saved settings and editor remain available', async t => {
  let stoppedGoal = false;
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works/work-1/stop') { stoppedGoal = true; return { json: { operationId: 'stop-settings', workId: 'work-1' } }; }
    if (r.path === 'works/work-1' && stoppedGoal) return { json: { id: 'work-1', name: 'Recovery Work', observedState: 'ready', desiredState: 'stopped' } };
    if (r.path === 'works/work-1/configuration') return { json: { desired: { skills: [], packages: [], agentsMd: 'saved instructions', mcp: { servers: [] } }, active: { skills: [], packages: [], agentsMd: '', mcp: { servers: [] } }, pendingApply: true, runtime: { state: 'ready' } } };
  });
  await button(page, 'settings').click();
  await expect(button(page, 'apply-config')).toBeEnabled();
  await api(page, "await adapter.lifecycle('work-1', 'stop')"); await expect(button(page, 'apply-config')).toBeDisabled();
  await page.locator('[data-action="settings-section"][data-tab="AGENTS.md"]').click(); await page.locator('#agents-editor').fill('settings preserved after accepted Stop');
  await expect(button(page, 'save-config').last()).toBeEnabled();
  assert.equal(requests.filter(r => r.path.endsWith('/configuration/apply') && r.method === 'POST').length, 0);
});

test('DWUI-OPREC-001 Apply and Package recovery stay in Settings and preserve a draft on readback failure', async t => {
  let applyState = 'running', configFails = false;
  const records = [
    { operationId: 'original-apply', workId: 'work-1', type: 'Apply Work configuration' },
    { operationId: 'original-package', workId: 'work-1', type: 'Pi Package action' },
  ];
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'known-operations') return { json: { operations: records } };
    if (r.path === 'operations/original-apply') return { json: { operationId: 'original-apply', workId: 'work-1', kind: 'apply-work-configuration', state: applyState } };
    if (r.path === 'operations/original-package') return { json: { operationId: 'original-package', workId: 'work-1', kind: 'pi-package-install', state: 'failed', error: { message: 'Package preparation failed' } } };
    if (r.path === 'works/work-1/configuration') return configFails ? { status: 503, json: { message: 'Configuration read unavailable' } } : { json: { desired: { skills: [], packages: [], agentsMd: 'saved', mcp: { servers: [] } }, active: { skills: [], packages: [], agentsMd: '', mcp: { servers: [] } }, pendingApply: true, runtime: { state: 'ready' } } };
  });
  await api(page, "await Promise.all(adapter.state.operations.map(op => adapter.checkOperation(op.id)))");
  await button(page, 'settings').click();
  await expect(page.locator('.configuration-state')).toContainText('Applying');
  await expect(page.locator('.configuration-state [data-action="operation"][data-id="original-apply"]')).toBeVisible();
  await page.locator('[data-action="settings-section"][data-tab="Pi Packages"]').click();
  await expect(page.locator('.settings-task[data-operation-id="original-package"]')).toContainText('Package preparation failed');
  await page.locator('[data-action="settings-section"][data-tab="AGENTS.md"]').click();
  await page.locator('#agents-editor').fill('Keep my newer draft');
  applyState = 'succeeded'; configFails = true;
  await page.locator('.configuration-state [data-action="check-task-operation"][data-id="original-apply"]').click();
  await expect(page.locator('#agents-editor')).toHaveValue('Keep my newer draft');
  await expect(page.locator('.settings-page')).toContainText('Configuration read unavailable');
  assert.equal(await api(page, "return adapter.getOperation('original-apply').state"), 'succeeded');
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
});

test('DWUI-OPREC-001 a new Apply remains in Settings after acceptance', async t => {
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works/work-1/configuration') return { json: { desired: { skills: [], packages: [], agentsMd: 'saved', mcp: { servers: [] } }, active: { skills: [], packages: [], agentsMd: '', mcp: { servers: [] } }, pendingApply: true, runtime: { state: 'ready' } } };
    if (r.path === 'works/work-1/configuration/apply') return { json: { operationId: 'apply-new', workId: 'work-1' } };
    if (r.path === 'operations/apply-new') return { json: { operationId: 'apply-new', workId: 'work-1', kind: 'apply-work-configuration', state: 'running' } };
  });
  await button(page, 'settings').click(); await button(page, 'apply-config').click();
  await expect(page.locator('#modal')).toHaveCount(0);
  await expect(page.locator('.configuration-state')).toContainText('Applying');
  await expect(page.locator('.configuration-state [data-action="operation"][data-id="apply-new"]')).toBeVisible();
  assert.equal(requests.filter(r => r.method === 'POST' && r.path.endsWith('/configuration/apply')).length, 1);
});

test('DWUI-OPREC-001 an unsaved Apply record stays visible and points to its copyable original ID', async t => {
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works/work-1/configuration') return { json: { desired: { skills: [], packages: [], agentsMd: 'saved', mcp: { servers: [] } }, active: {}, pendingApply: true, runtime: { state: 'ready' } } };
    if (r.path === 'works/work-1/configuration/apply') return { json: { operationId: 'unsaved-apply', workId: 'work-1', localRecordSaved: false } };
    if (r.path === 'operations/unsaved-apply') return { json: { operationId: 'unsaved-apply', workId: 'work-1', kind: 'apply-work-configuration', state: 'running' } };
  });
  await button(page, 'settings').click(); await button(page, 'apply-config').click();
  await expect(page.locator('.settings-page')).toContainText('The record was not saved');
  await page.locator('.settings-page [data-action="operation"][data-id="unsaved-apply"]').click();
  await expect(page.locator('#modal')).toContainText('automatic recovery after reload is not guaranteed');
  await page.locator('.operation-technical > summary').click(); await expect(page.locator('.operation-technical')).toContainText('unsaved-apply');
  assert.equal(requests.filter(r => r.method === 'POST' && r.path.endsWith('/configuration/apply')).length, 1);
});

test('DWUI-OPREC-003 failure details present recorded facts, escape text and copy the full folded ID', async t => {
  const id = `op-${'long-identifier-'.repeat(12)}end`;
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'known-operations') return { json: { operations: [{ operationId: id, workId: 'new-work', type: 'Create Work' }] } };
    if (r.path === `operations/${id}`) return { json: { operationId: id, workId: 'new-work', kind: 'create-work', state: 'failed', correlationId: 'corr-123', error: { code: 'AGENT_EXITED', stage: 'readiness', message: 'Agent <img src=x onerror=alert(1)> exited', remediation: 'Check the runtime', retryable: false, exitCode: 0, secret: 'not-for-display' }, diagnostics: { stages: [{ component: 'agent', stage: 'readiness', outcome: 'failed', message: 'Recorded <script>stage</script>' }], rollback: { state: 'failed', error: { code: 'ROLLBACK_FAILED', stage: 'rollback', message: 'Rollback failed', remediation: 'Check recovery' } }, diagnosticCollection: { state: 'unavailable', code: 'DIAGNOSTIC_COLLECTION_FAILED' } } } };
  });
  await api(page, `await adapter.checkOperation(${JSON.stringify(id)})`);
  await button(page, 'back-works').click(); await openWorksTasks(page); await page.locator('.recovery-task [data-action="operation"]').click();
  const dialog = page.locator('#modal'), technical = dialog.locator('.operation-technical');
  await expect(dialog).toContainText('Agent <img src=x onerror=alert(1)> exited');
  await expect(dialog).toContainText('Check the runtime');
  await expect(dialog).toContainText('A more specific cause was not recorded');
  await expect(dialog.locator('img, script')).toHaveCount(0);
  await expect(technical).not.toHaveAttribute('open');
  await expect(technical.locator('code').filter({ hasText: id })).toBeHidden();
  await technical.locator('summary').click();
  await expect(technical).toContainText('AGENT_EXITED'); await expect(technical).toContainText('readiness');
  await expect(technical).toContainText('corr-123'); await expect(technical).toContainText('Recorded <script>stage</script>');
  await expect(technical).toContainText('ROLLBACK_FAILED'); await expect(technical).toContainText('Check recovery'); await expect(technical).toContainText('DIAGNOSTIC_COLLECTION_FAILED');
  await expect(technical).not.toContainText('not-for-display');
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { (window as any).copiedOperationId = value; } } }); });
  await technical.getByRole('button', { name: 'Copy Operation ID' }).click();
  assert.equal(await page.evaluate(() => (window as any).copiedOperationId), id);
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
});

test('DWUI-OPREC-003 missing or partial failure evidence never invents an underlying cause', async t => {
  const records = ['missing', 'generic'];
  const { page } = await fixture(t, r => {
    if (r.path === 'known-operations') return { json: { operations: records.map(id => ({ operationId: id, workId: `work-${id}`, type: 'Import Work' })) } };
    if (records.some(id => r.path === `operations/${id}`)) {
      const id = r.path.split('/')[1]!;
      return { json: { operationId: id, workId: `work-${id}`, kind: 'import-work', state: 'failed', error: id === 'generic' ? { code: 'WORK_OPERATION_FAILED', stage: 'create', message: 'The Work operation failed.' } : { message: {}, remediation: ['invalid'] } } };
    }
  });
  await api(page, 'await Promise.all(adapter.state.operations.map(op => adapter.checkOperation(op.id)))'); await button(page, 'back-works').click();
  await openWorksTasks(page);
  for (const id of records) {
    await openWorksTasks(page);
    await page.locator(`.recovery-task[data-operation-id="${id}"] [data-action="operation"]`).click();
    await expect(page.locator('#modal')).toContainText('A more specific cause was not recorded');
    await expect(page.locator('#modal')).not.toContainText('[object Object]');
    await expect(page.locator('#modal')).not.toContainText('credential conflict');
    await expect(page.locator('#modal [data-action="operation-service-logs"]')).toHaveCount(0);
    await button(page, 'close-modal').click();
  }
});

test('DWUI-OPREC-003 generic failure codes do not masquerade as an underlying cause', async t => {
  const records = [
    { id: 'mcp-symptom', code: 'MCP_INITIALIZATION_FAILED', message: 'A required Work MCP server could not be initialized.', expected: 'A more specific cause was not recorded' },
    { id: 'package-symptom', code: 'PACKAGE_LOAD_FAILED', message: 'A selected package could not be loaded.', expected: 'A more specific cause was not recorded' },
    { id: 'service-symptom', code: 'SERVICE_STATE_UNCONFIRMED', message: 'The service container state is not confirmed.', expected: 'A more specific cause was not recorded' },
    { id: 'future-code', code: 'FUTURE_FAILURE', message: 'A future failure was reported.', expected: 'The underlying cause has not been confirmed' },
    { id: 'specific-cause', code: 'WORK_BUSY', message: 'The Work has an active Run.', expected: '' },
  ];
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'known-operations') return { json: { operations: records.map(item => ({ operationId: item.id, workId: `work-${item.id}`, type: 'Create Work' })) } };
    const item = records.find(entry => r.path === `operations/${entry.id}`);
    if (item) return { json: { operationId: item.id, workId: `work-${item.id}`, kind: 'create-work', state: 'failed', error: { code: item.code, stage: 'runtime-prepare', message: item.message } } };
  });
  await api(page, 'await Promise.all(adapter.state.operations.map(op => adapter.checkOperation(op.id)))');
  await button(page, 'back-works').click();
  await openWorksTasks(page);
  await page.locator('.recovery-tasks > details > summary').click();
  for (const item of records) {
    await openWorksTasks(page);
    await page.locator(`.recovery-task[data-operation-id="${item.id}"] [data-action="operation"]`).click();
    const dialog = page.locator('#modal'); await expect(dialog).toContainText(item.message);
    if (item.expected) await expect(dialog).toContainText(item.expected);
    else { await expect(dialog).not.toContainText('A more specific cause was not recorded'); await expect(dialog).not.toContainText('The underlying cause has not been confirmed'); }
    await button(page, 'close-modal').click();
  }
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
});

for (const source of ['service', 'apply'] as const) test(`DWUI-OPREC-003 ${source} diagnostic Service log link stays scoped and shows denied access`, async t => {
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'known-operations') return { json: { operations: [{ operationId: 'service-failed', workId: 'work-1', ...(source === 'service' ? { serviceId: 'svc-a' } : {}), type: source === 'service' ? 'Service action' : 'Apply Work configuration' }] } };
    if (r.path === 'operations/service-failed') return { json: { operationId: 'service-failed', workId: 'work-1', ...(source === 'service' ? { serviceId: 'svc-a' } : {}), kind: source === 'service' ? 'restart-service' : 'apply-work-configuration', state: 'failed', error: { code: 'SERVICE_START_FAILED', serviceId: 'svc-a', message: 'Service failed' } } };
    if (r.path === 'works/work-1/services') return { json: { services: [{ serviceId: 'svc-a', name: 'Service A', enabled: true, observedState: 'failed' }, { serviceId: 'svc-b', name: 'Service B', enabled: true, observedState: 'ready' }] } };
    if (r.path === 'works/work-1/services/svc-a/logs') return { status: 403, json: { message: 'Logs access denied' } };
  });
  await api(page, "await adapter.checkOperation('service-failed')");
  if (source === 'service') {
    await button(page, 'tab-Services').click(); await button(page, 'manage-services').click();
    await page.locator('#modal [data-action="service-details"][data-id="svc-a"]').click();
    await page.locator('#modal [data-action="operation"][data-id="service-failed"]').click();
  } else {
    await button(page, 'settings').click();
    await page.locator('.settings-page [data-action="operation"][data-id="service-failed"]').click();
  }
  await expect(button(page, 'operation-service-logs')).toBeVisible();
  await button(page, 'operation-service-logs').click();
  await expect(page.locator('#modal')).toContainText('Logs access denied');
  assert.ok(requests.some(r => r.method === 'GET' && r.path === 'works/work-1/services/svc-a/logs'));
  assert.equal(requests.filter(r => r.path === 'works/work-1/services/svc-b/logs').length, 0);
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
});

for (const width of [360, 1440]) test(`DWUI-OPREC-004 task recovery remains usable at ${width}px with reduced motion and long values`, async t => {
  const id = `op-${'long-id-'.repeat(26)}`;
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'known-operations') return { json: { operations: [{ operationId: id, workId: '', type: 'Import Work' }] } };
    if (r.path === `operations/${id}`) return { json: { operationId: id, workId: '', kind: 'import-work', state: 'failed', error: { message: 'A long task needs attention' } } };
  });
  await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await api(page, `await adapter.checkOperation(${JSON.stringify(id)}); adapter.getOperation(${JSON.stringify(id)}).importName='long-name-'.repeat(25); adapter.emit()`); await button(page, 'back-works').click();
  await openWorksTasks(page);
  const task = page.locator('.recovery-task').first(); await expect(task).toContainText('A long task needs attention');
  await expect.poll(() => page.locator('.brand-logo').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  if (process.env.PIWORK_TEST_SCREENSHOT_DIR) { await mkdir(process.env.PIWORK_TEST_SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: `${process.env.PIWORK_TEST_SCREENSHOT_DIR}/recovery-list-${width}.png`, fullPage: true }); }
  const details = task.locator('[data-action="operation"]'); await page.keyboard.press('Tab'); await details.focus();
  await expect(details).toBeFocused();
  assert.ok(await details.evaluate(el => parseFloat(getComputedStyle(el).outlineWidth)) >= 2);
  await page.keyboard.press('Enter'); await expect(page.locator('#modal')).toBeVisible();
  await page.locator('.operation-technical > summary').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.operation-technical code').filter({ hasText: id })).toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (process.env.PIWORK_TEST_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PIWORK_TEST_SCREENSHOT_DIR}/recovery-details-${width}.png`, fullPage: true });
  await page.keyboard.press('Escape'); await expect(page.locator('#modal')).toHaveCount(0);
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
});

test('DWUI-017 closed Start details still recover Ready and original lookup without reload or replay', async t => {
  let accepted = false, offline = false;
  const fact = () => ({ id: 'work-1', name: 'Recovery Work', desiredState: accepted ? 'running' : 'stopped', observedState: accepted ? 'ready' : 'stopped', controlVersion: accepted ? 2 : 1 });
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works/work-1/start') { accepted = true; offline = true; return { json: { operationId: 'cleared-start', workId: 'work-1' } }; }
    if (r.path === 'operations/cleared-start') return { json: { operationId: 'cleared-start', workId: 'work-1', kind: 'start-work', state: 'succeeded' } };
    if (r.path === 'known-operations/cleared-start' && r.method === 'DELETE') return { json: {} };
    if (r.path === 'works' || r.path === 'works/work-1') return offline ? { status: 503, json: { message: 'readback offline' } } : { json: r.path === 'works' ? { works: [fact()] } : fact() };
  });
  const navigations: string[] = []; page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push(request.url()); });
  await button(page, 'start-work').click(); await button(page, 'work-menu').click(); await button(page,'work-current-tasks').click(); await expect(page.locator('#modal .operation-list')).toContainText('Start Work');
  await page.locator('#modal [data-action="operation"][data-id="cleared-start"]').click(); await expect(page.locator('#modal')).toContainText('cleared-start');
  await api(page, "await adapter.checkOperation('cleared-start'); await adapter.refreshWorkStatus('work-1').catch(() => {}); await adapter.listWorks().catch(() => {})");
  await button(page, 'close-modal').click(); await workTasks(page);
  await page.locator('#operation-query').fill('cleared-start'); await button(page, 'lookup-operation').click();
  await expect(page.locator('#modal')).toContainText('cleared-start'); await button(page, 'check-operation').click();
  await expect(page.locator('#modal')).toContainText('succeeded'); await button(page, 'close-modal').click();
  offline = false;
  await expect(page.locator('.work-header')).toContainText('Ready', { timeout: 10000 });
  await expect(page.locator('#composer')).toBeVisible(); await button(page, 'work-menu').click(); await expect(button(page, 'stop-work')).toBeEnabled(); await page.keyboard.press('Escape');
  assert.equal(await api(page, "return adapter.getWork('work-1').lifecycleIntent"), undefined);
  assert.equal(requests.filter(r => r.path === 'works/work-1/start' && r.method === 'POST').length, 1);
  assert.deepEqual(navigations, []);
});

test('DWUI-017 browser B publishes multiple two-second updates while A response stays pending', async t => {
  const gate = deferred(); t.after(async () => gate.resolve());
  let observed = 'starting';
  const b = () => ({ id: 'work-b', name: 'Independent B', desiredState: 'running', observedState: observed, controlVersion: 2 });
  const a = { id: 'work-1', name: 'Recovery Work', desiredState: 'running', observedState: 'ready', controlVersion: 2 };
  const times: number[] = [];
  const { page, requests } = await fixture(t, async r => {
    if (r.path === 'works') return { json: { works: [a, b()] } };
    if (r.path === 'operations/hanging-a') { await gate.promise; return { json: { operationId: 'hanging-a', workId: 'work-1', kind: 'start-work', state: 'running' } }; }
    if (r.path === 'operations/active-b') { times.push(Date.now()); return { json: { operationId: 'active-b', workId: 'work-b', kind: 'start-work', state: 'running' } }; }
    if (r.path === 'works/work-b') return { json: b() };
  });
  await button(page, 'back-works').click();
  await api(page, "adapter.state.operations = [{ id: 'hanging-a', workId: 'work-1', kind: 'Start Work', action: 'start', state: 'running' }, { id: 'active-b', workId: 'work-b', kind: 'Start Work', action: 'start', state: 'running' }]; adapter.scheduleOperationPoll();");
  const row = page.locator('.work-row').filter({ hasText: 'Independent B' });
  await expect.poll(() => times.length, { timeout: 4000 }).toBe(1);
  observed = 'ready'; await expect(row).toContainText('Ready', { timeout: 3500 });
  observed = 'degraded'; await expect(row).toContainText('Degraded', { timeout: 3500 });
  assert.ok(times.length >= 3); for (const interval of times.slice(1).map((time, i) => time - times[i]!)) assert.ok(interval >= 1700 && interval < 3000, `B interval ${interval}ms`);
  assert.equal(requests.filter(r => r.path === 'operations/hanging-a').length, 1);
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
});

test('C01 Work with no Services opens Chat and preserves it on reentry', async t => {
  const { page, requests } = await fixture(t, () => undefined);
  await expect(button(page, 'tab-Chat')).toHaveClass(/active/);
  await button(page, 'tab-Chat').click(); await expect(button(page, 'tab-Chat')).toHaveClass(/active/);
  await button(page, 'back-works').click(); await page.locator('.work-name[data-id="work-1"]').click();
  await expect(button(page, 'tab-Chat')).toHaveClass(/active/);
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
});

test('C01 Work reentry restores Files path and falls back only for a missing directory', async t => {
  let removed = false;
  const { page, requests } = await fixture(t, r => {
    if (r.method !== 'PROPFIND') return;
    const child = r.path.endsWith('/tree/');
    if (child && removed) return { status: 404 };
    return { status: 207, body: `<d:multistatus xmlns:d="DAV:">${!child && !removed ? '<d:response><d:href>/_desktop/files/works/work-1/files/tree/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>' : ''}</d:multistatus>` };
  });
  await button(page, 'tab-Files').click(); await page.locator('[data-action=open-file][data-path="/tree"]').click();
  await expect(page.locator('.breadcrumbs')).toContainText('tree');
  await button(page, 'back-works').click(); await page.locator('.work-name[data-id="work-1"]').click();
  await expect(button(page, 'tab-Files')).toHaveClass(/active/); await expect(page.locator('.breadcrumbs')).toContainText('tree');
  await button(page, 'back-works').click(); removed = true; await page.locator('.work-name[data-id="work-1"]').click();
  await expect(button(page, 'tab-Files')).toHaveClass(/active/); await expect(page.locator('.main-panel')).toContainText('previous folder is no longer available');
  await expect(page.locator('.breadcrumbs [data-path="/tree"]')).toHaveCount(0);
  assert.equal(requests.filter(r => !['GET', 'PROPFIND'].includes(r.method)).length, 0);
});

test('C02 list Start keeps original local progress and gates Open Work on real readiness', async t => {
  let started = false, terminal = false, ready = false;
  const raw = () => ({ id: 'work-1', name: 'Recovery Work', observedState: !started || terminal && !ready ? 'stopped' : ready ? 'ready' : 'starting', desiredState: started ? 'running' : 'stopped', controlVersion: started ? 2 : 1 });
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works' || r.path === 'works/work-1') return { json: r.path === 'works' ? { works: [raw()] } : raw() };
    if (r.path === 'works/work-1/start') { started = true; return { json: { operationId: 'c02-start', workId: 'work-1' } }; }
    if (r.path === 'operations/c02-start') return { json: { operationId: 'c02-start', workId: 'work-1', kind: 'start-work', state: terminal ? 'succeeded' : 'running' } };
  });
  await button(page, 'back-works').click(); await button(page, 'start-work').click();
  await expect(page.locator('.work-row .object-control-state')).toContainText('Start Work');
  await expect(page.locator('.work-row .object-control-progress')).toHaveCount(0);
  await expect(page.locator('#modal')).toHaveCount(0); await expect(page.locator('.works-page')).toBeVisible();
  // The read-only check lives in the Work's own menu, next to its original task.
  const checkFromMenu = async () => { await page.locator('.work-row').filter({ hasText: 'Recovery Work' }).locator('[data-action="work-menu"]').click(); await button(page,'work-history').click(); await page.locator('#modal [data-action=operation][data-id=c02-start]').click(); await button(page,'check-operation').click(); await button(page,'close-modal').click(); await expect(page.locator('#modal')).toHaveCount(0); };
  terminal = true; await checkFromMenu();
  await expect(page.getByRole('link', { name: 'Open Work', exact: true })).toHaveCount(0);
  ready = true; await checkFromMenu();
  await expect(page.getByRole('link', { name: 'Open Work', exact: true })).toBeVisible();
  await expect(page.locator('.works-page')).toBeVisible();
  await page.getByRole('link', { name: 'Open Work', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recovery Work', exact: true })).toBeVisible();
  assert.equal(requests.filter(r => r.path === 'works/work-1/start' && r.method === 'POST').length, 1);
});

for (const exit of ['close', 'view', 'start'] as const) test(`C03 Import ${exit} preserves explicit Start and original identities`, async t => {
  let imported = false, started = false, ready = false;
  const original = { id: 'work-1', name: 'Recovery Work', observedState: 'ready', desiredState: 'running' };
  const restored = () => ({ id: 'imported', name: 'Imported sample', observedState: started ? ready ? 'ready' : 'starting' : 'stopped', desiredState: started ? 'running' : 'stopped', controlVersion: started ? 2 : 1 });
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works') return { json: { works: imported ? [original, restored()] : [original] } };
    if (r.path === 'works/imported') return { json: restored() };
    if (r.path === 'work-packages' && r.method === 'POST') return { json: { transferId: r.headers['x-piwork-transfer-id'], summary: { sourceName: 'sample package', integrityVerified: true } } };
    if (r.path === 'work-imports') { imported = true; return { json: { operationId: 'c03-import', workId: 'imported' } }; }
    if (r.path === 'operations/c03-import') return { json: { operationId: 'c03-import', workId: 'imported', kind: 'import-work', state: 'succeeded' } };
    if (r.path === 'works/imported/start') { started = true; return { json: { operationId: 'c03-start', workId: 'imported' } }; }
    if (r.path === 'operations/c03-start') return { json: { operationId: 'c03-start', workId: 'imported', kind: 'start-work', state: ready ? 'succeeded' : 'running' } };
  });
  await button(page, 'back-works').click(); await button(page, 'import').click();
  await page.locator('#work-file-input').setInputFiles({ name: 'sample.work', mimeType: 'application/vnd.piwork.work-package', buffer: Buffer.from('synthetic inspected package') });
  await expect(page.locator('.import-result')).toContainText('sample package');
  await button(page, 'confirm-import').click(); await button(page, 'check-operation').click();
  await expect(page.locator('#modal-title')).toHaveText('Imported · Not started');
  assert.equal(requests.filter(r => r.path.endsWith('/start') && r.method === 'POST').length, 0);
  if (exit === 'close') await button(page, 'close-modal').click();
  if (exit === 'view') { await page.getByRole('link', { name: 'View Work', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Imported sample', exact: true })).toBeVisible(); }
  if (exit === 'start') {
    await button(page, 'start-import-open').click();
    await expect(page.locator('#modal')).toContainText('c03-import'); await expect(page.locator('#modal')).toContainText('c03-start');
    await expect(button(page, 'start-import-open')).toHaveCount(0); await expect(page).toHaveURL(/#\/works$/);
    ready = true; await button(page, 'check-work-progress').click();
    await expect(page.getByRole('heading', { name: 'Imported sample', exact: true })).toBeVisible();
  }
  assert.equal(requests.filter(r => r.path === 'work-imports' && r.method === 'POST').length, 1);
  assert.equal(requests.filter(r => r.path === 'works/imported/start' && r.method === 'POST').length, exit === 'start' ? 1 : 0);
});

for (const outcome of ['failed', 'observation-unknown', 'submission-unknown'] as const) test(`C03 Import Start ${outcome} preserves the original request and never opens before confirmed completion`, async t => {
  let imported = false, started = false, observed = 'stopped', startState = 'running', observationUnavailable = false;
  const importId = `c03-import-${outcome}`, startId = `c03-start-${outcome}`;
  const original = { id: 'work-1', name: 'Recovery Work', observedState: 'ready', desiredState: 'running' };
  const restored = () => ({ id: 'imported', name: 'Imported recovery', observedState: observed, desiredState: started ? 'running' : 'stopped', controlVersion: started ? 2 : 1 });
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works') return { json: { works: imported ? [original, restored()] : [original] } };
    if (r.path === 'works/imported') return { json: restored() };
    if (r.path === 'work-packages' && r.method === 'POST') return { json: { transferId: r.headers['x-piwork-transfer-id'], summary: { sourceName: 'recovery package', integrityVerified: true } } };
    if (r.path === 'work-imports' && r.method === 'POST') { imported = true; return { json: { operationId: importId, workId: 'imported' } }; }
    if (r.path === `operations/${importId}`) return { json: { operationId: importId, workId: 'imported', kind: 'import-work', state: 'succeeded' } };
    if (r.path === 'works/imported/start' && r.method === 'POST') { started = true; observed = 'starting'; return outcome === 'submission-unknown' ? { abort: true } : { json: { operationId: startId, workId: 'imported' } }; }
    if (r.path === `operations/${startId}`) return observationUnavailable ? { status: 503, json: { message: 'Original Start observation temporarily unavailable' } } : { json: { operationId: startId, workId: 'imported', kind: 'start-work', state: startState } };
  });
  const submissions = () => requests.filter(r => r.method === 'POST' && ['work-imports', 'works/imported/start'].includes(r.path)).map(r => r.path);
  await button(page, 'back-works').click(); await button(page, 'import').click();
  await page.locator('#work-file-input').setInputFiles({ name: 'recovery.work', mimeType: 'application/vnd.piwork.work-package', buffer: Buffer.from('synthetic recovery package') });
  await expect(page.locator('.import-result')).toContainText('recovery package');
  await button(page, 'confirm-import').click(); await button(page, 'check-operation').click();
  await expect(page.locator('#modal-title')).toHaveText('Imported · Not started');
  assert.deepEqual(submissions(), ['work-imports']);
  await button(page, 'start-import-open').click();
  await expect(page.locator('#modal')).toContainText(importId); await expect(button(page, 'start-import-open')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/works$/);
  const progress = page.locator('#modal [data-action="check-work-progress"][data-id="imported"]');
  if (outcome === 'submission-unknown') {
    await expect(page.locator('#modal .object-control-progress')).toContainText('Result unknown');
    await expect(page.locator('#modal .object-control-progress [data-action="operation"]')).toHaveCount(0);
    await progress.click(); await expect(progress).toBeEnabled(); await expect(page).toHaveURL(/#\/works$/);
    observed = 'ready'; await progress.click(); await expect(progress).toBeEnabled();
    await expect(page.locator('#modal .object-control-progress')).toContainText('Original outcome unknown · current target checked');
    await expect(page).toHaveURL(/#\/works$/);
    assert.equal(requests.filter(r => r.path === `operations/${startId}`).length, 0, 'a lost acceptance must not invent a Start Operation ID');
    await page.getByRole('link', { name: 'View Work', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Imported recovery', exact: true })).toBeVisible();
  } else {
    await expect(page.locator('#modal')).toContainText(startId);
    if (outcome === 'failed') { startState = 'failed'; observed = 'failed'; }
    else observationUnavailable = true;
    await progress.click(); await expect(progress).toBeEnabled();
    await expect(page.locator('#modal .object-control-progress')).toContainText(outcome === 'failed' ? 'failed' : 'Original Start observation temporarily unavailable');
    await expect(page).toHaveURL(/#\/works$/);
    await expect(page.locator('#modal')).toContainText(importId); await expect(page.locator('#modal')).toContainText(startId);
    await expect(page.locator('#modal').getByRole('button', { name: 'Open Work', exact: true })).toHaveCount(0);
    if (outcome === 'observation-unknown') {
      observationUnavailable = false; startState = 'succeeded';
      await progress.click(); await expect(progress).toBeEnabled(); await expect(page).toHaveURL(/#\/works$/);
      await expect(page.locator('#modal').getByRole('button', { name: 'Open Work', exact: true })).toHaveCount(0);
      assert.equal(await api(page, `return adapter.getOperation('${startId}').state`), 'succeeded');
      assert.equal(await api(page, "return adapter.getWork('imported').status"), 'Starting');
      observed = 'ready'; await progress.click();
      await expect(page.getByRole('heading', { name: 'Imported recovery', exact: true })).toBeVisible();
      await expect(page).toHaveURL(/#\/work\/imported$/);
    } else {
      observed = 'ready'; await progress.click(); await expect(progress).toBeEnabled(); await expect(page).toHaveURL(/#\/works$/);
      await expect(page.locator('#modal')).toContainText(startId);
    }
  }
  assert.deepEqual(submissions(), ['work-imports', 'works/imported/start']);
});

for (const width of [360, 500]) test(`Action hierarchy: narrow Files controls remain visible without selection row shifts at ${width}px`, async t => {
  const { page, requests } = await fixture(t, r => r.method === 'PROPFIND' ? { status: 207, body: listing('original', mtime1) } : undefined);
  await page.setViewportSize({ width, height: 800 });
  await expect(button(page, 'work-menu')).toBeVisible();
  await button(page, 'tab-Files').click();
  await expect(page.getByText('Select files for actions', { exact: true })).toHaveCount(0);
  const row = page.locator('.file-row').first(), select = row.locator('[data-file-select]');
  const before = await row.boundingBox(); assert.ok(before);
  for (const selected of [true, false]) {
    await select.setChecked(selected);
    const after = await row.boundingBox(); assert.ok(after); assert.ok(Math.abs(after.y - before.y) <= 1);
    const toolbar = await page.locator('.files-toolbar').boundingBox(), actions = await page.locator('.file-toolbar-actions').boundingBox();
    assert.ok(toolbar && actions); assert.ok(actions.y + actions.height <= toolbar.y + toolbar.height + 1, 'toolbar contains its actions');
    for (const action of selected ? ['file-copy', 'file-move', 'file-delete', 'clear-selection'] : ['refresh-files', 'file-add']) await expect(button(page, action)).toBeVisible();
    if (!selected) { await button(page,'file-add').click(); for (const action of ['upload','new-folder','webdav']) await expect(button(page,action)).toBeVisible(); await page.keyboard.press('Escape'); }
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(requests.filter(request => request.method !== 'GET' && request.path.startsWith('/_desktop/files/') && !['PROPFIND','HEAD'].includes(request.method)).length, 0);
});

test('Files upload with unknown total keeps real bytes and stops animation at failure', async t => {
  const { page } = await fixture(t, r => r.method === 'PROPFIND' ? { status: 207, body: listing('original', mtime1) } : undefined);
  await button(page, 'tab-Files').click();
  await api(page, "adapter.uploadProgress.set('work-1',{scope:'files',path:'sample.txt',phase:'Uploading',transferred:42,index:1,count:1}); adapter.emit()");
  const trigger = button(page, 'file-add'); await expect(trigger.locator('.pending-dots')).toHaveCount(1);
  await expect(trigger).toHaveAttribute('aria-label', /42 bytes/); await trigger.click();
  await page.locator('.file-upload-details summary').focus(); await page.keyboard.press('Enter'); await expect(page.locator('.file-upload-details')).toContainText('42 bytes');
  await expect(page.locator('.file-upload-details progress')).toHaveCount(0);
  await api(page, "adapter.uploadProgress.set('work-1',{scope:'files',path:'sample.txt',phase:'failed',error:'failed',transferred:42,index:1,count:1}); adapter.emit()");
  await expect(trigger.locator('.pending-dots')).toHaveCount(0);
});

test('pending independent: automatic model save ends on unknown while the draft and original lock remain', async t => {
  const gate = deferred(); t.after(() => gate.resolve());
  const { page, requests } = await fixture(t, async r => {
    if (r.path === 'works/work-1/sessions/session-1/model' && r.method === 'PATCH') { await gate.promise; return { abort: true }; }
  });
  await page.locator('#composer').fill('Keep this new draft');
  await api(page, "adapter.selectModel('work-1', 'session-1', 'model-test-0000000001')");
  await expect(page.locator('.options-status .pending-dots')).toHaveCount(1);
  await expect(page.locator('.options-status')).toContainText('Saving');
  if (process.env.PIWORK_UI_EVIDENCE === '1') { await mkdir('dist/server-ui-core-flow/desktop', { recursive: true }); await page.screenshot({ path: 'dist/server-ui-core-flow/desktop/chat-model-saving-fixture.png', fullPage: true }); }
  gate.resolve(); await expect(page.locator('.options-status')).toContainText('Unconfirmed');
  await expect(page.locator('.options-status .pending-dots')).toHaveCount(0);
  await expect(page.locator('#composer')).toHaveValue('Keep this new draft');
  assert.equal(await api(page, "return adapter.modelSelection('work-1','session-1').phase"), 'unknown');
  assert.equal(requests.filter(r => r.path.endsWith('/model') && r.method === 'PATCH').length, 1);
});

test('pending independent: Activity has one indicator only for the observed live Run and preserves expanded output', async t => {
  const { page } = await fixture(t, () => undefined);
  await api(page, `const w = adapter.getWork('work-1'), session = w.sessions.find(s => s.id === 'session-1');
    w.run = { id: 'run-active', sessionId: session.id, status: 'running', cursor: 1 };
    session.messages.push({ id: 'tool-current', role: 'tool', text: '', runId: 'run-active', tool: { id: 'tool-current', name: 'read', status: 'Running', content: 'Keep this output' } });
    adapter.emit();`);
  await expect(page.locator('.reply-slot .pending-dots')).toHaveCount(1);
  await expect(page.locator('.activity .pending-dots')).toHaveCount(1);
  await page.locator('.activity > summary').click(); await page.locator('.tool-event > summary').click();
  await page.locator('.tool-event .tool-result-preview').evaluate(el => { (window as any).originalToolOutput = el; });
  await api(page, "adapter.getWork('work-1').run.status = 'interrupted'; adapter.emit();");
  await expect(page.locator('.activity .pending-dots')).toHaveCount(0);
  assert.equal(await page.locator('.tool-event .tool-result-preview').evaluate(el => el === (window as any).originalToolOutput), true);
  await expect(page.locator('.tool-event .tool-result-preview')).toBeVisible();
});

for (const previous of ['Failed', 'Result not confirmed']) test(`pending Activity: a running tool remains visible beside a ${previous} result`, async t => {
  const { page } = await fixture(t, () => undefined);
  await api(page, `const w = adapter.getWork('work-1'), session = w.sessions.find(s => s.id === 'session-1');
    w.run = { id: 'run-mixed', sessionId: session.id, status: 'running', cursor: 2 };
    session.messages.push(
      { id: 'tool-prior', role: 'tool', text: '', runId: 'run-mixed', tool: { id: 'tool-prior', name: 'prior', status: '${previous}', content: 'Keep the earlier diagnostic' } },
      { id: 'tool-current', role: 'tool', text: '', runId: 'run-mixed', tool: { id: 'tool-current', name: 'current', status: 'Running', content: 'Current output' } });
    adapter.emit();`);
  await expect(page.locator('#messages .pending-dots')).toHaveCount(1);
  await expect(page.locator('.activity')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.activity > summary')).toContainText('Running');
  await page.locator('.activity > summary').click();
  await expect(page.locator('.tool-event').first()).toContainText(previous);
  await page.locator('.tool-event > summary').first().click();
  await expect(page.locator('.tool-event .tool-result-preview').first()).toHaveText('Keep the earlier diagnostic');
  await api(page, "adapter.getWork('work-1').run.status = 'interrupted'; adapter.emit();");
  await expect(page.locator('#messages .pending-dots')).toHaveCount(0);
  await expect(page.locator('.tool-event .tool-result-preview').first()).toBeVisible();
});

for (const withTool of [false, true]) test(`pending active Run: failed observation stops ${withTool ? 'Activity' : 'execution'} dots while retaining the last Run`, async t => {
  const { page } = await fixture(t, () => undefined);
  await api(page, `const w = adapter.getWork('work-1'), session = w.sessions.find(s => s.id === 'session-1');
    w.run = undefined;
    adapter.activeRuns.set(w.id, { confirmed: true, loading: false, error: '', run: { id: 'run-observed', sessionId: session.id, status: 'running' } });
    adapter.cancelAndSendCapabilities.set(w.id, 1);
    session.messages.push({ id: 'observed-message', role: '${withTool ? 'tool' : 'assistant'}', text: '${withTool ? '' : 'Last confirmed output'}', runId: 'run-observed', ${withTool ? "tool: { id: 'observed-tool', name: 'read', status: 'Running', content: 'Last tool output' }" : ''} });
    adapter.emit();`);
  await expect(page.locator('#messages .pending-dots')).toHaveCount(1);
  await api(page, "adapter.activeRuns.get('work-1').error = 'Active Run observation unavailable'; adapter.emit();");
  await expect(page.locator('#messages .pending-dots')).toHaveCount(0);
  await expect(page.locator('.message-execution [data-action=run-details]')).toHaveAttribute('data-run-id','run-observed');
  assert.equal(await api(page, "return adapter.activeRuns.get('work-1').run.id"), 'run-observed');
  await api(page, "adapter.getWork('work-1').run = { ...adapter.activeRuns.get('work-1').run, cursor: 2 }; adapter.emit();");
  await expect(page.locator('#messages .pending-dots')).toHaveCount(1);
  await api(page, "adapter.getWork('work-1').run.error = 'Live Run observation also interrupted'; adapter.emit();");
  await expect(page.locator('#messages .pending-dots')).toHaveCount(0);
});

test('Run wait renders at the assistant reply position and real content replaces it in place', async t => {
  const { page } = await fixture(t, () => undefined);
  const before = await page.locator('#composer').boundingBox();
  await api(page, `const w = adapter.getWork('work-1'), session = w.sessions.find(s => s.id === 'session-1');
    w.run = undefined;
    adapter.activeRuns.set(w.id, { confirmed: true, loading: false, error: '', run: { id: 'run-slot', sessionId: session.id, status: 'running' } });
    adapter.cancelAndSendCapabilities.set(w.id, 1);
    session.messages.push({ id: 'slot-user', role: 'user', text: 'hello', runId: 'run-slot' });
    adapter.emit();`);
  const slot = page.locator('#messages .reply-slot');
  await expect(slot).toHaveCount(1);
  await expect(slot.locator('.pending-dots')).toHaveCount(1);
  await expect(slot).toHaveAttribute('data-run-id', 'run-slot');
  // One primary wait: the execution summary must not animate a second set.
  await expect(page.locator('#messages .pending-dots')).toHaveCount(1);
  // The original Cancel entry stays reachable, exactly once.
  await expect(page.getByRole('button', { name: 'Cancel run', exact: true })).toHaveCount(1);
  // The wait belongs to the messages flow, above the composer, which does not move.
  const after = await page.locator('#composer').boundingBox();
  for (const key of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(before![key] - after![key]) <= 1, `composer ${key} moved`);
  // Real content arriving ends the wait in place, leaving the reply readable.
  await api(page, `const w = adapter.getWork('work-1'), session = w.sessions.find(s => s.id === 'session-1');
    adapter.activeRuns.set(w.id, { confirmed: true, loading: false, error: '', run: { ...adapter.activeRuns.get(w.id).run, status: 'succeeded' } });
    session.messages.push({ id: 'slot-reply', role: 'assistant', text: 'The real answer', runId: 'run-slot' });
    adapter.emit();`);
  await expect(page.locator('#messages .reply-slot')).toHaveCount(0);
  await expect(page.locator('#messages')).toContainText('The real answer');
  await expect(page.locator('#composer')).toHaveValue('');
});

test('Agent status follows the actual reply, uses shared aligned dots, and stops on unknown or terminal state', async t => {
  const { page } = await fixture(t, () => undefined);
  await page.setViewportSize({width:360,height:800});
  await page.emulateMedia({reducedMotion:'reduce'});
  await api(page, `const w=adapter.getWork('work-1'),session=w.sessions.find(s=>s.id==='session-1');
    w.run={id:'run-live-status',sessionId:session.id,status:'running',cursor:0,created:''};
    session.messages.push({id:'status-user',role:'user',text:'Hello',runId:w.run.id});adapter.emit();`);
  const status=page.locator('.reply-slot[data-run-id="run-live-status"]');
  await expect(status).toHaveAttribute('aria-label','Waiting for the reply');await expect(status).toHaveText('');
  await api(page, `const w=adapter.getWork('work-1'),session=w.sessions.find(s=>s.id==='session-1');
    session.messages.push({id:'status-tool',role:'assistant',text:'',runId:w.run.id,tool:{id:'call',name:'read',status:'Running',content:''}});adapter.emit();`);
  await expect(page.locator('.activity > summary .reply-slot')).toHaveCount(1);
  await expect(page.locator('#messages .pending-dots')).toHaveCount(1);
  await api(page, `const w=adapter.getWork('work-1'),session=w.sessions.find(s=>s.id==='session-1');
    session.messages.at(-1).tool.status='Completed';session.messages.push({id:'status-reply',role:'assistant',text:'Partial answer',runId:w.run.id});adapter.emit();`);
  await expect(page.locator('.message.assistant .message-text .reply-slot')).toHaveCount(1);
  const order=await status.evaluate(el=>[...el.children].map(node=>node.className));assert.deepEqual(order,['pending-dots']);
  await expect(status).toHaveText('');
  await page.evaluate("import('/desktop/browser/locale.js').then(locale => locale.chooseLocale('zh-CN'))");
  await expect(status).toHaveAttribute('aria-label','正在等待回复');
  await expect(status.locator('.pending-dots i').first()).toHaveCSS('animation-name','none');
  await api(page,"adapter.getWork('work-1').run.error='Observation unavailable';adapter.emit();");await expect(status).toHaveCount(0);
  await api(page,"const run=adapter.getWork('work-1').run;run.error=undefined;run.status='cancelling';adapter.emit();");await expect(status).toHaveAttribute('aria-label','正在取消…');
  await api(page,"adapter.getWork('work-1').run.status='cancelled';adapter.emit();");await expect(status).toHaveCount(0);
});

test('pending independent: About aggregates version reads and keeps the known version during refresh', async t => {
  const gate = deferred(); t.after(() => gate.resolve()); let held = false;
  const about = (program: string) => ({ aboutApiVersion: 1, build: { program, version: 'fixture-v1', commit: 'synthetic', os: 'linux', architecture: 'amd64' } });
  const { page } = await fixture(t, async r => { if (r.path === 'about' || r.path === 'core-about') { if (held) await gate.promise; return { json: about(r.path) }; } });
  await button(page, 'back-works').click(); await button(page, 'account').click(); await button(page, 'about-piwork').click();
  await expect(page.locator('#modal')).toContainText('fixture-v1'); await expect(page.locator('#modal .pending-dots')).toHaveCount(0);
  const geometry=await button(page,'refresh-about').boundingBox();held = true; await button(page, 'refresh-about').click();
  await expect(page.locator('#modal .pending-dots')).toHaveCount(1); await expect(page.locator('#modal')).toContainText('fixture-v1');
  assert.deepEqual(await button(page,'refresh-about').boundingBox(),geometry);
  gate.resolve(); await expect(page.locator('#modal .pending-dots')).toHaveCount(0);
});

// Session chooser presentation uses the production renderer with synthetic API responses.
for (const width of [1440, 360]) test(`Session chooser presentation stays readable at ${width}px`, async t => {
  let stress = false;
  const longTitle = 'release-notes-' + 'verylongunbrokentoken'.repeat(7);
  const { page, requests } = await fixture(t, r => {
    if (/\/sessions\/extra-/.test(r.path)) return { json: { session: { workId: 'work-1', sessionId: r.path.split('/').at(-1) }, messages: [], runs: [] } };
    if (r.path.endsWith('/sessions') && r.method === 'GET') return { json: { sessions: stress
      ? [{ sessionId: 'session-1', title: 'Release planning' }, { sessionId: 'session-2', title: longTitle }, ...Array.from({ length: 12 }, (_, i) => ({ sessionId: `extra-${i}`, title: `Conversation ${i + 3}` }))]
      : [{ sessionId: 'session-1', title: 'Release planning' }] } };
  });
  await page.setViewportSize({ width, height: 900 });
  await button(page, 'sessions').click();
  await expect(page.locator('#modal [role=option]')).toHaveCount(1);
  await expect.poll(() => api(page, `return !!adapter.getWork('work-1').resourceLoading?.agent`)).toBe(false);
  await api(page, `adapter.getWork('work-1').run = { id: 'run-fixture', sessionId: 'session-1', status: 'running', text: '', cursor: 0 }; adapter.emit();`);
  const selected = page.locator('#modal [aria-selected=true]');
  await expect(selected).toContainText('running');
  const phase = process.env.PIWORK_SESSION_EVIDENCE;
  const output = process.env.PIWORK_SESSION_SCREENSHOTS;
  if (output) { await mkdir(output, { recursive: true }); await page.screenshot({ path: `${output}/sessions-${phase || 'after'}-${width}.png` }); }
  if (phase !== 'before') {
    await expect(page.locator('#modal')).toHaveClass(/session-picker/);
    await expect(selected).toBeFocused();
    await expect(selected.locator('.session-choice-check')).toHaveCount(1);
    await expect(page.locator('#modal [data-action=close-modal]')).toHaveCount(1);
    await expect(page.locator('#modal .modal-footer')).toHaveCount(0);
    await expect(page.locator('#modal [data-action=new-session]')).not.toHaveClass(/primary/);
    const spacing = await page.evaluate(() => {
      const a = document.querySelector('#modal [data-action=new-session]')!.getBoundingClientRect();
      const b = document.querySelector('#modal [role=listbox]')!.getBoundingClientRect();
      return b.top - a.bottom;
    });
    assert.ok(spacing >= 10, `command/list gap ${spacing}`);
  }
  await page.keyboard.press('Escape');
  if (phase !== 'before') await expect(button(page, 'sessions')).toBeFocused();
  stress = true;
  await button(page, 'sessions').click();
  await expect(page.locator('#modal [role=option]')).toHaveCount(14);
  if (output) await page.screenshot({ path: `${output}/sessions-${phase || 'after'}-long-${width}.png` });
  if (phase === 'before') return;
  await expect(page.locator('#modal .session-choice-title').nth(1)).toHaveText(longTitle);
  const geometry = await page.locator('#modal').evaluate(el => {
    const panel = el.getBoundingClientRect(), title = el.querySelectorAll('.session-choice-title')[1]!.getBoundingClientRect();
    const body = el.querySelector('.modal-body')!;
    return { left: panel.left, right: panel.right, width: innerWidth, titleLeft: title.left, titleRight: title.right, scrollWidth: body.scrollWidth, clientWidth: body.clientWidth };
  });
  assert.ok(geometry.left >= 0 && geometry.right <= width);
  assert.ok(geometry.titleLeft >= geometry.left && geometry.titleRight <= geometry.right);
  assert.ok(geometry.scrollWidth <= geometry.clientWidth, 'long labels must not cause horizontal overflow');
  await page.setViewportSize({ width, height: 480 });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.locator('#modal [role=option]').first().focus();
  await page.keyboard.press('End');
  const last = page.locator('#modal [role=option]').last();
  await expect(last).toBeFocused();
  await expect.poll(() => last.evaluate(el => { const r = el.getBoundingClientRect(), body = el.closest('.modal-body')!.getBoundingClientRect(); return { visible: r.top >= body.top - 1 && r.bottom <= body.bottom + 1, top: r.top, bottom: r.bottom, bodyTop: body.top, bodyBottom: body.bottom }; })).toMatchObject({ visible: true });
  if (output) await page.screenshot({ path: `${output}/sessions-${phase || 'after'}-short-${width}.png` });
  await page.keyboard.press('Enter'); await expect(page.locator('#modal')).toHaveCount(0);
  await page.locator('#sessions-trigger').click();
  const reopened = page.locator('#modal [aria-selected=true]');
  await expect(reopened).toHaveAttribute('data-id', 'extra-11'); await expect(reopened).toBeFocused();
  await expect.poll(() => reopened.evaluate(el => { const r=el.getBoundingClientRect(), b=el.closest('.modal-body')!.getBoundingClientRect(); return r.top >= b.top - 1 && r.bottom <= b.bottom + 1; })).toBe(true);
  await expect(page.locator('#sessions-trigger')).toBeEnabled();
  await page.keyboard.press('Escape'); await expect(page.locator('#sessions-trigger')).toBeFocused();
  await button(page, 'sessions').click();
  await page.keyboard.press('Home'); await expect(page.locator('#modal [role=option]').first()).toBeFocused();
  await expect(button(page, 'sessions')).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => ({id:document.activeElement?.id, tag:document.activeElement?.tagName, action:(document.activeElement as HTMLElement)?.dataset.action, modal:!!document.querySelector('#modal')}))).toEqual({id:'session-current-trigger',tag:'BUTTON',action:'sessions',modal:false});
  assert.equal(requests.filter(r => r.method === 'POST').length, 0, 'opening and keyboard navigation never mutate Sessions or Runs');
});

test('Session chooser keyboard switching retains drafts and creating remains single pending action', async t => {
  const create = deferred(); t.after(async () => create.resolve());
  const { page, requests } = await fixture(t, async r => {
    if (r.path.endsWith('/sessions') && r.method === 'POST') { await create.promise; return { json: { sessionId: 'session-new' } }; }
    if (r.path.endsWith('/sessions')) return { json: { sessions: [{ sessionId: 'session-1' }, { sessionId: 'session-2' }] } };
    if (r.path.endsWith('/sessions/session-2') || r.path.endsWith('/sessions/session-new')) return { json: { session: { workId: 'work-1', sessionId: r.path.split('/').at(-1) }, messages: [], runs: [] } };
  });
  await page.locator('#composer').fill('Keep my session one draft');
  await button(page, 'sessions').click();
  await expect(page.locator('#modal [data-id=session-1]')).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(page.locator('#modal [data-id=session-2]')).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.locator('#modal')).toHaveCount(0);
  await expect(page.locator('#messages')).toHaveAttribute('data-reading-key', /session-2$/);
  await expect(page.locator('#composer')).toHaveValue('');
  await button(page, 'sessions').click(); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  await expect(page.locator('#composer')).toHaveValue('Keep my session one draft');
  await button(page, 'sessions').click(); await button(page, 'new-session').click();
  await expect(button(page, 'new-session')).toBeDisabled();
  await expect(page.locator('#modal .pending-dots')).not.toHaveCount(0);
  assert.equal(requests.filter(r => r.method === 'POST' && r.path.endsWith('/sessions')).length, 1);
  create.resolve(); await expect(page.locator('#modal')).toHaveCount(0);
  await expect(page.locator('#messages')).toHaveAttribute('data-reading-key', /session-new$/);
  assert.equal(requests.filter(r => r.method === 'POST' && !r.path.endsWith('/sessions')).length, 0);
});

test('Session chooser retains rows during a failed refresh and retries to a confirmed empty list', async t => {
  const read = deferred(); t.after(async () => read.resolve());
  let mode = 'ready';
  const { page, requests } = await fixture(t, async r => {
    if (r.path.endsWith('/sessions') && r.method === 'GET') {
      if (mode === 'pending') { await read.promise; return { status: 503, json: { code: 'UNAVAILABLE', message: 'Session list unavailable' } }; }
      if (mode === 'failed') return { status: 503, json: { code: 'UNAVAILABLE', message: 'Session list unavailable' } };
      if (mode === 'empty') return { json: { sessions: [] } };
    }
  });
  mode = 'pending'; await button(page, 'sessions').click();
  await expect(page.locator('#modal [role=option]')).toHaveCount(1);
  await expect(page.locator('#modal .session-list')).toHaveAttribute('aria-busy','true');await expect(page.locator('#modal .session-list .pending-dots')).toHaveCount(0);
  await expect(button(page, 'sessions')).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(page.locator('#modal')).toHaveCount(0);
  assert.equal(await page.evaluate(() => { const el = document.activeElement as HTMLElement; return el !== document.body && !!el.getClientRects().length && !el.hasAttribute('disabled') && !el.closest('#modal'); }), true, 'a locked trigger falls back to another available workspace control');
  mode = 'failed'; read.resolve(); await expect(button(page, 'sessions')).toBeEnabled();
  await button(page, 'sessions').click();
  await expect(page.locator('#modal')).toContainText('Conversations could not be read');
  await expect(page.locator('#modal [role=option]')).toHaveCount(1);
  await expect(page.locator('#modal')).not.toContainText('No Sessions yet');
  mode = 'empty'; await page.locator('#modal [data-action=retry-conversation]').click();
  await expect(page.locator('#modal')).toContainText('No Sessions yet');
  await expect(page.locator('#modal')).not.toContainText('Conversations could not be read');
  await expect(page.locator('#modal [data-action=new-session]')).toBeEnabled();
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
});

test('paged replies expose Work file links only after the saved message is complete', async t => {
  const { page, requests } = await fixture(t, () => undefined);
  await api(page, `const session = adapter.getWork('work-1').sessions.find(s => s.id === 'session-1');
    session.messages.push({ id: 'paged-file-reply', role: 'assistant',
      text: '[report.txt](piwork-file:/output/report.txt)', historyIncomplete: true });
    adapter.emit();`);
  await expect(page.locator('#messages')).not.toContainText('Part of this message is not loaded.');
  await page.locator('[data-action=chat-history-status]').click();await expect(page.locator('#modal')).toContainText('Part of this message is not loaded.');await page.keyboard.press('Escape');
  await expect(page.locator('a.chat-file-link')).toHaveCount(0);
  await api(page, `const session = adapter.getWork('work-1').sessions.find(s => s.id === 'session-1');
    session.messages.find(message => message.id === 'paged-file-reply').historyIncomplete = false;
    adapter.emit();`);
  const link = page.locator('a.chat-file-link');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveText('report.txt');
  await expect(link).toHaveAttribute('data-path', '/output/report.txt');
  await expect(link).toHaveAttribute('href', /#\/work\/work-1\//);
  await expect(page.locator('.history-partial')).toHaveCount(0);
  assert.equal(requests.filter(record => record.path.startsWith('/_desktop/files/')).length, 0);
  assert.equal(requests.filter(record => record.method === 'POST').length, 0);
});

test('delivered file links open current Files content, bounded image previews and explicit failure exits', async t => {
  const png = await readFile(new URL('../../../../fixtures/chat-images/png.png', import.meta.url));
  const jpeg = await readFile(new URL('../../../../fixtures/chat-images/jpeg.jpg', import.meta.url));
  const webp = await readFile(new URL('../../../../fixtures/chat-images/webp.webp', import.meta.url));
  const filesBase = '/_desktop/files/works/work-1/files/';
  const contents: Record<string, Buffer> = {
    'note.txt': Buffer.from('hello from chat\n'), 'image.png': png, 'photo.jpg': jpeg, 'pic.webp': webp,
    'fake.txt': png, 'broken.png': Buffer.concat([png.subarray(0, 8), Buffer.from('broken')]), 'large.png': Buffer.from('x'),
  };
  const sizes: Record<string, number> = Object.fromEntries(Object.entries(contents).map(([name, bytes]) => [name, bytes.length]));
  sizes['large.png'] = 11 * 1024 * 1024;
  let missingExists = false;
  const row = (name: string, size: number, href = `${filesBase}${encodeURIComponent(name)}`) =>
    `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>${size}</d:getcontentlength><d:getlastmodified>${mtime1}</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
  const text = 'Files: [报告.txt](piwork-file:/note.txt), [PNG](piwork-file:/image.png), [JPEG](piwork-file:/photo.jpg), '
    + '[WebP](piwork-file:/pic.webp), [fake](piwork-file:/fake.txt), [broken](piwork-file:/broken.png), '
    + '[large](piwork-file:/large.png), [missing](piwork-file:/missing.txt), [nested](piwork-file:/gone/note.txt).';
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works/work-1/sessions/session-1') return { json: { session: { workId: 'work-1', sessionId: 'session-1', modelPreference: null, source: { kind: 'chat' } },
      messages: [{ entryId: 'assistant-1', runId: 'run-1', role: 'assistant', blocks: [{ blockId: 'b1', type: 'text', text }] }], runs: [] } };
    if (!r.path.startsWith(filesBase)) return;
    const name = decodeURIComponent(r.path.slice(filesBase.length)).replace(/\/$/, '');
    if (name === 'gone' || name.startsWith('gone/')) return { status: 404 };
    const list = [...Object.keys(contents), ...(missingExists ? ['missing.txt'] : [])];
    if (r.method === 'PROPFIND') {
      if (!name) return { status: 207, body: `<d:multistatus xmlns:d="DAV:">${list.map(item => row(item, sizes[item]!)).join('')}</d:multistatus>` };
      if (name === 'missing.txt' && !missingExists) return { status: 404 };
      return { status: 207, body: `<d:multistatus xmlns:d="DAV:">${row(name, name === 'missing.txt' ? 8 : sizes[name] ?? 0)}</d:multistatus>` };
    }
    if (r.method === 'GET') {
      if (name === 'missing.txt') return missingExists ? { body: 'now here' } : { status: 404 };
      const bytes = contents[name];
      return bytes ? { body: bytes } : { status: 404 };
    }
  });
  await expect(button(page, 'tab-Chat')).toHaveClass(/active/);
  const posts = () => requests.filter(record => record.method === 'POST').length;
  const beforePosts = posts();

  // Focus chat must exit before Files is truly visible.
  await page.locator('[data-action="focus-chat"]').click();
  await expect(page.locator('[data-action="exit-service-focus"]')).toBeVisible();
  await page.locator('a.chat-file-link[data-path="/image.png"]').click();
  await expect(page.locator('.file-image-preview img')).toBeVisible();
  assert.equal(await page.locator('#workspace-main').getAttribute('inert'), null);
  await expect.poll(() => page.locator('.file-image-preview img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.locator('[data-action="save-file"]')).toHaveCount(0);
  await expect(page.locator('.file-target-toolbar')).not.toContainText(/Saved|Unsaved/);

  // The same message link works from the Chat side panel of the Services layout.
  await button(page, 'tab-Services').click();
  await expect(page.locator('#workspace-chat')).toBeVisible();
  await page.locator('#workspace-chat a.chat-file-link[data-path="/photo.jpg"]').click();
  await expect(page.locator('.file-image-preview img')).toBeVisible();
  await expect(page.locator('#workspace-chat')).toBeVisible();
  await button(page, 'tab-Chat').click();

  // All three real image encodings decode; a fake suffix follows content, not its extension.
  for (const [label, path, bytes] of [['PNG', '/image.png', png], ['JPEG', '/photo.jpg', jpeg], ['WebP', '/pic.webp', webp], ['fake suffix', '/fake.txt', png]] as const) {
    await button(page, 'tab-Chat').click();
    await page.locator(`a.chat-file-link[data-path="${path}"]`).click();
    const image = page.locator('.file-image-preview img');
    await expect(image, label).toBeVisible();
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0), { message: label }).toBe(true);
    assert.ok(bytes.length > 0);
  }

  // 360px keeps the preview inside the page and Back to files is keyboard reachable.
  await page.setViewportSize({ width: 360, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const back = page.locator('.file-target-toolbar [data-action="close-file"]');
  await back.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.file-table')).toBeVisible();
  await expect(page.locator('.breadcrumbs')).toContainText('Workspace');
  // The Files list opens images through the same preview capability as a chat link.
  await page.locator('[data-action="open-file"][data-path="/image.png"]').click();
  await expect(page.locator('.file-image-preview img')).toBeVisible();
  await expect.poll(() => page.locator('.file-image-preview img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.locator('.file-target-toolbar [data-action="close-file"]').click();
  await expect(page.locator('.file-table')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Corrupt and over-budget images explain the limit and offer the real download only.
  await button(page, 'tab-Chat').click(); await page.locator('a.chat-file-link[data-path="/broken.png"]').click();
  await expect(page.locator('.main-panel')).toContainText('not a valid PNG, JPEG or WebP');
  await expect(page.locator('.main-panel')).toContainText('Download file');
  await expect(page.locator('.file-image-preview img')).toHaveCount(0);
  await button(page, 'tab-Chat').click(); await page.locator('a.chat-file-link[data-path="/large.png"]').click();
  await expect(page.locator('.main-panel')).toContainText('preview limits');
  assert.equal(requests.filter(record => record.method === 'GET' && record.path.endsWith('/large.png')).length, 0);

  // A missing target keeps its path and Retry resolves only after the file really exists.
  await button(page, 'tab-Chat').click(); await page.locator('a.chat-file-link[data-path="/missing.txt"]').click();
  await expect(page.locator('.main-panel')).toContainText('File not found');
  await expect(page.locator('[data-action="retry-file-preview"]')).toBeVisible();
  missingExists = true;
  await page.locator('[data-action="retry-file-preview"]').click();
  await expect(page.locator('#file-editor')).toHaveValue('now here');

  // A missing parent keeps the target explicit and Back lands on the nearest readable folder.
  await button(page, 'tab-Chat').click();
  await page.locator('a.chat-file-link[data-path="/gone/note.txt"]').click();
  await expect(page.locator('.main-panel')).toContainText('File not found');
  await page.locator('.file-target-toolbar [data-action="close-file"]').click();
  await expect(page.locator('.main-panel')).toContainText('folder is no longer available');
  await expect(page.locator('.breadcrumbs')).toContainText('Workspace');

  // The same hash works as a copied/reloaded current-login entry and creates no Run.
  const href = await page.locator('a.chat-file-link[data-path="/note.txt"]').getAttribute('href');
  await page.goto(`${base}/${href}`);
  await expect(page.locator('#file-editor')).toHaveValue('hello from chat\n');
  await page.reload();
  await expect(page.locator('.file-target-toolbar')).toContainText('note.txt');
  await expect(page.locator('#file-editor')).toHaveValue('hello from chat\n');
  await expect(page.locator('#workspace-main')).not.toHaveAttribute('inert');
  assert.equal(posts(), beforePosts, 'opening, retrying and reloading file targets submits no Run or control request');
});

test('a request reply file link returns to the original request inspector', async t => {
  const filesBase = '/_desktop/files/works/work-1/files/';
  const request = { requestId: 'request-file', goal: 'Publish the report', source: { kind: 'chat' }, state: 'completed',
    disposition: 'live', updatedAt: 'now', runIds: ['run-1'], result: 'Report ready' };
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works/work-1/agent-requests') return { json: { items: [request], nextCursor: null, checkedAt: 'now' } };
    if (r.path === 'works/work-1/agent-requests/request-file') return { json: { request, evidence: { items: [], nextCursor: null } } };
    if (r.path === 'works/work-1/runs/run-1') return { json: { runId: 'run-1', workId: 'work-1', sessionId: 'session-1', state: 4,
      finalText: 'Current: [report.txt](piwork-file:/note.txt)' } };
    if (r.path === filesBase + 'note.txt' && r.method === 'PROPFIND') return { status: 207, body: listing('request reply file', mtime1) };
    if (r.path === filesBase + 'note.txt' && r.method === 'GET') return { body: 'request reply file', headers: { 'Last-Modified': mtime1 } };
  });
  await page.locator('[data-action="pi-requests"]').click();
  await page.locator('[data-action="pi-request-detail"][data-id="request-file"]').click();
  await expect(page.locator('.request-overview')).toContainText('Publish the report');
  await page.locator('.request-executions > summary').click();
  await page.locator('.request-execution > summary').click();
  await page.locator('a.chat-file-link[data-path="/note.txt"]').click();
  await expect(page.locator('#file-editor')).toHaveValue('request reply file');
  await expect(page.locator('[data-action="back-to-file-source"]')).toBeVisible();
  await page.locator('[data-action="back-to-file-source"]').click();
  await expect(page.locator('.request-overview')).toContainText('Publish the report');
  await expect(page.locator('#file-editor')).toHaveCount(0);
  assert.equal(requests.filter(record => record.method === 'POST').length, 0);
});

test('retrying a failed file read keeps the unsaved draft and its separate reread baseline', async t => {
  let failGet = false;
  const notePath = '/_desktop/files/works/work-1/files/note.txt';
  const { page, requests } = await fixture(t, (r): Reply | undefined => {
    if (r.method === 'PROPFIND' && (r.path === notePath || r.path === '/_desktop/files/works/work-1/files/')) return { status: 207, body: listing('server version', mtime1), headers: { 'Content-Type': 'application/xml' } };
    if (r.path === notePath && r.method === 'GET') return failGet ? { status: 503 } : { body: 'server version', headers: { 'Last-Modified': mtime1 } };
  });
  await button(page, 'tab-Files').click(); await button(page, 'open-file').click();
  await page.locator('#file-editor').fill('draft stays');
  failGet = true; await button(page, 'refresh-files').click();
  await expect(page.locator('.main-panel')).toContainText('503');
  failGet = false;
  await page.locator('[data-action="retry-file-preview"]').click();
  await expect(page.locator('#file-editor')).toHaveValue('draft stays');
  await expect(page.locator('.file-reread pre')).toHaveText('server version');
  await expect(page.locator('.editor-toolbar')).toContainText('Unsaved');
  assert.equal(requests.filter(record => record.method === 'PUT').length, 0);
});

test('a chat file link honors the dirty file guard and only navigates after an explicit discard', async t => {
  const root = '/_desktop/files/works/work-1/files/';
  const reply = 'Open [other.txt](piwork-file:/other.txt).';
  const row = (name: string, body: string) => `<d:response><d:href>${root}${name}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>${Buffer.byteLength(body)}</d:getcontentlength><d:getlastmodified>${mtime1}</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
  const { page, requests } = await fixture(t, (r): Reply | undefined => {
    if (r.path === 'works/work-1/sessions/session-1') return { json: { session: { workId: 'work-1', sessionId: 'session-1', modelPreference: null, source: { kind: 'chat' } },
      messages: [{ entryId: 'assistant-1', runId: 'run-1', role: 'assistant', blocks: [{ blockId: 'b1', type: 'text', text: reply }] }], runs: [] } };
    if (r.path === root && r.method === 'PROPFIND') return { status: 207, body: `<d:multistatus xmlns:d="DAV:">${row('note.txt', 'saved note')}${row('other.txt', 'other content')}</d:multistatus>` };
    if (r.path === root + 'note.txt' && r.method === 'PROPFIND') return { status: 207, body: `<d:multistatus xmlns:d="DAV:">${row('note.txt', 'saved note')}</d:multistatus>` };
    if (r.path === root + 'other.txt' && r.method === 'PROPFIND') return { status: 207, body: `<d:multistatus xmlns:d="DAV:">${row('other.txt', 'other content')}</d:multistatus>` };
    if (r.path === root + 'note.txt' && r.method === 'GET') return { body: 'saved note', headers: { 'Last-Modified': mtime1 } };
    if (r.path === root + 'other.txt' && r.method === 'GET') return { body: 'other content', headers: { 'Last-Modified': mtime1 } };
  });
  await button(page, 'tab-Files').click();
  await page.locator('[data-action="open-file"][data-path="/note.txt"]').click();
  await page.locator('#file-editor').fill('dirty draft');
  const link = page.locator('#workspace-chat a.chat-file-link[data-path="/other.txt"]');
  await link.click();
  await expect(page.locator('#modal')).toContainText('Save your file changes?');
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.locator('#file-editor')).toHaveValue('dirty draft');
  assert.equal(new URL(page.url()).hash, '#/work/work-1');
  await link.click();
  await page.locator('#modal').getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.locator('#file-editor')).toHaveValue('other content');
  assert.equal(requests.filter(record => record.method === 'PUT').length, 0);
});

test('a streamed reply only becomes a link when complete and opens the current file', async t => {
  const root = '/_desktop/files/works/work-1/files/';
  const finalText = '[report](piwork-file:/note.txt)';
  let completed = false;
  const { page, requests } = await fixture(t, (r): Reply | undefined => {
    if (r.path === 'works/work-1/sessions/session-1') return { json: { session: { workId: 'work-1', sessionId: 'session-1', modelPreference: null, source: { kind: 'chat' } },
      messages: completed ? [{ entryId: 'user-1', role: 'user', text: 'produce a file' },
        { entryId: 'assistant-1', runId: 'run-live', role: 'assistant', blocks: [{ blockId: 'b1', type: 'text', text: finalText }] }]
        : [{ entryId: 'user-1', role: 'user', text: 'start' }], runs: [] } };
    if (r.path === 'works/work-1/runs' && r.method === 'POST') return { status: 202, json: { run: { sessionId: 'session-1', runId: 'run-live', state: 1 }, reused: false } };
    if (r.path === 'works/work-1/runs/run-live/events') { completed = true; return { status: 200, body: `${JSON.stringify({ sequence: '1', kind: { $case: 'text', text: { delta: '[report](piwork-file:/not' } } })}\n${JSON.stringify({ sequence: '2', kind: { $case: 'text', text: { delta: 'e.txt)' } } })}\n${JSON.stringify({ sequence: '3', kind: { $case: 'state', state: { state: 4, finalText } } })}\n`, headers: { 'Content-Type': 'application/x-ndjson' } }; }
    if (r.path === 'works/work-1/runs/run-live') return { json: { run: { runId: 'run-live', workId: 'work-1', sessionId: 'session-1', state: 4, finalText } } };
    if (r.method === 'PROPFIND' && (r.path === root || r.path === root + 'note.txt')) return { status: 207, body: listing('streamed file', mtime1), headers: { 'Content-Type': 'application/xml' } };
    if (r.path === root + 'note.txt' && r.method === 'GET') return { body: 'streamed file', headers: { 'Last-Modified': mtime1 } };
  });
  await page.locator('#composer').fill('produce a file');
  await button(page, 'send-message').click();
  // Legacy history and the live stream lack a shared event identity. They can
  // both remain visible while their relationship is explicitly unconfirmed.
  const link = page.locator('a.chat-file-link[data-path="/note.txt"]').first();
  await expect(link).toBeVisible();
  assert.equal(requests.filter(record => record.path.startsWith('/_desktop/files/')).length, 0, 'rendering a reply must not read the workspace');
  await link.click();
  await expect(page.locator('#file-editor')).toHaveValue('streamed file');
  assert.equal(requests.filter(record => record.method === 'POST' && record.path === 'works/work-1/runs').length, 1);
});


test('a revoked file session clears the preview and returns to sign-in', async t => {
  const root = '/_desktop/files/works/work-1/files/';
  let signedOut = false, revoked = false;
  const { page, requests } = await fixture(t, (r): Reply | undefined => {
    if (r.path === 'session') return { json: signedOut
      ? { state: 'signed-out', generation: 2, csrf: 'revoked-csrf', coreUrl: 'http://core.test' }
      : { state: 'authenticated', generation: 1, csrf: 'local-session-csrf', coreUrl: 'http://core.test', user: { id: 'owner', account: 'owner', role: 'user' } } };
    if (r.method === 'PROPFIND' && (r.path === root || r.path === root + 'note.txt')) return { status: 207, body: listing('secret file', mtime1), headers: { 'Content-Type': 'application/xml' } };
    if (r.path === root + 'note.txt' && r.method === 'GET') return revoked ? { status: 401, headers: { 'X-Piwork-File-Error': 'AUTH_REQUIRED' } } : { body: 'secret file', headers: { 'Last-Modified': mtime1 } };
  });
  await button(page, 'tab-Files').click();
  await page.locator('[data-action="open-file"][data-path="/note.txt"]').click();
  await expect(page.locator('#file-editor')).toHaveValue('secret file');
  signedOut = true; revoked = true;
  await button(page, 'refresh-files').click();
  await expect(page.getByRole('heading', { name: 'Connect to your Core', exact: true })).toBeVisible();
  await expect(page.locator('#file-editor')).toHaveCount(0);
  await expect(page.locator('#app')).not.toContainText('secret file');
  assert.ok(requests.some(record => record.path === 'session'), 'file auth reuses the session readback');
});

test('Core recovery uses a startup gate, relay animation and automatic Work readback', async t => {
  let recovering = true;
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'status') return { json: { health: { available: true }, readiness: { available: true, value: { state: recovering ? 'RECOVERING' : 'READY', ready: !recovering } } } };
    if (r.path === 'works') return { json: { works: [{ id: 'work-1', name: 'Recovery Work', desiredState: 'running', observedState: recovering ? 'starting' : 'ready' }] } };
  }, false, false, undefined, true);
  await expect(page.locator('.core-startup-page')).toContainText('Core is starting');
  await expect(page.locator('.core-startup-blocks i')).toHaveCount(4);
  await expect(page.locator('.works-toolbar')).toHaveCount(0);
  await page.setViewportSize({ width: 360, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('.core-startup-symbol').evaluate(e => getComputedStyle(e).animationName), 'none');
  assert.equal(await page.locator('.core-startup-blocks i').first().evaluate(e => getComputedStyle(e).animationName), 'core-block-relay');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.core-startup-blocks i').first().evaluate(e => getComputedStyle(e).animationName), 'none');
  assert.equal(await page.locator('.core-startup-wait .core-starting-spinner').evaluate(e => getComputedStyle(e).animationName), 'none');
  await page.evaluate(async () => { const locale = await import('/desktop/browser/' + 'locale.js'); locale.chooseLocale('zh-CN'); });
  await expect(page.locator('#core-startup-title')).toHaveText('Core 正在启动');
  recovering = false;
  await page.goto(base + '/#/works');
  await expect(page.locator('.work-row')).toContainText('就绪', { timeout: 8000 });
  assert.equal(requests.filter(r => r.method !== 'GET').length, 0);
});

test('Core readiness failure is a static recoverable startup state', async t => {
  const { page } = await fixture(t, r => r.path === 'status' ? { json: { health: { available: true }, readiness: { available: true, value: { state: 'RUNTIME_UNAVAILABLE', ready: false } } } } : r.path === 'works' ? {json:{works:[]}} : undefined, false, false, undefined, true);
  await expect(page.locator('#core-startup-title')).toHaveText('Core could not become ready');
  await expect(page.locator('.core-startup-blocks,.core-starting-spinner')).toHaveCount(0);
  await expect(button(page,'check-connection')).toBeVisible();
  await button(page, 'connection').click();
  await expect(page.locator('.status-grid')).toContainText('Runtime unavailable');
});

test('automatic Work recovery stays observable after one failed attempt and becomes Ready', async t => {
  let observed = 'unknown';
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'status') return { json: { health: { available: true }, readiness: { available: true, value: { state: 'READY', ready: true } } } };
    if (r.path === 'works') return { json: { works: [{ id: 'work-1', name: 'Recovery Work', desiredState: 'running', observedState: observed }] } };
  });
  await page.goto(base + '/#/works');
  await page.evaluate(async () => { const { adapter } = await import('/desktop/browser/' + 'adapter.js'); await adapter.checkConnection(); });
  const row = page.locator('.work-row');
  await expect(row).toContainText('Work status not confirmed');
  await expect(row).not.toContainText('Retry Work');
  const readsBefore = requests.filter(r => r.path === 'works').length;
  observed = 'ready';
  await expect(row).toContainText('Ready', { timeout: 8000 });
  assert.ok(requests.filter(r => r.path === 'works').length > readsBefore);
  assert.equal(requests.filter(r => r.method !== 'GET').length, 0);
});

test('unconfirmed readiness has a static read recovery exit', async t => {
  const { page } = await fixture(t, r => r.path === 'status' ? { json: { health: { available: true }, readiness: { available: false, error: 'invalid response' } } } : undefined, false, false, undefined, true);
  await expect(page.locator('#core-startup-title')).toHaveText('Core status is not confirmed');
  await expect(button(page,'check-connection')).toBeVisible();
  await expect(page.locator('.core-starting-spinner')).toHaveCount(0);
});
test('startup recovery gates business entries until Core ready, including a direct Work route', async t => {
  let recovering = true;
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'status') return { json: { health: { available: true }, readiness: { available: true, value: { state: recovering ? 'RECOVERING' : 'READY', ready: !recovering } } } };
    if (r.path === 'works' && recovering) return {json:{works:[{id:'work-1',name:'Recovery Work',desiredState:'running',observedState:'starting'}]}};
  }, false, true, async page => {
    try {
      await expect(page.locator('.core-startup-page')).toContainText('Core is starting');
      for (const hash of ['#/app/work-1/counter/8000','#/works','#/work/work-1']) { await page.evaluate(value=>{location.hash=value},hash); await expect(page.locator('.core-startup-page')).toBeVisible(); }
      await expect(button(page, 'new-work')).toHaveCount(0);
      await expect(button(page, 'work-menu')).toHaveCount(0);
      const result = await api(page, "try { await adapter.lifecycle('work-1','retry'); return 'submitted'; } catch(e) { return e.code; }");
      assert.equal(result, 'CORE_NOT_READY');
    } finally { recovering = false; }
  });
  await expect(page.getByRole('heading', { name: 'Recovery Work', exact: true })).toBeVisible({timeout:10000});
  assert.equal(requests.filter(r => r.method !== 'GET').length, 0);
});

test('a recovered Work opens during default preparation while new default Work remains blocked', async t => {
  const {page,requests}=await fixture(t,r=>r.path==='status' ? {json:{health:{available:true},readiness:{available:true,value:{state:'RECOVERING',ready:false}}}} : undefined);
  await expect(page.getByRole('heading',{name:'Recovery Work',exact:true})).toBeVisible();
  await expect(page.locator('.core-startup-page')).toHaveCount(0);
  assert.ok(requests.some(r=>r.path==='works/work-1/sessions' && r.method==='GET'));
  const result=await api(page,"try { await adapter.createWork('new default',{}); return 'submitted'; } catch(e) { return e.code; }");
  assert.equal(result,'CORE_NOT_READY');
  assert.equal(requests.filter(r=>r.path==='works' && r.method==='POST').length,0);
});

test('recovered Work keeps five failed retries in history, never as menu progress rows after reload', async t => {
  const ids = Array.from({length:5},(_,i)=>`retry-history-${i}`);
  const { page, requests } = await fixture(t, r => {
    if(r.path === 'known-operations') return {json:{operations:ids.map(operationId=>({operationId,workId:'work-1',type:'Retry Work',recordedAt:'2026-10-28T10:00:00Z',terminal:true,terminalState:'failed',terminalCheckedAt:'2026-10-28T10:00:01Z'}))}};
    if(r.path.startsWith('operations/retry-history-')) return {json:{operationId:r.path.split('/')[1],workId:'work-1',kind:'retry-work',state:'failed',createdAt:'2026-10-28T10:00:00Z',error:{message:'synthetic old failure'}}};
  });
  for(let pass=0;pass<2;pass++){
    if(pass)await page.reload();
    await expect(button(page,'work-menu')).toBeVisible();await button(page,'work-menu').click();
    await expect(page.locator('.work-menu-task')).toHaveCount(0);
    await expect(button(page,'work-history')).toBeVisible();await button(page,'work-history').click();
    await expect(page.locator('.operation-list > button')).toHaveCount(5);
    await page.locator('[data-action=operation][data-id=retry-history-0]').click();
    await expect(page.locator('.phase-track')).toContainText('failed');
    assert.equal(requests.filter(r=>r.path==='operations/work-1').length,0);
    await button(page,'close-modal').click();
  }
  assert.equal(requests.filter(r=>r.method!=='GET').length,0);
});


test('default recovery preserves an already verified Work composer without pausing it',async t=>{
 let recovering=false;
 const {page,requests}=await fixture(t,r=>{
  if(r.path==='status')return{json:{health:{available:true},readiness:{available:true,value:{state:recovering?'RECOVERING':'READY',ready:!recovering}}}};
 });
 await button(page,'tab-Chat').click();await page.locator('#composer').fill('draft kept across Core recovery');
 await page.locator('#composer').evaluate(el=>(window as any).__preservedComposer=el);
 recovering=true;await api(page,'await adapter.checkConnection();');
 await expect(page.locator('#core-recovery-banner')).toHaveCount(0);
 assert(await page.locator('#composer').evaluate(el=>(el.closest('[inert]')===null)));
 assert(await page.locator('#composer').evaluate(el=>el===(window as any).__preservedComposer));
 assert.equal(await page.locator('#composer').inputValue(),'draft kept across Core recovery');
 recovering=false;await api(page,'await adapter.checkConnection();');
 await expect(page.locator('#core-recovery-banner')).toHaveCount(0);
 await expect(page.locator('#composer')).toHaveValue('draft kept across Core recovery');
 assert(await page.locator('#composer').evaluate(el=>el===(window as any).__preservedComposer));
 assert.equal(requests.filter(r=>r.method!=='GET').length,0);
});

test('default recovery keeps a verified Service iframe active without remounting',async t=>{
 let recovering=false;
 const {page,requests}=await fixture(t,r=>{
  if(r.path==='status')return {json:{health:{available:true},readiness:{available:true,value:{state:recovering?'RECOVERING':'READY',ready:!recovering}}}};
  if(r.path.endsWith('/services'))return {json:{services:[{serviceId:'counter',name:'Counter',enabled:true,observedState:'ready',access:{hostname:'counter.w-one.work',ports:[{port:8000,url:'http://counter.w-one.work:8000',name:'http'}]}}]}};
  if(r.path==='service-entries')return {json:{entryId:'core-continuity-entry',origin:'http://service.test',entryUrl:'about:blank',embed:'unknown'}};
  if(r.path==='service-entries/core-continuity-entry')return {json:{embed:'unknown'}};
 });
 await expect(page.locator('iframe')).toHaveCount(1);await page.locator('iframe').evaluate(el=>(window as any).__coreRecoveryFrame=el);
 const writes=requests.filter(r=>r.method!=='GET').length;
 recovering=true;await api(page,'await adapter.checkConnection();');
 await expect(page.locator('#core-recovery-banner')).toHaveCount(0);assert(await page.locator('iframe').evaluate(el=>el===(window as any).__coreRecoveryFrame&&!el.closest('[inert]')));
 recovering=false;await api(page,'await adapter.checkConnection();');await expect(page.locator('#core-recovery-banner')).toHaveCount(0);
 assert(await page.locator('iframe').evaluate(el=>el===(window as any).__coreRecoveryFrame));
 assert.equal(requests.filter(r=>r.method==='POST'&&/works\/.+\/(start|retry|stop)$/.test(r.path)).length,0);
 assert(requests.filter(r=>r.method!=='GET').length>=writes);
});


for (const revocation of ['stopped','deleted','work-denied','service-stopped','service-failed','service-disabled','service-denied','service-removed']) test(`WARN-1 Core recovery revokes ${revocation} iframe without discarding the composer`,async t=>{
 let recovering=false,revoked=false;
 const {page,requests}=await fixture(t,r=>{
  if(r.path==='status')return{json:{health:{available:true},readiness:{available:true,value:{state:recovering?'RECOVERING':'READY',ready:!recovering}}}};
  if(r.path==='works/work-1'&&revoked){
   if(revocation==='work-denied')return{status:403,json:{code:'FORBIDDEN'}};
   if(['stopped','deleted'].includes(revocation))return{json:{id:'work-1',name:'Recovery Work',desiredState:revocation,observedState:revocation}};
  }
  if(r.path.endsWith('/services')){
   if(revoked&&revocation==='service-denied')return{status:403,json:{code:'FORBIDDEN'}};
   return{json:{services:revoked&&revocation==='service-removed'?[]:[{serviceId:'counter',name:'Counter',enabled:!(revoked&&revocation==='service-disabled'),observedState:revoked&&revocation==='service-stopped'?'stopped':revoked&&revocation==='service-failed'?'failed':'ready',access:{hostname:'counter.w-one.work',ports:[{port:8000,url:'http://counter.w-one.work:8000',name:'http'}]}}]}};
  }
  if(r.path==='service-entries')return{json:{entryId:'warn-retained-entry',origin:'http://service.test',entryUrl:'about:blank',embed:'unknown'}};
  if(r.path==='service-entries/warn-retained-entry')return{json:{embed:'unknown'}};
 });
 await expect(page.locator('iframe')).toHaveCount(1);
 await page.locator('#composer').fill('draft survives runtime revocation');
 const composer=await page.locator('#composer').elementHandle();
 recovering=true;await api(page,'await adapter.checkConnection();');
 await expect(page.locator('#core-recovery-banner')).toHaveCount(0);
 revoked=true;
 await api(page,revocation.startsWith('service-')?"await adapter.loadServices('work-1').catch(()=>{});":"await adapter.refreshWorkStatus('work-1',true).catch(()=>{});");
 await expect(page.locator('iframe')).toHaveCount(0);
 assert(await composer!.evaluate(el=>el.isConnected));
 await expect(page.locator('#composer')).toHaveValue('draft survives runtime revocation');
 assert.equal(requests.filter(r=>r.method==='POST'&&/works\/.+\/(start|retry|stop)$/.test(r.path)).length,0);
});

test('WARN-2 failed current Service stays current with Ready Work and becomes history only after Service recovery',async t=>{
 let observed='stopped';
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/services'))return{json:{services:[{serviceId:'counter',name:'Counter',enabled:true,observedState:observed,access:{hostname:'counter.w-one.work',ports:[{port:8000,url:'http://counter.w-one.work:8000',name:'http'}]}}]}};
  if(r.path==='works/work-1/services/counter/restart'){observed='failed';return{status:202,json:{operationId:'current-service-restart',workId:'work-1',serviceId:'counter'}};}
  if(r.path==='operations/current-service-restart')return{json:{operationId:'current-service-restart',workId:'work-1',serviceId:'counter',kind:'restart-service',state:'failed',error:{message:'Current restart failed',serviceId:'counter'}}};
 });
 await api(page,"await adapter.operateService('work-1','counter','restart');await adapter.checkOperation('current-service-restart');await adapter.refreshWorkStatus('work-1',true);await adapter.listWorks();await adapter.loadServices('work-1');");
 assert.equal(await api(page,"return adapter.workSynchronizationPending('work-1');"),false);
 await button(page,'work-menu').click();await expect(button(page,'work-current-tasks')).toHaveCount(1);
 await button(page,'work-history').click();await page.locator('[data-action="history-filter"][data-filter="current"]').click();
 await expect(page.locator('.operation-list [data-id="current-service-restart"]')).toHaveCount(1);
 observed='ready';await api(page,"await adapter.loadServices('work-1');");
 await expect(page.locator('.operation-list [data-id="current-service-restart"]')).toHaveCount(0);
 await page.locator('[data-action="history-filter"][data-filter="history"]').click();
 await expect(page.locator('.operation-list [data-id="current-service-restart"]')).toContainText('failed');
 assert.equal(await api(page,"return adapter.getOperation('current-service-restart').state;"),'failed');
 assert.equal(requests.filter(r=>r.path==='works/work-1/services/counter/restart'&&r.method==='POST').length,1);
});

// redesign-chat-interaction: request identity and interaction contracts, not mockup timers.
test('Chat redesign: icon-only feedback retries the original snapshot and keeps a newer draft',async t=>{
 const accepted=deferred();t.after(()=>accepted.resolve());let posts:any[]=[];
 const {page,requests}=await fixture(t,async r=>{
  if(r.path==='works/work-1/runs'&&r.method==='POST'){const body=JSON.parse(r.body);posts.push(body);if(posts.length===1)return{status:400,json:{code:'INVALID_REQUEST',message:'Rejected fixture'}};await accepted.promise;return{json:{run:{runId:'retry-run',sessionId:'session-1',state:1}}};}
 });
 await page.locator('#composer').fill('original retry prompt');await button(page,'send-message').click();
 const message=page.locator('.message.user').filter({hasText:'original retry prompt'});
 await expect(message.locator('.message-submission.failed')).toBeVisible();await expect(message.locator('.message-submission')).toHaveText('');
 await page.locator('#composer').fill('newer draft');await message.getByRole('button',{name:'Message not sent',exact:true}).click();
 await button(page,'retry-chat-submission').click();await expect(message.locator('.message-submission.sending')).toBeVisible();
 await expect(page.locator('[data-action-status]').filter({hasText:'Retry message'})).toHaveCount(0);
 assert.equal(posts.length,2);assert.equal(posts[1].prompt,posts[0].prompt);assert.notEqual(posts[1].submissionKey,posts[0].submissionKey);
 await expect(message).toHaveCount(1);accepted.resolve();await expect(message.locator('.message-submission')).toHaveCount(0);await expect(page.locator('#composer')).toHaveValue('newer draft');
 await expect(page.locator('[data-action-status]').filter({hasText:'Message accepted'})).toHaveCount(0);
 assert.equal(requests.filter(r=>r.path==='works/work-1/runs'&&r.method==='POST').length,2);
});

test('Chat redesign: unknown submission checks the original key and never retries a missing mapping',async t=>{
 const {page,requests}=await fixture(t,r=>{
  if(r.path==='works/work-1/runs'&&r.method==='POST')return{abort:true};
  if(r.path.includes('/runs/submissions/'))return{json:{kind:'run',key:r.path.split('/').at(-1),status:'not-found'}};
 });
 await page.locator('#composer').fill('unknown original');await button(page,'send-message').click();
 const message=page.locator('.message.user').filter({hasText:'unknown original'});await expect(message.locator('.message-submission.unknown')).toBeVisible();
 await message.locator('[data-action="chat-submission"]').click();await expect(button(page,'retry-chat-submission')).toHaveCount(0);
 await button(page,'check-chat-submission').click();await expect(message.locator('.message-submission.unknown')).toBeVisible();
 assert.equal(requests.filter(r=>r.path==='works/work-1/runs'&&r.method==='POST').length,1);
 await expect.poll(()=>requests.filter(r=>r.path.includes('/runs/submissions/')&&r.method==='GET').length).toBe(1);
});

for(const supported of [false,true])test(`Chat redesign: independent stop without a draft or valid model, capability=${supported}`,async t=>{
 const cancel=deferred();t.after(()=>cancel.resolve());
 const {page,requests}=await fixture(t,async r=>{if(r.path==='works/work-1/runs/live-stop/cancel'){await cancel.promise;return{json:{}};}if(r.path.endsWith('/chat-image-capabilities'))return{json:{profile:'chat-images-v1',defaultModel:{modelRef:null,availability:'supported'},models:[]}};});
 await api(page,`const w=adapter.getWork('work-1');w.run={id:'live-stop',sessionId:'session-1',status:'running',cursor:0};adapter.cancelAndSendCapabilities.set(w.id,${supported?1:0});adapter.activeRuns.set(w.id,{confirmed:true,loading:false,error:'',run:w.run});adapter.modelSelection(w.id,'session-1').phase='unknown';adapter.emit();`);
 await page.locator('#composer').fill('');const stop=page.locator('.chat-stop');await expect(stop).toBeEnabled();
 if(supported){
  await page.locator('#composer').fill('Preserved while stopping');
  const bytes=await readFile('fixtures/chat-images/png.png');await page.locator('#chat-image-input').setInputFiles({name:'stop-draft.png',mimeType:'image/png',buffer:bytes});
  await expect(page.locator('.chat-image-draft')).toHaveCount(1);await expect(page.locator('.chat-image-drafts')).not.toContainText('Checking');
  await api(page,`adapter.imageCapabilities.get('work-1').value.defaultModel.availability='unsupported';adapter.emit();`);
  await expect(page.locator('[data-action=send-message]')).toBeDisabled();await expect(stop).toBeEnabled();
 }
 await stop.click();await expect(stop).toBeDisabled();
 await expect.poll(()=>requests.filter(r=>r.path.endsWith('/live-stop/cancel')&&r.method==='POST').length).toBe(1);
 assert.equal(requests.filter(r=>r.path==='works/work-1/runs'&&r.method==='POST').length,0);cancel.resolve();await expect(stop).toBeDisabled();
 await expect(page.locator('#composer')).toHaveValue(supported?'Preserved while stopping':'');await expect(page.locator('.chat-image-draft')).toHaveCount(supported?1:0);
});

test('Chat redesign: a single inline wait follows prose and moves into the tool summary',async t=>{
 const {page,requests}=await fixture(t,()=>undefined);
 await api(page,`const w=adapter.getWork('work-1');w.run={id:'inline-run',sessionId:'session-1',status:'running',cursor:0};w.sessions[0].messages=[{id:'inline-user',role:'user',text:'Test flow',runId:w.run.id},{id:'inline-text',role:'assistant',text:'A long **safe** reply',runId:w.run.id}];adapter.emit();`);
 await expect(page.locator('.message.assistant .message-text p .reply-slot')).toHaveCount(1);await expect(page.locator('#messages .pending-dots')).toHaveCount(1);
 await api(page,`const w=adapter.getWork('work-1');w.sessions[0].messages.push({id:'inline-tool',runId:w.run.id,role:'assistant',text:'',tool:{id:'one',name:'read',status:'Running',content:'<script>unsafe</script>'}});adapter.emit();`);
 await expect(page.locator('.activity > summary .reply-slot')).toHaveCount(1);await expect(page.locator('#messages .pending-dots')).toHaveCount(1);
 await page.locator('.activity > summary').click();await page.locator('.tool-event > summary').click();
 await page.locator('.tool-result-preview').evaluate(node=>(window as any).__toolPreview=node);
 await page.locator('.tool-raw > summary').click();
 await api(page,`const w=adapter.getWork('work-1');w.sessions[0].messages.at(-1).tool.status='Completed';w.run.status='succeeded';adapter.emit();`);
 await expect(page.locator('#messages .pending-dots')).toHaveCount(0);await expect(page.locator('.tool-raw pre')).toBeVisible();
 assert(await page.locator('.tool-result-preview').evaluate(node=>node===(window as any).__toolPreview));
 await expect(page.locator('.tool-result-preview')).toHaveText('<script>unsafe</script>');assert.equal(await page.locator('#messages script').count(),0);
 await expect(page.locator('.message-execution')).not.toContainText('Run succeeded');
 assert.equal(requests.filter(r=>r.method==='POST').length,0);
});

test('Chat redesign: retry retains images and original settings; unknown retry acceptance is read back once',async t=>{
 const png=await readFile(new URL('../../../../fixtures/chat-images/png.png',import.meta.url));const posts:any[]=[];
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/chat-image-capabilities'))return{json:{profile:'chat-images-v1',defaultModel:{modelRef:null,availability:'supported'},models:[]}};
  if(r.path==='works/work-1/runs'&&r.method==='POST'){posts.push(JSON.parse(r.body));return posts.length===1?{status:400,json:{code:'INVALID_REQUEST',message:'Rejected once'}}:{abort:true};}
  if(r.path.includes('/runs/submissions/'))return{json:{kind:'run',key:posts.at(-1).submissionKey,status:'accepted',run:{workId:'work-1',sessionId:'session-1',runId:'retried-image',submissionKey:posts.at(-1).submissionKey,state:4}}};
 });
 await page.locator('#chat-image-input').setInputFiles({name:'retry.png',mimeType:'image/png',buffer:png});await expect(page.locator('.chat-image-drafts')).not.toContainText('Checking');
 await page.locator('#composer').fill('original image caption');await button(page,'send-message').click();await expect(page.locator('.message-submission.failed')).toBeVisible();
 const key=posts[0].submissionKey;await api(page,`adapter.modelSelection('work-1','session-1').thinking='changed';`);
 assert.equal(await api(page,`try{await adapter.retryChatSubmission('work-1','session-1',${JSON.stringify(key)})}catch(e){return e.code}`),'MODEL_NOT_CONFIRMED');assert.equal(posts.length,1);
 await api(page,"adapter.modelSelection('work-1','session-1').thinking='off';adapter.emit();");
 await page.locator('#composer').fill('next text draft');await page.locator('.message-submission.failed button').click();await button(page,'retry-chat-submission').click();
 await expect(page.locator('.message-submission.unknown')).toBeVisible();assert.equal(posts.length,2);assert.deepEqual(posts[0].images,posts[1].images);assert.equal(posts[1].inputMode,'text');
 await page.locator('.message-submission.unknown button').click();await button(page,'check-chat-submission').click();await expect(page.locator('.chat-image-draft')).toHaveCount(0);await expect(page.locator('#composer')).toHaveValue('next text draft');
 assert.equal(requests.filter(r=>r.path==='works/work-1/runs'&&r.method==='POST').length,2);assert.equal(requests.filter(r=>r.path.includes('/runs/submissions/')).length,1);await expect(page.locator('.message.user').filter({hasText:'original image caption'})).toHaveCount(1);
});

test('Chat redesign: failed retry uses the captured Service context and rejects late acceptance after identity change',async t=>{
 const gate=deferred();t.after(()=>gate.resolve());const posts:any[]=[];
 const {page}=await fixture(t,async r=>{if(r.path==='works/work-1/runs'&&r.method==='POST'){posts.push(JSON.parse(r.body));if(posts.length===1)return{status:400,json:{code:'INVALID_REQUEST',message:'Rejected'}};await gate.promise;return{json:{run:{workId:'work-1',sessionId:'session-1',runId:'old-identity',state:1}}};}});
 await api(page,`const w=adapter.getWork('work-1');w.services.push({id:'source-context',name:'Source',domain:'original.local',enabled:false,observed:'Stopped',ports:[]});adapter.selectedService='source-context';try{await adapter.send('work-1','session-1','Original context',true,'text')}catch{}`);
 await api(page,`adapter.getWork('work-1').services.find(s=>s.id==='source-context').domain='changed.local';`);
 const key=posts[0].submissionKey;
 await api(page,`window.retryResult=adapter.retryChatSubmission('work-1','session-1',${JSON.stringify(key)}).catch(e=>e.code);`);
 await expect.poll(()=>posts.length).toBe(2);assert.equal(posts[1].prompt,posts[0].prompt);assert.match(posts[1].prompt,/original\.local/);
 await api(page,'adapter.clearIdentity();');gate.resolve();
 assert.equal(await page.evaluate(()=>(window as any).retryResult),'CONNECTION_CHANGED');assert.equal(await api(page,'return adapter.state.works.length'),0);
});

test('Chat redesign: cancellation failure retains draft, error, and original target without creating a Run',async t=>{
 const {page,requests}=await fixture(t,r=>{if(r.path.endsWith('/cancel'))return{status:503,json:{code:'RUNTIME_UNAVAILABLE',message:'Cancel observation unavailable'}};});
 await api(page,`const w=adapter.getWork('work-1');w.run={id:'stop-error',sessionId:'session-1',status:'running',cursor:0};adapter.emit();`);
 await page.locator('#composer').fill('Keep draft');await page.locator('.chat-stop').click();await expect(page.locator('#app')).toContainText('Cancel observation unavailable');await expect(page.locator('#composer')).toHaveValue('Keep draft');
 assert.equal(await api(page,"return adapter.getWork('work-1').run.status"),'running');assert.equal(requests.filter(r=>r.path==='works/work-1/runs'&&r.method==='POST').length,0);
});

for(const ending of ['A long plain paragraph.','- first\n- second','| A | B |\n| --- | --- |\n| one | two |','```js\nconst value = 1;\n```'])test(`Chat redesign: Markdown tail stays outside raw code and tables (${ending.slice(0,12)})`,async t=>{
 const {page}=await fixture(t,()=>undefined);
 await api(page,`const w=adapter.getWork('work-1');w.run={id:'markdown-tail',sessionId:'session-1',status:'running',cursor:0};w.sessions[0].messages=[{id:'md-user',role:'user',text:'Read',runId:w.run.id},{id:'md-answer',role:'assistant',text:${JSON.stringify(ending)},runId:w.run.id}];adapter.emit();`);
 await expect(page.locator('#messages .reply-slot')).toHaveCount(1);await expect(page.locator('pre .reply-slot,table .reply-slot')).toHaveCount(0);await expect(page.locator('.reply-slot')).toHaveText('');
 await api(page,"adapter.getWork('work-1').run.status='succeeded';adapter.emit();");await expect(page.locator('#messages .reply-slot')).toHaveCount(0);
});

test('Chat redesign: narrow message feedback stays readable and keyboard accessible across Chat layouts',async t=>{
 const {page}=await fixture(t,r=>{
  if(r.path==='works/work-1/runs'&&r.method==='POST')return{status:400,json:{code:'INVALID_REQUEST',message:'This message was explicitly rejected by the fixture.'}};
  if(r.path.endsWith('/services'))return{json:{services:[{serviceId:'service-a',name:'Tool A',enabled:true,observedState:'ready',access:{hostname:'a.work.test',ports:[{port:80,url:'http://a.work.test',name:'web'}]}}]}};
  if(r.path==='service-entries')return{json:{entryId:'entry-a',origin:base,basePath:'/_desktop/geometry-app/',entryUrl:base+'/_desktop/geometry-app/',embed:'allowed'}};
  if(r.path==='service-entries/entry-a')return{json:{embed:'allowed'}};
  if(r.path==='/_desktop/geometry-app/')return{body:'<html><body style="font:14px system-ui;padding:32px;background:#f5f7fa;color:#34455b"><h2>Original Service</h2><p>Service state remains in the same frame.</p><input aria-label="Service draft" value="Unsaved service draft"></body></html>',headers:{'Content-Type':'text/html'}};
 });
 await button(page,'tab-Chat').click();
 await page.locator('#composer').fill('A long message '.repeat(24));await button(page,'send-message').click();await expect(page.locator('.message-submission.failed')).toBeVisible();
 await mkdir('dist/chat-interaction-ui',{recursive:true});
 for(const width of [1440,360]){
  await page.setViewportSize({width,height:900});await page.locator('.message-submission.failed button').click();await expect(page.locator('#modal')).toBeVisible();
  const box=await page.locator('#modal').boundingBox();assert(box&&box.x>=0&&box.x+box.width<=width+1,'Message popover exceeds viewport');
  await page.screenshot({path:`dist/chat-interaction-ui/message-${width}.png`});await page.keyboard.press('Escape');await expect(page.locator('#modal')).toHaveCount(0);await expect(page.locator('.message-submission.failed button')).toBeFocused();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 const png=(await readFile('fixtures/chat-images/png.png')).toString('base64');
 await api(page,`const s=adapter.getWork('work-1').sessions[0];s.messages.unshift({id:'geometry-image',role:'user',text:'',pendingImages:[{mimeType:'image/png',data:${JSON.stringify(png)}}]},{id:'geometry-tool',role:'assistant',text:'',tool:{id:'geometry-read',name:'read',status:'Completed',content:'Safe public result '.repeat(80)}});adapter.emit();`);
 await page.locator('.activity > summary').click();await page.locator('.tool-event > summary').click();
 for(const layout of ['chat','focus','service']){
  await page.setViewportSize({width:1440,height:900});
  if(layout==='focus')await button(page,'focus-chat').click();
  if(layout==='service'){await button(page,'restore-layout').click();await button(page,'tab-Services').click();await expect(page.locator('iframe')).toBeVisible();await expect(page.frameLocator('iframe').getByRole('heading',{name:'Original Service'})).toBeVisible();}
  for(const width of [1440,360]){
   await page.setViewportSize({width,height:900});
   if(layout==='service'&&width===360)await button(page,'toggle-workspace-chat').click();
   await expect(page.locator('#composer')).toHaveValue('A long message '.repeat(24));
   await expect(page.locator('.tool-result-preview')).toBeVisible();
   await page.locator('.message-submission.failed button').click();
   const box=await page.locator('#modal').boundingBox();assert(box&&box.x>=0&&box.x+box.width<=width+1);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:`dist/chat-interaction-ui/${layout}-${width}.png`});await page.keyboard.press('Escape');
   await page.locator('.pending-chat-image').scrollIntoViewIfNeeded();await expect(page.locator('.pending-chat-image')).toBeVisible();
   await page.screenshot({path:`dist/chat-interaction-ui/${layout}-${width}-content.png`});
  }
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 await api(page,`const s=adapter.getWork('work-1').sessions[0];s.messages.at(-1).submission.phase='sending';adapter.emit();`);
 assert.equal(await page.locator('.message-submission.sending svg').evaluate(el=>getComputedStyle(el).animationName),'none');
 await page.locator('.message-submission.sending').focus();
 assert.ok(await page.locator('.message-submission.sending').evaluate(el=>parseFloat(getComputedStyle(el).outlineWidth)>=2));
});


test('Chat redesign: streamed output retains the reading anchor, selection and expanded tools',async t=>{
 const {page,requests}=await fixture(t,()=>undefined);
 await api(page,`const w=adapter.getWork('work-1');w.run={id:'reading-run',sessionId:'session-1',status:'running',cursor:0};w.sessions[0].messages=[...Array.from({length:30},(_,i)=>({id:'reading-'+i,role:'assistant',text:'Saved paragraph '+i+'\\n\\n'+'A long saved line. '.repeat(30)})),{id:'reading-tool',runId:w.run.id,role:'assistant',text:'',tool:{id:'reading-read',name:'read',status:'Running',content:'Public preview'}},{id:'reading-live',runId:w.run.id,role:'assistant',text:'Streaming prose'}];adapter.emit();`);
 await page.locator('.activity > summary').click();await page.locator('.tool-event > summary').click();await page.locator('.tool-raw > summary').click();
 await page.locator('#composer').fill('Keep selected draft');
 await page.locator('#composer').evaluate((input:HTMLTextAreaElement)=>{input.setSelectionRange(5,13);(window as any).__readingInput=input;(window as any).__readingTool=document.querySelector('.tool-event');});
 await page.locator('#messages').evaluate(el=>{el.scrollTop=300;el.dispatchEvent(new Event('scroll'));});
 const anchor=page.locator('.message.assistant').filter({hasText:'Saved paragraph 2'}).first();const before=(await anchor.boundingBox())!.y;
 await api(page,`const w=adapter.getWork('work-1');w.sessions[0].messages.at(-1).text+=' More real output.'.repeat(40);w.sessions[0].messages.find(m=>m.tool).tool.status='Completed';w.run.status='succeeded';adapter.emit();`);
 assert.ok(Math.abs((await anchor.boundingBox())!.y-before)<3);
 assert.equal(await page.evaluate(()=>document.querySelector('#composer')===(window as any).__readingInput&&document.querySelector('.tool-event')===(window as any).__readingTool),true);
 assert.deepEqual(await page.locator('#composer').evaluate((input:HTMLTextAreaElement)=>[input.selectionStart,input.selectionEnd]),[5,13]);
 assert.equal(await page.locator('.tool-raw').evaluate((el:HTMLDetailsElement)=>el.open),true);
 await button(page,'scroll-bottom').click();assert.equal(requests.filter(r=>r.method==='POST').length,0);
 await expect(button(page,'scroll-bottom')).toHaveCount(0);await expect(page.locator('#composer')).toHaveValue('Keep selected draft');
});

test('Chat redesign: failed message popovers keep independent anchors and keyboard return focus',async t=>{
 const {page,requests}=await fixture(t,r=>r.path==='works/work-1/runs'&&r.method==='POST'?{status:400,json:{code:'INVALID_REQUEST',message:'Explicit rejection'}}:undefined);
 for(const text of ['First rejected message','Second rejected message']){
  await page.locator('#composer').fill(text);await button(page,'send-message').click();await expect(page.locator('.message.user').filter({hasText:text}).locator('.message-submission.failed')).toBeVisible();
 }
 const second=page.locator('.message.user').filter({hasText:'Second rejected message'}).locator('[data-action=chat-submission]');
 await second.focus();await page.keyboard.press('Enter');await expect(page.locator('#modal')).toBeVisible();
 assert.deepEqual(await page.locator('[data-action=chat-submission]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-expanded'))),['false','true']);
 await page.keyboard.press('Escape');await expect(second).toBeFocused();
 assert.equal(requests.filter(r=>r.path==='works/work-1/runs'&&r.method==='POST').length,2);
});

test('Chat redesign: late retry rejection cannot replace another message recovery or its retry target',async t=>{
 const gate=deferred();t.after(()=>gate.resolve());const posts:any[]=[];
 const {page}=await fixture(t,async r=>{
  if(r.path==='works/work-1/runs'&&r.method==='POST'){
   posts.push(JSON.parse(r.body));if(posts.length===3){await gate.promise;return{status:400,json:{code:'INVALID_REQUEST',message:'Late A rejection'}};}
   return{status:400,json:{code:'INVALID_REQUEST',message:posts.length===1?'A rejection':'B rejection'}};
  }
 });
 for(const text of ['Message A','Message B']){await page.locator('#composer').fill(text);await button(page,'send-message').click();await expect(page.locator('.message.user').filter({hasText:text}).locator('.message-submission.failed')).toBeVisible();}
 const a=page.locator('.message.user').filter({hasText:'Message A'}),b=page.locator('.message.user').filter({hasText:'Message B'});
 await a.locator('[data-action=chat-submission]').click();await button(page,'retry-chat-submission').click();await expect.poll(()=>posts.length).toBe(3);
 if(await page.locator('#modal').count())await page.locator('#composer').focus();
 await b.locator('[data-action=chat-submission]').click();await expect(page.locator('#modal')).toContainText('B rejection');
 gate.resolve();await expect(a.locator('.message-submission.failed')).toBeVisible();
 await expect(page.locator('#modal')).toContainText('B rejection');await expect(page.locator('#modal')).not.toContainText('Late A rejection');assert.equal(posts.length,3);
 await button(page,'retry-chat-submission').click();await expect.poll(()=>posts.length).toBe(4);assert.equal(posts[3].prompt,'Message B');assert.equal(posts[2].prompt,'Message A');
 await expect(a).toHaveCount(1);await expect(b).toHaveCount(1);await expect(page.locator('#composer')).toHaveValue('Message B');
});

test('Chat redesign: earlier adjacent calls keep the original tool nodes, expanded layers and focus',async t=>{
 const {page,requests}=await fixture(t,()=>undefined);
 await api(page,"const w=adapter.getWork('work-1');w.sessions[0].messages=[{id:'later-call',runId:'same-run',role:'assistant',text:'',tool:{id:'later',name:'read',status:'Completed',content:'Later public result'}}];adapter.emit();");
 await page.locator('#composer').fill('Preserved tool reading draft');await page.locator('#composer').evaluate((input:HTMLTextAreaElement)=>input.setSelectionRange(3,13));
 await page.locator('.activity > summary').click();await page.locator('.tool-event > summary').click();await page.locator('.tool-raw > summary').click();
 const tool=page.locator('.tool-event').filter({hasText:'Later public result'}),raw=tool.locator('.tool-raw > summary');
 await tool.evaluate(n=>{(window as any).__originalTool=n;(window as any).__originalRaw=n.querySelector('.tool-raw');});await expect(raw).toBeFocused();
 await api(page,"adapter.getWork('work-1').sessions[0].messages.unshift({id:'earlier-call',runId:'same-run',role:'assistant',text:'',tool:{id:'earlier',name:'read',status:'Completed',content:'Earlier public result'}});adapter.emit();");
 assert.equal(await tool.evaluate(n=>n===(window as any).__originalTool&&n.querySelector('.tool-raw')===(window as any).__originalRaw),true);
 for(const detail of [page.locator('.activity'),tool,tool.locator('.tool-raw')])assert.equal(await detail.evaluate((n:HTMLDetailsElement)=>n.open),true);
 await expect(raw).toBeFocused();await expect(page.locator('#composer')).toHaveValue('Preserved tool reading draft');assert.deepEqual(await page.locator('#composer').evaluate((input:HTMLTextAreaElement)=>[input.selectionStart,input.selectionEnd]),[3,13]);
 await api(page,"adapter.getWork('work-1').sessions[0].messages.push({id:'newer-call',runId:'same-run',role:'assistant',text:'',tool:{id:'newer',name:'read',status:'Completed',content:'Newer public result'}});adapter.emit();");
 assert.equal(await tool.evaluate(n=>n===(window as any).__originalTool),true);await expect(raw).toBeFocused();assert.equal(requests.filter(r=>r.method==='POST').length,0);
});

test('Chat redesign: a later successful retry consumes its snapshot after repeated explicit rejection',async t=>{
 let posts=0;
 const {page}=await fixture(t,r=>r.path==='works/work-1/runs'&&r.method==='POST'?(++posts<3?{status:400,json:{code:'INVALID_REQUEST',message:'Explicit rejection'}}:{json:{run:{workId:'work-1',sessionId:'session-1',runId:'accepted-third',state:1}}}):undefined);
 await page.locator('#composer').fill('The original message');await button(page,'send-message').click();
 for(let i=0;i<2;i++){await page.locator('.message-submission.failed button').click();await button(page,'retry-chat-submission').click();if(i===0)await expect(page.locator('.message-submission.failed')).toBeVisible();}
 await expect(page.locator('.message-submission')).toHaveCount(0);await expect(page.locator('#composer')).toHaveValue('');assert.equal(posts,3);
});

for(const width of [1440,360])test(`Chat redesign: tool and raw reading anchors survive earlier calls at ${width}px`,async t=>{
 const {page,requests}=await fixture(t,()=>undefined);
 await button(page,'tab-Chat').click();await page.setViewportSize({width,height:900});
 const prose=(side:string)=>Array.from({length:12},(_,i)=>({id:`${side}-${i}`,role:'assistant',text:`${side} ${i} `+'Saved prose. '.repeat(25)}));
 const messages=[...prose('before'),{id:'target-call',runId:'reading-run',role:'assistant',text:'',tool:{id:'target',name:'read',status:'Completed',content:'Public tool line.\n'.repeat(120)}},...prose('after')];
 await api(page,`adapter.getWork('work-1').sessions[0].messages=${JSON.stringify(messages)};adapter.emit();`);
 await page.locator('#composer').fill('Keep this reading draft');await page.locator('#composer').evaluate((input:HTMLTextAreaElement)=>input.setSelectionRange(5,12));
 await page.locator('.activity > summary').click();await page.locator('.tool-event > summary').click();await page.locator('.tool-raw > summary').click();
 const tool=page.locator('.tool-event').filter({hasText:'Public tool line.'}),raw=tool.locator('.tool-raw');
 await tool.evaluate(n=>{(window as any).__anchorTool=n;(window as any).__anchorRaw=n.querySelector('.tool-raw');});
 for(const [index,target] of [tool,raw].entries()){
  await raw.locator('summary').focus();
  await target.evaluate((n,index)=>{const pane=document.querySelector<HTMLElement>('#messages')!;pane.scrollTop+=n.getBoundingClientRect().top-pane.getBoundingClientRect().top-(index===0?20:-80);pane.dispatchEvent(new Event('scroll'));},index);
  const before=(await target.boundingBox())!.y;
  await api(page,`const s=adapter.getWork('work-1').sessions[0],at=s.messages.findIndex(m=>m.id==='target-call');s.messages.splice(at,0,{id:'older-${index}',runId:'reading-run',role:'assistant',text:'',tool:{id:'older-${index}',name:'read',status:'Completed',content:'Earlier public result'}});s.messages.find(m=>m.id==='target-call').tool.content+='New public result tail.';adapter.emit();`);
  const after=(await target.boundingBox())!.y;
  assert.ok(Math.abs(after-before)<2,`Visible ${index===0?'tool':'raw'} anchor moved ${after-before}px at ${width}px`);
  assert.equal(await tool.evaluate(n=>n===(window as any).__anchorTool&&n.querySelector('.tool-raw')===(window as any).__anchorRaw),true);
  for(const detail of [page.locator('.activity'),tool,raw])assert.equal(await detail.evaluate((n:HTMLDetailsElement)=>n.open),true);
  await expect(raw.locator('summary')).toBeFocused();await expect(page.locator('#composer')).toHaveValue('Keep this reading draft');
  assert.deepEqual(await page.locator('#composer').evaluate((input:HTMLTextAreaElement)=>[input.selectionStart,input.selectionEnd]),[5,12]);
 }
 await button(page,'scroll-bottom').click();await expect(button(page,'scroll-bottom')).toHaveCount(0);assert.equal(requests.filter(r=>r.method==='POST').length,0);
});

test('Chat history: consecutive Send completion and refresh keep confirmed turn order',async t=>{
 const turns:{runId:string;prompt:string;key:string}[]=[];
 const session={workId:'work-1',sessionId:'session-1',modelPreference:null,source:{kind:'chat'}};
 const run=(n:number)=>({workId:'work-1',sessionId:'session-1',runId:`run-${n}`,submissionKey:turns[n-1]?.key,state:4});
 const segments=()=>turns.flatMap((turn,index)=>[
  {entryId:`${turn.runId}-user`,entryOrder:index*2,role:'user',runId:turn.runId,blockId:`${turn.runId}-user-0`,blockIndex:0,blockCount:1,type:'text',text:turn.prompt,byteOffset:0,totalBytes:Buffer.byteLength(turn.prompt),complete:true},
  {entryId:`reply-${index}`,entryOrder:index*2+1,role:'assistant',runId:turn.runId,blockId:`reply-${index}-0`,blockIndex:0,blockCount:1,type:'text',text:`Reply ${index+1}`,byteOffset:0,totalBytes:Buffer.byteLength(`Reply ${index+1}`),complete:true,streamId:`${turn.runId}-text-1`,streamOffset:0},
 ]);
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/history-capabilities'))return{json:{contractVersion:1,profile:'session-history-v1',pageBytes:524288}};
  if(r.path==='works/work-1/runs/active')return{json:{run:null}};
  if(r.path==='works/work-1/runs'&&r.method==='POST'){
   const body=JSON.parse(r.body),n=turns.length+1;turns.push({runId:`run-${n}`,prompt:body.prompt,key:body.submissionKey});return{json:{run:{...run(n),state:1}}};
  }
  const match=/\/runs\/run-(\d+)(\/events)?$/.exec(r.path);
  if(match){const n=Number(match[1]);return match[2]?{body:[{sequence:1,kind:{$case:'text',text:{delta:`Reply ${n}`}}},{sequence:2,kind:{$case:'state',state:{state:4}}}].map(e=>JSON.stringify(e)+'\n').join('')}:{json:{run:run(n)}};}
  if(r.path.endsWith('/history')){
   const query=new URLSearchParams(r.search),runId=query.get('runId');
   return{json:{contractVersion:1,session,snapshotId:query.get('snapshot')||`snapshot-${turns.length}`,segments:segments().filter(part=>!runId||part.runId===runId),runs:turns.map((_,index)=>({...run(index+1),resultRef:null})),hasMore:false,nextCursor:null}};
  }
 });
 for(let n=1;n<=3;n++){
  await page.locator('#composer').fill(`Question ${n}`);await button(page,'send-message').click();
  await expect.poll(()=>api(page,`const messages=adapter.getWork('work-1').sessions[0].messages;return messages.length===${n*2}&&messages.every(m=>m.historyStored&&!m.historyOrderUnconfirmed&&!m.historyRecoveryUnconfirmed);`)).toBe(true);
 }
 await expect(page.locator('.messages .message-text')).toHaveText(['Question 1','Reply 1','Question 2','Reply 2','Question 3','Reply 3']);
 await expect(page.locator('.message-history-status')).toHaveCount(0);
 await page.reload();await expect(page.locator('.messages .message-text')).toHaveText(['Question 1','Reply 1','Question 2','Reply 2','Question 3','Reply 3']);
 await expect(page.locator('.message-history-status')).toHaveCount(0);
 assert.equal(requests.filter(r=>r.method==='POST'&&r.path.endsWith('/runs')).length,3);
});

test('Paged message identity: a fixed Agent without live coordinates shows one answer and one Run', async t => {
 const posts:any[]=[];
 const session={workId:'work-1',sessionId:'session-1',modelPreference:null,source:{kind:'chat'}};
 const run=(state=4)=>({workId:'work-1',sessionId:'session-1',runId:'run-1',submissionKey:posts[0]?.submissionKey,state,finalText:state===4?'Reply':''});
 const segments=()=>[
  {entryId:'run-1-user',entryOrder:0,role:'user',runId:'run-1',blockId:'run-1-user-0',blockIndex:0,blockCount:1,type:'text',text:'Question',byteOffset:0,totalBytes:Buffer.byteLength('Question'),complete:true},
  {entryId:'saved-reply',entryOrder:1,role:'assistant',runId:'run-1',blockId:'saved-reply-0',blockIndex:0,blockCount:1,type:'text',text:'Reply',byteOffset:0,totalBytes:Buffer.byteLength('Reply'),complete:true},
 ];
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/history-capabilities'))return{json:{contractVersion:1,profile:'session-history-v1',pageBytes:524288}};
  if(r.path==='works/work-1/runs'&&r.method==='POST'){posts.push(JSON.parse(r.body));return{json:{run:run(1)}};}
  if(/^works\/work-1\/runs\/run-1$/.test(r.path))return{json:{run:run()}};
  if(r.path==='works/work-1/runs/run-1/events')return{body:[{sequence:1,kind:{$case:'text',text:{delta:'Reply'}}},{sequence:2,kind:{$case:'state',state:{state:4,finalText:'Reply'}}}].map(event=>JSON.stringify(event)+'\n').join(''),headers:{'Content-Type':'application/x-ndjson'}};
  if(r.path.endsWith('/history'))return{json:{contractVersion:1,session,snapshotId:'frozen',segments:segments(),runs:posts.length?[{...run(),resultRef:null}]:[],hasMore:false,nextCursor:null}};
 });
 await page.locator('#composer').fill('Question');await button(page,'send-message').click();
 await expect.poll(()=>api(page,`const messages=adapter.getWork('work-1').sessions[0].messages;return messages.length===2&&messages.every(m=>m.text&&!m.historyRecoveryUnconfirmed);`)).toBe(true);
 await expect(page.locator('#messages .message.user')).toHaveCount(1);await expect(page.locator('#messages .message.assistant')).toHaveCount(1);
 await api(page,`await adapter.loadSession('work-1','session-1');await adapter.loadSession('work-1','session-1');`);
 await expect(page.locator('#messages .message.user')).toHaveCount(1);await expect(page.locator('#messages .message.assistant')).toHaveCount(1);
 await page.reload();await expect(page.locator('#messages .message.user')).toHaveCount(1);await expect(page.locator('#messages .message.assistant')).toHaveCount(1);
 assert.equal(posts.length,1);
 assert.equal(requests.filter(r=>r.method==='POST'&&r.path==='works/work-1/runs').length,1);
});

test('Paged message identity: saved prefixes, split blocks and final takeover keep the reading prose', async t => {
 const paragraphs=Array.from({length:180},(_,index)=>`Paragraph ${String(index).padStart(3,'0')} ${'Reading prose. '.repeat(6)}`),text=paragraphs.join('\n\n');
 const session={workId:'work-1',sessionId:'session-1',modelPreference:null,source:{kind:'chat'}};
 let stage=0,savedSegments:any[]=[];
 const encoder=new TextEncoder();
 const block=(entryId:string,blockId:string,value:string,index:number,count:number,order=2)=>({entryId,entryOrder:order,role:'assistant',runId:'run-1',blockId,blockIndex:index,blockCount:count,type:'text',text:value,byteOffset:0,totalBytes:encoder.encode(value).length,complete:true});
 const {page}=await fixture(t,r=>{
  if(r.path.endsWith('/history-capabilities'))return{json:{contractVersion:1,profile:'session-history-v1',pageBytes:524288}};
  if(/^works\/work-1\/runs\/run-1$/.test(r.path))return{json:{run:{workId:'work-1',sessionId:'session-1',runId:'run-1',state:4,finalText:text}}};
  if(r.path.endsWith('/history'))return{json:{contractVersion:1,session,snapshotId:`frozen-${stage}`,segments:[{entryId:'run-1-user',entryOrder:0,role:'user',runId:'run-1',blockId:'run-1-user-0',blockIndex:0,blockCount:1,type:'text',text:'Question',byteOffset:0,totalBytes:8,complete:true},...savedSegments],runs:[],hasMore:false,nextCursor:null}};
 });
 await api(page,`const s=adapter.getWork('work-1').sessions[0],sources=adapter.liveSources('work-1','session-1');
  sources.acceptInput({id:'run-1-user',runId:'run-1',role:'user',text:'Question'});sources.begin('run-1',0);sources.text('run-1',1,${JSON.stringify(text)});
  s.messages=[{id:'run-1-user',runId:'run-1',role:'user',text:'Question'},{id:'run-1-text-1',runId:'run-1',role:'assistant',text:${JSON.stringify(text)}},{id:'run-1-tool-live',runId:'run-1',role:'assistant',text:'',tool:{id:'call-1',name:'read',status:'Completed',content:'Public tool output.\\n'.repeat(40)}}];adapter.emit();`);
 await page.locator('#composer').fill('Keep this reading draft');await page.locator('#composer').evaluate((input:HTMLTextAreaElement)=>input.setSelectionRange(4,11));
 await page.locator('.activity > summary').click();await page.locator('.tool-event > summary').click();
 const visible=()=>page.evaluate(()=>{const pane=document.querySelector<HTMLElement>('#messages')!,box=pane.getBoundingClientRect(),range=document.caretRangeFromPoint?.(box.left+24,box.top+2),node=range?.startContainer;
  return node?(node.textContent||'').slice(range!.startOffset,range!.startOffset+32):undefined;});
 const stmt=()=>api(page,`const s=adapter.getWork('work-1').sessions[0];return {draft:document.querySelector('#composer').value,selection:[document.querySelector('#composer').selectionStart,document.querySelector('#composer').selectionEnd],open:[...document.querySelectorAll('details')].filter(d=>d.open).length,joined:s.messages.filter(m=>m.role==='assistant'&&!m.tool).map(m=>m.text).join('')};`);
 await page.evaluate(()=>{const pane=document.querySelector<HTMLElement>('#messages')!,node=document.querySelector<HTMLElement>('[data-message-key$=":run-1-text-1"]')!;pane.scrollTop+=node.getBoundingClientRect().top-pane.getBoundingClientRect().top+520;pane.dispatchEvent(new Event('scroll'));});
 const before=await visible();assert.ok(before);
 for(const [next,cuts] of [[900,[900]],[1800,[900,1800]],[text.length,[900,1800,text.length]]] as const){
  stage++;
  savedSegments=cuts.length===1&&next<text.length
   ?[block('saved-live','saved-live-0',text.slice(0,next),0,1)]
   :cuts.map((cut,index)=>block('saved-final',`saved-final-${index}`,text.slice(index?cuts[index-1]:0,cut),index,cuts.length));
  await api(page,`adapter.historyProjection('work-1','session-1').clear();await adapter.loadSavedRun('work-1',{id:'run-1',sessionId:'session-1',status:'succeeded',cursor:9,created:'2026-10-30T00:00:00Z'});`);
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  const afterMeasure=await visible(),state=await stmt();
  assert.equal(afterMeasure,before,`same reading prose after stage ${stage}`);
  assert.equal(state.draft,'Keep this reading draft');assert.deepEqual(state.selection,[4,11]);
  assert.ok(state.open>=2,'Activity and raw tool stay expanded');
  assert.equal(state.joined,text,`saved prefix and one uncovered tail never duplicate content at stage ${stage}`);
 }
 await expect(page.locator('#composer')).toHaveValue('Keep this reading draft');
});

test('Paged message identity: failed output keeps a saved prefix and one uncovered tail', async t => {
 const posts:any[]=[];
 const session={workId:'work-1',sessionId:'session-1',modelPreference:null,source:{kind:'chat'}};
 let finished=false;
 const run=()=>({workId:'work-1',sessionId:'session-1',runId:'run-1',submissionKey:posts[0]?.submissionKey,state:finished?5:1,finalText:'',...(finished?{error:{code:'INTERNAL_ERROR',message:'Synthetic failure'}}:{})});
 const segments=()=>[
  {entryId:'run-1-user',entryOrder:0,role:'user',runId:'run-1',blockId:'run-1-user-0',blockIndex:0,blockCount:1,type:'text',text:'Question',byteOffset:0,totalBytes:Buffer.byteLength('Question'),complete:true},
  {entryId:'saved-prefix',entryOrder:1,role:'assistant',runId:'run-1',blockId:'saved-prefix-0',blockIndex:0,blockCount:1,type:'text',text:'Rep',byteOffset:0,totalBytes:3,complete:true},
 ];
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/history-capabilities'))return{json:{contractVersion:1,profile:'session-history-v1',pageBytes:524288}};
  if(r.path==='works/work-1/runs'&&r.method==='POST'){posts.push(JSON.parse(r.body));return{json:{run:run()}};}
  if(/^works\/work-1\/runs\/run-1$/.test(r.path))return{json:{run:run()}};
  if(r.path==='works/work-1/runs/run-1/events'){finished=true;return{body:[{sequence:1,kind:{$case:'text',text:{delta:'Reply'}}},{sequence:2,kind:{$case:'state',state:{state:5,finalText:''}}}].map(event=>JSON.stringify(event)+'\n').join(''),headers:{'Content-Type':'application/x-ndjson'}};}
  if(r.path.endsWith('/history'))return{json:{contractVersion:1,session,snapshotId:'frozen',segments:finished?segments():[],runs:finished?[{...run(),resultRef:null}]:[],hasMore:false,nextCursor:null}};
 });
 await page.locator('#composer').fill('Question');await button(page,'send-message').click();
 const assistant=()=>api(page,`return adapter.getWork('work-1').sessions[0].messages.filter(m=>m.role==='assistant'&&!m.tool).map(m=>m.text).join('')`);
 await expect.poll(assistant).toBe('Reply');
 await expect.poll(()=>api(page,`return adapter.getWork('work-1').sessions[0].messages.some(m=>m.id==='saved-prefix-0');`)).toBe(true);
 assert.equal(await assistant(),'Reply');
 await api(page,`await adapter.loadSession('work-1','session-1');await adapter.loadSession('work-1','session-1');`);
 assert.equal(await assistant(),'Reply');
 await expect(page.locator('#messages .message.user')).toHaveCount(1);
 assert.equal(posts.length,1);
 assert.equal(requests.filter(r=>r.method==='POST'&&r.path==='works/work-1/runs').length,1);
});

for(const [width,locale]of [[1440,'en'],[360,'zh-CN']]as const)test(`Chat history: real uncertainty uses message icons and scoped read-only recovery at ${width}px`,async t=>{
 const runId='run-original',userId=`${runId}-user`,toolId=`${runId}-tool-call-1`;
 const session={workId:'work-1',sessionId:'session-1',modelPreference:null,source:{kind:'chat'}};
 const segment=(entryId:string,role:string,text:string,entryOrder:number,extra:Record<string,unknown>={})=>({entryId,role,text,entryOrder,runId,blockId:`${entryId}-0`,blockIndex:0,blockCount:1,type:'text',byteOffset:0,totalBytes:Buffer.byteLength(text),complete:true,...extra});
 const {page,requests}=await fixture(t,r=>r.path.endsWith('/history')?{json:{contractVersion:1,session,snapshotId:'confirmed',segments:[segment(userId,'user','User content',0),segment('reply','assistant','Reply content',1),segment('tool','toolResult','done',2,{type:'tool-result',toolCallId:'call-1',toolName:'read',resultKind:'text',truncated:false,isError:false})],runs:[],hasMore:false,nextCursor:null}}:undefined);
 await page.setViewportSize({width,height:1000});
 await api(page,`const {chooseLocale}=await import('/desktop/browser/locale.js');chooseLocale('${locale}');const s=adapter.getWork('work-1').sessions[0];s.messages=[{id:'${userId}',runId:'${runId}',role:'user',text:'User content',historyOrderUnconfirmed:true},{id:'reply-0',runId:'${runId}',role:'assistant',text:'Reply content',historyIncomplete:true,historyRecoveryUnconfirmed:true},{id:'${toolId}',runId:'${runId}',role:'assistant',text:'',historyOrderUnconfirmed:true,tool:{id:'call-1',name:'read',status:'Completed',content:'done'}}];adapter.emit();`);
 await page.locator('#composer').fill('Keep my new draft');
 await expect(page.locator('.message-text')).toHaveText(['User content','Reply content']);
 await expect(page.locator('.activity > summary')).not.toContainText(/Message order|消息顺序/);
 const icons=page.locator('.message-history-status');await expect(icons).toHaveCount(3);await expect(icons).toHaveText(['','','']);
 const user=icons.filter({has:page.locator('svg')}).first();await user.focus();await page.keyboard.press('Enter');
 await expect(page.locator('#modal')).toContainText(locale==='en'?'Message order is not confirmed.':'消息顺序尚未确认。');
 await page.keyboard.press('Escape');await expect(user).toBeFocused();
 await page.locator('.message.assistant .message-history-status').click();
 await expect(page.locator('#modal')).toContainText(locale==='en'?'Part of this message is not loaded.':'此消息的一部分尚未加载。');
 const box=await page.locator('#modal').boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width+1);
 await button(page,'reload-history').click();await expect(icons).toHaveCount(0);
 await expect(page.locator('#composer')).toHaveValue('Keep my new draft');
 assert.equal(requests.filter(r=>r.path.endsWith('/history')).length,1);assert.equal(requests.filter(r=>r.method==='POST').length,0);
});

test('Legacy message identity: actual send, stream and SDK readback stay single across equal consecutive turns', async t => {
 const posts:any[]=[],completed:number[]=[];
 const run=(n:number,state=4)=>({workId:'work-1',sessionId:'session-1',runId:`legacy-${n}`,submissionKey:posts[n-1]?.submissionKey,state,finalText:state===4?'Stable answer':'',acceptedAt:`2026-10-30T00:00:0${n}Z`});
 const sdk=(n:number,role:string,text:string)=>({entryId:`sdk-${role}-${n}`,runId:`legacy-${n}`,role,text,blocks:[{blockId:`sdk-${role}-${n}-0`,type:'text',text}]});
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/history-capabilities'))return{status:501,json:{code:'HISTORY_UNSUPPORTED'}};
  if(r.path.endsWith('/chat-capabilities'))return{json:{contractVersion:1}};
  if(r.path.endsWith('/chat-models'))return{json:{models:[],defaultModel:{modelRef:null,label:'Work model',provider:'fixture',model:'one',thinkingLevels:['off'],defaultThinkingLevel:'off'},availability:'available',checkedAt:new Date().toISOString()}};
  if(r.path.endsWith('/chat-options'))return{json:{sessionId:'session-1',modelRef:null,thinkingLevel:'off',availability:'available',model:{modelRef:null,label:'Work model',provider:'fixture',model:'one'}}};
  if(r.path==='works/work-1/sessions/session-1')return{json:{session:{workId:'work-1',sessionId:'session-1',modelPreference:null,thinkingLevel:'off'},messages:completed.flatMap(n=>[sdk(n,'user',posts[n-1].prompt),sdk(n,'assistant','Stable answer')]),runs:completed.map(n=>run(n))}};
  if(r.path==='works/work-1/runs'&&r.method==='POST'){posts.push(JSON.parse(r.body));return{json:{run:run(posts.length,1)}};}
  const match=/^works\/work-1\/runs\/legacy-(\d+)(\/events)?$/.exec(r.path);
  if(match){const n=Number(match[1]);if(!match[2])return{json:{run:run(n)}};if(!completed.includes(n))completed.push(n);return{body:[{sequence:9,kind:{$case:'text',text:{delta:'Stable answer'}}},{sequence:40,kind:{$case:'state',state:{state:4,finalText:'Stable answer'}}}].map(e=>JSON.stringify(e)+'\n').join(''),headers:{'Content-Type':'application/x-ndjson'}};}
 });
 for(let n=1;n<=2;n++){
  await page.locator('#composer').fill('Same input');await button(page,'send-message').click();
  await expect.poll(()=>api(page,`return adapter.getWork('work-1').sessions[0].messages.some(m=>m.id==='sdk-assistant-${n}-0')`)).toBe(true);
  await expect(page.locator('#messages .message.user')).toHaveCount(n);await expect(page.locator('#messages .message.assistant')).toHaveCount(n);
  await api(page,`await adapter.loadSession('work-1','session-1');await adapter.loadSession('work-1','session-1');`);
  await expect(page.locator('#messages .message.user')).toHaveCount(n);await expect(page.locator('#messages .message.assistant')).toHaveCount(n);
 }
 await page.reload();await expect(page.locator('#composer')).toBeVisible();await expect(page.locator('#messages .message.user')).toHaveCount(2);await expect(page.locator('#messages .message.assistant')).toHaveCount(2);
 assert.equal(posts.length,2);assert.notEqual(posts[0].submissionKey,posts[1].submissionKey);
 assert.equal(requests.filter(r=>r.method==='POST'&&r.path==='works/work-1/runs').length,2);
 assert.equal(requests.filter(r=>r.path.endsWith('/history')).length,0);
});

for(const state of [5,6])test(`Legacy message identity: partial output remains once after terminal state ${state}`,async t=>{
 let accepted:any,finished=false;
 const run=()=>({workId:'work-1',sessionId:'session-1',runId:'legacy-partial',state:finished?state:1,finalText:'',...(state===5?{error:{code:'INTERNAL_ERROR',message:'Synthetic failure'}}:{})});
 const sdk=(id:string,role:string,text:string)=>({entryId:id,runId:'legacy-partial',role,text,blocks:[{blockId:id+'-0',type:'text',text}]});
 const {page,requests}=await fixture(t,r=>{
  if(r.path.endsWith('/history-capabilities'))return{status:501,json:{code:'HISTORY_UNSUPPORTED'}};
  if(r.path==='works/work-1/sessions/session-1')return{json:{session:{workId:'work-1',sessionId:'session-1',modelPreference:null},messages:finished?[sdk('user','user',accepted.prompt),sdk('prefix','assistant','Known ')]:[],runs:finished?[run()]:[]}};
  if(r.path==='works/work-1/runs'&&r.method==='POST'){accepted=JSON.parse(r.body);return{json:{run:run()}};}
  if(r.path==='works/work-1/runs/legacy-partial/events'){finished=true;return{body:[{sequence:9,kind:{$case:'text',text:{delta:'Known tail'}}},{sequence:40,kind:{$case:'state',state:{state,finalText:''}}}].map(e=>JSON.stringify(e)+'\n').join(''),headers:{'Content-Type':'application/x-ndjson'}};}
  if(r.path==='works/work-1/runs/legacy-partial')return{json:{run:run()}};
 });
 await page.locator('#composer').fill('Question');await button(page,'send-message').click();
 const body=()=>api(page,`return adapter.getWork('work-1').sessions[0].messages.filter(m=>m.role==='assistant'&&!m.tool).map(m=>m.text).join('')`);
 await expect.poll(body).toBe('Known tail');
 await expect.poll(()=>api(page,`return adapter.getWork('work-1').sessions[0].messages.some(m=>m.id==='prefix-0')`)).toBe(true);
 await api(page,`await adapter.loadSession('work-1','session-1');await adapter.loadSession('work-1','session-1');`);
 assert.equal(await body(),'Known tail');await expect(page.locator('#messages .message.user')).toHaveCount(1);await expect(page.locator('#messages .message.assistant')).toHaveCount(2);
 assert.equal(requests.filter(r=>r.method==='POST'&&r.path==='works/work-1/runs').length,1);
});
