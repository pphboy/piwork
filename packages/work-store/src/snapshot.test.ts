import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { WorkStore } from "./store.js";
import { WorkHistorySnapshot, WorkHistoryValidationError } from "./snapshot.js";

const NOW = "2026-09-23T00:00:00.000Z", SOURCE = "work-source", CONTEXT = "context-source";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "piwork-history-")); const volume = join(root, "private"); mkdirSync(join(volume, "sessions"), { recursive: true });
  const sdk = Buffer.from('{"type":"session","version":3,"id":"session-local","cwd":"/var/data/workspace"}\n{"type":"message","text":"work-source context-source exact original bytes"}\n');
  writeFileSync(join(volume, "sessions", "one.jsonl"), sdk);
  const business = new DatabaseSync(join(volume, "business.sqlite")); business.exec("CREATE TABLE user_data(value TEXT); INSERT INTO user_data VALUES ('work-source')"); business.close();
  const store = WorkStore.open(join(volume, "work.sqlite"));
  store.createSessionIdempotent({ workId: SOURCE, sessionId: "session-local", sdkHistoryPath: "/var/data/sessions/one.jsonl", createdAt: NOW, updatedAt: NOW, contextIdentity: CONTEXT }, "session-key");
  const accepted = store.acceptRun({ workId: SOURCE, sessionId: "session-local", submissionKey: "submit-key", requestDigest: "request-digest", promptDigest: "prompt-digest", contextIdentity: CONTEXT, now: NOW });
  store.appendEvent(accepted.run.runId, "text", '{ "text": "work-source", "workId": "user text work-source" }', NOW);
  store.completeRun(accepted.run.runId, "succeeded", "work-source context-source", null, NOW);
  return { root, volume, store, sdk, runId: accepted.run.runId, scope: { sourceWorkId: SOURCE, contextIds: new Set([CONTEXT]), scratchDirectory: root }, close: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
}
function fingerprint(volume: string): Map<string, string> {
  return new Map(readdirSync(volume).filter((name) => name.startsWith("work.sqlite") || name === "business.sqlite").map((name) => [name, createHash("sha256").update(readFileSync(join(volume, name))).digest("hex")]));
}
function edit(volume: string, sql: string): void {
  const database = new DatabaseSync(join(volume, "work.sqlite")); try { database.exec(sql); } finally { database.close(); }
}

test("schema3 snapshot reads committed WAL without migration or source mutation", () => {
  const f = fixture();
  try {
    assert.ok(existsSync(join(f.volume, "work.sqlite-wal")));
    const before = fingerprint(f.volume), snapshot = WorkHistorySnapshot.open(f.volume, f.scope);
    assert.ok(snapshot);
    assert.deepEqual(snapshot.summary, { sessions: 1, runs: 1, events: 2 }); snapshot.close(); snapshot.close();
    assert.deepEqual(fingerprint(f.volume), before);
    assert.ok(!readdirSync(f.root).some((name) => name.startsWith("work-history-")));
  } finally { f.close(); }
});

test("rebuild maps only Work/context identities and retains local IDs, idempotency, text, SDK and business DB", () => {
  const f = fixture();
  try {
    const original = fingerprint(f.volume), snapshot = WorkHistorySnapshot.open(f.volume, f.scope); assert.ok(snapshot);
    try {
      for (const targetWork of ["work-target-a", "work-target-b"]) {
        const target = join(f.root, targetWork); cpSync(f.volume, target, { recursive: true });
        snapshot.rebuild(target, targetWork, new Map([[CONTEXT, `context-${targetWork}`]]));
        assert.ok(!existsSync(join(target, "work.sqlite-wal"))); assert.ok(!existsSync(join(target, "work.sqlite-shm")));
        assert.deepEqual(readFileSync(join(target, "sessions", "one.jsonl")), f.sdk);
        assert.deepEqual(readFileSync(join(target, "business.sqlite")), readFileSync(join(f.volume, "business.sqlite")));
        const reopened = WorkStore.open(join(target, "work.sqlite"));
        try {
          assert.equal(reopened.getSession(SOURCE, "session-local"), undefined);
          assert.equal(reopened.getSession(targetWork, "session-local")?.contextIdentity, `context-${targetWork}`);
          const run = reopened.getRun(f.runId); assert.ok(run); assert.equal(run.workId, targetWork); assert.equal(run.contextIdentity, `context-${targetWork}`);
          assert.equal(run.finalText, "work-source context-source");
          assert.equal(reopened.readEvents(f.runId)[0]?.payloadJson, '{ "text": "work-source", "workId": "user text work-source" }');
          assert.equal(reopened.acceptRun({ workId: targetWork, sessionId: "session-local", submissionKey: "submit-key", requestDigest: "request-digest", promptDigest: "prompt-digest" }).reused, true);
          assert.equal(reopened.createSessionIdempotent({ workId: targetWork, sessionId: "ignored", sdkHistoryPath: "ignored", createdAt: NOW, updatedAt: NOW }, "session-key").session.sessionId, "session-local");
        } finally { reopened.close(); }
        const again = WorkHistorySnapshot.open(target, { sourceWorkId: targetWork, contextIds: new Set([`context-${targetWork}`]), scratchDirectory: f.root }); assert.ok(again); again.close();
      }
    } finally { snapshot.close(); }
    assert.deepEqual(fingerprint(f.volume), original);
  } finally { f.close(); }
});

test("offline check refuses trigger, view, virtual table, unknown tables/columns/schema, without repair", () => {
  const cases = [
    "CREATE TRIGGER malicious AFTER INSERT ON sessions BEGIN DELETE FROM runs; END",
    "CREATE VIEW malicious AS SELECT * FROM runs",
    "CREATE VIRTUAL TABLE malicious USING fts5(content)",
    "CREATE TABLE malicious(value TEXT)",
    "ALTER TABLE runs ADD COLUMN unexpected TEXT",
    "UPDATE schema_migrations SET version = 99 WHERE version = 3",
    "DELETE FROM schema_migrations WHERE version = 3",
    "CREATE INDEX unrecognized ON runs(state)",
  ];
  for (const sql of cases) {
    const f = fixture();
    try {
      edit(f.volume, sql); const before = fingerprint(f.volume);
      assert.throws(() => WorkHistorySnapshot.open(f.volume, f.scope), WorkHistoryValidationError);
      assert.deepEqual(fingerprint(f.volume), before);
    } finally { f.close(); }
  }
});

test("offline check refuses foreign references, cross-Work rows, unknown contexts and invalid event sequences", () => {
  for (const sql of [
    "PRAGMA foreign_keys = OFF; UPDATE runs SET session_id = 'missing'",
    "UPDATE submit_idempotency SET work_id = 'another-work'",
    "UPDATE sessions SET active_context_identity = 'missing-context'",
    "UPDATE runs SET context_identity = 'missing-context'",
    "UPDATE runs SET latest_sequence = 10",
    "UPDATE run_events SET sequence = 5 WHERE sequence = 1",
    "UPDATE submit_idempotency SET submission_key = 'mismatched'",
  ]) {
    const f = fixture();
    try { edit(f.volume, sql); assert.throws(() => WorkHistorySnapshot.open(f.volume, f.scope), WorkHistoryValidationError); }
    finally { f.close(); }
  }
});

test("nonterminal Runs and stale work_activity fail quiescence", () => {
  for (const sql of ["UPDATE runs SET state = 'running'", "INSERT INTO work_activity SELECT work_id, run_id, accepted_at FROM runs"]) {
    const f = fixture();
    try {
      edit(f.volume, sql);
      assert.throws(() => WorkHistorySnapshot.open(f.volume, f.scope), (error: unknown) => error instanceof WorkHistoryValidationError && error.code === "SNAPSHOT_HISTORY_BUSY");
    } finally { f.close(); }
  }
});

test("SDK paths cannot escape private sessions or traverse symlinks, and missing files fail", () => {
  for (const path of ["/etc/passwd", "/var/data/workspace/history.jsonl", "/var/data/sessions/../business.sqlite", "/var/data/sessions/link", "/var/data/sessions/linked-dir/one.jsonl", "/var/data/sessions/missing.jsonl"]) {
    const f = fixture();
    try {
      symlinkSync("/etc/passwd", join(f.volume, "sessions", "link")); symlinkSync(join(f.volume, "sessions"), join(f.volume, "sessions", "linked-dir"));
      edit(f.volume, `UPDATE sessions SET sdk_history_path = '${path}'`);
      assert.throws(() => WorkHistorySnapshot.open(f.volume, f.scope), WorkHistoryValidationError);
    } finally { f.close(); }
  }
});

test("new Work without DB is supported, but orphan WAL or linked database is not", () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-empty-history-"));
  const volume = join(root, "private"); mkdirSync(volume);
  const scope = { sourceWorkId: SOURCE, contextIds: new Set<string>(), scratchDirectory: root };
  try {
    assert.equal(WorkHistorySnapshot.open(volume, scope), undefined);
    writeFileSync(join(volume, "work.sqlite-wal"), "orphan");
    assert.throws(() => WorkHistorySnapshot.open(volume, scope), WorkHistoryValidationError);
    symlinkSync("/etc/passwd", join(volume, "work.sqlite"));
    assert.throws(() => WorkHistorySnapshot.open(volume, scope), WorkHistoryValidationError);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
