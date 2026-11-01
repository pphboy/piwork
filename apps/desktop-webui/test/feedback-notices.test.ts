import assert from 'node:assert/strict';
import test from 'node:test';
const { actionNotice } = await import(new URL('../browser/feedback-notices.js', import.meta.url).href);

const record = {
  key: 'files:work-a:path:save', kind: 'files', work: 'work-a', action: 'save-file',
  label: 'Saving', target: 'file.txt', token: 7, generation: 2, started: 1,
  pending: false, phase: 'Unconfirmed', blocked: true, error: 'Connection lost', refresh: '',
};

test('notification uses the original task identity without owning its lock', () => {
  const frozen = Object.freeze({ ...record });
  const notice = actionNotice(frozen, 'identity-2', () => 'Unconfirmed');
  assert.equal(notice.tone, 'unknown');
  assert.equal(notice.object, 'work-a');
  assert.equal(notice.generation, '2:7');
  assert.equal(frozen.blocked, true);
});

test('background/plain reads and in-flight requests do not create result notices', () => {
  assert.equal(actionNotice({ ...record, pending: true }, 'identity-2', () => ''), undefined);
  assert.equal(actionNotice({ ...record, kind: 'read', error: undefined, blocked: false, result: 'Read' }, 'identity-2', () => ''), undefined);
});

test('confirmed write followed by failed refresh is an error, never a false write failure', () => {
  const notice = actionNotice({ ...record, blocked: false, error: undefined, result: 'Saved', refresh: 'failed' }, 'identity-2', () => 'Saved; current data unconfirmed');
  assert.equal(notice.tone, 'error');
  assert.equal(notice.message(), 'Saved; current data unconfirmed');
});

test('explicit feature toast prevents duplicate generic success; errors remain projected', () => {
  assert.equal(actionNotice({ ...record, blocked: false, error: undefined, result: 'Saved', successFeedback: 'toast' }, 'identity-2', () => ''), undefined);
  assert.equal(actionNotice({ ...record, successFeedback: 'toast' }, 'identity-2', () => '').tone, 'unknown');
});

test('language updates cannot change the deduplication key', () => {
  const first = actionNotice(record, 'identity-2', () => 'Unknown');
  const second = actionNotice({ ...record, error: '连接未确认' }, 'identity-2', () => '未确认');
  assert.equal(first.key, second.key);
});

test('successful exact read retires its failure, never a pending or unknown mutation', async () => {
  const { confirmedReadRecovery } = await import(new URL('../browser/feedback-notices.js', import.meta.url).href);
  const read = { ...record, kind: 'read', checkedAt: 'confirmed', blocked: false, error: undefined };
  assert.equal(confirmedReadRecovery(read), record.key);
  assert.equal(confirmedReadRecovery({ ...read, pending: true }), undefined);
  assert.equal(confirmedReadRecovery({ ...read, error: 'Still failed' }), undefined);
  assert.equal(confirmedReadRecovery({ ...read, kind: 'files', blocked: true }), undefined);
});

test('accepted progress owned by its original surface is not a completion notice', () => {
  const accepted = { ...record, blocked: false, error: undefined, result: 'Intent retained', successFeedback: 'owner' };
  assert.equal(actionNotice(accepted, 'identity-2', () => ''), undefined);
  assert.equal(actionNotice({ ...accepted, blocked: true }, 'identity-2', () => '').tone, 'unknown');
});

test('sign-in source ownership suppresses only the adopted unknown record, including after resolution', () => {
  const rejected = { ...record, action: 'sign-in', kind: 'identity', blocked: false, error: 'Known rejection' };
  assert.equal(actionNotice(rejected, 'identity-2', () => rejected.error).tone, 'error');
  const adopted = { ...rejected, notificationProjection: 'sign-in-owner' };
  assert.equal(actionNotice(adopted, 'identity-2', () => 'Original sign-in unconfirmed'), undefined);
  assert.equal(actionNotice({ ...adopted, error: undefined, result: 'Checked' }, 'identity-2', () => 'Checked'), undefined);
});

for (const action of ['send-message', 'retry-chat-submission', 'cancel-run']) {
  test(`Chat receipt ${action} belongs to its original Run/submission, but failure and unknown remain announced`, () => {
    const accepted = { ...record, action, kind: 'agent', blocked: false, error: undefined, result: 'Receipt accepted', successFeedback: 'owner' };
    assert.equal(actionNotice(accepted, 'identity-2', () => 'Receipt accepted'), undefined);
    assert.equal(actionNotice({ ...accepted, error: 'Readback failed' }, 'identity-2', () => 'Readback failed').tone, 'error');
    assert.equal(actionNotice({ ...accepted, blocked: true, error: 'Original submission unconfirmed' }, 'identity-2', () => 'Original submission unconfirmed').tone, 'unknown');
  });
}
