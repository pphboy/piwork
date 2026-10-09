import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { BRAIN_LIMITS } from "@piwork/contracts";
import { canonicalJson, FeedbackError, type ExperienceEntry, type ExperienceSnapshot } from "./feedback.js";

type Row = Record<string, SQLInputValue>;
export type MemoryKind = "preference" | "experience" | "knowledge";
export interface MemoryEntry extends ExperienceEntry { readonly kind: MemoryKind; readonly createdAt: string }
export interface MemorySelection { readonly entryIds: readonly string[]; readonly matchedCount: number; readonly truncated: boolean }
export interface MemoryCandidateInput {
  readonly entryId: string; readonly scope: string; readonly rule: string; readonly evidenceIds: readonly string[];
  readonly kind?: MemoryKind; readonly operation?: "upsert" | "invalidate";
  readonly expectedVersion?: number; readonly reason?: string;
}
const validId = (v: string): boolean => /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(v);
const validScope = (v: string): boolean => /^(?:work|service:[a-zA-Z][a-zA-Z0-9_-]{0,63})$/.test(v);
const validVersion = (v: number): boolean => Number.isSafeInteger(v) && v >= 0;
function fail(code: string, message: string): never { throw new FeedbackError(code, message); }

/** A preference cites its own original instruction, never an unrelated proof in the same goal. */
export function hasMemoryPreferenceProof(db: DatabaseSync, workId: string, requestId: string, evidenceIds: readonly string[]): boolean {
  const query=db.prepare(`SELECT 1 FROM main.agent_evidence e JOIN main.agent_requests q ON q.request_id=e.request_id
    JOIN main.runs r ON r.run_id=e.run_id WHERE e.evidence_id=? AND e.work_id=? AND q.work_id=? AND r.work_id=?
    AND q.request_id=? AND q.source_kind='chat' AND e.kind='sdk' AND e.verified=1 AND e.run_id=q.source_run_id
    AND json_extract(e.details_json,'$.userPreferenceVerified')=1 AND json_extract(e.details_json,'$.promptDigest')=r.prompt_digest LIMIT 1`);
  return evidenceIds.some(id=>!!query.get(id,workId,workId,workId,requestId));
}

/** Independent storage on the WorkStore's attached connection. No separate writer or scheduler. */
export class MemoryStore {
  constructor(private readonly db: DatabaseSync) {}

  bind(workId: string, storeId = randomUUID(), now = new Date().toISOString()): void {
    this.atomic(() => {
      const owner = this.db.prepare("SELECT * FROM memory.memory_meta").get();
      if (owner) { this.assertOwner(workId); return; }
      if (!workId || workId.includes("\0")) fail("EXPERIENCE_INVALID", "Memory Work identity is invalid");
      this.db.prepare("INSERT INTO memory.memory_meta VALUES(1,1,?,?)").run(workId, storeId);
      this.db.prepare("INSERT INTO main.work_memory_binding VALUES(?,?,1)").run(workId, storeId);
      this.db.prepare("INSERT INTO memory.memory_versions VALUES(0,?,0)").run(now);
      this.db.prepare("INSERT INTO memory.memory_head VALUES(1,0,?)").run(now);
    });
  }

  assertOwner(workId: string): void {
    const owner = this.db.prepare("SELECT * FROM memory.memory_meta WHERE singleton=1").get();
    const binding = this.db.prepare("SELECT * FROM main.work_memory_binding WHERE work_id=?").get(workId);
    if (!owner || owner.work_id !== workId || owner.schema_version !== 1 || !binding
      || binding.store_id !== owner.store_id || binding.memory_schema_version !== 1) {
      fail("EXPERIENCE_INVALID", "Memory is unavailable or belongs to another Work");
    }
  }

  head(workId: string): number {
    this.assertOwner(workId);
    const row = this.db.prepare("SELECT version FROM memory.memory_head WHERE singleton=1").get();
    const published=this.db.prepare("SELECT MAX(version) AS version FROM memory.memory_versions WHERE published_at IS NOT NULL").get();
    const invalidPublication=this.db.prepare(`SELECT 1 FROM memory.memory_versions WHERE legacy=0 AND published_at IS NULL
      UNION ALL SELECT 1 FROM memory.memory_candidates c LEFT JOIN memory.memory_versions v ON v.version=c.published_version
      WHERE c.status='effective' AND (v.version IS NULL OR v.published_at IS NULL) LIMIT 1`).get();
    if (!row || !validVersion(Number(row.version)) || published?.version!==row.version || invalidPublication) fail("EXPERIENCE_INVALID", "Memory head differs from its durable publication");
    return Number(row.version);
  }

  snapshot(workId: string, version = this.head(workId)): ExperienceSnapshot {
    this.assertOwner(workId);
    this.head(workId);
    if (!validVersion(version) || !this.db.prepare("SELECT 1 FROM memory.memory_versions WHERE version=?").get(version)) {
      fail("EXPERIENCE_INVALID", "Memory version is missing");
    }
    const rows = this.db.prepare("SELECT * FROM memory.memory_entries WHERE version=? ORDER BY entry_id LIMIT 101").all(version) as Row[];
    if (rows.length > BRAIN_LIMITS.experienceEntries || (version === 0 && rows.length !== 0)) fail("EXPERIENCE_INVALID", "Memory snapshot is invalid");
    const entries = rows.map((r) => this.entry(r));
    for (const entry of entries) {
      this.validateSource(workId, entry, true);
      const candidate=this.db.prepare("SELECT * FROM memory.memory_candidates WHERE entry_id=? AND source_request_id=? AND status='effective' AND operation='upsert' AND published_version<=? ORDER BY published_version DESC LIMIT 1").get(entry.entryId,entry.sourceRequestId,version) as Row|undefined;
      if(candidate&&canonicalJson(this.entry(candidate))!==canonicalJson(entry))fail("EXPERIENCE_INVALID","Published Memory metadata differs from its candidate");
    }
    return { version, entries };
  }

  recall(workId: string, version: number, query: string, serviceName?: string, limit = 10, byteLimit = 64 << 10): {
    version: number; items: MemoryEntry[]; truncated: boolean; matchedCount: number;
  } {
    if (!query || Buffer.byteLength(query) > 8 << 10) fail("EXPERIENCE_INVALID", "Memory recall query is invalid");
    return this.match(workId,version,query,serviceName,limit,byteLimit);
  }

  private match(workId: string, version: number, query: string, serviceName: string|undefined, limit: number, byteLimit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20 || (serviceName !== undefined && !validScope(`service:${serviceName}`))) fail("EXPERIENCE_INVALID", "Memory recall input is invalid");
    const wanted = tokens(query);
    const ranked = (this.snapshot(workId, version).entries as MemoryEntry[]).flatMap((entry) => {
      const ownService = entry.scope.startsWith("service:") ? entry.scope.slice(8) : undefined;
      if (serviceName !== undefined && ownService !== undefined && ownService !== serviceName) return [];
      const source = tokens(`${entry.entryId} ${entry.scope} ${entry.rule}`);
      const score = [...wanted].reduce((n, token) => n + Number(source.has(token)), 0);
      const preference = entry.kind === "preference" && (ownService === undefined || ownService === serviceName || score > 0);
      if (!preference && score === 0 && !(ownService && ownService === serviceName)) return [];
      return [{ entry, score, preference }];
    }).sort((a, b) => Number(b.preference) - Number(a.preference) || b.score - a.score || a.entry.entryId.localeCompare(b.entry.entryId, "en"));
    const items: MemoryEntry[] = [];
    for (const { entry } of ranked) {
      if (items.length < limit && Buffer.byteLength(canonicalJson([...items, entry])) <= byteLimit) items.push(entry);
    }
    return { version, items, matchedCount: ranked.length, truncated: items.length < ranked.length };
  }

  select(workId: string, version: number, query: string, serviceName?: string): MemorySelection {
    const result = this.match(workId, version, query, serviceName, 10, 16 << 10);
    return { entryIds: result.items.map((e) => e.entryId), matchedCount: result.matchedCount, truncated: result.truncated };
  }

  read(workId: string, version: number, entryId: string): {
    version: number; entry: ExperienceEntry | null; status: "effective" | "invalidated" | "not_found"; reason?: string; evidenceIds?: readonly string[]; scope?: string;
  } {
    if (!validId(entryId)) fail("EXPERIENCE_INVALID", "Memory entry identity is invalid");
    const entry = this.snapshot(workId, version).entries.find((e) => e.entryId === entryId);
    if (entry) return { version, entry, status: "effective" };
    const invalidation = this.db.prepare("SELECT * FROM memory.memory_candidates WHERE entry_id=? AND status='effective' AND published_version<=? ORDER BY published_version DESC LIMIT 1")
      .get(entryId, version) as Row | undefined;
    if(invalidation?.operation==="invalidate")this.validateSource(workId,this.entry(invalidation),true);
    return invalidation?.operation === "invalidate"
      ? { version, entry: null, status: "invalidated", scope:String(invalidation.scope), reason: String(invalidation.reason), evidenceIds: JSON.parse(String(invalidation.evidence_ids_json)) as string[] }
      : { version, entry: null, status: "not_found" };
  }

  propose(workId: string, requestId: string, input: MemoryCandidateInput, userPreference = false, now = new Date().toISOString()): number {
    return this.atomic(() => {
      this.assertOwner(workId);
      const request = this.db.prepare("SELECT * FROM main.agent_requests WHERE work_id=? AND request_id=?").get(workId, requestId);
      if (!request || request.disposition !== "live" || request.state !== "running") fail("REQUEST_NOT_RUNNING", "Memory requires the active live goal");
      const base = input.expectedVersion ?? this.head(workId);
      if (!validVersion(base)) fail("MEMORY_VERSION_CONFLICT", "Memory version is invalid");
      this.assertUnchanged(workId, input.entryId, base, this.head(workId));
      const kind = input.kind ?? (userPreference ? "preference" : "experience");
      const entry: MemoryEntry = { entryId: input.entryId, scope: input.scope, rule: input.rule, kind,
        evidenceIds: input.evidenceIds, sourceRequestId: requestId, createdAt: now };
      this.validateEntry(entry);
      if (request.source_kind === "service" && entry.scope !== "work" && entry.scope !== `service:${request.service_name}`) {
        fail("MUTATION_NOT_ALLOWED", "Memory is scoped to the source Service");
      }
      this.validateSource(workId, entry, false);
      if ((userPreference || kind === "preference") && (request.source_kind !== "chat" || !hasMemoryPreferenceProof(this.db,workId,requestId,entry.evidenceIds))) {
        fail("VERIFICATION_REQUIRED", "Preference requires the original accepted Chat evidence");
      }
      const operation = input.operation ?? "upsert";
      const current = this.snapshot(workId, base).entries;
      if (operation === "invalidate" && (!current.some((e) => e.entryId === entry.entryId)
        || !input.reason || Buffer.byteLength(input.reason) > BRAIN_LIMITS.experienceRuleBytes)) fail("EXPERIENCE_INVALID", "Invalidation requires an effective entry and a bounded reason");
      const staged = this.db.prepare("SELECT candidate_version FROM memory.memory_candidates WHERE source_request_id=? AND status='staged' LIMIT 1").get(requestId);
      const version = staged ? Number(staged.candidate_version) : this.nextVersion();
      if (!current.some((e) => e.entryId === entry.entryId) && current.length >= 100) fail("EXPERIENCE_LIMIT_EXCEEDED", "Merge or replace an existing rule before adding another");
      this.db.prepare(`INSERT INTO memory.memory_candidates VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,?,?)
        ON CONFLICT(candidate_version,entry_id) DO UPDATE SET operation=excluded.operation,base_version=excluded.base_version,
        kind=excluded.kind,scope=excluded.scope,rule=excluded.rule,evidence_ids_json=excluded.evidence_ids_json,reason=excluded.reason,updated_at=excluded.updated_at`)
        .run(version, entry.entryId, requestId, operation, base, kind, entry.scope, entry.rule, canonicalJson(entry.evidenceIds),
          input.reason ?? null, "staged", now, now);
      return version;
    });
  }

  commit(workId: string, requestId: string, now: string): void {
    if (!this.db.isTransaction) fail("EXPERIENCE_INVALID", "Memory must commit with verified request completion");
    const rows = this.db.prepare("SELECT * FROM memory.memory_candidates WHERE source_request_id=? AND status='staged' ORDER BY entry_id").all(requestId) as Row[];
    if (!rows.length) return;
    this.assertOwner(workId);
    const head = this.head(workId);
    for (const row of rows) this.assertUnchanged(workId, String(row.entry_id), Number(row.base_version), head);
    const entries = new Map(this.snapshot(workId, head).entries.map((e) => [e.entryId, e as MemoryEntry]));
    for (const row of rows) {
      const entry = this.entry(row);
      this.validateSource(workId, entry, false, true);
      if (row.operation === "invalidate") entries.delete(entry.entryId); else entries.set(entry.entryId, entry);
    }
    if (entries.size > 100) fail("EXPERIENCE_LIMIT_EXCEEDED", "Merge or replace rules explicitly");
    const version = this.nextVersion();
    this.db.prepare("INSERT INTO memory.memory_versions VALUES(?,?,0)").run(version, now);
    for (const entry of entries.values()) this.db.prepare("INSERT INTO memory.memory_entries VALUES(?,?,?,?,?,?,?,?)")
      .run(version, entry.entryId, entry.kind, entry.scope, entry.rule, canonicalJson(entry.evidenceIds), entry.sourceRequestId, entry.createdAt);
    this.db.prepare("UPDATE memory.memory_candidates SET status='effective',published_version=?,updated_at=? WHERE source_request_id=? AND status='staged'").run(version, now, requestId);
    this.db.prepare("UPDATE memory.memory_head SET version=?,updated_at=? WHERE singleton=1").run(version, now);
  }

  reject(workId: string, requestId: string, now: string): void {
    if (!this.db.prepare("SELECT 1 FROM memory.memory_candidates WHERE source_request_id=? AND status='staged' LIMIT 1").get(requestId)) return;
    this.assertOwner(workId);
    this.db.prepare("UPDATE memory.memory_candidates SET status='failed',updated_at=? WHERE source_request_id=? AND status='staged'").run(now, requestId);
  }

  receipt(workId: string, requestId: string): { version: number; status: "effective"; entryIds: string[]; evidenceIds: string[] } | undefined {
    this.assertOwner(workId);
    const rows = this.db.prepare("SELECT * FROM memory.memory_candidates WHERE source_request_id=? AND status='effective' ORDER BY entry_id").all(requestId) as Row[];
    if (!rows.length) return undefined;
    return { version: Number(rows[0]!.published_version), status: "effective", entryIds: rows.map((r) => String(r.entry_id)),
      evidenceIds: [...new Set(rows.flatMap((r) => JSON.parse(String(r.evidence_ids_json)) as string[]))] };
  }

  private entry(row: Row): MemoryEntry {
    const entry: MemoryEntry = { entryId: String(row.entry_id), scope: String(row.scope), rule: String(row.rule), kind: String(row.kind) as MemoryKind,
      evidenceIds: JSON.parse(String(row.evidence_ids_json)) as string[], sourceRequestId: String(row.source_request_id), createdAt: String(row.created_at) };
    this.validateEntry(entry); return entry;
  }

  private validateEntry(entry: MemoryEntry): void {
    if (!validId(entry.entryId) || !validScope(entry.scope) || !entry.rule || Buffer.byteLength(entry.rule) > BRAIN_LIMITS.experienceRuleBytes
      || !["preference", "experience", "knowledge"].includes(entry.kind) || !Array.isArray(entry.evidenceIds) || entry.evidenceIds.length > 100
      || entry.evidenceIds.some((id) => !id || typeof id !== "string" || id.includes("\0"))) fail("EXPERIENCE_LIMIT_EXCEEDED", "Memory entry is invalid or exceeds its limits");
  }

  private validateSource(workId: string, entry: MemoryEntry, completed: boolean, verified = completed): void {
    const request = this.db.prepare("SELECT * FROM main.agent_requests WHERE work_id=? AND request_id=?").get(workId, entry.sourceRequestId);
    if (!request || (completed && request.state !== "completed") || (!entry.evidenceIds.length && request.source_kind !== "chat")) {
      fail("VERIFICATION_REQUIRED", "Memory source is missing or unconfirmed");
    }
    for (const id of entry.evidenceIds) {
      const proof = this.db.prepare("SELECT * FROM main.agent_evidence WHERE work_id=? AND evidence_id=?").get(workId, id);
      if (!proof || proof.request_id !== entry.sourceRequestId || proof.kind === "event" || (verified && proof.verified !== 1)) {
        fail("VERIFICATION_REQUIRED", "Memory proof is missing, unverified or belongs to another goal");
      }
    }
    if(entry.kind==="preference"&&!hasMemoryPreferenceProof(this.db,workId,entry.sourceRequestId,entry.evidenceIds)){
      fail("VERIFICATION_REQUIRED","Memory preference lacks its referenced original instruction proof");
    }
  }

  private nextVersion(): number {
    const row = this.db.prepare("SELECT MAX(version)+1 AS version FROM (SELECT version FROM memory.memory_versions UNION ALL SELECT candidate_version AS version FROM memory.memory_candidates)").get();
    const version = Number(row?.version);
    if (!validVersion(version) || version === 0) fail("EXPERIENCE_LIMIT_EXCEEDED", "Memory version space is exhausted");
    return version;
  }
  private assertUnchanged(workId: string, entryId: string, base: number, head: number): void {
    const before = this.snapshot(workId, base).entries.find((entry) => entry.entryId === entryId) ?? null;
    if (base === head) return;
    const current = this.snapshot(workId, head).entries.find((entry) => entry.entryId === entryId) ?? null;
    if (canonicalJson(before) !== canonicalJson(current)) fail("MEMORY_VERSION_CONFLICT", "The same Memory entry changed; inspect its current version before updating");
  }
  private atomic<T>(f: () => T): T {
    if (this.db.isTransaction) return f();
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = f(); this.db.exec("COMMIT"); return result; }
    catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
  }
}

function tokens(value: string): Set<string> {
  const normalized = value.normalize("NFKC").toLowerCase();
  const result = new Set(normalized.match(/[\p{L}\p{N}]+/gu) ?? []);
  for (const part of normalized.match(/\p{Script=Han}+/gu) ?? []) {
    const chars = [...part]; for (let index = 0; index + 1 < chars.length; index++) result.add(chars[index]! + chars[index + 1]!);
  }
  return result;
}
