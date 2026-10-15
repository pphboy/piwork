import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
const { DesktopAdapter } = await import(new URL('../browser/adapter.js', import.meta.url).href);
type Data = Record<string, any>;
function fixture(t: TestContext, respond: (method: string) => Response | Promise<Response>) {
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: any, init?: RequestInit) => { const method = init?.method || 'GET'; requests.push(method); return respond(method); });
  const adapter = new DesktopAdapter(); adapter.state.signedIn = true;
  t.after(() => adapter.clearIdentity());
  return { adapter, requests };
}
const response = (value: Data, status = 200) => new Response(JSON.stringify(value), { status });
const detail = (state: string) => ({ request: { requestId: 'original', runIds: [], disposition: 'live', state }, evidence: { items: [] } });
for (const state of ['cancelling', 'running', 'cancelled']) test(`cancel receipt remains locked after ${state} readback`, async t => {
  const f = fixture(t, method => response(method === 'POST' ? { requestId: 'original' } : detail(state)));
  await f.adapter.cancelRequest('one', 'original');
  await assert.rejects(f.adapter.cancelRequest('one', 'original'), /already submitted/);
  assert.equal(f.adapter.requestCancellation('one', 'original').phase, 'accepted');
  assert.equal(f.requests.filter(x => x === 'POST').length, 1);
});
test('cancel accepted then GET503 keeps original acceptance and prevents a second POST', async t => {
  const f = fixture(t, method => method === 'POST' ? response({ requestId: 'original' }) : response({ message: 'Synthetic readback outage' }, 503));
  await f.adapter.cancelRequest('one', 'original');
  assert.equal(f.adapter.requestCancellation('one', 'original').phase, 'accepted');
  assert.match(f.adapter.requestCancellation('one', 'original').error, /readback outage/);
  await assert.rejects(f.adapter.cancelRequest('one', 'original'), /already submitted/);
  assert.deepEqual(f.requests, ['POST', 'GET']);
});
test('cancel unknown response and later running observation never replay mutation', async t => {
  const f = fixture(t, method => { if (method === 'POST') throw new Error('lost response'); return response(detail('running')); });
  await assert.rejects(f.adapter.cancelRequest('one', 'original'));
  await f.adapter.loadRequest('one', 'original');
  assert.equal(f.adapter.requestCancellation('one', 'original').phase, 'unknown');
  await assert.rejects(f.adapter.cancelRequest('one', 'original'), /already submitted/);
  assert.deepEqual(f.requests, ['POST', 'GET']);
});
test('cancel malformed receipt stays unknown and locked', async t => {
  const f = fixture(t, () => response({ requestId: 'other' }));
  await assert.rejects(f.adapter.cancelRequest('one', 'original'));
  assert.equal(f.adapter.requestCancellation('one', 'original').phase, 'unknown');
  await assert.rejects(f.adapter.cancelRequest('one', 'original')); assert.deepEqual(f.requests, ['POST']);
});
test('known cancel rejection permits an explicit retry without confusing another Work', async t => {
  const f = fixture(t, () => response({ message: 'not permitted' }, 403));
  await assert.rejects(f.adapter.cancelRequest('one', 'original'));
  assert.equal(f.adapter.requestCancellation('one', 'original'), undefined);
  assert.equal(f.adapter.requestCancellation('two', 'original'), undefined);
});
test('identity cleanup clears cancel locks and discards late acceptance', async t => {
  let resolve!: (value: Response) => void; const held = new Promise<Response>(done => { resolve = done; });
  const f = fixture(t, () => held);
  const pending = f.adapter.cancelRequest('one', 'original');
  assert.equal(f.adapter.requestCancellation('one', 'original').phase, 'pending');
  f.adapter.clearIdentity(); resolve(response({ requestId: 'original' })); await assert.rejects(pending);
  assert.equal(f.adapter.requestCancellation('one', 'original'), undefined); assert.deepEqual(f.requests, ['POST']);
});

test('successful original request refresh clears an accepted readback warning without unlocking cancel', async t => {
  let unavailable = true;
  const f = fixture(t, method => method === 'POST' ? response({ requestId: 'original' }) : unavailable ? response({ message: 'temporary outage' }, 503) : response(detail('cancelled')));
  await f.adapter.cancelRequest('one', 'original'); assert.match(f.adapter.requestCancellation('one', 'original').error, /outage/);
  unavailable = false; await f.adapter.loadRequest('one', 'original');
  assert.equal(f.adapter.requestCancellation('one', 'original').error, '');
  assert.equal(f.adapter.requestCancellation('one', 'original').phase, 'accepted');
  await assert.rejects(f.adapter.cancelRequest('one', 'original')); assert.equal(f.requests.filter(x => x === 'POST').length, 1);
});
