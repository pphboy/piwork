import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DesktopOperationRecords } from "./operation-records.js";

test("known Operations merge across instances and stay scoped to Core and user", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwork-known-operations-"));
  try {
    const path = join(directory, "client.json");
    const first = new DesktopOperationRecords(path), second = new DesktopOperationRecords(path);
    await Promise.all([
      first.accept("https://core-a.example", "user-a", "Create Work", { operationId: "operation-a", workId: "work-a", token: "never-store" }),
      second.accept("https://core-a.example", "user-a", "Export Work", { operationId: "operation-b", workId: "work-a", snapshotId: "snapshot-b" }),
      second.accept("https://core-b.example", "user-a", "Create Work", { operationId: "operation-c" }),
      first.accept("https://core-a.example", "user-b", "Create Work", { operationId: "operation-d" }),
    ]);
    const known = await first.list("https://core-a.example", "user-a");
    assert.deepEqual(known.map((item) => item.operationId).sort(), ["operation-a", "operation-b"]);
    assert(!JSON.stringify(known).includes("never-store"));
    assert.equal((await second.list("https://core-b.example", "user-a")).length, 1);
    assert.equal((await second.list("https://core-a.example", "user-b")).length, 1);
    await second.hide("https://core-a.example", "user-a", "operation-a");
    assert.deepEqual((await first.list("https://core-a.example", "user-a")).map((item) => item.operationId), ["operation-b"]);
    const files = await readdir(join(directory, "desktop-operations"));
    assert.equal(files.length, 2);
    for (const name of files) assert.equal((await stat(join(directory, "desktop-operations", name))).mode & 0o077, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("confirmed terminal Operations are capped while pending and legacy large files remain readable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwork-operation-retention-"));
  try {
    const path = join(directory, "client.json");
    const first = new DesktopOperationRecords(path), second = new DesktopOperationRecords(path);
    const core = "https://core.example", user = "user-a";
    for (let index = 0; index < 505; index++) {
      const record = index % 2 ? first : second;
      const operationId = `operation-${String(index).padStart(4, "0")}`;
      await record.accept(core, user, "Create Work", { operationId });
      await record.markTerminal(core, user, operationId);
    }
    await first.accept(core, user, "Pending Work", { operationId: "operation-pending" });
    const known = await second.list(core, user);
    assert.equal(known.length, 501);
    assert(known.some((item) => item.operationId === "operation-pending"));
    assert(!known.some((item) => item.operationId === "operation-0000"));
    assert(known.some((item) => item.operationId === "operation-0504"));

    const recordDirectory = join(directory, "desktop-operations");
    const compacted = (await readdir(recordDirectory)).filter((name) => name.startsWith("snapshot-"));
    assert.equal(compacted.length, 1, "confirmed old terminal records should be pruned from disk");
    const segments = await readdir(join(recordDirectory, compacted[0]!));
    assert(segments.length > 0);
    for (const name of segments) assert((await stat(join(recordDirectory, compacted[0]!, name))).size <= 8 * 1_048_576);
    await second.accept(core, user, "Pending Work", { operationId: "operation-after-compaction" });
    assert((await first.list(core, user)).some((item) => item.operationId === "operation-after-compaction"));
    await writeFile(join(recordDirectory, ".records.lock"), "99999999", { mode: 0o600 });
    const restarted = new DesktopOperationRecords(path);
    assert((await restarted.list(core, user)).some((item) => item.operationId === "operation-pending"),
      "a new instance should recover pending records after compaction and a crashed writer lock");
    const legacy = join(recordDirectory, `instance-999999-${"a".repeat(24)}.jsonl`);
    const oldRecord = JSON.stringify({ kind: "accepted", coreUrl: core, userId: user,
      operationId: "operation-legacy-pending", type: "Pending Work", recordedAt: "2020-01-01T00:00:00Z", orderedAt: 1 });
    await writeFile(legacy, `${"invalid\n".repeat(2_500_000)}${oldRecord}\n`, { mode: 0o600 });
    assert((await stat(legacy)).size > 16 * 1_048_576);
    assert((await first.list(core, user)).some((item) => item.operationId === "operation-legacy-pending"));
    const outside = join(directory, "outside");
    await writeFile(outside, `${oldRecord}\n`);
    const link = join(recordDirectory, `instance-999999-${"b".repeat(24)}.jsonl`);
    await symlink(outside, link);
    assert.equal((await first.list(core, user)).filter((item) => item.operationId === "operation-legacy-pending").length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
