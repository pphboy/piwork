import type { DatabaseSync } from "node:sqlite";
import { WORK_SCHEMA_SQL } from "./brain-schema.js";
import { WORK_SCHEMA_OBJECTS } from "./schema-objects.js";
import { LEGACY_SCHEMA_OBJECTS } from "./legacy-schema-objects.js";
import { validateLegacyWorkDatabase, migrateWorkDatabase } from "./migrations.js";
import { validateBrainHistory } from "./snapshot-brain.js";

export interface HistoryMigration {
  readonly operationId: string; readonly workId: string; readonly fromSchema: 4; readonly toSchema: 5;
  readonly storeId: string; readonly backupManifestDigest: string;
}

/** The caller is the Core-authorized initialization candidate, never a public Run. */
export function migrateExperience(database: DatabaseSync, authorization: HistoryMigration): void {
  validateLegacyWorkDatabase(database);
  const meta = database.prepare("SELECT * FROM memory.memory_meta WHERE singleton=1").get();
  if (authorization.fromSchema !== 4 || authorization.toSchema !== 5 || !authorization.operationId
    || !/^[a-f0-9]{64}$/.test(authorization.backupManifestDigest) || meta?.work_id !== authorization.workId
    || meta.store_id !== authorization.storeId || meta.schema_version !== 1
    || database.prepare("SELECT version FROM memory.memory_head WHERE singleton=1").get()?.version !== 0
    || database.prepare("SELECT COUNT(*) AS n FROM memory.memory_entries").get()?.n !== 0) throw new Error("WORK_HISTORY_MIGRATION_REQUIRED");
  const contexts = new Set<string>();
  for (const row of database.prepare("SELECT active_context_identity AS id FROM sessions UNION SELECT context_identity AS id FROM runs").iterate()) {
    if (typeof row.id === "string") contexts.add(row.id);
  }
  validateBrainHistory(database, authorization.workId, contexts);
  const head = database.prepare("SELECT version,updated_at FROM brain_experience_heads WHERE work_id=?").get(authorization.workId);
  const oldHead = Number(head?.version ?? 0);
  const legacyTables = LEGACY_SCHEMA_OBJECTS.filter((v) => v.type === "table").map((v) => v.name);
  const currentTables = WORK_SCHEMA_OBJECTS.filter((v) => v.type === "table" && v.name !== "schema_migrations" && v.name !== "work_memory_binding").map((v) => v.name);
  // Trusted temporary copies avoid ALTER's schema-text drift and keep row copying inside SQLite.
  // No user SQL is executed; every identifier comes from the frozen schema catalog.
  database.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
  try {
    for (const table of legacyTables) database.exec(`CREATE TEMP TABLE migration_${table} AS SELECT * FROM main.${table}`);
    database.exec(`INSERT INTO memory.memory_versions(version,published_at,legacy)
      SELECT DISTINCT version,NULL,1 FROM main.brain_experience_revisions WHERE status='effective'`);
    database.exec(`INSERT INTO memory.memory_entries(version,entry_id,kind,scope,rule,evidence_ids_json,source_request_id,created_at)
      SELECT e.version,e.entry_id,CASE WHEN q.source_kind='chat' AND EXISTS(SELECT 1 FROM main.agent_evidence p
        JOIN main.runs r ON r.run_id=p.run_id JOIN json_each(e.evidence_ids_json) cited ON cited.value=p.evidence_id
        WHERE p.work_id=e.work_id AND q.work_id=e.work_id AND r.work_id=e.work_id AND p.request_id=q.request_id
        AND p.run_id=q.source_run_id AND p.kind='sdk' AND p.verified=1
        AND json_extract(p.details_json,'$.userPreferenceVerified')=1
        AND json_extract(p.details_json,'$.promptDigest')=r.prompt_digest) THEN 'preference' ELSE 'experience' END,
      e.scope,e.rule,e.evidence_ids_json,e.source_request_id,e.created_at FROM main.brain_experience_revisions e
      JOIN main.agent_requests q ON q.request_id=e.source_request_id WHERE e.status='effective'`);
    database.prepare(`INSERT INTO memory.memory_candidates
      SELECT version,entry_id,source_request_id,'upsert',?,'experience',scope,rule,evidence_ids_json,NULL,status,NULL,created_at,created_at
      FROM main.brain_experience_revisions WHERE status IN('staged','failed')`).run(oldHead);
    if (oldHead !== 0) database.prepare("UPDATE memory.memory_versions SET published_at=? WHERE version=?").run(head!.updated_at!, oldHead);
    database.prepare("UPDATE memory.memory_head SET version=?,updated_at=COALESCE(?,updated_at) WHERE singleton=1").run(oldHead, head?.updated_at ?? null);
    for (const table of legacyTables) database.exec(`DROP TABLE main.${table}`);
    database.exec(WORK_SCHEMA_SQL);
    for (const table of currentTables) {
      const columns = (database.prepare(`PRAGMA temp.table_info(migration_${table})`).all() as { name: string }[]).map((v) => v.name).join(",");
      database.exec(`INSERT INTO main.${table}(${columns}) SELECT ${columns} FROM temp.migration_${table}`);
    }
    database.prepare("INSERT INTO main.work_memory_binding VALUES(?,?,1)").run(authorization.workId, authorization.storeId);
    database.prepare("INSERT INTO main.schema_migrations VALUES(5,?)").run(new Date().toISOString());
    if (database.prepare("PRAGMA main.foreign_key_check").get() || database.prepare("PRAGMA memory.foreign_key_check").get()) throw new Error("WORK_HISTORY_INVALID");
    migrateWorkDatabase(database);
    database.exec("COMMIT");
  } catch (error) { if (database.isTransaction) database.exec("ROLLBACK"); throw error; }
  finally {
    for (const table of legacyTables) database.exec(`DROP TABLE IF EXISTS temp.migration_${table}`);
    database.exec("PRAGMA foreign_keys=ON");
  }
}
