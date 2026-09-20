import {
  createExtensionRuntime,
  loadSkillsFromDir,
  type ResourceLoader,
  type Skill,
} from "@earendil-works/pi-coding-agent";

export function loadIsolatedSkills(skillDir: string): { readonly skills: Skill[]; readonly loader: ResourceLoader } {
  const loaded = loadSkillsFromDir({ dir: skillDir, source: "piwork-artifact" });
  const loader: ResourceLoader = {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => loaded,
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => "You are the deterministic piwork SDK fixture.",
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
  return { skills: loaded.skills, loader };
}
