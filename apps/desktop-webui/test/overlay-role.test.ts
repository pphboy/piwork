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
 const c:any={overlayRole,uploadReview,innerWidth:500,view:{modal:'',data:{},path:'/',session:'',drafts:{},layout:'workspace',tab:'Services'},adapter:{getWork:()=>work,models:new Map(),cancelAndSendCapabilities:new Map(),activeRuns:new Map(),imageCapabilities:new Map([['a',{}]]),activateChat:()=>{},modelReady:()=>true,project:()=>({usable:true}),chatSubmissions:new Map()},route:()=>['work','a'],current:()=>work,isRequestInspector:()=>false,fileModalResults:()=>'',fileAttempt:undefined,decodePaths:JSON.parse,modalTransfers:[],workspaceChatToggle:()=>'<button>Show chat</button>',focusControls:()=>'',activeService:()=>undefined,sessionDisplayName:()=>'',draftKey:()=>'',imageDrafts:{get:()=>[],move:()=>{}},imageDraftErrors:new Map(),textDraftRevisions:new Map(),webCommands:[],agentLayoutControls:()=>'',submissionMarkup:()=>'',imageDraftMarkup:()=>'',modelComposer:()=>'',commandPalette:()=>'',modelFeedback:()=>'',messageMarkup:()=>'<p>Preserved history</p>',unmatchedExecutions:()=>''};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const esc ='),source.indexOf('let view =')),c);for(const name of ['modalMarkup','serviceFallbackHeader','services','agent'])vm.runInContext(extract(name),c);return{c,work};
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
 delete work.resourceErrors.services;delete work.resourceChecked.services;html=c.services(work);assert.match(html,/Loading Services/);assert.match(html,/Show chat/);
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
 const calls:string[]=[],adapter={loadServices:async(id:string)=>calls.push(`services:${id}`),loadSessions:async(id:string)=>calls.push(`sessions:${id}`),loadSession:async(id:string,session:string)=>calls.push(`history:${id}:${session}`)},currentWork={id:'work',sessions:[{id:'first'},{id:'selected'}]},view={session:'selected'};
 for(const action of ['retry-services','retry-conversation']){
  const part=source.match(new RegExp("case '"+action+"':([\\s\\S]*?)break;"))?.[1];assert.ok(part);
  const run=new Function('adapter','currentWork','view','stay',`return (async()=>{${part}})()`);await run(adapter,currentWork,view,(p:Promise<unknown>)=>p);
 }
 assert.deepEqual(calls,['services:work','sessions:work','history:work:selected']);assert.equal(view.session,'selected');
});
