import assert from 'node:assert/strict';
import test from 'node:test';
const {coreAdmission}=await import(new URL('../browser/core-admission.js',import.meta.url).href);
const recovering={health:{available:true},readiness:{available:true,value:{state:'RECOVERING',ready:false}}};
const ready={health:{available:true},readiness:{available:true,value:{state:'READY',ready:true}}};
test('Core admission distinguishes startup, failed reads and optional helper availability',()=>{
 assert.deepEqual(coreAdmission({},false,false,true,'',false),{phase:'checking',blocked:true});
 assert.deepEqual(coreAdmission(recovering,false,true,false,'',false),{phase:'recovering',blocked:true});
 assert.deepEqual(coreAdmission({...ready,files:{available:false}},true,false,false,'',false),{phase:'ready',blocked:false});
 assert.deepEqual(coreAdmission(ready,true,false,false,'timeout',false),{phase:'unconfirmed',blocked:false});
 assert.deepEqual(coreAdmission(recovering,true,true,false,'timeout',false),{phase:'unconfirmed',blocked:true});
 assert.deepEqual(coreAdmission(recovering,true,true,false,'paused',true),{phase:'paused',blocked:true});
 for(const [state,phase] of [['ADMIN_REQUIRED','unconfigured'],['RUNTIME_NOT_CONFIGURED','unconfigured'],['RUNTIME_UNAVAILABLE','failed']]){
  assert.equal(coreAdmission({health:{available:true},readiness:{available:true,value:{state,ready:false}}},false,true,false,'',false).phase,phase);
 }
 assert.equal(coreAdmission({health:{available:false}},false,false,false,'',false).phase,'unreachable');
});
const {DesktopAdapter}=await import(new URL('../browser/adapter.js',import.meta.url).href);
test('recovery gate protects direct mutations without manufacturing an unknown intent',async t=>{
 const adapter=new DesktopAdapter();t.after(()=>adapter.clearIdentity());adapter.state.signedIn=true;adapter.state.sessionState='ready';adapter.status=recovering;
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('{}')});
 const inspection={ready:true,importState:'unsubmitted'};adapter.inspectionContext=inspection;
 for(const perform of [()=>adapter.lifecycle('work-one','retry'),()=>adapter.send('work-one','session','hello',false),()=>adapter.cancelRequest('work-one','request'),()=>adapter.createWork('name',{}),()=>adapter.inspectWork(new File(['archive'],'test.work')),()=>adapter.importWork('name')])await assert.rejects(perform(),(e:any)=>e.code==='CORE_NOT_READY'&&e.httpStatus===409);
 assert.equal(calls,0);assert.equal(adapter.requestCancellation('work-one','request'),undefined);
 assert.equal(adapter.inspectionContext,inspection);assert.equal(inspection.importState,'unsubmitted');
});
test('Core recovery budget is elapsed-time bounded even when status reads are slow',t=>{
 const adapter=new DesktopAdapter();t.after(()=>adapter.clearIdentity());adapter.state.signedIn=true;adapter.state.sessionState='ready';adapter.status=recovering;
 adapter.recoveryStartedAt=Date.now()-600001;adapter.observePage('',true);
 assert.equal(adapter.coreGate.phase,'paused');assert.equal(adapter.coreGate.blocked,true);assert.equal(adapter.recoveryTimer,undefined);
});
test('terminal history hints do not fabricate an active target or grant current admission',async t=>{
 const adapter=new DesktopAdapter();t.after(()=>adapter.clearIdentity());adapter.state.signedIn=true;
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({operations:[{operationId:'old-failure',workId:'work-one',type:'retry-work',terminal:true,terminalState:'failed',recordedAt:'2026-10-28T00:00:00Z'}]})));
 await adapter.recoverOperations();const op=adapter.getOperation('old-failure');assert.equal(op.state,'unknown');assert.equal(op.terminalHint.state,'failed');
 const work={id:'work-one',status:'Ready',desired:'running',checkedAt:new Date().toISOString()};adapter.state.works=[work];adapter.worksChecked=new Date().toISOString();
 assert.equal(adapter.operationNeedsAttention(op),false);assert.deepEqual(adapter.project(work).operationIds,[]);
 work.status='Failed';assert.equal(adapter.operationNeedsAttention(op),true);
 work.status='Ready';adapter.workSync.set('work-one',{generation:1,work:true,list:true,after:1});assert.equal(adapter.operationNeedsAttention(op),true);
});

test('failed Service task classification follows the original Service and cleanup facts, never Work Ready alone',t=>{
 const adapter=new DesktopAdapter();t.after(()=>adapter.clearIdentity());
 const service:any={id:'a',enabled:true,observed:'Failed'};
 const work:any={id:'work-one',status:'Ready',desired:'running',checkedAt:new Date().toISOString(),resourceChecked:{services:new Date().toISOString()},resourceErrors:{},services:[service,{id:'b',enabled:true,observed:'Ready'}]};
 adapter.state.works=[work];adapter.worksChecked=new Date().toISOString();
 const op:any={id:'restart-a',workId:work.id,serviceId:'a',checkedWorkId:work.id,checkedServiceId:'a',checkedKind:'restart-service',kind:'restart Service',state:'failed'};
 assert.equal(adapter.operationNeedsAttention(op),true);
 service.observed='Ready';work.services[1].observed='Failed';assert.equal(adapter.operationNeedsAttention(op),false);
 op.checkedServiceId=undefined;assert.equal(adapter.operationNeedsAttention(op),true);
 op.checkedServiceId='a';work.resourceErrors.services='read unavailable';assert.equal(adapter.operationNeedsAttention(op),true);
 delete work.resourceErrors.services;
 const cached={...op,checkedKind:undefined,checkedServiceId:undefined,terminalHint:{state:'failed'}};
 assert.equal(adapter.operationNeedsAttention(cached),false);service.observed='Failed';assert.equal(adapter.operationNeedsAttention(cached),true);
 service.observed='Ready';service.temporary={mode:'once',state:'completed',cleanupState:'pending'};assert.equal(adapter.operationNeedsAttention(op),true);
 service.temporary.cleanupState='completed';assert.equal(adapter.operationNeedsAttention(op),false);
 work.services=[];
 adapter.temporaryCleanups.set('work-one:service:a',{items:[{operationId:'restart-a',state:'pending'}]});assert.equal(adapter.operationNeedsAttention(op),true);
 adapter.temporaryCleanups.get('work-one:service:a').items[0].state='completed';assert.equal(adapter.operationNeedsAttention(op),false);
 op.checkedKind='cleanup-temporary-service';adapter.temporaryCleanups.clear();assert.equal(adapter.operationNeedsAttention(op),true);
 assert.equal(op.state,'failed');
});
