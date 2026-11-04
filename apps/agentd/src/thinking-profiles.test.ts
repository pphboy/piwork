import assert from "node:assert/strict";
import test from "node:test";
import { compatibleThinkingProfiles, THINKING_PROFILES, validThinkingSelection, thinkingLevelsForSelection } from "./thinking-profiles.js";

test("compatible profiles are bounded by protocol and explicitly selected", () => {
  assert.deepEqual(compatibleThinkingProfiles("openai-responses").map(p => p.profile), ["responses-effort-v1"]);
  assert.deepEqual(compatibleThinkingProfiles("anthropic-messages").map(p => p.profile), ["messages-adaptive-v1", "messages-budget-v1"]);
  assert.equal(validThinkingSelection("openai-responses", [], null), true);
  assert.equal(validThinkingSelection("openai-responses", [], "high"), false);
  assert.equal(validThinkingSelection("openai-responses", [], "high", "responses-effort-v1"), true);
  assert.equal(validThinkingSelection("anthropic-messages", [], "high", "responses-effort-v1"), false);
  assert.equal(validThinkingSelection("anthropic-messages", [], "max", "messages-budget-v1"), false);
  assert.equal(validThinkingSelection("anthropic-messages", [], "max", "messages-adaptive-v1"), true);
  assert.equal(validThinkingSelection("openai-responses", ["off", "high"], "high"), true);
  assert.equal(validThinkingSelection("openai-responses", ["off", "high"], "high", "responses-effort-v1"), true);
  assert.equal(validThinkingSelection("openai-responses", ["off"], "max", "responses-effort-v1"), true);
  const budgets = Object.values(THINKING_PROFILES["messages-budget-v1"].budgets);
  assert.equal(new Set(budgets).size, budgets.length);
  assert.ok(budgets.every(n => n + 1024 <= 8192));
});

test("compatible selections never query SDK model levels", async () => {
  const model = {modelRef:null,label:'Known',provider:'openai',model:'gpt-4.1-mini'};
  const models = {async thinking():Promise<{thinkingLevels:('off'|'high')[]}> {throw new Error('SDK metadata unavailable');}};
  assert.deepEqual(await thinkingLevelsForSelection(models,model,'responses-effort-v1'),[]);
  assert.equal(validThinkingSelection('openai-responses',await thinkingLevelsForSelection(models,model,'responses-effort-v1'),'max','responses-effort-v1'),true);
  await assert.rejects(thinkingLevelsForSelection(models,model),/SDK metadata/);
});
