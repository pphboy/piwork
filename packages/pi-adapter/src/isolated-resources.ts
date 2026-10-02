import {
  createExtensionRuntime,
  loadSkillsFromDir,
  type LoadSkillsResult,
  type ResourceLoader,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export class SkillDirectoryMismatchError extends Error {
  readonly code = "SKILL_DIRECTORY_MISMATCH";
  constructor() { super("The SDK Skill directory does not match the captured Work context."); }
}

/** Validate SDK metadata before it can become an active Work resource. */
export function assertConfiguredSkillDirectory(skill: Pick<Skill, "baseDir" | "filePath">,
  directory: string, manifest: string): void {
  if (realpathSync(skill.baseDir) !== realpathSync(directory)
    || realpathSync(skill.filePath) !== realpathSync(manifest)) throw new SkillDirectoryMismatchError();
}

export function loadIsolatedSkills(skillDir: string, agentsMd?: string): { readonly skills: Skill[]; readonly diagnostics: LoadSkillsResult["diagnostics"]; readonly loader: ResourceLoader } {
  return loadConfiguredIsolatedSkills(skillDir, undefined, agentsMd);
}

/** Load one explicit directory per Core-assigned name and rebind SDK metadata to that name. */
export function loadConfiguredIsolatedSkills(skillDir: string, configuredNames?: readonly string[], agentsMd?: string): { readonly skills: Skill[]; readonly diagnostics: LoadSkillsResult["diagnostics"]; readonly loader: ResourceLoader } {
  const canonicalRoot = realpathSync(skillDir);
  const loaded = configuredNames === undefined
    ? loadSkillsFromDir({ dir: canonicalRoot, source: "piwork-artifact" })
    : configuredNames.reduce((all, name) => {
      const directory = realpathSync(resolve(canonicalRoot, name));
      const child = relative(canonicalRoot, directory);
      if (child === "" || child === ".." || child.startsWith(`..${sep}`)) {
        throw new SkillDirectoryMismatchError();
      }
      const manifest = realpathSync(join(directory, "SKILL.md"));
      const result = loadSkillsFromDir({ dir: directory, source: "piwork-artifact" });
      for (const skill of result.skills) assertConfiguredSkillDirectory(skill, directory, manifest);
      const matching = result.skills.filter((skill) => realpathSync(skill.baseDir) === directory
        && realpathSync(skill.filePath) === manifest);
      if (result.skills.length !== 1 || matching.length !== 1) {
        throw new Error(`configured Skill ${name} did not load exactly once from its directory`);
      }
      all.skills.push({ ...matching[0]!, name });
      all.diagnostics.push(...result.diagnostics);
      return all;
    }, { skills: [], diagnostics: [] } as LoadSkillsResult);
  const loader: ResourceLoader = {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => loaded,
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: agentsMd === undefined ? [] : [{ path: "/run/piwork/AGENTS.md", content: agentsMd }] }),
    getSystemPrompt: () => undefined,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
  return { skills: loaded.skills, diagnostics: loaded.diagnostics, loader };
}
