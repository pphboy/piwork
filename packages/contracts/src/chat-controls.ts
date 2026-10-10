import { Type } from "typebox";
import { IdentifierSchema, ResourceIdSchema, TimestampSchema } from "./harness.js";
import { AgentRunSourceSchema, RunModelDescriptionSchema } from "./work-feedback.js";

export const CHAT_CONTROLS_CONTRACT_VERSION = 3;
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const WEB_SLASH_COMMANDS = ["new", "resume", "model", "thinking", "settings"] as const;
const strict = { additionalProperties: false } as const;
export const ThinkingLevelSchema = Type.Union([
  Type.Literal("off"), Type.Literal("minimal"), Type.Literal("low"), Type.Literal("medium"),
  Type.Literal("high"), Type.Literal("xhigh"), Type.Literal("max"),
]);
export const ChatInputModeSchema = Type.Union([Type.Literal("text"), Type.Literal("command")]);
export const ChatCapabilitiesSchema = Type.Object({ contractVersion: Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2), Type.Literal(3)]) }, strict);
export const ThinkingSettingSchema = Type.Union([ThinkingLevelSchema,Type.Null()]);
const KnownChatModelSchema = Type.Object({
  ...RunModelDescriptionSchema.properties,
  thinkingLevels: Type.Array(ThinkingLevelSchema, { minItems: 1, maxItems: 7, uniqueItems: true }),
  defaultThinkingLevel: ThinkingLevelSchema,
}, strict);
export const ChatModelSchema = Type.Union([KnownChatModelSchema,Type.Object({
 ...RunModelDescriptionSchema.properties,thinkingAvailability:Type.Literal("unknown"),thinkingLevels:Type.Array(ThinkingLevelSchema,{maxItems:0}),defaultThinkingLevel:Type.Null(),
},strict)]);
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
 contractVersion:Type.Literal(3),models:Type.Array(ChatModelSchema,{maxItems:256}),defaultModel:Type.Union([ChatModelSchema,Type.Null()]),defaultUnavailableReason:Type.Optional(Type.String({maxLength:256})),
 unavailableModels:Type.Optional(Type.Array(Type.Object({...RunModelDescriptionSchema.properties,reason:Type.Union([Type.Literal("capabilities-unconfirmed"),Type.Literal("sdk-unsupported")]),recovery:Type.String({minLength:1,maxLength:256})},strict),{maxItems:256})),checkedAt:TimestampSchema,availability:Type.Union([Type.Literal("available"),Type.Literal("unavailable")]),
},strict)]);
export const SlashCommandSchema = Type.Object({
  kind: Type.Union([Type.Literal("skill"), Type.Literal("prompt")]),
  command: Type.String({ minLength: 2, maxLength: 256 }),
  name: Type.String({ minLength: 1, maxLength: 128 }),
  description: Type.String({ maxLength: 2048 }), sourceName: Type.String({ minLength: 1, maxLength: 256 }),
}, strict);
export const SlashCommandListSchema = Type.Object({
  contractVersion: Type.Literal(1), commands: Type.Array(SlashCommandSchema, { maxItems: 4096 }), checkedAt: TimestampSchema,
}, strict);
export const SetSessionChatOptionsSchema = Type.Object({
  modelRef: Type.Union([ResourceIdSchema, Type.Null()]), thinkingLevel: ThinkingSettingSchema,
}, strict);
export const SessionChatOptionsSchema = Type.Object({
  sessionId: IdentifierSchema, ...SetSessionChatOptionsSchema.properties,
  model: RunModelDescriptionSchema,
  availability: Type.Union([Type.Literal("available"), Type.Literal("unavailable")]), checkedAt: TimestampSchema,
}, strict);
export const RunSubmissionSelectorSchema = Type.Union([
  Type.Object({ kind: Type.Literal("session-preference"), inputMode: Type.Optional(ChatInputModeSchema) }, strict),
  Type.Object({ kind: Type.Literal("work-default"), inputMode: Type.Optional(ChatInputModeSchema) }, strict),
  Type.Object({ kind: Type.Literal("model"), modelRef: ResourceIdSchema, inputMode: Type.Optional(ChatInputModeSchema) }, strict),
]);
export const ChatSubmissionKeySchema = Type.String({ minLength: 1, maxLength: 256, pattern: "^[a-zA-Z0-9][a-zA-Z0-9._:-]*$" });
export const LookupChatSubmissionSchema = Type.Object({
  kind: Type.Union([Type.Literal("session"), Type.Literal("run")]), key: ChatSubmissionKeySchema,
}, strict);
const modelPreference = Type.Object({
  ...RunModelDescriptionSchema.properties,
  availability: Type.Union([Type.Literal("available"), Type.Literal("unavailable")]),
}, strict);
export const ChatSessionViewSchema = Type.Object({
  workId: IdentifierSchema, sessionId: IdentifierSchema, createdAt: TimestampSchema, updatedAt: TimestampSchema,
  modelPreference: Type.Union([modelPreference, Type.Null()]), thinkingLevel: ThinkingSettingSchema, source: AgentRunSourceSchema,
}, strict);
export const ChatRunViewSchema = Type.Object({
  workId: IdentifierSchema, sessionId: IdentifierSchema, runId: IdentifierSchema, submissionKey: Type.String({ minLength: 1, maxLength: 256 }),
  state: Type.Integer({ minimum: 1, maximum: 7 }), promptDigest: Type.String({ minLength: 1 }), finalText: Type.String(),
  acceptedAt: TimestampSchema, startedAt: Type.String(), finishedAt: Type.String(),
  earliestAvailableSequence: Type.String({ pattern: "^[0-9]+$" }), latestSequence: Type.String({ pattern: "^[0-9]+$" }),
  actualModel: Type.Union([RunModelDescriptionSchema, Type.Null()]), thinkingLevel: ThinkingSettingSchema,
  source: AgentRunSourceSchema, adoptedExperienceVersion: Type.Integer({ minimum: 0 }),
  error: Type.Optional(Type.Object({ code: Type.String(), message: Type.String(), retryable: Type.Boolean() }, strict)),
}, strict);
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
  Type.Object({ blockId: IdentifierSchema, type: Type.Literal("text"), text: Type.String() }, strict),
  Type.Object({ blockId: IdentifierSchema, type: Type.Literal("tool-call"), toolCallId: IdentifierSchema, toolName: Type.String({ minLength: 1, maxLength: 256 }) }, strict),
  Type.Object({ blockId: IdentifierSchema, type: Type.Literal("tool-result"), toolCallId: IdentifierSchema, toolName: Type.String({ minLength: 1, maxLength: 256 }), result: ToolResultPreviewSchema }, strict),
]);

export type ThinkingLevel = Type.Static<typeof ThinkingLevelSchema>;
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
