import { Type } from "typebox";
import { Check } from "typebox/value";
import { ResourceIdSchema } from "./harness.js";

export const WORK_SETTINGS_CONTRACT_VERSION = 1;
export const WORK_SETTINGS_LIMITS = Object.freeze({
  requestBytes: 2 * 1024 * 1024,
  fileTextBytes: 1024 * 1024,
  agentsMdBytes: 256 * 1024,
  maxFilesPerRequest: 64,
  maxSkillFiles: 2048,
});

const strict = { additionalProperties: false } as const;
const skillName = Type.String({ minLength: 1, maxLength: 64, pattern: "^[a-z0-9][a-z0-9-]{0,63}$" });
const packageName = Type.String({ minLength: 1, maxLength: 214, pattern: "^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$" });
// Relative Skill paths only: no absolute roots, backslashes, empty segments,
// control characters or "."/".." segments. Duplicate targets are rejected by
// the shared request validators below and independently by Core.
const pathSegment = /(?:(?:[^./\\\x00-\x1f][^/\\\x00-\x1f]*)|\.(?:[^./\\\x00-\x1f][^/\\\x00-\x1f]*)?)/.source;
const pathPattern = `^(?:${pathSegment})(?:/${pathSegment})*$`;
const skillPath = Type.String({ minLength: 1, maxLength: 1024, pattern: pathPattern });

export const WorkSettingsSkillSelectionSchema = Type.Array(skillName, { maxItems: 128, uniqueItems: true });
const packageFlag = Type.Object({
  name: packageName,
  enabled: Type.Boolean(),
}, strict);
const fileText = Type.Object({
  skillName,
  path: skillPath,
  text: Type.String({ maxLength: WORK_SETTINGS_LIMITS.fileTextBytes }),
}, strict);
export const WorkSettingsFactsSchema = Type.Object({
  skills: WorkSettingsSkillSelectionSchema,
  packages: Type.Array(packageFlag, { maxItems: 64, uniqueItems: true }),
  agentsMd: Type.String({ maxLength: WORK_SETTINGS_LIMITS.agentsMdBytes }),
}, strict);
export const WorkSettingsStateSchema = Type.Object({
  workId: ResourceIdSchema,
  desired: WorkSettingsFactsSchema,
  active: Type.Union([WorkSettingsFactsSchema, Type.Null()]),
  pendingApply: Type.Boolean(),
}, strict);
export const WorkSettingsSkillFileSchema = Type.Object({
  skillName,
  path: skillPath,
  size: Type.Integer({ minimum: 0, maximum: 8 * 1024 * 1024 }),
  editable: Type.Boolean(),
  reason: Type.Union([Type.Null(), Type.Literal("binary"), Type.Literal("invalid-utf8"), Type.Literal("too-large")]),
}, strict);
export const WorkSettingsFileTextSchema = fileText;
export const WorkSettingsReadRequestSchema = Type.Object({
  skillName: Type.Optional(skillName),
  files: Type.Optional(Type.Array(Type.Object({ skillName, path: skillPath }, strict), { maxItems: WORK_SETTINGS_LIMITS.maxFilesPerRequest })),
}, strict);
export const WorkSettingsReadResponseSchema = Type.Object({
  workId: ResourceIdSchema,
  desired: WorkSettingsFactsSchema,
  active: Type.Union([WorkSettingsFactsSchema, Type.Null()]),
  pendingApply: Type.Boolean(),
  skillFiles: Type.Array(WorkSettingsSkillFileSchema, { maxItems: WORK_SETTINGS_LIMITS.maxSkillFiles }),
  files: Type.Array(WorkSettingsFileTextSchema, { maxItems: WORK_SETTINGS_LIMITS.maxFilesPerRequest }),
}, strict);
export const WorkSettingsPatchSchema = Type.Object({
  addSkills: Type.Optional(WorkSettingsSkillSelectionSchema),
  removeSkills: Type.Optional(WorkSettingsSkillSelectionSchema),
  skillFiles: Type.Optional(Type.Array(fileText, { maxItems: WORK_SETTINGS_LIMITS.maxFilesPerRequest })),
  agentsMd: Type.Optional(Type.String({ maxLength: WORK_SETTINGS_LIMITS.agentsMdBytes })),
  packageFlags: Type.Optional(Type.Array(packageFlag, { maxItems: 64, uniqueItems: true })),
}, strict);

export type WorkSettingsFacts = Type.Static<typeof WorkSettingsFactsSchema>;
export type WorkSettingsState = Type.Static<typeof WorkSettingsStateSchema>;
export type WorkSettingsSkillFile = Type.Static<typeof WorkSettingsSkillFileSchema>;
export type WorkSettingsFileText = Type.Static<typeof WorkSettingsFileTextSchema>;
export type WorkSettingsReadRequest = Type.Static<typeof WorkSettingsReadRequestSchema>;
export type WorkSettingsReadResponse = Type.Static<typeof WorkSettingsReadResponseSchema>;
export type WorkSettingsPatch = Type.Static<typeof WorkSettingsPatchSchema>;

const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;

function pathProblem(value: string): boolean {
  return value.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

function fileTargetKey(value: { skillName: string; path: string }): string {
  return `${value.skillName}\u0000${value.path}`;
}

// workSettingsReadProblem mirrors the Core checks that can be decided before
// submission. It never replaces server-side authorization or path validation.
export function workSettingsReadProblem(value: unknown): string | null {
  if (!Check(WorkSettingsReadRequestSchema, value)) return "invalid";
  const files = (value as WorkSettingsReadRequest).files ?? [];
  const seen = new Set<string>();
  for (const file of files) {
    if (pathProblem(file.path)) return `path:${file.skillName}`;
    const key = fileTargetKey(file);
    if (seen.has(key)) return `duplicate:${file.skillName}`;
    seen.add(key);
  }
  return null;
}

// workSettingsPatchProblem checks omission semantics, conflicting targets,
// duplicate file targets and the encoded request budget before submission.
export function workSettingsPatchProblem(value: unknown): string | null {
  if (!Check(WorkSettingsPatchSchema, value)) return "invalid";
  const patch = value as WorkSettingsPatch;
  const adds = patch.addSkills ?? [];
  const removes = new Set(patch.removeSkills ?? []);
  const files = patch.skillFiles ?? [];
  const effective = adds.length > 0 || removes.size > 0 || files.length > 0 ||
    patch.agentsMd !== undefined || (patch.packageFlags ?? []).length > 0;
  if (!effective) return "empty";
  for (const added of adds) {
    if (removes.has(added)) return `conflict:${added}`;
  }
  const seen = new Set<string>();
  for (const file of files) {
    if (removes.has(file.skillName)) return `removed:${file.skillName}`;
    if (pathProblem(file.path)) return `path:${file.skillName}`;
    if (utf8Bytes(file.text) > WORK_SETTINGS_LIMITS.fileTextBytes) return `too-large:${file.skillName}`;
    const key = fileTargetKey(file);
    if (seen.has(key)) return `duplicate:${file.skillName}`;
    seen.add(key);
  }
  if (patch.agentsMd !== undefined && utf8Bytes(patch.agentsMd) > WORK_SETTINGS_LIMITS.agentsMdBytes) return "too-large:agentsMd";
  if (workSettingsRequestBytes(value) > WORK_SETTINGS_LIMITS.requestBytes) return "too-large:request";
  return null;
}

export function workSettingsRequestBytes(value: unknown): number {
  return utf8Bytes(JSON.stringify(value));
}
