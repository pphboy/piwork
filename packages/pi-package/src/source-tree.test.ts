import assert from "node:assert/strict";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validatePiPackageSourceTree } from "./source-tree.js";
import { PI_PACKAGE_LIMITS } from "./zip.js";

test("remote source trees are bounded before dependency installation", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-source-limit-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture-tools", version: "1.0.0",
      dependencies: { "fixture-dependency": "1.0.0" } }));
    assert.equal((await validatePiPackageSourceTree(root)).name, "fixture-tools",
      "a source can be valid before its dependencies are installed");
    const large = join(root, "too-large");
    const descriptor = await open(large, "w");
    try { await descriptor.truncate(PI_PACKAGE_LIMITS.fileBytes + 1); }
    finally { await descriptor.close(); }
    await assert.rejects(validatePiPackageSourceTree(root), (error: unknown) =>
      (error as { code?: string }).code === "PI_PACKAGE_LIMIT_EXCEEDED");
    await rm(large);
    for (let index = 0; index < 17; index++) {
      const file = await open(join(root, `part-${index}`), "w");
      try { await file.truncate(PI_PACKAGE_LIMITS.fileBytes); }
      finally { await file.close(); }
    }
    await assert.rejects(validatePiPackageSourceTree(root), (error: unknown) =>
      (error as { code?: string }).code === "PI_PACKAGE_LIMIT_EXCEEDED");
  } finally { await rm(root, { recursive: true, force: true }); }
});
