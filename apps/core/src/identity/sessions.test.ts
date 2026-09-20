import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore } from "@piwork/core-store";
import { bootstrapAdministrator } from "./bootstrap-admin.js";
import {
  AuthenticationFailedError,
  IdentityService,
  InvalidLoginSessionError,
  LoginRateLimitedError,
} from "./sessions.js";

const PASSWORD = "correct horse battery staple";

test("valid login returns user identity and a 24-hour opaque session", async () => {
  await withIdentity(async ({ identity }) => {
    const login = await identity.login("admin", PASSWORD, "127.0.0.1");
    assert.notEqual(login.token, PASSWORD);
    assert.ok(login.token.length >= 40);
    assert.equal(login.expiresAt, "2026-09-21T00:00:00.000Z");
    assert.deepEqual(login.user.account, "admin");
    assert.deepEqual(identity.authenticate(login.token).user, login.user);
  });
});

test("wrong, missing, and disabled accounts return the same authentication error", async () => {
  await withIdentity(async ({ store, identity }) => {
    const invalidCredentials: ReadonlyArray<readonly [string, string]> = [
      ["admin", "wrong password"],
      ["missing", PASSWORD],
    ];
    for (const [account, password] of invalidCredentials) {
      await assert.rejects(
        identity.login(account, password, `source-${account}`),
        (error) => error instanceof AuthenticationFailedError && error.message === "invalid account or password",
      );
    }
    store.exec("UPDATE users SET enabled = 0 WHERE account = 'admin'");
    await assert.rejects(
      identity.login("admin", PASSWORD, "disabled-source"),
      (error) => error instanceof AuthenticationFailedError && error.message === "invalid account or password",
    );
  });
});

test("logout revokes only the current session and absolute expiry rejects later use", async () => {
  await withIdentity(async ({ identity, clock }) => {
    const first = await identity.login("admin", PASSWORD, "source-a");
    const second = await identity.login("admin", PASSWORD, "source-b");
    identity.logout(first.token);
    assert.throws(() => identity.authenticate(first.token), InvalidLoginSessionError);
    assert.equal(identity.authenticate(second.token).user.account, "admin");
    clock.advance(24 * 60 * 60 * 1_000);
    assert.throws(() => identity.authenticate(second.token), InvalidLoginSessionError);
  });
});

test("default limiter allows five failures then limits account and source for the remaining minute", async () => {
  await withIdentity(async ({ identity, clock }) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await assert.rejects(identity.login("admin", "wrong password", "same-source"), AuthenticationFailedError);
    }
    await assert.rejects(
      identity.login("admin", PASSWORD, "same-source"),
      (error) => error instanceof LoginRateLimitedError && error.retryAfterMs === 60_000,
    );
    await assert.rejects(identity.login("admin", PASSWORD, "different-source"), LoginRateLimitedError);
    await assert.rejects(identity.login("different-account", PASSWORD, "same-source"), LoginRateLimitedError);
    clock.advance(60_000);
    assert.equal((await identity.login("admin", PASSWORD, "same-source")).user.account, "admin");
  });
});

test("session lifetime and login limiter are configurable under a virtual clock", async () => {
  await withIdentity(async ({ identity, clock }) => {
    await assert.rejects(identity.login("admin", "wrong password", "source"), AuthenticationFailedError);
    await assert.rejects(identity.login("admin", "wrong password", "source"), AuthenticationFailedError);
    await assert.rejects(identity.login("admin", PASSWORD, "source"), LoginRateLimitedError);
    clock.advance(1_000);
    const login = await identity.login("admin", PASSWORD, "source");
    clock.advance(2_000);
    assert.throws(() => identity.authenticate(login.token), InvalidLoginSessionError);
  }, { sessionTtlMs: 2_000, failureWindowMs: 1_000, maxFailures: 2 });
});

class VirtualClock {
  private value = Date.parse("2026-09-20T00:00:00Z");
  now = (): Date => new Date(this.value);
  advance(milliseconds: number): void {
    this.value += milliseconds;
  }
}

async function withIdentity(
  run: (fixture: { store: CoreStore; identity: IdentityService; clock: VirtualClock }) => Promise<void>,
  config: Partial<{ sessionTtlMs: number; failureWindowMs: number; maxFailures: number }> = {},
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "piwork-identity-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  const clock = new VirtualClock();
  await bootstrapAdministrator({ store, account: "admin", password: PASSWORD, now: clock.now().toISOString() });
  const identity = await IdentityService.create({ store, now: clock.now, config });
  try {
    await run({ store, identity, clock });
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
}
