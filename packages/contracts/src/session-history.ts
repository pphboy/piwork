import { Type, type Static } from "typebox";
import { ChatSessionViewSchema, ChatRunViewSchema } from "./chat-controls.js";
import { ChatImageDescriptorSchema } from "./chat-images.js";
import { IdentifierSchema } from "./harness.js";

export const HISTORY_PROFILE = "session-history-v1";
export const HISTORY_RESPONSE_PROFILE = "history-v1";
export const HISTORY_LIMITS = Object.freeze({ defaultEntries: 50, maxEntries: 100, pageBytes: 512 * 1024, rpcBytes: 1024 * 1024, fragmentBytes: 32 * 1024 });
const strict = { additionalProperties: false } as const;
const position = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const handle = Type.String({ minLength: 1, maxLength: 256 });
export const HistoryCapabilitiesSchema = Type.Object({
  contractVersion: Type.Literal(1), profile: Type.Literal(HISTORY_PROFILE), responseProfile: Type.Literal(HISTORY_RESPONSE_PROFILE),
  defaultEntries: Type.Literal(50), maxEntries: Type.Literal(100), pageBytes: Type.Literal(524288), rpcBytes: Type.Literal(1048576), fragmentBytes: Type.Literal(32768),
}, strict);
export const HistoryQuerySchema = Type.Object({
  direction: Type.Optional(Type.Union([Type.Literal("older"), Type.Literal("newer")])),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: HISTORY_LIMITS.maxEntries })),
  cursor: Type.Optional(handle), snapshot: Type.Optional(handle), runId: Type.Optional(IdentifierSchema),
  content: Type.Optional(Type.Union([Type.Literal("messages"), Type.Literal("runs"), Type.Literal("result")])),
  imageProfile: Type.Optional(Type.Literal("chat-images-v1")),
}, strict);
export const HistoryResultRefSchema = Type.Object({
  workId: IdentifierSchema, sessionId: IdentifierSchema, runId: IdentifierSchema, content: Type.Literal("result"),
  snapshot: Type.Optional(handle), entryId: Type.Optional(IdentifierSchema), blockId: Type.Optional(IdentifierSchema),
}, strict);
const { finalText: _finalText, ...runMetadata } = ChatRunViewSchema.properties;
export const HistoryRunSummarySchema = Type.Object({ ...runMetadata, resultRef: Type.Union([HistoryResultRefSchema, Type.Null()]) }, strict);
export const HistorySubmissionLookupSchema = Type.Union([
  Type.Object({kind:Type.Literal("session"),key:Type.String({minLength:1,maxLength:256}),status:Type.Literal("accepted"),session:ChatSessionViewSchema},strict),
  Type.Object({kind:Type.Literal("run"),key:Type.String({minLength:1,maxLength:256}),status:Type.Literal("accepted"),run:HistoryRunSummarySchema},strict),
  Type.Object({kind:Type.Union([Type.Literal("session"),Type.Literal("run")]),key:Type.String({minLength:1,maxLength:256}),status:Type.Literal("not-found")},strict),
]);
export const HistorySegmentSchema = Type.Object({
  entryId: IdentifierSchema, entryOrder: position, role: Type.String({ maxLength: 64 }), runId: Type.String({ maxLength: 256 }),
  blockId: IdentifierSchema, blockIndex: position, blockCount: position,
  type: Type.Union([Type.Literal("text"), Type.Literal("tool-call"), Type.Literal("tool-result"), Type.Literal("image"), Type.Literal("empty"), Type.Literal("run-result")]),
  byteOffset: position, totalBytes: position, complete: Type.Boolean(), text: Type.String({ maxLength: HISTORY_LIMITS.fragmentBytes }),
  // Provider/SDK call IDs are opaque (Responses may join call and item IDs with |).
  toolCallId: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })), toolName: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  resultKind: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("non-text"), Type.Literal("unavailable")])),
  truncated: Type.Optional(Type.Boolean()), isError: Type.Optional(Type.Boolean()), recoveryUnconfirmed: Type.Optional(Type.Boolean()),
  streamId: Type.Optional(IdentifierSchema), streamOffset: Type.Optional(position),
  image: Type.Optional(Type.Object({ ...ChatImageDescriptorSchema.properties, imageIndex: Type.Integer({ minimum: 0, maximum: 3 }) }, strict)),
}, strict);
export const HistoryPageSchema = Type.Object({
  contractVersion: Type.Literal(1), session: ChatSessionViewSchema, snapshotId: handle,
  segments: Type.Array(HistorySegmentSchema), runs: Type.Array(HistoryRunSummarySchema),
  nextCursor: Type.Union([handle, Type.Null()]), hasMore: Type.Boolean(),
}, strict);
export type HistoryQuery = Static<typeof HistoryQuerySchema>;
export type HistoryResultRef = Static<typeof HistoryResultRefSchema>;
export type HistoryRunSummary = Static<typeof HistoryRunSummarySchema>;
export type HistorySegment = Static<typeof HistorySegmentSchema>;
export type HistoryPage = Static<typeof HistoryPageSchema>;

/** Match encoding/json (including its final newline), before any compression. */
export function historyJSON(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`) + "\n";
}
export function historyCapabilities() {
  return { contractVersion: 1 as const, profile: HISTORY_PROFILE, responseProfile: HISTORY_RESPONSE_PROFILE, ...HISTORY_LIMITS };
}
export class HistoryError extends Error {
  constructor(readonly historyCode: "INVALID_HISTORY_CURSOR" | "HISTORY_CURSOR_EXPIRED" | "HISTORY_CORRUPT" | "RESPONSE_TOO_LARGE" | "HISTORY_UNSUPPORTED", message: string) { super(message); }
}
