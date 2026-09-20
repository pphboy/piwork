import type { DatabaseSync } from "node:sqlite";

export const CORE_SCHEMA_VERSION = 3;

interface Migration {
  readonly version: number;
  readonly statements: readonly string[];
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE users (
        id TEXT PRIMARY KEY,
        account TEXT NOT NULL UNIQUE,
        password_digest TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE login_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        token_digest TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE works (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        desired_state TEXT NOT NULL,
        observed_state TEXT NOT NULL,
        desired_revision INTEGER NOT NULL,
        active_revision INTEGER,
        control_version INTEGER NOT NULL,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(owner_user_id, name)
      ) STRICT`,
      `CREATE TABLE work_config_revisions (
        work_id TEXT NOT NULL REFERENCES works(id),
        revision INTEGER NOT NULL,
        config_json TEXT NOT NULL,
        resolved_image_digest TEXT,
        created_by_user_id TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        PRIMARY KEY(work_id, revision)
      ) STRICT`,
      `CREATE TABLE service_revisions (
        work_id TEXT NOT NULL REFERENCES works(id),
        service_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        definition_json TEXT NOT NULL,
        resolved_image_digest TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY(work_id, service_id, revision)
      ) STRICT`,
      `CREATE TABLE service_heads (
        work_id TEXT NOT NULL REFERENCES works(id),
        service_id TEXT NOT NULL,
        name TEXT NOT NULL,
        desired_revision INTEGER NOT NULL,
        applied_revision INTEGER,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        observed_state TEXT NOT NULL,
        tombstoned_at TEXT,
        last_error_json TEXT,
        PRIMARY KEY(work_id, service_id),
        UNIQUE(work_id, name)
      ) STRICT`,
      `CREATE TABLE operations (
        id TEXT PRIMARY KEY,
        work_id TEXT REFERENCES works(id),
        service_id TEXT,
        kind TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'succeeded', 'failed', 'superseded')),
        target_version INTEGER NOT NULL,
        request_json TEXT NOT NULL,
        result_json TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE idempotency_records (
        principal_id TEXT NOT NULL,
        work_scope TEXT NOT NULL,
        operation_kind TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_digest TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        operation_id TEXT REFERENCES operations(id),
        created_at TEXT NOT NULL,
        PRIMARY KEY(principal_id, work_scope, operation_kind, idempotency_key)
      ) STRICT`,
      `CREATE TABLE resource_bindings (
        installation_id TEXT NOT NULL,
        work_id TEXT NOT NULL,
        resource_kind TEXT NOT NULL,
        logical_id TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        labels_json TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        PRIMARY KEY(installation_id, resource_kind, logical_id)
      ) STRICT`,
      `CREATE TABLE volume_records (
        id TEXT PRIMARY KEY,
        installation_id TEXT NOT NULL,
        work_id TEXT NOT NULL,
        service_id TEXT,
        runtime_name TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL,
        reference_count INTEGER NOT NULL,
        retained_at TEXT,
        purged_at TEXT,
        created_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE quota_reservations (
        work_id TEXT NOT NULL,
        subject_kind TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        desired_cpu_millis INTEGER NOT NULL,
        desired_memory_bytes INTEGER NOT NULL,
        occupied_cpu_millis INTEGER NOT NULL,
        occupied_memory_bytes INTEGER NOT NULL,
        service_slots INTEGER NOT NULL,
        volume_slots INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(work_id, subject_kind, subject_id)
      ) STRICT`,
      `CREATE TABLE runtime_generations (
        work_id TEXT NOT NULL REFERENCES works(id),
        generation INTEGER NOT NULL,
        instance_id TEXT,
        state TEXT NOT NULL,
        certificate_serial TEXT,
        retry_count INTEGER NOT NULL,
        retry_window_started_at TEXT,
        next_retry_at TEXT,
        ready_since TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(work_id, generation)
      ) STRICT`,
      `CREATE TABLE catalog_entries (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('agent_image', 'skill', 'model')),
        name TEXT NOT NULL,
        mutable_reference TEXT,
        resolved_digest TEXT,
        metadata_json TEXT NOT NULL,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(kind, name)
      ) STRICT`,
      `CREATE TABLE secret_refs (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT REFERENCES users(id),
        name TEXT NOT NULL,
        storage_path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(owner_user_id, name)
      ) STRICT`,
    ],
  },
  {
    version: 2,
    statements: [
      `CREATE TABLE work_config_artifacts (
        work_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        artifact_kind TEXT NOT NULL CHECK (artifact_kind IN ('agent_image', 'skill')),
        ordinal INTEGER NOT NULL,
        catalog_id TEXT NOT NULL,
        digest TEXT NOT NULL,
        PRIMARY KEY(work_id, revision, artifact_kind, ordinal),
        FOREIGN KEY(work_id, revision) REFERENCES work_config_revisions(work_id, revision)
      ) STRICT`,
    ],
  },
  {
    version: 3,
    statements: [
      `CREATE TABLE control_metadata (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `ALTER TABLE work_config_revisions ADD COLUMN runtime_profile_json TEXT`,
      `ALTER TABLE work_config_revisions ADD COLUMN source_runtime_revision INTEGER`,
    ],
  },
];

export function migrateCoreDatabase(database: DatabaseSync): void {
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  ) STRICT`);

  const current = database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as {
    version: number;
  };

  for (const migration of migrations) {
    if (migration.version <= current.version) continue;
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of migration.statements) database.exec(statement);
      database.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(
        migration.version,
        new Date().toISOString(),
      );
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
