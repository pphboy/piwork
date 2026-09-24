import { constants } from "node:fs";
import { open, link, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { WorkPackageValidationError } from "@piwork/contracts";
import { WORK_PACKAGE_LIMITS } from "./limits.js";

export interface ImageBlob { readonly digest: string; readonly size: number }
export interface ImageBlobStore {
  put(source: AsyncIterable<Uint8Array>, limit: number, signal?: AbortSignal): Promise<ImageBlob>;
  read(digest: string): AsyncIterable<Uint8Array>;
}

/** A caller-owned, private job directory. Archive paths never become host paths. */
export class WorkBlobDirectory implements ImageBlobStore {
  constructor(readonly directory: string) {}
  async put(source: AsyncIterable<Uint8Array>, limit: number, signal?: AbortSignal): Promise<ImageBlob> {
    const temporary = join(this.directory, `.partial-${randomUUID()}`);
    const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    let size = 0;
    const hash = createHash("sha256");
    try {
      for await (const input of source) {
        signal?.throwIfAborted(); size += input.byteLength;
        if (!Number.isSafeInteger(size) || size > limit) throw new WorkPackageValidationError("PACKAGE_LIMIT_EXCEEDED", "image.blob");
        hash.update(input);
        for (let offset = 0; offset < input.byteLength;) {
          const length = Math.min(WORK_PACKAGE_LIMITS.streamChunkBytes, input.byteLength - offset);
          const { bytesWritten } = await file.write(input, offset, length);
          if (bytesWritten === 0) throw new Error("BLOB_WRITE_FAILED");
          offset += bytesWritten;
        }
      }
      signal?.throwIfAborted(); await file.sync(); await file.close();
      const digest = hash.digest("hex");
      try { await link(temporary, join(this.directory, digest)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = createHash("sha256"); let existingSize = 0;
        for await (const chunk of this.read(digest)) { signal?.throwIfAborted(); existing.update(chunk); existingSize += chunk.byteLength; }
        if (existingSize !== size || existing.digest("hex") !== digest) throw new Error("BLOB_CONFLICT");
      }
      const parent = await open(this.directory, constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await parent.sync(); } finally { await parent.close(); }
      return { digest, size };
    } finally { await file.close(); await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
  }
  async *read(digest: string): AsyncGenerator<Buffer> {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new TypeError("Invalid blob identity");
    const file = await open(join(this.directory, digest), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (!(await file.stat()).isFile()) throw new Error("BLOB_NOT_REGULAR");
      while (true) {
        const chunk = Buffer.allocUnsafe(WORK_PACKAGE_LIMITS.streamChunkBytes);
        const { bytesRead } = await file.read(chunk);
        if (!bytesRead) break;
        yield chunk.subarray(0, bytesRead);
      }
    } finally { await file.close(); }
  }
}
