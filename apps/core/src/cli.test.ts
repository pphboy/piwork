import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { packPiPackageDirectory } from "@piwork/pi-package";

const cli = resolve("dist/cli.js");

test("piwork-serve publishes operator commands, keeps piwork as a compatibility alias, and rejects user commands locally", () => {
  const help = run(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /admin bootstrap/);
  assert.match(help.stdout, /config set/);
  assert.doesNotMatch(help.stdout, /\bpiwork-core\b/);

  for (const command of ["serve", "status", "admin", "config"]) {
    const result = run([command, "--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`piwork-serve ${command}`));
  }

  for (const args of [["chat"], ["login"], ["work", "create"], ["bootstrap-admin"], ["configure-runtime"]]) {
    const result = run(args);
    assert.equal(result.status, 2, `${args.join(" ")} should be a usage failure`);
    assert.doesNotMatch(result.stderr, /ECONNREFUSED|stack|\n\s+at /);
  }
});

test("workspace package metadata exposes piwork-serve, piwork compatibility, and piwork-cli", () => {
  const core = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { bin?: Record<string, string> };
  const client = JSON.parse(readFileSync(resolve("../cli/package.json"), "utf8")) as { bin?: Record<string, string> };
  assert.deepEqual(Object.keys(core.bin ?? {}), ["piwork-serve", "piwork"]);
  assert.deepEqual(Object.keys(client.bin ?? {}), ["piwork-cli"]);
});

test("default package flag errors precede operator credential access", () => {
  const result = run(["--operator-credential-file", "/nonexistent/piwork-test-credential", "config", "default-work", "set",
    "--package", "alpha", "--no-packages"]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /invalid package selection/);
  assert.doesNotMatch(result.stderr, /credential|ENOENT|ECONNREFUSED/);
});

test("package-only options are rejected before operator credential access", () => {
  const prefix = ["--operator-credential-file", "/nonexistent/piwork-test-credential"];
  for (const args of [
    ["packages", "install", "npm:tools@1.0.0", "--verbose"],
    ["packages", "update", "tools", "--source", "npm:tools@2.0.0", "--verbose"],
    ["packages", "install", "npm:tools@1.0.0", "--idempotency-key", "old-key"],
  ]) {
    const result = run([...prefix, ...args]);
    assert.equal(result.status, 2, result.stderr);
    assert.doesNotMatch(result.stderr, /ENOENT|ECONNREFUSED|operator credential file is required/);
  }
});

test("piwork-serve keeps the explicit local bootstrap entry under the new command tree", () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-serve-bootstrap-"));
  try {
    const first = run(["--data-dir", root, "admin", "bootstrap", "--account", "admin", "--password-stdin"], "correct horse battery\n");
    assert.equal(first.status, 0, first.stderr);
    assert.doesNotMatch(first.stdout + first.stderr, /correct horse battery/);
    const repeated = run(["--data-dir", root, "admin", "bootstrap", "--account", "other", "--password-stdin"], "another secret value\n");
    assert.equal(repeated.status, 1);
    assert.doesNotMatch(repeated.stdout + repeated.stderr, /another secret value/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("operator package CLI routes four sources, defaults, scoped names, and errors", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-serve-package-cli-"));
  const credential = join(root, "operator-token");
  writeFileSync(credential, `${"o".repeat(40)}\n`, { mode: 0o600 });
  const directory = join(root, "tools"); mkdirSync(directory);
  writeFileSync(join(directory, "package.json"), '{"name":"@example/tools","version":"1.0.0"}');
  const zip = join(root, "tools.zip");
  await packPiPackageDirectory(directory, zip);
  const calls: Array<{ method: string; path: string; body: unknown; authorization?: string; contentType?: string }> = [];
  const generatedKeys: string[] = [];
  let observationFailures = 0;
  let operationRunning = false;
  let observationMissing = false;
  let onObservation: (() => void) | undefined;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    calls.push({ method: request.method!, path: request.url!, body: request.headers["content-type"] === "application/zip"
      ? body : body.length ? JSON.parse(body.toString()) : null,
      authorization: request.headers.authorization, contentType: request.headers["content-type"] });
    response.setHeader("content-type", "application/json");
    if (request.url?.includes("/operations/")) {
      onObservation?.(); onObservation = undefined;
      if (observationMissing) { response.statusCode = 404; response.end('{"code":"PI_PACKAGE_NOT_FOUND","message":"not found"}'); return; }
      if (observationFailures-- > 0) { response.statusCode = 503; response.end('{"code":"UNAVAILABLE","message":"observation unavailable"}'); return; }
      if (operationRunning) { response.end('{"operationId":"operation-fixture","state":"running","packagePhase":"prepare"}'); return; }
      response.end('{"operationId":"operation-fixture","state":"succeeded","packagePhase":"succeeded"}'); return;
    }
    if ((calls.at(-1)?.body as { source?: { spec?: string } } | null)?.source?.spec === "old-image@1.0.0") {
      response.statusCode = 409;
      response.end('{"code":"PI_PACKAGE_HELPER_INCOMPATIBLE","message":"Selected agent image does not provide the package helper contract"}');
      return;
    }
    if (request.url === "/control/package-uploads") { response.statusCode = 201; response.end('{"uploadId":"upload-fixture","expiresAt":"2099-01-01T00:00:00Z"}'); return; }
    if (request.url?.endsWith("/disable")) { response.statusCode = 409; response.end('{"code":"PI_PACKAGE_IN_DEFAULTS","message":"selected by default"}'); return; }
    response.statusCode = request.method === "POST" && !request.url?.endsWith("/enable") ? 202 : 200;
    response.end(JSON.stringify(request.url === "/control/packages" && request.method === "GET" ? { packages: [] }
      : request.url?.includes("/operations/") ? { operationId: "operation-fixture", state: "succeeded" }
      : { operationId: "operation-fixture", workId: null, correlationId: "operation-fixture", reused: false,
        scope: "core", kind: "pi-package-install", name: "@example/tools" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const invoke = (args: string[]) => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "--core", `http://127.0.0.1:${address.port}`, "--operator-credential-file", credential,
      "--json", ...args], { env: { ...process.env, PIWORK_CORE_URL: "http://127.0.0.1:1" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject); child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
  try {
    for (const source of ["npm:@example/tools@1.0.0", "git:github.com/example/tools@v1", directory, zip]) {
      calls.length = 0;
      const result = await invoke(["packages", "install", source, "--default"]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(calls.at(-1)?.path, "/control/packages");
      assert.equal((calls.at(-1)?.body as { addToDefaults: boolean }).addToDefaults, true);
      const key = (calls.at(-1)?.body as { idempotencyKey: string }).idempotencyKey;
      assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      generatedKeys.push(key);
      assert.equal(calls[0]?.authorization, `Operator ${"o".repeat(40)}`);
      if (source === directory || source === zip) {
        assert.equal(calls[0]?.contentType, "application/zip");
        assert.equal(calls[0]?.path, "/control/package-uploads");
        assert.deepEqual((calls.at(-1)?.body as { source: unknown }).source, { kind: "upload", uploadId: "upload-fixture" });
      } else assert.deepEqual((calls.at(-1)?.body as { source: unknown }).source,
        { kind: source.startsWith("npm:") ? "npm" : "git", spec: source.slice(source.indexOf(":") + 1) });
    }
    assert.equal(new Set(generatedKeys).size, generatedKeys.length);
    calls.length = 0;
    assert.equal((await invoke(["packages", "update", "@example/tools", "--source", "npm:@example/tools@2.0.0"])).status, 0);
    assert.equal(calls[0]?.path, "/control/packages/%40example%2Ftools/update");
    assert.equal((await invoke(["packages", "update", "@example/tools"])).status, 2);
    assert.equal((await invoke(["packages", "disable", "@example/tools"])).status, 6);
    const incompatible = await invoke(["packages", "install", "npm:old-image@1.0.0"]);
    assert.equal(incompatible.status, 6);
    assert.match(incompatible.stderr, /PI_PACKAGE_HELPER_INCOMPATIBLE/);
    assert.doesNotMatch(incompatible.stderr, /\/workspace|secret helper output/);
    assert.equal((await invoke(["operation", "show", "operation-fixture"])).status, 0);
    observationFailures = 2;
    const waiting = await invoke(["packages", "install", "npm:@example/tools@1.0.0", "--wait", "--verbose"]);
    assert.equal(waiting.status, 0, waiting.stderr);
    assert.equal(JSON.parse(waiting.stdout).operationId, "operation-fixture");
    assert.equal(JSON.parse(waiting.stdout).state, "succeeded");
    assert.match(waiting.stderr, /observation restored/);
    assert.doesNotMatch(waiting.stdout + waiting.stderr, /secret helper output/);
    operationRunning = true;
    const seen = new Promise<void>((resolve) => { onObservation = resolve; });
    const child = spawn(process.execPath, [cli, "--core", `http://127.0.0.1:${address.port}`, "--operator-credential-file", credential,
      "--json", "packages", "install", "npm:@example/tools@1.0.0", "--wait"], { stdio: ["ignore", "pipe", "pipe"] });
    let interruptedOut = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { interruptedOut += chunk; });
    const stopped = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    await seen;
    child.kill("SIGINT");
    assert.equal(await stopped, 130);
    assert.equal(JSON.parse(interruptedOut).operationId, "operation-fixture");
    assert.equal(JSON.parse(interruptedOut).error.code, "OPERATION_WAIT_INTERRUPTED");
    operationRunning = false; observationMissing = true;
    const missing = await invoke(["packages", "install", "npm:@example/tools@1.0.0", "--wait"]);
    assert.equal(missing.status, 5);
    assert.equal(JSON.parse(missing.stdout).operationId, "operation-fixture");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});

function run(args: readonly string[], input?: string) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", input, env: { ...process.env, PIWORK_CORE_URL: "http://127.0.0.1:1" } });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
