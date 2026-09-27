import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore } from "@piwork/core-store";
import { normalizeServiceDefinitionInput, type WorkConfig } from "@piwork/contracts";
import { managedVolumeName } from "@piwork/runtime-docker";
import { WorkContextStore } from "../configuration/work-context.js";
import { allocateWorkIdentity, collectWorkSnapshotMetadata, restorePortableConfiguration } from "./metadata.js";

const NOW = "2026-09-23T00:00:00.000Z", OWNER = "user-owner-00000001", WORK = "work-source-00000001", CONTEXT = "context-source-00000001", SERVICE = "service-source-00000001", INSTALLATION = "install-000000000001";
function fixture(workId = WORK, contextId = CONTEXT, serviceId = SERVICE) {
  const root = mkdtempSync(join(tmpdir(), "piwork-snapshot-metadata-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") }), contexts = new WorkContextStore(join(root, "works"));
  store.createInitialAdministrator({ id: OWNER, account: "source-account-never-exported", passwordDigest: "PLATFORM_PASSWORD_SENTINEL", now: NOW });
  const configuration: WorkConfig = { agentImage: { catalogId: "runtime-image-00000001" }, modelRef: "runtime-model-00000001", skills: [], packages: [], agentsMd: "USER_AGENTS_SECRET_SENTINEL\n", tools: { allowed: ["read"], denied: [] },
    resources: { cpuMillis: 1000, memoryBytes: 1024 ** 3, agentCpuMillis: 500, agentMemoryBytes: 512 * 1024 ** 2, maxServices: 8, maxRetainedVolumes: 16 },
    mcpServers: [{ serverId: "configured-mcp", transport: "stdio", command: "node", required: true, requiredServiceId: serviceId, secretRefs: [{ secretId: "secret-source-00000001", key: "TOKEN" }] }],
  };
  const snapshot = contexts.build({ workId, snapshotId: contextId, configuration, imageIdentity: `sha256:${"a".repeat(64)}`, skills: [], createdAt: NOW });
  const create = store.acceptMutation({ principalId: OWNER, workScope: "new-work", operationKind: "create-work", idempotencyKey: "create", requestDigest: "b".repeat(64), requestJson: '{ "native": "create-work raw" }', targetVersion: 1, now: NOW }, (tx) => {
    tx.run("INSERT INTO works(id, owner_user_id, name, desired_state, observed_state, desired_revision, control_version, created_at, updated_at) VALUES (?, ?, 'retained work', 'stopped', 'stopped', 1, 1, ?, ?)", workId, OWNER, NOW, NOW);
    tx.run("INSERT INTO quota_reservations VALUES (?, 'agent', 'agentd', 500, 536870912, 17, 1024, 0, 2, ?)", workId, NOW);
    tx.run("INSERT INTO quota_reservations VALUES (?, 'service', ?, 250, 134217728, 99, 2048, 1, 0, ?)", workId, serviceId, NOW);
    for (const [role, logicalId, volumeId, count] of [["agent-private", "work-private", `volume-private-${workId}`, 1], ["workspace", "work-workspace", `volume-workspace-${workId}`, 2]] as const) {
      tx.run("INSERT INTO volume_records VALUES (?, ?, ?, NULL, ?, ?, 'active', ?, NULL, NULL, ?)", volumeId, INSTALLATION, workId, role, managedVolumeName(INSTALLATION, workId, logicalId), count, NOW);
      tx.run("INSERT INTO volume_references VALUES (?, 'work', ?, ?)", volumeId, workId, NOW);
      if (role === "workspace") tx.run("INSERT INTO volume_references VALUES (?, 'service', ?, ?)", volumeId, serviceId, NOW);
    }
    tx.run("INSERT INTO work_config_revisions(work_id, revision, config_json, created_by_user_id, created_at, runtime_profile_json, source_runtime_revision) VALUES (?, 1, ?, ?, ?, ?, 1)", workId, JSON.stringify(configuration), OWNER, NOW,
      JSON.stringify({ version: 1, revision: 1, agentImage: "original:image", model: { provider: "deterministic", id: "model-1", credentialRef: "/HOST_PLATFORM_CREDENTIAL_SENTINEL" }, updatedAt: NOW }));
    store.insertInitialWorkContext(workId, 1, { snapshotId: snapshot.snapshotId, configurationJson: JSON.stringify(configuration), imageIdentity: snapshot.metadata.imageIdentity, createdByUserId: OWNER, createdAt: NOW });
    const definition = normalizeServiceDefinitionInput({ name: "user-service", image: { reference: "user:custom" }, command: "node", environment: { USER_SECRET: "USER_SERVICE_ENV_SENTINEL" }, enabled: false,
      mounts: [{ source: "workspace", target: "/var/data/workspace", readOnly: false }] });
    for (const revision of [1, 2]) tx.run("INSERT INTO service_revisions VALUES (?, ?, ?, ?, ?, ?)", workId, serviceId, revision, JSON.stringify({ ...definition, serviceId, revision }), revision === 1 ? `sha256:${"c".repeat(64)}` : null, NOW);
    tx.run("INSERT INTO service_heads VALUES (?, ?, 'user-service', 2, 1, 0, 'exhausted', ?, NULL)", workId, serviceId, NOW);
    tx.run("INSERT INTO service_runtime_bindings VALUES (?, ?, 1, NULL, ?, 3, ?, ?, NULL, ?)", workId, serviceId, `sha256:${"c".repeat(64)}`, NOW, NOW, NOW);
    return { resourceId: workId };
  });
  store.updateOperation(create.operationId, "succeeded", NOW);
  const unknown = store.acceptMutation({ principalId: `work-agent:${workId}`, workId, workScope: workId, operationKind: "future-user-operation", idempotencyKey: "native-unknown", requestDigest: "d".repeat(64), requestJson: "{deliberately non-JSON historical text", targetVersion: 2, now: NOW }, () => ({ resourceId: serviceId }));
  store.updateOperation(unknown.operationId, "failed", NOW, { resultJson: ' { "unchanged" : "old-id" } ', errorJson: "plain historical error\n" });
  const exporting = store.acceptMutation({ principalId: OWNER, workId, workScope: workId, operationKind: "export-work", idempotencyKey: "current-export", requestDigest: "e".repeat(64), requestJson: "{}", targetVersion: 2, now: NOW }, () => ({ resourceId: workId }));
  return { root, store, contexts, configuration, workId, contextId, serviceId, create, unknown, exporting,
    collect() { return collectWorkSnapshotMetadata(store, contexts, workId, exporting.operationId, INSTALLATION); },
    close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("collects complete scoped revisions, native null-work create and opaque terminal history, excluding platform material", () => {
  const f = fixture();
  try {
    assert.equal(f.store.getOperation(f.create.operationId)?.workId, null);
    const result = f.collect();
    assert.equal(result.activeContext, null); assert.equal(result.desiredContext, "c-000001");
    assert.equal(result.services[0]?.revisions.length, 2); assert.equal(result.services[0]?.revisions[1]?.imageKey, null);
    assert.equal(result.services[0]?.recovery.count, 3); assert.equal(result.services[0]?.tombstonedAt, NOW);
    assert.deepEqual(result.quotaReservations, [
      { subjectKind: "agent", subjectKey: "agentd", desiredCpuMillis: 500, desiredMemoryBytes: 536870912, serviceSlots: 0, volumeSlots: 2 },
      { subjectKind: "service", subjectKey: "s-000001", desiredCpuMillis: 250, desiredMemoryBytes: 134217728, serviceSlots: 1, volumeSlots: 0 },
    ]);
    assert.equal(f.store.getQuotaReservation(WORK, "service", SERVICE)?.occupiedCpuMillis, 99);
    assert.deepEqual(result.volumes.map(({ role, serviceRefKeys }) => ({ role, serviceRefKeys })), [
      { role: "agent-private", serviceRefKeys: [] }, { role: "workspace", serviceRefKeys: ["s-000001"] },
    ]);
    assert.equal(result.volumes[1]?.record.referenceCount, 2);
    assert.equal(result.services[0]?.revisions[0]?.definition.environment.USER_SECRET, "USER_SERVICE_ENV_SENTINEL");
    assert.equal(result.contexts[0]?.configuration.mcpServers[0]?.requiredServiceKey, "s-000001");
    assert.deepEqual(result.bindings.models, [{ key: "m-000001", provider: "deterministic", model: "model-1", baseUrl: null }]);
    assert.deepEqual(result.bindings.secrets[0]?.uses, [{ contextKey: "c-000001", serverId: "configured-mcp", key: "TOKEN" }]);
    assert.equal(result.history.operations.length, 2);
    assert.equal(result.history.operations.find((item) => item.id === f.create.operationId)?.workId, WORK);
    const native = result.history.operations.find((item) => item.id === f.unknown.operationId)!;
    assert.equal(native.requestJson, "{deliberately non-JSON historical text"); assert.equal(native.resultJson, ' { "unchanged" : "old-id" } '); assert.equal(native.errorJson, "plain historical error\n");
    assert.deepEqual(new Set(result.history.idempotency.map((record) => record.principalKind)), new Set(["owner", "agent"]));
    const serialized = JSON.stringify({ history: result.history, bindings: result.bindings, services: result.services, identities: result.identities, configurations: result.contexts.map((context) => context.configuration) });
    for (const forbidden of ["PLATFORM_PASSWORD_SENTINEL", "HOST_PLATFORM_CREDENTIAL_SENTINEL", OWNER, "source-account-never-exported", "secret-source-00000001", "runtime-model-00000001"]) assert.ok(!serialized.includes(forbidden));
    assert.equal(f.store.listOperations().length, 3); // Merely querying history never schedules it.
  } finally { f.close(); }
});

test("two imports allocate independent managed identities and restore only structured service/secret references", () => {
  const f = fixture();
  try {
    const metadata = f.collect(), first = allocateWorkIdentity(metadata.identities, "work-target-one"), second = allocateWorkIdentity(metadata.identities, "work-target-two");
    const firstIds = new Set([first.workId, ...first.contexts.map((entry) => entry.id), ...first.services.map((entry) => entry.id), ...first.operations.map((entry) => entry.id)]);
    for (const id of [second.workId, ...second.contexts.map((entry) => entry.id), ...second.services.map((entry) => entry.id), ...second.operations.map((entry) => entry.id)]) assert.ok(!firstIds.has(id));
    const restored = restorePortableConfiguration(metadata.contexts[0]!.configuration, f.configuration.agentsMd, "recipient-model-00000001", "owned-image-00000001",
      new Map(first.services.map((entry) => [entry.key, entry.id])), new Map([["b-000001", "recipient-secret-00000001"]]));
    assert.equal(restored.mcpServers[0]?.requiredServiceId, first.services[0]?.id);
    assert.equal(restored.mcpServers[0]?.secretRefs?.[0]?.secretId, "recipient-secret-00000001");
    assert.equal(restored.agentsMd, f.configuration.agentsMd); assert.equal(metadata.services[0]?.tombstonedAt, NOW);
  } finally { f.close(); }
});

test("re-export includes imported opaque history plus live history and independent archived principals without the old package", () => {
  const source = fixture();
  let target: ReturnType<typeof fixture> | undefined;
  try {
    const first = source.collect(), targets = allocateWorkIdentity(first.identities, "work-target-copy");
    target = fixture(targets.workId, targets.contexts[0]!.id, targets.services[0]!.id);
    const importOperation = target.store.acceptMutation({ principalId: OWNER, workScope: "work-imports", operationKind: "import-work", idempotencyKey: "import", requestDigest: "f".repeat(64), requestJson: "{}", targetVersion: 1, now: NOW }, () => ({ resourceId: targets.workId }));
    target.store.updateOperation(importOperation.operationId, "succeeded", NOW);
    target.store.snapshots.insertJob({ operationId: importOperation.operationId, ownerUserId: OWNER, kind: "import", sourceWorkId: null, targetWorkId: targets.workId, snapshotId: null, packageId: null, name: "retained work", requestDigest: "f".repeat(64), phase: "succeeded", deadlineAt: NOW, workerEpoch: 1, createdAt: NOW, updatedAt: NOW, cleanupError: null });
    for (const operation of first.history.operations) {
      const key = first.identities.operations.find((entry) => entry.sourceId === operation.id)!.key;
      target.store.snapshots.insertHistory({ workId: targets.workId, operationId: targets.operations.find((entry) => entry.key === key)!.id, sourceOperationId: operation.id, recordJson: JSON.stringify(operation) });
    }
    target.store.snapshots.insertProvenance({ workId: targets.workId, packageDigest: "1".repeat(64), importOperationId: importOperation.operationId,
      identityMapJson: JSON.stringify({ sourceIdentityMap: first.identities, targets, archivedIdempotency: first.history.idempotency }) });
    source.close();
    const second = target.collect(); assert.equal(second.history.operations.length, 5);
    for (const original of first.history.operations) {
      const key = first.identities.operations.find((entry) => entry.sourceId === original.id)!.key;
      const id = targets.operations.find((entry) => entry.key === key)!.id;
      const archived = second.history.operations.find((entry) => entry.id === id)!;
      assert.equal(archived.workId, targets.workId); assert.equal(archived.requestJson, original.requestJson); assert.equal(archived.resultJson, original.resultJson); assert.equal(archived.errorJson, original.errorJson);
      assert.equal(target.store.getOperation(id), undefined);
    }
    assert.equal(new Set(second.history.idempotency.map((entry) => entry.principalKey)).size, 4);
    assert.ok(second.history.idempotency.some((entry) => entry.workScope === targets.workId));
    assert.ok(second.history.idempotency.every((entry) => second.history.operations.some((operation) => operation.id === entry.operationId)));
  } finally { source.close(); target?.close(); }
});

test("another nonterminal Operation prevents capture instead of silently omitting it", () => {
  const f = fixture();
  try { f.store.updateOperation(f.unknown.operationId, "running", NOW); assert.throws(() => f.collect(), /SNAPSHOT_WORK_BUSY/); }
  finally { f.close(); }
});

test("retained service reservations are captured verbatim and missing or extra rows fail", () => {
  const f = fixture();
  try {
    f.store.exec(`UPDATE service_heads SET tombstoned_at = NULL WHERE work_id = '${WORK}' AND service_id = '${SERVICE}'`);
    assert.equal(f.collect().services[0]?.enabled, false);
    assert.equal(f.collect().quotaReservations[1]?.desiredCpuMillis, 250);
    f.store.exec(`DELETE FROM quota_reservations WHERE work_id = '${WORK}' AND subject_kind = 'service'`);
    assert.throws(() => f.collect(), { code: "PACKAGE_INVALID" });
    f.store.exec(`INSERT INTO quota_reservations VALUES ('${WORK}', 'service', '${SERVICE}', 250, 134217728, 0, 0, 1, 0, '${NOW}')`);
    f.store.exec(`INSERT INTO quota_reservations VALUES ('${WORK}', 'service', 'service-unknown', 0, 0, 0, 0, 0, 0, '${NOW}')`);
    assert.throws(() => f.collect(), { code: "PACKAGE_INVALID" });
  } finally { f.close(); }
});

test("workspace records all service grants, including a tombstone with a retained grant", () => {
  const f = fixture();
  try {
    const secondId = "service-source-00000002";
    const definition = normalizeServiceDefinitionInput({ name: "sidecar", image: { reference: "sidecar:fixed" }, command: "node", workingDirectory: "/", enabled: false });
    const accepted = f.store.acceptMutation({ principalId: OWNER, workId: WORK, workScope: WORK, operationKind: "create-service", idempotencyKey: "second-service", requestDigest: "8".repeat(64), requestJson: "{}", targetVersion: 3, now: NOW }, (tx) => {
      tx.run("INSERT INTO service_revisions VALUES (?, ?, 1, ?, NULL, ?)", WORK, secondId, JSON.stringify({ ...definition, serviceId: secondId, revision: 1 }), NOW);
      tx.run("INSERT INTO service_heads VALUES (?, ?, 'sidecar', 1, NULL, 0, 'disabled', NULL, NULL)", WORK, secondId);
      tx.run("INSERT INTO quota_reservations VALUES (?, 'service', ?, 0, 0, 0, 0, 1, 0, ?)", WORK, secondId, NOW);
      tx.run("INSERT INTO volume_references VALUES (?, 'service', ?, ?)", `volume-workspace-${WORK}`, secondId, NOW);
      tx.run("UPDATE volume_records SET reference_count = 3 WHERE id = ?", `volume-workspace-${WORK}`);
      return { resourceId: secondId };
    });
    f.store.updateOperation(accepted.operationId, "succeeded", NOW);
    const result = f.collect();
    assert.equal(result.services[0]?.tombstonedAt, NOW);
    assert.deepEqual(result.volumes[1]?.serviceRefKeys, ["s-000001", "s-000002"]);
    assert.deepEqual(result.quotaReservations.map((row) => row.subjectKey), ["agentd", "s-000001", "s-000002"]);
  } finally { f.close(); }
});

test("storage capture refuses extra, missing, private or orphan references instead of guessing", () => {
  for (const damage of [
    (f: ReturnType<typeof fixture>) => f.store.exec(`DELETE FROM volume_records WHERE id = 'volume-private-${f.workId}'`),
    (f: ReturnType<typeof fixture>) => f.store.exec(`INSERT INTO volume_records VALUES ('volume-extra', '${INSTALLATION}', '${f.workId}', NULL, 'service-data', 'extra-volume', 'retained', 0, '${NOW}', NULL, '${NOW}')`),
    (f: ReturnType<typeof fixture>) => {
      f.store.exec(`INSERT INTO volume_references VALUES ('volume-private-${f.workId}', 'service', '${f.serviceId}', '${NOW}')`);
      f.store.exec(`UPDATE volume_records SET reference_count = 2 WHERE id = 'volume-private-${f.workId}'`);
    },
    (f: ReturnType<typeof fixture>) => {
      f.store.exec(`INSERT INTO volume_references VALUES ('volume-workspace-${f.workId}', 'service', 'service-unknown', '${NOW}')`);
      f.store.exec(`UPDATE volume_records SET reference_count = 3 WHERE id = 'volume-workspace-${f.workId}'`);
    },
    (f: ReturnType<typeof fixture>) => f.store.exec(`UPDATE volume_records SET reference_count = 999 WHERE id = 'volume-workspace-${f.workId}'`),
    (f: ReturnType<typeof fixture>) => f.store.exec(`UPDATE volume_records SET installation_id = 'install-wrong' WHERE id = 'volume-workspace-${f.workId}'`),
  ]) {
    const f = fixture();
    try { damage(f); assert.throws(() => f.collect(), { code: "SNAPSHOT_STORAGE_UNSUPPORTED" }); }
    finally { f.close(); }
  }
});
