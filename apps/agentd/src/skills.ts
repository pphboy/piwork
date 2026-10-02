import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfiguredIsolatedSkills, SkillDirectoryMismatchError } from "@piwork/pi-adapter";

export interface ConfiguredSkill {
  readonly name: string;
  readonly digest: string;
}

export interface SkillLoadStatus {
  readonly name: string;
  readonly digest: string;
  readonly loaded: boolean;
  readonly error?: string;
}

export class RequiredSkillError extends Error {
  constructor(readonly statuses: readonly SkillLoadStatus[], readonly phase: "validation" | "load" = "validation") {
    super("one or more required Skills failed validation or loading");
    this.name = "RequiredSkillError";
  }
}

export async function loadConfiguredSkills(skillRoot: string, configured: readonly ConfiguredSkill[], agentsMd?: string, onValidated?: () => void) {
  const statuses: SkillLoadStatus[] = [];
  const names = new Set<string>();
  for (const skill of configured) {
    try {
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(skill.name)) throw new Error("configured Skill name is invalid");
      if (!/^sha256:[a-f0-9]{64}$/.test(skill.digest)) throw new Error("configured Skill identity is invalid");
      if (names.has(skill.name)) throw new Error("duplicate configured Skill name");
      names.add(skill.name);
      const actual = await hashSkillTree(join(skillRoot, skill.name));
      if (actual !== skill.digest) throw new Error(`digest mismatch: expected ${skill.digest}, actual ${actual}`);
      statuses.push({ ...skill, loaded: true });
    } catch (error) {
      statuses.push({ ...skill, loaded: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (statuses.some((status) => !status.loaded)) throw new RequiredSkillError(statuses);
  onValidated?.();
  let isolated;
  try {
    isolated = loadConfiguredIsolatedSkills(skillRoot, configured.map((skill) => skill.name), agentsMd);
  } catch (error) {
    throw new RequiredSkillError(configured.map((skill) => ({
      name: skill.name,
      digest: skill.digest,
      loaded: false,
      error: error instanceof SkillDirectoryMismatchError ? "SKILL_DIRECTORY_MISMATCH" : "SKILL_LOAD_FAILED",
    })), "load");
  }
  if (isolated.diagnostics.some((diagnostic) => diagnostic.type === "error")) {
    throw new RequiredSkillError(configured.map((skill) => ({ name: skill.name, digest: skill.digest, loaded: false, error: "SKILL_LOAD_FAILED" })), "load");
  }
  const loadedNames = isolated.skills.map((skill) => skill.name).sort();
  const expectedNames = configured.map((skill) => skill.name).sort();
  if (JSON.stringify(loadedNames) !== JSON.stringify(expectedNames)) {
    throw new RequiredSkillError(expectedNames.map((name) => ({
      name,
      digest: configured.find((skill) => skill.name === name)!.digest,
      loaded: loadedNames.includes(name),
      ...(!loadedNames.includes(name) ? { error: "SDK did not load the configured Skill" } : {}),
    })), "load");
  }
  return { ...isolated, statuses };
}

async function hashSkillTree(root: string): Promise<string> {
  const files: Array<{ relativePath: string; size: number }> = [];
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const directoryInfo = await lstat(directory);
    if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory() || (directoryInfo.mode & 0o555) === 0) {
      throw new Error("Skill directory is unreadable or invalid");
    }
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const absolutePath = join(directory, entry.name);
      const info = await lstat(absolutePath);
      if (info.isSymbolicLink()) throw new Error("Skill tree contains a symbolic link");
      if (info.isDirectory()) await walk(absolutePath, relativePath);
      else if (info.isFile()) {
        if ((info.mode & 0o444) === 0) throw new Error("Skill file is unreadable");
        files.push({ relativePath, size: info.size });
      }
      else throw new Error("Skill tree contains an unsupported entry");
    }
  };
  await walk(root, "");
  files.sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0);
  if (!files.some((file) => file.relativePath === "SKILL.md")) throw new Error("Skill manifest is missing");
  const hash = createHash("sha256");
  for (const file of files) {
    const pathBytes = Buffer.from(file.relativePath, "utf8");
    const pathLength = Buffer.allocUnsafe(4); pathLength.writeUInt32BE(pathBytes.length);
    const byteLength = Buffer.allocUnsafe(8); byteLength.writeBigUInt64BE(BigInt(file.size));
    hash.update(pathLength).update(pathBytes).update(byteLength).update(await readFile(join(root, ...file.relativePath.split("/"))));
  }
  return `sha256:${hash.digest("hex")}`;
}
