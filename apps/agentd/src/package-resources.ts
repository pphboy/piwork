import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  DefaultResourceLoader,
  SettingsManager,
  VERSION,
  type ResourceLoader,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import type { PiPackageArtifactMetadata, PiPackageSelectionEntry } from "@piwork/contracts";
import { assertPiPackageEnvironment, validatePiPackageArtifactSync } from "@piwork/pi-package";
import { BRAIN_PACKAGE_NAME } from "@piwork/contracts";
import { WEB_SLASH_COMMANDS, type SlashCommand } from "@piwork/contracts";
import type { ExperienceSnapshot, MemorySelection } from "@piwork/work-store";
import { brainPrompt, readBrainCognition } from "./brain-resources.js";

export interface PackageBinding {
  readonly name: string;
  readonly nameKey: string;
  readonly artifact: PiPackageArtifactMetadata;
}

export interface LoadedPackageResource {
  readonly name: string;
  readonly digest: string;
  readonly resourceCounts: PiPackageArtifactMetadata["resourceCounts"];
}

export function packageNameKey(name: string): string {
  return createHash("sha256").update(name).digest("hex");
}

/** Each call owns a fresh SDK loader and extension runtime. Only frozen, enabled roots are passed to Pi. */
export async function createPackageResourceLoader(input: {
  readonly root: string;
  readonly bindings: readonly PackageBinding[];
  readonly selection: readonly PiPackageSelectionEntry[];
  readonly standaloneSkills: readonly Skill[];
  readonly agentsMd: string;
  readonly workspace: string;
  readonly agentDirectory: string;
  readonly experience?: ExperienceSnapshot;
  readonly memorySelection?: MemorySelection|null;
}): Promise<{ readonly loader: ResourceLoader; readonly packages: readonly LoadedPackageResource[]; readonly resources: readonly { readonly packageName: string; readonly kind: string; readonly name: string }[]; readonly toolNames: ReadonlyMap<string, string>; readonly commands: readonly SlashCommand[] }> {
  if (input.bindings.length !== input.selection.length) throw new Error("package binding count mismatch");
  const enabledRoots: string[] = [];
  const packages: LoadedPackageResource[] = [];
  let cognition: string | undefined;
  for (const [index, selected] of input.selection.entries()) {
    const binding = input.bindings[index];
    if (!binding || binding.name !== selected.name || binding.artifact.name !== selected.name
      || binding.nameKey !== packageNameKey(selected.name)) throw new Error("package binding mismatch");
    const root = join(input.root, binding.nameKey);
    assertPiPackageEnvironment(binding.artifact.preparedEnvironment, { os: "linux",
      architecture: process.arch === "x64" ? "amd64" : process.arch,
      variant: null, nodeAbi: process.versions.modules, piSdkVersion: VERSION });
    validatePiPackageArtifactSync(root, binding.artifact);
    if (selected.enabled) {
      if (selected.name === BRAIN_PACKAGE_NAME) cognition = readBrainCognition(root);
      enabledRoots.push(realpathSync(root));
      packages.push({ name: selected.name, digest: binding.artifact.contentDigest, resourceCounts: binding.artifact.resourceCounts });
    }
  }
  const sdk = new DefaultResourceLoader({
    cwd: input.workspace,
    agentDir: input.agentDirectory,
    settingsManager: SettingsManager.inMemory(),
    additionalExtensionPaths: enabledRoots,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    agentsFilesOverride: () => ({ agentsFiles: [{ path: "/run/piwork/AGENTS.md", content: input.agentsMd }] }),
    skillsOverride: (result) => ({ skills: [...input.standaloneSkills, ...result.skills], diagnostics: result.diagnostics }),
    systemPromptOverride: () => undefined,
    appendSystemPromptOverride: () => cognition === undefined ? [] : brainPrompt(cognition, input.experience,input.memorySelection),
  });
  await sdk.reload();
  if (cognition !== undefined && input.standaloneSkills.some((skill) => skill.name === "deploy-work-service")) {
    throw new Error("Duplicate deploy-work-service Skill. Remove the standalone deploy-work-service from desired Skills and Apply again to use the Skill inside piwork-brain.");
  }
  const errors = [
    ...sdk.getExtensions().errors.map((item) => item.error),
    ...sdk.getSkills().diagnostics.filter((item) => item.type === "error" || item.type === "collision").map((item) => item.message),
    ...sdk.getPrompts().diagnostics.filter((item) => item.type === "error" || item.type === "collision").map((item) => item.message),
    ...sdk.getThemes().diagnostics.filter((item) => item.type === "error" || item.type === "collision").map((item) => item.message),
  ];
  if (errors.length > 0) throw new Error("required package resource failed to load");
  const allNames = new Set<string>();
  for (const skill of sdk.getSkills().skills) {
    if (allNames.has(`skill:${skill.name}`)) throw new Error(skill.name === "deploy-work-service"
      ? "Duplicate deploy-work-service Skill. Remove the standalone deploy-work-service from desired Skills and Apply again to use the Skill inside piwork-brain."
      : `duplicate package Skill ${skill.name}`);
    allNames.add(`skill:${skill.name}`);
  }
  for (const prompt of sdk.getPrompts().prompts) {
    if (allNames.has(`prompt:${prompt.name}`)) throw new Error(`duplicate package prompt ${prompt.name}`);
    allNames.add(`prompt:${prompt.name}`);
  }
  for (const theme of sdk.getThemes().themes) {
    if (allNames.has(`theme:${theme.name}`)) throw new Error(`duplicate package theme ${theme.name}`);
    allNames.add(`theme:${theme.name}`);
  }
  const tools = new Map<string, string>();
  const native = new Set<string>();
  const commands = new Set<string>();
  const resources: Array<{ packageName: string; kind: string; name: string }> = [];
  const owner = (path: string): string | undefined => {
    const index = enabledRoots.findIndex((root) => within(root, path));
    return index < 0 ? undefined : packages[index]!.name;
  };
  for (const extension of sdk.getExtensions().extensions) {
    const packageName = owner(extension.resolvedPath);
    if (!packageName) throw new Error("extension loaded outside enabled package roots");
    resources.push({ packageName, kind: "extension", name: extension.resolvedPath.slice(enabledRoots.find((root) => within(root, extension.resolvedPath))!.length + 1) });
    for (const name of extension.tools.keys()) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(name) || native.has(name)) throw new Error(`invalid or duplicate package tool ${name}`);
      native.add(name);
      tools.set(`package:${packageName}:${name}`, name);
    }
    for (const name of extension.commands.keys()) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(name) || commands.has(name)) throw new Error(`invalid or duplicate package command ${name}`);
      commands.add(name);
    }
  }
  for (const skill of sdk.getSkills().skills) {
    const packageName = owner(skill.filePath);
    if (packageName) resources.push({ packageName, kind: "skill", name: skill.name });
  }
  for (const prompt of sdk.getPrompts().prompts) {
    const packageName = owner(prompt.filePath);
    if (packageName) resources.push({ packageName, kind: "prompt", name: prompt.name });
  }
  for (const theme of sdk.getThemes().themes) {
    const packageName = theme.sourcePath ? owner(theme.sourcePath) : undefined;
    if (packageName) resources.push({ packageName, kind: "theme", name: theme.name ?? theme.sourcePath! });
  }
  for (const item of packages) {
    const actual = { extensions: resources.filter((r) => r.packageName === item.name && r.kind === "extension").length,
      skills: resources.filter((r) => r.packageName === item.name && r.kind === "skill").length,
      prompts: resources.filter((r) => r.packageName === item.name && r.kind === "prompt").length,
      themes: resources.filter((r) => r.packageName === item.name && r.kind === "theme").length };
    if ((["extensions", "skills", "prompts", "themes"] as const).some((kind) => actual[kind] !== item.resourceCounts[kind])) {
      throw new Error(`package resources differ from prepared inventory: ${item.name}`);
    }
  }
  const loader: ResourceLoader = {
    getExtensions: () => sdk.getExtensions(),
    getSkills: () => sdk.getSkills(),
    getPrompts: () => sdk.getPrompts(),
    getThemes: () => sdk.getThemes(),
    getAgentsFiles: () => sdk.getAgentsFiles(),
    getSystemPrompt: () => sdk.getSystemPrompt(),
    getSystemPromptSource: () => sdk.getSystemPromptSource(),
    getAppendSystemPrompt: () => sdk.getAppendSystemPrompt(),
    getAppendSystemPromptSources: () => sdk.getAppendSystemPromptSources(),
    extendResources: (paths) => {
      for (const item of [...(paths.skillPaths ?? []), ...(paths.promptPaths ?? []), ...(paths.themePaths ?? [])]) {
        if (!enabledRoots.some((root) => within(root, item.path))) throw new Error("dynamic package resource leaves enabled roots");
      }
      sdk.extendResources(paths);
    },
    reload: async () => { throw new Error("package resources cannot be reloaded inside a Work Session"); },
  };
  const callable = (name: string) => name.length <= 128 && /^[^\s/\\\u0000-\u001f]+$/.test(name);
  const slashCommands: SlashCommand[] = [];
  for (const skill of sdk.getSkills().skills) {
    if (callable(skill.name)) slashCommands.push({ kind: "skill", command: `/skill:${skill.name}`, name: skill.name,
      description: (skill.description ?? "").split(/[\r\n]/, 1)[0]!.slice(0, 2048), sourceName: owner(skill.filePath) ?? "Work skills" });
  }
  for (const prompt of sdk.getPrompts().prompts) {
    if (!callable(prompt.name) || prompt.name.startsWith("skill:") || (WEB_SLASH_COMMANDS as readonly string[]).includes(prompt.name) || commands.has(prompt.name)) continue;
    slashCommands.push({ kind: "prompt", command: `/${prompt.name}`, name: prompt.name,
      description: (prompt.description ?? "").split(/[\r\n]/, 1)[0]!.slice(0, 2048), sourceName: owner(prompt.filePath) ?? "Work prompts" });
  }
  slashCommands.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  return { loader, packages, resources, toolNames: tools, commands: slashCommands };
}

function within(root: string, path: string): boolean {
  let resolved: string;
  try { resolved = realpathSync(path); } catch { return false; }
  const rel = relative(root, resolved);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep));
}
