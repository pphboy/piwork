import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WORK_SCHEMA_SQL } from "./brain-schema.js";
import { MEMORY_SCHEMA_SQL } from "./memory-schema.js";
import { WorkStore } from "./store.js";
import { WorkHistorySnapshot } from "./snapshot.js";
import { validateMemoryHistory } from "./snapshot-memory.js";
import { validateBrainHistory } from "./snapshot-brain.js";

const fixtureRoot=new URL("../../../internal/workhistory/testdata/",import.meta.url);
const seed=readFileSync(new URL("memory-integrity.sql",fixtureRoot),"utf8");
const carry=readFileSync(new URL("memory-integrity-carry.sql",fixtureRoot),"utf8");
const cases=JSON.parse(readFileSync(new URL("memory-integrity-cases.json",fixtureRoot),"utf8")) as {name:string;accepted:boolean;sql:string;setup?:"carry"}[];
const workId="work-memory-source-1111",context="context-memory-source";
function fingerprint(path:string){return ["work.sqlite","memory.sqlite"].map(name=>readFileSync(join(path,name)));}

test("runtime, TS full history and Go-shared fixtures agree on preference and publication integrity",()=>{
 for(const scenario of cases){const root=mkdtempSync(join(tmpdir(),"piwork-integrity-")),source=join(root,"source");try{
  mkdirSync(join(source,"sessions"),{recursive:true});writeFileSync(join(source,"sessions","one.jsonl"),'{"type":"session"}\n');
  const db=new DatabaseSync(join(source,"work.sqlite"));db.exec(WORK_SCHEMA_SQL);db.prepare('ATTACH DATABASE ? AS memory').run(join(source,"memory.sqlite"));
  db.exec(MEMORY_SCHEMA_SQL.replaceAll("CREATE TABLE ","CREATE TABLE memory.").replaceAll("CREATE INDEX ","CREATE INDEX memory."));db.exec(seed);if(scenario.setup==='carry')db.exec(carry);db.exec(scenario.sql);db.close();
  const before=fingerprint(source),scope={sourceWorkId:workId,contextIds:new Set([context]),scratchDirectory:root};
  const staticDB=new DatabaseSync(join(source,'work.sqlite'),{readOnly:true});staticDB.prepare('ATTACH DATABASE ? AS memory').run(join(source,'memory.sqlite'));
  const staticCheck=()=>{validateMemoryHistory(staticDB,workId);validateBrainHistory(staticDB,workId,new Set([context]));};
  try{if(scenario.accepted)assert.doesNotThrow(staticCheck,scenario.name);else assert.throws(staticCheck,scenario.name);}finally{staticDB.close();}
  if(scenario.accepted){const snapshot=WorkHistorySnapshot.open(source,scope)!;snapshot.close();}
  else assert.throws(()=>WorkHistorySnapshot.open(source,scope),scenario.name);
  assert.deepEqual(fingerprint(source),before,`${scenario.name}: static validation changed input`);
  const runtime=join(root,'runtime');cpSync(source,runtime,{recursive:true});const runtimeBefore=fingerprint(runtime);
  if(scenario.accepted){const store=WorkStore.open(join(runtime,'work.sqlite'),{workId});store.memory.snapshot(workId);store.close();}
  else {assert.throws(()=>WorkStore.open(join(runtime,'work.sqlite'),{workId}),scenario.name);assert.deepEqual(fingerprint(runtime),runtimeBefore,scenario.name);}
 }finally{rmSync(root,{recursive:true,force:true});}}
});
