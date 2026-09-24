import { randomUUID } from "node:crypto";
import { Check } from "typebox/value";
import { ArchivedWorkOperationSchema, SafeDiagnosticSchema, WorkPackageValidationError,
  type PortableWorkConfiguration, type PortableWorkService, type PortableWorkQuotaReservation, type WorkBindingRequirements, type WorkConfig,
  type WorkControlHistory, type WorkSourceIdentityMap, type ServiceDefinition } from "@piwork/contracts";
import { CoreStore, type VolumeRecord, type WorkRecord } from "@piwork/core-store";
import { managedVolumeName } from "@piwork/runtime-docker";
import { WorkContextStore, type WorkContextSnapshot } from "../configuration/work-context.js";

type HistoryOperation = WorkControlHistory["operations"][number];
type HistoryIdempotency = WorkControlHistory["idempotency"][number];
export interface WorkIdentityTargets {
  readonly workId: string;
  readonly contexts: readonly { readonly key: string; readonly id: string }[];
  readonly services: readonly { readonly key: string; readonly id: string }[];
  readonly operations: readonly { readonly key: string; readonly id: string }[];
}
export interface WorkProvenanceArchive {
  readonly sourceIdentityMap: WorkSourceIdentityMap;
  readonly targets: WorkIdentityTargets;
  readonly archivedIdempotency: readonly HistoryIdempotency[];
}
export interface SnapshotContextSource {
  readonly key: string; readonly snapshot: WorkContextSnapshot; readonly configuration: PortableWorkConfiguration; readonly imageKey: string;
}
export interface WorkSnapshotMetadata {
  readonly work: WorkRecord; readonly contexts: readonly SnapshotContextSource[]; readonly services: PortableWorkService[];
  readonly quotaReservations: PortableWorkQuotaReservation[];
  readonly volumes: readonly { readonly role: "agent-private" | "workspace"; readonly record: VolumeRecord; readonly serviceRefKeys: string[] }[];
  readonly activeContext: string | null; readonly desiredContext: string;
  readonly images: readonly { readonly key: string; readonly imageId: string }[];
  readonly bindings: WorkBindingRequirements; readonly history: WorkControlHistory; readonly identities: WorkSourceIdentityMap;
}
function invalid(field: string): never { throw new WorkPackageValidationError("PACKAGE_INVALID", field); }
function storageUnsupported(field: string): never { throw Object.assign(new Error(`Snapshot storage unsupported: ${field}`), { code: "SNAPSHOT_STORAGE_UNSUPPORTED", field }); }
const compare = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
function logicalKeys(ids: Iterable<string>, prefix: string): Map<string, string> {
  return new Map([...new Set(ids)].sort(compare).map((id, index) => [id, `${prefix}-${String(index + 1).padStart(6, "0")}`]));
}
function entries(map: ReadonlyMap<string, string>): Array<{ sourceId: string; key: string }> { return [...map].map(([sourceId, key]) => ({ sourceId, key })); }

export function allocateWorkIdentity(identities: WorkSourceIdentityMap, targetWorkId: string, id: () => string = randomUUID): WorkIdentityTargets {
  return { workId: targetWorkId, contexts: identities.contexts.map(({ key }) => ({ key, id: `context-${id()}` })),
    services: identities.services.map(({ key }) => ({ key, id: `service-${id()}` })), operations: identities.operations.map(({ key }) => ({ key, id: `operation-${id()}` })) };
}

/** Internal, scoped reads only. User operation JSON remains opaque and is never dispatched. */
export function collectWorkSnapshotMetadata(store: CoreStore, contextStore: WorkContextStore, workId: string, currentExportOperationId: string, installationId: string): WorkSnapshotMetadata {
  return store.readSnapshot(() => collectWorkSnapshotMetadataInTransaction(store, contextStore, workId, currentExportOperationId, installationId));
}

function collectWorkSnapshotMetadataInTransaction(store: CoreStore, contextStore: WorkContextStore, workId: string, currentExportOperationId: string, installationId: string): WorkSnapshotMetadata {
  const work = store.getWork(workId), configurationState = store.getWorkConfiguration(workId);
  if (!work || !configurationState || configurationState.desiredContextId === null) invalid("work.context");
  const contextRecords = store.listWorkContextSnapshots(workId).sort((a, b) => compare(a.snapshotId, b.snapshotId));
  const revisions = store.listWorkConfigRevisions(workId);
  const contextKeys = logicalKeys(contextRecords.map((record) => record.snapshotId), "c");
  const revisionContexts = new Map(contextRecords.map((record) => [record.internalRevision, contextKeys.get(record.snapshotId)!]));
  if (contextRecords.length !== revisions.length || revisionContexts.has(null) || revisionContexts.size !== revisions.length || revisions.some((revision) => !revisionContexts.has(revision.revision))) invalid("history.configurationRevisions");
  const serviceRecords = store.listServices(workId, true).sort((a, b) => compare(a.serviceId, b.serviceId));
  const serviceKeys = logicalKeys(serviceRecords.map((service) => service.serviceId), "s");
  const quotaRows = store.listQuotaReservations(workId);
  if (quotaRows.length !== serviceRecords.length + 1) invalid("quotaReservations");
  const quotaReservations: PortableWorkQuotaReservation[] = [];
  const portableQuota = (row: typeof quotaRows[number], subjectKind: "agent" | "service", subjectKey: string): PortableWorkQuotaReservation => {
    if (row.subjectKind !== subjectKind || row.workId !== workId) invalid("quotaReservations.subject");
    for (const value of [row.desiredCpuMillis, row.desiredMemoryBytes, row.serviceSlots, row.volumeSlots]) if (!Number.isSafeInteger(value) || value < 0) invalid("quotaReservations.value");
    return { subjectKind, subjectKey, desiredCpuMillis: row.desiredCpuMillis, desiredMemoryBytes: row.desiredMemoryBytes,
      serviceSlots: row.serviceSlots, volumeSlots: row.volumeSlots };
  };
  const agentRows = quotaRows.filter((row) => row.subjectKind === "agent" && row.subjectId === "agentd");
  if (agentRows.length !== 1) invalid("quotaReservations.agent");
  quotaReservations.push(portableQuota(agentRows[0]!, "agent", "agentd"));
  for (const service of serviceRecords) {
    const rows = quotaRows.filter((row) => row.subjectKind === "service" && row.subjectId === service.serviceId);
    if (rows.length !== 1) invalid("quotaReservations.service");
    quotaReservations.push(portableQuota(rows[0]!, "service", serviceKeys.get(service.serviceId)!));
  }
  const volumeRecords = store.listVolumeRecords(workId), volumeReferences = store.listVolumeReferences(workId);
  if (volumeRecords.length !== 2) storageUnsupported("volumes.count");
  const volumes = (["agent-private", "workspace"] as const).map((role) => {
    const records = volumeRecords.filter((record) => record.volumeRole === role);
    if (records.length !== 1) storageUnsupported(`volumes.${role}`);
    const record = records[0]!;
    const logicalId = role === "agent-private" ? "work-private" : "work-workspace";
    if (record.workId !== workId || record.installationId !== installationId || record.serviceId !== null || record.state !== "active"
      || record.purgedAt !== null || record.runtimeName !== managedVolumeName(installationId, workId, logicalId)) storageUnsupported(`volumes.${role}.identity`);
    const references = volumeReferences.filter((reference) => reference.volumeId === record.id);
    if (record.referenceCount !== references.length) storageUnsupported(`volumes.${role}.referenceCount`);
    const workReferences = references.filter((reference) => reference.consumerKind === "work" && reference.consumerId === workId);
    if (workReferences.length !== 1) storageUnsupported(`volumes.${role}.workReference`);
    const serviceRefKeys: string[] = [];
    for (const reference of references) {
      if (reference.consumerKind === "work" && reference.consumerId === workId) continue;
      if (role !== "workspace" || reference.consumerKind !== "service") storageUnsupported(`volumes.${role}.consumer`);
      const key = serviceKeys.get(reference.consumerId);
      if (key === undefined) storageUnsupported(`volumes.${role}.consumer`);
      serviceRefKeys.push(key);
    }
    serviceRefKeys.sort(compare);
    return { role, record, serviceRefKeys };
  });
  const sourceContexts = contextRecords.map((record) => contextStore.load(workId, record.snapshotId));
  const modelKeys = logicalKeys(sourceContexts.map((snapshot) => snapshot.configuration.modelRef), "m");
  const secretKeys = logicalKeys(sourceContexts.flatMap((snapshot) => snapshot.configuration.mcpServers.flatMap((server) => (server.secretRefs ?? []).map((secret) => secret.secretId))), "b");
  const allServiceRevisions = new Map(serviceRecords.map((service) => [service.serviceId, store.listServiceRevisions(workId, service.serviceId)]));
  const imageKeys = logicalKeys([...contextRecords.map((record) => record.imageIdentity), ...[...allServiceRevisions.values()].flatMap((items) => items.flatMap((item) => item.resolvedImageDigest === null ? [] : [item.resolvedImageDigest]))], "i");
  const models = new Map<string, WorkBindingRequirements["models"][number]>();
  const secrets = new Map<string, WorkBindingRequirements["secrets"][number]>([...secretKeys.values()].map((key) => [key, { key, uses: [] }]));
  const contexts = sourceContexts.map((snapshot, index): SnapshotContextSource => {
    const record = contextRecords[index]!, key = contextKeys.get(record.snapshotId)!;
    const revision = revisions.find((value) => value.revision === record.internalRevision)!;
    if (snapshot.metadata.imageIdentity !== record.imageIdentity || JSON.stringify(snapshot.configuration) !== record.configurationJson || record.configurationJson !== revision.configJson) invalid("context.configuration");
    if (revision.runtimeProfileJson === null) invalid("context.model");
    const profile = JSON.parse(revision.runtimeProfileJson) as { model?: { provider?: unknown; id?: unknown; baseUrl?: unknown } };
    const model = profile.model;
    if (!model || typeof model.provider !== "string" || !model.provider || typeof model.id !== "string" || !model.id || (model.baseUrl !== undefined && typeof model.baseUrl !== "string")) invalid("context.model");
    const modelBindingKey = modelKeys.get(snapshot.configuration.modelRef)!;
    const requirement = { key: modelBindingKey, provider: model.provider, model: model.id, baseUrl: model.baseUrl as string | undefined ?? null };
    const existing = models.get(modelBindingKey); if (existing && JSON.stringify(existing) !== JSON.stringify(requirement)) invalid("context.model"); models.set(modelBindingKey, requirement);
    const { agentImage: _image, modelRef: _model, agentsMd: _agents, mcpServers, ...configuration } = snapshot.configuration;
    return { key, snapshot, imageKey: imageKeys.get(record.imageIdentity)!, configuration: { ...configuration, modelBindingKey,
      mcpServers: mcpServers.map(({ requiredServiceId, secretRefs, ...server }) => ({ ...server,
        ...(requiredServiceId === undefined ? {} : { requiredServiceKey: serviceKeys.get(requiredServiceId) ?? invalid("context.requiredService") }),
        ...(secretRefs === undefined ? {} : { secretRefs: secretRefs.map(({ secretId, key: secretKey }) => {
          const bindingKey = secretKeys.get(secretId)!; secrets.get(bindingKey)!.uses.push({ contextKey: key, serverId: server.serverId, key: secretKey ?? null });
          return { bindingKey, ...(secretKey === undefined ? {} : { key: secretKey }) };
        }) }),
      })),
    } };
  });
  const services = serviceRecords.map((record): PortableWorkService => {
    const binding = store.getServiceRuntimeBinding(workId, record.serviceId);
    const lastError: unknown = record.lastErrorJson === null ? null : JSON.parse(record.lastErrorJson);
    if (lastError !== null && !Check(SafeDiagnosticSchema, lastError)) invalid("service.lastError");
    return { key: serviceKeys.get(record.serviceId)!, name: record.name, desiredRevision: record.desiredRevision, appliedRevision: record.appliedRevision,
      enabled: record.enabled, tombstonedAt: record.tombstonedAt,
      revisions: allServiceRevisions.get(record.serviceId)!.map((revision) => {
        const { serviceId: _id, revision: _revision, ...definition } = JSON.parse(revision.definitionJson) as ServiceDefinition;
        return { revision: revision.revision, createdAt: revision.createdAt, definition, imageKey: revision.resolvedImageDigest === null ? null : imageKeys.get(revision.resolvedImageDigest)! };
      }),
      recovery: { count: binding?.recoveryCount ?? 0, windowStartedAt: binding?.recoveryWindowStartedAt ?? null, nextRetryAt: binding?.nextRetryAt ?? null, readySince: binding?.readySince ?? null },
      sourceObservation: { state: record.observedState, lastError: lastError as PortableWorkService["sourceObservation"]["lastError"] },
    };
  });
  const operations = new Map<string, HistoryOperation>();
  for (const operation of store.listWorkControlOperations(workId)) {
    if (operation.id === currentExportOperationId) continue;
    if (operation.workId !== null && operation.workId !== workId) invalid("history.scope");
    if (operation.state === "pending" || operation.state === "running") throw Object.assign(new Error("SNAPSHOT_WORK_BUSY"), { code: "SNAPSHOT_WORK_BUSY" });
    const record = { ...operation, workId };
    if (!Check(ArchivedWorkOperationSchema, record)) invalid("history.operation");
    operations.set(operation.id, record as HistoryOperation);
  }
  const idempotency: Array<HistoryIdempotency & { principalOrigin: string }> = [];
  for (const record of store.listWorkControlIdempotency(workId)) {
    if (record.operationId === currentExportOperationId) continue;
    const { principalId, ...rest } = record;
    idempotency.push({ ...rest, principalKey: "", principalOrigin: `live:${principalId}`, principalKind: principalId === work.ownerUserId ? "owner" : principalId === `work-agent:${workId}` ? "agent" : "admin" });
  }
  const provenance = store.snapshots.getProvenance(workId), imported = store.snapshots.listHistory(workId);
  if (imported.length > 0 && !provenance) invalid("history.provenance");
  if (provenance) {
    const archive = JSON.parse(provenance.identityMapJson) as WorkProvenanceArchive;
    if (archive.targets.workId !== workId) invalid("history.provenance");
    const map = (kind: "contexts" | "services" | "operations") => new Map(archive.sourceIdentityMap[kind].map(({ sourceId, key }) => [sourceId, archive.targets[kind].find((target) => target.key === key)?.id ?? invalid("history.provenance")]));
    const oldServices = map("services"), oldOperations = map("operations");
    const resource = (id: string) => id === archive.sourceIdentityMap.sourceWorkId ? workId : oldServices.get(id) ?? invalid("history.provenance");
    for (const item of imported) {
      const record: unknown = JSON.parse(item.recordJson);
      if (!Check(ArchivedWorkOperationSchema, record)) invalid("history.operation");
      const source = record as HistoryOperation;
      if (source.id !== item.sourceOperationId || oldOperations.get(source.id) !== item.operationId || operations.has(item.operationId)) invalid("history.provenance");
      operations.set(item.operationId, { ...source, id: item.operationId, workId, serviceId: source.serviceId === null ? null : oldServices.get(source.serviceId) ?? invalid("history.provenance") });
    }
    for (const record of archive.archivedIdempotency) idempotency.push({ ...record, principalOrigin: `imported:${provenance.importOperationId}:${record.principalKey}`,
      resourceId: resource(record.resourceId), operationId: oldOperations.get(record.operationId) ?? invalid("history.provenance"),
      workScope: record.workScope === archive.sourceIdentityMap.sourceWorkId ? workId : record.workScope,
    });
  }
  const principals = logicalKeys(idempotency.map((record) => record.principalOrigin), "p");
  const archivedIdempotency = idempotency.map(({ principalOrigin, ...record }) => ({ ...record, principalKey: principals.get(principalOrigin)! }));
  archivedIdempotency.sort((a, b) => { for (const key of ["principalKey", "workScope", "operationKind", "idempotencyKey"] as const) { const difference = compare(a[key], b[key]); if (difference) return difference; } return 0; });
  const operationKeys = logicalKeys(operations.keys(), "o");
  return { work, contexts, services, quotaReservations, volumes, images: [...imageKeys].map(([imageId, key]) => ({ imageId, key })),
    activeContext: configurationState.activeContextId === null ? null : contextKeys.get(configurationState.activeContextId) ?? invalid("work.activeContext"),
    desiredContext: contextKeys.get(configurationState.desiredContextId) ?? invalid("work.desiredContext"),
    bindings: { models: [...models.values()].sort((a, b) => compare(a.key, b.key)), secrets: [...secrets.values()] },
    history: { version: 1, work: { name: work.name, createdAt: work.createdAt }, configurationRevisions: revisions.map((revision) => ({ revision: revision.revision, contextKey: revisionContexts.get(revision.revision)! })),
      operations: [...operations.values()].sort((a, b) => compare(a.id, b.id)), idempotency: archivedIdempotency },
    identities: { version: 1, sourceWorkId: workId, contexts: entries(contextKeys), services: entries(serviceKeys), operations: entries(operationKeys) },
  };
}

export function restorePortableConfiguration(configuration: PortableWorkConfiguration, agentsMd: string, modelRef: string, imageSelectionId: string,
  services: ReadonlyMap<string, string>, secrets: ReadonlyMap<string, string>): WorkConfig {
  const { modelBindingKey: _model, mcpServers, ...rest } = configuration;
  return { ...rest, agentsMd, modelRef, agentImage: { catalogId: imageSelectionId },
    mcpServers: mcpServers.map(({ requiredServiceKey, secretRefs, ...server }) => ({ ...server,
      ...(requiredServiceKey === undefined ? {} : { requiredServiceId: services.get(requiredServiceKey) ?? invalid("bindings.service") }),
      ...(secretRefs === undefined ? {} : { secretRefs: secretRefs.map(({ bindingKey, key }) => ({ secretId: secrets.get(bindingKey) ?? invalid("bindings.secret"), ...(key === undefined ? {} : { key }) })) }),
    })),
  };
}
