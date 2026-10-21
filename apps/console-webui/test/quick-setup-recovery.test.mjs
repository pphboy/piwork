import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Execute the compiled UI functions with isolated request/timer fixtures.
// Browser geometry, native focus and history ordering remain browser coverage.
// Build @piwork/console-webui before running this file.
const source=readFileSync(process.env.PIWORK_QUICK_SETUP_PATH||new URL('../dist/browser/quick-setup.js',import.meta.url),'utf8');
const {Feedback:realFeedback}=await import(new URL('../dist/browser/components.js',import.meta.url));
function extract(names){
 return names.map(name=>{
  const start=source.match(new RegExp('^([ \\t]*)(?:async )?function '+name+'\\(','m'));
  assert.ok(start,`compiled Quick setup function ${name} exists`);
  const rest=source.slice(start.index),end=rest.slice(start[0].length).search(new RegExp('^'+start[1]+'\\}','m'));
  assert.notEqual(end,-1,`compiled Quick setup function ${name} closes`);
  return rest.slice(0,start[0].length+end+start[1].length+1);
 }).join('\n');
}
const blank=()=>({name:'',model:'',api:'openai-responses',baseUrl:'',key:''});
const publicIdentity={name:'My model',model:'my-model',api:'anthropic-messages',baseUrl:'https://models.example.invalid/anthropic'};
const saved=(id='new-model',extra={})=>({id,modelRef:id,...publicIdentity,enabled:true,credentialAvailable:true,...extra});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
function fixture(names=[]){
 const calls=[],timers=[],nodes=new Map(),noticeNode={innerHTML:'',dataset:{}};
 nodes.set('#setup-notice',noticeNode);
 const c={
  stage:'model',notice:'',noticeError:false,modelReadError:'',noticeNode:null,noticeMarkup:'',disposed:false,active:true,
  snapshot:{administrator:true,runtime:{configured:false},defaultAgentImage:'agent:original'},
  models:[],catalogError:'',selectedRef:'',mode:'add',draft:blank(),revision:1,view:1,identity:1,
  reading:false,writing:false,testing:false,polling:false,modelUnknown:false,runtimeUnknown:false,
  confirmedModel:'',pendingRuntime:null,pendingModel:null,beforeModels:new Set(),
  readGeneration:1,readLock:null,confirmedReadGeneration:-1,baselineReady:true,
  baselineRef:'',baselineDraft:blank(),advancedOpen:true,autoEnter:null,
  preparationReadError:'',preparationReadAt:'',testResult:null,timer:undefined,
  Error,Date,Set,Symbol,Array,
  options:{current:()=>c.active,expired:()=>calls.push('expired'),preparation:false},
  root:{querySelector:selector=>nodes.get(selector)||null},
  clearTimeout:()=>{},
  setTimeout:(callback,delay)=>{const timer={callback,delay};timers.push(timer);return timer;},
  blankModel:blank,firstModel:()=>({...blank(),model:'deepseek-flash'}),
  message:error=>error.message,
  Feedback:(text,tone='info',actions='')=>`<div class="feedback ${tone}">${text}${actions}</div>`,
  Field:(_id,_label,control)=>control,icon:()=>'',modelFields:()=>'<input id="model-key">',
  modelTestSummary:()=>'',updateLocks:()=>calls.push('locks'),updatePreparation:()=>calls.push('preparation'),
  render:()=>calls.push('render'),maybeAutoEnter:()=>calls.push('auto-enter-check'),
  scheduleStatus:()=>calls.push('schedule'),sessionFailure:()=>false,
  dispose:()=>{c.disposed=true;calls.push('dispose');},
  changeStage:next=>{c.stage=next;calls.push('stage:'+next);},
  web:async path=>{calls.push('GET web:'+path);return c.snapshot;},
  admin:async(path,method='GET')=>{calls.push(method+' admin:'+path);assert.equal(method,'GET');return{models:c.models};},
 };
 c.context=()=>({view:c.view,identity:c.identity});
 c.current=ticket=>!c.disposed&&c.active&&ticket.view===c.view&&ticket.identity===c.identity;
 c.tell=(text,error=false)=>{c.notice=text;c.noticeError=error;};
 c.acceptSnapshot=(value,generation)=>{c.snapshot=value;c.confirmedReadGeneration=generation;};
 vm.createContext(c);vm.runInContext(extract(names),c);
 return{c,calls,timers,nodes,noticeNode};
}

for(const reason of ['modelUnknown','runtimeUnknown','catalogError'])test(`five-second ${reason} recovery uses the full read path only`,async()=>{
 const {c,calls,timers}=fixture(['scheduleStatus']);c[reason]=reason==='catalogError'?'catalog unavailable':true;
 c.readCurrent=async preserve=>{calls.push('full-read:'+preserve);};
 c.scheduleStatus();assert.equal(timers.length,1);assert.equal(timers[0].delay,5000);
 await timers[0].callback();assert.deepEqual(calls,['full-read:true']);
});

for(const stage of ['model','preparation'])test(`ordinary ${stage} updates remain lightweight and read-only`,async()=>{
 const {c,calls,timers}=fixture(['scheduleStatus']);c.stage=stage;
 c.readCurrent=async()=>assert.fail('ordinary polling must not fetch the model catalog');
 c.scheduleStatus();await timers[0].callback();
 assert.ok(calls.includes('GET web:onboarding'));assert.ok(!calls.some(call=>call.includes('admin:')));
 assert.equal(c.polling,false);assert.equal(timers.length,2);assert.equal(timers[1].delay,5000);
});

for(const invalidate of ['disposed','inactive','view','identity','generation','writing','reading'])test(`scheduled recovery ignores ${invalidate} work`,async()=>{
 const {c,calls,timers}=fixture(['scheduleStatus']);c.modelUnknown=true;
 c.readCurrent=async()=>calls.push('full-read');c.scheduleStatus();
 if(invalidate==='inactive')c.active=false;
 else if(invalidate==='generation')c.readGeneration++;
 else if(invalidate==='view'||invalidate==='identity')c[invalidate]++;
 else c[invalidate]=true;
 await timers[0].callback();assert.deepEqual(calls,[]);
});

for(const stage of ['loading','error'])test(`${stage} does not start a background status loop`,()=>{
 const {c,timers}=fixture(['scheduleStatus']);c.stage=stage;c.scheduleStatus();assert.equal(timers.length,0);
});

test('zero matches and differing public identity never resolve an unknown model',()=>{
 const {c}=fixture(['resolveUnknown']);c.modelUnknown=true;c.pendingModel={...publicIdentity};
 c.beforeModels=new Set(['preexisting']);
 c.models=[
  saved('preexisting'),saved('different-model',{model:'other'}),saved('different-api',{api:'openai-responses'}),
  saved('different-url',{baseUrl:'https://other.example.invalid'}),saved('different-name',{name:'Other'}),
  saved('disabled',{enabled:false}),saved('missing-key',{credentialAvailable:false}),
 ];
 c.resolveUnknown();assert.equal(c.modelUnknown,true);assert.deepEqual(c.pendingModel,publicIdentity);
 assert.equal(c.selectedRef,'');assert.equal(c.confirmedModel,'');
});

test('one new full-identity match confirms its reference without writing or binding Runtime',()=>{
 const {c,calls}=fixture(['resolveUnknown']);c.modelUnknown=true;c.pendingModel={...publicIdentity};
 c.models=[saved('old'),saved('new')];c.beforeModels=new Set(['old']);
 c.resolveUnknown();assert.equal(c.modelUnknown,false);assert.equal(c.pendingModel,null);
 assert.equal(c.confirmedModel,'new');assert.equal(c.selectedRef,'new');assert.equal(c.mode,'choose');
 assert.match(c.notice,/Continue to bind Runtime/);assert.deepEqual(calls,[]);
});

test('an omitted display name matches only the server default model name',()=>{
 const {c}=fixture(['resolveUnknown']);c.modelUnknown=true;c.pendingModel={...publicIdentity,name:''};
 c.models=[saved('not-default'),saved('default-name',{name:publicIdentity.model})];
 c.resolveUnknown();assert.equal(c.confirmedModel,'default-name');
});

test('multiple full-identity matches never guess an intended reference',()=>{
 const {c,calls}=fixture(['resolveUnknown']);c.modelUnknown=true;c.pendingModel={...publicIdentity};
 c.models=[saved('first'),saved('second')];c.resolveUnknown();
 assert.equal(c.selectedRef,'');assert.equal(c.confirmedModel,'');
 assert.match(c.notice,/More than one saved model matches/);assert.deepEqual(calls,[]);
});

for(const mismatch of ['unconfigured','model','release'])test(`Runtime ${mismatch} mismatch preserves the original unknown target`,()=>{
 const {c}=fixture(['resolveUnknown']);c.runtimeUnknown=true;c.pendingRuntime={modelRef:'original',agentImage:'agent:original'};
 c.snapshot.runtime={configured:true,...c.pendingRuntime};
 if(mismatch==='unconfigured')c.snapshot.runtime.configured=false;
 if(mismatch==='model')c.snapshot.runtime.modelRef='different';
 if(mismatch==='release')c.snapshot.runtime.agentImage='agent:changed';
 c.resolveUnknown();assert.equal(c.runtimeUnknown,true);
 assert.deepEqual(c.pendingRuntime,{modelRef:'original',agentImage:'agent:original'});
});

test('only the original configured Runtime target releases its unknown lock',()=>{
 const {c,calls}=fixture(['resolveUnknown']);c.runtimeUnknown=true;c.pendingRuntime={modelRef:'original',agentImage:'agent:original'};
 c.snapshot.runtime={configured:true,...c.pendingRuntime};c.resolveUnknown();
 assert.equal(c.runtimeUnknown,false);assert.equal(c.pendingRuntime,null);
 assert.match(c.notice,/Runtime save confirmed/);assert.deepEqual(calls,[]);
});

test('normal, catalog-failed and rejected model pages omit all three permanent footer entries',()=>{
 const {c}=fixture(['modelOptions','modelPage']);
 for(const state of [{},{catalogError:'Synthetic catalog failure'},{notice:'Synthetic save rejected',noticeError:true}]){
  Object.assign(c,state);const html=c.modelPage();
  assert.doesNotMatch(html,/Read current state|Manage AI models|Runtime diagnostics|href="\/admin\/models"/);
  assert.match(html,/Save and continue/);assert.match(html,/>Test</);
 }
});

test('only unresolved model-stage saves offer one exceptional review link and one unknown warning',()=>{
 const {c,noticeNode}=fixture(['unknownNotice','updateNotice']);
 for(const target of ['modelUnknown','runtimeUnknown']){
  c.modelUnknown=false;c.runtimeUnknown=false;c[target]=true;c.notice=c.unknownNotice();c.noticeError=true;
  c.updateNotice();assert.equal((noticeNode.innerHTML.match(/Review saved models/g)||[]).length,1);
  assert.equal((noticeNode.innerHTML.match(/is unconfirmed/g)||[]).length,1);
  const html=noticeNode.innerHTML;c.updateNotice();assert.equal(noticeNode.innerHTML,html);
  c.stage='preparation';c.updateNotice();assert.doesNotMatch(noticeNode.innerHTML,/Review saved models/);c.stage='model';
 }
 c.modelUnknown=false;c.runtimeUnknown=false;c.notice='Synthetic rejected save';c.catalogError='Synthetic read failure';
 c.updateNotice();assert.doesNotMatch(noticeNode.innerHTML,/Review saved models/);
});

test('read failure and successful recovery preserve an earlier explicit write rejection',()=>{
 const {c,noticeNode}=fixture(['unknownNotice','updateNotice','tell','preparationReadFailed','acceptSnapshot']);
 c.tell('Model saved. Runtime was not bound. Synthetic binding rejected.',true);
 c.preparationReadFailed(new Error('Synthetic read interrupted'));
 assert.match(noticeNode.innerHTML,/Runtime was not bound/);assert.match(noticeNode.innerHTML,/Synthetic read interrupted/);
 c.acceptSnapshot({administrator:true,runtime:{configured:false}},2);
 assert.match(noticeNode.innerHTML,/Runtime was not bound/);assert.doesNotMatch(noticeNode.innerHTML,/Synthetic read interrupted/);
 assert.equal(c.noticeError,true);assert.equal(c.modelReadError,'');
});

test('successful read clears only its failure while unresolved writes keep one warning and recovery link',()=>{
 const {c,noticeNode}=fixture(['unknownNotice','updateNotice','tell','preparationReadFailed','acceptSnapshot']);
 c.modelUnknown=true;c.tell(c.unknownNotice(),true);c.preparationReadFailed(new Error('Synthetic read interrupted'));
 assert.match(noticeNode.innerHTML,/Synthetic read interrupted/);
 assert.equal((noticeNode.innerHTML.match(/is unconfirmed/g)||[]).length,1);
 c.acceptSnapshot({administrator:true,runtime:{configured:false}},2);
 assert.doesNotMatch(noticeNode.innerHTML,/Synthetic read interrupted/);
 assert.equal((noticeNode.innerHTML.match(/is unconfirmed/g)||[]).length,1);
 assert.equal((noticeNode.innerHTML.match(/Review saved models/g)||[]).length,1);
 assert.equal(c.modelUnknown,true);
});

test('identical unresolved notices do not replace the exceptional recovery link container',()=>{
 const {c,noticeNode}=fixture(['unknownNotice','updateNotice']);let html='',writes=0;
 Object.defineProperty(noticeNode,'innerHTML',{get:()=>html,set:value=>{html=value;writes++;}});
 c.runtimeUnknown=true;c.notice=c.unknownNotice();c.updateNotice();assert.equal(writes,1);
 c.updateNotice();c.updateNotice();assert.equal(writes,1);
});

test('identical read failures preserve the recovery container even when SVG markup is serialized',()=>{
 const {c,noticeNode}=fixture(['unknownNotice','updateNotice','preparationReadFailed']);let html='',writes=0;
 // Browsers serialize parsed SVG paths with explicit closing tags. This small
 // fixture prevents a raw-markup comparison from masking a needless DOM write.
 Object.defineProperty(noticeNode,'innerHTML',{get:()=>html,set:value=>{
  html=value.replace(/<(path|circle|rect)(\s[^>]*?)\/>/g,'<$1$2></$1>');writes++;
 }});
 c.Feedback=realFeedback;c.modelUnknown=true;c.notice=c.unknownNotice();
 c.preparationReadFailed(new Error('Synthetic repeat read failure'));assert.equal(writes,1);
 assert.match(html,/<\/path>/);
 c.preparationReadFailed(new Error('Synthetic repeat read failure'));assert.equal(writes,1);
});

test('a freshly rendered notice container receives unchanged recovery markup',()=>{
 const {c,nodes,noticeNode}=fixture(['unknownNotice','updateNotice']);
 c.modelUnknown=true;c.notice=c.unknownNotice();c.updateNotice();
 const replacement={innerHTML:'',dataset:{}};nodes.set('#setup-notice',replacement);c.updateNotice();
 assert.equal(replacement.innerHTML,noticeNode.innerHTML);assert.match(replacement.innerHTML,/Review saved models/);
});

test('a zero-match full read keeps the existing model view and never renders or writes',async()=>{
 const {c,calls}=fixture(['resolveUnknown','readCurrent']);c.modelUnknown=true;c.pendingModel={...publicIdentity};
 await c.readCurrent(true);assert.equal(c.modelUnknown,true);assert.equal(c.stage,'model');
 assert.ok(!calls.includes('render'));assert.ok(!calls.some(call=>call.startsWith('stage:')));
 assert.deepEqual(calls.filter(call=>call.startsWith('GET')),['GET web:onboarding','GET admin:models']);
});

for(const matches of [1,2])test(`${matches} recovered model matches cannot advance using a different preexisting Runtime`,async()=>{
 const {c,calls}=fixture(['resolveUnknown','readCurrent']);c.modelUnknown=true;c.pendingModel={...publicIdentity};
 c.models=[saved('old-model',{model:'old'}),...Array.from({length:matches},(_,index)=>saved('new-'+index))];
 c.beforeModels=new Set(['old-model']);
 c.snapshot.runtime={configured:true,modelRef:'old-model',agentImage:'agent:original',model:{credentialAvailable:true}};
 await c.readCurrent(true);assert.equal(c.stage,'model');assert.ok(!calls.includes('stage:preparation'));
 assert.equal(c.snapshot.runtime.modelRef,'old-model');assert.equal(c.autoEnter,null);
});

test('a read confirming the original Runtime target may advance without replaying its write',async()=>{
 const {c,calls}=fixture(['resolveUnknown','readCurrent']);c.runtimeUnknown=true;
 c.pendingRuntime={modelRef:'original',agentImage:'agent:original'};c.models=[saved('original')];
 c.snapshot.runtime={configured:true,...c.pendingRuntime,model:{credentialAvailable:true}};
 await c.readCurrent(true);assert.equal(c.runtimeUnknown,false);assert.equal(c.stage,'preparation');
 assert.equal(c.autoEnter,null);
 assert.deepEqual(calls.filter(call=>call.startsWith('GET')),['GET web:onboarding','GET admin:models']);
});

test('an old catalog response cannot replace a new identity state or release its read lock',async()=>{
 const {c,calls}=fixture(['resolveUnknown','readCurrent']);const held=deferred();
 c.admin=async()=>held.promise;const reading=c.readCurrent(true);await Promise.resolve();await Promise.resolve();
 const newerSnapshot={administrator:true,runtime:{configured:false},owner:'new-identity'};
 const newerModels=[saved('new-identity-model')],newerLock=Symbol('new-identity-read');
 c.identity++;c.snapshot=newerSnapshot;c.models=newerModels;c.readLock=newerLock;c.reading=true;
 held.resolve({models:[saved('stale-result')]});await reading;
 assert.equal(c.snapshot,newerSnapshot);assert.equal(c.models,newerModels);
 assert.equal(c.readLock,newerLock);assert.equal(c.reading,true);assert.ok(!calls.includes('render'));
});

for(const lock of ['reading','writing','modelUnknown','runtimeUnknown'])test(`Test cannot start while ${lock}`,async()=>{
 const {c,calls}=fixture(['testModel']);c[lock]=true;
 c.validateModel=()=>assert.fail('locked Test must not validate or read a new draft');
 await c.testModel();assert.deepEqual(calls,[]);
});
