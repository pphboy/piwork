import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { PersistentSession } from "./session-persistence.js";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "session-process.js");

test("the SDK reloads the same session ID and history in another process", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-sdk-session-"));
  const cwd = join(root, "workspace");
  const sessionRoot = join(root, "sessions");
  await mkdir(cwd, { recursive: true });

  try {
    const created = runFixture(["create", cwd, sessionRoot, "-", "first turn"]);
    const loaded = runFixture(["load", cwd, sessionRoot, created.sessionId, "second turn"]);

    assert.equal(loaded.sessionId, created.sessionId);
    assert.equal(loaded.historyPath, created.historyPath);
    assert.deepEqual(
      loaded.entries.map(({ role, text }) => ({ role, text })),
      [
        { role: "user", text: "first turn" },
        { role: "assistant", text: "ack:first turn" },
        { role: "user", text: "second turn" },
        { role: "assistant", text: "ack:second turn" },
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function runFixture(args: readonly string[]): PersistentSession {
  const result = spawnSync(process.execPath, [fixture, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as PersistentSession;
}
