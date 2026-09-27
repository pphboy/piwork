import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import test from "node:test";
import * as yazl from "yazl";
import { extractPiPackageZip, inspectPiPackageZip } from "./zip.js";

async function createZip(path: string, entries: Array<{ path: string; bytes?: string; mode?: number }>): Promise<void> {
  const zip = new yazl.ZipFile();
  for (const entry of entries) {
    if (entry.path.endsWith("/")) zip.addEmptyDirectory(entry.path, { mode: entry.mode ?? 0o40755 });
    else zip.addBuffer(Buffer.from(entry.bytes ?? ""), entry.path, { mode: entry.mode ?? 0o100644 });
  }
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(path));
}

test("single-root and one-wrapper ZIPs extract a valid manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-package-zip-"));
  try {
    for (const prefix of ["", "wrapper/"]) {
      const zipPath = join(root, prefix ? "wrapper.zip" : "root.zip");
      await createZip(zipPath, [
        { path: `${prefix}package.json`, bytes: '{"name":"example-tools","version":"1.0.0"}' },
        { path: `${prefix}bin/tool.js`, bytes: "module.exports = 1", mode: 0o104755 },
        { path: `${prefix}node_modules/.bin/tool`, bytes: "../../bin/tool.js", mode: 0o120777 },
      ]);
      const output = join(root, prefix ? "wrapper" : "direct");
      const result = await extractPiPackageZip(zipPath, output);
      assert.equal(result.manifest.name, "example-tools");
      assert.equal((await readFile(join(output, "bin/tool.js"), "utf8")), "module.exports = 1");
      assert.equal((await lstat(join(output, "bin/tool.js"))).mode & 0o111, 0o111);
      assert.equal((await lstat(join(output, "bin/tool.js"))).mode & 0o6000, 0);
      assert.equal(result.inspection.entries.some((entry) => entry.type === "symlink"), true);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("ZIP inspection rejects encrypted, special, truncated and oversized entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-package-corrupt-zip-"));
  try {
    const original = join(root, "valid.zip");
    await createZip(original, [{ path: "package.json", bytes: '{"name":"tools"}' }, { path: "file.txt", bytes: "hello" }]);
    const base = await readFile(original);
    const firstCentral = base.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    assert.ok(firstCentral >= 0);
    const encrypted = Buffer.from(base);
    encrypted.writeUInt16LE(encrypted.readUInt16LE(firstCentral + 8) | 1, firstCentral + 8);
    const encryptedPath = join(root, "encrypted.zip");
    await writeFile(encryptedPath, encrypted);
    await assert.rejects(inspectPiPackageZip(encryptedPath), /encrypted/);
    const device = Buffer.from(base);
    device.writeUInt32LE(0o020666 << 16, firstCentral + 38);
    const devicePath = join(root, "device.zip");
    await writeFile(devicePath, device);
    await assert.rejects(inspectPiPackageZip(devicePath), /special file/);
    const huge = Buffer.from(base);
    huge.writeUInt32LE(65 * 1024 * 1024, firstCentral + 24);
    const hugePath = join(root, "huge.zip");
    await writeFile(hugePath, huge);
    await assert.rejects(inspectPiPackageZip(hugePath), /64 MiB/);
    const truncatedPath = join(root, "truncated.zip");
    await writeFile(truncatedPath, base.subarray(0, base.length - 10));
    await assert.rejects(inspectPiPackageZip(truncatedPath));
    const traversal = Buffer.from(base);
    let cursor = firstCentral;
    while (cursor >= 0) {
      const nameLength = traversal.readUInt16LE(cursor + 28);
      const name = traversal.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
      if (name === "file.txt") {
        traversal.set(Buffer.from("../e.txt"), cursor + 46);
        break;
      }
      cursor = traversal.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), cursor + 4);
    }
    const traversalPath = join(root, "traversal.zip");
    await writeFile(traversalPath, traversal);
    await assert.rejects(inspectPiPackageZip(traversalPath));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("aggregate ZIP expansion is capped even when each entry is within the file limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-package-bomb-"));
  try {
    const zip = join(root, "small.zip");
    await createZip(zip, [
      { path: "package.json", bytes: '{"name":"tools"}' },
      ...Array.from({ length: 17 }, (_, index) => ({ path: `f${index.toString().padStart(2, "0")}`, bytes: "x" })),
    ]);
    const forged = Buffer.from(await readFile(zip));
    let cursor = forged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    while (cursor >= 0) {
      const nameLength = forged.readUInt16LE(cursor + 28);
      const name = forged.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
      if (name.startsWith("f")) forged.writeUInt32LE(64 * 1024 * 1024, cursor + 24);
      cursor = forged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), cursor + 4);
    }
    const bomb = join(root, "bomb.zip");
    await writeFile(bomb, forged);
    await assert.rejects(inspectPiPackageZip(bomb), /1 GiB/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("cyclic symlinks are rejected before the package root is published", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-package-cycle-zip-"));
  try {
    const zip = join(root, "cycle.zip");
    await createZip(zip, [
      { path: "package.json", bytes: '{"name":"tools"}' },
      { path: "a", bytes: "b", mode: 0o120777 },
      { path: "b", bytes: "a", mode: 0o120777 },
    ]);
    const output = join(root, "published");
    await assert.rejects(extractPiPackageZip(zip, output), /cyclic symlink/);
    await assert.rejects(lstat(output), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("ambiguous roots, duplicates and escaping links are rejected without publishing", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-package-bad-zip-"));
  try {
    const two = join(root, "two.zip");
    await createZip(two, [{ path: "a/package.json", bytes: '{"name":"a"}' }, { path: "b/package.json", bytes: '{"name":"b"}' }]);
    await assert.rejects(inspectPiPackageZip(two), /one package root/);
    const link = join(root, "link.zip");
    await createZip(link, [{ path: "package.json", bytes: '{"name":"a"}' }, { path: "outside", bytes: "../outside", mode: 0o120777 }]);
    await assert.rejects(extractPiPackageZip(link, join(root, "output")), /leaves package root/);
    const duplicated = join(root, "duplicate.zip");
    await createZip(duplicated, [{ path: "package.json", bytes: '{"name":"a"}' }, { path: "file", bytes: "a" }, { path: "file", bytes: "b" }]);
    await assert.rejects(inspectPiPackageZip(duplicated), /duplicate/);
    const changed = Buffer.from(await readFile(two));
    const marker = Buffer.from("a/package.json");
    const at = changed.indexOf(marker);
    assert.ok(at >= 0);
    changed.set(Buffer.from("../ackage.jso"), at);
    const traversal = join(root, "traversal.zip");
    await writeFile(traversal, changed);
    await assert.rejects(inspectPiPackageZip(traversal));
  } finally { await rm(root, { recursive: true, force: true }); }
});
