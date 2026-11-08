import type { DatabaseSync } from "node:sqlite";
import { WORK_SCHEMA_V7_SQL } from "./schema-v7.js";
import { WORK_SCHEMA_V7_OBJECTS } from "./schema-v7-objects.js";
import { WORK_SCHEMA_V8_SQL } from "./schema-v8.js";
import { WORK_SCHEMA_V8_OBJECTS } from "./schema-v8-objects.js";
import { WORK_SCHEMA_V5_OBJECTS } from "./schema-v5-objects.js";
import { WORK_SCHEMA_V5_SQL } from "./schema-v5.js";
import { LEGACY_SCHEMA_OBJECTS } from "./legacy-schema-objects.js";
import { MEMORY_SCHEMA_SQL } from "./memory-schema.js";
import { MEMORY_SCHEMA_OBJECTS } from "./memory-schema-objects.js";
import { WORK_SCHEMA_V6_SQL } from "./schema-v6.js";
import { WORK_SCHEMA_V6_OBJECTS } from "./schema-v6-objects.js";

export const WORK_SCHEMA_VERSION = 8;

/** Run only after Core has authorized and backed up the stopped Work. */
export function upgradeWorkDatabaseToV8(database: DatabaseSync, now = new Date().toISOString()): void {
  if (database.isTransaction) throw new Error('WORK_HISTORY_UPGRADE_TRANSACTION_ACTIVE');
  database.exec('BEGIN IMMEDIATE');
  try {
    const objects = database.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
    const versions = database.prepare('SELECT version FROM schema_migrations').all();
    if (versions.length === 1 && versions[0]?.version === 8 && sameSchema(objects, WORK_SCHEMA_V8_OBJECTS)) {
      if (database.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' || database.prepare('PRAGMA foreign_key_check').get()) throw new Error('WORK_HISTORY_INVALID');
      database.exec('COMMIT');
      return;
    }
    if (versions.length !== 1 || versions[0]?.version !== 7 || !sameSchema(objects, WORK_SCHEMA_V7_OBJECTS)) throw new Error('WORK_HISTORY_FORMAT_UNSUPPORTED');
    if (database.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' || database.prepare('PRAGMA foreign_key_check').get()
      || database.prepare('SELECT 1 FROM submit_idempotency i JOIN runs r ON r.run_id=i.run_id WHERE i.work_id!=r.work_id OR i.submission_key!=r.submission_key LIMIT 1').get()) throw new Error('WORK_HISTORY_INVALID');
    if (database.prepare("SELECT 1 FROM runs WHERE state IN ('accepted','running','cancelling') LIMIT 1").get() || database.prepare('SELECT 1 FROM work_activity LIMIT 1').get()) throw new Error('WORK_HISTORY_BUSY');
    const offset = WORK_SCHEMA_V8_SQL.indexOf('-- Session management metadata');
    if (offset < 0) throw new Error('WORK_HISTORY_FORMAT_UNSUPPORTED');
    database.exec(WORK_SCHEMA_V8_SQL.slice(offset));
    if (database.prepare('UPDATE schema_migrations SET version=8, applied_at=? WHERE version=7').run(now).changes !== 1
      || !sameSchema(database.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all(), WORK_SCHEMA_V8_OBJECTS)
      || database.prepare('PRAGMA foreign_key_check').get()) throw new Error('WORK_HISTORY_FORMAT_UNSUPPORTED');
    database.exec('COMMIT');
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    throw error;
  }
}

/** Explicit stopped-Work upgrade. The caller must not enable schema 6 until
 * Core, snapshot helpers and the active Agent all support the new format. */
export function upgradeWorkDatabaseToV6(database: DatabaseSync, now = new Date().toISOString()): void {
  if (database.isTransaction) throw new Error('WORK_HISTORY_UPGRADE_TRANSACTION_ACTIVE');
  database.exec('BEGIN IMMEDIATE');
  try {
    const objects=database.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
    const versions=database.prepare('SELECT version FROM schema_migrations').all();
    if (versions.length===1 && versions[0]?.version===6 && sameSchema(objects,WORK_SCHEMA_V6_OBJECTS)) {
      if(database.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok' || database.prepare('PRAGMA foreign_key_check').get()!==undefined)throw new Error('WORK_HISTORY_INVALID');
      database.exec('COMMIT');return;
    }
    if (!sameSchema(objects,WORK_SCHEMA_V5_OBJECTS) || versions.length!==1 || versions[0]?.version!==5) throw new Error('WORK_HISTORY_FORMAT_UNSUPPORTED');
    if (database.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok' || database.prepare('PRAGMA foreign_key_check').get()!==undefined || database.prepare('SELECT 1 FROM submit_idempotency i JOIN runs r ON r.run_id=i.run_id WHERE i.work_id!=r.work_id OR i.submission_key!=r.submission_key LIMIT 1').get()) throw new Error('WORK_HISTORY_INVALID');
    if (database.prepare("SELECT 1 FROM runs WHERE state IN ('accepted','running','cancelling') LIMIT 1").get() || database.prepare('SELECT 1 FROM work_activity LIMIT 1').get()) throw new Error('WORK_HISTORY_BUSY');
    const offset=WORK_SCHEMA_V6_SQL.indexOf('CREATE TABLE run_output_chunks');
    if(offset<0)throw new Error('WORK_HISTORY_FORMAT_UNSUPPORTED');
    database.exec(WORK_SCHEMA_V6_SQL.slice(offset));
    database.prepare('UPDATE schema_migrations SET version=6, applied_at=? WHERE version=5').run(now);
    if(!sameSchema(database.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all(),WORK_SCHEMA_V6_OBJECTS))throw new Error('WORK_HISTORY_FORMAT_UNSUPPORTED');
    database.exec('COMMIT');
  } catch(error) {if(database.isTransaction)database.exec('ROLLBACK');throw error;}
}

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
export function validatePreviousWorkDatabase(database: DatabaseSync): void {
  const version = Number(database.prepare("SELECT version FROM schema_migrations").get()?.version);
  if(!sameSchema(database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all(), version === 5 ? WORK_SCHEMA_V5_OBJECTS : version === 6 ? WORK_SCHEMA_V6_OBJECTS : WORK_SCHEMA_V7_OBJECTS)
    || ![5,6,7].includes(version)
    || database.prepare("SELECT version FROM schema_migrations").all().length!==1
    || database.prepare("PRAGMA integrity_check").get()?.integrity_check!=="ok"
    || database.prepare("PRAGMA foreign_key_check").get())throw new Error("WORK_HISTORY_FORMAT_UNSUPPORTED");
}

export function migrateWorkDatabase(database: DatabaseSync, freshVersion: 5 | 6 | 7 | 8 = WORK_SCHEMA_VERSION): void {
  const objects = database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
  if (objects.length) {
    const version = database.prepare("SELECT version FROM schema_migrations").all();
    const valid5=version.length===1 && version[0]?.version===5 && sameSchema(objects,WORK_SCHEMA_V5_OBJECTS);
    const valid6=version.length===1 && version[0]?.version===6 && sameSchema(objects,WORK_SCHEMA_V6_OBJECTS);
    const valid7=version.length===1 && version[0]?.version===7 && sameSchema(objects,WORK_SCHEMA_V7_OBJECTS);
    const valid8=version.length===1 && version[0]?.version===8 && sameSchema(objects,WORK_SCHEMA_V8_OBJECTS);
    if (!(freshVersion === 5 ? valid5 : freshVersion === 6 ? valid6 : freshVersion === 7 ? valid7 : valid8)) throw new Error("WORK_HISTORY_FORMAT_UNSUPPORTED");
    if (database.prepare("PRAGMA foreign_key_check").get() !== undefined
      || database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok"
      || database.prepare("SELECT 1 FROM submit_idempotency i JOIN runs r ON r.run_id=i.run_id WHERE i.work_id!=r.work_id OR i.submission_key!=r.submission_key LIMIT 1").get()) throw new Error("WORK_HISTORY_INVALID");
    return;
  }
  const ownsTransaction = !database.isTransaction;
  if (ownsTransaction) database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(freshVersion === 5 ? WORK_SCHEMA_V5_SQL : freshVersion === 6 ? WORK_SCHEMA_V6_SQL : freshVersion === 7 ? WORK_SCHEMA_V7_SQL : WORK_SCHEMA_V8_SQL);
    database.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)").run(freshVersion,new Date().toISOString());
    if (ownsTransaction) database.exec("COMMIT");
  } catch (error) { if (ownsTransaction && database.isTransaction) database.exec("ROLLBACK"); throw error; }
}
