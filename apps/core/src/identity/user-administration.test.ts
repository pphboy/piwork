import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore, LastEnabledAdministratorError } from "@piwork/core-store";
import { bootstrapAdministrator } from "./bootstrap-admin.js";
import { IdentityService, InvalidLoginSessionError } from "./sessions.js";
import {
  AdministrationPermissionError,
  DuplicateAccountError,
  UserAdministrationService,
} from "./user-administration.js";

const ADMIN_PASSWORD = "correct horse battery staple";
const USER_PASSWORD = "initial user password";
const RESET_PASSWORD = "replacement user password";
const NOW = "2026-09-20T00:00:00Z";

test("administrator creates and lists users without password material", async () => {
  await withFixture(async ({ admin, users }) => {
    const created = await users.createUser(admin, { account: "alice", password: USER_PASSWORD });
    assert.equal(created.role, "user");
    const listed = users.listUsers(admin);
    assert.deepEqual(listed.map((user) => user.account), ["admin", "alice"]);
    assert.doesNotMatch(JSON.stringify(listed), /password|argon2/i);
    await assert.rejects(
      users.createUser(admin, { account: "alice", password: USER_PASSWORD }),
      DuplicateAccountError,
    );
  });
});

test("ordinary users cannot create, list, enable, disable, or reset accounts", async () => {
  await withFixture(async ({ admin, users }) => {
    const created = await users.createUser(admin, { account: "alice", password: USER_PASSWORD });
    const actor = { userId: created.id, role: "user" as const };
    await assert.rejects(users.createUser(actor, { account: "bob", password: USER_PASSWORD }), AdministrationPermissionError);
    assert.throws(() => users.listUsers(actor), AdministrationPermissionError);
    assert.throws(() => users.setEnabled(actor, created.id, false), AdministrationPermissionError);
    await assert.rejects(users.resetPassword(actor, created.id, RESET_PASSWORD), AdministrationPermissionError);
  });
});

test("disable and password reset revoke every old session; re-enable does not restore tokens", async () => {
  await withFixture(async ({ admin, users, identity }) => {
    const created = await users.createUser(admin, { account: "alice", password: USER_PASSWORD });
    const first = await identity.login("alice", USER_PASSWORD, "source-a");
    const second = await identity.login("alice", USER_PASSWORD, "source-b");
    users.setEnabled(admin, created.id, false);
    assert.throws(() => identity.authenticate(first.token), InvalidLoginSessionError);
    assert.throws(() => identity.authenticate(second.token), InvalidLoginSessionError);
    users.setEnabled(admin, created.id, true);
    assert.throws(() => identity.authenticate(first.token), InvalidLoginSessionError);

    const third = await identity.login("alice", USER_PASSWORD, "source-c");
    await users.resetPassword(admin, created.id, RESET_PASSWORD);
    assert.throws(() => identity.authenticate(third.token), InvalidLoginSessionError);
    await assert.rejects(identity.login("alice", USER_PASSWORD, "source-old"));
    assert.equal((await identity.login("alice", RESET_PASSWORD, "source-new")).user.id, created.id);
  });
});

test("the last enabled administrator cannot be disabled", async () => {
  await withFixture(async ({ admin, users }) => {
    assert.throws(() => users.setEnabled(admin, admin.userId, false), LastEnabledAdministratorError);
    const second = await users.createUser(admin, {
      account: "backup-admin",
      password: USER_PASSWORD,
      role: "admin",
    });
    users.setEnabled(admin, admin.userId, false);
    assert.equal(users.listUsers({ userId: second.id, role: "admin" }).find((user) => user.id === admin.userId)?.enabled, false);
  });
});

test("session recheck after password hashing prevents a revoked actor from committing", async () => {
  await withFixture(async ({ admin, users, identity }) => {
    await assert.rejects(users.createUser(admin, { account: "blocked", password: USER_PASSWORD }, () => {
      throw new InvalidLoginSessionError();
    }), InvalidLoginSessionError);
    assert.equal(users.listUsers(admin).some((user) => user.account === "blocked"), false);
    const created = await users.createUser(admin, { account: "alice", password: USER_PASSWORD });
    await assert.rejects(users.resetPassword(admin, created.id, RESET_PASSWORD, () => {
      throw new InvalidLoginSessionError();
    }), InvalidLoginSessionError);
    assert.equal((await identity.login("alice", USER_PASSWORD, "source-a")).user.id, created.id);
    await assert.rejects(identity.login("alice", RESET_PASSWORD, "source-b"));
  });
});

async function withFixture(
  run: (fixture: {
    store: CoreStore;
    admin: { userId: string; role: "admin" };
    users: UserAdministrationService;
    identity: IdentityService;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "piwork-user-admin-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  const createdAdmin = await bootstrapAdministrator({ store, account: "admin", password: ADMIN_PASSWORD, now: NOW });
  const identity = await IdentityService.create({ store, now: () => new Date(NOW) });
  const users = new UserAdministrationService(store, () => new Date(NOW));
  try {
    await run({
      store,
      admin: { userId: createdAdmin.userId, role: "admin" },
      users,
      identity,
    });
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
}
