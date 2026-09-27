import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Check } from "typebox/value";
import { PiPackageArtifactMetadataSchema, type PiPackageArtifactMetadata, type PiPackagePreparedEnvironment } from "@piwork/contracts";
import { PI_PACKAGE_LIMITS, PiPackageInputError } from "@piwork/pi-package";
import type { PiPackageHelperSpec } from "@piwork/runtime-docker";

export interface PiPackagePreparationRuntime {
  ensurePiPackageResources(jobId: string): Promise<{ volumeName: string; networkName: string }>;
  removePiPackageResources(jobId: string): Promise<void>;
  createPiPackageHelper(spec: PiPackageHelperSpec): Promise<string>;
  startPiPackageHelper(name: string, jobId: string, signal?: AbortSignal): Promise<unknown>;
  measurePiPackageVolume(jobId: string, volumeName: string, trustedHelperImageId: string): Promise<number>;
  removePiPackageHelper(name: string, jobId: string): Promise<void>;
}

export interface PiPackagePreparationInput {
  readonly runtime: PiPackagePreparationRuntime;
  readonly installationId: string;
  readonly jobId: string;
  readonly prepareImageId: string;
  readonly trustedHelperImageId: string;
  readonly sourceDirectory: string;
  readonly spoolDirectory: string;
  readonly preparedEnvironment: PiPackagePreparedEnvironment;
  readonly signal?: AbortSignal;
  /** Persist ownership before Docker create so restart can inspect and clean it. */
  readonly onHelperPlanned?: (name: string, action: PiPackageHelperSpec["action"]) => void;
}

export interface PiPackagePreparationResult {
  readonly metadata: PiPackageArtifactMetadata;
  readonly artifactZip: string;
  readonly zipBytes: number;
  readonly zipSha256: string;
}

export class PiPackageCleanupPendingError extends Error {
  constructor() { super("package helper cleanup is pending"); this.name = "PiPackageCleanupPendingError"; }
}

/** Prepare may run third-party scripts; init and capture use only the trusted helper image. */
export async function preparePiPackage(input: PiPackagePreparationInput): Promise<PiPackagePreparationResult> {
  const { runtime, jobId } = input;
  const resources = await runtime.ensurePiPackageResources(jobId);
  const live = new Set<string>();
  let cleanupFailed = false;
  const execute = async (action: PiPackageHelperSpec["action"], suffix: string, imageId: string): Promise<unknown> => {
    input.signal?.throwIfAborted();
    const name = `piwork-pkg-${suffix}-${jobId}`;
    const spec: PiPackageHelperSpec = { installationId: input.installationId, jobId, name, imageId,
      volumeName: resources.volumeName, action,
      ...(action === "prepare" ? { sourceDirectory: input.sourceDirectory, networkName: resources.networkName } : {}),
      ...(action === "capture" ? { spoolDirectory: input.spoolDirectory } : {}) };
    input.onHelperPlanned?.(name, action);
    live.add(name);
    await runtime.createPiPackageHelper(spec);
    let result: unknown;
    if (action === "prepare") {
      const stopMonitoring = new AbortController(), stopPrepare = new AbortController();
      const signal = input.signal === undefined ? stopPrepare.signal : AbortSignal.any([input.signal, stopPrepare.signal]);
      let monitorFailure: unknown;
      const measure = async () => {
        const bytes = await runtime.measurePiPackageVolume(jobId, resources.volumeName, input.trustedHelperImageId);
        if (bytes > PI_PACKAGE_LIMITS.preparationBytes) {
          throw new PiPackageInputError("PI_PACKAGE_LIMIT_EXCEEDED", "package preparation exceeds 4 GiB");
        }
      };
      const monitoring = (async () => {
        while (!stopMonitoring.signal.aborted) {
          try {
            await measure();
            await delay(2_000, undefined, { signal: stopMonitoring.signal });
          } catch (error) {
            if (stopMonitoring.signal.aborted) return;
            monitorFailure = error;
            stopPrepare.abort();
            return;
          }
        }
      })();
      try {
        result = await runtime.startPiPackageHelper(name, jobId, signal);
      } catch (error) {
        if (monitorFailure !== undefined) throw monitorFailure;
        throw error;
      } finally {
        stopMonitoring.abort();
        await monitoring;
      }
      if (monitorFailure !== undefined) throw monitorFailure;
      await measure();
    } else result = await runtime.startPiPackageHelper(name, jobId, input.signal);
    await runtime.removePiPackageHelper(name, jobId);
    live.delete(name);
    return result;
  };
  try {
    await execute("init", "init", input.trustedHelperImageId);
    const prepared = await execute("prepare", "prepare", input.prepareImageId) as Record<string, unknown> | null;
    if (!prepared || !["npm", "git", "local", "zip"].includes(String(prepared.sourceKind)) ||
        typeof prepared.resolvedSource !== "string" || !prepared.resolvedSource ||
        typeof prepared.name !== "string" || (prepared.version !== null && typeof prepared.version !== "string")) {
      throw new Error("package prepare result is invalid");
    }
    await writeFile(join(input.spoolDirectory, "request.json"), JSON.stringify({ sourceKind: prepared.sourceKind,
      resolvedSource: prepared.resolvedSource, preparedEnvironment: input.preparedEnvironment }), { flag: "wx", mode: 0o600 });
    const captured = await execute("capture", "capture", input.trustedHelperImageId) as Record<string, unknown> | null;
    if (!captured || !Check(PiPackageArtifactMetadataSchema, captured.metadata) ||
        (captured.metadata as PiPackageArtifactMetadata).name !== prepared.name ||
        (captured.metadata as PiPackageArtifactMetadata).version !== prepared.version ||
        typeof captured.zipSha256 !== "string" || !/^[a-f0-9]{64}$/.test(captured.zipSha256) ||
        !Number.isSafeInteger(captured.zipBytes) || Number(captured.zipBytes) <= 0) {
      throw new Error("package capture result is invalid");
    }
    return { metadata: captured.metadata as PiPackageArtifactMetadata, artifactZip: join(input.spoolDirectory, "artifact.zip"),
      zipBytes: captured.zipBytes as number, zipSha256: captured.zipSha256 };
  } finally {
    for (const name of live) {
      try { await runtime.removePiPackageHelper(name, jobId); }
      catch { cleanupFailed = true; }
    }
    if (!cleanupFailed) {
      try { await runtime.removePiPackageResources(jobId); }
      catch { cleanupFailed = true; }
    }
    if (cleanupFailed) throw new PiPackageCleanupPendingError();
  }
}
