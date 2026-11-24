import test from "node:test";
import assert from "node:assert/strict";
import { Check } from "typebox/value";
import {
  AdminSkillFileEntrySchema,
  AdminSkillFileListSchema,
  AdminSkillFileSaveSchema,
  AdminSkillFileSavedSchema,
  AdminSkillFileSchema,
  SKILL_CONTENT_LIMITS,
} from "./skill-content.js";

const version = `file-sha256:${"a".repeat(64)}`;

test("Skill content readers carry only relative path, text and opaque version", () => {
  assert.equal(Check(AdminSkillFileListSchema, { files: [{ path: "SKILL.md", size: 12 }, { path: "references/rules.md", size: 0 }] }), true);
  assert.equal(Check(AdminSkillFileSchema, { path: "references/rules.md", content: "# 规则\n", version }), true);
  assert.equal(Check(AdminSkillFileEntrySchema, { path: "SKILL.md", size: SKILL_CONTENT_LIMITS.fileBytes }), true);
  for (const invalid of [
    { files: [{ path: "/SKILL.md", size: 1 }] },
    { files: [{ path: "a\\b.md", size: 1 }] },
    { files: [{ path: "a\u0000b.md", size: 1 }] },
    { files: [{ path: "SKILL.md", size: SKILL_CONTENT_LIMITS.fileBytes + 1 }] },
    { files: [{ path: "SKILL.md", size: 1, digest: "sha256:private" }] },
  ]) assert.equal(Check(AdminSkillFileListSchema, invalid), false);
  assert.equal(Check(AdminSkillFileSchema, { path: "SKILL.md", content: "text", version, artifactDigest: "sha256:private" }), false);
  assert.equal(Check(AdminSkillFileSchema, { path: "SKILL.md", content: "text" }), false);
});

test("Skill file saves require an existing-file version and return only path and version", () => {
  assert.equal(Check(AdminSkillFileSaveSchema, { path: "SKILL.md", content: "updated", expectedVersion: version }), true);
  assert.equal(Check(AdminSkillFileSavedSchema, { path: "SKILL.md", version }), true);
  for (const invalid of [
    { path: "SKILL.md", content: "updated" },
    { path: "SKILL.md", content: "updated", expectedVersion: "" },
    { path: "", content: "updated", expectedVersion: version },
    { path: "SKILL.md", content: "updated", expectedVersion: version, name: "other-skill" },
  ]) assert.equal(Check(AdminSkillFileSaveSchema, invalid), false);
  assert.equal(Check(AdminSkillFileSavedSchema, { path: "SKILL.md", version, content: "private" }), false);
});
