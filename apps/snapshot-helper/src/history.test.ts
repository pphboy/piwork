import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { WorkStore } from "@piwork/work-store";
import { encodeWorkPackage, encodeWorkJson } from "@piwork/work-package";
import { goldenWorkFixture } from "../../../packages/work-package/dist/fixture.js";
import { verifyUploadedPackage } from "./history.js";

const exec = promisify(execFile), NOW = "2026-09-23T00:00:00.000Z";
async function fixture(change?: string) {
  const root = await mkdtemp(join(tmpdir(), "piwork-helper-history-")), volume = join(root, "private"), blobs = join(root, "capture"), upload = join(root, "upload");
  await Promise.all([mkdir(join(volume, "sessions"), { recursive: true }), mkdir(blobs), mkdir(upload)]);
  const work = WorkStore.open(join(volume, "work.sqlite"));
  await writeFile(join(volume, "sessions", "one.jsonl"), 'SDK body is opaque, even if it contains work-000000000001\n');
  work.createSession({ workId: "work-000000000001", sessionId: "session-local", sdkHistoryPath: "/var/data/sessions/one.jsonl", contextIdentity: "context-000000000001", createdAt: NOW, updatedAt: NOW });
  const run = work.acceptRun({ workId: "work-000000000001", sessionId: "session-local", submissionKey: "key", requestDigest: "digest", promptDigest: "digest", now: NOW });
  work.completeRun(run.run.runId, "succeeded", "original text", null, NOW);
  try {
    if (change) { const database = new DatabaseSync(join(volume, "work.sqlite")); try { database.exec(change); } finally { database.close(); } }
    const worker = fileURLToPath(new URL("../filesystem.py", import.meta.url));
    const captured = JSON.parse((await exec("python3", [worker, "capture", volume, blobs], { env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1" } })).stdout) as { tree: string };
    const value = goldenWorkFixture();
    value.spec.volumes[0].tree = captured.tree;
    for (const name of await readdir(blobs)) {
      assert.match(name, /^[a-f0-9]{64}$/); const bytes = await readFile(join(blobs, name));
      if (!value.data.has(name)) { value.data.set(name, bytes); value.spec.blobs.push({ digest: name, size: bytes.length, kinds: [name === captured.tree ? "tree" : "file"] }); }
    }
    value.spec.blobs.sort((a, b) => a.digest.localeCompare(b.digest));
    const chunks: Buffer[] = [];
    for await (const chunk of encodeWorkPackage(value.spec, async function* (blob) { yield value.data.get(blob.digest)!; })) chunks.push(Buffer.from(chunk));
    await writeFile(join(upload, "package.work"), Buffer.concat(chunks), { mode: 0o600 });
    return { root, upload, cleanup: async () => { work.close(); await rm(root, { recursive: true, force: true }); } };
  } catch (error) { work.close(); await rm(root, { recursive: true, force: true }); throw error; }
}

test("upload helper checks original SQLite/WAL and regular SDK paths without interpreting SDK content", async () => {
  const f = await fixture();
  try {
    assert.ok((await readdir(join(f.root, "private"))).includes("work.sqlite-wal"), "source package must contain a live schema-3 WAL");
    const result = await verifyUploadedPackage(f.upload) as { digest: string; size: number; bindingRequirements: unknown };
    assert.match(result.digest, /^[a-f0-9]{64}$/); assert.ok(result.size > 0);
    assert.ok(!JSON.stringify(result).includes("original text"));
    assert.deepEqual((await readdir(f.upload)).sort(), ["blobs", "package.work"]);
  } finally { await f.cleanup(); }
});

test("valid package hashes do not authorize hostile SQLite schema or external SDK history locators", async () => {
  for (const change of ["CREATE VIEW hostile AS SELECT * FROM sessions", "UPDATE sessions SET sdk_history_path = '/etc/passwd'", "UPDATE sessions SET sdk_history_path = '/var/data/sessions/../work.sqlite'"]) {
    const f = await fixture(change);
    try { await assert.rejects(verifyUploadedPackage(f.upload), /SNAPSHOT_HISTORY/); }
    finally { await f.cleanup(); }
  }
});

test("an uninitialized active=null package needs no Work SQLite, but orphan sidecars and active history do", async () => {
  for (const mode of ["empty", "orphan-wal", "active-without-db"] as const) {
    const root = await mkdtemp(join(tmpdir(), "piwork-helper-empty-history-"));
    try {
      const value = goldenWorkFixture();
      if (mode === "active-without-db") value.spec.activeContext = "c-000001";
      if (mode === "orphan-wal") {
        const original = JSON.parse(value.data.get(value.spec.volumes[0].tree)!.toString()) as { version: 1; entries: unknown[] };
        const bytes = Buffer.from("orphan WAL");
        const blob = createHash("sha256").update(bytes).digest("hex"); value.data.set(blob, bytes);
        value.spec.blobs.push({ digest: blob, size: bytes.length, kinds: ["file"] });
        original.entries.push({ type: "file", segmentsBase64: [Buffer.from("work.sqlite-wal").toString("base64")], uid: 10001, gid: 10001, mode: 493,
          mtimeNs: "1727049600123456789", blob, size: bytes.length });
        const treeBytes = encodeWorkJson(original), tree = createHash("sha256").update(treeBytes).digest("hex");
        value.data.set(tree, treeBytes); value.spec.blobs.push({ digest: tree, size: treeBytes.length, kinds: ["tree"] });
        value.spec.volumes[0].tree = tree;
        value.spec.blobs.sort((a, b) => a.digest.localeCompare(b.digest));
      }
      const chunks: Buffer[] = [];
      for await (const chunk of encodeWorkPackage(value.spec, async function* (blob) { yield value.data.get(blob.digest)!; })) chunks.push(Buffer.from(chunk));
      await writeFile(join(root, "package.work"), Buffer.concat(chunks), { mode: 0o600 });
      if (mode === "empty") assert.ok((await verifyUploadedPackage(root)));
      else await assert.rejects(verifyUploadedPackage(root), { code: "SNAPSHOT_HISTORY_INVALID" });
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});
