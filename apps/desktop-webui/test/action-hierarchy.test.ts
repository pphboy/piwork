const { ExportFeedbackRegistry } = await import(new URL('../browser/export-feedback.js', import.meta.url).href);
const { sharedIcon } = await import(new URL('../browser/feedback-primitives.js', import.meta.url).href);
const { menuCommands, workHeaderModel, serviceToolbarModel } = await import(new URL('../browser/work-chrome.js', import.meta.url).href);
const { confirmedDirectorySelection } = await import(new URL('../browser/file-results.js', import.meta.url).href);
const { exportPanelModel, renderExportPanel, renderExportRecoveryPanel } = await import(new URL('../browser/export-panel.js', import.meta.url).href);
const { catalog } = await import(new URL('../browser/i18n/catalog.js', import.meta.url).href);
const { localeSandbox } = await import(new URL('./locale-sandbox.js', import.meta.url).href);
const { pendingDots } = await import(new URL('../browser/pending.js', import.meta.url).href);
const { overlayRole } = await import(new URL('../browser/overlay-role.js',import.meta.url).href);
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Exercise production renderers and handlers. Geometry, real focus and requests
// are independently checked in browser QA; these are not browser tests.
const source = readFileSync(new URL('../browser/app.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('const esc ='), source.indexOf('let view ='));
function extract(...names: string[]) {
  return names.map(name => {
    const match = source.match(new RegExp('^(?:async )?function ' + name + '\\([\\s\\S]*?^}', 'm'));
    assert.ok(match, `production function ${name}`); return match[0];
  }).join('\n');
}
function fixture() {
  const work: any = { id: 'work-a', name: 'A', desired: 'stopped', files: [], color: 'blue', icon: 'grid', resourceErrors: {} };
  const c: any = {
  ...localeSandbox,
    pendingDots, sharedIcon, menuCommands, workHeaderModel, serviceToolbarModel, confirmedDirectorySelection,
    acceptedFlows: [], exportFeedback: new ExportFeedbackRegistry(),
    view: { layout:'workspace', modal: '', data: { scope: 'work-header', epoch: '1' }, path: '/', selected: [], file: '', modalError: '' },
    adapter: { identityEpoch: 1, connectionCheck: { checking: false, error: '' }, state: { sessionState: 'ready', core: { account: 'admin', role: 'admin', address: 'https://core.test' }, snapshots: [], operations: [] },
      project: () => ({ action: 'start', label: 'Stopped' }), getWork: (id: string) => id === work.id ? work : undefined,
      getSnapshot: () => undefined, downloads: new Map(), directories: new Map([["work-a:/", {checkedAt:"now",loading:false,error:""}]]) },
    document:{fullscreenElement:null},root:{},location: {hash:'#/work/work-a'}, current: () => work, route: () => ['works'], controlReady: () => false, workControls: new Map(), workControl: () => undefined, controlMarkup: () => '', operationAction: (op: any) => op.kind,
    exportFlows: { forWork: () => undefined, get: () => undefined },
    filesRestoreNotice: '', uploadProgressMarkup: () => '', filesUploadState: () => undefined, transferResults: () => '', textEditor: () => '', size: (v: number) => `${v} B`,
    exportPanelModel, renderExportPanel, renderExportRecoveryPanel, exportPanelInput: () => ({}), actions: { records: new Map() },
  };
  // This app-local boundary is an assembly collaborator, not a reimplemented registry.
  c.acceptedExportFlow = (flow: unknown) => {
    c.acceptedFlows.push(flow);
    c.exportFeedback.setIdentity(String(c.adapter.identityEpoch));
    c.exportFeedback.acceptFlow(flow);
    return flow;
  };
  c.fileActionsContext="";c.overlayRole=overlayRole;vm.createContext(c); vm.runInContext(helpers, c);
  vm.runInContext(extract('coreConnectionStatus', 'fileReadPending', 'isRequestInspector', 'brand', 'topbar', 'quickAction', 'workRouteFeedback', 'workHeader', 'modalMarkup', 'browserFullscreenAction', 'fileRefreshButton', 'files', 'syncDialogPresentation', 'beginExport', 'workMenuTasks'), c);
  return { c, work };
}

test('global controls live in Admin, not the topbar or Work header', () => {
  const { c, work } = fixture();
  assert.doesNotMatch(c.topbar(), /data-action="(?:about-piwork|operations)"/);
  assert.match(c.topbar(), /aria-label="admin account menu"/);
  assert.doesNotMatch(c.workHeader(work), /data-action="about-piwork"/);
  c.view.modal = 'account'; const html = c.modalMarkup();
  assert.match(html, /command-dropdown/);
  for (const action of ['about-piwork', 'switch-core', 'sign-out']) assert.match(html, new RegExp(`data-action="${action}"`));
  assert.doesNotMatch(html, /data-action="operations"/);
  assert.doesNotMatch(html, /data-action="reset-browser-access"/);
  assert.doesNotMatch(html, /data-action="stop-work"/);
});

test('Ready uses Open in the list; Stop and information stay with the original Work menu', () => {
  const { c, work } = fixture(); c.adapter.project = () => ({ action: 'stop', label: 'Ready', usable: true });
  assert.match(c.quickAction(work), /data-action="open-work"/);
  c.route = () => ['work', 'work-a']; assert.equal(c.quickAction(work), '');
  c.view.modal = 'work-menu'; c.view.data.id = work.id;
  const html = c.modalMarkup();
  for (const action of ['stop-work', 'work-info', 'export']) assert.match(html, new RegExp(`data-action="${action}"[^>]*data-id="work-a"`));
  assert.doesNotMatch(html, /data-action="operations"/);
  c.adapter.project = () => ({ action: 'start', label: 'Stopped' });
  assert.match(c.quickAction(work), /Start Work/); assert.doesNotMatch(c.modalMarkup(), /data-action="stop-work"/);
});

test('stopped Export creates one new intent immediately; running Export only opens Stop confirmation', () => {
  const { c, work } = fixture(); const started: unknown[] = [], opened: any[] = [];
  c.exportFlows.start = (...args: unknown[]) => {
    started.push(args);
    return { id: started.length === 1 ? 'flow' : 'flow-2', workId: work.id, workName: work.name, identityEpoch: c.adapter.identityEpoch, phase: 'checking', error: '', autoDeliveryConsumed: false };
  };
  c.openExportFlow = (flow: any) => opened.push(flow);
  c.openModal = (...args: unknown[]) => opened.push(args);
  c.beginExport(work); assert.equal(started.length, 1); assert.equal(opened[0].id, 'flow');
  assert.equal(c.acceptedFlows.length, 1);
  assert.equal(c.acceptedFlows[0], opened[0]);
  assert.equal(c.exportFeedback.flowOwners()[0].original, opened[0]);
  assert.equal(c.acceptedFlows[0].workId, work.id);
  work.desired = 'running'; c.beginExport(work);
  assert.equal(started.length, 1); assert.equal(opened[1][0], 'stop-work'); assert.equal(opened[1][1].exportAfterStop, 'true');
  assert.equal(c.acceptedFlows.length, 1, 'opening Stop confirmation does not register another intent');
  c.beginExport(work, true); assert.equal(started.length, 2);
  assert.equal(c.acceptedFlows.length, 2);
  assert.equal(c.acceptedFlows[1], opened[2]);
});

test('repeated Export while active reopens its exact flow without starting a second one', () => {
  const { c, work } = fixture(); const old = { id: 'original', mode: 'new', terminal: false };
  c.exportFlows.forWork = () => old; c.exportFlows.start = () => assert.fail('duplicate start');
  c.openExportFlow = (flow: any) => assert.equal(flow, old); c.beginExport(work);
  assert.equal(c.acceptedFlows.length, 0, 'reopening an original flow is not a new accepted intent');
});

function exportFixture() {
  const work = { id: 'work-a', name: 'A' };
  const snapshot = { id: 'exact', workId: work.id, status: 'verified', size: '820074551 bytes', operationId: 'original-op' };
  const flow = { id: 'flow', workId: work.id, workName: 'A', snapshotId: 'exact', phase: 'delivered', autoDeliveryConsumed: true, terminal: true, exportOperationId: 'original-op' };
  const transfer = { snapshotId: snapshot.id, workId: work.id, ready: true };
  return { work, snapshot, flow, transfer, snapshots: [{ ...snapshot, id: 'older' }] };
}

test('export success presents only same-file fallback; diagnostics are separate', () => {
  const input = exportFixture();
  const html = renderExportPanel(exportPanelModel(input));
  assert.equal(html.title, 'Download started');
  assert.match(html.body, /<details class="export-details"><summary>Details<\/summary>/);
  assert.doesNotMatch(html.body, /original-op|data-id="older"/);
  const recovery = renderExportRecoveryPanel(input);
  assert.match(recovery.body, /original-op/);
  assert.match(recovery.body, /data-id="older"/);
  assert.match(html.footer, /Download again/); assert.match(html.footer, /data-id="exact"/);
  assert.equal((html.footer.match(/<button/g) || []).length, 2);
  assert.doesNotMatch(html.footer, /prepare-export|Check status|Pause/);
  assert.match(html.body, /private files and credentials/);
});

test('export failure keeps error visible and only a read-only check in its footer', () => {
  const input = exportFixture();
  const html = renderExportPanel(exportPanelModel({ work: input.work, flow: { ...input.flow, snapshotId: undefined, phase: 'unknown', error: 'Lost receipt', terminal: false } }));
  assert.match(html.body.split('<details')[0], /Lost receipt/);
  assert.match(html.footer, /data-action="check-export-flow"/);
  assert.doesNotMatch(html.footer, /prepare-export|download-work/);
});

test('recovered exact snapshot is a download choice, never automatically a new export', () => {
  const input = exportFixture();
  const html = renderExportRecoveryPanel({ work: input.work, snapshot: { ...input.snapshot, id: 'recovered' } });
  assert.match(html.footer, /data-action="download-work"[^>]*data-id="recovered"/);
  assert.doesNotMatch(html.footer, /prepare-export/);
});

for (const [wasOpen, wasModal, nonmodal, expected] of [
  [false, false, true, ['show']], [true, true, true, ['close', 'show']],
  [true, false, false, ['close', 'showModal']], [false, false, false, ['showModal']],
  [true, false, true, []], [true, true, false, []],
] as const) test(`dialog presentation preserves correct modality: ${wasOpen}/${wasModal} -> ${nonmodal}`, () => {
  const { c } = fixture(), calls: string[] = [];
  const dialog = { open: wasOpen as boolean, matches: () => wasModal,
    close() { calls.push('close'); this.open = false; }, show() { calls.push('show'); this.open = true; }, showModal() { calls.push('showModal'); this.open = true; } };
  c.syncDialogPresentation(dialog, nonmodal); assert.deepEqual(calls, expected);
});

test('Files has no empty selection strip and keeps checkbox/bulk controls in the existing toolbar', () => {
  const { c, work } = fixture(); work.files = [{ path: '/one.txt', name: 'one.txt', size: 2, modified: 'now', kind: 'text' }];
  let html = c.files(work);
  assert.doesNotMatch(html, /Select files for actions|selection-bar/);
  assert.match(html, /file-select-hit/); assert.match(html, /data-file-select="\/one.txt"/);
  assert.match(html, /data-action="file-add"/);
  assert.equal((html.match(/data-action="refresh-files"/g) || []).length, 1);
  c.view.selected = ['/one.txt', '/removed.txt'];
  html = c.files(work);
  assert.deepEqual(c.view.selected, ['/one.txt'], 'only the confirmed current listing retires a missing selection');
  const toolbar = html.split('<div class="file-table">')[0];
  for (const action of ['file-copy', 'file-move', 'file-delete', 'clear-selection']) assert.match(toolbar, new RegExp(`data-action="${action}"`));
  assert.match(html, /aria-label="Copy selected files"/); assert.doesNotMatch(html, /selection-bar/);
  c.adapter.directories.get('work-a:/').loading = true;
  c.view.selected = ['/one.txt', '/not-yet-confirmed.txt'];
  c.files(work);
  assert.deepEqual(c.view.selected, ['/one.txt', '/not-yet-confirmed.txt'], 'a pending listing cannot retire original selections');
});

test('request entries are scoped icon actions and the duplicate footer creation action is absent', () => {
  const agent = extract('agent'), works = extract('works');
  const context = { scope: 'service', identity: 1, currentIdentity: 1, targetWorkId: 'work-a', openedWorkId: 'work-a', targetServiceId: 'service-a' };
  const commands = menuCommands(context);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].action, 'service-requests');
  assert.equal(commands[0].workId, 'work-a');
  assert.equal(commands[0].serviceId, 'service-a');
  assert.equal(catalog.en[commands[0].labelKey], 'Agent requests');
  assert.doesNotMatch(agent, /"pi-requests"/);
  const { c } = fixture();
  c.view.modal = 'agent-menu';
  assert.match(c.modalMarkup(), /data-action="pi-requests"/);
  assert.equal(catalog.en['work.piRequestsAria'], 'Pi requests for this Work');
  assert.doesNotMatch(agent.split('<div class="session-line">')[1]?.split('<div class="messages"')[0] || '', /pi-requests/);
  assert.doesNotMatch(works, /Create a Work", "new-work"/);
  assert.match(works, /t\('works\.emptyTitle'\)/);assert.match(works, /t\('works\.newWork'\)/);assert.equal(catalog.en['works.emptyTitle'],'Make room for your next idea');
});


test('terminal preparation failure offers explicit retry of the same verified snapshot', () => {
  const input = exportFixture();
  const failed = { ...input, flow: { ...input.flow, phase: 'failed', terminal: true }, transfer: { ...input.transfer, ready: false, terminalFailure: true, error: 'Not enough local space' } };
  const html = renderExportPanel(exportPanelModel(failed));
  assert.match(html.footer, /Retry download/); assert.match(html.footer, /data-action="download-work"[^>]*data-id="exact"/);
  assert.doesNotMatch(html.footer, /check-export-flow|prepare-export/);
  failed.snapshot.status = 'expired';
  assert.doesNotMatch(renderExportPanel(exportPanelModel(failed)).footer, /download-work|check-export-flow/);
});


test('account title treats a Core-provided identity as text', () => {
  const { c } = fixture(); c.view.modal = 'account'; c.adapter.state.core.account = '<img src=x onerror=bad()>';
  const html = c.modalMarkup(); assert.match(html, /&lt;img src=x onerror=bad\(\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
});


// Only actual command dropdowns have a leading icon contract. Value lists,
// headings, descriptive text and dialog footers are deliberately excluded.
for (const menu of ['account', 'work-menu', 'agent-menu', 'service-menu', 'file-menu']) {
  for (const layout of ['workspace', 'service-chat', 'service-only', 'chat-only']) {
    for (const fullscreen of [false, true]) test(`${menu} commands retain labelled icons in ${layout}, fullscreen=${fullscreen}`, () => {
      const { c, work } = fixture();
      c.view.modal = menu;
      c.view.layout = layout;
      c.view.data.id = work.id;
      if (menu === 'service-menu') {
        c.view.data.workId = work.id;
        c.view.data.serviceId = 'service-a';
      }
      c.document.fullscreenElement = fullscreen ? c.root : null;
      c.adapter.project = () => ({ action: 'stop', label: 'Ready', usable: true });
      work.files = [{ path: '/notes.txt', name: 'notes.txt', kind: 'file' }]; c.view.data.path = '/notes.txt';
      const html = c.modalMarkup();
      const rows = [...html.matchAll(/<button\b[^>]*role="menuitem"[^>]*data-action="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)];
      assert.ok(rows.length, menu);
      for (const [, action, content] of rows) {
        assert.match(content, /^<svg\b[^>]*aria-hidden="true"[^>]*>/, `${menu}: ${action} has a leading decorative icon`);
        assert.equal((content.match(/<svg\b/g) || []).length, 1, `${action}: one icon`);
        assert.ok(content.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]*>/g, '').trim(), `${action}: visible text retained`);
      }
      if (menu === 'agent-menu') {
        assert.deepEqual(rows.map(row => row[1]), ['sessions', 'new-session', 'pi-requests', layout === 'chat-only' ? 'restore-layout' : 'focus-chat', ...(layout !== 'workspace' || fullscreen ? ['service-fullscreen'] : [])]);
        for (const label of ['Sessions', 'New session', 'Pi requests for this Work', layout === 'chat-only' ? 'Restore layout' : 'Focus chat']) assert.ok(html.includes(label));
      }
      if (menu === 'file-menu') {
        assert.deepEqual(rows.map(row => row[1]), ['open-file', 'download-file', 'file-rename', 'file-move', 'file-copy', 'file-delete']);
        assert.equal((html.match(/data-path="\/notes.txt"/g) || []).length, 6);
        assert.match(html, /class="button danger"[^>]*data-action="file-delete"/);
        work.files[0].kind = 'directory';
        assert.match(c.modalMarkup(), /data-action="download-file"[^>]*disabled/);
      }
    });
  }
}

test('cached Work header owns route reading and ten-second feedback without replacing its content',()=>{
 const {c,work}=fixture();c.actions.records.set('route',{key:'route:work-a:1',work:'work-a',view:c.location.hash,pending:true,started:Date.now()});let html=c.workHeader(work);assert.match(html,/work-read-feedback.*aria-busy="true"/);assert.match(html,/Reading Work/);assert.match(html,/<h1[^>]*>A<\/h1>/);
 c.actions.records.get('route').started-=11000;assert.match(c.workHeader(work),/Still reading Work/);c.actions.records.get('route').view='#/work/other';assert.doesNotMatch(c.workHeader(work),/work-read-feedback/);c.actions.records.get('route').view=c.location.hash;c.actions.records.get('route').pending=false;assert.doesNotMatch(c.workHeader(work),/work-read-feedback/);
});

for(const label of ['Preparing','Starting','Start accepted','Work status not confirmed'])test(`unconfirmed ${label} never offers the ready Open shortcut`,()=>{
 const {c,work}=fixture();c.adapter.project=()=>({action:'stop',label,usable:false});const html=c.quickAction(work);assert.doesNotMatch(html,/data-action="open-work"/);assert.match(html,/data-action="check-work"/);
});

test('Work header keeps one allocated status slot and preserves observed status when task feedback replaces its badge', async () => {
  const { c, work } = fixture();
  c.adapter.project = () => ({ label: 'Stopped', action: 'start', usable: false });
  const initial = c.workHeader(work);
  assert.equal(initial.split('class="work-header-status"').length - 1, 1);
  assert.match(initial, /role="group" aria-label="Observed: Stopped" title="Observed: Stopped"/);
  assert.match(initial, /class="status stopped"/);
  c.controlMarkup = () => '<span class="object-control-state" role="status" aria-busy="true">Start · Submitting</span>';
  const pending = c.workHeader(work);
  assert.equal(pending.split('class="work-header-status"').length - 1, 1);
  assert.match(pending, /aria-label="Observed: Stopped"/);
  assert.match(pending, /Start · Submitting/);
  assert.doesNotMatch(pending, /class="status stopped"/);
  const { i18n } = await import(new URL('../browser/locale.js', import.meta.url).href);
  try {
    i18n.setLocale('zh-CN');
    const chinese = c.workHeader(work);
    assert.ok(chinese.includes(`aria-label="${c.t('service.observed')}: ${c.stateText('Stopped')}"`));
    assert.ok(!chinese.includes('Observed: Stopped'));
  } finally { i18n.setLocale('en'); }
  const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  assert.ok(css.includes('flex: 0 0 18ch;'));
  assert.ok(css.includes('flex-basis: 10ch;'));
  assert.ok(css.includes('.work-header .work-header-status > .object-control-state'));
});
