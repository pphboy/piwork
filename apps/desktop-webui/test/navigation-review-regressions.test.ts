import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// App-function integration tests without a browser/socket. DOM geometry and real
// history event ordering remain browser QA. PIWORK_APP_PATH enables red/green runs.
const source = readFileSync(process.env.PIWORK_APP_PATH || new URL('../browser/app.js', import.meta.url), 'utf8');
const navigation = await import(new URL('../browser/work-navigation.js', import.meta.url).href);
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
    view: { tab: 'Files', path: '/x/y', file: '', fileDraft: '', fileOriginal: '', configDirty: false, data: {}, modal: '' },
    location: { hash: '#/work/one' }, modalChoice: 0, fileChoice: 0, areaChoice: 0, serviceChoice: 0, sessionChoice: 0,
    selectionWorkId: 'one', routeLoad: 0, workspaceReturn: undefined, workSelections: new Map(), filesRestoreNotice: '',
    lastRoute: '#/work/one', serviceControls: new Map(), workControls: new Map(), importStarts: new Map(),
    adapter: { identityEpoch: 1, state: { signedIn: true }, project: () => ({ usable: true, action: 'start' }), getWork: () => work, getOperation: () => undefined },
    actions: { records: new Map(), begin: () => undefined, current: () => true, review: (r: any) => { r.blocked = false; } },
    render: () => {}, toast: () => {}, openModal: () => {}, activeService: () => work.services[0], current: () => work, targetWork: () => work,
    ViewChanged: class extends Error {}, URLSearchParams,
    restoreSelection: navigation.restoreSelection, exitWorkspaceFocus: async () => true,
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
  vm.runInContext(extract(['handleAction', 'submitServiceControl']), c);
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
