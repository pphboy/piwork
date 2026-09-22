import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { realpath, statfs } from "node:fs/promises";
import { posix, relative, resolve } from "node:path";

export const MANAGED_LABEL = "piwork.managed";
export const WORK_LABEL = "piwork.work_id";
export const RESOURCE_KIND_LABEL = "piwork.resource_kind";
export const LOGICAL_ID_LABEL = "piwork.logical_id";
export const SPEC_HASH_LABEL = "piwork.spec_hash";
export const NETWORK_KIND_LABEL = "piwork.network_kind";
export const VOLUME_KIND_LABEL = "piwork.volume_kind";

export type DockerResourceKind = "agent" | "service";

export interface DockerCommandRunner {
  run(args: readonly string[], timeoutMs?: number): Promise<string>;
}

export interface DockerContainerSpec {
  readonly workId: string;
  readonly kind: DockerResourceKind;
  readonly logicalId: string;
  readonly image: string;
  readonly command?: readonly string[];
  readonly entrypoint?: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly labels?: Readonly<Record<string, string>>;
  readonly cpuMillis?: number;
  readonly memoryBytes?: number;
  readonly user?: string;
  readonly workingDirectory?: string;
  /** Trusted Core-authored host route. Only agent containers may receive it. */
  readonly controlHost?: { readonly hostname: string; readonly address: "host-gateway" };
  readonly network?: {
    readonly name: string;
    readonly workId: string;
    readonly aliases?: readonly string[];
  };
  readonly mounts?: readonly {
    readonly type: "bind" | "volume" | "tmpfs";
    readonly source?: string;
    readonly target: string;
    readonly readOnly?: boolean;
  }[];
}

export interface PreparedImage {
  readonly reference: string;
  readonly imageId: string;
  readonly repoDigests: readonly string[];
}

export interface EnsuredContainer {
  readonly containerId: string;
  readonly name: string;
  readonly created: boolean;
  readonly specHash: string;
}

export interface ContainerInspection {
  readonly exists: boolean;
  readonly containerId?: string;
  readonly name?: string;
  readonly running?: boolean;
  readonly status?: string;
  readonly exitCode?: number;
  readonly specHash?: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly image?: string;
  readonly user?: string;
  readonly mounts?: readonly { readonly type: string; readonly source: string; readonly destination: string; readonly readOnly: boolean }[];
  readonly networkAddresses?: Readonly<Record<string, string>>;
}

export interface ContainerLogCollection {
  readonly text: string;
  readonly truncated: boolean;
}

export interface EnsuredWorkNetwork {
  readonly networkId: string;
  readonly name: string;
  readonly created: boolean;
}

export interface EnsuredManagedVolume {
  readonly volumeName: string;
  readonly created: boolean;
}

export class DockerRuntimeError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(message);
    this.name = "DockerRuntimeError";
  }
}

export class DockerSpecConflictError extends Error {
  constructor(readonly logicalId: string) {
    super(`container ${logicalId} already exists with a different immutable specification`);
    this.name = "DockerSpecConflictError";
  }
}

export type DockerDependencyReason =
  | "RESOURCE_MISSING"
  | "RUNTIME_UNAVAILABLE"
  | "VOLUME_NOT_WRITABLE"
  | "DISK_INSUFFICIENT"
  | "STATE_UNKNOWN";

export class DockerDependencyError extends Error {
  constructor(
    readonly reason: DockerDependencyReason,
    message: string,
    readonly retryable: boolean,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DockerDependencyError";
  }
}

export class DockerRuntime {
  constructor(
    readonly installationId: string,
    private readonly runner: DockerCommandRunner = new DockerCliRunner(),
    private readonly allowedBindRoots: readonly string[] = [],
  ) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(installationId)) {
      throw new Error("installationId contains unsupported Docker label characters");
    }
  }

  async prepareImage(reference: string): Promise<PreparedImage> {
    try {
      return await this.inspectImage(reference);
    } catch (error) {
      if (!(error instanceof DockerDependencyError && error.reason === "RESOURCE_MISSING")) throw error;
      await this.run(["image", "pull", reference]);
      return this.inspectImage(reference);
    }
  }

  async ensureContainer(spec: DockerContainerSpec): Promise<EnsuredContainer> {
    validateIdentity(spec.workId, "workId");
    validateIdentity(spec.logicalId, "logicalId");
    const specHash = hashSpec(spec);
    if (spec.network !== undefined) await this.assertManagedWorkNetwork(spec.network.name, spec.workId, spec.network.workId);
    await this.validateMounts(spec.workId, spec.mounts ?? []);
    const existing = await this.find(spec.workId, spec.kind, spec.logicalId);
    if (existing.length > 1) throw new Error(`multiple containers claim logical identity ${spec.logicalId}`);
    if (existing.length === 1) return this.adopt(existing[0]!, spec, specHash);

    const name = containerName(this.installationId, spec);
    const labels = {
      ["piwork.installation_id"]: this.installationId,
      [MANAGED_LABEL]: "true",
      [WORK_LABEL]: spec.workId,
      [RESOURCE_KIND_LABEL]: spec.kind,
      [LOGICAL_ID_LABEL]: spec.logicalId,
      [SPEC_HASH_LABEL]: specHash,
      ...spec.labels,
    };
    const args = ["container", "create", "--name", name];
    const cpuMillis = spec.cpuMillis ?? 100;
    const memoryBytes = spec.memoryBytes ?? 64 * 1_024 * 1_024;
    const user = spec.user ?? "65532:65532";
    validateResources(cpuMillis, memoryBytes, user);
    if (spec.workingDirectory !== undefined && (!spec.workingDirectory.startsWith("/") || posix.normalize(spec.workingDirectory) !== spec.workingDirectory)) {
      throw new Error("workingDirectory must be a canonical absolute path");
    }
    if (spec.controlHost !== undefined && spec.kind !== "agent") throw new Error("controlHost is restricted to agent containers");
    args.push(
      "--cpus", (cpuMillis / 1_000).toFixed(3),
      "--memory", `${memoryBytes}b`,
      "--user", user,
      "--restart", "no",
      "--read-only",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges:true",
      "--pids-limit", "512",
    );
    if (spec.workingDirectory !== undefined) args.push("--workdir", spec.workingDirectory);
    if (spec.controlHost !== undefined) {
      validateIdentity(spec.controlHost.hostname, "control host name");
      args.push("--add-host", `${spec.controlHost.hostname}:${spec.controlHost.address}`);
    }
    for (const [key, value] of Object.entries(labels).sort(([left], [right]) => left.localeCompare(right))) {
      args.push("--label", `${key}=${value}`);
    }
    for (const [key, value] of Object.entries(spec.environment ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
      args.push("--env", `${key}=${value}`);
    }
    if (spec.network !== undefined) {
      args.push("--network", spec.network.name);
      for (const alias of spec.network.aliases ?? []) {
        validateIdentity(alias, "network alias");
        args.push("--network-alias", alias);
      }
    }
    const entrypointArgs = spec.entrypoint?.slice(1) ?? [];
    if (spec.entrypoint !== undefined) {
      if (spec.entrypoint.length === 0) throw new Error("entrypoint must contain an executable");
      args.push("--entrypoint", spec.entrypoint[0]!);
    }
    for (const mount of spec.mounts ?? []) args.push("--mount", renderMount(mount));
    args.push(spec.image, ...entrypointArgs, ...(spec.command ?? []));

    try {
      const containerId = (await this.run(args)).trim();
      return { containerId, name, created: true, specHash };
    } catch (error) {
      if (!(error instanceof DockerRuntimeError) || !/already in use|Conflict/i.test(error.stderr)) throw error;
      const raced = await this.find(spec.workId, spec.kind, spec.logicalId);
      if (raced.length !== 1) throw error;
      return this.adopt(raced[0]!, spec, specHash);
    }
  }

  async ensureWorkNetwork(workId: string): Promise<EnsuredWorkNetwork> {
    validateIdentity(workId, "workId");
    const existing = await this.findWorkNetworks(workId);
    if (existing.length > 1) throw new Error(`multiple Docker networks claim Work ${workId}`);
    if (existing.length === 1) {
      const inspection = await this.inspectNetwork(existing[0]!);
      return { networkId: inspection.Id, name: inspection.Name, created: false };
    }

    const name = workNetworkName(this.installationId, workId);
    const args = [
      "network", "create",
      "--driver", "bridge",
      "--label", `piwork.installation_id=${this.installationId}`,
      "--label", `${MANAGED_LABEL}=true`,
      "--label", `${WORK_LABEL}=${workId}`,
      "--label", `${NETWORK_KIND_LABEL}=work-private`,
      name,
    ];
    try {
      const networkId = (await this.run(args)).trim();
      return { networkId, name, created: true };
    } catch (error) {
      if (!(error instanceof DockerRuntimeError) || !/already exists|Conflict/i.test(error.stderr)) throw error;
      const raced = await this.findWorkNetworks(workId);
      if (raced.length !== 1) throw error;
      const inspection = await this.inspectNetwork(raced[0]!);
      return { networkId: inspection.Id, name: inspection.Name, created: false };
    }
  }

  async deleteWorkNetwork(workId: string): Promise<void> {
    const existing = await this.findWorkNetworks(workId);
    if (existing.length === 0) return;
    if (existing.length > 1) throw new Error(`multiple Docker networks claim Work ${workId}`);
    await this.run(["network", "rm", existing[0]!]);
  }

  async ensureManagedVolume(workId: string, logicalId: string): Promise<EnsuredManagedVolume> {
    validateIdentity(workId, "workId");
    validateIdentity(logicalId, "volume logicalId");
    const existing = await this.findManagedVolumes(workId, logicalId);
    if (existing.length > 1) throw new Error(`multiple Docker volumes claim logical identity ${logicalId}`);
    if (existing.length === 1) return { volumeName: existing[0]!, created: false };

    const name = managedVolumeName(this.installationId, workId, logicalId);
    const args = [
      "volume", "create",
      "--label", `piwork.installation_id=${this.installationId}`,
      "--label", `${MANAGED_LABEL}=true`,
      "--label", `${WORK_LABEL}=${workId}`,
      "--label", `${LOGICAL_ID_LABEL}=${logicalId}`,
      "--label", `${VOLUME_KIND_LABEL}=managed-data`,
      name,
    ];
    try {
      const volumeName = (await this.run(args)).trim();
      return { volumeName, created: true };
    } catch (error) {
      if (!(error instanceof DockerRuntimeError) || !/already exists|Conflict/i.test(error.stderr)) throw error;
      const raced = await this.findManagedVolumes(workId, logicalId);
      if (raced.length !== 1) throw error;
      return { volumeName: raced[0]!, created: false };
    }
  }

  async deleteManagedVolume(workId: string, logicalId: string): Promise<void> {
    const existing = await this.findManagedVolumes(workId, logicalId);
    if (existing.length === 0) return;
    if (existing.length > 1) throw new Error(`multiple Docker volumes claim logical identity ${logicalId}`);
    await this.run(["volume", "rm", existing[0]!]);
  }

  async requireManagedVolume(workId: string, logicalId: string): Promise<EnsuredManagedVolume> {
    const existing = await this.findManagedVolumes(workId, logicalId);
    if (existing.length === 0) {
      throw new DockerDependencyError("RESOURCE_MISSING", `managed volume ${logicalId} is missing`, false);
    }
    if (existing.length > 1) throw new DockerDependencyError("STATE_UNKNOWN", `multiple volumes claim ${logicalId}`, false);
    return { volumeName: existing[0]!, created: false };
  }

  async assertManagedVolumeWritable(workId: string, logicalId: string, image = "ubuntu:22.04"): Promise<void> {
    const volume = await this.requireManagedVolume(workId, logicalId);
    const marker = `.piwork-write-probe-${randomUUID()}`;
    try {
      await this.run([
        "container", "run", "--rm",
        "--label", `piwork.installation_id=${this.installationId}`,
        "--user", "65532:65532",
        "--read-only",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges:true",
        "--mount", `type=volume,src=${volume.volumeName},dst=/probe`,
        image, "sh", "-c", `touch /probe/${marker} && rm /probe/${marker}`,
      ]);
    } catch (error) {
      if (error instanceof DockerDependencyError && error.reason === "VOLUME_NOT_WRITABLE") throw error;
      if (error instanceof DockerRuntimeError && /permission denied|read-only file system/i.test(error.stderr)) {
        throw new DockerDependencyError("VOLUME_NOT_WRITABLE", `managed volume ${logicalId} is not writable`, false, error);
      }
      throw error;
    }
  }

  async initializeManagedVolume(
    workId: string,
    logicalId: string,
    image: string,
    owner = "10001:10001",
  ): Promise<void> {
    if (!/^[0-9]+:[0-9]+$/.test(owner)) throw new Error("volume owner must be a numeric uid:gid");
    const volume = await this.requireManagedVolume(workId, logicalId);
    const helperName = `${managedVolumeName(this.installationId, workId, logicalId)}-init`;
    const args = [
      "container", "run", "--rm", "--name", helperName,
      "--user", "0:0",
      "--network", "none", "--read-only", "--cap-drop", "ALL", "--cap-add", "CHOWN",
      "--security-opt", "no-new-privileges:true", "--pids-limit", "32",
      "--label", `piwork.installation_id=${this.installationId}`,
      "--label", `${MANAGED_LABEL}=true`, "--label", `${WORK_LABEL}=${workId}`,
      "--label", `${RESOURCE_KIND_LABEL}=volume-init`, "--label", `${LOGICAL_ID_LABEL}=${logicalId}`,
      "--mount", `type=volume,src=${volume.volumeName},dst=/target`,
      "--entrypoint", "/bin/chown", image, owner, "/target",
    ];
    try {
      await this.run(args, 30_000);
    } catch (error) {
      await this.run(["container", "rm", "--force", helperName], 5_000).catch(() => undefined);
      throw error;
    }
  }

  async assertDiskCapacity(requiredBytes: number): Promise<number> {
    if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 0) throw new Error("requiredBytes must be a non-negative safe integer");
    const dockerRoot = (await this.run(["info", "--format", "{{.DockerRootDir}}"])).trim();
    const statistics = await statfs(dockerRoot);
    const availableBytes = statistics.bavail * statistics.bsize;
    if (availableBytes < requiredBytes) {
      throw new DockerDependencyError(
        "DISK_INSUFFICIENT",
        `Docker storage has ${availableBytes} bytes available; ${requiredBytes} required`,
        true,
      );
    }
    return availableBytes;
  }

  async startContainer(workId: string, kind: DockerResourceKind, logicalId: string): Promise<ContainerInspection> {
    const found = await this.findOne(workId, kind, logicalId);
    if (found === undefined) return { exists: false };
    const current = await this.inspectExpected(found, workId, kind, logicalId);
    if (!current.running) await this.run(["container", "start", found]);
    return this.inspectExpected(found, workId, kind, logicalId);
  }

  async inspectContainer(workId: string, kind: DockerResourceKind, logicalId: string, timeoutMs?: number): Promise<ContainerInspection> {
    const found = await this.findOne(workId, kind, logicalId, timeoutMs);
    return found === undefined ? { exists: false } : this.inspectExpected(found, workId, kind, logicalId, timeoutMs);
  }

  /**
   * Reads only logs from the exact currently-owned container identity.  The
   * caller receives a bounded tail so an agent failure cannot exhaust Core.
   */
  async collectContainerLogs(
    workId: string,
    kind: DockerResourceKind,
    logicalId: string,
    tail = 200,
    expectedContainerId?: string,
  ): Promise<ContainerLogCollection> {
    const found = await this.findOne(workId, kind, logicalId, 2_000);
    if (found === undefined) return { text: "", truncated: false };
    if (expectedContainerId !== undefined && !sameContainerId(found, expectedContainerId)) {
      throw new Error("Docker container identity changed before log collection");
    }
    const immutableId = expectedContainerId ?? found;
    await this.inspectExpected(immutableId, workId, kind, logicalId, 2_000);
    const output = await this.run(["container", "logs", "--tail", String(Math.min(Math.max(tail, 1), 200)), immutableId], 2_000);
    const bytes = Buffer.from(output, "utf8");
    if (bytes.length <= 64 * 1024) return { text: output, truncated: false };
    return { text: bytes.subarray(bytes.length - 64 * 1024).toString("utf8"), truncated: true };
  }

  async execContainer(
    workId: string,
    kind: DockerResourceKind,
    logicalId: string,
    command: readonly string[],
    timeoutMs = 2_000,
  ): Promise<string> {
    if (command.length === 0 || command.length > 128) throw new Error("exec command is outside policy");
    const found = await this.findOne(workId, kind, logicalId, timeoutMs);
    if (found === undefined) throw new Error(`container ${logicalId} does not exist`);
    const container = await this.inspectExpected(found, workId, kind, logicalId, timeoutMs);
    if (!container.running || container.containerId === undefined) throw new Error(`container ${logicalId} is not running`);
    return this.run(["container", "exec", container.containerId, ...command], Math.min(timeoutMs, 2_000));
  }

  async stopContainer(
    workId: string,
    kind: DockerResourceKind,
    logicalId: string,
    timeoutSeconds = 10,
  ): Promise<ContainerInspection> {
    const found = await this.findOne(workId, kind, logicalId);
    if (found === undefined) return { exists: false };
    const current = await this.inspectExpected(found, workId, kind, logicalId);
    if (current.running) await this.run(["container", "stop", "--time", String(timeoutSeconds), found]);
    return this.inspectExpected(found, workId, kind, logicalId);
  }

  async deleteContainer(workId: string, kind: DockerResourceKind, logicalId: string): Promise<void> {
    const found = await this.findOne(workId, kind, logicalId);
    if (found === undefined) return;
    const current = await this.inspectExpected(found, workId, kind, logicalId);
    if (current.running) throw new Error(`refusing to delete running container ${logicalId}`);
    await this.run(["container", "rm", found]);
  }

  async listManagedContainers(kind?: DockerResourceKind): Promise<ContainerInspection[]> {
    const args = ["container", "ls", "--all", "--quiet", "--filter", `label=piwork.installation_id=${this.installationId}`, "--filter", `label=${MANAGED_LABEL}=true`];
    if (kind !== undefined) args.push("--filter", `label=${RESOURCE_KIND_LABEL}=${kind}`);
    const identifiers = (await this.run(args)).split("\n").map((line) => line.trim()).filter(Boolean);
    return Promise.all(identifiers.map((identifier) => this.inspectById(identifier)));
  }

  private async inspectImage(reference: string): Promise<PreparedImage> {
    const output = await this.run(["image", "inspect", reference]);
    const records = JSON.parse(output) as Array<{ Id: string; RepoDigests?: string[] }>;
    const image = records[0];
    if (image === undefined) throw new Error(`Docker returned no inspection result for image ${reference}`);
    return { reference, imageId: image.Id, repoDigests: image.RepoDigests ?? [] };
  }

  private async adopt(containerId: string, spec: DockerContainerSpec, specHash: string): Promise<EnsuredContainer> {
    const inspection = await this.inspectRaw(containerId);
    this.assertManagedIdentity(inspection, spec.workId, spec.kind, spec.logicalId);
    if (inspection.Config.Labels?.[SPEC_HASH_LABEL] !== specHash) throw new DockerSpecConflictError(spec.logicalId);
    return {
      containerId: inspection.Id,
      name: inspection.Name.replace(/^\//, ""),
      created: false,
      specHash,
    };
  }

  private async findOne(workId: string, kind: DockerResourceKind, logicalId: string, timeoutMs?: number): Promise<string | undefined> {
    const found = await this.find(workId, kind, logicalId, timeoutMs);
    if (found.length > 1) throw new Error(`multiple containers claim logical identity ${logicalId}`);
    return found[0];
  }

  private async find(workId: string, kind: DockerResourceKind, logicalId: string, timeoutMs?: number): Promise<string[]> {
    const output = await this.run([
      "container", "ls", "--all", "--quiet",
      "--filter", `label=piwork.installation_id=${this.installationId}`,
      "--filter", `label=${MANAGED_LABEL}=true`,
      "--filter", `label=${WORK_LABEL}=${workId}`,
      "--filter", `label=${RESOURCE_KIND_LABEL}=${kind}`,
      "--filter", `label=${LOGICAL_ID_LABEL}=${logicalId}`,
    ], timeoutMs);
    return output.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  private async assertManagedWorkNetwork(name: string, containerWorkId: string, declaredWorkId: string): Promise<void> {
    if (containerWorkId !== declaredWorkId) throw new Error("container cannot join another Work network");
    const inspection = await this.inspectNetwork(name);
    const labels = inspection.Labels ?? {};
    if (
      labels["piwork.installation_id"] !== this.installationId
      || labels[MANAGED_LABEL] !== "true"
      || labels[WORK_LABEL] !== containerWorkId
      || labels[NETWORK_KIND_LABEL] !== "work-private"
    ) {
      throw new Error("container network is not the managed private network for this Work");
    }
  }

  private async findWorkNetworks(workId: string): Promise<string[]> {
    const output = await this.run([
      "network", "ls", "--quiet",
      "--filter", `label=piwork.installation_id=${this.installationId}`,
      "--filter", `label=${MANAGED_LABEL}=true`,
      "--filter", `label=${WORK_LABEL}=${workId}`,
      "--filter", `label=${NETWORK_KIND_LABEL}=work-private`,
    ]);
    return output.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  private async inspectNetwork(idOrName: string): Promise<RawNetworkInspection> {
    const output = await this.run(["network", "inspect", idOrName]);
    const records = JSON.parse(output) as RawNetworkInspection[];
    const inspection = records[0];
    if (inspection === undefined) throw new Error(`Docker returned no network inspection result for ${idOrName}`);
    return inspection;
  }

  private async validateMounts(
    workId: string,
    mounts: readonly NonNullable<DockerContainerSpec["mounts"]>[number][],
  ): Promise<void> {
    const targets = new Set<string>();
    for (const mount of mounts) {
      if (!mount.target.startsWith("/") || posix.normalize(mount.target) !== mount.target || mount.target === "/") {
        throw new Error(`unsafe container mount target: ${mount.target}`);
      }
      if (targets.has(mount.target)) throw new Error(`duplicate container mount target: ${mount.target}`);
      targets.add(mount.target);
      if (mount.type !== "volume") continue;
      if (mount.source === undefined) throw new Error("volume mount requires a source");
      const inspection = await this.inspectVolume(mount.source);
      const labels = inspection.Labels ?? {};
      if (
        labels["piwork.installation_id"] !== this.installationId
        || labels[MANAGED_LABEL] !== "true"
        || labels[WORK_LABEL] !== workId
        || labels[VOLUME_KIND_LABEL] !== "managed-data"
      ) {
        throw new Error("container volume is not managed for this Work");
      }
    }
    for (const mount of mounts) {
      if (mount.type !== "bind") continue;
      if (mount.source === undefined) throw new Error("bind mount requires a source");
      if (mount.source === "/var/run/docker.sock" || mount.source === "/run/docker.sock") {
        throw new Error("Docker socket mounts are forbidden");
      }
      const source = await realpath(mount.source);
      const allowed = await Promise.all(this.allowedBindRoots.map(async (root) => realpath(root)));
      if (!allowed.some((root) => isWithin(root, source))) {
        throw new Error("bind mount source is outside configured runtime roots");
      }
    }
  }

  private async findManagedVolumes(workId: string, logicalId: string): Promise<string[]> {
    const output = await this.run([
      "volume", "ls", "--quiet",
      "--filter", `label=piwork.installation_id=${this.installationId}`,
      "--filter", `label=${MANAGED_LABEL}=true`,
      "--filter", `label=${WORK_LABEL}=${workId}`,
      "--filter", `label=${LOGICAL_ID_LABEL}=${logicalId}`,
      "--filter", `label=${VOLUME_KIND_LABEL}=managed-data`,
    ]);
    return output.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  private async inspectVolume(name: string): Promise<RawVolumeInspection> {
    const output = await this.run(["volume", "inspect", name]);
    const records = JSON.parse(output) as RawVolumeInspection[];
    const inspection = records[0];
    if (inspection === undefined) throw new Error(`Docker returned no volume inspection result for ${name}`);
    return inspection;
  }

  private async inspectById(containerId: string): Promise<ContainerInspection> {
    const inspection = await this.inspectRaw(containerId);
    this.assertManagedIdentity(inspection);
    return this.toContainerInspection(inspection);
  }

  private async inspectExpected(
    containerId: string,
    workId: string,
    kind: DockerResourceKind,
    logicalId: string,
    timeoutMs?: number,
  ): Promise<ContainerInspection> {
    const inspection = await this.inspectRaw(containerId, timeoutMs);
    this.assertManagedIdentity(inspection, workId, kind, logicalId);
    return this.toContainerInspection(inspection);
  }

  private assertManagedIdentity(
    inspection: RawContainerInspection,
    workId?: string,
    kind?: DockerResourceKind,
    logicalId?: string,
  ): void {
    const labels = inspection.Config.Labels ?? {};
    if (labels["piwork.installation_id"] !== this.installationId || labels[MANAGED_LABEL] !== "true") {
      throw new Error("Docker container is not managed by this installation");
    }
    if ((workId !== undefined && labels[WORK_LABEL] !== workId)
      || (kind !== undefined && labels[RESOURCE_KIND_LABEL] !== kind)
      || (logicalId !== undefined && labels[LOGICAL_ID_LABEL] !== logicalId)) {
      throw new Error("Docker container identity does not match the requested Work resource");
    }
  }

  private toContainerInspection(inspection: RawContainerInspection): ContainerInspection {
    return {
      exists: true,
      containerId: inspection.Id,
      name: inspection.Name.replace(/^\//, ""),
      running: inspection.State.Running,
      status: inspection.State.Status,
      exitCode: inspection.State.ExitCode,
      specHash: inspection.Config.Labels?.[SPEC_HASH_LABEL],
      labels: inspection.Config.Labels ?? {},
      image: inspection.Image,
      user: inspection.Config.User,
      mounts: (inspection.Mounts ?? []).map((mount) => ({
        type: mount.Type,
        source: mount.Type === "volume" && mount.Name !== undefined ? mount.Name : mount.Source,
        destination: mount.Destination,
        readOnly: !mount.RW,
      })),
      networkAddresses: Object.fromEntries(Object.entries(inspection.NetworkSettings?.Networks ?? {}).map(([name, network]) => [name, network.IPAddress])),
    };
  }

  private async inspectRaw(containerId: string, timeoutMs?: number): Promise<RawContainerInspection> {
    const output = await this.run(["container", "inspect", containerId], timeoutMs);
    const records = JSON.parse(output) as RawContainerInspection[];
    const inspection = records[0];
    if (inspection === undefined) throw new Error(`Docker returned no inspection result for ${containerId}`);
    return inspection;
  }

  private async run(args: readonly string[], timeoutMs?: number): Promise<string> {
    try {
      return await this.runner.run(args, timeoutMs);
    } catch (error) {
      if (!(error instanceof DockerRuntimeError)) throw error;
      const mapped = mapDockerError(error);
      throw mapped;
    }
  }
}

interface RawContainerInspection {
  readonly Id: string;
  readonly Image: string;
  readonly Name: string;
  readonly Config: { readonly Labels?: Readonly<Record<string, string>>; readonly Image?: string; readonly User?: string };
  readonly State: { readonly Running: boolean; readonly Status: string; readonly ExitCode: number };
  readonly Mounts?: readonly { readonly Type: string; readonly Name?: string; readonly Source: string; readonly Destination: string; readonly RW: boolean }[];
  readonly NetworkSettings?: { readonly Networks?: Readonly<Record<string, { readonly IPAddress: string }>> };
}

interface RawNetworkInspection {
  readonly Id: string;
  readonly Name: string;
  readonly Labels?: Readonly<Record<string, string>>;
}

interface RawVolumeInspection {
  readonly Name: string;
  readonly Labels?: Readonly<Record<string, string>>;
}

class DockerCliRunner implements DockerCommandRunner {
  run(args: readonly string[], timeoutMs?: number): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile("docker", [...args], { encoding: "utf8", maxBuffer: 16 * 1_024 * 1_024, ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }) }, (error, stdout, stderr) => {
        if (error === null) resolve(args[0] === "container" && args[1] === "logs" ? `${stdout}${stderr}` : stdout);
        else reject(new DockerRuntimeError(
          `docker ${args.slice(0, 2).join(" ")} failed`,
          args,
          stderr,
          typeof error.code === "number" ? error.code : null,
        ));
      });
    });
  }
}

function sameContainerId(left: string, right: string): boolean {
  return left === right || left.startsWith(right) || right.startsWith(left);
}

function hashSpec(spec: DockerContainerSpec): string {
  const canonical = {
    workId: spec.workId,
    kind: spec.kind,
    logicalId: spec.logicalId,
    image: spec.image,
    command: spec.command ?? [],
    entrypoint: spec.entrypoint ?? [],
    environment: sortedRecord(spec.environment ?? {}),
    labels: sortedRecord(spec.labels ?? {}),
    cpuMillis: spec.cpuMillis ?? 100,
    memoryBytes: spec.memoryBytes ?? 64 * 1_024 * 1_024,
    user: spec.user ?? "65532:65532",
    workingDirectory: spec.workingDirectory ?? null,
    controlHost: spec.controlHost ?? null,
    network: spec.network === undefined ? null : {
      name: spec.network.name,
      workId: spec.network.workId,
      aliases: [...(spec.network.aliases ?? [])].sort(),
    },
    mounts: spec.mounts ?? [],
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function sortedRecord(input: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
}

function containerName(installationId: string, spec: DockerContainerSpec): string {
  const suffix = createHash("sha256")
    .update(`${installationId}\0${spec.workId}\0${spec.kind}\0${spec.logicalId}`)
    .digest("hex")
    .slice(0, 16);
  return `piwork-${spec.kind}-${suffix}`;
}

function workNetworkName(installationId: string, workId: string): string {
  const suffix = createHash("sha256").update(`${installationId}\0${workId}\0network`).digest("hex").slice(0, 16);
  return `piwork-net-${suffix}`;
}

export function managedVolumeName(installationId: string, workId: string, logicalId: string): string {
  const suffix = createHash("sha256")
    .update(`${installationId}\0${workId}\0volume\0${logicalId}`)
    .digest("hex")
    .slice(0, 16);
  return `piwork-vol-${suffix}`;
}

function renderMount(mount: NonNullable<DockerContainerSpec["mounts"]>[number]): string {
  if (!mount.target.startsWith("/")) throw new Error("container mount target must be absolute");
  if (mount.type !== "tmpfs" && (mount.source === undefined || mount.source.length === 0)) {
    throw new Error(`${mount.type} mount requires a source`);
  }
  const fields = [`type=${mount.type}`];
  if (mount.source !== undefined) fields.push(`src=${mount.source}`);
  fields.push(`dst=${mount.target}`);
  if (mount.type === "volume") fields.push("volume-nocopy");
  if (mount.readOnly) fields.push("readonly");
  return fields.join(",");
}

function validateIdentity(value: string, subject: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)) throw new Error(`${subject} is invalid`);
}

function validateResources(cpuMillis: number, memoryBytes: number, user: string): void {
  if (!Number.isInteger(cpuMillis) || cpuMillis < 10 || cpuMillis > 128_000) throw new Error("cpuMillis is outside policy");
  if (!Number.isInteger(memoryBytes) || memoryBytes < 16 * 1_024 * 1_024) throw new Error("memoryBytes is outside policy");
  const uid = user.split(":", 1)[0];
  if (uid === undefined || !/^[0-9]+$/.test(uid) || Number(uid) === 0) throw new Error("managed containers require a non-root numeric user");
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (!path.startsWith("..") && !path.startsWith("/"));
}

function mapDockerError(error: DockerRuntimeError): DockerRuntimeError | DockerDependencyError {
  const detail = `${error.message}\n${error.stderr}`;
  if (/cannot connect to the docker daemon|is the docker daemon running|connection refused|error during connect/i.test(detail)) {
    return new DockerDependencyError("RUNTIME_UNAVAILABLE", "Docker runtime is unavailable", true, error);
  }
  if (/no such (container|image|network|volume|object)|not found/i.test(detail)) {
    return new DockerDependencyError("RESOURCE_MISSING", "required Docker resource is missing", false, error);
  }
  if (/no space left on device|disk quota exceeded/i.test(detail)) {
    return new DockerDependencyError("DISK_INSUFFICIENT", "Docker storage has insufficient free space", true, error);
  }
  if (/permission denied|read-only file system/i.test(detail)) {
    return new DockerDependencyError("VOLUME_NOT_WRITABLE", "managed storage is not writable", false, error);
  }
  return error;
}
