import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { WorkStore } from "./store.js";
import { LEGACY_SCHEMA_SQL } from "./legacy-schema.js";
import type { MemoryEntry } from "./memory.js";
import { MEMORY_SCHEMA_SQL } from "./memory-schema.js";

const work="work-migration-111111",now="2026-10-08T00:00:00.000Z",storeId="store-migration-111111";
function legacy() {
 const root=mkdtempSync(join(tmpdir(),"piwork-memory-migrate-")),path=join(root,"work.sqlite");
 const db=new DatabaseSync(path);db.exec(LEGACY_SCHEMA_SQL);
 db.prepare("INSERT INTO schema_migrations VALUES(4,?)").run(now);
 db.prepare("INSERT INTO sessions(work_id,session_id,sdk_history_path,created_at,updated_at,active_context_identity) VALUES(?,'session','/var/data/sessions/one.jsonl',?,?,'context')").run(work,now,now);
 db.prepare("INSERT INTO runs(work_id,session_id,run_id,submission_key,prompt_digest,state,accepted_at,finished_at,context_identity,adopted_experience_version) VALUES(?,'session','run','submit','digest','succeeded',?,?,'context',2)").run(work,now,now);
 for(const [id,state]of [["completed","completed"],["failed","failed"],["waiting","pending"]])db.prepare("INSERT INTO agent_requests(work_id,request_id,submission_key,request_digest,source_kind,goal,state,disposition,phase,expires_at,created_at,updated_at) VALUES(?,?,?,?,'chat','Memory goal',?,'live','handling',?,?,?)").run(work,id!,id!,id!,state!,now,now,now);
 for(const [id,verified]of [["completed",1],["failed",0],["waiting",0]] as const)db.prepare("INSERT INTO agent_evidence(work_id,evidence_id,request_id,kind,object_ref,observed_at,summary,verified,details_json) VALUES(?,?,?,'query','summary',?,'Actual check',?,?)").run(work,`proof-${id}`,id,now,verified,JSON.stringify({checks:[{name:"state",passed:verified===1}]}));
 for(const [version,id,status,source]of [[1,"rule","effective","completed"],[2,"rule","effective","completed"],[3,"failure","failed","failed"],[4,"candidate","staged","waiting"]] as const)
  db.prepare("INSERT INTO brain_experience_revisions VALUES(?, ?,?,'work',?,?,?, ?,?)").run(work,version,id,`Rule ${id}`,JSON.stringify([`proof-${source}`]),source,status,now);
 db.prepare("INSERT INTO brain_experience_heads VALUES(?,2,?)").run(work,now);db.close();
 const grant={operationId:"operation-migration-111111",workId:work,fromSchema:4 as const,toSchema:5 as const,storeId,backupManifestDigest:"a".repeat(64)};
 const prepare=()=>{const memory=new DatabaseSync(join(root,"memory.sqlite"));memory.exec(MEMORY_SCHEMA_SQL);memory.prepare("INSERT INTO memory_meta VALUES(1,1,?,?)").run(work,storeId);memory.prepare("INSERT INTO memory_versions VALUES(0,?,0)").run(now);memory.prepare("INSERT INTO memory_head VALUES(1,0,?)").run(now);memory.close();};
 return{root,path,grant,prepare,close:()=>rmSync(root,{recursive:true,force:true})};
}
test("Core-authorized migration retains all adopted, effective, failed and staged versions without a second authority",()=>{
 const f=legacy();try{f.prepare();const store=WorkStore.open(f.path,{workId:work,historyMigration:f.grant});try{
  assert.equal(store.schemaVersion,5);assert.equal(store.memory.head(work),2);assert.equal(store.getRun("run")?.adoptedExperienceVersion,2);
  assert.equal(store.getRun("run")?.adoptedMemorySelection,null);
  assert.deepEqual(store.memory.snapshot(work,1).entries.map(e=>e.entryId),["rule"]);
  assert.equal(store.memory.snapshot(work,2).entries[0]?.rule,"Rule rule");
  assert.ok(!store.listTables().includes("brain_experience_revisions"));
 }finally{store.close();}
 const memory=new DatabaseSync(join(f.root,"memory.sqlite"));try{
  assert.deepEqual(memory.prepare("SELECT candidate_version,status,created_at FROM memory_candidates ORDER BY candidate_version").all().map(r=>[r.candidate_version,r.status,r.created_at]),[[3,"failed",now],[4,"staged",now]]);
 }finally{memory.close();}
 const after=readFileSync(f.path);const reopened=WorkStore.open(f.path,{workId:work});reopened.close();assert.deepEqual(readFileSync(f.path),after);
 }finally{f.close();}
});
test("unauthorized, wrong-owner and invalid-evidence legacy migration preserve original rows and format",()=>{
 for(const scenario of ["unauthorized","owner","evidence"]){const f=legacy();try{
  if(scenario!=="unauthorized")f.prepare();
  if(scenario==="owner"){const db=new DatabaseSync(join(f.root,"memory.sqlite"));db.exec("UPDATE memory_meta SET store_id='unknown'");db.close();}
  if(scenario==="evidence"){const db=new DatabaseSync(f.path);db.exec("UPDATE agent_evidence SET verified=0 WHERE request_id='completed'");db.close();}
  const original=readFileSync(f.path);
  assert.throws(()=>WorkStore.open(f.path,{workId:work,...(scenario!=="unauthorized"?{historyMigration:f.grant}:{})}));
  const db=new DatabaseSync(f.path);try{assert.equal(db.prepare("SELECT version FROM schema_migrations").get()?.version,4);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM brain_experience_revisions").get()?.n,4);}finally{db.close();}
  assert.deepEqual(readFileSync(f.path),original);
 }finally{f.close();}}
});

test("legacy empty cognition migrates to explicit version zero without inventing adopted entries",()=>{
 const f=legacy();try{
  const db=new DatabaseSync(f.path);db.exec("DELETE FROM brain_experience_heads; DELETE FROM brain_experience_revisions; UPDATE runs SET adopted_experience_version=0");db.close();f.prepare();
  const store=WorkStore.open(f.path,{workId:work,historyMigration:f.grant});try{assert.deepEqual(store.memory.snapshot(work),{version:0,entries:[]});assert.equal(store.getRun('run')?.adoptedMemorySelection,null);}finally{store.close();}
 }finally{f.close();}
});

test("legacy preference classification requires its referenced full original instruction proof",()=>{
 for(const scenario of ['valid','flag-only','uncited','wrong-digest']){const f=legacy();try{
  const db=new DatabaseSync(f.path);
  db.exec("UPDATE agent_requests SET source_run_id='run' WHERE request_id='completed'; INSERT INTO agent_request_runs VALUES('completed','run','handling','live','2026-10-08T00:00:00.000Z'); UPDATE runs SET source_json='{\"kind\":\"chat\",\"requestId\":\"completed\",\"phase\":\"handling\"}'");
  const details={userPreferenceVerified:true,...(scenario!=='flag-only'?{promptDigest:scenario==='wrong-digest'?'other':'digest'}:{})};
  db.prepare("INSERT INTO agent_evidence(work_id,evidence_id,request_id,run_id,kind,object_ref,observed_at,summary,verified,details_json) VALUES(?,'pref-proof','completed','run','sdk','run',?,'Original instruction',1,?)").run(work,now,JSON.stringify(details));
  if(scenario!=='uncited')db.exec("UPDATE brain_experience_revisions SET evidence_ids_json='[\"proof-completed\",\"pref-proof\"]' WHERE status='effective'");
  db.close();f.prepare();const store=WorkStore.open(f.path,{workId:work,historyMigration:f.grant});
  try{assert.equal((store.memory.snapshot(work).entries[0] as MemoryEntry).kind,scenario==='valid'?'preference':'experience');assert.equal(store.memory.head(work),2);assert.equal(store.getRun('run')?.adoptedExperienceVersion,2);}
  finally{store.close();}
 }finally{f.close();}}
});
