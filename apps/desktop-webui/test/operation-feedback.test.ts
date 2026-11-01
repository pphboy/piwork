import assert from 'node:assert/strict';
import test from 'node:test';
const { operationFeedback, OperationFeedbackRegistry } = await import(new URL('../browser/operation-feedback.js', import.meta.url).href);
const { NoticeStore } = await import(new URL('../browser/notices.js', import.meta.url).href);
const original = () => ({ id: 'original-operation', workId: 'original-work', kind: 'Start Work' });
const checked = () => ({ ...original(), checkedWorkId: 'original-work', checkedKind: 'start_work', state: 'succeeded' });
function fixture() {
  const registry = new OperationFeedbackRegistry();
  registry.setIdentity('identity-one');
  return { registry, owner: registry.accept(original(), 'generation:original-token') };
}

test('accepted and pending states never become terminal success', () => {
  const { owner } = fixture();
  for (const state of ['accepted', 'pending', 'preparing', 'running']) assert.equal(operationFeedback(owner, { ...checked(), state }), undefined);
  assert.equal(operationFeedback(owner, undefined), undefined);
});

test('terminal receipts require original checked identity, Work and kind, never history hints', () => {
  const { owner } = fixture();
  const success = checked();
  for (const change of [{ id: 'another-operation' }, { workId: 'another-work' }, { checkedWorkId: undefined }, { checkedWorkId: 'another-work' }, { checkedKind: undefined }, { checkedKind: 'stop_work' }, { terminalHint: { state: 'succeeded' } }]) {
    assert.equal(operationFeedback(owner, { ...success, ...change }), undefined);
  }
  assert.deepEqual(operationFeedback(owner, success), { tone: 'success', key: 'succeeded', state: 'succeeded', terminal: true });
});

test('Service completion requires the original checked Service', () => {
  const { registry } = fixture();
  const owner = registry.accept({ ...original(), id: 'service-operation', kind: 'restart Service', serviceId: 'original-service' }, 'generation:service-token');
  const operation = { ...checked(), id: 'service-operation', checkedKind: 'restart_service' };
  assert.equal(operationFeedback(owner, operation), undefined);
  assert.equal(operationFeedback(owner, { ...operation, checkedServiceId: 'other-service' }), undefined);
  assert.equal(operationFeedback(owner, { ...operation, checkedServiceId: 'original-service' }).tone, 'success');
});

test('observed failure, unknown and superseded never masquerade as successful completion', () => {
  const { owner } = fixture();
  assert.equal(operationFeedback(owner, { ...checked(), state: 'failed', error: 'Original cause' }).tone, 'error');
  assert.equal(operationFeedback(owner, { ...checked(), state: 'unknown' }).tone, 'unknown');
  assert.equal(operationFeedback(owner, { ...checked(), state: 'superseded' }).tone, 'warning');
  const interrupted = operationFeedback(owner, { ...checked(), observationError: 'Original read failed' });
  assert.equal(interrupted.tone, 'unknown');
  assert.equal(interrupted.terminal, false);
  assert.equal(interrupted.reason, 'Original read failed');
});

test('captured owners survive acceptance object mutations and repeated confirmation', () => {
  const registry = new OperationFeedbackRegistry();
  registry.setIdentity('identity-one');
  const operation = original();
  const owner = registry.accept(operation, 'first-generation');
  operation.workId = 'later-work';
  operation.kind = 'Stop Work';
  assert.equal(owner.workId, 'original-work');
  assert.equal(owner.kind, 'Start Work');
  assert.equal(registry.accept(operation, 'later-generation'), owner);
  assert.equal(owner.generation, 'first-generation');
  assert.equal(registry.owners().length, 1);
});

test('identity change discards old owners and a late publication cannot retire a new identity owner', () => {
  const { registry, owner } = fixture();
  registry.setIdentity('identity-two');
  assert.equal(registry.owners().length, 0);
  const replacement = registry.accept(original(), 'replacement-token');
  registry.published(owner, operationFeedback(owner, checked()), true);
  assert.equal(registry.get(owner.operationId), replacement);
  assert.equal(replacement.identity, 'identity-two');
});

test('only host-accepted verified terminal outcome retires a registry owner', () => {
  const { registry, owner } = fixture();
  registry.published(owner, operationFeedback(owner, { ...checked(), state: 'unknown' }), true);
  assert.equal(registry.get(owner.operationId), owner);
  const success = operationFeedback(owner, checked());
  registry.published(owner, success, false);
  assert.equal(registry.get(owner.operationId), owner);
  registry.published(owner, success, true);
  assert.equal(registry.get(owner.operationId), undefined);
});

test('same original owner replaces readback/observation errors without a second task or lock change', () => {
  const { registry, owner } = fixture();
  const store = new NoticeStore();
  store.setIdentity(owner.identity);
  const lock = { blocked: true };
  store.publish({ ...owner, key: 'readback-failed', tone: 'error', message: () => 'Original readback failed' });
  const outcome = operationFeedback(owner, checked());
  const accepted = store.publish({ ...owner, ...outcome, message: () => 'Start Work · Succeeded' });
  registry.published(owner, outcome, accepted);
  assert.equal(store.items().length, 1);
  assert.equal(store.items()[0].tone, 'success');
  assert.equal(lock.blocked, true);
  store.dismiss(store.items()[0].id);
  assert.equal(lock.blocked, true);
  assert.equal(registry.owners().length, 0);
  store.destroy();
});

test('all accepted feature kinds use verified receipt state, not workspace readiness or saved history', () => {
  const registry = new OperationFeedbackRegistry();
  registry.setIdentity('identity-one');
  const kinds = ['Create Work', 'Stop Work', 'Delete Work', 'Apply Configuration', 'Install Pi Package', 'Remove Pi Package', 'Import Work'];
  for (const [index, kind] of kinds.entries()) {
    const operation = { ...original(), id: `original-${index}`, kind };
    const owner = registry.accept(operation, `generation:${index}`);
    assert.equal(operationFeedback(owner, { ...operation, state: 'succeeded' }), undefined);
    const outcome = operationFeedback(owner, { ...operation, checkedWorkId: operation.workId, checkedKind: kind, state: 'succeeded' });
    assert.equal(outcome.state, 'succeeded');
    assert.equal(outcome.tone, 'success');
  }
  assert.equal(registry.owners().length, kinds.length);
  assert.equal(registry.get('never-accepted-history'), undefined);
});

test('combined projection preserves original unknown and failed readback without downgrading observed unknown', async () => {
  const { operationFeedbackSource } = await import(new URL('../browser/operation-feedback.js', import.meta.url).href);
  const { owner } = fixture();
  const success = operationFeedback(owner, checked());
  const unknown = operationFeedback(owner, { ...checked(), observationError: 'Original observation failed' });
  const failed = operationFeedback(owner, { ...checked(), state: 'failed' });
  const blocked = { blocked: true, refresh: 'failed' };
  assert.equal(operationFeedbackSource(success, blocked), 'action');
  assert.equal(operationFeedbackSource(unknown, blocked), 'action');
  assert.equal(operationFeedbackSource(failed, blocked), 'action');
  assert.equal(blocked.blocked, true);
  assert.equal(operationFeedbackSource(unknown, { refresh: 'failed' }), 'operation');
  assert.equal(operationFeedbackSource(success, { refresh: 'failed' }), 'action');
  assert.equal(operationFeedbackSource(failed, { refresh: 'failed' }), 'operation');
  assert.equal(operationFeedbackSource(success, {}), 'operation');
  assert.equal(operationFeedbackSource(undefined, { error: 'Original request failed' }), 'action');
});

test('a pruned terminal receipt can still recover its live request readback failure without replay', async () => {
  const { operationFeedbackSource } = await import(new URL('../browser/operation-feedback.js', import.meta.url).href);
  const { registry, owner } = fixture();
  const store = new NoticeStore();
  store.setIdentity(owner.identity);
  const requestOwner = owner;
  const request = { refresh: '' };
  const success = operationFeedback(requestOwner, checked());
  const event = { ...requestOwner, ...success, message: () => 'Start Work · Succeeded' };
  registry.published(owner, success, store.publish(event));
  assert.equal(registry.owners().length, 0);
  assert.equal(store.publish(event), false);
  request.refresh = 'failed';
  assert.equal(operationFeedbackSource(success, request), 'action');
  store.publish({ ...requestOwner, key: 'readback-failed', tone: 'error', message: () => 'Readback failed' });
  assert.equal(store.items()[0].tone, 'error');
  request.refresh = '';
  assert.equal(operationFeedbackSource(success, request), 'operation');
  assert.equal(store.publish(event), true);
  assert.equal(store.items().length, 1);
  assert.equal(store.items()[0].tone, 'success');
  assert.equal(store.publish(event), false);
  assert.equal(registry.owners().length, 0);
  store.destroy();
});
