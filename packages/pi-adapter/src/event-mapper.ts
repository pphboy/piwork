import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export interface PiworkAgentEvent {
  readonly type: "text-delta" | "thinking-delta" | "tool-start" | "tool-end" | "turn-end";
  readonly payload: Readonly<Record<string, string | boolean>>;
}

export function mapSdkEvent(event: AgentSessionEvent): PiworkAgentEvent | undefined {
  if (event.type === "message_update") {
    const inner = event.assistantMessageEvent;
    if (inner.type === "text_delta") return { type: "text-delta", payload: { delta: inner.delta } };
    if (inner.type === "thinking_delta") return { type: "thinking-delta", payload: { delta: inner.delta } };
    return undefined;
  }
  if (event.type === "tool_execution_start") {
    return { type: "tool-start", payload: { toolName: event.toolName, toolCallId: event.toolCallId } };
  }
  if (event.type === "tool_execution_end") {
    return { type: "tool-end", payload: { toolName: event.toolName, toolCallId: event.toolCallId, isError: event.isError } };
  }
  if (event.type === "turn_end") return { type: "turn-end", payload: {} };
  return undefined;
}
