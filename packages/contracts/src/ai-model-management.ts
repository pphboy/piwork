import { Type } from "typebox";
import { ResourceIdSchema, TimestampSchema } from "./harness.js";

const strict = { additionalProperties: false } as const;
const name = Type.String({ minLength: 1, maxLength: 128 });
const modelName = Type.String({ minLength: 1, maxLength: 256 });
const model = Type.String({ minLength: 1, maxLength: 256 });
const endpoint = Type.String({ minLength: 1, maxLength: 4096 });
const credential = Type.String({ minLength: 1, maxLength: 65536 });
export const ModelApiSchema = Type.Union([Type.Literal("openai-responses"), Type.Literal("anthropic-messages")]);
const mapping = Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Integer({ minimum: 0, maximum: 1000000 }), Type.Null()]);
export const ModelDefinitionSchema = Type.Object({
  reasoning: Type.Boolean(), input: Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")]), { minItems: 1, maxItems: 2, uniqueItems: true }),
  contextWindow: Type.Integer({ minimum: 1, maximum: 10000000 }), maxTokens: Type.Integer({ minimum: 1, maximum: 1000000 }),
  thinkingLevelMap: Type.Optional(Type.Object(Object.fromEntries(["off", "minimal", "low", "medium", "high", "xhigh", "max"].map(level => [level, Type.Optional(mapping)])), strict)),
  compat: Type.Optional(Type.Object({ forceAdaptiveThinking: Type.Optional(Type.Boolean()), supportsLongCacheRetention: Type.Optional(Type.Boolean()) }, strict)),
}, strict);
export const ModelCapabilitiesSchema = Type.Union([
  Type.Object({ kind: Type.Literal("sdk"), provider: model, model }, strict),
  Type.Object({ kind: Type.Literal("explicit"), definition: ModelDefinitionSchema }, strict),
]);
export const CreateModelProviderSchema = Type.Object({ name, api: ModelApiSchema, baseUrl: endpoint, credential }, strict);
export const PatchModelProviderSchema = Type.Object({ name: Type.Optional(name), baseUrl: Type.Optional(endpoint), credential: Type.Optional(credential) }, { ...strict, minProperties: 1 });
export const ModelProviderSchema = Type.Object({ id: ResourceIdSchema, name, api: ModelApiSchema, baseUrl: endpoint, enabled: Type.Boolean(), credentialAvailable: Type.Boolean(), createdAt: TimestampSchema, updatedAt: TimestampSchema }, strict);
export const ModelProviderListSchema = Type.Object({ providers: Type.Array(ModelProviderSchema, { maxItems: 256 }) }, strict);
export const CreateManagedModelSchema = Type.Object({ name, model, capabilities: Type.Optional(ModelCapabilitiesSchema) }, strict);
export const PatchManagedModelSchema = Type.Object({ name: Type.Optional(name), model: Type.Optional(model), capabilities: Type.Optional(Type.Union([ModelCapabilitiesSchema, Type.Null()])) }, { ...strict, minProperties: 1 });
export const ManagedModelSchema = Type.Object({
  id: ResourceIdSchema, providerId: ResourceIdSchema, name, model, modelRef: ResourceIdSchema, enabled: Type.Boolean(),
  api: ModelApiSchema, providerName: name, providerEnabled: Type.Boolean(), credentialAvailable: Type.Boolean(),
  capabilities: Type.Optional(ModelCapabilitiesSchema), capabilityStatus: Type.Union([Type.Literal("sdk"), Type.Literal("explicit"), Type.Literal("unconfirmed")]),
  createdAt: TimestampSchema, updatedAt: TimestampSchema,
}, strict);
export const ManagedModelListSchema = Type.Object({ models: Type.Array(ManagedModelSchema, { maxItems: 256 }) }, strict);
export const CreateModelConfigSchema = Type.Object({ model, api: ModelApiSchema, baseUrl: endpoint, credential, name: Type.Optional(Type.String({maxLength:256})) }, strict);
export const PatchModelConfigSchema = Type.Object({ model: Type.Optional(model), api: Type.Optional(ModelApiSchema), baseUrl: Type.Optional(endpoint), credential: Type.Optional(credential), name: Type.Optional(Type.String({maxLength:256})) }, {...strict,minProperties:1});
export const ModelConfigSchema = Type.Object({id:ResourceIdSchema,name:modelName,api:ModelApiSchema,baseUrl:endpoint,model,modelRef:ResourceIdSchema,enabled:Type.Boolean(),credentialAvailable:Type.Boolean(),createdAt:TimestampSchema,updatedAt:TimestampSchema},strict);
export const ModelConfigListSchema = Type.Object({models:Type.Array(ModelConfigSchema,{maxItems:256})},strict);
export const SavedModelTestInputSchema = Type.Object({ modelId: ResourceIdSchema, model:Type.Optional(model), api:Type.Optional(ModelApiSchema), baseUrl:Type.Optional(endpoint),credential:Type.Optional(credential) }, strict);
export const ProviderModelTestInputSchema = Type.Object({ providerId: ResourceIdSchema, model, baseUrl: Type.Optional(endpoint), credential: Type.Optional(credential) }, strict);
export const DraftModelTestInputSchema = Type.Object({ api: ModelApiSchema, baseUrl: endpoint, model, credential }, strict);
export const ModelTestInputSchema = Type.Union([SavedModelTestInputSchema, ProviderModelTestInputSchema, DraftModelTestInputSchema]);
const testResultProperties = {
  api: ModelApiSchema, model, checkedAt: TimestampSchema, durationMs: Type.Integer({ minimum: 0 }),
  testMessage: Type.Literal("Reply with OK."),
  httpStatus: Type.Optional(Type.Integer({ minimum: 100, maximum: 599 })),
};
export const ModelTestSuccessSchema = Type.Object({
  ...testResultProperties, success: Type.Literal(true), category: Type.Literal("success"),
  replyText: Type.String({ minLength: 1, maxLength: 8192 }), replyTruncated: Type.Boolean(),
}, strict);
export const ModelTestFailureSchema = Type.Object({
  ...testResultProperties, success: Type.Literal(false),
  category: Type.Union(["authentication", "model", "rate-limit", "network", "timeout", "protocol", "response-limit"].map(value => Type.Literal(value))),
  reason: Type.Union(['provider-authentication','model-unavailable','rate-limited','dns','tls','connection','network','timeout','provider-error','protocol-mismatch','empty-reply','response-too-large'].map(value=>Type.Literal(value))),
  message: Type.String({minLength:1,maxLength:512}), recovery: Type.String({minLength:1,maxLength:512}),
}, strict);
export const ModelTestResultSchema = Type.Union([ModelTestSuccessSchema, ModelTestFailureSchema]);
export const AdminRuntimeSelectionSchema = Type.Object({ agentImage: Type.String({ minLength: 1, maxLength: 4096 }), modelRef: ResourceIdSchema }, strict);

export type ModelConfig = Type.Static<typeof ModelConfigSchema>;
export const modelManagementSchemas = { CreateModelConfigSchema, PatchModelConfigSchema, ModelConfigSchema, ModelConfigListSchema, ModelApiSchema, ModelDefinitionSchema, ModelCapabilitiesSchema, CreateModelProviderSchema, PatchModelProviderSchema, ModelProviderSchema, ModelProviderListSchema, CreateManagedModelSchema, PatchManagedModelSchema, ManagedModelSchema, ManagedModelListSchema, SavedModelTestInputSchema, ProviderModelTestInputSchema, DraftModelTestInputSchema, ModelTestInputSchema, ModelTestSuccessSchema, ModelTestFailureSchema, ModelTestResultSchema, AdminRuntimeSelectionSchema };
export type ModelApi = Type.Static<typeof ModelApiSchema>;
export type ModelCapabilities = Type.Static<typeof ModelCapabilitiesSchema>;
export type ModelDefinition = Type.Static<typeof ModelDefinitionSchema>;
export type ModelProvider = Type.Static<typeof ModelProviderSchema>;
export type ManagedModel = Type.Static<typeof ManagedModelSchema>;
export type ModelTestResult = Type.Static<typeof ModelTestResultSchema>;
