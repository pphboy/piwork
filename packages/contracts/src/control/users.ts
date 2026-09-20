import { Type } from "typebox";
import { IdentifierSchema, ResourceIdSchema, TimestampSchema } from "../common.js";

export const UserRoleSchema = Type.Union([Type.Literal("admin"), Type.Literal("user")]);

export const UserSchema = Type.Object(
  {
    id: ResourceIdSchema,
    account: IdentifierSchema,
    role: UserRoleSchema,
    enabled: Type.Boolean(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  },
  { additionalProperties: false },
);

export const CreateUserRequestSchema = Type.Object(
  {
    account: IdentifierSchema,
    password: Type.String({ minLength: 12, maxLength: 1_024 }),
    role: Type.Optional(UserRoleSchema),
  },
  { additionalProperties: false },
);

export const ResetUserPasswordRequestSchema = Type.Object(
  { password: Type.String({ minLength: 12, maxLength: 1_024 }) },
  { additionalProperties: false },
);

export type User = Type.Static<typeof UserSchema>;
export type CreateUserRequest = Type.Static<typeof CreateUserRequestSchema>;
