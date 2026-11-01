import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
const moduleURL = process.env.PIWORK_CONSOLE_MODULE_DIR
  ? pathToFileURL(`${process.env.PIWORK_CONSOLE_MODULE_DIR}/quick-setup-port.js`)
  : new URL('../dist/browser/quick-setup-port.js', import.meta.url);
const { createQuickSetupPort } = await import(moduleURL);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
function fixture(t, fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = fetch;
  t.after(() => { globalThis.fetch = original; });
  return createQuickSetupPort(() => 'synthetic-csrf');
}
test('setup uses only its named read, create, binding and optional Test endpoints', async t => {
  const calls = [];
  const port = fixture(t, async (url, options) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : undefined, headers: options.headers });
    return json({});
  });
  await port.readSnapshot();
  await port.readModels();
  await port.bindRuntime('original-model-ref');
  await port.testModel({ api: 'openai-responses', model: 'fixture-model', baseUrl: 'https://model.example.invalid', credential: 'synthetic-key' });
  assert.deepEqual(calls.map(call => [call.url, call.method]), [
    ['/_web/api/onboarding', 'GET'], ['/console/api/admin/models', 'GET'],
    ['/console/api/admin/runtime', 'PUT'], ['/console/api/admin/model-tests', 'POST'],
  ]);
  assert.deepEqual(calls[2].body, { modelRef: 'original-model-ref' });
  assert.equal(calls[2].headers['X-Csrf-Token'], 'synthetic-csrf');
  assert.equal(calls[2].headers['X-Piwork-Csrf'], 'synthetic-csrf');
  assert.ok(!calls.some(call => call.url.includes('operations')));
});
for (const method of ['createModel', 'bindRuntime', 'testModel']) test(`${method} lost response is uncertain and is never automatically replayed`, async t => {
  let calls = 0;
  const port = fixture(t, async () => { calls++;
  throw new Error('Synthetic connection loss'); });
  await assert.rejects(port[method](method === 'bindRuntime' ? 'model-ref' : {}), error => error.unknown === true);
  assert.equal(calls, 1);
});
test('known release-default rejection is not misclassified as an unknown Runtime write', async t => {
  const port = fixture(t, async () => json({ code: 'RELEASE_DEFAULTS_UNAVAILABLE' }, 503));
  await assert.rejects(port.bindRuntime('model-ref'), error => error.code === 'RELEASE_DEFAULTS_UNAVAILABLE' && error.unknown === false);
});
test('read budget covers delayed JSON and does not label read failure as accepted write', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const body = deferred();
  const port = fixture(t, async () => ({ ok: true, status: 200, json: () => body.promise }));
  const read = port.readSnapshot();
  const rejected = assert.rejects(read, error => error.unknown === false && /not confirmed|timed out|10 seconds/i.test(error.message));
  await Promise.resolve();
  t.mock.timers.tick(10000);
  await rejected;
  body.resolve({ administrator: true });
});
test('server credential-like error text is not copied into the local error message', async t => {
  const port = fixture(t, async () => json({ code: 'INVALID_REQUEST', field: 'baseUrl', message: 'synthetic-key-never-show' }, 400));
  await assert.rejects(port.createModel({}), error => error.field === 'baseUrl' && !error.message.includes('synthetic-key-never-show'));
});
