import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore } from "@piwork/core-store";
import { collectSnapshotGarbage } from "./gc.js";

const OWNER = "owner-000000000001", PACKAGE = "package-000000000001", EARLY = "2026-09-23T00:00:00.000Z", LATE = "2026-09-24T00:00:00.000Z";
test("ready package TTL respects an active transfer lease, then deletes bytes but retains expired owner tombstone", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-gc-")), snapshotsDirectory = join(root, "snapshots"), packageDirectory = join(snapshotsDirectory, "packages");
  mkdirSync(packageDirectory, { recursive: true });
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  try {
    store.createManagedUser({ id: OWNER, account: "owner", passwordDigest: "password", role: "user", enabled: true, createdAt: EARLY, updatedAt: EARLY });
    store.snapshots.insertPackage({ id: PACKAGE, ownerUserId: OWNER, digest: "a".repeat(64), size: 4, state: "ready", jobId: null,
      createdAt: EARLY, readyAt: EARLY, expiresAt: LATE });
    writeFileSync(join(packageDirectory, `${PACKAGE}.work`), "data");
    store.snapshots.acceptTransfer({ id: "transfer-000000000001", ownerUserId: OWNER, packageId: PACKAGE, snapshotId: null,
      kind: "download", phase: "streaming", deadlineAt: "2026-09-25T00:00:00.000Z", lastProgressAt: EARLY, helperId: null, createdAt: EARLY });
    const runtime = { async removeSnapshotHelper() {} };
    await collectSnapshotGarbage({ store, runtime, snapshotsDirectory, now: () => new Date("2026-09-24T01:00:00.000Z") });
    assert.equal(store.snapshots.getPackage(PACKAGE)?.state, "ready");
    assert.equal(existsSync(join(packageDirectory, `${PACKAGE}.work`)), true);
    store.snapshots.finishTransfer("transfer-000000000001");
    const result = await collectSnapshotGarbage({ store, runtime, snapshotsDirectory, now: () => new Date("2026-09-24T01:00:00.000Z") });
    assert.equal(result.packages, 1);
    assert.equal(store.snapshots.getPackage(PACKAGE)?.state, "expired");
    assert.equal(existsSync(join(packageDirectory, `${PACKAGE}.work`)), false);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("expired upload removes only its journalled helper, spool and staging package", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-gc-upload-")), snapshotsDirectory = join(root, "snapshots");
  const packageDirectory = join(snapshotsDirectory, "packages"), transferDirectory = join(snapshotsDirectory, "transfers", "transfer-upload-000001");
  mkdirSync(packageDirectory, { recursive: true }); mkdirSync(transferDirectory, { recursive: true });
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  try {
    store.createManagedUser({ id: OWNER, account: "owner", passwordDigest: "password", role: "user", enabled: true, createdAt: EARLY, updatedAt: EARLY });
    store.snapshots.acceptTransfer({ id: "transfer-upload-000001", ownerUserId: OWNER, packageId: PACKAGE, snapshotId: null,
      kind: "upload", phase: "verifying", deadlineAt: "2026-09-23T00:30:00.000Z", lastProgressAt: EARLY,
      helperId: "snapshot-upload-transfer-upload-000001", createdAt: EARLY },
    { id: PACKAGE, ownerUserId: OWNER, digest: null, size: 0, state: "staging", jobId: null,
      createdAt: EARLY, readyAt: null, expiresAt: null });
    writeFileSync(join(transferDirectory, "package.work"), "incomplete");
    writeFileSync(join(packageDirectory, `${PACKAGE}.work`), "incomplete");
    writeFileSync(join(packageDirectory, "unrelated.work"), "keep");
    let removed = 0;
    const result = await collectSnapshotGarbage({ store, snapshotsDirectory, now: () => new Date(LATE),
      runtime: { async removeSnapshotHelper(name, jobId) {
        assert.equal(name, "snapshot-upload-transfer-upload-000001"); assert.equal(jobId, "transfer-upload-000001"); removed++;
      } } });
    assert.equal(result.transfers, 1); assert.equal(removed, 1);
    assert.equal(store.snapshots.getTransfer("transfer-upload-000001"), undefined);
    assert.equal(store.snapshots.getPackage(PACKAGE)?.state, "expired");
    assert.equal(existsSync(transferDirectory), false);
    assert.equal(existsSync(join(packageDirectory, `${PACKAGE}.work`)), false);
    assert.equal(existsSync(join(packageDirectory, "unrelated.work")), true);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
