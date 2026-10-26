import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { RunExecutionContext } from "./runs.js";

type ProviderErrorCode = "MODEL_AUTHENTICATION_FAILED" | "MODEL_PERMISSION_DENIED";

/** These messages are authored locally; provider responses are untrusted. */
export class ModelProviderError extends Error {
  readonly retryable = false;
  constructor(readonly providerErrorCode: ProviderErrorCode, invalidKey = false) {
    super(providerErrorCode === "MODEL_AUTHENTICATION_FAILED"
      ? invalidKey ? "The model API Key is invalid. Check it or ask your administrator to update it."
        : "Model authentication failed. Check the API Key or ask your administrator to update it."
      : "The model provider denied access. Check the model's permissions or ask your administrator.");
    this.name = "ModelProviderError";
  }
}

type StreamFunction = import("@earendil-works/pi-coding-agent").AgentSession["agent"]["streamFunction"];

/** Read only a bounded error envelope; never retain or publish its contents. */
async function knownProviderCode(response: Response): Promise<string | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async () => {
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (bytes <= 16 * 1024) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 16 * 1024) return undefined;
      chunks.push(part.value);
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { error?: { code?: unknown; type?: unknown } };
      return [value.error?.code, value.error?.type].find(code => code === "invalid_api_key" || code === "insufficient_quota") as string | undefined;
    } catch { return undefined; }
  };
  try {
    return await Promise.race([read(), new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 1_000); })]);
  } catch { return undefined; }
  finally { if (timer) clearTimeout(timer); void reader.cancel().catch(() => undefined); }
}

/**
 * Scope provider status to one SDK stream. Do not wrap global fetch: tool calls,
 * other Runs and unrelated network activity must never become model failures.
 */
export function protectProviderStream(original: StreamFunction, accepted: RunExecutionContext["actualModel"]) {
  let failure: ModelProviderError | undefined;
  const streamFunction: StreamFunction = async (model, context, options) => {
    failure = undefined;
    const selected = (model.api === "anthropic-messages" || model.api === "openai-responses") &&
      (!accepted || model.provider === accepted.provider && model.id === accepted.model &&
        (!accepted.baseUrl || model.baseUrl === accepted.baseUrl));
    if (!selected) return original(model, context, options);
    let status: number | undefined;
    let providerCode: string | undefined;
    let networkFailure = false;
    const fetchProvider: typeof globalThis.fetch = async (input, init) => {
      try {
        const response = await (options?.fetch ?? globalThis.fetch)(input, init);
        status = response.status;
        networkFailure = false;
        providerCode = undefined;
        if (response.ok) return response;
        // SDKs can persist error.message into Session history. Replace the
        // untrusted provider body and headers before the SDK can consume it.
        if (status === 401 || status === 429) providerCode = await knownProviderCode(response);
        else void response.body?.cancel().catch(() => undefined);
        const headers = new Headers({ "content-type": "application/json" });
        for (const name of ["retry-after", "retry-after-ms"]) {
          const value = response.headers.get(name);
          if (value && /^\d{1,8}(?:\.\d{1,3})?$/.test(value)) headers.set(name, value);
        }
        const type = status === 401 ? "authentication_error" : status === 403 ? "permission_error" : "api_error";
        return new Response(JSON.stringify({ error: { type, message: "The model provider rejected the request." } }), {
          status: response.status, headers,
        });
      } catch {
        status = undefined;
        providerCode = undefined;
        networkFailure = true;
        throw new Error("The model provider request could not be completed.");
      }
    };
    const upstream = await original(model as Model<Api>, context, selected ? { ...options, fetch: fetchProvider } : options);
    const safe = createAssistantMessageEventStream();
    void (async () => {
      let terminal = false;
      try {
        for await (const event of upstream) {
          if (event.type === "error") {
            terminal = true;
            if (selected && !options?.signal?.aborted) {
              if (status === 401) failure = new ModelProviderError("MODEL_AUTHENTICATION_FAILED", providerCode === "invalid_api_key");
              else if (status === 403) failure = new ModelProviderError("MODEL_PERMISSION_DENIED");
            }
            // Even unknown SDK errors may include provider text, a Key or a
            // local path. Preserve only known retry signals before persistence.
            const safeMessage = failure?.message ?? (providerCode === "insufficient_quota"
              ? "Model provider quota exceeded." : status === 429 ? "Model provider rate limit (429)."
              : status && [500, 502, 503, 504, 520, 524].includes(status) ? `Model provider server error (${status}).`
              : networkFailure ? "Model provider connection error." : "Model execution failed.");
            safe.push({ ...event, error: { ...event.error, errorMessage: safeMessage } });
          } else {
            if (event.type === "done") terminal = true;
            safe.push(event);
          }
        }
      } catch {
        // A broken stream must not leak the exception or leave the consumer
        // waiting forever for a terminal message.
      } finally {
        if (!terminal) {
          const reason = options?.signal?.aborted ? "aborted" : "error";
          safe.push({ type: "error", reason, error: {
            role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: reason, errorMessage: "Model execution failed.", timestamp: Date.now(),
          } });
        }
        safe.end();
      }
    })();
    return safe;
  };
  return { streamFunction, failure: () => failure };
}
