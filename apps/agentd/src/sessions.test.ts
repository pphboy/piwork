import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendAssistantMessage, appendUserMessage } from "@piwork/pi-adapter";
import { WorkStore } from "@piwork/work-store";
import { AgentSessionService } from "./sessions.js";
import { AgentRunModels } from "./run-models.js";

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
    const anotherWork = new AgentSessionService("work-2", store, workspace, sessionRoot);
    assert.throws(() => anotherWork.read(created.sessionId), /does not exist in Work work-2/);
    assert.throws(() => anotherWork.continue(created.sessionId), /does not exist in Work work-2/);
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
    appendUserMessage(sessions.continue(created.sessionId), "historical message");
    assert.equal(store.getSession("work-1", created.sessionId)?.contextIdentity, "context-a");
    store.close();

    store = WorkStore.open(databasePath);
    sessions = new AgentSessionService("work-1", store, workspace, sessionRoot, "context-a");
    assert.equal(sessions.continue(created.sessionId).getSessionId(), created.sessionId);

    const replaced = new AgentSessionService("work-1", store, workspace, sessionRoot, "context-b");
    assert.deepEqual(replaced.read(created.sessionId).entries.map(({ role, text }) => ({ role, text })), [
      { role: "user", text: "historical message" },
    ]);
    assert.throws(() => replaced.continue(created.sessionId), {name: "SessionContextUnavailableError", message: /context is unavailable/});
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Session model preference is persistent, context-neutral and absent in a new Session", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-session-model-")); const workspace = join(root, "workspace"); await mkdir(workspace);
  const path = join(root, "private", "history.sqlite"); let store = WorkStore.open(path);
  try {
    const models = new AgentRunModels({ provider: "piwork-deterministic", id: "fixture-v1", deterministic: true });
    let sessions = new AgentSessionService("work-a", store, workspace, join(root, "sessions"), "context-a"); const session = sessions.create();
    const changed = await sessions.setModelPreference(session.sessionId, null, models);
    assert.equal(changed.contextIdentity, "context-a"); assert.equal(JSON.parse(changed.modelPreferenceJson!).modelRef, null);
    assert.equal(sessions.create().modelPreferenceJson, undefined);
    store.close(); store = WorkStore.open(path); sessions = new AgentSessionService("work-a", store, workspace, join(root, "sessions"), "context-a");
    assert.equal(sessions.list().find((r) => r.sessionId === session.sessionId)?.modelPreferenceJson, changed.modelPreferenceJson);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});
