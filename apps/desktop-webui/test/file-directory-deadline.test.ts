import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
const { DesktopAdapter } = await import(new URL('../browser/adapter.js', import.meta.url).href);
const emptyListing = '<d:multistatus xmlns:d="DAV:"/>';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-01T00:00:00Z') });
  let handler = async (_init: RequestInit): Promise<Response> => new Response(emptyListing, { status: 207 });
  const requests: Array<{ method: string; signal?: AbortSignal | null }> = [];
  t.mock.method(globalThis, 'fetch', async (input: unknown, init: RequestInit = {}) => {
    if (String(input) === '/_desktop/api/works/one') return new Response(JSON.stringify({ id: 'one', name: 'One', observedState: 'ready', desiredState: 'running', controlVersion: 1 }));
    requests.push({ method: init.method || 'GET', signal: init.signal });
    return handler(init);
  });
  let parsed = 0;
  const originalParser = (globalThis as any).DOMParser;
  (globalThis as any).DOMParser = class {
    parseFromString(xml: string) {
      assert.equal(xml, emptyListing);
      parsed++;
      return { querySelector: () => undefined, getElementsByTagNameNS: () => [] };
    }
  };
  t.after(() => {
    if (originalParser) (globalThis as any).DOMParser = originalParser;
    else delete (globalThis as any).DOMParser;
  });
  const adapter = new DesktopAdapter();
  await adapter.refreshWorkStatus('one');
  const work = adapter.getWork('one');
  const rows = [{ path: '/old.txt', name: 'old.txt', kind: 'file', size: 3, modified: 'original-version' }];
  work.files = rows;
  const state = { loading: false, checkedAt: 'original-confirmed', error: '' };
  adapter.directories.set('one:/', state);
  t.after(() => adapter.clearIdentity());
  return { adapter, work, rows, state, requests, parsed: () => parsed, respond: (next: typeof handler) => { handler = next; } };
}
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test('directory header timeout is bounded, aborts the read and retains confirmed rows', async t => {
  const f = await fixture(t);
  const headers = deferred<Response>();
  f.respond(() => headers.promise);
  const pending = f.adapter.loadDirectory('one');
  const failed = assert.rejects(pending, (error: any) => error.code === 'READ_TIMEOUT');
  assert.equal(f.state.loading, true);
  t.mock.timers.tick(10000);
  await failed;
  const originalRequest = f.requests[0];
  assert.ok(originalRequest, 'the original directory read was issued');
  assert.equal(originalRequest.signal?.aborted, true);
  assert.equal(f.state.loading, false);
  assert.equal(f.state.checkedAt, 'original-confirmed');
  assert.ok(String(f.state.error));
  assert.equal(f.work.files, f.rows);
  assert.equal(f.requests.length, 1);
  assert.equal(originalRequest.method, 'PROPFIND');
  headers.resolve(new Response(emptyListing, { status: 207 }));
  await flush();
  assert.equal(f.parsed(), 0);
  assert.equal(f.work.files, f.rows);
});

test('directory deadline includes response body decoding and ignores late body completion', async t => {
  const f = await fixture(t);
  let body!: ReadableStreamDefaultController<Uint8Array>;
  f.respond(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { body = controller; } }), { status: 207 }));
  const pending = f.adapter.loadDirectory('one');
  const failed = assert.rejects(pending, (error: any) => error.code === 'READ_TIMEOUT');
  await flush();
  t.mock.timers.tick(10000);
  await failed;
  assert.equal(f.state.loading, false);
  assert.equal(f.work.files, f.rows);
  body.enqueue(new TextEncoder().encode(emptyListing));
  body.close();
  await flush();
  assert.equal(f.parsed(), 0);
  assert.equal(f.state.checkedAt, 'original-confirmed');
});

test('late earlier directory read cannot settle a newer same-path loading state', async t => {
  const f = await fixture(t);
  const first = deferred<Response>(), second = deferred<Response>();
  let count = 0;
  f.respond(() => ++count === 1 ? first.promise : second.promise);
  const old = f.adapter.loadDirectory('one');
  const discarded = assert.rejects(old, (error: any) => error.code === 'CONNECTION_CHANGED');
  const latest = f.adapter.loadDirectory('one');
  first.resolve(new Response(emptyListing, { status: 207 }));
  await discarded;
  assert.equal(f.state.loading, true);
  assert.equal(f.state.error, '');
  assert.equal(f.work.files, f.rows);
  second.resolve(new Response(emptyListing, { status: 207 }));
  await latest;
  assert.equal(f.state.loading, false);
  assert.equal(f.state.error, '');
  assert.deepEqual(f.work.files, []);
  assert.equal(f.parsed(), 1);
});

test('late directory response after identity change cannot change old facts or new identity state', async t => {
  const f = await fixture(t);
  const headers = deferred<Response>();
  f.respond(() => headers.promise);
  const pending = f.adapter.loadDirectory('one');
  const discarded = assert.rejects(pending, (error: any) => error.code === 'CONNECTION_CHANGED');
  f.adapter.clearIdentity();
  headers.resolve(new Response(emptyListing, { status: 207 }));
  await discarded;
  assert.equal(f.parsed(), 0);
  assert.equal(f.work.files, f.rows);
  assert.equal(f.state.checkedAt, 'original-confirmed');
  assert.equal(f.state.error, '');
  assert.equal(f.adapter.directories.size, 0);
});
