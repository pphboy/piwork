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

test('Chat recovery projections distinguish empty authorization from unconfirmed capabilities without private fields',()=>{
  const empty={contractVersion:2,models:[],defaultModel:null,defaultUnavailableReason:'Enable a model in AI models.',checkedAt,availability:'available'};
  assert.equal(Check(ChatModelListSchema,empty),true);
  const unavailable={modelRef:'model-unconfirmed-0001',label:'Provider / Unknown',provider:'openai',model:'unknown',reason:'capabilities-unconfirmed',recovery:'Configure a model definition in AI models.'};
  assert.equal(Check(ChatModelListSchema,{...empty,unavailableModels:[unavailable]}),true);
  assert.equal(Check(ChatModelListSchema,{...empty,unavailableModels:[{...unavailable,reason:'sdk-unsupported'}]}),true);
  for(const extra of [{baseUrl:'https://private.invalid'},{credential:'synthetic-key'},{executionBindingId:'model-execution-private1'},{reason:'other'}]){
    assert.equal(Check(ChatModelListSchema,{...empty,unavailableModels:[{...unavailable,...extra}]}),false);
  }
  assert.equal(Check(ChatModelListSchema,{contractVersion:1,models:[],defaultModel:model,checkedAt,availability:'available',unavailableModels:[unavailable]}),false);
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

test('version 3 unknown Thinking admits only explicit ordinary null without relaxing legacy catalogs',()=>{
 const unknown={...model,thinkingLevels:[],defaultThinkingLevel:null,thinkingAvailability:'unknown'};
 for(const version of [1,2,3])assert.equal(Check(ChatModelListSchema,{contractVersion:version,models:[unknown],defaultModel:unknown,checkedAt,availability:'available'}),version===3);
 assert.equal(Check(SetSessionChatOptionsSchema,{modelRef:null,thinkingLevel:null}),true);
 for(const extra of [{thinkingAvailability:'unsupported'},{defaultThinkingLevel:'off'},{thinkingLevels:['off']},{credential:'synthetic-private'}])assert.equal(Check(ChatModelListSchema,{contractVersion:3,models:[{...unknown,...extra}],defaultModel:unknown,checkedAt,availability:'available'}),false);
});
