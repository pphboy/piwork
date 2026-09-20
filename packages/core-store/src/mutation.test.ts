import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { IdempotencyConflictError, RevisionConflictError } from "./mutation.js";
import { CoreStore } from "./store.js";

test("concurrent same-key submissions commit one mutation and reuse one Operation", async () => {
  await withStore(async (store) => {
    const submit = () => store.acceptMutation(request({ requestDigest: "digest-a" }), (tx) => {
      tx.run("UPDATE works SET control_version = control_version + 1 WHERE id = ?", "work-1");
      return { resourceId: "work-1", resultJson: '{"accepted":true}' };
    });

    const [first, second] = await Promise.all([
      Promise.resolve().then(submit),
      Promise.resolve().then(submit),
    ]);

    assert.equal(first.operationId, second.operationId);
    assert.equal(first.resourceId, second.resourceId);
    assert.deepEqual([first.reused, second.reused].sort(), [false, true]);
    assert.equal(store.get<{ count: number }>("SELECT COUNT(*) AS count FROM operations")?.count, 1);
    assert.equal(store.get<{ count: number }>("SELECT COUNT(*) AS count FROM idempotency_records")?.count, 1);
    assert.equal(store.get<{ version: number }>("SELECT control_version AS version FROM works WHERE id = 'work-1'")?.version, 2);
  });
});

test("same key with different content conflicts without changing committed state", async () => {
  await withStore(async (store) => {
    store.acceptMutation(request({ requestDigest: "digest-a" }), (tx) => {
      tx.run("UPDATE works SET control_version = control_version + 1 WHERE id = ?", "work-1");
      return { resourceId: "work-1" };
    });

    assert.throws(
      () => store.acceptMutation(request({ requestDigest: "digest-b" }), () => ({ resourceId: "work-1" })),
      (error) => error instanceof IdempotencyConflictError,
    );
    assert.equal(store.get<{ count: number }>("SELECT COUNT(*) AS count FROM operations")?.count, 1);
    assert.equal(store.get<{ version: number }>("SELECT control_version AS version FROM works WHERE id = 'work-1'")?.version, 2);
  });
});

test("expected version rejects stale updates before an Operation is created", async () => {
  await withStore(async (store) => {
    assert.throws(
      () => store.acceptMutation(request({ idempotencyKey: "stale", expectedWorkVersion: 9 }), () => ({
        resourceId: "work-1",
      })),
      (error) => error instanceof RevisionConflictError,
    );
    assert.equal(store.get<{ count: number }>("SELECT COUNT(*) AS count FROM operations")?.count, 0);
  });
});

test("an effect failure rolls back entity, Operation, idempotency, and tombstone writes", async () => {
  await withStore(async (store) => {
    assert.throws(
      () => store.acceptMutation(request({ idempotencyKey: "failing" }), (tx) => {
        tx.run(`INSERT INTO catalog_entries(
          id, kind, name, metadata_json, enabled, created_at, updated_at
        ) VALUES (?, 'model', ?, '{}', 1, ?, ?)`, "catalog-1", "fixture", NOW, NOW);
        tx.tombstoneWork("work-1", NOW);
        throw new Error("injected failure");
      }),
      /injected failure/,
    );

    assert.equal(store.get<{ count: number }>("SELECT COUNT(*) AS count FROM catalog_entries")?.count, 0);
    assert.equal(store.get<{ count: number }>("SELECT COUNT(*) AS count FROM operations")?.count, 0);
    assert.equal(store.get<{ count: number }>("SELECT COUNT(*) AS count FROM idempotency_records")?.count, 0);
    const work = store.get<{ deleted_at: string | null; control_version: number }>(
      "SELECT deleted_at, control_version FROM works WHERE id = 'work-1'",
    );
    assert.equal(work?.deleted_at, null);
    assert.equal(work?.control_version, 1);
  });
});

test("tombstone and Operation commit atomically", async () => {
  await withStore(async (store) => {
    const result = store.acceptMutation(request({ operationKind: "delete-work", idempotencyKey: "delete-1" }), (tx) => {
      tx.tombstoneWork("work-1", NOW);
      return { resourceId: "work-1" };
    });
    assert.equal(result.reused, false);
    const work = store.get<{ desired_state: string; deleted_at: string; control_version: number }>(
      "SELECT desired_state, deleted_at, control_version FROM works WHERE id = 'work-1'",
    );
    assert.equal(work?.desired_state, "deleted");
    assert.equal(work?.deleted_at, NOW);
    assert.equal(work?.control_version, 2);
  });
});

const NOW = "2026-09-20T00:00:00Z";

function request(overrides: Partial<Parameters<CoreStore["acceptMutation"]>[0]> = {}) {
  return {
    principalId: "user-1",
    workScope: "work-1",
    operationKind: "update-work",
    idempotencyKey: "request-1",
    requestDigest: "digest-a",
    requestJson: '{"desired":"running"}',
    targetVersion: 2,
    workId: "work-1",
    expectedWorkVersion: 1,
    now: NOW,
    ...overrides,
  };
}

async function withStore(run: (store: CoreStore) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "piwork-core-mutation-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  store.exec(`INSERT INTO users(id, account, password_digest, role, enabled, created_at, updated_at)
    VALUES ('user-1', 'alice', 'digest', 'admin', 1, '${NOW}', '${NOW}')`);
  store.exec(`INSERT INTO works(
    id, owner_user_id, name, desired_state, observed_state,
    desired_revision, active_revision, control_version, created_at, updated_at
  ) VALUES ('work-1', 'user-1', 'fixture', 'stopped', 'stopped', 1, 1, 1, '${NOW}', '${NOW}')`);
  try {
    await run(store);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
}
