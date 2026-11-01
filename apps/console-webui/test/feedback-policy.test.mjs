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

test('read notice title remains lazy in EN and ZH without retargeting its original page owner', async t => {
  const { readFailureNotice } = await import('../src/feedback-policy.ts');
  const { chooseLocale, t: translate } = await import('../dist/browser/locale.js');
  t.after(() => chooseLocale('en'));
  const original = { identity: 'original', object: '/users', generation: 7 };
  const notice = readFailureNotice(original, 'CORE_UNAVAILABLE', () => `${translate('module.users')} · unavailable`, undefined);
  chooseLocale('zh-CN');
  assert.equal(notice.message(), '用户 · unavailable');
  chooseLocale('en');
  assert.equal(notice.message(), 'Users · unavailable');
  assert.equal(notice.object, '/users');
  assert.equal(notice.identity, 'original');
  assert.equal(notice.generation, 7);
});

test('validated page re-entry retires only original identity/path read observations, preserving write unknown and other pages', async () => {
  const { pageReadNoticeOwners, readFailureNotice } = await import('../src/feedback-policy.ts');
  const { NoticeStore } = await import('../../ui-shared/notices.js');
  const store = new NoticeStore();
  store.setIdentity('original');
  const current = { identity: 'original', object: '/models', generation: 5 };
  const retry = { label: () => 'Retry', run: () => {} };
  store.publish(readFailureNotice({ ...current, generation: 1 }, 'CORE_UNAVAILABLE', () => 'old models', retry));
  store.publish(readFailureNotice({ ...current, object: '/users', generation: 2 }, 'CORE_UNAVAILABLE', () => 'users', retry));
  store.publish(resultNotice({ ...current, task: 'save-model' }, { phase: 'unknown', unknown: true, message: () => 'write unknown' }));
  const selected = pageReadNoticeOwners(current, store.items());
  assert.equal(selected.length, 1);
  assert.equal(selected[0].generation, 1);
  for (const owner of selected) store.resolve(owner);
  assert.deepEqual(store.items().map(item => item.task).sort(), ['read', 'save-model']);
  assert.equal(store.items().find(item => item.task === 'read').object, '/users');
  assert.equal(pageReadNoticeOwners({ ...current, identity: 'new' }, store.items()).length, 0);
  assert.equal(pageReadNoticeOwners({ ...current, generation: 0 }, selected).length, 0);
  store.destroy();
});
test('failed re-entry coalesces only older page reads and installs current recovery without replaying writes', async () => {
  const { pageReadNoticeOwners, readFailureNotice } = await import('../src/feedback-policy.ts');
  const { NoticeStore } = await import('../../ui-shared/notices.js');
  const store = new NoticeStore();
  store.setIdentity('original');
  let oldReads = 0, currentReads = 0;
  const current = { identity: 'original', object: '/models', generation: 3 };
  store.publish(readFailureNotice({ ...current, generation: 1 }, 'CORE_UNAVAILABLE', () => 'old', { label: () => 'Retry', run: () => { oldReads++; } }));
  const fresh = readFailureNotice(current, 'CORE_UNAVAILABLE', () => 'current', { label: () => 'Retry', run: () => { currentReads++; } });
  for (const owner of pageReadNoticeOwners(current, store.items())) {
    if (owner.generation < current.generation) store.resolve(owner);
  }
  store.publish(fresh);
  assert.equal(store.items().length, 1);
  store.items()[0].recovery.run();
  assert.equal(oldReads, 0);
  assert.equal(currentReads, 1);
  assert.equal(store.publish(fresh), false);
  store.destroy();
});
