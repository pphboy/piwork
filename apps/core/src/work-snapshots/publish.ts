import { validateWorkHistory, type WorkControlHistory, type WorkSourceIdentityMap } from "@piwork/contracts";
import { CoreStore } from "@piwork/core-store";
import { managedVolumeName } from "@piwork/runtime-docker";
import type { VerifiedWorkPackage } from "@piwork/work-package";
import { operationEnvelope } from "../work-management/diagnostics.js";
import type { ImportedImageSelection, PreparedImportedContexts } from "./import-contexts.js";
import type { WorkIdentityTargets } from "./metadata.js";

export interface StagedImportVolume { readonly role: "agent-private" | "workspace"; readonly id: string; readonly runtimeName: string }
function invalid(field: string): never { throw Object.assign(new Error(`Invalid staged Work import: ${field}`), { code: "PACKAGE_INVALID", field }); }
function byKey<T extends { key: string }>(entries: readonly T[]): Map<string, T> {
  const map = new Map(entries.map((entry) => [entry.key, entry]));
  if (map.size !== entries.length) invalid("identityMap");
  return map;
}

/** SQL-only visibility boundary. All Docker/filesystem artifacts must already be durable and verified. */
export function publishImportedWork(input: {
  readonly store: CoreStore; readonly operationId: string; readonly epoch: number;
  readonly verified: VerifiedWorkPackage; readonly targets: WorkIdentityTargets;
  readonly prepared: PreparedImportedContexts; readonly images: ReadonlyMap<string, ImportedImageSelection>;
  readonly volumes: readonly StagedImportVolume[]; readonly installationId: string; readonly now: string;
  readonly revalidateBindings: () => void;
}): string {
  const { store, operationId, epoch, verified, targets, prepared, images, volumes, installationId, now } = input;
  const job = store.snapshots.getJob(operationId);
  if (!job || job.kind !== "import" || job.targetWorkId !== targets.workId || !job.name || job.packageId === null) invalid("job");
  const spec = verified.spec;
  const history = verified.metadata.get(spec.history.control) as WorkControlHistory | undefined;
  const identities = verified.metadata.get(spec.history.sourceIdentityMap) as WorkSourceIdentityMap | undefined;
  const checked = validateWorkHistory(spec, history, identities);
  const contexts = byKey(prepared.contexts), targetContexts = byKey(targets.contexts), targetServices = byKey(targets.services), targetOperations = byKey(targets.operations);
  if (contexts.size !== spec.contexts.length || targetContexts.size !== spec.contexts.length || spec.contexts.some((context) => !contexts.has(context.key) || !targetContexts.has(context.key))
    || targetServices.size !== spec.services.length || spec.services.some((service) => !targetServices.has(service.key))
    || targetOperations.size !== checked.history.operations.length || checked.identities.operations.some((source) => !targetOperations.has(source.key))) invalid("targets");
  if (images.size !== spec.images.length || spec.images.some((image) => images.get(image.key)?.identity !== image.imageId)) invalid("images");
  if (volumes.length !== 2 || new Set(volumes.map((volume) => volume.role)).size !== 2) invalid("volumes");
  for (const volume of volumes) {
    const logicalId = volume.role === "agent-private" ? "work-private" : "work-workspace";
    if (volume.runtimeName !== managedVolumeName(installationId, targets.workId, logicalId) || !/^volume-[a-zA-Z0-9-]+$/.test(volume.id)) invalid("volumes.identity");
  }
  const revisions = prepared.contexts.map((context) => context.revision);
  if (new Set(revisions).size !== revisions.length || !revisions.every((revision) => Number.isSafeInteger(revision) && revision > 0)) invalid("revisions");
  const desiredRevision = Math.max(...revisions), activeRevision = spec.activeContext === null ? null : contexts.get(spec.activeContext)?.revision ?? invalid("activeContext");
  if (prepared.desiredContextId !== targetContexts.get(spec.desiredContext)?.id
    || prepared.activeContextId !== (spec.activeContext === null ? null : targetContexts.get(spec.activeContext)?.id)) invalid("contexts");
  return store.snapshots.withFence(operationId, epoch, (tx) => {
    input.revalidateBindings();
    const current = store.snapshots.getJob(operationId);
    if (!current || current.kind !== "import" || current.targetWorkId !== targets.workId || current.ownerUserId !== job.ownerUserId
      || current.name !== job.name || current.packageId !== job.packageId) invalid("job.fence");
    const identityJournal = store.snapshots.listArtifacts(operationId).find((item) => item.artifactKey === "identity-map");
    if (identityJournal?.kind !== "identity-map" || identityJournal.state !== "ready" || identityJournal.logicalId !== JSON.stringify(targets)) invalid("identityJournal");
    const hold = store.snapshots.getName(job.ownerUserId, job.name!);
    if (hold?.operationId !== operationId) invalid("nameHold");
    const temporary = store.getQuotaReservation(targets.workId, "import", "import");
    if (!temporary) invalid("quotaHold");
    const cpu = spec.quotaReservations.reduce((sum, row) => sum + row.desiredCpuMillis, 0);
    const memory = spec.quotaReservations.reduce((sum, row) => sum + row.desiredMemoryBytes, 0);
    if (temporary.desiredCpuMillis !== cpu || temporary.desiredMemoryBytes !== memory || temporary.occupiedCpuMillis !== 0 || temporary.occupiedMemoryBytes !== 0) invalid("quotaHold");
    tx.run(`INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,active_revision,control_version,created_at,updated_at)
      VALUES (?,?,?,'stopped','stopped',?,?,1,?,?)`, targets.workId, job.ownerUserId, job.name, desiredRevision, activeRevision, now, now);
    tx.assignWorkNetworkName(targets.workId, now);
    for (const image of spec.images) {
      const selection = images.get(image.key)!;
      store.snapshots.insertOwnedImage({ workId: targets.workId, selectionId: selection.selectionId, imageIdentity: image.imageId, sourceReference: image.imageId });
    }
    for (const context of prepared.contexts) {
      const configJson = JSON.stringify(context.configuration);
      tx.run(`INSERT INTO work_config_revisions(work_id,revision,config_json,resolved_image_digest,created_by_user_id,created_at,runtime_profile_json,source_runtime_revision)
        VALUES (?,?,?,?,?,?,?,?)`, targets.workId, context.revision, configJson, context.snapshot.metadata.imageIdentity,
        job.ownerUserId, now, context.runtimeProfileJson, context.sourceRuntimeRevision);
      tx.run(`INSERT INTO work_context_snapshots(snapshot_id,work_id,internal_revision,configuration_json,image_identity,created_by_user_id,created_at)
        VALUES (?,?,?,?,?,?,?)`, context.snapshot.snapshotId, targets.workId, context.revision, configJson,
        context.snapshot.metadata.imageIdentity, job.ownerUserId, now);
    }
    tx.run("UPDATE works SET desired_context_id = ?, active_context_id = ? WHERE id = ?", prepared.desiredContextId, prepared.activeContextId, targets.workId);
    for (const service of spec.services) {
      const serviceId = targetServices.get(service.key)!.id;
      for (const revision of service.revisions) {
        const image = revision.imageKey === null ? null : images.get(revision.imageKey)?.identity ?? invalid("service.image");
        tx.run("INSERT INTO service_revisions(work_id,service_id,revision,definition_json,resolved_image_digest,created_at) VALUES (?,?,?,?,?,?)",
          targets.workId, serviceId, revision.revision, JSON.stringify({ ...revision.definition, serviceId, revision: revision.revision }), image, revision.createdAt);
      }
      tx.run(`INSERT INTO service_heads(work_id,service_id,name,desired_revision,applied_revision,enabled,observed_state,tombstoned_at,last_error_json)
        VALUES (?,?,?,?,?,?,?,?,NULL)`, targets.workId, serviceId, service.name, service.desiredRevision, service.appliedRevision,
        service.enabled && service.tombstonedAt === null ? 1 : 0, service.tombstonedAt !== null || !service.enabled ? "disabled" : "stopped", service.tombstonedAt);
      tx.assignServiceDomainLabel(targets.workId, serviceId, service.name, now);
      const selectedRevision = service.appliedRevision ?? service.desiredRevision;
      const selected = service.revisions.find((revision) => revision.revision === selectedRevision)!;
      tx.run(`INSERT INTO service_runtime_bindings(work_id,service_id,revision,container_id,image_identity,recovery_count,recovery_window_started_at,next_retry_at,ready_since,updated_at)
        VALUES (?,?,?,NULL,?,?,?,?,?,?)`, targets.workId, serviceId, selectedRevision,
        selected.imageKey === null ? null : images.get(selected.imageKey)?.identity ?? invalid("service.image"),
        service.recovery.count, service.recovery.windowStartedAt, service.recovery.nextRetryAt, service.recovery.readySince, now);
    }
    tx.run("DELETE FROM quota_reservations WHERE work_id = ? AND subject_kind = 'import' AND subject_id = 'import'", targets.workId);
    for (const quota of spec.quotaReservations) {
      const subjectId = quota.subjectKind === "agent" ? "agentd" : targetServices.get(quota.subjectKey)?.id ?? invalid("quota.service");
      tx.run(`INSERT INTO quota_reservations(work_id,subject_kind,subject_id,desired_cpu_millis,desired_memory_bytes,
        occupied_cpu_millis,occupied_memory_bytes,service_slots,volume_slots,updated_at)
        VALUES (?,?,?,?,?,0,0,?,?,?)`, targets.workId, quota.subjectKind, subjectId, quota.desiredCpuMillis, quota.desiredMemoryBytes,
        quota.serviceSlots, quota.volumeSlots, now);
    }
    for (const volume of volumes) {
      const references = volume.role === "agent-private" ? [] : spec.volumes[1].serviceRefKeys;
      tx.run(`INSERT INTO volume_records(id,installation_id,work_id,service_id,volume_role,runtime_name,state,reference_count,retained_at,purged_at,created_at)
        VALUES (?,?,?,NULL,?,?,'active',?,NULL,NULL,?)`, volume.id, installationId, targets.workId, volume.role, volume.runtimeName, references.length + 1, now);
      tx.run("INSERT INTO volume_references(volume_id,consumer_kind,consumer_id,created_at) VALUES (?,'work',?,?)", volume.id, targets.workId, now);
      for (const key of references) tx.run("INSERT INTO volume_references(volume_id,consumer_kind,consumer_id,created_at) VALUES (?,'service',?,?)",
        volume.id, targetServices.get(key)?.id ?? invalid("volume.service"), now);
    }
    for (const operation of checked.history.operations) {
      const key = checked.identities.operations.find((entry) => entry.sourceId === operation.id)?.key;
      const target = key === undefined ? undefined : targetOperations.get(key);
      if (!target) invalid("history.operation");
      store.snapshots.insertHistory({ workId: targets.workId, operationId: target.id, sourceOperationId: operation.id, recordJson: JSON.stringify(operation) });
    }
    store.snapshots.insertProvenance({ workId: targets.workId, packageDigest: verified.digest, importOperationId: operationId,
      identityMapJson: JSON.stringify({ sourceIdentityMap: checked.identities, targets, archivedIdempotency: checked.history.idempotency }) });
    store.snapshots.releaseReservations(operationId, epoch);
    tx.run("UPDATE snapshot_jobs SET phase = 'succeeded', updated_at = ? WHERE operation_id = ?", now, operationId);
    tx.run("UPDATE operations SET state = 'succeeded', result_json = ?, updated_at = ? WHERE id = ?",
      operationEnvelope({ correlationId: operationId, result: { observedState: "stopped" } }), now, operationId);
    return targets.workId;
  });
}
