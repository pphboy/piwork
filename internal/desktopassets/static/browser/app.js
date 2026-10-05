import { activityGroups } from './chat-projection.js';
import { editAdvanced, synchronizeConfiguration } from './configuration.js';
import { ActionState, renderActionStates } from './action-state.js';
import { adapter, DesktopError, fileVersion } from "./adapter.js";
const root = document.querySelector("#app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const icon = (name, size = 18) => {
    const paths = {
        arrow: '<path d="m10 5-7 7 7 7M3 12h18"/>',
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
    };
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.grid}</svg>`;
};
const btn = (label, action, cls = "", extra = "") => `<button class="button ${cls}" data-action="${action}" ${extra}>${label}</button>`;
const badge = (status) => `<span class="status ${status.toLowerCase().replaceAll(" ", "-")}"><i></i>${esc(status)}</span>`;
const feedback = (text, tone = "info", action = "") => `<div class="feedback ${tone}" role="status">${icon(tone === "success" ? "check" : "info")}<div>${text}</div>${action}</div>`;
const empty = (symbol, title, body, action = "") => `<div class="empty">${icon(symbol, 32)}<h2>${title}</h2><p>${body}</p>${action}</div>`;
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
const expandedActivity = new Map();
let workspaceReturn, chatReturn;
const chatReading = new Map();
let pendingWebCommand;
let importSignInSuspended = false;
const actions = new ActionState(() => render());
class ViewChanged extends Error {
}
let sessionChoice = 0, areaChoice = 0, serviceChoice = 0, selectionRequest = 0, modalChoice = 0;
const fileSelections = new Map();
const viewKey = () => `${location.hash}:${view.modal}:${modalChoice}:${view.tab}:${view.path}:${view.service}:${view.port}:${sessionChoice}`;
const actionLabels = {
    'check-browser-access': 'Checking browser access', 'confirm-reset-browser-access': 'Resetting browser access', 'sign-in': 'Signing in', 'sign-out': 'Signing out', 'confirm-switch-core': 'Switching Core', 'check-connection': 'Checking connection',
    'retry-works': 'Loading Works', 'create-work': 'Creating Work', 'start-work': 'Starting Work', 'confirm-stop': 'Stopping Work', 'confirm-delete': 'Deleting Work',
    'retry-work-read': 'Loading Work', 'open-work': 'Loading Work', 'check-work': 'Checking Work', settings: 'Reading settings', 'tab-Services': 'Loading Services', 'tab-Files': 'Reading workspace',
    'load-models': 'Reading models', 'save-model': 'Saving Session model', 'check-session-model': 'Reading Session model', 'pi-requests': 'Reading Pi requests', 'pi-request-detail': 'Reading Pi request', 'cancel-pi-request': 'Cancelling Pi request', 'retry-pi-request': 'Retrying Pi request', 'next-pi-requests': 'Reading more Pi requests', 'next-pi-evidence': 'Reading more evidence',
    'sessions': 'Reading Sessions', 'select-session': 'Reading Session', 'new-session': 'Creating Session', 'send-message': 'Submitting message', 'cancel-run': 'Requesting cancellation', 'resume-run': 'Reconnecting Run',
    'service-details': 'Reading logs', 'service-action': 'Submitting Service control', 'confirm-service-control': 'Submitting Service control', 'refresh-logs': 'Reading logs',
    'open-app': 'Opening application', 'open-window': 'Opening application', 'retry-service-entry': 'Preparing application', 'check-preview': 'Checking preview',
    'refresh-files': 'Reading workspace', 'file-path': 'Reading directory', 'open-file': 'Reading file', 'open-source': 'Reading file', 'save-file': 'Saving file', 'dirty-save': 'Saving file',
    'confirm-upload-overwrite': 'Uploading files', 'confirm-folder': 'Creating folder', 'confirm-transfer': 'Transferring files', 'confirm-file-delete': 'Deleting files',
    'save-config': 'Saving settings', 'dirty-config-save': 'Saving settings', 'refresh-config': 'Reading settings', 'apply-config': 'Submitting Apply', 'confirm-core-skills': 'Copying Skill', 'check-catalog': 'Reading catalog',
    'confirm-install': 'Submitting package', 'confirm-remove-package': 'Removing package', 'confirm-import': 'Submitting import', 'prepare-export': 'Preparing Export',
    'download-work': 'Preparing download', 'check-download': 'Checking transfer', 'check-operation': 'Checking Operation', 'lookup-operation': 'Reading Operation', 'lookup-snapshot': 'Reading snapshot',
    'operations': 'Reading known Operations', 'clear-operations': 'Clearing completed records', 'resume-operation': 'Resuming observation', 'check-inspection-import': 'Checking transfer', 'retry-inspection-cleanup': 'Releasing local transfer',
};
function actionIntent(el, action = el.dataset.action || '') {
    let label = actionLabels[action];
    if (!label)
        return;
    if (['service-action', 'confirm-service-control'].includes(action))
        label = `${el.dataset.control || view.data.control || "Control"} Service`;
    const w = targetWork(el);
    let kind = 'read';
    if (['sign-in', 'sign-out', 'confirm-switch-core', 'confirm-reset-browser-access'].includes(action))
        kind = 'identity';
    else if (['create-work', 'start-work', 'confirm-stop', 'confirm-delete'].includes(action))
        kind = 'lifecycle';
    else if (['save-file', 'dirty-save', 'confirm-upload-overwrite', 'confirm-folder', 'confirm-transfer', 'confirm-file-delete', 'upload-input'].includes(action))
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
    else if (['confirm-import', 'download-work', 'prepare-export'].includes(action))
        kind = 'transfer';
    const serviceAction = ['service-details', 'service-action', 'confirm-service-control', 'refresh-logs', 'open-app', 'open-window', 'retry-service-entry', 'check-preview'].includes(action);
    const serviceId = el.dataset.id || view.data.serviceId || view.service;
    const resource = action === 'create-work' ? view.createName.trim() : kind === 'lifecycle' || action === 'settings' ? w?.id : serviceAction ? `service:${serviceId}${kind === 'service' ? '' : `:${view.port}`}` : el.dataset.path || el.dataset.id || view.data.serviceId || view.data.paths || (action === 'confirm-folder' ? joinPath(view.path, view.formName) : view.file || view.path);
    const key = `${kind}:${w?.id || 'local'}:${resource}:${action}`;
    const chatAction = ['new-session', 'send-message', 'cancel-run', 'resume-run', 'check-session-model', 'save-model'].includes(action);
    return { key, kind, work: w?.id, resource, action, label, target: action === 'create-work' ? view.createName || 'New Work' : chatAction ? w?.name || 'Chat' : `${w?.name || adapter.state.core.address || 'Local CLI'}${resource && resource !== w?.id ? ` · ${resource}` : ''}`,
        anchor: focusKey(el), view: location.hash };
}
async function dispatchAction(el, perform = record => handleAction(el.dataset.action, el, record), intent = actionIntent(el)) {
    if (!intent) {
        await perform();
        return;
    }
    const conflict = actions.conflict(intent);
    if (conflict) {
        toast(`${conflict.target} · ${conflict.phase}. Wait for confirmation.`);
        return;
    }
    const record = actions.begin(intent);
    try {
        await perform(record);
        actions.finish(record);
        if (['refresh-files'].includes(el.dataset.action || ''))
            actions.reviewed(record.work, ['files']);
        if (['refresh-config'].includes(el.dataset.action || ''))
            actions.reviewed(record.work, ['configuration']);
    }
    catch (error) {
        if (!(error instanceof ViewChanged))
            actions.fail(record, error);
        else
            actions.finish(record);
        throw error;
    }
    finally {
        if (record.work && ['files', 'configuration'].includes(record.kind))
            adapter.uploadProgress.delete(record.work);
    }
}
function progressText(progress) {
    const total = typeof progress.total === 'number' && Number.isFinite(progress.total) && progress.total > 0 ? progress.total : undefined;
    return `${esc(progress.phase)}${progress.transferred !== undefined ? ` · ${esc(progress.transferred)}${total ? ` / ${total}` : ''} bytes` : ''}${total ? `<progress value="${Math.min(progress.transferred || 0, total)}" max="${total}" aria-label="Transfer bytes"></progress>` : ''}`;
}
function uploadProgressMarkup() {
    const work = current(), progress = work && adapter.uploadProgress.get(work.id);
    if (!progress)
        return '';
    return feedback(`${esc(progress.path)}${progress.count ? ` · File ${progress.index} of ${progress.count}` : ''} · ${progressText(progress)}`);
}
function downloadProgressMarkup(snapshotID) {
    const job = adapter.downloads.get(snapshotID);
    if (!job)
        return '';
    return feedback(`Transfer <code>${esc(job.transferId)}</code> · ${progressText(job)}${job.checkedAt ? ` · Checked ${esc(job.checkedAt)}` : ''}${job.error ? ` · ${esc(job.error)}` : ''}${job.observationError ? ` · Observation interrupted: ${esc(job.observationError)}` : ''}`, job.error || job.observationError ? 'warning' : 'info', btn('Check transfer', 'check-download', 'small', `data-id="${esc(snapshotID)}"`));
}
let toastTimer;
let lastFocus = null;
let pendingNav = null;
let composition = false;
let lastRoute = "";
const route = () => {
    if (location.hash && !location.hash.includes("ticket="))
        return location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
    const match = /^\/works\/([^/]+)(?:\/services\/([^/]+))?/.exec(location.pathname);
    return match ? match[2] ? ["app", decodeURIComponent(match[1]), decodeURIComponent(match[2]), new URLSearchParams(location.search).get("port") || ""] : ["work", decodeURIComponent(match[1])] : ["works"];
};
const current = () => adapter.getWork(route()[1] || "");
const activeService = (w) => w.services.find((s) => s.id === view.service) ||
    w.services.find((s) => s.enabled && s.observed === "Ready" && s.ports.length) ||
    w.services[0];
const unavailable = () => ["core-offline", "cli-closed", "ticket-expired"].includes(adapter.state.scenario) || !adapter.state.signedIn;
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
function rememberWork() {
    const w = current();
    if (w)
        workSelections.set(w.id, {
            service: view.service,
            port: view.port,
            session: view.session,
        });
}
function draftKey(w, session = view.session) {
    return `${w.id}:${session || "new"}`;
}
async function openWork(w, record) {
    await guard(async () => {
        rememberWork();
        location.hash = `/work/${w.id}`;
        lastRoute = location.hash;
        view.tab = 'Services';
        view.modal = '';
        if (record)
            record.view = location.hash;
        render();
        const key = viewKey();
        await adapter.loadWork(w.id);
        if (key !== viewKey())
            throw new ViewChanged();
        rememberWork();
        const previous = workSelections.get(w.id);
        const service = w.services.find((s) => s.id === previous?.service &&
            s.enabled &&
            s.observed === "Ready" &&
            s.ports.length) ||
            w.services.find((s) => s.enabled && s.observed === "Ready" && s.ports.length);
        view.tab =
            w.status === "Stopped" ? "Services" : service ? "Services" : "Chat";
        view.session =
            w.sessions.find((s) => s.id === previous?.session)?.id ||
                w.sessions[0]?.id ||
                "";
        view.service = service?.id || "";
        view.port = service?.ports.includes(previous?.port || 0)
            ? previous.port
            : service?.ports[0] || 3000;
        view.noteLoaded = "";
        view.file = "";
        view.path = "/";
        view.selected = [];
        location.hash = `/work/${w.id}`;
        lastRoute = location.hash;
        render();
    });
}
function openModal(name, data = {}) {
    modalChoice++;
    lastFocus = document.activeElement;
    view.modal = name;
    view.data = data;
    view.modalError = "";
    view.formName = "";
    view.formDestination = view.path;
    view.formOverwrite = false;
    view.deleteConfirmed = false;
    render();
}
function closeModal() {
    modalChoice++;
    if (['chat-models', 'chat-thinking'].includes(view.modal) && pendingWebCommand && ['model', 'thinking'].includes(pendingWebCommand.kind) && !pendingWebCommand.pair)
        pendingWebCommand = undefined;
    if (view.modal === 'export')
        adapter.stopDownloadObservers();
    if (view.modal === "import")
        void adapter.abandonInspection();
    view.modal = "";
    view.modalError = "";
    render();
    lastFocus?.focus();
}
const phase = (op) => `<div class="phase-track" role="status"><div><span>${op.state === "succeeded" ? icon("check", 14) : icon("clock", 14)}</span>Current phase: ${esc(op.phase || op.state)}</div></div>`;
function scenarioBar() { return ""; }
function brand() {
    return `<a href="#/works" class="brand" aria-label="piwork Works"><span class="brand-mark">p<span>i</span></span><b>piwork</b><span class="brand-product">Desktop</span></a>`;
}
function topbar() {
    if (adapter.state.browserAccess !== "authorized")
        return `<header class="topbar">${brand()}</header>`;
    return `<header class="topbar">${brand()}<div class="topbar-right">${btn(`${icon("clock")} <span>Known operations</span>`, "operations", "quiet")}${btn(`<span class="avatar">${esc(adapter.state.core.account.slice(0, 1).toUpperCase() || "?")}</span><span>${esc(adapter.state.core.account || "Account")}</span>${icon("down", 14)}`, "account", "account-button quiet")}</div></header>`;
}
function defaultCorePreferences() {
    const p = adapter.preferences, blocked = ['saving', 'clearing', 'unconfirmed'].includes(p.phase);
    const pending = p.phase === 'saving' ? 'Saving default…' : p.phase === 'clearing' ? 'Restoring automatic selection…' : p.phase === 'loading' ? 'Reading saved default…' : p.phase === 'unconfirmed' ? 'Change not yet confirmed. Read the saved default to continue.' : '';
    return `<section class="default-core-preferences" aria-label="Default Core"><p class="muted">Current connection: <code>${esc(adapter.state.core.address)}</code></p><p>Saved default: <strong>${esc(p.confirmed ? p.coreUrl || 'Not set · automatic selection' : 'Not yet read')}</strong></p><p class="muted">Saving affects future launches. Parameters and environment can override it. Use Sign in or Connect to change the current connection.</p><div>${btn('Save as default', 'save-default-core', 'quiet small', blocked ? 'disabled' : '')}${btn('Restore automatic selection', 'clear-default-core', 'quiet small', blocked ? 'disabled' : '')}${btn('Read saved default', 'read-default-core', 'quiet small', ['saving', 'clearing', 'loading'].includes(p.phase) ? 'disabled' : '')}</div>${pending ? `<p role="status" aria-live="polite">${esc(pending)}${p.waiting ? ' Still waiting for confirmation; other actions remain available.' : ''}</p>` : ''}${p.error ? feedback(esc(p.error), 'warning') : ''}${p.notice ? `<p role="status" aria-live="polite">${esc(p.notice)}</p>` : ''}</section>`;
}
function connection() {
    const s = adapter.state.scenario;
    return `<button class="connection" data-action="connection"><i class="${["core-offline", "env-not-ready"].includes(s) ? "warn" : ""}"></i>${esc(adapter.state.core.name)}<span>·</span>${s === "core-offline" ? "Unreachable" : s === "env-not-ready" ? "Runtime not ready" : "Connected"}${icon("down", 12)}</button>`;
}
function signIn() {
    const access = adapter.state.browserAccess;
    if (access !== 'authorized') {
        const checking = access === 'checking', unavailable = access === 'unavailable';
        return `${topbar()}<main class="auth-main browser-access"><div class="auth-symbol">${icon("lock", 26)}</div><h1>${checking ? 'Opening workspace…' : unavailable ? 'Desktop connection unavailable' : 'Browser access required'}</h1><p class="muted" role="status" aria-live="polite">${checking ? 'Connecting to your local Desktop…' : esc(adapter.state.browserAccessReason)}</p>${checking ? '' : `${btn('Check browser access', 'check-browser-access', 'primary full')}<div class="recovery-command"><p>From a terminal as the same system user:</p><code>${esc(adapter.reopenCommand())}</code>${btn('Copy reopen command', 'copy-reopen-command', 'quiet full')}</div><p class="muted">If the instance is not running, start it with <code>${esc(adapter.startCommand())}</code>. Reopening a running instance keeps its Core, Works and browser sessions.</p><div class="recovery-command"><p>To clear this Desktop’s saved Core login without browser access:</p><code>${esc(adapter.logoutCommand())}</code>${btn('Copy logout command', 'copy-logout-command', 'quiet full')}</div>`}</main>`;
    }
    return `${topbar()}<main class="auth-main"><div class="auth-symbol">${icon("lock", 26)}</div><h1>Connect to your Core</h1><p class="muted">Sign in with your Core account. Credentials stay with the local CLI.</p>${adapter.state.cleanupRequired ? feedback(`Local identity is cleared, but saved credential cleanup is incomplete. Run <code>${esc(adapter.logoutCommand())}</code> before signing in or switching Core.`, 'warning') : ''}${view.toast ? feedback(esc(view.toast), "warning") : ""}<label class="field">Core address<input id="auth-core" value="${esc(view.coreAddress || adapter.state.core.address)}" placeholder="http://127.0.0.1:7181"></label>${defaultCorePreferences()}<label class="field">Account<input id="auth-account" autocomplete="username" value="${esc(view.authAccount)}"></label><label class="field">Password<input id="auth-password" type="password" autocomplete="current-password"></label>${btn("Sign in", "sign-in", "primary full")}<div class="auth-divider">Inspect a Work package locally before signing in</div>${btn(`${icon("upload", 16)} Inspect a .work package`, "import", "quiet")}</main>`;
}
function works() {
    const s = adapter.state.scenario;
    const all = adapter.state.works.filter((w) => w.name.toLowerCase().includes(view.search.toLowerCase()));
    return `${topbar()}<main class="works-page"><div class="works-eyebrow">YOUR WORKSPACE</div><div class="page-heading"><div><h1>Works</h1><p>A place for your tools, files, and conversations.</p></div><div class="actions">${btn(`${icon("upload")} Import Work`, "import")}${btn(`${icon("plus")} New Work`, "new-work", "primary")}</div></div>${adapter.worksError ? feedback(`Works could not be refreshed. ${esc(adapter.worksError)}`, 'warning', btn('Retry loading', 'retry-works', 'small')) : ''}<div class="list-controls"><div class="search-box">${icon("search")}<input id="search" value="${esc(view.search)}" placeholder="Search your Works" aria-label="Search Works">${view.search ? btn(icon("close"), "clear-search", "icon-button quiet", 'aria-label="Clear search"') : ""}</div>${connection()}</div>${s === "core-offline" ? feedback(`Core is unreachable. Last confirmed ${esc(adapter.state.lastChecked)}. This is not a password error.`, "warning", btn("Check connection", "check-connection", "small")) : ""}${s === "env-not-ready" ? feedback("Core is reachable. The runtime is not ready; existing information is available.", "warning", btn("Check readiness", "check-connection", "small")) : ""}${(s === "loading" || adapter.worksLoading && !adapter.worksChecked) ? `<div class="loading-list">${[1, 2, 3].map(() => '<div class="skeleton"></div>').join("")}<p>Loading your Works…</p>${btn("Check connection", "check-connection")}</div>` : s === "list-error" ? empty("refresh", "Works could not be loaded", "Your account is still signed in. Check the connection and try reading the list again.", btn("Retry loading", "retry-works", "primary")) : s === "empty" ? empty("grid", "Make room for your next idea", "Create a Work, then ask the Agent to build a tool or help with your files.", btn(`${icon("plus")} New Work`, "new-work", "primary")) : all.length ? `<div class="work-table"><div class="work-table-head"><span>NAME</span><span>STATUS</span><span>QUICK ACTION</span><span></span></div>${all.map((w) => `<div class="work-row"><button class="work-name" data-action="open-work" data-id="${w.id}"><span class="work-icon ${w.color}">${icon(w.icon, 22)}</span><span><strong>${esc(w.name)}</strong><small>${esc(w.description)}</small></span></button><div class="work-status">${workStatus(w)}</div><div>${quickAction(w)}</div>${btn(icon("more"), "work-menu", "icon-button quiet", `data-id="${w.id}" aria-label="More options for ${esc(w.name)}"`)}</div>`).join("")}</div>` : empty("search", "No matching Works", "Try a different name.", btn("Clear search", "clear-search"))}<div class="works-footer"><span>${icon("lock", 14)} Only your own Works appear here</span><span>${adapter.state.works.length} Works <b>·</b> ${esc(adapter.state.core.account)}</span></div><div class="works-help"><span class="mini-symbol">${icon("spark", 19)}</span><div><strong>Start with an idea. Make something useful.</strong><p>Give your Work a goal, then build and use its tools alongside the Agent.</p></div>${btn("Create a Work", "new-work", "quiet")}</div></main>`;
}
function quickAction(w) {
    const action = adapter.project(w).action;
    const label = { start: 'Start Work', stop: 'Stop Work', retry: 'Retry Work', check: 'Check status' }[action];
    return btn(`${icon(action === 'start' ? 'play' : action === 'stop' ? 'stop' : 'refresh', 15)} ${label}`, action === 'check' ? 'check-work' : action === 'stop' ? 'stop-work' : 'start-work', 'quiet small', `data-id="${esc(w.id)}"`);
}
function workStatus(w) {
    const state = adapter.project(w);
    return `${badge(state.label)}${state.explanation ? `<small>${esc(state.explanation)}</small>` : w.status === 'Degraded' ? '<small>A capability needs attention</small>' : ''}`;
}
function workHeader(w, standalone = false) {
    return `<header class="work-header"><div class="work-header-main">${btn(icon("arrow", 19), standalone ? "back-work" : "back-works", "icon-button quiet", `aria-label="${standalone ? "Back to Work" : "Back to Works"}"`)}<span class="header-divider"></span><span class="work-icon small ${w.color}">${icon(w.icon, 19)}</span><h1 title="${esc(w.name)}">${esc(w.name)}</h1>${badge(adapter.project(w).label)}</div><div class="actions header-actions">${quickAction(w)}${btn(icon("more"), "work-menu", "icon-button quiet", `data-id="${w.id}" aria-label="Work options"`)}</div></header>`;
}
function workPage(w) {
    const settings = route()[2] === "settings";
    return `${workHeader(w)}<nav class="work-tabs" aria-label="Work areas"><div>${["Services", "Files", "Chat"].map((t) => btn(`${icon(t === "Services" ? "grid" : t === "Files" ? "folder" : "chat", 17)} ${t}`, `tab-${t}`, !settings && view.tab === t ? "tab active" : "tab")).join("")}</div>${btn(`${icon("settings", 17)} Settings`, "settings", settings ? "tab active" : "tab")}</nav>${w.status === "Degraded" ? `<div class="work-notice">${icon("info", 15)} Some capabilities need attention. Available Services remain usable. ${btn("View details", "manage-services", "text-button")}</div>` : ""}${settings ? settingsPage(w) : !adapter.project(w).usable ? `${view.layout !== "workspace" ? `<div class="focus-unavailable"><b>${esc(w.name)}</b>${focusControls(w)}</div>` : ""}${workState(w)}` : `<div class="work-layout ${view.agentOpen ? "agent-open" : ""} ${view.tab === "Chat" || view.layout === "chat-only" ? "chat-main" : ""} ${view.layout === "service-only" ? "chat-hidden" : ""}"><section class="main-panel">${view.tab === "Files" ? files(w) : view.tab === "Chat" ? "" : services(w)}</section><aside class="agent-side">${agent(w, view.tab === "Chat" || view.layout === "chat-only")}</aside>${btn(`${icon("chat")} Agent`, "toggle-agent", "floating-agent")}</div>`}`;
}
function workState(w) {
    const state = adapter.project(w);
    const stopped = state.action === 'start';
    const title = stopped ? 'This Work is stopped' : { Preparing: 'Preparing your Work', Starting: 'Starting your Work', Stopping: 'Stopping your Work', Unknown: 'Work status is unknown' }[state.label] || state.label;
    const details = state.operationIds.length ? btn('Operation details', 'work-operations', '', `data-id="${esc(w.id)}"`) : '';
    return `<main class="work-state">${empty(stopped ? 'stop' : w.status === 'Failed' ? 'info' : 'clock', title, stopped ? 'Your workspace data is preserved. Start the Work to use its Services, files, and Agent.' : esc(state.explanation || w.error || 'Waiting for the original operation to reach a confirmed result.'), `<div class="actions">${quickAction(w)}${btn('Settings', 'settings')}${details}${state.exportable ? btn(`${icon('download')} Export Work`, 'export', '', `data-id="${esc(w.id)}"`) : ''}</div>`)}
    <details class="state-footnote"><summary>State details</summary><p>Target: ${esc(w.desired)} · Last confirmed: ${esc(w.status)} · Checked ${esc(w.checkedAt || 'Not confirmed')}</p></details></main>`;
}
function services(w) {
    if (!w.resourceChecked?.services && !w.resourceErrors?.services)
        return `<div class="local-loading" role="status" aria-busy="true">Loading Services…</div>`;
    const s = activeService(w);
    if (w.resourceErrors?.services && !w.resourceChecked?.services)
        return feedback(esc(w.resourceErrors.services), "warning", btn("Check connection", "check-connection"));
    if (!s || !s.ports.length)
        return empty("grid", "No Web Service is ready", "Ask the Agent to build a tool. Service definitions are created by the Agent workflow.", btn("Focus chat", "tab-Chat", "primary") + (w.services.length ? btn("Manage services", "manage-services") : ""));
    const list = w.services.filter((x) => x.ports.length && x.observed !== "Removed");
    return `${w.resourceErrors?.services ? feedback(esc(w.resourceErrors.services), "warning", btn("Check connection", "check-connection", "small")) : ""}<div class="service-toolbar"><div class="service-selector"><span class="app-indicator">${icon("grid", 16)}</span><select id="service-select" aria-label="Service">${list.map((x) => `<option value="${x.id}" ${x.id === s.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select><select id="port-select" aria-label="Declared Web port">${s.ports.map((p) => `<option ${p === view.port ? "selected" : ""}>${p}</option>`).join("")}</select></div><div class="service-identity">${badge(s.observed)}<span class="domain" title="${esc(s.domain)}">${esc(s.domain)}</span></div><div class="actions focus-actions">${focusControls(w)}${btn(icon("external", 16), "open-app", "icon-button quiet", 'aria-label="Open application in new tab"')}${btn(icon("more"), "service-menu", "icon-button quiet", 'aria-label="Service options"')}</div></div>${view.serviceOpenError ? feedback(esc(view.serviceOpenError), "warning", btn("Copy local link", "copy-local", "small")) : ""}${adapter.serviceEmbed(w.id, s.id, view.port) === "denied" ? empty("external", "This app opens in its own tab", "The application’s security policy does not allow embedding. Its security policy remains unchanged.", btn(`${icon("external")} Open application tab`, "open-app", "primary")) : s.observed !== "Ready" ? empty("grid", `${esc(s.name)} is ${s.observed.toLowerCase()}`, esc(s.error || "This Service is disabled. Starting the Work does not re-enable it."), btn("Manage services", "manage-services", "primary")) : adapter.serviceEntryUrl(w.id, s.id, view.port) ? `<iframe data-service-key="${esc(`${w.id}:${s.id}:${view.port}`)}" class="real-service-frame" title="${esc(s.name)} application" src="${esc(adapter.serviceEntryUrl(w.id, s.id, view.port))}"></iframe>` : adapter.serviceEntryError(w.id, s.id, view.port) ? empty("grid", "Application entry unavailable", esc(adapter.serviceEntryError(w.id, s.id, view.port)), btn("Retry", "retry-service-entry", "primary")) : empty("grid", "Opening application", `Preparing ${esc(s.name)} · port ${view.port}`)}${adapter.servicePreviewUnconfirmed(w.id, s.id, view.port) ? feedback(esc(adapter.servicePreviewError(w.id, s.id, view.port) || "Preview not confirmed. Check the preview or open it independently."), "warning", btn("Check preview", "check-preview", "small") + btn("Open in new tab", "open-app", "small")) : ""}<div class="service-bottom"><span>${icon("lock", 13)} Private Service connection ${w.resourceChecked?.services ? ` · Retrieved ${esc(new Date(w.resourceChecked.services).toLocaleTimeString())}` : ""}</span><span>Shared workspace ${icon("folder", 13)}</span></div>`;
}
function agent(w, focus) {
    const readingSessions = !w.resourceChecked?.agent && !w.resourceErrors?.agent;
    const session = w.sessions.find((s) => s.id === view.session) || w.sessions[0];
    if (session) {
        if (!view.session && view.drafts[draftKey(w, "")] && !view.drafts[draftKey(w, session.id)])
            view.drafts[draftKey(w, session.id)] = view.drafts[draftKey(w, "")];
        view.session = session.id;
    }
    const run = w.run;
    const active = run && ["accepted", "running", "cancelling"].includes(run.status);
    const busy = active && run.sessionId !== session?.id;
    const draft = view.drafts[draftKey(w, session?.id || "")] || "";
    adapter.activateChat(w.id, session?.id || "");
    const modelReady = adapter.modelReady(w.id, session?.id || "");
    const webDraft = !view.literalSlash && webCommands.includes(/^\/([^\s]+)/.exec(draft.trimStart())?.[1] || "");
    return `<section class="agent-panel ${focus ? "focused" : ""}"><div class="agent-header"><span class="agent-title">${icon("spark", 17)} <b>Agent</b>${view.layout !== "workspace" ? `<small title="${esc(w.name)}">${esc(w.name)}</small>` : ""}</span><div>${btn(icon("clock", 16), "sessions", "icon-button quiet", 'aria-label="Sessions"')}${agentLayoutControls(w)}${btn(icon("more", 17), "agent-menu", "icon-button quiet", 'aria-label="Agent options"')}</div></div>${view.layout === "chat-only" && view.fullscreenError ? feedback(esc(view.fullscreenError), "warning") : ""}<div class="session-line">${session?.loading && session.checkedAt ? `<small>Saved conversation · retrieved ${esc(new Date(session.checkedAt).toLocaleTimeString())}</small>` : ""}${btn("Pi requests", "pi-requests", "text-button")}<button data-action="sessions">${esc(sessionDisplayName(w, session))}${icon("down", 12)}</button></div><div class="messages" id="messages" data-reading-key="${esc(draftKey(w, session?.id || ""))}">${session?.error ? feedback(esc(session.error), "warning") : ""}${readingSessions ? `<div class="local-loading" role="status" aria-busy="true">Loading conversation…</div>` : session?.loading && !session.checkedAt ? `<div class="local-loading" role="status" aria-busy="true">Loading conversation…</div>` : !session?.messages.length ? `<div class="chat-welcome"><span class="chat-symbol">${icon("spark", 28)}</span><h2>What would you like to make?</h2><p>Build a tool, work with your files, or explore an idea together.</p><button data-action="suggest-message">Build a notes app ${icon("chevron", 15)}</button><button data-action="suggest-files">Help me explore my files ${icon("chevron", 15)}</button></div>` : messageMarkup(w, session.id, session.messages)}${view.tab === "Chat" && view.layout === "workspace" && w.services.some(s => s.observed === "Ready" && s.ports.length) ? btn(`${icon("grid", 15)} Open service`, "tab-Services", "service-shortcut") : ""}${session?.runs?.length ? `<details class="run-history"><summary>Run history · actual models and sources</summary>${session.runs.map(r => `<p><code>${esc(r.id)}</code> · ${esc(modelDisplayName(r.actualModel))} · ${esc(r.source?.kind === "service" ? `Service: ${r.source.serviceName || "automatic"}` : "Chat")} · Thinking ${esc(r.thinkingLevel || "off")} · ${esc(r.status)}</p>`).join("")}</details>` : ""}</div>${view.scrollPinned ? "" : btn(`${icon("down", 14)} Back to latest`, "scroll-bottom", "back-latest")}<div class="composer-wrap">${submissionMarkup(w)}${w.resourceErrors?.agent ? feedback(esc(w.resourceErrors.agent), "warning", btn("Check connection", "check-connection", "small")) : ""}${session?.legacy ? feedback("This Session’s context is no longer compatible. Your draft is kept.", "warning", btn("New session", "new-session", "small")) : ""}${busy ? feedback("A Run is active in another Session. Your draft is kept.", "warning", btn("View active Run", "active-run", "small")) : ""}${run && (run.error || ["failed", "interrupted"].includes(run.status)) ? feedback(`${esc(run.error)}`, "warning", btn(["interrupted", "accepted", "running", "cancelling"].includes(run.status) ? "Resume original Run" : "Run details", ["interrupted", "accepted", "running", "cancelling"].includes(run.status) ? "resume-run" : "run-details", "small")) : ""}${run ? `<div class="run-strip"><button data-action="run-details"><i class="run-dot ${active ? "active" : ""}"></i>Run ${esc(run.status)} · ${esc(modelDisplayName(run.actualModel))} · ${esc(run.source?.kind === "service" ? `Service ${run.source.serviceName || ""}` : "Chat")} ${icon("chevron", 12)}</button>${active ? btn(run.cancellationRequested ? "Cancellation requested" : run.status === "cancelling" ? "Cancelling…" : "Cancel run", "cancel-run", "text-button", run.cancellationRequested || run.status === "cancelling" ? "disabled" : "") : ""}</div>` : ""}<div class="composer"><textarea id="composer" rows="3" placeholder="Ask anything about this Work" aria-label="Message the Agent" ${session?.legacy ? 'aria-describedby="composer-help"' : ""}>${esc(draft)}</textarea><div class="composer-bottom">${modelComposer(w, session?.id || "")}${btn(icon("settings", 16), "chat-input-options", "icon-button quiet chat-input-options", `title="Input options" aria-label="Input options" aria-pressed="${view.includeIdentity}"`)}${commandPalette(w, draft)}${btn(icon("send", 18), "send-message", "send-button", `aria-label="Send message" ${!webDraft && (active || session?.legacy || !modelReady) || webDraft && !!adapter.chatSubmissions.get(w.id) ? "disabled" : ""}`)}</div></div>${modelFeedback(w, session?.id || "")}<div class="composer-caption" id="composer-help">${draft.trimStart().startsWith("/") ? btn(view.literalSlash ? "Command mode" : "Send as text", "toggle-slash-mode", "text-button", `aria-pressed="${view.literalSlash}"`) : ""}${draft.trimStart().startsWith("/") && !view.literalSlash ? "Commands use their own arguments; Service identity is not added." : "Enter to send · Shift+Enter for a new line"}</div></div></section>`;
}
function modelComposer(w, sessionId) {
    const catalog = adapter.models.get(w.id), state = adapter.modelSelection(w.id, sessionId), session = w.sessions.find(s => s.id === sessionId);
    const model = state.ref === null ? catalog?.defaultModel : catalog?.models.find(m => m.modelRef === state.ref);
    const disabled = state.phase === 'unknown' || !catalog?.confirmed || !!catalog?.error;
    const levels = model?.thinkingLevels;
    const canThink = adapter.chatCapabilities.get(w.id) === 1 && !!levels?.length;
    const thinkingDisabled = disabled || !canThink || levels?.length === 1 && levels[0] === state.thinking;
    const name = model ? modelDisplayName(model) : state.ref === null ? 'Work default' : modelDisplayName(session?.modelPreference);
    return `<div class="chat-options">${btn(`<small>Model</small><span>${esc(name)}</span>${icon('down', 12)}`, 'open-chat-models', 'quiet chat-picker', `id="model-select" value="${esc(state.ref || '')}" title="${esc(name)}${state.ref === null ? ' · Work default' : ''}" aria-label="Model for next message" aria-haspopup="dialog" ${disabled ? 'disabled' : ''}`)}${btn(`<small>Thinking</small><span>${esc(canThink ? thinkingName(state.thinking) : 'Unavailable')}</span>${icon('down', 12)}`, 'open-chat-thinking', 'quiet chat-picker', `id="thinking-select" value="${esc(state.thinking)}" aria-label="Thinking for next message" aria-haspopup="dialog" ${thinkingDisabled ? 'disabled' : ''}`)}</div>`;
}
function sessionDisplayName(w, session) {
    if (!session)
        return 'No Session yet';
    return session.title === `Session ${session.id}` ? `Session ${w.sessions.indexOf(session) + 1}` : session.title;
}
function modelDisplayName(model) {
    if (!model)
        return 'Unavailable model';
    return /^Runtime(?: model)? revision\b/i.test(model.label || '') ? model.model || 'Work model' : model.label || model.model || 'Work model';
}
function thinkingName(level) { return level ? level[0].toUpperCase() + level.slice(1) : 'Unavailable'; }
function modelFeedback(w, sessionId) {
    const catalog = adapter.models.get(w.id), state = adapter.modelSelection(w.id, sessionId), session = w.sessions.find(s => s.id === sessionId);
    const model = state.ref === null ? catalog?.defaultModel : catalog?.models.find(m => m.modelRef === state.ref);
    const status = state.phase === 'saving' ? 'Saving…' : state.error || (session?.modelPreference?.availability === 'unavailable' ? 'Saved settings unavailable' : catalog?.loading ? 'Loading models…' : catalog?.error || (adapter.chatCapabilities.get(w.id) === 0 ? 'Thinking unavailable in this Work' : catalog?.confirmed && !model?.thinkingLevels?.length ? 'Thinking capabilities are unconfirmed' : model?.thinkingLevels?.length === 1 && model.thinkingLevels[0] === 'off' ? 'Thinking is not supported by this model' : !sessionId ? 'For new session' : ''));
    return `<div class="options-status" role="status">${esc(status)}${state.phase === 'unknown' ? btn('Check chat settings', 'check-session-model', 'text-button') : catalog?.error || !catalog?.confirmed ? btn('Retry models', 'load-models', 'text-button') : state.phase === 'dirty' && sessionId ? btn('Retry settings', 'save-model', 'text-button') : ''}</div>`;
}
function openChatPicker(kind) {
    const work = current();
    if (!work)
        return;
    const trigger = root.querySelector(kind === 'model' ? '#model-select' : '#thinking-select');
    if (!trigger || trigger.disabled)
        throw new Error('Chat settings are unavailable. Check their status before choosing.');
    view.commandDismissed = view.drafts[draftKey(work)] || '';
    trigger.focus({ preventScroll: true });
    focusReturn = focusKey(trigger);
    openModal(kind === 'model' ? 'chat-models' : 'chat-thinking', { workId: work.id, sessionId: view.session });
    root.querySelector('#modal [aria-checked=true],#modal [role=menuitemradio]')?.focus();
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
    return intent ? feedback(`${esc(intent.error || 'Waiting for acceptance…')}<details class="chat-submission-details"><summary>Submission details</summary><p>Original ${esc(intent.kind)} key <code>${esc(intent.key)}</code></p></details>`, 'warning', btn('Check original submission', 'check-chat-submission', 'small')) : '';
}
function layoutButton(symbol, label, action, extra = '') {
    return btn(icon(symbol, 16), action, 'icon-button quiet', `title="${esc(label)}" aria-label="${esc(label)}" ${extra}`);
}
function focusControls(w, showError = true) {
    const standalone = route()[0] === 'app', focused = view.layout !== 'workspace', chat = view.layout === 'chat-only';
    const service = activeService(w);
    const available = !!service && service.observed === 'Ready' && !!adapter.serviceEntryUrl(w.id, service.id, view.port) && adapter.serviceEmbed(w.id, service.id, view.port) !== 'denied';
    return focused ? `${chat ? layoutButton('arrow', 'Restore layout', 'restore-layout') : !standalone ? layoutButton('chat', view.layout === 'service-chat' ? 'Hide chat' : 'Show chat', 'focus-toggle-chat', `aria-pressed="${view.layout === 'service-chat'}"`) : ''}${layoutButton('close', 'Exit focus', 'exit-service-focus')}${layoutButton('focus', document.fullscreenElement === root ? 'Exit full screen' : 'Full screen', 'service-fullscreen', `aria-pressed="${document.fullscreenElement === root}"`)}${view.layout === 'service-only' && w.run ? `<small class="focus-run-status">Run ${esc(w.run.status)}${w.run.error ? ' · needs attention' : ''}</small>` : ''}${showError && view.fullscreenError ? `<small class="fullscreen-error" role="status">${esc(view.fullscreenError)}</small>` : ''}` : layoutButton('focus', 'Focus', 'service-focus', `aria-pressed="false" ${available ? '' : 'disabled'}`);
}
function agentLayoutControls(w) {
    if (view.layout === 'chat-only')
        return focusControls(w, false);
    return `${view.layout === 'service-chat' && innerWidth < 900 ? layoutButton('chat', 'Hide chat', 'focus-toggle-chat', 'aria-pressed="true"') : ''}${layoutButton('focus', 'Focus chat', 'focus-chat', 'aria-pressed="false"')}`;
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
    if (document.fullscreenElement === root) {
        try {
            await document.exitFullscreen();
            if (document.fullscreenElement === root)
                throw new Error();
        }
        catch {
            view.fullscreenError = 'Full screen could not be closed. Exit full screen and try again.';
            render();
            return false;
        }
    }
    const target = workspaceReturn;
    if (target)
        view.tab = target.tab;
    resetWorkspaceFocus();
    render();
    restoreLayoutFocus(target);
    return true;
}
function messageMarkup(w, sessionId, messages) {
    return activityGroups(messages).map(group => {
        const key = `${adapter.identityEpoch}:${w.id}:${sessionId}:${group.key}`;
        if (group.activity) {
            const running = group.messages.some(m => m.tool?.status === 'Running'), failures = group.messages.filter(m => m.tool?.status === 'Failed'), unknown = group.messages.some(m => m.tool?.status?.includes('confirmed'));
            return `<details class="activity" data-message-key="${esc(key)}" data-activity-key="${esc(key)}" ${expandedActivity.get(key) ? 'open' : ''}><summary>${icon('terminal', 14)} Activity · ${group.messages.length} ${group.messages.length === 1 ? 'tool' : 'tools'} · ${failures.length ? 'Needs attention' : running ? 'Running' : unknown ? 'Result not confirmed' : 'Completed'}${failures.length ? ` · ${failures.length} failed<small class="activity-error">${esc(failures[0]?.tool?.content?.slice(0, 160) || 'A tool failed. Open Activity to review the result.')}</small>` : ''}</summary>${group.messages.map(m => `<details class="tool-event" data-message-key="${esc(`${key}:${m.tool?.id || m.id}`)}" data-activity-key="${esc(`${key}:${m.tool?.id || m.id}`)}" ${expandedActivity.get(`${key}:${m.tool?.id || m.id}`) ? "open" : ""}><summary>${esc(m.tool?.name)} · ${esc(m.tool?.status)}</summary><pre>${esc(m.tool?.content)}</pre></details>`).join('')}</details>`;
        }
        return group.messages.map(m => `<div class="message ${m.role}" data-message-key="${esc(key)}">${m.role === 'assistant' ? `<div class="message-author">${icon('spark', 14)} piwork</div>` : ''}<div class="message-text">${esc(m.text)}</div>${m.source ? `<button class="source-chip" data-action="open-source" data-path="${esc(m.source)}">${icon('file', 13)} ${esc(m.source)}</button>` : ''}</div>`).join('');
    }).join('');
}
const webCommands = ['new', 'resume', 'model', 'thinking', 'settings'];
function paletteToken(draft) { const match = /^(\s*)\/([^\s]*)/.exec(draft); return match && view.commandCaret >= match[1].length + 1 && view.commandCaret <= match[0].length ? match[2] : undefined; }
function commandChoices(w, draft) {
    if (view.literalSlash || view.commandDismissed === draft || paletteToken(draft) === undefined)
        return [];
    const query = paletteToken(draft).toLowerCase();
    const directory = adapter.commands.get(w.id);
    return [...webCommands.map(name => ({ command: `/${name}`, kind: 'web', description: { new: 'Start a new Session', resume: 'Choose a saved Session', model: 'Choose a model', thinking: 'Choose a Thinking level', settings: 'Open Work settings' }[name] || '', sourceName: 'Desktop' })), ...(directory?.confirmed && !directory.error ? directory.items : [])].filter(command => command.command.slice(1).toLowerCase().includes(query)).slice(0, 30);
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
    return `<div class="command-palette menu-list" role="listbox" aria-label="Slash commands">${items.map((command, index) => `${index === 0 || items[index - 1]?.kind !== command.kind ? `<small>${esc(command.kind === 'web' ? 'Workspace' : command.kind === 'skill' ? 'Skills' : 'Prompt templates')}</small>` : ''}<button class="button" data-action="choose-command" data-command="${esc(command.command)}" role="option" aria-selected="${index === view.commandIndex}"><strong>${esc(command.command)}</strong><span>${esc(command.description)}</span><small>${esc(command.sourceName)}</small></button>`).join('')}${directory?.loading ? '<p>Loading resource commands…</p>' : directory?.error ? `<p role="status">${esc(directory.error)} ${btn('Retry', 'load-commands', 'text-button')}</p>` : directory?.confirmed && !directory.items.length ? '<p>No resource commands in this Work.</p>' : ''}${!items.length ? '<p>No matching commands. Choose another command or send as text.</p>' : ''}</div>`;
}
function fillCommand(command) {
    const work = current();
    if (!work)
        return;
    const key = draftKey(work), draft = view.drafts[key] || '';
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
function files(w) {
    const directory = adapter.directories.get(`${w.id}:${view.path}`);
    if (directory?.loading && !directory.checkedAt)
        return `<div class="local-loading" role="status" aria-busy="true">Loading workspace ${esc(view.path)}…</div>`;
    if (w.resourceErrors?.files)
        return feedback(esc(w.resourceErrors.files), "warning", btn("Refresh files", "refresh-files"));
    if (adapter.state.scenario === "files-failed")
        return empty("folder", "Workspace files are unavailable", "The file capability could not be reached. Available Services can still be used.", btn("Refresh files", "refresh-files", "primary"));
    const f = w.files.find((x) => x.path === view.file);
    const list = w.files.filter((x) => {
        const parent = x.path.slice(0, x.path.lastIndexOf("/")) || "/";
        return parent === view.path;
    });
    return `${uploadProgressMarkup()}<div class="files-toolbar"><div class="breadcrumbs"><button data-action="file-path" data-path="/">${icon("folder", 16)} Workspace</button>${view.path
        .split("/")
        .filter(Boolean)
        .map((p, i, a) => `${icon("chevron", 12)}<button data-action="file-path" data-path="/${esc(a.slice(0, i + 1).join("/"))}">${esc(p)}</button>`)
        .join("")}</div><div class="actions">${btn(icon("refresh", 16), "refresh-files", "icon-button quiet", 'aria-label="Refresh files"')}${btn(`${icon("upload", 16)} Upload`, "upload", "quiet small")}${btn(`${icon("plus", 16)} New folder`, "new-folder", "quiet small")}${btn(icon("more"), "file-options", "icon-button quiet", 'aria-label="Workspace options"')}</div></div>${f ? textEditor(f) : `${view.selected.length ? `<div class="selection-bar"><span>${view.selected.length} selected</span>${btn("Copy", "file-copy", "small")}${btn("Move", "file-move", "small")}${btn("Delete", "file-delete", "small danger")}${btn("Clear", "clear-selection", "text-button")}</div>` : ""}${list.length ? `<div class="file-table"><div class="file-head"><span></span><span>NAME</span><span>SIZE</span><span>MODIFIED</span><span></span></div>${list.map((f) => `<div class="file-row"><input type="checkbox" aria-label="Select ${esc(f.name)}" data-file-select="${esc(f.path)}" ${view.selected.includes(f.path) ? "checked" : ""}><button class="file-name" data-action="open-file" data-path="${esc(f.path)}">${icon(f.kind === "directory" ? "folder" : f.kind === "special" ? "terminal" : "file", 19)}<span>${esc(f.name)}<small>${f.kind === "special" ? "Special item" : f.kind === "directory" ? "Folder" : f.kind === "binary" ? "Binary file" : f.kind === "text" ? "UTF-8 text" : "File"}</small></span></button><span>${f.kind === "directory" || f.kind === "special" ? "—" : size(f.size)}</span><span>${esc(f.modified)}</span>${btn(icon("more"), "file-menu", "icon-button quiet", `data-path="${esc(f.path)}" aria-label="Actions for ${esc(f.name)}"`)}</div>`).join("")}</div>` : empty("folder", "This folder is empty", "Upload files or create a folder to get started.", btn("Upload files", "upload", "primary"))}`}<div class="file-scope"><span>Shared workspace · <code>/var/data/workspace</code></span><button data-action="webdav">Connect with WebDAV ${icon("external", 12)}</button></div>${transferResults()}`;
}
const decodePaths = (value) => value ? JSON.parse(value) : [];
const size = (n) => n >= 1048576
    ? `${(n / 1048576).toFixed(1)} MiB`
    : n >= 1024
        ? `${(n / 1024).toFixed(1)} KB`
        : `${n} B`;
function transferResults() {
    const results = current() ? adapter.transfersByWork.get(current().id) || [] : [];
    return results.length
        ? `<section class="transfer-results"><h3>Transfer results <span>${results.some((r) => r.status !== "succeeded") ? "Some paths need attention" : ""}</span></h3>${results.map((r) => `<div class="transfer-row">${icon(r.status === "succeeded" ? "check" : "info", 14)}<code>${esc(r.path)}</code><span>${esc(r.message)}</span></div>`).join("")}${results.some((r) => r.status === "unknown") ? btn("Refresh to verify target", "refresh-files", "small") : ""}</section>`
        : "";
}
function textEditor(f) {
    const editable = view.fileEditable;
    return `<div class="editor-toolbar">${btn(`${icon("arrow", 16)} Back to files`, "close-file", "quiet small")}<strong>${esc(f.name)}</strong>${badge(dirty() ? "Unsaved" : "Saved")}</div>${editable ? `${!view.fileBaseline ? feedback("No modification time is available. Concurrent changes cannot be protected.", "warning", btn("Allow unprotected overwrite", "allow-unprotected-file", "small")) : ""}${view.fileWriteUncertain ? feedback("The previous write needs review. Reread the target before saving again.", "warning", btn("Reread saved version", "refresh-files", "small")) : ""}${view.fileReread ? `<section class="file-reread"><h3>Current saved version · read only</h3><pre>${esc(view.fileReread.content ?? "This target is no longer editable text.")}</pre>${btn("Overwrite this reread version", "use-reread-version", "small", view.fileReread.kind === "text" ? "" : "disabled")}</section>` : ""}<textarea id="file-editor" class="file-editor" spellcheck="false" aria-label="Edit ${esc(f.name)}">${esc(view.fileDraft)}</textarea><div class="editor-footer"><span>UTF-8 · ${size(new TextEncoder().encode(view.fileDraft).length)} / 1 MiB limit · Version checks have second precision</span><div class="actions">${btn("Discard", "discard-file", "quiet", dirty() ? "" : "disabled")}${btn("Save file", "save-file", "primary", dirty() ? "" : "disabled")}</div></div>` : empty(f.kind === "special" ? "terminal" : "file", f.kind === "special" ? "This is a special filesystem item" : f.kind === "binary" ? "Download to open this binary file" : f.kind === "file" ? "Open this file to inspect its contents" : "This file exceeds the editing limit", f.kind === "special" ? "Special items cannot be treated as ordinary editable files." : "The in-browser editor supports UTF-8 text up to 1 MiB.", f.kind === "special" ? "" : btn(`${icon("download")} Download file`, "download-file", "primary", `data-path="${esc(f.path)}"`))}`;
}
function settingsPage(w) {
    const configurationError = w.resourceErrors?.configuration;
    if (configurationError && !view.config && !w.resourceChecked?.configuration)
        return feedback(esc(configurationError), "warning", btn("Refresh configuration", "refresh-config", "primary"));
    if (!view.config)
        view.config = structuredClone(w.config);
    const c = view.config, pending = w.config.pendingApply === true;
    return `<main class="settings-page">${configurationError ? feedback(`${esc(configurationError)} Last confirmed configuration and your draft are preserved.`, "warning") : ""}<div class="settings-heading"><div><h1>Work settings</h1><p>Shape what this Work can do.</p></div>${btn(`${icon("arrow", 16)} Back to Work`, "back-work", "quiet")}</div><div class="configuration-state"><div><strong>${view.configDirty ? "Unsaved changes" : pending ? "Saved changes" : "Configuration in use"}</strong><span>${view.configDirty ? "Save your draft before applying it." : pending ? "Not applied · Your running configuration is unchanged." : "Saved and active configuration are aligned"}</span></div><div class="actions">${btn(`${icon("refresh", 15)} Refresh status`, "refresh-config", "quiet small")}${view.configDirty ? btn("Save changes", "save-config", "") : btn("Apply changes", "apply-config", pending ? "primary" : "", pending && adapter.project(w).usable ? "" : 'disabled title="Start or check this Work before applying saved settings"')}</div></div><nav class="settings-tabs">${["Skills", "Pi Packages", "AGENTS.md", "Advanced"].map((t) => btn(t, "settings-section", view.settingsTab === t ? "tab active" : "tab", `data-tab="${t}"`)).join("")}</nav><div class="settings-content">${view.settingsTab === "Skills" ? skillsSettings(w, c) : view.settingsTab === "Pi Packages" ? packagesSettings(w, c) : view.settingsTab === "AGENTS.md" ? `<div class="section-heading"><div><h2>Instructions for your Agent</h2><p>AGENTS.md is included with this Work’s capability configuration.</p></div>${btn(`${icon("upload", 15)} Import file`, "import-agents", "small")}</div><div class="config-labels"><span>${w.config.pendingApply ? "Previous active configuration" : "Configuration in use"}</span><span>Saved configuration</span></div><label class="field">Desired AGENTS.md<textarea id="agents-editor" class="code-editor" rows="13">${esc(c.agents)}</textarea></label><details class="details-box"><summary>Current active content</summary><pre>${esc(w.config.active?.agentsMd ?? "No active configuration is reported")}</pre></details>` : `<div class="section-heading"><div><h2>Advanced configuration</h2><p>Public runtime configuration. Platform secrets are never displayed.</p></div>${btn(`${icon("upload", 15)} Import JSON`, "import-json", "small")}</div><label class="field">Configuration JSON<textarea id="advanced-editor" aria-label="Configuration JSON" class="code-editor" rows="17" spellcheck="false">${esc(c.advanced)}</textarea></label>${c.validationError ? feedback(esc(c.validationError), "warning") : ""}<p class="muted">Includes the image, model reference, MCP, resources, and tool policy. Validate against the current Core contract before production use.</p>`}</div>${view.configDirty ? `<div class="settings-savebar"><span>You have unsaved changes</span><div class="actions">${btn("Discard changes", "discard-config")}${btn("Save changes", "save-config", "primary")}</div></div>` : ""}</main>`;
}
function catalogFeedback(name) {
    const status = adapter.catalog[name];
    return (status.loading ? feedback(`Checking ${name} catalog. Saved copies and selections are preserved.`) : '') + (status.error ? feedback(`${esc(status.error)} Saved Work copies and selections are preserved.`, 'warning') : '');
}
function skillsSettings(w, c) {
    return `<div class="section-heading"><div><h2>Skills</h2><p>Choose the capabilities available to this Work.</p></div>${btn("Check catalog", "check-catalog", "quiet small")}${btn("Clear selection", "clear-skills", "quiet small")}</div>${catalogFeedback("skills")}<div class="selection-note">${icon("info", 15)} Checked Skills keep this Work’s saved copy. Select “Use current Core copy” to replace it.</div><div class="capability-list">${adapter
        .getSkills()
        .map((s) => `<article class="capability"><label class="capability-check"><input type="checkbox" data-skill="${esc(s.id)}" ${c.skills.includes(s.id) ? "checked" : ""}><span class="capability-icon">${icon(s.id === "data-analysis" ? "counter" : s.id === "web-tools" ? "grid" : "note", 20)}</span><span><strong>${esc(s.name)}</strong><small>${esc(s.description || "Description not provided")}</small></span></label><div class="capability-meta"><span>${s.version ? `v${s.version}` : "Version not provided"}</span>${btn("Details", "skill-detail", "text-button", `data-id="${s.id}"`)}</div><div class="capability-status"><span>${c.skills.includes(s.id) ? "Selected Work copy" : "Not selected"}</span>${w.config.skills.includes(s.id) ? `<span>${skillState(w, s.id, "loaded")}</span><span>${skillState(w, s.id, "modelVisible")}</span>` : ""}${btn("Use current Core copy", "core-skill-copy", "text-button", `data-id="${s.id}" ${adapter.catalog.skills.error || !adapter.catalog.skills.confirmed || !adapter.getSkills().some(entry => entry.id === s.id && entry.description !== "Saved Work copy; unavailable in current Core catalog") ? "disabled" : ""}`)}</div></article>`)
        .join("")}</div>`;
}
function packagesSettings(w, c) {
    return `<div class="section-heading"><div><h2>Pi Packages</h2><p>Agent capabilities installed for this Work.</p></div>${btn(`${icon("plus", 15)} Install package`, "install-package", "primary small")}</div><div class="capability-list">${c.packages.length ? c.packages.map((p) => `<article class="capability"><div class="capability-check"><span class="capability-icon">${icon("grid", 20)}</span><span><strong>${esc(p.name)}</strong><small>${esc(p.source)}</small></span>${btn("Details", "package-detail", "text-button", `data-id="${esc(p.name)}"`)}</div><div class="capability-status">${badge(p.enabled ? "Enabled" : "Disabled")}<span>${packageStatus(w, p.name)}</span>${btn(p.enabled ? "Disable" : "Enable", "toggle-package", "text-button", `data-id="${esc(p.name)}"`)}${btn("Update source", "update-package", "text-button", `data-id="${esc(p.name)}"`)}${btn("Remove", "remove-package", "text-button danger", `data-id="${esc(p.name)}"`)}</div></article>`).join("") : empty("grid", "No packages selected", "Install a Pi Package or leave this Work without additional packages.")}${catalogFeedback("packages")}<div class="catalog-heading"><h3>Available from Core</h3>${btn("Check catalog", "check-catalog", "quiet small")}${btn("Clear Work selection", "clear-packages", "text-button")}</div>${adapter
        .getPackages()
        .map((p) => `<div class="catalog-row"><div><strong>${esc(p.name)}</strong><p>${esc(p.description || "Description not provided")} · ${p.version || "Version not provided"}</p></div>${btn("Select", "select-package", "small", `data-id="${esc(p.name)}" ${adapter.catalog.packages.error || !adapter.catalog.packages.confirmed ? "disabled" : ""}`)}</div>`)
        .join("")}</div>`;
}
function modalMarkup() {
    const w = adapter.getWork(view.data.workId || view.data.id || route()[1] || "");
    const target = w || current();
    let title = "", body = "", footer = "";
    const cancel = () => btn("Cancel", "close-modal");
    const close = () => btn("Close", "close-modal");
    switch (view.modal) {
        case 'chat-models':
        case 'chat-thinking': {
            if (!target)
                break;
            const catalog = adapter.models.get(target.id), state = adapter.modelSelection(target.id, view.data.sessionId || '');
            const thinking = view.modal === 'chat-thinking', model = state.ref === null ? catalog?.defaultModel : catalog?.models.find(m => m.modelRef === state.ref);
            title = thinking ? 'Thinking' : 'Model';
            const options = thinking ? (model?.thinkingLevels || []).map(level => ({ value: level, name: thinkingName(level), note: '', selected: level === state.thinking })) :
                [...(catalog?.defaultModel ? [catalog.defaultModel] : []), ...(catalog?.models || []).filter(m => m.modelRef !== null)].map(m => ({ value: m.modelRef || '', name: modelDisplayName(m), note: m.modelRef === null ? 'Work default' : '', selected: m.modelRef === state.ref }));
            body = `<p class="muted">For your next message${view.data.sessionId ? '' : ' in a new Session'}.</p><div class="menu-list chat-picker-menu" role="menu" aria-label="${thinking ? 'Thinking levels' : 'Models'}">${options.map(option => btn(`<span>${esc(option.name)}</span>${option.note ? `<small>${esc(option.note)}</small>` : ''}${option.selected ? icon('check', 16) : ''}`, 'choose-chat-setting', '', `role="menuitemradio" aria-checked="${option.selected}" data-option-value="${esc(option.value)}" data-kind="${thinking ? 'thinking' : 'model'}"`)).join('')}</div>${state.error ? feedback(esc(state.error), 'warning') : ''}`;
            footer = cancel();
            break;
        }
        case 'chat-input-options':
            title = 'Input options';
            body = `<label class="check-row"><input id="include-identity" type="checkbox" ${view.includeIdentity ? 'checked' : ''}> Include Service identity</label>${current() && (view.drafts[draftKey(current())] || '').trimStart().startsWith('/') && !view.literalSlash ? '<p class="muted">Service identity is not added to commands. Only command arguments are sent.</p>' : ''}<p class="muted">Adds the selected Service name and port to ordinary messages.</p><details><summary>What is included?</summary><p>Identity only. No page content, cookies, or unsaved application inputs.</p></details>`;
            footer = close();
            break;
        case "account":
            title = "Your account";
            body = `<div class="identity-block"><span class="avatar large">${esc(adapter.state.core.account.slice(0, 1).toUpperCase())}</span><div><strong>${esc(adapter.state.core.account)}</strong><p>${esc(adapter.state.core.account)}</p></div></div><dl><dt>Role</dt><dd>${esc(adapter.state.core.role)}</dd><dt>Core</dt><dd>${esc(adapter.state.core.address)}</dd></dl><p class="muted">Desktop only shows the Works owned by this account.</p>`;
            footer = `${btn("Reset browser access", "reset-browser-access")}${btn("Switch Core", "switch-core")}${btn("Sign out", "sign-out", "danger")}`;
            break;
        case "reset-browser-access":
            title = "Reset browser access?";
            body = `<p>This ends browser access in <strong>all windows of this Desktop</strong>, including Service previews, file transfers and live observation.</p><p>The saved Core login is retained. Works, Services and already accepted Runs or Operations continue. File changes already sent may have been committed.</p><p class="muted">Use <code>${esc(adapter.reopenCommand())}</code> to authorize a browser again.</p>`;
            footer = `${cancel()}${btn('Reset browser access', 'confirm-reset-browser-access', 'danger')}`;
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
            body = `<div class="menu-list">${btn(`${icon("info")} Work information`, "work-info", "", `data-id="${target?.id}"`)}${btn(`${icon("settings")} Settings`, "settings", "", `data-id="${target?.id}"`)}${btn(`${icon("download")} Export Work`, "export", "", `data-id="${target?.id}"`)}${btn(`${icon("clock")} Known operations`, "operations", "")}${btn(`${icon("trash")} Delete Work`, "delete-work", "danger", `data-id="${target?.id}"`)}</div>`;
            break;
        case "work-info":
            if (!target)
                break;
            title = "Work information";
            body = `<dl><dt>Name</dt><dd>${esc(target.name)}</dd><dt>Status</dt><dd>${badge(target.status)}</dd><dt>Desired state</dt><dd>${target.desired}</dd><dt>Work ID</dt><dd><code>${target.id}</code>${btn(icon("copy", 15), "copy", "icon-button quiet", `data-copy="${target.id}" aria-label="Copy full Work ID"`)}</dd><dt>Network identity</dt><dd><code>${esc(target.network || "Not provided")}</code>${btn(icon("copy", 15), "copy", "icon-button quiet", `data-copy="${target.network}" aria-label="Copy network identity"`)}</dd><dt>Owner</dt><dd>${esc(adapter.state.core.account)}</dd></dl>`;
            footer = `${close()}${[...actions.records.values()].some(record => record.blocked && record.kind === 'lifecycle' && record.work === target.id) ? btn('Check original Work', 'check-work', '', `data-id="${esc(target.id)}"`) : ''}`;
            break;
        case "new-work":
            title = "New Work";
            body = `<p>Give your Work a name. It will inherit your Core’s defaults.</p><label class="field">Name<input id="create-name" placeholder="e.g. Reading notes" value="${esc(view.createName)}" autofocus required maxlength="120"></label><button class="advanced-toggle" data-action="toggle-create-advanced">${icon(view.createAdvanced ? "down" : "chevron", 14)} Advanced configuration <span>Optional</span></button>${view.createAdvanced
                ? `<div class="advanced-form"><label class="field">Base image<input id="create-image" placeholder="Use Core default" value="${esc(view.createImage)}"></label><label class="field">Skills<select id="create-skill-mode">${[
                    ["defaults", "Use defaults"],
                    ["choose", "Choose"],
                    ["none", "None"],
                ]
                    .map(([v, l]) => `<option value="${v}" ${view.createSkillMode === v ? "selected" : ""}>${l}</option>`)
                    .join("")}</select></label>${view.createSkillMode === "choose"
                    ? adapter
                        .getSkills()
                        .map((s) => `<label class="check-row"><input type="checkbox" data-create-skill="${esc(s.id)}" ${view.createSkills.includes(s.id) ? "checked" : ""}>${esc(s.name)}</label>`)
                        .join("")
                    : ""}<label class="field">Pi Packages<select id="create-package-mode">${[
                    ["defaults", "Use defaults"],
                    ["choose", "Choose"],
                    ["none", "None"],
                ]
                    .map(([v, l]) => `<option value="${v}" ${view.createPackageMode === v ? "selected" : ""}>${l}</option>`)
                    .join("")}</select></label>${view.createPackageMode === "choose"
                    ? adapter
                        .getPackages()
                        .map((p) => `<label class="check-row"><input type="checkbox" data-create-package="${esc(p.name)}" ${view.createPackages.includes(p.name) ? "checked" : ""}>${esc(p.name)}</label>`)
                        .join("")
                    : ""}<label class="field">AGENTS.md<textarea id="create-agents" rows="4" placeholder="Use Core default instructions">${esc(view.createAgents)}</textarea></label>${btn("Import AGENTS.md file", "create-import-agents", "small")}<label class="field">Full configuration JSON<textarea id="create-json" rows="4" class="mono" placeholder="Optional public configuration overrides">${esc(view.createJson)}</textarea></label></div>`
                : ""}<div class="merge-summary"><strong>Configuration to create</strong><span>Image: ${esc(view.createImage || "Core default")}</span><span>Skills: ${view.createSkillMode === "defaults" ? "Core defaults" : view.createSkillMode === "none" ? "None" : esc(view.createSkills.join(", ") || "None chosen")}</span><span>Pi Packages: ${view.createPackageMode === "defaults" ? "Core defaults" : view.createPackageMode === "none" ? "None" : esc(view.createPackages.join(", ") || "None chosen")}</span><span>Advanced fields override Core defaults; explicit selections override those fields.</span></div>`;
            footer = `${cancel()}${btn("Create Work", "create-work", "primary")}`;
            break;
        case "stop-work":
            title = `Stop ${esc(target?.name)}?`;
            body = `<p>This stops the current Run, all running Services, and workspace file connections for this Work.</p><p>Your persistent workspace data is preserved. Enabled Services can resume the next time you start the Work.</p><div class="impact-box">${icon("stop")} Entire Work · Services · Agent · Files</div>`;
            footer = `${cancel()}${btn("Stop Work", "confirm-stop", "danger-solid", `data-id="${target?.id}"`)}`;
            break;
        case "delete-work":
            title = `Delete ${esc(target?.name)}?`;
            body = `<p>The Work entry will be removed. Persistent data is retained by default, but there is no undo in this UI.</p><p>This is different from stopping a Work. Export a package first if you need a portable copy.</p><label class="check-row"><input id="delete-confirm" type="checkbox" ${view.deleteConfirmed ? "checked" : ""}>I understand there is no UI undo</label>`;
            footer = `${cancel()}${btn("Delete Work", "confirm-delete", "danger-solid", `data-id="${target?.id}" ${view.deleteConfirmed ? "" : "disabled"}`)}`;
            break;
        case "sessions":
            title = "Sessions";
            body = `<p>Conversations within ${esc(target?.name)}. Switching Sessions does not stop an active Run.</p><div class="session-list">${target?.sessions.map((s) => `<button data-action="select-session" data-id="${s.id}" class="${s.id === view.session ? "selected" : ""}"><span>${icon("chat", 17)}${esc(sessionDisplayName(target, s))}</span>${target.run?.sessionId === s.id ? badge(target.run.status) : s.id === view.session ? icon("check", 16) : ""}</button>`).join("") || "<p>No Sessions yet.</p>"}</div>`;
            footer = `${close()}${btn(`${icon("plus")} New session`, "new-session", "primary")}`;
            break;
        case "agent-menu":
            title = "Agent options";
            body = `<div class="menu-list">${btn("Sessions", "sessions")}${btn("New session", "new-session")}${btn("Run details", "run-details", "", target?.run ? "" : "disabled")}${btn("Focus chat", "focus-chat")}</div>`;
            break;
        case "run-details":
            title = "Run details";
            body = target?.run
                ? `<dl><dt>Run ID</dt><dd><code>${esc(target.run.id)}</code></dd><dt>Status</dt><dd>${badge(target.run.status)}</dd><dt>Session</dt><dd>${esc(target.sessions.find((s) => s.id === target.run?.sessionId)?.title || target.run.sessionId)}</dd><dt>Event cursor</dt><dd>${target.run.cursor}</dd><dt>Submitted</dt><dd>${target.run.created}</dd></dl>${target.run.error ? feedback(esc(target.run.error), "warning") : ""}<p class="muted">One active Run per Work. Closing details or switching Sessions does not cancel execution.</p>`
                : "<p>No Run has been submitted in this Work.</p>";
            footer = `${close()}${target?.run?.status === "interrupted" ? btn("Resume original Run", "resume-run", "primary") : target?.run && ["accepted", "running", "cancelling"].includes(target.run.status) ? btn(target.run.cancellationRequested ? "Cancellation requested" : target.run.status === "cancelling" ? "Cancelling…" : "Cancel run", "cancel-run", "danger", target.run.cancellationRequested || target.run.status === "cancelling" ? "disabled" : "") : ""}`;
            break;
        case "service-menu":
            title = "Service options";
            body = `<div class="menu-list">${btn(`${icon("external")} Open in new tab`, "open-app")}${btn(`${icon("focus")} Open independent window`, "open-window")}${btn(`${icon("copy")} Copy domain`, "copy-domain")}${btn(`${icon("copy")} Copy local link`, "copy-local")}${btn(`${icon("settings")} Manage services`, "manage-services")}${btn(`${icon("focus")} Focus chat`, "focus-chat")}</div><p class="muted">A local link works on this computer while Desktop CLI is running and signed in. It is not a public share link.</p>`;
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
                ? serviceDetails(s, target)
                : "<p>The Service definition was removed. Workspace files were not deleted.</p>";
            footer = `${btn("Back to services", "manage-services")}${close()}`;
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
            title = 'Pi requests';
            const page = target ? adapter.requestPage(target.id, view.data.serviceName || '') : undefined;
            body = `<label class="field">Service<select id="pi-service-filter"><option value="">All Services and Chat</option>${target?.services.map(s => `<option value="${esc(s.name)}" ${s.name === view.data.serviceName ? 'selected' : ''}>${esc(s.name)}</option>`).join('') || ''}</select></label><p class="muted">Instrumented Services report business events. External Services provide runtime observations. Ordinary facts do not start a Pi Run.</p>${page?.error ? feedback(esc(page.error), 'warning') : ''}${page?.items.map(r => `<article class="capability"><strong>${esc(r.goal)}</strong><p>${esc(r.source.kind === 'service' ? r.source.serviceName : 'Chat')} · ${esc(r.state)} · ${esc(r.disposition)}</p>${btn('Details', 'pi-request-detail', 'small', `data-id="${esc(r.requestId)}"`)}</article>`).join('') || (page?.loading ? 'Reading Pi requests…' : 'No requests in this view.')}`;
            footer = `${btn('Refresh', 'pi-requests', 'small')}${page?.nextCursor ? btn('More requests', 'next-pi-requests', 'small') : ''}${cancel()}`;
            break;
        }
        case "pi-request-detail": {
            title = 'Pi request';
            const detail = target ? adapter.requestDetails.get(`${target.id}:${view.data.requestId}`) : undefined, r = detail?.request;
            if (!r) {
                body = 'Reading the original request…';
                break;
            }
            const live = r.disposition === 'live', terminal = ['completed', 'failed', 'cancelled', 'needs_attention'].includes(r.state);
            body = `<p><code>${esc(r.requestId)}</code></p><h3>${esc(r.goal)}</h3><p>${esc(r.source.kind === 'service' ? `Service: ${r.source.serviceName}` : 'Chat')} · ${esc(r.state)} · ${esc(r.disposition)}</p>${r.waitRef ? `<p>Waiting for ${esc(r.waitRef.kind)} · <code>${esc(r.waitRef.id)}</code> · Deadline ${esc(r.waitRef.deadlineAt)}</p><p class="muted">The waiting goal releases its Run. Chat remains available.</p>` : ''}${r.error ? feedback(esc(r.error.message), 'warning') : ''}${r.result ? `<p>${esc(r.result)}</p>` : ''}${!live ? '<p class="muted">Shared history is read only and does not execute or retry.</p>' : ''}<h3>Evidence</h3>${detail.evidence.items.map((e) => `<article class="capability"><strong>${esc(e.kind)} · ${e.verified ? 'Verified' : 'Observed'}</strong><p>${esc(e.summary)}</p><small>${esc(e.observedAt)} · ${esc(e.objectRef)}</small></article>`).join('') || '<p>No evidence yet.</p>'}${detail.evidence.nextCursor ? btn('More evidence', 'next-pi-evidence', 'small') : ''}<h3>Runs</h3>${r.runIds.map((id) => `<code>${esc(id)}</code>`).join(' · ') || 'No Run admitted.'}`;
            footer = `${live && !terminal ? btn('Cancel request', 'cancel-pi-request', 'danger') : ''}${live && ['failed', 'cancelled', 'needs_attention'].includes(r.state) ? btn('Retry with new request', 'retry-pi-request', 'small') : ''}${btn('Refresh original request', 'pi-request-detail', 'small', `data-id="${esc(r.requestId)}"`)}${cancel()}`;
            break;
        }
        case "file-options":
            title = "Workspace options";
            body = `<div class="menu-list">${btn("Refresh files", "refresh-files")}${btn("Connect with WebDAV", "webdav")}</div>`;
            break;
        case "file-menu": {
            const f = target?.files.find((f) => f.path === view.data.path);
            title = esc(f?.name || "File");
            body = `<div class="menu-list">${btn("Open", "open-file", "", `data-path="${esc(f?.path)}"`)}${btn("Download file", "download-file", "", `data-path="${esc(f?.path)}" ${f?.kind === "directory" || f?.kind === "special" ? "disabled" : ""}`)}${btn("Rename", "file-rename", "", `data-path="${esc(f?.path)}"`)}${btn("Move", "file-move", "", `data-path="${esc(f?.path)}"`)}${btn("Copy", "file-copy", "", `data-path="${esc(f?.path)}"`)}${btn("Delete", "file-delete", "danger", `data-path="${esc(f?.path)}"`)}</div>`;
            break;
        }
        case "upload-overwrite":
            title = "Overwrite workspace files";
            body = `<p>Replace existing files with ${pendingUploadFiles.map(file => esc(file.name)).join(", ")}? The checked versions are listed in Transfer results. Targets without modification times cannot protect against concurrent changes.</p>`;
            footer = `${cancel()}${btn("Overwrite files", "confirm-upload-overwrite", "danger")}`;
            break;
        case "new-folder":
            title = "New folder";
            body = `<p>Create inside <code>${esc(view.path)}</code></p><label class="field">Folder name<input id="form-name" value="${esc(view.formName)}" placeholder="e.g. research"></label>`;
            footer = `${cancel()}${btn("Create folder", "confirm-folder", "primary")}`;
            break;
        case "file-transfer":
            title = `${view.data.transfer === "rename" ? "Rename" : view.data.transfer === "copy" ? "Copy" : "Move"} ${decodePaths(view.data.paths).length > 1 ? "selected items" : "item"}`;
            body = `<div class="path-list">${decodePaths(view.data.paths)
                .map((p) => `<code>${esc(p)}</code>`)
                .join("")}</div>${view.data.transfer === "rename"
                ? `<label class="field">New name<input id="form-name" value="${esc(view.formName)}" placeholder="Enter a file or folder name"></label>`
                : `<label class="field">Destination folder<select id="form-destination"><option value="/">Workspace /</option>${target?.files
                    .filter((f) => f.kind === "directory")
                    .map((f) => `<option value="${esc(f.path)}" ${view.formDestination === f.path ? "selected" : ""}>${esc(f.path)}</option>`)
                    .join("")}</select></label>`}<p class="muted">The destination must be inside this same Work.</p>${view.formOverwrite ? feedback(`These exact destinations already exist: <code>${esc(view.data.overwritePath)}</code>. Continuing replaces every listed target, including its child paths.`, "warning") : ""}`;
            footer = `${cancel()}${btn(view.formOverwrite ? "Overwrite target" : view.data.transfer === "copy" ? "Copy here" : view.data.transfer === "rename" ? "Rename" : "Move here", "confirm-transfer", view.formOverwrite ? "danger-solid" : "primary")}`;
            break;
        case "file-delete":
            title = "Delete selected files?";
            body = `<p>Remove these paths from this Work’s workspace.</p><div class="path-list">${decodePaths(view.data.paths)
                .map((p) => `<code>${esc(p)}</code>`)
                .join("")}</div><p class="danger-text">Folders are deleted recursively, including every child path. The workspace root cannot be deleted.</p>`;
            footer = `${cancel()}${btn("Delete paths", "confirm-file-delete", "danger-solid")}`;
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
            title = "Remove Pi Package";
            body = `<p>Remove ${esc(view.data.id)} from this Work? The operation updates its saved configuration; the active runtime remains until Apply.</p>`;
            footer = `${cancel()}${btn("Remove package", "confirm-remove-package", "danger")}`;
            break;
        case "package-detail": {
            const p = adapter.getPackages().find((x) => x.name === view.data.id);
            const entry = target?.packageEntries?.find(p => p.name === view.data.id);
            title = esc(view.data.id);
            body = `${target?.resourceErrors?.packages ? feedback(`Package observation unavailable. Last confirmed details: ${esc(target.resourceErrors.packages)}`, "warning") : ""}${view.data.id === "piwork-brain" ? `<p>Editable source: <code>.pi/packages/piwork-brain/</code></p>${btn("Open brain source", "open-source", "small", 'data-path="/.pi/packages/piwork-brain/brain.md"')}${brainCandidateDetails(entry)}` : `<pre class="code-editor">${esc(JSON.stringify(entry ?? p ?? { name: view.data.id }, null, 2))}</pre>`}<p class="muted">Installed, selected, active, and loaded states are reported separately.</p>`;
            footer = `${target ? btn("Refresh package", "refresh-package-detail", "small") : ""}${close()}`;
            break;
        }
        case "install-package":
            title = view.data.update ? "Update package source" : "Install Pi Package";
            body = `${uploadProgressMarkup()}<p>Choose the package source explicitly. Installing does not mean the model has loaded it.</p><label class="field">Source type<select id="install-type">${["Core", "npm", "Git", "Local directory", "ZIP"].map((t) => `<option ${view.installType === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>${view.installType === "Core"
                ? `<label class="field">Current Core copy<select id="install-name">${adapter
                    .getPackages()
                    .map((p) => `<option ${view.installName === p.name ? "selected" : ""}>${esc(p.name)}</option>`)
                    .join("")}</select></label>`
                : view.installType === "npm" || view.installType === "Git"
                    ? `<label class="field">${view.installType === "npm" ? "npm package reference" : "Git source"}<input id="install-source" value="${esc(view.installSource)}" placeholder="${view.installType === "npm" ? "@scope/package@version" : "Repository URL and optional ref"}"></label>`
                    : `<div class="file-drop">${icon("upload", 26)}<strong>${view.installSource ? esc(view.installSource) : `Select a ${view.installType === "ZIP" ? "ZIP archive" : "local directory"}`}</strong>${btn("Choose local source", "choose-package-source")}</div>${view.installType === "Local directory" ? feedback("Directory upload does not preserve executable bits or symbolic links. Use a ZIP when those attributes matter.", "warning") : ""}`}<p class="muted">Upload and validation happen before acceptance. Core prepares the package asynchronously; installing Agent capabilities may execute package preparation code in its isolated helper.</p>`;
            footer = `${cancel()}${btn(view.data.update ? "Update package" : "Install package", "confirm-install", "primary")}`;
            break;
        case "export": {
            title = "Export Work";
            const snap = adapter.state.snapshots.find((s) => s.workId === target?.id && adapter.getSnapshot(s.id));
            const op = snap
                ? adapter.state.operations.find((o) => o.id === snap.operationId)
                : undefined;
            body = `${snap ? downloadProgressMarkup(snap.id) : ""}<p>Create a full <code>.work</code> package, including the format-defined persistent workspace data.</p>${(!target || !adapter.project(target).exportable) ? feedback("Stop this Work explicitly, then return here to prepare the package. Export never stops a Work automatically.", "warning") : `${feedback("Work is confirmed stopped. Preparing a package will not start it.", "success")}`}${snap ? `<div class="export-snapshot"><h3>Original snapshot</h3><dl><dt>Snapshot ID</dt><dd><code>${snap.id}</code></dd><dt>Operation</dt><dd><button class="inline-link" data-action="operation" data-id="${snap.operationId}">${snap.operationId}</button></dd><dt>Status</dt><dd>${badge(op?.state === "failed" ? "Failed" : snap.status)}</dd></dl>${snap.status === "expired" ? feedback("This snapshot expired. Check the original snapshot ID. Prepare another package explicitly when ready.", "warning") : ""}${op?.error ? feedback(esc(op.error), "warning") : ""}${snap.status === "verified" ? '<p class="muted">Snapshot is verified. Download validates and saves the actual .work archive.</p>' : ""}</div>` : ""}`;
            footer = `${close()}${(!target || !adapter.project(target).exportable) ? btn("Stop Work first", "stop-work", "danger", `data-id="${target?.id}"`) : snap?.status === "verified" ? btn(`${icon("download")} Download .work`, "download-work", "primary", `data-id="${snap.id}"`) : btn("Prepare .work package", "prepare-export", "primary", `data-id="${target?.id}" ${snap && ["preparing", "validating"].includes(snap.status) && op?.state !== "failed" ? "disabled" : ""}`)}`;
            break;
        }
        case "import":
            title = "Import Work";
            body = `<p>Inspect the actual <code>.work</code> package using the local CLI. No file is sent to Core until you confirm import.</p><div class="file-drop">${icon("upload", 28)}<strong>${esc(view.inspectFilename || "Choose a Work package")}</strong>${btn("Choose .work file", "choose-work-file", "", adapter.inspectionContext && adapter.inspectionContext.importState !== "unsubmitted" ? "disabled" : "")}</div>${adapter.transferProgress ? feedback(`Transfer: ${esc(adapter.transferProgress.phase)} · ${esc(adapter.transferProgress.transferred ?? 0)} / ${esc(adapter.transferProgress.total ?? "unknown")} bytes`) : ""}${adapter.inspection ? `${feedback("Package format and contents verified locally.", "success")}<div class="inspection-summary"><h3>Verified package summary</h3><pre>${esc(JSON.stringify(adapter.inspection, null, 2))}</pre><p>Import creates a stopped Work. Private files may contain business data or credentials. No code starts automatically.</p></div><label class="field">Work name <span>Optional</span><input id="import-name" value="${esc(view.importName)}" placeholder="Leave blank to use the package name"></label>` : ""}`;
            body += adapter.inspectionContext && adapter.inspectionContext.importState !== "unsubmitted" ? feedback(`Original import: ${esc(adapter.inspectionContext.importState)} · <code>${esc(adapter.inspectionTransfer)}</code>. Check known operations; closing does not cancel or resubmit it.`, "warning", btn("Check original import", "check-inspection-import", "small") + btn("Known operations", "operations", "small")) : "";
            footer = `${cancel()}${adapter.inspection && adapter.inspectionContext?.importState === "unsubmitted" ? btn(adapter.state.signedIn ? "Import Work" : "Sign in to import", adapter.state.signedIn ? "confirm-import" : "import-sign-in", "primary") : ""}`;
            break;
        case "operations": {
            title = view.data.workId ? "Related operations" : "Known operations";
            const scope = `${adapter.state.core.address} · ${adapter.state.core.account}`;
            const operations = adapter.state.operations.filter((o) => o.scope === scope && (!view.data.workId || o.workId === view.data.workId));
            body = `<p>Records known by this local CLI, for the current Core and account. This is not a global server history.</p><label class="field">Find an Operation by ID<div class="input-action"><input id="operation-query" value="${esc(view.operationQuery)}" placeholder="op-…">${btn("Check status", "lookup-operation")}</div></label><label class="field">Find an original snapshot ID<div class="input-action"><input id="snapshot-query" value="${esc(view.snapshotQuery)}" placeholder="snapshot-…">${btn("Find snapshot", "lookup-snapshot")}</div></label><div class="operation-list">${operations.length ? operations.map((op) => `<button data-action="operation" data-id="${op.id}"><span>${icon("clock", 17)}<span><strong>${esc(op.kind)}</strong><small>${op.id} · ${op.updated}</small></span></span>${badge(op.state)}</button>`).join("") : '<p class="muted">No operations are known in this Desktop session.</p>'}</div><p class="muted">Records contain IDs and status only. The CLI stores minimal Operation IDs for the current Core and account. Clearing completed records does not cancel server work.</p>`;
            footer = `${btn("Clear local records", "clear-operations", "quiet", operations.length ? "" : "disabled")}${close()}`;
            break;
        }
        case "operation": {
            const op = adapter.getOperation(view.data.id);
            title = op ? esc(op.kind) : "Operation not found";
            body = op
                ? `${phase(op)}${op.action && adapter.getWork(op.workId) ? `<div class="operation-work-status">Work: ${workStatus(adapter.getWork(op.workId))}${quickAction(adapter.getWork(op.workId))}</div>` : ""}${feedback(`${esc(op.phase)}. ${op.state === "accepted" || op.state === "preparing" ? "Accepted does not mean completed. Closing this dialog will not cancel it." : op.state === "unknown" ? "Check this original Operation; do not repeat the request." : op.state === "succeeded" ? "The original Operation reached a confirmed result." : ""}`, op.state === "failed" ? "warning" : op.state === "succeeded" ? "success" : "info")}<dl><dt>Operation ID</dt><dd><code>${op.id}</code>${btn(icon("copy", 14), "copy", "icon-button quiet", `data-copy="${op.id}" aria-label="Copy Operation ID"`)}</dd><dt>Work ID</dt><dd><code>${op.workId}</code></dd><dt>State</dt><dd>${badge(op.state)}</dd><dt>Last confirmed</dt><dd>${op.updated}</dd>${op.snapshotId ? `<dt>Snapshot ID</dt><dd><code>${op.snapshotId}</code></dd>` : ""}</dl>${op.error ? feedback(esc(op.error), "warning") : ""}${op.observationError ? feedback(`Observation interrupted. ${esc(op.observationError)}`, "warning") : ""}${op.localRecordSaved === false ? feedback("Accepted, but the local record could not be saved. Copy the Operation ID; automatic recovery after reload is not guaranteed.", "warning") : ""}`
                : "<p>This Operation is not known for the current Core and user. Verify the ID or check the original Work.</p>";
            footer = `${close()}${op ? btn("Check status", "check-operation", "", `data-id="${op.id}"`) : ""}${op && !["succeeded", "failed", "superseded"].includes(op.state) ? btn(adapter.operationPaused(op.id) ? "Resume checking" : "Pause checking", adapter.operationPaused(op.id) ? "resume-operation" : "pause-operation", "", `data-id="${op.id}"`) : ""}${op?.state === "succeeded" && op.kind === "Import Work" ? `${btn("Open Work", "open-work", "primary", `data-id="${op.workId}"`)}${btn("Start Work", "start-work", "", `data-id="${op.workId}"`)}` : op?.state === "succeeded" && op.kind === "Create Work" ? btn("Open Work", "open-work", "primary", `data-id="${op.workId}"`) : op?.snapshotId ? btn("View package", "export", "primary", `data-id="${op.workId}"`) : ""}`;
            break;
        }
    }
    return `<dialog id="modal" aria-labelledby="modal-title" class="modal ${["new-work", "import", "manage-services", "operations", "service-details"].includes(view.modal) ? "wide" : ""}"><div class="modal-head"><h2 id="modal-title">${title}</h2>${btn(icon("close", 20), "close-modal", "icon-button quiet", 'aria-label="Close dialog"')}</div><div class="modal-body">${view.modalError ? feedback(esc(view.modalError), "warning") : ""}${body}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ""}</dialog>`;
}
function serviceDetails(s, w) {
    return `<dl><dt>Domain</dt><dd><code>${esc(s.domain)}</code></dd><dt>Declared Web ports</dt><dd>${s.ports.length ? s.ports.join(", ") : "No Web ports declared"}</dd><dt>Enabled</dt><dd>${s.enabled ? "Yes" : "No · persists across Work restarts"}</dd><dt>Observed</dt><dd>${badge(s.observed)}</dd>${s.operationId ? `<dt>Operation</dt><dd><button class="inline-link" data-action="operation" data-id="${s.operationId}">${s.operationId}</button></dd>` : ""}</dl>${s.error ? feedback(esc(s.error), "warning") : ""}<div class="service-controls">${btn("Start", "service-action", "small", `data-control="start" data-id="${s.id}" ${!adapter.project(w).usable || s.observed === "Ready" ? "disabled" : ""}`)}${btn("Stop", "service-action", "small", `data-control="stop" data-id="${s.id}" ${!adapter.project(w).usable || !s.enabled ? "disabled" : ""}`)}${btn("Restart", "service-action", "small", `data-control="restart" data-id="${s.id}" ${!adapter.project(w).usable || !s.enabled || s.observed !== "Ready" ? "disabled" : ""}`)}${btn("Retry", "service-action", "small", `data-control="retry" data-id="${s.id}" ${!adapter.project(w).usable || !s.enabled || s.observed !== "Failed" ? "disabled" : ""}`)}${btn("Remove", "service-action", "small danger", `data-control="remove" data-id="${s.id}" ${!adapter.project(w).usable ? "disabled" : ""}`)}</div><div class="logs-heading"><h3>Log snapshot</h3>${btn(`${icon("refresh", 14)} Refresh logs`, "refresh-logs", "small")}</div><pre class="logs">${esc(adapter.logs.get(s.id)?.text ?? adapter.logs.get(s.id)?.reason ?? "Logs have not been retrieved.")}</pre><p class="muted small-text">${esc(adapter.logs.get(s.id)?.status ?? "Not retrieved")} · Collected ${esc(adapter.logs.get(s.id)?.collectedAt ?? "Not provided")} · ${adapter.logs.get(s.id)?.truncated ? "Output truncated" : "Bounded snapshot"}. This is not a live stream.</p>`;
}
let focusReturn = "";
function focusKey(el) {
    if (!el)
        return "";
    if (el.id)
        return "#" + CSS.escape(el.id);
    const action = el.dataset.action;
    if (action)
        return `[data-action="${CSS.escape(action)}"]${el.dataset.id ? `[data-id="${CSS.escape(el.dataset.id)}"]` : ""}${el.dataset.path ? `[data-path="${CSS.escape(el.dataset.path)}"]` : ""}${el.dataset.optionValue !== undefined ? `[data-option-value="${CSS.escape(el.dataset.optionValue)}"]` : ''}`;
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
    return (adapter.getWork(el.dataset.id || view.data.workId || view.data.id || route()[1]) || current());
}
async function saveFile(record) {
    const w = current();
    if (!w)
        return false;
    if (view.fileWriteUncertain)
        throw new Error("Reread the saved version and explicitly approve its baseline before retrying.");
    const content = view.fileDraft;
    const path = view.file, key = location.hash;
    const result = await adapter.saveFile(w.id, path, content, view.fileBaseline, view.fileUnprotected, confirmed => {
        if (record) {
            actions.confirm(record, 'Saved');
            if (!confirmed.modified) {
                record.refresh = 'refreshing';
                render();
            }
        }
        if (key === location.hash && view.file === path) {
            view.fileOriginal = content;
            view.fileBaseline = confirmed.modified || '';
            toast('File saved. Confirming the saved version.');
        }
    });
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
        toast(result.message === "Confirmed" ? "File saved." : result.message);
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
        actions.confirm(record, 'Settings saved');
        void actions.refresh(record, () => adapter.loadConfiguration(w.id));
    }
    if (key !== location.hash)
        throw new ViewChanged();
    if (JSON.stringify(view.config) === version) {
        view.config = structuredClone(submitted);
        view.configDirty = false;
    }
    toast("Changes saved. Apply changes to use them.");
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
        toast("Fix the configuration JSON or discard the draft before continuing.");
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
    toast("Download started. Check your browser to confirm the file was saved.");
}
async function handleAction(action, el, record) {
    const ownedView = () => record?.kind === 'identity' ? location.hash : record && ['lifecycle', 'transfer'].includes(record.kind) ? `${location.hash}:${modalChoice}` : viewKey();
    const stay = async (pending) => { const key = ownedView(), modal = view.modal; const value = await pending; if (key !== ownedView() || record?.kind === 'identity' && !!view.modal && view.modal !== modal)
        throw new ViewChanged(); return value; };
    const show = (op) => { if (record) {
        record.businessId = op.id;
        actions.confirm(record, `Accepted · ${op.id}`);
        if (op.workId)
            void actions.refresh(record, () => op.kind === 'Delete Work' ? adapter.listWorks() : adapter.loadWork(op.workId));
    } runAndShow(op); };
    const filesConfirmed = (results) => {
        const succeeded = results.filter(result => result.status === 'succeeded').length;
        if (record) {
            actions.confirm(record, `${succeeded} paths confirmed; ${results.length - succeeded} need review`);
            record.blocked = results.some(result => result.status === 'unknown');
            if (currentWork)
                void actions.refresh(record, () => adapter.loadDirectory(currentWork.id, view.path));
        }
        if (results.some(result => result.status !== 'succeeded')) {
            view.modalError = 'Some paths were not confirmed. Review per-path results before submitting again.';
            render();
            return false;
        }
        return true;
    };
    const w = targetWork(el);
    const currentWork = current();
    const s = currentWork ? activeService(currentWork) : undefined;
    if (currentWork && !adapter.project(currentWork).usable && ['new-session', 'send-message', 'apply-config', 'service-action', 'confirm-service-control', 'save-file', 'dirty-save', 'confirm-upload-overwrite', 'confirm-folder', 'confirm-transfer', 'confirm-file-delete'].includes(action))
        throw new Error('This Work is not ready for new runtime or file changes. Check its current state.');
    switch (action) {
        case 'save-default-core':
            await adapter.savePreferences(view.coreAddress || adapter.state.core.address);
            break;
        case 'clear-default-core':
            await adapter.savePreferences(null);
            break;
        case 'read-default-core':
            await adapter.loadPreferences();
            break;
        case 'open-chat-models':
            openChatPicker('model');
            break;
        case 'open-chat-thinking':
            openChatPicker('thinking');
            break;
        case 'chat-input-options':
            openModal('chat-input-options');
            break;
        case 'choose-chat-setting': {
            if (!currentWork || view.data.workId !== currentWork.id || view.data.sessionId !== view.session)
                break;
            const kind = el.dataset.kind;
            if (kind === 'model')
                adapter.selectModel(currentWork.id, view.session, el.dataset.optionValue || null);
            else
                adapter.selectThinking(currentWork.id, view.session, el.dataset.optionValue);
            if (pendingWebCommand && pendingWebCommand.kind === kind) {
                const state = adapter.modelSelection(currentWork.id, view.session);
                Object.assign(pendingWebCommand, { workId: currentWork.id, sessionId: view.session, pair: { ref: state.ref, thinking: state.thinking } });
            }
            closeModal();
            confirmPendingChatCommand();
            break;
        }
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
            restoreChatLayout();
            break;
        case 'exit-service-focus':
            await exitWorkspaceFocus();
            break;
        case 'service-fullscreen':
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
                view.fullscreenError = document.fullscreenElement === root ? 'Full screen could not be closed. Try again.' : 'Full screen could not be opened. Focus remains available.';
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
        case "close-modal": {
            const key = focusReturn;
            closeModal();
            if (key)
                root.querySelector(key)?.focus();
            break;
        }
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
                await stay(openWork(w, record));
            }
            break;
        case "clear-search":
            view.search = "";
            render();
            break;
        case "operations":
            await stay(adapter.recoverOperations());
            openModal("operations");
            break;
        case "account":
        case "connection":
        case "new-work":
        case "import":
        case "agent-menu":
        case "run-details":
        case "manage-services":
        case "file-options":
        case "webdav":
        case "service-menu":
            openModal(action);
            break;
        case "work-menu":
        case "work-info":
        case "delete-work":
        case "stop-work":
        case "export":
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
        case "check-browser-access":
            await stay(adapter.checkBrowserAccess());
            toast("Browser access checked.");
            if (adapter.state.signedIn)
                await stay(adapter.checkConnection());
            break;
        case "copy-reopen-command":
            await copy(adapter.reopenCommand());
            break;
        case "copy-logout-command":
            await copy(adapter.logoutCommand());
            break;
        case "reset-browser-access":
            openModal("reset-browser-access");
            break;
        case "confirm-reset-browser-access":
            await adapter.resetBrowserAccess();
            view.modal = "";
            render();
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
            toast("Signed in.");
            break;
        }
        case "import-sign-in":
            importSignInSuspended = true;
            view.modal = "";
            render();
            toast("Sign in to continue importing the inspected package.");
            break;
        case "sign-out": {
            const result = await stay(adapter.signOut());
            view.drafts = {};
            view.config = null;
            view.configDirty = false;
            view.file = "";
            closeModal();
            toast(result.credentialCleared === false ? `Local identity cleared; saved credential cleanup is incomplete. Run ${adapter.logoutCommand()}.` : result.remoteRevocationConfirmed ? "Signed out. Browser access is retained." : "Local identity and saved credential cleared. Remote revocation could not be confirmed.");
            break;
        }
        case "reconnect":
            toast("Start piwork-cli desktop and open the fresh launch address.");
            break;
        case "confirm-switch-core":
            await stay(adapter.switchCore(view.coreAddress));
            view.drafts = {};
            view.config = null;
            view.configDirty = false;
            closeModal();
            break;
        case "retry-works":
            await stay(adapter.listWorks());
            break;
        case "check-connection":
            await stay(adapter.checkConnection());
            toast("Connection checked.");
            break;
        case "start-work":
            if (w)
                show(await stay(adapter.lifecycle(w.id, w.status === "Failed" ? "retry" : "start")));
            break;
        case "confirm-stop":
            if (w)
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
                    const started = original.action === 'start-work' && checked.desired === 'running' && ['Ready', 'Degraded'].includes(checked.status);
                    const stopped = original.action === 'confirm-stop' && checked.desired === 'stopped' && checked.status === 'Stopped';
                    if (started || stopped)
                        actions.review(original);
                }
            }
            if (op) {
                reviewOperation(op, record);
                openModal('operation', { id: op.id });
            }
            else {
                if (ids.length > 1)
                    openModal('operations', { workId: w.id });
                toast('Work status checked.');
            }
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
            const config = {};
            if (view.createJson.trim()) {
                let data;
                try {
                    data = JSON.parse(view.createJson);
                }
                catch {
                    throw Error("Configuration JSON is invalid. Your entered values are preserved.");
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
            if (view.createAgents)
                config.agents = view.createAgents;
            const op = await stay(adapter.createWork(view.createName.trim(), config, view.createImage));
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
                if (route()[2])
                    location.hash = `/work/${currentWork?.id}`;
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
                    actions.confirm(record, 'Session created');
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
                view.drafts[draftKey(currentWork)] =
                    action === "suggest-message"
                        ? "Build a simple notes app and save its data in the shared workspace."
                        : "List the shared workspace files and help me analyze the data I choose.";
                render();
                root.querySelector("#composer")?.focus();
            }
            break;
        case "pi-requests":
            if (currentWork) {
                const serviceName = view.modal === 'pi-requests' ? view.data.serviceName || '' : '';
                openModal('pi-requests', { serviceName });
                await stay(adapter.loadRequests(currentWork.id, serviceName));
            }
            break;
        case "next-pi-requests":
            if (currentWork)
                await stay(adapter.loadRequests(currentWork.id, view.data.serviceName || '', true));
            break;
        case "pi-request-detail":
            if (currentWork) {
                const requestId = el.dataset.id || view.data.requestId;
                openModal('pi-request-detail', { requestId });
                await stay(adapter.loadRequest(currentWork.id, requestId));
            }
            break;
        case "next-pi-evidence":
            if (currentWork)
                await stay(adapter.loadRequest(currentWork.id, view.data.requestId, true));
            break;
        case "cancel-pi-request":
            if (currentWork)
                await stay(adapter.cancelRequest(currentWork.id, view.data.requestId));
            break;
        case "retry-pi-request":
            if (currentWork) {
                const result = await stay(adapter.retryRequest(currentWork.id, view.data.requestId));
                openModal('pi-request-detail', { requestId: result.requestId });
                await stay(adapter.loadRequest(currentWork.id, result.requestId));
            }
            break;
        case "load-models":
            if (currentWork)
                await stay(adapter.loadModels(currentWork.id));
            break;
        case "save-model":
            if (currentWork && view.session)
                await stay(adapter.saveModel(currentWork.id, view.session));
            break;
        case "check-session-model":
            if (currentWork && view.session)
                await stay(adapter.checkSessionModel(currentWork.id, view.session));
            break;
        case "send-message":
            if (currentWork) {
                const originalKey = draftKey(currentWork);
                const text = view.drafts[originalKey] || "";
                if (text.trimStart().startsWith('/') && !view.literalSlash) {
                    const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
                    const name = match?.[1] || '';
                    if (webCommands.includes(name)) {
                        if (match?.[2]?.trim())
                            throw new Error('This workspace command does not accept arguments. Your draft is kept.');
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
                    if (adapter.chatCapabilities.get(currentWork.id) !== 1)
                        throw new Error('Resource commands are unavailable in this Work. Choose Send as text to send a literal slash.');
                    const directory = adapter.commands.get(currentWork.id);
                    if (!directory?.confirmed || directory.error || !directory.items.some(command => command.command === `/${name}`))
                        throw new Error('Unknown resource command. Choose an available command or Send as text.');
                }
                if (!view.session) {
                    view.session = await stay(adapter.newSession(currentWork.id));
                    render();
                    await stay(adapter.saveModel(currentWork.id, view.session));
                }
                adapter.selectedService = view.service;
                await stay(adapter.send(currentWork.id, view.session, text, view.includeIdentity, text.trimStart().startsWith("/") && !view.literalSlash ? "command" : adapter.chatCapabilities.get(currentWork.id) === 1 ? "text" : undefined));
                if (record) {
                    record.businessId = currentWork.run?.id;
                    actions.confirm(record, 'Message accepted');
                }
                if (view.drafts[draftKey(currentWork)] === text)
                    view.drafts[draftKey(currentWork)] = "";
                if (view.drafts[originalKey] === text)
                    view.drafts[originalKey] = "";
                view.scrollPinned = true;
                render();
                const composer = root.querySelector("#composer");
                if (composer && composer.value === text)
                    composer.value = view.drafts[draftKey(currentWork)] || "";
            }
            break;
        case "cancel-run":
            if (currentWork) {
                await stay(adapter.cancelRun(currentWork.id));
                if (record) {
                    record.businessId = currentWork.run?.id;
                    actions.confirm(record, 'Cancellation requested');
                }
            }
            break;
        case "resume-run":
            if (currentWork) {
                await stay(adapter.resumeRunConnection(currentWork.id));
                if (record) {
                    record.businessId = currentWork.run?.id;
                    actions.confirm(record, 'Reconnected');
                }
            }
            break;
        case "active-run":
            if (currentWork?.run) {
                view.session = currentWork.run.sessionId;
                openModal("run-details");
            }
            break;
        case "scroll-bottom":
            view.scrollPinned = true;
            render();
            break;
        case "open-source":
            if (currentWork) {
                await guard(async () => {
                    areaChoice++;
                    view.tab = "Files";
                    await stay(openFile(currentWork, el.dataset.path));
                    render();
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
                toast("Local Work link copied. It requires this CLI and signed-in browser session.");
            }
            break;
        case "open-app":
        case "open-window":
            if (currentWork && s) {
                const opened = window.open('about:blank', '_blank', action === 'open-window' ? 'width=1120,height=820' : undefined);
                if (!opened) {
                    view.serviceOpenError = 'The browser blocked this window. Allow popups or copy the protected local link.';
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
                await stay(adapter.ensureServiceEntry(currentWork.id, s.id, view.port));
            break;
        case 'check-preview':
            if (currentWork && s)
                await stay(adapter.serviceFrameLoaded(currentWork.id, s.id, view.port));
            break;
        case "service-details":
            if (currentWork)
                await stay(adapter.readLogs(currentWork.id, el.dataset.id));
            openModal("service-details", { serviceId: el.dataset.id });
            break;
        case "service-action": {
            const control = el.dataset.control;
            if (control === "stop" || control === "remove")
                openModal("service-control", { serviceId: el.dataset.id, control });
            else if (currentWork)
                show(await stay(adapter.operateService(currentWork.id, el.dataset.id, control)));
            break;
        }
        case "confirm-service-control":
            if (currentWork)
                show(await stay(adapter.operateService(currentWork.id, view.data.serviceId, view.data.control)));
            break;
        case "refresh-logs":
            if (currentWork)
                await stay(adapter.readLogs(currentWork.id, view.data.serviceId));
            render();
            break;
        case "refresh-files":
            if (currentWork) {
                await stay(adapter.loadDirectory(currentWork.id, view.path));
                if (view.file)
                    await stay(adapter.readFile(currentWork.id, view.file));
            }
            if (view.file && currentWork) {
                const fresh = currentWork.files.find((f) => f.path === view.file);
                if (fresh && (dirty() || view.fileWriteUncertain)) {
                    view.fileReread = { ...fresh };
                    toast("Target reread. Your draft is kept; compare it with the known saved version before saving again.");
                }
                else if (fresh) {
                    view.fileDraft = fresh.content || "";
                    view.fileOriginal = view.fileDraft;
                    view.fileBaseline = fileVersion(fresh.modified);
                    view.fileReread = null;
                    view.fileUnprotected = false;
                }
            }
            toast("Workspace reread. Unknown writes were not repeated.");
            break;
        case "file-path":
            await guard(async () => {
                if (currentWork)
                    await stay(adapter.loadDirectory(currentWork.id, el.dataset.path));
                view.path = el.dataset.path;
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
            view.fileUnprotected = true;
            toast("Unprotected overwrite approved for the next save.");
            break;
        case "use-reread-version":
            if (view.fileReread?.kind === "text") {
                view.fileBaseline = fileVersion(view.fileReread.modified);
                view.fileOriginal = view.fileReread.content ?? "";
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
            break;
        case "confirm-upload-overwrite":
            if (currentWork) {
                const results = await stay(adapter.upload(currentWork.id, view.path, pendingUploadFiles, true));
                filesConfirmed(results);
                pendingUploadFiles = pendingUploadFiles.filter(file => results.some(r => r.path.endsWith("/" + file.name) && r.status !== "succeeded"));
                if (!pendingUploadFiles.length)
                    closeModal();
                else {
                    view.modalError = "Some uploads need review. Inputs are kept; review Transfer results before confirming again.";
                    render();
                }
            }
            break;
        case "confirm-folder":
            if (currentWork) {
                const name = validateName(view.formName);
                const results = await stay(adapter.transfer(currentWork.id, "mkdir", ["new-folder"], joinPath(view.path, name)));
                if (filesConfirmed(results))
                    closeModal();
            }
            break;
        case "file-rename":
        case "file-copy":
        case "file-move": {
            const paths = el.dataset.path ? [el.dataset.path] : view.selected;
            if (!paths.length)
                throw Error("Select a file or folder first.");
            openModal("file-transfer", {
                paths: JSON.stringify(paths),
                transfer: action.slice(5),
            });
            break;
        }
        case "confirm-transfer":
            if (currentWork) {
                const paths = decodePaths(view.data.paths);
                const destinations = paths.map((path) => view.data.transfer === "rename"
                    ? joinPath(path.slice(0, path.lastIndexOf("/")) || "/", validateName(view.formName))
                    : joinPath(view.formDestination, path.split("/").pop()));
                const conflicts = destinations.filter((p) => currentWork.files.some((f) => f.path === p));
                if (conflicts.length && !view.formOverwrite) {
                    view.formOverwrite = true;
                    view.data.overwritePath = conflicts.join(", ");
                    render();
                    break;
                }
                const all = [];
                for (let i = 0; i < paths.length; i++)
                    all.push(...await stay(adapter.transfer(currentWork.id, view.data.transfer === "copy" ? "copy" : "move", [paths[i]], destinations[i], view.formOverwrite)));
                adapter.state.transfers = all;
                adapter.transfersByWork.set(currentWork.id, all);
                if (filesConfirmed(all)) {
                    view.selected = [];
                    closeModal();
                }
            }
            break;
        case "file-delete": {
            const paths = el.dataset.path ? [el.dataset.path] : view.selected;
            if (!paths.length)
                throw Error("Select a file or folder first.");
            openModal("file-delete", { paths: JSON.stringify(paths) });
            break;
        }
        case "confirm-file-delete":
            if (currentWork) {
                const results = await stay(adapter.transfer(currentWork.id, "delete", decodePaths(view.data.paths)));
                if (filesConfirmed(results)) {
                    view.selected = [];
                    closeModal();
                }
            }
            break;
        case "upload":
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
            if (currentWork)
                show(await stay(adapter.applyConfiguration(currentWork.id)));
            break;
        case "refresh-config":
            if (currentWork) {
                await stay(adapter.loadConfiguration(currentWork.id));
                if (!view.configDirty)
                    view.config = structuredClone(currentWork.config);
                toast("Configuration status refreshed. Review In use, Loaded, and Visible to model separately.");
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
                    actions.confirm(record, 'Skill copy saved');
                    void actions.refresh(record, () => adapter.loadConfiguration(currentWork.id));
                }
                closeModal();
                toast("Current Core copies saved. Apply changes to load them.");
            }
            break;
        case "check-catalog":
            const available = await stay(adapter.checkCatalog());
            toast(available ? "Core catalogs confirmed. Existing selections preserved." : `Catalog check incomplete: ${[adapter.catalog.skills.error, adapter.catalog.packages.error].filter(Boolean).join(" ")}`);
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
                    throw Error("Choose or enter a package source.");
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
        case "prepare-export":
            if (w)
                show(await stay(adapter.prepareExport(w.id)));
            break;
        case "download-work": {
            const pending = adapter.downloadSnapshot(el.dataset.id);
            if (record)
                record.businessId = adapter.downloads.get(el.dataset.id)?.transferId;
            downloadURL(await stay(pending));
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
                throw Error("Operation not found for this Core and user. Verify the original ID.");
            break;
        }
        case "lookup-snapshot": {
            const snap = await stay(adapter.fetchSnapshot(view.snapshotQuery.trim()));
            if (snap)
                openModal("export", { id: snap.workId });
            else
                throw Error("Snapshot not found. Check its exact original ID and Core.");
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
    if (!result || result === "." || result === ".." || /[\\/]/.test(result))
        throw Error("Enter a name without path separators.");
    return result;
}
async function openFile(w, path) {
    const key = viewKey();
    await adapter.readFile(w.id, path);
    if (key !== viewKey())
        throw new ViewChanged();
    const f = w.files.find((f) => f.path === path);
    if (!f) {
        toast("This file is not available in the workspace.");
        return;
    }
    if (f.kind === "directory") {
        view.path = f.path;
        view.file = "";
        view.selected = [];
    }
    else {
        view.path = f.path.slice(0, f.path.lastIndexOf("/")) || "/";
        view.file = f.path;
        view.fileDraft = f.content || "";
        view.fileOriginal = view.fileDraft;
        view.fileEditable = f.kind === "text" && f.size <= 1048576;
        view.fileBaseline = fileVersion(f.modified);
        view.fileReread = null;
        view.fileUnprotected = false;
        view.fileWriteUncertain = false;
    }
}
async function copy(text) {
    try {
        await navigator.clipboard.writeText(text);
        toast("Copied to clipboard.");
    }
    catch {
        toast(`Clipboard unavailable. Copy this value: ${text}`);
    }
}
function render() {
    adapter.observePage(route()[1] || '', document.visibilityState === 'visible', route()[0] !== 'app');
    if (view.config && !view.config.advancedDirty)
        synchronizeConfiguration(view.config);
    const active = document.activeElement;
    const activeKey = focusKey(active);
    const selection = active && "selectionStart" in active ? active.selectionStart : null;
    const selectionEnd = active && 'selectionEnd' in active ? active.selectionEnd : selection;
    const messages = root.querySelector("#messages");
    const scroll = messages?.scrollTop || 0;
    const firstVisible = messages && !view.scrollPinned ? [...messages.querySelectorAll('[data-message-key]')].find(node => node.getBoundingClientRect().bottom > messages.getBoundingClientRect().top) : undefined;
    const readingAnchor = firstVisible ? { key: firstVisible.dataset.messageKey, offset: firstVisible.getBoundingClientRect().top - messages.getBoundingClientRect().top } : undefined;
    if (messages?.clientHeight && messages.dataset.readingKey)
        chatReading.set(messages.dataset.readingKey, { scroll, pinned: view.scrollPinned, anchor: readingAnchor });
    const modalScroll = root.querySelector(".modal-body")?.scrollTop || 0;
    const r = route();
    if (workspaceReturn && (workspaceReturn.workId !== r[1] || !['work', 'app'].includes(r[0])))
        resetWorkspaceFocus();
    root.dataset.layout = view.layout;
    root.classList.toggle('service-focused', view.layout !== 'workspace');
    root.classList.toggle('chat-focused', view.layout === 'chat-only');
    let html = "";
    if (adapter.state.scenario === "cli-closed")
        html = `${topbar()}<main class="auth-main">${empty("terminal", "Desktop’s local connection has closed", "Start piwork-cli desktop again, then open its new launch address. A browser-only retry cannot restart the CLI.", "")}</main>`;
    else if (!adapter.state.signedIn ||
        adapter.state.browserAccess !== "authorized")
        html = signIn();
    else if (r[0] === "app") {
        const w = adapter.getWork(r[1]);
        if (w) {
            view.service = r[2];
            view.port = Number(r[3]) || 3000;
            html = `${workHeader(w, true)}<div class="standalone-label">Independent application window · Closing this tab does not stop the Service</div><main class="standalone-app">${!adapter.project(w).usable ? `${view.layout !== 'workspace' ? `<div class="focus-unavailable"><b>${esc(w.name)}</b>${focusControls(w)}</div>` : ''}${workState(w)}` : services(w)}</main>`;
        }
        else
            html = works();
    }
    else if (r[0] === "work") {
        const w = adapter.getWork(r[1]);
        html = w
            ? workPage(w)
            : [...actions.records.values()].some(record => record.work === r[1] && record.pending) ? `${topbar()}<main>${empty('grid', 'Loading Work', esc(r[1]), btn('Back to Works', 'back-works'))}</main>` : `${topbar()}${empty("grid", workReadErrors.get(r[1])?.missing ? "Work not found" : "Work unavailable", esc(workReadErrors.get(r[1])?.message || "Read this Work again to confirm its current availability."), btn("Retry", "retry-work-read", "primary") + btn("Back to Works", "back-works"))}`;
    }
    else
        html = works();
    // Ephemeral status nodes must not displace existing iframe ancestors during reconciliation.
    root.querySelectorAll('[data-action-status]').forEach(node => node.remove());
    reconcileHTML(root, `${html}${[...adapter.cleanupPending].map(([id, pending]) => feedback(`${esc(pending.message)} <code>${esc(id)}</code>`, "warning", btn("Retry cleanup", "retry-inspection-cleanup", "small", `data-id="${esc(id)}"`))).join("")}<div id="toast" class="toast ${view.toast ? "visible" : ""}" role="status" aria-live="polite">${icon("info", 17)}${esc(view.toast)}</div>${view.modal && adapter.state.browserAccess === "authorized" ? modalMarkup() : ""}<input type="file" id="upload-input" multiple hidden><input type="file" id="agents-input" accept=".md,.txt" hidden><input type="file" id="create-agents-input" accept=".md,.txt" hidden><input type="file" id="json-input" accept=".json" hidden><input type="file" id="work-file-input" accept=".work" hidden><input type="file" id="package-zip-input" accept=".zip" hidden><input type="file" id="package-directory-input" webkitdirectory multiple hidden>`);
    for (const frame of root.querySelectorAll('iframe[data-service-key]'))
        if (!frame.dataset.observed) {
            frame.dataset.observed = 'true';
            frame.addEventListener('load', () => { const [workId, serviceId, port] = frame.dataset.serviceKey.split(':'); void adapter.serviceFrameLoaded(workId, serviceId, Number(port)).catch(error => toast(error.message)); });
        }
    renderActionStates(root, actions, location.hash, el => actionIntent(el), record => !record.resource?.startsWith('service:') || record.resource === `service:${view.data.serviceId || (current() ? activeService(current())?.id : view.service)}${record.kind === 'service' ? '' : `:${view.port}`}`);
    const dialog = root.querySelector("#modal");
    if (dialog) {
        if (!dialog.open)
            dialog.showModal();
        if (!dialog.dataset.bound) {
            dialog.dataset.bound = "true";
            dialog.addEventListener("cancel", (e) => {
                e.preventDefault();
                const key = focusReturn;
                closeModal();
                if (key)
                    root.querySelector(key)?.focus();
            });
        }
        const body = dialog.querySelector(".modal-body");
        if (body)
            body.scrollTop = modalScroll;
    }
    if (activeKey) {
        const replacement = root.querySelector(activeKey);
        if (replacement && replacement !== active && (!dialog || dialog.contains(replacement))) {
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
                if (pinned !== view.scrollPinned) {
                    view.scrollPinned = pinned;
                    const old = root.querySelector(".back-latest");
                    if (pinned)
                        old?.remove();
                    else if (!old) {
                        const b = document.createElement("button");
                        b.className = "button back-latest";
                        b.dataset.action = "scroll-bottom";
                        b.textContent = "Back to latest";
                        next.after(b);
                    }
                }
            });
        }
    }
}
root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el || el.hasAttribute("disabled"))
        return;
    if (!view.modal)
        focusReturn = focusKey(el);
    const origin = viewKey();
    void dispatchAction(el).catch((error) => {
        if (error instanceof ViewChanged || origin !== viewKey())
            return;
        if (view.modal) {
            view.modalError = error instanceof Error ? error.message : String(error);
            render();
        }
        else
            toast(error instanceof Error ? error.message : String(error));
    }).finally(() => { render(); });
});
root.addEventListener("input", (e) => {
    const input = e.target;
    const value = input.value;
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
    const value = input.value;
    const checked = input.checked;
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
        case "port-select":
            serviceChoice++;
            view.serviceOpenError = "";
            view.port = Number(value);
            if (w && view.port)
                void adapter.ensureServiceEntry(w.id, view.service, view.port).catch(error => toast(error.message));
            render();
            break;
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
        const intent = { key: `file-input:${w?.id || 'local'}:${input.id}${input.id === 'upload-input' ? '' : ':' + selection}`, kind: input.id === 'upload-input' ? 'files' : 'read', work: w?.id, resource: input.id,
            label: input.id === 'upload-input' ? 'Checking upload targets' : 'Reading selected file', target: `${w?.name || 'Local CLI'} · ${input.files?.[0]?.name || 'Selected files'}`, view: location.hash };
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
    if (input.id === "upload-input" && w) {
        const directory = view.path;
        const results = await adapter.upload(w.id, directory, files);
        if (record) {
            actions.confirm(record, `${results.filter(result => result.status === 'succeeded').length} files confirmed; review per-path results`);
            void actions.refresh(record, () => adapter.loadDirectory(w.id, directory));
        }
        if (!valid())
            throw new ViewChanged();
        pendingUploadFiles = files.filter(file => results.some(result => result.path.endsWith("/" + file.name) && result.status !== "succeeded"));
        if (pendingUploadFiles.length)
            openModal("upload-overwrite");
        render();
    }
    else if (input.id === "work-file-input") {
        if (!files[0].name.endsWith(".work"))
            throw Error("Choose a file with the .work extension.");
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
                ? `${files.length} local directory files`
                : files[0].name;
        render();
    }
    else {
        if (files[0].size > 1048576)
            throw Error("Configuration file exceeds the 1 MiB import limit.");
        let text;
        try {
            text = new TextDecoder("utf-8", { fatal: true }).decode(await files[0].arrayBuffer());
        }
        catch {
            if (!valid())
                throw new ViewChanged();
            throw Error("This configuration file is not valid UTF-8. Your existing draft is preserved.");
        }
        if (!valid())
            throw new ViewChanged();
        if (input.id === "create-agents-input")
            view.createAgents = text;
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
    if (e.isComposing || composition) {
        if (e.key === 'Enter')
            e.preventDefault();
        return;
    }
    if (dialog?.open && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        const key = focusReturn;
        closeModal();
        if (key)
            root.querySelector(key)?.focus();
        return;
    }
    if (dialog?.open && ['chat-models', 'chat-thinking'].includes(view.modal) && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        const options = [...dialog.querySelectorAll('[role=menuitemradio]:not([disabled])')];
        if (options.length) {
            e.preventDefault();
            const index = options.indexOf(document.activeElement);
            options[e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
        }
        return;
    }
    const work = current(), draft = work ? view.drafts[draftKey(work)] || '' : '';
    const choices = work ? commandChoices(work, draft) : [];
    if (!dialog?.open && e.target.id === 'composer' && !e.isComposing && !composition && choices.length) {
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
    if (!dialog?.open && e.key === 'Escape' && !e.isComposing && !composition) {
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
    if (e.key === "Tab" && dialog?.open) {
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
window.addEventListener("hashchange", () => {
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
    const changed = lastRoute !== location.hash;
    lastRoute = location.hash;
    if (changed) {
        view.modal = "";
        modalChoice++;
    }
    void loadRoute().catch(error => toast(error.message));
    render();
});
window.addEventListener("pagehide", () => { actions.clear(); adapter.stopDownloadObservers(); adapter.stopRunObservers(); adapter.abandonInspectionOnUnload(); });
window.addEventListener("beforeunload", (e) => {
    if (dirty() || view.configDirty) {
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
        view.port = service.ports.includes(view.port) ? view.port : service.ports[0] || 0;
        if (service.observed === 'Ready' && view.port && (tab === 'Services' || route()[0] === 'app'))
            await adapter.ensureServiceEntry(work.id, service.id, view.port).catch(() => undefined);
    }
    if (tab === 'Files' && path === view.path)
        await adapter.loadDirectory(work.id, path).catch(() => undefined);
    if (epoch === adapter.identityEpoch && origin === location.hash)
        render();
}
adapter.subscribe(() => {
    if (lastIdentity !== adapter.identityEpoch) {
        lastIdentity = adapter.identityEpoch;
        actions.clear();
        workReadErrors.clear();
        view.serviceOpenError = "";
        view.file = "";
        view.fileDraft = "";
        view.fileOriginal = "";
        view.fileBaseline = "";
        view.fileReread = null;
        view.config = null;
        view.configDirty = false;
        view.drafts = {};
        resetWorkspaceFocus();
        chatReading.clear();
        expandedActivity.clear();
        pendingWebCommand = undefined;
        fileSelections.clear();
        runtimeAvailability.clear();
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
    confirmPendingChatCommand();
    render();
});
lastRoute = location.hash;
render();
void adapter.initialize().then(async () => { view.coreAddress = adapter.state.core.address; if (adapter.state.browserAccess === 'authorized')
    void adapter.loadPreferences(); await loadRoute(); }).catch(error => toast(error.message));
let packageFiles = [];
let pendingUploadFiles = [];
function downloadURL(url) { const link = document.createElement('a'); link.href = url; link.download = ''; link.click(); toast('Download started. Check your browser to confirm it was saved.'); }
let routeLoad = 0;
const workReadErrors = new Map();
async function loadRoute() {
    if (!adapter.state.signedIn)
        return;
    const version = ++routeLoad;
    const r = route();
    if (!['work', 'app'].includes(r[0]) || r[2] === 'settings' || workspaceReturn && workspaceReturn.workId !== r[1]) {
        await exitWorkspaceFocus();
    }
    if (!['work', 'app'].includes(r[0]) || !r[1]) {
        render();
        return;
    }
    const record = actions.begin({ key: `route:${r[1]}:${version}`, kind: 'read', work: r[1], label: 'Loading Work', target: r[1], view: location.hash });
    try {
        const origin = location.hash, epoch = adapter.identityEpoch;
        const choices = { area: areaChoice, service: serviceChoice, session: sessionChoice };
        const valid = () => version === routeLoad && origin === location.hash && epoch === adapter.identityEpoch;
        const work = await adapter.loadWork(r[1], r[0] !== 'app');
        if (!valid())
            return;
        workReadErrors.delete(r[1]);
        const previous = workSelections.get(work.id);
        const serviceId = r[0] === 'app' ? r[2] : choices.service === serviceChoice ? previous?.service ?? view.service : view.service;
        const port = r[0] === 'app' ? Number(r[3]) : choices.service === serviceChoice ? previous?.port || view.port : view.port;
        const service = work.services.find(s => s.id === serviceId) ?? work.services.find(s => s.enabled && s.observed === 'Ready' && s.ports.length);
        view.service = service?.id ?? '';
        view.port = service?.ports.includes(port) ? port : service?.ports[0] ?? 0;
        const sessionId = choices.session === sessionChoice ? previous?.session ?? view.session : view.session;
        view.session = work.sessions.find(s => s.id === sessionId)?.id ?? work.sessions[0]?.id ?? '';
        if (view.session && r[0] !== 'app')
            await adapter.loadSession(work.id, view.session);
        if (!valid())
            return;
        if (r[2] === 'settings' && !view.configDirty)
            view.config = structuredClone(work.config);
        else if (r[0] !== 'app' && choices.area === areaChoice)
            view.tab = service ? 'Services' : 'Chat';
        const selectedService = activeService(work);
        if (selectedService?.observed === 'Ready' && view.port)
            await adapter.ensureServiceEntry(work.id, selectedService.id, view.port).catch(error => { if (valid())
                toast(error.message); });
        if (valid())
            render();
    }
    catch (error) {
        if (record && actions.current(record)) {
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
window.addEventListener('popstate', () => { void loadRoute().catch(error => toast(error.message)); });
/** Update existing nodes in place. In particular, never detach an unchanged Service iframe or its ancestors. */
function reconcileHTML(parent, html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const key = (node) => node instanceof Element ? node.getAttribute('data-message-key') ? `message:${node.getAttribute('data-message-key')}` : node.getAttribute('data-service-key') ? `frame:${node.getAttribute('data-service-key')}` : node.id ? `id:${node.id}` : `${node.tagName}:${node.getAttribute('class')?.split(' ')[0] ?? ''}` : node.nodeType === Node.TEXT_NODE ? '#text' : '#other';
    const patch = (target, incoming) => {
        if (target instanceof Element && incoming instanceof Element) {
            if (target instanceof HTMLIFrameElement)
                return;
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
        let cursor = target.firstChild;
        const used = new Set();
        for (const child of Array.from(incoming.childNodes)) {
            if (cursor && key(cursor) === key(child)) {
                const next = cursor.nextSibling;
                used.add(cursor);
                patch(cursor, child);
                cursor = next;
            }
            else {
                const match = Array.from(target.childNodes).find(node => node !== cursor && !used.has(node) && key(node) === key(child));
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
            const next = cursor.nextSibling;
            target.removeChild(cursor);
            cursor = next;
        }
    };
    children(parent, template.content);
}
function skillState(work, name, field) { const runtime = work.config.runtime?.skills?.find((s) => s.name === name); const value = runtime?.[field]; return value === undefined ? "Not provided" : field === "loaded" ? value ? "Loaded" : "Not loaded" : value ? "Visible to model" : "Not visible to model"; }
function brainBehavior(adoption) {
    return adoption === "verified" ? "Behavior verified" : adoption === "failed" ? "Behavior checks failed" : adoption === "not-confirmed" ? "Behavior not confirmed" : "Behavior observation unavailable";
}
function packageStatus(work, name) { const p = work.packageEntries?.find(p => p.name === name); return p ? `${p.pendingApply ? "Saved · Not applied" : "Saved"} · ${p.runtime?.loaded === true ? "Loaded" : p.runtime?.loaded === false ? "Not loaded" : "Loading unconfirmed"}${p.candidate ? ` · Work files candidate: ${p.candidate.preparation} · ${brainBehavior(p.candidate.adoption)}${p.candidate.apply?.state === "failed" ? " · Apply failed" : ""}` : ""}` : "Saved selection · Runtime not provided"; }
function brainCandidateDetails(entry) {
    const candidate = entry?.candidate;
    if (!candidate)
        return "<p>No candidate details available.</p>";
    const baseline = candidate.baseline, verification = candidate.verification, apply = candidate.apply;
    const selection = (enabled, matches) => typeof enabled !== "boolean" || typeof matches !== "boolean" ? "Baseline observation unavailable" : `${enabled ? "Enabled" : "Disabled"} at acceptance · ${matches ? "Still matches" : "Changed since acceptance"}`;
    const operation = (id, label) => btn(esc(label), "operation", "inline-link", `data-id="${esc(id)}"`);
    const applyKnown = apply?.availability === "available" && apply.operationId && apply.state;
    const applyState = applyKnown ? `${apply.state === "failed" ? "Apply failed" : `Apply ${apply.state}`} · ${operation(apply.operationId, apply.operationId)}` : apply?.availability === "not-applied" ? "No matching Apply" : "Apply observation unavailable";
    const preparation = candidate.preparation === "succeeded" ? "Published" : ["failed", "superseded", "cleanup-pending"].includes(candidate.preparation) ? candidate.preparation : "Preparing";
    return `<h3>Candidate from ${esc(candidate.source)}</h3><dl><dt>Active selection at acceptance</dt><dd>${esc(selection(baseline?.activeSelected, baseline?.activeMatchesCurrent))}</dd><dt>Saved selection at acceptance</dt><dd>${esc(selection(baseline?.desiredSelected, baseline?.desiredMatchesCurrent))}</dd><dt>Fixed verification goal</dt><dd>${esc(verification?.goal ?? "Verification observation unavailable")}</dd><dt>Capability</dt><dd>${esc(verification?.toolName ?? "Unavailable")}</dd><dt>Input summary</dt><dd><pre>${esc(verification?.inputSummary ?? "Unavailable")}</pre></dd><dt>Required checks</dt><dd>${Array.isArray(verification?.checkNames) ? verification.checkNames.map((name) => `<div>${esc(name)}</div>`).join("") : "Unavailable"}</dd><dt>Preparation / publication</dt><dd>${esc(preparation)} · ${operation(candidate.operationId, "Preparation operation")}</dd><dt>Candidate saved</dt><dd>${candidate.desired ? "Yes" : "No"}</dd><dt>Candidate active</dt><dd>${candidate.active ? "Yes" : "No"}</dd><dt>Loaded</dt><dd>${entry?.runtime?.availability !== "available" ? "Loading observation unavailable" : entry.runtime.loaded === true ? "Yes" : entry.runtime.loaded === false ? "No" : "Loading unconfirmed"}</dd><dt>Original Apply</dt><dd>${applyState}</dd><dt>SDK behavior</dt><dd>${esc(brainBehavior(candidate.adoption))}</dd></dl>${apply?.error ? feedback(`${esc(apply.error.code)}: ${esc(apply.error.message)}`, "warning") : ""}${btn("Original request", "pi-request-detail", "small", `data-id="${esc(candidate.requestId)}"`)}`;
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
document.addEventListener('visibilitychange', () => { adapter.observePage(route()[1] || '', document.visibilityState === 'visible', route()[0] !== 'app'); });
window.addEventListener('pagehide', () => { adapter.observePage('', false); });
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
//# sourceMappingURL=app.js.map