import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SnapshotHelperAvailability, SnapshotHelperUnavailableError } from "./helper-availability.js";
import { CoreApplication } from "../application/core-application.js";
import { ensureCorePaths } from "../application/paths.js";

test("missing helper is snapshot-only unavailable; configured tag is captured once", async () => {
  let calls = 0;
  const resolver = async () => { calls++; return `sha256:${"a".repeat(64)}`; };
  const missing = await SnapshotHelperAvailability.resolve(undefined, resolver);
  assert.deepEqual(missing.status(), { configured: false, available: false }); assert.equal(calls, 0);
  assert.throws(() => missing.requireImage(), (error: unknown) => error instanceof SnapshotHelperUnavailableError && error.status === 503);
  const configured = await SnapshotHelperAvailability.resolve("operator/helper:trusted", resolver);
  assert.equal(configured.requireImage(), `sha256:${"a".repeat(64)}`); configured.requireImage(); assert.equal(calls, 1);
  const unavailable = await SnapshotHelperAvailability.resolve("operator/helper:missing", async () => { throw new Error("Docker unavailable: sensitive diagnostics"); });
  assert.deepEqual(unavailable.status(), { configured: true, available: false }); assert.throws(() => unavailable.requireImage(), /Snapshot helper is not available/);
});

test("Core still starts and serves readiness when snapshot helper configuration is missing or broken", async () => {
  for (const image of [undefined, "operator/helper:missing"]) {
    const directory = await mkdtemp(join(tmpdir(), "piwork-helper-readiness-"));
    const application = await CoreApplication.create({ paths: ensureCorePaths(directory), snapshotHelperImage: image, snapshotHelperResolver: async () => { throw new Error("unavailable"); } });
    try {
      const address = await application.listen({ host: "127.0.0.1", port: 0 }); assert.ok(address.port > 0);
      assert.equal(application.status().state, "ADMIN_REQUIRED");
      assert.equal(application.snapshotHelper.status().available, false);
      assert.throws(() => application.snapshotHelper.requireImage(), SnapshotHelperUnavailableError);
    } finally { await application.close(); await rm(directory, { recursive: true, force: true }); }
  }
});

test("ready Core returns HTTP 503 for snapshot mutation when trusted helper is unavailable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwork-helper-http-"));
  const application = await CoreApplication.create({ paths: ensureCorePaths(directory), initialization: {
    administrator: { account: "owner", password: "correct horse battery" },
    runtime: { agentImage: "recipient:default", provider: "deterministic", model: "test", credential: "TARGET_CREDENTIAL" },
  }, runtimeFactory: async () => ({ async prepare() {}, async start() { throw new Error("must not start"); },
    async inspect() { return { exists: false, running: false, ready: false }; }, async drain() {}, async stop() {}, async remove() {} }) });
  try {
    const address = await application.listen({ host: "127.0.0.1", port: 0 }), base = `http://127.0.0.1:${address.port}`;
    const login = await fetch(`${base}/api/v1/login`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ account: "owner", password: "correct horse battery" }) });
    const token = String((await login.json() as { token: string }).token);
    const exportResponse = await fetch(`${base}/api/v1/works/work-unknown/exports`, { method: "POST", headers: {
      authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey: "key" }) });
    assert.equal(exportResponse.status, 503);
    assert.equal((await exportResponse.json() as { code: string }).code, "SNAPSHOT_HELPER_UNAVAILABLE");
  } finally { await application.close(); await rm(directory, { recursive: true, force: true }); }
});
