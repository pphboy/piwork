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

test('actual catalog adapter lost response remains unknown and cannot enter known-failure restoration', async t => {
  const { ConsoleAdapter } = await import(new URL('adapter.js', root));
  const { ActionState } = await import(new URL('action-state.js', root));
  const originalFetch = globalThis.fetch;
  let writes = 0, restored = 0;
  globalThis.fetch = async () => { writes++;
  throw new Error('Synthetic response lost'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const adapter = new ConsoleAdapter(), actions = new ActionState();
  t.after(() => actions.clear());
  const record = actions.begin({ key: 'catalog-original', kind: 'configuration', view: '/skills/original', label: 'Disable', target: 'original' });
  let cause;
  try { await adapter.catalogAction('skills', 'original', 'disable'); } catch (error) { cause = error; }
  assert.equal(cause.code, 'RESULT_UNKNOWN');
  // The dialog owner must pass this original error, not new Error(cause.message).
  actions.fail(record, cause);
  assert.equal(record.errorCode, 'RESULT_UNKNOWN');
  assert.equal(record.blocked, true);
  const details = createKnownDialogRecovery({ identity: adapter.identityEpoch, view: record.view },
    () => ({ identity: adapter.identityEpoch, view: record.view, current: actions.current(record) && !record.blocked,
      failed: !record.pending && !!record.error && !record.result, otherDialog: false }),
    () => { restored++; }, () => assert.fail('Closed dialog'));
  details();
  assert.equal(restored, 0);
  assert.equal(writes, 1);
  assert.equal(record.blocked, true);
});
