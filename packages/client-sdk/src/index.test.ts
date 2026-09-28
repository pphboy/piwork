import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ReadableStream } from "node:stream/web";
import { defaultCredentialPath, FileCredentialStore, PiworkApiError, PiworkClient, resolveCoreEndpoint, safeErrorMessage, waitPiPackageOperation, type CredentialRecord } from "./index.js";

const record: CredentialRecord = {
  version: 1,
  coreUrl: "http://127.0.0.1:7171",
  token: "opaque-token",
  expiresAt: "2026-09-21T00:00:00Z",
  user: { id: "user-1", account: "admin", role: "admin" },
};

const service = {
  workId: "work-1", serviceId: "service-1", name: "demo", enabled: true,
  observedState: "failed", desiredRevision: 2, appliedRevision: null,
  lastError: { code: "FAILED", message: "password=sentinel", retryable: true, internal: "sentinel" },
  endpoints: [{ name: "http", protocol: "tcp", host: "svc-demo", port: 8000, url: "http://svc-demo:8000", private: "sentinel" }],
  access: { hostname: "demo.w-a1b2c3d4.work", defaultUrl: "http://demo.w-a1b2c3d4.work/", defaultPortName: "http", status: "unavailable", ports: [{ name: "http", port: 8000, url: "http://demo.w-a1b2c3d4.work:8000/", private: "sentinel" }], private: "sentinel" },
  createdAt: "2026-09-23T00:00:00Z", definition: { environment: { SECRET: "sentinel" } }, extra: "sentinel",
};

test("service SDK uses authenticated scoped routes, action bodies, and safe metadata projections", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const acceptance = { workId: "work-1", serviceId: "service-1", operationId: "op-1", correlationId: "op-1", reused: true };
  const logs = { serviceId: "service-1", status: "available", text: "ok", truncated: false, collectedAt: service.createdAt };
  const responses: unknown[] = [
    { services: [service, { ...service, name: "aaa", serviceId: "z" }, { ...service, name: "aaa", serviceId: "a" }] },
    service, { services: [] }, { ...service, lastError: null },
    ...Array.from({ length: 5 }, () => acceptance), logs, logs,
  ];
  const client = new PiworkClient({ coreUrl: "http://core.test", token: "user-token", fetch: async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json(responses.shift());
  } });
  const list = await client.workServices("work/a");
  assert.deepEqual(list.services.map((item) => item.serviceId), ["a", "z", "service-1"]);
  const shown = await client.workService("work/a", "service/?");
  assert.equal(shown.observedState, "failed");
  assert.equal(shown.appliedRevision, null);
  assert.deepEqual(Object.keys(shown).sort(), ["workId", "serviceId", "name", "enabled", "observedState", "desiredRevision", "appliedRevision", "lastError", "endpoints", "access", "createdAt"].sort());
  assert.equal("private" in shown.access, false);
  assert.equal("private" in shown.access.ports[0]!, false);
  assert.deepEqual(shown.lastError, { code: "FAILED", message: "password=[REDACTED]", retryable: true });
  assert.equal(JSON.stringify(list).includes("sentinel"), false);
  assert.equal(JSON.stringify(shown).includes("sentinel"), false);
  assert.deepEqual(await client.workServices("work/a"), { services: [] });
  assert.equal((await client.workService("work/a", "service/?")).lastError, null);
  for (const action of ["enable", "disable", "restart", "retry", "remove"] as const) {
    assert.deepEqual(await client.workServiceAction("work/a", "service/?", action, "exact-key"), acceptance);
  }
  assert.deepEqual(await client.workServiceLogs("work/a", "service/?"), logs);
  await client.workServiceLogs("work/a", "service/?", 200);
  for (const call of calls) assert.equal(new Headers(call.init?.headers).get("authorization"), "Bearer user-token");
  assert.match(calls[0]!.url, /works\/work%2Fa\/services$/);
  assert.match(calls[1]!.url, /services\/service%2F%3F$/);
  for (const [index, action] of ["enable", "disable", "restart", "retry", "remove"].entries()) {
    const call = calls[index + 4]!;
    assert.equal(call.init?.method, "POST");
    assert.ok(call.url.endsWith(`/service%2F%3F/${action}`));
    assert.deepEqual(JSON.parse(String(call.init?.body)), { idempotencyKey: "exact-key" });
  }
  assert.ok(calls[9]!.url.endsWith("/logs?tailLines=100"));
  assert.ok(calls[10]!.url.endsWith("/logs?tailLines=200"));
  const denied = new PiworkClient({ coreUrl: "http://core.test", fetch: async () => Response.json({ code: "NOT_FOUND", message: "missing" }, { status: 404 }) });
  await assert.rejects(denied.workService("w", "s"), (error) => error instanceof PiworkApiError && error.status === 404);
});

test("operation signals interrupt both fetch and stalled response bodies", async () => {
  for (const phase of ["fetch", "body"] as const) {
    const controller = new AbortController();
    let bodyCancelled = false;
    const client = new PiworkClient({ coreUrl: "http://core.test", fetch: async (_input, init) => {
      assert.equal(init?.signal, controller.signal);
      if (phase === "fetch") return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
      return new Response(new ReadableStream<Uint8Array>({
        start(stream) { stream.enqueue(Buffer.from('{"state":')); },
        cancel() { bodyCancelled = true; },
      }));
    } });
    const pending = client.operation("op", { signal: controller.signal });
    const rejected = assert.rejects(pending);
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    await rejected;
    if (phase === "body") assert.equal(bodyCancelled, true);
  }
  const controller = new AbortController();
  const normal = new PiworkClient({ coreUrl: "http://core.test", fetch: async () => Response.json({ state: "succeeded" }) });
  assert.deepEqual(await normal.operation("op", { signal: controller.signal }), { state: "succeeded" });
  assert.deepEqual(await normal.operation("op"), { state: "succeeded" });
});

test("Pi package SDK encodes scoped routes, sends only source descriptors, and uploads ZIP headers", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json(String(input).endsWith("package-uploads") ? { uploadId: "upload-1", expiresAt: "later" }
      : { operationId: "operation-1", workId: "work/a", scope: "work", kind: "pi-package-install", name: null, reused: false, correlationId: "c" });
  };
  const client = new PiworkClient({ coreUrl: "http://core.test", token: "user-token", fetch: fetcher });
  const operator = new PiworkClient({ coreUrl: "http://core.test", operatorToken: "operator-token", fetch: fetcher });
  await client.installWorkPackage("work/a", { kind: "npm", spec: "@example/tools@1.0.0" }, "key");
  await client.updateWorkPackage("work/a", "@example/tools", { kind: "core", name: "@example/tools" }, "key-2");
  await operator.installManagedPackage({ kind: "git", spec: "github.com/example/tools@v1" }, "core-key", true);
  await client.uploadPiPackage((async function* () { yield Buffer.from("zip"); })(), "a".repeat(64), 3, "tools.zip", "zip", { kind: "work", workId: "work/a" });
  assert.ok(calls[0]!.url.endsWith("/works/work%2Fa/packages"));
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { source: { kind: "npm", spec: "@example/tools@1.0.0" }, idempotencyKey: "key" });
  assert.ok(calls[1]!.url.endsWith("/works/work%2Fa/packages/%40example%2Ftools/update"));
  assert.deepEqual(JSON.parse(String(calls[1]!.init?.body)).source, { kind: "core", name: "@example/tools" });
  assert.deepEqual(JSON.parse(String(calls[2]!.init?.body)).addToDefaults, true);
  assert.equal(new Headers(calls[3]!.init?.headers).get("x-piwork-package-name"), "tools.zip");
  assert.equal(new Headers(calls[3]!.init?.headers).get("content-type"), "application/zip");
  assert.equal(JSON.stringify(calls).includes("/home/"), false);
});

test("Pi package wait follows one accepted operation beyond two minutes unless a deadline is requested", async () => {
  let polls = 0, now = 0;
  const client = new PiworkClient({ coreUrl: "http://core.test", operatorToken: "operator-token", fetch: async () => {
    polls += 1; return Response.json({ state: polls === 3 ? "succeeded" : "running" });
  } });
  const accepted = { operationId: "operation-1", workId: null, scope: "core" as const, kind: "pi-package-install" as const, name: null, reused: false, correlationId: "c" };
  assert.equal((await waitPiPackageOperation(client, accepted, { now: () => now, sleep: async (ms) => { now += ms; } })).state, "succeeded");
  assert.equal(polls, 3); assert.equal(now, 500);
  let delayedPolls = 0, delayedClock = 0;
  const delayed = new PiworkClient({ coreUrl: "http://core.test", token: "user-token", fetch: async (input, init) => {
    assert.equal(init?.method ?? "GET", "GET", "waiting must never resubmit the package mutation");
    assert.match(String(input), /\/operations\/operation-1$/);
    delayedPolls += 1;
    return Response.json({ state: delayedPolls === 2 ? "failed" : "running" });
  } });
  assert.equal((await waitPiPackageOperation(delayed, { ...accepted, scope: "work", workId: "work-1" }, {
    now: () => delayedClock, sleep: async () => { delayedClock += 121_000; },
  })).state, "failed");
  assert.equal(delayedPolls, 2);
  let timeoutPolls = 0, timeoutClock = 0;
  const running = new PiworkClient({ coreUrl: "http://core.test", operatorToken: "operator-token", fetch: async (_input, init) => {
    assert.equal(init?.method ?? "GET", "GET", "waiting must never resubmit the package mutation");
    timeoutPolls += 1;
    return Response.json({ state: "running" });
  } });
  await assert.rejects(waitPiPackageOperation(running, accepted, { deadlineMs: 500, now: () => timeoutClock,
    sleep: async (ms) => { timeoutClock += ms; } }),
  (error: unknown) => error instanceof PiworkApiError && error.code === "OPERATION_WAIT_TIMEOUT" && error.message.includes("operation-1"));
  assert.equal(timeoutPolls, 2);
});

test("Pi package wait retries temporary observation failures and reports only safe progress", async () => {
  const accepted = { operationId: "operation-1", workId: null, scope: "core" as const, kind: "pi-package-install" as const,
    name: null, reused: false, correlationId: "operation-1" };
  let calls = 0, clock = 0;
  const sleeps: number[] = [], progress: string[] = [];
  const client = new PiworkClient({ coreUrl: "http://core.test", operatorToken: "private-token", fetch: async (_input, init) => {
    assert.equal(init?.method, "GET");
    calls += 1;
    if (calls === 1) return Response.json({ code: "UNAVAILABLE", message: "secret raw log" }, { status: 503 });
    if (calls === 2) throw new Error("network down with secret raw log");
    if (calls === 3) return Response.json({ state: "running", packagePhase: "prepare", helperId: "private-helper" });
    return Response.json({ state: "failed", packagePhase: "failed", error: { stage: "prepare", code: "PI_PACKAGE_DEPENDENCY_INSTALL_FAILED", message: "secret raw log" } });
  } });
  const final = await waitPiPackageOperation(client, accepted, { now: () => clock,
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    onProgress: (event) => progress.push(JSON.stringify(event)) });
  assert.equal(final.state, "failed");
  assert.equal(calls, 4);
  assert.deepEqual(sleeps, [250, 500, 250]);
  assert.deepEqual(progress.map((event) => JSON.parse(event).kind), ["retry", "retry", "recovered", "phase", "phase", "terminal"]);
  assert.doesNotMatch(progress.join(""), /private|secret raw log|helperId/);
  assert.match(progress.at(-1)!, /PI_PACKAGE_DEPENDENCY_INSTALL_FAILED/);
  const forbidden = new PiworkClient({ coreUrl: "http://core.test", operatorToken: "private-token", fetch: async () =>
    Response.json({ code: "NOT_FOUND" }, { status: 404 }) });
  await assert.rejects(waitPiPackageOperation(forbidden, accepted, { sleep: async () => { throw new Error("should not retry"); } }),
    (error: unknown) => error instanceof PiworkApiError && error.status === 404);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(waitPiPackageOperation(client, accepted, { signal: controller.signal }),
    (error: unknown) => error instanceof PiworkApiError && error.code === "OPERATION_WAIT_INTERRUPTED");
});

test("Pi package wait emits one phase line and a heartbeat, without per-poll chatter", async () => {
  const accepted = { operationId: "operation-1", workId: null, scope: "core" as const, kind: "pi-package-install" as const,
    name: null, reused: false, correlationId: "operation-1" };
  let polls = 0, clock = 0;
  const kinds: string[] = [];
  const client = new PiworkClient({ coreUrl: "http://core.test", operatorToken: "token", fetch: async () =>
    Response.json({ state: ++polls === 4 ? "succeeded" : "running", packagePhase: "prepare" }) });
  await waitPiPackageOperation(client, accepted, { now: () => clock, sleep: async () => { clock += 15_000; },
    onProgress: ({ kind }) => kinds.push(kind) });
  assert.deepEqual(kinds, ["phase", "heartbeat", "terminal"]);
});

test("snapshot SDK keeps JSON and binary transport separate with auth, encoded IDs and cancellable streams", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [], digest = "a".repeat(64), bytes = Buffer.from("PIWORK1\nfixture");
  const client = new PiworkClient({ coreUrl: "http://core.test", token: "snapshot-token", fetch: async (input, init) => {
    calls.push({ url: String(input), init });
    if (String(input).endsWith("/content")) return new Response(bytes, { headers: { "content-type": "application/vnd.piwork.work-package", "content-length": String(bytes.length), "x-piwork-sha256": digest } });
    if (String(input).endsWith("/work-packages")) {
      assert.equal(new Headers(init?.headers).get("content-length"), String(bytes.length));
      assert.equal(new Headers(init?.headers).get("x-piwork-sha256"), digest);
      assert.equal((init as RequestInit & { duplex?: string }).duplex, "half");
      return Response.json({ packageId: "package-1", digest, size: bytes.length, expiresAt: "later", bindingRequirements: { models: [], secrets: [] } }, { status: 201 });
    }
    return Response.json({ operationId: "operation-1", workId: "work-1", snapshotId: "snapshot-1", reused: false });
  } });
  const signal = new AbortController().signal;
  assert.equal((await client.exportWork("work/?", "key", { signal })).snapshotId, "snapshot-1");
  await client.workSnapshot("snapshot/?", { signal });
  await client.importWork({ packageId: "package-1", name: "copy", idempotencyKey: "key" }, { signal });
  await client.importProvenance("work/?", { signal });
  const upload = await client.uploadWorkPackage((async function* () { yield bytes; })(), digest, bytes.length, { signal });
  assert.equal(upload.packageId, "package-1");
  const download = await client.downloadWorkSnapshot("snapshot/?", { signal });
  assert.equal(download.digest, digest); assert.equal(download.size, bytes.length);
  const reader = download.stream.getReader(); assert.deepEqual(Buffer.from((await reader.read()).value!), bytes); await reader.cancel();
  assert.ok(calls[0]!.url.endsWith("/works/work%2F%3F/exports"));
  assert.ok(calls[1]!.url.endsWith("/work-snapshots/snapshot%2F%3F"));
  assert.ok(calls[5]!.url.endsWith("/work-snapshots/snapshot%2F%3F/content"));
  for (const call of calls) assert.equal(new Headers(call.init?.headers).get("authorization"), "Bearer snapshot-token");
});

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
  await client.applyWorkConfiguration("work-1", "apply-1");
  assert.equal(calls[0]?.url.endsWith("/api/v1/skills"), true);
  assert.deepEqual(calls.slice(2).map((call) => call.body), [{ configuration: { skills: [] } }, { idempotencyKey: "apply-1" }]);
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

test("shared CLI error rendering remains bounded for multiline Operation diagnostics", () => {
  const diagnostic = Array.from({ length: 64 }, (_, index) =>
    `Operation ID: operation-${index.toString().padStart(2, "0")}-a1cb6797-c4da-4098-b790-488899ac5ce2`).join("\n");
  const started = performance.now();
  const rendered = safeErrorMessage(new Error(diagnostic));
  assert.equal(rendered, diagnostic);
  assert.ok(performance.now() - started < 250, "diagnostic redaction must not exhibit catastrophic backtracking");
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
