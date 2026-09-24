import { createHash, randomUUID } from "node:crypto";
import { Check } from "typebox/value";
import {
  ExportWorkRequestSchema, ImportWorkRequestSchema, validateSnapshotIdempotencyKey,
  type AcceptedWorkExport, type AcceptedWorkImport, type ImportWorkRequest,
  type WorkSourceIdentityMap,
} from "@piwork/contracts";
import { CoreStore, IdempotencyConflictError } from "@piwork/core-store";
import { encodeWorkJson, type VerifiedWorkPackage } from "@piwork/work-package";
import type { RuntimeProfileStore } from "../configuration/runtime-profile.js";
import type { UserPrincipal } from "../work-access/policy.js";
import { authorizeSnapshotOwner } from "./access.js";
import { autoResolveWorkBindings } from "./bindings.js";
import { allocateWorkIdentity } from "./metadata.js";

export class SnapshotAdmissionError extends Error {
  constructor(readonly code: "SNAPSHOT_REQUIRES_STOPPED" | "WORK_BUSY" | "PACKAGE_EXPIRED" | "PACKAGE_NOT_READY" | "PACKAGE_INVALID" | "QUOTA_EXCEEDED") {
    super(code); this.name = "SnapshotAdmissionError";
  }
}
const digest = (value: unknown) => createHash("sha256").update(encodeWorkJson(value)).digest("hex");
const deadline = (now: string) => new Date(Date.parse(now) + 30 * 60_000).toISOString();
function fail(code: SnapshotAdmissionError["code"]): never { throw new SnapshotAdmissionError(code); }
function availableName(store: CoreStore, ownerUserId: string, sourceName: string): string {
  for (let number = 1; number < Number.MAX_SAFE_INTEGER; number++) {
    const suffix = number === 1 ? "" : `-${number}`;
    const base = Array.from(sourceName).slice(0, 128 - suffix.length);
    let candidate = `${base.join("")}${suffix}`;
    while (base.length && !Check(ImportWorkRequestSchema, { packageId: "package-000000000001", name: candidate, idempotencyKey: "candidate" })) {
      base.pop(); candidate = `${base.join("")}${suffix}`;
    }
    if (!Check(ImportWorkRequestSchema, { packageId: "package-000000000001", name: candidate, idempotencyKey: "candidate" })) fail("PACKAGE_INVALID");
    try { store.snapshots.assertNameAvailable(ownerUserId, candidate); return candidate; }
    catch (error) { if ((error as { code?: string }).code !== "WORK_NAME_CONFLICT") throw error; }
  }
  return fail("PACKAGE_INVALID");
}
function quotaSum(items: readonly number[]): number {
  const total = items.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total) || total < 0) fail("QUOTA_EXCEEDED");
  return total;
}
export interface SnapshotAdmissionQuotaPolicy {
  readonly hostCpuMillis: number;
  readonly hostMemoryBytes: number;
  readonly hostRetainedVolumeSlots?: number;
}

/** Durable acceptance only. Workers perform capture/restore and publish in separate fenced stages. */
export class WorkSnapshotAdmission {
  constructor(private readonly store: CoreStore, private readonly profiles: Pick<RuntimeProfileStore, "credentialPath">,
    private readonly now: () => Date = () => new Date(),
    private readonly quota: SnapshotAdmissionQuotaPolicy = { hostCpuMillis: 128_000, hostMemoryBytes: 256 * 1_024 ** 3 }) {}

  async export(principal: UserPrincipal, workId: string, request: { idempotencyKey: string }, preflight: () => Promise<void>): Promise<AcceptedWorkExport> {
    if (!Check(ExportWorkRequestSchema, request)) fail("PACKAGE_INVALID");
    const work = this.store.getWork(workId, true);
    authorizeSnapshotOwner(principal, work?.ownerUserId, workId);
    const requestDigest = digest({ workId });
    const prior = this.store.snapshots.findIdempotency(principal.userId, workId, "export-work", request.idempotencyKey);
    if (prior) {
      if (prior.requestDigest !== requestDigest) throw new IdempotencyConflictError(request.idempotencyKey);
      const job = this.store.snapshots.getJob(prior.operationId);
      if (!job?.snapshotId) fail("PACKAGE_INVALID");
      return { workId, snapshotId: job.snapshotId, operationId: prior.operationId, correlationId: prior.operationId, reused: true };
    }
    if (work!.deletedAt !== null || work!.desiredState !== "stopped" || work!.observedState !== "stopped") fail("SNAPSHOT_REQUIRES_STOPPED");
    await preflight();
    const now = this.now().toISOString(), snapshotId = `snapshot-${randomUUID()}`, packageId = `package-${randomUUID()}`;
    const accepted = this.store.snapshots.accept({ principalId: principal.userId, workId, workScope: workId, operationKind: "export-work",
      idempotencyKey: validateSnapshotIdempotencyKey(request.idempotencyKey), requestDigest,
      requestJson: JSON.stringify({ workId }), targetVersion: work!.controlVersion, now }, (tx) => {
      const current = this.store.getWork(workId, true);
      if (!current || current.deletedAt !== null || current.desiredState !== "stopped" || current.observedState !== "stopped") fail("SNAPSHOT_REQUIRES_STOPPED");
      this.store.snapshots.assertNoTransientMutation(workId);
      if (tx.get<{ count: number }>(`SELECT COUNT(*) AS count FROM operations WHERE work_id = ? AND id != ? AND state IN ('pending','running')`, workId, tx.operationId)!.count > 0) fail("WORK_BUSY");
      this.store.snapshots.insertPackage({ id: packageId, ownerUserId: principal.userId, digest: null, size: 0, state: "staging", jobId: null,
        createdAt: now, readyAt: null, expiresAt: null });
      this.store.snapshots.insertJob({ operationId: tx.operationId, ownerUserId: principal.userId, kind: "export", sourceWorkId: workId,
        targetWorkId: null, snapshotId, packageId, name: null, requestDigest, phase: "accepted", deadlineAt: deadline(now),
        workerEpoch: 1, createdAt: now, updatedAt: now, cleanupError: null });
      tx.run("UPDATE snapshot_packages SET job_id = ? WHERE id = ?", tx.operationId, packageId);
      this.store.snapshots.lockWork({ workId, operationId: tx.operationId, workerEpoch: 1 });
      return { resourceId: workId };
    });
    const job = this.store.snapshots.getJob(accepted.operationId)!;
    return { workId, snapshotId: job.snapshotId!, operationId: accepted.operationId, correlationId: accepted.operationId, reused: accepted.reused };
  }

  import(principal: UserPrincipal, request: ImportWorkRequest, verified?: VerifiedWorkPackage): AcceptedWorkImport {
    if (!Check(ImportWorkRequestSchema, request)) fail("PACKAGE_INVALID");
    const packageRecord = this.store.snapshots.getPackage(request.packageId);
    authorizeSnapshotOwner(principal, packageRecord?.ownerUserId, request.packageId);
    if (!packageRecord?.digest) fail("PACKAGE_NOT_READY");
    const requestDigest = digest({ packageDigest: packageRecord.digest, explicitName: request.name ?? null });
    const prior = this.store.snapshots.findIdempotency(principal.userId, "work-imports", "import-work", request.idempotencyKey);
    if (prior) {
      if (prior.requestDigest !== requestDigest) throw new IdempotencyConflictError(request.idempotencyKey);
      const job = this.store.snapshots.getJob(prior.operationId);
      if (!job?.name) fail("PACKAGE_INVALID");
      return { workId: prior.resourceId, name: job.name, operationId: prior.operationId, correlationId: prior.operationId, reused: true };
    }
    if (packageRecord.state === "expired" || (packageRecord.expiresAt !== null && packageRecord.expiresAt <= this.now().toISOString())) fail("PACKAGE_EXPIRED");
    if (packageRecord.state !== "ready") fail("PACKAGE_NOT_READY");
    if (verified === undefined || packageRecord.digest !== verified.digest || packageRecord.size !== verified.size) fail("PACKAGE_INVALID");
    const now = this.now().toISOString(), targetWorkId = `work-${randomUUID()}`;
    const accepted = this.store.snapshots.accept({ principalId: principal.userId, workScope: "work-imports", operationKind: "import-work",
      idempotencyKey: validateSnapshotIdempotencyKey(request.idempotencyKey), requestDigest,
      requestJson: JSON.stringify({ packageDigest: verified.digest, explicitName: request.name ?? null }), targetVersion: 1, now }, (tx) => {
      const currentPackage = this.store.snapshots.getPackage(request.packageId);
      if (!currentPackage || currentPackage.ownerUserId !== principal.userId || currentPackage.digest !== verified.digest || currentPackage.size !== verified.size) fail("PACKAGE_INVALID");
      if (currentPackage.state === "expired" || (currentPackage.expiresAt !== null && currentPackage.expiresAt <= now)) fail("PACKAGE_EXPIRED");
      if (currentPackage.state !== "ready") fail("PACKAGE_NOT_READY");
      const resolved = autoResolveWorkBindings(this.store, this.profiles, principal.userId, verified.spec.bindings);
      const name = request.name ?? availableName(this.store, principal.userId, verified.spec.sourceName);
      if (request.name !== undefined) this.store.snapshots.assertNameAvailable(principal.userId, name);
      const desired = verified.spec.contexts.find((context) => context.key === verified.spec.desiredContext);
      if (!desired) fail("PACKAGE_INVALID");
      const policy = desired.configuration.resources;
      const desiredCpu = quotaSum(verified.spec.quotaReservations.map((row) => row.desiredCpuMillis));
      const desiredMemory = quotaSum(verified.spec.quotaReservations.map((row) => row.desiredMemoryBytes));
      if (desiredCpu > policy.cpuMillis || desiredMemory > policy.memoryBytes
        || verified.spec.services.filter((service) => service.tombstonedAt === null).length > policy.maxServices
        || verified.spec.volumes.length > policy.maxRetainedVolumes) fail("QUOTA_EXCEEDED");
      const host = tx.get<{ cpu: number; memory: number }>(`SELECT COALESCE(SUM(MAX(desired_cpu_millis, occupied_cpu_millis)), 0) AS cpu,
        COALESCE(SUM(MAX(desired_memory_bytes, occupied_memory_bytes)), 0) AS memory FROM quota_reservations`)!;
      if (!Number.isSafeInteger(host.cpu) || !Number.isSafeInteger(host.memory) || host.cpu + desiredCpu > this.quota.hostCpuMillis
        || host.memory + desiredMemory > this.quota.hostMemoryBytes) fail("QUOTA_EXCEEDED");
      if (this.quota.hostRetainedVolumeSlots !== undefined) {
        const volumes = tx.get<{ count: number }>("SELECT COUNT(*) AS count FROM volume_records WHERE state != 'purged'")!.count;
        if (volumes + 2 > this.quota.hostRetainedVolumeSlots) fail("QUOTA_EXCEEDED");
      }
      this.store.snapshots.insertJob({ operationId: tx.operationId, ownerUserId: principal.userId, kind: "import", sourceWorkId: null,
        targetWorkId, snapshotId: null, packageId: request.packageId, name, requestDigest, phase: "accepted",
        deadlineAt: deadline(now), workerEpoch: 1, createdAt: now, updatedAt: now, cleanupError: null });
      const sourceIdentities = verified.metadata.get(verified.spec.history.sourceIdentityMap) as WorkSourceIdentityMap | undefined;
      if (!sourceIdentities) fail("PACKAGE_INVALID");
      const targets = allocateWorkIdentity(sourceIdentities, targetWorkId);
      this.store.snapshots.insertArtifact({ operationId: tx.operationId, artifactKey: "identity-map", kind: "identity-map",
        logicalId: JSON.stringify(targets), state: "ready" }, 1);
      this.store.snapshots.insertArtifact({ operationId: tx.operationId, artifactKey: "bindings", kind: "bindings",
        logicalId: JSON.stringify({ bindings: resolved.bindings, models: [...resolved.models] }), state: "ready" }, 1);
      this.store.snapshots.reserveName({ ownerUserId: principal.userId, name, operationId: tx.operationId });
      tx.run(`INSERT INTO quota_reservations(work_id, subject_kind, subject_id, desired_cpu_millis, desired_memory_bytes,
        occupied_cpu_millis, occupied_memory_bytes, service_slots, volume_slots, updated_at)
        VALUES (?, 'import', 'import', ?, ?, 0, 0, 0, 2, ?)`, targetWorkId, desiredCpu, desiredMemory, now);
      return { resourceId: targetWorkId };
    });
    const job = this.store.snapshots.getJob(accepted.operationId);
    if (!job?.name) fail("PACKAGE_INVALID");
    return { workId: accepted.resourceId, name: job.name, operationId: accepted.operationId, correlationId: accepted.operationId, reused: accepted.reused };
  }
}
