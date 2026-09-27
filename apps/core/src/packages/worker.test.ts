import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore } from "@piwork/core-store";
import { extractPiPackageZip, packPiPackageDirectory, PiPackageInputError, validatePiPackageArtifact } from "@piwork/pi-package";
import type { PiPackageHelperSpec } from "@piwork/runtime-docker";
import { PiPackageWorker } from "./worker.js";
import type { PiPackagePreparationRuntime } from "./prepare.js";

const NOW = "2026-09-25T00:00:00.000Z";
const environment = { os: "linux" as const, architecture: "amd64", variant: null, nodeAbi: "137", piSdkVersion: "0.86.0" };

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "piwork-package-worker-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  store.updateDefaultWorkConfiguration({ packages: [], skills: [], agentsMd: "keep" }, NOW);
  return { root, store, async close() { store.close(); await rm(root, { recursive: true, force: true }); } };
}

function accept(store: CoreStore, key: string, name: string, addToDefaults = false, deadlineAt = "2026-09-25T00:30:00.000Z") {
  return store.packages.accept({ actorId: "admin-1", scope: { kind: "core" }, kind: "install",
    prepareImageId: `sha256:${"a".repeat(64)}`, trustedHelperImageId: `sha256:${"b".repeat(64)}`,
    preparedEnvironmentJson: JSON.stringify(environment), addToDefaults, idempotencyKey: key,
    requestDigest: key, requestJson: JSON.stringify({ name }), sourceJson: JSON.stringify({ kind: "npm", spec: `${name}@1.0.0` }),
    packageName: name, now: NOW, deadlineAt });
}

function fakeRuntime(root: string, waitForPrepare?: () => Promise<void>, failPrepare: boolean | Error = false, measuredBytes = 0): PiPackagePreparationRuntime &
  { starts: string[]; removedHelpers: string[]; removedResources: string[] } {
  const specs = new Map<string, PiPackageHelperSpec>();
  const names = new Map<string, string>();
  const starts: string[] = [], removedHelpers: string[] = [], removedResources: string[] = [];
  return {
    starts, removedHelpers, removedResources,
    async ensurePiPackageResources(jobId) { return { volumeName: `volume-${jobId}`, networkName: `network-${jobId}` }; },
    async measurePiPackageVolume() { return measuredBytes; },
    async removePiPackageResources(jobId) { removedResources.push(jobId); },
    async createPiPackageHelper(spec) { specs.set(spec.name, spec); return spec.name; },
    async removePiPackageHelper(name) { removedHelpers.push(name); specs.delete(name); },
    async startPiPackageHelper(name, jobId) {
      const spec = specs.get(name)!;
      starts.push(spec.action);
      if (spec.action === "init") return { initialized: true };
      if (spec.action === "prepare") {
        await waitForPrepare?.();
        if (failPrepare) throw failPrepare instanceof Error ? failPrepare : new Error("secret child output must never be public");
        const request = JSON.parse(await readFile(join(spec.sourceDirectory!, "request.json"), "utf8")) as { source: { spec: string } };
        const packageName = request.source.spec.split("@")[0]!;
        names.set(jobId, packageName);
        return { name: packageName, version: "1.0.0", sourceKind: "npm", resolvedSource: `${packageName}@1.0.0` };
      }
      const packageName = names.get(jobId)!;
      const source = join(root, "fixtures", packageName);
      await mkdir(source, { recursive: true });
      await writeFile(join(source, "package.json"), JSON.stringify({ name: packageName, version: "1.0.0" }));
      const validated = await validatePiPackageArtifact({ root: source, sourceKind: "npm", resolvedSource: `${packageName}@1.0.0`, preparedEnvironment: environment });
      const packed = await packPiPackageDirectory(source, join(spec.spoolDirectory!, "artifact.zip"));
      const result = { metadata: validated.metadata, inventory: validated.inventory, zipBytes: packed.bytes, zipSha256: packed.digest };
      await writeFile(join(spec.spoolDirectory!, "result.json"), JSON.stringify(result));
      return result;
    },
  };
}

test("Core scope exclusion and publication preserve default Work configuration", async () => {
  const f = await fixture();
  try {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runtime = fakeRuntime(f.root, async () => { await gate; });
    const first = accept(f.store, "one", "tool-one", true);
    // Only one Core job can be accepted at once; another scope may run concurrently.
    assert.throws(() => accept(f.store, "two", "tool-two"), /already active/);
    const worker = new PiPackageWorker({ store: f.store, runtime, installationId: "installation-1", dataDirectory: f.root,
      now: () => new Date(NOW) });
    const run = worker.drainOnce();
    // Scope exclusion is a stronger bound than global capacity for Core catalog jobs.
    await Promise.resolve();
    assert.equal(worker.activeCount, 1);
    release();
    await run;
    assert.equal(f.store.packages.getCatalog("tool-one")?.name, "tool-one");
    assert.equal(f.store.packages.getJob(first.operationId)?.phase, "succeeded");
    assert.deepEqual(f.store.getDefaultWorkConfiguration()?.configuration, { packages: [{ name: "tool-one", enabled: true }], skills: [], agentsMd: "keep" });
    assert.deepEqual(runtime.starts, ["init", "prepare", "capture"]);
  } finally { await f.close(); }
});

test("unsupported Pi peer version is reported without leaking helper detail or publishing", async () => {
  const f = await fixture();
  try {
    const runtime = fakeRuntime(f.root, undefined,
      new PiPackageInputError("PI_PACKAGE_SDK_VERSION_UNSUPPORTED", "secret subprocess detail"));
    const accepted = accept(f.store, "peer-old", "tool-one");
    const worker = new PiPackageWorker({ store: f.store, runtime, installationId: "installation-1", dataDirectory: f.root,
      now: () => new Date(NOW) });
    await worker.drainOnce();
    const operation = f.store.getOperation(accepted.operationId)!;
    assert.equal(operation.state, "failed");
    assert.equal((JSON.parse(operation.errorJson!) as { code: string }).code, "PI_PACKAGE_SDK_VERSION_UNSUPPORTED");
    assert.equal(operation.errorJson?.includes("secret subprocess detail"), false);
    assert.equal(f.store.packages.getCatalog("tool-one"), undefined);
  } finally { await f.close(); }
});

for (const scope of ["core", "work"] as const) for (const code of [
  "PI_PACKAGE_SOURCE_FETCH_FAILED", "PI_PACKAGE_DEPENDENCY_INSTALL_FAILED",
] as const) test(`${scope} package command failure preserves state and publishes a fixed ${code} error`, async () => {
  const f = await fixture();
  try {
    if (scope === "work") f.store.exec(`INSERT INTO users VALUES ('admin-1', 'admin', 'digest', 'admin', 1, '${NOW}', '${NOW}');
      INSERT INTO works(id, owner_user_id, name, desired_state, observed_state, desired_revision, control_version, created_at, updated_at)
      VALUES ('work-1', 'admin-1', 'one', 'stopped', 'stopped', 1, 1, '${NOW}', '${NOW}')`);
    const accepted = scope === "core" ? accept(f.store, `${scope}-${code}`, "tool-one", true)
      : f.store.packages.accept({ actorId: "admin-1", scope: { kind: "work", workId: "work-1" }, kind: "install",
        prepareImageId: `sha256:${"a".repeat(64)}`, trustedHelperImageId: `sha256:${"b".repeat(64)}`,
        preparedEnvironmentJson: JSON.stringify(environment), addToDefaults: false, idempotencyKey: code,
        requestDigest: code, requestJson: "{}", sourceJson: JSON.stringify({ kind: "npm", spec: "tool-one@1.0.0" }),
        now: NOW, deadlineAt: "2026-09-25T00:30:00.000Z" });
    const runtime = fakeRuntime(f.root, undefined, Object.assign(new Error("child-private-marker"), { code }));
    await new PiPackageWorker({ store: f.store, runtime, installationId: "installation-1", dataDirectory: f.root,
      now: () => new Date(NOW) }).drainOnce();
    const operation = f.store.getOperation(accepted.operationId)!;
    const failure = JSON.parse(operation.errorJson!) as { stage: string; code: string; message: string };
    assert.equal(operation.state, "failed");
    assert.equal(failure.stage, "prepare");
    assert.equal(failure.code, code);
    assert.equal(operation.errorJson!.includes("child-private-marker"), false);
    assert.equal(f.store.packages.getCatalog("tool-one"), undefined);
    assert.deepEqual((f.store.getDefaultWorkConfiguration()?.configuration as { packages: unknown }).packages, []);
    assert.deepEqual(runtime.starts, ["init", "prepare"]);
    assert.ok(runtime.removedHelpers.some((name) => name.includes("prepare")));
    assert.deepEqual(runtime.removedResources, [accepted.operationId]);
    if (scope === "work") assert.equal(f.store.getWork("work-1")?.desiredRevision, 1);
  } finally { await f.close(); }
});

test("preparation volume overflow fails safely before capture and cleans owned resources", async () => {
  const f = await fixture();
  try {
    const runtime = fakeRuntime(f.root, undefined, false, 4 * 1024 * 1024 * 1024 + 1);
    const accepted = accept(f.store, "volume-overflow", "tool-one");
    const worker = new PiPackageWorker({ store: f.store, runtime, installationId: "installation-1", dataDirectory: f.root,
      now: () => new Date(NOW) });
    await worker.drainOnce();
    assert.equal(f.store.packages.getJob(accepted.operationId)?.phase, "failed");
    assert.equal(f.store.packages.getCatalog("tool-one"), undefined);
    assert.equal((JSON.parse(f.store.getOperation(accepted.operationId)!.errorJson!) as { code: string }).code,
      "PI_PACKAGE_LIMIT_EXCEEDED");
    assert.deepEqual(runtime.starts, ["init", "prepare"]);
    assert.ok(runtime.removedHelpers.some((name) => name.includes("prepare")));
    assert.deepEqual(runtime.removedResources, [accepted.operationId]);
  } finally { await f.close(); }
});

test("package worker admits at most two jobs while a third remains queued", async () => {
  const jobs = ["operation-a", "operation-b", "operation-c"].map((operationId) => ({ operationId, phase: "queued" }));
  const store = { packages: { listJobs: () => jobs } } as unknown as CoreStore;
  const worker = new PiPackageWorker({ store, runtime: fakeRuntime("/tmp"), installationId: "installation-1", dataDirectory: "/tmp", capacity: 2 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started: string[] = [];
  (worker as unknown as { runJob(job: { operationId: string }): Promise<void> }).runJob = async (job) => {
    started.push(job.operationId);
    await gate;
    const row = jobs.find((item) => item.operationId === job.operationId)!;
    row.phase = "succeeded";
  };
  const first = worker.drainOnce();
  await Promise.resolve();
  assert.deepEqual(started, ["operation-a", "operation-b"]);
  assert.equal(worker.activeCount, 2);
  assert.equal(jobs[2]!.phase, "queued");
  release();
  await first;
  await worker.drainOnce();
  assert.deepEqual(started, ["operation-a", "operation-b", "operation-c"]);
});

test("a failed or expired helper keeps the old catalog and exposes no child output", async () => {
  const f = await fixture();
  try {
    const runtime = fakeRuntime(f.root, undefined, true);
    const accepted = accept(f.store, "one", "tool-one");
    const worker = new PiPackageWorker({ store: f.store, runtime, installationId: "installation-1", dataDirectory: f.root,
      now: () => new Date(NOW) });
    await worker.drainOnce();
    const operation = f.store.get<{ state: string; error_json: string }>(`SELECT state, error_json FROM operations WHERE id = '${accepted.operationId}'`);
    assert.equal(operation?.state, "failed");
    assert.equal(operation?.error_json?.includes("secret child output"), false, JSON.stringify({ operation, job: f.store.packages.getJob(accepted.operationId) }));
    assert.equal(f.store.packages.getCatalog("tool-one"), undefined);
    const expired = accept(f.store, "two", "tool-two", false, "2026-09-24T23:59:59.000Z");
    await worker.drainOnce();
    assert.equal(f.store.packages.getJob(expired.operationId)?.phase, "failed");
    assert.equal(runtime.starts.filter((item) => item === "prepare").length, 1);
  } finally { await f.close(); }
});

test("restart recovery cleans owned resources and never reruns an interrupted script", async () => {
  const f = await fixture();
  try {
    const runtime = fakeRuntime(f.root);
    const accepted = accept(f.store, "interrupted", "tool-one");
    f.store.packages.advanceJob(accepted.operationId, 1, "prepare", NOW, { helperId: "helper-interrupted" });
    const worker = new PiPackageWorker({ store: f.store, runtime, installationId: "installation-1", dataDirectory: f.root,
      now: () => new Date(NOW) });
    await worker.recover();
    assert.equal(f.store.packages.getJob(accepted.operationId)?.phase, "failed");
    assert.equal(f.store.getOperation(accepted.operationId)?.state, "failed");
    assert.deepEqual(runtime.starts, []);
    await worker.drainOnce();
    assert.deepEqual(runtime.starts, []);
  } finally { await f.close(); }
});

test("restart recovery publishes a complete trusted capture without rerunning preparation", async () => {
  const f = await fixture();
  try {
    const accepted = accept(f.store, "captured", "tool-one", true);
    const spool = join(f.root, "pi-packages", "jobs", accepted.operationId, "spool");
    const source = join(f.root, "fixture");
    await mkdir(spool, { recursive: true });
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "package.json"), JSON.stringify({ name: "tool-one", version: "1.0.0" }));
    const validated = await validatePiPackageArtifact({ root: source, sourceKind: "npm", resolvedSource: "tool-one@1.0.0", preparedEnvironment: environment });
    const packed = await packPiPackageDirectory(source, join(spool, "artifact.zip"));
    await writeFile(join(spool, "result.json"), JSON.stringify({ metadata: validated.metadata,
      zipBytes: packed.bytes, zipSha256: packed.digest }));
    const publishedTree = join(f.root, "pi-packages", "artifacts", validated.metadata.contentDigest.slice("sha256:".length));
    await extractPiPackageZip(join(spool, "artifact.zip"), publishedTree);
    f.store.packages.advanceJob(accepted.operationId, 1, "publish", NOW);
    const runtime = fakeRuntime(f.root);
    const worker = new PiPackageWorker({ store: f.store, runtime, installationId: "installation-1", dataDirectory: f.root,
      now: () => new Date(NOW) });
    await worker.recover();
    assert.equal(f.store.packages.getJob(accepted.operationId)?.phase, "succeeded");
    assert.equal(f.store.getOperation(accepted.operationId)?.state, "succeeded");
    assert.equal(f.store.packages.getCatalog("tool-one")?.name, "tool-one");
    assert.deepEqual(f.store.getDefaultWorkConfiguration()?.configuration, { packages: [{ name: "tool-one", enabled: true }], skills: [], agentsMd: "keep" });
    assert.deepEqual(runtime.starts, []);
    const orphanedJobRoot = join(f.root, "pi-packages", "jobs", accepted.operationId);
    await mkdir(orphanedJobRoot, { recursive: true });
    await worker.recover();
    assert.equal(f.store.packages.listCatalog().length, 1);
    await assert.rejects(lstat(orphanedJobRoot), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
  } finally { await f.close(); }
});
