import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

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

    const systemPrompt = context.messages
      .filter((message) => message.role === "system")
      .flatMap((message) => message.role === "system"
        ? [typeof message.content === "string" ? message.content : message.content.map((part) => part.text).join(""), ...Object.values(message.sections ?? {}).filter((section): section is string => typeof section === "string")]
        : [])
      .join("\n");
    const manifestPath = decodeXml(systemPrompt.match(/<location>([^<]*\/SKILL\.md)<\/location>/)?.[1] ?? "");
    const toolResults = context.messages.slice(latestUserIndex + 1).filter((message) => message.role === "toolResult");
    if (toolResults.length === 0 && manifestPath !== "") {
      emitToolCall(stream, output, "fixture-read-manifest", manifestPath);
      return;
    }
    if (toolResults.length === 1 && manifestPath !== "") {
      const manifest = toolResultText(toolResults[0]!);
      const reference = manifest.match(/(?:supporting file|support)\s*:\s*([a-zA-Z0-9._/-]+)/i)?.[1]
        ?? manifest.match(/\[[^\]]+\]\(([^)]+)\)/)?.[1];
      if (reference === undefined || reference.startsWith("/") || reference.includes("..")) throw new Error("deterministic Skill fixture has no safe supporting-file reference");
      emitToolCall(stream, output, "fixture-read-support", resolve(dirname(manifestPath), reference));
      return;
    }

    const text = manifestPath === "" ? "skill-read:none" : `skill-read:${createHash("sha256")
      .update(toolResultText(toolResults[0]!)).update("\0").update(toolResultText(toolResults[1]!)).digest("hex").slice(0, 16)}`;
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

function emitToolCall(stream: AssistantMessageEventStream, output: AssistantMessage, id: string, path: string): void {
  const toolCall = { type: "toolCall" as const, id, name: "read", arguments: { path } };
  output.content.push(toolCall);
  stream.push({ type: "toolcall_start", contentIndex: 0, partial: output });
  stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: output });
  output.stopReason = "toolUse";
  stream.push({ type: "done", reason: "toolUse", message: output });
  stream.end();
}

function toolResultText(message: TranscriptContext["messages"][number]): string {
  return message.role === "toolResult" ? message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("") : "";
}

function decodeXml(value: string): string {
  return value.replace(/&apos;/g, "'").replace(/&quot;/g, "\"").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
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
