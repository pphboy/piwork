import test from 'node:test';
import assert from 'node:assert/strict';
const { HistoryProjection }=await import(new URL('../browser/history-projection.js',import.meta.url).href);
const { DesktopAdapter }=await import(new URL('../browser/adapter.js',import.meta.url).href);
const metadata={sessionId:'session-1',workId:'work-1',modelPreference:null,thinkingLevel:'off',source:{kind:'chat'}};
const text=(id:string,order:number,value:string,offset=0,total?:number)=>({entryId:id,entryOrder:order,role:'assistant',runId:'',blockId:`${id}-0`,blockIndex:0,blockCount:1,type:'text',byteOffset:offset,totalBytes:total??new TextEncoder().encode(value).length,text:value,complete:offset+new TextEncoder().encode(value).length===(total??new TextEncoder().encode(value).length)});
const page=(segments:any[],nextCursor:string|null=null)=>({contractVersion:1,session:metadata,snapshotId:'snapshot',segments,runs:[],nextCursor,hasMore:!!nextCursor});

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

test('modern 410 recovery reads original Run ranges and stops with one final answer',async t=>{
 const requests:string[]=[];
 const ref={workId:'work-1',sessionId:'session-1',runId:'run-1',content:'result'};
 const raw={workId:'work-1',sessionId:'session-1',runId:'run-1',state:4,resultRef:ref};
 t.mock.method(globalThis,'fetch',async(input:any)=>{
  const url=new URL(String(input),'http://desktop.test');requests.push(url.pathname+url.search);
  if(url.pathname.endsWith('/history-capabilities'))return Response.json({contractVersion:1,profile:'session-history-v1',pageBytes:524288});
  if(url.pathname.endsWith('/events')){assert.equal(url.searchParams.get('responseProfile'),'history-v1');return Response.json({code:'CURSOR_EXPIRED'},{status:410});}
  if(url.pathname.endsWith('/runs/run-1')){assert.equal(url.searchParams.get('responseProfile'),'history-v1');return Response.json(raw);}
  if(url.pathname.endsWith('/history')){assert.equal(url.searchParams.get('runId'),'run-1');return Response.json(page([{...text('saved',0,'Saved final answer'),runId:'run-1'}]));}
  throw new Error(`Unexpected ${url}`);
 });
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;
 const run={id:'run-1',sessionId:'session-1',status:'running',cursor:1,created:''};
 adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[{runId:'run-1',role:'assistant',text:'live partial'}]}],services:[],run}];
 t.after(()=>adapter.clearIdentity());await adapter.resumeRun('work-1');
 const session=adapter.getWork('work-1').sessions[0];assert.deepEqual(session.messages.map((m:any)=>m.text),['Saved final answer']);assert.equal(run.status,'succeeded');
 assert.equal(adapter.historyObservers.size,0);assert.equal(adapter.reconnects.size,0);assert.ok(requests.every(path=>!path.endsWith('/sessions/session-1')));
 assert.ok(requests[0]!.endsWith('/history-capabilities'));
});

test('accepted user identity survives durable text blocks without duplicating a live prompt',()=>{
 const projection=new HistoryProjection();projection.merge(page([{...text('run-1-user',0,'First'),role:'user',runId:'run-1',blockId:'run-1-user-0',blockCount:2},{...text('run-1-user',0,' second'),role:'user',runId:'run-1',blockId:'run-1-user-1',blockIndex:1,blockCount:2}]));
 const saved=projection.project([{id:'run-1-user',runId:'run-1',role:'user',text:'First second'}]);
 assert.equal(saved.length,1);assert.equal(saved[0].id,'run-1-user');assert.equal(saved[0].text,'First second');assert.equal(saved[0].historyIncomplete,false);
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
 assert.match(adapter.chatSubmissions.get('work-1').error,/not found/);
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
  assert.match(run.error,/explicitly Apply/);
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
  assert.match(run.error,/Legacy history limit/);assert.match(run.error,/explicitly Apply/);
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
  assert.ok(url.pathname.endsWith('/history'));assert.equal(url.searchParams.get('runId'),runId);
  return Response.json({...page(url.searchParams.get('content')==='result'?[result]:[tool,result]),runs:[{runId,resultRef:ref}]});
 });
 t.after(()=>adapter.clearIdentity());await adapter.loadSavedRun('work-1',run);
 assert.equal(await adapter.readRunResult('work-1',run),'');
 const messages=adapter.getWork('work-1').sessions[0].messages;
 assert.ok(messages.every((message:any)=>!message.historyIncomplete));assert.equal(messages.filter((message:any)=>message.tool).length,1);
 assert.equal(run.status,'cancelled');assert.equal(requests.length,3);
});
