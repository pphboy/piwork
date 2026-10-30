import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkStore } from "@piwork/work-store";
import { chatInputDigest, CHAT_IMAGE_PROFILE, type ChatImageInput } from "@piwork/contracts";
import { AgentSessionService } from "./sessions.js";
import { appendAssistantMessage } from "@piwork/pi-adapter";

const image:ChatImageInput={mimeType:"image/png",data:readFileSync(new URL("../../../fixtures/chat-images/png.png",import.meta.url)).toString("base64")};
test("accepted image survives before SDK persistence and restores once without executing an old Run",()=>{
 const root=mkdtempSync(join(tmpdir(),"piwork-image-history-")),workspace=join(root,"workspace");mkdirSync(workspace);
 const store=WorkStore.open(join(root,"work.sqlite"));
 try {
  let sessions=new AgentSessionService("work-image",store,workspace,join(root,"sessions"),"context-a");const session=sessions.create();
  const input={profile:CHAT_IMAGE_PROFILE,prompt:"look",images:[image]};
  const run=store.acceptRun({workId:"work-image",sessionId:session.sessionId,submissionKey:"image-key",requestDigest:"request",promptDigest:chatInputDigest(input.prompt,input.images),privateInputJson:JSON.stringify(input),contextIdentity:"context-a",memoryEnabled:false}).run;
  store.appendEvent(run.runId,"state","{}");store.compactRunEvents(run.runId,1);
  assert.ok(store.privateInput(run.runId));assert.equal(sessions.hasImageContext(session.sessionId),true);
  assert.deepEqual(sessions.image(session.sessionId,run.runId,0),image);
  assert.throws(()=>sessions.image("other-session",run.runId,0));
  sessions.syncImageInputs(session.sessionId);assert.ok(store.privateInput(run.runId),"a header without the SDK message cannot release the input");
  store.interruptActiveRuns();sessions=new AgentSessionService("work-image",store,workspace,join(root,"sessions"),"context-b");
  const current=store.acceptRun({workId:"work-image",sessionId:session.sessionId,submissionKey:"new",requestDigest:"new",promptDigest:"new",contextIdentity:"context-b",memoryEnabled:false}).run;
  const sdk=sessions.continue(session.sessionId);
  sessions.restoreImageInputs(session.sessionId,current.runId,sdk);sessions.restoreImageInputs(session.sessionId,current.runId,sdk);
  assert.equal(sdk.buildSessionContext().messages.filter(m=>m.role==="user").length,1);
  assert.equal(store.getRun(run.runId)?.state,"interrupted");
  const onDisk=sessions.read(session.sessionId).entries.some(e=>e.role==="user");
  sessions.syncImageInputs(session.sessionId);assert.equal(!!store.privateInput(run.runId),!onDisk);
  appendAssistantMessage(sdk,"later answer");sessions.syncImageInputs(session.sessionId);assert.equal(store.privateInput(run.runId),undefined);
  store.compactRunEvents(run.runId,1);assert.deepEqual(sessions.image(session.sessionId,run.runId,0),image);
  assert.equal(sessions.imageHistory(session.sessionId).entries.filter(e=>e.role==="user").length,1);
  writeFileSync(session.sdkHistoryPath,readFileSync(session.sdkHistoryPath,'utf8').replace('"text":"look"','"text":"changed caption"'));
  assert.throws(()=>sessions.image(session.sessionId,run.runId,0),/could not be verified/);
  assert.throws(()=>sessions.hasImageContext(session.sessionId),/could not be verified/);
 } finally {store.close();rmSync(root,{recursive:true,force:true});}
});

test("image input digest mismatch rolls back the complete acceptance",()=>{
 const root=mkdtempSync(join(tmpdir(),"piwork-image-rollback-"));const store=WorkStore.open(join(root,"work.sqlite"));
 try{store.createSession({workId:"w",sessionId:"s",sdkHistoryPath:"unused",createdAt:"2026-10-11T00:00:00Z",updatedAt:"2026-10-11T00:00:00Z"});
 assert.throws(()=>store.acceptRun({workId:"w",sessionId:"s",submissionKey:"bad",requestDigest:"request",promptDigest:"incorrect",privateInputJson:JSON.stringify({profile:CHAT_IMAGE_PROFILE,prompt:"",images:[image]}),memoryEnabled:false}));
 assert.equal(store.listSessionRuns("w","s").length,0);assert.equal(store.findRunSubmission("w","bad"),undefined);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('SDK compaction removes image context without resurrecting the archived input',()=>{
 const root=mkdtempSync(join(tmpdir(),'piwork-image-compaction-')),workspace=join(root,'workspace');mkdirSync(workspace);const store=WorkStore.open(join(root,'work.sqlite'));
 try{const sessions=new AgentSessionService('w',store,workspace,join(root,'sessions'),'context');const session=sessions.create();const input={profile:CHAT_IMAGE_PROFILE,prompt:'old image',images:[image]};const run=store.acceptRun({workId:'w',sessionId:session.sessionId,submissionKey:'old',requestDigest:'old',promptDigest:chatInputDigest(input.prompt,input.images),privateInputJson:JSON.stringify(input),contextIdentity:'context',memoryEnabled:false}).run;store.interruptActiveRuns();
 const current=store.acceptRun({workId:'w',sessionId:session.sessionId,submissionKey:'next',requestDigest:'next',promptDigest:'next',contextIdentity:'context',memoryEnabled:false}).run;
 const sdk=sessions.continue(session.sessionId);sessions.restoreImageInputs(session.sessionId,current.runId,sdk);const assistant=appendAssistantMessage(sdk,'already answered');sdk.appendCompaction('Earlier image summarized.',assistant,100);
 assert.equal(sessions.hasImageContext(session.sessionId),false);sessions.restoreImageInputs(session.sessionId,current.runId,sdk);assert.equal(sdk.getEntries().filter(e=>e.type==='message'&&e.message.role==='user').length,1);assert.ok(store.privateInput(run.runId));sessions.syncImageInputs(session.sessionId);assert.equal(store.privateInput(run.runId),undefined);assert.deepEqual(sessions.image(session.sessionId,run.runId,0),image);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
