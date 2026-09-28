import { createHash, randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import {
  decodeFileHelperFrame, encodeFileHelperFrame, FILE_HELPER_FRAME_KIND,
  FILE_HELPER_MAX_CONTROL_BYTES, FILE_HELPER_MAX_DATA_BYTES, FILE_LIMITS,
  FileHelperAckSchema, FileHelperErrorSchema, FileHelperMetaSchema,
  FileHelperPreparedSchema, FileHelperResultSchema,
  type FileErrorCode,
} from "@piwork/contracts";
import { Check } from "typebox/value";
import type { CoreStore, WorkFileJobRecord, WorkFileAttemptRecord } from "@piwork/core-store";
import type { DockerRuntime, FileHelperSpec } from "@piwork/runtime-docker";
import type { DockerStreamProcess } from "@piwork/runtime-docker";
import type { WorkFileAccessGuard } from "./access.js";

export class WorkFileExecutionError extends Error {
  constructor(readonly code: FileErrorCode) { super(code); this.name = "WorkFileExecutionError"; }
}

export interface WorkFileExecutionInput {
  readonly workId: string;
  readonly ownerUserId: string;
  readonly sessionId: string;
  readonly runtimeGeneration: number;
  readonly kind: WorkFileJobRecord["kind"];
  readonly pathSegments: readonly string[];
  readonly destinationSegments?: readonly string[];
  readonly depth?: 0 | 1 | "infinity";
  readonly overwrite?: boolean;
  readonly conditions: { readonly ifMatch: string | null; readonly ifNoneMatch: string | null;
    readonly ifModifiedSince: string | null; readonly ifUnmodifiedSince: string | null };
  readonly range?: { readonly start: number; readonly end: number | null } | { readonly suffix: number };
  readonly expectedLength?: number;
  readonly body?: AsyncIterable<Uint8Array>;
  readonly signal?: AbortSignal;
  readonly onMeta?: (value: unknown) => Promise<void> | void;
  readonly onData?: (value: Buffer) => Promise<void> | void;
}

export interface WorkFileExecutionResult {
  readonly status: number;
  readonly bytes: number;
  readonly entries: number;
  readonly failures: readonly { readonly code: FileErrorCode; readonly pathSegments: readonly string[] | null }[];
}

export type WorkFileRuntime = Pick<DockerRuntime, "createFileHelper" | "startFileHelper" | "inspectFileHelper" | "stopFileHelper" | "removeFileHelper">;

interface Timing { readonly connectTimeoutMs: number; readonly helperTimeoutMs: number;
  readonly idleTimeoutMs: number; readonly requestTimeoutMs: number; }
const DEFAULT_TIMING: Timing = FILE_LIMITS;

async function within<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([task, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new WorkFileExecutionError("FILE_TRANSFER_TIMEOUT")), timeoutMs);
      timer.unref();
    })]);
  } finally { clearTimeout(timer); }
}

export async function writeFrame(stream: Writable, frame: Buffer): Promise<void> {
  if (stream.destroyed) throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
  await new Promise<void>((resolve, reject) => stream.write(frame, (error) => error ? reject(error) : resolve()));
}

async function nextChunk(iterator: AsyncIterator<Uint8Array>, signal?: AbortSignal): Promise<IteratorResult<Uint8Array>> {
  signal?.throwIfAborted();
  if (!signal) return iterator.next();
  let rejectAbort!: (error: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(signal.reason ?? new WorkFileExecutionError("FILE_TRANSFER_TIMEOUT"));
  signal.addEventListener("abort", onAbort, { once: true });
  try { return await Promise.race([iterator.next(), aborted]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

export async function* parseFrames(source: AsyncIterable<Buffer>): AsyncGenerator<ReturnType<typeof decodeFileHelperFrame>> {
  let pending = Buffer.alloc(0);
  for await (const chunk of source) {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 5) {
      const kind = pending.readUInt8(0), size = pending.readUInt32BE(1);
      const limit = kind === FILE_HELPER_FRAME_KIND.DATA_FROM_HELPER ? FILE_HELPER_MAX_DATA_BYTES : FILE_HELPER_MAX_CONTROL_BYTES;
      if (size > limit) throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
      if (pending.length < 5 + size) break;
      try { yield decodeFileHelperFrame(pending.subarray(0, 5 + size)); }
      catch { throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR"); }
      pending = pending.subarray(5 + size);
    }
    if (pending.length > FILE_HELPER_MAX_DATA_BYTES + 5) throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
  }
  if (pending.length !== 0) throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
}

export class WorkFileCoordinator {
  constructor(private readonly store: CoreStore, private readonly runtime: WorkFileRuntime,
    private readonly installationId: string, private readonly imageId: string,
    private readonly coreEpoch: number, private readonly accessGuard: Pick<WorkFileAccessGuard, "validate">,
    private readonly now = () => new Date().toISOString(), private readonly timing: Timing = DEFAULT_TIMING) {}

  async execute(input: WorkFileExecutionInput): Promise<WorkFileExecutionResult> {
    await this.accessGuard.validate(input);
    const volumes = this.store.listVolumeRecords(input.workId).filter((record) => record.volumeRole === "workspace"
      && record.installationId === this.installationId && record.state === "active");
    if (volumes.length !== 1) throw new WorkFileExecutionError("FILE_RUNTIME_UNAVAILABLE");
    const jobId = `filejob-${randomUUID()}`;
    const attemptId = `attempt-${randomUUID()}`;
    const name = `piwork-file-${createHash("sha256").update(`${this.installationId}\0${jobId}\0${attemptId}`).digest("hex").slice(0, 32)}`;
    const acceptedAt = this.now();
    const attempt: WorkFileAttemptRecord = { id: attemptId, jobId, kind: "request", epoch: 1,
      containerName: name, containerId: null, state: "planned", createdAt: acceptedAt, updatedAt: acceptedAt };
    const job = this.store.files.acceptJob({ id: jobId, workId: input.workId,
      ownerUserId: input.ownerUserId, sessionId: input.sessionId, coreEpoch: this.coreEpoch,
      runtimeGeneration: input.runtimeGeneration, kind: input.kind, state: "accepted",
      trustedImageId: this.imageId, volumeName: volumes[0]!.runtimeName,
      pathSegmentsJson: JSON.stringify(input.pathSegments),
      destinationSegmentsJson: input.destinationSegments === undefined ? null : JSON.stringify(input.destinationSegments),
      acceptedAt, deadlineAt: new Date(Date.parse(acceptedAt) + this.timing.requestTimeoutMs).toISOString(),
      updatedAt: acceptedAt, cleanedAt: null, errorCode: null }, attempt);
    const spec: FileHelperSpec = { installationId: this.installationId, workId: job.workId,
      jobId, attemptId, epoch: job.workEpoch, name, imageId: this.imageId,
      volumeName: job.volumeName, readOnly: ["PROPFIND", "GET", "HEAD"].includes(input.kind) };
    let created = false;
    let process: DockerStreamProcess | undefined;
    let streamError: unknown;
    let completedResult: WorkFileExecutionResult | undefined;
    let removalFailedAfterResult = false;
    const authorization = new AbortController();
    const deadline = new AbortController();
    const signal = input.signal ? AbortSignal.any([input.signal, authorization.signal, deadline.signal])
      : AbortSignal.any([authorization.signal, deadline.signal]);
    let authorizationError: unknown;
    let timeoutError: WorkFileExecutionError | undefined;
    let startupTimer: NodeJS.Timeout | undefined;
    const timeout = () => { timeoutError = new WorkFileExecutionError("FILE_TRANSFER_TIMEOUT"); deadline.abort(timeoutError); };
    const totalTimer = setTimeout(timeout, this.timing.requestTimeoutMs);
    totalTimer.unref();
    let idleTimer: NodeJS.Timeout | undefined;
    const progress = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(timeout, this.timing.idleTimeoutMs);
      idleTimer.unref();
    };
    progress();
    let checking = false;
    const recheck = setInterval(() => {
      if (checking || signal.aborted) return;
      checking = true;
      void this.accessGuard.validate(job).catch((error: unknown) => {
        authorizationError = error;
        authorization.abort(error);
      }).finally(() => { checking = false; });
    }, 2_000);
    recheck.unref();
    try {
      this.store.files.updateJobState(jobId, "accepted", "starting", this.now());
      this.store.files.updateAttempt(attemptId, "planned", "creating", this.now());
      const containerId = await within(this.runtime.createFileHelper(spec), this.timing.connectTimeoutMs);
      created = true;
      this.store.files.updateAttempt(attemptId, "creating", "created", this.now(), containerId);
      signal.throwIfAborted();
      await this.accessGuard.validate(job);
      this.store.files.updateJobState(jobId, "starting", "running", this.now());
      process = await this.runtime.startFileHelper(spec, signal);
      this.store.files.updateAttempt(attemptId, "created", "running", this.now());
      startupTimer = setTimeout(timeout, this.timing.helperTimeoutMs);
      startupTimer.unref();
      let releaseUpload!: () => void;
      let rejectUpload!: (error: unknown) => void;
      const uploadReady = input.kind === "PUT" ? new Promise<void>((resolve, reject) => {
        releaseUpload = resolve; rejectUpload = reject;
      }) : undefined;
      void uploadReady?.catch(() => undefined);
      const requestInput = { ...input, signal };
      const sender = this.sendRequest(process, job, requestInput, uploadReady, progress).catch((error: unknown) => {
        streamError ??= error;
        process?.abort();
        throw error;
      });
      const receiver = this.receiveResponse(process, job, requestInput, releaseUpload, progress,
        () => { clearTimeout(startupTimer); startupTimer = undefined; }).catch((error: unknown) => {
        streamError = error;
        rejectUpload?.(error);
        process?.abort();
        throw error;
      });
      const [result] = await Promise.all([receiver, sender]);
      process.stdin.end();
      await process.completed;
      completedResult = result;
      const stopped = await this.runtime.inspectFileHelper(spec);
      if (!stopped || stopped.running || stopped.exitCode !== 0) throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
      this.store.files.updateAttempt(attemptId, "running", "exited", this.now());
      try { await this.runtime.removeFileHelper(spec); }
      catch (error) { removalFailedAfterResult = true; throw error; }
      this.store.files.updateAttempt(attemptId, "exited", "removed", this.now());
      if (result.status === 207 && this.store.files.listTemporaries(jobId).length > 0) {
        const state = this.store.files.getJob(jobId)!.state;
        this.store.files.updateJobState(jobId, state, "cleanup-pending", this.now(), "FILE_CLEANUP_REQUIRED");
        if (!(await this.recover(jobId))) throw new WorkFileExecutionError("FILE_CLEANUP_REQUIRED");
        return result;
      }
      for (const temporary of this.store.files.listTemporaries(jobId))
        this.store.files.markTemporary(temporary.id, jobId, "published", this.now());
      const state = this.store.files.getJob(jobId)!.state;
      this.store.files.updateJobState(jobId, state, "finished", this.now());
      this.store.files.markCleaned(jobId, this.now());
      signal.throwIfAborted();
      return result;
    } catch (error) {
      process?.abort();
      if (process) await process.completed.catch(() => undefined);
      let removed = false;
      if (created) {
        try {
          await this.runtime.stopFileHelper(spec);
          const current = await this.runtime.inspectFileHelper(spec);
          if (current && !current.running) {
            const state = this.store.files.listAttempts(jobId)[0]?.state;
            if (state && state !== "exited" && state !== "removed") this.store.files.updateAttempt(attemptId, state, "exited", this.now());
          }
          await this.runtime.removeFileHelper(spec);
          const state = this.store.files.listAttempts(jobId)[0]?.state;
          if (state && state !== "removed") this.store.files.updateAttempt(attemptId, state, "removed", this.now());
          removed = true;
        } catch { /* Retain exact journal identity for recovery. */ }
      }
      const current = this.store.files.getJob(jobId);
      if (current && current.state !== "cleaned" && current.state !== "cleanup-pending") {
        const cause = authorizationError ?? timeoutError ?? streamError ?? error;
        const code = cause instanceof WorkFileExecutionError ? cause.code : "FILE_BACKEND_PROTOCOL_ERROR";
        this.store.files.updateJobState(jobId, current.state, "cleanup-pending", this.now(), code);
        if (removed && this.store.files.listTemporaries(jobId).length === 0) {
          this.store.files.markCleaned(jobId, this.now());
        }
      }
      if (this.store.files.getJob(jobId)?.state === "cleanup-pending") await this.recover(jobId);
      if (removalFailedAfterResult) {
        if (this.store.files.getJob(jobId)?.state === "cleaned" && completedResult && !signal.aborted)
          return completedResult;
        throw new WorkFileExecutionError("FILE_CLEANUP_REQUIRED");
      }
      throw authorizationError ?? timeoutError ?? streamError ?? error;
    } finally {
      clearInterval(recheck);
      clearTimeout(totalTimer);
      clearTimeout(idleTimer);
      clearTimeout(startupTimer);
    }
  }

  private async recover(jobId: string): Promise<boolean> {
    const { WorkFileRecovery } = await import("./recovery.js");
    return new WorkFileRecovery(this.store, this.runtime, this.installationId, this.now).recoverJob(jobId);
  }

  private async sendRequest(process: DockerStreamProcess, job: WorkFileJobRecord, input: WorkFileExecutionInput,
    uploadReady?: Promise<void>, progress?: () => void): Promise<void> {
    const request = { version: 1, jobId: job.id, workId: job.workId, epoch: job.workEpoch,
      action: input.kind, pathSegments: [...input.pathSegments],
      destinationSegments: input.destinationSegments === undefined ? null : [...input.destinationSegments],
      depth: input.depth ?? null, overwrite: input.overwrite ?? null, conditions: input.conditions,
      range: input.range ?? null, expectedLength: input.expectedLength ?? null };
    await writeFrame(process.stdin, encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.REQUEST, request));
    progress?.();
    if (input.kind !== "PUT") return;
    if (input.body === undefined) throw new WorkFileExecutionError("FILE_REQUEST_INVALID");
    await uploadReady;
    const iterator = input.body[Symbol.asyncIterator]();
    try {
      while (true) {
        const part = await nextChunk(iterator, input.signal);
        if (part.done) break;
        input.signal?.throwIfAborted();
        const bytes = Buffer.from(part.value);
        for (let offset = 0; offset < bytes.length; offset += FILE_HELPER_MAX_DATA_BYTES) {
          await writeFrame(process.stdin, encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.DATA_TO_HELPER,
            bytes.subarray(offset, offset + FILE_HELPER_MAX_DATA_BYTES)));
          progress?.();
        }
      }
    } catch (error) {
      void Promise.resolve(iterator.return?.()).catch(() => undefined);
      throw error;
    }
    await writeFrame(process.stdin, encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.END, {}));
    progress?.();
  }

  private async receiveResponse(process: DockerStreamProcess, job: WorkFileJobRecord,
    input: WorkFileExecutionInput, releaseUpload?: () => void, progress?: () => void,
    onFirstFrame?: () => void): Promise<WorkFileExecutionResult> {
    const failures: { code: FileErrorCode; pathSegments: readonly string[] | null }[] = [];
    let result: { status: number; bytes: number; entries: number } | undefined;
    for await (const frame of parseFrames(process.stdout)) {
      onFirstFrame?.(); onFirstFrame = undefined;
      input.signal?.throwIfAborted();
      progress?.();
      if (result !== undefined) throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
      switch (frame.kind) {
        case FILE_HELPER_FRAME_KIND.META:
          if (!Check(FileHelperMetaSchema, frame.payload)) throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
          await input.onMeta?.(frame.payload);
          break;
        case FILE_HELPER_FRAME_KIND.DATA_FROM_HELPER:
          await input.onData?.(frame.payload as Buffer);
          break;
        case FILE_HELPER_FRAME_KIND.PREPARED: {
          if (!Check(FileHelperPreparedSchema, frame.payload)) throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
          const prepared = frame.payload;
          if (prepared.epoch !== job.workEpoch) throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
          await this.accessGuard.validate(job);
          if (prepared.phase === "temporary") {
            if (prepared.temporaryId === null || prepared.name === null) throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
            if (prepared.device === null || prepared.inode === null) {
              this.store.files.insertTemporary({ id: prepared.temporaryId, jobId: job.id,
                parentSegmentsJson: JSON.stringify(prepared.parentSegments), name: prepared.name,
                device: null, inode: null, state: "planned", createdAt: this.now(), updatedAt: this.now() });
            } else {
              const recorded = this.store.files.listTemporaries(job.id).find((item) => item.id === prepared.temporaryId);
              if (!recorded || recorded.parentSegmentsJson !== JSON.stringify(prepared.parentSegments) || recorded.name !== prepared.name)
                throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
              this.store.files.confirmTemporary(recorded.id, job.id, prepared.device, prepared.inode, this.now());
            }
          } else {
            this.store.files.authorizeCommit(job.id, job.workEpoch, this.now());
          }
          const ack = { epoch: job.workEpoch, phase: prepared.phase, temporaryId: prepared.temporaryId };
          if (!Check(FileHelperAckSchema, ack)) throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
          await within(writeFrame(process.stdin, encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.ACK, ack)),
            this.timing.helperTimeoutMs);
          if (input.kind === "PUT" && prepared.phase === "temporary" && prepared.device !== null)
            releaseUpload?.();
          break;
        }
        case FILE_HELPER_FRAME_KIND.ERROR:
          if (!Check(FileHelperErrorSchema, frame.payload)) throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
          failures.push(frame.payload as { code: FileErrorCode; pathSegments: readonly string[] | null });
          break;
        case FILE_HELPER_FRAME_KIND.RESULT:
          if (!Check(FileHelperResultSchema, frame.payload)) throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
          result = frame.payload;
          break;
        default:
          throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
      }
    }
    if (result === undefined) {
      if (failures.length === 1) throw new WorkFileExecutionError(failures[0]!.code);
      throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
    }
    if (result.status === 207 ? failures.length > 0 && result.entries !== failures.length : failures.length !== 0)
      throw new WorkFileExecutionError("FILE_BACKEND_PROTOCOL_ERROR");
    return { ...result, failures };
  }
}
