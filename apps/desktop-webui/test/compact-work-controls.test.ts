import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../browser/app.js',import.meta.url),'utf8');
function extract(...names:string[]){return names.map(name=>{const value=source.match(new RegExp('^(?:async )?function '+name+'\\([\\s\\S]*?^}', 'm'));assert.ok(value,name);return value[0];}).join('\n');}
function fixture(){
 const work:any={id:'work-a',name:'A',config:{pendingApply:false,skills:[],packages:[]},resourceChecked:{configuration:'now'},resourceErrors:{}};
 const c:any={structuredClone,location:{hash:'#/work/work-a'},Date,view:{file:'',path:'/',modal:'',data:{},settingsTab:'Skills',config:null,configDirty:false},actions:{records:new Map(),visible:()=>true},adapter:{state:{operations:[]},project:()=>({usable:true})},skillsSettings:()=>'<p>Skills</p>'};c.fileActionsContext="";vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const esc ='),source.indexOf('let view =')),c);vm.runInContext(extract('fileRefreshButton','settingsPage'),c);return{c,work};
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
 assert.doesNotMatch(modal,/case "file-add"/);assert.doesNotMatch(modal,/case "file-options"/);assert.match(modal,/Role: /);assert.match(modal,/Administrator/);assert.match(modal,/Core: /);
});

test('Settings checks the exact latest accepted Apply rather than an older array entry',()=>{
 const {c,work}=fixture();work.config.pendingApply=true;
 c.adapter.state.operations=[{id:'latest',workId:'work-a',kind:'Apply configuration',state:'running',created:'2026-10-13T15:00:00Z'},{id:'old',workId:'work-a',kind:'Apply configuration',state:'failed',error:'Older failure',created:'2026-10-13T14:00:00Z'}];
 c.actions.records.set('apply',{work:'work-a',action:'apply-config',token:2,businessId:'latest',pending:false});
 let html=c.settingsPage(work);assert.match(html,/Applying/);assert.match(html,/data-action="operation"[^>]*data-id="latest"/);assert.doesNotMatch(html,/Older failure|data-action="apply-config"/);
 c.actions.records.clear();c.adapter.state.operations.reverse();html=c.settingsPage(work);assert.match(html,/data-id="latest"/);assert.doesNotMatch(html,/Older failure/);
});

for (const kind of ['Apply Work configuration','apply-work-configuration']) test(`Settings preserves recovered ${kind} progress and checking`,()=>{
 const {c,work}=fixture();work.config.pendingApply=true;
 c.adapter.state.operations=[{id:'recovered-apply',workId:'work-a',kind,state:'running',created:'2026-10-13T15:00:00Z'}];
 const html=c.settingsPage(work);assert.match(html,/Applying/);assert.match(html,/Check Apply/);assert.match(html,/data-action="operation"[^>]*data-id="recovered-apply"/);assert.doesNotMatch(html,/data-action="apply-config"/);
});

test('Files toolbar renders one Refresh and Add control without literal template punctuation',()=>{
 const {c,work}=fixture();work.files=[];c.adapter.directories=new Map();c.view.selected=[];c.view.path='/';c.filesRestoreNotice='';c.uploadProgressMarkup=()=>'';c.transferResults=()=>'';
 vm.runInContext(extract('files'),c);const html=c.files(work);
 assert.equal((html.match(/data-action="refresh-files"/g)||[]).length,1);assert.equal((html.match(/data-action="file-add"/g)||[]).length,1);assert.doesNotMatch(html,/<\/button>}/);assert.match(html,/data-action="upload"/);assert.match(html,/data-action="webdav"/);
});

test('unknown Apply without an accepted ID never checks an unrelated old Operation',()=>{
 const {c,work}=fixture();work.config.pendingApply=true;
 c.adapter.state.operations=[{id:'old-finished',workId:'work-a',kind:'Apply Work configuration',state:'succeeded',created:'2026-10-13T14:00:00Z'}];
 c.actions.records.set('apply',{work:'work-a',action:'apply-config',token:3,blocked:true,pending:false});
 const html=c.settingsPage(work);assert.match(html,/Apply not confirmed/);assert.match(html,/data-action="refresh-config"/);assert.doesNotMatch(html,/old-finished|Check Apply|data-action="apply-config"/);
});

test('Settings separates Back navigation from one aligned title/status action row',()=>{
 const {c,work}=fixture();const html=c.settingsPage(work);
 assert.match(html,/<div class="settings-navigation">[\s\S]*?Back to Work<\/button><\/div><div class="settings-heading"><h1>Work settings<\/h1><div class="configuration-compact">/);
 assert.doesNotMatch(html,/configuration-details-copy|<summary>Details<\/summary>|Saved and active configuration are aligned|Save and Apply are separate actions/);
 const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
 assert.match(css,/\.settings-heading \{ align-items:center; \}/);assert.match(css,/\.configuration-compact \{ display:flex;align-items:center;gap:8px;flex:none/);
 assert.doesNotMatch(css,/\.configuration-compact details \{ flex-basis:100%/);assert.match(css,/@media\(max-width:600px\) \{\s+\.settings-heading \{ flex-direction:column;align-items:flex-start/);assert.match(css,/\.configuration-compact details \{ position:static; \}/);assert.match(css,/\.configuration-details-copy \{ left:0;right:auto; \}/);
});

test('Files toolbar retains 40px actions at the narrow breakpoint in either selection state',()=>{
 const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
 assert.match(css,/\.icon-button \{\s+width: 40px;\s+height: 40px;/);
 assert.doesNotMatch(css,/\.files-toolbar \.icon-button\s*\{/);
 const {c,work}=fixture();work.files=[];c.adapter.directories=new Map();c.view.selected=[];c.view.path='/';c.filesRestoreNotice='';c.uploadProgressMarkup=()=>'';c.transferResults=()=>'';vm.runInContext(extract('files'),c);
 assert.match(c.files(work),/data-action="file-add"/);c.view.selected=['/A.txt'];const selected=c.files(work);for(const action of ['file-copy','file-move','file-delete','clear-selection'])assert.match(selected,new RegExp('data-action="'+action+'"'));assert.doesNotMatch(selected,/data-action="file-add"/);
});

for(const open of [false,true])test(`Files add is a nonmodal two-action menu: open=${open}`,()=>{
 const {c,work}=fixture();c.fileActionsContext=open?'context':'';work.files=[];c.adapter.directories=new Map();c.view.selected=[];c.filesRestoreNotice='';c.uploadProgressMarkup=()=>'';c.transferResults=()=>'';
 vm.runInContext(extract('files'),c);const html=c.files(work);assert.match(html,/aria-haspopup="menu"/);assert.match(html,new RegExp('aria-expanded="'+open+'"'));assert.doesNotMatch(html,/<dialog/);
 if(open){assert.match(html,/role="menu" aria-label="Add to workspace"/);assert.equal((html.match(/role="menuitem"/g)||[]).length,2);assert.match(html,/New folder/);assert.match(html,/Upload files/);}else assert.doesNotMatch(html,/role="menu"/);
});
for(const width of [500,1440])for(const visible of [false,true])test(`Chat toggle is the same panel button at ${width}px visible=${visible}`,()=>{
 const {c,work}=fixture();c.view.tab='Services';c.view.layout='workspace';c.route=()=>['work'];c.innerWidth=width;c.workspacePanels={get:()=>({narrowChat:visible,collapsed:!visible})};
 vm.runInContext(extract('layoutButton','workspaceChatToggle'),c);const html=c.workspaceChatToggle(work);assert.match(html,/class="button icon-button quiet"/);assert.match(html,new RegExp('aria-label="'+(visible?'Hide':'Show')+' chat"'));assert.match(html,new RegExp('aria-expanded="'+visible+'"'));assert.match(html,/aria-controls="workspace-chat"/);assert.doesNotMatch(html,/m10 5-7 7 7 7/);
});
test('Chat toggle has one stable Service header slot and no Work navigation or Agent duplicate',()=>{
 assert.equal((extract('services').match(/workspaceChatToggle\(w\)/g)||[]).length,1);assert.doesNotMatch(extract('workPage','agentLayoutControls'),/workspaceChatToggle|toggle-workspace-chat/);
});
test('Input options launches a dialog while its checkbox owns the actual option state',()=>{
 const agent=extract('agent');assert.match(agent,/aria-label="Input options" aria-haspopup="dialog" aria-expanded=/);assert.doesNotMatch(agent,/aria-label="Input options" aria-pressed=/);assert.match(extract('modalMarkup'),/id="include-identity" type="checkbox"/);
});
test('Move selected files uses a dedicated folder move symbol instead of Back',()=>{
 assert.match(extract('files'),/icon\("move", 16\), "file-move"/);assert.doesNotMatch(extract('files'),/icon\("arrow", 16\), "file-move"/);
});
