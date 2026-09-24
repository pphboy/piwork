import { spawn } from "node:child_process";
import { PassThrough, type Writable } from "node:stream";

export interface DockerStreamResult {
  readonly stderr: Buffer;
  readonly stderrTruncated: boolean;
}
export interface DockerStreamProcess {
  readonly stdin: Writable;
  readonly stdout: PassThrough;
  readonly completed: Promise<DockerStreamResult>;
  abort(): void;
}
export interface DockerStreamingRunner {
  spawn(args: readonly string[], options?: { readonly signal?: AbortSignal; readonly timeoutMs?: number }): DockerStreamProcess;
}
export class DockerStreamError extends Error {
  constructor(readonly code: "DOCKER_STREAM_FAILED" | "DOCKER_STREAM_ABORTED" | "DOCKER_STREAM_TIMEOUT", readonly exitCode: number | null = null) {
    super(code); this.name = "DockerStreamError";
  }
}

/** Separate from the legacy text runner: binary output is never collected in memory. */
export class DockerCliStreamingRunner implements DockerStreamingRunner {
  constructor(private readonly executable = "docker", private readonly stderrLimit = 64 * 1024) {
    if (!Number.isSafeInteger(stderrLimit) || stderrLimit < 0 || stderrLimit > 1024 * 1024) throw new RangeError("Invalid stderr limit");
  }
  spawn(args: readonly string[], options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {}): DockerStreamProcess {
    options.signal?.throwIfAborted();
    if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)) throw new RangeError("Invalid stream timeout");
    const child = spawn(this.executable, [...args], { stdio: ["pipe", "pipe", "pipe"], shell: false });
    const stdout = new PassThrough({ highWaterMark: 1024 * 1024 });
    const stderr: Buffer[] = []; let stderrBytes = 0, stderrTruncated = false;
    let failure: Error | undefined, closed = false;
    let killTimer: NodeJS.Timeout | undefined, timeout: NodeJS.Timeout | undefined;
    const abort = (error = new DockerStreamError("DOCKER_STREAM_ABORTED")) => {
      if (closed) return;
      failure ??= error;
      child.kill("SIGTERM");
      if (killTimer === undefined) {
        killTimer = setTimeout(() => { child.kill("SIGKILL"); }, 2000); killTimer.unref();
      }
      stdout.destroy(failure); child.stdin.destroy();
    };
    const onAbort = () => abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    if (options.timeoutMs !== undefined) { timeout = setTimeout(() => abort(new DockerStreamError("DOCKER_STREAM_TIMEOUT")), options.timeoutMs); timeout.unref(); }
    child.stdout.pipe(stdout);
    child.stdout.on("error", () => abort(new DockerStreamError("DOCKER_STREAM_FAILED")));
    child.stdin.on("error", () => abort(new DockerStreamError("DOCKER_STREAM_FAILED")));
    stdout.on("error", () => { /* completion is also rejected; avoid unhandled stream errors before consumption */ });
    stdout.on("close", () => { if (!stdout.readableEnded && !closed) abort(); });
    child.stderr.on("data", (chunk: Buffer) => {
      const keep = Math.min(chunk.length, this.stderrLimit - stderrBytes);
      if (keep > 0) stderr.push(Buffer.from(chunk.subarray(0, keep)));
      stderrBytes += keep; if (keep < chunk.length) stderrTruncated = true;
    });
    const completed = new Promise<DockerStreamResult>((resolve, reject) => {
      child.once("error", () => { failure ??= new DockerStreamError("DOCKER_STREAM_FAILED"); });
      child.once("close", (code) => {
        closed = true;
        clearTimeout(timeout); clearTimeout(killTimer);
        options.signal?.removeEventListener("abort", onAbort);
        if (code !== 0) failure ??= new DockerStreamError("DOCKER_STREAM_FAILED", code);
        if (failure !== undefined) { stdout.destroy(failure); reject(failure); }
        else resolve({ stderr: Buffer.concat(stderr, stderrBytes), stderrTruncated });
      });
    });
    void completed.catch(() => undefined);
    return { stdin: child.stdin, stdout, completed, abort: () => abort() };
  }
}
