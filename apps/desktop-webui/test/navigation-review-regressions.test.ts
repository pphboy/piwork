const { localeSandbox } = await import(new URL('./locale-sandbox.js', import.meta.url).href);
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// App-function integration tests without a browser/socket. DOM geometry and real
// history event ordering remain browser QA. PIWORK_APP_PATH enables red/green runs.
const source = readFileSync(process.env.PIWORK_APP_PATH || new URL('../browser/app.js', import.meta.url), 'utf8');
const navigation = await import(new URL('../browser/work-navigation.js', import.meta.url).href);
const { operationKind } = await import(new URL('../browser/operation-recovery.js', import.meta.url).href);
const fileReference = await import(new URL('../browser/file-reference.js', import.meta.url).href);
function extract(names: string[]) {
  return names.map(name => {
    const match = source.match(new RegExp('^(?:async )?function ' + name + '\\([\\s\\S]*?^}', 'm'));
    assert.ok(match, `compiled app function ${name} exists`); return match[0];
  }).join('\n');
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  const work: any = { id: 'one', name: 'One', services: [{ id: 'service-a', enabled: false, observed: 'Stopped' }], files: [], resourceErrors: {} };
  const c: any = {
  ...localeSandbox,
    view: { tab: 'Files', path: '/x/y', file: '', fileDraft: '', fileOriginal: '', configDirty: false, data: {}, modal: '' },
    location: { hash: '#/work/one' }, modalChoice: 0, fileChoice: 0, areaChoice: 0, serviceChoice: 0, sessionChoice: 0,
    selectionWorkId: 'one', routeLoad: 0, workspaceReturn: undefined, workSelections: new Map(), filesRestoreNotice: '',
    lastRoute: '#/work/one', serviceControls: new Map(), workControls: new Map(), importStarts: new Map(),
    adapter: { coreGate: {blocked:false}, identityEpoch: 1, state: { signedIn: true, operations: [] }, project: () => ({ usable: true, action: 'start' }), getWork: () => work, getOperation: () => undefined },
    actions: { records: new Map(), begin: () => undefined, current: () => true, review: (r: any) => { r.blocked = false; } },
    render: () => {}, toast: () => {}, openModal: () => {}, activeService: () => work.services[0], current: () => work, targetWork: () => work,
    ViewChanged: class extends Error {}, URLSearchParams,
    restoreSelection: navigation.restoreSelection, initialWorkArea: navigation.initialWorkArea, exitWorkspaceFocus: async () => true,
    parentDirectory: navigation.parentDirectory, operationKind, isFilesRoute: fileReference.isFilesRoute, filesRouteTarget: fileReference.filesRouteTarget,
    fileSourceReturn: undefined, clearFileTarget: () => { c.view.file = ''; c.view.fileStatus = 'idle'; }, openFile: async () => undefined,
    workReadErrors: new Map(),
  };
  c.route = () => c.location.hash.replace(/^#\/?/, '').split('/');
  c.viewKey = () => `${c.location.hash}:${c.modalChoice}:${c.view.tab}:${c.view.path}:${c.view.file}`;
  c.dirty = () => c.view.file && c.view.fileDraft !== c.view.fileOriginal;
  c.guard = async (next: () => unknown) => { await next(); };
  vm.createContext(c); return { c, work };
}

test('C review: popstate protects the original unsaved file before loadRoute clears selection', () => {
  const { c } = fixture();
  c.view.file = '/draft.txt'; c.view.fileDraft = 'unsaved'; c.view.fileOriginal = 'saved';
  c.location.hash = '#/work/two';
  c.adapter.loadWork = () => new Promise(() => {});
  c.history = { replaceState: (_state: unknown, _title: string, hash: string) => { c.location.hash = hash; } };
  let guards = 0;
  c.guard = async (_next: () => unknown) => { guards++; };
  c.window = { addEventListener: (_name: string, callback: () => void) => { c.onPopstate = callback; } };
  vm.runInContext(extract(['loadRoute']), c);
  if (source.includes("window.addEventListener('popstate', handleRouteNavigation)")) {
    vm.runInContext(extract(['handleRouteNavigation']), c);
    vm.runInContext("window.addEventListener('popstate', handleRouteNavigation);", c);
  } else {
    const old = source.match(/window\.addEventListener\('popstate',[\s\S]*?\}\);/);
    assert.ok(old, 'a real popstate listener is present'); vm.runInContext(old[0], c);
  }
  c.onPopstate();
  assert.equal(c.view.file, '/draft.txt'); assert.equal(c.view.fileDraft, 'unsaved');
  assert.equal(guards, 1); assert.equal(c.location.hash, '#/work/one');
});

test('C review: older directory response cannot make the newer directory choice fail', async () => {
  const { c } = fixture(), older = deferred(), newer = deferred();
  c.adapter.loadDirectory = (_work: string, path: string) => path === '/x' ? older.promise : newer.promise;
  vm.runInContext(extract(['handleAction']), c);
  const oldRequest = c.handleAction('file-path', { dataset: { path: '/x' } }).catch(() => {});
  const newRequest = c.handleAction('file-path', { dataset: { path: '/' } }).catch(() => {});
  older.resolve(); await oldRequest; newer.resolve(); await newRequest;
  assert.equal(c.view.path, '/'); assert.equal(c.view.file, '');
});

test('C review: explicit exact-Service Ready read releases unknown Start for a later explicit control', async () => {
  const { c, work } = fixture(); let posts = 0;
  c.adapter.operateService = async () => { posts++; if (posts === 1) throw Object.assign(new Error('Lost Start receipt'), { code: 'RESULT_UNKNOWN' }); return { id: 'stop-original', workId: 'one', state: 'accepted' }; };
  c.adapter.loadServices = async () => { work.services[0].enabled = true; work.services[0].observed = 'Ready'; };
  vm.runInContext(extract(['serviceOperations', 'serviceControl', 'serviceControlBlocked', 'handleAction', 'submitServiceControl']), c);
  await assert.rejects(c.submitServiceControl(work, 'service-a', 'start'));
  assert.equal(c.serviceControls.get('one:service-a').phase, 'unknown');
  await c.handleAction('check-service-progress', { dataset: { id: 'one', serviceId: 'service-a' } });
  assert.equal(c.serviceControls.get('one:service-a').phase, 'reviewed');
  await c.submitServiceControl(work, 'service-a', 'stop'); assert.equal(posts, 2);
});

test('C review: an older awaited focus exit cannot overwrite a newer Work selection shell', async () => {
  const { c } = fixture(), exit = deferred();
  const second: any = { id: 'two', services: [], sessions: [], config: {} };
  c.selectionWorkId = 'one'; c.location.hash = '#/work/one/settings';
  c.exitWorkspaceFocus = () => exit.promise;
  c.adapter.loadWork = async (id: string) => ({ ...second, id });
  c.activeService = () => undefined;
  c.workSelections.set('two', { area: 'Chat', path: '/two', file: '', service: '', port: 0, session: '' });
  vm.runInContext(extract(['loadRoute']), c);
  const oldRoute = c.loadRoute();
  c.location.hash = '#/work/two';
  await c.loadRoute();
  assert.equal(c.selectionWorkId, 'two'); assert.equal(c.view.tab, 'Chat');
  exit.resolve(); await oldRoute;
  assert.equal(c.selectionWorkId, 'two'); assert.equal(c.view.tab, 'Chat'); assert.equal(c.view.path, '/two');
});

test('C review: ordinary Work Start stays in place and retains the original operation', async () => {
  const { c, work } = fixture(); let starts = 0, opens = 0;
  c.adapter.lifecycle = async (id: string) => { starts++; return { id: 'start-original', workId: id, state: 'accepted' }; };
  c.adapter.loadWork = async () => work; c.openWork = async () => { opens++; };
  vm.runInContext(extract(['submitWorkStart']), c);
  await c.submitWorkStart(work);
  assert.equal(starts, 1); assert.equal(opens, 0); assert.equal(c.location.hash, '#/work/one');
  assert.equal(c.workControls.get('one').operationId, 'start-original');
});

for (const abandon of ['', 'close', 'new selection']) test(`C review: Import Start remains one exact intent and auto-opens only when ready (${abandon || 'stay'})`, async () => {
  const { c, work } = fixture(); let starts = 0; const opened: string[] = [];
  const exits = await import(new URL('../browser/completion-exits.js', import.meta.url).href);
  const imported = { id: 'import-original', workId: 'one', kind: 'Import Work', state: 'succeeded' };
  const started = { id: 'start-original', workId: 'one', state: 'accepted' };
  work.status = 'Stopped'; work.desired = 'stopped'; c.location.hash = '#/works';
  c.view.modal = 'operation'; c.view.data = { id: imported.id };
  c.adapter.project = () => ({ action: work.status === 'Stopped' ? 'start' : 'stop', usable: work.status === 'Ready' });
  c.adapter.getOperation = (id: string) => id === imported.id ? imported : id === started.id ? started : undefined;
  c.adapter.lifecycle = async () => { starts++; work.status = 'Starting'; work.desired = 'running'; return started; };
  c.adapter.loadWork = async () => work;
  c.importCanStart = exits.importCanStart; c.workCompletionReady = exits.workCompletionReady;
  c.queueMicrotask = queueMicrotask; c.openWork = async (w: any) => { opened.push(w.id); };
  vm.runInContext(extract(['handleAction', 'submitWorkStart', 'advanceImportStarts']), c);
  await c.handleAction('start-import-open', { dataset: { id: 'one', importId: imported.id } });
  await assert.rejects(c.handleAction('start-import-open', { dataset: { id: 'one', importId: imported.id } }));
  assert.equal(starts, 1); assert.equal(opened.length, 0);
  const intent = c.importStarts.get(imported.id); assert.equal(intent.importId, imported.id); assert.equal(intent.startId, started.id);
  work.status = 'Ready'; c.advanceImportStarts(); await Promise.resolve(); assert.equal(opened.length, 0);
  if (abandon === 'close') { c.modalChoice++; c.view.modal = ''; }
  if (abandon === 'new selection') c.areaChoice++;
  started.state = 'succeeded'; c.advanceImportStarts(); c.advanceImportStarts(); await Promise.resolve();
  assert.deepEqual(opened, abandon ? [] : ['one']); assert.equal(starts, 1);
});

for(const boundary of ['route','modal','identity'])test(`Apply receipt keeps exact operation before ${boundary} presentation invalidation`,async()=>{
 const {c,work}=fixture();let resolve!:(op:any)=>void;const pending=new Promise<any>(done=>{resolve=done;});let opened=0,confirmed=0;
 c.adapter.applyConfiguration=()=>pending;c.adapter.loadWork=async()=>work;c.actions.confirm=()=>confirmed++;c.actions.refresh=async()=>{};c.runAndShow=()=>opened++;
 vm.runInContext(extract(['handleAction']),c);const record:any={kind:'configuration',work:'one',action:'apply-config'};
 const request=c.handleAction('apply-config',{dataset:{}},record);
 if(boundary==='route')c.location.hash='#/work/two';else if(boundary==='modal')c.modalChoice++;else c.adapter.identityEpoch++;
 resolve({id:'accepted-exact',workId:'one',kind:'Apply configuration',state:'running'});
 await assert.rejects(request,c.ViewChanged);assert.equal(opened,0);assert.equal(record.businessId,boundary==='identity'?undefined:'accepted-exact');assert.equal(confirmed,boundary==='identity'?0:1);
});

for(const entry of ['search toolbar','no matching Works'])test(`Clear search from ${entry} restores keyboard input to the search field`,async()=>{
 const {c}=fixture();c.view.search='missing work';c.location.hash='#/works';let focused=0;
 c.root={querySelector:(selector:string)=>{assert.equal(selector,'#search');return{focus:(options:any)=>{assert.equal(options.preventScroll,true);focused++;}};}};
 c.render=()=>assert.equal(c.view.search,'');vm.runInContext(extract(['handleAction']),c);
 await c.handleAction('clear-search',{dataset:{origin:entry}});assert.equal(c.view.search,'');assert.equal(focused,1);
});

for(const action of ['tab-Services','tab-Files','tab-Chat','settings'])test(`${action} keeps its own keyboard focus when no Focus layout is active`,async()=>{
 const {c,work}=fixture();c.view.layout='workspace';work.services=[];work.config={};c.root={};c.document={fullscreenElement:null};c.structuredClone=structuredClone;c.consumeWebSelection=()=>{};
 let focused=action;c.restoreLayoutFocus=()=>{focused='tab-Services';};c.adapter.loadServices=async()=>{};c.adapter.loadDirectory=async()=>{};c.adapter.loadConfiguration=async()=>{};
 vm.runInContext(extract(['resetWorkspaceFocus','exitWorkspaceFocus','handleAction']),c);
 await c.handleAction(action,{dataset:{}});assert.equal(focused,action);assert.equal(c.view.layout,'workspace');
 if(action.startsWith('tab-'))assert.equal(c.view.tab,action.slice(4));else assert.match(c.location.hash,/settings$/);
});
test('leaving a real Focus layout still restores its saved layout and focus target',async()=>{
 const {c}=fixture();c.view.layout='service-chat';c.root={};c.document={fullscreenElement:null};const target={tab:'Files'};c.workspaceReturn=target;let restored:any;
 c.restoreLayoutFocus=(value:any)=>{restored=value;};vm.runInContext(extract(['resetWorkspaceFocus','exitWorkspaceFocus']),c);
 assert.equal(await c.exitWorkspaceFocus(),true);assert.equal(c.view.layout,'workspace');assert.equal(c.view.tab,'Files');assert.equal(restored,target);
});

for(const scenario of ['tab-Files','settings','tab-Services','new focus','new tab','new Work','new identity','new record','read failure'])test(`navigation read unlock focus ownership: ${scenario}`,async()=>{
 const {c}=fixture(),pending=deferred();const action=scenario.startsWith('tab-')||scenario==='settings'?scenario:'tab-Files';let focusCount=0,currentRecord=true,selected=true;
 const body={},otherInput={},button:any={disabled:false,focus:()=>{focusCount++;c.document.activeElement=button;}};
 const el:any={dataset:{action},cloneNode:()=>({dataset:{action}})};c.document={activeElement:el,body};c.root={querySelector:()=>selected?button:null};
 const intent:any={kind:'read',work:'one',action,key:action};const record:any={...intent,pending:true};
 c.actions.conflict=()=>undefined;c.actions.begin=()=>{button.disabled=true;c.document.activeElement=body;return record;};c.actions.current=()=>currentRecord;c.actions.finish=()=>{record.pending=false;button.disabled=false;};c.actions.fail=c.actions.finish;
 vm.runInContext(extract(['reviewReadyImport','dispatchAction']),c);const request=c.dispatchAction(el,async()=>{await pending.promise;if(scenario==='read failure')throw new Error('Read failed');},intent);
 if(scenario==='new focus')c.document.activeElement=otherInput;if(scenario==='new tab')selected=false;if(scenario==='new Work')c.current=()=>({id:'two'});if(scenario==='new identity')c.adapter.identityEpoch++;if(scenario==='new record')currentRecord=false;
 pending.resolve();if(scenario==='read failure')await assert.rejects(request,/Read failed/);else await request;
 assert.equal(focusCount,['new focus','new tab','new Work','new identity','new record'].includes(scenario)?0:1);if(scenario==='new focus')assert.equal(c.document.activeElement,otherInput);
});


test('late confirmed save callback after identity change cannot mutate editor or announce success',async()=>{
 const {c}=fixture();c.view.file='/draft';c.view.fileDraft='new';c.view.fileOriginal='old';c.assertFileAdmission=()=>{};let notices=0;c.toast=()=>notices++;
 c.adapter.saveFile=async(_work:any,_path:any,_text:any,_baseline:any,_unprotected:any,confirmed:any)=>{c.adapter.identityEpoch++;confirmed({modified:'new-version'});return {status:'succeeded',message:'Confirmed'};};
 vm.runInContext(extract(['saveFile']),c);await assert.rejects(c.saveFile());assert.equal(c.view.fileOriginal,'old');assert.equal(notices,0);
});

test('first route chooses Chat only after confirmed reads and never overrides a newer area choice',async()=>{
 for(const chooseLater of [false,true]){
  const {c,work}=fixture(),gate=deferred();c.selectionWorkId='';work.services=[];work.sessions=[];work.resourceChecked={services:'now',agent:'now'};c.workReadErrors=new Map();c.adapter.modelReady=()=>true;c.adapter.loadWork=async()=>{await gate.promise;return work;};
  vm.runInContext(extract(['loadRoute']),c);const loading=c.loadRoute();if(chooseLater){c.areaChoice++;c.view.tab='Files';}gate.resolve();await loading;assert.equal(c.view.tab,chooseLater?'Files':'Chat');
 }
});

for(const action of ['select-service','open-controlled-service'])test(`independent ${action} updates exact Service and port before rendering`,async()=>{
 const {c,work}=fixture();work.services=[{id:'first',enabled:true,observed:'Ready',ports:[80]},{id:'second',enabled:true,observed:'Ready',ports:[90]}];c.location.hash='#/app/one/first/80';c.view.service='first';c.view.port=80;c.view.layout='workspace';c.serviceCompletionReady=()=>true;
 const calls:any[]=[];c.adapter.ensureServiceEntry=async(...args:any[])=>calls.push(args);c.history={replaceState:(_a:any,_b:any,hash:string)=>c.location.hash=hash};c.render=()=>{const r=c.route();c.view.service=r[2];c.view.port=Number(r[3]);};c.closeModal=c.render;
 vm.runInContext(extract(['handleAction']),c);await c.handleAction(action,{dataset:{id:'second',serviceId:'second',port:'90'}});
 assert.equal(c.location.hash,'#/app/one/second/90');assert.equal(c.lastRoute,c.location.hash);assert.equal(c.view.service,'second');assert.equal(c.view.port,90);assert.deepEqual(calls,[['one','second',90]]);
});

test('late first route cannot change area under a newly opened overlay',async()=>{
 const {c,work}=fixture(),gate=deferred();c.selectionWorkId='';work.services=[];work.sessions=[];work.resourceChecked={services:'now',agent:'now'};c.workReadErrors=new Map();c.adapter.modelReady=()=>true;c.adapter.loadWork=async()=>{await gate.promise;return work;};
 vm.runInContext(extract(['loadRoute']),c);const loading=c.loadRoute();c.modalChoice++;c.view.modal='work-menu';gate.resolve();await loading;assert.equal(c.view.tab,'Services');assert.equal(c.view.modal,'work-menu');
});
for(const action of ['focus-chat','reset-workspace-split'])test(`independent window rejects inapplicable ${action} dispatch`,async()=>{
 const {c}=fixture();c.location.hash='#/app/one/first/80';c.view.layout='workspace';c.enterWorkspaceFocus=()=>assert.fail('No Chat focus in independent application');c.workspacePanels={get:()=>assert.fail('No split in independent application')};
 vm.runInContext(extract(['handleAction']),c);await c.handleAction(action,{dataset:{}});assert.equal(c.view.layout,'workspace');
});

test('confirmed folder creation starts one original-directory reread without replaying mkdir',async()=>{
 const {c,work}=fixture();c.view.formName='new';c.view.path='/original';c.view.modal='new-folder';const calls:string[]=[];const record={};
 Object.assign(c,{joinPath:(a:string,b:string)=>a+'/'+b,validateName:(s:string)=>s,assertFileAdmission:()=>{},retainFileResults:(_w:any,_t:any,r:any)=>r,confirmFileAttempt:()=>{},filesConfirmed:()=>true,closeModal:()=>{c.view.modal='';},modalTransfers:[]});c.adapter.transfer=async()=>{calls.push('mkdir');return[{status:'succeeded'}];};c.adapter.loadDirectory=async(_id:string,path:string)=>calls.push('read:'+path);c.actions.refresh=async(_r:any,load:()=>Promise<void>)=>load();
 vm.runInContext(extract(['handleAction']),c);await c.handleAction('confirm-folder',{dataset:{}},record);assert.deepEqual(calls,['mkdir','read:/original']);
});

test('an explicit Files deep link exits focus and wins over the last restored area', async () => {
  const { c, work } = fixture(); work.sessions = [];
  c.location.hash = '#/work/one/files/%2Foutput%2Freport.txt';
  c.route = () => ['work', 'one', 'files', '/output/report.txt'];
  c.selectionWorkId = 'one';
  c.workSelections.set('one', { area: 'Services', path: '/old', file: '', service: '', port: 0, session: '' });
  c.view.tab = 'Chat'; c.view.path = '/old';
  c.adapter.project = () => ({ usable: true, retainWorkspace: true, action: 'start' });
  c.adapter.loadWork = async () => work;
  c.adapter.loadDirectory = async () => undefined;
  let exits = 0; const opened: Array<[string, string]> = [];
  c.exitWorkspaceFocus = async () => { exits++; return true; };
  c.openFile = async (target: any, path: string) => { opened.push([target.id, path]); c.view.file = path; c.view.fileStatus = 'ready'; };
  c.actions.finish = () => {}; c.actions.fail = () => {};
  vm.runInContext(extract(['loadRoute']), c);
  await c.loadRoute();
  assert.equal(exits, 1, 'focus/full screen is exited before Files becomes visible');
  assert.equal(c.view.tab, 'Files');
  assert.equal(c.view.path, '/output');
  assert.deepEqual(opened, [['one', '/output/report.txt']]);
  assert.equal(c.view.file, '/output/report.txt');
});

test('an invalid Files deep link never becomes a file action or another file', async () => {
  const { c, work } = fixture(); work.sessions = [];
  c.location.hash = '#/work/one/files/%2F..%2Fsecret';
  c.route = () => ['work', 'one', 'files', '/../secret'];
  c.selectionWorkId = 'one';
  c.adapter.project = () => ({ usable: true, retainWorkspace: true, action: 'start' });
  c.adapter.loadWork = async () => work;
  const directories: string[] = [];
  c.adapter.loadDirectory = async (_id: string, path: string) => { directories.push(path); };
  let opened = 0;
  c.openFile = async () => { opened++; };
  c.actions.finish = () => {}; c.actions.fail = () => {};
  vm.runInContext(extract(['loadRoute']), c);
  await c.loadRoute();
  assert.equal(opened, 0);
  assert.equal(c.view.tab, 'Files');
  assert.equal(c.view.file, '');
  assert.deepEqual(directories, ['/']);
  assert.match(c.filesRestoreNotice, /not valid/);
});
