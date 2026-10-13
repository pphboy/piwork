import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

// Socket-free tests of the real adapter. The reply shapes below come from
// internal/coreapp/snapshot_http.go and internal/cli/user_desktop_transfers.go.
// No browser, product-method replacement, fixture import, or wall-clock sleep.
const moduleURL = new URL('../browser/adapter.js', import.meta.url).href;
const { DesktopAdapter } = await import(moduleURL);
const now = Date.parse('2026-10-13T00:00:00Z');
const future = '2026-10-14T00:00:00Z';
const past = '2026-10-12T00:00:00Z';
const digest = 'a'.repeat(64);
const snapshotID = 'snapshot-original';
const workID = 'work-original';
const operationID = 'operation-original';
type Data = Record<string, any>;
type RequestRecord = { path: string; method: string; headers: Headers; body: string };
type Reply = { status?: number; json?: unknown };
type Handler = (request: RequestRecord) => Reply | Promise<Reply>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function metadata(overrides: Data = {}): Data {
  return { snapshotId: snapshotID, workId: workID, operationId: operationID,
    state: 'succeeded', size: 4096, digest, expiresAt: future, error: null, ...overrides };
}
function ready(transferId: string, overrides: Data = {}): Data {
  return { transferId, snapshotId: snapshotID, workId: workID, size: 4096, digest, ready: true, ...overrides };
}
function progress(transferId: string, overrides: Data = {}): Data {
  return { transferId, kind: 'download', phase: 'downloading', transferred: 12, total: 4096, ...overrides };
}
function session(generation = 1) {
  return { state: 'authenticated', generation, csrf: `synthetic-csrf-${generation}`,
    coreUrl: `https://core-${generation}.example.invalid`, user: { account: `owner-${generation}`, role: 'user' } };
}
async function fixture(t: TestContext, handler: Handler, withSnapshot = false) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now });
  let respond = handler;
  let generation = 1;
  const requests: RequestRecord[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, 'https://desktop.example.invalid');
    const request = { path: url.pathname.replace('/_desktop/api/', ''), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: String(init?.body ?? '') };
    requests.push(request);
    const reply = request.path === 'session' ? { json: session(generation) }
      : withSnapshot && request.method === 'GET' && request.path === `work-snapshots/${snapshotID}` ? { json: metadata() }
      : await respond(request);
    return new Response(JSON.stringify(reply.json ?? {}), { status: reply.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  });
  const adapter = new DesktopAdapter();
  await adapter.checkBrowserAccess();
  if (withSnapshot) await adapter.fetchSnapshot(snapshotID);
  t.after(() => adapter.stopDownloadObservers());
  return { adapter, requests, respond: (next: Handler) => { respond = next; },
    changeIdentity: async () => { generation++; await adapter.checkBrowserAccess(); },
    posts: () => requests.filter(request => request.method === 'POST'),
  };
}
function rejectUnexpected(request: RequestRecord): never { throw new Error(`Unexpected request: ${request.method} ${request.path}`); }
async function preparation(f: Awaited<ReturnType<typeof fixture>>, reply: (request: RequestRecord) => Reply | Promise<Reply>) {
  f.respond(request => request.path === `work-snapshots/${snapshotID}/downloads` && request.method === 'POST' ? reply(request) : rejectUnexpected(request));
  return f.adapter.downloadSnapshot(snapshotID);
}

test('export adapter: exact snapshot lookup rejects a different snapshot ID without caching it', async t => {
  const f = await fixture(t, () => ({ json: metadata({ snapshotId: 'snapshot-other' }) }));
  await assert.rejects(f.adapter.fetchSnapshot(snapshotID));
  assert.equal(f.adapter.state.snapshots.length, 0);
  assert.equal(f.posts().length, 0);
});

for (const field of ['workId', 'operationId']) test(`export adapter: later metadata cannot replace the original ${field}`, async t => {
  const f = await fixture(t, () => ({ json: metadata() }));
  const original = await f.adapter.fetchSnapshot(snapshotID);
  const before = structuredClone(original);
  f.respond(() => ({ json: metadata({ [field]: 'foreign-id', size: 99 }) }));
  await assert.rejects(f.adapter.fetchSnapshot(snapshotID));
  assert.deepEqual(f.adapter.getSnapshot(snapshotID), before);
  assert.equal(f.adapter.state.snapshots.length, 1);
});

test('export adapter: a real zero-byte size and immutable expiry/digest are retained', async t => {
  const f = await fixture(t, () => ({ json: metadata({ size: 0 }) }));
  const snapshot = await f.adapter.fetchSnapshot(snapshotID);
  assert.equal(snapshot.packageSize, 0);
  assert.equal(snapshot.size, '0 bytes');
  assert.equal(snapshot.expiresAt, future);
  assert.equal(snapshot.digest, digest);
  assert.equal(snapshot.status, 'verified');
});

test('export adapter: later missing metadata preserves previously confirmed package facts', async t => {
  const f = await fixture(t, () => ({ json: metadata() }));
  await f.adapter.fetchSnapshot(snapshotID);
  f.respond(() => ({ json: metadata({ size: null, digest: null, expiresAt: null }) }));
  const snapshot = await f.adapter.fetchSnapshot(snapshotID);
  assert.equal(snapshot.packageSize, 4096);
  assert.equal(snapshot.size, '4096 bytes');
  assert.equal(snapshot.expiresAt, future);
  assert.equal(snapshot.digest, digest);
});

test('export adapter: an expired original snapshot cannot revive through succeeded all-null metadata', async t => {
  const f = await fixture(t, () => ({ json: metadata({ expiresAt: past }) }));
  assert.equal((await f.adapter.fetchSnapshot(snapshotID)).status, 'expired');
  f.respond(() => ({ json: metadata({ size: null, digest: null, expiresAt: null }) }));
  const snapshot = await f.adapter.fetchSnapshot(snapshotID);
  assert.equal(snapshot.status, 'expired');
  assert.equal(snapshot.expiresAt, past);
  assert.equal(snapshot.packageSize, 4096);
  assert.equal(snapshot.digest, digest);
});

test('export adapter: retained expiry becomes terminal when later package metadata is missing', async t => {
  const f = await fixture(t, () => ({ json: metadata() }));
  assert.equal((await f.adapter.fetchSnapshot(snapshotID)).status, 'verified');
  t.mock.timers.setTime(Date.parse(future) + 1);
  f.respond(() => ({ json: metadata({ size: null, digest: null, expiresAt: null }) }));
  const snapshot = await f.adapter.fetchSnapshot(snapshotID);
  assert.equal(snapshot.status, 'expired');
  assert.equal(snapshot.expiresAt, future);
  assert.equal(snapshot.packageSize, 4096);
  assert.equal(snapshot.digest, digest);
});

test('export adapter: first succeeded all-null package is unavailable, without guessing an expiry', async t => {
  const f = await fixture(t, () => ({ json: metadata({ size: null, digest: null, expiresAt: null }) }));
  const snapshot = await f.adapter.fetchSnapshot(snapshotID);
  assert.equal(snapshot.status, 'unavailable');
  assert.equal(snapshot.packageSize ?? null, null);
  assert.equal(snapshot.expiresAt ?? null, null);
  assert.equal(snapshot.digest ?? null, null);
  assert.equal(snapshot.size, '');
  assert.match(snapshot.error, /unavailable|not available|could not|unconfirmed/i);
  assert.doesNotMatch(snapshot.error, /expired/i);
  assert.equal(f.posts().length, 0);
});

for (const state of ['pending', 'running']) test(`export adapter: ${state} metadata legitimately has no completed package`, async t => {
  const f = await fixture(t, () => ({ json: metadata({ state, size: null, digest: null, expiresAt: null }) }));
  const snapshot = await f.adapter.fetchSnapshot(snapshotID);
  assert.equal(snapshot.status, 'preparing');
  assert.equal(snapshot.size, '');
  assert.equal(snapshot.packageSize ?? null, null);
  assert.equal(snapshot.error ?? '', '');
});

test('export adapter: an actual failed snapshot retains the public failure reason', async t => {
  const f = await fixture(t, () => ({ json: metadata({ state: 'failed', size: null, digest: null, expiresAt: null,
    error: { code: 'SNAPSHOT_FAILED', message: 'Synthetic export validation failed' } }) }));
  const snapshot = await f.adapter.fetchSnapshot(snapshotID);
  assert.equal(snapshot.status, 'failed');
  assert.match(snapshot.error, /Synthetic export validation failed/);
});

test('export adapter: same snapshot preparation shares one POST and ready reuse keeps the original transfer', async t => {
  const post = deferred<Reply>();
  const f = await fixture(t, request => request.method === 'POST' ? post.promise : rejectUnexpected(request), true);
  const first = f.adapter.downloadSnapshot(snapshotID);
  const second = f.adapter.downloadSnapshot(snapshotID);
  assert.equal(f.posts().length, 1);
  const transferId = f.posts()[0]!.headers.get('X-Piwork-Transfer-Id')!;
  assert.ok(transferId);
  post.resolve({ json: ready(transferId) });
  const url = `/_desktop/api/downloads/${encodeURIComponent(transferId)}/content`;
  assert.deepEqual(await Promise.all([first, second]), [url, url]);
  assert.equal(await f.adapter.downloadSnapshot(snapshotID), url);
  assert.equal(f.posts().length, 1);
  assert.equal(f.requests.filter(request => request.path.endsWith('/content')).length, 0);
});

// Native claim rejects TRANSFER_BUSY before adding a job. Structured
// CORE_UNAVAILABLE / SNAPSHOT_DOWNLOAD_FAILED replies leave via finish(false),
// which removes this preparation. A missing/lost reply proves none of that.
for (const [code, status] of [
  ['TRANSFER_STORAGE_FULL', 507], ['PACKAGE_CHANGED', 409],
  ['TRANSFER_BUSY', 429], ['TRANSFER_UNAVAILABLE', 503], ['CORE_UNAVAILABLE', 503], ['SNAPSHOT_DOWNLOAD_FAILED', 503],
] as const) {
  test(`export adapter: known ${code} POST failure survives later missing transfer readback`, async t => {
    const f = await fixture(t, rejectUnexpected, true);
    await assert.rejects(preparation(f, () => ({ status, json: { code, message: `Synthetic ${code}` } })), { code });
    const original = f.adapter.downloads.get(snapshotID);
    assert.equal(original.terminalFailure, true);
    assert.equal(Boolean(original.ready), false);
    assert.match(original.error, new RegExp(code));
    const transferId = original.transferId;
    f.respond(() => ({ status: 404, json: { code: 'TRANSFER_NOT_FOUND', message: 'Transfer no longer exists' } }));
    await f.adapter.checkDownload(snapshotID).catch(() => undefined);
    assert.equal(f.adapter.downloads.get(snapshotID), original);
    assert.equal(original.terminalFailure, true);
    assert.equal(original.transferId, transferId);
    assert.match(original.error, new RegExp(code));
    await assert.rejects(f.adapter.downloadSnapshot(snapshotID));
    assert.equal(f.posts().length, 1);
    f.respond(request => request.method === 'POST' && request.path === `work-snapshots/${snapshotID}/downloads`
      ? { json: ready(request.headers.get('X-Piwork-Transfer-Id')!) } : rejectUnexpected(request));
    assert.equal(typeof f.adapter.retryDownloadSnapshot, 'function');
    const url = await f.adapter.retryDownloadSnapshot(snapshotID);
    const retry = f.adapter.downloads.get(snapshotID);
    assert.notEqual(retry.transferId, transferId);
    assert.equal(retry.snapshotId, snapshotID);
    assert.equal(url, `/_desktop/api/downloads/${retry.transferId}/content`);
    assert.equal(f.posts().length, 2);
  });
}

test('export adapter: a lost preparation reply plus unknown 404 never authorizes another POST', async t => {
  const f = await fixture(t, rejectUnexpected, true);
  await assert.rejects(preparation(f, () => { throw new TypeError('Synthetic response lost'); }), { code: 'RESULT_UNKNOWN' });
  const original = f.adapter.downloads.get(snapshotID);
  assert.notEqual(original.terminalFailure, true);
  f.respond(() => ({ status: 404, json: { code: 'TRANSFER_NOT_FOUND' } }));
  await f.adapter.checkDownload(snapshotID).catch(() => undefined);
  await f.adapter.checkDownload(snapshotID).catch(() => undefined);
  assert.equal(f.adapter.downloads.get(snapshotID), original);
  assert.notEqual(original.terminalFailure, true);
  await assert.rejects(f.adapter.downloadSnapshot(snapshotID));
  assert.equal(typeof f.adapter.retryDownloadSnapshot, 'function');
  await assert.rejects(async () => f.adapter.retryDownloadSnapshot(snapshotID));
  assert.equal(f.posts().length, 1);
});

for (const [code, status] of [
  ['NOT_FOUND', 404], ['HTTP_503', 503], ['TRANSFER_EXISTS', 409],
  ['TRANSFER_BUSY', 503], ['CORE_UNAVAILABLE', 500],
] as const) {
  test(`export adapter: inconclusive preparation ${code}/${status} cannot be treated as a retryable terminal failure`, async t => {
    const f = await fixture(t, rejectUnexpected, true);
    await assert.rejects(preparation(f, () => ({ status, json: { ...(code === 'HTTP_503' ? {} : { code }), message: `Synthetic ${code}` } })), { code });
    const original = f.adapter.downloads.get(snapshotID);
    assert.notEqual(original.terminalFailure, true);
    assert.equal(Boolean(original.ready), false);
    await assert.rejects(f.adapter.downloadSnapshot(snapshotID));
    assert.equal(typeof f.adapter.retryDownloadSnapshot, 'function');
    await assert.rejects(async () => f.adapter.retryDownloadSnapshot(snapshotID));
    assert.equal(f.adapter.downloads.get(snapshotID), original);
    assert.equal(f.posts().length, 1);
  });
}

test('export adapter: only explicit retry after a known failure prepares the same snapshot with a new transfer', async t => {
  const f = await fixture(t, rejectUnexpected, true);
  await assert.rejects(preparation(f, () => ({ status: 507, json: { code: 'TRANSFER_STORAGE_FULL', message: 'Local storage is full' } })));
  const original = f.adapter.downloads.get(snapshotID);
  await assert.rejects(f.adapter.downloadSnapshot(snapshotID));
  assert.equal(f.posts().length, 1);
  const retry = deferred<Reply>();
  f.respond(request => request.method === 'POST' && request.path === `work-snapshots/${snapshotID}/downloads` ? retry.promise : rejectUnexpected(request));
  assert.equal(typeof f.adapter.retryDownloadSnapshot, 'function');
  const first = Promise.resolve(f.adapter.retryDownloadSnapshot(snapshotID));
  // A second explicit action may reject or reuse the pending retry; neither can
  // authorize an additional preparation while this same snapshot is in flight.
  const second = Promise.resolve().then(() => f.adapter.retryDownloadSnapshot(snapshotID));
  const settledSecond = second.then(value => ({ value }), error => ({ error }));
  const current = f.adapter.downloads.get(snapshotID);
  assert.notEqual(current, original);
  assert.notEqual(current.transferId, original.transferId);
  assert.equal(current.snapshotId, snapshotID);
  assert.equal(f.posts().length, 2);
  retry.resolve({ json: ready(current.transferId) });
  assert.equal(await first, `/_desktop/api/downloads/${current.transferId}/content`);
  await settledSecond;
  assert.equal(f.posts().length, 2);
});

for (const field of ['transferId', 'snapshotId', 'workId']) test(`export adapter: ready POST rejects a mismatched ${field}`, async t => {
  const f = await fixture(t, () => ({ json: metadata() }));
  await f.adapter.fetchSnapshot(snapshotID);
  await assert.rejects(preparation(f, request => ({ json: ready(request.headers.get('X-Piwork-Transfer-Id')!, { [field]: 'foreign-id' }) })));
  const job = f.adapter.downloads.get(snapshotID);
  assert.equal(Boolean(job.ready), false);
  assert.equal(job.snapshotId, snapshotID);
  assert.equal(f.posts().length, 1);
});

for (const field of ['transferId', 'snapshotId', 'workId']) test(`export adapter: ready GET rejects a mismatched ${field} without retargeting the job`, async t => {
  const f = await fixture(t, () => ({ json: metadata() }));
  await f.adapter.fetchSnapshot(snapshotID);
  await assert.rejects(preparation(f, () => { throw new TypeError('Synthetic lost response'); }));
  const job = f.adapter.downloads.get(snapshotID);
  const transferId = job.transferId;
  f.respond(() => ({ json: { ...ready(transferId, { [field]: 'foreign-id' }), kind: 'download', phase: 'ready', transferred: 4096, total: 4096 } }));
  await assert.rejects(f.adapter.checkDownload(snapshotID));
  assert.equal(f.adapter.downloads.get(snapshotID), job);
  assert.equal(job.transferId, transferId);
  assert.equal(job.snapshotId, snapshotID);
  assert.equal(Boolean(job.ready), false);
  assert.equal(f.posts().length, 1);
});

test('export adapter: in-progress GET does not need ready-only snapshot/work identity fields', async t => {
  const post = deferred<Reply>();
  const f = await fixture(t, request => request.method === 'POST' ? post.promise : rejectUnexpected(request), true);
  const preparing = f.adapter.downloadSnapshot(snapshotID);
  const job = f.adapter.downloads.get(snapshotID);
  f.respond(request => request.method === 'GET' ? { json: progress(job.transferId, { total: null }) } : rejectUnexpected(request));
  await f.adapter.checkDownload(snapshotID);
  assert.equal(job.snapshotId, snapshotID);
  assert.equal(job.phase, 'downloading');
  assert.equal(job.transferred, 12);
  assert.equal(job.total, null);
  assert.equal(Boolean(job.ready), false);
  post.resolve({ json: ready(job.transferId) });
  await preparing;
});

test('export adapter: ready POST wins over an older pending same-transfer GET', async t => {
  const post = deferred<Reply>(), get = deferred<Reply>(), getStarted = deferred<void>();
  const f = await fixture(t, request => {
    if (request.method === 'POST') return post.promise;
    getStarted.resolve(); return get.promise;
  }, true);
  const preparing = f.adapter.downloadSnapshot(snapshotID);
  const job = f.adapter.downloads.get(snapshotID);
  const checking = f.adapter.checkDownload(snapshotID);
  await getStarted.promise;
  post.resolve({ json: ready(job.transferId) });
  await preparing;
  assert.equal(job.ready, true);
  assert.equal(job.phase, 'ready');
  get.resolve({ json: progress(job.transferId) });
  await checking;
  assert.equal(job.ready, true);
  assert.equal(job.phase, 'ready');
  assert.equal(job.size, 4096);
  assert.equal(job.digest, digest);
  assert.equal(job.snapshotId, snapshotID);
  assert.equal(f.posts().length, 1);
});

test('export adapter: exact ready GET before a lost POST reply preserves confirmed transfer facts', async t => {
  const post = deferred<Reply>();
  const f = await fixture(t, request => request.method === 'POST' ? post.promise : rejectUnexpected(request), true);
  const preparing = f.adapter.downloadSnapshot(snapshotID);
  const rejected = assert.rejects(preparing, { code: 'RESULT_UNKNOWN' });
  const job = f.adapter.downloads.get(snapshotID);
  f.respond(() => ({ json: { ...ready(job.transferId), kind: 'download', phase: 'ready', transferred: 4096, total: 4096 } }));
  await f.adapter.checkDownload(snapshotID);
  assert.equal(job.ready, true);
  post.reject(new TypeError('Synthetic response lost after ready GET'));
  await rejected;
  assert.equal(job.ready, true);
  assert.equal(job.phase, 'ready');
  assert.equal(job.error, '');
  assert.notEqual(job.terminalFailure, true);
  assert.equal(await f.adapter.downloadSnapshot(snapshotID), `/_desktop/api/downloads/${job.transferId}/content`);
  assert.equal(f.posts().length, 1);
});

test('export adapter: a lost POST can be recovered by exact ready GET with no repeat preparation', async t => {
  const f = await fixture(t, rejectUnexpected, true);
  await assert.rejects(preparation(f, () => { throw new TypeError('Synthetic response lost'); }));
  const job = f.adapter.downloads.get(snapshotID);
  f.respond(() => ({ json: { ...ready(job.transferId), phase: 'ready', kind: 'download', transferred: 4096, total: 4096 } }));
  await f.adapter.checkDownload(snapshotID);
  assert.equal(job.ready, true);
  assert.equal(job.error, '');
  assert.notEqual(job.terminalFailure, true);
  assert.equal(await f.adapter.downloadSnapshot(snapshotID), `/_desktop/api/downloads/${job.transferId}/content`);
  assert.equal(f.posts().length, 1);
});

test('export adapter: a late snapshot response cannot enter a fresh identity', async t => {
  const old = deferred<Reply>(), started = deferred<void>();
  const f = await fixture(t, () => { started.resolve(); return old.promise; });
  const pending = f.adapter.fetchSnapshot(snapshotID);
  const rejected = assert.rejects(pending);
  await started.promise;
  await f.changeIdentity();
  f.respond(() => ({ json: metadata({ workId: 'fresh-work', operationId: 'fresh-operation', size: 88 }) }));
  const fresh = await f.adapter.fetchSnapshot(snapshotID);
  const before = structuredClone(fresh);
  old.resolve({ json: metadata() });
  await rejected;
  assert.deepEqual(f.adapter.getSnapshot(snapshotID), before);
  assert.equal(f.adapter.state.snapshots.length, 1);
});

test('export adapter: late POST and GET cannot overwrite a fresh identity same-snapshot transfer', async t => {
  const oldPost = deferred<Reply>(), oldGet = deferred<Reply>(), getStarted = deferred<void>();
  const f = await fixture(t, request => {
    if (request.method === 'POST') return oldPost.promise;
    getStarted.resolve(); return oldGet.promise;
  }, true);
  const preparing = f.adapter.downloadSnapshot(snapshotID);
  const oldJob = f.adapter.downloads.get(snapshotID);
  const checking = f.adapter.checkDownload(snapshotID);
  const rejectedPost = assert.rejects(preparing, { code: 'CONNECTION_CHANGED' });
  const rejectedGet = assert.rejects(checking);
  await getStarted.promise;
  await f.changeIdentity();
  await f.adapter.fetchSnapshot(snapshotID);
  f.respond(request => ({ json: ready(request.headers.get('X-Piwork-Transfer-Id')!) }));
  await f.adapter.downloadSnapshot(snapshotID);
  const freshJob = f.adapter.downloads.get(snapshotID);
  const before = structuredClone(freshJob);
  assert.notEqual(freshJob.transferId, oldJob.transferId);
  oldPost.resolve({ json: ready(oldJob.transferId) });
  oldGet.resolve({ json: progress(oldJob.transferId) });
  await Promise.all([rejectedPost, rejectedGet]);
  assert.equal(f.adapter.downloads.get(snapshotID), freshJob);
  assert.deepEqual(freshJob, before);
  assert.equal(f.posts().length, 2);
});


test('export adapter: later metadata cannot extend the original confirmed expiry', async t => {
  const f = await fixture(t, () => ({ json: metadata() }));
  const snapshot = await f.adapter.fetchSnapshot(snapshotID);
  f.respond(() => ({ json: metadata({ expiresAt: '2199-01-01T00:00:00Z' }) }));
  await f.adapter.fetchSnapshot(snapshotID);
  assert.equal(snapshot.expiresAt, future);
});

test('export adapter: fresh exact valid facts can recheck unavailable without reviving expired state', async t => {
  const f = await fixture(t, () => ({ json: metadata({ size: null, digest: null, expiresAt: null }) }));
  const snapshot = await f.adapter.fetchSnapshot(snapshotID);
  assert.equal(snapshot.status, 'unavailable');
  f.respond(() => ({ json: metadata() }));
  await f.adapter.fetchSnapshot(snapshotID);
  assert.equal(snapshot.status, 'verified');
  assert.equal(snapshot.error, undefined);
  assert.equal(f.posts().length, 0);
});

test('export adapter: native ready POST projects its verified full size instead of stale zero progress', async t => {
  const f = await fixture(t, rejectUnexpected, true);
  await preparation(f, request => ({ json: ready(request.headers.get('X-Piwork-Transfer-Id')!) }));
  const job = f.adapter.downloads.get(snapshotID)!;
  assert.equal(job.ready, true); assert.equal(job.phase, 'ready');
  assert.equal(job.size, 4096); assert.equal(job.transferred, 4096); assert.equal(job.total, 4096);
  assert.equal(f.posts().length, 1);
});
