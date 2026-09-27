import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore } from "@piwork/core-store";
import { PiPackageHelperIncompatibleError, type DockerRuntime } from "@piwork/runtime-docker";
import type { RuntimeProfileStore } from "../configuration/runtime-profile.js";
import { CorePiPackageService } from "./service.js";

for (const scope of ["core", "work"] as const) test(`${scope} package acceptance preflights both images after replay`, async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-package-helper-preflight-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  const now = new Date().toISOString();
  const prepareImageId = `sha256:${"a".repeat(64)}`, trustedImageId = `sha256:${"b".repeat(64)}`;
  const environment = { os: "linux" as const, architecture: "amd64", variant: null,
    nodeAbi: process.versions.modules, piSdkVersion: "0.86.1" };
  try {
    if (scope === "work") store.exec(`INSERT INTO users VALUES ('admin-1', 'admin', 'digest', 'admin', 1, '${now}', '${now}');
      INSERT INTO works(id, owner_user_id, name, desired_state, observed_state, desired_revision, control_version, created_at, updated_at)
      VALUES ('work-1', 'admin-1', 'one', 'stopped', 'stopped', 1, 1, '${now}', '${now}')`);
    let missing: string | null = prepareImageId, movedTag = false, unavailable = false;
    const checked: string[] = [];
    const runtime = {
      async prepareImage(reference: string) {
        if (unavailable) throw new Error("image was removed");
        return { imageId: reference === "trusted" ? trustedImageId : movedTag ? trustedImageId : prepareImageId };
      },
      async inspectPiPackageHelperContract(imageId: string) {
        checked.push(imageId);
        if (imageId === missing) throw new PiPackageHelperIncompatibleError();
      },
      async inspectPiPackageEnvironment() { return environment; },
    } as unknown as DockerRuntime;
    const profiles = { load: () => ({ agentImage: "prep" }) } as unknown as RuntimeProfileStore;
    const service = new CorePiPackageService(store, runtime, profiles, "trusted", "installation-1", root);
    service.worker.kick = () => undefined;
    const submit = (key: string) => scope === "core"
      ? service.install({ kind: "npm", spec: "tools@1.0.0" }, false, key, "operator")
      : service.acceptWork({ actorId: "admin-1", workId: "work-1", imageIdentity: prepareImageId, kind: "install",
        name: null, source: { kind: "npm", spec: "tools@1.0.0" }, idempotencyKey: key });
    await assert.rejects(submit("missing-prepare"), (error) =>
      (error as { code?: string }).code === "PI_PACKAGE_HELPER_INCOMPATIBLE" &&
      !(error as Error).message.includes("/workspace"));
    assert.equal(store.packages.listJobs().length, 0);
    missing = trustedImageId;
    await assert.rejects(submit("missing-trusted"), (error) =>
      (error as { code?: string }).code === "PI_PACKAGE_HELPER_INCOMPATIBLE");
    assert.equal(store.packages.listJobs().length, 0);
    missing = null;
    const accepted = await submit("accepted");
    assert.equal(store.packages.getJob(accepted.operationId)?.prepareImageId, prepareImageId);
    if (scope === "core") {
      const queued = service.operation(accepted.operationId);
      assert.equal(queued.packagePhase, "queued");
      store.packages.advanceJob(accepted.operationId, 1, "prepare", now, { helperId: "secret-helper-id" });
      const preparing = service.operation(accepted.operationId);
      assert.equal(preparing.packagePhase, "prepare");
      assert.equal(preparing.state, "running");
      assert.doesNotMatch(JSON.stringify(preparing), /secret-helper-id|sourceJson|helperId|tools@1\.0\.0/);
      const restarted = new CorePiPackageService(store, runtime, profiles, "trusted", "installation-1", root);
      assert.equal(restarted.operation(accepted.operationId).packagePhase, "prepare");
    }
    store.packages.finishJob(accepted.operationId, 1, "failed", now, JSON.stringify({ code: "PI_PACKAGE_PREPARATION_FAILED" }));
    const checkedBeforeReplay = checked.length;
    movedTag = true;
    unavailable = true;
    missing = prepareImageId;
    assert.deepEqual(await submit("accepted"), { ...accepted, reused: true });
    assert.equal(checked.length, checkedBeforeReplay);
    assert.equal(store.packages.listJobs().length, 1);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

for (const scope of ["core", "work"] as const) test(`${scope} package requests replay a failed Operation after its upload expires`, async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-package-expired-replay-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  const now = new Date();
  const imageId = `sha256:${"a".repeat(64)}`;
  const environment = { os: "linux", architecture: "amd64", variant: null,
    nodeAbi: process.versions.modules, piSdkVersion: "0.86.0" };
  const actorId = scope === "core" ? "operator" : "admin-1";
  const workId = scope === "core" ? null : "work-1";
  try {
    if (workId !== null) store.exec(`INSERT INTO users VALUES ('admin-1', 'admin', 'digest', 'admin', 1, '${now.toISOString()}', '${now.toISOString()}');
      INSERT INTO works(id, owner_user_id, name, desired_state, observed_state, desired_revision, control_version, created_at, updated_at)
      VALUES ('work-1', 'admin-1', 'one', 'stopped', 'stopped', 1, 1, '${now.toISOString()}', '${now.toISOString()}')`);
    const addUpload = (digest: string) => {
      const id = `upload-${randomUUID()}`;
      store.packages.insertUpload({ id, actorId, scopeKind: scope, workId, sourceKind: "zip", displayName: "tools.zip",
        digest, size: 100, state: "ready", expiresAt: new Date(now.getTime() + 86400000).toISOString(),
        leaseCount: 0, createdAt: now.toISOString() });
      return id;
    };
    const uploadId = addUpload(`sha256:${"b".repeat(64)}`);
    const runtime = { async prepareImage() { return { imageId }; }, async inspectPiPackageHelperContract() {},
      async inspectPiPackageEnvironment() { return environment; } } as unknown as DockerRuntime;
    const profiles = { load: () => ({ agentImage: imageId }) } as unknown as RuntimeProfileStore;
    const service = new CorePiPackageService(store, runtime, profiles, imageId, "installation-1", root);
    service.worker.kick = () => undefined;
    const submit = (id: string, key: string) => scope === "core"
      ? service.install({ kind: "upload", uploadId: id }, false, key, actorId)
      : service.acceptWork({ actorId, workId: workId!, imageIdentity: imageId, kind: "install", name: null,
        source: { kind: "upload", uploadId: id }, idempotencyKey: key });
    const first = await submit(uploadId, "original-key");
    store.packages.finishJob(first.operationId, 1, "failed", now.toISOString(), JSON.stringify({ code: "PI_PACKAGE_PREPARATION_FAILED" }));
    store.packages.expireUploads(new Date(now.getTime() + 2 * 86400000).toISOString());
    assert.equal(store.packages.getUpload(uploadId)?.state, "expired");
    assert.deepEqual(await submit(uploadId, "original-key"), { ...first, reused: true });
    await assert.rejects(submit(uploadId, "new-key"), (error: unknown) =>
      (error as { code?: string }).code === "PI_PACKAGE_NOT_FOUND");
    const sameContent = addUpload(`sha256:${"b".repeat(64)}`);
    assert.deepEqual(await submit(sameContent, "original-key"), { ...first, reused: true });
    const differentContent = addUpload(`sha256:${"c".repeat(64)}`);
    await assert.rejects(submit(differentContent, "original-key"), { name: "IdempotencyConflictError" });
    assert.equal(store.getOperation(first.operationId)?.state, "failed");
    assert.equal(store.packages.listJobs().length, 1);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

for (const caseName of ["updated", "disabled", "removed", "incompatible"] as const) test(`from-Core acceptance rejects stale ${caseName} head after asynchronous image preparation`, async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-package-acceptance-race-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  const now = new Date().toISOString();
  const environment = { os: "linux", architecture: "amd64", variant: null, nodeAbi: "137", piSdkVersion: "0.86.0" };
  const imageId = `sha256:${"a".repeat(64)}`;
  try {
    store.exec(`INSERT INTO users VALUES ('admin-1', 'admin', 'digest', 'admin', 1, '${now}', '${now}');
      INSERT INTO works(id, owner_user_id, name, desired_state, observed_state, desired_revision, control_version, created_at, updated_at)
      VALUES ('work-1', 'admin-1', 'one', 'stopped', 'stopped', 1, 1, '${now}', '${now}')`);
    for (const [id, digest] of [["artifact-one", "b"], ["artifact-two", "c"]]) {
      store.exec(`INSERT INTO pi_package_artifacts(id,scope_kind,work_id,name,content_digest,metadata_json,storage_path,created_at)
        VALUES ('${id}','core',NULL,'tools','sha256:${digest!.repeat(64)}','${JSON.stringify({ preparedEnvironment: environment })}','/artifacts/${id}','${now}')`);
    }
    store.exec(`INSERT INTO pi_package_catalog(name,enabled,head_artifact_id,generation,created_at,updated_at)
      VALUES ('tools',1,'artifact-one',1,'${now}','${now}')`);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runtime = {
      async prepareImage() { entered(); await gate; return { imageId }; },
      async inspectPiPackageHelperContract() {},
      async inspectPiPackageEnvironment() { return environment; },
    } as unknown as DockerRuntime;
    const service = new CorePiPackageService(store, runtime, {} as RuntimeProfileStore, imageId, "installation-1", root);
    service.worker.kick = () => undefined;
    const pending = service.acceptWork({ actorId: "admin-1", workId: "work-1", imageIdentity: imageId,
      kind: "install", name: null, source: { kind: "core", name: "tools" }, idempotencyKey: "capture-after-await" });
    await started;
    if (caseName === "updated" || caseName === "incompatible") {
      store.exec("UPDATE pi_package_catalog SET head_artifact_id = 'artifact-two', generation = 2 WHERE name = 'tools'");
    }
    if (caseName === "disabled") store.exec("UPDATE pi_package_catalog SET enabled = 0 WHERE name = 'tools'");
    if (caseName === "removed") store.exec("DELETE FROM pi_package_catalog WHERE name = 'tools'");
    if (caseName === "incompatible") {
      store.exec(`UPDATE pi_package_artifacts SET metadata_json = '${JSON.stringify({ preparedEnvironment: { ...environment, piSdkVersion: "0.86.1" } })}' WHERE id = 'artifact-two'`);
    }
    release();
    if (caseName === "updated") {
      const accepted = await pending;
      assert.deepEqual(JSON.parse(store.packages.getJob(accepted.operationId)!.sourceJson),
        { kind: "core", name: "tools", artifactId: "artifact-two" });
    } else {
      await assert.rejects(pending, (error: unknown) => (error as { code?: string }).code ===
        (caseName === "incompatible" ? "PI_PACKAGE_ENVIRONMENT_MISMATCH" : "PI_PACKAGE_NOT_FOUND"));
      assert.equal(store.packages.listJobs().length, 0);
    }
    assert.equal(store.get<{ lease_count: number }>("SELECT lease_count FROM pi_package_artifacts WHERE id = 'artifact-one'")?.lease_count, 0);
    assert.equal(store.get<{ lease_count: number }>("SELECT lease_count FROM pi_package_artifacts WHERE id = 'artifact-two'")?.lease_count,
      caseName === "updated" ? 1 : 0);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});
