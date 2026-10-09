import test from 'node:test';
import assert from 'node:assert/strict';
const {historyMessages,upsertTool,activityGroups}=await import(new URL('../browser/chat-projection.js',import.meta.url).href);

test('Memory feedback comes from the saved host result and distinguishes candidate, effective, adopted and failure',()=>{
 const result=(value:any,isError=false)=>({kind:'text',text:JSON.stringify(value),isError,truncated:false});
 const project=(value:any,isError=false,name='brain_experience')=>historyMessages([{entryId:'memory',runId:'run-memory',role:'toolResult',blocks:[{blockId:'one',type:'tool-result',toolCallId:'call-memory',toolName:name,result:result(value,isError)}]}])[0].tool.content;
 assert.match(project({version:1,status:'staged'}),/candidate v1 proposed; not effective/);
 assert.match(project({memoryCommit:{version:2,status:'effective',entryIds:['lesson'],evidenceIds:['proof']}}),/Memory: effective v2/);
 assert.match(project({adoptedExperienceVersion:1,effectiveVersion:2}),/this Run uses v1; current effective v2/);
 assert.match(project({version:3,status:'invalidated'}),/invalidated at v3/);
 assert.match(project({version:2,items:[]}),/no matching entries at v2/);
 assert.match(project({memoryCommit:{version:2,status:'effective'}},true),/operation failed; no effective update confirmed/);
 assert.doesNotMatch(project({memoryCommit:{version:2,status:'effective'}},false,'bash'),/Memory: effective/);
});

test('UX ordered history and replay merge only original Run/tool IDs, keeping prose boundaries and safe results',()=>{
 const messages=historyMessages([
  {entryId:'one',runId:'run-1',role:'assistant',blocks:[{blockId:'one-0',type:'text',text:'Before'},{blockId:'one-1',type:'tool-call',toolCallId:'call-1',toolName:'read'},{blockId:'one-2',type:'text',text:'After'}]},
  {entryId:'two',runId:'run-1',role:'toolResult',blocks:[{blockId:'two-0',type:'tool-result',toolCallId:'call-1',toolName:'read',result:{kind:'text',text:'Saved result',truncated:true,isError:false}}]},
  {entryId:'legacy',role:'toolResult',text:'private full result'},
 ]);
 assert.equal(messages.length,4);assert.equal(messages[1].id,'run-1-tool-call-1');assert.equal(messages[1].tool.status,'Completed');assert.match(messages[1].tool.content,/64 KiB/);assert.ok(!messages[3].tool.content.includes('private full result'));
 upsertTool(messages,{runId:'run-1',role:'assistant',text:'',tool:{id:'call-1',name:'read',status:'Running',content:'stale'}});assert.equal(messages.length,4);assert.equal(messages[1].tool.status,'Completed');
 upsertTool(messages,{id:'other-run',runId:'run-2',role:'assistant',text:'',tool:{id:'call-1',name:'read',status:'Running',content:''}});assert.equal(messages.length,5);assert.deepEqual(activityGroups(messages).map((group:any)=>group.activity),[false,true,false,true,true]);
});

test('UX saved history preserves live text keys and repeated text remains separate',()=>{
 const previous=[{id:'live-1',runId:'run-1',role:'assistant',text:'Same prose'},{id:'live-2',runId:'run-1',role:'assistant',text:'Same prose'}];
 const messages=historyMessages([{entryId:'saved',runId:'run-1',role:'assistant',blocks:[{blockId:'saved-0',type:'text',text:'Same prose'},{blockId:'saved-1',type:'text',text:'Same prose'}]}],previous);
 assert.deepEqual(messages.map((message:any)=>message.id),['live-1','live-2']);
});
