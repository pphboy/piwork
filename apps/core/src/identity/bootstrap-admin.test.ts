import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verify } from "@node-rs/argon2";
import {
  CoreStore,
  InitialAdministratorExistsError,
} from "@piwork/core-store";
import { bootstrapAdministrator } from "./bootstrap-admin.js";

const PASSWORD = "correct horse battery staple";

test("empty installation bootstraps one enabled Argon2id administrator", async () => {
  await withStore(async (store) => {
    const result = await bootstrapAdministrator({ store, account: "admin", password: PASSWORD, now: NOW });
    const row = store.get<{
      id: string;
      account: string;
      password_digest: string;
      role: string;
      enabled: number;
    }>("SELECT id, account, password_digest, role, enabled FROM users");
    assert.equal(row?.id, result.userId);
    assert.equal(row?.account, "admin");
    assert.equal(row?.role, "admin");
    assert.equal(row?.enabled, 1);
    assert.match(row?.password_digest ?? "", /^\$argon2id\$/);
    assert.equal(await verify(row?.password_digest ?? "", PASSWORD), true);
  });
});

test("repeat bootstrap is rejected without overwriting credentials", async () => {
  await withStore(async (store) => {
    await bootstrapAdministrator({ store, account: "admin", password: PASSWORD, now: NOW });
    const before = store.get<{ password_digest: string }>("SELECT password_digest FROM users WHERE account = 'admin'");
    await assert.rejects(
      bootstrapAdministrator({ store, account: "other-admin", password: "another strong password", now: NOW }),
      (error) => error instanceof InitialAdministratorExistsError,
    );
    const after = store.get<{ count: number; password_digest: string }>(
      "SELECT COUNT(*) AS count, password_digest FROM users WHERE account = 'admin'",
    );
    assert.equal(after?.count, 1);
    assert.equal(after?.password_digest, before?.password_digest);
  });
});

test("account uniqueness is enforced by storage", async () => {
  await withStore(async (store) => {
    await bootstrapAdministrator({ store, account: "admin", password: PASSWORD, now: NOW });
    assert.throws(() => store.exec(`INSERT INTO users(
      id, account, password_digest, role, enabled, created_at, updated_at
    ) VALUES ('user-duplicate', 'admin', 'digest', 'user', 1, '${NOW}', '${NOW}')`), /UNIQUE/);
  });
});

test("no default or short password is accepted and logs contain no credential material", async () => {
  await withStore(async (store) => {
    await assert.rejects(
      bootstrapAdministrator({ store, account: "admin", password: "" }),
      /at least 12 characters/,
    );
    const logs: unknown[] = [];
    await bootstrapAdministrator({
      store,
      account: "admin",
      password: PASSWORD,
      now: NOW,
      logger: { info: (message, fields) => logs.push({ message, fields }) },
    });
    const serialized = JSON.stringify(logs);
    assert.doesNotMatch(serialized, new RegExp(PASSWORD));
    assert.doesNotMatch(serialized, /argon2|password_digest|password/i);
  });
});

const NOW = "2026-09-20T00:00:00Z";

async function withStore(run: (store: CoreStore) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "piwork-bootstrap-admin-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  try {
    await run(store);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
}
