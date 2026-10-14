import { renderChatMarkdown } from './chat-markdown.js';
import { overlayRole, anchoredOverlay, overlayPlacement, menuDestination, overlayForAction } from './overlay-role.js';
import { WorkspacePanelsStore, splitGeometry, keyboardSplit, executionAnchors } from './workspace-layout.js';
import { workCompletionReady, serviceCompletionReady, importCanStart } from './completion-exits.js';
import { restoreSelection, parentDirectory, missingFileTarget, type WorkSelection } from './work-navigation.js';
import { renameField, validLocalName, canSubmitName, canDismissLightModal, pointOutsideDialog, canCancelPiRequest, modalActionRelevant } from './control-rules.js';
import { NewWorkDraftRevision, hasUnsentDrafts, createSubmissionBlocked } from './draft-revision.js';
import { FileMutationResults, UnknownFileLocks, uploadReview, type FileMutationTarget } from './file-results.js';
import { exportWorkConflict, exportSnapshotAvailable } from './export-admission.js';
import { ExportFlows, type ExportFlow } from './export-flow.js';
import { activityGroups } from './chat-projection.js';
import { ImageDrafts, type DraftImage, type HistoryImage } from './images.js';
import { editAdvanced, synchronizeConfiguration } from './configuration.js';
import { ActionState, renderActionStates, type ActionIntent, type ActionRecord } from './action-state.js';
import { adapter, DesktopError, fileVersion, type TransferResult } from "./adapter.js";
import {
  type Work,
  type Service,
  type Configuration,
  type WorkspaceFile,
  type Operation,
  type Run,
} from "./models.js";

const root = document.querySelector<HTMLDivElement>("#app")!;
const imageDrafts = new ImageDrafts(()=>render());
const imageDraftErrors=new Map<string,{message:string}>();
const textDraftRevisions=new Map<string,number>();
let imageSelection=0;
interface ImageSubmission {key:string;destinationKey:string;text:string;textRevision:number;images:DraftImage[];epoch:number;error?:{message:string}}
const pendingImageSubmissions=new Map<string,ImageSubmission>();
const imageObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){const el=entry.target as HTMLElement;imageObserver.unobserve(el);const w=adapter.getWork(el.dataset.work!),session=w?.sessions.find(s=>s.id===el.dataset.session),image=session?.messages.find(m=>m.runId===el.dataset.run && m.images?.some(i=>i.imageIndex===Number(el.dataset.index)))?.images?.find(i=>i.imageIndex===Number(el.dataset.index));if(w&&session&&image)adapter.loadHistoryImage(w.id,session.id,el.dataset.run!,image);}});
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const icon = (name: string, size = 18) => {
  const paths: Record<string, string> = {
    arrow: '<path d="m10 5-7 7 7 7M3 12h18"/>',
    reset: '<path d="M3 10a9 9 0 1 1 2.6 8.4M3 4v6h6"/>',
    'panel-right': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
    edit: '<path d="m16 3 5 5M4 20l4-1L21 6l-5-5L3 14l-1 8Z"/>',
    move: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v3M3 7v12a2 2 0 0 0 2 2h7M14 17h8m-3-3 3 3-3 3"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    note: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    counter: '<path d="M9 3 7 21M17 3l-2 18M3 9h18M2 15h18"/>',
    spark:
      '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    folder:
      '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z"/>',
    settings:
      '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
    external:
      '<path d="M14 3h7v7M10 14 21 3M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    refresh:
      '<path d="M21 3v6h-6M3 21v-6h6M20 9A8 8 0 0 0 6 5L3 9m18 6-3 4A8 8 0 0 1 4 15"/>',
    upload: '<path d="M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6"/>',
    download: '<path d="M12 3v13m-5-5 5 5 5-5M3 17v4h18v-4"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    play: '<path d="m8 4 12 8-12 8Z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
    send: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
    focus: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    file: '<path d="M14 2H4v20h16V8Zm0 0v6h6M8 13h8M8 17h5"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
    terminal: '<path d="m4 7 5 5-5 5m8 0h8"/>',
    logout: '<path d="M9 3H3v18h6M10 12h11m-5-5 5 5-5 5"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.grid}</svg>`;
};
const btn = (label: string, action: string, cls = "", extra = "") =>
  `<button class="button ${cls}" data-action="${action}" ${extra}>${label}</button>`;
const workLink = (label: string, id: string, cls = '') =>
  `<a class="button ${cls}" data-action="open-work" data-id="${esc(id)}" href="#/work/${encodeURIComponent(id)}">${label}</a>`;
const badge = (status: string) =>
  `<span class="status ${status.toLowerCase().replaceAll(" ", "-")}"><i></i>${esc(status)}</span>`;
const feedback = (text: string, tone = "info", action = "") =>
  `<div class="feedback ${tone}" role="status">${icon(tone === "success" ? "check" : "info")}<div>${text}</div>${action}</div>`;
const empty = (symbol: string, title: string, body: string, action = "") =>
  `<div class="empty">${icon(symbol, 32)}<h2>${title}</h2><p>${body}</p>${action}</div>`;
type WorkspaceLayout = 'workspace' | 'service-chat' | 'service-only' | 'chat-only';
type LayoutReturn = { workId: string; tab: string; layout: Exclude<WorkspaceLayout, 'chat-only'>; anchor: HTMLElement | null; selector: string | null };
const readPlaceholder = (label: string, shape = "rows") => `<div class="read-placeholder read-placeholder-${esc(shape)}" role="status" aria-label="${esc(label)}" aria-busy="true"><div class="read-placeholder-line" aria-hidden="true"></div><div class="read-placeholder-line" aria-hidden="true"></div><div class="read-placeholder-line" aria-hidden="true"></div></div>`;
const readFailure = (label: string, error: string, action: string, busy = false) => `<div class="feedback warning read-failure"><div><span>${esc(label)}</span><details><summary>Details</summary><p>${esc(error)}</p></details></div>${btn(icon('refresh',16),action,`icon-button quiet ${busy ? 'is-reading' : ''}`,`aria-label="${busy ? 'Retrying' : 'Retry'} ${esc(label.toLowerCase())}" title="${busy ? 'Retrying…' : 'Retry'}" ${busy ? 'disabled aria-busy="true" data-read-busy="true"' : ''}`)}</div>`;
let view = {
  search: "",
  deleteConfirmed: false,
  modal: "",
  data: {} as Record<string, string>,
  tab: "Services",
  service: "",
  port: 3000,
  session: "",
  drafts: {} as Record<string, string>,
  includeIdentity: false,
  path: "/",
  file: "",
  fileDraft: "",
  fileOriginal: "",
  fileBaseline: "",
  fileEditable: false,
  fileReread: null as WorkspaceFile | null,
  fileUnprotected: false,
  fileWriteUncertain: false,
  selected: [] as string[],
  settingsTab: "Skills",
  config: null as Configuration | null,
  configDirty: false,
  agentOpen: false,
  note: "note-1",
  noteTitle: "",
  noteBody: "",
  noteLoaded: "",
  toast: "",
  modalError: "",
  modalNameError: null as { name: string; message: string } | null,
  createName: "",
  createAdvanced: false,
  createImage: "",
  createSkillMode: "defaults",
  createPackageMode: "defaults",
  createSkills: [] as string[],
  createPackages: [] as string[],
  createAgents: "",
  createJson: "",
  importName: "",
  inspected: false,
  inspectFilename: "",
  inspectActual: false,
  installType: "Core",
  installSource: "",
  installName: "",
  formName: "",
  formDestination: "/",
  formOverwrite: false,
  operationQuery: "",
  snapshotQuery: "",
  coreAddress: adapter.state.core.address,
  authAccount: '',
  logTime: "",
  serviceOpenError: '',
  logsExpanded: false,
  scrollPinned: true,
  layout: 'workspace' as WorkspaceLayout,
  literalSlash: false,
  commandIndex: 0,
  commandDismissed: '',
  commandRevision: '',
  commandCaret: 0,
  fullscreenError: '',

};
const workspacePanels = new WorkspacePanelsStore();
const expandedActivity = new Map<string,boolean>();
let workspaceReturn: LayoutReturn | undefined, chatReturn: LayoutReturn | undefined;
type ReadingPosition = { scroll: number; pinned: boolean; anchor?: { key: string | undefined; offset: number } };
const chatReading = new Map<string, ReadingPosition>();
let pendingWebCommand: {key:string;text:string;kind:string;workId?:string;sessionId?:string;pair?:{ref:string|null;thinking:string|null}}|undefined;
let importSignInSuspended = false;
const actions = new ActionState(() => render());
let latestCreateToken = 0;
const createDraft = new NewWorkDraftRevision();
const unknownFiles = new UnknownFileLocks();
type FileModalAttempt = { workId: string; operation: 'copy' | 'move' | 'delete'; overwrite: boolean; ledger: FileMutationResults; selected: Set<string>; feedbackRecords: Set<ActionRecord> };
let fileAttempt: FileModalAttempt | undefined;
let modalTransfers: TransferResult[] = [];
let uploadPickerTarget: { epoch: number; workId: string; directory: string } | undefined;
let pendingUploadTarget: { epoch: number; workId: string; directory: string } | undefined;
function resetCreateFields() {
  view.createName = ''; view.createAdvanced = false; view.createImage = '';
  view.createSkillMode = 'defaults'; view.createPackageMode = 'defaults';
  view.createSkills = []; view.createPackages = []; view.createAgents = ''; view.createJson = '';
}
type ObjectControl = { workId: string; serviceId?: string; action: string; phase: 'pending' | 'accepted' | 'unknown' | 'failed' | 'reviewed'; operationId?: string; error?: string };
const workControls = new Map<string, ObjectControl>();
const serviceControls = new Map<string, ObjectControl>();
type ImportStartIntent = { workId: string; importId: string; startId?: string; epoch: number; origin: string; choice: number; selection: string; consumed: boolean; phase: string; error?: string };
const importStarts = new Map<string, ImportStartIntent>();
function controlReady(control: ObjectControl | undefined, w: Work): boolean {
  return !!control?.operationId && workCompletionReady(adapter.getOperation(control.operationId), w.id, adapter.project(w).usable);
}
function controlMarkup(control: ObjectControl | undefined): string {
  if (!control) return '';
  const op = control.operationId ? adapter.getOperation(control.operationId) : undefined;
  const state = op?.state || control.phase;
  const label = state === 'pending' ? 'Submitting' : state === 'accepted' ? 'Accepted · waiting for confirmation' : state === 'unknown' ? 'Result unknown · check the original target' : state === 'reviewed' ? 'Original outcome unknown · current target checked' : state;
  return `<div class="object-control-progress" role="status"><span>${esc(control.action)} · ${esc(label)}</span>${control.error || op?.error || op?.observationError ? `<small>${esc(control.error || op?.error || op?.observationError)}</small>` : ''}<div class="actions">${control.operationId ? btn('Operation details', 'operation', 'text-button small', `data-id="${esc(control.operationId)}"`) : ''}${btn('Check progress', control.serviceId ? 'check-service-progress' : 'check-work-progress', 'text-button small', `data-id="${esc(control.workId)}"${control.serviceId ? ` data-service-id="${esc(control.serviceId)}"` : ''}`)}</div></div>`;
}
async function submitWorkStart(w: Work, record?: ActionRecord, imported?: ImportStartIntent) {
  const old = workControls.get(w.id), permitted = adapter.project(w).action;
  if (!['start', 'retry'].includes(permitted) || old && ['pending', 'unknown'].includes(old.phase)) throw new Error('Check the original Work control before starting again.');
  const control: ObjectControl = { workId: w.id, action: permitted === 'retry' ? 'Retry Work' : 'Start Work', phase: 'pending' };
  const epoch = adapter.identityEpoch; workControls.set(w.id, control); render();
  try {
    const op = await adapter.lifecycle(w.id, permitted as 'start' | 'retry');
    if (epoch !== adapter.identityEpoch) throw new ViewChanged();
    control.operationId = op.id; control.phase = 'accepted';
    if (imported) { imported.startId = op.id; imported.phase = 'accepted'; }
    if (record) { record.businessId = op.id; actions.confirm(record, `Accepted · ${op.id}`); }
    void adapter.loadWork(w.id).catch(() => undefined); render();
  } catch (error) {
    if (epoch === adapter.identityEpoch) {
      const status = (error as DesktopError).httpStatus;
      control.phase = status && status >= 400 && status < 500 ? 'failed' : 'unknown'; control.error = error instanceof Error ? error.message : String(error);
      if (imported) { imported.phase = control.phase; imported.error = control.error; }
      if (record && control.phase === 'unknown') record.blocked = true;
      render();
    }
    throw error;
  }
}
async function submitServiceControl(w: Work, serviceId: string, action: string, record?: ActionRecord) {
  const key = `${w.id}:${serviceId}`, old = serviceControls.get(key), original = old?.operationId && adapter.getOperation(old.operationId);
  if (old && (['pending', 'unknown'].includes(old.phase) || original && !['succeeded', 'failed', 'superseded'].includes(original.state))) throw new Error('Check this Service’s original control before submitting another.');
  const epoch = adapter.identityEpoch, origin = location.hash, choice = modalChoice;
  const control: ObjectControl = { workId: w.id, serviceId, action: `${action} Service`, phase: 'pending' };
  serviceControls.set(key, control); render();
  try {
    const op = await adapter.operateService(w.id, serviceId, action);
    if (epoch !== adapter.identityEpoch) throw new ViewChanged();
    control.operationId = op.id; control.phase = 'accepted';
    if (record) { record.businessId = op.id; actions.confirm(record, `Accepted · ${op.id}`); }
    if (origin === location.hash && choice === modalChoice && current()?.id === w.id) openModal('service-details', { serviceId });
    void adapter.loadServices(w.id).catch(() => undefined); render();
  } catch (error) {
    if (epoch === adapter.identityEpoch) {
      const status = (error as DesktopError).httpStatus;
      control.phase = status && status >= 400 && status < 500 ? 'failed' : 'unknown'; control.error = error instanceof Error ? error.message : String(error);
      if (record && control.phase === 'unknown') record.blocked = true; render();
    }
    throw error;
  }
}
function advanceImportStarts() {
  for (const intent of importStarts.values()) {
    if (intent.consumed || intent.epoch !== adapter.identityEpoch) continue;
    if (intent.origin !== location.hash || intent.choice !== modalChoice || intent.selection !== `${areaChoice}:${serviceChoice}:${sessionChoice}:${fileChoice}`) { intent.consumed = true; continue; }
    const w = adapter.getWork(intent.workId), op = intent.startId && adapter.getOperation(intent.startId);
    if (op && ['failed', 'superseded'].includes(op.state)) { intent.consumed = true; continue; }
    if (w && op && workCompletionReady(op, w.id, adapter.project(w).usable)) {
      intent.consumed = true;
      queueMicrotask(() => {
        if (intent.epoch === adapter.identityEpoch && intent.origin === location.hash && intent.choice === modalChoice) void openWork(w).catch(error => toast(error.message));
      });
    }
  }
}
const exportFlows = new ExportFlows(adapter, {
  deliver: (flow, url) => downloadURL(url, flow.workName),
  changed: () => render(),
  visible: () => document.visibilityState === 'visible',
  canSubmitWorkMutation: (workId, flowId) => !exportWorkConflict(actions.records.values(), workId, flowId),
});
function openExportFlow(flow: ExportFlow, record?: ActionRecord) { if (record) { record.businessId = flow.id; actions.confirm(record, 'Export intent retained; follow original progress'); } openModal('export', { id: flow.workId, flowId: flow.id, snapshotId: flow.snapshotId || '' }); }
function beginExport(work: Work, stopConfirmed = false, record?: ActionRecord) {
  const old = exportFlows.forWork(work.id);
  if (old && !old.terminal) {
    if (old.mode !== 'new') throw new Error('This Work already has an active download for another intent. Check or finish that original download first.');
    openExportFlow(old, record); return;
  }
  if (!stopConfirmed && work.desired === 'running') { openModal('stop-work', { id: work.id, exportAfterStop: 'true' }); return; }
  openExportFlow(exportFlows.start(work.id, { mode: 'new', stopConfirmed }), record);
}

class ViewChanged extends Error {}
let sessionChoice = 0, areaChoice = 0, serviceChoice = 0, selectionRequest = 0, modalChoice = 0;
let servicePreparationScheduled = false;
const fileSelections = new Map<string, number>();
const viewKey = () => `${location.hash}:${view.modal}:${modalChoice}:${view.tab}:${view.path}:${view.service}:${view.port}:${sessionChoice}`;
const actionLabels: Record<string, string> = {
  'check-browser-access': 'Checking browser access', 'confirm-reset-browser-access': 'Resetting browser access', 'sign-in': 'Signing in', 'sign-out': 'Signing out', 'confirm-switch-core': 'Switching Core', 'check-connection': 'Checking connection',
  'retry-works': 'Loading Works', 'create-work': 'Creating Work', 'start-work': 'Starting Work', 'start-import-open': 'Starting imported Work', 'check-work-progress': 'Checking Work progress', 'check-service-progress': 'Checking Service progress', 'confirm-stop': 'Stopping Work', 'confirm-delete': 'Deleting Work',
  'retry-work-read': 'Loading Work', 'open-work': 'Loading Work', 'check-work': 'Checking Work', settings: 'Reading settings', 'tab-Services': 'Loading Services', 'tab-Files': 'Reading workspace',
  'load-models': 'Reading models', 'save-model': 'Saving Session model', 'check-session-model': 'Reading Session model', 'service-requests': 'Reading Agent requests', 'check-active-run': 'Checking active Run', 'pi-requests': 'Reading Pi requests', 'pi-request-detail': 'Reading Pi request', 'cancel-pi-request': 'Cancelling Pi request', 'retry-pi-request': 'Retrying Pi request', 'next-pi-requests': 'Reading more Pi requests', 'next-pi-evidence': 'Reading more evidence',
  'retry-conversation': 'Reading conversation', 'sessions': 'Reading Sessions', 'select-session': 'Reading Session', 'new-session': 'Creating Session', 'send-message': 'Submitting message', 'cancel-run': 'Requesting cancellation', 'resume-run': 'Reconnecting Run',
  'service-details': 'Reading logs', 'service-action': 'Submitting Service control', 'confirm-service-control': 'Submitting Service control', 'refresh-logs': 'Reading logs',
  'open-app': 'Opening application', 'open-window': 'Opening application', 'retry-service-entry': 'Preparing application', 'check-preview': 'Checking preview',
  'refresh-files': 'Reading workspace', 'file-path': 'Reading directory', 'open-file': 'Reading file', 'open-source': 'Reading file', 'save-file': 'Saving file', 'dirty-save': 'Saving file',
  'confirm-upload-overwrite': 'Uploading files', 'confirm-folder': 'Creating folder', 'retry-selected-files': 'Retrying selected paths', 'confirm-transfer': 'Transferring files', 'confirm-file-delete': 'Deleting files',
  'save-config': 'Saving settings', 'dirty-config-save': 'Saving settings', 'refresh-config': 'Reading settings', 'apply-config': 'Submitting Apply', 'confirm-core-skills': 'Copying Skill', 'check-catalog': 'Reading catalog',
  'confirm-install': 'Submitting package', 'confirm-remove-package': 'Removing package', 'confirm-import': 'Submitting import', 'prepare-export': 'Preparing Export',
  'export': 'Preparing Export', 'view-snapshot': 'Checking snapshot', 'save-export-file': 'Checking original download', 'check-export-flow': 'Checking export', 'resume-export-flow': 'Resuming export',
  'download-work': 'Preparing download', 'check-download': 'Checking transfer', 'check-operation': 'Checking Operation', 'lookup-operation': 'Reading Operation', 'lookup-snapshot': 'Reading snapshot',
  'operations': 'Reading known Operations', 'clear-operations': 'Clearing completed records', 'resume-operation': 'Resuming observation', 'check-inspection-import': 'Checking transfer', 'retry-inspection-cleanup': 'Releasing local transfer',
};
function actionIntent(el: HTMLElement, action = el.dataset.action || ''): ActionIntent | undefined {
  let label = actionLabels[action]; if (!label) return;
  if(action==='send-message' && el.dataset.cancelRunId)label='Stopping previous Run and sending';
  if (['service-action', 'confirm-service-control'].includes(action)) label = `${el.dataset.control || view.data.control || "Control"} Service`;
  const w = targetWork(el); let kind: ActionIntent['kind'] = 'read';
  if(action==='send-message' && w && !imageDrafts.get(draftKey(w)).length && !view.literalSlash && /^\/(model|thinking)\s*$/.test((view.drafts[draftKey(w)] || '').trim())) return;
  if (['sign-in', 'sign-out', 'confirm-switch-core', 'confirm-reset-browser-access'].includes(action)) kind = 'identity';
  else if (['create-work', 'start-work', 'start-import-open', 'confirm-stop', 'confirm-delete'].includes(action)) kind = 'lifecycle';
  else if (['save-file', 'dirty-save', 'confirm-upload-overwrite', 'confirm-folder', 'confirm-transfer', 'confirm-file-delete', 'retry-selected-files', 'upload-input'].includes(action)) kind = 'files';
  else if (['save-config', 'dirty-config-save', 'apply-config', 'confirm-core-skills', 'confirm-install', 'confirm-remove-package'].includes(action)) kind = 'configuration';
  else if (action === 'service-action' || action === 'confirm-service-control') { if (action === 'service-action' && ['stop', 'remove'].includes(el.dataset.control || '')) return; kind = 'service'; }
  else if (['new-session', 'send-message', 'cancel-run','save-model','cancel-pi-request','retry-pi-request'].includes(action)) kind = 'agent';
  else if (['confirm-import', 'download-work', 'prepare-export', 'export'].includes(action)) kind = 'transfer';
  const serviceAction = ['service-details', 'service-action', 'confirm-service-control', 'refresh-logs', 'open-app', 'open-window', 'retry-service-entry', 'check-preview'].includes(action);
  const serviceId = el.dataset.id || view.data.serviceId || view.service;
  const resource = ['retry-conversation','check-active-run'].includes(action) ? view.session : action === 'refresh-files' ? view.file || view.path : action === 'create-work' ? view.createName.trim() : kind === 'lifecycle' || action==='settings' ? w?.id : ['cancel-pi-request','retry-pi-request'].includes(action) ? `request:${el.dataset.id || view.data.requestId}` : serviceAction ? `service:${serviceId}${kind === 'service' ? '' : `:${view.port}`}` : el.dataset.path || el.dataset.id || view.data.serviceId || view.data.paths || (action === 'confirm-folder' ? joinPath(view.path, view.formName) : view.file || view.path);
  const key = `${kind}:${w?.id || 'local'}:${resource}:${action}`;
  const chatAction = ['new-session','send-message','cancel-run','resume-run','check-session-model','save-model','retry-conversation'].includes(action);
  return { key, kind, work: w?.id, resource, action, label, target: action === 'create-work' ? view.createName || 'New Work' : chatAction ? w?.name || 'Chat' : `${w?.name || adapter.state.core.address || 'Local CLI'}${resource && resource !== w?.id ? ` · ${resource}` : ''}`,
    anchor: focusKey(el), view: location.hash, origin: view.file || view.path, sourceContext: `${view.tab}:${view.session}:${view.modal}` };
}
async function dispatchAction(el: HTMLElement, perform?: (record?: ActionRecord) => Promise<void>, intent = actionIntent(el)) {
  // Publishing local feedback can reconcile this button before the action runs.
  // Bind the clicked action and its explicit object IDs before that render.
  const action=el.dataset.action || '',target=el.cloneNode(false) as HTMLElement;
  const navigationFocus=['tab-Services','tab-Files','settings'].includes(action) && document.activeElement===el,focusEpoch=adapter.identityEpoch;
  const execute=perform ?? ((record?:ActionRecord)=>handleAction(action,target,record));
  if (!intent) { await execute(); return; }
  if (intent.action === 'create-work' && createSubmissionBlocked(actions.records.values(), view.createName)) { toast('The original Create Work result is still pending or unknown. Check that original request before creating another Work.'); return; }
  if (intent.work && intent.kind === 'lifecycle' && exportFlows.workControlBlocked(intent.work)) { toast('The original Stop or Export submission is not confirmed. Check its original progress before another Work control.'); return; }
  if (intent.work && ['export', 'prepare-export'].includes(intent.action || '') && exportWorkConflict(actions.records.values(), intent.work)) { toast('An original Work control is still pending or unknown. Check that control before Export.'); return; }
  const conflict = actions.conflict(intent); if (conflict) { toast(`${conflict.target} · ${conflict.phase}. Wait for confirmation.`); return; }
  const record = actions.begin(intent)!;
  try { await execute(record); actions.finish(record);
    if (['refresh-config'].includes(action)) actions.reviewed(record.work, ['configuration']);
  }
  catch (error) {
    if (!(error instanceof ViewChanged)) { const unknown = record.blocked; actions.fail(record, error); record.blocked ||= unknown; } else actions.finish(record);
    if (record.action === 'create-work' && record.token < latestCreateToken) throw new ViewChanged();
    throw error;
  }
  finally {
    if (record.work && ['files', 'configuration'].includes(record.kind)) adapter.uploadProgress.delete(record.work);
    // A read lock can blur its button. Restore only the still-selected original navigation.
    if(navigationFocus && focusEpoch===adapter.identityEpoch && actions.current(record) && current()?.id===record.work && !view.modal) {
      const active=document.activeElement,button=root.querySelector<HTMLButtonElement>(`.work-tabs [data-action="${action}"].active`);
      if(button && !button.disabled && (active===document.body || active===root))button.focus({preventScroll:true});
    }
  }
}
function progressText(progress: Record<string, any>) {
  const total = typeof progress.total === 'number' && Number.isFinite(progress.total) && progress.total > 0 ? progress.total : undefined;
  return `${esc(progress.phase)}${progress.transferred !== undefined ? ` · ${esc(progress.transferred)}${total ? ` / ${total}` : ''} bytes` : ''}${total ? `<progress value="${Math.min(progress.transferred || 0, total)}" max="${total}" aria-label="Transfer bytes"></progress>` : ''}`;
}
function uploadProgressMarkup() {
  const work = current(), progress = work && adapter.uploadProgress.get(work.id); if (!progress) return '';
  return feedback(`${esc(progress.path)}${progress.count ? ` · File ${progress.index} of ${progress.count}` : ''} · ${progressText(progress)}`);
}
function downloadProgressMarkup(snapshotID: string) {
  const job = adapter.downloads.get(snapshotID); if (!job) return '';
  return feedback(`Transfer <code>${esc(job.transferId)}</code> · ${progressText(job)}${job.checkedAt ? ` · Checked ${esc(job.checkedAt)}` : ''}${job.error ? ` · ${esc(job.error)}` : ''}${job.observationError ? ` · Observation interrupted: ${esc(job.observationError)}` : ''}`, job.error || job.observationError ? 'warning' : 'info', btn('Check transfer', 'check-download', 'small', `data-id="${esc(snapshotID)}"`));
}
let toastTimer: ReturnType<typeof setTimeout>;
let lastFocus: HTMLElement | null = null;
let pendingNav: (() => void | Promise<void>) | null = null;
let sourceGuardReturn: { epoch: number; route: string; modal: string; data: Record<string, string>; focus: string } | undefined;
let composition = false;
let lastRoute = "";
const route = () => {
  if (location.hash && !location.hash.includes("ticket=")) return location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  const match = /^\/works\/([^/]+)(?:\/services\/([^/]+))?/.exec(location.pathname);
  return match ? match[2] ? ["app", decodeURIComponent(match[1]), decodeURIComponent(match[2]), new URLSearchParams(location.search).get("port") || ""] : ["work", decodeURIComponent(match[1])] : ["works"];
};
const current = () => adapter.getWork(route()[1] || "");
const activeService = (w: Work) =>
  w.services.find((s) => s.id === view.service) ||
  w.services.find(
    (s) => s.enabled && s.observed === "Ready" && s.ports.length,
  ) ||
  w.services[0];
const unavailable = () =>
  ["core-offline", "cli-closed", "ticket-expired"].includes(
    adapter.state.scenario,
  ) || !adapter.state.signedIn;
const dirty = () => view.file && view.fileDraft !== view.fileOriginal;
function toast(message: string) {
  view.toast = message;
  clearTimeout(toastTimer);
  render();
  toastTimer = setTimeout(() => {
    view.toast = "";
    render();
  }, 3000);
}
function navigate(hash: string) {
  const go = () => {
    location.hash = hash;
  };
  if (dirty()) {
    pendingNav = go;
    openModal("dirty-file");
    return;
  }
  if (view.configDirty) {
    pendingNav = go;
    openModal("dirty-settings");
    return;
  }
  go();
}
const workSelections = new Map<string, WorkSelection>();
let selectionWorkId = '', fileChoice = 0, filesRestoreNotice = '';
function rememberWork() {
  if (selectionWorkId && adapter.getWork(selectionWorkId)) workSelections.set(selectionWorkId, {
    area: view.tab, path: view.path, file: view.file,
    service: view.service, port: view.port, session: view.session,
  });
}
async function restoreFiles(w: Work, previous: WorkSelection, valid: () => boolean) {
  const choice = fileChoice, area = areaChoice;
  const currentSelection = () => valid() && choice === fileChoice && area === areaChoice && view.tab === 'Files';
  let path = previous.path;
  while (currentSelection()) {
    try { await adapter.loadDirectory(w.id, path); }
    catch (error) {
      if (!currentSelection()) return;
      if (missingFileTarget((error as DesktopError).httpStatus) && path !== '/') {
        path = parentDirectory(path); continue;
      }
      filesRestoreNotice = `The previous folder could not be restored. ${error instanceof Error ? error.message : String(error)}`;
      render(); return;
    }
    if (!currentSelection()) return;
    view.path = path;
    if (path !== previous.path) filesRestoreNotice = `The previous folder is no longer available. Opened ${path} instead.`;
    if (previous.file && path === previous.path) {
      try { await openFile(w, previous.file); }
      catch (error) {
        if (!valid() || area !== areaChoice || view.tab !== 'Files' || error instanceof ViewChanged) return;
        filesRestoreNotice = `The previous file could not be opened. ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    if (valid()) render(); return;
  }
}
function draftKey(w: Work, session = view.session) {
  return `${w.id}:${session || "new"}`;
}
function imageDraftMarkup(w:Work,key:string) {
  const images=imageDrafts.get(key),reason=images.length?adapter.imageInputReason(w.id,view.session):'';
  return `${images.length?`<div class="chat-image-drafts">${images.map(image=>`<div class="chat-image-draft"><img src="${esc(image.url)}" alt="${esc(image.name)}"><span>${esc(image.name)}${image.reading?' · Checking…':''}</span>${btn('Remove','remove-chat-image','small',`data-id="${esc(image.id)}" aria-label="Remove ${esc(image.name)}"`)}</div>`).join('')}</div>`:''}${reason?feedback(esc(reason),'warning',adapter.imageCapabilities.get(w.id)?.error?btn('Check image support','check-image-support','small'):''):''}${imageDraftErrors.get(key)?.message?feedback(esc(imageDraftErrors.get(key)!.message),'warning'):''}`;
}
async function addChatImages(files:File[]) {
 const w=current();if(!w)return;const key=draftKey(w),epoch=adapter.identityEpoch,origin=location.hash,session=view.session,selection=imageSelection;
 const valid=()=>epoch===adapter.identityEpoch&&origin===location.hash&&selection===imageSelection&&(!session||view.session===session);
 imageDraftErrors.set(key,{message:''});const errors=await imageDrafts.add(key,files,valid);if(valid()){imageDraftErrors.set(key,{message:errors.join(' ')});render();}
}
function historyImageMarkup(w:Work,session:string,run:string,image:HistoryImage) {
 const key=adapter.historyImageKey(w.id,session,run,image.imageIndex),state=adapter.imageLoads.get(key);
 const attrs=`data-work="${esc(w.id)}" data-session="${esc(session)}" data-run="${esc(run)}" data-index="${esc(image.imageIndex)}"`;
 return `<div class="chat-history-image" data-history-image ${attrs}>${state?.phase==='ready'?`<button data-action="preview-chat-image" ${attrs} aria-label="View image ${esc(image.imageIndex+1)}"><img src="${esc(state.url)}" alt="Sent image ${esc(image.imageIndex+1)}" loading="lazy"></button>`:state?.phase==='error'?`${feedback(esc(state.error),'warning')}${btn('Retry image','retry-chat-image','small',attrs)}`:'<span role="status">Loading image…</span>'}</div>`;
}
async function openWork(w: Work, record?: ActionRecord) {
  await guard(async () => {
    rememberWork(); view.modal = ''; modalChoice++;
    history.pushState(null, '', location.pathname + location.search + `#/work/${encodeURIComponent(w.id)}`);
    lastRoute = location.hash; if (record) record.view = location.hash;
    await loadRoute();
  });
}

function currentNameError() {
  const failure = view.modalNameError;
  const name = (view.modal === 'import' ? view.importName : view.createName).trim();
  return failure && failure.name === name ? failure.message : '';
}
function nameFieldError(id: string, importing = false) {
  const message = currentNameError();
  return message ? `<span id="${id}" class="name-field-error" role="alert">${esc(message)}${importing ? ' Or leave the name blank to let Core choose one.' : ''}</span>` : '';
}
function clearNameFieldError(renderNow = true) {
  if (!view.modalNameError) return;
  for (const [key, record] of actions.records) {
    if (!record.pending && !record.blocked && record.error === view.modalNameError.message && record.action === (view.modal === 'import' ? 'confirm-import' : 'create-work')) actions.records.delete(key);
  }
  view.modalNameError = null;
  view.modalError = '';
  if (renderNow) render();
}
function importNameFeedback(op: Operation) {
  if (op.kind !== 'Import Work' && op.kind !== 'import-work') return '';
  const name = op.importName || adapter.getWork(op.workId)?.name;
  if (!name) return `<div class="import-name-feedback">${feedback('The import name has not been confirmed.')}</div>`;
  const title = op.state === 'succeeded' ? 'Imported as' : 'Name selected for this import';
  const renamed = op.importSourceName && op.importSourceName !== name;
  return `<div class="import-name-feedback">${feedback(`${title}: <strong>${esc(name)}</strong>${renamed ? `<p>Core selected this name instead of <strong>${esc(op.importSourceName)}</strong> because the source name was unavailable.</p>` : ''}`)}</div>`;
}
let overlayAnchor = "";
let overlayContext = "";
let overlayOpening = false;
let requestNavigation: {epoch:number;workId:string;source:string;serviceName:string;entry:string;scroll:number;focus:string}|undefined;
function requestNavigationCurrent() { return requestNavigation?.epoch===adapter.identityEpoch && requestNavigation.workId===current()?.id; }
function openModal(name: string, data: Record<string, string> = {}) {
  fileActionsContext='';
  const sourceFocus=document.activeElement instanceof HTMLElement && document.activeElement!==document.body ? document.activeElement : null;
  const existing = root.querySelector('#modal');
  if (!existing?.contains(sourceFocus)) overlayAnchor = focusKey(sourceFocus) || focusReturn;
  if (name === 'chat-response-settings') overlayAnchor = '#response-settings-trigger';
  overlayContext = `${adapter.identityEpoch}:${location.hash}:${view.tab}:${view.path}`;
  modalChoice++;
  lastFocus = sourceFocus;
  view.modal = name;
  view.data = data;
  view.modalError = "";
  view.modalNameError = null;
  view.formName = "";
  view.formDestination = view.path;
  view.formOverwrite = false;
  fileAttempt = undefined; modalTransfers = [];
  view.deleteConfirmed = false;
  overlayOpening = true;
  try { render(); } finally { overlayOpening = false; }
  const panel=root.querySelector<HTMLElement>('#modal');
  if (overlayRole(name)==='menu') panel?.querySelector<HTMLElement>('[role=menuitem]:not([disabled])')?.focus({preventScroll:true});
  else if (overlayRole(name)==='drawer') panel?.querySelector<HTMLElement>('[data-action=close-modal]')?.focus({preventScroll:true});
  else if (anchoredOverlay(name)) panel?.querySelector<HTMLElement>('[aria-selected=true],button:not([disabled]),input:not([disabled]),summary')?.focus({preventScroll:true});
}
function closeModal(restoreFocus = true) {
  if(!view.modal)return;
  if (['dirty-file', 'dirty-settings'].includes(view.modal) && sourceGuardReturn) {
    const original = sourceGuardReturn; sourceGuardReturn = undefined; pendingNav = null;
    if (original.epoch === adapter.identityEpoch && original.route === location.hash) {
      modalChoice++; view.modal = original.modal; view.data = { ...original.data }; view.modalError = '';
      render(); root.querySelector<HTMLElement>(original.focus)?.focus({ preventScroll: true }); return;
    }
  }
  const dialog=root.querySelector<HTMLDialogElement>('#modal');
  const requestEntry=isRequestInspector() && requestNavigationCurrent()?requestNavigation!.entry:'';
  const responseSettings = view.modal === 'chat-response-settings';
  const responseContext = responseSettings && chatSettingsContextCurrent();
  const source = view.data.source, oldFocus=lastFocus;
  const selector=requestEntry || (responseSettings && responseContext ? source==='command'?'#composer':'#response-settings-trigger' : focusReturn);
  const caret = [Number(view.data.caretStart), Number(view.data.caretEnd)];
  if (responseSettings && pendingWebCommand && ['model','thinking'].includes(pendingWebCommand.kind) && !pendingWebCommand.pair) pendingWebCommand=undefined;
  if (view.modal === 'new-work' || view.modal === 'import') clearNameFieldError(false);
  if (view.modal === "import") void adapter.abandonInspection();
  // Invalidate before closing native presentation; no exit snapshot or delayed callback owns focus.
  modalChoice++;
  view.modal = "";view.modalError = "";view.modalNameError = null;
  if(requestEntry)requestNavigation=undefined;
  if(responseSettings)focusReturn='';
  const restore=(continuing?:HTMLElement|null)=>{
    const visible=(node:HTMLElement|null)=>!!node?.isConnected && !!node.getClientRects().length && !node.closest('[inert]') && !(node as HTMLButtonElement).disabled;
    let target=visible(continuing || null)?continuing!:(selector?root.querySelector<HTMLElement>(selector):null);
    if(!visible(target) && visible(oldFocus))target=oldFocus;
    if(!visible(target))target=[...root.querySelectorAll<HTMLElement>('[data-action=account],[data-action=work-menu],[data-action^=tab-],[data-action=exit-service-focus],[data-action=service-focus],#composer')].find(visible) || null;
    if(target && target!==document.activeElement)target.focus({preventScroll:true});
    if(!continuing && responseSettings && responseContext && source==='command' && target instanceof HTMLTextAreaElement)target.setSelectionRange(caret[0],caret[1]);
  };
  if(dialog?.open)dialog.close();
  render();if(restoreFocus)restore();
}
const phase = (op: Operation) => `<div class="phase-track" role="status"><div><span>${op.state === "succeeded" ? icon("check", 14) : icon("clock", 14)}</span>Current phase: ${esc(op.phase || op.state)}</div></div>`;
function scenarioBar() { return ""; }
function brand() {
  return `<a href="#/works" class="brand" aria-label="Piwork Works"><img class="brand-logo" src="/desktop/piwork-logo.png" alt="" width="40" height="40"><span class="brand-product">Desktop</span></a>`;
}
function topbar() {
  if (adapter.state.browserAccess !== "authorized") return `<header class="topbar">${brand()}</header>`;
  return `<header class="topbar">${brand()}<div class="topbar-right">${btn(`<span class="avatar">${esc(adapter.state.core.account.slice(0, 1).toUpperCase() || "?")}</span><span>${esc(adapter.state.core.account || "Account")}</span>${icon("down", 14)}`, "account", "account-button quiet", `aria-label="${esc(adapter.state.core.account || 'Account')} account menu" aria-haspopup="dialog" aria-expanded="${view.modal === 'account'}"`)}</div></header>`;
}
function defaultCorePreferences() {
  const p = adapter.preferences, blocked = ['saving','clearing','unconfirmed'].includes(p.phase);
  const pending = p.phase === 'saving' ? 'Saving default…' : p.phase === 'clearing' ? 'Restoring automatic selection…' : p.phase === 'loading' ? 'Reading saved default…' : p.phase === 'unconfirmed' ? 'Change not yet confirmed. Read the saved default to continue.' : '';
  return `<section class="default-core-preferences" aria-label="Default Core"><p class="muted">Current connection: <code>${esc(adapter.state.core.address)}</code></p><p>Saved default: <strong>${esc(p.confirmed ? p.coreUrl || 'Not set · automatic selection' : 'Not yet read')}</strong></p><p class="muted">Saving affects future launches. Parameters and environment can override it. Use Sign in or Connect to change the current connection.</p><div>${btn('Save as default','save-default-core','quiet small',blocked ? 'disabled' : '')}${btn('Restore automatic selection','clear-default-core','quiet small',blocked ? 'disabled' : '')}${btn('Read saved default','read-default-core','quiet small',['saving','clearing','loading'].includes(p.phase) ? 'disabled' : '')}</div>${pending ? `<p role="status" aria-live="polite">${esc(pending)}${p.waiting ? ' Still waiting for confirmation; other actions remain available.' : ''}</p>` : ''}${p.error ? feedback(esc(p.error),'warning') : ''}${p.notice ? `<p role="status" aria-live="polite">${esc(p.notice)}</p>` : ''}</section>`;
}
function connection() {
  const s = adapter.state.scenario;
  return `<button class="connection" data-action="connection"><i class="${["core-offline", "env-not-ready"].includes(s) ? "warn" : ""}"></i>${esc(adapter.state.core.name)}<span>·</span>${s === "core-offline" ? "Unreachable" : s === "env-not-ready" ? "Runtime not ready" : "Connected"}${icon("down", 12)}</button>`;
}
function signIn() {
  const access = adapter.state.browserAccess;
  if (access !== 'authorized') {
    const checking = access === 'checking', unavailable = access === 'unavailable';
    return `${topbar()}<main class="auth-main browser-access"><div class="auth-symbol">${icon("lock",26)}</div><h1>${checking ? 'Opening workspace…' : unavailable ? 'Desktop connection unavailable' : 'Browser access required'}</h1><p class="muted" role="status" aria-live="polite">${checking ? 'Connecting to your local Desktop…' : esc(adapter.state.browserAccessReason)}</p>${checking ? '' : `${btn('Check browser access','check-browser-access','primary full')}<div class="recovery-command"><p>From a terminal as the same system user:</p><code>${esc(adapter.reopenCommand())}</code>${btn('Copy reopen command','copy-reopen-command','quiet full')}</div><p class="muted">If the instance is not running, start it with <code>${esc(adapter.startCommand())}</code>. Reopening a running instance keeps its Core, Works and browser sessions.</p><div class="recovery-command"><p>To clear this Desktop’s saved Core login without browser access:</p><code>${esc(adapter.logoutCommand())}</code>${btn('Copy logout command','copy-logout-command','quiet full')}</div>`}</main>`;
  }
  return `${topbar()}<main class="auth-main"><div class="auth-symbol">${icon("lock",26)}</div><h1>Connect to your Core</h1><p class="muted">Sign in with your Core account. Credentials stay with the local CLI.</p>${adapter.state.cleanupRequired ? feedback(`Local identity is cleared, but saved credential cleanup is incomplete. Run <code>${esc(adapter.logoutCommand())}</code> before signing in or switching Core.`, 'warning') : ''}${view.toast ? feedback(esc(view.toast), "warning") : ""}<label class="field">Core address<input id="auth-core" value="${esc(view.coreAddress || adapter.state.core.address)}" placeholder="http://127.0.0.1:7181"></label>${defaultCorePreferences()}<label class="field">Account<input id="auth-account" autocomplete="username" value="${esc(view.authAccount)}"></label><label class="field">Password<input id="auth-password" type="password" autocomplete="current-password"></label>${btn("Sign in", "sign-in", "primary full")}<div class="auth-divider">Inspect a Work package locally before signing in</div>${btn(`${icon("upload",16)} Inspect a .work package`, "import", "quiet")}</main>`;
}
function worksRefreshButton() {
  const pending = adapter.worksLoading || [...actions.records.values()].some(record => record.action === 'retry-works' && record.pending && record.view === location.hash);
  const label = pending ? 'Reading Works…' : 'Refresh Works';
  return btn(icon('refresh'), 'retry-works', `icon-button quiet ${pending ? 'is-reading' : ''}`, `title="${label}" aria-label="${label}" ${pending ? 'disabled aria-busy="true" data-read-busy="true"' : ''}`);
}
function works() {
  const s = adapter.state.scenario;
  const confirmed = !!adapter.worksChecked || adapter.state.works.length > 0;
  const all = adapter.state.works.filter((w) =>
    w.name.toLowerCase().includes(view.search.toLowerCase()),
  );
  return `${topbar()}<main class="works-page"><div class="works-eyebrow">YOUR WORKSPACE</div><div class="page-heading"><div><h1>Works</h1><p>A place for your tools, files, and conversations.</p></div><div class="actions">${worksRefreshButton()}${btn(icon("upload"), "import", "icon-button quiet", 'title="Import Work" aria-label="Import Work"')}${btn(icon("plus"), "new-work", "icon-button primary", 'title="New Work" aria-label="New Work"')}</div></div>${adapter.worksError ? feedback(`Works could not be refreshed. ${esc(adapter.worksError)}`, 'warning', btn('Retry loading', 'retry-works', 'small')) : ''}<div class="list-controls"><div class="search-box">${icon("search")}<input id="search" value="${esc(view.search)}" placeholder="Search your Works" aria-label="Search Works">${view.search ? btn(icon("close"), "clear-search", "icon-button quiet", 'aria-label="Clear search"') : ""}</div>${connection()}</div>${s === "core-offline" ? feedback(`Core is unreachable. Last confirmed ${esc(adapter.state.lastChecked)}. This is not a password error.`, "warning", btn("Check connection", "check-connection", "small")) : ""}${s === "env-not-ready" ? feedback("Core is reachable. The runtime is not ready; existing information is available.", "warning", btn("Check readiness", "check-connection", "small")) : ""}${(!confirmed && !adapter.worksError && (s === "loading" || adapter.worksLoading)) ? `<div class="loading-list" role="status" aria-label="Loading your Works" aria-busy="true">${[1, 2, 3].map(() => '<div class="skeleton" aria-hidden="true"><i></i><span></span><span></span></div>').join("")}</div>` : !confirmed && (s === "list-error" || adapter.worksError) ? empty("refresh", "Works could not be loaded", "Your account is still signed in. Check the connection and try reading the list again.", btn("Retry loading", "retry-works", "primary")) : !adapter.state.works.length && (confirmed || s === "empty") ? empty("grid", "Make room for your next idea", "Create a Work, then ask the Agent to build a tool or help with your files.", btn(`${icon("plus")} New Work`, "new-work", "primary")) : all.length ? `<div class="work-table"><div class="work-table-head"><span>NAME</span><span>STATUS</span><span>QUICK ACTION</span><span></span></div>${all.map((w) => `<div class="work-row"><a class="work-name" data-action="open-work" data-id="${esc(w.id)}" href="#/work/${encodeURIComponent(w.id)}"><span class="work-icon ${w.color}">${icon(w.icon, 22)}</span><span><strong>${esc(w.name)}</strong><small>${esc(w.description)}</small></span></a><div class="work-status">${workStatus(w)}${controlMarkup(workControls.get(w.id))}</div><div>${quickAction(w)}</div>${btn(icon("more"), "work-menu", "icon-button quiet", `data-id="${w.id}" aria-label="More options for ${esc(w.name)}"`)}</div>`).join("")}</div>` : empty("search", "No matching Works", "Try a different name.", btn("Clear search", "clear-search"))}<div class="works-footer"><span>${icon("lock", 14)} Only your own Works appear here</span><span>${adapter.state.works.length} Works <b>·</b> ${esc(adapter.state.core.account)}</span></div><div class="works-help"><span class="mini-symbol">${icon("spark", 19)}</span><div><strong>Start with an idea. Make something useful.</strong><p>Give your Work a goal, then build and use its tools alongside the Agent.</p></div></div></main>`;
}
function quickAction(w: Work) {
  if (route()[0] === 'works' && controlReady(workControls.get(w.id), w)) return workLink('Open Work', w.id, 'primary small');
  const action = adapter.project(w).action;
  if (action === 'stop') return route()[0] === 'works' ? workLink('Open Work', w.id, 'quiet small') : '';
  const label = { start: 'Start Work', retry: 'Retry Work', check: 'Check status' }[action];
  return btn(`${icon(action === 'start' ? 'play' : 'refresh', 15)} ${label}`,
    action === 'check' ? 'check-work' : 'start-work', 'quiet small', `data-id="${esc(w.id)}"`);
}
function workStatus(w: Work) {
  const state = adapter.project(w);
  return `${badge(state.label)}${state.explanation ? `<small>${esc(state.explanation)}</small>` : w.status === 'Degraded' ? '<small>A capability needs attention</small>' : ''}`;
}
function workHeader(w: Work, standalone = false) {
  return `<header class="work-header"><div class="work-header-main">${btn(icon("arrow", 19), standalone ? "back-work" : "back-works", "icon-button quiet", `aria-label="${standalone ? "Back to Work" : "Back to Works"}"`)}<span class="header-divider"></span><span class="work-icon small ${w.color}">${icon(w.icon, 19)}</span><h1 title="${esc(w.name)}">${esc(w.name)}</h1>${badge(adapter.project(w).label)}</div><div class="actions header-actions">${quickAction(w)}${btn(icon("more"), "work-menu", "icon-button quiet", `data-id="${w.id}" aria-label="Work options"`)}</div></header>`;
}
function workPage(w: Work) {
  const settings = route()[2] === "settings", panels = workspacePanels.get(w.id);
  const serviceArea = view.tab === 'Services', narrow = innerWidth < 900;
  const hiddenChat = view.layout === 'service-only' || serviceArea && view.layout === 'workspace' && (narrow ? !panels.narrowChat : panels.collapsed);
  const narrowChat = serviceArea && narrow && !hiddenChat && view.layout !== 'chat-only';
  return `${workHeader(w)}${controlMarkup(workControls.get(w.id))}<nav class="work-tabs" aria-label="Work areas"><div>${["Services", "Files", "Chat"].map((t) => btn(`${icon(t === "Services" ? "grid" : t === "Files" ? "folder" : "chat", 17)} ${t}`, `tab-${t}`, !settings && view.tab === t ? "tab active" : "tab")).join("")}</div><div class="work-tools">${btn(`${icon('note', 17)} <span>Pi Requests</span>`, 'pi-requests', 'tab work-requests', 'aria-label="Pi requests for this Work" title="Pi requests for this Work"')}${btn(`${icon("settings", 17)} Settings`, "settings", settings ? "tab active" : "tab")}</div></nav>${w.status === "Degraded" ? `<div class="work-notice">${icon("info", 15)} Some capabilities need attention. Available Services remain usable. ${btn("View details", "manage-services", "text-button")}</div>` : ""}${!settings && adapter.project(w).retainWorkspace && !adapter.project(w).usable ? feedback("Current Work status is not confirmed. Your open workspace is retained; new runtime and file changes are unavailable until checked.", "warning", btn("Check Work", "check-work", "small", `data-id="${esc(w.id)}"`)) : ""}${settings ? settingsPage(w) : !adapter.project(w).retainWorkspace ? `${view.layout !== "workspace" ? `<div class="focus-unavailable"><b>${esc(w.name)}</b>${focusControls(w)}</div>` : ""}${workState(w)}` : `<div class="work-layout ${view.agentOpen ? "agent-open" : ""} ${view.tab === "Chat" || view.layout === "chat-only" ? "chat-main" : ""} ${hiddenChat ? "chat-hidden" : ""} ${serviceArea ? "service-workspace" : ""} ${narrowChat ? "narrow-chat" : ""}"><section id="workspace-main" class="main-panel" ${view.layout === "chat-only" ? "inert" : ""}>${view.tab === "Files" ? files(w) : view.tab === "Chat" ? "" : services(w)}</section><div id="workspace-splitter" class="workspace-splitter" role="separator" aria-orientation="vertical" aria-label="Resize Service and Chat" aria-controls="workspace-main workspace-chat" aria-valuemin="0" aria-valuemax="100" aria-valuenow="70" title="Drag or use arrow keys. Enter resets split." tabindex="${serviceArea && !narrow && !hiddenChat && view.layout !== 'chat-only' ? 0 : -1}"></div><aside id="workspace-chat" class="agent-side" ${hiddenChat ? "inert" : ""}>${agent(w, view.tab === "Chat" || view.layout === "chat-only")}</aside>${btn(`${icon("chat")} Agent`, "toggle-agent", "floating-agent")}</div>`}`;
}
function workState(w: Work) {
  const state = adapter.project(w);
  const stopped = state.action === 'start';
  const title = stopped ? 'This Work is stopped' : ({ Preparing: 'Preparing your Work', Starting: 'Starting your Work', Stopping: 'Stopping your Work', Unknown: 'Work status is unknown' } as Record<string, string>)[state.label] || state.label;
  const details = state.operationIds.length ? btn('Operation details', 'work-operations', '', `data-id="${esc(w.id)}"`) : '';
  return `<main class="work-state">${empty(stopped ? 'stop' : w.status === 'Failed' ? 'info' : 'clock', title,
    stopped ? 'Your workspace data is preserved. Start the Work to use its Services, files, and Agent.' : esc(state.explanation || w.error || 'Waiting for the original operation to reach a confirmed result.'),
    `<div class="actions">${quickAction(w)}${btn('Settings', 'settings')}${details}${state.exportable ? btn(`${icon('download')} Export Work`, 'export', '', `data-id="${esc(w.id)}"`) : ''}</div>`)}
    <details class="state-footnote"><summary>State details</summary><p>Target: ${esc(w.desired)} · Last confirmed: ${esc(w.status)} · Checked ${esc(w.checkedAt || 'Not confirmed')}</p></details></main>`;
}
function serviceUnavailableReason(service: Service) {
  if (!service.enabled) return 'This Service is disabled. Starting the Work does not re-enable it. Enable it explicitly from Manage services.';
  if (service.observed === 'Starting') return 'This Service is starting. Its application entry will open after readiness is confirmed.';
  if (service.observed === 'Failed') return 'This Service failed. Check its details and logs before an explicit retry.';
  if (service.observed === 'Stopped') return 'This Service is stopped. Check its current details before starting it.';
  return 'This Service state is not confirmed. Check its current details; an application entry is not available yet.';
}
function serviceFallbackHeader(w: Work) {
  return `<div class="service-toolbar"><span class="service-selector">Services</span><div class="actions focus-actions">${workspaceChatToggle(w)}${focusControls(w)}</div></div>`;
}
function serviceViewport(w: Work, service: Service) {
  const key = `${w.id}:${service.id}:${view.port}`, url = adapter.serviceEntryUrl(w.id, service.id, view.port);
  const loaded = [...root.querySelectorAll<HTMLIFrameElement>('iframe[data-service-key]')].some(frame => frame.dataset.serviceKey === key && frame.dataset.navigationLoaded === 'true' && frame.getAttribute('src') === url);
  return `<div class="service-viewport"><iframe data-service-key="${esc(key)}" class="real-service-frame" title="${esc(service.name)} application" src="${esc(url)}"></iframe>${loaded ? '' : `<div class="service-frame-loading">${readPlaceholder(`Loading ${service.name}…`, 'service')}</div>`}</div>`;
}
function observeServiceFrames() {
  for (const frame of root.querySelectorAll<HTMLIFrameElement>('iframe[data-service-key]')) if (!frame.dataset.observed) {
    const epoch = adapter.identityEpoch;
    frame.dataset.observed = 'true';
    frame.addEventListener('load', () => {
      if (!frame.isConnected || epoch !== adapter.identityEpoch) return;
      // Navigation loaded is only a presentation signal, not application readiness.
      frame.dataset.navigationLoaded = 'true';
      render();
      const [workId, serviceId, port] = frame.dataset.serviceKey!.split(':');
      void adapter.serviceFrameLoaded(workId, serviceId, Number(port)).catch(error => { if (frame.isConnected && epoch === adapter.identityEpoch) toast(error.message); });
    });
  }
}
function services(w: Work) {
  if (!w.resourceChecked?.services && !w.resourceErrors?.services) return `${serviceFallbackHeader(w)}${readPlaceholder('Loading Services…', 'service')}`;
  const s = route()[0] === "app" ? w.services.find(service => service.id === route()[2]) : activeService(w);
  if (s && route()[0] !== "app" && !s.ports.includes(view.port)) view.port = s.ports[0] || 0;
  if (w.resourceErrors?.services && !w.resourceChecked?.services) return serviceFallbackHeader(w) + feedback(esc(w.resourceErrors.services), "warning", btn("Retry Services", "retry-services"));
  if ((!s || !s.ports.length) && w.resourceErrors?.services) return serviceFallbackHeader(w) + feedback(`Service availability could not be confirmed. ${esc(w.resourceErrors.services)}`, 'warning', btn('Retry Services', 'retry-services', 'small'));
  if (!s || !s.ports.length)
    return serviceFallbackHeader(w) + empty(
      "grid",
      "No Web Service is ready",
      "Ask the Agent to build a tool. Service definitions are created by the Agent workflow.",
      btn("Focus chat", "tab-Chat", "primary") + (w.services.length ? btn("Manage services", "manage-services") : ""),
    );
  const serviceKey = `${w.id}:${s.id}:${view.port}`;
  const keepStartingFrame = s.observed === 'Starting' && s.enabled && s.ports.includes(view.port) && w.desired === 'running'
    && (w.status === 'Ready' || w.status === 'Degraded')
    && [...root.querySelectorAll<HTMLIFrameElement>('iframe[data-service-key]')].some(frame => frame.dataset.serviceKey === serviceKey);
  return `${w.resourceErrors?.services?feedback(esc(w.resourceErrors.services),"warning",btn("Retry Services","retry-services","small")):""}<div class="service-toolbar"><div class="service-selector">${btn(`${icon('grid', 16)}<span class="service-name">${esc(s.name)}</span>${badge(s.enabled ? s.observed : 'Disabled')}${icon('down', 13)}`, 'service-picker', 'quiet service-trigger', `id="service-select" data-service-id="${esc(s.id)}" aria-label="Service: ${esc(s.name)}" aria-haspopup="dialog" title="Switch service"`)}</div><div class="actions focus-actions">${adapter.requestPresence.get(`${w.id}:${s.name}`)?.hasRecords ? btn(icon("note", 17), "service-requests", "icon-button quiet", 'aria-label="Agent requests" title="Agent requests"') : ""}${workspaceChatToggle(w)}${focusControls(w)}${btn(icon("external", 16), "open-app", "icon-button quiet", 'aria-label="Open application in new tab"')}${btn(icon("more"), "service-menu", "icon-button quiet", 'aria-label="Service options"')}</div></div>${view.serviceOpenError ? feedback(esc(view.serviceOpenError), "warning", btn("Copy local link", "copy-local", "small")) : ""}${s.enabled && s.observed === "Ready" && adapter.serviceEmbed(w.id, s.id, view.port) === "denied" ? empty("external", "This app opens in its own tab", "The application’s security policy does not allow embedding. Its security policy remains unchanged.", btn(`${icon("external")} Open application tab`, "open-app", "primary")) : (!s.enabled || s.observed !== "Ready") && !keepStartingFrame ? empty("grid", `${esc(s.name)} is ${s.enabled ? esc(s.observed.toLowerCase()) : "disabled"}`, esc(s.error || serviceUnavailableReason(s)), btn("Manage services", "manage-services", "primary")) : adapter.serviceEntryError(w.id, s.id, view.port) ? empty("grid", "Application entry unavailable", esc(adapter.serviceEntryError(w.id, s.id, view.port)), btn("Retry", "retry-service-entry", "primary")) : adapter.serviceEntryUrl(w.id, s.id, view.port) ? serviceViewport(w, s) : (adapter.serviceEntryPending(w.id, s.id, view.port) || adapter.project(w).usable && s.enabled && s.observed === 'Ready' && s.ports.includes(view.port)) ? readPlaceholder(`Opening ${s.name}…`, 'service') : empty("grid", "Application entry not confirmed", s.ports.includes(view.port) ? "Check the current Work and Service status, then retry this entry." : "The requested port is no longer declared by this Service. Select a declared entry in Service details or return to the Work.", btn("Retry", "retry-service-entry", "primary", s.ports.includes(view.port) ? "" : "disabled"))}${adapter.servicePreviewUnconfirmed(w.id, s.id, view.port) ? feedback(esc(adapter.servicePreviewError(w.id, s.id, view.port) || "Preview not confirmed. Check the preview or open it independently."), "warning", btn("Check preview", "check-preview", "small") + btn("Open in new tab", "open-app", "small")) : ""}<div class="service-bottom"><span>${icon("lock", 13)} Private Service connection ${w.resourceChecked?.services?` · Retrieved ${esc(new Date(w.resourceChecked.services).toLocaleTimeString())}`:""}</span><span class="domain" title="${esc(s.domain)}">${esc(s.domain)}</span></div>`;
}
function agent(w: Work, focus: boolean) {
  const session =
    w.sessions.find((s) => s.id === view.session) || w.sessions[0];
  if(session){if(!view.session && view.drafts[draftKey(w,"")] && !view.drafts[draftKey(w,session.id)]){view.drafts[draftKey(w,session.id)]=view.drafts[draftKey(w,"")];textDraftRevisions.set(draftKey(w,session.id),textDraftRevisions.get(draftKey(w,"")) || 0);}const from=draftKey(w,""),to=draftKey(w,session.id);if(imageDrafts.get(from).length&&!imageDrafts.get(to).length&&imageDraftErrors.has(from)){imageDraftErrors.set(to,imageDraftErrors.get(from)!);imageDraftErrors.delete(from);}imageDrafts.move(from,to);view.session=session.id;}
  const supported=adapter.cancelAndSendCapabilities.get(w.id)===1,observed=adapter.activeRuns.get(w.id);
  const observedRun=supported ? observed?.run : w.run;
  const activeRun=observedRun && ["accepted","running","cancelling"].includes(observedRun.status) ? observedRun : null;
  const active=!!activeRun;
  const busy=active && activeRun.sessionId!==session?.id;
  const activeUnconfirmed=supported && (!observed?.confirmed || !!observed.error);
  const checkingActive=activeUnconfirmed && !!observed?.loading && !observed.error;
  const draft = view.drafts[draftKey(w, session?.id || "")] || "";
  adapter.activateChat(w.id,session?.id || "");
  if(!adapter.imageCapabilities.has(w.id))queueMicrotask(()=>{void adapter.loadImageCapabilities(w.id);});
  const modelReady=adapter.modelReady(w.id,session?.id || "");
  const agentError=w.resourceErrors?.agent!==adapter.models.get(w.id)?.error?w.resourceErrors?.agent:'';
  const readingSessions = !w.resourceChecked?.agent && !agentError;
  const conversationError=session?.error || agentError;
  const readingConversation=!!w.resourceLoading?.agent || !!session?.loading;
  const initialConversation=!session?.messages.length && !conversationError && (readingSessions || !!session && !session.checkedAt);
  const draftImages=imageDrafts.get(draftKey(w,session?.id || ""));const imageWaiting=draftImages.length>0 && (!w.resourceChecked?.agent || session?.loading && !session.checkedAt || draftImages.some(image=>image.reading));
  const webDraft=!view.literalSlash && webCommands.includes(/^\/([^\s]+)/.exec(draft.trimStart())?.[1] || "");
  const stopAndSend=supported && active && !activeUnconfirmed && !webDraft;
  return `<section class="agent-panel ${focus ? "focused" : ""}"><div class="agent-header"><span class="agent-title">${icon("spark", 17)} <b>Agent</b>${view.layout !== "workspace" ? `<small title="${esc(w.name)}">${esc(w.name)}</small>` : ""}</span><div>${btn(icon("clock", 16), "sessions", "icon-button quiet", `aria-label="Sessions" title="${readingConversation ? 'Reading conversations…' : 'Sessions'}" ${readingConversation ? 'aria-busy="true" data-read-busy="true"' : ''}`)}${agentLayoutControls(w)}${btn(icon("more", 17), "agent-menu", "icon-button quiet", 'aria-label="Agent options"')}</div></div>${(view.layout==="chat-only" || view.layout==='service-chat' && innerWidth<900) && view.fullscreenError?feedback(esc(view.fullscreenError),"warning"):""}<div class="session-line"><button data-action="sessions" ${readingSessions && !session ? 'aria-label="Loading conversations" aria-busy="true"' : ''}>${readingSessions && !session ? '<span class="read-placeholder-field" aria-hidden="true"></span>' : esc(sessionDisplayName(w,session))}${icon("down", 12)}</button></div><div class="messages" id="messages" data-reading-key="${esc(draftKey(w,session?.id || ""))}">${conversationError?readFailure('Conversation could not be read',conversationError,'retry-conversation',readingConversation):''}${initialConversation ? readPlaceholder('Loading conversation…', 'conversation') : !session?.messages.length && conversationError ? '' : !session?.messages.length ? `<div class="chat-welcome"><span class="chat-symbol">${icon("spark", 28)}</span><h2>What would you like to make?</h2><p>Build a tool, work with your files, or explore an idea together.</p><button data-action="suggest-message">Build a notes app ${icon("chevron", 15)}</button><button data-action="suggest-files">Help me explore my files ${icon("chevron", 15)}</button></div>` : messageMarkup(w,session.id,session.messages)}${session ? unmatchedExecutions(w,session.id,session.messages) : ""}${view.tab === "Chat" && view.layout === "workspace" && w.services.some(s => s.observed === "Ready" && s.ports.length) ? btn(`${icon("grid", 15)} Open service`, "tab-Services", "service-shortcut") : ""}</div>${view.scrollPinned ? "" : btn(`${icon("down", 14)} Back to latest`, "scroll-bottom", "back-latest")}<div class="composer-wrap">${submissionMarkup(w)}${session?.legacy ? feedback("This Session’s context is no longer compatible. Your draft is kept.", "warning", btn("New session", "new-session", "small")) : ""}${activeUnconfirmed && !checkingActive ? feedback(esc(observed?.error || "Conversation status is not confirmed."), observed?.error ? "warning" : "info", btn("Check status", "check-active-run", "small")) : ""}${busy ? feedback(activeRun.source?.kind === "service" ? `A Run from Service ${esc(activeRun.source.serviceName || "")} is active.` : "A Run is active in another Session.", "warning", btn("View active Run", "active-run", "small", `data-run-id="${esc(activeRun.id)}"`)) : ""}<div class="composer">${imageDraftMarkup(w,draftKey(w,session?.id || ""))}<textarea id="composer" rows="3" placeholder="Ask anything about this Work" aria-label="Message the Agent" ${session?.legacy ? 'aria-describedby="composer-help"' : ""}>${esc(draft)}</textarea><div class="composer-bottom">${modelComposer(w,session?.id || "")}<div class="composer-actions">${btn(icon("upload",16),"add-chat-images","icon-button quiet",'title="Add images" aria-label="Add images"')}${btn(icon("settings",16),"chat-input-options","icon-button quiet chat-input-options",`title="Input options" aria-label="Input options" aria-haspopup="dialog" aria-expanded="${view.modal==='chat-input-options'}"`)}${btn(stopAndSend ? "Stop and send" : icon(checkingActive ? "refresh" : "send", 18), "send-message", `send-button${stopAndSend ? " stop-and-send" : ""}${checkingActive ? " is-reading" : ""}`, `aria-label="${checkingActive ? "Checking conversation status" : stopAndSend ? "Stop and send" : "Send message"}" ${checkingActive ? 'aria-busy="true" data-read-busy="true" title="Checking conversation status…"' : ''} ${stopAndSend ? `data-cancel-run-id="${esc(activeRun.id)}"` : ""} ${!adapter.project(w).usable || imageWaiting || !webDraft && (activeUnconfirmed || active && !stopAndSend || session?.legacy || !modelReady) || webDraft && !!adapter.chatSubmissions.get(w.id) ? "disabled" : ""}`)}</div>${commandPalette(w,draft)}</div></div>${modelFeedback(w,session?.id || "")}<div class="composer-caption" id="composer-help">${draft.trimStart().startsWith("/")?btn(view.literalSlash?"Command mode":"Send as text","toggle-slash-mode","text-button",`aria-pressed="${view.literalSlash}"`):""}${draft.trimStart().startsWith("/") && !view.literalSlash ? "Commands use their own arguments; Service identity is not added." : "Enter to send · Shift+Enter for a new line"}</div></div></section>`;
}
function modelComposer(w:Work,sessionId:string) {
 const {name,thinking,state,initialLoading}=chatSettings(w,sessionId);
 if(initialLoading) return btn('<span class="read-placeholder-field" aria-hidden="true"></span>','open-chat-settings','quiet response-settings-trigger','id="response-settings-trigger" aria-label="Loading response settings" aria-busy="true" aria-haspopup="dialog"');
 return btn(`<span class="response-model-name">${esc(name)}</span><span class="response-thinking">· ${esc(thinking)}</span>${icon('down',12)}`,'open-chat-settings','quiet response-settings-trigger',`id="response-settings-trigger" title="${esc(name)}${state.ref===null?' · Work default':''} · Thinking ${esc(thinking)}" aria-label="Response settings: ${esc(name)}; Thinking ${esc(thinking)}. For your next message${sessionId?'':'. For new session'}" aria-haspopup="dialog"`);
}
function sessionDisplayName(w: Work, session?: Work['sessions'][number]): string {
  if (!session) return w.resourceErrors?.agent ? 'Sessions unavailable' : !w.resourceChecked?.agent ? 'Loading conversations…' : 'No Session yet';
  return session.title === `Session ${session.id}` ? `Session ${w.sessions.indexOf(session)+1}` : session.title;
}
function modelDisplayName(model?: { label?:string;model?:string } | null): string {
  if (!model) return 'Unavailable model';
  return /^Runtime(?: model)? revision\b/i.test(model.label || '') ? model.model || 'Work model' : model.label || model.model || 'Work model';
}
function capturedDefaultName(model: {label?:string;model?:string}):string {
  const label=modelDisplayName(model);
  return model.model && label!==model.model ? `${label} (${model.model})` : label;
}
function thinkingName(level:string|null):string { return level===null?'Normal':level ? level[0]!.toUpperCase()+level.slice(1) : 'Unavailable'; }
function chatSettings(w: Work, sessionId: string) {
  const catalog=adapter.models.get(w.id),state=adapter.modelSelection(w.id,sessionId),session=w.sessions.find(s=>s.id===sessionId);
  const model=state.ref===null?catalog?.defaultModel:catalog?.models.find(m=>m.modelRef===state.ref);
  if (!catalog?.confirmed && !catalog?.error && (catalog?.loading || !w.resourceChecked?.agent) && state.phase==='clean') return {catalog,state,model,name:'Loading models…',thinking:'Loading…',editable:false,thinkingEditable:false,status:'Loading models…',initialLoading:true,recovery:undefined};
  const name=model?(state.ref===null?capturedDefaultName(model):modelDisplayName(model)):session?.modelPreference?.modelRef===state.ref?(state.ref===null && session.modelPreference?capturedDefaultName(session.modelPreference):modelDisplayName(session.modelPreference)):state.ref===null?'Work default':'Unavailable model';
  const capability=adapter.chatCapabilities.get(w.id),levels=model?.thinkingLevels;
  const canThink=(capability ?? 0)>=1 && (!!levels?.length || model?.thinkingAvailability==='unknown');
  const thinking=capability===0?'Unavailable':model?.thinkingAvailability==='unknown'?(state.thinking===null?'Normal · Thinking unconfirmed':'Confirm Normal'):canThink?thinkingName(state.thinking):'Unconfirmed';
  const editable=state.phase!=='unknown' && !!catalog?.confirmed && !catalog.error;
  const thinkingEditable=editable && canThink && !(levels?.length===1 && levels[0]===state.thinking);
  const status:string[]=[];
  if(state.phase==='saving') status.push('Saving…');
  else if(state.phase==='unknown') status.push('Unconfirmed.');
  else if(state.phase==='dirty' && sessionId) status.push('Not saved.');
  if(state.error && state.phase!=='clean') status.push(state.error);
  if(catalog?.loading) status.push('Loading models…');
  if(catalog?.error) status.push(`Models are unconfirmed. ${catalog.error}`);
  else if(catalog?.confirmed && !catalog.defaultModel && !catalog.models.length) status.push(catalog.defaultUnavailableReason || 'No models are available. Ask an administrator to enable a model in AI models.');
  else if(catalog?.confirmed && !catalog.defaultModel && state.ref===null) status.push(catalog.defaultUnavailableReason || 'Work default is unavailable. Choose an available model.');
  else if(!catalog?.confirmed && !catalog?.loading) status.push('Models are unconfirmed.');
  if(!catalog?.confirmed || catalog.error) status.push('Displayed values are last known settings.');
  else if(!model || session?.modelPreference?.availability==='unavailable') status.push('Saved settings unavailable. Choose an available model.');
  if(capability===0) status.push('Thinking unavailable in this Work. Update the Work Agent image and Apply to enable model and Thinking settings.');
  else if(catalog?.confirmed && !catalog.error && !canThink) status.push('Thinking capabilities are unconfirmed.');
  else if(levels?.length===1 && levels[0]==='off') status.push('Thinking is not supported by this model.');
  if(capability===1) status.push('This Work uses legacy model settings. Update the Work Agent image and Apply for full multi-provider support.');
  if(!sessionId) status.push('For new session.');
  const recovery=state.phase==='unknown'?{label:'Check chat settings',action:'check-session-model'}:!catalog?.loading && (catalog?.error || !catalog?.confirmed)?{label:'Retry models',action:'load-models'}:state.phase==='dirty' && sessionId?{label:'Retry settings',action:'save-model'}:undefined;
  return {catalog,state,model,name,thinking,editable,thinkingEditable,status:status.join(' '),recovery};
}
function modelFeedback(w: Work, sessionId: string, inPanel=false) {
  const {status,recovery,catalog,initialLoading}=chatSettings(w,sessionId);
  if(initialLoading && !inPanel) return '';
  const live=inPanel || view.modal!=='chat-response-settings';
  const compatibility=inPanel && !catalog?.error ? (catalog?.unavailableModels ?? []).map(model=>`<p>${esc(model.label)}: ${esc(model.recovery)}</p>`).join('') : '';
  return `<div class="options-status" ${inPanel?'id="response-settings-status"':''} ${live?'role="status"':''}>${esc(status)}${recovery?btn(recovery.label,recovery.action,'text-button'):''}${compatibility}</div>`;
}
function chatSettingsContextCurrent() {
  const r=route();
  return view.modal==='chat-response-settings' && view.data.epoch===String(adapter.identityEpoch) && r[0]==='work' && r[1]===view.data.workId && view.session===view.data.sessionId && view.tab===view.data.tab && view.layout!=='service-only';
}
function focusChatSettings(kind?:string) {
  const dialog=root.querySelector<HTMLDialogElement>('#modal'); if(!dialog) return;
  const row=dialog.querySelector<HTMLButtonElement>(kind==='thinking'?'#thinking-select':'#model-select');
  const option=view.data.expanded?(dialog.querySelector<HTMLElement>('[role=option][aria-selected=true]:not([disabled])') || dialog.querySelector<HTMLElement>('[role=option]:not([disabled])')):null;
  const recovery=dialog.querySelector<HTMLElement>('.options-status .button:not([disabled]),.modal-footer .button');
  (option || (row && !row.disabled?row:recovery))?.focus({preventScroll:true});
}
function openChatPicker(kind?:'model'|'thinking') {
  const work=current(); if(!work) return;
  const composer=root.querySelector<HTMLTextAreaElement>('#composer');
  view.commandDismissed=view.drafts[draftKey(work)] || '';
  focusReturn=kind?'#composer':'#response-settings-trigger';
  openModal('chat-response-settings',{workId:work.id,sessionId:view.session,epoch:String(adapter.identityEpoch),tab:view.tab,source:kind?'command':'summary',expanded:kind || '',caretStart:String(composer?.selectionStart ?? 0),caretEnd:String(composer?.selectionEnd ?? 0)});
  focusChatSettings(kind);
}
function confirmPendingChatCommand() {
  const command=pendingWebCommand;
  if(!command?.pair || !command.workId || !['model','thinking'].includes(command.kind)) return;
  const state=adapter.modelSelection(command.workId,command.sessionId || '');
  if((state.phase==='clean' || !command.sessionId && state.phase==='dirty') && state.ref===command.pair.ref && state.thinking===command.pair.thinking) consumeWebSelection(command.kind);
}
function submissionMarkup(w:Work) {
 const intent=adapter.chatSubmissions.get(w.id);
 return intent?feedback(`${esc(intent.error || (intent.cancelRunId ? 'Stopping the previous Run… Waiting up to 5 seconds before sending.' : 'Waiting for acceptance…'))}<details class="chat-submission-details"><summary>Submission details</summary><p>Original ${esc(intent.kind)} key <code>${esc(intent.key)}</code></p></details>`,'warning',btn('Check original submission','check-chat-submission','small')):'';
}
function layoutButton(symbol: string, label: string, action: string, extra = '') {
  return btn(icon(symbol, 16), action, 'icon-button quiet', `title="${esc(label)}" aria-label="${esc(label)}" ${extra}`);
}
function focusControls(w: Work, showError = true) {
  const standalone = route()[0] === 'app', focused = view.layout !== 'workspace', chat = view.layout === 'chat-only';
  const service = activeService(w);
  const available = !!service && service.observed === 'Ready' && !!adapter.serviceEntryUrl(w.id, service.id, view.port) && adapter.serviceEmbed(w.id, service.id, view.port) !== 'denied';
  return focused ? `${chat ? layoutButton('arrow', 'Restore layout', 'restore-layout') : !standalone ? layoutButton('panel-right', view.layout === 'service-chat' ? 'Hide chat' : 'Show chat', 'focus-toggle-chat', `aria-pressed="${view.layout === 'service-chat'}"`) : ''}${layoutButton('close', 'Exit focus', 'exit-service-focus')}${view.layout === 'service-only' && w.run ? `<small class="focus-run-status">Run ${esc(w.run.status)}${w.run.error ? ' · needs attention' : ''}</small>` : ''}${showError && view.fullscreenError ? `<small class="fullscreen-error" role="status">${esc(view.fullscreenError)}</small>` : ''}` : layoutButton('focus', 'Focus', 'service-focus', `aria-pressed="false" ${available ? '' : 'disabled'}`);
}
function browserFullscreenAction() {
  if(view.layout==='workspace' && document.fullscreenElement!==root)return '';
  const full=document.fullscreenElement===root,label=full?'Exit browser full screen':'Browser full screen';
  return btn(`${icon('focus',16)} ${label}`,'service-fullscreen','',`title="${label}" aria-label="${label}" aria-pressed="${full}"`);
}
function agentLayoutControls(w: Work) {
  if (view.layout === 'chat-only') return focusControls(w, false);
  return `${view.layout === 'service-chat' && innerWidth < 900 ? focusControls(w, false) : ''}${layoutButton('focus', 'Focus chat', 'focus-chat', 'aria-pressed="false"')}`;
}
function captureLayoutReturn(anchor: HTMLElement): LayoutReturn {
  return { workId: current()?.id || '', tab: view.tab, layout: view.layout === 'chat-only' ? 'workspace' : view.layout, anchor, selector: focusKey(anchor) };
}
function resetWorkspaceFocus() {
  view.layout = 'workspace'; workspaceReturn = undefined; chatReturn = undefined; view.fullscreenError = '';
}
function restoreLayoutFocus(target?: LayoutReturn) {
  const candidate = target?.anchor?.isConnected ? target.anchor : target?.selector ? root.querySelector<HTMLElement>(target.selector) : null;
  const visible = (node: HTMLElement | null | undefined) => node && !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
  if (visible(candidate)) candidate!.focus({ preventScroll: true });
  else [...root.querySelectorAll<HTMLElement>('[data-action=restore-layout],[data-action=exit-service-focus],[data-action=focus-chat],[data-action=service-focus],[data-action^=tab-]')].find(visible)?.focus({ preventScroll: true });
}
function enterWorkspaceFocus(mode: 'service-chat' | 'service-only' | 'chat-only', anchor: HTMLElement) {
  if (view.layout === mode) { closeModal(); return; }
  areaChoice++;
  if (!workspaceReturn) workspaceReturn = captureLayoutReturn(anchor);
  if (mode === 'chat-only' && view.layout !== 'chat-only') chatReturn = captureLayoutReturn(anchor);
  view.layout = mode; closeModal(); render(); restoreLayoutFocus();
}
function restoreChatLayout() {
  if (view.layout !== 'chat-only') return;
  const target = chatReturn;
  view.layout = target?.layout || 'workspace';
  chatReturn = undefined;
  if (view.layout === 'workspace') { workspaceReturn = undefined; view.fullscreenError = ''; }
  render(); restoreLayoutFocus(target);
}
async function exitWorkspaceFocus() {
  if(view.layout==='workspace' && document.fullscreenElement!==root)return true;
  const epoch = adapter.identityEpoch, origin = location.hash, choice = areaChoice, target = workspaceReturn;
  const valid = () => epoch === adapter.identityEpoch && origin === location.hash && choice === areaChoice && target === workspaceReturn;
  if (document.fullscreenElement === root) {
    try { await document.exitFullscreen(); if (!valid()) return false; if (document.fullscreenElement === root) throw new Error(); }
    catch { if (valid()) { view.fullscreenError = 'Full screen could not be closed. Exit full screen and try again.'; render(); } return false; }
  }
  if (!valid()) return false;
  if (target) view.tab = target.tab;
  resetWorkspaceFocus(); render(); restoreLayoutFocus(target); return true;
}
function isRequestInspector() { return ['pi-requests', 'pi-request-detail'].includes(view.modal); }
function nonmodalDialog() { return overlayRole(view.modal)!=='modal' || view.modal === 'export' || isRequestInspector() && innerWidth >= 900; }
function backToRequests() {
  if (!requestNavigationCurrent()) return;
  const nav=requestNavigation!; modalChoice++; view.modal='pi-requests'; view.data={source:nav.source,serviceName:nav.serviceName}; view.modalError=''; render();
  const body=root.querySelector<HTMLElement>('.modal-body'); if(body)body.scrollTop=nav.scroll;
  if(nav.focus)root.querySelector<HTMLElement>(nav.focus)?.focus({preventScroll:true});
}
function requestStateLabel(state: string) {
  return ({pending:'Pending',running:'Running',waiting_result:'Waiting for result',waiting_apply:'Waiting for apply',needs_attention:'Needs attention',completed:'Completed',cancelled:'Cancelled',cancelling:'Cancelling',failed:'Failed'} as Record<string,string>)[state] || state;
}
function executionMarkup(w: Work, sessionId: string, runId: string) {
  const observed=adapter.activeRuns.get(w.id), activeObserved=observed?.confirmed && observed.run?.id===runId?observed.run:undefined;
  const run=(w.run?.id===runId?w.run:undefined) || activeObserved || w.sessions.find(session=>session.id===sessionId)?.runs?.find(item=>item.id===runId) || adapter.runDetails.get(`${w.id}:${runId}`);
  const active=adapter.cancelAndSendCapabilities.get(w.id)===1 ? observed?.confirmed && !observed.error ? observed.run : undefined : w.run;
  const cancellable=active?.id===runId && ['accepted','running','cancelling'].includes(active.status);
  return `<div class="message-execution" data-message-key="${esc(`${adapter.identityEpoch}:${w.id}:${sessionId}:execution:${runId}`)}"><div class="execution-summary">${run?badge(`Run ${run.status}`):'<span>Execution</span>'}${btn('Details','run-details','text-button',`data-run-id="${esc(runId)}" aria-label="Run details"`)}${cancellable?btn(active.cancellationRequested || active.status==='cancelling'?'Cancelling…':'Cancel run','cancel-run','text-button',`data-run-id="${esc(runId)}" ${active.cancellationRequested || active.status==='cancelling'?'disabled':''}`):''}</div>${run?.error?feedback(esc(run.error),'warning'):''}${run && run.id===w.run?.id && ['interrupted','accepted','running','cancelling'].includes(run.status) && (run.error || run.status==='interrupted')?btn('Resume original Run','resume-run','text-button',`data-run-id="${esc(runId)}"`):''}</div>`;
}
function unmatchedExecutions(w: Work, sessionId: string, messages: import('./models.js').Message[]) {
  const bound=new Set(messages.map(message=>message.runId).filter(Boolean));
  const runs=[...(w.sessions.find(session=>session.id===sessionId)?.runs || [])];
  if(w.run?.sessionId===sessionId && !runs.some(run=>run.id===w.run!.id))runs.push(w.run);
  const active=adapter.activeRuns.get(w.id);
  if(active?.confirmed && active.run?.sessionId===sessionId && !runs.some(run=>run.id===active.run!.id))runs.push(active.run);
  const missing=runs.filter(run=>!bound.has(run.id));
  if(!missing.length)return '';
  const current=missing.filter(run=>run.error || ['accepted','running','cancelling','failed','interrupted'].includes(run.status)), history=missing.filter(run=>!current.includes(run));
  return `<div class="unmatched-executions">${current.map(run=>executionMarkup(w,sessionId,run.id)).join('')}${history.length?`<details><summary>Session executions · ${history.length}</summary>${history.map(run=>executionMarkup(w,sessionId,run.id)).join('')}</details>`:''}</div>`;
}
function workspaceChatToggle(w: Work) {
  if(route()[0]==='app' || view.layout!=='workspace' || view.tab!=='Services')return '';
  const panels=workspacePanels.get(w.id),hidden=innerWidth<900?!panels.narrowChat:panels.collapsed;
  return layoutButton('panel-right', hidden ? 'Show chat' : 'Hide chat', 'toggle-workspace-chat', `aria-expanded="${!hidden}" aria-controls="workspace-chat"`);
}
let preserveChatReading = false;
function rememberChatPosition() {
  const messages=root.querySelector<HTMLElement>('#messages');if(!messages?.clientHeight || !messages.dataset.readingKey)return;
  const first=!view.scrollPinned?[...messages.querySelectorAll<HTMLElement>('[data-message-key]')].find(node=>node.getBoundingClientRect().bottom>messages.getBoundingClientRect().top):undefined;
  chatReading.set(messages.dataset.readingKey,{scroll:messages.scrollTop,pinned:view.scrollPinned,anchor:first?{key:first.dataset.messageKey,offset:first.getBoundingClientRect().top-messages.getBoundingClientRect().top}:undefined});
}
function restoreChatPosition() {
  const messages=root.querySelector<HTMLElement>('#messages');if(!messages?.clientHeight)return;
  const saved=chatReading.get(messages.dataset.readingKey || '');if(!saved)return;
  messages.scrollTop=saved.pinned?messages.scrollHeight:saved.scroll;
  if(!saved.pinned && saved.anchor){const anchor=[...messages.querySelectorAll<HTMLElement>('[data-message-key]')].find(node=>node.dataset.messageKey===saved.anchor!.key);if(anchor)messages.scrollTop+=anchor.getBoundingClientRect().top-messages.getBoundingClientRect().top-saved.anchor.offset;}
}
function applyWorkspaceSizing() {
  const layout=root.querySelector<HTMLElement>('.service-workspace'),separator=root.querySelector<HTMLElement>('#workspace-splitter'),work=current();
  if(!layout || !separator || !work)return;
  const geometry=splitGeometry(layout.clientWidth,workspacePanels.get(work.id).ratio);
  layout.style.setProperty('--service-size',`${geometry.service}px`);
  separator.setAttribute('aria-valuenow',String(Math.round(geometry.ratio*100)));
  separator.setAttribute('aria-valuemin',String(Math.round(geometry.minimum/geometry.available*100)));
  separator.setAttribute('aria-valuemax',String(Math.round(geometry.maximum/geometry.available*100)));
  separator.setAttribute('aria-valuetext',`${Math.round(geometry.ratio*100)}% Service, ${100-Math.round(geometry.ratio*100)}% Chat`);
}
function messageMarkup(w:Work,sessionId:string,messages:import('./models.js').Message[]) {
 const groups=activityGroups(messages), anchors=executionAnchors(groups);
 return groups.map((group,index)=>{
 const execution=(anchors.get(index)||[]).map(id=>executionMarkup(w,sessionId,id)).join('');
 const key=`${adapter.identityEpoch}:${w.id}:${sessionId}:${group.key}`;
 if(group.activity){const running=group.messages.some(m=>m.tool?.status==='Running'),failures=group.messages.filter(m=>m.tool?.status==='Failed'),unknown=group.messages.some(m=>m.tool?.status?.includes('confirmed'));
 return `<details class="activity" data-message-key="${esc(key)}" data-activity-key="${esc(key)}" ${expandedActivity.get(key)?'open':''}><summary>${icon('terminal',14)} Activity · ${group.messages.length} ${group.messages.length===1?'tool':'tools'} · ${failures.length?'Needs attention':running?'Running':unknown?'Result not confirmed':'Completed'}${failures.length?` · ${failures.length} failed<small class="activity-error">${esc(failures[0]?.tool?.content?.slice(0,160) || 'A tool failed. Open Activity to review the result.')}</small>`:''}</summary>${group.messages.map(m=>`<details class="tool-event" data-message-key="${esc(`${key}:${m.tool?.id || m.id}`)}" data-activity-key="${esc(`${key}:${m.tool?.id || m.id}`)}" ${expandedActivity.get(`${key}:${m.tool?.id || m.id}`)?"open":""}><summary>${esc(m.tool?.name)} · ${esc(m.tool?.status)}</summary><pre>${esc(m.tool?.content)}</pre></details>`).join('')}</details>${execution}`;}
 return group.messages.map(m=>`<div class="message ${m.role}" data-message-key="${esc(key)}">${m.role==='assistant'?`<div class="message-author">${icon('spark',14)} piwork</div>`:''}<div class="message-text${m.role==='assistant'?' chat-markdown':''}">${m.role==='assistant'?renderChatMarkdown(m.text):esc(m.text)}</div>${m.images?.length?`<div class="chat-message-images">${m.images.map(image=>historyImageMarkup(w,sessionId,m.runId!,image)).join('')}</div>`:''}${m.source?`<button class="source-chip" data-action="open-source" data-path="${esc(m.source)}">${icon('file',13)} ${esc(m.source)}</button>`:''}</div>`).join('')+execution;
 }).join('');
}
const webCommands=['new','resume','model','thinking','settings'];
function paletteToken(draft:string){const match=/^(\s*)\/([^\s]*)/.exec(draft);return match && view.commandCaret>=match[1]!.length+1 && view.commandCaret<=match[0].length?match[2]!:undefined;}

function commandChoices(w:Work,draft:string) {
 if(view.literalSlash || view.commandDismissed===draft || paletteToken(draft)===undefined)return [];
 const query=paletteToken(draft)!.toLowerCase();
 const directory=adapter.commands.get(w.id);
 return [...webCommands.map(name=>({command:`/${name}`,kind:'web',description:{new:'Start a new Session',resume:'Choose a saved Session',model:'Choose a model',thinking:'Choose a Thinking level',settings:'Open Work settings'}[name] || '',sourceName:'Desktop'})),...(directory?.confirmed && !directory.error?directory.items:[])].filter(command=>command.command.slice(1).toLowerCase().includes(query)).slice(0,30);
}
function commandPalette(w:Work,draft:string) {
 const items=commandChoices(w,draft);if(view.literalSlash || view.commandDismissed===draft || paletteToken(draft)===undefined)return '';
 if(!adapter.commands.has(w.id) && adapter.chatCapabilities.has(w.id))queueMicrotask(()=>{if(!adapter.commands.has(w.id))void adapter.loadCommands(w.id);});
 view.commandIndex=Math.min(view.commandIndex,Math.max(0,items.length-1));
 const directory=adapter.commands.get(w.id);
 return `<div class="command-palette menu-list" role="listbox" aria-label="Slash commands">${items.map((command,index)=>`${index===0 || items[index-1]?.kind!==command.kind?`<small>${esc(command.kind==='web'?'Workspace':command.kind==='skill'?'Skills':'Prompt templates')}</small>`:''}<button class="button" data-action="choose-command" data-command="${esc(command.command)}" role="option" aria-selected="${index===view.commandIndex}"><strong>${esc(command.command)}</strong><span>${esc(command.description)}</span><small>${esc(command.sourceName)}</small></button>`).join('')}${directory?.loading?'<p>Loading resource commands…</p>':directory?.error?`<p role="status">${esc(directory.error)} ${btn('Retry','load-commands','text-button')}</p>`:directory?.confirmed && !directory.items.length?'<p>No resource commands in this Work.</p>':''}${!items.length?'<p>No matching commands. Choose another command or send as text.</p>':''}</div>`;
}
function fillCommand(command:string) {
 const work=current();if(!work)return;const key=draftKey(work),draft=view.drafts[key] || '';
 textDraftRevisions.set(key,(textDraftRevisions.get(key) || 0)+1);view.drafts[key]=draft.replace(/^(\s*)\/[^\s]*/,`$1${command}`)+( /\s/.test(draft.trimStart())?'':' ');view.commandIndex=0;render();const input=root.querySelector<HTMLTextAreaElement>('#composer');if(input){input.value=view.drafts[key];input.focus();const position=(/^\s*\/[^\s]*/.exec(input.value)?.[0].length ?? input.value.length)+1;view.commandCaret=Math.min(position,input.value.length);input.setSelectionRange(view.commandCaret,view.commandCaret);}
}
function fileRefreshButton(w: Work) {
  const record=[...actions.records.values()].filter(item=>item.action==='refresh-files' && item.work===w.id && item.resource===(view.file || view.path) && item.view===location.hash).sort((a,b)=>b.token-a.token)[0];
  const pending=!!record?.pending || !!adapter.directories.get(`${w.id}:${view.path}`)?.loading;
  const label=pending?(record && Date.now()-record.started>=10000?'Still reading files…':'Reading files…'):'Refresh files';
  return btn(icon('refresh',16),'refresh-files',`icon-button quiet file-refresh ${pending?'is-reading':''}`,`aria-label="${label}" title="${label}" ${pending?'disabled aria-busy="true" data-read-busy="true"':''}`);
}
function files(w: Work) {
  const directory = adapter.directories.get(`${w.id}:${view.path}`);
  const filesError=directory?.error || (!directory && view.path === '/' ? w.resourceErrors?.files : '') || (adapter.state.scenario === 'files-failed' ? 'The file capability could not be reached.' : '');
  const initialRead=!directory?.checkedAt && !filesError;
  const f = w.files.find((x) => x.path === view.file);
  const list = w.files.filter((x) => {
    const parent = x.path.slice(0, x.path.lastIndexOf("/")) || "/";
    return parent === view.path;
  });
  return `${filesRestoreNotice ? feedback(esc(filesRestoreNotice), "warning") : ""}${filesError?readFailure(`Could not read ${view.path}`,filesError,"refresh-files",!!directory?.loading):""}${uploadProgressMarkup()}<div class="files-toolbar"><div class="breadcrumbs"><button data-action="file-path" data-path="/">${icon("folder", 16)} Workspace</button>${view.path
    .split("/")
    .filter(Boolean)
    .map(
      (p, i, a) =>
        `${icon("chevron", 12)}<button data-action="file-path" data-path="/${esc(a.slice(0, i + 1).join("/"))}">${esc(p)}</button>`,
    )
    .join(
      "",
    )}</div><div class="actions file-toolbar-actions">${!f && view.selected.length ? `<span class="selection-count" role="status">${view.selected.length} selected</span>${btn(icon("copy",16), "file-copy", "icon-button quiet", 'aria-label="Copy selected files" title="Copy selected files"')}${btn(icon("move",16), "file-move", "icon-button quiet", 'aria-label="Move selected files" title="Move selected files"')}${btn(icon("trash",16), "file-delete", "icon-button quiet danger", 'aria-label="Delete selected files" title="Delete selected files"')}${btn(icon("close",16), "clear-selection", "icon-button quiet", 'aria-label="Clear selection" title="Clear selection"')}` : `${fileRefreshButton(w)}<div class="file-add-anchor">${btn(icon('more',16),'file-add','icon-button quiet',`id="file-add-trigger" aria-label="More file actions" title="More file actions" aria-haspopup="menu" aria-expanded="${!!fileActionsContext}" aria-controls="file-actions"`)}${fileActionsContext ? `<div id="file-actions" class="file-actions-menu" role="menu" aria-label="File actions">${btn(`${icon('upload',16)} Upload files`,'upload','','role="menuitem" tabindex="-1"')}${btn(`${icon('folder',16)} New folder`,'new-folder','','role="menuitem" tabindex="-1"')}<div class="file-actions-separator" role="separator"></div>${btn(`${icon('external',16)} Connect with WebDAV`,'webdav','','role="menuitem" tabindex="-1"')}</div>` : ''}</div>`}</div></div>${f ? textEditor(f) : `${initialRead ? readPlaceholder(`Loading ${view.path}…`) : !directory?.checkedAt && filesError ? '' : list.length ? `<div class="file-table"><div class="file-head"><span></span><span>NAME</span><span>SIZE</span><span>MODIFIED</span><span></span></div>${list.map((f) => `<div class="file-row"><label class="file-select-hit"><input type="checkbox" aria-label="Select ${esc(f.name)}" data-file-select="${esc(f.path)}" ${view.selected.includes(f.path) ? "checked" : ""}></label><button class="file-name" data-action="open-file" data-path="${esc(f.path)}">${icon(f.kind === "directory" ? "folder" : f.kind === "special" ? "terminal" : "file", 19)}<span>${esc(f.name)}<small>${f.kind === "special" ? "Special item" : f.kind === "directory" ? "Folder" : f.kind === "binary" ? "Binary file" : f.kind === "text" ? "UTF-8 text" : "File"}</small></span></button><span>${f.kind === "directory" || f.kind === "special" ? "—" : size(f.size)}</span><span>${esc(f.modified)}</span>${btn(icon("more"), "file-menu", "icon-button quiet", `data-path="${esc(f.path)}" aria-label="Actions for ${esc(f.name)}"`)}</div>`).join("")}</div>` : empty("folder", "This folder is empty", "Upload files or create a folder to get started.", btn("Upload files", "upload", "primary"))}`}${transferResults()}`;
}
const decodePaths = (value?: string): string[] =>
  value ? JSON.parse(value) : [];
const size = (n: number) =>
  n >= 1048576
    ? `${(n / 1048576).toFixed(1)} MiB`
    : n >= 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${n} B`;
function transferResults() {
  const results = current() ? adapter.transfersByWork.get(current()!.id) || [] : [];
  return results.some(result => result.status !== "succeeded")
    ? `<section class="transfer-results"><h3>Transfer results <span>${results.some((r) => r.status !== "succeeded") ? "Some paths need attention" : ""}</span></h3>${results.map((r) => `<div class="transfer-row">${icon(r.status === "succeeded" ? "check" : "info", 14)}<code>${esc(r.path)}</code><span>${esc(r.message)}</span></div>`).join("")}${results.some((r) => r.status === "unknown") ? btn("Refresh to verify target", "refresh-files", "small") : ""}</section>`
    : "";
}
function textEditor(f: WorkspaceFile) {
  const editable = view.fileEditable;
  return `<div class="editor-toolbar">${btn(`${icon("arrow", 16)} Back to files`, "close-file", "quiet small")}<strong>${esc(f.name)}</strong>${badge(dirty() ? "Unsaved" : "Saved")}</div>${editable ? `${!view.fileBaseline ? feedback("No modification time is available. Concurrent changes cannot be protected.", "warning", btn("Allow unprotected overwrite", "allow-unprotected-file", "small")) : ""}${view.fileWriteUncertain ? feedback("The previous write needs review. Reread the target before saving again.", "warning", btn("Reread saved version", "refresh-files", "small")) : ""}${view.fileReread ? `<section class="file-reread"><h3>Current saved version · read only</h3><pre>${esc(view.fileReread.content ?? "This target is no longer editable text.")}</pre>${btn("Overwrite this reread version", "use-reread-version", "small", view.fileReread.kind === "text" ? "" : "disabled")}</section>` : ""}<textarea id="file-editor" class="file-editor" spellcheck="false" aria-label="Edit ${esc(f.name)}">${esc(view.fileDraft)}</textarea><div class="editor-footer"><span>UTF-8 · ${size(new TextEncoder().encode(view.fileDraft).length)} / 1 MiB limit · Version checks have second precision</span><div class="actions">${btn("Download saved version", "download-file", "quiet", `data-path="${esc(f.path)}"`)}${btn("Discard", "discard-file", "quiet", dirty() ? "" : "disabled")}${btn("Save file", "save-file", "primary", dirty() ? "" : "disabled")}</div></div>` : empty(f.kind === "special" ? "terminal" : "file", f.kind === "special" ? "This is a special filesystem item" : f.kind === "binary" ? "Download to open this binary file" : f.kind === "file" ? "Open this file to inspect its contents" : "This file exceeds the editing limit", f.kind === "special" ? "Special items cannot be treated as ordinary editable files." : "The in-browser editor supports UTF-8 text up to 1 MiB.", f.kind === "special" ? "" : btn(`${icon("download")} Download file`, "download-file", "primary", `data-path="${esc(f.path)}"`))}`;
}
function settingsPage(w: Work) {
  const configurationError = w.resourceErrors?.configuration;
  if (configurationError && !view.config && !w.resourceChecked?.configuration) return `<main class="settings-page">${btn(`${icon("arrow",16)} Back to Work`,"back-work","quiet settings-back")}<h1>Work settings</h1>${feedback(esc(configurationError), "warning", btn("Refresh configuration", "refresh-config", "primary"))}</main>`;
  if (!view.config) view.config = structuredClone(w.config);
  const c = view.config,
    pending = w.config.pendingApply === true;
  const applyRecord=[...actions.records.values()].filter(item=>item.work===w.id && item.action==='apply-config').sort((a,b)=>b.token-a.token)[0];
  const applyOperations=adapter.state.operations.filter(item=>item.workId===w.id && ['Apply configuration','Apply Work configuration','apply-work-configuration'].includes(item.kind));
  const applyOperation=applyRecord ? applyOperations.find(item=>!!applyRecord.businessId && item.id===applyRecord.businessId) : [...applyOperations].sort((a,b)=>(Date.parse(b.created)||0)-(Date.parse(a.created)||0))[0];
  const applying=!!applyRecord?.pending || !!applyOperation && ['accepted','pending','preparing','running'].includes(applyOperation.state);
  const applyError=applyRecord?.error || (applyOperation?.state==='failed'?applyOperation.error || 'Apply failed':'');
  const unknown=!!applyRecord?.blocked || applyOperation?.state==='unknown';
  const attention=view.configDirty || pending || applying || applyError || unknown || configurationError;
  const stateLabel=view.configDirty?'Unsaved changes':applying?'Applying':unknown?'Apply not confirmed':applyError?'Apply failed':pending?'Not applied':'Configuration in use';
  const stateBody=view.configDirty?'Save your draft before applying.':applying?'Using the previous active configuration.':unknown?'Check the original Apply before trying again.':applyError?esc(applyError):pending?'Saved changes are not active yet.':'';
  const statusActions=`${btn(icon('refresh',15),'refresh-config','icon-button quiet','aria-label="Refresh configuration status" title="Refresh configuration status"')}${applyOperation && (applying || unknown || applyError)?btn('Check Apply','operation','small',`data-id="${esc(applyOperation.id)}"`):''}${view.configDirty?btn('Save changes','save-config','primary'):pending && !applying && !unknown?btn('Apply changes','apply-config','primary',adapter.project(w).usable?'':'disabled title="Start or check this Work before applying saved settings"'):''}`;
  return `<main class="settings-page">${configurationError ? feedback(`${esc(configurationError)} Last confirmed configuration and your draft are preserved.`, "warning") : ""}<div class="settings-navigation">${btn(`${icon('arrow',16)} Back to Work`,'back-work','quiet settings-back')}</div><div class="settings-heading"><h1>Work settings</h1>${!attention?`<div class="configuration-compact">${badge('Configuration in use')}${statusActions}</div>`:''}</div>${attention?`<div class="configuration-state"><div><strong>${esc(stateLabel)}</strong><span>${stateBody}</span></div><div class="actions">${statusActions}</div></div>`:''}<nav class="settings-tabs">${["Skills", "Pi Packages", "AGENTS.md", "Advanced"].map((t) => btn(t, "settings-section", view.settingsTab === t ? "tab active" : "tab", `data-tab="${t}"`)).join("")}</nav><div class="settings-content">${view.settingsTab === "Skills" ? skillsSettings(w, c) : view.settingsTab === "Pi Packages" ? packagesSettings(w, c) : view.settingsTab === "AGENTS.md" ? `<div class="section-heading"><div><h2>Instructions for your Agent</h2><p>AGENTS.md is included with this Work’s capability configuration.</p></div>${btn(`${icon("upload", 15)} Import file`, "import-agents", "small")}</div><div class="config-labels"><span>${w.config.pendingApply ? "Previous active configuration" : "Configuration in use"}</span><span>Saved configuration</span></div><label class="field">Desired AGENTS.md<textarea id="agents-editor" class="code-editor" rows="13">${esc(c.agents)}</textarea></label><details class="details-box"><summary>Current active content</summary><pre>${esc(w.config.active?.agentsMd ?? "No active configuration is reported")}</pre></details>` : `<div class="section-heading"><div><h2>Advanced configuration</h2><p>Public runtime configuration. Platform secrets are never displayed.</p></div>${btn(`${icon("upload", 15)} Import JSON`, "import-json", "small")}</div><label class="field">Configuration JSON<textarea id="advanced-editor" aria-label="Configuration JSON" class="code-editor" rows="17" spellcheck="false">${esc(c.advanced)}</textarea></label>${c.validationError ? feedback(esc(c.validationError), "warning") : ""}<p class="muted">Includes the image, model reference, MCP, resources, and tool policy. Validate against the current Core contract before production use.</p>`}</div>${view.configDirty ? `<div class="settings-savebar"><span>You have unsaved changes</span><div class="actions">${btn("Discard changes", "discard-config")}${btn("Save changes", "save-config", "primary")}</div></div>` : ""}</main>`;
}
function catalogFeedback(name: 'skills' | 'packages') {
  const status = adapter.catalog[name];
  return (status.loading ? feedback(`Checking ${name} catalog. Saved copies and selections are preserved.`) : '') + (status.error ? feedback(`${esc(status.error)} Saved Work copies and selections are preserved.`, 'warning') : '');
}
function skillsSettings(w: Work, c: Configuration) {
  return `<div class="section-heading"><div><h2>Skills</h2><p>Choose the capabilities available to this Work.</p></div>${btn("Check catalog", "check-catalog", "quiet small")}${btn("Clear selection", "clear-skills", "quiet small")}</div>${catalogFeedback("skills")}<div class="selection-note">${icon("info", 15)} Checked Skills keep this Work’s saved copy. Select “Use current Core copy” to replace it.</div><div class="capability-list">${adapter
    .getSkills()
    .map(
      (s) =>
        `<article class="capability"><label class="capability-check"><input type="checkbox" data-skill="${esc(s.id)}" ${c.skills.includes(s.id) ? "checked" : ""}><span class="capability-icon">${icon(s.id === "data-analysis" ? "counter" : s.id === "web-tools" ? "grid" : "note", 20)}</span><span><strong>${esc(s.name)}</strong><small>${esc(s.description || "Description not provided")}</small></span></label><div class="capability-meta"><span>${s.version ? `v${s.version}` : "Version not provided"}</span>${btn("Details", "skill-detail", "text-button", `data-id="${s.id}"`)}</div><div class="capability-status"><span>${c.skills.includes(s.id) ? "Selected Work copy" : "Not selected"}</span>${w.config.skills.includes(s.id) ? `<span>${skillState(w, s.id, "loaded")}</span><span>${skillState(w, s.id, "modelVisible")}</span>` : ""}${btn("Use current Core copy", "core-skill-copy", "text-button", `data-id="${s.id}" ${adapter.catalog.skills.error || !adapter.catalog.skills.confirmed || !adapter.getSkills().some(entry => entry.id === s.id && entry.description !== "Saved Work copy; unavailable in current Core catalog") ? "disabled" : ""}`)}</div></article>`,
    )
    .join("")}</div>`;
}
function packagesSettings(w: Work, c: Configuration) {
  return `<div class="section-heading"><div><h2>Pi Packages</h2><p>Agent capabilities installed for this Work.</p></div>${btn(`${icon("plus", 15)} Install package`, "install-package", "primary small")}</div><div class="capability-list package-list">${c.packages.length ? c.packages.map((p) => `<article class="capability package-capability"><div class="capability-check package-identity"><span class="capability-icon">${icon("grid", 20)}</span><span class="package-copy"><strong>${esc(p.name)}</strong><small>${esc(p.source)}</small></span></div>${btn("Details", "package-detail", "quiet small package-details", `data-id="${esc(p.name)}"`)}<div class="package-status">${badge(p.enabled ? "Enabled" : "Disabled")}<span>${packageStatus(w, p.name)}</span></div><div class="package-actions">${btn(p.enabled ? "Disable" : "Enable", "toggle-package", "quiet small", `data-id="${esc(p.name)}"`)}${btn("Update source", "update-package", "quiet small", `data-id="${esc(p.name)}"`)}${btn("Remove", "remove-package", "small danger", `data-id="${esc(p.name)}"`)}</div></article>`).join("") : empty("grid", "No packages selected", "Install a Pi Package or leave this Work without additional packages.")}${catalogFeedback("packages")}<div class="catalog-heading"><h3>Available from Core</h3><div class="catalog-actions">${btn("Check catalog", "check-catalog", "quiet small")}${btn("Clear Work selection", "clear-packages", "quiet small")}</div></div>${adapter
    .getPackages()
    .map(
      (p) =>
        `<div class="catalog-row package-catalog-row"><span class="capability-icon">${icon("grid", 20)}</span><div class="package-copy"><strong>${esc(p.name)}</strong><p>${esc(p.description || "Description not provided")} · ${p.version || "Version not provided"}</p></div>${btn("Select", "select-package", "small", `data-id="${esc(p.name)}" ${adapter.catalog.packages.error || !adapter.catalog.packages.confirmed ? "disabled" : ""}`)}</div>`,
    )
    .join("")}</div>`;
}
function requestCancellable(request: Record<string,any>) { return canCancelPiRequest(request, true) || request.disposition === 'live' && request.state === 'cancelling'; }
function runFacts(run: Run) {
  return `<dl><dt>Run status</dt><dd>${badge(run.status)}</dd><dt>Actual model</dt><dd>${esc(modelDisplayName(run.actualModel))}</dd><dt>Thinking</dt><dd>${esc(run.thinkingLevel===null?'Normal (Thinking unconfirmed)':run.thinkingLevel || 'off')}</dd><dt>Source</dt><dd>${esc(run.source?.kind==='service'?`Service: ${run.source.serviceName || 'automatic'}`:run.source?.kind==='chat'?'Chat':'Unknown')}${run.source?.requestId?` · Request <code>${esc(run.source.requestId)}</code>`:''}${run.source?.phase?` · ${esc(run.source.phase)}`:''}</dd><dt>Submitted</dt><dd>${esc(run.created || 'Unavailable')}</dd>${run.finished?`<dt>Finished</dt><dd>${esc(run.finished)}</dd>`:''}</dl>`;
}
function dismissAnchoredOverlay() {
  if(!anchoredOverlay(view.modal))return;
  if(view.modal==='chat-response-settings' && pendingWebCommand && ['model','thinking'].includes(pendingWebCommand.kind) && !pendingWebCommand.pair)pendingWebCommand=undefined;
  const trigger=overlayAnchor?root.querySelector<HTMLElement>(overlayAnchor):null;
  trigger?.setAttribute('aria-expanded','false');trigger?.removeAttribute('aria-controls');
  const dialog=root.querySelector<HTMLDialogElement>('#modal');
  modalChoice++;view.modal='';view.modalError='';view.modalNameError=null;
  dialog?.close();dialog?.remove();
}
function positionOverlay(dialog: HTMLDialogElement) {
  const anchor=overlayAnchor?root.querySelector<HTMLElement>(overlayAnchor):null;
  if(!anchor?.getClientRects().length || overlayContext!==`${adapter.identityEpoch}:${location.hash}:${view.tab}:${view.path}`){dismissAnchoredOverlay();return;}
  dialog.style.maxHeight='calc(100dvh - 16px)';
  const rect=anchor.getBoundingClientRect();
  if(rect.bottom<0 || rect.top>innerHeight || rect.right<0 || rect.left>innerWidth){dismissAnchoredOverlay();return;}
  const placed=overlayPlacement(rect,dialog.getBoundingClientRect(),{width:innerWidth,height:innerHeight});
  dialog.style.left=`${placed.left}px`;dialog.style.top=`${placed.top}px`;dialog.style.maxHeight=`${placed.maxHeight}px`;
}
function syncDialogPresentation(dialog: HTMLDialogElement, nonmodal: boolean) {
  if (dialog.open && dialog.matches(':modal') === nonmodal) dialog.close();
  if (!dialog.open) { if (nonmodal) dialog.show(); else dialog.showModal(); }
}
function exportPanel(target?: Work) {
  const flow = view.data.flowId ? exportFlows.get(view.data.flowId) : undefined;
  const selectedID = flow?.snapshotId || view.data.snapshotId;
  const snap = selectedID ? adapter.getSnapshot(selectedID) : undefined;
  const job = snap ? adapter.downloads.get(snap.id) : undefined;
  const active = target ? exportFlows.forWork(target.id) : undefined;
  const busy = !!active && !active.terminal;
  const phases: Record<string, string> = { checking: 'Checking Work', stopping: 'Waiting for Work to stop', exporting: 'Starting export', snapshot: 'Creating package', preparing: 'Transferring and verifying', ready: 'Ready to download', delivered: 'Download started', unknown: 'Check export status', failed: 'Export needs attention', revoked: 'Access ended' };
  const title = flow ? phases[flow.phase] || flow.phase : 'Work package';
  const canSave = snap?.status === 'verified' && job?.ready && exportSnapshotAvailable(snap);
  const details = `${flow?.stopOperationId ? `<dt>Stop</dt><dd>${btn(esc(flow.stopOperationId), 'operation', 'text-button', `data-id="${esc(flow.stopOperationId)}"`)}</dd>` : ''}${flow?.exportOperationId || snap?.operationId ? `<dt>Export</dt><dd>${btn(esc(flow?.exportOperationId || snap?.operationId), 'operation', 'text-button', `data-id="${esc(flow?.exportOperationId || snap?.operationId)}"`)}</dd>` : ''}${snap ? `<dt>Snapshot</dt><dd><code>${esc(snap.id)}</code></dd><dt>Status</dt><dd>${badge(snap.status)}</dd><dt>Size</dt><dd>${esc(snap.size || 'Not provided')}</dd><dt>Expires</dt><dd>${esc(snap.expiresAt || 'Not provided')}</dd>` : ''}`;
  const known = target ? adapter.state.snapshots.filter(value => value.workId === target.id && value.id !== selectedID) : [];
  const controls = flow && !flow.terminal ? `${btn('Check status', 'check-export-flow', 'small', `data-id="${esc(flow.id)}"`)}${!flow.terminal ? btn(flow.paused ? 'Resume' : 'Pause', flow.paused ? 'resume-export-flow' : 'pause-export-flow', 'small', `data-id="${esc(flow.id)}"`) : ''}` : '';
  const error = flow?.error || snap?.error || job?.error || job?.observationError;
  const unavailable = snap?.status === 'expired' ? 'This package has expired. Export current Work to create another.' : snap?.status === 'unavailable' ? 'This snapshot has no downloadable package. Check its details.' : '';
  const body = `<p class="export-work-name">${esc(flow?.workName || target?.name || snap?.workId)}</p><p class="export-summary" role="status">${flow?.paused ? 'Paused. Resume in Details when you are ready.' : flow?.phase === 'delivered' ? 'Check your browser to confirm the file was saved.' : !flow ? 'This package contains the Work as captured in this snapshot.' : 'You can keep working while this export finishes.'}</p>${error || unavailable ? feedback(esc(error || unavailable), 'warning') : ''}<p class="export-privacy">${icon('lock',14)} Work packages may include private files and credentials.</p><details class="export-details"><summary>Details</summary>${details ? `<dl class="export-snapshot">${details}</dl>` : ''}${snap ? downloadProgressMarkup(snap.id) : ''}${controls ? `<div class="actions">${controls}</div>` : ''}${known.length ? `<h3>Other saved packages</h3><div class="menu-list">${known.map(value => btn(`${esc(value.id)} · ${esc(value.status)}`, 'view-snapshot', '', `data-id="${esc(value.id)}" data-work-id="${esc(value.workId)}"`)).join('')}</div>` : ''}<p class="muted">Closing only hides progress. Reloading or changing account ends automatic delivery. Pause holds later steps.</p></details>`;
  const retry = flow && flow.phase === 'unknown' && !canSave ? btn('Check status', 'check-export-flow', 'primary', `data-id="${esc(flow.id)}"`) : '';
  const download = canSave ? btn(flow?.autoDeliveryConsumed ? 'Download again' : 'Save file', 'save-export-file', 'primary', `data-id="${esc(snap!.id)}"`) : (!flow || flow.phase === 'failed' && !!job?.terminalFailure) && snap?.status === 'verified' && exportSnapshotAvailable(snap) ? btn(job?.terminalFailure ? 'Retry download' : 'Download this snapshot', 'download-work', 'primary', `data-id="${esc(snap.id)}" ${busy && active?.snapshotId !== snap.id ? 'disabled' : ''}`) : '';
  const fresh = !flow && target && ['expired', 'unavailable'].includes(snap?.status || '') ? btn('Export current Work', 'prepare-export', 'primary', `data-id="${esc(target.id)}" ${busy ? 'disabled' : ''}`) : '';
  return { title, body, footer: `${btn(flow && !flow.terminal ? 'Hide' : 'Close', 'close-modal')}${download || fresh || retry}` };
}

function modalMarkup() {
  const w = adapter.getWork(
    view.data.workId || view.data.id || route()[1] || "",
  );
  const target = w || current();
  let title = "",
    body = "",
    footer = "";
  const cancel = () => btn("Cancel", "close-modal");
  const close = () => btn("Close", "close-modal");
  switch (view.modal) {
    case 'chat-response-settings': {
      if(!target) break;
      const {catalog,state,model,name,thinking,editable,thinkingEditable}=chatSettings(target,view.data.sessionId || '');
      const expanded=view.data.expanded,levels=expanded==='thinking';
      title='Response settings';
      const options=!editable || levels && !thinkingEditable?[]:levels?(model?.thinkingAvailability==='unknown'?[{value:'normal',name:'Normal',note:'No additional Thinking requested; capability unconfirmed.',selected:state.thinking===null}]:(model?.thinkingLevels || []).map(level=>({value:level,name:thinkingName(level),note:'',selected:level===state.thinking}))) :
        [...(catalog?.defaultModel?[catalog.defaultModel]:[]),...(catalog?.models || []).filter(m=>m.modelRef!==null)].map(m=>({value:m.modelRef || '',name:m.modelRef===null?capturedDefaultName(m):modelDisplayName(m),note:m.modelRef===null?'Use Work default':m.model+' · '+m.provider+' · '+m.modelRef.slice(-8),selected:m.modelRef===state.ref}));
      const row=(kind:string,label:string,value:string,enabled:boolean,note='')=>btn(`<span class="response-setting-label">${label}</span><span class="response-setting-value">${esc(value)}${note?`<small>${note}</small>`:''}</span>${icon('down',14)}`,'toggle-chat-setting','quiet response-setting-row',`id="${kind}-select" data-kind="${kind}" value="${esc(kind==='model'?state.ref || '':state.thinking ?? 'normal')}" aria-label="${label}: ${esc(value)}" aria-expanded="${expanded===kind}" aria-haspopup="listbox" aria-controls="response-${kind}-options" aria-describedby="response-settings-status" ${enabled?'':'disabled'}`);
      body=`<p class="muted response-settings-subtitle">For your next message${view.data.sessionId?'': ' · For new session'}</p><div class="response-setting-group">${row('model','Model',name,editable,state.ref===null?'Work default':'')}${row('thinking','Thinking',thinking,thinkingEditable)}</div>${modelFeedback(target,view.data.sessionId || '',true)}${expanded && options.length?`<div class="response-setting-options"><p class="muted">${levels?'Thinking':'Model'}</p><div id="response-${expanded}-options" class="menu-list chat-picker-menu" role="listbox" aria-label="${levels?'Thinking levels':'Models'}">${options.map(option=>btn(`<span>${esc(option.name)}${option.note?`<small>${esc(option.note)}</small>`:''}</span>${option.selected?icon('check',16):''}`,'choose-chat-setting','',`role="option" aria-selected="${option.selected}" data-option-value="${esc(option.value)}" data-kind="${expanded}"`)).join('')}</div></div>`:''}`;
      footer=close();
      break;
    }
    case 'chat-input-options':
      title='Input options';
      body=`<label class="check-row"><input id="include-identity" type="checkbox" ${view.includeIdentity?'checked':''}> Include Service identity</label>${current() && (view.drafts[draftKey(current()!)] || '').trimStart().startsWith('/') && !view.literalSlash?'<p class="muted">Service identity is not added to commands. Only command arguments are sent.</p>':''}<p class="muted">Adds the selected Service name and port to ordinary messages.</p><details><summary>What is included?</summary><p>Identity only. No page content, cookies, or unsaved application inputs.</p></details>`;
      footer=close();
      break;
    case "account":
      title = esc(adapter.state.core.account || "Account");
      body = `<p class="account-context"><span>Role: ${esc(adapter.state.core.role === 'admin' ? 'Administrator' : adapter.state.core.role)}</span><span title="${esc(adapter.state.core.address)}">Core: ${esc(adapter.state.core.address)}</span></p><div class="menu-list">${btn(`${icon("info")} About Piwork`, "about-piwork")}${btn(`${icon("clock")} Known operations`, "operations")}</div><div class="menu-list account-management">${btn(`${icon("refresh")} Switch Core`, "switch-core")}${btn(`${icon("lock")} Reset browser access`, "reset-browser-access")}${btn(`${icon("logout")} Sign out`, "sign-out", "danger")}</div>`;
      break;
    case "reset-browser-access":
      title = "Reset browser access?";
      body = `<p>This ends browser access in <strong>all windows of this Desktop</strong>, including Service previews, file transfers and live observation.</p><p>The saved Core login is retained. Works, Services and already accepted Runs or Operations continue. File changes already sent may have been committed.</p><p class="muted">Use <code>${esc(adapter.reopenCommand())}</code> to authorize a browser again.</p>`;
      footer = `${cancel()}${btn('Reset browser access','confirm-reset-browser-access','danger')}`;
      break;
    case "connection":
      title = "Core connection";
      body = `<dl><dt>Core</dt><dd>${esc(adapter.state.core.address)}</dd><dt>Last checked</dt><dd>${esc(adapter.state.lastChecked || "Not provided")}</dd></dl><h3>Capabilities</h3><div class="status-grid">${[["Core", adapter.status.health], ["Runtime", adapter.status.readiness], ["Services", adapter.status.service], ["Files", adapter.status.files]].map(([name, state]) => `<span>${name} ${badge(state?.available ? "Available" : "Unavailable")}</span>`).join("")}</div><p class="muted">Reachability and capability availability are reported separately.</p>`;
      footer = `${btn("Switch Core", "switch-core")}${btn("Check connection", "check-connection", "primary")}`;
      break;
    case "switch-core":
      title = "Switch Core";
      body = `<p>Choose a Core and continue with its own account. Known operations remain isolated by Core and user.</p><label class="field">Core address<input id="auth-core" value="${esc(view.coreAddress)}"></label><p class="muted">Switching Core clears the current view and verifies any stored account for the new Core.</p>${defaultCorePreferences()}`;
      footer = `${cancel()}${btn("Connect to Core", "confirm-switch-core", "primary")}`;
      break;
    case "work-menu":
      title = target ? esc(target.name) : "Work options";
      body = `<div class="menu-list">${btn(`${icon("info")} Work information`, "work-info", "", `data-id="${target?.id}"`)}${btn(`${icon("settings")} Settings`, "settings", "", `data-id="${target?.id}"`)}${btn(`${icon("download")} Export Work`, "export", "", `data-id="${target?.id}"`)}${target && adapter.project(target).action === "stop" ? btn(`${icon("stop")} Stop Work`, "stop-work", "", `data-id="${esc(target.id)}"`) : ""}${btn(`${icon("trash")} Delete Work`, "delete-work", "danger", `data-id="${target?.id}"`)}</div>`;
      break;
    case "work-info":
      if (!target) break;
      title = "Work information";
      body = `<dl class="property-list"><dt>Name</dt><dd>${esc(target.name)}</dd><dt>Status</dt><dd>${badge(target.status)}</dd><dt>Desired state</dt><dd>${target.desired}</dd><dt>Work ID</dt><dd class="property-value-action"><code>${target.id}</code>${btn(icon("copy", 15), "copy", "icon-button quiet", `data-copy="${target.id}" aria-label="Copy full Work ID"`)}</dd><dt>Network identity</dt><dd class="property-value-action"><code>${esc(target.network || "Not provided")}</code>${btn(icon("copy", 15), "copy", "icon-button quiet", `data-copy="${target.network}" aria-label="Copy network identity"`)}</dd><dt>Owner</dt><dd>${esc(adapter.state.core.account)}</dd></dl>`;
      footer = `${close()}${[...actions.records.values()].some(record => record.blocked && record.kind === 'lifecycle' && record.work === target.id) ? btn('Check original Work', 'check-work', '', `data-id="${esc(target.id)}"`) : ''}`;
      break;
    case "new-work":
      title = "New Work";
      body = `<p>Give your Work a name. It will inherit your Core’s defaults.</p><label class="field">Name<input id="create-name" placeholder="e.g. Reading notes" value="${esc(view.createName)}" aria-label="Name" ${currentNameError() ? 'aria-invalid="true" aria-describedby="create-name-error"' : ""} autofocus required maxlength="120">${nameFieldError("create-name-error")}</label><button class="advanced-toggle" data-action="toggle-create-advanced">${icon(view.createAdvanced ? "down" : "chevron", 14)} Advanced configuration <span>Optional</span></button>${
        view.createAdvanced
          ? `<div class="advanced-form"><label class="field">Base image<input id="create-image" placeholder="Use Core default" value="${esc(view.createImage)}"></label><label class="field">Skills<select id="create-skill-mode">${[
              ["defaults", "Use defaults"],
              ["choose", "Choose"],
              ["none", "None"],
            ]
              .map(
                ([v, l]) =>
                  `<option value="${v}" ${view.createSkillMode === v ? "selected" : ""}>${l}</option>`,
              )
              .join("")}</select></label>${
              view.createSkillMode === "choose"
                ? adapter
                    .getSkills()
                    .map(
                      (s) =>
                        `<label class="check-row"><input type="checkbox" data-create-skill="${esc(s.id)}" ${view.createSkills.includes(s.id) ? "checked" : ""}>${esc(s.name)}</label>`,
                    )
                    .join("")
                : ""
            }<label class="field">Pi Packages<select id="create-package-mode">${[
              ["defaults", "Use defaults"],
              ["choose", "Choose"],
              ["none", "None"],
            ]
              .map(
                ([v, l]) =>
                  `<option value="${v}" ${view.createPackageMode === v ? "selected" : ""}>${l}</option>`,
              )
              .join("")}</select></label>${
              view.createPackageMode === "choose"
                ? adapter
                    .getPackages()
                    .map(
                      (p) =>
                        `<label class="check-row"><input type="checkbox" data-create-package="${esc(p.name)}" ${view.createPackages.includes(p.name) ? "checked" : ""}>${esc(p.name)}</label>`,
                    )
                    .join("")
                : ""
            }<label class="field">AGENTS.md<textarea id="create-agents" rows="4" placeholder="Use Core default instructions">${esc(view.createAgents)}</textarea></label>${btn("Import AGENTS.md file", "create-import-agents", "small")}<label class="field">Full configuration JSON<textarea id="create-json" rows="4" class="mono" placeholder="Optional public configuration overrides">${esc(view.createJson)}</textarea></label></div>`
          : ""
      }<div class="merge-summary"><strong>Configuration to create</strong><span>Image: ${esc(view.createImage || "Core default")}</span><span>Skills: ${view.createSkillMode === "defaults" ? "Core defaults" : view.createSkillMode === "none" ? "None" : esc(view.createSkills.join(", ") || "None chosen")}</span><span>Pi Packages: ${view.createPackageMode === "defaults" ? "Core defaults" : view.createPackageMode === "none" ? "None" : esc(view.createPackages.join(", ") || "None chosen")}</span><span>Advanced fields override Core defaults; explicit selections override those fields.</span></div>`;
      footer = `${cancel()}${btn("Create Work", "create-work", "primary", createSubmissionBlocked(actions.records.values(), view.createName) ? "disabled" : "")}`;
      break;
    case "stop-work":
      title = `Stop ${esc(target?.name)}?`;
      body = `<p>This stops the current Run, all running Services, and workspace file connections for this Work.</p><p>Your persistent workspace data is preserved. Enabled Services can resume the next time you start the Work.</p><div class="impact-box">Entire Work · Services · Agent · Files</div>`;
      body += view.data.exportAfterStop ? '<p>After the original stop is confirmed, this explicit choice generates a full .work package and starts its verified download. Packages may include private data and credentials.</p>' : '';
      footer = `${cancel()}${btn(view.data.exportAfterStop ? "Stop and export" : "Stop Work", "confirm-stop", "danger-solid", `data-id="${target?.id}" ${view.data.exportAfterStop ? 'data-export-stop="true"' : ''}`)}`;
      break;
    case "delete-work":
      title = `Delete ${esc(target?.name)}?`;
      body = `<p>The Work entry will be removed. Persistent data is retained by default, but there is no undo in this UI.</p><p>This is different from stopping a Work. Export a package first if you need a portable copy.</p><label class="check-row"><input id="delete-confirm" type="checkbox" ${view.deleteConfirmed ? "checked" : ""}>I understand there is no UI undo</label>`;
      footer = `${cancel()}${btn("Delete Work", "confirm-delete", "danger-solid", `data-id="${target?.id}" ${view.deleteConfirmed ? "" : "disabled"}`)}`;
      break;
    case "sessions":
      title = "Sessions";
      body = `<p>Conversations within ${esc(target?.name)}. Switching Sessions does not stop an active Run.</p><div class="session-list" role="listbox" aria-label="Sessions">${target?.sessions.map((s) => `<button role="option" aria-selected="${s.id === view.session}" data-action="select-session" data-id="${s.id}" class="${s.id === view.session ? "selected" : ""}"><span>${icon("chat", 17)}${esc(sessionDisplayName(target!,s))}</span>${target.run?.sessionId === s.id ? badge(target.run.status) : s.id === view.session ? icon("check", 16) : ""}</button>`).join("") || (target?.resourceLoading?.agent ? readPlaceholder("Loading conversations…") : target?.resourceErrors?.agent ? "" : "<p>No Sessions yet.</p>")}</div>${target?.resourceErrors?.agent?readFailure("Conversations could not be read",target.resourceErrors.agent,"retry-conversation",!!target.resourceLoading?.agent):""}`;
      footer = `${close()}${btn(`${icon("plus")} New session`, "new-session", "primary")}`;
      break;
    case "agent-menu":
      title = "Agent options";
      body = `<div class="menu-list">${btn(`${icon("clock")} Sessions`, "sessions")}${btn(`${icon("plus")} New session`, "new-session")}${btn(`${icon("note")} Pi requests for this Work`, "pi-requests")}${view.layout==='chat-only'?btn(`${icon("arrow")} Restore layout`, "restore-layout"):btn(`${icon("focus")} Focus chat`, "focus-chat")}${browserFullscreenAction()}</div>`;
      break;
    case "about-piwork": {
      const info=adapter.about;title="About Piwork";
      body=`${productInfoMarkup('Desktop (piwork-cli)',info.local,info.localLoading,info.localError)}${productInfoMarkup('Core',info.core,info.coreLoading,info.coreError)}${info.core && info.coreError?`<p class="muted">Last confirmed ${esc(info.coreChecked)}</p>`:''}`;
      footer=`${close()}${btn('Refresh','refresh-about','quiet')}`;break;
    }
    case "chat-image-preview":title="Image preview";body=`${target && !adapter.project(target).usable?'<p class="muted">Previously loaded image. Start this Work to read current history.</p>':''}<img class="chat-image-preview" src="${esc(view.data.url)}" alt="Sent image">`;footer=close();break;
    case "run-details": {
      title="Run details";
      const runId=view.data.runId,run=target?(adapter.runDetails.get(`${target.id}:${runId}`) || (target.run?.id===runId?target.run:target.sessions.flatMap(s=>s.runs || []).find(r=>r.id===runId))):undefined;
      const observed=target && adapter.activeRuns.get(target.id),active=target && (adapter.cancelAndSendCapabilities.get(target.id)===1 ? observed?.confirmed && !observed.error ? observed.run : undefined : target.run);
      const cancellable=!!run && active?.id===run.id && ['accepted','running','cancelling'].includes(active.status);
      const history=target?.sessions.find(s=>s.id===view.session)?.runs || [];
      body=run ? `${runFacts(run)}${run.error?feedback(esc(run.error),'warning'):''}<details><summary>Technical details</summary><dl><dt>Run ID</dt><dd><code>${esc(run.id)}</code></dd><dt>Session ID</dt><dd><code>${esc(run.sessionId)}</code></dd><dt>Event cursor</dt><dd>${run.cursor}</dd></dl></details><p class="muted">One active Run per Work. Closing details does not cancel execution.</p>` : '<p>Run details have not been confirmed.</p>';
      if(history.length)body+=`<details><summary>Earlier execution details</summary>${history.map(r=>`<p>${btn(`${esc(r.status)} · ${esc(r.created || 'Time unavailable')} · ${esc(modelDisplayName(r.actualModel))}`,'run-details','text-button',`data-run-id="${esc(r.id)}"`)}</p>`).join('')}</details>`;
      footer=`${close()}${run && cancellable?btn(run.cancellationRequested || run.status==='cancelling'?'Cancelling…':'Cancel run','cancel-run','danger',`data-run-id="${esc(run.id)}" ${run.cancellationRequested || run.status==='cancelling'?'disabled':''}`):''}`;
      break;
    }
    case 'service-picker': {
      title='Switch service';
      const selected=target && activeService(target);
      body=`<div class="service-picker-list" role="listbox" aria-label="Services">${target?.services.filter(item=>item.ports.length && item.observed!=='Removed').map(item=>btn(`<span class="service-choice-copy"><strong>${esc(item.name)}</strong>${!item.enabled || item.observed!=='Ready'?`<small>${esc(item.error || (!item.enabled?'Disabled · use Manage services':item.observed==='Starting'?'Starting · waiting for readiness':item.observed==='Failed'?'Failed · check details and logs':'Stopped · use Manage services'))}</small>`:''}</span>${badge(item.enabled?item.observed:'Disabled')}<span class="choice-check">${item.id===selected?.id?icon('check',16):''}</span>`,'select-service','quiet service-choice',`role="option" aria-selected="${item.id===selected?.id}" data-id="${esc(item.id)}"`)).join('') || '<p>No Web Services.</p>'}</div>`;
      footer=btn(`${icon('settings',16)} Manage services`,'manage-services','quiet');break;
    }
    case "service-menu":
      title = "Service options";
      body = `<div class="menu-list">${btn(`${icon("external")} Open in new tab`, "open-app")}${btn(`${icon("focus")} Open independent window`, "open-window")}${btn(`${icon("copy")} Copy domain`, "copy-domain")}${btn(`${icon("copy")} Copy local link`, "copy-local")}${btn(`${icon("settings")} Manage services`, "manage-services")}${btn(`${icon("note")} Pi requests for this Work`, "pi-requests")}${btn(`${icon("reset")} Reset split`, "reset-workspace-split")}${btn(`${icon("focus")} Focus chat`, "focus-chat")}${browserFullscreenAction()}</div><p class="muted">A local link works on this computer while Desktop CLI is running and signed in. It is not a public share link.</p>`;
      break;
    case "manage-services":
      title = "Manage services";
      body = `<p>Service definitions are created and updated by the Agent.</p><div class="service-list">${target?.services.map((s) => `<button data-action="service-details" data-id="${s.id}"><span class="service-list-icon">${icon(s.ports.length ? "grid" : "terminal", 20)}</span><span><strong>${esc(s.name)}</strong><small>${s.ports.length ? `${s.ports.length} declared Web ${s.ports.length === 1 ? "port" : "ports"}` : "No Web entry"} · ${s.enabled ? "Enabled" : "Disabled"}</small></span>${badge(s.observed)}${icon("chevron", 15)}</button>`).join("") || "<p>No Services have been defined.</p>"}</div>`;
      footer = close();
      break;
    case "service-details": {
      const s = target?.services.find((s) => s.id === view.data.serviceId);
      title = s ? esc(s.name) : "Service removed";
      body = s
        ? serviceDetails(s, target!)
        : `${target ? controlMarkup(serviceControls.get(`${target.id}:${view.data.serviceId}`)) : ""}<p>The Service definition was removed. Workspace files were not deleted.</p>`;
      footer = `${close()}${btn("Back to services", "manage-services")}`;
      break;
    }
    case "service-control": {
      const s = target?.services.find((s) => s.id === view.data.serviceId);
      title = `${view.data.control === "remove" ? "Remove" : "Stop"} ${esc(s?.name)}?`;
      body =
        view.data.control === "remove"
          ? "<p>Remove this Service definition. Shared workspace files are preserved. Starting a Service cannot undo its removal.</p>"
          : "<p>Stopping this Service persistently disables it. Starting the Work again will not re-enable it. Other Services and the Agent keep running.</p>";
      footer = `${cancel()}${btn(view.data.control === "remove" ? "Remove Service" : "Stop Service", "confirm-service-control", "danger-solid")}`;
      break;
    }
    case "pi-requests": {
      const serviceContext=view.data.source==='service';title=serviceContext?'Agent requests':'Pi requests';
      const page=target?adapter.requestPage(target.id,view.data.serviceName || ''):undefined;
      body=`<p class="request-work-name">${esc(target?.name || 'Current Work')}${serviceContext?' · Service requests':' · All Work requests'}</p><div class="request-filter"><label class="field">Source<select id="pi-service-filter"><option value="">All Services and Chat</option>${target?.services.map(item=>`<option value="${esc(item.name)}" ${item.name===view.data.serviceName?'selected':''}>${esc(item.name)}</option>`).join('') || ''}</select></label>${btn(icon('refresh',16),'pi-requests','icon-button quiet','aria-label="Refresh requests" title="Refresh requests"')}</div>${page?.error?feedback(esc(page.error),'warning'):''}<div class="request-list">${page?.items.map(request=>`<article class="request-row">${btn(`<span class="request-copy"><strong>${esc(request.goal)}</strong><small>${esc(request.source.kind==='service'?`Service: ${request.source.serviceName}`:'Chat')}</small></span>${icon('chevron',16)}<span class="request-row-meta">${badge(requestStateLabel(request.state))}<small>Updated ${esc(request.updatedAt)}</small></span>${request.disposition!=='live'?'<small class="request-historical">Historical · Read only</small>':''}`,'pi-request-detail','quiet request-row-button',`data-id="${esc(request.requestId)}"`)}${target && adapter.requestReadErrors.get(`${target.id}:${request.requestId}`)?feedback(esc(adapter.requestReadErrors.get(`${target.id}:${request.requestId}`)),'warning'):''}</article>`).join('') || (page?.loading?'Reading requests…':'No requests in this view.')}</div>`;
      footer=`${close()}${page?.nextCursor?btn('More requests','next-pi-requests'):''}`;break;
    }
    case "pi-request-detail": {
      title=view.data.source==='service'?'Agent request':'Pi request';const detail=target?adapter.requestDetails.get(`${target.id}:${view.data.requestId}`):undefined,r=detail?.request;
      if(!r){body='Reading the original request…';footer=close();break;}
      const retryIntent=target?adapter.requestRetries.get(`${target.id}:${r.requestId}`):undefined;
      const cancellation=target && adapter.requestCancellation(target.id,r.requestId);
      const waiting=['waiting_result','waiting_apply'].includes(r.state);
      const live=r.disposition==='live',editable=live && !!target && adapter.project(target).usable,responses=target?adapter.requestResponses.get(`${target.id}:${r.requestId}`):undefined;
      body=`<div class="request-overview"><h3>${esc(r.goal)}</h3><p>${esc(r.source.kind==='service'?`Service: ${r.source.serviceName}`:'Chat')}</p>${badge(requestStateLabel(r.state))}<small>${detail.checkedAt?'Last confirmed':'Updated'} ${esc(detail.checkedAt || r.updatedAt)}</small></div>${detail.readError?feedback(`Status not confirmed: ${esc(detail.readError)}`,'warning'):''}${!live?'<p class="muted">Historical · Read only</p>':''}<section class="request-result"><h3>Result &amp; next step</h3>${r.result?`<p class="request-text">${esc(r.result)}</p>`:''}${waiting && r.waitRef?feedback(`Waiting for ${esc(r.waitRef.kind)} · Chat remains available.<small>Deadline ${esc(r.waitRef.deadlineAt)}</small>`,'warning'):''}${r.error?feedback(esc(r.error.message),'warning'):''}${!r.result && (!waiting || !r.waitRef) && !r.error?'<p>No result reported yet.</p>':''}${retryIntent?feedback(esc(retryIntent.error || 'Retry result unknown. Check status to verify the original submission.'),'warning'):''}</section><details class="request-executions"><summary>Executions <span>${r.runIds.length}</span></summary>${r.runIds.map((runId:string,index:number)=>{const run=responses?.runs.find(item=>item.id===runId);return `<details class="request-execution"><summary>Execution ${index+1} ${run?badge(run.status):'<span>Not confirmed</span>'}</summary>${run?`${runFacts(run)}${responses?.checked[run.id]?`<small>Last confirmed ${esc(responses.checked[run.id])}</small>`:''}${run.finalText?`<p class="request-text">${esc(run.finalText)}</p>`:'<p>No saved reply.</p>'}${run.error?feedback(esc(run.error),'warning'):''}`:`<p>${responses?.loading?'Reading execution…':'Execution has not been confirmed.'}</p>`}</details>`;}).join('') || '<p>No Run admitted.</p>'}<p class="muted">A successful Run does not mean the request is complete.</p></details>${responses?.errors.map(error=>feedback(esc(error),'warning')).join('') || ''}<details class="request-evidence"><summary>Evidence &amp; technical details</summary><p>Request ID <code>${esc(r.requestId)}</code></p>${r.waitRef?`<p>Wait reference <code>${esc(r.waitRef.id)}</code></p>`:''}${detail.evidence.items.map((e:Record<string,any>)=>`<article class="capability"><strong>${esc(e.kind)} · ${e.verified?'Verified':'Observed'}</strong><p>${esc(e.summary)}</p><small>${esc(e.observedAt)} · ${esc(e.objectRef)}${e.stateVersion?` · State ${esc(e.stateVersion)}`:''}${e.codeVersion?` · Code ${esc(e.codeVersion)}`:''}</small></article>`).join('') || '<p>No evidence yet.</p>'}${detail.evidence.nextCursor?btn('More evidence','next-pi-evidence','small'):''}</details>`;
      if (cancellation) body += feedback(cancellation.phase === 'accepted' ? `Cancellation requested. Refresh the original request to check its current state.${cancellation.error ? ` ${esc(cancellation.error)}` : ''}` : cancellation.phase === 'unknown' ? `Cancellation result is unknown. Refresh the original request; it will not be submitted again. ${esc(cancellation.error)}` : 'Requesting cancellation…', cancellation.phase === 'unknown' || cancellation.error ? 'warning' : 'info');
      footer=`${close()}${btn('Check status','pi-request-detail','small',`data-id="${esc(r.requestId)}"`)}${view.data.source!=='service' && editable&&['failed','cancelled','needs_attention'].includes(r.state)?btn('Retry with new request','retry-pi-request','primary',retryIntent?'disabled':''):''}${editable && requestCancellable(r)?btn(r.state==='cancelling'?'Cancelling…':'Cancel request','cancel-pi-request','danger',r.state==='cancelling' || cancellation?'disabled':''):''}`;break;
    }
    case "file-menu": {
      const f = target?.files.find((f) => f.path === view.data.path);
      title = esc(f?.name || "File");
      body = `<div class="menu-list">${btn(`${icon(f?.kind === 'directory' ? 'folder' : 'file')} Open`, "open-file", "", `data-path="${esc(f?.path)}"`)}${btn(`${icon("download")} Download file`, "download-file", "", `data-path="${esc(f?.path)}" ${f?.kind === "directory" || f?.kind === "special" ? "disabled" : ""}`)}${btn(`${icon("edit")} Rename`, "file-rename", "", `data-path="${esc(f?.path)}"`)}${btn(`${icon("move")} Move`, "file-move", "", `data-path="${esc(f?.path)}"`)}${btn(`${icon("copy")} Copy`, "file-copy", "", `data-path="${esc(f?.path)}"`)}${btn(`${icon("trash")} Delete`, "file-delete", "danger", `data-path="${esc(f?.path)}"`)}</div>`;
      break;
    }
    case "upload-overwrite": {
      const review=uploadReview(modalTransfers),paths=(rows:readonly TransferResult[])=>rows.map(row=>`<code>${esc(row.path)}</code>`).join(', ');
      title='Review uploads';
      body=`${review.overwrite.length?`<p>Replace these confirmed existing files: ${paths(review.overwrite)}? The checked versions are listed below. Targets without modification times cannot protect against concurrent changes.</p>`:''}${review.retry.length?`<p>These uploads failed and can be checked again: ${paths(review.retry)}. Retrying does not authorize replacing an existing file.</p>`:''}${review.unknown.length?'<p>The original upload result is unknown. Refresh the original paths before choosing files again; no unknown upload will be repeated here.</p>':''}`;
      footer=`${cancel()}${review.retry.length?btn('Retry failed uploads','confirm-upload-overwrite','primary','data-upload-mode="retry"'):''}${review.overwrite.length?btn('Overwrite confirmed files','confirm-upload-overwrite','danger','data-upload-mode="overwrite"'):''}`;break;
    }
    case "new-folder":
      title = "New folder";
      body = `<p>Create inside <code>${esc(view.path)}</code></p><label class="field">Folder name<input id="form-name" value="${esc(view.formName)}" placeholder="e.g. research"></label>`;
      footer = `${cancel()}${btn("Create folder", "confirm-folder", "primary")}`;
      break;
    case "file-transfer":
      title = `${view.data.transfer === "rename" ? "Rename" : view.data.transfer === "copy" ? "Copy" : "Move"} ${decodePaths(view.data.paths).length > 1 ? "selected items" : "item"}`;
      body = `<div class="path-list">${decodePaths(view.data.paths)
        .map((p) => `<code>${esc(p)}</code>`)
        .join("")}</div>${
        view.data.transfer === "rename"
          ? `<label class="field">New name<input id="form-name" value="${esc(view.formName)}" placeholder="Enter a file or folder name"></label>`
          : `<label class="field">Destination folder<select id="form-destination"><option value="/">Workspace /</option>${target?.files
              .filter((f) => f.kind === "directory")
              .map(
                (f) =>
                  `<option value="${esc(f.path)}" ${view.formDestination === f.path ? "selected" : ""}>${esc(f.path)}</option>`,
              )
              .join("")}</select></label>`
      }<p class="muted">The destination must be inside this same Work.</p>${view.formOverwrite ? feedback(`These exact destinations already exist: <code>${esc(view.data.overwritePath)}</code>. Continuing replaces every listed target, including its child paths.`, "warning") : ""}`;
      footer = `${cancel()}${btn(view.formOverwrite ? "Overwrite target" : view.data.transfer === "copy" ? "Copy here" : view.data.transfer === "rename" ? "Rename" : "Move here", "confirm-transfer", view.formOverwrite ? "danger-solid" : "primary", fileAttempt?.ledger.hasResults ? "disabled" : "")}`;
      break;
    case "file-delete":
      title = "Delete selected files?";
      body = `<p>Remove these paths from this Work’s workspace.</p><div class="path-list">${decodePaths(
        view.data.paths,
      )
        .map((p) => `<code>${esc(p)}</code>`)
        .join(
          "",
        )}</div><p class="danger-text">Folders are deleted recursively, including every child path. Deleted files and folders cannot be restored from this UI. The workspace root cannot be deleted.</p>`;
      footer = `${cancel()}${btn("Delete paths", "confirm-file-delete", "danger-solid", fileAttempt?.ledger.hasResults ? "disabled" : "")}`;
      break;
    case "dirty-file":
      title = "Save your file changes?";
      body = `<p>You have unsaved changes to <code>${esc(view.file)}</code>.</p><p>Keep editing, discard the draft, or save the file before leaving.</p>`;
      footer = `${btn("Keep editing", "close-modal")}${btn("Discard", "dirty-discard", "danger")}${btn("Save file", "dirty-save", "primary")}`;
      break;
    case "dirty-settings":
      title = "Save configuration changes?";
      body =
        "<p>Your unsaved configuration draft has not changed this Work. Saving modifies desired configuration only; Apply remains a separate action.</p>";
      footer = `${btn("Keep editing", "close-modal")}${btn("Discard", "dirty-config-discard", "danger")}${btn("Save changes", "dirty-config-save", "primary")}`;
      break;
    case "webdav":
      title = "Connect with WebDAV";
      body = `<p>Optional for external file clients. Browser Files does not require a proxy.</p><ol class="steps"><li>Start <code>piwork-cli proxy</code> independently in your terminal.</li><li>Use the username and actual listening port printed by that proxy.</li><li>Get the temporary password from the same startup terminal. It is never shown or stored here.</li></ol><label class="field">Address pattern<code class="copy-field">http://127.0.0.1:&lt;printed-port&gt;/works/${esc(target?.id)}/files/</code></label><p class="muted">Use the actual proxy startup output. File locking and system mounts are not promised.</p>`;
      footer = close();
      break;
    case "refresh-core-skills":
      title = "Refresh selected Core copies";
      body = "<p>This Core operation refreshes the complete selected Skill set from Core. Existing local copies will be replaced. Save or discard any other unsaved settings before continuing.</p>";
      footer = `${cancel()}${btn("Refresh copies", "confirm-core-skills", "primary", view.configDirty ? "disabled" : "")}`;
      break;
    case "skill-detail": {
      const s = adapter.getSkills().find((x) => x.id === view.data.id);
      title = esc(s?.name || "Skill");
      body = `<dl><dt>Description</dt><dd>${esc(s?.description || "Not provided")}</dd><dt>Version</dt><dd>${esc(s?.version || "Not provided")}</dd><dt>Loaded</dt><dd>${target ? skillState(target, view.data.id, "loaded") : "Not provided"}</dd><dt>Visible to model</dt><dd>${target ? skillState(target, view.data.id, "modelVisible") : "Not provided"}</dd></dl><p class="muted">Loaded and visible to the model are separate states. Applying configuration does not create missing metadata.</p>`;
      footer = close();
      break;
    }
    case "remove-package-confirm":
      title = "Remove Pi Package"; body = `<p>Remove ${esc(view.data.id)} from this Work? The operation updates its saved configuration; the active runtime remains until Apply.</p>`;
      footer = `${cancel()}${btn("Remove package", "confirm-remove-package", "danger")}`; break;
    case "package-detail": {
      const p = adapter.getPackages().find((x) => x.name === view.data.id);
      const entry = target?.packageEntries?.find(p => p.name === view.data.id);
      title = esc(view.data.id);
      body = `${target?.resourceErrors?.packages ? feedback(`Package observation unavailable. Last confirmed details: ${esc(target.resourceErrors.packages)}`, "warning") : ""}${view.data.id === "piwork-brain" ? `<p>Editable source: <code>.pi/packages/piwork-brain/</code></p>${btn("Open brain source", "open-source", "small", 'data-path="/.pi/packages/piwork-brain/brain.md"')}${brainCandidateDetails(entry)}` : `<pre class="code-editor">${esc(JSON.stringify(entry ?? p ?? { name: view.data.id }, null, 2))}</pre>`}<p class="muted">Installed, selected, active, and loaded states are reported separately.</p>`;
      footer = `${close()}${target ? btn("Refresh package", "refresh-package-detail", "small") : ""}`;
      break;
    }
    case "install-package":
      title = view.data.update ? "Update package source" : "Install Pi Package";
      body = `${uploadProgressMarkup()}<p>Choose the package source explicitly. Installing does not mean the model has loaded it.</p><label class="field">Source type<select id="install-type">${["Core", "npm", "Git", "Local directory", "ZIP"].map((t) => `<option ${view.installType === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>${
        view.installType === "Core"
          ? `<label class="field">Current Core copy<select id="install-name">${adapter
              .getPackages()
              .map(
                (p) =>
                  `<option ${view.installName === p.name ? "selected" : ""}>${esc(p.name)}</option>`,
              )
              .join("")}</select></label>`
          : view.installType === "npm" || view.installType === "Git"
            ? `<label class="field">${view.installType === "npm" ? "npm package reference" : "Git source"}<input id="install-source" value="${esc(view.installSource)}" placeholder="${view.installType === "npm" ? "@scope/package@version" : "Repository URL and optional ref"}"></label>`
            : `<div class="file-drop">${icon("upload", 26)}<strong>${view.installSource ? esc(view.installSource) : `Select a ${view.installType === "ZIP" ? "ZIP archive" : "local directory"}`}</strong>${btn("Choose local source", "choose-package-source")}</div>${view.installType === "Local directory" ? feedback("Directory upload does not preserve executable bits or symbolic links. Use a ZIP when those attributes matter.", "warning") : ""}`
      }<p class="muted">Upload and validation happen before acceptance. Core prepares the package asynchronously; installing Agent capabilities may execute package preparation code in its isolated helper.</p>`;
      footer = `${cancel()}${btn(view.data.update ? "Update package" : "Install package", "confirm-install", "primary")}`;
      break;
    case "export": {
      const panel = exportPanel(target);
      title = panel.title; body = panel.body; footer = panel.footer;
      break;
    }
    case "import":
      title = "Import Work";
      body = `<p>Inspect the actual <code>.work</code> package using the local CLI. No file is sent to Core until you confirm import.</p><div class="file-drop">${icon("upload",28)}<strong>${esc(view.inspectFilename || "Choose a Work package")}</strong>${btn("Choose .work file", "choose-work-file", "", adapter.inspectionContext && adapter.inspectionContext.importState !== "unsubmitted" ? "disabled" : "")}</div>${adapter.transferProgress ? feedback(`Transfer: ${esc(adapter.transferProgress.phase)} · ${esc(adapter.transferProgress.transferred ?? 0)} / ${esc(adapter.transferProgress.total ?? "unknown")} bytes`) : ""}${adapter.inspection ? `${feedback("Package format and contents verified locally.", "success")}<div class="inspection-summary"><h3>Verified package summary</h3><pre>${esc(JSON.stringify(adapter.inspection,null,2))}</pre><p>Import creates a stopped Work. Private files may contain business data or credentials. No code starts automatically.</p></div><label class="field">Work name <span>Optional</span><input id="import-name" value="${esc(view.importName)}" aria-label="Work name" aria-describedby="import-name-help${currentNameError() ? ' import-name-error' : ''}" ${currentNameError() ? 'aria-invalid="true"' : ""} placeholder="Leave blank to use the package name"><span id="import-name-help">Leave blank to use the package name. Core adds a suffix if that name is unavailable.</span>${nameFieldError("import-name-error", true)}</label>` : ""}`;
      body += adapter.inspectionContext && adapter.inspectionContext.importState !== "unsubmitted" ? feedback(`Original import: ${esc(adapter.inspectionContext.importState)} · <code>${esc(adapter.inspectionTransfer)}</code>. Check known operations; closing does not cancel or resubmit it.`, "warning", btn("Check original import", "check-inspection-import", "small") + btn("Known operations", "operations", "small")) : "";
      footer = `${cancel()}${adapter.inspection && adapter.inspectionContext?.importState === "unsubmitted" ? btn(adapter.state.signedIn ? "Import Work" : "Sign in to import", adapter.state.signedIn ? "confirm-import" : "import-sign-in", "primary") : ""}`;
      break;
    case "operations": {
      title = view.data.workId ? "Related operations" : "Known operations";
      const scope = `${adapter.state.core.address} · ${adapter.state.core.account}`;
      const operations = adapter.state.operations.filter(
        (o) => o.scope === scope && (!view.data.workId || o.workId === view.data.workId),
      );
      body = `<p>Records known by this local CLI, for the current Core and account. This is not a global server history.</p><label class="field">Find an Operation by ID<div class="input-action"><input id="operation-query" value="${esc(view.operationQuery)}" placeholder="op-…">${btn("Check status", "lookup-operation")}</div></label><label class="field">Find an original snapshot ID<div class="input-action"><input id="snapshot-query" value="${esc(view.snapshotQuery)}" placeholder="snapshot-…">${btn("Find snapshot", "lookup-snapshot")}</div></label><div class="operation-list">${operations.length ? operations.map((op) => `<button data-action="operation" data-id="${op.id}"><span>${icon("clock", 17)}<span><strong>${esc(op.kind)}</strong><small>${op.id} · ${op.updated}</small></span></span>${badge(op.state)}</button>`).join("") : '<p class="muted">No operations are known in this Desktop session.</p>'}</div><p class="muted">Records contain IDs and status only. The CLI stores minimal Operation IDs for the current Core and account. Clearing completed records does not cancel server work.</p>`;
      footer = `${close()}${btn("Clear local records", "clear-operations", "quiet", operations.length ? "" : "disabled")}`;
      break;
    }
    case "operation": {
      const op = adapter.getOperation(view.data.id);
      title = op ? esc(op.kind) : "Operation not found";
      body = op
        ? `${phase(op)}${importNameFeedback(op)}${op.action && adapter.getWork(op.workId) ? `<div class="operation-work-status">Work: ${workStatus(adapter.getWork(op.workId)!)}${quickAction(adapter.getWork(op.workId)!)}</div>` : ""}${feedback(`${esc(op.phase)}. ${op.state === "accepted" || op.state === "preparing" ? "Accepted does not mean completed. Closing this panel will not cancel it." : op.state === "unknown" ? "Check this original Operation; do not repeat the request." : op.state === "succeeded" ? "The original Operation reached a confirmed result." : ""}`, op.state === "failed" ? "warning" : op.state === "succeeded" ? "success" : "info")}<dl><dt>Operation ID</dt><dd><code>${op.id}</code>${btn(icon("copy", 14), "copy", "icon-button quiet", `data-copy="${op.id}" aria-label="Copy Operation ID"`)}</dd><dt>Work ID</dt><dd><code>${op.workId}</code></dd><dt>State</dt><dd>${badge(op.state)}</dd><dt>Last confirmed</dt><dd>${op.updated}</dd>${op.snapshotId ? `<dt>Snapshot ID</dt><dd><code>${op.snapshotId}</code></dd>` : ""}</dl>${op.error ? feedback(esc(op.error), "warning") : ""}${op.observationError ? feedback(`Observation interrupted. ${esc(op.observationError)}`, "warning") : ""}${op.localRecordSaved === false ? feedback("Accepted, but the local record could not be saved. Copy the Operation ID; automatic recovery after reload is not guaranteed.", "warning") : ""}`
        : "<p>This Operation is not known for the current Core and user. Verify the ID or check the original Work.</p>";
      if (op?.kind === 'Import Work' && op.state === 'succeeded') {
        const imported = adapter.getWork(op.workId), start = importStarts.get(op.id);
        const stopped = imported?.status === 'Stopped' && imported.desired === 'stopped' && !imported.statusError;
        title = start ? 'Imported Work · Start progress' : stopped ? 'Imported · Not started' : 'Imported Work';
        body = `<p>${start ? 'Your explicit Start request remains bound to this imported Work.' : stopped ? 'The package was imported successfully. Start it when you are ready, or view the stopped Work.' : 'Import completed. Check the Work’s current status before starting or opening it.'}</p>${start ? `<dl><dt>Original import</dt><dd><code>${esc(op.id)}</code></dd><dt>Original Start</dt><dd>${start.startId ? `<code>${esc(start.startId)}</code>` : esc(start.phase)}</dd></dl>${controlMarkup(workControls.get(op.workId))}` : ''}${body}`;
      }
      footer = `${close()}${op ? btn("Check status", "check-operation", "", `data-id="${op.id}"`) : ""}${op && !["succeeded","failed","superseded"].includes(op.state) ? btn(adapter.operationPaused(op.id) ? "Resume checking" : "Pause checking", adapter.operationPaused(op.id) ? "resume-operation" : "pause-operation", "", `data-id="${op.id}"`) : ""}${op?.state === "succeeded" && op.kind === "Import Work" ? importExitButtons(op) : op?.state === "succeeded" && op.kind === "Create Work" ? workLink('Open Work', op.workId, 'primary') : op?.snapshotId ? btn("View original snapshot", "view-snapshot", "primary", `data-id="${esc(op.snapshotId)}" data-work-id="${esc(op.workId)}"`) : ""}`;
      break;
    }
  }
  const role=overlayRole(view.modal);
  if(role==='menu') {
    body=body.replaceAll('<div class="menu-list', '<div role="group" class="menu-list').replaceAll('<button ', '<button role="menuitem" tabindex="-1" ');
    return `<dialog id="modal" role="menu" aria-label="${title}" class="modal anchored-overlay command-dropdown"><div class="dropdown-title">${title}</div><div class="modal-body">${view.modalError?feedback(esc(view.modalError),'warning'):''}${body}</div></dialog>`;
  }
  return `<dialog id="modal" aria-modal="${role!=='modal' || view.modal==='export' || isRequestInspector() && innerWidth>=900 ? 'false':'true'}" aria-labelledby="modal-title" class="modal ${role==='popover'?'anchored-overlay selection-popover':role==='drawer'?'inspector-drawer':''} ${isRequestInspector() ? 'request-inspector' : ''} ${view.modal === 'account' ? 'account-menu' : view.modal === 'export' ? 'export-panel' : ''} ${view.modal==='new-folder' || view.modal==='file-transfer' && view.data.transfer==='rename' ? 'modal-name' : ''} ${view.modal==="new-work"?"modal-create":""} ${view.modal==='chat-response-settings'?'chat-response-settings':''} ${["new-work", "import", "manage-services", "operations", "service-details"].includes(view.modal) ? "wide" : ""}"><div class="modal-head">${view.modal === 'pi-request-detail' && requestNavigationCurrent() ? btn(`${icon('arrow',16)} Requests`, 'back-pi-requests', 'quiet inspector-back') : ''}<h2 id="modal-title">${title}</h2>${btn(icon("close", 20), "close-modal", "icon-button quiet", 'aria-label="Close dialog"')}</div><div class="modal-body">${view.modalError && view.modal!=="new-work" && !(view.modal==='sessions' && view.modalError===target?.resourceErrors?.agent) ? feedback(esc(view.modalError), "warning") : ""}${body}${["file-transfer", "file-delete", "new-folder", "upload-overwrite"].includes(view.modal) ? fileModalResults() : ""}</div><div class="modal-action-status ${view.modal==="new-work"?"create-action-status":""}" data-action-status-slot>${view.modal==="new-work" && view.modalError?feedback(esc(view.modalError),"warning"):""}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ""}</dialog>`;
}
function importExitButtons(op: Operation) {
  const work = adapter.getWork(op.workId), start = importStarts.get(op.id);
  const allow = importCanStart(op, work, work ? adapter.project(work).action : '', !!start);
  return `${work ? workLink('View Work', work.id) : ''}${allow ? btn('Start and open', 'start-import-open', 'primary', `data-id="${esc(op.workId)}" data-import-id="${esc(op.id)}"`) : start && work && controlReady(workControls.get(work.id), work) ? btn('Open Work', 'open-work', 'primary', `data-id="${esc(work.id)}"`) : ''}`;
}
function serviceDetails(s: Service, w: Work) {
  const logs = adapter.serviceLogs(w.id, s.id), control = serviceControls.get(`${w.id}:${s.id}`);
  const op = control?.operationId ? adapter.getOperation(control.operationId) : undefined, port = s.ports.includes(view.port) ? view.port : s.ports[0];
  const open = serviceCompletionReady(op, w.id, adapter.project(w).usable, s, port) ? btn('Open Service', 'open-controlled-service', 'primary', `data-service-id="${esc(s.id)}" data-port="${port}"`) : '';
  const currentService = route()[0] === 'app' ? w.services.find(item => item.id === route()[2]) : activeService(w);
  const entryChoice = s.ports.length > 1 && currentService?.id === s.id
    ? `<label class="field">Web entry<select id="port-select" data-service-id="${esc(s.id)}" ${!adapter.project(w).usable || !s.enabled || s.observed !== 'Ready' ? 'disabled' : ''}>${s.ports.map(item => `<option value="${item}" ${item === port ? 'selected' : ''}>Port ${item}</option>`).join('')}</select></label>` : '';
  return `${controlMarkup(control)}${open}${entryChoice}<dl class="property-list"><dt>Domain</dt><dd><code>${esc(s.domain)}</code></dd><dt>Declared Web ports</dt><dd>${s.ports.length ? s.ports.join(", ") : "No Web ports declared"}</dd><dt>Enabled</dt><dd>${s.enabled ? "Yes" : "No · persists across Work restarts"}</dd><dt>Observed</dt><dd>${badge(s.observed)}</dd>${s.operationId ? `<dt>Operation</dt><dd><button class="inline-link" data-action="operation" data-id="${s.operationId}">${s.operationId}</button></dd>` : ""}</dl>${s.error ? feedback(esc(s.error), "warning") : ""}<div class="service-controls">${btn("Start", "service-action", "small", `data-control="start" data-id="${s.id}" ${!adapter.project(w).usable || s.observed === "Ready" ? "disabled" : ""}`)}${btn("Stop", "service-action", "small", `data-control="stop" data-id="${s.id}" ${!adapter.project(w).usable || !s.enabled ? "disabled" : ""}`)}${btn("Restart", "service-action", "small", `data-control="restart" data-id="${s.id}" ${!adapter.project(w).usable || !s.enabled || s.observed !== "Ready" ? "disabled" : ""}`)}${btn("Retry", "service-action", "small", `data-control="retry" data-id="${s.id}" ${!adapter.project(w).usable || !s.enabled || s.observed !== "Failed" ? "disabled" : ""}`)}${btn("Remove", "service-action", "small danger", `data-control="remove" data-id="${s.id}" ${!adapter.project(w).usable ? "disabled" : ""}`)}</div><div class="logs-heading"><h3>Log snapshot</h3>${btn(`${icon("refresh", 14)} Refresh logs`, "refresh-logs", "small")}</div>${logs?.loading ? '<p role="status">Reading this Service’s log snapshot…</p>' : ""}${logs?.error ? feedback(esc(logs.error), "warning", btn("Retry logs", "refresh-logs", "small")) : ""}<pre class="logs">${esc(logs?.value?.text ?? logs?.value?.reason ?? "Logs have not been retrieved.")}</pre><p class="muted small-text">${esc(logs?.value?.status ?? "Not retrieved")} · Collected ${esc(logs?.value?.collectedAt ?? "Not provided")} · ${logs?.value?.truncated ? "Output truncated" : "Bounded snapshot"}. This is not a live stream.</p>`;
}
let focusReturn = "";
function focusKey(el: HTMLElement | null) {
  if (!el) return "";
  if (el.id) return "#" + CSS.escape(el.id);
  const action = el.dataset.action;
  if (action)
    return `[data-action="${CSS.escape(action)}"]${el.dataset.id ? `[data-id="${CSS.escape(el.dataset.id)}"]` : ""}${el.dataset.path ? `[data-path="${CSS.escape(el.dataset.path)}"]` : ""}${el.dataset.runId ? `[data-run-id="${CSS.escape(el.dataset.runId)}"]` : ""}${el.dataset.optionValue !== undefined ? `[data-option-value="${CSS.escape(el.dataset.optionValue)}"]` : ''}`;
  return "";
}
async function guard(next: () => void | Promise<void>) {
  if (dirty()) {
    pendingNav = next;
    openModal("dirty-file");
  } else if (view.configDirty) {
    pendingNav = next;
    openModal("dirty-settings");
  } else await next();
}
function runAndShow(op: Operation) {
  openModal("operation", { id: op.id });
}
function reviewOperation(op: Operation, check?: ActionRecord) {
  if (!check || !actions.current(check) || !op.checkedWorkId || op.state === 'unknown') return;
  for (const original of actions.records.values()) {
    if (original.blocked && original.work === op.checkedWorkId && original.businessId === op.id) actions.review(original);
  }
}
function targetWork(el: HTMLElement) {
  return (
    adapter.getWork(
      el.dataset.id || (view.modal ? view.data.workId || view.data.id : '') || route()[1],
    ) || current()
  );
}
function assertFileAdmission(workId: string, targets: readonly FileMutationTarget[]) {
  const work = adapter.getWork(workId);
  if (!work || !adapter.project(work).usable) throw new Error('This Work is not ready for new file changes. Check its current state.');
  const conflict = unknownFiles.conflict(workId, targets);
  if (conflict) throw new Error(`The earlier result for ${conflict.paths.join(' and ')} is unknown. Refresh its original directories before a new action.`);
}
function retainFileResults(workId: string, targets: readonly FileMutationTarget[], rows: TransferResult[], record?: ActionRecord) {
  const normalized = new FileMutationResults(targets); normalized.record(targets, rows);
  const results = [...normalized.results];
  if (results.some(result => result.status === 'unknown')) {
    for (const target of targets) {
      const belongs = (path: string) => [target.source, target.destination].some(root => root && (path === root || path.startsWith(root + '/')));
      if (results.some(result => result.status === 'unknown' && belongs(result.path))) unknownFiles.add(workId, target, record);
    }
    if (record && actions.current(record)) record.blocked = true;
  }
  adapter.state.transfers = results; adapter.transfersByWork.set(workId, results);
  return results;
}
function confirmFileAttempt(record: ActionRecord | undefined, results: readonly TransferResult[]) {
  if (!record || !actions.current(record)) return;
  // Only retainFileResults binds a lock to an actually submitted unknown path.
  // A cumulative summary must not copy an earlier unknown into a later retry.
  record.successFeedback = results.length && results.every(result => result.status === 'succeeded') ? 'toast' : undefined;
  actions.confirm(record, `${results.filter(result => result.status === 'succeeded').length} paths confirmed; ${results.filter(result => result.status !== 'succeeded').length} need review`);
}
async function performFileAttempt(attempt: FileModalAttempt, targets: readonly FileMutationTarget[], record?: ActionRecord) {
  const epoch = adapter.identityEpoch, origin = viewKey();
  if (record) attempt.feedbackRecords.add(record);
  const confirm = (results: readonly TransferResult[]) => { for (const original of attempt.feedbackRecords) confirmFileAttempt(original, results); };
  for (const target of targets) {
    if (epoch !== adapter.identityEpoch || origin !== viewKey()) throw new ViewChanged();
    assertFileAdmission(attempt.workId, [target]);
    const rows = await adapter.transfer(attempt.workId, attempt.operation, [target.source], target.destination, attempt.overwrite);
    if (epoch !== adapter.identityEpoch) throw new ViewChanged();
    const retained = retainFileResults(attempt.workId, [target], rows, record);
    attempt.ledger.record([target], retained); attempt.selected.delete(target.source);
    const combined = [...attempt.ledger.results];
    adapter.state.transfers = combined; adapter.transfersByWork.set(attempt.workId, combined);
    if (fileAttempt === attempt) modalTransfers = combined;
    if (origin !== viewKey()) { confirm(combined); throw new ViewChanged(); }
    render();
  }
  const results = [...attempt.ledger.results]; confirm(results);
  if (record) void actions.refresh(record, () => adapter.loadDirectory(attempt.workId, view.path));
  if (results.length && results.every(result => result.status === 'succeeded')) { view.selected = []; closeModal(); toast('File changes saved.'); }
  else { view.modalError = 'Review each path below. Select only confirmed failures to retry; unknown results require a read-only refresh.'; render(); }
}
function fileModalResults() {
  let rows = fileAttempt ? fileAttempt.ledger.results : modalTransfers;
  if (!rows.length && current()) {
    // A modal can close without resolving its original mutation. Bring the
    // original path evidence and read-only recovery back into the new panel.
    const sources = ['file-transfer', 'file-delete'].includes(view.modal) ? decodePaths(view.data.paths) : [];
    const name = view.formName.trim(), validRename = !!name && !['.', '..'].includes(name) && !/[\\/\x00-\x1f\x7f]/.test(name);
    const targets = sources.map(source => ({ source, ...(view.modal === 'file-transfer' ? {
      destination: view.data.transfer === 'rename'
        ? (validRename ? joinPath(source.slice(0, source.lastIndexOf('/')) || '/', name) : source)
        : joinPath(view.formDestination, source.split('/').pop()!),
    } : {}) }));
    const locks = [...new Set(targets.map(target => unknownFiles.conflict(current()!.id, [target])).filter(lock => !!lock))];
    rows = locks.flatMap(lock => lock!.paths.map(path => ({ path, status: 'unknown' as const, message: 'An earlier change to this original path has an unknown result. Reread before another explicit action.' })));
  }
  if (!rows.length) return '';
  const eligible = fileAttempt?.ledger.retryTargets(fileAttempt.ledger.targets.map(target => target.source)) || [];
  return `<section class="transfer-results"><h3>Path results</h3>${rows.map(row => `<div class="transfer-row"><code>${esc(row.path)}</code><span>${esc(row.status)} · ${esc(row.message)}</span></div>`).join('')}${eligible.map(target => `<label class="check-row"><input type="checkbox" data-retry-source="${esc(target.source)}" ${fileAttempt?.selected.has(target.source) ? 'checked' : ''}> Retry ${esc(target.source)}</label>`).join('')}${eligible.length ? btn('Retry selected failed paths', 'retry-selected-files', 'small', fileAttempt?.selected.size ? '' : 'disabled') : ''}${rows.some(row => row.status === 'unknown') ? feedback('The original result is unknown. Refresh the source and destination before a new explicit action.', 'warning', btn('Refresh original paths', 'refresh-files', 'small')) : ''}</section>`;
}
async function saveFile(record?: ActionRecord) {
  const w = current();
  if (!w) return false;
  if (view.fileWriteUncertain) throw new Error("Reread the saved version and explicitly approve its baseline before retrying.");
  assertFileAdmission(w.id, [{ source: view.file }]);
  const content = view.fileDraft;
  const path = view.file, key = location.hash, epoch = adapter.identityEpoch;
  const result = await adapter.saveFile(w.id, path, content, view.fileBaseline, view.fileUnprotected, confirmed => {
    if (epoch !== adapter.identityEpoch) return;
    if (record && actions.current(record)) { record.successFeedback = 'toast'; actions.confirm(record, 'Saved'); if (!confirmed.modified) { record.refresh = 'refreshing'; render(); } }
    if (key === location.hash && view.file === path) { view.fileOriginal = content; view.fileBaseline = confirmed.modified || ''; toast('File saved. Confirming the saved version.'); }
  });
  if (epoch !== adapter.identityEpoch) throw new ViewChanged();
  retainFileResults(w.id, [{ source: path }], [result], record);
  if (record) { record.refresh = result.message === 'Confirmed' ? '' : 'failed'; record.refreshError = result.message; }
  if (key !== location.hash || path !== view.file) throw new ViewChanged();
  if (result.status === "succeeded") {
    view.fileOriginal = content;
    view.fileBaseline = result.modified ?? ""; view.fileUnprotected = false; view.fileReread = null;
    toast(result.message === "Confirmed" ? "File saved." : result.message);
    return true;
  }
  view.fileWriteUncertain = result.status === "unknown" || result.httpStatus === 412;
  view.modalError = result.message;
  toast(result.message);
  return false;
}
async function saveConfig(record?: ActionRecord) {
  const w = current();
  if (!w || !view.config) return false;
  if (!validateConfigDraft()) return false;
  const submitted = structuredClone(view.config), version = JSON.stringify(view.config), key = location.hash;
  await adapter.saveConfiguration(w.id, submitted);
  if (record) { actions.confirm(record, 'Settings saved'); void actions.refresh(record, () => adapter.loadConfiguration(w.id)); }
  if (key !== location.hash) throw new ViewChanged();
  if (JSON.stringify(view.config) === version) { view.config = structuredClone(submitted); view.configDirty = false; }
  toast("Changes saved. Apply changes to use them.");
  return true;
}
function validateConfigDraft() {
  if (!view.config) return false;
  try { synchronizeConfiguration(view.config); return true; }
  catch (error) { view.config.validationError = String((error as Error).message); view.settingsTab = "Advanced"; render(); root.querySelector<HTMLTextAreaElement>("#advanced-editor")?.focus(); toast("Fix the configuration JSON or discard the draft before continuing."); return false; }
}
function downloadBlob(name: string, contents: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Download started. Check your browser to confirm the file was saved.");
}
async function handleAction(action: string, el: HTMLElement, record?: ActionRecord) {
  const ownedView = () => record?.kind === 'identity' ? location.hash : record && ['lifecycle', 'transfer'].includes(record.kind) ? `${location.hash}:${modalChoice}` : viewKey();
  const stay = async <T>(pending: Promise<T>): Promise<T> => { const key = ownedView(), modal = view.modal; const value = await pending; if (key !== ownedView() || record?.kind === 'identity' && !!view.modal && view.modal !== modal) throw new ViewChanged(); return value; };
  const accept = (op: Operation) => { if (record) { record.businessId = op.id; actions.confirm(record, `Accepted · ${op.id}`); if (op.workId) void actions.refresh(record, () => op.kind === 'Delete Work' ? adapter.listWorks() : adapter.loadWork(op.workId)); } };
  const show = (op: Operation) => { accept(op); runAndShow(op); };
  const filesConfirmed = (results: TransferResult[]) => {
    if (record) { confirmFileAttempt(record, results); record.blocked = results.some(result => result.status === 'unknown'); if (currentWork) void actions.refresh(record, () => adapter.loadDirectory(currentWork.id, view.path)); }
    if (results.some(result => result.status !== 'succeeded')) { view.modalError = 'Some paths were not confirmed. Review per-path results before submitting again.'; render(); return false; }
    return true;
  };
  const w = targetWork(el);
  const currentWork = current();
  const s = currentWork ? activeService(currentWork) : undefined;
  if (currentWork && !adapter.project(currentWork).usable && ['new-session', 'send-message', 'apply-config', 'service-action', 'confirm-service-control', 'save-file', 'dirty-save', 'confirm-upload-overwrite', 'confirm-folder', 'confirm-transfer', 'confirm-file-delete', 'retry-selected-files', 'cancel-pi-request', 'retry-pi-request'].includes(action)) throw new Error('This Work is not ready for new runtime or file changes. Check its current state.');
  switch (action) {
    case 'save-default-core': await adapter.savePreferences(view.coreAddress || adapter.state.core.address); break;
    case 'clear-default-core': await adapter.savePreferences(null); break;
    case 'read-default-core': await adapter.loadPreferences(); break;
    case 'open-chat-settings':openChatPicker();break;
    case 'toggle-chat-setting': {
      if(!chatSettingsContextCurrent()) break;
      const kind=el.dataset.kind!;
      view.data.expanded=view.data.expanded===kind?'':kind;
      render();focusChatSettings(kind);break;
    }
    case 'chat-input-options':openModal('chat-input-options');break;
    case 'choose-chat-setting': {
      if(!currentWork || !chatSettingsContextCurrent()) break;
      const kind=el.dataset.kind;
      const {state,catalog,editable,thinkingEditable}=chatSettings(currentWork,view.session);
      if(!editable || kind==='thinking' && !thinkingEditable) break;
      view.data.expanded='';
      if(kind==='model') {
        const ref=el.dataset.optionValue || null,model=ref===null?catalog?.defaultModel:catalog?.models.find(m=>m.modelRef===ref);
        if(!model) break;
        const thinking=model.thinkingLevels && (state.thinking===null || !model.thinkingLevels.includes(state.thinking))?model.defaultThinkingLevel ?? 'off':state.thinking;
        if(ref!==state.ref || thinking!==state.thinking) adapter.selectModel(currentWork.id,view.session,ref);
      } else if(el.dataset.optionValue!==state.thinking) adapter.selectThinking(currentWork.id,view.session,el.dataset.optionValue==='normal'?null:el.dataset.optionValue!);
      if(pendingWebCommand && pendingWebCommand.kind===kind){const state=adapter.modelSelection(currentWork.id,view.session);Object.assign(pendingWebCommand,{workId:currentWork.id,sessionId:view.session,pair:{ref:state.ref,thinking:state.thinking}});}
      confirmPendingChatCommand();render();focusChatSettings(kind);break;
    }
    case 'service-picker': openModal('service-picker'); root.querySelector<HTMLElement>('#modal [aria-selected=true]')?.focus(); break;
    case 'select-service': {
      const service = currentWork?.services.find(item => item.id === el.dataset.id && item.ports.length && item.observed !== 'Removed');
      if (!currentWork || !service) break;
      serviceChoice++; view.serviceOpenError = ''; view.service = service.id; view.port = service.ports[0]; closeModal(); render();
      if (service.enabled && service.observed === 'Ready') await stay(adapter.ensureServiceEntry(currentWork.id, service.id, view.port));
      break;
    }
    case 'toggle-workspace-chat': {
      if (!currentWork || view.tab !== 'Services' || view.layout !== 'workspace') break;
      const panels = workspacePanels.get(currentWork.id);
      if (innerWidth < 900) panels.narrowChat = !panels.narrowChat; else panels.collapsed = !panels.collapsed;
      render(); [...root.querySelectorAll<HTMLElement>('[data-action="toggle-workspace-chat"]')].find(node=>node.getClientRects().length)?.focus({preventScroll:true}); break;
    }
    case 'reset-workspace-split': if(currentWork){workspacePanels.get(currentWork.id).ratio=.7;closeModal();render();root.querySelector<HTMLElement>('#workspace-splitter')?.focus();} break;
    case 'back-pi-requests': backToRequests(); break;
    case 'service-focus':enterWorkspaceFocus(route()[0] === 'app' ? 'service-only' : 'service-chat', el);break;
    case 'focus-toggle-chat':if(view.layout === 'service-chat' || view.layout === 'service-only'){view.layout=view.layout==='service-chat'?'service-only':'service-chat';render();if(view.layout==='service-chat')root.querySelector<HTMLTextAreaElement>('#composer')?.focus();else restoreLayoutFocus();}break;
    case 'restore-layout':if(view.modal==='agent-menu')closeModal();restoreChatLayout();break;
    case 'exit-service-focus':await exitWorkspaceFocus();break;
    case 'service-fullscreen':if(['agent-menu','service-menu'].includes(view.modal))closeModal();try{if(document.fullscreenElement===root)await document.exitFullscreen();else if(root.requestFullscreen)await root.requestFullscreen();else throw new Error();view.fullscreenError='';}catch{view.fullscreenError=document.fullscreenElement===root?'Full screen could not be closed. Try again.':'Full screen could not be opened. Focus remains available.';}render();break;
    case 'choose-command':fillCommand(el.dataset.command!);break;
    case 'load-commands':if(currentWork)await adapter.loadCommands(currentWork.id);break;
    case 'toggle-slash-mode':view.literalSlash=!view.literalSlash;render();break;
    case 'check-chat-submission':if(currentWork){const result=await stay(adapter.recoverChatSubmission(currentWork.id));if(result){if(result.kind==='run'){const submitted=pendingImageSubmissions.get(currentWork.id);if(submitted&&submitted.epoch===adapter.identityEpoch){consumeImageSubmission(currentWork.id,submitted);}}if(result.kind==='session'){const original=view.drafts[draftKey(currentWork)] || '';view.session=result.session.sessionId;if(original && !view.drafts[draftKey(currentWork)])view.drafts[draftKey(currentWork)]=original;}for(const old of actions.records.values())if(old.blocked && old.work===currentWork.id && old.kind==='agent' && (result.kind==='session'?old.action==='new-session'||old.action==='send-message':old.action==='send-message'))actions.review(old);}render();}break;

    case "close-modal": closeModal(); break;
    case "back-works":
      await guard(() => {
        rememberWork();
        view.modal = "";
        view.file = "";
        view.config = null;
        location.hash = "/works";
      });
      break;
    case "back-work":
      await guard(() => {
        view.modal = "";
        view.configDirty = false;
        view.config = null;
        location.hash = `/work/${currentWork?.id || w?.id}`;
        render();
      });
      break;
    case "open-work":
      if (w) {
        closeModal();
        await openWork(w,record);
      }
      break;
    case "clear-search":
      view.search = "";
      render();
      root.querySelector<HTMLInputElement>('#search')?.focus({preventScroll:true});
      break;
    case "operations": await stay(adapter.recoverOperations()); openModal("operations"); break;
    case "new-work":
      if (createDraft.open()) resetCreateFields();
      openModal('new-work'); break;
    case "account":
    case "connection":
    case "import":
    case "agent-menu":
    case "manage-services":
    case "webdav":
    case "service-menu":
      openModal(action);
      break;
    case "file-add": {
      if(fileActionsContext){closeFileActions(true);break;}
      fileActionsContext=fileActionsKey();render();root.querySelector<HTMLElement>('#file-actions [role=menuitem]')?.focus();break;
    }
    case "work-menu":
    case "work-info":
    case "delete-work":
    case "stop-work":
      openModal(action, { id: w?.id || "" });
      break;
    case 'sessions':
      openModal('sessions', {id:w?.id || ''});if(currentWork)await stay(adapter.loadSessions(currentWork.id)); break;
    case "switch-core":
      void adapter.loadPreferences();
      openModal("switch-core");
      break;
    case "check-browser-access": await stay(adapter.checkBrowserAccess()); toast("Browser access checked."); if (adapter.state.signedIn) await stay(adapter.checkConnection()); break;
    case "copy-reopen-command": await copy(adapter.reopenCommand()); break;
    case "copy-logout-command": await copy(adapter.logoutCommand()); break;
    case "reset-browser-access": openModal("reset-browser-access"); break;
    case "confirm-reset-browser-access": await adapter.resetBrowserAccess(); view.modal = ""; render(); break;
    case "sign-in": {
      const account = root.querySelector<HTMLInputElement>("#auth-account")?.value ?? "";
      const password = root.querySelector<HTMLInputElement>("#auth-password")?.value ?? "";
      try { await stay(adapter.signIn(view.coreAddress || adapter.state.core.address, account, password)); } finally { const input = root.querySelector<HTMLInputElement>('#auth-password'); if (input) input.value = ''; }
      if (importSignInSuspended && adapter.inspection) { importSignInSuspended = false; openModal("import"); } else { importSignInSuspended = false; closeModal(); } toast("Signed in."); break;
    }
    case "import-sign-in": importSignInSuspended = true; view.modal = ""; render(); toast("Sign in to continue importing the inspected package."); break;
    case "sign-out": {
      const result = await stay(adapter.signOut()); view.drafts = {};textDraftRevisions.clear();imageDrafts.clear();pendingImageSubmissions.clear();imageDraftErrors.clear(); view.config = null; view.configDirty = false; view.file = "";
      closeModal(); toast(result.credentialCleared === false ? `Local identity cleared; saved credential cleanup is incomplete. Run ${adapter.logoutCommand()}.` : result.remoteRevocationConfirmed ? "Signed out. Browser access is retained." : "Local identity and saved credential cleared. Remote revocation could not be confirmed."); break;
    }
    case "reconnect": toast("Start piwork-cli desktop and open the fresh launch address."); break;
    case "confirm-switch-core": await stay(adapter.switchCore(view.coreAddress)); view.drafts = {};textDraftRevisions.clear();imageDrafts.clear();pendingImageSubmissions.clear();imageDraftErrors.clear(); view.config = null; view.configDirty = false; closeModal(); break;
    case "retry-works": await stay(adapter.listWorks()); break;
    case 'retry-services':
      if(currentWork)await stay(adapter.loadServices(currentWork.id));
      break;
    case 'retry-conversation':
      if(view.modal === 'sessions' && view.modalError === currentWork?.resourceErrors?.agent)view.modalError = '';
      if(currentWork){const selected=view.session;await stay(adapter.loadSessions(currentWork.id));if(selected && selected!==currentWork.sessions[0]?.id && currentWork.sessions.some(session=>session.id===selected))await stay(adapter.loadSession(currentWork.id,selected));}
      break;
    case "check-connection": await stay(adapter.checkConnection()); toast("Connection checked."); break;
    case "start-work":
      if (w) await submitWorkStart(w, record);
      break;
    case 'start-import-open': {
      const op = adapter.getOperation(el.dataset.importId || '');
      const importedWork = op && adapter.getWork(op.workId);
      if (!importCanStart(op, importedWork, importedWork ? adapter.project(importedWork).action : '', !!op && importStarts.has(op.id))) throw new Error('Check the original imported Work before starting it.');
      const intent: ImportStartIntent = { workId: importedWork!.id, importId: op!.id, epoch: adapter.identityEpoch, origin: location.hash, choice: modalChoice, selection: `${areaChoice}:${serviceChoice}:${sessionChoice}:${fileChoice}`, consumed: false, phase: 'pending' };
      importStarts.set(op!.id, intent); await submitWorkStart(importedWork!, record, intent); advanceImportStarts(); break;
    }
    case 'check-work-progress':
      if (w) {
        const control = workControls.get(w.id);
        if (control?.operationId) await adapter.checkOperation(control.operationId);
        const checked = await adapter.refreshWorkStatus(w.id); await adapter.listWorks();
        if (checked?.id === w.id && checked.desired === 'running' && ['Ready', 'Degraded'].includes(checked.status) && control?.phase === 'unknown') {
          control.phase = 'reviewed'; control.error = '';
          for (const original of actions.records.values()) if (original.work === w.id && original.blocked && ['start-work', 'start-import-open'].includes(original.action || '')) actions.review(original);
        }
        if (record && control?.operationId) reviewOperation(adapter.getOperation(control.operationId)!, record);
        render();
      }
      break;
    case 'check-service-progress': {
      const serviceId = el.dataset.serviceId || view.data.serviceId, target = w, epoch = adapter.identityEpoch;
      if (target) {
        const control = serviceControls.get(`${target.id}:${serviceId}`);
        if (control?.operationId) await adapter.checkOperation(control.operationId);
        await adapter.loadServices(target.id);
        if (epoch !== adapter.identityEpoch || adapter.getWork(target.id) !== target) throw new ViewChanged();
        const checked = target.services.find(service => service.id === serviceId);
        const resolved = control?.phase === 'unknown' && !target.resourceErrors?.services && adapter.project(target).usable && (
          ['start Service', 'restart Service', 'retry Service'].includes(control.action) && checked?.enabled && checked.observed === 'Ready' ||
          control.action === 'stop Service' && checked?.enabled === false && checked.observed === 'Stopped' ||
          control.action === 'remove Service' && !checked);
        if (resolved && control) {
          control.phase = 'reviewed'; control.error = '';
          for (const original of actions.records.values()) if (original.work === target.id && original.kind === 'service' && original.resource === `service:${serviceId}` && original.blocked) actions.review(original);
        }
        render();
      }
      break;
    }
    case 'open-controlled-service': {
      if (!currentWork) break;
      const serviceId = el.dataset.serviceId!, service = currentWork.services.find(item => item.id === serviceId);
      const control = serviceControls.get(`${currentWork.id}:${serviceId}`), op = control?.operationId && adapter.getOperation(control.operationId), port = Number(el.dataset.port);
      if (!serviceCompletionReady(op || undefined, currentWork.id, adapter.project(currentWork).usable, service, port)) throw new Error('Check this Service’s current readiness before opening.');
      await guard(async () => {
        areaChoice++; serviceChoice++; view.tab = 'Services'; view.service = serviceId; view.port = port; closeModal();
        await adapter.ensureServiceEntry(currentWork.id, serviceId, port); render();
      }); break;
    }
    case "confirm-stop":
      if (w && (view.data.exportAfterStop || el.dataset.exportStop)) beginExport(w, true, record);
      else if (w) show(await stay(adapter.lifecycle(w.id, "stop")));
      break;
    case "confirm-delete":
      if (w) {
        const op = await stay(adapter.lifecycle(w.id, "delete"));
        // Acceptance is displayed before any associated list refresh.
        history.replaceState(null, "", location.pathname + location.search + "#/works");
        lastRoute = location.hash;
        show(op);
      }
      break;
    case "retry-work-read": await loadRoute(); break;
    case 'work-operations': {
      if (!w) break; const ids = adapter.project(w).operationIds;
      if (ids.length === 1) openModal('operation', { id: ids[0] });
      else openModal('operations', { workId: w.id });
      break;
    }
    case "check-work": {
      if (!w) break;
      const originals = [...actions.records.values()].filter(original => original.blocked && original.kind === 'lifecycle' && original.work === w.id && original.resource === w.id);
      const ids = adapter.project(w).operationIds;
      const op = ids.length === 1 ? await stay(adapter.checkOperation(ids[0])) : undefined;
      const checked = await stay(adapter.refreshWorkStatus(w.id));
      if (record && actions.current(record) && checked?.id === w.id) {
        for (const original of originals) {
          const started = ['start-work', 'start-import-open'].includes(original.action || '') && checked.desired === 'running' && ['Ready', 'Degraded'].includes(checked.status);
          const stopped = original.action === 'confirm-stop' && checked.desired === 'stopped' && checked.status === 'Stopped';
          if (started || stopped) { actions.review(original); const control = workControls.get(w.id); if (control?.phase === 'unknown') { control.phase = 'reviewed'; control.error = ''; } }
        }
      }
      if (op) { reviewOperation(op, record); openModal('operation', { id: op.id }); }
      else { if (ids.length > 1) openModal('operations', { workId: w.id }); toast('Work status checked.'); }
      break;
    }
    case "toggle-create-advanced":
      view.createAdvanced = !view.createAdvanced;
      render();
      break;
    case "create-work": {
      if (!view.createName.trim()) {
        view.modalError = "Enter a name for your Work.";
        render();
        break;
      }
      const config: Partial<Configuration> = {};
      if (view.createJson.trim()) {
        let data;
        try {
          data = JSON.parse(view.createJson);
        } catch {
          throw Error(
            "Configuration JSON is invalid. Your entered values are preserved.",
          );
        }
        if (typeof data !== "object" || Array.isArray(data) || !data)
          throw Error("Configuration must be a JSON object.");
        config.advanced = JSON.stringify(data, null, 2);
      }
      if (view.createSkillMode !== "defaults")
        config.skills =
          view.createSkillMode === "none" ? [] : [...view.createSkills];
      if (view.createPackageMode !== "defaults")
        config.packages =
          view.createPackageMode === "none"
            ? []
            : view.createPackages.map((name) => ({
                name,
                enabled: true,
                source: "Core copy",
              }));
      if (view.createAgents) config.agents = view.createAgents;
      if (record) latestCreateToken = record.token;
      const token = createDraft.capture(), origin = ownedView(), epoch = adapter.identityEpoch;
      const op = await adapter.createWork(view.createName.trim(), config, view.createImage);
      if (epoch !== adapter.identityEpoch) throw new ViewChanged();
      if (op.id && op.workId) createDraft.accept(token);
      if (record) { record.businessId = op.id; actions.confirm(record, `Accepted · ${op.id}`); }
      if (origin !== ownedView()) throw new ViewChanged();
      show(op);
      break;
    }
    case "settings":
      if (!await exitWorkspaceFocus()) break;
      if (w) {
        await guard(async () => {
          location.hash=`/work/${w.id}/settings`;if(record)record.view=location.hash;render();
          await stay(adapter.loadConfiguration(w.id));
          view.config = structuredClone(w.config);
          view.configDirty=false;consumeWebSelection("settings");
          view.modal="";
          location.hash = `/work/${w.id}/settings`;
          render();
        });
      }
      break;
    case "tab-Services":
    case "tab-Files":
    case "tab-Chat":
      if (!await exitWorkspaceFocus()) break;
      await guard(async () => {
        areaChoice++; fileChoice++; filesRestoreNotice = "";
        view.tab=action.slice(4);view.modal="";view.file="";render();
        if (action === "tab-Services" && currentWork) { await stay(adapter.loadServices(currentWork.id)); const service = activeService(currentWork); if (service) { view.service = service.id; view.port = service.ports.includes(view.port) ? view.port : service.ports[0] || 0; if (view.port && service.observed === "Ready") await stay(adapter.ensureServiceEntry(currentWork.id, service.id, view.port)); } }
        if (action === "tab-Files" && currentWork) await stay(adapter.loadDirectory(currentWork.id, view.path));
        view.tab = action.slice(4);
        view.modal = "";
        view.file = "";
        if (route()[2]) location.hash = `/work/${currentWork?.id}`;
        render();
      });
      break;
    case "focus-chat":
      enterWorkspaceFocus('chat-only', el);
      break;
    case "toggle-agent":
      view.agentOpen = !view.agentOpen;
      render();
      break;
    case "select-session":
      sessionChoice++;
      view.session=el.dataset.id!;consumeWebSelection('resume');closeModal();render();
      if (currentWork) await stay(adapter.loadSession(currentWork.id, view.session));
      closeModal();
      break;
    case "new-session":
      if (currentWork) {
        sessionChoice++;
        view.session = await stay(adapter.newSession(currentWork.id));
        if (record) { record.businessId=view.session;actions.confirm(record, 'Session created'); }
        closeModal();
        render();
      }
      break;
    case "suggest-message":
    case "suggest-files":
      if (currentWork) {
        if (!view.session) view.session = await stay(adapter.newSession(currentWork.id));
        textDraftRevisions.set(draftKey(currentWork),(textDraftRevisions.get(draftKey(currentWork)) || 0)+1);
        view.drafts[draftKey(currentWork)] =
          action === "suggest-message"
            ? "Build a simple notes app and save its data in the shared workspace."
            : "List the shared workspace files and help me analyze the data I choose.";
        render();
        root.querySelector<HTMLTextAreaElement>("#composer")?.focus();
      }
      break;
    case "service-requests":
    case "pi-requests":
      if(currentWork){
        const refreshing=view.modal==='pi-requests',source=refreshing?view.data.source || 'chat':action==='service-requests'?'service':'chat';
        const serviceName=refreshing?view.data.serviceName || '':source==='service'?s?.name || '':'';
        if(!refreshing)requestNavigation={epoch:adapter.identityEpoch,workId:currentWork.id,source,serviceName,entry:focusKey(el),scroll:0,focus:''};
        openModal('pi-requests',{serviceName,source});await stay(adapter.loadRequests(currentWork.id,serviceName));}break;
    case "next-pi-requests":
      if(currentWork)await stay(adapter.loadRequests(currentWork.id,view.data.serviceName || '',true));break;
    case "pi-request-detail":
      if(currentWork){
        const requestId=el.dataset.id || view.data.requestId,source=view.data.source || 'chat',serviceName=view.data.serviceName || '';
        if(view.modal==='pi-requests' && requestNavigationCurrent())Object.assign(requestNavigation!,{serviceName,scroll:root.querySelector<HTMLElement>('.modal-body')?.scrollTop || 0,focus:focusKey(el)});
        if(view.modal!=='pi-request-detail')openModal('pi-request-detail',{requestId,source,serviceName});
        const pendingRetry=source==='chat'?adapter.requestRetries.get(`${currentWork.id}:${requestId}`):undefined;
        if(pendingRetry){
          const result=await stay(adapter.checkRequestRetry(currentWork.id,requestId));
          if(result){
            for(const old of actions.records.values())if(old.blocked && old.work===currentWork.id && old.action==='retry-pi-request' && old.resource===`request:${requestId}` && old.businessId===pendingRetry.submissionKey)actions.review(old);
            openModal('pi-request-detail',{requestId:result.requestId,source,serviceName});
            await stay(adapter.loadRequest(currentWork.id,result.requestId));break;
          }
        }
        await stay(adapter.loadRequest(currentWork.id,requestId));for(const old of actions.records.values())if(old.blocked && old.work===currentWork.id && old.action==='cancel-pi-request' && old.resource===`request:${requestId}`)actions.review(old);}break;
    case "next-pi-evidence":
      if(currentWork)await stay(adapter.loadRequest(currentWork.id,view.data.requestId,true));break;
    case "cancel-pi-request": {
      const requestId = el.dataset.id || view.data.requestId;
      const request = currentWork && (adapter.requestDetails.get(`${currentWork.id}:${requestId}`)?.request
        ?? adapter.requestPage(currentWork.id, view.data.serviceName || '')?.items.find(item => item.requestId === requestId));
      if (!canCancelPiRequest(request, !!currentWork && adapter.project(currentWork).usable) || currentWork && adapter.requestCancellation(currentWork.id, requestId)) throw new Error('Check the original live request before cancelling.');
      if(currentWork)await stay(adapter.cancelRequest(currentWork.id,requestId));break;
    }
    case "retry-pi-request":
      if(currentWork){const originalId=view.data.requestId,data={...view.data};
        try {const result=await stay(adapter.retryRequest(currentWork.id,originalId));openModal('pi-request-detail',{...data,requestId:result.requestId});await stay(adapter.loadRequest(currentWork.id,result.requestId));}
        catch(error){if(record && actions.current(record))record.businessId=adapter.requestRetries.get(`${currentWork.id}:${originalId}`)?.submissionKey;throw error;}
      }break;
    case "load-models":
      if(currentWork) {
        const error=adapter.models.get(currentWork.id)?.error;
        await stay(adapter.loadModels(currentWork.id).then(() => {
          if(adapter.getWork(currentWork.id)===currentWork && error && currentWork.resourceErrors?.agent===error) delete currentWork.resourceErrors.agent;
        }));
      }break;
    case "save-model":
      if(currentWork && view.session) await stay(adapter.saveModel(currentWork.id,view.session));break;
    case "check-session-model":
      if(currentWork && view.session) await stay(adapter.checkSessionModel(currentWork.id,view.session));break;
    case "about-piwork":openModal('about-piwork');adapter.loadAbout();break;
    case "refresh-about":adapter.loadAbout();break;
    case "check-image-support":if(currentWork)await stay(adapter.refreshImageCapabilities(currentWork.id));break;
    case "add-chat-images": root.querySelector<HTMLInputElement>('#chat-image-input')?.click();break;
    case "remove-chat-image":if(currentWork)imageDrafts.remove(draftKey(currentWork),el.dataset.id!);break;
    case "retry-chat-image":case "preview-chat-image": {
      const session=currentWork?.sessions.find(s=>s.id===el.dataset.session),image=session?.messages.flatMap(m=>m.runId===el.dataset.run?m.images ?? []:[]).find(i=>i.imageIndex===Number(el.dataset.index));
      if(currentWork&&session&&image){if(action==='retry-chat-image')adapter.retryHistoryImage(currentWork.id,session.id,el.dataset.run!,image);else{const state=adapter.imageLoads.get(adapter.historyImageKey(currentWork.id,session.id,el.dataset.run!,image.imageIndex));if(state?.url)openModal('chat-image-preview',{url:state.url});}}
      break;
    }
    case "send-message":
      if (currentWork) {
        const cancelRunId=el.dataset.cancelRunId;
        const originalKey = draftKey(currentWork);
        const text = view.drafts[originalKey] || "";
        const images=imageDrafts.capture(originalKey),textRevision=textDraftRevisions.get(originalKey) || 0,error=imageDraftErrors.get(originalKey);
        if(images.length){const reason=adapter.imageInputReason(currentWork.id,view.session);if(reason)throw new Error(reason);}
        if(images.length && text.trimStart().startsWith('/') && !view.literalSlash)throw new Error('Images require Send as text. Your draft is kept.');
        if(text.trimStart().startsWith('/') && !view.literalSlash){
          const match=/^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text.trim());const name=match?.[1] || '';
          if(webCommands.includes(name)){
            if(match?.[2]?.trim())throw new Error('This workspace command does not accept arguments. Your draft is kept.');
            if(name==='new'){view.session=await stay(adapter.newSession(currentWork.id));}
            else if(name==='resume'){pendingWebCommand={key:originalKey,text,kind:'resume'};openModal('sessions');await stay(adapter.loadSessions(currentWork.id));return;}
            else if(name==='model'||name==='thinking'){pendingWebCommand={key:originalKey,text,kind:name};openChatPicker(name);return;}
            else if(name==='settings'){pendingWebCommand={key:originalKey,text,kind:name};await handleAction('settings',el);return;}
            if(view.drafts[originalKey]===text)view.drafts[originalKey]='';render();return;
          }
          if((adapter.chatCapabilities.get(currentWork.id) ?? 0)<1)throw new Error('Resource commands are unavailable in this Work. Choose Send as text to send a literal slash.');
          const directory=adapter.commands.get(currentWork.id);
          if(!directory?.confirmed || directory.error || !directory.items.some(command=>command.command===`/${name}`))throw new Error('Unknown resource command. Choose an available command or Send as text.');
        }
        if(!view.session){view.session=await stay(adapter.newSession(currentWork.id));render();await stay(adapter.saveModel(currentWork.id,view.session));}
        adapter.selectedService = view.service;
        const submission:ImageSubmission={key:originalKey,destinationKey:draftKey(currentWork),text,textRevision,images,epoch:adapter.identityEpoch,error};pendingImageSubmissions.set(currentWork.id,submission);
        let submittedRunId="";try {submittedRunId=await stay(adapter.send(currentWork.id, view.session, text, view.includeIdentity,text.trimStart().startsWith("/") && !view.literalSlash?"command":images.length || (adapter.chatCapabilities.get(currentWork.id) ?? 0)>=1?"text":undefined,images.map(i=>i.input),cancelRunId).then(result=>{consumeImageSubmission(currentWork.id,submission);return result;}));}catch(error){if(!adapter.chatSubmissions.has(currentWork.id))pendingImageSubmissions.delete(currentWork.id);throw error;}
        pendingImageSubmissions.delete(currentWork.id);
        if (record) { record.businessId=submittedRunId; actions.confirm(record, 'Message accepted'); }

        view.scrollPinned=true;render();const composer=root.querySelector<HTMLTextAreaElement>("#composer");if(composer && composer.value===text)composer.value=view.drafts[draftKey(currentWork)] || "";
      }
      break;
    case "cancel-run":
      if (currentWork) { const targetRunId=el.dataset.runId || view.data.runId || currentWork.run?.id;await stay(adapter.cancelRun(currentWork.id,targetRunId)); if (record) {record.businessId=targetRunId;actions.confirm(record, 'Cancellation requested');} }
      break;
    case "resume-run":
      if (currentWork) { if(el.dataset.runId && el.dataset.runId!==currentWork.run?.id){openModal('run-details',{runId:el.dataset.runId});await stay(adapter.loadRunDetails(currentWork.id,el.dataset.runId));break;} await stay(adapter.resumeRunConnection(currentWork.id)); if (record) {record.businessId=currentWork.run?.id;actions.confirm(record, 'Reconnected');} }
      break;
    case "active-run":
    case "run-details": {
      if(currentWork){const runId=el.dataset.runId || (action==='active-run'?adapter.activeRuns.get(currentWork.id)?.run?.id:undefined) || currentWork.run?.id;
        openModal('run-details',runId?{runId}:{});if(runId)await stay(adapter.loadRunDetails(currentWork.id,runId));}
      break;
    }
    case "check-active-run":if(currentWork)await stay(adapter.loadActiveRun(currentWork.id,true));break;
    case "scroll-bottom":
      view.scrollPinned = true;
      render();
      break;
    case "open-source":
      if (currentWork) {
        sourceGuardReturn = (dirty() || view.configDirty) && view.modal ? { epoch: adapter.identityEpoch, route: location.hash, modal: view.modal, data: { ...view.data }, focus: focusKey(el) } : undefined;
        await guard(async () => {
          const originalDetail = sourceGuardReturn; sourceGuardReturn = undefined;
          const epoch = adapter.identityEpoch, origin = viewKey();
          try { await openFile(currentWork, el.dataset.path!); }
          catch (error) {
            if (epoch === adapter.identityEpoch && origin === viewKey() && !(error instanceof ViewChanged)) {
              if (originalDetail) { modalChoice++; view.modal = originalDetail.modal; view.data = { ...originalDetail.data }; }
              view.modalError = error instanceof Error ? error.message : String(error); toast(view.modalError);
            }
            throw error;
          }
          // openFile verifies the captured view before publishing its own path.
          // That deliberate path change must not be mistaken for navigation away.
          if (epoch !== adapter.identityEpoch || current()?.id !== currentWork.id) throw new ViewChanged();
          areaChoice++; view.tab = "Files"; view.config = null; view.configDirty = false;
          view.modal = ""; modalChoice++;
          history.replaceState(null, "", location.pathname + location.search + `#/work/${encodeURIComponent(currentWork.id)}`);
          lastRoute = location.hash; render();
        });
      }
      break;
    case "copy":
      await copy(el.dataset.copy || "");
      break;
    case "copy-domain":
      if (s) await copy(s.domain);
      break;
    case "copy-local":
      if (currentWork && s) {
        await copy(adapter.localLink(currentWork.id, s.id, view.port));
        toast(
          "Local Work link copied. It requires this CLI and signed-in browser session.",
        );
      }
      break;
    case "open-app":
    case "open-window":
      if (currentWork && s) {
        const opened = window.open('about:blank', '_blank', action === 'open-window' ? 'width=1120,height=820' : undefined);
        if (!opened) { view.serviceOpenError = 'The browser blocked this window. Allow popups or copy the protected local link.'; render(); throw new Error(view.serviceOpenError); }
        opened.opener = null; view.serviceOpenError = '';
        if (adapter.serviceEmbed(currentWork.id, s.id, view.port) === "denied") {
          try { opened.location.href = await stay(adapter.directServiceURL(currentWork.id, s.id, view.port)); }
          catch (error) { opened.close(); throw error; }
          closeModal(); break;
        }
        opened.location.href = adapter.localLink(currentWork.id, s.id, view.port);
        closeModal();
      }
      break;
    case 'retry-service-entry':
      if (currentWork && s) await stay(adapter.ensureServiceEntry(currentWork.id, s.id, view.port, true)); break;
    case 'check-preview':
      if (currentWork && s) await stay(adapter.serviceFrameLoaded(currentWork.id, s.id, view.port)); break;
    case "service-details":
      openModal("service-details", { serviceId: el.dataset.id! });
      if (currentWork) await stay(adapter.readLogs(currentWork.id, el.dataset.id!));
      break;
    case "service-action": {
      const control = el.dataset.control!;
      if (control === "stop" || control === "remove")
        openModal("service-control", { serviceId: el.dataset.id!, control });
      else if (currentWork) await submitServiceControl(currentWork, el.dataset.id!, control, record);
      break;
    }
    case "confirm-service-control":
      if (currentWork) await submitServiceControl(currentWork, view.data.serviceId, view.data.control, record);
      break;
    case "refresh-logs":
      if (currentWork) await stay(adapter.readLogs(currentWork.id, view.data.serviceId));
      render();
      break;
    case "refresh-files":
      if (currentWork) {
        const epoch = adapter.identityEpoch, snapshot = unknownFiles.reviewSnapshot(currentWork.id), origin = ownedView();
        const directories = [...new Set([view.path, ...snapshot.directories])], read: string[] = [];
        for (const directory of directories) { await adapter.loadDirectory(currentWork.id, directory); if (epoch !== adapter.identityEpoch) throw new ViewChanged(); read.push(directory); }
        const reviewed = unknownFiles.completeReview(snapshot, read);
        for (const identity of reviewed.actions) { const original = actions.records.get(identity.key); if (original && original.token === identity.token && original.generation === identity.generation) actions.review(original); }
        if (origin !== ownedView()) throw new ViewChanged();
        if (view.file) await stay(adapter.readFile(currentWork.id, view.file));
      }
      if (view.file && currentWork) {
        const fresh = currentWork.files.find((f) => f.path === view.file);
        if (fresh && (dirty() || view.fileWriteUncertain)) {
          view.fileReread = { ...fresh };

        } else if (fresh) {
          view.fileDraft = fresh.content || "";
          view.fileOriginal = view.fileDraft; view.fileBaseline = fileVersion(fresh.modified); view.fileReread = null; view.fileUnprotected = false;
        }
      }
      render();
      break;
    case "file-path":
      await guard(async () => {
        const choice = ++fileChoice; filesRestoreNotice = "";
        if (currentWork) await stay(adapter.loadDirectory(currentWork.id, el.dataset.path!));
        if (choice !== fileChoice) throw new ViewChanged();
        view.path = el.dataset.path!;
        view.file = "";
        view.selected = [];
        render();
      });
      break;
    case "open-file":
      if (currentWork) {
        const path = el.dataset.path || view.data.path;
        await guard(async () => {
          view.modal = "";
          await stay(openFile(currentWork, path));
          render();
        });
      }
      break;
    case "close-file":
      await guard(() => {
        view.file = "";
        render();
      });
      break;
    case "discard-file":
      view.fileDraft = view.fileOriginal;
      render();
      break;
    case "allow-unprotected-file":
      view.fileUnprotected = true; toast("Unprotected overwrite approved for the next save."); break;
    case "use-reread-version":
      if (view.fileReread?.kind === "text") { view.fileBaseline = fileVersion(view.fileReread.modified); view.fileOriginal = view.fileReread.content ?? ""; view.fileUnprotected = false; view.fileWriteUncertain = false; view.fileReread = null; render(); }
      break;
    case "save-file":
      await stay(saveFile(record));
      break;
    case "dirty-discard":
      view.fileDraft = view.fileOriginal;
      view.modal = "";
      await pendingNav?.();
      pendingNav = null;
      render();
      break;
    case "dirty-save":
      if (await stay(saveFile(record))) {
        view.modal = "";
        await pendingNav?.();
        pendingNav = null;
        render();
      }
      break;
    case "clear-selection":
      view.selected = [];
      render();
      break;
    case "file-menu":
      openModal("file-menu", { path: el.dataset.path! });
      break;
    case "new-folder":
      openModal("new-folder"); focusNameField(0, 0);
      break;
    case "confirm-upload-overwrite":
      if (currentWork) {
        if (!pendingUploadTarget || pendingUploadTarget.epoch !== adapter.identityEpoch || pendingUploadTarget.workId !== currentWork.id || pendingUploadTarget.directory !== view.path) throw new Error('The upload target changed. Choose these files again in the intended Work and directory.');
        const overwrite=el.dataset.uploadMode==='overwrite',review=uploadReview(modalTransfers),eligible=overwrite?review.overwrite:review.retry;
        const directory=pendingUploadTarget.directory,files=pendingUploadFiles.filter(file=>eligible.some(row=>row.path===joinPath(directory,file.name))),targets=files.map(file=>({source:joinPath(directory,file.name)}));
        if(!files.length)throw new Error('No confirmed eligible upload remains. Refresh the original paths.');
        const epoch = adapter.identityEpoch, origin = viewKey(); assertFileAdmission(currentWork.id, targets);
        const rows = await adapter.upload(currentWork.id, directory, files, overwrite);
        if (epoch !== adapter.identityEpoch) throw new ViewChanged();
        const results = retainFileResults(currentWork.id, targets, rows, record); confirmFileAttempt(record, results);
        if (origin !== viewKey()) throw new ViewChanged(); modalTransfers = [...modalTransfers.filter(row=>!targets.some(target=>target.source===row.path)),...results];
        pendingUploadFiles = pendingUploadFiles.filter(file => modalTransfers.some(row => row.path === joinPath(directory, file.name) && row.status !== 'succeeded'));
        if (!pendingUploadFiles.length && modalTransfers.length && modalTransfers.every(row => row.status === 'succeeded')) { closeModal(); toast('Upload complete.'); } else { view.modalError = 'Some uploads need review. Successful paths will not be submitted again.'; render(); }
      }
      break;
    case "confirm-folder":
      if (currentWork) {
        const path = joinPath(view.path, validateName(view.formName)), targets = [{ source: path }];
        const epoch = adapter.identityEpoch, origin = viewKey(); assertFileAdmission(currentWork.id, targets);
        const results = await adapter.transfer(currentWork.id, 'mkdir', ['new-folder'], path);
        if (epoch !== adapter.identityEpoch) throw new ViewChanged();
        const retained = retainFileResults(currentWork.id, targets, results, record); confirmFileAttempt(record, retained);
        if (origin !== viewKey()) throw new ViewChanged(); modalTransfers = retained;
        if (filesConfirmed(retained)) { closeModal(); toast('Folder created.'); }
      }
      break;
    case "file-rename":
    case "file-copy":
    case "file-move": {
      const paths = el.dataset.path ? [el.dataset.path] : view.selected;
      if (!paths.length) throw Error("Select a file or folder first.");
      openModal("file-transfer", {
        paths: JSON.stringify(paths),
        transfer: action.slice(5),
      });
      if (action === 'file-rename') {
        const initial = renameField(paths[0], currentWork?.files.find(file => file.path === paths[0])?.kind === 'directory');
        view.formName = initial.value; render(); focusNameField(initial.selectionStart, initial.selectionEnd);
      }
      break;
    }
    case "confirm-transfer":
      if (currentWork) {
        if (fileAttempt?.ledger.hasResults) throw new Error('Select only the confirmed failed paths to retry.');
        const paths = decodePaths(view.data.paths);
        const targets = paths.map(source => ({ source, destination: view.data.transfer === 'rename'
          ? joinPath(source.slice(0, source.lastIndexOf('/')) || '/', validateName(view.formName))
          : joinPath(view.formDestination, source.split('/').pop()!) }));
        assertFileAdmission(currentWork.id, targets);
        const conflicts = targets.map(target => target.destination).filter(path => currentWork.files.some(file => file.path === path));
        if (conflicts.length && !view.formOverwrite) { view.formOverwrite = true; view.data.overwritePath = conflicts.join(', '); render(); break; }
        const attempt: FileModalAttempt = { workId: currentWork.id, operation: view.data.transfer === 'copy' ? 'copy' : 'move', overwrite: view.formOverwrite, ledger: new FileMutationResults(targets), selected: new Set(), feedbackRecords: new Set() };
        fileAttempt = attempt;
        await performFileAttempt(attempt, targets, record);
      }
      break;
    case 'retry-selected-files':
      if (fileAttempt && currentWork?.id === fileAttempt.workId) {
        const attempt = fileAttempt, targets = attempt.ledger.retryTargets([...attempt.selected]);
        if (!targets.length) throw new Error('Select a confirmed failed path to retry. Unknown or successful paths cannot be repeated.');
        await performFileAttempt(attempt, targets, record);
      }
      break;
    case "file-delete": {
      const paths = el.dataset.path ? [el.dataset.path] : view.selected;
      if (!paths.length) throw Error("Select a file or folder first.");
      openModal("file-delete", { paths: JSON.stringify(paths) });
      break;
    }
    case "confirm-file-delete":
      if (currentWork) {
        if (fileAttempt?.ledger.hasResults) throw new Error('Select only the confirmed failed paths to retry.');
        const targets = decodePaths(view.data.paths).map(source => ({ source }));
        assertFileAdmission(currentWork.id, targets);
        const attempt: FileModalAttempt = { workId: currentWork.id, operation: 'delete', overwrite: false, ledger: new FileMutationResults(targets), selected: new Set(), feedbackRecords: new Set() };
        fileAttempt = attempt;
        await performFileAttempt(attempt, targets, record);
      }
      break;
    case "upload":

      if (!currentWork || !adapter.project(currentWork).usable) throw new Error('Confirm the current Work before choosing files to upload.');
      uploadPickerTarget = { epoch: adapter.identityEpoch, workId: currentWork.id, directory: view.path };
      root.querySelector<HTMLInputElement>("#upload-input")?.click();
      break;
    case "download-file": {
      if (currentWork) downloadURL(adapter.fileURL(currentWork.id, el.dataset.path || view.file));
      break;
    }
    case "settings-section":
      if (!validateConfigDraft()) break;
      view.settingsTab = el.dataset.tab!;
      render();
      break;
    case "save-config":
      await stay(saveConfig(record));
      break;
    case "discard-config":
      if (currentWork) {
        view.config = structuredClone(currentWork.config);
        view.configDirty = false;
        render();
      }
      break;
    case "dirty-config-discard":
      view.configDirty = false;
      view.config = null;
      view.modal = "";
      await pendingNav?.();
      pendingNav = null;
      render();
      break;
    case "dirty-config-save":
      if (await stay(saveConfig(record))) {
        view.modal = "";
        await pendingNav?.();
        pendingNav = null;
        render();
      }
      break;
    case "apply-config":
      if (currentWork) {
        const origin=ownedView(),epoch=adapter.identityEpoch;
        const op=await adapter.applyConfiguration(currentWork.id);
        if(epoch!==adapter.identityEpoch || record && !actions.current(record))throw new ViewChanged();
        // The accepted object survives navigation; only opening its view is conditional.
        accept(op);
        if(origin!==ownedView())throw new ViewChanged();
        runAndShow(op);
      }
      break;
    case "refresh-config":
      if (currentWork) {
        await stay(adapter.loadConfiguration(currentWork.id));
        if (!view.configDirty)
          view.config = structuredClone(currentWork.config);

      }
      break;
    case "clear-skills":
      if (view.config) {
        view.config.skills = [];
        view.configDirty = true;
        render();
      }
      break;
    case "core-skill-copy":
      if (view.config && currentWork) {
        openModal("refresh-core-skills", { id: el.dataset.id! });
        break;
      }
      break;
    case "confirm-core-skills":
      if (currentWork) { const draft = JSON.stringify(view.config); await stay(adapter.replaceSkill(currentWork.id, view.data.id));
        if (JSON.stringify(view.config) === draft) { view.config = structuredClone(currentWork.config); view.configDirty = false; }
        if (record) { actions.confirm(record, 'Skill copy saved'); void actions.refresh(record, () => adapter.loadConfiguration(currentWork.id)); }
        closeModal(); toast("Current Core copies saved. Apply changes to load them."); }
      break;
    case "check-catalog":
      const available = await stay(adapter.checkCatalog());
      toast(available ? "Core catalogs confirmed. Existing selections preserved." : `Catalog check incomplete: ${[adapter.catalog.skills.error, adapter.catalog.packages.error].filter(Boolean).join(" ")}`);
      break;
    case "skill-detail":
    case "package-detail":
      openModal(action, { id: el.dataset.id! });
      break;
    case "refresh-package-detail":
      if (currentWork) await stay(adapter.loadPackages(currentWork.id));
      break;
    case "install-package":
      view.installSource = "";
      view.installName = adapter.getPackages()[0]?.name ?? "";
      packageFiles = [];
      openModal("install-package");
      break;
    case "update-package":
      view.installName = el.dataset.id!;
      view.installSource = "";
      openModal("install-package", {
        update: "true",
        updateTarget: el.dataset.id!,
      });
      break;
    case "toggle-package":
      if (view.config) {
        const p = view.config.packages.find((p) => p.name === el.dataset.id);
        if (p) p.enabled = !p.enabled;
        view.configDirty = true;
        render();
      }
      break;
    case "remove-package":
      openModal("remove-package-confirm", { id: el.dataset.id! });
      break;
    case "confirm-remove-package":
      if (currentWork) { show(await stay(adapter.removePackage(currentWork.id, view.data.id))); view.config = null; }
      break;
    case "unselect-package":
      if (view.config) {
        view.config.packages = view.config.packages.filter(
          (p) => p.name !== el.dataset.id,
        );
        view.configDirty = true;
        render();
      }
      break;
    case "clear-packages":
      if (view.config) {
        view.config.packages = [];
        view.configDirty = true;
        render();
      }
      break;
    case "select-package":
      if (view.config) {
        if (!view.config.packages.some((p) => p.name === el.dataset.id))
          view.config.packages.push({
            name: el.dataset.id!,
            enabled: true,
            source: "Current Core copy",
          });
        view.configDirty = true;
        render();
      }
      break;
    case "choose-package-source":
      root
        .querySelector<HTMLInputElement>(
          view.installType === "ZIP"
            ? "#package-zip-input"
            : "#package-directory-input",
        )
        ?.click();
      break;
    case "confirm-install":
      if (currentWork) {
        if (view.installType !== "Core" && !view.installSource)
          throw Error("Choose or enter a package source.");
        const name =
          view.data.updateTarget ||
          (view.installType === "Core" ? view.installName : view.installSource);
        show(
          await stay(adapter.installPackage(
            currentWork.id,
            name,
            `${view.installType}: ${view.installType === "Core" ? "current Core copy" : view.installSource}`,
            packageFiles, view.data.updateTarget,
          )),
        );
        view.config = null;
      }
      break;
    case "import-agents":
    case "import-json":
    case "create-import-agents":
      root
        .querySelector<HTMLInputElement>(
          action === "import-json"
            ? "#json-input"
            : action === "create-import-agents"
              ? "#create-agents-input"
              : "#agents-input",
        )
        ?.click();
      break;
    case "choose-work-file":
      root.querySelector<HTMLInputElement>("#work-file-input")?.click();
      break;
    case "check-inspection-import":
      await stay(adapter.checkInspectionImport()); break;
    case "retry-inspection-cleanup":
      await stay(adapter.cleanupInspection(el.dataset.id!)); break;
    case "confirm-import":
      show(await stay(adapter.importWork(view.importName.trim())));
      break;
    case 'export':
    case 'prepare-export':
      if (w) beginExport(w, false, record);
      break;
    case 'view-snapshot': {
      const snap = await stay(adapter.fetchSnapshot(el.dataset.id!));
      if (el.dataset.workId && snap.workId !== el.dataset.workId) throw new Error('This snapshot does not belong to the original Work.');
      openModal('export', { id: snap.workId, snapshotId: snap.id }); break;
    }
    case 'download-work': {
      const snap = adapter.getSnapshot(el.dataset.id!);
      if (!snap) throw new Error('Check the exact original snapshot first.');
      openExportFlow(exportFlows.start(snap.workId, { mode: 'existing', snapshotId: snap.id }), record); break;
    }
    case 'check-export-flow': await exportFlows.check(el.dataset.id!); break;
    case 'pause-export-flow': exportFlows.pause(el.dataset.id!); break;
    case 'resume-export-flow': await exportFlows.resume(el.dataset.id!); break;
    case 'save-export-file': {
      const id = el.dataset.id!, snap = await stay(adapter.fetchSnapshot(id));
      const job = await stay(adapter.checkDownload(id));
      if (adapter.getSnapshot(id) !== snap || adapter.downloads.get(id) !== job || !exportSnapshotAvailable(snap) || !job?.ready || job.snapshotId !== snap.id || job.workId !== snap.workId) throw new Error('The original snapshot and transfer are not confirmed for download.');
      downloadURL(`/_desktop/api/downloads/${encodeURIComponent(job.transferId)}/content`, adapter.getWork(snap.workId)?.name || snap.workId); break;
    }
    case 'check-download': {
      const id = el.dataset.id!;
      await stay(adapter.checkDownload(id));
      const job = adapter.downloads.get(id);
      if (record && actions.current(record) && job?.ready) for (const original of actions.records.values()) {
        if (original.kind === 'transfer' && original.work === record.work && original.action === 'download-work' && original.resource === id && original.businessId === job.transferId) actions.review(original);
      }
      adapter.observeDownload(id); break;
    }
    case "operation":
      openModal("operation", { id: el.dataset.id! });
      if (!adapter.getOperation(el.dataset.id!)) await stay(adapter.checkOperation(el.dataset.id!));
      break;
    case "pause-operation": adapter.pauseOperation(el.dataset.id!); render(); break;
    case "resume-operation": await stay(adapter.checkOperation(el.dataset.id!)); adapter.resumeOperation(el.dataset.id!); render(); break;
    case "check-operation":
      reviewOperation(await stay(adapter.checkOperation(el.dataset.id!)), record);
      break;
    case "lookup-operation": {
      const op = await stay(adapter.checkOperation(view.operationQuery.trim()));
      if (op) { reviewOperation(op, record); openModal("operation", { id: op.id }); }
      else
        throw Error(
          "Operation not found for this Core and user. Verify the original ID.",
        );
      break;
    }
    case "lookup-snapshot": {
      const snap = await stay(adapter.fetchSnapshot(view.snapshotQuery.trim()));
      if (snap) openModal("export", { id: snap.workId, snapshotId: snap.id });
      else
        throw Error(
          "Snapshot not found. Check its exact original ID and Core.",
        );
      break;
    }
    case "clear-operations":
      await stay(adapter.clearOperations());
      break;
  }
}
function joinPath(parent: string, name: string) {
  return (parent === "/" ? "" : parent) + "/" + name;
}
function validateName(name: string) {
  const result = name.trim();
  if (!validLocalName(result))
    throw Error("Enter a name without path separators.");
  return result;
}
function focusNameField(start: number, end: number) {
  const choice = modalChoice, epoch = adapter.identityEpoch;
  queueMicrotask(() => {
    if (choice !== modalChoice || epoch !== adapter.identityEpoch) return;
    const field = root.querySelector<HTMLInputElement>('#modal #form-name');
    if (!field) return;
    field.value = view.formName; field.focus({ preventScroll: true }); field.setSelectionRange(start, end);
  });
}
async function openFile(w: Work, path: string) {
  const key = viewKey(), epoch = adapter.identityEpoch, choice = ++fileChoice;
  await adapter.readFile(w.id, path);
  if (key !== viewKey() || epoch !== adapter.identityEpoch || choice !== fileChoice) throw new ViewChanged();
  const f = w.files.find((f) => f.path === path);
  if (!f) {
    throw new Error("This file is not available in the workspace.");
  }
  if (f.kind === "directory") {
    view.path = f.path;
    view.file = "";
    view.selected = [];
  } else {
    view.path = f.path.slice(0, f.path.lastIndexOf("/")) || "/";
    view.file = f.path;
    view.fileDraft = f.content || "";
    view.fileOriginal = view.fileDraft; view.fileEditable = f.kind === "text" && f.size <= 1048576; view.fileBaseline = fileVersion(f.modified); view.fileReread = null; view.fileUnprotected = false; view.fileWriteUncertain = false;
  }
}
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard.");
  } catch {
    toast(`Clipboard unavailable. Copy this value: ${text}`);
  }
}
function visibleActionRecord(record: ActionRecord) {
  if (record.kind === 'read' && record.action === 'retry-works' && record.error && adapter.worksError) return false;
  if (record.kind === 'read' && record.action === 'open-source') return record.work === current()?.id && (record.sourceContext === `${view.tab}:${view.session}:${view.modal}` || view.tab === 'Files' && record.resource === view.file);
  if (record.kind === 'read' && ['tab-Files','refresh-files','file-path','open-file','open-source'].includes(record.action || '')) {
    if (record.work !== current()?.id || view.tab !== 'Files') return false;
    if (['file-path','open-file','open-source'].includes(record.action || '')) return record.resource === (view.file || view.path) || record.origin === (view.file || view.path);
    if (record.resource !== (view.file || view.path)) return false;
    if (record.error && !view.file) {
      const directory = adapter.directories.get(`${record.work}:${view.path}`);
      return (directory ? directory.error : current()?.resourceErrors?.files) === record.error;
    }
    return true;
  }
  if (record.kind === 'read' && ['sessions','select-session','retry-conversation','check-active-run'].includes(record.action || '')) {
    const work = current();
    if (record.work !== work?.id || record.action !== 'sessions' && record.resource !== view.session) return false;
    if (!record.error) return true;
    const error = record.action === 'check-active-run' ? adapter.activeRuns.get(work!.id)?.error
      : record.action === 'sessions' ? work?.resourceErrors?.agent
      : work?.sessions.find(session => session.id === view.session)?.error || work?.resourceErrors?.agent;
    return error === record.error;
  }
  return !record.resource?.startsWith('service:') || record.resource === `service:${view.data.serviceId || (current() ? activeService(current()!)?.id : view.service)}${record.kind === 'service' ? '' : `:${view.port}`}`;
}
function observeCurrentPage() {
  const [area,id]=route(),w=adapter.getWork(id || '');
  const settings=route()[2]==='settings';
  const showService=area==='app' || area==='work' && !settings && view.tab==='Services' && view.layout!=='chat-only';
  const panels=w?workspacePanels.get(w.id):undefined;
  const showChat=area==='work' && !settings && view.layout!=='service-only' && (view.layout==='chat-only' || view.tab==='Chat' || view.tab==='Services' ? view.layout==='chat-only' || view.tab==='Chat' || (innerWidth<900 ? !!panels?.narrowChat || view.layout==='service-chat' : view.layout==='service-chat' || !panels?.collapsed) : innerWidth>1050 || view.agentOpen);
  adapter.observePage(id || '',document.visibilityState==='visible',showChat,showService&&w?activeService(w)?.name || '':'',view.modal==='pi-request-detail'?view.data.requestId || '':'',view.modal==='pi-requests',view.modal==='pi-requests'?view.data.serviceName || '':'');
}
let fileActionsContext = '';
function fileActionsKey() { return `${adapter.identityEpoch}:${location.hash}:${view.tab}:${view.path}`; }
function closeFileActions(restore = false) {
  if(!fileActionsContext)return;
  fileActionsContext='';render();
  if(restore)root.querySelector<HTMLElement>('#file-add-trigger')?.focus({preventScroll:true});
}
function render() {
  if(fileActionsContext && (fileActionsContext!==fileActionsKey() || view.modal || view.selected.length || adapter.state.browserAccess!=='authorized'))fileActionsContext='';
  if (current()?.id === selectionWorkId) rememberWork();
  observeCurrentPage();
  if (view.config && !view.config.advancedDirty) synchronizeConfiguration(view.config);
  const active = document.activeElement as HTMLInputElement | null;
  const activeKey = focusKey(active);
  const selection =
    active && "selectionStart" in active ? active.selectionStart : null;
  const selectionEnd = active && 'selectionEnd' in active ? active.selectionEnd : selection;
  const messages = root.querySelector<HTMLElement>("#messages");
  const scroll=messages?.scrollTop || 0;
  const firstVisible=messages && !view.scrollPinned?[...messages.querySelectorAll<HTMLElement>('[data-message-key]')].find(node=>node.getBoundingClientRect().bottom>messages.getBoundingClientRect().top):undefined;
  const readingAnchor=firstVisible?{key:firstVisible.dataset.messageKey,offset:firstVisible.getBoundingClientRect().top-messages!.getBoundingClientRect().top}:undefined;
  if (!preserveChatReading && messages?.clientHeight && messages.dataset.readingKey) chatReading.set(messages.dataset.readingKey, { scroll, pinned: view.scrollPinned, anchor: readingAnchor });
  const modalScroll =
    root.querySelector<HTMLElement>(".modal-body")?.scrollTop || 0;
  const r = route();
  if (workspaceReturn && (workspaceReturn.workId !== r[1] || !['work','app'].includes(r[0]))) resetWorkspaceFocus();
  root.classList.toggle('workspace-page', ['work','app'].includes(r[0]) && !!current() && r[2] !== 'settings');
  root.dataset.layout = view.layout;
  root.classList.toggle('service-focused',view.layout !== 'workspace');
  root.classList.toggle('chat-focused',view.layout === 'chat-only');
  let html = "";
  if (adapter.state.scenario === "cli-closed")
    html = `${topbar()}<main class="auth-main">${empty("terminal", "Desktop’s local connection has closed", "Start piwork-cli desktop again, then open its new launch address. A browser-only retry cannot restart the CLI.", "")}</main>`;
  else if (
    !adapter.state.signedIn ||
    adapter.state.browserAccess !== "authorized"
  )
    html = signIn();
  else if (r[0] === "app") {
    const w = adapter.getWork(r[1]);
    if (w) {
      view.service = r[2];
      view.port = Number(r[3]);
      html = `${workHeader(w, true)}<div class="standalone-label">Independent application window · Closing this tab does not stop the Service</div><main class="standalone-app">${!adapter.project(w).retainWorkspace ? `${view.layout !== 'workspace' ? `<div class="focus-unavailable"><b>${esc(w.name)}</b>${focusControls(w)}</div>` : ''}${workState(w)}` : services(w)}</main>`;
    } else html = works();
  } else if (r[0] === "work") {
    const w = adapter.getWork(r[1]);
    html = w
      ? workPage(w)
      : [...actions.records.values()].some(record => record.work === r[1] && record.pending) ? `${topbar()}<main class="work-loading">${readPlaceholder('Loading Work…', 'service')}${btn('Back to Works', 'back-works')}</main>` : `${topbar()}${empty("grid", workReadErrors.get(r[1])?.missing ? "Work not found" : "Work unavailable", esc(workReadErrors.get(r[1])?.message || "Read this Work again to confirm its current availability."), btn("Retry", "retry-work-read", "primary") + btn("Back to Works", "back-works"))}`;
  } else html = works();
  if(view.modal==='chat-response-settings' && (!chatSettingsContextCurrent() || !html.includes('id="composer"'))) {
    if(pendingWebCommand && !pendingWebCommand.pair && ['model','thinking'].includes(pendingWebCommand.kind)) pendingWebCommand=undefined;
    view.modal='';view.modalError='';view.modalNameError=null;focusReturn='';lastFocus=null;modalChoice++;
  }
  // Ephemeral status nodes must not displace existing iframe ancestors during reconciliation.
  root.querySelectorAll('[data-action-status]').forEach(node => node.remove());
  reconcileHTML(root, `${html}${[...adapter.cleanupPending].map(([id, pending]) => feedback(`${esc(pending.message)} <code>${esc(id)}</code>`, "warning", btn("Retry cleanup", "retry-inspection-cleanup", "small", `data-id="${esc(id)}"`))).join("")}<div id="toast" class="toast ${view.toast ? "visible" : ""}" role="status" aria-live="polite">${icon("info", 17)}${esc(view.toast)}</div>${view.modal && adapter.state.browserAccess === "authorized" ? modalMarkup() : ""}<input type="file" id="chat-image-input" accept="image/png,image/jpeg,image/webp" multiple hidden><input type="file" id="upload-input" multiple hidden><input type="file" id="agents-input" accept=".md,.txt" hidden><input type="file" id="create-agents-input" accept=".md,.txt" hidden><input type="file" id="json-input" accept=".json" hidden><input type="file" id="work-file-input" accept=".work" hidden><input type="file" id="package-zip-input" accept=".zip" hidden><input type="file" id="package-directory-input" webkitdirectory multiple hidden>`);
  observeServiceFrames();
  renderActionStates(root, actions, location.hash, el => actionIntent(el), visibleActionRecord);
  for(const el of root.querySelectorAll<HTMLElement>('[data-history-image]'))if(!el.dataset.imageObserved){el.dataset.imageObserved='true';imageObserver.observe(el);}
  if (!servicePreparationScheduled) {
    servicePreparationScheduled = true;
    queueMicrotask(() => { servicePreparationScheduled = false; prepareSelectedEntry(); });
  }
  applyWorkspaceSizing();
  for(const trigger of root.querySelectorAll<HTMLElement>('[data-action]')) {
    const name=overlayForAction(trigger.dataset.action || '');
    if(!anchoredOverlay(name) || trigger.closest('#modal'))continue;
    trigger.setAttribute('aria-haspopup',overlayRole(name)==='menu'?'menu':'dialog');
    trigger.setAttribute('aria-expanded',String(view.modal===name && focusKey(trigger)===overlayAnchor));
    if(view.modal===name && focusKey(trigger)===overlayAnchor)trigger.setAttribute('aria-controls','modal');
    else trigger.removeAttribute('aria-controls');
  }
  const dialog = root.querySelector<HTMLDialogElement>("#modal");
  if (dialog) {
    syncDialogPresentation(dialog, nonmodalDialog());
    if(anchoredOverlay(view.modal))positionOverlay(dialog);
    if (!dialog.dataset.bound) { dialog.dataset.bound = "true"; dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      closeModal();
    });
    }
    const body = dialog.querySelector<HTMLElement>(".modal-body");
    if (body) body.scrollTop = modalScroll;
  }
  if (activeKey) {
    const replacement = active?.isConnected ? active : root.querySelector<HTMLInputElement>(activeKey);
    if (replacement && replacement !== document.activeElement && (!dialog || nonmodalDialog() || dialog.contains(replacement))) {
      replacement.focus({ preventScroll: true });
      if (
        selection !== null &&
        replacement.setSelectionRange &&
        replacement.type !== "checkbox"
      )
        try {
          replacement.setSelectionRange(selection, selectionEnd ?? selection);
        } catch {}
    }
  }
  if(dialog && view.modal==='chat-response-settings' && (overlayOpening || dialog.contains(document.activeElement) && (document.activeElement as HTMLButtonElement)?.disabled)) focusChatSettings(view.data.expanded || active?.dataset.kind);
  const next = root.querySelector<HTMLElement>("#messages");
  if (next) {
    const position = chatReading.get(next.dataset.readingKey || '');
    if (next.clientHeight) {
      view.scrollPinned = position?.pinned ?? view.scrollPinned;
      next.scrollTop = view.scrollPinned ? next.scrollHeight : position?.scroll ?? scroll;
      const reading = position?.anchor ?? readingAnchor;
      if(reading && !view.scrollPinned){const anchor=[...next.querySelectorAll<HTMLElement>('[data-message-key]')].find(node=>node.dataset.messageKey===reading.key);if(anchor)next.scrollTop+=anchor.getBoundingClientRect().top-next.getBoundingClientRect().top-reading.offset;}
    }
    if (!next.dataset.scrollBound) { next.dataset.scrollBound = "true"; next.addEventListener("scroll", () => {
      if (!next.clientHeight) return;
      const pinned =
        next.scrollHeight - next.scrollTop - next.clientHeight < 70;
      view.scrollPinned = pinned; rememberChatPosition();
      if (pinned === !!root.querySelector('.back-latest')) {
        view.scrollPinned = pinned;
        const old = root.querySelector(".back-latest");
        if (pinned) old?.remove();
        else if (!old) {
          const b = document.createElement("button");
          b.className = "button back-latest";
          b.dataset.action = "scroll-bottom";
          b.textContent = "Back to latest";
          next.after(b);
        }
      }
    }); }
  }
}
let splitDrag: {pointer:number;workId:string;epoch:number;ratio:number;node:HTMLElement;layout:HTMLElement}|undefined;
function finishSplitDrag(cancel=false) {
  const drag=splitDrag;splitDrag=undefined;if(!drag)return;
  if(cancel && drag.epoch===adapter.identityEpoch)workspacePanels.get(drag.workId).ratio=drag.ratio;
  if(drag.node.hasPointerCapture(drag.pointer))drag.node.releasePointerCapture(drag.pointer);
  root.classList.remove('resizing-workspace');applyWorkspaceSizing();
}
root.addEventListener('pointerdown',event=>{
  const separator=(event.target as HTMLElement).closest<HTMLElement>('#workspace-splitter'),layout=separator?.parentElement,work=current();
  if(!separator || !layout || !work || event.button!==0 || !event.isPrimary || splitGeometry(layout.clientWidth,workspacePanels.get(work.id).ratio).narrow)return;
  event.preventDefault();separator.focus();splitDrag={pointer:event.pointerId,workId:work.id,epoch:adapter.identityEpoch,ratio:workspacePanels.get(work.id).ratio,node:separator,layout};
  separator.setPointerCapture(event.pointerId);root.classList.add('resizing-workspace');
});
root.addEventListener('pointermove',event=>{
  const drag=splitDrag;if(!drag || event.pointerId!==drag.pointer)return;
  if(drag.epoch!==adapter.identityEpoch || drag.workId!==current()?.id || !drag.layout.isConnected){finishSplitDrag();return;}
  const rect=drag.layout.getBoundingClientRect(),state=workspacePanels.get(drag.workId);
  rememberChatPosition();state.ratio=splitGeometry(rect.width,(event.clientX-rect.left)/(rect.width-8)).ratio;applyWorkspaceSizing();restoreChatPosition();
});
root.addEventListener('pointerup',()=>finishSplitDrag());
root.addEventListener('pointercancel',()=>finishSplitDrag(true));
root.addEventListener('lostpointercapture',()=>finishSplitDrag());
root.addEventListener('dblclick',event=>{if((event.target as HTMLElement).closest('#workspace-splitter') && current()){workspacePanels.get(current()!.id).ratio=.7;applyWorkspaceSizing();}});
root.addEventListener('keydown',event=>{
  if(event.key==='Escape' && splitDrag){event.preventDefault();event.stopImmediatePropagation();finishSplitDrag(true);return;}
  if((event.target as HTMLElement).id!=='workspace-splitter' || !current())return;
  const layout=root.querySelector<HTMLElement>('.service-workspace'),state=workspacePanels.get(current()!.id);if(!layout)return;
  const next=keyboardSplit(event.key,event.shiftKey,layout.clientWidth,state.ratio);if(next===undefined)return;
  event.preventDefault();rememberChatPosition();state.ratio=next;applyWorkspaceSizing();restoreChatPosition();
});
window.addEventListener('resize',()=>{if(splitDrag)finishSplitDrag(true);preserveChatReading=true;try{render();}finally{preserveChatReading=false;}});
let outsideModalPointer: { pointer: number; choice: number; epoch: number; dialog: HTMLDialogElement } | undefined;
function lightModalDismissible() {
  const target = view.data.id || current()?.id;
  const records = [...actions.records.values()].filter(record => modalActionRelevant(record, location.hash, target));
  return canDismissLightModal({ modal: view.modal, dirty: dirty() || view.configDirty,
    busy: records.some(record => record.pending), unknown: records.some(record => record.blocked) });
}
root.addEventListener('pointerdown', event => {
  outsideModalPointer = undefined;
  const dialog = root.querySelector<HTMLDialogElement>('#modal');
  if (anchoredOverlay(view.modal) || event.button !== 0 || !event.isPrimary || !dialog?.open || !lightModalDismissible() ||
      !pointOutsideDialog({ x: event.clientX, y: event.clientY }, dialog.getBoundingClientRect())) return;
  outsideModalPointer = { pointer: event.pointerId, choice: modalChoice, epoch: adapter.identityEpoch, dialog };
});
root.addEventListener('pointercancel', () => { outsideModalPointer = undefined; });
root.addEventListener('pointerup', event => {
  const down = outsideModalPointer; outsideModalPointer = undefined;
  if (!down || down.pointer !== event.pointerId || down.choice !== modalChoice || down.epoch !== adapter.identityEpoch ||
      !down.dialog.isConnected || !down.dialog.open || !lightModalDismissible() ||
      !pointOutsideDialog({ x: event.clientX, y: event.clientY }, down.dialog.getBoundingClientRect())) return;
  closeModal();
});
root.addEventListener('pointerdown', event => {
  if(anchoredOverlay(view.modal) && !(event.target as HTMLElement).closest('#modal') && !(event.target as HTMLElement).closest(overlayAnchor || '#modal')) dismissAnchoredOverlay();
});
root.addEventListener('focusin', event => {
  if(!overlayOpening && anchoredOverlay(view.modal) && !(event.target as HTMLElement).closest('#modal') && !(event.target as HTMLElement).closest(overlayAnchor || '#modal')) dismissAnchoredOverlay();
});
window.addEventListener('blur',()=>{ if(anchoredOverlay(view.modal) && document.activeElement instanceof HTMLIFrameElement)dismissAnchoredOverlay(); });
root.addEventListener('scroll',()=>{ const dialog=root.querySelector<HTMLDialogElement>('#modal');if(dialog && anchoredOverlay(view.modal))positionOverlay(dialog); },true);
root.addEventListener('pointerdown', event => {
  if(fileActionsContext && !(event.target as HTMLElement).closest('.file-add-anchor')) closeFileActions();
});
root.addEventListener('focusin', event => {
  if(fileActionsContext && !(event.target as HTMLElement).closest('.file-add-anchor')) closeFileActions();
});
root.addEventListener('keydown', event => {
  if(!fileActionsContext || !(event.target as HTMLElement).closest('.file-add-anchor'))return;
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeFileActions(true);return;}
  const options=[...root.querySelectorAll<HTMLElement>('#file-actions [role=menuitem]')];
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key) && options.length){
    event.preventDefault();event.stopImmediatePropagation();const index=options.indexOf(document.activeElement as HTMLElement);
    options[event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length]?.focus();
  }
});
root.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!el || el.hasAttribute("disabled") || el.closest('[inert]')) return;
  if(el instanceof HTMLAnchorElement && el.dataset.action==='open-work') {
    if(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button!==0)return;
    e.preventDefault();
  }
  if(anchoredOverlay(view.modal) && !el.closest('#modal') && focusKey(el)===overlayAnchor && overlayForAction(el.dataset.action || '')===view.modal) {closeModal();return;}
  const menuCommand=overlayRole(view.modal)==='menu' && !!el.closest('#modal');
  const menuChoice=modalChoice;
  let menuFailed=false;
  if(el.closest('#file-actions')) {fileActionsContext='';root.querySelector<HTMLElement>('#file-add-trigger')?.focus({preventScroll:true});}
  if(["select-session","new-session"].includes(el.dataset.action || ""))imageSelection++;
  if (view.modal === 'export' && !el.closest('#modal')) { closeModal(); view.data = {}; }
  if (!view.modal) focusReturn = focusKey(el);
  const origin = viewKey();
  const submittedName = view.modal === 'new-work' && el.dataset.action === 'create-work' ? view.createName.trim()
    : view.modal === 'import' && el.dataset.action === 'confirm-import' ? view.importName.trim() : undefined;
  void dispatchAction(el).catch((error) => {
    if (error instanceof ViewChanged || origin !== viewKey()) return;
    menuFailed=menuCommand;
    if (view.modal) {
      const nameConflict = submittedName !== undefined && error instanceof DesktopError && error.code === 'WORK_NAME_CONFLICT';
      view.modalNameError = nameConflict ? { name: submittedName, message: error.message } : null;
      view.modalError = nameConflict ? currentNameError() ? '' : `The request for Work name "${submittedName}" was rejected. ${error.message}`
        : error instanceof Error ? error.message : String(error);
      render();
      if (currentNameError()) root.querySelector(`#${view.modal === 'import' ? 'import-name-error' : 'create-name-error'}`)?.scrollIntoView({ block: 'nearest' });
    } else if(!['refresh-files','file-path','open-source','select-session','retry-conversation','check-active-run'].includes(el.dataset.action || '')) toast(error instanceof Error ? error.message : String(error));
  }).finally(() => { if(menuCommand && !menuFailed && modalChoice===menuChoice && overlayRole(view.modal)==='menu')closeModal();else render(); });
});
root.addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement | HTMLTextAreaElement;
  const value = input.value;
  if (["create-name", "create-image", "create-agents", "create-json"].includes(input.id)) createDraft.edit();
  switch (input.id) {
    case "search":
      view.search = value;
      render();
      break;
    case "auth-core":
      view.coreAddress = value;
      break;
    case 'auth-account': view.authAccount = value; break;
    case "create-name":
      view.createName = value;
      clearNameFieldError();
      break;
    case "create-image":
      view.createImage = value;
      break;
    case "create-agents":
      view.createAgents = value;
      break;
    case "create-json":
      view.createJson = value;
      break;
    case "composer": {
      const work = current();
      if(work){textDraftRevisions.set(draftKey(work),(textDraftRevisions.get(draftKey(work)) || 0)+1);view.drafts[draftKey(work)]=value;view.commandCaret=input.selectionStart ?? value.length;view.commandIndex=0;render();}
      break;
    }
    case "note-title":
      view.noteTitle = value;
      break;
    case "note-body":
      view.noteBody = value;
      break;
    case "file-editor":
      view.fileDraft = value;
      render();
      break;
    case "form-name":
      view.formName = value;
      break;
    case "agents-editor":
      if (view.config) {
        view.config.agents = value; synchronizeConfiguration(view.config);
        view.configDirty = true;
        render();
      }
      break;
    case "advanced-editor":
      if (view.config) {
        editAdvanced(view.config, value);
        view.configDirty = true;
        render();
      }
      break;
    case "install-source":
      view.installSource = value;
      break;
    case "import-name":
      view.importName = value;
      clearNameFieldError();
      break;
    case "operation-query":
      view.operationQuery = value;
      break;
    case "snapshot-query":
      view.snapshotQuery = value;
      break;
  }
});
root.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement | HTMLSelectElement;
  // Chat images have their own validation and identity-bound draft handler.
  if (input.id === 'chat-image-input') return;
  const value = input.value;
  const checked = (input as HTMLInputElement).checked;
  if (input.dataset.createSkill || input.dataset.createPackage || ["create-skill-mode", "create-package-mode"].includes(input.id)) createDraft.edit();
  if (input.dataset.retrySource && fileAttempt) { if (checked) fileAttempt.selected.add(input.dataset.retrySource); else fileAttempt.selected.delete(input.dataset.retrySource); render(); }
  const w = current();
  if(input.id==='pi-service-filter' && w){view.data.serviceName=value;void adapter.loadRequests(w.id,value).catch(error=>toast(error.message));render();}
  if (input.dataset.fileSelect) {
    view.selected = checked
      ? [...view.selected, input.dataset.fileSelect]
      : view.selected.filter((p) => p !== input.dataset.fileSelect);
    render();
  }
  if (input.dataset.skill && view.config) {
    view.config.skills = checked
      ? [...view.config.skills, input.dataset.skill]
      : view.config.skills.filter((x) => x !== input.dataset.skill);
    view.configDirty = true;
    render();
  }
  if (input.dataset.createSkill) {
    view.createSkills = checked
      ? [...view.createSkills, input.dataset.createSkill]
      : view.createSkills.filter((x) => x !== input.dataset.createSkill);
    render();
  }
  if (input.dataset.createPackage) {
    view.createPackages = checked
      ? [...view.createPackages, input.dataset.createPackage]
      : view.createPackages.filter((x) => x !== input.dataset.createPackage);
    render();
  }
  switch (input.id) {
    case "include-identity":
      view.includeIdentity = checked;
      render();
      break;
    case "service-select":
      serviceChoice++;
      view.serviceOpenError = ""; view.service = value;
      view.port = w?.services.find((s) => s.id === value)?.ports[0] || 3000;
      if (w && view.port) void adapter.ensureServiceEntry(w.id, view.service, view.port).catch(error => toast(error.message));
      render();
      break;
    case "port-select": {
      const service = w && (route()[0] === 'app' ? w.services.find(item => item.id === route()[2]) : activeService(w));
      const port = Number(value);
      if (!w || !service || service.id !== input.dataset.serviceId || !service.ports.includes(port) || !adapter.project(w).usable || !service.enabled || service.observed !== 'Ready') break;
      serviceChoice++;
      view.serviceOpenError = ""; view.service = service.id; view.port = port;
      if (route()[0] === 'app') {
        history.replaceState(null, '', `#/app/${encodeURIComponent(w.id)}/${encodeURIComponent(service.id)}/${port}`);
        lastRoute = location.hash;
      }
      void adapter.ensureServiceEntry(w.id, service.id, port).catch(error => toast(error.message));
      render();
      break;
    }
    case "create-skill-mode":
      view.createSkillMode = value;
      render();
      break;
    case "create-package-mode":
      view.createPackageMode = value;
      render();
      break;
    case "form-destination":
      view.formDestination = value;
      view.formOverwrite = false;
      render();
      break;
    case "install-type":
      view.installType = value;
      view.installSource = "";
      render();
      break;
    case "install-name":
      view.installName = value;
      break;
    case "delete-confirm": {
      view.deleteConfirmed = checked;
      const b = root.querySelector<HTMLButtonElement>(
        '[data-action="confirm-delete"]',
      );
      if (b) b.disabled = !checked;
      break;
    }
  }
  if (input instanceof HTMLInputElement && input.type === "file") {
    const selection = ++selectionRequest; fileSelections.set(input.id, selection);
    const intent: ActionIntent = { key: `file-input:${w?.id || 'local'}:${input.id}${input.id === 'upload-input' ? '' : ':' + selection}`, kind: input.id === 'upload-input' ? 'files' : 'read', work: w?.id, resource: input.id,
      label: input.id === 'upload-input' ? 'Checking upload targets' : 'Reading selected file', target: `${w?.name || 'Local CLI'} · ${input.files?.[0]?.name || 'Selected files'}`, view: location.hash };
    const origin = viewKey();
    void dispatchAction(input, record => handleFiles(input, record), intent).catch((err) => {
      if (err instanceof ViewChanged || origin !== viewKey()) return;
      view.modalError = String(err.message || err);
      toast(view.modalError);
    });
  }
});
async function handleFiles(input: HTMLInputElement, record?: ActionRecord) {
  const key = viewKey(), selection = fileSelections.get(input.id), epoch = adapter.identityEpoch;
  const valid = () => key === viewKey() && selection === fileSelections.get(input.id) && epoch === adapter.identityEpoch;
  const files = Array.from(input.files || []);
  if (!files.length) return;
  const w = current();
  if (input.id === "upload-input") {
    const selected = uploadPickerTarget; uploadPickerTarget = undefined;
    if (!w || !selected || selected.epoch !== epoch || selected.workId !== w.id || selected.directory !== view.path) throw new Error('Upload not submitted: the original Work, directory, or identity changed while choosing files. Return to the intended Work and choose files again.');
    pendingUploadTarget = selected;
    const directory = selected.directory, targets = files.map(file => ({ source: joinPath(directory, file.name) }));
    assertFileAdmission(w.id, targets);
    const rows = await adapter.upload(w.id, directory, files);
    if (epoch !== adapter.identityEpoch) throw new ViewChanged();
    const results = retainFileResults(w.id, targets, rows, record); confirmFileAttempt(record, results);
    if (record) void actions.refresh(record, () => adapter.loadDirectory(w.id, directory));
    if (!valid()) throw new ViewChanged();
    pendingUploadFiles = files.filter(file => results.some(result => result.path.endsWith("/" + file.name) && result.status !== "succeeded"));
    if (pendingUploadFiles.length) { openModal("upload-overwrite"); modalTransfers = results; }
    else if (results.length && results.every(row => row.status === "succeeded")) toast("Upload complete.");
    render();
  } else if (input.id === "work-file-input") {
    if (!files[0].name.endsWith(".work"))
      throw Error("Choose a file with the .work extension.");
    const transfer = await adapter.inspectWork(files[0]);
    if (!transfer || transfer !== adapter.inspectionTransfer) return;
    view.inspectFilename = files[0].name;
    view.inspected = true;
    view.inspectActual = true;
    render();
  } else if (
    input.id === "package-zip-input" ||
    input.id === "package-directory-input"
  ) {
    packageFiles = files;
    view.installSource =
      files.length > 1
        ? `${files.length} local directory files`
        : files[0].name;
    render();
  } else {
    if (files[0].size > 1048576)
      throw Error(
        "Configuration file exceeds the 1 MiB import limit.",
      );
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        await files[0].arrayBuffer(),
      );
    } catch {
      if (!valid()) throw new ViewChanged();
      throw Error(
        "This configuration file is not valid UTF-8. Your existing draft is preserved.",
      );
    }
    if (!valid()) throw new ViewChanged();
    if (input.id === "create-agents-input") { createDraft.edit(); view.createAgents = text; }
    else if (view.config) {
      if (input.id === "json-input") { editAdvanced(view.config, text); view.settingsTab = "Advanced"; }
      else { view.config.agents = text; synchronizeConfiguration(view.config); }
      view.configDirty = true;
    }
    render();
  }
}
root.addEventListener("compositionstart", () => {
  composition = true;
});
root.addEventListener("compositionend", () => {
  composition = false;
});
root.addEventListener("keydown", (e) => {
  const dialog = root.querySelector<HTMLDialogElement>("#modal");
  if (dialog?.open && (e.target as HTMLElement).id === 'form-name' && e.key === 'Enter' &&
      (view.modal === 'new-folder' || view.modal === 'file-transfer' && view.data.transfer === 'rename')) {
    e.preventDefault();
    const action = view.modal === 'new-folder' ? 'confirm-folder' : 'confirm-transfer';
    const button = dialog.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
    const intent = button && actionIntent(button);
    if (button && canSubmitName({ modal: view.modal, transfer: view.data.transfer, targetId: 'form-name', key: e.key, keyCode: e.keyCode,
      composing: composition, isComposing: e.isComposing, name: view.formName, enabled: !button.disabled,
      busy: button.getAttribute('aria-busy') === 'true', blocked: !!intent && !!actions.conflict(intent), overwrite: view.formOverwrite })) button.click();
    return;
  }
  const launcher=(e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if(!dialog?.open && launcher && overlayRole(launcher.dataset.action || '')==='menu' && ['ArrowDown','ArrowUp'].includes(e.key)) {
    e.preventDefault();launcher.click();if(e.key==='ArrowUp')root.querySelector<HTMLElement>('#modal [role=menuitem]:last-child')?.focus();return;
  }
  if (e.isComposing || composition) { if(e.key==='Enter')e.preventDefault();return; }
  if(dialog?.open && (anchoredOverlay(view.modal) || !nonmodalDialog() || dialog.contains(e.target as Node)) && e.key==='Escape') {e.preventDefault();e.stopPropagation();closeModal();return;}
  if(dialog?.open && overlayRole(view.modal)==='menu' && dialog.contains(e.target as Node)) {
    const options=[...dialog.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])')];
    const index=options.indexOf(document.activeElement as HTMLElement),next=menuDestination(e.key,index,options.length);
    if(next>=0){e.preventDefault();options[next]?.focus();return;}
    if(e.key==='Tab'){const trigger=root.querySelector<HTMLElement>(overlayAnchor);dismissAnchoredOverlay();trigger?.focus({preventScroll:true});return;}
    if(e.key.length===1 && !e.ctrlKey && !e.metaKey && !e.altKey){const ordered=[...options.slice(index+1),...options.slice(0,index+1)];const found=ordered.find(node=>node.textContent?.trim().toLowerCase().startsWith(e.key.toLowerCase()));if(found){e.preventDefault();found.focus();return;}}
  }
  if(dialog?.open && (e.target as HTMLElement).getAttribute('role')==='option' && e.key.length===1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key!==' ') {
    const options=[...dialog.querySelectorAll<HTMLElement>('[role=option]:not([disabled])')],index=options.indexOf(document.activeElement as HTMLElement);
    const match=[...options.slice(index+1),...options.slice(0,index+1)].find(node=>node.textContent?.trim().toLowerCase().startsWith(e.key.toLowerCase()));if(match){e.preventDefault();match.focus();return;}
  }
  if(dialog?.open && ['chat-response-settings','service-picker','sessions'].includes(view.modal) && (e.target as HTMLElement).getAttribute('role')==='option' && ['ArrowDown','ArrowUp','Home','End'].includes(e.key)) {
    const options=[...dialog.querySelectorAll<HTMLElement>('[role=option]:not([disabled])')];
    if(options.length){e.preventDefault();const index=options.indexOf(document.activeElement as HTMLElement);options[e.key==='Home'?0:e.key==='End'?options.length-1:(index+(e.key==='ArrowDown'?1:-1)+options.length)%options.length]?.focus();}return;
  }
  const work=current(),draft=work?view.drafts[draftKey(work)] || '':'';
  const choices=work?commandChoices(work,draft):[];
  if((!dialog?.open || nonmodalDialog()) && (e.target as HTMLElement).id==='composer' && !e.isComposing && !composition && choices.length){
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();view.commandIndex=(view.commandIndex+(e.key==='ArrowDown'?1:-1)+choices.length)%choices.length;render();return;}
    if((e.key==='Enter'&&!e.shiftKey)||(e.key==='Tab'&&!e.shiftKey)){e.preventDefault();fillCommand(choices[view.commandIndex]!.command);return;}
    if(e.key==='Escape'){e.preventDefault();view.commandDismissed=draft;render();return;}
  }
  if ((!dialog?.open || nonmodalDialog()) && e.key === 'Escape' && !e.isComposing && !composition) {
    if (root.querySelector('.command-palette')) { e.preventDefault(); view.commandDismissed=draft; render(); return; }
    if (document.fullscreenElement) return;
    if (view.layout === 'chat-only') { e.preventDefault(); restoreChatLayout(); return; }
    if (view.layout === 'service-chat' && innerWidth < 900) { e.preventDefault(); view.layout='service-only';render();restoreLayoutFocus();return; }
    if (view.layout !== 'workspace') { e.preventDefault();void exitWorkspaceFocus();return; }
  }
  if (e.key === "Tab" && dialog?.open && !nonmodalDialog()) {
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],summary,[tabindex]:not([tabindex="-1"])',
      ),
    ).filter((node) => node.offsetParent !== null && !node.hidden);
    const first = focusable[0],
      last = focusable.at(-1);
    if (
      e.shiftKey &&
      (document.activeElement === first ||
        !dialog.contains(document.activeElement))
    ) {
      e.preventDefault();
      last?.focus();
      return;
    }
    if (
      !e.shiftKey &&
      (document.activeElement === last ||
        !dialog.contains(document.activeElement))
    ) {
      e.preventDefault();
      first?.focus();
      return;
    }
  }
  if (
    (e.target as HTMLElement).id === "composer" &&
    e.key === "Enter" &&
    !e.shiftKey &&
    !e.isComposing &&
    !composition
  ) {
    e.preventDefault();
    const button = root.querySelector<HTMLButtonElement>(
      '[data-action="send-message"]',
    );
    if (button && !button.disabled) button.click();
  }
});
function handleRouteNavigation() {
  if (new URLSearchParams(location.hash.slice(1)).has('ticket')) {
    // A reopen link can navigate an existing tab without a document reload.
    // Use the same Cookie-first initialization and remove the ticket at once.
    void adapter.initialize().then(() => loadRoute()).catch(error => toast(error.message));
    return;
  }
  if ((dirty() || view.configDirty) && location.hash !== lastRoute) {
    const destination = location.hash;
    history.replaceState(null, "", lastRoute || "#/works");
    guard(() => {
      view.file = "";
      view.configDirty = false;
      view.config = null;
      location.hash = destination;
    });
    return;
  }
  if (lastRoute === location.hash) return;
  lastRoute = location.hash; view.modal = ""; modalChoice++;
  void loadRoute().catch(error => toast(error.message));
  render();
}
window.addEventListener("hashchange", handleRouteNavigation);
window.addEventListener("pagehide", () => { actions.clear(); adapter.stopDownloadObservers(); adapter.stopRunObservers(); adapter.abandonInspectionOnUnload(); });
window.addEventListener("beforeunload", (e) => {
  if (dirty() || view.configDirty || hasUnsentDrafts({ texts: Object.values(view.drafts), imageGroups: imageDrafts.groups(), pending: pendingImageSubmissions.values() })) {
    e.preventDefault();
    e.returnValue = "";
  }
});
let lastIdentity = adapter.identityEpoch;
const runtimeAvailability = new Map<string, boolean>();
async function restoreRuntimePanel(work: Work) {
  const epoch = adapter.identityEpoch, origin = location.hash, tab = view.tab, path = view.path;
  await adapter.refreshCapabilities(work.id);
  if (epoch !== adapter.identityEpoch || origin !== location.hash || tab !== view.tab) return;
  const service = activeService(work);
  if (service) {
    view.service = service.id;
    if (route()[0] !== 'app') view.port = service.ports.includes(view.port) ? view.port : service.ports[0] || 0;
    if (service.observed === 'Ready' && view.port && (tab === 'Services' || route()[0] === 'app')) await adapter.ensureServiceEntry(work.id, service.id, view.port).catch(() => undefined);
  }
  if (tab === 'Files' && path === view.path) await adapter.loadDirectory(work.id, path).catch(() => undefined);
  if (epoch === adapter.identityEpoch && origin === location.hash) render();
}
adapter.subscribe(() => { exportFlows.update(); if (lastIdentity !== adapter.identityEpoch) { lastIdentity = adapter.identityEpoch; actions.clear(); createDraft.clear(); resetCreateFields(); unknownFiles.clear(); fileAttempt = undefined; modalTransfers = []; uploadPickerTarget = undefined; pendingUploadTarget = undefined; pendingUploadFiles = []; sourceGuardReturn = undefined; pendingNav = null; workControls.clear(); serviceControls.clear(); importStarts.clear(); workSelections.clear(); selectionWorkId = ''; fileChoice++; filesRestoreNotice = ''; workReadErrors.clear(); view.serviceOpenError = "";
    view.file = ""; view.fileDraft = ""; view.fileOriginal = ""; view.fileBaseline = ""; view.fileReread = null;
    view.config = null; view.configDirty = false; view.drafts = {};textDraftRevisions.clear();imageDrafts.clear();pendingImageSubmissions.clear();imageDraftErrors.clear();resetWorkspaceFocus();workspacePanels.clear();chatReading.clear();expandedActivity.clear();pendingWebCommand=undefined; fileSelections.clear(); runtimeAvailability.clear();
    if (!(view.modal === "import" && adapter.inspection)) { view.modal = ""; view.modalError = ""; } }
  const work = current();
  const restore = work && runtimeAvailability.get(work.id) === false && adapter.project(work).usable;
  for (const item of adapter.state.works) runtimeAvailability.set(item.id, adapter.project(item).usable);
  if (restore && work) queueMicrotask(() => { void restoreRuntimePanel(work).catch(() => undefined); });
  advanceImportStarts(); confirmPendingChatCommand();render(); });
lastRoute = location.hash;
render();
void adapter.initialize().then(async () => { view.coreAddress = adapter.state.core.address; if (adapter.state.browserAccess === 'authorized') void adapter.loadPreferences(); await loadRoute(); }).catch(error => toast(error.message));

let packageFiles: File[] = [];
let pendingUploadFiles: File[] = [];
function downloadURL(url: string, workName = '') { const link = document.createElement('a'); link.href = url; link.download = ''; link.click(); toast(`${workName ? workName + ' · ' : ''}Download started. Check your browser to confirm it was saved.`); }
let routeLoad = 0;
const workReadErrors = new Map<string, { message: string; missing: boolean }>();
async function loadRoute() {
  if (!adapter.state.signedIn) return;
  const version = ++routeLoad, r = route(), origin = location.hash, epoch = adapter.identityEpoch;
  const valid = () => version === routeLoad && origin === location.hash && epoch === adapter.identityEpoch;
  if (!['work','app'].includes(r[0]) || r[2] === 'settings' || workspaceReturn && workspaceReturn.workId !== r[1]) {
    if (!await exitWorkspaceFocus() || !valid()) return;
  }
  const entering = selectionWorkId !== r[1] || !['work', 'app'].includes(r[0]);
  if (!['work', 'app'].includes(r[0]) || !r[1]) { selectionWorkId = ''; render(); await adapter.listWorks().catch(() => undefined); return; }
  const previous = restoreSelection(workSelections.get(r[1]));
  if (entering) {
    selectionWorkId = r[1]; fileChoice++; filesRestoreNotice = '';
    view.tab = previous.area; view.path = previous.path; view.file = ''; view.selected = [];
    view.service = previous.service; view.port = previous.port; view.session = previous.session; view.noteLoaded = '';
  }
  const choices = { area: areaChoice, service: serviceChoice, session: sessionChoice, file: fileChoice };
  const record = actions.begin({ key: `route:${r[1]}:${version}`, kind: 'read', work: r[1], label: 'Loading Work', target: r[1], view: location.hash });
  render();
  try {
    const work = await adapter.loadWork(r[1], r[0] !== 'app'); if (!valid()) return; workReadErrors.delete(r[1]);
    const serviceId = r[0] === 'app' ? r[2] : view.service;
    const port = r[0] === 'app' ? Number(r[3]) : view.port;
    const service = work.services.find(s => s.id === serviceId) ?? work.services.find(s => s.enabled && s.observed === 'Ready' && s.ports.length);
    if (choices.service === serviceChoice) {
      view.service = r[0] === 'app' ? r[2] : service?.id ?? '';
      view.port = r[0] === 'app' ? port : service?.ports.includes(port) ? port : service?.ports[0] ?? 0;
    }
    if (choices.session === sessionChoice) view.session = work.sessions.find(s => s.id === view.session)?.id ?? work.sessions[0]?.id ?? '';
    if (view.session && r[0] !== 'app') await adapter.loadSession(work.id, view.session);
    if (!valid()) return;
    if (r[2] === 'settings' && !view.configDirty) view.config = structuredClone(work.config);
    if (entering && r[0] !== 'app' && r[2] !== 'settings' && choices.area === areaChoice && choices.file === fileChoice && view.tab === 'Files' && adapter.project(work).usable)
      await restoreFiles(work, previous, valid);
    if (!valid()) return;
    const selectedService = activeService(work);
    if ((view.tab === 'Services' || r[0] === 'app') && selectedService?.observed === 'Ready' && view.port)
      await adapter.ensureServiceEntry(work.id, selectedService.id, view.port).catch(error => { if (valid()) toast(error.message); });
    if (valid()) render();
  } catch (error) {
    if (valid() && record && actions.current(record)) { actions.fail(record, error); workReadErrors.set(r[1], { message: error instanceof Error ? error.message : String(error), missing: error instanceof DesktopError && error.httpStatus === 404 }); }
  } finally { if (record) { actions.finish(record); actions.records.delete(record.key); render(); } }
}
window.addEventListener('popstate', handleRouteNavigation);

/** Update existing nodes in place. In particular, never detach an unchanged Service iframe or its ancestors. */
function reconcileHTML(parent: Element, html: string) {
  const template = document.createElement('template'); template.innerHTML = html;
  const key = (node: Node): string => {
    if(!(node instanceof Element))return node.nodeType===Node.TEXT_NODE?'#text':'#other';
    if(node.hasAttribute('data-message-key'))return `message:${node.getAttribute('data-message-key')}`;
    if(node.hasAttribute('data-service-key'))return `frame:${node.getAttribute('data-service-key')}`;
    if(node.id)return `id:${node.id}`;
    // Removing Cancel must not turn the original Check status node into Close.
    if(node.matches('button[data-action]'))return `action:${['action','id','path','run-id','cancel-run-id','run','session','index','tab','control','kind','option-value','command','copy'].map(name=>node.getAttribute(`data-${name}`) ?? '').join(':')}`;
    return `${node.tagName}:${node.getAttribute('class')?.split(' ')[0] ?? ''}`;
  };
  const patch = (target: Node, incoming: Node) => {
    if (target instanceof Element && incoming instanceof Element) {
      if (target instanceof HTMLIFrameElement) return;
      for (const attr of Array.from(target.attributes)) if (!incoming.hasAttribute(attr.name) && !((target instanceof HTMLDialogElement || target instanceof HTMLDetailsElement) && attr.name === 'open') && attr.name !== 'data-observed' && attr.name !== 'data-bound' && attr.name !== 'data-scroll-bound') target.removeAttribute(attr.name);
      for (const attr of Array.from(incoming.attributes)) if (target.getAttribute(attr.name) !== attr.value) target.setAttribute(attr.name, attr.value);
      const isFile = target instanceof HTMLInputElement && target.type === 'file';
      if (target instanceof HTMLInputElement && incoming instanceof HTMLInputElement && !isFile) { if (document.activeElement !== target && target.type !== 'password') target.value = incoming.value; target.checked = incoming.checked; target.disabled = incoming.disabled; }
      if (target instanceof HTMLTextAreaElement && incoming instanceof HTMLTextAreaElement) { if (document.activeElement !== target) target.value = incoming.value; return; }
      children(target, incoming);
      if (target instanceof HTMLSelectElement && incoming instanceof HTMLSelectElement && document.activeElement !== target) target.value = incoming.value;
    } else if (target.nodeValue !== incoming.nodeValue) target.nodeValue = incoming.nodeValue;
  };
  const children = (target: Node, incoming: Node) => {
    let cursor = target.firstChild; const used = new Set<Node>();
    const desired = Array.from(incoming.childNodes);
    for (const [index, child] of desired.entries()) {
      // Remove obsolete notices before matching the next node. Moving a stable
      // ancestor ahead of a disappearing notice unloads its iframe document.
      if (cursor && key(cursor) !== key(child)) {
        const remaining = new Set(desired.slice(index).map(key));
        while (cursor && !remaining.has(key(cursor))) {
          const next: ChildNode | null = cursor.nextSibling; target.removeChild(cursor); cursor = next;
        }
      }
      if (cursor && key(cursor) === key(child)) { const next = cursor.nextSibling; used.add(cursor); patch(cursor, child); cursor = next; }
      else { const match = Array.from(target.childNodes).find(node => node !== cursor && !used.has(node) && key(node) === key(child));
        if (match) { used.add(match); target.insertBefore(match, cursor); patch(match, child); } else { const inserted = child.cloneNode(true); used.add(inserted); target.insertBefore(inserted, cursor); } }
    }
    while (cursor) { const next = cursor.nextSibling; target.removeChild(cursor); cursor = next; }
  };
  children(parent, template.content);
}

function skillState(work: Work, name: string, field: string) { const runtime = work.config.runtime?.skills?.find((s: {name: string}) => s.name === name); const value = runtime?.[field]; return value === undefined ? "Not provided" : field === "loaded" ? value ? "Loaded" : "Not loaded" : value ? "Visible to model" : "Not visible to model"; }
function brainBehavior(adoption?: string): string {
  return adoption === "verified" ? "Behavior verified" : adoption === "failed" ? "Behavior checks failed" : adoption === "not-confirmed" ? "Behavior not confirmed" : "Behavior observation unavailable";
}
function packageStatus(work: Work, name: string) { const p = work.packageEntries?.find(p => p.name === name); return p ? `${p.pendingApply ? "Saved · Not applied" : "Saved"} · ${p.runtime?.loaded === true ? "Loaded" : p.runtime?.loaded === false ? "Not loaded" : "Loading unconfirmed"}${p.candidate ? ` · Work files candidate: ${p.candidate.preparation} · ${brainBehavior(p.candidate.adoption)}${p.candidate.apply?.state === "failed" ? " · Apply failed" : ""}` : ""}` : "Saved selection · Runtime not provided"; }

function brainCandidateDetails(entry?: Record<string, any>): string {
  const candidate = entry?.candidate;
  if (!candidate) return "<p>No candidate details available.</p>";
  const baseline = candidate.baseline, verification = candidate.verification, apply = candidate.apply;
  const selection = (enabled: unknown, matches: unknown) => typeof enabled !== "boolean" || typeof matches !== "boolean" ? "Baseline observation unavailable" : `${enabled ? "Enabled" : "Disabled"} at acceptance · ${matches ? "Still matches" : "Changed since acceptance"}`;
  const operation = (id: string, label: string) => btn(esc(label), "operation", "inline-link", `data-id="${esc(id)}"`);
  const applyKnown = apply?.availability === "available" && apply.operationId && apply.state;
  const applyState = applyKnown ? `${apply.state === "failed" ? "Apply failed" : `Apply ${apply.state}`} · ${operation(apply.operationId, apply.operationId)}` : apply?.availability === "not-applied" ? "No matching Apply" : "Apply observation unavailable";
  const preparation = candidate.preparation === "succeeded" ? "Published" : ["failed", "superseded", "cleanup-pending"].includes(candidate.preparation) ? candidate.preparation : "Preparing";
  return `<h3>Candidate from ${esc(candidate.source)}</h3><dl><dt>Active selection at acceptance</dt><dd>${esc(selection(baseline?.activeSelected, baseline?.activeMatchesCurrent))}</dd><dt>Saved selection at acceptance</dt><dd>${esc(selection(baseline?.desiredSelected, baseline?.desiredMatchesCurrent))}</dd><dt>Fixed verification goal</dt><dd>${esc(verification?.goal ?? "Verification observation unavailable")}</dd><dt>Capability</dt><dd>${esc(verification?.toolName ?? "Unavailable")}</dd><dt>Input summary</dt><dd><pre>${esc(verification?.inputSummary ?? "Unavailable")}</pre></dd><dt>Required checks</dt><dd>${Array.isArray(verification?.checkNames) ? verification.checkNames.map((name: string) => `<div>${esc(name)}</div>`).join("") : "Unavailable"}</dd><dt>Preparation / publication</dt><dd>${esc(preparation)} · ${operation(candidate.operationId, "Preparation operation")}</dd><dt>Candidate saved</dt><dd>${candidate.desired ? "Yes" : "No"}</dd><dt>Candidate active</dt><dd>${candidate.active ? "Yes" : "No"}</dd><dt>Loaded</dt><dd>${entry?.runtime?.availability !== "available" ? "Loading observation unavailable" : entry.runtime.loaded === true ? "Yes" : entry.runtime.loaded === false ? "No" : "Loading unconfirmed"}</dd><dt>Original Apply</dt><dd>${applyState}</dd><dt>SDK behavior</dt><dd>${esc(brainBehavior(candidate.adoption))}</dd></dl>${apply?.error ? feedback(`${esc(apply.error.code)}: ${esc(apply.error.message)}`, "warning") : ""}${btn("Original request", "pi-request-detail", "small", `data-id="${esc(candidate.requestId)}"`)}`;
}

function prepareSelectedEntry() {
  const work = current();
  if (!work || !adapter.state.signedIn || !adapter.project(work).usable || work.resourceErrors?.services) return;
  if (route()[0] !== 'app' && (route()[2] === 'settings' || view.tab !== 'Services')) return;
  const service = route()[0] === 'app' ? work.services.find(item => item.id === route()[2]) : activeService(work);
  if (!service || service.observed !== 'Ready' || !service.enabled || !service.ports.includes(view.port)) return;
  if (adapter.serviceEntryUrl(work.id, service.id, view.port) || adapter.serviceEntryError(work.id, service.id, view.port) || adapter.serviceEntryPending(work.id, service.id, view.port)) return;
  void adapter.ensureServiceEntry(work.id, service.id, view.port).catch(() => undefined);
}

// Observe only confirmed Work/Service facts; preserve the current Session, form drafts and application DOM.
let statusRefreshRunning = false;
setInterval(() => {
  const work = current();
  if (!work || !adapter.state.signedIn || document.visibilityState !== 'visible' || statusRefreshRunning) return;
  statusRefreshRunning = true;
  void adapter.refreshVisibleWork(work.id).catch(() => undefined).finally(() => { statusRefreshRunning = false; });
}, 5000);

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && adapter.state.signedIn && route()[0] === 'works') void adapter.listWorks().catch(() => undefined); exportFlows.setVisible(document.visibilityState === 'visible'); observeCurrentPage(); });
window.addEventListener('pagehide', () => { exportFlows.revoke('This page ended. Find the original snapshot to download explicitly.'); adapter.observePage('', false); });

function consumeWebSelection(kind:string) {if(pendingWebCommand?.kind===kind){if(view.drafts[pendingWebCommand.key]===pendingWebCommand.text)view.drafts[pendingWebCommand.key]='';pendingWebCommand=undefined;}}
root.addEventListener('toggle',event=>{const target=event.target;if(target instanceof HTMLDetailsElement && target.dataset.activityKey)expandedActivity.set(target.dataset.activityKey,target.open);},true);
document.addEventListener('fullscreenchange',()=>render());

function composerCaret(event:Event){const input=event.target;if(input instanceof HTMLTextAreaElement && input.id==='composer' && !composition){const position=input.selectionStart ?? 0;if(position!==view.commandCaret){view.commandCaret=position;render();}}}
root.addEventListener('click',composerCaret);
root.addEventListener('keyup',composerCaret);

root.addEventListener('paste',event=>{if(!(event.target as HTMLElement).closest('#composer'))return;const files=[...(event.clipboardData?.items ?? [])].filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter((file):file is File=>!!file);if(!files.length)return;if(!event.clipboardData?.getData('text/plain'))event.preventDefault();void addChatImages(files);});
root.addEventListener('dragover',event=>{if((event.target as HTMLElement).closest('.composer') && event.dataTransfer?.types.includes('Files'))event.preventDefault();});
root.addEventListener('drop',event=>{if(!(event.target as HTMLElement).closest('.composer'))return;const files=[...(event.dataTransfer?.files ?? [])];if(files.length){event.preventDefault();void addChatImages(files);}});
root.addEventListener('change',event=>{const input=event.target as HTMLInputElement;if(input.id==='chat-image-input'){const files=[...(input.files ?? [])];input.value='';void addChatImages(files);}});
window.addEventListener('pagehide',()=>{imageDrafts.clear();adapter.stopImageReads();imageObserver.disconnect();});

function productInfoMarkup(label:string,info:Record<string,any>|null,loading:boolean,error:string) {
 const build=info?.build,notes=info?.releaseNotes;
 return `<section class="product-info"><h3>${esc(label)}</h3>${loading?'<p role="status">Loading version…</p>':''}${error?feedback(esc(error),'warning'):''}${build?`<dl><dt>Version</dt><dd>${esc(build.version)}</dd><dt>Build</dt><dd><code>${esc(build.commit)}</code>${build.modified?' · Modified':''}</dd><dt>Platform</dt><dd>${esc(build.os)} / ${esc(build.architecture)}</dd></dl><details><summary>Release notes</summary>${notes?`<h4>${esc(notes.title)} · ${esc(notes.version)}</h4>${notes.publishedAt?`<p>${esc(notes.publishedAt)}</p>`:''}${(notes.sections ?? []).map((section:any)=>`<h4>${esc(section.title)}</h4><ul>${section.items.map((item:string)=>`<li>${esc(item)}</li>`).join('')}</ul>`).join('')}`:'<p>Release notes are not available for this build.</p>'}</details>`:''}<p><a href="https://github.com/pphboy/piwork/releases" target="_blank" rel="noopener noreferrer">All releases</a></p></section>`;
}

window.addEventListener('hashchange',()=>adapter.stopImageReads());

function consumeImageSubmission(workId:string,submitted:ImageSubmission) {
 if(submitted.epoch!==adapter.identityEpoch)return;
 for(const key of new Set([submitted.key,submitted.destinationKey])){
  imageDrafts.consume(key,submitted.images);
  if((textDraftRevisions.get(key) || 0)===submitted.textRevision && view.drafts[key]===submitted.text)view.drafts[key]='';
  if(imageDraftErrors.get(key)===submitted.error)imageDraftErrors.delete(key);
 }
 if(pendingImageSubmissions.get(workId)===submitted)pendingImageSubmissions.delete(workId);
 render();
}
