import test from 'node:test';
import assert from 'node:assert/strict';
const { exportWorkConflict, exportSnapshotAvailable } = await import(new URL('../browser/export-admission.js', import.meta.url).href);
const record = (overrides: Record<string, unknown> = {}) => ({ work: 'one', kind: 'lifecycle', pending: true, ...overrides });
test('export admission blocks pending and unknown original Work controls', () => {
  const pending = record(); assert.equal(exportWorkConflict([pending], 'one'), pending);
  const unknown = record({ pending: false, blocked: true }); assert.equal(exportWorkConflict([unknown], 'one'), unknown);
});
test('export admission ignores other Works, reads and confirmed controls', () => {
  assert.equal(exportWorkConflict([record({ work: 'two' }), record({ kind: 'read' }), record({ pending: false })], 'one'), undefined);
});
test('combined export may own its original Stop record without ignoring a different control', () => {
  const own = record({ businessId: 'export-1' }), other = record({ businessId: 'start-1' });
  assert.equal(exportWorkConflict([own], 'one', 'export-1'), undefined);
  assert.equal(exportWorkConflict([own, other], 'one', 'export-1'), other);
  assert.equal(exportWorkConflict([record({ businessId: undefined })], 'one')?.work, 'one');
});
test('manual content admission rechecks the actual original expiry after a deferred read', () => {
  const snapshot = { status: 'verified', expiresAt: '2026-10-13T00:00:01Z' };
  assert.equal(exportSnapshotAvailable(snapshot, Date.parse('2026-10-13T00:00:00Z')), true);
  assert.equal(exportSnapshotAvailable(snapshot, Date.parse('2026-10-13T00:00:02Z')), false);
});
test('manual content admission refuses unavailable, expired and invalid expiry facts', () => {
  for (const status of ['preparing', 'failed', 'unavailable', 'expired']) assert.equal(exportSnapshotAvailable({ status }), false);
  assert.equal(exportSnapshotAvailable({ status: 'verified', expiresAt: 'invalid' }), false);
  assert.equal(exportSnapshotAvailable({ status: 'verified' }), true);
});
