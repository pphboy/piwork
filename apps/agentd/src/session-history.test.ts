import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { WorkStore } from "@piwork/work-store";
import { appendAssistantMessage } from "@piwork/pi-adapter";
import { chatInputDigest, HISTORY_LIMITS, historyJSON, SessionHistoryPage, type HistoryPage, type HistoryQuery } from "@piwork/contracts";
import { AgentSessionService } from "./sessions.js";
import { SessionHistoryReader } from "./session-history.js";
import { populateLongHistory } from "./history-fixture.js";
import { historyEventMessages } from "./application.js";

function fixture() {
 const root=mkdtempSync(join(tmpdir(),"session-pages-"));mkdirSync(join(root,"workspace"));
 const store=WorkStore.open(join(root,"work.sqlite"),{workId:"work-1"});
 const sessions=new AgentSessionService("work-1",store,join(root,"workspace"),join(root,"sessions"));
 const session=sessions.create(),sdk=sessions.continue(session.sessionId);
 return {root,store,sessions,session,sdk,reader:new SessionHistoryReader("work-1",store),close(){store.close();rmSync(root,{recursive:true,force:true});}};
}
function readAll(reader:SessionHistoryReader,id:string,query:HistoryQuery) {
 const pages:HistoryPage[]=[];let cursor:string|undefined;
 do {const page=reader.page(id,{...query,...(cursor?{cursor}:{})});
  assert.ok(Buffer.byteLength(historyJSON(page))<=HISTORY_LIMITS.pageBytes);
  assert.ok(SessionHistoryPage.encode({pageJson:historyJSON(page)}).finish().length<=HISTORY_LIMITS.rpcBytes);
  pages.push(page);assert.notEqual(page.nextCursor,cursor);cursor=page.nextCursor ?? undefined;
 }while(cursor);
 return pages;
}
function content(pages:HistoryPage[]) {
 const blocks=new Map<string,Map<number,string>>();
 for(const page of pages)for(const s of page.segments){const key=`${s.entryId}:${s.blockId}`,parts=blocks.get(key)??new Map();assert.equal(parts.has(s.byteOffset),false);parts.set(s.byteOffset,s.text);blocks.set(key,parts);}
 return [...blocks].map(([id,parts])=>[id,[...parts].sort(([a],[b])=>a-b).map(([,s])=>s).join("")] as const);
}

test('a Run that fails before any SDK message has a paged state anchor without invented prose',()=>{
 const f=fixture();try{
  const run=f.store.acceptRun({workId:'work-1',sessionId:f.session.sessionId,submissionKey:'preflight-failure',requestDigest:'digest',promptDigest:'digest'}).run;
  f.store.completeRun(run.runId,'failed',null,JSON.stringify({code:'MODEL_EXECUTION_FAILED',message:'Model execution failed.',retryable:true}));
  const pages=readAll(f.reader,f.session.sessionId,{direction:'newer',runId:run.runId});
  assert.deepEqual(pages.flatMap(page=>page.segments).map(segment=>[segment.type,segment.text,segment.runId]),[['empty','',run.runId]]);
  assert.ok(pages.flatMap(page=>page.runs).some(value=>value.runId===run.runId&&value.state===5&&value.error?.message==='Model execution failed.'));
 }finally{f.close();}
});

test('cancelled, failed and interrupted output recovers in event order when SDK has no assistant turn',()=>{
 for(const state of ['cancelled','failed','interrupted'] as const){const f=fixture();try{
  f.store.close();
  let store=WorkStore.open(join(f.root,'work.sqlite'),{workId:'work-1',historyMigration:{operationId:'test-op',workId:'work-1',fromSchema:5,toSchema:7,storeId:'backup-test',backupManifestDigest:'a'.repeat(64)}});
  const run=store.acceptRun({workId:'work-1',sessionId:f.session.sessionId,submissionKey:state,requestDigest:'digest',promptDigest:'digest'}).run;
  const first='汉🙂'.repeat(12000),second='后续回复';
  store.appendEvent(run.runId,'text',JSON.stringify({delta:first.slice(0,4000)}));
  store.appendEvent(run.runId,'text',JSON.stringify({delta:first.slice(4000)}));
  store.appendEvent(run.runId,'tool-start',JSON.stringify({toolName:'read',toolCallId:'call-1'}));
  store.appendEvent(run.runId,'tool-end',JSON.stringify({toolName:'read',toolCallId:'call-1',isError:false,result:{kind:'text',text:'done',truncated:false,isError:false}}));
  store.appendEvent(run.runId,'text',JSON.stringify({delta:second}));
  store.completeRun(run.runId,state,null,null);store.compactRunEvents(run.runId,1);store.close();
  store=WorkStore.open(join(f.root,'work.sqlite'),{workId:'work-1'});
  try {
   const reader=new SessionHistoryReader('work-1',store),forward=readAll(reader,f.session.sessionId,{direction:'newer',runId:run.runId}),backward=readAll(reader,f.session.sessionId,{direction:'older',runId:run.runId});
   assert.deepEqual(new Map(content(forward)),new Map(content(backward)));
   assert.deepEqual(content(forward).map(([,text])=>text),[first,'','done',second]);
   assert.deepEqual([...new Set(forward.flatMap(p=>p.segments.map(s=>s.type)))],['text','tool-call','tool-result']);
   assert.ok(forward.flatMap(p=>p.runs).some(r=>r.runId===run.runId&&r.state==={failed:5,cancelled:6,interrupted:7}[state]&&r.resultRef===null));
  }finally{store.close();}
 }finally{f.close();}}
});

test('checkpoint recovery appends only the verified remainder of an SDK text prefix',()=>{
 const f=fixture();try {
  f.store.close();const store=WorkStore.open(join(f.root,'work.sqlite'),{workId:'work-1',historyMigration:{operationId:'test-op',workId:'work-1',fromSchema:5,toSchema:7,storeId:'backup-test',backupManifestDigest:'a'.repeat(64)}});
  try {const run=store.acceptRun({workId:'work-1',sessionId:f.session.sessionId,submissionKey:'prefix',requestDigest:'digest',promptDigest:'digest'}).run;
   f.sdk.appendCustomEntry('piwork-run',{runId:run.runId});appendAssistantMessage(f.sdk,'开头');
   store.appendEvent(run.runId,'text',JSON.stringify({delta:'开头还有后续'}));store.completeRun(run.runId,'cancelled',null,null);
   const pages=readAll(new SessionHistoryReader('work-1',store),f.session.sessionId,{direction:'newer',runId:run.runId});
   assert.deepEqual(content(pages).map(([,text])=>text),['开头','还有后续']);
   const segments=pages.flatMap(page=>page.segments);
   assert.deepEqual(segments.map(s=>[s.streamId,s.streamOffset]),[[`${run.runId}-text-1`,0],[`${run.runId}-text-1`,6]]);
  }finally{store.close();}
 }finally{f.close();}
});

test('successful SDK text also identifies the verified event stream for cursor recovery',()=>{
 const f=fixture();try {
  f.store.close();const store=WorkStore.open(join(f.root,'work.sqlite'),{workId:'work-1',historyMigration:{operationId:'test-op',workId:'work-1',fromSchema:5,toSchema:7,storeId:'backup-test',backupManifestDigest:'a'.repeat(64)}});
  try {const run=store.acceptRun({workId:'work-1',sessionId:f.session.sessionId,submissionKey:'success-stream',requestDigest:'digest',promptDigest:'digest'}).run;
   f.sdk.appendCustomEntry('piwork-run',{runId:run.runId});appendAssistantMessage(f.sdk,'完整回答');
   store.appendEvent(run.runId,'text',JSON.stringify({delta:'完整回答'}));store.completeRun(run.runId,'succeeded','完整回答',null);
   const segments=readAll(new SessionHistoryReader('work-1',store),f.session.sessionId,{direction:'newer',runId:run.runId}).flatMap(page=>page.segments);
   assert.deepEqual(segments.filter(s=>s.type==='text').map(s=>[s.text,s.streamId,s.streamOffset]),[['完整回答',`${run.runId}-text-1`,0]]);
  }finally{store.close();}
 }finally{f.close();}
});

test('a nonempty result retains a verified SDK prefix and checkpoint remainder for client reconciliation',()=>{
 const f=fixture();try {
  f.store.close();const store=WorkStore.open(join(f.root,'work.sqlite'),{workId:'work-1',historyMigration:{operationId:'test-op',workId:'work-1',fromSchema:5,toSchema:7,storeId:'backup-test',backupManifestDigest:'a'.repeat(64)}});
  try {const run=store.acceptRun({workId:'work-1',sessionId:f.session.sessionId,submissionKey:'prefix-result',requestDigest:'digest',promptDigest:'digest'}).run;
   f.sdk.appendCustomEntry('piwork-run',{runId:run.runId});appendAssistantMessage(f.sdk,'开头');
   store.appendEvent(run.runId,'text',JSON.stringify({delta:'开头后续'}));store.completeRun(run.runId,'cancelled','开头后续',null);
   const pages=readAll(new SessionHistoryReader('work-1',store),f.session.sessionId,{direction:'newer',runId:run.runId});
   const segments=pages.flatMap(page=>page.segments);
   assert.deepEqual(content(pages).map(([,text])=>text),['开头','后续','开头后续']);
   assert.ok(segments.some(segment=>segment.blockId===`${run.runId}-text-1-remaining-6`&&!segment.recoveryUnconfirmed));
   assert.ok(segments.some(segment=>segment.type==='run-result'));
  }finally{store.close();}
 }finally{f.close();}
});

test('unmatched SDK content does not erase checkpoint output and marks the uncertain relationship',()=>{
 const f=fixture();try {
  f.store.close();const store=WorkStore.open(join(f.root,'work.sqlite'),{workId:'work-1',historyMigration:{operationId:'test-op',workId:'work-1',fromSchema:5,toSchema:7,storeId:'backup-test',backupManifestDigest:'a'.repeat(64)}});
  try {const run=store.acceptRun({workId:'work-1',sessionId:f.session.sessionId,submissionKey:'mismatch',requestDigest:'digest',promptDigest:'digest'}).run;
   f.sdk.appendCustomEntry('piwork-run',{runId:run.runId});appendAssistantMessage(f.sdk,'已有历史');
   store.appendEvent(run.runId,'text',JSON.stringify({delta:'已输出内容'}));store.completeRun(run.runId,'failed',null,null);
   const pages=readAll(new SessionHistoryReader('work-1',store),f.session.sessionId,{direction:'newer',runId:run.runId});
   assert.deepEqual(content(pages).map(([,value])=>value),['已有历史','已输出内容']);
   const segments=pages.flatMap(page=>page.segments);
   assert.equal(segments.find(segment=>segment.text==='已有历史')?.recoveryUnconfirmed,undefined);
   assert.equal(segments.find(segment=>segment.text==='已有历史')?.streamId,undefined);
   assert.equal(segments.find(segment=>segment.text==='已输出内容')?.recoveryUnconfirmed,true);
  }finally{store.close();}
 }finally{f.close();}
});

test('an empty cancelled result does not hide durable partial output',()=>{
 for(const savedPrefix of [false,true]){const f=fixture();try {
  f.store.close();const store=WorkStore.open(join(f.root,'work.sqlite'),{workId:'work-1',historyMigration:{operationId:'test-op',workId:'work-1',fromSchema:5,toSchema:7,storeId:'backup-test',backupManifestDigest:'a'.repeat(64)}});
  try {const run=store.acceptRun({workId:'work-1',sessionId:f.session.sessionId,submissionKey:'empty-result',requestDigest:'digest',promptDigest:'digest'}).run;
   if(savedPrefix){f.sdk.appendCustomEntry('piwork-run',{runId:run.runId});appendAssistantMessage(f.sdk,'已输出');}
   store.appendEvent(run.runId,'text',JSON.stringify({delta:'已输出的内容'}));store.completeRun(run.runId,'cancelled','',null);
   const reader=new SessionHistoryReader('work-1',store),pages=readAll(reader,f.session.sessionId,{direction:'newer',runId:run.runId});
   assert.equal(content(pages).map(([,value])=>value).join(''),'已输出的内容');
   const result=readAll(reader,f.session.sessionId,{direction:'newer',content:'result',runId:run.runId,snapshot:pages[0]!.snapshotId});
   assert.equal(content(result).map(([,value])=>value).join(''),'');
   assert.ok(result.flatMap(p=>p.runs).some(value=>value.state===6));
  }finally{store.close();}
 }finally{f.close();}}
});

test('nonempty cancelled result reuses the matching checkpoint while retaining earlier tool turns',()=>{
 const f=fixture();try {
  f.store.close();const store=WorkStore.open(join(f.root,'work.sqlite'),{workId:'work-1',historyMigration:{operationId:'test-op',workId:'work-1',fromSchema:5,toSchema:7,storeId:'backup-test',backupManifestDigest:'a'.repeat(64)}});
  try {const run=store.acceptRun({workId:'work-1',sessionId:f.session.sessionId,submissionKey:'nonempty-result',requestDigest:'digest',promptDigest:'digest'}).run;
   store.appendEvent(run.runId,'text',JSON.stringify({delta:'工具前'}));
   store.appendEvent(run.runId,'tool-start',JSON.stringify({toolName:'read',toolCallId:'call-1'}));
   store.appendEvent(run.runId,'tool-end',JSON.stringify({toolName:'read',toolCallId:'call-1',result:{kind:'text',text:'完成',truncated:false,isError:false}}));
   const last='部分答案🙂'.repeat(8000);store.appendEvent(run.runId,'text',JSON.stringify({delta:last}));
   store.completeRun(run.runId,'cancelled',last,null);store.compactRunEvents(run.runId,1);
   const reader=new SessionHistoryReader('work-1',store),pages=readAll(reader,f.session.sessionId,{direction:'newer',runId:run.runId});
   assert.deepEqual(content(pages).map(([,value])=>value),['工具前','','完成',last]);
   const lastEntry=pages.flatMap(page=>page.segments).find(segment=>segment.text.startsWith('部分答案'))!.entryId;
   assert.equal(pages.flatMap(page=>page.runs).findLast(value=>value.resultRef?.entryId)?.resultRef?.entryId,lastEntry);
   const result=readAll(reader,f.session.sessionId,{direction:'newer',content:'result',runId:run.runId,snapshot:pages[0]!.snapshotId});
   assert.equal(content(result).map(([,value])=>value).join(''),last);assert.equal(result[0]!.segments[0]!.entryId,lastEntry);
  }finally{store.close();}
 }finally{f.close();}
});

test('checkpoint recovery aligns SDK tool identities and repeated text without duplication',()=>{
 const f=fixture();try {
  f.store.close();const store=WorkStore.open(join(f.root,'work.sqlite'),{workId:'work-1',historyMigration:{operationId:'test-op',workId:'work-1',fromSchema:5,toSchema:7,storeId:'backup-test',backupManifestDigest:'a'.repeat(64)}});
  try {const run=store.acceptRun({workId:'work-1',sessionId:f.session.sessionId,submissionKey:'mixed',requestDigest:'digest',promptDigest:'digest'}).run;
   f.sdk.appendCustomEntry('piwork-run',{runId:run.runId});
   const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
   f.sdk.appendMessage({role:'assistant',content:[{type:'text',text:'相同'},{type:'toolCall',id:'call-1',name:'read',arguments:{}}],api:'fixture',provider:'fixture',model:'fixture',usage,stopReason:'toolUse',timestamp:1});
   f.sdk.appendMessage({role:'toolResult',toolCallId:'call-1',toolName:'read',content:[{type:'text',text:'完成'}],isError:false,timestamp:2});
   appendAssistantMessage(f.sdk,'相同');
   store.appendEvent(run.runId,'text',JSON.stringify({delta:'相同'}));
   store.appendEvent(run.runId,'tool-start',JSON.stringify({toolName:'read',toolCallId:'call-1'}));
   store.appendEvent(run.runId,'tool-start',JSON.stringify({toolName:'read',toolCallId:'call-1'}));
   store.appendEvent(run.runId,'tool-end',JSON.stringify({toolName:'read',toolCallId:'call-1',result:{kind:'text',text:'完成',truncated:false,isError:false}}));
   store.appendEvent(run.runId,'text',JSON.stringify({delta:'相同'}));store.completeRun(run.runId,'failed',null,null);
   const reader=new SessionHistoryReader('work-1',store),pages=readAll(reader,f.session.sessionId,{direction:'newer',runId:run.runId});
   assert.deepEqual(content(pages).map(([,text])=>text),['相同','','完成','相同']);
   assert.deepEqual(pages.flatMap(p=>p.segments).filter(s=>s.type==='text').map(s=>[s.streamId,s.streamOffset]),[[`${run.runId}-text-1`,0],[`${run.runId}-text-5`,0]]);
   assert.equal(pages.flatMap(p=>p.segments).filter(s=>s.type==='tool-call').length,1);
   const older=readAll(reader,f.session.sessionId,{direction:'older',runId:run.runId});
   assert.deepEqual(new Map(content(older)),new Map(content(pages)));
  }finally{store.close();}
 }finally{f.close();}
});

test("454 messages / 235 tools, giant message and both directions stay bounded and preserve SDK originals",()=>{
 const f=fixture();try{
  const run=f.store.acceptRun({workId:"work-1",sessionId:f.session.sessionId,submissionKey:"original",requestDigest:"digest",promptDigest:"digest"}).run;
  const expected=populateLongHistory(f.sdk,run.runId,7*1024*1024);assert.equal(expected.calls,235);
  f.store.completeRun(run.runId,"succeeded",expected.finalText,null);
  const original=readFileSync(f.session.sdkHistoryPath),digest=createHash("sha256").update(original).digest("hex");
  const forward=readAll(f.reader,f.session.sessionId,{direction:"newer"});
  assert.equal(new Set(forward.flatMap(p=>p.segments.map(s=>s.entryId))).size,454);
  assert.ok(forward.length>20);assert.equal(f.sessions.read(f.session.sessionId).entries.length,454);
  const backward=readAll(f.reader,f.session.sessionId,{direction:"older"});
  assert.deepEqual(new Map(content(backward)),new Map(content(forward)));
  const assembled=content(forward);assert.ok(assembled.some(([,text])=>text===expected.finalText));
  const result=readAll(f.reader,f.session.sessionId,{direction:"newer",snapshot:forward[0]!.snapshotId,content:"result",runId:run.runId});
  assert.equal(content(result).map(([,s])=>s).join(""),expected.finalText);
  assert.equal(createHash("sha256").update(readFileSync(f.session.sdkHistoryPath)).digest("hex"),digest);
 }finally{f.close();}
});

test("snapshot appends, cross-range cursors, missing SDK result and expiration remain explicit",()=>{
 const f=fixture();try{
  appendAssistantMessage(f.sdk,"before");
  const first=f.reader.page(f.session.sessionId,{direction:"newer",limit:1});
  appendAssistantMessage(f.sdk,"after");
  const frozen=readAll(f.reader,f.session.sessionId,{direction:"newer",snapshot:first.snapshotId});
  assert.deepEqual(content(frozen).map(([,text])=>text),["before"]);
  const fresh=f.reader.page(f.session.sessionId,{direction:"newer",limit:1});assert.ok(fresh.nextCursor);
  assert.throws(()=>f.reader.page(f.session.sessionId,{direction:"older",cursor:fresh.nextCursor!}),/another history range/);
  assert.throws(()=>f.reader.page(f.session.sessionId,{cursor:"unknown"}),/expired/);
  const run=f.store.acceptRun({workId:"work-1",sessionId:f.session.sessionId,submissionKey:"without-sdk",requestDigest:"digest",promptDigest:"digest"}).run;
  const final="汉".repeat(400000);f.store.completeRun(run.runId,"succeeded",final,null);
  const pages=readAll(f.reader,f.session.sessionId,{direction:"older",content:"result",runId:run.runId});
  assert.equal(content(pages).map(([,text])=>text).join(""),final);
  assert.equal(pages[0]!.segments[0]!.type,"run-result");
 }finally{f.close();}
});

test("lightweight terminal and same-sequence text frames preserve all bytes without another event",()=>{
 const f=fixture();try {
  const run=f.store.acceptRun({workId:"work-1",sessionId:f.session.sessionId,submissionKey:"frame",requestDigest:"digest",promptDigest:"digest"}).run;
  f.store.completeRun(run.runId,"succeeded","a".repeat(7*1024*1024),null);
  const saved=f.store.getRun(run.runId)!;
  const terminal=[...historyEventMessages({runId:run.runId,sequence:4,eventType:"state",payloadJson:"{}",createdAt:saved.acceptedAt},saved,"history-v1")];
  assert.equal(terminal[0]!.kind?.$case,"state");assert.ok(Buffer.byteLength(JSON.stringify(terminal,(_,value)=>typeof value==="bigint"?String(value):value))<4096);
  const text="汉😀".repeat(20000),frames=[...historyEventMessages({runId:run.runId,sequence:3,eventType:"text",payloadJson:JSON.stringify({delta:text}),createdAt:saved.acceptedAt},saved,"history-v1")];
  assert.ok(frames.length>1);assert.ok(frames.every(frame=>frame.sequence===3n));
  assert.equal(frames.map(frame=>frame.kind?.$case==="text"?frame.kind.text.delta:"").join(""),text);
 }finally{f.close();}
});

test("snapshot lifetime and cross-Session handles never silently become empty",()=>{
 const f=fixture();try{
  appendAssistantMessage(f.sdk,"one");appendAssistantMessage(f.sdk,"two");
  let now=0;const reader=new SessionHistoryReader("work-1",f.store,()=>now);
  const first=reader.page(f.session.sessionId,{direction:"newer",limit:1});
  const other=f.sessions.create();
  assert.throws(()=>reader.page(other.sessionId,{direction:"newer",snapshot:first.snapshotId}),/another Session/);
  now=11*60*1000;
  assert.throws(()=>reader.page(f.session.sessionId,{direction:"newer",cursor:first.nextCursor!}),/expired/);
  assert.equal(reader.page(f.session.sessionId,{direction:"newer"}).segments.length,2);
 }finally{f.close();}
});

test('accepted input freezes safe image descriptors after private input release',()=>{
 const f=fixture();try{
  const image={mimeType:'image/png' as const,data:readFileSync(new URL('../../../fixtures/chat-images/png.png',import.meta.url)).toString('base64')};
  const input={profile:'chat-images-v1',prompt:'look',images:[image]};
  const run=f.store.acceptRun({workId:'work-1',sessionId:f.session.sessionId,submissionKey:'image',requestDigest:'fixture',promptDigest:chatInputDigest(input.prompt,input.images),privateInputJson:JSON.stringify(input)}).run;
  const first=f.reader.page(f.session.sessionId,{imageProfile:'chat-images-v1'});assert.equal(first.runs[0]?.runId,run.runId);assert.ok(first.segments.some(part=>part.type==='image'));
  f.store.releasePrivateInput(run.runId);
  const frozen=f.reader.page(f.session.sessionId,{snapshot:first.snapshotId,imageProfile:'chat-images-v1'});
  assert.deepEqual(frozen.segments,first.segments);assert.ok(!JSON.stringify(frozen).includes(image.data));
  f.store.completeRun(run.runId,'succeeded','',null);
  const result=f.reader.page(f.session.sessionId,{content:'result',runId:run.runId});assert.equal(result.segments[0]?.text,'');assert.equal(result.segments[0]?.complete,true);
 }finally{f.close();}
});

test('snapshot eviction and a new reader reject old handles explicitly',()=>{
 const f=fixture();try{
  appendAssistantMessage(f.sdk,'one');const first=f.reader.page(f.session.sessionId,{});
  for(let i=0;i<16;i++)f.reader.page(f.session.sessionId,{});
  assert.throws(()=>f.reader.page(f.session.sessionId,{snapshot:first.snapshotId}),/expired/);
  assert.throws(()=>new SessionHistoryReader('work-1',f.store).page(f.session.sessionId,{snapshot:first.snapshotId}),/expired/);
 }finally{f.close();}
});

test('response profile changes representation without changing durable submission identity',async()=>{
 const f=fixture();try{
  const {AgentApplication}=await import('./application.js');const {RunManager}=await import('./runs.js');const {AgentDaemonControl}=await import('./daemon.js');
  const daemon=new AgentDaemonControl({workId:'work-1',generation:1,instanceId:'fixture'});daemon.configure({modelCredentialStatus:'available',contextIdentity:'context',loadedSkills:[],resolvedTools:[],initializationComplete:true});
  let executions=0;const final='z'.repeat(7*1024*1024),manager=new RunManager(f.store,daemon,{async execute(){executions++;return{finalText:final};}},()=>new Date(),undefined,undefined,false);
  const app=Object.create(AgentApplication.prototype) as any;app.config={workId:'work-1'};app.authenticate=()=>{};app.runs=manager;app.store=f.store;
  const invoke=(name:string,request:any)=>new Promise<any>((done,fail)=>app.handlers()[name]({request,on(){},removeListener(){}},(err:any,value:any)=>err?fail(err):done(value)));
  const input={workId:'work-1',sessionId:f.session.sessionId,submissionKey:'once',prompt:'hello',images:[]};
  const first=await invoke('submitRun',input);await manager.wait(first.run.runId);
  const replay=await invoke('submitRun',{...input,responseProfile:'history-v1'});
  assert.equal(replay.reused,true);assert.equal(replay.run.runId,first.run.runId);assert.equal(executions,1);assert.equal(replay.run.finalText,'');assert.equal(JSON.parse(replay.run.resultRefJson).runId,first.run.runId);
  assert.equal((await invoke('getRun',{workId:'work-1',runId:first.run.runId})).finalText,final);
  assert.ok(JSON.stringify(await invoke('getRun',{workId:'work-1',runId:first.run.runId,responseProfile:'history-v1'}),(_,v)=>typeof v==='bigint'?String(v):v).length<4096);
 }finally{f.close();}
});

test('durable final result remains visible when only earlier SDK assistant turns exist',()=>{
 const f=fixture();try{
  const run=f.store.acceptRun({workId:'work-1',sessionId:f.session.sessionId,submissionKey:'partial-sdk',requestDigest:'x',promptDigest:'x'}).run;
  f.sdk.appendCustomEntry('piwork-run',{runId:run.runId});appendAssistantMessage(f.sdk,'Earlier assistant turn');
  f.store.completeRun(run.runId,'succeeded','Saved final answer without SDK turn',null);
  const messages=content(readAll(f.reader,f.session.sessionId,{direction:'newer'}));
  assert.deepEqual(messages.map(([,text])=>text),['Earlier assistant turn','Saved final answer without SDK turn']);
 }finally{f.close();}
});

test('result references identify a later SDK final without changing the frozen fallback',()=>{
 const f=fixture();try{
  const run=f.store.acceptRun({workId:'work-1',sessionId:f.session.sessionId,submissionKey:'late-final',requestDigest:'x',promptDigest:'x'}).run;
  f.sdk.appendCustomEntry('piwork-run',{runId:run.runId});appendAssistantMessage(f.sdk,'Earlier turn');
  f.store.completeRun(run.runId,'succeeded','Final answer',null);
  const before=f.reader.page(f.session.sessionId,{direction:'older'});
  assert.equal(before.runs[0]!.resultRef?.entryId,`${run.runId}-final`);
  const sdkFinal=appendAssistantMessage(f.sdk,'Final answer');
  for(const direction of ['older','newer'] as const){
   const pages=readAll(f.reader,f.session.sessionId,{direction,limit:1});
   const final=pages.find(page=>page.segments.some(segment=>segment.entryId===sdkFinal))!;
   assert.equal(final.runs.find(summary=>summary.runId===run.runId)!.resultRef?.entryId,sdkFinal);
   assert.equal(pages.flatMap(page=>page.segments).filter(part=>part.text==='Final answer').length,1);
  }
  const result=f.reader.page(f.session.sessionId,{direction:'newer',content:'result',runId:run.runId});
  assert.equal(result.runs[0]!.resultRef?.entryId,sdkFinal);
  const frozen=f.reader.page(f.session.sessionId,{snapshot:before.snapshotId});
  assert.equal(frozen.runs[0]!.resultRef?.entryId,`${run.runId}-final`);
  assert.deepEqual(frozen.segments,before.segments);
 }finally{f.close();}
});

test('mixed SDK final result pages retain original block positions in both directions',()=>{
 const f=fixture();try{
  const run=f.store.acceptRun({workId:'work-1',sessionId:f.session.sessionId,submissionKey:'mixed-final',requestDigest:'x',promptDigest:'x'}).run;
  f.sdk.appendCustomEntry('piwork-run',{runId:run.runId});
  const before='前'.repeat(110000),after='后'.repeat(110000);
  const entryId=f.sdk.appendMessage({role:'assistant',content:[{type:'text',text:before},{type:'toolCall',id:'call-mixed',name:'read',arguments:{}},{type:'text',text:after}],
   api:'piwork-fixture',provider:'piwork-fixture',model:'deterministic',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'aborted',timestamp:Date.now()});
  f.store.completeRun(run.runId,'cancelled',before+after,null);
  const messages=readAll(f.reader,f.session.sessionId,{direction:'newer',runId:run.runId});
  const shape=new Map(messages.flatMap(page=>page.segments.map(part=>[part.blockId,{index:part.blockIndex,count:part.blockCount}])));
  assert.equal(shape.size,3);
  for(const direction of ['newer','older'] as const){
   const pages=readAll(f.reader,f.session.sessionId,{direction,content:'result',runId:run.runId,snapshot:messages[0]!.snapshotId});
   assert.ok(pages.length>=2);
   for(const page of pages)for(const part of page.segments){
    assert.equal(part.entryId,entryId);assert.equal(part.type,'text');
    assert.deepEqual({index:part.blockIndex,count:part.blockCount},shape.get(part.blockId));
   }
   const parts=new Map(content(pages));assert.equal(parts.get(`${entryId}:${entryId}-0`),before);assert.equal(parts.get(`${entryId}:${entryId}-2`),after);
   const replay=f.reader.page(f.session.sessionId,{direction,content:'result',runId:run.runId,snapshot:pages[0]!.snapshotId,cursor:pages[0]!.nextCursor!});
   assert.deepEqual(replay.segments,pages[1]!.segments);
  }
 }finally{f.close();}
});

test('empty terminal results distinguish missing SDK text from explicit empty text',async t=>{
 const tool=(id:string)=>({type:'toolCall' as const,id,name:'read',arguments:{}});
 const empty={type:'text' as const,text:''};
 const cases=[
  {name:'tools only',content:[tool('one'),tool('two')],text:'',hasText:false},
  {name:'nonpublic thinking only',content:[{type:'thinking' as const,thinking:'private reasoning fixture'}],text:'',hasText:false},
  {name:'empty content array',content:[],text:'',hasText:false},
  {name:'explicit empty text',content:[empty],text:'',hasText:true},
  {name:'mixed empty text and tools',content:[tool('one'),empty,tool('two'),empty],text:'',hasText:true},
  {name:'whitespace is real text',content:[tool('one'),{type:'text' as const,text:' \n'}],text:' \n',hasText:true},
  {name:'no SDK final message',content:null,text:'',hasText:false},
 ];
 for(const state of ['cancelled','succeeded'] as const)for(const item of cases)await t.test(`${state}: ${item.name}`,()=>{
  const f=fixture();try{
   const run=f.store.acceptRun({workId:'work-1',sessionId:f.session.sessionId,submissionKey:'empty-final',requestDigest:'x',promptDigest:'x'}).run;
   f.sdk.appendCustomEntry('piwork-run',{runId:run.runId});
   const entryId=item.content===null?undefined:f.sdk.appendMessage({role:'assistant',content:item.content,
    api:'piwork-fixture',provider:'piwork-fixture',model:'deterministic',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:state==='cancelled'?'aborted':'stop',timestamp:Date.now()});
   f.store.completeRun(run.runId,state,item.text,null);
   const original=readFileSync(f.session.sdkHistoryPath);
   for(const direction of ['newer','older'] as const){
    const result=f.reader.page(f.session.sessionId,{direction,content:'result',runId:run.runId});
    assert.equal(result.hasMore,false);assert.equal(result.segments.map(part=>part.text).join(''),item.text);
    assert.ok(result.segments.length>0);assert.ok(result.segments.every(part=>part.complete));
    assert.equal(result.runs[0]!.resultRef?.entryId,result.segments[0]!.entryId);
    const messages=readAll(f.reader,f.session.sessionId,{direction,limit:1,runId:run.runId,snapshot:result.snapshotId});
    const source=messages.flatMap(page=>page.segments).filter(part=>part.entryId===entryId);
    if(item.hasText){
     for(const part of result.segments){const saved=source.find(value=>value.blockId===part.blockId)!;
      assert.equal(part.entryId,entryId);assert.equal(part.type,'text');
      assert.deepEqual({index:part.blockIndex,count:part.blockCount},{index:saved.blockIndex,count:saved.blockCount});
     }
    }else{
     assert.equal(result.segments.length,1);const part=result.segments[0]!;
     assert.notEqual(part.entryId,entryId);assert.equal(part.type,'run-result');
     assert.equal(part.blockCount,1);assert.equal(part.totalBytes,0);assert.equal(part.byteOffset,0);
    }
    const replay=f.reader.page(f.session.sessionId,{direction,content:'result',runId:run.runId,snapshot:result.snapshotId});
    assert.deepEqual(replay.segments,result.segments);
    assert.equal(JSON.stringify(result).includes('private reasoning fixture'),false);
   }
   assert.deepEqual(readFileSync(f.session.sdkHistoryPath),original);
  }finally{f.close();}
 });
});

test("Responses compound tool IDs survive pagination and reopening without rewriting history",()=>{
 const f=fixture();try{
  const run=f.store.acceptRun({workId:"work-1",sessionId:f.session.sessionId,submissionKey:"compound-tools",requestDigest:"digest",promptDigest:"digest"}).run;
  f.sdk.appendCustomEntry("piwork-run",{runId:run.runId});
  const ids=["call_abc|fc_def",`call_${"x".repeat(128)}|fc_other`];
  const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
  f.sdk.appendMessage({role:"assistant",content:ids.map(id=>({type:"toolCall" as const,id,name:"read",arguments:{path:"fixture.txt"}})),api:"openai-responses",provider:"fixture",model:"unlisted",usage,stopReason:"toolUse",timestamp:1});
  for(const [i,id] of ids.entries())f.sdk.appendMessage({role:"toolResult",toolCallId:id,toolName:"read",content:[{type:"text",text:`result-${i}`}],isError:false,timestamp:i+2});
  appendAssistantMessage(f.sdk,"Final answer");f.store.completeRun(run.runId,"succeeded","Final answer",null);
  const original=readFileSync(f.session.sdkHistoryPath);
  for(const direction of ["older","newer"] as const){
   const reader=new SessionHistoryReader("work-1",f.store);
   const segments=readAll(reader,f.session.sessionId,{direction,limit:1}).flatMap(page=>page.segments);
   for(const [i,id] of ids.entries()){
    const pair=segments.filter(segment=>segment.toolCallId===id);
    assert.equal(pair.length,2);assert.ok(pair.every(segment=>segment.runId===run.runId));
    assert.equal(pair.find(segment=>segment.type==="tool-result")?.text,`result-${i}`);
    assert.ok(pair.some(segment=>segment.type==="tool-call"));
   }
   assert.equal(segments.filter(segment=>segment.text==="Final answer").length,1);
  }
  assert.deepEqual(readFileSync(f.session.sdkHistoryPath),original);
 }finally{f.close();}
});

test("454 messages / 235 tools, giant message and both directions stay bounded and preserve SDK originals",()=>{
 const f=fixture();try{
  const run=f.store.acceptRun({workId:"work-1",sessionId:f.session.sessionId,submissionKey:"original",requestDigest:"digest",promptDigest:"digest"}).run;
  const expected=populateLongHistory(f.sdk,run.runId,7*1024*1024);assert.equal(expected.calls,235);
  f.store.completeRun(run.runId,"succeeded",expected.finalText,null);
  const original=readFileSync(f.session.sdkHistoryPath),digest=createHash("sha256").update(original).digest("hex");
  const forward=readAll(f.reader,f.session.sessionId,{direction:"newer"});
  assert.equal(new Set(forward.flatMap(p=>p.segments.map(s=>s.entryId))).size,454);
  assert.ok(forward.length>20);assert.equal(f.sessions.read(f.session.sessionId).entries.length,454);
  const backward=readAll(f.reader,f.session.sessionId,{direction:"older"});
  assert.deepEqual(new Map(content(backward)),new Map(content(forward)));
  const assembled=content(forward);assert.ok(assembled.some(([,text])=>text===expected.finalText));
  const result=readAll(f.reader,f.session.sessionId,{direction:"newer",snapshot:forward[0]!.snapshotId,content:"result",runId:run.runId});
  assert.equal(content(result).map(([,s])=>s).join(""),expected.finalText);
  assert.equal(createHash("sha256").update(readFileSync(f.session.sdkHistoryPath)).digest("hex"),digest);
 }finally{f.close();}
});

test("snapshot appends, cross-range cursors, missing SDK result and expiration remain explicit",()=>{
 const f=fixture();try{
  appendAssistantMessage(f.sdk,"before");
  const first=f.reader.page(f.session.sessionId,{direction:"newer",limit:1});
  appendAssistantMessage(f.sdk,"after");
  const frozen=readAll(f.reader,f.session.sessionId,{direction:"newer",snapshot:first.snapshotId});
  assert.deepEqual(content(frozen).map(([,text])=>text),["before"]);
  const fresh=f.reader.page(f.session.sessionId,{direction:"newer",limit:1});assert.ok(fresh.nextCursor);
  assert.throws(()=>f.reader.page(f.session.sessionId,{direction:"older",cursor:fresh.nextCursor!}),/another history range/);
  assert.throws(()=>f.reader.page(f.session.sessionId,{cursor:"unknown"}),/expired/);
  const run=f.store.acceptRun({workId:"work-1",sessionId:f.session.sessionId,submissionKey:"without-sdk",requestDigest:"digest",promptDigest:"digest"}).run;
  const final="汉".repeat(400000);f.store.completeRun(run.runId,"succeeded",final,null);
  const pages=readAll(f.reader,f.session.sessionId,{direction:"older",content:"result",runId:run.runId});
  assert.equal(content(pages).map(([,text])=>text).join(""),final);
  assert.equal(pages[0]!.segments[0]!.type,"run-result");
 }finally{f.close();}
});

test("lightweight terminal and same-sequence text frames preserve all bytes without another event",()=>{
 const f=fixture();try {
  const run=f.store.acceptRun({workId:"work-1",sessionId:f.session.sessionId,submissionKey:"frame",requestDigest:"digest",promptDigest:"digest"}).run;
  f.store.completeRun(run.runId,"succeeded","a".repeat(7*1024*1024),null);
  const saved=f.store.getRun(run.runId)!;
  const terminal=[...historyEventMessages({runId:run.runId,sequence:4,eventType:"state",payloadJson:"{}",createdAt:saved.acceptedAt},saved,"history-v1")];
  assert.equal(terminal[0]!.kind?.$case,"state");assert.ok(Buffer.byteLength(JSON.stringify(terminal,(_,value)=>typeof value==="bigint"?String(value):value))<4096);
  const text="汉😀".repeat(20000),frames=[...historyEventMessages({runId:run.runId,sequence:3,eventType:"text",payloadJson:JSON.stringify({delta:text}),createdAt:saved.acceptedAt},saved,"history-v1")];
  assert.ok(frames.length>1);assert.ok(frames.every(frame=>frame.sequence===3n));
  assert.equal(frames.map(frame=>frame.kind?.$case==="text"?frame.kind.text.delta:"").join(""),text);
 }finally{f.close();}
});

test("snapshot lifetime and cross-Session handles never silently become empty",()=>{
 const f=fixture();try{
  appendAssistantMessage(f.sdk,"one");appendAssistantMessage(f.sdk,"two");
  let now=0;const reader=new SessionHistoryReader("work-1",f.store,()=>now);
  const first=reader.page(f.session.sessionId,{direction:"newer",limit:1});
  const other=f.sessions.create();
  assert.throws(()=>reader.page(other.sessionId,{direction:"newer",snapshot:first.snapshotId}),/another Session/);
  now=11*60*1000;
  assert.throws(()=>reader.page(f.session.sessionId,{direction:"newer",cursor:first.nextCursor!}),/expired/);
  assert.equal(reader.page(f.session.sessionId,{direction:"newer"}).segments.length,2);
 }finally{f.close();}
});

test('accepted input freezes safe image descriptors after private input release',()=>{
 const f=fixture();try{
  const image={mimeType:'image/png' as const,data:readFileSync(new URL('../../../fixtures/chat-images/png.png',import.meta.url)).toString('base64')};
  const input={profile:'chat-images-v1',prompt:'look',images:[image]};
  const run=f.store.acceptRun({workId:'work-1',sessionId:f.session.sessionId,submissionKey:'image',requestDigest:'fixture',promptDigest:chatInputDigest(input.prompt,input.images),privateInputJson:JSON.stringify(input)}).run;
  const first=f.reader.page(f.session.sessionId,{imageProfile:'chat-images-v1'});assert.equal(first.runs[0]?.runId,run.runId);assert.ok(first.segments.some(part=>part.type==='image'));
  f.store.releasePrivateInput(run.runId);
  const frozen=f.reader.page(f.session.sessionId,{snapshot:first.snapshotId,imageProfile:'chat-images-v1'});
  assert.deepEqual(frozen.segments,first.segments);assert.ok(!JSON.stringify(frozen).includes(image.data));
  f.store.completeRun(run.runId,'succeeded','',null);
  const result=f.reader.page(f.session.sessionId,{content:'result',runId:run.runId});assert.equal(result.segments[0]?.text,'');assert.equal(result.segments[0]?.complete,true);
 }finally{f.close();}
});

test('snapshot eviction and a new reader reject old handles explicitly',()=>{
 const f=fixture();try{
  appendAssistantMessage(f.sdk,'one');const first=f.reader.page(f.session.sessionId,{});
  for(let i=0;i<16;i++)f.reader.page(f.session.sessionId,{});
  assert.throws(()=>f.reader.page(f.session.sessionId,{snapshot:first.snapshotId}),/expired/);
  assert.throws(()=>new SessionHistoryReader('work-1',f.store).page(f.session.sessionId,{snapshot:first.snapshotId}),/expired/);
 }finally{f.close();}
});

test('response profile changes representation without changing durable submission identity',async()=>{
 const f=fixture();try{
  const {AgentApplication}=await import('./application.js');const {RunManager}=await import('./runs.js');const {AgentDaemonControl}=await import('./daemon.js');
  const daemon=new AgentDaemonControl({workId:'work-1',generation:1,instanceId:'fixture'});daemon.configure({modelCredentialStatus:'available',contextIdentity:'context',loadedSkills:[],resolvedTools:[],initializationComplete:true});
  let executions=0;const final='z'.repeat(7*1024*1024),manager=new RunManager(f.store,daemon,{async execute(){executions++;return{finalText:final};}},()=>new Date(),undefined,undefined,false);
  const app=Object.create(AgentApplication.prototype) as any;app.config={workId:'work-1'};app.authenticate=()=>{};app.runs=manager;app.store=f.store;
  const invoke=(name:string,request:any)=>new Promise<any>((done,fail)=>app.handlers()[name]({request,on(){},removeListener(){}},(err:any,value:any)=>err?fail(err):done(value)));
  const input={workId:'work-1',sessionId:f.session.sessionId,submissionKey:'once',prompt:'hello',images:[]};
  const first=await invoke('submitRun',input);await manager.wait(first.run.runId);
  const replay=await invoke('submitRun',{...input,responseProfile:'history-v1'});
  assert.equal(replay.reused,true);assert.equal(replay.run.runId,first.run.runId);assert.equal(executions,1);assert.equal(replay.run.finalText,'');assert.equal(JSON.parse(replay.run.resultRefJson).runId,first.run.runId);
  assert.equal((await invoke('getRun',{workId:'work-1',runId:first.run.runId})).finalText,final);
  assert.ok(JSON.stringify(await invoke('getRun',{workId:'work-1',runId:first.run.runId,responseProfile:'history-v1'}),(_,v)=>typeof v==='bigint'?String(v):v).length<4096);
 }finally{f.close();}
});

test('durable final result remains visible when only earlier SDK assistant turns exist',()=>{
 const f=fixture();try{
  const run=f.store.acceptRun({workId:'work-1',sessionId:f.session.sessionId,submissionKey:'partial-sdk',requestDigest:'x',promptDigest:'x'}).run;
  f.sdk.appendCustomEntry('piwork-run',{runId:run.runId});appendAssistantMessage(f.sdk,'Earlier assistant turn');
  f.store.completeRun(run.runId,'succeeded','Saved final answer without SDK turn',null);
  const messages=content(readAll(f.reader,f.session.sessionId,{direction:'newer'}));
  assert.deepEqual(messages.map(([,text])=>text),['Earlier assistant turn','Saved final answer without SDK turn']);
 }finally{f.close();}
});

test('result references identify a later SDK final without changing the frozen fallback',()=>{
 const f=fixture();try{
  const run=f.store.acceptRun({workId:'work-1',sessionId:f.session.sessionId,submissionKey:'late-final',requestDigest:'x',promptDigest:'x'}).run;
  f.sdk.appendCustomEntry('piwork-run',{runId:run.runId});appendAssistantMessage(f.sdk,'Earlier turn');
  f.store.completeRun(run.runId,'succeeded','Final answer',null);
  const before=f.reader.page(f.session.sessionId,{direction:'older'});
  assert.equal(before.runs[0]!.resultRef?.entryId,`${run.runId}-final`);
  const sdkFinal=appendAssistantMessage(f.sdk,'Final answer');
  for(const direction of ['older','newer'] as const){
   const pages=readAll(f.reader,f.session.sessionId,{direction,limit:1});
   const final=pages.find(page=>page.segments.some(segment=>segment.entryId===sdkFinal))!;
   assert.equal(final.runs.find(summary=>summary.runId===run.runId)!.resultRef?.entryId,sdkFinal);
   assert.equal(pages.flatMap(page=>page.segments).filter(part=>part.text==='Final answer').length,1);
  }
  const result=f.reader.page(f.session.sessionId,{direction:'newer',content:'result',runId:run.runId});
  assert.equal(result.runs[0]!.resultRef?.entryId,sdkFinal);
  const frozen=f.reader.page(f.session.sessionId,{snapshot:before.snapshotId});
  assert.equal(frozen.runs[0]!.resultRef?.entryId,`${run.runId}-final`);
  assert.deepEqual(frozen.segments,before.segments);
 }finally{f.close();}
});

test('mixed SDK final result pages retain original block positions in both directions',()=>{
 const f=fixture();try{
  const run=f.store.acceptRun({workId:'work-1',sessionId:f.session.sessionId,submissionKey:'mixed-final',requestDigest:'x',promptDigest:'x'}).run;
  f.sdk.appendCustomEntry('piwork-run',{runId:run.runId});
  const before='前'.repeat(110000),after='后'.repeat(110000);
  const entryId=f.sdk.appendMessage({role:'assistant',content:[{type:'text',text:before},{type:'toolCall',id:'call-mixed',name:'read',arguments:{}},{type:'text',text:after}],
   api:'piwork-fixture',provider:'piwork-fixture',model:'deterministic',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'aborted',timestamp:Date.now()});
  f.store.completeRun(run.runId,'cancelled',before+after,null);
  const messages=readAll(f.reader,f.session.sessionId,{direction:'newer',runId:run.runId});
  const shape=new Map(messages.flatMap(page=>page.segments.map(part=>[part.blockId,{index:part.blockIndex,count:part.blockCount}])));
  assert.equal(shape.size,3);
  for(const direction of ['newer','older'] as const){
   const pages=readAll(f.reader,f.session.sessionId,{direction,content:'result',runId:run.runId,snapshot:messages[0]!.snapshotId});
   assert.ok(pages.length>=2);
   for(const page of pages)for(const part of page.segments){
    assert.equal(part.entryId,entryId);assert.equal(part.type,'text');
    assert.deepEqual({index:part.blockIndex,count:part.blockCount},shape.get(part.blockId));
   }
   const parts=new Map(content(pages));assert.equal(parts.get(`${entryId}:${entryId}-0`),before);assert.equal(parts.get(`${entryId}:${entryId}-2`),after);
   const replay=f.reader.page(f.session.sessionId,{direction,content:'result',runId:run.runId,snapshot:pages[0]!.snapshotId,cursor:pages[0]!.nextCursor!});
   assert.deepEqual(replay.segments,pages[1]!.segments);
  }
 }finally{f.close();}
});

test('empty terminal results distinguish missing SDK text from explicit empty text',async t=>{
 const tool=(id:string)=>({type:'toolCall' as const,id,name:'read',arguments:{}});
 const empty={type:'text' as const,text:''};
 const cases=[
  {name:'tools only',content:[tool('one'),tool('two')],text:'',hasText:false},
  {name:'nonpublic thinking only',content:[{type:'thinking' as const,thinking:'private reasoning fixture'}],text:'',hasText:false},
  {name:'empty content array',content:[],text:'',hasText:false},
  {name:'explicit empty text',content:[empty],text:'',hasText:true},
  {name:'mixed empty text and tools',content:[tool('one'),empty,tool('two'),empty],text:'',hasText:true},
  {name:'whitespace is real text',content:[tool('one'),{type:'text' as const,text:' \n'}],text:' \n',hasText:true},
  {name:'no SDK final message',content:null,text:'',hasText:false},
 ];
 for(const state of ['cancelled','succeeded'] as const)for(const item of cases)await t.test(`${state}: ${item.name}`,()=>{
  const f=fixture();try{
   const run=f.store.acceptRun({workId:'work-1',sessionId:f.session.sessionId,submissionKey:'empty-final',requestDigest:'x',promptDigest:'x'}).run;
   f.sdk.appendCustomEntry('piwork-run',{runId:run.runId});
   const entryId=item.content===null?undefined:f.sdk.appendMessage({role:'assistant',content:item.content,
    api:'piwork-fixture',provider:'piwork-fixture',model:'deterministic',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:state==='cancelled'?'aborted':'stop',timestamp:Date.now()});
   f.store.completeRun(run.runId,state,item.text,null);
   const original=readFileSync(f.session.sdkHistoryPath);
   for(const direction of ['newer','older'] as const){
    const result=f.reader.page(f.session.sessionId,{direction,content:'result',runId:run.runId});
    assert.equal(result.hasMore,false);assert.equal(result.segments.map(part=>part.text).join(''),item.text);
    assert.ok(result.segments.length>0);assert.ok(result.segments.every(part=>part.complete));
    assert.equal(result.runs[0]!.resultRef?.entryId,result.segments[0]!.entryId);
    const messages=readAll(f.reader,f.session.sessionId,{direction,limit:1,runId:run.runId,snapshot:result.snapshotId});
    const source=messages.flatMap(page=>page.segments).filter(part=>part.entryId===entryId);
    if(item.hasText){
     for(const part of result.segments){const saved=source.find(value=>value.blockId===part.blockId)!;
      assert.equal(part.entryId,entryId);assert.equal(part.type,'text');
      assert.deepEqual({index:part.blockIndex,count:part.blockCount},{index:saved.blockIndex,count:saved.blockCount});
     }
    }else{
     assert.equal(result.segments.length,1);const part=result.segments[0]!;
     assert.notEqual(part.entryId,entryId);assert.equal(part.type,'run-result');
     assert.equal(part.blockCount,1);assert.equal(part.totalBytes,0);assert.equal(part.byteOffset,0);
    }
    const replay=f.reader.page(f.session.sessionId,{direction,content:'result',runId:run.runId,snapshot:result.snapshotId});
    assert.deepEqual(replay.segments,result.segments);
    assert.equal(JSON.stringify(result).includes('private reasoning fixture'),false);
   }
   assert.deepEqual(readFileSync(f.session.sdkHistoryPath),original);
  }finally{f.close();}
 });
});
