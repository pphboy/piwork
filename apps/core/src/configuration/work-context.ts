import { randomUUID } from "node:crypto";
import {
  constants,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { TextDecoder } from "node:util";
import { Check } from "typebox/value";
import { AGENTS_MD_MAX_BYTES, WorkConfigSchema, type WorkConfig } from "@piwork/contracts";
import { inspectSkillTree, readRegularFileNoFollow, type SkillTreeInspection } from "./skill-tree.js";

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type WorkContextErrorCode =
  | "CONTEXT_ID_INVALID"
  | "CONTEXT_EXISTS"
  | "CONTEXT_NOT_FOUND"
  | "CONTEXT_OWNERSHIP"
  | "CONTEXT_UNSAFE"
  | "CONFIGURATION_INVALID"
  | "AGENTS_INVALID"
  | "SKILL_LOAD_FAILED";

export class WorkContextError extends Error {
  constructor(readonly code: WorkContextErrorCode, readonly field?: string, readonly skillName?: string) {
    super(safeContextMessage(code, field, skillName));
    this.name = "WorkContextError";
  }
}

export interface WorkContextSkillSource {
  readonly name: string;
  readonly identity: string;
  readonly directory: string;
}

export interface WorkContextMetadata {
  readonly version: 1;
  readonly snapshotId: string;
  readonly workId: string;
  readonly imageIdentity: string;
  readonly skills: ReadonlyArray<{ readonly name: string; readonly identity: string }>;
  readonly createdAt: string;
}

export interface WorkContextSnapshot {
  readonly snapshotId: string;
  readonly workId: string;
  readonly directory: string;
  readonly configuration: WorkConfig;
  readonly metadata: WorkContextMetadata;
}

export class WorkContextStore {
  constructor(readonly rootDirectory: string) {
    mkdirSync(rootDirectory, { recursive: true, mode: 0o700 });
  }

  build(input: {
    readonly workId: string;
    readonly snapshotId?: string;
    readonly configuration: WorkConfig;
    readonly imageIdentity: string;
    readonly skills: readonly WorkContextSkillSource[];
    readonly createdAt: string;
  }): WorkContextSnapshot {
    assertSegment(input.workId, "workId");
    const snapshotId = input.snapshotId ?? `context-${randomUUID()}`;
    assertSegment(snapshotId, "snapshotId");
    if (!Check(WorkConfigSchema, input.configuration)) throw new WorkContextError("CONFIGURATION_INVALID", "configuration");
    if (!/^sha256:[a-f0-9]{64}$/.test(input.imageIdentity)) throw new WorkContextError("CONFIGURATION_INVALID", "agentImage");
    if (new Set(input.configuration.skills).size !== input.configuration.skills.length) {
      throw new WorkContextError("CONFIGURATION_INVALID", "skills");
    }
    if (input.skills.length !== input.configuration.skills.length
      || input.skills.some((skill, index) => skill.name !== input.configuration.skills[index])) {
      throw new WorkContextError("CONFIGURATION_INVALID", "skills");
    }
    const contexts = join(this.rootDirectory, input.workId, "contexts");
    mkdirSync(contexts, { recursive: true, mode: 0o700 });
    const destination = join(contexts, snapshotId);
    if (existsSync(destination)) throw new WorkContextError("CONTEXT_EXISTS");
    const staging = join(contexts, `.staging-${snapshotId}-${randomUUID()}`);
    try {
      mkdirSync(join(staging, "skills"), { recursive: true, mode: 0o700 });
      const capturedSkills: Array<{ name: string; identity: string }> = [];
      for (const source of input.skills) {
        assertSegment(source.name, "skills");
        const inspected = inspectSkillTree(source.directory, { expectedName: source.name });
        if (inspected.identity !== source.identity) throw new WorkContextError("SKILL_LOAD_FAILED", `skills.${source.name}`, source.name);
        const skillDestination = join(staging, "skills", source.name);
        copyInspectedTree(inspected, skillDestination);
        const copied = inspectSkillTree(skillDestination, {
          expectedName: source.name,
          physicalNameMustMatch: true,
        });
        if (copied.identity !== source.identity) throw new WorkContextError("SKILL_LOAD_FAILED", `skills.${source.name}`, source.name);
        capturedSkills.push({ name: source.name, identity: source.identity });
      }
      writeFileSync(join(staging, "AGENTS.md"), input.configuration.agentsMd, { encoding: "utf8", flag: "wx", mode: 0o400 });
      writeJsonExclusive(join(staging, "config.json"), input.configuration);
      const metadata: WorkContextMetadata = {
        version: 1,
        snapshotId,
        workId: input.workId,
        imageIdentity: input.imageIdentity,
        skills: capturedSkills,
        createdAt: input.createdAt,
      };
      writeJsonExclusive(join(staging, "metadata.json"), metadata);
      validateSnapshotDirectory(this.rootDirectory, staging, input.workId, snapshotId);
      sealSnapshotTree(staging);
      renameSync(staging, destination);
      return this.load(input.workId, snapshotId);
    } catch (error) {
      removeSnapshotTree(staging);
      throw redactContextError(error);
    }
  }

  load(workId: string, snapshotId: string): WorkContextSnapshot {
    assertSegment(workId, "workId"); assertSegment(snapshotId, "snapshotId");
    const directory = join(this.rootDirectory, workId, "contexts", snapshotId);
    return validateSnapshotDirectory(this.rootDirectory, directory, workId, snapshotId);
  }

  /** Remove an unpublished snapshot after a failed database commit. */
  remove(workId: string, snapshotId: string): void {
    assertSegment(workId, "workId"); assertSegment(snapshotId, "snapshotId");
    const directory = join(this.rootDirectory, workId, "contexts", snapshotId);
    try {
      const canonicalRoot = realpathSync(this.rootDirectory);
      const canonical = existsSync(directory) ? realpathSync(directory) : directory;
      assertContained(canonicalRoot, canonical);
      removeSnapshotTree(directory);
    } catch {
      // Cleanup is best effort; startup cleanup handles abandoned snapshots.
    }
  }

  cleanupStaging(): void {
    for (const workName of safeNames(this.rootDirectory)) {
      const contexts = join(this.rootDirectory, workName, "contexts");
      for (const name of safeNames(contexts)) {
        if (name.startsWith(".staging-")) removeSnapshotTree(join(contexts, name));
      }
    }
  }

  cleanupOrphans(referenced: ReadonlySet<string>): void {
    this.cleanupStaging();
    for (const workName of safeNames(this.rootDirectory)) {
      const contexts = join(this.rootDirectory, workName, "contexts");
      for (const snapshotName of safeNames(contexts)) {
        if (!referenced.has(`${workName}\0${snapshotName}`)) {
          removeSnapshotTree(join(contexts, snapshotName));
        }
      }
    }
  }
}

function validateSnapshotDirectory(rootDirectory: string, directory: string, expectedWorkId: string, expectedSnapshotId: string): WorkContextSnapshot {
  try {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new WorkContextError("CONTEXT_UNSAFE");
    const canonical = realpathSync(directory);
    assertContained(realpathSync(rootDirectory), canonical);
    const config = JSON.parse(readFileSync(join(canonical, "config.json"), "utf8")) as unknown;
    if (!Check(WorkConfigSchema, config)) throw new WorkContextError("CONFIGURATION_INVALID", "configuration");
    const metadata = JSON.parse(readFileSync(join(canonical, "metadata.json"), "utf8")) as Partial<WorkContextMetadata>;
    if (metadata.version !== 1 || metadata.workId !== expectedWorkId || metadata.snapshotId !== expectedSnapshotId
      || !/^sha256:[a-f0-9]{64}$/.test(metadata.imageIdentity ?? "") || !Array.isArray(metadata.skills)
      || typeof metadata.createdAt !== "string") throw new WorkContextError("CONTEXT_OWNERSHIP");
    const agents = readFileSync(join(canonical, "AGENTS.md"));
    if (agents.byteLength > AGENTS_MD_MAX_BYTES) throw new WorkContextError("AGENTS_INVALID", "agentsMd");
    try { new TextDecoder("utf-8", { fatal: true }).decode(agents); }
    catch { throw new WorkContextError("AGENTS_INVALID", "agentsMd"); }
    if (agents.toString("utf8") !== config.agentsMd) throw new WorkContextError("AGENTS_INVALID", "agentsMd");
    if (metadata.skills.length !== config.skills.length) throw new WorkContextError("CONFIGURATION_INVALID", "skills");
    for (const [index, skill] of metadata.skills.entries()) {
      if (skill === null || typeof skill !== "object" || typeof skill.name !== "string" || typeof skill.identity !== "string"
        || skill.name !== config.skills[index]) throw new WorkContextError("SKILL_LOAD_FAILED", `skills.${index}`, config.skills[index]);
      const inspected = inspectSkillTree(join(canonical, "skills", skill.name), {
        expectedName: skill.name,
        physicalNameMustMatch: true,
      });
      if (inspected.identity !== skill.identity) throw new WorkContextError("SKILL_LOAD_FAILED", `skills.${index}`, skill.name);
    }
    const actualSkillNames = safeNames(join(canonical, "skills"));
    if (actualSkillNames.length !== metadata.skills.length || actualSkillNames.some((name, index) => name !== [...metadata.skills!].map((skill) => skill.name).sort()[index])) {
      throw new WorkContextError("CONTEXT_UNSAFE", "skills");
    }
    return {
      snapshotId: expectedSnapshotId,
      workId: expectedWorkId,
      directory: canonical,
      configuration: config,
      metadata: metadata as WorkContextMetadata,
    };
  } catch (error) {
    throw redactContextError(error);
  }
}

function copyInspectedTree(source: SkillTreeInspection, destination: string): void {
  mkdirSync(destination, { recursive: false, mode: 0o700 });
  for (const directory of source.directories) mkdirSync(join(destination, ...directory.split("/")), { recursive: false, mode: 0o700 });
  for (const file of source.files) {
    const bytes = readRegularFileNoFollow(file.absolutePath, file.size, source.name);
    writeFileSync(join(destination, ...file.relativePath.split("/")), bytes, { flag: "wx", mode: 0o400 });
  }
}

function writeJsonExclusive(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o400 });
}

function sealSnapshotTree(directory: string): void {
  for (const name of safeNames(directory)) {
    const path = join(directory, name);
    const information = lstatSync(path);
    if (information.isDirectory()) sealSnapshotTree(path);
    else if (information.isFile() && !information.isSymbolicLink()) chmodSync(path, 0o444);
    else throw new WorkContextError("CONTEXT_UNSAFE");
  }
  // The Core data root remains 0700. Snapshot directories are executable by
  // the fixed non-root container user after the leaf is bind-mounted, while
  // immutable files stay read-only and the mount itself is read-only.
  chmodSync(directory, 0o755);
}

function removeSnapshotTree(directory: string): void {
  try {
    let rootInformation;
    try { rootInformation = lstatSync(directory); } catch { return; }
    if (rootInformation.isSymbolicLink() || !rootInformation.isDirectory()) {
      rmSync(directory, { force: true });
      return;
    }
    for (const name of safeNames(directory)) {
      const path = join(directory, name);
      const information = lstatSync(path);
      if (information.isDirectory() && !information.isSymbolicLink()) removeSnapshotTree(path);
    }
    chmodSync(directory, 0o700);
  } catch {
    // rmSync below remains best effort for partially written staging trees.
  }
  rmSync(directory, { recursive: true, force: true });
}

function assertSegment(value: string, field: string): void {
  if (!SAFE_SEGMENT.test(value) || value === "." || value === "..") throw new WorkContextError("CONTEXT_ID_INVALID", field);
}

function assertContained(root: string, candidate: string): void {
  const child = relative(root, candidate);
  if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new WorkContextError("CONTEXT_UNSAFE");
}

function safeNames(directory: string): string[] {
  try {
    return (process.getBuiltinModule("node:fs") as typeof import("node:fs")).readdirSync(directory).sort();
  } catch { return []; }
}

function redactContextError(error: unknown): WorkContextError {
  if (error instanceof WorkContextError) return error;
  return new WorkContextError("CONTEXT_NOT_FOUND");
}

function safeContextMessage(code: WorkContextErrorCode, field?: string, skillName?: string): string {
  if (code === "SKILL_LOAD_FAILED") return `Skill ${skillName ?? "unknown"} could not be loaded from the Work context`;
  const messages: Record<Exclude<WorkContextErrorCode, "SKILL_LOAD_FAILED">, string> = {
    CONTEXT_ID_INVALID: "Work context identifier is invalid",
    CONTEXT_EXISTS: "Work context already exists",
    CONTEXT_NOT_FOUND: "Work context is unavailable",
    CONTEXT_OWNERSHIP: "Work context ownership is invalid",
    CONTEXT_UNSAFE: "Work context is unsafe or corrupted",
    CONFIGURATION_INVALID: "Work context configuration is invalid",
    AGENTS_INVALID: "Work AGENTS content is invalid",
  };
  return field === undefined ? messages[code] : `${messages[code]} (${field})`;
}
