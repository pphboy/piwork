import { randomUUID } from "node:crypto";
import { chmod, cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type WorkConfig } from "@piwork/contracts";
import type { PreparedArtifacts } from "./artifacts.js";

const CONTAINER_PATHS = {
  data: "/var/data",
  session: "/var/session",
  cache: "/var/cache",
  run: "/run/piwork",
} as const;

export interface RuntimeMaterializationSource {
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

export class RuntimeConfigurationMaterializer {
  constructor(private readonly source: RuntimeMaterializationSource) {}

  async materialize(input: {
    readonly root: string;
    readonly workId: string;
    readonly configuration: WorkConfig;
    readonly artifacts: PreparedArtifacts;
    readonly contextDirectory: string;
  }): Promise<MaterializedRuntimeConfiguration> {
    if (input.workId !== input.artifacts.workId) {
      throw new Error("configuration and prepared artifacts belong to different Works");
    }

    const staging = `${input.root}.staging-${randomUUID()}`;
    const dataDir = join(staging, "data");
    const sessionDir = join(staging, "session");
    const cacheDir = join(staging, "cache");
    const runDir = join(staging, "run", "piwork");
    const secretsDir = join(runDir, "secrets");

    await mkdir(dirname(input.root), { recursive: true, mode: 0o700 });
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await mkdir(sessionDir, { recursive: true, mode: 0o700 });
    await mkdir(cacheDir, { recursive: true, mode: 0o700 });
    await mkdir(secretsDir, { recursive: true, mode: 0o700 });

    try {
      await cp(join(input.contextDirectory, "."), runDir, { recursive: true, force: false, verbatimSymlinks: true });

      for (const server of input.configuration.mcpServers) {
        assertSafeSegment(server.serverId, "MCP server ID");
        for (const [index, reference] of (server.secretRefs ?? []).entries()) {
          const key = reference.key ?? `secret-${index + 1}`;
          assertSafeSegment(key, "secret key");
          const directory = join(secretsDir, server.serverId);
          await mkdir(directory, { recursive: true, mode: 0o700 });
          const file = join(directory, key);
          await writeRestrictedFile(file, await this.source.readSecret(reference.secretId), 0o400);
        }
      }

      // The snapshot's config.json remains authoritative. Secret values are
      // materialized beside it and are never copied into that public file.
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
