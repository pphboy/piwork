import type { DatabaseSync } from "node:sqlite";
import { assignServiceDomainLabel, assignWorkNetworkName } from "./network-identities.js";

export const CORE_SCHEMA_VERSION = 10;

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
        volume_role TEXT NOT NULL CHECK (volume_role IN ('agent-private', 'workspace', 'service-data')),
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
  {
    version: 4,
    statements: [
      `INSERT INTO control_metadata(key, value_json, updated_at)
        VALUES ('default_work_configuration', '{"version":1,"revision":0,"configuration":null}', datetime('now'))
        ON CONFLICT(key) DO NOTHING`,
      `UPDATE work_config_revisions
        SET config_json = json_set(config_json, '$.agentsMd', '')
        WHERE json_extract(config_json, '$.agentsMd') IS NULL`,
    ],
  },
  {
    version: 5,
    statements: [
      `CREATE TABLE managed_skill_artifacts (
        skill_name TEXT NOT NULL REFERENCES catalog_entries(id) ON DELETE CASCADE,
        content_identity TEXT NOT NULL,
        file_count INTEGER NOT NULL CHECK (file_count >= 1 AND file_count <= 2048),
        total_bytes INTEGER NOT NULL CHECK (total_bytes >= 0 AND total_bytes <= 33554432),
        created_at TEXT NOT NULL,
        PRIMARY KEY(skill_name, content_identity)
      ) STRICT`,
      `CREATE TABLE work_context_snapshots (
        snapshot_id TEXT PRIMARY KEY,
        work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
        internal_revision INTEGER,
        configuration_json TEXT NOT NULL,
        image_identity TEXT NOT NULL,
        created_by_user_id TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        UNIQUE(work_id, internal_revision)
      ) STRICT`,
      `ALTER TABLE works ADD COLUMN desired_context_id TEXT REFERENCES work_context_snapshots(snapshot_id)`,
      `ALTER TABLE works ADD COLUMN active_context_id TEXT REFERENCES work_context_snapshots(snapshot_id)`,
      `CREATE INDEX work_context_snapshots_work_id ON work_context_snapshots(work_id, created_at)`,
    ],
  },
  {
    version: 6,
    statements: [
      `CREATE TABLE service_runtime_bindings (
        work_id TEXT NOT NULL,
        service_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        container_id TEXT,
        image_identity TEXT,
        recovery_count INTEGER NOT NULL DEFAULT 0,
        recovery_window_started_at TEXT,
        next_retry_at TEXT,
        ready_since TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(work_id, service_id)
      ) STRICT`,
      `CREATE TABLE volume_references (
        volume_id TEXT NOT NULL REFERENCES volume_records(id) ON DELETE CASCADE,
        consumer_kind TEXT NOT NULL CHECK (consumer_kind IN ('work', 'service')),
        consumer_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(volume_id, consumer_kind, consumer_id)
      ) STRICT`,
      `INSERT INTO control_metadata(key, value_json, updated_at)
        VALUES ('work_storage_format', '{"version":2,"layout":"split-private-workspace"}', datetime('now'))`,
    ],
  },
  {
    version: 7,
    statements: [
      `CREATE TABLE snapshot_jobs (
        operation_id TEXT PRIMARY KEY REFERENCES operations(id),
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        kind TEXT NOT NULL CHECK (kind IN ('export', 'import')),
        source_work_id TEXT,
        target_work_id TEXT,
        snapshot_id TEXT UNIQUE,
        package_id TEXT REFERENCES snapshot_packages(id),
        name TEXT,
        request_digest TEXT NOT NULL,
        phase TEXT NOT NULL CHECK (phase IN ('accepted', 'verifying', 'capturing', 'sealing', 'restoring', 'publishing', 'succeeded', 'failed', 'cleanup-pending', 'cleaned')),
        deadline_at TEXT NOT NULL,
        worker_epoch INTEGER NOT NULL CHECK (worker_epoch >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        cleanup_error TEXT
      ) STRICT`,
      `CREATE UNIQUE INDEX snapshot_single_active ON snapshot_jobs((1)) WHERE phase NOT IN ('succeeded', 'cleaned')`,
      `CREATE TABLE work_snapshot_locks (
        work_id TEXT PRIMARY KEY REFERENCES works(id),
        operation_id TEXT NOT NULL UNIQUE REFERENCES snapshot_jobs(operation_id),
        worker_epoch INTEGER NOT NULL CHECK (worker_epoch >= 1)
      ) STRICT`,
      `CREATE TABLE snapshot_packages (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        digest TEXT,
        size INTEGER NOT NULL CHECK (size >= 0),
        state TEXT NOT NULL CHECK (state IN ('staging', 'ready', 'expired', 'deleting')),
        job_id TEXT REFERENCES snapshot_jobs(operation_id),
        created_at TEXT NOT NULL,
        ready_at TEXT,
        expires_at TEXT,
        CHECK (state != 'ready' OR (digest IS NOT NULL AND ready_at IS NOT NULL AND expires_at IS NOT NULL))
      ) STRICT`,
      `CREATE TABLE snapshot_artifacts (
        operation_id TEXT NOT NULL REFERENCES snapshot_jobs(operation_id),
        artifact_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        logical_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('planned', 'created', 'ready', 'cleaning', 'cleaned')),
        PRIMARY KEY(operation_id, artifact_key)
      ) STRICT`,
      `CREATE TABLE snapshot_transfers (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        package_id TEXT REFERENCES snapshot_packages(id),
        snapshot_id TEXT REFERENCES snapshot_jobs(snapshot_id),
        kind TEXT NOT NULL CHECK (kind IN ('upload', 'download')),
        phase TEXT NOT NULL CHECK (phase IN ('accepted', 'streaming', 'verifying', 'cleanup-pending')),
        deadline_at TEXT NOT NULL,
        last_progress_at TEXT NOT NULL,
        helper_id TEXT,
        created_at TEXT NOT NULL
      ) STRICT`,
      `CREATE INDEX snapshot_transfers_package ON snapshot_transfers(package_id)`,
      `CREATE TABLE work_import_names (
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        operation_id TEXT NOT NULL UNIQUE REFERENCES snapshot_jobs(operation_id),
        PRIMARY KEY(owner_user_id, name)
      ) STRICT`,
      `CREATE TABLE work_owned_images (
        work_id TEXT NOT NULL REFERENCES works(id),
        selection_id TEXT NOT NULL,
        image_identity TEXT NOT NULL,
        source_reference TEXT NOT NULL,
        PRIMARY KEY(work_id, selection_id)
      ) STRICT`,
      `CREATE TABLE imported_work_history (
        work_id TEXT NOT NULL REFERENCES works(id),
        operation_id TEXT NOT NULL UNIQUE,
        source_operation_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        PRIMARY KEY(work_id, operation_id)
      ) STRICT`,
      `CREATE TABLE work_import_provenance (
        work_id TEXT PRIMARY KEY REFERENCES works(id),
        package_digest TEXT NOT NULL,
        import_operation_id TEXT NOT NULL REFERENCES snapshot_jobs(operation_id),
        identity_map_json TEXT NOT NULL
      ) STRICT`,
    ],
  },
  {
    version: 8,
    statements: [
      `CREATE TABLE pi_package_artifacts (
        id TEXT PRIMARY KEY,
        scope_kind TEXT NOT NULL CHECK (scope_kind IN ('core', 'work')),
        work_id TEXT REFERENCES works(id),
        name TEXT NOT NULL,
        content_digest TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        lease_count INTEGER NOT NULL DEFAULT 0 CHECK (lease_count >= 0),
        CHECK ((scope_kind = 'core' AND work_id IS NULL) OR (scope_kind = 'work' AND work_id IS NOT NULL))
      ) STRICT`,
      `CREATE INDEX pi_package_artifacts_scope ON pi_package_artifacts(scope_kind, work_id, name)`,
      `CREATE TABLE pi_package_catalog (
        name TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        head_artifact_id TEXT NOT NULL REFERENCES pi_package_artifacts(id),
        generation INTEGER NOT NULL CHECK (generation >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE pi_package_uploads (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        scope_kind TEXT NOT NULL CHECK (scope_kind IN ('core', 'work')),
        work_id TEXT REFERENCES works(id),
        source_kind TEXT NOT NULL CHECK (source_kind IN ('local', 'zip')),
        display_name TEXT NOT NULL,
        digest TEXT,
        size INTEGER NOT NULL CHECK (size >= 0 AND size <= 268435456),
        state TEXT NOT NULL CHECK (state IN ('staging', 'ready', 'expired')),
        expires_at TEXT,
        lease_count INTEGER NOT NULL DEFAULT 0 CHECK (lease_count >= 0),
        created_at TEXT NOT NULL,
        CHECK ((scope_kind = 'core' AND work_id IS NULL) OR (scope_kind = 'work' AND work_id IS NOT NULL)),
        CHECK (state != 'ready' OR (digest IS NOT NULL AND expires_at IS NOT NULL))
      ) STRICT`,
      `CREATE INDEX pi_package_uploads_expiry ON pi_package_uploads(state, expires_at)`,
      `CREATE TABLE pi_package_jobs (
        operation_id TEXT PRIMARY KEY REFERENCES operations(id),
        scope_kind TEXT NOT NULL CHECK (scope_kind IN ('core', 'work')),
        work_id TEXT REFERENCES works(id),
        actor_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('install', 'update')),
        prepare_image_id TEXT NOT NULL,
        trusted_helper_image_id TEXT NOT NULL,
        prepared_environment_json TEXT NOT NULL,
        add_to_defaults INTEGER NOT NULL CHECK (add_to_defaults IN (0, 1)),
        source_json TEXT NOT NULL,
        source_upload_id TEXT REFERENCES pi_package_uploads(id),
        request_digest TEXT NOT NULL,
        package_name TEXT,
        phase TEXT NOT NULL CHECK (phase IN ('queued', 'source', 'prepare', 'validate', 'publish', 'succeeded', 'failed', 'superseded', 'cleanup-pending')),
        worker_epoch INTEGER NOT NULL CHECK (worker_epoch >= 1),
        helper_id TEXT,
        deadline_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        cleanup_error TEXT,
        leases_released INTEGER NOT NULL DEFAULT 0 CHECK (leases_released IN (0, 1)),
        CHECK ((scope_kind = 'core' AND work_id IS NULL) OR (scope_kind = 'work' AND work_id IS NOT NULL))
      ) STRICT`,
      `CREATE UNIQUE INDEX pi_package_one_scope_job ON pi_package_jobs(scope_kind, COALESCE(work_id, ''))
        WHERE phase NOT IN ('succeeded', 'failed', 'superseded')`,
      `CREATE INDEX pi_package_jobs_phase ON pi_package_jobs(phase, created_at)`,
    ],
  },
  {
    version: 9,
    statements: [
      `CREATE TABLE work_network_names (
        work_id TEXT PRIMARY KEY REFERENCES works(id),
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE service_domain_labels (
        work_id TEXT NOT NULL REFERENCES works(id),
        service_id TEXT NOT NULL,
        label TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(work_id, service_id),
        UNIQUE(work_id, label),
        FOREIGN KEY(work_id, service_id) REFERENCES service_heads(work_id, service_id)
      ) STRICT`,
    ],
  },
  {
    version: 10,
    statements: [
      `CREATE TABLE work_file_gates (
        work_id TEXT PRIMARY KEY REFERENCES works(id),
        epoch INTEGER NOT NULL CHECK (epoch >= 1),
        closed INTEGER NOT NULL CHECK (closed IN (0, 1)),
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE work_file_core_epoch (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        epoch INTEGER NOT NULL CHECK (epoch >= 0)
      ) STRICT`,
      `INSERT INTO work_file_core_epoch(id,epoch) VALUES (1,0)`,
      `INSERT INTO work_file_gates(work_id, epoch, closed, updated_at)
        SELECT id, 1, 0, updated_at FROM works`,
      `CREATE TABLE work_file_jobs (
        id TEXT PRIMARY KEY,
        work_id TEXT NOT NULL REFERENCES works(id),
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        session_id TEXT NOT NULL REFERENCES login_sessions(id),
        core_epoch INTEGER NOT NULL CHECK (core_epoch >= 1),
        work_epoch INTEGER NOT NULL CHECK (work_epoch >= 1),
        runtime_generation INTEGER NOT NULL CHECK (runtime_generation >= 0),
        kind TEXT NOT NULL CHECK (kind IN ('PROPFIND','GET','HEAD','PUT','MKCOL','COPY','MOVE','DELETE','PROPPATCH')),
        state TEXT NOT NULL CHECK (state IN ('accepted','starting','running','prepared','committing','finished','cancelling','cleanup-pending','cleaned')),
        trusted_image_id TEXT NOT NULL,
        volume_name TEXT NOT NULL,
        path_segments_json TEXT NOT NULL,
        destination_segments_json TEXT,
        accepted_at TEXT NOT NULL,
        deadline_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        cleaned_at TEXT,
        error_code TEXT,
        CHECK (state != 'cleaned' OR cleaned_at IS NOT NULL)
      ) STRICT`,
      `CREATE INDEX work_file_jobs_active_work ON work_file_jobs(work_id, state)
        WHERE state != 'cleaned'`,
      `CREATE INDEX work_file_jobs_active_user ON work_file_jobs(owner_user_id, state)
        WHERE state != 'cleaned'`,
      `CREATE INDEX work_file_jobs_cleaned_at ON work_file_jobs(cleaned_at)
        WHERE state = 'cleaned'`,
      `CREATE UNIQUE INDEX work_file_one_mutation ON work_file_jobs(work_id)
        WHERE state != 'cleaned' AND kind IN ('PUT','MKCOL','COPY','MOVE','DELETE','PROPPATCH')`,
      `CREATE TABLE work_file_attempts (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES work_file_jobs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('request','cleanup')),
        epoch INTEGER NOT NULL CHECK (epoch >= 1),
        container_name TEXT NOT NULL UNIQUE,
        container_id TEXT,
        state TEXT NOT NULL CHECK (state IN ('planned','creating','created','running','stopping','exited','removed','unknown')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE INDEX work_file_attempts_job ON work_file_attempts(job_id)`,
      `CREATE TABLE work_file_temporaries (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES work_file_jobs(id) ON DELETE CASCADE,
        parent_segments_json TEXT NOT NULL,
        name TEXT NOT NULL,
        device TEXT,
        inode TEXT,
        state TEXT NOT NULL CHECK (state IN ('planned','created','published','cleaned','uncertain')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(job_id, parent_segments_json, name),
        CHECK ((device IS NULL AND inode IS NULL) OR (device IS NOT NULL AND inode IS NOT NULL))
      ) STRICT`,
      `CREATE INDEX work_file_temporaries_job ON work_file_temporaries(job_id)`,
      `CREATE TABLE work_file_cleanup_retries (
        job_id TEXT PRIMARY KEY REFERENCES work_file_jobs(id) ON DELETE CASCADE,
        window_started_at TEXT NOT NULL,
        attempts INTEGER NOT NULL CHECK (attempts >= 1),
        last_attempt_at TEXT NOT NULL
      ) STRICT`,
    ],
  },
];

export function migrateCoreDatabase(database: DatabaseSync): void {
  const existing = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
  const hasMigrationTable = existing.some((row) => row.name === "schema_migrations");
  if (existing.length > 0 && !hasMigrationTable) {
    throw Object.assign(new Error("CORE_STORAGE_FORMAT_UNSUPPORTED: existing storage has no final V1 schema marker"), { code: "CORE_STORAGE_FORMAT_UNSUPPORTED" });
  }
  if (hasMigrationTable) {
    const row = database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number };
    if (row.version !== CORE_SCHEMA_VERSION && row.version !== 9 && row.version !== 8) {
      throw Object.assign(new Error("CORE_STORAGE_FORMAT_UNSUPPORTED: existing storage is not final V1"), { code: "CORE_STORAGE_FORMAT_UNSUPPORTED" });
    }
  }
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
      if (migration.version === 9) {
        const works = database.prepare("SELECT id, created_at FROM works ORDER BY created_at, id").all() as Array<{ id: string; created_at: string }>;
        for (const work of works) assignWorkNetworkName(database, work.id, work.created_at);
        const services = database.prepare(`SELECT heads.work_id, heads.service_id, heads.name, revisions.created_at
          FROM service_heads AS heads JOIN service_revisions AS revisions
          ON revisions.work_id = heads.work_id AND revisions.service_id = heads.service_id AND revisions.revision = 1
          ORDER BY revisions.created_at, heads.service_id`).all() as Array<{ work_id: string; service_id: string; name: string; created_at: string }>;
        for (const service of services) assignServiceDomainLabel(database, service.work_id, service.service_id, service.name, service.created_at);
      }
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
