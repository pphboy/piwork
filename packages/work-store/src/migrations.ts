import type { DatabaseSync } from "node:sqlite";
import { WORK_SCHEMA_SQL } from "./brain-schema.js";
import { WORK_SCHEMA_OBJECTS } from "./schema-objects.js";
import { LEGACY_SCHEMA_OBJECTS } from "./legacy-schema-objects.js";
import { MEMORY_SCHEMA_SQL } from "./memory-schema.js";
import { MEMORY_SCHEMA_OBJECTS } from "./memory-schema-objects.js";

export const WORK_SCHEMA_VERSION = 5;

export function sameSchema(actual: readonly Record<string, unknown>[], expected: readonly Record<string, unknown>[]): boolean {
  const normalize = (rows: readonly Record<string, unknown>[]) => JSON.stringify(rows.map((row) => ({ ...row,
    sql: typeof row.sql === "string" ? row.sql.replace(/\s+/g, " ").trim() : row.sql })));
  return normalize(actual) === normalize(expected);
}

export function validateLegacyWorkDatabase(database: DatabaseSync): void {
  if (!sameSchema(database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all(), LEGACY_SCHEMA_OBJECTS)
    || database.prepare("SELECT version FROM schema_migrations").all().length !== 1
    || database.prepare("SELECT version FROM schema_migrations").get()?.version !== 4
    || database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok"
    || database.prepare("PRAGMA foreign_key_check").get() !== undefined) throw new Error("WORK_HISTORY_FORMAT_UNSUPPORTED");
}

export function initializeMemoryDatabase(database: DatabaseSync): void {
  const objects = database.prepare("SELECT type,name,tbl_name,sql FROM memory.sqlite_master ORDER BY type,name").all();
  if (!objects.length) database.exec(MEMORY_SCHEMA_SQL.replace(/CREATE TABLE /g, "CREATE TABLE memory.").replace(/CREATE INDEX /g, "CREATE INDEX memory."));
  else if (!sameSchema(objects, MEMORY_SCHEMA_OBJECTS)) throw new Error("WORK_MEMORY_FORMAT_UNSUPPORTED");
  if (database.prepare("PRAGMA memory.integrity_check").get()?.integrity_check !== "ok"
    || database.prepare("PRAGMA memory.foreign_key_check").get() !== undefined) throw new Error("WORK_MEMORY_INVALID");
}

/** Exact current main schema. Legacy conversion requires separate Core authorization. */
export function migrateWorkDatabase(database: DatabaseSync): void {
  const objects = database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
  if (objects.length) {
    if (!sameSchema(objects, WORK_SCHEMA_OBJECTS)) throw new Error("WORK_HISTORY_FORMAT_UNSUPPORTED");
    const version = database.prepare("SELECT version FROM schema_migrations").all();
    if (version.length !== 1 || version[0]?.version !== WORK_SCHEMA_VERSION) throw new Error("WORK_HISTORY_FORMAT_UNSUPPORTED");
    if (database.prepare("PRAGMA foreign_key_check").get() !== undefined
      || database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok"
      || database.prepare("SELECT 1 FROM submit_idempotency i JOIN runs r ON r.run_id=i.run_id WHERE i.work_id!=r.work_id OR i.submission_key!=r.submission_key LIMIT 1").get()) throw new Error("WORK_HISTORY_INVALID");
    return;
  }
  const ownsTransaction = !database.isTransaction;
  if (ownsTransaction) database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(WORK_SCHEMA_SQL);
    database.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)").run(WORK_SCHEMA_VERSION,new Date().toISOString());
    if (ownsTransaction) database.exec("COMMIT");
  } catch (error) { if (ownsTransaction && database.isTransaction) database.exec("ROLLBACK"); throw error; }
}
