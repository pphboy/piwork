import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoreApplication } from "../application/core-application.js";
import { ensureCorePaths } from "../application/paths.js";
import { Check } from "typebox/value";
import { FileAccessCapabilitySchema } from "@piwork/contracts";
import { FileHelperAvailability, FileHelperUnavailableError } from "./availability.js";

const IMAGE = `sha256:${"a".repeat(64)}`;

test("file helper resolution captures an immutable image without blocking Core startup", async () => {
  const missing = await FileHelperAvailability.resolve(undefined, async () => { throw new Error("should not inspect"); });
  assert.deepEqual(missing.status(), { configured: false, available: false });
  assert.throws(() => missing.requireImage(), FileHelperUnavailableError);
  const incompatible = await FileHelperAvailability.resolve("old-helper:local", async () => { throw new Error("FILE_HELPER_IMAGE_INCOMPATIBLE"); });
  assert.deepEqual(incompatible.status(), { configured: true, available: false });
  const unavailable = await FileHelperAvailability.resolve("missing-helper:local", async () => { throw new Error("Docker unavailable"); });
  assert.deepEqual(unavailable.status(), { configured: true, available: false });
  const ready = await FileHelperAvailability.resolve("file-helper:local", async () => IMAGE);
  assert.deepEqual(ready.status(), { configured: true, available: true });
  assert.equal(ready.requireImage(), IMAGE);
});

test("authenticated file capability reports available only for a compatible configured image", async () => {
  for (const [reference, resolves] of [[undefined, false], ["old-helper:local", false], ["helper:local", true]] as const) {
    const directory = await mkdtemp(join(tmpdir(), "piwork-file-capability-"));
    const application = await CoreApplication.create({ paths: ensureCorePaths(directory),
      initialization: { administrator: { account: "owner", password: "correct horse battery" } },
      fileHelperImage: reference,
      fileHelperResolver: async () => {
        if (!resolves) throw new Error("FILE_HELPER_IMAGE_INCOMPATIBLE");
        return IMAGE;
      } });
    try {
      const address = await application.listen({ host: "127.0.0.1", port: 0 });
      const base = `http://127.0.0.1:${address.port}`;
      const unauthorized = await fetch(`${base}/api/v1/file-access`);
      assert.equal(unauthorized.status, 401);
      const login = await fetch(`${base}/api/v1/login`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: "owner", password: "correct horse battery" }) });
      const token = (await login.json() as { token: string }).token;
      const response = await fetch(`${base}/api/v1/file-access`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.status, 200);
      const capability = await response.json();
      assert.equal(Check(FileAccessCapabilitySchema, capability), true);
      assert.equal((capability as { available: boolean }).available, resolves);
    } finally { await application.close(); await rm(directory, { recursive: true, force: true }); }
  }
});
