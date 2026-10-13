import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../browser/app.js',import.meta.url),'utf8');
function extract(...names:string[]){return names.map(name=>{const value=source.match(new RegExp('^(?:async )?function '+name+'\\([\\s\\S]*?^}', 'm'));assert.ok(value,name);return value[0];}).join('\n');}
function fixture(){
 const work:any={id:'work-a',name:'A',config:{pendingApply:false,skills:[],packages:[]},resourceChecked:{configuration:'now'},resourceErrors:{}};
 const c:any={structuredClone,location:{hash:'#/work/work-a'},Date,view:{file:'',path:'/',modal:'',data:{},settingsTab:'Skills',config:null,configDirty:false},actions:{records:new Map(),visible:()=>true},adapter:{state:{operations:[]},project:()=>({usable:true})},skillsSettings:()=>'<p>Skills</p>'};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const esc ='),source.indexOf('let view =')),c);vm.runInContext(extract('fileRefreshButton','settingsPage'),c);return{c,work};
}
test('Files refresh uses a fixed button for busy and one Updated feedback; unrelated paths do not leak status',()=>{
 const {c,work}=fixture();let html=c.fileRefreshButton(work);assert.match(html,/>Refresh</);assert.doesNotMatch(html,/Updated|aria-busy/);
 const record={action:'refresh-files',work:'work-a',resource:'/',view:c.location.hash,token:1,started:Date.now(),pending:true};c.actions.records.set('read',record);html=c.fileRefreshButton(work);assert.match(html,/aria-busy="true"/);assert.match(html,/Reading…/);
 record.pending=false;html=c.fileRefreshButton(work);assert.match(html,/Updated/);assert.doesNotMatch(html,/Status checked/);
 c.view.path='/different';assert.doesNotMatch(c.fileRefreshButton(work),/Updated/);
});
test('normal settings are compact; dirty, pending Apply, Applying and errors retain actual actions',()=>{
 const {c,work}=fixture();let html=c.settingsPage(work);assert.match(html,/configuration-compact/);assert.doesNotMatch(html,/class="configuration-state"|data-action="apply-config"/);assert.ok(html.indexOf('Back to Work')<html.indexOf('<h1>Work settings'));
 c.view.configDirty=true;html=c.settingsPage(work);assert.match(html,/Unsaved changes/);assert.match(html,/data-action="save-config"/);assert.doesNotMatch(html,/data-action="apply-config"/);
 c.view.configDirty=false;work.config.pendingApply=true;html=c.settingsPage(work);assert.match(html,/Not applied/);assert.match(html,/data-action="apply-config"/);
 c.adapter.state.operations=[{id:'apply-a',workId:'work-a',kind:'Apply configuration',state:'running'}];html=c.settingsPage(work);assert.match(html,/Applying/);assert.match(html,/Check Apply/);assert.doesNotMatch(html,/data-action="apply-config"/);
 c.adapter.state.operations[0].state='failed';c.adapter.state.operations[0].error='Model busy';html=c.settingsPage(work);assert.match(html,/Apply failed/);assert.match(html,/Model busy/);
 c.adapter.state.operations[0].state='unknown';html=c.settingsPage(work);assert.match(html,/Apply not confirmed/);assert.doesNotMatch(html,/data-action="apply-config"/);
});
test('Works icon actions retain labels; Files add menu and Admin role keep explicit context',()=>{
 const works=extract('works'),modal=extract('modalMarkup');assert.match(works,/title="Refresh Works" aria-label="Refresh Works"/);assert.match(works,/title="Import Work" aria-label="Import Work"/);assert.match(works,/title="New Work" aria-label="New Work"/);assert.match(works,/Make room for your next idea/);
 assert.match(modal,/case "file-add"/);assert.doesNotMatch(modal,/case "file-options"/);assert.match(modal,/Role: /);assert.match(modal,/Administrator/);assert.match(modal,/Core: /);
});
