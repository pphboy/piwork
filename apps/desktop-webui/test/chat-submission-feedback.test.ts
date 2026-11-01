import assert from 'node:assert/strict';
import test from 'node:test';
const { acceptedChatSubmissionOwns } = await import(new URL('../browser/chat-submission-feedback.js', import.meta.url).href);
const { ActionState } = await import(new URL('../browser/action-state.js', import.meta.url).href);
const { NoticeStore } = await import(new URL('../browser/notices.js', import.meta.url).href);
const { actionNotice } = await import(new URL('../browser/feedback-notices.js', import.meta.url).href);
const original = { work: 'work', key: 'original-key', kind: 'run', sessionId: 'session' };
const record = { blocked: true, pending: false, kind: 'agent', work: 'work', action: 'send-message', businessId: 'submission:original-key' };
const receipt = { kind: 'run', key: 'original-key', status: 'accepted', run: { workId: 'work', sessionId: 'session', submissionKey: 'original-key', runId: 'run' } };
test('accepted original Run receipt owns only its exact unknown action', () => {
  assert.equal(acceptedChatSubmissionOwns(record, original, receipt), true);
  for (const change of [{ businessId: 'submission:newer' }, { work: 'other' }, { pending: true }, { blocked: false }, { kind: 'read' }, { action: 'cancel-run' }]) {
    assert.equal(acceptedChatSubmissionOwns({ ...record, ...change }, original, receipt), false);
  }
});
test('not-found, partial or mismatched read receipts cannot release unknown', () => {
  for (const value of [undefined, { ...receipt, status: 'not-found' }, { ...receipt, key: 'other' }, { ...receipt, kind: 'session' },
    ...[{ workId: 'other' }, { sessionId: 'other' }, { submissionKey: 'other' }, { runId: '' }].map(change => ({ ...receipt, run: { ...receipt.run, ...change } }))]) {
    assert.equal(acceptedChatSubmissionOwns(record, original, value), false);
  }
});
test('session recovery also requires an exact captured intent and owned session receipt', () => {
  const session = { ...original, kind: 'session', sessionId: undefined };
  const value = { kind: 'session', key: original.key, status: 'accepted', session: { workId: 'work', sessionId: 'new-session' } };
  assert.equal(acceptedChatSubmissionOwns({ ...record, action: 'new-session' }, session, value), true);
  assert.equal(acceptedChatSubmissionOwns({ ...record, businessId: undefined }, session, value), false);
  assert.equal(acceptedChatSubmissionOwns(record, session, { ...value, session: { workId: 'other', sessionId: 'new-session' } }), false);
});
test('exact adoption suppresses old failure presentation without releasing another unknown record', t => {
  const actions = new ActionState();
  t.after(() => actions.clear());
  const first = actions.begin({ key: 'first', kind: 'agent', work: 'work', action: 'send-message', label: 'Send', target: 'Work' });
  first.businessId = record.businessId;
  actions.fail(first, Object.assign(new Error('Original transport unknown'), { code: 'RESULT_UNKNOWN' }));
  const other = actions.begin({ key: 'other', kind: 'agent', work: 'other', action: 'send-message', label: 'Send', target: 'Other' });
  actions.fail(other, Object.assign(new Error('Other unknown'), { code: 'RESULT_UNKNOWN' }));
  assert.equal(acceptedChatSubmissionOwns(first, original, receipt), true);
  const notices = new NoticeStore();
  notices.setIdentity('identity');
  t.after(() => notices.destroy());
  const originalNotice = actionNotice(first, 'identity', () => 'error');
  notices.publish(originalNotice);
  notices.publish(actionNotice(other, 'identity', () => 'other error'));
  assert.equal(notices.items().length, 2);
  notices.resolve(originalNotice);
  assert.equal(notices.items().length, 1);
  assert.equal(notices.items()[0].message(), 'other error');
  first.notificationProjection = 'chat-submission-owner';
  actions.review(first);
  assert.equal(actionNotice(first, 'identity', () => 'error'), undefined);
  assert.equal(first.blocked, false);
  assert.equal(other.blocked, true);
  assert.equal(first.error, 'Original transport unknown');
  actions.clear();
  assert.equal(actions.current(first), false);
});
