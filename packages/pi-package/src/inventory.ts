import { matchesGlob } from "node:path";
import { PiPackageInputError, type PiPackageManifest } from "./manifest.js";

export type PiPackageResourceKind = "extensions" | "skills" | "prompts" | "themes";
export type PiPackageInventory = Readonly<Record<PiPackageResourceKind, readonly string[]>>;
export interface PiPackageTreePath { readonly path: string; readonly type: "directory" | "file" | "symlink" }

const KINDS = ["extensions", "skills", "prompts", "themes"] as const;

function skillEntries(pattern: string, matched: readonly string[], paths: readonly PiPackageTreePath[]): string[] {
  // Pi treats an explicit file as one resource. A directory contributes Skill
  // entrypoints, not every supporting file stored below it.
  if (paths.some((entry) => entry.path === pattern && entry.type !== "directory")) return [...matched];
  const wildcard = pattern.search(/[?*\[\]{}]/);
  const prefix = pattern.slice(0, wildcard < 0 ? pattern.length : wildcard);
  const root = wildcard < 0 ? prefix : prefix.slice(0, prefix.lastIndexOf("/") + 1).replace(/\/$/, "");
  const rootSkill = root ? `${root}/SKILL.md` : "SKILL.md";
  if (matched.includes(rootSkill)) return [rootSkill];
  return matched.filter((path) => {
    if (path.endsWith("/SKILL.md")) return true;
    const relative = root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
    return !relative.includes("/") && relative.endsWith(".md");
  });
}

function normalizedPattern(pattern: string): string {
  const normalized = pattern.replace(/^\.\//, "").replace(/\/$/, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\\") || normalized.split("/").some((part) => part === ".." || !part)) {
    throw new PiPackageInputError("PI_PACKAGE_INVALID_MANIFEST", "resource path is unsafe");
  }
  return normalized;
}

/** Static declared/convention inventory; actual SDK loading is a separate readiness step. */
export function inspectPiPackageResources(manifest: PiPackageManifest, paths: readonly PiPackageTreePath[]): PiPackageInventory {
  const available = paths.filter((entry) => entry.type !== "directory").map((entry) => entry.path).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const result = { extensions: [] as string[], skills: [] as string[], prompts: [] as string[], themes: [] as string[] };
  if (manifest.pi === null) {
    for (const path of available) {
      if (path.startsWith("extensions/") && /\.(?:ts|js)$/.test(path)) result.extensions.push(path);
      if (path.startsWith("skills/") && (path.endsWith("/SKILL.md") || /^skills\/[^/]+\.md$/.test(path))) result.skills.push(path);
      if (path.startsWith("prompts/") && path.endsWith(".md")) result.prompts.push(path);
      if (path.startsWith("themes/") && path.endsWith(".json")) result.themes.push(path);
    }
    return result;
  }
  for (const kind of KINDS) {
    const declarations = manifest.pi[kind] ?? [];
    const included = new Set<string>();
    for (const raw of declarations) {
      const excluded = raw.startsWith("!");
      const pattern = normalizedPattern(excluded ? raw.slice(1) : raw);
      const matchingSkillDirectories = kind === "skills" ? paths.filter((entry) => entry.type === "directory" && matchesGlob(entry.path, pattern)).map((entry) => entry.path) : [];
      const matchingFiles = available.filter((path) => path === pattern || path.startsWith(`${pattern}/`) || matchesGlob(path, pattern)
        || matchingSkillDirectories.some((directory) => path.startsWith(`${directory}/`)));
      const matched = kind === "skills" && !excluded ? skillEntries(pattern, matchingFiles, paths) : matchingFiles;
      if (!excluded && matched.length === 0) throw new PiPackageInputError("PI_PACKAGE_INVALID_MANIFEST", `${kind} declaration has no matching resource`);
      for (const path of matched) excluded ? included.delete(path) : included.add(path);
    }
    result[kind] = [...included].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  }
  return result;
}
