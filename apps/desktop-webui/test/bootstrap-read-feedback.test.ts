import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
const { DesktopAdapter } = await import(new URL('../browser/adapter.js', import.meta.url).href);
const { BootstrapReadFeedback } = await import(new URL('../browser/bootstrap-read-feedback.js', import.meta.url).href);
const { WorkReadFeedback } = await import(new URL('../browser/work-read-feedback.js', import.meta.url).href);
const { NoticeStore } = await import(new URL('../browser/notices.js', import.meta.url).href);
const recovery = { label: () => 'Details', run() {} };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
type Reply = { status?: number; json?: Record<string, any> };
const ready = { health: { available: true }, readiness: { available: true, value: { ready: true } }, checkedAt: 'same-server-time' };
function fixture(t: TestContext, handler: (path: string) => Reply | Promise<Reply>) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  t.mock.method(globalThis, 'fetch', async (input: unknown) => {
    const path = String(input).replace('/_desktop/api/', '');
    const reply = path === 'session' ? { json: { state: 'authenticated', generation: 1, csrf: 'synthetic', coreUrl: 'https://core.test', user: { account: 'owner', role: 'user' } } } : await handler(path);
    return new Response(JSON.stringify(reply.json ?? {}), { status: reply.status ?? 200 });
  });
  const adapter = new DesktopAdapter();
  t.after(() => adapter.clearIdentity());
  return adapter;
}
function fallback(path: string): Reply {
  return { json: path === 'status' ? ready : path === 'works' ? { works: [] } : path === 'known-operations' ? { operations: [] } : {} };
}

test('original status read retains its issue through retry and needs a new successful response receipt', async t => {
  let fail = true;
  const pending = deferred<Reply>();
  const adapter = fixture(t, path => path === 'status' ? fail ? { status: 503, json: { message: 'Original status unavailable' } } : pending.promise : fallback(path));
  const display = new BootstrapReadFeedback(), store = new NoticeStore();
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { hash: '#/work/original', pathname: '/', search: '' } });
  t.after(() => {
    if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation);
    else delete (globalThis as any).location;
  });
  await assert.rejects(adapter.initialize(), error => adapter.readFailureResource(error) === 'status');
  const identity = String(adapter.identityEpoch);
  store.setIdentity(identity);
  const facts = () => ({ identity, source: 'status', reading: adapter.connectionCheck.checking, error: adapter.statusReadError, receipt: adapter.statusReadEvidence() });
  const failed = display.observe(facts(), recovery);
  store.publish(failed.event);
  assert.equal(store.items().length, 1);
  fail = false;
  const retry = adapter.checkConnection();
  assert.match(String(adapter.statusReadError), /Original status unavailable/);
  assert.equal(display.observe(facts(), recovery).recovered, false);
  pending.resolve({ json: ready });
  await retry;
  const confirmed = display.observe(facts(), recovery);
  assert.equal(confirmed.recovered, true);
  store.resolve(confirmed.owner);
  assert.equal(store.items().length, 0);
  assert.ok(adapter.statusReadEvidence());
  store.destroy();
});

test('downstream Works and original-record failures do not become a status failure', async t => {
  let failure = 'works';
  const adapter = fixture(t, path => path === failure ? { status: 503, json: { message: 'Same server text' } } : fallback(path));
  await assert.rejects(adapter.checkConnection(), error => adapter.readFailureResource(error) === 'works');
  const statusReceipt = adapter.statusReadEvidence();
  assert.ok(statusReceipt);
  assert.equal(adapter.statusReadError, '');
  failure = 'known-operations';
  await assert.rejects(adapter.checkConnection(), error => adapter.readFailureResource(error) === 'known-operations');
  assert.equal(adapter.statusReadError, '');
  assert.notEqual(adapter.statusReadEvidence(), statusReceipt);
  assert.match(String(adapter.operationRecords.error), /Same server text/);
});

test('malformed original-record response never partly inserts tasks or discards prior records', async t => {
  let malformed = false;
  const adapter = fixture(t, path => path === 'known-operations' ? { json: { operations: malformed ? [{ operationId: 'new-record' }, null] : [{ operationId: 'original-record', terminal: true }] } } : fallback(path));
  await adapter.recoverOperations();
  const receipt = adapter.operationRecords.receipt;
  malformed = true;
  await assert.rejects(adapter.recoverOperations(), error => adapter.readFailureResource(error) === 'known-operations');
  assert.deepEqual(adapter.state.operations.map((record: any) => record.id), ['original-record']);
  assert.equal(adapter.operationRecords.receipt, receipt);
  assert.equal(adapter.operationRecords.reading, false);
});

test('late original-record response cannot populate a new identity', async t => {
  const pending = deferred<Reply>();
  const adapter = fixture(t, () => pending.promise);
  const read = adapter.recoverOperations();
  adapter.clearIdentity();
  pending.resolve({ json: { operations: [{ operationId: 'old-record' }] } });
  await read.catch(() => {});
  assert.equal(adapter.state.operations.length, 0);
  assert.equal(adapter.operationRecords.receipt, undefined);
  assert.equal(adapter.operationRecords.error, '');
  assert.equal(adapter.operationRecords.reading, false);
});

test('status, original-record and canonical Works owners remain independent even with identical messages', () => {
  const bootstrap = new BootstrapReadFeedback(), works = new WorkReadFeedback();
  const status = bootstrap.observe({ identity: '1', source: 'status', reading: false, error: 'same' }, recovery);
  const records = bootstrap.observe({ identity: '1', source: 'known-operations', reading: false, error: 'same' }, recovery);
  const collection = works.observe({ identity: '1', source: 'works', reading: false, error: 'same' }, recovery);
  assert.notDeepEqual(status.owner, records.owner);
  assert.notDeepEqual(records.owner, collection.owner);
  assert.deepEqual(works.observe({ identity: '1', source: 'works', reading: false, error: 'same' }, recovery).owner, collection.owner);
  const recovered = bootstrap.observe({ identity: '1', source: 'status', reading: false, receipt: {} }, recovery);
  assert.equal(recovered.recovered, true);
  assert.ok(bootstrap.observe({ identity: '1', source: 'known-operations', reading: false }, recovery).event);
  assert.ok(works.observe({ identity: '1', source: 'works', reading: false }, recovery).event);
});

test('original-record read is bounded and a late response cannot erase the retained failure', async t => {
  const pending = deferred<Reply>();
  const adapter = fixture(t, () => pending.promise);
  const read = adapter.recoverOperations();
  const rejected = assert.rejects(read, error => adapter.readFailureResource(error) === 'known-operations');
  t.mock.timers.tick(10001);
  await rejected;
  assert.equal(adapter.operationRecords.reading, false);
  assert.match(String(adapter.operationRecords.error), /timed out/i);
  pending.resolve({ json: { operations: [{ operationId: 'late-record' }] } });
  await Promise.resolve();
  assert.equal(adapter.state.operations.length, 0);
  assert.equal(adapter.operationRecords.receipt, undefined);
});

test('overlapping original-record reads share the request and publish validated records only once', async t => {
  const pending = deferred<Reply>();
  let calls = 0;
  const adapter = fixture(t, () => {
    calls++;
    return pending.promise;
  });
  const oldRead = adapter.recoverOperations(), currentRead = adapter.recoverOperations();
  pending.resolve({ json: { operations: [{ operationId: 'original-record', terminal: true }] } });
  await Promise.all([oldRead, currentRead]);
  assert.equal(calls, 1);
  assert.equal(adapter.operationRecords.reading, false);
  assert.deepEqual(adapter.state.operations.map((record: any) => record.id), ['original-record']);
  assert.ok(adapter.operationRecords.receipt);
});
