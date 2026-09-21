import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendAssistantMessage, appendUserMessage } from "@piwork/pi-adapter";
import { WorkStore } from "@piwork/work-store";
import { AgentSessionService } from "./sessions.js";

test("real SDK Session create/list/read/continue survives daemon service replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-agentd-session-"));
  const workspace = join(root, "data");
  const sessionRoot = join(root, "session", "sdk");
  await mkdir(workspace, { recursive: true });
  const databasePath = join(root, "session", "work.sqlite");
  let store = WorkStore.open(databasePath);
  try {
    let sessions = new AgentSessionService("work-1", store, workspace, sessionRoot);
    const created = sessions.create();
    const sdk = sessions.continue(created.sessionId);
    appendUserMessage(sdk, "first turn");
    appendAssistantMessage(sdk, "first answer");
    assert.equal(sessions.list().length, 1);
    store.close();

    store = WorkStore.open(databasePath);
    sessions = new AgentSessionService("work-1", store, workspace, sessionRoot);
    const restored = sessions.read(created.sessionId);
    assert.equal(restored.sessionId, created.sessionId);
    assert.equal(restored.historyPath, created.sdkHistoryPath);
    assert.deepEqual(restored.entries.map(({ role, text }) => ({ role, text })), [
      { role: "user", text: "first turn" },
      { role: "assistant", text: "first answer" },
    ]);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Session creation idempotency survives WorkStore reopen without leaving a second SDK history", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-agentd-session-idempotent-"));
  const workspace = join(root, "data");
  const sessionRoot = join(root, "session", "sdk");
  await mkdir(workspace, { recursive: true });
  const databasePath = join(root, "session", "work.sqlite");
  let store = WorkStore.open(databasePath);
  try {
    let sessions = new AgentSessionService("work-1", store, workspace, sessionRoot);
    const first = sessions.create("same-request");
    assert.equal(sessions.create("same-request").sessionId, first.sessionId);
    assert.equal(sessions.list().length, 1);
    store.close();

    store = WorkStore.open(databasePath);
    sessions = new AgentSessionService("work-1", store, workspace, sessionRoot);
    assert.equal(sessions.create("same-request").sessionId, first.sessionId);
    assert.equal(sessions.list().length, 1);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Session context identity survives reopen and rejects a different Work context", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-agentd-session-context-"));
  const workspace = join(root, "data");
  const sessionRoot = join(root, "session", "sdk");
  await mkdir(workspace, { recursive: true });
  const databasePath = join(root, "session", "work.sqlite");
  let store = WorkStore.open(databasePath);
  try {
    let sessions = new AgentSessionService("work-1", store, workspace, sessionRoot, "context-a");
    const created = sessions.create("create-context");
    assert.equal(store.getSession("work-1", created.sessionId)?.contextIdentity, "context-a");
    store.close();

    store = WorkStore.open(databasePath);
    sessions = new AgentSessionService("work-1", store, workspace, sessionRoot, "context-a");
    assert.equal(sessions.continue(created.sessionId).getSessionId(), created.sessionId);

    const replaced = new AgentSessionService("work-1", store, workspace, sessionRoot, "context-b");
    assert.throws(() => replaced.continue(created.sessionId), /context is unavailable/);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
