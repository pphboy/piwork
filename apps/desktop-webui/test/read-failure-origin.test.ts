import assert from 'node:assert/strict';
import test from 'node:test';
const { DesktopAdapter } = await import(new URL('../browser/adapter.js', import.meta.url).href);
async function rejected(promise: Promise<unknown>) {
  try { await promise; } catch (error) { return error; }
  assert.fail('Expected rejection');
}
for (const [name, value, status] of [['HTTP failure', { message: 'read failed' }, 503], ['invalid Works shape', {}, 200]] as const) {
  test(`Works failure provenance identifies exact ${name} object, never a matching message`, async t => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(value), { status }));
    const adapter = new DesktopAdapter();
    adapter.state.signedIn = true;
    t.after(() => adapter.clearIdentity());
    const error = await rejected(adapter.listWorks());
    assert.equal(adapter.readFailureResource(error), 'works');
    assert.equal(adapter.readFailureResource(new Error(String(error))), undefined);
    assert.equal(adapter.readFailureResource(String(error)), undefined);
  });
}
test('read provenance is valid only in its originating identity', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 503 }));
  const adapter = new DesktopAdapter();
  adapter.state.signedIn = true;
  t.after(() => adapter.clearIdentity());
  const error = await rejected(adapter.listWorks());
  assert.equal(adapter.readFailureResource(error), 'works');
  adapter.clearIdentity();
  assert.equal(adapter.readFailureResource(error), undefined);
});
test('rejected sign-in mutation is not mislabeled as a resource read', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ code: 'INVALID_CREDENTIALS' }), { status: 400 }));
  const adapter = new DesktopAdapter();
  t.after(() => adapter.clearIdentity());
  adapter.state.core.address = 'https://core.example';
  const error = await rejected(adapter.signIn('https://core.example', 'owner', 'synthetic'));
  assert.equal(adapter.readFailureResource(error), undefined);
});
