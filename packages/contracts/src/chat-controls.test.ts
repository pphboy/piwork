import assert from "node:assert/strict";
import test from "node:test";
import { Check } from "typebox/value";
import {
  ChatCapabilitiesSchema, ChatModelListSchema, ChatSubmissionLookupSchema, RunSubmissionSelectorSchema,
  SetSessionChatOptionsSchema, SlashCommandListSchema, ToolResultPreviewSchema, RunModelSelectorSchema,
} from "./index.js";

const model = { modelRef: null, label: "Default", provider: "fixture", model: "one", thinkingLevels: ["off"], defaultThinkingLevel: "off" };
const checkedAt = "2026-10-05T00:00:00Z";

test("chat discovery distinguishes optional capability, default-only and an empty command directory", () => {
  assert.equal(Check(ChatCapabilitiesSchema, { contractVersion: 0 }), true);
  assert.equal(Check(ChatCapabilitiesSchema, { contractVersion: 1 }), true);
  assert.equal(Check(ChatCapabilitiesSchema, {}), false);
  assert.equal(Check(ChatModelListSchema, { contractVersion: 1, models: [], defaultModel: model, checkedAt, availability: "available" }), true);
  assert.equal(Check(SlashCommandListSchema, { contractVersion: 1, commands: [], checkedAt }), true);
  for (const extra of [{ path: "/private" }, { credential: "secret" }]) {
    assert.equal(Check(ChatModelListSchema, { contractVersion: 1, models: [], defaultModel: { ...model, ...extra }, checkedAt, availability: "available" }), false);
  }
  assert.equal(Check(ChatModelListSchema, { contractVersion: 1, models: [], defaultModel: { ...model, thinkingLevels: ["off", "off"] }, checkedAt, availability: "available" }), false);
});

test("chat settings require one complete pair and reject unknown fields and levels", () => {
  for (const thinkingLevel of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
    assert.equal(Check(SetSessionChatOptionsSchema, { modelRef: null, thinkingLevel }), true);
  }
  for (const invalid of [{}, { modelRef: null }, { thinkingLevel: "off" }, { modelRef: null, thinkingLevel: "unlimited" }, { modelRef: null, thinkingLevel: "off", token: "secret" }]) {
    assert.equal(Check(SetSessionChatOptionsSchema, invalid), false);
  }
});

test("new selectors retain legacy absence without relaxing the legacy model contract", () => {
  assert.equal(Check(RunSubmissionSelectorSchema, { kind: "session-preference" }), true);
  assert.equal(Check(RunSubmissionSelectorSchema, { kind: "session-preference", inputMode: "text" }), true);
  assert.equal(Check(RunSubmissionSelectorSchema, { kind: "work-default", inputMode: "command" }), true);
  assert.equal(Check(RunSubmissionSelectorSchema, { kind: "work-default", inputMode: "terminal" }), false);
  assert.equal(Check(RunModelSelectorSchema, { kind: "work-default", inputMode: "text" }), false);
});

test("submission lookup and tool previews do not admit invented acceptance or private metadata", () => {
  assert.equal(Check(ChatSubmissionLookupSchema, { kind: "session", key: "key-1", status: "not-found" }), true);
  assert.equal(Check(ChatSubmissionLookupSchema, { kind: "run", key: "key-1", status: "accepted" }), false);
  assert.equal(Check(ChatSubmissionLookupSchema, { kind: "run", key: "key-1", status: "not-found", prompt: "private" }), false);
  assert.equal(Check(ToolResultPreviewSchema, { kind: "text", text: "result", truncated: false, isError: false }), true);
  assert.equal(Check(ToolResultPreviewSchema, { kind: "unavailable", truncated: false, isError: false }), true);
  assert.equal(Check(ToolResultPreviewSchema, { kind: "text", text: "x".repeat(65537), truncated: true, isError: false }), false);
  assert.equal(Check(ToolResultPreviewSchema, { kind: "text", text: "result", args: { token: "secret" }, truncated: false, isError: false }), false);
});
