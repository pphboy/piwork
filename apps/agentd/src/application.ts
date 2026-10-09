import { lstatSync, mkdirSync, readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { join } from "node:path";
import {
  Server,
  ServerCredentials,
  status,
  type ServerUnaryCall,
  type ServerWritableStream,
  type sendUnaryData,
} from "@grpc/grpc-js";
import {
  AgentServiceService,
  BUILT_IN_WORK_TOOLS,
  CONTRACT_VERSION,
  resolveBuiltInWorkTools,
  RunState,
  type AgentServiceServer,
  type CancelRunRequest,
  type CreateSessionRequest,
  type DrainRequest,
  type DrainResponse,
  type GetRunRequest,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type ReadinessRequest,
  type ReadinessResponse,
  type PrepareConfigurationChangeRequest,
  type PrepareConfigurationChangeResponse,
  type ReadSessionRequest,
  type Run,
  type RunEvent,
  type Session,
  type SessionHistory,
  type SubmitRunRequest,
  type SubmitRunResponse,
  type WatchRunRequest,
  type AgentContentRequest,
  type AgentContentResponse,
  AgentRequestQuerySchema,
  AgentEvidenceQuerySchema,
  SetSessionModelSchema,
  CHAT_CONTROLS_CONTRACT_VERSION,
  ChatInputModeSchema,
  LookupChatSubmissionSchema,
  SetSessionChatOptionsSchema,
  type SlashCommand,
  RetryAgentRequestSchema,
  publicRunModel,
  type RunModelSnapshot,
} from "@piwork/contracts";
import { FeedbackError, WorkStore, type RunEventRecord, type RunRecord, type SessionRecord } from "@piwork/work-store";
import { AgentDaemonControl } from "./daemon.js";
import { initializeChildAgentDirectory, initializeDefaultChildAgentModel, PiSdkRunExecutor } from "./pi-sdk-executor.js";
import { RunManager } from "./runs.js";
import { AgentSessionService } from "./sessions.js";
import { loadConfiguredSkills, RequiredSkillError, type ConfiguredSkill } from "./skills.js";
import { emitAgentDiagnostic } from "./diagnostics.js";
import { defineTool, type ResourceLoader, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { McpBridge, type McpBridgeServer } from "@piwork/pi-adapter";
import type { McpServer } from "@piwork/contracts";
import type { PiPackageSelectionEntry } from "@piwork/contracts";
import { createPackageResourceLoader, type PackageBinding, type LoadedPackageResource } from "./package-resources.js";
import { Check } from "typebox/value";
import { AgentRunModels, RunModelError } from "./run-models.js";
import { WorkPrivateClient } from "./work-private-client.js";
import { ServiceBindingRegistry, ServiceInteractionClient } from "./service-interaction.js";
import { ServiceFeedbackServer } from "./service-feedback-server.js";
import { BRAIN_TOOL_NAMES, initializeBrainSource } from "./brain-resources.js";
import { BrainFlow } from "./brain-flow.js";
import { BrainLoop } from "./brain-loop.js";
import { BrainCandidates } from "./brain-candidates.js";
import type { RunExecutionContext } from "./runs.js";
import type { HistoryMigration } from "@piwork/work-store";
import { requireResourceCommand } from "./resource-commands.js";

export const AGENT_PROTOCOL_VERSION = CONTRACT_VERSION;

export interface AgentRuntimeConfig {
  readonly version: 1;
  readonly workId: string;
  readonly generation: number;
  readonly instanceId: string;
  readonly listen: string;
  readonly feedbackListen?: string;
  readonly dataDirectory: string;
  readonly deterministic: boolean;
  readonly contextConfigPath?: string;
  readonly skills?: readonly ConfiguredSkill[];
  readonly agentsMdPath?: string;
  readonly contextIdentity?: string;
  readonly resolvedTools?: readonly string[];
  readonly initializationOnly?: boolean;
  readonly historyMigration?: HistoryMigration;
  readonly correlationId?: string;
  readonly model: {
    readonly provider: string;
    readonly id: string;
    readonly baseUrl?: string;
    readonly credentialPath?: string;
    readonly api?: import("@piwork/contracts").ModelApi;
    readonly capabilities?: import("@piwork/contracts").ModelCapabilities;
  };
  readonly tls: {
    readonly caCertificatePath: string;
    readonly serverCertificatePath: string;
    readonly serverPrivateKeyPath: string;
    readonly expectedClientCommonName: string;
  };
  readonly serviceControl?: {
    readonly endpoint: string;
    readonly serverName: string;
    readonly caCertificatePath: string;
    readonly clientCertificatePath: string;
    readonly clientPrivateKeyPath: string;
  };
}

interface CapturedWorkContext {
  readonly skillRoot: string;
  readonly skills: readonly ConfiguredSkill[];
  readonly agentsMd: string;
  readonly contextIdentity: string;
  readonly resolvedTools: readonly string[];
  readonly toolPolicy: { readonly allowed: readonly string[]; readonly denied: readonly string[] };
  readonly mcpServers: readonly McpServer[];
  readonly packages: readonly PiPackageSelectionEntry[];
  readonly packageBindings: readonly PackageBinding[];
}

export interface LoadedWorkContext {
  readonly commands: readonly SlashCommand[];
  readonly contextIdentity: string;
  readonly loaderFactory: (context?: RunExecutionContext) => Promise<ResourceLoader>;
  readonly resolvedTools: readonly string[];
  readonly packageTools: ReadonlyMap<string, string>;
  readonly packages: readonly LoadedPackageResource[];
  readonly packageResources: readonly { readonly packageName: string; readonly kind: string; readonly name: string }[];
  readonly skills: readonly {
    readonly name: string;
    readonly identity: string;
    readonly loaded: boolean;
    readonly modelVisible: boolean;
    readonly visibilityReason: "" | "model-invocation-disabled" | "read-tools-disabled";
  }[];
  readonly mcpServers: readonly McpServer[];
  readonly toolPolicy: CapturedWorkContext["toolPolicy"];
}

export class AgentApplication {
  private readonly server = new Server();
  private closed = false;
  private readonly installationId: string;

  private constructor(
    readonly config: AgentRuntimeConfig,
    private readonly store: WorkStore,
    private readonly daemon: AgentDaemonControl,
    private readonly sessions: AgentSessionService,
    private readonly runs: RunManager,
    private readonly mcp: McpBridge,
    private readonly models: AgentRunModels,
    private readonly commands: readonly SlashCommand[],
    private readonly control?: WorkPrivateClient,
    private readonly bindings?: ServiceBindingRegistry,
    private readonly feedbackServer?: ServiceFeedbackServer,
    private readonly brainFlow?: BrainFlow,
    private readonly brainLoop?: BrainLoop,
  ) {
    const authority = new X509Certificate(readBoundedRegularFile(config.tls.caCertificatePath));
    const commonName = authority.toLegacyObject().subject.CN;
    if (typeof commonName !== "string" || !/^piwork-installation-[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/.test(commonName)) {
      throw new Error("agent installation authority is invalid");
    }
    this.installationId = commonName.slice("piwork-installation-".length);
  }

  static async create(configPath: string): Promise<AgentApplication> {
    const config = readConfig(configPath);
    if (config.deterministic && process.env.PIWORK_AGENT_VARIANT !== "acceptance") {
      throw new Error("deterministic model configuration requires the acceptance image variant");
    }
    if (!config.deterministic) { await initializeChildAgentDirectory(); await initializeDefaultChildAgentModel(config.model); }
    mkdirSync(config.dataDirectory, { recursive: true, mode: 0o700 });
    if(config.historyMigration && (config.initializationOnly!==true || config.historyMigration.workId!==config.workId
      || config.historyMigration.operationId!==config.correlationId || config.historyMigration.fromSchema!==4 || config.historyMigration.toSchema!==5)) {
      throw new Error("WORK_HISTORY_MIGRATION_REQUIRED");
    }
    if (config.historyMigration) {
      if (!config.serviceControl) throw new Error("WORK_HISTORY_MIGRATION_REQUIRED");
      const authority = new WorkPrivateClient(config.serviceControl);
      try { await authority.authorizeHistoryMigration(config.historyMigration); }
      finally { authority.close(); }
    }
    const store = WorkStore.open(join(config.dataDirectory, "work.sqlite"), { workId: config.workId,
      ...(config.historyMigration?{historyMigration:config.historyMigration}:{}) });
    let mcp: McpBridge | undefined;
    let control: WorkPrivateClient | undefined;
    let feedbackServer: ServiceFeedbackServer | undefined;
    let brainFlow: BrainFlow | undefined;
    let brainLoop: BrainLoop | undefined;
    let loadingStage: "skill-load" | "package-load" | undefined;
    try {
      const daemon = new AgentDaemonControl({
        workId: config.workId,
        generation: config.generation,
        instanceId: config.instanceId,
      });
      control = config.serviceControl ? new WorkPrivateClient(config.serviceControl) : undefined;
      const models = new AgentRunModels({ ...config.model, deterministic: config.deterministic }, control);
      const workspace = "/var/data/workspace";
      const sessionRoot = join(config.dataDirectory, "sessions");
      mkdirSync(workspace, { recursive: true });
      mkdirSync(sessionRoot, { recursive: true });
      const sessions = new AgentSessionService(config.workId, store, workspace, sessionRoot, config.contextIdentity);
      const context = loadWorkContext(config);
      const skillDiagnostics = (stage: "skill-validate" | "skill-load", outcome: "started" | "succeeded") => {
        for (const skillName of context.skills.length === 0 ? [undefined] : context.skills.map((skill) => skill.name)) {
          emitAgentDiagnostic({ stage, outcome,
            code: stage === "skill-validate" ? "SKILL_VALIDATION_FAILED" : "SKILL_LOAD_FAILED",
            correlationId: config.correlationId ?? config.instanceId, workId: config.workId,
            ...(skillName === undefined ? {} : { skillName }) });
        }
      };
      skillDiagnostics("skill-validate", "started");
      const loaded = await loadValidatedWorkContext(context, workspace, join(config.dataDirectory, "agent"), store, () => {
        skillDiagnostics("skill-load", "succeeded");
        loadingStage = "package-load";
        emitAgentDiagnostic({ stage: "package-load", outcome: "started", code: "PACKAGE_LOAD_FAILED",
          correlationId: config.correlationId ?? config.instanceId, workId: config.workId });
      }, () => {
        skillDiagnostics("skill-validate", "succeeded");
        skillDiagnostics("skill-load", "started");
      });
      emitAgentDiagnostic({ stage: "package-load", outcome: "succeeded", code: "PACKAGE_LOAD_FAILED",
        correlationId: config.correlationId ?? config.instanceId, workId: config.workId });
      loadingStage = undefined;
      mcp = new McpBridge();
      emitAgentDiagnostic({ stage: "mcp-initialize", outcome: "started", code: "MCP_INITIALIZATION_FAILED", correlationId: config.correlationId ?? config.instanceId, workId: config.workId });
      try {
        await mcp.initialize(loaded.mcpServers.map(mcpServer));
        emitAgentDiagnostic({ stage: "mcp-initialize", outcome: "succeeded", code: "MCP_INITIALIZATION_FAILED", correlationId: config.correlationId ?? config.instanceId, workId: config.workId });
      } catch (error) {
        emitAgentDiagnostic({ stage: "mcp-initialize", outcome: "failed", code: "MCP_INITIALIZATION_FAILED", correlationId: config.correlationId ?? config.instanceId, workId: config.workId });
        throw error;
      }
      const bridgedTools = mcpTools(mcp, loaded.toolPolicy);
      const customTools = bridgedTools.map((tool) => tool.definition);
      const reserved = new Set<string>([...BUILT_IN_WORK_TOOLS, ...customTools.map((tool) => tool.name)]);
      const packageTools = selectPackageTools(loaded.packageTools, loaded.toolPolicy, reserved);
      const resolvedTools = [...loaded.resolvedTools, ...bridgedTools.map((tool) => tool.canonicalName), ...packageTools.map(([canonical]) => canonical)];
      const sdkTools = [...loaded.resolvedTools, ...customTools.map((tool) => tool.name), ...packageTools.map(([, native]) => native)];
      const bindings = new ServiceBindingRegistry(config.workId, control);
      const interactions = new ServiceInteractionClient(workspace, bindings, store.feedback);
      const activeBrain = context.packageBindings.find((binding) => binding.name === "piwork-brain" && context.packages.some((item) => item.name === binding.name && item.enabled));
      const candidates = new BrainCandidates(config.workId, workspace, store, activeBrain ? { digest: activeBrain.artifact.contentDigest,
        version: activeBrain.artifact.version, contextId: loaded.contextIdentity, root: join("/run/piwork/packages", activeBrain.nameKey) } : undefined, control);
      let runs: RunManager;
      brainFlow = new BrainFlow(store, interactions, new Set(resolvedTools), (runId) => { runs.cancel(runId); }, candidates);
      runs = new RunManager(store, daemon, brainFlow.wrap(new PiSdkRunExecutor(
        sessions,
        join(config.dataDirectory, "agent"),
        { ...config.model, deterministic: config.deterministic },
        { resourceLoaderFactory: loaded.loaderFactory, resolvedTools: sdkTools, customTools, models, commands: loaded.commands, packageTools: new Map(packageTools),
          onSdkToolResult: (run, result) => candidates.recordSdkResult(run, result, new Map(packageTools)) },
      )), undefined, models, prompt => { requireResourceCommand(loaded.commands, prompt); }, activeBrain !== undefined);
      runs.recover();
      daemon.configure({
        modelCredentialStatus: "available",
        contextIdentity: loaded.contextIdentity,
        loadedSkills: loaded.skills,
        loadedPackages: loaded.packages.map((item) => ({ name: item.name, contentDigest: item.digest, ...item.resourceCounts })),
        packageResources: loaded.packageResources,
        resolvedTools,
        initializationComplete: true,
        initializationOnly: config.initializationOnly,
      });
      if (!config.initializationOnly) {
        const binding = context.packageBindings.find((item) => item.name === "piwork-brain");
        if (binding && context.packages.some((item) => item.name === binding.name && item.enabled)) initializeBrainSource({
          frozenRoot: join("/run/piwork/packages", binding.nameKey), workspace, privateDirectory: config.dataDirectory, binding });
      }
      brainLoop = new BrainLoop(config.workId, store, daemon, runs, sessions, bindings, interactions, candidates);
      if (config.feedbackListen) feedbackServer = new ServiceFeedbackServer(config.workId, config.tls, store, bindings, interactions,
        (runId) => { runs.cancel(runId); }, (event) => brainLoop?.notify(event), () => {
          const ready = daemon.readiness();
          return { available: ready.acceptingRuns && BRAIN_TOOL_NAMES.every((n) => ready.resolvedTools.includes(`package:piwork-brain:${n}`)), initializing: config.initializationOnly === true };
        });
      return new AgentApplication(config, store, daemon, sessions, runs, mcp, models, loaded.commands, control, bindings, feedbackServer, brainFlow, brainLoop);
    } catch (error) {
      if (error instanceof RequiredSkillError) {
        for (const status of error.statuses) emitAgentDiagnostic({
          stage: error.phase === "validation" ? "skill-validate" : "skill-load",
          outcome: status.loaded ? "succeeded" : "failed",
          code: status.error === "SKILL_DIRECTORY_MISMATCH" ? "SKILL_DIRECTORY_MISMATCH"
            : error.phase === "validation" ? "SKILL_VALIDATION_FAILED" : "SKILL_LOAD_FAILED",
          correlationId: config.correlationId ?? config.instanceId, workId: config.workId,
          skillName: status.name,
        });
      } else if (loadingStage !== undefined) emitAgentDiagnostic({
        stage: loadingStage, outcome: "failed", code: loadingStage === "skill-load" ? "SKILL_LOAD_FAILED" : "PACKAGE_LOAD_FAILED",
        correlationId: config.correlationId ?? config.instanceId, workId: config.workId,
      });
      if (mcp !== undefined) await Promise.race([
        mcp.close(),
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ]);
      await brainLoop?.close();
      await brainFlow?.close();
      store.close();
      control?.close();
      await feedbackServer?.close();
      throw error;
    }
  }

  async start(): Promise<number> {
    this.server.addService(AgentServiceService, this.handlers());
    const credentials = ServerCredentials.createSsl(
      readBoundedRegularFile(this.config.tls.caCertificatePath),
      [{
        cert_chain: readBoundedRegularFile(this.config.tls.serverCertificatePath),
        private_key: readBoundedRegularFile(this.config.tls.serverPrivateKeyPath),
      }],
      true,
    );
    const port = await new Promise<number>((resolve, reject) => this.server.bindAsync(
      this.config.listen,
      credentials,
      (error, port) => error === null ? resolve(port) : reject(error),
    ));
    if (this.config.feedbackListen) await this.feedbackServer?.start(this.config.feedbackListen);
    await this.brainFlow?.start();
    if (!this.config.initializationOnly) this.brainLoop?.start();
    return port;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.brainLoop?.close();
    await this.feedbackServer?.close();
    await this.runs.drain(5_000);
    await this.brainFlow?.close();
    await Promise.race([
      this.mcp.close(),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]);
    await new Promise<void>((resolve) => this.server.tryShutdown(() => resolve()));
    this.store.close();
    this.control?.close();
  }

  private handlers(): AgentServiceServer {
    const unary = <Q, R>(handler: (request: Q) => Promise<R> | R) =>
      async (call: ServerUnaryCall<Q, R>, callback: sendUnaryData<R>) => {
        try {
          this.authenticate(call);
          callback(null, await handler(call.request));
        } catch (error) {
          callback(grpcError(error));
        }
      };

    return {
      refreshServiceInteractionBindings: unary(async (request: AgentContentRequest): Promise<AgentContentResponse> => {
        this.verifyWork(request.workId); await this.bindings?.refresh(); return { valueJson: JSON.stringify({ available: this.bindings !== undefined }) };
      }),
      listRunModels: unary(async (request: AgentContentRequest): Promise<AgentContentResponse> => {
        this.verifyWork(request.workId); return { valueJson: JSON.stringify(await this.models.list()) };
      }),
      listChatModels: unary(async (request: AgentContentRequest): Promise<AgentContentResponse> => {
        this.verifyWork(request.workId); return { valueJson: JSON.stringify(await this.models.chatList()) };
      }),
      listSlashCommands: unary((request: AgentContentRequest): AgentContentResponse => {
        this.verifyWork(request.workId);
        return { valueJson: JSON.stringify({ contractVersion: 1, commands: this.commands, checkedAt: new Date().toISOString() }) };
      }),
      getSessionChatOptions: unary(async (request: AgentContentRequest): Promise<AgentContentResponse> => {
        this.verifyWork(request.workId);
        return { valueJson: JSON.stringify(await this.sessions.chatOptions(request.objectId, this.models)) };
      }),
      setSessionChatOptions: unary(async (request: AgentContentRequest): Promise<AgentContentResponse> => {
        this.verifyWork(request.workId); this.assertAcceptingRuns();
        const input = parseContent(request);
        if (!Check(SetSessionChatOptionsSchema, input)) throw Object.assign(new Error("Invalid chat settings"), { code: status.INVALID_ARGUMENT });
        const saved = await this.sessions.setChatOptions(request.objectId, input, this.models);
        const model = JSON.parse(saved.modelPreferenceJson!) as RunModelSnapshot;
        return { valueJson: JSON.stringify({ sessionId: saved.sessionId, modelRef: model.modelRef, model: publicRunModel(model),
          thinkingLevel: model.thinkingLevel === undefined ? "off" : model.thinkingLevel, availability: "available", checkedAt: saved.updatedAt }) };
      }),
      lookupChatSubmission: unary((request: AgentContentRequest): AgentContentResponse => {
        this.verifyWork(request.workId);
        const input = parseContent(request);
        if (!Check(LookupChatSubmissionSchema, input)) throw Object.assign(new Error("Invalid submission query"), { code: status.INVALID_ARGUMENT });
        const value = input.kind === "session" ? this.store.findSessionSubmission(request.workId, input.key) : this.store.findRunSubmission(request.workId, input.key);
        const result = value ? input.kind === "session"
          ? { ...input, status: "accepted", session: publicSessionLookup(value as SessionRecord) }
          : { ...input, status: "accepted", run: publicRunLookup(value as RunRecord) }
          : { ...input, status: "not-found" };
        return { valueJson: JSON.stringify(result) };
      }),
      setSessionModel: unary(async (request: AgentContentRequest): Promise<Session> => {
        this.verifyWork(request.workId); this.assertAcceptingRuns();
        const input = parseContent(request);
        if (!Check(SetSessionModelSchema, input)) throw Object.assign(new Error("Invalid model preference"), { code: status.INVALID_ARGUMENT });
        return sessionMessage(await this.sessions.setModelPreference(request.objectId, input.modelRef, this.models));
      }),
      listAgentRequests: unary((request: AgentContentRequest): AgentContentResponse => {
        this.verifyWork(request.workId); const input = parseContent(request);
        if (!Check(AgentRequestQuerySchema, input)) throw Object.assign(new Error("Invalid request query"), { code: status.INVALID_ARGUMENT });
        return { valueJson: JSON.stringify({ ...this.store.feedback.listRequests(request.workId, input), checkedAt: new Date().toISOString(), availability: "available" }) };
      }),
      getAgentRequest: unary((request: AgentContentRequest): AgentContentResponse => {
        this.verifyWork(request.workId); const value = this.store.feedback.getRequest(request.workId, request.objectId);
        if (!value) throw Object.assign(new Error("Request not found"), { code: status.NOT_FOUND });
        const query = parseContent(request);
        if (!Check(AgentEvidenceQuerySchema, query)) throw Object.assign(new Error("Invalid evidence cursor"), { code: status.INVALID_ARGUMENT });
        return { valueJson: JSON.stringify({ request: value, evidence: this.store.feedback.listEvidence(request.workId, request.objectId, query.limit, query.cursor), checkedAt: new Date().toISOString(), availability: "available" }) };
      }),
      cancelAgentRequest: unary((request: AgentContentRequest): AgentContentResponse => {
        this.verifyWork(request.workId); const value = this.store.feedback.cancel(request.workId, request.objectId);
        if (value.state === "cancelling") for (const id of value.runIds) if (["accepted", "running", "cancelling"].includes(this.runs.get(id)?.state ?? "")) this.runs.cancel(id);
        return { valueJson: JSON.stringify(this.store.feedback.getRequest(request.workId, request.objectId)) };
      }),
      retryAgentRequest: unary((request: AgentContentRequest): AgentContentResponse => {
        this.verifyWork(request.workId); this.assertAcceptingRuns(); const input = parseContent(request);
        if (!Check(RetryAgentRequestSchema, input)) throw Object.assign(new Error("Invalid retry intent"), { code: status.INVALID_ARGUMENT });
        const value = this.store.feedback.retry(request.workId, request.objectId, input.submissionKey); this.brainLoop?.wake();
        return { valueJson: JSON.stringify(value) };
      }),
      getAgentEvidence: unary((request: AgentContentRequest): AgentContentResponse => {
        this.verifyWork(request.workId); const value = this.store.feedback.getEvidence(request.workId, request.objectId);
        if (!value) throw Object.assign(new Error("Evidence not found"), { code: status.NOT_FOUND }); return { valueJson: JSON.stringify(value) };
      }),
      readiness: unary((request: ReadinessRequest): ReadinessResponse => {
        this.verify(request);
        const value = this.daemon.readiness();
        return {
          workId: value.workId,
          generation: BigInt(value.generation),
          instanceId: value.instanceId,
          protocolVersion: AGENT_PROTOCOL_VERSION,
          acceptingRuns: value.acceptingRuns,
          draining: value.draining,
          contextContractVersion: value.contextContractVersion,
          contextIdentity: value.contextIdentity,
          initializationComplete: value.initializationComplete,
          loadedSkills: value.loadedSkills.map((skill) => ({
            name: skill.name, identity: skill.identity, loaded: skill.loaded,
            modelVisible: skill.modelVisible, visibilityReason: skill.visibilityReason,
          })),
          resolvedTools: [...value.resolvedTools],
          activeRunCount: value.activeRunCount,
          packageContractVersion: value.packageContractVersion,
          loadedPackages: value.loadedPackages.map((item) => ({ ...item })),
          packageResources: [...value.packageResources],
          packageDiagnostics: [...value.packageDiagnostics],
          runModelContractVersion: 1,
          workFeedbackContractVersion: 1,
          workHistorySchemaVersion: this.store.schemaVersion,
          chatControlsContractVersion: CHAT_CONTROLS_CONTRACT_VERSION,
          modelProviderContractVersion: 1,
        };
      }),
      prepareConfigurationChange: unary((request: PrepareConfigurationChangeRequest): PrepareConfigurationChangeResponse => {
        this.verify(request);
        return this.daemon.prepareConfigurationChange();
      }),
      drain: unary(async (request: DrainRequest): Promise<DrainResponse> => {
        this.verify(request);
        await this.runs.drain(Math.min(request.timeoutMs, 60_000));
        return { drained: true };
      }),
      createSession: unary(async (request: CreateSessionRequest): Promise<Session> => {
        this.verifyWork(request.workId);
        this.assertAcceptingRuns();
        let record=this.sessions.create(request.idempotencyKey);
        if(!record.modelPreferenceJson){try{const model=await this.models.resolve(null);const thinking=await this.models.thinking(model);if(thinking.defaultThinkingLevel===null)record=await this.sessions.setChatOptions(record.sessionId,{modelRef:null,thinkingLevel:null},this.models);}catch(error){if(!(error instanceof RunModelError))throw error;}}
        return sessionMessage(record);
      }),
      listSessions: unary((request: ListSessionsRequest): ListSessionsResponse => {
        this.verifyWork(request.workId);
        return { sessions: this.sessions.list().map(sessionMessage), nextPageToken: "" };
      }),
      readSession: unary((request: ReadSessionRequest): SessionHistory => {
        this.verifyWork(request.workId);
        const value = this.sessions.read(request.sessionId);
        const record = this.sessions.list().find((item) => item.sessionId === request.sessionId)!;
        const runs = this.store.listSessionRuns(request.workId, request.sessionId);
        const owners = new Map<string, Set<string>>();
        for (const run of runs) for (const event of this.store.readEvents(run.runId, Math.max(0,run.earliestAvailableSequence-1))) {
          if (event.eventType !== "tool-start" && event.eventType !== "tool-end") continue;
          const call = (JSON.parse(event.payloadJson) as { toolCallId?: string }).toolCallId;
          if (call) { const ids = owners.get(call) ?? new Set<string>(); ids.add(run.runId); owners.set(call, ids); }
        }
        return {
          session: sessionMessage(record),
          messages: value.entries.map((entry) => {
            let runId = entry.runId !== undefined ? runs.find(run => run.runId === entry.runId)?.runId ?? "" : "";
            if (entry.runId === undefined) {
              const calls = entry.blocks.flatMap(block => block.type === "text" ? [] : [block.toolCallId]);
              const matches = calls.map(call => owners.get(call));
              if (matches.length && matches.every(match => match?.size === 1)) {
                const ids = new Set(matches.flatMap(match => [...match!]));
                if (ids.size === 1) runId = [...ids][0]!;
              }
            }
            return { entryId: entry.id, role: entry.role, text: entry.text, createdAt: "", runId, blocks: entry.blocks.map(block => ({ blockId: block.blockId, type: block.type, text: block.type === "text" ? block.text : "", toolCallId: block.type === "text" ? "" : block.toolCallId, toolName: block.type === "text" ? "" : block.toolName, resultPreviewJson: block.type === "tool-result" ? JSON.stringify(block.result) : "" })) };
          }),
          runs: runs.map(runMessage),
        };
      }),
      submitRun: unary(async (request: SubmitRunRequest): Promise<SubmitRunResponse> => {
        this.verifyWork(request.workId);
        if (request.inputMode !== undefined && !Check(ChatInputModeSchema, request.inputMode)) throw Object.assign(new Error("Invalid input mode"), { code: status.INVALID_ARGUMENT });
        const result = await this.runs.submitChat({ ...request, inputMode: request.inputMode as "text" | "command" | undefined, ...(request.modelRef === "" ? { modelRef: null } : {}) });
        return { run: runMessage(result.run), reused: result.reused };
      }),
      getRun: unary((request: GetRunRequest): Run => runMessage(this.requireRun(request.workId, request.runId))),
      cancelRun: unary((request: CancelRunRequest): Run => {
        this.requireRun(request.workId, request.runId);
        return runMessage(this.runs.cancel(request.runId));
      }),
      watchRun: (call: ServerWritableStream<WatchRunRequest, RunEvent>) => { void this.watch(call); },
    };
  }

  private async watch(call: ServerWritableStream<WatchRunRequest, RunEvent>): Promise<void> {
    try {
      this.authenticate(call);
      this.verifyWork(call.request.workId);
      let cursor = Number(call.request.afterSequence ?? 0n);
      while (!call.cancelled) {
        for (const event of this.runs.watch(call.request.runId, cursor)) {
          const run = this.requireRun(call.request.workId, call.request.runId);
          cursor = event.sequence;
          call.write(eventMessage(event, run));
        }
        const run = this.requireRun(call.request.workId, call.request.runId);
        if (isTerminal(run) && cursor >= run.latestSequence) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      call.end();
    } catch (error) {
      call.destroy(grpcError(error));
    }
  }

  private authenticate(call: { getAuthContext(): AgentAuthContext }): void {
    assertAgentPeerIdentity(call.getAuthContext(), this.config.tls.expectedClientCommonName, {
      installationId: this.installationId, workId: this.config.workId,
      generation: this.config.generation, instanceId: this.config.instanceId,
    });
  }

  private verify(value: { workId: string; generation: bigint; instanceId: string }): void {
    this.daemon.verifyIdentity({
      workId: value.workId,
      generation: Number(value.generation),
      instanceId: value.instanceId,
    });
  }

  private verifyWork(workId: string): void {
    if (workId !== this.config.workId) throw Object.assign(new Error("Work identity mismatch"), { code: status.PERMISSION_DENIED });
  }

  private assertAcceptingRuns(): void {
    if (!this.daemon.readiness().acceptingRuns) {
      throw Object.assign(new Error("Work is initializing and cannot accept Sessions or Runs"), { code: status.FAILED_PRECONDITION });
    }
  }

  private requireRun(workId: string, runId: string): RunRecord {
    this.verifyWork(workId);
    const run = this.runs.get(runId);
    if (run === undefined || run.workId !== workId) throw Object.assign(new Error("Run not found"), { code: status.NOT_FOUND });
    return run;
  }
}

export function selectPackageTools(packageTools: ReadonlyMap<string, string>,
  policy: { readonly allowed: readonly string[]; readonly denied: readonly string[] }, reserved: ReadonlySet<string>): Array<[string, string]> {
  for (const name of packageTools.values()) if (reserved.has(name)) throw new Error(`package tool conflicts with existing tool ${name}`);
  const allowed = new Set(policy.allowed), denied = new Set(policy.denied);
  return [...packageTools].filter(([canonical]) => (allowed.size === 0 || allowed.has(canonical)) && !denied.has(canonical));
}

export interface AgentAuthContext {
  readonly transportSecurityType?: string;
  readonly sslPeerCertificate?: {
    readonly subject?: { readonly CN?: string | string[] };
    readonly subjectaltname?: string;
  };
}

export function assertAgentPeerIdentity(context: AgentAuthContext, expectedClientCommonName: string,
  scope: { readonly installationId: string; readonly workId: string; readonly generation: number; readonly instanceId: string }): void {
  const commonName = context.sslPeerCertificate?.subject?.CN;
  const expectedUri = `URI:spiffe://piwork/installation/${scope.installationId}/work/${scope.workId}/generation/${scope.generation}/instance/${scope.instanceId}/role/core-client`;
  const identities = (context.sslPeerCertificate?.subjectaltname ?? "").split(/,\s*/)
    .filter((value) => value.startsWith("URI:spiffe://piwork/installation/"));
  if (context.transportSecurityType !== "ssl"
    || Array.isArray(commonName)
    || commonName !== expectedClientCommonName
    || identities.length !== 1 || identities[0] !== expectedUri) {
    throw Object.assign(new Error("agent authentication failed"), { code: status.UNAUTHENTICATED });
  }
}

function readConfig(path: string): AgentRuntimeConfig {
  const raw = readFileSync(path, "utf8");
  if (raw.length > 1_048_576) throw new Error("agent configuration is too large");
  const value = JSON.parse(raw) as Partial<AgentRuntimeConfig>;
  if (value.version !== 1 || typeof value.workId !== "string" || !Number.isSafeInteger(value.generation)
    || typeof value.instanceId !== "string" || typeof value.listen !== "string"
    || typeof value.dataDirectory !== "string" || typeof value.deterministic !== "boolean"
    || (value.initializationOnly !== undefined && typeof value.initializationOnly !== "boolean")
    || (value.correlationId !== undefined && (typeof value.correlationId !== "string" || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(value.correlationId)))
    || value.model === undefined || typeof value.model.provider !== "string" || typeof value.model.id !== "string"
    || (value.model.baseUrl !== undefined && typeof value.model.baseUrl !== "string")
    || (value.model.credentialPath !== undefined && typeof value.model.credentialPath !== "string")
    || value.tls === undefined || typeof value.tls.caCertificatePath !== "string"
    || typeof value.tls.serverCertificatePath !== "string"
    || typeof value.tls.serverPrivateKeyPath !== "string"
    || typeof value.tls.expectedClientCommonName !== "string"
    || (value.serviceControl !== undefined && (typeof value.serviceControl.endpoint !== "string"
      || typeof value.serviceControl.serverName !== "string"
      || typeof value.serviceControl.caCertificatePath !== "string"
      || typeof value.serviceControl.clientCertificatePath !== "string"
      || typeof value.serviceControl.clientPrivateKeyPath !== "string"))) throw new Error("agent configuration is invalid");
  return value as AgentRuntimeConfig;
}

function loadWorkContext(config: AgentRuntimeConfig): CapturedWorkContext {
  const configPath = config.contextConfigPath ?? "/run/piwork/config.json";
  try {
    const value = JSON.parse(readFileSync(configPath, "utf8")) as { skills?: unknown; packages?: unknown; agentsMdPath?: unknown; contextIdentity?: unknown; resolvedTools?: unknown; tools?: Parameters<typeof resolveBuiltInWorkTools>[0]; mcpServers?: unknown };
    const metadata = JSON.parse(readFileSync(join(configPath, "..", "metadata.json"), "utf8")) as { snapshotId?: unknown; workId?: unknown; skills?: Array<{ name?: unknown; identity?: unknown }>; packageContractVersion?: unknown; packageBindings?: unknown };
    if (metadata.workId !== config.workId || typeof metadata.snapshotId !== "string" || metadata.snapshotId !== config.contextIdentity) {
      throw new Error("Work context identity mismatch");
    }
    if (!Array.isArray(value.skills) || !value.skills.every((name) => typeof name === "string") || !Array.isArray(metadata.skills)) {
      throw new Error("invalid Work Skill descriptor");
    }
    if (metadata.packageContractVersion !== 1 || !Array.isArray(metadata.packageBindings) || !Array.isArray(value.packages)) throw new Error("Work package contract is unavailable");
    const configuredNames = value.skills as string[];
    const skills = metadata.skills.map((skill, index) => {
      if (typeof skill.name !== "string" || typeof skill.identity !== "string" || skill.name !== configuredNames[index]) throw new Error("invalid Work Skill descriptor");
      return { name: skill.name, digest: skill.identity };
    });
    const agentsPath = typeof value.agentsMdPath === "string" ? value.agentsMdPath : config.agentsMdPath ?? "/run/piwork/AGENTS.md";
    const agentsMd = readFileSync(agentsPath, "utf8");
    const resolvedTools = Array.isArray(value.resolvedTools)
      ? value.resolvedTools.filter((item): item is string => typeof item === "string")
      : value.tools === undefined ? undefined : resolveBuiltInWorkTools(value.tools);
    if (resolvedTools === undefined) throw new Error("Work tool policy is unavailable");
    if (value.tools === undefined || !Array.isArray(value.mcpServers)) throw new Error("Work MCP configuration is unavailable");
    return { skillRoot: "/run/piwork/skills", skills, agentsMd, contextIdentity: metadata.snapshotId, resolvedTools, toolPolicy: value.tools, mcpServers: value.mcpServers as McpServer[],
      packages: value.packages as PiPackageSelectionEntry[], packageBindings: metadata.packageBindings as PackageBinding[] };
  } catch (error) { throw error; }
}

async function loadValidatedWorkContext(context: CapturedWorkContext, workspace: string, agentDirectory: string, store: WorkStore, onSkillsLoaded: () => void, onSkillsValidated: () => void): Promise<LoadedWorkContext> {
  const loaded = await loadConfiguredSkills(context.skillRoot, context.skills, context.agentsMd, onSkillsValidated);
  onSkillsLoaded();
  const loaderFactory = (run?: RunExecutionContext) => createPackageResourceLoader({ root: "/run/piwork/packages", bindings: context.packageBindings,
    selection: context.packages, standaloneSkills: loaded.skills, agentsMd: context.agentsMd, workspace, agentDirectory,
    ...(run ? { experience: adoptedMemory(store,run),memorySelection:run.adoptedMemorySelection??store.getRun(run.runId)?.adoptedMemorySelection } : {}) });
  const packageResources = await loaderFactory();
  const tools = new Set(context.resolvedTools);
  return {
    commands: packageResources.commands,
    contextIdentity: context.contextIdentity,
    loaderFactory: async (run) => (await loaderFactory(run)).loader,
    resolvedTools: context.resolvedTools,
    packageTools: packageResources.toolNames,
    packages: packageResources.packages,
    packageResources: packageResources.resources,
    mcpServers: context.mcpServers,
    toolPolicy: context.toolPolicy,
    skills: loaded.statuses.map((status) => {
      const skill = loaded.skills.find((item) => item.name === status.name);
      const visibility = skillVisibility(skill?.disableModelInvocation, tools);
      return {
        name: status.name,
        identity: status.digest,
        loaded: status.loaded,
        ...visibility,
      };
    }),
  };
}

function adoptedMemory(store: WorkStore,run: RunExecutionContext) {
  const snapshot=store.feedback.experienceSnapshot(run.workId,run.adoptedExperienceVersion??0);
  const selection=run.adoptedMemorySelection??store.getRun(run.runId)?.adoptedMemorySelection;
  return {version:snapshot.version,entries:snapshot.entries.filter(entry=>selection?.entryIds.includes(entry.entryId))};
}

function mcpServer(server: McpServer): McpBridgeServer {
  if (server.transport === "stdio") {
    if (server.command === undefined) throw new Error(`stdio MCP ${server.serverId} has no command`);
    return {
      serverId: server.serverId,
      required: server.required,
      transport: "stdio",
      command: server.command,
      args: server.args,
      timeoutMs: server.timeoutMs,
    };
  }
  if (server.url === undefined) throw new Error(`HTTP MCP ${server.serverId} has no URL`);
  return { serverId: server.serverId, required: server.required, transport: "streamable-http", url: server.url, timeoutMs: server.timeoutMs };
}

export function mcpTools(
  bridge: McpBridge,
  policy: CapturedWorkContext["toolPolicy"],
): Array<{ readonly canonicalName: string; readonly definition: ToolDefinition }> {
  const allowed = new Set(policy.allowed);
  const denied = new Set(policy.denied);
  return bridge.listTools()
    .filter((tool) => (allowed.size === 0 || allowed.has(tool.namespacedName)) && !denied.has(tool.namespacedName))
    .map((tool) => ({
      canonicalName: tool.namespacedName,
      definition: defineTool({
        name: tool.modelName,
        label: tool.namespacedName,
        description: `${tool.description ?? `MCP tool ${tool.namespacedName}`} (canonical name: ${tool.namespacedName})`,
        parameters: tool.inputSchema as any,
        execute: async (_id, parameters) => {
          const result = await bridge.callTool(tool.namespacedName, parameters) as { content?: unknown; isError?: boolean };
          return { content: Array.isArray(result.content) ? result.content as any : [{ type: "text", text: JSON.stringify(result) }], details: { serverId: tool.serverId, canonicalName: tool.namespacedName, isError: result.isError === true } };
        },
      }),
    }));
}

export function skillVisibility(
  disableModelInvocation: boolean | undefined,
  resolvedTools: ReadonlySet<string> | readonly string[],
): { readonly modelVisible: boolean; readonly visibilityReason: "" | "model-invocation-disabled" | "read-tools-disabled" } {
  const tools = resolvedTools instanceof Set ? resolvedTools : new Set(resolvedTools);
  if (disableModelInvocation === true) return { modelVisible: false, visibilityReason: "model-invocation-disabled" };
  if (!tools.has("read") && !tools.has("bash")) return { modelVisible: false, visibilityReason: "read-tools-disabled" };
  return { modelVisible: true, visibilityReason: "" };
}

function readBoundedRegularFile(path: string): Buffer {
  const information = lstatSync(path);
  if (information.isSymbolicLink() || !information.isFile() || information.size < 1 || information.size > 1024 * 1024) {
    throw new Error("agent TLS material is invalid");
  }
  return readFileSync(path);
}

function sessionMessage(value: SessionRecord): Session {
  const preference = value.modelPreferenceJson ? JSON.parse(value.modelPreferenceJson) as RunModelSnapshot & { availability?: string } : undefined;
  return { workId: value.workId, sessionId: value.sessionId, sdkHistoryPath: value.sdkHistoryPath, createdAt: value.createdAt, updatedAt: value.updatedAt,
    modelPreferenceJson: preference ? JSON.stringify({ ...publicRunModel(preference), availability: preference.availability ?? "available" }) : "",
    sourceJson: value.sourceJson ?? "", thinkingUnrequested: preference?.thinkingLevel === null, thinkingLevel: preference?.thinkingLevel ?? "off" };
}

function runMessage(value: RunRecord): Run {
  const states: Record<RunRecord["state"], RunState> = {
    accepted: RunState.RUN_STATE_ACCEPTED,
    running: RunState.RUN_STATE_RUNNING,
    cancelling: RunState.RUN_STATE_CANCELLING,
    succeeded: RunState.RUN_STATE_SUCCEEDED,
    failed: RunState.RUN_STATE_FAILED,
    cancelled: RunState.RUN_STATE_CANCELLED,
    interrupted: RunState.RUN_STATE_INTERRUPTED,
  };
  return {
    workId: value.workId, sessionId: value.sessionId, runId: value.runId,
    submissionKey: value.submissionKey, state: states[value.state], promptDigest: value.promptDigest,
    finalText: value.finalText ?? "", error: value.errorJson === null ? undefined : JSON.parse(value.errorJson),
    acceptedAt: value.acceptedAt, startedAt: value.startedAt ?? "", finishedAt: value.finishedAt ?? "",
    earliestAvailableSequence: BigInt(value.earliestAvailableSequence), latestSequence: BigInt(value.latestSequence),
    actualModelJson: value.actualModelJson ? JSON.stringify(publicRunModel(JSON.parse(value.actualModelJson) as RunModelSnapshot)) : "",
    sourceJson: value.sourceJson ?? "", adoptedExperienceVersion: value.adoptedExperienceVersion ?? 0,
    thinkingUnrequested: value.actualModelJson ? (JSON.parse(value.actualModelJson) as RunModelSnapshot).thinkingLevel === null : false,
    thinkingLevel: value.actualModelJson ? (JSON.parse(value.actualModelJson) as RunModelSnapshot).thinkingLevel ?? "off" : "off",
  };
}

function publicSessionLookup(value: SessionRecord) {
  const session = sessionMessage(value);
  return { workId: session.workId, sessionId: session.sessionId, createdAt: session.createdAt, updatedAt: session.updatedAt,
    modelPreference: session.modelPreferenceJson ? JSON.parse(session.modelPreferenceJson) : null, thinkingLevel: session.thinkingUnrequested ? null : session.thinkingLevel,
    source: session.sourceJson ? JSON.parse(session.sourceJson) : { kind: "chat" } };
}

function publicRunLookup(value: RunRecord) {
  const run = runMessage(value);
  return { workId: run.workId, sessionId: run.sessionId, runId: run.runId, submissionKey: run.submissionKey, state: run.state,
    promptDigest: run.promptDigest, finalText: run.finalText, acceptedAt: run.acceptedAt, startedAt: run.startedAt, finishedAt: run.finishedAt,
    earliestAvailableSequence: String(run.earliestAvailableSequence), latestSequence: String(run.latestSequence),
    actualModel: run.actualModelJson ? JSON.parse(run.actualModelJson) : null, thinkingLevel: run.thinkingUnrequested ? null : run.thinkingLevel,
    source: run.sourceJson ? JSON.parse(run.sourceJson) : { kind: "chat" }, adoptedExperienceVersion: run.adoptedExperienceVersion,
    ...(run.error ? { error: run.error } : {}) };
}

function eventMessage(value: RunEventRecord, run: RunRecord): RunEvent {
  const payload = JSON.parse(value.payloadJson) as Record<string, unknown>;
  const kind = value.eventType === "text"
    ? { $case: "text" as const, text: { delta: String(payload.delta ?? "") } }
    : value.eventType.startsWith("tool")
      ? { $case: "tool" as const, tool: { serverId: "", toolName: String(payload.toolName ?? ""), toolCallId: String(payload.toolCallId ?? ""), phase: value.eventType, isError: Boolean(payload.isError), resultPreviewJson: payload.result ? JSON.stringify(payload.result) : "" } }
      : { $case: "state" as const, state: { state: runMessage(run).state, finalText: run.finalText ?? "", error: run.errorJson === null ? undefined : JSON.parse(run.errorJson) } };
  return { workId: run.workId, sessionId: run.sessionId, runId: run.runId, sequence: BigInt(value.sequence), createdAt: value.createdAt, kind };
}

function isTerminal(run: RunRecord): boolean {
  return ["succeeded", "failed", "cancelled", "interrupted"].includes(run.state);
}

function grpcError(error: unknown): Error & { code: number } {
  if (error instanceof RunModelError) return Object.assign(new Error(`${error.modelErrorCode}: ${error.message}`), { code: status.FAILED_PRECONDITION });
  if (error instanceof FeedbackError) return Object.assign(new Error(`${error.code}: ${error.message}`), { code: error.code === "REQUEST_NOT_FOUND" ? status.NOT_FOUND : error.code === "INVALID_CURSOR" ? status.INVALID_ARGUMENT : status.FAILED_PRECONDITION });
  const item = error as { message?: string; code?: number; name?: string };
  const code = item.code ?? (item.name === "WorkBusyError" ? status.RESOURCE_EXHAUSTED
    : item.name === "SessionContextUnavailableError" ? status.FAILED_PRECONDITION
      : item.name === "SessionNotFoundError" ? status.NOT_FOUND
      : item.name === "SubmitConflictError" ? status.ALREADY_EXISTS
      : item.name === "CursorExpiredError" ? status.OUT_OF_RANGE
      : item.name === "RuntimeIdentityError" ? status.PERMISSION_DENIED : status.INTERNAL);
  return Object.assign(new Error(item.message ?? "agent request failed"), { code });
}

function parseContent(request: AgentContentRequest): unknown {
  try { return JSON.parse(request.inputJson || "{}"); }
  catch { throw Object.assign(new Error("Invalid request content"), { code: status.INVALID_ARGUMENT }); }
}
