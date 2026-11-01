import assert from 'node:assert/strict';
import test from 'node:test';
import { captureViewGuard } from '../src/view-scope.ts';

test('the shared Console callback guard rejects changed route, load, dialog and identity independently', () => {
  const original = { path: '/users', load: 3, identity: 4, dialog: {} };
  for (const changed of [
    { path: '/about' }, { load: 4 }, { identity: 5 }, { dialog: {} },
  ]) {
    let current = original;
    const valid = captureViewGuard(() => current);
    assert.equal(valid(), true);
    current = { ...original, ...changed };
    assert.equal(valid(), false);
  }
});

test('capture snapshots a mutable fact object and never mutates the current owner', () => {
  const current = { path: '/packages', load: 3, identity: 4, dialog: null };
  const valid = captureViewGuard(() => current);
  current.load++;
  assert.equal(valid(), false);
  assert.deepEqual(current, { path: '/packages', load: 4, identity: 4, dialog: null });
});

test('explicit identity or dialog exemptions do not relax route/load admission', () => {
  let current = { path: '/users', load: 3, identity: 4, dialog: {} };
  const identity = captureViewGuard(() => current, { allowIdentityChange: true });
  const dialog = captureViewGuard(() => current, { includeDialog: false });
  const both = captureViewGuard(() => current, { allowIdentityChange: true, includeDialog: false });
  current = { ...current, identity: 5 };
  assert.equal(identity(), true);
  assert.equal(dialog(), false);
  current = { ...current, dialog: null };
  assert.equal(identity(), false);
  assert.equal(both(), true);
  current = { ...current, load: 4 };
  assert.equal(both(), false);
});

test('late results are not applied to a newer editable draft', async () => {
  let current = { path: '/default-work', load: 3, identity: 4, dialog: null };
  let draft = 'original';
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const valid = captureViewGuard(() => current);
  const applying = pending.then(value => { if (valid()) draft = value; });
  current = { ...current, load: 4 };
  draft = 'newer edit';
  release('late original read');
  await applying;
  assert.equal(draft, 'newer edit');
});
