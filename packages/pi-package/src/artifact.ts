import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, readlink, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Check } from "typebox/value";
import { PiPackagePreparedEnvironmentSchema, type PiPackageArtifactMetadata, type PiPackagePreparedEnvironment, type PiPackageSourceKind } from "@piwork/contracts";
import { inspectPiPackageResources, type PiPackageInventory, type PiPackageTreePath } from "./inventory.js";
import { PiPackageInputError, parsePiPackageManifest, PI_HOST_MODULES } from "./manifest.js";
import { PI_PACKAGE_LIMITS } from "./limits.js";


export interface ValidatedPiPackageArtifact {
  readonly metadata: PiPackageArtifactMetadata;
  readonly inventory: PiPackageInventory;
  readonly entryCount: number;
  readonly restoredBytes: number;
}

function invalid(code: PiPackageInputError["code"], message: string): never { throw new PiPackageInputError(code, message); }
function writeField(hash: ReturnType<typeof createHash>, value: string | Buffer): void {
  const bytes = typeof value === "string" ? Buffer.from(value) : value;
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  hash.update(length);
  hash.update(bytes);
}

/** Hash every normalized tree entry, including dependency bytes and symlink targets. */
export async function validatePiPackageArtifact(input: {
  readonly root: string;
  readonly sourceKind: PiPackageSourceKind;
  readonly resolvedSource: string;
  readonly preparedEnvironment: PiPackagePreparedEnvironment;
  readonly expectedDigest?: string;
}): Promise<ValidatedPiPackageArtifact> {
  if (!Check(PiPackagePreparedEnvironmentSchema, input.preparedEnvironment)) invalid("PI_PACKAGE_INVALID_MANIFEST", "prepared environment is invalid");
  if (!input.resolvedSource || input.resolvedSource.length > 4096 || input.resolvedSource.includes("\0") || /:\/\/[^/]*@/.test(input.resolvedSource)) {
    invalid("PI_PACKAGE_INVALID_SOURCE", "resolved source contains invalid or private information");
  }
  const root = await realpath(input.root);
  if (!(await stat(root)).isDirectory()) invalid("PI_PACKAGE_INVALID_SOURCE", "prepared package root must be a directory");
  const tree: Array<PiPackageTreePath & { absolute: string; mode: number; size: number; target?: string }> = [];
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
        tree.push({ path, type: "file", absolute, mode: info.mode & 0o111 ? 0o755 : 0o644, size: info.size });
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
  const manifestEntry = tree.find((entry) => entry.path === "package.json");
  if (manifestEntry?.type !== "file" || manifestEntry.size > PI_PACKAGE_LIMITS.manifestBytes) invalid("PI_PACKAGE_INVALID_MANIFEST", "prepared package has no regular package.json");
  const manifest = parsePiPackageManifest(await readFile(join(root, "package.json")));
  for (const name of Object.keys(manifest.dependencies)) {
    if (PI_HOST_MODULES.has(name)) invalid("PI_PACKAGE_INVALID_MANIFEST", "Pi host APIs must be peer dependencies");
    const dependency = join(root, "node_modules", ...name.split("/"));
    let resolved: string;
    try { resolved = await realpath(dependency); }
    catch { invalid("PI_PACKAGE_INVALID_MANIFEST", `runtime dependency ${name} is missing`); }
    if (!resolved.startsWith(`${root}${sep}`) || !(await stat(resolved)).isDirectory()) invalid("PI_PACKAGE_UNSAFE_ARCHIVE", `runtime dependency ${name} is not inside the artifact`);
  }
  const inventory = inspectPiPackageResources(manifest, tree);
  const hash = createHash("sha256");
  hash.update("piwork-pi-package-tree-v1\0");
  for (const entry of tree.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))) {
    writeField(hash, entry.path);
    writeField(hash, entry.type);
    writeField(hash, entry.mode.toString(8));
    if (entry.type === "file") {
      writeField(hash, entry.size.toString());
      for await (const chunk of createReadStream(entry.absolute)) hash.update(chunk as Buffer);
      if ((await lstat(entry.absolute)).size !== entry.size) invalid("PI_PACKAGE_UNSAFE_ARCHIVE", "prepared package changed during validation");
    } else if (entry.type === "symlink") writeField(hash, entry.target!);
  }
  const contentDigest = `sha256:${hash.digest("hex")}`;
  if (input.expectedDigest !== undefined && input.expectedDigest !== contentDigest) invalid("PI_PACKAGE_INVALID_MANIFEST", "package content digest mismatch");
  return {
    metadata: {
      name: manifest.name, version: manifest.version, sourceKind: input.sourceKind, resolvedSource: input.resolvedSource,
      preparedEnvironment: input.preparedEnvironment,
      resourceCounts: { extensions: inventory.extensions.length, skills: inventory.skills.length, prompts: inventory.prompts.length, themes: inventory.themes.length },
      contentDigest,
    },
    inventory, entryCount: tree.length, restoredBytes,
  };
}

export function assertPiPackageEnvironment(expected: PiPackagePreparedEnvironment, actual: PiPackagePreparedEnvironment): void {
  if (!Check(PiPackagePreparedEnvironmentSchema, expected) || !Check(PiPackagePreparedEnvironmentSchema, actual) ||
      expected.os !== actual.os || expected.architecture !== actual.architecture || expected.variant !== actual.variant ||
      expected.nodeAbi !== actual.nodeAbi || expected.piSdkVersion !== actual.piSdkVersion) {
    throw Object.assign(new Error("PI_PACKAGE_ENVIRONMENT_MISMATCH"), { code: "PI_PACKAGE_ENVIRONMENT_MISMATCH" });
  }
}
