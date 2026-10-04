import type { DatabaseSync } from "node:sqlite";
import { WORK_SCHEMA_SQL } from "./brain-schema.js";
import { WORK_SCHEMA_OBJECTS } from "./schema-objects.js";

export const WORK_SCHEMA_VERSION = 4;

/** Initialize the current format or validate an existing database without changing it.
 * There is no upgrade path: imported SQL is never used as executable schema. */
export function migrateWorkDatabase(database: DatabaseSync): void {
  const objects = database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
  if (objects.length) {
    const normalize = (rows: readonly Record<string, unknown>[]) => JSON.stringify(rows.map((row) => ({ ...row,
      sql: typeof row.sql === "string" ? row.sql.replace(/\s+/g, " ").trim() : row.sql })));
    if (normalize(objects) !== normalize(WORK_SCHEMA_OBJECTS)) throw new Error("WORK_HISTORY_FORMAT_UNSUPPORTED");
    const version = database.prepare("SELECT version FROM schema_migrations").all();
    if (version.length !== 1 || version[0]?.version !== WORK_SCHEMA_VERSION) throw new Error("WORK_HISTORY_FORMAT_UNSUPPORTED");
    if (database.prepare("PRAGMA foreign_key_check").get() !== undefined
      || database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok"
      || database.prepare("SELECT 1 FROM submit_idempotency i JOIN runs r ON r.run_id=i.run_id WHERE i.work_id!=r.work_id OR i.submission_key!=r.submission_key LIMIT 1").get()) throw new Error("WORK_HISTORY_INVALID");
    return;
  }
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(WORK_SCHEMA_SQL);
    database.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)").run(WORK_SCHEMA_VERSION,new Date().toISOString());
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}
