import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../browser/app.js',import.meta.url),'utf8');
function extract(...names:string[]){return names.map(name=>{const value=source.match(new RegExp('^(?:async )?function '+name+'\\([\\s\\S]*?^}', 'm'));assert.ok(value,name);return value[0];}).join('\n');}
function fixture(){
 const work:any={id:'work-a',name:'A',config:{pendingApply:false,skills:[],packages:[]},resourceChecked:{configuration:'now'},resourceErrors:{}};
 const c:any={structuredClone,location:{hash:'#/work/work-a'},Date,view:{file:'',path:'/',modal:'',data:{},settingsTab:'Skills',config:null,configDirty:false},actions:{records:new Map(),visible:()=>true},adapter:{directories:new Map(),state:{operations:[]},project:()=>({usable:true})},skillsSettings:()=>'<p>Skills</p>'};c.fileActionsContext="";vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const esc ='),source.indexOf('let view =')),c);vm.runInContext(extract('fileRefreshButton','settingsPage'),c);return{c,work};
}
test('Files refresh keeps a fixed icon with scoped busy feedback and no success text',()=>{
 const {c,work}=fixture();let html=c.fileRefreshButton(work);assert.match(html,/icon-button quiet file-refresh/);assert.doesNotMatch(html,/>Refresh<|Updated|aria-busy|<span>/);
 const record={action:'refresh-files',work:'work-a',resource:'/',view:c.location.hash,token:1,started:Date.now(),pending:true};c.actions.records.set('read',record);html=c.fileRefreshButton(work);assert.match(html,/aria-disabled="true" aria-busy="true"/);assert.match(html,/Reading files/);
 record.started-=11000;assert.match(c.fileRefreshButton(work),/Still reading files/);
 record.pending=false;html=c.fileRefreshButton(work);assert.doesNotMatch(html,/Updated|Status checked|aria-busy|aria-disabled/);
 record.pending=true;c.view.path='/different';assert.doesNotMatch(c.fileRefreshButton(work),/aria-busy/);
 c.adapter.directories.set('work-a:/different',{loading:true,checkedAt:'now',error:''});assert.match(c.fileRefreshButton(work),/aria-busy="true"/);
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
 const works=extract('works'),modal=extract('modalMarkup');assert.match(works,/worksRefreshButton\(\)/);assert.match(extract('worksRefreshButton'),/Refresh Works/);assert.match(works,/title="Import Work" aria-label="Import Work"/);assert.match(works,/title="New Work" aria-label="New Work"/);assert.match(works,/Make room for your next idea/);
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
 const {c,work}=fixture();work.files=[];c.adapter.directories=new Map([['work-a:/',{checkedAt:'now',loading:false,error:''}]]);c.view.selected=[];c.view.path='/';c.filesRestoreNotice='';c.uploadProgressMarkup=()=>'';c.transferResults=()=>'';
 vm.runInContext(extract('files'),c);const html=c.files(work);
 assert.equal((html.match(/data-action="refresh-files"/g)||[]).length,1);assert.equal((html.match(/data-action="file-add"/g)||[]).length,1);assert.doesNotMatch(html,/<\/button>}/);assert.match(html,/data-action="upload"/);assert.doesNotMatch(html,/file-scope|Shared workspace|\/var\/data\/workspace/);
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
 const {c,work}=fixture();work.files=[];c.adapter.directories=new Map([['work-a:/',{checkedAt:'now',loading:false,error:''}]]);c.view.selected=[];c.view.path='/';c.filesRestoreNotice='';c.uploadProgressMarkup=()=>'';c.transferResults=()=>'';vm.runInContext(extract('files'),c);
 assert.match(c.files(work),/data-action="file-add"/);c.view.selected=['/A.txt'];const selected=c.files(work);for(const action of ['file-copy','file-move','file-delete','clear-selection'])assert.match(selected,new RegExp('data-action="'+action+'"'));assert.doesNotMatch(selected,/data-action="file-add"/);
});

for(const open of [false,true])test(`Files add is a nonmodal command menu: open=${open}`,()=>{
 const {c,work}=fixture();c.fileActionsContext=open?'context':'';work.files=[];c.adapter.directories=new Map([['work-a:/',{checkedAt:'now',loading:false,error:''}]]);c.view.selected=[];c.filesRestoreNotice='';c.uploadProgressMarkup=()=>'';c.transferResults=()=>'';
 vm.runInContext(extract('files'),c);const html=c.files(work);assert.match(html,/aria-haspopup="menu"/);assert.match(html,new RegExp('aria-expanded="'+open+'"'));assert.doesNotMatch(html,/<dialog/);
 if(open){assert.match(html,/role="menu" aria-label="File actions"/);assert.equal((html.match(/role="menuitem"/g)||[]).length,3);assert.match(html,/data-action="webdav"/);assert.match(html,/role="separator"/);assert.match(html,/New folder/);assert.match(html,/Upload files/);}else assert.doesNotMatch(html,/role="menu"/);
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

test('Files first reads preserve toolbar and never mistake another cached directory for confirmed empty',()=>{
 const {c,work}=fixture();work.files=[{path:'/other/old.txt',name:'old.txt',kind:'directory'}];c.view.selected=[];c.filesRestoreNotice='';c.uploadProgressMarkup=()=>'';c.transferResults=()=>'';vm.runInContext(extract('files'),c);
 c.adapter.directories.set('work-a:/',{loading:true,checkedAt:'',error:''});let html=c.files(work);assert.match(html,/files-toolbar/);assert.match(html,/read-placeholder/);assert.doesNotMatch(html,/This folder is empty|old.txt/);
 c.adapter.directories.set('work-a:/',{loading:false,checkedAt:'',error:'Forbidden'});html=c.files(work);assert.match(html,/Could not read \/|Forbidden/);assert.doesNotMatch(html,/This folder is empty|read-placeholder/);assert.equal((html.match(/read-failure/g)||[]).length,1);
 c.adapter.directories.set('work-a:/',{loading:true,checkedAt:'now',error:''});html=c.files(work);assert.match(html,/This folder is empty/);assert.doesNotMatch(html,/read-placeholder/);
 c.view.path='/other';c.adapter.directories.set('work-a:/other',{loading:true,checkedAt:'now',error:''});work.resourceErrors.files='Unrelated root error';html=c.files(work);assert.match(html,/old.txt/);assert.doesNotMatch(html,/Unrelated root error|read-placeholder/);
 c.view.selected=['/other/old.txt'];html=c.files(work);assert.match(html,/checked/);assert.match(html,/1 selected/);assert.match(html,/old.txt/);
});

test('Files keeps mixed/unknown path evidence but removes all-success result clutter',()=>{
 const {c,work}=fixture();c.current=()=>work;c.adapter.transfersByWork=new Map();
 vm.runInContext(extract('transferResults'),c);
 for(const rows of [[],[{path:'/done',status:'succeeded',message:'Confirmed'}]]) {
  c.adapter.transfersByWork.set(work.id,rows);assert.equal(c.transferResults(),'');
 }
 c.adapter.transfersByWork.set(work.id,[{path:'/done',status:'succeeded',message:'Confirmed'},{path:'/unknown',status:'unknown',message:'Check original target'}]);
 const html=c.transferResults();assert.match(html,/\/done/);assert.match(html,/\/unknown/);assert.match(html,/Refresh to verify target/);
});

test('file success marker requires nonempty all-confirmed results and leaves original unknown lock intact',()=>{
 const {c}=fixture();const record:any={blocked:true};c.actions.current=(r:any)=>r===record;c.actions.confirm=()=>{};
 vm.runInContext(extract('confirmFileAttempt'),c);
 for(const results of [[],[{status:'failed'}],[{status:'succeeded'},{status:'unknown'}]]) {
  c.confirmFileAttempt(record,results);assert.equal(record.successFeedback,undefined);assert.equal(record.blocked,true);
 }
 c.confirmFileAttempt(record,[{status:'succeeded'}]);assert.equal(record.successFeedback,'toast');assert.equal(record.blocked,true);
});

test('success Toast really auto-dismisses after three seconds and replacement clears the previous timer',()=>{
 const {c}=fixture();let tick:()=>void=()=>{},delay=0,cleared=0,renders=0;
 c.render=()=>renders++;c.clearTimeout=()=>cleared++;c.setTimeout=(fn:()=>void,ms:number)=>{tick=fn;delay=ms;return 1;};
 vm.runInContext('let toastTimer;'+extract('toast'),c);
 c.toast('Folder created.');assert.equal(c.view.toast,'Folder created.');assert.equal(delay,3000);
 c.toast('Upload complete.');assert.equal(cleared,2);assert.equal(c.view.toast,'Upload complete.');tick();assert.equal(c.view.toast,'');assert.equal(renders,3);
});

test('Packages aligns identity/status separately from commands and groups catalog actions',()=>{
 const {c,work}=fixture();c.catalogFeedback=()=>'';c.packageStatus=()=> 'Saved · Loaded';
 c.adapter.catalog={packages:{error:'',confirmed:true}};c.adapter.getPackages=()=>[{name:'catalog-package',description:'A long package description',version:'1.0'}];
 vm.runInContext(extract('packagesSettings'),c);
 const config={packages:[{name:'a-very-long-package-name',source:'https://example.test/'+ 'long/'.repeat(30),enabled:true}]};
 const html=c.packagesSettings(work,config);
 assert.match(html,/class="capability package-capability"/);assert.match(html,/class="package-copy"/);
 assert.match(html,/class="package-status">[\s\S]*?Saved · Loaded<\/span><\/div><div class="package-actions">/);
 assert.match(html,/<h3>Available from Core<\/h3><div class="catalog-actions">/);
 for(const action of ['package-detail','toggle-package','update-package','remove-package']) assert.match(html,new RegExp(`data-action="${action}"[^>]*data-id="a-very-long-package-name"`));
 assert.match(html,/class="button small danger"[^>]*data-action="remove-package"/);
 assert.match(html,/data-action="select-package"[^>]*data-id="catalog-package"/);
 c.adapter.catalog.packages.confirmed=false;assert.match(c.packagesSettings(work,config),/data-action="select-package"[^>]*disabled/);
 config.packages[0]!.enabled=false;assert.match(c.packagesSettings(work,config),/>Enable<\/button>/);
 const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
 assert.match(css,/\.package-capability \{ display:grid;grid-template-columns:36px minmax\(0,1fr\) auto/);
 assert.match(css,/\.package-copy \{ min-width:0;flex:1;overflow-wrap:anywhere/);
 assert.match(css,/\.package-status,.package-actions \{ grid-column:2; \}/);
});

for(const hasRows of [true,false]) test(`Works refresh preserves confirmed ${hasRows?'rows':'empty list'} with only in-place busy`,()=>{
 const {c,work}=fixture();c.view.search='';c.topbar=()=>'';c.connection=()=>'';c.workStatus=()=>'';c.quickAction=()=>'';c.controlMarkup=()=>'';c.workControls=new Map();
 Object.assign(c.adapter,{worksLoading:true,worksChecked:'now',worksError:'',state:{scenario:'loading',works:hasRows?[work]:[],core:{account:'user'}}});
 vm.runInContext(extract('worksRefreshButton','works'),c);
 let html=c.works();assert.doesNotMatch(html,/loading-list|Loading your Works/);assert.match(html,/data-read-busy="true"/);assert.match(html,hasRows?/work-table/:/Make room for your next idea/);
 c.adapter.worksLoading=false;c.adapter.state.scenario='normal';html=c.works();assert.doesNotMatch(html,/aria-busy|Updated|Status checked/);
 c.adapter.worksError='Read failed';c.adapter.state.scenario='list-error';html=c.works();assert.match(html,/Read failed/);assert.match(html,hasRows?/work-table/:/Make room for your next idea/);
});

test('Works first load uses skeleton, first failure is never an empty list, and cached search is retained',()=>{
 const {c,work}=fixture();c.view.search='';c.topbar=()=>'';c.connection=()=>'';c.workStatus=()=>'';c.quickAction=()=>'';c.controlMarkup=()=>'';c.workControls=new Map();
 Object.assign(c.adapter,{worksLoading:true,worksChecked:'',worksError:'',state:{scenario:'loading',works:[],core:{account:'user'}}});
 vm.runInContext(extract('worksRefreshButton','works'),c);
 assert.match(c.works(),/loading-list/);
 const loading=c.works().match(/<div class="loading-list"[\s\S]*?<\/div><div class="works-footer"/)?.[0];assert.ok(loading);assert.match(loading,/aria-label="Loading your Works" aria-busy="true"/);assert.equal(loading.replace(/<div class="works-footer"$/,'').replace(/<[^>]*>/g,''),'');assert.doesNotMatch(loading,/data-action="check-connection"/);
 c.adapter.worksLoading=false;c.adapter.worksError='No response';c.adapter.state.scenario='list-error';let html=c.works();assert.match(html,/Works could not be loaded/);assert.doesNotMatch(html,/Make room for your next idea|No matching Works/);
 c.adapter.state.works=[work];c.adapter.worksLoading=true;c.view.search='missing';html=c.works();assert.match(html,/value="missing"/);assert.match(html,/No matching Works/);assert.doesNotMatch(html,/loading-list/);
});

test('aria-disabled read refresh rejects direct dispatch before action submission',async()=>{
 const c:any={actionIntent:()=>undefined};vm.createContext(c);vm.runInContext(extract('dispatchAction'),c);let calls=0;await c.dispatchAction({getAttribute:()=> 'true'},async()=>calls++);assert.equal(calls,0);
 assert.match(source,/el.getAttribute\("aria-disabled"\) === "true"/);
});
