import { join } from "node:path";
import {
  createAgentSession,
  ModelRuntime,
  resolveCliModel,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { errorMessage, type Logger } from "../common/logger.js";
import {
  BackendError,
  type AgentBackend,
  type AskEventSink,
  type AskInput,
  type AskOutcome,
  type BackendHealth,
} from "./agent-backend.js";
import { mapPiEvent, resultEvent, sessionStartedEvent } from "./event-mapper.js";
import { SessionRegistry, type SessionEntry } from "./session-registry.js";

/** Derived from the SDK surface so this file never imports pi-ai directly. */
type PiModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;
type PiThinkingLevel = NonNullable<ReturnType<typeof resolveCliModel>["thinkingLevel"]>;

interface SessionValue {
  session: AgentSession;
  model: PiModel;
  cwd: string;
}

export interface PiBackendOptions {
  agentDir: string;
  workspace: string;
  provider: string;
  model: string | undefined;
  tools: string[];
  apiKey: string | undefined;
  log: Logger;
}

/**
 * Agent backend backed by the pi coding agent SDK.
 *
 * The SDK is imported here and nowhere else, so the transport layer and the
 * session bookkeeping can be exercised without model credentials.
 */
export class PiBackend implements AgentBackend {
  private runtimePromise: Promise<ModelRuntime> | undefined;
  private model: PiModel | undefined;
  private thinkingLevel: PiThinkingLevel | undefined;
  private readonly sessions = new SessionRegistry<SessionValue>();

  constructor(private readonly options: PiBackendOptions) {}

  async health(): Promise<BackendHealth> {
    const runtime = await this.ensureRuntime();
    const auth = await runtime.getAuth(this.options.provider).catch((error: unknown) => {
      this.options.log.debug("auth lookup failed", { error: errorMessage(error) });
      return undefined;
    });

    let modelId: string | undefined;
    let baseUrl: string | undefined;
    try {
      const model = await this.resolveModel();
      modelId = model.id;
      baseUrl = model.baseUrl;
    } catch (error) {
      // Health must stay answerable while the model is unresolved: that is
      // exactly the state an operator needs to inspect.
      this.options.log.debug("model unresolved", { reason: errorMessage(error) });
    }

    return {
      model: modelId,
      provider: this.options.provider,
      authenticated: auth !== undefined,
      authSource: auth?.source,
      baseUrl,
      sessionCount: this.sessions.size,
      agentDir: this.options.agentDir,
    };
  }

  async ask(input: AskInput, sink: AskEventSink, signal: AbortSignal): Promise<AskOutcome> {
    const prompt = input.prompt.trim();
    if (prompt === "") {
      throw new BackendError("INVALID_ARGUMENT", "prompt must not be empty");
    }

    const entry = await this.getOrCreateEntry(input.sessionId, input.cwd ?? this.options.workspace);
    if (entry.busy) {
      throw new BackendError("SESSION_BUSY", `session ${entry.id} is still answering the previous question`);
    }
    this.sessions.markBusy(entry.id, true);

    const startedAt = Date.now();
    let text = "";
    let turns = 0;
    let aborted = false;

    const unsubscribe = entry.value.session.subscribe((event) => {
      const mapping = mapPiEvent(event);
      if (mapping.textDelta !== undefined) text += mapping.textDelta;
      if (mapping.turnEnded === true) turns += 1;
      if (mapping.emit !== undefined) sink(mapping.emit);
    });

    const onAbort = (): void => {
      aborted = true;
      void entry.value.session.abort().catch((error: unknown) => {
        this.options.log.warn("session abort failed", { sessionId: entry.id, error: errorMessage(error) });
      });
    };
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      sink(
        sessionStartedEvent({
          sessionId: entry.id,
          model: entry.value.model.id,
          cwd: entry.value.cwd,
          resumed: input.sessionId !== undefined,
        }),
      );
      await entry.value.session.prompt(prompt);
    } catch (error) {
      if (aborted || signal.aborted) {
        this.options.log.info("ask cancelled", { sessionId: entry.id });
        return { text, turns, aborted: true, durationMs: Date.now() - startedAt };
      }
      throw error;
    } finally {
      signal.removeEventListener("abort", onAbort);
      unsubscribe();
      this.sessions.markBusy(entry.id, false);
    }

    return { text, turns, aborted, durationMs: Date.now() - startedAt };
  }

  async dispose(): Promise<void> {
    await this.sessions.disposeAll();
  }

  private async getOrCreateEntry(sessionId: string | undefined, cwd: string): Promise<SessionEntry<SessionValue>> {
    if (sessionId !== undefined) {
      const existing = this.sessions.get(sessionId);
      if (existing === undefined) {
        throw new BackendError(
          "INVALID_ARGUMENT",
          `unknown session "${sessionId}"; omit session_id to start a new one`,
        );
      }
      return existing;
    }

    const model = await this.resolveModel();
    const { session } = await createAgentSession({
      cwd,
      agentDir: this.options.agentDir,
      modelRuntime: await this.ensureRuntime(),
      model,
      thinkingLevel: this.thinkingLevel,
      sessionManager: SessionManager.create(cwd),
      ...this.toolOptions(),
    });

    const id = session.sessionId;
    this.options.log.info("session created", { sessionId: id, cwd, model: model.id });
    return this.sessions.add(id, { session, model, cwd }, () => session.dispose());
  }

  /**
   * An empty tool list switches to noTools, because passing `tools: []` would
   * enable nothing but still leave the built-in default set reachable through
   * the allowlist. noTools is only consulted when `tools` is absent.
   */
  private toolOptions(): { noTools?: "all"; tools?: string[] } {
    return this.options.tools.length === 0 ? { noTools: "all" } : { tools: this.options.tools };
  }

  private ensureRuntime(): Promise<ModelRuntime> {
    this.runtimePromise ??= this.createRuntime();
    return this.runtimePromise;
  }

  private async createRuntime(): Promise<ModelRuntime> {
    const runtime = await ModelRuntime.create({
      authPath: join(this.options.agentDir, "auth.json"),
      modelsPath: join(this.options.agentDir, "models.json"),
    });
    if (this.options.apiKey !== undefined) {
      await runtime.setRuntimeApiKey(this.options.provider, this.options.apiKey);
    }
    this.options.log.info("model runtime ready", {
      agentDir: this.options.agentDir,
      provider: this.options.provider,
    });
    return runtime;
  }

  private async resolveModel(): Promise<PiModel> {
    if (this.model !== undefined) return this.model;
    const runtime = await this.ensureRuntime();

    if (this.options.model !== undefined) {
      const resolved = resolveCliModel({ cliModel: this.options.model, modelRuntime: runtime });
      if (resolved.model === undefined) {
        throw new BackendError(
          "MODEL_NOT_FOUND",
          resolved.error ?? `model "${this.options.model}" could not be resolved`,
        );
      }
      if (resolved.warning !== undefined) {
        this.options.log.warn("model resolution warning", { warning: resolved.warning });
      }
      this.model = resolved.model;
      this.thinkingLevel = resolved.thinkingLevel;
      return resolved.model;
    }

    const available = await runtime.getAvailable();
    const first = available[0];
    if (first === undefined) {
      throw new BackendError(
        "NO_CREDENTIALS",
        `no authenticated model for provider "${this.options.provider}"; put ANTHROPIC_AUTH_TOKEN (or ANTHROPIC_API_KEY / PIWORK_API_KEY) in demo/.env`,
      );
    }
    this.model = first;
    return first;
  }
}
