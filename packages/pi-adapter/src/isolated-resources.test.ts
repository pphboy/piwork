import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertConfiguredSkillDirectory, SkillDirectoryMismatchError, loadConfiguredIsolatedSkills } from "./isolated-resources.js";

test("SDK Skill directory identity rejects global, other Work and pending resource metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-sdk-skill-directory-"));
  try {
    for (const dir of ["active/alpha", "global/alpha", "other-work/alpha", "pending/alpha"]) {
      await mkdir(join(root, dir), { recursive: true });
      await writeFile(join(root, dir, "SKILL.md"), "---\nname: alpha\ndescription: Captured Skill.\n---\nInstructions.\n");
    }
    const directory = join(root, "active/alpha"), manifest = join(directory, "SKILL.md");
    assertConfiguredSkillDirectory({ baseDir: directory, filePath: manifest }, directory, manifest);
    for (const dir of ["global/alpha", "other-work/alpha", "pending/alpha"]) {
      for (const candidate of [{ baseDir: join(root, dir), filePath: manifest },
        { baseDir: directory, filePath: join(root, dir, "SKILL.md") }]) {
        assert.throws(() => assertConfiguredSkillDirectory(candidate, directory, manifest),
          (error: unknown) => error instanceof SkillDirectoryMismatchError && error.code === "SKILL_DIRECTORY_MISMATCH");
      }
    }
    const active = loadConfiguredIsolatedSkills(join(root, "active"), ["alpha"]);
    assert.equal(active.skills.length, 1);
    assert.equal(active.skills[0]?.filePath, manifest);
    assert.throws(() => loadConfiguredIsolatedSkills(join(root, "active"), ["../pending/alpha"]), SkillDirectoryMismatchError);
  } finally { await rm(root, { recursive: true, force: true }); }
});
