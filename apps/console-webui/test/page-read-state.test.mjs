import assert from 'node:assert/strict';
import test from 'node:test';
import { PageReadState } from '../dist/browser/page-read-state.js';

const scope = { path: '/users', view: 3, identity: 7 };
test('first failure and bounded retries never establish confirmed empty data', () => {
  const owner = new PageReadState();
  owner.begin(scope);
  assert.deepEqual(owner.snapshot(scope), { status: 'loading' });
  // Re-rendering the shell before a receipt cannot confirm default arrays.
  owner.begin(scope);
  assert.deepEqual(owner.snapshot(scope), { status: 'loading' });
  const error = new Error('503');
  for (let attempt = 0; attempt < 3; attempt++) {
    owner.fail(scope, error);
    owner.begin(scope);
    assert.deepEqual(owner.snapshot(scope), { status: 'unavailable', error });
  }
  // Locale-only projections read the same receipt, not shell existence or [] defaults.
  assert.equal(owner.snapshot(scope).status, 'unavailable');
});
test('validated successful empty data confirms and failed refresh retains its timestamp', () => {
  const owner = new PageReadState();
  owner.begin(scope);
  owner.confirm(scope, 'confirmed-at');
  owner.begin(scope);
  owner.fail(scope, new Error('503'));
  assert.deepEqual(owner.snapshot(scope), { status: 'confirmed', confirmedAt: 'confirmed-at' });
});
test('route, identity and new view cannot borrow confirmation or accept old receipts', () => {
  for (const change of [{ path: '/skills' }, { identity: 8 }, { view: 4 }]) {
    const owner = new PageReadState();
    owner.begin(scope);
    owner.confirm(scope, 'old');
    const next = { ...scope, ...change };
    owner.begin(next);
    owner.confirm(scope, 'late');
    owner.fail(scope, new Error('late'));
    assert.deepEqual(owner.snapshot(next), { status: 'loading' });
    assert.equal(owner.snapshot(scope), null);
    owner.confirm(next, 'new');
    assert.deepEqual(owner.snapshot(next), { status: 'confirmed', confirmedAt: 'new' });
  }
});
