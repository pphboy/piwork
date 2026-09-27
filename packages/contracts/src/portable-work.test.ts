import assert from "node:assert/strict";
import test from "node:test";
import { Check } from "typebox/value";
import {
  validatePortableWorkSpec, validateWorkHistory, WorkControlHistorySchema,
  type PortableWorkSpec, type WorkControlHistory, type WorkSourceIdentityMap,
} from "./control/portable-work.js";
import { ExportWorkRequestSchema, ImportWorkRequestSchema, normalizeWorkImportBindings, validateSnapshotIdempotencyKey } from "./control/work-snapshots.js";
import { normalizeServiceDefinitionInput } from "./control/services.js";

const digest = "a".repeat(64);
function manifest(): PortableWorkSpec {
  return {
    formatVersion: 1, snapshotKind: "cold-full", createdAt: "2026-09-23T00:00:00Z", sourceName: "demo",
    compatibility: { os: "linux", architecture: "amd64", variant: null, agentProtocol: "v2", workHistorySchema: 3, storageLayout: 2, piPackageContract: 1 },
    activeContext: null, desiredContext: "c-000001",
    contexts: [{ key: "c-000001", createdAt: "2026-09-23T00:00:00Z", imageKey: "i-000001", skillsTree: digest, agentsBlob: digest, packageBindings: [],
      configuration: { modelBindingKey: "m-000001", skills: [], packages: [], mcpServers: [], tools: { allowed: [], denied: [] },
        resources: { cpuMillis: 1000, memoryBytes: 268435456, agentCpuMillis: 500, agentMemoryBytes: 134217728, maxServices: 2, maxRetainedVolumes: 4 } },
    }],
    piPackageArtifacts: [], services: [],
    quotaReservations: [{ subjectKind: "agent", subjectKey: "agentd", desiredCpuMillis: 500, desiredMemoryBytes: 134217728, serviceSlots: 0, volumeSlots: 2 }],
    volumes: [{ role: "agent-private", tree: digest, serviceRefKeys: [] }, { role: "workspace", tree: digest, serviceRefKeys: [] }],
    images: [{ key: "i-000001", imageId: `sha256:${digest}`, platform: { os: "linux", architecture: "amd64", variant: null }, config: digest, layers: [] }],
    bindings: { models: [{ key: "m-000001", provider: "test", model: "test", baseUrl: null }], secrets: [] },
    history: { control: digest, sourceIdentityMap: digest },
    blobs: [{ digest, size: 0, kinds: ["file", "tree", "control-history", "identity-map", "image-config"] }],
  };
}
function manifestWithServices(): PortableWorkSpec {
  const value = manifest();
  for (const [key, name] of [["s-000001", "web"], ["s-000002", "worker"]] as const) {
    value.services.push({ key, name, desiredRevision: 1, appliedRevision: null, enabled: false, tombstonedAt: name === "worker" ? value.createdAt : null,
      revisions: [{ revision: 1, createdAt: value.createdAt, imageKey: null,
        definition: normalizeServiceDefinitionInput({ name, image: { reference: "example:captured" }, command: "node", workingDirectory: "/" }) }],
      recovery: { count: 0, windowStartedAt: null, nextRetryAt: null, readySince: null }, sourceObservation: { state: "disabled", lastError: null } });
    value.quotaReservations.push({ subjectKind: "service", subjectKey: key, desiredCpuMillis: 250, desiredMemoryBytes: 134217728, serviceSlots: 1, volumeSlots: 0 });
    value.volumes[1].serviceRefKeys.push(key);
  }
  return value;
}
test("portable manifest preserves empty collections and uninitialized active context", () => {
  const value = manifest();
  assert.equal(validatePortableWorkSpec(value), value);
  value.activeContext = value.desiredContext;
  assert.equal(validatePortableWorkSpec(value), value);
});
test("final V1 requires explicit empty Pi package graph and validates bindings", () => {
  const base = manifest();
  assert.throws(() => validatePortableWorkSpec({ ...base, piPackageArtifacts: undefined }));
  assert.throws(() => validatePortableWorkSpec({ ...base, compatibility: { ...base.compatibility, piPackageContract: undefined } }));
  assert.throws(() => validatePortableWorkSpec({ ...base, contexts: [{ ...base.contexts[0]!, packageBindings: undefined }] }));
  const artifact = { key: `sha256:${digest}`, name: "@example/tools", version: "1.0.0", sourceKind: "local" as const,
    resolvedSource: "local:fixture", preparedEnvironment: { os: "linux" as const, architecture: "amd64", variant: null, nodeAbi: "137", piSdkVersion: "0.86.0" },
    resourceCounts: { extensions: 0, skills: 0, prompts: 0, themes: 0 }, contentDigest: `sha256:${digest}`,
    treeDigest: digest, resourceInventory: { extensions: [], skills: [], prompts: [], themes: [] } };
  const value = manifest();
  value.piPackageArtifacts.push(artifact);
  value.contexts[0]!.configuration.packages.push({ name: artifact.name, enabled: false });
  value.contexts[0]!.packageBindings.push({ name: artifact.name, artifactKey: artifact.key });
  assert.equal(validatePortableWorkSpec(value), value);
  value.contexts[0]!.packageBindings[0]!.artifactKey = `sha256:${"b".repeat(64)}`;
  assert.throws(() => validatePortableWorkSpec(value), /context.packageBindings/);
});
test("portable graph retains distinct package versions and same-version content across historical contexts", () => {
  const value = manifest();
  const artifact = (hex: string, version: string) => ({ key: `sha256:${hex.repeat(64)}`, name: "@example/tools", version,
    sourceKind: "local" as const, resolvedSource: `fixture-${hex}`,
    preparedEnvironment: { os: "linux" as const, architecture: "amd64", variant: null, nodeAbi: "137", piSdkVersion: "0.86.0" },
    resourceCounts: { extensions: 0, skills: 0, prompts: 0, themes: 0 }, contentDigest: `sha256:${hex.repeat(64)}`,
    treeDigest: digest, resourceInventory: { extensions: [], skills: [], prompts: [], themes: [] } });
  value.piPackageArtifacts.push(artifact("b", "1.0.0"), artifact("c", "1.0.0"), artifact("d", "2.0.0"));
  for (const [index, key] of ["b", "c", "d"].entries()) {
    const context = structuredClone(value.contexts[0]!);
    context.key = `c-00000${index + 1}`;
    context.configuration.packages = [{ name: "@example/tools", enabled: index !== 1 }];
    context.packageBindings = [{ name: "@example/tools", artifactKey: `sha256:${key.repeat(64)}` }];
    if (index === 0) value.contexts[0] = context; else value.contexts.push(context);
  }
  value.activeContext = "c-000001";
  value.desiredContext = "c-000003";
  assert.equal(validatePortableWorkSpec(value), value);
  const missing = structuredClone(value); missing.contexts[1]!.packageBindings[0]!.artifactKey = `sha256:${"e".repeat(64)}`;
  assert.throws(() => validatePortableWorkSpec(missing), /context.packageBindings/);
  const duplicateName = structuredClone(value);
  duplicateName.contexts[0]!.configuration.packages.push({ name: "@example/tools", enabled: false });
  duplicateName.contexts[0]!.packageBindings.push({ name: "@example/tools", artifactKey: duplicateName.piPackageArtifacts[0]!.key });
  assert.throws(() => validatePortableWorkSpec(duplicateName), /context.packages/);
  const missingTree = structuredClone(value); missingTree.piPackageArtifacts[0]!.treeDigest = "e".repeat(64);
  assert.throws(() => validatePortableWorkSpec(missingTree), /blob.tree/);
});
test("manifest rejects unknown fields, versions and unsafe integers", () => {
  assert.throws(() => validatePortableWorkSpec({ ...manifest(), formatVersion: 2 }), { code: "PACKAGE_FORMAT_UNSUPPORTED" });
  assert.throws(() => validatePortableWorkSpec({ ...manifest(), ownerId: "user-other" }));
  for (const edit of [
    (value: PortableWorkSpec) => { value.blobs[0]!.size = Number.MAX_SAFE_INTEGER + 1; },
    (value: PortableWorkSpec) => { value.contexts[0]!.configuration.resources.memoryBytes = Infinity; },
    (value: PortableWorkSpec) => { value.blobs[0]!.kinds.reverse(); },
  ]) { const value = manifest(); edit(value); assert.throws(() => validatePortableWorkSpec(value)); }
});
test("duplicate keys and dangling manifest references fail", () => {
  for (const edit of [
    (value: PortableWorkSpec) => value.contexts.push(value.contexts[0]!),
    (value: PortableWorkSpec) => value.images.push(value.images[0]!),
    (value: PortableWorkSpec) => value.bindings.models.push(value.bindings.models[0]!),
    (value: PortableWorkSpec) => { value.activeContext = "c-missing"; },
    (value: PortableWorkSpec) => { value.desiredContext = "c-missing"; },
    (value: PortableWorkSpec) => { value.contexts[0]!.imageKey = "i-missing"; },
    (value: PortableWorkSpec) => { value.contexts[0]!.configuration.modelBindingKey = "m-missing"; },
    (value: PortableWorkSpec) => { value.blobs = []; },
    (value: PortableWorkSpec) => { value.images[0]!.layers = ["b".repeat(64)]; },
    (value: PortableWorkSpec) => { value.contexts[0]!.configuration.mcpServers = [{ serverId: "mcp", transport: "stdio", required: true, requiredServiceKey: "s-missing" }]; },
  ]) { const value = manifest(); edit(value); assert.throws(() => validatePortableWorkSpec(value)); }
});
test("history validates only its envelope and preserves arbitrary original payload strings", () => {
  const history: WorkControlHistory = {
    version: 1, work: { name: "demo", createdAt: "2026-09-23T00:00:00Z" },
    configurationRevisions: [{ revision: 1, contextKey: "c-000001" }],
    operations: [{ id: "operation-000000000001", workId: "work-000000000001", serviceId: null,
      kind: "unknown-historical-label", state: "succeeded", targetVersion: 1,
      requestJson: '{ "oldId": "work-000000000001", "token":"unchanged" }', resultJson: "not JSON", errorJson: null,
      createdAt: "2026-09-23T00:00:00Z", updatedAt: "2026-09-23T00:00:00Z" }], idempotency: [],
  };
  const identities: WorkSourceIdentityMap = { version: 1, sourceWorkId: "work-000000000001",
    contexts: [{ sourceId: "context-000000000001", key: "c-000001" }], services: [],
    operations: [{ sourceId: "operation-000000000001", key: "o-000001" }] };
  assert.equal(Check(WorkControlHistorySchema, history), true);
  assert.equal(validateWorkHistory(manifest(), history, identities).history, history);
  const bad = structuredClone(history); bad.operations[0]!.workId = "work-000000000002";
  assert.throws(() => validateWorkHistory(manifest(), bad, identities));
  assert.throws(() => validateWorkHistory(manifest(), { ...history, futureField: 1 }, identities));
  assert.throws(() => validateWorkHistory(manifest(), history, { ...identities, operations: [] }));
});
test("service revisions and secret binding references form a complete typed graph", () => {
  const value = manifest();
  value.services = [{ key: "s-000001", name: "web", desiredRevision: 1, appliedRevision: null, enabled: false, tombstonedAt: null,
    revisions: [{ revision: 1, createdAt: value.createdAt, imageKey: null,
      definition: normalizeServiceDefinitionInput({ name: "web", image: { reference: "example:captured" }, command: "node", workingDirectory: "/", environment: { constructor: "literal", prototype: "literal" } }) }],
    recovery: { count: 3, windowStartedAt: null, nextRetryAt: null, readySince: null }, sourceObservation: { state: "disabled", lastError: null } }];
  value.quotaReservations.push({ subjectKind: "service", subjectKey: "s-000001", desiredCpuMillis: 250, desiredMemoryBytes: 134217728, serviceSlots: 1, volumeSlots: 0 });
  value.volumes[1].serviceRefKeys.push("s-000001");
  value.contexts[0]!.configuration.mcpServers = [{ serverId: "web", transport: "streamable-http", required: true,
    requiredServiceKey: "s-000001", secretRefs: [{ bindingKey: "k-000001" }] }];
  value.bindings.secrets = [{ key: "k-000001", uses: [{ contextKey: "c-000001", serverId: "web", key: null }] }];
  assert.equal(validatePortableWorkSpec(value), value);
  const duplicate = structuredClone(value); duplicate.services.push(duplicate.services[0]!);
  assert.throws(() => validatePortableWorkSpec(duplicate));
  const missing = structuredClone(value); missing.services[0]!.desiredRevision = 2;
  assert.throws(() => validatePortableWorkSpec(missing));
  const secret = structuredClone(value); secret.bindings.secrets[0]!.uses[0]!.serverId = "missing";
  assert.throws(() => validatePortableWorkSpec(secret));
});
test("quota reservations are required for the agent and every retained service without inferred defaults", () => {
  const valid = manifestWithServices();
  valid.services[0]!.enabled = false;
  assert.equal(validatePortableWorkSpec(valid), valid);
  for (const mutate of [
    (value: PortableWorkSpec) => { value.quotaReservations.shift(); },
    (value: PortableWorkSpec) => { value.quotaReservations.pop(); },
    (value: PortableWorkSpec) => { value.quotaReservations.push({ ...value.quotaReservations[2]! }); },
    (value: PortableWorkSpec) => { value.quotaReservations[1]!.subjectKey = "s-missing"; },
    (value: PortableWorkSpec) => { value.quotaReservations[1]!.subjectKind = "agent"; },
    (value: PortableWorkSpec) => { value.quotaReservations[1]!.desiredCpuMillis = -1; },
    (value: PortableWorkSpec) => { value.quotaReservations[1]!.desiredMemoryBytes = Number.MAX_SAFE_INTEGER + 1; },
    (value: PortableWorkSpec) => { value.quotaReservations[1]!.serviceSlots = -1; },
    (value: PortableWorkSpec) => { value.quotaReservations[1]!.volumeSlots = Number.MAX_SAFE_INTEGER + 1; },
  ]) {
    const value = structuredClone(valid); mutate(value);
    assert.throws(() => validatePortableWorkSpec(value), { code: "PACKAGE_INVALID" });
  }
  const old = structuredClone(valid) as unknown as Record<string, unknown>; delete old.quotaReservations;
  assert.throws(() => validatePortableWorkSpec(old), { code: "PACKAGE_INVALID" });
});
test("managed volume references are explicit, sorted and only target retained services", () => {
  const valid = manifestWithServices();
  assert.equal(validatePortableWorkSpec(valid), valid);
  for (const mutate of [
    (value: PortableWorkSpec) => { value.volumes[0].serviceRefKeys.push("s-000001"); },
    (value: PortableWorkSpec) => { value.volumes[1].serviceRefKeys.push("s-000001"); },
    (value: PortableWorkSpec) => { value.volumes[1].serviceRefKeys.reverse(); },
    (value: PortableWorkSpec) => { value.volumes[1].serviceRefKeys.push("s-missing"); },
  ]) {
    const value = structuredClone(valid); mutate(value);
    assert.throws(() => validatePortableWorkSpec(value), { code: "PACKAGE_INVALID" });
  }
  const old = structuredClone(valid) as unknown as { volumes: Array<Record<string, unknown>> };
  delete old.volumes[1]!.serviceRefKeys;
  assert.throws(() => validatePortableWorkSpec(old), { code: "PACKAGE_INVALID" });
});
test("snapshot requests reject unknown fields and validate idempotency UTF-8 byte limits", () => {
  assert.equal(Check(ExportWorkRequestSchema, { idempotencyKey: "ok" }), true);
  assert.equal(Check(ExportWorkRequestSchema, { idempotencyKey: "ok", autoStop: true }), false);
  assert.equal(Check(ImportWorkRequestSchema, { packageId: "package-000000000001", name: "demo", idempotencyKey: "ok" }), true);
  assert.equal(Check(ImportWorkRequestSchema, { packageId: "package-000000000001", idempotencyKey: "ok" }), true);
  assert.equal(Check(ImportWorkRequestSchema, { packageId: "package-000000000001", bindings: { models: {}, secrets: {} }, idempotencyKey: "ok" }), false);
  assert.deepEqual(normalizeWorkImportBindings({}), { models: {}, secrets: {} });
  assert.throws(() => normalizeWorkImportBindings({ secrets: null }));
  assert.throws(() => normalizeWorkImportBindings({ plaintext: "secret" }));
  assert.throws(() => normalizeWorkImportBindings({ models: { "bad key": "model-000000000001" } }));
  for (const key of ["", " ", "a\0b", "界".repeat(86)]) assert.throws(() => validateSnapshotIdempotencyKey(key));
  assert.equal(validateSnapshotIdempotencyKey(" key "), " key ");
});
