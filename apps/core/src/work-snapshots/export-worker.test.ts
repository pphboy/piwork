import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { CoreStore } from "@piwork/core-store";
import { managedVolumeName, type SnapshotHelperSpec } from "@piwork/runtime-docker";
import { encodeWorkPackage, WorkBlobDirectory } from "@piwork/work-package";
import { goldenWorkFixture } from "../../../../packages/work-package/dist/fixture.js";
import { WorkContextStore } from "../configuration/work-context.js";
import { RuntimeProfileStore } from "../configuration/runtime-profile.js";
import { WorkSnapshotAdmission } from "./admission.js";
import { executeExportSnapshot } from "./export-worker.js";
import { recoverSnapshotJobs } from "./recovery.js";
import { restorePortableConfiguration } from "./metadata.js";

const NOW = "2026-09-23T00:00:00.000Z", OWNER = "owner-000000000001", WORK = "work-source-00000001", INSTALLATION = "install-000000000001";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "piwork-export-worker-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") }), contexts = new WorkContextStore(join(root, "contexts"));
  store.createManagedUser({ id: OWNER, account: "owner", passwordDigest: "password", role: "user", enabled: true, createdAt: NOW, updatedAt: NOW });
  const golden = goldenWorkFixture(), spec = golden.spec;
  const agents = golden.data.get(spec.contexts[0]!.agentsBlob)!.toString();
  const config = restorePortableConfiguration(spec.contexts[0]!.configuration, agents, "runtime-model-00000001", "runtime-image-00000001", new Map(), new Map());
  const snapshot = contexts.build({ workId: WORK, snapshotId: "context-source-000001", configuration: config,
    imageIdentity: spec.images[0]!.imageId, skills: [], createdAt: NOW });
  store.exec(`INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at)
    VALUES ('${WORK}','${OWNER}','source','stopped','stopped',1,1,'${NOW}','${NOW}')`);
  store.exec(`INSERT INTO work_config_revisions(work_id,revision,config_json,resolved_image_digest,created_by_user_id,created_at,runtime_profile_json,source_runtime_revision)
    VALUES ('${WORK}',1,'${JSON.stringify(config).replaceAll("'", "''")}', '${spec.images[0]!.imageId}','${OWNER}','${NOW}',
    '{"version":1,"revision":1,"agentImage":"source:fixed","model":{"provider":"deterministic","id":"test","credentialRef":"platform-only"},"updatedAt":"${NOW}"}',1)`);
  store.insertInitialWorkContext(WORK, 1, { snapshotId: snapshot.snapshotId, configurationJson: JSON.stringify(config), imageIdentity: snapshot.metadata.imageIdentity,
    createdByUserId: OWNER, createdAt: NOW });
  store.exec(`INSERT INTO quota_reservations VALUES ('${WORK}','agent','agentd',500,134217728,99,4096,0,2,'${NOW}')`);
  for (const [role, logicalId, id] of [["agent-private", "work-private", "volume-private"], ["workspace", "work-workspace", "volume-workspace"]] as const) {
    store.exec(`INSERT INTO volume_records VALUES ('${id}','${INSTALLATION}','${WORK}',NULL,'${role}','${managedVolumeName(INSTALLATION, WORK, logicalId)}','active',1,NULL,NULL,'${NOW}')`);
    store.exec(`INSERT INTO volume_references VALUES ('${id}','work','${WORK}','${NOW}')`);
  }
  const helpers = new Map<string, SnapshotHelperSpec>(); let failed = false, cleanupFailed = false;
  const runtime = {
    async listManagedContainers() { return []; },
    async requireManagedVolume(_workId: string, logicalId: string) { return { volumeName: managedVolumeName(INSTALLATION, WORK, logicalId), created: false }; },
    async inspectCapturedImage() { return { imageId: spec.images[0]!.imageId, platform: spec.images[0]!.platform }; },
    async createSnapshotHelper(helper: SnapshotHelperSpec) { helpers.set(helper.name, helper); return helper.name; },
    async startSnapshotHelper(name: string) {
      if (failed) throw new Error("FAKE_CAPTURE_FAILURE");
      const helper = helpers.get(name)!;
      if (helper.action === "verify-history") return { historyPresent: false, sessions: 0, runs: 0, events: 0 };
      for (const [digest, bytes] of golden.data) writeFileSync(join(helper.spoolDirectory, digest), bytes, { mode: 0o600 });
      return { tree: spec.volumes[0].tree, size: golden.data.get(spec.volumes[0].tree)!.length };
    },
    async removeSnapshotHelper(name: string) { if (cleanupFailed) throw new Error("FAKE_HELPER_STILL_RUNNING"); helpers.delete(name); },
    async saveCapturedImage(_id: string, blobs: WorkBlobDirectory) {
      const image = spec.images[0]!, bytes = golden.data.get(image.config)!;
      const stored = await blobs.put(Readable.from([bytes]), bytes.length);
      return { image: { imageId: image.imageId, platform: image.platform, config: image.config, layers: [] }, blobs: [stored] };
    },
  };
  const profiles = new RuntimeProfileStore(join(root, "runtime.json"), join(root, "secrets"), () => new Date(NOW));
  const admission = new WorkSnapshotAdmission(store, profiles, () => new Date(NOW));
  return { root, store, contexts, runtime, helpers, admission, fail() { failed = true; }, failCleanup() { cleanupFailed = true; },
    close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("fenced export seals one ready package, succeeds Operation and releases Work gate", async () => {
  const f = fixture();
  try {
    const accepted = await f.admission.export({ userId: OWNER, role: "user" }, WORK, { idempotencyKey: "export-key" }, async () => {});
    const result = await executeExportSnapshot({ store: f.store, contexts: f.contexts, runtime: f.runtime,
      installationId: INSTALLATION, helperImageId: `sha256:${"f".repeat(64)}`, snapshotsDirectory: join(f.root, "snapshots"), operationId: accepted.operationId, epoch: 1,
      now: () => new Date(NOW) });
    assert.equal(result.snapshotId, accepted.snapshotId);
    assert.equal(f.store.snapshots.getPackage(result.packageId)?.state, "ready");
    assert.equal(f.store.getOperation(accepted.operationId)?.state, "succeeded");
    assert.equal(f.store.snapshots.getLock(WORK), undefined);
    assert.ok(existsSync(join(f.root, "snapshots", "packages", `${result.packageId}.work`)));
    assert.equal(f.helpers.size, 0);
    assert.equal(f.store.getWork(WORK)?.observedState, "stopped");
  } finally { f.close(); }
});

test("unconfirmed export helper exit keeps the Work gate and cleanup-pending state", async () => {
  const f = fixture();
  try {
    const accepted = await f.admission.export({ userId: OWNER, role: "user" }, WORK, { idempotencyKey: "export-key" }, async () => {});
    f.fail(); f.failCleanup();
    await assert.rejects(executeExportSnapshot({ store: f.store, contexts: f.contexts, runtime: f.runtime,
      installationId: INSTALLATION, helperImageId: `sha256:${"f".repeat(64)}`, snapshotsDirectory: join(f.root, "snapshots"), operationId: accepted.operationId, epoch: 1,
      now: () => new Date(NOW) }), /FAKE_HELPER_STILL_RUNNING/);
    assert.equal(f.store.snapshots.getJob(accepted.operationId)?.phase, "cleanup-pending");
    assert.ok(f.store.snapshots.getLock(WORK));
    assert.throws(() => f.store.snapshots.assertWorkMutable(WORK), /WORK_SNAPSHOT_BUSY/);
    assert.equal(f.helpers.size, 1);
  } finally { f.close(); }
});

test("capture failure cleans only journalled helpers and keeps source stopped", async () => {
  const f = fixture();
  try {
    const accepted = await f.admission.export({ userId: OWNER, role: "user" }, WORK, { idempotencyKey: "export-key" }, async () => {});
    f.fail();
    await assert.rejects(executeExportSnapshot({ store: f.store, contexts: f.contexts, runtime: f.runtime,
      installationId: INSTALLATION, helperImageId: `sha256:${"f".repeat(64)}`, snapshotsDirectory: join(f.root, "snapshots"), operationId: accepted.operationId, epoch: 1,
      now: () => new Date(NOW) }), /FAKE_CAPTURE_FAILURE/);
    assert.equal(f.store.snapshots.getLock(WORK), undefined);
    assert.equal(f.store.getOperation(accepted.operationId)?.state, "failed");
    assert.equal(f.store.snapshots.getJob(accepted.operationId)?.phase, "cleaned");
    assert.equal(f.helpers.size, 0);
    assert.equal(f.store.getWork(WORK)?.observedState, "stopped");
  } finally { f.close(); }
});

test("startup adopts a fully sealed export left before the database success commit", async () => {
  const f = fixture();
  try {
    const accepted = await f.admission.export({ userId: OWNER, role: "user" }, WORK, { idempotencyKey: "export-key" }, async () => {});
    const job = f.store.snapshots.getJob(accepted.operationId)!, golden = goldenWorkFixture(), chunks: Buffer[] = [];
    for await (const chunk of encodeWorkPackage(golden.spec, async function* (blob) { yield golden.data.get(blob.digest)!; })) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks), digest = createHash("sha256").update(bytes).digest("hex");
    const packages = join(f.root, "snapshots", "packages"); mkdirSync(packages, { recursive: true });
    writeFileSync(join(packages, `${job.packageId}.work`), bytes, { mode: 0o600 });
    f.store.snapshots.updateJobPhase(accepted.operationId, 1, "sealing", NOW);
    f.store.snapshots.insertArtifact({ operationId: accepted.operationId, artifactKey: "sealed-package", kind: "sealed-package",
      logicalId: JSON.stringify({ digest, size: bytes.length, readyAt: NOW, expiresAt: "2026-09-24T00:00:00.000Z" }), state: "ready" }, 1);
    const result = await recoverSnapshotJobs({ store: f.store, contexts: f.contexts, snapshotsDirectory: join(f.root, "snapshots"),
      runtime: { async removeSnapshotHelper() {}, async deleteManagedVolume() {} } });
    assert.deepEqual(result, { cleaned: 1, pending: 0 });
    assert.equal(f.store.getOperation(accepted.operationId)?.state, "succeeded");
    assert.equal(f.store.snapshots.getPackage(job.packageId!)?.state, "ready");
    assert.equal(f.store.snapshots.getLock(WORK), undefined);
    assert.ok(existsSync(join(packages, `${job.packageId}.work`)));
  } finally { f.close(); }
});

test("expired export deadline cannot seal a package and releases the source gate", async () => {
  const f = fixture();
  try {
    const accepted = await f.admission.export({ userId: OWNER, role: "user" }, WORK, { idempotencyKey: "export-key" }, async () => {});
    await assert.rejects(executeExportSnapshot({ store: f.store, contexts: f.contexts, runtime: f.runtime,
      installationId: INSTALLATION, helperImageId: `sha256:${"f".repeat(64)}`, snapshotsDirectory: join(f.root, "snapshots"),
      operationId: accepted.operationId, epoch: 1, now: () => new Date("2026-09-23T00:31:00.000Z") }));
    assert.equal(f.store.getOperation(accepted.operationId)?.state, "failed");
    assert.equal(f.store.snapshots.getLock(WORK), undefined);
    assert.equal(f.store.snapshots.getPackage(f.store.snapshots.getJob(accepted.operationId)!.packageId!)?.state, "expired");
  } finally { f.close(); }
});
