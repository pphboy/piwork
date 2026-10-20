import test from 'node:test';
import assert from 'node:assert/strict';

const { ExportFlows } = await import(new URL('../browser/export-flow.js', import.meta.url).href);
function deferred<T = any>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise<void>(resolve => setImmediate(resolve)); };
function fixture() {
  const calls: string[] = [], deliveries: any[] = [];
  const work: any = { id: 'work-a', name: 'Original Work', desired: 'stopped', observed: 'stopped', status: 'Stopped', controlVersion: 1 };
  const operations = new Map<string, any>();
  const snapshots = new Map<string, any>();
  const snapshot = (id = 'snap-new', operationId = 'export-new') => ({ id, workId: 'work-a', operationId, status: 'verified', filename: `${id}.work`, size: '42 bytes', packageSize: 42, digest: 'verified-sha256', expiresAt: '2100-01-01T00:00:00Z' });
  const operation = (id = 'export-new', snapshotId = 'snap-new') => ({ id, workId: 'work-a', checkedWorkId: 'work-a', state: 'succeeded', kind: 'Export Work', snapshotId });
  const port: any = {
    identityEpoch: 1, state: { signedIn: true }, downloads: new Map(),
    getWork: (id: string) => id === work.id ? work : undefined,
    project: (w: any) => ({ exportable: w.desired === 'stopped' && w.observed === 'stopped' && !w.statusError && !w.conflict, action: w.desired === 'running' && !w.statusError ? 'stop' : 'check' }),
    getOperation: (id: string) => operations.get(id), getSnapshot: (id: string) => snapshots.get(id),
    refreshWorkStatus: async (id: string) => { calls.push(`GET work ${id}`); return work; },
    checkOperation: async (id: string) => { calls.push(`GET operation ${id}`); return operations.get(id); },
    fetchSnapshot: async (id: string) => { calls.push(`GET snapshot ${id}`); return snapshots.get(id); },
    lifecycle: async (id: string, action: string) => {
      calls.push(`POST ${action} ${id}`);
      const stop = { id: 'stop-original', workId: id, checkedWorkId: id, state: 'succeeded', kind: 'Stop Work', action: 'stop' };
      operations.set(stop.id, stop); Object.assign(work, { desired: 'stopped', observed: 'stopped', status: 'Stopped', operationId: stop.id, controlVersion: work.controlVersion + 1 }); return stop;
    },
    prepareExport: async (id: string) => {
      calls.push(`POST export ${id}`); const op = operation(); operations.set(op.id, op); const snap = snapshot(); snapshots.set(snap.id, snap); return op;
    },
    downloadSnapshot: async (id: string) => {
      calls.push(`POST prepare ${id}`); const job = { transferId: `transfer-${id}`, snapshotId: id, workId: 'work-a', ready: true, pending: false };
      port.downloads.set(id, job); return `/_desktop/api/downloads/${job.transferId}/content`;
    },
    retryDownloadSnapshot: async (id: string) => { calls.push(`RETRY prepare ${id}`); port.downloads.delete(id); return port.downloadSnapshot(id); },
    checkDownload: async (id: string) => { calls.push(`GET transfer ${id}`); return port.downloads.get(id); },
  };
  const options: any = { changed() {}, deliver(flow: any, url: string) { deliveries.push({ flowId: flow.id, workId: flow.workId, snapshotId: flow.snapshotId, url, consumed: flow.autoDeliveryConsumed }); } };
  const flows = new ExportFlows(port, options);
  return { port, options, flows, work, operations, snapshots, calls, deliveries, snapshot, operation,
    count: (prefix: string) => calls.filter(call => call.startsWith(prefix)).length,
    existing(id = 'snap-a', opId = `export-${id}`) { snapshots.set(id, snapshot(id, opId)); operations.set(opId, operation(opId, id)); return flows.start('work-a', { mode: 'existing', snapshotId: id }); },
  };
}
function pendingPreparation(f: ReturnType<typeof fixture>) {
  const post = deferred<string>();
  f.port.downloadSnapshot = (id: string) => {
    f.calls.push(`POST prepare ${id}`);
    f.port.downloads.set(id, { transferId: `transfer-${id}`, snapshotId: id, workId: 'work-a', ready: false, pending: true });
    return post.promise.then(url => { Object.assign(f.port.downloads.get(id), { ready: true, pending: false }); f.flows.update(); return url; });
  };
  return post;
}

test('stopped intent performs one continuous export, validation and atomic delivery', async () => {
  const f = fixture(); const flow = f.flows.start('work-a', { mode: 'new' }); await settle();
  assert.equal(flow.phase, 'delivered'); assert.equal(flow.terminal, true);
  assert.equal(f.count('POST export'), 1); assert.equal(f.count('POST prepare'), 1); assert.equal(f.count('POST stop'), 0);
  assert.deepEqual(f.deliveries.map(d => [d.snapshotId, d.consumed]), [['snap-new', true]]);
  for (let i = 0; i < 4; i++) { f.flows.update(); await f.flows.check(flow.id); }
  assert.equal(f.deliveries.length, 1);
});

test('new export cannot be replaced by old snapshots in either array order', async () => {
  const f = fixture(); f.snapshots.set('old-a', f.snapshot('old-a', 'export-old-a')); f.snapshots.set('old-b', f.snapshot('old-b', 'export-old-b'));
  const flow = f.flows.start('work-a', { mode: 'new' }); await settle();
  assert.equal(flow.snapshotId, 'snap-new'); assert.equal(f.deliveries[0].snapshotId, 'snap-new');
});

test('exact existing A and B intents independently use their original snapshot and operation', async () => {
  const f = fixture(); const a = f.existing('snapshot-a'); await settle(); const b = f.existing('snapshot-b'); await settle();
  assert.equal(a.snapshotId, 'snapshot-a'); assert.equal(b.snapshotId, 'snapshot-b'); assert.equal(f.count('POST export'), 0);
  assert.deepEqual(f.deliveries.map(d => d.snapshotId), ['snapshot-a', 'snapshot-b']);
});

test('in-flight dedupe accepts only identical mode, snapshot and stop authority', async () => {
  const f = fixture(); const waiting = deferred(); f.port.refreshWorkStatus = () => waiting.promise;
  const a = f.flows.start('work-a', { mode: 'new' });
  assert.equal(f.flows.start('work-a', { mode: 'new' }), a);
  assert.throws(() => f.flows.start('work-a', { mode: 'existing', snapshotId: 'other' }), /Another export intent/);
  assert.throws(() => f.flows.start('work-a', { mode: 'new', stopConfirmed: true }), /Another export intent/);
  waiting.resolve(f.work); await settle(); assert.equal(f.count('POST export'), 1);
  const post = pendingPreparation(f); const b = f.existing('snapshot-b'); await settle();
  assert.equal(f.flows.start('work-a', { mode: 'existing', snapshotId: 'snapshot-b' }), b);
  assert.throws(() => f.flows.start('work-a', { mode: 'existing', snapshotId: 'snapshot-c' }), /Another export intent/);
  post.resolve('ready'); await settle();
});

test('running Work without Stop confirmation submits neither Stop nor Export', async () => {
  const f = fixture(); Object.assign(f.work, { desired: 'running', observed: 'ready', status: 'Ready' });
  const flow = f.flows.start('work-a', { mode: 'new' }); await settle();
  assert.equal(flow.phase, 'failed'); assert.equal(f.count('POST'), 0);
});

test('Stop and export queries original Stop success and actual stopped before export', async () => {
  const f = fixture(); Object.assign(f.work, { desired: 'running', observed: 'ready', status: 'Ready' });
  const flow = f.flows.start('work-a', { mode: 'new', stopConfirmed: true }); await settle();
  assert.equal(flow.stopOperationId, 'stop-original'); assert.equal(flow.phase, 'delivered');
  assert.equal(f.count('POST stop'), 1); assert.equal(f.count('POST export'), 1);
  assert.ok(f.calls.indexOf('GET operation stop-original') < f.calls.indexOf('POST export work-a'));
});

for (const state of ['failed', 'unknown', 'running', 'superseded']) test(`original Stop ${state} cannot advance even when Work looks stopped`, async () => {
  const f = fixture(); Object.assign(f.work, { status: 'Stopping', observed: 'stopping', operationId: 'stop-original' });
  f.operations.set('stop-original', { id: 'stop-original', workId: 'work-a', checkedWorkId: 'work-a', action: 'stop', kind: 'Stop Work', state });
  f.port.refreshWorkStatus = async () => { Object.assign(f.work, { status: 'Stopped', observed: 'stopped' }); return f.work; };
  const flow = f.flows.start('work-a', { mode: 'new', stopConfirmed: true }); await settle();
  assert.equal(f.count('POST'), 0); assert.notEqual(flow.phase, 'delivered');
});

test('Stop succeeded while observed stopping waits, then original read recovery continues', async () => {
  const f = fixture(); Object.assign(f.work, { status: 'Stopping', observed: 'stopping', operationId: 'stop-original' });
  f.operations.set('stop-original', { id: 'stop-original', workId: 'work-a', checkedWorkId: 'work-a', action: 'stop', kind: 'Stop Work', state: 'succeeded' });
  const flow = f.flows.start('work-a', { mode: 'new', stopConfirmed: true }); await settle(); assert.equal(f.count('POST'), 0);
  Object.assign(f.work, { status: 'Stopped', observed: 'stopped' }); await f.flows.check(flow.id); await settle();
  assert.equal(flow.phase, 'delivered'); assert.equal(f.count('POST stop'), 0);
});

test('uncertain initially stopped facts do not invent a missing Stop ID dependency', async () => {
  const f = fixture(); f.work.statusError = 'read failed';
  f.port.refreshWorkStatus = async () => { delete f.work.statusError; return f.work; };
  const flow = f.flows.start('work-a', { mode: 'new' }); await settle();
  assert.equal(flow.phase, 'delivered'); assert.equal(flow.stopOperationId, undefined); assert.equal(f.count('POST stop'), 0);
});

test('already stopping without original Stop ID stays unknown without an invented retry', async () => {
  const f = fixture(); Object.assign(f.work, { status: 'Stopping', observed: 'stopping' });
  const flow = f.flows.start('work-a', { mode: 'new', stopConfirmed: true }); await settle();
  Object.assign(f.work, { status: 'Stopped', observed: 'stopped' }); await f.flows.check(flow.id);
  assert.equal(flow.phase, 'unknown'); assert.equal(flow.terminal, false); assert.equal(f.count('POST'), 0);
});

test('newer Work control cannot be substituted for the original accepted Stop', async () => {
  const f = fixture(); Object.assign(f.work, { status: 'Stopping', observed: 'stopping', operationId: 'stop-original' });
  f.operations.set('stop-original', { id: 'stop-original', workId: 'work-a', checkedWorkId: 'work-a', action: 'stop', kind: 'Stop Work', state: 'succeeded' });
  f.port.refreshWorkStatus = async () => { Object.assign(f.work, { status: 'Stopped', observed: 'stopped', operationId: 'newer-stop' }); return f.work; };
  const flow = f.flows.start('work-a', { mode: 'new', stopConfirmed: true }); await settle();
  assert.equal(flow.phase, 'failed'); assert.equal(f.count('POST export'), 0);
});

test('missing original Stop ownership proof and forbidden Work reads block export', async () => {
  const f = fixture(); Object.assign(f.work, { status: 'Stopping', observed: 'stopping', operationId: 'stop-original' });
  f.operations.set('stop-original', { id: 'stop-original', workId: 'work-a', kind: 'Stop Work', state: 'succeeded' });
  const flow = f.flows.start('work-a', { mode: 'new', stopConfirmed: true }); await settle(); assert.equal(flow.phase, 'failed');
  assert.equal(f.count('POST'), 0);
  const g = fixture(); g.port.refreshWorkStatus = async () => { throw Object.assign(new Error('forbidden'), { httpStatus: 403 }); };
  const other = g.flows.start('work-a', { mode: 'new' }); await settle(); assert.equal(g.count('POST'), 0); assert.match(other.error, /forbidden/);
});

for (const field of ['id', 'workId', 'operationId'] as const) test(`snapshot ${field} must match original identity exactly`, async () => {
  const f = fixture(); const original = f.port.fetchSnapshot;
  f.port.fetchSnapshot = async (id: string) => ({ ...await original(id), [field]: 'foreign' });
  const flow = f.flows.start('work-a', { mode: 'new' }); await settle();
  assert.equal(flow.phase, 'failed'); assert.equal(f.count('POST prepare'), 0); assert.equal(f.deliveries.length, 0);
});

test('original Export operation cannot silently replace accepted snapshot identity', async () => {
  const f = fixture(); const original = f.port.prepareExport;
  f.port.prepareExport = async (id: string) => { const op = await original(id); return { ...op, snapshotId: 'accepted-original' }; };
  const flow = f.flows.start('work-a', { mode: 'new' }); await settle(); assert.equal(flow.phase, 'failed'); assert.equal(f.count('POST prepare'), 0);
});

test('closing progress and selecting another Work cannot cancel original delivery', async () => {
  const f = fixture(); const post = pendingPreparation(f); const flow = f.flows.start('work-a', { mode: 'new' }); await settle();
  // The coordinator has no modal/route selection input to accidentally gate this.
  assert.equal(flow.phase, 'preparing'); post.resolve('ready'); await settle();
  assert.equal(f.deliveries.length, 1); assert.equal(f.deliveries[0].workId, 'work-a'); assert.equal(flow.phase, 'delivered');
});

test('lost preparation response recovers by original read without another POST', async () => {
  const f = fixture(); const post = pendingPreparation(f); const flow = f.flows.start('work-a', { mode: 'new' }); await settle();
  post.reject(new Error('response lost')); await settle(); assert.equal(flow.phase, 'unknown'); assert.equal(flow.terminal, false);
  Object.assign(f.port.downloads.get(flow.snapshotId), { ready: true, pending: false });
  await f.flows.check(flow.id); assert.equal(flow.phase, 'delivered'); assert.equal(f.count('POST prepare'), 1); assert.equal(f.count('POST export'), 1);
});

test('ready GET before preparation POST delivers once, including its late response', async () => {
  const f = fixture(); const post = pendingPreparation(f);
  f.port.checkDownload = async (id: string) => { const job = f.port.downloads.get(id); job.ready = true; return job; };
  const flow = f.flows.start('work-a', { mode: 'new' }); await settle(); assert.equal(flow.phase, 'delivered');
  post.resolve('ready'); await settle(); assert.equal(f.deliveries.length, 1); assert.equal(f.count('POST prepare'), 1);
});

test('late ready POST bypasses only an older pending original transfer GET', async () => {
  const f = fixture(); const post = pendingPreparation(f), get = deferred();
  f.port.checkDownload = (id: string) => { f.calls.push(`GET transfer ${id}`); return get.promise; };
  const flow = f.flows.start('work-a', { mode: 'new' }); await settle(); assert.equal(f.count('GET transfer'), 1);
  post.resolve('ready'); await settle(); // Deliberately do not release the older GET yet.
  assert.equal(f.deliveries.length, 1); assert.equal(flow.phase, 'delivered');
  get.resolve({ transferId: flow.transferId, snapshotId: flow.snapshotId, workId: 'work-a', ready: false }); await settle();
  assert.equal(flow.phase, 'delivered'); assert.equal(f.deliveries.length, 1);
});

test('late ready POST cannot bypass pending snapshot validation', async () => {
  const f = fixture(); const post = pendingPreparation(f); const flow = f.flows.start('work-a', { mode: 'new' }); await settle();
  const snapshotGet = deferred(); f.port.fetchSnapshot = () => snapshotGet.promise;
  const check = f.flows.check(flow.id); await settle(); post.resolve('ready'); await settle();
  assert.equal(f.deliveries.length, 0); assert.equal(f.count('POST prepare'), 1);
  snapshotGet.resolve(f.snapshots.get(flow.snapshotId)); await check; assert.equal(f.deliveries.length, 1);
});

test('late ready POST blocked by pause, and Check cannot remove pause or deliver', async () => {
  const f = fixture(); const post = pendingPreparation(f), get = deferred(); f.port.checkDownload = () => get.promise;
  const flow = f.flows.start('work-a', { mode: 'new' }); await settle(); f.flows.pause(flow.id); post.resolve('ready'); await settle();
  assert.equal(f.deliveries.length, 0); get.resolve(f.port.downloads.get(flow.snapshotId)); await settle();
  await f.flows.check(flow.id); assert.equal(flow.paused, true); assert.equal(f.deliveries.length, 0);
  const before = f.calls.length; await f.flows.resume(flow.id); assert.equal(f.deliveries.length, 1);
  assert.ok(f.calls.slice(before).includes('GET snapshot snap-new')); assert.equal(f.count('POST prepare'), 1);
});

test('pause during Work read blocks the initial mutation; Resume rechecks first', async () => {
  const f = fixture(), get = deferred(); f.port.refreshWorkStatus = () => get.promise;
  const flow = f.flows.start('work-a', { mode: 'new' }); await settle(); f.flows.pause(flow.id); get.resolve(f.work); await settle();
  await f.flows.check(flow.id); assert.equal(f.count('POST'), 0);
  f.port.refreshWorkStatus = async () => { f.calls.push('GET work fresh'); return f.work; };
  await f.flows.resume(flow.id); await settle(); assert.equal(flow.phase, 'delivered');
  assert.ok(f.calls.indexOf('GET work fresh') < f.calls.indexOf('POST export work-a'));
});

test('Resume while an older pass is blocked waits then starts its own fresh read', async () => {
  const f = fixture(), oldGet = deferred(); let reads = 0;
  f.port.refreshWorkStatus = async () => { reads++; return reads === 1 ? oldGet.promise : f.work; };
  const flow = f.flows.start('work-a', { mode: 'new' }); await settle(); f.flows.pause(flow.id);
  const resumed = f.flows.resume(flow.id); await settle(); assert.equal(f.count('POST'), 0);
  oldGet.resolve(f.work); await resumed; await settle(); assert.equal(reads, 2); assert.equal(flow.phase, 'delivered');
});

for (const revoke of ['epoch', 'signed-out', 'pagehide']) test(`${revoke} permanently revokes automatic delivery and ignores late success`, async () => {
  const f = fixture(); const post = pendingPreparation(f), get = deferred(); f.port.checkDownload = () => get.promise;
  const flow = f.flows.start('work-a', { mode: 'new' }); await settle();
  if (revoke === 'epoch') f.port.identityEpoch++;
  if (revoke === 'signed-out') f.port.state.signedIn = false;
  if (revoke === 'pagehide') f.flows.revoke(); else f.flows.update();
  post.resolve('ready'); await settle(); assert.equal(flow.phase, 'revoked'); assert.equal(f.deliveries.length, 0);
  f.port.state.signedIn = true; get.resolve(f.port.downloads.get(flow.snapshotId)); await settle();
  await f.flows.resume(flow.id); assert.equal(f.deliveries.length, 0);
});

test('hidden visibility invalidates late-POST bypass; visible recovery rereads original snapshot', async () => {
  const f = fixture(); const post = pendingPreparation(f), get = deferred(); f.port.checkDownload = () => get.promise;
  const flow = f.flows.start('work-a', { mode: 'new' }); await settle(); f.flows.setVisible(false); post.resolve('ready'); await settle();
  assert.equal(f.deliveries.length, 0); get.resolve(f.port.downloads.get(flow.snapshotId)); await settle();
  const before = f.count('GET snapshot'); f.flows.setVisible(true); await settle();
  assert.equal(f.deliveries.length, 1); assert.ok(f.count('GET snapshot') > before);
});

test('unknown Export acceptance with no original ID is locked and never replayed', async () => {
  const f = fixture(); f.port.prepareExport = async () => { f.calls.push('POST export lost'); throw new Error('response lost'); };
  const flow = f.flows.start('work-a', { mode: 'new' }); await settle();
  for (let i = 0; i < 3; i++) { await f.flows.check(flow.id); await f.flows.resume(flow.id); f.flows.update(); }
  assert.equal(flow.phase, 'unknown'); assert.equal(flow.terminal, false); assert.equal(f.count('POST export'), 1);
  assert.equal(f.flows.start('work-a', { mode: 'new' }), flow);
});

test('unknown Stop acceptance cannot be replayed even after stopped facts appear', async () => {
  const f = fixture(); Object.assign(f.work, { desired: 'running', observed: 'ready', status: 'Ready' });
  f.port.lifecycle = async () => { f.calls.push('POST stop lost'); throw new Error('response lost'); };
  const flow = f.flows.start('work-a', { mode: 'new', stopConfirmed: true }); await settle();
  Object.assign(f.work, { desired: 'stopped', observed: 'stopped', status: 'Stopped' }); await f.flows.check(flow.id);
  assert.equal(flow.phase, 'unknown'); assert.equal(f.count('POST stop'), 1); assert.equal(f.count('POST export'), 0);
});

test('known terminal preparation failure releases lock even paused; explicit same snapshot retries once', async () => {
  const f = fixture(), post = deferred<string>();
  f.port.downloadSnapshot = (id: string) => { f.calls.push(`POST prepare ${id}`); f.port.downloads.set(id, { transferId: 'failed-transfer', snapshotId: id, workId: 'work-a', pending: true }); return post.promise; };
  const flow = f.existing('same-snapshot'); await settle(); f.flows.pause(flow.id);
  Object.assign(f.port.downloads.get(flow.snapshotId), { pending: false, terminalFailure: true, error: 'disk full' }); post.reject(new Error('disk full')); await settle();
  assert.equal(flow.phase, 'failed'); assert.equal(flow.paused, true); assert.equal(flow.terminal, true);
  f.port.downloadSnapshot = async (id: string) => { f.calls.push(`POST prepare ${id}`); f.port.downloads.set(id, { transferId: 'fresh-transfer', snapshotId: id, workId: 'work-a', ready: true }); return 'content'; };
  const retry = f.flows.start('work-a', { mode: 'existing', snapshotId: 'same-snapshot' }); await settle();
  assert.notEqual(flow, retry); assert.equal(retry.phase, 'delivered'); assert.equal(retry.transferId, 'fresh-transfer');
  assert.equal(f.count('POST prepare'), 2); assert.equal(f.count('POST export'), 0); assert.equal(f.count('RETRY'), 1);
});

test('terminal failure discovered by paused Check remains terminal without retry', async () => {
  const f = fixture(); pendingPreparation(f); const flow = f.existing(); await settle(); f.flows.pause(flow.id);
  Object.assign(f.port.downloads.get(flow.snapshotId), { terminalFailure: true, pending: false, error: 'hash mismatch' });
  await f.flows.check(flow.id); assert.equal(flow.terminal, true); assert.equal(flow.phase, 'failed'); assert.equal(f.count('POST prepare'), 1);
});

test('explicit download again uses verified original content without Export or preparation', async () => {
  const f = fixture(); const first = f.existing('same'); await settle(); const again = f.flows.start('work-a', { mode: 'existing', snapshotId: 'same' }); await settle();
  assert.notEqual(first.id, again.id); assert.equal(f.deliveries.length, 2); assert.equal(f.count('POST prepare'), 1); assert.equal(f.count('POST export'), 0);
  assert.equal(f.deliveries[0].url, f.deliveries[1].url);
});

test('expired snapshots are terminal, and missing later expiry cannot resurrect original expiry', async () => {
  const f = fixture(); const snap = f.snapshot('expired', 'original'); snap.expiresAt = '2000-01-01T00:00:00Z'; f.snapshots.set(snap.id, snap); f.operations.set('original', f.operation('original', snap.id));
  const flow = f.flows.start('work-a', { mode: 'existing', snapshotId: snap.id }); await settle();
  assert.equal(flow.phase, 'failed'); delete (snap as any).expiresAt; await f.flows.check(flow.id); assert.equal(flow.phase, 'failed'); assert.equal(f.count('POST prepare'), 0);
});

test('exact succeeded snapshot with all-null package metadata is unavailable', async () => {
  const f = fixture(); f.snapshots.set('empty', { ...f.snapshot('empty', 'original'), packageSize: null, digest: null, expiresAt: null }); f.operations.set('original', f.operation('original', 'empty'));
  const flow = f.flows.start('work-a', { mode: 'existing', snapshotId: 'empty' }); await settle();
  assert.equal(flow.phase, 'failed'); assert.equal(f.count('POST prepare'), 0);
});

test('preparing snapshot permits absent package metadata and later exact ready facts', async () => {
  const f = fixture(); f.snapshots.set('building', { ...f.snapshot('building', 'original'), status: 'preparing', packageSize: null, digest: null, expiresAt: null }); f.operations.set('original', f.operation('original', 'building'));
  const flow = f.flows.start('work-a', { mode: 'existing', snapshotId: 'building' }); await settle();
  assert.equal(flow.phase, 'snapshot'); assert.equal(flow.terminal, false); assert.equal(f.count('POST prepare'), 0);
  f.snapshots.set('building', f.snapshot('building', 'original')); await f.flows.check(flow.id); await settle(); assert.equal(flow.phase, 'delivered');
});

test('wrong transfer snapshot or original transfer ID cannot deliver', async () => {
  for (const field of ['transferId', 'snapshotId', 'workId']) {
    const f = fixture(); pendingPreparation(f); f.port.checkDownload = async (id: string) => ({ ...f.port.downloads.get(id), ready: true, [field]: 'foreign' });
    const flow = f.flows.start('work-a', { mode: 'new' }); await settle(); assert.equal(flow.phase, 'failed'); assert.equal(f.deliveries.length, 0);
  }
});

test('browser delivery throw still consumes automatic allowance and retains manual URL', async () => {
  const f = fixture(); let attempts = 0;
  const flows = new ExportFlows(f.port, { changed() {}, deliver(flow: any) { attempts++; assert.equal(flow.autoDeliveryConsumed, true); throw new Error('blocked'); } });
  const flow = flows.start('work-a', { mode: 'new' }); await settle(); await flows.check(flow.id); flows.update();
  assert.equal(attempts, 1); assert.equal(flow.phase, 'delivered'); assert.match(flow.contentURL, /transfer-snap-new/); assert.match(flow.error, /Save file/);
});

test('identity recovery requires a new explicit snapshot action, never revives old intent', async () => {
  const f = fixture(); const post = pendingPreparation(f); const old = f.existing('known'); await settle();
  f.port.identityEpoch++; f.flows.update(); post.resolve('ready'); await settle(); assert.equal(f.deliveries.length, 0);
  const restored = f.flows.start('work-a', { mode: 'existing', snapshotId: 'known' }); await settle();
  assert.equal(old.phase, 'revoked'); assert.equal(restored.phase, 'delivered'); assert.equal(f.count('POST prepare'), 1);
});


test('returning visible during an older blocked transfer read schedules a fresh validation pass', async () => {
  const f = fixture(); const post = pendingPreparation(f), get = deferred(); let reads = 0;
  f.port.checkDownload = (id: string) => { reads++; return reads === 1 ? get.promise : Promise.resolve(f.port.downloads.get(id)); };
  const flow = f.flows.start('work-a', { mode: 'new' }); await settle();
  f.flows.setVisible(false); f.flows.setVisible(true); post.resolve('ready'); await settle(); assert.equal(f.deliveries.length, 0);
  const snapshots = f.count('GET snapshot'); get.resolve(f.port.downloads.get(flow.snapshotId)); await settle();
  assert.equal(f.deliveries.length, 1); assert.ok(f.count('GET snapshot') > snapshots);
});

test('known terminal failure in adapter facts stays terminal during Pause without requiring Check', async () => {
  const f = fixture(); pendingPreparation(f); const flow = f.existing(); await settle(); f.flows.pause(flow.id);
  Object.assign(f.port.downloads.get(flow.snapshotId), { terminalFailure: true, pending: false, error: 'no space' }); f.flows.update();
  assert.equal(flow.phase, 'failed'); assert.equal(flow.terminal, true); assert.equal(flow.paused, true); assert.equal(f.count('POST prepare'), 1);
});


test('transfer 404 after lost preparation remains unknown and cannot release the Work intent lock', async () => {
  const f = fixture(); const post = pendingPreparation(f); const flow = f.existing(); await settle();
  post.reject(new Error('response lost')); await settle();
  f.port.checkDownload = async () => { throw Object.assign(new Error('transfer not found'), { httpStatus: 404 }); };
  await f.flows.check(flow.id); assert.equal(flow.phase, 'unknown'); assert.equal(flow.terminal, false);
  assert.throws(() => f.flows.start('work-a', { mode: 'new' }), /Another export intent/); assert.equal(f.count('POST prepare'), 1);
});

test('HTTP error carrying unknown Export acceptance cannot release its no-replay lock', async () => {
  const f = fixture(); f.port.prepareExport = async () => { f.calls.push('POST export uncertain'); throw Object.assign(new Error('incomplete'), { code: 'RESULT_UNKNOWN', httpStatus: 409 }); };
  const flow = f.flows.start('work-a', { mode: 'new' }); await settle();
  assert.equal(flow.phase, 'unknown'); assert.equal(flow.terminal, false); assert.equal(f.flows.start('work-a', { mode: 'new' }), flow);
  await f.flows.check(flow.id); assert.equal(f.count('POST export'), 1);
});

test('terminal failure discovered while a paused snapshot GET waits cannot be overwritten by its late result', async () => {
  const f = fixture(); pendingPreparation(f); const flow = f.existing(); await settle(); f.flows.pause(flow.id);
  const get = deferred(); f.port.fetchSnapshot = () => get.promise; const check = f.flows.check(flow.id); await settle();
  Object.assign(f.port.downloads.get(flow.snapshotId), { terminalFailure: true, pending: false, error: 'failed validation' }); f.flows.update();
  assert.equal(flow.phase, 'failed'); get.resolve(f.snapshots.get(flow.snapshotId)); await check;
  assert.equal(flow.phase, 'failed'); assert.equal(flow.terminal, true); assert.equal(f.count('POST prepare'), 1);
});


test('accepted Stop with last observed Ready retains the original failed Stop dependency', async () => {
  const f = fixture(); Object.assign(f.work, { desired: 'stopped', observed: 'ready', status: 'Ready', operationId: 'stop-original' });
  f.operations.set('stop-original', { id: 'stop-original', workId: 'work-a', checkedWorkId: 'work-a', action: 'stop', kind: 'Stop Work', state: 'failed' });
  f.port.refreshWorkStatus = async () => { Object.assign(f.work, { observed: 'stopped', status: 'Stopped' }); return f.work; };
  const flow = f.flows.start('work-a', { mode: 'new', stopConfirmed: true }); await settle();
  assert.equal(flow.stopOperationId, 'stop-original'); assert.equal(flow.phase, 'failed'); assert.equal(f.count('POST'), 0);
});

test('adapter updates advance original running Export without an emit/read feedback loop', async () => {
  const f = fixture(); const prepare = f.port.prepareExport;
  f.port.prepareExport = async (id: string) => { const op = await prepare(id); op.state = 'running'; return op; };
  const originalRead = f.port.checkOperation; f.port.checkOperation = async (id: string) => { const op = await originalRead(id); f.flows.update(); return op; };
  const flow = f.flows.start('work-a', { mode: 'new' }); await settle();
  assert.equal(flow.phase, 'exporting'); assert.equal(f.count('GET operation'), 1); assert.equal(f.count('POST prepare'), 0);
  for (let i = 0; i < 10; i++) f.flows.update(); await settle(); assert.equal(f.count('GET operation'), 1);
  f.operations.get(flow.exportOperationId).state = 'succeeded'; f.flows.update(); await settle();
  assert.equal(flow.phase, 'delivered'); assert.equal(f.count('POST export'), 1); assert.equal(f.count('POST prepare'), 1);
});

test('missing later expiry preserves a previously confirmed original expiry while paused', async () => {
  const f = fixture(); const post = pendingPreparation(f); const flow = f.existing('original'); await settle(); f.flows.pause(flow.id);
  delete f.snapshots.get(flow.snapshotId).expiresAt; post.resolve('ready'); await settle();
  await f.flows.check(flow.id); assert.equal(flow.phase, 'ready'); assert.equal(f.deliveries.length, 0);
  await f.flows.resume(flow.id); assert.equal(flow.phase, 'delivered'); assert.equal(f.count('POST prepare'), 1);
});

test('snapshot expiry becoming terminal during pending transfer prevents late ready POST delivery', async () => {
  const f = fixture(); const post = pendingPreparation(f), transfer = deferred(); f.port.checkDownload = () => transfer.promise;
  const flow = f.existing(); await settle(); f.snapshots.get(flow.snapshotId).status = 'expired';
  post.resolve('ready'); await settle(); assert.equal(f.deliveries.length, 0); assert.equal(flow.phase, 'failed');
  transfer.resolve(f.port.downloads.get(flow.snapshotId)); await settle(); assert.equal(flow.phase, 'failed');
});


test('confirmed stopped export does not depend on an unavailable historical Stop record', async () => {
  const f = fixture(); f.work.lifecycleIntent = { action: 'stop', operationId: 'cleared-history', sequence: 1 };
  const flow = f.flows.start('work-a', { mode: 'new' }); await settle();
  assert.equal(flow.phase, 'delivered'); assert.equal(flow.stopOperationId, undefined); assert.equal(f.count('POST stop'), 0); assert.equal(f.count('POST export'), 1);
});

test('uncertain stopped Work plus historical Stop ID revalidates facts without inventing missing-Stop lock', async () => {
  const f = fixture(); Object.assign(f.work, { statusError: 'temporarily unknown', lifecycleIntent: { action: 'stop', operationId: 'cleared-history', sequence: 1 } });
  f.port.refreshWorkStatus = async () => { delete f.work.statusError; return f.work; };
  const flow = f.flows.start('work-a', { mode: 'new' }); await settle();
  assert.equal(flow.phase, 'delivered'); assert.equal(flow.stopOperationId, undefined); assert.equal(f.count('POST stop'), 0);
});


test('automatic updates preserve bounded read mode instead of resetting observation retry budgets', async () => {
  const f = fixture(), post = pendingPreparation(f); const flow = f.existing(); await settle();
  const flags: boolean[] = [], snapshotRead = f.port.fetchSnapshot, transferRead = f.port.checkDownload;
  f.port.fetchSnapshot = async (id: string, explicit: boolean) => { flags.push(explicit); return snapshotRead(id); };
  f.port.checkDownload = async (id: string, explicit: boolean) => { flags.push(explicit); return transferRead(id); };
  f.port.downloads.get(flow.snapshotId).phase = 'validating'; f.flows.update(); await settle();
  assert.deepEqual(flags, [false, false]); post.resolve('ready'); await settle();
});


test('actual Export POST holds Work controls only until reliable acceptance', async () => {
  const f = fixture(), accepted = deferred(); const prepare = f.port.prepareExport;
  f.port.prepareExport = async (id: string) => { f.calls.push('POST export pending'); await accepted.promise; return prepare(id); };
  const post = pendingPreparation(f); const flow = f.flows.start('work-a', { mode: 'new' }); await settle();
  assert.equal(f.flows.workControlBlocked('work-a'), true); assert.equal(f.flows.workControlBlocked('other'), false);
  accepted.resolve(undefined); await settle(); assert.equal(flow.phase, 'preparing'); assert.equal(f.flows.workControlBlocked('work-a'), false);
  f.flows.pause(flow.id); assert.equal(f.flows.workControlBlocked('work-a'), false); post.resolve('ready'); await settle();
  assert.equal(f.flows.workControlBlocked('work-a'), false);
});

test('actual Stop POST holds Work controls; accepted original Stop observation does not', async () => {
  const f = fixture(), accepted = deferred(); Object.assign(f.work, { desired: 'running', observed: 'ready', status: 'Ready' });
  const stop = f.port.lifecycle; f.port.lifecycle = async (id: string, action: string) => { await accepted.promise; const op = await stop(id, action); op.state = 'running'; return op; };
  const flow = f.flows.start('work-a', { mode: 'new', stopConfirmed: true }); await settle(); assert.equal(f.flows.workControlBlocked('work-a'), true);
  accepted.resolve(undefined); await settle(); assert.equal(flow.phase, 'stopping'); assert.equal(f.flows.workControlBlocked('work-a'), false); assert.equal(f.count('POST export'), 0);
});

for (const stage of ['Stop', 'Export']) test(`unknown original ${stage} without acceptance ID continues blocking Work controls`, async () => {
  const f = fixture();
  if (stage === 'Stop') { Object.assign(f.work, { desired: 'running', observed: 'ready', status: 'Ready' }); f.port.lifecycle = async () => { throw new Error('unknown Stop'); }; }
  else f.port.prepareExport = async () => { throw new Error('unknown Export'); };
  const flow = f.flows.start('work-a', { mode: 'new', stopConfirmed: stage === 'Stop' }); await settle();
  assert.equal(flow.phase, 'unknown'); assert.equal(f.flows.workControlBlocked('work-a'), true);
  await f.flows.check(flow.id); assert.equal(f.flows.workControlBlocked('work-a'), true);
  f.port.identityEpoch++; f.flows.update(); assert.equal(f.flows.workControlBlocked('work-a'), false);
});

test('incomplete Export acceptance locks ordinary controls and does not replay on Check', async () => {
  const f = fixture(); f.port.prepareExport = async () => { f.calls.push('POST export incomplete'); return { workId: 'work-a' }; };
  const flow = f.flows.start('work-a', { mode: 'new' }); await settle();
  assert.equal(f.flows.workControlBlocked('work-a'), true); await f.flows.check(flow.id); assert.equal(f.count('POST export'), 1);
});

test('unknown existing-snapshot preparation and Pause never block ordinary Work controls', async () => {
  const f = fixture(); Object.assign(f.work, { desired: 'running', observed: 'ready', status: 'Ready' });
  const post = pendingPreparation(f), flow = f.existing(); await settle(); assert.equal(f.flows.workControlBlocked('work-a'), false);
  post.reject(new Error('unknown download')); await settle(); f.flows.pause(flow.id);
  assert.equal(flow.phase, 'unknown'); assert.equal(f.flows.workControlBlocked('work-a'), false);
});

for (const stage of ['Stop', 'Export']) test(`foreign lifecycle admitted during Work GET blocks the subsequent ${stage} POST`, async () => {
  const f = fixture(), get = deferred(); let foreign = false; const guards: any[] = [];
  if (stage === 'Stop') Object.assign(f.work, { desired: 'running', observed: 'ready', status: 'Ready' });
  f.port.refreshWorkStatus = async () => { f.calls.push('GET work guarded'); return get.promise; };
  f.options.canSubmitWorkMutation = (workId: string, flowId: string) => { guards.push([workId, flowId]); return !foreign; };
  const flow = f.flows.start('work-a', { mode: 'new', stopConfirmed: stage === 'Stop' }); await settle(); foreign = true; get.resolve(f.work); await settle();
  assert.equal(f.count('POST'), 0); assert.equal(f.flows.workControlBlocked('work-a'), false); assert.match(flow.error, /not submitted/);
  assert.deepEqual(guards[0], ['work-a', flow.id]); foreign = false; f.work.controlVersion++; f.flows.update(); await settle(); assert.equal(f.count('POST'), 0);
  const reads = f.count('GET work'); await f.flows.check(flow.id); await settle();
  assert.ok(f.count('GET work') > reads); assert.equal(flow.phase, 'delivered'); assert.equal(f.count('POST export'), 1);
  assert.equal(f.count('POST stop'), stage === 'Stop' ? 1 : 0);
});

test('foreign lifecycle between original Stop confirmation and Export dispatch blocks Export only', async () => {
  const f = fixture(); Object.assign(f.work, { desired: 'running', observed: 'ready', status: 'Ready' }); let checks = 0;
  f.options.canSubmitWorkMutation = () => ++checks === 1;
  const flow = f.flows.start('work-a', { mode: 'new', stopConfirmed: true }); await settle();
  assert.equal(f.count('POST stop'), 1); assert.equal(f.count('POST export'), 0); assert.match(flow.error, /not submitted/); assert.equal(f.flows.workControlBlocked('work-a'), false);
  f.options.canSubmitWorkMutation = () => true; await f.flows.check(flow.id); await settle(); assert.equal(f.count('POST export'), 1); assert.equal(flow.phase, 'delivered');
});


for (const code of ['SNAPSHOT_REQUIRES_STOPPED', 'WORK_BUSY']) test(`verified ${code} 409 rejects only that Export intent and permits explicit correction`, async () => {
  const f = fixture(), prepare = f.port.prepareExport;
  f.port.prepareExport = async () => { f.calls.push('POST export rejected'); throw Object.assign(new Error(code), { code, httpStatus: 409 }); };
  const flow = f.flows.start('work-a', { mode: 'new' }); await settle();
  assert.equal(flow.phase, 'failed'); assert.equal(flow.terminal, true); assert.equal(f.flows.workControlBlocked('work-a'), false); assert.equal(f.count('POST prepare'), 0);
  f.port.prepareExport = prepare; const retry = f.flows.start('work-a', { mode: 'new' }); await settle();
  assert.notEqual(retry, flow); assert.equal(retry.phase, 'delivered'); assert.equal(f.count('POST export'), 2);
});

for (const code of ['RESULT_UNKNOWN', 'CONNECTION_CHANGED', undefined]) test(`unproven409 ${code || 'without code'} remains unknown and blocks ordinary controls`, async () => {
  const f = fixture(); f.port.prepareExport = async () => { throw Object.assign(new Error('unconfirmed'), { code, httpStatus: 409 }); };
  const flow = f.flows.start('work-a', { mode: 'new' }); await settle();
  assert.equal(flow.phase, 'unknown'); assert.equal(flow.terminal, false); assert.equal(f.flows.workControlBlocked('work-a'), true);
});


test('unknown stopped-target facts with no Stop record must read Work rather than invent a Stop dependency', async () => {
  const f = fixture(); Object.assign(f.work, { desired: 'stopped', observed: 'unknown', status: 'Unknown' });
  f.port.refreshWorkStatus = async () => { f.calls.push('GET work unknown'); Object.assign(f.work, { observed: 'stopped', status: 'Stopped' }); return f.work; };
  const flow = f.flows.start('work-a', { mode: 'new' }); await settle();
  assert.equal(f.count('GET work'), 1); assert.equal(flow.phase, 'delivered'); assert.equal(flow.stopOperationId, undefined); assert.equal(f.count('POST stop'), 0);
});

for (const action of ['Stop', 'Export']) test(`confirmed PERMISSION_DENIED 403 ends the ${action} intent without replay or an unknown Work lock`, async () => {
  const f = fixture(), method = action === 'Stop' ? 'lifecycle' : 'prepareExport', original = f.port[method];
  if (action === 'Stop') Object.assign(f.work, { desired: 'running', observed: 'ready', status: 'Ready' });
  f.port[method] = async () => { f.calls.push(`POST ${action.toLowerCase()} denied`); throw Object.assign(new Error('Permission denied'), { code: 'PERMISSION_DENIED', httpStatus: 403 }); };
  const flow = f.flows.start('work-a', { mode: 'new', stopConfirmed: action === 'Stop' }); await settle();
  assert.equal(flow.phase, 'failed'); assert.equal(flow.terminal, true); assert.match(flow.error, /rejected before acceptance.*Permission denied/);
  assert.equal(f.flows.workControlBlocked('work-a'), false); assert.equal(f.count(`POST ${action.toLowerCase()}`), 1); assert.equal(f.count('POST prepare'), 0);
  for (let i = 0; i < 3; i++) { f.flows.update(); await f.flows.check(flow.id); await f.flows.resume(flow.id); }
  assert.equal(f.count(`POST ${action.toLowerCase()}`), 1); assert.equal(f.deliveries.length, 0);
  // Only a fresh explicit intent rechecks current facts and can submit again.
  f.port[method] = original;
  const next = f.flows.start('work-a', { mode: 'new', stopConfirmed: action === 'Stop' }); await settle();
  assert.notEqual(next.id, flow.id); assert.equal(next.phase, 'delivered'); assert.equal(f.count(`POST ${action.toLowerCase()}`), 2);
});

for (const action of ['Stop', 'Export']) for (const failure of [{ code: 'PERMISSION_DENIED', httpStatus: 503 }, { code: 'RESULT_UNKNOWN', httpStatus: 403 }]) test(`${action} unproven permission response ${failure.code}/${failure.httpStatus} retains the unknown lock`, async () => {
  const f = fixture();
  if (action === 'Stop') Object.assign(f.work, { desired: 'running', observed: 'ready', status: 'Ready' });
  f.port[action === 'Stop' ? 'lifecycle' : 'prepareExport'] = async () => { throw Object.assign(new Error('Unconfirmed result'), failure); };
  const flow = f.flows.start('work-a', { mode: 'new', stopConfirmed: action === 'Stop' }); await settle();
  assert.equal(flow.phase, 'unknown'); assert.equal(flow.terminal, false); assert.equal(f.flows.workControlBlocked('work-a'), true);
  assert.equal(f.flows.start('work-a', { mode: 'new', stopConfirmed: action === 'Stop' }), flow);
});

test('Work permission rejection classification never unlocks an unconfirmed preparation', async () => {
  const f = fixture();
  f.port.downloadSnapshot = () => { f.calls.push('POST prepare unconfirmed'); throw Object.assign(new Error('Permission denied'), { code: 'PERMISSION_DENIED', httpStatus: 403 }); };
  const flow = f.existing(); await settle();
  assert.equal(flow.phase, 'unknown'); assert.equal(flow.terminal, false); assert.equal(f.flows.workControlBlocked('work-a'), false);
  assert.equal(f.flows.start('work-a', { mode: 'existing', snapshotId: 'snap-a' }), flow);
  await f.flows.check(flow.id); assert.equal(f.count('POST prepare'), 1);
});

test('a confirmed contrary Work target permanently ends the original successful Stop intent before a later stopped target', async () => {
  const f = fixture(); Object.assign(f.work, { status: 'Stopping', observed: 'stopping', operationId: 'stop-original', controlVersion: 2 });
  f.operations.set('stop-original', { id: 'stop-original', workId: 'work-a', checkedWorkId: 'work-a', action: 'stop', kind: 'Stop Work', state: 'succeeded' });
  f.port.refreshWorkStatus = async () => { Object.assign(f.work, { desired: 'running', observed: 'ready', status: 'Ready', controlVersion: 99 }); return f.work; };
  const flow = f.flows.start('work-a', { mode: 'new', stopConfirmed: true }); await settle();
  assert.equal(flow.phase, 'failed'); assert.equal(flow.terminal, true); assert.match(flow.error, /newer Work control|control sequence changed/); assert.equal(f.count('POST export'), 0);
  f.port.refreshWorkStatus = async () => { Object.assign(f.work, { desired: 'stopped', observed: 'stopped', status: 'Stopped', controlVersion: 100 }); return f.work; };
  await f.flows.check(flow.id); await f.flows.resume(flow.id); f.flows.update(); await settle();
  assert.equal(flow.phase, 'failed'); assert.equal(f.count('POST export'), 0); assert.equal(f.deliveries.length, 0);
});

test('an unconfirmed Work read cannot invent contrary-target evidence or revoke the original Stop intent', async () => {
  const f = fixture(); Object.assign(f.work, { status: 'Stopping', observed: 'stopping', operationId: 'stop-original' });
  f.operations.set('stop-original', { id: 'stop-original', workId: 'work-a', checkedWorkId: 'work-a', action: 'stop', kind: 'Stop Work', state: 'succeeded' });
  f.port.refreshWorkStatus = async () => { Object.assign(f.work, { desired: 'running', observed: 'ready', status: 'Ready', statusError: 'not confirmed' }); return f.work; };
  const flow = f.flows.start('work-a', { mode: 'new', stopConfirmed: true }); await settle();
  assert.equal(flow.terminal, false); assert.equal(f.count('POST export'), 0);
  f.port.refreshWorkStatus = async () => { Object.assign(f.work, { desired: 'stopped', observed: 'stopped', status: 'Stopped', statusError: undefined }); return f.work; };
  await f.flows.check(flow.id); await settle(); assert.equal(flow.phase, 'delivered'); assert.equal(f.count('POST export'), 1);
});

for (const delayed of [false, true]) test(`unseen external controls cannot raise the original Stop continuation bound${delayed ? ' while its acceptance is held' : ''}`, async () => {
  const f = fixture(), accepted = deferred(), stop = f.port.lifecycle;
  Object.assign(f.work, { desired: 'running', observed: 'ready', status: 'Ready', controlVersion: 1 });
  f.port.lifecycle = async (id: string, action: string) => {
    const operation = await stop(id, action);
    // Core accepted this Stop at v2, then other accepted controls reached v4.
    if (delayed) await accepted.promise;
    Object.assign(f.work, { desired: 'stopped', observed: 'stopped', status: 'Stopped', controlVersion: 4 }); return operation;
  };
  const flow = f.flows.start('work-a', { mode: 'new', stopConfirmed: true }); await settle();
  if (delayed) { assert.equal(f.count('POST stop'), 1); assert.equal(f.count('POST export'), 0); accepted.resolve(undefined); await settle(); }
  assert.equal(flow.phase, 'failed'); assert.match(flow.error, /control.*changed|newer Work control/); assert.equal(f.count('POST export'), 0);
  await f.flows.check(flow.id); await f.flows.resume(flow.id); assert.equal(f.count('POST export'), 0);
});

test('an inherited stopping target cannot continue after a newer stopped control version', async () => {
  const f = fixture(); Object.assign(f.work, { status: 'Stopping', observed: 'stopping', operationId: 'stop-original', controlVersion: 2 });
  f.operations.set('stop-original', { id: 'stop-original', workId: 'work-a', checkedWorkId: 'work-a', action: 'stop', kind: 'Stop Work', state: 'succeeded' });
  f.port.refreshWorkStatus = async () => { Object.assign(f.work, { status: 'Stopped', observed: 'stopped', controlVersion: 3 }); return f.work; };
  const flow = f.flows.start('work-a', { mode: 'new', stopConfirmed: true }); await settle();
  assert.equal(flow.phase, 'failed'); assert.equal(f.count('POST export'), 0);
});

test('missing control version cannot authorize Stop but does not affect exact existing snapshot download', async () => {
  const f = fixture(); Object.assign(f.work, { desired: 'running', observed: 'ready', status: 'Ready', controlVersion: undefined });
  const flow = f.flows.start('work-a', { mode: 'new', stopConfirmed: true }); await settle();
  assert.equal(flow.phase, 'failed'); assert.equal(f.count('POST stop'), 0);
  const old = f.existing(); await settle(); assert.equal(old.phase, 'delivered'); assert.equal(f.count('POST export'), 0);
});
