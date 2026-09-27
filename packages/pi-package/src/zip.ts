import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, realpath, rename, rm, stat, symlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import * as yauzl from "yauzl";
import { PiPackageInputError, parsePiPackageManifest, type PiPackageManifest } from "./source.js";

export const PI_PACKAGE_LIMITS = Object.freeze({
  compressedBytes: 256 * 1024 * 1024,
  restoredBytes: 1024 * 1024 * 1024,
  preparationBytes: 4 * 1024 * 1024 * 1024,
  fileBytes: 64 * 1024 * 1024,
  entries: 100_000,
  depth: 64,
  pathBytes: 4096,
  manifestBytes: 1024 * 1024,
});

type ZipEntry = { readonly original: string; readonly path: string; readonly type: "directory" | "file" | "symlink"; readonly size: number; readonly mode: number };
export interface PiPackageZipInspection { readonly prefix: string; readonly entries: readonly ZipEntry[]; readonly restoredBytes: number }

function unsafe(message: string): never { throw new PiPackageInputError("PI_PACKAGE_UNSAFE_ARCHIVE", message); }
function limit(message: string): never { throw new PiPackageInputError("PI_PACKAGE_LIMIT_EXCEEDED", message); }
function malformedZip(error: unknown): PiPackageInputError {
  return error instanceof PiPackageInputError ? error : new PiPackageInputError("PI_PACKAGE_UNSAFE_ARCHIVE", "ZIP structure is invalid");
}

function checkPath(path: string, directory: boolean): string {
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes("\0") || /^[A-Za-z]:/.test(path)) unsafe("ZIP contains an unsafe path");
  const normalized = directory ? path.slice(0, -1) : path;
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) unsafe("ZIP contains an unsafe path component");
  if (parts.length > PI_PACKAGE_LIMITS.depth) limit("ZIP path depth exceeds 64");
  if (Buffer.byteLength(normalized, "utf8") > PI_PACKAGE_LIMITS.pathBytes) limit("ZIP path exceeds 4096 bytes");
  return normalized;
}

async function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolveZip, reject) => yauzl.open(path, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
    (error, zip) => error ? reject(malformedZip(error)) : resolveZip(zip)));
}

async function eachZipEntry(path: string, visit: (entry: yauzl.Entry, zip: yauzl.ZipFile) => Promise<void>): Promise<void> {
  const zip = await openZip(path);
  let pendingError: Error | undefined;
  const recordError = (error: Error) => { pendingError = malformedZip(error); };
  zip.on("error", recordError);
  try {
    for (;;) {
      if (pendingError) throw pendingError;
      const entry = await new Promise<yauzl.Entry | null>((resolveEntry, reject) => {
        const onEntry = (item: yauzl.Entry) => { clean(); resolveEntry(item); };
        const onEnd = () => { clean(); resolveEntry(null); };
        const onError = (error: Error) => { clean(); reject(malformedZip(error)); };
        const clean = () => { zip.off("entry", onEntry); zip.off("end", onEnd); zip.off("error", onError); };
        zip.once("entry", onEntry);
        zip.once("end", onEnd);
        zip.once("error", onError);
        zip.readEntry();
      });
      if (entry === null) break;
      await visit(entry, zip);
    }
    if (pendingError) throw pendingError;
  } finally { zip.close(); }
}

export async function inspectPiPackageZip(zipPath: string): Promise<PiPackageZipInspection> {
  const zipStats = await stat(zipPath);
  if (!zipStats.isFile()) unsafe("ZIP source is not a regular file");
  if (zipStats.size > PI_PACKAGE_LIMITS.compressedBytes) limit("ZIP exceeds 256 MiB");
  const raw: Omit<ZipEntry, "path">[] = [];
  const seen = new Set<string>();
  let restoredBytes = 0;
  await eachZipEntry(zipPath, async (entry) => {
    if (raw.length >= PI_PACKAGE_LIMITS.entries) limit("ZIP exceeds 100000 entries");
    if (entry.isEncrypted() || (entry.generalPurposeBitFlag & 1) !== 0) unsafe("encrypted ZIP entries are unsupported");
    const directory = entry.fileName.endsWith("/");
    const path = checkPath(entry.fileName, directory);
    if (seen.has(path)) unsafe("ZIP contains duplicate paths");
    seen.add(path);
    const unixMode = entry.externalFileAttributes >>> 16;
    const typeBits = unixMode & 0o170000;
    const type = typeBits === 0o120000 ? "symlink" : directory ? "directory" : "file";
    if (typeBits !== 0 && ![0o100000, 0o040000, 0o120000].includes(typeBits)) unsafe("ZIP contains a special file");
    if ((typeBits === 0o040000 && !directory) || (typeBits === 0o100000 && directory)) unsafe("ZIP entry type disagrees with its path");
    if (type === "symlink" && directory) unsafe("ZIP symlink may not use a directory path");
    if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) unsafe("ZIP entry size is invalid");
    if (type === "directory" && entry.uncompressedSize !== 0) unsafe("ZIP directory contains data");
    if (type === "symlink" && entry.uncompressedSize > PI_PACKAGE_LIMITS.pathBytes) limit("ZIP symlink target is too long");
    if (type === "file" && entry.uncompressedSize > PI_PACKAGE_LIMITS.fileBytes) limit("ZIP file exceeds 64 MiB");
    restoredBytes += entry.uncompressedSize;
    if (!Number.isSafeInteger(restoredBytes) || restoredBytes > PI_PACKAGE_LIMITS.restoredBytes) limit("ZIP exceeds 1 GiB expanded size");
    raw.push({ original: entry.fileName, type, size: entry.uncompressedSize, mode: unixMode });
  });
  const paths = raw.map((item) => checkPath(item.original, item.type === "directory"));
  let prefix = "";
  if (!paths.includes("package.json")) {
    const candidates = paths.filter((path) => path.endsWith("/package.json") && path.split("/").length === 2);
    if (candidates.length !== 1) unsafe("ZIP requires one package root");
    prefix = candidates[0]!.slice(0, -"package.json".length);
    if (paths.some((path) => path !== prefix.slice(0, -1) && !path.startsWith(prefix))) unsafe("ZIP contains paths outside its package root");
  }
  const entries = raw.map((item, index) => ({ ...item, path: paths[index]!.startsWith(prefix) ? paths[index]!.slice(prefix.length) : "" })).filter((item) => item.path);
  const byPath = new Map(entries.map((item) => [item.path, item]));
  if (byPath.get("package.json")?.type !== "file") unsafe("ZIP package.json is missing or not a file");
  for (const item of entries) {
    const parts = item.path.split("/");
    for (let index = 1; index < parts.length; index++) {
      const parent = byPath.get(parts.slice(0, index).join("/"));
      if (parent && parent.type !== "directory") unsafe("ZIP contains an entry below a file or symlink");
    }
  }
  return { prefix, entries, restoredBytes };
}

async function openEntryStream(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolveStream, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolveStream(stream)));
}

/** Extract into a private staging directory, validate links and manifest, then publish once. */
export async function extractPiPackageZip(zipPath: string, outputRoot: string): Promise<{ manifest: PiPackageManifest; inspection: PiPackageZipInspection }> {
  const inspection = await inspectPiPackageZip(zipPath);
  const stage = `${outputRoot}.staging-${randomUUID()}`;
  await mkdir(stage, { recursive: true, mode: 0o700 });
  try {
    const expected = new Map(inspection.entries.map((item) => [item.original, item]));
    const links: Array<{ path: string; target: string }> = [];
    let total = 0;
    await eachZipEntry(zipPath, async (entry, zip) => {
      const item = expected.get(entry.fileName);
      if (!item) {
        if (entry.fileName === inspection.prefix.slice(0, -1)) return;
        unsafe("ZIP changed between inspection and extraction");
      }
      if (!item.path) return;
      if (entry.uncompressedSize !== item.size || (entry.externalFileAttributes >>> 16) !== item.mode) unsafe("ZIP changed between inspection and extraction");
      const destination = join(stage, item.path);
      if (item.type === "directory") { await mkdir(destination, { recursive: true, mode: 0o755 }); return; }
      await mkdir(dirname(destination), { recursive: true, mode: 0o755 });
      const stream = await openEntryStream(zip, entry);
      let bytes = 0;
      const guard = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        total += chunk.length;
        if (bytes > (item.type === "symlink" ? PI_PACKAGE_LIMITS.pathBytes : PI_PACKAGE_LIMITS.fileBytes) || total > PI_PACKAGE_LIMITS.restoredBytes) {
          callback(new PiPackageInputError("PI_PACKAGE_LIMIT_EXCEEDED", "ZIP expanded bytes exceed limit"));
        } else callback(null, chunk);
      } });
      if (item.type === "symlink") {
        const chunks: Buffer[] = [];
        const collector = new Transform({ transform(chunk: Buffer, _encoding, callback) { chunks.push(chunk); callback(); } });
        await pipeline(stream, guard, collector);
        const target = Buffer.concat(chunks).toString("utf8");
        if (!target || target.includes("\0") || target.includes("\\") || target.startsWith("/") || /^[A-Za-z]:/.test(target)) unsafe("ZIP contains unsafe symlink target");
        links.push({ path: item.path, target });
      } else {
        await pipeline(stream, guard, createWriteStream(destination, { flags: "wx", mode: item.mode & 0o111 ? 0o755 : 0o644 }));
      }
      if (bytes !== item.size) unsafe("ZIP entry size changed during extraction");
    });
    for (const link of links) {
      const destination = join(stage, link.path);
      const lexical = resolve(dirname(destination), link.target);
      if (lexical !== stage && !lexical.startsWith(`${stage}${sep}`)) unsafe("ZIP symlink leaves package root");
      await symlink(link.target, destination);
    }
    const root = await realpath(stage);
    for (const link of links) {
      let target: string;
      try { target = await realpath(join(stage, link.path)); }
      catch { unsafe("ZIP contains broken or cyclic symlink"); }
      if (target !== root && !target.startsWith(`${root}${sep}`)) unsafe("ZIP symlink chain leaves package root");
    }
    const manifestStat = await lstat(join(stage, "package.json"));
    if (!manifestStat.isFile() || manifestStat.size > PI_PACKAGE_LIMITS.manifestBytes) unsafe("ZIP manifest is not a regular file");
    const manifest = parsePiPackageManifest(await readFile(join(stage, "package.json")));
    try { await lstat(outputRoot); unsafe("package output already exists"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await rename(stage, outputRoot);
    return { manifest, inspection };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}
