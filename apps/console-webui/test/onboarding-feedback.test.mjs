import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
const root = process.env.PIWORK_CONSOLE_MODULE_DIR
  ? pathToFileURL(`${process.env.PIWORK_CONSOLE_MODULE_DIR}/`)
  : new URL('../dist/browser/', import.meta.url);
const { onboardingNoticeMessage } = await import(new URL('onboarding-feedback.js', root));
const { chooseLocale, LocalizedMessage, t: translate } = await import(new URL('locale.js', root));
const { NoticeStore } = await import(new URL('notices.js', root));
const { resultNotice, readFailureNotice } = await import(new URL('feedback-policy.js', root));
for (const kind of ['administrator', 'login']) test(`${kind} result and associated read failure stay source-distinct and lazy in EN/ZH`, t => {
  t.after(() => chooseLocale('en'));
  const credential = { kind, account: 'Original 原账号' };
  const text = new LocalizedMessage('net.requestFailed');
  const writeMessage = onboardingNoticeMessage(text, { task: 'credential', credential });
  const readMessage = onboardingNoticeMessage(text, { task: 'read', credential });
  credential.account = 'Different account';
  for (const locale of ['en', 'zh-CN']) {
    chooseLocale(locale);
    assert.equal(writeMessage(), translate(kind === 'administrator' ? 'onboarding.notice.administratorUnknown' : 'onboarding.notice.loginUnknown', { account: 'Original 原账号', message: translate('net.requestFailed') }));
    assert.equal(readMessage(), translate('onboarding.notice.readFailed', { message: translate('net.requestFailed') }));
    assert.notEqual(writeMessage(), readMessage());
    assert.ok(!writeMessage().includes('Different account'));
  }
});
test('source labels preserve independent notice owners, read resolution and credential recovery', () => {
  const store = new NoticeStore();
  store.setIdentity('original');
  const owner = { identity: 'original', object: 'onboarding', task: 'credential', generation: 1 };
  const readOwner = { ...owner, task: 'read', generation: 0 };
  const credential = { kind: 'login', account: 'original-account' };
  let reads = 0;
  const recovery = { label: () => 'Read state', run: () => { reads++; } };
  const text = new LocalizedMessage('net.requestFailed');
  store.publish(resultNotice(owner, { phase: 'unknown', unknown: true, message: onboardingNoticeMessage(text, { task: 'credential', credential }), recovery }));
  store.publish(readFailureNotice(readOwner, 'READ_FAILED', onboardingNoticeMessage(text, { task: 'read', credential }), recovery));
  assert.equal(store.items().length, 2);
  store.resolve(readOwner);
  assert.equal(store.items().length, 1);
  assert.equal(store.items()[0].tone, 'unknown');
  store.items()[0].recovery.run();
  assert.equal(reads, 1);
  store.resolve(owner);
  assert.equal(store.items().length, 0);
  store.destroy();
});
test('ordinary credential and logout feedback retain existing text without invented source facts', () => {
  const text = new LocalizedMessage('net.requestFailed');
  assert.equal(onboardingNoticeMessage(text, { task: 'credential' })(), translate('net.requestFailed'));
});
