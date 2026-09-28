import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore, WorkFileStoreError } from "@piwork/core-store";
import { WorkFileAccessGuard } from "./access.js";
import { WorkFileExecutionError } from "./coordinator.js";

const NOW = "2026-09-28T00:00:00.000Z";
const WORK = "work-test-12345678";

test("file access requires the current owner session and exact ready Docker instance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwork-file-access-"));
  const store = CoreStore.open({ databasePath: join(directory, "core.db") });
  try {
    store.exec(`INSERT INTO users VALUES ('owner','owner','digest','user',1,'${NOW}','${NOW}');
      INSERT INTO users VALUES ('admin','admin','digest','admin',1,'${NOW}','${NOW}');
      INSERT INTO login_sessions(id,user_id,token_digest,expires_at,created_at)
      VALUES ('session-owner','owner','digest-owner','2026-10-01T00:00:00Z','${NOW}');
      INSERT INTO login_sessions(id,user_id,token_digest,expires_at,created_at)
      VALUES ('session-admin','admin','digest-admin','2026-10-01T00:00:00Z','${NOW}');
      INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at)
      VALUES ('${WORK}','owner','test','running','ready',1,1,'${NOW}','${NOW}')`);
    store.ensureRuntimeGeneration(WORK, 1, NOW);
    store.updateRuntimeGeneration(WORK, 1, "ready", NOW, { instanceId: "instance-one" });
    let actual = { exists: true, running: true, ready: true, generation: 1, instanceId: "instance-one" };
    const guard = new WorkFileAccessGuard(store, { async inspect() { return actual; } }, () => NOW);
    const owner = { workId: WORK, ownerUserId: "owner", sessionId: "session-owner", runtimeGeneration: 1 };
    await guard.validate(owner);
    await assert.rejects(guard.validate({ ...owner, workId: "missing-work-1234" }),
      (error) => error instanceof WorkFileStoreError && error.code === "NOT_FOUND");
    await assert.rejects(guard.validate({ ...owner, ownerUserId: "admin", sessionId: "session-admin" }),
      (error) => error instanceof WorkFileStoreError && error.code === "NOT_FOUND");
    await assert.rejects(guard.validate({ ...owner, sessionId: "operator-credential" }),
      (error) => error instanceof WorkFileStoreError && error.code === "AUTH_REQUIRED");
    actual = { ...actual, instanceId: "wrong-instance" };
    await assert.rejects(guard.validate(owner),
      (error) => error instanceof WorkFileExecutionError && error.code === "WORK_FILES_UNAVAILABLE");
    actual = { ...actual, instanceId: "instance-one" };
    store.exec(`UPDATE works SET observed_state = 'degraded' WHERE id = '${WORK}'`);
    await guard.validate(owner); // no service is required for workspace access
    store.exec("UPDATE users SET enabled = 0 WHERE id = 'owner'");
    await assert.rejects(guard.validate(owner),
      (error) => error instanceof WorkFileStoreError && error.code === "AUTH_REQUIRED");
    store.exec("UPDATE users SET enabled = 1 WHERE id = 'owner'");
    store.revokeLoginSession("session-owner", NOW);
    await assert.rejects(guard.validate(owner),
      (error) => error instanceof WorkFileStoreError && error.code === "AUTH_REQUIRED");
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});
