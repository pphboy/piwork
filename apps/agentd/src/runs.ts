import { createHash } from "node:crypto";
import { WorkStore, type AcceptedRun, type RunEventRecord, type RunRecord, type MemorySelection } from "@piwork/work-store";
import { AgentDaemonControl } from "./daemon.js";
import { type AgentRunSource, type RunSubmissionSelector, type RunModelSnapshot, type ChatInputMode, type ThinkingLevel } from "@piwork/contracts";
import { canonicalJson, type RequestPhase } from "@piwork/work-store";
import { BRAIN_LIMITS } from "@piwork/contracts";
import { RunModelError, type RunModelResolver } from "./run-models.js";

export interface RunExecutionContext {
  readonly workId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly prompt: string;
  readonly contextIdentity?: string | null;
  readonly signal: AbortSignal;
  readonly actualModel?: RunModelSnapshot;
  readonly inputMode?: ChatInputMode;
  readonly source?: AgentRunSource;
  readonly adoptedExperienceVersion?: number;
  readonly adoptedMemorySelection?: MemorySelection | null;
  emit(eventType: string, payload: unknown): void;
}

export interface RunExecutor {
  execute(context: RunExecutionContext): Promise<{ readonly finalText: string }>;
}

interface ActiveExecution {
  readonly controller: AbortController;
  readonly settled: Promise<void>;
}

export class RunManager {
  private readonly active = new Map<string, ActiveExecution>();
  private readonly settledListeners = new Set<(run: RunRecord) => void>();

  constructor(
    private readonly store: WorkStore,
    private readonly daemon: AgentDaemonControl,
    private readonly executor: RunExecutor,
    private readonly now: () => Date = () => new Date(),
    private readonly models?: RunModelResolver,
    private readonly validateCommand?: (prompt: string) => void,
    private readonly memoryEnabled = true,
  ) {}

  recover(): RunRecord[] {
    return this.store.interruptActiveRuns(this.now().toISOString());
  }

  onSettled(listener: (run: RunRecord) => void): () => void {
    this.settledListeners.add(listener); return () => { this.settledListeners.delete(listener); };
  }

  submit(input: {
    readonly workId: string;
    readonly sessionId: string;
    readonly submissionKey: string;
    readonly prompt: string;
    readonly selector?: RunSubmissionSelector;
    readonly actualModel?: RunModelSnapshot;
    readonly agentRequest?: { readonly requestId: string; readonly phase: RequestPhase };
  }): AcceptedRun {
    const selector = input.selector ?? { kind: "session-preference" };
    const requestDigest = submissionDigest(input.sessionId, input.prompt, selector);
    const replay = this.store.findRunReplay(input.workId, input.submissionKey, requestDigest);
    if (replay) return { run: replay, reused: true };
    if (input.prompt.trim() === "") throw new Error("prompt must not be empty");
    if (!this.daemon.readiness().acceptingRuns) throw new Error("Work is not ready to accept Runs");
    const session = this.store.getSession(input.workId, input.sessionId);
    if (session === undefined) throw Object.assign(new Error(`session ${input.sessionId} does not exist in Work ${input.workId}`), {name: "SessionNotFoundError"});
    if (session.contextIdentity && session.contextIdentity !== this.daemon.readiness().contextIdentity) throw Object.assign(new Error("Session context is unavailable"), {name: "SessionContextUnavailableError"});
    const accepted = this.store.acceptRun({
      workId: input.workId,
      sessionId: input.sessionId,
      submissionKey: input.submissionKey,
      requestDigest,
      promptDigest: digest(input.prompt),
      memoryQuery: input.prompt,
      memoryEnabled: this.memoryEnabled,
      ...(input.agentRequest && this.store.feedback.getRequest(input.workId,input.agentRequest.requestId)?.source.serviceName
        ? { memoryServiceName: this.store.feedback.getRequest(input.workId,input.agentRequest.requestId)!.source.serviceName } : {}),
      contextIdentity: session.contextIdentity ?? null,
      now: this.now().toISOString(),
      modelSelectorJson: JSON.stringify(selector),
      ...(input.actualModel ? { actualModelJson: JSON.stringify(input.actualModel) } : {}),
      sourceJson: JSON.stringify({ kind: "chat" }),
      ...(input.agentRequest ? { agentRequest: input.agentRequest } : {}),
    });
    if (!accepted.reused) this.launch(accepted.run, input.prompt);
    return accepted;
  }

  async submitChat(input: { readonly workId: string; readonly sessionId: string; readonly submissionKey: string;
    readonly prompt: string; readonly modelRef?: string | null; readonly inputMode?: ChatInputMode }): Promise<AcceptedRun> {
    const selector: RunSubmissionSelector = { ...modelSelector(input.modelRef), ...(input.inputMode === undefined ? {} : { inputMode: input.inputMode }) };
    const replay = this.store.findRunReplay(input.workId, input.submissionKey, submissionDigest(input.sessionId, input.prompt, selector));
    if (replay) return { run: replay, reused: true };
    if (!this.daemon.readiness().acceptingRuns) throw new Error("Work is not ready to accept Runs");
    const session = this.store.getSession(input.workId, input.sessionId);
    if (!session) throw Object.assign(new Error("Session not found"), {name: "SessionNotFoundError"});
    if (session.contextIdentity && session.contextIdentity !== this.daemon.readiness().contextIdentity) throw Object.assign(new Error("Session context is unavailable"), {name: "SessionContextUnavailableError"});
    if (input.inputMode === "command") {
      if (!this.validateCommand) throw new RunModelError("SLASH_COMMAND_UNSUPPORTED", "This Work cannot execute resource commands.");
      this.validateCommand(input.prompt);
    }
    if (!this.models) {
      if (selector.kind !== "session-preference") throw new RunModelError("RUN_MODEL_SELECTION_UNSUPPORTED", "This Work does not support model selection.");
      return this.submit({ ...input, selector });
    }
    let reference: string | null = selector.kind === "model" ? selector.modelRef : null;
    const preference = session.modelPreferenceJson ? JSON.parse(session.modelPreferenceJson) as RunModelSnapshot & { availability?: string } : undefined;
    if (selector.kind === "session-preference" && preference) {
      if (preference.availability === "unavailable") throw new RunModelError("MODEL_UNAVAILABLE", "Session model preference is unavailable. Choose a model.");
      reference = preference.modelRef;
    }
    const actualModel = await this.models.resolve(reference);
    const thinkingLevel = preference?.thinkingLevel ?? "off";
    let levels: readonly string[] = ["off"];
    try { if (this.models.thinking) levels = (await this.models.thinking(actualModel)).thinkingLevels; }
    catch (error) {
      // Requests predating chat settings keep their legacy custom-model behavior.
      if (input.inputMode !== undefined || preference?.thinkingLevel !== undefined || !(error instanceof RunModelError) || error.modelErrorCode !== "MODEL_NOT_SUPPORTED") throw error;
    }
    if (!levels.includes(thinkingLevel)) throw new RunModelError("THINKING_LEVEL_UNSUPPORTED", "Confirm a Thinking level supported by the selected model before sending.");
    return this.submit({ ...input, selector, actualModel: { ...actualModel, thinkingLevel } });
  }

  async submitAutomatic(input: { readonly workId: string; readonly sessionId: string; readonly submissionKey: string;
    readonly prompt: string; readonly requestId: string; readonly phase: RequestPhase }): Promise<AcceptedRun> {
    const selector: RunSubmissionSelector = { kind: "work-default" };
    const replay = this.store.findRunReplay(input.workId, input.submissionKey, submissionDigest(input.sessionId, input.prompt, selector));
    if (replay) return { run: replay, reused: true };
    if (!this.daemon.readiness().acceptingRuns) throw new Error("Work is not ready to accept Runs");
    const model = await this.models?.resolve(null);
    let thinkingLevel: ThinkingLevel = "off";
    try { if (model && this.models?.thinking) thinkingLevel = (await this.models.thinking(model)).defaultThinkingLevel; }
    catch (error) { if (!(error instanceof RunModelError) || error.modelErrorCode !== "MODEL_NOT_SUPPORTED") throw error; }
    return this.submit({ ...input, selector, ...(model ? { actualModel: { ...model, thinkingLevel } } : {}), agentRequest: { requestId: input.requestId, phase: input.phase } });
  }

  get(runId: string): RunRecord | undefined {
    return this.store.getRun(runId);
  }

  watch(runId: string, afterSequence = 0, limit = 1_000): RunEventRecord[] {
    return this.store.readEvents(runId, afterSequence, limit);
  }

  cancel(runId: string): RunRecord {
    const run = this.store.requestCancellation(runId);
    this.active.get(runId)?.controller.abort();
    return run;
  }

  async wait(runId: string): Promise<RunRecord> {
    await this.active.get(runId)?.settled;
    const run = this.store.getRun(runId);
    if (run === undefined) throw new Error(`Run ${runId} does not exist`);
    return run;
  }

  async drain(timeoutMs: number): Promise<void> {
    const settled = this.daemon.drain();
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); });
    try {
      if (await Promise.race([settled.then(() => "settled" as const), expired]) === "timeout") {
        for (const execution of this.active.values()) execution.controller.abort();
        // A headless extension can wait for an independently running child after
        // the parent aborts. Keep gRPC drain bounded so Core can stop the Work
        // container, which is the final boundary for all child processes.
        let abortTimer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            Promise.allSettled([...this.active.values()].map((execution) => execution.settled)),
            new Promise<void>((resolve) => { abortTimer = setTimeout(resolve, 2_000); }),
          ]);
        } finally { if (abortTimer !== undefined) clearTimeout(abortTimer); }
      }
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }

  private launch(run: RunRecord, prompt: string): void {
    const controller = new AbortController();
    const source = run.sourceJson ? JSON.parse(run.sourceJson) as AgentRunSource : undefined;
    const goal = source?.requestId ? this.store.feedback.internal(run.workId, source.requestId) : undefined;
    let budgetExpired = false;
    const deadline = goal ? Math.min(Date.parse(run.acceptedAt) + BRAIN_LIMITS.runTimeoutMs, Date.parse(goal.request.expiresAt)) : null;
    const deadlineCode = goal && Date.parse(goal.request.expiresAt) <= Date.parse(run.acceptedAt) + BRAIN_LIMITS.runTimeoutMs ? "REQUEST_EXPIRED" : "REQUEST_BUDGET_EXCEEDED";
    const timer = deadline === null ? undefined : setTimeout(() => { budgetExpired = true; controller.abort(); }, Math.max(0, deadline - this.now().getTime()));
    timer?.unref();
    const finishDaemonRun = this.daemon.beginRun();
    const settled = Promise.resolve().then(async () => {
      try {
        this.store.markRunRunning(run.runId, this.now().toISOString());
        const result = await this.executor.execute({
          workId: run.workId,
          sessionId: run.sessionId,
          runId: run.runId,
          prompt,
          contextIdentity: run.contextIdentity ?? null,
          signal: controller.signal,
          ...(run.actualModelJson ? { actualModel: JSON.parse(run.actualModelJson) as RunModelSnapshot } : {}),
          ...(run.modelSelectorJson && JSON.parse(run.modelSelectorJson).inputMode ? { inputMode: JSON.parse(run.modelSelectorJson).inputMode as ChatInputMode } : {}),
          ...(run.sourceJson ? { source: JSON.parse(run.sourceJson) as AgentRunSource } : {}),
          adoptedExperienceVersion: run.adoptedExperienceVersion ?? 0,
          adoptedMemorySelection: run.adoptedMemorySelection,
          emit: (eventType, payload) => {
            this.store.appendEvent(run.runId, eventType, JSON.stringify(payload), this.now().toISOString());
            this.store.compactRunEvents(run.runId);
          },
        });
        if (budgetExpired && this.store.getRun(run.runId)?.state !== "cancelling") {
          this.store.tryCompleteRun(run.runId, "failed", null, JSON.stringify({ code: deadlineCode, message: "Automatic Run execution deadline passed", retryable: false }), this.now().toISOString());
        } else if (controller.signal.aborted) {
          this.store.tryCompleteRun(run.runId, "cancelled", result.finalText, null, this.now().toISOString());
        } else {
          this.store.tryCompleteRun(run.runId, "succeeded", result.finalText, null, this.now().toISOString());
        }
      } catch (error) {
        if (budgetExpired && this.store.getRun(run.runId)?.state !== "cancelling") {
          this.store.tryCompleteRun(run.runId, "failed", null, JSON.stringify({ code: deadlineCode, message: "Automatic Run execution deadline passed", retryable: false }), this.now().toISOString());
        } else if (controller.signal.aborted) {
          this.store.tryCompleteRun(run.runId, "cancelled", null, null, this.now().toISOString());
        } else {
          this.store.tryCompleteRun(run.runId, "failed", null, JSON.stringify({
            code: error instanceof RunModelError ? error.modelErrorCode : "MODEL_EXECUTION_FAILED",
            message: error instanceof RunModelError ? error.message : "Model execution failed.",
            retryable: true,
          }), this.now().toISOString());
        }
      } finally {
        if (timer) clearTimeout(timer);
        finishDaemonRun();
        this.active.delete(run.runId);
        const final = this.store.getRun(run.runId);
        if (final) for (const listener of this.settledListeners) { try { listener(final); } catch { /* Observation does not alter the durable outcome. */ } }
      }
    });
    this.active.set(run.runId, { controller, settled });
  }
}

export function modelSelector(reference: string | null | undefined): RunSubmissionSelector {
  return reference === undefined ? { kind: "session-preference" } : reference === null || reference === "" ? { kind: "work-default" } : { kind: "model", modelRef: reference };
}
function submissionDigest(sessionId: string, prompt: string, selector: RunSubmissionSelector): string {
  return digest(canonicalJson({ sessionId, prompt, selector }));
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
