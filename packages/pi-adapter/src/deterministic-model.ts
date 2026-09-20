import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const PROVIDER_ID = "piwork-deterministic";
const MODEL_ID = "fixture-v1";

export async function createDeterministicRuntime(): Promise<{
  readonly runtime: ModelRuntime;
  readonly model: Model<any>;
}> {
  const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
  runtime.registerProvider(PROVIDER_ID, {
    name: "piwork deterministic fixture",
    baseUrl: "http://fixture.invalid",
    apiKey: "fixture-key",
    api: "openai-completions",
    streamSimple: streamDeterministic,
    models: [
      {
        id: MODEL_ID,
        name: "piwork deterministic fixture",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 16_384,
        maxTokens: 1_024,
      },
    ],
  });
  const model = runtime.getModel(PROVIDER_ID, MODEL_ID);
  if (model === undefined) throw new Error("deterministic model registration failed");
  return { runtime, model };
}

function streamDeterministic(
  model: Model<any>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const output = emptyMessage(model);

  void (async () => {
    stream.push({ type: "start", partial: output });
    const latestUserIndex = context.messages.findLastIndex((message) => message.role === "user");
    const latestUser = context.messages[latestUserIndex];
    const prompt = latestUser?.role === "user"
      ? typeof latestUser.content === "string"
        ? latestUser.content
        : latestUser.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("")
      : "";

    if (prompt.includes("wait for abort")) {
      await waitForAbort(options?.signal);
      output.stopReason = "aborted";
      output.errorMessage = "deterministic execution aborted";
      stream.push({ type: "error", reason: "aborted", error: output });
      stream.end();
      return;
    }

    const hasToolResult = context.messages.slice(latestUserIndex + 1).some((message) => message.role === "toolResult");
    if (!hasToolResult) {
      const toolCall = {
        type: "toolCall" as const,
        id: "fixture-call-1",
        name: "fixture_echo",
        arguments: { text: "sdk-smoke" },
      };
      output.content.push(toolCall);
      stream.push({ type: "toolcall_start", contentIndex: 0, partial: output });
      stream.push({
        type: "toolcall_end",
        contentIndex: 0,
        toolCall,
        partial: output,
      });
      output.stopReason = "toolUse";
      stream.push({ type: "done", reason: "toolUse", message: output });
      stream.end();
      return;
    }

    const text = "fixture tool completed";
    output.content.push({ type: "text", text });
    stream.push({ type: "text_start", contentIndex: 0, partial: output });
    stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: output });
    stream.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
    output.stopReason = "stop";
    stream.push({ type: "done", reason: "stop", message: output });
    stream.end();
  })().catch((error: unknown) => {
    output.stopReason = options?.signal?.aborted ? "aborted" : "error";
    output.errorMessage = error instanceof Error ? error.message : String(error);
    stream.push({ type: "error", reason: output.stopReason, error: output });
    stream.end();
  });

  return stream;
}

function emptyMessage(model: Model<any>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "pending",
    timestamp: Date.now(),
  };
}

async function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted === true) return;
  if (signal === undefined) throw new Error("deterministic wait requires an AbortSignal");
  await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}
