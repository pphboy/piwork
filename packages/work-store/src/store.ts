import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrateWorkDatabase, WORK_SCHEMA_VERSION } from "./migrations.js";

export { WORK_SCHEMA_VERSION };
export const DEFAULT_MAX_RUN_EVENTS = 10_000;

export class WorkBusyError extends Error {
  constructor(readonly activeRunId: string) {
    super(`Work already has active Run ${activeRunId}`);
    this.name = "WorkBusyError";
  }
}

export class SubmitConflictError extends Error {
  constructor(readonly submissionKey: string) {
    super(`submission key ${submissionKey} was already used with different content`);
    this.name = "SubmitConflictError";
  }
}

export class CursorExpiredError extends Error {
  constructor(readonly earliestAvailableSequence: number) {
    super(`Run event cursor expired; earliest available sequence is ${earliestAvailableSequence}`);
    this.name = "CursorExpiredError";
  }
}

export interface SessionRecord {
  readonly workId: string;
  readonly sessionId: string;
  readonly sdkHistoryPath: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Internal active Work context identity; never mapped to public protobuf output. */
  readonly contextIdentity?: string | null;
}

export interface RunRecord {
  readonly workId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly submissionKey: string;
  readonly promptDigest: string;
  readonly state: "accepted" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled" | "interrupted";
  readonly finalText: string | null;
  readonly errorJson: string | null;
  readonly acceptedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly earliestAvailableSequence: number;
  readonly latestSequence: number;
  /** Internal context captured when the Run was accepted. */
  readonly contextIdentity?: string | null;
}

export interface AcceptRunRequest {
  readonly workId: string;
  readonly sessionId: string;
  readonly submissionKey: string;
  readonly requestDigest: string;
  readonly promptDigest: string;
  readonly contextIdentity?: string | null;
  readonly now?: string;
}

export interface AcceptedRun {
  readonly run: RunRecord;
  readonly reused: boolean;
}

export interface RunEventRecord {
  readonly runId: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly payloadJson: string;
  readonly createdAt: string;
}

interface SubmitRow {
  readonly request_digest: string;
  readonly run_id: string;
}

export class WorkStore {
  private closed = false;

  private constructor(private readonly database: DatabaseSync) {}

  static open(databasePath: string): WorkStore {
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    const database = new DatabaseSync(databasePath);
    try {
      database.exec("PRAGMA journal_mode = WAL");
      database.exec("PRAGMA foreign_keys = ON");
      database.exec("PRAGMA busy_timeout = 5000");
      migrateWorkDatabase(database);
      return new WorkStore(database);
    } catch (error) {
      database.close();
      throw error;
    }
  }

  get schemaVersion(): number {
    return this.get<{ version: number }>("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")?.version ?? 0;
  }

  createSession(record: SessionRecord): void {
    this.assertOpen();
    this.database.prepare(`INSERT INTO sessions(
      work_id, session_id, sdk_history_path, created_at, updated_at, active_context_identity
    ) VALUES (?, ?, ?, ?, ?, ?)`).run(
      record.workId,
      record.sessionId,
      record.sdkHistoryPath,
      record.createdAt,
      record.updatedAt,
      record.contextIdentity ?? null,
    );
  }

  createSessionIdempotent(record: SessionRecord, idempotencyKey: string): { readonly session: SessionRecord; readonly reused: boolean } {
    this.assertOpen();
    if (idempotencyKey.length < 1 || idempotencyKey.length > 256) throw new Error("session idempotency key is invalid");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const prior = this.database.prepare(`SELECT session_id FROM session_idempotency
        WHERE work_id = ? AND idempotency_key = ?`).get(record.workId, idempotencyKey) as { session_id: string } | undefined;
      if (prior !== undefined) {
        const session = this.getSession(record.workId, prior.session_id);
        if (session === undefined) throw new Error("session idempotency record is inconsistent");
        this.database.exec("COMMIT");
        return { session, reused: true };
      }
      this.database.prepare(`INSERT INTO sessions(work_id, session_id, sdk_history_path, created_at, updated_at, active_context_identity)
        VALUES (?, ?, ?, ?, ?, ?)`).run(record.workId, record.sessionId, record.sdkHistoryPath, record.createdAt, record.updatedAt, record.contextIdentity ?? null);
      this.database.prepare(`INSERT INTO session_idempotency(work_id, idempotency_key, session_id, created_at)
        VALUES (?, ?, ?, ?)`).run(record.workId, idempotencyKey, record.sessionId, record.createdAt);
      this.database.exec("COMMIT");
      return { session: record, reused: false };
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  getSession(workId: string, sessionId: string): SessionRecord | undefined {
    this.assertOpen();
    const row = this.database.prepare(`SELECT
      work_id, session_id, sdk_history_path, created_at, updated_at, active_context_identity
      FROM sessions WHERE work_id = ? AND session_id = ?`).get(workId, sessionId) as
      | Record<string, string | null>
      | undefined;
    return row === undefined ? undefined : mapSession(row);
  }

  listSessions(workId: string): SessionRecord[] {
    this.assertOpen();
    const rows = this.database.prepare(`SELECT
      work_id, session_id, sdk_history_path, created_at, updated_at, active_context_identity
      FROM sessions WHERE work_id = ? ORDER BY created_at, session_id`).all(workId) as Array<Record<string, string>>;
    return rows.map(mapSession);
  }

  acceptRun(request: AcceptRunRequest): AcceptedRun {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const prior = this.database.prepare(`SELECT request_digest, run_id FROM submit_idempotency
        WHERE work_id = ? AND submission_key = ?`).get(request.workId, request.submissionKey) as
        | SubmitRow
        | undefined;
      if (prior !== undefined) {
        if (prior.request_digest !== request.requestDigest) throw new SubmitConflictError(request.submissionKey);
        const run = this.readRun(prior.run_id);
        if (run === undefined) throw new Error(`idempotency record references missing Run ${prior.run_id}`);
        this.database.exec("COMMIT");
        return { run, reused: true };
      }

      const activity = this.database.prepare("SELECT active_run_id FROM work_activity WHERE work_id = ?").get(request.workId) as
        | { active_run_id: string }
        | undefined;
      if (activity !== undefined) throw new WorkBusyError(activity.active_run_id);

      const session = this.database.prepare(
        "SELECT active_context_identity FROM sessions WHERE work_id = ? AND session_id = ?",
      ).get(request.workId, request.sessionId) as { active_context_identity: string | null } | undefined;
      if (session === undefined) throw new Error(`session ${request.sessionId} does not exist in Work ${request.workId}`);
      if (request.contextIdentity !== undefined && session.active_context_identity !== request.contextIdentity) {
        throw new Error(`session ${request.sessionId} context is no longer active`);
      }

      const runId = `run-${randomUUID()}`;
      const now = request.now ?? new Date().toISOString();
      this.database.prepare(`INSERT INTO runs(
        work_id, session_id, run_id, submission_key, prompt_digest, state, accepted_at, context_identity
      ) VALUES (?, ?, ?, ?, ?, 'accepted', ?, ?)`).run(
        request.workId,
        request.sessionId,
        runId,
        request.submissionKey,
        request.promptDigest,
        now,
        session.active_context_identity,
      );
      this.database.prepare(`INSERT INTO submit_idempotency(
        work_id, submission_key, request_digest, run_id, created_at
      ) VALUES (?, ?, ?, ?, ?)`).run(
        request.workId,
        request.submissionKey,
        request.requestDigest,
        runId,
        now,
      );
      this.database.prepare("INSERT INTO work_activity(work_id, active_run_id, acquired_at) VALUES (?, ?, ?)").run(
        request.workId,
        runId,
        now,
      );
      const run = this.readRun(runId);
      if (run === undefined) throw new Error(`accepted Run ${runId} was not readable`);
      this.database.exec("COMMIT");
      return { run, reused: false };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getRun(runId: string): RunRecord | undefined {
    this.assertOpen();
    return this.readRun(runId);
  }

  markRunRunning(runId: string, now = new Date().toISOString()): RunRecord {
    this.assertOpen();
    const result = this.database.prepare(`UPDATE runs SET state = 'running', started_at = COALESCE(started_at, ?)
      WHERE run_id = ? AND state = 'accepted'`).run(now, runId);
    if (result.changes !== 1) throw new Error(`Run ${runId} is not accepted`);
    return this.readRun(runId)!;
  }

  requestCancellation(runId: string): RunRecord {
    this.assertOpen();
    const current = this.readRun(runId);
    if (current === undefined) throw new Error(`Run ${runId} does not exist`);
    if (current.state === "accepted" || current.state === "running") {
      this.database.prepare("UPDATE runs SET state = 'cancelling' WHERE run_id = ?").run(runId);
      return this.readRun(runId)!;
    }
    return current;
  }

  appendEvent(runId: string, eventType: string, payloadJson: string, now = new Date().toISOString()): number {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.database.prepare("SELECT latest_sequence FROM runs WHERE run_id = ?").get(runId) as
        | { latest_sequence: number }
        | undefined;
      if (row === undefined) throw new Error(`Run ${runId} does not exist`);
      const sequence = row.latest_sequence + 1;
      this.database.prepare(`INSERT INTO run_events(run_id, sequence, event_type, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?)`).run(runId, sequence, eventType, payloadJson, now);
      this.database.prepare("UPDATE runs SET latest_sequence = ? WHERE run_id = ?").run(sequence, runId);
      this.database.exec("COMMIT");
      return sequence;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  readEvents(runId: string, afterSequence = 0, limit = 1_000): RunEventRecord[] {
    this.assertOpen();
    const run = this.readRun(runId);
    if (run === undefined) throw new Error(`Run ${runId} does not exist`);
    if (afterSequence + 1 < run.earliestAvailableSequence) throw new CursorExpiredError(run.earliestAvailableSequence);
    const rows = this.database.prepare(`SELECT run_id, sequence, event_type, payload_json, created_at
      FROM run_events WHERE run_id = ? AND sequence > ? ORDER BY sequence LIMIT ?`).all(
      runId, afterSequence, limit,
    ) as Array<Record<string, string | number>>;
    return rows.map((row) => ({
      runId: String(row.run_id),
      sequence: Number(row.sequence),
      eventType: String(row.event_type),
      payloadJson: String(row.payload_json),
      createdAt: String(row.created_at),
    }));
  }

  completeRun(
    runId: string,
    terminalState: "succeeded" | "failed" | "cancelled" | "interrupted",
    finalText: string | null,
    errorJson: string | null,
    now = new Date().toISOString(),
  ): void {
    if (!this.tryCompleteRun(runId, terminalState, finalText, errorJson, now)) {
      throw new Error(`Run ${runId} is already terminal or missing`);
    }
  }

  tryCompleteRun(
    runId: string,
    terminalState: "succeeded" | "failed" | "cancelled" | "interrupted",
    finalText: string | null,
    errorJson: string | null,
    now = new Date().toISOString(),
  ): boolean {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const run = this.readRun(runId);
      if (run === undefined || !["accepted", "running", "cancelling"].includes(run.state)) {
        this.database.exec("COMMIT");
        return false;
      }
      const sequence = run.latestSequence + 1;
      this.database.prepare(`INSERT INTO run_events(run_id, sequence, event_type, payload_json, created_at)
        VALUES (?, ?, 'state', ?, ?)`).run(
        runId,
        sequence,
        JSON.stringify({ state: terminalState, finalText, error: errorJson === null ? null : JSON.parse(errorJson) }),
        now,
      );
      const result = this.database.prepare(`UPDATE runs
        SET state = ?, final_text = ?, error_json = ?, finished_at = ?, latest_sequence = ?
        WHERE run_id = ? AND state IN ('accepted', 'running', 'cancelling')`).run(
        terminalState,
        finalText,
        errorJson,
        now,
        sequence,
        runId,
      );
      if (result.changes !== 1) throw new Error(`Run ${runId} terminal transition lost its transaction race`);
      this.database.prepare("DELETE FROM work_activity WHERE active_run_id = ?").run(runId);
      this.database.exec("COMMIT");
      return true;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  interruptActiveRuns(now = new Date().toISOString()): RunRecord[] {
    this.assertOpen();
    const active = this.database.prepare(`SELECT run_id FROM runs
      WHERE state IN ('accepted', 'running', 'cancelling') ORDER BY accepted_at, run_id`).all() as Array<{ run_id: string }>;
    const interrupted: RunRecord[] = [];
    for (const row of active) {
      if (this.tryCompleteRun(row.run_id, "interrupted", null, JSON.stringify({
        code: "DAEMON_RESTARTED",
        message: "daemon restarted before the Run terminal state was durably known",
        retryable: false,
      }), now)) interrupted.push(this.readRun(row.run_id)!);
    }
    return interrupted;
  }

  compactRunEvents(runId: string, maxEvents = DEFAULT_MAX_RUN_EVENTS): RunRecord {
    this.assertOpen();
    if (!Number.isInteger(maxEvents) || maxEvents < 1) throw new Error("maxEvents must be a positive integer");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const run = this.readRun(runId);
      if (run === undefined) throw new Error(`Run ${runId} does not exist`);
      const earliestToKeep = Math.max(1, run.latestSequence - maxEvents + 1);
      this.database.prepare("DELETE FROM run_events WHERE run_id = ? AND sequence < ?").run(runId, earliestToKeep);
      this.database.prepare("UPDATE runs SET earliest_available_sequence = ? WHERE run_id = ?").run(
        run.latestSequence === 0 ? 1 : earliestToKeep,
        runId,
      );
      this.database.exec("COMMIT");
      return this.readRun(runId)!;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listTables(): string[] {
    this.assertOpen();
    return (this.database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{
      name: string;
    }>).map((row) => row.name);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }

  private readRun(runId: string): RunRecord | undefined {
    const row = this.database.prepare(`SELECT
      work_id, session_id, run_id, submission_key, prompt_digest, state,
      final_text, error_json, accepted_at, started_at, finished_at,
      earliest_available_sequence, latest_sequence, context_identity
      FROM runs WHERE run_id = ?`).get(runId) as Record<string, string | number | null> | undefined;
    return row === undefined ? undefined : mapRun(row);
  }

  private get<T>(sql: string): T | undefined {
    this.assertOpen();
    return this.database.prepare(sql).get() as T | undefined;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("WorkStore is closed");
  }
}

function mapSession(row: Record<string, string | null>): SessionRecord {
  return {
    workId: row.work_id ?? "",
    sessionId: row.session_id ?? "",
    sdkHistoryPath: row.sdk_history_path ?? "",
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
    contextIdentity: row.active_context_identity ?? null,
  };
}

function mapRun(row: Record<string, string | number | null>): RunRecord {
  return {
    workId: String(row.work_id),
    sessionId: String(row.session_id),
    runId: String(row.run_id),
    submissionKey: String(row.submission_key),
    promptDigest: String(row.prompt_digest),
    state: String(row.state) as RunRecord["state"],
    finalText: row.final_text === null ? null : String(row.final_text),
    errorJson: row.error_json === null ? null : String(row.error_json),
    acceptedAt: String(row.accepted_at),
    startedAt: row.started_at === null ? null : String(row.started_at),
    finishedAt: row.finished_at === null ? null : String(row.finished_at),
    earliestAvailableSequence: Number(row.earliest_available_sequence),
    latestSequence: Number(row.latest_sequence),
    contextIdentity: row.context_identity === null || row.context_identity === undefined ? null : String(row.context_identity),
  };
}
