import test from 'node:test';
import assert from 'node:assert/strict';

const { DesktopAdapter } = await import(new URL('../browser/adapter.js', import.meta.url).href);
const { projectWork, workState } = await import(new URL('../browser/lifecycle.js', import.meta.url).href);
const { MetadataReads, ObservationDeferred, ObservationStopped, ObservationTimeout } = await import(new URL('../browser/observation.js', import.meta.url).href);
const raw = (state = 'ready', desired = 'running', version = 1) => ({ id: 'work-one', name: 'My Work', observedState: state, desiredState: desired, controlVersion: version });
function fixture(t: any, handler: (path: string, method: string) => any) {
  const previous = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    const value = await handler(String(url).replace('/_desktop/api/', ''), init.method);
    return new Response(JSON.stringify(value.body ?? value), { status: value.status ?? 200 });
  }) as typeof fetch;
  const adapter = new DesktopAdapter();
  t.after(() => { adapter.clearIdentity(); globalThis.fetch = previous; });
  return adapter;
}

test('DWUI-016 preparation is a real state and confirmation time belongs to the Work', async t => {
  const a = fixture(t, () => raw('provisioning'));
  a.state.lastChecked = 'connection-only';
  const w = await a.refreshWorkStatus('work-one');
  assert.equal(w.status, 'Preparing'); assert.equal(w.observed, 'provisioning'); assert.equal(w.controlVersion, 1);
  assert.notEqual(w.checkedAt, a.state.lastChecked); assert.equal(projectWork(w, []).action, 'stop');
  assert.equal(workState('a-new-unrecognized-state'), 'Unknown');
  assert.equal(projectWork({ ...w, status: 'Degraded' }, []).usable, true);
  assert.equal(projectWork({ ...w, status: 'Failed', desired: 'stopped' }, []).action, 'check');
});

test('DWUI-016 accepted stop preserves Ready as last fact while closing running admission', async t => {
  const a = fixture(t, () => ({ operationId: 'stop-original', workId: 'work-one' }));
  a.state.works = [a.mapWork(raw())]; const work = a.getWork('work-one');
  await a.lifecycle(work.id, 'stop');
  const p = a.project(work);
  assert.equal(work.status, 'Ready'); assert.equal(p.label, 'Stop accepted');
  assert.equal(p.usable, false); assert.equal(p.action, 'check'); assert.equal(p.exportable, false);
  assert.deepEqual(p.operationIds, ['stop-original']);
});

test('DWUI-018 recover canonical types and multiple IDs without guessing latest server operation', async t => {
  const a = fixture(t, path => path === 'known-operations' ? { operations: [
    { operationId: 'older-start', workId: 'work-one', type: 'Work action' },
    { operationId: 'original-stop', workId: 'work-one', type: 'Stop Work' },
  ] } : { operationId: path.split('/')[1], workId: 'work-one', kind: path.endsWith('older-start') ? 'start-work' : 'stop-work', state: path.endsWith('older-start') ? 'superseded' : 'running' });
  a.state.works = [a.mapWork(raw('stopping', 'stopped', 3))];
  await a.recoverOperations(); await a.checkOperation('older-start'); await a.checkOperation('original-stop');
  assert.equal(a.getWork('work-one').operationId, 'original-stop');
  assert.equal(a.project(a.getWork('work-one')).action, 'check');
  assert.equal(a.state.operations[0].action, 'start'); assert.equal(a.state.operations[1].action, 'stop');
});

test('DWUI-017 manual terminal query keeps a refresh obligation, failure then GET recovery', async t => {
  let failed = true; const writes: string[] = [];
  const a = fixture(t, (path, method) => {
    if (method !== 'GET') writes.push(path);
    if (path.startsWith('operations/')) return { operationId: 'original-stop', workId: 'work-one', kind: 'stop-work', state: 'succeeded' };
    if (failed) return { status: 503, body: { message: 'temporarily offline' } };
    return path === 'works' ? { works: [raw('stopped', 'stopped', 2)] } : raw('stopped', 'stopped', 2);
  });
  a.state.works = [a.mapWork(raw('stopping', 'stopped', 2))];
  a.state.operations = [{ id: 'original-stop', workId: 'work-one', kind: 'Stop Work', action: 'stop', state: 'running' }];
  await a.checkOperation('original-stop');
  await assert.rejects(a.refreshWorkStatus('work-one')); await assert.rejects(a.listWorks());
  assert.equal(a.state.operations[0].state, 'succeeded'); assert.equal(a.workSync.size, 1);
  assert.match(a.getWork('work-one').statusError, /offline/); assert.equal(a.state.works.length, 1);
  failed = false; await a.refreshWorkStatus('work-one'); await a.listWorks();
  assert.equal(a.workSync.size, 0); assert.equal(a.project(a.getWork('work-one')).action, 'start');
  assert.equal(a.project(a.getWork('work-one')).exportable, true); assert.deepEqual(writes, []);
});

test('DWUI-018 old Work and list responses cannot reverse a Stop or reinsert confirmed deleted', async t => {
  const a = fixture(t, () => ({}));
  a.state.works = [a.mapWork(raw('starting', 'running', 2))];
  a.workMutations.set('work-one', 2);
  a.mergeWork(raw('stopping', 'stopped', 3), 10, 2);
  a.mergeWork(raw('ready', 'running', 2), 11, 1);
  a.mergeWork(raw('ready', 'running', 2), 12, 2);
  assert.equal(a.getWork('work-one').status, 'Stopping');
  a.mergeWork(raw('deleted', 'deleted', 4), 13, 2);
  a.mergeWork(raw('ready', 'running', 3), 14, 2);
  assert.equal(a.getWork('work-one'), undefined);
});

test('DWUI-018 create ID remains associated when local persistence was not confirmed', async t => {
  const a = fixture(t, (path, method) => method === 'POST' ? { operationId: 'create-original', workId: 'work-one', localRecordSaved: false } : raw('provisioning'));
  const op = await a.createWork('My Work', {});
  const work = await a.refreshWorkStatus('work-one');
  assert.equal(op.localRecordSaved, false); assert.equal(work.operationId, op.id);
  assert.deepEqual(a.project(work).operationIds, [op.id]);
});

test('DWUI-017 metadata retries exhaust at four, remain paused, and explicit read can recover', async () => {
  let now = 0, calls = 0;
  const reads = new MetadataReads(() => now);
  const failure = async () => { calls++; throw new Error('offline'); };
  for (const delay of [1000, 2000, 5000, 5000]) {
    await assert.rejects(reads.read('work', failure), /offline/); now += delay;
  }
  assert.equal(calls, 4); assert.equal(reads.paused('work'), true);
  await assert.rejects(reads.read('work', failure), ObservationDeferred);
  assert.equal(calls, 4); assert.equal(await reads.read('work', async () => 'stopped', true), 'stopped');
  assert.equal(reads.paused('work'), false); reads.clear();
});

test('DWUI-017 timeout does not serialize another Work, duplicates share one read, cancel releases queue', async () => {
  const reads = new MetadataReads(() => Date.now(), 30);
  let count = 0;
  const slow = reads.read('slow', async () => { count++; return new Promise(() => {}); });
  const duplicate = reads.read('slow', async () => { count++; return 'unexpected'; });
  assert.equal(slow, duplicate);
  assert.equal(await reads.read('other', async () => 'ready'), 'ready');
  await assert.rejects(slow, ObservationTimeout); assert.equal(count, 1);
  const waiting = Array.from({ length: 9 }, (_, i) => reads.read(`cancel-${i}`, async () => new Promise(() => {})));
  reads.cancel(); await Promise.all(waiting.map(p => assert.rejects(p, ObservationStopped)));
  assert.equal(await reads.read('new', async () => 'ready'), 'ready'); reads.clear();
});

test('DWUI-017 hidden and manual pause retain IDs, resume and identity clear release the right observers', async t => {
  const a = fixture(t, path => path === 'known-operations' ? { operations: [] } : {});
  a.state.signedIn = true;
  a.state.operations = [{ id: 'original', workId: 'work-one', state: 'running', action: 'start' }];
  a.pauseOperation('original'); a.observePage('', false); assert.equal(a.pollTimer, undefined);
  a.observePage('work-one', true); assert.equal(a.operationPaused('original'), true);
  a.resumeOperation('original'); assert.ok(a.pollTimer);
  a.clearIdentity(); assert.equal(a.pollTimer, undefined); assert.equal(a.state.operations.length, 0);
});

test('DWUI-018 old asynchronous snapshot cannot satisfy a later terminal refresh, higher server target wins', async t => {
  let release!: (value: any) => void;
  const a = fixture(t, () => new Promise(done => { release = done; }));
  a.state.works = [a.mapWork(raw('starting', 'running', 2))];
  const old = a.refreshWorkStatus('work-one');
  await new Promise(done => setTimeout(done, 0));
  a.requireWorkSync('work-one'); release(raw('ready', 'running', 2)); await old;
  assert.equal(a.workSync.get('work-one').work, true);
  a.workMutations.set('work-one', 1);
  const work = a.getWork('work-one'); work.lifecycleIntent = { action: 'start', operationId: 'local', sequence: 1, baseVersion: 2 };
  a.mergeWork(raw('stopping', 'stopped', 4), 99, 1);
  assert.equal(work.lifecycleIntent, undefined); assert.equal(a.project(a.getWork('work-one')).label, 'Stopping');
});

test('DWUI-017 at most four metadata requests run together and HTTP 404 pauses only its original object', async () => {
  const reads = new MetadataReads(); let active = 0, maximum = 0;
  const releases: Array<() => void> = [];
  const all = Array.from({ length: 8 }, (_, i) => reads.read(String(i), async () => { active++; maximum = Math.max(maximum, active); await new Promise<void>(done => releases.push(done)); active--; return i; }));
  await new Promise(done => setTimeout(done, 0)); assert.equal(maximum, 4);
  releases.splice(0).forEach(done => done()); await new Promise(done => setTimeout(done, 0));
  releases.splice(0).forEach(done => done()); await Promise.all(all); assert.equal(maximum, 4);
  await assert.rejects(reads.read('gone', async () => { throw Object.assign(new Error('gone'), { httpStatus: 404 }); }));
  assert.equal(reads.paused('gone'), true); assert.equal(await reads.read('other', async () => 'ready'), 'ready'); reads.clear();
});

test('DWUI-016 runtime failure, stop failure, degraded and unknown use different recovery actions', async t => {
  const a = fixture(t, () => ({}));
  const failed = a.mapWork({ ...raw('failed'), lastError: { message: 'runtime readiness failed' } });
  assert.equal(a.project(failed).action, 'retry'); assert.match(a.project(failed).explanation, /readiness failed/);
  const stopping = { ...failed, desired: 'stopped' }; assert.equal(a.project(stopping).action, 'check'); assert.equal(a.project(stopping).exportable, false);
  assert.equal(a.project(a.mapWork(raw('degraded'))).usable, true);
  const unknown = a.mapWork(raw('undocumented')); assert.equal(a.project(unknown).action, 'check'); assert.equal(a.project(unknown).usable, false);
});

test('DWUI-017 empty list needs a successful response and completed Delete 404 retains the original ID', async t => {
  let mode = 'failure';
  const a = fixture(t, path => mode === 'failure' ? { status: 503, body: { message: 'list offline' } } : path === 'works' ? { works: [] } : { status: 404, body: { message: 'gone' } });
  a.state.signedIn = true; a.observePage('', false); a.state.works = [a.mapWork(raw())]; a.worksChecked = 'last-confirmed';
  await assert.rejects(a.listWorks()); assert.equal(a.state.works.length, 1);
  mode = 'empty'; await a.listWorks(); assert.equal(a.state.works.length, 0);
  a.state.works = [a.mapWork(raw('stopping', 'deleted', 2))]; a.state.operations = [{ id: 'delete-original', workId: 'work-one', action: 'delete', kind: 'Delete Work', state: 'succeeded' }]; a.requireWorkSync('work-one');
  await assert.rejects(a.refreshWorkStatus('work-one')); assert.equal(a.getWork('work-one'), undefined);
  await a.listWorks(); assert.equal(a.workSync.size, 0); assert.equal(a.state.operations[0].id, 'delete-original');
});

test('DWUI-018 an old missing-members list cannot remove a newly accepted and read Create', async t => {
  let release!: (value: any) => void;
  const a = fixture(t, () => new Promise(done => { release = done; }));
  const pending = a.listWorks(); await new Promise(done => setTimeout(done, 0));
  a.workMutations.set('work-one', 1); a.mergeWork(raw('provisioning'), 99, 1);
  release({ works: [] }); await pending; assert.equal(a.state.works.length, 1); assert.equal(a.getWork('work-one').status, 'Preparing');
});

test('DWUI-017 a deduplicated pre-terminal read is never counted as a new terminal confirmation', async t => {
  let release!: (value: any) => void;
  const a = fixture(t, () => new Promise(done => { release = done; }));
  a.state.works = [a.mapWork(raw('stopping', 'stopped', 2))];
  const first = a.refreshWorkStatus('work-one'); await new Promise(done => setTimeout(done, 0));
  a.requireWorkSync('work-one'); const repeated = a.refreshWorkStatus('work-one');
  release(raw('stopping', 'stopped', 2)); await Promise.all([first, repeated]);
  assert.equal(a.workSync.get('work-one').work, true);
  const fresh = a.refreshWorkStatus('work-one'); await new Promise(done => setTimeout(done, 0));
  release(raw('stopped', 'stopped', 2)); await fresh; assert.equal(a.workSync.get('work-one').work, false);
});

test('DWUI-018 an old failed Operation is not presented as a newer server failure reason', async t => {
  const a = fixture(t, () => ({})); const work = a.mapWork(raw('failed', 'running', 8));
  a.state.operations = [{ id: 'old-failure', workId: 'work-one', kind: 'Start Work', action: 'start', state: 'failed', error: 'historical cause' }];
  assert.doesNotMatch(a.project(work).explanation, /historical cause/);
  assert.equal(a.project(work).action, 'retry');
});

test('DWUI-017 clear terminal history preserves original evidence until Work/list recover', async t => {
  let offline = false; let starts = 0;
  const a = fixture(t, (path, method) => {
    if (method === 'POST') { starts++; return { operationId: 'start-clear', workId: 'work-one' }; }
    if (path.startsWith('operations/')) return { operationId: 'start-clear', workId: 'work-one', kind: 'start-work', state: 'succeeded' };
    if (method === 'DELETE') return {};
    if (offline) return { status: 503, body: { message: 'readback offline' } };
    return path === 'works' ? { works: [raw('ready', 'running', 2)] } : raw('ready', 'running', 2);
  });
  a.state.works = [a.mapWork(raw('stopped', 'stopped'))];
  await a.lifecycle('work-one', 'start'); await a.checkOperation('start-clear');
  offline = true; await assert.rejects(a.refreshWorkStatus('work-one')); await assert.rejects(a.listWorks());
  await a.clearOperations(); assert.equal(a.state.operations.length, 0);
  assert.equal(a.getOperation('start-clear').state, 'succeeded');
  assert.deepEqual(a.project(a.getWork('work-one')).operationIds, ['start-clear']);
  await a.checkOperation('start-clear'); assert.equal(a.state.operations.length, 0);
  offline = false; await a.refreshWorkStatus('work-one'); await a.listWorks();
  assert.equal(a.project(a.getWork('work-one')).label, 'Ready'); assert.equal(a.project(a.getWork('work-one')).usable, true);
  assert.equal(a.getWork('work-one').lifecycleIntent, undefined); assert.equal(a.terminalEvidence.size, 0);
  assert.equal(a.workSync.size, 0); assert.equal(starts, 1);
});

test('DWUI-018 clear snapshot cannot remove a new Stop or let late Start release its intent', async t => {
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; }); t.after(release);
  const a = fixture(t, async (path, method) => {
    if (method === 'DELETE') { await gate; return {}; }
    if (method === 'POST') return { operationId: 'new-stop', workId: 'work-one' };
    if (path.startsWith('operations/')) return { operationId: path.split('/')[1], workId: 'work-one', kind: path.endsWith('new-stop') ? 'stop-work' : 'start-work', state: path.endsWith('new-stop') ? 'running' : 'succeeded' };
    return path === 'works' ? { works: [raw('ready', 'stopped', 3)] } : raw('ready', 'stopped', 3);
  });
  a.state.works = [a.mapWork(raw())]; a.accepted({ operationId: 'old-start', workId: 'work-one' }, 'work-one', 'Start Work');
  await a.checkOperation('old-start'); const clearing = a.clearOperations();
  await a.lifecycle('work-one', 'stop'); release(); await clearing;
  await a.checkOperation('old-start'); await a.refreshWorkStatus('work-one'); await a.listWorks();
  assert.equal(a.getWork('work-one').lifecycleIntent.operationId, 'new-stop');
  assert.equal(a.project(a.getWork('work-one')).label, 'Stop accepted');
  assert.equal(a.project(a.getWork('work-one')).usable, false);
  assert.ok(a.state.operations.some((op: any) => op.id === 'new-stop'));
  a.clearIdentity(); assert.equal(a.terminalEvidence.size, 0);
});

test('DWUI-017 adapter schedules B every two seconds across hanging A periods', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  let release!: () => void; const gate = new Promise<void>(done => { release = done; }); t.after(release);
  const calls: Array<{ path: string; at: number }> = []; let observed = 'starting';
  const b = () => ({ ...raw(observed), id: 'work-b', name: 'B' });
  const a = fixture(t, async path => {
    calls.push({ path, at: Date.now() });
    if (path === 'operations/a') await gate;
    if (path.startsWith('operations/')) return { operationId: path.split('/')[1], workId: path.endsWith('/a') ? 'work-one' : 'work-b', kind: 'start-work', state: 'running' };
    return path === 'works' ? { works: [raw('starting'), b()] } : path === 'works/work-b' ? b() : raw('starting');
  });
  a.state.signedIn = true; a.state.works = [a.mapWork(raw('starting')), a.mapWork(b())];
  a.state.operations = [{ id: 'a', workId: 'work-one', kind: 'Start Work', action: 'start', state: 'running' }, { id: 'b', workId: 'work-b', kind: 'Start Work', action: 'start', state: 'running' }];
  const flush = async () => { for (let i = 0; i < 8; i++) await new Promise<void>(done => setImmediate(done)); };
  a.requireWorkSync('work-one'); a.requireWorkSync('work-b'); a.scheduleOperationPoll();
  t.mock.timers.tick(2000); await flush(); assert.ok(calls.some(c => c.path === 'works')); assert.equal(calls.filter(c => c.path === 'operations/b').length, 1);
  observed = 'ready'; t.mock.timers.tick(2000); await flush();
  assert.equal(a.getWork('work-b').status, 'Ready'); assert.equal(calls.filter(c => c.path === 'operations/b').length, 2);
  observed = 'degraded'; t.mock.timers.tick(2000); await flush();
  assert.equal(a.getWork('work-b').status, 'Degraded');
  assert.deepEqual(calls.filter(c => c.path === 'operations/b').map(c => c.at), [102000, 104000, 106000]);
  assert.equal(calls.filter(c => c.path === 'operations/a').length, 1);
  a.observePage('', false); const before = calls.length; t.mock.timers.tick(2000); await flush(); assert.equal(calls.length, before);
  a.pauseOperation('b'); a.observePage('', true); t.mock.timers.tick(2000); await flush();
  assert.equal(calls.filter(c => c.path === 'operations/b').length, 3);
  a.resumeOperation('b'); t.mock.timers.tick(2000); await flush(); assert.equal(calls.filter(c => c.path === 'operations/b').length, 4);
  a.clearIdentity(); const ended = calls.length; t.mock.timers.tick(20000); await flush(); assert.equal(calls.length, ended);
});

test('DWUI-017 adapter failure backoff and five-second panel read preserve exhaustion', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const reads: number[] = [];
  const a = fixture(t, path => {
    if (path === 'works/work-one') { reads.push(Date.now()); return { status: 503, body: { message: 'offline' } }; }
    return { status: 503, body: { message: 'list offline' } };
  });
  a.state.signedIn = true; a.state.works = [a.mapWork(raw())]; a.requireWorkSync('work-one');
  const flush = async () => { for (let i = 0; i < 8; i++) await new Promise<void>(done => setImmediate(done)); };
  a.scheduleOperationPoll();
  for (const delay of [2000, 1000, 2000, 5000]) { t.mock.timers.tick(delay); await flush(); }
  assert.deepEqual(reads, [102000, 103000, 105000, 110000]);
  await assert.rejects(a.refreshVisibleWork('work-one'), ObservationDeferred);
  t.mock.timers.tick(20000); await flush(); assert.equal(reads.length, 4);
});
