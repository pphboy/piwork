import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
const moduleURL = process.env.PIWORK_CONSOLE_MODULE_DIR
  ? pathToFileURL(`${process.env.PIWORK_CONSOLE_MODULE_DIR}/action-state.js`)
  : new URL('../dist/browser/action-state.js', import.meta.url);
const { ActionState } = await import(moduleURL);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, promise };
};
const families = [
  ['Users', '/users', 'user:original'],
  ['Default Work', '/default-work', 'defaults'],
  ['Skills', '/skills', 'skill:original'],
  ['Packages', '/packages', 'package:original'],
  ['Runtime', '/runtime', 'runtime'],
];
for (const [family, view, resource] of families) {
  test(`${family} action owner keeps confirmed write and failed readback as separate facts`, async t => {
    const actions = new ActionState();
    t.after(() => actions.clear());
    const record = actions.begin({ key: `save:${resource}`, kind: 'configuration', resource, view, label: 'Saving', target: resource });
    actions.confirm(record, 'Write confirmed');
    const read = deferred();
    const refreshing = actions.refresh(record, () => read.promise);
    assert.equal(record.pending, false);
    assert.equal(record.result, 'Write confirmed');
    assert.equal(record.refresh, 'refreshing');
    read.reject(new Error('Readback unavailable'));
    await refreshing;
    assert.equal(record.result, 'Write confirmed');
    assert.equal(record.error, undefined);
    assert.equal(record.blocked, undefined);
    assert.equal(record.refresh, 'failed');
    assert.equal(record.refreshError, 'Readback unavailable');
    assert.equal(actions.conflict(record), undefined);
    await actions.refresh(record, async () => ({}));
    assert.equal(record.result, 'Write confirmed');
    assert.equal(record.refresh, '');
    assert.equal(record.refreshError, undefined);
  });
  test(`${family} unknown owner is not unlocked by another read, failure or displayed message`, t => {
    const actions = new ActionState();
    t.after(() => actions.clear());
    const intent = { key: `save:${resource}`, kind: 'configuration', resource, view, label: 'Saving', target: resource };
    const record = actions.begin(intent);
    actions.fail(record, Object.assign(new Error('Acceptance unknown'), { code: 'RESULT_UNKNOWN' }));
    const read = actions.begin({ key: `read:${resource}`, kind: 'read', view, label: 'Reading', target: resource });
    assert.ok(read);
    actions.fail(read, new Error('Read failed'));
    assert.strictEqual(actions.conflict(intent), record);
    assert.ok(actions.message(record).includes('Acceptance unknown'));
    actions.reviewed(undefined, ['configuration'], '/different-view');
    assert.equal(record.blocked, true);
    // Explicit successful original-view readback is the feature owner's decision.
    actions.reviewed(undefined, ['configuration'], view);
    assert.equal(record.blocked, false);
    assert.equal(actions.conflict(intent), undefined);
  });
  test(`${family} old readback completion cannot mutate a replacement identity ledger`, async t => {
    const actions = new ActionState();
    t.after(() => actions.clear());
    const intent = { key: `save:${resource}`, kind: 'configuration', resource, view, label: 'Saving', target: resource };
    const old = actions.begin(intent);
    actions.confirm(old, 'Original confirmed');
    const read = deferred();
    const refreshing = actions.refresh(old, () => read.promise);
    actions.clear();
    const current = actions.begin(intent);
    read.reject(new Error('Late original failure'));
    await refreshing;
    assert.strictEqual(actions.records.get(intent.key), current);
    assert.equal(current.pending, true);
    assert.equal(current.error, undefined);
    assert.equal(current.refresh, '');
    assert.equal(current.result, undefined);
    assert.equal(actions.current(old), false);
  });
}

test('About and Operation read owners retain local recovery without a mutation lock or invented task', t => {
  const actions = new ActionState();
  t.after(() => actions.clear());
  for (const view of ['/about', '/operations/operation-original']) {
    const record = actions.begin({ key: `read:${view}`, kind: 'read', view, target: view, label: 'Reading' });
    actions.fail(record, Object.assign(new Error('Original read unavailable'), { code: 'CORE_UNREACHABLE' }));
    assert.equal(record.blocked, false);
    assert.equal(record.errorCode, 'CORE_UNREACHABLE');
    assert.equal(record.kind, 'read');
    assert.equal(record.result, undefined);
  }
  assert.equal(actions.records.size, 2);
});

for (const scenario of [
  { name: 'known rejected write', kind: 'configuration', code: 'INVALID_REQUEST', phase: 'setup.state.failed', en: 'Failed', zh: '失败', blocked: false },
  { name: 'failed read', kind: 'read', code: 'CORE_UNREACHABLE', phase: 'action.readFailed', en: 'Read failed', zh: '读取失败', blocked: false },
  { name: 'invalid read response', kind: 'read', code: 'INVALID_RESPONSE', phase: 'action.readFailed', en: 'Read failed', zh: '读取失败', blocked: false },
  { name: 'unknown write', kind: 'configuration', code: 'RESULT_UNKNOWN', phase: 'common.notConfirmed', en: 'Not confirmed', zh: '尚未确认', blocked: true },
  { name: 'invalid write acknowledgement', kind: 'configuration', code: 'INVALID_RESPONSE', phase: 'common.notConfirmed', en: 'Not confirmed', zh: '尚未确认', blocked: true },
  { name: 'unknown Package acceptance with existing external intent lock', kind: 'configuration', code: 'ACCEPTANCE_UNKNOWN', phase: 'common.notConfirmed', en: 'Not confirmed', zh: '尚未确认', blocked: false },
  { name: 'unknown identity request with existing identity recovery owner', kind: 'identity', code: 'RESULT_UNKNOWN', phase: 'common.notConfirmed', en: 'Not confirmed', zh: '尚未确认', blocked: false },
]) {
  test(`${scenario.name}: localized phase distinguishes failure from uncertainty without changing admission`, async t => {
    const { chooseLocale } = await import(new URL('./locale.js', moduleURL));
    const actions = new ActionState();
    t.after(() => { actions.clear();
    chooseLocale('en'); });
    const unrelated = actions.begin({ key: 'unrelated', kind: 'configuration', view: '/other', label: 'Other action', target: 'Other object' });
    actions.fail(unrelated, Object.assign(new Error('Other unknown'), { code: 'RESULT_UNKNOWN' }));
    const record = actions.begin({ key: 'original', kind: scenario.kind, view: '/original', label: 'Original action', target: 'Original object' });
    const error = Object.assign(new Error('Original safe detail'), { code: scenario.code });
    actions.fail(record, error);
    assert.equal(record.phaseKey, scenario.phase);
    assert.equal(record.errorCode, scenario.code);
    assert.equal(record.error, 'Original safe detail');
    assert.equal(record.blocked, scenario.blocked);
    assert.equal(record.pending, false);
    for (const [locale, expected] of [['en', scenario.en], ['zh-CN', scenario.zh]]) {
      chooseLocale(locale);
      assert.ok(actions.message(record).includes(` · ${expected} · `));
      assert.ok(actions.message(record).includes('Original safe detail'));
      assert.equal(record.blocked, scenario.blocked);
      assert.equal(unrelated.blocked, true);
      assert.equal(unrelated.errorCode, 'RESULT_UNKNOWN');
    }
  });
}

test('retained action target renders its original localized title and unchanged raw account', async t => {
  const { chooseLocale, t: translate } = await import(new URL('./locale.js', moduleURL));
  const actions = new ActionState();
  t.after(() => { actions.clear();
  chooseLocale('en'); });
  chooseLocale('en');
  const rawAccount = 'Original USER 原账号';
  const record = actions.begin({ key: 'original-user', kind: 'configuration', label: 'Submitting', target: 'Original snapshot',
    targetText: () => `${translate('users.createUser')} · ${rawAccount}`, view: '/users' });
  actions.fail(record, Object.assign(new Error('Safe error'), { code: 'INVALID_REQUEST' }));
  assert.ok(actions.message(record).includes(`${translate('users.createUser')} · ${rawAccount}`));
  chooseLocale('zh-CN');
  assert.ok(actions.message(record).includes(`${translate('users.createUser')} · ${rawAccount}`));
  assert.equal(record.target, 'Original snapshot');
  assert.equal(record.blocked, false);
});
