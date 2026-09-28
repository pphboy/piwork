import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ensureCorePaths } from "../apps/core/dist/application/paths.js";
import { ensureInstallationId } from "../apps/core/dist/runtime/docker-work-runtime.js";
import { DockerRuntime } from "@piwork/runtime-docker";

const helperImage = process.env.PIWORK_FILE_HELPER_TEST_IMAGE?.trim();
if (!helperImage) throw new Error("PIWORK_FILE_HELPER_TEST_IMAGE is required");
const root = await mkdtemp(join(tmpdir(), "piwork-file-crash-"));
const paths = ensureCorePaths(join(root, "core"));
const installationId = ensureInstallationId(paths);
const dockerRuntime = new DockerRuntime(installationId);
const password = `crash-${randomUUID()}`;
const WORK_A = "work-crash-a-12345678", WORK_B = "work-crash-b-12345678";
const volumes = [];
let worker;

async function command(args) {
  const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
  let output = "", errors = "";
  child.stdout.on("data", (bytes) => { output += bytes; });
  child.stderr.on("data", (bytes) => { errors += bytes; });
  const code = await new Promise((done, reject) => { child.once("error", reject); child.once("close", done); });
  if (code !== 0) throw new Error(`docker ${args[0]} failed: ${errors.slice(0, 300)}`);
  return output.trim();
}

async function startWorker(volumeA, volumeB, stage) {
  const child = spawn(process.execPath, [resolve("scripts/work-files-crash-worker.mjs")], {
    stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PIWORK_CRASH_DIR: paths.dataDirectory,
      PIWORK_CRASH_VOLUME_A: volumeA, PIWORK_CRASH_VOLUME_B: volumeB,
      PIWORK_CRASH_PASSWORD: password, PIWORK_FILE_HELPER_TEST_IMAGE: helperImage,
      PIWORK_CRASH_STAGE: stage ?? "" } });
  let output = "", errors = "";
  const events = [];
  child.stderr.on("data", (bytes) => { errors += bytes.toString(); });
  const ready = await new Promise((done, reject) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("crash worker startup timed out")); }, 20_000);
    child.stdout.on("data", (bytes) => {
      output += bytes.toString();
      while (output.includes("\n")) {
        const line = output.indexOf("\n");
        const record = output.slice(0, line);
        output = output.slice(line + 1);
        try {
          const value = JSON.parse(record);
          if (value.stage) events.push(value.stage);
          else { clearTimeout(timer); done(value); }
        } catch (error) { reject(error); }
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`crash worker exited ${code}: ${errors.slice(0, 300)}`)); });
  });
  return { child, ready, events };
}

async function waitUntil(check, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error("timed out waiting for crash fixture state");
}

try {
  await command(["image", "inspect", "--format", "{{.Id}}", helperImage]);
  for (const workId of [WORK_A, WORK_B]) {
    const volume = await dockerRuntime.ensureManagedVolume(workId, "work-workspace");
    assert.equal(volume.created, true);
    volumes.push({ workId, name: volume.volumeName });
    await command(["run", "--rm", "--network", "none", "--mount",
      `type=volume,source=${volume.volumeName},target=/workspace`, "python:3.13-slim", "chown", "-R", "10001:10001", "/workspace"]);
    await command(["run", "--rm", "--network", "none", "--user", "10001:10001",
      "--mount", `type=volume,source=${volume.volumeName},target=/workspace`, "python:3.13-slim",
      "python", "-c", `open('/workspace/original.txt','wb').write(b'${workId}')`]);
  }
  let expectedA = WORK_A;
  for (const stage of ["temporary", "create-response", "commit", "remove"]) {
    worker = await startWorker(volumes[0].name, volumes[1].name,
      stage === "temporary" ? undefined : stage);
    assert.equal(worker.ready.installationId, installationId);
    const upstream = new URL(worker.ready.url);
    const upload = httpRequest({ hostname: upstream.hostname, port: Number(upstream.port),
      path: `/api/v1/works/${WORK_A}/files/original.txt`, method: "PUT",
      headers: { authorization: `Bearer ${worker.ready.token}`, "transfer-encoding": "chunked" } });
    upload.on("error", () => undefined);
    if (stage === "temporary") upload.write(Buffer.alloc(1024 * 1024, 0x91));
    else if (stage === "create-response") upload.write("pending-create");
    else upload.end(`after-${stage}`);
    if (stage === "temporary") {
      const journal = new DatabaseSync(paths.databasePath, { readOnly: true });
      try {
        await waitUntil(() => journal.prepare("SELECT COUNT(*) AS count FROM work_file_temporaries WHERE state='created' AND device IS NOT NULL AND inode IS NOT NULL").get().count > 0);
      } finally { journal.close(); }
    } else await waitUntil(() => worker.events.includes(stage), 20_000);
    const dead = worker.child;
    dead.kill("SIGKILL");
    await new Promise((done) => dead.once("close", done));
    upload.destroy();
    worker = await startWorker(volumes[0].name, volumes[1].name);
    assert.equal(worker.ready.pending, 0, `${stage}: Core startup did not clean the crashed file task`);
    if (stage === "remove") expectedA = "after-remove";
    for (const [workId, expected] of [[WORK_A, expectedA], [WORK_B, WORK_B]]) {
      const response = await fetch(`${worker.ready.url}/api/v1/works/${workId}/files/original.txt`,
        { headers: { authorization: `Bearer ${worker.ready.token}` } });
      assert.equal(response.status, 200, `${stage} ${workId}: ${response.headers.get("x-piwork-file-error")}; ${JSON.stringify(worker.ready.works)}`);
      assert.equal(await response.text(), expected);
    }
    await waitUntil(async () => (await command(["container", "ls", "-aq",
      "--filter", `label=piwork.installation_id=${installationId}`,
      "--filter", "label=piwork.resource_kind=file-helper"])) === "");
    worker.child.kill("SIGTERM");
    await new Promise((done) => worker.child.once("close", done));
  }
  console.log("work-files crash recovery passed: temporary, creation response, commit permission, removal; other Work available");
} finally {
  if (worker?.child.exitCode === null && !worker.child.killed) {
    worker.child.kill("SIGTERM");
    await new Promise((done) => worker.child.once("close", done));
  }
  for (const item of volumes.reverse()) await dockerRuntime.deleteManagedVolume(item.workId, "work-workspace");
  await rm(root, { recursive: true, force: true });
}
