import { createServer, type Server } from "node:http";
import { chmodSync, rmSync } from "node:fs";
import { Check } from "typebox/value";
import { AgentWaitRefSchema, BRAIN_LIMITS, isBrainVerificationTarget, type BrainVerificationTarget, type AgentWaitRef } from "@piwork/contracts";
import { FeedbackError, redactValue, type MemoryKind, type RequestInternals, type WorkStore } from "@piwork/work-store";
import { BRAIN_TOOL_NAMES } from "./brain-resources.js";
import type { RunExecutionContext, RunExecutor } from "./runs.js";
import type { ServiceInteractionClient, ServiceRunContext } from "./service-interaction.js";

export interface BrainCandidateBridge {
  prepare(context: RunExecutionContext, goal: RequestInternals, input: { submissionKey: string; verificationGoal: string; verificationTarget: BrainVerificationTarget }): Promise<unknown>;
  status(goal: RequestInternals): Promise<unknown>;
}
type Input = Record<string, unknown>;

/** Fixed host workflow, sharing the WorkStore transaction domain with RunManager. */
export class BrainFlow {
  private current: RunExecutionContext | undefined;
  private server: Server | undefined;
  constructor(private readonly store: WorkStore, private readonly services: ServiceInteractionClient,
    private readonly allowedTools: ReadonlySet<string>, private readonly cancelRun: (runId: string) => void,
    private readonly candidates?: BrainCandidateBridge, private readonly now: () => Date = () => new Date()) {}

  wrap(executor: RunExecutor): RunExecutor {
    return { execute: async (context) => {
      if (this.current) throw new Error("Brain host already has an active Run");
      this.current = context;
      try { return await executor.execute(context); }
      finally { this.current = undefined; }
    } };
  }

  async start(path = "/tmp/piwork-brain.sock"): Promise<void> {
    rmSync(path, { force: true });
    this.server = createServer(async (request, response) => {
      try {
        const match = /^\/internal\/v1\/brain\/(brain_[a-z_]+)$/.exec(request.url ?? "");
        if (request.method !== "POST" || !match) throw new FeedbackError("BRAIN_UNAVAILABLE", "Unknown brain operation");
        let size = 0; const chunks: Buffer[] = [];
        for await (const chunk of request) { size += chunk.length; if (size > BRAIN_LIMITS.eventBytes) throw new FeedbackError("EVENT_TOO_LARGE", "Brain input exceeds 64 KiB"); chunks.push(Buffer.from(chunk)); }
        const value = await this.invoke(match[1]!, JSON.parse(Buffer.concat(chunks).toString("utf8")));
        response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(redactValue(value)));
      } catch (error) {
        response.writeHead(error instanceof FeedbackError && error.code === "EVENT_TOO_LARGE" ? 413 : 409, { "content-type": "application/json" });
        response.end(JSON.stringify({ code: error instanceof FeedbackError ? error.code : "BRAIN_UNAVAILABLE", message: error instanceof FeedbackError ? error.message : "Brain operation could not be completed" }));
      }
    });
    this.server.requestTimeout = 30_000;
    await new Promise<void>((resolve, reject) => { this.server!.once("error", reject); this.server!.listen(path, () => { chmodSync(path, 0o600); resolve(); }); });
  }
  async close(): Promise<void> {
    const server = this.server; this.server = undefined;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  async invoke(tool: string, raw: unknown): Promise<unknown> {
    const context = this.current;
    if (!context || context.signal.aborted || this.store.activeRun(context.workId)?.runId !== context.runId) throw new FeedbackError("RUN_NOT_ACTIVE", "Brain operation requires the current active Run");
    if (!BRAIN_TOOL_NAMES.includes(tool as typeof BRAIN_TOOL_NAMES[number]) || !this.allowedTools.has(`package:piwork-brain:${tool}`)) {
      throw new FeedbackError("MUTATION_NOT_ALLOWED", "Brain tool is not allowed by this Work policy");
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new FeedbackError("INVALID_BRAIN_INPUT", "Brain input must be an object");
    const input = raw as Input;
    const operation = text(input, "operation");
    let goal = this.store.feedback.requestForRun(context.workId, context.runId);
    const bind = (): RequestInternals => {
      if (!goal) {
        const request = this.store.feedback.ensureChatRequest(context.workId, context.runId, context.prompt, this.now().toISOString());
        this.store.feedback.attachRunEvidence(context.workId, context.runId, request.requestId);
        goal = this.store.feedback.internal(context.workId, request.requestId)!;
        context.emit("request", { requestId: request.requestId });
      }
      return goal;
    };
    const serviceContext = (): ServiceRunContext => ({ runId: context.runId, requestId: goal?.request.requestId ?? null,
      automatic: goal?.request.source.kind === "service", ...(goal?.request.source.serviceName ? { sourceServiceName: goal.request.source.serviceName } : {}) });
    const scope = (name: string): void => { if (goal?.request.source.kind === "service" && goal.request.source.serviceName !== name) throw new FeedbackError("MUTATION_NOT_ALLOWED", "Automatic goal is scoped to its source Service"); };

    if (tool === "brain_service") {
      const name = text(input, "serviceName"); scope(name);
      if (operation === "discover") return this.services.discover(name);
      if (operation === "query" || operation === "verify") return this.services.query(serviceContext(), name, text(input, "name"), input.input ?? {});
      if (operation === "action") { bind(); return this.services.action(serviceContext(), name, text(input, "name"), text(input, "id"), input.input ?? {}, input.expectedStateVersion == null ? null : text(input, "expectedStateVersion")); }
      if (operation === "action_get") return this.services.readAction(serviceContext(), name, text(input, "id"));
      if (operation === "job_get") return this.services.job(serviceContext(), name, text(input, "id"));
    }
    if (tool === "brain_feedback") {
      if (operation === "events") { const name = text(input, "serviceName"); scope(name); return this.store.feedback.listServiceEvents(context.workId, name, limit(input), optionalText(input, "cursor")); }
      if (operation === "request_get") return goal ? { request: goal.request, evidence: this.store.feedback.listEvidence(context.workId, goal.request.requestId, limit(input), optionalText(input, "cursor")), memoryCommit:this.store.memory.receipt(context.workId,goal.request.requestId) } : { request: null, evidence: { items: [], nextCursor: null } };
      if (operation === "wait") {
        const current = bind();
        if (!Check(AgentWaitRefSchema, input.waitRef)) throw new FeedbackError("INVALID_WAIT", "Wait reference is invalid");
        const ref = input.waitRef;
        if (!ref.serviceName || !["job", "action"].includes(ref.kind)) throw new FeedbackError("INVALID_WAIT", "Package waits are registered by the candidate tool");
        scope(ref.serviceName);
        const original = current.actionRefs.find((r) => r.serviceName === ref.serviceName && (ref.kind === "job" ? r.jobId === ref.id : r.actionId === ref.id));
        if (!original) throw new FeedbackError("INVALID_WAIT", "Only an original registered Action or Job may be awaited");
        const caps = await this.services.discover(ref.serviceName);
        if (caps.mode !== "pi-managed") throw new FeedbackError("INVALID_WAIT", "Service has no wait capability");
        const declaration = caps.capabilities.actions[original.actionName];
        if (!declaration) throw new FeedbackError("INVALID_WAIT", "Original Action capability is no longer declared");
        let deadline = Date.parse(ref.deadlineAt);
        if (ref.kind === "job") { const actual = await this.services.job(serviceContext(), ref.serviceName, ref.id);
          if (actual.result.actionId !== original.actionId) throw new FeedbackError("INVALID_WAIT", "Job belongs to another Action"); deadline = Math.min(deadline, Date.parse(actual.result.deadlineAt)); }
        else await this.services.readAction(serviceContext(), ref.serviceName, ref.id);
        const wait: AgentWaitRef = { ...ref, nextPhase: "verifying", deadlineAt: new Date(Math.min(deadline, this.now().getTime() + (declaration.maxWaitMs ?? BRAIN_LIMITS.requestTimeoutMs))).toISOString() };
        return this.store.feedback.wait(context.workId, current.request.requestId, wait, this.now().toISOString());
      }
      if (operation === "finish") return this.finish(context, bind(), input);
      if (operation === "cancel") {
        if (!goal) throw new FeedbackError("REQUEST_NOT_FOUND", "This Run has no associated request");
        const request = this.store.feedback.cancel(context.workId, goal.request.requestId, undefined, this.now().toISOString());
        if (request.state === "cancelling") this.cancelRun(context.runId);
        return request;
      }
    }
    if (tool === "brain_experience") {
      if (operation === "list" || operation === "status") return { adoptedExperienceVersion: context.adoptedExperienceVersion ?? 0,
        snapshot: (()=>{const snapshot=this.store.feedback.experienceSnapshot(context.workId, context.adoptedExperienceVersion ?? 0);
          return goal?.request.source.kind==="service"?{...snapshot,entries:snapshot.entries.filter(entry=>entry.scope==="work"||entry.scope===`service:${goal!.request.source.serviceName}`)}:snapshot;})(),
        effectiveVersion: this.store.feedback.experienceSnapshot(context.workId).version,
        selection:context.adoptedMemorySelection??this.store.getRun(context.runId)?.adoptedMemorySelection,
        ...(goal?{memoryCommit:this.store.memory.receipt(context.workId,goal.request.requestId)}:{}) };
      if (operation === "recall") {
        const source = goal?.request.source;
        const name=optionalText(input,"serviceName")??(source?.kind==="service"?source.serviceName:undefined);
        if(name)scope(name);
        const recallLimit=input.limit===undefined?10:input.limit;
        if(typeof recallLimit!=="number")throw new FeedbackError("EXPERIENCE_INVALID","Memory recall limit must be an integer");
        return this.store.memory.recall(context.workId,context.adoptedExperienceVersion??0,text(input,"query"),name,recallLimit);
      }
      if (operation === "read") {
        const id=text(input,"entryId"),version=context.adoptedExperienceVersion??0;
        const result=this.store.memory.read(context.workId,version,id);
        const entryScope=result.entry?.scope??result.scope;
        if(entryScope?.startsWith("service:"))scope(entryScope.slice(8));
        return result;
      }
      if (operation === "stage" || operation === "revise" || operation === "invalidate") {
        const current = bind();
        const version=input.expectedVersion===undefined && operation==="stage"?context.adoptedExperienceVersion??0:input.expectedVersion;
        if(typeof version!=="number"||!Number.isSafeInteger(version)||version<0)throw new FeedbackError("EXPERIENCE_INVALID","Provide the expected Memory version");
        const original=operation==="invalidate"?this.store.memory.read(context.workId,version,text(input,"entryId")).entry:undefined;
        const entry = (operation==="invalidate"&&original?{...original,evidenceIds:input.evidenceIds}:input.entry) as { entryId?: unknown; scope?: unknown; rule?: unknown; evidenceIds?: unknown; kind?: unknown } | undefined;
        if (!entry || typeof entry.entryId !== "string" || typeof entry.scope !== "string" || typeof entry.rule !== "string" || !Array.isArray(entry.evidenceIds) || entry.evidenceIds.some((v) => typeof v !== "string")) throw new FeedbackError("EXPERIENCE_INVALID", "Experience entry is invalid");
        if(entry.scope.startsWith("service:"))scope(entry.scope.slice(8));
        if(operation==="revise"&&!this.store.memory.read(context.workId,version,entry.entryId).entry)throw new FeedbackError("EXPERIENCE_INVALID","Revision requires an existing entry");
        const evidenceIds = [...entry.evidenceIds] as string[];
        if (input.userPreference === true) {
          if (current.request.source.kind !== "chat" || current.sourceRunId !== context.runId) throw new FeedbackError("VERIFICATION_REQUIRED", "A user preference must cite its original accepted Chat instruction");
          const proof = this.store.feedback.addEvidence(context.workId, { requestId: current.request.requestId, runId: context.runId, kind: "sdk",
            objectRef: context.runId, observedAt: this.now().toISOString(), summary: `Original user instruction: ${context.prompt}`, verified: true },
          { userPreferenceVerified: true, promptDigest: this.store.getRun(context.runId)!.promptDigest }, true);
          evidenceIds.push(proof.evidenceId);
        }
        return { version: this.store.feedback.stageExperience(context.workId, current.request.requestId,
          { entryId: entry.entryId, scope: entry.scope, rule: entry.rule, evidenceIds, expectedVersion:version,
            ...(entry.kind!==undefined?{kind:entry.kind as MemoryKind}:{}),
            ...(operation==="invalidate"?{operation:"invalidate" as const,reason:text(input,"reason")}:{}),
          }, input.userPreference === true, this.now().toISOString()), status: "staged", evidenceIds };
      }
      if (operation === "commit") return this.finish(context, bind(), { ...input, state: "completed" });
    }
    if (tool === "brain_package_update") {
      if (!this.candidates) throw new FeedbackError("BRAIN_CANDIDATE_UNAVAILABLE", "Brain candidate preparation is unavailable");
      if (operation === "prepare") {
        if (!isBrainVerificationTarget(input.verificationTarget)) throw new FeedbackError("INVALID_BRAIN_INPUT", "Provide one brain tool, bounded input and unique required check names");
        return this.candidates.prepare(context, bind(), { submissionKey: text(input, "submissionKey"), verificationGoal: text(input, "verificationGoal"), verificationTarget: input.verificationTarget });
      }
      if (operation === "status") { if (!goal) return { candidate: null }; return this.candidates.status(goal); }
    }
    throw new FeedbackError("INVALID_BRAIN_INPUT", "Unknown brain operation");
  }

  private finish(context: RunExecutionContext, goal: RequestInternals, input: Input): unknown {
    const state = input.state;
    if (!["completed", "failed", "needs_attention"].includes(String(state))) throw new FeedbackError("INVALID_BRAIN_INPUT", "Finish requires a terminal outcome");
    const proof = input.evidenceIds ?? [];
    if (!Array.isArray(proof) || proof.some((v) => typeof v !== "string")) throw new FeedbackError("INVALID_BRAIN_INPUT", "Evidence identities are invalid");
    const result = optionalText(input, "result") ?? null;
    if (result && Buffer.byteLength(result) > 32768) throw new FeedbackError("INVALID_BRAIN_INPUT", "Result exceeds limit");
    this.store.feedback.finish(context.workId, goal.request.requestId, state as "completed" | "failed" | "needs_attention", result,
      state === "completed" ? null : { code: state === "failed" ? "GOAL_FAILED" : "VERIFICATION_REQUIRED", message: result ?? "Goal could not be verified" }, proof, this.now().toISOString());
    const request=this.store.feedback.getRequest(context.workId, goal.request.requestId);
    const memoryCommit=this.store.memory.receipt(context.workId,goal.request.requestId);
    return {...request,...(memoryCommit?{memoryCommit,summary:`Memory effective version ${memoryCommit.version}; this Run retains version ${context.adoptedExperienceVersion??0}`}:{})};
  }
}

function text(input: Input, name: string): string {
  const value = input[name]; if (typeof value !== "string" || !value || Buffer.byteLength(value) > BRAIN_LIMITS.goalBytes) throw new FeedbackError("INVALID_BRAIN_INPUT", `Missing or invalid ${name}`); return value;
}
function optionalText(input: Input, name: string): string | undefined { return input[name] === undefined ? undefined : text(input, name); }
function limit(input: Input): number | undefined { if (input.limit === undefined) return undefined; if (!Number.isInteger(input.limit) || Number(input.limit) < 1 || Number(input.limit) > 100) throw new FeedbackError("INVALID_CURSOR", "Invalid page limit"); return Number(input.limit); }
