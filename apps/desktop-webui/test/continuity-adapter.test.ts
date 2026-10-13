import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
const { DesktopAdapter } = await import(new URL('../browser/adapter.js', import.meta.url).href);
type Data = Record<string, any>;
type Reply = { status?: number; json?: Data };
const work = (id = 'one', observedState = 'ready', desiredState = 'running', controlVersion = 1) => ({ id, name: id, observedState, desiredState, controlVersion });
const service = (serviceId = 'notes', observedState = 'ready', ports = [3000]) => ({ serviceId, name: serviceId, enabled: true, observedState, access: { hostname: `${serviceId}.test`, ports: ports.map(port => ({ port, url: `http://example.test:${port}` })) } });
const entry = (workId = 'one', serviceId = 'notes', port = 3000) => ({ entryId: `${workId}-${serviceId}-${port}`, workId, serviceId, port, origin: 'http://entry.test', entryUrl: 'http://entry.test/enter', embed: 'allowed' });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-13T00:00:00Z') });
  const requests: Data[] = [];
  let handler = async (r: Data): Promise<Reply> => {
    if (r.path === 'works') return { json: { works: [work()] } };
    if (r.path === 'works/one') return { json: work() };
    if (r.path.endsWith('/services')) return { json: { services: [service()] } };
    if (r.path === 'service-entries') return { json: entry(r.body.workId, r.body.serviceId, r.body.port) };
    if (r.path.startsWith('service-entries/')) return { json: { embed: 'allowed' } };
    if (r.path === 'session') return { json: { state: 'authenticated', generation: 1, csrf: 'synthetic', coreUrl: 'https://core.test', user: { account: 'owner', role: 'user' } } };
    throw new Error(`Unexpected ${r.method} ${r.path}`);
  };
  t.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const r = { path: String(input).replace('/_desktop/api/', ''), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined }; requests.push(r);
    const reply = await handler(r); return new Response(JSON.stringify(reply.json ?? {}), { status: reply.status ?? 200 });
  });
  const adapter = new DesktopAdapter(); adapter.state.signedIn = true;
  await adapter.listWorks(); await adapter.loadServices('one');
  t.after(() => adapter.clearIdentity());
  return { adapter, requests, respond: (next: (r: Data) => Reply | Promise<Reply>) => { handler = async r => next(r); } };
}

test('continuity: transient Work failure retains last confirmed workspace but closes new-action admission', async t => {
  const f = await fixture(t); const before = f.adapter.getWork('one').checkedAt;
  f.respond(() => ({ status: 503, json: { message: 'temporary outage' } }));
  await assert.rejects(f.adapter.refreshWorkStatus('one'));
  assert.equal(f.adapter.project(f.adapter.getWork('one')).retainWorkspace, true);
  assert.equal(f.adapter.project(f.adapter.getWork('one')).usable, false);
  assert.equal(f.adapter.getWork('one').checkedAt, before);
});

test('continuity: Work 403 revokes display and a Ready list cannot clear the denial', async t => {
  const f = await fixture(t);
  f.respond(r => r.path === 'works' ? { json: { works: [work()] } } : { status: 403, json: { message: 'Work denied' } });
  await assert.rejects(f.adapter.refreshWorkStatus('one')); await f.adapter.listWorks();
  assert.equal(f.adapter.project(f.adapter.getWork('one')).retainWorkspace, false);
  assert.equal(f.adapter.project(f.adapter.getWork('one')).usable, false);
  f.respond(() => ({ json: work() })); await f.adapter.refreshWorkStatus('one');
  assert.equal(f.adapter.project(f.adapter.getWork('one')).retainWorkspace, true);
});

test('continuity: Stop acceptance and confirmed stopped revoke retained entry immediately', async t => {
  const f = await fixture(t); await f.adapter.ensureServiceEntry('one', 'notes', 3000);
  f.respond(() => ({ json: { operationId: 'original-stop', workId: 'one' } }));
  await f.adapter.lifecycle('one', 'stop');
  assert.equal(f.adapter.project(f.adapter.getWork('one')).retainWorkspace, false);
  assert.equal(f.adapter.serviceEntryUrl('one', 'notes', 3000), null);
});

test('continuity: entry requests expose pending and dedupe exact Work Service and port', async t => {
  const f = await fixture(t), pending = deferred<Reply>();
  f.respond(r => r.method === 'POST' ? pending.promise : { json: { embed: 'allowed' } });
  const first = f.adapter.ensureServiceEntry('one', 'notes', 3000), duplicate = f.adapter.ensureServiceEntry('one', 'notes', 3000);
  const wasPending = f.adapter.serviceEntryPending?.('one', 'notes', 3000);
  pending.resolve({ json: entry() }); await Promise.all([first, duplicate]);
  assert.equal(wasPending, true);
  assert.equal(f.requests.filter(r => r.path === 'service-entries').length, 1);
  assert.equal(f.adapter.serviceEntryPending('one', 'notes', 3000), false);
});

test('continuity: failed automatic entry preparation waits for an explicit retry', async t => {
  const f = await fixture(t); f.respond(() => ({ status: 503, json: { message: 'entry unavailable' } }));
  await assert.rejects(f.adapter.ensureServiceEntry('one', 'notes', 3000));
  await f.adapter.ensureServiceEntry('one', 'notes', 3000).catch(() => undefined);
  assert.equal(f.requests.filter(r => r.path === 'service-entries').length, 1);
  f.respond(r => ({ json: r.method === 'POST' ? entry() : { embed: 'allowed' } }));
  await f.adapter.ensureServiceEntry('one', 'notes', 3000, true);
  assert.ok(f.adapter.serviceEntryUrl('one', 'notes', 3000));
});

test('continuity: late Ready Services read and even a newer Ready read cannot clear entry403', async t => {
  const f = await fixture(t), late = deferred<Reply>(); await f.adapter.ensureServiceEntry('one', 'notes', 3000); await f.adapter.serviceFrameLoaded('one', 'notes', 3000);
  f.respond(r => r.path.endsWith('/services') ? late.promise : { status: 403, json: { message: 'entry permission revoked' } });
  const list = f.adapter.loadServices('one');
  await assert.rejects(f.adapter.serviceFrameLoaded('one', 'notes', 3000));
  late.resolve({ json: { services: [service()] } }); await list;
  f.respond(() => ({ json: { services: [service()] } })); await f.adapter.loadServices('one');
  assert.equal(f.adapter.serviceEntryUrl('one', 'notes', 3000), null);
  assert.match(f.adapter.serviceEntryError('one', 'notes', 3000), /permission revoked/);
  f.respond(r => ({ json: r.method === 'POST' ? entry() : { embed: 'allowed' } }));
  await f.adapter.ensureServiceEntry('one', 'notes', 3000, true);
  assert.ok(f.adapter.serviceEntryUrl('one', 'notes', 3000));
  assert.equal(f.adapter.serviceEntryError('one', 'notes', 3000), '');
});

test('continuity: entry success started before a newer service denial cannot reopen the entry', async t => {
  const f = await fixture(t), pending = deferred<Reply>();
  f.respond(r => r.method === 'POST' ? pending.promise : { status: 403, json: { message: 'Service access revoked' } });
  const preparation = f.adapter.ensureServiceEntry('one', 'notes', 3000);
  await assert.rejects(f.adapter.loadServices('one'));
  pending.resolve({ json: entry() }); await preparation.catch(() => undefined);
  assert.equal(f.adapter.serviceEntryUrl('one', 'notes', 3000), null);
  assert.match(f.adapter.serviceEntryError('one', 'notes', 3000), /revoked/);
});

test('continuity: a mismatched entry response never becomes the selected entry', async t => {
  const f = await fixture(t); f.respond(() => ({ json: entry('other') }));
  await assert.rejects(f.adapter.ensureServiceEntry('one', 'notes', 3000));
  assert.equal(f.adapter.serviceEntryUrl('one', 'notes', 3000), null);
});

test('continuity: Ready entry returned after Stop acceptance is discarded', async t => {
  const f = await fixture(t), pending = deferred<Reply>();
  f.respond(r => r.path === 'service-entries' ? pending.promise : { json: { operationId: 'stop-one', workId: 'one' } });
  const preparation = f.adapter.ensureServiceEntry('one', 'notes', 3000);
  await f.adapter.lifecycle('one', 'stop'); pending.resolve({ json: entry() }); await preparation.catch(() => undefined);
  assert.equal(f.adapter.serviceEntryUrl('one', 'notes', 3000), null);
});

test('continuity: pending Works refresh shares one published state and keeps rows on failure', async t => {
  const f = await fixture(t), pending = deferred<Reply>();
  f.respond(() => pending.promise);
  const first = f.adapter.listWorks(), duplicate = f.adapter.listWorks();
  const deduped = first === duplicate; assert.equal(f.adapter.worksLoading, true);
  pending.resolve({ status: 503, json: { message: 'list temporarily unavailable' } });
  await Promise.allSettled([first, duplicate]); assert.equal(deduped, true);
  assert.equal(f.adapter.state.works.length, 1); assert.match(f.adapter.worksError, /temporarily unavailable/);
  assert.equal(f.adapter.worksLoading, false); assert.ok(f.adapter.worksChecked);
});

test('continuity: older list failure cannot overwrite a newer post-mutation successful list', async t => {
  const f = await fixture(t), old = deferred<Reply>(); let calls = 0;
  f.respond(r => r.path === 'works' ? ++calls === 1 ? old.promise : { json: { works: [work('one', 'stopping', 'stopped', 2)] } } : { json: { operationId: 'stop-one', workId: 'one' } });
  const first = f.adapter.listWorks(); await f.adapter.lifecycle('one', 'stop'); await f.adapter.listWorks();
  old.resolve({ status: 503, json: { message: 'obsolete list failure' } }); await first.catch(() => undefined);
  assert.equal(f.adapter.worksError, ''); assert.equal(f.adapter.getWork('one').status, 'Stopping');
});

test('continuity: logs have independent Work Service state, preserve content on failure and retry only GET', async t => {
  const f = await fixture(t), slow = deferred<Reply>();
  f.respond(r => r.path.includes('works/one/') ? slow.promise : { json: { text: 'other Work logs' } });
  const one = f.adapter.readLogs('one', 'notes'); await f.adapter.readLogs('two', 'notes');
  const wasLoading = f.adapter.serviceLogs?.('one', 'notes')?.loading;
  slow.resolve({ json: { text: 'first Work logs' } }); await one;
  assert.equal(wasLoading, true);
  assert.equal(f.adapter.serviceLogs?.('two', 'notes')?.value?.text, 'other Work logs');
  f.respond(() => ({ status: 503, json: { message: 'log outage' } })); await assert.rejects(f.adapter.readLogs('one', 'notes'));
  assert.equal(f.adapter.serviceLogs('one', 'notes').value.text, 'first Work logs');
  assert.match(f.adapter.serviceLogs('one', 'notes').error, /log outage/);
  assert.equal(f.adapter.serviceLogs('two', 'notes').value.text, 'other Work logs');
  assert.equal(f.requests.filter(r => r.method !== 'GET').length, 0);
});

test('continuity: Work timeout retains the exact entry and confirmed snapshot without granting actions', async t => {
  const f = await fixture(t); await f.adapter.ensureServiceEntry('one', 'notes', 3000); await f.adapter.serviceFrameLoaded('one', 'notes', 3000);
  const before = f.adapter.serviceEntryUrl('one', 'notes', 3000); f.respond(() => new Promise(() => {}));
  const pending = f.adapter.refreshWorkStatus('one'), rejected = assert.rejects(pending, /timed out/);
  await Promise.resolve(); t.mock.timers.tick(10_000); await rejected;
  assert.equal(f.adapter.project(f.adapter.getWork('one')).retainWorkspace, true); assert.equal(f.adapter.project(f.adapter.getWork('one')).usable, false);
  assert.equal(f.adapter.serviceEntryUrl('one', 'notes', 3000), before);
});

test('continuity: Starting service waits for Ready before exactly one automatic entry preparation', async t => {
  const f = await fixture(t); f.respond(() => ({ json: { services: [service('notes', 'starting')] } })); await f.adapter.loadServices('one');
  await f.adapter.ensureServiceEntry('one', 'notes', 3000); assert.equal(f.requests.filter(r => r.path === 'service-entries').length, 0);
  f.respond(r => ({ json: r.path.endsWith('/services') ? { services: [service()] } : r.method === 'POST' ? entry() : { embed: 'allowed' } }));
  await f.adapter.loadServices('one'); await Promise.all([f.adapter.ensureServiceEntry('one', 'notes', 3000), f.adapter.ensureServiceEntry('one', 'notes', 3000)]);
  await f.adapter.ensureServiceEntry('one', 'notes', 3000); assert.equal(f.requests.filter(r => r.path === 'service-entries').length, 1);
});

test('continuity: explicit new-tab entry denial revokes cached entry and beats an older probe', async t => {
  const f = await fixture(t); await f.adapter.ensureServiceEntry('one', 'notes', 3000); await f.adapter.serviceFrameLoaded('one', 'notes', 3000);
  const late = deferred<Reply>(); f.respond(r => r.method === 'POST' ? { status: 403, json: { message: 'entry permission revoked' } } : late.promise);
  const probe = f.adapter.serviceFrameLoaded('one', 'notes', 3000);
  const direct = f.adapter.directServiceURL('one', 'notes', 3000);
  const rejected = assert.rejects(direct, /permission revoked/); late.resolve({ json: { embed: 'allowed' } }); await Promise.all([probe, rejected]);
  assert.equal(f.adapter.serviceEntryUrl('one', 'notes', 3000), null);
  assert.match(f.adapter.serviceEntryError('one', 'notes', 3000), /permission revoked/);
});

test('continuity: Services denial before any entry blocks automatic access after Ready metadata', async t => {
  const f = await fixture(t); f.respond(() => ({ status: 403, json: { message: 'Services permission revoked' } })); await assert.rejects(f.adapter.loadServices('one'));
  f.respond(r => ({ json: r.path.endsWith('/services') ? { services: [service()] } : r.method === 'POST' ? entry() : { embed: 'allowed' } }));
  await f.adapter.loadServices('one'); await f.adapter.ensureServiceEntry('one', 'notes', 3000);
  assert.equal(f.requests.filter(r => r.path === 'service-entries').length, 0);
  assert.match(f.adapter.serviceEntryError('one', 'notes', 3000), /permission revoked/);
  await f.adapter.ensureServiceEntry('one', 'notes', 3000, true); assert.ok(f.adapter.serviceEntryUrl('one', 'notes', 3000)); assert.equal(f.adapter.serviceEntryError('one', 'notes', 3000), '');
});

test('continuity: late entry and logs cannot publish after identity cleanup', async t => {
  const f = await fixture(t), lateEntry = deferred<Reply>(), lateLogs = deferred<Reply>();
  f.respond(r => r.method === 'POST' ? lateEntry.promise : lateLogs.promise);
  const preparation = f.adapter.ensureServiceEntry('one', 'notes', 3000), logs = f.adapter.readLogs('one', 'notes');
  const done = Promise.allSettled([preparation, logs]); f.adapter.clearIdentity();
  lateEntry.resolve({ json: entry() }); lateLogs.resolve({ json: { text: 'old private logs' } }); await done;
  assert.equal(f.adapter.serviceEntryUrl('one', 'notes', 3000), null); assert.equal(f.adapter.serviceLogs('one', 'notes'), undefined); assert.equal(f.adapter.logs.size, 0);
});

test('continuity: removed Work cannot reuse a cached entry if later visible again', async t => {
  const f = await fixture(t); await f.adapter.ensureServiceEntry('one', 'notes', 3000); await f.adapter.serviceFrameLoaded('one', 'notes', 3000);
  f.respond(() => ({ json: { works: [] } })); await f.adapter.listWorks();
  f.respond(r => ({ json: r.path === 'works' ? { works: [work()] } : { services: [service()] } }));
  await f.adapter.listWorks(); await f.adapter.loadServices('one');
  assert.equal(f.adapter.serviceEntryUrl('one', 'notes', 3000), null);
});

test('continuity: old Services response after accepted Stop cannot replace current service state', async t => {
  const f = await fixture(t), old = deferred<Reply>();
  f.respond(r => r.path.endsWith('/services') ? old.promise : { json: { operationId: 'stop-one', workId: 'one' } });
  const list = f.adapter.loadServices('one'); await f.adapter.lifecycle('one', 'stop');
  old.resolve({ json: { services: [service('foreign')] } }); await list;
  assert.equal(f.adapter.getWork('one').services[0].id, 'notes'); assert.equal(f.adapter.project(f.adapter.getWork('one')).usable, false);
});

for (const invalidation of ['stopped', 'removed', 'port-withdrawn', 'work-stopped']) test(`continuity: entry403 survives ${invalidation} metadata before Ready recovery`, async t => {
  const f = await fixture(t); f.respond(() => ({ status: 403, json: { message: 'entry permission revoked' } }));
  await assert.rejects(f.adapter.ensureServiceEntry('one', 'notes', 3000));
  f.respond(r => ({ json: r.path === 'works/one' ? work('one', 'stopped', 'stopped', 2) : { services: invalidation === 'removed' ? [] : [service('notes', invalidation === 'stopped' ? 'stopped' : 'ready', invalidation === 'port-withdrawn' ? [] : [3000])] } }));
  if (invalidation === 'work-stopped') await f.adapter.refreshWorkStatus('one'); else await f.adapter.loadServices('one');
  f.respond(r => ({ json: r.path === 'works/one' ? work('one', 'ready', 'running', 3) : r.path.endsWith('/services') ? { services: [service()] } : r.method === 'POST' ? entry() : { embed: 'allowed' } }));
  if (invalidation === 'work-stopped') await f.adapter.refreshWorkStatus('one'); await f.adapter.loadServices('one');
  await f.adapter.ensureServiceEntry('one', 'notes', 3000);
  assert.equal(f.requests.filter(r => r.path === 'service-entries').length, 1);
  assert.equal(f.adapter.serviceEntryUrl('one', 'notes', 3000), null); assert.match(f.adapter.serviceEntryError('one', 'notes', 3000), /permission revoked/);
  await f.adapter.ensureServiceEntry('one', 'notes', 3000, true);
  assert.equal(f.requests.filter(r => r.path === 'service-entries').length, 2); assert.ok(f.adapter.serviceEntryUrl('one', 'notes', 3000));
});

for (const status of [404, 410]) test(`continuity: trusted Work ${status} revokes only its workspace until a matching fresh Work read`, async t => {
  const f = await fixture(t);
  const healthy = (r: Data): Reply => ({ json: r.path === 'works' ? { works: [work(), work('two')] } : r.path.endsWith('/services') ? { services: [service()] } : r.method === 'POST' ? entry(r.body.workId, r.body.serviceId, r.body.port) : { embed: 'allowed' } });
  f.respond(healthy); await f.adapter.listWorks(); await f.adapter.loadServices('two');
  for (const id of ['one', 'two']) { await f.adapter.ensureServiceEntry(id, 'notes', 3000); await f.adapter.serviceFrameLoaded(id, 'notes', 3000); }
  const original = f.adapter.getWork('one'), confirmedAt = original.checkedAt, otherEntry = f.adapter.serviceEntryUrl('two', 'notes', 3000);
  f.respond(r => r.path === 'works/one' ? { status, json: { message: `Original Work unavailable (${status})` } } : healthy(r));
  await assert.rejects(f.adapter.refreshWorkStatus('one'));
  assert.equal(f.adapter.project(original).retainWorkspace, false); assert.equal(f.adapter.project(original).usable, false);
  assert.equal(f.adapter.getWork('one'), original, 'unavailability alone must not claim remote deletion');
  assert.equal(original.status, 'Ready'); assert.equal(original.checkedAt, confirmedAt); assert.equal(original.desired, 'running');
  assert.match(original.statusError, /Original Work unavailable/); assert.equal(f.adapter.state.operations.length, 0);
  assert.equal(f.adapter.serviceEntryUrl('one', 'notes', 3000), null);
  assert.equal(f.adapter.serviceEntryUrl('two', 'notes', 3000), otherEntry); assert.equal(f.adapter.project(f.adapter.getWork('two')).usable, true);
  await f.adapter.listWorks(); assert.equal(f.adapter.project(original).retainWorkspace, false, 'Ready list metadata cannot restore access');
  f.respond(() => ({ json: work('two') })); await assert.rejects(f.adapter.refreshWorkStatus('one'), /original Work/);
  assert.equal(f.adapter.project(original).retainWorkspace, false, 'another Work response cannot recover this Work');
  f.respond(() => ({ json: work('one', 'ready', 'running', 2) })); await f.adapter.refreshWorkStatus('one');
  assert.equal(f.adapter.project(original).retainWorkspace, true); assert.equal(f.adapter.project(original).usable, true);
  assert.equal(f.adapter.serviceEntryUrl('one', 'notes', 3000), null, 'fresh Work recovery does not reuse the revoked entry');
  assert.equal(f.requests.filter(r => r.method === 'POST' && r.path === 'service-entries').length, 2);
});

test('continuity: observed deleted 200 removes only the exact Work and revokes its entry', async t => {
  const f = await fixture(t); await f.adapter.ensureServiceEntry('one', 'notes', 3000); await f.adapter.serviceFrameLoaded('one', 'notes', 3000);
  f.respond(() => ({ json: { works: [work(), work('two')] } })); await f.adapter.listWorks(); const other = f.adapter.getWork('two');
  f.respond(() => ({ json: work('one', 'deleted', 'deleted', 2) })); await f.adapter.refreshWorkStatus('one');
  assert.equal(f.adapter.getWork('one'), undefined); assert.equal(f.adapter.serviceEntryUrl('one', 'notes', 3000), null);
  assert.equal(f.adapter.getWork('two'), other); assert.equal(f.adapter.project(other).usable, true); assert.equal(f.adapter.state.operations.length, 0);
});
