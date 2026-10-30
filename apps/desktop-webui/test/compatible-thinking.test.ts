import assert from 'node:assert/strict';
import test from 'node:test';
const {DesktopAdapter}=await import(new URL('../browser/adapter.js',import.meta.url).href);

test('compatible thinking keeps profile and level together through save and readback',async t=>{
 const bodies:Array<Record<string,unknown>>=[];
 const model={modelRef:null,label:'Alias',provider:'anthropic',model:'unknown',thinkingAvailability:'unknown',thinkingLevels:[],defaultThinkingLevel:null,compatibleThinkingProfiles:[{profile:'messages-adaptive-v1',levels:['high']},{profile:'messages-budget-v1',levels:['high'],budgets:{high:6144}}]};
 t.mock.method(globalThis,'fetch',async (_input:unknown,init?:RequestInit)=>{
  const input=JSON.parse(String(init?.body));bodies.push(input);
  return Response.json({sessionId:'session-1',modelRef:null,model,thinkingLevel:input.thinkingLevel,...(input.thinkingProfile?{thinkingProfile:input.thinkingProfile}:{}),availability:'available',checkedAt:new Date().toISOString()});
 });
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[],thinkingLevel:null}],services:[]}];
 adapter.models.set('work-1',{loading:false,confirmed:true,error:'',models:[],defaultModel:model});adapter.chatCapabilities.set('work-1',4);
 t.after(()=>adapter.clearIdentity());
 for(const profile of ['messages-adaptive-v1','messages-budget-v1']) {
  adapter.selectThinking('work-1','session-1','high',profile);await adapter.saveModel('work-1','session-1');
  assert.equal(adapter.modelSelection('work-1','session-1').profile,profile);assert.equal(adapter.modelReady('work-1','session-1'),true);
 }
 adapter.selectThinking('work-1','session-1',null);await adapter.saveModel('work-1','session-1');
 assert.deepEqual(bodies.map(b=>b.thinkingProfile),['messages-adaptive-v1','messages-budget-v1',null]);
 assert.equal(adapter.modelSelection('work-1','session-1').profile,undefined);
});

test('lost compatible save is reconciled by readback and an older Agent rejects new choices',async t=>{
 const model={modelRef:null,label:'Alias',provider:'openai',model:'future',thinkingAvailability:'unknown',thinkingLevels:[],defaultThinkingLevel:null,compatibleThinkingProfiles:[{profile:'responses-effort-v1',levels:['high']}]};
 let calls=0;
 t.mock.method(globalThis,'fetch',async (_input:unknown,init?:RequestInit)=>{
  calls++;
  if(init?.method==='PATCH')throw new Error('connection lost');
  return Response.json({sessionId:'session-1',modelRef:null,model,thinkingLevel:'high',thinkingProfile:'responses-effort-v1',availability:'available'});
 });
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[],thinkingLevel:null}],services:[]}];
 adapter.models.set('work-1',{loading:false,confirmed:true,error:'',models:[],defaultModel:model});adapter.chatCapabilities.set('work-1',4);
 t.after(()=>adapter.clearIdentity());
 adapter.selectThinking('work-1','session-1','high','responses-effort-v1');
 await assert.rejects(adapter.saveModel('work-1','session-1'));
 assert.equal(adapter.modelSelection('work-1','session-1').phase,'unknown');assert.equal(adapter.modelReady('work-1','session-1'),false);
 await adapter.checkSessionModel('work-1','session-1');
 assert.equal(adapter.modelSelection('work-1','session-1').profile,'responses-effort-v1');assert.equal(adapter.modelReady('work-1','session-1'),true);
 adapter.chatCapabilities.set('work-1',3);
 assert.throws(()=>adapter.selectThinking('work-1','session-1','high','responses-effort-v1'));
 assert.equal(calls,2);
});

test('rapid changes serialize whole profile and level pairs; a new Session keeps only a draft',async t=>{
 const model={modelRef:null,label:'Alias',provider:'anthropic',model:'future',thinkingAvailability:'unknown',thinkingLevels:[],defaultThinkingLevel:null,compatibleThinkingProfiles:[{profile:'messages-adaptive-v1',levels:['high']},{profile:'messages-budget-v1',levels:['high']}]};
 const bodies:Array<Record<string,unknown>>=[];let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 t.mock.method(globalThis,'fetch',async (_input:unknown,init?:RequestInit)=>{
  const input=JSON.parse(String(init?.body));bodies.push(input);if(bodies.length===1)await gate;
  return Response.json({sessionId:'session-1',modelRef:null,model,thinkingLevel:input.thinkingLevel,thinkingProfile:input.thinkingProfile,availability:'available'});
 });
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[],thinkingLevel:null}],services:[]}];
 adapter.models.set('work-1',{loading:false,confirmed:true,error:'',models:[],defaultModel:model});adapter.chatCapabilities.set('work-1',4);
 t.after(()=>adapter.clearIdentity());
 adapter.selectThinking('work-1','','high','messages-adaptive-v1');assert.equal(bodies.length,0);assert.equal(adapter.modelReady('work-1',''),true);
 adapter.selectThinking('work-1','session-1','high','messages-adaptive-v1');
 adapter.selectThinking('work-1','session-1','high','messages-budget-v1');
 assert.equal(bodies.length,1);release();await adapter.saveModel('work-1','session-1');await adapter.saveModel('work-1','session-1');
 assert.deepEqual(bodies.map(b=>[b.thinkingProfile,b.thinkingLevel]),[['messages-adaptive-v1','high'],['messages-budget-v1','high']]);
 assert.equal(adapter.modelSelection('work-1','session-1').profile,'messages-budget-v1');
});

test('a compatible draft is applied to a newly created Session before sending',async t=>{
 const model={modelRef:'model-future-000001',label:'Alias',provider:'openai',model:'future',thinkingAvailability:'unknown',thinkingLevels:[],defaultThinkingLevel:null,compatibleThinkingProfiles:[{profile:'responses-effort-v1',levels:['high']}]};
 const bodies:Array<Record<string,unknown>>=[];
 t.mock.method(globalThis,'fetch',async (input:unknown,init?:RequestInit)=>{
  const url=String(input);
  if(url.endsWith('/sessions'))return Response.json({sessionId:'session-new',thinkingLevel:null,modelPreference:null});
  const body=JSON.parse(String(init?.body));bodies.push(body);
  return Response.json({sessionId:'session-new',modelRef:body.modelRef,model,thinkingLevel:body.thinkingLevel,thinkingProfile:body.thinkingProfile,availability:'available'});
 });
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[],services:[]}];
 adapter.models.set('work-1',{loading:false,confirmed:true,error:'',models:[model],defaultModel:{...model,modelRef:null}});adapter.chatCapabilities.set('work-1',4);
 t.after(()=>adapter.clearIdentity());
 adapter.selectModel('work-1','',model.modelRef);adapter.selectThinking('work-1','','high','responses-effort-v1');
 const session=await adapter.newSession('work-1');await adapter.saveModel('work-1',session);
 assert.deepEqual(bodies.map(b=>[b.modelRef,b.thinkingLevel,b.thinkingProfile]),[[model.modelRef,'high','responses-effort-v1']]);
 assert.equal(adapter.modelReady('work-1',session),true);
});

test('reselecting the current model preserves a saved profile even after SDK recognition',async t=>{
 const model={modelRef:null,label:'Known',provider:'openai',model:'future',thinkingLevels:['off','low'],defaultThinkingLevel:'off'};
 let writes=0;
 t.mock.method(globalThis,'fetch',async()=>{writes++;throw new Error('no write expected');});
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[],modelPreference:{...model,availability:'available'},thinkingLevel:'high',thinkingProfile:'responses-effort-v1'}],services:[]}];
 adapter.models.set('work-1',{loading:false,confirmed:true,error:'',models:[],defaultModel:model});adapter.chatCapabilities.set('work-1',4);
 t.after(()=>adapter.clearIdentity());
 const before={...adapter.modelSelection('work-1','session-1')};
 adapter.selectModel('work-1','session-1',null);
 assert.deepEqual(adapter.modelSelection('work-1','session-1'),before);
 assert.equal(adapter.modelReady('work-1','session-1'),true);assert.equal(writes,0);
});

test('model changes during a compatible save wait for an explicit Thinking choice',async t=>{
 const first={modelRef:null,label:'First',provider:'openai',model:'unknown-first',thinkingAvailability:'unknown',thinkingLevels:[],defaultThinkingLevel:null,compatibleThinkingProfiles:[{profile:'responses-effort-v1',levels:['high']}]};
 const second={...first,modelRef:'model-second-00001',label:'Second',model:'unknown-second'};
 const bodies:Array<Record<string,unknown>>=[];let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 t.mock.method(globalThis,'fetch',async (_input:unknown,init?:RequestInit)=>{
  const input=JSON.parse(String(init?.body));bodies.push(input);if(bodies.length===1)await gate;
  return Response.json({sessionId:'session-1',modelRef:input.modelRef,model:input.modelRef===null?first:second,thinkingLevel:input.thinkingLevel,thinkingProfile:input.thinkingProfile,availability:'available'});
 });
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[],thinkingLevel:null}],services:[]}];
 adapter.models.set('work-1',{loading:false,confirmed:true,error:'',models:[second],defaultModel:first});adapter.chatCapabilities.set('work-1',4);adapter.activateChat('work-1','session-1');
 t.after(()=>{release();adapter.clearIdentity();});
 adapter.selectThinking('work-1','session-1','high','responses-effort-v1');
 const saving=adapter.saveModel('work-1','session-1');
 adapter.selectModel('work-1','session-1',second.modelRef);
 release();await saving;await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(bodies.length,1,'the first response must not save the old profile to a different model');
 assert.equal(adapter.modelReady('work-1','session-1'),false);
 await assert.rejects(adapter.saveModel('work-1','session-1'));
 adapter.selectThinking('work-1','session-1','high','responses-effort-v1');await adapter.saveModel('work-1','session-1');
 assert.deepEqual(bodies.map(b=>[b.modelRef,b.thinkingLevel,b.thinkingProfile]),[[null,'high','responses-effort-v1'],[second.modelRef,'high','responses-effort-v1']]);
 assert.equal(adapter.modelReady('work-1','session-1'),true);
});

test('a new-session draft cannot carry a compatible profile to another model without confirmation',async t=>{
 const first={modelRef:null,label:'First',provider:'openai',model:'unknown-first',thinkingAvailability:'unknown',thinkingLevels:[],defaultThinkingLevel:null,compatibleThinkingProfiles:[{profile:'responses-effort-v1',levels:['high']}]};
 const second={...first,modelRef:'model-second-00001',label:'Second',model:'unknown-second'};
 let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;throw new Error('no request expected');});
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[],services:[]}];
 adapter.models.set('work-1',{loading:false,confirmed:true,error:'',models:[second],defaultModel:first});adapter.chatCapabilities.set('work-1',4);
 t.after(()=>adapter.clearIdentity());
 adapter.selectThinking('work-1','','high','responses-effort-v1');adapter.selectModel('work-1','',second.modelRef);
 assert.equal(adapter.modelReady('work-1',''),false);await assert.rejects(adapter.newSession('work-1'));assert.equal(requests,0);
 adapter.selectThinking('work-1','','high','responses-effort-v1');assert.equal(adapter.modelReady('work-1',''),true);
});

test('returning to the confirmed model restores its compatible setting without a write',async t=>{
 const first={modelRef:null,label:'First',provider:'openai',model:'unknown-first',thinkingAvailability:'unknown',thinkingLevels:[],defaultThinkingLevel:null,compatibleThinkingProfiles:[{profile:'responses-effort-v1',levels:['high']}]};
 const second={...first,modelRef:'model-second-00001',label:'Second',model:'unknown-second'};
 let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;throw new Error('no request expected');});
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[],modelPreference:{...first,availability:'available'},thinkingLevel:'high',thinkingProfile:'responses-effort-v1'}],services:[]}];
 adapter.models.set('work-1',{loading:false,confirmed:true,error:'',models:[second],defaultModel:first});adapter.chatCapabilities.set('work-1',4);
 t.after(()=>adapter.clearIdentity());
 adapter.selectModel('work-1','session-1',second.modelRef);assert.equal(adapter.modelReady('work-1','session-1'),false);
 adapter.selectModel('work-1','session-1',null);
 assert.equal(adapter.modelSelection('work-1','session-1').profile,'responses-effort-v1');
 assert.equal(adapter.modelSelection('work-1','session-1').phase,'clean');assert.equal(adapter.modelReady('work-1','session-1'),true);assert.equal(requests,0);
});

test('cross-protocol model changes cannot reuse the previous compatibility profile',async t=>{
 const first={modelRef:null,label:'First',provider:'openai',model:'unknown-first',thinkingAvailability:'unknown',thinkingLevels:[],defaultThinkingLevel:null,compatibleThinkingProfiles:[{profile:'responses-effort-v1',levels:['high']}]};
 const second={modelRef:'model-second-00001',label:'Second',provider:'anthropic',model:'unknown-second',thinkingAvailability:'unknown',thinkingLevels:[],defaultThinkingLevel:null,compatibleThinkingProfiles:[{profile:'messages-adaptive-v1',levels:['high']}]};
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[],services:[]}];
 adapter.models.set('work-1',{loading:false,confirmed:true,error:'',models:[second],defaultModel:first});adapter.chatCapabilities.set('work-1',4);
 t.after(()=>adapter.clearIdentity());
 adapter.selectThinking('work-1','','high','responses-effort-v1');adapter.selectModel('work-1','',second.modelRef);
 assert.throws(()=>adapter.selectThinking('work-1','','high','responses-effort-v1'));
 assert.equal(adapter.modelReady('work-1',''),false);
 adapter.selectThinking('work-1','','high','messages-adaptive-v1');assert.equal(adapter.modelReady('work-1',''),true);
});

test('a draft stops being ready if a known model no longer offers its selected level',async t=>{
 const model={modelRef:null,label:'Known',provider:'openai',model:'known',thinkingLevels:['off','high'],defaultThinkingLevel:'off'};
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[],services:[]}];
 adapter.models.set('work-1',{loading:false,confirmed:true,error:'',models:[],defaultModel:model});adapter.chatCapabilities.set('work-1',4);
 t.after(()=>adapter.clearIdentity());
 adapter.selectThinking('work-1','','high');assert.equal(adapter.modelReady('work-1',''),true);
 model.thinkingLevels=['off'];assert.equal(adapter.modelReady('work-1',''),false);await assert.rejects(adapter.newSession('work-1'));
 adapter.selectThinking('work-1','','off');assert.equal(adapter.modelReady('work-1',''),true);
});

test('default Session uses live eligibility, skips Service Sessions and preserves failures as unconfirmed',async t=>{
 const requests:string[]=[];let failing=false;
 t.mock.method(globalThis,'fetch',async (input:unknown)=>{
  const url=String(input);requests.push(url);if(failing)throw Error('offline');
  const sessionId=url.includes('session-2')?'session-2':'session-1';
  return Response.json({sessionId,modelRef:null,model:{modelRef:null,provider:'fixture',model:'one',label:'One'},thinkingLevel:'off',availability:sessionId==='session-2'?'available':'unavailable'});
 });
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:['session-1','session-2','service-3'].map(id=>({id,title:id,messages:[],source:{kind:id==='service-3'?'service':'chat'}})),services:[]}];
 adapter.chatCapabilities.set('work-1',4);t.after(()=>adapter.clearIdentity());
 assert.equal(await adapter.defaultSession('work-1'),'session-2');assert.equal(requests.length,2);
 failing=true;assert.equal(await adapter.defaultSession('work-1'),'session-1');
 assert.ok(adapter.getWork('work-1')!.sessions.filter((s:{source?:{kind:string}})=>s.source?.kind==='chat').every((s:{chatAvailability?:string})=>s.chatAvailability==='unconfirmed'));
 assert.equal(requests.some(url=>url.includes('service-3')),false);
 adapter.chatCapabilities.set('work-1',0);const count=requests.length;
 assert.equal(await adapter.defaultSession('work-1'),'session-1');assert.equal(requests.length,count);
 adapter.state.works[0].sessions=adapter.state.works[0].sessions.filter((s:{source?:{kind:string}})=>s.source?.kind==='service');
 assert.equal(await adapter.defaultSession('work-1'),'');
});

test('failed message retry requires the original compatible profile even at the same level',async t=>{
 const bodies:Array<Record<string,unknown>>=[];
 const model={modelRef:null,label:'Alias',provider:'anthropic',model:'unknown',thinkingAvailability:'unknown',thinkingLevels:[],defaultThinkingLevel:null,compatibleThinkingProfiles:[{profile:'messages-adaptive-v1',levels:['high']},{profile:'messages-budget-v1',levels:['high']}]};
 t.mock.method(globalThis,'fetch',async (_input:unknown,init?:RequestInit)=>{bodies.push(JSON.parse(String(init?.body)));return Response.json({code:'INVALID_REQUEST',message:'Rejected'}, {status:400});});
 const adapter=new DesktopAdapter();adapter.state.signedIn=true;adapter.state.works=[{id:'work-1',status:'Ready',desired:'running',sessions:[{id:'session-1',title:'One',messages:[],modelPreference:{...model,availability:'available'},thinkingLevel:'high',thinkingProfile:'messages-adaptive-v1'}],services:[]}];
 adapter.models.set('work-1',{loading:false,confirmed:true,error:'',models:[],defaultModel:model});adapter.chatCapabilities.set('work-1',4);
 t.after(()=>adapter.clearIdentity());
 await assert.rejects(adapter.send('work-1','session-1','Original message',false,'text'),{code:'INVALID_REQUEST'});
 const key=String(bodies[0]!.submissionKey),pair=adapter.modelSelection('work-1','session-1');
 pair.profile='messages-budget-v1';assert.equal(adapter.modelReady('work-1','session-1'),true);
 await assert.rejects(adapter.retryChatSubmission('work-1','session-1',key),{code:'MODEL_NOT_CONFIRMED'});assert.equal(bodies.length,1);
 pair.profile='messages-adaptive-v1';
 await assert.rejects(adapter.retryChatSubmission('work-1','session-1',key),{code:'INVALID_REQUEST'});assert.equal(bodies.length,2);assert.equal(bodies[1]!.prompt,bodies[0]!.prompt);
});
