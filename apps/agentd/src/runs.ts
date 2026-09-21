import { createHash } from "node:crypto";
import { WorkStore, type AcceptedRun, type RunEventRecord, type RunRecord } from "@piwork/work-store";
import { AgentDaemonControl } from "./daemon.js";

export interface RunExecutionContext {
  readonly workId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly prompt: string;
  readonly contextIdentity?: string | null;
  readonly signal: AbortSignal;
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

  constructor(
    private readonly store: WorkStore,
    private readonly daemon: AgentDaemonControl,
    private readonly executor: RunExecutor,
    private readonly now: () => Date = () => new Date(),
  ) {}

  recover(): RunRecord[] {
    return this.store.interruptActiveRuns(this.now().toISOString());
  }

  submit(input: {
    readonly workId: string;
    readonly sessionId: string;
    readonly submissionKey: string;
    readonly prompt: string;
  }): AcceptedRun {
    if (input.prompt.trim() === "") throw new Error("prompt must not be empty");
    if (!this.daemon.readiness().acceptingRuns) throw new Error("Work is not ready to accept Runs");
    const session = this.store.getSession(input.workId, input.sessionId);
    if (session === undefined) throw new Error(`session ${input.sessionId} does not exist in Work ${input.workId}`);
    const requestDigest = digest(JSON.stringify({ sessionId: input.sessionId, prompt: input.prompt }));
    const accepted = this.store.acceptRun({
      workId: input.workId,
      sessionId: input.sessionId,
      submissionKey: input.submissionKey,
      requestDigest,
      promptDigest: digest(input.prompt),
      contextIdentity: session.contextIdentity ?? null,
      now: this.now().toISOString(),
    });
    if (!accepted.reused) this.launch(accepted.run, input.prompt);
    return accepted;
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
        await Promise.allSettled([...this.active.values()].map((execution) => execution.settled));
      }
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }

  private launch(run: RunRecord, prompt: string): void {
    const controller = new AbortController();
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
          emit: (eventType, payload) => {
            this.store.appendEvent(run.runId, eventType, JSON.stringify(payload), this.now().toISOString());
            this.store.compactRunEvents(run.runId);
          },
        });
        if (controller.signal.aborted) {
          this.store.tryCompleteRun(run.runId, "cancelled", result.finalText, null, this.now().toISOString());
        } else {
          this.store.tryCompleteRun(run.runId, "succeeded", result.finalText, null, this.now().toISOString());
        }
      } catch (error) {
        if (controller.signal.aborted) {
          this.store.tryCompleteRun(run.runId, "cancelled", null, null, this.now().toISOString());
        } else {
          this.store.tryCompleteRun(run.runId, "failed", null, JSON.stringify({
            code: "MODEL_EXECUTION_FAILED",
            message: "Model execution failed.",
            retryable: true,
          }), this.now().toISOString());
        }
      } finally {
        finishDaemonRun();
        this.active.delete(run.runId);
      }
    });
    this.active.set(run.runId, { controller, settled });
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
