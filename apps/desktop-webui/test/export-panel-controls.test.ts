import assert from 'node:assert/strict';
import test from 'node:test';
const { saveExportFile } = await import(new URL('../browser/export-panel-controls.js', import.meta.url).href);

function fixture() {
  const calls: string[] = [];
  const snapshot = { id: 'snapshot-original', workId: 'work-original', status: 'verified', expiresAt: '2100-01-01T00:00:00Z' };
  const transfer = { snapshotId: snapshot.id, workId: snapshot.workId, transferId: 'transfer-original', ready: true };
  const port = {
    identityEpoch: 1,
    async fetchSnapshot(id: string) { calls.push(`snapshot:${id}`);
      return snapshot; },
    async checkTransfer(id: string) { calls.push(`transfer:${id}`);
      return transfer; },
    currentSnapshot: () => snapshot,
    currentTransfer: () => transfer,
    deliver(url: string, workId: string) { calls.push(`deliver:${workId}:${url}`); },
  };
  return { calls, snapshot, transfer, port };
}

test('manual save only reads original identities and hands off the verified original transfer', async () => {
  const f = fixture();
  const delivered = await saveExportFile(f.snapshot.id, f.port);
  assert.deepEqual(delivered, { snapshotId: f.snapshot.id, transferId: f.transfer.transferId, identityEpoch: 1 });
  assert.deepEqual(f.calls, [
    'snapshot:snapshot-original', 'transfer:snapshot-original',
    'deliver:work-original:/_desktop/api/downloads/transfer-original/content',
  ]);
});

for (const mismatch of ['snapshot', 'work', 'transfer', 'expiry', 'identity'] as const) {
  test(`manual save rejects ${mismatch} changes after original reads`, async () => {
    const f = fixture();
    f.port.checkTransfer = async () => {
      if (mismatch === 'snapshot') f.transfer.snapshotId = 'other-snapshot';
      if (mismatch === 'work') f.transfer.workId = 'other-work';
      if (mismatch === 'transfer') f.port.currentTransfer = () => ({ ...f.transfer });
      if (mismatch === 'expiry') f.snapshot.expiresAt = '2000-01-01T00:00:00Z';
      if (mismatch === 'identity') f.port.identityEpoch++;
      return f.transfer;
    };
    await assert.rejects(saveExportFile(f.snapshot.id, f.port));
    assert.equal(f.calls.some(call => call.startsWith('deliver:')), false);
  });
}

test('identity revoked while snapshot read is pending does not inspect or deliver a new identity transfer', async () => {
  const f = fixture();
  f.port.fetchSnapshot = async () => { f.port.identityEpoch++;
    return f.snapshot; };
  await assert.rejects(saveExportFile(f.snapshot.id, f.port));
  assert.deepEqual(f.calls, []);
});

test('a replaced snapshot object cannot supply manual delivery admission', async () => {
  const f = fixture();
  f.port.currentSnapshot = () => ({ ...f.snapshot });
  await assert.rejects(saveExportFile(f.snapshot.id, f.port));
  assert.equal(f.calls.some(call => call.startsWith('deliver:')), false);
});

test('a snapshot read for a different original ID is rejected before transfer lookup', async () => {
  const f = fixture();
  f.port.fetchSnapshot = async () => ({ ...f.snapshot, id: 'other-snapshot' });
  await assert.rejects(saveExportFile(f.snapshot.id, f.port));
  assert.deepEqual(f.calls, []);
});


test('failed browser handoff produces no successful delivery receipt', async () => {
  const f = fixture();
  f.port.deliver = () => { throw new Error('Browser handoff denied'); };
  let confirmed = false;
  await assert.rejects(saveExportFile(f.snapshot.id, f.port).then(() => { confirmed = true; }), /Browser handoff denied/);
  assert.equal(confirmed, false);
});
