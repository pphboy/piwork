import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  renameSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  inspectSkillTree,
  readRegularFileNoFollow,
  SkillTreeError,
  type SkillTreeInspection,
} from "./skill-tree.js";

export interface PublishedSkillArtifact {
  readonly name: string;
  readonly identity: string;
  readonly directory: string;
  readonly fileCount: number;
  readonly totalBytes: number;
}

export class SkillArtifactStore {
  readonly stagingDirectory: string;

  constructor(
    readonly rootDirectory: string,
    private readonly fault?: (step: "read" | "copy" | "hash" | "rename") => void,
  ) {
    mkdirSync(rootDirectory, { recursive: true, mode: 0o700 });
    this.stagingDirectory = join(rootDirectory, ".staging");
    mkdirSync(this.stagingDirectory, { recursive: true, mode: 0o700 });
  }

  import(sourcePath: string, expectedName?: string): PublishedSkillArtifact {
    const source = inspectSkillTree(sourcePath);
    if (expectedName !== undefined && source.name !== expectedName) {
      throw new SkillTreeError("SKILL_NAME_MISMATCH", "skillName", expectedName);
    }
    const stage = join(this.stagingDirectory, `${source.name}-${randomUUID()}`);
    try {
      mkdirSync(stage, { recursive: false, mode: 0o700 });
      for (const relativeDirectory of source.directories) {
        mkdirSync(join(stage, ...relativeDirectory.split("/")), { recursive: false, mode: 0o700 });
      }
      for (const file of source.files) {
        const destination = join(stage, ...file.relativePath.split("/"));
        // Opening without following links detects a source entry swapped after validation.
        this.fault?.("read");
        const bytes = readRegularFileNoFollow(file.absolutePath, file.size, source.name);
        mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
        this.fault?.("copy");
        requireWrite(destination, bytes);
      }
      this.fault?.("hash");
      const staged = inspectSkillTree(stage, { expectedName: source.name, requireAbsolute: true });
      if (staged.identity !== source.identity) throw new SkillTreeError("SKILL_TREE_UNSAFE", "path", source.name);
      const identitySegment = staged.identity.slice("sha256:".length);
      const artifactsDirectory = join(this.rootDirectory, source.name, "artifacts");
      const published = join(artifactsDirectory, identitySegment);
      mkdirSync(artifactsDirectory, { recursive: true, mode: 0o700 });
      try {
        this.fault?.("rename");
        renameSync(stage, published);
      } catch (error) {
        if (!existsDirectory(published)) throw error;
        const existing = inspectSkillTree(published, { expectedName: source.name });
        if (existing.identity !== staged.identity) throw new SkillTreeError("SKILL_TREE_UNSAFE", "path", source.name);
        rmSync(stage, { recursive: true, force: true });
      }
      return artifact(source.name, staged, published);
    } catch (error) {
      rmSync(stage, { recursive: true, force: true });
      throw error;
    }
  }

  inspect(name: string, identity: string): PublishedSkillArtifact {
    const directory = this.artifactDirectory(name, identity);
    const inspection = inspectSkillTree(directory, { expectedName: name });
    if (inspection.identity !== identity) throw new SkillTreeError("SKILL_TREE_UNSAFE", "path", name);
    return artifact(name, inspection, directory);
  }

  artifactDirectory(name: string, identity: string): string {
    if (!/^sha256:[a-f0-9]{64}$/.test(identity)) throw new SkillTreeError("SKILL_TREE_UNSAFE", "path", name);
    return join(this.rootDirectory, name, "artifacts", identity.slice("sha256:".length));
  }

  cleanupStaging(): void {
    mkdirSync(this.stagingDirectory, { recursive: true, mode: 0o700 });
    for (const entry of safeDirectoryNames(this.stagingDirectory)) {
      rmSync(join(this.stagingDirectory, entry), { recursive: true, force: true });
    }
  }

  removeArtifact(name: string, identity: string): void {
    rmSync(this.artifactDirectory(name, identity), { recursive: true, force: true });
  }

  cleanupOrphans(referenced: ReadonlySet<string>): void {
    this.cleanupStaging();
    for (const name of safeDirectoryNames(this.rootDirectory)) {
      if (name === ".staging") continue;
      const artifacts = join(this.rootDirectory, name, "artifacts");
      for (const segment of safeDirectoryNames(artifacts)) {
        const identity = `sha256:${segment}`;
        if (!referenced.has(`${name}\0${identity}`)) rmSync(join(artifacts, segment), { recursive: true, force: true });
      }
      if (safeDirectoryNames(artifacts).length === 0) rmSync(join(this.rootDirectory, name), { recursive: true, force: true });
    }
  }
}

function artifact(name: string, inspection: SkillTreeInspection, directory: string): PublishedSkillArtifact {
  return { name, identity: inspection.identity, directory, fileCount: inspection.fileCount, totalBytes: inspection.totalBytes };
}

function existsDirectory(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function safeDirectoryNames(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function requireWrite(path: string, bytes: Buffer): void {
  writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
}
