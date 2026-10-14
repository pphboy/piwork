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

async function knownOperations(page: Page) {
  if (await page.locator('#modal').count()) await button(page, 'close-modal').click();
  if (await button(page, 'back-works').count()) await button(page, 'back-works').click();
  await button(page, 'account').click();
  await button(page, 'operations').click();
}
async function exportDetails(page: Page) {
  if (!await page.locator('.export-details').evaluate(el => el.hasAttribute('open'))) await page.locator('.export-details > summary').click();
}

type RequestRecord = { bytes?: Buffer | null; path: string; search?:string; method: string; headers: Record<string, string>; body: string };
type Reply = { passthrough?: boolean; status?: number; json?: unknown; body?: string | Buffer; headers?: Record<string, string>; abort?: boolean };
const mtime1 = 'Sat, 03 Oct 2026 01:00:00 GMT';
const mtime2 = 'Sat, 03 Oct 2026 01:00:02 GMT';
const mtime3 = 'Sat, 03 Oct 2026 01:00:04 GMT';
async function fixture(t: { after: (fn: () => Promise<void>) => void }, handler: (record: RequestRecord) => Reply | undefined | Promise<Reply | undefined>, anonymous = false, waitForInitialWork = true) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); t.after(() => page.close()); page.setDefaultTimeout(5000);
  const requests: RequestRecord[] = [];
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
const api = (page: Page, code: string): Promise<any> => page.evaluate(`(async () => { const { adapter } = await import('/desktop/browser/adapter.js'); ${code} })()`);
const button = (page: Page, action: string) => page.locator(`[data-action="${action}"]`).last();
function listing(body: string, modified: string) { return `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/_desktop/files/works/work-1/files/note.txt</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>${Buffer.byteLength(body)}</d:getcontentlength><d:getlastmodified>${modified}</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`; }

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

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
 await page.locator('#chat-image-input').setInputFiles({name:'early.png',mimeType:'image/png',buffer:bytes});await expect(page.locator('.chat-image-draft')).toContainText('Checking');sessions.resolve();await expect(page.locator('.messages')).toContainText('original prompt');await page.evaluate(()=>(window as any).releaseImageRead());await expect(page.locator('.chat-image-drafts')).not.toContainText('Checking');await button(page,'send-message').click();await expect.poll(()=>submitted?.sessionId).toBe('session-1');assert.equal(requests.filter(r=>r.path==='works/work-1/sessions'&&r.method==='POST').length,0);
});

test('Create Work geometry stays stable during delayed feedback on a narrow viewport',async t=>{
 const gate=deferred();t.after(()=>gate.resolve());
 const {page,requests}=await fixture(t,async r=>{if(r.path==='works'&&r.method==='POST'){await gate.promise;return {status:400,json:{code:'INVALID_REQUEST',message:'A long rejected creation message '.repeat(30)}};}});
 await page.setViewportSize({width:360,height:800});await button(page,'back-works').click();await button(page,'new-work').first().click();await page.locator('#create-name').fill('Long work name '.repeat(7));
 const before=await button(page,'create-work').boundingBox();await button(page,'create-work').click();await expect(page.locator('[data-action-status]').filter({hasText:'Creating Work'})).toBeVisible();
 const waiting=await button(page,'create-work').boundingBox();for(const key of ['x','y','width','height'] as const)assert.ok(Math.abs(before![key]-waiting![key])<=1,`${key} moved`);
 await expect(page.locator('[data-action-status]').filter({hasText:'Still waiting'})).toBeVisible({timeout:12000});const longWait=await button(page,'create-work').boundingBox();for(const key of ['x','y','width','height'] as const)assert.ok(Math.abs(before![key]-longWait![key])<=1,`${key} moved on long wait`);
 gate.resolve();await expect(button(page,'create-work')).toBeEnabled();const failed=await button(page,'create-work').boundingBox();for(const key of ['x','y','width','height'] as const)assert.ok(Math.abs(before![key]-failed![key])<=1,`${key} moved on error`);
 assert.equal(requests.filter(r=>r.path==='works'&&r.method==='POST').length,1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
});

test('Advanced Create Work keeps feedback visible and buttons stable when the result is unknown',async t=>{
 const gate=deferred();t.after(()=>gate.resolve());
 const {page,requests}=await fixture(t,async r=>{if(r.path==='works'&&r.method==='POST'){await gate.promise;return {abort:true};}});
 await button(page,'back-works').click();await button(page,'new-work').first().click();await page.locator('#create-name').fill('Advanced creation');await button(page,'toggle-create-advanced').click();await page.locator('#create-agents').fill('Long advanced instructions\n'.repeat(80));
 const before=await button(page,'create-work').boundingBox();await button(page,'create-work').click();await expect(page.locator('.create-action-status')).toContainText('Creating Work');await expect(page.locator('.create-action-status')).toBeInViewport();gate.resolve();await expect(page.locator('.create-action-status')).toContainText(/unknown|lost|not confirmed/i);
 const after=await button(page,'create-work').boundingBox();for(const key of ['x','y','width','height'] as const)assert.ok(Math.abs(before![key]-after![key])<=1,`${key} moved`);await expect(button(page,'create-work')).toBeDisabled();assert.equal(requests.filter(r=>r.path==='works'&&r.method==='POST').length,1);
});

test('About displays local version while Core is delayed and escapes embedded notes',async t=>{
 const gate=deferred();t.after(()=>gate.resolve());
 const about=(program:string,version:string)=>({aboutApiVersion:1,build:{program,version,commit:'fixture',modified:true,os:'linux',architecture:'amd64'},releaseNotes:{version,title:'Update',sections:[{title:'Fixes',items:['<script>window.notesExecuted=true</script>']}]},releasesUrl:'https://github.com/pphboy/piwork/releases'});
 const {page,requests}=await fixture(t,async r=>{if(r.path==='about')return {json:about('piwork-cli','client-test')};if(r.path==='core-about'){await gate.promise;return {json:about('piwork-serve','core-test')};}});
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
 await page.locator('#chat-image-input').setInputFiles({name:'original.png',mimeType:'image/png',buffer:bytes});await expect(page.locator('.chat-image-drafts')).not.toContainText('Checking');await button(page,'send-message').click();await expect(button(page,'check-chat-submission')).toBeVisible();await expect(page.locator('.chat-image-draft')).toHaveCount(1);
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
  await button(page, trigger).click();
  await expect(page.locator('[data-action-status]').filter({ hasText: action === 'create' ? 'New tool' : 'Recovery Work' }).first()).toContainText(action === 'create' ? 'Creating' : action === 'stop' ? 'Stopping' : action === 'delete' ? 'Deleting' : 'Starting');
  await expect(button(page, trigger)).toBeDisabled();
  await page.evaluate(action => document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.click(), trigger);
  assert.equal(requests.filter(r => r.method === 'POST' && (r.path.includes(`/${action}`) || action === 'create' && r.path === 'works')).length, 1);
  submitting.resolve();
  if (action === 'start' || action === 'retry') {
    await expect(page.locator(`.object-control-progress [data-action=operation][data-id="op-${action}"]`)).toBeVisible();
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
  await expect(page.locator('[data-action-status]').filter({hasText:'Saving settings'})).toBeVisible();
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
  await knownOperations(page);
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
  await expect(page.getByRole('heading', { name: 'Works', exact: true })).toBeVisible();
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(downloadEvents, 1);
  assert.deepEqual(requests.filter(r => r.method === 'POST').map(r => r.path), ['work-snapshots/snap-1/downloads']);
  assert.deepEqual(requests.filter(r => r.path.endsWith('/content')).map(r => r.path), [`downloads/${id}/content`]);
  await knownOperations(page); await page.locator('#snapshot-query').fill('snap-1'); await button(page, 'lookup-snapshot').click();
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
  await knownOperations(page);
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

for (const entry of ['connection', 'readiness', 'retry-works', 'open-work', 'settings', 'services', 'files', 'sessions', 'new-session', 'select-session', 'catalog', 'refresh-config', 'known', 'lookup', 'snapshot', 'check-operation', 'resume-operation', 'clear'] as const) test(`D01/D04–D06/D14–D15/D20 ${entry} waits visibly for its own request`, async t => {
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
  else if (entry==='known') { await button(page,'back-works').click(); await button(page,'account').click(); trigger='operations'; }
  else {
    await button(page,'back-works').click();
    await api(page,`adapter.state.operations.push(${JSON.stringify({...operation,state:entry==='clear'?'succeeded':'running'})})`);
    await knownOperations(page);
    if(entry==='lookup') {await page.locator('#operation-query').fill('op-read');trigger='lookup-operation';}
    else if(entry==='snapshot') {await page.locator('#snapshot-query').fill('snap-read');trigger='lookup-snapshot';}
    else if(entry==='clear') trigger='clear-operations';
    else {await button(page,'operation').click(); if(entry==='resume-operation') await button(page,'pause-operation').click(); trigger=entry;}
  }
  armed = true; const before = requests.filter(r=>r.path===endpoint[entry]).length;
  await button(page,trigger).click();
  if (entry==='retry-works') { await expect(page.locator('.page-heading [data-action="retry-works"]')).toHaveAttribute('aria-busy','true'); await expect(page.locator('.page-heading [data-action="retry-works"]')).toBeDisabled(); }
  else if (entry==='open-work') { await expect(page.locator('.work-header .work-read-feedback[role="status"][aria-busy="true"]')).toBeVisible(); await expect(page.getByRole('heading',{name:'Recovery Work',exact:true})).toBeVisible(); }
  else if (entry==='files') { await expect(button(page,'refresh-files')).toHaveAttribute('aria-busy','true'); await expect(page.locator('.main-panel .read-placeholder[aria-busy="true"]')).toBeVisible(); }
  else if (entry==='sessions'||entry==='select-session') await expect(page.locator('.agent-header [data-action="sessions"]')).toHaveAttribute('aria-busy','true');
  else await expect(page.locator('[data-action-status][aria-busy="true"]').first()).toBeVisible();
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
  await expect(page.locator('[data-action-status][aria-busy="true"]').filter({hasText:'service-a'})).toBeVisible();
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
  await button(page,'start-work').click();await expect(page.locator('.object-control-progress [data-action=operation][data-id="op-start"]')).toBeVisible();await expect(page.locator('#modal')).toHaveCount(0);
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
  armed=true;const before=requests.filter(r=>r.path.includes('/logs')).length;await button(page,action==='detail'?'service-details':'refresh-logs').click();
  await expect(page.locator('[data-action-status][aria-busy="true"]').filter({hasText:'tool'})).toBeVisible();assert.equal(requests.filter(r=>r.path.includes('/logs')).length-before,1);gate.resolve();
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
  if(action==='read') { await expect(page.locator('[data-action="open-file"][data-path="/note.txt"]')).toHaveAttribute('aria-busy','true'); await expect(page.locator('[data-action="open-file"][data-path="/note.txt"]')).toBeDisabled(); }
  else if(action==='path'||action==='refresh') { await expect(button(page,'refresh-files')).toHaveAttribute('aria-busy','true'); await expect(button(page,'refresh-files')).toHaveAccessibleName('Reading files…'); }
  else await expect(page.locator('[data-action-status][aria-busy="true"]').first()).toBeVisible();
  if(action==='upload'){await expect(page.locator('#app')).toContainText('File 1 of 1');await expect(page.locator('#app')).toContainText('Waiting for confirmation');}
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
    if(accepted&&r.path==='works/work-1/configuration')await readback.promise;
  });
  await button(page,'settings').click();await page.locator('[data-action="settings-section"][data-tab="Pi Packages"]').click();
  await button(page,update?'update-package':'install-package').click();await page.locator('#install-type').selectOption(source);
  if(source==='npm'||source==='Git')await page.locator('#install-source').fill(source==='npm'?'pkg@1.0.0':'https://example.test/pkg.git');
  else if(source==='ZIP')await page.locator('#package-zip-input').setInputFiles({name:'pkg.zip',mimeType:'application/zip',buffer:Buffer.from('original ZIP fixture bytes')});
  else if(source==='Local directory')await page.evaluate(()=>{const transfer=new DataTransfer();const file=new File(['{"name":"pkg"}'],'package.json');Object.defineProperty(file,'webkitRelativePath',{value:'pkg/package.json'});transfer.items.add(file);const input=document.querySelector<HTMLInputElement>('#package-directory-input')!;input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));});
  await button(page,'confirm-install').click();await expect(page.locator('[data-action-status][aria-busy="true"]')).toContainText('Submitting package');
  await expect(button(page,'confirm-install')).toBeDisabled();gate.resolve();await expect(page.locator('#modal')).toContainText('op-package');
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
  await button(page,trigger).click();await expect(page.locator('[data-action-status][aria-busy="true"]').filter({ hasText: action === 'apply' ? 'Submitting Apply' : action === 'skill-copy' ? 'Copying Skill' : 'Removing package' })).toBeVisible();gate.resolve();
  await expect(page.locator('body')).toContainText(action==='skill-copy'?'Skill copy saved':'op-'+action);assert.equal(requests.filter(r=>r.path===endpoint&&r.method!=='GET').length,1);read.resolve();
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
  armed=true;const trigger=entry==='login'?'sign-in':entry==='logout'?'sign-out':'confirm-switch-core';await button(page,trigger).click();await expect(page.locator('[data-action-status][aria-busy="true"]')).toContainText(entry==='login'?'Signing in':entry==='logout'?'Signing out':'Switching Core');await expect(button(page,trigger)).toBeDisabled();
  gate.resolve();if(entry==='logout')await expect(page.locator('#app')).toContainText('Remote revocation could not be confirmed');else await expect(page.locator('[data-action-status][aria-busy="true"]')).toHaveCount(0);assert.equal(requests.filter(r=>r.path===endpoint&&r.method!=='GET').length,1);
});

for(const method of ['mouse','keyboard'] as const)test(`D07 Send ${method} confirms original Run, retains newer draft, duplicate submission is blocked`,async t=>{
  const gate=deferred(),events=deferred();t.after(async()=>{gate.resolve();events.resolve();});
  const {page,requests}=await fixture(t,async r=>{
    if(r.path==='works/work-1/runs'&&r.method==='POST'){await gate.promise;return{json:{run:{runId:'run-original',sessionId:'session-1',state:1}}};}
    if(r.path.endsWith('/events')){await events.promise;return{status:503};}
  });
  await page.locator('#composer').fill('submitted prompt');if(method==='mouse')await button(page,'send-message').click();else await page.locator('#composer').press('Enter');
  await expect(page.locator('[data-action-status][aria-busy="true"]')).toContainText('Submitting message');await page.locator('#composer').fill('newer draft');await page.locator('#composer').press('Enter');assert.equal(requests.filter(r=>r.method==='POST').length,1);
  gate.resolve();const accepted=page.locator('[data-action-status]').filter({hasText:'run-original'});await expect(accepted).toBeVisible();await expect(accepted).toContainText('Message accepted');await expect(accepted.locator('code')).toBeHidden();await accepted.locator('summary').click();await expect(accepted.locator('code')).toBeVisible();await expect(page.locator('#composer')).toHaveValue('newer draft');events.resolve();
});

for(const action of ['cancel','resume'] as const)test(`D07 ${action} original Run has visible request and never resends the prompt`,async t=>{
  const gate=deferred();t.after(async()=>gate.resolve());
  const {page,requests}=await fixture(t,async r=>{
    if(r.path.endsWith('/cancel')){await gate.promise;return{json:{}};}
    if(r.path.endsWith('/events')){await gate.promise;return{body:'',headers:{'Content-Type':'application/x-ndjson'}};}
    if(r.path==='works/work-1/runs/run-original')return{json:{run:{runId:'run-original',sessionId:'session-1',state:2}}};
  });
  await api(page,`adapter.getWork('work-1').run={id:'run-original',sessionId:'session-1',status:'${action==='cancel'?'running':'interrupted'}',cursor:3,created:'',error:'Check the original Run'};`);await button(page,'agent-menu').click();await page.keyboard.press('Escape');
  await button(page,action==='cancel'?'cancel-run':'resume-run').click();await expect(page.locator('[data-action-status][aria-busy="true"]')).toContainText(action==='cancel'?'Requesting cancellation':'Reconnecting Run');gate.resolve();
  if(action==='cancel')await expect(button(page,'cancel-run')).toHaveText('Cancelling…');else await expect(page.locator('[data-action-status]').filter({hasText:'Reconnected'})).toBeVisible();assert.equal(requests.filter(r=>r.path==='works/work-1/runs'&&r.method==='POST').length,0);
  if(action==='cancel'){await expect(button(page,'cancel-run')).toBeDisabled();assert.equal(await api(page,"return adapter.getWork('work-1').run.status"),'running');}
});

for(const action of ['inspect','import','query','cleanup','export'] as const)test(`D17/D18 ${action} retains original transfer or acceptance identity through delayed response`,async t=>{
  const gate=deferred(),read=deferred();t.after(async()=>{gate.resolve();read.resolve();});let armed=false,accepted=false,id='transfer-original';
  const {page,requests}=await fixture(t,async r=>{
    if(r.path==='works'||r.path==='works/work-1'){if(accepted)await read.promise;const raw={id:'work-1',name:'Recovery Work',observedState:'stopped',desiredState:'stopped'};return{json:r.path==='works'?{works:[raw]}:raw};}
    if(r.path==='work-packages'&&r.method==='POST'){id=r.headers['x-piwork-transfer-id']!;await gate.promise;return{json:{transferId:id,summary:{name:'actual inspected'}}};}
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
      await api(page,`adapter.inspection={name:'fixture'};adapter.inspectionTransfer='${id}';adapter.inspectionContext={id:'${id}',nonce:1,core:'http://core.test',localSession:'local-session-csrf',ready:true,anonymous:false,importState:'${action==='query'?'unknown':'unsubmitted'}'};`);
      await api(page,"adapter['emit']()");
      armed=true;await button(page,action==='query'?'check-inspection-import':'confirm-import').click();
    }
  }
  if(action==='export'){await expect(page.locator('#modal')).toContainText('Starting export');await expect(button(page,'prepare-export')).toHaveCount(0);}
  else await expect(page.locator('[data-action-status][aria-busy="true"]').first()).toBeVisible();
  gate.resolve();
  if(action==='export'||action==='import'){await expect(page.locator('#modal')).toContainText('op-'+action);assert.equal(requests.filter(r=>r.path==='work-imports'||r.path.endsWith('/exports')).length,1);read.resolve();}
  else if(action==='inspect')await expect(page.locator('#modal')).toContainText('verified locally');
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
  await expect(page.locator('[data-action-status][aria-busy="true"]')).toContainText('service:a');await button(page,'close-modal').click();await button(page,'manage-services').click();await page.locator('[data-action="service-details"][data-id="b"]').click();
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
  await expect(page.locator('[data-action-status][aria-busy="true"]')).toContainText('service:a');
  await button(page, 'close-modal').click(); await details('a'); await page.getByRole('combobox', { name: 'Web entry', exact: true }).selectOption('8080'); await button(page, 'close-modal').click(); await details('a');
  await expect(page.locator('[data-control="restart"]')).toBeDisabled();
  await page.locator('[data-control="restart"]').evaluate((el: HTMLButtonElement) => el.click());
  assert.equal(requests.filter(r => r.path === 'works/work-1/services/a/restart').length, 1);
  await expect(page.locator('[data-action-status][aria-busy="true"]')).toContainText('service:a');
  await button(page, 'close-modal').click(); await details('b');
  await expect(page.locator('[data-control="restart"]')).toBeEnabled(); await page.locator('[data-control="restart"]').click();
  await expect(page.locator('#modal .object-control-progress [data-action=operation][data-id="op-b"]')).toBeVisible();
  assert.equal(requests.filter(r => r.path === 'works/work-1/services/b/restart').length, 1);
  assert.ok(requests.some(r => r.path === 'service-entries' && JSON.parse(r.body).port === 8080));
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
    await knownOperations(page); await page.locator('#operation-query').fill(id); await button(page, 'lookup-operation').click();
    await expect(page.locator('#modal')).toContainText(id); await button(page, 'check-operation').click(); await expect(button(page, 'check-operation')).toBeEnabled(); await button(page, 'close-modal').click();
    await expect(button(page, 'start-work')).toBeDisabled();
    await button(page, 'start-work').evaluate((el: HTMLButtonElement) => el.click());
    assert.equal(requests.filter(r => r.path === 'works/work-1/start').length, 1);
  }
  await knownOperations(page);
  await button(page, 'clear-operations').click(); await button(page, 'close-modal').click();
  await expect(button(page, 'start-work')).toBeDisabled();
  await button(page, 'start-work').evaluate((el: HTMLButtonElement) => el.click());
  assert.equal(requests.filter(r => r.path === 'works/work-1/start').length, 1);
  await page.locator('.work-name[data-action="open-work"]').click();
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
  await button(page,'tab-Files').click();await page.locator('[data-action="open-file"][data-path="/note.txt"]').click();await expect(page.locator('[data-action="open-file"][data-path="/note.txt"]')).toHaveAttribute('aria-busy','true');
  await api(page,"await adapter.switchCore('http://new-core.test')");gate.resolve();await expect(page.getByRole('heading',{name:'Connect to your Core'})).toBeVisible();await expect(page.locator('#app')).not.toContainText('original private file');await expect(page.locator('#file-editor')).toHaveCount(0);
});

test('DWUI-011/012 desktop and narrow status wrap; ten seconds remain waiting, focus and draft selection stay intact',async t=>{
  const gate=deferred();t.after(async()=>gate.resolve());let armed=false;
  const {page,requests}=await fixture(t,async r=>{if(armed&&r.path==='works/work-1/configuration'){await gate.promise;return{status:503,json:{message:'Configuration readback unavailable. '+ 'A bounded diagnostic detail. '.repeat(8)}};}});
  await button(page,'settings').click();await page.locator('[data-action="settings-section"][data-tab="AGENTS.md"]').click();
  await page.locator('#agents-editor').fill('draft retained while checking');await page.locator('#agents-editor').evaluate((input:HTMLTextAreaElement)=>input.setSelectionRange(3,9));
  armed=true;await button(page,'refresh-config').click();await page.locator('#agents-editor').focus();await page.locator('#agents-editor').evaluate((input:HTMLTextAreaElement)=>input.setSelectionRange(3,9));
  await expect(page.locator('[data-action-status][aria-busy="true"]')).toHaveAttribute('role','status');await expect(page.locator('[data-action-status][aria-busy="true"]')).toHaveAttribute('aria-live','polite');
  await expect(page.locator('[data-action-status]')).toContainText('Still waiting',{timeout:12000});await expect(page.locator('#agents-editor')).toBeFocused();assert.deepEqual(await page.locator('#agents-editor').evaluate((input:HTMLTextAreaElement)=>[input.selectionStart,input.selectionEnd]),[3,9]);
  const screenshots='/tmp/piwork-feedback-screens';await mkdir(screenshots,{recursive:true});
  for(const width of [1440,360]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${screenshots}/desktop-wait-${width}.png`,fullPage:true});}
  gate.resolve();await expect(page.locator('.settings-page')).toContainText('Configuration readback unavailable');await expect(page.locator('[data-action-status]')).toHaveCount(0);await expect(page.locator('#agents-editor')).toHaveValue('draft retained while checking');assert.equal(requests.filter(r=>r.method==='PUT').length,0);
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
  await button(page, 'start-work').click(); await expect(page.locator('.object-control-progress [data-action=operation][data-id="original-start"]')).toBeVisible(); await expect(page.locator('#modal')).toHaveCount(0);
  observed = 'starting'; await api(page, "await adapter.refreshWorkStatus('work-1')"); await expect(page.locator('.work-header')).toContainText('Starting');
  terminal = true; fail = true; await api(page, "await adapter.checkOperation('original-start'); await adapter.refreshWorkStatus('work-1').catch(()=>{}); await adapter.listWorks().catch(()=>{})");
  assert.equal(await api(page, "return adapter.state.operations[0].state"), 'succeeded');
  await expect(page.locator('.work-state')).toContainText('Work readback unavailable');
  fail = false; observed = 'ready'; await api(page, "await adapter.refreshWorkStatus('work-1'); await adapter.listWorks()");
  await expect(page.locator('.work-header')).toContainText('Ready'); await expect(page.locator('#composer')).toBeVisible();
  await page.locator('#composer').fill('keep my task'); await api(page, "await adapter.refreshWorkStatus('work-1')"); await expect(page.locator('#composer')).toHaveValue('keep my task');
  assert.equal(requests.filter(r => r.method === 'POST' && r.path.endsWith('/start')).length, 1);
});

test('DWUI-019 Files navigation leaves no Checked/ISO stack and Refresh confirmation expires', async t => {
  const { page } = await fixture(t, r => {
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

test('DWUI-017 cleared Start history still recovers Ready and original lookup without reload or replay', async t => {
  let accepted = false, offline = false;
  const fact = () => ({ id: 'work-1', name: 'Recovery Work', desiredState: accepted ? 'running' : 'stopped', observedState: accepted ? 'ready' : 'stopped', controlVersion: accepted ? 2 : 1 });
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works/work-1/start') { accepted = true; offline = true; return { json: { operationId: 'cleared-start', workId: 'work-1' } }; }
    if (r.path === 'operations/cleared-start') return { json: { operationId: 'cleared-start', workId: 'work-1', kind: 'start-work', state: 'succeeded' } };
    if (r.path === 'known-operations/cleared-start' && r.method === 'DELETE') return { json: {} };
    if (r.path === 'works' || r.path === 'works/work-1') return offline ? { status: 503, json: { message: 'readback offline' } } : { json: r.path === 'works' ? { works: [fact()] } : fact() };
  });
  const navigations: string[] = []; page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push(request.url()); });
  await button(page, 'start-work').click(); await page.locator('.object-control-progress [data-action=operation][data-id="cleared-start"]').click(); await expect(page.locator('#modal')).toContainText('cleared-start');
  await api(page, "await adapter.checkOperation('cleared-start'); await adapter.refreshWorkStatus('work-1').catch(() => {}); await adapter.listWorks().catch(() => {})");
  await button(page, 'close-modal').click(); await knownOperations(page);
  await button(page, 'clear-operations').click(); await expect(page.locator('#modal')).not.toContainText('cleared-start');
  await button(page, 'close-modal').click(); await page.locator('.work-name[data-action="open-work"]').click(); await button(page, 'work-operations').click();
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
  const raw = () => ({ id: 'work-1', name: 'Recovery Work', observedState: !started ? 'stopped' : ready ? 'ready' : 'starting', desiredState: started ? 'running' : 'stopped', controlVersion: started ? 2 : 1 });
  const { page, requests } = await fixture(t, r => {
    if (r.path === 'works' || r.path === 'works/work-1') return { json: r.path === 'works' ? { works: [raw()] } : raw() };
    if (r.path === 'works/work-1/start') { started = true; return { json: { operationId: 'c02-start', workId: 'work-1' } }; }
    if (r.path === 'operations/c02-start') return { json: { operationId: 'c02-start', workId: 'work-1', kind: 'start-work', state: terminal ? 'succeeded' : 'running' } };
  });
  await button(page, 'back-works').click(); await button(page, 'start-work').click();
  await expect(page.locator('.work-row .object-control-progress [data-id="c02-start"]')).toBeVisible();
  await expect(page.locator('#modal')).toHaveCount(0); await expect(page.getByRole('heading', { name: 'Works', exact: true })).toBeVisible();
  terminal = true; await button(page, 'check-work-progress').click();
  await expect(page.getByRole('link', { name: 'Open Work', exact: true })).toHaveCount(0);
  ready = true; await button(page, 'check-work-progress').click();
  await expect(page.getByRole('link', { name: 'Open Work', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Works', exact: true })).toBeVisible();
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
    if (r.path === 'work-packages' && r.method === 'POST') return { json: { transferId: r.headers['x-piwork-transfer-id'], summary: { name: 'sample package' } } };
    if (r.path === 'work-imports') { imported = true; return { json: { operationId: 'c03-import', workId: 'imported' } }; }
    if (r.path === 'operations/c03-import') return { json: { operationId: 'c03-import', workId: 'imported', kind: 'import-work', state: 'succeeded' } };
    if (r.path === 'works/imported/start') { started = true; return { json: { operationId: 'c03-start', workId: 'imported' } }; }
    if (r.path === 'operations/c03-start') return { json: { operationId: 'c03-start', workId: 'imported', kind: 'start-work', state: ready ? 'succeeded' : 'running' } };
  });
  await button(page, 'back-works').click(); await button(page, 'import').click();
  await page.locator('#work-file-input').setInputFiles({ name: 'sample.work', mimeType: 'application/vnd.piwork.work-package', buffer: Buffer.from('synthetic inspected package') });
  await expect(page.locator('.inspection-summary')).toContainText('sample package');
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
    if (r.path === 'work-packages' && r.method === 'POST') return { json: { transferId: r.headers['x-piwork-transfer-id'], summary: { name: 'recovery package' } } };
    if (r.path === 'work-imports' && r.method === 'POST') { imported = true; return { json: { operationId: importId, workId: 'imported' } }; }
    if (r.path === `operations/${importId}`) return { json: { operationId: importId, workId: 'imported', kind: 'import-work', state: 'succeeded' } };
    if (r.path === 'works/imported/start' && r.method === 'POST') { started = true; observed = 'starting'; return outcome === 'submission-unknown' ? { abort: true } : { json: { operationId: startId, workId: 'imported' } }; }
    if (r.path === `operations/${startId}`) return observationUnavailable ? { status: 503, json: { message: 'Original Start observation temporarily unavailable' } } : { json: { operationId: startId, workId: 'imported', kind: 'start-work', state: startState } };
  });
  const submissions = () => requests.filter(r => r.method === 'POST' && ['work-imports', 'works/imported/start'].includes(r.path)).map(r => r.path);
  await button(page, 'back-works').click(); await button(page, 'import').click();
  await page.locator('#work-file-input').setInputFiles({ name: 'recovery.work', mimeType: 'application/vnd.piwork.work-package', buffer: Buffer.from('synthetic recovery package') });
  await expect(page.locator('.inspection-summary')).toContainText('recovery package');
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
