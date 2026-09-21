import {
  createExtensionRuntime,
  loadSkillsFromDir,
  type LoadSkillsResult,
  type ResourceLoader,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";

export function loadIsolatedSkills(skillDir: string, agentsMd?: string): { readonly skills: Skill[]; readonly diagnostics: LoadSkillsResult["diagnostics"]; readonly loader: ResourceLoader } {
  return loadConfiguredIsolatedSkills(skillDir, undefined, agentsMd);
}

/** Load one explicit directory per Core-assigned name and rebind SDK metadata to that name. */
export function loadConfiguredIsolatedSkills(skillDir: string, configuredNames?: readonly string[], agentsMd?: string): { readonly skills: Skill[]; readonly diagnostics: LoadSkillsResult["diagnostics"]; readonly loader: ResourceLoader } {
  const loaded = configuredNames === undefined
    ? loadSkillsFromDir({ dir: skillDir, source: "piwork-artifact" })
    : configuredNames.reduce((all, name) => {
      const directory = resolve(skillDir, name);
      const result = loadSkillsFromDir({ dir: directory, source: "piwork-artifact" });
      const matching = result.skills.filter((skill) => resolve(skill.baseDir) === directory);
      if (matching.length !== 1) {
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
    getSystemPrompt: () => "You are the deterministic piwork SDK fixture.",
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
  return { skills: loaded.skills, diagnostics: loaded.diagnostics, loader };
}
