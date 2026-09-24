import assert from "node:assert/strict";
import test from "node:test";
import { ReadableStream } from "node:stream/web";
import { PiworkClient, type AcceptedServiceOperation } from "@piwork/client-sdk";
import { executeWorkServiceCommand, parseWorkServiceCommand, type ServiceTiming } from "./work-service.js";

const accepted: AcceptedServiceOperation = { workId: "w", serviceId: "s", operationId: "op", correlationId: "op", reused: false };
const service = { workId: "w", serviceId: "s", name: "demo", enabled: true, observedState: "failed", desiredRevision: 2, appliedRevision: null, lastError: null, endpoints: [], createdAt: "now", definition: { environment: { KEY: "sentinel" } } };
function operation(state: string) {
  return { operationId: "op", workId: "w", correlationId: "op", kind: "restart-service", state, createdAt: "now", updatedAt: "now", result: null, error: state === "failed" ? { stage: "service-start", code: "SERVICE_EXITED", message: "Failed", remediation: "Inspect logs" } : null, diagnostics: {} };
}
function clock() {
  let now = 0;
  let expire: (() => void) | undefined;
  let cleared = false;
  const sleeps: number[] = [];
  const timing: ServiceTiming = {
    now: () => now,
    sleep: async (ms) => { sleeps.push(ms); now += ms; },
    deadline: (callback, ms) => { assert.equal(ms, 120_000); expire = callback; return () => { cleared = true; }; },
  };
  return { timing, sleeps, fire: () => { now = 120_000; expire!(); }, get cleared() { return cleared; } };
}
function fixture(fetch: typeof globalThis.fetch, json = true, timing?: ServiceTiming) {
  let stdout = ""; let stderr = "";
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new PiworkClient({ coreUrl: "http://core.test", token: "user-token", fetch: (url, init) => {
    calls.push({ url: String(url), init }); return fetch(url, init);
  } });
  return {
    calls, get stdout() { return stdout; }, get stderr() { return stderr; },
    run: (args: string[]) => executeWorkServiceCommand({ client, json, stdout: (text) => { stdout += text; }, stderr: (text) => { stderr += text; }, timing }, parseWorkServiceCommand(args)),
  };
}

test("service parser accepts the command matrix and rejects unsupported or ambiguous input", () => {
  for (const action of ["start", "stop", "restart", "retry", "remove"]) {
    assert.deepEqual(parseWorkServiceCommand([action, "w", "s", "--idempotency-key", " key ", "--wait"]), { kind: "mutation", action, workId: "w", serviceId: "s", wait: true, idempotencyKey: " key " });
    assert.deepEqual(parseWorkServiceCommand([action, "--help"]), { kind: "help" });
  }
  assert.deepEqual(parseWorkServiceCommand(["list", "w"]), { kind: "list", workId: "w" });
  assert.deepEqual(parseWorkServiceCommand(["show", "w", "s"]), { kind: "show", workId: "w", serviceId: "s" });
  assert.deepEqual(parseWorkServiceCommand(["logs", "w", "s"]), { kind: "logs", workId: "w", serviceId: "s", tail: 100 });
  for (const n of ["1", "100", "200"]) assert.equal((parseWorkServiceCommand(["logs", "w", "s", "--tail", n]) as { tail: number }).tail, Number(n));
  const invalid = [[], ["list"], ["show", "w"], ["list", "w", "extra"], ["show", "w", "s", "extra"],
    ...["", " ", "-w", "x\0x"].map((id) => ["show", id, "s"]),
    ...["create", "update", "config", "revisions", "enable", "disable", "delete", "all", "toString"].map((action) => [action, "w", "s"]),
    ["create", "--help"], ["stop", "w", "s", "--wait", "--wait"], ["stop", "w", "s", "--idempotency-key"],
    ["stop", "w", "s", "--idempotency-key", " "], ["stop", "w", "s", "--idempotency-key", "a", "--idempotency-key", "b"],
    ["remove", "w", "s", "--purge-data"], ["logs", "w", "s", "--follow"], ["show", "w", "s", "--wait"],
    ["logs", "w", "s", "--tail", "1", "--tail", "2"], ["stop", "--wait", "w", "s"], ["stop", "w", "s", "--wait=true"],
    ...["", " ", "0", "201", "-1", "+1", "1.5", "1e2", "abc", "9007199254740992"].map((n) => ["logs", "w", "s", "--tail", n])];
  for (const args of invalid) assert.throws(() => parseWorkServiceCommand(args), (error) => (error as { exitCode: number }).exitCode === 2, args.join(" "));
});

test("list/show output only lifecycle metadata and never resolve names", async () => {
  for (const json of [true, false]) {
    for (const action of ["list", "show"]) {
      const f = fixture(async () => Response.json(action === "list" ? { services: [service] } : service), json);
      assert.equal(await f.run(action === "list" ? [action, "w"] : [action, "w", "demo"]), 0);
      assert.equal(f.calls.length, 1);
      if (action === "show") assert.ok(f.calls[0]!.url.endsWith("/services/demo"));
      assert.doesNotMatch(f.stdout + f.stderr, /sentinel|definition/);
      assert.equal(JSON.parse(f.stdout)[action === "list" ? "services" : "observedState"] !== undefined, true);
    }
  }
  const empty = fixture(async () => Response.json({ services: [] }));
  assert.equal(await empty.run(["list", "w"]), 0);
  assert.equal(empty.stdout, '{"services":[]}\n');
});

test("all lifecycle actions submit once without pre-read and preserve supplied or generated keys", async () => {
  for (const [action, endpoint] of Object.entries({ start: "enable", stop: "disable", restart: "restart", retry: "retry", remove: "remove" })) {
    const f = fixture(async () => Response.json({ ...accepted, reused: true }, { status: 202 }));
    assert.equal(await f.run([action, "w", "s", "--idempotency-key", " key "]), 0);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0]!.init?.method, "POST");
    assert.ok(f.calls[0]!.url.endsWith(`/services/s/${endpoint}`));
    assert.deepEqual(JSON.parse(String(f.calls[0]!.init?.body)), { idempotencyKey: " key " });
    assert.deepEqual(JSON.parse(f.stdout), { ...accepted, reused: true });
  }
  const f = fixture(async () => Response.json(accepted));
  await f.run(["retry", "w", "s"]);
  assert.match(JSON.parse(String(f.calls[0]!.init?.body)).idempotencyKey, /^[0-9a-f-]{36}$/);
  const lost = fixture(async () => { throw new Error("offline"); });
  await assert.rejects(lost.run(["remove", "w", "s", "--wait"]));
  assert.equal(lost.calls.length, 1);
  assert.equal(lost.stdout, "");
});

test("wait follows the original Operation sequentially and emits one terminal JSON with serviceId", async () => {
  for (const state of ["succeeded", "failed", "superseded"]) {
    const timer = clock();
    const values = [{ ...accepted, reused: true }, operation("pending"), operation("running"), operation(state)];
    const f = fixture(async () => Response.json(values.shift()), true, timer.timing);
    assert.equal(await f.run(["restart", "w", "s", "--wait"]), state === "succeeded" ? 0 : 6);
    assert.deepEqual(JSON.parse(f.stdout), { ...operation(state), serviceId: "s" });
    assert.equal(f.stdout.trim().split("\n").length, 1);
    assert.deepEqual(timer.sleeps, [250, 250]);
    assert.equal(timer.cleared, true);
    assert.deepEqual(f.calls.map((call) => call.init?.method), ["POST", "GET", "GET", "GET"]);
    assert.ok(f.calls.slice(1).every((call) => call.url.endsWith("/operations/op")));
  }
});

test("text wait prints acceptance immediately, then service identity, failure, and recovery command", async () => {
  const f = fixture(async (_url, init) => {
    if (init?.method === "POST") return Response.json(accepted);
    assert.equal(JSON.parse(f.stdout).serviceId, "s");
    return Response.json(operation("failed"));
  }, false);
  assert.equal(await f.run(["stop", "w", "s", "--wait"]), 6);
  for (const text of ["Work ID: w", "Service ID: s", "Operation ID: op", "Stage: service-start", "Code: SERVICE_EXITED", "Inspect logs", "piwork-cli operation show op"]) assert.ok(f.stdout.includes(text));
});

test("observation failures preserve acceptance, including auth loss and malformed Operations", async () => {
  const failures: Array<() => Promise<Response>> = [
    async () => { throw new Error("offline"); },
    ...[401, 403, 500].map((status) => async () => Response.json({ message: "failed" }, { status })),
    async () => new Response("not-json"),
    ...[null, {}, { ...operation("succeeded"), operationId: "other" }, { ...operation("succeeded"), workId: "other" }, operation("unknown"), { ...operation("succeeded"), state: ["succeeded"] }, { ...operation("succeeded"), diagnostics: null }, { ...operation("succeeded"), result: "bad" }].map((value) => async () => Response.json(value)),
  ];
  for (const failure of failures) {
    const timer = clock();
    const f = fixture(async (_url, init) => init?.method === "POST" ? Response.json(accepted) : failure(), true, timer.timing);
    assert.equal(await f.run(["stop", "w", "s", "--wait"]), 5);
    const result = JSON.parse(f.stdout);
    for (const [key, value] of Object.entries(accepted)) assert.equal(result[key], value);
    assert.equal(result.state, "waiting");
    assert.equal(result.error.code, "OPERATION_OBSERVATION_UNAVAILABLE");
    assert.equal(result.result, null);
    assert.equal(result.diagnostics, null);
    assert.equal(f.calls.length, 2);
    assert.equal(timer.cleared, true);
  }
});

test("deadline bounds pending polls, stalled fetch, and stalled body without a second mutation", async () => {
  for (const phase of ["pending", "fetch", "body"]) {
    const timer = clock();
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => { requestStarted = resolve; });
    const f = fixture(async (_url, init) => {
      if (init?.method === "POST") return Response.json(accepted);
      requestStarted();
      if (phase === "pending") return Response.json(operation("pending"));
      if (phase === "fetch") return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
      return new Response(new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(Buffer.from('{"state":')); } }));
    }, true, timer.timing);
    const result = f.run(["stop", "w", "s", "--wait"]);
    if (phase !== "pending") { await started; await new Promise<void>((resolve) => setImmediate(resolve)); timer.fire(); }
    assert.equal(await result, 5);
    assert.equal(JSON.parse(f.stdout).error.code, "OPERATION_WAIT_TIMEOUT");
    assert.equal(JSON.parse(f.stdout).serviceId, "s");
    assert.equal(f.calls.filter((call) => call.init?.method === "POST").length, 1);
    assert.equal(timer.cleared, true);
    if (phase === "pending") assert.equal(timer.sleeps.reduce((a, b) => a + b, 0), 120_000);
  }
});

test("logs preserve bounded content and distinguish empty, truncated, and unavailable", async () => {
  for (const json of [true, false]) {
    for (const [status, text] of [["available", ""], ["available", "line"], ["available", "line\n"], ["truncated", "secret=[redacted]"], ["unavailable", ""]] as const) {
      const logs = { serviceId: "s", status, text, truncated: status === "truncated", collectedAt: "now", ...(status === "unavailable" ? { reason: "No instance" } : {}) };
      const f = fixture(async () => Response.json(logs), json);
      assert.equal(await f.run(["logs", "w", "s"]), status === "unavailable" ? 5 : 0);
      assert.equal(f.calls.length, 1);
      assert.ok(f.calls[0]!.url.endsWith("/logs?tailLines=100"));
      if (json) assert.deepEqual(JSON.parse(f.stdout), { workId: "w", ...logs });
      else {
        assert.equal(f.stdout, text === "" || text.endsWith("\n") ? text : `${text}\n`);
        assert.equal(f.stderr, status === "truncated" ? "Service logs are truncated.\n" : status === "unavailable" ? "No instance\n" : "");
      }
    }
  }
});
