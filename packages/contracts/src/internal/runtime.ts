import { Type } from "typebox";
import { ResourceIdSchema, TimestampSchema } from "../common.js";

export const WorkRuntimeIdentitySchema = Type.Object(
  {
    installationId: ResourceIdSchema,
    workId: ResourceIdSchema,
    generation: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const WorkReadinessSchema = Type.Object(
  {
    identity: WorkRuntimeIdentitySchema,
    activeRevision: Type.Integer({ minimum: 1 }),
    state: Type.Union([
      Type.Literal("starting"),
      Type.Literal("ready"),
      Type.Literal("degraded"),
      Type.Literal("draining"),
      Type.Literal("stopped"),
    ]),
    observedAt: TimestampSchema,
    loadedSkillIds: Type.Array(ResourceIdSchema, { maxItems: 128 }),
    unavailableMcpServerIds: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 128 }),
  },
  { additionalProperties: false },
);

export type WorkRuntimeIdentity = Type.Static<typeof WorkRuntimeIdentitySchema>;
export type WorkReadiness = Type.Static<typeof WorkReadinessSchema>;
