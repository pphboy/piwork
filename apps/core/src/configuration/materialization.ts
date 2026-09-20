import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { McpServer, WorkConfig } from "@piwork/contracts";
import type { PreparedArtifacts } from "./artifacts.js";

const CONTAINER_PATHS = {
  data: "/var/data",
  session: "/var/session",
  cache: "/var/cache",
  run: "/run/piwork",
} as const;

export interface RuntimeMaterializationSource {
  readSkill(catalogId: string, digest: string): Promise<Uint8Array>;
  readSecret(secretId: string): Promise<Uint8Array>;
}

export interface RuntimeMount {
  readonly source: string;
  readonly target: string;
  readonly readOnly: boolean;
}

export interface MaterializedRuntimeConfiguration {
  readonly root: string;
  readonly configPath: string;
  readonly mounts: readonly RuntimeMount[];
  readonly containerConfigPath: "/run/piwork/config.json";
}

interface RuntimeSecretFile {
  readonly secretId: string;
  readonly key?: string;
  readonly path: string;
}

interface MaterializedMcpServer extends Omit<McpServer, "secretRefs"> {
  readonly secretFiles: readonly RuntimeSecretFile[];
}

interface RuntimeConfigurationFile {
  readonly version: 1;
  readonly workId: string;
  readonly revision: number;
  readonly modelRef: string;
  readonly skills: readonly {
    readonly catalogId: string;
    readonly digest: string;
    readonly path: string;
  }[];
  readonly mcpServers: readonly MaterializedMcpServer[];
  readonly resources: WorkConfig["resources"];
  readonly tools: WorkConfig["tools"];
  readonly skillDiscovery: {
    readonly directories: readonly ["/run/piwork/skills"];
    readonly loadHostSkills: false;
  };
}

export class RuntimeConfigurationMaterializer {
  constructor(private readonly source: RuntimeMaterializationSource) {}

  async materialize(input: {
    readonly root: string;
    readonly workId: string;
    readonly configuration: WorkConfig;
    readonly artifacts: PreparedArtifacts;
  }): Promise<MaterializedRuntimeConfiguration> {
    if (input.configuration.revision !== input.artifacts.revision) {
      throw new Error("configuration and prepared artifact revisions differ");
    }
    if (input.workId !== input.artifacts.workId) {
      throw new Error("configuration and prepared artifacts belong to different Works");
    }

    const staging = `${input.root}.staging-${randomUUID()}`;
    const dataDir = join(staging, "data");
    const sessionDir = join(staging, "session");
    const cacheDir = join(staging, "cache");
    const runDir = join(staging, "run", "piwork");
    const skillsDir = join(runDir, "skills");
    const secretsDir = join(runDir, "secrets");

    await mkdir(dirname(input.root), { recursive: true, mode: 0o700 });
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await mkdir(sessionDir, { recursive: true, mode: 0o700 });
    await mkdir(cacheDir, { recursive: true, mode: 0o700 });
    await mkdir(skillsDir, { recursive: true, mode: 0o700 });
    await mkdir(secretsDir, { recursive: true, mode: 0o700 });

    try {
      const skills = [] as Array<{ catalogId: string; digest: string; path: string }>;
      for (const artifact of input.artifacts.skills) {
        assertSafeSegment(artifact.catalogId, "Skill catalog ID");
        const directory = join(skillsDir, artifact.catalogId);
        await mkdir(directory, { mode: 0o700 });
        const bytes = await this.source.readSkill(artifact.catalogId, artifact.digest);
        const file = join(directory, "SKILL.md");
        await writeRestrictedFile(file, bytes, 0o400);
        skills.push({
          catalogId: artifact.catalogId,
          digest: artifact.digest,
          path: `${CONTAINER_PATHS.run}/skills/${artifact.catalogId}/SKILL.md`,
        });
      }

      const mcpServers: MaterializedMcpServer[] = [];
      for (const server of input.configuration.mcpServers) {
        assertSafeSegment(server.serverId, "MCP server ID");
        const secretFiles: RuntimeSecretFile[] = [];
        for (const [index, reference] of (server.secretRefs ?? []).entries()) {
          const key = reference.key ?? `secret-${index + 1}`;
          assertSafeSegment(key, "secret key");
          const directory = join(secretsDir, server.serverId);
          await mkdir(directory, { recursive: true, mode: 0o700 });
          const file = join(directory, key);
          await writeRestrictedFile(file, await this.source.readSecret(reference.secretId), 0o400);
          secretFiles.push({
            secretId: reference.secretId,
            ...(reference.key === undefined ? {} : { key: reference.key }),
            path: `${CONTAINER_PATHS.run}/secrets/${server.serverId}/${key}`,
          });
        }
        const { secretRefs: _secretRefs, ...publicServer } = server;
        mcpServers.push({ ...publicServer, secretFiles });
      }

      const runtimeConfiguration: RuntimeConfigurationFile = {
        version: 1,
        workId: input.workId,
        revision: input.configuration.revision,
        modelRef: input.configuration.modelRef,
        skills,
        mcpServers,
        resources: input.configuration.resources,
        tools: input.configuration.tools,
        skillDiscovery: { directories: ["/run/piwork/skills"], loadHostSkills: false },
      };
      await writeRestrictedFile(
        join(runDir, "config.json"),
        new TextEncoder().encode(`${JSON.stringify(runtimeConfiguration, null, 2)}\n`),
        0o400,
      );
      await chmod(staging, 0o700);
      await rename(staging, input.root);
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }

    return {
      root: input.root,
      configPath: join(input.root, "run", "piwork", "config.json"),
      containerConfigPath: "/run/piwork/config.json",
      mounts: [
        { source: join(input.root, "data"), target: CONTAINER_PATHS.data, readOnly: false },
        { source: join(input.root, "session"), target: CONTAINER_PATHS.session, readOnly: false },
        { source: join(input.root, "cache"), target: CONTAINER_PATHS.cache, readOnly: false },
        { source: join(input.root, "run", "piwork"), target: CONTAINER_PATHS.run, readOnly: true },
      ],
    };
  }
}

async function writeRestrictedFile(path: string, bytes: Uint8Array, mode: number): Promise<void> {
  await writeFile(path, bytes, { flag: "wx", mode });
  await chmod(path, mode);
}

function assertSafeSegment(value: string, subject: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value) || value === "." || value === "..") {
    throw new Error(`${subject} is not a safe path segment`);
  }
}
