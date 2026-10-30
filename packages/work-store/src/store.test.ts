import { WORK_SCHEMA_V5_SQL } from "./schema-v5.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import test from "node:test";
import { CursorExpiredError, DEFAULT_MAX_RUN_EVENTS, SubmitConflictError, WorkBusyError, WORK_SCHEMA_VERSION, WorkStore } from "./store.js";
import { upgradeWorkDatabaseToV6 } from './migrations.js';

const NOW = "2026-09-20T00:00:00Z";

test('schema 5 upgrades to 7 only with a scoped migration grant',async()=>{
 const fixture=await createFixture();
 try {
  let store=WorkStore.open(fixture.databasePath,{workId:'work-1'});store.createSession(session());store.close();makeSchema5(fixture.databasePath);
  const grant={operationId:'operation-test',workId:'work-1',fromSchema:5 as const,toSchema:7 as const,storeId:'backup-test',backupManifestDigest:'a'.repeat(64)};
  assert.throws(()=>WorkStore.open(fixture.databasePath,{workId:'work-1'}),/MIGRATION_REQUIRED/);
  assert.throws(()=>WorkStore.open(fixture.databasePath,{workId:'work-1',historyMigration:{...grant,workId:'foreign'}}),/MIGRATION_REQUIRED/);
  store=WorkStore.open(fixture.databasePath,{workId:'work-1',historyMigration:grant});assert.equal(store.schemaVersion,7);store.close();
  store=WorkStore.open(fixture.databasePath,{workId:'work-1',historyMigration:grant});assert.equal(store.schemaVersion,7);store.close();
 } finally {await fixture.cleanup();}
});

test('schema 7 upgrade refuses active Runs without changing history',async()=>{
 const fixture=await createFixture();
 try {
  const store=WorkStore.open(fixture.databasePath,{workId:'work-1'});store.createSession(session());const run=store.acceptRun(submit({submissionKey:'active-upgrade'})).run;store.close();makeSchema5(fixture.databasePath);
  const grant={operationId:'operation-test',workId:'work-1',fromSchema:5 as const,toSchema:7 as const,storeId:'backup-test',backupManifestDigest:'a'.repeat(64)};
  assert.throws(()=>WorkStore.open(fixture.databasePath,{workId:'work-1',historyMigration:grant}),/WORK_HISTORY_BUSY/);
  const unchanged=new DatabaseSync(fixture.databasePath,{readOnly:true});assert.equal(unchanged.prepare('SELECT version FROM schema_migrations').get()?.version,5);assert.equal(unchanged.prepare('SELECT state FROM runs WHERE run_id=?').get(run.runId)?.state,'accepted');unchanged.close();
 } finally {await fixture.cleanup();}
});

test('schema 6 event checkpoints survive compaction and reopen',async()=>{
 const fixture=await createFixture();
 try {
  let store=WorkStore.open(fixture.databasePath,{workId:'work-1'});store.createSession(session());store.close();

  store=WorkStore.open(fixture.databasePath,{workId:'work-1'});
  const run=store.acceptRun(submit({submissionKey:'checkpoint'})).run;
  store.appendEvent(run.runId,'text',JSON.stringify({delta:'可恢复的正文'}),NOW);
  store.appendEvent(run.runId,'tool-start',JSON.stringify({toolName:'read',toolCallId:'call'}),NOW);
  store.appendEvent(run.runId,'tool-end',JSON.stringify({toolName:'read',toolCallId:'call',isError:false,result:{kind:'text',text:'done'}}),NOW);
  store.appendEvent(run.runId,'text',JSON.stringify({delta:'后续正文'}),NOW);
  store.compactRunEvents(run.runId,2);store.close();
  store=WorkStore.open(fixture.databasePath,{workId:'work-1'});
  const chunks=store.historyOutputChunks('work-1','session-1',run.runId,4);
  assert.deepEqual(chunks.map(chunk=>chunk.kind),['text','tool-start','tool-end','text']);
  assert.equal(chunks[0]!.data,'可恢复的正文');
  assert.equal(chunks[3]!.data,'后续正文');
  const indexed=store.historyOutputEventIndex('work-1','session-1',run.runId,4);
  assert.deepEqual(indexed.map(event=>[event.sequence,event.kind]),[[1,'text'],[2,'tool-start'],[3,'tool-end'],[4,'text']]);
  assert.equal(indexed[0]!.bytes,Buffer.byteLength('可恢复的正文'));
  assert.deepEqual(store.historyOutputEventIndex('work-1','session-1',run.runId,2).map(event=>event.sequence),[1,2]);
  assert.throws(()=>store.historyOutputEventIndex('work-1','wrong',run.runId,4),/Run not found/);
  assert.equal(store.historyOutputTextRange('work-1','session-1',run.runId,1,0,100).toString(),'可恢复的正文');
  assert.throws(()=>store.historyOutputTextRange('work-1','wrong',run.runId,1,0,100),/Run not found/);
  assert.throws(()=>store.readEvents(run.runId,0),CursorExpiredError);store.close();
 } finally {await fixture.cleanup();}
});

test("Session locator, Run, event sequence, and activity survive database reopen", async () => {
  const fixture = await createFixture();
  try {
    let store = WorkStore.open(fixture.databasePath);
    assert.equal(store.schemaVersion, WORK_SCHEMA_VERSION);
    store.createSession(session());
    const accepted = store.acceptRun(submit({ submissionKey: "submit-1" }));
    assert.equal(accepted.reused, false);
    assert.equal(store.appendEvent(accepted.run.runId, "text", '{"delta":"hello"}', NOW), 1);
    assert.equal(store.historyOutputChunks('work-1','session-1',accepted.run.runId,1)[0]?.data,'hello');
    assert.throws(()=>store.historyOutputChunks('other','session-1',accepted.run.runId,1),/Run not found/);
    store.close();

    store = WorkStore.open(fixture.databasePath);
    assert.equal(store.getSession("work-1", "session-1")?.sdkHistoryPath, "/var/session/session-1.jsonl");
    const run = store.getRun(accepted.run.runId);
    assert.equal(run?.state, "accepted");
    assert.equal(run?.latestSequence, 1);
    assert.throws(
      () => store.acceptRun(submit({ submissionKey: "submit-2", requestDigest: "digest-2" })),
      (error) => error instanceof WorkBusyError && error.activeRunId === accepted.run.runId,
    );
    store.completeRun(accepted.run.runId, "succeeded", "hello", null, NOW);
    const next = store.acceptRun(submit({ submissionKey: "submit-2", requestDigest: "digest-2" }));
    assert.equal(next.reused, false);
    store.close();
  } finally {
    await fixture.cleanup();
  }
});

test("concurrent acceptance creates one active Run and no hidden queue", async () => {
  const fixture = await createFixture();
  const store = WorkStore.open(fixture.databasePath);
  store.createSession(session());
  store.createSession({ ...session(), sessionId: "session-2", sdkHistoryPath: "/var/session/session-2.jsonl" });
  try {
    const attempts = await Promise.allSettled([
      Promise.resolve().then(() => store.acceptRun(submit({ submissionKey: "a", requestDigest: "digest-a" }))),
      Promise.resolve().then(() => store.acceptRun(submit({ sessionId: "session-2", submissionKey: "b", requestDigest: "digest-b" }))),
    ]);
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = attempts.find((result) => result.status === "rejected");
    assert.ok(rejected?.status === "rejected" && rejected.reason instanceof WorkBusyError);
  } finally {
    store.close();
    await fixture.cleanup();
  }
});

test("same submission retries reuse one Run before activity checks and changed content conflicts", async () => {
  const fixture = await createFixture();
  const store = WorkStore.open(fixture.databasePath);
  store.createSession(session());
  try {
    const first = store.acceptRun(submit({ submissionKey: "same", requestDigest: "digest-a" }));
    const retry = store.acceptRun(submit({ submissionKey: "same", requestDigest: "digest-a" }));
    assert.equal(retry.reused, true);
    assert.equal(retry.run.runId, first.run.runId);
    assert.throws(
      () => store.acceptRun(submit({ submissionKey: "same", requestDigest: "digest-b" })),
      (error) => error instanceof SubmitConflictError,
    );
  } finally {
    store.close();
    await fixture.cleanup();
  }
});

test("Each Run captures its own context without binding the Session", async () => {
  const fixture = await createFixture();
  const store = WorkStore.open(fixture.databasePath);
  try {
    store.createSession({ ...session(), });
    const accepted = store.acceptRun(submit({ submissionKey: "contexted", contextIdentity: "context-a" }));

    assert.equal(store.getRun(accepted.run.runId)?.contextIdentity, "context-a");
    store.completeRun(accepted.run.runId, "succeeded", "done", null);
    const next=store.acceptRun(submit({submissionKey:"next-context",contextIdentity:"context-b"}));
    assert.equal(next.run.contextIdentity,"context-b");
    assert.equal(store.getRun(accepted.run.runId)?.contextIdentity,"context-a");
    assert.equal(store.acceptRun(submit({submissionKey:"contexted",contextIdentity:"context-b"})).run.runId,accepted.run.runId);
  } finally {
    store.close();
    await fixture.cleanup();
  }
});

test("Work Store indexes SDK history without storing a second transcript", async () => {
  const fixture = await createFixture();
  const store = WorkStore.open(fixture.databasePath);
  try {
    const tables = store.listTables();
    assert.ok(tables.includes("sessions"));
    assert.ok(tables.includes("runs"));
    assert.ok(tables.includes("run_events"));
    assert.equal(tables.some((name) => /message|transcript|history/i.test(name)), false);
  } finally {
    store.close();
    await fixture.cleanup();
  }
});

test("event retention publishes an earliest cursor while final Run state remains queryable", async () => {
  const fixture = await createFixture();
  const store = WorkStore.open(fixture.databasePath);
  store.createSession(session());
  try {
    assert.equal(DEFAULT_MAX_RUN_EVENTS, 10_000);
    const accepted = store.acceptRun(submit({ submissionKey: "retention" }));
    for (let index = 1; index <= 12; index += 1) {
      store.appendEvent(accepted.run.runId, "text", JSON.stringify({ delta: String(index) }), NOW);
    }
    const compacted = store.compactRunEvents(accepted.run.runId, 10);
    assert.equal(compacted.earliestAvailableSequence, 3);
    assert.throws(
      () => store.readEvents(accepted.run.runId, 1),
      (error) => error instanceof CursorExpiredError && error.earliestAvailableSequence === 3,
    );
    assert.deepEqual(store.readEvents(accepted.run.runId, 2).map((event) => event.sequence), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    store.completeRun(accepted.run.runId, "succeeded", "durable final answer", null, NOW);
    assert.equal(store.getRun(accepted.run.runId)?.finalText, "durable final answer");
    assert.equal(store.getRun(accepted.run.runId)?.state, "succeeded");
  } finally {
    store.close();
    await fixture.cleanup();
  }
});

test("unsupported structural schemas fail without reconstructing missing tables or losing records", async () => {
  const fixture = await createFixture();
  let store = WorkStore.open(fixture.databasePath);
  try {
    store.createSession(session());
    const accepted = store.acceptRun(submit({ submissionKey: "before-migration" }));
    store.close();
    const database = new DatabaseSync(fixture.databasePath);
    database.exec("DROP TABLE session_idempotency");
    database.exec("DELETE FROM schema_migrations WHERE version = 4");
    database.close();

    assert.throws(() => WorkStore.open(fixture.databasePath), /WORK_HISTORY_FORMAT_UNSUPPORTED/);
    const verify = new DatabaseSync(fixture.databasePath);
    try {
      assert.equal(verify.prepare("SELECT session_id FROM sessions").get()?.session_id, "session-1");
      assert.equal(verify.prepare("SELECT submission_key FROM runs").get()?.submission_key, "before-migration");
      assert.equal(verify.prepare("SELECT name FROM sqlite_master WHERE name='session_idempotency'").get(), undefined);
    } finally { verify.close(); }
  } finally {
    store.close();
    await fixture.cleanup();
  }
});

function session() {
  return {
    workId: "work-1",
    sessionId: "session-1",
    sdkHistoryPath: "/var/session/session-1.jsonl",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function submit(overrides: Partial<Parameters<WorkStore["acceptRun"]>[0]> = {}) {
  return {
    workId: "work-1",
    sessionId: "session-1",
    submissionKey: "submit-1",
    requestDigest: "digest-1",
    promptDigest: "prompt-digest-1",
    now: NOW,
    ...overrides,
  };
}

async function createFixture(): Promise<{ readonly databasePath: string; cleanup(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "piwork-work-store-"));
  return {
    databasePath: join(root, "work.sqlite"),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

// Build an isolated schema-5 input for the migration tests.
function makeSchema5(path:string) {const db=new DatabaseSync(path);try{db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE; CREATE TEMP TABLE saved_sessions AS SELECT * FROM sessions; DROP TABLE sessions;');db.exec(WORK_SCHEMA_V5_SQL.match(/CREATE TABLE sessions[\s\S]*?STRICT;/)![0]);db.exec('INSERT INTO sessions(work_id,session_id,sdk_history_path,created_at,updated_at,model_preference_json,source_json) SELECT * FROM saved_sessions; DROP TABLE run_output_chunks; UPDATE schema_migrations SET version=5; COMMIT');}finally{db.close();}}
