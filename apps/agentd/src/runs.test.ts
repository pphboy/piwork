import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ChatImageInput } from "@piwork/contracts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkBusyError, WorkStore } from "@piwork/work-store";
import { AgentDaemonControl } from "./daemon.js";
import { RunManager, type RunExecutionContext, type RunExecutor } from "./runs.js";
import type { RunModelResolver } from "./run-models.js";
import { RunModelError } from "./run-models.js";
import { ModelProviderError } from "./model-provider-errors.js";

const NOW = "2026-09-20T00:00:00.000Z";

test("provider authentication failures preserve safe terminal state and original submission", async () => {
  await withStore(async store => {
    const executor = new ControlledExecutor();
    const manager = readyManager(store, executor);
    for (const code of ["MODEL_AUTHENTICATION_FAILED", "MODEL_PERMISSION_DENIED"] as const) {
      const input = { workId: "work-a", sessionId: "session-a", submissionKey: code, prompt: "fixture" };
      const accepted = manager.submit(input);
      await executor.waitUntilRunning(accepted.run.runId);
      executor.reject(accepted.run.runId, new ModelProviderError(code));
      const run = await manager.wait(accepted.run.runId);
      const failure = JSON.parse(run.errorJson!);
      assert.equal(run.state, "failed");
      assert.equal(failure.code, code);
      assert.equal(failure.retryable, false);
      assert.match(failure.message, /administrator/);
      const replay = manager.submit(input);
      assert.equal(replay.run.runId, run.runId);
      assert.equal(replay.reused, true);
      const state = manager.watch(run.runId).findLast(event => event.eventType === "state");
      assert.deepEqual(JSON.parse(state!.payloadJson).error, failure);
    }
  });
});

test('executor failure and cancellation retain emitted text and tool checkpoints',async()=>{
 for(const outcome of ['failure','cancel'] as const)await withStore(async store=>{
  let ready!:()=>void;const started=new Promise<void>(resolve=>ready=resolve);
  const manager=readyManager(store,{async execute(context){
   context.emit('text',{delta:'已经输出'});
   context.emit('tool-start',{toolName:'read',toolCallId:'call-fixture'});
   context.emit('tool-end',{toolName:'read',toolCallId:'call-fixture',isError:false,result:{kind:'text',text:'完成',truncated:false,isError:false}});
   context.emit('text',{delta:'后续内容'});ready();
   if(outcome==='failure')throw new Error('synthetic provider failure');
   await new Promise<void>((_,reject)=>context.signal.addEventListener('abort',()=>reject(new Error('synthetic abort')),{once:true}));
   return {finalText:''};
  }});
  const run=manager.submit({workId:'work-a',sessionId:'session-a',submissionKey:`partial-${outcome}`,prompt:'fixture'}).run;
  await started;if(outcome==='cancel')manager.cancel(run.runId);
  const final=await manager.wait(run.runId);assert.equal(final.state,outcome==='failure'?'failed':'cancelled');assert.equal(final.finalText,null);
  const events=store.historyOutputEventIndex('work-a','session-a',run.runId,final.latestSequence);
  assert.deepEqual(events.map(event=>event.kind),['text','tool-start','tool-end','text']);
  assert.equal(store.historyOutputTextRange('work-a','session-a',run.runId,events[0]!.sequence,0,100).toString(),'已经输出');
  assert.equal(store.historyOutputTextRange('work-a','session-a',run.runId,events[3]!.sequence,0,100).toString(),'后续内容');
 });
});

test("unavailable Work storage rejects submission before executor side effects", async () => {
  await withStore(async (store) => {
    let executions = 0;
    const manager = readyManager(store, { async execute() { executions += 1; return { finalText: "unrecorded" }; } });
    store.close();
    assert.throws(() => manager.submit({ workId: "work-a", sessionId: "session-a", submissionKey: "no-storage", prompt: "must not run" }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(executions, 0);
  });
});

test("submission is durable and idempotent with one active slot per Work and parallel different Works", async () => {
  await withStore(async (store, peerStore) => {
    const executor = new ControlledExecutor();
    const manager = readyManager(store, executor);
    const first = manager.submit({ workId: "work-a", sessionId: "session-a", submissionKey: "submit-1", prompt: "hello" });
    const reused = manager.submit({ workId: "work-a", sessionId: "session-a", submissionKey: "submit-1", prompt: "hello" });
    assert.equal(reused.reused, true);
    assert.equal(reused.run.runId, first.run.runId);
    assert.throws(
      () => manager.submit({ workId: "work-a", sessionId: "session-a", submissionKey: "submit-2", prompt: "second" }),
      (error) => error instanceof WorkBusyError,
    );
    const peer = readyManager(peerStore,executor);
    const other = peer.submit({ workId: "work-b", sessionId: "session-b", submissionKey: "submit-b", prompt: "parallel" });
    await Promise.all([executor.waitUntilRunning(first.run.runId), executor.waitUntilRunning(other.run.runId)]);
    assert.equal(executor.running.size, 2);
    executor.resolve(first.run.runId, "answer-a");
    executor.resolve(other.run.runId, "answer-b");
    assert.equal((await manager.wait(first.run.runId)).state, "succeeded");
    assert.equal((await peer.wait(other.run.runId)).state, "succeeded");
    assert.equal(store.getRun(other.run.runId),undefined);
    assert.equal(peerStore.getRun(first.run.runId),undefined);
  });
});

test("per-Run selector pins actual model and replay precedes changed Session preferences or model availability", async () => {
  await withStore(async (store) => {
    const executor = new ControlledExecutor(); let resolves = 0; let available = true;
    const models: RunModelResolver = { async list() { throw new Error("unused"); }, async credential() { return "secret"; },
      async resolve(ref) { resolves++; if (!available) throw new RunModelError("MODEL_UNAVAILABLE", "Unavailable");
        return { modelRef: ref, provider: "fixture", model: ref ?? "default", label: ref ?? "default" }; } };
    const daemon = new AgentDaemonControl({ workId: "fixture", generation: 1, instanceId: "instance" });
    daemon.configure({ modelCredentialStatus: "available", contextIdentity: "context-fixture", loadedSkills: [], resolvedTools: [], initializationComplete: true });
    const manager = new RunManager(store, daemon, executor, () => new Date(NOW), models);
    store.setSessionModelPreference("work-a", "session-a", JSON.stringify({ modelRef: "catalog-model-0001" }));
    const input = { workId: "work-a", sessionId: "session-a", submissionKey: "model-run1", prompt: "hello" };
    const first = await manager.submitChat(input); await executor.waitUntilRunning(first.run.runId);
    assert.equal(JSON.parse(first.run.actualModelJson!).model, "catalog-model-0001");
    store.setSessionModelPreference("work-a", "session-a", JSON.stringify({ modelRef: "catalog-model-0002" })); available = false;
    assert.equal((await manager.submitChat(input)).run.runId, first.run.runId); assert.equal(resolves, 1);
    await assert.rejects(manager.submitChat({ ...input, modelRef: null }), /different content/);
    await assert.rejects(manager.submitChat({ ...input, modelRef: "catalog-model-0002" }), /different content/);
    assert.equal(JSON.parse(manager.get(first.run.runId)!.actualModelJson!).model, "catalog-model-0001");
    executor.resolve(first.run.runId, "one"); await manager.wait(first.run.runId); available = true;
    const next = await manager.submitChat({ ...input, submissionKey: "model-run2" }); await executor.waitUntilRunning(next.run.runId);
    assert.equal(JSON.parse(next.run.actualModelJson!).model, "catalog-model-0002"); executor.resolve(next.run.runId, "two"); await manager.wait(next.run.runId);
    const fallback = await manager.submitChat({ ...input, submissionKey: "model-run3", modelRef: null }); await executor.waitUntilRunning(fallback.run.runId);
    assert.equal(JSON.parse(fallback.run.actualModelJson!).model, "default"); executor.resolve(fallback.run.runId, "default"); await manager.wait(fallback.run.runId);
    const explicit = await manager.submitChat({ ...input, submissionKey: "model-run4", modelRef: "catalog-model-0001" }); await executor.waitUntilRunning(explicit.run.runId);
    assert.equal(JSON.parse(explicit.run.actualModelJson!).model, "catalog-model-0001"); executor.resolve(explicit.run.runId, "one"); await manager.wait(explicit.run.runId);
    daemon.prepareConfigurationChange(); available = false;
    assert.equal((await manager.submitChat(input)).run.runId, first.run.runId);
  });
});

test("observer loss does not abort, model failure stays within the Run, and explicit cancel holds the slot through cleanup", async () => {
  await withStore(async (store) => {
    const executor = new ControlledExecutor();
    const manager = readyManager(store, executor);
    const run = manager.submit({ workId: "work-a", sessionId: "session-a", submissionKey: "observe", prompt: "stream" });
    run.run.runId;
    // Reading and then dropping an observation has no cancellation side effect.
    manager.watch(run.run.runId);
    assert.equal(manager.get(run.run.runId)?.state === "accepted" || manager.get(run.run.runId)?.state === "running", true);
    await executor.waitUntilRunning(run.run.runId);
    executor.reject(run.run.runId, new Error("fixture model failed with api-key-secret"));
    const failed = await manager.wait(run.run.runId);
    assert.equal(failed.state, "failed");
    assert.deepEqual(JSON.parse(failed.errorJson ?? "null"), {
      code: "MODEL_EXECUTION_FAILED",
      message: "Model execution failed.",
      retryable: true,
    });
    assert.doesNotMatch(failed.errorJson ?? "", /api-key-secret/);

    const cancelling = manager.submit({ workId: "work-a", sessionId: "session-a", submissionKey: "cancel", prompt: "wait" });
    await executor.waitUntilRunning(cancelling.run.runId);
    assert.equal(manager.cancel(cancelling.run.runId).state, "cancelling");
    assert.throws(
      () => manager.submit({ workId: "work-a", sessionId: "session-a", submissionKey: "too-early", prompt: "blocked" }),
      (error) => error instanceof WorkBusyError,
    );
    executor.resolve(cancelling.run.runId, "partial cleanup result");
    assert.equal((await manager.wait(cancelling.run.runId)).state, "cancelled");
    const next = manager.submit({ workId: "work-a", sessionId: "session-a", submissionKey: "after-cancel", prompt: "allowed" });
    await executor.waitUntilRunning(next.run.runId);
    executor.resolve(next.run.runId, "done");
    assert.equal((await manager.wait(next.run.runId)).state, "succeeded");
  });
});

test("daemon recovery interrupts old active Runs and never repeats their external side effects", async () => {
  await withStore(async (store) => {
    let sideEffects = 0;
    const accepted = store.acceptRun({
      workId: "work-a", sessionId: "session-a", submissionKey: "crashed", requestDigest: "request", promptDigest: "prompt", now: NOW,
    });
    store.markRunRunning(accepted.run.runId, NOW);
    store.appendEvent(accepted.run.runId, "tool-end", JSON.stringify({ toolName:"fixture", toolCallId:"fixture-call", sideEffect: ++sideEffects }), NOW);
    const manager = readyManager(store, { async execute() { sideEffects += 1; return { finalText: "must not execute" }; } });
    const interrupted = manager.recover();
    assert.equal(interrupted[0]?.state, "interrupted");
    assert.equal(sideEffects, 1);
    assert.equal(store.getRun(accepted.run.runId)?.latestSequence, 2);
  });
});

test("bounded drain rejects new Runs, aborts at the deadline, and waits for the active slot to release", async () => {
  await withStore(async (store) => {
    const executor = new AbortSettlingExecutor();
    const manager = readyManager(store, executor);
    const active = manager.submit({ workId: "work-a", sessionId: "session-a", submissionKey: "drain-active", prompt: "wait" });
    await executor.waitUntilRunning(active.run.runId);

    const draining = manager.drain(1);
    assert.throws(
      () => manager.submit({ workId: "work-b", sessionId: "session-b", submissionKey: "drain-rejected", prompt: "no" }),
      /not ready to accept Runs/,
    );
    await draining;

    assert.equal(executor.running.size, 0);
    assert.equal(executor.abortedRunIds.has(active.run.runId), true);
    assert.equal(manager.get(active.run.runId)?.state, "cancelled");
  });
});

test("drain returns for container shutdown when a background child ignores parent abort", async () => {
  await withStore(async (store) => {
    let signal: AbortSignal | undefined;
    let running!: () => void;
    const started = new Promise<void>((resolve) => { running = resolve; });
    const manager = readyManager(store, { execute(context) {
      signal = context.signal;
      running();
      return new Promise(() => undefined);
    } });
    manager.submit({ workId: "work-a", sessionId: "session-a", submissionKey: "detached-child", prompt: "wait" });
    await started;
    await Promise.race([manager.drain(1), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("drain hung")), 5_000))]);
    assert.equal(signal?.aborted, true);
  });
});

class ControlledExecutor implements RunExecutor {
  readonly running = new Map<string, { resolve: (text: string) => void; reject: (error: Error) => void }>();
  execute(context: RunExecutionContext): Promise<{ finalText: string }> {
    context.emit("text", { delta: "started" });
    return new Promise((resolve, reject) => {
      this.running.set(context.runId, {
        resolve: (text) => { this.running.delete(context.runId); resolve({ finalText: text }); },
        reject: (error) => { this.running.delete(context.runId); reject(error); },
      });
    });
  }
  async waitUntilRunning(runId: string): Promise<void> {
    while (!this.running.has(runId)) await new Promise<void>((resolve) => setImmediate(resolve));
  }
  resolve(runId: string, text: string): void { this.running.get(runId)?.resolve(text); }
  reject(runId: string, error: Error): void { this.running.get(runId)?.reject(error); }
}

class AbortSettlingExecutor implements RunExecutor {
  readonly running = new Set<string>();
  readonly abortedRunIds = new Set<string>();
  execute(context: RunExecutionContext): Promise<{ finalText: string }> {
    this.running.add(context.runId);
    return new Promise((resolve, reject) => {
      context.signal.addEventListener("abort", () => {
        this.abortedRunIds.add(context.runId);
        setImmediate(() => {
          this.running.delete(context.runId);
          reject(new Error("aborted"));
        });
      }, { once: true });
    });
  }
  async waitUntilRunning(runId: string): Promise<void> {
    while (!this.running.has(runId)) await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function readyManager(store: WorkStore, executor: RunExecutor): RunManager {
  const daemon = new AgentDaemonControl({ workId: "fixture", generation: 1, instanceId: "instance" });
  daemon.configure({
    modelCredentialStatus: "available", contextIdentity: "context-fixture",
    loadedSkills: [], resolvedTools: ["read"], initializationComplete: true,
  });
  return new RunManager(store, daemon, executor, () => new Date(NOW));
}

async function withStore(run: (store: WorkStore, peerStore: WorkStore) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "piwork-runs-"));
  const store = WorkStore.open(join(root, "work.sqlite"));
  const peerStore=WorkStore.open(join(root,"peer","work.sqlite"));
  for (const [current,workId, sessionId] of [[store,"work-a", "session-a"], [peerStore,"work-b", "session-b"]] as const) {
    current.createSession({ workId, sessionId, sdkHistoryPath: join(root, `${sessionId}.jsonl`), createdAt: NOW, updatedAt: NOW });
  }
  try { await run(store,peerStore); }
  finally { store.close();peerStore.close(); await rm(root, { recursive: true, force: true }); }
}

test("missing or cross-Work Session refuses admission before model resolution and SDK effects", async () => {
  await withStore(async store => {
    let resolves = 0, executions = 0;
    const models: RunModelResolver = { async list() { throw new Error("unused"); }, async credential() { throw new Error("unused"); },
      async resolve() { resolves++; throw new Error("must not resolve"); } };
    const daemon = new AgentDaemonControl({workId: "work-a", generation: 1, instanceId: "instance"});
    daemon.configure({modelCredentialStatus: "available", contextIdentity: "context-current", loadedSkills: [], resolvedTools: [], initializationComplete: true});
    store.createSession({workId: "work-a", sessionId: "session-old", sdkHistoryPath: "/unused-old.jsonl",  createdAt: NOW, updatedAt: NOW});
    const manager = new RunManager(store,daemon,{async execute(){ executions++; return {finalText:"must not execute"};}},()=>new Date(NOW),models);
    const input = {workId:"work-a",sessionId:"session-old",submissionKey:"refuse-old",prompt:"identify current model"};
    assert.throws(()=>manager.submit({...input,sessionId:"missing"}),{name:"SessionNotFoundError"});
    await assert.rejects(manager.submitChat({...input,workId:"other-work"}),{name:"SessionNotFoundError"});
    await assert.rejects(manager.submitChat({...input,sessionId:"missing"}),{name:"SessionNotFoundError"});
    assert.equal(resolves,0); assert.equal(executions,0); assert.equal(store.activeRun("work-a"),undefined);
  });
});

test('input mode participates in accepted digest; replay skips changed command directory and Thinking capabilities',async()=>{
 await withStore(async store=>{
  let validations=0,executions=0,available=true;
  const models:RunModelResolver={async list(){throw new Error('unused');},async credential(){return 'secret';},async resolve(ref){if(!available)throw new Error('changed');return{modelRef:ref,label:'Fixture',provider:'fixture',model:'one'};},async thinking(){return{thinkingLevels:['off','high'],defaultThinkingLevel:'off'};}};
  const daemon=new AgentDaemonControl({workId:'work-a',generation:1,instanceId:'instance'});daemon.configure({modelCredentialStatus:'available',contextIdentity:'context-a',loadedSkills:[],resolvedTools:[],initializationComplete:true});
  const manager=new RunManager(store,daemon,{async execute(context){executions++;assert.equal(context.inputMode,'command');assert.equal(context.actualModel?.thinkingLevel,'high');return{finalText:'done'};}},()=>new Date(NOW),models,()=>{validations++;if(!available)throw new Error('directory changed');});
  store.setSessionModelPreference('work-a','session-a',JSON.stringify({modelRef:null,thinkingLevel:'high'}));
  const input={workId:'work-a',sessionId:'session-a',submissionKey:'mode-key',prompt:'/template\targument',inputMode:'command' as const};const accepted=await manager.submitChat(input);await manager.wait(accepted.run.runId);available=false;
  assert.equal((await manager.submitChat(input)).run.runId,accepted.run.runId);assert.equal(validations,1);assert.equal(executions,1);
  await assert.rejects(manager.submitChat({...input,inputMode:'text'}),/different content/);await assert.rejects(manager.submitChat({...input,inputMode:undefined}),/different content/);
  assert.equal(store.findRunSubmission('work-a','mode-key')?.runId,accepted.run.runId);assert.equal(store.findRunSubmission('work-b','mode-key'),undefined);
 });
});

test('unknown default automatic Runs use ordinary null independently of saved Chat Thinking',async()=>{
 await withStore(async(store)=>{
 const models:RunModelResolver={async list(){throw new Error('unused');},async credential(){return 'synthetic';},async resolve(ref){return {modelRef:ref,label:'Unknown',provider:'openai',model:'custom-unknown',api:'openai-responses'};},async thinking(){return{thinkingLevels:[],defaultThinkingLevel:null,thinkingAvailability:'unknown'};}};
 const daemon=new AgentDaemonControl({workId:'fixture',generation:1,instanceId:'instance'});daemon.configure({modelCredentialStatus:'available',contextIdentity:'context-fixture',loadedSkills:[],resolvedTools:[],initializationComplete:true});
 const manager=new RunManager(store,daemon,{async execute(context){assert.equal(context.actualModel?.thinkingLevel,null);assert.equal(context.actualModel?.modelRef,null);return {finalText:'ordinary'};}},undefined,models);
 store.setSessionModelPreference('work-a','session-a',JSON.stringify({modelRef:'model-other',thinkingLevel:'high'}));
 const received=store.feedback.receiveEvent({contractVersion:1,eventId:'event-unknown-auto',origin:{workId:'work-a',serviceId:'service-fixture'},serviceName:'fixture',type:'agent.requested',occurredAt:new Date().toISOString(),stateVersion:'one',actor:'user',payload:{goal:'ordinary',reason:'review',evidenceRefs:[]}},['review'],new Date().toISOString());
 const automatic=await manager.submitAutomatic({workId:'work-a',sessionId:'session-a',submissionKey:'unknown-auto',prompt:'ordinary',requestId:received.requestId!,phase:'handling'});assert.equal((await manager.wait(automatic.run.runId)).finalText,'ordinary');assert.equal(JSON.parse(automatic.run.actualModelJson!).thinkingLevel,null);assert.equal(JSON.parse(store.getSession('work-a','session-a')!.modelPreferenceJson!).thinkingLevel,'high');
 });
});

test('compatible preference is frozen at admission and replay does not resolve it again',async()=>{
 await withStore(async store=>{
  let resolves=0,release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const models:RunModelResolver={async list(){throw new Error('unused');},async credential(){return 'synthetic';},async resolve(ref){resolves++;if(resolves>1)throw new Error('model changed');return {modelRef:ref,label:'Unknown',provider:'openai',model:'future-model',api:'openai-responses'};},async thinking(){return{thinkingLevels:[],defaultThinkingLevel:null,thinkingAvailability:'unknown'};}};
  const daemon=new AgentDaemonControl({workId:'work-a',generation:1,instanceId:'instance'});daemon.configure({modelCredentialStatus:'available',contextIdentity:'context-a',loadedSkills:[],resolvedTools:[],initializationComplete:true});
  const manager=new RunManager(store,daemon,{async execute(context){await gate;assert.equal(context.actualModel?.thinkingProfile,'responses-effort-v1');assert.equal(context.actualModel?.thinkingLevel,'xhigh');return{finalText:'done'};}},()=>new Date(NOW),models);
  store.setSessionModelPreference('work-a','session-a',JSON.stringify({modelRef:null,thinkingLevel:'xhigh',thinkingProfile:'responses-effort-v1'}));
  const input={workId:'work-a',sessionId:'session-a',submissionKey:'compatible-frozen',prompt:'hello'};
  const accepted=await manager.submitChat(input);
  store.setSessionModelPreference('work-a','session-a',JSON.stringify({modelRef:null,thinkingLevel:null}));
  release();await manager.wait(accepted.run.runId);
  assert.equal(JSON.parse(accepted.run.actualModelJson!).thinkingProfile,'responses-effort-v1');
  assert.equal((await manager.submitChat(input)).run.runId,accepted.run.runId);assert.equal(resolves,1);
 });
});

test("multimodal acceptance fixes bytes and order while original-key replay never runs twice",async()=>{
 await withStore(async store=>{
  const executor=new ControlledExecutor(),manager=readyManager(store,executor);
  const png:ChatImageInput={mimeType:'image/png',data:readFileSync(new URL('../../../fixtures/chat-images/png.png',import.meta.url)).toString('base64')};
  const jpg:ChatImageInput={mimeType:'image/jpeg',data:readFileSync(new URL('../../../fixtures/chat-images/jpeg.jpg',import.meta.url)).toString('base64')};
  const input={workId:'work-a',sessionId:'session-a',submissionKey:'image-once',prompt:'',images:[png,jpg],selector:{kind:'session-preference' as const,inputMode:'text' as const}};
  const first=manager.submit(input);await executor.waitUntilRunning(first.run.runId);assert.deepEqual(store.privateInput(first.run.runId)?.images,[png,jpg]);
  assert.equal(manager.submit(input).run.runId,first.run.runId);assert.throws(()=>manager.submit({...input,images:[jpg,png]}),/different content/);
  assert.throws(()=>manager.submit({...input,images:[jpg]}),/different content/);assert.throws(()=>manager.submit({...input,submissionKey:'empty',images:[]}),/empty/);
  executor.resolve(first.run.runId,'seen');await manager.wait(first.run.runId);assert.equal(manager.submit(input).run.runId,first.run.runId);
 });
});

test('same Session survives environment changes while each Run and idempotent replay keep their own context',async()=>{
 await withStore(async store=>{
  const daemon=new AgentDaemonControl({workId:'work-a',generation:1,instanceId:'instance'});
  const configure=(contextIdentity:string)=>daemon.configure({modelCredentialStatus:'available',contextIdentity,loadedSkills:[],resolvedTools:[],initializationComplete:true});
  const seen:string[]=[];const manager=new RunManager(store,daemon,{async execute(context){seen.push(context.contextIdentity!);return{finalText:'ok'};}});
  configure('context-a');const first=manager.submit({workId:'work-a',sessionId:'session-a',submissionKey:'before-update',prompt:'before'});await manager.wait(first.run.runId);
  configure('context-b');const second=manager.submit({workId:'work-a',sessionId:'session-a',submissionKey:'after-update',prompt:'after'});await manager.wait(second.run.runId);
  assert.equal(second.run.sessionId,first.run.sessionId);assert.deepEqual(seen,['context-a','context-b']);
  const replay=manager.submit({workId:'work-a',sessionId:'session-a',submissionKey:'before-update',prompt:'before'});
  assert.equal(replay.run.runId,first.run.runId);assert.equal(replay.run.contextIdentity,'context-a');assert.equal(seen.length,2);
  assert.equal(store.listSessions('work-a').length,1);assert.equal(store.getRun(second.run.runId)?.contextIdentity,'context-b');
 });
});
