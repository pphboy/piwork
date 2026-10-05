import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentRunModels, RunModelError } from "./run-models.js";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@piwork/pi-adapter";

test("model discovery filters with the actual SDK and never exposes endpoint or credential", async () => {
  const selected = { modelRef: "catalog-model-0001", label: "Claude", provider: "anthropic", model: "custom-claude", baseUrl: "https://fixture.example.test/anthropic" };
  const defaultModel = { ...selected, modelRef: null };
  const models = new AgentRunModels({ provider: "anthropic", id: "custom-claude", baseUrl: selected.baseUrl, deterministic: false }, {
    async models() { return { models: [selected, { ...selected, modelRef: "catalog-model-0002", provider: "unsupported-provider", model: "unknown" }], defaultModel, checkedAt: "2026-10-03T00:00:00Z" }; },
    async resolveModel() { return { model: selected, credential: "secret-only-in-private-channel" }; },
  });
  const listed = await models.list();
  assert.equal(listed.models.length, 1); assert.equal(listed.models[0]?.model, "custom-claude");
  assert.doesNotMatch(JSON.stringify(listed), /baseUrl|credential|secret-only/);
  const resolved = await models.resolve(selected.modelRef);
  assert.equal(await models.credential(resolved), "secret-only-in-private-channel");
  assert.doesNotMatch(JSON.stringify(resolved), /secret-only/);
});

test("model list failure is unavailable and explicit unsupported selection has no default fallback", async () => {
  const invalid = { modelRef: "catalog-model-0002", label: "Unsupported", provider: "unsupported", model: "unknown" };
  const models = new AgentRunModels({ provider: "piwork-deterministic", id: "fixture-v1", deterministic: true }, {
    async models() { throw new Error("credential=secret /private/core"); }, async resolveModel() { return { model: invalid, credential: "secret" }; },
  });
  await assert.rejects(models.list(), (e: unknown) => e instanceof RunModelError && e.modelErrorCode === "MODEL_LIST_UNAVAILABLE" && !e.message.includes("secret"));
  await assert.rejects(models.resolve(invalid.modelRef), (e: unknown) => e instanceof RunModelError && e.modelErrorCode === "MODEL_NOT_SUPPORTED");
  const standalone = new AgentRunModels({ provider: "piwork-deterministic", id: "fixture-v1", deterministic: true });
  await assert.rejects(standalone.resolve(invalid.modelRef), (e: unknown) => e instanceof RunModelError && e.modelErrorCode === "RUN_MODEL_SELECTION_UNSUPPORTED");
});

test("Work default credentials reject absent and symlink files without disclosing host paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-model-secret-")); try {
    const key = join(root, "key"); await writeFile(key, "fixture-private-key\n"); await symlink(key, join(root, "link"));
    const config = { provider: "anthropic", id: "custom-model", baseUrl: "http://127.0.0.1:8080", deterministic: false };
    const models = new AgentRunModels({ ...config, credentialPath: key }); const model = await models.resolve(null);
    assert.equal(await models.credential(model), "fixture-private-key");
    await assert.rejects(new AgentRunModels({ ...config, credentialPath: join(root, "link") }).resolve(null), RunModelError);
    await rm(key);
    await assert.rejects(models.credential(model), (e: unknown) => e instanceof RunModelError && e.modelErrorCode === "MODEL_UNAVAILABLE" && !e.message.includes(root));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an available empty selection list differs from failure and Work default resolves through current control", async () => {
  const defaultModel = { modelRef: null, label: "Default", provider: "piwork-deterministic", model: "fixture-v1" };
  let available = true;
  const models = new AgentRunModels({ provider: defaultModel.provider, id: defaultModel.model, deterministic: true }, {
    async models() { return { models: [], defaultModel, checkedAt: "2026-10-03T00:00:00Z" }; },
    async resolveModel(ref) { if (!available || ref !== null) throw new Error("private-token /tmp/private"); return { model: defaultModel, credential: "private-key" }; },
  });
  assert.deepEqual((await models.list()).models, []);
  const model = await models.resolve(null); assert.equal(await models.credential(model), "private-key");
  available = false;
  await assert.rejects(models.resolve(null), RunModelError);
  await assert.rejects(models.credential(model), (error: unknown) => error instanceof RunModelError && !error.message.includes("private-token"));
});

test('chat capabilities use actual SDK levels and preserve an available default-only catalog',async()=>{
 const models=new AgentRunModels({provider:'piwork-deterministic',id:'fixture-v1',deterministic:true});
 const value=await models.chatList();assert.equal(value.contractVersion,1);assert.deepEqual(value.models,[]);assert.deepEqual(value.defaultModel.thinkingLevels,['off']);
 assert.equal(value.defaultModel.defaultThinkingLevel,'off');
 const plain=await models.thinking({modelRef:null,label:'plain',provider:'openai',model:'gpt-4.1-mini'});assert.deepEqual(plain.thinkingLevels,['off']);
 const reasoning=await models.thinking({modelRef:null,label:'reasoning',provider:'anthropic',model:'claude-sonnet-4-5'});assert.ok(reasoning.thinkingLevels.includes('high'));assert.ok(reasoning.thinkingLevels.includes(reasoning.defaultThinkingLevel));
 await assert.rejects(models.thinking({modelRef:null,label:'invalid',provider:'unknown',model:'unknown'}),error=>error instanceof RunModelError && !error.message.includes('/'));
});

test("chat catalog intersects Core authorization with fixed SDK capability evidence", async () => {
  const known = { modelRef: null, label: "Work model", provider: "anthropic", model: "deepseek-flash", baseUrl: "https://api.deepseek.com/anthropic" };
  const custom = { ...known, modelRef: "catalog-custom", model: "custom-unknown" };
  let candidates = [custom, { ...known, modelRef: "catalog-known" }];
  const models = new AgentRunModels({ provider: known.provider, id: known.model, baseUrl: known.baseUrl, deterministic: false }, {
    async models() { return { models: candidates, defaultModel: known, checkedAt: "2026-10-05T00:00:00Z" }; },
    async resolveModel(ref) { return { model: ref ? candidates.find(m => m.modelRef === ref)! : known, credential: "private-fixture-key" }; },
  });
  const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const native = runtime.getModel("deepseek", known.model)!;
  const list = await models.chatList();
  assert.deepEqual(list.defaultModel.thinkingLevels, getSupportedThinkingLevels(native));
  assert.equal(list.defaultModel.defaultThinkingLevel, clampThinkingLevel(native, "off"));
  assert.deepEqual(list.models.map(m => m.modelRef), ["catalog-known"]);
  assert.doesNotMatch(JSON.stringify(list), /baseUrl|thinkingLevelMap|credential|private-fixture-key/);
  await assert.rejects(models.thinking(custom), error => error instanceof RunModelError && error.modelErrorCode === "MODEL_NOT_SUPPORTED" && /cannot confirm/.test(error.message));
  assert.equal((await models.list()).models.length, 2, "the old model-only catalog remains compatible");
  known.label = "Runtime model revision 2";
  assert.equal((await models.chatList()).defaultModel.label, native.name, "the composer uses the SDK display name for infrastructure labels");
  assert.equal((await models.resolve(null)).label, known.label, "the accepted model descriptor remains unchanged");
  candidates = [];
  assert.deepEqual((await models.chatList()).models, []);
  assert.deepEqual((await models.chatList()).defaultModel.thinkingLevels, getSupportedThinkingLevels(native));
});
