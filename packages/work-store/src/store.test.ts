import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import test from "node:test";
import { CursorExpiredError, DEFAULT_MAX_RUN_EVENTS, SubmitConflictError, WorkBusyError, WORK_SCHEMA_VERSION, WorkStore } from "./store.js";

const NOW = "2026-09-20T00:00:00Z";

test("Session locator, Run, event sequence, and activity survive database reopen", async () => {
  const fixture = await createFixture();
  try {
    let store = WorkStore.open(fixture.databasePath);
    assert.equal(store.schemaVersion, WORK_SCHEMA_VERSION);
    store.createSession(session());
    const accepted = store.acceptRun(submit({ submissionKey: "submit-1" }));
    assert.equal(accepted.reused, false);
    assert.equal(store.appendEvent(accepted.run.runId, "text", '{"delta":"hello"}', NOW), 1);
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
  try {
    const attempts = await Promise.allSettled([
      Promise.resolve().then(() => store.acceptRun(submit({ submissionKey: "a", requestDigest: "digest-a" }))),
      Promise.resolve().then(() => store.acceptRun(submit({ submissionKey: "b", requestDigest: "digest-b" }))),
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

test("Sessions and accepted Runs retain an internal active context identity", async () => {
  const fixture = await createFixture();
  const store = WorkStore.open(fixture.databasePath);
  try {
    store.createSession({ ...session(), contextIdentity: "context-a" });
    const accepted = store.acceptRun(submit({ submissionKey: "contexted", contextIdentity: "context-a" }));
    assert.equal(store.getSession("work-1", "session-1")?.contextIdentity, "context-a");
    assert.equal(store.getRun(accepted.run.runId)?.contextIdentity, "context-a");
    store.completeRun(accepted.run.runId, "succeeded", "done", null);
    assert.throws(() => store.acceptRun(submit({ submissionKey: "wrong-context", contextIdentity: "context-b" })), /context is no longer active/);
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

test("older structural schemas upgrade without losing Session or Run records", async () => {
  const fixture = await createFixture();
  let store = WorkStore.open(fixture.databasePath);
  try {
    store.createSession(session());
    const accepted = store.acceptRun(submit({ submissionKey: "before-migration" }));
    store.close();
    const database = new DatabaseSync(fixture.databasePath);
    database.exec("DROP TABLE session_idempotency");
    database.exec("DELETE FROM schema_migrations WHERE version IN (2, 3)");
    database.close();

    store = WorkStore.open(fixture.databasePath);
    assert.equal(store.schemaVersion, WORK_SCHEMA_VERSION);
    assert.equal(store.getSession("work-1", "session-1")?.sessionId, "session-1");
    assert.equal(store.getRun(accepted.run.runId)?.submissionKey, "before-migration");
    assert.ok(store.listTables().includes("session_idempotency"));
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
