const { localeSandbox } = await import(new URL('./locale-sandbox.js', import.meta.url).href);
const { pendingDots } = await import(new URL('../browser/pending.js', import.meta.url).href);
const { renderChatMarkdown } = await import(new URL('../browser/chat-markdown.js',import.meta.url).href);
const { overlayRole } = await import(new URL('../browser/overlay-role.js',import.meta.url).href);
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../browser/app.js',import.meta.url),'utf8');
const {activityGroups}=await import(new URL('../browser/chat-projection.js',import.meta.url).href);
const {executionAnchors}=await import(new URL('../browser/workspace-layout.js',import.meta.url).href);
function extract(...names:string[]){return names.map(name=>{const value=source.match(new RegExp('^(?:async )?function '+name+'\\([\\s\\S]*?^}', 'm'));assert.ok(value,name);return value[0];}).join('\n');}
function fixture(){
 const work:any={id:'work-a',name:'Work A',sessions:[{id:'session-a',messages:[],runs:[]}],services:[],files:[],resourceChecked:{services:'now'},resourceErrors:{}};
 const c:any={...localeSandbox,pendingDots,actions:{records:new Map()},location:{hash:'#/work/work-a'},renderChatMarkdown,innerWidth:1440,view:{modal:'',data:{},session:'session-a',tab:'Services',service:'',port:3000,layout:'workspace'},adapter:{identityEpoch:7,runDetails:new Map(),activeRuns:new Map(),cancelAndSendCapabilities:new Map(),requestReadErrors:new Map(),requestDetails:new Map(),requestResponses:new Map(),requestRetries:new Map(),getWork:()=>work,project:()=>({usable:true}),requestPage:()=>undefined,requestCancellation:()=>undefined},current:()=>work,route:()=>['work','work-a'],activityGroups,executionAnchors,expandedActivity:new Map(),historyImageMarkup:()=>'',requestNavigationCurrent:()=>false,requestCancellable:()=>false};
 c.overlayRole=overlayRole;vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const esc ='),source.indexOf('let view =')),c);
 vm.runInContext(extract('activityBusy','fileReadPending','isRequestInspector','nonmodalDialog','requestStateLabel','modelDisplayName','runFacts','layoutButton','focusControls','agentLayoutControls','browserFullscreenAction','executionMarkup','toolStatusText','unmatchedExecutions','messageMarkup','modalMarkup','focusKey'),c);return {c,work};
}
test('message execution details bind each true Run once and never attach the Work active Run to legacy text',()=>{
 const {c,work}=fixture();work.run={id:'external',sessionId:'other',status:'running'};work.sessions[0].runs=[{id:'a',sessionId:'session-a',status:'failed',error:'Original failure'},{id:'b',sessionId:'session-a',status:'succeeded'}];
 const messages=[{id:'1',role:'user',runId:'a',text:'One'},{id:'2',role:'assistant',runId:'a',text:'Reply'},{id:'3',role:'assistant',runId:'a',text:'',tool:{name:'Read',status:'Completed'}},{id:'4',role:'assistant',runId:'b',text:'Two'},{id:'legacy',role:'assistant',text:'Old'}];
 const html=c.messageMarkup(work,'session-a',messages);
 assert.equal((html.match(/data-action="run-details"/g)||[]).length,2);assert.equal((html.match(/data-run-id="a"/g)||[]).length,1);assert.equal((html.match(/data-run-id="b"/g)||[]).length,1);
 assert.doesNotMatch(html,/external/);assert.match(html,/Original failure/);assert.doesNotMatch(html,/Request completed/);
});
test('known unbound Session executions remain explicit records without fabricating message associations',()=>{
 const {c,work}=fixture();work.sessions[0].runs=[{id:'old',sessionId:'session-a',status:'succeeded'}];work.run={id:'other-run',sessionId:'other',status:'running'};
 assert.match(c.unmatchedExecutions(work,'session-a',[{text:'Legacy'}]),/Session executions/);assert.doesNotMatch(c.unmatchedExecutions(work,'session-a',[]),/other-run/);
 assert.equal(c.unmatchedExecutions(work,'session-a',[{runId:'old'}]),'');
});
test('request inspector lists source/state and keeps Run success beneath waiting goal state',()=>{
 const {c,work}=fixture(),request={requestId:'request-a',goal:'Publish report',source:{kind:'service',serviceName:'Reports'},state:'waiting_result',disposition:'live',updatedAt:'now',runIds:['a','b'],waitRef:{kind:'job',id:'job-a',deadlineAt:'tomorrow'},result:'Job submitted'};
 c.adapter.requestPage=()=>({items:[request]});c.view.modal='pi-requests';let html=c.modalMarkup();assert.match(html,/request-inspector/);assert.match(html,/All Work requests/);assert.match(html,/Waiting for result/);assert.doesNotMatch(html,/Unread/);
 c.view.modal='pi-request-detail';c.view.data={requestId:'request-a'};c.adapter.requestDetails.set('work-a:request-a',{request,evidence:{items:[]}});c.adapter.requestResponses.set('work-a:request-a',{runs:[{id:'a',status:'succeeded',source:{kind:'service'},created:'now'},{id:'b',status:'succeeded',source:{kind:'service'},created:'now'}],checked:{},errors:[]});
 html=c.modalMarkup();assert.match(html,/Waiting for result/);assert.match(html,/Chat remains available/);assert.match(html,/<details class="request-executions">/);assert.match(html,/Execution 1/);assert.match(html,/Execution 2/);assert.ok(html.indexOf('Job submitted')<html.indexOf('request-executions'));assert.doesNotMatch(html,/data-action="cancel-run"/);
});
test('request inspector is nonmodal only on a wide viewport; Export stays nonmodal',()=>{
 const {c}=fixture();for(const modal of ['pi-requests','pi-request-detail']){c.view.modal=modal;c.innerWidth=1440;assert.equal(c.nonmodalDialog(),true);c.innerWidth=500;assert.equal(c.nonmodalDialog(),false);}
 c.view.modal='export';assert.equal(c.nonmodalDialog(),true);c.view.modal='stop-work';assert.equal(c.nonmodalDialog(),false);
});
test('precise run focus selectors include run identity',()=>{
 const {c}=fixture();c.CSS={escape:(text:string)=>text};assert.equal(c.focusKey({dataset:{action:'run-details',runId:'old'}}),'[data-action="run-details"][data-run-id="old"]');
});
test('Service selection lists real state without technical ports or Start mutation controls',()=>{
 const {c,work}=fixture();work.services=[{id:'ready',name:'Notes',ports:[3000,3001],enabled:true,observed:'Ready'},{id:'failed',name:'Reports',ports:[4100],enabled:true,observed:'Failed',error:'Start failed'},{id:'disabled',name:'Closed',ports:[5000],enabled:false,observed:'Stopped'},{id:'no-web',name:'Worker',ports:[],observed:'Ready'},{id:'removed',name:'Gone',ports:[80],observed:'Removed'}];c.activeService=()=>work.services[0];c.view.modal='service-picker';const html=c.modalMarkup();
 assert.doesNotMatch(html,/Declared Web ports|3000|3001|4100|5000/);assert.match(html,/aria-selected="true" data-id="ready"/);assert.match(html,/Start failed/);assert.match(html,/Disabled/);assert.doesNotMatch(html,/Worker|Gone|data-action="service-action"/);assert.match(html,/Manage services/);
});

test('confirmed externally started active Run in the selected Session has its own explicit controls',()=>{
 const {c,work}=fixture();c.adapter.cancelAndSendCapabilities.set(work.id,1);c.adapter.activeRuns.set(work.id,{confirmed:true,run:{id:'external-current',sessionId:'session-a',status:'running'}});
 const html=c.unmatchedExecutions(work,'session-a',[{text:'Legacy history without association'}]);
 assert.match(html,/data-action="run-details"[^>]*data-run-id="external-current"/);assert.match(html,/data-action="cancel-run"[^>]*data-run-id="external-current"/);assert.match(html,/Run running/);
 c.adapter.activeRuns.set(work.id,{confirmed:false,run:{id:'unconfirmed',sessionId:'session-a',status:'running'}});assert.equal(c.unmatchedExecutions(work,'session-a',[]),'');
});

test('confirmed empty active slot never exposes cancellation of a stale running history entry',()=>{
 const {c,work}=fixture();c.adapter.cancelAndSendCapabilities.set(work.id,1);work.run={id:'stale',sessionId:'session-a',status:'running'};c.adapter.activeRuns.set(work.id,{confirmed:true,run:null});
 assert.doesNotMatch(c.executionMarkup(work,'session-a','stale'),/data-action="cancel-run"/);assert.match(c.executionMarkup(work,'session-a','stale'),/data-action="run-details"/);
});

test('terminal Request does not present a retained wait reference as current waiting',()=>{
 const {c,work}=fixture();c.view.modal='pi-request-detail';c.view.data={requestId:'done'};c.adapter.requestDetails.set('work-a:done',{request:{requestId:'done',goal:'Done',source:{kind:'chat'},state:'cancelled',disposition:'live',updatedAt:'now',runIds:[],waitRef:{kind:'job',id:'old-job',deadlineAt:'yesterday'}},evidence:{items:[]}});
 const html=c.modalMarkup();assert.match(html,/Cancelled/);assert.doesNotMatch(html,/Waiting for job|Chat remains available/);assert.match(html,/Wait reference/);assert.match(html,/old-job/);
});

for(const width of [1180,500])for(const layout of ['workspace','service-chat','service-only','chat-only'])test(`Chat header has one layout affordance and no browser fullscreen at ${width}px ${layout}`,()=>{
 const {c,work}=fixture();c.innerWidth=width;c.view.layout=layout;c.document={fullscreenElement:null};c.root={};c.activeService=()=>undefined;
 const html=c.agentLayoutControls(work);
 assert.doesNotMatch(html,/data-action="service-fullscreen"/);assert.equal((html.match(/data-action="focus-chat"/g)||[]).length,layout==='chat-only'?0:1);
 if(layout==='chat-only')assert.match(html,/aria-label="Restore layout"/);
 if(layout==='workspace') assert.doesNotMatch(html,/data-action="toggle-workspace-chat"/);
 if(layout==='service-chat' && width===500)assert.match(html,/aria-label="Exit focus"/);
});
for(const menu of ['agent-menu','service-menu'])test(`${menu} makes browser fullscreen a labelled secondary action`,()=>{
 const {c}=fixture();c.view.modal=menu;c.view.layout='service-chat';c.document={fullscreenElement:null};c.root={};
 let html=c.modalMarkup();assert.equal((html.match(/data-action="service-fullscreen"/g)||[]).length,1);assert.match(html,/aria-label="Browser full screen" aria-pressed="false"/);
 c.document.fullscreenElement=c.root;html=c.modalMarkup();assert.match(html,/aria-label="Exit browser full screen" aria-pressed="true"/);
 c.document.fullscreenElement=null;c.view.layout='workspace';assert.doesNotMatch(c.modalMarkup(),/data-action="service-fullscreen"/);
});


test('assistant history and appended streaming prose render Markdown while users and tools stay literal',()=>{
 const {c,work}=fixture();
 const messages=[{id:'u',role:'user',text:'**literal user**'},{id:'a',role:'assistant',text:'## Heading\n\n| A | B |\n| --- | --- |\n| one | two |',source:'/notes.md'}];
 let html=c.messageMarkup(work,'session-a',messages);assert.match(html,/<h2>Heading<\/h2>/);assert.match(html,/<table>/);assert.match(html,/class="message-text">\*\*literal user\*\*/);assert.match(html,/data-action="open-source" data-path="\/notes.md"/);
 messages[1]!.text+='\n| three | four |';html=c.messageMarkup(work,'session-a',messages);assert.match(html,/<td>three<\/td>/);
 const toolHtml=c.messageMarkup(work,'session-a',[{id:'tool',role:'assistant',tool:{id:'t',name:'Read',status:'Completed',content:'<script>bad()</script> **literal**'}}]);assert.match(toolHtml,/&lt;script&gt;/);assert.doesNotMatch(toolHtml,/<script>|<strong>/);
});

test('independent Service options omit Chat and split commands',()=>{
 const {c}=fixture();c.view.modal='service-menu';c.route=()=>['app','work-a','service-a','80'];c.document={fullscreenElement:null};c.root={};const html=c.modalMarkup();assert.doesNotMatch(html,/data-action="(?:focus-chat|reset-workspace-split)"/);assert.match(html,/data-action="manage-services"/);
});

test('narrow service-chat remains visible before resize can add the local narrow-chat class',()=>{
 const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');assert.match(css,/\.service-focused\[data-layout="service-chat"\] \.work-layout\.service-workspace > \.agent-side,[\s\S]*?display:block/);assert.doesNotMatch(css,/\.service-focused\[data-layout="service-only"\][^}]*display:block/);
});

test('an associated Run reply in request detail renders constrained file links for its Work', () => {
  const { c, work } = fixture();
  const request = { requestId: 'request-file', goal: 'Publish report', source: { kind: 'chat' }, state: 'succeeded',
    disposition: 'live', updatedAt: 'now', runIds: ['a'], result: 'Done' };
  c.view.modal = 'pi-request-detail'; c.view.data = { requestId: 'request-file', source: 'chat' };
  c.adapter.requestDetails.set('work-a:request-file', { request, evidence: { items: [] } });
  c.adapter.requestResponses.set('work-a:request-file', { runs: [{ id: 'a', status: 'succeeded', source: { kind: 'chat' },
    created: 'now', finalText: 'Current: [报告.txt](piwork-file:/output/%E6%8A%A5%E5%91%8A.txt) and [bad](piwork-file://host/a.txt).' }], checked: {}, errors: [] });
  const html = c.modalMarkup();
  assert.match(html, /class="request-text chat-markdown"/);
  assert.match(html, /class="chat-file-link" href="#\/work\/work-a\/files\/%2Foutput%2F%E6%8A%A5%E5%91%8A\.txt" data-path="\/output\/报告\.txt"/);
  assert.doesNotMatch(html, /target="_blank"/);
  assert.doesNotMatch(html, /piwork-file:\/\/host/);
  assert.equal(work.id, 'work-a');
});
