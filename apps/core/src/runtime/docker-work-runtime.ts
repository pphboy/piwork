import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { ChannelCredentials, Metadata, type ServiceError } from "@grpc/grpc-js";
import {
  AgentServiceClient,
  CONTRACT_VERSION,
  WORK_SERVICE_MCP_SERVER_ID,
  WORK_SERVICE_MCP_TOOL_NAMES,
  type DiagnosticCode,
  type DiagnosticStage,
  type OperationDiagnostics,
  type RuntimeSkillState,
  type ReadinessResponse,
  type ListSessionsResponse,
  type Run,
  type RunEvent,
  type Session,
  type SessionHistory,
  type SubmitRunResponse,
} from "@piwork/contracts";
import { resolveBuiltInWorkTools } from "@piwork/contracts";
import type { WorkRecord } from "@piwork/core-store";
import { DockerRuntime, managedVolumeName } from "@piwork/runtime-docker";
import type { ResolvedWorkRuntimeConfiguration, WorkRuntimeAdapter, WorkRuntimeState } from "../work-management/lifecycle.js";
import type { CorePaths } from "../application/paths.js";
import { RuntimeProfileStore } from "../configuration/runtime-profile.js";
import { WorkContextStore } from "../configuration/work-context.js";
import { ensureGenerationTlsIdentity, readTlsFile, type GenerationTlsIdentity } from "./mtls.js";
import { DockerServiceRuntimeAdapter } from "./docker-service-runtime.js";

const AGENT_LOGICAL_ID = "agentd";
const GENERATION_LABEL = "piwork.generation";
const INSTANCE_LABEL = "piwork.instance_id";
const PROTOCOL_LABEL = "piwork.protocol_version";
const CONTEXT_LABEL = "piwork.context_identity";

export class RuntimeReadinessError extends Error {
  constructor(
    readonly code: "AGENT_CONTEXT_INCOMPATIBLE" | "AGENT_CONTEXT_MISMATCH" | "AGENT_EXITED" | "AGENT_READINESS_TIMEOUT" | "RUNTIME_START_FAILED" | "SKILL_VALIDATION_FAILED" | "SKILL_LOAD_FAILED" | "SKILL_DIRECTORY_MISMATCH",
    readonly exitCode?: number,
    readonly stage: DiagnosticStage = code === "AGENT_EXITED" || code === "RUNTIME_START_FAILED" ? "runtime-start" : "readiness",
    readonly skillName?: string,
    readonly diagnosticCollection: OperationDiagnostics["diagnosticCollection"] = { state: "not-attempted" },
  ) {
    super("Work agent did not complete the verified initialization handshake");
    this.name = "RuntimeReadinessError";
  }
}

interface RuntimeRecord {
  readonly workId: string;
  readonly generation: number;
  readonly instanceId: string;
  readonly networkName: string;
  readonly imageId: string;
  readonly contextIdentity: string;
  readonly correlationId: string;
  readonly tls: GenerationTlsIdentity;
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

export interface RuntimeSkillStateGateway {
  runtimeSkillState(workId: string): Promise<RuntimeSkillState>;
}

interface RuntimeTiming {
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly readinessTimeoutMs?: number;
}

export class DockerWorkRuntimeAdapter implements WorkRuntimeAdapter, ConversationGateway, RuntimeSkillStateGateway {
  private readonly docker: DockerRuntime;
  private readonly profiles: RuntimeProfileStore;
  private readonly clients = new Map<string, AgentServiceClient>();

  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly readinessTimeoutMs: number;

  constructor(
    private readonly paths: CorePaths,
    readonly installationId: string,
    timing: RuntimeTiming = {},
    private readonly agentGrpcAdvertise = "piwork-core:7172",
  ) {
    this.docker = new DockerRuntime(installationId, undefined, [paths.runtimeDirectory, paths.workContextsDirectory]);
    this.profiles = new RuntimeProfileStore(paths.runtimeProfilePath, paths.secretsDirectory);
    this.now = timing.now ?? Date.now;
    this.sleep = timing.sleep ?? delay;
    this.readinessTimeoutMs = timing.readinessTimeoutMs ?? 30_000;
  }

  async verifyDependency(): Promise<void> {
    const profile = this.profiles.load();
    const image = await this.docker.prepareImage(profile.agentImage);
    if (!image.imageId.startsWith("sha256:")) throw new Error("agent image has no immutable Docker identity");
  }

  serviceRuntime(): DockerServiceRuntimeAdapter { return new DockerServiceRuntimeAdapter(this.docker); }

  async resolveImageIdentity(reference: string): Promise<string> {
    const image = await this.docker.prepareImage(reference);
    if (!/^sha256:[a-f0-9]{64}$/.test(image.imageId)) throw new Error("agent image has no immutable Docker identity");
    return image.imageId;
  }

  async prepare(work: WorkRecord, configuration?: ResolvedWorkRuntimeConfiguration): Promise<void> {
    if (configuration === undefined) {
      throw new Error("Work runtime configuration has no validated context snapshot");
    }
    const established = existsSync(this.recordPath(work.id));
    const [image] = await Promise.all([
      this.prepareCapturedImage(configuration.imageIdentity),
      this.docker.ensureWorkNetwork(work.id),
      established ? this.docker.requireManagedVolume(work.id, "work-private") : this.docker.ensureManagedVolume(work.id, "work-private"),
      established ? this.docker.requireManagedVolume(work.id, "work-workspace") : this.docker.ensureManagedVolume(work.id, "work-workspace"),
    ]);
    if (!established) {
      await Promise.all([
        this.docker.initializeManagedVolume(work.id, "work-private", image.imageId),
        this.docker.initializeManagedVolume(work.id, "work-workspace", image.imageId),
      ]);
    }
  }

  async start(work: WorkRecord, generation: number, configuration?: ResolvedWorkRuntimeConfiguration): Promise<{ readonly instanceId: string; readonly generation: number }> {
    const current = await this.docker.inspectContainer(work.id, "agent", AGENT_LOGICAL_ID);
    if (current.exists) {
      if (configuration === undefined) {
        throw new Error("Work runtime configuration has no validated context snapshot");
      }
      const expectedContext = configuration.contextIdentity;
      if (current.labels?.[CONTEXT_LABEL] !== expectedContext) {
        throw runtimeStartInvariant("context-mismatch", "Work runtime context does not match the active Work context");
      }
      if (current.labels?.[PROTOCOL_LABEL] !== CONTRACT_VERSION) {
        throw runtimeStartInvariant("protocol-mismatch", "Work runtime protocol does not match the required runtime contract");
      }
      const record = this.readRecord(work.id);
      if (current.labels?.[GENERATION_LABEL] !== String(record.generation)
        || current.labels?.[INSTANCE_LABEL] !== record.instanceId) {
        throw runtimeStartInvariant("identity-mismatch", "Work runtime identity does not match the active runtime generation");
      }
      if (current.image !== configuration.imageIdentity || record.imageId !== configuration.imageIdentity) {
        throw runtimeStartInvariant("image-mismatch", "Work runtime image does not match the captured Work image");
      }
      try { this.validateExistingMounts(work.id, current.mounts ?? [], configuration.contextDirectory); }
      catch (error) { throw withRuntimeStartReason(error, "mount-validation-failed"); }
      try { await this.docker.startContainer(work.id, "agent", AGENT_LOGICAL_ID); }
      catch (error) { throw withRuntimeStartReason(error, "container-start-failed"); }
      try { await this.waitReady(record, configuration, current.containerId); }
      catch (error) { throw withRuntimeStartReason(error, "readiness-failed"); }
      return { instanceId: record.instanceId, generation: record.generation };
    }
    const profile = this.profile(configuration);
    if (configuration === undefined) {
      throw new Error("Work runtime configuration has no validated context snapshot");
    }
    const image = await this.prepareCapturedImage(configuration.imageIdentity);
    const network = await this.docker.ensureWorkNetwork(work.id);
    const privateVolume = await this.docker.requireManagedVolume(work.id, "work-private");
    const workspaceVolume = await this.docker.requireManagedVolume(work.id, "work-workspace");
    const instanceId = `agent-${randomUUID()}`;
    const tls = ensureGenerationTlsIdentity({
      runtimeDirectory: this.paths.runtimeDirectory,
      installationId: this.installationId,
      workId: work.id,
      generation,
      instanceId,
    });
    const record: RuntimeRecord = {
      workId: work.id,
      generation,
      instanceId,
      networkName: network.name,
      imageId: image.imageId,
      contextIdentity: configuration.contextIdentity,
      correlationId: configuration.correlationId ?? recordCorrelationId(work.id, generation),
      tls,
    };
    const directory = this.runtimeDirectory(work.id);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const configPath = join(directory, "agent-config.json");
    const serviceControlPath = join(directory, "service-control.json");
    const modelCredentialPath = join(directory, "model-credential.secret");
    atomicSecret(modelCredentialPath, this.profiles.resolveCredential(profile));
    const serviceControl = {
      endpoint: this.agentGrpcAdvertise,
      serverName: "piwork-core",
      caCertificatePath: "/etc/piwork/control/installation-ca.crt",
      clientCertificatePath: "/etc/piwork/control/agent-service-client.crt",
      clientPrivateKeyPath: "/etc/piwork/control/agent-service-client.key",
    };
    atomicJson(configPath, {
      version: 1,
      workId: record.workId,
      generation: record.generation,
      instanceId: record.instanceId,
      listen: "0.0.0.0:7443",
      dataDirectory: "/var/data",
      deterministic: profile.model.provider === "piwork-deterministic",
      ...(configuration === undefined ? {} : {
        contextConfigPath: "/run/piwork/config.json",
        agentsMdPath: "/run/piwork/AGENTS.md",
        contextIdentity: configuration.contextIdentity,
        resolvedTools: resolveBuiltInWorkTools(configuration.workConfig.tools),
      initializationOnly: configuration.initializationOnly === true,
        correlationId: record.correlationId,
      }),
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
    atomicJson(serviceControlPath, { serviceControl });
    // The parent directory remains 0700. The numeric container user needs read
    // access to this single bind-mounted file without receiving host ownership.
    chmodSync(configPath, 0o644);
    chmodSync(serviceControlPath, 0o644);
    this.writeRecord(record);
    const ensured = await this.docker.ensureContainer({
      workId: work.id,
      kind: "agent",
      logicalId: AGENT_LOGICAL_ID,
      image: image.imageId,
      command: ["--config", "/etc/piwork/runtime.json"],
      user: "10001:10001",
      cpuMillis: configuration.workConfig.resources.agentCpuMillis,
      memoryBytes: configuration.workConfig.resources.agentMemoryBytes,
      workingDirectory: "/var/data/workspace",
      controlHost: { hostname: "piwork-core", address: "host-gateway" },
      network: { name: network.name, workId: work.id, aliases: ["agentd"] },
      labels: { [GENERATION_LABEL]: String(generation), [INSTANCE_LABEL]: record.instanceId, [PROTOCOL_LABEL]: CONTRACT_VERSION, [CONTEXT_LABEL]: configuration.contextIdentity },
      mounts: [
        { type: "volume", source: privateVolume.volumeName, target: "/var/data" },
        { type: "volume", source: workspaceVolume.volumeName, target: "/var/data/workspace" },
        { type: "bind" as const, source: configuration.contextDirectory, target: "/run/piwork", readOnly: true },
        { type: "bind", source: configPath, target: "/etc/piwork/runtime.json", readOnly: true },
        { type: "bind", source: serviceControlPath, target: "/etc/piwork/service-control.json", readOnly: true },
        { type: "bind", source: record.tls.caCertificatePath, target: "/etc/piwork/tls/installation-ca.crt", readOnly: true },
        { type: "bind", source: record.tls.serverCertificatePath, target: "/etc/piwork/tls/agent-server.crt", readOnly: true },
        { type: "bind", source: record.tls.serverPrivateKeyPath, target: "/etc/piwork/tls/agent-server.key", readOnly: true },
        { type: "bind", source: record.tls.caCertificatePath, target: "/etc/piwork/control/installation-ca.crt", readOnly: true },
        { type: "bind", source: record.tls.serviceClientCertificatePath, target: "/etc/piwork/control/agent-service-client.crt", readOnly: true },
        { type: "bind", source: record.tls.serviceClientPrivateKeyPath, target: "/etc/piwork/control/agent-service-client.key", readOnly: true },
        ...(profile.model.provider === "piwork-deterministic" ? [] : [{ type: "bind" as const, source: modelCredentialPath, target: "/run/secrets/model-api-key", readOnly: true }]),
        { type: "tmpfs", target: "/tmp" },
      ],
    });
    await this.docker.startContainer(work.id, "agent", AGENT_LOGICAL_ID);
    await this.waitReady(record, configuration, ensured.containerId);
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

  async runtimeSkillState(workId: string): Promise<RuntimeSkillState> {
    try {
      const inspection = await this.docker.inspectContainer(workId, "agent", AGENT_LOGICAL_ID);
      if (!inspection.exists || !inspection.running) return { state: "unavailable", checkedAt: new Date().toISOString(), skills: [] };
      const record = this.readRecord(workId);
      const contextIdentity = inspection.labels?.[CONTEXT_LABEL];
      if (inspection.labels?.[GENERATION_LABEL] !== String(record.generation)
        || inspection.labels?.[INSTANCE_LABEL] !== record.instanceId
        || inspection.labels?.[PROTOCOL_LABEL] !== CONTRACT_VERSION
        || contextIdentity === undefined
        || contextIdentity !== record.contextIdentity) {
        return { state: "unavailable", checkedAt: new Date().toISOString(), skills: [] };
      }
      const context = new WorkContextStore(this.paths.workContextsDirectory).load(workId, record.contextIdentity);
      const value = await this.readiness(record, 2_000);
      verifyExpectedReadiness(value, record, {
        contextIdentity: record.contextIdentity,
        workConfig: context.configuration,
        skillIdentities: context.metadata.skills,
      });
      return {
        state: "ready",
        checkedAt: new Date().toISOString(),
        skills: value.loadedSkills.map((skill) => ({
          name: skill.name,
          loaded: true,
          modelVisible: skill.modelVisible,
          visibilityReason: skill.visibilityReason === "" ? null : skill.visibilityReason === "model-invocation-disabled" ? "model-invocation-disabled" : "read-tools-disabled",
        })),
      };
    } catch {
      return { state: "unavailable", checkedAt: null, skills: [] };
    }
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

  prepareConfigurationChange(workId: string): Promise<{ readonly prepared: boolean; readonly busy: boolean; readonly activeRunCount: number }> {
    const record = this.readRecord(workId);
    return this.unary(workId, (client, metadata, callback) => client.prepareConfigurationChange({
      workId,
      generation: BigInt(record.generation),
      instanceId: record.instanceId,
    }, metadata, callback));
  }

  async stop(workId: string, timeoutMs: number): Promise<void> {
    this.closeClient(workId);
    await this.docker.stopContainer(workId, "agent", AGENT_LOGICAL_ID, Math.max(1, Math.ceil(timeoutMs / 1_000)));
  }

  async remove(workId: string, options?: { readonly preserveNetwork?: boolean }): Promise<void> {
    this.closeClient(workId);
    const existing = await this.docker.inspectContainer(workId, "agent", AGENT_LOGICAL_ID);
    if (existing.running) await this.docker.stopContainer(workId, "agent", AGENT_LOGICAL_ID, 10);
    await this.docker.deleteContainer(workId, "agent", AGENT_LOGICAL_ID);
    if (!options?.preserveNetwork) await this.docker.deleteWorkNetwork(workId);
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

  private profile(configuration?: ResolvedWorkRuntimeConfiguration) {
    if (configuration === undefined) return this.profiles.load();
    const profile = JSON.parse(configuration.runtimeProfileJson) as ReturnType<RuntimeProfileStore["load"]>;
    if (profile.version !== 1 || profile.revision < 1 || typeof profile.agentImage !== "string") {
      throw new Error("Work runtime profile snapshot is invalid");
    }
    return profile;
  }

  private async prepareCapturedImage(identity: string) {
    if (!/^sha256:[a-f0-9]{64}$/.test(identity)) throw new Error("Work runtime image identity is invalid");
    const image = await this.docker.prepareImage(identity);
    if (image.imageId !== identity) throw new Error("Work runtime image does not match the captured Work image");
    return image;
  }

  private validateExistingMounts(
    workId: string,
    mounts: readonly { readonly type: string; readonly source: string; readonly destination: string; readonly readOnly: boolean }[],
    contextDirectory: string,
  ): void {
    const expectedContext = realpathSync(contextDirectory);
    const runtimeRoot = realpathSync(this.paths.runtimeDirectory);
    const contextMounts = mounts.filter((mount) => mount.destination === "/run/piwork");
    if (contextMounts.length !== 1) throw new Error("Work runtime context mount is invalid");
    const context = contextMounts[0]!;
    if (context.type !== "bind" || !context.readOnly || realpathSync(context.source) !== expectedContext) {
      throw new Error("Work runtime context mount is invalid");
    }
    for (const mount of mounts) {
      if (mount.type !== "bind" || mount === context) continue;
      const source = realpathSync(mount.source);
      if (!isWithin(runtimeRoot, source)) throw new Error("Work runtime contains an unauthorized bind mount");
    }
    const requiredVolumes = [
      { destination: "/var/data", source: managedVolumeName(this.installationId, workId, "work-private") },
      { destination: "/var/data/workspace", source: managedVolumeName(this.installationId, workId, "work-workspace") },
    ];
    for (const required of requiredVolumes) {
      const matches = mounts.filter((mount) => mount.type === "volume" && mount.destination === required.destination && mount.source === required.source && !mount.readOnly);
      if (matches.length !== 1) throw new Error("Work runtime persistent volume layout is invalid");
    }
    const unexpectedVolumes = mounts.filter((mount) => mount.type === "volume" && !requiredVolumes.some((required) => required.destination === mount.destination && required.source === mount.source));
    if (unexpectedVolumes.length > 0) throw new Error("Work runtime contains an unauthorized volume mount");
  }


  private async waitReady(record: RuntimeRecord, configuration: ResolvedWorkRuntimeConfiguration, expectedContainerId?: string): Promise<void> {
    const deadline = this.now() + this.readinessTimeoutMs;
    let inspectionFailed = false;
    while (this.now() < deadline) {
      const attemptMs = Math.max(1, Math.min(1_000, deadline - this.now()));
      const [readiness, inspection] = await Promise.allSettled([
        this.readiness(record, attemptMs),
        this.docker.inspectContainer(record.workId, "agent", AGENT_LOGICAL_ID, attemptMs),
      ]);
      if (readiness.status === "fulfilled") {
        verifyExpectedReadiness(readiness.value, record, configuration);
        return;
      }
      if (inspection.status === "fulfilled") {
        inspectionFailed = false;
        const value = inspection.value;
        if (expectedContainerId !== undefined && value.containerId !== expectedContainerId) {
          throw new RuntimeReadinessError("AGENT_CONTEXT_MISMATCH");
        }
        const labels = value.labels ?? {};
        if (labels[GENERATION_LABEL] !== String(record.generation)
          || labels[INSTANCE_LABEL] !== record.instanceId
          || labels[CONTEXT_LABEL] !== configuration.contextIdentity) {
          throw new RuntimeReadinessError("AGENT_CONTEXT_MISMATCH");
        }
        if (labels[PROTOCOL_LABEL] !== CONTRACT_VERSION) {
          throw new RuntimeReadinessError("AGENT_CONTEXT_INCOMPATIBLE");
        }
        if (!value.running) {
          throw await this.failureWithCollectedEvidence(record, value.exitCode, "AGENT_EXITED", true, expectedContainerId);
        }
      } else {
        inspectionFailed = true;
      }
      await this.sleep(Math.min(200, Math.max(0, deadline - this.now())));
    }
    if (inspectionFailed) throw new RuntimeReadinessError("RUNTIME_START_FAILED");
    throw await this.failureWithCollectedEvidence(record, undefined, "AGENT_READINESS_TIMEOUT", false, expectedContainerId);
  }

  private async failureWithCollectedEvidence(
    record: RuntimeRecord,
    exitCode: number | undefined,
    fallback: "AGENT_EXITED" | "AGENT_READINESS_TIMEOUT",
    exited: boolean,
    expectedContainerId?: string,
  ): Promise<RuntimeReadinessError> {
    try {
      const logs = await this.docker.collectContainerLogs(record.workId, "agent", AGENT_LOGICAL_ID, 200, expectedContainerId);
      const evidence = recognizeInitializationEvidence(logs.text, record, exited);
      const collection: OperationDiagnostics["diagnosticCollection"] = {
        state: logs.truncated ? "truncated" : evidence === undefined ? "unrecognized" : "available",
        ...(evidence === undefined ? {} : { code: evidence.code }),
      };
      return new RuntimeReadinessError(
        evidence?.code ?? fallback,
        exitCode,
        evidence?.stage ?? (fallback === "AGENT_EXITED" ? "runtime-start" : "readiness"),
        evidence?.skillName,
        collection,
      );
    } catch {
      return new RuntimeReadinessError(
        fallback,
        exitCode,
        fallback === "AGENT_EXITED" ? "runtime-start" : "readiness",
        undefined,
        { state: "unavailable", code: "DIAGNOSTIC_COLLECTION_FAILED" },
      );
    }
  }

  private async readiness(record: RuntimeRecord, timeoutMs = 1_000): Promise<ReadinessResponse> {
    const client = await this.client(record.workId);
    const metadata = new Metadata();
    return new Promise<ReadinessResponse>((resolve, reject) => client.readiness(
      { workId: record.workId, generation: BigInt(record.generation), instanceId: record.instanceId },
      metadata,
      { deadline: new Date(Date.now() + timeoutMs) },
      (error, response) => error === null ? resolve(response) : reject(error),
    ));
  }

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
      // This address is selected from Docker's trusted inspection result and
      // is reachable only on the Work bridge. Host proxy settings must not
      // redirect the private mTLS control channel through an HTTP proxy.
      "grpc.enable_http_proxy": 0,
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

export function verifyExpectedReadiness(
  value: ReadinessResponse,
  record: Pick<RuntimeRecord, "workId" | "generation" | "instanceId">,
  configuration: Pick<ResolvedWorkRuntimeConfiguration, "contextIdentity" | "initializationOnly" | "skillIdentities" | "workConfig">,
): void {
  if (value.protocolVersion !== CONTRACT_VERSION || value.contextContractVersion !== 1
    || value.workId.length === 0 || Number(value.generation) < 1 || value.instanceId.length === 0
    || value.contextIdentity.length === 0 || !value.initializationComplete) {
    throw new RuntimeReadinessError("AGENT_CONTEXT_INCOMPATIBLE");
  }
  if (value.workId !== record.workId || Number(value.generation) !== record.generation
    || value.instanceId !== record.instanceId || value.contextIdentity !== configuration.contextIdentity) {
    throw new RuntimeReadinessError("AGENT_CONTEXT_MISMATCH");
  }
  if (configuration.initializationOnly !== true && !value.acceptingRuns) throw new RuntimeReadinessError("AGENT_CONTEXT_MISMATCH");
  if (configuration.initializationOnly === true && value.acceptingRuns) throw new RuntimeReadinessError("AGENT_CONTEXT_MISMATCH");
  const expectedBuiltIns = resolveBuiltInWorkTools(configuration.workConfig.tools);
  if (JSON.stringify(value.resolvedTools.slice(0, expectedBuiltIns.length)) !== JSON.stringify(expectedBuiltIns)) throw new RuntimeReadinessError("AGENT_CONTEXT_MISMATCH");
  const serverIds = new Set(configuration.workConfig.mcpServers.map((server) => server.serverId));
  const allowed = new Set(configuration.workConfig.tools.allowed);
  const denied = new Set(configuration.workConfig.tools.denied);
  const customTools = value.resolvedTools.slice(expectedBuiltIns.length);
  if (new Set(value.resolvedTools).size !== value.resolvedTools.length
    || customTools.some((tool) => {
      const separator = tool.indexOf(".");
      return separator < 1 || !serverIds.has(tool.slice(0, separator))
        || (allowed.size > 0 && !allowed.has(tool)) || denied.has(tool);
    })) throw new RuntimeReadinessError("AGENT_CONTEXT_MISMATCH");
  const serviceAdapter = configuration.workConfig.mcpServers.find((server) => server.serverId === WORK_SERVICE_MCP_SERVER_ID);
  const actualServiceTools = customTools.filter((tool) => tool.startsWith(`${WORK_SERVICE_MCP_SERVER_ID}.`)).sort();
  const expectedServiceTools = serviceAdapter === undefined ? [] : WORK_SERVICE_MCP_TOOL_NAMES
    .map((name) => `${WORK_SERVICE_MCP_SERVER_ID}.${name}`)
    .filter((tool) => (allowed.size === 0 || allowed.has(tool)) && !denied.has(tool))
    .sort();
  if (JSON.stringify(actualServiceTools) !== JSON.stringify(expectedServiceTools)) {
    throw new RuntimeReadinessError("AGENT_CONTEXT_MISMATCH");
  }
  if (value.loadedSkills.length !== configuration.skillIdentities.length) throw new RuntimeReadinessError("AGENT_CONTEXT_MISMATCH");
  const skillsMatch = value.loadedSkills.every((skill, index) => {
    const expected = configuration.skillIdentities[index];
    return expected !== undefined && skill.name === expected.name && skill.identity === expected.identity && skill.loaded;
  });
  if (!skillsMatch) throw new RuntimeReadinessError("AGENT_CONTEXT_MISMATCH");
}

const recognizedAgentCodes = new Set<DiagnosticCode>([
  "CONTEXT_NOT_FOUND", "CONTEXT_FORMAT_UNSUPPORTED", "SKILL_VALIDATION_FAILED",
  "SKILL_LOAD_FAILED", "SKILL_DIRECTORY_MISMATCH", "AGENT_CONTEXT_INCOMPATIBLE",
  "AGENT_CONTEXT_MISMATCH",
]);

function recognizeInitializationEvidence(
  text: string,
  record: Pick<RuntimeRecord, "workId" | "instanceId"> & Partial<Pick<RuntimeRecord, "correlationId">>,
  exited: boolean,
): { readonly code: RuntimeReadinessError["code"]; readonly stage: DiagnosticStage; readonly skillName?: string } | undefined {
  for (const line of text.split("\n")) {
    if (exited && line.trim() === "invalid Work Skill descriptor") {
      return { code: "AGENT_CONTEXT_INCOMPATIBLE", stage: "readiness" };
    }
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      if (value.component !== "agentd" || value.outcome !== "failed"
        || value.workId !== record.workId || value.correlationId !== (record.correlationId ?? record.instanceId)
        || typeof value.code !== "string" || !recognizedAgentCodes.has(value.code as DiagnosticCode)
        || !isDiagnosticStage(value.stage)) continue;
      const skillName = typeof value.skillName === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value.skillName)
        ? value.skillName : undefined;
      return { code: value.code as RuntimeReadinessError["code"], stage: value.stage, ...(skillName === undefined ? {} : { skillName }) };
    } catch { /* Plain or forged output is deliberately ignored. */ }
  }
  return undefined;
}

function isDiagnosticStage(value: unknown): value is DiagnosticStage {
  return typeof value === "string" && ["context-copy", "context-validate", "runtime-prepare", "runtime-start", "skill-validate", "skill-load", "mcp-initialize", "readiness", "activation", "rollback"].includes(value);
}

function delay(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function runtimeStartInvariant(reason: string, message: string): Error {
  return Object.assign(new Error(message), { diagnosticReason: reason });
}

function withRuntimeStartReason(error: unknown, reason: string): unknown {
  if (typeof error === "object" && error !== null && Object.isExtensible(error)) {
    Object.assign(error, { diagnosticReason: reason });
  }
  return error;
}

function recordCorrelationId(workId: string, generation: number): string {
  return `runtime-${workId}-${generation}`;
}

function isWithin(root: string, candidate: string): boolean {
  const child = relative(resolve(root), resolve(candidate));
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
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
