import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AskEvent, AskResult, SessionStarted } from "../generated/piwork.js";

/**
 * pi emits a much wider event set than the CLI consumes. This mapping is the
 * single place deciding what crosses the gRPC boundary, which keeps the wire
 * format stable when pi adds new events.
 */
export interface PiEventMapping {
  /** Event to forward to the client. */
  emit?: AskEvent;
  /** Assistant text carried by this event, accumulated into AskResult.text. */
  textDelta?: string;
  /** True when one LLM turn finished, counted into AskResult.turns. */
  turnEnded?: boolean;
}

export function mapPiEvent(event: AgentSessionEvent): PiEventMapping {
  switch (event.type) {
    case "message_update": {
      const inner = event.assistantMessageEvent;
      if (inner.type === "text_delta") {
        return { emit: textDeltaEvent(inner.delta), textDelta: inner.delta };
      }
      if (inner.type === "thinking_delta") {
        return { emit: { thinkingDelta: { delta: inner.delta } } };
      }
      return {};
    }
    case "tool_execution_start":
      return { emit: { toolStart: { toolName: event.toolName, toolCallId: event.toolCallId } } };
    case "tool_execution_end":
      return {
        emit: { toolEnd: { toolName: event.toolName, toolCallId: event.toolCallId, isError: event.isError } },
      };
    case "turn_end":
      return { turnEnded: true };
    default:
      return {};
  }
}

// The generated oneof is a set of optional fields, so every factory below sets
// exactly one of them: a protobuf oneof carries a single member on the wire.

export function sessionStartedEvent(started: SessionStarted): AskEvent {
  return { sessionStarted: started };
}

export function textDeltaEvent(delta: string): AskEvent {
  return { textDelta: { delta } };
}

export function resultEvent(result: AskResult): AskEvent {
  return { result };
}

export function errorEvent(code: string, message: string): AskEvent {
  return { error: { code, message } };
}
