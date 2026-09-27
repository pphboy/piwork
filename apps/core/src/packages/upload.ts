import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { CoreStore } from "@piwork/core-store";
import { extractPiPackageZip, PiPackageInputError, PI_PACKAGE_LIMITS } from "@piwork/pi-package";

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

export async function receivePiPackageUpload(input: {
  readonly request: IncomingMessage;
  readonly store: CoreStore;
  readonly dataDirectory: string;
  readonly actorId: string;
  readonly scope: { readonly kind: "core" } | { readonly kind: "work"; readonly workId: string };
  readonly now?: Date;
}): Promise<{ uploadId: string; expiresAt: string }> {
  const { request } = input;
  if (header(request, "content-type") !== "application/zip") throw new PiPackageInputError("PI_PACKAGE_UNSUPPORTED_MEDIA_TYPE", "package upload requires application/zip");
  const lengthText = header(request, "content-length"), expectedDigest = header(request, "x-piwork-sha256");
  const sourceKind = header(request, "x-piwork-package-source"), encodedName = header(request, "x-piwork-package-name");
  const length = Number(lengthText);
  if (!lengthText || !/^[0-9]+$/.test(lengthText) || !Number.isSafeInteger(length) || length <= 0 ||
      !expectedDigest || !/^[a-f0-9]{64}$/.test(expectedDigest) ||
      (sourceKind !== "local" && sourceKind !== "zip") || !encodedName) {
    throw new PiPackageInputError("PI_PACKAGE_INVALID_SOURCE", "package upload headers are invalid");
  }
  if (length > PI_PACKAGE_LIMITS.compressedBytes) throw new PiPackageInputError("PI_PACKAGE_LIMIT_EXCEEDED", "package ZIP exceeds 256 MiB");
  let displayName: string;
  try { displayName = decodeURIComponent(encodedName); }
  catch { throw new PiPackageInputError("PI_PACKAGE_INVALID_SOURCE", "package display name is invalid"); }
  if (!displayName || Buffer.byteLength(displayName) > 255 || displayName === "." || displayName === ".." ||
      displayName.includes("/") || displayName.includes("\\") || displayName.includes("\0")) {
    throw new PiPackageInputError("PI_PACKAGE_INVALID_SOURCE", "package display name is invalid");
  }
  const directory = join(input.dataDirectory, "pi-packages", "uploads");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const uploadId = `upload-${randomUUID()}`;
  const staging = join(directory, `${uploadId}.staging`), finalPath = join(directory, `${uploadId}.zip`);
  const inspectionRoot = join(directory, `${uploadId}.inspection`);
  let bytes = 0;
  const hash = createHash("sha256");
  let idleTimer: NodeJS.Timeout | undefined;
  const timeoutError = () => request.destroy(new PiPackageInputError("PI_PACKAGE_INVALID_SOURCE", "package upload timed out"));
  const resetIdle = () => { if (idleTimer) clearTimeout(idleTimer); idleTimer = setTimeout(timeoutError, 60_000); };
  const totalTimer = setTimeout(timeoutError, 30 * 60_000);
  try {
    resetIdle();
    const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > length || bytes > PI_PACKAGE_LIMITS.compressedBytes) callback(new PiPackageInputError("PI_PACKAGE_LIMIT_EXCEEDED", "package upload length exceeded"));
      else { hash.update(chunk); resetIdle(); callback(null, chunk); }
    } });
    await pipeline(request, meter, createWriteStream(staging, { flags: "wx", mode: 0o600 }));
    if (bytes !== length || hash.digest("hex") !== expectedDigest) throw new PiPackageInputError("PI_PACKAGE_INVALID_SOURCE", "package upload length or digest mismatch");
    await extractPiPackageZip(staging, inspectionRoot);
    await rm(inspectionRoot, { recursive: true, force: true });
    await rename(staging, finalPath);
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60_000).toISOString();
    input.store.packages.insertUpload({ id: uploadId, actorId: input.actorId, scopeKind: input.scope.kind,
      workId: input.scope.kind === "work" ? input.scope.workId : null, sourceKind, displayName,
      digest: `sha256:${expectedDigest}`, size: bytes, state: "ready", expiresAt, leaseCount: 0, createdAt: now.toISOString() });
    return { uploadId, expiresAt };
  } catch (error) {
    await Promise.allSettled([rm(staging, { force: true }), rm(finalPath, { force: true }), rm(inspectionRoot, { recursive: true, force: true })]);
    throw error;
  } finally {
    clearTimeout(totalTimer);
    if (idleTimer) clearTimeout(idleTimer);
  }
}
