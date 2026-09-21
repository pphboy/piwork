import { createAgentSession, ModelRuntime, type ResourceLoader } from "@earendil-works/pi-coding-agent";
import { lstatSync, readFileSync } from "node:fs";
import { createDeterministicRuntime, mapSdkEvent } from "@piwork/pi-adapter";
import type { RunExecutionContext, RunExecutor } from "./runs.js";
import type { AgentSessionService } from "./sessions.js";

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
    private readonly context: { readonly resourceLoader: ResourceLoader; readonly resolvedTools: readonly string[] },
  ) {}

  async execute(context: RunExecutionContext): Promise<{ readonly finalText: string }> {
    const { runtime, model } = this.modelConfig.deterministic
      ? await createDeterministicRuntime()
      : await this.productionRuntime();
    const { session } = await createAgentSession({
      cwd: process.cwd(),
      agentDir: this.agentDirectory,
      modelRuntime: runtime,
      model,
      thinkingLevel: "off",
      sessionManager: this.sessions.continue(context.sessionId),
      tools: [...this.context.resolvedTools],
      resourceLoader: this.context.resourceLoader,
    });
    let finalText = "";
    const unsubscribe = session.subscribe((event) => {
      const mapped = mapSdkEvent(event);
      if (mapped?.type === "text-delta") {
        const delta = String(mapped.payload.delta ?? "");
        finalText += delta;
        context.emit("text", { delta });
      } else if (mapped?.type === "tool-start" || mapped?.type === "tool-end") {
        context.emit(mapped.type, mapped.payload);
      }
    });
    const abort = () => { void session.abort(); };
    context.signal.addEventListener("abort", abort, { once: true });
    try {
      await session.prompt(context.prompt);
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
      session.dispose();
    }
  }

  private async productionRuntime() {
    const credentialPath = this.modelConfig.credentialPath;
    if (credentialPath === undefined) throw new Error("model credential is unavailable");
    const information = lstatSync(credentialPath);
    if (information.isSymbolicLink() || !information.isFile() || information.size < 1 || information.size > 64 * 1024) {
      throw new Error("model credential is invalid");
    }
    const credential = readFileSync(credentialPath, "utf8").replace(/[\r\n]+$/, "");
    if (credential === "") throw new Error("model credential is invalid");
    const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
    const model = resolveProductionModel(runtime, this.modelConfig);
    await runtime.setRuntimeApiKey(this.modelConfig.provider, credential);
    return { runtime, model };
  }
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
