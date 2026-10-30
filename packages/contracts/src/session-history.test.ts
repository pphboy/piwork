import assert from "node:assert/strict";
import test from "node:test";
import { Check } from "typebox/value";
import { ReadSessionPageRequest, SessionHistoryPage, SubmitRunRequest, TextEvent } from "./agent.js";
import { HISTORY_LIMITS, historyCapabilities, HistoryCapabilitiesSchema, HistoryQuerySchema, HistorySegmentSchema, historyJSON } from "./session-history.js";

test("provider tool call IDs are bounded opaque values, separate from internal identifiers", () => {
  const segment = { entryId: "entry-1", entryOrder: 0, role: "assistant", runId: "run-1", blockId: "entry-1-0", blockIndex: 0, blockCount: 1,
    type: "tool-call", byteOffset: 0, totalBytes: 0, complete: true, text: "", toolName: "read" };
  for (const toolCallId of ["call_abc|fc_def", "provider/call+opaque=", "x".repeat(1024)]) {
    assert.equal(Check(HistorySegmentSchema, { ...segment, toolCallId }), true);
  }
  for (const toolCallId of ["", "x".repeat(1025), 123]) assert.equal(Check(HistorySegmentSchema, { ...segment, toolCallId }), false);
  for (const field of ["entryId", "blockId"]) assert.equal(Check(HistorySegmentSchema, { ...segment, [field]: "internal|invalid" }), false);
});

test("independent history capability, strict ranges and budgets", () => {
  assert.equal(Check(HistoryCapabilitiesSchema, historyCapabilities()), true);
  for (const value of [{}, { direction: "newer", content: "runs", limit: 100 }, { cursor: "opaque", runId: "run-1" }]) assert.equal(Check(HistoryQuerySchema, value), true);
  for (const value of [{ limit: 0 }, { limit: 101 }, { cursor: "" }, { path: "/private" }, { direction: "sideways" }]) assert.equal(Check(HistoryQuerySchema, value), false);
  assert.equal(HISTORY_LIMITS.pageBytes, 524288);
  assert.equal(historyJSON({ text: "<>&\u2028\u2029汉\u0000" }), '{"text":"\\u003c\\u003e\\u0026\\u2028\\u2029汉\\u0000"}\n');
});

test("paged JSON and response profiles are additive binary fields", () => {
  const query = ReadSessionPageRequest.create({ workId: "work-1", sessionId: "session-1", queryJson: '{"limit":50}' });
  assert.deepEqual(ReadSessionPageRequest.decode(ReadSessionPageRequest.encode(query).finish()), query);
  const page = SessionHistoryPage.create({ pageJson: historyJSON({ text: "汉".repeat(10000) }) });
  assert.deepEqual(SessionHistoryPage.decode(SessionHistoryPage.encode(page).finish()), page);
  const legacy = SubmitRunRequest.create({ workId: "work-1" });
  assert.equal(SubmitRunRequest.decode(SubmitRunRequest.encode(legacy).finish()).responseProfile, undefined);
  const modern = SubmitRunRequest.create({ ...legacy, responseProfile: "history-v1" });
  assert.equal(SubmitRunRequest.decode(SubmitRunRequest.encode(modern).finish()).responseProfile, "history-v1");
  const fragment = TextEvent.create({ delta: "汉", byteOffset: 32766n, totalBytes: 65538n, complete: false });
  assert.deepEqual(TextEvent.decode(TextEvent.encode(fragment).finish()), fragment);
});
