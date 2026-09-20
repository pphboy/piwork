import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { mapSdkEvent } from "./event-mapper.js";

const event = (value: Record<string, unknown>) => value as unknown as AgentSessionEvent;

test("maps stable text, thinking, tool, and turn events while ignoring SDK lifecycle noise", () => {
  assert.deepEqual(mapSdkEvent(event({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } })), {
    type: "text-delta", payload: { delta: "hello" },
  });
  assert.deepEqual(mapSdkEvent(event({ type: "tool_execution_end", toolName: "read", toolCallId: "call-1", isError: false })), {
    type: "tool-end", payload: { toolName: "read", toolCallId: "call-1", isError: false },
  });
  assert.equal(mapSdkEvent(event({ type: "agent_start" })), undefined);
});
