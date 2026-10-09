import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  BRAIN_LIMITS, BrainCandidateSubmissionSchema, BrainBehaviorChecksSchema, isBrainVerificationTarget, type BrainVerificationTarget, type AgentEvidence, type AgentRequest, type AgentRequestQuery,
  type AgentRequestState, type AgentWaitRef, type ServiceEvent,
} from "@piwork/contracts";
import { Check } from "typebox/value";
import { MemoryStore, type MemoryCandidateInput } from "./memory.js";

export type RequestPhase = "handling" | "verifying" | "adopting";
export const REQUEST_TERMINAL_STATES = ["completed", "failed", "cancelled", "needs_attention"] as const;
const terminal = (state: string): boolean => REQUEST_TERMINAL_STATES.includes(state as typeof REQUEST_TERMINAL_STATES[number]);
type Row = Record<string, string | number | null>;
export class FeedbackError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "FeedbackError"; }
}
export interface ActionReference {
  readonly serviceName: string; readonly actionId: string; readonly actionName: string;
  readonly input: unknown; readonly expectedStateVersion: string | null;
  readonly verificationQuery: string; readonly jobId?: string;
  readonly status: "calling" | "known" | "unknown";
}
export interface RequestInternals {
  readonly request: AgentRequest; readonly phase: RequestPhase;
  readonly sourceServiceId: string | null; readonly sourceRunId: string | null;
  readonly actionRefs: readonly ActionReference[]; readonly packageSubmission: unknown | null;
}
export interface ExperienceEntry {
  readonly entryId: string; readonly scope: string; readonly rule: string;
  readonly evidenceIds: readonly string[]; readonly sourceRequestId: string;
}
export interface ExperienceSnapshot { readonly version: number; readonly entries: readonly ExperienceEntry[] }
export interface Page<T> { readonly items: T[]; readonly nextCursor: string | null }

/** One connection and transaction domain with Run admission. No network side effects here. */
export class FeedbackStore {
  constructor(private readonly db: DatabaseSync, readonly memory?: MemoryStore) {}

  receiveEvent(event: ServiceEvent, declaredReasons: readonly string[], now = new Date().toISOString()): {
    readonly eventId: string; readonly requestId: string | null; readonly reused: boolean;
  } {
    const encoded = canonicalJson(event);
    if (Buffer.byteLength(encoded) > BRAIN_LIMITS.eventBytes) throw new FeedbackError("EVENT_TOO_LARGE", "Event exceeds 64 KiB");
    const digest = contentDigest(event);
    return this.transaction(() => {
      const prior = this.db.prepare("SELECT event_digest,request_id,disposition FROM service_events WHERE work_id=? AND source_service_id=? AND event_id=?")
        .get(event.origin.workId, event.origin.serviceId, event.eventId) as Row | undefined;
      if (prior) {
        if (prior.disposition !== "live") throw new FeedbackError("SERVICE_EVENT_ORIGIN_MISMATCH", "Historical event origin cannot deliver again");
        if (prior.event_digest !== digest) throw new FeedbackError("SERVICE_EVENT_CONFLICT", "Event identity already has different content");
        return { eventId: event.eventId, requestId: prior.request_id as string | null, reused: true };
      }
      let goal: string | null = null;
      if (event.type === "agent.requested") {
        const payload = event.payload;
        if (typeof payload.goal !== "string" || payload.goal.length === 0 || Buffer.byteLength(payload.goal) > BRAIN_LIMITS.goalBytes
          || typeof payload.reason !== "string" || !declaredReasons.includes(payload.reason)
          || !Array.isArray(payload.evidenceRefs) || payload.evidenceRefs.some((v) => typeof v !== "string")) {
          throw new FeedbackError("SERVICE_CAPABILITY_INVALID", "Requested goal, reason or evidence references are invalid");
        }
        if (event.causationRequestId || event.actor === "agent") throw new FeedbackError("SERVICE_CAPABILITY_INVALID", "Agent results cannot create another goal");
        this.checkCapacity(event.origin.workId);
        goal = payload.goal;
      }
      const eventPk = `event-${randomUUID()}`;
      this.db.prepare("INSERT INTO service_events(work_id,event_pk,source_service_id,event_id,event_digest,event_json,disposition,created_at) VALUES(?,?,?,?,?,?,'live',?)")
        .run(event.origin.workId, eventPk, event.origin.serviceId, event.eventId, digest, encoded, now);
      const requestId = goal === null ? null : `request-${randomUUID()}`;
      if (requestId) {
        this.insertRequest({ workId: event.origin.workId, requestId, key: `event:${event.origin.serviceId}:${event.eventId}`,
          digest, kind: "service", serviceName: event.serviceName, serviceId: event.origin.serviceId,
          eventPk, goal: goal!, now });
        this.db.prepare("UPDATE service_events SET request_id=? WHERE event_pk=?").run(requestId, eventPk);
      }
      let evidenceRequestId = requestId;
      if (evidenceRequestId === null && event.causationRequestId) {
        const goal = this.internal(event.origin.workId, event.causationRequestId);
        if (goal && (goal.request.source.serviceName === event.serviceName || goal.actionRefs.some((r) => r.serviceName === event.serviceName))) evidenceRequestId = goal.request.requestId;
      }
      this.addEvidence(event.origin.workId, { requestId: evidenceRequestId, runId: null, serviceName: event.serviceName,
        kind: "event", objectRef: event.eventId, observedAt: event.occurredAt, stateVersion: event.stateVersion, summary: `Service fact: ${event.type}`, verified: false }, event.payload);
      return { eventId: event.eventId, requestId, reused: false };
    });
  }

  findEventReceipt(event: ServiceEvent): { eventId: string; requestId: string | null; reused: true } | undefined {
    const prior = this.db.prepare("SELECT event_digest,request_id,disposition FROM service_events WHERE work_id=? AND source_service_id=? AND event_id=?")
      .get(event.origin.workId, event.origin.serviceId, event.eventId) as Row | undefined;
    if (!prior) return undefined;
    if (prior.disposition !== "live") throw new FeedbackError("SERVICE_EVENT_ORIGIN_MISMATCH", "Historical event origin cannot deliver again");
    if (prior.event_digest !== contentDigest(event)) throw new FeedbackError("SERVICE_EVENT_CONFLICT", "Event identity already has different content");
    return { eventId: event.eventId, requestId: prior.request_id as string | null, reused: true };
  }

  listServiceEvents(workId: string, serviceName: string, limit?: number, cursor?: string): Page<{ event: ServiceEvent; disposition: "live" | "historical" }> {
    const scope = contentDigest({ workId, serviceName, kind: "service-events" }); const after = decodeCursor(cursor, scope);
    const count = pageLimit(limit), params: SQLInputValue[] = [workId, serviceName];
    let boundary = "";
    if (after !== null) { const [time, id] = after.split("\0"); boundary = " AND (created_at>? OR (created_at=? AND event_pk>?))"; params.push(time!, time!, id!); }
    const rows = this.db.prepare(`SELECT event_pk,event_json,disposition,created_at FROM service_events WHERE work_id=? AND json_extract(event_json,'$.serviceName')=?${boundary} ORDER BY created_at,event_pk LIMIT ?`).all(...params, count + 1) as Row[];
    const page = rows.slice(0, count), last = page.at(-1);
    return { items: page.map((r) => ({ event: redactValue(JSON.parse(String(r.event_json))) as ServiceEvent, disposition: r.disposition as "live" | "historical" })),
      nextCursor: rows.length > count && last ? encodeCursor(scope, `${last.created_at}\0${last.event_pk}`) : null };
  }

  ensureChatRequest(workId: string, runId: string, goal: string, now = new Date().toISOString()): AgentRequest {
    return this.transaction(() => {
      const key = `chat-run:${runId}`;
      const prior = this.db.prepare("SELECT request_id FROM agent_requests WHERE work_id=? AND submission_key=?").get(workId, key) as Row | undefined;
      if (prior) return this.getRequest(workId, String(prior.request_id))!;
      const run = this.db.prepare("SELECT work_id,state FROM runs WHERE run_id=?").get(runId) as Row | undefined;
      if (!run || run.work_id !== workId || !["accepted", "running"].includes(String(run.state))) throw new FeedbackError("RUN_NOT_ACTIVE", "Goal requires the current active Run");
      if (!goal || Buffer.byteLength(goal) > BRAIN_LIMITS.goalBytes) throw new FeedbackError("GOAL_TOO_LARGE", "Goal exceeds 8 KiB");
      this.checkCapacity(workId);
      const requestId = `request-${randomUUID()}`;
      this.insertRequest({ workId, requestId, key, digest: contentDigest({ runId, goal }), kind: "chat", sourceRunId: runId, goal, now });
      this.db.prepare("UPDATE agent_requests SET state='running' WHERE request_id=?").run(requestId);
      this.db.prepare("INSERT INTO agent_request_runs(request_id,run_id,phase,disposition,created_at) VALUES(?,?,'handling','live',?)").run(requestId, runId, now);
      this.db.prepare("UPDATE runs SET source_json=? WHERE run_id=?").run(JSON.stringify({ kind: "chat", requestId, phase: "handling" }), runId);
      return this.getRequest(workId, requestId)!;
    });
  }

  /** Called inside the same transaction that inserts Run/activity/submission receipt. */
  claimRun(workId: string, requestId: string, runId: string, phase: RequestPhase, now: string): void {
    if (!this.db.isTransaction) throw new Error("Request and Run admission must be atomic");
    const current = this.internal(workId, requestId);
    if (!current || current.request.disposition !== "live" || current.request.state !== "pending" || current.phase !== phase) {
      throw new FeedbackError("REQUEST_NOT_READY", "Request is not eligible for this phase");
    }
    if (current.request.expiresAt <= now) throw new FeedbackError("REQUEST_EXPIRED", "Request deadline passed");
    if (current.request.autoRunCount >= BRAIN_LIMITS.autoRuns) throw new FeedbackError("REQUEST_BUDGET_EXCEEDED", "Automatic Run budget exhausted");
    const run = this.db.prepare("SELECT work_id FROM runs WHERE run_id=?").get(runId) as Row | undefined;
    if (!run || run.work_id !== workId) throw new Error("Run belongs to a different Work");
    this.db.prepare("UPDATE agent_requests SET state='running',auto_run_count=auto_run_count+1,updated_at=? WHERE request_id=?").run(now, requestId);
    this.db.prepare("INSERT INTO agent_request_runs(request_id,run_id,phase,disposition,created_at) VALUES(?,?,?,'live',?)").run(requestId, runId, phase, now);
    this.db.prepare("UPDATE runs SET source_json=? WHERE run_id=?").run(JSON.stringify({ ...current.request.source, requestId, phase }), runId);
  }

  getRequest(workId: string, requestId: string, serviceId?: string): AgentRequest | undefined {
    const row = this.db.prepare("SELECT * FROM agent_requests WHERE work_id=? AND request_id=?").get(workId, requestId) as Row | undefined;
    if (!row || (serviceId !== undefined && row.source_service_id !== serviceId)) return undefined;
    const runIds = (this.db.prepare("SELECT run_id FROM agent_request_runs WHERE request_id=? ORDER BY created_at,run_id").all(requestId) as Row[]).map((v) => String(v.run_id));
    const evidenceIds = (this.db.prepare("SELECT evidence_id FROM agent_evidence WHERE request_id=? ORDER BY observed_at,evidence_id LIMIT 101").all(requestId) as Row[]).map((v) => String(v.evidence_id));
    const evidenceCount = evidenceIds.length > 100 ? Number((this.db.prepare("SELECT COUNT(*) AS n FROM agent_evidence WHERE request_id=?").get(requestId) as Row).n) : evidenceIds.length;
    return { requestId, source: { kind: row.source_kind as "chat" | "service", requestId,
      ...(row.service_name ? { serviceName: String(row.service_name) } : {}), phase: row.phase as RequestPhase },
      goal: publicText(String(row.goal)), state: row.state as AgentRequestState, disposition: row.disposition as "live" | "historical",
      createdAt: String(row.created_at), updatedAt: String(row.updated_at), expiresAt: String(row.expires_at),
      retryOf: row.retry_of as string | null, autoRunCount: Number(row.auto_run_count),
      waitRef: row.wait_ref_json === null ? null : JSON.parse(String(row.wait_ref_json)) as AgentWaitRef,
      runIds, evidenceIds: evidenceIds.slice(0, 100), ...(evidenceCount > 100 ? { evidenceCount, evidenceTruncated: true } : {}), result: row.result === null ? null : publicText(String(row.result)),
      error: row.error_json === null ? null : redactValue(JSON.parse(String(row.error_json))) as AgentRequest["error"] };
  }

  internal(workId: string, requestId: string): RequestInternals | undefined {
    const row = this.db.prepare("SELECT * FROM agent_requests WHERE work_id=? AND request_id=?").get(workId, requestId) as Row | undefined;
    const request = this.getRequest(workId, requestId);
    if (!row || !request) return undefined;
    // The workflow uses the original goal; public redaction never changes its meaning.
    return { request: { ...request, goal: String(row.goal) }, phase: row.phase as RequestPhase,
      sourceServiceId: row.source_service_id as string | null, sourceRunId: row.source_run_id as string | null,
      actionRefs: JSON.parse(String(row.action_refs_json)) as ActionReference[],
      packageSubmission: row.package_submission_json === null ? null : JSON.parse(String(row.package_submission_json)) };
  }

  requestForRun(workId: string, runId: string): RequestInternals | undefined {
    const row = this.db.prepare("SELECT r.request_id FROM agent_requests r JOIN agent_request_runs a ON r.request_id=a.request_id WHERE r.work_id=? AND a.run_id=? AND a.disposition='live'").get(workId, runId) as Row | undefined;
    return row ? this.internal(workId, String(row.request_id)) : undefined;
  }

  /** The latest associated Run is history, never a prompt to replay. */
  needsRecovery(workId: string, requestId: string): boolean {
    const current = this.internal(workId, requestId);
    if (!current || current.request.disposition !== "live" || current.request.state !== "pending") return false;
    const last = this.db.prepare("SELECT r.state FROM agent_request_runs a JOIN runs r ON r.run_id=a.run_id WHERE a.request_id=? ORDER BY a.rowid DESC LIMIT 1")
      .get(requestId) as Row | undefined;
    return last?.state === "interrupted";
  }

  recoveryPhase(workId: string, requestId: string, phase: "verifying" | "adopting", now: string): boolean {
    return this.transaction(() => {
      if (!this.needsRecovery(workId, requestId)) return false;
      const current = this.internal(workId, requestId)!;
      if (current.request.expiresAt <= now) return false;
      this.db.prepare("UPDATE agent_requests SET phase=?,updated_at=? WHERE request_id=?").run(phase, now, requestId);
      return true;
    });
  }

  attachRunEvidence(workId: string, runId: string, requestId: string): void {
    this.transaction(() => {
      if (this.requestForRun(workId, runId)?.request.requestId !== requestId) throw new FeedbackError("EVIDENCE_SCOPE_INVALID", "Run is not associated with this request");
      this.db.prepare("UPDATE agent_evidence SET request_id=? WHERE work_id=? AND run_id=? AND request_id IS NULL").run(requestId, workId, runId);
    });
  }

  /** Owner retry can enter handling only after host reconciliation of every original effect. */
  authorizeRetryHandling(workId: string, requestId: string): void {
    this.transaction(() => {
      const current = this.requireLive(workId, requestId);
      if (!current.request.retryOf || current.request.state !== "pending" || current.phase !== "verifying" || current.packageSubmission) {
        throw new FeedbackError("MUTATION_NOT_ALLOWED", "Retry reconciliation is not eligible");
      }
      for (const ref of current.actionRefs) {
        const rows = this.db.prepare("SELECT details_json FROM agent_evidence WHERE work_id=? AND request_id=? AND service_name=? AND verified=1 AND ((kind='action' AND object_ref=?) OR (kind='job' AND object_ref=?))")
          .all(workId, requestId, ref.serviceName, ref.actionId, ref.jobId ?? "") as Row[];
        if (ref.status !== "known" || !rows.some((r) => ["succeeded", "failed", "cancelled"].includes(String((JSON.parse(String(r.details_json)) as { state?: unknown }).state)))) {
          throw new FeedbackError("ACTION_RESULT_UNKNOWN", "Every original effect must have a known terminal result");
        }
      }
      this.db.prepare("UPDATE agent_requests SET phase='handling' WHERE request_id=?").run(requestId);
    });
  }

  listRequests(workId: string, query: AgentRequestQuery = {}, serviceId?: string): Page<AgentRequest> {
    const scope = contentDigest({ workId, serviceId: serviceId ?? null, serviceName: query.serviceName ?? null,
      state: query.state ?? null, disposition: query.disposition ?? null });
    const after = decodeCursor(query.cursor, scope);
    const limit = pageLimit(query.limit);
    const clauses = ["work_id=?"], params: SQLInputValue[] = [workId];
    for (const [column, value] of [["source_service_id", serviceId], ["service_name", query.serviceName], ["state", query.state], ["disposition", query.disposition]] as const) {
      if (value !== undefined) { clauses.push(`${column}=?`); params.push(value); }
    }
    if (after !== null) { const [time, id] = after.split("\0"); clauses.push("(created_at>? OR (created_at=? AND request_id>?))"); params.push(time!, time!, id!); }
    const rows = this.db.prepare(`SELECT request_id,created_at FROM agent_requests WHERE ${clauses.join(" AND ")} ORDER BY created_at,request_id LIMIT ?`).all(...params, limit + 1) as Row[];
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return { items: page.map((r) => this.getRequest(workId, String(r.request_id))!),
      nextCursor: rows.length > limit && last ? encodeCursor(scope, `${last.created_at}\0${last.request_id}`) : null };
  }

  pending(workId: string): RequestInternals[] {
    const rows = this.db.prepare("SELECT request_id FROM agent_requests WHERE work_id=? AND disposition='live' AND state='pending' ORDER BY created_at,request_id").all(workId) as Row[];
    return rows.map((r) => this.internal(workId, String(r.request_id))!);
  }
  unfinished(workId: string): RequestInternals[] {
    const rows = this.db.prepare("SELECT request_id FROM agent_requests WHERE work_id=? AND disposition='live' AND state NOT IN('completed','failed','cancelled','needs_attention') ORDER BY created_at,request_id").all(workId) as Row[];
    return rows.map((r) => this.internal(workId, String(r.request_id))!);
  }
  waiting(workId: string): RequestInternals[] {
    const rows = this.db.prepare("SELECT request_id FROM agent_requests WHERE work_id=? AND disposition='live' AND state IN('waiting_result','waiting_apply') ORDER BY created_at,request_id").all(workId) as Row[];
    return rows.map((r) => this.internal(workId, String(r.request_id))!);
  }

  wait(workId: string, requestId: string, ref: AgentWaitRef, now = new Date().toISOString()): AgentRequest {
    return this.transaction(() => {
      const current = this.requireLive(workId, requestId);
      if (current.request.state !== "running") throw new FeedbackError("REQUEST_NOT_RUNNING", "Only the current handling Run may register a wait");
      if (!ref.id || !ref.verificationGoal || Buffer.byteLength(ref.verificationGoal) > BRAIN_LIMITS.goalBytes || !Number.isFinite(Date.parse(ref.deadlineAt))) throw new FeedbackError("INVALID_WAIT", "Invalid wait reference");
      const expiresAt = ref.kind === "apply" ? new Date(Date.parse(now) + BRAIN_LIMITS.applyTimeoutMs).toISOString() : current.request.expiresAt;
      const deadlineAt = new Date(Math.min(Date.parse(ref.deadlineAt), Date.parse(expiresAt), Date.parse(now) + (ref.kind === "apply" ? BRAIN_LIMITS.applyTimeoutMs : BRAIN_LIMITS.requestTimeoutMs))).toISOString();
      if (deadlineAt <= now) throw new FeedbackError("REQUEST_EXPIRED", "Wait deadline passed");
      this.db.prepare("UPDATE agent_requests SET state=?,wait_ref_json=?,expires_at=?,updated_at=? WHERE request_id=?")
        .run(ref.kind === "apply" ? "waiting_apply" : "waiting_result", JSON.stringify({ ...ref, deadlineAt }), expiresAt, now, requestId);
      return this.getRequest(workId, requestId)!;
    });
  }

  /** Host-only recovery/retry: wait on an original effect without a model Run. */
  waitForOriginalRetry(workId: string, requestId: string, ref: AgentWaitRef, now = new Date().toISOString()): void {
    this.transaction(() => {
      const current = this.requireLive(workId, requestId);
      if ((!current.request.retryOf && !this.needsRecovery(workId, requestId)) || current.request.state !== "pending" || current.phase !== "verifying" || !ref.serviceName
        || !["action", "job"].includes(ref.kind) || ref.nextPhase !== "verifying"
        || !current.actionRefs.some((r) => r.status === "known" && r.serviceName === ref.serviceName && (ref.kind === "job" ? r.jobId === ref.id : r.actionId === ref.id))) {
        throw new FeedbackError("INVALID_WAIT", "Retry can only wait for its original known effect");
      }
      const deadlineAt = new Date(Math.min(Date.parse(ref.deadlineAt), Date.parse(current.request.expiresAt), Date.parse(now) + BRAIN_LIMITS.requestTimeoutMs)).toISOString();
      if (deadlineAt <= now) throw new FeedbackError("REQUEST_EXPIRED", "Original effect deadline passed");
      this.db.prepare("UPDATE agent_requests SET state='waiting_result',wait_ref_json=?,updated_at=? WHERE request_id=?")
        .run(JSON.stringify({ ...ref, deadlineAt }), now, requestId);
    });
  }

  resume(workId: string, requestId: string, expectedWaitId: string, now = new Date().toISOString()): boolean {
    return this.transaction(() => {
      const current = this.internal(workId, requestId);
      if (!current || current.request.disposition !== "live" || !["waiting_result", "waiting_apply"].includes(current.request.state)
        || current.request.waitRef?.id !== expectedWaitId || current.request.expiresAt <= now
        || current.request.waitRef.deadlineAt <= now) return false;
      this.db.prepare("UPDATE agent_requests SET state='pending',phase=?,updated_at=? WHERE request_id=?")
        .run(current.request.waitRef.nextPhase, now, requestId);
      return true;
    });
  }

  /** Host-only transition after observing an existing package receipt/prepared candidate. */
  registerPackageWait(workId: string, requestId: string, ref: AgentWaitRef, now = new Date().toISOString()): void {
    this.transaction(() => {
      const goal = this.requireLive(workId, requestId);
      if (!goal.packageSubmission || !["package-operation", "apply"].includes(ref.kind) || ref.nextPhase !== "adopting") throw new FeedbackError("INVALID_WAIT", "Package wait requires an original persisted candidate");
      if (!["running", "waiting_result", "waiting_apply"].includes(goal.request.state) && !(goal.request.state === "pending" && (goal.request.retryOf || this.needsRecovery(workId, requestId)))) throw new FeedbackError("REQUEST_NOT_RUNNING", "Package wait is not eligible");
      // Check the old deadlines inside this transaction, before granting the
      // first Apply budget or returning an existing Apply wait unchanged.
      if (goal.request.expiresAt <= now || (["waiting_result", "waiting_apply"].includes(goal.request.state)
        && goal.request.waitRef && goal.request.waitRef.deadlineAt <= now)) throw new FeedbackError("REQUEST_EXPIRED", "Original candidate deadline passed");
      if (goal.request.state === "waiting_apply" && ref.kind === "apply") return;
      const expires = ref.kind === "apply" ? new Date(Date.parse(now) + BRAIN_LIMITS.applyTimeoutMs).toISOString() : goal.request.expiresAt;
      const deadline = new Date(Math.min(Date.parse(ref.deadlineAt), Date.parse(expires))).toISOString();
      if (deadline <= now) throw new FeedbackError("REQUEST_EXPIRED", "Candidate wait deadline passed");
      this.db.prepare("UPDATE agent_requests SET state=?,wait_ref_json=?,expires_at=?,updated_at=? WHERE request_id=?")
        .run(ref.kind === "apply" ? "waiting_apply" : "waiting_result", canonicalJson({ ...ref, deadlineAt: deadline }), expires, now, requestId);
    });
  }

  cancel(workId: string, requestId: string, serviceId?: string, now = new Date().toISOString()): AgentRequest {
    return this.transaction(() => {
      const current = this.getRequest(workId, requestId, serviceId);
      if (!current) throw new FeedbackError("REQUEST_NOT_FOUND", "Request not found");
      if (current.disposition !== "live") throw new FeedbackError("REQUEST_RETRY_NOT_ALLOWED", "Historical requests are read only");
      if (terminal(current.state)) return current;
      const active = this.db.prepare("SELECT r.run_id FROM runs r JOIN agent_request_runs a ON r.run_id=a.run_id WHERE a.request_id=? AND r.state IN('accepted','running','cancelling')").get(requestId) as Row | undefined;
      if (active) {
        this.db.prepare("UPDATE agent_requests SET state='cancelling',updated_at=? WHERE request_id=?").run(now, requestId);
        this.db.prepare("UPDATE runs SET state='cancelling' WHERE run_id=?").run(active.run_id!);
      } else this.finish(workId, requestId, "cancelled", "Pi request cancelled", null, [], now);
      return this.getRequest(workId, requestId)!;
    });
  }

  retry(workId: string, requestId: string, submissionKey: string, now = new Date().toISOString()): AgentRequest {
    if (!submissionKey || submissionKey.length > 256) throw new FeedbackError("INVALID_SUBMISSION_KEY", "Invalid retry submission key");
    return this.transaction(() => {
      const digest = contentDigest({ requestId });
      const key = `retry:${submissionKey}`;
      const prior = this.db.prepare("SELECT request_id,request_digest FROM agent_requests WHERE work_id=? AND submission_key=?").get(workId, key) as Row | undefined;
      if (prior) {
        if (prior.request_digest !== digest) throw new FeedbackError("SUBMIT_CONFLICT", "Retry key was used for another request");
        return this.getRequest(workId, String(prior.request_id))!;
      }
      const current = this.requireLive(workId, requestId);
      if (!["failed", "cancelled", "needs_attention"].includes(current.request.state)) throw new FeedbackError("REQUEST_RETRY_NOT_ALLOWED", "Only failed, cancelled or attention requests may be retried");
      this.checkCapacity(workId);
      const id = `request-${randomUUID()}`;
      this.insertRequest({ workId, requestId: id, key, digest, kind: current.request.source.kind,
        ...(current.request.source.serviceName ? { serviceName: current.request.source.serviceName } : {}),
        ...(current.sourceServiceId ? { serviceId: current.sourceServiceId } : {}),
        ...(current.sourceRunId ? { sourceRunId: current.sourceRunId } : {}), goal: current.request.goal, retryOf: requestId, now });
      // Original effects must be queried before the new goal may perform any mutation.
      this.db.prepare("UPDATE agent_requests SET phase='verifying',action_refs_json=?,package_submission_json=?,wait_ref_json=? WHERE request_id=?")
        .run(JSON.stringify(current.actionRefs), current.packageSubmission === null ? null : JSON.stringify(current.packageSubmission),
          current.request.waitRef === null ? null : JSON.stringify(current.request.waitRef), id);
      return this.getRequest(workId, id)!;
    });
  }

  recordAction(workId: string, requestId: string, reference: ActionReference): void {
    this.transaction(() => {
      const current = this.requireLive(workId, requestId);
      if (current.request.state !== "running" || current.phase !== "handling") throw new FeedbackError("MUTATION_NOT_ALLOWED", "Verification cannot perform a new mutation");
      const prior = current.actionRefs.find((r) => r.serviceName === reference.serviceName && r.actionId === reference.actionId);
      if (!prior && current.actionRefs.length >= 100) throw new FeedbackError("REQUEST_BUDGET_EXCEEDED", "Request has 100 original Actions; finish or report attention before adding another");
      if (!prior && current.actionRefs.some((r) => r.status === "calling" || r.status === "unknown")) throw new FeedbackError("ACTION_RESULT_UNKNOWN", "Reconcile the original Action before starting another mutation");
      const inputKey = (r: ActionReference) => contentDigest({ actionName: r.actionName, input: r.input, expectedStateVersion: r.expectedStateVersion, verificationQuery: r.verificationQuery });
      if (prior && inputKey(prior) !== inputKey(reference)) throw new FeedbackError("ACTION_IDEMPOTENCY_CONFLICT", "Action identity already has different input");
      const refs = [...current.actionRefs.filter((r) => !(r.serviceName === reference.serviceName && r.actionId === reference.actionId)), reference];
      this.db.prepare("UPDATE agent_requests SET action_refs_json=? WHERE request_id=?").run(canonicalJson(refs), requestId);
    });
  }

  setPackageSubmission(workId: string, requestId: string, value: unknown): unknown {
    if (!Check(BrainCandidateSubmissionSchema, value) || !isBrainVerificationTarget(value.verificationTarget)) throw new FeedbackError("PI_PACKAGE_INVALID", "Candidate requires the current fixed verification target");
    return this.transaction(() => {
      const current = this.requireLive(workId, requestId);
      if (current.request.state !== "running" || current.phase !== "handling") throw new FeedbackError("MUTATION_NOT_ALLOWED", "Package preparation requires a handling Run");
      if (current.packageSubmission !== null) {
        if (contentDigest(current.packageSubmission) !== contentDigest(value)) throw new FeedbackError("SUBMIT_CONFLICT", "Brain candidate submission changed");
        return current.packageSubmission;
      }
      this.db.prepare("UPDATE agent_requests SET package_submission_json=? WHERE request_id=?").run(canonicalJson(value), requestId);
      return value;
    });
  }

  reconcileAction(workId: string, requestId: string, serviceName: string, actionId: string, jobId?: string): void {
    this.transaction(() => {
      const current = this.requireLive(workId, requestId);
      if (terminal(current.request.state)) return;
      const reference = current.actionRefs.find((r) => r.serviceName === serviceName && r.actionId === actionId);
      if (!reference) throw new FeedbackError("ACTION_RESULT_UNKNOWN", "Only a previously registered Action can be reconciled");
      if (reference.jobId !== undefined && jobId !== undefined && reference.jobId !== jobId) throw new FeedbackError("INVALID_WAIT", "Original Action changed its Job identity");
      const refs = current.actionRefs.map((r) => r.serviceName === serviceName && r.actionId === actionId
        ? { ...r, status: "known" as const, ...(jobId === undefined ? {} : { jobId }) } : r);
      this.db.prepare("UPDATE agent_requests SET action_refs_json=? WHERE request_id=?").run(canonicalJson(refs), requestId);
    });
  }

  finish(workId: string, requestId: string, state: typeof REQUEST_TERMINAL_STATES[number], result: string | null,
    error: AgentRequest["error"], proofIds: readonly string[] = [], now = new Date().toISOString()): boolean {
    return this.transaction(() => {
      const current = this.requireLive(workId, requestId);
      if (terminal(current.request.state)) return false;
      if (current.request.state === "cancelling" && state !== "cancelled" && state !== "needs_attention") return false;
      if (state === "completed") {
        if (current.request.state !== "running" || proofIds.length === 0) throw new FeedbackError("VERIFICATION_REQUIRED", "Completion needs actual verification evidence");
        if (current.request.expiresAt <= now) throw new FeedbackError("REQUEST_EXPIRED", "Completion arrived after the request deadline");
        for (const id of proofIds) {
          const proof = this.getEvidence(workId, id);
          if (!proof || proof.requestId !== requestId || !proof.verified || proof.kind === "event") throw new FeedbackError("VERIFICATION_REQUIRED", "Completion proof is missing, unverified or belongs to another goal");
        }
        const all = this.db.prepare("SELECT * FROM agent_evidence WHERE work_id=? AND request_id=? AND verified=1").all(workId, requestId) as Row[];
        const actual = (r: Row): Record<string, unknown> => r.details_json ? JSON.parse(String(r.details_json)) as Record<string, unknown> : {};
        const matchesJob = (e: Row, ref: ActionReference): boolean => ref.jobId !== undefined && e.object_ref === ref.jobId
          && actual(e).jobId === ref.jobId && actual(e).actionId === ref.actionId;
        if (all.some((e) => e.kind === "job" && proofIds.includes(String(e.evidence_id)) && current.actionRefs.some((ref) => e.service_name === ref.serviceName
          && (e.object_ref === ref.jobId || actual(e).actionId === ref.actionId) && !matchesJob(e, ref)))) {
          throw new FeedbackError("VERIFICATION_REQUIRED", "Job completion proof does not match the original Action and Job identity");
        }
        const hasChecks = (r: Row): boolean => {
          const checks = actual(r).checks;
          return Array.isArray(checks) && checks.length > 0 && checks.every((c) => c !== null && typeof c === "object" && (c as { passed?: unknown }).passed === true);
        };
        const candidate = current.packageSubmission as { verificationTarget?: unknown } | null;
        const active = this.db.prepare("SELECT r.run_id,r.context_identity FROM runs r JOIN agent_request_runs a ON a.run_id=r.run_id WHERE a.request_id=? AND r.state IN('accepted','running')").get(requestId) as Row | undefined;
        const adoption = (e: Row): boolean => e.kind === "sdk" && e.run_id === active?.run_id && proofIds.includes(String(e.evidence_id))
          && isBrainVerificationTarget(candidate?.verificationTarget) && validBrainAdoption(actual(e), candidate.verificationTarget, {
            requestId, runId: String(e.run_id), contextIdentity: String(active?.context_identity), artifactDigest: this.candidateArtifact(workId, requestId),
          });
        if (candidate && !all.some(adoption)) {
          throw new FeedbackError("VERIFICATION_REQUIRED", "Brain candidate completion requires this Run's matching tool, input and successful fixed checks");
        }
        for (const ref of current.actionRefs) {
          const known = ref.status === "known" && all.some((e) => e.service_name === ref.serviceName
            && ((e.kind === "action" && e.object_ref === ref.actionId) || (e.kind === "job" && matchesJob(e, ref))) && ["succeeded", "failed", "cancelled"].includes(String(actual(e).state)));
          const verified = all.some((e) => e.kind === "query" && e.service_name === ref.serviceName && e.object_ref === ref.verificationQuery && hasChecks(e));
          if (!known || !verified) throw new FeedbackError("VERIFICATION_REQUIRED", "Every original Action requires a known terminal result and its actual verification query");
        }
        const preferenceProof = current.request.source.kind === "chat" && all.some((e) => e.kind === "sdk" && e.run_id === current.sourceRunId && actual(e).userPreferenceVerified === true);
        if (!preferenceProof && !all.some((e) => (e.kind === "query" && hasChecks(e)) || adoption(e))) {
          throw new FeedbackError("VERIFICATION_REQUIRED", "Completion requires actual successful query checks or SDK adoption verification");
        }
        this.commitExperience(workId, requestId, now);
      } else if (this.memory) this.memory.reject(workId, requestId, now);
      else this.db.prepare("UPDATE brain_experience_revisions SET status='failed' WHERE work_id=? AND source_request_id=? AND status='staged'").run(workId, requestId);
      this.db.prepare("UPDATE agent_requests SET state=?,result=?,error_json=?,updated_at=? WHERE request_id=?")
        .run(state, result, error === null ? null : canonicalJson(error), now, requestId);
      return true;
    });
  }

  /** Run completion never itself proves business completion. */
  settleRun(workId: string, runId: string, state: string, now = new Date().toISOString()): void {
    const current = this.requestForRun(workId, runId);
    if (!current || current.request.disposition !== "live" || terminal(current.request.state)) return;
    if (current.request.state === "cancelling" || state === "cancelled") { this.finish(workId, current.request.requestId, "cancelled", null, null, [], now); return; }
    if (state === "interrupted") {
      if (current.request.waitRef && ["waiting_result", "waiting_apply"].includes(current.request.state)) return;
      if (current.actionRefs.length || current.packageSubmission) {
        this.db.prepare("UPDATE agent_requests SET state='pending',phase='verifying',updated_at=? WHERE request_id=?").run(now, current.request.requestId);
        return;
      }
      this.finish(workId, current.request.requestId, "needs_attention", null, { code: "ACTION_RESULT_UNKNOWN", message: "Run interrupted; inspect original effects before retry" }, [], now); return;
    }
    if (state === "succeeded" && ["waiting_result", "waiting_apply"].includes(current.request.state)) return;
    const unknown = current.actionRefs.some((r) => r.status !== "known");
    const runError = this.db.prepare("SELECT error_json FROM runs WHERE run_id=?").get(runId) as Row | undefined;
    const code = runError?.error_json ? (JSON.parse(String(runError.error_json)) as { code?: string }).code : undefined;
    const deadline = code === "REQUEST_EXPIRED" || code === "REQUEST_BUDGET_EXCEEDED";
    const unproved = deadline && (!!current.packageSubmission || !!current.request.waitRef || current.actionRefs.some((ref) => {
      const evidence = this.db.prepare("SELECT details_json FROM agent_evidence WHERE work_id=? AND request_id=? AND service_name=? AND verified=1 AND ((kind='action' AND object_ref=?) OR (kind='job' AND object_ref=?))")
        .all(workId, current.request.requestId, ref.serviceName, ref.actionId, ref.jobId ?? "") as Row[];
      return ref.status !== "known" || !evidence.some((e) => ["succeeded", "failed", "cancelled"].includes(String((JSON.parse(String(e.details_json)) as { state?: unknown }).state)));
    }));
    this.finish(workId, current.request.requestId, state === "succeeded" || unknown || unproved || !!current.packageSubmission ? "needs_attention" : "failed", null,
      { code: deadline ? code : unknown ? "ACTION_RESULT_UNKNOWN" : state === "succeeded" || !!current.packageSubmission ? "VERIFICATION_REQUIRED" : "RUN_FAILED",
        message: unknown ? "Original Action result must be reconciled" : state === "succeeded" ? "Run finished without proof or a valid wait" : "Run failed" }, [], now);
  }

  expire(workId: string, now = new Date().toISOString()): void {
    const rows = this.db.prepare("SELECT request_id FROM agent_requests WHERE work_id=? AND disposition='live' AND expires_at<=? AND state NOT IN('completed','failed','cancelled','needs_attention')").all(workId, now) as Row[];
    for (const row of rows) {
      const current = this.internal(workId, String(row.request_id))!;
      if (current.request.state === "running" || current.request.state === "cancelling") continue; // Host must abort the SDK first.
      const effects = !!current.request.waitRef || !!current.packageSubmission || current.actionRefs.length > 0;
      this.finish(workId, current.request.requestId, effects ? "needs_attention" : "failed", null,
        { code: "REQUEST_EXPIRED", message: "Request deadline passed" }, [], now);
    }
  }

  recordCandidateArtifact(workId: string, requestId: string, receiptId: string, artifactDigest: string, sourceDigest: string, now: string): void {
    const current = this.requireLive(workId, requestId);
    if (terminal(current.request.state) || current.request.state === "cancelling") return;
    const submission = current.packageSubmission as { expectedSourceDigest?: unknown } | null;
    if (!submission || submission.expectedSourceDigest !== sourceDigest || !/^sha256:[a-f0-9]{64}$/.test(artifactDigest)) throw new FeedbackError("PI_PACKAGE_CANDIDATE_CONFLICT", "Original artifact receipt does not match its source");
    const existing = this.candidateArtifact(workId, requestId);
    if (existing && existing !== artifactDigest) throw new FeedbackError("PI_PACKAGE_CANDIDATE_CONFLICT", "Original candidate receipt changed its artifact");
    if (existing) return;
    this.addEvidence(workId, { requestId, runId: null, kind: "package", objectRef: receiptId, observedAt: now,
      summary: "Original candidate artifact captured; behavior verification is still required", verified: false },
    { candidateArtifactDigest: artifactDigest, sourceDigest, requestId }, true);
  }

  candidateArtifact(workId: string, requestId: string): string | undefined {
    const rows = this.db.prepare("SELECT details_json FROM agent_evidence WHERE work_id=? AND request_id=? AND kind='package'").all(workId, requestId) as Row[];
    return rows.map((r) => r.details_json ? (JSON.parse(String(r.details_json)) as { candidateArtifactDigest?: string }).candidateArtifactDigest : undefined).find((v) => v !== undefined);
  }

  addEvidence(workId: string, evidence: Omit<AgentEvidence, "evidenceId">, details?: unknown, privateBrainDetails = false): AgentEvidence {
    return this.transaction(() => {
      if (evidence.requestId !== null && !this.getRequest(workId, evidence.requestId)) throw new FeedbackError("EVIDENCE_SCOPE_INVALID", "Evidence request belongs to another Work");
      if (evidence.runId !== null) {
        const run = this.db.prepare("SELECT work_id FROM runs WHERE run_id=?").get(evidence.runId) as Row | undefined;
        if (!run || run.work_id !== workId) throw new FeedbackError("EVIDENCE_SCOPE_INVALID", "Evidence Run belongs to another Work");
        if (evidence.requestId !== null) {
          const link = this.db.prepare("SELECT request_id FROM agent_request_runs WHERE run_id=?").get(evidence.runId) as Row | undefined;
          if (!link || link.request_id !== evidence.requestId) throw new FeedbackError("EVIDENCE_SCOPE_INVALID", "Evidence Run is not associated with this request");
        }
      }
      if (evidence.kind === "event" && evidence.verified) throw new FeedbackError("VERIFICATION_REQUIRED", "Event contents are not verified evidence");
      const id = `evidence-${randomUUID()}`;
      this.db.prepare("INSERT INTO agent_evidence(work_id,evidence_id,request_id,run_id,service_name,kind,object_ref,observed_at,state_version,code_version,summary,verified,details_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(workId, id, evidence.requestId, evidence.runId, evidence.serviceName ?? null, evidence.kind, publicText(evidence.objectRef), evidence.observedAt,
          evidence.stateVersion ?? null, evidence.codeVersion ?? null, publicText(evidence.summary), evidence.verified ? 1 : 0,
          details === undefined ? null : canonicalJson(privateBrainDetails ? details : redactValue(details)));
      return this.getEvidence(workId, id)!;
    });
  }

  getEvidence(workId: string, evidenceId: string): AgentEvidence | undefined {
    const r = this.db.prepare("SELECT * FROM agent_evidence WHERE work_id=? AND evidence_id=?").get(workId, evidenceId) as Row | undefined;
    if (!r) return undefined;
    return { evidenceId, requestId: r.request_id as string | null, runId: r.run_id as string | null,
      ...(r.service_name ? { serviceName: String(r.service_name) } : {}), kind: r.kind as AgentEvidence["kind"],
      objectRef: publicText(String(r.object_ref)), observedAt: String(r.observed_at),
      ...(r.state_version ? { stateVersion: String(r.state_version) } : {}), ...(r.code_version ? { codeVersion: String(r.code_version) } : {}),
      summary: publicText(String(r.summary)), verified: r.verified === 1 };
  }
  evidenceDetails(workId: string, id: string): unknown | undefined {
    const r = this.db.prepare("SELECT details_json FROM agent_evidence WHERE work_id=? AND evidence_id=?").get(workId, id) as Row | undefined;
    return r?.details_json ? JSON.parse(String(r.details_json)) : undefined;
  }
  listEvidence(workId: string, requestId: string, limit?: number, cursor?: string): Page<AgentEvidence> {
    if (!this.getRequest(workId, requestId)) throw new FeedbackError("REQUEST_NOT_FOUND", "Request not found");
    const scope = contentDigest({ workId, requestId, kind: "evidence" });
    const after = decodeCursor(cursor, scope);
    const count = pageLimit(limit), params: SQLInputValue[] = [workId, requestId];
    let boundary = "";
    if (after !== null) { const [time, id] = after.split("\0"); boundary = " AND (observed_at>? OR (observed_at=? AND evidence_id>?))"; params.push(time!, time!, id!); }
    const rows = this.db.prepare(`SELECT evidence_id,observed_at FROM agent_evidence WHERE work_id=? AND request_id=?${boundary} ORDER BY observed_at,evidence_id LIMIT ?`).all(...params, count + 1) as Row[];
    const page = rows.slice(0, count); const last = page.at(-1);
    return { items: page.map((r) => this.getEvidence(workId, String(r.evidence_id))!),
      nextCursor: rows.length > count && last ? encodeCursor(scope, `${last.observed_at}\0${last.evidence_id}`) : null };
  }

  stageExperience(workId: string, requestId: string, entry: Omit<ExperienceEntry, "sourceRequestId"> & Partial<MemoryCandidateInput>,
    userPreference = false, now = new Date().toISOString()): number {
    if (this.memory) return this.memory.propose(workId, requestId, entry, userPreference, now);
    return this.transaction(() => {
      const current = this.requireLive(workId, requestId);
      if (current.request.state !== "running") throw new FeedbackError("REQUEST_NOT_RUNNING", "Experience must be staged by the active goal");
      validateExperience(entry);
      if (entry.evidenceIds.length === 0 && !(userPreference && current.request.source.kind === "chat")) throw new FeedbackError("VERIFICATION_REQUIRED", "Observed rule requires actual evidence");
      for (const id of entry.evidenceIds) {
        const e = this.getEvidence(workId, id);
        if (!e || e.requestId !== requestId || e.kind === "event") throw new FeedbackError("VERIFICATION_REQUIRED", "Experience evidence is missing or belongs to another goal");
      }
      const candidates = this.experienceSnapshot(workId).entries.filter((e) => e.entryId !== entry.entryId);
      if (candidates.length >= BRAIN_LIMITS.experienceEntries) throw new FeedbackError("EXPERIENCE_LIMIT_EXCEEDED", "Merge or replace an existing rule before adding another");
      const existing = this.db.prepare("SELECT version FROM brain_experience_revisions WHERE work_id=? AND source_request_id=? AND status='staged' LIMIT 1").get(workId, requestId) as Row | undefined;
      const version = existing ? Number(existing.version) : this.nextExperienceVersion(workId);
      this.db.prepare("INSERT INTO brain_experience_revisions(work_id,version,entry_id,scope,rule,evidence_ids_json,source_request_id,status,created_at) VALUES(?,?,?,?,?,?,?,'staged',?) ON CONFLICT(work_id,version,entry_id) DO UPDATE SET scope=excluded.scope,rule=excluded.rule,evidence_ids_json=excluded.evidence_ids_json")
        .run(workId, version, entry.entryId, entry.scope, entry.rule, canonicalJson(entry.evidenceIds), requestId, now);
      return version;
    });
  }

  experienceSnapshot(workId: string, pinnedVersion?: number): ExperienceSnapshot {
    if (this.memory) return this.memory.snapshot(workId, pinnedVersion);
    const h = this.db.prepare("SELECT version FROM brain_experience_heads WHERE work_id=?").get(workId) as Row | undefined;
    const version = pinnedVersion ?? (h ? Number(h.version) : 0);
    if (version === 0) return { version: 0, entries: [] };
    const rows = this.db.prepare("SELECT * FROM brain_experience_revisions WHERE work_id=? AND version=? ORDER BY entry_id").all(workId, version) as Row[];
    if (!rows.length || rows.length > BRAIN_LIMITS.experienceEntries || rows.some((r) => r.status !== "effective")) throw new FeedbackError("EXPERIENCE_INVALID", "Experience head is corrupt");
    const entries = rows.map((r): ExperienceEntry => ({ entryId: String(r.entry_id), scope: String(r.scope), rule: String(r.rule),
      evidenceIds: JSON.parse(String(r.evidence_ids_json)) as string[], sourceRequestId: String(r.source_request_id) }));
    for (const entry of entries) {
      validateExperience(entry);
      const source = this.getRequest(workId, entry.sourceRequestId);
      if (!source) throw new FeedbackError("EXPERIENCE_INVALID", "Experience source is missing");
      for (const id of entry.evidenceIds) {
        const e = this.getEvidence(workId, id);
        if (!e?.verified || e.kind === "event" || e.requestId !== entry.sourceRequestId) throw new FeedbackError("EXPERIENCE_INVALID", "Experience proof is missing or unverified");
      }
      if (entry.evidenceIds.length === 0 && source.source.kind !== "chat") throw new FeedbackError("EXPERIENCE_INVALID", "Service experience requires proof");
    }
    return { version, entries };
  }

  private commitExperience(workId: string, requestId: string, now: string): void {
    if (this.memory) { this.memory.commit(workId, requestId, now); return; }
    const staged = this.db.prepare("SELECT * FROM brain_experience_revisions WHERE work_id=? AND source_request_id=? AND status='staged'").all(workId, requestId) as Row[];
    if (!staged.length) return;
    const current = new Map(this.experienceSnapshot(workId).entries.map((e) => [e.entryId, e]));
    for (const row of staged) {
      const ids = JSON.parse(String(row.evidence_ids_json)) as string[];
      for (const id of ids) { if (!this.getEvidence(workId, id)?.verified) throw new FeedbackError("VERIFICATION_REQUIRED", "Experience proof has not passed verification"); }
      current.set(String(row.entry_id), { entryId: String(row.entry_id), scope: String(row.scope), rule: String(row.rule), evidenceIds: ids, sourceRequestId: requestId });
    }
    if (current.size > BRAIN_LIMITS.experienceEntries) throw new FeedbackError("EXPERIENCE_LIMIT_EXCEEDED", "Merge or replace rules explicitly");
    const version = this.nextExperienceVersion(workId);
    for (const entry of current.values()) this.db.prepare("INSERT INTO brain_experience_revisions(work_id,version,entry_id,scope,rule,evidence_ids_json,source_request_id,status,created_at) VALUES(?,?,?,?,?,?,?,'effective',?)")
      .run(workId, version, entry.entryId, entry.scope, entry.rule, canonicalJson(entry.evidenceIds), entry.sourceRequestId, now);
    this.db.prepare("UPDATE brain_experience_revisions SET status='effective' WHERE work_id=? AND source_request_id=? AND status='staged'").run(workId, requestId);
    this.db.prepare("INSERT INTO brain_experience_heads(work_id,version,updated_at) VALUES(?,?,?) ON CONFLICT(work_id) DO UPDATE SET version=excluded.version,updated_at=excluded.updated_at").run(workId, version, now);
  }
  private nextExperienceVersion(workId: string): number {
    return Number((this.db.prepare("SELECT COALESCE(MAX(version),0)+1 AS version FROM brain_experience_revisions WHERE work_id=?").get(workId) as Row).version);
  }
  private requireLive(workId: string, id: string): RequestInternals {
    const value = this.internal(workId, id);
    if (!value) throw new FeedbackError("REQUEST_NOT_FOUND", "Request not found");
    if (value.request.disposition !== "live") throw new FeedbackError("REQUEST_RETRY_NOT_ALLOWED", "Historical requests are read only");
    return value;
  }
  private checkCapacity(workId: string): void {
    const count = this.db.prepare("SELECT COUNT(*) AS n FROM agent_requests WHERE work_id=? AND disposition='live' AND state NOT IN('completed','failed','cancelled','needs_attention')").get(workId) as Row;
    if (Number(count.n) >= BRAIN_LIMITS.liveRequests) throw new FeedbackError("REQUEST_CAPACITY_EXCEEDED", "Work has 100 unfinished Pi requests");
  }
  private insertRequest(input: { workId: string; requestId: string; key: string; digest: string; kind: "chat" | "service";
    serviceName?: string; serviceId?: string; eventPk?: string; sourceRunId?: string; goal: string; retryOf?: string; now: string }): void {
    this.db.prepare("INSERT INTO agent_requests(work_id,request_id,submission_key,request_digest,source_kind,service_name,source_service_id,source_event_pk,source_run_id,goal,state,disposition,phase,retry_of,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'pending','live','handling',?,?,?,?)")
      .run(input.workId, input.requestId, input.key, input.digest, input.kind, input.serviceName ?? null, input.serviceId ?? null, input.eventPk ?? null,
        input.sourceRunId ?? null, input.goal, input.retryOf ?? null, new Date(Date.parse(input.now) + BRAIN_LIMITS.requestTimeoutMs).toISOString(), input.now, input.now);
  }
  private transaction<T>(f: () => T): T {
    if (this.db.isTransaction) return f();
    this.db.exec("BEGIN IMMEDIATE");
    try { const r = f(); this.db.exec("COMMIT"); return r; } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const result = JSON.stringify(value); if (result === undefined) throw new Error("Value is not JSON"); return result;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    .map(([key, v]) => `${JSON.stringify(key)}:${canonicalJson(v)}`).join(",")}}`;
}
export function contentDigest(value: unknown): string { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
/** Shared by transactional completion and static snapshot validation. No code is executed. */
export function validBrainAdoption(value: Record<string, unknown>, target: BrainVerificationTarget,
  scope: { requestId: string; runId: string; contextIdentity: string; artifactDigest: string | undefined }): boolean {
  const checks = value.checks;
  try {
    return value.verificationContractVersion === 1 && value.adoptionVerified === true && value.requestId === scope.requestId && value.runId === scope.runId
      && typeof value.toolCallId === "string" && value.toolCallId.length > 0 && value.toolName === target.toolName
      && typeof scope.artifactDigest === "string" && value.artifactDigest === scope.artifactDigest && value.contextIdentity === scope.contextIdentity
      && canonicalJson(value.verificationTarget) === canonicalJson(target) && canonicalJson(value.input) === canonicalJson(target.input)
      && Check(BrainBehaviorChecksSchema, checks) && new Set(checks.map((c) => c.name)).size === checks.length
      && checks.every((c) => c.passed) && target.checkNames.every((name) => checks.some((c) => c.name === name));
  } catch { return false; }
}
export function publicText(value: string): string {
  return value.replace(/-----BEGIN [\s\S]*?-----END [^-]+-----/g, "[redacted]")
    .replace(/\b(?:Bearer\s+\S+|(?:password|token|credential|secret|authorization)\s*[:=]\s*[^\s,;]+)/gi, "[redacted]")
    .replace(/\/(?:home|run|var|tmp|etc|proc|root|mnt|opt)\/[^\s"'<>]+/g, "[private path]");
}
export function redactValue(value: unknown): unknown {
  if (typeof value === "string") return publicText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([k]) => !/(?:token|credential|secret|password|authorization|privateKey|certificate|digest|hostPath)/i.test(k))
    .map(([k, v]) => [k, redactValue(v)]));
  return value;
}
function validateExperience(entry: Omit<ExperienceEntry, "sourceRequestId">): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(entry.entryId) || !/^(?:work|service:[a-zA-Z][a-zA-Z0-9_-]{0,63})$/.test(entry.scope)
    || !entry.rule || Buffer.byteLength(entry.rule) > BRAIN_LIMITS.experienceRuleBytes || !Array.isArray(entry.evidenceIds)) {
    throw new FeedbackError("EXPERIENCE_LIMIT_EXCEEDED", "Rule must have a valid entry, scope and at most 4 KiB; it is never truncated");
  }
}
function pageLimit(value = 50): number { if (!Number.isInteger(value) || value < 1 || value > 100) throw new FeedbackError("INVALID_CURSOR", "Page limit must be 1–100"); return value; }
function encodeCursor(scope: string, position: string): string { return Buffer.from(JSON.stringify({ scope, position })).toString("base64url"); }
function decodeCursor(cursor: string | undefined, scope: string): string | null {
  if (cursor === undefined) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { scope: string; position: string };
    if (v.scope !== scope || typeof v.position !== "string" || cursor.length > 1024) throw new Error();
    const parts = v.position.split("\0");
    if (parts.length !== 2 || !Number.isFinite(Date.parse(parts[0]!)) || !parts[1] || parts[1].length > 256) throw new Error();
    return v.position;
  } catch { throw new FeedbackError("INVALID_CURSOR", "Cursor belongs to another query or is invalid"); }
}
