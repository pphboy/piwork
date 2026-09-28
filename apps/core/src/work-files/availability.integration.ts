import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreApplication } from "../application/core-application.js";
import { ensureCorePaths } from "../application/paths.js";

const image = process.env.PIWORK_FILE_HELPER_TEST_IMAGE;

test("configured real file helper image reports available through authenticated Core capability", {
  skip: image === undefined, timeout: 30_000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwork-file-capability-docker-"));
  const application = await CoreApplication.create({ paths: ensureCorePaths(directory), fileHelperImage: image,
    initialization: { administrator: { account: "owner", password: "correct horse battery" } } });
  try {
    const address = await application.listen({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${address.port}`;
    const login = await fetch(`${base}/api/v1/login`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ account: "owner", password: "correct horse battery" }) });
    assert.equal(login.status, 200);
    const token = (await login.json() as { token: string }).token;
    const response = await fetch(`${base}/api/v1/file-access`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const capability = await response.json() as { version: number; available: boolean; reason: string | null };
    assert.deepEqual({ version: capability.version, available: capability.available, reason: capability.reason },
      { version: 1, available: true, reason: null });
  } finally { await application.close(); await rm(directory, { recursive: true, force: true }); }
});
