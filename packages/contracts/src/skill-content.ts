import { Type } from "typebox";

// Admin-only Skill content wire contract. The relative path and UTF-8 content
// limits are enforced by Core against decoded bytes; these schemas only bound
// the wire shape and keep the file version opaque to clients.
export const SKILL_CONTENT_LIMITS = Object.freeze({
  pathBytes: 4096,
  pathSegments: 64,
  fileBytes: 8 << 20,
  totalBytes: 32 << 20,
});

const strict = { additionalProperties: false } as const;
const relativePath = Type.String({
  minLength: 1,
  maxLength: SKILL_CONTENT_LIMITS.pathBytes,
  pattern: "^[^/\\\\\\x00-\\x1f\\x7f][^\\\\\\x00-\\x1f\\x7f]*$",
});
const fileVersion = Type.String({ minLength: 1, maxLength: 128 });
const fileContent = Type.String({ maxLength: 64 << 20 });

export const AdminSkillFileEntrySchema = Type.Object({
  path: relativePath,
  size: Type.Integer({ minimum: 0, maximum: SKILL_CONTENT_LIMITS.fileBytes }),
}, strict);

export const AdminSkillFileListSchema = Type.Object({
  files: Type.Array(AdminSkillFileEntrySchema, { maxItems: 2048 }),
}, strict);

export const AdminSkillFileSchema = Type.Object({
  path: relativePath,
  content: fileContent,
  version: fileVersion,
}, strict);

export const AdminSkillFileSaveSchema = Type.Object({
  path: relativePath,
  content: fileContent,
  expectedVersion: fileVersion,
}, strict);

export const AdminSkillFileSavedSchema = Type.Object({
  path: relativePath,
  version: fileVersion,
}, strict);
