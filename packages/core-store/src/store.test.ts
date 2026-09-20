import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CORE_SCHEMA_VERSION, CoreStore } from "./store.js";
import { CoreAlreadyRunningError } from "./store-lock.js";

test("empty database upgrades once and contains every durable Core entity", async () => {
  const fixture = await createFixture();
  try {
    const store = CoreStore.open({ databasePath: fixture.databasePath });
    assert.equal(store.schemaVersion, CORE_SCHEMA_VERSION);
    const tables = store.get<{ names: string }>(
      "SELECT group_concat(name, ',') AS names FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    for (const name of [
      "users",
      "login_sessions",
      "works",
      "work_config_revisions",
      "service_revisions",
      "service_heads",
      "operations",
      "idempotency_records",
      "resource_bindings",
      "volume_records",
      "quota_reservations",
      "runtime_generations",
      "catalog_entries",
      "secret_refs",
    ]) {
      assert.match(tables?.names ?? "", new RegExp(`(?:^|,)${name}(?:,|$)`));
    }
    store.close();

    const reopened = CoreStore.open({ databasePath: fixture.databasePath });
    assert.equal(reopened.schemaVersion, CORE_SCHEMA_VERSION);
    const migrationCount = reopened.get<{ count: number }>("SELECT COUNT(*) AS count FROM schema_migrations");
    assert.equal(migrationCount?.count, CORE_SCHEMA_VERSION);
    reopened.close();
  } finally {
    await fixture.cleanup();
  }
});

test("data survives close and reopen", async () => {
  const fixture = await createFixture();
  try {
    const store = CoreStore.open({ databasePath: fixture.databasePath });
    store.exec(`INSERT INTO users(id, account, password_digest, role, enabled, created_at, updated_at)
      VALUES ('user-1', 'alice', 'digest', 'admin', 1, '2026-09-20T00:00:00Z', '2026-09-20T00:00:00Z')`);
    store.close();

    const reopened = CoreStore.open({ databasePath: fixture.databasePath });
    const user = reopened.get<{ account: string; role: string }>("SELECT account, role FROM users WHERE id = 'user-1'");
    assert.equal(user?.account, "alice");
    assert.equal(user?.role, "admin");
    reopened.close();
  } finally {
    await fixture.cleanup();
  }
});

test("a second Core is rejected while the first owns the store", async () => {
  const fixture = await createFixture();
  try {
    const first = CoreStore.open({ databasePath: fixture.databasePath });
    assert.throws(
      () => CoreStore.open({ databasePath: fixture.databasePath }),
      (error) => error instanceof CoreAlreadyRunningError,
    );
    first.close();

    const replacement = CoreStore.open({ databasePath: fixture.databasePath });
    replacement.close();
  } finally {
    await fixture.cleanup();
  }
});

test("dead PID locks are reclaimed while live and malformed locks are preserved", async () => {
  const fixture = await createFixture();
  const lockPath = `${fixture.databasePath}.lock`;
  try {
    await mkdir(join(lockPath, ".."), { recursive: true });
    await writeFile(lockPath, JSON.stringify({ pid: 2_147_483_647, acquiredAt: "2026-09-20T00:00:00Z" }));
    const reclaimed = CoreStore.open({ databasePath: fixture.databasePath });
    reclaimed.close();
    await writeFile(lockPath, JSON.stringify({ pid: process.pid }));
    assert.throws(() => CoreStore.open({ databasePath: fixture.databasePath }), CoreAlreadyRunningError);
    await rm(lockPath);
    await writeFile(lockPath, "not-json");
    assert.throws(() => CoreStore.open({ databasePath: fixture.databasePath }), CoreAlreadyRunningError);
  } finally { await fixture.cleanup(); }
});

async function createFixture(): Promise<{
  readonly databasePath: string;
  cleanup(): Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "piwork-core-store-"));
  return {
    databasePath: join(root, "state", "core.sqlite"),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
