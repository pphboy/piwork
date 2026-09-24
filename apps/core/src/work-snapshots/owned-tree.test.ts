import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { WorkBlob } from "@piwork/contracts";
import { WorkBlobDirectory, parseWorkJson, validateWorkTree } from "@piwork/work-package";
import { captureOwnedSkillTree } from "./owned-tree.js";

async function readAll(blobs: WorkBlobDirectory, digest: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of blobs.read(digest)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test("owned context Skill tree captures file bytes, empty directories and raw byte names", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-owned-tree-"));
  try {
    const skills = join(root, "skills"), spool = join(root, "blobs"); mkdirSync(skills); mkdirSync(spool);
    mkdirSync(join(skills, "tool")); mkdirSync(join(skills, "tool", "empty"));
    writeFileSync(join(skills, "tool", "SKILL.md"), "retained skill bytes\n");
    writeFileSync(Buffer.concat([Buffer.from(join(skills, "tool") + "/"), Buffer.from([0xff])]), Buffer.from([0, 255, 1]));
    const blobs = new WorkBlobDirectory(spool), captured = await captureOwnedSkillTree(skills, blobs);
    const metadata = await readAll(blobs, captured.digest);
    const tree = parseWorkJson(metadata) as { entries: Array<{ type: string; segmentsBase64: string[]; blob?: string }> };
    assert.equal(tree.entries.length, 5); assert.equal(captured.entries, 5);
    const files = tree.entries.filter((entry) => entry.type === "file");
    const descriptors = new Map<string, WorkBlob>(files.map((entry) => [entry.blob!, { digest: entry.blob!, size: 0, kinds: ["file"] }]));
    for (const [digest, blob] of descriptors) blob.size = (await readAll(blobs, digest)).length;
    descriptors.set(captured.digest, { digest: captured.digest, size: metadata.length, kinds: ["tree"] });
    assert.equal(validateWorkTree(tree, descriptors).tree.entries.length, 5);
    assert.ok(tree.entries.some((entry) => entry.segmentsBase64.at(-1) === Buffer.from([0xff]).toString("base64")));
    let foundRawContent = false;
    for (const entry of files) if (entry.blob && (await readAll(blobs, entry.blob)).equals(Buffer.from([0, 255, 1]))) foundRawContent = true;
    assert.ok(foundRawContent);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("owned Skill capture refuses symlinks rather than dereferencing them", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-owned-tree-"));
  try {
    const skills = join(root, "skills"), spool = join(root, "blobs"); mkdirSync(skills); mkdirSync(spool);
    symlinkSync("/etc/passwd", join(skills, "external"));
    await assert.rejects(captureOwnedSkillTree(skills, new WorkBlobDirectory(spool)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
