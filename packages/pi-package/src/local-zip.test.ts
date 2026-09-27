import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { packPiPackageDirectory } from "./local-zip.js";
import { extractPiPackageZip } from "./zip.js";

test("local directory packs to a bounded ZIP preserving an internal link and executable file", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-package-local-"));
  try {
    const source = join(root, "source");
    await mkdir(join(source, "bin"), { recursive: true });
    await mkdir(join(source, "node_modules", ".bin"), { recursive: true });
    await writeFile(join(source, "package.json"), '{"name":"tools","pi":{"extensions":["bin/tool.js"]}}');
    await writeFile(join(source, "bin", "tool.js"), "export default 1");
    await chmod(join(source, "bin", "tool.js"), 0o755);
    await symlink("../../bin/tool.js", join(source, "node_modules", ".bin", "tool"));
    const zip = join(root, "package.zip");
    const packed = await packPiPackageDirectory(source, zip);
    assert.equal(packed.manifest.name, "tools");
    assert.deepEqual(packed.resourceCounts, { extensions: 1, skills: 0, prompts: 0, themes: 0 });
    assert.match(packed.digest, /^[a-f0-9]{64}$/);
    const output = join(root, "unpacked");
    await extractPiPackageZip(zip, output);
    assert.equal(await readFile(join(output, "node_modules", ".bin", "tool"), "utf8"), "export default 1");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("local packaging rejects a link that escapes the client package root", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-package-local-escape-"));
  try {
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(join(source, "package.json"), '{"name":"tools"}');
    await writeFile(join(root, "secret.txt"), "outside");
    await symlink("../secret.txt", join(source, "secret.txt"));
    await assert.rejects(packPiPackageDirectory(source, join(root, "package.zip")), /leaves root/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
