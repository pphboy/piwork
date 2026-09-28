import { createHash, randomUUID } from "node:crypto";
import { encodeFileHelperFrame, FILE_HELPER_FRAME_KIND, FileHelperErrorSchema,
  FileHelperResultSchema, type FileErrorCode } from "@piwork/contracts";
import { Check } from "typebox/value";
import type { CoreStore, WorkFileAttemptRecord, WorkFileJobRecord, WorkFileTemporaryRecord } from "@piwork/core-store";
import type { FileHelperSpec } from "@piwork/runtime-docker";
import type { WorkFileRuntime } from "./coordinator.js";
import { parseFrames, WorkFileExecutionError, writeFrame } from "./coordinator.js";

const EMPTY_CONDITIONS = { ifMatch: null, ifNoneMatch: null, ifModifiedSince: null, ifUnmodifiedSince: null };

interface RecoveryOptions { readonly deadlineAtMs?: number; readonly signal?: AbortSignal; }

/** A Docker call may finish after its caller times out; its journal remains the source of truth. */
class RecoveryBudget {
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly timer?: NodeJS.Timeout;
  private readonly onAbort?: () => void;

  constructor(options: RecoveryOptions) {
    this.signal = this.controller.signal;
    if (options.signal !== undefined) {
      this.onAbort = () => this.controller.abort();
      options.signal.addEventListener("abort", this.onAbort, { once: true });
      if (options.signal.aborted) this.controller.abort();
    }
    if (options.deadlineAtMs !== undefined) {
      const remaining = options.deadlineAtMs - Date.now();
      if (remaining <= 0) this.controller.abort();
      else this.timer = setTimeout(() => this.controller.abort(), remaining);
    }
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.signal.aborted) throw new WorkFileExecutionError("FILE_CLEANUP_REQUIRED");
    let onAbort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new WorkFileExecutionError("FILE_CLEANUP_REQUIRED"));
      this.signal.addEventListener("abort", onAbort, { once: true });
    });
    try { return await Promise.race([task(), aborted]); }
    finally { this.signal.removeEventListener("abort", onAbort); }
  }

  check(): void {
    if (this.signal.aborted) throw new WorkFileExecutionError("FILE_CLEANUP_REQUIRED");
  }

  close(external?: AbortSignal): void {
    clearTimeout(this.timer);
    if (this.onAbort !== undefined) external?.removeEventListener("abort", this.onAbort);
  }
}

/** Recovers exact journaled helper attempts; an ambiguous creation or temporary keeps the Work blocked. */
export class WorkFileRecovery {
  private static readonly active = new Map<string, Promise<boolean>>();
  constructor(private readonly store: CoreStore, private readonly runtime: WorkFileRuntime,
    private readonly installationId: string, private readonly now = () => new Date().toISOString(),
    private readonly currentCoreEpoch?: number) {}

  async recoverAll(options: RecoveryOptions = {}): Promise<readonly string[]> {
    const blocked: string[] = [];
    for (const job of this.store.files.listPendingJobs()) {
      if (options.signal?.aborted || options.deadlineAtMs !== undefined && Date.now() >= options.deadlineAtMs) {
        blocked.push(job.workId);
        continue;
      }
      if (job.coreEpoch === this.currentCoreEpoch && job.state !== "cleanup-pending") continue;
      if (!(await this.recoverJob(job.id, false, options))) blocked.push(job.workId);
    }
    return [...new Set(blocked)];
  }

  async recoverWork(workId: string, explicitRetry = false, options: RecoveryOptions = {}): Promise<boolean> {
    const jobs = this.store.files.listPendingJobs(workId);
    let cleaned = true;
    // Admission caps live jobs at four per Work; old journals may contain more.
    for (let offset = 0; offset < jobs.length; offset += 4) {
      const batch = jobs.slice(offset, offset + 4);
      const results = await Promise.all(batch.map((job) => this.recoverJob(job.id, explicitRetry, options)));
      if (results.some((result) => !result)) cleaned = false;
      if (options.signal?.aborted || options.deadlineAtMs !== undefined && Date.now() >= options.deadlineAtMs) break;
    }
    return cleaned && !this.store.files.hasPending(workId);
  }

  recoverJob(jobId: string, explicitRetry = false, options: RecoveryOptions = {}): Promise<boolean> {
    const active = WorkFileRecovery.active.get(jobId);
    if (active) return this.waitForActive(active, options);
    const task = this.performRecoverJob(jobId, explicitRetry, options);
    WorkFileRecovery.active.set(jobId, task);
    const clear = () => { if (WorkFileRecovery.active.get(jobId) === task) WorkFileRecovery.active.delete(jobId); };
    void task.then(clear, clear);
    return task;
  }

  private async waitForActive(active: Promise<boolean>, options: RecoveryOptions): Promise<boolean> {
    const budget = new RecoveryBudget(options);
    try { return await budget.run(() => active); }
    catch { return false; }
    finally { budget.close(options.signal); }
  }

  private async performRecoverJob(jobId: string, explicitRetry: boolean, options: RecoveryOptions): Promise<boolean> {
    const budget = new RecoveryBudget(options);
    try { return await this.recoverWithinBudget(jobId, explicitRetry, budget); }
    finally { budget.close(options.signal); }
  }

  private async recoverWithinBudget(jobId: string, explicitRetry: boolean, budget: RecoveryBudget): Promise<boolean> {
    const job = this.store.files.getJob(jobId);
    if (!job || job.state === "cleaned") return true;
    if (job.state !== "cleanup-pending")
      this.store.files.updateJobState(job.id, job.state, "cleanup-pending", this.now(), "FILE_CLEANUP_REQUIRED");
    const attempts = this.store.files.listAttempts(job.id);
    const temporaries = this.store.files.listTemporaries(job.id);
    if (attempts.every((attempt) => attempt.state === "removed")
      && temporaries.some((item) => item.state !== "published" && item.state !== "cleaned"
        && (item.device === null || item.inode === null))) return false;
    try {
      budget.check();
      if (!this.store.files.reserveCleanupRetry(job.id, this.now(), explicitRetry)) return false;
      // A cleanup attempt may itself have crashed. No new helper runs until every old attempt is gone.
      for (const attempt of this.store.files.listAttempts(job.id)) {
        if (attempt.state === "removed") continue;
        if (!(await this.retireAttempt(job, attempt, budget))) return false;
      }
      const outstanding = this.store.files.listTemporaries(job.id)
        .filter((item) => item.state !== "published" && item.state !== "cleaned");
      if (outstanding.some((item) => item.device === null || item.inode === null)) return false;
      if (outstanding.length > 0) await this.cleanupTemporaries(job, outstanding, budget);
      budget.check();
      this.store.files.markCleaned(job.id, this.now());
      return true;
    } catch (error) {
      // Exact journal identity is retained for a bounded retry or an operator retry.
      const code = error instanceof WorkFileExecutionError ? error.code : "FILE_RUNTIME_UNAVAILABLE";
      this.store.files.updateJobState(job.id, "cleanup-pending", "cleanup-pending", this.now(), code);
      return false;
    }
  }

  private spec(job: WorkFileJobRecord, attempt: WorkFileAttemptRecord): FileHelperSpec {
    return { installationId: this.installationId, workId: job.workId, jobId: job.id,
      attemptId: attempt.id, epoch: attempt.epoch, name: attempt.containerName,
      imageId: job.trustedImageId, volumeName: job.volumeName,
      readOnly: attempt.kind === "request" && ["PROPFIND", "GET", "HEAD"].includes(job.kind) };
  }

  private async retireAttempt(job: WorkFileJobRecord, attempt: WorkFileAttemptRecord, budget: RecoveryBudget): Promise<boolean> {
    const spec = this.spec(job, attempt);
    const current = await budget.run(() => this.runtime.inspectFileHelper(spec));
    if (!current) {
      // A create call can time out before its result is reported; absence is not exit proof.
      if (attempt.state === "creating" && attempt.containerId === null) return false;
      this.store.files.updateAttempt(attempt.id, attempt.state, "removed", this.now());
      return true;
    }
    if (attempt.containerId !== null && attempt.containerId !== current.containerId)
      throw new WorkFileExecutionError("FILE_CLEANUP_REQUIRED");
    if (current.running) await budget.run(() => this.runtime.stopFileHelper(spec));
    const stopped = await budget.run(() => this.runtime.inspectFileHelper(spec));
    if (stopped?.running) throw new WorkFileExecutionError("FILE_CLEANUP_REQUIRED");
    const latest = this.store.files.listAttempts(job.id).find((item) => item.id === attempt.id)!;
    if (latest.state !== "exited" && latest.state !== "removed")
      this.store.files.updateAttempt(attempt.id, latest.state, "exited", this.now(), current.containerId);
    await budget.run(() => this.runtime.removeFileHelper(spec));
    if (await budget.run(() => this.runtime.inspectFileHelper(spec))) throw new WorkFileExecutionError("FILE_CLEANUP_REQUIRED");
    this.store.files.updateAttempt(attempt.id, "exited", "removed", this.now());
    return true;
  }

  private async cleanupTemporaries(job: WorkFileJobRecord, items: readonly WorkFileTemporaryRecord[], budget: RecoveryBudget): Promise<void> {
    budget.check();
    const attemptId = `attempt-${randomUUID()}`;
    const name = `piwork-file-${createHash("sha256").update(`${this.installationId}\0${job.id}\0${attemptId}`).digest("hex").slice(0, 32)}`;
    const now = this.now();
    const attempt: WorkFileAttemptRecord = { id: attemptId, jobId: job.id, kind: "cleanup",
      epoch: job.workEpoch, containerName: name, containerId: null, state: "planned", createdAt: now, updatedAt: now };
    this.store.files.insertAttempt(attempt);
    const spec = this.spec(job, attempt);
    this.store.files.updateAttempt(attemptId, "planned", "creating", this.now());
    const containerId = await budget.run(() => this.runtime.createFileHelper(spec));
    this.store.files.updateAttempt(attemptId, "creating", "created", this.now(), containerId);
    const process = await budget.run(() => this.runtime.startFileHelper(spec, budget.signal));
    this.store.files.updateAttempt(attemptId, "created", "running", this.now());
    const abortProcess = () => process.abort();
    budget.signal.addEventListener("abort", abortProcess, { once: true });
    try {
      const request = { version: 1, jobId: job.id, workId: job.workId, epoch: job.workEpoch,
        action: "CLEANUP", pathSegments: [], destinationSegments: null, depth: null,
        overwrite: null, conditions: EMPTY_CONDITIONS, range: null, expectedLength: null,
        temporaries: items.map((item) => ({ temporaryId: item.id,
          parentSegments: JSON.parse(item.parentSegmentsJson) as string[], name: item.name,
          device: item.device!, inode: item.inode! })) };
      await budget.run(() => writeFrame(process.stdin, encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.REQUEST, request)));
      process.stdin.end();
      let result: { status: number } | undefined;
      let failure: FileErrorCode | undefined;
      for await (const frame of parseFrames(process.stdout)) {
        budget.check();
        if (frame.kind === FILE_HELPER_FRAME_KIND.RESULT && Check(FileHelperResultSchema, frame.payload)) result = frame.payload;
        else if (frame.kind === FILE_HELPER_FRAME_KIND.ERROR && Check(FileHelperErrorSchema, frame.payload)) failure = frame.payload.code;
        else throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
      }
      await budget.run(() => process.completed);
      if (!result || result.status !== 204 || failure) throw new WorkFileExecutionError(failure ?? "FILE_BACKEND_PROTOCOL_ERROR");
      const stopped = await budget.run(() => this.runtime.inspectFileHelper(spec));
      if (!stopped || stopped.running || stopped.exitCode !== 0) throw new WorkFileExecutionError("FILE_CLEANUP_REQUIRED");
      this.store.files.updateAttempt(attemptId, "running", "exited", this.now());
      await budget.run(() => this.runtime.removeFileHelper(spec));
      this.store.files.updateAttempt(attemptId, "exited", "removed", this.now());
      for (const item of items) this.store.files.markTemporary(item.id, job.id, "cleaned", this.now());
    } catch (error) {
      process.abort();
      await budget.run(() => process.completed).catch(() => undefined);
      throw error;
    } finally {
      budget.signal.removeEventListener("abort", abortProcess);
    }
  }
}
