import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore } from "./store.js";
import type { WorkFileJobRecord } from "./work-files.js";
import { WorkFileStoreError } from "./work-files.js";
import type { SnapshotJobRecord } from "./snapshots.js";

const NOW = "2026-09-28T00:00:00.000Z";

test("schema 9 upgrades without changing Work, volume, or context data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwork-files-migration-"));
  const databasePath = join(directory, "core.db");
  try {
    const first = CoreStore.open({ databasePath });
    first.exec(`INSERT INTO users VALUES ('owner','owner','digest','user',1,'${NOW}','${NOW}');
      INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at)
      VALUES ('work-test','owner','笔记','running','ready',1,1,'${NOW}','${NOW}');
      INSERT INTO volume_records(id,installation_id,work_id,service_id,volume_role,runtime_name,state,reference_count,created_at)
      VALUES ('volume-test','install-test','work-test',NULL,'workspace','workspace-test','ready',1,'${NOW}');
      INSERT INTO work_context_snapshots(snapshot_id,work_id,internal_revision,configuration_json,image_identity,created_by_user_id,created_at)
      VALUES ('context-test','work-test',1,'{"version":1}','image-test','owner','${NOW}')`);
    first.exec(`DROP TABLE work_file_cleanup_retries; DROP TABLE work_file_temporaries; DROP TABLE work_file_attempts; DROP TABLE work_file_jobs;
      DROP TABLE work_file_gates; DROP TABLE work_file_core_epoch; DELETE FROM schema_migrations WHERE version = 10`);
    first.close();
    const upgraded = CoreStore.open({ databasePath });
    assert.equal(upgraded.schemaVersion, 10);
    assert.equal(upgraded.getWork("work-test")?.name, "笔记");
    assert.equal(upgraded.get<{ runtime_name: string }>("SELECT runtime_name FROM volume_records WHERE id = 'volume-test'")?.runtime_name, "workspace-test");
    assert.equal(upgraded.get<{ image_identity: string }>("SELECT image_identity FROM work_context_snapshots WHERE snapshot_id = 'context-test'")?.image_identity, "image-test");
    assert.deepEqual(upgraded.files.getGate("work-test"), { workId: "work-test", epoch: 1, closed: false, updatedAt: NOW });
    upgraded.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("file journal survives reopen, stores no token, and collects only 24-hour-old cleaned jobs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwork-files-journal-"));
  const databasePath = join(directory, "core.db");
  try {
    const store = CoreStore.open({ databasePath });
    store.exec(`INSERT INTO users VALUES ('owner','owner','digest','user',1,'${NOW}','${NOW}');
      INSERT INTO login_sessions(id,user_id,token_digest,expires_at,created_at)
      VALUES ('session-test','owner','digest-of-token','2026-10-01T00:00:00Z','${NOW}');
      INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at)
      VALUES ('work-test','owner','笔记','running','ready',1,1,'${NOW}','${NOW}')`);
    const job: WorkFileJobRecord = {
      id: "filejob-test", workId: "work-test", ownerUserId: "owner", sessionId: "session-test",
      coreEpoch: 1, workEpoch: 1, runtimeGeneration: 1, kind: "PUT", state: "accepted",
      trustedImageId: "sha256:helper", volumeName: "workspace-test", pathSegmentsJson: '["data","note.txt"]',
      destinationSegmentsJson: null, acceptedAt: NOW, deadlineAt: "2026-09-28T00:30:00.000Z", updatedAt: NOW,
      cleanedAt: null, errorCode: null,
    };
    store.files.insertJob(job);
    store.files.insertAttempt({ id: "attempt-test", jobId: job.id, kind: "request", epoch: 1,
      containerName: "piwork-file-test", containerId: null, state: "planned", createdAt: NOW, updatedAt: NOW });
    store.files.insertTemporary({ id: "temporary-test", jobId: job.id, parentSegmentsJson: '["data"]',
      name: ".piwork-file-test.tmp", device: null, inode: null, state: "planned", createdAt: NOW, updatedAt: NOW });
    store.close();
    const reopened = CoreStore.open({ databasePath });
    assert.deepEqual(reopened.files.listPendingJobs().map(({ id }) => id), [job.id]);
    assert.equal(reopened.files.listAttempts(job.id)[0]?.containerName, "piwork-file-test");
    assert.equal(reopened.files.listTemporaries(job.id)[0]?.name, ".piwork-file-test.tmp");
    const cols = reopened.get<{ names: string }>("SELECT group_concat(name) AS names FROM pragma_table_info('work_file_jobs')")?.names ?? "";
    assert.doesNotMatch(cols, /token/i);
    assert.equal(reopened.files.collectCleaned("2026-10-01T00:00:00.000Z"), 0);
    reopened.exec(`UPDATE work_file_attempts SET state = 'removed' WHERE job_id = 'filejob-test';
      UPDATE work_file_temporaries SET state = 'cleaned' WHERE job_id = 'filejob-test';
      UPDATE work_file_jobs SET state = 'cleaned', cleaned_at = '${NOW}' WHERE id = 'filejob-test'`);
    assert.equal(reopened.files.collectCleaned("2026-09-28T23:59:59.000Z"), 0);
    assert.equal(reopened.files.collectCleaned("2026-09-29T00:00:00.000Z"), 1);
    assert.equal(reopened.files.listAttempts(job.id).length, 0);
    assert.equal(reopened.files.listTemporaries(job.id).length, 0);
    reopened.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("file admission, commit, lifecycle gate and snapshot lock serialize on one Work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwork-files-gate-"));
  const databasePath = join(directory, "core.db");
  try {
    const store = CoreStore.open({ databasePath });
    store.exec(`INSERT INTO users VALUES ('owner','owner','digest','user',1,'${NOW}','${NOW}');
      INSERT INTO login_sessions(id,user_id,token_digest,expires_at,created_at)
      VALUES ('session-test','owner','digest-of-token','2026-10-01T00:00:00Z','${NOW}');
      INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at)
      VALUES ('work-test','owner','test','running','ready',1,1,'${NOW}','${NOW}')`);
    const base = {
      workId: "work-test", ownerUserId: "owner", sessionId: "session-test", coreEpoch: 1,
      runtimeGeneration: 1, trustedImageId: "sha256:helper", volumeName: "workspace-test",
      pathSegmentsJson: '["note.txt"]', destinationSegmentsJson: null,
      acceptedAt: NOW, deadlineAt: "2026-09-28T00:30:00.000Z", updatedAt: NOW,
      cleanedAt: null, errorCode: null,
    } as const;
    const writer = store.files.acceptJob({ ...base, id: "filejob-writer", kind: "PUT", state: "accepted" });
    assert.equal(writer.workEpoch, 1);
    assert.throws(() => store.files.acceptJob({ ...base, id: "filejob-writer-2", kind: "DELETE", state: "accepted" }),
      (error) => error instanceof WorkFileStoreError && error.code === "FILE_ACCESS_BUSY");
    store.exec("UPDATE work_file_jobs SET state = 'cancelling' WHERE id = 'filejob-writer'");
    assert.throws(() => store.files.acceptJob({ ...base, id: "filejob-during-cancel", kind: "PUT", state: "accepted" }),
      (error) => error instanceof WorkFileStoreError && error.code === "FILE_ACCESS_BUSY");
    for (let i = 0; i < 3; i++) store.files.acceptJob({ ...base, id: `filejob-reader-${i}`, kind: "GET", state: "accepted" });
    assert.throws(() => store.files.acceptJob({ ...base, id: "filejob-reader-over", kind: "GET", state: "accepted" }),
      (error) => error instanceof WorkFileStoreError && error.code === "FILE_ACCESS_BUSY");
    store.exec("UPDATE work_file_jobs SET state = 'prepared' WHERE id = 'filejob-writer'");
    const snap = (operationId: string): SnapshotJobRecord => ({
      operationId, ownerUserId: "owner", kind: "export", sourceWorkId: "work-test", targetWorkId: null,
      snapshotId: "snapshot-test", packageId: null, name: null, requestDigest: "digest", phase: "accepted",
      deadlineAt: "2026-09-28T00:30:00.000Z", workerEpoch: 1, createdAt: NOW, updatedAt: NOW, cleanupError: null,
    });
    const lock = () => store.snapshots.accept({ principalId: "owner", workScope: "work-test", workId: "work-test",
      operationKind: "export-work", idempotencyKey: "export-test", requestDigest: "digest", requestJson: "{}", targetVersion: 1, now: NOW }, (tx) => {
      store.snapshots.insertJob(snap(tx.operationId));
      store.snapshots.lockWork({ workId: "work-test", operationId: tx.operationId, workerEpoch: 1 });
      return { resourceId: "work-test" };
    });
    assert.throws(lock, /WORK_BUSY/);
    assert.equal(store.snapshots.listJobs().length, 0, "failed snapshot acceptance rolls back its job");
    store.files.closeGate("work-test", NOW);
    assert.throws(() => store.files.authorizeCommit(writer.id, writer.workEpoch, NOW),
      (error) => error instanceof WorkFileStoreError && error.code === "WORK_FILES_UNAVAILABLE");
    assert.throws(() => store.files.acceptJob({ ...base, id: "filejob-after-stop", kind: "GET", state: "accepted" }),
      (error) => error instanceof WorkFileStoreError && error.code === "WORK_FILES_UNAVAILABLE");
    assert.throws(() => store.files.openGate("work-test", NOW),
      (error) => error instanceof WorkFileStoreError && error.code === "FILE_CLEANUP_REQUIRED");
    for (const job of store.files.listPendingJobs("work-test")) store.files.markCleaned(job.id, NOW);
    lock();
    assert.throws(() => store.files.openGate("work-test", NOW),
      (error) => error instanceof WorkFileStoreError && error.code === "WORK_SNAPSHOT_BUSY");
    store.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("file slots cap each user at eight and Core at sixteen until cleanup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwork-files-capacity-"));
  const databasePath = join(directory, "core.db");
  try {
    const store = CoreStore.open({ databasePath });
    for (const owner of ["a", "b", "c"]) {
      store.exec(`INSERT INTO users VALUES ('${owner}','${owner}','digest','user',1,'${NOW}','${NOW}');
        INSERT INTO login_sessions(id,user_id,token_digest,expires_at,created_at)
        VALUES ('session-${owner}','${owner}','digest-${owner}','2026-10-01T00:00:00Z','${NOW}')`);
      for (let i = 0; i < 4; i++) store.exec(`INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at)
        VALUES ('work-${owner}-${i}','${owner}','work-${i}','running','ready',1,1,'${NOW}','${NOW}')`);
    }
    const accept = (owner: string, index: number) => store.files.acceptJob({
      id: `filejob-${owner}-${index}`, workId: `work-${owner}-${Math.floor(index / 2) % 4}`,
      ownerUserId: owner, sessionId: `session-${owner}`, coreEpoch: 1, runtimeGeneration: 1,
      kind: "GET", state: "accepted", trustedImageId: "sha256:helper", volumeName: `volume-${owner}`,
      pathSegmentsJson: "[]", destinationSegmentsJson: null, acceptedAt: NOW,
      deadlineAt: "2026-09-28T00:30:00Z", updatedAt: NOW, cleanedAt: null, errorCode: null,
    });
    for (let i = 0; i < 8; i++) accept("a", i);
    assert.throws(() => accept("a", 8), (error) => error instanceof WorkFileStoreError && error.code === "FILE_ACCESS_BUSY");
    for (let i = 0; i < 8; i++) accept("b", i);
    assert.throws(() => accept("c", 0), (error) => error instanceof WorkFileStoreError && error.code === "FILE_ACCESS_BUSY");
    store.files.markCleaned("filejob-a-0", NOW);
    assert.equal(accept("c", 0).id, "filejob-c-0");
    store.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("cleanup-pending blocks only its Work and leaves another Work's file quota usable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwork-files-isolation-"));
  const store = CoreStore.open({ databasePath: join(directory, "core.db") });
  try {
    store.exec(`INSERT INTO users VALUES ('owner','owner','digest','user',1,'${NOW}','${NOW}');
      INSERT INTO login_sessions(id,user_id,token_digest,expires_at,created_at)
      VALUES ('session-test','owner','digest','2026-10-01T00:00:00Z','${NOW}');
      INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at)
      VALUES ('work-first','owner','first','running','ready',1,1,'${NOW}','${NOW}'),
        ('work-second','owner','second','running','ready',1,1,'${NOW}','${NOW}')`);
    const accept = (workId: string, id: string) => store.files.acceptJob({ id, workId, ownerUserId: "owner",
      sessionId: "session-test", coreEpoch: 1, runtimeGeneration: 1, kind: "GET",
      state: "accepted", trustedImageId: "sha256:helper", volumeName: "workspace-test",
      pathSegmentsJson: "[]", destinationSegmentsJson: null, acceptedAt: NOW,
      deadlineAt: "2026-09-28T00:30:00Z", updatedAt: NOW, cleanedAt: null, errorCode: null });
    accept("work-first", "filejob-first");
    store.files.updateJobState("filejob-first", "accepted", "cleanup-pending", NOW, "FILE_CLEANUP_REQUIRED");
    assert.throws(() => accept("work-first", "filejob-blocked"),
      (error) => error instanceof WorkFileStoreError && error.code === "FILE_CLEANUP_REQUIRED");
    assert.equal(accept("work-second", "filejob-second").workId, "work-second");
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});
