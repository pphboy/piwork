import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stagePiPackageUpload } from "./upload.js";

test("local and ZIP inputs use the same staged stream metadata and remove temporary bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-package-upload-"));
  try {
    const source = join(root, "source");
    const scratch = join(root, "scratch");
    await mkdir(source);
    await writeFile(join(source, "package.json"), '{"name":"tools"}');
    const local = await stagePiPackageUpload({ kind: "local", path: source, displayName: "source" }, scratch);
    assert.equal(local.sourceKind, "local");
    assert.equal((await readFile(local.path)).length, local.bytes);
    assert.equal(createHash("sha256").update(await readFile(local.path)).digest("hex"), local.sha256);
    const zipPath = join(root, "saved.zip");
    await writeFile(zipPath, await readFile(local.path));
    await local.cleanup();
    const zip = await stagePiPackageUpload({ kind: "zip", path: zipPath, displayName: "saved.zip" }, scratch);
    assert.equal(zip.sourceKind, "zip");
    assert.equal(zip.sha256, local.sha256);
    await zip.cleanup();
    assert.deepEqual(await readdir(scratch), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an invalid ZIP leaves no upload candidate", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-package-upload-invalid-"));
  try {
    const zipPath = join(root, "invalid.zip");
    const scratch = join(root, "scratch");
    await writeFile(zipPath, "not a zip");
    await assert.rejects(stagePiPackageUpload({ kind: "zip", path: zipPath, displayName: "invalid.zip" }, scratch));
    assert.deepEqual(await readdir(scratch), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
