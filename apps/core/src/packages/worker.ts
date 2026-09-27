import { createHash } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Check } from "typebox/value";
import { PiPackageArtifactMetadataSchema, PiPackageSourceSchema, type PiPackageArtifactMetadata, type PiPackagePreparedEnvironment, type PiPackageSource } from "@piwork/contracts";
import { type CoreStore, type PiPackageJobRecord, PiPackageStoreError } from "@piwork/core-store";
import { assertPiPackageEnvironment, extractPiPackageZip, PiPackageInputError, validatePiPackageArtifact } from "@piwork/pi-package";
import type { PiPackagePreparationRuntime } from "./prepare.js";
import { PiPackageCleanupPendingError, preparePiPackage, type PiPackagePreparationResult } from "./prepare.js";

export interface PiPackageWorkerOptions {
  readonly store: CoreStore;
  readonly runtime: PiPackagePreparationRuntime;
  readonly installationId: string;
  readonly dataDirectory: string;
  readonly now?: () => Date;
  readonly capacity?: number;
  readonly publishWork?: (job: PiPackageJobRecord, metadata: PiPackageArtifactMetadata, artifactDirectory: string) => Promise<void>;
}

function safeFailure(stage: string, error: unknown): string {
  const reportedCode = (error as { code?: unknown } | null)?.code;
  const code = error instanceof PiPackageStoreError || error instanceof PiPackageInputError ? error.code
    : error instanceof PiPackageCleanupPendingError ? "PI_PACKAGE_CLEANUP_PENDING"
    : reportedCode === "PI_PACKAGE_NAME_MISMATCH" ? "PI_PACKAGE_NAME_MISMATCH"
    : reportedCode === "PI_PACKAGE_SOURCE_FETCH_FAILED" || reportedCode === "PI_PACKAGE_DEPENDENCY_INSTALL_FAILED" ? reportedCode
    : "PI_PACKAGE_PREPARATION_FAILED";
  const message = code === "PI_PACKAGE_SOURCE_FETCH_FAILED" ? "Package source fetch failed"
    : code === "PI_PACKAGE_DEPENDENCY_INSTALL_FAILED" ? "Package dependency installation failed"
    : code === "PI_PACKAGE_PREPARATION_FAILED" ? "Package preparation failed" : code.replaceAll("_", " ");
  return JSON.stringify({ stage, code, message });
}

function digestFile(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }

/** Drains durable jobs with a process-wide capacity of two. The database owns scope exclusion. */
export class PiPackageWorker {
  private readonly running = new Set<string>();
  private readonly inFlight = new Set<Promise<void>>();
  private readonly shutdownSignal = new AbortController();
  private stopping = false;
  private draining = false;
  private kickPending = false;
  private readonly now: () => Date;
  private readonly capacity: number;
  constructor(private readonly options: PiPackageWorkerOptions) {
    this.now = options.now ?? (() => new Date());
    this.capacity = options.capacity ?? 2;
    if (!Number.isInteger(this.capacity) || this.capacity < 1 || this.capacity > 2) throw new RangeError("package preparation capacity must be one or two");
  }

  get activeCount(): number { return this.running.size; }

  /** A restarted Core never reruns an already-started installation script. */
  async recover(): Promise<void> {
    for (const job of this.options.store.packages.listJobs().filter((item) => ["succeeded", "failed", "superseded"].includes(item.phase))) {
      const jobRoot = join(this.options.dataDirectory, "pi-packages", "jobs", job.operationId);
      let rootExists = false;
      try { await lstat(jobRoot); rootExists = true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (job.helperId === null && !rootExists) {
        this.options.store.packages.releaseTerminalJobLeases(job.operationId);
        continue;
      }
      if (job.helperId !== null) await this.options.runtime.removePiPackageHelper(job.helperId, job.operationId);
      await this.options.runtime.removePiPackageResources(job.operationId);
      await rm(jobRoot, { recursive: true, force: true });
      this.options.store.packages.releaseTerminalJobLeases(job.operationId);
    }
    for (const job of this.options.store.packages.listJobs(true).filter((item) => item.phase !== "queued")) {
      const jobRoot = join(this.options.dataDirectory, "pi-packages", "jobs", job.operationId);
      let cleanupError: unknown;
      try {
        if (job.helperId) await this.options.runtime.removePiPackageHelper(job.helperId, job.operationId);
        await this.options.runtime.removePiPackageResources(job.operationId);
      } catch (error) { cleanupError = error; }
      if (cleanupError === undefined && job.phase !== "cleanup-pending") {
        try {
          const source = JSON.parse(job.sourceJson) as { kind?: unknown };
          if (job.scopeKind === "work" && source.kind === "core") {
            await this.runJob(job);
            continue;
          }
          if (["prepare", "validate", "publish"].includes(job.phase)) {
            const captured = JSON.parse(await readFile(join(jobRoot, "spool", "result.json"), "utf8")) as Record<string, unknown>;
            if (!Check(PiPackageArtifactMetadataSchema, captured.metadata) ||
                typeof captured.zipSha256 !== "string" || !/^[a-f0-9]{64}$/.test(captured.zipSha256) ||
                !Number.isSafeInteger(captured.zipBytes) || Number(captured.zipBytes) <= 0) throw new Error("capture evidence is incomplete");
            await this.publishCaptured(job, { metadata: captured.metadata, artifactZip: join(jobRoot, "spool", "artifact.zip"),
              zipBytes: captured.zipBytes as number, zipSha256: captured.zipSha256 });
            await rm(jobRoot, { recursive: true, force: true });
            continue;
          }
        } catch { /* Incomplete or invalid capture evidence cannot justify publication. */ }
      }
      try {
        this.options.store.packages.finishJob(job.operationId, job.workerEpoch,
          cleanupError === undefined ? "failed" : "cleanup-pending", this.now().toISOString(),
          JSON.stringify({ stage: job.phase, code: cleanupError === undefined ? "PI_PACKAGE_INTERRUPTED" : "PI_PACKAGE_CLEANUP_PENDING",
            message: cleanupError === undefined ? "Package preparation was interrupted by Core restart" : "Package cleanup is pending" }));
      } catch (error) {
        if (!(error instanceof PiPackageStoreError && error.code === "PI_PACKAGE_STALE_JOB")) throw error;
      }
      if (cleanupError === undefined) {
        await rm(jobRoot, { recursive: true, force: true });
      }
    }
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    this.shutdownSignal.abort(new Error("Core is shutting down"));
    await Promise.allSettled([...this.inFlight]);
  }

  kick(): void {
    if (this.stopping) return;
    if (this.draining) { this.kickPending = true; return; }
    this.draining = true;
    void (async () => {
      try {
        while (this.options.store.packages.listJobs(true).some((job) => job.phase === "queued")) {
          const before = this.options.store.packages.listJobs(true).filter((job) => job.phase === "queued").length;
          await this.drainOnce();
          const after = this.options.store.packages.listJobs(true).filter((job) => job.phase === "queued").length;
          if (after >= before && this.running.size === 0) break;
          if (this.running.size > 0 && after >= before) break;
        }
      } catch { /* unexpected worker faults remain visible in durable job state for restart recovery */ }
      finally {
        this.draining = false;
        if (this.kickPending) { this.kickPending = false; this.kick(); }
      }
    })();
  }

  /** Start eligible queued jobs and return after the jobs admitted by this call settle. */
  async drainOnce(): Promise<void> {
    if (this.stopping) return;
    const available = this.capacity - this.running.size;
    if (available <= 0) return;
    const jobs = this.options.store.packages.listJobs(true).filter((job) => job.phase === "queued" && !this.running.has(job.operationId)).slice(0, available);
    await Promise.all(jobs.map((job) => {
      const run = (async () => {
      this.running.add(job.operationId);
      try { await this.runJob(job); }
      finally { this.running.delete(job.operationId); }
      })();
      this.inFlight.add(run);
      void run.then(() => this.inFlight.delete(run), () => this.inFlight.delete(run));
      return run;
    }));
  }

  private async runJob(job: PiPackageJobRecord): Promise<void> {
    let stage = "source", cleanupPending = false;
    const jobRoot = join(this.options.dataDirectory, "pi-packages", "jobs", job.operationId);
    const sourceDirectory = join(jobRoot, "source"), spoolDirectory = join(jobRoot, "spool");
    const now = () => this.now().toISOString();
    try {
      this.options.store.packages.advanceJob(job.operationId, job.workerEpoch, "source", now());
      await mkdir(sourceDirectory, { recursive: true, mode: 0o755 });
      await mkdir(spoolDirectory, { recursive: true, mode: 0o700 });
      const source = JSON.parse(job.sourceJson) as unknown;
      if (job.scopeKind === "work" && source !== null && typeof source === "object" && (source as { kind?: unknown }).kind === "core") {
        const selected = source as { name?: unknown; artifactId?: unknown };
        if (typeof selected.name !== "string" || typeof selected.artifactId !== "string") throw new PiPackageInputError("PI_PACKAGE_INVALID_SOURCE", "invalid captured Core package source");
        const artifact = this.options.store.packages.getArtifact(selected.artifactId);
        if (!artifact || artifact.scopeKind !== "core" || artifact.name !== selected.name) throw new PiPackageStoreError("PI_PACKAGE_NOT_FOUND", "captured Core package is unavailable");
        const metadata = JSON.parse(artifact.metadataJson) as unknown;
        if (!Check(PiPackageArtifactMetadataSchema, metadata) || metadata.name !== selected.name) throw new Error("Core package artifact is invalid");
        assertPiPackageEnvironment(JSON.parse(job.preparedEnvironmentJson) as PiPackagePreparedEnvironment, metadata.preparedEnvironment);
        await validatePiPackageArtifact({ root: artifact.storagePath, sourceKind: metadata.sourceKind,
          resolvedSource: metadata.resolvedSource, preparedEnvironment: metadata.preparedEnvironment, expectedDigest: metadata.contentDigest });
        this.options.store.packages.advanceJob(job.operationId, job.workerEpoch, "validate", now(), { name: metadata.name });
        if (job.kind === "update" && metadata.name !== job.packageName) throw Object.assign(new Error("package name changed"), { code: "PI_PACKAGE_NAME_MISMATCH" });
        this.options.store.packages.advanceJob(job.operationId, job.workerEpoch, "publish", now());
        await this.publishWork(job, metadata, artifact.storagePath);
        return;
      }
      if (!Check(PiPackageSourceSchema, source)) throw new PiPackageInputError("PI_PACKAGE_INVALID_SOURCE", "invalid package source");
      const request = await this.materializeSource(job, source as PiPackageSource, sourceDirectory);
      await writeFile(join(sourceDirectory, "request.json"), JSON.stringify({ source: request }), { flag: "wx", mode: 0o644 });
      stage = "prepare";
      this.options.store.packages.advanceJob(job.operationId, job.workerEpoch, "prepare", now());
      const deadlineMs = Date.parse(job.deadlineAt) - this.now().getTime();
      if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) throw new Error("package preparation deadline expired");
      const preparedEnvironment = JSON.parse(job.preparedEnvironmentJson) as PiPackagePreparedEnvironment;
      const prepared = await preparePiPackage({ runtime: this.options.runtime, installationId: this.options.installationId,
        jobId: job.operationId, prepareImageId: job.prepareImageId, trustedHelperImageId: job.trustedHelperImageId,
        sourceDirectory, spoolDirectory, preparedEnvironment, signal: AbortSignal.any([AbortSignal.timeout(deadlineMs), this.shutdownSignal.signal]),
        onHelperPlanned: (name) => { this.options.store.packages.advanceJob(job.operationId, job.workerEpoch, "prepare", now(), { helperId: name }); } });
      stage = "validate";
      await this.publishCaptured(job, prepared);
    } catch (error) {
      cleanupPending = error instanceof PiPackageCleanupPendingError;
      try { this.options.store.packages.finishJob(job.operationId, job.workerEpoch, cleanupPending ? "cleanup-pending" : "failed", now(), safeFailure(stage, error)); }
      catch (stale) { if (!(stale instanceof PiPackageStoreError && stale.code === "PI_PACKAGE_STALE_JOB")) throw stale; }
    } finally {
      if (!cleanupPending) {
        await rm(jobRoot, { recursive: true, force: true });
        this.options.store.packages.releaseTerminalJobLeases(job.operationId);
      }
    }
  }

  private async publishCaptured(job: PiPackageJobRecord, prepared: PiPackagePreparationResult): Promise<void> {
      const now = () => this.now().toISOString();
      const jobRoot = join(this.options.dataDirectory, "pi-packages", "jobs", job.operationId);
      const preparedEnvironment = JSON.parse(job.preparedEnvironmentJson) as PiPackagePreparedEnvironment;
      assertPiPackageEnvironment(preparedEnvironment, prepared.metadata.preparedEnvironment);
      this.options.store.packages.advanceJob(job.operationId, job.workerEpoch, "validate", now(), { name: prepared.metadata.name, helperId: null });
      if (job.kind === "update" && prepared.metadata.name !== job.packageName) {
        throw Object.assign(new Error("package name changed"), { code: "PI_PACKAGE_NAME_MISMATCH" });
      }
      const bytes = await readFile(prepared.artifactZip);
      if (bytes.length !== prepared.zipBytes || digestFile(bytes) !== prepared.zipSha256) throw new Error("capture ZIP integrity mismatch");
      const digest = prepared.metadata.contentDigest;
      const artifactsDirectory = job.scopeKind === "core" ? join(this.options.dataDirectory, "pi-packages", "artifacts") : join(jobRoot, "artifacts");
      await mkdir(artifactsDirectory, { recursive: true, mode: 0o700 });
      const headPath = join(artifactsDirectory, digest.slice("sha256:".length));
      const staging = `${headPath}.stage-${job.operationId}`;
      await extractPiPackageZip(prepared.artifactZip, staging);
      const verified = await validatePiPackageArtifact({ root: staging, sourceKind: prepared.metadata.sourceKind,
        resolvedSource: prepared.metadata.resolvedSource, preparedEnvironment, expectedDigest: digest });
      if ((["extensions", "skills", "prompts", "themes"] as const).some((kind) =>
        verified.metadata.resourceCounts[kind] !== prepared.metadata.resourceCounts[kind])) throw new Error("capture inventory changed");
      try {
        await lstat(headPath);
        await validatePiPackageArtifact({ root: headPath, sourceKind: prepared.metadata.sourceKind,
          resolvedSource: prepared.metadata.resolvedSource, preparedEnvironment, expectedDigest: digest });
        await rm(staging, { recursive: true, force: true });
      }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await rename(staging, headPath); }
      this.options.store.packages.advanceJob(job.operationId, job.workerEpoch, "publish", now());
      if (job.scopeKind === "work") await this.publishWork(job, prepared.metadata, headPath);
      else {
        const resultJson = JSON.stringify({ name: prepared.metadata.name, version: prepared.metadata.version,
          resourceCounts: prepared.metadata.resourceCounts, scope: "core" });
        this.options.store.packages.publishCore(job.operationId, job.workerEpoch, { id: `core:${job.operationId}`, scopeKind: "core", workId: null,
          name: prepared.metadata.name, contentDigest: digest, metadataJson: JSON.stringify(prepared.metadata),
          storagePath: headPath, createdAt: now() }, now(), resultJson);
      }
  }

  private async publishWork(job: PiPackageJobRecord, metadata: PiPackageArtifactMetadata, artifactDirectory: string): Promise<void> {
    if (!this.options.publishWork) throw new Error("Work package publication is unavailable");
    await this.options.publishWork(job, metadata, artifactDirectory);
  }

  private async materializeSource(job: PiPackageJobRecord, source: PiPackageSource, sourceDirectory: string): Promise<Record<string, unknown>> {
    if (source.kind === "npm" || source.kind === "git") return { kind: source.kind, spec: source.spec };
    if (source.kind !== "upload") throw new PiPackageInputError("PI_PACKAGE_INVALID_SOURCE", "package source is invalid for preparation");
    const upload = this.options.store.packages.getUpload(source.uploadId);
    if (!upload || upload.id !== job.sourceUploadId || upload.actorId !== job.actorId || upload.scopeKind !== job.scopeKind
      || upload.workId !== job.workId || upload.state !== "ready") {
      throw new PiPackageInputError("PI_PACKAGE_INVALID_SOURCE", "package upload is unavailable");
    }
    const sourcePath = join(this.options.dataDirectory, "pi-packages", "uploads", `${upload.id}.zip`);
    const inputPath = join(sourceDirectory, "input.zip");
    await copyFile(sourcePath, inputPath);
    await chmod(inputPath, 0o644);
    const bytes = await readFile(inputPath);
    if (bytes.length !== upload.size || `sha256:${digestFile(bytes)}` !== upload.digest) throw new PiPackageInputError("PI_PACKAGE_INVALID_SOURCE", "package upload integrity mismatch");
    return { kind: upload.sourceKind, displayName: upload.displayName };
  }
}
