import assert from 'node:assert/strict';
import test from 'node:test';
const { AboutReadFeedback } = await import(new URL('../browser/about-read-feedback.js', import.meta.url).href);
const { DesktopAdapter } = await import(new URL('../browser/adapter.js', import.meta.url).href);
const recovery = { label: () => 'Details', run: () => {} };
const facts = { identity: 'one', side: 'local' as const, reading: false, confirmedVersion: {}, error: 'Read failed' };
const response = (version: string) => new Response(JSON.stringify({ build: { version } }));
function gate() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { resolve, promise };
}
test('About sides retain independent failure until their own fresh successful receipt', () => {
  const owner = new AboutReadFeedback();
  const local = owner.observe(facts, recovery);
  const core = owner.observe({ ...facts, side: 'core' }, recovery);
  assert.notEqual(local.owner.task, core.owner.task);
  assert.equal(owner.observe({ ...facts, reading: true, error: '' }, recovery).event.tone, 'error');
  assert.equal(owner.observe({ ...facts, error: '' }, recovery).recovered, false);
  assert.equal(owner.observe({ ...facts, error: '', confirmedVersion: {} }, recovery).recovered, true);
  assert.equal(owner.observe({ ...facts, side: 'core' }, recovery).event.tone, 'error');
  assert.equal(owner.observe({ ...facts, identity: 'two', error: '' }, recovery).event, undefined);
});
test('About overlapping refreshes share one actual GET and publish its confirmed receipt', async t => {
  const held = gate();
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    reads++;
    return held.promise;
  });
  const adapter = new DesktopAdapter();
  t.after(() => adapter.clearIdentity());
  const first = adapter.loadAbout(), second = adapter.loadAbout();
  held.resolve(response('fresh'));
  await Promise.all([first, second]);
  assert.equal(adapter.about.local.build.version, 'fresh');
  assert.equal(adapter.about.localLoading, false);
  assert.equal(reads, 1);
});
test('About GET deadline retains known version and releases only pending read', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const held = gate();
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async () => ++reads === 1 ? response('known') : held.promise);
  const adapter = new DesktopAdapter();
  t.after(() => adapter.clearIdentity());
  await adapter.loadAbout();
  const receipt = adapter.about.local;
  const pending = adapter.loadAbout();
  t.mock.timers.tick(10001);
  await pending;
  assert.equal(adapter.about.local, receipt);
  assert.equal(adapter.about.localLoading, false);
  assert.match(String(adapter.about.localError), /timed out/i);
  held.resolve(response('late'));
});
test('About old identity cannot change current loading, error or confirmed version', async t => {
  const old = gate();
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async () => ++reads === 1 ? old.promise : response('current'));
  const adapter = new DesktopAdapter();
  t.after(() => adapter.clearIdentity());
  const pending = adapter.loadAbout();
  adapter.clearIdentity();
  assert.equal(adapter.about.localLoading, false);
  await adapter.loadAbout();
  old.resolve(response('old'));
  await pending;
  assert.equal(adapter.about.local.build.version, 'current');
  assert.equal(adapter.about.localError, '');
});
test('About Core failure retains its known version without suppressing successful local read', async t => {
  let failCore = false;
  t.mock.method(globalThis, 'fetch', async (url: unknown) => String(url).endsWith('/core-about') && failCore
    ? new Response('{}', { status: 503 }) : response(failCore ? 'new-local' : 'known'));
  const adapter = new DesktopAdapter();
  adapter.state.signedIn = true;
  t.after(() => adapter.clearIdentity());
  await adapter.loadAbout();
  const core = adapter.about.core;
  failCore = true;
  await adapter.loadAbout();
  assert.equal(adapter.about.core, core);
  assert.equal(adapter.about.local.build.version, 'new-local');
  assert.notEqual(String(adapter.about.coreError), '');
  assert.equal(adapter.about.localError, '');
  assert.equal(adapter.about.coreLoading, false);
});
