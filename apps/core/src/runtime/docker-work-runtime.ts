import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ChannelCredentials, Metadata, type ServiceError } from "@grpc/grpc-js";
import {
  AgentServiceClient,
  CONTRACT_VERSION,
  type ReadinessResponse,
  type ListSessionsResponse,
  type Run,
  type RunEvent,
  type Session,
  type SessionHistory,
  type SubmitRunResponse,
} from "@piwork/contracts";
import type { WorkRecord } from "@piwork/core-store";
import { DockerRuntime } from "@piwork/runtime-docker";
import type { WorkRuntimeAdapter, WorkRuntimeState } from "../work-management/lifecycle.js";
import type { CorePaths } from "../application/paths.js";
import { RuntimeProfileStore } from "../configuration/runtime-profile.js";
import { ensureGenerationTlsIdentity, readTlsFile } from "./mtls.js";

const AGENT_LOGICAL_ID = "agentd";
const GENERATION_LABEL = "piwork.generation";
const INSTANCE_LABEL = "piwork.instance_id";
const PROTOCOL_LABEL = "piwork.protocol_version";

interface RuntimeRecord {
  readonly workId: string;
  readonly generation: number;
  readonly instanceId: string;
  readonly networkName: string;
  readonly imageId: string;
  readonly tls: {
    readonly caCertificatePath: string;
    readonly serverCertificatePath: string;
    readonly serverPrivateKeyPath: string;
    readonly clientCertificatePath: string;
    readonly clientPrivateKeyPath: string;
    readonly serverName: string;
    readonly clientCommonName: string;
  };
}

export interface ConversationGateway {
  createSession(workId: string, idempotencyKey: string): Promise<Session>;
  listSessions(workId: string): Promise<readonly Session[]>;
  readSession(workId: string, sessionId: string): Promise<SessionHistory>;
  submitRun(workId: string, sessionId: string, submissionKey: string, prompt: string): Promise<SubmitRunResponse>;
  getRun(workId: string, runId: string): Promise<Run>;
  watchRun(workId: string, runId: string, after: number, onEvent: (event: RunEvent) => Promise<void> | void): Promise<void>;
  cancelRun(workId: string, runId: string, idempotencyKey: string): Promise<Run>;
}

export class DockerWorkRuntimeAdapter implements WorkRuntimeAdapter, ConversationGateway {
  private readonly docker: DockerRuntime;
  private readonly profiles: RuntimeProfileStore;
  private readonly clients = new Map<string, AgentServiceClient>();

  constructor(private readonly paths: CorePaths, readonly installationId: string) {
    this.docker = new DockerRuntime(installationId, undefined, [paths.runtimeDirectory]);
    this.profiles = new RuntimeProfileStore(paths.runtimeProfilePath, paths.secretsDirectory);
  }

  async verifyDependency(): Promise<void> {
    const profile = this.profiles.load();
    const image = await this.docker.prepareImage(profile.agentImage);
    if (!image.imageId.startsWith("sha256:")) throw new Error("agent image has no immutable Docker identity");
  }

  async prepare(work: WorkRecord): Promise<void> {
    const profile = this.profiles.load();
    await Promise.all([this.docker.prepareImage(profile.agentImage), this.docker.ensureWorkNetwork(work.id), this.docker.ensureManagedVolume(work.id, "work-data")]);
  }

  async start(work: WorkRecord, generation: number): Promise<{ readonly instanceId: string; readonly generation: number }> {
    const current = await this.docker.inspectContainer(work.id, "agent", AGENT_LOGICAL_ID);
    if (current.exists) {
      const record = this.readRecord(work.id);
      await this.docker.startContainer(work.id, "agent", AGENT_LOGICAL_ID);
      await this.waitReady(record);
      return { instanceId: record.instanceId, generation: record.generation };
    }
    const profile = this.profiles.load();
    const image = await this.docker.prepareImage(profile.agentImage);
    const network = await this.docker.ensureWorkNetwork(work.id);
    const volume = await this.docker.ensureManagedVolume(work.id, "work-data");
    const tls = ensureGenerationTlsIdentity({
      runtimeDirectory: this.paths.runtimeDirectory,
      installationId: this.installationId,
      workId: work.id,
      generation,
    });
    const record: RuntimeRecord = {
      workId: work.id,
      generation,
      instanceId: `agent-${randomUUID()}`,
      networkName: network.name,
      imageId: image.imageId,
      tls,
    };
    const directory = this.runtimeDirectory(work.id);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const configPath = join(directory, "agent-config.json");
    const modelCredentialPath = join(directory, "model-credential.secret");
    atomicSecret(modelCredentialPath, this.profiles.resolveCredential(profile));
    atomicJson(configPath, {
      version: 1,
      workId: record.workId,
      generation: record.generation,
      instanceId: record.instanceId,
      listen: "0.0.0.0:7443",
      dataDirectory: "/var/data",
      deterministic: profile.model.provider === "piwork-deterministic",
      model: {
        provider: profile.model.provider,
        id: profile.model.id,
        ...(profile.model.baseUrl === undefined ? {} : { baseUrl: profile.model.baseUrl }),
        ...(profile.model.provider === "piwork-deterministic" ? {} : { credentialPath: "/run/secrets/model-api-key" }),
      },
      tls: {
        caCertificatePath: "/etc/piwork/tls/installation-ca.crt",
        serverCertificatePath: "/etc/piwork/tls/agent-server.crt",
        serverPrivateKeyPath: "/etc/piwork/tls/agent-server.key",
        expectedClientCommonName: record.tls.clientCommonName,
      },
    });
    // The parent directory remains 0700. The numeric container user needs read
    // access to this single bind-mounted file without receiving host ownership.
    chmodSync(configPath, 0o644);
    this.writeRecord(record);
    await this.docker.ensureContainer({
      workId: work.id,
      kind: "agent",
      logicalId: AGENT_LOGICAL_ID,
      image: image.imageId,
      command: ["--config", "/etc/piwork/runtime.json"],
      user: "10001:10001",
      cpuMillis: 1_000,
      memoryBytes: 768 * 1_024 * 1_024,
      network: { name: network.name, workId: work.id, aliases: ["agentd"] },
      labels: { [GENERATION_LABEL]: String(generation), [INSTANCE_LABEL]: record.instanceId, [PROTOCOL_LABEL]: CONTRACT_VERSION },
      mounts: [
        { type: "volume", source: volume.volumeName, target: "/var/data" },
        { type: "bind", source: configPath, target: "/etc/piwork/runtime.json", readOnly: true },
        { type: "bind", source: record.tls.caCertificatePath, target: "/etc/piwork/tls/installation-ca.crt", readOnly: true },
        { type: "bind", source: record.tls.serverCertificatePath, target: "/etc/piwork/tls/agent-server.crt", readOnly: true },
        { type: "bind", source: record.tls.serverPrivateKeyPath, target: "/etc/piwork/tls/agent-server.key", readOnly: true },
        ...(profile.model.provider === "piwork-deterministic" ? [] : [{ type: "bind" as const, source: modelCredentialPath, target: "/run/secrets/model-api-key", readOnly: true }]),
        { type: "tmpfs", target: "/tmp" },
      ],
    });
    await this.docker.startContainer(work.id, "agent", AGENT_LOGICAL_ID);
    await this.waitReady(record);
    return { instanceId: record.instanceId, generation: record.generation };
  }

  async inspect(workId: string): Promise<WorkRuntimeState> {
    const inspection = await this.docker.inspectContainer(workId, "agent", AGENT_LOGICAL_ID);
    if (!inspection.exists) return { exists: false, running: false, ready: false };
    const generation = Number(inspection.labels?.[GENERATION_LABEL]);
    const instanceId = inspection.labels?.[INSTANCE_LABEL];
    let ready = false;
    if (inspection.running && instanceId !== undefined && Number.isSafeInteger(generation)) {
      try { const response = await this.readiness(this.readRecord(workId)); ready = response.acceptingRuns && response.protocolVersion === CONTRACT_VERSION; } catch { ready = false; }
    }
    return { exists: true, running: inspection.running === true, ready, ...(instanceId === undefined ? {} : { instanceId }), ...(Number.isSafeInteger(generation) ? { generation } : {}) };
  }

  async listManagedInstances(): Promise<readonly { readonly workId: string; readonly instanceId: string }[]> {
    const containers = await this.docker.listManagedContainers("agent");
    return containers.flatMap((item) => {
      const workId = item.labels?.["piwork.work_id"];
      const instanceId = item.labels?.[INSTANCE_LABEL];
      return workId === undefined || instanceId === undefined ? [] : [{ workId, instanceId }];
    });
  }

  async drain(workId: string, timeoutMs: number): Promise<void> {
    const record = this.readRecord(workId);
    await this.unary(workId, (client, metadata, callback) => client.drain({ workId, generation: BigInt(record.generation), instanceId: record.instanceId, timeoutMs }, metadata, callback));
  }

  async stop(workId: string, timeoutMs: number): Promise<void> {
    this.closeClient(workId);
    await this.docker.stopContainer(workId, "agent", AGENT_LOGICAL_ID, Math.max(1, Math.ceil(timeoutMs / 1_000)));
  }

  async remove(workId: string): Promise<void> {
    this.closeClient(workId);
    const existing = await this.docker.inspectContainer(workId, "agent", AGENT_LOGICAL_ID);
    if (existing.running) await this.docker.stopContainer(workId, "agent", AGENT_LOGICAL_ID, 10);
    await this.docker.deleteContainer(workId, "agent", AGENT_LOGICAL_ID);
    await this.docker.deleteWorkNetwork(workId);
    rmSync(this.runtimeDirectory(workId), { recursive: true, force: true });
  }

  createSession(workId: string, idempotencyKey: string): Promise<Session> { return this.unary(workId, (client, metadata, callback) => client.createSession({ workId, idempotencyKey }, metadata, callback)); }
  async listSessions(workId: string): Promise<readonly Session[]> { return (await this.unary<ListSessionsResponse>(workId, (client, metadata, callback) => client.listSessions({ workId, pageSize: 1_000, pageToken: "" }, metadata, callback))).sessions; }
  readSession(workId: string, sessionId: string): Promise<SessionHistory> { return this.unary(workId, (client, metadata, callback) => client.readSession({ workId, sessionId }, metadata, callback)); }
  submitRun(workId: string, sessionId: string, submissionKey: string, prompt: string): Promise<SubmitRunResponse> { return this.unary(workId, (client, metadata, callback) => client.submitRun({ workId, sessionId, submissionKey, prompt }, metadata, callback)); }
  getRun(workId: string, runId: string): Promise<Run> { return this.unary(workId, (client, metadata, callback) => client.getRun({ workId, runId }, metadata, callback)); }
  cancelRun(workId: string, runId: string, idempotencyKey: string): Promise<Run> { return this.unary(workId, (client, metadata, callback) => client.cancelRun({ workId, runId, idempotencyKey }, metadata, callback)); }

  async watchRun(workId: string, runId: string, after: number, onEvent: (event: RunEvent) => Promise<void> | void): Promise<void> {
    const client = await this.client(workId);
    const stream = client.watchRun({ workId, runId, afterSequence: BigInt(after) }, new Metadata());
    for await (const event of stream) await onEvent(event);
  }

  close(): void { for (const workId of [...this.clients.keys()]) this.closeClient(workId); }

  private async waitReady(record: RuntimeRecord): Promise<void> {
    const deadline = Date.now() + 30_000;
    let last: unknown;
    while (Date.now() < deadline) {
      try { const value = await this.readiness(record); if (value.acceptingRuns && value.workId === record.workId && Number(value.generation) === record.generation && value.instanceId === record.instanceId && value.protocolVersion === CONTRACT_VERSION) return; }
      catch (error) { last = error; }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`agentd did not become ready${last instanceof Error ? `: ${last.message}` : ""}`);
  }

  private readiness(record: RuntimeRecord): Promise<ReadinessResponse> { return this.unary(record.workId, (client, metadata, callback) => client.readiness({ workId: record.workId, generation: BigInt(record.generation), instanceId: record.instanceId }, metadata, callback)); }

  private async client(workId: string): Promise<AgentServiceClient> {
    const cached = this.clients.get(workId); if (cached !== undefined) return cached;
    const record = this.readRecord(workId);
    const inspection = await this.docker.inspectContainer(workId, "agent", AGENT_LOGICAL_ID);
    if (!inspection.running) throw new Error("Work agent is not running");
    const addresses = Object.values(inspection.networkAddresses ?? {}).filter(Boolean);
    if (addresses.length !== 1) throw new Error("Work agent has no unambiguous private address");
    const credentials = ChannelCredentials.createSsl(
      readTlsFile(record.tls.caCertificatePath),
      readTlsFile(record.tls.clientPrivateKeyPath),
      readTlsFile(record.tls.clientCertificatePath),
    );
    const client = new AgentServiceClient(`${addresses[0]}:7443`, credentials, {
      "grpc.ssl_target_name_override": record.tls.serverName,
      "grpc.default_authority": record.tls.serverName,
    });
    this.clients.set(workId, client);
    return client;
  }

  private async unary<T>(workId: string, call: (client: AgentServiceClient, metadata: Metadata, callback: (error: ServiceError | null, response: T) => void) => unknown): Promise<T> {
    const client = await this.client(workId);
    const metadata = new Metadata();
    return new Promise<T>((resolve, reject) => call(client, metadata, (error, response) => error === null ? resolve(response) : reject(error)));
  }
  private closeClient(workId: string): void { this.clients.get(workId)?.close(); this.clients.delete(workId); }
  private runtimeDirectory(workId: string): string { if (!/^work-[a-f0-9-]+$/.test(workId)) throw new Error("invalid Work runtime identifier"); return join(this.paths.runtimeDirectory, workId); }
  private recordPath(workId: string): string { return join(this.runtimeDirectory(workId), "runtime-state.json"); }
  private writeRecord(record: RuntimeRecord): void { atomicJson(this.recordPath(record.workId), record); }
  private readRecord(workId: string): RuntimeRecord { const path = this.recordPath(workId); if (!existsSync(path)) throw new Error("Work runtime state is missing"); return JSON.parse(readFileSync(path, "utf8")) as RuntimeRecord; }
}

export function ensureInstallationId(paths: CorePaths): string {
  const path = join(paths.runtimeDirectory, "installation-id");
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  const value = process.env.PIWORK_INSTALLATION_ID ?? `piwork-${randomUUID()}`;
  writeFileSync(path, `${value}\n`, { mode: 0o600, flag: "wx" });
  return value;
}

function atomicJson(path: string, value: unknown): void { const temporary = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`; writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" }); chmodSync(temporary, 0o600); renameSync(temporary, path); }
function atomicSecret(path: string, value: string): void { const temporary = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`; writeFileSync(temporary, `${value}\n`, { mode: 0o600, flag: "wx" }); chmodSync(temporary, 0o644); renameSync(temporary, path); }
