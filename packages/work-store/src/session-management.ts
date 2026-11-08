import { createHash } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

type Row = Record<string, SQLInputValue>;
export type SessionTitleSource = 'default' | 'manual' | 'auto';
export type SessionAutoState = 'eligible' | 'pending' | 'completed' | 'failed' | 'unknown';
export type SessionOperationState = 'pending' | 'accepted' | 'failed' | 'unknown';
export interface ManagedSessionState {
  readonly title: string | null;
  readonly titleSource: SessionTitleSource;
  readonly revision: number;
  readonly manualLock: boolean;
  readonly deletedAt: string | null;
  readonly autoState: SessionAutoState;
}

export class SessionManagementError extends Error {
  constructor(readonly code: 'SESSION_NOT_FOUND' | 'SESSION_DELETED' | 'SESSION_BUSY' | 'SESSION_REVISION_CONFLICT' | 'SESSION_OPERATION_CONFLICT' | 'SESSION_INVALID') {
    super(code);
    this.name = 'SessionManagementError';
  }
}

function validIdentity(value: string, maxBytes: number): boolean {
  return !!value && !value.includes('\0') && Buffer.byteLength(value) <= maxBytes;
}
export function validSessionTimestamp(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, y, m, d, h, min, sec, , zoneHour, zoneMinute] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!
    && Number(h) <= 23 && Number(min) <= 59 && Number(sec) <= 59
    && (!zoneHour || Number(zoneHour) <= 23) && (!zoneMinute || Number(zoneMinute) <= 59)
    && Number.isFinite(Date.parse(value));
}
function normalizeTitle(value: string): string {
  const title = value.trim();
  if (!validIdentity(title, 480) || Array.from(title).length > 120) throw new SessionManagementError('SESSION_INVALID');
  return title;
}
function digest(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

/** Strictly validate durable receipts, including receipts imported from a Work package. */
export function parseManagedSessionState(raw: string): ManagedSessionState {
  let value: Record<string, unknown>;
  try { value = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new SessionManagementError('SESSION_INVALID'); }
  const keys = ['title', 'titleSource', 'revision', 'manualLock', 'deletedAt', 'autoState'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))
    || !['default', 'manual', 'auto'].includes(String(value.titleSource))
    || (value.titleSource === 'default' ? value.title !== null : typeof value.title !== 'string' || !validIdentity(value.title, 480) || Array.from(value.title).length > 120)
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || typeof value.manualLock !== 'boolean'
    || (value.titleSource === 'manual' && value.manualLock !== true)
    || (value.titleSource !== 'default' && Number(value.revision) < 1)
    || (value.deletedAt !== null && (!validSessionTimestamp(value.deletedAt) || Number(value.revision) < 1))
    || !['eligible', 'pending', 'completed', 'failed', 'unknown'].includes(String(value.autoState))) throw new SessionManagementError('SESSION_INVALID');
  return value as unknown as ManagedSessionState;
}

/** Transactional owner for schema-8 Session metadata and durable write receipts. */
export class SessionManagementStore {
  constructor(private readonly db: DatabaseSync) {}

  private transaction<T>(action: () => T): T {
    if (this.db.isTransaction) throw new Error('SESSION_TRANSACTION_ACTIVE');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    }
    catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private state(workId: string, sessionId: string): ManagedSessionState {
    const row = this.db.prepare(`SELECT m.title, m.title_source, m.title_revision, m.manual_lock, m.deleted_at, m.auto_state
      FROM sessions s LEFT JOIN session_management m ON m.work_id=s.work_id AND m.session_id=s.session_id
      WHERE s.work_id=? AND s.session_id=?`).get(workId, sessionId) as Row | undefined;
    if (!row) throw new SessionManagementError('SESSION_NOT_FOUND');
    return {
      title: row.title === null ? null : String(row.title),
      titleSource: (row.title_source ?? 'default') as SessionTitleSource,
      revision: Number(row.title_revision ?? 0),
      manualLock: row.manual_lock === 1,
      deletedAt: row.deleted_at === null ? null : String(row.deleted_at),
      autoState: (row.auto_state ?? 'eligible') as SessionAutoState,
    };
  }

  read(workId: string, sessionId: string): ManagedSessionState {
    return this.state(workId, sessionId);
  }

  lookup(workId: string, operationKey: string): { sessionId: string; kind: string; status: SessionOperationState; state: ManagedSessionState } | undefined {
    const row = this.db.prepare('SELECT session_id,operation_kind,operation_status,result_json FROM session_management_operations WHERE work_id=? AND operation_key=?').get(workId, operationKey) as Row | undefined;
    if (!row) return undefined;
    return { sessionId: String(row.session_id), kind: String(row.operation_kind), status: row.operation_status as SessionOperationState, state: parseManagedSessionState(String(row.result_json)) };
  }

  private replay(workId: string, key: string, requestDigest: string): ManagedSessionState | undefined {
    const row = this.db.prepare('SELECT request_digest,result_json FROM session_management_operations WHERE work_id=? AND operation_key=?').get(workId, key) as Row | undefined;
    if (!row) return undefined;
    if (row.request_digest !== requestDigest) throw new SessionManagementError('SESSION_OPERATION_CONFLICT');
    return parseManagedSessionState(String(row.result_json));
  }

  private ensureMetadata(workId: string, sessionId: string): void {
    this.state(workId, sessionId);
    this.db.prepare('INSERT OR IGNORE INTO session_management(work_id,session_id) VALUES(?,?)').run(workId, sessionId);
  }

  private receipt(workId: string, sessionId: string, key: string, kind: string, requestDigest: string, state: ManagedSessionState, now: string): void {
    this.db.prepare('INSERT INTO session_management_operations(work_id,operation_key,session_id,operation_kind,request_digest,result_json,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(workId, key, sessionId, kind, requestDigest, JSON.stringify(state), now);
  }

  private validateWrite(workId: string, sessionId: string, key: string, expectedRevision: number): void {
    if (!validIdentity(workId, 256) || !validIdentity(sessionId, 256) || !validIdentity(key, 256) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new SessionManagementError('SESSION_INVALID');
  }

  rename(workId: string, sessionId: string, expectedRevision: number, value: string, key: string, source: 'manual' | 'auto' = 'manual', now = new Date().toISOString()): ManagedSessionState {
    this.validateWrite(workId, sessionId, key, expectedRevision);
    if (!validSessionTimestamp(now) || !['manual', 'auto'].includes(source)) throw new SessionManagementError('SESSION_INVALID');
    const title = normalizeTitle(value), kind = source === 'manual' ? 'rename' : 'auto-name';
    const requestDigest = digest({ workId, sessionId, expectedRevision, title, kind });
    return this.transaction(() => {
      const replay = this.replay(workId, key, requestDigest);
      if (replay) return replay;
      this.ensureMetadata(workId, sessionId);
      const current = this.state(workId, sessionId);
      if (current.deletedAt) throw new SessionManagementError('SESSION_DELETED');
      if (current.revision !== expectedRevision) throw new SessionManagementError('SESSION_REVISION_CONFLICT');
      if (current.revision >= Number.MAX_SAFE_INTEGER) throw new SessionManagementError('SESSION_INVALID');
      this.db.prepare(`UPDATE session_management SET title=?,title_source=?,title_revision=title_revision+1,
        manual_lock=CASE WHEN ?='manual' THEN 1 ELSE manual_lock END,
        auto_state=CASE WHEN ?='auto' THEN 'completed' ELSE auto_state END WHERE work_id=? AND session_id=?`).run(title, source, source, source, workId, sessionId);
      const result = this.state(workId, sessionId);
      this.receipt(workId, sessionId, key, kind, requestDigest, result, now);
      return result;
    });
  }

  delete(workId: string, sessionId: string, expectedRevision: number, key: string, now = new Date().toISOString()): ManagedSessionState {
    this.validateWrite(workId, sessionId, key, expectedRevision);
    if (!validSessionTimestamp(now)) throw new SessionManagementError('SESSION_INVALID');
    const requestDigest = digest({ workId, sessionId, expectedRevision, kind: 'delete' });
    return this.transaction(() => {
      const replay = this.replay(workId, key, requestDigest);
      if (replay) return replay;
      this.ensureMetadata(workId, sessionId);
      const current = this.state(workId, sessionId);
      if (current.deletedAt) throw new SessionManagementError('SESSION_DELETED');
      if (current.revision !== expectedRevision) throw new SessionManagementError('SESSION_REVISION_CONFLICT');
      if (current.revision >= Number.MAX_SAFE_INTEGER) throw new SessionManagementError('SESSION_INVALID');
      const active = this.db.prepare("SELECT 1 FROM runs WHERE work_id=? AND session_id=? AND state IN ('accepted','running','cancelling') LIMIT 1").get(workId, sessionId);
      const request = this.db.prepare(`SELECT 1 FROM agent_requests q WHERE q.work_id=? AND q.disposition='live'
        AND q.state NOT IN ('completed','failed','cancelled') AND (
          EXISTS(SELECT 1 FROM runs r WHERE r.run_id=q.source_run_id AND r.work_id=? AND r.session_id=?) OR
          EXISTS(SELECT 1 FROM agent_request_runs a JOIN runs r ON r.run_id=a.run_id WHERE a.request_id=q.request_id AND r.work_id=? AND r.session_id=?)) LIMIT 1`)
        .get(workId, workId, sessionId, workId, sessionId);
      if (active || request) throw new SessionManagementError('SESSION_BUSY');
      const pending = this.db.prepare("SELECT auto_operation_key FROM session_management WHERE work_id=? AND session_id=? AND auto_state='pending'").get(workId, sessionId) as Row | undefined;
      this.db.prepare(`UPDATE session_management SET deleted_at=?,title_revision=title_revision+1,
        auto_state=CASE WHEN auto_state='pending' THEN 'unknown' ELSE auto_state END WHERE work_id=? AND session_id=?`).run(now, workId, sessionId);
      const result = this.state(workId, sessionId);
      if (typeof pending?.auto_operation_key === 'string' && pending.auto_operation_key.startsWith('explicit:')) {
        this.db.prepare("UPDATE session_management_operations SET operation_status='failed',result_json=? WHERE work_id=? AND operation_key=? AND operation_status='pending'")
          .run(JSON.stringify(result), workId, pending.auto_operation_key.slice('explicit:'.length));
      }
      this.receipt(workId, sessionId, key, 'delete', requestDigest, result, now);
      return result;
    });
  }

  claimAutomatic(workId: string, sessionId: string, runId: string): number | undefined {
    return this.transaction(() => {
      this.ensureMetadata(workId, sessionId);
      const current = this.state(workId, sessionId);
      if (current.deletedAt || current.manualLock || current.autoState !== 'eligible') return undefined;
      const run = this.db.prepare("SELECT 1 FROM runs WHERE work_id=? AND session_id=? AND run_id=? AND state='succeeded'").get(workId, sessionId, runId);
      if (!run) throw new SessionManagementError('SESSION_INVALID');
      this.db.prepare("UPDATE session_management SET auto_state='pending',auto_run_id=?,auto_revision=?,auto_operation_key=? WHERE work_id=? AND session_id=?")
        .run(runId, current.revision, `automatic:${runId}:${current.revision}`, workId, sessionId);
      return current.revision;
    });
  }

  beginExplicitAuto(workId: string, sessionId: string, runId: string, expectedRevision: number, key: string, now = new Date().toISOString()): { started: boolean; status: SessionOperationState; state: ManagedSessionState } {
    this.validateWrite(workId, sessionId, key, expectedRevision);
    if (!validIdentity(runId, 256) || !validSessionTimestamp(now)) throw new SessionManagementError('SESSION_INVALID');
    const requestDigest = digest({ workId, sessionId, runId, expectedRevision, kind: 'auto-name' });
    return this.transaction(() => {
      const prior = this.db.prepare('SELECT request_digest,operation_status,result_json FROM session_management_operations WHERE work_id=? AND operation_key=?').get(workId, key) as Row | undefined;
      if (prior) {
        if (prior.request_digest !== requestDigest) throw new SessionManagementError('SESSION_OPERATION_CONFLICT');
        return { started: false, status: prior.operation_status as SessionOperationState, state: parseManagedSessionState(String(prior.result_json)) };
      }
      this.ensureMetadata(workId, sessionId);
      const current = this.state(workId, sessionId);
      if (current.deletedAt) throw new SessionManagementError('SESSION_DELETED');
      if (current.revision !== expectedRevision) throw new SessionManagementError('SESSION_REVISION_CONFLICT');
      if (current.revision >= Number.MAX_SAFE_INTEGER) throw new SessionManagementError('SESSION_INVALID');
      if (current.autoState === 'pending') throw new SessionManagementError('SESSION_BUSY');
      if (!this.db.prepare("SELECT 1 FROM runs WHERE work_id=? AND session_id=? AND run_id=? AND state='succeeded'").get(workId, sessionId, runId)) throw new SessionManagementError('SESSION_INVALID');
      this.db.prepare("UPDATE session_management SET auto_state='pending',auto_run_id=?,auto_revision=?,auto_operation_key=? WHERE work_id=? AND session_id=?")
        .run(runId, expectedRevision, `explicit:${key}`, workId, sessionId);
      const state = this.state(workId, sessionId);
      this.receipt(workId, sessionId, key, 'auto-name', requestDigest, state, now);
      this.db.prepare("UPDATE session_management_operations SET operation_status='pending' WHERE work_id=? AND operation_key=?").run(workId, key);
      return { started: true, status: 'pending', state };
    });
  }

  finishExplicitAuto(workId: string, sessionId: string, runId: string, expectedRevision: number, key: string, value?: string): { status: SessionOperationState; state: ManagedSessionState } | undefined {
    return this.transaction(() => {
      const operation = this.lookup(workId, key);
      if (!operation || operation.sessionId !== sessionId || operation.kind !== 'auto-name') return undefined;
      if (operation.status !== 'pending') return { status: operation.status, state: operation.state };
      const pending = this.db.prepare("SELECT 1 FROM session_management WHERE work_id=? AND session_id=? AND auto_state='pending' AND auto_run_id=? AND auto_revision=? AND auto_operation_key=?")
        .get(workId, sessionId, runId, expectedRevision, `explicit:${key}`);
      const current = this.state(workId, sessionId);
      let title: string | undefined;
      try { if (value !== undefined) title = normalizeTitle(value); } catch { /* failed generation keeps the existing title */ }
      const accepted = !!pending && !current.deletedAt && current.revision === expectedRevision && !!title;
      if (accepted) {
        this.db.prepare("UPDATE session_management SET title=?,title_source='auto',title_revision=title_revision+1,auto_state='completed' WHERE work_id=? AND session_id=?")
          .run(title!, workId, sessionId);
      } else if (pending && !current.deletedAt) {
        this.db.prepare("UPDATE session_management SET auto_state='failed' WHERE work_id=? AND session_id=?").run(workId, sessionId);
      }
      const state = this.state(workId, sessionId), resultStatus = accepted ? 'accepted' : 'failed';
      this.db.prepare('UPDATE session_management_operations SET operation_status=?,result_json=? WHERE work_id=? AND operation_key=? AND operation_status=\'pending\'')
        .run(resultStatus, JSON.stringify(state), workId, key);
      return { status: resultStatus, state };
    });
  }

  completeAutomatic(workId: string, sessionId: string, runId: string, expectedRevision: number, value: string): boolean {
    return this.transaction(() => {
      const current = this.state(workId, sessionId);
      const pending = this.db.prepare("SELECT 1 FROM session_management WHERE work_id=? AND session_id=? AND auto_state='pending' AND auto_run_id=? AND auto_revision=? AND auto_operation_key=?")
        .get(workId, sessionId, runId, expectedRevision, `automatic:${runId}:${expectedRevision}`);
      if (!pending) return false;
      if (current.deletedAt || current.manualLock || current.revision !== expectedRevision || current.revision >= Number.MAX_SAFE_INTEGER) {
        this.db.prepare("UPDATE session_management SET auto_state='completed' WHERE work_id=? AND session_id=?").run(workId, sessionId);
        return false;
      }
      let title: string;
      try { title = normalizeTitle(value); }
      catch {
        this.db.prepare("UPDATE session_management SET auto_state='failed' WHERE work_id=? AND session_id=?").run(workId, sessionId);
        return false;
      }
      this.db.prepare("UPDATE session_management SET title=?,title_source='auto',title_revision=title_revision+1,auto_state='completed' WHERE work_id=? AND session_id=?")
        .run(title, workId, sessionId);
      return true;
    });
  }

  failAutomatic(workId: string, sessionId: string, runId: string, expectedRevision: number): boolean {
    return this.transaction(() => this.db.prepare(`UPDATE session_management SET auto_state='failed'
      WHERE work_id=? AND session_id=? AND auto_state='pending' AND auto_run_id=? AND auto_revision=? AND auto_operation_key=?`)
      .run(workId, sessionId, runId, expectedRevision, `automatic:${runId}:${expectedRevision}`).changes === 1);
  }

  markInterruptedAutomaticUnknown(workId: string): number {
    return this.transaction(() => {
      const pending = this.db.prepare("SELECT session_id,auto_operation_key FROM session_management WHERE work_id=? AND auto_state='pending'").all(workId) as Row[];
      this.db.prepare("UPDATE session_management SET auto_state='unknown' WHERE work_id=? AND auto_state='pending'").run(workId);
      for (const item of pending) if (typeof item.auto_operation_key === 'string' && item.auto_operation_key.startsWith('explicit:')) {
        const state = this.state(workId, String(item.session_id));
        this.db.prepare("UPDATE session_management_operations SET operation_status='unknown',result_json=? WHERE work_id=? AND operation_key=? AND operation_status='pending'")
          .run(JSON.stringify(state), workId, item.auto_operation_key.slice('explicit:'.length));
      }
      return pending.length;
    });
  }
}
