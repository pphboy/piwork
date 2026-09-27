import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore } from "./store.js";
import { PiPackageStoreError, type AcceptPiPackageJob, type PiPackageArtifactRecord } from "./pi-packages.js";

const NOW = "2026-09-25T00:00:00.000Z";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "piwork-package-store-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  return { store, async close() { store.close(); await rm(root, { recursive: true, force: true }); } };
}

function request(key: string, name = "example-tools", scope: AcceptPiPackageJob["scope"] = { kind: "core" }, addToDefaults = false): AcceptPiPackageJob {
  return {
    actorId: "admin-1", scope, kind: "install", idempotencyKey: key, requestDigest: `digest-${key}`,
    prepareImageId: `sha256:${"a".repeat(64)}`, trustedHelperImageId: `sha256:${"b".repeat(64)}`,
    preparedEnvironmentJson: '{"os":"linux","architecture":"amd64","variant":null,"nodeAbi":"137","piSdkVersion":"0.86.0"}', addToDefaults,
    requestJson: JSON.stringify({ name }), sourceJson: JSON.stringify({ kind: "npm", specifier: `${name}@1.0.0` }),
    packageName: name, deadlineAt: "2026-09-25T00:30:00.000Z", now: NOW,
  };
}

function artifact(name: string, id: string): PiPackageArtifactRecord {
  return {
    id, scopeKind: "core", workId: null, name, contentDigest: `sha256:${"a".repeat(64)}`,
    metadataJson: JSON.stringify({ name, version: "1.0.0" }), storagePath: `/artifacts/${id}`, createdAt: NOW,
  };
}

test("package jobs are idempotent and one live job owns each scope", async () => {
  const f = await fixture();
  try {
    const first = f.store.packages.accept(request("one"));
    assert.equal(first.reused, false);
    assert.equal(f.store.packages.accept(request("one")).operationId, first.operationId);
    assert.throws(() => f.store.packages.accept(request("two")), (error) => error instanceof PiPackageStoreError && error.code === "PI_PACKAGE_BUSY");
    assert.equal(f.store.packages.listJobs(true).length, 1);
    f.store.packages.finishJob(first.operationId, 1, "failed", NOW, JSON.stringify({ code: "SOURCE_FAILED" }));
    assert.equal(f.store.packages.getJob(first.operationId)?.phase, "failed");
    assert.equal(f.store.packages.accept(request("two")).reused, false);
  } finally { await f.close(); }
});

test("Core publication appends a default in the same transaction as catalog and Operation success", async () => {
  const f = await fixture();
  try {
    f.store.updateDefaultWorkConfiguration({ agentsMd: "keep", packages: [] }, NOW);
    const accepted = f.store.packages.accept(request("one", "example-tools", { kind: "core" }, true));
    for (const phase of ["source", "prepare", "validate", "publish"] as const) f.store.packages.advanceJob(accepted.operationId, 1, phase, NOW);
    assert.equal(f.store.packages.getCatalog("example-tools"), undefined);
    const head = f.store.packages.publishCore(accepted.operationId, 1, artifact("example-tools", "artifact-1"), NOW, JSON.stringify({ name: "example-tools" }));
    assert.equal(head.headArtifactId, "artifact-1");
    assert.deepEqual(f.store.getDefaultWorkConfiguration()?.configuration, { agentsMd: "keep", packages: [{ name: "example-tools", enabled: true }] });
    assert.equal(f.store.get<{ state: string }>(`SELECT state FROM operations WHERE id = '${accepted.operationId}'`)?.state, "succeeded");
    assert.equal(f.store.packages.getJob(accepted.operationId)?.phase, "succeeded");
    assert.throws(() => f.store.packages.setCatalogEnabled("example-tools", false, NOW), (error) => error instanceof PiPackageStoreError && error.code === "PI_PACKAGE_IN_DEFAULTS");
    assert.throws(() => f.store.packages.removeCatalog("example-tools"), (error) => error instanceof PiPackageStoreError && error.code === "PI_PACKAGE_IN_DEFAULTS");
    f.store.updateDefaultWorkConfiguration({ packages: [] }, NOW);
    assert.equal(f.store.packages.setCatalogEnabled("example-tools", false, NOW).enabled, false);
    assert.equal(f.store.packages.removeCatalog("example-tools").name, "example-tools");
    assert.equal(f.store.packages.getArtifact("artifact-1")?.name, "example-tools");
    assert.throws(() => f.store.packages.publishCore(accepted.operationId, 1, artifact("example-tools", "artifact-2"), NOW, "{}"), (error) => error instanceof PiPackageStoreError && error.code === "PI_PACKAGE_STALE_JOB");
  } finally { await f.close(); }
});

test("independent default Work patches retain unrelated package, Skill and model fields", async () => {
  const f = await fixture();
  try {
    f.store.updateDefaultWorkConfiguration({ packages: [], skills: [{ name: "starter", enabled: true }],
      agentsMd: "keep", modelRef: "model-one" }, NOW);
    const first = f.store.getDefaultWorkConfiguration();
    f.store.updateDefaultWorkConfiguration({ packages: [{ name: "tool-one", enabled: true }] }, NOW);
    // A CLI may still hold `first`; field patches must merge against the current row.
    assert.ok(first);
    f.store.updateDefaultWorkConfiguration({ skills: [{ name: "next", enabled: true }] }, NOW);
    assert.deepEqual(f.store.getDefaultWorkConfiguration()?.configuration, {
      packages: [{ name: "tool-one", enabled: true }], skills: [{ name: "next", enabled: true }],
      agentsMd: "keep", modelRef: "model-one",
    });
  } finally { await f.close(); }
});

test("default limit rolls back artifact, catalog, job and Operation publication", async () => {
  const f = await fixture();
  try {
    f.store.updateDefaultWorkConfiguration({ packages: Array.from({ length: 64 }, (_, index) => ({ name: `package-${index}`, enabled: true })) }, NOW);
    const accepted = f.store.packages.accept(request("one", "example-tools", { kind: "core" }, true));
    f.store.packages.advanceJob(accepted.operationId, 1, "publish", NOW);
    assert.throws(() => f.store.packages.publishCore(accepted.operationId, 1, artifact("example-tools", "artifact-1"), NOW, "{}"), /limit exceeded/);
    assert.equal(f.store.packages.getArtifact("artifact-1"), undefined);
    assert.equal(f.store.packages.getCatalog("example-tools"), undefined);
    assert.equal(f.store.packages.getJob(accepted.operationId)?.phase, "publish");
    assert.equal(f.store.get<{ state: string }>(`SELECT state FROM operations WHERE id = '${accepted.operationId}'`)?.state, "running");
  } finally { await f.close(); }
});

test("upload leases stay live through expiry and reject another actor", async () => {
  const f = await fixture();
  try {
    f.store.packages.insertUpload({
      id: "upload-1", actorId: "admin-1", scopeKind: "core", workId: null, sourceKind: "zip",
      displayName: "tools.zip", digest: `sha256:${"b".repeat(64)}`, size: 10, state: "ready",
      expiresAt: "2026-09-25T00:10:00.000Z", leaseCount: 0, createdAt: NOW,
    });
    assert.throws(() => f.store.packages.accept({ ...request("bad"), actorId: "other", sourceUploadId: "upload-1" }), (error) => error instanceof PiPackageStoreError && error.code === "PI_PACKAGE_NOT_FOUND");
    assert.equal(f.store.packages.listJobs().length, 0);
    const accepted = f.store.packages.accept({ ...request("one"), sourceUploadId: "upload-1" });
    assert.equal(f.store.packages.getUpload("upload-1")?.leaseCount, 1);
    assert.deepEqual(f.store.packages.expireUploads("2026-09-25T01:00:00.000Z"), []);
    f.store.packages.finishJob(accepted.operationId, 1, "failed", NOW, "{}");
    assert.equal(f.store.packages.getUpload("upload-1")?.leaseCount, 0, "terminal failure releases its upload in the same transaction");
    assert.deepEqual(f.store.packages.expireUploads("2026-09-25T01:00:00.000Z"), ["upload-1"]);
  } finally { await f.close(); }
});

test("successful publication releases its upload lease atomically", async () => {
  const f = await fixture();
  try {
    f.store.packages.insertUpload({ id: "upload-2", actorId: "admin-1", scopeKind: "core", workId: null,
      sourceKind: "local", displayName: "tools", digest: `sha256:${"c".repeat(64)}`, size: 10,
      state: "ready", expiresAt: "2026-09-25T00:10:00.000Z", leaseCount: 0, createdAt: NOW });
    const accepted = f.store.packages.accept({ ...request("published"), sourceUploadId: "upload-2" });
    f.store.packages.advanceJob(accepted.operationId, 1, "publish", NOW);
    f.store.packages.publishCore(accepted.operationId, 1, artifact("example-tools", "artifact-2"), NOW, "{}");
    assert.equal(f.store.packages.getUpload("upload-2")?.leaseCount, 0);
    assert.deepEqual(f.store.packages.expireUploads("2026-09-25T01:00:00.000Z"), ["upload-2"]);
  } finally { await f.close(); }
});

test("cleanup-pending keeps a source upload leased until helper teardown is confirmed", async () => {
  const f = await fixture();
  try {
    f.store.packages.insertUpload({ id: "upload-pending", actorId: "admin-1", scopeKind: "core", workId: null,
      sourceKind: "zip", displayName: "tools.zip", digest: `sha256:${"d".repeat(64)}`, size: 10,
      state: "ready", expiresAt: "2026-09-25T00:10:00.000Z", leaseCount: 0, createdAt: NOW });
    const accepted = f.store.packages.accept({ ...request("cleanup"), sourceUploadId: "upload-pending" });
    f.store.packages.finishJob(accepted.operationId, 1, "cleanup-pending", NOW, "{}");
    assert.equal(f.store.packages.getUpload("upload-pending")?.leaseCount, 1);
    assert.deepEqual(f.store.packages.expireUploads("2026-09-25T01:00:00.000Z"), []);
    f.store.packages.finishJob(accepted.operationId, 1, "failed", NOW, "{}");
    assert.equal(f.store.packages.getUpload("upload-pending")?.leaseCount, 0);
  } finally { await f.close(); }
});

test("catalog head capture and Work copies hold Core artifact leases independently of later removal", async () => {
  const f = await fixture();
  try {
    f.store.exec(`INSERT INTO users VALUES ('admin-1', 'admin', 'digest', 'admin', 1, '${NOW}', '${NOW}');
      INSERT INTO works(id, owner_user_id, name, desired_state, observed_state, desired_revision, control_version, created_at, updated_at)
      VALUES ('work-1', 'admin-1', 'one', 'stopped', 'stopped', 1, 1, '${NOW}', '${NOW}')`);
    const metadata = JSON.stringify({ preparedEnvironment: JSON.parse(request("env").preparedEnvironmentJson) });
    f.store.exec(`INSERT INTO pi_package_artifacts(id,scope_kind,work_id,name,content_digest,metadata_json,storage_path,created_at)
      VALUES ('artifact-one','core',NULL,'tools','sha256:${"a".repeat(64)}','${metadata}','/artifacts/one','${NOW}');
      INSERT INTO pi_package_catalog(name,enabled,head_artifact_id,generation,created_at,updated_at)
      VALUES ('tools',1,'artifact-one',1,'${NOW}','${NOW}')`);
    const captured = f.store.packages.leaseCatalogHeads(["tools"]);
    assert.equal(captured[0]?.id, "artifact-one");
    assert.equal(f.store.get<{ lease_count: number }>("SELECT lease_count FROM pi_package_artifacts WHERE id = 'artifact-one'")?.lease_count, 1);
    f.store.packages.removeCatalog("tools");
    assert.equal(f.store.packages.getArtifact("artifact-one")?.id, "artifact-one");
    f.store.packages.releaseArtifactLeases(captured.map(({ id }) => id));
    assert.equal(f.store.get<{ lease_count: number }>("SELECT lease_count FROM pi_package_artifacts WHERE id = 'artifact-one'")?.lease_count, 0);

    assert.throws(() => f.store.packages.accept({ ...request("removed-copy", "tools", { kind: "work", workId: "work-1" }),
      sourceJson: JSON.stringify({ kind: "core", name: "tools", artifactId: "artifact-one" }) }),
    (error) => error instanceof PiPackageStoreError && error.code === "PI_PACKAGE_NOT_FOUND");
    f.store.exec(`INSERT INTO pi_package_catalog(name,enabled,head_artifact_id,generation,created_at,updated_at)
      VALUES ('tools',1,'artifact-one',2,'${NOW}','${NOW}')`);

    const copied = f.store.packages.accept({ ...request("work-copy", "tools", { kind: "work", workId: "work-1" }),
      sourceJson: JSON.stringify({ kind: "core", name: "tools" }) });
    assert.deepEqual(JSON.parse(f.store.packages.getJob(copied.operationId)!.sourceJson),
      { kind: "core", name: "tools", artifactId: "artifact-one" });
    assert.equal(f.store.get<{ lease_count: number }>("SELECT lease_count FROM pi_package_artifacts WHERE id = 'artifact-one'")?.lease_count, 1);
    f.store.packages.advanceJob(copied.operationId, 1, "source", NOW);
    f.store.exec(`UPDATE pi_package_jobs SET phase = 'superseded' WHERE operation_id = '${copied.operationId}'`);
    f.store.packages.releaseTerminalJobLeases(copied.operationId);
    f.store.packages.releaseTerminalJobLeases(copied.operationId);
    assert.equal(f.store.get<{ lease_count: number }>("SELECT lease_count FROM pi_package_artifacts WHERE id = 'artifact-one'")?.lease_count, 0);
    f.store.exec(`INSERT INTO pi_package_artifacts(id,scope_kind,work_id,name,content_digest,metadata_json,storage_path,created_at)
      VALUES ('artifact-two','core',NULL,'tools','sha256:${"b".repeat(64)}','${metadata}','/artifacts/two','${NOW}');
      UPDATE pi_package_catalog SET head_artifact_id = 'artifact-two', generation = 3 WHERE name = 'tools'`);
    const queued = f.store.packages.accept({ ...request("queued-copy", "tools", { kind: "work", workId: "work-1" }),
      sourceJson: JSON.stringify({ kind: "core", name: "tools", artifactId: "artifact-one" }) });
    assert.deepEqual(JSON.parse(f.store.packages.getJob(queued.operationId)!.sourceJson),
      { kind: "core", name: "tools", artifactId: "artifact-two" });
    assert.equal(f.store.get<{ lease_count: number }>("SELECT lease_count FROM pi_package_artifacts WHERE id = 'artifact-one'")?.lease_count, 0);
    assert.equal(f.store.get<{ lease_count: number }>("SELECT lease_count FROM pi_package_artifacts WHERE id = 'artifact-two'")?.lease_count, 1);
    f.store.packages.releaseQueuedWorkJobLeases("work-1");
    f.store.packages.finishJob(queued.operationId, 1, "superseded", NOW, "{}");
    assert.equal(f.store.get<{ lease_count: number }>("SELECT lease_count FROM pi_package_artifacts WHERE id = 'artifact-two'")?.lease_count, 0);
    f.store.exec("UPDATE pi_package_catalog SET enabled = 0 WHERE name = 'tools'");
    assert.throws(() => f.store.packages.accept({ ...request("disabled-copy", "tools", { kind: "work", workId: "work-1" }),
      sourceJson: JSON.stringify({ kind: "core", name: "tools" }) }),
    (error) => error instanceof PiPackageStoreError && error.code === "PI_PACKAGE_NOT_FOUND");
    f.store.exec(`UPDATE pi_package_catalog SET enabled = 1 WHERE name = 'tools';
      UPDATE pi_package_artifacts SET metadata_json = '${JSON.stringify({ preparedEnvironment: { ...JSON.parse(request("env").preparedEnvironmentJson), nodeAbi: "other" } })}' WHERE id = 'artifact-two'`);
    assert.throws(() => f.store.packages.accept({ ...request("incompatible-copy", "tools", { kind: "work", workId: "work-1" }),
      sourceJson: JSON.stringify({ kind: "core", name: "tools" }) }),
    (error) => (error as { code?: string }).code === "PI_PACKAGE_ENVIRONMENT_MISMATCH");
    assert.equal(f.store.get<{ lease_count: number }>("SELECT lease_count FROM pi_package_artifacts WHERE id = 'artifact-two'")?.lease_count, 0);
  } finally { await f.close(); }
});
