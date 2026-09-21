import type { DatabaseSync } from "node:sqlite";

export const WORK_SCHEMA_VERSION = 3;

export function migrateWorkDatabase(database: DatabaseSync): void {
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  ) STRICT`);
  const row = database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as {
    version: number;
  };
  if (row.version >= WORK_SCHEMA_VERSION) return;

  database.exec("BEGIN IMMEDIATE");
  try {
    if (row.version < 1) database.exec(`CREATE TABLE sessions (
      work_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      sdk_history_path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(work_id, session_id)
    ) STRICT`);
    if (row.version < 1) database.exec(`CREATE TABLE runs (
      work_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      run_id TEXT PRIMARY KEY,
      submission_key TEXT NOT NULL,
      prompt_digest TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN (
        'accepted', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled', 'interrupted'
      )),
      final_text TEXT,
      error_json TEXT,
      accepted_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      earliest_available_sequence INTEGER NOT NULL DEFAULT 1,
      latest_sequence INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(work_id, session_id) REFERENCES sessions(work_id, session_id)
    ) STRICT`);
    if (row.version < 1) database.exec(`CREATE TABLE run_events (
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      sequence INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(run_id, sequence)
    ) STRICT`);
    if (row.version < 1) database.exec(`CREATE TABLE submit_idempotency (
      work_id TEXT NOT NULL,
      submission_key TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      created_at TEXT NOT NULL,
      PRIMARY KEY(work_id, submission_key)
    ) STRICT`);
    if (row.version < 1) database.exec(`CREATE TABLE work_activity (
      work_id TEXT PRIMARY KEY,
      active_run_id TEXT NOT NULL UNIQUE REFERENCES runs(run_id),
      acquired_at TEXT NOT NULL
    ) STRICT`);
    if (row.version < 1) database.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (1, ?)").run(new Date().toISOString());
    if (row.version < 2) {
      database.exec(`CREATE TABLE session_idempotency (
        work_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(work_id, idempotency_key),
        FOREIGN KEY(work_id, session_id) REFERENCES sessions(work_id, session_id)
      ) STRICT`);
      database.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (2, ?)").run(new Date().toISOString());
    }
    if (row.version < 3) {
      if (!hasColumn(database, "sessions", "active_context_identity")) database.exec("ALTER TABLE sessions ADD COLUMN active_context_identity TEXT");
      if (!hasColumn(database, "runs", "context_identity")) database.exec("ALTER TABLE runs ADD COLUMN context_identity TEXT");
      database.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (3, ?)").run(new Date().toISOString());
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function hasColumn(database: DatabaseSync, table: string, column: string): boolean {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>).some((item) => item.name === column);
}
