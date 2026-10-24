import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, appendFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { initializePersistentSession, appendUserMessage, appendAssistantMessage, readPersistentSession } from "./session-persistence.js";
import { SessionHistoryIndex } from "./history-index.js";

test("indexed SDK history preserves the whole-tree public projection without rescanning hot pages", () => {
  const root = mkdtempSync(join(tmpdir(), "history-index-")); mkdirSync(join(root, "workspace"));
  try {
    const initial = initializePersistentSession({ cwd: join(root, "workspace"), sessionRoot: join(root, "sessions") });
    const sdk = SessionManager.open(initial.getSessionFile()!, join(root, "sessions"), join(root, "workspace"));
    const legacy = appendUserMessage(sdk, "legacy");
    sdk.appendCustomEntry("piwork-run", { runId: "run-1" });
    appendUserMessage(sdk, '<skill name="one" location="/private">\nReferences are relative to /private\nhello');
    appendAssistantMessage(sdk, "汉😀".repeat(600000));
    sdk.branch(legacy); appendAssistantMessage(sdk, "other branch");
    const path = sdk.getSessionFile()!, original = readFileSync(path);
    const index = new SessionHistoryIndex(path, sdk.getSessionId()), snapshot = index.snapshot();
    assert.deepEqual(snapshot.entries.map(ref => snapshot.read(ref)), readPersistentSession(sdk).entries);
    index.snapshot(); index.snapshot(); assert.equal(index.scans, 1);
    appendAssistantMessage(sdk, "appended"); const next = index.snapshot();
    assert.equal(next.entries.length, snapshot.entries.length + 1);
    assert.equal(snapshot.entries.length, 4); assert.equal(index.scans, 2);
    appendFileSync(path, '{"uncommitted":');
    assert.equal(index.snapshot().entries.length, next.entries.length);
    assert.deepEqual(readFileSync(path).subarray(0, original.length), original);
    writeFileSync(path, '{"type":"session","version":3,"id":"other"}\n');
    assert.throws(() => snapshot.read(snapshot.entries[0]!), /source changed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a complete malformed record is an explicit history failure", () => {
  const root = mkdtempSync(join(tmpdir(), "history-corrupt-"));
  try { const path = join(root, "history.jsonl"); writeFileSync(path, '{"type":"session","version":3,"id":"s"}\n{broken}\n');
    assert.throws(() => new SessionHistoryIndex(path, "s").snapshot(), /could not be verified/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
