import { lstatSync } from "node:fs";
import { join } from "node:path";
import { Check } from "typebox/value";
import { BrainCandidateSubmissionSchema, BrainBehaviorChecksSchema, BRAIN_LIMITS, isBrainVerificationTarget, type BrainVerificationTarget, type BrainCandidateSubmission, type BrainCandidateState } from "@piwork/contracts";
import { digestPiPackageTree } from "@piwork/pi-package";
import { canonicalJson, publicText, FeedbackError, type RequestInternals, type WorkStore } from "@piwork/work-store";
import type { RunExecutionContext } from "./runs.js";
import type { WorkPrivateClient } from "./work-private-client.js";
import type { BrainCandidateBridge } from "./brain-flow.js";
import type { CandidatePoller, CandidateProgress } from "./brain-loop.js";

/** Captured active root is execution authority; editable Work files are candidate source only. */
export class BrainCandidates implements BrainCandidateBridge, CandidatePoller {
  private readonly adopted = new Set<string>();
  constructor(private readonly workId: string, private readonly workspace: string, private readonly store: WorkStore,
    private readonly loaded: { digest: string; version: string | null; contextId: string; root: string } | undefined,
    private readonly control?: Pick<WorkPrivateClient, "prepareBrain" | "brainState">,
    private readonly now: () => Date = () => new Date()) {}

  async prepare(context: RunExecutionContext, goal: RequestInternals, input: { submissionKey: string; verificationGoal: string; verificationTarget: BrainVerificationTarget }): Promise<unknown> {
    if (!isBrainVerificationTarget(input.verificationTarget)) throw new FeedbackError("INVALID_BRAIN_INPUT", "Candidate requires a concrete brain capability verification target");
    if (!this.control || !this.loaded || context.contextIdentity !== this.loaded.contextId) throw new FeedbackError("BRAIN_CANDIDATE_UNAVAILABLE", "A loaded compatible brain and current control identity are required");
    if (Buffer.byteLength(input.verificationGoal) > BRAIN_LIMITS.goalBytes || !input.submissionKey || input.submissionKey.length > 256) throw new FeedbackError("INVALID_BRAIN_INPUT", "Candidate intent exceeds limits");
    let source = this.workspace;
    for (const part of [".pi", "packages", "piwork-brain"]) { source = join(source, part); const stat = lstatSync(source);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new FeedbackError("PI_PACKAGE_CANDIDATE_CHANGED", "Fixed brain source is missing or invalid"); }
    const expectedSourceDigest = await digestPiPackageTree(source);
    let submission: BrainCandidateSubmission;
    if (goal.packageSubmission) {
      submission = this.descriptor(goal);
      if (submission.submissionKey !== input.submissionKey || submission.verificationGoal !== input.verificationGoal || canonicalJson(submission.verificationTarget) !== canonicalJson(input.verificationTarget) || submission.expectedSourceDigest !== expectedSourceDigest) throw new FeedbackError("SUBMIT_CONFLICT", "Candidate source or verification intent changed under the original key");
    } else {
      const state = await this.read({});
      // A failed Apply can retain a different desired. Fence both baselines
      // independently so a new repair can be prepared from the loaded active.
      if (!state.active?.enabled || !state.desired?.enabled || state.active.digest !== this.loaded.digest) throw new FeedbackError("PI_PACKAGE_CANDIDATE_CONFLICT", "Current brain active/desired must remain enabled and active must match the loaded package");
      submission = { ...input, expectedSourceDigest, requestId: goal.request.requestId, activeDigest: this.loaded.digest,
        desiredDigest: state.desired.digest, activeContextId: this.loaded.contextId };
      this.store.feedback.setPackageSubmission(this.workId, goal.request.requestId, submission);
    }
    if (submission.expectedSourceDigest === this.loaded.digest) {
      this.store.feedback.recordCandidateArtifact(this.workId, goal.request.requestId, submission.submissionKey, this.loaded.digest, submission.expectedSourceDigest, this.now().toISOString());
      this.adopted.add(goal.request.requestId);
      return { source: "Work files", unchanged: true, loaded: true, version: this.loaded.version, verificationGoal: submission.verificationGoal };
    }
    let state = await this.read({ submissionKey: submission.submissionKey });
    if (!state.candidate) {
      try { await this.control.prepareBrain(submission); }
      catch (error) {
        state = await this.read({ submissionKey: submission.submissionKey });
        if (!state.candidate) throw new FeedbackError(/PI_PACKAGE_CANDIDATE_CONFLICT/.test(String(error)) ? "PI_PACKAGE_CANDIDATE_CONFLICT" : "BRAIN_CANDIDATE_UNAVAILABLE", "Candidate acknowledgment is unavailable; inspect the original submission before retry");
      }
      state = await this.read({ submissionKey: submission.submissionKey });
    }
    if (!state.candidate) throw new FeedbackError("BRAIN_CANDIDATE_UNAVAILABLE", "Original candidate receipt is unavailable");
    this.assertReceipt(submission, state);
    this.store.feedback.registerPackageWait(this.workId, goal.request.requestId, { kind: "package-operation", id: state.candidate.operationId,
      deadlineAt: new Date(this.now().getTime() + BRAIN_LIMITS.runTimeoutMs).toISOString(), nextPhase: "adopting", verificationGoal: submission.verificationGoal }, this.now().toISOString());
    const current = this.store.feedback.internal(this.workId, goal.request.requestId)!;
    const progress = await this.poll(current);
    return { operationId: state.candidate.operationId, source: "Work files", preparation: state.candidate.phase,
      state: progress.state, version: state.candidate.version ?? null, requestId: goal.request.requestId };
  }

  async status(goal: RequestInternals): Promise<unknown> {
    if (!goal.packageSubmission) return { candidate: null };
    const state = await this.read({ submissionKey: this.descriptor(goal).submissionKey });
    const digest = state.candidate?.artifactDigest ?? (this.descriptor(goal).expectedSourceDigest === this.loaded?.digest ? this.loaded.digest : undefined);
    return { source: "Work files", operationId: state.candidate?.operationId ?? null, preparation: state.candidate?.phase ?? "unchanged",
      version: state.candidate?.version ?? this.loaded?.version ?? null, active: !!digest && !!state.active?.enabled && state.active.digest === digest,
      desired: !!digest && !!state.desired?.enabled && state.desired.digest === digest,
      loaded: !!digest && this.loaded?.digest === digest && state.active?.digest === digest && state.active.enabled, requestId: goal.request.requestId };
  }

  async poll(goal: RequestInternals): Promise<CandidateProgress> {
    const submission = this.descriptor(goal), state = await this.read({ submissionKey: submission.submissionKey });
    // Core I/O can outlive the original deadline or a cancellation. Re-read
    // before recording an artifact, marking adoption or extending Apply wait.
    const current = this.store.feedback.internal(this.workId, goal.request.requestId)?.request;
    if (!current || current.disposition !== "live" || !["pending", "running", "waiting_result", "waiting_apply"].includes(current.state)) {
      return { state: "waiting", id: state.candidate?.operationId ?? submission.submissionKey };
    }
    const now = this.now().toISOString();
    if (current.expiresAt <= now || (["waiting_result", "waiting_apply"].includes(current.state)
      && current.waitRef && current.waitRef.deadlineAt <= now)) throw new FeedbackError("REQUEST_EXPIRED", "Original candidate deadline passed");
    if (!state.candidate) {
      if (this.loaded && submission.expectedSourceDigest === this.loaded.digest && state.active?.enabled && state.active.digest === this.loaded.digest) {
        this.store.feedback.recordCandidateArtifact(this.workId, goal.request.requestId, submission.submissionKey, this.loaded.digest, submission.expectedSourceDigest, this.now().toISOString());
        this.adopted.add(goal.request.requestId); return { state: "ready", id: goal.request.waitRef?.id ?? submission.submissionKey };
      }
      return { state: "failed", id: goal.request.waitRef?.id ?? submission.submissionKey, message: "Original candidate receipt is missing" };
    }
    this.assertReceipt(submission, state);
    const candidate = state.candidate;
    if (["failed", "superseded", "cancelled"].includes(candidate.state) || ["failed", "superseded", "cleanup-pending"].includes(candidate.phase)) return { state: "failed", id: candidate.operationId, message: "Candidate preparation failed or was superseded" };
    if (candidate.state !== "succeeded") return { state: "waiting", id: candidate.operationId };
    if (!candidate.artifactDigest) return { state: "failed", id: candidate.operationId, message: "Prepared candidate has no captured artifact proof" };
    this.store.feedback.recordCandidateArtifact(this.workId, goal.request.requestId, candidate.operationId, candidate.artifactDigest, submission.expectedSourceDigest, this.now().toISOString());
    if (state.active?.enabled && state.active.digest === candidate.artifactDigest) {
      if (this.loaded?.digest === candidate.artifactDigest) { this.adopted.add(goal.request.requestId); return { state: "ready", id: candidate.operationId }; }
      return { state: "waiting", id: candidate.operationId };
    }
    if (candidate.apply?.state === "failed") return { state: "failed", id: candidate.operationId, message: "Candidate Apply failed; inspect the original Apply Operation and its prior active rollback" };
    if (!state.desired?.enabled || state.desired.digest !== candidate.artifactDigest) return { state: "replaced", id: candidate.operationId, message: "Prepared brain candidate was replaced, removed or disabled" };
    this.store.feedback.registerPackageWait(this.workId, goal.request.requestId, { kind: "apply", id: candidate.operationId,
      deadlineAt: new Date(this.now().getTime() + BRAIN_LIMITS.applyTimeoutMs).toISOString(), nextPhase: "adopting", verificationGoal: submission.verificationGoal }, this.now().toISOString());
    return { state: "waiting_apply", id: candidate.operationId };
  }

  /** Called only by the real SDK's successful tool completion event, never by model input. */
  recordSdkResult(context: RunExecutionContext, input: { toolName: string; toolCallId: string; args: unknown; isError: boolean; result: unknown }, packageTools: ReadonlyMap<string, string>): void {
    if (!this.loaded || context.signal.aborted || context.contextIdentity !== this.loaded.contextId || this.store.activeRun(this.workId)?.runId !== context.runId) return;
    const goal = this.store.feedback.requestForRun(this.workId, context.runId);
    if (!goal?.packageSubmission || goal.request.state !== "running" || !this.adopted.has(goal.request.requestId) || !["handling", "adopting", "verifying"].includes(goal.phase)) return;
    const target = this.descriptor(goal).verificationTarget;
    const canonical = [...packageTools].find(([name, native]) => native === input.toolName && name.startsWith("package:piwork-brain:"))?.[0];
    if (canonical !== target.toolName) return;
    try { if (canonicalJson(input.args) !== canonicalJson(target.input)) return; } catch { return; }
    const details = input.result && typeof input.result === "object" ? (input.result as { details?: unknown }).details : undefined;
    const result = details && typeof details === "object" ? details as Record<string, unknown> : {};
    const checks = input.toolName === "brain_service" ? (result.result as { checks?: unknown } | undefined)?.checks : result.checks;
    const valid = Check(BrainBehaviorChecksSchema, checks) && new Set(checks.map((c) => c.name)).size === checks.length;
    const passed = !input.isError && valid && checks.every((c) => c.passed) && target.checkNames.every((name) => checks.some((c) => c.name === name));
    if (!passed) {
      this.store.feedback.addEvidence(this.workId, { requestId: goal.request.requestId, runId: context.runId, kind: "sdk", objectRef: canonical,
        observedAt: this.now().toISOString(), codeVersion: this.loaded.version ?? "unversioned", verified: false,
        summary: valid ? `Candidate behavior checks failed: ${checks.map((c) => `${c.name}: ${c.passed ? "passed" : "failed"}`).join("; ")}` : "Candidate behavior checks are missing, invalid or duplicated" });
      this.store.feedback.finish(this.workId, goal.request.requestId, "needs_attention", null, { code: "VERIFICATION_REQUIRED", message: "Loaded candidate did not pass its fixed behavior checks; inspect the evidence" }, [], this.now().toISOString());
      return;
    }
    this.store.feedback.addEvidence(this.workId, { requestId: goal.request.requestId, runId: context.runId, kind: "sdk",
      objectRef: canonical, observedAt: this.now().toISOString(),
      codeVersion: this.loaded.version ?? "unversioned",
      summary: `Fixed candidate behavior verified: ${checks.map((c) => `${c.name}: passed ${c.summary}`).join("; ")}`.slice(0, 8192), verified: true },
      { verificationContractVersion: 1, adoptionVerified: true, requestId: goal.request.requestId, runId: context.runId,
        verificationTarget: target, toolName: canonical, input: target.input, toolCallId: input.toolCallId,
        artifactDigest: this.loaded.digest, contextIdentity: this.loaded.contextId, checks: checks.map((check) => ({ ...check, summary: publicText(check.summary) })) }, true);
  }

  private descriptor(goal: RequestInternals): BrainCandidateSubmission {
    if (!Check(BrainCandidateSubmissionSchema, goal.packageSubmission) || !isBrainVerificationTarget(goal.packageSubmission.verificationTarget)) throw new FeedbackError("VERIFICATION_REQUIRED", "Original candidate needs a fixed verification target; create a new explicit goal and submission key"); return goal.packageSubmission;
  }
  private assertReceipt(submission: BrainCandidateSubmission, state: BrainCandidateState): void {
    if (state.candidate?.sourceDigest !== submission.expectedSourceDigest || state.candidate.requestId !== submission.requestId) throw new FeedbackError("PI_PACKAGE_CANDIDATE_CONFLICT", "Candidate receipt does not match the original source and intent");
  }
  private async read(input: unknown): Promise<BrainCandidateState> {
    if (!this.control) throw new FeedbackError("BRAIN_CANDIDATE_UNAVAILABLE", "Current candidate control route is unavailable");
    let state: BrainCandidateState;
    try { state = await this.control.brainState(input) as BrainCandidateState; }
    catch (error) {
      if ([4, 9, 14].includes((error as { code?: number }).code ?? -1)) throw new FeedbackError("BINDINGS_UNAVAILABLE", "Current agent control is not yet active or temporarily unavailable");
      throw error;
    }
    if (!state || state.workId !== this.workId || !("active" in state) || !("desired" in state) || !("candidate" in state)) throw new FeedbackError("BRAIN_CANDIDATE_UNAVAILABLE", "Candidate authority is unavailable"); return state;
  }
}
