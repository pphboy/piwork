import { constants, openSync, closeSync, fstatSync, readSync, writeSync, fsyncSync, mkdtempSync, rmSync, fchmodSync, fchownSync, renameSync, unlinkSync, chownSync } from "node:fs";
import { join, isAbsolute, normalize } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { migrateWorkDatabase, initializeMemoryDatabase } from "./migrations.js";
import { LEGACY_SCHEMA_SQL } from "./legacy-schema.js";
import { LEGACY_SCHEMA_OBJECTS } from "./legacy-schema-objects.js";
import { WORK_SCHEMA_OBJECTS } from "./schema-objects.js";
import { randomUUID } from "node:crypto";
import { MEMORY_TABLES } from "./snapshot-memory.js";
import { validateBrainHistory } from "./snapshot-brain.js";
import { normalizeModelBaseUrl, type RunModelSnapshot } from "@piwork/contracts";

export class WorkHistoryValidationError extends Error {
  constructor(readonly code: "SNAPSHOT_HISTORY_INVALID" | "SNAPSHOT_HISTORY_BUSY" | "SNAPSHOT_HISTORY_UNSUPPORTED" | "SNAPSHOT_HISTORY_LIMIT") { super(code); this.name = "WorkHistoryValidationError"; }
}
function invalid(): never { throw new WorkHistoryValidationError("SNAPSHOT_HISTORY_INVALID"); }
const BASE_TABLES = ["schema_migrations", "sessions", "runs", "run_events", "submit_idempotency", "session_idempotency", "work_activity"] as const;
const TABLES = [...BASE_TABLES, "service_events", "agent_requests", "agent_request_runs", "agent_evidence", "brain_experience_revisions", "brain_experience_heads"] as const;
const CURRENT_TABLES = [...BASE_TABLES, "service_events", "agent_requests", "agent_request_runs", "agent_evidence", "work_memory_binding"] as const;
type Table = typeof TABLES[number] | typeof CURRENT_TABLES[number];
const tables = (version: 4 | 5): readonly Table[] => version === 4 ? TABLES : CURRENT_TABLES;
type Row = Record<string, SQLInputValue>;
const FILES = ["work.sqlite", "work.sqlite-wal", "work.sqlite-shm"] as const;
const MAX_ROWS = 1_000_000, MAX_ROW_BYTES = 64 * 1024 ** 2;

interface SchemaRow { type: string; name: string; tbl_name: string; sql: string | null }
function schema(database: DatabaseSync): SchemaRow[] {
  return database.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all() as unknown as SchemaRow[];
}
function sameSchema(actual: SchemaRow[], expected: SchemaRow[]): boolean {
  const normalized = (rows: SchemaRow[]) => rows.map((row) => [row.type, row.name, row.tbl_name, row.sql?.replace(/\s+/g, " ").trim() ?? null]);
  return JSON.stringify(normalized(actual)) === JSON.stringify(normalized(expected));
}
function directory(path: string): number {
  if (!isAbsolute(path) || normalize(path) !== path) invalid();
  let fd = openSync("/", constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    for (const part of path.split("/").filter(Boolean)) {
      const next = openSync(`/proc/self/fd/${fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      closeSync(fd); fd = next;
    }
    return fd;
  } catch (error) { closeSync(fd); throw error; }
}
function regular(root: number, relative: string): number {
  const parts = relative.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\0"))) invalid();
  let parent = root;
  try {
    for (const part of parts.slice(0, -1)) {
      const fd = openSync(`/proc/self/fd/${parent}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      if (parent !== root) closeSync(parent); parent = fd;
    }
    const fd = openSync(`/proc/self/fd/${parent}/${parts.at(-1)!}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!fstatSync(fd).isFile()) { closeSync(fd); invalid(); }
    return fd;
  } finally { if (parent !== root) closeSync(parent); }
}
function copy(fd: number, target: string): void {
  const before = fstatSync(fd, { bigint: true });
  const output = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024); let length: number;
    while ((length = readSync(fd, buffer)) > 0) {
      for (let offset = 0; offset < length;) { const count = writeSync(output, buffer, offset, length - offset); if (!count) invalid(); offset += count; }
    }
    fsyncSync(output);
    const after = fstatSync(fd, { bigint: true });
    for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs", "mode", "uid", "gid", "nlink"] as const) if (before[key] !== after[key]) invalid();
  } finally { closeSync(output); }
}
function nonempty(value: SQLInputValue | undefined): value is string { return typeof value === "string" && value.length > 0 && !value.includes("\0"); }
function timestamp(value: SQLInputValue | undefined): boolean { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function integer(value: SQLInputValue | undefined, minimum = 0): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum; }

export interface WorkHistoryScope {
  readonly sourceWorkId: string;
  readonly contextIds: ReadonlySet<string>;
  /** Private helper-owned writable directory, not an input package path. */
  readonly scratchDirectory: string;
  /** Upload validation may prove regular SDK files against an already verified package tree. */
  readonly sdkPathIsRegular?: (path: string) => boolean;
}
export interface WorkHistorySummary { readonly sessions: number; readonly runs: number; readonly events: number }

/** Only call inside the isolated trusted helper (tests may call directly).
 * The source database is never opened by SQLite: a byte copy is read-only validated first. */
export class WorkHistorySnapshot {
  private closed = false;
  private constructor(private readonly database: DatabaseSync, private readonly scratch: string, readonly scope: WorkHistoryScope, readonly summary: WorkHistorySummary, readonly schemaVersion: 4 | 5) {}

  static open(privateDirectory: string, scope: WorkHistoryScope, stoppedWriterInspection = false): WorkHistorySnapshot | undefined {
    let root: number | undefined, scratch: string | undefined, database: DatabaseSync | undefined;
    try {
      root = directory(privateDirectory);
      let main: number;
      try { main = regular(root, FILES[0]); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        for (const name of [...FILES.slice(1), "memory.sqlite", "memory.sqlite-journal", "work.sqlite-journal"]) {
          try { const fd = regular(root, name); closeSync(fd); invalid(); }
          catch (sidecarError) { if ((sidecarError as NodeJS.ErrnoException).code !== "ENOENT") throw sidecarError; }
        }
        return undefined;
      }
      try {
        scratch = mkdtempSync(join(scope.scratchDirectory, "work-history-"));
        const scratchParent = directory(scope.scratchDirectory);
        try { const owner = fstatSync(scratchParent); chownSync(scratch, owner.uid, owner.gid); }
        finally { closeSync(scratchParent); }
        copy(main, join(scratch, FILES[0]));
      } finally { closeSync(main); }
      for (const name of FILES.slice(1)) {
        let fd: number;
        try { fd = regular(root, name); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
        try { copy(fd, join(scratch, name)); } finally { closeSync(fd); }
      }
      database = new DatabaseSync(join(scratch, FILES[0]), { readOnly: true, allowExtension: false, enableDoubleQuotedStringLiterals: false, enableForeignKeyConstraints: true });
      database.exec("PRAGMA trusted_schema = OFF; PRAGMA query_only = ON; PRAGMA busy_timeout = 1000");
      const actual = schema(database);
      const version: 4 | 5 = sameSchema(actual, WORK_SCHEMA_OBJECTS as unknown as SchemaRow[]) ? 5
        : sameSchema(actual, LEGACY_SCHEMA_OBJECTS as unknown as SchemaRow[]) ? 4 : (() => { throw new WorkHistoryValidationError("SNAPSHOT_HISTORY_UNSUPPORTED"); })();
      if (version === 5) {
        for (const name of ["work.sqlite-journal", "memory.sqlite-journal"]) {
          try { const fd = regular(root, name); closeSync(fd); throw new WorkHistoryValidationError("SNAPSHOT_HISTORY_BUSY"); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        }
        const memory = regular(root, "memory.sqlite");
        try { copy(memory, join(scratch, "memory.sqlite")); } finally { closeSync(memory); }
        database.prepare("ATTACH DATABASE ? AS memory").run(`file:${join(scratch, "memory.sqlite")}?mode=ro`);
      }
      const integrity = database.prepare("PRAGMA integrity_check").all();
      if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok" || database.prepare("PRAGMA foreign_key_check").get() !== undefined) invalid();
      const summary = validateRows(database, root, scope, version, stoppedWriterInspection);
      const result = new WorkHistorySnapshot(database, scratch, scope, summary, version); database = undefined; scratch = undefined;
      return result;
    } catch (error) {
      if (error instanceof WorkHistoryValidationError) throw error;
      throw new WorkHistoryValidationError("SNAPSHOT_HISTORY_INVALID");
    } finally {
      database?.close(); if (root !== undefined) closeSync(root);
      if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
    }
  }

  /** Rebuild only the platform DB in an unpublished new private volume; never user DBs/SDK text. */
  rebuild(targetPrivateDirectory: string, targetWorkId: string, contexts: ReadonlyMap<string, string>, models: readonly RunModelSnapshot[] = [], operations: ReadonlyMap<string, string> = new Map()): void {
    if (this.closed || !nonempty(targetWorkId) || targetWorkId === this.scope.sourceWorkId) invalid();
    if (contexts.size !== this.scope.contextIds.size || new Set(contexts.values()).size !== contexts.size || [...this.scope.contextIds].some((id) => !nonempty(contexts.get(id)))) invalid();
    const root = directory(targetPrivateDirectory);
    let staged: string | undefined, target: DatabaseSync | undefined;
    try {
      const original = regular(root, FILES[0]); const attributes = fstatSync(original); closeSync(original);
      // Exclusive temporary name inside the trusted target directory. No source SQL is executed.
      const temporaryDirectory = mkdtempSync(`/proc/self/fd/${root}/.work-history-`);
      staged = temporaryDirectory;
      const path = join(temporaryDirectory, FILES[0]);
      target = new DatabaseSync(path, { allowExtension: false, enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false });
      target.exec("PRAGMA trusted_schema = OFF; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL");
      if (this.schemaVersion === 4) target.exec(LEGACY_SCHEMA_SQL);
      else {
        migrateWorkDatabase(target);
        target.prepare("ATTACH DATABASE ? AS memory").run(join(temporaryDirectory, "memory.sqlite"));
        target.exec("PRAGMA memory.journal_mode=DELETE; PRAGMA memory.synchronous=FULL");
        initializeMemoryDatabase(target);
      }
      target.exec("BEGIN IMMEDIATE; PRAGMA defer_foreign_keys = ON; DELETE FROM schema_migrations");
      try {
        const storeId = randomUUID();
        for (const table of tables(this.schemaVersion)) {
          const columns = (target.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
          const insert = target.prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
          for (const source of this.database.prepare(`SELECT * FROM ${table}`).iterate()) {
            const row = { ...source } as Row;
            if (Object.hasOwn(row, "work_id")) row.work_id = targetWorkId;
            if (table === "work_memory_binding") row.store_id = storeId;
            for (const field of ["active_context_identity", "context_identity"]) if (typeof row[field] === "string") row[field] = contexts.get(row[field]) ?? invalid();
            if (["service_events", "agent_requests", "agent_request_runs"].includes(table)) row.disposition = "historical";
            if (table === "agent_requests" && row.package_submission_json !== null) {
              const submission = JSON.parse(String(row.package_submission_json)) as Record<string, unknown>;
              if (typeof submission.activeContextId === "string") submission.activeContextId = contexts.get(submission.activeContextId) ?? invalid();
              row.package_submission_json = JSON.stringify(submission);
            }
            if (table === "agent_requests" && row.wait_ref_json !== null) {
              const ref = JSON.parse(String(row.wait_ref_json)) as { kind: string; id: string };
              if (["package-operation", "apply"].includes(ref.kind)) { ref.id = operations.get(ref.id) ?? invalid(); row.wait_ref_json = JSON.stringify(ref); }
            }
            if (table === "agent_evidence" && row.kind === "package" && typeof row.object_ref === "string" && operations.has(row.object_ref)) row.object_ref = operations.get(row.object_ref)!;
            if (table === "agent_evidence" && row.details_json !== null) {
              const details = JSON.parse(String(row.details_json)) as Record<string, unknown>;
              if (details.verificationContractVersion === 1) {
                details.contextIdentity = contexts.get(String(details.contextIdentity)) ?? invalid();
                row.details_json = JSON.stringify(details);
              }
            }
            if (table === "sessions" && row.model_preference_json !== null) row.model_preference_json = rebindPreference(String(row.model_preference_json), models);
            // run_events payload_json is user text, not a WorkId-bearing DTO. Public RunEvent
            // envelope workId is derived from the rebuilt runs row by AgentApplication.
            insert.run(...columns.map((column) => row[column]!));
          }
        }
        if (this.schemaVersion === 5) {
          for (const table of MEMORY_TABLES) {
            const columns = (target.prepare(`PRAGMA memory.table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
            const insert = target.prepare(`INSERT INTO memory.${table}(${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
            for (const source of this.database.prepare(`SELECT * FROM memory.${table}`).iterate()) {
              const row = { ...source } as Row;
              if (table === "memory_meta") { row.work_id = targetWorkId; row.store_id = storeId; }
              insert.run(...columns.map((column) => row[column]!));
            }
          }
          if (target.prepare("PRAGMA memory.foreign_key_check").get()) invalid();
        }
        if (target.prepare("PRAGMA foreign_key_check").get() !== undefined) invalid();
        target.exec("COMMIT");
      } catch (error) { target.exec("ROLLBACK"); throw error; }
      target.close(); target = undefined;
      const file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { fchownSync(file, attributes.uid, attributes.gid); fchmodSync(file, attributes.mode & 0o7777); fsyncSync(file); }
      finally { closeSync(file); }
      if (this.schemaVersion === 5) {
        const memoryPath = join(temporaryDirectory, "memory.sqlite");
        const memoryFD = openSync(memoryPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { fchownSync(memoryFD, attributes.uid, attributes.gid); fchmodSync(memoryFD, 0o600); fsyncSync(memoryFD); }
        finally { closeSync(memoryFD); }
        const originalMemory = regular(root, "memory.sqlite"); closeSync(originalMemory);
        renameSync(memoryPath, `/proc/self/fd/${root}/memory.sqlite`);
      }
      renameSync(path, `/proc/self/fd/${root}/${FILES[0]}`);
      for (const name of FILES.slice(1)) {
        try { const fd = regular(root, name); closeSync(fd); unlinkSync(`/proc/self/fd/${root}/${name}`); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      fsyncSync(root);
    } catch (error) {
      if (error instanceof WorkHistoryValidationError) throw error;
      throw new WorkHistoryValidationError("SNAPSHOT_HISTORY_INVALID");
    } finally { target?.close(); if (staged !== undefined) rmSync(staged, { recursive: true, force: true }); closeSync(root); }
  }

  close(): void { if (this.closed) return; this.closed = true; this.database.close(); rmSync(this.scratch, { recursive: true, force: true }); }
}

function validateRows(database: DatabaseSync, privateRoot: number, scope: WorkHistoryScope, version: 4 | 5, inspection: boolean): WorkHistorySummary {
  if (!nonempty(scope.sourceWorkId)) invalid();
  let count = 0; const counts = new Map<Table, number>();
  for (const table of tables(version)) {
    let tableCount = 0;
    for (const row of database.prepare(`SELECT * FROM ${table}`).iterate() as Iterable<Row>) {
      if (++count > MAX_ROWS) throw new WorkHistoryValidationError("SNAPSHOT_HISTORY_LIMIT"); tableCount++;
      let bytes = 0;
      for (const value of Object.values(row)) { if (typeof value === "string") bytes += Buffer.byteLength(value); else if (value !== null && (typeof value !== "number" || !Number.isSafeInteger(value))) invalid(); }
      if (bytes > MAX_ROW_BYTES) throw new WorkHistoryValidationError("SNAPSHOT_HISTORY_LIMIT");
      if (Object.hasOwn(row, "work_id") && row.work_id !== scope.sourceWorkId) invalid();
      for (const field of ["active_context_identity", "context_identity"]) if (Object.hasOwn(row, field) && row[field] !== null && (typeof row[field] !== "string" || !scope.contextIds.has(row[field]))) invalid();
      for (const field of ["created_at", "updated_at", "accepted_at", "applied_at"]) if (Object.hasOwn(row, field) && !timestamp(row[field])) invalid();
      if (table === "schema_migrations" && row.version !== version) throw new WorkHistoryValidationError("SNAPSHOT_HISTORY_UNSUPPORTED");
      if (table === "sessions") {
        if (!nonempty(row.session_id) || typeof row.sdk_history_path !== "string" || !row.sdk_history_path.startsWith("/var/data/sessions/")) invalid();
        if (scope.sdkPathIsRegular) { if (!scope.sdkPathIsRegular(row.sdk_history_path)) invalid(); }
        else { const sdk = regular(privateRoot, row.sdk_history_path.slice("/var/data/".length)); closeSync(sdk); }
      } else if (table === "runs") {
        if (!inspection && !["succeeded", "failed", "cancelled", "interrupted"].includes(row.state as string)) throw new WorkHistoryValidationError("SNAPSHOT_HISTORY_BUSY");
        if (!nonempty(row.run_id) || !nonempty(row.session_id) || !nonempty(row.submission_key) || !nonempty(row.prompt_digest) || (!inspection && !timestamp(row.finished_at)) || (row.started_at !== null && !timestamp(row.started_at)) || !integer(row.earliest_available_sequence, 1) || !integer(row.latest_sequence) || row.latest_sequence < row.earliest_available_sequence - 1) invalid();
      } else if (table === "run_events") {
        if (!integer(row.sequence, 1) || !nonempty(row.event_type) || typeof row.payload_json !== "string") invalid();
      } else if (table === "submit_idempotency") {
        if (!nonempty(row.submission_key) || !nonempty(row.request_digest)) invalid();
      } else if (table === "session_idempotency") {
        if (!nonempty(row.idempotency_key)) invalid();
      } else if (table === "work_activity" && !inspection) throw new WorkHistoryValidationError("SNAPSHOT_HISTORY_BUSY");
    }
    counts.set(table, tableCount);
  }
  if (counts.get("schema_migrations") !== 1) throw new WorkHistoryValidationError("SNAPSHOT_HISTORY_UNSUPPORTED");
  if (database.prepare(`SELECT 1 FROM submit_idempotency i JOIN runs r ON r.run_id = i.run_id WHERE i.work_id != r.work_id OR i.submission_key != r.submission_key LIMIT 1`).get()) invalid();
  if (database.prepare(`SELECT 1 FROM runs r LEFT JOIN run_events e ON e.run_id = r.run_id GROUP BY r.run_id
    HAVING COUNT(e.sequence) != r.latest_sequence - r.earliest_available_sequence + 1
      OR (COUNT(e.sequence) > 0 AND (MIN(e.sequence) != r.earliest_available_sequence OR MAX(e.sequence) != r.latest_sequence)) LIMIT 1`).get()) invalid();
  validateBrainHistory(database, scope.sourceWorkId, scope.contextIds);
  return { sessions: counts.get("sessions")!, runs: counts.get("runs")!, events: counts.get("run_events")! };
}

function rebindPreference(encoded: string, models: readonly RunModelSnapshot[]): string {
  const preference = JSON.parse(encoded) as RunModelSnapshot & { availability?: string };
  if (preference.modelRef === null) return JSON.stringify({ ...preference, availability: "available" });
  const matches = models.filter((candidate) => candidate.provider === preference.provider && candidate.model === preference.model
    && normalizeModelBaseUrl(candidate.baseUrl) === normalizeModelBaseUrl(preference.baseUrl));
  return JSON.stringify(matches.length === 1 ? { ...matches[0], ...(preference.thinkingLevel === undefined ? {} : { thinkingLevel: preference.thinkingLevel }), availability: "available" } : { ...preference, availability: "unavailable" });
}
