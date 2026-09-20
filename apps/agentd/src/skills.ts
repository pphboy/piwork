import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadIsolatedSkills } from "@piwork/pi-adapter";

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
  constructor(readonly statuses: readonly SkillLoadStatus[]) {
    super("one or more required Skills failed validation or loading");
    this.name = "RequiredSkillError";
  }
}

export async function loadConfiguredSkills(skillRoot: string, configured: readonly ConfiguredSkill[]) {
  const statuses: SkillLoadStatus[] = [];
  const names = new Set<string>();
  for (const skill of configured) {
    try {
      if (names.has(skill.name)) throw new Error("duplicate configured Skill name");
      names.add(skill.name);
      const bytes = await readFile(join(skillRoot, skill.name, "SKILL.md"));
      const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (actual !== skill.digest) throw new Error(`digest mismatch: expected ${skill.digest}, actual ${actual}`);
      const manifestName = parseManifestName(bytes.toString("utf8"));
      if (manifestName !== skill.name) throw new Error(`manifest name ${manifestName ?? "missing"} does not match ${skill.name}`);
      statuses.push({ ...skill, loaded: true });
    } catch (error) {
      statuses.push({ ...skill, loaded: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (statuses.some((status) => !status.loaded)) throw new RequiredSkillError(statuses);
  const isolated = loadIsolatedSkills(skillRoot);
  const loadedNames = isolated.skills.map((skill) => skill.name).sort();
  const expectedNames = configured.map((skill) => skill.name).sort();
  if (JSON.stringify(loadedNames) !== JSON.stringify(expectedNames)) {
    throw new RequiredSkillError(expectedNames.map((name) => ({
      name,
      digest: configured.find((skill) => skill.name === name)!.digest,
      loaded: loadedNames.includes(name),
      ...(!loadedNames.includes(name) ? { error: "SDK did not load the configured Skill" } : {}),
    })));
  }
  return { ...isolated, statuses };
}

function parseManifestName(source: string): string | undefined {
  const match = /^---\s*\n([\s\S]*?)\n---/m.exec(source);
  if (match === null) return undefined;
  return /^name:\s*([^\s#]+)\s*$/m.exec(match[1] ?? "")?.[1];
}
