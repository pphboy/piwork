import { Type } from 'typebox';
import { IdentifierSchema, TimestampSchema } from './harness.js';

const strict = { additionalProperties: false } as const;
const operationKey = Type.String({ minLength: 1, maxLength: 256 });
const revision = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
export const SessionTitleSourceSchema = Type.Union([Type.Literal('default'), Type.Literal('manual'), Type.Literal('auto')]);
export const SessionAutoNameStateSchema = Type.Union([Type.Literal('eligible'), Type.Literal('pending'), Type.Literal('completed'), Type.Literal('failed'), Type.Literal('unknown')]);
export const SessionManagementCapabilitiesSchema = Type.Object({ contractVersion: Type.Union([Type.Literal(0), Type.Literal(1)]) }, strict);
export const SessionManagementStateSchema = Type.Object({
  workId: IdentifierSchema, sessionId: IdentifierSchema, title: Type.Union([Type.String({ minLength: 1, maxLength: 120 }), Type.Null()]),
  titleSource: SessionTitleSourceSchema, revision, manualLock: Type.Boolean(), deletedAt: Type.Union([TimestampSchema, Type.Null()]), autoState: SessionAutoNameStateSchema,
}, strict);
export const RenameSessionInputSchema = Type.Object({ operationKey, expectedRevision: revision, title: Type.String({ minLength: 1, maxLength: 120 }) }, strict);
export const DeleteSessionInputSchema = Type.Object({ operationKey, expectedRevision: revision }, strict);
export const AutoNameSessionInputSchema = Type.Object({ operationKey, expectedRevision: revision }, strict);
export const SessionManagementOperationQuerySchema = Type.Object({ sessionId: IdentifierSchema }, strict);
export const SessionManagementLookupSchema = Type.Union([
  Type.Object({ operationKey, status: Type.Literal('not-found') }, strict),
  Type.Object({ operationKey, status: Type.Union([Type.Literal('pending'), Type.Literal('accepted'), Type.Literal('failed'), Type.Literal('unknown')]), kind: Type.Union([Type.Literal('rename'), Type.Literal('delete'), Type.Literal('auto-name')]), state: SessionManagementStateSchema }, strict),
]);
export type SessionManagementState = Type.Static<typeof SessionManagementStateSchema>;
export type RenameSessionInput = Type.Static<typeof RenameSessionInputSchema>;
export type DeleteSessionInput = Type.Static<typeof DeleteSessionInputSchema>;
export type AutoNameSessionInput = Type.Static<typeof AutoNameSessionInputSchema>;
export type SessionManagementLookup = Type.Static<typeof SessionManagementLookupSchema>;
