import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { defaultCredentialPath, FileCredentialStore, PiworkApiError, PiworkClient, resolveCoreEndpoint, safeErrorMessage, type CredentialRecord } from "./index.js";

const record: CredentialRecord = {
  version: 1,
  coreUrl: "http://127.0.0.1:7171",
  token: "opaque-token",
  expiresAt: "2026-09-21T00:00:00Z",
  user: { id: "user-1", account: "admin", role: "admin" },
};

test("credential URL precedence and atomic POSIX save/load/clear", async () => {
  assert.equal(resolveCoreEndpoint({ explicit: "http://explicit", environment: "http://environment", saved: "http://saved" }), "http://explicit");
  assert.equal(resolveCoreEndpoint({ environment: "http://environment", saved: "http://saved" }), "http://environment");
  assert.equal(resolveCoreEndpoint({ saved: "http://saved" }), "http://saved");
  assert.equal(resolveCoreEndpoint({}), "http://127.0.0.1:7171");
  assert.equal(defaultCredentialPath({ PIWORK_CONFIG_PATH: "/override", XDG_CONFIG_HOME: "/xdg", HOME: "/home" }), "/override");
  assert.equal(defaultCredentialPath({ XDG_CONFIG_HOME: "/xdg", HOME: "/home" }), "/xdg/piwork/client.json");
  assert.equal(defaultCredentialPath({ HOME: "/home" }), "/home/.config/piwork/client.json");
  const root = await mkdtemp(join(tmpdir(), "piwork-client-store-"));
  const path = join(root, "nested", "client.json");
  try {
    const store = new FileCredentialStore(path);
    assert.equal(await store.load(), undefined);
    await store.save(record);
    assert.deepEqual(await store.load(), record);
    if (process.platform !== "win32") {
      assert.equal((await lstat(join(root, "nested"))).mode & 0o777, 0o700);
      assert.equal((await lstat(path)).mode & 0o777, 0o600);
    }
    await store.clear();
    assert.equal(await store.load(), undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("credential store rejects malformed, broad-permission, and symlink records", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-client-invalid-"));
  try {
    const malformed = join(root, "malformed.json");
    await writeFile(malformed, "{}", { mode: 0o600 });
    await assert.rejects(new FileCredentialStore(malformed).load(), /unsupported shape/);
    if (process.platform !== "win32") {
      await chmod(malformed, 0o644);
      await assert.rejects(new FileCredentialStore(malformed).load(), /permissions/);
    }
    const target = join(root, "target.json");
    const link = join(root, "link.json");
    await writeFile(target, JSON.stringify(record), { mode: 0o600 });
    await symlink(target, link);
    await assert.rejects(new FileCredentialStore(link).load(), /symbolic link/);
    await assert.rejects(new FileCredentialStore(link).save(record), /symbolic link/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("client sends authentication, encodes identifiers, handles 204 and typed errors", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [
    new Response(null, { status: 204 }),
    new Response(JSON.stringify({ code: "BUSY", message: "busy", retryAfterMs: 500 }), { status: 409 }),
  ];
  const client = new PiworkClient({
    coreUrl: "http://core.test/base",
    token: "opaque-token",
    fetch: async (input, init) => { calls.push({ url: String(input), init }); return responses.shift()!; },
  });
  assert.equal(await client.logout(), undefined);
  assert.equal(new Headers(calls[0]?.init?.headers).get("authorization"), "Bearer opaque-token");
  await assert.rejects(client.work("work/id"), (error) => error instanceof PiworkApiError
    && error.status === 409 && error.code === "BUSY" && error.details?.retryAfterMs === 500);
  assert.match(calls[1]?.url ?? "", /work%2Fid/);
});

test("operator authentication is distinct from user bearer authentication", async () => {
  let authorizationHeader = "";
  const operator = new PiworkClient({
    coreUrl: "http://core.test",
    operatorToken: "operator-secret",
    fetch: async (_input, init) => {
      authorizationHeader = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(JSON.stringify({ state: "ADMIN_REQUIRED" }), { status: 200 });
    },
  });
  await operator.controlStatus();
  assert.equal(authorizationHeader, "Operator operator-secret");
  await assert.rejects(new PiworkClient({ coreUrl: "http://core.test", token: "user", operatorToken: "operator" }).health(), /cannot be used together/);
});

test("revision-free Skill and Work configuration methods send the new request shapes", async () => {
  const calls: Array<{ method?: string; url: string; body?: unknown }> = [];
  const client = new PiworkClient({
    coreUrl: "http://core.test",
    token: "user-token",
    operatorToken: undefined,
    fetch: async (input, init) => {
      calls.push({ method: init?.method, url: String(input), body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  await client.skills();
  await client.workConfiguration("work-1");
  await client.updateWorkConfiguration("work-1", { skills: [] });
  await client.applyWorkConfiguration("work-1");
  assert.equal(calls[0]?.url.endsWith("/api/v1/skills"), true);
  assert.deepEqual(calls.slice(2).map((call) => call.body), [{ configuration: { skills: [] } }, {}]);
  assert.equal(JSON.stringify(calls).includes("expectedRevision"), false);
});

test("shared CLI error rendering redacts credentials and secret paths", () => {
  const rendered = safeErrorMessage(new Error("Bearer user-token password=hunter2 api_key=sk-test /tmp/core/secrets/model.secret"));
  assert.equal(rendered.includes("user-token"), false);
  assert.equal(rendered.includes("hunter2"), false);
  assert.equal(rendered.includes("sk-test"), false);
  assert.equal(rendered.includes("model.secret"), false);
  assert.match(rendered, /\[REDACTED\]/);
  assert.match(rendered, /\[REDACTED_PATH\]/);
});

test("client bounds and validates JSON, network errors, and incremental NDJSON ordering", async () => {
  const malformed = new PiworkClient({ coreUrl: "http://core.test", fetch: async () => new Response("not-json") });
  await assert.rejects(malformed.health(), (error) => error instanceof PiworkApiError && error.code === "MALFORMED_RESPONSE");
  const network = new PiworkClient({ coreUrl: "http://core.test", fetch: async () => { throw new Error("offline"); } });
  await assert.rejects(network.health(), (error) => error instanceof PiworkApiError && error.code === "NETWORK_ERROR");
  const huge = new PiworkClient({ coreUrl: "http://core.test", fetch: async () => new Response("x".repeat(1_048_577)) });
  await assert.rejects(huge.health(), (error) => error instanceof PiworkApiError && error.code === "RESPONSE_TOO_LARGE");
  const stream = new PiworkClient({ coreUrl: "http://core.test", fetch: async () => new Response('{"sequence":1,"text":"a"}\n{"sequence":2,"text":"b"}\n') });
  const events = [];
  for await (const event of stream.watchRun("work", "run")) events.push(event);
  assert.deepEqual(events.map((event) => Number(event.sequence)), [1, 2]);
  const outOfOrder = new PiworkClient({ coreUrl: "http://core.test", fetch: async () => new Response('{"sequence":2}\n{"sequence":2}\n') });
  await assert.rejects(async () => { for await (const _ of outOfOrder.watchRun("work", "run")) {} }, /out of order/);
  const incomplete = new PiworkClient({ coreUrl: "http://core.test", fetch: async () => new Response('{"sequence":1}') });
  await assert.rejects(async () => { for await (const _ of incomplete.watchRun("work", "run")) {} }, /incomplete record/);
});
