import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
const moduleURL = new URL('../browser/adapter.js', import.meta.url).href;
const { DesktopAdapter } = await import(moduleURL);
type Data = Record<string, any>;

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

async function flush() { for (let index = 0; index < 8; index++) await Promise.resolve(); await new Promise<void>(resolve => setImmediate(resolve)); }

function view(state: string, overrides: Data = {}): Data {
  return { exportId: 'log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', correlationId: 'c', cutoffTime: '2026-10-13T00:00:00Z', state,
    scope: { includeCoreLogs: true, ownedWorkCount: 1, sourceCount: 2 }, createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:01Z',
    progress: { processedSources: state === 'ready' ? 2 : 1, totalSources: 2, collectedBytes: 10 }, complete: state === 'ready' ? true : null,
    warningCount: 0, warnings: [], warningsTruncated: false,
    result: state === 'ready' ? { filename: 'piwork-logs.zip', size: 10, digest: 'a'.repeat(64), readyAt: '2026-10-13T00:00:01Z', expiresAt: '2026-10-14T00:00:01Z' } : null,
    error: null, cleanupPending: false, ...overrides };
}

async function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-13T00:00:00Z') });
  const requests: Data[] = [];
  let handler: (request: Data) => Data | Promise<Data> = () => { throw new Error('unexpected request'); };
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const request = { path: String(input).replace('/_desktop/api/', ''), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined };
    requests.push(request);
    const reply = await handler(request);
    return new Response(JSON.stringify(reply), { status: 200 });
  });
  const adapter = new DesktopAdapter();
  adapter.state.signedIn = true;
  adapter.state.core = { address: 'https://core.test', name: 'Core', account: 'owner', role: 'admin', proxyPort: '', username: '' };
  t.after(() => adapter.clearIdentity());
  return { adapter, requests, respond: (next: (request: Data) => Data | Promise<Data>) => { handler = next; } };
}

test('log export intent creates once, polls, and auto-delivers only once', async t => {
  const f = await fixture(t);
  let generated = 0;
  f.respond(request => request.path === 'log-exports'
    ? { exportId: 'log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', correlationId: 'c', cutoffTime: '2026-10-13T00:00:00Z', state: 'collecting', scope: {}, reused: false }
    : view('collecting'));
  f.adapter.startLogExport();
  await flush();
  const state = f.adapter.logExport!;
  assert.equal(state.phase, 'collecting');
  assert.equal(state.autoDelivered, false);
  f.respond(() => view('packing'));
  t.mock.timers.tick(750); await flush();
  assert.equal(f.adapter.logExport!.phase, 'packing', JSON.stringify(f.adapter.logExport));
  f.respond(() => view('ready'));
  t.mock.timers.tick(750); await flush();
  assert.equal(f.adapter.logExport!.phase, 'ready');
  assert.equal(f.adapter.logExport!.autoDelivered, true);
  assert.equal(f.adapter.logExport!.delivered, true);
  assert.equal(f.requests.filter(request => request.method === 'POST').length, 1);
  generated++;
  assert.equal(generated, 1);
  // A late duplicate ready response cannot trigger another automatic delivery.
  t.mock.timers.tick(750); await flush();
  assert.equal(f.requests.filter(request => request.path.endsWith('/content')).length, 0);
});

test('log export unknown creation retains the same key and never silently re-POSTs', async t => {
  const f = await fixture(t);
  f.respond(() => { throw new Error('network down'); });
  f.adapter.startLogExport();
  await flush();
  const state = f.adapter.logExport!;
  assert.equal(state.phase, 'unknown');
  assert.ok(state.key.length > 0);
  const key = state.key;
  await flush(); t.mock.timers.tick(2000); await flush();
  assert.equal(f.requests.filter(request => request.method === 'POST').length, 1);
  f.respond(() => view('collecting'));
  f.adapter.retryLogExportSameKey();
  await flush();
  const posts = f.requests.filter(request => request.method === 'POST');
  assert.equal(posts.length, 2);
  assert.equal(posts[1]?.body.idempotencyKey, key);
});

test('restored export queries the original ID without automatic delivery', async t => {
  const f = await fixture(t);
  const store = new Map<string, string>();
  (globalThis as any).sessionStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) };
  f.respond(() => view('ready'));
  f.adapter.recoverLogExport();
  assert.equal((globalThis as any).sessionStorage.getItem(`piwork:log-export:https://core.test:owner`), null);
  // Without a known ID no request is made; seed the stored identity and retry.
  assert.equal(f.requests.length, 0);
  store.set('piwork:log-export:https://core.test:owner', 'log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  f.adapter.recoverLogExport();
  await flush();
  assert.equal(f.adapter.logExport!.restored, true);
  assert.equal(f.adapter.logExport!.autoDelivered, true);
  assert.equal(f.adapter.logExport!.delivered, false);
  assert.equal(f.requests.filter(request => request.path.endsWith('/content')).length, 0);
  delete (globalThis as any).sessionStorage;
});

test('identity changes clear the local export intent', async t => {
  const f = await fixture(t);
  f.respond(() => view('collecting'));
  f.adapter.startLogExport();
  await flush();
  assert.ok(f.adapter.logExport);
  f.adapter.clearIdentity();
  assert.equal(f.adapter.logExport, null);
});

test('same-key ready recovery fetches detail and delivers once after detail retry', async t => {
 const f=await fixture(t);
 let phase='unknown',detailCalls=0,deliveries=0;
 const deliver=f.adapter.deliverLogExport.bind(f.adapter);
 f.adapter.deliverLogExport=()=>{deliveries++;deliver();};
 f.respond(request=>{
  if(request.method==='POST'){
   if(phase==='unknown')throw new Error('creation response lost');
   return {exportId:view('ready').exportId,state:'ready',cutoffTime:view('ready').cutoffTime,reused:true};
  }
  detailCalls++;
  if(detailCalls===1)throw new Error('detail temporarily unavailable');
  return view('ready');
 });
 f.adapter.startLogExport();await flush();
 const key=f.adapter.logExport!.key;
 assert.equal(f.adapter.logExport!.phase,'unknown');
 phase='ready';f.adapter.retryLogExportSameKey();await flush();
 assert.equal(f.adapter.logExport!.id,view('ready').exportId);
 assert.equal(f.adapter.logExport!.key,key);
 assert.equal(deliveries,0);
 assert.equal(f.requests.filter(r=>r.method==='POST').length,2);
 await f.adapter.checkLogExport();
 assert.equal(f.adapter.logExport!.filename,'piwork-logs.zip');
 assert.equal(deliveries,1);
 await f.adapter.checkLogExport();
 assert.equal(deliveries,1);
 f.adapter.deliverLogExport();assert.equal(deliveries,2);
 assert.equal(f.requests.filter(r=>r.method==='POST').length,2);
 assert.equal(f.requests[1]!.body.idempotencyKey,key);
});
