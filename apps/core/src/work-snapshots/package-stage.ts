import { createReadStream, constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { WorkPackageValidationError } from "@piwork/contracts";
import { readWorkPackage, validatePiPackageContentDigests, WorkBlobDirectory, WORK_PACKAGE_LIMITS, type VerifiedWorkPackage } from "@piwork/work-package";

/** Re-hash a ready package while materializing its blobs in a private, job-owned spool. */
export async function stageVerifiedPackage(input: {
  readonly packagePath: string; readonly spoolDirectory: string;
  readonly expectedDigest: string; readonly expectedSize: number; readonly signal?: AbortSignal;
}): Promise<{ readonly verified: VerifiedWorkPackage; readonly blobs: WorkBlobDirectory }> {
  const { packagePath, spoolDirectory, expectedDigest, expectedSize, signal } = input;
  if (!/^[a-f0-9]{64}$/.test(expectedDigest) || !Number.isSafeInteger(expectedSize) || expectedSize < 0)
    throw new WorkPackageValidationError("PACKAGE_INVALID", "package.record");
  await mkdir(spoolDirectory, { recursive: true, mode: 0o700 });
  const blobs = new WorkBlobDirectory(spoolDirectory);
  const descriptor = await open(packagePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await descriptor.stat();
    if (!stat.isFile() || stat.size !== expectedSize) throw new WorkPackageValidationError("PACKAGE_INVALID", "package.size");
    const stream = createReadStream(packagePath, { fd: descriptor.fd, autoClose: false, highWaterMark: WORK_PACKAGE_LIMITS.streamChunkBytes });
    const verified = await readWorkPackage(stream, { signal, onBlob: async (blob, chunks) => {
      const staged = await blobs.put(chunks, blob.size, signal);
      if (staged.digest !== blob.digest || staged.size !== blob.size) throw new WorkPackageValidationError("PACKAGE_INVALID", "package.blob");
    } });
    if (verified.digest !== expectedDigest || verified.size !== expectedSize) throw new WorkPackageValidationError("PACKAGE_INVALID", "package.digest");
    await validatePiPackageContentDigests(verified.spec, verified.metadata, (digest) => blobs.read(digest));
    const after = await descriptor.stat();
    if (after.dev !== stat.dev || after.ino !== stat.ino || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
      throw new WorkPackageValidationError("PACKAGE_INVALID", "package.changed");
    return { verified, blobs };
  } finally { await descriptor.close(); }
}
