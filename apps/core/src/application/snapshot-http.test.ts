import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DockerRuntime, managedVolumeName, type SnapshotHelperSpec } from "@piwork/runtime-docker";
import { encodeWorkPackage, readWorkPackage, type WorkBlobDirectory } from "@piwork/work-package";
import { goldenWorkFixture } from "../../../../packages/work-package/dist/fixture.js";
import { UserAdministrationService } from "../identity/user-administration.js";
import type { WorkRuntimeAdapter } from "../work-management/lifecycle.js";
import { ensureInstallationId } from "../runtime/docker-work-runtime.js";
import { CoreApplication } from "./core-application.js";
import { ensureCorePaths } from "./paths.js";

test("HTTP upload, import, export and download move one complete stopped Work without runtime start", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-snapshot-http-")), golden = goldenWorkFixture();
  const chunks: Buffer[] = [];
  for await (const chunk of encodeWorkPackage(golden.spec, async function* (blob) { yield golden.data.get(blob.digest)!; })) chunks.push(Buffer.from(chunk));
  const sourceBytes = Buffer.concat(chunks), sourceDigest = createHash("sha256").update(sourceBytes).digest("hex"), sourceBase64 = sourceBytes.toString("base64"), sourceLength = sourceBytes.length;
  const uploadBody = () => Uint8Array.from(Buffer.from(sourceBase64, "base64"));
  const helpers = new Map<string, SnapshotHelperSpec>(), volumes = new Set<string>(); let userStarts = 0;
  const workRuntime: WorkRuntimeAdapter = { async prepare() {}, async start(_work, generation) { userStarts++; return { instanceId: `instance-${generation}`, generation }; },
    async inspect() { return { exists: false, running: false, ready: false }; }, async drain() {}, async stop() {}, async remove() {} };
  const snapshotRuntime = {
    async listManagedContainers() { return []; },
    async requireManagedVolume(workId: string, logicalId: string) { return { volumeName: managedVolumeName(installationId!, workId, logicalId), created: false }; },
    async inspectCapturedImage() { return { imageId: golden.spec.images[0]!.imageId, platform: golden.spec.images[0]!.platform }; },
    async ensureManagedVolume(workId: string, logicalId: string) { const name = managedVolumeName(installationId!, workId, logicalId); volumes.add(name); return { volumeName: name, created: true }; },
    async deleteManagedVolume(workId: string, logicalId: string) { volumes.delete(managedVolumeName(installationId!, workId, logicalId)); },
    async inspectHostPlatform() { return { os: "linux", architecture: "amd64", variant: null }; },
    async loadVerifiedImage(image: { image: { imageId: string } }) { return { imageId: image.image.imageId, reused: true }; },
    async saveCapturedImage(_id: string, blobs: WorkBlobDirectory) {
      const image = golden.spec.images[0]!, bytes = golden.data.get(image.config)!;
      const stored = await blobs.put((async function* () { yield bytes; })(), bytes.length);
      return { image: { imageId: image.imageId, platform: image.platform, config: image.config, layers: [] }, blobs: [stored] };
    },
    async createSnapshotHelper(spec: SnapshotHelperSpec) { helpers.set(spec.name, spec); return spec.name; },
    async inspectSnapshotHelper() { return { running: false, exitCode: 1 }; },
    async startSnapshotHelper(name: string) {
      const spec = helpers.get(name)!;
      if (spec.action === "verify-package") {
        const verified = await readWorkPackage(createReadStream(join(spec.spoolDirectory, "package.work")));
        return { digest: verified.digest, size: verified.size, bindingRequirements: verified.spec.bindings };
      }
      if (spec.action === "restore-history" || spec.action === "verify-history") return { historyPresent: false };
      if (spec.action === "capture") {
        for (const [digest, bytes] of golden.data) writeFileSync(join(spec.spoolDirectory, digest), bytes, { mode: 0o600 });
        return { tree: golden.spec.volumes[0].tree, size: golden.data.get(golden.spec.volumes[0].tree)!.length };
      }
      return { tree: spec.treeDigest };
    },
    async removeSnapshotHelper(name: string) { helpers.delete(name); },
  };
  const paths = ensureCorePaths(root), installationId = ensureInstallationId(paths);
  const app = await CoreApplication.create({ paths, initialization: {
    administrator: { account: "owner", password: "correct horse battery" },
    runtime: { agentImage: "recipient:default", provider: "deterministic", model: "test", credential: "TARGET_CREDENTIAL" },
  }, runtimeFactory: async () => workRuntime, snapshotHelperImage: "helper:configured", snapshotHelperResolver: async () => `sha256:${"f".repeat(64)}`,
  snapshotDockerFactory: () => snapshotRuntime as unknown as DockerRuntime });
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 }); const base = `http://127.0.0.1:${address.port}`;
    const login = await fetch(`${base}/api/v1/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: "owner", password: "correct horse battery" }) });
    const token = String((await login.json() as { token: string }).token); let auth = { authorization: `Bearer ${token}` };
    const wrongMedia = await fetch(`${base}/api/v1/work-packages`, { method: "POST", headers: { ...auth, "content-type": "application/octet-stream",
      "content-length": String(sourceLength), "x-piwork-sha256": sourceDigest }, body: uploadBody() });
    assert.equal(wrongMedia.status, 415);
    const missingLength = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(`${base}/api/v1/work-packages`, { method: "POST", headers: { ...auth,
        "content-type": "application/vnd.piwork.work-package", "transfer-encoding": "chunked", "x-piwork-sha256": sourceDigest } },
      (result) => { result.resume(); result.on("end", () => resolve(result.statusCode ?? 0)); });
      request.on("error", reject); request.end();
    });
    assert.equal(missingLength, 400);
    const tooLarge = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(`${base}/api/v1/work-packages`, { method: "POST", agent: false, headers: { ...auth,
        "content-type": "application/vnd.piwork.work-package", "content-length": String(100 * 1024 ** 3 + 1), "x-piwork-sha256": sourceDigest } },
      (result) => { result.resume(); result.on("end", () => resolve(result.statusCode ?? 0)); });
      request.on("error", reject); request.end();
    });
    assert.equal(tooLarge, 413);
    const wrongHash = await fetch(`${base}/api/v1/work-packages`, { method: "POST", headers: { ...auth, "content-type": "application/vnd.piwork.work-package",
      "content-length": String(sourceLength), "x-piwork-sha256": "0".repeat(64) }, body: uploadBody() });
    assert.equal(wrongHash.status, 400);
    const truncated = sourceBytes.subarray(0, -1);
    const truncatedUpload = await fetch(`${base}/api/v1/work-packages`, { method: "POST", headers: { ...auth,
      "content-type": "application/vnd.piwork.work-package", "content-length": String(truncated.length),
      "x-piwork-sha256": createHash("sha256").update(truncated).digest("hex") }, body: truncated });
    assert.equal(truncatedUpload.status, 400);
    assert.equal((await truncatedUpload.json() as { code: string }).code, "PACKAGE_INVALID");
    const stalledUploads = Array.from({ length: 2 }, () => {
      const request = httpRequest(`${base}/api/v1/work-packages`, { method: "POST", headers: { ...auth,
        "content-type": "application/vnd.piwork.work-package", "content-length": String(sourceLength), "x-piwork-sha256": sourceDigest } });
      request.on("error", () => undefined);
      request.flushHeaders();
      return request;
    });
    try {
      for (let attempt = 0; attempt < 100 && app.store.snapshots.listTransfers().length < 2; attempt++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(app.store.snapshots.listTransfers().length, 2);
      const busy = await fetch(`${base}/api/v1/work-packages`, { method: "POST", headers: { ...auth,
        "content-type": "application/vnd.piwork.work-package", "content-length": String(sourceLength), "x-piwork-sha256": sourceDigest }, body: uploadBody() });
      assert.equal(busy.status, 503);
      assert.equal((await busy.json() as { code: string }).code, "SNAPSHOT_TRANSFER_BUSY");
    } finally { for (const request of stalledUploads) request.destroy(); }
    for (let attempt = 0; attempt < 100 && app.store.snapshots.listTransfers().length > 0; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(app.store.snapshots.listTransfers().length, 0, "interrupted uploads must release their transfer leases");
    const unknownSnapshot = await fetch(`${base}/api/v1/work-snapshots/snapshot-unknown`, { headers: auth });
    assert.equal(unknownSnapshot.status, 404);
    const duplicateJson = await fetch(`${base}/api/v1/work-imports`, { method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: '{"packageId":"one","packageId":"two"}' });
    assert.equal(duplicateJson.status, 400);
    const upload = await fetch(`${base}/api/v1/work-packages`, { method: "POST", headers: { ...auth, "content-type": "application/vnd.piwork.work-package",
      "content-length": String(sourceLength), "x-piwork-sha256": sourceDigest }, body: uploadBody() });
    assert.equal(upload.status, 201);
    const uploaded = await upload.json() as { packageId: string; digest: string }; assert.equal(uploaded.digest, sourceDigest);
    app.store.snapshots.insertPackage({ id: "package-pending-000001", ownerUserId: app.store.listManagedUsers()[0]!.id,
      digest: sourceDigest, size: sourceLength, state: "staging", jobId: null, createdAt: new Date().toISOString(), readyAt: null, expiresAt: null });
    const pendingImport = await fetch(`${base}/api/v1/work-imports`, { method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ packageId: "package-pending-000001", name: "pending-copy", idempotencyKey: "pending-key" }) });
    assert.equal(pendingImport.status, 409);
    const repeatedUpload = await fetch(`${base}/api/v1/work-packages`, { method: "POST", headers: { ...auth, "content-type": "application/vnd.piwork.work-package",
      "content-length": String(sourceLength), "x-piwork-sha256": sourceDigest }, body: uploadBody() });
    assert.equal(repeatedUpload.status, 201);
    assert.equal((await repeatedUpload.json() as { packageId: string }).packageId, uploaded.packageId);
    const unauthenticated = await fetch(`${base}/api/v1/work-packages`, { method: "POST", headers: { "content-type": "application/vnd.piwork.work-package",
      "content-length": "1", "x-piwork-sha256": sourceDigest }, body: "x" });
    assert.equal(unauthenticated.status, 401);
    const obsoleteBindings = await fetch(`${base}/api/v1/work-imports`, { method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ packageId: uploaded.packageId, bindings: { models: {}, secrets: {} }, idempotencyKey: "obsolete" }) });
    assert.equal(obsoleteBindings.status, 400);
    assert.equal((await obsoleteBindings.json() as { code: string }).code, "PACKAGE_INVALID");
    const imported = await fetch(`${base}/api/v1/work-imports`, { method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ packageId: uploaded.packageId, idempotencyKey: "import-key" }) });
    assert.equal(imported.status, 202);
    const acceptedImport = await imported.json() as { workId: string; name: string; operationId: string };
    assert.equal(acceptedImport.name, "golden");
    await waitOperation(base, auth, acceptedImport.operationId);
    assert.equal(app.store.getWork(acceptedImport.workId)?.observedState, "stopped"); assert.equal(userStarts, 0);
    assert.equal(volumes.size, 2);
    const exported = await fetch(`${base}/api/v1/works/${acceptedImport.workId}/exports`, { method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "export-key" }) });
    assert.equal(exported.status, 202);
    const acceptedExport = await exported.json() as { operationId: string; snapshotId: string };
    await waitOperation(base, auth, acceptedExport.operationId);
    const administrator = app.store.listManagedUsers()[0]!;
    await new UserAdministrationService(app.store).createUser({ userId: administrator.id, role: "admin" },
      { account: "another-owner", password: "another correct horse battery" });
    const anotherLogin = await fetch(`${base}/api/v1/login`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ account: "another-owner", password: "another correct horse battery" }) });
    assert.equal(anotherLogin.status, 200);
    const anotherAuth = { authorization: `Bearer ${String((await anotherLogin.json() as { token: string }).token)}` };
    const invisible = await fetch(`${base}/api/v1/work-snapshots/${acceptedExport.snapshotId}`, { headers: anotherAuth });
    assert.equal(invisible.status, 404);
    await new UserAdministrationService(app.store).createUser({ userId: administrator.id, role: "admin" },
      { account: "another-admin", password: "another admin horse battery", role: "admin" });
    const administratorLogin = await fetch(`${base}/api/v1/login`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ account: "another-admin", password: "another admin horse battery" }) });
    assert.equal(administratorLogin.status, 200);
    const administratorAuth = { authorization: `Bearer ${String((await administratorLogin.json() as { token: string }).token)}` };
    const forbidden = await fetch(`${base}/api/v1/work-snapshots/${acceptedExport.snapshotId}`, { headers: administratorAuth });
    assert.equal(forbidden.status, 403);
    const users = new UserAdministrationService(app.store);
    users.setEnabled({ userId: administrator.id, role: "admin" }, administrator.id, false);
    const disabledObservation = await fetch(`${base}/api/v1/work-snapshots/${acceptedExport.snapshotId}`, { headers: auth });
    assert.equal(disabledObservation.status, 401);
    const otherAdministrator = app.store.listManagedUsers().find((user) => user.account === "another-admin")!;
    users.setEnabled({ userId: otherAdministrator.id, role: "admin" }, administrator.id, true);
    const resumedLogin = await fetch(`${base}/api/v1/login`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ account: "owner", password: "correct horse battery" }) });
    assert.equal(resumedLogin.status, 200);
    const resumedAuth = { authorization: `Bearer ${String((await resumedLogin.json() as { token: string }).token)}` };
    assert.equal((await fetch(`${base}/api/v1/work-snapshots/${acceptedExport.snapshotId}`, { headers: resumedAuth })).status, 200);
    auth = resumedAuth;
    const status = await fetch(`${base}/api/v1/work-snapshots/${acceptedExport.snapshotId}`, { headers: auth });
    assert.equal(status.status, 200);
    const snapshot = await status.json() as { digest: string; state: string }; assert.equal(snapshot.state, "succeeded");
    const download = await fetch(`${base}/api/v1/work-snapshots/${acceptedExport.snapshotId}/content`, { headers: auth });
    assert.equal(download.status, 200);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(createHash("sha256").update(bytes).digest("hex"), snapshot.digest);
    const verified = await readWorkPackage((async function* () { yield bytes; })());
    assert.equal(verified.spec.quotaReservations[0]!.desiredCpuMillis, 500);
    assert.equal(verified.spec.volumes.length, 2);
    const ranged = await fetch(`${base}/api/v1/work-snapshots/${acceptedExport.snapshotId}/content`, { headers: { ...auth, range: "bytes=0-10" } });
    assert.equal(ranged.status, 416);
    const exportedPackageId = app.store.snapshots.getJob(acceptedExport.operationId)!.packageId!;
    assert.equal(app.store.snapshots.expirePackage(exportedPackageId, new Date(Date.now() + 25 * 60 * 60_000).toISOString()), true);
    const expiredDownload = await fetch(`${base}/api/v1/work-snapshots/${acceptedExport.snapshotId}/content`, { headers: auth });
    assert.equal(expiredDownload.status, 410);
    const otherExpiredDownload = await fetch(`${base}/api/v1/work-snapshots/${acceptedExport.snapshotId}/content`, { headers: anotherAuth });
    assert.equal(otherExpiredDownload.status, 404);
    assert.equal(userStarts, 0); assert.equal(helpers.size, 0);
    const shutdown = app as unknown as { snapshotAbort: AbortController; startSnapshotTask(task: Promise<void>): void; snapshotTasks: Set<Promise<unknown>> };
    let taskAborted = false;
    shutdown.startSnapshotTask(new Promise<void>((resolve) => shutdown.snapshotAbort.signal.addEventListener("abort", () => {
      taskAborted = true; resolve();
    }, { once: true })));
    const shutdownStarted = Date.now();
    await app.close();
    assert.equal(taskAborted, true);
    assert.equal(shutdown.snapshotTasks.size, 0);
    assert.ok(Date.now() - shutdownStarted < 45_000, "shutdown must coordinate an abort-aware snapshot task within 45 seconds");
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});

async function waitOperation(base: string, auth: { authorization: string }, id: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch(`${base}/api/v1/operations/${id}`, { headers: auth });
    const body = await response.json() as { state: string; error?: unknown };
    if (body.state === "succeeded") return;
    if (body.state === "failed") assert.fail(`snapshot Operation failed: ${JSON.stringify(body.error)}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("snapshot Operation did not finish");
}
