import test from 'node:test';
import assert from 'node:assert/strict';
const {historyMessages,mergeLegacyMessages,upsertTool,activityGroups}=await import(new URL('../browser/chat-projection.js',import.meta.url).href);

test('pure image history stays one user message and never becomes tool Activity',()=>{
 const messages=historyMessages([{entryId:'sdk',runId:'run-image',role:'user',blocks:[{blockId:'img',type:'image',image:{imageIndex:0,mimeType:'image/png',byteSize:70,sha256:'a'.repeat(64)}}]}]);
 assert.equal(messages.length,1);assert.equal(messages[0].role,'user');assert.equal(messages[0].id,'run-image-user');assert.equal(messages[0].images.length,1);assert.equal(activityGroups(messages)[0].activity,false);
});

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

test('legacy history does not assign a live identity based on equal text',()=>{
 const messages=historyMessages([{entryId:'saved',runId:'run-1',role:'assistant',blocks:[{blockId:'saved-0',type:'text',text:'Same prose'},{blockId:'saved-1',type:'text',text:'Same prose'}]}]);
 assert.deepEqual(messages.map((message:any)=>message.id),['saved-0','saved-1']);
});

test('legacy merge preserves repeated prose around tools and places an old Run before later messages',()=>{
 const raw=[{entryId:'old-user',runId:'old',role:'user',text:'Question'},
  {entryId:'one',runId:'one',role:'user',text:'1'}, {entryId:'four',runId:'four',role:'user',text:'4'}];
 const previous=[{id:'old-user',runId:'old',role:'user',text:'Question'},
  {id:'old-text-1',runId:'old',role:'assistant',text:'Same'},
  {id:'old-tool-call',runId:'old',role:'assistant',text:'',tool:{id:'call',name:'read',status:'Completed',content:'done'}},
  {id:'old-text-3',runId:'old',role:'assistant',text:'Same'},
  {id:'one',runId:'one',role:'user',text:'1'},{id:'four',runId:'four',role:'user',text:'4'}];
 const result=mergeLegacyMessages(raw,previous);
 assert.deepEqual(result.map((m:any)=>m.runId),['old','old','old','old','one','four']);
 assert.equal(result.filter((m:any)=>m.text==='Same').length,2);
 assert.ok(result.filter((m:any)=>m.text==='Same').every((m:any)=>m.historyRecoveryUnconfirmed));
});

test('legacy same-ID fragments preserve uncovered text and an exact replacement is shown once',()=>{
 const old=[{id:'block',runId:'run',role:'assistant',text:'Long answer'}];
 for(const [saved,expected,unconfirmed] of [['Long','Long answer',true],['Long answer','Long answer',false],['Long answer plus','Long answer plus',false]] as const){
  const result=mergeLegacyMessages([{entryId:'entry',runId:'run',role:'assistant',blocks:[{type:'text',blockId:'block',text:saved}]}],old);
  assert.equal(result.length,1);assert.equal(result[0].text,expected);assert.equal(!!result[0].historyRecoveryUnconfirmed,unconfirmed);
 }
});

test('legacy equal text with different identities is retained and cannot accumulate on reread',()=>{
 const raw=[{entryId:'sdk',runId:'run',role:'assistant',blocks:[{type:'text',blockId:'sdk-0',text:'Same'}]}];
 const previous=[{id:'run-text-1',runId:'run',role:'assistant',text:'Same'}];
 const first=mergeLegacyMessages(raw,previous),second=mergeLegacyMessages(raw,first);
 assert.deepEqual(first.map((m:any)=>m.id),['sdk-0','run-text-1']);assert.equal(second.length,2);
 assert.equal(first[1].historyRecoveryUnconfirmed,true);
});

test('legacy conflicting text with the same identity is preserved without ID collision',()=>{
 const raw=[{entryId:'sdk',runId:'run',role:'assistant',blocks:[{type:'text',blockId:'run-text-1',text:'saved'}]}];
 const first=mergeLegacyMessages(raw,[{id:'run-text-1',runId:'run',role:'assistant',text:'live'}]);
 assert.deepEqual(first.map((m:any)=>m.text),['saved','live']);assert.equal(new Set(first.map((m:any)=>m.id)).size,2);
 assert.ok(first.every((m:any)=>m.historyRecoveryUnconfirmed));assert.equal(mergeLegacyMessages(raw,first).length,2);
});

test('legacy confirmed final identity cannot hide a conflicting durable result or user snapshot',()=>{
 const raw=[{entryId:'one',runId:'run',role:'user',text:'Different prompt'},
  {entryId:'two',runId:'run',role:'assistant',blocks:[{type:'text',blockId:'run-final',text:'Saved answer'}]}];
 const result=mergeLegacyMessages(raw,[{id:'one',runId:'run',role:'user',text:'Original prompt'}],{id:'run-final',runId:'run',role:'assistant',text:'Different final'});
 assert.ok(result.some((m:any)=>m.text==='Original prompt'));assert.ok(result.some((m:any)=>m.text==='Different prompt'));
 assert.ok(result.some((m:any)=>m.text==='Saved answer'));assert.ok(result.some((m:any)=>m.text==='Different final'));
 assert.equal(new Set(result.map((m:any)=>m.id)).size,result.length);
});

test('legacy repeated reads do not accumulate anonymous history and retain earlier known output when the snapshot changes',()=>{
 const first=[{role:'assistant',text:'known'}],second=[{role:'assistant',text:'later'}];
 const initial=mergeLegacyMessages(first,[]),repeat=mergeLegacyMessages(first,initial);
 assert.deepEqual(repeat.map((m:any)=>m.text),['known']);
 const changed=mergeLegacyMessages(second,repeat);assert.deepEqual(changed.map((m:any)=>m.text),['later','known']);
 assert.ok(changed.find((m:any)=>m.text==='known').historyRecoveryUnconfirmed);
 const again=mergeLegacyMessages(second,changed);assert.equal(again.filter((m:any)=>m.text==='later').length,1);
});

test('legacy Run result uses known later-message anchors when the old Run is missing from history',()=>{
 const raw=[{entryId:'one',runId:'one',role:'user',text:'1'},{entryId:'four',runId:'four',role:'user',text:'4'}];
 const previous=[{id:'old-user',runId:'old',role:'user',text:'Earlier'},
  {id:'one',runId:'one',role:'user',text:'1'},{id:'four',runId:'four',role:'user',text:'4'}];
 const result=mergeLegacyMessages(raw,previous,{id:'old-final',runId:'old',role:'assistant',text:'Old result'});
 assert.deepEqual(result.map((message:any)=>message.runId),['old','old','one','four']);
 assert.equal(result.find((message:any)=>message.id==='old-final').historyOrderUnconfirmed,true);
});
