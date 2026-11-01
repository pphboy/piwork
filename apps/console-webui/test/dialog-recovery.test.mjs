import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
const root = process.env.PIWORK_CONSOLE_MODULE_DIR
  ? pathToFileURL(`${process.env.PIWORK_CONSOLE_MODULE_DIR}/`)
  : new URL('../dist/browser/', import.meta.url);
const { createKnownDialogRecovery, safePackageRecoverySource } = await import(new URL('dialog-recovery.js', root));

test('known rejected dialog recovery admits only original record, route and identity', () => {
  const facts = { identity: 2, view: '/users', current: true, failed: true, otherDialog: false };
  let restores = 0, focuses = 0;
  const restore = createKnownDialogRecovery({ identity: 2, view: '/users' }, () => facts,
    () => { restores++; }, () => { focuses++; });
  assert.equal(restores, 0);
  for (const patch of [{ identity: 3 }, { view: '/skills' }, { current: false }, { failed: false }]) {
    Object.assign(facts, { identity: 2, view: '/users', current: true, failed: true }, patch);
    restore();
    assert.equal(restores, 0);
  }
  Object.assign(facts, { identity: 2, view: '/users', current: true, failed: true, otherDialog: true });
  restore();
  assert.equal(focuses, 1);
  assert.equal(restores, 0);
  facts.otherDialog = false;
  restore();
  assert.equal(restores, 1);
});
test('recovery admission snapshots owner scalars rather than following changed identity input', () => {
  const original = { identity: 1, view: '/packages' };
  let restores = 0;
  const restore = createKnownDialogRecovery(original,
    () => ({ identity: 1, view: '/packages', current: true, failed: true, otherDialog: false }),
    () => { restores++; }, () => assert.fail('No other dialog'));
  original.identity = 99;
  original.view = '/users';
  restore();
  assert.equal(restores, 1);
});
test('only canonical plain npm package and numeric semantic version are retained', () => {
  for (const value of ['fixture-package@1.0.0', '@fixture/package@0.2.10']) assert.equal(safePackageRecoverySource('npm', value), value);
  for (const value of ['fixture@latest', 'fixture@^1.0.0', 'fixture@1.0.0-secret', 'https://token@example.invalid/pkg', 'https://user:secret@example.invalid/pkg', 'https://example.invalid/pkg?token=secret', 'git+ssh://token@example.invalid/pkg', 'fixture@1.0.0\n', '/private/file.tgz', 'file:secret', 'fixture@01.0.0']) assert.equal(safePackageRecoverySource('npm', value), '');
  for (const kind of ['Git', 'ZIP', 'Local directory']) assert.equal(safePackageRecoverySource(kind, 'fixture-package@1.0.0'), '');
});

test('pending or successful records cannot restore a failed context despite matching owner', () => {
  for (const state of ['pending', 'success']) {
    let restored = false;
    const recover = createKnownDialogRecovery({ identity: 1, view: '/users' },
      () => ({ identity: 1, view: '/users', current: true, failed: false, otherDialog: false }),
      () => { restored = true; }, () => assert.fail('No other dialog'));
    recover();
    assert.equal(restored, false, state);
  }
});
