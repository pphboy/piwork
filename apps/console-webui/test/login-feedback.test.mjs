import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
const root = process.env.PIWORK_CONSOLE_MODULE_DIR
  ? pathToFileURL(`${process.env.PIWORK_CONSOLE_MODULE_DIR}/`)
  : new URL('../dist/browser/', import.meta.url);
const { ActionState } = await import(new URL('action-state.js', root));
const { NoticeStore } = await import(new URL('notices.js', root));
const { retireConfirmedLoginFailure } = await import(new URL('login-feedback.js', root));
function fixture(t) {
  const actions = new ActionState();
  const notices = new NoticeStore();
  notices.setIdentity('identity-original');
  t.after(() => { actions.clear();
  notices.destroy(); });
  const record = actions.begin({ key: 'login', kind: 'identity', view: '/login', label: 'Sign in', target: 'Original account' });
  actions.fail(record, Object.assign(new Error('Original acceptance unknown'), { code: 'RESULT_UNKNOWN' }));
  const original = { record, account: 'original', notice: { identity: 'identity-original', object: '/login', task: 'login', generation: record.token } };
  notices.publish({ ...original.notice, key: 'failed', tone: 'unknown', message: () => record.error });
  const unrelated = actions.begin({ key: 'other', kind: 'configuration', view: '/runtime', label: 'Saving', target: 'Other object' });
  actions.fail(unrelated, Object.assign(new Error('Other unknown'), { code: 'RESULT_UNKNOWN' }));
  notices.publish({ identity: 'identity-original', object: '/runtime', task: 'other', generation: unrelated.token, key: 'unknown', tone: 'unknown', message: () => unrelated.error });
  const owners = {
    current: value => actions.current(value),
    retire: value => actions.records.delete(value.key),
    resolve: value => notices.resolve(value),
  };
  return { actions, notices, original, unrelated, owners };
}
for (const receipt of [{ authenticated: false, account: '' }, { authenticated: true, account: 'original' }]) {
  test(`${receipt.authenticated ? 'matched authenticated' : 'confirmed signed-out'} receipt retires only original login presentation`, t => {
    const f = fixture(t);
    assert.equal(retireConfirmedLoginFailure(f.original, receipt, f.owners), true);
    assert.equal(f.actions.current(f.original.record), false);
    assert.equal(f.original.record.errorCode, 'RESULT_UNKNOWN');
    assert.equal(f.actions.current(f.unrelated), true);
    assert.equal(f.unrelated.blocked, true);
    assert.equal(f.notices.items().length, 1);
    assert.equal(f.notices.items()[0].task, 'other');
    assert.equal(f.notices.items()[0].tone, 'unknown');
  });
}
test('mismatched account and absence of a successful read leave unknown presentation intact', t => {
  const f = fixture(t);
  // A failed session request supplies no receipt and never calls the projection helper.
  assert.equal(f.actions.current(f.original.record), true);
  assert.equal(f.notices.items().length, 2);
  assert.equal(retireConfirmedLoginFailure(f.original, { authenticated: true, account: 'different' }, f.owners), false);
  assert.equal(f.actions.current(f.original.record), true);
  assert.equal(f.notices.items().length, 2);
  assert.equal(f.unrelated.blocked, true);
});
test('late old signed-out proof cannot remove a newer login generation or its notice', t => {
  const f = fixture(t);
  const newer = f.actions.begin({ key: 'login', kind: 'identity', view: '/login', label: 'Sign in again', target: 'New account' });
  assert.ok(newer);
  f.actions.fail(newer, Object.assign(new Error('New unknown'), { code: 'RESULT_UNKNOWN' }));
  f.notices.publish({ ...f.original.notice, generation: newer.token, key: 'new-failed', tone: 'unknown', message: () => newer.error });
  assert.equal(retireConfirmedLoginFailure(f.original, { authenticated: false, account: '' }, f.owners), false);
  assert.equal(f.actions.current(newer), true);
  assert.ok(f.notices.items().some(item => item.generation === newer.token && item.task === 'login'));
  assert.equal(f.unrelated.blocked, true);
});
test('a known rejection or non-login action is never retired by this login-only projection', t => {
  const f = fixture(t);
  f.original.record.errorCode = 'AUTHENTICATION_FAILED';
  assert.equal(retireConfirmedLoginFailure(f.original, { authenticated: false, account: '' }, f.owners), false);
  assert.equal(f.actions.current(f.original.record), true);
  assert.equal(retireConfirmedLoginFailure({ ...f.original, record: f.unrelated }, { authenticated: false, account: '' }, f.owners), false);
  assert.equal(f.actions.current(f.unrelated), true);
});

test('unknown logout keeps the actual transport classification and lazy uncertainty copy', async t => {
  const { ConsoleError } = await import(new URL('adapter.js', root));
  const { LocalizedMessage, chooseLocale, t: translate } = await import(new URL('locale.js', root));
  const { signOutFailure } = await import(new URL('login-feedback.js', root));
  t.after(() => chooseLocale('en'));
  for (const code of ['RESULT_UNKNOWN', 'INVALID_RESPONSE']) {
    const original = new ConsoleError(code, new LocalizedMessage('adapter.error.resultUnknown'));
    const result = signOutFailure(original);
    assert.strictEqual(result, original);
    for (const locale of ['en', 'zh-CN']) {
      chooseLocale(locale);
      assert.equal(result.code, code);
      assert.equal(result.message, translate('adapter.error.resultUnknown'));
      assert.notEqual(result.message, translate('login.signOutFailed'));
    }
  }
});
test('known logout rejection retains failed classification and localizes without claiming uncertainty', async t => {
  const { ConsoleError } = await import(new URL('adapter.js', root));
  const { chooseLocale, t: translate } = await import(new URL('locale.js', root));
  const { signOutFailure } = await import(new URL('login-feedback.js', root));
  const result = signOutFailure(new ConsoleError('INVALID_REQUEST', 'Known rejection'));
  t.after(() => chooseLocale('en'));
  for (const locale of ['en', 'zh-CN']) {
    chooseLocale(locale);
    assert.equal(result.code, 'SIGNOUT_FAILED');
    assert.equal(result.message, translate('login.signOutFailed'));
  }
});

test('confirmed new sign-in retires only original no-session guidance, preserving other unknown results', async t => {
  const { retireLoginReadbackInfo } = await import(new URL('login-feedback.js', root));
  const f = fixture(t);
  const owner = { identity: 'identity-original', object: '/login', task: 'login-readback-info', generation: 1 };
  f.notices.publish({ ...owner, key: 'signed-out', tone: 'warning', message: () => 'No signed-in session' });
  const resolve = value => f.notices.resolve(value);
  assert.equal(retireLoginReadbackInfo(owner, { authenticated: false, account: '' }, resolve), false);
  assert.equal(f.notices.items().length, 3);
  assert.equal(retireLoginReadbackInfo(owner, { authenticated: true, account: '' }, resolve), false);
  assert.equal(f.notices.items().length, 3);
  assert.equal(retireLoginReadbackInfo(owner, { authenticated: true, account: 'new-successful-account' }, resolve), true);
  assert.equal(f.notices.items().length, 2);
  assert.ok(f.notices.items().every(item => item.tone === 'unknown'));
  assert.equal(f.actions.current(f.unrelated), true);
  assert.equal(f.unrelated.blocked, true);
});

test('new successful same-context login retires earlier rate-limit notice without removing a newer record or unrelated unknown', async t => {
  const { retirePreviousLoginFailure } = await import(new URL('login-feedback.js', root));
  const f = fixture(t);
  f.original.record.errorCode = 'RATE_LIMITED';
  const newer = f.actions.begin({ key: 'login', kind: 'identity', label: 'Sign in', target: 'original', view: '/login' });
  const resolve = owner => f.notices.resolve(owner);
  const receipt = { authenticated: true, account: 'original', identity: 'identity-original' };
  assert.equal(retirePreviousLoginFailure(f.original, { ...receipt, authenticated: false }, resolve), false);
  assert.equal(retirePreviousLoginFailure(f.original, { ...receipt, account: 'other' }, resolve), false);
  assert.equal(retirePreviousLoginFailure(f.original, { ...receipt, identity: 'new-identity' }, resolve), false);
  assert.equal(f.notices.items().length, 2);
  assert.equal(retirePreviousLoginFailure(f.original, receipt, resolve), true);
  assert.equal(f.notices.items().length, 1);
  assert.equal(f.notices.items()[0].task, 'other');
  assert.equal(f.actions.current(newer), true);
  assert.equal(f.unrelated.blocked, true);
});
