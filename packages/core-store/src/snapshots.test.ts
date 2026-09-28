import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { CoreStore } from "./store.js";
import { SnapshotStoreError, type SnapshotJobRecord, type SnapshotPackageRecord, type SnapshotTransferRecord } from "./snapshots.js";
import { IdempotencyConflictError } from "./mutation.js";

const NOW = "2026-09-23T00:00:00.000Z", DEADLINE = "2026-09-23T00:30:00.000Z", EXPIRES = "2026-09-24T00:00:00.000Z";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "piwork-snapshot-store-")), path = join(root, "core.sqlite");
  const store = CoreStore.open({ databasePath: path });
  store.exec(`INSERT INTO users VALUES ('owner', 'alice', 'private-password-digest', 'admin', 1, '${NOW}', '${NOW}');
    INSERT INTO works(id, owner_user_id, name, desired_state, observed_state, desired_revision, control_version, created_at, updated_at)
    VALUES ('work-source', 'owner', 'original', 'stopped', 'stopped', 1, 1, '${NOW}', '${NOW}');
    INSERT INTO work_config_revisions(work_id, revision, config_json, created_by_user_id, created_at)
    VALUES ('work-source', 1, '{"sentinel":"original config"}', 'owner', '${NOW}');
    INSERT INTO secret_refs VALUES ('secret', 'owner', 'private-secret', '/private/unexported-path', '${NOW}', '${NOW}')`);
  return { root, path, store, close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}
function job(operationId: string, overrides: Partial<SnapshotJobRecord> = {}): SnapshotJobRecord {
  return { operationId, ownerUserId: "owner", kind: "export", sourceWorkId: "work-source", targetWorkId: null, snapshotId: "snapshot-1", packageId: null, name: null,
    requestDigest: "digest", phase: "accepted", deadlineAt: DEADLINE, workerEpoch: 1, createdAt: NOW, updatedAt: NOW, cleanupError: null, ...overrides };
}
function pkg(id: string): SnapshotPackageRecord { return { id, ownerUserId: "owner", digest: null, size: 0, state: "staging", jobId: null, createdAt: NOW, readyAt: null, expiresAt: null }; }
function transfer(id: string, packageId: string): SnapshotTransferRecord { return { id, ownerUserId: "owner", packageId, snapshotId: null, kind: "upload", phase: "accepted", deadlineAt: DEADLINE, lastProgressAt: NOW, helperId: null, createdAt: NOW }; }
function accept(store: CoreStore, key = "export-1", digest = "digest") {
  return store.snapshots.accept({ principalId: "owner", workScope: "work-source", workId: "work-source", operationKind: "export-work", idempotencyKey: key, requestDigest: digest, requestJson: "{}", targetVersion: 1, now: NOW }, (tx) => {
    store.snapshots.insertJob(job(tx.operationId)); store.snapshots.lockWork({ workId: "work-source", operationId: tx.operationId, workerEpoch: 1 }); return { resourceId: "work-source" };
  });
}

test("schema7 Work storage is rejected before a package migration changes user data", () => {
  const f = fixture();
  try {
    f.store.exec("PRAGMA foreign_keys = OFF");
    for (const table of ["pi_package_jobs", "pi_package_uploads", "pi_package_catalog", "pi_package_artifacts"]) f.store.exec(`DROP TABLE ${table}`);
    f.store.exec("DELETE FROM schema_migrations WHERE version >= 8; PRAGMA foreign_keys = ON");
    f.store.close();
    assert.throws(() => CoreStore.open({ databasePath: f.path }), (error) => (error as { code?: string }).code === "CORE_STORAGE_FORMAT_UNSUPPORTED");
    const unchanged = new DatabaseSync(f.path, { readOnly: true });
    assert.equal((unchanged.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version, 7);
    assert.equal((unchanged.prepare("SELECT config_json FROM work_config_revisions").get() as { config_json: string }).config_json, '{"sentinel":"original config"}');
    assert.equal((unchanged.prepare("SELECT storage_path FROM secret_refs").get() as { storage_path: string }).storage_path, "/private/unexported-path");
    unchanged.close();
  } finally { f.close(); }
});

test("acceptance reserves one active job and a durable fence; replay precedes capacity and conflicts", () => {
  const f = fixture();
  try {
    const first = accept(f.store); assert.equal(first.reused, false); assert.equal(accept(f.store).operationId, first.operationId);
    assert.throws(() => accept(f.store, "another"), (error: unknown) => error instanceof SnapshotStoreError && error.code === "SNAPSHOT_CAPACITY_BUSY");
    assert.throws(() => accept(f.store, "export-1", "different"), IdempotencyConflictError);
    assert.equal(f.store.listOperations().length, 1); assert.equal(f.store.snapshots.listJobs(true).length, 1);
    assert.throws(() => f.store.snapshots.assertWorkMutable("work-source"), /WORK_SNAPSHOT_BUSY/);
    f.store.snapshots.insertArtifact({ operationId: first.operationId, artifactKey: "private", kind: "volume", logicalId: "new-private-volume", state: "planned" }, 1);
    f.store.snapshots.updateArtifact(first.operationId, 1, "private", "created");
    assert.equal(f.store.snapshots.listArtifacts(first.operationId)[0]?.state, "created");
    const recovered = f.store.snapshots.fenceWorker(first.operationId, NOW); assert.equal(recovered.workerEpoch, 2);
    assert.equal(f.store.snapshots.getLock("work-source")?.workerEpoch, 2);
    assert.throws(() => f.store.snapshots.releaseReservations(first.operationId, 1), /SNAPSHOT_WORKER_FENCED/);
    assert.throws(() => f.store.snapshots.updateJobPhase(first.operationId, 1, "succeeded", NOW), /SNAPSHOT_WORKER_FENCED/);
    assert.throws(() => f.store.snapshots.updateArtifact(first.operationId, 1, "private", "cleaned"), /SNAPSHOT_WORKER_FENCED/);
    f.store.snapshots.withFence(first.operationId, 2, (tx) => {
      f.store.snapshots.releaseReservations(first.operationId, 2);
      tx.run("UPDATE snapshot_jobs SET phase = 'cleaned' WHERE operation_id = ?", first.operationId);
    });
    f.store.snapshots.assertWorkMutable("work-source"); assert.equal(f.store.snapshots.listJobs(true).length, 0);
    assert.equal(accept(f.store).operationId, first.operationId);
  } finally { f.close(); }
});

test("failed acceptance rolls back Operation, job, name and quota together", () => {
  const f = fixture();
  try {
    const request = { principalId: "owner", workScope: "imports", operationKind: "import-work", idempotencyKey: "import", requestDigest: "digest", requestJson: "{}", targetVersion: 1, now: NOW };
    assert.throws(() => f.store.snapshots.accept(request, (tx) => {
      f.store.snapshots.insertJob(job(tx.operationId, { kind: "import", sourceWorkId: null, targetWorkId: "unpublished-work", snapshotId: null, name: "new-work" }));
      f.store.snapshots.reserveName({ ownerUserId: "owner", name: "new-work", operationId: tx.operationId });
      tx.run("INSERT INTO quota_reservations VALUES ('unpublished-work', 'import', 'import', 100, 100, 0, 0, 0, 2, ?)", NOW);
      throw new Error("injected");
    }), /injected/);
    assert.equal(f.store.listOperations().length, 0); assert.equal(f.store.snapshots.listJobs().length, 0);
    assert.equal(f.store.snapshots.getName("owner", "new-work"), undefined);
    assert.equal(f.store.get<{ count: number }>("SELECT COUNT(*) AS count FROM quota_reservations")?.count, 0);
    assert.throws(() => f.store.snapshots.insertJob(job("missing-operation")), /FOREIGN KEY/);
    assert.throws(() => f.store.snapshots.reserveName({ ownerUserId: "owner", name: "original", operationId: "missing" }), /WORK_NAME_CONFLICT/);
  } finally { f.close(); }
});

test("transfer capacity and durable leases prevent package expiration while a reader is active", () => {
  const f = fixture();
  try {
    const snapshots = f.store.snapshots;
    snapshots.acceptTransfer(transfer("transfer-1", "package-1"), pkg("package-1"));
    snapshots.acceptTransfer(transfer("transfer-2", "package-2"), pkg("package-2"));
    assert.throws(() => snapshots.acceptTransfer(transfer("transfer-3", "package-3"), pkg("package-3")), /SNAPSHOT_TRANSFER_BUSY/);
    assert.equal(snapshots.getPackage("package-3"), undefined);
    snapshots.sealPackage("package-1", "a".repeat(64), 100, NOW, EXPIRES);
    assert.equal(snapshots.expirePackage("package-1", EXPIRES), false);
    snapshots.updateTransfer("transfer-1", "verifying", NOW, "helper-id"); assert.equal(snapshots.getTransfer("transfer-1")?.helperId, "helper-id");
    snapshots.finishTransfer("transfer-1"); assert.equal(snapshots.expirePackage("package-1", EXPIRES), true);
    assert.equal(snapshots.markPackageDeleting("package-1"), true); assert.equal(snapshots.getPackage("package-1")?.digest, "a".repeat(64));
  } finally { f.close(); }
});

test("owned images, opaque native history and provenance stay durable and outside live operations", () => {
  const f = fixture(); let reopened: CoreStore | undefined;
  try {
    const accepted = accept(f.store);
    const record = '{ "kind":"future-operation", "requestJson":"unparsed old work-source payload" }';
    f.store.snapshots.insertOwnedImage({ workId: "work-source", selectionId: "local-image", imageIdentity: `sha256:${"a".repeat(64)}`, sourceReference: "user:original" });
    f.store.snapshots.insertHistory({ workId: "work-source", operationId: "archived-operation", sourceOperationId: "old-operation", recordJson: record });
    assert.throws(() => f.store.snapshots.insertHistory({ workId: "work-source", operationId: "archived-operation", sourceOperationId: "old-operation", recordJson: record }), /UNIQUE/);
    assert.throws(() => f.store.snapshots.insertOwnedImage({ workId: "missing-work", selectionId: "local-image", imageIdentity: "identity", sourceReference: "reference" }), /FOREIGN KEY/);
    f.store.snapshots.insertProvenance({ workId: "work-source", packageDigest: "b".repeat(64), importOperationId: accepted.operationId, identityMapJson: '{"retained":"mapping"}' });
    f.store.close(); reopened = CoreStore.open({ databasePath: f.path });
    assert.equal(reopened.snapshots.getOwnedImage("other-work", "local-image"), undefined);
    assert.equal(reopened.snapshots.listOwnedImages("work-source").length, 1);
    assert.equal(reopened.snapshots.getHistory("archived-operation")?.recordJson, record);
    assert.equal(reopened.snapshots.listHistory("work-source").length, 1);
    assert.equal(reopened.getOperation("archived-operation"), undefined);
    assert.equal(reopened.snapshots.getProvenance("work-source")?.identityMapJson, '{"retained":"mapping"}');
    assert.equal(reopened.snapshots.getJobBySnapshot("snapshot-1")?.operationId, accepted.operationId);
    assert.equal(reopened.snapshots.getLock("work-source")?.operationId, accepted.operationId);
  } finally { reopened?.close(); f.close(); }
});
