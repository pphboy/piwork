import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { spawn } from "node:child_process";
import { WorkStore, FeedbackError } from "./index.js";

const workId = "work-memory-1111111111", now = "2026-10-08T00:00:00.000Z";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "piwork-memory-")), path = join(root,"work.sqlite");
  const store = WorkStore.open(path,{workId});
  store.createSession({workId,sessionId:"session",sdkHistoryPath:"/var/data/sessions/test.jsonl",createdAt:now,updatedAt:now});
  const begin = (key: string) => {
    const run = store.acceptRun({workId,sessionId:"session",submissionKey:key,requestDigest:key,promptDigest:key,memoryQuery:"kanban 卡片",now}).run;
    store.markRunRunning(run.runId,now);
    const request = store.feedback.ensureChatRequest(workId,run.runId,key,now);
    const proof = store.feedback.addEvidence(workId,{requestId:request.requestId,runId:run.runId,serviceName:"kanban",kind:"query",objectRef:"summary",observedAt:now,summary:"Actual query",verified:true},{checks:[{name:"state",passed:true}]});
    return {run,request,proof};
  };
  const learn = (key: string, entryId: string, rule: string, scope="work") => {
    const goal = begin(key);
    store.feedback.stageExperience(workId,goal.request.requestId,{entryId,scope,rule,evidenceIds:[goal.proof.evidenceId]},false,now);
    store.feedback.finish(workId,goal.request.requestId,"completed","verified",null,[goal.proof.evidenceId],now);
    store.completeRun(goal.run.runId,"succeeded","done",null,now);
    return goal;
  };
  return {root,path,store,begin,learn,close:()=>{store.close();rmSync(root,{recursive:true,force:true});}};
}

test("Memory has one independent private authority and persists versions across reopen",()=>{
  const f=fixture();try {
    const goal=f.learn("first","kanban.move","卡片移动需要检查实际列状态","service:kanban");
    const head=f.store.memory.head(workId),original=f.store.memory.snapshot(workId,head);
    assert.equal(statSync(join(f.root,"memory.sqlite")).mode&0o777,0o600);
    assert.ok(!f.store.listTables().includes("brain_experience_revisions"));
    f.store.close();const reopened=WorkStore.open(f.path,{workId});
    try { assert.deepEqual(reopened.memory.snapshot(workId,head),original);assert.equal(reopened.feedback.getRequest(workId,goal.request.requestId)?.state,"completed"); }
    finally {reopened.close();}
  }finally{f.close();}
});

test("effective preferences must cite their own accepted Chat proof, including on reopen",()=>{
 for(const damage of ["valid","entry-kind","both-kinds","uncited","digest","run","createdAt","candidate-kind"]){const f=fixture();try{
  const goal=f.begin("preference");const original=f.store.feedback.addEvidence(workId,{requestId:goal.request.requestId,runId:goal.run.runId,kind:"sdk",objectRef:goal.run.runId,observedAt:now,summary:"Original user preference",verified:true},{userPreferenceVerified:true,promptDigest:goal.run.promptDigest},true);
  const preference=!["entry-kind","both-kinds","candidate-kind","createdAt"].includes(damage);
  f.store.memory.propose(workId,goal.request.requestId,{entryId:"theme",scope:"work",rule:"Prefer dark theme",evidenceIds:[preference?original.evidenceId:goal.proof.evidenceId]},preference,now);
  f.store.feedback.finish(workId,goal.request.requestId,"completed","verified",null,[original.evidenceId,goal.proof.evidenceId],now);
  f.store.completeRun(goal.run.runId,"succeeded","done",null,now);f.store.close();
  const db=new DatabaseSync(f.path);db.prepare('ATTACH DATABASE ? AS memory').run(join(f.root,'memory.sqlite'));
  if(damage==='entry-kind'||damage==='both-kinds')db.exec("UPDATE memory.memory_entries SET kind='preference'");
  if(damage==='both-kinds')db.exec("UPDATE memory.memory_candidates SET kind='preference'");
  if(damage==='candidate-kind')db.exec("UPDATE memory.memory_candidates SET kind='knowledge'");
  if(damage==='createdAt')db.exec("UPDATE memory.memory_candidates SET created_at='2026-10-07T00:00:00.000Z'");
  if(damage==='uncited')for(const table of ['memory_entries','memory_candidates'])db.prepare(`UPDATE memory.${table} SET evidence_ids_json=?`).run(JSON.stringify([goal.proof.evidenceId]));
  if(damage==='digest')db.prepare("UPDATE agent_evidence SET details_json=? WHERE evidence_id=?").run(JSON.stringify({userPreferenceVerified:true,promptDigest:'other'}),original.evidenceId);
  if(damage==='run')db.prepare("UPDATE agent_evidence SET run_id=NULL WHERE evidence_id=?").run(original.evidenceId);
  db.close();const before=[readFileSync(f.path),readFileSync(join(f.root,'memory.sqlite'))];
  if(damage==='valid'){const reopened=WorkStore.open(f.path,{workId});assert.equal(reopened.memory.snapshot(workId).entries.length,1);reopened.close();}
  else {assert.throws(()=>WorkStore.open(f.path,{workId}));assert.deepEqual([readFileSync(f.path),readFileSync(join(f.root,'memory.sqlite'))],before);}
 }finally{f.close();}}
});

test("ordinary verified commits preserve carried entries and reject changes only in their later copies",()=>{
 for(const damage of ['valid','kind','createdAt','rule']){const f=fixture();try{
  f.learn('first','lesson','First verified rule');const first=f.store.memory.head(workId),original=f.store.memory.snapshot(workId,first);
  f.learn('second','other','Another verified rule');const later=f.store.memory.head(workId);
  assert.equal(f.store.memory.snapshot(workId,later).entries.length,2);
  assert.deepEqual(f.store.memory.snapshot(workId,first),original);f.store.close();
  const db=new DatabaseSync(join(f.root,'memory.sqlite'));
  if(damage==='kind')db.prepare("UPDATE memory_entries SET kind='knowledge' WHERE version=? AND entry_id='lesson'").run(later);
  if(damage==='createdAt')db.prepare("UPDATE memory_entries SET created_at='2026-10-07T00:00:00.000Z' WHERE version=? AND entry_id='lesson'").run(later);
  if(damage==='rule')db.prepare("UPDATE memory_entries SET rule='Changed without candidate' WHERE version=? AND entry_id='lesson'").run(later);
  db.close();const before=[readFileSync(f.path),readFileSync(join(f.root,'memory.sqlite'))];
  if(damage==='valid'){const reopened=WorkStore.open(f.path,{workId});assert.deepEqual(reopened.memory.snapshot(workId,first),original);assert.equal(reopened.memory.snapshot(workId,later).entries.length,2);reopened.close();}
  else {assert.throws(()=>WorkStore.open(f.path,{workId}),/metadata differs from its candidate/);assert.deepEqual([readFileSync(f.path),readFileSync(join(f.root,'memory.sqlite'))],before);}
 }finally{f.close();}}
});

test("an uncited preference proof in the same goal cannot authorize propose",()=>{
 const f=fixture();try{const goal=f.begin('uncited-stage');
  f.store.feedback.addEvidence(workId,{requestId:goal.request.requestId,runId:goal.run.runId,kind:'sdk',objectRef:goal.run.runId,observedAt:now,summary:'Original preference',verified:true},{userPreferenceVerified:true,promptDigest:goal.run.promptDigest},true);
  assert.throws(()=>f.store.memory.propose(workId,goal.request.requestId,{entryId:'theme',scope:'work',rule:'Dark theme',kind:'preference',evidenceIds:[goal.proof.evidenceId]}),/referenced original instruction/);
  assert.equal(f.store.memory.head(workId),0);
 }finally{f.close();}
});

test("head tracks real publication while fixed history and legacy partial versions remain readable",()=>{
 const f=fixture();try{
  assert.equal(f.store.memory.head(workId),0);f.learn('first','one','First rule');const old=f.store.memory.head(workId);
  f.learn('second','two','Second rule');const current=f.store.memory.head(workId);
  const db=new DatabaseSync(join(f.root,'memory.sqlite'));db.exec("INSERT INTO memory_versions VALUES(99,NULL,1)");db.close();
  assert.equal(f.store.memory.head(workId),current);assert.equal(f.store.memory.snapshot(workId,old).entries.length,1);
  f.store.close();const corrupt=new DatabaseSync(join(f.root,'memory.sqlite'));
  for(const version of [0,old,99]){corrupt.prepare('UPDATE memory_head SET version=?').run(version);assert.throws(()=>WorkStore.open(f.path,{workId}),/durable publication/);}
  corrupt.prepare('UPDATE memory_head SET version=?').run(current);corrupt.close();
  const reopened=WorkStore.open(f.path,{workId});assert.equal(reopened.memory.snapshot(workId,old).entries.length,1);reopened.close();
 }finally{f.close();}
});

test("missing, linked, wrong-owner, wrong-binding and extra-schema Memory cannot be replaced with empty data",()=>{
  for(const mode of ["missing","linked","owner","binding","schema"]){const f=fixture();try{
    f.learn("first","rule","Rule");f.store.close();
    const main=readFileSync(f.path),memoryPath=join(f.root,"memory.sqlite");
    if(mode==="missing")unlinkSync(memoryPath);
    else if(mode==="linked"){const other=join(f.root,"other.sqlite");new DatabaseSync(other).close();unlinkSync(memoryPath);symlinkSync(other,memoryPath);}
    else if(mode==="binding"){const db=new DatabaseSync(f.path);try{db.exec("DELETE FROM work_memory_binding");}finally{db.close();}}
    else {const db=new DatabaseSync(memoryPath);try{db.exec(mode==="owner"?"UPDATE memory_meta SET work_id='other-work'":"CREATE TABLE unknown(value TEXT)");}finally{db.close();}}
    const before=readFileSync(f.path);
    assert.throws(()=>WorkStore.open(f.path,{workId}));assert.deepEqual(readFileSync(f.path),before);
    if(mode!=="binding")assert.deepEqual(before,main);
  }finally{f.close();}}
});

test("new versions revise and invalidate while old adopted versions remain immutable",()=>{
  const f=fixture();try {
    f.learn("one","kanban","卡片需要校验");const v1=f.store.memory.head(workId),original=f.store.memory.snapshot(workId,v1);
    const revised=f.begin("revise");
    f.store.feedback.stageExperience(workId,revised.request.requestId,{entryId:"kanban",scope:"work",rule:"卡片还需验证列",evidenceIds:[revised.proof.evidenceId],expectedVersion:v1},false,now);
    f.store.feedback.finish(workId,revised.request.requestId,"completed","verified",null,[revised.proof.evidenceId],now);
    f.store.completeRun(revised.run.runId,"succeeded","done",null,now);
    const v2=f.store.memory.head(workId);assert.deepEqual(f.store.memory.snapshot(workId,v1),original);
    const invalid=f.begin("invalidate");
    f.store.memory.propose(workId,invalid.request.requestId,{entryId:"kanban",scope:"work",rule:"卡片还需验证列",evidenceIds:[invalid.proof.evidenceId],expectedVersion:v2,operation:"invalidate",reason:"The rule is outdated"},false,now);
    f.store.feedback.finish(workId,invalid.request.requestId,"completed","verified",null,[invalid.proof.evidenceId],now);
    const v3=f.store.memory.head(workId);
    assert.deepEqual(f.store.memory.snapshot(workId,v3).entries,[]);assert.equal(f.store.memory.read(workId,v3,"kanban").status,"invalidated");
    assert.equal(f.store.memory.read(workId,v2,"kanban").status,"effective");assert.equal(f.store.memory.read(workId,v3,"missing").status,"not_found");
  }finally{f.close();}
});

test("same entry conflicts without overwriting newer content, while disjoint waiting changes still merge",()=>{
  const f=fixture();try {
    f.learn("seed","shared","Original");const base=f.store.memory.head(workId);
    f.learn("newer","shared","Newer");
    const goal=f.begin("stale");
    assert.throws(()=>f.store.memory.propose(workId,goal.request.requestId,{entryId:"shared",scope:"work",rule:"Stale",evidenceIds:[goal.proof.evidenceId],expectedVersion:base}),
      (error:unknown)=>error instanceof FeedbackError&&error.code==="MEMORY_VERSION_CONFLICT");
    assert.equal(f.store.memory.snapshot(workId).entries[0]?.rule,"Newer");
    f.store.memory.propose(workId,goal.request.requestId,{entryId:"unrelated",scope:"work",rule:"Other",evidenceIds:[goal.proof.evidenceId],expectedVersion:base});
    f.store.feedback.finish(workId,goal.request.requestId,"completed","verified",null,[goal.proof.evidenceId],now);
    assert.deepEqual(f.store.memory.snapshot(workId).entries.map(e=>e.entryId),["shared","unrelated"]);
  }finally{f.close();}
});

test("attached transaction rolls back Memory when request completion storage fails",()=>{
  const f=fixture();try{
    const goal=f.begin("failure");f.store.feedback.stageExperience(workId,goal.request.requestId,{entryId:"rule",scope:"work",rule:"Verified rule",evidenceIds:[goal.proof.evidenceId]},false,now);
    const db=new DatabaseSync(f.path);try{db.exec("CREATE TRIGGER fail_completion BEFORE UPDATE OF state ON agent_requests WHEN NEW.state='completed' BEGIN SELECT RAISE(ABORT,'injected storage fault'); END");}finally{db.close();}
    assert.throws(()=>f.store.feedback.finish(workId,goal.request.requestId,"completed","verified",null,[goal.proof.evidenceId],now),/injected storage fault/);
    assert.equal(f.store.memory.head(workId),0);assert.equal(f.store.feedback.getRequest(workId,goal.request.requestId)?.state,"running");
  }finally{f.close();}
});

test("task-scoped recall bounds context and new accepted Runs pin the actual provided IDs",()=>{
  const f=fixture();try{
    f.learn("board","board","Move kanban 卡片","service:kanban");f.learn("mail","mail","Send invoices","service:mail");
    const run=f.begin("pin");const v=run.run.adoptedExperienceVersion!;
    assert.deepEqual(run.run.adoptedMemorySelection?.entryIds,["board"]);
    assert.deepEqual(f.store.memory.recall(workId,v,"卡片", "kanban").items.map(e=>e.entryId),["board"]);
    assert.deepEqual(f.store.memory.recall(workId,v,"completely unrelated").items,[]);
    assert.throws(()=>f.store.memory.recall(workId,v,"卡片",undefined,21));
    const replay=f.store.acceptRun({workId,sessionId:"session",submissionKey:"pin",requestDigest:"pin",promptDigest:"pin",memoryQuery:"different",now}).run;
    assert.deepEqual(replay.adoptedMemorySelection,run.run.adoptedMemorySelection);
  }finally{f.close();}
});

test("provided Memory is bounded by bytes and disabled brains pin an explicit empty version",()=>{
  const f=fixture();try {
    for(let i=0;i<8;i++)f.learn(`large-${i}`,`theme-${i}`,`theme ${"x".repeat(3400)}`);
    const head=f.store.memory.head(workId);
    const session=f.store.getSession(workId,"session")!;
    const accepted=f.store.acceptRun({workId,sessionId:session.sessionId,submissionKey:"bounded",requestDigest:"bounded",promptDigest:"bounded",memoryQuery:"theme",now}).run;
    const selection=accepted.adoptedMemorySelection!;
    assert.equal(selection.matchedCount,8);assert.equal(selection.truncated,true);assert.ok(selection.entryIds.length>0&&selection.entryIds.length<8);
    const entries=f.store.memory.snapshot(workId,head).entries.filter(e=>selection.entryIds.includes(e.entryId));
    assert.ok(Buffer.byteLength(JSON.stringify(entries))<=16384);
    assert.equal(f.store.memory.recall(workId,head,"theme",undefined,20).items.length,8);
    f.store.completeRun(accepted.runId,"succeeded","done",null,now);
    const disabled=f.store.acceptRun({workId,sessionId:session.sessionId,submissionKey:"disabled",requestDigest:"disabled",promptDigest:"disabled",memoryQuery:"theme",memoryEnabled:false,now}).run;
    assert.equal(disabled.adoptedExperienceVersion,0);assert.deepEqual(disabled.adoptedMemorySelection,{entryIds:[],matchedCount:0,truncated:false});
  }finally{f.close();}
});

test("an existing current pair in WAL cannot claim a cross-database atomic commit",()=>{
  for(const name of ["work.sqlite","memory.sqlite"]){const f=fixture();try{
    f.store.close();const db=new DatabaseSync(join(f.root,name));try{db.exec("PRAGMA journal_mode=WAL");}finally{db.close();}
    assert.throws(()=>WorkStore.open(f.path,{workId}),/WORK_MEMORY_JOURNAL_UNSUPPORTED/);
  }finally{f.close();}}
});

test("a killed real SQLite writer recovers both databases before or after joint COMMIT",async()=>{
  for(const boundary of ["before","after"]){const f=fixture();try{
    const goal=f.begin(`crash-${boundary}`);
    f.store.feedback.stageExperience(workId,goal.request.requestId,{entryId:"survivor",scope:"work",rule:"Retain verified result",evidenceIds:[goal.proof.evidenceId]},false,now);
    f.store.close();
    const script=`import {WorkStore} from ${JSON.stringify(new URL("./index.js",import.meta.url).href)};
      const store=WorkStore.open(process.argv[1],{workId:process.argv[2]});
      const db=store.database,native=db.exec.bind(db);
      db.exec=(sql)=>{if(sql==='COMMIT'){
        if(process.argv[5]==='after')native(sql);
        process.send({boundary:process.argv[5]});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
      }else return native(sql);};
      store.feedback.finish(process.argv[2],process.argv[3],'completed','verified',null,[process.argv[4]],${JSON.stringify(now)});`;
    const child=spawn(process.execPath,["--input-type=module","-e",script,f.path,workId,goal.request.requestId,goal.proof.evidenceId,boundary],{stdio:["ignore","pipe","pipe","ipc"]});
    let errors="";child.stderr?.on("data",chunk=>{errors+=String(chunk);});
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{child.kill("SIGKILL");reject(new Error(`Writer did not reach boundary: ${errors}`));},10000);
      child.once("error",error=>{clearTimeout(timer);reject(error);});
      child.once("message",message=>{assert.deepEqual(message,{boundary});child.kill("SIGKILL");});
      child.once("exit",(_code,signal)=>{clearTimeout(timer);signal==="SIGKILL"?resolve():reject(new Error(errors));});
    });
    const restored=WorkStore.open(f.path,{workId});try{
      assert.equal(restored.feedback.getRequest(workId,goal.request.requestId)?.state,boundary==="before"?"running":"completed");
      assert.equal(restored.memory.snapshot(workId).entries.length,boundary==="before"?0:1);
      assert.equal(restored.getRun(goal.run.runId)?.state,"running","storage recovery must not replay or settle a model Run");
    }finally{restored.close();}
  }finally{f.close();}}
});
