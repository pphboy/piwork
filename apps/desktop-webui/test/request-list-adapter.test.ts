import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
const { DesktopAdapter } = await import(new URL('../browser/adapter.js', import.meta.url).href);
type Data = Record<string, any>;
function gate() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}
const response = (items: Data[], checkedAt = '2026-11-01T08:00:00Z') => new Response(JSON.stringify({ items, checkedAt, nextCursor: null }));
function fixture(t: TestContext, handler: (url: string) => Response | Promise<Response>) {
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    urls.push(String(url));
    return handler(String(url));
  });
  const adapter = new DesktopAdapter();
  adapter.state.signedIn = true;
  t.after(() => adapter.clearIdentity());
  return { adapter, urls };
}

test('request list: duplicate entrances await the same read and preserve confirmed rows while refreshing', async t => {
  const held = gate();
  let delayed = false;
  const { adapter, urls } = fixture(t, () => delayed ? held.promise : response([{ requestId: 'original', state: 'waiting_apply' }]));
  await adapter.loadRequests('one', 'notes');
  const page = adapter.requests.get('one:notes');
  delayed = true;
  const first = adapter.loadRequests('one', 'notes'), second = adapter.loadRequests('one', 'notes');
  assert.equal(first, second);
  assert.equal(page.loading, true);
  assert.equal(page.items[0].requestId, 'original');
  let settled = false;
  void second.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  held.resolve(response([{ requestId: 'original', state: 'completed' }]));
  await first;
  assert.equal(page.loading, false);
  assert.equal(page.items[0].state, 'completed');
  assert.equal(urls.length, 2);
  assert.ok(urls.every(url => url.includes('serviceName=notes')));
});

test('request list: first-read failure is not confirmed empty; refresh failure retains original confirmation', async t => {
  let failure = true;
  const { adapter } = fixture(t, () => failure ? new Response(JSON.stringify({ message: 'synthetic unavailable' }), { status: 503 }) : response([{ requestId: 'saved' }]));
  await assert.rejects(adapter.loadRequests('one'));
  const page = adapter.requests.get('one:');
  assert.equal(page.checkedAt, undefined);
  assert.match(String(page.error), /synthetic unavailable/);
  failure = false;
  await adapter.loadRequests('one');
  const checked = page.checkedAt;
  failure = true;
  await assert.rejects(adapter.loadRequests('one'));
  assert.equal(page.checkedAt, checked);
  assert.equal(page.items[0].requestId, 'saved');
  assert.equal(page.loading, false);
});

test('request list: identity reset prevents old completion from changing a newer same-key request', async t => {
  const old = gate(), fresh = gate();
  let count = 0;
  const { adapter } = fixture(t, () => ++count === 1 ? old.promise : fresh.promise);
  const first = adapter.loadRequests('one');
  const oldEnded = assert.rejects(first, /Observation ended/);
  adapter.clearIdentity();
  const second = adapter.loadRequests('one');
  old.resolve(response([{ requestId: 'old-user' }]));
  await oldEnded;
  assert.equal(adapter.requests.get('one:').loading, true);
  assert.deepEqual(adapter.requests.get('one:').items, []);
  assert.equal(adapter.loadRequests('one'), second);
  fresh.resolve(response([{ requestId: 'new-user' }]));
  await second;
  assert.equal(adapter.requests.get('one:').items[0].requestId, 'new-user');
});

test('request list: Work and Service filters retain independent results and failure recovery', async t => {
  const held = gate();
  let failTool = true;
  const { adapter, urls } = fixture(t, url => {
    const query = new URL(url, 'http://fixture.invalid').searchParams;
    if (query.get('serviceName') === 'Tool') return failTool
      ? held.promise
      : response([{ requestId: 'tool-confirmed' }]);
    return response([{ requestId: url.includes('/two/') ? 'other-work' : 'all-sources' }]);
  });
  const toolRead = adapter.loadRequests('one', 'Tool');
  const failedTool = assert.rejects(toolRead, /Tool unavailable/);
  await adapter.loadRequests('one');
  await adapter.loadRequests('two');
  assert.equal(adapter.requests.get('one:Tool').loading, true);
  assert.equal(adapter.requests.get('one:').items[0].requestId, 'all-sources');
  assert.equal(adapter.requests.get('two:').items[0].requestId, 'other-work');
  held.resolve(new Response(JSON.stringify({ message: 'Tool unavailable' }), { status: 503 }));
  await failedTool;
  assert.equal(adapter.requests.get('one:').error, '');
  assert.equal(adapter.requests.get('one:Tool').checkedAt, undefined);
  failTool = false;
  await adapter.loadRequests('one', 'Tool');
  assert.equal(adapter.requests.get('one:Tool').error, '');
  assert.equal(adapter.requests.get('one:Tool').items[0].requestId, 'tool-confirmed');
  assert.equal(adapter.requests.get('one:').items[0].requestId, 'all-sources');
  assert.equal(urls.length, 4);
});

test('request list: failed next page preserves the confirmed prefix and cursor until explicit retry', async t => {
  let attempt = 0;
  const { adapter, urls } = fixture(t, () => {
    attempt++;
    if (attempt === 2) return new Response(JSON.stringify({ message: 'Next page unavailable' }), { status: 503 });
    return new Response(JSON.stringify({
      items: [{ requestId: attempt === 1 ? 'prefix' : 'tail' }],
      checkedAt: attempt === 1 ? '2026-11-01T08:00:00Z' : '2026-11-01T08:01:00Z',
      nextCursor: attempt === 1 ? 'original-cursor' : null,
    }));
  });
  await adapter.loadRequests('one', 'Tool');
  const page = adapter.requests.get('one:Tool');
  await assert.rejects(adapter.loadRequests('one', 'Tool', true), /Next page unavailable/);
  assert.deepEqual(page.items.map((item: Data) => item.requestId), ['prefix']);
  assert.equal(page.nextCursor, 'original-cursor');
  assert.equal(page.checkedAt, '2026-11-01T08:00:00Z');
  await adapter.loadRequests('one', 'Tool', true);
  assert.deepEqual(page.items.map((item: Data) => item.requestId), ['prefix', 'tail']);
  assert.equal(page.nextCursor, null);
  assert.equal(page.error, '');
  assert.equal(page.checkedAt, '2026-11-01T08:01:00Z');
  assert.ok(urls.slice(1).every(url => url.includes('cursor=original-cursor')));
});

test('request list success and failure cannot replace the same Work message or terminal Run result', async t => {
  let fail = false;
  const { adapter } = fixture(t, () => fail
    ? new Response(JSON.stringify({ message: 'Request inspector unavailable' }), { status: 503 })
    : response([{ requestId: 'request-one', state: 'waiting_apply', runIds: ['run-one'] }]));
  const message = { id: 'answer-one', role: 'assistant', text: 'Confirmed answer retained', runId: 'run-one' };
  const run = { id: 'run-one', sessionId: 'session-one', status: 'succeeded', cursor: 4, finalText: 'Confirmed answer retained' };
  const session = { id: 'session-one', title: 'Original conversation', messages: [message], runs: [run] };
  adapter.state.works = [{ id: 'one', status: 'Ready', desired: 'running', services: [], sessions: [session], run }];
  const original = structuredClone({ session, run });
  await adapter.loadRequests('one', 'notes');
  assert.equal(adapter.requests.get('one:notes').items[0].state, 'waiting_apply');
  assert.equal(adapter.getWork('one').sessions[0], session);
  assert.equal(adapter.getWork('one').run, run);
  assert.deepEqual({ session, run }, original);
  fail = true;
  await assert.rejects(adapter.loadRequests('one', 'notes'));
  assert.equal(adapter.requests.get('one:notes').items[0].requestId, 'request-one');
  assert.equal(adapter.getWork('one').sessions[0].messages[0], message);
  assert.equal(adapter.getWork('one').run, run);
  assert.deepEqual({ session, run }, original);
});
