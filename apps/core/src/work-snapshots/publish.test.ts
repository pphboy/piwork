import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore } from "@piwork/core-store";
import { normalizeServiceDefinitionInput, validatePortableWorkSpec, type WorkControlHistory, type WorkSourceIdentityMap } from "@piwork/contracts";
import { managedVolumeName } from "@piwork/runtime-docker";
import type { VerifiedWorkPackage } from "@piwork/work-package";
import { RuntimeProfileStore } from "../configuration/runtime-profile.js";
import { registerRuntimeProfileCatalog } from "../configuration/runtime-catalog.js";
import { WorkContextStore } from "../configuration/work-context.js";
import { WorkSnapshotAdmission } from "./admission.js";
import { restorePortableConfiguration, type WorkIdentityTargets } from "./metadata.js";
import { publishImportedWork } from "./publish.js";
import { ServiceDomainResolver } from "../work-services/service-domain-resolver.js";
import { WorkServiceManagementService } from "../work-services/service-management.js";
import { recoverSnapshotJobs } from "./recovery.js";

const NOW = "2026-09-23T00:00:00.000Z", OWNER = "owner-000000000001", INSTALLATION = "install-000000000001";
const hash = (letter: string) => letter.repeat(64);
function fixture(activeService = false) {
  const root = mkdtempSync(join(tmpdir(), "piwork-publish-")); mkdirSync(join(root, "secrets"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  store.createManagedUser({ id: OWNER, account: "owner", passwordDigest: "password", role: "user", enabled: true, createdAt: NOW, updatedAt: NOW });
  const profiles = new RuntimeProfileStore(join(root, "runtime.json"), join(root, "secrets"), () => new Date(NOW));
  profiles.configure({ agentImage: "recipient:default", provider: "deterministic", model: "fixture", credential: "RECIPIENT_SECRET" });
  registerRuntimeProfileCatalog(store, profiles.load());
  const definition = normalizeServiceDefinitionInput({ name: "worker", image: { reference: "worker:fixed" }, command: "node", workingDirectory: "/",
    enabled: activeService, ports: activeService ? [{ name: "web", protocol: "tcp", containerPort: 80 }] : [],
    readiness: activeService ? { kind: "http", portName: "web", path: "/health" } : undefined });
  const spec = validatePortableWorkSpec({ formatVersion: 1, snapshotKind: "cold-full", createdAt: NOW, sourceName: "source",
    compatibility: { os: "linux", architecture: "amd64", variant: null, agentProtocol: "v2", workHistorySchema: 3, storageLayout: 2, piPackageContract: 1 },
    activeContext: null, desiredContext: "c-000001", contexts: [{ key: "c-000001", createdAt: NOW, imageKey: "i-000001", skillsTree: hash("a"), agentsBlob: hash("b"), packageBindings: [],
      configuration: { modelBindingKey: "m-000001", skills: [], packages: [], mcpServers: [], tools: { allowed: [], denied: [] },
        resources: { cpuMillis: 1000, memoryBytes: 1073741824, agentCpuMillis: 500, agentMemoryBytes: 536870912, maxServices: 2, maxRetainedVolumes: 2 } } }],
    piPackageArtifacts: [], services: [{ key: "s-000001", name: "worker", desiredRevision: 1, appliedRevision: activeService ? 1 : null,
      enabled: activeService, tombstonedAt: activeService ? null : NOW,
      revisions: [{ revision: 1, createdAt: NOW, definition, imageKey: activeService ? "i-000001" : null }], recovery: { count: 3, windowStartedAt: NOW, nextRetryAt: null, readySince: null },
      sourceObservation: { state: activeService ? "ready" : "disabled", lastError: null } }],
    quotaReservations: [{ subjectKind: "agent", subjectKey: "agentd", desiredCpuMillis: 500, desiredMemoryBytes: 536870912, serviceSlots: 0, volumeSlots: 2 },
      { subjectKind: "service", subjectKey: "s-000001", desiredCpuMillis: 250, desiredMemoryBytes: 134217728, serviceSlots: 1, volumeSlots: 0 }],
    volumes: [{ role: "agent-private", tree: hash("a"), serviceRefKeys: [] }, { role: "workspace", tree: hash("a"), serviceRefKeys: ["s-000001"] }],
    images: [{ key: "i-000001", imageId: `sha256:${hash("c")}`, platform: { os: "linux", architecture: "amd64", variant: null }, config: hash("c"), layers: [] }],
    bindings: { models: [{ key: "m-000001", provider: "deterministic", model: "fixture", baseUrl: null }], secrets: [] },
    history: { control: hash("d"), sourceIdentityMap: hash("e") }, blobs: ["a", "b", "c", "d", "e"].map((letter) => ({ digest: hash(letter), size: 0,
      kinds: letter === "a" ? ["tree"] : letter === "b" ? ["file"] : letter === "c" ? ["image-config"] : letter === "d" ? ["control-history"] : ["identity-map"] })) });
  const history: WorkControlHistory = { version: 1, work: { name: "source", createdAt: NOW }, configurationRevisions: [{ revision: 1, contextKey: "c-000001" }],
    operations: [{ id: "operation-source-000001", workId: "work-source-00000001", serviceId: "service-source-000001", kind: "unknown-historic", state: "succeeded",
      targetVersion: 1, requestJson: activeService ? `http://worker.w-source123.work/ PRIVATE_REQUEST` : "PRIVATE_REQUEST",
      resultJson: "PRIVATE_RESULT", errorJson: null, createdAt: NOW, updatedAt: NOW }], idempotency: [] };
  const identities: WorkSourceIdentityMap = { version: 1, sourceWorkId: "work-source-00000001", contexts: [{ sourceId: "context-source-000001", key: "c-000001" }],
    services: [{ sourceId: "service-source-000001", key: "s-000001" }], operations: [{ sourceId: "operation-source-000001", key: "o-000001" }] };
  const verified: VerifiedWorkPackage = { spec, digest: hash("9"), size: 100, restoredBytes: 0, entryCount: 0,
    metadata: new Map<string, unknown>([[spec.history.control, history], [spec.history.sourceIdentityMap, identities]]) };
  store.snapshots.insertPackage({ id: "package-000000000001", ownerUserId: OWNER, digest: verified.digest, size: verified.size, state: "ready", jobId: null,
    createdAt: NOW, readyAt: NOW, expiresAt: "2026-09-24T00:00:00.000Z" });
  const admission = new WorkSnapshotAdmission(store, profiles, () => new Date(NOW));
  const accepted = admission.import({ userId: OWNER, role: "user" }, { packageId: "package-000000000001", name: "copy",
    idempotencyKey: "import-key" }, verified);
  const targets = JSON.parse(store.snapshots.listArtifacts(accepted.operationId).find((item) => item.artifactKey === "identity-map")!.logicalId) as WorkIdentityTargets;
  const config = restorePortableConfiguration(spec.contexts[0]!.configuration, "AGENTS", "runtime-model-00000001", "owned-image-00000001", new Map([["s-000001", targets.services[0]!.id]]), new Map());
  const prepared = { contexts: [{ key: "c-000001", revision: 1, configuration: config, runtimeProfileJson: JSON.stringify(profiles.load()), sourceRuntimeRevision: 1,
    snapshot: { snapshotId: targets.contexts[0]!.id, workId: targets.workId, directory: join(root, "owned"), configuration: config,
      metadata: { version: 1 as const, snapshotId: targets.contexts[0]!.id, workId: targets.workId, imageIdentity: spec.images[0]!.imageId, skills: [], packageContractVersion: 1 as const, packageBindings: [], createdAt: NOW } } }],
    activeContextId: null, desiredContextId: targets.contexts[0]!.id };
  const images = new Map([["i-000001", { identity: spec.images[0]!.imageId, selectionId: "owned-image-00000001" }]]);
  const volumes = [{ role: "agent-private" as const, id: "volume-target-private", runtimeName: managedVolumeName(INSTALLATION, targets.workId, "work-private") },
    { role: "workspace" as const, id: "volume-target-workspace", runtimeName: managedVolumeName(INSTALLATION, targets.workId, "work-workspace") }];
  return { root, store, profiles, spec, history, identities, verified, accepted, targets, prepared, images, volumes,
    publish(revalidateBindings: () => void = () => {}) { return publishImportedWork({ store, operationId: accepted.operationId, epoch: 1, verified, targets, prepared, images,
      volumes, installationId: INSTALLATION, now: NOW, revalidateBindings }); },
    close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("single fenced transaction publishes stopped Work with exact retained quotas, references and opaque history", () => {
  const f = fixture();
  try {
    assert.equal(f.store.getWork(f.targets.workId), undefined);
    assert.equal(f.publish(), f.targets.workId);
    const work = f.store.getWork(f.targets.workId)!;
    assert.ok(f.store.getWorkNetworkName(f.targets.workId)?.startsWith("w-"));
    assert.equal(f.store.getServiceDomainLabel(f.targets.workId, f.targets.services[0]!.id), "worker");
    assert.equal(work.desiredState, "stopped"); assert.equal(work.observedState, "stopped");
    assert.equal(f.store.getWorkConfiguration(f.targets.workId)?.activeContextId, null);
    assert.equal(f.store.getWorkConfiguration(f.targets.workId)?.desiredContextId, f.targets.contexts[0]!.id);
    assert.equal(f.store.getQuotaReservation(f.targets.workId, "import", "import"), undefined);
    const quota = f.store.getQuotaReservation(f.targets.workId, "service", f.targets.services[0]!.id)!;
    assert.equal(quota.desiredCpuMillis, 250); assert.equal(quota.occupiedCpuMillis, 0);
    assert.equal(f.store.listVolumeReferences(f.targets.workId).filter((ref) => ref.consumerKind === "service").length, 1);
    assert.equal(f.store.listServices(f.targets.workId, true)[0]!.tombstonedAt, NOW);
    assert.equal(f.store.snapshots.listHistory(f.targets.workId)[0]!.recordJson.includes("PRIVATE_REQUEST"), true);
    assert.equal(f.store.snapshots.getProvenance(f.targets.workId)?.packageDigest, f.verified.digest);
    assert.equal(f.store.snapshots.getJob(f.accepted.operationId)?.phase, "succeeded");
  } finally { f.close(); }
});

test("同一 V1 包导入两次后获得不同目标域名，且停止态与源清单保持不变", async () => {
  const f = fixture(true);
  try {
    const source = JSON.stringify(f.verified.spec);
    f.publish();
    const firstDomain = `worker.${f.store.getWorkNetworkName(f.targets.workId)}.work`;
    const accepted = new WorkSnapshotAdmission(f.store, f.profiles, () => new Date(NOW)).import(
      { userId: OWNER, role: "user" }, { packageId: "package-000000000001", name: "copy-2", idempotencyKey: "import-key-2" }, f.verified);
    const targets = JSON.parse(f.store.snapshots.listArtifacts(accepted.operationId)
      .find((item) => item.artifactKey === "identity-map")!.logicalId) as WorkIdentityTargets;
    const prepared = { ...f.prepared, contexts: f.prepared.contexts.map((entry) => ({ ...entry,
      snapshot: { ...entry.snapshot, snapshotId: targets.contexts[0]!.id, workId: targets.workId } })),
      desiredContextId: targets.contexts[0]!.id };
    const volumes = [{ role: "agent-private" as const, id: "volume-second-private", runtimeName: managedVolumeName(INSTALLATION, targets.workId, "work-private") },
      { role: "workspace" as const, id: "volume-second-workspace", runtimeName: managedVolumeName(INSTALLATION, targets.workId, "work-workspace") }];
    publishImportedWork({ store: f.store, operationId: accepted.operationId, epoch: 1, verified: f.verified, targets, prepared,
      images: f.images, volumes, installationId: INSTALLATION, now: NOW, revalidateBindings: () => {} });
    const secondDomain = `worker.${f.store.getWorkNetworkName(targets.workId)}.work`;
    assert.notEqual(secondDomain, firstDomain);
    assert.equal(f.store.getWork(targets.workId)?.desiredState, "stopped");
    assert.equal(f.store.getServiceDomainLabel(targets.workId, targets.services[0]!.id), "worker");
    const resolver = new ServiceDomainResolver(f.store, async () => ({ exists: true, running: true }));
    const management = new WorkServiceManagementService(f.store,
      { inspect: async () => ({ exists: true, running: true }) } as never);
    const inspect = async (workId: string, serviceId: string, domain: string) => {
      const access = await resolver.describe(workId, serviceId);
      assert.equal(access.hostname, domain);
      assert.equal(access.status, "unavailable");
      assert.equal(access.defaultUrl, `http://${domain}/`);
      const principal = { userId: OWNER, role: "user" as const };
      assert.equal((await management.listWithAccess(principal, workId))[0]!.access.status, "unavailable");
      assert.equal((await management.showWithAccess(principal, workId, serviceId)).access.hostname, domain);
      await assert.rejects(resolver.resolveTarget(domain, 80), { code: "SERVICE_UNAVAILABLE" });
    };
    await inspect(f.targets.workId, f.targets.services[0]!.id, firstDomain);
    await inspect(targets.workId, targets.services[0]!.id, secondDomain);
    f.store.exec(`UPDATE works SET desired_state='running', observed_state='ready' WHERE id='${f.targets.workId}';
      UPDATE service_heads SET observed_state='ready' WHERE work_id='${f.targets.workId}'`);
    assert.equal((await resolver.describe(f.targets.workId, f.targets.services[0]!.id)).status, "available");
    assert.equal((await resolver.resolveTarget(firstDomain, 80)).work.id, f.targets.workId);
    await inspect(targets.workId, targets.services[0]!.id, secondDomain);
    assert.match(f.store.snapshots.listHistory(f.targets.workId)[0]!.recordJson, /http:\/\/worker\.w-source123\.work\//);
    assert.match(f.store.snapshots.listHistory(targets.workId)[0]!.recordJson, /http:\/\/worker\.w-source123\.work\//);
    assert.equal(JSON.stringify(f.verified.spec), source);
  } finally { f.close(); }
});

test("startup after import publication preserves one stopped Work and its successful Operation", async () => {
  const f = fixture(); let removals = 0;
  try {
    f.publish();
    const result = await recoverSnapshotJobs({ store: f.store, contexts: new WorkContextStore(join(f.root, "contexts")),
      snapshotsDirectory: join(f.root, "snapshots"), runtime: { async removeSnapshotHelper() { removals++; },
        async deleteManagedVolume() { removals++; } } });
    assert.deepEqual(result, { cleaned: 0, pending: 0 });
    assert.equal(removals, 0);
    assert.equal(f.store.listWorks().filter((work) => work.id === f.targets.workId).length, 1);
    assert.equal(f.store.getWork(f.targets.workId)?.observedState, "stopped");
    assert.equal(f.store.getOperation(f.accepted.operationId)?.state, "succeeded");
    assert.equal(f.store.listRuntimeGenerations(f.targets.workId).length, 0);
  } finally { f.close(); }
});

test("publication failure rolls back all visible rows and keeps name and quota holds", () => {
  const f = fixture();
  try {
    f.store.exec("INSERT INTO volume_records(id,installation_id,work_id,service_id,volume_role,runtime_name,state,reference_count,retained_at,purged_at,created_at) VALUES ('volume-target-workspace','other','other',NULL,'workspace','other','active',0,NULL,NULL,'2026-09-23T00:00:00.000Z')");
    assert.throws(() => f.publish());
    assert.equal(f.store.getWork(f.targets.workId), undefined);
    assert.equal(f.store.snapshots.getName(OWNER, "copy")?.operationId, f.accepted.operationId);
    assert.ok(f.store.getQuotaReservation(f.targets.workId, "import", "import"));
    assert.equal(f.store.snapshots.getJob(f.accepted.operationId)?.phase, "accepted");
  } finally { f.close(); }
});

test("recipient binding revocation at publication leaves target unpublished", () => {
  const f = fixture();
  try {
    assert.throws(() => f.publish(() => { throw new Error("BINDING_REQUIRED"); }), /BINDING_REQUIRED/);
    assert.equal(f.store.getWork(f.targets.workId), undefined);
    assert.ok(f.store.getQuotaReservation(f.targets.workId, "import", "import"));
    assert.equal(f.store.snapshots.getName(OWNER, "copy")?.operationId, f.accepted.operationId);
  } finally { f.close(); }
});
