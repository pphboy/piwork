import assert from 'node:assert/strict';
import test from 'node:test';
import { resultNotice, requiresOwnedRecovery } from '../src/feedback-policy.ts';

const owner = { identity: 'core/account:1', object: 'runtime', task: 'save', generation: 2 };
test('ordinary pending and background reads never become result notifications', () => {
  for (const flags of [{ pending: true }, { background: true }]) {
    assert.equal(resultNotice(owner, { phase: 'reading', message: () => 'Reading', ...flags }), undefined);
  }
});
test('notice identity includes original owner, action and generation', () => {
  const notice = resultNotice(owner, { phase: 'unknown', unknown: true, message: () => 'Check original result' });
  assert.equal(notice.tone, 'unknown');
  for (const other of [{ ...owner, object: 'models' }, { ...owner, task: 'read' }, { ...owner, generation: 3 }, { ...owner, identity: 'core/account:2' }]) {
    assert.notEqual(resultNotice(other, { phase: 'unknown', message: () => '' }).key, notice.key);
  }
});
test('localized text remains lazy and recovery is explicitly delegated', () => {
  let language = 'en', checks = 0;
  const notice = resultNotice(owner, { phase: 'failed', error: true,
    message: () => language === 'en' ? 'Not confirmed' : '尚未确认',
    recovery: { label: () => 'Check', run: () => { checks++; } },
  });
  assert.equal(checks, 0);
  language = 'zh-CN';
  assert.equal(notice.message(), '尚未确认');
  notice.recovery.run();
  assert.equal(checks, 1);
});
test('unknown, failure and confirmed-write/readback-failure require owned recovery', () => {
  for (const state of [{ unknown: true }, { error: true }, { refreshFailed: true }]) assert.equal(requiresOwnedRecovery(state), true);
  assert.equal(requiresOwnedRecovery({}), false);
});
test('repeated read failures coalesce across request attempts and recovery only resolves that read', async () => {
  const { readFailureNotice } = await import('../src/feedback-policy.ts');
  const { NoticeStore } = await import('../../ui-shared/notices.js');
  const store = new NoticeStore();
  store.setIdentity(owner.identity);
  const readOwner = { identity: owner.identity, object: 'runtime', generation: 7 };
  for (let attempt = 0; attempt < 3; attempt++) {
    store.publish(readFailureNotice(readOwner, 'CORE_UNREACHABLE', () => 'Runtime unavailable', { label: () => 'Retry', run: () => {} }));
  }
  assert.equal(store.items().length, 1);
  store.publish(resultNotice(owner, { phase: 'unknown', unknown: true, message: () => 'Original write unknown' }));
  store.resolve({ ...readOwner, task: 'read' });
  assert.equal(store.items().length, 1);
  assert.equal(store.items()[0].tone, 'unknown');
  store.destroy();
});
