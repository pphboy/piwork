import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream, existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:net";
import { ChannelCredentials, status } from "@grpc/grpc-js";
import { CoreApplication } from "../apps/core/dist/application/core-application.js";
import { ensureCorePaths } from "../apps/core/dist/application/paths.js";
import { ensureInstallationId } from "../apps/core/dist/runtime/docker-work-runtime.js";
import { normalizeServiceDefinitionInput, WorkServicesClient } from "@piwork/contracts";
import { DockerRuntime, managedVolumeName } from "@piwork/runtime-docker";
import { FileCredentialStore } from "@piwork/client-sdk";
import { readWorkPackage } from "@piwork/work-package";
import { packPiPackageDirectory } from "@piwork/pi-package";
import { startPiPackageSources } from "./pi-package-sources.mjs";

const helperReference = process.env.PIWORK_SNAPSHOT_HELPER_TEST_IMAGE?.trim();
if (!helperReference) throw new Error("PIWORK_SNAPSHOT_HELPER_TEST_IMAGE is required; build the current Dockerfile.snapshot-helper image and set its tag before running snapshot acceptance");
const command = promisify(execFile), root = await mkdtemp(join(process.env.PIWORK_SNAPSHOT_ACCEPTANCE_TEMP_PARENT ?? "/var/tmp", "piwork-snapshot-acceptance-"));
const imageReference = process.env.PIWORK_SNAPSHOT_ACCEPTANCE_IMAGE ?? "python:3.13-slim";
let agentReference = process.env.PIWORK_SNAPSHOT_ACCEPTANCE_AGENT_IMAGE ?? "piwork-agentd:acceptance";
const fixtureId = randomUUID(), serviceImageReference = `unreachable.invalid/piwork/portable:${fixtureId}`;
let serviceImageId, fixtureContainerId, packageSources, agentImageId;
const password = `snapshot-acceptance-${randomUUID()}`, credential = `recipient-platform-${randomUUID()}`;
const createdVolumes = [];
const installations = [];
const apps = [];
const docker = async (...args) => (await command("docker", args, { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
const helperId = await docker("image", "inspect", "--format", "{{.Id}}", helperReference);
const imageId = await docker("image", "inspect", "--format", "{{.Id}}", imageReference);
const deterministicRuntime = { async prepare() {}, async start() { throw new Error("acceptance must not auto-start Work"); },
  async inspect() { return { exists: false, running: false, ready: false }; }, async drain() {}, async stop() {}, async remove() {} };

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function installation(name, realRuntime = false) {
  const paths = ensureCorePaths(join(root, name)), installationId = `piwork-${randomUUID()}`;
  const previous = process.env.PIWORK_INSTALLATION_ID;
  process.env.PIWORK_INSTALLATION_ID = installationId;
  let app, agentPort;
  try {
    agentPort = realRuntime ? await freePort() : undefined;
    app = await CoreApplication.create({ paths, initialization: { administrator: { account: "owner", password },
      runtime: { agentImage: agentReference, provider: "piwork-deterministic", model: "fixture-v1", credential } },
    ...(realRuntime ? { agentGrpcListen: `0.0.0.0:${agentPort}`, agentGrpcAdvertise: `piwork-core:${agentPort}` } : { runtimeFactory: async () => deterministicRuntime }),
    snapshotHelperImage: helperReference, snapshotHelperResolver: async () => helperId,
    packageHelperImage: agentReference });
  } finally {
    if (previous === undefined) delete process.env.PIWORK_INSTALLATION_ID; else process.env.PIWORK_INSTALLATION_ID = previous;
  }
  assert.equal(ensureInstallationId(paths), installationId);
  installations.push(installationId);
  const snapshotErrors = [];
  const startSnapshotTask = app.startSnapshotTask.bind(app);
  app.startSnapshotTask = (task) => {
    void task.catch((error) => snapshotErrors.push(error));
    startSnapshotTask(task);
  };
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${address.port}`;
  const login = await fetch(`${base}/api/v1/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ account: "owner", password }) });
  assert.equal(login.status, 200);
  const loginResult = await login.json();
  await new FileCredentialStore(join(root, `${name}-client.json`)).save({ version: 1, coreUrl: base,
    token: loginResult.token, expiresAt: loginResult.expiresAt, user: loginResult.user });
  apps.push(app);
  return { app, paths, installationId, agentPort, snapshotErrors, base, cliConfig: join(root, `${name}-client.json`),
    headers: { authorization: `Bearer ${loginResult.token}` }, runtime: new DockerRuntime(installationId) };
}

async function cli(site, ...args) {
  const { stdout } = await command(process.execPath, [join(process.cwd(), "apps/cli/dist/main.js"), "--json", "work", ...args],
    { cwd: root, env: { ...process.env, PIWORK_CONFIG_PATH: site.cliConfig, PIWORK_CORE_URL: site.base },
      timeout: 30 * 60_000, maxBuffer: 2 * 1024 * 1024 });
  return JSON.parse(stdout.trim());
}

const portablePackageName = "@example/portable-tools";
async function packageFixture(version, marker) {
  const directory = join(root, `pi-package-${version}`);
  await mkdir(join(directory, "extensions"), { recursive: true });
  await mkdir(join(directory, "vendor", "portable-dependency"), { recursive: true });
  await writeFile(join(directory, "vendor", "portable-dependency", "package.json"), JSON.stringify({
    name: "portable-dependency", version: "1.0.0", main: "index.js" }));
  await writeFile(join(directory, "vendor", "portable-dependency", "index.js"),
    `module.exports = ${JSON.stringify(`offline-dependency:${marker}`)};\n`);
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: portablePackageName, version,
    dependencies: { "portable-dependency": "file:vendor/portable-dependency" },
    pi: { extensions: ["extensions/hello.js"] } }));
  await writeFile(join(directory, "extensions", "hello.js"),
    `import dependency from "portable-dependency"; export default function (pi) { pi.registerTool({ name: "hello", label: "Hello", description: "Portable package", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: ${JSON.stringify(marker)} + ":" + dependency }] }) }); }\n`);
  return directory;
}

async function packageChat(site, workId, marker) {
  const { stdout } = await command(process.execPath, [join(process.cwd(), "apps/cli/dist/main.js"), "--json", "chat",
    workId, "--message", "invoke package tool hello"], { cwd: root,
    env: { ...process.env, PIWORK_CONFIG_PATH: site.cliConfig, PIWORK_CORE_URL: site.base },
    timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
  assert.match(stdout, new RegExp(`package-tool-result:hello:${marker}:offline-dependency:${marker}`));
  const records = stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const session = records.find((record) => record.type === "session");
  assert.ok(typeof session?.sessionId === "string", "package chat must expose the Session used for the package tool call");
  return session.sessionId;
}

function assertPackageVersions(site, workId, activeVersion, desiredVersion) {
  const state = site.app.store.getWorkConfiguration(workId);
  const readVersion = (id) => id === null ? null : site.app.workContexts.load(workId, id).metadata.packageBindings
    .find((binding) => binding.name === portablePackageName)?.artifact.version ?? null;
  assert.equal(readVersion(state.activeContextId), activeVersion);
  assert.equal(readVersion(state.desiredContextId), desiredVersion);
}

const fixturePackageName = "@piwork/fixture-tools";
async function assertFixtureContexts(site, workId) {
  const directory = join(site.paths.dataDirectory, "works", workId, "contexts");
  const kinds = new Set();
  for (const id of await readdir(directory)) {
    if (id.startsWith(".staging-")) continue;
    const context = site.app.workContexts.load(workId, id);
    const binding = context.metadata.packageBindings.find((item) => item.name === fixturePackageName);
    if (!binding) continue;
    kinds.add(binding.artifact.sourceKind);
    const root = join(context.directory, "packages", binding.nameKey);
    assert.equal(await readFile(join(root, "prepared.txt"), "utf8"),
      `prepared-${binding.artifact.version === "1.0.0" ? "v1" : "v2"}\n`);
    assert.equal(await readFile(join(root, "node_modules", "fixture-dependency", "index.js"), "utf8"),
      'export default "offline-dependency";\n');
  }
  assert.deepEqual([...kinds].sort(), ["git", "local", "npm", "zip"]);
}

async function fixtureChat(site, workId, version) {
  const { stdout } = await command(process.execPath, [join(process.cwd(), "apps/cli/dist/main.js"), "--json", "chat",
    workId, "--message", "invoke package tool fixture_hello"], { cwd: root,
    env: { ...process.env, PIWORK_CONFIG_PATH: site.cliConfig, PIWORK_CORE_URL: site.base },
    timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
  assert.match(stdout, new RegExp(`package-tool-result:fixture_hello:${version}:offline-dependency:started`));
}

async function installTargetCatalogFixture(site, addToDefaults = true) {
  const directory = await packageFixture("3.0.0", "target-v3");
  const uploads = join(site.paths.dataDirectory, "pi-packages", "uploads");
  await mkdir(uploads, { recursive: true });
  const uploadId = `upload-${randomUUID()}`;
  const packed = await packPiPackageDirectory(directory, join(uploads, `${uploadId}.zip`));
  const now = new Date();
  site.app.store.packages.insertUpload({ id: uploadId, actorId: "operator", scopeKind: "core", workId: null,
    sourceKind: "local", displayName: "target-fixture", digest: `sha256:${packed.digest}`, size: packed.bytes,
    state: "ready", expiresAt: new Date(now.getTime() + 86400000).toISOString(), leaseCount: 0, createdAt: now.toISOString() });
  const accepted = await site.app.packages.install({ kind: "upload", uploadId }, addToDefaults, `target-catalog-${randomUUID()}`, "operator");
  for (let attempt = 0; attempt < 1200; attempt++) {
    const operation = site.app.store.getOperation(accepted.operationId);
    if (operation?.state === "succeeded") break;
    assert.notEqual(operation?.state, "failed", `target package install failed: ${operation?.errorJson}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(site.app.packages.show(portablePackageName, true).version, "3.0.0");
  await rm(directory, { recursive: true, force: true });
}

async function agentTools(site, workId) {
  const runtime = site.app.runtime;
  assert.ok(runtime, "real Work runtime must be available");
  const readiness = await runtime.readiness(runtime.readRecord(workId), 5_000);
  assert.equal(readiness.acceptingRuns, true);
  return readiness.resolvedTools;
}

async function verifyScopedServiceAccess(site, workId, forbiddenServiceIds) {
  const runtime = site.app.runtime;
  assert.ok(runtime && site.agentPort, "target Core service gRPC must be running");
  const record = runtime.readRecord(workId);
  const tls = record.tls;
  const client = new WorkServicesClient(`127.0.0.1:${site.agentPort}`, ChannelCredentials.createSsl(
    await readFile(tls.caCertificatePath), await readFile(tls.serviceClientPrivateKeyPath),
    await readFile(tls.serviceClientCertificatePath),
  ), { "grpc.ssl_target_name_override": "piwork-core", "grpc.default_authority": "piwork-core", "grpc.enable_http_proxy": 0 });
  const call = (method, request) => new Promise((resolve, reject) => client[method](request,
    (error, response) => error === null ? resolve(response) : reject(error)));
  try {
    const scope = await call("getDeploymentContext", {});
    assert.equal(scope.workId, workId, "imported runtime identity must resolve only its new Work");
    const before = site.app.store.listOperations().length;
    for (const serviceId of forbiddenServiceIds) {
      await assert.rejects(call("getService", { serviceId }), (error) => error.code === status.NOT_FOUND);
      await assert.rejects(call("stopService", { serviceId, idempotencyKey: `foreign-stop-${randomUUID()}` }),
        (error) => error.code === status.NOT_FOUND);
    }
    assert.equal(site.app.store.listOperations().length, before, "cross-Work requests must not create Operations");
  } finally { client.close(); }
}

async function json(site, path, method = "GET", body) {
  const response = await fetch(`${site.base}${path}`, { method, headers: { ...site.headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(result)}`);
  return result;
}
async function agentPhaseLogs(site, workId, runId) {
  const privateVolume = managedVolumeName(site.installationId, workId, "work-private");
  const script = "import json,sqlite3,sys; db=sqlite3.connect('/private/work.sqlite'); rows=db.execute('select event_type,payload_json from run_events where run_id=? order by sequence', (sys.argv[1],)); print('\\n'.join(json.dumps({'eventType': row[0], 'payload': json.loads(row[1])}) for row in rows if row[0]=='diagnostic'))";
  return docker("run", "--rm", "--network", "none", "--mount", `type=volume,source=${privateVolume},target=/private`, imageId,
    "python", "-c", script, runId).catch(() => "");
}
async function waitOperation(site, operationId) {
  for (let attempt = 0; attempt < 1200; attempt++) {
    const operation = await json(site, `/api/v1/operations/${operationId}`);
    if (operation.state === "succeeded") return operation;
    assert.notEqual(operation.state, "failed", `Operation failed: ${JSON.stringify(operation.error)}; worker: ${site.snapshotErrors.at(-1)?.stack ?? "unavailable"}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`snapshot Operation timed out: ${operationId}`);
}
async function upload(site, path, digest, size) {
  const verified = await readWorkPackage(createReadStream(path));
  assert.equal(verified.digest, digest, `local package digest mismatch: ${path}`);
  assert.equal(verified.size, size, `local package size mismatch: ${path}`);
  const response = await fetch(`${site.base}/api/v1/work-packages`, { method: "POST", headers: { ...site.headers,
    "content-type": "application/vnd.piwork.work-package", "content-length": String(size), "x-piwork-sha256": digest },
    body: createReadStream(path), duplex: "half" });
  const result = await response.json(); assert.equal(response.status, 201, `${path}: ${JSON.stringify(result)}`); return result;
}
async function importPackage(site, packageId, name) {
  const accepted = await json(site, "/api/v1/work-imports", "POST", { packageId,
    ...(name === undefined ? {} : { name }), idempotencyKey: `import-${randomUUID()}` });
  await waitOperation(site, accepted.operationId);
  await assertDormantImport(site, accepted.workId);
  return accepted.workId;
}
async function assertDormantImport(site, workId) {
  const work = site.app.store.getWork(workId);
  assert.equal(work?.observedState, "stopped"); assert.equal(work?.desiredState, "stopped");
  assert.equal(site.app.store.getQuotaReservation(workId, "agent", "agentd")?.occupiedCpuMillis, 0);
  assert.equal(site.app.store.listRuntimeGenerations(workId).length, 0, "import must not allocate a runtime generation");
  assert.equal(existsSync(join(site.paths.runtimeDirectory, workId)), false,
    "import must not create Work runtime configuration or TLS identity");
  assert.equal(await docker("container", "ls", "-aq", "--filter", `label=piwork.installation_id=${site.installationId}`,
    "--filter", `label=piwork.work_id=${workId}`), "", "import must not create a Work container");
  assert.equal(await docker("network", "ls", "-q", "--filter", `label=piwork.installation_id=${site.installationId}`,
    "--filter", `label=piwork.work_id=${workId}`), "", "import must not create a Work network");
}
async function importPackageViaCli(site, path) {
  const result = await cli(site, "import", path, "--wait").catch((error) => {
    throw new Error(`CLI import failed: ${site.snapshotErrors.at(-1)?.stack ?? "no worker error"}`, { cause: error });
  });
  assert.equal(result.state, "succeeded");
  assert.ok(result.workId && result.operationId);
  await assertDormantImport(site, result.workId);
  return result.workId;
}
async function exportWork(site, workId) {
  const accepted = await json(site, `/api/v1/works/${workId}/exports`, "POST", { idempotencyKey: `export-${randomUUID()}` });
  await waitOperation(site, accepted.operationId);
  const status = await json(site, `/api/v1/work-snapshots/${accepted.snapshotId}`);
  assert.equal(status.state, "succeeded");
  const packageId = site.app.store.snapshots.getJob(accepted.operationId).packageId;
  return { ...status, path: join(site.paths.snapshotsDirectory, "packages", `${packageId}.work`) };
}
async function exportWorkViaCli(site, workId) {
  const result = await cli(site, "export", workId);
  assert.equal(result.path, join(root, `${workId}.work`), "CLI must use the default <workId>.work path");
  assert.equal((await stat(result.path)).mode & 0o777, 0o600, "CLI package must be private");
  const local = await readWorkPackage(createReadStream(result.path));
  assert.equal(local.digest, result.digest, "CLI package bytes must match the reported digest");
  assert.equal(local.size, result.size, "CLI package bytes must match the reported size");
  const snapshot = await json(site, `/api/v1/work-snapshots/${result.snapshotId}`);
  assert.equal(snapshot.state, "succeeded");
  assert.equal(result.digest, snapshot.digest);
  assert.equal(result.size, snapshot.size);
  return { ...snapshot, path: result.path };
}
async function downloadAndVerify(site, snapshot) {
  const response = await fetch(`${site.base}/api/v1/work-snapshots/${snapshot.snapshotId}/content`, { headers: site.headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/vnd.piwork.work-package");
  assert.equal(response.headers.get("content-length"), String(snapshot.size));
  assert.equal(response.headers.get("x-piwork-sha256"), snapshot.digest);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const hash = createHash("sha256"); let size = 0, chunks = 0;
  for await (const chunk of response.body) {
    hash.update(chunk); size += chunk.length; chunks++;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(chunks > 1, "download must be consumed in multiple chunks");
  assert.equal(size, snapshot.size);
  assert.equal(hash.digest("hex"), snapshot.digest);
}
async function startWork(site, workId) {
  const accepted = await json(site, `/api/v1/works/${workId}/start`, "POST", { idempotencyKey: `start-${randomUUID()}` });
  await waitOperation(site, accepted.operationId);
  assert.ok(["ready", "degraded"].includes(site.app.store.getWork(workId).observedState));
}
async function stopWork(site, workId) {
  const accepted = await json(site, `/api/v1/works/${workId}/stop`, "POST", { idempotencyKey: `stop-${randomUUID()}` });
  await waitOperation(site, accepted.operationId);
  assert.equal(site.app.store.getWork(workId).observedState, "stopped");
}
async function conversationRound(site, workId, existingSessionId, prompt = "Reply with one short sentence about this portable Work.") {
  const sessionId = existingSessionId ?? (await json(site, `/api/v1/works/${workId}/sessions`, "POST", { idempotencyKey: `session-${randomUUID()}` })).sessionId;
  const submitted = await json(site, `/api/v1/works/${workId}/runs`, "POST", { sessionId, submissionKey: `run-${randomUUID()}`, prompt });
  const runId = submitted.run?.runId;
  assert.ok(runId);
  for (let attempt = 0; attempt < 300; attempt++) {
    const run = await json(site, `/api/v1/works/${workId}/runs/${runId}`);
    if (run.state === "RUN_STATE_SUCCEEDED" || run.state === 4) return sessionId;
    if (["RUN_STATE_FAILED", "RUN_STATE_CANCELLED", "RUN_STATE_INTERRUPTED", 5, 6, 7].includes(run.state)) {
      const phases = await agentPhaseLogs(site, workId, runId);
      throw new Error(`${JSON.stringify(run)}${phases === "" ? "" : `; agent phases: ${phases}`}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Run did not finish: ${runId}`);
}
async function runCode(site, workId, expected = 7) {
  const workspace = managedVolumeName(site.installationId, workId, "work-workspace");
  const result = await docker("run", "--rm", "--network", "none", "--mount", `type=volume,source=${workspace},target=/project`,
    imageId, "/project/.venv/bin/python", "/project/run.py");
  assert.equal(result, `portable-code:${expected}:TOKEN=work-owned:dependency-retained`);
  const localTool = await docker("run", "--rm", "--network", "none", "--mount", `type=volume,source=${workspace},target=/project`,
    imageId, "/project/node_modules/.bin/portable-tool");
  assert.equal(localTool, "node-modules-link-retained");
  const privateVolume = managedVolumeName(site.installationId, workId, "work-private");
  const privateResult = await docker("run", "--rm", "--network", "none", "--mount", `type=volume,source=${privateVolume},target=/private`,
    imageId, "python", "-c", "print(open('/private/home-tool').read().strip())");
  assert.equal(privateResult, "private-tool-retained");
}
async function verifySourceUrlFile(site, workId, sourceUrl) {
  const workspace = managedVolumeName(site.installationId, workId, "work-workspace");
  await docker("run", "--rm", "--network", "none", "--mount", `type=volume,source=${workspace},target=/project`, imageId,
    "python", "-c", "from pathlib import Path; import sys; assert Path('/project/service-url.txt').read_bytes() == sys.argv[1].encode()", sourceUrl);
}
async function verifySourceUrlPackage(path, sourceUrl) {
  let fileFound = false;
  const verified = await readWorkPackage(createReadStream(path), { onBlob: async (blob, chunks) => {
    const parts = [];
    for await (const chunk of chunks) if (blob.size <= 4096) parts.push(Buffer.from(chunk));
    if (blob.kinds.includes("file") && Buffer.concat(parts).equals(Buffer.from(sourceUrl))) fileFound = true;
  } });
  assert.equal(verified.spec.formatVersion, 1);
  assert.equal(verified.spec.services.some((service) => service.name === "web" && service.tombstonedAt === null), true);
  assert.equal(fileFound, true, "source URL file bytes must survive the package");
  const history = verified.metadata.get(verified.spec.history.control);
  assert.equal(history.operations.some((operation) => operation.requestJson === sourceUrl), true,
    "source URL history text must survive the package");
  return verified.spec;
}
async function verifyWebService(site, workId) {
  let ready = false;
  for (let attempt = 0; attempt < 400; attempt++) {
    const service = site.app.store.listServices(workId, true).find((item) => item.name === "web");
    if (service?.observedState === "ready") { ready = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, "restored enabled service must become ready");
  const network = await site.runtime.ensureWorkNetwork(workId);
  let result;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      result = await docker("run", "--rm", "--network", network.name, imageId, "python", "-c",
        "import urllib.request; print(urllib.request.urlopen('http://svc-web:8000/run.py', timeout=5).read().decode().count('portable-code:'))");
      break;
    } catch (error) { if (attempt === 9) throw error; await new Promise((resolve) => setTimeout(resolve, 500)); }
  }
  assert.equal(result, "1", "restored service must serve the original Work workspace");
}
async function changeBusiness(site, workId) {
  const workspace = managedVolumeName(site.installationId, workId, "work-workspace");
  await docker("run", "--rm", "--network", "none", "--mount", `type=volume,source=${workspace},target=/project`, imageId,
    "python", "-c", "import sqlite3; db=sqlite3.connect('/project/business.sqlite'); db.execute('update settings set value=8'); db.commit(); db.close()");
}
async function leaveCommittedHistoryInWal(site, workId, sessionId) {
  const privateVolume = managedVolumeName(site.installationId, workId, "work-private");
  await docker("run", "--rm", "--network", "none", "--mount", `type=volume,source=${privateVolume},target=/private`, imageId,
    "python", "-c", "import os, sqlite3, sys; db=sqlite3.connect('/private/work.sqlite'); db.execute('pragma journal_mode=wal'); db.execute('pragma wal_autocheckpoint=0'); db.execute('update sessions set updated_at=? where session_id=?', ('2026-09-23T23:59:00.000Z', sys.argv[1])); db.commit(); os._exit(0)", sessionId);
  await docker("run", "--rm", "--network", "none", "--mount", `type=volume,source=${privateVolume},target=/private`, imageId,
    "python", "-c", "from pathlib import Path; p=Path('/private/work.sqlite-wal'); assert p.exists() and p.stat().st_size > 0");
}
async function verifyHistoryWalCommit(site, workId, sessionId) {
  const privateVolume = managedVolumeName(site.installationId, workId, "work-private");
  const value = await docker("run", "--rm", "--network", "none", "--mount", `type=volume,source=${privateVolume},target=/private`, imageId,
    "python", "-c", "import sqlite3, sys; db=sqlite3.connect('/private/work.sqlite'); print(db.execute('select updated_at from sessions where session_id=?', (sys.argv[1],)).fetchone()[0])", sessionId);
  assert.equal(value, "2026-09-23T23:59:00.000Z", "committed Session update from source WAL must survive import");
}
function trackImportedVolumes(site, workId) {
  for (const role of ["work-private", "work-workspace"]) createdVolumes.push([site.installationId, managedVolumeName(site.installationId, workId, role)]);
}
async function sourceWork(site, name = "portable-source", includeServiceMcp = true, deniedTools = []) {
  const workId = `work-${randomUUID()}`, contextId = `context-${randomUUID()}`, serviceId = `service-${randomUUID()}`, webServiceId = `service-${randomUUID()}`;
  const privateVolume = await site.runtime.ensureManagedVolume(workId, "work-private");
  const workspaceVolume = await site.runtime.ensureManagedVolume(workId, "work-workspace");
  assert.equal(privateVolume.created, true); assert.equal(workspaceVolume.created, true);
  createdVolumes.push([site.installationId, privateVolume.volumeName], [site.installationId, workspaceVolume.volumeName]);
  await docker("run", "--rm", "--network", "none", "--mount", `type=volume,source=${privateVolume.volumeName},target=/private`,
    "--mount", `type=volume,source=${workspaceVolume.volumeName},target=/project`, imageId, "python", "-c",
    `import os, sqlite3, venv; from pathlib import Path
Path('/private/home-tool').write_text('private-tool-retained\\n')
Path('/project/.env').write_text('TOKEN=work-owned\\n')
Path('/project/stream-fixture.bin').write_bytes(b'P' * (8 * 1024 * 1024))
Path('/project/node_modules/.bin').mkdir(parents=True)
Path('/project/node_modules/portable-tool').write_text('#!/bin/sh\\necho node-modules-link-retained\\n')
os.chmod('/project/node_modules/portable-tool', 0o755)
os.symlink('../portable-tool', '/project/node_modules/.bin/portable-tool')
venv.EnvBuilder(with_pip=False, symlinks=True).create('/project/.venv')
Path('/project/.venv/lib/python3.13/site-packages/portable_dep.py').write_text("marker='dependency-retained'\\n")
Path('/project/run.py').write_text("import sqlite3, portable_dep; from pathlib import Path; db=sqlite3.connect('/project/business.sqlite'); n=db.execute('select value from settings').fetchone()[0]; print('portable-code:'+str(n)+':'+Path('/project/.env').read_text().strip()+':'+portable_dep.marker)")
db=sqlite3.connect('/project/business.sqlite'); db.execute('create table settings(value integer)'); db.execute('insert into settings values (7)'); db.commit(); db.close()`);
  const now = new Date().toISOString(), profile = site.app.runtimeProfiles.load();
  const configuration = { agentImage: { catalogId: "runtime-image-00000001" }, modelRef: "runtime-model-00000001", skills: [], packages: [], agentsMd: "User AGENTS.md stays in the package\n",
    mcpServers: includeServiceMcp ? [{ serverId: "work-services", transport: "stdio", required: true,
      command: "/usr/local/bin/piwork-service-mcp", args: [], timeoutMs: 30_000 }] : [],
    tools: { allowed: [], denied: deniedTools }, resources: { cpuMillis: 1000, memoryBytes: 1073741824, agentCpuMillis: 500,
      agentMemoryBytes: 536870912, maxServices: 2, maxRetainedVolumes: 2 } };
  const snapshot = site.app.workContexts.build({ workId, snapshotId: contextId, configuration, imageIdentity: agentImageId, skills: [], createdAt: now });
  const definition = normalizeServiceDefinitionInput({ name: "retained-worker", image: { reference: serviceImageReference }, command: "python", workingDirectory: "/", enabled: false });
  const webDefinition = normalizeServiceDefinitionInput({ name: "web", image: { reference: serviceImageReference }, command: "python",
    args: ["-m", "http.server", "8000"], workingDirectory: "/var/data/workspace",
    mounts: [{ source: "workspace", target: "/var/data/workspace", readOnly: false }],
    ports: [{ name: "http", containerPort: 8000, protocol: "tcp" }], cpuMillis: 200, memoryBytes: 268435456, enabled: true, required: true });
  const store = site.app.store;
  const accepted = store.acceptMutation({ principalId: site.app.store.listManagedUsers()[0].id, workScope: "new-work", operationKind: "create-work",
    idempotencyKey: `source-${randomUUID()}`, requestDigest: "a".repeat(64), requestJson: "{}", targetVersion: 1, now }, (tx) => {
    tx.run("INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at) VALUES (?,?,?,'stopped','stopped',1,1,?,?)",
      workId, site.app.store.listManagedUsers()[0].id, name, now, now);
    tx.run("INSERT INTO quota_reservations VALUES (?,'agent','agentd',500,536870912,17,1024,0,2,?)", workId, now);
    tx.run("INSERT INTO quota_reservations VALUES (?,'service',?,250,134217728,29,1024,1,0,?)", workId, serviceId, now);
    tx.run("INSERT INTO quota_reservations VALUES (?,'service',?,200,268435456,0,0,1,0,?)", workId, webServiceId, now);
    for (const [volumeId, role, runtimeName, count] of [[`volume-${randomUUID()}`, "agent-private", privateVolume.volumeName, 1],
      [`volume-${randomUUID()}`, "workspace", workspaceVolume.volumeName, 3]]) {
      tx.run("INSERT INTO volume_records VALUES (?,?,?,NULL,?,?,'active',?,NULL,NULL,?)", volumeId, site.installationId, workId, role, runtimeName, count, now);
      tx.run("INSERT INTO volume_references VALUES (?,'work',?,?)", volumeId, workId, now);
      if (role === "workspace") {
        tx.run("INSERT INTO volume_references VALUES (?,'service',?,?)", volumeId, serviceId, now);
        tx.run("INSERT INTO volume_references VALUES (?,'service',?,?)", volumeId, webServiceId, now);
      }
    }
    tx.run("INSERT INTO work_config_revisions(work_id,revision,config_json,resolved_image_digest,created_by_user_id,created_at,runtime_profile_json,source_runtime_revision) VALUES (?,1,?,?,?,?,?,?)",
      workId, JSON.stringify(configuration), agentImageId, site.app.store.listManagedUsers()[0].id, now, JSON.stringify(profile), profile.revision);
    store.insertInitialWorkContext(workId, 1, { snapshotId: snapshot.snapshotId, configurationJson: JSON.stringify(configuration), imageIdentity: agentImageId,
      createdByUserId: site.app.store.listManagedUsers()[0].id, createdAt: now });
    tx.run("INSERT INTO service_revisions(work_id,service_id,revision,definition_json,resolved_image_digest,created_at) VALUES (?,?,1,?,?,?)",
      workId, serviceId, JSON.stringify({ ...definition, serviceId, revision: 1 }), serviceImageId, now);
    tx.run("INSERT INTO service_heads(work_id,service_id,name,desired_revision,applied_revision,enabled,observed_state,tombstoned_at,last_error_json) VALUES (?,?,?,1,NULL,0,'disabled',?,NULL)",
      workId, serviceId, "retained-worker", now);
    tx.run("INSERT INTO service_runtime_bindings(work_id,service_id,revision,container_id,image_identity,recovery_count,recovery_window_started_at,next_retry_at,ready_since,updated_at) VALUES (?,?,1,NULL,?,3,?,NULL,NULL,?)",
      workId, serviceId, serviceImageId, now, now);
    tx.run("INSERT INTO service_revisions(work_id,service_id,revision,definition_json,resolved_image_digest,created_at) VALUES (?,?,1,?,?,?)",
      workId, webServiceId, JSON.stringify({ ...webDefinition, serviceId: webServiceId, revision: 1 }), serviceImageId, now);
    tx.run("INSERT INTO service_heads(work_id,service_id,name,desired_revision,applied_revision,enabled,observed_state,tombstoned_at,last_error_json) VALUES (?,?,?,1,NULL,1,'stopped',NULL,NULL)",
      workId, webServiceId, "web");
    tx.run("INSERT INTO service_runtime_bindings(work_id,service_id,revision,container_id,image_identity,recovery_count,recovery_window_started_at,next_retry_at,ready_since,updated_at) VALUES (?,?,1,NULL,?,0,NULL,NULL,NULL,?)",
      workId, webServiceId, serviceImageId, now);
    return { resourceId: workId };
  });
  store.updateOperation(accepted.operationId, "succeeded", now);
  return workId;
}

try {
  await docker("info", "--format", "{{.ServerVersion}}");
  packageSources = await startPiPackageSources(root, agentReference);
  agentReference = packageSources.image;
  agentImageId = await docker("image", "inspect", "--format", "{{.Id}}", agentReference);
  fixtureContainerId = await docker("container", "create", "--network", "none", imageId, "python", "-c", "pass");
  serviceImageId = await docker("container", "commit", "--change", `LABEL piwork.acceptance=${fixtureId}`, fixtureContainerId, serviceImageReference);
  await docker("container", "rm", fixtureContainerId); fixtureContainerId = undefined;
  const source = await installation("source", true), target = await installation("target", true), third = await installation("third", true);
  await installTargetCatalogFixture(source, false);
  const sourceId = await sourceWork(source);
  const sourceWeb = source.app.store.listServices(sourceId, true).find((service) => service.name === "web");
  assert.ok(sourceWeb);
  const sourceNow = new Date().toISOString();
  const sourceNetwork = source.app.store.assignWorkNetworkName(sourceId, sourceNow);
  source.app.store.assignServiceDomainLabel(sourceId, sourceWeb.serviceId, "web", sourceNow);
  const sourceUrl = `http://web.${sourceNetwork}.work/legacy?q=1`;
  const sourceWorkspace = managedVolumeName(source.installationId, sourceId, "work-workspace");
  await docker("run", "--rm", "--network", "none", "--mount", `type=volume,source=${sourceWorkspace},target=/project`, imageId,
    "python", "-c", "from pathlib import Path; import sys; Path('/project/service-url.txt').write_bytes(sys.argv[1].encode())", sourceUrl);
  const sourceHistory = source.app.store.acceptMutation({ principalId: source.app.store.listManagedUsers()[0].id, workId: sourceId,
    workScope: sourceId, operationKind: "future-user-operation", idempotencyKey: `source-url-${randomUUID()}`,
    requestDigest: createHash("sha256").update(sourceUrl).digest("hex"), requestJson: sourceUrl, targetVersion: 2, now: sourceNow },
  () => ({ resourceId: sourceWeb.serviceId }));
  source.app.store.updateOperation(sourceHistory.operationId, "succeeded", sourceNow);
  await runCode(source, sourceId);
  await verifySourceUrlFile(source, sourceId, sourceUrl);
  await startWork(source, sourceId);
  const packageV1 = await packageFixture("1.0.0", "source-v1");
  assert.equal((await cli(source, "packages", "install", sourceId, packageV1, "--wait")).state, "succeeded");
  await rm(packageV1, { recursive: true, force: true });
  const packageApply = await json(source, `/api/v1/works/${sourceId}/configuration/apply`, "POST", { idempotencyKey: `package-apply-${randomUUID()}` });
  await waitOperation(source, packageApply.operationId);
  assertPackageVersions(source, sourceId, "1.0.0", "1.0.0");
  await verifyWebService(source, sourceId);
  await stopWork(source, sourceId);
  const fixtureLocal = join(root, "fixture-local"), fixtureZip = join(root, "fixture-v2.zip");
  await cp(packageSources.local("v1"), fixtureLocal, { recursive: true });
  await writeFile(join(fixtureLocal, "source-marker.txt"), "local\n");
  const fixtureZipSource = join(root, "fixture-zip-source");
  await cp(packageSources.local("v2"), fixtureZipSource, { recursive: true });
  await writeFile(join(fixtureZipSource, "source-marker.txt"), "zip\n");
  await packPiPackageDirectory(fixtureZipSource, fixtureZip);
  const fixtureChange = async (action, version, input, kind) => {
    const args = ["packages", action, sourceId, ...(action === "update" ? [fixturePackageName, "--source", input] : [input]), "--wait"];
    assert.equal((await cli(source, ...args)).state, "succeeded");
    const state = source.app.store.getWorkConfiguration(sourceId);
    const binding = source.app.workContexts.load(sourceId, state.desiredContextId).metadata.packageBindings
      .find((item) => item.name === fixturePackageName);
    assert.equal(binding?.artifact.version, version);
    assert.equal(binding?.artifact.sourceKind, kind);
  };
  const applyFixture = async () => {
    const accepted = await json(source, `/api/v1/works/${sourceId}/configuration/apply`, "POST",
      { idempotencyKey: `fixture-apply-${randomUUID()}` });
    await waitOperation(source, accepted.operationId);
  };
  await fixtureChange("install", "1.0.0", fixtureLocal, "local"); await applyFixture();
  await fixtureChange("update", "2.0.0", fixtureZip, "zip"); await applyFixture();
  await fixtureChange("update", "1.0.0", packageSources.npm("1.0.0"), "npm"); await applyFixture();
  await fixtureChange("update", "2.0.0", packageSources.git("v2"), "git");
  await cli(source, "packages", "disable", sourceId, fixturePackageName);
  await assertFixtureContexts(source, sourceId);
  await packageSources.stopSources();
  await rm(fixtureLocal, { recursive: true, force: true });
  await rm(fixtureZipSource, { recursive: true, force: true });
  await rm(fixtureZip, { force: true });
  const packageV2 = await packageFixture("2.0.0", "source-v2");
  assert.equal((await cli(source, "packages", "update", sourceId, portablePackageName, "--source", packageV2, "--wait")).state, "succeeded");
  await rm(packageV2, { recursive: true, force: true });
  assertPackageVersions(source, sourceId, "1.0.0", "2.0.0");
  // Create the retained package Session while its bound context is still active.
  // Later package edits remain pending, so the import still exercises active,
  // desired, and historical context restoration without violating Session fencing.
  await startWork(source, sourceId);
  const packageSessionId = await packageChat(source, sourceId, "source-v1");
  const sessionId = await conversationRound(source, sourceId, packageSessionId, "invoke package tool hello");
  await stopWork(source, sourceId);
  await leaveCommittedHistoryInWal(source, sourceId, sessionId);
  source.app.store.exec(`UPDATE service_runtime_bindings SET recovery_count = 3 WHERE work_id = '${sourceId}' AND service_id = (SELECT service_id FROM service_heads WHERE work_id = '${sourceId}' AND name = 'web')`);
  const sourceConfiguration = (await json(source, `/api/v1/works/${sourceId}/configuration`)).desired;
  await json(source, `/api/v1/works/${sourceId}/configuration`, "PUT", { configuration: { ...sourceConfiguration, agentsMd: "Pending desired context remains pending after import\n" } });
  const sourceContext = source.app.store.getWorkConfiguration(sourceId);
  assert.notEqual(sourceContext.activeContextId, sourceContext.desiredContextId);
  const exported = await exportWorkViaCli(source, sourceId).catch((error) => {
    throw new Error(`source export failed: ${source.snapshotErrors.at(-1)?.stack ?? "no worker error"}`, { cause: error });
  });
  const exportedSpec = await verifySourceUrlPackage(exported.path, sourceUrl);
  assert.deepEqual([...new Set(exportedSpec.piPackageArtifacts.filter((item) => item.name === fixturePackageName)
    .map((item) => item.sourceKind))].sort(), ["git", "local", "npm", "zip"]);
  source.app.packages.remove(portablePackageName);
  assert.equal(source.app.store.packages.getCatalog(portablePackageName), undefined);
  assert.ok(exported.size > 8 * 1024 * 1024, "legal package must contain the 8 MiB fixture");
  const operationsBeforeOverwrite = source.app.store.listOperations().length;
  await assert.rejects(cli(source, "export", sourceId), /output already exists/);
  assert.equal(source.app.store.listOperations().length, operationsBeforeOverwrite,
    "CLI must reject an existing output without accepting another export");
  await downloadAndVerify(source, exported);
  const deniedSourceId = await sourceWork(source, "denied-tool-source", true, ["work-services.service_stop"]);
  await startWork(source, deniedSourceId);
  assert.ok(JSON.parse(source.app.store.getWorkConfiguration(deniedSourceId).activeConfigJson).tools.denied.includes("work-services.service_stop"),
    "source active context must contain the denied service tool");
  await stopWork(source, deniedSourceId);
  const deniedExport = await exportWork(source, deniedSourceId);
  const coldSourceId = await sourceWork(source, "never-started-source", false);
  assert.equal(source.app.store.getWorkConfiguration(coldSourceId).activeContextId, null);
  assert.equal(source.app.store.getWorkConfiguration(coldSourceId).desiredConfigJson.includes("work-services"), false,
    "source desired context must explicitly omit the built-in MCP");
  const coldExport = await exportWork(source, coldSourceId);
  for (const workId of [sourceId, deniedSourceId]) {
    for (const service of source.app.store.listServices(workId, true)) {
      await source.runtime.deleteContainer(workId, "service", service.serviceId);
    }
  }
  await docker("image", "rm", serviceImageReference);
  await assert.rejects(docker("image", "inspect", serviceImageId), "target must not already have the immutable service image");
  await installTargetCatalogFixture(target);
  const uploaded = await upload(target, exported.path, exported.digest, exported.size);
  const first = await importPackage(target, uploaded.packageId);
  await assertFixtureContexts(target, first);
  assert.equal(target.app.store.getWork(first).name, "portable-source");
  await verifyHistoryWalCommit(target, first, sessionId);
  assert.equal(await docker("image", "inspect", "--format", "{{.Id}}", serviceImageId), serviceImageId,
    "import must restore the service image from package bytes while its registry reference is unreachable");
  trackImportedVolumes(target, first);
  const firstConfiguration = target.app.store.getWorkConfiguration(first);
  assert.notEqual(firstConfiguration.activeContextId, firstConfiguration.desiredContextId, "pending desired context must survive import");
  assert.equal(firstConfiguration.pendingRestart, true);
  assertPackageVersions(target, first, "1.0.0", "2.0.0");
  assert.equal(target.app.packages.show(portablePackageName, true).version, "3.0.0");
  target.app.store.exec(`UPDATE quota_reservations SET desired_cpu_millis = 128000 WHERE work_id = '${first}' AND subject_kind = 'agent'`);
  try {
    const rejected = await fetch(`${target.base}/api/v1/work-imports`, { method: "POST", headers: { ...target.headers, "content-type": "application/json" },
      body: JSON.stringify({ packageId: uploaded.packageId, name: "over-budget",
        idempotencyKey: `budget-${randomUUID()}` }) });
    assert.equal(rejected.status, 409);
    assert.equal((await rejected.json()).code, "QUOTA_EXCEEDED");
    assert.equal(target.app.store.listWorks().some((item) => item.name === "over-budget"), false);
  } finally { target.app.store.exec(`UPDATE quota_reservations SET desired_cpu_millis = 500 WHERE work_id = '${first}' AND subject_kind = 'agent'`); }
  const second = await importPackage(target, uploaded.packageId);
  assert.equal(target.app.store.getWork(second).name, "portable-source-2");
  await verifyHistoryWalCommit(target, second, sessionId);
  trackImportedVolumes(target, second);
  assert.equal(target.app.store.snapshots.expirePackage(uploaded.packageId, new Date(Date.now() + 48 * 60 * 60_000).toISOString()), true);
  await rm(exported.path, { force: true });
  await rm(join(target.paths.snapshotsDirectory, "packages", `${uploaded.packageId}.work`), { force: true });
  const deniedUpload = await upload(target, deniedExport.path, deniedExport.digest, deniedExport.size);
  const deniedTargetId = await importPackage(target, deniedUpload.packageId, "denied-tool-copy");
  assert.ok(JSON.parse(target.app.store.getWorkConfiguration(deniedTargetId).activeConfigJson).tools.denied.includes("work-services.service_stop"),
    "imported active context must retain the source tool denial");
  trackImportedVolumes(target, deniedTargetId);
  assert.notEqual(first, second);
  const importedDomains = [];
  for (const workId of [first, second]) {
    const web = (await json(target, `/api/v1/works/${workId}/services`)).services.find((service) => service.name === "web");
    assert.ok(web?.access?.hostname);
    assert.equal(web.access.status, "unavailable", "an imported Work remains stopped");
    importedDomains.push(web.access.hostname);
    await verifySourceUrlFile(target, workId, sourceUrl);
    const denied = await fetch(`${target.base}/api/v1/service-gateway/${web.access.hostname}/8000/`,
      { headers: { "x-piwork-gateway-token": target.headers.authorization.slice(7) } });
    assert.equal(denied.status, 503, "a stopped imported Work cannot serve its new domain");
  }
  assert.notEqual(importedDomains[0], importedDomains[1]);
  assert.notEqual(importedDomains[0], new URL(sourceUrl).hostname);
  assert.notEqual(importedDomains[1], new URL(sourceUrl).hostname);
  for (const workId of [first, second]) {
    const web = target.app.store.listServices(workId, true).find((item) => item.name === "web");
    assert.equal(web?.enabled, true); assert.equal(web?.observedState, "stopped");
    assert.equal(web?.appliedRevision, 1, "historic applied revision is not current readiness");
    assert.equal(target.app.store.getServiceRuntimeBinding(workId, web.serviceId).recoveryCount, 3,
      "import must retain exhausted recovery budget until explicit retry");
  }
  const webFirst = target.app.store.listServices(first, true).find((item) => item.name === "web");
  const retry = await json(target, `/api/v1/works/${first}/services/${webFirst.serviceId}/retry`, "POST", { idempotencyKey: `retry-${randomUUID()}` });
  await waitOperation(target, retry.operationId);
  assert.equal(target.app.store.getServiceRuntimeBinding(first, webFirst.serviceId).recoveryCount, 0);
  await runCode(target, first); await runCode(target, second);
  await changeBusiness(target, first);
  await runCode(target, first, 8); await runCode(target, second);
  const coldUpload = await upload(target, coldExport.path, coldExport.digest, coldExport.size);
  const coldTargetId = await importPackage(target, coldUpload.packageId, "never-started-copy");
  assert.equal(target.app.store.getWorkConfiguration(coldTargetId).desiredConfigJson.includes("work-services"), false,
    "removed built-in MCP must not be copied from target defaults");
  trackImportedVolumes(target, coldTargetId);
  assert.equal(target.app.store.getWorkConfiguration(coldTargetId).activeContextId, null);
  await startWork(target, coldTargetId);
  await verifyWebService(target, coldTargetId);
  assert.equal((await agentTools(target, coldTargetId)).some((tool) => tool.startsWith("work-services.")), false,
    "target defaults must not restore a source-removed MCP server");
  await conversationRound(target, coldTargetId);
  await stopWork(target, coldTargetId);
  const sourceWebId = source.app.store.listServices(sourceId, true).find((item) => item.name === "web").serviceId;
  await source.app.close();
  apps.splice(apps.indexOf(source.app), 1);
  await startWork(target, first);
  await packageChat(target, first, "source-v1");
  await fixtureChat(target, first, "v1");
  await verifyWebService(target, first);
  const firstWebAccess = (await json(target, `/api/v1/works/${first}/services`)).services.find((service) => service.name === "web").access;
  const secondWebAccess = (await json(target, `/api/v1/works/${second}/services`)).services.find((service) => service.name === "web").access;
  assert.equal(firstWebAccess.hostname, importedDomains[0]);
  assert.equal(firstWebAccess.status, "no-default-port");
  assert.equal(secondWebAccess.hostname, importedDomains[1]);
  assert.equal(secondWebAccess.status, "unavailable", "starting one imported Work cannot expose the other");
  const firstWebResponse = await fetch(`${target.base}/api/v1/service-gateway/${firstWebAccess.hostname}/8000/service-url.txt`,
    { headers: { "x-piwork-gateway-token": target.headers.authorization.slice(7) } });
  assert.equal(firstWebResponse.status, 200);
  assert.equal(await firstWebResponse.text(), sourceUrl);
  const foreignTargetWebId = target.app.store.listServices(second, true).find((item) => item.name === "web")?.serviceId;
  assert.ok(foreignTargetWebId);
  const foreignBefore = target.app.store.getService(second, foreignTargetWebId, true);
  await verifyScopedServiceAccess(target, first, [sourceWebId, foreignTargetWebId]);
  assert.deepEqual(target.app.store.getService(second, foreignTargetWebId, true), foreignBefore,
    "another Work's service must remain unchanged after rejected requests");
  assert.notEqual(webFirst.serviceId, sourceWebId, "target service identity must be new");
  assert.ok(target.app.store.getWorkConfiguration(first).activeConfigJson.includes("work-services"), "active built-in MCP must survive import");
  await conversationRound(target, first, undefined, "verify restored web service");
  await conversationRound(target, first, sessionId, "invoke package tool hello");
  assert.equal(target.app.store.listServices(first, true).find((item) => item.name === "web")?.enabled, true);
  assert.ok(target.app.store.listOperations().some((item) => item.workId === first && item.kind === "disable-service"), "pi-agentd MCP must stop restored service");
  assert.ok(target.app.store.listOperations().some((item) => item.workId === first && item.kind === "enable-service"), "pi-agentd MCP must restart restored service");
  assert.equal(target.app.store.getWorkConfiguration(first).activeContextId, firstConfiguration.activeContextId,
    "first start must use imported active context rather than auto-applying desired context");
  assert.equal(target.app.store.getWorkConfiguration(first).pendingRestart, true);
  const targetSessions = await json(target, `/api/v1/works/${first}/sessions`);
  assert.ok(targetSessions.sessions.some((item) => item.sessionId === sessionId), "source Session must remain visible after first import");
  await stopWork(target, first);
  await startWork(target, deniedTargetId);
  const deniedContextId = target.app.store.getWorkConfiguration(deniedTargetId).activeContextId;
  assert.ok(target.app.workContexts.load(deniedTargetId, deniedContextId).configuration.tools.denied.includes("work-services.service_stop"),
    "runtime context snapshot must retain the source tool denial");
  const deniedTools = await agentTools(target, deniedTargetId);
  assert.ok(deniedTools.includes("work-services.service_list"), "imported agent must retain allowed service tools");
  assert.equal(deniedTools.includes("work-services.service_stop"), false,
    "imported agent must not expose the source-denied service tool");
  await stopWork(target, deniedTargetId);
  await startWork(target, second);
  await verifyWebService(target, second);
  await stopWork(target, second);
  const apply = await json(target, `/api/v1/works/${second}/configuration/apply`, "POST", { idempotencyKey: `apply-${randomUUID()}` });
  await waitOperation(target, apply.operationId);
  assert.equal(target.app.store.getWorkConfiguration(second).pendingRestart, false, "explicit apply must activate pending context");
  assertPackageVersions(target, second, "2.0.0", "2.0.0");
  await startWork(target, second);
  await packageChat(target, second, "source-v2");
  await stopWork(target, second);
  const adoptTargetHead = await cli(target, "packages", "update", second, portablePackageName, "--from-core", "--wait");
  assert.equal(adoptTargetHead.state, "succeeded");
  assertPackageVersions(target, second, "2.0.0", "3.0.0");
  await startWork(target, second);
  await packageChat(target, second, "source-v2");
  await stopWork(target, second);
  const adoptApply = await json(target, `/api/v1/works/${second}/configuration/apply`, "POST", { idempotencyKey: `apply-${randomUUID()}` });
  await waitOperation(target, adoptApply.operationId);
  assertPackageVersions(target, second, "3.0.0", "3.0.0");
  await startWork(target, second);
  await packageChat(target, second, "target-v3");
  await stopWork(target, second);
  for (const workId of [first, second]) {
    const service = target.app.store.listServices(workId, true).find((item) => item.name === "retained-worker");
    assert.ok(service?.tombstonedAt);
    assert.equal(target.app.store.getQuotaReservation(workId, "service", service.serviceId).desiredCpuMillis, 250);
    assert.equal(target.app.store.getQuotaReservation(workId, "service", service.serviceId).occupiedCpuMillis, 0);
    assert.equal(target.app.store.listServices(workId, true).find((item) => item.name === "web")?.enabled, true);
    assert.equal(target.app.store.listVolumeReferences(workId).filter((item) => item.consumerKind === "service").length, 2);
  }
  const reexported = await exportWork(target, first);
  await verifySourceUrlPackage(reexported.path, sourceUrl);
  const thirdId = await importPackageViaCli(third, reexported.path);
  trackImportedVolumes(third, thirdId);
  await assertFixtureContexts(third, thirdId);
  await runCode(third, thirdId, 8);
  await startWork(third, thirdId);
  assertPackageVersions(third, thirdId, "1.0.0", "2.0.0");
  await packageChat(third, thirdId, "source-v1");
  await fixtureChat(third, thirdId, "v1");
  await verifyWebService(third, thirdId);
  const sessions = await json(third, `/api/v1/works/${thirdId}/sessions`);
  assert.ok(sessions.sessions.some((item) => item.sessionId === sessionId), "imported Session must remain visible");
  await conversationRound(third, thirdId, sessionId, "invoke package tool hello");
  await stopWork(third, thirdId);
  assert.equal(third.app.store.listVolumeReferences(thirdId).filter((item) => item.consumerKind === "service").length, 2);
  console.log(JSON.stringify({ status: "passed", source: sourceId, copies: [first, second, thirdId], sessionId,
    sourceDigest: exported.digest, reexportDigest: reexported.digest, coldSourceId, coldTargetId }));
} finally {
  for (const app of apps.reverse()) await app.close().catch(() => undefined);
  if (fixtureContainerId) await docker("container", "rm", "--force", fixtureContainerId).catch(() => undefined);
  for (const installationId of installations.reverse()) {
    if (process.env.PIWORK_KEEP_SNAPSHOT_ACCEPTANCE_CONTAINERS === "1") continue;
    try {
      assert.match(installationId, /^piwork-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      const filter = `label=piwork.installation_id=${installationId}`;
      const containers = (await docker("container", "ls", "-aq", "--filter", filter)).split(/\s+/).filter(Boolean);
      for (const id of containers) {
        assert.equal(await docker("container", "inspect", "--format", '{{index .Config.Labels "piwork.installation_id"}}', id), installationId);
        await docker("container", "rm", "--force", id);
      }
      const networks = (await docker("network", "ls", "-q", "--filter", filter)).split(/\s+/).filter(Boolean);
      for (const id of networks) {
        assert.equal(await docker("network", "inspect", "--format", '{{index .Labels "piwork.installation_id"}}', id), installationId);
        await docker("network", "rm", id);
      }
      const volumes = (await docker("volume", "ls", "-q", "--filter", filter)).split(/\s+/).filter(Boolean);
      for (const name of volumes) {
        assert.equal(await docker("volume", "inspect", "--format", '{{index .Labels "piwork.installation_id"}}', name), installationId);
        await docker("volume", "rm", name);
      }
    } catch (error) { process.stderr.write(`snapshot acceptance cleanup retained resources for ${installationId}: ${String(error)}\n`); }
  }
  if (serviceImageId) {
    const label = await docker("image", "inspect", "--format", '{{index .Config.Labels "piwork.acceptance"}}', serviceImageId).catch(() => "");
    if (label === fixtureId) await docker("image", "rm", "--force", serviceImageId).catch(() => undefined);
  }
  await packageSources?.close();
  if (process.env.PIWORK_KEEP_SNAPSHOT_ACCEPTANCE_TEMP !== "1") await rm(root, { recursive: true, force: true });
}
