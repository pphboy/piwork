import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { exitCodeFor, formatTerminalRunFailure, parseSkillSelection } from "./main.js";
import { FileCredentialStore, PiworkApiError } from "@piwork/client-sdk";

const executable = resolve("dist/main.js");

test("compiled CLI help and usage failures do not contact Core", () => {
  const help = run(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /work create/);
  for (const command of ["status", "login", "whoami", "logout", "work", "operation", "session", "run", "chat"]) {
    const commandHelp = run([command, "--help"]);
    assert.equal(commandHelp.status, 0, `${command} help should succeed`);
    assert.match(commandHelp.stdout, new RegExp(`usage: piwork-cli ${command}`));
    assert.doesNotMatch(commandHelp.stderr, /ECONNREFUSED|not logged in|stack| at /);
  }
  const unknown = run(["unknown"]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown command/);
  assert.doesNotMatch(unknown.stderr, /ECONNREFUSED|stack| at /);
  for (const args of [["admin", "users", "list"], ["config", "show"]]) {
    const wrongSurface = run(args);
    assert.equal(wrongSurface.status, 2);
    assert.doesNotMatch(wrongSurface.stderr, /ECONNREFUSED|stack|\n\s+at /);
  }
  const missing = run(["--core"]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /requires a value/);
});

test("documented safe error classes map to stable exit statuses", () => {
  assert.equal(exitCodeFor(Object.assign(new Error("usage"), { exitCode: 2 })), 2);
  assert.equal(exitCodeFor(new PiworkApiError(401, "AUTH", "auth")), 3);
  assert.equal(exitCodeFor(new PiworkApiError(404, "NOT_FOUND", "missing")), 4);
  assert.equal(exitCodeFor(new PiworkApiError(503, "UNAVAILABLE", "down")), 5);
  assert.equal(exitCodeFor(new PiworkApiError(409, "CONFLICT", "stale")), 6);
  assert.equal(exitCodeFor(new Error("unexpected")), 1);
});

test("terminal chat failures print the safe Run error and recovery command", () => {
  const message = formatTerminalRunFailure("work-1", "run-1", {
    state: 5,
    error: { code: "MODEL_EXECUTION_FAILED", message: "Model execution failed.", retryable: true },
  });
  assert.match(message, /State: failed/);
  assert.match(message, /Code: MODEL_EXECUTION_FAILED/);
  assert.match(message, /Reason: Model execution failed\./);
  assert.match(message, /Retryable: yes/);
  assert.match(message, /piwork-cli run show work-1 run-1/);
});

test("Skill selection flags distinguish default, explicit, and empty selections", () => {
  assert.equal(parseSkillSelection([], false), undefined);
  assert.deepEqual(parseSkillSelection(["--skill", "alpha", "--skill", "beta"], false), ["alpha", "beta"]);
  assert.deepEqual(parseSkillSelection(["--no-skills"], true), []);
  assert.throws(() => parseSkillSelection([], true), /select at least one/);
  assert.throws(() => parseSkillSelection(["--skill", "alpha", "--skill", "alpha"], false), /may not be repeated/);
  assert.throws(() => parseSkillSelection(["--skill", "alpha", "--no-skills"], false), /mutually exclusive/);
  assert.throws(() => parseSkillSelection(["--no-skills", "--no-skills"], false), /only once/);
});

test("service help and syntax precede credential loading, while valid commands require login", () => {
  for (const args of [["--help"], ["-h"], ...["list", "show", "start", "stop", "restart", "retry", "remove", "logs"].map((action) => [action, "--help"])]) {
    const result = run(["work", "service", ...args], true);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /work service/);
    assert.match(result.stdout, /persistently disables/);
    assert.match(result.stdout, /pi-agentd/);
    assert.equal(result.stderr, "");
  }
  for (const args of [["create"], ["update"], ["create", "--help"], ["show"], ["stop", "w", "s", "--wait", "--wait"]]) {
    const result = run(["work", "service", ...args], true);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /usage:/);
    assert.doesNotMatch(result.stderr, /credential file/);
  }
  const noLogin = run(["work", "service", "list", "w"]);
  assert.equal(noLogin.status, 3);
  assert.match(noLogin.stderr, /not logged in/);
});

test("compiled service commands use HTTP, preserve one JSON result, and map request errors", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-cli-service-"));
  const config = join(root, "client.json");
  const calls: Array<{ method: string; path: string; body: unknown; authorization?: string }> = [];
  const acceptance = { workId: "w", serviceId: "s", operationId: "op", correlationId: "op", reused: true };
  const service = { workId: "w", serviceId: "s", name: "demo", enabled: true, observedState: "failed", desiredRevision: 1, appliedRevision: null, lastError: null, endpoints: [], createdAt: "now", definition: { environment: { PASSWORD: "sentinel" } } };
  let status = 200;
  let state = "succeeded";
  let observationStatus = 200;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    calls.push({ method: request.method!, path: request.url!, body: body === "" ? undefined : JSON.parse(body), authorization: request.headers.authorization });
    if (status === 0) { request.socket.destroy(); return; }
    const isOperation = request.url!.startsWith("/api/v1/operations/");
    const responseStatus = isOperation ? observationStatus : status;
    response.writeHead(responseStatus, { "content-type": "application/json" });
    if (responseStatus !== 200) { response.end(JSON.stringify({ code: "FAILED", message: "Bearer user-token password=sentinel" })); return; }
    const operation = { operationId: "op", workId: "w", correlationId: "op", kind: "stop-service", state, createdAt: "now", updatedAt: "now", result: null, error: state === "failed" ? { code: "SERVICE_EXITED", message: "safe reason" } : null, diagnostics: {} };
    const value = isOperation ? operation
      : request.url!.endsWith("/logs?tailLines=200") ? { serviceId: "s", status: "available", text: "line\n", truncated: false, collectedAt: "now" }
      : request.method === "POST" ? request.url === "/api/v1/works/w/start" ? { workId: "w", operationId: "op" } : acceptance
      : request.url!.endsWith("/services") ? { services: [service] } : service;
    response.end(JSON.stringify(value));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const coreUrl = `http://127.0.0.1:${address.port}`;
  const invoke = (args: string[]) => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [executable, "--core", coreUrl, "--json", ...args], {
      env: { ...process.env, PIWORK_CONFIG_PATH: config, PIWORK_CORE_URL: "http://127.0.0.1:1" },
      stdio: ["ignore", "pipe", "pipe"], timeout: 10_000,
    });
    let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ status: code, stdout, stderr }));
  });
  try {
    await new FileCredentialStore(config).save({ version: 1, coreUrl: "http://127.0.0.1:1", token: "user-token", expiresAt: "2099-01-01T00:00:00Z", user: { id: "u", account: "owner", role: "user" } });
    for (const action of ["list", "show"]) {
      calls.length = 0;
      const result = await invoke(["work", "service", action, "w", ...(action === "show" ? ["demo"] : [])]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.authorization, "Bearer user-token");
      assert.equal(result.stdout.trim().split("\n").length, 1);
      assert.doesNotMatch(result.stdout, /sentinel|definition/);
    }
    for (const action of ["start", "stop", "restart", "retry", "remove"]) {
      calls.length = 0;
      const result = await invoke(["work", "service", action, "w", "s", "--idempotency-key", "same-key"]);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), acceptance);
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0]!.body, { idempotencyKey: "same-key" });
      assert.ok(calls[0]!.path.endsWith(`/${action === "start" ? "enable" : action === "stop" ? "disable" : action}`));
    }
    for (const terminal of ["succeeded", "failed", "superseded"]) {
      state = terminal;
      calls.length = 0;
      const result = await invoke(["work", "service", "remove", "w", "s", "--wait"]);
      assert.equal(result.status, terminal === "succeeded" ? 0 : 6, result.stderr);
      assert.equal(result.stdout.trim().split("\n").length, 1);
      assert.equal(JSON.parse(result.stdout).serviceId, "s");
      assert.deepEqual(calls.map((call) => call.method), ["POST", "GET"]);
    }
    for (const errorStatus of [401, 403]) {
      observationStatus = errorStatus;
      const result = await invoke(["work", "service", "stop", "w", "s", "--wait"]);
      assert.equal(result.status, 5);
      assert.equal(JSON.parse(result.stdout).error.code, "OPERATION_OBSERVATION_UNAVAILABLE");
    }
    observationStatus = 200;
    state = "failed";
    assert.equal((await invoke(["operation", "show", "op"])).status, 0);
    state = "succeeded";
    const legacy = await invoke(["work", "start", "w", "--wait"]);
    assert.equal(legacy.status, 0, legacy.stderr);
    assert.equal(JSON.parse(legacy.stdout).serviceId, undefined);
    const logs = await invoke(["work", "service", "logs", "w", "s", "--tail", "200"]);
    assert.equal(logs.status, 0);
    assert.equal(JSON.parse(logs.stdout).text, "line\n");
    for (const [http, exit] of [[0, 5], [401, 3], [403, 3], [404, 4], [502, 5], [503, 5], [504, 5], [409, 6], [429, 1], [500, 1]]) {
      status = http!;
      calls.length = 0;
      const result = await invoke(["work", "service", "stop", "w", "s", "--wait"]);
      assert.equal(result.status, exit, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(calls.length, 1);
      assert.doesNotMatch(result.stderr, /user-token|sentinel|\n\s+at /);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});

function run(args: readonly string[], malformedCredential = false) {
  const root = mkdtempSync(join(tmpdir(), "piwork-cli-test-"));
  try {
    if (malformedCredential) writeFileSync(join(root, "client.json"), "not-json", { mode: 0o600 });
    const result = spawnSync(process.execPath, [executable, ...args], {
      encoding: "utf8",
      env: { ...process.env, PIWORK_CONFIG_PATH: join(root, "client.json"), PIWORK_CORE_URL: "http://127.0.0.1:1" },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
