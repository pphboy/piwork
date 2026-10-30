import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { WorkStore, WorkBusyError } from "@piwork/work-store";
import { type ChatImageInput } from "@piwork/contracts";
import { AgentDaemonControl } from "./daemon.js";
import { RunManager, CANCEL_AND_SEND_TIMEOUT_MS, type RunExecutionContext, type RunExecutor } from "./runs.js";
import { RunModelError, type RunModelResolver } from "./run-models.js";

class Controlled implements RunExecutor {
 readonly contexts=new Map<string,RunExecutionContext>();
 readonly pending=new Map<string,(text:string)=>void>();
 aborts=0;
 execute(context:RunExecutionContext):Promise<{finalText:string}>{
  this.contexts.set(context.runId,context);
  context.signal.addEventListener("abort",()=>{this.aborts++;},{once:true});
  return new Promise(resolve=>this.pending.set(context.runId,text=>{this.pending.delete(context.runId);resolve({finalText:text});}));
 }
 finish(id:string,text="done"){this.pending.get(id)?.(text);}
}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function until(check:()=>boolean){for(let n=0;n<100;n++){if(check())return;await tick();}assert.fail("expected execution transition did not occur");}

async function fixture(run:(f:{store:WorkStore;manager:RunManager;daemon:AgentDaemonControl;executor:Controlled;state:{available:boolean;binding:string;compatible:boolean;wait?:Promise<void>};path:string})=>Promise<void>){
 const dir=await mkdtemp(join(tmpdir(),"piwork-cancel-send-")),path=join(dir,"work.sqlite"),store=WorkStore.open(path);
 const now=new Date().toISOString();
 for(const sessionId of ["main","other"])store.createSession({workId:"work-a",sessionId,sdkHistoryPath:join(dir,sessionId+".jsonl"),createdAt:now,updatedAt:now});
 const daemon=new AgentDaemonControl({workId:"work-a",generation:1,instanceId:"instance-a"});
 daemon.configure({modelCredentialStatus:"available",contextIdentity:"context-a",loadedSkills:[],resolvedTools:[],initializationComplete:true});
 const state:{available:boolean;binding:string;compatible:boolean;wait?:Promise<void>}={available:true,binding:"binding-1",compatible:false};
 const models:RunModelResolver={
  async list(){throw new Error("unused");},async credential(){return "synthetic";},
  async resolve(ref){await state.wait;if(!state.available)throw new RunModelError("MODEL_UNAVAILABLE","Fixture model unavailable");return {modelRef:ref,label:"Fixture",provider:state.compatible?"openai":"fixture",model:ref??"default",...(state.compatible?{api:"openai-responses" as const}:{}),executionBindingId:state.binding};},
  async thinking(){return state.compatible?{thinkingLevels:[],defaultThinkingLevel:null,thinkingAvailability:"unknown" as const}:{thinkingLevels:["off","high"],defaultThinkingLevel:"off"};},
  async images(){return "supported";},
 };
 const executor=new Controlled(),manager=new RunManager(store,daemon,executor,undefined,models,prompt=>{if(prompt==="/missing")throw new RunModelError("SLASH_COMMAND_UNKNOWN","Missing command");});
 try{await run({store,manager,daemon,executor,state,path});}
 finally{
  for(let pass=0;pass<3;pass++){for(const id of executor.pending.keys())executor.finish(id);await tick();}
  store.close();await rm(dir,{recursive:true,force:true});
 }
}
const next=(cancelRunId:string,key="replace")=>({workId:"work-a",sessionId:"main",submissionKey:key,prompt:"next message",inputMode:"text" as const,cancelRunId});

test("active Run queries are read-only and do not inspect Session history",async()=>{
 await fixture(async f=>{
  assert.equal(f.manager.activeRun("work-a"),undefined);assert.equal(f.executor.contexts.size,0);
  const old=f.manager.submit({workId:"work-a",sessionId:"other",submissionKey:"old",prompt:"original"});
  await until(()=>f.executor.pending.has(old.run.runId));
  assert.equal(f.manager.activeRun("work-a")?.runId,old.run.runId);
  assert.equal(f.manager.activeRun("work-a")?.sessionId,"other");
  assert.equal(f.executor.contexts.size,1);
 });
});

test("cancel-and-send waits for real cleanup, coalesces a key and protects the Work from other submissions",async()=>{
 await fixture(async f=>{
  const old=f.manager.submit({workId:"work-a",sessionId:"other",submissionKey:"old",prompt:"original"});
  await until(()=>f.executor.pending.has(old.run.runId));
  const admission=new AbortController(),input={...next(old.run.runId),signal:admission.signal},one=f.manager.submitChat(input),two=f.manager.submitChat({...input});
  await until(()=>f.executor.aborts===1);
  assert.equal(f.manager.activeRun("work-a")?.state,"cancelling");
  assert.equal(f.manager.isCancelAndSendPending("work-a"),true);
  assert.equal(f.store.findRunSubmission("work-a","replace"),undefined);
  assert.throws(()=>f.manager.submit({workId:"work-a",sessionId:"main",submissionKey:"ordinary",prompt:"racing"}),WorkBusyError);
  await assert.rejects(f.manager.submitChat(next(old.run.runId,"other-window")),WorkBusyError);
  await assert.rejects(f.manager.submitChat({...input,cancelRunId:"run-different"}),/different content/);
  let release!:()=>void;f.state.wait=new Promise<void>(resolve=>release=resolve);
  f.executor.finish(old.run.runId,"partial");
  await until(()=>!f.manager.activeRun('work-a'));
  assert.equal(f.manager.isCancelAndSendPending('work-a'),true);
  await assert.rejects(f.manager.submitAutomatic({workId:'work-a',sessionId:'other',submissionKey:'background-race',prompt:'background',requestId:'request-race',phase:'handling'}),WorkBusyError);
  assert.throws(()=>f.manager.submit({workId:'work-a',sessionId:'main',submissionKey:'racing-final-check',prompt:'ordinary'}),WorkBusyError);
  release();
  const [first,replay]=await Promise.all([one,two]);
  assert.equal(first.run.runId,replay.run.runId);
  assert.equal(first.run.sessionId,"main");
  assert.equal(f.executor.aborts,1);
  assert.equal(f.manager.get(old.run.runId)?.state,"cancelled");
  await until(()=>f.executor.contexts.has(first.run.runId));admission.abort();assert.equal(f.executor.contexts.get(first.run.runId)!.signal.aborted,false);
  assert.equal(f.manager.isCancelAndSendPending("work-a"),false);
  f.state.available=false;
  assert.equal((await f.manager.submitChat(input)).run.runId,first.run.runId);
  await assert.rejects(f.manager.submitChat({...input,prompt:"different"}),/different content/);
 });
});

test("cancel-and-send rechecks the captured compatible selection without adopting a later preference",async()=>{
 await fixture(async f=>{
  f.state.compatible=true;
  f.store.setSessionModelPreference('work-a','main',JSON.stringify({modelRef:null,thinkingLevel:'xhigh',thinkingProfile:'responses-effort-v1'}));
  const old=f.manager.submit({workId:'work-a',sessionId:'other',submissionKey:'old-compatible',prompt:'original'});
  await until(()=>f.executor.pending.has(old.run.runId));
  const input=next(old.run.runId,'compatible-replacement'),pending=f.manager.submitChat(input);
  await until(()=>f.executor.aborts===1);
  f.store.setSessionModelPreference('work-a','main',JSON.stringify({modelRef:null,thinkingLevel:null}));
  f.executor.finish(old.run.runId);
  const accepted=await pending;
  await until(()=>f.executor.contexts.has(accepted.run.runId));
  const model=f.executor.contexts.get(accepted.run.runId)!.actualModel;
  assert.equal(model?.thinkingProfile,'responses-effort-v1');assert.equal(model?.thinkingLevel,'xhigh');
  f.state.available=false;
  assert.equal((await f.manager.submitChat(input)).run.runId,accepted.run.runId);
 });
});

test("invalid replacement inputs and foreign targets never abort the current Run",async()=>{
 await fixture(async f=>{
  const old=f.manager.submit({workId:"work-a",sessionId:"other",submissionKey:"old",prompt:"original"});
  await until(()=>f.executor.pending.has(old.run.runId));
  const invalid=[
   {...next(old.run.runId),prompt:""},
   {...next(old.run.runId),prompt:"x".repeat(65537)},
   {...next(old.run.runId),images:[{mimeType:"image/png",data:"invalid"} as ChatImageInput]},
   {...next(old.run.runId),sessionId:"missing"},
   {...next(old.run.runId),prompt:"/missing",inputMode:"command" as const},
   {...next(old.run.runId),cancelRunId:""},
   {...next(old.run.runId),cancelRunId:"../other"},
   {...next("foreign-run")},
   {...next(old.run.runId),workId:"another-work"},
  ];
  for(let i=0;i<invalid.length;i++){
   await assert.rejects(f.manager.submitChat({...invalid[i]!,submissionKey:"invalid-"+i}));
   assert.equal(f.executor.aborts,0);
   assert.equal(f.manager.get(old.run.runId)?.state,"running");
  }
  f.store.setSessionModelPreference("work-a","main",JSON.stringify({modelRef:null,thinkingLevel:"unsupported"}));
  await assert.rejects(f.manager.submitChat(next(old.run.runId)),/Thinking/);
  assert.equal(f.executor.aborts,0);
  f.store.setSessionModelPreference("work-a","main",null);
  f.state.available=false;
  await assert.rejects(f.manager.submitChat(next(old.run.runId)),/unavailable/);
  assert.equal(f.executor.aborts,0);
 });
});

test("a completed target permits sending only while no different Run occupies the Work",async()=>{
 await fixture(async f=>{
  const old=f.manager.submit({workId:"work-a",sessionId:"other",submissionKey:"old",prompt:"original"});
  await until(()=>f.executor.pending.has(old.run.runId));f.executor.finish(old.run.runId);await f.manager.wait(old.run.runId);
  const racing=f.manager.submit({workId:"work-a",sessionId:"other",submissionKey:"racing",prompt:"new task"});
  await until(()=>f.executor.pending.has(racing.run.runId));
  await assert.rejects(f.manager.submitChat(next(old.run.runId)),WorkBusyError);
  assert.equal(f.executor.aborts,0);
  f.executor.finish(racing.run.runId);await f.manager.wait(racing.run.runId);
  const result=await f.manager.submitChat(next(old.run.runId));
  assert.equal(result.run.sessionId,"main");assert.equal(f.manager.get(old.run.runId)?.state,"succeeded");
 });
});

test("five-second cancellation timeout retains the slot and never submits after late cleanup",async t=>{
 await fixture(async f=>{
  const old=f.manager.submit({workId:"work-a",sessionId:"other",submissionKey:"old",prompt:"original"});
  await until(()=>f.executor.pending.has(old.run.runId));
  t.mock.timers.enable({apis:["setTimeout"]});
  const replacement=f.manager.submitChat(next(old.run.runId));
  await until(()=>f.executor.aborts===1);
  const failed=assert.rejects(replacement,{cancellationCode:"CANCEL_TIMEOUT"});
  t.mock.timers.tick(CANCEL_AND_SEND_TIMEOUT_MS-1);
  assert.equal(f.manager.isCancelAndSendPending("work-a"),true);
  t.mock.timers.tick(1);await failed;
  assert.equal(f.manager.isCancelAndSendPending("work-a"),false);
  assert.equal(f.manager.activeRun("work-a")?.state,"cancelling");
  assert.equal(f.store.findRunSubmission("work-a","replace"),undefined);
  f.executor.finish(old.run.runId);await f.manager.wait(old.run.runId);await tick();
  assert.equal(f.manager.activeRun("work-a"),undefined);
  assert.equal(f.store.findRunSubmission("work-a","replace"),undefined);
  t.mock.timers.reset();
 });
});

test("replacement captures settings and exact image input while later edits remain next-run preferences",async()=>{
 await fixture(async f=>{
  const firstRef="model-0000000000000001",nextRef="model-0000000000000002";
  f.store.setSessionModelPreference("work-a","main",JSON.stringify({modelRef:firstRef,thinkingLevel:"off"}));
  const old=f.manager.submit({workId:"work-a",sessionId:"other",submissionKey:"old",prompt:"original"});
  await until(()=>f.executor.pending.has(old.run.runId));
  const png:ChatImageInput={mimeType:"image/png",data:readFileSync(new URL("../../../fixtures/chat-images/png.png",import.meta.url)).toString("base64")};
  const replacement=f.manager.submitChat({...next(old.run.runId),images:[png]});
  await until(()=>f.executor.aborts===1);
  f.store.setSessionModelPreference("work-a","main",JSON.stringify({modelRef:nextRef,thinkingLevel:"high"}));
  f.executor.finish(old.run.runId);const accepted=await replacement;
  const actual=JSON.parse(accepted.run.actualModelJson!);
  assert.equal(actual.modelRef,firstRef);assert.equal(actual.thinkingLevel,"off");
  assert.equal(JSON.parse(f.store.getSession("work-a","main")!.modelPreferenceJson!).modelRef,nextRef);
  assert.deepEqual(f.store.privateInput(accepted.run.runId)?.images,[png]);
 });
});

test("lifecycle, model binding and disconnected admission changes prevent a new Run",async t=>{
 for(const change of ["drain","context","model","binding","disconnect"] as const)await t.test(change,async()=>fixture(async f=>{
  const old=f.manager.submit({workId:"work-a",sessionId:"other",submissionKey:"old",prompt:"original"});
  await until(()=>f.executor.pending.has(old.run.runId));
  const controller=new AbortController(),replacement=f.manager.submitChat({...next(old.run.runId),signal:controller.signal});
  await until(()=>f.executor.aborts===1);
  const failed=assert.rejects(replacement);
  if(change==="drain")void f.daemon.drain();
  if(change==="context")f.daemon.configure({modelCredentialStatus:"available",contextIdentity:"context-new",loadedSkills:[],resolvedTools:[],initializationComplete:true});
  if(change==="model")f.state.available=false;
  if(change==="binding")f.state.binding="binding-new";
  if(change==="disconnect")controller.abort();
  f.executor.finish(old.run.runId);await failed;await f.manager.wait(old.run.runId);
  assert.equal(f.store.findRunSubmission("work-a","replace"),undefined);
  assert.equal(f.manager.isCancelAndSendPending("work-a"),false);
 }));
});

test("replacing a Service Run cancels its request and retains original Job references",async()=>{
 await fixture(async f=>{
  const now=new Date().toISOString();
  const receipt=f.store.feedback.receiveEvent({contractVersion:1,eventId:"event-1",origin:{workId:"work-a",serviceId:"service-fixture"},serviceName:"todo",type:"agent.requested",occurredAt:now,stateVersion:"1",actor:"user",payload:{reason:"export",goal:"Export weekly report",evidenceRefs:[]}},["export"],now);
  const old=await f.manager.submitAutomatic({workId:"work-a",sessionId:"other",submissionKey:"automatic",prompt:"export",requestId:receipt.requestId!,phase:"handling"});
  await until(()=>f.executor.pending.has(old.run.runId));
  f.store.feedback.recordAction("work-a",receipt.requestId!,{serviceName:"todo",actionId:"action-original",actionName:"export",input:{},expectedStateVersion:null,verificationQuery:"exports",jobId:"job-original",status:"known"});
  const replacement=f.manager.submitChat(next(old.run.runId));await until(()=>f.executor.aborts===1);
  assert.equal(f.store.feedback.getRequest("work-a",receipt.requestId!)?.state,"cancelling");
  f.executor.finish(old.run.runId);const accepted=await replacement;
  assert.equal(f.store.feedback.getRequest("work-a",receipt.requestId!)?.state,"cancelled");
  assert.equal(f.store.feedback.internal("work-a",receipt.requestId!)?.actionRefs[0]?.jobId,"job-original");
  assert.equal(JSON.parse(accepted.run.sourceJson!).kind,"chat");
  assert.deepEqual(f.store.feedback.pending("work-a"),[]);
  f.executor.finish(accepted.run.runId);await f.manager.wait(accepted.run.runId);
  assert.equal(f.store.feedback.getRequest("work-a",receipt.requestId!)?.state,"cancelled");
 });
});

test("process recovery retains old history and never restores an unaccepted replacement",async()=>{
 await fixture(async f=>{
  const old=f.manager.submit({workId:"work-a",sessionId:"other",submissionKey:"old",prompt:"original"});
  await until(()=>f.executor.pending.has(old.run.runId));
  const controller=new AbortController(),replacement=f.manager.submitChat({...next(old.run.runId),signal:controller.signal});
  await until(()=>f.executor.aborts===1);
  const failed=assert.rejects(replacement);controller.abort();await failed;
  f.executor.pending.delete(old.run.runId); // The old process no longer owns an executor.
  f.store.close();
  const restored=WorkStore.open(f.path);
  try {
   let executions=0;
   const manager=new RunManager(restored,f.daemon,{async execute(){executions++;return {finalText:"unexpected"};}});
   manager.recover();await tick();
   assert.equal(restored.getRun(old.run.runId)?.state,"interrupted");
   assert.equal(restored.findRunSubmission("work-a","old")?.runId,old.run.runId);
   assert.equal(restored.findRunSubmission("work-a","replace"),undefined);
   assert.equal(executions,0);
  } finally {restored.close();}
 });
});

test("one Work waiting for cancellation does not block a different Work",async()=>{
 await fixture(async f=>{
  const now=new Date().toISOString();
  const directoryB=join(f.path,'..','work-b');await mkdir(directoryB);
  const storeB=WorkStore.open(join(directoryB,'work.sqlite'));
  storeB.createSession({workId:'work-b',sessionId:'main-b',sdkHistoryPath:join(directoryB,'main-b.jsonl'),createdAt:now,updatedAt:now});
  const daemon=new AgentDaemonControl({workId:'work-b',generation:1,instanceId:'instance-b'});
  daemon.configure({modelCredentialStatus:'available',contextIdentity:'context-b',loadedSkills:[],resolvedTools:[],initializationComplete:true});
  const executor=new Controlled(),other=new RunManager(storeB,daemon,executor);
  const old=f.manager.submit({workId:'work-a',sessionId:'other',submissionKey:'old-parallel',prompt:'original'});
  await until(()=>f.executor.pending.has(old.run.runId));const replacing=f.manager.submitChat(next(old.run.runId));await until(()=>f.manager.isCancelAndSendPending('work-a'));
  try {
   const accepted=await other.submitChat({workId:'work-b',sessionId:'main-b',submissionKey:'parallel-key',prompt:'independent Work'});
   await until(()=>executor.pending.has(accepted.run.runId));executor.finish(accepted.run.runId);
   await other.wait(accepted.run.runId);assert.equal(other.get(accepted.run.runId)?.state,'succeeded');assert.equal(f.manager.activeRun('work-a')?.state,'cancelling');
  } finally {for(const id of executor.pending.keys())executor.finish(id);f.executor.finish(old.run.runId);await replacing;storeB.close();}
 });
});
