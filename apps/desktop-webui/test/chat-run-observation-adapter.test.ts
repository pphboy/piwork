import assert from 'node:assert/strict';
import test from 'node:test';
const { DesktopAdapter } = await import(new URL('../browser/adapter.js', import.meta.url).href);
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

async function until(check: () => boolean) {
  for (let index = 0; index < 60 && !check(); index++) await Promise.resolve();
  assert.ok(check());
}

test('Run feedback adapter: only validated original Run read advances local observation evidence', async t => {
  const adapter = new DesktopAdapter();
  t.after(() => adapter.clearIdentity());
  let mismatch = false;
  t.mock.method(globalThis, 'fetch', async (url: unknown) => String(url).includes('history-capabilities') ? reply({}, 501) : reply({
    workId: 'work', sessionId: 'session', runId: mismatch ? 'other-run' : 'run', state: 2,
  }));
  await adapter.loadRunDetails('work', 'run');
  const first = adapter.getRunFeedback('work', 'session', 'run');
  assert.equal(first.run.status, 'running');
  assert.ok(first.revision > 0);
  await assert.rejects(adapter.loadRunDetails('work', 'run', true, 'other-session'));
  assert.equal(adapter.getRunFeedback('work', 'session', 'run').revision, first.revision);
  mismatch = true;
  await assert.rejects(adapter.loadRunDetails('work', 'run'));
  assert.equal(adapter.getRunFeedback('work', 'session', 'run').revision, first.revision);
  assert.equal(adapter.getRunFeedback('work', 'session', 'other-run'), undefined);
  adapter.clearIdentity();
  assert.equal(adapter.getRunFeedback('work', 'session', 'run'), undefined);
});

test('Run feedback adapter: reconnect start cannot confirm unknown; actual original event can', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'], now: 0 });
  const adapter = new DesktopAdapter();
  t.after(() => {
    adapter.stopRunObservers();
    adapter.clearIdentity();
  });
  const run: { id: string; sessionId: string; status: string; cursor: number; created: string; error?: string } = { id: 'run', sessionId: 'session', status: 'running', cursor: 0, created: '' };
  adapter.state.works.push({ id: 'work', sessions: [{ id: 'session', title: 'Session', messages: [] }], run });
  let streamReady = false;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    if (String(url).includes('history-capabilities')) return reply({}, 501);
    return streamReady ? new Response(stream) : reply({ message: 'Synthetic stream unavailable' }, 503);
  });
  await adapter.resumeRun('work');
  const unknown = adapter.getRunFeedback('work', 'session', 'run');
  assert.equal(unknown.revision, 0);
  assert.ok(unknown.run.error);
  streamReady = true;
  const reconnect = adapter.resumeRun('work');
  assert.equal(run.error, undefined);
  assert.equal(adapter.getRunFeedback('work', 'session', 'run').revision, 0);
  assert.ok(adapter.getRunFeedback('work', 'session', 'run').run.error);
  controller.enqueue(new TextEncoder().encode(JSON.stringify({ sequence: 1, kind: { $case: 'state', state: { state: 2 } } }) + '\n'));
  await until(() => adapter.getRunFeedback('work', 'session', 'run').revision > 0);
  assert.equal(adapter.getRunFeedback('work', 'session', 'run').run.error, undefined);
  adapter.stopRunObservers();
  controller.close();
  await reconnect;
});

for (const mismatched of ['workId', 'runId', 'sessionId']) {
  test(`Run feedback adapter: explicit mismatched ${mismatched} cannot mutate the original Run`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const adapter = new DesktopAdapter();
    t.after(() => {
      adapter.stopRunObservers();
      adapter.clearIdentity();
    });
    const run = { id: 'run', sessionId: 'session', status: 'running', cursor: 0, created: '' };
    adapter.state.works.push({ id: 'work', sessions: [{ id: 'session', title: 'Session', messages: [] }], run });
    t.mock.method(globalThis, 'fetch', async (url: unknown) => {
      if (String(url).includes('history-capabilities')) return reply({}, 501);
      if (String(url).includes('/events')) return new Response('');
      return reply({ workId: 'work', runId: 'run', sessionId: 'session', state: 5, [mismatched]: 'wrong-original' });
    });
    await adapter.resumeRun('work');
    assert.equal(run.status, 'running');
    const observation = adapter.getRunFeedback('work', 'session', 'run');
    assert.equal(observation.revision, 0);
    assert.ok(observation.run.error);
  });
}

for (const replacement of ['identity', 'run']) {
  test(`Run feedback adapter: late original GET after ${replacement} change cannot mutate or begin follow-up reads`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const adapter = new DesktopAdapter();
    t.after(() => {
      adapter.stopRunObservers();
      adapter.clearIdentity();
    });
    const original = { id: 'run', sessionId: 'session', status: 'running', cursor: 0, created: '' };
    const work = { id: 'work', sessions: [{ id: 'session', title: 'Session', messages: [] }], run: original };
    adapter.state.works.push(work);
    let resolve!: (response: Response) => void;
    const held = new Promise<Response>(done => { resolve = done; });
    const paths: string[] = [];
    t.mock.method(globalThis, 'fetch', async (url: unknown) => {
      paths.push(String(url));
      if (String(url).includes('history-capabilities')) return reply({}, 501);
      if (String(url).includes('/events')) return new Response('');
      return held;
    });
    const observation = adapter.resumeRun('work');
    await until(() => paths.some(path => path.endsWith('/runs/run')));
    const newer = { ...original, id: 'new-run' };
    if (replacement === 'identity') {
      adapter.clearIdentity();
      adapter.state.works.push({ ...work, run: newer });
    } else work.run = newer;
    resolve(reply({ workId: 'work', runId: 'run', sessionId: 'session', state: 5 }));
    await observation;
    assert.equal(original.status, 'running');
    assert.equal(newer.status, 'running');
    assert.equal(adapter.getRunFeedback('work', 'session', 'run'), undefined);
    assert.equal(paths.some(path => path.includes('/sessions/') || path.endsWith('/services') || path.endsWith('/configuration')), false);
  });
}
