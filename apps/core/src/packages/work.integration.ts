import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { request as httpRequest } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { packPiPackageDirectory } from "@piwork/pi-package";
import { CoreApplication } from "../application/core-application.js";
import { ensureCorePaths } from "../application/paths.js";
import type { WorkRuntimeAdapter } from "../work-management/lifecycle.js";

const imageReference = process.env.PIWORK_PACKAGE_HELPER_TEST_IMAGE;
const execute = promisify(execFile);

test("Work installs a local package through scoped upload and owns its prepared bytes", { skip: !imageReference, timeout: 120_000 }, async () => {
  const imageId = (await execute("docker", ["image", "inspect", "--format", "{{.Id}}", imageReference!])).stdout.trim();
  const root = await mkdtemp(join(tmpdir(), "piwork-package-work-"));
  const paths = ensureCorePaths(join(root, "core"));
  const runtime: WorkRuntimeAdapter = { async resolveImageIdentity() { return imageId; },
    async prepare() {}, async start(_work, generation) { return { instanceId: `instance-${generation}`, generation }; },
    async inspect() { return { exists: false, running: false, ready: false }; }, async drain() {}, async stop() {}, async remove() {}, async listManagedInstances() { return []; } };
  const app = await CoreApplication.create({ paths, packageHelperImage: imageReference,
    runtimeFactory: async () => runtime,
    initialization: { administrator: { account: "owner", password: "correct horse battery" },
      runtime: { agentImage: imageReference!, provider: "anthropic", model: "fixture", credential: "fixture-secret" } } });
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${address.port}`;
    const login = await fetch(`${base}/api/v1/login`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ account: "owner", password: "correct horse battery" }) });
    const token = (await login.json() as { token: string }).token;
    const create = await fetch(`${base}/api/v1/works`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: `work-${randomUUID().slice(0, 8)}`, idempotencyKey: "create-work" }) });
    const workId = (await create.json() as { workId: string }).workId;
    assert.equal(create.status, 202);
    const source = join(root, "source"); await mkdir(source);
    await writeFile(join(source, "package.json"), JSON.stringify({ name: "@example/work-tools", version: "1.0.0",
      scripts: { postinstall: "node -e \"require('node:fs').writeFileSync('prepared.txt','done')\"" } }));
    const packed = await packPiPackageDirectory(source, join(root, "input.zip"));
    const zip = await readFile(join(root, "input.zip"));
    const uploaded = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const wire = httpRequest(`${base}/api/v1/works/${workId}/package-uploads`, { method: "POST", headers: {
        authorization: `Bearer ${token}`, "content-type": "application/zip", "content-length": String(zip.length),
        "x-piwork-sha256": createHash("sha256").update(zip).digest("hex"),
        "x-piwork-package-source": "local", "x-piwork-package-name": encodeURIComponent("source"),
      } }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
      });
      wire.on("error", reject); wire.end(zip);
    });
    assert.equal(uploaded.status, 201, uploaded.body);
    const uploadId = (JSON.parse(uploaded.body) as { uploadId: string }).uploadId;
    assert.equal(app.store.packages.getUpload(uploadId)?.workId, workId);
    const installed = await fetch(`${base}/api/v1/works/${workId}/packages`, { method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ source: { kind: "upload", uploadId }, idempotencyKey: "install-local" }) });
    const accepted = await installed.json() as { operationId: string };
    assert.equal(installed.status, 202, JSON.stringify(accepted));
    for (let attempt = 0; attempt < 120 && !["succeeded", "failed"].includes(app.store.packages.getJob(accepted.operationId)?.phase ?? ""); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.equal(app.store.packages.getJob(accepted.operationId)?.phase, "succeeded",
      JSON.stringify(app.store.getOperation(accepted.operationId)));
    const state = app.store.getWorkConfiguration(workId)!;
    const context = app.workContexts.load(workId, state.desiredContextId!);
    assert.equal(context.metadata.packageBindings[0]?.artifact.name, "@example/work-tools");
    assert.equal(context.configuration.packages[0]?.enabled, true);
    assert.equal(await readFile(join(context.directory, "packages", context.metadata.packageBindings[0]!.nameKey, "prepared.txt"), "utf8"), "done");
    assert.equal(app.store.packages.getUpload(uploadId)?.leaseCount, 0);
    assert.equal(packed.manifest.name, "@example/work-tools");
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});
