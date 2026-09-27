import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore, IdempotencyConflictError } from "@piwork/core-store";
import { normalizeServiceDefinitionInput, validatePortableWorkSpec, type PortableWorkSpec } from "@piwork/contracts";
import type { VerifiedWorkPackage } from "@piwork/work-package";
import { RuntimeProfileStore } from "../configuration/runtime-profile.js";
import { registerRuntimeProfileCatalog } from "../configuration/runtime-catalog.js";
import { WorkLifecycleService, type WorkRuntimeAdapter } from "../work-management/lifecycle.js";
import { WorkSnapshotAdmission } from "./admission.js";
import { restorePortableConfiguration } from "./metadata.js";

const NOW = "2026-09-23T00:00:00.000Z", LATER = "2026-09-24T00:00:00.000Z", OWNER = "owner-000000000001", SOURCE = "work-source-00000001";
const principal = { userId: OWNER, role: "user" as const };
const hash = (letter: string) => letter.repeat(64);
function packageSpec(serviceBudget = 250): PortableWorkSpec {
  const definition = normalizeServiceDefinitionInput({ name: "worker", image: { reference: "worker:fixed" }, command: "node", workingDirectory: "/", enabled: false });
  const shared = hash("a");
  return validatePortableWorkSpec({ formatVersion: 1, snapshotKind: "cold-full", createdAt: NOW, sourceName: "source",
    compatibility: { os: "linux", architecture: "amd64", variant: null, agentProtocol: "v2", workHistorySchema: 3, storageLayout: 2, piPackageContract: 1 },
    activeContext: null, desiredContext: "c-000001", contexts: [{ key: "c-000001", createdAt: NOW, imageKey: "i-000001", skillsTree: shared, agentsBlob: shared, packageBindings: [],
      configuration: { modelBindingKey: "m-000001", skills: [], packages: [], mcpServers: [], tools: { allowed: [], denied: [] },
        resources: { cpuMillis: 1000, memoryBytes: 1073741824, agentCpuMillis: 500, agentMemoryBytes: 536870912, maxServices: 2, maxRetainedVolumes: 2 } } }],
    piPackageArtifacts: [], services: [{ key: "s-000001", name: "worker", desiredRevision: 1, appliedRevision: null, enabled: false, tombstonedAt: null,
      revisions: [{ revision: 1, createdAt: NOW, definition, imageKey: null }],
      recovery: { count: 0, windowStartedAt: null, nextRetryAt: null, readySince: null }, sourceObservation: { state: "disabled", lastError: null } }],
    quotaReservations: [{ subjectKind: "agent", subjectKey: "agentd", desiredCpuMillis: 500, desiredMemoryBytes: 536870912, serviceSlots: 0, volumeSlots: 2 },
      { subjectKind: "service", subjectKey: "s-000001", desiredCpuMillis: serviceBudget, desiredMemoryBytes: 134217728, serviceSlots: 1, volumeSlots: 0 }],
    volumes: [{ role: "agent-private", tree: shared, serviceRefKeys: [] }, { role: "workspace", tree: shared, serviceRefKeys: ["s-000001"] }],
    images: [{ key: "i-000001", imageId: `sha256:${shared}`, platform: { os: "linux", architecture: "amd64", variant: null }, config: shared, layers: [] }],
    bindings: { models: [{ key: "m-000001", provider: "deterministic", model: "fixture", baseUrl: null }], secrets: [] },
    history: { control: shared, sourceIdentityMap: shared },
    blobs: [{ digest: shared, size: 0, kinds: ["file", "tree", "control-history", "identity-map", "image-config"] }],
  });
}
function fixture(quota = { hostCpuMillis: 2000, hostMemoryBytes: 2 * 1024 ** 3, hostRetainedVolumeSlots: 10 }) {
  const root = mkdtempSync(join(tmpdir(), "piwork-admission-")), secrets = join(root, "secrets"); mkdirSync(secrets);
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  store.createManagedUser({ id: OWNER, account: "owner", passwordDigest: "password", role: "user", enabled: true, createdAt: NOW, updatedAt: NOW });
  const profiles = new RuntimeProfileStore(join(root, "runtime.json"), secrets, () => new Date(NOW));
  profiles.configure({ agentImage: "recipient:default", provider: "deterministic", model: "fixture", credential: "RECIPIENT_PLATFORM_SECRET" });
  registerRuntimeProfileCatalog(store, profiles.load());
  const spec = packageSpec();
  const verified: VerifiedWorkPackage = { spec, digest: hash("9"), size: 100, restoredBytes: 0, entryCount: 0,
    metadata: new Map([[spec.history.sourceIdentityMap, { version: 1, sourceWorkId: SOURCE,
      contexts: [{ sourceId: "context-source-000001", key: "c-000001" }], services: [{ sourceId: "service-source-000001", key: "s-000001" }], operations: [] }]]) };
  const addPackage = (id: string, digest = verified.digest, state: "ready" | "expired" = "ready") => store.snapshots.insertPackage({ id,
    ownerUserId: OWNER, digest, size: 100, state, jobId: null, createdAt: NOW, readyAt: NOW, expiresAt: LATER });
  addPackage("package-000000000001");
  const admission = new WorkSnapshotAdmission(store, profiles, () => new Date(NOW), quota);
  const request = { packageId: "package-000000000001", name: "copied", idempotencyKey: "import-key" };
  return { root, store, profiles, spec, verified, admission, request, addPackage,
    close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("import acceptance atomically reserves full disabled-service budget, name and one unpublished job", () => {
  const f = fixture();
  try {
    const accepted = f.admission.import(principal, f.request, f.verified);
    assert.equal(accepted.reused, false);
    assert.equal(f.store.getWork(accepted.workId), undefined);
    assert.equal(f.store.snapshots.getJob(accepted.operationId)?.targetWorkId, accepted.workId);
    assert.equal(f.store.snapshots.getName(OWNER, "copied")?.operationId, accepted.operationId);
    assert.deepEqual(f.store.getQuotaReservation(accepted.workId, "import", "import"), {
      workId: accepted.workId, subjectKind: "import", subjectId: "import", desiredCpuMillis: 750, desiredMemoryBytes: 671088640,
      occupiedCpuMillis: 0, occupiedMemoryBytes: 0, serviceSlots: 0, volumeSlots: 2, updatedAt: NOW,
    });
    assert.equal(f.store.getOperation(accepted.operationId)?.workId, null);
    assert.equal(f.store.getOperation(accepted.operationId)?.requestJson.includes("runtime-model-00000001"), false);
  } finally { f.close(); }
});

test("same digest/explicit-name/key replays across package IDs and expiry without new capacity", () => {
  const f = fixture();
  try {
    const first = f.admission.import(principal, f.request, f.verified);
    f.addPackage("package-000000000002");
    f.store.exec("UPDATE snapshot_packages SET state = 'expired' WHERE id = 'package-000000000002'");
    const replay = f.admission.import(principal, { ...f.request, packageId: "package-000000000002" });
    assert.deepEqual(replay, { ...first, reused: true });
    assert.throws(() => f.admission.import(principal, { ...f.request, packageId: "package-000000000002", idempotencyKey: "fresh-key" }), { code: "PACKAGE_EXPIRED" });
    assert.equal(f.store.snapshots.listJobs().length, 1);
    f.addPackage("package-000000000003", hash("8"));
    assert.throws(() => f.admission.import(principal, { ...f.request, packageId: "package-000000000003" }), IdempotencyConflictError);
    assert.throws(() => f.admission.import(principal, { ...f.request, name: "different" }), IdempotencyConflictError);
  } finally { f.close(); }
});

test("recipient capacity counts disabled budget, existing occupied resources and two new volumes before accepting", () => {
  for (const quota of [
    { hostCpuMillis: 700, hostMemoryBytes: 2 * 1024 ** 3, hostRetainedVolumeSlots: 10 },
    { hostCpuMillis: 2000, hostMemoryBytes: 600000000, hostRetainedVolumeSlots: 10 },
    { hostCpuMillis: 2000, hostMemoryBytes: 2 * 1024 ** 3, hostRetainedVolumeSlots: 1 },
  ]) {
    const f = fixture(quota);
    try {
      assert.throws(() => f.admission.import(principal, f.request, f.verified), { code: "QUOTA_EXCEEDED" });
      assert.equal(f.store.snapshots.listJobs().length, 0); assert.equal(f.store.snapshots.getName(OWNER, "copied"), undefined);
    } finally { f.close(); }
  }
  const f = fixture({ hostCpuMillis: 1000, hostMemoryBytes: 2 * 1024 ** 3, hostRetainedVolumeSlots: 10 });
  try {
    f.store.exec(`INSERT INTO quota_reservations VALUES ('work-other', 'agent', 'agentd', 0, 0, 600, 0, 0, 0, '${NOW}')`);
    assert.throws(() => f.admission.import(principal, f.request, f.verified), { code: "QUOTA_EXCEEDED" });
  } finally { f.close(); }
});

test("tombstoned service still contributes its retained desired budget", () => {
  const f = fixture({ hostCpuMillis: 700, hostMemoryBytes: 2 * 1024 ** 3, hostRetainedVolumeSlots: 10 });
  try {
    f.spec.services[0]!.tombstonedAt = NOW;
    assert.throws(() => f.admission.import(principal, f.request, f.verified), { code: "QUOTA_EXCEEDED" });
    assert.equal(f.store.snapshots.listJobs().length, 0);
  } finally { f.close(); }
});

test("name hold blocks another import and ordinary create checks; new digest cannot reuse an old key", () => {
  const f = fixture();
  try {
    const first = f.admission.import(principal, f.request, f.verified);
    f.store.snapshots.updateJobPhase(first.operationId, 1, "succeeded", NOW);
    f.addPackage("package-000000000002");
    assert.throws(() => f.admission.import(principal, { ...f.request, packageId: "package-000000000002", idempotencyKey: "second-key" }, f.verified), /WORK_NAME_CONFLICT/);
    assert.throws(() => f.store.snapshots.assertNameAvailable(OWNER, "copied"), /WORK_NAME_CONFLICT/);
    const lifecycle = new WorkLifecycleService(f.store, {} as WorkRuntimeAdapter, () => new Date(NOW));
    const configuration = restorePortableConfiguration(f.spec.contexts[0]!.configuration, "", "runtime-model-00000001", "runtime-image-00000001", new Map(), new Map());
    assert.throws(() => lifecycle.create(principal, { name: "copied", configuration, idempotencyKey: "ordinary-create" }), /WORK_NAME_CONFLICT/);
    assert.equal(f.store.snapshots.listJobs().length, 1);
  } finally { f.close(); }
});

test("competing same-name requests cannot create two accepted target Works", async () => {
  const f = fixture();
  try {
    const settled = await Promise.allSettled(["one", "two"].map((idempotencyKey) => Promise.resolve().then(() =>
      f.admission.import(principal, { ...f.request, idempotencyKey }, f.verified))));
    assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(settled.filter((item) => item.status === "rejected").length, 1);
    assert.equal(f.store.snapshots.listJobs().length, 1);
    assert.equal(f.store.get<{ count: number }>("SELECT COUNT(*) AS count FROM work_import_names WHERE owner_user_id = 'owner-000000000001' AND name = 'copied'")?.count, 1);
  } finally { f.close(); }
});

test("omitted name skips existing and deleted Works, reserves suffixes, and replays the chosen name", () => {
  const f = fixture();
  try {
    f.store.exec(`INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at,deleted_at)
      VALUES ('work-deleted-00000001','${OWNER}','source','stopped','stopped',1,1,'${NOW}','${NOW}','${NOW}')`);
    f.store.exec(`INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at)
      VALUES ('work-existing-0000001','${OWNER}','source-2','stopped','stopped',1,1,'${NOW}','${NOW}')`);
    const request = { packageId: f.request.packageId, idempotencyKey: "auto-one" };
    const first = f.admission.import(principal, request, f.verified);
    assert.equal(first.name, "source-3");
    assert.equal(f.store.snapshots.getJob(first.operationId)?.name, "source-3");
    assert.deepEqual(f.admission.import(principal, request), { ...first, reused: true });
    f.store.snapshots.updateJobPhase(first.operationId, 1, "succeeded", NOW);
    const second = f.admission.import(principal, { ...request, idempotencyKey: "auto-two" }, f.verified);
    assert.equal(second.name, "source-4");
    assert.notEqual(second.workId, first.workId);
    assert.throws(() => f.admission.import(principal, { ...request, name: "source", idempotencyKey: "explicit" }, f.verified), { code: "WORK_NAME_CONFLICT" });
  } finally { f.close(); }
});

test("automatic suffix truncates a full-length Unicode source name without overwriting it", () => {
  const f = fixture();
  try {
    const sourceName = "界".repeat(128);
    f.store.exec(`INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at)
      VALUES ('work-long-name-000001','${OWNER}','${sourceName}','stopped','stopped',1,1,'${NOW}','${NOW}')`);
    const spec = structuredClone(f.spec); spec.sourceName = sourceName;
    const accepted = f.admission.import(principal, { packageId: f.request.packageId, idempotencyKey: "long-auto" }, { ...f.verified, spec });
    assert.equal(accepted.name, `${"界".repeat(126)}-2`);
  } finally { f.close(); }
});

test("missing model and external MCP platform secret fail before name or quota reservation", () => {
  const f = fixture();
  try {
    const missing = structuredClone(f.spec);
    missing.bindings.models[0]!.model = "not-configured";
    assert.throws(() => f.admission.import(principal, f.request, { ...f.verified, spec: missing }), { code: "TARGET_MODEL_UNAVAILABLE" });
    const external = structuredClone(f.spec);
    external.bindings.secrets.push({ key: "k-000001", uses: [{ contextKey: "c-000001", serverId: "external", key: null }] });
    assert.throws(() => f.admission.import(principal, f.request, { ...f.verified, spec: external }), { code: "EXTERNAL_MCP_SECRET_UNAVAILABLE" });
    assert.equal(f.store.snapshots.listJobs().length, 0);
    assert.equal(f.store.snapshots.getName(OWNER, "copied"), undefined);
  } finally { f.close(); }
});

test("export acceptance locks stopped Work atomically and replay skips new runtime preflight", async () => {
  const f = fixture();
  try {
    f.store.exec(`INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at)
      VALUES ('${SOURCE}','${OWNER}','source','stopped','stopped',1,1,'${NOW}','${NOW}')`);
    let checked = 0;
    const first = await f.admission.export(principal, SOURCE, { idempotencyKey: "export-key" }, async () => { checked++; });
    assert.equal(checked, 1); assert.equal(first.reused, false);
    assert.equal(f.store.snapshots.getLock(SOURCE)?.operationId, first.operationId);
    assert.equal(f.store.snapshots.getPackage(f.store.snapshots.getJob(first.operationId)!.packageId!)?.state, "staging");
    f.store.exec(`UPDATE works SET desired_state = 'running' WHERE id = '${SOURCE}'`);
    const replay = await f.admission.export(principal, SOURCE, { idempotencyKey: "export-key" }, async () => { checked++; throw new Error("must not run"); });
    assert.deepEqual(replay, { ...first, reused: true }); assert.equal(checked, 1);
    await assert.rejects(f.admission.export(principal, SOURCE, { idempotencyKey: "new-key" }, async () => { checked++; }), { code: "SNAPSHOT_REQUIRES_STOPPED" });
    assert.equal(f.store.snapshots.listJobs().length, 1);
  } finally { f.close(); }
});

test("in-flight control mutation prevents export without leaving a package, job or gate", async () => {
  const f = fixture();
  try {
    f.store.exec(`INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at)
      VALUES ('${SOURCE}','${OWNER}','source','stopped','stopped',1,1,'${NOW}','${NOW}')`);
    f.store.acceptMutation({ principalId: OWNER, workId: SOURCE, workScope: SOURCE, operationKind: "start-work", idempotencyKey: "pending", requestDigest: hash("a"), requestJson: "{}", targetVersion: 1, now: NOW }, () => ({ resourceId: SOURCE }));
    await assert.rejects(f.admission.export(principal, SOURCE, { idempotencyKey: "export-key" }, async () => {}), { code: "WORK_BUSY" });
    assert.equal(f.store.snapshots.listJobs().length, 0);
    assert.equal(f.store.snapshots.listPackages().length, 1); // The unrelated uploaded fixture remains untouched.
    assert.equal(f.store.snapshots.getLock(SOURCE), undefined);
  } finally { f.close(); }
});

test("in-flight Session or Run request and export lock exclude each other", async () => {
  const f = fixture();
  try {
    f.store.exec(`INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at)
      VALUES ('${SOURCE}','${OWNER}','source','stopped','stopped',1,1,'${NOW}','${NOW}')`);
    const release = f.store.snapshots.beginTransientMutation(SOURCE);
    await assert.rejects(f.admission.export(principal, SOURCE, { idempotencyKey: "export-key" }, async () => {}), /WORK_SNAPSHOT_BUSY/);
    assert.equal(f.store.snapshots.getLock(SOURCE), undefined);
    release(); release();
    await f.admission.export(principal, SOURCE, { idempotencyKey: "export-key" }, async () => {});
    assert.throws(() => f.store.snapshots.beginTransientMutation(SOURCE), /WORK_SNAPSHOT_BUSY/);
  } finally { f.close(); }
});
