import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
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
      "control_metadata",
      "managed_skill_artifacts",
      "work_context_snapshots",
      "service_runtime_bindings",
      "volume_references",
    ]) {
      assert.match(tables?.names ?? "", new RegExp(`(?:^|,)${name}(?:,|$)`));
    }
    assert.deepEqual(store.getControlMetadata("work_storage_format"), { version: 2, layout: "split-private-workspace" });
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

test("service runtime binding and recovery state survive same-version reopen", async () => {
  const fixture = await createFixture();
  try {
    const store = CoreStore.open({ databasePath: fixture.databasePath });
    store.putServiceRuntimeBinding({
      workId: "work-0199e6d8abcd", serviceId: "service-0199e6d8abcd", revision: 2,
      containerId: "container-1", imageIdentity: `sha256:${"a".repeat(64)}`, recoveryCount: 2,
      recoveryWindowStartedAt: "2026-09-20T00:00:00Z", nextRetryAt: "2026-09-20T00:00:05Z",
      readySince: null, updatedAt: "2026-09-20T00:00:01Z",
    });
    store.close();
    const reopened = CoreStore.open({ databasePath: fixture.databasePath });
    assert.equal(reopened.getServiceRuntimeBinding("work-0199e6d8abcd", "service-0199e6d8abcd")?.recoveryCount, 2);
    reopened.close();
  } finally { await fixture.cleanup(); }
});

test("pre-release combined storage schema is rejected without rewriting it", async () => {
  const fixture = await createFixture();
  try {
    await mkdir(join(fixture.databasePath, ".."), { recursive: true });
    const legacy = new DatabaseSync(fixture.databasePath);
    legacy.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;
      INSERT INTO schema_migrations(version, applied_at) VALUES (5, '2026-09-20T00:00:00Z');
      CREATE TABLE legacy_sentinel(value TEXT NOT NULL) STRICT;
      INSERT INTO legacy_sentinel(value) VALUES ('preserve-me')`);
    legacy.close();
    assert.throws(
      () => CoreStore.open({ databasePath: fixture.databasePath }),
      (error) => (error as { code?: string }).code === "CONTEXT_FORMAT_UNSUPPORTED",
    );
    const unchanged = new DatabaseSync(fixture.databasePath, { readOnly: true });
    assert.equal((unchanged.prepare("SELECT value FROM legacy_sentinel").get() as { value: string }).value, "preserve-me");
    assert.equal((unchanged.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version, 5);
    unchanged.close();
  } finally { await fixture.cleanup(); }
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

test("default Work configuration uses revisioned compare-and-swap", async () => {
  const fixture = await createFixture();
  try {
    const store = CoreStore.open({ databasePath: fixture.databasePath });
    const initial = store.getDefaultWorkConfiguration();
    assert.equal(initial?.revision, 0);
    const next = store.compareAndSwapDefaultWorkConfiguration(0, { agentsMd: "hello" }, "2026-09-20T00:00:00Z");
    assert.equal(next.revision, 1);
    assert.deepEqual(store.getDefaultWorkConfiguration()?.configuration, { agentsMd: "hello" });
    assert.throws(() => store.compareAndSwapDefaultWorkConfiguration(0, { agentsMd: "stale" }, "2026-09-20T00:00:01Z"), /revision conflict/);
    assert.deepEqual(store.getDefaultWorkConfiguration()?.configuration, { agentsMd: "hello" });
    store.close();
  } finally { await fixture.cleanup(); }
});

test("default Work updates merge atomically without exposing a public CAS input", async () => {
  const fixture = await createFixture();
  try {
    const store = CoreStore.open({ databasePath: fixture.databasePath });
    store.updateDefaultWorkConfiguration({ skills: ["code-review"], agentsMd: "A" }, "2026-09-20T00:00:00Z");
    const next = store.updateDefaultWorkConfiguration({ agentsMd: "B" }, "2026-09-20T00:00:01Z");
    assert.deepEqual(next.configuration, { skills: ["code-review"], agentsMd: "B" });
    store.updateDefaultWorkConfiguration({ skills: [] }, "2026-09-20T00:00:02Z");
    assert.deepEqual(store.getDefaultWorkConfiguration()?.configuration, { skills: [], agentsMd: "B" });
    store.close();
  } finally { await fixture.cleanup(); }
});

test("managed Skills use basename identity, null host reference and transactional current pointers", async () => {
  const fixture = await createFixture();
  try {
    const store = CoreStore.open({ databasePath: fixture.databasePath });
    const first = store.addManagedSkill({
      name: "code-review", identity: `sha256:${"a".repeat(64)}`, fileCount: 2, totalBytes: 100,
      now: "2026-09-20T00:00:00Z",
    });
    assert.equal(first.name, "code-review");
    assert.equal(store.getCatalogEntry("code-review")?.mutableReference, null);
    assert.throws(() => store.addManagedSkill({
      name: "code-review", identity: `sha256:${"b".repeat(64)}`, fileCount: 2, totalBytes: 101,
      now: "2026-09-20T00:00:01Z",
    }), /already exists/);
    assert.equal(store.getManagedSkill("code-review")?.currentIdentity, `sha256:${"a".repeat(64)}`);
    store.updateManagedSkillCurrent({
      name: "code-review", identity: `sha256:${"b".repeat(64)}`, fileCount: 3, totalBytes: 200,
      now: "2026-09-20T00:00:02Z",
    });
    assert.equal(store.getManagedSkill("code-review")?.currentIdentity, `sha256:${"b".repeat(64)}`);
    assert.deepEqual(store.listManagedSkills().map(({ name }) => name), ["code-review"]);
    store.setControlMetadata("default_work_configuration", {
      version: 1, revision: 0, configuration: { skills: ["code-review"] },
    }, "2026-09-20T00:00:03Z");
    assert.throws(() => store.setManagedSkillEnabled("code-review", false, "2026-09-20T00:00:04Z"), /selected by default/);
    assert.throws(() => store.removeManagedSkill("code-review"), /selected by default/);
    assert.equal(store.getManagedSkill("code-review")?.enabled, true);
    store.setControlMetadata("default_work_configuration", {
      version: 1, revision: 0, configuration: { skills: [] },
    }, "2026-09-20T00:00:05Z");
    store.setManagedSkillEnabled("code-review", false, "2026-09-20T00:00:06Z");
    assert.deepEqual(store.listManagedSkills(true), []);
    assert.deepEqual(store.removeManagedSkill("code-review"), [`sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`]);
    assert.equal(store.getManagedSkill("code-review"), undefined);
    store.close();
  } finally { await fixture.cleanup(); }
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
