import type { DatabaseSync } from "node:sqlite";
import { FILE_LIMITS } from "@piwork/contracts";

export class WorkFileStoreError extends Error {
  constructor(readonly code: "NOT_FOUND" | "WORK_FILES_UNAVAILABLE" | "WORK_SNAPSHOT_BUSY" | "FILE_ACCESS_BUSY" | "FILE_CLEANUP_REQUIRED" | "FILE_CONFLICT" | "AUTH_REQUIRED") {
    super(code);
    this.name = "WorkFileStoreError";
  }
}

export interface WorkFileJobRecord {
  readonly id: string;
  readonly workId: string;
  readonly ownerUserId: string;
  readonly sessionId: string;
  readonly coreEpoch: number;
  readonly workEpoch: number;
  readonly runtimeGeneration: number;
  readonly kind: "PROPFIND" | "GET" | "HEAD" | "PUT" | "MKCOL" | "COPY" | "MOVE" | "DELETE" | "PROPPATCH";
  readonly state: "accepted" | "starting" | "running" | "prepared" | "committing" | "finished" | "cancelling" | "cleanup-pending" | "cleaned";
  readonly trustedImageId: string;
  readonly volumeName: string;
  readonly pathSegmentsJson: string;
  readonly destinationSegmentsJson: string | null;
  readonly acceptedAt: string;
  readonly deadlineAt: string;
  readonly updatedAt: string;
  readonly cleanedAt: string | null;
  readonly errorCode: string | null;
}

export interface WorkFileAttemptRecord {
  readonly id: string;
  readonly jobId: string;
  readonly kind: "request" | "cleanup";
  readonly epoch: number;
  readonly containerName: string;
  readonly containerId: string | null;
  readonly state: "planned" | "creating" | "created" | "running" | "stopping" | "exited" | "removed" | "unknown";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkFileTemporaryRecord {
  readonly id: string;
  readonly jobId: string;
  readonly parentSegmentsJson: string;
  readonly name: string;
  readonly device: string | null;
  readonly inode: string | null;
  readonly state: "planned" | "created" | "published" | "cleaned" | "uncertain";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkFileGateRecord {
  readonly workId: string;
  readonly epoch: number;
  readonly closed: boolean;
  readonly updatedAt: string;
}

const JOB = `id, work_id AS workId, owner_user_id AS ownerUserId, session_id AS sessionId,
  core_epoch AS coreEpoch, work_epoch AS workEpoch, runtime_generation AS runtimeGeneration,
  kind, state, trusted_image_id AS trustedImageId, volume_name AS volumeName,
  path_segments_json AS pathSegmentsJson, destination_segments_json AS destinationSegmentsJson,
  accepted_at AS acceptedAt, deadline_at AS deadlineAt, updated_at AS updatedAt,
  cleaned_at AS cleanedAt, error_code AS errorCode`;
const ATTEMPT = `id, job_id AS jobId, kind, epoch, container_name AS containerName,
  container_id AS containerId, state, created_at AS createdAt, updated_at AS updatedAt`;
const TEMPORARY = `id, job_id AS jobId, parent_segments_json AS parentSegmentsJson,
  name, device, inode, state, created_at AS createdAt, updated_at AS updatedAt`;

/** Internal journal; no file record is included in portable Work metadata. */
export class WorkFileStore {
  constructor(private readonly database: DatabaseSync) {}

  nextCoreEpoch(): number {
    return this.transaction(() => {
      this.database.prepare("UPDATE work_file_core_epoch SET epoch = epoch + 1 WHERE id = 1").run();
      return (this.database.prepare("SELECT epoch FROM work_file_core_epoch WHERE id = 1").get() as { epoch: number }).epoch;
    });
  }

  private transaction<T>(effect: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try { const result = effect(); this.database.exec("COMMIT"); return result; }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  private ensureGate(workId: string, now: string): WorkFileGateRecord {
    this.database.prepare(`INSERT INTO work_file_gates(work_id,epoch,closed,updated_at)
      VALUES (?,1,0,?) ON CONFLICT(work_id) DO NOTHING`).run(workId, now);
    return this.getGate(workId)!;
  }

  /** Revalidate the same user session and owner throughout an active transfer. */
  assertAccess(workId: string, ownerUserId: string, sessionId: string, now: string): void {
    const session = this.database.prepare(`SELECT s.user_id AS userId, s.revoked_at AS revokedAt,
      s.expires_at AS expiresAt, u.enabled AS enabled FROM login_sessions s
      JOIN users u ON u.id = s.user_id WHERE s.id = ?`)
      .get(sessionId) as { userId: string; revokedAt: string | null; expiresAt: string; enabled: number } | undefined;
    if (!session || session.userId !== ownerUserId || session.revokedAt !== null
      || session.expiresAt <= now || session.enabled !== 1) throw new WorkFileStoreError("AUTH_REQUIRED");
    const work = this.database.prepare(`SELECT owner_user_id AS ownerUserId, desired_state AS desiredState,
      observed_state AS observedState, deleted_at AS deletedAt FROM works WHERE id = ?`)
      .get(workId) as { ownerUserId: string; desiredState: string; observedState: string; deletedAt: string | null } | undefined;
    if (!work || work.deletedAt !== null || work.ownerUserId !== ownerUserId) throw new WorkFileStoreError("NOT_FOUND");
    if (work.desiredState !== "running" || !["ready", "degraded"].includes(work.observedState)
      || this.getGate(workId)?.closed) throw new WorkFileStoreError("WORK_FILES_UNAVAILABLE");
    if (this.database.prepare(`SELECT 1 FROM work_file_jobs WHERE work_id = ? AND state = 'cleanup-pending' LIMIT 1`)
      .get(workId)) throw new WorkFileStoreError("FILE_CLEANUP_REQUIRED");
  }

  /** Accept and reserve one helper slot in a single SQLite write transaction. */
  acceptJob(input: Omit<WorkFileJobRecord, "workEpoch">, firstAttempt?: WorkFileAttemptRecord): WorkFileJobRecord {
    return this.transaction(() => {
      const work = this.database.prepare(`SELECT owner_user_id AS ownerUserId, desired_state AS desiredState,
        observed_state AS observedState, deleted_at AS deletedAt FROM works WHERE id = ?`)
        .get(input.workId) as { ownerUserId: string; desiredState: string; observedState: string; deletedAt: string | null } | undefined;
      if (!work || work.deletedAt !== null || work.ownerUserId !== input.ownerUserId) throw new WorkFileStoreError("NOT_FOUND");
      if (work.desiredState !== "running" || !["ready", "degraded"].includes(work.observedState)) throw new WorkFileStoreError("WORK_FILES_UNAVAILABLE");
      const session = this.database.prepare(`SELECT s.user_id AS userId, s.revoked_at AS revokedAt,
        s.expires_at AS expiresAt, u.enabled AS enabled FROM login_sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`)
        .get(input.sessionId) as { userId: string; revokedAt: string | null; expiresAt: string; enabled: number } | undefined;
      if (!session || session.userId !== input.ownerUserId || session.revokedAt !== null || session.expiresAt <= input.acceptedAt || session.enabled !== 1)
        throw new WorkFileStoreError("AUTH_REQUIRED");
      const gate = this.ensureGate(input.workId, input.acceptedAt);
      if (gate.closed) throw new WorkFileStoreError("WORK_FILES_UNAVAILABLE");
      if (this.database.prepare(`SELECT 1 FROM work_file_jobs WHERE work_id = ? AND state = 'cleanup-pending' LIMIT 1`)
        .get(input.workId)) throw new WorkFileStoreError("FILE_CLEANUP_REQUIRED");
      if (this.database.prepare("SELECT 1 FROM work_snapshot_locks WHERE work_id = ?").get(input.workId)) throw new WorkFileStoreError("WORK_SNAPSHOT_BUSY");
      const pending = this.database.prepare(`SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN owner_user_id = ? THEN 1 ELSE 0 END) AS userCount,
        SUM(CASE WHEN work_id = ? THEN 1 ELSE 0 END) AS workCount
        FROM work_file_jobs WHERE state != 'cleaned'`).get(input.ownerUserId, input.workId) as { total: number; userCount: number; workCount: number };
      if (pending.total >= FILE_LIMITS.maxCoreRequests || pending.userCount >= FILE_LIMITS.maxUserRequests || pending.workCount >= FILE_LIMITS.maxWorkRequests)
        throw new WorkFileStoreError("FILE_ACCESS_BUSY");
      if (["PUT", "MKCOL", "COPY", "MOVE", "DELETE", "PROPPATCH"].includes(input.kind)
        && this.database.prepare(`SELECT 1 FROM work_file_jobs WHERE work_id = ? AND state != 'cleaned'
          AND kind IN ('PUT','MKCOL','COPY','MOVE','DELETE','PROPPATCH')`).get(input.workId))
        throw new WorkFileStoreError("FILE_ACCESS_BUSY");
      const record = { ...input, workEpoch: gate.epoch };
      this.insertJob(record);
      if (firstAttempt !== undefined) {
        if (firstAttempt.jobId !== record.id || firstAttempt.kind !== "request" || firstAttempt.state !== "planned")
          throw new WorkFileStoreError("FILE_CONFLICT");
        this.insertAttempt({ ...firstAttempt, epoch: gate.epoch });
      }
      return record;
    });
  }

  /** The caller may hold an outer mutation transaction; this method performs no nested BEGIN. */
  closeGateInTransaction(workId: string, now: string): WorkFileGateRecord {
    this.ensureGate(workId, now);
    this.database.prepare("UPDATE work_file_gates SET closed = 1, epoch = epoch + 1, updated_at = ? WHERE work_id = ?")
      .run(now, workId);
    return this.getGate(workId)!;
  }

  closeGate(workId: string, now: string): WorkFileGateRecord {
    return this.transaction(() => this.closeGateInTransaction(workId, now));
  }

  openGate(workId: string, now: string): WorkFileGateRecord {
    return this.transaction(() => {
      const gate = this.ensureGate(workId, now);
      if (this.hasPending(workId)) throw new WorkFileStoreError("FILE_CLEANUP_REQUIRED");
      if (this.database.prepare("SELECT 1 FROM work_snapshot_locks WHERE work_id = ?").get(workId)) throw new WorkFileStoreError("WORK_SNAPSHOT_BUSY");
      this.database.prepare("UPDATE work_file_gates SET closed = 0, epoch = epoch + 1, updated_at = ? WHERE work_id = ?")
        .run(now, workId);
      return this.getGate(workId)!;
    });
  }

  hasPending(workId: string): boolean {
    return this.database.prepare("SELECT 1 FROM work_file_jobs WHERE work_id = ? AND state != 'cleaned' LIMIT 1")
      .get(workId) !== undefined;
  }

  authorizeCommit(jobId: string, workEpoch: number, now: string): void {
    this.transaction(() => {
      const job = this.getJob(jobId);
      if (!job || !["running", "prepared"].includes(job.state) || job.workEpoch !== workEpoch) throw new WorkFileStoreError("FILE_CONFLICT");
      const gate = this.getGate(job.workId);
      if (!gate || gate.closed || gate.epoch !== workEpoch) throw new WorkFileStoreError("WORK_FILES_UNAVAILABLE");
      if (this.database.prepare("SELECT 1 FROM work_snapshot_locks WHERE work_id = ?").get(job.workId)) throw new WorkFileStoreError("WORK_SNAPSHOT_BUSY");
      const session = this.database.prepare(`SELECT s.revoked_at AS revokedAt, s.expires_at AS expiresAt,
        u.enabled AS enabled FROM login_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ? AND s.user_id = ?`).get(job.sessionId, job.ownerUserId) as
        { revokedAt: string | null; expiresAt: string; enabled: number } | undefined;
      if (!session || session.revokedAt !== null || session.expiresAt <= now || session.enabled !== 1) throw new WorkFileStoreError("AUTH_REQUIRED");
      this.database.prepare("UPDATE work_file_jobs SET state = 'committing', updated_at = ? WHERE id = ?").run(now, jobId);
    });
  }

  markCleaned(jobId: string, now: string): void {
    this.transaction(() => {
      const job = this.getJob(jobId);
      if (!job || job.state === "cleaned") throw new WorkFileStoreError("FILE_CONFLICT");
      if (this.database.prepare("SELECT 1 FROM work_file_attempts WHERE job_id = ? AND state != 'removed' LIMIT 1").get(jobId)
        || this.database.prepare("SELECT 1 FROM work_file_temporaries WHERE job_id = ? AND state NOT IN ('published','cleaned') LIMIT 1").get(jobId))
        throw new WorkFileStoreError("FILE_CLEANUP_REQUIRED");
      this.database.prepare("UPDATE work_file_jobs SET state = 'cleaned', cleaned_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, jobId);
    });
  }

  getGate(workId: string): WorkFileGateRecord | undefined {
    const row = this.database.prepare("SELECT work_id AS workId, epoch, closed, updated_at AS updatedAt FROM work_file_gates WHERE work_id = ?")
      .get(workId) as { workId: string; epoch: number; closed: number; updatedAt: string } | undefined;
    return row && { ...row, closed: row.closed === 1 };
  }

  getJob(id: string): WorkFileJobRecord | undefined {
    return this.database.prepare(`SELECT ${JOB} FROM work_file_jobs WHERE id = ?`).get(id) as unknown as WorkFileJobRecord | undefined;
  }

  listPendingJobs(workId?: string): WorkFileJobRecord[] {
    return this.database.prepare(`SELECT ${JOB} FROM work_file_jobs WHERE state != 'cleaned'
      ${workId === undefined ? "" : "AND work_id = ?"} ORDER BY accepted_at, id`)
      .all(...(workId === undefined ? [] : [workId])) as unknown as WorkFileJobRecord[];
  }

  insertJob(record: WorkFileJobRecord): void {
    this.database.prepare(`INSERT INTO work_file_jobs(id,work_id,owner_user_id,session_id,core_epoch,work_epoch,
      runtime_generation,kind,state,trusted_image_id,volume_name,path_segments_json,destination_segments_json,
      accepted_at,deadline_at,updated_at,cleaned_at,error_code)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(record.id, record.workId, record.ownerUserId, record.sessionId,
      record.coreEpoch, record.workEpoch, record.runtimeGeneration, record.kind, record.state, record.trustedImageId,
      record.volumeName, record.pathSegmentsJson, record.destinationSegmentsJson, record.acceptedAt, record.deadlineAt,
      record.updatedAt, record.cleanedAt, record.errorCode);
  }

  insertAttempt(record: WorkFileAttemptRecord): void {
    this.database.prepare(`INSERT INTO work_file_attempts(id,job_id,kind,epoch,container_name,container_id,state,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(record.id, record.jobId, record.kind, record.epoch, record.containerName,
      record.containerId, record.state, record.createdAt, record.updatedAt);
  }

  updateJobState(id: string, expected: WorkFileJobRecord["state"], state: WorkFileJobRecord["state"], now: string,
                 errorCode: string | null = null): void {
    if (this.database.prepare("UPDATE work_file_jobs SET state = ?, updated_at = ?, error_code = ? WHERE id = ? AND state = ?")
      .run(state, now, errorCode, id, expected).changes !== 1) throw new WorkFileStoreError("FILE_CONFLICT");
  }

  updateAttempt(id: string, expected: WorkFileAttemptRecord["state"], state: WorkFileAttemptRecord["state"],
                now: string, containerId?: string): void {
    if (this.database.prepare(`UPDATE work_file_attempts SET state = ?, updated_at = ?,
      container_id = COALESCE(?, container_id) WHERE id = ? AND state = ?`)
      .run(state, now, containerId ?? null, id, expected).changes !== 1) throw new WorkFileStoreError("FILE_CONFLICT");
  }

  confirmTemporary(id: string, jobId: string, device: string, inode: string, now: string): void {
    if (!/^[0-9]+$/.test(device) || !/^[0-9]+$/.test(inode)) throw new WorkFileStoreError("FILE_CONFLICT");
    if (this.database.prepare(`UPDATE work_file_temporaries SET state = 'created', device = ?, inode = ?, updated_at = ?
      WHERE id = ? AND job_id = ? AND state = 'planned'`).run(device, inode, now, id, jobId).changes !== 1)
      throw new WorkFileStoreError("FILE_CONFLICT");
  }

  markTemporary(id: string, jobId: string, state: "published" | "cleaned" | "uncertain", now: string): void {
    const allowed = state === "published" ? "state = 'created'" : "state IN ('planned','created','uncertain')";
    if (this.database.prepare(`UPDATE work_file_temporaries SET state = ?, updated_at = ?
      WHERE id = ? AND job_id = ? AND ${allowed}`).run(state, now, id, jobId).changes !== 1)
      throw new WorkFileStoreError("FILE_CONFLICT");
  }

  listAttempts(jobId: string): WorkFileAttemptRecord[] {
    return this.database.prepare(`SELECT ${ATTEMPT} FROM work_file_attempts WHERE job_id = ? ORDER BY created_at, id`)
      .all(jobId) as unknown as WorkFileAttemptRecord[];
  }

  insertTemporary(record: WorkFileTemporaryRecord): void {
    this.database.prepare(`INSERT INTO work_file_temporaries(id,job_id,parent_segments_json,name,device,inode,state,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(record.id, record.jobId, record.parentSegmentsJson, record.name, record.device,
      record.inode, record.state, record.createdAt, record.updatedAt);
  }

  listTemporaries(jobId: string): WorkFileTemporaryRecord[] {
    return this.database.prepare(`SELECT ${TEMPORARY} FROM work_file_temporaries WHERE job_id = ? ORDER BY created_at, id`)
      .all(jobId) as unknown as WorkFileTemporaryRecord[];
  }

  /** Three automatic cleanup attempts per ten-minute window, including the first. */
  reserveCleanupRetry(jobId: string, now: string, explicitRetry = false): boolean {
    return this.transaction(() => {
      const job = this.getJob(jobId);
      if (!job || job.state === "cleaned") return false;
      const previous = this.database.prepare(`SELECT window_started_at AS windowStartedAt, attempts
        FROM work_file_cleanup_retries WHERE job_id = ?`).get(jobId) as
        { windowStartedAt: string; attempts: number } | undefined;
      const elapsed = previous ? Date.parse(now) - Date.parse(previous.windowStartedAt) : Number.POSITIVE_INFINITY;
      if (!Number.isFinite(Date.parse(now)) || (previous && !Number.isFinite(Date.parse(previous.windowStartedAt))))
        throw new TypeError("Invalid cleanup timestamp");
      if (previous && !explicitRetry && elapsed < 10 * 60_000 && previous.attempts >= 3) return false;
      const restart = explicitRetry || !previous || elapsed >= 10 * 60_000;
      this.database.prepare(`INSERT INTO work_file_cleanup_retries(job_id,window_started_at,attempts,last_attempt_at)
        VALUES (?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET
        window_started_at=excluded.window_started_at, attempts=excluded.attempts,
        last_attempt_at=excluded.last_attempt_at`).run(jobId, restart ? now : previous.windowStartedAt,
        restart ? 1 : previous.attempts + 1, now);
      return true;
    });
  }

  /** Retain cleaned records for at least 24 hours; never collect recovery work. */
  collectCleaned(now: string): number {
    const cutoff = new Date(Date.parse(now) - 24 * 60 * 60 * 1_000);
    if (Number.isNaN(cutoff.getTime())) throw new TypeError("Invalid cleanup timestamp");
    return Number(this.database.prepare("DELETE FROM work_file_jobs WHERE state = 'cleaned' AND cleaned_at <= ?")
      .run(cutoff.toISOString()).changes);
  }
}
