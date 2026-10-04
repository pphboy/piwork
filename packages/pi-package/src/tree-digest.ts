import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readlink, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { PiPackageTreePath } from "./inventory.js";
import { PiPackageInputError } from "./manifest.js";
import { PI_PACKAGE_LIMITS } from "./limits.js";

function invalid(code: PiPackageInputError["code"], message: string): never { throw new PiPackageInputError(code, message); }
export interface PiPackageDigestEntry extends PiPackageTreePath { readonly absolute: string; readonly mode: number; readonly size: number; readonly target?: string;
  readonly identity?: { dev: number; ino: number; mtimeMs: number; ctimeMs: number } }
function writeField(hash: ReturnType<typeof createHash>, value: string | Buffer): void {
  const bytes = typeof value === "string" ? Buffer.from(value) : value;
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  hash.update(length);
  hash.update(bytes);
}

/** Shared normalized tree reader for source and prepared artifact fingerprints. */
export async function readPiPackageDigestTree(inputRoot: string): Promise<{ root: string; tree: PiPackageDigestEntry[]; restoredBytes: number }> {
  const root = await realpath(inputRoot);
  if (!(await stat(root)).isDirectory()) invalid("PI_PACKAGE_INVALID_SOURCE", "prepared package root must be a directory");
  const tree: PiPackageDigestEntry[] = [];
  let restoredBytes = 0;
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const names = (await readdir(directory)).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    for (const name of names) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (tree.length >= PI_PACKAGE_LIMITS.entries) invalid("PI_PACKAGE_LIMIT_EXCEEDED", "prepared package has too many entries");
      if (path.split("/").length > PI_PACKAGE_LIMITS.depth || Buffer.byteLength(path) > PI_PACKAGE_LIMITS.pathBytes) invalid("PI_PACKAGE_LIMIT_EXCEEDED", "prepared package path exceeds limits");
      if (!name || name === "." || name === ".." || name.includes("\\") || name.includes("\0")) invalid("PI_PACKAGE_UNSAFE_ARCHIVE", "prepared package has unsafe path");
      const absolute = join(directory, name);
      const info = await lstat(absolute);
      if (info.isDirectory()) {
        tree.push({ path, type: "directory", absolute, mode: 0o755, size: 0 });
        await walk(absolute, path);
      } else if (info.isFile()) {
        if (info.size > PI_PACKAGE_LIMITS.fileBytes) invalid("PI_PACKAGE_LIMIT_EXCEEDED", "prepared package file exceeds 64 MiB");
        restoredBytes += info.size;
        if (restoredBytes > PI_PACKAGE_LIMITS.restoredBytes) invalid("PI_PACKAGE_LIMIT_EXCEEDED", "prepared package exceeds 1 GiB");
        tree.push({ path, type: "file", absolute, mode: info.mode & 0o111 ? 0o755 : 0o644, size: info.size,
          identity: { dev: info.dev, ino: info.ino, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs } });
      } else if (info.isSymbolicLink()) {
        const target = await readlink(absolute);
        if (!target || target.includes("\0") || target.includes("\\") || target.startsWith("/") || Buffer.byteLength(target) > PI_PACKAGE_LIMITS.pathBytes) invalid("PI_PACKAGE_UNSAFE_ARCHIVE", "prepared package has unsafe symlink");
        const lexical = resolve(dirname(absolute), target);
        if (lexical !== root && !lexical.startsWith(`${root}${sep}`)) invalid("PI_PACKAGE_UNSAFE_ARCHIVE", "prepared package symlink leaves root");
        let actual: string;
        try { actual = await realpath(absolute); }
        catch { invalid("PI_PACKAGE_UNSAFE_ARCHIVE", "prepared package symlink is broken or cyclic"); }
        if (actual !== root && !actual.startsWith(`${root}${sep}`)) invalid("PI_PACKAGE_UNSAFE_ARCHIVE", "prepared package symlink chain leaves root");
        restoredBytes += Buffer.byteLength(target);
        if (restoredBytes > PI_PACKAGE_LIMITS.restoredBytes) invalid("PI_PACKAGE_LIMIT_EXCEEDED", "prepared package exceeds 1 GiB");
        tree.push({ path, type: "symlink", absolute, mode: 0o777, size: Buffer.byteLength(target), target });
      } else invalid("PI_PACKAGE_UNSAFE_ARCHIVE", "prepared package contains special file");
    }
  };
  await walk(root, "");
  return { root, tree, restoredBytes };
}

export async function hashPiPackageDigestTree(tree: PiPackageDigestEntry[]): Promise<string> {
  const hash = createHash("sha256");
  hash.update("piwork-pi-package-tree-v1\0");
  for (const entry of tree.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))) {
    writeField(hash, entry.path);
    writeField(hash, entry.type);
    writeField(hash, entry.mode.toString(8));
    if (entry.type === "file") {
      writeField(hash, entry.size.toString());
      const file = await open(entry.absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const before = await file.stat();
        if (!before.isFile() || before.size !== entry.size || !entry.identity ||
          (["dev", "ino", "mtimeMs", "ctimeMs"] as const).some((key) => before[key] !== entry.identity![key])) invalid("PI_PACKAGE_UNSAFE_ARCHIVE", "package changed during fingerprinting");
        let bytes = 0;
        for await (const chunk of file.createReadStream({ autoClose: false })) { bytes += chunk.length; if (bytes > entry.size) invalid("PI_PACKAGE_UNSAFE_ARCHIVE", "package changed during fingerprinting"); hash.update(chunk as Buffer); }
        const after = await file.stat();
        if (bytes !== entry.size || (["dev", "ino", "size", "mtimeMs", "ctimeMs"] as const).some((key) => before[key] !== after[key])) invalid("PI_PACKAGE_UNSAFE_ARCHIVE", "package changed during fingerprinting");
      } finally { await file.close(); }
    } else if (entry.type === "symlink") writeField(hash, entry.target!);
  }
  return `sha256:${hash.digest("hex")}`;
}

export async function digestPiPackageTree(root: string): Promise<string> {
  return hashPiPackageDigestTree((await readPiPackageDigestTree(root)).tree);
}
