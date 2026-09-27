import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, readdir, readlink, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as yazl from "yazl";
import { inspectPiPackageResources, type PiPackageTreePath } from "./inventory.js";
import { PiPackageInputError, parsePiPackageManifest, type PiPackageManifest } from "./source.js";
import { PI_PACKAGE_LIMITS } from "./zip.js";

export interface PackedPiPackageDirectory {
  readonly bytes: number;
  readonly digest: string;
  readonly manifest: PiPackageManifest;
  readonly resourceCounts: Readonly<Record<"extensions" | "skills" | "prompts" | "themes", number>>;
}

const ZIP_MTIME = new Date("1980-01-01T00:00:00.000Z");

/** Stream a client directory into an upload-ready ZIP; no scripts or shell are run. */
export async function packPiPackageDirectory(sourceRoot: string, outputZip: string): Promise<PackedPiPackageDirectory> {
  const root = await realpath(sourceRoot);
  if (!(await stat(root)).isDirectory()) throw new PiPackageInputError("PI_PACKAGE_INVALID_SOURCE", "local package source must be a directory");
  const entries: Array<PiPackageTreePath & { mode: number; bytes: number; target?: string }> = [];
  let total = 0;
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const name of await readdir(directory)) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (path.split("/").length > PI_PACKAGE_LIMITS.depth) throw new PiPackageInputError("PI_PACKAGE_LIMIT_EXCEEDED", "local package path depth exceeds 64");
      if (Buffer.byteLength(path) > PI_PACKAGE_LIMITS.pathBytes || name.includes("\0") || name.includes("\\")) throw new PiPackageInputError("PI_PACKAGE_UNSAFE_ARCHIVE", "local package path is unsafe");
      if (entries.length >= PI_PACKAGE_LIMITS.entries) throw new PiPackageInputError("PI_PACKAGE_LIMIT_EXCEEDED", "local package exceeds 100000 entries");
      const absolute = join(directory, name);
      const info = await lstat(absolute);
      if (info.isDirectory()) {
        entries.push({ path, type: "directory", mode: 0o40755, bytes: 0 });
        await walk(absolute, path);
      } else if (info.isFile()) {
        if (info.size > PI_PACKAGE_LIMITS.fileBytes) throw new PiPackageInputError("PI_PACKAGE_LIMIT_EXCEEDED", "local package file exceeds 64 MiB");
        total += info.size;
        if (total > PI_PACKAGE_LIMITS.restoredBytes) throw new PiPackageInputError("PI_PACKAGE_LIMIT_EXCEEDED", "local package exceeds 1 GiB");
        entries.push({ path, type: "file", mode: info.mode & 0o111 ? 0o100755 : 0o100644, bytes: info.size });
      } else if (info.isSymbolicLink()) {
        const target = await readlink(absolute);
        if (!target || target.includes("\0") || target.includes("\\") || target.startsWith("/") || Buffer.byteLength(target) > PI_PACKAGE_LIMITS.pathBytes) {
          throw new PiPackageInputError("PI_PACKAGE_UNSAFE_ARCHIVE", "local package symlink target is unsafe");
        }
        const lexical = resolve(dirname(absolute), target);
        if (lexical !== root && !lexical.startsWith(`${root}${sep}`)) throw new PiPackageInputError("PI_PACKAGE_UNSAFE_ARCHIVE", "local package symlink leaves root");
        const actual = await realpath(absolute).catch(() => { throw new PiPackageInputError("PI_PACKAGE_UNSAFE_ARCHIVE", "local package symlink is broken or cyclic"); });
        if (actual !== root && !actual.startsWith(`${root}${sep}`)) throw new PiPackageInputError("PI_PACKAGE_UNSAFE_ARCHIVE", "local package symlink chain leaves root");
        total += Buffer.byteLength(target);
        if (total > PI_PACKAGE_LIMITS.restoredBytes) throw new PiPackageInputError("PI_PACKAGE_LIMIT_EXCEEDED", "local package exceeds 1 GiB");
        entries.push({ path, type: "symlink", mode: 0o120777, bytes: Buffer.byteLength(target), target });
      } else throw new PiPackageInputError("PI_PACKAGE_UNSAFE_ARCHIVE", "local package contains a special file");
    }
  };
  await walk(root, "");
  const manifestEntry = entries.find((entry) => entry.path === "package.json");
  if (manifestEntry?.type !== "file" || manifestEntry.bytes > PI_PACKAGE_LIMITS.manifestBytes) throw new PiPackageInputError("PI_PACKAGE_INVALID_MANIFEST", "local package requires a regular root package.json");
  const manifest = parsePiPackageManifest(await readFile(join(root, "package.json")));
  const inventory = inspectPiPackageResources(manifest, entries);
  const resourceCounts = { extensions: inventory.extensions.length, skills: inventory.skills.length, prompts: inventory.prompts.length, themes: inventory.themes.length };
  const zip = new yazl.ZipFile();
  for (const entry of entries.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))) {
    if (entry.type === "directory") zip.addEmptyDirectory(`${entry.path}/`, { mode: entry.mode, mtime: ZIP_MTIME });
    else if (entry.type === "symlink") zip.addBuffer(Buffer.from(entry.target!), entry.path, { mode: entry.mode, mtime: ZIP_MTIME });
    else zip.addFile(join(root, entry.path), entry.path, { mode: entry.mode, mtime: ZIP_MTIME });
  }
  zip.end();
  await mkdir(dirname(outputZip), { recursive: true });
  const stage = `${outputZip}.staging-${randomUUID()}`;
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > PI_PACKAGE_LIMITS.compressedBytes) callback(new PiPackageInputError("PI_PACKAGE_LIMIT_EXCEEDED", "local ZIP exceeds 256 MiB"));
      else { hash.update(chunk); callback(null, chunk); }
    } });
    await pipeline(zip.outputStream, meter, createWriteStream(stage, { flags: "wx", mode: 0o600 }));
    await rename(stage, outputZip);
    return { bytes, digest: hash.digest("hex"), manifest, resourceCounts };
  } catch (error) {
    await rm(stage, { force: true });
    throw error;
  }
}
