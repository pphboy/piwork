import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SkillArtifactStore } from "./skill-artifact-store.js";

test("SkillArtifactStore copies complete trees, publishes atomically and deduplicates identical content", () => withFixture(({ source, managed }) => {
  const store = new SkillArtifactStore(managed);
  const first = store.import(source);
  rmSync(source, { recursive: true });
  assert.equal(readFileSync(join(first.directory, "SKILL.md"), "utf8"), "opaque malformed --- [");
  assert.equal(readFileSync(join(first.directory, "references", "guide.txt"), "utf8"), "supporting file");
  mkdirSync(source, { recursive: true });
  mkdirSync(join(source, "references"));
  writeFileSync(join(source, "SKILL.md"), "opaque malformed --- [");
  writeFileSync(join(source, "references", "guide.txt"), "supporting file");
  const second = store.import(source);
  assert.equal(second.directory, first.directory);
  assert.deepEqual(readdirSync(store.stagingDirectory), []);
}));

for (const step of ["read", "copy", "hash", "rename"] as const) {
  test(`SkillArtifactStore cleans staging after injected ${step} failure`, () => withFixture(({ source, managed }) => {
    let failed = false;
    const store = new SkillArtifactStore(managed, (current) => {
      if (!failed && current === step) { failed = true; throw new Error(`injected ${step}`); }
    });
    assert.throws(() => store.import(source), new RegExp(`injected ${step}`));
    assert.deepEqual(readdirSync(store.stagingDirectory), []);
    const publicEntries = readdirSync(managed).filter((name) => name !== ".staging");
    assert.deepEqual(publicEntries, step === "rename" ? ["code-review"] : []);
    if (step === "rename") assert.deepEqual(readdirSync(join(managed, "code-review", "artifacts")), []);
  }));
}

function withFixture(run: (fixture: { source: string; managed: string }) => void): void {
  const root = mkdtempSync(join(tmpdir(), "piwork-artifact-"));
  try {
    const source = join(root, "code-review");
    const managed = join(root, "managed");
    mkdirSync(join(source, "references"), { recursive: true });
    writeFileSync(join(source, "SKILL.md"), "opaque malformed --- [");
    writeFileSync(join(source, "references", "guide.txt"), "supporting file");
    run({ source, managed });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
