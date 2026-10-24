import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { WorkStore } from "./store.js";

test("history keysets pass 1000 runs/events without loading result bodies or crossing a Session",()=>{
 const root=mkdtempSync(join(tmpdir(),"history-store-")),path=join(root,"work.sqlite"),store=WorkStore.open(path,{workId:"work-1"});
 try{
  const now="2026-10-23T00:00:00Z";
  store.createSession({workId:"work-1",sessionId:"session-1",sdkHistoryPath:"/private/history",createdAt:now,updatedAt:now});
  const db=new DatabaseSync(path);try{db.exec("BEGIN");
   const insert=db.prepare("INSERT INTO runs(work_id,session_id,run_id,submission_key,prompt_digest,state,accepted_at,final_text) VALUES('work-1','session-1',?,?,?,'succeeded',?,?)");
   for(let i=0;i<1005;i++){const id=`run-${String(i).padStart(5,"0")}`;insert.run(id,id,"digest",now,i===1004?"汉".repeat(400000):"");}
   const event=db.prepare("INSERT INTO run_events(run_id,sequence,event_type,payload_json,created_at) VALUES('run-00000',?,'tool-end',?,?)");
   for(let i=1;i<=1005;i++)event.run(i,JSON.stringify({toolCallId:`call-${i}`}),now);
   db.exec("COMMIT");
  }finally{db.close();}
  const values=[];let after:{acceptedAt:string;runId:string}|undefined;
  while(true){const page=store.historyRuns("work-1","session-1",after,31);if(!page.length)break;values.push(...page);const last=page.at(-1)!;after={acceptedAt:last.acceptedAt,runId:last.runId};}
  assert.equal(values.length,1005);assert.ok(values.every(value=>value.finalText===null));
  assert.equal(values.at(-1)!.resultBytes,1200000);assert.equal(store.historyRuns("work-1","other").length,0);
  const calls=[...store.historyToolCalls("work-1","session-1")];assert.equal(calls.length,1005);assert.equal(calls.at(-1)?.callId,"call-1005");
  assert.equal(store.historyResult("work-1","session-1","run-01004",0,6).toString(),"汉汉");
  assert.throws(()=>store.historyResult("work-1","other","run-01004",0,6),/not found/);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
