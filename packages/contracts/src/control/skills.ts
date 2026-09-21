import { Type } from "typebox";
import { TimestampSchema } from "../common.js";
import { SkillNameSchema } from "./work-config.js";

/** The only Skill metadata visible to an ordinary authenticated user. */
export const PublicSkillSchema = Type.Object(
  { name: SkillNameSchema },
  { additionalProperties: false },
);

/** Operator projection. It deliberately excludes paths, content and identities. */
export const OperatorSkillSchema = Type.Object(
  {
    name: SkillNameSchema,
    enabled: Type.Boolean(),
    fileCount: Type.Integer({ minimum: 1, maximum: 2_048 }),
    totalBytes: Type.Integer({ minimum: 0, maximum: 32 * 1_024 * 1_024 }),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  },
  { additionalProperties: false },
);

export const SkillPathRequestSchema = Type.Object(
  { path: Type.String({ minLength: 1, maxLength: 16_384 }) },
  { additionalProperties: false },
);

export type PublicSkill = Type.Static<typeof PublicSkillSchema>;
export type OperatorSkill = Type.Static<typeof OperatorSkillSchema>;
export type SkillPathRequest = Type.Static<typeof SkillPathRequestSchema>;
