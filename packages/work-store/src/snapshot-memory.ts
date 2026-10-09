import type { DatabaseSync } from "node:sqlite";
import { MemoryStore, hasMemoryPreferenceProof } from "./memory.js";
import { canonicalJson } from "./feedback.js";
import { sameSchema } from "./migrations.js";
import { MEMORY_SCHEMA_OBJECTS } from "./memory-schema-objects.js";

export const MEMORY_TABLES = ["memory_meta", "memory_versions", "memory_entries", "memory_candidates", "memory_head"] as const;
const validTime = (value: unknown): boolean => typeof value === "string" && Number.isFinite(Date.parse(value));
function invalid(): never { throw new Error("WORK_MEMORY_INVALID"); }

/** Strict relational validation only; no imported DDL or caller-asserted verified flags. */
export function validateMemoryHistory(db: DatabaseSync, workId: string): void {
  if (!sameSchema(db.prepare("SELECT type,name,tbl_name,sql FROM memory.sqlite_master ORDER BY type,name").all(), MEMORY_SCHEMA_OBJECTS)) invalid();
  if (db.prepare("PRAGMA memory.integrity_check").get()?.integrity_check !== "ok" || db.prepare("PRAGMA memory.foreign_key_check").get()) invalid();
  for (const table of ["memory_meta", "memory_head"]) if (db.prepare(`SELECT COUNT(*) AS n FROM memory.${table}`).get()?.n !== 1) invalid();
  if (db.prepare("SELECT COUNT(*) AS n FROM main.work_memory_binding").get()?.n !== 1) invalid();
  const memory = new MemoryStore(db);
  memory.assertOwner(workId);
  const versions = db.prepare("SELECT * FROM memory.memory_versions ORDER BY version").all();
  if (!versions.length || versions[0]?.version !== 0) invalid();
  let count = 0;
  for (const table of MEMORY_TABLES) {
    for (const row of db.prepare(`SELECT * FROM memory.${table}`).iterate()) {
      if (++count > 1_000_000) invalid();
      const bytes = Object.values(row).reduce<number>((n, v) => n + (typeof v === "string" ? Buffer.byteLength(v) : 0), 0);
      if (bytes > 64 << 20) invalid();
      for (const field of ["created_at", "updated_at"]) if (Object.hasOwn(row, field) && !validTime(row[field])) invalid();
    }
  }
  for (const row of versions) {
    if (typeof row.version !== "number" || !Number.isSafeInteger(row.version) || row.version < 0
      || (row.published_at === null ? row.legacy !== 1 : !validTime(row.published_at))) invalid();
    memory.snapshot(workId, row.version);
  }
  memory.snapshot(workId);
  for (const row of db.prepare("SELECT * FROM memory.memory_candidates").iterate()) {
    const request = db.prepare("SELECT * FROM main.agent_requests WHERE work_id=? AND request_id=?").get(workId, row.source_request_id!);
    const ids = JSON.parse(String(row.evidence_ids_json)) as unknown;
    if (!request || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(String(row.entry_id))
      || !/^(?:work|service:[a-zA-Z][a-zA-Z0-9_-]{0,63})$/.test(String(row.scope))
      || typeof row.rule !== "string" || !row.rule || Buffer.byteLength(row.rule) > 4 << 10
      || !Array.isArray(ids) || ids.length > 100 || (!ids.length && request.source_kind !== "chat")) invalid();
    memory.snapshot(workId, Number(row.base_version));
    for (const id of ids) {
      if (typeof id !== "string" || !id || id.includes("\0")) invalid();
      const proof = db.prepare("SELECT * FROM main.agent_evidence WHERE work_id=? AND evidence_id=?").get(workId, id);
      if (!proof || proof.request_id !== row.source_request_id || proof.kind === "event" || (row.status === "effective" && proof.verified !== 1)) invalid();
    }
    if (row.operation === "invalidate" && (typeof row.reason !== "string" || !row.reason || Buffer.byteLength(row.reason) > 4 << 10)) invalid();
    if (row.status === "effective") {
      if (request.state !== "completed" || typeof row.published_version !== "number" || row.published_version <= Number(row.base_version)) invalid();
      if(row.kind==='preference'&&!hasMemoryPreferenceProof(db,workId,String(row.source_request_id),ids as string[]))invalid();
      const published = memory.snapshot(workId, row.published_version);
      const entry = published.entries.find((e) => e.entryId === row.entry_id);
      if (row.operation === "invalidate" ? entry !== undefined : !entry || entry.rule !== row.rule || entry.scope !== row.scope
        || entry.sourceRequestId !== row.source_request_id || (entry as {kind?:unknown}).kind !== row.kind
        || (entry as {createdAt?:unknown}).createdAt !== row.created_at || canonicalJson(entry.evidenceIds) !== canonicalJson(ids)) invalid();
    } else if (row.published_version !== null) invalid();
  }
  for (const run of db.prepare("SELECT adopted_experience_version,adopted_memory_selection_json,source_json FROM main.runs").iterate()) {
    const snapshot = memory.snapshot(workId, Number(run.adopted_experience_version));
    if (run.adopted_memory_selection_json === null) continue;
    const selection = JSON.parse(String(run.adopted_memory_selection_json)) as { entryIds?: unknown; matchedCount?: unknown; truncated?: unknown };
    if (!Array.isArray(selection.entryIds) || selection.entryIds.length > 10 || new Set(selection.entryIds).size !== selection.entryIds.length
      || typeof selection.matchedCount !== "number" || !Number.isSafeInteger(selection.matchedCount)
      || selection.matchedCount < selection.entryIds.length || selection.matchedCount > 100 || typeof selection.truncated !== "boolean"
      || selection.truncated !== (selection.matchedCount > selection.entryIds.length)
      || Object.keys(selection).some((key) => !["entryIds", "matchedCount", "truncated"].includes(key))) invalid();
    const provided = selection.entryIds.map((id) => snapshot.entries.find((entry) => entry.entryId === id) ?? invalid());
    if (Buffer.byteLength(canonicalJson(provided)) > 16 << 10) invalid();
    const source = run.source_json === null ? undefined : JSON.parse(String(run.source_json)) as { kind: string; serviceName?: string };
    if (source?.kind === "service" && provided.some((entry) => entry.scope !== "work" && entry.scope !== `service:${source.serviceName}`)) invalid();
  }
}
