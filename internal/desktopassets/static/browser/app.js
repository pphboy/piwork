import { createLanguagePicker } from './i18n.js';
import { pendingDots } from './pending.js';
import { renderChatMarkdown } from './chat-markdown.js';
import { overlayRole, anchoredOverlay, overlayPlacement, menuDestination, overlayForAction } from './overlay-role.js';
import { WorkspacePanelsStore, splitGeometry, keyboardSplit, executionAnchors } from './workspace-layout.js';
import { workCompletionReady, serviceCompletionReady, importCanStart } from './completion-exits.js';
import { restoreSelection, initialWorkArea, unavailableServicesReason, parentDirectory, missingFileTarget } from './work-navigation.js';
import { renameField, validLocalName, canSubmitName, canDismissLightModal, pointOutsideDialog, canCancelPiRequest, modalActionRelevant } from './control-rules.js';
import { NewWorkDraftRevision, hasUnsentDrafts, createSubmissionBlocked } from './draft-revision.js';
import { FileMutationResults, UnknownFileLocks, uploadReview } from './file-results.js';
import { exportWorkConflict, exportSnapshotAvailable } from './export-admission.js';
import { ExportFlows } from './export-flow.js';
import { activityGroups } from './chat-projection.js';
import { ImageDrafts } from './images.js';
import { editAdvanced, synchronizeConfiguration } from './configuration.js';
import { ActionState, renderActionStates } from './action-state.js';
import { adapter, DesktopError, fileVersion } from "./adapter.js";
import { filesDeepLink, filesRouteTarget, isFilesRoute } from "./file-reference.js";
import { t, stateText, onLocaleChange, chooseLocale, languageChoices, applyDocumentTitle, formatTime, formatDateTime, formatNumber } from './locale.js';
const root = document.querySelector("#app");
onLocaleChange(render);
const pendingAges = new WeakMap();
let pendingNoticeTimer;
const imageDrafts = new ImageDrafts(() => render());
const imageDraftErrors = new Map();
const textDraftRevisions = new Map();
let imageSelection = 0;
const pendingImageSubmissions = new Map();
const imageObserver = new IntersectionObserver(entries => { for (const entry of entries)
    if (entry.isIntersecting) {
        const el = entry.target;
        imageObserver.unobserve(el);
        const w = adapter.getWork(el.dataset.work), session = w?.sessions.find(s => s.id === el.dataset.session), image = session?.messages.find(m => m.runId === el.dataset.run && m.images?.some(i => i.imageIndex === Number(el.dataset.index)))?.images?.find(i => i.imageIndex === Number(el.dataset.index));
        if (w && session && image)
            adapter.loadHistoryImage(w.id, session.id, el.dataset.run, image);
    } });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const icon = (name, size = 18) => {
    const paths = {
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
        spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
        grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
        folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
        chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z"/>',
        settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
        external: '<path d="M14 3h7v7M10 14 21 3M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
        copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
        refresh: '<path d="M21 3v6h-6M3 21v-6h6M20 9A8 8 0 0 0 6 5L3 9m18 6-3 4A8 8 0 0 1 4 15"/>',
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
        globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
    };
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.grid}</svg>`;
};
const btn = (label, action, cls = "", extra = "") => `<button class="button ${cls}" data-action="${action}" ${extra}>${label}</button>`;
const languageName = () => languageChoices().find(choice => choice.selected)?.label || '';
const languageTrigger = (cls = 'account-button quiet', key = 'topbar') => btn(`${icon('globe', 16)}<span>${t('lang.menu')}</span>${icon('down', 12)}`, 'language', `${cls} language-trigger`, `data-language-trigger="${key}" aria-label="${esc(t('lang.triggerAria', { language: languageName() }))}" aria-haspopup="listbox" aria-expanded="${typeof languagePicker !== 'undefined' && languagePicker.isOpen}"`);
const languageMenuItems = () => `<div class="menu-list language-menu">${btn(`${icon('globe', 16)}<span>${t('lang.menu')}</span><span class="language-current">${esc(languageName())}</span>${icon('chevron', 14)}`, 'language', 'language-trigger', 'role="menuitem" tabindex="-1" data-language-trigger="menu" aria-haspopup="listbox" aria-expanded="false"')}</div>`;
const workLink = (label, id, cls = '') => `<a class="button ${cls}" data-action="open-work" data-id="${esc(id)}" href="#/work/${encodeURIComponent(id)}">${label}</a>`;
const badge = (status) => `<span class="status ${status.toLowerCase().replaceAll(" ", "-")}"><i></i>${esc(stateText(status))}</span>`;
const feedback = (text, tone = "info", action = "") => `<div class="feedback ${tone}" role="status">${icon(tone === "success" ? "check" : "info")}<div>${text}</div>${action}</div>`;
const empty = (symbol, title, body, action = "") => `<div class="empty">${icon(symbol, 32)}<h2>${title}</h2><p>${body}</p>${action}</div>`;
const pendingStatus = (label, ownedActions = '') => `<span class="pending-status" role="status" aria-busy="true" data-pending-label="${esc(label)}" ${ownedActions ? `data-pending-action="${ownedActions}"` : ''}>${pendingDots()}<span>${esc(label)}</span></span>`;
const operationBusy = (op) => !!op && ['accepted', 'pending', 'preparing', 'running'].includes(op.state) && !op.error && !op.observationError && !adapter.operationPaused(op.id);
const readPlaceholder = (label, shape = "rows") => `<div class="read-placeholder read-placeholder-${esc(shape)}" role="status" aria-label="${esc(label)}" aria-busy="true">${pendingStatus(label)}<div class="read-placeholder-line" aria-hidden="true"></div><div class="read-placeholder-line" aria-hidden="true"></div><div class="read-placeholder-line" aria-hidden="true"></div></div>`;
const readFailure = (label, error, action, busy = false) => `<div class="feedback warning read-failure"><div><span>${esc(label)}</span><details><summary>${t('common.details')}</summary><p>${esc(error)}</p></details></div>${btn(busy ? pendingDots() : icon('refresh', 16), action, `icon-button quiet ${busy ? 'is-reading' : ''}`, `aria-label="${busy ? esc(t('readFailure.retryingAria', { label: label.toLowerCase() })) : esc(t('readFailure.retryAria', { label: label.toLowerCase() }))}" title="${busy ? esc(t('common.retrying')) : esc(t('common.retry'))}" ${busy ? 'disabled aria-busy="true" data-read-busy="true"' : ''}`)}</div>`;
let view = {
    search: "",
    deleteConfirmed: false,
    modal: "",
    data: {},
    tab: "Services",
    service: "",
    port: 3000,
    session: "",
    drafts: {},
    includeIdentity: false,
    path: "/",
    file: "",
    fileDraft: "",
    fileOriginal: "",
    fileBaseline: "",
    fileEditable: false,
    fileReread: null,
    fileUnprotected: false,
    fileWriteUncertain: false,
    fileStatus: "idle",
    fileError: "",
    selected: [],
    settingsTab: "Skills",
    config: null,
    configDirty: false,
    agentOpen: false,
    note: "note-1",
    noteTitle: "",
    noteBody: "",
    noteLoaded: "",
    toast: "",
    modalError: "",
    modalNameError: null,
    createName: "",
    createAdvanced: false,
    createImage: "",
    createSkillMode: "defaults",
    createPackageMode: "defaults",
    createSkills: [],
    createPackages: [],
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
    layout: 'workspace',
    literalSlash: false,
    commandIndex: 0,
    commandDismissed: '',
    commandRevision: '',
    commandCaret: 0,
    fullscreenError: '',
};
const languagePicker = createLanguagePicker({ choices: languageChoices, label: () => t('lang.menu'), onChoose: chooseLocale });
const workspacePanels = new WorkspacePanelsStore();
const expandedActivity = new Map();
let workspaceReturn, chatReturn;
const chatReading = new Map();
let pendingWebCommand;
let importSignInSuspended = false;
const actions = new ActionState(() => render());
let latestCreateToken = 0;
const createDraft = new NewWorkDraftRevision();
const unknownFiles = new UnknownFileLocks();
let fileAttempt;
let modalTransfers = [];
let uploadPickerTarget;
let pendingUploadTarget;
function resetCreateFields() {
    view.createName = '';
    view.createAdvanced = false;
    view.createImage = '';
    view.createSkillMode = 'defaults';
    view.createPackageMode = 'defaults';
    view.createSkills = [];
    view.createPackages = [];
    view.createAgents = '';
    view.createJson = '';
}
const workControls = new Map();
const serviceControls = new Map();
const importStarts = new Map();
function controlReady(control, w) {
    return !!control?.operationId && workCompletionReady(adapter.getOperation(control.operationId), w.id, adapter.project(w).usable);
}
const controlActionKeys = {
    'Start Work': 'action.startWork', 'Retry Work': 'action.retryWork', // i18n-exempt: internal control identifiers, rendered through controlActionText
    'start Service': 'action.startService', 'restart Service': 'action.restartService',
    'retry Service': 'action.retryService', 'stop Service': 'action.stopService', 'remove Service': 'action.removeService',
};
/** Presentation only: internal control identifiers stay unchanged for comparisons. */
const controlActionText = (action) => controlActionKeys[action] ? t(controlActionKeys[action]) : action;
function controlMarkup(control) {
    if (!control)
        return '';
    const op = control.operationId ? adapter.getOperation(control.operationId) : undefined;
    const state = op?.state || control.phase;
    const busy = operationBusy(op);
    const label = state === 'pending' ? t('control.submitting') : state === 'accepted' ? t('control.acceptedWaiting') : state === 'unknown' ? t('control.resultUnknown') : state === 'reviewed' ? t('control.outcomeUnknown') : stateText(state);
    const action = controlActionText(control.action);
    return `<div class="object-control-progress" role="status" aria-busy="${busy}"><span>${busy ? pendingStatus(`${action} · ${label}`) : `${esc(action)} · ${esc(label)}`}</span>${control.error || op?.error || op?.observationError ? `<small>${esc(control.error || op?.error || op?.observationError)}</small>` : ''}<div class="actions">${control.operationId ? btn(t('control.operationDetails'), 'operation', 'text-button small', `data-id="${esc(control.operationId)}"`) : ''}${btn(t('control.checkProgress'), control.serviceId ? 'check-service-progress' : 'check-work-progress', 'text-button small', `data-id="${esc(control.workId)}"${control.serviceId ? ` data-service-id="${esc(control.serviceId)}"` : ''}`)}</div></div>`;
}
function workRowControl(work, control) {
    const op = control?.operationId && adapter.getOperation(control.operationId);
    if (op && ['succeeded', 'failed', 'superseded'].includes(op.state) && !op.observationError && !work.statusError && (adapter.project(work).usable || work.status === 'Failed' || work.status === 'Stopped' && work.desired === 'stopped'))
        return '';
    return controlMarkup(control);
}
async function submitWorkStart(w, record, imported) {
    const old = workControls.get(w.id), permitted = adapter.project(w).action;
    if (!['start', 'retry'].includes(permitted) || old && ['pending', 'unknown'].includes(old.phase))
        throw new Error(t('action.checkWorkControl'));
    const control = { workId: w.id, action: permitted === 'retry' ? 'Retry Work' : 'Start Work', phase: 'pending' }; // i18n-exempt: internal control identifier
    const epoch = adapter.identityEpoch;
    workControls.set(w.id, control);
    render();
    try {
        const op = await adapter.lifecycle(w.id, permitted);
        if (epoch !== adapter.identityEpoch)
            throw new ViewChanged();
        control.operationId = op.id;
        control.phase = 'accepted';
        if (imported) {
            imported.startId = op.id;
            imported.phase = 'accepted';
        }
        if (record) {
            record.businessId = op.id;
            actions.confirm(record, t('action.accepted', { id: op.id }));
        }
        void adapter.loadWork(w.id).catch(() => undefined);
        render();
    }
    catch (error) {
        if (epoch === adapter.identityEpoch) {
            const status = error.httpStatus;
            control.phase = status && status >= 400 && status < 500 ? 'failed' : 'unknown';
            control.error = error instanceof Error ? error.message : String(error);
            if (imported) {
                imported.phase = control.phase;
                imported.error = control.error;
            }
            if (record && control.phase === 'unknown')
                record.blocked = true;
            render();
        }
        throw error;
    }
}
async function submitServiceControl(w, serviceId, action, record) {
    const key = `${w.id}:${serviceId}`, old = serviceControls.get(key), original = old?.operationId && adapter.getOperation(old.operationId);
    if (old && (['pending', 'unknown'].includes(old.phase) || original && !['succeeded', 'failed', 'superseded'].includes(original.state)))
        throw new Error(t('action.checkServiceControl'));
    const epoch = adapter.identityEpoch, origin = location.hash, choice = modalChoice;
    const control = { workId: w.id, serviceId, action: `${action} Service`, phase: 'pending' };
    serviceControls.set(key, control);
    render();
    try {
        const op = await adapter.operateService(w.id, serviceId, action);
        if (epoch !== adapter.identityEpoch)
            throw new ViewChanged();
        control.operationId = op.id;
        control.phase = 'accepted';
        if (record) {
            record.businessId = op.id;
            actions.confirm(record, t('action.accepted', { id: op.id }));
        }
        if (origin === location.hash && choice === modalChoice && current()?.id === w.id)
            openModal('service-details', { serviceId });
        void adapter.loadServices(w.id).catch(() => undefined);
        render();
    }
    catch (error) {
        if (epoch === adapter.identityEpoch) {
            const status = error.httpStatus;
            control.phase = status && status >= 400 && status < 500 ? 'failed' : 'unknown';
            control.error = error instanceof Error ? error.message : String(error);
            if (record && control.phase === 'unknown')
                record.blocked = true;
            render();
        }
        throw error;
    }
}
function advanceImportStarts() {
    for (const intent of importStarts.values()) {
        if (intent.consumed || intent.epoch !== adapter.identityEpoch)
            continue;
        if (intent.origin !== location.hash || intent.choice !== modalChoice || intent.selection !== `${areaChoice}:${serviceChoice}:${sessionChoice}:${fileChoice}`) {
            intent.consumed = true;
            continue;
        }
        const w = adapter.getWork(intent.workId), op = intent.startId && adapter.getOperation(intent.startId);
        if (op && ['failed', 'superseded'].includes(op.state)) {
            intent.consumed = true;
            continue;
        }
        if (w && op && workCompletionReady(op, w.id, adapter.project(w).usable)) {
            intent.consumed = true;
            queueMicrotask(() => {
                if (intent.epoch === adapter.identityEpoch && intent.origin === location.hash && intent.choice === modalChoice)
                    void openWork(w).catch(error => toast(error.message));
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
function openExportFlow(flow, record) { if (record) {
    record.businessId = flow.id;
    actions.confirm(record, t('action.exportIntentRetained'));
} openModal('export', { id: flow.workId, flowId: flow.id, snapshotId: flow.snapshotId || '' }); }
function beginExport(work, stopConfirmed = false, record) {
    const old = exportFlows.forWork(work.id);
    if (old && !old.terminal) {
        if (old.mode !== 'new')
            throw new Error(t('action.downloadActive'));
        openExportFlow(old, record);
        return;
    }
    if (!stopConfirmed && work.desired === 'running') {
        openModal('stop-work', { id: work.id, exportAfterStop: 'true' });
        return;
    }
    openExportFlow(exportFlows.start(work.id, { mode: 'new', stopConfirmed }), record);
}
class ViewChanged extends Error {
}
let sessionChoice = 0, areaChoice = 0, serviceChoice = 0, selectionRequest = 0, modalChoice = 0;
let servicePreparationScheduled = false;
const fileSelections = new Map();
const viewKey = () => `${location.hash}:${view.modal}:${modalChoice}:${view.tab}:${view.path}:${view.service}:${view.port}:${sessionChoice}`;
const actionLabels = {
    'sign-in': 'actions.signIn', 'sign-out': 'actions.signOut', 'confirm-switch-core': 'actions.switchingCore', 'check-connection': 'actions.checkingConnection',
    'retry-works': 'actions.loadingWorks', 'create-work': 'actions.creatingWork', 'start-work': 'actions.startingWork', 'start-import-open': 'actions.startingImportedWork', 'check-work-progress': 'actions.checkingWorkProgress', 'check-service-progress': 'actions.checkingServiceProgress', 'confirm-stop': 'actions.stoppingWork', 'confirm-delete': 'actions.deletingWork',
    'retry-work-read': 'actions.loadingWork', 'open-work': 'actions.loadingWork', 'check-work': 'actions.checkingWork', settings: 'actions.readingSettings', 'tab-Services': 'actions.loadingServices', 'tab-Files': 'actions.readingWorkspace',
    'retry-services': 'actions.readingServices', 'run-details': 'actions.readingRunDetails', 'active-run': 'actions.readingActiveRun', 'check-chat-submission': 'actions.checkingOriginalSubmission',
    'load-models': 'actions.readingModels', 'save-model': 'actions.savingSessionModel', 'check-session-model': 'actions.readingSessionModel', 'service-requests': 'actions.readingAgentRequests', 'check-active-run': 'actions.checkingActiveRun', 'pi-requests': 'actions.readingPiRequests', 'pi-request-detail': 'actions.readingPiRequest', 'cancel-pi-request': 'actions.cancellingPiRequest', 'retry-pi-request': 'actions.retryingPiRequest', 'next-pi-requests': 'actions.readingMorePiRequests', 'next-pi-evidence': 'actions.readingMoreEvidence',
    'load-earlier-history': 'actions.readingEarlierMessages', 'reload-history': 'actions.readingRecentMessages', 'retry-conversation': 'actions.readingConversation', 'sessions': 'actions.readingSessions', 'select-session': 'actions.readingSession', 'new-session': 'actions.creatingSession', 'send-message': 'actions.submittingMessage', 'cancel-run': 'actions.requestingCancellation', 'resume-run': 'actions.reconnectingRun',
    'service-details': 'actions.readingLogs', 'service-action': 'actions.submittingServiceControl', 'confirm-service-control': 'actions.submittingServiceControl', 'refresh-logs': 'actions.readingLogs',
    'open-app': 'actions.openingApplication', 'open-window': 'actions.openingApplication', 'retry-service-entry': 'actions.preparingApplication', 'check-preview': 'actions.checkingPreview',
    'refresh-files': 'actions.readingWorkspace', 'file-path': 'actions.readingDirectory', 'open-file': 'actions.readingFile', 'open-source': 'actions.readingFile', 'retry-file-preview': 'actions.readingFile', 'save-file': 'actions.savingFile', 'dirty-save': 'actions.savingFile',
    'confirm-upload-overwrite': 'actions.uploadingFiles', 'confirm-folder': 'actions.creatingFolder', 'retry-selected-files': 'actions.retryingSelectedPaths', 'confirm-transfer': 'actions.transferringFiles', 'confirm-file-delete': 'actions.deletingFiles',
    'save-config': 'actions.savingSettings', 'dirty-config-save': 'actions.savingSettings', 'refresh-config': 'actions.readingSettings', 'apply-config': 'actions.submittingApply', 'confirm-core-skills': 'actions.copyingSkill', 'check-catalog': 'actions.readingCatalog',
    'confirm-install': 'actions.submittingPackage', 'confirm-remove-package': 'actions.removingPackage', 'confirm-import': 'actions.submittingImport', 'prepare-export': 'actions.preparingExport',
    'export': 'actions.preparingExport', 'view-snapshot': 'actions.checkingSnapshot', 'save-export-file': 'actions.checkingOriginalDownload', 'check-export-flow': 'actions.checkingExport', 'resume-export-flow': 'actions.resumingExport',
    'download-work': 'actions.preparingDownload', 'check-download': 'actions.checkingTransfer', 'check-operation': 'actions.checkingOperation', 'lookup-operation': 'actions.readingOperation', 'lookup-snapshot': 'actions.readingSnapshot',
    'operations': 'actions.readingKnownOperations', 'clear-operations': 'actions.clearingCompletedRecords', 'resume-operation': 'actions.resumingObservation', 'check-inspection-import': 'actions.checkingTransfer', 'retry-inspection-cleanup': 'actions.releasingLocalTransfer',
};
const serviceControlKeys = { start: 'action.startService', stop: 'action.stopService', restart: 'action.restartService', retry: 'action.retryService', remove: 'action.removeService' };
function actionIntent(el, action = el.dataset.action || '') {
    let label = actionLabels[action] ? t(actionLabels[action]) : undefined;
    if (!label)
        return;
    if (action === 'send-message' && el.dataset.cancelRunId)
        label = t('action.stoppingRunSend');
    if (['service-action', 'confirm-service-control'].includes(action)) {
        const control = el.dataset.control || view.data.control || '';
        label = serviceControlKeys[control] ? t(serviceControlKeys[control]) : control ? t('action.controlServiceNamed', { control }) : t('action.controlService');
    }
    const w = targetWork(el);
    let kind = 'read';
    if (action === 'send-message' && w && !imageDrafts.get(draftKey(w)).length && !view.literalSlash && /^\/(model|thinking)\s*$/.test((view.drafts[draftKey(w)] || '').trim()))
        return;
    if (['sign-in', 'sign-out', 'confirm-switch-core'].includes(action))
        kind = 'identity';
    else if (['create-work', 'start-work', 'start-import-open', 'confirm-stop', 'confirm-delete'].includes(action))
        kind = 'lifecycle';
    else if (['save-file', 'dirty-save', 'confirm-upload-overwrite', 'confirm-folder', 'confirm-transfer', 'confirm-file-delete', 'retry-selected-files', 'upload-input'].includes(action))
        kind = 'files';
    else if (['save-config', 'dirty-config-save', 'apply-config', 'confirm-core-skills', 'confirm-install', 'confirm-remove-package'].includes(action))
        kind = 'configuration';
    else if (action === 'service-action' || action === 'confirm-service-control') {
        if (action === 'service-action' && ['stop', 'remove'].includes(el.dataset.control || ''))
            return;
        kind = 'service';
    }
    else if (['new-session', 'send-message', 'cancel-run', 'save-model', 'cancel-pi-request', 'retry-pi-request'].includes(action))
        kind = 'agent';
    else if (['confirm-import', 'download-work', 'prepare-export', 'export'].includes(action))
        kind = 'transfer';
    const serviceAction = ['service-details', 'service-action', 'confirm-service-control', 'refresh-logs', 'open-app', 'open-window', 'retry-service-entry', 'check-preview'].includes(action);
    const serviceId = el.dataset.id || view.data.serviceId || view.service;
    const resource = ['retry-conversation', 'load-earlier-history', 'reload-history', 'check-active-run'].includes(action) ? view.session : action === 'refresh-files' ? view.file || view.path : action === 'create-work' ? view.createName.trim() : kind === 'lifecycle' || action === 'settings' ? w?.id : ['cancel-pi-request', 'retry-pi-request'].includes(action) ? `request:${el.dataset.id || view.data.requestId}` : serviceAction ? `service:${serviceId}${kind === 'service' ? '' : `:${view.port}`}` : el.dataset.path || el.dataset.id || view.data.serviceId || view.data.paths || (action === 'confirm-folder' ? joinPath(view.path, view.formName) : view.file || view.path);
    const key = `${kind}:${w?.id || 'local'}:${resource}:${action}`;
    const chatAction = ['new-session', 'send-message', 'cancel-run', 'resume-run', 'check-session-model', 'save-model', 'retry-conversation', 'load-earlier-history', 'reload-history'].includes(action);
    return { key, kind, work: w?.id, resource, action, label, target: action === 'create-work' ? view.createName || t('target.newWork') : chatAction ? w?.name || t('target.chat') : `${w?.name || adapter.state.core.address || (adapter.hosted ? t('target.server') : t('target.localCli'))}${resource && resource !== w?.id ? ` · ${resource}` : ''}`,
        anchor: focusKey(el), view: location.hash, origin: view.file || view.path, sourceContext: `${view.tab}:${view.session}:${view.modal}` };
}
async function dispatchAction(el, perform, intent = actionIntent(el)) {
    if (el.getAttribute?.('aria-disabled') === 'true')
        return;
    // Publishing local feedback can reconcile this button before the action runs.
    // Bind the clicked action and its explicit object IDs before that render.
    const action = el.dataset.action || '', target = el.cloneNode(false);
    const navigationFocus = ['tab-Services', 'tab-Files', 'settings'].includes(action) && document.activeElement === el, focusEpoch = adapter.identityEpoch;
    const execute = perform ?? ((record) => handleAction(action, target, record));
    if (!intent) {
        await execute();
        return;
    }
    if (intent.action === 'create-work' && createSubmissionBlocked(actions.records.values(), view.createName)) {
        toast(t('action.createBlocked'));
        return;
    }
    if (intent.work && intent.kind === 'lifecycle' && exportFlows.workControlBlocked(intent.work)) {
        toast(t('action.lifecycleBlocked'));
        return;
    }
    if (intent.work && ['export', 'prepare-export'].includes(intent.action || '') && exportWorkConflict(actions.records.values(), intent.work)) {
        toast(t('action.exportBlocked'));
        return;
    }
    const conflict = actions.conflict(intent);
    if (conflict) {
        toast(t('action.conflict', { target: conflict.target, phase: conflict.phase }));
        return;
    }
    const record = actions.begin(intent);
    try {
        await execute(record);
        actions.finish(record);
        if (['refresh-config'].includes(action))
            actions.reviewed(record.work, ['configuration']);
    }
    catch (error) {
        if (!(error instanceof ViewChanged)) {
            const unknown = record.blocked;
            actions.fail(record, error);
            record.blocked ||= unknown;
        }
        else
            actions.finish(record);
        if (record.action === 'create-work' && record.token < latestCreateToken)
            throw new ViewChanged();
        throw error;
    }
    finally {
        if (record.work && ['files', 'configuration'].includes(record.kind))
            adapter.uploadProgress.delete(record.work);
        // A read lock can blur its button. Restore only the still-selected original navigation.
        if (navigationFocus && focusEpoch === adapter.identityEpoch && actions.current(record) && current()?.id === record.work && !view.modal) {
            const active = document.activeElement, button = root.querySelector(`.work-tabs [data-action="${action}"].active`);
            if (button && !button.disabled && (active === document.body || active === root))
                button.focus({ preventScroll: true });
        }
    }
}
function progressText(progress) {
    const total = typeof progress.total === 'number' && Number.isFinite(progress.total) && progress.total > 0 ? progress.total : undefined;
    return `${esc(progress.phase)}${progress.transferred !== undefined ? ` · ${esc(progress.transferred)}${total ? ` / ${total}` : ''} ${t('progress.bytes')}` : ''}${total ? `<progress value="${Math.min(progress.transferred || 0, total)}" max="${total}" aria-label="${esc(t('progress.transferBytes'))}"></progress>` : ''}`;
}
function uploadProgressMarkup() {
    const work = current(), progress = work && adapter.uploadProgress.get(work.id);
    if (!progress)
        return '';
    const waiting = !progress.error && !['failed', 'unknown', 'ready', 'succeeded', 'delivered'].includes(String(progress.phase).toLowerCase());
    return feedback(`${waiting ? pendingStatus(String(progress.phase), 'upload-input confirm-upload-overwrite confirm-install') : ''}${esc(progress.path)}${progress.count ? ` · ${t('progress.fileOf', { index: progress.index, count: progress.count })}` : ''} · ${progressText(progress)}`);
}
function downloadProgressMarkup(snapshotID) {
    const job = adapter.downloads.get(snapshotID);
    if (!job)
        return '';
    return feedback(`${t('progress.transfer')} <code>${esc(job.transferId)}</code> · ${progressText(job)}${job.checkedAt ? ` · ${t('progress.checked', { time: esc(job.checkedAt) })}` : ''}${job.error ? ` · ${esc(job.error)}` : ''}${job.observationError ? ` · ${t('progress.observationInterrupted', { error: esc(job.observationError) })}` : ''}`, job.error || job.observationError ? 'warning' : 'info', btn(t('progress.checkTransfer'), 'check-download', 'small', `data-id="${esc(snapshotID)}"`));
}
let toastTimer;
let lastFocus = null;
let pendingNav = null;
let sourceGuardReturn;
/** The request inspector a Files target was opened from, so Back can restore it. */
let fileSourceReturn;
let composition = false;
let lastRoute = "";
const route = () => {
    if (location.hash && !location.hash.includes("ticket=")) {
        try {
            return location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
        }
        catch {
            return ["works"];
        }
    }
    const match = /^\/works\/([^/]+)(?:\/services\/([^/]+))?/.exec(location.pathname);
    return match ? match[2] ? ["app", decodeURIComponent(match[1]), decodeURIComponent(match[2]), new URLSearchParams(location.search).get("port") || ""] : ["work", decodeURIComponent(match[1])] : ["works"];
};
const current = () => adapter.getWork(route()[1] || "");
const activeService = (w) => w.services.find((s) => s.id === view.service) ||
    w.services.find((s) => s.enabled && s.observed === "Ready" && s.ports.length) ||
    w.services[0];
const unavailable = () => ["core-offline", "cli-closed"].includes(adapter.state.scenario) || !adapter.state.signedIn || adapter.state.sessionState === 'unavailable';
const dirty = () => view.file && view.fileDraft !== view.fileOriginal;
function toast(message) {
    view.toast = message;
    clearTimeout(toastTimer);
    render();
    toastTimer = setTimeout(() => {
        view.toast = "";
        render();
    }, 3000);
}
function navigate(hash) {
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
const workSelections = new Map();
let selectionWorkId = '', fileChoice = 0, filesRestoreNotice = '';
function rememberWork() {
    if (selectionWorkId && adapter.getWork(selectionWorkId))
        workSelections.set(selectionWorkId, {
            area: view.tab, path: view.path, file: view.file,
            service: view.service, port: view.port, session: view.session,
        });
}
async function restoreFiles(w, previous, valid) {
    const choice = fileChoice, area = areaChoice;
    const currentSelection = () => valid() && choice === fileChoice && area === areaChoice && view.tab === 'Files';
    let path = previous.path;
    while (currentSelection()) {
        try {
            await adapter.loadDirectory(w.id, path);
        }
        catch (error) {
            if (!currentSelection())
                return;
            if (missingFileTarget(error.httpStatus) && path !== '/') {
                path = parentDirectory(path);
                continue;
            }
            filesRestoreNotice = t('restore.folderFailed', { error: error instanceof Error ? error.message : String(error) });
            render();
            return;
        }
        if (!currentSelection())
            return;
        view.path = path;
        if (path !== previous.path)
            filesRestoreNotice = t('restore.folderMoved', { path });
        if (previous.file && path === previous.path) {
            try {
                await openFile(w, previous.file);
            }
            catch (error) {
                if (!valid() || area !== areaChoice || view.tab !== 'Files' || error instanceof ViewChanged)
                    return;
                filesRestoreNotice = t('restore.fileFailed', { error: error instanceof Error ? error.message : String(error) });
            }
        }
        if (valid())
            render();
        return;
    }
}
function draftKey(w, session = view.session) {
    return `${w.id}:${session || "new"}`;
}
function imageDraftMarkup(w, key) {
    const images = imageDrafts.get(key), reason = images.length ? adapter.imageInputReason(w.id, view.session) : '';
    return `${images.length ? `<div class="chat-image-drafts">${images.map(image => `<div class="chat-image-draft"><img src="${esc(image.url)}" alt="${esc(image.name)}"><span>${esc(image.name)}${image.reading ? pendingStatus(t('image.checking')) : ''}</span>${btn(t('image.remove'), 'remove-chat-image', 'small', `data-id="${esc(image.id)}" aria-label="${esc(t('image.removeAria', { name: image.name }))}"`)}</div>`).join('')}</div>` : ''}${reason ? feedback(adapter.imageCapabilities.get(w.id)?.loading ? pendingStatus(reason, 'check-image-support') : esc(reason), 'warning', adapter.imageCapabilities.get(w.id)?.error ? btn(t('image.checkSupport'), 'check-image-support', 'small') : '') : ''}${imageDraftErrors.get(key)?.message ? feedback(esc(imageDraftErrors.get(key).message), 'warning') : ''}`;
}
async function addChatImages(files) {
    const w = current();
    if (!w)
        return;
    const key = draftKey(w), epoch = adapter.identityEpoch, origin = location.hash, session = view.session, selection = imageSelection;
    const valid = () => epoch === adapter.identityEpoch && origin === location.hash && selection === imageSelection && (!session || view.session === session);
    imageDraftErrors.set(key, { message: '' });
    const errors = await imageDrafts.add(key, files, valid);
    if (valid()) {
        imageDraftErrors.set(key, { message: errors.join(' ') });
        render();
    }
}
function historyImageMarkup(w, session, run, image) {
    const key = adapter.historyImageKey(w.id, session, run, image.imageIndex), state = adapter.imageLoads.get(key);
    const attrs = `data-work="${esc(w.id)}" data-session="${esc(session)}" data-run="${esc(run)}" data-index="${esc(image.imageIndex)}"`;
    return `<div class="chat-history-image" data-history-image ${attrs}>${state?.phase === 'ready' ? `<button data-action="preview-chat-image" ${attrs} aria-label="${esc(t('image.viewAria', { index: image.imageIndex + 1 }))}"><img src="${esc(state.url)}" alt="${esc(t('image.sentAlt', { index: image.imageIndex + 1 }))}" loading="lazy"></button>` : state?.phase === 'error' ? `${feedback(esc(state.error), 'warning')}${btn(t('image.retry'), 'retry-chat-image', 'small', attrs)}` : pendingStatus(t('image.loading'), 'retry-chat-image')}</div>`;
}
async function openWork(w, record) {
    await guard(async () => {
        rememberWork();
        view.modal = '';
        modalChoice++;
        history.pushState(null, '', location.pathname + location.search + `#/work/${encodeURIComponent(w.id)}`);
        lastRoute = location.hash;
        if (record)
            record.view = location.hash;
        await loadRoute();
    });
}
function currentNameError() {
    const failure = view.modalNameError;
    const name = (view.modal === 'import' ? view.importName : view.createName).trim();
    return failure && failure.name === name ? failure.message : '';
}
function nameFieldError(id, importing = false) {
    const message = currentNameError();
    return message ? `<span id="${id}" class="name-field-error" role="alert">${esc(message)}${importing ? esc(t('name.leaveBlank')) : ''}</span>` : '';
}
function clearNameFieldError(renderNow = true) {
    if (!view.modalNameError)
        return;
    for (const [key, record] of actions.records) {
        if (!record.pending && !record.blocked && record.error === view.modalNameError.message && record.action === (view.modal === 'import' ? 'confirm-import' : 'create-work'))
            actions.records.delete(key);
    }
    view.modalNameError = null;
    view.modalError = '';
    if (renderNow)
        render();
}
function importNameFeedback(op) {
    if (op.kind !== 'Import Work' && op.kind !== 'import-work')
        return ''; // i18n-exempt: server operation kind
    const name = op.importName || adapter.getWork(op.workId)?.name;
    if (!name)
        return `<div class="import-name-feedback">${feedback(t('import.nameUnconfirmed'))}</div>`;
    const title = op.state === 'succeeded' ? t('import.importedAs') : t('import.nameSelected');
    const renamed = op.importSourceName && op.importSourceName !== name;
    return `<div class="import-name-feedback">${feedback(`${t('import.titleLine', { title, name: `<strong>${esc(name)}</strong>` })}${renamed ? `<p>${t('import.renamed', { source: `<strong>${esc(op.importSourceName)}</strong>` })}</p>` : ''}`)}</div>`;
}
let overlayAnchor = "";
let overlayContext = "";
let overlayOpening = false;
let requestNavigation;
function requestNavigationCurrent() { return requestNavigation?.epoch === adapter.identityEpoch && requestNavigation.workId === current()?.id; }
function openModal(name, data = {}) {
    fileActionsContext = '';
    const sourceFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const existing = root.querySelector('#modal');
    if (!existing?.contains(sourceFocus))
        overlayAnchor = focusKey(sourceFocus) || focusReturn;
    if (name === 'chat-response-settings')
        overlayAnchor = '#response-settings-trigger';
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
    fileAttempt = undefined;
    modalTransfers = [];
    view.deleteConfirmed = false;
    overlayOpening = true;
    try {
        render();
    }
    finally {
        overlayOpening = false;
    }
    const panel = root.querySelector('#modal');
    if (overlayRole(name) === 'menu')
        panel?.querySelector('[role=menuitem]:not([disabled])')?.focus({ preventScroll: true });
    else if (overlayRole(name) === 'drawer')
        panel?.querySelector('[data-action=close-modal]')?.focus({ preventScroll: true });
    else if (name === 'sessions')
        (panel?.querySelector('[role=option][aria-selected=true]') || panel?.querySelector('[role=option]') || panel?.querySelector('[data-action=new-session]:not([disabled])') || panel?.querySelector('[data-action=close-modal]'))?.focus();
    else if (anchoredOverlay(name))
        panel?.querySelector('[aria-selected=true],button:not([disabled]),input:not([disabled]),summary')?.focus({ preventScroll: true });
}
function closeModal(restoreFocus = true) {
    if (!view.modal)
        return;
    if (['dirty-file', 'dirty-settings'].includes(view.modal) && sourceGuardReturn) {
        const original = sourceGuardReturn;
        sourceGuardReturn = undefined;
        pendingNav = null;
        if (original.epoch === adapter.identityEpoch && original.route === location.hash) {
            modalChoice++;
            view.modal = original.modal;
            view.data = { ...original.data };
            view.modalError = '';
            render();
            root.querySelector(original.focus)?.focus({ preventScroll: true });
            return;
        }
    }
    const dialog = root.querySelector('#modal');
    const requestEntry = isRequestInspector() && requestNavigationCurrent() ? requestNavigation.entry : '';
    const responseSettings = view.modal === 'chat-response-settings';
    const responseContext = responseSettings && chatSettingsContextCurrent();
    const source = view.data.source, oldFocus = lastFocus;
    const selector = requestEntry || (responseSettings && responseContext ? source === 'command' ? '#composer' : '#response-settings-trigger' : focusReturn);
    const caret = [Number(view.data.caretStart), Number(view.data.caretEnd)];
    if (responseSettings && pendingWebCommand && ['model', 'thinking'].includes(pendingWebCommand.kind) && !pendingWebCommand.pair)
        pendingWebCommand = undefined;
    if (view.modal === 'new-work' || view.modal === 'import')
        clearNameFieldError(false);
    if (view.modal === "import")
        void adapter.abandonInspection();
    // Invalidate before closing native presentation; no exit snapshot or delayed callback owns focus.
    modalChoice++;
    view.modal = "";
    view.modalError = "";
    view.modalNameError = null;
    if (requestEntry)
        requestNavigation = undefined;
    if (responseSettings)
        focusReturn = '';
    const restore = (continuing) => {
        const visible = (node) => !!node?.isConnected && !!node.getClientRects().length && !node.closest('[inert]') && !node.disabled;
        let target = visible(continuing || null) ? continuing : (selector ? root.querySelector(selector) : null);
        if (!visible(target) && visible(oldFocus))
            target = oldFocus;
        if (!visible(target))
            target = [...root.querySelectorAll('[data-action=account],[data-action=work-menu],[data-action^=tab-],[data-action=exit-service-focus],[data-action=service-focus],#composer')].find(visible) || null;
        if (target && target !== document.activeElement)
            target.focus({ preventScroll: true });
        if (!continuing && responseSettings && responseContext && source === 'command' && target instanceof HTMLTextAreaElement)
            target.setSelectionRange(caret[0], caret[1]);
    };
    if (dialog?.open)
        dialog.close();
    render();
    if (restoreFocus)
        restore();
}
const phase = (op) => `<div class="phase-track" role="status" aria-busy="${operationBusy(op)}"><div>${operationBusy(op) ? pendingStatus(t('phase.current', { phase: stateText(op.phase || op.state) })) : `<span>${op.state === 'succeeded' ? icon('check', 14) : icon('clock', 14)}</span>${t('phase.current', { phase: esc(stateText(op.phase || op.state)) })}`}</div></div>`;
function scenarioBar() { return ""; }
function brand() {
    return `<a href="#/works" class="brand" aria-label="${esc(t('brand.worksAria'))}"><img class="brand-logo" src="/desktop/piwork-logo.png" alt="" width="40" height="40"><span class="brand-product">Desktop</span></a>`;
}
function topbar() {
    if (adapter.state.sessionState !== "ready")
        return `<header class="topbar">${brand()}<div class="topbar-right">${languageTrigger()}</div></header>`;
    return `<header class="topbar">${brand()}${view.modal !== "connection" && route()[0] !== "works" ? coreConnectionStatus() : ""}<div class="topbar-right">${!adapter.state.signedIn ? languageTrigger() : ''}${btn(`<span class="avatar">${esc(adapter.state.core.account.slice(0, 1).toUpperCase() || "?")}</span><span>${esc(adapter.state.core.account || t('topbar.account'))}</span>${icon("down", 14)}`, "account", "account-button quiet", `aria-label="${esc(t('topbar.accountMenuAria', { account: adapter.state.core.account || t('topbar.account') }))}" aria-haspopup="dialog" aria-expanded="${view.modal === 'account'}"`)}</div></header>`;
}
function defaultCorePreferences() {
    const p = adapter.preferences, blocked = ['saving', 'clearing', 'unconfirmed'].includes(p.phase);
    const pending = p.reading ? t('defaults.reading') : p.phase === 'saving' ? t('defaults.saving') : p.phase === 'clearing' ? t('defaults.restoring') : p.phase === 'loading' ? t('defaults.reading') : p.phase === 'unconfirmed' ? t('defaults.unconfirmed') : '';
    return `<section class="default-core-preferences" aria-label="${esc(t('defaults.aria'))}"><p class="muted">${t('defaults.currentConnection', { address: `<code>${esc(adapter.state.core.address)}</code>` })}</p><p>${t('defaults.savedDefault', { value: `<strong>${esc(p.confirmed ? p.coreUrl || t('defaults.notSet') : t('defaults.notRead'))}</strong>` })}</p><p class="muted">${t('defaults.help')}</p><div>${btn(t('defaults.save'), 'save-default-core', 'quiet small', blocked ? 'disabled' : '')}${btn(t('defaults.restore'), 'clear-default-core', 'quiet small', blocked ? 'disabled' : '')}${btn(t('defaults.read'), 'read-default-core', 'quiet small', ['saving', 'clearing', 'loading'].includes(p.phase) || p.reading ? 'disabled' : '')}</div>${pending ? `<p role="status" aria-live="polite">${['saving', 'clearing', 'loading'].includes(p.phase) || p.reading ? pendingStatus(pending, 'read-default-core save-default-core clear-default-core') : esc(pending)}${p.waiting ? esc(t('defaults.stillWaiting')) : ''}</p>` : ''}${p.error ? feedback(esc(p.error), 'warning') : ''}${p.notice ? `<p role="status" aria-live="polite">${esc(p.notice)}</p>` : ''}</section>`;
}
function coreConnectionStatus() {
    const check = adapter.connectionCheck;
    if (check.checking)
        return pendingStatus(check.waiting ? t('conn.stillChecking') : t('conn.checking'), 'check-connection');
    return check.error ? `<span class="muted" role="status">${t('conn.notConfirmed', { error: esc(check.error) })}</span>` : '';
}
function coreRuntimeUnavailable() { return adapter.status?.readiness?.available && adapter.status.readiness.value?.state === 'RUNTIME_UNAVAILABLE'; }
function coreRecovering() { return !adapter.connectionCheck.error && adapter.status.health?.available && adapter.status?.readiness?.available && adapter.status.readiness.value?.state === 'RECOVERING'; }
function coreStarting() { return !adapter.connectionCheck.checking && coreRecovering(); }
function connection() {
    const s = adapter.state.scenario;
    return `<button class="connection" data-action="connection">${coreStarting() ? '<i class="core-starting-spinner" aria-hidden="true"></i>' : `<i class="${["core-offline", "env-not-ready"].includes(s) || adapter.state.sessionState === "unavailable" ? "warn" : ""}"></i>`}${esc(adapter.state.core.name)}<span>·</span>${adapter.connectionCheck.checking ? pendingStatus(t('conn.checking'), "check-connection") : adapter.state.sessionState === "unavailable" ? t('conn.unavailable') : adapter.connectionCheck.error ? t('common.notConfirmed') : s === "core-offline" ? t('conn.unreachable') : coreStarting() ? t('conn.starting') : s === "env-not-ready" && !adapter.status?.readiness?.available ? t('common.notConfirmed') : coreRuntimeUnavailable() ? t('conn.runtimeUnavailable') : s === "env-not-ready" ? t('conn.runtimeNotReady') : adapter.connectionCheck.checkedAt ? t('conn.connected') : t('conn.notChecked')}${icon("down", 12)}</button>`;
}
function signIn() {
    applyDocumentTitle(t('doc.connect'));
    const loading = adapter.state.sessionState === 'loading';
    const retryAvailable = !loading || !!adapter.state.sessionError;
    if (adapter.hosted)
        return `${topbar()}<main class="auth-main"><h1>${loading ? t('auth.opening') : t('auth.connectToPiwork')}</h1><p class="muted" role="status">${loading && !adapter.state.sessionError ? pendingStatus(t('auth.readingServerSession'), 'retry-session') : esc(adapter.state.sessionError || t('auth.signInContinue'))}</p>${loading ? '' : `<a class="button primary" href="/login">${t('auth.signIn')}</a>`}${retryAvailable ? btn(t('auth.retry'), 'retry-session', 'quiet') : ''}</main>`;
    if (adapter.state.sessionState !== 'ready')
        return `${topbar()}<main class="auth-main"><div class="auth-symbol">${icon('lock', 26)}</div><h1>${loading ? t('auth.opening') : t('auth.desktopUnavailable')}</h1><p class="muted" role="status" aria-live="polite">${loading && !adapter.state.sessionError ? pendingStatus(t('auth.connectingLocal'), 'retry-session') : esc(adapter.state.sessionError || t('auth.retryConnection'))}</p>${retryAvailable ? btn(t('auth.retry'), 'retry-session', 'primary full') : ''}${loading ? '' : `<p class="muted">${t('auth.startDesktop', { command: `<code>${esc(adapter.startCommand())}</code>` })}</p>`}</main>`;
    return `${topbar()}<main class="auth-main"><div class="auth-symbol">${icon("lock", 26)}</div><h1>${t('auth.connectToCore')}</h1><p class="muted">${t('auth.coreAccountHelp')}</p>${adapter.state.cleanupRequired ? feedback(t('auth.cleanupIncomplete', { command: `<code>${esc(adapter.logoutCommand())}</code>` }), 'warning') : ''}${view.toast ? feedback(esc(view.toast), "warning") : ""}<label class="field">${t('auth.coreAddress')}<input id="auth-core" value="${esc(view.coreAddress || adapter.state.core.address)}" placeholder="http://127.0.0.1:7181"></label>${defaultCorePreferences()}<label class="field">${t('auth.account')}<input id="auth-account" autocomplete="username" value="${esc(view.authAccount)}"></label><label class="field">${t('auth.password')}<input id="auth-password" type="password" autocomplete="current-password"></label>${btn(t('auth.signIn'), "sign-in", "primary full")}<div class="auth-divider">${t('auth.inspectDivider')}</div>${btn(`${icon("upload", 16)} ${t('auth.inspectPackage')}`, "import", "quiet")}</main>`;
}
function worksRefreshButton() {
    const pending = adapter.worksLoading || [...actions.records.values()].some(record => record.action === 'retry-works' && record.pending && record.view === location.hash);
    const label = pending ? t('works.reading') : t('works.refresh');
    return btn(pending && (!!adapter.worksChecked || !!adapter.worksError || adapter.state.works.length > 0) ? pendingDots() : icon('refresh'), 'retry-works', `icon-button quiet ${pending ? 'is-reading' : ''}`, `title="${esc(label)}" aria-label="${esc(label)}" ${pending ? 'disabled aria-busy="true" data-read-busy="true"' : ''}`);
}
function works() {
    applyDocumentTitle(t('doc.works'));
    const s = adapter.state.scenario;
    const confirmed = !!adapter.worksChecked || adapter.state.works.length > 0;
    const all = adapter.state.works.filter((w) => w.name.toLowerCase().includes(view.search.toLowerCase()));
    return `${topbar()}<main class="works-page">${confirmed && adapter.worksError ? feedback(t('works.refreshFailed', { error: esc(adapter.worksError) }), 'warning', btn(t('works.retryLoading'), 'retry-works', 'small')) : ''}<div class="list-controls works-toolbar"><div class="search-box">${icon("search")}<input id="search" value="${esc(view.search)}" placeholder="${esc(t('works.searchPlaceholder'))}" aria-label="${esc(t('works.searchAria'))}">${view.search ? btn(icon("close"), "clear-search", "icon-button quiet", `aria-label="${esc(t('works.clearSearch'))}"`) : ""}</div>${connection()}<div class="actions">${worksRefreshButton()}${btn(icon("upload"), "import", "icon-button quiet", `title="${esc(t('works.import'))}" aria-label="${esc(t('works.import'))}"`)}${btn(icon("plus"), "new-work", "icon-button primary", `title="${esc(t('works.newWork'))}" aria-label="${esc(t('works.newWork'))}"`)}</div></div>${s === "core-offline" ? feedback(t('works.coreOffline', { time: esc(adapter.state.lastChecked) }), "warning", btn(t('works.checkConnection'), "check-connection", "small")) : ""}${s === "env-not-ready" && !coreRecovering() ? feedback(adapter.status?.readiness?.available && !adapter.connectionCheck.error ? t(coreRuntimeUnavailable() ? 'works.runtimeUnavailable' : 'works.runtimeNotReady') : t('works.readinessUnconfirmed'), "warning", btn(t('works.checkReadiness'), "check-connection", "small")) : ""}${(!confirmed && !adapter.worksError && (s === "loading" || adapter.worksLoading || adapter.connectionCheck.checking)) ? `<div class="loading-list" role="status" aria-label="${esc(t('works.loadingAria'))}" aria-busy="true">${[1, 2, 3].map(() => '<div class="skeleton" aria-hidden="true"><i></i><span></span><span></span></div>').join("")}</div>` : !confirmed && (s === "list-error" || adapter.worksError) ? empty("refresh", t('works.loadFailed'), `${adapter.worksError ? `<span class="works-error-cause">${esc(adapter.worksError)}</span>` : ""}${t('works.loadFailedBody')}`, btn(t('works.retryLoading'), "retry-works", "primary")) : !confirmed ? empty("grid", t('works.notReadTitle'), t('works.notReadBody'), btn(t('works.read'), "retry-works", "primary")) : !adapter.state.works.length ? empty("grid", t('works.emptyTitle'), t('works.emptyBody'), btn(`${icon("plus")} ${t('works.newWork')}`, "new-work", "primary")) : all.length ? `<div class="work-table"><div class="work-table-head"><span>${t('works.colName')}</span><span>${t('works.colStatus')}</span><span>${t('works.colQuick')}</span><span></span></div>${all.map((w) => `<div class="work-row"><a class="work-name" data-action="open-work" data-id="${esc(w.id)}" href="#/work/${encodeURIComponent(w.id)}"><span class="work-icon ${w.color}">${icon(w.icon, 22)}</span><span><strong>${esc(w.name)}</strong><small>${esc(w.description)}</small></span></a><div class="work-status">${workStatus(w)}${workRowControl(w, workControls.get(w.id))}</div><div>${quickAction(w)}</div>${btn(icon("more"), "work-menu", "icon-button quiet", `data-id="${w.id}" aria-label="${esc(t('works.moreAria', { name: w.name }))}"`)}</div>`).join("")}</div>` : empty("search", t('works.noMatchTitle'), t('works.noMatchBody'), btn(t('works.clearSearch'), "clear-search"))}<div class="works-footer"><span>${icon("lock", 14)} ${t('works.ownOnly')}</span><span>${confirmed ? t('works.count', { count: adapter.state.works.length }) : t('works.countUnread')} <b>·</b> ${esc(adapter.state.core.account)}</span></div><div class="works-help"><span class="mini-symbol">${icon("spark", 19)}</span><div><strong>${t('works.helpTitle')}</strong><p>${t('works.helpBody')}</p></div></div></main>`;
}
function quickAction(w) {
    if (route()[0] === 'works' && controlReady(workControls.get(w.id), w))
        return workLink(t('quick.openWork'), w.id, 'primary small');
    const state = adapter.project(w), action = state.action;
    if (action === 'stop')
        return route()[0] === 'works' ? state.usable ? workLink(t('quick.openWork'), w.id, 'quiet small') : btn(`${icon('refresh', 15)} ${t('quick.checkStatus')}`, 'check-work', 'quiet small', `data-id="${esc(w.id)}"`) : '';
    const label = { start: t('action.startWork'), retry: t('action.retryWork'), check: t('quick.checkStatus') }[action];
    return btn(`${icon(action === 'start' ? 'play' : 'refresh', 15)} ${label}`, action === 'check' ? 'check-work' : 'start-work', 'quiet small', `data-id="${esc(w.id)}"`);
}
function workStatus(w) {
    const state = adapter.project(w);
    return `${badge(state.label)}${state.explanation ? `<small>${esc(state.explanation)}</small>` : w.status === 'Degraded' ? `<small>${t('work.capabilityAttention')}</small>` : ''}`;
}
function workRouteFeedback(w) {
    const pending = [...actions.records.values()].filter(record => record.work === w.id && record.view === location.hash && record.pending && (record.key.startsWith('route:') || ['open-work', 'retry-work-read'].includes(record.action || '')));
    if (!pending.length)
        return '';
    const slow = pending.some(record => Date.now() - record.started >= 10000);
    const label = slow ? t('work.stillReading') : t('work.reading');
    return `<span class="work-read-feedback" role="status" aria-busy="true" aria-label="${esc(label)}">${pendingDots()}${slow ? `<small>${esc(label)}</small>` : ''}</span>`;
}
function workHeader(w, standalone = false) {
    return `<header class="work-header"><div class="work-header-main">${btn(icon("arrow", 19), standalone ? "back-work" : "back-works", "icon-button quiet", `aria-label="${esc(standalone ? t('work.backToWork') : t('work.backToWorks'))}"`)}<span class="header-divider"></span><span class="work-icon small ${w.color}">${icon(w.icon, 19)}</span><h1 title="${esc(w.name)}">${esc(w.name)}</h1>${badge(adapter.project(w).label)}${workRouteFeedback(w)}${view.modal !== "connection" ? coreConnectionStatus() : ""}</div><div class="actions header-actions">${quickAction(w)}${btn(icon("more"), "work-menu", "icon-button quiet", `data-id="${w.id}" aria-label="${esc(t('work.optionsAria'))}"`)}</div></header>`;
}
function workPage(w) {
    const settings = route()[2] === "settings", panels = workspacePanels.get(w.id);
    const serviceArea = view.tab === 'Services', narrow = innerWidth < 900;
    const hiddenChat = view.layout === 'service-only' || serviceArea && view.layout === 'workspace' && (narrow ? !panels.narrowChat : panels.collapsed);
    const narrowChat = serviceArea && narrow && !hiddenChat && view.layout !== 'chat-only';
    return `${workHeader(w)}${controlMarkup(workControls.get(w.id))}<nav class="work-tabs" aria-label="${esc(t('work.areasAria'))}"><div>${[['Services', t('work.tabServices'), 'grid'], ['Files', t('work.tabFiles'), 'folder'], ['Chat', t('work.tabChat'), 'chat']].map(([value, label, symbol]) => btn(`${icon(symbol, 17)} ${label}`, `tab-${value}`, !settings && view.tab === value ? "tab active" : "tab")).join("")}</div><div class="work-tools">${btn(`${icon('note', 17)} <span>${t('work.piRequests')}</span>`, 'pi-requests', 'tab work-requests', `aria-label="${esc(t('work.piRequestsAria'))}" title="${esc(t('work.piRequestsAria'))}"`)}${btn(`${icon("settings", 17)} ${t('work.settings')}`, "settings", settings ? "tab active" : "tab")}</div></nav>${serviceNotice(w)}${!settings && adapter.project(w).retainWorkspace && !adapter.project(w).usable ? feedback(t('work.statusUnconfirmed'), "warning", btn(t('work.checkWork'), "check-work", "small", `data-id="${esc(w.id)}"`)) : ""}${settings ? settingsPage(w) : !adapter.project(w).retainWorkspace ? `${view.layout !== "workspace" ? `<div class="focus-unavailable"><b>${esc(w.name)}</b>${focusControls(w)}</div>` : ""}${workState(w)}` : `<div class="work-layout ${view.agentOpen ? "agent-open" : ""} ${view.tab === "Chat" || view.layout === "chat-only" ? "chat-main" : ""} ${hiddenChat ? "chat-hidden" : ""} ${serviceArea ? "service-workspace" : ""} ${narrowChat ? "narrow-chat" : ""}"><section id="workspace-main" class="main-panel" ${view.layout === "chat-only" ? "inert" : ""}>${view.tab === "Files" ? files(w) : view.tab === "Chat" ? "" : services(w)}</section><div id="workspace-splitter" class="workspace-splitter" role="separator" aria-orientation="vertical" aria-label="${esc(t('work.resizeAria'))}" aria-controls="workspace-main workspace-chat" aria-valuemin="0" aria-valuemax="100" aria-valuenow="70" title="${esc(t('work.resizeTitle'))}" tabindex="${serviceArea && !narrow && !hiddenChat && view.layout !== 'chat-only' ? 0 : -1}"></div><aside id="workspace-chat" class="agent-side" ${hiddenChat ? "inert" : ""}>${agent(w, view.tab === "Chat" || view.layout === "chat-only")}</aside>${btn(`${icon("chat")} Agent`, "toggle-agent", "floating-agent")}</div>`}`;
}
function workState(w) {
    const state = adapter.project(w);
    const stopped = state.action === 'start';
    const title = stopped ? t('state.stoppedTitle') : { Preparing: t('state.preparing'), Starting: t('state.starting'), Stopping: t('state.stopping'), Unknown: t('state.unknown') }[state.label] || state.label;
    const details = state.operationIds.length ? btn(t('control.operationDetails'), 'work-operations', '', `data-id="${esc(w.id)}"`) : '';
    return `<main class="work-state">${!workControls.has(w.id) && state.operationIds.some(id => operationBusy(adapter.getOperation(id))) ? pendingStatus(t('state.working', { state: state.label })) : ''}${empty(stopped ? 'stop' : w.status === 'Failed' ? 'info' : 'clock', title, stopped ? t('state.stoppedBody') : esc(state.explanation || w.error || t('state.waitingBody')), `<div class="actions">${quickAction(w)}${btn(t('work.settings'), 'settings')}${details}${state.exportable ? btn(`${icon('download')} ${t('state.exportWork')}`, 'export', '', `data-id="${esc(w.id)}"`) : ''}</div>`)}
    <details class="state-footnote"><summary>${t('state.details')}</summary><p>${t('state.target', { value: esc(stateText(w.desired)) })} · ${t('state.lastConfirmed', { value: esc(stateText(w.status)) })} · ${t('state.checked', { value: esc(w.checkedAt || t('common.notConfirmed')) })}</p></details></main>`;
}
function serviceUnavailableReason(service) {
    if (service.temporary?.mode === 'once' && service.observed === 'Completed')
        return t('merge.onceCompleted');
    if (service.temporary?.mode === 'once' && service.observed === 'Running')
        return t('merge.onceRunning');
    if (!service.enabled)
        return t('service.disabledReason');
    if (service.observed === 'Starting')
        return t('service.startingReason');
    if (service.observed === 'Recovering')
        return t('merge.recoveringReason');
    if (service.observed === 'Failed')
        return t('service.failedReason');
    if (service.observed === 'Stopped')
        return t('service.stoppedReason');
    return t('service.unconfirmedReason');
}
/** Only a confirmed Service catalog may describe Service facts; a failed or absent read says nothing. */
function serviceCatalogConfirmed(w) {
    return !!w.resourceChecked?.services && !w.resourceErrors?.services;
}
function serviceFacts(w) {
    const services = serviceCatalogConfirmed(w) ? w.services.filter(s => s.enabled && s.observed !== 'Removed' && !s.temporary) : [];
    return { failed: services.filter(s => s.observed === 'Failed'), starting: services.filter(s => s.observed === 'Starting'), recovering: services.filter(s => s.observed === 'Recovering'), unknown: services.filter(s => s.observed === 'Unknown') };
}
/** The Work summary never substitutes for the concrete Service facts it summarizes. */
function serviceNotice(w) {
    if (w.status !== 'Degraded' || !serviceCatalogConfirmed(w))
        return '';
    const { failed, starting, recovering, unknown } = serviceFacts(w);
    if (failed.length) {
        const summary = failed.length === 1 ? t('merge.failedOne', { name: esc(failed[0].name), reason: esc(serviceFailureReason(failed[0])) }) : t('service.failedMany', { count: failed.length });
        const entry = failed.length === 1
            ? btn(t('service.viewDetails'), 'service-details', 'text-button', `data-id="${esc(failed[0].id)}"`)
            : btn(t('service.viewDetails'), 'manage-services', 'text-button');
        return `<div class="work-notice">${icon('info', 15)} ${summary}. ${t('merge.checkOthers')} ${entry}</div>`;
    }
    if (recovering.length) {
        const summary = recovering.length === 1 ? t('merge.recoveringOne', { name: esc(recovering[0].name) }) + (recovering[0].diagnostic?.message ? `: ${esc(recovering[0].diagnostic.message)}` : '') : t('merge.recoveringMany', { count: recovering.length });
        const entry = recovering.length === 1 ? btn(t('service.viewDetails'), 'service-details', 'text-button', `data-id="${esc(recovering[0].id)}"`) : btn(t('service.viewDetails'), 'manage-services', 'text-button');
        return `<div class="work-notice">${icon('info', 15)} ${summary}. ${entry}</div>`;
    }
    if (unknown.length) {
        const summary = unknown.length === 1 ? `${esc(unknown[0].name)}: ${esc(unknown[0].diagnostic?.message || t('merge.statusUnconfirmed'))}` : t('merge.unknownMany', { count: unknown.length });
        const entry = unknown.length === 1 ? btn(t('service.viewDetails'), 'service-details', 'text-button', `data-id="${esc(unknown[0].id)}"`) : btn(t('service.viewDetails'), 'manage-services', 'text-button');
        return `<div class="work-notice">${icon('info', 15)} ${summary}. ${entry}</div>`;
    }
    if (starting.length) {
        const summary = starting.length === 1 ? t('service.startingOne', { name: esc(starting[0].name) }) : t('service.startingMany', { count: starting.length });
        return `<div class="work-notice">${icon('clock', 15)} ${summary}. ${t('service.startingNotFailure')}</div>`;
    }
    return `<div class="work-notice">${icon('info', 15)} ${t('service.someNotReady')} ${btn(t('service.viewDetails'), 'manage-services', 'text-button')}</div>`;
}
function serviceFailureTitle(s) {
    const stage = s.diagnostic?.stage;
    return stage === 'service-start' || stage === 'service-readiness' ? t('service.failedToStart', { name: esc(s.name) }) : t('service.failed', { name: esc(s.name) });
}
/** A historical lastError never presents a confirmed Ready or newly Starting Service as failed. */
function serviceFailureReason(s) {
    return s.diagnostic?.message || s.error || t('service.failureDefault');
}
/** The four-square booting placeholder is limited to a confirmed, enabled, runnable Starting Service. */
function serviceStartupConfirmed(w, s) {
    return s.enabled && s.observed === 'Starting' && serviceCatalogConfirmed(w) && adapter.project(w).usable;
}
function serviceStartupPlaceholder(s, action) {
    return `<div class="empty startup-placeholder" role="status" aria-busy="true" aria-label="${esc(t('service.startingName', { name: s.name }))}">${icon('grid', 32)}<h2>${esc(t('service.startingName', { name: s.name }))}</h2><p>${esc(serviceUnavailableReason(s))}</p>${action}</div>`;
}
function serviceStatePlaceholder(w, s) {
    if (!s.enabled)
        return empty('grid', `${esc(t('service.disabledName', { name: s.name }))}`, esc(serviceUnavailableReason(s)), btn(t('service.manage'), 'manage-services', 'primary'));
    if (s.observed === 'Failed')
        return empty('grid', serviceFailureTitle(s), `${esc(t('service.failureBody', { reason: serviceFailureReason(s) }))}`, btn(t('service.viewDetails'), 'service-details', 'primary', `data-id="${esc(s.id)}"`) + btn(t('service.manage'), 'manage-services'));
    if (serviceStartupConfirmed(w, s))
        return serviceStartupPlaceholder(s, btn(t('service.manage'), 'manage-services'));
    return empty('grid', `${esc(t('service.stateName', { name: s.name, state: stateText(s.observed.toLowerCase()) }))}`, esc(serviceUnavailableReason(s)), btn(t('service.manage'), 'manage-services', 'primary'));
}
function serviceFallbackHeader(w) {
    return `<div class="service-toolbar"><span class="service-selector">${t('work.tabServices')}</span><div class="actions focus-actions">${workspaceChatToggle(w)}${focusControls(w)}</div></div>`;
}
function serviceViewport(w, service) {
    const key = `${w.id}:${service.id}:${view.port}`, url = adapter.serviceEntryUrl(w.id, service.id, view.port);
    // The entry probe normalizes ticket URLs while reconciliation retains the live
    // iframe. Never gate application visibility on src equality or window.load:
    // a usable application may still have unfinished subresources.
    return `<div class="service-viewport"><iframe data-service-key="${esc(key)}" class="real-service-frame" title="${esc(t('service.applicationTitle', { name: service.name }))}" src="${esc(url)}"></iframe></div>`;
}
function observeServiceFrames() {
    for (const frame of root.querySelectorAll('iframe[data-service-key]'))
        if (!frame.dataset.observed) {
            const epoch = adapter.identityEpoch;
            frame.dataset.observed = 'true';
            frame.addEventListener('load', () => {
                if (!frame.isConnected || epoch !== adapter.identityEpoch)
                    return;
                // Navigation is a reason to recheck embedding, not a visibility gate.
                const [workId, serviceId, port] = frame.dataset.serviceKey.split(':');
                void adapter.serviceFrameLoaded(workId, serviceId, Number(port)).catch(error => { if (frame.isConnected && epoch === adapter.identityEpoch)
                    toast(error.message); });
            });
        }
}
function services(w) {
    if (!w.resourceChecked?.services && !w.resourceErrors?.services)
        return `${serviceFallbackHeader(w)}${readPlaceholder(t('service.loading'), 'service')}`;
    const s = route()[0] === "app" ? w.services.find(service => service.id === route()[2]) : activeService(w);
    if (s && route()[0] !== "app" && !s.ports.includes(view.port))
        view.port = s.ports[0] || 0;
    if (w.resourceErrors?.services && !w.resourceChecked?.services)
        return serviceFallbackHeader(w) + feedback(esc(w.resourceErrors.services), "warning", btn(t('service.retry'), "retry-services"));
    if ((!s || !s.ports.length) && w.resourceErrors?.services)
        return serviceFallbackHeader(w) + feedback(`${t('service.availabilityUnconfirmed')} ${esc(w.resourceErrors.services)}`, 'warning', btn(t('service.retry'), 'retry-services', 'small'));
    if (!s || !s.ports.length)
        return serviceFallbackHeader(w) + empty("grid", t('service.noneReady'), t('service.noneReadyBody'), btn(t('service.focusChat'), "tab-Chat", "primary") + (w.services.length ? btn(t('service.manage'), "manage-services") : ""));
    const serviceKey = `${w.id}:${s.id}:${view.port}`;
    const keepStartingFrame = s.observed === 'Starting' && s.enabled && s.ports.includes(view.port) && w.desired === 'running'
        && (w.status === 'Ready' || w.status === 'Degraded')
        && [...root.querySelectorAll('iframe[data-service-key]')].some(frame => frame.dataset.serviceKey === serviceKey);
    return `${w.resourceErrors?.services ? feedback(esc(w.resourceErrors.services), "warning", btn(t('service.retry'), "retry-services", "small")) : ""}<div class="service-toolbar"><div class="service-selector">${btn(`${icon('grid', 16)}<span class="service-name">${esc(s.name)}</span>${badge(s.enabled ? s.observed : 'Disabled')}${icon('down', 13)}`, 'service-picker', 'quiet service-trigger', `id="service-select" data-service-id="${esc(s.id)}" aria-label="${esc(t('service.pickerAria', { name: s.name }))}" aria-haspopup="dialog" title="${esc(t('service.switch'))}"`)}</div><div class="actions focus-actions">${adapter.requestPresence.get(`${w.id}:${s.name}`)?.hasRecords ? btn(icon("note", 17), "service-requests", "icon-button quiet", `aria-label="${esc(t('service.agentRequests'))}" title="${esc(t('service.agentRequests'))}"`) : ""}${workspaceChatToggle(w)}${focusControls(w)}${btn(icon("external", 16), "open-app", "icon-button quiet", `aria-label="${esc(t('service.openNewTab'))}"`)}${btn(icon("more"), "service-menu", "icon-button quiet", `aria-label="${esc(t('service.options'))}"`)}</div></div>${view.serviceOpenError ? feedback(esc(view.serviceOpenError), "warning", btn(adapter.hosted ? t('service.copyAccessLink') : t('service.copyLocalLink'), "copy-local", "small")) : ""}${s.enabled && s.observed === "Ready" && adapter.serviceEmbed(w.id, s.id, view.port) === "denied" ? empty("external", t('service.opensOwnTab'), t('service.embedDenied'), btn(`${icon("external")} ${t('service.openApplicationTab')}`, "open-app", "primary")) : (!s.enabled || s.observed !== "Ready") && !keepStartingFrame ? serviceStatePlaceholder(w, s) : adapter.serviceEntryError(w.id, s.id, view.port) ? empty("grid", t('service.entryUnavailable'), esc(adapter.serviceEntryError(w.id, s.id, view.port)), btn(t('common.retry'), "retry-service-entry", "primary")) : adapter.serviceEntryUrl(w.id, s.id, view.port) ? serviceViewport(w, s) : (adapter.serviceEntryPending(w.id, s.id, view.port) || adapter.project(w).usable && s.enabled && s.observed === 'Ready' && s.ports.includes(view.port)) ? readPlaceholder(t('service.opening', { name: s.name }), 'service') : empty("grid", t('service.entryNotConfirmed'), s.ports.includes(view.port) ? t('service.entryCheckStatus') : t('service.portNotDeclared'), btn(t('common.retry'), "retry-service-entry", "primary", s.ports.includes(view.port) ? "" : "disabled"))}${adapter.servicePreviewUnconfirmed(w.id, s.id, view.port) ? feedback(esc(adapter.servicePreviewError(w.id, s.id, view.port) || t('service.previewUnconfirmed')), "warning", btn(t('service.checkPreview'), "check-preview", "small") + btn(t('service.openNewTab'), "open-app", "small")) : ""}<div class="service-bottom"><span>${icon("lock", 13)} ${t('service.privateConnection')} ${w.resourceChecked?.services ? ` · ${t('service.retrieved', { time: esc(formatTime(w.resourceChecked.services)) })}` : ""}</span><span class="domain" title="${esc(s.domain)}">${esc(s.domain)}</span></div>`;
}
function conversationHistoryControls(w, session) {
    const state = session.history;
    if (!state)
        return '';
    const error = state.error ? feedback(esc(state.error), 'warning', btn(state.expired ? t('chat.reloadRecent') : t('chat.retryHistory'), 'reload-history', 'small')) : '';
    const earlier = state.hasMore ? btn(state.loading ? pendingDots() + ' ' + t('chat.loadingEarlier') : t('chat.loadEarlier'), 'load-earlier-history', 'small quiet', `${state.loading || state.expired || !adapter.project(w).usable ? 'disabled' : ''} ${state.loading ? 'aria-busy="true"' : ''}`) : '';
    return `<div class="history-pagination">${earlier}${error}</div>`;
}
function agent(w, focus) {
    const historyNotice = adapter.historyNotice(w.id);
    const session = w.sessions.find((s) => s.id === view.session) || w.sessions[0];
    if (session) {
        if (!view.session && view.drafts[draftKey(w, "")] && !view.drafts[draftKey(w, session.id)]) {
            view.drafts[draftKey(w, session.id)] = view.drafts[draftKey(w, "")];
            textDraftRevisions.set(draftKey(w, session.id), textDraftRevisions.get(draftKey(w, "")) || 0);
        }
        const from = draftKey(w, ""), to = draftKey(w, session.id);
        if (imageDrafts.get(from).length && !imageDrafts.get(to).length && imageDraftErrors.has(from)) {
            imageDraftErrors.set(to, imageDraftErrors.get(from));
            imageDraftErrors.delete(from);
        }
        imageDrafts.move(from, to);
        view.session = session.id;
    }
    const supported = adapter.cancelAndSendCapabilities.get(w.id) === 1, observed = adapter.activeRuns.get(w.id);
    const observedRun = supported ? observed?.run : w.run;
    const activeRun = observedRun && ["accepted", "running", "cancelling"].includes(observedRun.status) ? observedRun : null;
    const active = !!activeRun;
    const busy = active && activeRun.sessionId !== session?.id;
    const activeUnconfirmed = supported && (!observed?.confirmed || !!observed.error);
    const checkingActive = !!observed?.visibleLoading;
    const draft = view.drafts[draftKey(w, session?.id || "")] || "";
    adapter.activateChat(w.id, session?.id || "");
    if (!adapter.imageCapabilities.has(w.id))
        queueMicrotask(() => { void adapter.loadImageCapabilities(w.id); });
    const modelReady = adapter.modelReady(w.id, session?.id || "");
    const agentError = w.resourceErrors?.agent !== adapter.models.get(w.id)?.error ? w.resourceErrors?.agent : '';
    const readingSessions = !w.resourceChecked?.agent && !agentError;
    const conversationError = session?.error || agentError;
    const readingConversation = !!w.resourceLoading?.agent || !!session?.loading;
    const initialConversation = !session?.messages.length && !conversationError && (readingSessions || !!session && !session.checkedAt);
    const draftImages = imageDrafts.get(draftKey(w, session?.id || ""));
    const imageWaiting = draftImages.length > 0 && (!w.resourceChecked?.agent || session?.loading && !session.checkedAt || draftImages.some(image => image.reading));
    const webDraft = !view.literalSlash && webCommands.includes(/^\/([^\s]+)/.exec(draft.trimStart())?.[1] || "");
    const stopAndSend = supported && active && !activeUnconfirmed && !webDraft;
    return `<section class="agent-panel ${focus ? "focused" : ""}"><div class="agent-header"><span class="agent-title">${icon("spark", 17)} <b>Agent</b>${view.layout !== "workspace" ? `<small title="${esc(w.name)}">${esc(w.name)}</small>` : ""}</span><div>${btn(readingConversation && !initialConversation ? pendingDots() : icon("clock", 16), "sessions", "icon-button quiet", `id="sessions-trigger" aria-label="${esc(t('agent.sessions'))}" title="${readingConversation ? esc(t('agent.readingConversations')) : esc(t('agent.sessions'))}" ${readingConversation ? 'aria-busy="true" data-read-busy="true"' : ''}`)}${agentLayoutControls(w)}${btn(icon("more", 17), "agent-menu", "icon-button quiet", `aria-label="${esc(t('agent.options'))}"`)}</div></div>${(view.layout === "chat-only" || view.layout === 'service-chat' && innerWidth < 900) && view.fullscreenError ? feedback(esc(view.fullscreenError), "warning") : ""}<div class="session-line"><button id="session-current-trigger" data-action="sessions" ${readingSessions && !session ? `aria-label="${esc(t('agent.loadingConversationsAria'))}" aria-busy="true"` : ''}>${readingSessions && !session ? esc(t('agent.loadingConversations')) : esc(sessionDisplayName(w, session))}${icon("down", 12)}</button></div>${historyNotice ? `<small class="muted history-compatibility" role="status">${esc(historyNotice)}</small>` : ''}<div class="messages" id="messages" data-reading-key="${esc(draftKey(w, session?.id || ""))}">${focus && unavailableServicesReason(w) ? feedback(esc(unavailableServicesReason(w)), 'info', btn(t('service.manage'), 'manage-services', 'small')) : ''}${conversationError ? readFailure(t('agent.conversationReadFailed'), conversationError, 'retry-conversation', readingConversation) : ''}${session ? conversationHistoryControls(w, session) : ''}${initialConversation ? readPlaceholder(t('agent.loadingConversation'), 'conversation') : !session?.messages.length && conversationError ? '' : !session?.messages.length ? `<div class="chat-welcome"><span class="chat-symbol">${icon("spark", 28)}</span><h2>${t('chat.welcomeTitle')}</h2><p>${t('chat.welcomeBody')}</p><button data-action="suggest-message">${t('chat.suggestBuild')} ${icon("chevron", 15)}</button><button data-action="suggest-files">${t('chat.suggestFiles')} ${icon("chevron", 15)}</button></div>` : messageMarkup(w, session.id, session.messages)}${session ? unmatchedExecutions(w, session.id, session.messages) : ""}${view.tab === "Chat" && view.layout === "workspace" && w.services.some(s => s.observed === "Ready" && s.ports.length) ? btn(`${icon("grid", 15)} ${t('chat.openService')}`, "tab-Services", "service-shortcut") : ""}</div>${view.scrollPinned ? "" : btn(`${icon("down", 14)} ${t('chat.backToLatest')}`, "scroll-bottom", "back-latest")}<div class="composer-wrap">${submissionMarkup(w)}${session?.legacy ? feedback(t('chat.legacyContext'), "warning", btn(t('chat.newSession'), "new-session", "small")) : ""}${activeUnconfirmed && !checkingActive ? feedback(esc(observed?.error || t('chat.statusUnconfirmed')), observed?.error ? "warning" : "info", btn(t('chat.checkStatus'), "check-active-run", "small")) : ""}${busy ? feedback(activeRun.source?.kind === "service" ? t('chat.runFromService', { name: esc(activeRun.source.serviceName || "") }) : t('chat.runOtherSession'), "warning", btn(t('chat.viewActiveRun'), "active-run", "small", `data-run-id="${esc(activeRun.id)}"`)) : ""}<div class="composer">${imageDraftMarkup(w, draftKey(w, session?.id || ""))}<textarea id="composer" rows="3" placeholder="${esc(t('chat.composerPlaceholder'))}" aria-label="${esc(t('chat.composerAria'))}" ${session?.legacy ? 'aria-describedby="composer-help"' : ""}>${esc(draft)}</textarea><div class="composer-bottom">${modelComposer(w, session?.id || "")}<div class="composer-actions">${btn(icon("upload", 16), "add-chat-images", "icon-button quiet", `title="${esc(t('chat.addImages'))}" aria-label="${esc(t('chat.addImages'))}"`)}${btn(icon("settings", 16), "chat-input-options", "icon-button quiet chat-input-options", `title="${esc(t('chat.inputOptions'))}" aria-label="${esc(t('chat.inputOptions'))}" aria-haspopup="dialog" aria-expanded="${view.modal === 'chat-input-options'}"`)}${btn(stopAndSend ? t('chat.stopAndSend') : checkingActive ? pendingDots() : icon("send", 18), "send-message", `send-button${stopAndSend ? " stop-and-send" : ""}${checkingActive ? " is-reading" : ""}`, `aria-label="${checkingActive ? esc(t('chat.checkingStatus')) : stopAndSend ? esc(t('chat.stopAndSend')) : esc(t('chat.sendMessage'))}" ${checkingActive ? `aria-busy="true" data-read-busy="true" title="${esc(t('chat.checkingStatusEllipsis'))}"` : ''} ${stopAndSend ? `data-cancel-run-id="${esc(activeRun.id)}"` : ""} ${!adapter.project(w).usable || imageWaiting || !webDraft && (activeUnconfirmed || active && !stopAndSend || session?.legacy || !modelReady) || webDraft && !!adapter.chatSubmissions.get(w.id) ? "disabled" : ""}`)}</div>${commandPalette(w, draft)}</div></div>${modelFeedback(w, session?.id || "")}<div class="composer-caption" id="composer-help">${draft.trimStart().startsWith("/") ? btn(view.literalSlash ? t('chat.commandMode') : t('chat.sendAsText'), "toggle-slash-mode", "text-button", `aria-pressed="${view.literalSlash}"`) : ""}${draft.trimStart().startsWith("/") && !view.literalSlash ? t('chat.commandHint') : t('chat.enterHint')}</div></div></section>`;
}
function modelComposer(w, sessionId) {
    const { name, thinking, state, initialLoading } = chatSettings(w, sessionId);
    if (initialLoading)
        return btn(view.modal === 'chat-response-settings' ? t('chat.loadingResponseSettings') : pendingStatus(t('chat.loadingResponseSettings')), 'open-chat-settings', 'quiet response-settings-trigger', `id="response-settings-trigger" aria-label="${esc(t('chat.loadingResponseSettingsAria'))}" aria-busy="true" aria-haspopup="dialog"`);
    return btn(`<span class="response-model-name">${esc(name)}</span><span class="response-thinking">· ${esc(thinking)}</span>${icon('down', 12)}`, 'open-chat-settings', 'quiet response-settings-trigger', `id="response-settings-trigger" title="${state.ref === null ? esc(t('chat.titleWithDefault', { name, thinking })) : esc(t('chat.title', { name, thinking }))}" aria-label="${sessionId ? esc(t('chat.settingsAria', { name, thinking })) : esc(t('chat.settingsAriaNewSession', { name, thinking }))}" aria-haspopup="dialog"`);
}
function sessionDisplayName(w, session) {
    if (!session)
        return w.resourceErrors?.agent ? t('chat.sessionsUnavailable') : !w.resourceChecked?.agent ? t('agent.loadingConversations') : t('chat.noSessionYet');
    return session.title === `Session ${session.id}` ? t('chat.sessionNumber', { index: w.sessions.indexOf(session) + 1 }) : session.title; // i18n-exempt: generated server session title, compared not displayed
}
function modelDisplayName(model) {
    if (!model)
        return t('model.unavailable');
    return /^Runtime(?: model)? revision\b/i.test(model.label || '') ? model.model || t('model.workModel') : model.label || model.model || t('model.workModel');
}
function capturedDefaultName(model) {
    const label = modelDisplayName(model);
    return model.model && label !== model.model ? `${label} (${model.model})` : label;
}
function thinkingName(level) { if (level === null)
    return t('thinking.normal'); if (!level)
    return t('thinking.unavailable'); const keys = { off: 'thinking.off', low: 'thinking.low', medium: 'thinking.medium', high: 'thinking.high' }; return keys[level] ? t(keys[level]) : level[0].toUpperCase() + level.slice(1); }
function chatSettings(w, sessionId) {
    const catalog = adapter.models.get(w.id), state = adapter.modelSelection(w.id, sessionId), session = w.sessions.find(s => s.id === sessionId);
    const model = state.ref === null ? catalog?.defaultModel : catalog?.models.find(m => m.modelRef === state.ref);
    if (!catalog?.confirmed && !catalog?.error && (catalog?.loading || !w.resourceChecked?.agent) && state.phase === 'clean')
        return { catalog, state, model, name: t('model.loadingModels'), thinking: t('thinking.loading'), editable: false, thinkingEditable: false, status: t('model.loadingModels'), initialLoading: true, recovery: undefined };
    const name = model ? (state.ref === null ? capturedDefaultName(model) : modelDisplayName(model)) : session?.modelPreference?.modelRef === state.ref ? (state.ref === null && session.modelPreference ? capturedDefaultName(session.modelPreference) : modelDisplayName(session.modelPreference)) : state.ref === null ? t('chat.workDefault') : t('model.unavailable');
    const capability = adapter.chatCapabilities.get(w.id), levels = model?.thinkingLevels;
    const canThink = (capability ?? 0) >= 1 && (!!levels?.length || model?.thinkingAvailability === 'unknown');
    const thinking = capability === 0 ? t('thinking.unavailable') : model?.thinkingAvailability === 'unknown' ? (state.thinking === null ? t('thinking.normalUnconfirmed') : t('thinking.confirmNormal')) : canThink ? thinkingName(state.thinking) : t('thinking.unconfirmed');
    const editable = state.phase !== 'unknown' && !!catalog?.confirmed && !catalog.error;
    const thinkingEditable = editable && canThink && !(levels?.length === 1 && levels[0] === state.thinking);
    const status = [];
    if (state.phase === 'saving')
        status.push(t('chat.saving'));
    else if (state.phase === 'unknown')
        status.push(t('chat.unconfirmedSentence'));
    else if (state.phase === 'dirty' && sessionId)
        status.push(t('chat.notSaved'));
    if (state.error && state.phase !== 'clean')
        status.push(state.error);
    if (catalog?.loading)
        status.push(t('model.loadingModels'));
    if (catalog?.error)
        status.push(`${t('model.unconfirmedWithError')} ${catalog.error}`);
    else if (catalog?.confirmed && !catalog.defaultModel && !catalog.models.length)
        status.push(catalog.defaultUnavailableReason || t('model.noneAvailable'));
    else if (catalog?.confirmed && !catalog.defaultModel && state.ref === null)
        status.push(catalog.defaultUnavailableReason || t('model.defaultUnavailable'));
    else if (!catalog?.confirmed && !catalog?.loading)
        status.push(t('model.unconfirmed'));
    if (!catalog?.confirmed || catalog.error)
        status.push(t('model.lastKnown'));
    else if (!model || session?.modelPreference?.availability === 'unavailable')
        status.push(t('model.savedUnavailable'));
    if (capability === 0)
        status.push(t('thinking.unavailableInWork'));
    else if (catalog?.confirmed && !catalog.error && !canThink)
        status.push(t('thinking.capabilitiesUnconfirmed'));
    else if (levels?.length === 1 && levels[0] === 'off')
        status.push(t('thinking.notSupported'));
    if (capability === 1)
        status.push(t('model.legacySettings'));
    if (!sessionId)
        status.push(t('chat.forNewSession'));
    const recovery = state.phase === 'unknown' ? { label: t('chat.checkChatSettings'), action: 'check-session-model' } : !catalog?.loading && (catalog?.error || !catalog?.confirmed) ? { label: t('model.retryModels'), action: 'load-models' } : state.phase === 'dirty' && sessionId ? { label: t('chat.retrySettings'), action: 'save-model' } : undefined;
    return { catalog, state, model, name, thinking, editable, thinkingEditable, status: status.join(' '), recovery };
}
function modelFeedback(w, sessionId, inPanel = false) {
    const { status, recovery, catalog, state, initialLoading } = chatSettings(w, sessionId);
    const busy = state.phase === 'saving' || !!catalog?.loading;
    if (initialLoading && !inPanel)
        return '';
    const live = inPanel || view.modal !== 'chat-response-settings';
    const compatibility = inPanel && !catalog?.error ? (catalog?.unavailableModels ?? []).map(model => `<p>${esc(model.label)}: ${esc(model.recovery)}</p>`).join('') : '';
    return `<div class="options-status" ${inPanel ? 'id="response-settings-status"' : ''} ${live ? 'role="status"' : ''}>${busy && live ? pendingStatus(status, 'load-models save-model check-session-model') : esc(status)}${recovery ? btn(recovery.label, recovery.action, 'text-button') : ''}${compatibility}</div>`;
}
function chatSettingsContextCurrent() {
    const r = route();
    return view.modal === 'chat-response-settings' && view.data.epoch === String(adapter.identityEpoch) && r[0] === 'work' && r[1] === view.data.workId && view.session === view.data.sessionId && view.tab === view.data.tab && view.layout !== 'service-only';
}
function focusChatSettings(kind) {
    const dialog = root.querySelector('#modal');
    if (!dialog)
        return;
    const row = dialog.querySelector(kind === 'thinking' ? '#thinking-select' : '#model-select');
    const option = view.data.expanded ? (dialog.querySelector('[role=option][aria-selected=true]:not([disabled])') || dialog.querySelector('[role=option]:not([disabled])')) : null;
    const recovery = dialog.querySelector('.options-status .button:not([disabled]),.modal-footer .button');
    (option || (row && !row.disabled ? row : recovery))?.focus({ preventScroll: true });
}
function openChatPicker(kind) {
    const work = current();
    if (!work)
        return;
    const composer = root.querySelector('#composer');
    view.commandDismissed = view.drafts[draftKey(work)] || '';
    focusReturn = kind ? '#composer' : '#response-settings-trigger';
    openModal('chat-response-settings', { workId: work.id, sessionId: view.session, epoch: String(adapter.identityEpoch), tab: view.tab, source: kind ? 'command' : 'summary', expanded: kind || '', caretStart: String(composer?.selectionStart ?? 0), caretEnd: String(composer?.selectionEnd ?? 0) });
    focusChatSettings(kind);
}
function confirmPendingChatCommand() {
    const command = pendingWebCommand;
    if (!command?.pair || !command.workId || !['model', 'thinking'].includes(command.kind))
        return;
    const state = adapter.modelSelection(command.workId, command.sessionId || '');
    if ((state.phase === 'clean' || !command.sessionId && state.phase === 'dirty') && state.ref === command.pair.ref && state.thinking === command.pair.thinking)
        consumeWebSelection(command.kind);
}
function submissionMarkup(w) {
    const intent = adapter.chatSubmissions.get(w.id);
    return intent ? feedback(`${esc(intent.error || (intent.cancelRunId ? t('chat.stoppingPreviousRun') : t('chat.waitingAcceptance')))}<details class="chat-submission-details"><summary>${t('chat.submissionDetails')}</summary><p>${t('chat.submissionOriginalKey', { kind: esc(intent.kind) })} <code>${esc(intent.key)}</code></p></details>`, 'warning', btn(t('chat.checkOriginalSubmission'), 'check-chat-submission', 'small')) : '';
}
function layoutButton(symbol, label, action, extra = '') {
    return btn(icon(symbol, 16), action, 'icon-button quiet', `title="${esc(label)}" aria-label="${esc(label)}" ${extra}`);
}
function focusControls(w, showError = true) {
    const standalone = route()[0] === 'app', focused = view.layout !== 'workspace', chat = view.layout === 'chat-only';
    const service = activeService(w);
    const available = !!service && service.observed === 'Ready' && !!adapter.serviceEntryUrl(w.id, service.id, view.port) && adapter.serviceEmbed(w.id, service.id, view.port) !== 'denied';
    return focused ? `${chat ? layoutButton('arrow', t('focus.restoreLayout'), 'restore-layout') : !standalone ? layoutButton('panel-right', view.layout === 'service-chat' ? t('focus.hideChat') : t('focus.showChat'), 'focus-toggle-chat', `aria-pressed="${view.layout === 'service-chat'}"`) : ''}${layoutButton('close', t('focus.exitFocus'), 'exit-service-focus')}${view.layout === 'service-only' && w.run ? `<small class="focus-run-status">${t(w.run.error ? 'focus.runNeedsAttention' : 'focus.runStatus', { status: esc(stateText(w.run.status)) })}</small>` : ''}${showError && view.fullscreenError ? `<small class="fullscreen-error" role="status">${esc(view.fullscreenError)}</small>` : ''}` : layoutButton('focus', t('focus.focus'), 'service-focus', `aria-pressed="false" ${available ? '' : 'disabled'}`);
}
function browserFullscreenAction() {
    if (view.layout === 'workspace' && document.fullscreenElement !== root)
        return '';
    const full = document.fullscreenElement === root, label = full ? t('focus.exitFullscreen') : t('focus.browserFullscreen');
    return btn(`${icon('focus', 16)} ${label}`, 'service-fullscreen', '', `title="${label}" aria-label="${label}" aria-pressed="${full}"`);
}
function agentLayoutControls(w) {
    if (view.layout === 'chat-only')
        return focusControls(w, false);
    return `${view.layout === 'service-chat' && innerWidth < 900 ? focusControls(w, false) : ''}${layoutButton('focus', t('focus.focusChat'), 'focus-chat', 'aria-pressed="false"')}`;
}
function captureLayoutReturn(anchor) {
    return { workId: current()?.id || '', tab: view.tab, layout: view.layout === 'chat-only' ? 'workspace' : view.layout, anchor, selector: focusKey(anchor) };
}
function resetWorkspaceFocus() {
    view.layout = 'workspace';
    workspaceReturn = undefined;
    chatReturn = undefined;
    view.fullscreenError = '';
}
function restoreLayoutFocus(target) {
    const candidate = target?.anchor?.isConnected ? target.anchor : target?.selector ? root.querySelector(target.selector) : null;
    const visible = (node) => node && !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
    if (visible(candidate))
        candidate.focus({ preventScroll: true });
    else
        [...root.querySelectorAll('[data-action=restore-layout],[data-action=exit-service-focus],[data-action=focus-chat],[data-action=service-focus],[data-action^=tab-]')].find(visible)?.focus({ preventScroll: true });
}
function enterWorkspaceFocus(mode, anchor) {
    if (view.layout === mode) {
        closeModal();
        return;
    }
    areaChoice++;
    if (!workspaceReturn)
        workspaceReturn = captureLayoutReturn(anchor);
    if (mode === 'chat-only' && view.layout !== 'chat-only')
        chatReturn = captureLayoutReturn(anchor);
    view.layout = mode;
    closeModal();
    render();
    restoreLayoutFocus();
}
function restoreChatLayout() {
    if (view.layout !== 'chat-only')
        return;
    const target = chatReturn;
    view.layout = target?.layout || 'workspace';
    chatReturn = undefined;
    if (view.layout === 'workspace') {
        workspaceReturn = undefined;
        view.fullscreenError = '';
    }
    render();
    restoreLayoutFocus(target);
}
async function exitWorkspaceFocus() {
    if (view.layout === 'workspace' && document.fullscreenElement !== root)
        return true;
    const epoch = adapter.identityEpoch, origin = location.hash, choice = areaChoice, target = workspaceReturn;
    const valid = () => epoch === adapter.identityEpoch && origin === location.hash && choice === areaChoice && target === workspaceReturn;
    if (document.fullscreenElement === root) {
        try {
            await document.exitFullscreen();
            if (!valid())
                return false;
            if (document.fullscreenElement === root)
                throw new Error();
        }
        catch {
            if (valid()) {
                view.fullscreenError = t('focus.fullscreenCloseFailed');
                render();
            }
            return false;
        }
    }
    if (!valid())
        return false;
    if (target)
        view.tab = target.tab;
    resetWorkspaceFocus();
    render();
    restoreLayoutFocus(target);
    return true;
}
function isRequestInspector() { return ['pi-requests', 'pi-request-detail'].includes(view.modal); }
function nonmodalDialog() { return overlayRole(view.modal) !== 'modal' || view.modal === 'export' || isRequestInspector() && innerWidth >= 900; }
function backToRequests() {
    if (!requestNavigationCurrent())
        return;
    const nav = requestNavigation;
    modalChoice++;
    view.modal = 'pi-requests';
    view.data = { source: nav.source, serviceName: nav.serviceName };
    view.modalError = '';
    render();
    const body = root.querySelector('.modal-body');
    if (body)
        body.scrollTop = nav.scroll;
    if (nav.focus)
        root.querySelector(nav.focus)?.focus({ preventScroll: true });
}
function requestStateLabel(state) {
    const keys = { pending: 'request.pending', running: 'request.running', waiting_result: 'request.waitingResult', waiting_apply: 'request.waitingApply', needs_attention: 'request.needsAttention', completed: 'request.completed', cancelled: 'request.cancelled', cancelling: 'request.cancelling', failed: 'request.failed' };
    return keys[state] ? t(keys[state]) : state;
}
function activityBusy(w, sessionId, messages) {
    const observed = adapter.activeRuns.get(w.id);
    const liveRun = w.run?.sessionId === sessionId ? w.run : observed?.confirmed && !observed.error && observed.run?.sessionId === sessionId ? observed.run : undefined;
    return !!liveRun && !liveRun.error && ['accepted', 'running', 'cancelling'].includes(liveRun.status) && messages.some(message => message.runId === liveRun.id && message.tool?.status === 'Running');
}
function executionMarkup(w, sessionId, runId) {
    const observed = adapter.activeRuns.get(w.id), activeObserved = observed?.confirmed && observed.run?.id === runId ? observed.run : undefined;
    const run = (w.run?.id === runId ? w.run : undefined) || activeObserved || w.sessions.find(session => session.id === sessionId)?.runs?.find(item => item.id === runId) || adapter.runDetails.get(`${w.id}:${runId}`);
    const active = adapter.cancelAndSendCapabilities.get(w.id) === 1 ? observed?.confirmed && !observed.error ? observed.run : undefined : w.run;
    const cancellable = active?.id === runId && ['accepted', 'running', 'cancelling'].includes(active.status);
    const running = !!run && !run.error && (w.run?.id === runId || !observed?.error && activeObserved?.id === runId) && ['accepted', 'running', 'cancelling'].includes(run.status);
    const activityRunning = activityBusy(w, sessionId, w.sessions.find(session => session.id === sessionId)?.messages.filter(message => message.runId === runId) ?? []);
    return `<div class="message-execution" data-message-key="${esc(`${adapter.identityEpoch}:${w.id}:${sessionId}:execution:${runId}`)}"><div class="execution-summary">${run ? running && !activityRunning ? pendingStatus(t('execution.runStatus', { status: stateText(run.status) })) : badge(t('execution.runStatus', { status: stateText(run.status) })) : `<span>${t('execution.execution')}</span>`}${btn(t('common.details'), 'run-details', 'text-button', `data-run-id="${esc(runId)}" aria-label="${esc(t('execution.runDetails'))}"`)}${cancellable ? btn(active.cancellationRequested || active.status === 'cancelling' ? t('execution.cancelling') : t('execution.cancelRun'), 'cancel-run', 'text-button', `data-run-id="${esc(runId)}" ${active.cancellationRequested || active.status === 'cancelling' ? 'disabled' : ''}`) : ''}</div>${run?.error ? feedback(esc(run.error), 'warning') : ''}${modelFailureHelp(run)}${run && run.id === w.run?.id && ['interrupted', 'accepted', 'running', 'cancelling'].includes(run.status) && (run.error || run.status === 'interrupted') ? btn(t('execution.resume'), 'resume-run', 'text-button', `data-run-id="${esc(runId)}"`) : ''}</div>`;
}
function modelFailureHelp(run) {
    if (!run || !['MODEL_AUTHENTICATION_FAILED', 'MODEL_PERMISSION_DENIED'].includes(run.errorCode ?? ''))
        return '';
    if (adapter.state.core.role !== 'admin')
        return `<p class="muted">${t('merge.askAdmin')}</p>`;
    return adapter.hosted ? `<p class="muted">${t('merge.hostedAdminBefore')} <a href="/admin">${t('merge.admin')}</a>${t('merge.hostedAdminAfter')}</p>` : `<p class="muted">${t('merge.localAdmin')}</p>`;
}
function unmatchedExecutions(w, sessionId, messages) {
    const bound = new Set(messages.map(message => message.runId).filter(Boolean));
    const runs = [...(w.sessions.find(session => session.id === sessionId)?.runs || [])];
    if (w.run?.sessionId === sessionId && !runs.some(run => run.id === w.run.id))
        runs.push(w.run);
    const active = adapter.activeRuns.get(w.id);
    if (active?.confirmed && active.run?.sessionId === sessionId && !runs.some(run => run.id === active.run.id))
        runs.push(active.run);
    const missing = runs.filter(run => !bound.has(run.id));
    if (!missing.length)
        return '';
    const current = missing.filter(run => run.error || ['accepted', 'running', 'cancelling', 'failed', 'interrupted'].includes(run.status)), history = missing.filter(run => !current.includes(run));
    return `<div class="unmatched-executions">${current.map(run => executionMarkup(w, sessionId, run.id)).join('')}${history.length ? `<details><summary>${t('execution.sessionExecutions', { count: history.length })}</summary>${history.map(run => executionMarkup(w, sessionId, run.id)).join('')}</details>` : ''}</div>`;
}
function workspaceChatToggle(w) {
    if (route()[0] === 'app' || view.layout !== 'workspace' || view.tab !== 'Services')
        return '';
    const panels = workspacePanels.get(w.id), hidden = innerWidth < 900 ? !panels.narrowChat : panels.collapsed;
    return layoutButton('panel-right', hidden ? t('focus.showChat') : t('focus.hideChat'), 'toggle-workspace-chat', `aria-expanded="${!hidden}" aria-controls="workspace-chat"`);
}
let preserveChatReading = false;
function rememberChatPosition() {
    const messages = root.querySelector('#messages');
    if (!messages?.clientHeight || !messages.dataset.readingKey)
        return;
    const first = !view.scrollPinned ? [...messages.querySelectorAll('[data-message-key]')].find(node => node.getBoundingClientRect().bottom > messages.getBoundingClientRect().top) : undefined;
    chatReading.set(messages.dataset.readingKey, { scroll: messages.scrollTop, pinned: view.scrollPinned, anchor: first ? { key: first.dataset.messageKey, offset: first.getBoundingClientRect().top - messages.getBoundingClientRect().top } : undefined });
}
function restoreChatPosition() {
    const messages = root.querySelector('#messages');
    if (!messages?.clientHeight)
        return;
    const saved = chatReading.get(messages.dataset.readingKey || '');
    if (!saved)
        return;
    messages.scrollTop = saved.pinned ? messages.scrollHeight : saved.scroll;
    if (!saved.pinned && saved.anchor) {
        const anchor = [...messages.querySelectorAll('[data-message-key]')].find(node => node.dataset.messageKey === saved.anchor.key);
        if (anchor)
            messages.scrollTop += anchor.getBoundingClientRect().top - messages.getBoundingClientRect().top - saved.anchor.offset;
    }
}
function applyWorkspaceSizing() {
    const layout = root.querySelector('.service-workspace'), separator = root.querySelector('#workspace-splitter'), work = current();
    if (!layout || !separator || !work)
        return;
    const geometry = splitGeometry(layout.clientWidth, workspacePanels.get(work.id).ratio);
    layout.style.setProperty('--service-size', `${geometry.service}px`);
    separator.setAttribute('aria-valuenow', String(Math.round(geometry.ratio * 100)));
    separator.setAttribute('aria-valuemin', String(Math.round(geometry.minimum / geometry.available * 100)));
    separator.setAttribute('aria-valuemax', String(Math.round(geometry.maximum / geometry.available * 100)));
    separator.setAttribute('aria-valuetext', t('work.splitValue', { service: Math.round(geometry.ratio * 100), chat: 100 - Math.round(geometry.ratio * 100) }));
}
/** Presentation for internal tool status identifiers; comparisons keep the raw values. */
function toolStatusText(status) {
    return status === 'Result not confirmed' ? t('activity.resultUnconfirmed') // i18n-exempt: internal tool status identifier
        : status === 'Running' ? t('activity.running')
            : status === 'Completed' ? t('activity.completed')
                : status === 'Failed' ? t('activity.statusFailed')
                    : status || '';
}
function messageMarkup(w, sessionId, messages) {
    const groups = activityGroups(messages), anchors = executionAnchors(groups);
    return groups.map((group, index) => {
        const execution = (anchors.get(index) || []).map(id => executionMarkup(w, sessionId, id)).join('');
        const key = `${adapter.identityEpoch}:${w.id}:${sessionId}:${group.key}`;
        if (group.activity) {
            const running = group.messages.some(m => m.tool?.status === 'Running'), failures = group.messages.filter(m => m.tool?.status === 'Failed'), unknown = group.messages.some(m => m.tool?.status?.includes('confirmed'));
            const busy = activityBusy(w, sessionId, group.messages);
            const activityState = failures.length ? t('activity.needsAttention') : running ? t('activity.running') : unknown ? t('activity.resultUnconfirmed') : t('activity.completed');
            const activitySummary = t(group.messages.length === 1 ? 'activity.summaryOne' : 'activity.summaryMany', { count: group.messages.length, state: activityState }) + (busy && failures.length ? t('activity.stillRunning') : '');
            return `<details class="activity" data-message-key="${esc(key)}" data-activity-key="${esc(key)}" ${expandedActivity.get(key) ? 'open' : ''} aria-busy="${busy}"><summary>${busy ? pendingDots() : icon('terminal', 14)} ${activitySummary}${failures.length ? `${t('activity.failedCount', { count: failures.length })}<small class="activity-error">${esc(failures[0]?.tool?.content?.slice(0, 160) || t('activity.toolFailed'))}</small>` : ''}</summary>${group.messages.map(m => `<details class="tool-event" data-message-key="${esc(`${key}:${m.tool?.id || m.id}`)}" data-activity-key="${esc(`${key}:${m.tool?.id || m.id}`)}" ${expandedActivity.get(`${key}:${m.tool?.id || m.id}`) ? "open" : ""}><summary>${esc(m.tool?.name)} · ${esc(toolStatusText(m.tool?.status))}</summary>${m.historyIncomplete ? `<small class="history-partial">${t('activity.partialResult')}</small>` : ''}<pre>${esc(m.tool?.content)}</pre></details>`).join('')}</details>${execution}`;
        }
        return group.messages.map(m => `<div class="message ${m.role}" data-message-key="${esc(key)}">${m.role === 'assistant' ? `<div class="message-author">${icon('spark', 14)} piwork</div>` : ''}<div class="message-text${m.role === 'assistant' ? ' chat-markdown' : ''}">${m.historyIncomplete ? `<small class="history-partial">${t('chat.partialMessage')}</small>` : ''}${m.role === 'assistant' && !m.historyIncomplete ? renderChatMarkdown(m.text, { workId: w.id }) : esc(m.text)}</div>${m.images?.length ? `<div class="chat-message-images">${m.images.map(image => historyImageMarkup(w, sessionId, m.runId, image)).join('')}</div>` : ''}${m.source ? `<button class="source-chip" data-action="open-source" data-path="${esc(m.source)}">${fileReadPending(m.source) ? pendingDots() : icon('file', 13)} ${esc(m.source)}</button>` : ''}</div>`).join('') + execution;
    }).join('');
}
const webCommands = ['new', 'resume', 'model', 'thinking', 'settings'];
function paletteToken(draft) { const match = /^(\s*)\/([^\s]*)/.exec(draft); return match && view.commandCaret >= match[1].length + 1 && view.commandCaret <= match[0].length ? match[2] : undefined; }
function commandChoices(w, draft) {
    if (view.literalSlash || view.commandDismissed === draft || paletteToken(draft) === undefined)
        return [];
    const query = paletteToken(draft).toLowerCase();
    const directory = adapter.commands.get(w.id);
    return [...webCommands.map(name => ({ command: `/${name}`, kind: 'web', description: { new: t('command.new'), resume: t('command.resume'), model: t('command.model'), thinking: t('command.thinking'), settings: t('command.settings') }[name] || '', sourceName: 'Desktop' })), ...(directory?.confirmed && !directory.error ? directory.items : [])].filter(command => command.command.slice(1).toLowerCase().includes(query)).slice(0, 30);
}
function commandPalette(w, draft) {
    const items = commandChoices(w, draft);
    if (view.literalSlash || view.commandDismissed === draft || paletteToken(draft) === undefined)
        return '';
    if (!adapter.commands.has(w.id) && adapter.chatCapabilities.has(w.id))
        queueMicrotask(() => { if (!adapter.commands.has(w.id))
            void adapter.loadCommands(w.id); });
    view.commandIndex = Math.min(view.commandIndex, Math.max(0, items.length - 1));
    const directory = adapter.commands.get(w.id);
    return `<div class="command-palette menu-list" role="listbox" aria-label="${esc(t('command.paletteAria'))}">${items.map((command, index) => `${index === 0 || items[index - 1]?.kind !== command.kind ? `<small>${esc(command.kind === 'web' ? t('command.groupWorkspace') : command.kind === 'skill' ? t('command.groupSkills') : t('command.groupTemplates'))}</small>` : ''}<button class="button" data-action="choose-command" data-command="${esc(command.command)}" role="option" aria-selected="${index === view.commandIndex}"><strong>${esc(command.command)}</strong><span>${esc(command.description)}</span><small>${esc(command.sourceName)}</small></button>`).join('')}${directory?.loading ? pendingStatus(t('command.loading'), 'load-commands') : directory?.error ? `<p role="status">${esc(directory.error)} ${btn(t('common.retry'), 'load-commands', 'text-button')}</p>` : directory?.confirmed && !directory.items.length ? `<p>${t('command.none')}</p>` : ''}${!items.length ? `<p>${t('command.noMatch')}</p>` : ''}</div>`;
}
function fillCommand(command) {
    const work = current();
    if (!work)
        return;
    const key = draftKey(work), draft = view.drafts[key] || '';
    textDraftRevisions.set(key, (textDraftRevisions.get(key) || 0) + 1);
    view.drafts[key] = draft.replace(/^(\s*)\/[^\s]*/, `$1${command}`) + (/\s/.test(draft.trimStart()) ? '' : ' ');
    view.commandIndex = 0;
    render();
    const input = root.querySelector('#composer');
    if (input) {
        input.value = view.drafts[key];
        input.focus();
        const position = (/^\s*\/[^\s]*/.exec(input.value)?.[0].length ?? input.value.length) + 1;
        view.commandCaret = Math.min(position, input.value.length);
        input.setSelectionRange(view.commandCaret, view.commandCaret);
    }
}
function fileReadPending(path) {
    return [...actions.records.values()].some(record => record.pending && record.work === current()?.id && record.view === location.hash && ['open-file', 'open-source', 'retry-file-preview'].includes(record.action || '') && record.resource === path);
}
function fileRefreshButton(w, idleLabel = t('files.refresh')) {
    const record = [...actions.records.values()].filter(item => ['refresh-files', 'file-path'].includes(item.action || '') && item.work === w.id && (item.resource === (view.file || view.path) || item.origin === (view.file || view.path)) && item.view === location.hash).sort((a, b) => b.token - a.token)[0];
    const pending = !!record?.pending || !!adapter.directories.get(`${w.id}:${view.path}`)?.loading;
    const label = pending ? (record && Date.now() - record.started >= 10000 ? t('files.stillReading') : t('files.reading')) : idleLabel;
    return btn(pending && !!adapter.directories.get(`${w.id}:${view.path}`)?.checkedAt ? pendingDots() : icon('refresh', 16), 'refresh-files', `icon-button quiet file-refresh ${pending ? 'is-reading' : ''}`, `aria-label="${label}" title="${label}" ${pending ? 'aria-disabled="true" aria-busy="true" data-read-busy="true"' : ''}`);
}
function files(w) {
    if (view.file)
        return fileTarget(w);
    const directory = adapter.directories.get(`${w.id}:${view.path}`);
    const filesError = directory?.error || (!directory && view.path === '/' ? w.resourceErrors?.files : '') || (adapter.state.scenario === 'files-failed' ? t('files.capabilityUnreachable') : '');
    const initialRead = !directory?.checkedAt && !filesError;
    const list = w.files.filter((x) => {
        const parent = x.path.slice(0, x.path.lastIndexOf("/")) || "/";
        return parent === view.path;
    });
    const toolbarActions = view.selected.length
        ? `<span class="selection-count" role="status">${t('files.selectedCount', { count: view.selected.length })}</span>${btn(icon("copy", 16), "file-copy", "icon-button quiet", `aria-label="${esc(t('files.copySelected'))}" title="${esc(t('files.copySelected'))}"`)}${btn(icon("move", 16), "file-move", "icon-button quiet", `aria-label="${esc(t('files.moveSelected'))}" title="${esc(t('files.moveSelected'))}"`)}${btn(icon("trash", 16), "file-delete", "icon-button quiet danger", `aria-label="${esc(t('files.deleteSelected'))}" title="${esc(t('files.deleteSelected'))}"`)}${btn(icon("close", 16), "clear-selection", "icon-button quiet", `aria-label="${esc(t('files.clearSelection'))}" title="${esc(t('files.clearSelection'))}"`)}`
        : `${fileRefreshButton(w)}<div class="file-add-anchor">${btn(icon('more', 16), 'file-add', 'icon-button quiet', `id="file-add-trigger" aria-label="${esc(t('files.moreActions'))}" title="${esc(t('files.moreActions'))}" aria-haspopup="menu" aria-expanded="${!!fileActionsContext}" aria-controls="file-actions"`)}${fileActionsContext ? `<div id="file-actions" class="file-actions-menu" role="menu" aria-label="${esc(t('files.actionsMenu'))}">${btn(`${icon('upload', 16)} ${t('files.upload')}`, 'upload', '', 'role="menuitem" tabindex="-1"')}${btn(`${icon('folder', 16)} ${t('files.newFolder')}`, 'new-folder', '', 'role="menuitem" tabindex="-1"')}<div class="file-actions-separator" role="separator"></div>${btn(`${icon('external', 16)} ${t('files.connectWebdav')}`, 'webdav', '', 'role="menuitem" tabindex="-1"')}</div>` : ''}</div>`;
    return `${filesRestoreNotice ? feedback(esc(filesRestoreNotice), "warning") : ""}${filesError ? readFailure(t('files.couldNotRead', { path: view.path }), filesError, "refresh-files", !!directory?.loading) : ""}${uploadProgressMarkup()}<div class="files-toolbar"><div class="breadcrumbs"><button data-action="file-path" data-path="/">${icon("folder", 16)} ${t('files.workspace')}</button>${view.path
        .split("/")
        .filter(Boolean)
        .map((p, i, a) => `${icon("chevron", 12)}<button data-action="file-path" data-path="/${esc(a.slice(0, i + 1).join("/"))}">${esc(p)}</button>`)
        .join("")}</div><div class="actions file-toolbar-actions">${toolbarActions}</div></div>${initialRead ? readPlaceholder(t('files.loadingPath', { path: view.path })) : !directory?.checkedAt && filesError ? '' : list.length ? `<div class="file-table"><div class="file-head"><span></span><span>${t('files.colName')}</span><span>${t('files.colSize')}</span><span>${t('files.colModified')}</span><span></span></div>${list.map((f) => `<div class="file-row"><label class="file-select-hit"><input type="checkbox" aria-label="${esc(t('files.selectName', { name: f.name }))}" data-file-select="${esc(f.path)}" ${view.selected.includes(f.path) ? "checked" : ""}></label><button class="file-name" data-action="open-file" data-path="${esc(f.path)}">${fileReadPending(f.path) ? pendingDots() : icon(f.kind === "directory" ? "folder" : f.kind === "special" ? "terminal" : "file", 19)}<span>${esc(f.name)}<small>${f.kind === "special" ? t('files.kindSpecial') : f.kind === "directory" ? t('files.kindFolder') : f.preview?.kind === "text" ? t('files.kindText') : f.preview?.kind === "image" ? t('files.kindImage') : f.preview?.kind === "download-only" ? t('files.kindDownloadOnly') : t('files.kindFile')}</small></span></button><span>${f.kind === "directory" || f.kind === "special" ? "—" : size(f.size)}</span><span>${esc(f.modified)}</span>${btn(icon("more"), "file-menu", "icon-button quiet", `data-path="${esc(f.path)}" aria-label="${esc(t('files.actionsFor', { name: f.name }))}"`)}</div>`).join("")}</div>` : empty("folder", t('files.emptyTitle'), t('files.emptyBody'), btn(t('files.upload'), "upload", "primary"))}${transferResults()}`;
}
function fileTargetBackLink() {
    return btn(`${icon("arrow", 16)} ${t('files.backToFiles')}`, "close-file", "quiet small");
}
function fileTarget(w) {
    const path = view.file, f = w.files.find(item => item.path === path);
    const name = f?.name || path.slice(path.lastIndexOf('/') + 1) || path;
    const source = fileSourceReturn && fileSourceReturn.epoch === adapter.identityEpoch && fileSourceReturn.workId === w.id
        && fileSourceReturn.path === path && fileSourceReturn.modal === 'pi-request-detail';
    const toolbar = `<div class="files-toolbar file-target-toolbar"><div class="file-target-heading"><strong>${esc(name)}</strong><span class="mono muted">${esc(path)}</span></div><div class="actions file-toolbar-actions">${fileRefreshButton(w, t('files.refreshFile'))}${source ? btn(`${icon("arrow", 16)} ${t('files.backToRequest')}`, "back-to-file-source", "quiet small") : ''}${fileTargetBackLink()}</div></div>`;
    const retry = `${btn(t('common.retry'), "retry-file-preview", "small")}${btn(t('files.backToFiles'), "close-file", "primary")}`;
    if (view.fileStatus === 'loading' || !f && view.fileStatus === 'idle')
        return `${toolbar}${readPlaceholder(t('files.readingName', { name }), 'file')}`;
    if (view.fileStatus === 'missing')
        return `${toolbar}${dirty() ? feedback(t('files.unsavedDraftKept'), 'warning') : ''}${empty("file", t('files.notFound'), t('files.notInWorkspaceMaybeMoved', { path: esc(path) }), retry)}`;
    if (view.fileStatus === 'unavailable')
        return `${toolbar}${feedback(esc(view.fileError || t('files.cannotOpenNow')), 'warning', retry)}`;
    if (view.fileStatus === 'error')
        return `${toolbar}${feedback(esc(view.fileError || t('files.couldNotReadFile')), 'warning', retry)}`;
    if (!f)
        return `${toolbar}${empty("file", t('files.notFound'), t('files.notInWorkspace', { path: esc(path) }), retry)}`;
    if (f.kind === 'special')
        return `${toolbar}${empty("terminal", t('files.specialTitle'), t('files.specialBody'), fileTargetBackLink())}`;
    const preview = f.preview;
    const keepDraft = view.fileEditable && (dirty() || view.fileReread !== null || view.fileWriteUncertain);
    if (keepDraft || preview?.kind === 'text')
        return `${toolbar}${textEditor(f)}`;
    if (preview?.kind === 'image')
        return `${toolbar}${imagePreview(f, preview)}`;
    if (preview?.kind === 'download-only')
        return `${toolbar}${downloadOnlyPreview(f, preview)}`;
    return `${toolbar}${readPlaceholder(t('files.readingName', { name }), 'file')}`;
}
function imagePreview(f, preview) {
    const label = preview.mimeType === 'image/png' ? t('files.imagePng') : preview.mimeType === 'image/jpeg' ? t('files.imageJpeg') : t('files.imageWebp');
    return `<figure class="file-image-preview"><img src="${esc(preview.url)}" alt="${esc(f.name)}"><figcaption>${esc(label)} · ${preview.width}×${preview.height} · ${size(f.size)}${f.modified ? ` · ${esc(f.modified)}` : ''}</figcaption></figure><div class="editor-footer"><span>${t('files.readOnlyPreview')}</span><div class="actions">${btn(t('files.downloadFile'), "download-file", "primary", `data-path="${esc(f.path)}"`)}</div></div>`;
}
function downloadOnlyPreview(f, preview) {
    const reason = preview.reason === 'oversized'
        ? t('files.oversized')
        : preview.reason === 'document'
            ? t('files.document')
            : preview.reason === 'unsupported'
                ? t('files.unsupported')
                : t('files.notUtf8');
    const details = `${size(f.size)}${f.modified ? ` · ${esc(f.modified)}` : ''}`;
    return empty("file", t('files.downloadToOpen'), `${esc(reason)} ${details}. ${t('files.savedAvailable')}`, btn(`${icon("download")} ${t('files.downloadFile')}`, "download-file", "primary", `data-path="${esc(f.path)}"`));
}
const decodePaths = (value) => value ? JSON.parse(value) : [];
const size = (n) => n >= 1048576
    ? `${(n / 1048576).toFixed(1)} MiB`
    : n >= 1024
        ? `${(n / 1024).toFixed(1)} KB`
        : `${n} B`;
/** Keep untrusted server prose out of the primary result while retaining safe codes. */
function transferResultMessage(result) {
    if (result.httpStatus === undefined)
        return esc(result.status === 'unknown' ? t('fileResults.unknownMessage') : result.message);
    if (result.notSubmitted)
        return esc(t('d.error.targetCheckStatus', { status: result.httpStatus }));
    const summary = result.httpStatus === 412 ? t('d.error.targetChanged')
        : result.status === 'succeeded' ? t('d.files.resultConfirmed')
            : result.status === 'unknown' ? t('d.files.resultUnconfirmed', { status: result.httpStatus })
                : t('d.files.requestFailed', { status: result.httpStatus });
    const code = String(result.message);
    return `${esc(summary)}${/^[A-Z][A-Z0-9_]{2,79}$/.test(code) ? ` <code>${esc(code)}</code>` : ''}`;
}
function transferResults() {
    const results = current() ? adapter.transfersByWork.get(current().id) || [] : [];
    return results.some(result => result.status !== "succeeded")
        ? `<section class="transfer-results"><h3>${t('transfer.results')} <span>${results.some((r) => r.status !== "succeeded") ? t('transfer.someNeedAttention') : ""}</span></h3>${results.map((r) => `<div class="transfer-row">${icon(r.status === "succeeded" ? "check" : "info", 14)}<code>${esc(r.path)}</code><span>${transferResultMessage(r)}</span></div>`).join("")}${results.some((r) => r.status === "unknown") ? btn(t('transfer.refreshToVerify'), "refresh-files", "small") : ""}</section>`
        : "";
}
function textEditor(f) {
    const editable = view.fileEditable;
    const reread = view.fileReread?.preview?.kind === 'text' ? view.fileReread.preview.content : null;
    const rereadOther = !!view.fileReread && view.fileReread.preview?.kind !== 'text';
    return `<div class="editor-toolbar"><strong>${esc(f.name)}</strong>${editable ? badge(dirty() ? t('editor.unsaved') : t('editor.saved')) : ""}</div>${editable ? `${!view.fileBaseline ? feedback(t('editor.noModificationTime'), "warning", btn(t('editor.allowUnprotected'), "allow-unprotected-file", "small")) : ""}${view.fileWriteUncertain ? feedback(t('editor.previousWriteReview'), "warning", btn(t('editor.rereadSaved'), "refresh-files", "small")) : ""}${rereadOther ? feedback(t('editor.noLongerEditable'), "warning", btn(t('editor.downloadSaved'), "download-file", "small", `data-path="${esc(f.path)}"`)) : ""}${reread !== null ? `<section class="file-reread"><h3>${t('editor.currentSavedVersion')}</h3><pre>${esc(reread)}</pre>${btn(t('editor.overwriteReread'), "use-reread-version", "small")}</section>` : ""}<textarea id="file-editor" class="file-editor" spellcheck="false" aria-label="${esc(t('editor.editName', { name: f.name }))}">${esc(view.fileDraft)}</textarea><div class="editor-footer"><span>${t('editor.footer', { size: size(new TextEncoder().encode(view.fileDraft).length) })}</span><div class="actions">${btn(t('editor.downloadSaved'), "download-file", "quiet", `data-path="${esc(f.path)}"`)}${btn(t('editor.discard'), "discard-file", "quiet", dirty() ? "" : "disabled")}${btn(t('editor.saveFile'), "save-file", "primary", dirty() ? "" : "disabled")}</div></div>` : empty("file", t('files.downloadToOpen'), t('editor.editorLimit'), btn(`${icon("download")} ${t('files.downloadFile')}`, "download-file", "primary", `data-path="${esc(f.path)}"`))}`;
}
function settingsPage(w) {
    const configurationError = w.resourceErrors?.configuration;
    if (!w.resourceChecked?.configuration && !configurationError && !view.configDirty)
        return `<main class="settings-page">${btn(`${icon('arrow', 16)} ${t('settings.backToWork')}`, 'back-work', 'quiet settings-back')}<h1>${t('settings.title')}</h1>${readPlaceholder(t('settings.loading'))}</main>`;
    if (configurationError && !view.config && !w.resourceChecked?.configuration)
        return `<main class="settings-page">${btn(`${icon("arrow", 16)} ${t('settings.backToWork')}`, "back-work", "quiet settings-back")}<h1>${t('settings.title')}</h1>${feedback(esc(configurationError), "warning", btn(t('settings.refreshConfiguration'), "refresh-config", "primary"))}</main>`;
    if (!view.config)
        view.config = structuredClone(w.config);
    const c = view.config, pending = w.config.pendingApply === true;
    const applyRecord = [...actions.records.values()].filter(item => item.work === w.id && item.action === 'apply-config').sort((a, b) => b.token - a.token)[0];
    const applyOperations = adapter.state.operations.filter(item => item.workId === w.id && ['Apply configuration', 'Apply Work configuration', 'apply-work-configuration'].includes(item.kind)); // i18n-exempt: server operation kinds
    const applyOperation = applyRecord ? applyOperations.find(item => !!applyRecord.businessId && item.id === applyRecord.businessId) : [...applyOperations].sort((a, b) => (Date.parse(b.created) || 0) - (Date.parse(a.created) || 0))[0];
    const applying = !!applyRecord?.pending || !!applyOperation && ['accepted', 'pending', 'preparing', 'running'].includes(applyOperation.state);
    const applyBusy = !!applyRecord?.pending || operationBusy(applyOperation);
    const applyError = applyRecord?.error || (applyOperation?.state === 'failed' ? applyOperation.error || t('settings.applyFailed') : '');
    const unknown = !!applyRecord?.blocked || applyOperation?.state === 'unknown';
    const attention = view.configDirty || pending || applying || applyError || unknown || configurationError;
    const stateLabel = view.configDirty ? t('settings.unsavedChanges') : applyRecord?.pending ? t('settings.submittingApply') : applying && !applyBusy ? t('settings.applyPaused') : applying ? t('settings.applying') : unknown ? t('settings.applyNotConfirmed') : applyError ? t('settings.applyFailed') : pending ? t('settings.notApplied') : t('settings.configInUse');
    const stateBody = view.configDirty ? t('settings.saveDraftBeforeApply') : applying ? t('settings.usingPrevious') : unknown ? t('settings.checkOriginalApply') : applyError ? esc(applyError) : pending ? t('settings.savedNotActive') : '';
    const statusActions = `${btn(icon('refresh', 15), 'refresh-config', 'icon-button quiet', `aria-label="${esc(t('settings.refreshStatus'))}" title="${esc(t('settings.refreshStatus'))}"`)}${applyOperation && (applying || unknown || applyError) ? btn(t('settings.checkApply'), 'operation', 'small', `data-id="${esc(applyOperation.id)}"`) : ''}${view.configDirty ? btn(t('settings.saveChanges'), 'save-config', 'primary') : pending && !applying && !unknown ? btn(t('settings.applyChanges'), 'apply-config', 'primary', adapter.project(w).usable ? '' : `disabled title="${esc(t('settings.applyDisabledTitle'))}"`) : ''}`;
    const languageSection = `<section class="settings-language" aria-label="${esc(t('lang.menu'))}"><h2>${t('lang.menu')}</h2>${languageTrigger('quiet', 'settings')}</section>`;
    return `<main class="settings-page">${configurationError ? feedback(`${esc(configurationError)} ${t('settings.configPreserved')}`, "warning") : ""}<div class="settings-navigation">${btn(`${icon('arrow', 16)} ${t('settings.backToWork')}`, 'back-work', 'quiet settings-back')}</div><div class="settings-heading"><h1>${t('settings.title')}</h1>${!attention ? `<div class="configuration-compact">${badge(t('settings.configInUse'))}${statusActions}</div>` : ''}</div>${attention ? `<div class="configuration-state"><div><strong>${applyBusy ? pendingStatus(stateLabel, "apply-config") : esc(stateLabel)}</strong><span>${stateBody}</span></div><div class="actions">${statusActions}</div></div>` : ''}<nav class="settings-tabs">${["Skills", "Pi Packages", "AGENTS.md", "Advanced"].map((tab) => btn(tab === "Skills" ? t('settings.tabSkills') : tab === "Pi Packages" ? t('settings.tabPackages') : tab === "AGENTS.md" ? t('settings.tabAgents') : t('settings.tabAdvanced'), "settings-section", view.settingsTab === tab ? "tab active" : "tab", `data-tab="${tab}"`)).join("")}</nav><div class="settings-content">${view.settingsTab === "Skills" ? skillsSettings(w, c) : view.settingsTab === "Pi Packages" ? packagesSettings(w, c) : view.settingsTab === "AGENTS.md" ? `<div class="section-heading"><div><h2>${t('settings.agentsTitle')}</h2><p>${t('settings.agentsBody')}</p></div>${btn(`${icon("upload", 15)} ${t('settings.importFile')}`, "import-agents", "small")}</div><div class="config-labels"><span>${w.config.pendingApply ? t('settings.previousActive') : t('settings.configInUse')}</span><span>${t('settings.savedConfiguration')}</span></div><label class="field">${t('settings.desiredAgents')}<textarea id="agents-editor" class="code-editor" rows="13">${esc(c.agents)}</textarea></label><details class="details-box"><summary>${t('settings.currentActiveContent')}</summary><pre>${esc(w.config.active?.agentsMd ?? t('settings.noActiveConfig'))}</pre></details>` : `<div class="section-heading"><div><h2>${t('settings.advancedTitle')}</h2><p>${t('settings.advancedBody')}</p></div>${btn(`${icon("upload", 15)} ${t('settings.importJson')}`, "import-json", "small")}</div><label class="field">${t('settings.configurationJson')}<textarea id="advanced-editor" aria-label="${esc(t('settings.configurationJson'))}" class="code-editor" rows="17" spellcheck="false">${esc(c.advanced)}</textarea></label>${c.validationError ? feedback(esc(c.validationError), "warning") : ""}<p class="muted">${t('settings.advancedHelp')}</p>`}</div>${view.configDirty ? `<div class="settings-savebar"><span>${t('settings.unsavedBar')}</span><div class="actions">${btn(t('settings.discardChanges'), "discard-config")}${btn(t('settings.saveChanges'), "save-config", "primary")}</div></div>` : ""}${languageSection}</main>`;
}
function catalogFeedback(name) {
    const status = adapter.catalog[name];
    return (status.loading ? feedback(pendingStatus(name === 'skills' ? t('settings.checkingSkillsCatalog') : t('settings.checkingPackagesCatalog'), "check-catalog")) : '') + (status.error ? feedback(`${esc(status.error)} ${t('settings.catalogPreserved')}`, 'warning') : '');
}
function skillsSettings(w, c) {
    return `<div class="section-heading"><div><h2>${t('settings.skillsTitle')}</h2><p>${t('settings.skillsBody')}</p></div>${btn(t('settings.checkCatalog'), "check-catalog", "quiet small")}${btn(t('settings.clearSelection'), "clear-skills", "quiet small")}</div>${catalogFeedback("skills")}<div class="selection-note">${icon("info", 15)} ${t('settings.skillsNote')}</div><div class="capability-list">${adapter
        .getSkills()
        .map((s) => `<article class="capability"><label class="capability-check"><input type="checkbox" data-skill="${esc(s.id)}" ${c.skills.includes(s.id) ? "checked" : ""}><span class="capability-icon">${icon(s.id === "data-analysis" ? "counter" : s.id === "web-tools" ? "grid" : "note", 20)}</span><span><strong>${esc(s.name)}</strong><small>${esc(s.description === 'Saved Work copy; unavailable in current Core catalog' ? t('settings.savedCopyUnavailable') : s.description || t('settings.descriptionNotProvided'))}</small></span></label><div class="capability-meta"><span>${s.version ? `v${s.version}` : t('settings.versionNotProvided')}</span>${btn(t('common.details'), "skill-detail", "text-button", `data-id="${s.id}"`)}</div><div class="capability-status"><span>${c.skills.includes(s.id) ? t('settings.selectedWorkCopy') : t('settings.notSelected')}</span>${w.config.skills.includes(s.id) ? `<span>${skillState(w, s.id, "loaded")}</span><span>${skillState(w, s.id, "modelVisible")}</span>` : ""}${btn(t('settings.useCoreCopy'), "core-skill-copy", "text-button", `data-id="${s.id}" ${adapter.catalog.skills.error || !adapter.catalog.skills.confirmed || !adapter.getSkills().some(entry => entry.id === s.id && entry.description !== "Saved Work copy; unavailable in current Core catalog") ? "disabled" : ""}`)}</div></article>`)
        .join("")}</div>`;
}
function packagesSettings(w, c) {
    return `<div class="section-heading"><div><h2>${t('settings.packagesTitle')}</h2><p>${t('settings.packagesBody')}</p></div>${btn(`${icon("plus", 15)} ${t('settings.installPackage')}`, "install-package", "primary small")}</div><div class="capability-list package-list">${c.packages.length ? c.packages.map((p) => `<article class="capability package-capability"><div class="capability-check package-identity"><span class="capability-icon">${icon("grid", 20)}</span><span class="package-copy"><strong>${esc(p.name)}</strong><small>${esc(p.source)}</small></span></div>${btn(t('common.details'), "package-detail", "quiet small package-details", `data-id="${esc(p.name)}"`)}<div class="package-status">${badge(p.enabled ? 'Enabled' : 'Disabled')}<span>${packageStatus(w, p.name)}</span></div><div class="package-actions">${btn(p.enabled ? t('settings.disable') : t('settings.enable'), "toggle-package", "quiet small", `data-id="${esc(p.name)}"`)}${btn(t('settings.updateSource'), "update-package", "quiet small", `data-id="${esc(p.name)}"`)}${btn(t('settings.remove'), "remove-package", "small danger", `data-id="${esc(p.name)}"`)}</div></article>`).join("") : empty("grid", t('settings.noPackagesTitle'), t('settings.noPackagesBody'))}${catalogFeedback("packages")}<div class="catalog-heading"><h3>${t('settings.availableFromCore')}</h3><div class="catalog-actions">${btn(t('settings.checkCatalog'), "check-catalog", "quiet small")}${btn(t('settings.clearWorkSelection'), "clear-packages", "quiet small")}</div></div>${adapter
        .getPackages()
        .map((p) => `<div class="catalog-row package-catalog-row"><span class="capability-icon">${icon("grid", 20)}</span><div class="package-copy"><strong>${esc(p.name)}</strong><p>${esc(p.description || t('settings.descriptionNotProvided'))} · ${p.version || t('settings.versionNotProvided')}</p></div>${btn(t('settings.select'), "select-package", "small", `data-id="${esc(p.name)}" ${adapter.catalog.packages.error || !adapter.catalog.packages.confirmed ? "disabled" : ""}`)}</div>`)
        .join("")}</div>`;
}
function requestCancellable(request) { return canCancelPiRequest(request, true) || request.disposition === 'live' && request.state === 'cancelling'; }
function runFacts(run) {
    return `<dl><dt>${t('run.status')}</dt><dd>${badge(run.status)}</dd><dt>${t('run.actualModel')}</dt><dd>${esc(modelDisplayName(run.actualModel))}</dd><dt>${t('run.thinking')}</dt><dd>${esc(run.thinkingLevel === null ? t('run.normalUnconfirmed') : run.thinkingLevel || t('thinking.off'))}</dd><dt>${t('run.source')}</dt><dd>${esc(run.source?.kind === 'service' ? t('run.sourceService', { name: run.source.serviceName || t('run.automatic') }) : run.source?.kind === 'chat' ? t('run.sourceChat') : t('run.sourceUnknown'))}${run.source?.requestId ? ` · ${t('run.request')} <code>${esc(run.source.requestId)}</code>` : ''}${run.source?.phase ? ` · ${esc(run.source.phase)}` : ''}</dd><dt>${t('run.submitted')}</dt><dd>${esc(run.created || t('common.unavailable'))}</dd>${run.finished ? `<dt>${t('run.finished')}</dt><dd>${esc(run.finished)}</dd>` : ''}</dl>`;
}
function dismissAnchoredOverlay() {
    if (!anchoredOverlay(view.modal))
        return;
    if (view.modal === 'chat-response-settings' && pendingWebCommand && ['model', 'thinking'].includes(pendingWebCommand.kind) && !pendingWebCommand.pair)
        pendingWebCommand = undefined;
    const trigger = overlayAnchor ? root.querySelector(overlayAnchor) : null;
    trigger?.setAttribute('aria-expanded', 'false');
    trigger?.removeAttribute('aria-controls');
    const dialog = root.querySelector('#modal');
    modalChoice++;
    view.modal = '';
    view.modalError = '';
    view.modalNameError = null;
    dialog?.close();
    dialog?.remove();
}
function positionOverlay(dialog) {
    const anchor = overlayAnchor ? root.querySelector(overlayAnchor) : null;
    if (!anchor?.getClientRects().length || overlayContext !== `${adapter.identityEpoch}:${location.hash}:${view.tab}:${view.path}`) {
        dismissAnchoredOverlay();
        return;
    }
    dialog.style.maxHeight = 'calc(100dvh - 16px)';
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) {
        dismissAnchoredOverlay();
        return;
    }
    const placed = overlayPlacement(rect, dialog.getBoundingClientRect(), { width: innerWidth, height: innerHeight });
    dialog.style.left = `${placed.left}px`;
    dialog.style.top = `${placed.top}px`;
    dialog.style.maxHeight = `${placed.maxHeight}px`;
}
function syncDialogPresentation(dialog, nonmodal) {
    if (dialog.open && dialog.matches(':modal') === nonmodal)
        dialog.close();
    if (!dialog.open) {
        if (nonmodal)
            dialog.show();
        else
            dialog.showModal();
    }
}
function exportPanel(target) {
    const flow = view.data.flowId ? exportFlows.get(view.data.flowId) : undefined;
    const selectedID = flow?.snapshotId || view.data.snapshotId;
    const snap = selectedID ? adapter.getSnapshot(selectedID) : undefined;
    const job = snap ? adapter.downloads.get(snap.id) : undefined;
    const active = target ? exportFlows.forWork(target.id) : undefined;
    const busy = !!active && !active.terminal;
    const phases = { checking: t('export.phase.checking'), stopping: t('export.phase.stopping'), exporting: t('export.phase.exporting'), snapshot: t('export.phase.snapshot'), preparing: t('export.phase.preparing'), ready: t('export.phase.ready'), delivered: t('export.phase.delivered'), unknown: t('export.phase.unknown'), failed: t('export.phase.failed'), revoked: t('export.phase.revoked') };
    const title = flow ? phases[flow.phase] || flow.phase : t('export.packageTitle');
    const canSave = snap?.status === 'verified' && job?.ready && exportSnapshotAvailable(snap);
    const details = `${flow?.stopOperationId ? `<dt>${t('export.stopLabel')}</dt><dd>${btn(esc(flow.stopOperationId), 'operation', 'text-button', `data-id="${esc(flow.stopOperationId)}"`)}</dd>` : ''}${flow?.exportOperationId || snap?.operationId ? `<dt>${t('export.exportLabel')}</dt><dd>${btn(esc(flow?.exportOperationId || snap?.operationId), 'operation', 'text-button', `data-id="${esc(flow?.exportOperationId || snap?.operationId)}"`)}</dd>` : ''}${snap ? `<dt>${t('export.snapshotLabel')}</dt><dd><code>${esc(snap.id)}</code></dd><dt>${t('export.statusLabel')}</dt><dd>${badge(snap.status)}</dd><dt>${t('export.sizeLabel')}</dt><dd>${esc(snap.size || t('text.notProvided'))}</dd><dt>${t('export.expiresLabel')}</dt><dd>${esc(snap.expiresAt || t('text.notProvided'))}</dd>` : ''}`;
    const known = target ? adapter.state.snapshots.filter(value => value.workId === target.id && value.id !== selectedID) : [];
    const controls = flow && !flow.terminal ? `${btn(t('quick.checkStatus'), 'check-export-flow', 'small', `data-id="${esc(flow.id)}"`)}${!flow.terminal ? btn(flow.paused ? t('export.resume') : t('export.pause'), flow.paused ? 'resume-export-flow' : 'pause-export-flow', 'small', `data-id="${esc(flow.id)}"`) : ''}` : '';
    const error = flow?.error || snap?.error || job?.error || job?.observationError;
    const unavailable = snap?.status === 'expired' ? t('export.packageExpired') : snap?.status === 'unavailable' ? t('export.packageUnavailable') : '';
    const waiting = !!flow && !flow.paused && ['checking', 'stopping', 'exporting', 'snapshot', 'preparing'].includes(flow.phase) && !error;
    const body = `<p class="export-work-name">${esc(flow?.workName || target?.name || snap?.workId)}</p><p class="export-summary" role="status">${waiting ? pendingStatus(title, "export prepare-export download-work check-export-flow resume-export-flow save-export-file check-download") + " " : ""}${flow?.paused ? t('export.pausedBody') : flow?.phase === 'delivered' ? t('export.deliveredBody') : !flow ? t('export.packageBody') : t('export.keepWorking')}</p>${error || unavailable ? feedback(esc(error || unavailable), 'warning') : ''}<p class="export-privacy">${icon('lock', 14)} ${t('export.privacy')}</p><details class="export-details"><summary>${t('common.details')}</summary>${details ? `<dl class="export-snapshot">${details}</dl>` : ''}${snap ? downloadProgressMarkup(snap.id) : ''}${controls ? `<div class="actions">${controls}</div>` : ''}${known.length ? `<h3>${t('export.otherPackages')}</h3><div class="menu-list">${known.map(value => btn(`${esc(value.id)} · ${esc(value.status)}`, 'view-snapshot', '', `data-id="${esc(value.id)}" data-work-id="${esc(value.workId)}"`)).join('')}</div>` : ''}<p class="muted">${t('export.closingNote')}</p></details>`;
    const retry = flow && flow.phase === 'unknown' && !canSave ? btn(t('quick.checkStatus'), 'check-export-flow', 'primary', `data-id="${esc(flow.id)}"`) : '';
    const download = canSave ? btn(flow?.autoDeliveryConsumed ? t('export.downloadAgain') : t('editor.saveFile'), 'save-export-file', 'primary', `data-id="${esc(snap.id)}"`) : (!flow || flow.phase === 'failed' && !!job?.terminalFailure) && snap?.status === 'verified' && exportSnapshotAvailable(snap) ? btn(job?.terminalFailure ? t('export.retryDownload') : t('export.downloadSnapshot'), 'download-work', 'primary', `data-id="${esc(snap.id)}" ${busy && active?.snapshotId !== snap.id ? 'disabled' : ''}`) : '';
    const fresh = !flow && target && ['expired', 'unavailable'].includes(snap?.status || '') ? btn(t('export.exportCurrentWork'), 'prepare-export', 'primary', `data-id="${esc(target.id)}" ${busy ? 'disabled' : ''}`) : '';
    return { title, body, footer: `${btn(flow && !flow.terminal ? t('export.hide') : t('common.close'), 'close-modal')}${download || fresh || retry}` };
}
function modalMarkup() {
    const w = adapter.getWork(view.data.workId || view.data.id || route()[1] || "");
    const target = w || current();
    let title = "", body = "", footer = "";
    const cancel = () => btn(t('common.cancel'), "close-modal");
    const close = () => btn(t('common.close'), "close-modal");
    switch (view.modal) {
        case 'chat-response-settings': {
            if (!target)
                break;
            const { catalog, state, model, name, thinking, editable, thinkingEditable } = chatSettings(target, view.data.sessionId || '');
            const expanded = view.data.expanded, levels = expanded === 'thinking';
            title = t('response.title');
            const options = !editable || levels && !thinkingEditable ? [] : levels ? (model?.thinkingAvailability === 'unknown' ? [{ value: 'normal', name: t('thinking.normal'), note: t('response.normalNote'), selected: state.thinking === null }] : (model?.thinkingLevels || []).map(level => ({ value: level, name: thinkingName(level), note: '', selected: level === state.thinking }))) :
                [...(catalog?.defaultModel ? [catalog.defaultModel] : []), ...(catalog?.models || []).filter(m => m.modelRef !== null)].map(m => ({ value: m.modelRef || '', name: m.modelRef === null ? capturedDefaultName(m) : modelDisplayName(m), note: m.modelRef === null ? t('response.useWorkDefault') : m.model + ' · ' + m.provider + ' · ' + m.modelRef.slice(-8), selected: m.modelRef === state.ref }));
            const row = (kind, label, value, enabled, note = '') => btn(`<span class="response-setting-label">${label}</span><span class="response-setting-value">${esc(value)}${note ? `<small>${note}</small>` : ''}</span>${icon('down', 14)}`, 'toggle-chat-setting', 'quiet response-setting-row', `id="${kind}-select" data-kind="${kind}" value="${esc(kind === 'model' ? state.ref || '' : state.thinking ?? 'normal')}" aria-label="${label}: ${esc(value)}" aria-expanded="${expanded === kind}" aria-haspopup="listbox" aria-controls="response-${kind}-options" aria-describedby="response-settings-status" ${enabled ? '' : 'disabled'}`);
            body = `<p class="muted response-settings-subtitle">${t('response.forNextMessage')}${view.data.sessionId ? '' : ` · ${t('response.forNewSession')}`}</p><div class="response-setting-group">${row('model', t('response.model'), name, editable, state.ref === null ? t('chat.workDefault') : '')}${row('thinking', t('response.thinking'), thinking, thinkingEditable)}</div>${modelFeedback(target, view.data.sessionId || '', true)}${expanded && options.length ? `<div class="response-setting-options"><p class="muted">${levels ? t('response.thinking') : t('response.model')}</p><div id="response-${expanded}-options" class="menu-list chat-picker-menu" role="listbox" aria-label="${levels ? t('response.thinkingLevels') : t('response.models')}">${options.map(option => btn(`<span>${esc(option.name)}${option.note ? `<small>${esc(option.note)}</small>` : ''}</span>${option.selected ? icon('check', 16) : ''}`, 'choose-chat-setting', '', `role="option" aria-selected="${option.selected}" data-option-value="${esc(option.value)}" data-kind="${expanded}"`)).join('')}</div></div>` : ''}`;
            footer = close();
            break;
        }
        case 'chat-input-options':
            title = t('chat.inputOptions');
            body = `<label class="check-row"><input id="include-identity" type="checkbox" ${view.includeIdentity ? 'checked' : ''}> ${t('inputOptions.includeIdentity')}</label>${current() && (view.drafts[draftKey(current())] || '').trimStart().startsWith('/') && !view.literalSlash ? `<p class="muted">${t('inputOptions.commandsNote')}</p>` : ''}<p class="muted">${t('inputOptions.ordinaryNote')}</p><details><summary>${t('inputOptions.whatIncluded')}</summary><p>${t('inputOptions.identityOnly')}</p></details>`;
            footer = close();
            break;
        case "account":
            title = esc(adapter.state.core.account || t('topbar.account'));
            body = `<p class="account-context"><span>${t('account.roleLine', { role: esc(adapter.state.core.role === 'admin' ? t('account.administrator') : adapter.state.core.role) })}</span><span title="${esc(adapter.state.core.address)}">${t('account.coreLine', { address: esc(adapter.state.core.address) })}</span></p><div class="menu-list">${btn(`${icon("info")} ${t('account.about')}`, "about-piwork")}${btn(`${icon("clock")} ${t('account.knownOperations')}`, "operations")}${adapter.state.core.role === "admin" ? btn(`${icon("download")} ${t('account.exportLogs')}`, "export-logs") : ""}</div>${languageMenuItems()}<div class="menu-list account-management">${adapter.hosted ? (adapter.state.core.role === "admin" ? `<a class="button" href="/admin" role="menuitem" tabindex="-1">${icon('grid')} ${t('account.administration')}</a><a class="button" href="/admin/setup" role="menuitem" tabindex="-1">${icon('settings')} ${t('account.quickSetup')}</a>` : "") : `${btn(`${icon("refresh")} ${t('account.switchCore')}`, "switch-core")}`}${btn(`${icon("logout")} ${t('account.signOut')}`, "sign-out", "danger")}</div>`;
            break;
        case "connection":
            title = t('connection.title');
            body = `${coreConnectionStatus()}<dl><dt>${t('term.core')}</dt><dd>${esc(adapter.state.core.address)}</dd><dt>${t('connection.lastChecked')}</dt><dd>${esc(adapter.state.lastChecked || t('text.notProvided'))}</dd></dl><h3>${t('connection.capabilities')}</h3><div class="status-grid">${[[t('term.core'), adapter.status.health], [t('term.runtime'), adapter.status.readiness], [t('connection.services'), adapter.status.service], [t('connection.files'), adapter.status.files]].map(([name, state]) => `<span>${name} ${badge(state?.available ? name === t('term.runtime') && state.value?.ready === false ? t(coreRuntimeUnavailable() ? 'conn.runtimeUnavailable' : 'conn.runtimeNotReady') : t('connection.available') : t('connection.unavailable'))}</span>`).join("")}</div><p class="muted">${t('connection.separate')}</p>`;
            footer = `${adapter.hosted ? '' : btn(t('account.switchCore'), "switch-core")}${btn(t('connection.check'), "check-connection", "primary")}`;
            break;
        case "switch-core":
            title = t('account.switchCore');
            body = `<p>${t('switchCore.body')}</p><label class="field">${t('switchCore.address')}<input id="auth-core" value="${esc(view.coreAddress)}"></label><p class="muted">${t('switchCore.clears')}</p>${defaultCorePreferences()}`;
            footer = `${cancel()}${btn(t('switchCore.connect'), "confirm-switch-core", "primary")}`;
            break;
        case "work-menu":
            title = target ? esc(target.name) : t('workMenu.options');
            body = `<div class="menu-list">${btn(`${icon("info")} ${t('workMenu.info')}`, "work-info", "", `data-id="${target?.id}"`)}${btn(`${icon("settings")} ${t('workMenu.settings')}`, "settings", "", `data-id="${target?.id}"`)}${btn(`${icon("download")} ${t('workMenu.export')}`, "export", "", `data-id="${target?.id}"`)}${target && adapter.project(target).action === "stop" ? btn(`${icon("stop")} ${t('workMenu.stop')}`, "stop-work", "", `data-id="${esc(target.id)}"`) : ""}${btn(`${icon("trash")} ${t('workMenu.delete')}`, "delete-work", "danger", `data-id="${target?.id}"`)}</div>${languageMenuItems()}`;
            break;
        case "work-info":
            if (!target)
                break;
            title = t('workMenu.info');
            body = `<dl class="property-list"><dt>${t('workInfo.name')}</dt><dd>${esc(target.name)}</dd><dt>${t('workInfo.status')}</dt><dd>${badge(target.status)}</dd><dt>${t('workInfo.desired')}</dt><dd>${target.desired}</dd><dt>${t('workInfo.id')}</dt><dd class="property-value-action"><code>${target.id}</code>${btn(icon("copy", 15), "copy", "icon-button quiet", `data-copy="${target.id}" aria-label="${esc(t('workInfo.copyId'))}"`)}</dd><dt>${t('workInfo.network')}</dt><dd class="property-value-action"><code>${esc(target.network || t('text.notProvided'))}</code>${btn(icon("copy", 15), "copy", "icon-button quiet", `data-copy="${target.network}" aria-label="${esc(t('workInfo.copyNetwork'))}"`)}</dd><dt>${t('workInfo.owner')}</dt><dd>${esc(adapter.state.core.account)}</dd></dl>`;
            footer = `${close()}${[...actions.records.values()].some(record => record.blocked && record.kind === 'lifecycle' && record.work === target.id) ? btn(t('workInfo.checkOriginal'), 'check-work', '', `data-id="${esc(target.id)}"`) : ''}`;
            break;
        case "new-work":
            title = t('works.newWork');
            body = `<p>${t('create.body')}</p><label class="field">${t('workInfo.name')}<input id="create-name" placeholder="${esc(t('create.namePlaceholder'))}" value="${esc(view.createName)}" aria-label="${esc(t('workInfo.name'))}" ${currentNameError() ? 'aria-invalid="true" aria-describedby="create-name-error"' : ""} autofocus required maxlength="120">${nameFieldError("create-name-error")}</label><button class="advanced-toggle" data-action="toggle-create-advanced">${icon(view.createAdvanced ? "down" : "chevron", 14)} ${t('create.advanced')} <span>${t('create.optional')}</span></button>${view.createAdvanced
                ? `<div class="advanced-form"><label class="field">${t('create.baseImage')}<input id="create-image" placeholder="${esc(t('create.useCoreDefault'))}" value="${esc(view.createImage)}"></label><label class="field">${t('create.skills')}<select id="create-skill-mode">${[
                    ["defaults", t('create.useDefaults')],
                    ["choose", t('create.choose')],
                    ["none", t('create.none')],
                ]
                    .map(([v, l]) => `<option value="${v}" ${view.createSkillMode === v ? "selected" : ""}>${l}</option>`)
                    .join("")}</select></label>${view.createSkillMode === "choose"
                    ? adapter
                        .getSkills()
                        .map((s) => `<label class="check-row"><input type="checkbox" data-create-skill="${esc(s.id)}" ${view.createSkills.includes(s.id) ? "checked" : ""}>${esc(s.name)}</label>`)
                        .join("")
                    : ""}<label class="field">${t('create.packages')}<select id="create-package-mode">${[
                    ["defaults", t('create.useDefaults')],
                    ["choose", t('create.choose')],
                    ["none", t('create.none')],
                ]
                    .map(([v, l]) => `<option value="${v}" ${view.createPackageMode === v ? "selected" : ""}>${l}</option>`)
                    .join("")}</select></label>${view.createPackageMode === "choose"
                    ? adapter
                        .getPackages()
                        .map((p) => `<label class="check-row"><input type="checkbox" data-create-package="${esc(p.name)}" ${view.createPackages.includes(p.name) ? "checked" : ""}>${esc(p.name)}</label>`)
                        .join("")
                    : ""}<label class="field">AGENTS.md<textarea id="create-agents" rows="4" placeholder="${esc(t('create.agentsPlaceholder'))}">${esc(view.createAgents)}</textarea></label>${btn(t('create.importAgents'), "create-import-agents", "small")}<label class="field">${t('create.fullJson')}<textarea id="create-json" rows="4" class="mono" placeholder="${esc(t('create.jsonPlaceholder'))}">${esc(view.createJson)}</textarea></label></div>`
                : ""}<div class="merge-summary"><strong>${t('create.summaryTitle')}</strong><span>${t('create.summaryImage', { value: esc(view.createImage || t('create.coreDefault')) })}</span><span>${t('create.summarySkills', { value: view.createSkillMode === "defaults" ? t('create.coreDefaults') : view.createSkillMode === "none" ? t('create.none') : esc(view.createSkills.join(", ") || t('create.noneChosen')) })}</span><span>${t('create.summaryPackages', { value: view.createPackageMode === "defaults" ? t('create.coreDefaults') : view.createPackageMode === "none" ? t('create.none') : esc(view.createPackages.join(", ") || t('create.noneChosen')) })}</span><span>${t('create.overrideNote')}</span></div>`;
            footer = `${cancel()}${btn(t('create.submit'), "create-work", "primary", createSubmissionBlocked(actions.records.values(), view.createName) ? "disabled" : "")}`;
            break;
        case "stop-work":
            title = t('stopWork.title', { name: esc(target?.name) });
            body = `<p>${t('stopWork.body')}</p><p>${t('stopWork.preserved')}</p><div class="impact-box">${t('stopWork.impact')}</div>`;
            body += view.data.exportAfterStop ? `<p>${t('stopWork.exportAfter')}</p>` : '';
            footer = `${cancel()}${btn(view.data.exportAfterStop ? t('stopWork.stopAndExport') : t('workMenu.stop'), "confirm-stop", "danger-solid", `data-id="${target?.id}" ${view.data.exportAfterStop ? 'data-export-stop="true"' : ''}`)}`;
            break;
        case "delete-work":
            title = t('deleteWork.title', { name: esc(target?.name) });
            body = `<p>${t('deleteWork.body')}</p><p>${t('deleteWork.differs')}</p><label class="check-row"><input id="delete-confirm" type="checkbox" ${view.deleteConfirmed ? "checked" : ""}>${t('deleteWork.ack')}</label>`;
            footer = `${cancel()}${btn(t('workMenu.delete'), "confirm-delete", "danger-solid", `data-id="${target?.id}" ${view.deleteConfirmed ? "" : "disabled"}`)}`;
            break;
        case "sessions":
            title = t('agent.sessions');
            body = `<p class="session-picker-context">${t('sessions.context', { name: `<strong>${esc(target?.name)}</strong>` })}</p><div class="session-picker-actions">${btn(`${icon("plus", 16)} ${t('chat.newSession')}`, "new-session")}</div>${target?.resourceLoading?.agent && target.sessions.length ? pendingStatus(t('agent.readingConversations'), "sessions retry-conversation") : ""}<div class="session-list" role="listbox" aria-label="${esc(t('agent.sessions'))}">${target?.sessions.map((s) => `<button role="option" aria-selected="${s.id === view.session}" data-action="select-session" data-id="${esc(s.id)}" class="${s.id === view.session ? "selected" : ""}"><span class="session-choice-main">${icon("chat", 17)}<span class="session-choice-copy"><span class="session-choice-title">${esc(sessionDisplayName(target, s))}</span>${target.run?.sessionId === s.id ? badge(target.run.status) : ""}</span></span>${s.id === view.session ? `<span class="session-choice-check" aria-hidden="true">${icon("check", 16)}</span>` : ""}</button>`).join("") || (target?.resourceLoading?.agent ? readPlaceholder(t('agent.loadingConversations')) : target?.resourceErrors?.agent ? "" : `<p>${t('sessions.none')}</p>`)}</div>${target?.resourceErrors?.agent ? readFailure(t('sessions.readFailed'), target.resourceErrors.agent, "retry-conversation", !!target.resourceLoading?.agent) : ""}<p class="session-picker-note">${t('sessions.note')}</p>`;
            break;
        case "agent-menu":
            title = t('agent.options');
            body = `<div class="menu-list">${btn(`${icon("clock")} ${t('agent.sessions')}`, "sessions")}${btn(`${icon("plus")} ${t('chat.newSession')}`, "new-session")}${btn(`${icon("note")} ${t('work.piRequestsAria')}`, "pi-requests")}${view.layout === 'chat-only' ? btn(`${icon("arrow")} ${t('focus.restoreLayout')}`, "restore-layout") : btn(`${icon("focus")} ${t('focus.focusChat')}`, "focus-chat")}${browserFullscreenAction()}</div>`;
            break;
        case "about-piwork": {
            const info = adapter.about;
            title = t('account.about');
            body = `${info.localLoading || info.coreLoading ? pendingStatus(t('about.loading'), "refresh-about about-piwork") : ""}${productInfoMarkup('Desktop (piwork-cli)', info.local, info.localLoading, info.localError)}${productInfoMarkup(t('term.core'), info.core, info.coreLoading, info.coreError)}${info.core && info.coreError ? `<p class="muted">${t('about.lastConfirmed', { time: esc(info.coreChecked) })}</p>` : ''}`;
            footer = `${close()}${btn(t('about.refresh'), 'refresh-about', 'quiet')}`;
            break;
        }
        case "chat-image-preview":
            title = t('imagePreview.title');
            body = `${target && !adapter.project(target).usable ? `<p class="muted">${t('imagePreview.previous')}</p>` : ''}<img class="chat-image-preview" src="${esc(view.data.url)}" alt="${esc(t('imagePreview.alt'))}">`;
            footer = close();
            break;
        case "run-details": {
            title = t('execution.runDetails');
            const runId = view.data.runId, run = target ? (adapter.runDetails.get(`${target.id}:${runId}`) || (target.run?.id === runId ? target.run : target.sessions.flatMap(s => s.runs || []).find(r => r.id === runId))) : undefined;
            const observed = target && adapter.activeRuns.get(target.id), active = target && (adapter.cancelAndSendCapabilities.get(target.id) === 1 ? observed?.confirmed && !observed.error ? observed.run : undefined : target.run);
            const cancellable = !!run && active?.id === run.id && ['accepted', 'running', 'cancelling'].includes(active.status);
            const history = target?.sessions.find(s => s.id === view.session)?.runs || [];
            body = run ? `${runFacts(run)}${run.error ? feedback(esc(run.error), 'warning') : ''}${modelFailureHelp(run)}${target ? temporaryCleanupMarkup(target.id, 'run', run.id) : ''}<details><summary>${t('runDetails.technical')}</summary><dl><dt>${t('runDetails.runId')}</dt><dd><code>${esc(run.id)}</code></dd><dt>${t('runDetails.sessionId')}</dt><dd><code>${esc(run.sessionId)}</code></dd><dt>${t('runDetails.cursor')}</dt><dd>${run.cursor}</dd></dl></details><p class="muted">${t('runDetails.note')}</p>` : `<p>${t('runDetails.unconfirmed')}</p>`;
            if (history.length)
                body += `<details><summary>${t('runDetails.earlier')}</summary>${history.map(r => `<p>${btn(`${esc(stateText(r.status))} · ${esc(r.created || t('runDetails.timeUnavailable'))} · ${esc(modelDisplayName(r.actualModel))}`, 'run-details', 'text-button', `data-run-id="${esc(r.id)}"`)}</p>`).join('')}</details>`;
            footer = `${close()}${run && cancellable ? btn(run.cancellationRequested || run.status === 'cancelling' ? t('execution.cancelling') : t('execution.cancelRun'), 'cancel-run', 'danger', `data-run-id="${esc(run.id)}" ${run.cancellationRequested || run.status === 'cancelling' ? 'disabled' : ''}`) : ''}`;
            break;
        }
        case 'service-picker': {
            title = t('service.switch');
            const selected = target && activeService(target);
            body = `<div class="service-picker-list" role="listbox" aria-label="${esc(t('service.listAria'))}">${target?.services.filter(item => item.ports.length && item.observed !== 'Removed').map(item => btn(`<span class="service-choice-copy"><strong>${esc(item.name)}</strong>${!item.enabled || item.observed !== 'Ready' ? `<small>${esc(item.error || (!item.enabled ? t('service.pickerDisabled') : item.observed === 'Starting' ? t('service.pickerStarting') : item.observed === 'Failed' ? t('service.pickerFailed') : t('service.pickerStopped')))}</small>` : ''}</span>${badge(item.enabled ? item.observed : 'Disabled')}<span class="choice-check">${item.id === selected?.id ? icon('check', 16) : ''}</span>`, 'select-service', 'quiet service-choice', `role="option" aria-selected="${item.id === selected?.id}" data-id="${esc(item.id)}"`)).join('') || `<p>${t('service.pickerEmpty')}</p>`}</div>`;
            footer = btn(`${icon('settings', 16)} ${t('service.manage')}`, 'manage-services', 'quiet');
            break;
        }
        case "service-menu":
            title = t('service.options');
            body = `<div class="menu-list">${btn(`${icon("external")} ${t('service.openNewTab')}`, "open-app")}${btn(`${icon("focus")} ${t('service.openWindow')}`, "open-window")}${btn(`${icon("copy")} ${t('service.copyDomain')}`, "copy-domain")}${btn(`${icon("copy")} ${adapter.hosted ? t('service.copyAccessLink') : t('service.copyLocalLink')}`, "copy-local")}${btn(`${icon("settings")} ${t('service.manage')}`, "manage-services")}${btn(`${icon("note")} ${t('work.piRequestsAria')}`, "pi-requests")}${route()[0] === 'work' ? btn(`${icon("reset")} ${t('service.resetSplit')}`, "reset-workspace-split") + btn(`${icon("focus")} ${t('focus.focusChat')}`, "focus-chat") : ''}${browserFullscreenAction()}</div><p class="muted">${adapter.hosted ? t('service.menuHostedNote') : t('service.menuLocalNote')}</p>`;
            break;
        case "manage-services":
            title = t('service.manage');
            body = `<p>${t('service.definitionsAgent')}</p><div class="service-list">${target?.services.map((s) => `<button data-action="service-details" data-id="${s.id}"><span class="service-list-icon">${icon(s.ports.length ? "grid" : "terminal", 20)}</span><span><strong>${esc(s.name)}</strong><small>${s.ports.length ? t(s.ports.length === 1 ? 'service.declaredPortOne' : 'service.declaredPortMany', { count: s.ports.length }) : t('service.noWebEntry')} · ${s.enabled ? t('stateValue.enabled') : t('stateValue.disabled')}</small></span>${badge(s.observed)}${icon("chevron", 15)}</button>`).join("") || `<p>${t('service.noneDefined')}</p>`}</div>`;
            footer = close();
            break;
        case "service-details": {
            const s = target?.services.find((s) => s.id === view.data.serviceId);
            title = s ? esc(s.name) : t('service.removed');
            body = s
                ? serviceDetails(s, target)
                : `${target ? controlMarkup(serviceControls.get(`${target.id}:${view.data.serviceId}`)) : ""}<p>${t('service.removedBody')}</p>${target ? temporaryCleanupMarkup(target.id, 'service', view.data.serviceId) : ''}`;
            footer = `${close()}${btn(t('service.backToServices'), "manage-services")}`;
            break;
        }
        case "service-control": {
            const s = target?.services.find((s) => s.id === view.data.serviceId);
            title = t(view.data.control === "remove" ? 'serviceControl.removeTitle' : 'serviceControl.stopTitle', { name: esc(s?.name) });
            body =
                view.data.control === "remove"
                    ? `<p>${t('serviceControl.removeBody')}</p>`
                    : `<p>${t('serviceControl.stopBody')}</p>`;
            footer = `${cancel()}${btn(view.data.control === "remove" ? t('serviceControl.remove') : t('serviceControl.stop'), "confirm-service-control", "danger-solid")}`;
            break;
        }
        case "pi-requests": {
            const serviceContext = view.data.source === 'service';
            title = serviceContext ? t('service.agentRequests') : t('pi.title');
            const page = target ? adapter.requestPage(target.id, view.data.serviceName || '') : undefined;
            body = `<p class="request-work-name">${esc(target?.name || t('pi.currentWork'))}${serviceContext ? t('pi.serviceContext') : t('pi.allWorkContext')}</p><div class="request-filter"><label class="field">${t('pi.source')}<select id="pi-service-filter"><option value="">${t('pi.allSources')}</option>${target?.services.map(item => `<option value="${esc(item.name)}" ${item.name === view.data.serviceName ? 'selected' : ''}>${esc(item.name)}</option>`).join('') || ''}</select></label>${btn(icon('refresh', 16), 'pi-requests', 'icon-button quiet', `aria-label="${esc(t('pi.refresh'))}" title="${esc(t('pi.refresh'))}"`)}</div>${page?.loading ? pendingStatus(t('pi.reading'), 'pi-requests service-requests next-pi-requests') : ''}${page?.error ? feedback(esc(page.error), 'warning') : ''}<div class="request-list">${page?.items.map(request => `<article class="request-row">${btn(`<span class="request-copy"><strong>${esc(request.goal)}</strong><small>${esc(request.source.kind === 'service' ? t('run.sourceService', { name: request.source.serviceName }) : t('run.sourceChat'))}</small></span>${icon('chevron', 16)}<span class="request-row-meta">${badge(requestStateLabel(request.state))}<small>${t('pi.updated', { time: esc(request.updatedAt) })}</small></span>${request.disposition !== 'live' ? `<small class="request-historical">${t('pi.historical')}</small>` : ''}`, 'pi-request-detail', 'quiet request-row-button', `data-id="${esc(request.requestId)}"`)}${target && adapter.requestReadErrors.get(`${target.id}:${request.requestId}`) ? feedback(esc(adapter.requestReadErrors.get(`${target.id}:${request.requestId}`)), 'warning') : ''}</article>`).join('') || (page?.loading ? t('pi.reading') : t('pi.empty'))}</div>`;
            footer = `${close()}${page?.nextCursor ? btn(t('pi.more'), 'next-pi-requests') : ''}`;
            break;
        }
        case "pi-request-detail": {
            title = view.data.source === 'service' ? t('pi.agentRequest') : t('pi.request');
            const detail = target ? adapter.requestDetails.get(`${target.id}:${view.data.requestId}`) : undefined, r = detail?.request;
            if (!r) {
                body = view.modalError ? '' : pendingStatus(t('pi.readingOne'), 'pi-request-detail');
                footer = close();
                break;
            }
            const retryIntent = target ? adapter.requestRetries.get(`${target.id}:${r.requestId}`) : undefined;
            const cancellation = target && adapter.requestCancellation(target.id, r.requestId);
            const waiting = ['waiting_result', 'waiting_apply'].includes(r.state);
            const live = r.disposition === 'live', editable = live && !!target && adapter.project(target).usable, responses = target ? adapter.requestResponses.get(`${target.id}:${r.requestId}`) : undefined;
            body = `<div class="request-overview"><h3>${esc(r.goal)}</h3><p>${esc(r.source.kind === 'service' ? t('run.sourceService', { name: r.source.serviceName }) : t('run.sourceChat'))}</p>${live && !detail.readError && !r.error && cancellation?.phase !== 'unknown' && ['pending', 'running', 'cancelling'].includes(r.state) ? pendingStatus(requestStateLabel(r.state)) : badge(requestStateLabel(r.state))}<small>${detail.checkedAt ? t('pi.lastConfirmed') : t('pi.updatedLabel')} ${esc(detail.checkedAt || r.updatedAt)}</small></div>${detail.readError ? feedback(t('pi.statusNotConfirmed', { error: esc(detail.readError) }), 'warning') : ''}${!live ? `<p class="muted">${t('pi.historical')}</p>` : ''}<section class="request-result"><h3>${t('pi.resultHeading')}</h3>${r.result ? `<p class="request-text">${esc(r.result)}</p>` : ''}${waiting && r.waitRef ? feedback(`${t('pi.waitingFor', { kind: esc(r.waitRef.kind) })}<small>${t('pi.deadline', { time: esc(r.waitRef.deadlineAt) })}</small>`, 'warning') : ''}${r.error ? feedback(esc(r.error.message), 'warning') : ''}${!r.result && (!waiting || !r.waitRef) && !r.error ? `<p>${t('pi.noResult')}</p>` : ''}${retryIntent ? feedback(esc(retryIntent.error || t('pi.retryUnknown')), 'warning') : ''}</section>${responses?.visibleLoading ? pendingStatus(t('pi.readingExecutions'), "pi-request-detail") : ""}<details class="request-executions"><summary>${t('pi.executions')} <span>${r.runIds.length}</span></summary>${r.runIds.map((runId, index) => { const run = responses?.runs.find(item => item.id === runId); return `<details class="request-execution"><summary>${t('pi.executionNumber', { index: index + 1 })} ${run ? badge(run.status) : `<span>${t('common.notConfirmed')}</span>`}</summary>${run ? `${runFacts(run)}${responses?.checked[run.id] ? `<small>${t('pi.lastConfirmed', { time: esc(responses.checked[run.id]) })}</small>` : ''}${run.finalText ? `<div class="request-text chat-markdown">${target ? renderChatMarkdown(run.finalText, { workId: target.id }) : esc(run.finalText)}</div>` : `<p>${t('pi.noReply')}</p>`}${run.error ? feedback(esc(run.error), 'warning') : ''}` : `<p>${responses?.loading ? t('pi.readingExecution') : t('pi.executionUnconfirmed')}</p>`}</details>`; }).join('') || `<p>${t('pi.noRun')}</p>`}<p class="muted">${t('pi.successNote')}</p></details>${responses?.errors.map(error => feedback(esc(error), 'warning')).join('') || ''}<details class="request-evidence"><summary>${t('pi.evidenceHeading')}</summary><p>${t('pi.requestId')} <code>${esc(r.requestId)}</code></p>${r.waitRef ? `<p>${t('pi.waitReference')} <code>${esc(r.waitRef.id)}</code></p>` : ''}${detail.evidence.items.map((e) => `<article class="capability"><strong>${esc(e.kind)} · ${e.verified ? t('pi.verified') : t('pi.observed')}</strong><p>${esc(e.summary)}</p><small>${esc(e.observedAt)} · ${esc(e.objectRef)}${e.stateVersion ? ` · ${t('pi.state', { value: esc(e.stateVersion) })}` : ''}${e.codeVersion ? ` · ${t('pi.code', { value: esc(e.codeVersion) })}` : ''}</small></article>`).join('') || `<p>${t('pi.noEvidence')}</p>`}${detail.evidence.nextCursor ? btn(t('pi.moreEvidence'), 'next-pi-evidence', 'small') : ''}</details>`;
            if (cancellation)
                body += feedback(cancellation.phase === 'accepted' ? `${t('pi.cancelAccepted')}${cancellation.error ? ` ${esc(cancellation.error)}` : ''}` : cancellation.phase === 'unknown' ? `${t('pi.cancelUnknown')} ${esc(cancellation.error)}` : t('pi.requestingCancellation'), cancellation.phase === 'unknown' || cancellation.error ? 'warning' : 'info');
            footer = `${close()}${btn(t('pi.checkStatus'), 'pi-request-detail', 'small', `data-id="${esc(r.requestId)}"`)}${view.data.source !== 'service' && editable && ['failed', 'cancelled', 'needs_attention'].includes(r.state) ? btn(t('pi.retryNew'), 'retry-pi-request', 'primary', retryIntent ? 'disabled' : '') : ''}${editable && requestCancellable(r) ? btn(r.state === 'cancelling' ? t('execution.cancelling') : t('pi.cancelRequest'), 'cancel-pi-request', 'danger', r.state === 'cancelling' || cancellation ? 'disabled' : '') : ''}`;
            break;
        }
        case "file-menu": {
            const f = target?.files.find((f) => f.path === view.data.path);
            title = esc(f?.name || t('files.kindFile'));
            body = `<div class="menu-list">${btn(`${icon(f?.kind === 'directory' ? 'folder' : 'file')} ${t('fileMenu.open')}`, "open-file", "", `data-path="${esc(f?.path)}"`)}${btn(`${icon("download")} ${t('files.downloadFile')}`, "download-file", "", `data-path="${esc(f?.path)}" ${f?.kind === "directory" || f?.kind === "special" ? "disabled" : ""}`)}${btn(`${icon("edit")} ${t('fileMenu.rename')}`, "file-rename", "", `data-path="${esc(f?.path)}"`)}${btn(`${icon("move")} ${t('fileMenu.move')}`, "file-move", "", `data-path="${esc(f?.path)}"`)}${btn(`${icon("copy")} ${t('common.copy')}`, "file-copy", "", `data-path="${esc(f?.path)}"`)}${btn(`${icon("trash")} ${t('fileMenu.delete')}`, "file-delete", "danger", `data-path="${esc(f?.path)}"`)}</div>`;
            break;
        }
        case "upload-overwrite": {
            const review = uploadReview(modalTransfers), paths = (rows) => rows.map(row => `<code>${esc(row.path)}</code>`).join(', ');
            title = t('upload.title');
            body = `${review.overwrite.length ? `<p>${t('upload.overwrite', { paths: paths(review.overwrite) })}</p>` : ''}${review.retry.length ? `<p>${t('upload.retry', { paths: paths(review.retry) })}</p>` : ''}${review.unknown.length ? `<p>${t('upload.unknown')}</p>` : ''}`;
            footer = `${cancel()}${review.retry.length ? btn(t('upload.retryButton'), 'confirm-upload-overwrite', 'primary', 'data-upload-mode="retry"') : ''}${review.overwrite.length ? btn(t('upload.overwriteButton'), 'confirm-upload-overwrite', 'danger', 'data-upload-mode="overwrite"') : ''}`;
            break;
        }
        case "new-folder":
            title = t('files.newFolder');
            body = `<p>${t('folder.inside', { path: `<code>${esc(view.path)}</code>` })}</p><label class="field">${t('folder.name')}<input id="form-name" value="${esc(view.formName)}" placeholder="${esc(t('folder.placeholder'))}"></label>`;
            footer = `${cancel()}${btn(t('folder.create'), "confirm-folder", "primary")}`;
            break;
        case "file-transfer":
            title = `${t(view.data.transfer === "rename" ? 'fileMenu.rename' : view.data.transfer === "copy" ? 'common.copy' : 'fileMenu.move')} ${decodePaths(view.data.paths).length > 1 ? t('transfer.selectedItems') : t('transfer.item')}`;
            body = `<div class="path-list">${decodePaths(view.data.paths)
                .map((p) => `<code>${esc(p)}</code>`)
                .join("")}</div>${view.data.transfer === "rename"
                ? `<label class="field">${t('transfer.newName')}<input id="form-name" value="${esc(view.formName)}" placeholder="${esc(t('transfer.namePlaceholder'))}"></label>`
                : `<label class="field">${t('transfer.destination')}<select id="form-destination"><option value="/">${t('transfer.workspaceRoot')}</option>${target?.files
                    .filter((f) => f.kind === "directory")
                    .map((f) => `<option value="${esc(f.path)}" ${view.formDestination === f.path ? "selected" : ""}>${esc(f.path)}</option>`)
                    .join("")}</select></label>`}<p class="muted">${t('transfer.destinationNote')}</p>${view.formOverwrite ? feedback(t('transfer.overwriteWarning', { path: `<code>${esc(view.data.overwritePath)}</code>` }), "warning") : ""}`;
            footer = `${cancel()}${btn(view.formOverwrite ? t('transfer.overwrite') : view.data.transfer === "copy" ? t('transfer.copyHere') : view.data.transfer === "rename" ? t('fileMenu.rename') : t('transfer.moveHere'), "confirm-transfer", view.formOverwrite ? "danger-solid" : "primary", fileAttempt?.ledger.hasResults ? "disabled" : "")}`;
            break;
        case "file-delete":
            title = t('deleteFiles.title');
            body = `<p>${t('deleteFiles.body')}</p><div class="path-list">${decodePaths(view.data.paths)
                .map((p) => `<code>${esc(p)}</code>`)
                .join("")}</div><p class="danger-text">${t('deleteFiles.warning')}</p>`;
            footer = `${cancel()}${btn(t('deleteFiles.confirm'), "confirm-file-delete", "danger-solid", fileAttempt?.ledger.hasResults ? "disabled" : "")}`;
            break;
        case "dirty-file":
            title = t('dirtyFile.title');
            body = `<p>${t('dirtyFile.body', { path: `<code>${esc(view.file)}</code>` })}</p><p>${t('dirtyFile.note')}</p>`;
            footer = `${btn(t('dirty.keepEditing'), "close-modal")}${btn(t('editor.discard'), "dirty-discard", "danger")}${btn(t('editor.saveFile'), "dirty-save", "primary")}`;
            break;
        case "dirty-settings":
            title = t('dirtySettings.title');
            body =
                `<p>${t('dirtySettings.body')}</p>`;
            footer = `${btn(t('dirty.keepEditing'), "close-modal")}${btn(t('editor.discard'), "dirty-config-discard", "danger")}${btn(t('settings.saveChanges'), "dirty-config-save", "primary")}`;
            break;
        case "webdav":
            title = t('files.connectWebdav');
            body = `<p>${t('webdav.note')}</p><ol class="steps"><li>${t('webdav.step1', { command: '<code>piwork-cli proxy</code>' })}</li><li>${t('webdav.step2')}</li><li>${t('webdav.step3')}</li></ol><label class="field">${t('webdav.address')}<code class="copy-field">http://127.0.0.1:&lt;printed-port&gt;/works/${esc(target?.id)}/files/</code></label><p class="muted">${t('webdav.footnote')}</p>`;
            footer = close();
            break;
        case "refresh-core-skills":
            title = t('coreSkills.title');
            body = `<p>${t('coreSkills.body')}</p>`;
            footer = `${cancel()}${btn(t('coreSkills.refresh'), "confirm-core-skills", "primary", view.configDirty ? "disabled" : "")}`;
            break;
        case "skill-detail": {
            const s = adapter.getSkills().find((x) => x.id === view.data.id);
            title = esc(s?.name || t('term.skill'));
            body = `<dl><dt>${t('skillDetail.description')}</dt><dd>${esc(s?.description || t('text.notProvided'))}</dd><dt>${t('skillDetail.version')}</dt><dd>${esc(s?.version || t('text.notProvided'))}</dd><dt>${t('skillDetail.loaded')}</dt><dd>${target ? skillState(target, view.data.id, "loaded") : t('text.notProvided')}</dd><dt>${t('skillDetail.visible')}</dt><dd>${target ? skillState(target, view.data.id, "modelVisible") : t('text.notProvided')}</dd></dl><p class="muted">${t('skillDetail.note')}</p>`;
            footer = close();
            break;
        }
        case "remove-package-confirm":
            title = t('package.removeTitle');
            body = `<p>${t('package.removeBody', { name: esc(view.data.id) })}</p>`;
            footer = `${cancel()}${btn(t('package.removeButton'), "confirm-remove-package", "danger")}`;
            break;
        case "package-detail": {
            const p = adapter.getPackages().find((x) => x.name === view.data.id);
            const entry = target?.packageEntries?.find(p => p.name === view.data.id);
            title = esc(view.data.id);
            body = `${target?.resourceErrors?.packages ? feedback(t('package.observationUnavailable', { error: esc(target.resourceErrors.packages) }), "warning") : ""}${view.data.id === "piwork-brain" ? `<p>${t('package.editableSource', { path: '<code>.pi/packages/piwork-brain/</code>' })}</p>${btn(t('package.openBrain'), "open-source", "small", 'data-path="/.pi/packages/piwork-brain/brain.md"')}${brainCandidateDetails(entry)}` : `<pre class="code-editor">${esc(JSON.stringify(entry ?? p ?? { name: view.data.id }, null, 2))}</pre>`}<p class="muted">${t('package.statesNote')}</p>`;
            footer = `${close()}${target ? btn(t('package.refresh'), "refresh-package-detail", "small") : ""}`;
            break;
        }
        case "install-package":
            title = view.data.update ? t('package.updateTitle') : t('package.installTitle');
            body = `${uploadProgressMarkup()}<p>${t('package.chooseSource')}</p><label class="field">${t('package.sourceType')}<select id="install-type">${["Core", "npm", "Git", "Local directory", "ZIP"].map((option) => `<option ${view.installType === option ? "selected" : ""}>${option}</option>`).join("")}</select></label>${view.installType === "Core"
                ? `<label class="field">${t('package.currentCoreCopy')}<select id="install-name">${adapter
                    .getPackages()
                    .map((p) => `<option ${view.installName === p.name ? "selected" : ""}>${esc(p.name)}</option>`)
                    .join("")}</select></label>`
                : view.installType === "npm" || view.installType === "Git"
                    ? `<label class="field">${view.installType === "npm" ? t('package.npmReference') : t('package.gitSource')}<input id="install-source" value="${esc(view.installSource)}" placeholder="${view.installType === "npm" ? "@scope/package@version" : esc(t('package.gitPlaceholder'))}"></label>`
                    : `<div class="file-drop">${icon("upload", 26)}<strong>${view.installSource ? esc(view.installSource) : (view.installType === "ZIP" ? t('package.selectZip') : t('package.selectDirectory'))}</strong>${btn(t('package.chooseLocal'), "choose-package-source")}</div>${view.installType === "Local directory" ? feedback(t('package.directoryWarning'), "warning") : ""}`}<p class="muted">${t('package.installNote')}</p>`;
            footer = `${cancel()}${btn(view.data.update ? t('package.updateButton') : t('settings.installPackage'), "confirm-install", "primary")}`;
            break;
        case "log-export": {
            title = t('logs.title');
            const state = adapter.logExport;
            if (!state) {
                body = `<p>${t('logs.none')}</p>`;
                footer = `${close()}${adapter.state.core.role === "admin" ? btn(t('logs.title'), "export-logs-again", "primary") : ""}`;
                break;
            }
            const label = state.phase === "creating" ? t('logs.preparing') : state.phase === "collecting" ? t('logs.collecting') : state.phase === "packing" ? t('logs.packing') : state.phase === "ready" ? (state.delivered ? t('logs.delivered') : t('logs.ready')) : state.phase === "unknown" ? t('logs.unknown') : state.phase === "expired" ? t('logs.expired') : t('logs.failed');
            const progress = state.total ? t('logs.sources', { processed: state.processed, total: state.total }) : "";
            const warnings = state.warnings.length ? `<div class="menu-list">${state.warnings.slice(0, 5).map(w => `<p>${esc(w.message)}</p>`).join("")}</div>` : "";
            body = `<p>${t('logs.body')}</p><p role="status">${pendingStatus(label, 'check-log-export download-log-export')}${progress}</p>${state.error ? feedback(esc(state.error), state.phase === "failed" || state.phase === "interrupted" ? "warning" : "info") : ""}${state.phase === "ready" ? `<p>${esc(state.filename)} · ${t('logs.size', { size: formatNumber(state.size) })}${state.expiresAt ? t('logs.expires', { time: esc(formatDateTime(state.expiresAt)) }) : ""}</p>` : ""}${state.phase === "ready" && state.complete === false ? `<p role="status">${t('logs.gaps', { count: state.warningCount })}</p>` : ""}${warnings}<p class="muted">${icon("lock", 14)} ${t('logs.footnote')}</p>`;
            footer = `${close()}${state.phase === "ready" && state.filename ? btn(t('logs.downloadAgain'), "download-log-export", "primary") : ""}${state.phase === "unknown" ? btn(t('logs.retrySame'), "retry-log-export", "primary") : ""}${["collecting", "packing", "creating"].includes(state.phase) || (state.id && state.error) ? btn(t('quick.checkStatus'), "check-log-export") : ""}${["failed", "interrupted", "expired"].includes(state.phase) ? btn(t('logs.exportAgain'), "export-logs-again", "primary") : ""}`;
            break;
        }
        case "export": {
            const panel = exportPanel(target);
            title = panel.title;
            body = panel.body;
            footer = panel.footer;
            break;
        }
        case "import":
            title = t('import.title');
            body = `<p>${adapter.hosted ? t('import.hostedBody') : t('import.localBody', { package: '<code>.work</code>' })}</p><div class="file-drop">${icon("upload", 28)}<strong>${esc(view.inspectFilename || t('import.choosePackage'))}</strong>${btn(t('import.chooseFile'), "choose-work-file", "", adapter.inspectionContext && adapter.inspectionContext.importState !== "unsubmitted" ? "disabled" : "")}</div>${adapter.transferProgress ? feedback(`${['receiving', 'uploading', 'validating', 'inspecting', 'verifying'].includes(adapter.transferProgress.phase) ? pendingStatus(t('import.transfer', { phase: adapter.transferProgress.phase }), 'work-file-input confirm-import') : ''}${progressText(adapter.transferProgress)}${adapter.transferProgress.error ? ` · ${esc(adapter.transferProgress.error)}` : ''}`) : ""}${adapter.inspection ? `${feedback(adapter.hosted ? t('import.verifiedServer') : t('import.verifiedLocal'), "success")}<div class="inspection-summary"><h3>${t('import.summary')}</h3><pre>${esc(JSON.stringify(adapter.inspection, null, 2))}</pre><p>${t('import.note')}</p></div><label class="field">${t('import.workName')} <span>${t('create.optional')}</span><input id="import-name" value="${esc(view.importName)}" aria-label="${t('import.workName')}" aria-describedby="import-name-help${currentNameError() ? ' import-name-error' : ''}" ${currentNameError() ? 'aria-invalid="true"' : ""} placeholder="${t('import.namePlaceholder')}"><span id="import-name-help">${t('import.nameHelp')}</span>${nameFieldError("import-name-error", true)}</label>` : ""}`;
            body += adapter.inspectionContext && adapter.inspectionContext.importState !== "unsubmitted" ? feedback(t('import.original', { state: esc(adapter.inspectionContext.importState), transfer: `<code>${esc(adapter.inspectionTransfer)}</code>` }), "warning", btn(t('import.checkOriginal'), "check-inspection-import", "small") + btn(t('ops.known'), "operations", "small")) : "";
            footer = `${cancel()}${adapter.inspection && adapter.inspectionContext?.importState === "unsubmitted" ? btn(adapter.state.signedIn ? t('import.title') : t('import.signIn'), adapter.state.signedIn ? "confirm-import" : "import-sign-in", "primary") : ""}`;
            break;
        case "operations": {
            title = view.data.workId ? t('ops.related') : t('ops.known');
            const scope = `${adapter.state.core.address} · ${adapter.state.core.account}`;
            const operations = adapter.state.operations.filter((o) => o.scope === scope && (!view.data.workId || o.workId === view.data.workId));
            body = `<p>${adapter.hosted ? t('ops.hostedBody') : t('ops.localBody')}</p><label class="field">${t('ops.findOperation')}<div class="input-action"><input id="operation-query" value="${esc(view.operationQuery)}" placeholder="op-…">${btn(t('quick.checkStatus'), "lookup-operation")}</div></label><label class="field">${t('ops.findSnapshot')}<div class="input-action"><input id="snapshot-query" value="${esc(view.snapshotQuery)}" placeholder="snapshot-…">${btn(t('ops.findSnapshotButton'), "lookup-snapshot")}</div></label><div class="operation-list">${operations.length ? operations.map((op) => `<button data-action="operation" data-id="${op.id}"><span>${icon("clock", 17)}<span><strong>${esc(op.kind)}</strong><small>${op.id} · ${op.updated}</small></span></span>${badge(op.state)}</button>`).join("") : `<p class="muted">${t('ops.none')}</p>`}</div><p class="muted">${adapter.hosted ? t('ops.hostedNote') : t('ops.localNote')}</p>`;
            footer = `${close()}${btn(t('ops.clear'), "clear-operations", "quiet", operations.length ? "" : "disabled")}`;
            break;
        }
        case "operation": {
            const op = adapter.getOperation(view.data.id);
            title = op ? esc(op.kind) : t('ops.notFoundTitle');
            body = op
                ? `${phase(op)}${importNameFeedback(op)}${op.action && adapter.getWork(op.workId) ? `<div class="operation-work-status">${t('ops.workLine', { status: workStatus(adapter.getWork(op.workId)) + quickAction(adapter.getWork(op.workId)) })}</div>` : ""}${feedback(t('ops.phaseNote', { phase: esc(op.phase), note: op.state === "accepted" || op.state === "preparing" ? t('ops.acceptedNote') : op.state === "unknown" ? t('ops.unknownNote') : op.state === "succeeded" ? t('ops.succeededNote') : "" }), op.state === "failed" ? "warning" : op.state === "succeeded" ? "success" : "info")}<dl><dt>${t('ops.operationId')}</dt><dd><code>${op.id}</code>${btn(icon("copy", 14), "copy", "icon-button quiet", `data-copy="${op.id}" aria-label="${t('ops.copyId')}"`)}</dd><dt>${t('ops.workId')}</dt><dd><code>${op.workId}</code></dd><dt>${t('ops.state')}</dt><dd>${badge(op.state)}</dd><dt>${t('ops.lastConfirmed')}</dt><dd>${op.updated}</dd>${op.snapshotId ? `<dt>${t('ops.snapshotId')}</dt><dd><code>${op.snapshotId}</code></dd>` : ""}</dl>${op.error ? feedback(esc(op.error), "warning") : ""}${op.observationError ? feedback(t('ops.observationInterrupted', { error: esc(op.observationError) }), "warning") : ""}${op.localRecordSaved === false ? feedback(t('ops.localSaveFailed'), "warning") : ""}`
                : `<p>${t('ops.notKnown')}</p>`;
            if (op?.kind === 'Import Work' && op.state === 'succeeded') { // i18n-exempt: server operation kind
                const imported = adapter.getWork(op.workId), start = importStarts.get(op.id);
                const stopped = imported?.status === 'Stopped' && imported.desired === 'stopped' && !imported.statusError;
                title = start ? t('ops.importStartProgress') : stopped ? t('ops.importNotStarted') : t('ops.importedWork');
                body = `<p>${start ? t('ops.importStartBody') : stopped ? t('ops.importStoppedBody') : t('ops.importDoneBody')}</p>${start ? `<dl><dt>${t('ops.originalImport')}</dt><dd><code>${esc(op.id)}</code></dd><dt>${t('ops.originalStart')}</dt><dd>${start.startId ? `<code>${esc(start.startId)}</code>` : esc(start.phase)}</dd></dl>${controlMarkup(workControls.get(op.workId))}` : ''}${body}`;
            }
            footer = `${close()}${op ? btn(t('quick.checkStatus'), "check-operation", "", `data-id="${op.id}"`) : ""}${op && !["succeeded", "failed", "superseded"].includes(op.state) ? btn(adapter.operationPaused(op.id) ? t('ops.resume') : t('ops.pause'), adapter.operationPaused(op.id) ? "resume-operation" : "pause-operation", "", `data-id="${op.id}"`) : ""}${op?.state === "succeeded" && op.kind === "Import Work" ? importExitButtons(op) : op?.state === "succeeded" && op.kind === "Create Work" ? workLink(t('quick.openWork'), op.workId, 'primary') : op?.snapshotId ? btn(t('ops.viewSnapshot'), "view-snapshot", "primary", `data-id="${esc(op.snapshotId)}" data-work-id="${esc(op.workId)}"`) : ""}`;
            break;
        }
    }
    const role = overlayRole(view.modal);
    if (role === 'menu') {
        // Command rows get a menu role only when they do not already carry one;
        // language rows keep their radio-menu semantics.
        body = body.replaceAll('<div class="menu-list', '<div role="group" class="menu-list').replace(/<button (?![^>]*\brole=)/g, '<button role="menuitem" tabindex="-1" ');
        return `<dialog id="modal" role="menu" aria-label="${title}" class="modal anchored-overlay command-dropdown"><div class="dropdown-title">${title}</div><div class="modal-body">${view.modalError ? feedback(esc(view.modalError), 'warning') : ''}${body}</div></dialog>`;
    }
    return `<dialog id="modal" aria-modal="${role !== 'modal' || view.modal === 'export' || isRequestInspector() && innerWidth >= 900 ? 'false' : 'true'}" aria-labelledby="modal-title" class="modal ${role === 'popover' ? 'anchored-overlay selection-popover' : role === 'drawer' ? 'inspector-drawer' : ''} ${isRequestInspector() ? 'request-inspector' : ''} ${view.modal === 'account' ? 'account-menu' : view.modal === 'export' ? 'export-panel' : ''} ${view.modal === 'new-folder' || view.modal === 'file-transfer' && view.data.transfer === 'rename' ? 'modal-name' : ''} ${view.modal === "new-work" ? "modal-create" : ""} ${view.modal === 'chat-response-settings' ? 'chat-response-settings' : ''} ${view.modal === 'sessions' ? 'session-picker' : ''} ${["new-work", "import", "manage-services", "operations", "service-details"].includes(view.modal) ? "wide" : ""}"><div class="modal-head">${view.modal === 'pi-request-detail' && requestNavigationCurrent() ? btn(`${icon('arrow', 16)} ${t('pi.back')}`, 'back-pi-requests', 'quiet inspector-back') : ''}<h2 id="modal-title">${title}</h2>${btn(icon("close", 20), "close-modal", "icon-button quiet", `aria-label="${t('modal.closeDialog')}"`)}</div><div class="modal-body">${view.modalError && view.modal !== "new-work" && !(view.modal === 'sessions' && view.modalError === target?.resourceErrors?.agent) ? feedback(esc(view.modalError), "warning") : ""}${body}${["file-transfer", "file-delete", "new-folder", "upload-overwrite"].includes(view.modal) ? fileModalResults() : ""}</div><div class="modal-action-status ${view.modal === "new-work" ? "create-action-status" : ""}" data-action-status-slot>${view.modal === "new-work" && view.modalError ? feedback(esc(view.modalError), "warning") : ""}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ""}</dialog>`;
}
function importExitButtons(op) {
    const work = adapter.getWork(op.workId), start = importStarts.get(op.id);
    const allow = importCanStart(op, work, work ? adapter.project(work).action : '', !!start);
    return `${work ? workLink(t('import.viewWork'), work.id) : ''}${allow ? btn(t('import.startAndOpen'), 'start-import-open', 'primary', `data-id="${esc(op.workId)}" data-import-id="${esc(op.id)}"`) : start && work && controlReady(workControls.get(work.id), work) ? btn(t('quick.openWork'), 'open-work', 'primary', `data-id="${esc(work.id)}"`) : ''}`;
}
/** Safe technical fields are text only; a correlation id never links to another Operation. */
function serviceDiagnostics(s) {
    const diagnostic = s.diagnostic;
    if (!diagnostic)
        return '';
    const rows = [
        diagnostic.code ? `<dt>${t('diag.errorCode')}</dt><dd><code>${esc(diagnostic.code)}</code></dd>` : '',
        diagnostic.stage ? `<dt>${t('diag.stage')}</dt><dd><code>${esc(diagnostic.stage)}</code></dd>` : '',
        diagnostic.exitCode !== undefined ? `<dt>${t('diag.exitCode')}</dt><dd><code>${diagnostic.exitCode}</code></dd>` : '',
        diagnostic.remediation ? `<dt>${t('diag.remediation')}</dt><dd>${esc(diagnostic.remediation)}</dd>` : '',
        diagnostic.correlationId ? `<dt>${t('diag.correlationId')}</dt><dd><code>${esc(diagnostic.correlationId)}</code></dd>` : '',
        diagnostic.retryable !== undefined ? `<dt>${t('diag.retryable')}</dt><dd>${diagnostic.retryable ? t('diag.yes') : t('diag.no')}</dd>` : '',
        diagnostic.cause?.message ? `<dt>${t('merge.originalFailure')}</dt><dd>${esc(diagnostic.cause.message)}${diagnostic.cause.exitCode !== undefined ? ` · ${t('merge.exitCodeValue', { code: diagnostic.cause.exitCode })}` : ''}</dd>` : '',
    ].join('');
    return rows ? `<details class="service-diagnostics"><summary>${t('diag.title')}</summary><dl class="property-list">${rows}</dl></details>` : '';
}
function serviceExplanation(s) {
    if (s.temporary?.mode === 'once' && s.observed === 'Failed')
        return `<div class="service-explanation"><h3>${serviceFailureTitle(s)}</h3><p>${s.temporary.exitCode !== undefined ? t('merge.onceFailedCode', { code: s.temporary.exitCode }) : t('merge.onceFailedUnknown')}</p>${s.enabled && s.diagnostic?.message ? `<p>${esc(s.diagnostic.message)}</p>` : ''}</div>`;
    if (s.observed === 'Failed')
        return `<div class="service-explanation"><h3>${serviceFailureTitle(s)}</h3><p>${esc(serviceFailureReason(s))}</p>${s.diagnostic?.remediation ? '' : `<p>${t('service.checkLogs')}</p>`}</div>`;
    if (!s.enabled || s.observed !== 'Ready')
        return `<div class="service-explanation"><h3>${t('service.stateLine', { name: esc(s.name), state: s.enabled ? esc(stateText(s.observed.toLowerCase())) : t('service.disabled') })}</h3><p>${esc(serviceUnavailableReason(s))}</p>${s.enabled && s.diagnostic?.message ? `<p>${esc(s.diagnostic.message)}</p>` : ''}</div>`;
    return '';
}
function temporaryCleanupMarkup(workId, kind, ref) {
    const state = adapter.temporaryCleanups.get(`${workId}:${kind}:${ref}`);
    if (!state)
        return '';
    const refresh = btn(t('merge.refreshCleanup'), 'refresh-temporary-cleanups', 'small', `data-kind="${kind}" data-ref="${esc(ref)}"`);
    if (state.loading)
        return `<section class="service-explanation"><h3>${t('merge.cleanupTitle')}</h3><p>${t('merge.checkingCleanup')}</p></section>`;
    if (state.error)
        return `<section class="service-explanation"><h3>${t('merge.cleanupTitle')}</h3><p>${t('merge.cleanupUnconfirmed')}</p>${feedback(esc(state.error), 'warning')}${refresh}</section>`;
    if (!state.items.length)
        return kind === 'service' ? `<section class="service-explanation"><h3>${t('merge.cleanupTitle')}</h3><p>${t('merge.noCleanup')}</p>${refresh}</section>` : '';
    const labels = { requested: t('merge.requested'), running: t('merge.inProgress'), pending: t('merge.waitingRetry'), completed: t('merge.confirmedComplete') };
    const reasons = { DOCKER_UNAVAILABLE: t('merge.dockerUnavailable'), TEMPORARY_CREATE_UNCONFIRMED: t('merge.createUnconfirmed'), WORK_OPERATION_FAILED: t('merge.cleanupStepFailed'), DIAGNOSTIC_PERSIST_FAILED: t('merge.cleanupPersistFailed') };
    const triggers = { 'run-succeeded': t('merge.runSucceeded'), 'run-failed': t('merge.runFailed'), 'run-cancelled': t('merge.runCancelled'), 'run-interrupted': t('merge.agentInterrupted'), 'agent-replaced': t('merge.agentReplaced'), 'work-stop': t('merge.workStopped'), 'work-delete': t('merge.workDeleted'), 'core-shutdown': t('merge.coreShutdown'), explicit: t('merge.explicitRequest') };
    const stages = { request: t('merge.cleanupRequested'), inspect: t('merge.inspectInstance'), stop: t('merge.stopInstance'), remove: t('merge.removeInstance'), release: t('merge.releaseCapacity'), retry: t('merge.retry'), logs: t('merge.archiveOutput') };
    const outcomes = { started: t('merge.started'), succeeded: t('merge.confirmed'), failed: t('merge.failed'), unconfirmed: t('merge.notConfirmed') };
    const items = state.items.map(item => `<article><p><strong>${esc(item.serviceId)}</strong> · ${esc(labels[item.state] || t('merge.statusNotConfirmed'))} · ${esc(stages[item.stage] || item.stage)}</p><p>${t('merge.triggeredBy', { event: esc(triggers[item.trigger] || t('merge.unconfirmedEvent')) })}</p>${item.errorCode ? `<p>${esc(reasons[item.errorCode] || t('merge.reasonUnconfirmed'))}</p>` : ''}${item.logState === 'unavailable' ? `<p>${t('merge.outputUnavailable')}</p>` : item.logState === 'partial' ? `<p>${t('merge.outputPartial')}</p>` : ''}${item.operationId ? btn(t('merge.viewOperation'), 'check-operation', 'text-button', `data-id="${esc(item.operationId)}"`) : ''}<details><summary>${t('merge.cleanupLog')}${item.truncated ? t('merge.olderEntries') : ''}</summary>${item.events.map(event => `<p>${esc(event.at)} · ${esc(stages[event.stage] || event.stage)} · ${esc(outcomes[event.outcome] || event.outcome)}${event.code ? ` · ${esc(event.code)}` : ''}</p>`).join('')}</details></article>`).join('');
    return `<section class="service-explanation"><h3>${t('merge.cleanupTitle')}</h3>${items}${state.truncated ? `<p>${t('merge.olderRecords')}</p>` : ''}${refresh}</section>`;
}
function serviceDetails(s, w) {
    const logs = adapter.serviceLogs(w.id, s.id), control = serviceControls.get(`${w.id}:${s.id}`);
    const op = control?.operationId ? adapter.getOperation(control.operationId) : undefined, port = s.ports.includes(view.port) ? view.port : s.ports[0];
    const open = serviceCompletionReady(op, w.id, adapter.project(w).usable, s, port) ? btn(t('service.open'), 'open-controlled-service', 'primary', `data-service-id="${esc(s.id)}" data-port="${port}"`) : '';
    const currentService = route()[0] === 'app' ? w.services.find(item => item.id === route()[2]) : activeService(w);
    const entryChoice = s.ports.length > 1 && currentService?.id === s.id
        ? `<label class="field">${t('service.webEntry')}<select id="port-select" data-service-id="${esc(s.id)}" ${!adapter.project(w).usable || !s.enabled || s.observed !== 'Ready' ? 'disabled' : ''}>${s.ports.map(item => `<option value="${item}" ${item === port ? 'selected' : ''}>${t('service.port', { port: item })}</option>`).join('')}</select></label>` : '';
    const ordinaryControls = s.temporary ? '' : `${btn(t('service.start'), "service-action", "small", `data-control="start" data-id="${s.id}" ${!adapter.project(w).usable || s.observed === "Ready" ? "disabled" : ""}`)}${btn(t('service.stop'), "service-action", "small", `data-control="stop" data-id="${s.id}" ${!adapter.project(w).usable || !s.enabled ? "disabled" : ""}`)}${btn(t('service.restart'), "service-action", "small", `data-control="restart" data-id="${s.id}" ${!adapter.project(w).usable || !s.enabled || s.observed !== "Ready" ? "disabled" : ""}`)}${btn(t('service.retryAction'), "service-action", "small", `data-control="retry" data-id="${s.id}" ${!adapter.project(w).usable || !s.enabled || s.observed !== "Failed" ? "disabled" : ""}`)}`;
    const temporaryFacts = s.temporary ? `<dt>${t('merge.lifetime')}</dt><dd>${t('merge.runTemporary')} · ${esc(s.temporary.mode)}</dd>${s.temporary.exitCode !== undefined ? `<dt>${t('diag.exitCode')}</dt><dd>${s.temporary.exitCode}</dd>` : ''}` : '';
    return `${controlMarkup(control)}${open}${entryChoice}${serviceExplanation(s)}<dl class="property-list"><dt>${t('service.domain')}</dt><dd><code>${esc(s.domain)}</code></dd><dt>${t('service.declaredPortsTitle')}</dt><dd>${s.ports.length ? s.ports.join(", ") : t('service.noPorts')}</dd><dt>${t('service.enabled')}</dt><dd>${s.enabled ? t('service.enabledPersists') : t('service.disabledPersists')}</dd><dt>${t('service.observed')}</dt><dd>${badge(s.observed)}</dd>${temporaryFacts}</dl>${serviceDiagnostics(s)}${s.temporary ? temporaryCleanupMarkup(w.id, 'service', s.id) : ''}<div class="service-controls">${ordinaryControls}${btn(t('service.remove'), "service-action", "small danger", `data-control="remove" data-id="${s.id}" ${!adapter.project(w).usable ? "disabled" : ""}`)}</div><div class="logs-heading"><h3>${t('service.logTitle')}</h3>${btn(`${icon("refresh", 14)} ${t('service.refreshLogs')}`, "refresh-logs", "small")}</div>${logs?.loading ? pendingStatus(t('service.readingLogs', { name: esc(s.name) }), 'service-details refresh-logs') : ""}${logs?.error ? feedback(esc(logs.error), "warning", btn(t('service.retryLogs'), "refresh-logs", "small")) : ""}<pre class="logs">${esc(logs?.value?.text ?? logs?.value?.reason ?? t('service.noLogs'))}</pre><p class="muted small-text">${esc(logs?.value?.status ?? t('service.notRetrieved'))} · ${t('service.collected', { time: esc(logs?.value?.collectedAt ?? t('text.notProvided')) })} · ${logs?.value?.truncated ? t('service.truncated') : t('service.bounded')}. ${t('service.notLive')}</p>`;
}
let focusReturn = "";
function focusKey(el) {
    if (!el)
        return "";
    if (el.id)
        return "#" + CSS.escape(el.id);
    const action = el.dataset.action;
    if (action)
        return `[data-action="${CSS.escape(action)}"]${el.dataset.id ? `[data-id="${CSS.escape(el.dataset.id)}"]` : ""}${el.dataset.path ? `[data-path="${CSS.escape(el.dataset.path)}"]` : ""}${el.dataset.runId ? `[data-run-id="${CSS.escape(el.dataset.runId)}"]` : ""}${el.dataset.optionValue !== undefined ? `[data-option-value="${CSS.escape(el.dataset.optionValue)}"]` : ''}`;
    return "";
}
async function guard(next) {
    if (dirty()) {
        pendingNav = next;
        openModal("dirty-file");
    }
    else if (view.configDirty) {
        pendingNav = next;
        openModal("dirty-settings");
    }
    else
        await next();
}
function runAndShow(op) {
    openModal("operation", { id: op.id });
}
function reviewOperation(op, check) {
    if (!check || !actions.current(check) || !op.checkedWorkId || op.state === 'unknown')
        return;
    for (const original of actions.records.values()) {
        if (original.blocked && original.work === op.checkedWorkId && original.businessId === op.id)
            actions.review(original);
    }
}
function targetWork(el) {
    return (adapter.getWork(el.dataset.id || (view.modal ? view.data.workId || view.data.id : '') || route()[1]) || current());
}
function assertFileAdmission(workId, targets) {
    const work = adapter.getWork(workId);
    if (!work || !adapter.project(work).usable)
        throw new Error(t('fileResults.notReady'));
    const conflict = unknownFiles.conflict(workId, targets);
    if (conflict)
        throw new Error(t('fileResults.earlierUnknown', { paths: conflict.paths.join(t('fileResults.pathJoin')) }));
}
function retainFileResults(workId, targets, rows, record) {
    const normalized = new FileMutationResults(targets);
    normalized.record(targets, rows);
    const results = [...normalized.results];
    if (results.some(result => result.status === 'unknown')) {
        for (const target of targets) {
            const belongs = (path) => [target.source, target.destination].some(root => root && (path === root || path.startsWith(root + '/')));
            if (results.some(result => result.status === 'unknown' && belongs(result.path)))
                unknownFiles.add(workId, target, record);
        }
        if (record && actions.current(record))
            record.blocked = true;
    }
    adapter.state.transfers = results;
    adapter.transfersByWork.set(workId, results);
    return results;
}
function confirmFileAttempt(record, results) {
    if (!record || !actions.current(record))
        return;
    // Only retainFileResults binds a lock to an actually submitted unknown path.
    // A cumulative summary must not copy an earlier unknown into a later retry.
    record.successFeedback = results.length && results.every(result => result.status === 'succeeded') ? 'toast' : undefined;
    actions.confirm(record, t('fileResults.summary', { confirmed: results.filter(result => result.status === 'succeeded').length, review: results.filter(result => result.status !== 'succeeded').length }));
}
async function performFileAttempt(attempt, targets, record) {
    const epoch = adapter.identityEpoch, origin = viewKey();
    if (record)
        attempt.feedbackRecords.add(record);
    const confirm = (results) => { for (const original of attempt.feedbackRecords)
        confirmFileAttempt(original, results); };
    for (const target of targets) {
        if (epoch !== adapter.identityEpoch || origin !== viewKey())
            throw new ViewChanged();
        assertFileAdmission(attempt.workId, [target]);
        const rows = await adapter.transfer(attempt.workId, attempt.operation, [target.source], target.destination, attempt.overwrite);
        if (epoch !== adapter.identityEpoch)
            throw new ViewChanged();
        const retained = retainFileResults(attempt.workId, [target], rows, record);
        attempt.ledger.record([target], retained);
        attempt.selected.delete(target.source);
        const combined = [...attempt.ledger.results];
        adapter.state.transfers = combined;
        adapter.transfersByWork.set(attempt.workId, combined);
        if (fileAttempt === attempt)
            modalTransfers = combined;
        if (origin !== viewKey()) {
            confirm(combined);
            throw new ViewChanged();
        }
        render();
    }
    const results = [...attempt.ledger.results];
    confirm(results);
    if (record)
        void actions.refresh(record, () => adapter.loadDirectory(attempt.workId, view.path));
    if (results.length && results.every(result => result.status === 'succeeded')) {
        view.selected = [];
        closeModal();
        toast(t('fileResults.saved'));
    }
    else {
        view.modalError = t('fileResults.review');
        render();
    }
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
                    : joinPath(view.formDestination, source.split('/').pop()),
            } : {}) }));
        const locks = [...new Set(targets.map(target => unknownFiles.conflict(current().id, [target])).filter(lock => !!lock))];
        rows = locks.flatMap(lock => lock.paths.map(path => ({ path, status: 'unknown', message: t('fileResults.unknownMessage') })));
    }
    if (!rows.length)
        return '';
    const eligible = fileAttempt?.ledger.retryTargets(fileAttempt.ledger.targets.map(target => target.source)) || [];
    return `<section class="transfer-results"><h3>${t('fileResults.title')}</h3>${rows.map(row => `<div class="transfer-row"><code>${esc(row.path)}</code><span>${esc(stateText(row.status))} · ${transferResultMessage(row)}</span></div>`).join('')}${eligible.map(target => `<label class="check-row"><input type="checkbox" data-retry-source="${esc(target.source)}" ${fileAttempt?.selected.has(target.source) ? 'checked' : ''}> ${t('fileResults.retry', { path: esc(target.source) })}</label>`).join('')}${eligible.length ? btn(t('fileResults.retrySelected'), 'retry-selected-files', 'small', fileAttempt?.selected.size ? '' : 'disabled') : ''}${rows.some(row => row.status === 'unknown') ? feedback(t('fileResults.unknown'), 'warning', btn(t('fileResults.refresh'), 'refresh-files', 'small')) : ''}</section>`;
}
async function saveFile(record) {
    const w = current();
    if (!w)
        return false;
    if (view.fileWriteUncertain)
        throw new Error(t('save.reread'));
    assertFileAdmission(w.id, [{ source: view.file }]);
    const content = view.fileDraft;
    const path = view.file, key = location.hash, epoch = adapter.identityEpoch;
    const result = await adapter.saveFile(w.id, path, content, view.fileBaseline, view.fileUnprotected, confirmed => {
        if (epoch !== adapter.identityEpoch)
            return;
        if (record && actions.current(record)) {
            record.successFeedback = 'toast';
            actions.confirm(record, t('save.savedShort'));
            if (!confirmed.modified) {
                record.refresh = 'refreshing';
                render();
            }
        }
        if (key === location.hash && view.file === path) {
            view.fileOriginal = content;
            view.fileBaseline = confirmed.modified || '';
            toast(t('save.savedConfirming'));
        }
    });
    if (epoch !== adapter.identityEpoch)
        throw new ViewChanged();
    retainFileResults(w.id, [{ source: path }], [result], record);
    if (record) {
        record.refresh = result.message === 'Confirmed' ? '' : 'failed';
        record.refreshError = result.message;
    }
    if (key !== location.hash || path !== view.file)
        throw new ViewChanged();
    if (result.status === "succeeded") {
        view.fileOriginal = content;
        view.fileBaseline = result.modified ?? "";
        view.fileUnprotected = false;
        view.fileReread = null;
        toast(result.message === "Confirmed" ? t('save.saved') : result.message);
        return true;
    }
    view.fileWriteUncertain = result.status === "unknown" || result.httpStatus === 412;
    view.modalError = result.message;
    toast(result.message);
    return false;
}
async function saveConfig(record) {
    const w = current();
    if (!w || !view.config)
        return false;
    if (!validateConfigDraft())
        return false;
    const submitted = structuredClone(view.config), version = JSON.stringify(view.config), key = location.hash;
    await adapter.saveConfiguration(w.id, submitted);
    if (record) {
        actions.confirm(record, t('save.settingsSaved'));
        void actions.refresh(record, () => adapter.loadConfiguration(w.id));
    }
    if (key !== location.hash)
        throw new ViewChanged();
    if (JSON.stringify(view.config) === version) {
        view.config = structuredClone(submitted);
        view.configDirty = false;
    }
    toast(t('save.changesSaved'));
    return true;
}
function validateConfigDraft() {
    if (!view.config)
        return false;
    try {
        synchronizeConfiguration(view.config);
        return true;
    }
    catch (error) {
        view.config.validationError = String(error.message);
        view.settingsTab = "Advanced";
        render();
        root.querySelector("#advanced-editor")?.focus();
        toast(t('save.fixJson'));
        return false;
    }
}
function downloadBlob(name, contents, type = "text/plain") {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(t('download.started'));
}
async function handleAction(action, el, record) {
    const ownedView = () => record?.kind === 'identity' ? location.hash : record && ['lifecycle', 'transfer'].includes(record.kind) ? `${location.hash}:${modalChoice}` : viewKey();
    const stay = async (pending) => { const key = ownedView(), modal = view.modal; const value = await pending; if (key !== ownedView() || record?.kind === 'identity' && !!view.modal && view.modal !== modal)
        throw new ViewChanged(); return value; };
    const accept = (op) => { if (record) {
        record.businessId = op.id;
        actions.confirm(record, t('action.accepted', { id: op.id }));
        if (op.workId)
            void actions.refresh(record, () => op.kind === 'Delete Work' ? adapter.listWorks() : adapter.loadWork(op.workId));
    } }; // i18n-exempt: server operation kind
    const show = (op) => { accept(op); runAndShow(op); };
    const filesConfirmed = (results) => {
        if (record) {
            confirmFileAttempt(record, results);
            record.blocked = results.some(result => result.status === 'unknown');
            if (currentWork)
                void actions.refresh(record, () => adapter.loadDirectory(currentWork.id, view.path));
        }
        if (results.some(result => result.status !== 'succeeded')) {
            view.modalError = t('fileResults.someNotConfirmed');
            render();
            return false;
        }
        return true;
    };
    const w = targetWork(el);
    const currentWork = current();
    const s = currentWork ? activeService(currentWork) : undefined;
    if (currentWork && !adapter.project(currentWork).usable && ['new-session', 'send-message', 'apply-config', 'service-action', 'confirm-service-control', 'save-file', 'dirty-save', 'confirm-upload-overwrite', 'confirm-folder', 'confirm-transfer', 'confirm-file-delete', 'retry-selected-files', 'cancel-pi-request', 'retry-pi-request'].includes(action))
        throw new Error(t('fileResults.notReadyRuntime'));
    switch (action) {
        case 'language': {
            const fromMenu = view.modal === 'account' || view.modal === 'work-menu';
            const destination = view.modal === 'account' ? '[data-action="account"]' : '[data-action="work-menu"]';
            const key = el.dataset.languageTrigger || 'topbar';
            const trigger = root.querySelector(`[data-language-trigger="${key}"]`) || el;
            languagePicker.open(trigger, {
                anchorRect: fromMenu ? root.querySelector(destination)?.getBoundingClientRect() : undefined,
                beforeOpen: () => { if (fromMenu)
                    closeModal(false); },
                restoreFocus: () => root.querySelector(fromMenu ? destination : `[data-language-trigger="${key}"]`),
            });
            break;
        }
        case 'save-default-core':
            await adapter.savePreferences(view.coreAddress || adapter.state.core.address);
            break;
        case 'clear-default-core':
            await adapter.savePreferences(null);
            break;
        case 'read-default-core':
            await adapter.loadPreferences();
            break;
        case 'open-chat-settings':
            openChatPicker();
            break;
        case 'toggle-chat-setting': {
            if (!chatSettingsContextCurrent())
                break;
            const kind = el.dataset.kind;
            view.data.expanded = view.data.expanded === kind ? '' : kind;
            render();
            focusChatSettings(kind);
            break;
        }
        case 'chat-input-options':
            openModal('chat-input-options');
            break;
        case 'choose-chat-setting': {
            if (!currentWork || !chatSettingsContextCurrent())
                break;
            const kind = el.dataset.kind;
            const { state, catalog, editable, thinkingEditable } = chatSettings(currentWork, view.session);
            if (!editable || kind === 'thinking' && !thinkingEditable)
                break;
            view.data.expanded = '';
            if (kind === 'model') {
                const ref = el.dataset.optionValue || null, model = ref === null ? catalog?.defaultModel : catalog?.models.find(m => m.modelRef === ref);
                if (!model)
                    break;
                const thinking = model.thinkingLevels && (state.thinking === null || !model.thinkingLevels.includes(state.thinking)) ? model.defaultThinkingLevel ?? 'off' : state.thinking;
                if (ref !== state.ref || thinking !== state.thinking)
                    adapter.selectModel(currentWork.id, view.session, ref);
            }
            else if (el.dataset.optionValue !== state.thinking)
                adapter.selectThinking(currentWork.id, view.session, el.dataset.optionValue === 'normal' ? null : el.dataset.optionValue);
            if (pendingWebCommand && pendingWebCommand.kind === kind) {
                const state = adapter.modelSelection(currentWork.id, view.session);
                Object.assign(pendingWebCommand, { workId: currentWork.id, sessionId: view.session, pair: { ref: state.ref, thinking: state.thinking } });
            }
            confirmPendingChatCommand();
            render();
            focusChatSettings(kind);
            break;
        }
        case 'service-picker':
            openModal('service-picker');
            root.querySelector('#modal [aria-selected=true]')?.focus();
            break;
        case 'select-service': {
            const service = currentWork?.services.find(item => item.id === el.dataset.id && item.ports.length && item.observed !== 'Removed');
            if (!currentWork || !service)
                break;
            const port = service.ports[0];
            serviceChoice++;
            view.serviceOpenError = '';
            view.service = service.id;
            view.port = port;
            if (route()[0] === 'app') {
                history.replaceState(null, '', `#/app/${encodeURIComponent(currentWork.id)}/${encodeURIComponent(service.id)}/${port}`);
                lastRoute = location.hash;
            }
            closeModal();
            render();
            if (service.enabled && service.observed === 'Ready')
                await stay(adapter.ensureServiceEntry(currentWork.id, service.id, port));
            break;
        }
        case 'toggle-workspace-chat': {
            if (!currentWork || view.tab !== 'Services' || view.layout !== 'workspace')
                break;
            const panels = workspacePanels.get(currentWork.id);
            if (innerWidth < 900)
                panels.narrowChat = !panels.narrowChat;
            else
                panels.collapsed = !panels.collapsed;
            render();
            [...root.querySelectorAll('[data-action="toggle-workspace-chat"]')].find(node => node.getClientRects().length)?.focus({ preventScroll: true });
            break;
        }
        case 'reset-workspace-split':
            if (currentWork && route()[0] === 'work' && route()[2] !== 'settings') {
                workspacePanels.get(currentWork.id).ratio = .7;
                closeModal();
                render();
                root.querySelector('#workspace-splitter')?.focus();
            }
            break;
        case 'back-pi-requests':
            backToRequests();
            break;
        case 'service-focus':
            enterWorkspaceFocus(route()[0] === 'app' ? 'service-only' : 'service-chat', el);
            break;
        case 'focus-toggle-chat':
            if (view.layout === 'service-chat' || view.layout === 'service-only') {
                view.layout = view.layout === 'service-chat' ? 'service-only' : 'service-chat';
                render();
                if (view.layout === 'service-chat')
                    root.querySelector('#composer')?.focus();
                else
                    restoreLayoutFocus();
            }
            break;
        case 'restore-layout':
            if (view.modal === 'agent-menu')
                closeModal();
            restoreChatLayout();
            break;
        case 'exit-service-focus':
            await exitWorkspaceFocus();
            break;
        case 'service-fullscreen':
            if (['agent-menu', 'service-menu'].includes(view.modal))
                closeModal();
            try {
                if (document.fullscreenElement === root)
                    await document.exitFullscreen();
                else if (root.requestFullscreen)
                    await root.requestFullscreen();
                else
                    throw new Error();
                view.fullscreenError = '';
            }
            catch {
                view.fullscreenError = document.fullscreenElement === root ? t('action.fullscreenClose') : t('action.fullscreenOpen');
            }
            render();
            break;
        case 'choose-command':
            fillCommand(el.dataset.command);
            break;
        case 'load-commands':
            if (currentWork)
                await adapter.loadCommands(currentWork.id);
            break;
        case 'toggle-slash-mode':
            view.literalSlash = !view.literalSlash;
            render();
            break;
        case 'check-chat-submission':
            if (currentWork) {
                const result = await stay(adapter.recoverChatSubmission(currentWork.id));
                if (result) {
                    if (result.kind === 'run') {
                        const submitted = pendingImageSubmissions.get(currentWork.id);
                        if (submitted && submitted.epoch === adapter.identityEpoch) {
                            consumeImageSubmission(currentWork.id, submitted);
                        }
                    }
                    if (result.kind === 'session') {
                        const original = view.drafts[draftKey(currentWork)] || '';
                        view.session = result.session.sessionId;
                        if (original && !view.drafts[draftKey(currentWork)])
                            view.drafts[draftKey(currentWork)] = original;
                    }
                    for (const old of actions.records.values())
                        if (old.blocked && old.work === currentWork.id && old.kind === 'agent' && (result.kind === 'session' ? old.action === 'new-session' || old.action === 'send-message' : old.action === 'send-message'))
                            actions.review(old);
                }
                render();
            }
            break;
        case "close-modal":
            closeModal();
            break;
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
                await openWork(w, record);
            }
            break;
        case "clear-search":
            view.search = "";
            render();
            root.querySelector('#search')?.focus({ preventScroll: true });
            break;
        case "operations":
            await stay(adapter.recoverOperations());
            openModal("operations");
            break;
        case "new-work":
            if (createDraft.open())
                resetCreateFields();
            openModal('new-work');
            break;
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
            if (fileActionsContext) {
                closeFileActions(true);
                break;
            }
            fileActionsContext = fileActionsKey();
            render();
            root.querySelector('#file-actions [role=menuitem]')?.focus();
            break;
        }
        case "work-menu":
        case "work-info":
        case "delete-work":
        case "stop-work":
            openModal(action, { id: w?.id || "" });
            break;
        case 'sessions':
            openModal('sessions', { id: w?.id || '' });
            if (currentWork)
                await stay(adapter.loadSessions(currentWork.id));
            break;
        case "switch-core":
            void adapter.loadPreferences();
            openModal("switch-core");
            break;
        case "retry-session":
            await stay(adapter.initialize());
            if (adapter.state.sessionState === 'ready' && !adapter.state.signedIn)
                await stay(adapter.loadPreferences());
            break;
        case "sign-in": {
            const account = root.querySelector("#auth-account")?.value ?? "";
            const password = root.querySelector("#auth-password")?.value ?? "";
            try {
                await stay(adapter.signIn(view.coreAddress || adapter.state.core.address, account, password));
            }
            finally {
                const input = root.querySelector('#auth-password');
                if (input)
                    input.value = '';
            }
            if (importSignInSuspended && adapter.inspection) {
                importSignInSuspended = false;
                openModal("import");
            }
            else {
                importSignInSuspended = false;
                closeModal();
            }
            toast(t('action.signedIn'));
            break;
        }
        case "import-sign-in":
            importSignInSuspended = true;
            view.modal = "";
            render();
            toast(t('action.signInImport'));
            break;
        case "sign-out": {
            const result = await stay(adapter.signOut());
            if (adapter.hosted) {
                location.assign("/login");
                break;
            }
            view.drafts = {};
            textDraftRevisions.clear();
            imageDrafts.clear();
            pendingImageSubmissions.clear();
            imageDraftErrors.clear();
            view.config = null;
            view.configDirty = false;
            view.file = "";
            closeModal();
            toast(result.credentialCleared === false ? t('action.signOutCleanup', { command: adapter.logoutCommand() }) : result.remoteRevocationConfirmed ? t('action.signedOut') : t('action.signedOutUnconfirmed'));
            break;
        }
        case "reconnect":
            toast(t('action.reconnect'));
            break;
        case "confirm-switch-core":
            await stay(adapter.switchCore(view.coreAddress));
            view.drafts = {};
            textDraftRevisions.clear();
            imageDrafts.clear();
            pendingImageSubmissions.clear();
            imageDraftErrors.clear();
            view.config = null;
            view.configDirty = false;
            closeModal();
            break;
        case "retry-works":
            await stay(adapter.listWorks());
            break;
        case 'retry-services':
            if (currentWork)
                await stay(adapter.loadServices(currentWork.id));
            break;
        case 'load-earlier-history':
        case 'reload-history':
            if (currentWork && view.session)
                await adapter.loadEarlierHistory(currentWork.id, view.session, action === 'reload-history');
            break;
        case 'retry-conversation':
            if (view.modal === 'sessions' && view.modalError === currentWork?.resourceErrors?.agent)
                view.modalError = '';
            if (currentWork) {
                const selected = view.session;
                await stay(adapter.loadSessions(currentWork.id));
                if (selected && selected !== currentWork.sessions[0]?.id && currentWork.sessions.some(session => session.id === selected))
                    await stay(adapter.loadSession(currentWork.id, selected));
            }
            break;
        case "check-connection":
            await stay(adapter.checkConnection());
            toast(t('action.connectionChecked'));
            break;
        case "start-work":
            if (w)
                await submitWorkStart(w, record);
            break;
        case 'start-import-open': {
            const op = adapter.getOperation(el.dataset.importId || '');
            const importedWork = op && adapter.getWork(op.workId);
            if (!importCanStart(op, importedWork, importedWork ? adapter.project(importedWork).action : '', !!op && importStarts.has(op.id)))
                throw new Error(t('action.checkImported'));
            const intent = { workId: importedWork.id, importId: op.id, epoch: adapter.identityEpoch, origin: location.hash, choice: modalChoice, selection: `${areaChoice}:${serviceChoice}:${sessionChoice}:${fileChoice}`, consumed: false, phase: 'pending' };
            importStarts.set(op.id, intent);
            await submitWorkStart(importedWork, record, intent);
            advanceImportStarts();
            break;
        }
        case 'check-work-progress':
            if (w) {
                const control = workControls.get(w.id);
                if (control?.operationId)
                    await adapter.checkOperation(control.operationId);
                const checked = await adapter.refreshWorkStatus(w.id);
                await adapter.listWorks();
                if (checked?.id === w.id && checked.desired === 'running' && ['Ready', 'Degraded'].includes(checked.status) && control?.phase === 'unknown') {
                    control.phase = 'reviewed';
                    control.error = '';
                    for (const original of actions.records.values())
                        if (original.work === w.id && original.blocked && ['start-work', 'start-import-open'].includes(original.action || ''))
                            actions.review(original);
                }
                if (record && control?.operationId)
                    reviewOperation(adapter.getOperation(control.operationId), record);
                render();
            }
            break;
        case 'check-service-progress': {
            const serviceId = el.dataset.serviceId || view.data.serviceId, target = w, epoch = adapter.identityEpoch;
            if (target) {
                const control = serviceControls.get(`${target.id}:${serviceId}`);
                if (control?.operationId)
                    await adapter.checkOperation(control.operationId);
                await adapter.loadServices(target.id);
                if (epoch !== adapter.identityEpoch || adapter.getWork(target.id) !== target)
                    throw new ViewChanged();
                const checked = target.services.find(service => service.id === serviceId);
                const resolved = control?.phase === 'unknown' && !target.resourceErrors?.services && adapter.project(target).usable && (['start Service', 'restart Service', 'retry Service'].includes(control.action) && checked?.enabled && checked.observed === 'Ready' ||
                    control.action === 'stop Service' && checked?.enabled === false && checked.observed === 'Stopped' ||
                    control.action === 'remove Service' && !checked);
                if (resolved && control) {
                    control.phase = 'reviewed';
                    control.error = '';
                    for (const original of actions.records.values())
                        if (original.work === target.id && original.kind === 'service' && original.resource === `service:${serviceId}` && original.blocked)
                            actions.review(original);
                }
                render();
            }
            break;
        }
        case 'open-controlled-service': {
            if (!currentWork)
                break;
            const serviceId = el.dataset.serviceId, service = currentWork.services.find(item => item.id === serviceId);
            const control = serviceControls.get(`${currentWork.id}:${serviceId}`), op = control?.operationId && adapter.getOperation(control.operationId), port = Number(el.dataset.port);
            if (!serviceCompletionReady(op || undefined, currentWork.id, adapter.project(currentWork).usable, service, port))
                throw new Error(t('action.checkServiceReadiness'));
            await guard(async () => {
                areaChoice++;
                serviceChoice++;
                view.tab = 'Services';
                view.service = serviceId;
                view.port = port;
                if (route()[0] === 'app') {
                    history.replaceState(null, '', `#/app/${encodeURIComponent(currentWork.id)}/${encodeURIComponent(serviceId)}/${port}`);
                    lastRoute = location.hash;
                }
                closeModal();
                await adapter.ensureServiceEntry(currentWork.id, serviceId, port);
                render();
            });
            break;
        }
        case "confirm-stop":
            if (w && (view.data.exportAfterStop || el.dataset.exportStop))
                beginExport(w, true, record);
            else if (w)
                show(await stay(adapter.lifecycle(w.id, "stop")));
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
        case "retry-work-read":
            await loadRoute();
            break;
        case 'work-operations': {
            if (!w)
                break;
            const ids = adapter.project(w).operationIds;
            if (ids.length === 1)
                openModal('operation', { id: ids[0] });
            else
                openModal('operations', { workId: w.id });
            break;
        }
        case "check-work": {
            if (!w)
                break;
            const originals = [...actions.records.values()].filter(original => original.blocked && original.kind === 'lifecycle' && original.work === w.id && original.resource === w.id);
            const ids = adapter.project(w).operationIds;
            const op = ids.length === 1 ? await stay(adapter.checkOperation(ids[0])) : undefined;
            const checked = await stay(adapter.refreshWorkStatus(w.id));
            if (record && actions.current(record) && checked?.id === w.id) {
                for (const original of originals) {
                    const started = ['start-work', 'start-import-open'].includes(original.action || '') && checked.desired === 'running' && ['Ready', 'Degraded'].includes(checked.status);
                    const stopped = original.action === 'confirm-stop' && checked.desired === 'stopped' && checked.status === 'Stopped';
                    if (started || stopped) {
                        actions.review(original);
                        const control = workControls.get(w.id);
                        if (control?.phase === 'unknown') {
                            control.phase = 'reviewed';
                            control.error = '';
                        }
                    }
                }
            }
            if (op) {
                reviewOperation(op, record);
                openModal('operation', { id: op.id });
            }
            else {
                if (ids.length > 1)
                    openModal('operations', { workId: w.id });
                toast(t('action.workChecked'));
            }
            break;
        }
        case "toggle-create-advanced":
            view.createAdvanced = !view.createAdvanced;
            render();
            break;
        case "create-work": {
            if (!view.createName.trim()) {
                view.modalError = t('create.enterName');
                render();
                break;
            }
            const config = {};
            if (view.createJson.trim()) {
                let data;
                try {
                    data = JSON.parse(view.createJson);
                }
                catch {
                    throw Error(t('create.invalidJson'));
                }
                if (typeof data !== "object" || Array.isArray(data) || !data)
                    throw Error(t('create.jsonObject'));
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
            if (view.createAgents)
                config.agents = view.createAgents;
            if (record)
                latestCreateToken = record.token;
            const token = createDraft.capture(), origin = ownedView(), epoch = adapter.identityEpoch;
            const op = await adapter.createWork(view.createName.trim(), config, view.createImage);
            if (epoch !== adapter.identityEpoch)
                throw new ViewChanged();
            if (op.id && op.workId)
                createDraft.accept(token);
            if (record) {
                record.businessId = op.id;
                actions.confirm(record, t('action.accepted', { id: op.id }));
            }
            if (origin !== ownedView())
                throw new ViewChanged();
            show(op);
            break;
        }
        case "settings":
            if (!await exitWorkspaceFocus())
                break;
            if (w) {
                await guard(async () => {
                    location.hash = `/work/${w.id}/settings`;
                    if (record)
                        record.view = location.hash;
                    render();
                    await stay(adapter.loadConfiguration(w.id));
                    view.config = structuredClone(w.config);
                    view.configDirty = false;
                    consumeWebSelection("settings");
                    view.modal = "";
                    location.hash = `/work/${w.id}/settings`;
                    render();
                });
            }
            break;
        case "tab-Services":
        case "tab-Files":
        case "tab-Chat":
            if (!await exitWorkspaceFocus())
                break;
            await guard(async () => {
                areaChoice++;
                fileChoice++;
                filesRestoreNotice = "";
                if (currentWork && view.file)
                    adapter.releaseFilePreview(currentWork.id, view.file);
                if (view.file)
                    clearFileTarget();
                fileSourceReturn = undefined;
                view.tab = action.slice(4);
                view.modal = "";
                view.file = "";
                render();
                if (action === "tab-Services" && currentWork) {
                    await stay(adapter.loadServices(currentWork.id));
                    const service = activeService(currentWork);
                    if (service) {
                        view.service = service.id;
                        view.port = service.ports.includes(view.port) ? view.port : service.ports[0] || 0;
                        if (view.port && service.observed === "Ready")
                            await stay(adapter.ensureServiceEntry(currentWork.id, service.id, view.port));
                    }
                }
                if (action === "tab-Files" && currentWork)
                    await stay(adapter.loadDirectory(currentWork.id, view.path));
                view.tab = action.slice(4);
                view.modal = "";
                view.file = "";
                view.fileStatus = "idle";
                if (route()[2])
                    location.hash = `/work/${currentWork?.id}`;
                render();
            });
            break;
        case "focus-chat":
            if (route()[0] === 'work' && route()[2] !== 'settings')
                enterWorkspaceFocus('chat-only', el);
            break;
        case "toggle-agent":
            view.agentOpen = !view.agentOpen;
            render();
            break;
        case "select-session":
            sessionChoice++;
            view.session = el.dataset.id;
            consumeWebSelection('resume');
            closeModal();
            render();
            if (currentWork)
                await stay(adapter.loadSession(currentWork.id, view.session));
            closeModal();
            break;
        case "new-session":
            if (currentWork) {
                sessionChoice++;
                view.session = await stay(adapter.newSession(currentWork.id));
                if (record) {
                    record.businessId = view.session;
                    actions.confirm(record, t('action.sessionCreated'));
                }
                closeModal();
                render();
            }
            break;
        case "suggest-message":
        case "suggest-files":
            if (currentWork) {
                if (!view.session)
                    view.session = await stay(adapter.newSession(currentWork.id));
                textDraftRevisions.set(draftKey(currentWork), (textDraftRevisions.get(draftKey(currentWork)) || 0) + 1);
                view.drafts[draftKey(currentWork)] =
                    action === "suggest-message"
                        ? t('suggest.notes')
                        : t('suggest.files');
                render();
                root.querySelector("#composer")?.focus();
            }
            break;
        case "service-requests":
        case "pi-requests":
            if (currentWork) {
                const refreshing = view.modal === 'pi-requests', source = refreshing ? view.data.source || 'chat' : action === 'service-requests' ? 'service' : 'chat';
                const serviceName = refreshing ? view.data.serviceName || '' : source === 'service' ? s?.name || '' : '';
                if (!refreshing)
                    requestNavigation = { epoch: adapter.identityEpoch, workId: currentWork.id, source, serviceName, entry: focusKey(el), scroll: 0, focus: '' };
                openModal('pi-requests', { serviceName, source });
                await stay(adapter.loadRequests(currentWork.id, serviceName));
            }
            break;
        case "next-pi-requests":
            if (currentWork)
                await stay(adapter.loadRequests(currentWork.id, view.data.serviceName || '', true));
            break;
        case "pi-request-detail":
            if (currentWork) {
                const requestId = el.dataset.id || view.data.requestId, source = view.data.source || 'chat', serviceName = view.data.serviceName || '';
                if (view.modal === 'pi-requests' && requestNavigationCurrent())
                    Object.assign(requestNavigation, { serviceName, scroll: root.querySelector('.modal-body')?.scrollTop || 0, focus: focusKey(el) });
                if (view.modal !== 'pi-request-detail')
                    openModal('pi-request-detail', { requestId, source, serviceName });
                const pendingRetry = source === 'chat' ? adapter.requestRetries.get(`${currentWork.id}:${requestId}`) : undefined;
                if (pendingRetry) {
                    const result = await stay(adapter.checkRequestRetry(currentWork.id, requestId));
                    if (result) {
                        for (const old of actions.records.values())
                            if (old.blocked && old.work === currentWork.id && old.action === 'retry-pi-request' && old.resource === `request:${requestId}` && old.businessId === pendingRetry.submissionKey)
                                actions.review(old);
                        openModal('pi-request-detail', { requestId: result.requestId, source, serviceName });
                        await stay(adapter.loadRequest(currentWork.id, result.requestId));
                        break;
                    }
                }
                await stay(adapter.loadRequest(currentWork.id, requestId));
                for (const old of actions.records.values())
                    if (old.blocked && old.work === currentWork.id && old.action === 'cancel-pi-request' && old.resource === `request:${requestId}`)
                        actions.review(old);
            }
            break;
        case "next-pi-evidence":
            if (currentWork)
                await stay(adapter.loadRequest(currentWork.id, view.data.requestId, true));
            break;
        case "cancel-pi-request": {
            const requestId = el.dataset.id || view.data.requestId;
            const request = currentWork && (adapter.requestDetails.get(`${currentWork.id}:${requestId}`)?.request
                ?? adapter.requestPage(currentWork.id, view.data.serviceName || '')?.items.find(item => item.requestId === requestId));
            if (!canCancelPiRequest(request, !!currentWork && adapter.project(currentWork).usable) || currentWork && adapter.requestCancellation(currentWork.id, requestId))
                throw new Error(t('pi.checkLiveRequest'));
            if (currentWork)
                await stay(adapter.cancelRequest(currentWork.id, requestId));
            break;
        }
        case "retry-pi-request":
            if (currentWork) {
                const originalId = view.data.requestId, data = { ...view.data };
                try {
                    const result = await stay(adapter.retryRequest(currentWork.id, originalId));
                    openModal('pi-request-detail', { ...data, requestId: result.requestId });
                    await stay(adapter.loadRequest(currentWork.id, result.requestId));
                }
                catch (error) {
                    if (record && actions.current(record))
                        record.businessId = adapter.requestRetries.get(`${currentWork.id}:${originalId}`)?.submissionKey;
                    throw error;
                }
            }
            break;
        case "load-models":
            if (currentWork) {
                const error = adapter.models.get(currentWork.id)?.error;
                await stay(adapter.loadModels(currentWork.id).then(() => {
                    if (adapter.getWork(currentWork.id) === currentWork && error && currentWork.resourceErrors?.agent === error)
                        delete currentWork.resourceErrors.agent;
                }));
            }
            break;
        case "save-model":
            if (currentWork && view.session)
                await stay(adapter.saveModel(currentWork.id, view.session));
            break;
        case "check-session-model":
            if (currentWork && view.session)
                await stay(adapter.checkSessionModel(currentWork.id, view.session));
            break;
        case "about-piwork":
            openModal('about-piwork');
            adapter.loadAbout();
            break;
        case "refresh-about":
            adapter.loadAbout();
            break;
        case "check-image-support":
            if (currentWork)
                await stay(adapter.refreshImageCapabilities(currentWork.id));
            break;
        case "add-chat-images":
            root.querySelector('#chat-image-input')?.click();
            break;
        case "remove-chat-image":
            if (currentWork)
                imageDrafts.remove(draftKey(currentWork), el.dataset.id);
            break;
        case "retry-chat-image":
        case "preview-chat-image": {
            const session = currentWork?.sessions.find(s => s.id === el.dataset.session), image = session?.messages.flatMap(m => m.runId === el.dataset.run ? m.images ?? [] : []).find(i => i.imageIndex === Number(el.dataset.index));
            if (currentWork && session && image) {
                if (action === 'retry-chat-image')
                    adapter.retryHistoryImage(currentWork.id, session.id, el.dataset.run, image);
                else {
                    const state = adapter.imageLoads.get(adapter.historyImageKey(currentWork.id, session.id, el.dataset.run, image.imageIndex));
                    if (state?.url)
                        openModal('chat-image-preview', { url: state.url });
                }
            }
            break;
        }
        case "send-message":
            if (currentWork) {
                const cancelRunId = el.dataset.cancelRunId;
                const originalKey = draftKey(currentWork);
                const text = view.drafts[originalKey] || "";
                const images = imageDrafts.capture(originalKey), textRevision = textDraftRevisions.get(originalKey) || 0, error = imageDraftErrors.get(originalKey);
                if (images.length) {
                    const reason = adapter.imageInputReason(currentWork.id, view.session);
                    if (reason)
                        throw new Error(reason);
                }
                if (images.length && text.trimStart().startsWith('/') && !view.literalSlash)
                    throw new Error(t('chat.imagesText'));
                if (text.trimStart().startsWith('/') && !view.literalSlash) {
                    const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
                    const name = match?.[1] || '';
                    if (webCommands.includes(name)) {
                        if (match?.[2]?.trim())
                            throw new Error(t('chat.commandNoArgs'));
                        if (name === 'new') {
                            view.session = await stay(adapter.newSession(currentWork.id));
                        }
                        else if (name === 'resume') {
                            pendingWebCommand = { key: originalKey, text, kind: 'resume' };
                            openModal('sessions');
                            await stay(adapter.loadSessions(currentWork.id));
                            return;
                        }
                        else if (name === 'model' || name === 'thinking') {
                            pendingWebCommand = { key: originalKey, text, kind: name };
                            openChatPicker(name);
                            return;
                        }
                        else if (name === 'settings') {
                            pendingWebCommand = { key: originalKey, text, kind: name };
                            await handleAction('settings', el);
                            return;
                        }
                        if (view.drafts[originalKey] === text)
                            view.drafts[originalKey] = '';
                        render();
                        return;
                    }
                    if ((adapter.chatCapabilities.get(currentWork.id) ?? 0) < 1)
                        throw new Error(t('chat.resourceUnavailable'));
                    const directory = adapter.commands.get(currentWork.id);
                    if (!directory?.confirmed || directory.error || !directory.items.some(command => command.command === `/${name}`))
                        throw new Error(t('chat.unknownCommand'));
                }
                if (!view.session) {
                    view.session = await stay(adapter.newSession(currentWork.id));
                    render();
                    await stay(adapter.saveModel(currentWork.id, view.session));
                }
                adapter.selectedService = view.service;
                const submission = { key: originalKey, destinationKey: draftKey(currentWork), text, textRevision, images, epoch: adapter.identityEpoch, error };
                pendingImageSubmissions.set(currentWork.id, submission);
                let submittedRunId = "";
                try {
                    submittedRunId = await stay(adapter.send(currentWork.id, view.session, text, view.includeIdentity, text.trimStart().startsWith("/") && !view.literalSlash ? "command" : images.length || (adapter.chatCapabilities.get(currentWork.id) ?? 0) >= 1 ? "text" : undefined, images.map(i => i.input), cancelRunId).then(result => { consumeImageSubmission(currentWork.id, submission); return result; }));
                }
                catch (error) {
                    if (!adapter.chatSubmissions.has(currentWork.id))
                        pendingImageSubmissions.delete(currentWork.id);
                    throw error;
                }
                pendingImageSubmissions.delete(currentWork.id);
                if (record) {
                    record.businessId = submittedRunId;
                    actions.confirm(record, t('chat.messageAccepted'));
                }
                view.scrollPinned = true;
                render();
                const composer = root.querySelector("#composer");
                if (composer && composer.value === text)
                    composer.value = view.drafts[draftKey(currentWork)] || "";
            }
            break;
        case "cancel-run":
            if (currentWork) {
                const targetRunId = el.dataset.runId || view.data.runId || currentWork.run?.id;
                await stay(adapter.cancelRun(currentWork.id, targetRunId));
                if (record) {
                    record.businessId = targetRunId;
                    actions.confirm(record, t('action.cancellationRequested'));
                }
            }
            break;
        case "resume-run":
            if (currentWork) {
                if (el.dataset.runId && el.dataset.runId !== currentWork.run?.id) {
                    openModal('run-details', { runId: el.dataset.runId });
                    await stay(adapter.loadRunDetails(currentWork.id, el.dataset.runId));
                    break;
                }
                await stay(adapter.resumeRunConnection(currentWork.id));
                if (record) {
                    record.businessId = currentWork.run?.id;
                    actions.confirm(record, t('action.reconnected'));
                }
            }
            break;
        case "active-run":
        case "run-details": {
            if (currentWork) {
                const runId = el.dataset.runId || (action === 'active-run' ? adapter.activeRuns.get(currentWork.id)?.run?.id : undefined) || currentWork.run?.id;
                openModal('run-details', runId ? { runId } : {});
                if (runId) {
                    void adapter.loadTemporaryCleanups(currentWork.id, 'run', runId).catch(() => undefined);
                    await stay(adapter.loadRunDetails(currentWork.id, runId));
                }
            }
            break;
        }
        case "refresh-temporary-cleanups":
            if (currentWork && (el.dataset.kind === 'run' || el.dataset.kind === 'service') && el.dataset.ref)
                await stay(adapter.loadTemporaryCleanups(currentWork.id, el.dataset.kind, el.dataset.ref));
            break;
        case "check-active-run":
            if (currentWork)
                await stay(adapter.loadActiveRun(currentWork.id, true));
            break;
        case "scroll-bottom":
            view.scrollPinned = true;
            render();
            break;
        case "open-source":
            if (currentWork) {
                const path = el.dataset.path;
                const link = filesDeepLink(currentWork.id, path);
                if (!link) {
                    toast(t('action.invalidFileRef'));
                    break;
                }
                sourceGuardReturn = (dirty() || view.configDirty) && view.modal ? { epoch: adapter.identityEpoch, route: location.hash, modal: view.modal, data: { ...view.data }, focus: focusKey(el) } : undefined;
                const source = view.modal === 'pi-request-detail' ? { epoch: adapter.identityEpoch, workId: currentWork.id, path,
                    tab: view.tab, modal: view.modal, data: { ...view.data }, scroll: root.querySelector('#modal .modal-body')?.scrollTop ?? 0 } : undefined;
                await guard(async () => {
                    sourceGuardReturn = undefined;
                    const epoch = adapter.identityEpoch;
                    // Leave focus first so Files is actually visible before any read starts.
                    if (!await exitWorkspaceFocus() || epoch !== adapter.identityEpoch || current()?.id !== currentWork.id)
                        return;
                    fileSourceReturn = source;
                    view.config = null;
                    view.configDirty = false;
                    areaChoice++;
                    fileChoice++;
                    view.modal = "";
                    modalChoice++;
                    view.tab = "Files";
                    view.path = parentDirectory(path);
                    clearFileTarget();
                    history.replaceState(null, "", location.pathname + location.search + link);
                    lastRoute = location.hash;
                    render();
                    // The target shell owns loading and failure; only the current target reads.
                    await openFile(currentWork, path).catch(error => { if (!(error instanceof ViewChanged))
                        render(); });
                });
            }
            break;
        case "copy":
            await copy(el.dataset.copy || "");
            break;
        case "copy-domain":
            if (s)
                await copy(s.domain);
            break;
        case "copy-local":
            if (currentWork && s) {
                await copy(adapter.localLink(currentWork.id, s.id, view.port));
                toast(adapter.hosted ? t('service.accessCopied') : t('service.localCopied'));
            }
            break;
        case "open-app":
        case "open-window":
            if (currentWork && s) {
                const opened = window.open('about:blank', '_blank', action === 'open-window' ? 'width=1120,height=820' : undefined);
                if (!opened) {
                    view.serviceOpenError = t('service.blockedWindow');
                    render();
                    throw new Error(view.serviceOpenError);
                }
                opened.opener = null;
                view.serviceOpenError = '';
                if (adapter.serviceEmbed(currentWork.id, s.id, view.port) === "denied") {
                    try {
                        opened.location.href = await stay(adapter.directServiceURL(currentWork.id, s.id, view.port));
                    }
                    catch (error) {
                        opened.close();
                        throw error;
                    }
                    closeModal();
                    break;
                }
                opened.location.href = adapter.localLink(currentWork.id, s.id, view.port);
                closeModal();
            }
            break;
        case 'retry-service-entry':
            if (currentWork && s)
                await stay(adapter.ensureServiceEntry(currentWork.id, s.id, view.port, true));
            break;
        case 'check-preview':
            if (currentWork && s)
                await stay(adapter.serviceFrameLoaded(currentWork.id, s.id, view.port));
            break;
        case "service-details":
            openModal("service-details", { serviceId: el.dataset.id });
            if (currentWork) {
                void adapter.loadTemporaryCleanups(currentWork.id, 'service', el.dataset.id).catch(() => undefined);
                await stay(adapter.readLogs(currentWork.id, el.dataset.id));
            }
            break;
        case "service-action": {
            const control = el.dataset.control;
            if (control === "stop" || control === "remove")
                openModal("service-control", { serviceId: el.dataset.id, control });
            else if (currentWork)
                await submitServiceControl(currentWork, el.dataset.id, control, record);
            break;
        }
        case "confirm-service-control":
            if (currentWork)
                await submitServiceControl(currentWork, view.data.serviceId, view.data.control, record);
            break;
        case "refresh-logs":
            if (currentWork)
                await stay(adapter.readLogs(currentWork.id, view.data.serviceId));
            render();
            break;
        case "refresh-files":
            if (currentWork) {
                const epoch = adapter.identityEpoch, snapshot = unknownFiles.reviewSnapshot(currentWork.id), origin = ownedView();
                const directories = [...new Set([view.path, ...snapshot.directories])], read = [];
                if (view.file) {
                    view.fileStatus = "loading";
                    render();
                }
                for (const directory of directories) {
                    await adapter.loadDirectory(currentWork.id, directory);
                    if (epoch !== adapter.identityEpoch)
                        throw new ViewChanged();
                    read.push(directory);
                }
                const reviewed = unknownFiles.completeReview(snapshot, read);
                for (const identity of reviewed.actions) {
                    const original = actions.records.get(identity.key);
                    if (original && original.token === identity.token && original.generation === identity.generation)
                        actions.review(original);
                }
                if (origin !== ownedView())
                    throw new ViewChanged();
                const openPath = view.file;
                if (openPath) {
                    const keepDraft = dirty() || view.fileWriteUncertain;
                    try {
                        const fresh = await adapter.readFile(currentWork.id, openPath);
                        if (epoch !== adapter.identityEpoch || openPath !== view.file)
                            throw new ViewChanged();
                        if (fresh.kind === "directory") {
                            view.path = fresh.path;
                            view.file = "";
                            view.fileStatus = "idle";
                            view.selected = [];
                        }
                        else if (keepDraft) {
                            // The draft and its original save baseline stay independent of the reread.
                            view.fileReread = { ...fresh };
                            view.fileStatus = "ready";
                        }
                        else
                            applyFilePreview(fresh);
                    }
                    catch (error) {
                        if (error instanceof DOMException && error.name === 'AbortError') {
                            if (epoch !== adapter.identityEpoch || openPath !== view.file)
                                throw new ViewChanged();
                            view.fileStatus = "unavailable";
                            view.fileError = t('fileRead.interrupted');
                        }
                        else {
                            if (epoch !== adapter.identityEpoch || openPath !== view.file)
                                throw new ViewChanged();
                            const status = error instanceof DesktopError ? error.httpStatus : undefined;
                            view.fileStatus = missingFileTarget(status) ? "missing"
                                : status && [401, 403, 502, 503, 504].includes(status) ? "unavailable" : "error";
                            view.fileError = error instanceof Error ? error.message : String(error);
                        }
                    }
                }
            }
            render();
            break;
        case "file-path":
            await guard(async () => {
                const choice = ++fileChoice;
                filesRestoreNotice = "";
                if (currentWork)
                    await stay(adapter.loadDirectory(currentWork.id, el.dataset.path));
                if (choice !== fileChoice)
                    throw new ViewChanged();
                view.path = el.dataset.path;
                view.file = "";
                view.fileStatus = "idle";
                fileSourceReturn = undefined;
                view.selected = [];
                render();
            });
            break;
        case "open-file":
            if (currentWork) {
                const path = el.dataset.path || view.data.path;
                fileSourceReturn = undefined;
                await guard(async () => {
                    view.modal = "";
                    await stay(openFile(currentWork, path));
                    render();
                });
            }
            break;
        case "close-file":
            await guard(async () => {
                const work = currentWork;
                const leaving = view.file;
                if (work && leaving)
                    adapter.releaseFilePreview(work.id, leaving);
                clearFileTarget();
                fileSourceReturn = undefined;
                if (work) {
                    const original = view.path;
                    if (isFilesRoute(route())) {
                        history.replaceState(null, "", location.pathname + location.search + `#/work/${encodeURIComponent(work.id)}`);
                        lastRoute = location.hash;
                    }
                    if (adapter.project(work).retainWorkspace)
                        await showDirectoryOrAncestor(work, original);
                }
                render();
            });
            break;
        case "retry-file-preview":
            if (currentWork && view.file)
                await openFile(currentWork, view.file);
            break;
        case "back-to-file-source":
            if (currentWork && fileSourceReturn && fileSourceReturn.epoch === adapter.identityEpoch && fileSourceReturn.workId === currentWork.id) {
                const source = fileSourceReturn;
                fileSourceReturn = undefined;
                adapter.releaseFilePreview(currentWork.id, view.file);
                clearFileTarget();
                view.tab = source.tab;
                view.modal = source.modal;
                view.data = { ...source.data };
                modalChoice++;
                if (isFilesRoute(route())) {
                    history.replaceState(null, "", location.pathname + location.search + `#/work/${encodeURIComponent(currentWork.id)}`);
                    lastRoute = location.hash;
                }
                render();
                queueMicrotask(() => { const body = root.querySelector('#modal .modal-body'); if (body)
                    body.scrollTop = source.scroll; });
            }
            break;
        case "discard-file":
            view.fileDraft = view.fileOriginal;
            render();
            break;
        case "allow-unprotected-file":
            view.fileUnprotected = true;
            toast(t('save.unprotected'));
            break;
        case "use-reread-version":
            if (view.fileReread?.preview?.kind === "text") {
                view.fileBaseline = fileVersion(view.fileReread.modified);
                view.fileOriginal = view.fileReread.preview.content;
                view.fileUnprotected = false;
                view.fileWriteUncertain = false;
                view.fileReread = null;
                render();
            }
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
            openModal("file-menu", { path: el.dataset.path });
            break;
        case "new-folder":
            openModal("new-folder");
            focusNameField(0, 0);
            break;
        case "confirm-upload-overwrite":
            if (currentWork) {
                if (!pendingUploadTarget || pendingUploadTarget.epoch !== adapter.identityEpoch || pendingUploadTarget.workId !== currentWork.id || pendingUploadTarget.directory !== view.path)
                    throw new Error(t('upload.targetChanged'));
                const overwrite = el.dataset.uploadMode === 'overwrite', review = uploadReview(modalTransfers), eligible = overwrite ? review.overwrite : review.retry;
                const directory = pendingUploadTarget.directory, files = pendingUploadFiles.filter(file => eligible.some(row => row.path === joinPath(directory, file.name))), targets = files.map(file => ({ source: joinPath(directory, file.name) }));
                if (!files.length)
                    throw new Error(t('upload.noEligible'));
                const epoch = adapter.identityEpoch, origin = viewKey();
                assertFileAdmission(currentWork.id, targets);
                const rows = await adapter.upload(currentWork.id, directory, files, overwrite);
                if (epoch !== adapter.identityEpoch)
                    throw new ViewChanged();
                const results = retainFileResults(currentWork.id, targets, rows, record);
                confirmFileAttempt(record, results);
                if (origin !== viewKey())
                    throw new ViewChanged();
                modalTransfers = [...modalTransfers.filter(row => !targets.some(target => target.source === row.path)), ...results];
                pendingUploadFiles = pendingUploadFiles.filter(file => modalTransfers.some(row => row.path === joinPath(directory, file.name) && row.status !== 'succeeded'));
                if (!pendingUploadFiles.length && modalTransfers.length && modalTransfers.every(row => row.status === 'succeeded')) {
                    closeModal();
                    toast(t('upload.complete'));
                }
                else {
                    view.modalError = t('upload.review');
                    render();
                }
            }
            break;
        case "confirm-folder":
            if (currentWork) {
                const path = joinPath(view.path, validateName(view.formName)), targets = [{ source: path }];
                const epoch = adapter.identityEpoch, origin = viewKey();
                assertFileAdmission(currentWork.id, targets);
                const results = await adapter.transfer(currentWork.id, 'mkdir', ['new-folder'], path);
                if (epoch !== adapter.identityEpoch)
                    throw new ViewChanged();
                const retained = retainFileResults(currentWork.id, targets, results, record);
                confirmFileAttempt(record, retained);
                if (origin !== viewKey())
                    throw new ViewChanged();
                modalTransfers = retained;
                if (filesConfirmed(retained)) {
                    closeModal();
                    toast(t('files.folderCreated'));
                }
            }
            break;
        case "file-rename":
        case "file-copy":
        case "file-move": {
            const paths = el.dataset.path ? [el.dataset.path] : view.selected;
            if (!paths.length)
                throw Error(t('files.selectFirst'));
            openModal("file-transfer", {
                paths: JSON.stringify(paths),
                transfer: action.slice(5),
            });
            if (action === 'file-rename') {
                const initial = renameField(paths[0], currentWork?.files.find(file => file.path === paths[0])?.kind === 'directory');
                view.formName = initial.value;
                render();
                focusNameField(initial.selectionStart, initial.selectionEnd);
            }
            break;
        }
        case "confirm-transfer":
            if (currentWork) {
                if (fileAttempt?.ledger.hasResults)
                    throw new Error(t('fileResults.retryOnly'));
                const paths = decodePaths(view.data.paths);
                const targets = paths.map(source => ({ source, destination: view.data.transfer === 'rename'
                        ? joinPath(source.slice(0, source.lastIndexOf('/')) || '/', validateName(view.formName))
                        : joinPath(view.formDestination, source.split('/').pop()) }));
                assertFileAdmission(currentWork.id, targets);
                const conflicts = targets.map(target => target.destination).filter(path => currentWork.files.some(file => file.path === path));
                if (conflicts.length && !view.formOverwrite) {
                    view.formOverwrite = true;
                    view.data.overwritePath = conflicts.join(', ');
                    render();
                    break;
                }
                const attempt = { workId: currentWork.id, operation: view.data.transfer === 'copy' ? 'copy' : 'move', overwrite: view.formOverwrite, ledger: new FileMutationResults(targets), selected: new Set(), feedbackRecords: new Set() };
                fileAttempt = attempt;
                await performFileAttempt(attempt, targets, record);
            }
            break;
        case 'retry-selected-files':
            if (fileAttempt && currentWork?.id === fileAttempt.workId) {
                const attempt = fileAttempt, targets = attempt.ledger.retryTargets([...attempt.selected]);
                if (!targets.length)
                    throw new Error(t('fileResults.retrySelect'));
                await performFileAttempt(attempt, targets, record);
            }
            break;
        case "file-delete": {
            const paths = el.dataset.path ? [el.dataset.path] : view.selected;
            if (!paths.length)
                throw Error(t('files.selectFirst'));
            openModal("file-delete", { paths: JSON.stringify(paths) });
            break;
        }
        case "confirm-file-delete":
            if (currentWork) {
                if (fileAttempt?.ledger.hasResults)
                    throw new Error(t('fileResults.retryOnly'));
                const targets = decodePaths(view.data.paths).map(source => ({ source }));
                assertFileAdmission(currentWork.id, targets);
                const attempt = { workId: currentWork.id, operation: 'delete', overwrite: false, ledger: new FileMutationResults(targets), selected: new Set(), feedbackRecords: new Set() };
                fileAttempt = attempt;
                await performFileAttempt(attempt, targets, record);
            }
            break;
        case "upload":
            if (!currentWork || !adapter.project(currentWork).usable)
                throw new Error(t('upload.confirmWork'));
            uploadPickerTarget = { epoch: adapter.identityEpoch, workId: currentWork.id, directory: view.path };
            root.querySelector("#upload-input")?.click();
            break;
        case "download-file": {
            if (currentWork)
                downloadURL(adapter.fileURL(currentWork.id, el.dataset.path || view.file));
            break;
        }
        case "settings-section":
            if (!validateConfigDraft())
                break;
            view.settingsTab = el.dataset.tab;
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
                const origin = ownedView(), epoch = adapter.identityEpoch;
                const op = await adapter.applyConfiguration(currentWork.id);
                if (epoch !== adapter.identityEpoch || record && !actions.current(record))
                    throw new ViewChanged();
                // The accepted object survives navigation; only opening its view is conditional.
                accept(op);
                if (origin !== ownedView())
                    throw new ViewChanged();
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
                openModal("refresh-core-skills", { id: el.dataset.id });
                break;
            }
            break;
        case "confirm-core-skills":
            if (currentWork) {
                const draft = JSON.stringify(view.config);
                await stay(adapter.replaceSkill(currentWork.id, view.data.id));
                if (JSON.stringify(view.config) === draft) {
                    view.config = structuredClone(currentWork.config);
                    view.configDirty = false;
                }
                if (record) {
                    actions.confirm(record, t('action.skillCopySaved'));
                    void actions.refresh(record, () => adapter.loadConfiguration(currentWork.id));
                }
                closeModal();
                toast(t('action.coreCopiesSaved'));
            }
            break;
        case "check-catalog":
            const available = await stay(adapter.checkCatalog());
            toast(available ? t('action.catalogsConfirmed') : t('action.catalogIncomplete', { error: [adapter.catalog.skills.error, adapter.catalog.packages.error].filter(Boolean).join(" ") }));
            break;
        case "skill-detail":
        case "package-detail":
            openModal(action, { id: el.dataset.id });
            break;
        case "refresh-package-detail":
            if (currentWork)
                await stay(adapter.loadPackages(currentWork.id));
            break;
        case "install-package":
            view.installSource = "";
            view.installName = adapter.getPackages()[0]?.name ?? "";
            packageFiles = [];
            openModal("install-package");
            break;
        case "update-package":
            view.installName = el.dataset.id;
            view.installSource = "";
            openModal("install-package", {
                update: "true",
                updateTarget: el.dataset.id,
            });
            break;
        case "toggle-package":
            if (view.config) {
                const p = view.config.packages.find((p) => p.name === el.dataset.id);
                if (p)
                    p.enabled = !p.enabled;
                view.configDirty = true;
                render();
            }
            break;
        case "remove-package":
            openModal("remove-package-confirm", { id: el.dataset.id });
            break;
        case "confirm-remove-package":
            if (currentWork) {
                show(await stay(adapter.removePackage(currentWork.id, view.data.id)));
                view.config = null;
            }
            break;
        case "unselect-package":
            if (view.config) {
                view.config.packages = view.config.packages.filter((p) => p.name !== el.dataset.id);
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
                        name: el.dataset.id,
                        enabled: true,
                        source: "Current Core copy",
                    });
                view.configDirty = true;
                render();
            }
            break;
        case "choose-package-source":
            root
                .querySelector(view.installType === "ZIP"
                ? "#package-zip-input"
                : "#package-directory-input")
                ?.click();
            break;
        case "confirm-install":
            if (currentWork) {
                if (view.installType !== "Core" && !view.installSource)
                    throw Error(t('package.chooseSourceError'));
                const name = view.data.updateTarget ||
                    (view.installType === "Core" ? view.installName : view.installSource);
                show(await stay(adapter.installPackage(currentWork.id, name, `${view.installType}: ${view.installType === "Core" ? "current Core copy" : view.installSource}`, packageFiles, view.data.updateTarget)));
                view.config = null;
            }
            break;
        case "import-agents":
        case "import-json":
        case "create-import-agents":
            root
                .querySelector(action === "import-json"
                ? "#json-input"
                : action === "create-import-agents"
                    ? "#create-agents-input"
                    : "#agents-input")
                ?.click();
            break;
        case "choose-work-file":
            root.querySelector("#work-file-input")?.click();
            break;
        case "check-inspection-import":
            await stay(adapter.checkInspectionImport());
            break;
        case "retry-inspection-cleanup":
            await stay(adapter.cleanupInspection(el.dataset.id));
            break;
        case "confirm-import":
            show(await stay(adapter.importWork(view.importName.trim())));
            break;
        case "export-logs":
            adapter.recoverLogExport();
            if (!adapter.logExport || (!adapter.logExport.restored && ["ready", "failed", "interrupted", "expired"].includes(adapter.logExport.phase)))
                adapter.startLogExport();
            openModal("log-export");
            break;
        case "export-logs-again":
            adapter.startLogExport();
            break;
        case "retry-log-export":
            adapter.retryLogExportSameKey();
            break;
        case "check-log-export":
            await stay(adapter.checkLogExport());
            break;
        case "download-log-export":
            adapter.deliverLogExport();
            break;
        case 'export':
        case 'prepare-export':
            if (w)
                beginExport(w, false, record);
            break;
        case 'view-snapshot': {
            const snap = await stay(adapter.fetchSnapshot(el.dataset.id));
            if (el.dataset.workId && snap.workId !== el.dataset.workId)
                throw new Error(t('export.snapshotMismatch'));
            openModal('export', { id: snap.workId, snapshotId: snap.id });
            break;
        }
        case 'download-work': {
            const snap = adapter.getSnapshot(el.dataset.id);
            if (!snap)
                throw new Error(t('export.checkSnapshot'));
            openExportFlow(exportFlows.start(snap.workId, { mode: 'existing', snapshotId: snap.id }), record);
            break;
        }
        case 'check-export-flow':
            await exportFlows.check(el.dataset.id);
            break;
        case 'pause-export-flow':
            exportFlows.pause(el.dataset.id);
            break;
        case 'resume-export-flow':
            await exportFlows.resume(el.dataset.id);
            break;
        case 'save-export-file': {
            const id = el.dataset.id, snap = await stay(adapter.fetchSnapshot(id));
            const job = await stay(adapter.checkDownload(id));
            if (adapter.getSnapshot(id) !== snap || adapter.downloads.get(id) !== job || !exportSnapshotAvailable(snap) || !job?.ready || job.snapshotId !== snap.id || job.workId !== snap.workId)
                throw new Error(t('export.notConfirmed'));
            downloadURL(`/_desktop/api/downloads/${encodeURIComponent(job.transferId)}/content`, adapter.getWork(snap.workId)?.name || snap.workId);
            break;
        }
        case 'check-download': {
            const id = el.dataset.id;
            await stay(adapter.checkDownload(id));
            const job = adapter.downloads.get(id);
            if (record && actions.current(record) && job?.ready)
                for (const original of actions.records.values()) {
                    if (original.kind === 'transfer' && original.work === record.work && original.action === 'download-work' && original.resource === id && original.businessId === job.transferId)
                        actions.review(original);
                }
            adapter.observeDownload(id);
            break;
        }
        case "operation":
            openModal("operation", { id: el.dataset.id });
            if (!adapter.getOperation(el.dataset.id))
                await stay(adapter.checkOperation(el.dataset.id));
            break;
        case "pause-operation":
            adapter.pauseOperation(el.dataset.id);
            render();
            break;
        case "resume-operation":
            await stay(adapter.checkOperation(el.dataset.id));
            adapter.resumeOperation(el.dataset.id);
            render();
            break;
        case "check-operation":
            reviewOperation(await stay(adapter.checkOperation(el.dataset.id)), record);
            break;
        case "lookup-operation": {
            const op = await stay(adapter.checkOperation(view.operationQuery.trim()));
            if (op) {
                reviewOperation(op, record);
                openModal("operation", { id: op.id });
            }
            else
                throw Error(t('ops.lookupMissing'));
            break;
        }
        case "lookup-snapshot": {
            const snap = await stay(adapter.fetchSnapshot(view.snapshotQuery.trim()));
            if (snap)
                openModal("export", { id: snap.workId, snapshotId: snap.id });
            else
                throw Error(t('export.snapshotMissing'));
            break;
        }
        case "clear-operations":
            await stay(adapter.clearOperations());
            break;
    }
}
function joinPath(parent, name) {
    return (parent === "/" ? "" : parent) + "/" + name;
}
function validateName(name) {
    const result = name.trim();
    if (!validLocalName(result))
        throw Error(t('name.noPathSeparators'));
    return result;
}
function focusNameField(start, end) {
    const choice = modalChoice, epoch = adapter.identityEpoch;
    queueMicrotask(() => {
        if (choice !== modalChoice || epoch !== adapter.identityEpoch)
            return;
        const field = root.querySelector('#modal #form-name');
        if (!field)
            return;
        field.value = view.formName;
        field.focus({ preventScroll: true });
        field.setSelectionRange(start, end);
    });
}
function clearFileTarget() {
    view.file = "";
    view.fileStatus = "idle";
    view.fileError = "";
    view.fileDraft = "";
    view.fileOriginal = "";
    view.fileBaseline = "";
    view.fileEditable = false;
    view.fileReread = null;
    view.fileUnprotected = false;
    view.fileWriteUncertain = false;
    filesRestoreNotice = "";
}
async function showDirectoryOrAncestor(w, start) {
    const original = start || "/";
    let path = original;
    for (;;) {
        try {
            await adapter.loadDirectory(w.id, path);
            view.path = path;
            break;
        }
        catch (error) {
            if (!missingFileTarget(error.httpStatus) || path === "/") {
                view.path = path;
                break;
            }
            path = parentDirectory(path);
        }
    }
    if (path !== original)
        filesRestoreNotice = t('files.folderUnavailableMoved', { path });
}
function applyFilePreview(f) {
    view.file = f.path;
    const text = f.preview?.kind === "text" ? f.preview.content : "";
    view.fileDraft = text;
    view.fileOriginal = text;
    view.fileEditable = f.preview?.kind === "text";
    view.fileBaseline = fileVersion(f.modified);
    view.fileReread = null;
    view.fileUnprotected = false;
    view.fileWriteUncertain = false;
    view.fileStatus = "ready";
    view.fileError = "";
}
async function openFile(w, path) {
    const key = viewKey(), epoch = adapter.identityEpoch, choice = ++fileChoice;
    // A retry or explicit reopen of the same editable target must not discard a
    // draft that the failed read never proved stale.
    const keepDraft = view.file === path && view.fileEditable && (dirty() || view.fileWriteUncertain || view.fileReread !== null);
    if (view.file !== path) {
        view.fileDraft = "";
        view.fileOriginal = "";
        view.fileBaseline = "";
        view.fileEditable = false;
        view.fileReread = null;
        view.fileUnprotected = false;
        view.fileWriteUncertain = false;
    }
    view.file = path;
    view.fileStatus = 'loading';
    view.fileError = '';
    render();
    try {
        await adapter.readFile(w.id, path);
        if (key !== viewKey() || epoch !== adapter.identityEpoch || choice !== fileChoice)
            throw new ViewChanged();
        const f = w.files.find((f) => f.path === path);
        if (!f)
            throw new DesktopError('FILE_NOT_FOUND', t('files.noLongerInWorkspace'), 404);
        if (f.kind === "directory") {
            view.path = f.path;
            view.file = "";
            view.fileStatus = "idle";
            view.selected = [];
            return;
        }
        view.path = f.path.slice(0, f.path.lastIndexOf("/")) || "/";
        if (keepDraft) {
            view.fileReread = { ...f };
            view.fileStatus = "ready";
        }
        else
            applyFilePreview(f);
    }
    catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            if (epoch !== adapter.identityEpoch || choice !== fileChoice || view.file !== path)
                throw new ViewChanged();
            // Work stop or an external cancel without a newer target: never keep
            // claiming the target is still loading.
            view.fileStatus = "unavailable";
            view.fileError = t('fileRead.interrupted');
            throw error;
        }
        if (key !== viewKey() || epoch !== adapter.identityEpoch || choice !== fileChoice)
            throw new ViewChanged();
        const status = error instanceof DesktopError ? error.httpStatus : undefined;
        view.fileStatus = missingFileTarget(status) ? "missing"
            : status && [401, 403, 502, 503, 504].includes(status) ? "unavailable" : "error";
        view.fileError = error instanceof Error ? error.message : String(error);
        if (!keepDraft)
            view.fileEditable = false;
        throw error;
    }
}
async function copy(text) {
    try {
        await navigator.clipboard.writeText(text);
        toast(t('clipboard.copied'));
    }
    catch {
        toast(t('clipboard.unavailable', { value: text }));
    }
}
function visibleActionRecord(record) {
    const operation = record.businessId && adapter.getOperation(record.businessId);
    if (route()[0] === 'works' && record.kind === 'lifecycle' && operation && ['succeeded', 'failed', 'superseded'].includes(operation.state) && !operation.observationError && !record.blocked && !record.pending && record.refresh !== 'failed' && record.refresh !== 'refreshing')
        return false;
    if (record.kind === 'read' && record.action === 'retry-works' && record.error && adapter.worksError)
        return false;
    if (record.kind === 'read' && record.action === 'open-source')
        return record.work === current()?.id && (record.sourceContext === `${view.tab}:${view.session}:${view.modal}` || view.tab === 'Files' && record.resource === view.file);
    if (record.kind === 'read' && ['tab-Files', 'refresh-files', 'file-path', 'open-file', 'open-source', 'retry-file-preview'].includes(record.action || '')) {
        if (record.work !== current()?.id || view.tab !== 'Files')
            return false;
        if (['file-path', 'open-file', 'open-source', 'retry-file-preview'].includes(record.action || ''))
            return record.resource === (view.file || view.path) || record.origin === (view.file || view.path);
        if (record.resource !== (view.file || view.path))
            return false;
        if (record.error && !view.file) {
            const directory = adapter.directories.get(`${record.work}:${view.path}`);
            return (directory ? directory.error : current()?.resourceErrors?.files) === record.error;
        }
        return true;
    }
    if (record.kind === 'read' && ['sessions', 'select-session', 'retry-conversation', 'check-active-run'].includes(record.action || '')) {
        const work = current();
        if (record.work !== work?.id || record.action !== 'sessions' && record.resource !== view.session)
            return false;
        if (!record.error)
            return true;
        const error = record.action === 'check-active-run' ? adapter.activeRuns.get(work.id)?.error
            : record.action === 'sessions' ? work?.resourceErrors?.agent
                : work?.sessions.find(session => session.id === view.session)?.error || work?.resourceErrors?.agent;
        return error === record.error;
    }
    return !record.resource?.startsWith('service:') || record.resource === `service:${view.data.serviceId || (current() ? activeService(current())?.id : view.service)}${record.kind === 'service' ? '' : `:${view.port}`}`;
}
function observeCurrentPage() {
    const [area, id] = route(), w = adapter.getWork(id || '');
    const settings = route()[2] === 'settings';
    const showService = area === 'app' || area === 'work' && !settings && view.tab === 'Services' && view.layout !== 'chat-only';
    const panels = w ? workspacePanels.get(w.id) : undefined;
    const showChat = area === 'work' && !settings && view.layout !== 'service-only' && (view.layout === 'chat-only' || view.tab === 'Chat' || view.tab === 'Services' ? view.layout === 'chat-only' || view.tab === 'Chat' || (innerWidth < 900 ? !!panels?.narrowChat || view.layout === 'service-chat' : view.layout === 'service-chat' || !panels?.collapsed) : innerWidth > 1050 || view.agentOpen);
    adapter.observePage(id || '', document.visibilityState === 'visible', showChat, showService && w ? activeService(w)?.name || '' : '', view.modal === 'pi-request-detail' ? view.data.requestId || '' : '', view.modal === 'pi-requests', view.modal === 'pi-requests' ? view.data.serviceName || '' : '', area === 'works');
}
let fileActionsContext = '';
function fileActionsKey() { return `${adapter.identityEpoch}:${location.hash}:${view.tab}:${view.path}`; }
function closeFileActions(restore = false) {
    if (!fileActionsContext)
        return;
    fileActionsContext = '';
    render();
    if (restore)
        root.querySelector('#file-add-trigger')?.focus({ preventScroll: true });
}
function render() {
    if (fileActionsContext && (fileActionsContext !== fileActionsKey() || view.modal || view.selected.length || !adapter.state.signedIn))
        fileActionsContext = '';
    if (current()?.id === selectionWorkId)
        rememberWork();
    observeCurrentPage();
    if (view.config && !view.config.advancedDirty)
        synchronizeConfiguration(view.config);
    const active = document.activeElement;
    const activeKey = focusKey(active);
    const settingsFocusChoice = chatSettingsContextCurrent() && active?.closest('#modal') ? modalChoice : undefined;
    const selection = active && "selectionStart" in active ? active.selectionStart : null;
    const selectionEnd = active && 'selectionEnd' in active ? active.selectionEnd : selection;
    const messages = root.querySelector("#messages");
    const scroll = messages?.scrollTop || 0;
    const firstVisible = messages && !view.scrollPinned ? [...messages.querySelectorAll('[data-message-key]')].find(node => node.getBoundingClientRect().bottom > messages.getBoundingClientRect().top) : undefined;
    const readingAnchor = firstVisible ? { key: firstVisible.dataset.messageKey, offset: firstVisible.getBoundingClientRect().top - messages.getBoundingClientRect().top } : undefined;
    if (!preserveChatReading && messages?.clientHeight && messages.dataset.readingKey)
        chatReading.set(messages.dataset.readingKey, { scroll, pinned: view.scrollPinned, anchor: readingAnchor });
    const modalScroll = root.querySelector(".modal-body")?.scrollTop || 0;
    const r = route();
    // One place decides the browser title (and <html lang>) from the current route.
    const titleWork = (r[0] === 'work' || r[0] === 'app') ? adapter.getWork(r[1]) : undefined;
    if (!adapter.state.signedIn || adapter.state.scenario === "cli-closed")
        applyDocumentTitle(t('doc.connect'));
    else if (r[0] === 'app')
        applyDocumentTitle(titleWork ? t('doc.app', { name: titleWork.name }) : t('doc.works'));
    else if (r[0] === 'work')
        applyDocumentTitle(titleWork ? r[2] === 'settings' ? t('doc.workSettings', { name: titleWork.name }) : t('doc.work', { name: titleWork.name }) : t('doc.works'));
    else
        applyDocumentTitle(t('doc.works'));
    if (workspaceReturn && (workspaceReturn.workId !== r[1] || !['work', 'app'].includes(r[0])))
        resetWorkspaceFocus();
    root.classList.toggle('workspace-page', ['work', 'app'].includes(r[0]) && !!current() && r[2] !== 'settings');
    root.dataset.layout = view.layout;
    root.classList.toggle('service-focused', view.layout !== 'workspace');
    root.classList.toggle('chat-focused', view.layout === 'chat-only');
    let html = "";
    if (adapter.state.scenario === "cli-closed")
        html = `${topbar()}<main class="auth-main">${empty("terminal", adapter.hosted ? t('standalone.serverClosed') : t('standalone.desktopClosed'), adapter.hosted ? t('standalone.serverClosedBody') : t('standalone.desktopClosedBody'), "")}</main>`;
    else if (!adapter.state.signedIn)
        html = signIn();
    else if (r[0] === "app") {
        const w = adapter.getWork(r[1]);
        if (w) {
            view.service = r[2];
            view.port = Number(r[3]);
            html = `${workHeader(w, true)}<div class="standalone-label">${t('standalone.windowNote')}</div><main class="standalone-app">${!adapter.project(w).retainWorkspace ? `${view.layout !== 'workspace' ? `<div class="focus-unavailable"><b>${esc(w.name)}</b>${focusControls(w)}</div>` : ''}${workState(w)}` : services(w)}</main>`;
        }
        else
            html = standaloneWorkUnavailable(r);
    }
    else if (r[0] === "work") {
        const w = adapter.getWork(r[1]);
        html = w
            ? workPage(w)
            : workReadPending(r[1]) ? `${topbar()}<main class="work-loading">${readPlaceholder(t('work.loading'), 'service')}${btn(t('work.backToWorks'), 'back-works')}</main>` : `${topbar()}${empty("grid", workReadErrors.get(r[1])?.missing ? t('work.notFoundTitle') : t('work.unavailableTitle'), esc(workReadErrors.get(r[1])?.message || t('work.readAgainHint')), btn(t('common.retry'), "retry-work-read", "primary") + btn(t('work.backToWorks'), "back-works"))}`;
    }
    else
        html = works();
    if (view.modal === 'chat-response-settings' && (!chatSettingsContextCurrent() || !html.includes('id="composer"'))) {
        if (pendingWebCommand && !pendingWebCommand.pair && ['model', 'thinking'].includes(pendingWebCommand.kind))
            pendingWebCommand = undefined;
        view.modal = '';
        view.modalError = '';
        view.modalNameError = null;
        focusReturn = '';
        lastFocus = null;
        modalChoice++;
    }
    // Action status nodes are reconciled by their owner; retain them without moving iframe ancestors.
    reconcileHTML(root, `${html}${[...adapter.cleanupPending].map(([id, pending]) => feedback(`${esc(pending.message)} <code>${esc(id)}</code>`, "warning", btn(t('standalone.retryCleanup'), "retry-inspection-cleanup", "small", `data-id="${esc(id)}"`))).join("")}<div id="toast" class="toast ${view.toast ? "visible" : ""}" role="status" aria-live="polite">${icon("info", 17)}${esc(view.toast)}</div>${view.modal ? modalMarkup() : ""}<input type="file" id="chat-image-input" accept="image/png,image/jpeg,image/webp" multiple hidden><input type="file" id="upload-input" multiple hidden><input type="file" id="agents-input" accept=".md,.txt" hidden><input type="file" id="create-agents-input" accept=".md,.txt" hidden><input type="file" id="json-input" accept=".json" hidden><input type="file" id="work-file-input" accept=".work" hidden><input type="file" id="package-zip-input" accept=".zip" hidden><input type="file" id="package-directory-input" webkitdirectory multiple hidden>`);
    observeServiceFrames();
    renderActionStates(root, actions, location.hash, el => actionIntent(el), visibleActionRecord);
    for (const el of root.querySelectorAll('[data-history-image]'))
        if (!el.dataset.imageObserved) {
            el.dataset.imageObserved = 'true';
            imageObserver.observe(el);
        }
    if (!servicePreparationScheduled) {
        servicePreparationScheduled = true;
        queueMicrotask(() => { servicePreparationScheduled = false; prepareSelectedEntry(); });
    }
    applyWorkspaceSizing();
    for (const trigger of root.querySelectorAll('[data-action]')) {
        const name = overlayForAction(trigger.dataset.action || '');
        if (!anchoredOverlay(name) || trigger.closest('#modal'))
            continue;
        trigger.setAttribute('aria-haspopup', overlayRole(name) === 'menu' ? 'menu' : 'dialog');
        trigger.setAttribute('aria-expanded', String(view.modal === name && focusKey(trigger) === overlayAnchor));
        if (view.modal === name && focusKey(trigger) === overlayAnchor)
            trigger.setAttribute('aria-controls', 'modal');
        else
            trigger.removeAttribute('aria-controls');
    }
    const dialog = root.querySelector("#modal");
    if (dialog) {
        syncDialogPresentation(dialog, nonmodalDialog());
        if (anchoredOverlay(view.modal))
            positionOverlay(dialog);
        if (!dialog.dataset.bound) {
            dialog.dataset.bound = "true";
            dialog.addEventListener("cancel", (e) => {
                e.preventDefault();
                closeModal();
            });
        }
        const body = dialog.querySelector(".modal-body");
        if (body)
            body.scrollTop = modalScroll;
    }
    if (activeKey) {
        const replacement = active?.isConnected ? active : root.querySelector(activeKey);
        if (replacement && replacement !== document.activeElement && (!dialog || nonmodalDialog() || dialog.contains(replacement))) {
            replacement.focus({ preventScroll: true });
            if (selection !== null &&
                replacement.setSelectionRange &&
                replacement.type !== "checkbox")
                try {
                    replacement.setSelectionRange(selection, selectionEnd ?? selection);
                }
                catch { }
        }
    }
    // Disabling a focused control can move focus to BODY during reconciliation.
    // Use its prior owner; a later user focus or a different panel never belongs here.
    const settingsFocusLost = settingsFocusChoice === modalChoice && chatSettingsContextCurrent() && !!active &&
        (!active.isConnected || active.matches(':disabled') || !active.getClientRects().length) &&
        (document.activeElement === document.body || document.activeElement === root || document.activeElement === active);
    if (dialog && view.modal === 'chat-response-settings' && (overlayOpening || settingsFocusLost))
        focusChatSettings(view.data.expanded || active?.dataset.kind);
    const next = root.querySelector("#messages");
    if (next) {
        const position = chatReading.get(next.dataset.readingKey || '');
        if (next.clientHeight) {
            view.scrollPinned = position?.pinned ?? view.scrollPinned;
            next.scrollTop = view.scrollPinned ? next.scrollHeight : position?.scroll ?? scroll;
            const reading = position?.anchor ?? readingAnchor;
            if (reading && !view.scrollPinned) {
                const anchor = [...next.querySelectorAll('[data-message-key]')].find(node => node.dataset.messageKey === reading.key);
                if (anchor)
                    next.scrollTop += anchor.getBoundingClientRect().top - next.getBoundingClientRect().top - reading.offset;
            }
        }
        if (!next.dataset.scrollBound) {
            next.dataset.scrollBound = "true";
            next.addEventListener("scroll", () => {
                if (!next.clientHeight)
                    return;
                const pinned = next.scrollHeight - next.scrollTop - next.clientHeight < 70;
                view.scrollPinned = pinned;
                rememberChatPosition();
                if (pinned === !!root.querySelector('.back-latest')) {
                    view.scrollPinned = pinned;
                    const old = root.querySelector(".back-latest");
                    if (pinned)
                        old?.remove();
                    else if (!old) {
                        const b = document.createElement("button");
                        b.className = "button back-latest";
                        b.dataset.action = "scroll-bottom";
                        b.textContent = t('chat.backToLatest');
                        next.after(b);
                    }
                }
            });
        }
    }
    updatePendingNotices();
}
function updatePendingNotices() {
    clearTimeout(pendingNoticeTimer);
    pendingNoticeTimer = undefined;
    let next = Infinity;
    for (const node of root.querySelectorAll('[data-pending-label]')) {
        const label = node.dataset.pendingLabel;
        let age = pendingAges.get(node);
        if (!age || age.label !== label) {
            age = { label, started: Date.now() };
            pendingAges.set(node, age);
        }
        const remaining = age.started + 10000 - Date.now();
        if (remaining > 0) {
            next = Math.min(next, remaining);
            continue;
        }
        if (!node.querySelector('.pending-wait-message')) {
            const notice = document.createElement('small');
            notice.className = 'pending-wait-message';
            notice.textContent = t('pending.stillWaitingLong');
            node.append(notice);
        }
    }
    if (Number.isFinite(next))
        pendingNoticeTimer = setTimeout(updatePendingNotices, next);
}
let splitDrag;
function finishSplitDrag(cancel = false) {
    const drag = splitDrag;
    splitDrag = undefined;
    if (!drag)
        return;
    if (cancel && drag.epoch === adapter.identityEpoch)
        workspacePanels.get(drag.workId).ratio = drag.ratio;
    if (drag.node.hasPointerCapture(drag.pointer))
        drag.node.releasePointerCapture(drag.pointer);
    root.classList.remove('resizing-workspace');
    applyWorkspaceSizing();
}
root.addEventListener('pointerdown', event => {
    const separator = event.target.closest('#workspace-splitter'), layout = separator?.parentElement, work = current();
    if (!separator || !layout || !work || event.button !== 0 || !event.isPrimary || splitGeometry(layout.clientWidth, workspacePanels.get(work.id).ratio).narrow)
        return;
    event.preventDefault();
    separator.focus();
    splitDrag = { pointer: event.pointerId, workId: work.id, epoch: adapter.identityEpoch, ratio: workspacePanels.get(work.id).ratio, node: separator, layout };
    separator.setPointerCapture(event.pointerId);
    root.classList.add('resizing-workspace');
});
root.addEventListener('pointermove', event => {
    const drag = splitDrag;
    if (!drag || event.pointerId !== drag.pointer)
        return;
    if (drag.epoch !== adapter.identityEpoch || drag.workId !== current()?.id || !drag.layout.isConnected) {
        finishSplitDrag();
        return;
    }
    const rect = drag.layout.getBoundingClientRect(), state = workspacePanels.get(drag.workId);
    rememberChatPosition();
    state.ratio = splitGeometry(rect.width, (event.clientX - rect.left) / (rect.width - 8)).ratio;
    applyWorkspaceSizing();
    restoreChatPosition();
});
root.addEventListener('pointerup', () => finishSplitDrag());
root.addEventListener('pointercancel', () => finishSplitDrag(true));
root.addEventListener('lostpointercapture', () => finishSplitDrag());
root.addEventListener('dblclick', event => { if (event.target.closest('#workspace-splitter') && current()) {
    workspacePanels.get(current().id).ratio = .7;
    applyWorkspaceSizing();
} });
root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && splitDrag) {
        event.preventDefault();
        event.stopImmediatePropagation();
        finishSplitDrag(true);
        return;
    }
    if (event.target.id !== 'workspace-splitter' || !current())
        return;
    const layout = root.querySelector('.service-workspace'), state = workspacePanels.get(current().id);
    if (!layout)
        return;
    const next = keyboardSplit(event.key, event.shiftKey, layout.clientWidth, state.ratio);
    if (next === undefined)
        return;
    event.preventDefault();
    rememberChatPosition();
    state.ratio = next;
    applyWorkspaceSizing();
    restoreChatPosition();
});
window.addEventListener('resize', () => { if (splitDrag)
    finishSplitDrag(true); preserveChatReading = true; try {
    render();
}
finally {
    preserveChatReading = false;
} });
let outsideModalPointer;
function lightModalDismissible() {
    const target = view.data.id || current()?.id;
    const records = [...actions.records.values()].filter(record => modalActionRelevant(record, location.hash, target));
    return canDismissLightModal({ modal: view.modal, dirty: dirty() || view.configDirty,
        busy: records.some(record => record.pending), unknown: records.some(record => record.blocked) });
}
root.addEventListener('pointerdown', event => {
    outsideModalPointer = undefined;
    const dialog = root.querySelector('#modal');
    if (anchoredOverlay(view.modal) || event.button !== 0 || !event.isPrimary || !dialog?.open || !lightModalDismissible() ||
        !pointOutsideDialog({ x: event.clientX, y: event.clientY }, dialog.getBoundingClientRect()))
        return;
    outsideModalPointer = { pointer: event.pointerId, choice: modalChoice, epoch: adapter.identityEpoch, dialog };
});
root.addEventListener('pointercancel', () => { outsideModalPointer = undefined; });
root.addEventListener('pointerup', event => {
    const down = outsideModalPointer;
    outsideModalPointer = undefined;
    if (!down || down.pointer !== event.pointerId || down.choice !== modalChoice || down.epoch !== adapter.identityEpoch ||
        !down.dialog.isConnected || !down.dialog.open || !lightModalDismissible() ||
        !pointOutsideDialog({ x: event.clientX, y: event.clientY }, down.dialog.getBoundingClientRect()))
        return;
    closeModal();
});
root.addEventListener('pointerdown', event => {
    if (anchoredOverlay(view.modal) && !event.target.closest('#modal') && !event.target.closest(overlayAnchor || '#modal'))
        dismissAnchoredOverlay();
});
root.addEventListener('focusin', event => {
    if (!overlayOpening && anchoredOverlay(view.modal) && !event.target.closest('#modal') && !event.target.closest(overlayAnchor || '#modal'))
        dismissAnchoredOverlay();
});
window.addEventListener('blur', () => { if (anchoredOverlay(view.modal) && document.activeElement instanceof HTMLIFrameElement)
    dismissAnchoredOverlay(); });
root.addEventListener('scroll', () => { const dialog = root.querySelector('#modal'); if (dialog && anchoredOverlay(view.modal))
    positionOverlay(dialog); }, true);
root.addEventListener('pointerdown', event => {
    if (fileActionsContext && !event.target.closest('.file-add-anchor'))
        closeFileActions();
});
root.addEventListener('focusin', event => {
    if (fileActionsContext && !event.target.closest('.file-add-anchor'))
        closeFileActions();
});
root.addEventListener('keydown', event => {
    if (!fileActionsContext || !event.target.closest('.file-add-anchor'))
        return;
    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeFileActions(true);
        return;
    }
    const options = [...root.querySelectorAll('#file-actions [role=menuitem]')];
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && options.length) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const index = options.indexOf(document.activeElement);
        options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
    }
});
root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el || el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true" || el.closest('[inert]'))
        return;
    if (el instanceof HTMLAnchorElement && el.dataset.action === 'open-work') {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0)
            return;
        e.preventDefault();
    }
    if (anchoredOverlay(view.modal) && !el.closest('#modal') && focusKey(el) === overlayAnchor && overlayForAction(el.dataset.action || '') === view.modal) {
        closeModal();
        return;
    }
    const menuCommand = overlayRole(view.modal) === 'menu' && !!el.closest('#modal');
    const menuChoice = modalChoice;
    let menuFailed = false;
    if (el.closest('#file-actions')) {
        fileActionsContext = '';
        root.querySelector('#file-add-trigger')?.focus({ preventScroll: true });
    }
    if (["select-session", "new-session"].includes(el.dataset.action || ""))
        imageSelection++;
    if (view.modal === 'export' && !el.closest('#modal')) {
        closeModal();
        view.data = {};
    }
    if (!view.modal)
        focusReturn = focusKey(el);
    const origin = viewKey();
    const submittedName = view.modal === 'new-work' && el.dataset.action === 'create-work' ? view.createName.trim()
        : view.modal === 'import' && el.dataset.action === 'confirm-import' ? view.importName.trim() : undefined;
    void dispatchAction(el).catch((error) => {
        if (error instanceof ViewChanged || origin !== viewKey())
            return;
        menuFailed = menuCommand;
        if (view.modal) {
            const nameConflict = submittedName !== undefined && error instanceof DesktopError && error.code === 'WORK_NAME_CONFLICT';
            view.modalNameError = nameConflict ? { name: submittedName, message: error.message } : null;
            view.modalError = nameConflict ? currentNameError() ? '' : t('name.requestRejected', { name: submittedName, detail: error.message })
                : error instanceof Error ? error.message : String(error);
            render();
            if (currentNameError())
                root.querySelector(`#${view.modal === 'import' ? 'import-name-error' : 'create-name-error'}`)?.scrollIntoView({ block: 'nearest' });
        }
        else if (!['refresh-files', 'file-path', 'open-source', 'select-session', 'retry-conversation', 'check-active-run'].includes(el.dataset.action || ''))
            toast(error instanceof Error ? error.message : String(error));
    }).finally(() => { if (menuCommand && !menuFailed && modalChoice === menuChoice && overlayRole(view.modal) === 'menu')
        closeModal();
    else
        render(); });
});
root.addEventListener("input", (e) => {
    const input = e.target;
    const value = input.value;
    if (["create-name", "create-image", "create-agents", "create-json"].includes(input.id))
        createDraft.edit();
    switch (input.id) {
        case "search":
            view.search = value;
            render();
            break;
        case "auth-core":
            view.coreAddress = value;
            break;
        case 'auth-account':
            view.authAccount = value;
            break;
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
            if (work) {
                textDraftRevisions.set(draftKey(work), (textDraftRevisions.get(draftKey(work)) || 0) + 1);
                view.drafts[draftKey(work)] = value;
                view.commandCaret = input.selectionStart ?? value.length;
                view.commandIndex = 0;
                render();
            }
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
                view.config.agents = value;
                synchronizeConfiguration(view.config);
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
    const input = e.target;
    // Chat images have their own validation and identity-bound draft handler.
    if (input.id === 'chat-image-input')
        return;
    const value = input.value;
    const checked = input.checked;
    if (input.dataset.createSkill || input.dataset.createPackage || ["create-skill-mode", "create-package-mode"].includes(input.id))
        createDraft.edit();
    if (input.dataset.retrySource && fileAttempt) {
        if (checked)
            fileAttempt.selected.add(input.dataset.retrySource);
        else
            fileAttempt.selected.delete(input.dataset.retrySource);
        render();
    }
    const w = current();
    if (input.id === 'pi-service-filter' && w) {
        view.data.serviceName = value;
        void adapter.loadRequests(w.id, value).catch(error => toast(error.message));
        render();
    }
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
            view.serviceOpenError = "";
            view.service = value;
            view.port = w?.services.find((s) => s.id === value)?.ports[0] || 3000;
            if (w && view.port)
                void adapter.ensureServiceEntry(w.id, view.service, view.port).catch(error => toast(error.message));
            render();
            break;
        case "port-select": {
            const service = w && (route()[0] === 'app' ? w.services.find(item => item.id === route()[2]) : activeService(w));
            const port = Number(value);
            if (!w || !service || service.id !== input.dataset.serviceId || !service.ports.includes(port) || !adapter.project(w).usable || !service.enabled || service.observed !== 'Ready')
                break;
            serviceChoice++;
            view.serviceOpenError = "";
            view.service = service.id;
            view.port = port;
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
            const b = root.querySelector('[data-action="confirm-delete"]');
            if (b)
                b.disabled = !checked;
            break;
        }
    }
    if (input instanceof HTMLInputElement && input.type === "file") {
        const selection = ++selectionRequest;
        fileSelections.set(input.id, selection);
        const intent = { key: `file-input:${w?.id || 'local'}:${input.id}${input.id === 'upload-input' ? '' : ':' + selection}`, action: input.id, kind: input.id === 'upload-input' ? 'files' : 'read', work: w?.id, resource: input.id,
            label: input.id === 'upload-input' ? t('actions.checkingUploadTargets') : t('actions.readingSelectedFile'), target: `${w?.name || (adapter.hosted ? t('target.server') : t('target.localCli'))} · ${input.files?.[0]?.name || t('target.selectedFiles')}`, view: location.hash };
        const origin = viewKey();
        void dispatchAction(input, record => handleFiles(input, record), intent).catch((err) => {
            if (err instanceof ViewChanged || origin !== viewKey())
                return;
            view.modalError = String(err.message || err);
            toast(view.modalError);
        });
    }
});
async function handleFiles(input, record) {
    const key = viewKey(), selection = fileSelections.get(input.id), epoch = adapter.identityEpoch;
    const valid = () => key === viewKey() && selection === fileSelections.get(input.id) && epoch === adapter.identityEpoch;
    const files = Array.from(input.files || []);
    if (!files.length)
        return;
    const w = current();
    if (input.id === "upload-input") {
        const selected = uploadPickerTarget;
        uploadPickerTarget = undefined;
        if (!w || !selected || selected.epoch !== epoch || selected.workId !== w.id || selected.directory !== view.path)
            throw new Error(t('upload.targetChangedDetailed'));
        pendingUploadTarget = selected;
        const directory = selected.directory, targets = files.map(file => ({ source: joinPath(directory, file.name) }));
        assertFileAdmission(w.id, targets);
        const rows = await adapter.upload(w.id, directory, files);
        if (epoch !== adapter.identityEpoch)
            throw new ViewChanged();
        const results = retainFileResults(w.id, targets, rows, record);
        confirmFileAttempt(record, results);
        if (record)
            void actions.refresh(record, () => adapter.loadDirectory(w.id, directory));
        if (!valid())
            throw new ViewChanged();
        pendingUploadFiles = files.filter(file => results.some(result => result.path.endsWith("/" + file.name) && result.status !== "succeeded"));
        if (pendingUploadFiles.length) {
            openModal("upload-overwrite");
            modalTransfers = results;
        }
        else if (results.length && results.every(row => row.status === "succeeded"))
            toast(t('upload.complete'));
        render();
    }
    else if (input.id === "work-file-input") {
        if (!files[0].name.endsWith(".work"))
            throw Error(t('import.chooseWorkExtension'));
        const transfer = await adapter.inspectWork(files[0]);
        if (!transfer || transfer !== adapter.inspectionTransfer)
            return;
        view.inspectFilename = files[0].name;
        view.inspected = true;
        view.inspectActual = true;
        render();
    }
    else if (input.id === "package-zip-input" ||
        input.id === "package-directory-input") {
        packageFiles = files;
        view.installSource =
            files.length > 1
                ? t('package.localDirectoryFiles', { count: files.length })
                : files[0].name;
        render();
    }
    else {
        if (files[0].size > 1048576)
            throw Error(t('configImport.tooLarge'));
        let text;
        try {
            text = new TextDecoder("utf-8", { fatal: true }).decode(await files[0].arrayBuffer());
        }
        catch {
            if (!valid())
                throw new ViewChanged();
            throw Error(t('configImport.notUtf8'));
        }
        if (!valid())
            throw new ViewChanged();
        if (input.id === "create-agents-input") {
            createDraft.edit();
            view.createAgents = text;
        }
        else if (view.config) {
            if (input.id === "json-input") {
                editAdvanced(view.config, text);
                view.settingsTab = "Advanced";
            }
            else {
                view.config.agents = text;
                synchronizeConfiguration(view.config);
            }
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
    const dialog = root.querySelector("#modal");
    if (dialog?.open && e.target.id === 'form-name' && e.key === 'Enter' &&
        (view.modal === 'new-folder' || view.modal === 'file-transfer' && view.data.transfer === 'rename')) {
        e.preventDefault();
        const action = view.modal === 'new-folder' ? 'confirm-folder' : 'confirm-transfer';
        const button = dialog.querySelector(`[data-action="${action}"]`);
        const intent = button && actionIntent(button);
        if (button && canSubmitName({ modal: view.modal, transfer: view.data.transfer, targetId: 'form-name', key: e.key, keyCode: e.keyCode,
            composing: composition, isComposing: e.isComposing, name: view.formName, enabled: !button.disabled,
            busy: button.getAttribute('aria-busy') === 'true', blocked: !!intent && !!actions.conflict(intent), overwrite: view.formOverwrite }))
            button.click();
        return;
    }
    const launcher = e.target.closest('[data-action]');
    if (!dialog?.open && launcher && overlayRole(launcher.dataset.action || '') === 'menu' && ['ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        launcher.click();
        if (e.key === 'ArrowUp')
            [...root.querySelectorAll('#modal [role=menuitem],#modal [role=menuitemradio]')].filter(node => !node.hasAttribute('disabled')).at(-1)?.focus();
        return;
    }
    if (e.isComposing || composition) {
        if (e.key === 'Enter')
            e.preventDefault();
        return;
    }
    if (dialog?.open && (anchoredOverlay(view.modal) || !nonmodalDialog() || dialog.contains(e.target)) && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
        return;
    }
    if (dialog?.open && overlayRole(view.modal) === 'menu' && dialog.contains(e.target)) {
        const options = [...dialog.querySelectorAll('[role=menuitem]:not([disabled]),[role=menuitemradio]:not([disabled])')];
        const index = options.indexOf(document.activeElement), next = menuDestination(e.key, index, options.length);
        if (next >= 0) {
            e.preventDefault();
            options[next]?.focus();
            return;
        }
        if (e.key === 'Tab') {
            const trigger = root.querySelector(overlayAnchor);
            dismissAnchoredOverlay();
            trigger?.focus({ preventScroll: true });
            return;
        }
        if (e.key === ' ' && e.target instanceof HTMLAnchorElement && e.target.getAttribute('role') === 'menuitem') {
            e.preventDefault();
            e.target.click();
            return;
        }
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const ordered = [...options.slice(index + 1), ...options.slice(0, index + 1)];
            const found = ordered.find(node => node.textContent?.trim().toLowerCase().startsWith(e.key.toLowerCase()));
            if (found) {
                e.preventDefault();
                found.focus();
                return;
            }
        }
    }
    if (dialog?.open && e.target.getAttribute('role') === 'option' && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
        const options = [...dialog.querySelectorAll('[role=option]:not([disabled])')], index = options.indexOf(document.activeElement);
        const match = [...options.slice(index + 1), ...options.slice(0, index + 1)].find(node => node.textContent?.trim().toLowerCase().startsWith(e.key.toLowerCase()));
        if (match) {
            e.preventDefault();
            match.focus();
            return;
        }
    }
    if (dialog?.open && ['chat-response-settings', 'service-picker', 'sessions'].includes(view.modal) && e.target.getAttribute('role') === 'option' && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        const options = [...dialog.querySelectorAll('[role=option]:not([disabled])')];
        if (options.length) {
            e.preventDefault();
            const index = options.indexOf(document.activeElement);
            options[e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
        }
        return;
    }
    const work = current(), draft = work ? view.drafts[draftKey(work)] || '' : '';
    const choices = work ? commandChoices(work, draft) : [];
    if ((!dialog?.open || nonmodalDialog()) && e.target.id === 'composer' && !e.isComposing && !composition && choices.length) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            view.commandIndex = (view.commandIndex + (e.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
            render();
            return;
        }
        if ((e.key === 'Enter' && !e.shiftKey) || (e.key === 'Tab' && !e.shiftKey)) {
            e.preventDefault();
            fillCommand(choices[view.commandIndex].command);
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            view.commandDismissed = draft;
            render();
            return;
        }
    }
    if ((!dialog?.open || nonmodalDialog()) && e.key === 'Escape' && !e.isComposing && !composition) {
        if (root.querySelector('.command-palette')) {
            e.preventDefault();
            view.commandDismissed = draft;
            render();
            return;
        }
        if (document.fullscreenElement)
            return;
        if (view.layout === 'chat-only') {
            e.preventDefault();
            restoreChatLayout();
            return;
        }
        if (view.layout === 'service-chat' && innerWidth < 900) {
            e.preventDefault();
            view.layout = 'service-only';
            render();
            restoreLayoutFocus();
            return;
        }
        if (view.layout !== 'workspace') {
            e.preventDefault();
            void exitWorkspaceFocus();
            return;
        }
    }
    if (e.key === "Tab" && dialog?.open && !nonmodalDialog()) {
        const focusable = Array.from(dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],summary,[tabindex]:not([tabindex="-1"])')).filter((node) => node.offsetParent !== null && !node.hidden);
        const first = focusable[0], last = focusable.at(-1);
        if (e.shiftKey &&
            (document.activeElement === first ||
                !dialog.contains(document.activeElement))) {
            e.preventDefault();
            last?.focus();
            return;
        }
        if (!e.shiftKey &&
            (document.activeElement === last ||
                !dialog.contains(document.activeElement))) {
            e.preventDefault();
            first?.focus();
            return;
        }
    }
    if (e.target.id === "composer" &&
        e.key === "Enter" &&
        !e.shiftKey &&
        !e.isComposing &&
        !composition) {
        e.preventDefault();
        const button = root.querySelector('[data-action="send-message"]');
        if (button && !button.disabled)
            button.click();
    }
});
function handleRouteNavigation() {
    if (new URLSearchParams(location.hash.slice(1)).has('ticket')) {
        // A reopen link can navigate an existing tab without a document reload.
        // Ignore obsolete launch fragments and initialize an ordinary session.
        const initialization = adapter.initialize();
        const context = { epoch: adapter.identityEpoch, route: location.hash };
        void initialization.then(() => loadRoute()).catch(error => reportInitializationFailure(error, context.epoch, context.route));
        return;
    }
    // Preserve the request inspector a file target was opened from before the
    // modal is closed by navigation (plain links cannot carry their own source).
    if (lastRoute) {
        const target = isFilesRoute(route()) ? filesRouteTarget(route()) : undefined;
        let previousRoute = [];
        try {
            previousRoute = lastRoute.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
        }
        catch { /* keep no source */ }
        if (target && previousRoute[0] === 'work' && previousRoute[1] === target.workId) {
            if (view.modal === 'pi-request-detail')
                fileSourceReturn = { epoch: adapter.identityEpoch, workId: target.workId, path: target.path,
                    tab: view.tab, modal: view.modal, data: { ...view.data }, scroll: root.querySelector('#modal .modal-body')?.scrollTop ?? 0 };
            // A second hash step (for example after leaving a dirty dialog) keeps a
            // matching source; any other plain navigation drops it.
            else if (fileSourceReturn?.workId !== target.workId || fileSourceReturn?.path !== target.path)
                fileSourceReturn = undefined;
        }
    }
    if ((dirty() || view.configDirty) && location.hash !== lastRoute) {
        const destination = location.hash;
        history.replaceState(null, "", lastRoute || "#/works");
        guard(() => {
            const workId = current()?.id;
            if (workId && view.file)
                adapter.releaseFilePreview(workId, view.file);
            clearFileTarget();
            view.configDirty = false;
            view.config = null;
            location.hash = destination;
        });
        return;
    }
    if (lastRoute === location.hash)
        return;
    lastRoute = location.hash;
    view.modal = "";
    modalChoice++;
    void loadRoute().catch(error => toast(error.message));
    render();
}
window.addEventListener("hashchange", () => languagePicker.close());
window.addEventListener("hashchange", handleRouteNavigation);
window.addEventListener("pagehide", () => { actions.clear(); adapter.stopDownloadObservers(); adapter.stopRunObservers(); adapter.abandonInspectionOnUnload(); adapter.stopFileReads(); });
window.addEventListener("beforeunload", (e) => {
    if (dirty() || view.configDirty || hasUnsentDrafts({ texts: Object.values(view.drafts), imageGroups: imageDrafts.groups(), pending: pendingImageSubmissions.values() })) {
        e.preventDefault();
        e.returnValue = "";
    }
});
let lastIdentity = adapter.identityEpoch;
const runtimeAvailability = new Map();
async function restoreRuntimePanel(work) {
    const epoch = adapter.identityEpoch, origin = location.hash, tab = view.tab, path = view.path;
    await adapter.refreshCapabilities(work.id);
    if (epoch !== adapter.identityEpoch || origin !== location.hash || tab !== view.tab)
        return;
    const service = activeService(work);
    if (service) {
        view.service = service.id;
        if (route()[0] !== 'app')
            view.port = service.ports.includes(view.port) ? view.port : service.ports[0] || 0;
        if (service.observed === 'Ready' && view.port && (tab === 'Services' || route()[0] === 'app'))
            await adapter.ensureServiceEntry(work.id, service.id, view.port).catch(() => undefined);
    }
    if (tab === 'Files' && path === view.path)
        await adapter.loadDirectory(work.id, path).catch(() => undefined);
    const routeTarget = filesRouteTarget(route());
    if (routeTarget && routeTarget.workId === work.id && view.file === routeTarget.path && adapter.project(work).retainWorkspace)
        await openFile(work, routeTarget.path).catch(() => undefined);
    if (epoch === adapter.identityEpoch && origin === location.hash)
        render();
}
adapter.subscribe(() => {
    exportFlows.update();
    if (lastIdentity !== adapter.identityEpoch) {
        lastIdentity = adapter.identityEpoch;
        actions.clear();
        createDraft.clear();
        resetCreateFields();
        unknownFiles.clear();
        fileAttempt = undefined;
        modalTransfers = [];
        uploadPickerTarget = undefined;
        pendingUploadTarget = undefined;
        pendingUploadFiles = [];
        sourceGuardReturn = undefined;
        pendingNav = null;
        workControls.clear();
        serviceControls.clear();
        importStarts.clear();
        workSelections.clear();
        selectionWorkId = '';
        fileChoice++;
        filesRestoreNotice = '';
        workReadErrors.clear();
        view.serviceOpenError = "";
        view.config = null;
        view.configDirty = false;
        view.drafts = {};
        textDraftRevisions.clear();
        imageDrafts.clear();
        pendingImageSubmissions.clear();
        imageDraftErrors.clear();
        resetWorkspaceFocus();
        workspacePanels.clear();
        chatReading.clear();
        expandedActivity.clear();
        pendingWebCommand = undefined;
        fileSelections.clear();
        runtimeAvailability.clear();
        fileSourceReturn = undefined;
        clearFileTarget();
        if (!(view.modal === "import" && adapter.inspection)) {
            view.modal = "";
            view.modalError = "";
        }
    }
    const work = current();
    const restore = work && runtimeAvailability.get(work.id) === false && adapter.project(work).usable;
    for (const item of adapter.state.works)
        runtimeAvailability.set(item.id, adapter.project(item).usable);
    if (restore && work)
        queueMicrotask(() => { void restoreRuntimePanel(work).catch(() => undefined); });
    advanceImportStarts();
    confirmPendingChatCommand();
    render();
});
lastRoute = location.hash;
render();
const initialization = adapter.initialize();
const initializationContext = { epoch: adapter.identityEpoch, route: location.hash };
void initialization.then(async () => { view.coreAddress = adapter.state.core.address; if (adapter.state.sessionState === 'ready')
    void adapter.loadPreferences(); await loadRoute(); }).catch(error => reportInitializationFailure(error, initializationContext.epoch, initializationContext.route));
let packageFiles = [];
let pendingUploadFiles = [];
function downloadURL(url, workName = '') { const link = document.createElement('a'); link.href = url; link.download = ''; link.click(); toast(`${workName ? workName + ' · ' : ''}${t('download.startedBrowser')}`); }
let routeLoad = 0;
const workReadErrors = new Map();
function reportInitializationFailure(error, epoch, origin) {
    if (epoch !== adapter.identityEpoch || origin !== location.hash)
        return;
    const r = route(), message = error instanceof Error ? error.message : String(error);
    if (routeLoad === 0 && ['work', 'app'].includes(r[0]) && r[1] && !adapter.getWork(r[1]))
        workReadErrors.set(r[1], { message, missing: false });
    toast(message); // The existing toast render also exposes persistent Work recovery.
}
function standaloneWorkUnavailable(r) {
    const error = workReadErrors.get(r[1]);
    const identity = t('standalone.identity', { work: r[1], service: r[2], port: r[3] });
    const exits = workLink(t('work.backToWork'), r[1]) + btn(t('work.backToWorks'), 'back-works');
    return `${topbar()}<main class="standalone-app"><p>${esc(identity)}</p>${workReadPending(r[1]) ? readPlaceholder(t('work.loading'), 'service') + exits : empty('grid', error?.missing ? t('work.notFoundTitle') : t('work.unavailableTitle'), esc(error?.message || adapter.worksError || t('work.readAgainHint')), btn(t('common.retry'), 'retry-work-read', 'primary') + exits)}</main>`;
}
function workReadPending(workId) {
    if ([...actions.records.values()].some(record => record.work === workId && record.pending))
        return true;
    // Bootstrap confirms connection/list metadata before the first route read starts.
    return routeLoad === 0 && !workReadErrors.has(workId) && !adapter.worksError &&
        ['loading', 'normal', 'empty'].includes(adapter.state.scenario);
}
async function loadRoute() {
    if (!adapter.state.signedIn)
        return;
    const version = ++routeLoad, r = route(), origin = location.hash, epoch = adapter.identityEpoch;
    const valid = () => version === routeLoad && origin === location.hash && epoch === adapter.identityEpoch;
    const filesRoute = isFilesRoute(r);
    const filesTarget = filesRoute ? filesRouteTarget(r) : undefined;
    if (!['work', 'app'].includes(r[0]) || r[2] === 'settings' || workspaceReturn && workspaceReturn.workId !== r[1] || filesRoute) {
        if (!await exitWorkspaceFocus() || !valid())
            return;
    }
    const entering = selectionWorkId !== r[1] || !['work', 'app'].includes(r[0]);
    if (!['work', 'app'].includes(r[0]) || !r[1]) {
        selectionWorkId = '';
        render();
        await adapter.listWorks().catch(() => undefined);
        return;
    }
    const savedSelection = workSelections.get(r[1]);
    const previous = restoreSelection(savedSelection);
    if (entering) {
        selectionWorkId = r[1];
        fileChoice++;
        filesRestoreNotice = '';
        fileSourceReturn = undefined;
        view.tab = filesRoute ? 'Files' : previous.area;
        view.path = filesRoute && filesTarget ? parentDirectory(filesTarget.path) : previous.path;
        view.file = '';
        view.selected = [];
        view.service = previous.service;
        view.port = previous.port;
        view.session = previous.session;
        view.noteLoaded = '';
    }
    const choices = { area: areaChoice, service: serviceChoice, session: sessionChoice, file: fileChoice, modal: modalChoice };
    const record = actions.begin({ key: `route:${r[1]}:${version}`, kind: 'read', work: r[1], label: t('actions.loadingWork'), target: r[1], view: location.hash });
    render();
    try {
        const work = await adapter.loadWork(r[1], r[0] !== 'app');
        if (!valid())
            return;
        workReadErrors.delete(r[1]);
        const serviceId = r[0] === 'app' ? r[2] : view.service;
        const port = r[0] === 'app' ? Number(r[3]) : view.port;
        const service = work.services.find(s => s.id === serviceId) ?? work.services.find(s => s.enabled && s.observed === 'Ready' && s.ports.length);
        if (choices.service === serviceChoice) {
            view.service = r[0] === 'app' ? r[2] : service?.id ?? '';
            view.port = r[0] === 'app' ? port : service?.ports.includes(port) ? port : service?.ports[0] ?? 0;
        }
        if (choices.session === sessionChoice)
            view.session = work.sessions.find(s => s.id === view.session)?.id ?? work.sessions[0]?.id ?? '';
        if (view.session && r[0] !== 'app')
            await adapter.loadSession(work.id, view.session);
        if (!valid())
            return;
        if (filesRoute && choices.area === areaChoice && choices.file === fileChoice) {
            // An explicit target wins over the last restored area; it is checked, not assumed.
            view.tab = 'Files';
            view.modal = '';
            if (filesTarget) {
                view.path = parentDirectory(filesTarget.path);
                clearFileTarget();
                if (adapter.project(work).retainWorkspace) {
                    await openFile(work, filesTarget.path).catch(() => undefined);
                }
                else {
                    view.file = filesTarget.path;
                    view.fileStatus = 'unavailable';
                    view.fileError = t('files.workNotRunning');
                }
                if (!valid())
                    return;
            }
            else {
                view.path = '/';
                view.file = '';
                view.fileStatus = 'idle';
                filesRestoreNotice = t('files.invalidLink');
                if (adapter.project(work).usable)
                    await adapter.loadDirectory(work.id, '/').catch(() => undefined);
                if (!valid())
                    return;
            }
        }
        else if (entering && r[0] === 'work' && r[2] !== 'settings' && choices.area === areaChoice && choices.modal === modalChoice)
            view.tab = initialWorkArea(savedSelection, work, adapter.project(work).usable, adapter.modelReady(work.id, view.session));
        if (r[2] === 'settings' && !view.configDirty)
            view.config = structuredClone(work.config);
        if (!filesRoute && entering && r[0] !== 'app' && r[2] !== 'settings' && choices.area === areaChoice && choices.file === fileChoice && view.tab === 'Files' && adapter.project(work).usable)
            await restoreFiles(work, previous, valid);
        if (!valid())
            return;
        const selectedService = activeService(work);
        if ((view.tab === 'Services' || r[0] === 'app') && selectedService?.observed === 'Ready' && view.port)
            await adapter.ensureServiceEntry(work.id, selectedService.id, view.port).catch(error => { if (valid())
                toast(error.message); });
        if (valid())
            render();
    }
    catch (error) {
        if (valid() && record && actions.current(record)) {
            actions.fail(record, error);
            workReadErrors.set(r[1], { message: error instanceof Error ? error.message : String(error), missing: error instanceof DesktopError && error.httpStatus === 404 });
        }
    }
    finally {
        if (record) {
            actions.finish(record);
            actions.records.delete(record.key);
            render();
        }
    }
}
window.addEventListener('popstate', handleRouteNavigation);
/** Update existing nodes in place. In particular, never detach an unchanged Service iframe or its ancestors. */
function reconcileHTML(parent, html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const key = (node) => {
        if (!(node instanceof Element))
            return node.nodeType === Node.TEXT_NODE ? '#text' : '#other';
        if (node.hasAttribute('data-message-key'))
            return `message:${node.getAttribute('data-message-key')}`;
        if (node.hasAttribute('data-service-key'))
            return `frame:${node.getAttribute('data-service-key')}`;
        if (node.id)
            return `id:${node.id}`;
        // Removing Cancel must not turn the original Check status node into Close.
        if (node.matches('button[data-action]'))
            return `action:${['action', 'id', 'path', 'run-id', 'cancel-run-id', 'run', 'session', 'index', 'tab', 'control', 'kind', 'option-value', 'command', 'copy'].map(name => node.getAttribute(`data-${name}`) ?? '').join(':')}`;
        return `${node.tagName}:${node.getAttribute('class')?.split(' ')[0] ?? ''}`;
    };
    const patch = (target, incoming) => {
        if (target instanceof Element && incoming instanceof Element) {
            if (target instanceof HTMLIFrameElement) {
                // Keep the mounted document: never touch src/srcdoc, but sync the
                // accessible presentation (title, aria-*) with the current language.
                for (const attr of Array.from(incoming.attributes)) {
                    if (attr.name === 'src' || attr.name === 'srcdoc')
                        continue;
                    if (target.getAttribute(attr.name) !== attr.value)
                        target.setAttribute(attr.name, attr.value);
                }
                return;
            }
            for (const attr of Array.from(target.attributes))
                if (!incoming.hasAttribute(attr.name) && !((target instanceof HTMLDialogElement || target instanceof HTMLDetailsElement) && attr.name === 'open') && attr.name !== 'data-observed' && attr.name !== 'data-bound' && attr.name !== 'data-scroll-bound')
                    target.removeAttribute(attr.name);
            for (const attr of Array.from(incoming.attributes))
                if (target.getAttribute(attr.name) !== attr.value)
                    target.setAttribute(attr.name, attr.value);
            const isFile = target instanceof HTMLInputElement && target.type === 'file';
            if (target instanceof HTMLInputElement && incoming instanceof HTMLInputElement && !isFile) {
                if (document.activeElement !== target && target.type !== 'password')
                    target.value = incoming.value;
                target.checked = incoming.checked;
                target.disabled = incoming.disabled;
            }
            if (target instanceof HTMLTextAreaElement && incoming instanceof HTMLTextAreaElement) {
                if (document.activeElement !== target)
                    target.value = incoming.value;
                return;
            }
            children(target, incoming);
            if (target instanceof HTMLSelectElement && incoming instanceof HTMLSelectElement && document.activeElement !== target)
                target.value = incoming.value;
        }
        else if (target.nodeValue !== incoming.nodeValue)
            target.nodeValue = incoming.nodeValue;
    };
    const children = (target, incoming) => {
        const external = (node) => node instanceof Element && node.hasAttribute('data-action-status');
        const nextOwned = (node) => { while (node && external(node))
            node = node.nextSibling; return node; };
        let cursor = nextOwned(target.firstChild);
        const used = new Set();
        const desired = Array.from(incoming.childNodes);
        for (const [index, child] of desired.entries()) {
            // Remove obsolete notices before matching the next node. Moving a stable
            // ancestor ahead of a disappearing notice unloads its iframe document.
            if (cursor && key(cursor) !== key(child)) {
                const remaining = new Set(desired.slice(index).map(key));
                while (cursor && !remaining.has(key(cursor))) {
                    const next = nextOwned(cursor.nextSibling);
                    target.removeChild(cursor);
                    cursor = next;
                }
            }
            if (cursor && key(cursor) === key(child)) {
                const next = nextOwned(cursor.nextSibling);
                used.add(cursor);
                patch(cursor, child);
                cursor = next;
            }
            else {
                const match = Array.from(target.childNodes).find(node => node !== cursor && !external(node) && !used.has(node) && key(node) === key(child));
                if (match) {
                    used.add(match);
                    target.insertBefore(match, cursor);
                    patch(match, child);
                }
                else {
                    const inserted = child.cloneNode(true);
                    used.add(inserted);
                    target.insertBefore(inserted, cursor);
                }
            }
        }
        while (cursor) {
            const next = nextOwned(cursor.nextSibling);
            target.removeChild(cursor);
            cursor = next;
        }
    };
    children(parent, template.content);
}
function skillState(work, name, field) { const runtime = work.config.runtime?.skills?.find((s) => s.name === name); const value = runtime?.[field]; return value === undefined ? t('text.notProvided') : field === "loaded" ? value ? t('runtimeSkill.loaded') : t('runtimeSkill.notLoaded') : value ? t('runtimeSkill.visible') : t('runtimeSkill.notVisible'); }
function brainBehavior(adoption) {
    return adoption === "verified" ? t('brain.verified') : adoption === "failed" ? t('brain.failed') : adoption === "not-confirmed" ? t('brain.notConfirmed') : t('brain.unavailable');
}
function packageStatus(work, name) { const p = work.packageEntries?.find(p => p.name === name); return p ? `${p.pendingApply ? t('packageStatus.savedNotApplied') : t('packageStatus.saved')} · ${p.runtime?.loaded === true ? t('packageStatus.loaded') : p.runtime?.loaded === false ? t('packageStatus.notLoaded') : t('packageStatus.loadingUnconfirmed')}${p.candidate ? t('packageStatus.candidate', { preparation: p.candidate.preparation, behavior: brainBehavior(p.candidate.adoption) }) + (p.candidate.apply?.state === "failed" ? t('packageStatus.applyFailedSuffix') : "") : ""}` : t('packageStatus.runtimeNotProvided'); }
function brainCandidateDetails(entry) {
    const candidate = entry?.candidate;
    if (!candidate)
        return `<p>${t('candidate.none')}</p>`;
    const baseline = candidate.baseline, verification = candidate.verification, apply = candidate.apply;
    const selection = (enabled, matches) => typeof enabled !== "boolean" || typeof matches !== "boolean" ? t('candidate.baselineUnavailable') : t('candidate.selectionState', { state: enabled ? t('stateValue.enabled') : t('stateValue.disabled'), match: matches ? t('candidate.stillMatches') : t('candidate.changedSinceAcceptance') });
    const operation = (id, label) => btn(esc(label), "operation", "inline-link", `data-id="${esc(id)}"`);
    const applyKnown = apply?.availability === "available" && apply.operationId && apply.state;
    const applyState = applyKnown ? `${apply.state === "failed" ? t('candidate.applyFailed') : t('candidate.applyState', { state: apply.state })} · ${operation(apply.operationId, apply.operationId)}` : apply?.availability === "not-applied" ? t('candidate.noMatchingApply') : t('candidate.applyUnavailable');
    const preparation = candidate.preparation === "succeeded" ? t('candidate.published') : ["failed", "superseded", "cleanup-pending"].includes(candidate.preparation) ? candidate.preparation : t('candidate.preparing');
    return `<h3>${t('candidate.heading', { source: esc(candidate.source) })}</h3><dl><dt>${t('candidate.activeSelection')}</dt><dd>${esc(selection(baseline?.activeSelected, baseline?.activeMatchesCurrent))}</dd><dt>${t('candidate.savedSelection')}</dt><dd>${esc(selection(baseline?.desiredSelected, baseline?.desiredMatchesCurrent))}</dd><dt>${t('candidate.verificationGoal')}</dt><dd>${esc(verification?.goal ?? t('candidate.verificationUnavailable'))}</dd><dt>${t('candidate.capability')}</dt><dd>${esc(verification?.toolName ?? t('common.unavailable'))}</dd><dt>${t('candidate.inputSummary')}</dt><dd><pre>${esc(verification?.inputSummary ?? t('common.unavailable'))}</pre></dd><dt>${t('candidate.requiredChecks')}</dt><dd>${Array.isArray(verification?.checkNames) ? verification.checkNames.map((name) => `<div>${esc(name)}</div>`).join("") : t('common.unavailable')}</dd><dt>${t('candidate.preparation')}</dt><dd>${esc(preparation)} · ${operation(candidate.operationId, t('candidate.preparationOperation'))}</dd><dt>${t('candidate.saved')}</dt><dd>${candidate.desired ? t('candidate.yes') : t('candidate.no')}</dd><dt>${t('candidate.active')}</dt><dd>${candidate.active ? t('candidate.yes') : t('candidate.no')}</dd><dt>${t('candidate.loaded')}</dt><dd>${entry?.runtime?.availability !== "available" ? t('candidate.loadingUnavailable') : entry.runtime.loaded === true ? t('candidate.yes') : entry.runtime.loaded === false ? t('candidate.no') : t('packageStatus.loadingUnconfirmed')}</dd><dt>${t('candidate.originalApply')}</dt><dd>${applyState}</dd><dt>${t('candidate.sdkBehavior')}</dt><dd>${esc(brainBehavior(candidate.adoption))}</dd></dl>${apply?.error ? feedback(`${esc(apply.error.code)}: ${esc(apply.error.message)}`, "warning") : ""}${btn(t('candidate.originalRequest'), "pi-request-detail", "small", `data-id="${esc(candidate.requestId)}"`)}`;
}
function prepareSelectedEntry() {
    const work = current();
    if (!work || !adapter.state.signedIn || !adapter.project(work).usable || work.resourceErrors?.services)
        return;
    if (route()[0] !== 'app' && (route()[2] === 'settings' || view.tab !== 'Services'))
        return;
    const service = route()[0] === 'app' ? work.services.find(item => item.id === route()[2]) : activeService(work);
    if (!service || service.observed !== 'Ready' || !service.enabled || !service.ports.includes(view.port))
        return;
    if (adapter.serviceEntryUrl(work.id, service.id, view.port) || adapter.serviceEntryError(work.id, service.id, view.port) || adapter.serviceEntryPending(work.id, service.id, view.port))
        return;
    void adapter.ensureServiceEntry(work.id, service.id, view.port).catch(() => undefined);
}
// Observe only confirmed Work/Service facts; preserve the current Session, form drafts and application DOM.
let statusRefreshRunning = false;
setInterval(() => {
    const work = current();
    if (!work || !adapter.state.signedIn || document.visibilityState !== 'visible' || statusRefreshRunning)
        return;
    statusRefreshRunning = true;
    void adapter.refreshVisibleWork(work.id).catch(() => undefined).finally(() => { statusRefreshRunning = false; });
}, 5000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && adapter.state.signedIn && route()[0] === 'works')
    void adapter.listWorks().catch(() => undefined); exportFlows.setVisible(document.visibilityState === 'visible'); observeCurrentPage(); });
window.addEventListener('pagehide', () => { exportFlows.revoke(t('export.pageEnded')); adapter.observePage('', false); });
function consumeWebSelection(kind) { if (pendingWebCommand?.kind === kind) {
    if (view.drafts[pendingWebCommand.key] === pendingWebCommand.text)
        view.drafts[pendingWebCommand.key] = '';
    pendingWebCommand = undefined;
} }
root.addEventListener('toggle', event => { const target = event.target; if (target instanceof HTMLDetailsElement && target.dataset.activityKey)
    expandedActivity.set(target.dataset.activityKey, target.open); }, true);
document.addEventListener('fullscreenchange', () => render());
function composerCaret(event) { const input = event.target; if (input instanceof HTMLTextAreaElement && input.id === 'composer' && !composition) {
    const position = input.selectionStart ?? 0;
    if (position !== view.commandCaret) {
        view.commandCaret = position;
        render();
    }
} }
root.addEventListener('click', composerCaret);
root.addEventListener('keyup', composerCaret);
root.addEventListener('paste', event => { if (!event.target.closest('#composer'))
    return; const files = [...(event.clipboardData?.items ?? [])].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file) => !!file); if (!files.length)
    return; if (!event.clipboardData?.getData('text/plain'))
    event.preventDefault(); void addChatImages(files); });
root.addEventListener('dragover', event => { if (event.target.closest('.composer') && event.dataTransfer?.types.includes('Files'))
    event.preventDefault(); });
root.addEventListener('drop', event => { if (!event.target.closest('.composer'))
    return; const files = [...(event.dataTransfer?.files ?? [])]; if (files.length) {
    event.preventDefault();
    void addChatImages(files);
} });
root.addEventListener('change', event => { const input = event.target; if (input.id === 'chat-image-input') {
    const files = [...(input.files ?? [])];
    input.value = '';
    void addChatImages(files);
} });
window.addEventListener('pagehide', () => { imageDrafts.clear(); adapter.stopImageReads(); imageObserver.disconnect(); });
function productInfoMarkup(label, info, loading, error) {
    const build = info?.build, notes = info?.releaseNotes;
    return `<section class="product-info"><h3>${esc(label)}</h3>${loading ? `<p>${t('product.loadingVersion')}</p>` : ''}${error ? feedback(esc(error), 'warning') : ''}${build ? `<dl><dt>${t('product.version')}</dt><dd>${esc(build.version)}</dd><dt>${t('product.build')}</dt><dd><code>${esc(build.commit)}</code>${build.modified ? t('product.modified') : ''}</dd><dt>${t('product.platform')}</dt><dd>${esc(build.os)} / ${esc(build.architecture)}</dd></dl><details><summary>${t('product.releaseNotes')}</summary>${notes ? `<h4>${esc(notes.title)} · ${esc(notes.version)}</h4>${notes.publishedAt ? `<p>${esc(notes.publishedAt)}</p>` : ''}${(notes.sections ?? []).map((section) => `<h4>${esc(section.title)}</h4><ul>${section.items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`).join('')}` : `<p>${t('product.releaseNotesUnavailable')}</p>`}</details>` : ''}<p><a href="https://github.com/pphboy/piwork/releases" target="_blank" rel="noopener noreferrer">${t('product.allReleases')}</a></p></section>`;
}
window.addEventListener("hashchange", () => { adapter.stopImageReads(); adapter.stopFileReads(); });
function consumeImageSubmission(workId, submitted) {
    if (submitted.epoch !== adapter.identityEpoch)
        return;
    for (const key of new Set([submitted.key, submitted.destinationKey])) {
        imageDrafts.consume(key, submitted.images);
        if ((textDraftRevisions.get(key) || 0) === submitted.textRevision && view.drafts[key] === submitted.text)
            view.drafts[key] = '';
        if (imageDraftErrors.get(key) === submitted.error)
            imageDraftErrors.delete(key);
    }
    if (pendingImageSubmissions.get(workId) === submitted)
        pendingImageSubmissions.delete(workId);
    render();
}
//# sourceMappingURL=app.js.map