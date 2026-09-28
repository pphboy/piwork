import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { acceptMutation, createMutationContext, type AcceptedMutation, type MutationContext, type MutationEffect, type MutationRequest } from "./mutation.js";
import { SnapshotStoreError } from "./snapshot-errors.js";
export { SnapshotStoreError } from "./snapshot-errors.js";

export type SnapshotJobPhase = "accepted" | "verifying" | "capturing" | "sealing" | "restoring" | "publishing" | "succeeded" | "failed" | "cleanup-pending" | "cleaned";
export interface SnapshotJobRecord {
  readonly operationId: string; readonly ownerUserId: string; readonly kind: "export" | "import";
  readonly sourceWorkId: string | null; readonly targetWorkId: string | null; readonly snapshotId: string | null;
  readonly packageId: string | null; readonly name: string | null; readonly requestDigest: string;
  readonly phase: SnapshotJobPhase; readonly deadlineAt: string; readonly workerEpoch: number;
  readonly createdAt: string; readonly updatedAt: string; readonly cleanupError: string | null;
}
export interface SnapshotLockRecord { readonly workId: string; readonly operationId: string; readonly workerEpoch: number }
export interface SnapshotPackageRecord {
  readonly id: string; readonly ownerUserId: string; readonly digest: string | null; readonly size: number;
  readonly state: "staging" | "ready" | "expired" | "deleting"; readonly jobId: string | null;
  readonly createdAt: string; readonly readyAt: string | null; readonly expiresAt: string | null;
}
export interface SnapshotArtifactRecord {
  readonly operationId: string; readonly artifactKey: string; readonly kind: string; readonly logicalId: string;
  readonly state: "planned" | "created" | "ready" | "cleaning" | "cleaned";
}
export interface SnapshotTransferRecord {
  readonly id: string; readonly ownerUserId: string; readonly packageId: string | null; readonly snapshotId: string | null;
  readonly kind: "upload" | "download"; readonly phase: "accepted" | "streaming" | "verifying" | "cleanup-pending";
  readonly deadlineAt: string; readonly lastProgressAt: string; readonly helperId: string | null; readonly createdAt: string;
}
export interface WorkOwnedImageRecord { readonly workId: string; readonly selectionId: string; readonly imageIdentity: string; readonly sourceReference: string }
export interface ImportedWorkHistoryRecord { readonly workId: string; readonly operationId: string; readonly sourceOperationId: string; readonly recordJson: string }
export interface WorkImportProvenanceRecord { readonly workId: string; readonly packageDigest: string; readonly importOperationId: string; readonly identityMapJson: string }
export interface WorkImportNameRecord { readonly ownerUserId: string; readonly name: string; readonly operationId: string }
export interface SnapshotIdempotencyRecord { readonly requestDigest: string; readonly resourceId: string; readonly operationId: string }

const JOB = ["operationId", "ownerUserId", "kind", "sourceWorkId", "targetWorkId", "snapshotId", "packageId", "name", "requestDigest", "phase", "deadlineAt", "workerEpoch", "createdAt", "updatedAt", "cleanupError"] as const;
const PACKAGE = ["id", "ownerUserId", "digest", "size", "state", "jobId", "createdAt", "readyAt", "expiresAt"] as const;
const ARTIFACT = ["operationId", "artifactKey", "kind", "logicalId", "state"] as const;
const TRANSFER = ["id", "ownerUserId", "packageId", "snapshotId", "kind", "phase", "deadlineAt", "lastProgressAt", "helperId", "createdAt"] as const;
const OWNED_IMAGE = ["workId", "selectionId", "imageIdentity", "sourceReference"] as const;
const HISTORY = ["workId", "operationId", "sourceOperationId", "recordJson"] as const;
const PROVENANCE = ["workId", "packageDigest", "importOperationId", "identityMapJson"] as const;
const NAME = ["ownerUserId", "name", "operationId"] as const;
const column = (field: string) => field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const projection = (fields: readonly string[]) => fields.map((field) => `${column(field)} AS ${field}`).join(", ");

/** Shares CoreStore's one SQLite connection, so reservation and publication are one transaction. */
export class SnapshotStore {
  private readonly transientMutations = new Map<string, number>();
  constructor(private readonly database: DatabaseSync) {}
  private insert<T extends object>(table: string, fields: readonly (keyof T & string)[], value: T): void {
    this.database.prepare(`INSERT INTO ${table}(${fields.map(column).join(",")}) VALUES (${fields.map(() => "?").join(",")})`).run(...fields.map((field) => value[field] as SQLInputValue));
  }
  private transaction<T>(effect: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try { const result = effect(); this.database.exec("COMMIT"); return result; }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
  getJob(operationId: string): SnapshotJobRecord | undefined { return this.database.prepare(`SELECT ${projection(JOB)} FROM snapshot_jobs WHERE operation_id = ?`).get(operationId) as unknown as SnapshotJobRecord | undefined; }
  getJobBySnapshot(snapshotId: string): SnapshotJobRecord | undefined { return this.database.prepare(`SELECT ${projection(JOB)} FROM snapshot_jobs WHERE snapshot_id = ?`).get(snapshotId) as unknown as SnapshotJobRecord | undefined; }
  listJobs(activeOnly = false): SnapshotJobRecord[] { return this.database.prepare(`SELECT ${projection(JOB)} FROM snapshot_jobs ${activeOnly ? "WHERE phase NOT IN ('succeeded', 'cleaned')" : ""} ORDER BY created_at, operation_id`).all() as unknown as SnapshotJobRecord[]; }
  insertJob(record: SnapshotJobRecord): void {
    if (this.listJobs(true).length > 0) throw new SnapshotStoreError("SNAPSHOT_CAPACITY_BUSY");
    this.insert("snapshot_jobs", JOB, record);
  }
  accept(request: MutationRequest, effect: (context: MutationContext) => MutationEffect): AcceptedMutation { return acceptMutation(this.database, request, effect); }
  findIdempotency(principalId: string, workScope: string, operationKind: "export-work" | "import-work", key: string): SnapshotIdempotencyRecord | undefined {
    return this.database.prepare(`SELECT request_digest AS requestDigest, resource_id AS resourceId, operation_id AS operationId
      FROM idempotency_records WHERE principal_id = ? AND work_scope = ? AND operation_kind = ? AND idempotency_key = ?`)
      .get(principalId, workScope, operationKind, key) as unknown as SnapshotIdempotencyRecord | undefined;
  }
  getLock(workId: string): SnapshotLockRecord | undefined { return this.database.prepare("SELECT work_id AS workId, operation_id AS operationId, worker_epoch AS workerEpoch FROM work_snapshot_locks WHERE work_id = ?").get(workId) as unknown as SnapshotLockRecord | undefined; }
  assertWorkMutable(workId: string): void { if (this.getLock(workId)) throw new SnapshotStoreError("WORK_SNAPSHOT_BUSY"); }
  /** Covers asynchronous Core -> agentd Session/Run calls; export admission checks it inside its SQLite transaction. */
  beginTransientMutation(workId: string): () => void {
    this.transaction(() => this.assertWorkMutable(workId));
    this.transientMutations.set(workId, (this.transientMutations.get(workId) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.transientMutations.get(workId) ?? 1) - 1;
      if (remaining === 0) this.transientMutations.delete(workId);
      else this.transientMutations.set(workId, remaining);
    };
  }
  assertNoTransientMutation(workId: string): void {
    if ((this.transientMutations.get(workId) ?? 0) > 0) throw new SnapshotStoreError("WORK_SNAPSHOT_BUSY");
  }
  lockWork(record: SnapshotLockRecord): void {
    this.assertWorkMutable(record.workId);
    if (this.database.prepare("SELECT 1 FROM work_file_jobs WHERE work_id = ? AND state != 'cleaned' LIMIT 1").get(record.workId))
      throw new SnapshotStoreError("WORK_BUSY");
    const job = this.assertFence(record.operationId, record.workerEpoch);
    if (job.kind !== "export" || job.sourceWorkId !== record.workId) throw new SnapshotStoreError("SNAPSHOT_RECORD_CONFLICT");
    this.insert("work_snapshot_locks", ["workId", "operationId", "workerEpoch"], record);
  }
  assertFence(operationId: string, epoch: number): SnapshotJobRecord {
    const job = this.getJob(operationId);
    if (!job || job.workerEpoch !== epoch || job.phase === "succeeded" || job.phase === "cleaned") throw new SnapshotStoreError("SNAPSHOT_WORKER_FENCED");
    return job;
  }
  withFence<T>(operationId: string, epoch: number, effect: (context: MutationContext) => T): T {
    return this.transaction(() => { this.assertFence(operationId, epoch); return effect(createMutationContext(this.database, operationId)); });
  }
  updateJobPhase(operationId: string, epoch: number, phase: SnapshotJobPhase, now: string, cleanupError: string | null = null): void {
    this.withFence(operationId, epoch, (context) => { context.run("UPDATE snapshot_jobs SET phase = ?, updated_at = ?, cleanup_error = ? WHERE operation_id = ?", phase, now, cleanupError, operationId); });
  }
  /** Recovery invalidates every old callback before attempting Docker cleanup. */
  fenceWorker(operationId: string, now: string): SnapshotJobRecord {
    return this.transaction(() => {
      const job = this.getJob(operationId); if (!job || job.phase === "succeeded" || job.phase === "cleaned") throw new SnapshotStoreError("SNAPSHOT_WORKER_FENCED");
      this.database.prepare("UPDATE snapshot_jobs SET worker_epoch = worker_epoch + 1, phase = 'cleanup-pending', updated_at = ? WHERE operation_id = ?").run(now, operationId);
      this.database.prepare("UPDATE work_snapshot_locks SET worker_epoch = worker_epoch + 1 WHERE operation_id = ?").run(operationId);
      return this.getJob(operationId)!;
    });
  }
  /** Caller must confirm all journal-owned helpers have exited before invoking this. */
  releaseReservations(operationId: string, epoch: number): void {
    this.assertFence(operationId, epoch);
    this.database.prepare("DELETE FROM work_snapshot_locks WHERE operation_id = ? AND worker_epoch = ?").run(operationId, epoch);
    this.database.prepare("DELETE FROM work_import_names WHERE operation_id = ?").run(operationId);
  }
  insertArtifact(record: SnapshotArtifactRecord, epoch: number): void { this.assertFence(record.operationId, epoch); this.insert("snapshot_artifacts", ARTIFACT, record); }
  listArtifacts(operationId: string): SnapshotArtifactRecord[] { return this.database.prepare(`SELECT ${projection(ARTIFACT)} FROM snapshot_artifacts WHERE operation_id = ? ORDER BY artifact_key`).all(operationId) as unknown as SnapshotArtifactRecord[]; }
  updateArtifact(operationId: string, epoch: number, artifactKey: string, state: SnapshotArtifactRecord["state"]): void {
    this.assertFence(operationId, epoch);
    if (this.database.prepare("UPDATE snapshot_artifacts SET state = ? WHERE operation_id = ? AND artifact_key = ?").run(state, operationId, artifactKey).changes !== 1) throw new SnapshotStoreError("SNAPSHOT_RECORD_CONFLICT");
  }
  getPackage(id: string): SnapshotPackageRecord | undefined { return this.database.prepare(`SELECT ${projection(PACKAGE)} FROM snapshot_packages WHERE id = ?`).get(id) as unknown as SnapshotPackageRecord | undefined; }
  listPackages(): SnapshotPackageRecord[] { return this.database.prepare(`SELECT ${projection(PACKAGE)} FROM snapshot_packages ORDER BY created_at, id`).all() as unknown as SnapshotPackageRecord[]; }
  insertPackage(record: SnapshotPackageRecord): void { this.insert("snapshot_packages", PACKAGE, record); }
  sealPackage(id: string, digest: string, size: number, readyAt: string, expiresAt: string): void {
    if (!/^[a-f0-9]{64}$/.test(digest) || !Number.isSafeInteger(size) || size < 0 || !Number.isFinite(Date.parse(readyAt)) || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(readyAt)) throw new SnapshotStoreError("SNAPSHOT_RECORD_CONFLICT");
    if (this.database.prepare("UPDATE snapshot_packages SET digest = ?, size = ?, state = 'ready', ready_at = ?, expires_at = ? WHERE id = ? AND state = 'staging'").run(digest, size, readyAt, expiresAt, id).changes !== 1) throw new SnapshotStoreError("SNAPSHOT_RECORD_CONFLICT");
  }
  /** After bytes are durable, serialize same-owner content dedupe with the ready-state transition. */
  sealOrReusePackage(id: string, ownerUserId: string, digest: string, size: number, readyAt: string, expiresAt: string): SnapshotPackageRecord {
    return this.transaction(() => {
      const duplicate = this.database.prepare(`SELECT ${projection(PACKAGE)} FROM snapshot_packages
        WHERE owner_user_id = ? AND digest = ? AND size = ? AND state = 'ready' AND expires_at > ? AND id != ?
        ORDER BY ready_at, id LIMIT 1`).get(ownerUserId, digest, size, readyAt, id) as unknown as SnapshotPackageRecord | undefined;
      if (duplicate) {
        if (this.database.prepare("UPDATE snapshot_packages SET digest = ?, size = ?, state = 'expired', expires_at = ? WHERE id = ? AND owner_user_id = ? AND state = 'staging'")
          .run(digest, size, readyAt, id, ownerUserId).changes !== 1) throw new SnapshotStoreError("SNAPSHOT_RECORD_CONFLICT");
        return duplicate;
      }
      this.sealPackage(id, digest, size, readyAt, expiresAt);
      return this.getPackage(id)!;
    });
  }
  packageInUse(id: string): boolean {
    return this.database.prepare("SELECT 1 FROM snapshot_transfers WHERE package_id = ? UNION ALL SELECT 1 FROM snapshot_jobs WHERE package_id = ? AND phase NOT IN ('succeeded', 'cleaned') LIMIT 1").get(id, id) !== undefined;
  }
  expirePackage(id: string, now: string): boolean {
    return this.transaction(() => {
      if (this.packageInUse(id)) return false;
      return this.database.prepare("UPDATE snapshot_packages SET state = 'expired' WHERE id = ? AND state = 'ready' AND expires_at <= ?").run(id, now).changes === 1;
    });
  }
  markPackageDeleting(id: string): boolean {
    return this.transaction(() => {
      if (this.packageInUse(id)) return false;
      return this.database.prepare("UPDATE snapshot_packages SET state = 'deleting' WHERE id = ? AND state IN ('staging', 'expired')").run(id).changes === 1;
    });
  }
  // Keep package tombstones (and their digests) for owner-only 410 and idempotency replay.
  getTransfer(id: string): SnapshotTransferRecord | undefined { return this.database.prepare(`SELECT ${projection(TRANSFER)} FROM snapshot_transfers WHERE id = ?`).get(id) as unknown as SnapshotTransferRecord | undefined; }
  listTransfers(): SnapshotTransferRecord[] { return this.database.prepare(`SELECT ${projection(TRANSFER)} FROM snapshot_transfers ORDER BY created_at, id`).all() as unknown as SnapshotTransferRecord[]; }
  acceptTransfer(record: SnapshotTransferRecord, uploadPackage?: SnapshotPackageRecord): void {
    this.transaction(() => {
      if (this.listTransfers().length >= 2) throw new SnapshotStoreError("SNAPSHOT_TRANSFER_BUSY");
      if (uploadPackage) {
        if (record.kind !== "upload" || record.packageId !== uploadPackage.id || record.ownerUserId !== uploadPackage.ownerUserId || uploadPackage.state !== "staging") throw new SnapshotStoreError("SNAPSHOT_RECORD_CONFLICT");
        this.insertPackage(uploadPackage);
      }
      if (record.packageId !== null) {
        const target = this.getPackage(record.packageId);
        if (target?.ownerUserId !== record.ownerUserId) throw new SnapshotStoreError("SNAPSHOT_RECORD_CONFLICT");
        if (record.kind === "download" && (target.state !== "ready" || target.expiresAt === null || target.expiresAt <= record.createdAt))
          throw new SnapshotStoreError("SNAPSHOT_RECORD_CONFLICT");
      }
      this.insert("snapshot_transfers", TRANSFER, record);
    });
  }
  updateTransfer(id: string, phase: SnapshotTransferRecord["phase"], lastProgressAt: string, helperId: string | null): void {
    if (this.database.prepare("UPDATE snapshot_transfers SET phase = ?, last_progress_at = ?, helper_id = ? WHERE id = ?").run(phase, lastProgressAt, helperId, id).changes !== 1) throw new SnapshotStoreError("SNAPSHOT_RECORD_CONFLICT");
  }
  finishTransfer(id: string): void { this.database.prepare("DELETE FROM snapshot_transfers WHERE id = ?").run(id); }
  getName(ownerUserId: string, name: string): WorkImportNameRecord | undefined { return this.database.prepare(`SELECT ${projection(NAME)} FROM work_import_names WHERE owner_user_id = ? AND name = ?`).get(ownerUserId, name) as unknown as WorkImportNameRecord | undefined; }
  assertNameAvailable(ownerUserId: string, name: string): void {
    if (this.getName(ownerUserId, name) || this.database.prepare("SELECT 1 FROM works WHERE owner_user_id = ? AND name = ?").get(ownerUserId, name)) throw new SnapshotStoreError("WORK_NAME_CONFLICT");
  }
  reserveName(record: WorkImportNameRecord): void { this.assertNameAvailable(record.ownerUserId, record.name); this.insert("work_import_names", NAME, record); }
  insertOwnedImage(record: WorkOwnedImageRecord): void { this.insert("work_owned_images", OWNED_IMAGE, record); }
  getOwnedImage(workId: string, selectionId: string): WorkOwnedImageRecord | undefined { return this.database.prepare(`SELECT ${projection(OWNED_IMAGE)} FROM work_owned_images WHERE work_id = ? AND selection_id = ?`).get(workId, selectionId) as unknown as WorkOwnedImageRecord | undefined; }
  listOwnedImages(workId: string): WorkOwnedImageRecord[] { return this.database.prepare(`SELECT ${projection(OWNED_IMAGE)} FROM work_owned_images WHERE work_id = ? ORDER BY selection_id`).all(workId) as unknown as WorkOwnedImageRecord[]; }
  insertHistory(record: ImportedWorkHistoryRecord): void { this.insert("imported_work_history", HISTORY, record); }
  getHistory(operationId: string): ImportedWorkHistoryRecord | undefined { return this.database.prepare(`SELECT ${projection(HISTORY)} FROM imported_work_history WHERE operation_id = ?`).get(operationId) as unknown as ImportedWorkHistoryRecord | undefined; }
  listHistory(workId: string): ImportedWorkHistoryRecord[] { return this.database.prepare(`SELECT ${projection(HISTORY)} FROM imported_work_history WHERE work_id = ? ORDER BY operation_id`).all(workId) as unknown as ImportedWorkHistoryRecord[]; }
  insertProvenance(record: WorkImportProvenanceRecord): void { this.insert("work_import_provenance", PROVENANCE, record); }
  getProvenance(workId: string): WorkImportProvenanceRecord | undefined { return this.database.prepare(`SELECT ${projection(PROVENANCE)} FROM work_import_provenance WHERE work_id = ?`).get(workId) as unknown as WorkImportProvenanceRecord | undefined; }
}
