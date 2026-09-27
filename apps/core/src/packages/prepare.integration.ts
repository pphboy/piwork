import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { packPiPackageDirectory, extractPiPackageZip } from "@piwork/pi-package";
import { DockerRuntime } from "@piwork/runtime-docker";
import { CoreStore } from "@piwork/core-store";
import { preparePiPackage } from "./prepare.js";
import { PiPackageWorker } from "./worker.js";

const execute = promisify(execFile);
const imageReference = process.env.PIWORK_PACKAGE_HELPER_TEST_IMAGE;

test("real local package lifecycle runs only in isolated prepare and capture follows its exit", { skip: !imageReference, timeout: 120_000 }, async () => {
  const imageId = (await execute("docker", ["image", "inspect", "--format", "{{.Id}}", imageReference!])).stdout.trim();
  const installationId = `pi-package-test-${randomUUID().slice(0, 8)}`;
  const jobId = `job-${randomUUID()}`;
  const runtime = new DockerRuntime(installationId);
  const root = await mkdtemp(join(tmpdir(), "piwork-package-prepare-"));
  const source = join(root, "author-source"), input = join(root, "source-input"), spool = join(root, "spool");
  let lastAction = "none";
  try {
    await mkdir(source); await mkdir(input, { mode: 0o755 }); await mkdir(spool);
    const secret = join(root, "core-secret"), otherWork = join(root, "other-work-secret");
    await writeFile(secret, "Core private content"); await writeFile(otherWork, "other Work private content");
    await writeFile(join(source, "package.json"), JSON.stringify({ name: "probe-tools", version: "1.0.0",
      scripts: { postinstall: "node probe.js" } }));
    await writeFile(join(source, "probe.js"), `const fs=require('node:fs');fs.writeFileSync('probe-result.json',JSON.stringify({
      coreSecret:fs.existsSync(${JSON.stringify(secret)}),otherWork:fs.existsSync(${JSON.stringify(otherWork)}),
      dockerSocket:fs.existsSync('/var/run/docker.sock'),hostHome:fs.existsSync(${JSON.stringify(process.env.HOME ?? "/home/p")}),
      user:process.getuid(),home:process.env.HOME}));`);
    const packed = await packPiPackageDirectory(source, join(input, "input.zip"));
    await chmod(join(input, "input.zip"), 0o644);
    await writeFile(join(input, "request.json"), JSON.stringify({ source: { kind: "local", displayName: "probe-tools" } }), { mode: 0o644 });
    const result = await preparePiPackage({ runtime, installationId, jobId, trustedHelperImageId: imageId,
      prepareImageId: imageId, sourceDirectory: input, spoolDirectory: spool,
      preparedEnvironment: { os: "linux", architecture: "amd64", variant: null, nodeAbi: "137", piSdkVersion: "0.86.0" },
      onHelperPlanned: (_name, action) => { lastAction = action; } }).catch((error) => {
        throw Object.assign(error as Error, { message: `${(error as Error).message} at ${lastAction}` });
      });
    assert.equal(result.metadata.name, "probe-tools");
    assert.equal(result.metadata.sourceKind, "local");
    assert.ok(result.zipBytes > 0);
    assert.equal((await readFile(result.artifactZip)).length, result.zipBytes);
    const extracted = join(root, "extracted");
    await extractPiPackageZip(result.artifactZip, extracted);
    const probe = JSON.parse(await readFile(join(extracted, "probe-result.json"), "utf8")) as Record<string, unknown>;
    assert.deepEqual(probe, { coreSecret: false, otherWork: false, dockerSocket: false,
      hostHome: false, user: 10001, home: "/package/work/home" });
    assert.equal(packed.manifest.name, result.metadata.name);
  } finally {
    await runtime.removePiPackageResources(jobId).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("sparse lifecycle output above 4 GiB aborts the live helper and clears its resources", { skip: !imageReference, timeout: 90_000 }, async () => {
  const imageId = (await execute("docker", ["image", "inspect", "--format", "{{.Id}}", imageReference!])).stdout.trim();
  const installationId = `pi-package-test-${randomUUID().slice(0, 8)}`;
  const jobId = `job-${randomUUID()}`;
  const runtime = new DockerRuntime(installationId);
  const root = await mkdtemp(join(tmpdir(), "piwork-package-overflow-"));
  const source = join(root, "source"), input = join(root, "input"), spool = join(root, "spool");
  try {
    await mkdir(source); await mkdir(input); await mkdir(spool);
    await writeFile(join(source, "package.json"), JSON.stringify({ name: "overflow-tools", version: "1.0.0",
      scripts: { postinstall: "node fill.js" } }));
    await writeFile(join(source, "fill.js"), `const fs=require('node:fs');const fd=fs.openSync('/package/work/overflow','w');
      fs.ftruncateSync(fd,4*1024*1024*1024+1);fs.closeSync(fd);setInterval(()=>{},1000);`);
    await packPiPackageDirectory(source, join(input, "input.zip"));
    await chmod(join(input, "input.zip"), 0o644);
    await writeFile(join(input, "request.json"), JSON.stringify({ source: { kind: "local", displayName: "overflow-tools" } }), { mode: 0o644 });
    const resources = await runtime.ensurePiPackageResources(jobId);
    const started = Date.now();
    await assert.rejects(preparePiPackage({ runtime, installationId, jobId, trustedHelperImageId: imageId,
      prepareImageId: imageId, sourceDirectory: input, spoolDirectory: spool,
      preparedEnvironment: { os: "linux", architecture: "amd64", variant: null, nodeAbi: "137", piSdkVersion: "0.86.0" } }),
    (error: unknown) => (error as { code?: string }).code === "PI_PACKAGE_LIMIT_EXCEEDED");
    assert.ok(Date.now() - started < 30_000, "overflow helper should be stopped at the next measurement");
    for (const name of [`piwork-pkg-init-${jobId}`, `piwork-pkg-prepare-${jobId}`]) {
      await assert.rejects(execute("docker", ["container", "inspect", name]));
    }
    await assert.rejects(execute("docker", ["volume", "inspect", resources.volumeName]));
    await assert.rejects(execute("docker", ["network", "inspect", resources.networkName]));
    await assert.rejects(readFile(join(spool, "artifact.zip")));
  } finally {
    await runtime.removePiPackageResources(jobId).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("Core worker installs an uploaded local package and default selection atomically", { skip: !imageReference, timeout: 120_000 }, async () => {
  const imageId = (await execute("docker", ["image", "inspect", "--format", "{{.Id}}", imageReference!])).stdout.trim();
  const installationId = `pi-package-test-${randomUUID().slice(0, 8)}`;
  const runtime = new DockerRuntime(installationId);
  const root = await mkdtemp(join(tmpdir(), "piwork-package-core-worker-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  try {
    const now = new Date();
    store.updateDefaultWorkConfiguration({ packages: [], skills: [], agentsMd: "keep" }, now.toISOString());
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(join(source, "package.json"), '{"name":"core-tools","version":"1.0.0"}');
    const uploads = join(root, "pi-packages", "uploads");
    await mkdir(uploads, { recursive: true });
    const uploadId = "upload-0000000001";
    const packed = await packPiPackageDirectory(source, join(uploads, `${uploadId}.zip`));
    store.packages.insertUpload({ id: uploadId, actorId: "admin-1", scopeKind: "core", workId: null,
      sourceKind: "local", displayName: "source", digest: `sha256:${packed.digest}`, size: packed.bytes,
      state: "ready", expiresAt: new Date(now.getTime() + 86400000).toISOString(), leaseCount: 0, createdAt: now.toISOString() });
    const accepted = store.packages.accept({ actorId: "admin-1", scope: { kind: "core" }, kind: "install",
      prepareImageId: imageId, trustedHelperImageId: imageId,
      preparedEnvironmentJson: JSON.stringify({ os: "linux", architecture: "amd64", variant: null, nodeAbi: "137", piSdkVersion: "0.86.0" }),
      addToDefaults: true, idempotencyKey: "install-core-tools", requestDigest: "test-request", requestJson: "{}",
      sourceJson: JSON.stringify({ kind: "upload", uploadId }), sourceUploadId: uploadId,
      deadlineAt: new Date(now.getTime() + 30 * 60000).toISOString(), now: now.toISOString() });
    const worker = new PiPackageWorker({ store, runtime, installationId, dataDirectory: root });
    await worker.drainOnce();
    assert.equal(store.packages.getJob(accepted.operationId)?.phase, "succeeded");
    assert.equal(store.packages.getCatalog("core-tools")?.enabled, true);
    assert.deepEqual((store.getDefaultWorkConfiguration()?.configuration as { packages: unknown }).packages, [{ name: "core-tools", enabled: true }]);
    assert.equal(store.packages.getUpload(uploadId)?.leaseCount, 0);
    const originalHead = store.packages.getCatalog("core-tools")!.headArtifactId;
    const originalArtifact = store.packages.getArtifact(originalHead)!;
    assert.ok(originalArtifact);
    const update = store.packages.accept({ actorId: "admin-1", scope: { kind: "core" }, kind: "update", packageName: "core-tools",
      prepareImageId: imageId, trustedHelperImageId: imageId,
      preparedEnvironmentJson: JSON.stringify({ os: "linux", architecture: "amd64", variant: null, nodeAbi: "137", piSdkVersion: "0.86.0" }),
      addToDefaults: false, idempotencyKey: "update-core-tools", requestDigest: "update-request", requestJson: "{}",
      sourceJson: JSON.stringify({ kind: "upload", uploadId }), sourceUploadId: uploadId,
      deadlineAt: new Date(Date.now() + 30 * 60000).toISOString(), now: new Date().toISOString() });
    await worker.drainOnce();
    assert.equal(store.packages.getJob(update.operationId)?.phase, "succeeded");
    const updatedHead = store.packages.getCatalog("core-tools")!.headArtifactId;
    assert.notEqual(updatedHead, originalHead);
    assert.equal(store.packages.getArtifact(updatedHead)?.contentDigest, originalArtifact.contentDigest);
    assert.deepEqual((store.getDefaultWorkConfiguration()?.configuration as { packages: unknown }).packages, [{ name: "core-tools", enabled: true }]);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
