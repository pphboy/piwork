import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, writeFile, readFile, lstat, link, symlink, readlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";

const exec = promisify(execFile);
const worker = fileURLToPath(new URL("../filesystem.py", import.meta.url));
test("filesystem worker rejects xattrs, ACLs, devices, I/O failures and changing files", async () => {
  const suite = fileURLToPath(new URL("../filesystem_test.py", import.meta.url));
  await exec("python3", [suite], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
});
async function sandbox() {
  const directory = await mkdtemp(join(tmpdir(), "piwork-filesystem-test-"));
  const source = join(directory, "source"), target = join(directory, "target"), spool = join(directory, "spool");
  await Promise.all([mkdir(source), mkdir(target), mkdir(spool)]);
  return { directory, source, target, spool };
}
test("whole tree copy preserves files, modes, nanoseconds, links, byte names and hidden private data", async () => {
  const paths = await sandbox();
  try {
    await mkdir(join(paths.source, "workspace"));
    await mkdir(join(paths.source, "empty"));
    await writeFile(join(paths.source, "workspace", "under-mount"), "private underlying bytes");
    await writeFile(join(paths.source, ".env"), "TOKEN=private", { mode: 0o751 });
    await link(join(paths.source, ".env"), join(paths.source, "hardlink"));
    await symlink("/etc/does-not-exist", join(paths.source, "outside"));
    const bytePath = Buffer.concat([Buffer.from(paths.source + "/"), Buffer.from([255])]);
    await writeFile(bytePath, "non-utf8");
    const before = await lstat(join(paths.source, ".env"), { bigint: true });
    const capture = JSON.parse((await exec("python3", [worker, "capture", paths.source, paths.spool])).stdout) as { tree: string };
    await exec("python3", [worker, "restore", paths.target, paths.spool, capture.tree]);
    assert.equal(await readFile(join(paths.target, ".env"), "utf8"), "TOKEN=private");
    assert.equal(await readFile(join(paths.target, "workspace", "under-mount"), "utf8"), "private underlying bytes");
    assert.equal(await readFile(Buffer.concat([Buffer.from(paths.target + "/"), Buffer.from([255])]), "utf8"), "non-utf8");
    assert.equal(await readlink(join(paths.target, "outside")), "/etc/does-not-exist");
    const after = await lstat(join(paths.target, ".env"), { bigint: true });
    assert.equal(after.mode, before.mode); assert.equal(after.uid, before.uid); assert.equal(after.gid, before.gid); assert.equal(after.mtimeNs, before.mtimeNs);
    assert.equal(after.ino, (await lstat(join(paths.target, "hardlink"), { bigint: true })).ino);
    assert.deepEqual(await lstat(join(paths.source, ".env"), { bigint: true }).then((value) => [value.mtimeNs, value.ctimeNs, value.mode]), [before.mtimeNs, before.ctimeNs, before.mode]);
    assert.ok((await lstat(join(paths.target, "empty"))).isDirectory());
    await assert.rejects(exec("python3", [worker, "restore", paths.target, paths.spool, capture.tree]));
  } finally { await rm(paths.directory, { recursive: true, force: true }); }
});
test("FIFO and socket fail the complete capture, never disappear silently", async () => {
  const paths = await sandbox(); const server = createServer();
  try {
    await exec("mkfifo", [join(paths.source, "fifo")]);
    await assert.rejects(exec("python3", [worker, "capture", paths.source, paths.spool]), (error: unknown) => (error as { stderr: string }).stderr.includes("SNAPSHOT_STORAGE_UNSUPPORTED"));
    await rm(join(paths.source, "fifo"));
    await new Promise<void>((resolve) => server.listen(join(paths.source, "socket"), resolve));
    await assert.rejects(exec("python3", [worker, "capture", paths.source, paths.spool]), (error: unknown) => (error as { stderr: string }).stderr.includes("SNAPSHOT_STORAGE_UNSUPPORTED"));
  } finally { if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve())); await rm(paths.directory, { recursive: true, force: true }); }
});
