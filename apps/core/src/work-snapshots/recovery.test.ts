import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore } from "@piwork/core-store";
import { WorkContextStore } from "../configuration/work-context.js";
import { recoverSnapshotJobs } from "./recovery.js";

const NOW = "2026-09-23T00:00:00.000Z", OWNER = "owner-000000000001", WORK = "work-target-00000001";
function fixture(volumeState: "planned" | "created" | "ready" | null = "created", withContext = false) {
  const root = mkdtempSync(join(tmpdir(), "piwork-recovery-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") }), contexts = new WorkContextStore(join(root, "contexts"));
  store.createManagedUser({ id: OWNER, account: "owner", passwordDigest: "password", role: "user", enabled: true, createdAt: NOW, updatedAt: NOW });
  store.snapshots.insertPackage({ id: "package-000000000001", ownerUserId: OWNER, digest: "a".repeat(64), size: 1, state: "ready", jobId: null,
    createdAt: NOW, readyAt: NOW, expiresAt: "2026-09-24T00:00:00.000Z" });
  const accepted = store.snapshots.accept({ principalId: OWNER, workScope: "work-imports", operationKind: "import-work", idempotencyKey: "key",
    requestDigest: "b".repeat(64), requestJson: "{}", targetVersion: 1, now: NOW }, (tx) => {
    store.snapshots.insertJob({ operationId: tx.operationId, ownerUserId: OWNER, kind: "import", sourceWorkId: null, targetWorkId: WORK,
      snapshotId: null, packageId: "package-000000000001", name: "copied", requestDigest: "b".repeat(64), phase: "restoring",
      deadlineAt: "2026-09-23T00:30:00.000Z", workerEpoch: 1, createdAt: NOW, updatedAt: NOW, cleanupError: null });
    store.snapshots.reserveName({ ownerUserId: OWNER, name: "copied", operationId: tx.operationId });
    store.snapshots.insertArtifact({ operationId: tx.operationId, artifactKey: "identity-map", kind: "identity-map",
      logicalId: JSON.stringify({ workId: WORK, contexts: withContext ? [{ id: "context-target-000001" }] : [], services: [], operations: [] }), state: "ready" }, 1);
    if (volumeState !== null) store.snapshots.insertArtifact({ operationId: tx.operationId, artifactKey: "volume-workspace", kind: "volume",
      logicalId: JSON.stringify({ logicalId: "work-workspace" }), state: volumeState }, 1);
    tx.run(`INSERT INTO quota_reservations VALUES (?, 'import', 'import', 500, 1000, 0, 0, 0, 2, ?)`, WORK, NOW);
    return { resourceId: WORK };
  });
  return { root, store, contexts, operationId: accepted.operationId,
    close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("startup fences an interrupted import before deleting only journal-owned volume and releasing holds", async () => {
  const f = fixture(); let deletes = 0;
  try {
    const result = await recoverSnapshotJobs({ store: f.store, contexts: f.contexts, snapshotsDirectory: join(f.root, "snapshots"), now: () => new Date(NOW),
      runtime: { async removeSnapshotHelper() {}, async deleteManagedVolume(workId, logicalId) { assert.equal(workId, WORK); assert.equal(logicalId, "work-workspace"); deletes++; } } });
    assert.deepEqual(result, { cleaned: 1, pending: 0 }); assert.equal(deletes, 1);
    assert.equal(f.store.getWork(WORK), undefined);
    assert.equal(f.store.getQuotaReservation(WORK, "import", "import"), undefined);
    assert.equal(f.store.snapshots.getName(OWNER, "copied"), undefined);
    assert.equal(f.store.snapshots.getJob(f.operationId)?.phase, "cleaned");
    assert.equal(f.store.getOperation(f.operationId)?.state, "failed");
  } finally { f.close(); }
});

test("startup interrupts accepted import before any artifacts exist and replay cannot publish a duplicate", async () => {
  const f = fixture(null); let deletes = 0;
  try {
    const runtime = { async removeSnapshotHelper() {}, async deleteManagedVolume() { deletes++; } };
    assert.deepEqual(await recoverSnapshotJobs({ store: f.store, contexts: f.contexts, runtime,
      snapshotsDirectory: join(f.root, "snapshots") }), { cleaned: 1, pending: 0 });
    assert.equal(deletes, 0);
    assert.equal(f.store.getOperation(f.operationId)?.state, "failed");
    assert.equal(f.store.getWork(WORK), undefined);
    assert.deepEqual(await recoverSnapshotJobs({ store: f.store, contexts: f.contexts, runtime,
      snapshotsDirectory: join(f.root, "snapshots") }), { cleaned: 0, pending: 0 });
    assert.equal(f.store.listWorks().length, 0);
  } finally { f.close(); }
});

test("startup cleans image, ready volume, helper and materialized context stages without starting a Work", async () => {
  const f = fixture("ready", true), contextPath = join(f.contexts.rootDirectory, WORK, "contexts", "context-target-000001");
  const removed: string[] = [];
  try {
    mkdirSync(contextPath, { recursive: true });
    f.store.snapshots.insertArtifact({ operationId: f.operationId, artifactKey: "image-i-000001", kind: "image",
      logicalId: `sha256:${"a".repeat(64)}`, state: "ready" }, 1);
    f.store.snapshots.insertArtifact({ operationId: f.operationId, artifactKey: "helper-restore", kind: "helper",
      logicalId: "snapshot-helper-restore", state: "planned" }, 1);
    f.store.snapshots.insertArtifact({ operationId: f.operationId, artifactKey: "context-c-000001", kind: "context",
      logicalId: "context-target-000001", state: "ready" }, 1);
    const result = await recoverSnapshotJobs({ store: f.store, contexts: f.contexts, snapshotsDirectory: join(f.root, "snapshots"),
      runtime: { async removeSnapshotHelper(name) { removed.push(name); }, async deleteManagedVolume(workId, logicalId) {
        assert.equal(workId, WORK); removed.push(logicalId);
      } } });
    assert.deepEqual(result, { cleaned: 1, pending: 0 });
    assert.deepEqual(removed, ["snapshot-helper-restore", "work-workspace"]);
    assert.equal(existsSync(contextPath), false);
    assert.equal(f.store.getWork(WORK), undefined);
    assert.equal(f.store.getOperation(f.operationId)?.state, "failed");
  } finally { f.close(); }
});

test("startup also removes a task volume created before its planned journal row advanced", async () => {
  const f = fixture("planned"); let deletes = 0;
  try {
    const result = await recoverSnapshotJobs({ store: f.store, contexts: f.contexts, snapshotsDirectory: join(f.root, "snapshots"),
      runtime: { async removeSnapshotHelper() {}, async deleteManagedVolume(workId, logicalId) {
        assert.equal(workId, WORK); assert.equal(logicalId, "work-workspace"); deletes++;
      } } });
    assert.deepEqual(result, { cleaned: 1, pending: 0 });
    assert.equal(deletes, 1);
    assert.equal(f.store.snapshots.getJob(f.operationId)?.phase, "cleaned");
    assert.equal(f.store.getWork(WORK), undefined);
  } finally { f.close(); }
});

test("unconfirmed Docker cleanup leaves import unpublished with name and quota held", async () => {
  const f = fixture();
  try {
    const result = await recoverSnapshotJobs({ store: f.store, contexts: f.contexts, snapshotsDirectory: join(f.root, "snapshots"), now: () => new Date(NOW),
      runtime: { async removeSnapshotHelper() {}, async deleteManagedVolume() { throw new Error("Docker unavailable"); } } });
    assert.deepEqual(result, { cleaned: 0, pending: 1 });
    assert.equal(f.store.getWork(WORK), undefined);
    assert.ok(f.store.getQuotaReservation(WORK, "import", "import"));
    assert.ok(f.store.snapshots.getName(OWNER, "copied"));
    assert.equal(f.store.snapshots.getJob(f.operationId)?.phase, "cleanup-pending");
  } finally { f.close(); }
});

test("periodic retry cleans a previously pending job without fencing a live job", async () => {
  const f = fixture();
  try {
    const runtime = { async removeSnapshotHelper() {}, async deleteManagedVolume() {} };
    assert.deepEqual(await recoverSnapshotJobs({ store: f.store, contexts: f.contexts, runtime,
      snapshotsDirectory: join(f.root, "snapshots"), onlyCleanupPending: true }), { cleaned: 0, pending: 0 });
    assert.equal(f.store.snapshots.getJob(f.operationId)?.workerEpoch, 1);
    f.store.snapshots.updateJobPhase(f.operationId, 1, "cleanup-pending", NOW, "SNAPSHOT_CLEANUP_REQUIRED");
    assert.deepEqual(await recoverSnapshotJobs({ store: f.store, contexts: f.contexts, runtime,
      snapshotsDirectory: join(f.root, "snapshots"), onlyCleanupPending: true }), { cleaned: 1, pending: 0 });
    assert.equal(f.store.snapshots.getJob(f.operationId)?.phase, "cleaned");
  } finally { f.close(); }
});
