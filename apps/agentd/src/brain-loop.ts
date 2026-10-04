import { BRAIN_LIMITS, isBrainVerificationTarget, type AgentWaitRef, type ServiceEvent } from "@piwork/contracts";
import { FeedbackError, WorkBusyError, type RequestInternals, type WorkStore } from "@piwork/work-store";
import { BRAIN_TOOL_NAMES } from "./brain-resources.js";
import type { AgentDaemonControl } from "./daemon.js";
import type { RunManager } from "./runs.js";
import type { AgentSessionService } from "./sessions.js";
import type { ServiceBindingRegistry, ServiceInteractionClient, ServiceRunContext } from "./service-interaction.js";

export interface CandidateProgress {
  readonly state: "waiting" | "waiting_apply" | "ready" | "failed" | "replaced";
  readonly id: string; readonly message?: string;
}
export interface CandidatePoller { poll(goal: RequestInternals): Promise<CandidateProgress> }

/** One resident loop, one five-second tick, the existing atomic Run slot. */
export class BrainLoop {
  private timer: NodeJS.Timeout | undefined;
  private yieldTimer: NodeJS.Timeout | undefined;
  private unsubscribe: (() => void) | undefined;
  private pendingTick: Promise<void> | undefined;
  private lastRelease: number;
  private readonly polledAt = new Map<string, number>();
  private stopped = true;
  constructor(private readonly workId: string, private readonly store: WorkStore, private readonly daemon: AgentDaemonControl,
    private readonly runs: RunManager, private readonly sessions: AgentSessionService,
    private readonly bindings: ServiceBindingRegistry, private readonly services: ServiceInteractionClient,
    private readonly candidates?: CandidatePoller, private readonly now: () => Date = () => new Date()) {
    this.lastRelease = now().getTime();
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.unsubscribe = this.runs.onSettled(() => { this.lastRelease = this.now().getTime(); this.scheduleYield(); });
    this.timer = setInterval(() => this.wake(), BRAIN_LIMITS.pollMs); this.timer.unref();
    this.scheduleYield();
  }
  wake(): void {
    if (this.stopped || this.pendingTick) return;
    this.pendingTick = this.tick().catch(() => { /* No false receipt or successful progress on observation failure. */ }).finally(() => { this.pendingTick = undefined; });
  }
  notify(event?: ServiceEvent): void {
    if (!event || event.type === "agent.requested") { this.wake(); return; }
    let matched = false;
    for (const goal of this.store.feedback.waiting(this.workId)) {
      const wait = goal.request.waitRef;
      if (wait?.serviceName === event.serviceName && (!event.causationRequestId || event.causationRequestId === goal.request.requestId)
        && ((wait.kind === "job" && wait.id === event.jobId) || (wait.kind === "action" && wait.id === event.actionId))) {
        matched = true;
      }
    }
    if (matched) this.wake();
  }
  async close(): Promise<void> {
    this.stopped = true; if (this.timer) clearInterval(this.timer); if (this.yieldTimer) clearTimeout(this.yieldTimer);
    this.unsubscribe?.(); await this.pendingTick;
  }
  private scheduleYield(): void {
    if (this.stopped) return; if (this.yieldTimer) clearTimeout(this.yieldTimer);
    this.yieldTimer = setTimeout(() => this.wake(), Math.max(1, this.lastRelease + BRAIN_LIMITS.interactiveYieldMs - this.now().getTime())); this.yieldTimer.unref();
  }

  async tick(): Promise<void> {
    if (this.stopped || !this.daemon.readiness().acceptingRuns) return;
    let authorityAvailable = true;
    try { await this.bindings.refresh(); } catch { authorityAvailable = false; if (!this.bindings.hasAuthority) return; }
    if (this.stopped || !this.daemon.readiness().acceptingRuns) return;
    const now = this.now().toISOString();
    this.store.feedback.expire(this.workId, now);
    const ready = this.daemon.readiness();
    if (!BRAIN_TOOL_NAMES.every((name) => ready.resolvedTools.includes(`package:piwork-brain:${name}`))) {
      for (const goal of this.store.feedback.unfinished(this.workId)) if (!["running", "cancelling"].includes(goal.request.state)) this.fail(goal, "BRAIN_UNAVAILABLE", "Enabled brain and its four required tools are unavailable");
      return;
    }
    for (const goal of this.store.feedback.unfinished(this.workId)) {
      if (goal.packageSubmission && !["running", "cancelling"].includes(goal.request.state)
        && !isBrainVerificationTarget((goal.packageSubmission as { verificationTarget?: unknown }).verificationTarget)) {
        this.fail(goal, "VERIFICATION_REQUIRED", "Original candidate has no valid fixed behavior target; create a new explicit goal and submission key");
      }
    }
    const waiting = this.store.feedback.waiting(this.workId);
    const waitingIds = new Set([...waiting, ...this.store.feedback.pending(this.workId).filter((goal) => this.store.feedback.needsRecovery(this.workId, goal.request.requestId))].map((goal) => goal.request.requestId));
    for (const id of this.polledAt.keys()) if (!waitingIds.has(id)) this.polledAt.delete(id);
    for (const goal of waiting) {
      if (this.stopped || !this.daemon.readiness().acceptingRuns) return;
      const wait = goal.request.waitRef!;
      if (wait.deadlineAt <= now) { this.fail(goal, "REQUEST_EXPIRED", "Registered wait deadline passed"); continue; }
      // Events wake this loop but share the same query bound as periodic ticks.
      if (this.now().getTime() < (this.polledAt.get(goal.request.requestId) ?? 0) + BRAIN_LIMITS.pollMs) continue;
      this.polledAt.set(goal.request.requestId, this.now().getTime());
      try {
        await this.assertSource(goal);
        if (wait.kind === "job" || wait.kind === "action") {
          if (!wait.serviceName || !goal.actionRefs.some((r) => r.serviceName === wait.serviceName && (wait.kind === "job" ? r.jobId === wait.id : r.actionId === wait.id))) throw new FeedbackError("INVALID_WAIT", "Original wait reference is missing");
          const actual = wait.kind === "job" ? await this.services.job(this.context(goal), wait.serviceName, wait.id) : await this.services.readAction(this.context(goal), wait.serviceName, wait.id);
          if (wait.kind === "job" && "actionId" in actual.result && !goal.actionRefs.some((r) => r.serviceName === wait.serviceName && r.jobId === wait.id && r.actionId === actual.result.actionId)) throw new FeedbackError("INVALID_WAIT", "Original Job belongs to another Action");
          if (!this.observing(goal, wait)) continue;
          if (["succeeded", "failed", "cancelled"].includes(actual.result.state)) this.store.feedback.resume(this.workId, goal.request.requestId, wait.id, this.now().toISOString());
        } else {
          if (!this.candidates) throw new FeedbackError("BRAIN_CANDIDATE_UNAVAILABLE", "Candidate observation is unavailable");
          const state = await this.candidates.poll(goal);
          if (!this.observing(goal)) continue;
          if (state.state === "ready") this.store.feedback.resume(this.workId, goal.request.requestId, wait.id, this.now().toISOString());
          else if (state.state === "failed" || state.state === "replaced") this.fail(goal, "PI_PACKAGE_CANDIDATE_CONFLICT", state.message ?? "Candidate failed or was replaced");
        }
      } catch (error) {
        if (this.stopped || !this.daemon.readiness().acceptingRuns) return;
        if (error instanceof FeedbackError && error.code === "BINDINGS_UNAVAILABLE") continue;
        this.fail(goal, error instanceof FeedbackError ? error.code : "SERVICE_UNAVAILABLE", "The original wait result cannot be proved; inspect it before retry");
      }
    }
    const recovered = new Set<string>();
    for (const goal of this.store.feedback.pending(this.workId)) {
      if (!this.store.feedback.needsRecovery(this.workId, goal.request.requestId)) continue;
      if (!this.observing(goal)) continue;
      if (this.now().getTime() < (this.polledAt.get(goal.request.requestId) ?? 0) + BRAIN_LIMITS.pollMs) continue;
      this.polledAt.set(goal.request.requestId, this.now().getTime());
      try {
        await this.assertSource(goal);
        if (await this.reconcileInterrupted(goal)) recovered.add(goal.request.requestId);
      } catch (error) {
        if (!this.observing(goal)) continue;
        if (error instanceof FeedbackError && error.code === "BINDINGS_UNAVAILABLE") continue;
        this.fail(goal, error instanceof FeedbackError ? error.code : "ACTION_RESULT_UNKNOWN", "Original effects cannot be proved; inspect the original objects before retry");
      }
    }
    if (!authorityAvailable || this.store.activeRun(this.workId)) return;
    if (this.now().getTime() < this.lastRelease + BRAIN_LIMITS.interactiveYieldMs) { this.scheduleYield(); return; }
    requests: for (let goal of this.store.feedback.pending(this.workId)) {
      if (this.stopped || !this.daemon.readiness().acceptingRuns) return;
      if (this.store.feedback.needsRecovery(this.workId, goal.request.requestId) && !recovered.has(goal.request.requestId)) continue;
      if (goal.request.autoRunCount >= BRAIN_LIMITS.autoRuns) { this.fail(goal, "REQUEST_BUDGET_EXCEEDED", "Automatic Run budget exhausted"); continue; }
      try {
        await this.assertSource(goal);
        if (!this.observing(goal)) continue;
        if (goal.packageSubmission && goal.phase !== "handling") {
          if (!this.candidates) throw new FeedbackError("BRAIN_CANDIDATE_UNAVAILABLE", "Candidate observation is unavailable");
          const progress = await this.candidates.poll(goal);
          if (!this.observing(goal)) continue;
          if (progress.state === "failed" || progress.state === "replaced") { this.fail(goal, "PI_PACKAGE_CANDIDATE_CONFLICT", progress.message ?? "Candidate cannot be adopted"); continue; }
          if (progress.state !== "ready") continue;
          const target = (goal.packageSubmission as { verificationTarget: { toolName: string } }).verificationTarget;
          if (!this.daemon.readiness().resolvedTools.includes(target.toolName)) throw new FeedbackError("VERIFICATION_REQUIRED", "Candidate verification tool is missing or denied by current policy");
        }
        if (goal.request.retryOf && goal.phase === "verifying" && !goal.packageSubmission) {
          let terminal = true; let needsHandling = goal.actionRefs.length === 0;
          for (const ref of goal.actionRefs) {
            const action = await this.services.readAction(this.context(goal), ref.serviceName, ref.actionId);
            if (!this.observing(goal)) continue requests;
            const jobId = action.result.jobId ?? ref.jobId;
            if (ref.jobId && jobId !== ref.jobId) throw new FeedbackError("INVALID_WAIT", "Original Action changed its Job identity");
            const result = jobId ? (await this.services.job(this.context(goal), ref.serviceName, jobId)).result : action.result;
            if (!this.observing(goal)) continue requests;
            if ("actionId" in result && result.actionId !== ref.actionId) throw new FeedbackError("INVALID_WAIT", "Original Job belongs to another Action");
            terminal &&= ["succeeded", "failed", "cancelled"].includes(result.state);
            if (!terminal) {
              const discovered = await this.services.discover(ref.serviceName);
              if (!this.observing(goal)) continue requests;
              const declared = discovered.mode === "pi-managed" ? discovered.capabilities.actions[ref.actionName] : undefined;
              if (!declared) throw new FeedbackError("INVALID_WAIT", "Original Action wait capability is unavailable");
              this.store.feedback.waitForOriginalRetry(this.workId, goal.request.requestId, { kind: jobId ? "job" : "action", serviceName: ref.serviceName,
                id: jobId ?? ref.actionId, deadlineAt: new Date(Math.min(this.now().getTime() + declared.maxWaitMs,
                  "deadlineAt" in result ? Date.parse(result.deadlineAt) : Infinity)).toISOString(), nextPhase: "verifying", verificationGoal: goal.request.goal }, this.now().toISOString());
              break;
            }
            const query = await this.services.query(this.context(goal), ref.serviceName, ref.verificationQuery, {});
            if (!this.observing(goal)) continue requests;
            needsHandling ||= result.state !== "succeeded" || !query.evidence.verified;
          }
          if (!terminal) continue;
          if (terminal && needsHandling) this.store.feedback.authorizeRetryHandling(this.workId, goal.request.requestId);
          goal = this.store.feedback.internal(this.workId, goal.request.requestId)!;
        }
        const contextIdentity = this.daemon.readiness().contextIdentity;
        // Automatic continuation always owns an SDK session separate from
        // the user's transcript. Goal origin remains chat/service independently.
        const session = this.sessions.create(`brain-auto:${contextIdentity}`, JSON.stringify({ kind: "service" }));
        if (this.stopped || !this.daemon.readiness().acceptingRuns) return;
        await this.runs.submitAutomatic({ workId: this.workId, sessionId: session.sessionId,
          submissionKey: `brain:${goal.request.requestId}:${goal.request.autoRunCount + 1}:${goal.phase}`,
          prompt: this.prompt(goal), requestId: goal.request.requestId, phase: goal.phase });
        return;
      } catch (error) {
        if (!this.observing(goal)) continue;
        if (error instanceof WorkBusyError || this.store.activeRun(this.workId)) return;
        if (error instanceof FeedbackError && error.code === "BINDINGS_UNAVAILABLE") continue;
        this.fail(goal, error instanceof FeedbackError ? error.code : "MODEL_UNAVAILABLE", "Request cannot be safely admitted; inspect the original result or configuration");
      }
    }
  }

  private observing(goal: RequestInternals, expectedWait?: AgentWaitRef): boolean {
    if (this.stopped || !this.daemon.readiness().acceptingRuns) return false;
    const now = this.now().toISOString();
    this.store.feedback.expire(this.workId, now);
    const current = this.store.feedback.internal(this.workId, goal.request.requestId)?.request;
    if (!current || current.disposition !== "live" || !["pending", "waiting_result", "waiting_apply"].includes(current.state)) return false;
    const waiting = ["waiting_result", "waiting_apply"].includes(current.state);
    if (expectedWait && (!waiting || current.waitRef?.kind !== expectedWait.kind || current.waitRef.serviceName !== expectedWait.serviceName || current.waitRef.id !== expectedWait.id)) return false;
    // Only the current wait has a deadline. A timely resume retains its ref as
    // history while pending/verifying; it must not expire that later phase.
    if (waiting && current.waitRef && current.waitRef.deadlineAt <= now) {
      this.fail(goal, "REQUEST_EXPIRED", "Registered wait deadline passed"); return false;
    }
    return true;
  }

  private async reconcileInterrupted(goal: RequestInternals): Promise<boolean> {
    if (!goal.actionRefs.length && !goal.packageSubmission) throw new FeedbackError("ACTION_RESULT_UNKNOWN", "Interrupted goal has no registered original effect");
    for (const ref of goal.actionRefs) {
      if (!this.observing(goal)) return false;
      const action = await this.services.readAction(this.context(goal), ref.serviceName, ref.actionId);
      if (!this.observing(goal)) return false;
      const jobId = action.result.jobId ?? ref.jobId;
      if (ref.jobId && jobId !== ref.jobId) throw new FeedbackError("INVALID_WAIT", "Original Action changed its Job identity");
      const result = jobId ? (await this.services.job(this.context(goal), ref.serviceName, jobId)).result : action.result;
      if (!this.observing(goal)) return false;
      if ("actionId" in result && result.actionId !== ref.actionId) throw new FeedbackError("INVALID_WAIT", "Original Job belongs to another Action");
      if (!["succeeded", "failed", "cancelled"].includes(result.state)) {
        const discovered = await this.services.discover(ref.serviceName);
        if (!this.observing(goal)) return false;
        const declared = discovered.mode === "pi-managed" ? discovered.capabilities.actions[ref.actionName] : undefined;
        if (!declared) throw new FeedbackError("INVALID_WAIT", "Original Action wait capability is unavailable");
        this.store.feedback.waitForOriginalRetry(this.workId, goal.request.requestId, { kind: jobId ? "job" : "action", serviceName: ref.serviceName,
          id: jobId ?? ref.actionId, deadlineAt: new Date(Math.min(this.now().getTime() + declared.maxWaitMs,
            "deadlineAt" in result ? Date.parse(result.deadlineAt) : Infinity)).toISOString(), nextPhase: "verifying", verificationGoal: goal.request.goal }, this.now().toISOString());
        return false;
      }
    }
    if (goal.packageSubmission) {
      if (!this.candidates) throw new FeedbackError("BRAIN_CANDIDATE_UNAVAILABLE", "Candidate observation is unavailable");
      const progress = await this.candidates.poll(goal);
      if (!this.observing(goal)) return false;
      if (progress.state === "failed" || progress.state === "replaced") throw new FeedbackError("PI_PACKAGE_CANDIDATE_CONFLICT", progress.message ?? "Original candidate cannot be adopted");
      if (progress.state === "waiting") {
        this.store.feedback.registerPackageWait(this.workId, goal.request.requestId, { kind: "package-operation", id: progress.id,
          deadlineAt: goal.request.expiresAt, nextPhase: "adopting", verificationGoal: goal.request.goal }, this.now().toISOString());
        return false;
      }
      if (progress.state !== "ready") return false;
    }
    return this.store.feedback.recoveryPhase(this.workId, goal.request.requestId, goal.packageSubmission ? "adopting" : "verifying", this.now().toISOString());
  }

  private async assertSource(goal: RequestInternals): Promise<void> {
    if (goal.request.source.kind !== "service") return;
    const binding = await this.bindings.get(goal.request.source.serviceName!);
    if (binding.serviceId !== goal.sourceServiceId) throw new FeedbackError("SERVICE_EVENT_ORIGIN_MISMATCH", "Request source is no longer current");
  }
  private context(goal: RequestInternals): ServiceRunContext { return { runId: null, requestId: goal.request.requestId,
    automatic: goal.request.source.kind === "service", ...(goal.request.source.serviceName ? { sourceServiceName: goal.request.source.serviceName } : {}) }; }
  private fail(goal: RequestInternals, code: string, message: string): void {
    this.store.feedback.finish(this.workId, goal.request.requestId, "needs_attention", null, { code, message }, [], this.now().toISOString());
  }
  private prompt(goal: RequestInternals): string {
    return `Piwork CoreFlow request ${goal.request.requestId}; phase=${goal.phase}; source=${goal.request.source.kind}${goal.request.source.serviceName ? `:${goal.request.source.serviceName}` : ""}.\nOriginal goal: ${goal.request.goal}\n${goal.request.waitRef ? `Verification goal: ${goal.request.waitRef.verificationGoal}\nOriginal wait: ${JSON.stringify(goal.request.waitRef)}\n` : ""}${goal.packageSubmission ? `Fixed verification target: ${JSON.stringify((goal.packageSubmission as { verificationTarget: unknown }).verificationTarget)}\n` : ""}Original effects: ${JSON.stringify(goal.actionRefs.map((r) => ({ serviceName: r.serviceName, actionId: r.actionId, actionName: r.actionName, jobId: r.jobId, verificationQuery: r.verificationQuery, status: r.status })))}\nEvidence IDs: ${JSON.stringify(goal.request.evidenceIds)}\n${goal.phase === "handling" ? "Read current state, make only declared changes, verify, then finish or register one real wait." : "Inspect only the original effects and verify the original goal. Do not repeat mutation. Finish using actual evidence or report needs_attention."}`;
  }
}
