import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import * as yazl from "yazl";
import { CoreStore } from "@piwork/core-store";
import { DockerRuntime, PI_PACKAGE_JOB_LABEL } from "@piwork/runtime-docker";
import { packPiPackageDirectory } from "@piwork/pi-package";
import { PiPackageWorker } from "../apps/core/dist/packages/worker.js";
import { startPiPackageSources } from "./pi-package-sources.mjs";

const execute = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "piwork-package-faults-"));
const installationId = `piwork-package-faults-${randomUUID().slice(0, 8)}`;
const runtime = new DockerRuntime(installationId);
let sources, store;
const docker = async (...args) => (await execute("docker", args, { timeout: 120_000 })).stdout.trim();

async function assertClean(jobId) {
  for (const [noun, command] of [["container", "ps"], ["network", "ls"], ["volume", "ls"]]) {
    const args = noun === "container" ? [command, "-aq"] : [command, "-q"];
    assert.equal(await docker(noun, ...args, "--filter", `label=piwork.installation_id=${installationId}`,
      "--filter", `label=${PI_PACKAGE_JOB_LABEL}=${jobId}`), "", `${noun} resource remained after helper exit`);
  }
}

async function failedJob(label, source, uploadId = null, expectedCode = "PI_PACKAGE_LIMIT_EXCEEDED") {
  const now = new Date();
  const accepted = store.packages.accept({ actorId: "operator", scope: { kind: "core" }, kind: "install",
    prepareImageId: await docker("image", "inspect", "--format", "{{.Id}}", sources.image),
    trustedHelperImageId: await docker("image", "inspect", "--format", "{{.Id}}", "piwork-agentd:acceptance"),
    preparedEnvironmentJson: JSON.stringify({ os: "linux", architecture: "amd64", variant: null,
      nodeAbi: "137", piSdkVersion: "0.86.0" }), addToDefaults: false, idempotencyKey: label,
    requestDigest: label, requestJson: "{}", sourceJson: JSON.stringify(source),
    ...(uploadId === null ? {} : { sourceUploadId: uploadId }),
    deadlineAt: new Date(now.getTime() + 5 * 60_000).toISOString(), now: now.toISOString() });
  await new PiPackageWorker({ store, runtime, installationId, dataDirectory: root }).drainOnce();
  assert.equal(store.packages.getJob(accepted.operationId)?.phase, "failed");
  const error = JSON.parse(store.getOperation(accepted.operationId).errorJson);
  assert.equal(error.code, expectedCode, `${label}: ${JSON.stringify(error)}`);
  assert.equal(store.packages.getCatalog("@piwork/fixture-tools"), undefined);
  await assertClean(accepted.operationId);
  return accepted;
}

async function uploadBytes(label, bytes, sourceKind) {
  const uploads = join(root, "pi-packages", "uploads");
  await mkdir(uploads, { recursive: true });
  const uploadId = `upload-${randomUUID()}`;
  await writeFile(join(uploads, `${uploadId}.zip`), bytes);
  const now = new Date();
  store.packages.insertUpload({ id: uploadId, actorId: "operator", scopeKind: "core", workId: null,
    sourceKind, displayName: label, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, size: bytes.length,
    state: "ready", expiresAt: new Date(now.getTime() + 86400000).toISOString(), leaseCount: 0, createdAt: now.toISOString() });
  return uploadId;
}

async function exampleZip(entries) {
  const output = join(root, `zip-${randomUUID()}.zip`), archive = new yazl.ZipFile();
  archive.addBuffer(Buffer.from('{"name":"@piwork/invalid-zip","version":"1.0.0"}'), "package.json");
  for (const name of entries) archive.addBuffer(Buffer.from("x"), name);
  archive.end();
  await pipeline(archive.outputStream, createWriteStream(output));
  return Buffer.from(await readFile(output));
}

try {
  sources = await startPiPackageSources(root);
  store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  store.updateDefaultWorkConfiguration({ packages: [], skills: [], agentsMd: "" }, new Date().toISOString());
  await failedJob("npm-source-over-1gib", { kind: "npm", spec: sources.npm("9.9.9").slice(4) });
  await failedJob("git-source-over-1gib", { kind: "git", spec: sources.git("oversized").slice(4) });
  const traversal = await exampleZip(["file.txt"]);
  let central = traversal.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  while (central >= 0) {
    const length = traversal.readUInt16LE(central + 28);
    if (traversal.subarray(central + 46, central + 46 + length).toString() === "file.txt") {
      traversal.set(Buffer.from("../e.txt"), central + 46);
      break;
    }
    central = traversal.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), central + 4);
  }
  assert.ok(central >= 0);
  const traversalId = await uploadBytes("traversal.zip", traversal, "zip");
  await failedJob("zip-traversal", { kind: "upload", uploadId: traversalId }, traversalId, "PI_PACKAGE_UNSAFE_ARCHIVE");
  const bomb = await exampleZip(Array.from({ length: 17 }, (_, index) => `f${index.toString().padStart(2, "0")}`));
  central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  while (central >= 0) {
    const length = bomb.readUInt16LE(central + 28);
    if (bomb.subarray(central + 46, central + 46 + length).toString().startsWith("f"))
      bomb.writeUInt32LE(64 * 1024 * 1024, central + 24);
    central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), central + 4);
  }
  const bombId = await uploadBytes("expansion.zip", bomb, "zip");
  await failedJob("zip-expansion", { kind: "upload", uploadId: bombId }, bombId);
  const source = join(root, "failing-source"), uploads = join(root, "pi-packages", "uploads");
  await mkdir(source); await mkdir(uploads, { recursive: true });
  await writeFile(join(source, "package.json"), JSON.stringify({ name: "@piwork/failing-tools", version: "1.0.0",
    scripts: { postinstall: "node fail.js" } }));
  await writeFile(join(source, "fail.js"), "process.exit(9);\n");
  const uploadId = `upload-${randomUUID()}`;
  const packed = await packPiPackageDirectory(source, join(uploads, `${uploadId}.zip`));
  const now = new Date();
  store.packages.insertUpload({ id: uploadId, actorId: "operator", scopeKind: "core", workId: null,
    sourceKind: "local", displayName: "failing-source", digest: `sha256:${packed.digest}`, size: packed.bytes,
    state: "ready", expiresAt: new Date(now.getTime() + 86400000).toISOString(), leaseCount: 0, createdAt: now.toISOString() });
  await failedJob("lifecycle-script-failure", { kind: "upload", uploadId }, uploadId, "PI_PACKAGE_PREPARATION_FAILED");
  assert.equal(store.packages.getCatalog("@piwork/failing-tools"), undefined);
  assert.equal(store.packages.getUpload(uploadId)?.leaseCount, 0);
  console.log("package fault acceptance passed: npm/Git limits, ZIP faults and lifecycle failure");
} finally {
  store?.close();
  await sources?.close();
  await rm(root, { recursive: true, force: true });
}
