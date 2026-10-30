import test from 'node:test';
import assert from 'node:assert/strict';
const { HistoryProjection }=await import(new URL('../browser/history-projection.js',import.meta.url).href);
const { DesktopAdapter }=await import(new URL('../browser/adapter.js',import.meta.url).href);
const metadata={sessionId:'session-1',workId:'work-1',modelPreference:null,thinkingLevel:'off',source:{kind:'chat'}};
const text=(id:string,order:number,value:string,offset=0,total?:number)=>({entryId:id,entryOrder:order,role:'assistant',runId:'',blockId:`${id}-0`,blockIndex:0,blockCount:1,type:'text',byteOffset:offset,totalBytes:total??new TextEncoder().encode(value).length,text:value,complete:offset+new TextEncoder().encode(value).length===(total??new TextEncoder().encode(value).length)});
const page=(segments:any[],nextCursor:string|null=null)=>({contractVersion:1,session:metadata,snapshotId:'snapshot',segments,runs:[],nextCursor,hasMore:!!nextCursor});

test('older live cancelled turn remains before newly loaded later turns',()=>{
 const projection=new HistoryProjection();
 const user=(runId:string,order:number,value:string)=>({...text(`${runId}-user`,order,value),role:'user',runId,blockId:`${runId}-user-0`});
 const previous=[{id:'old-user',runId:'old',role:'user',text:'Earlier'},
   {id:'old-tool',runId:'old',role:'assistant',text:'',tool:{id:'old-tool',name:'read',status:'Completed'}},
   {id:'one-user',runId:'one',role:'user',text:'1'},
   {id:'four-user',runId:'four',role:'user',text:'4'}];
 projection.merge(page([user('one',5,'1'),user('four',6,'4')]));
 assert.deepEqual(projection.project(previous).map((m:any)=>m.runId),['old','old','one','four']);
});

test('snapshot-local positions are aligned by shared entry identity',()=>{
 const projection=new HistoryProjection();
 projection.merge({...page([text('old',90,'old'),text('shared',91,'shared')]),snapshotId:'older'});
 projection.merge({...page([text('shared',2,'shared'),text('new',3,'new')]),snapshotId:'newer'});
 const messages=projection.project([]);
 assert.deepEqual(messages.map((message:any)=>message.text),['old','shared','new']);
 assert.ok(messages.every((message:any)=>!message.historyOrderUnconfirmed));
});

test('unrelated snapshots retain content and mark uncertain relative order',()=>{
 const projection=new HistoryProjection();
 projection.merge({...page([text('one',100,'same')]),snapshotId:'first'});
 projection.merge({...page([text('two',0,'same')]),snapshotId:'second'});
 const messages=projection.project([]);
 assert.equal(messages.length,2);assert.ok(messages.every((message:any)=>message.historyOrderUnconfirmed));
});

test('verified ordering survives eviction of more than sixteen snapshot coordinates',()=>{
 const projection=new HistoryProjection();
 for(let n=1;n<=24;n++)projection.merge({...page([text(`entry-${n-1}`,0,String(n-1)),text(`entry-${n}`,1,String(n))]),snapshotId:`snapshot-${n}`});
 const messages=projection.project([]);
 assert.deepEqual(messages.map((m:any)=>m.text),Array.from({length:25},(_,n)=>String(n)));
 assert.ok(messages.every((m:any)=>!m.historyOrderUnconfirmed));
 projection.clear();projection.merge({...page([text('fresh',0,'fresh')]),snapshotId:'fresh'});
 assert.deepEqual(projection.project([]).map((m:any)=>m.text),['fresh']);
});

test('terminal Run reads connect consecutive turns in a frozen bounded Session page',async t=>{
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;
 adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[]}],services:[]}];
 t.after(()=>adapter.clearIdentity());
 const requests:URL[]=[],turns:any[]=[];let snapshot=0;
 t.mock.method(globalThis,'fetch',async(input:any,init:any)=>{
  assert.equal(init?.method??'GET','GET');const url=new URL(String(input),'http://desktop.test');requests.push(url);
  if(url.pathname.endsWith('/history-capabilities'))return Response.json({contractVersion:1,profile:'session-history-v1',pageBytes:524288});
  if(url.pathname.endsWith('/chat-image-capabilities'))return Response.json({code:'UNSUPPORTED'},{status:501});
  assert.ok(url.pathname.endsWith('/history'));assert.equal(url.searchParams.has('cursor'),false,'Do not traverse earlier Session pages');
  const runId=url.searchParams.get('runId');
  if(runId)assert.equal(url.searchParams.get('snapshot'),`frozen-${snapshot}`);
  else snapshot++;
  const segments=runId?turns.filter(part=>part.runId===runId):turns.slice(-4);
  return Response.json({...page(segments,!runId&&turns.length>4?'unread-earlier':null),snapshotId:`frozen-${snapshot}`});
 });
 for(let n=1;n<=20;n++){
  const runId=`run-${n}`;
  turns.push({...text(`${runId}-user`,n*2-2,`Question ${n}`),role:'user',runId},{...text(`${runId}-reply`,n*2-1,`Reply ${n}`),runId});
  await adapter.loadSavedRun('work-1',{id:runId,sessionId:'session-1',status:'succeeded'});
  const messages=adapter.getWork('work-1').sessions[0].messages;
  assert.equal(messages.length,n*2);assert.ok(messages.every((m:any)=>!m.historyOrderUnconfirmed&&!m.historyRecoveryUnconfirmed));
 }
 assert.equal(requests.filter(url=>url.pathname.endsWith('/history')&&!url.searchParams.has('runId')).length,20);
 await adapter.loadSession('work-1','session-1');
 assert.equal(adapter.getWork('work-1').sessions[0].messages.length,40);
});

test('a large terminal Run connects to one known boundary without walking Session history',async t=>{
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;
 adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[]}],services:[]}];
 t.after(()=>adapter.clearIdentity());
 const old=[{...text('old-user',0,'Earlier'),role:'user',runId:'old'},{...text('old-reply',1,'Earlier reply'),runId:'old'}];
 const fresh=[{...text('new-user',2,'Next'),role:'user',runId:'new'},...Array.from({length:3},(_,n)=>({...text(`new-${n}`,n+3,`Next part ${n}`),runId:'new'}))];
 const projection=adapter.historyProjection('work-1','session-1');projection.merge({...page(old),snapshotId:'before'});
 adapter.getWork('work-1').sessions[0].messages=projection.project([]);
 const requests:URL[]=[];
 t.mock.method(globalThis,'fetch',async(input:any,init:any)=>{
  assert.equal(init?.method??'GET','GET');const url=new URL(String(input),'http://desktop.test');requests.push(url);
  const runId=url.searchParams.get('runId'),cursor=url.searchParams.get('cursor');
  if(!runId){assert.equal(cursor,null);return Response.json({...page(fresh.slice(-2),'session-earlier'),snapshotId:'frozen'});}
  assert.equal(url.searchParams.get('snapshot'),'frozen');
  if(runId==='old'){assert.equal(url.searchParams.get('limit'),'1');return Response.json({...page(old.slice(-1),'unused-boundary'),snapshotId:'frozen'});}
  assert.equal(runId,'new');return Response.json({...page(cursor?fresh.slice(0,2):fresh.slice(2),cursor?null:'run-earlier'),snapshotId:'frozen'});
 });
 await adapter.loadSavedRun('work-1',{id:'new',sessionId:'session-1',status:'succeeded'});
 const messages=adapter.getWork('work-1').sessions[0].messages;
 assert.deepEqual(messages.map((m:any)=>m.text),['Earlier','Earlier reply','Next','Next part 0','Next part 1','Next part 2']);
 assert.ok(messages.every((m:any)=>!m.historyOrderUnconfirmed));assert.equal(requests.length,4);
 assert.equal(requests.filter(url=>!url.searchParams.has('runId')).length,1);
});

test('terminal readback without a complete saved reply keeps live output',()=>{
 for(const segments of [[],[{...text('partial',2,'later',5,10),runId:'run-1'}]]){
  const projection=new HistoryProjection();projection.merge(page(segments));
  const result=projection.project([{id:'run-1-text-3',runId:'run-1',role:'assistant',text:'Already visible'}],new Set(['run-1']));
  assert.ok(result.some((message:any)=>message.text==='Already visible'));
 }
});

test('matching checkpoint identity merges verified live and saved byte ranges without losing content',()=>{
 const id='run-1-text-3';
 for(const scenario of [
  {saved:'你好',offset:0,total:12,live:'你好世界',expected:'你好世界'},
  {saved:'世界',offset:6,total:12,live:'你好',expected:'你好世界'},
  {saved:'你好世界',offset:0,total:12,live:'你好',expected:'你好世界'},
  {saved:'你好',offset:0,total:6,live:'你好世界',expected:'你好世界'},
 ]){
  const projection=new HistoryProjection();
  projection.merge(page([{...text('checkpoint',0,scenario.saved,scenario.offset,scenario.total),runId:'run-1',blockId:id}]));
  const messages=projection.project([{id,runId:'run-1',role:'assistant',text:scenario.live}],new Set(['run-1']));
  assert.equal(messages.length,1);assert.equal(messages[0].text,scenario.expected);
  const reread=projection.project(messages,new Set(['run-1']));assert.equal(reread.length,1);assert.equal(reread[0].text,scenario.expected);
 }
});

test('conflicting or separated ranges with the same event identity keep both pieces explicit',()=>{
 const id='run-1-text-3';
 for(const scenario of [{saved:'其他',offset:0,total:6,live:'你好'}, {saved:'世界',offset:6,total:12,live:'你'}]){
  const projection=new HistoryProjection();projection.merge(page([{...text('checkpoint',0,scenario.saved,scenario.offset,scenario.total),runId:'run-1',blockId:id}]));
  const messages=projection.project([{id,runId:'run-1',role:'assistant',text:scenario.live}],new Set(['run-1']));
  assert.equal(messages.length,2);assert.ok(messages.some((message:any)=>message.text===scenario.live&&message.historyRecoveryUnconfirmed));
  assert.ok(messages.some((message:any)=>message.text===scenario.saved));assert.equal(new Set(messages.map((message:any)=>message.id)).size,2);
 }
});

test('terminal readback does not discard unmatched text just because a Run has another saved answer',()=>{
 const projection=new HistoryProjection();projection.merge(page([{...text('saved',2,'Different saved answer'),runId:'run-1'}]));
 const result=projection.project([{id:'run-1-text-3',runId:'run-1',role:'assistant',text:'Already visible'}],new Set(['run-1']));
 assert.equal(result.find((message:any)=>message.text==='Already visible')?.historyRecoveryUnconfirmed,true);
 assert.ok(result.some((message:any)=>message.text==='Different saved answer'));
});

test('equal text in an old history without event identity is retained as unconfirmed',()=>{
 const projection=new HistoryProjection();projection.merge(page([{...text('saved',0,'Same'),runId:'run-1'}]));
 const result=projection.project([{id:'run-1-text-3',runId:'run-1',role:'assistant',text:'Same'}],new Set(['run-1']));
 assert.equal(result.length,2);assert.ok(result.some((message:any)=>message.historyRecoveryUnconfirmed));
});

test('the same message identifier in another Run cannot suppress live output',()=>{
 const projection=new HistoryProjection();projection.merge(page([{...text('saved',0,'saved'),blockId:'shared',runId:'run-1'}]));
 const result=projection.project([{id:'shared',runId:'run-2',role:'assistant',text:'live'}],new Set(['run-2']));
 assert.equal(result.length,2);assert.ok(result.some((message:any)=>message.runId==='run-2'&&message.text==='live'));
});

test('server marks unmatched checkpoint content as unconfirmed in the message',()=>{
 const projection=new HistoryProjection();
 projection.merge(page([{...text('saved',0,'已有历史'),runId:'run-1'},{...text('checkpoint',1,'已输出内容'),runId:'run-1',recoveryUnconfirmed:true}]));
 const messages=projection.project([]);
 assert.equal(messages.length,2);assert.equal(messages[0].historyRecoveryUnconfirmed,false);assert.equal(messages[1].historyRecoveryUnconfirmed,true);
});

test('verified SDK prefix and checkpoint tail do not repeat the same final result',()=>{
 const runId='run-1',projection=new HistoryProjection();
 const sdk={...text('sdk',0,'开头'),runId};
 const tail={...text('tail',1,'后续'),runId,blockId:`${runId}-text-4-remaining-6`};
 const final={...text(`${runId}-final`,2,'开头后续'),runId,type:'run-result'};
 projection.merge(page([sdk,tail,final]));
 const messages=projection.project([]);assert.deepEqual(messages.map((message:any)=>message.text),['开头','后续']);
 assert.deepEqual(projection.project(messages).map((message:any)=>message.text),['开头','后续']);
 const live=projection.project([{id:`${runId}-text-4`,runId,role:'assistant',text:'开头后续'}],new Set([runId]));
 assert.deepEqual(live.map((message:any)=>message.text),['开头','后续']);
});

test('equal prose without a verified checkpoint boundary keeps distinct results',()=>{
 const runId='run-1',projection=new HistoryProjection();
 projection.merge(page([{...text('sdk',0,'开头'),runId},{...text('tail',1,'后续'),runId},{...text(`${runId}-final`,2,'开头后续'),runId,type:'run-result'}]));
 assert.equal(projection.project([]).length,3);
});

test('a verified SDK prefix and checkpoint tail replace their live stream even without a final result',()=>{
 const runId='run-1',projection=new HistoryProjection();
 projection.merge(page([{...text('sdk',0,'开头'),runId},{...text('tail',1,'后续'),runId,blockId:`${runId}-text-4-remaining-6`} ]));
 const live=[{id:`${runId}-text-4`,runId,role:'assistant',text:'开头后续'}];
 assert.deepEqual(projection.project(live,new Set([runId])).map((message:any)=>message.text),['开头','后续']);
});

test('a complete result avoids duplicating an incomplete verified checkpoint and switches when it is complete',()=>{
 const runId='run-1',projection=new HistoryProjection(),blockId=`${runId}-text-4-remaining-6`;
 const sdk={...text('sdk',0,'开头'),runId},tail={...text('tail',1,'续',3,6),runId,blockId};
 const final={...text(`${runId}-final`,2,'开头后续'),runId,type:'run-result'};
 projection.merge(page([sdk,tail,final]));
 const partial=projection.project([]);assert.deepEqual(partial.map((message:any)=>message.text),['开头后续']);
 projection.merge(page([{...text('tail',1,'后',0,6),runId,blockId}]));
 assert.deepEqual(projection.project(partial).map((message:any)=>message.text),['开头','后续']);
});

test('same Run with tools never drops a repeated live text merely because another turn matches',()=>{
 const projection=new HistoryProjection();
 projection.merge(page([{...text('saved',0,'Same'),runId:'run-1'}, {...text('tool',1,''),runId:'run-1',type:'tool-call',toolCallId:'call-1',toolName:'read'}]));
 const live=[{id:'run-1-text-5',runId:'run-1',role:'assistant',text:'Same'}, {id:'run-1-tool-call-1',runId:'run-1',role:'assistant',text:'',tool:{id:'call-1',name:'read',status:'Running'}}];
 const result=projection.project(live,new Set(['run-1']));
 assert.equal(result.filter((message:any)=>message.text==='Same').length,2);
 assert.equal(result.filter((message:any)=>message.tool).length,1);
});

test('verified event coordinates deduplicate repeated SDK text around a tool by identity',()=>{
 const runId='run-1',projection=new HistoryProjection();
 projection.merge(page([
  {...text('first',0,'相同'),runId,streamId:`${runId}-text-1`,streamOffset:0},
  {...text('tool',1,''),runId,type:'tool-call',toolCallId:'call-1',toolName:'read'},
  {...text('second',2,'相同'),runId,streamId:`${runId}-text-5`,streamOffset:0},
 ]));
 const live=[{id:`${runId}-text-1`,runId,role:'assistant',text:'相同'},
  {id:`${runId}-tool-call-1`,runId,role:'assistant',text:'',tool:{id:'call-1',name:'read',status:'Running'}},
  {id:`${runId}-text-5`,runId,role:'assistant',text:'相同'}];
 const result=projection.project(live,new Set([runId]));
 assert.deepEqual(result.map((message:any)=>message.tool?'tool':message.text),['相同','tool','相同']);
});

test('verified stream coordinates require complete matching byte coverage and the same Run',()=>{
 const runId='run-1',id=`${runId}-text-1`;
 for(const scenario of [
  {segments:[{...text('saved',0,'前',0,6),runId,streamId:id,streamOffset:0}],live:'前后'},
  {segments:[{...text('saved',0,'不同'),runId,streamId:id,streamOffset:0}],live:'前后'},
  {segments:[{...text('saved',0,'前后'),runId:'other',streamId:id,streamOffset:0}],live:'前后'},
 ]){
  const projection=new HistoryProjection();projection.merge(page(scenario.segments));
  const result=projection.project([{id,runId,role:'assistant',text:scenario.live}],new Set([runId]));
  assert.ok(result.some((message:any)=>message.text===scenario.live&&message.runId===runId&&!message.historyStored));
 }
 const projection=new HistoryProjection();
 projection.merge(page([{...text('prefix',0,'前'),runId,streamId:id,streamOffset:0},{...text('tail',1,'后'),runId,streamId:id,streamOffset:3}]));
 assert.deepEqual(projection.project([{id,runId,role:'assistant',text:'前后'}],new Set([runId])).map((message:any)=>message.text),['前','后']);
});

test('history fragments merge byte overlaps, preserve distinct equal prose, and mark gaps',()=>{
 const projection=new HistoryProjection();
 projection.merge(page([text('one',0,'后半',6,12),text('two',1,'Same'),text('three',2,'Same')]));
 let messages=projection.project([]);assert.equal(messages[0].historyIncomplete,true);assert.equal(messages[0].text,'后半');assert.equal(messages.filter((m:any)=>m.text==='Same').length,2);
 projection.merge(page([text('one',0,'前半',0,12)]));projection.merge(page([text('one',0,'前半',0,12)]));
 messages=projection.project(messages);assert.equal(messages[0].text,'前半后半');assert.equal(messages[0].historyIncomplete,false);assert.equal(messages.length,3);
 assert.throws(()=>projection.merge(page([text('one',0,'错字',0,12)])),/conflicting/);
});

test('cross-page tool results cannot be downgraded by a late start',()=>{
 const projection=new HistoryProjection();
 const part={...text('result',1,'done'),role:'toolResult',runId:'run-1',blockId:'result-0',type:'tool-result',toolCallId:'call-1',toolName:'read',resultKind:'text',truncated:false,isError:false};
 projection.merge(page([part]));let messages=projection.project([]);assert.equal(messages[0].tool.status,'Completed');
 projection.merge(page([{...text('start',0,''),runId:'run-1',type:'tool-call',toolCallId:'call-1',toolName:'read'}]));
 messages=projection.project(messages);assert.equal(messages.length,1);assert.equal(messages[0].tool.status,'Completed');assert.equal(messages[0].tool.content,'done');
});

test('adapter loads only recent page, dedupes older reads, and preserves known content on a failed page',async t=>{
 const requests:string[]=[];let resolve!:(value:Response)=>void;let older:Promise<Response>|undefined;
 t.mock.method(globalThis,'fetch',async(input:any)=>{
  const url=new URL(String(input),'http://desktop.test'),path=url.pathname;requests.push(path+url.search);
  if(path.endsWith('/history-capabilities'))return Response.json({contractVersion:1,profile:'session-history-v1',pageBytes:524288});
  if(path.endsWith('/chat-image-capabilities'))return Response.json({code:'IMAGE_INPUT_UNSUPPORTED'},{status:501});
  if(path.endsWith('/history')) {
   if(url.searchParams.has('cursor')){older??=new Promise(done=>resolve=done);return older;}
   return Response.json(page([text('latest',1,'Latest')],'older'));
  }
  throw new Error(`Unexpected ${path}`);
 });
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[]}],services:[]}];
 t.after(()=>adapter.clearIdentity());
 await adapter.loadSession('work-1','session-1');
 const session=adapter.getWork('work-1').sessions[0];assert.deepEqual(session.messages.map((m:any)=>m.text),['Latest']);
 assert.equal(requests.filter(path=>path.includes('/history?')).length,1);
 const first=adapter.loadEarlierHistory('work-1','session-1'),second=adapter.loadEarlierHistory('work-1','session-1');
 await Promise.resolve();await Promise.resolve();resolve(Response.json({code:'HISTORY_CURSOR_EXPIRED',message:'Snapshot expired'},{status:410}));
 await Promise.allSettled([first,second]);assert.equal(session.history.expired,true);assert.deepEqual(session.messages.map((m:any)=>m.text),['Latest']);
 assert.equal(requests.filter(path=>path.includes('cursor=older')).length,1);
 assert.equal(requests.some(path=>/sessions\/session-1(?:\?|$)/.test(path)),false);
});

test('late history after identity reset never enters the next account',async t=>{
 let resolve!:(value:Response)=>void;
 t.mock.method(globalThis,'fetch',async(input:any)=>{
  const path=String(input);
  if(path.includes('history-capabilities'))return Response.json({contractVersion:1,profile:'session-history-v1',pageBytes:524288});
  if(path.includes('chat-image-capabilities'))return Response.json({code:'UNSUPPORTED'},{status:501});
  return new Promise<Response>(done=>resolve=done);
 });
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[]}],services:[]}];
 const read=adapter.loadSession('work-1','session-1');for(let i=0;i<20&&!resolve;i++)await Promise.resolve();
 adapter.clearIdentity();resolve(Response.json(page([text('old-account',0,'private old text')])));await read;
 assert.equal(adapter.state.works.length,0);
});

test('Core 416 cursor recovery reads original Run ranges and stops with one final answer',async t=>{
 const requests:string[]=[];
 const ref={workId:'work-1',sessionId:'session-1',runId:'run-1',content:'result'};
 const raw={workId:'work-1',sessionId:'session-1',runId:'run-1',state:4,resultRef:ref};
 t.mock.method(globalThis,'fetch',async(input:any)=>{
  const url=new URL(String(input),'http://desktop.test');requests.push(url.pathname+url.search);
  if(url.pathname.endsWith('/history-capabilities'))return Response.json({contractVersion:1,profile:'session-history-v1',pageBytes:524288});
  if(url.pathname.endsWith('/events')){assert.equal(url.searchParams.get('responseProfile'),'history-v1');return Response.json({code:'CURSOR_EXPIRED'},{status:416});}
  if(url.pathname.endsWith('/runs/run-1')){assert.equal(url.searchParams.get('responseProfile'),'history-v1');return Response.json(raw);}
  if(url.pathname.endsWith('/history')){if(url.searchParams.has('runId'))assert.equal(url.searchParams.get('runId'),'run-1');return Response.json(page([{...text('saved',0,'Saved final answer'),runId:'run-1',streamId:'run-1-text-1',streamOffset:0}]));}
  throw new Error(`Unexpected ${url}`);
 });
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;
 const run={id:'run-1',sessionId:'session-1',status:'running',cursor:1,created:''};
 adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[{id:'run-1-text-1',runId:'run-1',role:'assistant',text:'Saved final'}]}],services:[],run}];
 t.after(()=>adapter.clearIdentity());await adapter.resumeRun('work-1');
 const session=adapter.getWork('work-1').sessions[0];assert.deepEqual(session.messages.map((m:any)=>m.text),['Saved final answer']);assert.equal(run.status,'succeeded');
 assert.equal(adapter.historyObservers.size,0);assert.equal(adapter.reconnects.size,0);assert.ok(requests.every(path=>!path.endsWith('/sessions/session-1')));
 assert.ok(requests[0]!.endsWith('/history-capabilities'));
});

test('an unrelated 416 event error does not start cursor recovery',async t=>{
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;
 const run:any={id:'run-1',sessionId:'session-1',status:'running',cursor:1,created:''};
 adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[]}],services:[],run}];
 let historyReads=0;t.mock.method(globalThis,'fetch',async(input:any)=>{
  const url=new URL(String(input),'http://desktop.test');
  if(url.pathname.endsWith('/history-capabilities'))return Response.json({contractVersion:1,profile:'session-history-v1',pageBytes:524288});
  if(url.pathname.endsWith('/events'))return Response.json({code:'OTHER_RANGE',message:'Different range error'},{status:416});
  if(url.pathname.endsWith('/history'))historyReads++;
  throw new Error(`Unexpected ${url}`);
 });
 t.after(()=>adapter.clearIdentity());await adapter.resumeRun('work-1');
 assert.equal(run.historyRecovery,undefined);assert.equal(historyReads,0);assert.match(String(run.error),/Different range error/);
});

test('410 recovery with an empty saved result keeps the already observed reply',async t=>{
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;
 const run={id:'run-1',sessionId:'session-1',status:'running',cursor:1,created:''};
 adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[{id:'run-1-text-1',runId:'run-1',role:'assistant',text:'Already seen'}]}],services:[],run}];
 const requests:string[]=[];
 t.mock.method(globalThis,'fetch',async(input:any)=>{
  const url=new URL(String(input),'http://desktop.test');requests.push(url.pathname);
  if(url.pathname.endsWith('/history-capabilities'))return Response.json({contractVersion:1,profile:'session-history-v1',pageBytes:524288});
  if(url.pathname.endsWith('/events'))return Response.json({code:'CURSOR_EXPIRED'},{status:410});
  if(url.pathname.endsWith('/runs/run-1'))return Response.json({workId:'work-1',sessionId:'session-1',runId:'run-1',state:6,resultRef:null});
  if(url.pathname.endsWith('/history'))return Response.json(page([]));
  throw new Error(`Unexpected ${url}`);
 });
 t.after(()=>adapter.clearIdentity());await adapter.resumeRun('work-1');
 const messages=adapter.getWork('work-1').sessions[0].messages;
 assert.equal(messages.length,1);assert.equal(messages[0].text,'Already seen');assert.equal(messages[0].historyRecoveryUnconfirmed,true);
 assert.equal(run.status,'cancelled');assert.equal(requests.filter(path=>path.endsWith('/events')).length,1);
});

test('legacy Agent 410 recovery retains already visible text and its original Run when history is empty',async t=>{
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;adapter.historySupport.set('work-1',false);
 const run:any={id:'run-1',sessionId:'session-1',status:'running',cursor:7,created:''};
 adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[{id:'run-1-text-1',runId:'run-1',role:'assistant',text:'Already seen'}]}],services:[],run}];
 const methods:string[]=[];
 t.mock.method(globalThis,'fetch',async(input:any,init:any)=>{
  const path=new URL(String(input),'http://desktop.test').pathname;methods.push(init?.method??'GET');
  if(path.endsWith('/events'))return Response.json({code:'CURSOR_EXPIRED'},{status:410});
  if(path.endsWith('/runs/run-1'))return Response.json({workId:'work-1',sessionId:'session-1',runId:'run-1',state:6,finalText:''});
  if(path.endsWith('/sessions/session-1'))return Response.json({messages:[]});
  throw new Error(`Unexpected ${path}`);
 });
 t.after(()=>adapter.clearIdentity());await adapter.resumeRun('work-1');
 const messages=adapter.getWork('work-1').sessions[0].messages;
 assert.equal(run.status,'cancelled');assert.equal(messages.length,1);assert.equal(messages[0].text,'Already seen');
 assert.equal(messages[0].runId,'run-1');assert.equal(messages[0].historyRecoveryUnconfirmed,true);
 assert.ok(methods.every(method=>method==='GET'));
});

test('legacy final result retains the actual Run identity even when another Run has equal text',async t=>{
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;adapter.historySupport.set('work-1',false);
 const run:any={id:'run-1',sessionId:'session-1',status:'running',cursor:7,created:''};
 adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[]}],services:[],run}];
 t.mock.method(globalThis,'fetch',async(input:any)=>{
  const path=new URL(String(input),'http://desktop.test').pathname;
  if(path.endsWith('/events'))return Response.json({code:'CURSOR_EXPIRED'},{status:410});
  if(path.endsWith('/runs/run-1'))return Response.json({workId:'work-1',sessionId:'session-1',runId:'run-1',state:6,finalText:'Equal'});
  if(path.endsWith('/sessions/session-1'))return Response.json({messages:[{entryId:'old',runId:'old',role:'assistant',blocks:[{blockId:'old-0',type:'text',text:'Equal'}]}]});
  throw new Error(`Unexpected ${path}`);
 });
 t.after(()=>adapter.clearIdentity());await adapter.resumeRun('work-1');
 const messages=adapter.getWork('work-1').sessions[0].messages;
 assert.deepEqual(messages.map((message:any)=>[message.runId,message.text]),[['old','Equal'],['run-1','Equal']]);
 assert.equal(messages[1].id,'run-1-final');
});

test('legacy active Run restoration keeps saved output when replay and history read fail',async t=>{
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;
 adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[]}],services:[]}];
 let historyReads=0;
 t.mock.method(globalThis,'fetch',async(input:any)=>{
  const path=new URL(String(input),'http://desktop.test').pathname;
  if(path.endsWith('/history-capabilities'))return Response.json({code:'HISTORY_UNSUPPORTED'},{status:501});
  if(path.endsWith('/chat-image-capabilities'))return Response.json({code:'UNSUPPORTED'},{status:501});
  if(path.endsWith('/sessions/session-1')){historyReads++;return historyReads===1?Response.json({session:metadata,messages:[{entryId:'saved',runId:'run-1',role:'assistant',blocks:[{blockId:'saved-0',type:'text',text:'Already saved'}]}],runs:[{runId:'run-1',sessionId:'session-1',state:2}]}):Response.json({code:'CORE_UNAVAILABLE'},{status:503});}
  if(path.endsWith('/events'))return Response.json({code:'CURSOR_EXPIRED'},{status:410});
  if(path.endsWith('/runs/run-1'))return Response.json({runId:'run-1',sessionId:'session-1',state:2});
  throw new Error(`Unexpected ${path}`);
 });
 t.after(()=>adapter.clearIdentity());await adapter.loadSession('work-1','session-1');
 for(let i=0;i<50&&historyReads<2;i++)await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(historyReads,2);assert.ok(adapter.getWork('work-1').sessions[0].messages.some((message:any)=>message.text==='Already saved'));
});

test('legacy replay never appends new deltas into already saved assistant text',async t=>{
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;adapter.historySupport.set('work-1',false);
 const run:any={id:'run-1',sessionId:'session-1',status:'running',cursor:0,created:''};
 adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[{id:'sdk-text',runId:'run-1',role:'assistant',text:'Saved text',historyStored:true}]}],services:[],run}];
 const events=[{sequence:1,kind:{$case:'text',text:{delta:'New '}}},{sequence:2,kind:{$case:'text',text:{delta:'text'}}}].map(event=>JSON.stringify(event)).join('\n')+'\n';
 t.mock.method(globalThis,'fetch',async(input:any)=>{
  const path=new URL(String(input),'http://desktop.test').pathname;
  if(path.endsWith('/events'))return new Response(events);
  if(path.endsWith('/runs/run-1'))return Response.json({runId:'run-1',sessionId:'session-1',state:2});
  throw new Error(`Unexpected ${path}`);
 });
 t.after(()=>adapter.clearIdentity());await adapter.resumeRun('work-1');
 const messages=adapter.getWork('work-1').sessions[0].messages;
 assert.deepEqual(messages.map((message:any)=>message.text),['Saved text','New text']);
 assert.equal(messages[1].historyRecoveryUnconfirmed,true);
});

test('410 recovery failure preserves the original text and exposes the read failure',async t=>{
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;
 const run={id:'run-1',sessionId:'session-1',status:'running',cursor:1,created:''};
 adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[{id:'run-1-text-1',runId:'run-1',role:'assistant',text:'Already seen'}]}],services:[],run}];
 t.mock.method(globalThis,'fetch',async(input:any)=>{
  const url=new URL(String(input),'http://desktop.test');
  if(url.pathname.endsWith('/history-capabilities'))return Response.json({contractVersion:1,profile:'session-history-v1',pageBytes:524288});
  if(url.pathname.endsWith('/events'))return Response.json({code:'CURSOR_EXPIRED'},{status:410});
  if(url.pathname.endsWith('/runs/run-1'))return Response.json({workId:'work-1',sessionId:'session-1',runId:'run-1',state:6,resultRef:null});
  if(url.pathname.endsWith('/history'))return Response.json({code:'RUNTIME_UNAVAILABLE',message:'History unavailable'},{status:503});
  throw new Error(`Unexpected ${url}`);
 });
 t.after(()=>adapter.clearIdentity());await adapter.resumeRun('work-1');
 assert.equal(adapter.getWork('work-1').sessions[0].messages[0].text,'Already seen');
 assert.match((run as any).error,/History unavailable/);assert.equal(run.status,'cancelled');
});

test('accepted user identity survives durable text blocks without duplicating a live prompt',()=>{
 const projection=new HistoryProjection();projection.merge(page([{...text('run-1-user',0,'First'),role:'user',runId:'run-1',blockId:'run-1-user-0',blockCount:2},{...text('run-1-user',0,' second'),role:'user',runId:'run-1',blockId:'run-1-user-1',blockIndex:1,blockCount:2}]));
 const saved=projection.project([{id:'run-1-user',runId:'run-1',role:'user',text:'First second'}]);
 assert.equal(saved.length,1);assert.equal(saved[0].id,'run-1-user');assert.equal(saved[0].text,'First second');assert.equal(saved[0].historyIncomplete,false);
});

test('submission snapshot is anchored before acceptance and retains its original identity after lost response',async t=>{
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;
 adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[]}],services:[]}];
 t.after(()=>adapter.clearIdentity());
 t.mock.method(adapter,'assertCoreReady',()=>{});t.mock.method(adapter,'modelReady',()=>true);t.mock.method(adapter,'supportsHistory',async()=>true);t.mock.method(adapter,'resumeRun',async()=>{});
 let rejectPost!:(error:Error)=>void,originalKey='';const post=new Promise((_,reject)=>{rejectPost=reject;});
 t.mock.method(adapter,'request',async(path:string,method:string,body:any)=>{
  if(method==='POST'){originalKey=body.submissionKey;return post;}
  if(path.includes('/submissions/'))return {kind:'run',status:'accepted',key:originalKey,run:{workId:'work-1',sessionId:'session-1',runId:'run-original',submissionKey:originalKey,state:4}};
  throw new Error(`Unexpected request ${path}`);
 });
 t.mock.method(adapter,'loadSession',async()=>{});
 const sending=adapter.send('work-1','session-1','Original',false,'text');
 const message=adapter.getWork('work-1').sessions[0].messages[0];assert.equal(message.text,'Original');assert.equal(message.submission.phase,'sending');
 await Promise.resolve();rejectPost(Object.assign(new Error('response lost'),{code:'RESULT_UNKNOWN'}));await assert.rejects(sending);
 assert.equal(message.submission.phase,'unknown');assert.equal(message.submission.key,originalKey);
 await adapter.recoverChatSubmission('work-1');
 assert.equal(message.runId,'run-original');assert.equal(message.submission.phase,'accepted');assert.equal(adapter.getWork('work-1').sessions[0].messages.length,1);assert.equal(adapter.chatSubmissions.size,0);
});

test('original-key recovery negotiates a cleared history capability before reading acceptance',async t=>{
 const requests:string[]=[];
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;
 adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[]}],services:[]}];
 adapter.chatSubmissions.set('work-1',{kind:'run',key:'original-key',sessionId:'session-1',error:''});
 adapter.historySupport.set('work-1',true);adapter.historySupport.delete('work-1');
 t.mock.method(globalThis,'fetch',async(input:any,init:any)=>{
  assert.equal(init.method,'GET');const url=new URL(String(input),'http://desktop.test');requests.push(url.pathname+url.search);
  if(url.pathname.endsWith('/history-capabilities'))return Response.json({contractVersion:1,profile:'session-history-v1',pageBytes:524288});
  assert.equal(url.pathname,'/_desktop/api/works/work-1/runs/submissions/original-key');
  assert.equal(url.searchParams.get('responseProfile'),'history-v1');
  return Response.json({kind:'run',key:'original-key',status:'not-found'});
 });
 t.after(()=>adapter.clearIdentity());await adapter.recoverChatSubmission('work-1');
 assert.equal(requests.length,2);assert.ok(requests[0]!.endsWith('/history-capabilities'));
 assert.equal(adapter.chatSubmissions.get('work-1').key,'original-key');
 assert.match(String(adapter.chatSubmissions.get('work-1').error),/not found/);
});

test('identity change during original-key capability negotiation stops the old lookup',async t=>{
 let resolve!:(value:Response)=>void;const requests:string[]=[];
 t.mock.method(globalThis,'fetch',async(input:any)=>{requests.push(String(input));return new Promise<Response>(done=>resolve=done);});
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;
 adapter.chatSubmissions.set('work-1',{kind:'run',key:'old-key',sessionId:'session-1',error:''});
 const pending=adapter.recoverChatSubmission('work-1');await Promise.resolve();
 adapter.clearIdentity();resolve(Response.json({contractVersion:1,profile:'session-history-v1',pageBytes:524288}));
 await assert.rejects(pending,{code:'CONNECTION_CHANGED'});assert.equal(requests.length,1);assert.ok(requests[0]!.endsWith('/history-capabilities'));
 assert.equal(adapter.historySupport.size,0);
});

test('accepted original-key recovery uses its summary and saved pages without another submission',async t=>{
 const requests:string[]=[],resumed:string[]=[];
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[]}],services:[]}];
 adapter.chatSubmissions.set('work-1',{kind:'run',key:'original-key',sessionId:'session-1',error:''});
 t.mock.method(adapter,'resumeRun',async(id:string)=>{resumed.push(adapter.getWork(id).run.id);});
 t.mock.method(globalThis,'fetch',async(input:any,init:any)=>{
  assert.equal(init.method,'GET');const url=new URL(String(input),'http://desktop.test');requests.push(url.pathname+url.search);
  if(url.pathname.endsWith('/history-capabilities'))return Response.json({contractVersion:1,profile:'session-history-v1',pageBytes:524288});
  if(url.pathname.endsWith('/chat-image-capabilities'))return Response.json({code:'UNSUPPORTED'},{status:501});
  if(url.pathname.includes('/runs/submissions/')){
   assert.equal(url.searchParams.get('responseProfile'),'history-v1');
   return Response.json({kind:'run',key:'original-key',status:'accepted',run:{workId:'work-1',sessionId:'session-1',runId:'original-run',submissionKey:'original-key',state:4,resultRef:{workId:'work-1',sessionId:'session-1',runId:'original-run',content:'result'}}});
  }
  assert.ok(url.pathname.endsWith('/history'));
  return Response.json(page([{...text('saved',0,'Original saved answer'),runId:'original-run'}]));
 });
 t.after(()=>adapter.clearIdentity());await adapter.recoverChatSubmission('work-1');
 assert.equal(adapter.chatSubmissions.size,0);assert.deepEqual(resumed,['original-run']);
 assert.equal(adapter.getWork('work-1').sessions[0].messages[0].text,'Original saved answer');
 assert.ok(requests.every(path=>!path.endsWith('/sessions/session-1')));
});

test('explicit result targets replace a fallback only after SDK text is complete and resist old pages',()=>{
 const projection=new HistoryProjection(),runId='run-1',fallback=`${runId}-final`,answer='Final answer';
 const resultPage=(segments:any[],target:string)=>({...page(segments),runs:[{runId,resultRef:{workId:'work-1',sessionId:'session-1',runId,content:'result',entryId:target}}]});
 const saved={...text(fallback,2,answer),runId,type:'run-result'};
 const old=resultPage([saved],fallback);projection.merge(old);
 let messages=projection.project([]);assert.equal(messages.length,1);
 projection.merge(resultPage([{...text('sdk-final',2,'answer',6,12),runId},{...text('other-turn',0,answer),runId}], 'sdk-final'));
 messages=projection.project(messages);
 assert.equal(messages.filter((m:any)=>m.text===answer).length,2); // The other turn is distinct.
 assert.equal(messages.filter((m:any)=>m.id===`${fallback}-0`).length,1);
 assert.ok(messages.every((m:any)=>!m.historyIncomplete));
 projection.merge(resultPage([{...text('sdk-final',2,'Final ',0,12),runId}],'sdk-final'));
 messages=projection.project(messages);
 assert.equal(messages.filter((m:any)=>m.text===answer).length,2);
 assert.equal(messages.filter((m:any)=>m.id==='sdk-final-0').length,1);
 assert.equal(messages.some((m:any)=>m.id===`${fallback}-0`),false);
 projection.merge(old);messages=projection.project(messages);
 assert.equal(messages.length,2);assert.equal(messages.some((m:any)=>m.id===`${fallback}-0`),false);
});

test('two incomplete result representations keep the previously displayed ranges',()=>{
 const projection=new HistoryProjection(),runId='run-1';
 const target=(segments:any[])=>({...page(segments),runs:[{runId,resultRef:{workId:'work-1',sessionId:'session-1',runId,content:'result',entryId:'sdk'}}]});
 projection.merge(target([{...text('sdk',1,'tail',8,12),runId}]));let messages=projection.project([]);
 projection.merge(target([{...text(`${runId}-final`,1,'head',0,12),runId,type:'run-result'}]));
 messages=projection.project(messages);assert.equal(messages.length,1);assert.equal(messages[0].text,'tail');assert.equal(messages[0].historyIncomplete,true);
});

test('old Agent capability notice survives a failed legacy read without clearing known messages',async t=>{
 let fail=false,reads=0;
 t.mock.method(globalThis,'fetch',async(input:any,init:any)=>{
  assert.equal(init.method,'GET');const path=new URL(String(input),'http://desktop.test').pathname;
  if(path.endsWith('/history-capabilities'))return Response.json({code:'HISTORY_UNSUPPORTED'},{status:501});
  if(path.endsWith('/chat-image-capabilities'))return Response.json({code:'UNSUPPORTED'},{status:501});
  assert.ok(path.endsWith('/sessions/session-1'));reads++;
  return fail?Response.json({code:'RESPONSE_TOO_LARGE',message:'Legacy response is too large'},{status:502}):Response.json({session:metadata,messages:[{entryId:'known',role:'assistant',runId:'',blocks:[{blockId:'known-0',type:'text',text:'Known answer'}]}],runs:[]});
 });
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[]}],services:[]}];
 t.after(()=>adapter.clearIdentity());await adapter.loadSession('work-1','session-1');
 const session=adapter.getWork('work-1').sessions[0];assert.equal(session.messages[0].text,'Known answer');
 assert.match(adapter.historyNotice('work-1'),/size limits/);assert.match(adapter.historyNotice('work-1'),/explicitly Apply/);
 fail=true;await assert.rejects(adapter.loadSession('work-1','session-1'),{code:'RESPONSE_TOO_LARGE'});
 assert.equal(session.messages[0].text,'Known answer');assert.equal(reads,2);
 adapter.clearIdentity();assert.equal(adapter.historyNotice('work-1'),'');
});

test('old Agent capacity failures stop automatic whole-session recovery without cancelling the Run',async t=>{
 for(const [code,status]of [['RESPONSE_TOO_LARGE',502],['RATE_LIMITED',429],['HISTORY_UNSUPPORTED',501]] as const)await t.test(code,async t=>{
  const adapter=new DesktopAdapter();adapter.state.signedIn=true;adapter.historySupport.set('work-1',false);
  const run:any={id:'run-1',sessionId:'session-1',status:'running',cursor:7,created:''};
  adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[{role:'assistant',text:'Known content'}]}],services:[],run}];
  const requests:string[]=[];
  t.mock.method(globalThis,'fetch',async(input:any,init:any)=>{
   assert.equal(init?.method??'GET','GET');const path=new URL(String(input),'http://desktop.test').pathname;requests.push(path);
   if(path.endsWith('/events'))return Response.json({code:'CURSOR_EXPIRED'},{status:410});
   if(path.endsWith('/runs/run-1'))return Response.json({runId:'run-1',workId:'work-1',sessionId:'session-1',state:2});
   assert.ok(path.endsWith('/sessions/session-1'));return Response.json({code,message:'Legacy history cannot be read'},{status});
  });
  t.after(()=>adapter.clearIdentity());await adapter.resumeRun('work-1');
  assert.equal(run.status,'running');assert.equal(adapter.getWork('work-1').sessions[0].messages[0].text,'Known content');
  assert.equal(adapter.reconnects.size,0);assert.equal(adapter.historyObservers.size,0);assert.equal(requests.length,3);
  assert.match(String(run.error),/explicitly Apply/);
 });
});

test('old Agent event precheck limits stop reconnecting before any 410 recovery',async t=>{
 for(const [code,status]of [['RESPONSE_TOO_LARGE',503],['RESPONSE_TOO_LARGE',502],['RATE_LIMITED',429],['HISTORY_UNSUPPORTED',501]] as const)await t.test(`${code}/${status}`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const adapter=new DesktopAdapter();adapter.state.signedIn=true;adapter.historySupport.set('work-1',false);
  const run:any={id:'run-1',sessionId:'session-1',status:'running',cursor:7,created:''};
  adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[{role:'assistant',text:'Known content'}]}],services:[],run}];
  const requests:string[]=[];
  t.mock.method(globalThis,'fetch',async(input:any,init:any)=>{
   assert.equal(init?.method??'GET','GET');requests.push(String(input));
   return Response.json({code,message:'Legacy history limit'},{status});
  });
  t.after(()=>adapter.clearIdentity());await adapter.resumeRun('work-1');
  assert.equal(adapter.reconnects.size,0);assert.equal(adapter.historyObservers.size,0);
  t.mock.timers.tick(60000);await new Promise<void>(resolve=>setImmediate(resolve));
  assert.deepEqual(requests,['/_desktop/api/works/work-1/runs/run-1/events?after=7']);
  assert.equal(run.status,'running');assert.equal(run.cursor,7);
  assert.equal(adapter.getWork('work-1').sessions[0].messages[0].text,'Known content');
  assert.match(String(run.error),/Legacy history limit/);assert.match(String(run.error),/explicitly Apply/);
 });
});

test('transient legacy event failures still reconnect to the same Run with backoff',async t=>{
 for(const network of [false,true])await t.test(network?'network':'service unavailable',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const adapter=new DesktopAdapter();adapter.state.signedIn=true;adapter.historySupport.set('work-1',false);
  const run:any={id:'run-1',sessionId:'session-1',status:'running',cursor:7,created:''};
  adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[]}],services:[],run}];
  const requests:string[]=[];
  t.mock.method(globalThis,'fetch',async(input:any)=>{
   requests.push(String(input));if(network)throw new TypeError('Network unavailable');
   return Response.json({code:'CORE_UNAVAILABLE',message:'Try again later'},{status:503});
  });
  t.after(()=>adapter.clearIdentity());await adapter.resumeRun('work-1');
  assert.equal(adapter.reconnects.size,1);assert.equal(requests.length,1);
  t.mock.timers.tick(1499);await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(requests.length,1);
  t.mock.timers.tick(1);await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(requests.length,2);assert.equal(new Set(requests).size,1);assert.equal(run.status,'running');
  assert.equal(adapter.reconnects.size,1);
 });
});

test('result text subsets preserve mixed message completeness in either arrival order',()=>{
 const runId='run-1',entryId='mixed-final';
 const first={...text(entryId,0,'Before'),runId,blockCount:3};
 const tool={...text(entryId,0,''),runId,blockId:`${entryId}-1`,blockIndex:1,blockCount:3,type:'tool-call',toolCallId:'call-1',toolName:'read'};
 const last={...text(entryId,0,'After'),runId,blockId:`${entryId}-2`,blockIndex:2,blockCount:3};
 const result={...page([first,last]),runs:[{runId,resultRef:{workId:'work-1',sessionId:'session-1',runId,content:'result',entryId}}]};
 const full=page([first,tool,last]);
 for(const resultFirst of [false,true]){
  const projection=new HistoryProjection();projection.merge(resultFirst?result:full);let messages=projection.project([]);
  assert.equal(messages.every((message:any)=>!message.historyIncomplete),!resultFirst);
  projection.merge(resultFirst?full:result);messages=projection.project(messages);
  projection.merge(result);projection.merge(full);messages=projection.project(messages);
  assert.deepEqual(messages.filter((message:any)=>!message.tool).map((message:any)=>message.text),['Before','After']);
  assert.equal(messages.filter((message:any)=>message.tool).length,1);
  assert.ok(messages.every((message:any)=>!message.historyIncomplete));
 }
});

test('independent empty results never alter tool-only or nonpublic SDK entry completeness',()=>{
 const runId='run-1',entryId='sdk-final',resultId=`${runId}-final`;
 const tool={...text(entryId,0,''),runId,type:'tool-call',toolCallId:'call-1',toolName:'read'};
 const nonpublic={...text(entryId,0,''),runId,type:'empty',blockId:`${entryId}-empty`};
 const result={...text(resultId,1,''),runId,type:'run-result'};
 const ref={workId:'work-1',sessionId:'session-1',runId,content:'result',entryId:resultId};
 const resultPage={...page([result]),runs:[{runId,resultRef:ref}]};
 for(const source of [tool,nonpublic])for(const resultFirst of [false,true]){
  const projection=new HistoryProjection();const full={...page([source,result]),runs:[{runId,resultRef:ref}]};
  projection.merge(resultFirst?resultPage:full);let messages=projection.project([]);
  projection.merge(resultFirst?full:resultPage);messages=projection.project(messages);
  projection.merge(resultPage);messages=projection.project(messages);
  projection.merge(full);messages=projection.project(messages);
  assert.ok(messages.every((message:any)=>!message.historyIncomplete));
  assert.equal(messages.filter((message:any)=>message.tool).length,source===tool?1:0);
  assert.equal(messages.some((message:any)=>!!message.text),false);
 }
});

test('empty Run readback and result helper complete without replacing its saved tool',async t=>{
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;adapter.historySupport.set('work-1',true);
 const runId='run-1',entryId='sdk-final',resultId=`${runId}-final`;
 const ref={workId:'work-1',sessionId:'session-1',runId,content:'result',entryId:resultId};
 const run:any={id:runId,sessionId:'session-1',status:'cancelled',cursor:7,created:'',resultRef:ref};
 adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[]}],services:[],run}];
 const tool={...text(entryId,0,''),runId,type:'tool-call',toolCallId:'call-1',toolName:'read'};
 const result={...text(resultId,1,''),runId,type:'run-result'};
 const requests:string[]=[];
 t.mock.method(globalThis,'fetch',async(input:any,init:any)=>{
  assert.equal(init?.method??'GET','GET');const url=new URL(String(input),'http://desktop.test');requests.push(url.pathname+url.search);
  assert.ok(url.pathname.endsWith('/history'));if(url.searchParams.has('runId'))assert.equal(url.searchParams.get('runId'),runId);
  return Response.json({...page(url.searchParams.get('content')==='result'?[result]:[tool,result]),runs:[{runId,resultRef:ref}]});
 });
 t.after(()=>adapter.clearIdentity());await adapter.loadSavedRun('work-1',run);
 assert.equal(await adapter.readRunResult('work-1',run),'');
 const messages=adapter.getWork('work-1').sessions[0].messages;
 assert.ok(messages.every((message:any)=>!message.historyIncomplete));assert.equal(messages.filter((message:any)=>message.tool).length,1);
 assert.equal(run.status,'cancelled');assert.equal(requests.length,4);
});

for(const status of ['cancelled','failed','interrupted'])test(`long Run recovery reads every frozen page after running becomes ${status}`,async t=>{
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;
 const run:any={id:'run-1',sessionId:'session-1',status:'running',cursor:1};
 adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',services:[],sessions:[{id:'session-1',title:'One',messages:[]}],run}];
 t.after(()=>adapter.clearIdentity());
 const runId=run.id,user={...text(`${runId}-user`,0,'Hi'),role:'user',runId};
 const body='A'.repeat(600000),tailStart=body.length-15*32768;
 const chunk=(offset:number,size:number)=>({...text(`${runId}-text-2`,1,body.slice(offset,offset+size),offset,body.length),runId,blockId:`${runId}-text-2`});
 const tail=Array.from({length:15},(_,i)=>chunk(tailStart+i*32768,32768));
 const prefix=[];for(let at=0;at<tailStart;at+=32768)prefix.push(chunk(at,Math.min(32768,tailStart-at)));
 const ref={workId:'work-1',sessionId:'session-1',runId,content:'result',snapshot:'terminal',entryId:`${runId}-final`};
 let terminal=false;const requests:URL[]=[];
 t.mock.method(globalThis,'fetch',async(input:any,init:any)=>{
  assert.equal(init?.method??'GET','GET');const url=new URL(String(input),'http://desktop.test');requests.push(url);
  assert.ok(url.pathname.endsWith('/history'));
  const snapshot=terminal?'terminal':'running';
  if(url.searchParams.has('runId')){assert.equal(url.searchParams.get('runId'),runId);assert.equal(url.searchParams.get('snapshot'),snapshot);}
  const response=(segments:any[],nextCursor:string|null=null)=>Response.json({...page(segments,nextCursor),snapshotId:snapshot,runs:terminal&&run.resultRef?[{runId,resultRef:ref}]:[]});
  if(!terminal)return response([user]);
  if(url.searchParams.get('content')==='result')return response([{...text(`${runId}-final`,2,''),runId,type:'run-result'}]);
  if(!url.searchParams.has('runId')){assert.equal(url.searchParams.has('cursor'),false);return response(tail,'unread-session-earlier');}
  if(url.searchParams.has('cursor')){assert.equal(url.searchParams.get('cursor'),'run-earlier');return response([user,...prefix]);}
  return response(tail,'run-earlier');
 });
 await adapter.loadSavedRun('work-1',run);
 terminal=true;run.status=status;run.resultRef=status==='interrupted'?null:ref;
 await adapter.loadSavedRun('work-1',run);
 const session=adapter.getWork('work-1').sessions[0];
 assert.equal(requests.filter(url=>url.searchParams.get('cursor')==='run-earlier').length,1,'Read the available earlier Run page even when the latest page is cached');
 assert.deepEqual(session.messages.filter((m:any)=>m.role==='user').map((m:any)=>m.text),['Hi']);
 assert.equal(session.messages.filter((m:any)=>m.role==='assistant'&&m.text).length,1);
 assert.equal(session.messages.find((m:any)=>m.role==='assistant'&&m.text)?.text,body);
 assert.ok(session.messages.every((m:any)=>!m.historyIncomplete&&!m.historyOrderUnconfirmed&&!m.historyRecoveryUnconfirmed));
 const identities=session.messages.map((m:any)=>[m.id,m.runId]);
 await adapter.loadSavedRun('work-1',run);
 assert.deepEqual(session.messages.map((m:any)=>[m.id,m.runId]),identities,'Repeated readback must not duplicate the reply');
 assert.equal(requests.filter(url=>url.searchParams.get('cursor')==='run-earlier').length,2);
 assert.equal(run.status,status);
});
