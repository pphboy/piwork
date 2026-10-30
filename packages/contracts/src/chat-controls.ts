import { Type } from "typebox";
import { IdentifierSchema, ResourceIdSchema, TimestampSchema } from "./harness.js";
import { AgentRunSourceSchema, RunModelDescriptionSchema } from "./work-feedback.js";
import { ChatImageDescriptorSchema } from "./chat-images.js";

export const CHAT_CONTROLS_CONTRACT_VERSION = 4;
export const COMPATIBLE_THINKING_CONTRACT_VERSION = 4;
export const CANCEL_AND_SEND_CONTRACT_VERSION = 1;
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const WEB_SLASH_COMMANDS = ["new", "resume", "model", "thinking", "settings"] as const;
const strict = { additionalProperties: false } as const;
export const ThinkingLevelSchema = Type.Union([
  Type.Literal("off"), Type.Literal("minimal"), Type.Literal("low"), Type.Literal("medium"),
  Type.Literal("high"), Type.Literal("xhigh"), Type.Literal("max"),
]);
export const ChatInputModeSchema = Type.Union([Type.Literal("text"), Type.Literal("command")]);
export const ChatCapabilitiesSchema = Type.Object({ contractVersion: Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2), Type.Literal(3), Type.Literal(4)]), cancelAndSendContractVersion: Type.Optional(Type.Union([Type.Literal(0), Type.Literal(1)])) }, strict);
export const ThinkingSettingSchema = Type.Union([ThinkingLevelSchema,Type.Null()]);
export const ThinkingProfileSchema = Type.Union([
  Type.Literal("responses-effort-v1"), Type.Literal("messages-adaptive-v1"), Type.Literal("messages-budget-v1"),
]);
export const CompatibleThinkingProfileSchema = Type.Object({
  profile: ThinkingProfileSchema,
  levels: Type.Array(ThinkingLevelSchema, { minItems: 1, maxItems: 7, uniqueItems: true }),
  budgets: Type.Optional(Type.Object({
    minimal: Type.Optional(Type.Integer({ minimum: 1 })), low: Type.Optional(Type.Integer({ minimum: 1 })),
    medium: Type.Optional(Type.Integer({ minimum: 1 })), high: Type.Optional(Type.Integer({ minimum: 1 })),
  }, strict)),
}, strict);
const KnownChatModelSchema = Type.Object({
  ...RunModelDescriptionSchema.properties,
  thinkingLevels: Type.Array(ThinkingLevelSchema, { minItems: 1, maxItems: 7, uniqueItems: true }),
  defaultThinkingLevel: ThinkingLevelSchema,
}, strict);
const ChatModelV3Schema = Type.Union([KnownChatModelSchema,Type.Object({
 ...RunModelDescriptionSchema.properties,thinkingAvailability:Type.Literal("unknown"),thinkingLevels:Type.Array(ThinkingLevelSchema,{maxItems:0}),defaultThinkingLevel:Type.Null(),
},strict)]);
const ChatModelV4Schema = Type.Union([KnownChatModelSchema, Type.Object({
  ...RunModelDescriptionSchema.properties, thinkingAvailability: Type.Literal("unknown"),
  thinkingLevels: Type.Array(ThinkingLevelSchema, { maxItems: 0 }), defaultThinkingLevel: Type.Null(),
  compatibleThinkingProfiles: Type.Array(CompatibleThinkingProfileSchema, { minItems: 1, maxItems: 2 }),
}, strict)]);
export const ChatModelSchema = Type.Union([ChatModelV3Schema, ChatModelV4Schema]);
const ChatModelListV1Schema = Type.Object({
  contractVersion: Type.Literal(1), models: Type.Array(KnownChatModelSchema, { maxItems: 256 }),
  defaultModel: KnownChatModelSchema, checkedAt: TimestampSchema,
  availability: Type.Union([Type.Literal("available"), Type.Literal("unavailable")]),
}, strict);
export const ChatModelListSchema = Type.Union([ChatModelListV1Schema, Type.Object({
  contractVersion: Type.Literal(2), models: Type.Array(KnownChatModelSchema, { maxItems: 256 }),
  defaultModel: Type.Union([KnownChatModelSchema,Type.Null()]), defaultUnavailableReason: Type.Optional(Type.String({ maxLength: 256 })),
  unavailableModels: Type.Optional(Type.Array(Type.Object({
    ...RunModelDescriptionSchema.properties,
    reason: Type.Union([Type.Literal("capabilities-unconfirmed"), Type.Literal("sdk-unsupported")]),
    recovery: Type.String({ minLength: 1, maxLength: 256 }),
  }, strict), { maxItems: 256 })),
  checkedAt: TimestampSchema, availability: Type.Union([Type.Literal("available"), Type.Literal("unavailable")]),
},strict),Type.Object({
 contractVersion:Type.Literal(3),models:Type.Array(ChatModelV3Schema,{maxItems:256}),defaultModel:Type.Union([ChatModelV3Schema,Type.Null()]),defaultUnavailableReason:Type.Optional(Type.String({maxLength:256})),
 unavailableModels:Type.Optional(Type.Array(Type.Object({...RunModelDescriptionSchema.properties,reason:Type.Union([Type.Literal("capabilities-unconfirmed"),Type.Literal("sdk-unsupported")]),recovery:Type.String({minLength:1,maxLength:256})},strict),{maxItems:256})),checkedAt:TimestampSchema,availability:Type.Union([Type.Literal("available"),Type.Literal("unavailable")]),
},strict), Type.Object({
 contractVersion:Type.Literal(4),models:Type.Array(ChatModelV4Schema,{maxItems:256}),defaultModel:Type.Union([ChatModelV4Schema,Type.Null()]),defaultUnavailableReason:Type.Optional(Type.String({maxLength:256})),
 unavailableModels:Type.Optional(Type.Array(Type.Object({...RunModelDescriptionSchema.properties,reason:Type.Union([Type.Literal("capabilities-unconfirmed"),Type.Literal("sdk-unsupported")]),recovery:Type.String({minLength:1,maxLength:256})},strict),{maxItems:256})),checkedAt:TimestampSchema,availability:Type.Union([Type.Literal("available"),Type.Literal("unavailable")]),
}, strict)]);
export const SlashCommandSchema = Type.Object({
  kind: Type.Union([Type.Literal("skill"), Type.Literal("prompt")]),
  command: Type.String({ minLength: 2, maxLength: 256 }),
  name: Type.String({ minLength: 1, maxLength: 128 }),
  description: Type.String({ maxLength: 2048 }), sourceName: Type.String({ minLength: 1, maxLength: 256 }),
}, strict);
export const SlashCommandListSchema = Type.Object({
  contractVersion: Type.Literal(1), commands: Type.Array(SlashCommandSchema, { maxItems: 4096 }), checkedAt: TimestampSchema,
}, strict);
const invalidProfileLevel = Type.Union([
  Type.Object({ thinkingProfile: ThinkingProfileSchema, thinkingLevel: Type.Null() }),
  Type.Object({ thinkingProfile: Type.Literal("messages-adaptive-v1"), thinkingLevel: Type.Literal("minimal") }),
  Type.Object({ thinkingProfile: Type.Literal("messages-budget-v1"), thinkingLevel: Type.Union([Type.Literal("xhigh"), Type.Literal("max")]) }),
]);
const thinkingSelection = { thinkingLevel: ThinkingSettingSchema, thinkingProfile: Type.Optional(ThinkingProfileSchema) };
export const SetSessionChatOptionsSchema = Type.Object({
  modelRef: Type.Union([ResourceIdSchema, Type.Null()]), thinkingLevel: ThinkingSettingSchema,
  thinkingProfile: Type.Optional(Type.Union([ThinkingProfileSchema, Type.Null()])),
}, { ...strict, not: invalidProfileLevel });
export const SessionChatOptionsSchema = Type.Object({
  sessionId: IdentifierSchema, modelRef: Type.Union([ResourceIdSchema, Type.Null()]), ...thinkingSelection,
  model: RunModelDescriptionSchema,
  availability: Type.Union([Type.Literal("available"), Type.Literal("unavailable")]), checkedAt: TimestampSchema,
}, { ...strict, not: invalidProfileLevel });
export const RunSubmissionSelectorSchema = Type.Union([
  Type.Object({ kind: Type.Literal("session-preference"), inputMode: Type.Optional(ChatInputModeSchema) }, strict),
  Type.Object({ kind: Type.Literal("work-default"), inputMode: Type.Optional(ChatInputModeSchema) }, strict),
  Type.Object({ kind: Type.Literal("model"), modelRef: ResourceIdSchema, inputMode: Type.Optional(ChatInputModeSchema) }, strict),
]);
export const ChatSubmissionKeySchema = Type.String({ minLength: 1, maxLength: 256, pattern: "^[a-zA-Z0-9][a-zA-Z0-9._:-]*$" });
export const LookupChatSubmissionSchema = Type.Object({
  kind: Type.Union([Type.Literal("session"), Type.Literal("run")]), key: ChatSubmissionKeySchema,
  responseProfile: Type.Optional(Type.Literal("history-v1")),
}, strict);
const modelPreference = Type.Object({
  ...RunModelDescriptionSchema.properties,
  availability: Type.Union([Type.Literal("available"), Type.Literal("unavailable")]),
}, strict);
export const ChatSessionViewSchema = Type.Object({
  workId: IdentifierSchema, sessionId: IdentifierSchema, createdAt: TimestampSchema, updatedAt: TimestampSchema,
  modelPreference: Type.Union([modelPreference, Type.Null()]), ...thinkingSelection, source: AgentRunSourceSchema,
}, { ...strict, not: invalidProfileLevel });
export const ChatRunViewSchema = Type.Object({
  workId: IdentifierSchema, sessionId: IdentifierSchema, runId: IdentifierSchema, submissionKey: Type.String({ minLength: 1, maxLength: 256 }),
  state: Type.Integer({ minimum: 1, maximum: 7 }), promptDigest: Type.String({ minLength: 1 }), finalText: Type.String(),
  acceptedAt: TimestampSchema, startedAt: Type.String(), finishedAt: Type.String(),
  earliestAvailableSequence: Type.String({ pattern: "^[0-9]+$" }), latestSequence: Type.String({ pattern: "^[0-9]+$" }),
  actualModel: Type.Union([RunModelDescriptionSchema, Type.Null()]), ...thinkingSelection,
  source: AgentRunSourceSchema, adoptedExperienceVersion: Type.Integer({ minimum: 0 }),
  error: Type.Optional(Type.Object({ code: Type.String(), message: Type.String(), retryable: Type.Boolean() }, strict)),
}, { ...strict, not: invalidProfileLevel });
export const ChatSubmissionLookupSchema = Type.Union([
  Type.Object({ kind: Type.Literal("session"), key: ChatSubmissionKeySchema, status: Type.Literal("accepted"), session: ChatSessionViewSchema }, strict),
  Type.Object({ kind: Type.Literal("run"), key: ChatSubmissionKeySchema, status: Type.Literal("accepted"), run: ChatRunViewSchema }, strict),
  Type.Object({ kind: Type.Union([Type.Literal("session"), Type.Literal("run")]), key: ChatSubmissionKeySchema, status: Type.Literal("not-found") }, strict),
]);
export const ToolResultPreviewSchema = Type.Union([
  Type.Object({ kind: Type.Literal("text"), text: Type.String({ maxLength: 65536 }), truncated: Type.Boolean(), isError: Type.Boolean() }, strict),
  Type.Object({ kind: Type.Union([Type.Literal("non-text"), Type.Literal("unavailable")]), truncated: Type.Boolean(), isError: Type.Boolean() }, strict),
]);
export const SessionContentBlockSchema = Type.Union([
  Type.Object({ blockId: IdentifierSchema, type: Type.Literal("image"), image: Type.Object({ ...ChatImageDescriptorSchema.properties, imageIndex: Type.Integer({ minimum: 0, maximum: 3 }) }, strict) }, strict),
  Type.Object({ blockId: IdentifierSchema, type: Type.Literal("text"), text: Type.String() }, strict),
  Type.Object({ blockId: IdentifierSchema, type: Type.Literal("tool-call"), toolCallId: IdentifierSchema, toolName: Type.String({ minLength: 1, maxLength: 256 }) }, strict),
  Type.Object({ blockId: IdentifierSchema, type: Type.Literal("tool-result"), toolCallId: IdentifierSchema, toolName: Type.String({ minLength: 1, maxLength: 256 }), result: ToolResultPreviewSchema }, strict),
]);

export type ThinkingLevel = Type.Static<typeof ThinkingLevelSchema>;
export type ThinkingProfile = Type.Static<typeof ThinkingProfileSchema>;
export type ChatInputMode = Type.Static<typeof ChatInputModeSchema>;
export type ChatModel = Type.Static<typeof ChatModelSchema>;
export type ChatModelList = Type.Static<typeof ChatModelListSchema>;
export type SlashCommand = Type.Static<typeof SlashCommandSchema>;
export type SlashCommandList = Type.Static<typeof SlashCommandListSchema>;
export type SessionChatOptions = Type.Static<typeof SessionChatOptionsSchema>;
export type SetSessionChatOptions = Type.Static<typeof SetSessionChatOptionsSchema>;
export type RunSubmissionSelector = Type.Static<typeof RunSubmissionSelectorSchema>;
export type ChatSubmissionLookup = Type.Static<typeof ChatSubmissionLookupSchema>;
export type ToolResultPreview = Type.Static<typeof ToolResultPreviewSchema>;
export type ChatContentBlock = Type.Static<typeof SessionContentBlockSchema>;

export type ThinkingSetting = Type.Static<typeof ThinkingSettingSchema>;
