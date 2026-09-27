import { constants, type BigIntStats } from "node:fs";
import { lstat, open, readdir, readlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { WorkPackageValidationError } from "@piwork/contracts";
import { encodeWorkJson, type WorkBlobDirectory, type WorkTree, WORK_PACKAGE_LIMITS } from "@piwork/work-package";

function unsupported(): never { throw new WorkPackageValidationError("PACKAGE_INVALID", "context.skillsTree"); }
function same(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid && a.gid === b.gid
    && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
function fields(info: BigIntStats, segments: readonly Buffer[]) {
  const uid = Number(info.uid), gid = Number(info.gid), mode = Number(info.mode & 0o7777n);
  if (!Number.isSafeInteger(uid) || uid < 0 || uid > 0xffffffff || !Number.isSafeInteger(gid) || gid < 0 || gid > 0xffffffff) unsupported();
  return { segmentsBase64: segments.map((part) => part.toString("base64")), uid, gid, mode, mtimeNs: info.mtimeNs.toString() };
}
function childPath(parent: string | Buffer, child: Buffer): Buffer {
  return Buffer.concat([Buffer.isBuffer(parent) ? parent : Buffer.from(parent), Buffer.from("/"), child]);
}
function bytePath(entry: WorkTree["entries"][number]): Buffer {
  return Buffer.concat(entry.segmentsBase64.flatMap((part, index) => index === 0 ? [Buffer.from(part, "base64")] : [Buffer.from("/"), Buffer.from(part, "base64")]));
}

/** Context Skills are Core-owned immutable files, not an arbitrary host tree. */
export async function captureOwnedSkillTree(directory: string, blobs: WorkBlobDirectory, signal?: AbortSignal): Promise<{ digest: string; size: number; entries: number }> {
  return captureOwnedTree(directory, blobs, false, signal);
}

/** Pi package trees may include safe relative dependency symlinks. */
export async function captureOwnedPackageTree(directory: string, blobs: WorkBlobDirectory, signal?: AbortSignal): Promise<{ digest: string; size: number; entries: number }> {
  return captureOwnedTree(directory, blobs, true, signal);
}

async function captureOwnedTree(directory: string, blobs: WorkBlobDirectory, allowSymlinks: boolean, signal?: AbortSignal): Promise<{ digest: string; size: number; entries: number }> {
  const entries: WorkTree["entries"] = [];
  const walk = async (path: string | Buffer, segments: Buffer[]): Promise<void> => {
    signal?.throwIfAborted();
    const before = await lstat(path, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink()) unsupported();
    entries.push({ type: "directory", ...fields(before, segments) });
    if (entries.length > WORK_PACKAGE_LIMITS.entries) throw new WorkPackageValidationError("PACKAGE_LIMIT_EXCEEDED", "context.entries");
    const children = await readdir(path, { encoding: "buffer" });
    children.sort(Buffer.compare);
    for (const name of children) {
      signal?.throwIfAborted();
      const nextSegments = [...segments, name], nextPath = childPath(path, name);
      if (nextSegments.length > WORK_PACKAGE_LIMITS.depth || Buffer.concat(nextSegments).length + nextSegments.length - 1 > WORK_PACKAGE_LIMITS.pathBytes) throw new WorkPackageValidationError("PACKAGE_LIMIT_EXCEEDED", "context.path");
      const initial = await lstat(nextPath, { bigint: true });
      if (initial.isDirectory() && !initial.isSymbolicLink()) await walk(nextPath, nextSegments);
      else if (initial.isFile() && !initial.isSymbolicLink()) {
        const size = Number(initial.size);
        if (!Number.isSafeInteger(size) || size > WORK_PACKAGE_LIMITS.restoredBytes) throw new WorkPackageValidationError("PACKAGE_LIMIT_EXCEEDED", "context.file");
        const file = await open(nextPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          if (!same(initial, await file.stat({ bigint: true }))) unsupported();
          const stored = await blobs.put(file.createReadStream({ autoClose: false, highWaterMark: WORK_PACKAGE_LIMITS.streamChunkBytes }), size, signal);
          if (stored.size !== size || !same(initial, await file.stat({ bigint: true })) || !same(initial, await lstat(nextPath, { bigint: true }))) unsupported();
          entries.push({ type: "file", ...fields(initial, nextSegments), blob: stored.digest, size });
        } finally { await file.close(); }
      } else if (allowSymlinks && initial.isSymbolicLink()) {
        const target = await readlink(nextPath, { encoding: "buffer" });
        if (target.length === 0 || target.length > WORK_PACKAGE_LIMITS.pathBytes || target.includes(0) || !(await lstat(nextPath, { bigint: true })).isSymbolicLink()) unsupported();
        entries.push({ type: "symlink", ...fields(initial, nextSegments), targetBase64: target.toString("base64") });
      } else unsupported();
      if (entries.length > WORK_PACKAGE_LIMITS.entries) throw new WorkPackageValidationError("PACKAGE_LIMIT_EXCEEDED", "context.entries");
    }
    if (!same(before, await lstat(path, { bigint: true }))) unsupported();
  };
  await walk(directory, []);
  entries.sort((a, b) => Buffer.compare(bytePath(a), bytePath(b)));
  const metadata = encodeWorkJson({ version: 1, entries });
  if (metadata.length > WORK_PACKAGE_LIMITS.metadataBytes) throw new WorkPackageValidationError("PACKAGE_LIMIT_EXCEEDED", "context.tree");
  const stored = await blobs.put(Readable.from([metadata]), metadata.length, signal);
  return { digest: stored.digest, size: stored.size, entries: entries.length };
}
