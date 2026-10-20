import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
const { DesktopAdapter } = await import(new URL('../browser/adapter.js', import.meta.url).href);
type Reply = { status?: number; json?: Record<string, any> };
function gate() { let resolve!: (value: Reply) => void; const promise = new Promise<Reply>(done => { resolve = done; }); return { promise, resolve }; }
const session = (generation = 1): Reply => ({ json: { state: 'authenticated', generation, csrf: 'synthetic', coreUrl: 'https://core.test', user: { account: 'owner', role: 'user' } } });
function fixture(t: TestContext, handler: (path: string) => Reply | Promise<Reply>, readSession: () => Reply | Promise<Reply> = session) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-20T02:00:00Z') });
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: unknown) => {
    const path = String(input).replace('/_desktop/api/', ''); requests.push(path);
    const value = await (path === 'session' ? readSession() : handler(path));
    return new Response(JSON.stringify(value.json ?? {}), { status: value.status ?? 200 });
  });
  const adapter = new DesktopAdapter();
  t.after(() => adapter.clearIdentity());
  return { adapter, requests };
}
const ready = { json: { health: { available: true }, readiness: { available: true, value: { ready: true } } } };
const fallback = (path: string): Reply => ({ json: path === 'works' ? { works: [] } : path === 'known-operations' ? { operations: [] } : path === 'skills' ? { skills: [] } : { packages: [] } });
async function tickUntil(test: () => boolean) { for (let n = 0; n < 30 && !test(); n++) await Promise.resolve(); assert.ok(test()); }

test('pending Core: initial check is observable, deduplicates, explains slow waits and stops before unrelated reads', async t => {
  const status = gate(), works = gate();
  const { adapter, requests } = fixture(t, path => path === 'status' ? status.promise : path === 'works' ? works.promise : fallback(path));
  const first = adapter.checkConnection(), second = adapter.checkConnection();
  assert.equal(first, second); assert.equal(adapter.connectionCheck.checking, true); assert.equal(adapter.connectionCheck.checkedAt, '');
  await tickUntil(() => requests.includes('status')); assert.equal(requests.filter(path => path === 'status').length, 1);
  t.mock.timers.tick(10001); assert.equal(adapter.connectionCheck.waiting, true); assert.equal(adapter.connectionCheck.error, '');
  status.resolve(ready); await tickUntil(() => requests.includes('works'));
  assert.equal(adapter.connectionCheck.checking, false); assert.notEqual(adapter.connectionCheck.checkedAt, ''); assert.equal(adapter.worksLoading, true);
  works.resolve({ json: { works: [] } }); await first;
  assert.equal(adapter.connectionCheck.waiting, false);
  assert.equal(requests.filter(path => path === 'status').length, 1);
});

test('pending Core: actual error stops waiting without clearing last confirmed facts or adding probes', async t => {
  let fail = false;
  const { adapter, requests } = fixture(t, path => path === 'status' ? fail ? { status: 503, json: { message: 'Core check failed' } } : ready : fallback(path));
  await adapter.checkConnection(); const checked = adapter.connectionCheck.checkedAt, prior = adapter.status;
  fail = true; await assert.rejects(adapter.checkConnection(), /Core check failed/);
  assert.equal(adapter.connectionCheck.checking, false); assert.equal(adapter.connectionCheck.waiting, false);
  assert.equal(adapter.connectionCheck.error, 'Core check failed'); assert.equal(adapter.connectionCheck.checkedAt, checked); assert.equal(adapter.status, prior);
  t.mock.timers.tick(30000); await Promise.resolve();
  assert.equal(requests.filter(path => path === 'status').length, 2);
});

test('pending Core: a session generation update continues the same check against its accepted identity', async t => {
  let generation = 1; const status = gate();
  const { adapter, requests } = fixture(t, path => path === 'status' ? generation === 1 ? ready : status.promise : path === 'works' ? { json: { works: [{ id: `work-${generation}`, name: `Work ${generation}`, observedState: 'stopped', desiredState: 'stopped' }] } } : fallback(path), () => session(generation));
  await adapter.checkConnection(); assert.equal(adapter.state.works[0].id, 'work-1');
  const epoch = adapter.identityEpoch; generation = 2; requests.length = 0;
  const next = adapter.checkConnection(); await tickUntil(() => requests.includes('status'));
  assert.equal(adapter.identityEpoch, epoch + 1); assert.equal(adapter.connectionCheck.checking, true);
  assert.equal(adapter.connectionCheck.checkedAt, ''); assert.equal(adapter.state.works.length, 0);
  assert.equal(adapter.checkConnection(), next);
  t.mock.timers.tick(10001); assert.equal(adapter.connectionCheck.waiting, true);
  status.resolve(ready); await next;
  assert.equal(adapter.connectionCheck.checking, false); assert.notEqual(adapter.connectionCheck.checkedAt, '');
  assert.equal(adapter.state.works[0].id, 'work-2');
  assert.deepEqual(requests, ['session', 'status', 'works', 'skills', 'packages', 'known-operations']);
});

for (const changed of ['identity', 'authentication'] as const) test(`pending Core: an old session cannot continue after an external ${changed} change`, async t => {
  const old = gate(); let reads = 0;
  const { adapter, requests } = fixture(t, path => path === 'status' ? ready : fallback(path), () => ++reads === 1 ? old.promise : session(2));
  const first = adapter.checkConnection(), rejected = assert.rejects(first, /changed|discarded/i);
  await tickUntil(() => requests.includes('session'));
  if (changed === 'identity') adapter.clearIdentity();
  else adapter.authSequence++;
  await adapter.checkBrowserAccess();
  old.resolve(session(1)); await rejected;
  assert.equal(requests.filter(path => path === 'status').length, 0);
  assert.equal(adapter.generation, 2); assert.equal(adapter.connectionCheck.checking, false);
});

test('pending Core: an external identity change after session acceptance is not adopted by the old check', async t => {
  const { adapter, requests } = fixture(t, path => path === 'status' ? ready : fallback(path));
  const unsubscribe = adapter.subscribe(() => {
    if (adapter.state.browserAccess !== 'authorized') return;
    unsubscribe(); adapter.clearIdentity();
  });
  await adapter.checkConnection();
  assert.equal(requests.filter(path => path === 'status').length, 0);
  assert.equal(adapter.connectionCheck.checking, false); assert.equal(adapter.connectionCheck.checkedAt, '');
});

test('pending Core: a late old identity response cannot finish the new connection check', async t => {
  const old = gate(), newer = gate(); let statusReads = 0;
  const { adapter, requests } = fixture(t, path => path === 'status' ? (++statusReads === 1 ? old.promise : newer.promise) : fallback(path));
  const first = adapter.checkConnection(); const rejected = assert.rejects(first, /changed|discarded/i);
  await tickUntil(() => requests.includes('status')); adapter.clearIdentity();
  const second = adapter.checkConnection(); await tickUntil(() => statusReads === 2);
  old.resolve(ready); await rejected; assert.equal(adapter.connectionCheck.checking, true); assert.equal(adapter.connectionCheck.checkedAt, '');
  newer.resolve(ready); await second; assert.equal(adapter.connectionCheck.checking, false); assert.equal(adapter.connectionCheck.error, '');
});

test('pending default Core: readback animates an unconfirmed save without releasing its mutation lock', async t => {
  const read = gate(); const { adapter, requests } = fixture(t, path => path === 'preferences' ? read.promise : fallback(path));
  Object.assign(adapter.preferences, { phase: 'unconfirmed', coreUrl: 'https://last.test', confirmed: true });
  const first = adapter.loadPreferences(); assert.equal(adapter.preferences.reading, true); assert.equal(adapter.preferences.phase, 'unconfirmed');
  await adapter.loadPreferences(); await adapter.savePreferences('https://new.test'); assert.equal(requests.filter(path => path === 'preferences').length, 1);
  read.resolve({ status: 503, json: { code: 'PREFERENCES_UNAVAILABLE' } }); await first;
  assert.equal(adapter.preferences.reading, false); assert.equal(adapter.preferences.phase, 'unconfirmed'); assert.equal(adapter.preferences.coreUrl, 'https://last.test');
});

test('pending active Run: explicit retry emits in-flight state and background reads remain quiet', async t => {
  let held = gate(); const { adapter, requests } = fixture(t, path => path.endsWith('/runs/active') ? held.promise : fallback(path));
  adapter.cancelAndSendCapabilities.set('one', 1);
  adapter.activeRuns.set('one', { confirmed: true, loading: false, run: null, error: 'Previous read failed' });
  const notices: boolean[] = []; adapter.subscribe(() => notices.push(!!adapter.activeRuns.get('one')?.visibleLoading));
  const explicit = adapter.loadActiveRun('one', true); assert.equal(notices[0], true);
  held.resolve({ json: { run: null } }); await explicit;
  assert.equal(adapter.activeRuns.get('one').visibleLoading, false); assert.equal(adapter.activeRuns.get('one').error, '');
  held = gate(); const before = notices.length;
  const background = adapter.loadActiveRun('one'); assert.equal(adapter.activeRuns.get('one').visibleLoading, false); assert.equal(notices.length, before);
  held.resolve({ json: { run: null } }); await background; assert.ok(requests.filter(path => path.endsWith('/runs/active')).length <= 2);
});
