import type { SessionManager } from "@earendil-works/pi-coding-agent";

/** Synthetic SDK fixture shared by history unit and wire/integration tests.
 * No model is called and every tool result is generated locally. */
export function populateLongHistory(sdk: SessionManager, runId: string, largeAnswerBytes = 0) {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  sdk.appendCustomEntry("piwork-run", { runId });
  sdk.appendMessage({ role: "user", content: "Synthetic long conversation", timestamp: 1 });
  let calls = 0;
  for (let turn = 0; turn < 217; turn++) {
    const ids = Array.from({ length: turn < 18 ? 2 : 1 }, () => `synthetic-call-${++calls}`);
    sdk.appendMessage({ role: "assistant", content: [{ type: "text", text: `Synthetic step ${turn}` }, ...ids.map(id => ({ type: "toolCall" as const, id, name: "read", arguments: { path: "synthetic.txt" } }))], api: "openai-completions", provider: "fixture", model: "deterministic", usage, stopReason: "toolUse", timestamp: turn + 2 });
    for (const id of ids) sdk.appendMessage({ role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text: `Synthetic result ${id}\n` + "汉<&>\n".repeat(id.endsWith("235") ? 13000 : 5000) }], isError: false, timestamp: turn + 2 });
  }
  const finalText = largeAnswerBytes ? "a".repeat(largeAnswerBytes) : "Synthetic final answer";
  sdk.appendMessage({ role: "assistant", content: [{ type: "text", text: finalText }], api: "openai-completions", provider: "fixture", model: "deterministic", usage, stopReason: "stop", timestamp: 999 });
  return { messages: 454, calls, finalText };
}
