import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { packPiPackageDirectory } from "./local-zip.js";
import { PiPackageInputError, type ParsedPiPackageSource } from "./source.js";
import { inspectPiPackageZip, PI_PACKAGE_LIMITS } from "./zip.js";

export interface StagedPiPackageUpload {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly sourceKind: "local" | "zip";
  readonly displayName: string;
  cleanup(): Promise<void>;
}

/** Both local and ZIP inputs become the same length/digest-checked upload stream. */
export async function stagePiPackageUpload(source: Extract<ParsedPiPackageSource, { kind: "local" | "zip" }>, scratchRoot: string): Promise<StagedPiPackageUpload> {
  await mkdir(scratchRoot, { recursive: true, mode: 0o700 });
  const path = join(scratchRoot, `pi-package-${randomUUID()}.zip`);
  try {
    let bytes: number, sha256: string;
    if (source.kind === "local") {
      const packed = await packPiPackageDirectory(source.path, path);
      bytes = packed.bytes;
      sha256 = packed.digest;
    } else {
      const info = await stat(source.path);
      if (!info.isFile()) throw new PiPackageInputError("PI_PACKAGE_INVALID_SOURCE", "ZIP input must be a file");
      if (info.size > PI_PACKAGE_LIMITS.compressedBytes) throw new PiPackageInputError("PI_PACKAGE_LIMIT_EXCEEDED", "ZIP exceeds 256 MiB");
      const hash = createHash("sha256");
      bytes = 0;
      const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > PI_PACKAGE_LIMITS.compressedBytes) callback(new PiPackageInputError("PI_PACKAGE_LIMIT_EXCEEDED", "ZIP exceeds 256 MiB"));
        else { hash.update(chunk); callback(null, chunk); }
      } });
      await pipeline(createReadStream(source.path), meter, createWriteStream(path, { flags: "wx", mode: 0o600 }));
      sha256 = hash.digest("hex");
      await inspectPiPackageZip(path);
    }
    return { path, bytes, sha256, sourceKind: source.kind, displayName: source.displayName, cleanup: () => rm(path, { force: true }) };
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  }
}
