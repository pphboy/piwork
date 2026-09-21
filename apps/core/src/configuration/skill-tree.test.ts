import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";
import {
  inspectSkillTree,
  SKILL_MAX_FILE_BYTES,
  SKILL_MAX_FILES,
  SkillTreeError,
} from "./skill-tree.js";

test("Skill identity is the normalized directory basename and SKILL.md stays opaque", () => withRoot((root) => {
  const directory = join(root, "code-review");
  mkdirSync(join(directory, "references"), { recursive: true });
  writeFileSync(join(directory, "SKILL.md"), "---\nname: reviewer: [malformed\n---\nopaque\n");
  writeFileSync(join(directory, "references", "guide.txt"), "guide");
  const first = inspectSkillTree(`${directory}/`);
  assert.equal(first.name, "code-review");
  assert.equal(first.fileCount, 2);
  assert.match(first.identity, /^sha256:[a-f0-9]{64}$/);
  const second = inspectSkillTree(directory);
  assert.equal(second.identity, first.identity);
  writeFileSync(join(directory, "references", "guide.txt"), "changed");
  assert.notEqual(inspectSkillTree(directory).identity, first.identity);
}));

test("Skill tree rejects relative paths, invalid names, missing manifest and symlinks", () => withRoot((root) => {
  assertCode(() => inspectSkillTree("relative-skill"), "SKILL_PATH_INVALID");
  for (const name of ["Bad", "bad_name", "-bad", "a".repeat(65)]) {
    const directory = join(root, name);
    mkdirSync(directory);
    writeFileSync(join(directory, "SKILL.md"), "x");
    assertCode(() => inspectSkillTree(directory), "SKILL_NAME_INVALID");
  }
  const missing = join(root, "missing");
  mkdirSync(missing);
  assertCode(() => inspectSkillTree(missing), "SKILL_MANIFEST_MISSING");
  const source = join(root, "source");
  mkdirSync(source); writeFileSync(join(source, "SKILL.md"), "x");
  const rootLink = join(root, "root-link"); symlinkSync(source, rootLink, "dir");
  assertCode(() => inspectSkillTree(rootLink), "SKILL_ROOT_INVALID");
  const nested = join(root, "nested"); mkdirSync(nested); writeFileSync(join(nested, "SKILL.md"), "x");
  symlinkSync(join(source, "SKILL.md"), join(nested, "other"));
  assertCode(() => inspectSkillTree(nested), "SKILL_TREE_UNSAFE");
}));

test("Skill tree enforces file, total and count bounds", () => withRoot((root) => {
  const large = join(root, "large"); mkdirSync(large); writeFileSync(join(large, "SKILL.md"), "x");
  writeFileSync(join(large, "huge.bin"), ""); truncateSync(join(large, "huge.bin"), SKILL_MAX_FILE_BYTES + 1);
  assertCode(() => inspectSkillTree(large), "SKILL_FILE_TOO_LARGE");

  const many = join(root, "many"); mkdirSync(many); writeFileSync(join(many, "SKILL.md"), "x");
  for (let index = 1; index <= SKILL_MAX_FILES; index += 1) writeFileSync(join(many, `f-${index}`), "");
  assertCode(() => inspectSkillTree(many), "SKILL_FILE_LIMIT");

  const total = join(root, "total"); mkdirSync(total); writeFileSync(join(total, "SKILL.md"), "x");
  for (let index = 0; index < 4; index += 1) {
    writeFileSync(join(total, `part-${index}`), ""); truncateSync(join(total, `part-${index}`), SKILL_MAX_FILE_BYTES);
  }
  assertCode(() => inspectSkillTree(total), "SKILL_TREE_TOO_LARGE");
}));

test("Skill tree rejects FIFO and Unix socket entries", async () => {
  await withRootAsync(async (root) => {
    const fifo = join(root, "fifo-skill"); mkdirSync(fifo); writeFileSync(join(fifo, "SKILL.md"), "x");
    const made = spawnSync("mkfifo", [join(fifo, "pipe")]);
    assert.equal(made.status, 0);
    assertCode(() => inspectSkillTree(fifo), "SKILL_TREE_UNSAFE");

    const socket = join(root, "socket-skill"); mkdirSync(socket); writeFileSync(join(socket, "SKILL.md"), "x");
    const server = createServer();
    await new Promise<void>((resolve, reject) => server.listen(join(socket, "channel"), resolve).once("error", reject));
    try { assertCode(() => inspectSkillTree(socket), "SKILL_TREE_UNSAFE"); }
    finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});

function assertCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof SkillTreeError && error.code === code);
}

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "piwork-skill-tree-"));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

async function withRootAsync(run: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "piwork-skill-tree-"));
  try { await run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
