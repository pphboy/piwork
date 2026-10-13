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
 const c:any={innerWidth:1440,view:{modal:'',data:{},session:'session-a',tab:'Services',service:'',port:3000,layout:'workspace'},adapter:{identityEpoch:7,runDetails:new Map(),activeRuns:new Map(),requestReadErrors:new Map(),requestDetails:new Map(),requestResponses:new Map(),requestRetries:new Map(),getWork:()=>work,project:()=>({usable:true}),requestPage:()=>undefined,requestCancellation:()=>undefined},current:()=>work,route:()=>['work','work-a'],activityGroups,executionAnchors,expandedActivity:new Map(),historyImageMarkup:()=>'',requestNavigationCurrent:()=>false,requestCancellable:()=>false};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const esc ='),source.indexOf('let view =')),c);
 vm.runInContext(extract('isRequestInspector','nonmodalDialog','requestStateLabel','modelDisplayName','runFacts','executionMarkup','unmatchedExecutions','messageMarkup','modalMarkup','focusKey'),c);return {c,work};
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
test('Service selection lists real state and ports without Start mutation controls',()=>{
 const {c,work}=fixture();work.services=[{id:'ready',name:'Notes',ports:[3000,3001],enabled:true,observed:'Ready'},{id:'failed',name:'Reports',ports:[4100],enabled:true,observed:'Failed',error:'Start failed'},{id:'disabled',name:'Closed',ports:[5000],enabled:false,observed:'Stopped'},{id:'no-web',name:'Worker',ports:[],observed:'Ready'},{id:'removed',name:'Gone',ports:[80],observed:'Removed'}];c.activeService=()=>work.services[0];c.view.modal='service-picker';const html=c.modalMarkup();
 assert.match(html,/Declared Web ports · 3000, 3001/);assert.match(html,/aria-checked="true" data-id="ready"/);assert.match(html,/Start failed/);assert.match(html,/Disabled/);assert.doesNotMatch(html,/Worker|Gone|data-action="service-action"/);assert.match(html,/Manage services/);
});
