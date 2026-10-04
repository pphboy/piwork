import { createAgentSession, ModelRuntime, SettingsManager, type ResourceLoader, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { lstatSync, readFileSync } from "node:fs";
import { chmod, lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createDeterministicRuntime, mapSdkEvent } from "@piwork/pi-adapter";
import type { RunExecutionContext, RunExecutor } from "./runs.js";
import type { AgentSessionService } from "./sessions.js";
import { isBrainVerificationTarget, type RunModelSnapshot } from "@piwork/contracts";
import type { RunModelResolver } from "./run-models.js";

const CHILD_AGENT_DIRECTORY = "/tmp/piwork-child-agent";

export class PiSdkRunExecutor implements RunExecutor {
  constructor(
    private readonly sessions: AgentSessionService,
    private readonly agentDirectory: string,
    private readonly modelConfig: {
      readonly provider: string;
      readonly id: string;
      readonly baseUrl?: string;
      readonly credentialPath?: string;
      readonly deterministic: boolean;
    },
    private readonly context: { readonly resourceLoaderFactory: (context?: RunExecutionContext) => Promise<ResourceLoader>; readonly resolvedTools: readonly string[]; readonly customTools?: readonly ToolDefinition[]; readonly models?: RunModelResolver;
      readonly packageTools?: ReadonlyMap<string, string>;
      readonly onSdkToolResult?: (context: RunExecutionContext, result: { toolName: string; toolCallId: string; args: unknown; isError: boolean; result: unknown }) => void },
  ) {}

  async execute(context: RunExecutionContext): Promise<{ readonly finalText: string }> {
    emitRunPhase(context, "runtime-started");
    // Credentials exist only in this invocation's ModelRuntime. The persisted
    // descriptor and SDK history contain no credential or ambient auth authority.
    const credential = context.actualModel && this.context.models ? await this.context.models.credential(context.actualModel) : undefined;
    const { runtime, model } = this.modelConfig.deterministic && (!context.actualModel || context.actualModel.provider === "piwork-deterministic")
      ? await createDeterministicRuntime(context.actualModel?.model)
      : await this.productionRuntime(context.actualModel, credential);
    emitRunPhase(context, "runtime-created");
    const resourceLoader = await this.context.resourceLoaderFactory(context);
    emitRunPhase(context, "resource-loader-created");
    emitRunPhase(context, "session-continue-started");
    let sessionManager;
    try {
      sessionManager = this.sessions.continue(context.sessionId);
    } catch {
      emitRunPhase(context, "session-continue-failed");
      throw new Error("historical Session cannot be continued in this context");
    }
    emitRunPhase(context, "session-continue-succeeded");
    const { session } = await createAgentSession({
      cwd: this.sessions.workspaceDirectory(),
      agentDir: this.agentDirectory,
      modelRuntime: runtime,
      model,
      thinkingLevel: "off",
      sessionManager,
      tools: [...this.context.resolvedTools],
      customTools: [...(this.context.customTools ?? [])],
      resourceLoader,
      settingsManager: SettingsManager.inMemory(),
    });
    emitRunPhase(context, "session-loaded");
    let finalText = "";
    const toolInputs = new Map<string, unknown>();
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "tool_execution_start") toolInputs.set(event.toolCallId, event.args);
      if (event.type === "tool_execution_end") {
        this.context.onSdkToolResult?.(context, { ...event, args: toolInputs.get(event.toolCallId) }); toolInputs.delete(event.toolCallId);
      }
      const mapped = mapSdkEvent(event);
      if (mapped?.type === "text-delta") {
        const delta = String(mapped.payload.delta ?? "");
        finalText += delta;
        context.emit("text", { delta });
      } else if (mapped?.type === "tool-start" || mapped?.type === "tool-end") {
        const canonical = event.type === "tool_execution_start" ? [...(this.context.packageTools ?? [])].find(([name, native]) => native === event.toolName && name.startsWith("package:piwork-brain:"))?.[0] : undefined;
        const args = event.type === "tool_execution_start" && canonical && isBrainVerificationTarget({ contractVersion: 1, toolName: canonical, input: event.args, checkNames: ["sdk-input"] }) ? event.args : undefined;
        context.emit(mapped.type, { ...mapped.payload, ...(args === undefined ? {} : { args }) });
      }
    });
    const abort = () => { void session.abort(); };
    context.signal.addEventListener("abort", abort, { once: true });
    let phase: "initialization" | "run" | "shutdown" = "initialization";
    let initializationErrors = 0, runErrors = 0, shutdownErrors = 0;
    const unsubscribeExtensionErrors = session.extensionRunner.onError(() => {
      if (phase === "initialization") initializationErrors++;
      else if (phase === "run") runErrors++;
      else shutdownErrors++;
    });
    const failExtensionEvent = (stage: "initialization" | "run"): never => {
      context.emit("diagnostic", { code: "PI_PACKAGE_EXTENSION_EVENT_FAILED", stage,
        message: "Package extension event failed." });
      throw new Error("package extension event failed");
    };
    try {
      await session.bindExtensions({ mode: "json" });
      emitRunPhase(context, "extensions-bound");
      if (initializationErrors > 0) failExtensionEvent("initialization");
      context.signal.throwIfAborted();
      phase = "run";
      emitRunPhase(context, "prompt-started");
      await session.prompt(context.prompt);
      emitRunPhase(context, "prompt-finished");
      if (runErrors > 0) failExtensionEvent("run");
      const assistant = session.messages.findLast((message) => message.role === "assistant");
      if (assistant === undefined) throw new Error("model execution produced no assistant result");
      if (assistant.stopReason === "error") throw new Error("model execution ended with a provider error");
      if (assistant.stopReason === "aborted" && !context.signal.aborted) {
        throw new Error("model execution ended unexpectedly");
      }
      const persistedText = assistant.content
        .flatMap((part) => part.type === "text" ? [part.text] : [])
        .join("");
      return { finalText: persistedText || finalText };
    } finally {
      context.signal.removeEventListener("abort", abort);
      unsubscribe();
      phase = "shutdown";
      emitRunPhase(context, "shutdown-started");
      try { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); }
      catch { shutdownErrors++; }
      finally {
        unsubscribeExtensionErrors();
        session.dispose();
      }
      emitRunPhase(context, "shutdown-finished");
      if (shutdownErrors > 0) {
        try { context.emit("diagnostic", { code: "PI_PACKAGE_EXTENSION_CLEANUP_FAILED", stage: "shutdown",
          message: "Package extension shutdown failed." }); }
        catch { /* A cleanup diagnostic cannot change the Run outcome. */ }
      }
    }
  }

  private async productionRuntime(snapshot?: RunModelSnapshot, temporaryCredential?: string) {
    let credential = temporaryCredential;
    if (credential === undefined) {
      if (snapshot?.modelRef) throw new Error("selected model credential is unavailable");
      const credentialPath = this.modelConfig.credentialPath;
      if (credentialPath === undefined) throw new Error("model credential is unavailable");
      const information = lstatSync(credentialPath);
      if (information.isSymbolicLink() || !information.isFile() || information.size < 1 || information.size > 64 * 1024) throw new Error("model credential is invalid");
      credential = readFileSync(credentialPath, "utf8").replace(/[\r\n]+$/, "");
    }
    if (credential === "") throw new Error("model credential is invalid");
    const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
    const config = snapshot ? { provider: snapshot.provider, id: snapshot.model, ...(snapshot.baseUrl ? { baseUrl: snapshot.baseUrl } : {}) } : this.modelConfig;
    const model = resolveProductionModel(runtime, config);
    await runtime.setRuntimeApiKey(config.provider, credential);
    return { runtime, model };
  }
}

/** Existing package children retain the Work default; overrides never rewrite it. */
export async function initializeDefaultChildAgentModel(config: { readonly provider: string; readonly id: string; readonly baseUrl?: string; readonly credentialPath?: string }): Promise<void> {
  if (!config.credentialPath) throw new Error("Work model credential is unavailable");
  const information = lstatSync(config.credentialPath);
  if (!information.isFile() || information.isSymbolicLink() || information.size < 1 || information.size > 64 * 1024) throw new Error("Work model credential is invalid");
  const credential = readFileSync(config.credentialPath, "utf8").replace(/[\r\n]+$/, "");
  if (!credential) throw new Error("Work model credential is invalid");
  const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  await writeChildAgentModelFiles(CHILD_AGENT_DIRECTORY, resolveProductionModel(runtime, config), credential);
}

/** Remove credentials left by a previous agent generation before loading extensions. */
export async function initializeChildAgentDirectory(directory = CHILD_AGENT_DIRECTORY): Promise<void> {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const information = await lstat(directory);
  if (!information.isDirectory() || information.isSymbolicLink()) throw new Error("child agent configuration directory is invalid");
  await chmod(directory, 0o700);
}

export async function writeChildAgentModelFiles(
  directory: string, model: ReturnType<typeof resolveProductionModel>, credential: string,
): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const information = await lstat(directory);
  if (!information.isDirectory() || information.isSymbolicLink()) throw new Error("child agent configuration directory is invalid");
  await chmod(directory, 0o700);
  const definition = {
    id: model.id, name: model.name, reasoning: model.reasoning, input: model.input,
    cost: model.cost, contextWindow: model.contextWindow, maxTokens: model.maxTokens,
  };
  const models = { providers: { [model.provider]: { baseUrl: model.baseUrl, api: model.api, models: [definition] } } };
  const auth = { [model.provider]: { type: "api_key", key: credential } };
  for (const [name, value] of [["models.json", models], ["auth.json", auth]] as const) {
    const temporary = join(directory, `.${name}.${randomUUID()}`);
    try {
      await writeFile(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
      await rename(temporary, join(directory, name));
    } finally { await rm(temporary, { force: true }); }
  }
}

type RunPhase = "runtime-started" | "runtime-created" | "resource-loader-created" | "session-loaded"
  | "session-continue-started" | "session-continue-failed" | "session-continue-succeeded"
  | "extensions-bound" | "prompt-started" | "prompt-finished" | "shutdown-started" | "shutdown-finished";

function emitRunPhase(context: Pick<RunExecutionContext, "workId" | "sessionId" | "runId" | "emit">, phase: RunPhase): void {
  context.emit("diagnostic", { code: "PI_SDK_RUN_PHASE", phase });
}

export function resolveProductionModel(
  runtime: ModelRuntime,
  config: { readonly provider: string; readonly id: string; readonly baseUrl?: string },
) {
  const existing = runtime.getModel(config.provider, config.id);
  if (config.baseUrl !== undefined) {
    if (existing === undefined && config.provider === "anthropic") {
      runtime.registerProvider(config.provider, {
        baseUrl: config.baseUrl,
        api: "anthropic-messages",
        models: [{
          id: config.id,
          name: config.id,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128_000,
          maxTokens: 8_192,
        }],
      });
    } else {
      runtime.registerProvider(config.provider, { baseUrl: config.baseUrl });
    }
  }
  const model = runtime.getModel(config.provider, config.id);
  if (model === undefined) throw new Error("configured model is not available");
  return model;
}
