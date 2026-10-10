import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { Check } from "typebox/value";
import { AgentRunSourceSchema, AgentWaitRefSchema, BrainCandidateSubmissionSchema, isBrainVerificationTarget, BRAIN_LIMITS,
  RunModelDescriptionSchema, RunSubmissionSelectorSchema, ThinkingSettingSchema, ServiceEventSchema, ModelApiSchema, ModelCapabilitiesSchema, ResourceIdSchema } from "@piwork/contracts";
import { canonicalJson, contentDigest, FeedbackStore, validBrainAdoption } from "./feedback.js";
import { MemoryStore } from "./memory.js";
import { validateMemoryHistory } from "./snapshot-memory.js";

type Row = Record<string, SQLInputValue>;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && !v.includes("\0");
function json(value: SQLInputValue | undefined): unknown { if (typeof value !== "string") throw new Error("Invalid JSON field"); return JSON.parse(value); }
const optional = (value: SQLInputValue | undefined, check: (v: unknown) => boolean): void => {
  if (value !== null && value !== undefined && !check(json(value))) throw new Error("Invalid structured history field");
};
function model(value: unknown): boolean {
  if (!object(value)) return false;
  const { baseUrl, availability, thinkingLevel, api,capabilities,executionBindingId,...description } = value;
  if (!Check(RunModelDescriptionSchema, description)) return false;
  if(api!==undefined&&(!Check(ModelApiSchema,api)||api==='openai-responses'&&description.provider!=='openai'||api==='anthropic-messages'&&description.provider!=='anthropic'))return false;
  if(capabilities!==undefined&&!Check(ModelCapabilitiesSchema,capabilities))return false;
  if(executionBindingId!==undefined&&!Check(ResourceIdSchema,executionBindingId))return false;
  if (thinkingLevel !== undefined && !Check(ThinkingSettingSchema, thinkingLevel)) return false;
  if (availability !== undefined && !["available", "unavailable"].includes(String(availability))) return false;
  if (baseUrl !== undefined) {
    if (typeof baseUrl !== "string") return false;
    const endpoint = new URL(baseUrl);
    if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return false;
  }
  return true;
}

/** Validate platform relationships on a read-only scratch DB. Never interpret user databases or execute source SQL. */
export function validateBrainHistory(database: DatabaseSync, workId: string, contextIds: ReadonlySet<string>): void {
  const current = database.prepare("SELECT version FROM schema_migrations").get()?.version === 5;
  const feedback = new FeedbackStore(database, current ? new MemoryStore(database) : undefined);
  const candidateFor = (id: string): Record<string, unknown> | null => {
    const row = database.prepare("SELECT package_submission_json FROM agent_requests WHERE request_id=? AND work_id=?").get(id, workId);
    return row?.package_submission_json == null ? null : json(row.package_submission_json) as Record<string, unknown>;
  };
  const adoptionFor = (proof: Row): boolean => {
    if (proof.kind !== "sdk" || proof.verified !== 1 || !text(proof.request_id) || !text(proof.run_id) || !text(proof.code_version)) return false;
    const candidate = candidateFor(proof.request_id), details = json(proof.details_json);
    const run = database.prepare("SELECT context_identity FROM runs WHERE run_id=? AND work_id=?").get(proof.run_id, workId);
    if (!candidate || !isBrainVerificationTarget(candidate.verificationTarget) || !object(details) || !run
      || proof.object_ref !== candidate.verificationTarget.toolName || !contextIds.has(String(run.context_identity))) return false;
    const call = database.prepare("SELECT event_type,payload_json FROM run_events WHERE run_id=? AND event_type IN('tool-start','tool-end') AND json_extract(payload_json,'$.toolCallId')=? ORDER BY sequence")
      .all(proof.run_id, typeof details.toolCallId === "string" ? details.toolCallId : "");
    const target = candidate.verificationTarget;
    const native = target.toolName.split(":").at(-1);
    const events=call.map(event=>({type:event.event_type,value:json(event.payload_json) as Record<string,unknown>}));
    const announcements=events.filter(e=>e.type==='tool-start'&&!Object.hasOwn(e.value,'args'));
    const executions=events.filter(e=>e.type==='tool-start'&&Object.hasOwn(e.value,'args'));
    const endings=events.filter(e=>e.type==='tool-end');
    if(events.some(e=>e.value.toolName!==native)||announcements.length>1||executions.length!==1||endings.length!==1
      ||canonicalJson(executions[0]!.value.args)!==canonicalJson(target.input)||endings[0]!.value.isError!==false
      ||events.indexOf(executions[0]!)>=events.indexOf(endings[0]!)
      ||announcements.length===1&&events.indexOf(announcements[0]!)>=events.indexOf(executions[0]!))return false;

    const receiptRows = database.prepare("SELECT details_json FROM agent_evidence WHERE request_id=? AND kind='package'").all(proof.request_id);
    const receipts = receiptRows.map((row) => row.details_json == null ? {} : json(row.details_json) as Record<string, unknown>)
      .filter((receipt) => receipt.candidateArtifactDigest !== undefined);
    if (!receipts.length || receipts.some((receipt) => receipt.requestId !== proof.request_id || receipt.sourceDigest !== candidate.expectedSourceDigest
      || !/^sha256:[a-f0-9]{64}$/.test(String(receipt.candidateArtifactDigest)) || receipt.candidateArtifactDigest !== receipts[0]!.candidateArtifactDigest)) return false;
    return validBrainAdoption(details, candidate.verificationTarget, { requestId: proof.request_id, runId: proof.run_id,
      contextIdentity: String(run.context_identity), artifactDigest: String(receipts[0]!.candidateArtifactDigest) });
  };
  for (const r of database.prepare("SELECT * FROM sessions").iterate() as Iterable<Row>) {
    optional(r.model_preference_json, model);
    optional(r.source_json, (v) => Check(AgentRunSourceSchema, v));
  }
  for (const r of database.prepare("SELECT * FROM runs").iterate() as Iterable<Row>) {
    optional(r.model_selector_json, (v) => Check(RunSubmissionSelectorSchema, v));
    optional(r.actual_model_json, model);
    optional(r.source_json, (v) => Check(AgentRunSourceSchema, v));
    const version = Number(r.adopted_experience_version);
    if (!Number.isSafeInteger(version) || version < 0) throw new Error("Invalid adopted experience");
    feedback.experienceSnapshot(workId, version);
  }
  for (const r of database.prepare("SELECT * FROM service_events").iterate() as Iterable<Row>) {
    const event = json(r.event_json);
    if (!Check(ServiceEventSchema, event) || Buffer.byteLength(String(r.event_json)) > BRAIN_LIMITS.eventBytes
      || event.eventId !== r.event_id || event.origin.serviceId !== r.source_service_id
      || (r.disposition === "live" && event.origin.workId !== workId)
      || contentDigest(event) !== r.event_digest) throw new Error("Invalid event identity");
    if (r.request_id !== null) {
      const req = database.prepare("SELECT * FROM agent_requests WHERE request_id=?").get(r.request_id!) as Row | undefined;
      if (!req || req.work_id !== workId || req.source_event_pk !== r.event_pk || req.source_service_id !== r.source_service_id
        || event.type !== "agent.requested" || req.goal !== event.payload.goal) throw new Error("Invalid event request relationship");
    }
  }
  for (const r of database.prepare("SELECT * FROM agent_request_runs").iterate() as Iterable<Row>) {
    const run = database.prepare("SELECT * FROM runs WHERE run_id=?").get(r.run_id!) as Row | undefined;
    const req = feedback.getRequest(workId, String(r.request_id));
    if (!run || run.work_id !== workId || !req || (req.disposition === "historical" && r.disposition !== "historical")) throw new Error("Invalid request Run relationship");
    if (run.source_json !== null) {
      const source = json(run.source_json);
      if (!object(source) || source.requestId !== req.requestId || source.phase !== r.phase || source.kind !== req.source.kind) throw new Error("Invalid Run source");
    }
  }
  for (const r of database.prepare("SELECT * FROM agent_evidence").iterate() as Iterable<Row>) {
    if (!text(r.evidence_id) || !text(r.object_ref) || typeof r.summary !== "string"
      || !Number.isFinite(Date.parse(String(r.observed_at))) || (r.kind === "event" && r.verified !== 0)) throw new Error("Invalid evidence");
    optional(r.details_json, object);
    const detail = r.details_json == null ? {} : json(r.details_json) as Record<string, unknown>;
    if (detail.verificationContractVersion !== undefined && !adoptionFor(r)) throw new Error("Invalid fixed SDK adoption relationship");
    if (detail.adoptionVerified === true && !adoptionFor(r)) throw new Error("Missing fixed SDK adoption relationship");
    if (detail.candidateArtifactDigest !== undefined) {
      const candidate = candidateFor(String(r.request_id));
      if (r.kind !== "package" || !candidate || detail.requestId !== r.request_id || detail.sourceDigest !== candidate.expectedSourceDigest
        || !/^sha256:[a-f0-9]{64}$/.test(String(detail.candidateArtifactDigest))) throw new Error("Invalid candidate artifact receipt");
    }
    if (r.request_id !== null && !feedback.getRequest(workId, String(r.request_id))) throw new Error("Invalid evidence request");
    if (r.run_id !== null) {
      const run = database.prepare("SELECT work_id FROM runs WHERE run_id=?").get(r.run_id!);
      const link = database.prepare("SELECT request_id FROM agent_request_runs WHERE run_id=?").get(r.run_id!);
      if (run?.work_id !== workId || (r.request_id !== null && link?.request_id !== r.request_id)) throw new Error("Invalid evidence Run");
    }
  }
  for (const r of database.prepare("SELECT * FROM agent_requests").iterate() as Iterable<Row>) {
    if (!text(r.request_id) || !text(r.submission_key) || !text(r.request_digest) || !text(r.goal)
      || Buffer.byteLength(r.goal) > BRAIN_LIMITS.goalBytes || !Number.isFinite(Date.parse(String(r.expires_at)))) throw new Error("Invalid request");
    optional(r.wait_ref_json, (v) => Check(AgentWaitRefSchema, v));
    optional(r.package_submission_json, (v) => object(v) && Check(BrainCandidateSubmissionSchema, v) && isBrainVerificationTarget(v.verificationTarget));
    const current = feedback.internal(workId, String(r.request_id))!;
    const candidate = r.package_submission_json == null ? null : json(r.package_submission_json) as Record<string, unknown>;
    if (candidate) {
      if (!contextIds.has(String(candidate.activeContextId))) throw new Error("Invalid candidate context");
      let owner = r, seen = new Set<string>();
      while (candidate.requestId !== owner.request_id) {
        if (!text(owner.retry_of) || seen.has(String(owner.request_id))) throw new Error("Invalid original candidate request scope");
        seen.add(String(owner.request_id));
        const prior = database.prepare("SELECT * FROM agent_requests WHERE request_id=? AND work_id=?").get(owner.retry_of, workId) as Row | undefined;
        if (!prior || canonicalJson(candidateFor(String(prior.request_id))) !== canonicalJson(candidate)) throw new Error("Invalid retry candidate relationship");
        owner = prior;
      }
    }
    if (r.source_kind === "service" && (!text(r.service_name) || !text(r.source_service_id))) throw new Error("Missing source Service");
    if (r.source_event_pk !== null && database.prepare("SELECT request_id FROM service_events WHERE event_pk=?").get(r.source_event_pk!)?.request_id !== r.request_id) throw new Error("Invalid source event relationship");
    if (r.source_run_id !== null && database.prepare("SELECT work_id FROM runs WHERE run_id=?").get(r.source_run_id!)?.work_id !== workId) throw new Error("Invalid source Run");
    if (r.retry_of !== null) {
      const prior = feedback.getRequest(workId, String(r.retry_of));
      if (!prior || prior.requestId === r.request_id || prior.goal !== r.goal || prior.source.kind !== r.source_kind) throw new Error("Invalid retry relationship");
    }
    const refs = json(r.action_refs_json);
    if (!Array.isArray(refs) || refs.length > 100 || new Set(refs.map((ref) => object(ref) ? `${ref.serviceName}:${ref.actionId}` : "")).size !== refs.length
      || refs.some((ref) => !object(ref) || !text(ref.serviceName) || !text(ref.actionId) || !text(ref.actionName)
        || !text(ref.verificationQuery) || !["calling", "known", "unknown"].includes(String(ref.status))
        || (ref.expectedStateVersion !== null && !text(ref.expectedStateVersion)) || (ref.jobId !== undefined && !text(ref.jobId)))) throw new Error("Invalid original Action references");
    if (["waiting_result", "waiting_apply"].includes(String(r.state)) && !current.request.waitRef) throw new Error("Missing wait reference");
    if (r.state === "waiting_apply" && current.request.waitRef?.kind !== "apply") throw new Error("Invalid Apply wait");
    if (r.state === "completed") {
      const rows = database.prepare("SELECT * FROM agent_evidence WHERE request_id=? AND verified=1").all(r.request_id!) as Row[];
      const details = (proof: Row) => proof.details_json === null ? {} : json(proof.details_json) as Record<string, unknown>;
      const query = (proof: Row) => proof.kind === "query" && Array.isArray(details(proof).checks)
        && (details(proof).checks as unknown[]).length > 0 && (details(proof).checks as unknown[]).every((c) => object(c) && c.passed === true);
      const latestRun = database.prepare("SELECT run_id FROM agent_request_runs WHERE request_id=? ORDER BY rowid DESC LIMIT 1").get(r.request_id!);
      const adoption = rows.some((proof) => proof.run_id === latestRun?.run_id && adoptionFor(proof));
      const preference = r.source_kind === "chat" && rows.some((proof) => proof.kind === "sdk" && proof.run_id === r.source_run_id
        && details(proof).userPreferenceVerified === true && database.prepare("SELECT prompt_digest FROM runs WHERE run_id=?").get(proof.run_id!)?.prompt_digest === details(proof).promptDigest);
      if (!rows.some(query) && !adoption && !preference) throw new Error("Completion without actual verification");
      if (r.package_submission_json !== null && !adoption) throw new Error("Missing SDK adoption proof");
      for (const ref of current.actionRefs) {
        if (ref.status !== "known" || !rows.some((proof) => proof.service_name === ref.serviceName
          && ((proof.kind === "action" && proof.object_ref === ref.actionId) || (proof.kind === "job" && proof.object_ref === ref.jobId))
          && ["succeeded", "failed", "cancelled"].includes(String(details(proof).state)))
          || !rows.some((proof) => proof.service_name === ref.serviceName && proof.object_ref === ref.verificationQuery && query(proof))) throw new Error("Completion without original Action verification");
      }
    }
  }
  if (current) { validateMemoryHistory(database, workId); return; }
  for (const r of database.prepare("SELECT * FROM brain_experience_revisions").iterate() as Iterable<Row>) {
    const req = feedback.getRequest(workId, String(r.source_request_id)), refs = json(r.evidence_ids_json);
    if (!req || !text(r.entry_id) || !text(r.scope) || !text(r.rule) || Buffer.byteLength(r.rule) > BRAIN_LIMITS.experienceRuleBytes
      || !Array.isArray(refs) || refs.length > 100 || refs.some((id) => !text(id))) throw new Error("Invalid experience");
    if (r.status === "effective" && req.state !== "completed") throw new Error("Unconfirmed experience");
    if (!refs.length && req.source.kind !== "chat") throw new Error("Experience without evidence");
    for (const id of refs) {
      const proof = feedback.getEvidence(workId, String(id));
      if (!proof || proof.requestId !== req.requestId || proof.kind === "event" || (r.status === "effective" && !proof.verified)) throw new Error("Invalid experience evidence");
    }
  }
  for (const r of database.prepare("SELECT * FROM brain_experience_heads").iterate() as Iterable<Row>) feedback.experienceSnapshot(workId, Number(r.version));
}
