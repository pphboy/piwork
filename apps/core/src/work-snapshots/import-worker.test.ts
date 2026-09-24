import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore } from "@piwork/core-store";
import { managedVolumeName, type SnapshotHelperSpec } from "@piwork/runtime-docker";
import { encodeWorkPackage } from "@piwork/work-package";
import { goldenWorkFixture } from "../../../../packages/work-package/dist/fixture.js";
import { registerRuntimeProfileCatalog } from "../configuration/runtime-catalog.js";
import { RuntimeProfileStore } from "../configuration/runtime-profile.js";
import { WorkContextStore } from "../configuration/work-context.js";
import { WorkSnapshotAdmission } from "./admission.js";
import { executeImportSnapshot } from "./import-worker.js";

const NOW = "2026-09-23T00:00:00.000Z", OWNER = "owner-000000000001", INSTALLATION = "install-000000000001";
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "piwork-import-worker-")), snapshotsDirectory = join(root, "snapshots");
  mkdirSync(join(root, "secrets")); mkdirSync(join(snapshotsDirectory, "packages"), { recursive: true });
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") }), contexts = new WorkContextStore(join(root, "contexts"));
  store.createManagedUser({ id: OWNER, account: "owner", passwordDigest: "password", role: "user", enabled: true, createdAt: NOW, updatedAt: NOW });
  const profiles = new RuntimeProfileStore(join(root, "runtime.json"), join(root, "secrets"), () => new Date(NOW));
  profiles.configure({ agentImage: "recipient:default", provider: "deterministic", model: "test", credential: "RECIPIENT_CREDENTIAL" });
  registerRuntimeProfileCatalog(store, profiles.load());
  const golden = goldenWorkFixture(); const chunks: Buffer[] = [];
  for await (const chunk of encodeWorkPackage(golden.spec, async function* (blob) { yield golden.data.get(blob.digest)!; })) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks), digest = createHash("sha256").update(bytes).digest("hex"), packageId = "package-000000000001";
  writeFileSync(join(snapshotsDirectory, "packages", `${packageId}.work`), bytes);
  store.snapshots.insertPackage({ id: packageId, ownerUserId: OWNER, digest, size: bytes.length, state: "ready", jobId: null, createdAt: NOW,
    readyAt: NOW, expiresAt: "2026-09-24T00:00:00.000Z" });
  const admission = new WorkSnapshotAdmission(store, profiles, () => new Date(NOW));
  const accepted = admission.import({ userId: OWNER, role: "user" }, { packageId, name: "copied", idempotencyKey: "import-key" },
  { spec: golden.spec, digest, size: bytes.length, restoredBytes: 0, entryCount: 0, metadata: golden.metadata });
  const helpers = new Map<string, SnapshotHelperSpec>(), volumes = new Set<string>(); let failRestore = false, failVolumeCreate = false;
  let hostArchitecture = golden.spec.compatibility.architecture;
  const runtime = {
    async inspectHostPlatform() { return { os: "linux" as const, architecture: hostArchitecture, variant: null }; },
    async loadVerifiedImage(image: { image: { imageId: string } }) { return { imageId: image.image.imageId, reused: true }; },
    async ensureManagedVolume(workId: string, logicalId: string) {
      const volumeName = managedVolumeName(INSTALLATION, workId, logicalId); volumes.add(volumeName);
      if (failVolumeCreate) throw new Error("FAKE_VOLUME_CREATE_INTERRUPTED");
      return { volumeName, created: true };
    },
    async deleteManagedVolume(workId: string, logicalId: string) { volumes.delete(managedVolumeName(INSTALLATION, workId, logicalId)); },
    async createSnapshotHelper(spec: SnapshotHelperSpec) { helpers.set(spec.name, spec); return spec.name; },
    async startSnapshotHelper(name: string) {
      const spec = helpers.get(name)!;
      if (failRestore && spec.action === "restore") throw new Error("FAKE_RESTORE_FAILURE");
      return spec.action === "restore-history" ? { historyPresent: false } : { tree: spec.treeDigest };
    },
    async removeSnapshotHelper(name: string) { helpers.delete(name); },
  };
  return { root, snapshotsDirectory, store, contexts, profiles, accepted, runtime, helpers, volumes,
    fail() { failRestore = true; }, failVolume() { failVolumeCreate = true; },
    setHostArchitecture(value: string) { hostArchitecture = value; },
    close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("verified package stages two new volumes and publishes one stopped Work without starting runtime", async () => {
  const f = await fixture();
  try {
    const workId = await executeImportSnapshot({ store: f.store, contexts: f.contexts, profiles: f.profiles, runtime: f.runtime,
      installationId: INSTALLATION, helperImageId: `sha256:${"f".repeat(64)}`, snapshotsDirectory: f.snapshotsDirectory,
      operationId: f.accepted.operationId, epoch: 1, now: () => new Date(NOW) });
    assert.equal(workId, f.accepted.workId);
    assert.equal(f.store.getWork(workId)?.observedState, "stopped");
    assert.equal(f.store.getWorkConfiguration(workId)?.activeContextId, null);
    assert.equal(f.store.snapshots.getJob(f.accepted.operationId)?.phase, "succeeded");
    assert.equal(f.store.getQuotaReservation(workId, "import", "import"), undefined);
    assert.equal(f.store.getQuotaReservation(workId, "agent", "agentd")?.occupiedCpuMillis, 0);
    assert.equal(f.store.listVolumeRecords(workId).length, 2);
    assert.equal(f.volumes.size, 2); assert.equal(f.helpers.size, 0);
    assert.equal(f.store.snapshots.listHistory(workId).length, 1);
  } finally { f.close(); }
});

test("another Docker architecture is rejected before image load or Work publication", async () => {
  const f = await fixture();
  try {
    f.setHostArchitecture("arm64");
    await assert.rejects(executeImportSnapshot({ store: f.store, contexts: f.contexts, profiles: f.profiles, runtime: f.runtime,
      installationId: INSTALLATION, helperImageId: `sha256:${"f".repeat(64)}`, snapshotsDirectory: f.snapshotsDirectory,
      operationId: f.accepted.operationId, epoch: 1, now: () => new Date(NOW) }), /PACKAGE_INCOMPATIBLE/);
    assert.equal(f.store.getWork(f.accepted.workId), undefined);
    assert.equal(f.volumes.size, 0);
    assert.equal(JSON.parse(f.store.getOperation(f.accepted.operationId)!.errorJson!).code, "PACKAGE_INCOMPATIBLE");
  } finally { f.close(); }
});

test("volume creation interrupted before journal advance still removes the task volume", async () => {
  const f = await fixture();
  try {
    f.failVolume();
    await assert.rejects(executeImportSnapshot({ store: f.store, contexts: f.contexts, profiles: f.profiles, runtime: f.runtime,
      installationId: INSTALLATION, helperImageId: `sha256:${"f".repeat(64)}`, snapshotsDirectory: f.snapshotsDirectory,
      operationId: f.accepted.operationId, epoch: 1, now: () => new Date(NOW) }), /FAKE_VOLUME_CREATE_INTERRUPTED/);
    assert.equal(f.store.getWork(f.accepted.workId), undefined);
    assert.equal(f.store.snapshots.getJob(f.accepted.operationId)?.phase, "cleaned");
    assert.equal(f.volumes.size, 0);
  } finally { f.close(); }
});

test("restore failure never exposes Work and releases only its staged volumes", async () => {
  const f = await fixture();
  try {
    f.fail();
    await assert.rejects(executeImportSnapshot({ store: f.store, contexts: f.contexts, profiles: f.profiles, runtime: f.runtime,
      installationId: INSTALLATION, helperImageId: `sha256:${"f".repeat(64)}`, snapshotsDirectory: f.snapshotsDirectory,
      operationId: f.accepted.operationId, epoch: 1, now: () => new Date(NOW) }), /FAKE_RESTORE_FAILURE/);
    assert.equal(f.store.getWork(f.accepted.workId), undefined);
    assert.equal(f.store.snapshots.getJob(f.accepted.operationId)?.phase, "cleaned");
    assert.equal(f.store.getQuotaReservation(f.accepted.workId, "import", "import"), undefined);
    assert.equal(f.volumes.size, 0); assert.equal(f.helpers.size, 0);
  } finally { f.close(); }
});
