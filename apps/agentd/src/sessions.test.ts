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

test("legacy custom model selection does not claim a confirmed Off capability", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-session-custom-"));
  const workspace = join(root, "workspace"); await mkdir(workspace);
  const store = WorkStore.open(join(root, "work.sqlite"));
  try {
    const model = { modelRef: null, label: "Custom", provider: "anthropic", model: "unconfirmed-custom", baseUrl: "https://custom.example.test/anthropic" };
    const models = new AgentRunModels({ provider: model.provider, id: model.model, baseUrl: model.baseUrl, deterministic: false }, {
      async models() { return { models: [], defaultModel: model, checkedAt: "2026-10-05T00:00:00Z" }; },
      async resolveModel() { return { model, credential: "fixture-private-key" }; },
    });
    const sessions = new AgentSessionService("work-custom", store, workspace, join(root, "sessions"), "context-custom");
    const session = sessions.create();
    const saved = await sessions.setModelPreference(session.sessionId, null, models);
    assert.equal(JSON.parse(saved.modelPreferenceJson!).thinkingLevel, undefined);
    assert.equal((await sessions.chatOptions(session.sessionId, models)).availability, "unavailable");
    await assert.rejects(sessions.setChatOptions(session.sessionId, { modelRef: null, thinkingLevel: "off" }, models), /cannot confirm/);
    assert.equal(store.getSession("work-custom", session.sessionId)?.modelPreferenceJson, saved.modelPreferenceJson);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test('complete chat options are atomic; legacy model PATCH retains Thinking and rejects an incompatible model',async()=>{
 const root=await mkdtemp(join(tmpdir(),'piwork-options-'));await mkdir(join(root,'workspace'));const store=WorkStore.open(join(root,'work.sqlite'));
 try {
  const sessions=new AgentSessionService('work-1',store,join(root,'workspace'),join(root,'sessions'),'context-a');const first=sessions.create('key');
  const models:import('./run-models.js').RunModelResolver={async list(){throw new Error('unused');},async credential(){return 'secret';},async resolve(ref){return{modelRef:ref,label:ref || 'Default',provider:'fixture',model:ref || 'default'};},async thinking(model){return{thinkingLevels:model.modelRef==='model-high'?['off','high']:['off'],defaultThinkingLevel:'off'};}};
  assert.equal((await sessions.chatOptions(first.sessionId,models)).thinkingLevel,'off');
  await sessions.setChatOptions(first.sessionId,{modelRef:'model-high',thinkingLevel:'high'},models);const original=store.getSession('work-1',first.sessionId)?.modelPreferenceJson;
  await assert.rejects(sessions.setModelPreference(first.sessionId,null,models),/Thinking/);assert.equal(store.getSession('work-1',first.sessionId)?.modelPreferenceJson,original);
  const current=await sessions.chatOptions(first.sessionId,models);assert.equal(current.modelRef,'model-high');assert.equal(current.thinkingLevel,'high');assert.doesNotMatch(JSON.stringify(current),/secret|baseUrl|sdkHistoryPath/);
  const other=new AgentSessionService('work-1',store,join(root,'workspace'),join(root,'sessions'),'context-b');await assert.rejects(other.setChatOptions(first.sessionId,{modelRef:null,thinkingLevel:'off'},models),/context is unavailable/);assert.equal((await other.chatOptions(first.sessionId,models)).availability,'unavailable');
  assert.equal(store.findSessionSubmission('work-1','key')?.sessionId,first.sessionId);assert.equal(store.findSessionSubmission('other-work','key'),undefined);
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});
