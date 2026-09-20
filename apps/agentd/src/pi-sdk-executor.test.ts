import assert from "node:assert/strict";
import test from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { resolveProductionModel } from "./pi-sdk-executor.js";

test("registers an Anthropic-compatible custom model at the configured endpoint", async () => {
  const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
  const model = resolveProductionModel(runtime, {
    provider: "anthropic",
    id: "deepseek-flash",
    baseUrl: "https://api.deepseek.com/anthropic",
  });

  assert.equal(model.provider, "anthropic");
  assert.equal(model.id, "deepseek-flash");
  assert.equal(model.api, "anthropic-messages");
  assert.equal(model.baseUrl, "https://api.deepseek.com/anthropic");
});

test("keeps a built-in model while overriding its endpoint", async () => {
  const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
  const model = resolveProductionModel(runtime, {
    provider: "anthropic",
    id: "claude-sonnet-4-5",
    baseUrl: "https://proxy.example.test/anthropic",
  });

  assert.equal(model.id, "claude-sonnet-4-5");
  assert.equal(model.baseUrl, "https://proxy.example.test/anthropic");
});

test("rejects an unknown model without an Anthropic-compatible endpoint", async () => {
  const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
  assert.throws(
    () => resolveProductionModel(runtime, { provider: "anthropic", id: "unknown-custom-model" }),
    /configured model is not available/,
  );
});
