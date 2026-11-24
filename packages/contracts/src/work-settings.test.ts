import assert from "node:assert/strict";
import test from "node:test";
import { Check } from "typebox/value";
import {
  WORK_SETTINGS_LIMITS, WorkSettingsPatchSchema, WorkSettingsReadRequestSchema, workSettingsPatchProblem, workSettingsReadProblem,
} from "./index.js";

const file = (path: string, text = "body", skillName = "code-review") => ({ skillName, path, text });

test("patch omission, explicit empty values and unknown fields keep distinct meaning", () => {
  assert.equal(Check(WorkSettingsPatchSchema, {}), true);
  assert.equal(workSettingsPatchProblem({}), "empty");
  assert.equal(workSettingsPatchProblem({ addSkills: [] }), "empty");
  assert.equal(workSettingsPatchProblem({ removeSkills: [] }), "empty");
  assert.equal(workSettingsPatchProblem({ skillFiles: [] }), "empty");
  assert.equal(workSettingsPatchProblem({ packageFlags: [] }), "empty");
  assert.equal(workSettingsPatchProblem({ agentsMd: "" }), null);
  assert.equal(workSettingsPatchProblem({ removeSkills: ["code-review"] }), null);
  for (const invalid of [{ addSkills: null }, { agentsMd: null }, { addSkills: "code-review" }, { unknown: true }, { packageFlags: [{ name: "pkg", enabled: 1 }] }]) {
    assert.equal(Check(WorkSettingsPatchSchema, invalid), false, JSON.stringify(invalid));
  }
});

test("patch rejects duplicate and conflicting targets", () => {
  assert.equal(Check(WorkSettingsPatchSchema, { addSkills: ["code-review", "code-review"] }), false);
  assert.equal(workSettingsPatchProblem({ addSkills: ["code-review"], removeSkills: ["code-review"] }), "conflict:code-review");
  assert.equal(workSettingsPatchProblem({ skillFiles: [file("SKILL.md"), file("SKILL.md", "changed")] }), "duplicate:code-review");
  assert.equal(workSettingsPatchProblem({ removeSkills: ["code-review"], skillFiles: [file("SKILL.md")] }), "removed:code-review");
  assert.equal(workSettingsPatchProblem({ skillFiles: [file("SKILL.md", "one"), file("SKILL.md", "two", "other-skill")] }), null);
});

test("read requests and patch edits reject unsafe relative paths", () => {
  for (const path of ["/etc/passwd", "../secret", "references/../SKILL.md", "references//SKILL.md", "references\\SKILL.md", "a\u0000b", ""]) {
    assert.equal(Check(WorkSettingsPatchSchema, { skillFiles: [file(path)] }), false, path);
    assert.equal(Check(WorkSettingsReadRequestSchema, { files: [{ skillName: "code-review", path }] }), false, path);
  }
  for (const path of ["SKILL.md", "references/checklist.md", ".pi/config.json", "资料/说明.md"]) {
    assert.equal(Check(WorkSettingsPatchSchema, { skillFiles: [file(path)] }), true, path);
  }
  assert.equal(workSettingsReadProblem({ files: [{ skillName: "code-review", path: "SKILL.md" }, { skillName: "code-review", path: "SKILL.md" }] }), "duplicate:code-review");
  assert.equal(workSettingsReadProblem({ skillName: "code-review", files: [{ skillName: "other", path: "SKILL.md" }] }), null);
});

test("text and encoded request budgets are bounded independently", () => {
  const max = WORK_SETTINGS_LIMITS.fileTextBytes;
  assert.equal(workSettingsPatchProblem({ skillFiles: [file("SKILL.md", "a".repeat(max))] }), null);
  assert.equal(workSettingsPatchProblem({ skillFiles: [file("SKILL.md", "a".repeat(max + 1))] }), "invalid");
  assert.equal(workSettingsPatchProblem({ agentsMd: "a".repeat(WORK_SETTINGS_LIMITS.agentsMdBytes + 1) }), "invalid");
  const half = "a".repeat(max);
  assert.equal(workSettingsPatchProblem({ skillFiles: [file("SKILL.md", half), file("a.md", half), file("b.md", half)] }), "too-large:request");
  assert.equal(workSettingsPatchProblem({ skillFiles: [file("SKILL.md", "中".repeat(Math.ceil(max / 3)))] }), "too-large:code-review");
});

test("read accepts explicit file selections and empty reads", () => {
  assert.equal(Check(WorkSettingsReadRequestSchema, {}), true);
  assert.equal(Check(WorkSettingsReadRequestSchema, { skillName: "code-review" }), true);
  assert.equal(Check(WorkSettingsReadRequestSchema, { files: [{ skillName: "code-review", path: "SKILL.md" }] }), true);
  assert.equal(Check(WorkSettingsReadRequestSchema, { files: Array.from({ length: WORK_SETTINGS_LIMITS.maxFilesPerRequest + 1 }, () => ({ skillName: "code-review", path: "SKILL.md" })) }), false);
});
