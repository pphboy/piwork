import { createHash } from "node:crypto";
import { closeSync, lstatSync, openSync, readFileSync, readlinkSync, readdirSync, realpathSync, statSync, constants } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { PiPackageArtifactMetadata } from "@piwork/contracts";
import { inspectPiPackageResources, type PiPackageTreePath } from "./inventory.js";
import { PiPackageInputError, parsePiPackageManifest, PI_HOST_MODULES } from "./manifest.js";
import { PI_PACKAGE_LIMITS } from "./limits.js";


function invalid(code: PiPackageInputError["code"], message: string): never { throw new PiPackageInputError(code, message); }
function field(hash: ReturnType<typeof createHash>, value: string): void {
  const bytes = Buffer.from(value), length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length); hash.update(length); hash.update(bytes);
}

/** Synchronous verification is used at the Work context commit boundary. */
export function validatePiPackageArtifactSync(rootDirectory: string, expected: PiPackageArtifactMetadata): void {
  const root = realpathSync(rootDirectory);
  if (!statSync(root).isDirectory()) invalid("PI_PACKAGE_INVALID_SOURCE", "prepared package root must be a directory");
  const tree: Array<PiPackageTreePath & { absolute: string; mode: number; size: number; target?: string }> = [];
  let restoredBytes = 0;
  const walk = (directory: string, prefix: string): void => {
    for (const name of readdirSync(directory).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (tree.length >= PI_PACKAGE_LIMITS.entries || path.split("/").length > PI_PACKAGE_LIMITS.depth || Buffer.byteLength(path) > PI_PACKAGE_LIMITS.pathBytes) invalid("PI_PACKAGE_LIMIT_EXCEEDED", "prepared package tree exceeds limits");
      if (!name || name === "." || name === ".." || name.includes("\\") || name.includes("\0")) invalid("PI_PACKAGE_UNSAFE_ARCHIVE", "prepared package has unsafe path");
      const absolute = join(directory, name), info = lstatSync(absolute);
      if (info.isDirectory()) {
        tree.push({ path, type: "directory", absolute, mode: 0o755, size: 0 }); walk(absolute, path);
      } else if (info.isFile()) {
        if (info.size > PI_PACKAGE_LIMITS.fileBytes) invalid("PI_PACKAGE_LIMIT_EXCEEDED", "prepared package file exceeds limit");
        restoredBytes += info.size;
        tree.push({ path, type: "file", absolute, mode: info.mode & 0o111 ? 0o755 : 0o644, size: info.size });
      } else if (info.isSymbolicLink()) {
        const target = readlinkSync(absolute);
        if (!target || target.includes("\0") || target.includes("\\") || target.startsWith("/") || Buffer.byteLength(target) > PI_PACKAGE_LIMITS.pathBytes) invalid("PI_PACKAGE_UNSAFE_ARCHIVE", "prepared package has unsafe symlink");
        const lexical = resolve(dirname(absolute), target);
        if (lexical !== root && !lexical.startsWith(`${root}${sep}`)) invalid("PI_PACKAGE_UNSAFE_ARCHIVE", "prepared package symlink leaves root");
        let actual: string;
        try { actual = realpathSync(absolute); } catch { invalid("PI_PACKAGE_UNSAFE_ARCHIVE", "prepared package symlink is broken or cyclic"); }
        if (actual !== root && !actual.startsWith(`${root}${sep}`)) invalid("PI_PACKAGE_UNSAFE_ARCHIVE", "prepared package symlink chain leaves root");
        restoredBytes += Buffer.byteLength(target);
        tree.push({ path, type: "symlink", absolute, mode: 0o777, size: Buffer.byteLength(target), target });
      } else invalid("PI_PACKAGE_UNSAFE_ARCHIVE", "prepared package contains special file");
      if (restoredBytes > PI_PACKAGE_LIMITS.restoredBytes) invalid("PI_PACKAGE_LIMIT_EXCEEDED", "prepared package exceeds restored size limit");
    }
  };
  walk(root, "");
  const manifestEntry = tree.find((entry) => entry.path === "package.json");
  if (manifestEntry?.type !== "file" || manifestEntry.size > PI_PACKAGE_LIMITS.manifestBytes) invalid("PI_PACKAGE_INVALID_MANIFEST", "prepared package has no regular package.json");
  const manifest = parsePiPackageManifest(readFileSync(join(root, "package.json")));
  if (manifest.name !== expected.name || manifest.version !== expected.version) invalid("PI_PACKAGE_INVALID_MANIFEST", "package manifest differs from binding");
  for (const name of Object.keys(manifest.dependencies)) {
    if (PI_HOST_MODULES.has(name)) invalid("PI_PACKAGE_INVALID_MANIFEST", "Pi host APIs must be peer dependencies");
    const dependency = join(root, "node_modules", ...name.split("/"));
    let resolved: string;
    try { resolved = realpathSync(dependency); } catch { invalid("PI_PACKAGE_INVALID_MANIFEST", "runtime dependency is missing"); }
    if (!resolved.startsWith(`${root}${sep}`) || !statSync(resolved).isDirectory()) invalid("PI_PACKAGE_UNSAFE_ARCHIVE", "runtime dependency leaves artifact");
  }
  const inventory = inspectPiPackageResources(manifest, tree);
  const counts = { extensions: inventory.extensions.length, skills: inventory.skills.length, prompts: inventory.prompts.length, themes: inventory.themes.length };
  if ((["extensions", "skills", "prompts", "themes"] as const).some((kind) => counts[kind] !== expected.resourceCounts[kind])) {
    invalid("PI_PACKAGE_INVALID_MANIFEST", "resource inventory differs from binding");
  }
  const hash = createHash("sha256"); hash.update("piwork-pi-package-tree-v1\0");
  for (const entry of tree.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))) {
    field(hash, entry.path); field(hash, entry.type); field(hash, entry.mode.toString(8));
    if (entry.type === "file") {
      field(hash, entry.size.toString());
      const descriptor = openSync(entry.absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const buffer = Buffer.allocUnsafe(64 * 1024);
        let offset = 0, count: number;
        while ((count = readChunk(descriptor, buffer)) > 0) { hash.update(buffer.subarray(0, count)); offset += count; }
        if (offset !== entry.size || lstatSync(entry.absolute).size !== entry.size) invalid("PI_PACKAGE_UNSAFE_ARCHIVE", "prepared package changed during verification");
      } finally { closeSync(descriptor); }
    } else if (entry.type === "symlink") field(hash, entry.target!);
  }
  if (`sha256:${hash.digest("hex")}` !== expected.contentDigest) invalid("PI_PACKAGE_INVALID_MANIFEST", "package content digest mismatch");
}

function readChunk(descriptor: number, buffer: Buffer): number {
  return (process.getBuiltinModule("node:fs") as typeof import("node:fs")).readSync(descriptor, buffer, 0, buffer.length, null);
}
