const { unavailableServicesReason } = await import(new URL('../browser/work-navigation.js',import.meta.url).href);
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const {overlayRole,anchoredOverlay,overlayPlacement,menuDestination}=await import(new URL('../browser/overlay-role.js',import.meta.url).href);
const source=readFileSync(new URL('../browser/app.js',import.meta.url),'utf8');
const extract=(name:string)=>{const value=source.match(new RegExp('^function '+name+'\\([\\s\\S]*?^}', 'm'));assert.ok(value,name);return value[0];};
test('commands, value choices and sustained Service tools have explicit bounded roles',()=>{
 for(const name of ['account','work-menu','agent-menu','service-menu','file-menu'])assert.equal(overlayRole(name),'menu');
 for(const name of ['service-picker','sessions','chat-response-settings','chat-input-options','connection','work-info','skill-detail'])assert.equal(overlayRole(name),'popover');
 for(const name of ['manage-services','service-details','operations','operation','run-details','package-detail'])assert.equal(overlayRole(name),'drawer');
 for(const name of ['delete-work','stop-work','service-control','import','new-work','dirty-file','upload-overwrite','unrecognized']){assert.equal(overlayRole(name),'modal');assert.equal(anchoredOverlay(name),false);}
});
test('anchor positioning fits narrow edges and flips above bottom launchers',()=>{
 const narrow=overlayPlacement({left:460,right:495,top:80,bottom:120},{width:380,height:400},{width:500,height:700});assert.equal(narrow.left,112);assert.equal(narrow.top,126);assert.ok(narrow.top+Math.min(narrow.maxHeight,400)<=692);
 const lower=overlayPlacement({left:200,right:400,top:600,bottom:640},{width:380,height:350},{width:500,height:700});assert.equal(lower.top,244);assert.equal(lower.left,112);
 const huge=overlayPlacement({left:5,right:45,top:20,bottom:60},{width:500,height:1000},{width:360,height:300});assert.equal(huge.left,8);assert.equal(huge.maxHeight,226);
});
test('menu keyboard traversal wraps and supports Home and End without selection mutation',()=>{
 assert.equal(menuDestination('ArrowDown',3,4),0);assert.equal(menuDestination('ArrowUp',0,4),3);assert.equal(menuDestination('Home',2,4),0);assert.equal(menuDestination('End',0,4),3);assert.equal(menuDestination('Tab',1,4),-1);assert.equal(menuDestination('ArrowDown',0,0),-1);
});
test('outside dismissal removes only the local overlay and never renders, focuses or suppresses the next click',()=>{
 let closes=0,removes=0;const attrs:any={};const trigger={setAttribute:(k:string,v:string)=>attrs[k]=v,removeAttribute:(k:string)=>delete attrs[k]},dialog={close:()=>closes++,remove:()=>removes++};
 const c:any={anchoredOverlay,view:{modal:'service-picker',data:{id:'original'},modalError:'',modalNameError:null},modalChoice:1,overlayAnchor:'#service-select',pendingWebCommand:undefined,root:{querySelector:(key:string)=>key==='#modal'?dialog:trigger}};
 vm.createContext(c);vm.runInContext(extract('dismissAnchoredOverlay'),c);c.dismissAnchoredOverlay();assert.equal(c.view.modal,'');assert.equal(c.modalChoice,2);assert.equal(closes,1);assert.equal(removes,1);assert.equal(attrs['aria-expanded'],'false');assert.equal(c.view.data.id,'original');
 assert.doesNotMatch(extract('dismissAnchoredOverlay'),/render\(|\.focus\(|preventDefault|setTimeout/);
});
test('value choices are listboxes and options, not command menu items',()=>{
 const markup=extract('modalMarkup');assert.match(markup,/service-picker-list" role="listbox"/);assert.match(markup,/chat-picker-menu" role="listbox"/);assert.match(markup,/session-list" role="listbox"/);assert.match(markup,/role="option" aria-selected=/);assert.doesNotMatch(markup,/menuitemradio/);
});
test('narrow chat preserves the same Service header and its original iframe ancestor',()=>{
 const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8'),work=extract('workPage'),services=extract('services');
 assert.doesNotMatch(work,/workspaceChatToggle\(w\)/);assert.match(services,/workspaceChatToggle\(w\)/);assert.doesNotMatch(work,/narrowChat \|\| view.layout === "chat-only" \? "inert"/);
 assert.match(css,/narrow-chat > \.main-panel > :not\(\.service-toolbar\) \{ display:none/);assert.doesNotMatch(css,/modal-in|modal-out|modal-exit-/);
});
const {uploadReview}=await import(new URL('../browser/file-results.js',import.meta.url).href);
function rendererFixture(){
 const work:any={id:'a',name:'A',services:[],sessions:[],resourceChecked:{services:'now',agent:'now'},resourceErrors:{}};
 const c:any={unavailableServicesReason,overlayRole,uploadReview,innerWidth:500,view:{modal:'',data:{},path:'/',session:'',drafts:{},layout:'workspace',tab:'Services'},adapter:{getWork:()=>work,directories:new Map(),models:new Map(),cancelAndSendCapabilities:new Map(),activeRuns:new Map(),imageCapabilities:new Map([['a',{}]]),activateChat:()=>{},modelReady:()=>true,project:()=>({usable:true}),chatSubmissions:new Map()},route:()=>['work','a'],current:()=>work,isRequestInspector:()=>false,fileModalResults:()=>'',fileAttempt:undefined,decodePaths:JSON.parse,modalTransfers:[],workspaceChatToggle:()=>'<button>Show chat</button>',focusControls:()=>'',activeService:()=>undefined,sessionDisplayName:()=>'',draftKey:()=>'',imageDrafts:{get:()=>[],move:()=>{}},imageDraftErrors:new Map(),textDraftRevisions:new Map(),webCommands:[],agentLayoutControls:()=>'',submissionMarkup:()=>'',imageDraftMarkup:()=>'',modelComposer:()=>'',commandPalette:()=>'',modelFeedback:()=>'',messageMarkup:()=>'<p>Preserved history</p>',unmatchedExecutions:()=>''};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const esc ='),source.indexOf('let view =')),c);for(const name of ['modalMarkup','serviceFallbackHeader','serviceViewport','services','agent'])vm.runInContext(extract(name),c);return{c,work};
}
test('upload review separates proven overwrites, failed checks and unknown writes without false destructive consent',()=>{
 const {c}=rendererFixture();c.view.modal='upload-overwrite';
 c.modalTransfers=[{path:'/denied',status:'failed',notSubmitted:true,message:'HEAD 403'}];let html=c.modalMarkup();assert.match(html,/Retry failed uploads/);assert.doesNotMatch(html,/Replace these|Overwrite confirmed/);
 c.modalTransfers=[{path:'/exists',status:'failed',needsConsent:true,message:'Target exists'},{path:'/lost',status:'unknown',message:'PUT result unknown'}];html=c.modalMarkup();assert.match(html,/Replace these confirmed existing files: <code>\/exists<\/code>/);assert.match(html,/Overwrite confirmed files/);assert.doesNotMatch(html,/Retry failed uploads/);assert.match(html,/no unknown upload will be repeated/);
 const review=uploadReview([...c.modalTransfers,{path:'/done',status:'succeeded',message:'saved'}]);assert.deepEqual(review.overwrite.map((r:any)=>r.path),['/exists']);assert.equal(review.retry.length,0);assert.deepEqual(review.unknown.map((r:any)=>r.path),['/lost']);
});
test('file deletion states irreversible UI consequences with exact selected paths',()=>{
 const {c}=rendererFixture();c.view.modal='file-delete';c.view.data.paths=JSON.stringify(['/a','/folder']);const html=c.modalMarkup();assert.match(html,/cannot be restored from this UI/);assert.match(html,/<code>\/a<\/code>/);assert.match(html,/<code>\/folder<\/code>/);
});
test('empty, pending and failed Services always retain the local header while failure is not presented as empty',()=>{
 const {c,work}=rendererFixture();assert.match(c.services(work),/No Web Service is ready/);assert.match(c.services(work),/Show chat/);
 work.resourceErrors.services='503 Unavailable';let html=c.services(work);assert.match(html,/503 Unavailable/);assert.match(html,/Retry Services/);assert.doesNotMatch(html,/No Web Service is ready|Ask the Agent to build/);assert.match(html,/Show chat/);
 delete work.resourceErrors.services;delete work.resourceChecked.services;html=c.services(work);assert.match(html,/Loading Services/);assert.match(html,/read-placeholder-service/);assert.match(html,/aria-hidden="true"/);assert.match(html,/Show chat/);
});
test('failed first conversation reads do not show starter welcome while model-only failure keeps confirmed empty state',()=>{
 const {c,work}=rendererFixture();work.sessions=[{id:'s',messages:[],error:'History failed'}];let html=c.agent(work,false);assert.doesNotMatch(html,/chat-welcome/);assert.match(html,/History failed|Retry conversation/);
 work.sessions=[];work.resourceErrors.agent='Sessions failed';html=c.agent(work,false);assert.doesNotMatch(html,/chat-welcome/);assert.match(html,/Sessions failed/);
 work.resourceErrors.agent='Model options failed';c.adapter.models.set('a',{error:'Model options failed'});html=c.agent(work,false);assert.match(html,/chat-welcome/);
 work.sessions=[{id:'s',messages:[{}],checkedAt:'2026-10-14T00:00:00Z',loading:true}];html=c.agent(work,false);assert.match(html,/Preserved history/);assert.doesNotMatch(html,/Loading conversation/);
});
test('navigation uses real Work URLs and modified clicks preserve native browser behavior',()=>{
 const c:any={};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const esc ='),source.indexOf('let view =')),c);const html=vm.runInContext("workLink('Open Work','a/b?c','primary')",c);assert.match(html,/href="#\/work\/a%2Fb%3Fc"/);assert.match(source,/if \(e.ctrlKey \|\| e.metaKey \|\| e.shiftKey \|\| e.altKey \|\| e.button !== 0\)/);
});
test('drawer transitions explicitly focus their new Close only during open; menu failure feedback survives',()=>{
 assert.match(extract('openModal'),/overlayRole\(name\) === 'drawer'/);assert.match(extract('openModal'),/data-action=close-modal/);assert.match(source,/menuCommand && !menuFailed/);assert.match(extract('modalMarkup'),/view.modalError \? feedback/);
});
test('local retry actions actually reload their failed resource and preserve a selected later Session',async()=>{
 const calls:string[]=[],adapter={loadServices:async(id:string)=>calls.push(`services:${id}`),loadSessions:async(id:string)=>calls.push(`sessions:${id}`),loadSession:async(id:string,session:string)=>calls.push(`history:${id}:${session}`)},currentWork={id:'work',sessions:[{id:'first'},{id:'selected'}],resourceErrors:{agent:'Earlier read failed'}},view={session:'selected',modal:'sessions',modalError:'Earlier read failed'};
 for(const action of ['retry-services','retry-conversation']){
  const part=source.match(new RegExp("case '"+action+"':([\\s\\S]*?)break;"))?.[1];assert.ok(part);
  const run=new Function('adapter','currentWork','view','stay',`return (async()=>{${part}})()`);await run(adapter,currentWork,view,(p:Promise<unknown>)=>p);
 }
 assert.deepEqual(calls,['services:work','sessions:work','history:work:selected']);assert.equal(view.modalError,'');assert.equal(view.session,'selected');
});

test('cached Chat reads are silent and failures have exactly one scoped retry without losing history',()=>{
 const {c,work}=rendererFixture();work.sessions=[{id:'s',messages:[{}],checkedAt:'now',loading:true}];work.resourceLoading={agent:true};let html=c.agent(work,false);
 assert.match(html,/Preserved history/);assert.doesNotMatch(html,/Saved conversation|retrieved|read-placeholder|read-failure/);
 work.sessions[0].loading=false;work.resourceLoading.agent=false;work.sessions[0].error='Read denied';work.resourceErrors.agent='Read denied';html=c.agent(work,false);
 assert.equal((html.match(/class="feedback warning read-failure"/g)||[]).length,1);assert.equal((html.match(/data-action="retry-conversation"/g)||[]).length,1);assert.match(html,/Preserved history/);assert.doesNotMatch(html,/chat-welcome/);
 work.sessions[0].messages=[];work.sessions[0].checkedAt='';work.sessions[0].error='';work.resourceErrors.agent='';work.sessions[0].loading=true;html=c.agent(work,false);assert.match(html,/read-placeholder/);assert.doesNotMatch(html,/chat-welcome/);
 work.sessions[0].checkedAt='now';html=c.agent(work,false);assert.match(html,/chat-welcome/);assert.doesNotMatch(html,/read-placeholder/);
});
test('active Run initial checking is neutral and send stays locked; idle unknown and errors retain Check status',()=>{
 const {c,work}=rendererFixture();c.adapter.cancelAndSendCapabilities.set('a',1);c.adapter.activeRuns.set('a',{confirmed:false,loading:true,error:''});let html=c.agent(work,false);
 assert.match(html,/aria-label="Checking conversation status" aria-busy="true"/);assert.match(html,/data-action="send-message"[^>]*disabled/);assert.doesNotMatch(html,/Checking the active Run|data-action="check-active-run"/);
 c.adapter.activeRuns.set('a',{confirmed:false,loading:false,error:''});html=c.agent(work,false);assert.match(html,/Conversation status is not confirmed/);assert.match(html,/data-action="check-active-run"/);assert.doesNotMatch(html,/aria-label="Checking conversation status"/);
 c.adapter.activeRuns.set('a',{confirmed:false,loading:false,error:'Observation lost'});html=c.agent(work,false);assert.match(html,/Observation lost/);assert.match(html,/data-action="check-active-run"/);
 c.adapter.activeRuns.set('a',{confirmed:true,loading:true,error:'',run:null});html=c.agent(work,false);assert.doesNotMatch(html,/Checking conversation status|Conversation status is not confirmed|data-action="check-active-run"/);assert.doesNotMatch(html,/data-action="send-message"[^>]*disabled/);
});
test('read feedback is bound to directory, navigation origin and Session; unknown writes stay visible',()=>{
 const {c,work}=rendererFixture();c.view.tab='Files';c.view.path='/current';c.view.file='';vm.runInContext(extract('visibleActionRecord'),c);
 assert.equal(c.visibleActionRecord({kind:'read',action:'refresh-files',work:'a',resource:'/old'}),false);
 assert.equal(c.visibleActionRecord({kind:'read',action:'file-path',work:'a',resource:'/denied',origin:'/current'}),true);
 c.view.path='/new';assert.equal(c.visibleActionRecord({kind:'read',action:'file-path',work:'a',resource:'/denied',origin:'/current'}),false);
 c.view.tab='Chat';c.view.session='old';assert.equal(c.visibleActionRecord({kind:'read',action:'open-source',work:'a',resource:'/source.txt',sourceContext:'Chat:old:'}),true);c.view.session='new';assert.equal(c.visibleActionRecord({kind:'read',action:'open-source',work:'a',resource:'/source.txt',sourceContext:'Chat:old:'}),false);assert.equal(c.visibleActionRecord({kind:'read',action:'select-session',work:'a',resource:'old'}),false);
 assert.equal(c.visibleActionRecord({kind:'files',action:'save-file',work:'a',resource:'/old',blocked:true}),true);
});
test('Service header never exposes ports while the actual iframe target stays selected',()=>{
 const {c,work}=rendererFixture();const s={id:'notes',name:'Notes',ports:[8080,9090],enabled:true,observed:'Ready',domain:'notes.test'};work.services=[s];c.activeService=()=>s;c.view.port=9090;c.root={querySelectorAll:()=>[]};c.adapter.requestPresence=new Map();c.adapter.serviceEmbed=()=>'';c.adapter.serviceEntryError=()=>'';c.adapter.serviceEntryUrl=(_w:string,_s:string,p:number)=>`https://notes.test:${p}/`;c.adapter.servicePreviewUnconfirmed=()=>false;const html=c.services(work);assert.doesNotMatch(html,/port-label|port-select|Declared Web port/);assert.match(html,/src="https:\/\/notes.test:9090\/"/);
});

test('Sessions retry keeps one error region even when the generic modal catch records the same failure',()=>{
 const {c,work}=rendererFixture();c.view.modal='sessions';c.view.modalError='Session list denied';work.resourceErrors.agent='Session list denied';const html=c.modalMarkup();assert.equal((html.match(/Session list denied/g)||[]).length,1);assert.match(html,/data-action="retry-conversation"/);assert.doesNotMatch(html,/No Sessions yet/);
});

test('model metadata failure cannot turn an unconfirmed first conversation into a welcome state',()=>{
 const {c,work}=rendererFixture();delete work.resourceChecked.agent;work.resourceErrors.agent='Model options unavailable';c.adapter.models.set('a',{error:'Model options unavailable'});const html=c.agent(work,false);assert.match(html,/Loading conversation/);assert.doesNotMatch(html,/chat-welcome/);
});

test('successful conversation retry cannot revive an older Sessions action error after inline feedback clears',()=>{
 const {c,work}=rendererFixture();c.view.session='s';work.sessions=[{id:'s',messages:[{}],checkedAt:'now'}];vm.runInContext(extract('visibleActionRecord'),c);
 const old={kind:'read',action:'sessions',work:'a',resource:'/',error:'Session list denied'};work.resourceErrors.agent=old.error;assert.equal(c.visibleActionRecord(old),true);
 delete work.resourceErrors.agent;assert.equal(c.visibleActionRecord(old),false);
 const retry={...old,action:'retry-conversation',resource:'s'};work.sessions[0].error=old.error;assert.equal(c.visibleActionRecord(retry),true);work.sessions[0].error='';assert.equal(c.visibleActionRecord(retry),false);
});

test('successful file refresh also retires the original tab read error without weakening write recovery',()=>{
 const {c,work}=rendererFixture();c.view.tab='Files';c.view.file='';c.view.path='/';vm.runInContext(extract('visibleActionRecord'),c);const old={kind:'read',action:'tab-Files',work:'a',resource:'/',error:'Files denied'};
 c.adapter.directories.set('a:/',{checkedAt:'',error:'Files denied'});assert.equal(c.visibleActionRecord(old),true);
 c.adapter.directories.set('a:/',{checkedAt:'now',error:''});assert.equal(c.visibleActionRecord(old),false);
 assert.equal(c.visibleActionRecord({...old,kind:'files',action:'save-file',blocked:true}),true);
});


test('Ready Service first entry and pending entry use skeleton, then retain iframe or show actual failure',()=>{
 const {c,work}=rendererFixture();const service={id:'s',name:'Notes',ports:[3000],enabled:true,observed:'Ready'};work.services=[service];work.desired='running';work.status='Ready';c.view.port=3000;c.activeService=()=>service;c.root={querySelectorAll:()=>[]};
 Object.assign(c.adapter,{requestPresence:new Map(),serviceEmbed:()=>'',serviceEntryError:()=>'',serviceEntryUrl:()=>null,serviceEntryPending:()=>false,servicePreviewUnconfirmed:()=>false});
 let html=c.services(work);assert.match(html,/read-placeholder-service/);assert.doesNotMatch(html,/Application entry not confirmed|No Web Service/);
 c.adapter.serviceEntryPending=()=>true;html=c.services(work);assert.match(html,/read-placeholder-service/);
 c.adapter.serviceEntryUrl=()=> 'https://service.test/';html=c.services(work);assert.match(html,/<iframe/);assert.doesNotMatch(html,/service-frame-loading|read-placeholder/);
 c.adapter.serviceEntryUrl=()=>null;c.adapter.serviceEntryPending=()=>false;c.adapter.serviceEntryError=()=> 'Access denied';html=c.services(work);assert.match(html,/Access denied/);assert.doesNotMatch(html,/read-placeholder/);
});

test('Chat skeleton belongs only to unconfirmed history and preserves cached messages on refresh',()=>{
 const {c,work}=rendererFixture();delete work.resourceChecked.agent;let html=c.agent(work,false);assert.match(html,/read-placeholder-conversation/);assert.doesNotMatch(html,/chat-welcome/);
 work.resourceChecked.agent='now';work.sessions=[{id:'s',checkedAt:'now',messages:[{}],loading:true}];html=c.agent(work,false);assert.match(html,/Preserved history/);assert.doesNotMatch(html,/read-placeholder-conversation/);
 work.sessions[0].messages=[];html=c.agent(work,false);assert.match(html,/chat-welcome/);assert.doesNotMatch(html,/read-placeholder-conversation/);
});


test('Service ticket URL normalization and unfinished navigation never cover the application',()=>{
 const {c,work}=rendererFixture();const service={id:'s',name:'Notes'};c.view.port=3000;c.adapter.identityEpoch=1;
 let url='https://service.test/_bootstrap?ticket=synthetic';c.adapter.serviceEntryUrl=()=>url;
 let onLoad=()=>{},checks=0;const frame:any={dataset:{serviceKey:'a:s:3000'},isConnected:true,getAttribute:()=> 'https://service.test/_bootstrap?ticket=synthetic',addEventListener:(_event:string,handler:()=>void)=>onLoad=handler};
 c.root={querySelectorAll:()=>[frame]};c.adapter.serviceFrameLoaded=async()=>checks++;c.toast=()=>{};vm.runInContext(extract('observeServiceFrames'),c);
 // No load event is necessary to reveal real content, including during a slow subresource.
 assert.doesNotMatch(c.serviceViewport(work,service),/service-frame-loading|read-placeholder/);
 c.observeServiceFrames();url='https://service.test/';
 // The real entry probe normalizes the URL but the retained iframe keeps its ticket src.
 assert.doesNotMatch(c.serviceViewport(work,service),/service-frame-loading|read-placeholder/);
 onLoad();assert.equal(checks,1);assert.doesNotMatch(c.serviceViewport(work,service),/service-frame-loading|read-placeholder/);
 frame.isConnected=false;onLoad();assert.equal(checks,1);frame.isConnected=true;c.adapter.identityEpoch=2;onLoad();assert.equal(checks,1);
});


test('first Chat read uses neutral Session/model labels while real errors and unknown model writes retain recovery',()=>{
 const {c,work}=rendererFixture();vm.runInContext(extract('sessionDisplayName'),c);vm.runInContext(extract('chatSettings'),c);
 delete work.resourceChecked.agent;c.adapter.modelSelection=()=>({ref:null,thinking:null,phase:'clean'});c.adapter.chatCapabilities=new Map();
 assert.equal(c.sessionDisplayName(work),'Loading conversations…');let settings=c.chatSettings(work,'');assert.equal(settings.name,'Loading models…');assert.equal(settings.recovery,undefined);assert.doesNotMatch(settings.status,/unconfirmed|last known/i);
 work.resourceChecked.agent='now';assert.equal(c.sessionDisplayName(work),'No Session yet');c.adapter.models.set('a',{loading:true,confirmed:false,error:'',models:[]});assert.equal(c.chatSettings(work,'').recovery,undefined);
 c.adapter.models.set('a',{loading:false,confirmed:false,error:'Offline',models:[]});settings=c.chatSettings(work,'');assert.match(settings.status,/Offline/);assert.equal(settings.recovery.action,'load-models');
 c.adapter.models.set('a',{loading:true,confirmed:false,error:'',models:[]});c.adapter.modelSelection=()=>({ref:null,thinking:null,phase:'unknown'});settings=c.chatSettings(work,'');assert.equal(settings.recovery.action,'check-session-model');
});

test('first-read shapes contain no visible text while Chat fields and input keep their controls',()=>{
 const {c,work}=rendererFixture();
 for(const shape of ['rows','conversation','service']) {
  const html=vm.runInContext(`readPlaceholder('Loading content…', '${shape}')`,c);
  assert.match(html,/role="status" aria-label="Loading content…" aria-busy="true"/);
  assert.equal(html.replace(/<[^>]*>/g,''),'');
  assert.equal((html.match(/aria-hidden="true"/g)||[]).length,3);
 }
 delete work.resourceChecked.agent;
 const html=c.agent(work,false);
 assert.match(html,/data-action="sessions" aria-label="Loading conversations" aria-busy="true"/);
 assert.match(html,/read-placeholder-field/);assert.match(html,/id="composer"/);
 assert.doesNotMatch(html.replace(/<[^>]*>/g,''),/Loading|No Session yet/);
 vm.runInContext(extract('modelComposer'),c);vm.runInContext(extract('modelFeedback'),c);
 c.chatSettings=()=>({name:'Loading models…',thinking:'Loading…',state:{ref:null},initialLoading:true,status:'Loading models…'});
 assert.match(c.modelComposer(work,''),/aria-label="Loading response settings" aria-busy="true"/);
 assert.equal(c.modelComposer(work,'').replace(/<[^>]*>/g,''),'');assert.equal(c.modelFeedback(work,''),'');
 c.chatSettings=()=>({name:'Saved model',thinking:'Off',state:{ref:null},status:'Models unavailable',recovery:{label:'Retry models',action:'load-models'}});
 assert.match(c.modelComposer(work,''),/Saved model/);assert.match(c.modelFeedback(work,''),/Models unavailable/);assert.match(c.modelFeedback(work,''),/Retry models/);
});

test('first-read reveal is CSS-only, static, and does not reintroduce modal animations',()=>{
 const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
 assert.match(css,/animation:read-placeholder-reveal 0s 150ms both/);
 assert.match(css,/@keyframes read-placeholder-reveal \{ from \{ opacity:0; \} to \{ opacity:1; \} \}/);
 assert.doesNotMatch(css,/modal-in|modal-out|modal-exit-|animation:[^;]*(?:shimmer|pulse)/);
});


test('cold Work deep link stays pending through bootstrap, but real failures and completed route reads do not',()=>{
 const c:any={routeLoad:0,workReadErrors:new Map(),actions:{records:new Map()},adapter:{worksError:'',state:{scenario:'normal'}}};vm.createContext(c);vm.runInContext(extract('workReadPending'),c);
 for(const scenario of ['loading','normal','empty']){c.adapter.state.scenario=scenario;assert.equal(c.workReadPending('a'),true);}
 for(const scenario of ['core-offline','env-not-ready','list-error']){c.adapter.state.scenario=scenario;assert.equal(c.workReadPending('a'),false);}
 c.adapter.state.scenario='normal';c.adapter.worksError='List timed out';assert.equal(c.workReadPending('a'),false);c.adapter.worksError='';
 c.workReadErrors.set('a',{missing:true,message:'Not found'});assert.equal(c.workReadPending('a'),false);c.workReadErrors.clear();
 c.routeLoad=1;assert.equal(c.workReadPending('a'),false);c.actions.records.set('other',{work:'b',pending:true});assert.equal(c.workReadPending('a'),false);
 c.actions.records.set('route',{work:'a',pending:true});assert.equal(c.workReadPending('a'),true);
 assert.match(extract('render'),/workReadPending\(r\[1\]\)/);
});


test('bootstrap failure exits a cold Work skeleton only for its original identity and exact route',()=>{
 const messages:string[]=[],c:any={Error,routeLoad:0,location:{hash:'#/work/a'},route:()=>['work','a'],workReadErrors:new Map(),adapter:{identityEpoch:1,getWork:()=>undefined},toast:(text:string)=>messages.push(text)};vm.createContext(c);vm.runInContext(extract('reportInitializationFailure'),c);
 c.reportInitializationFailure(new Error('Known operations unavailable'),1,'#/work/a');assert.equal(c.workReadErrors.get('a').message,'Known operations unavailable');assert.equal(c.workReadErrors.get('a').missing,false);assert.equal(messages.length,1);
 c.workReadErrors.clear();c.reportInitializationFailure(new Error('Old identity'),0,'#/work/a');c.reportInitializationFailure(new Error('Old route'),1,'#/work/b');assert.equal(c.workReadErrors.size,0);assert.equal(messages.length,1);
 c.routeLoad=1;c.reportInitializationFailure(new Error('Later failure'),1,'#/work/a');assert.equal(c.workReadErrors.size,0);
 c.routeLoad=0;c.adapter.getWork=()=>({id:'a'});c.reportInitializationFailure(new Error('Retain known Work'),1,'#/work/a');assert.equal(c.workReadErrors.size,0);
});


test('both initialization entries bind failure recovery after synchronous ticket normalization',async()=>{
 const calls:any[]=[],c:any={URLSearchParams,location:{hash:'#ticket=synthetic'},adapter:{identityEpoch:3,initialize:()=>{c.location.hash='';return Promise.reject(new Error('Bootstrap failed'));}},loadRoute:()=>{},reportInitializationFailure:(...args:any[])=>calls.push(args)};vm.createContext(c);vm.runInContext(extract('handleRouteNavigation'),c);c.handleRouteNavigation();await Promise.resolve();await Promise.resolve();
 assert.equal(calls.length,1);assert.equal(calls[0][1],3);assert.equal(calls[0][2],'');
 assert.match(source,/const initialization = adapter.initialize\(\);\nconst initializationContext = \{ epoch: adapter.identityEpoch, route: location.hash \};\nvoid initialization.then/);
 assert.match(source,/reportInitializationFailure\(error, initializationContext.epoch, initializationContext.route\)/);
 assert.doesNotMatch(extract('handleRouteNavigation'),/initialize\(\).then.*toast/);
});


test('independent application preserves exact target, recovery and real read state without a Work',()=>{
 const c:any={workReadErrors:new Map(),adapter:{worksError:''},esc:(s:string)=>s.replace(/</g,'&lt;'),topbar:()=>'',workLink:(label:string,id:string)=>`<a href="#/work/${encodeURIComponent(id)}">${label}</a>`,btn:(label:string,action:string)=>`<button data-action="${action}">${label}</button>`,readPlaceholder:()=>'<div aria-busy="true">skeleton</div>',empty:(_icon:string,title:string,description:string,actions:string)=>`${title} ${description} ${actions}`,workReadPending:()=>true};
 vm.createContext(c);vm.runInContext(extract('standaloneWorkUnavailable'),c);
 const route=['app','work-a','service-b','8080'];let html=c.standaloneWorkUnavailable(route);
 assert.match(html,/Work work-a · Service service-b · Port 8080/);assert.match(html,/aria-busy="true"/);assert.match(html,/#\/work\/work-a/);assert.doesNotMatch(html,/Work unavailable|retry-work-read|iframe/);
 c.workReadPending=()=>false;for(const [missing,message] of [[true,'404 not found'],[false,'403 access denied'],[false,'Read timed out']]){c.workReadErrors.set('work-a',{missing,message});html=c.standaloneWorkUnavailable(route);assert.ok(html.includes(message));assert.match(html,missing?/Work not found/:/Work unavailable/);assert.match(html,/retry-work-read/);assert.match(html,/Back to Work/);assert.doesNotMatch(html,/iframe|data-action="start/);}
 assert.match(extract('render'),/else\s+html = standaloneWorkUnavailable\(r\)/);
});
test('independent cold bootstrap errors are scoped to the original identity and route',()=>{
 const c:any={Error,routeLoad:0,location:{hash:'#/app/a/s/80'},route:()=>['app','a','s','80'],workReadErrors:new Map(),adapter:{identityEpoch:2,getWork:()=>undefined},toast:()=>{}};vm.createContext(c);vm.runInContext(extract('reportInitializationFailure'),c);
 c.reportInitializationFailure(new Error('Metadata unavailable'),2,c.location.hash);assert.equal(c.workReadErrors.get('a').message,'Metadata unavailable');c.workReadErrors.clear();c.reportInitializationFailure(new Error('Stale'),1,c.location.hash);c.reportInitializationFailure(new Error('Stale'),2,'#/app/a/s/81');assert.equal(c.workReadErrors.size,0);
});

for(const width of [1440,360])test(`default Chat retains Service explanation at ${width}px`,()=>{
 const {c,work}=rendererFixture();c.innerWidth=width;c.view.tab='Chat';c.workspacePanels=new Map([['a',{collapsed:false}]]);c.workControls=new Map();c.controlMarkup=()=>'';c.workHeader=()=>'';c.adapter.project=()=>({usable:true,retainWorkspace:true});vm.runInContext(extract('workPage'),c);
 const html=c.workPage(work);assert.match(html,/chat-main/);assert.match(html,/This Work has no Services/);assert.match(html,/data-action="manage-services"/);assert.doesNotMatch(html,/chat-hidden|service-workspace/);
});

test('Sessions offers one New session before the scoped list',()=>{
 const {c,work}=rendererFixture();c.view.modal='sessions';work.sessions=[{id:'one',messages:[]}];const html=c.modalMarkup();
 assert.equal((html.match(/data-action="new-session"/g)||[]).length,1);assert.ok(html.indexOf('data-action="new-session"')<html.indexOf('class="session-list"'));assert.match(html,/data-action="select-session" data-id="one"/);
});
