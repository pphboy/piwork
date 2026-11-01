import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
const { DesktopAdapter } = await import(new URL('../browser/adapter.js', import.meta.url).href);
function fixture(t: TestContext, handler: (path: string, method: string) => Response | Promise<Response>) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-01T08:00:00Z') });
  const calls: Array<{ path: string; method: string }> = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, options?: RequestInit) => {
    const path = String(url).replace('/_desktop/api/', '');
    const method = options?.method || 'GET';
    calls.push({ path, method });
    return handler(path, method);
  });
  const adapter = new DesktopAdapter();
  t.after(() => adapter.clearIdentity());
  return { adapter, calls };
}
const session = () => new Response(JSON.stringify({ state: 'signed-out', csrf: 'synthetic', generation: 1, coreUrl: 'https://core.example' }));

test('session outcome: lost login remains locked and explicit session confirmation never replays credentials', async t => {
  let unavailable = false;
  const { adapter, calls } = fixture(t, path => {
    if (path === 'login') {
      unavailable = true;
      throw new TypeError('Synthetic login response lost');
    }
    return unavailable ? new Response('{}', { status: 503 }) : session();
  });
  await adapter.checkSession();
  await assert.rejects(adapter.signIn('https://core.example', 'owner', 'synthetic-password'));
  assert.equal(adapter.signInUnknown, true);
  await assert.rejects(adapter.signIn('https://core.example', 'owner', 'different-password'));
  assert.equal(calls.filter(call => call.path === 'login').length, 1);
  await assert.rejects(adapter.checkSignInOutcome());
  assert.equal(adapter.signInUnknown, true);
  unavailable = false;
  assert.equal(await adapter.checkSignInOutcome(), false);
  assert.equal(adapter.signInUnknown, false);
  assert.equal(calls.filter(call => call.method !== 'GET').length, 1);
});

test('session outcome: malformed successful session is unavailable, never a confirmed signed-out form', async t => {
  const { adapter, calls } = fixture(t, () => new Response(JSON.stringify({ state: 'signed-out', csrf: '', generation: 1 })));
  await assert.rejects(adapter.checkSession());
  assert.equal(adapter.state.sessionState, 'unavailable');
  assert.equal(adapter.state.signedIn, false);
  assert.ok(String(adapter.state.sessionError));
  assert.equal(calls.filter(call => call.method !== 'GET').length, 0);
});
