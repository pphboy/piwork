import assert from 'node:assert/strict';
import test from 'node:test';
const { DesktopAdapter } = await import(new URL('../browser/adapter.js', import.meta.url).href);
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const request = { kind: 'piwork.service-view', version: 1, status: 'requested', action: 'select', serviceId: 'service-b' };
const event = { workId: 'work', sessionId: 'session', runId: 'run', sequence: '1', kind: { $case: 'tool', tool: {
  toolName: 'service_select', toolCallId: 'real-call', phase: 'tool-end', isError: false,
  result: { kind: 'text', text: JSON.stringify(request), truncated: false, isError: false },
} } };

function prepare(t: any) {
  const adapter = new DesktopAdapter();
  adapter.state.works.push({ id: 'work', services: [], sessions: [{ id: 'session', messages: [], runs: [] }] });
  adapter.observePage('work', false, false);
  t.mock.method(adapter, 'assertCoreReady', () => {});
  t.mock.method(adapter, 'modelReady', () => true);
  t.mock.method(adapter, 'modelSelection', () => ({ ref: null, thinking: null }));
  t.mock.method(adapter, 'supportsHistory', async () => { adapter.historySupport.set('work', false);
   return false;
   });
  t.after(() => { adapter.stopRunObservers();
   adapter.clearIdentity();
   });
  return adapter;
}

test('Service view adapter registers its own accepted Run before fast events, without giving observers authority', async t => {
  const owner = prepare(t), observer = prepare(t);
  let attempts = 0, observed = 0;
  owner.serviceViews.subscribe(() => attempts++);
   observer.serviceViews.subscribe(() => observed++);
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: any) => {
    const body = JSON.parse(init.body);
    return reply({ run: { workId: 'work', runId: 'run', sessionId: 'session', submissionKey: body.submissionKey, state: 1 } });
  });
  t.mock.method(owner, 'resumeRun', async () => { owner.serviceViews.consume(event);
   observer.serviceViews.consume(event);
   });
  await owner.send('work', 'session', 'show B', false);
  assert.equal(attempts, 1);
   assert.equal(observed, 0);
});

test('Service view adapter retains only the original pending key for read-only acceptance recovery', async t => {
  const adapter = prepare(t);
   let attempts = 0, key = '';
  adapter.serviceViews.subscribe(() => attempts++);
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: any) => {
    if (init.method === 'POST') { key = JSON.parse(init.body).submissionKey;
     return reply({ code: 'RESULT_UNKNOWN' }, 503);
     }
    return reply({ kind: 'run', key, status: 'accepted', run: { workId: 'work', runId: 'run', sessionId: 'session', submissionKey: key, state: 2 } });
  });
  t.mock.method(adapter, 'loadSession', async () => {});
  t.mock.method(adapter, 'resumeRun', async () => { adapter.serviceViews.consume(event);
   });
  await assert.rejects(adapter.send('work', 'session', 'show B', false));
  await adapter.recoverChatSubmission('work');
  assert.equal(attempts, 1);
  adapter.observePage('other', false, false);
   adapter.observePage('work', false, false);
  adapter.serviceViews.consume({ ...event, sequence: '2' });
  assert.equal(attempts, 1);
});

test('Service view adapter consumes real event-stream projections once and history observers get no authority', async t => {
  const adapter = prepare(t);
   let attempts = 0;
  adapter.serviceViews.subscribe(() => attempts++);
  const run = { id: 'run', sessionId: 'session', status: 'running', cursor: 0, created: '' };
  adapter.getWork('work').run = run;
  t.mock.method(globalThis, 'fetch', async (url: unknown) => String(url).includes('/events')
    ? new Response([{ workId: 'work', sessionId: 'session', runId: 'run', sequence: '1', kind: { $case: 'state', state: { state: 4 } } }, { ...event, sequence: '2' }, { ...event, sequence: '3' }].map(value => JSON.stringify(value)).join('\n') + '\n')
    : reply({ workId: 'work', sessionId: 'session', runId: 'run', state: 4 }));
  await adapter.resumeRun('work');
  assert.equal(attempts, 0);
  run.cursor = 0;
   run.status = 'running';
  adapter.serviceViews.begin('key', 'work', 'session');
   adapter.serviceViews.accept('key', 'work', 'session', 'run');
  await adapter.resumeRun('work');
  assert.equal(attempts, 1);
  adapter.clearIdentity();
   adapter.serviceViews.consume(event);
  assert.equal(attempts, 1);
});
