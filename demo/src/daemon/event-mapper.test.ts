import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { mapPiEvent } from "./event-mapper.js";

/** The mapper reads only a few fields, so tests build the minimum payload. */
function piEvent(value: Record<string, unknown>): AgentSessionEvent {
  return value as unknown as AgentSessionEvent;
}

describe("mapPiEvent", () => {
  it("forwards assistant text deltas and reports them for accumulation", () => {
    const mapping = mapPiEvent(
      piEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } }),
    );
    assert.deepEqual(mapping.emit, { textDelta: { delta: "hello" } });
    assert.equal(mapping.textDelta, "hello");
  });

  it("forwards thinking deltas without accumulating them into the answer", () => {
    const mapping = mapPiEvent(
      piEvent({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "hmm" } }),
    );
    assert.deepEqual(mapping.emit, { thinkingDelta: { delta: "hmm" } });
    assert.equal(mapping.textDelta, undefined);
  });

  it("ignores non-delta message updates", () => {
    const mapping = mapPiEvent(
      piEvent({ type: "message_update", assistantMessageEvent: { type: "text_start" } }),
    );
    assert.deepEqual(mapping, {});
  });

  it("maps tool lifecycle events", () => {
    const start = mapPiEvent(piEvent({ type: "tool_execution_start", toolName: "read", toolCallId: "t1" }));
    assert.deepEqual(start.emit, { toolStart: { toolName: "read", toolCallId: "t1" } });

    const end = mapPiEvent(
      piEvent({ type: "tool_execution_end", toolName: "read", toolCallId: "t1", isError: true }),
    );
    assert.deepEqual(end.emit, { toolEnd: { toolName: "read", toolCallId: "t1", isError: true } });
  });

  it("counts turns without emitting an event", () => {
    const mapping = mapPiEvent(piEvent({ type: "turn_end" }));
    assert.equal(mapping.turnEnded, true);
    assert.equal(mapping.emit, undefined);
  });

  it("ignores unrelated agent lifecycle events", () => {
    for (const type of ["agent_start", "turn_start", "message_start", "queue_update", "compaction_start"]) {
      assert.deepEqual(mapPiEvent(piEvent({ type })), {}, `expected ${type} to be ignored`);
    }
  });
});
