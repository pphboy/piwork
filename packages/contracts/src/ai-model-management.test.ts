import test from "node:test";
import assert from "node:assert/strict";
import { Check } from "typebox/value";
import { CreateModelProviderSchema, PatchModelProviderSchema, ModelTestInputSchema, ModelTestResultSchema, AdminRuntimeSelectionSchema, ModelCapabilitiesSchema } from "./ai-model-management.js";

test("model management accepts exactly Responses and Messages with write-only nonempty keys", () => {
  const input = { name: "Synthetic gateway", api: "openai-responses", baseUrl: "https://fixture.invalid/v1", credential: "synthetic-key" };
  assert.equal(Check(CreateModelProviderSchema, input), true);
  for (const api of ["openai-completions", "unknown"]) assert.equal(Check(CreateModelProviderSchema, { ...input, api }), false);
  assert.equal(Check(CreateModelProviderSchema, { ...input, api: "anthropic-messages" }), true);
  assert.equal(Check(CreateModelProviderSchema, { ...input, credential: "" }), false);
  assert.equal(Check(CreateModelProviderSchema, { ...input, unexpected: true }), false);
  assert.equal(Check(PatchModelProviderSchema, { name: "Renamed" }), true);
  assert.equal(Check(PatchModelProviderSchema, {}), false);
  assert.equal(Check(PatchModelProviderSchema, { credential: "" }), false);
  assert.equal(Check(PatchModelProviderSchema, { api: "anthropic-messages" }), false);
});
test('message Test results require actual bounded replies only on success and reject private fields',()=>{
  const base={api:'openai-responses',model:'synthetic',testMessage:'Reply with OK.',checkedAt:'2026-10-09T00:00:00Z',durationMs:1};
  const success={...base,success:true,category:'success',replyText:'Actual model response',replyTruncated:false};
  const failure={...base,success:false,category:'protocol',reason:'empty-reply',message:'No visible assistant text.',recovery:'Check the model and API.'};
  assert.equal(Check(ModelTestResultSchema,success),true);assert.equal(Check(ModelTestResultSchema,failure),true);
  for(const invalid of [{...success,replyText:''},{...success,replyTruncated:undefined},{...success,replyText:'x'.repeat(8193)},{...success,testMessage:'other'},{...success,category:'protocol'},{...failure,replyText:'fake'},{...failure,replyTruncated:false}])assert.equal(Check(ModelTestResultSchema,invalid),false);
  for(const extra of [{credential:'synthetic'},{rawBody:'private'},{thinking:'private'},{credentialRef:'internal'}])assert.equal(Check(ModelTestResultSchema,{...success,...extra}),false);
  for(const extra of [{reason:'unknown'},{message:'x'.repeat(513)},{recovery:''},{reason:undefined},{message:undefined}])assert.equal(Check(ModelTestResultSchema,{...failure,...extra}),false);
});
test("Test targets and runtime selection cannot mix authority or credential inputs", () => {
  const id = "provider-fixture-0001";
  assert.equal(Check(ModelTestInputSchema, { providerId: id, model: "fixture-model" }), true);
  assert.equal(Check(ModelTestInputSchema, { modelId: id, credential: "synthetic" }), true);
  assert.equal(Check(ModelTestInputSchema, { api: "openai-responses", baseUrl: "https://fixture.invalid/v1", model: "one", credential: "synthetic" }), true);
  assert.equal(Check(ModelTestInputSchema,{modelId:id,providerId:id,credential:"synthetic"}),false);
  assert.equal(Check(AdminRuntimeSelectionSchema, { agentImage: "fixture/native", modelRef: id }), true);
  assert.equal(Check(AdminRuntimeSelectionSchema, { agentImage: "fixture/native", modelRef: id, credential: "synthetic" }), false);
  assert.equal(Check(ModelCapabilitiesSchema, { kind: "sdk", provider: "openai", model: "fixture-model" }), true);
  assert.equal(Check(ModelCapabilitiesSchema, { kind: "sdk", provider: "openai", model: "fixture-model", defaultThinking: "high" }), false);
});

test('flat model names accept the full model ID boundary without relaxing legacy names',async()=>{
 const {CreateModelConfigSchema,PatchModelConfigSchema,ModelConfigSchema}=await import('./ai-model-management.js');
 for(const length of [129,256])for(const character of ['x','模','😀']){
  const value=character.repeat(length),input={model:value,api:'anthropic-messages',baseUrl:'https://fixture.invalid',credential:'synthetic-key'};
  assert.equal(Check(CreateModelConfigSchema,input),true);
  assert.equal(Check(CreateModelConfigSchema,{...input,name:value}),true);
  assert.equal(Check(PatchModelConfigSchema,{name:value}),true);
  assert.equal(Check(ModelConfigSchema,{id:'managed-model-fixture-0001',modelRef:'model-config-fixture-0001',model:value,name:value,api:input.api,baseUrl:input.baseUrl,enabled:true,credentialAvailable:true,createdAt:'2026-10-09T00:00:00Z',updatedAt:'2026-10-09T00:00:00Z'}),true);
  assert.equal(Check(CreateModelProviderSchema,{name:value,api:input.api,baseUrl:input.baseUrl,credential:input.credential}),false);
 }
 const input={model:'model',api:'anthropic-messages',baseUrl:'https://fixture.invalid',credential:'synthetic-key'};
 assert.equal(Check(CreateModelConfigSchema,{...input,name:'x'.repeat(257)}),false);
 assert.equal(Check(CreateModelConfigSchema,{...input,model:'x'.repeat(257)}),false);
 assert.equal(Check(PatchModelConfigSchema,{name:'x'.repeat(257)}),false);
 assert.equal(Check(PatchModelConfigSchema,{name:''}),true);
});
