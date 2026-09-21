import { createHash } from "node:crypto";
import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { basename, isAbsolute, join, normalize, relative, sep } from "node:path";

export const SKILL_MAX_FILES = 2_048;
export const SKILL_MAX_TOTAL_BYTES = 32 * 1_024 * 1_024;
export const SKILL_MAX_FILE_BYTES = 8 * 1_024 * 1_024;
export const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type SkillTreeErrorCode =
  | "SKILL_PATH_INVALID"
  | "SKILL_NAME_INVALID"
  | "SKILL_NAME_MISMATCH"
  | "SKILL_ROOT_INVALID"
  | "SKILL_MANIFEST_MISSING"
  | "SKILL_TREE_UNSAFE"
  | "SKILL_FILE_LIMIT"
  | "SKILL_FILE_TOO_LARGE"
  | "SKILL_TREE_TOO_LARGE"
  | "SKILL_READ_FAILED";

export class SkillTreeError extends Error {
  constructor(
    readonly code: SkillTreeErrorCode,
    readonly field: "path" | "skillName" = "path",
    readonly skillName?: string,
  ) {
    super(safeMessage(code, skillName));
    this.name = "SkillTreeError";
  }
}

export interface SkillTreeFile {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly size: number;
}

export interface SkillTreeInspection {
  readonly name: string;
  readonly root: string;
  readonly identity: string;
  readonly files: readonly SkillTreeFile[];
  readonly directories: readonly string[];
  readonly fileCount: number;
  readonly totalBytes: number;
}

export interface InspectSkillTreeOptions {
  /** For managed/captured copies whose physical basename is an internal identity. */
  readonly expectedName?: string;
  /** Source imports must be absolute. Internal copies already have trusted roots. */
  readonly requireAbsolute?: boolean;
  /** Require the physical directory basename to equal expectedName. */
  readonly physicalNameMustMatch?: boolean;
}

/**
 * Validate and hash a complete Skill directory without decoding SKILL.md.
 * The hash is over sorted POSIX relative paths, byte lengths and file bytes.
 */
export function inspectSkillTree(inputPath: string, options: InspectSkillTreeOptions = {}): SkillTreeInspection {
  if ((options.requireAbsolute ?? true) && !isAbsolute(inputPath)) throw new SkillTreeError("SKILL_PATH_INVALID");
  const normalized = normalize(inputPath);
  const derivedName = basename(normalized);
  const name = options.expectedName ?? derivedName;
  if (!SKILL_NAME_PATTERN.test(name)) throw new SkillTreeError("SKILL_NAME_INVALID", "skillName", name);
  if (options.expectedName !== undefined && options.physicalNameMustMatch === true && derivedName !== options.expectedName) {
    throw new SkillTreeError("SKILL_NAME_MISMATCH", "skillName", options.expectedName);
  }

  let rootLstat;
  try {
    rootLstat = lstatSync(normalized);
  } catch {
    throw new SkillTreeError("SKILL_ROOT_INVALID", "path", name);
  }
  if (rootLstat.isSymbolicLink() || !rootLstat.isDirectory()) {
    throw new SkillTreeError("SKILL_ROOT_INVALID", "path", name);
  }
  let root: string;
  try {
    root = realpathSync(normalized);
  } catch {
    throw new SkillTreeError("SKILL_READ_FAILED", "path", name);
  }

  const files: SkillTreeFile[] = [];
  const directories: string[] = [];
  walk(root, "", root, name, files, directories);
  files.sort((left, right) => compareLexical(left.relativePath, right.relativePath));
  directories.sort(compareLexical);

  if (files.length > SKILL_MAX_FILES) throw new SkillTreeError("SKILL_FILE_LIMIT", "path", name);
  let totalBytes = 0;
  for (const file of files) {
    if (file.size > SKILL_MAX_FILE_BYTES) throw new SkillTreeError("SKILL_FILE_TOO_LARGE", "path", name);
    totalBytes += file.size;
    if (totalBytes > SKILL_MAX_TOTAL_BYTES) throw new SkillTreeError("SKILL_TREE_TOO_LARGE", "path", name);
  }
  const manifest = files.find((file) => file.relativePath === "SKILL.md");
  if (manifest === undefined) throw new SkillTreeError("SKILL_MANIFEST_MISSING", "path", name);

  const hash = createHash("sha256");
  for (const file of files) {
    const pathBytes = Buffer.from(file.relativePath, "utf8");
    const pathLength = Buffer.allocUnsafe(4);
    pathLength.writeUInt32BE(pathBytes.length);
    const byteLength = Buffer.allocUnsafe(8);
    byteLength.writeBigUInt64BE(BigInt(file.size));
    hash.update(pathLength).update(pathBytes).update(byteLength).update(readRegularFileNoFollow(file.absolutePath, file.size, name));
  }
  return {
    name,
    root,
    identity: `sha256:${hash.digest("hex")}`,
    files,
    directories,
    fileCount: files.length,
    totalBytes,
  };
}

export function readRegularFileNoFollow(path: string, expectedSize: number, skillName?: string): Buffer {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | noFollowFlag());
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size !== expectedSize) throw new SkillTreeError("SKILL_TREE_UNSAFE", "path", skillName);
    return readFileSync(descriptor);
  } catch (error) {
    if (error instanceof SkillTreeError) throw error;
    throw new SkillTreeError("SKILL_READ_FAILED", "path", skillName);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function walk(
  root: string,
  relativeDirectory: string,
  containmentRoot: string,
  skillName: string,
  files: SkillTreeFile[],
  directories: string[],
): void {
  const directory = relativeDirectory === "" ? root : join(root, ...relativeDirectory.split("/"));
  assertContained(containmentRoot, directory, skillName);
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    throw new SkillTreeError("SKILL_READ_FAILED", "path", skillName);
  }
  entries.sort((left, right) => compareLexical(left.name, right.name));
  for (const entry of entries) {
    if (entry.name === "." || entry.name === ".." || entry.name.includes("/") || entry.name.includes("\\")) {
      throw new SkillTreeError("SKILL_TREE_UNSAFE", "path", skillName);
    }
    const relativePath = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
    const absolutePath = join(directory, entry.name);
    assertContained(containmentRoot, absolutePath, skillName);
    let stat;
    try {
      stat = lstatSync(absolutePath);
    } catch {
      throw new SkillTreeError("SKILL_READ_FAILED", "path", skillName);
    }
    if (stat.isSymbolicLink()) throw new SkillTreeError("SKILL_TREE_UNSAFE", "path", skillName);
    if (stat.isDirectory()) {
      directories.push(relativePath);
      walk(root, relativePath, containmentRoot, skillName, files, directories);
      continue;
    }
    if (!stat.isFile()) throw new SkillTreeError("SKILL_TREE_UNSAFE", "path", skillName);
    if (stat.size > SKILL_MAX_FILE_BYTES) throw new SkillTreeError("SKILL_FILE_TOO_LARGE", "path", skillName);
    files.push({ relativePath, absolutePath, size: stat.size });
    if (files.length > SKILL_MAX_FILES) throw new SkillTreeError("SKILL_FILE_LIMIT", "path", skillName);
  }
}

function assertContained(root: string, candidate: string, skillName: string): void {
  const child = relative(root, candidate);
  if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new SkillTreeError("SKILL_TREE_UNSAFE", "path", skillName);
  }
}

function noFollowFlag(): number {
  return "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
}

function compareLexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeMessage(code: SkillTreeErrorCode, skillName?: string): string {
  const subject = skillName === undefined ? "Skill" : `Skill ${skillName}`;
  const descriptions: Record<SkillTreeErrorCode, string> = {
    SKILL_PATH_INVALID: "path must be an absolute directory",
    SKILL_NAME_INVALID: "directory name is invalid",
    SKILL_NAME_MISMATCH: "directory name does not match the requested Skill",
    SKILL_ROOT_INVALID: "root must be a regular directory and not a symbolic link",
    SKILL_MANIFEST_MISSING: "requires a regular root SKILL.md",
    SKILL_TREE_UNSAFE: "contains an unsupported or unsafe entry",
    SKILL_FILE_LIMIT: "contains too many files",
    SKILL_FILE_TOO_LARGE: "contains a file over the size limit",
    SKILL_TREE_TOO_LARGE: "exceeds the total size limit",
    SKILL_READ_FAILED: "could not be read safely",
  };
  return `${subject}: ${descriptions[code]}`;
}
