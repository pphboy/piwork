import { Type } from "typebox";

export const IdentifierSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[a-zA-Z0-9][a-zA-Z0-9._:-]*$",
});

export const ResourceIdSchema = Type.String({
  minLength: 16,
  maxLength: 128,
  pattern: "^[a-zA-Z0-9-]+$",
});

export const TimestampSchema = Type.String({
  minLength: 20,
  maxLength: 40,
  pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T",
});

export const DigestSchema = Type.String({
  pattern: "^sha256:[a-f0-9]{64}$",
});

export const SecretReferenceSchema = Type.Object(
  {
    secretId: ResourceIdSchema,
    key: Type.Optional(IdentifierSchema),
  },
  { additionalProperties: false },
);

export type SecretReference = Type.Static<typeof SecretReferenceSchema>;
