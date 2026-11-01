import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExportFlow } from '../dist/browser/export-flow.js';
import type { LogExportFeedbackFacts } from '../dist/browser/export-feedback.js';
type FlowFixture = Pick<ExportFlow, 'id' | 'workId' | 'workName' | 'identityEpoch' | 'phase' | 'error' | 'autoDeliveryConsumed' | 'feedbackIssue' | 'feedbackError'>;
type LogFixture = { -readonly [Key in keyof LogExportFeedbackFacts]: LogExportFeedbackFacts[Key] };
const { ExportFeedbackRegistry, exportFlowNotice, logExportNotice, logExportTargetAvailable, logExportReadRecovered } = await import(new URL('../browser/export-feedback.js', import.meta.url).href);
const { NoticeStore } = await import(new URL('../browser/notices.js', import.meta.url).href);
const flow = (patch: Partial<FlowFixture> = {}): FlowFixture => ({ id: 'export-1', workId: 'work-1', workName: 'Original', identityEpoch: 1, phase: 'checking', error: '', autoDeliveryConsumed: false, ...patch });
const log = (patch: Partial<LogFixture> = {}): LogFixture => ({ id: '', key: 'original-key', phase: 'creating', error: '', restored: false, intent: true, complete: null, warningCount: 0, ...patch });
const registry = () => {
  const value = new ExportFeedbackRegistry();
  value.setIdentity('1');
  return value;
};
const recovery = { label: () => 'Details', run: () => {} };

test('only explicitly accepted original flows are tracked; wrong epoch excluded', () => {
  const owners = registry(), original = flow();
  assert.equal(owners.flowOwners().length, 0);
  owners.acceptFlow(flow({ identityEpoch: 2 }));
  assert.equal(owners.flowOwners().length, 0);
  owners.acceptFlow(original);
  owners.acceptFlow(flow({ workId: 'wrong' }));
  assert.equal(owners.flowOwners()[0].original, original);
  owners.setIdentity('2');
  assert.equal(owners.flowOwners().length, 0);
});
test('pending export never succeeds, errors and unknown retain original actionable owner', () => {
  const owners = registry(), original = flow();
  owners.acceptFlow(original);
  const registered = owners.flowOwners()[0];
  for (const phase of ['checking', 'stopping', 'exporting', 'snapshot', 'preparing', 'ready'] as const) {
    original.phase = phase;
    assert.equal(exportFlowNotice(registered, recovery), undefined);
  }
  original.phase = 'unknown';
  original.error = 'Original result unknown';
  const event = exportFlowNotice(registered, recovery);
  assert.equal(event.tone, 'unknown');
  assert.equal(event.object, 'work-1');
  assert.equal(event.recovery, recovery);
  assert.match(event.message(), /Original result unknown/);
  original.phase = 'failed';
  assert.equal(exportFlowNotice(registered, recovery).tone, 'error');
  owners.publishedFlow(registered, false);
  assert.equal(owners.flowOwners().length, 1);
  owners.publishedFlow(registered, true);
  assert.equal(owners.flowOwners().length, 0);
});
test('browser delivery remains the existing single success channel; failed handoff still errors', () => {
  const owners = registry(), original = flow({ phase: 'delivered', autoDeliveryConsumed: true });
  owners.acceptFlow(original);
  const registered = owners.flowOwners()[0];
  assert.equal(exportFlowNotice(registered, recovery), undefined);
  original.error = 'Save again';
  original.feedbackIssue = 'delivery';
  original.feedbackError = 'Save again';
  assert.equal(exportFlowNotice(registered, recovery).tone, 'error');
  original.phase = 'revoked';
  assert.equal(exportFlowNotice(registered, recovery), undefined);
});
test('restored log history and replacement task cannot use accepted original registration', () => {
  const owners = registry();
  owners.acceptLog(log({ restored: true }));
  assert.equal(owners.logOwner(null), undefined);
  const original = log();
  owners.acceptLog(original);
  assert.ok(owners.logOwner(original));
  assert.equal(owners.logOwner(log()), undefined);
  owners.setIdentity('2');
  assert.equal(owners.logOwner(original), undefined);
});
test('log pending is silent; actual ready warning and error have priority over success', () => {
  const owners = registry(), original = log();
  owners.acceptLog(original);
  const registered = owners.logOwner(original);
  for (const phase of ['creating', 'collecting', 'packing'] as const) {
    original.phase = phase;
    assert.equal(logExportNotice(registered, recovery), undefined);
  }
  original.phase = 'unknown';
  assert.equal(logExportNotice(registered, recovery).tone, 'unknown');
  original.phase = 'ready';
  original.id = 'log-export-original';
  assert.equal(logExportNotice(registered, recovery).tone, 'success');
  original.complete = false;
  assert.equal(logExportNotice(registered, recovery).tone, 'warning');
  original.error = 'Readback failed';
  assert.equal(logExportNotice(registered, recovery).tone, 'error');
  for (const phase of ['failed', 'interrupted', 'expired'] as const) {
    original.phase = phase;
    original.error = '';
    assert.equal(logExportNotice(registered, recovery).tone, 'error');
  }
});
test('same original log retry pending does not resolve unknown; ready replaces once without mutations', () => {
  const owners = registry(), original = log({ phase: 'unknown', error: 'No receipt' });
  owners.acceptLog(original);
  const registered = owners.logOwner(original), store = new NoticeStore();
  store.setIdentity('1');
  store.publish(logExportNotice(registered, recovery));
  original.phase = 'creating';
  original.error = '';
  assert.equal(logExportNotice(registered, recovery), undefined);
  assert.equal(store.items()[0].tone, 'unknown');
  original.id = 'log-export-original';
  original.phase = 'ready';
  const before = JSON.stringify(original), ready = logExportNotice(registered, recovery);
  assert.equal(store.publish(ready), true);
  assert.equal(store.publish(ready), false);
  assert.equal(store.items().length, 1);
  assert.equal(store.items()[0].tone, 'success');
  assert.equal(JSON.stringify(original), before);
  store.destroy();
});

test('changed original identity fields cannot retarget a retained failure notice', () => {
  const owners = registry(), original = flow({ phase: 'unknown', error: 'Unconfirmed' });
  owners.acceptFlow(original);
  const registered = owners.flowOwners()[0];
  original.workId = 'different-work';
  assert.equal(exportFlowNotice(registered, recovery), undefined);
  original.workId = 'work-1';
  original.id = 'different-flow';
  assert.equal(exportFlowNotice(registered, recovery), undefined);
  const task = log({ phase: 'unknown', error: 'Unconfirmed' });
  owners.acceptLog(task);
  const accepted = owners.logOwner(task);
  task.key = 'different-key';
  assert.equal(logExportNotice(accepted, recovery), undefined);
});
test('snapshot-ready is not browser delivered and ready log requires its original receipt', () => {
  const owners = registry(), original = flow({ phase: 'ready', autoDeliveryConsumed: false });
  owners.acceptFlow(original);
  assert.equal(exportFlowNotice(owners.flowOwners()[0], recovery), undefined);
  const task = log({ phase: 'ready', complete: true });
  owners.acceptLog(task);
  assert.equal(logExportNotice(owners.logOwner(task), recovery), undefined);
});


test('pending guidance is not an error notification; only original source read issue projects', () => {
  const owners = registry(), original = flow({ phase: 'stopping', error: 'Waiting for original Stop' });
  owners.acceptFlow(original);
  const registered = owners.flowOwners()[0];
  assert.equal(exportFlowNotice(registered, recovery), undefined);
  original.phase = 'preparing';
  original.error = 'Transfer not confirmed yet';
  assert.equal(exportFlowNotice(registered, recovery), undefined);
  original.feedbackIssue = 'read';
  original.error = 'Original transfer observation failed';
  original.feedbackError = original.error;
  original.error = 'Transfer not confirmed yet';
  const event = exportFlowNotice(owners.flowOwners()[0], recovery);
  assert.equal(event.tone, 'error');
  assert.match(event.message(), /Original transfer observation failed/);
  assert.doesNotMatch(event.message(), /Transfer not confirmed yet/);
});


test('all pending guidance classes remain silent without explicit issue provenance', () => {
  for (const [phase, error] of [['stopping', 'stopVersionWaiting'], ['checking', 'controlPending'], ['stopping', 'waitStop'], ['checking', 'workNotStopped'], ['preparing', 'transferUnconfirmed']] as const) {
    const owners = registry(), original = flow({ phase, error });
    owners.acceptFlow(original);
    assert.equal(exportFlowNotice(owners.flowOwners()[0], recovery), undefined);
  }
});
test('source issue snapshot survives pending advice and only source-confirmed clear removes projection', () => {
  const owners = registry(), original = flow({ phase: 'preparing', feedbackIssue: 'read', feedbackError: 'Original read failed', error: 'Waiting for transfer' });
  owners.acceptFlow(original);
  assert.match(exportFlowNotice(owners.flowOwners()[0], recovery).message(), /Original read failed/);
  original.error = '';
  assert.match(exportFlowNotice(owners.flowOwners()[0], recovery).message(), /Original read failed/);
  delete original.feedbackIssue;
  delete original.feedbackError;
  assert.equal(exportFlowNotice(owners.flowOwners()[0], recovery), undefined);
});


test('captured log recovery cannot substitute newer or missing task; ordinary menu remains current', () => {
  assert.equal(logExportTargetAvailable('original', { key: 'original' }), true);
  assert.equal(logExportTargetAvailable('original', { key: 'newer' }), false);
  assert.equal(logExportTargetAvailable('original', null), false);
  assert.equal(logExportTargetAvailable(undefined, { key: 'newer' }), true);
  assert.equal(logExportTargetAvailable(undefined, null), true);
});


test('only observed original read issue followed by confirmed clear silently retires its sticky notice', () => {
  const owners = registry(), original = flow({ phase: 'preparing', feedbackIssue: 'read', feedbackError: 'Original read failed' });
  owners.acceptFlow(original);
  const registered = owners.flowOwners()[0], store = new NoticeStore();
  store.setIdentity('1');
  assert.equal(owners.readRecovered(registered), false);
  store.publish(exportFlowNotice(registered, recovery));
  original.error = '';
  assert.equal(owners.readRecovered(registered), false);
  assert.equal(store.items().length, 1);
  delete original.feedbackIssue;
  delete original.feedbackError;
  original.phase = 'unknown';
  assert.equal(owners.readRecovered(registered), false);
  original.phase = 'preparing';
  assert.equal(owners.readRecovered(registered), true);
  store.resolve(registered.owner);
  assert.equal(store.items().length, 0);
  assert.equal(owners.readRecovered(registered), false);
  store.destroy();
});


test('exact original delivery owner remains recoverable after terminal pruning, never clone or identity', () => {
  const owners = registry(), original = flow({ phase: 'delivered', feedbackIssue: 'delivery', feedbackError: 'Handoff failed', autoDeliveryConsumed: true });
  owners.acceptFlow(original);
  const registered = owners.flowOwners()[0];
  owners.publishedFlow(registered, true);
  assert.equal(owners.flowOwners().length, 0);
  assert.equal(owners.flowOwner(original), registered);
  assert.equal(owners.flowOwner({ ...original }), undefined);
  original.workId = 'other';
  assert.equal(owners.flowOwner(original), undefined);
  original.workId = 'work-1';
  owners.setIdentity('2');
  assert.equal(owners.flowOwner(original), undefined);
});


test('confirmed original ongoing log read silently resolves error; reset and other owners never do', () => {
  const owners = registry(), original = log({ id: 'original-receipt', phase: 'collecting', error: 'Original GET failed' });
  owners.acceptLog(original);
  const registered = owners.logOwner(original), store = new NoticeStore();
  store.setIdentity('1');
  store.publish(logExportNotice(registered, recovery));
  assert.equal(logExportReadRecovered(registered, original, '1'), false);
  original.error = '';
  original.phase = 'creating';
  assert.equal(logExportReadRecovered(registered, original, '1'), false);
  assert.equal(store.items().length, 1);
  original.phase = 'unknown';
  assert.equal(logExportReadRecovered(registered, original, '1'), false);
  original.phase = 'collecting';
  assert.equal(logExportReadRecovered(registered, { ...original }, '1'), false);
  assert.equal(logExportReadRecovered(registered, original, '2'), false);
  original.id = '';
  assert.equal(logExportReadRecovered(registered, original, '1'), false);
  original.id = 'original-receipt';
  assert.equal(logExportReadRecovered(registered, original, '1'), true);
  assert.equal(logExportNotice(registered, recovery), undefined);
  store.resolve(registered.owner);
  assert.equal(store.items().length, 0);
  original.phase = 'packing';
  assert.equal(logExportReadRecovered(registered, original, '1'), true);
  original.key = 'new-task';
  assert.equal(logExportReadRecovered(registered, original, '1'), false);
  store.destroy();
});
