import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
const { DesktopAdapter } = await import(new URL('../browser/adapter.js', import.meta.url).href);
function gate() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}
const saved = (coreUrl: string | null) => new Response(JSON.stringify({ coreUrl }));
function fixture(t: TestContext, handler: (method: string) => Response | Promise<Response>) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-01T08:00:00Z') });
  const methods: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
    const method = options?.method || 'GET';
    methods.push(method);
    return handler(method);
  });
  const adapter = new DesktopAdapter();
  t.after(() => adapter.clearIdentity());
  return { adapter, methods };
}

test('preferences read: deadline releases only the read and retains the confirmed default', async t => {
  const held = gate();
  let phase = 0;
  const { adapter, methods } = fixture(t, () => phase === 1 ? held.promise : saved('https://confirmed.example'));
  await adapter.loadPreferences();
  phase = 1;
  const pending = adapter.loadPreferences();
  assert.equal(adapter.preferences.reading, true);
  t.mock.timers.tick(10001);
  await pending;
  assert.equal(adapter.preferences.reading, false);
  assert.equal(adapter.preferences.phase, 'idle');
  assert.match(String(adapter.preferences.error), /timed out/i);
  assert.equal(adapter.preferences.coreUrl, 'https://confirmed.example');
  phase = 2;
  await adapter.loadPreferences();
  held.resolve(saved('https://obsolete.example'));
  await Promise.resolve();
  assert.equal(adapter.preferences.coreUrl, 'https://confirmed.example');
  assert.equal(adapter.preferences.error, '');
  assert.deepEqual(methods, ['GET', 'GET', 'GET']);
});

test('preferences read: identity cancellation cannot release or overwrite a newer read', async t => {
  const old = gate(), fresh = gate();
  let reads = 0;
  const { adapter } = fixture(t, () => ++reads === 1 ? old.promise : fresh.promise);
  const first = adapter.loadPreferences();
  adapter.clearIdentity();
  const second = adapter.loadPreferences();
  await first;
  assert.equal(adapter.preferences.reading, true);
  old.resolve(saved('https://obsolete.example'));
  await Promise.resolve();
  assert.equal(adapter.preferences.confirmed, false);
  fresh.resolve(saved('https://current.example'));
  await second;
  assert.equal(adapter.preferences.coreUrl, 'https://current.example');
  assert.equal(adapter.preferences.reading, false);
});

test('preferences read: unknown mutation remains locked through a failed readonly deadline', async t => {
  const held = gate();
  let recover = false;
  const { adapter, methods } = fixture(t, method => {
    if (method === 'PUT') throw new TypeError('Synthetic reply lost');
    return recover ? saved('https://accepted.example') : held.promise;
  });
  await adapter.savePreferences('https://accepted.example');
  assert.equal(adapter.preferences.phase, 'unconfirmed');
  const read = adapter.loadPreferences();
  t.mock.timers.tick(10001);
  await read;
  assert.equal(adapter.preferences.phase, 'unconfirmed');
  await adapter.savePreferences(null);
  assert.deepEqual(methods, ['PUT', 'GET']);
  recover = true;
  await adapter.loadPreferences();
  assert.equal(adapter.preferences.phase, 'idle');
  assert.equal(adapter.preferences.coreUrl, 'https://accepted.example');
  assert.deepEqual(methods, ['PUT', 'GET', 'GET']);
});

test('preferences mutation: read deadline does not time out or replay a pending write', async t => {
  const held = gate();
  const { adapter, methods } = fixture(t, () => held.promise);
  const write = adapter.savePreferences('https://accepted.example');
  t.mock.timers.tick(10001);
  assert.equal(adapter.preferences.phase, 'saving');
  assert.equal(adapter.preferences.waiting, true);
  await adapter.loadPreferences();
  await adapter.savePreferences(null);
  assert.deepEqual(methods, ['PUT']);
  held.resolve(saved('https://accepted.example'));
  await write;
  assert.equal(adapter.preferences.phase, 'idle');
  assert.equal(adapter.preferences.coreUrl, 'https://accepted.example');
});
