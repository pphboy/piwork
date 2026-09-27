import { lstat, readFile, readdir, readlink, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { PiPackageInputError, parsePiPackageManifest, type PiPackageManifest } from "./source.js";
import { PI_PACKAGE_LIMITS } from "./zip.js";

function reject(code: PiPackageInputError["code"], message: string): never {
  throw new PiPackageInputError(code, message);
}

/** Check a downloaded source before dependency installation or lifecycle execution. */
export async function validatePiPackageSourceTree(sourceRoot: string): Promise<PiPackageManifest> {
  const root = await realpath(sourceRoot);
  if (!(await stat(root)).isDirectory()) reject("PI_PACKAGE_INVALID_SOURCE", "package source is not a directory");
  let entries = 0, bytes = 0;
  const walk = async (directory: string, depth: number, prefix: string): Promise<void> => {
    for (const name of await readdir(directory)) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (++entries > PI_PACKAGE_LIMITS.entries || depth > PI_PACKAGE_LIMITS.depth ||
          Buffer.byteLength(path) > PI_PACKAGE_LIMITS.pathBytes) reject("PI_PACKAGE_LIMIT_EXCEEDED", "package source tree exceeds limits");
      if (!name || name === "." || name === ".." || name.includes("\\") || name.includes("\0")) {
        reject("PI_PACKAGE_UNSAFE_ARCHIVE", "package source path is unsafe");
      }
      const absolute = join(directory, name);
      const info = await lstat(absolute);
      if (info.isDirectory()) await walk(absolute, depth + 1, path);
      else if (info.isFile()) {
        if (info.size > PI_PACKAGE_LIMITS.fileBytes) reject("PI_PACKAGE_LIMIT_EXCEEDED", "package source file exceeds 64 MiB");
        bytes += info.size;
      } else if (info.isSymbolicLink()) {
        const target = await readlink(absolute);
        if (!target || target.startsWith("/") || target.includes("\\") || target.includes("\0") ||
            Buffer.byteLength(target) > PI_PACKAGE_LIMITS.pathBytes) reject("PI_PACKAGE_UNSAFE_ARCHIVE", "package source link is unsafe");
        const lexical = resolve(dirname(absolute), target);
        if (lexical !== root && !lexical.startsWith(`${root}${sep}`)) reject("PI_PACKAGE_UNSAFE_ARCHIVE", "package source link leaves root");
        let actual: string;
        try { actual = await realpath(absolute); }
        catch { reject("PI_PACKAGE_UNSAFE_ARCHIVE", "package source link is broken or cyclic"); }
        if (actual !== root && !actual.startsWith(`${root}${sep}`)) reject("PI_PACKAGE_UNSAFE_ARCHIVE", "package source link chain leaves root");
        bytes += Buffer.byteLength(target);
      } else reject("PI_PACKAGE_UNSAFE_ARCHIVE", "package source contains a special file");
      if (bytes > PI_PACKAGE_LIMITS.restoredBytes) reject("PI_PACKAGE_LIMIT_EXCEEDED", "package source exceeds 1 GiB");
    }
  };
  await walk(root, 1, "");
  const manifest = await lstat(join(root, "package.json")).catch(() => reject("PI_PACKAGE_INVALID_MANIFEST", "package source manifest is missing"));
  if (!manifest.isFile() || manifest.size > PI_PACKAGE_LIMITS.manifestBytes) reject("PI_PACKAGE_INVALID_MANIFEST", "package source manifest is invalid");
  return parsePiPackageManifest(await readFile(join(root, "package.json")));
}
