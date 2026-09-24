import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ReadableStream } from "node:stream/web";
import { createServer } from "node:http";
import test from "node:test";
import { FileCredentialStore, PiworkClient } from "@piwork/client-sdk";
import { encodeWorkPackage } from "@piwork/work-package";
import { goldenWorkFixture } from "../../../packages/work-package/dist/fixture.js";
import { executeWorkSnapshotCommand, parseWorkSnapshotCommand } from "./work-snapshot.js";

async function golden() {
  const fixture = goldenWorkFixture(), chunks: Buffer[] = [];
  for await (const chunk of encodeWorkPackage(fixture.spec, async function* (blob) { yield fixture.data.get(blob.digest)!; })) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks); return { bytes, digest: createHash("sha256").update(bytes).digest("hex") };
}

test("snapshot parser covers four commands, early help and rejects filters, repeats and omitted operands", () => {
  assert.equal(parseWorkSnapshotCommand(["list"]), undefined);
  assert.deepEqual(parseWorkSnapshotCommand(["package", "inspect", "demo.work"]), { kind: "inspect", path: "demo.work" });
  assert.deepEqual(parseWorkSnapshotCommand(["snapshot", "download", "snap-1", "--output", "out.work"]), { kind: "download", snapshotId: "snap-1", output: "out.work" });
  assert.equal(parseWorkSnapshotCommand(["export", "--help"])?.kind, "help");
  assert.equal(parseWorkSnapshotCommand(["import", "--help"])?.kind, "help");
  assert.deepEqual(parseWorkSnapshotCommand(["export", "work-000000000001", "--idempotency-key", "key"]),
    { kind: "export", workId: "work-000000000001", output: "work-000000000001.work", idempotencyKey: "key" });
  assert.equal(parseWorkSnapshotCommand(["import", "x.work", "--wait"])?.kind, "import");
  for (const args of [["export", "work-1", "--output", "-"], ["export", "work-1", "--output", "a", "--output", "b"],
    ["export", "work-1", "--exclude", ".env", "--output", "a"], ["import", "x.work", "--bindings", "x.json"],
    ["export", "../work-000000000001"], ["import", "x.work", "--name", "one", "--name", "two"],
    ["package", "inspect", "x.work", "extra"]]) assert.throws(() => parseWorkSnapshotCommand(args), { exitCode: 2 });
});

test("offline inspect emits only safe metadata, with no network or credential", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-cli-inspect-"));
  try {
    const { bytes } = await golden(), path = join(root, "source.work"); writeFileSync(path, bytes);
    const lines: string[] = [];
    const client = new PiworkClient({ coreUrl: "http://unreachable.invalid", fetch: async () => { throw new Error("must not fetch"); } });
    const code = await executeWorkSnapshotCommand({ client, json: true, stdout: (value) => lines.push(value), stderr: () => {} },
      { kind: "inspect", path });
    assert.equal(code, 0); assert.equal(lines.length, 1);
    const summary = JSON.parse(lines[0]!);
    assert.equal(summary.integrityVerified, true); assert.equal(summary.installationValidated, false);
    assert.equal(lines[0]!.includes("PRIVATE_CONTENT_SENTINEL"), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("compiled CLI handles snapshot help and offline inspect before loading credentials", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-cli-compiled-inspect-"));
  try {
    const { bytes } = await golden(), path = join(root, "demo.work"); writeFileSync(path, bytes);
    const main = fileURLToPath(new URL("./main.js", import.meta.url));
    const environment = { ...process.env, PIWORK_CORE_URL: "http://unreachable.invalid", PIWORK_CLI_CREDENTIAL_PATH: join(root, "missing-credentials.json") };
    const help = spawnSync(process.execPath, [main, "work", "export", "--help"], { encoding: "utf8", env: environment });
    assert.equal(help.status, 0); assert.match(help.stdout, /work export/);
    const inspect = spawnSync(process.execPath, [main, "--json", "work", "package", "inspect", path], { encoding: "utf8", env: environment });
    assert.equal(inspect.status, 0, inspect.stderr);
    assert.equal(JSON.parse(inspect.stdout).integrityVerified, true);
    assert.equal(inspect.stdout.includes("PRIVATE_CONTENT_SENTINEL"), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("download publishes a verified 0600 file without overwriting an existing or raced destination", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-cli-download-"));
  try {
    const { bytes, digest } = await golden(), path = join(root, "copy.work"), lines: string[] = [];
    const client = new PiworkClient({ coreUrl: "http://core.test", fetch: async (input) => {
      if (String(input).endsWith("/content")) return new Response(bytes, { headers: { "content-type": "application/vnd.piwork.work-package", "content-length": String(bytes.length), "x-piwork-sha256": digest } });
      return Response.json({ workId: "work-1", snapshotId: "snapshot-1", operationId: "operation-1", state: "succeeded", digest, size: bytes.length, expiresAt: "later", error: null });
    } });
    await executeWorkSnapshotCommand({ client, json: true, stdout: (value) => lines.push(value), stderr: () => {} },
      { kind: "download", snapshotId: "snapshot-1", output: path });
    assert.deepEqual(readFileSync(path), bytes); assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(JSON.parse(lines[0]!).digest, digest); assert.equal(lines.length, 1);
    await assert.rejects(executeWorkSnapshotCommand({ client, json: true, stdout: () => {}, stderr: () => {} },
      { kind: "download", snapshotId: "snapshot-1", output: path }));
    assert.deepEqual(readFileSync(path), bytes);
    const raced = join(root, "raced.work");
    const raceClient = new PiworkClient({ coreUrl: "http://core.test", fetch: async (input) => {
      if (String(input).endsWith("/content")) {
        writeFileSync(raced, "another-user-file");
        return new Response(bytes, { headers: { "content-type": "application/vnd.piwork.work-package", "content-length": String(bytes.length), "x-piwork-sha256": digest } });
      }
      return Response.json({ workId: "work-1", snapshotId: "snapshot-1", operationId: "operation-1", state: "succeeded", digest, size: bytes.length });
    } });
    await assert.rejects(executeWorkSnapshotCommand({ client: raceClient, json: true, stdout: () => {}, stderr: () => {} },
      { kind: "download", snapshotId: "snapshot-1", output: raced }));
    assert.equal(readFileSync(raced, "utf8"), "another-user-file");
    symlinkSync(root, join(root, "alias"));
    await assert.rejects(executeWorkSnapshotCommand({ client, json: true, stdout: () => {}, stderr: () => {} },
      { kind: "download", snapshotId: "snapshot-1", output: join(root, "alias", "linked.work") }));
    const corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1;
    const corruptClient = new PiworkClient({ coreUrl: "http://core.test", fetch: async (input) => String(input).endsWith("/content")
      ? new Response(corrupt, { headers: { "content-type": "application/vnd.piwork.work-package", "content-length": String(bytes.length), "x-piwork-sha256": digest } })
      : Response.json({ workId: "work-1", snapshotId: "snapshot-1", operationId: "operation-1", state: "succeeded", digest, size: bytes.length }) });
    const corruptPath = join(root, "corrupt.work");
    await assert.rejects(executeWorkSnapshotCommand({ client: corruptClient, json: true, stdout: () => {}, stderr: () => {} },
      { kind: "download", snapshotId: "snapshot-1", output: corruptPath }), /digest mismatch/);
    assert.equal(existsSync(corruptPath), false);
    await executeWorkSnapshotCommand({ client, json: true, stdout: () => {}, stderr: () => {} },
      { kind: "download", snapshotId: "snapshot-1", output: corruptPath });
    assert.deepEqual(readFileSync(corruptPath), bytes);
    const interrupted = new PiworkClient({ coreUrl: "http://core.test", fetch: async (input) => String(input).endsWith("/content")
      ? new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.subarray(0, 32)); controller.error(new Error("transfer interrupted")); } }),
        { headers: { "content-type": "application/vnd.piwork.work-package", "content-length": String(bytes.length), "x-piwork-sha256": digest } })
      : Response.json({ workId: "work-1", snapshotId: "snapshot-1", operationId: "operation-1", state: "succeeded", digest, size: bytes.length }) });
    const interruptedPath = join(root, "interrupted.work");
    await assert.rejects(executeWorkSnapshotCommand({ client: interrupted, json: true, stdout: () => {}, stderr: () => {} },
      { kind: "download", snapshotId: "snapshot-1", output: interruptedPath }));
    assert.equal(existsSync(interruptedPath), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("export emits one final JSON result and a verified file without exposing an intermediate acceptance", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-cli-export-"));
  try {
    const { bytes, digest } = await golden(), path = join(root, "export.work"), calls: string[] = [], lines: string[] = [];
    const client = new PiworkClient({ coreUrl: "http://core.test", fetch: async (input) => {
      const route = new URL(String(input)).pathname; calls.push(route);
      if (route === "/api/v1/works/work-1/exports") return Response.json({ workId: "work-1", snapshotId: "snapshot-1", operationId: "operation-1", correlationId: "operation-1", reused: false }, { status: 202 });
      if (route === "/api/v1/operations/operation-1") return Response.json({ id: "operation-1", state: "succeeded" });
      if (route === "/api/v1/work-snapshots/snapshot-1/content") return new Response(bytes, { headers: { "content-type": "application/vnd.piwork.work-package", "content-length": String(bytes.length), "x-piwork-sha256": digest } });
      if (route === "/api/v1/work-snapshots/snapshot-1") return Response.json({ workId: "work-1", snapshotId: "snapshot-1", operationId: "operation-1", state: "succeeded", digest, size: bytes.length, expiresAt: "later", error: null });
      throw new Error(`unexpected route ${route}`);
    } });
    assert.equal(await executeWorkSnapshotCommand({ client, json: true, stdout: (line) => lines.push(line), stderr: () => {} },
      { kind: "export", workId: "work-1", output: path, idempotencyKey: "export-once" }), 0);
    assert.deepEqual(calls, ["/api/v1/works/work-1/exports", "/api/v1/operations/operation-1", "/api/v1/work-snapshots/snapshot-1", "/api/v1/work-snapshots/snapshot-1/content"]);
    assert.equal(lines.length, 1); assert.deepEqual(JSON.parse(lines[0]!), { workId: "work-1", snapshotId: "snapshot-1", operationId: "operation-1", path, digest, size: bytes.length });
    assert.deepEqual(readFileSync(path), bytes); assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("120-second export wait timeout retains snapshot ID for a later download", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-cli-export-timeout-"));
  const dateNow = Date.now;
  try {
    const path = join(root, "later.work"), calls: string[] = [], lines: string[] = [];
    const client = new PiworkClient({ coreUrl: "http://core.test", fetch: async (input) => {
      const route = new URL(String(input)).pathname; calls.push(route);
      if (route === "/api/v1/works/work-1/exports") return Response.json({ workId: "work-1", snapshotId: "snapshot-1", operationId: "operation-1", correlationId: "operation-1", reused: false }, { status: 202 });
      return Response.json({ id: "operation-1", state: "pending" });
    } });
    let tick = 0;
    Date.now = () => ++tick === 1 ? 0 : 120_001;
    await assert.rejects(executeWorkSnapshotCommand({ client, json: true, stdout: (line) => lines.push(line), stderr: () => {} },
      { kind: "export", workId: "work-1", output: path, idempotencyKey: "export-once" }),
    (error: unknown) => {
      assert.equal((error as { exitCode?: number }).exitCode, 5);
      assert.match(String(error), /work snapshot download snapshot-1 --output <file>/);
      return true;
    });
    assert.deepEqual(calls, ["/api/v1/works/work-1/exports", "/api/v1/operations/operation-1"]);
    assert.equal(lines.length, 1); assert.equal(JSON.parse(lines[0]!).snapshotId, "snapshot-1");
    assert.equal(existsSync(path), false);
  } finally { Date.now = dateNow; rmSync(root, { recursive: true, force: true }); }
});

test("import uploads verified bytes once, waits on the original Operation, and never starts the Work", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-cli-import-wait-"));
  try {
    const { bytes, digest } = await golden(), path = join(root, "portable.work"); writeFileSync(path, bytes);
    const calls: string[] = [], lines: string[] = [], warnings: string[] = [];
    const client = new PiworkClient({ coreUrl: "http://core.test", fetch: async (input, init) => {
      const route = new URL(String(input)).pathname; calls.push(route);
      if (route === "/api/v1/work-packages") return Response.json({ packageId: "package-1", digest, size: bytes.length,
        expiresAt: "2026-09-24T00:00:00.000Z", bindingRequirements: { models: [], secrets: [] } }, { status: 201 });
      if (route === "/api/v1/work-imports") {
        assert.equal("name" in JSON.parse(String(init?.body)), false);
        return Response.json({ workId: "work-copy", name: "golden", operationId: "operation-import", correlationId: "operation-import", reused: false }, { status: 202 });
      }
      if (route === "/api/v1/operations/operation-import") return Response.json({ id: "operation-import", state: "succeeded" });
      throw new Error(`unexpected route ${route}`);
    } });
    const code = await executeWorkSnapshotCommand({ client, json: true, stdout: (line) => lines.push(line), stderr: (line) => warnings.push(line) },
      { kind: "import", path, wait: true, idempotencyKey: "import-once" });
    assert.equal(code, 0); assert.deepEqual(calls, ["/api/v1/work-packages", "/api/v1/work-imports", "/api/v1/operations/operation-import"]);
    assert.equal(lines.length, 1); assert.equal(JSON.parse(lines[0]!).state, "succeeded"); assert.equal(JSON.parse(lines[0]!).name, "golden");
    assert.match(warnings.join(""), /complete private Work/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a package changed during upload is not submitted for import", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-cli-import-race-"));
  try {
    const { bytes, digest } = await golden(), path = join(root, "portable.work"); writeFileSync(path, bytes);
    const calls: string[] = [];
    const client = new PiworkClient({ coreUrl: "http://core.test", fetch: async (input) => {
      const route = new URL(String(input)).pathname; calls.push(route);
      if (route !== "/api/v1/work-packages") throw new Error("import must not be submitted");
      writeFileSync(path, Buffer.concat([bytes, Buffer.from("changed")]));
      return Response.json({ packageId: "package-1", digest, size: bytes.length }, { status: 201 });
    } });
    await assert.rejects(executeWorkSnapshotCommand({ client, json: true, stdout: () => {}, stderr: () => {} },
      { kind: "import", path, name: "copy", wait: false, idempotencyKey: "key" }), /changed during upload/);
    assert.deepEqual(calls, ["/api/v1/work-packages"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("import observation failure and terminal failure keep one accepted identity without resubmission", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-cli-import-observe-"));
  try {
    const { bytes, digest } = await golden(), path = join(root, "portable.work"); writeFileSync(path, bytes);
    for (const state of ["unavailable", "failed"] as const) {
      const calls: string[] = [], lines: string[] = [];
      const client = new PiworkClient({ coreUrl: "http://core.test", fetch: async (input) => {
        const route = new URL(String(input)).pathname; calls.push(route);
        if (route === "/api/v1/work-packages") return Response.json({ packageId: "package-1", digest, size: bytes.length }, { status: 201 });
        if (route === "/api/v1/work-imports") return Response.json({ workId: "work-copy", operationId: "operation-import", correlationId: "operation-import", reused: false }, { status: 202 });
        if (state === "unavailable") throw new Error("observer disconnected");
        return Response.json({ id: "operation-import", state: "failed", error: { code: "SAFE_FAILURE" } });
      } });
      await assert.rejects(executeWorkSnapshotCommand({ client, json: true, stdout: (line) => lines.push(line), stderr: () => {} },
        { kind: "import", path, name: "copy", wait: true, idempotencyKey: "once" }), { exitCode: state === "unavailable" ? 5 : 6 });
      assert.deepEqual(calls, ["/api/v1/work-packages", "/api/v1/work-imports", "/api/v1/operations/operation-import"]);
      assert.equal(lines.length, 1);
      assert.equal(JSON.parse(lines[0]!).state, state === "unavailable" ? "waiting" : "failed");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("120-second import wait timeout is reported as waiting and does not cancel its Operation", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-cli-import-timeout-"));
  const dateNow = Date.now;
  try {
    const { bytes, digest } = await golden(), path = join(root, "portable.work"); writeFileSync(path, bytes);
    const calls: string[] = [], lines: string[] = [];
    const client = new PiworkClient({ coreUrl: "http://core.test", fetch: async (input) => {
      const route = new URL(String(input)).pathname; calls.push(route);
      if (route === "/api/v1/work-packages") return Response.json({ packageId: "package-1", digest, size: bytes.length }, { status: 201 });
      if (route === "/api/v1/work-imports") return Response.json({ workId: "work-copy", operationId: "operation-import", correlationId: "operation-import", reused: false }, { status: 202 });
      return Response.json({ id: "operation-import", state: "pending" });
    } });
    let tick = 0;
    Date.now = () => ++tick === 1 ? 0 : 120_001;
    await assert.rejects(executeWorkSnapshotCommand({ client, json: true, stdout: (line) => lines.push(line), stderr: () => {} },
      { kind: "import", path, name: "copy", wait: true, idempotencyKey: "once" }), { exitCode: 5 });
    assert.deepEqual(calls, ["/api/v1/work-packages", "/api/v1/work-imports", "/api/v1/operations/operation-import"]);
    assert.equal(lines.length, 1); assert.equal(JSON.parse(lines[0]!).state, "waiting");
  } finally { Date.now = dateNow; rmSync(root, { recursive: true, force: true }); }
});

test("import validates the entire local package before upload", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-cli-import-"));
  try {
    const path = join(root, "corrupt.work"); writeFileSync(path, "not a package");
    let called = false; const client = new PiworkClient({ coreUrl: "http://core.test", fetch: async () => { called = true; return Response.json({}); } });
    await assert.rejects(executeWorkSnapshotCommand({ client, json: true, stdout: () => {}, stderr: () => {} },
      { kind: "import", path, name: "copy", wait: false, idempotencyKey: "key" }));
    assert.equal(called, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("compiled CLI reports safe import error code and hint without a stdout result", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-cli-import-errors-"));
  const { bytes, digest } = await golden(), path = join(root, "first.work"), credentialPath = join(root, "credential.json");
  writeFileSync(path, bytes);
  let failure = { status: 400, code: "TARGET_MODEL_UNAVAILABLE", message: "Configure a matching target model." };
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* Consume the binary upload. */ }
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/v1/work-packages") {
      response.statusCode = 201;
      response.end(JSON.stringify({ packageId: "package-000000000001", digest, size: bytes.length,
        expiresAt: "2099-01-01T00:00:00.000Z", bindingRequirements: { models: [], secrets: [] } }));
    } else {
      response.statusCode = failure.status;
      response.end(JSON.stringify({ code: failure.code, message: failure.message }));
    }
  });
  try {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address(); assert.ok(address && typeof address === "object");
    const coreUrl = `http://127.0.0.1:${address.port}`;
    await new FileCredentialStore(credentialPath).save({ version: 1, coreUrl, token: "private-token", expiresAt: "2099-01-01T00:00:00.000Z",
      user: { id: "owner", account: "owner", role: "user" } });
    const main = fileURLToPath(new URL("./main.js", import.meta.url));
    for (const entry of [
      { status: 400, code: "TARGET_MODEL_UNAVAILABLE", message: "Configure a matching target model.", exit: 1 },
      { status: 400, code: "EXTERNAL_MCP_SECRET_UNAVAILABLE", message: "Remove custom external MCP platform secrets.", exit: 1 },
      { status: 409, code: "WORK_NAME_CONFLICT", message: "Choose another name or omit --name.", exit: 6 },
    ]) {
      failure = entry;
      const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>((done, reject) => {
        const child = spawn(process.execPath, [main, "--core", coreUrl, "--json", "work", "import", path],
          { env: { ...process.env, PIWORK_CONFIG_PATH: credentialPath }, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "", stderr = "";
        child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
        child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
        child.once("error", reject); child.once("close", (status) => done({ status, stdout, stderr }));
      });
      assert.equal(result.status, entry.exit, result.stderr);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, new RegExp(entry.code));
      assert.match(result.stderr, new RegExp(entry.message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(result.stderr, /private-token|Work snapshot request cannot be accepted/);
    }
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    rmSync(root, { recursive: true, force: true });
  }
});
