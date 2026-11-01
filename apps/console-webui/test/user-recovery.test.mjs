import assert from 'node:assert/strict';
import test from 'node:test';
import { createUserRecovery } from '../src/user-recovery.ts';
import { requiresOwnedRecovery } from '../src/feedback-policy.ts';

test('original failed-user recovery retains only copied account/role and never credentials or a write', () => {
  const draft = { account: 'original account', role: 'Administrator', password: 'must-not-survive', confirmPassword: 'must-not-survive' };
  const restored = [];
  const recover = createUserRecovery(draft, { identity: 2, view: '/users' },
    () => ({ identity: 2, view: '/users', current: true, otherDialog: false }),
    safe => restored.push(safe), () => assert.fail('No other dialog'));
  draft.account = 'new unrelated draft';
  assert.deepEqual(restored, []);
  recover();
  assert.deepEqual(restored, [{ account: 'original account', role: 'Administrator' }]);
  assert.equal(Object.isFrozen(restored[0]), true);
  assert.ok(!JSON.stringify(restored).includes('must-not-survive'));
});

test('original user failure cannot restore after identity/view change or record replacement', () => {
  for (const change of [{ identity: 3 }, { view: '/models' }, { current: false }]) {
    const facts = { identity: 2, view: '/users', current: true, otherDialog: false, ...change };
    const recover = createUserRecovery({ account: 'original', role: 'User' }, { identity: 2, view: '/users' },
      () => facts, () => assert.fail('Stale recovery reopened'), () => assert.fail('Stale recovery focused'));
    recover();
  }
});

test('Details never replaces another open fresh form or changes its draft', () => {
  const fresh = { account: 'new draft', password: 'new secret' };
  let focused = 0;
  const recover = createUserRecovery({ account: 'original', role: 'User' }, { identity: 2, view: '/users' },
    () => ({ identity: 2, view: '/users', current: true, otherDialog: true }),
    () => assert.fail('Existing form overwritten'), () => { focused++; });
  recover();
  assert.equal(focused, 1);
  assert.deepEqual(fresh, { account: 'new draft', password: 'new secret' });
});

test('only an explicitly restorable detached known failure omits the duplicate page region', () => {
  assert.equal(requiresOwnedRecovery({ error: true, restorableDetached: true }), false);
  assert.equal(requiresOwnedRecovery({ error: true }), true);
  assert.equal(requiresOwnedRecovery({ error: true, restorableDetached: false }), true);
  assert.equal(requiresOwnedRecovery({ unknown: true, error: true, restorableDetached: true }), true);
  assert.equal(requiresOwnedRecovery({ refreshFailed: true, error: true, restorableDetached: true }), true);
});
