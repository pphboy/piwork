import { editAdvanced, synchronizeConfiguration } from './configuration.js';
import { adapter, fileVersion } from "./adapter.js";
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
    logTime: "",
    logsExpanded: false,
    scrollPinned: true,
};
let importSignInSuspended = false;
let actionPending = false;
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
    }, 4500);
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
async function openWork(w) {
    await guard(async () => {
        await adapter.loadWork(w.id);
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
        render();
    });
}
function openModal(name, data = {}) {
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
    if (view.modal === "import")
        void adapter.abandonInspection();
    view.modal = "";
    view.modalError = "";
    render();
    lastFocus?.focus();
}
const phase = (op) => `<div class="phase-track">${["accepted", "preparing", "succeeded"].map((x, i) => `<div class="${op.state === x || op.state === "succeeded" ? "done" : ""}"><span>${op.state === "succeeded" ? icon("check", 14) : i + 1}</span>${["Accepted", "Preparing", "Completed"][i]}</div>`).join("")}</div>`;
function scenarioBar() { return ""; }
function brand() {
    return `<a href="#/works" class="brand" aria-label="piwork Works"><span class="brand-mark">p<span>i</span></span><b>piwork</b><span class="brand-product">Desktop</span></a>`;
}
function topbar() {
    return `<header class="topbar">${brand()}<div class="topbar-right">${btn(`${icon("clock")} <span>Known operations</span>`, "operations", "quiet")}${btn(`<span class="avatar">${esc(adapter.state.core.account.slice(0, 1).toUpperCase() || "?")}</span><span>${esc(adapter.state.core.account || "Account")}</span>${icon("down", 14)}`, "account", "account-button quiet")}</div></header>`;
}
function connection() {
    const s = adapter.state.scenario;
    return `<button class="connection" data-action="connection"><i class="${["core-offline", "env-not-ready"].includes(s) ? "warn" : ""}"></i>${esc(adapter.state.core.name)}<span>·</span>${s === "core-offline" ? "Unreachable" : s === "env-not-ready" ? "Runtime not ready" : "Connected"}${icon("down", 12)}</button>`;
}
function signIn() {
    const expired = adapter.state.scenario === "ticket-expired";
    return `${topbar()}<main class="auth-main"><div class="auth-symbol">${icon("lock", 26)}</div><h1>${expired ? "Open a fresh launch address" : "Connect to your Core"}</h1><p class="muted">${expired ? "Restart Desktop from the CLI and open its fresh launch address." : "Sign in with your Core account. Credentials stay with the local CLI."}</p>${view.toast ? feedback(esc(view.toast), "warning") : ""}${expired ? "<code>piwork-cli desktop</code>" : `<label class="field">Core address<input id="auth-core" value="${esc(view.coreAddress || adapter.state.core.address)}" placeholder="http://127.0.0.1:7181"></label><label class="field">Account<input id="auth-account" autocomplete="username"></label><label class="field">Password<input id="auth-password" type="password" autocomplete="current-password"></label>${btn("Sign in", "sign-in", "primary full")}`}<div class="auth-divider">Inspect a Work package locally before signing in</div>${expired ? "" : btn(`${icon("upload", 16)} Inspect a .work package`, "import", "quiet")}</main>`;
}
function works() {
    const s = adapter.state.scenario;
    const all = adapter.state.works.filter((w) => w.name.toLowerCase().includes(view.search.toLowerCase()));
    return `${topbar()}<main class="works-page"><div class="works-eyebrow">YOUR WORKSPACE</div><div class="page-heading"><div><h1>Works</h1><p>A place for your tools, files, and conversations.</p></div><div class="actions">${btn(`${icon("upload")} Import Work`, "import")}${btn(`${icon("plus")} New Work`, "new-work", "primary")}</div></div><div class="list-controls"><div class="search-box">${icon("search")}<input id="search" value="${esc(view.search)}" placeholder="Search your Works" aria-label="Search Works">${view.search ? btn(icon("close"), "clear-search", "icon-button quiet", 'aria-label="Clear search"') : ""}</div>${connection()}</div>${s === "core-offline" ? feedback(`Core is unreachable. Last confirmed ${esc(adapter.state.lastChecked)}. This is not a password error.`, "warning", btn("Check connection", "check-connection", "small")) : ""}${s === "env-not-ready" ? feedback("Core is reachable. The runtime is not ready; existing information is available.", "warning", btn("Check readiness", "check-connection", "small")) : ""}${s === "loading" ? `<div class="loading-list">${[1, 2, 3].map(() => '<div class="skeleton"></div>').join("")}<p>Loading your Works…</p>${btn("Check connection", "check-connection")}</div>` : s === "list-error" ? empty("refresh", "Works could not be loaded", "Your account is still signed in. Check the connection and try reading the list again.", btn("Retry loading", "check-connection", "primary")) : s === "empty" ? empty("grid", "Make room for your next idea", "Create a Work, then ask the Agent to build a tool or help with your files.", btn(`${icon("plus")} New Work`, "new-work", "primary")) : all.length ? `<div class="work-table"><div class="work-table-head"><span>NAME</span><span>STATUS</span><span>QUICK ACTION</span><span></span></div>${all.map((w) => `<div class="work-row"><button class="work-name" data-action="open-work" data-id="${w.id}"><span class="work-icon ${w.color}">${icon(w.icon, 22)}</span><span><strong>${esc(w.name)}</strong><small>${esc(w.description)}</small></span></button><div class="work-status">${badge(w.status)}${w.status === "Degraded" ? "<small>A capability needs attention</small>" : w.status === "Failed" ? `<small>${w.desired === "running" ? "Start failed" : "Stop not confirmed"}</small>` : w.status === "Unknown" ? `<small>Last confirmed ${esc(w.updated || "Not provided")}</small>` : ""}</div><div>${quickAction(w)}</div>${btn(icon("more"), "work-menu", "icon-button quiet", `data-id="${w.id}" aria-label="More options for ${esc(w.name)}"`)}</div>`).join("")}</div>` : empty("search", "No matching Works", "Try a different name.", btn("Clear search", "clear-search"))}<div class="works-footer"><span>${icon("lock", 14)} Only your own Works appear here</span><span>${adapter.state.works.length} Works <b>·</b> ${esc(adapter.state.core.account)}</span></div><div class="works-help"><span class="mini-symbol">${icon("spark", 19)}</span><div><strong>Start with an idea. Make something useful.</strong><p>Give your Work a goal, then build and use its tools alongside the Agent.</p></div>${btn("Create a Work", "new-work", "quiet")}</div></main>`;
}
function quickAction(w) {
    if (["Starting", "Stopping", "Unknown"].includes(w.status) ||
        (w.desired === "stopped" && w.status === "Failed"))
        return btn(`${icon("refresh", 15)} Check status`, "check-work", "quiet small", `data-id="${w.id}"`);
    if (w.status === "Stopped")
        return btn(`${icon("play", 15)} Start Work`, "start-work", "quiet small", `data-id="${w.id}"`);
    if (w.status === "Failed")
        return btn(`${icon("refresh", 15)} Retry Work`, "start-work", "quiet small", `data-id="${w.id}"`);
    return btn(`${icon("stop", 15)} Stop Work`, "stop-work", "quiet small", `data-id="${w.id}"`);
}
function workHeader(w, standalone = false) {
    return `<header class="work-header"><div class="work-header-main">${btn(icon("arrow", 19), standalone ? "back-work" : "back-works", "icon-button quiet", `aria-label="${standalone ? "Back to Work" : "Back to Works"}"`)}<span class="header-divider"></span><span class="work-icon small ${w.color}">${icon(w.icon, 19)}</span><h1 title="${esc(w.name)}">${esc(w.name)}</h1>${badge(w.status)}</div><div class="actions header-actions">${quickAction(w)}${btn(icon("more"), "work-menu", "icon-button quiet", `data-id="${w.id}" aria-label="Work options"`)}</div></header>`;
}
function workPage(w) {
    const settings = route()[2] === "settings";
    return `${workHeader(w)}<nav class="work-tabs" aria-label="Work areas"><div>${["Services", "Files", "Chat"].map((t) => btn(`${icon(t === "Services" ? "grid" : t === "Files" ? "folder" : "chat", 17)} ${t}`, `tab-${t}`, !settings && view.tab === t ? "tab active" : "tab")).join("")}</div>${btn(`${icon("settings", 17)} Settings`, "settings", settings ? "tab active" : "tab")}</nav>${w.status === "Degraded" ? `<div class="work-notice">${icon("info", 15)} Some capabilities need attention. Available Services remain usable. ${btn("View details", "manage-services", "text-button")}</div>` : ""}${settings ? settingsPage(w) : ["Stopped", "Starting", "Stopping", "Unknown", "Failed"].includes(w.status) ? workState(w) : view.tab === "Chat" ? `<div class="focus-chat">${agent(w, true)}</div>` : `<div class="work-layout ${view.agentOpen ? "agent-open" : ""}"><section class="main-panel">${view.tab === "Files" ? files(w) : services(w)}</section><aside class="agent-side">${agent(w, false)}</aside>${btn(`${icon("chat")} Agent`, "toggle-agent", "floating-agent")}</div>`}`;
}
function workState(w) {
    return `<main class="work-state">${empty(w.status === "Stopped" ? "stop" : w.status === "Failed" ? "info" : "clock", w.status === "Stopped" ? "This Work is stopped" : w.status === "Unknown" ? "Work status is unknown" : w.status === "Starting" ? "Starting your Work" : w.status === "Stopping" ? "Stopping your Work" : "This Work needs attention", w.status === "Stopped" ? "Your workspace data is preserved. Start the Work to use its Services, files, and Agent." : esc(w.error || `The ${w.status.toLowerCase()} phase has not reached a confirmed result. Check the original Operation.`), `<div class="actions">${quickAction(w)}${btn("Settings", "settings")}${w.status === "Stopped" ? btn(`${icon("download")} Export Work`, "export", "", `data-id="${w.id}"`) : btn("Operation details", "check-work", "", `data-id="${w.id}"`)}</div>`)}<p class="state-footnote">Desired: ${esc(w.desired)} · Observed: ${esc(w.status)} · Last checked ${esc(adapter.state.lastChecked)}</p></main>`;
}
function services(w) {
    const s = activeService(w);
    if (w.resourceErrors?.services)
        return feedback(esc(w.resourceErrors.services), "warning", btn("Check connection", "check-connection"));
    if (!s || !s.ports.length)
        return empty("grid", "No Web Service is ready", "Ask the Agent to build a tool. Service definitions are created by the Agent workflow.", btn("Focus chat", "tab-Chat", "primary"));
    const list = w.services.filter((x) => x.ports.length && x.observed !== "Removed");
    return `<div class="service-toolbar"><div class="service-selector"><span class="app-indicator">${icon("grid", 16)}</span><select id="service-select" aria-label="Service">${list.map((x) => `<option value="${x.id}" ${x.id === s.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select><select id="port-select" aria-label="Declared Web port">${s.ports.map((p) => `<option ${p === view.port ? "selected" : ""}>${p}</option>`).join("")}</select></div><div class="service-identity">${badge(s.observed)}<span class="domain" title="${esc(s.domain)}">${esc(s.domain)}</span></div><div class="actions">${btn(icon("external", 16), "open-app", "icon-button quiet", 'aria-label="Open application in new tab"')}${btn(icon("more"), "service-menu", "icon-button quiet", 'aria-label="Service options"')}</div></div>${adapter.serviceEmbed(w.id, s.id, view.port) === "denied" ? empty("external", "This app opens in its own tab", "The application’s security policy does not allow embedding. Its security policy remains unchanged.", btn(`${icon("external")} Open application tab`, "open-app", "primary")) : s.observed !== "Ready" ? empty("grid", `${esc(s.name)} is ${s.observed.toLowerCase()}`, esc(s.error || "This Service is disabled. Starting the Work does not re-enable it."), btn("Manage services", "manage-services", "primary")) : adapter.serviceEntryUrl(w.id, s.id, view.port) ? `<iframe data-service-key="${esc(`${w.id}:${s.id}:${view.port}`)}" class="real-service-frame" title="${esc(s.name)} application" src="${esc(adapter.serviceEntryUrl(w.id, s.id, view.port))}"></iframe>` : empty("grid", "Opening application", "Preparing a private browser entry for this Service.")}<div class="service-bottom"><span>${icon("lock", 13)} Private Service connection</span><span>Shared workspace ${icon("folder", 13)}</span></div>`;
}
function agent(w, focus) {
    const session = w.sessions.find((s) => s.id === view.session) || w.sessions[0];
    if (session)
        view.session = session.id;
    const run = w.run;
    const active = run && ["accepted", "running", "cancelling"].includes(run.status);
    const busy = active && run.sessionId !== session?.id;
    const draft = view.drafts[draftKey(w, session?.id || "")] || "";
    return `<section class="agent-panel ${focus ? "focused" : ""}"><div class="agent-header"><span class="agent-title">${icon("spark", 17)} <b>Agent</b></span><div>${btn(icon("clock", 16), "sessions", "icon-button quiet", 'aria-label="Sessions"')}${btn(icon(focus ? "grid" : "focus", 16), focus ? "return-service" : "focus-chat", "icon-button quiet", `aria-label="${focus ? "Return to Service" : "Focus chat"}"`)}${btn(icon("more", 17), "agent-menu", "icon-button quiet", 'aria-label="Agent options"')}</div></div><div class="session-line"><button data-action="sessions">${esc(session?.title || "No Session yet")}${icon("down", 12)}</button></div><div class="messages" id="messages">${!session?.messages.length ? `<div class="chat-welcome"><span class="chat-symbol">${icon("spark", 28)}</span><h2>What would you like to make?</h2><p>Build a tool, work with your files, or explore an idea together.</p><button data-action="suggest-message">Build a notes app ${icon("chevron", 15)}</button><button data-action="suggest-files">Help me explore my files ${icon("chevron", 15)}</button></div>` : session.messages.filter(m => m.text || m.tool).map((m) => `<div class="message ${m.role}">${m.role === "assistant" && !m.tool ? `<div class="message-author">${icon("spark", 14)} piwork</div>` : ""}<div class="message-text">${esc(m.text)}</div>${m.tool ? `<details class="tool-event"><summary>${icon("terminal", 14)} ${esc(m.tool.name)} <span>${esc(m.tool.status)}</span></summary><pre>${esc(m.tool.content)}</pre></details>` : ""}${m.source ? `<button class="source-chip" data-action="open-source" data-path="${esc(m.source)}">${icon("file", 13)} ${esc(m.source)}</button>` : ""}</div>`).join("")}${w.services.some((s) => s.observed === "Ready" && s.ports.length) && focus ? btn(`${icon("grid", 15)} Open service`, "return-service", "service-shortcut") : ""}</div>${view.scrollPinned ? "" : btn(`${icon("down", 14)} Back to latest`, "scroll-bottom", "back-latest")}<div class="composer-wrap">${w.resourceErrors?.agent ? feedback(esc(w.resourceErrors.agent), "warning", btn("Check connection", "check-connection", "small")) : ""}${session?.legacy ? feedback("This Session’s context is no longer compatible. Your draft is kept.", "warning", btn("New session", "new-session", "small")) : ""}${busy ? feedback("A Run is active in another Session. Your draft is kept.", "warning", btn("View active Run", "active-run", "small")) : ""}${run && (run.error || ["failed", "interrupted"].includes(run.status)) ? feedback(`${esc(run.error)}`, "warning", btn(["interrupted", "accepted", "running", "cancelling"].includes(run.status) ? "Resume original Run" : "Run details", ["interrupted", "accepted", "running", "cancelling"].includes(run.status) ? "resume-run" : "run-details", "small")) : ""}${run ? `<div class="run-strip"><button data-action="run-details"><i class="run-dot ${active ? "active" : ""}"></i>Run ${esc(run.status)} ${icon("chevron", 12)}</button>${active ? btn(run.status === "cancelling" ? "Cancelling…" : "Cancel run", "cancel-run", "text-button", run.status === "cancelling" ? "disabled" : "") : ""}</div>` : ""}<div class="composer"><textarea id="composer" rows="3" placeholder="Ask anything about this Work" aria-label="Message the Agent" ${session?.legacy ? 'aria-describedby="composer-help"' : ""}>${esc(draft)}</textarea><div class="composer-bottom"><label><input id="include-identity" type="checkbox" ${view.includeIdentity ? "checked" : ""}> Include Service identity</label>${btn(icon("send", 18), "send-message", "send-button", `aria-label="Send message" ${active || session?.legacy ? "disabled" : ""}`)}</div></div><div class="composer-caption" id="composer-help">${view.includeIdentity ? "Identity only. No page, cookies, or unsaved inputs." : "Agent uses saved files and reachable APIs when asked."}</div></div></section>`;
}
function files(w) {
    if (w.resourceErrors?.files)
        return feedback(esc(w.resourceErrors.files), "warning", btn("Refresh files", "refresh-files"));
    if (adapter.state.scenario === "files-failed")
        return empty("folder", "Workspace files are unavailable", "The file capability could not be reached. Available Services can still be used.", btn("Refresh files", "refresh-files", "primary"));
    const f = w.files.find((x) => x.path === view.file);
    const list = w.files.filter((x) => {
        const parent = x.path.slice(0, x.path.lastIndexOf("/")) || "/";
        return parent === view.path;
    });
    return `<div class="files-toolbar"><div class="breadcrumbs"><button data-action="file-path" data-path="/">${icon("folder", 16)} Workspace</button>${view.path
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
    return adapter.state.transfers.length
        ? `<section class="transfer-results"><h3>Transfer results <span>${adapter.state.transfers.some((r) => r.status !== "succeeded") ? "Some paths need attention" : ""}</span></h3>${adapter.state.transfers.map((r) => `<div class="transfer-row">${icon(r.status === "succeeded" ? "check" : "info", 14)}<code>${esc(r.path)}</code><span>${esc(r.message)}</span></div>`).join("")}${adapter.state.transfers.some((r) => r.status === "unknown") ? btn("Refresh to verify target", "refresh-files", "small") : ""}</section>`
        : "";
}
function textEditor(f) {
    const editable = view.fileEditable;
    return `<div class="editor-toolbar">${btn(`${icon("arrow", 16)} Back to files`, "close-file", "quiet small")}<strong>${esc(f.name)}</strong>${badge(dirty() ? "Unsaved" : "Saved")}</div>${editable ? `${!view.fileBaseline ? feedback("No modification time is available. Concurrent changes cannot be protected.", "warning", btn("Allow unprotected overwrite", "allow-unprotected-file", "small")) : ""}${view.fileWriteUncertain ? feedback("The previous write needs review. Reread the target before saving again.", "warning", btn("Reread saved version", "refresh-files", "small")) : ""}${view.fileReread ? `<section class="file-reread"><h3>Current saved version · read only</h3><pre>${esc(view.fileReread.content ?? "This target is no longer editable text.")}</pre>${btn("Overwrite this reread version", "use-reread-version", "small", view.fileReread.kind === "text" ? "" : "disabled")}</section>` : ""}<textarea id="file-editor" class="file-editor" spellcheck="false" aria-label="Edit ${esc(f.name)}">${esc(view.fileDraft)}</textarea><div class="editor-footer"><span>UTF-8 · ${size(new TextEncoder().encode(view.fileDraft).length)} / 1 MiB limit · Version checks have second precision</span><div class="actions">${btn("Discard", "discard-file", "quiet", dirty() ? "" : "disabled")}${btn("Save file", "save-file", "primary", dirty() ? "" : "disabled")}</div></div>` : empty(f.kind === "special" ? "terminal" : "file", f.kind === "special" ? "This is a special filesystem item" : f.kind === "binary" ? "Download to open this binary file" : f.kind === "file" ? "Open this file to inspect its contents" : "This file exceeds the editing limit", f.kind === "special" ? "Special items cannot be treated as ordinary editable files." : "The in-browser editor supports UTF-8 text up to 1 MiB.", f.kind === "special" ? "" : btn(`${icon("download")} Download file`, "download-file", "primary", `data-path="${esc(f.path)}"`))}`;
}
function settingsPage(w) {
    if (w.resourceErrors?.configuration)
        return feedback(esc(w.resourceErrors.configuration), "warning", btn("Refresh configuration", "refresh-config", "primary"));
    if (!view.config)
        view.config = structuredClone(w.config);
    const c = view.config, pending = w.config.pendingApply === true;
    return `<main class="settings-page"><div class="settings-heading"><div><h1>Work settings</h1><p>Shape what this Work can do.</p></div>${btn(`${icon("arrow", 16)} Back to Work`, "back-work", "quiet")}</div><div class="configuration-state"><div><strong>${view.configDirty ? "Unsaved changes" : pending ? "Saved changes" : "Configuration in use"}</strong><span>${view.configDirty ? "Save your draft before applying it." : pending ? "Not applied · Your running configuration is unchanged." : "Saved and active configuration are aligned"}</span></div><div class="actions">${btn(`${icon("refresh", 15)} Refresh status`, "refresh-config", "quiet small")}${view.configDirty ? btn("Save changes", "save-config", "") : btn("Apply changes", "apply-config", pending ? "primary" : "", pending ? "" : "disabled")}</div></div><nav class="settings-tabs">${["Skills", "Pi Packages", "AGENTS.md", "Advanced"].map((t) => btn(t, "settings-section", view.settingsTab === t ? "tab active" : "tab", `data-tab="${t}"`)).join("")}</nav><div class="settings-content">${view.settingsTab === "Skills" ? skillsSettings(w, c) : view.settingsTab === "Pi Packages" ? packagesSettings(w, c) : view.settingsTab === "AGENTS.md" ? `<div class="section-heading"><div><h2>Instructions for your Agent</h2><p>AGENTS.md is included with this Work’s capability configuration.</p></div>${btn(`${icon("upload", 15)} Import file`, "import-agents", "small")}</div><div class="config-labels"><span>${w.config.pendingApply ? "Previous active configuration" : "Configuration in use"}</span><span>Saved configuration</span></div><label class="field">Desired AGENTS.md<textarea id="agents-editor" class="code-editor" rows="13">${esc(c.agents)}</textarea></label><details class="details-box"><summary>Current active content</summary><pre>${esc(w.config.active?.agentsMd ?? "No active configuration is reported")}</pre></details>` : `<div class="section-heading"><div><h2>Advanced configuration</h2><p>Public runtime configuration. Platform secrets are never displayed.</p></div>${btn(`${icon("upload", 15)} Import JSON`, "import-json", "small")}</div><label class="field">Configuration JSON<textarea id="advanced-editor" aria-label="Configuration JSON" class="code-editor" rows="17" spellcheck="false">${esc(c.advanced)}</textarea></label>${c.validationError ? feedback(esc(c.validationError), "warning") : ""}<p class="muted">Includes the image, model reference, MCP, resources, and tool policy. Validate against the current Core contract before production use.</p>`}</div>${view.configDirty ? `<div class="settings-savebar"><span>You have unsaved changes</span><div class="actions">${btn("Discard changes", "discard-config")}${btn("Save changes", "save-config", "primary")}</div></div>` : ""}</main>`;
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
        case "account":
            title = "Your account";
            body = `<div class="identity-block"><span class="avatar large">${esc(adapter.state.core.account.slice(0, 1).toUpperCase())}</span><div><strong>${esc(adapter.state.core.account)}</strong><p>${esc(adapter.state.core.account)}</p></div></div><dl><dt>Role</dt><dd>${esc(adapter.state.core.role)}</dd><dt>Core</dt><dd>${esc(adapter.state.core.address)}</dd></dl><p class="muted">Desktop only shows the Works owned by this account.</p>`;
            footer = `${btn("Switch Core", "switch-core")}${btn("Sign out", "sign-out", "danger")}`;
            break;
        case "connection":
            title = "Core connection";
            body = `<dl><dt>Core</dt><dd>${esc(adapter.state.core.address)}</dd><dt>Last checked</dt><dd>${esc(adapter.state.lastChecked || "Not provided")}</dd></dl><h3>Capabilities</h3><div class="status-grid">${[["Core", adapter.status.health], ["Runtime", adapter.status.readiness], ["Services", adapter.status.service], ["Files", adapter.status.files]].map(([name, state]) => `<span>${name} ${badge(state?.available ? "Available" : "Unavailable")}</span>`).join("")}</div><p class="muted">Reachability and capability availability are reported separately.</p>`;
            footer = `${btn("Switch Core", "switch-core")}${btn("Check connection", "check-connection", "primary")}`;
            break;
        case "switch-core":
            title = "Switch Core";
            body = `<p>Choose a Core and continue with its own account. Known operations remain isolated by Core and user.</p><label class="field">Core address<input id="auth-core" value="${esc(view.coreAddress)}"></label><p class="muted">Switching Core clears the current view and verifies any stored account for the new Core.</p>`;
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
            footer = close();
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
            body = `<p>Conversations within ${esc(target?.name)}. Switching Sessions does not stop an active Run.</p><div class="session-list">${target?.sessions.map((s) => `<button data-action="select-session" data-id="${s.id}" class="${s.id === view.session ? "selected" : ""}"><span>${icon("chat", 17)}${esc(s.title)}</span>${target.run?.sessionId === s.id ? badge(target.run.status) : s.id === view.session ? icon("check", 16) : ""}</button>`).join("") || "<p>No Sessions yet.</p>"}</div>`;
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
            footer = `${close()}${target?.run?.status === "interrupted" ? btn("Resume original Run", "resume-run", "primary") : target?.run && ["accepted", "running", "cancelling"].includes(target.run.status) ? btn(target.run.status === "cancelling" ? "Cancelling…" : "Cancel run", "cancel-run", "danger", target.run.status === "cancelling" ? "disabled" : "") : ""}`;
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
            title = esc(view.data.id);
            body = `<pre class="code-editor">${esc(JSON.stringify(target?.packageEntries?.find(p => p.name === view.data.id) ?? p ?? { name: view.data.id }, null, 2))}</pre><p class="muted">Installed, selected, active, and loaded states are reported separately.</p>`;
            footer = close();
            break;
        }
        case "install-package":
            title = view.data.update ? "Update package source" : "Install Pi Package";
            body = `<p>Choose the package source explicitly. Installing does not mean the model has loaded it.</p><label class="field">Source type<select id="install-type">${["Core", "npm", "Git", "Local directory", "ZIP"].map((t) => `<option ${view.installType === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>${view.installType === "Core"
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
            body = `<p>Create a full <code>.work</code> package, including the format-defined persistent workspace data.</p>${(target?.status !== "Stopped" || target?.desired !== "stopped") ? feedback("Stop this Work explicitly, then return here to prepare the package. Export never stops a Work automatically.", "warning") : `${feedback("Work is confirmed stopped. Preparing a package will not start it.", "success")}`}${snap ? `<div class="export-snapshot"><h3>Original snapshot</h3><dl><dt>Snapshot ID</dt><dd><code>${snap.id}</code></dd><dt>Operation</dt><dd><button class="inline-link" data-action="operation" data-id="${snap.operationId}">${snap.operationId}</button></dd><dt>Status</dt><dd>${badge(op?.state === "failed" ? "Failed" : snap.status)}</dd></dl>${snap.status === "expired" ? feedback("This snapshot expired. Check the original snapshot ID. Prepare another package explicitly when ready.", "warning") : ""}${op?.error ? feedback(esc(op.error), "warning") : ""}${snap.status === "verified" ? '<p class="muted">Snapshot is verified. Download validates and saves the actual .work archive.</p>' : ""}</div>` : ""}`;
            footer = `${close()}${(target?.status !== "Stopped" || target?.desired !== "stopped") ? btn("Stop Work first", "stop-work", "danger", `data-id="${target?.id}"`) : snap?.status === "verified" ? btn(`${icon("download")} Download .work`, "download-work", "primary", `data-id="${snap.id}"`) : btn("Prepare .work package", "prepare-export", "primary", `data-id="${target?.id}" ${snap && ["preparing", "validating"].includes(snap.status) && op?.state !== "failed" ? "disabled" : ""}`)}`;
            break;
        }
        case "import":
            title = "Import Work";
            body = `<p>Inspect the actual <code>.work</code> package using the local CLI. No file is sent to Core until you confirm import.</p><div class="file-drop">${icon("upload", 28)}<strong>${esc(view.inspectFilename || "Choose a Work package")}</strong>${btn("Choose .work file", "choose-work-file", "", adapter.inspectionContext && adapter.inspectionContext.importState !== "unsubmitted" ? "disabled" : "")}</div>${adapter.transferProgress ? feedback(`Transfer: ${esc(adapter.transferProgress.phase)} · ${esc(adapter.transferProgress.transferred ?? 0)} / ${esc(adapter.transferProgress.total ?? "unknown")} bytes`) : ""}${adapter.inspection ? `${feedback("Package format and contents verified locally.", "success")}<div class="inspection-summary"><h3>Verified package summary</h3><pre>${esc(JSON.stringify(adapter.inspection, null, 2))}</pre><p>Import creates a stopped Work. Private files may contain business data or credentials. No code starts automatically.</p></div><label class="field">Work name <span>Optional</span><input id="import-name" value="${esc(view.importName)}" placeholder="Leave blank to use the package name"></label>` : ""}`;
            body += adapter.inspectionContext && adapter.inspectionContext.importState !== "unsubmitted" ? feedback(`Original import: ${esc(adapter.inspectionContext.importState)} · <code>${esc(adapter.inspectionTransfer)}</code>. Check known operations; closing does not cancel or resubmit it.`, "warning", btn("Check original import", "check-inspection-import", "small") + btn("Known operations", "operations", "small")) : "";
            footer = `${cancel()}${adapter.inspection && adapter.inspectionContext?.importState === "unsubmitted" ? btn(adapter.state.signedIn ? "Import Work" : "Sign in to import", adapter.state.signedIn ? "confirm-import" : "import-sign-in", "primary") : ""}`;
            break;
        case "operations": {
            title = "Known operations";
            const scope = `${adapter.state.core.address} · ${adapter.state.core.account}`;
            const operations = adapter.state.operations.filter((o) => o.scope === scope);
            body = `<p>Records known by this local CLI, for the current Core and account. This is not a global server history.</p><label class="field">Find an Operation by ID<div class="input-action"><input id="operation-query" value="${esc(view.operationQuery)}" placeholder="op-…">${btn("Check status", "lookup-operation")}</div></label><label class="field">Find an original snapshot ID<div class="input-action"><input id="snapshot-query" value="${esc(view.snapshotQuery)}" placeholder="snapshot-…">${btn("Find snapshot", "lookup-snapshot")}</div></label><div class="operation-list">${operations.length ? operations.map((op) => `<button data-action="operation" data-id="${op.id}"><span>${icon("clock", 17)}<span><strong>${esc(op.kind)}</strong><small>${op.id} · ${op.updated}</small></span></span>${badge(op.state)}</button>`).join("") : '<p class="muted">No operations are known in this Desktop session.</p>'}</div><p class="muted">Records contain IDs and status only. The CLI stores minimal Operation IDs for the current Core and account. Clearing completed records does not cancel server work.</p>`;
            footer = `${btn("Clear local records", "clear-operations", "quiet", operations.length ? "" : "disabled")}${close()}`;
            break;
        }
        case "operation": {
            const op = adapter.state.operations.find((o) => o.id === view.data.id);
            title = op ? esc(op.kind) : "Operation not found";
            body = op
                ? `${phase(op)}${feedback(`${esc(op.phase)}. ${op.state === "accepted" || op.state === "preparing" ? "Accepted does not mean completed. Closing this dialog will not cancel it." : op.state === "unknown" ? "Check this original Operation; do not repeat the request." : op.state === "succeeded" ? "The original Operation reached a confirmed result." : ""}`, op.state === "failed" ? "warning" : op.state === "succeeded" ? "success" : "info")}<dl><dt>Operation ID</dt><dd><code>${op.id}</code>${btn(icon("copy", 14), "copy", "icon-button quiet", `data-copy="${op.id}" aria-label="Copy Operation ID"`)}</dd><dt>Work ID</dt><dd><code>${op.workId}</code></dd><dt>State</dt><dd>${badge(op.state)}</dd><dt>Last confirmed</dt><dd>${op.updated}</dd>${op.snapshotId ? `<dt>Snapshot ID</dt><dd><code>${op.snapshotId}</code></dd>` : ""}</dl>${op.error ? feedback(esc(op.error), "warning") : ""}`
                : "<p>This Operation is not known for the current Core and user. Verify the ID or check the original Work.</p>";
            footer = `${close()}${op ? btn("Check status", "check-operation", "", `data-id="${op.id}"`) : ""}${op && !["succeeded", "failed", "superseded"].includes(op.state) ? btn(adapter.operationPaused(op.id) ? "Resume checking" : "Pause checking", adapter.operationPaused(op.id) ? "resume-operation" : "pause-operation", "", `data-id="${op.id}"`) : ""}${op?.state === "succeeded" && op.kind === "Import Work" ? `${btn("Open Work", "open-work", "primary", `data-id="${op.workId}"`)}${btn("Start Work", "start-work", "", `data-id="${op.workId}"`)}` : op?.state === "succeeded" && op.kind === "Create Work" ? btn("Open Work", "open-work", "primary", `data-id="${op.workId}"`) : op?.snapshotId ? btn("View package", "export", "primary", `data-id="${op.workId}"`) : ""}`;
            break;
        }
    }
    return `<dialog id="modal" aria-labelledby="modal-title" class="modal ${["new-work", "import", "manage-services", "operations", "service-details"].includes(view.modal) ? "wide" : ""}"><div class="modal-head"><h2 id="modal-title">${title}</h2>${btn(icon("close", 20), "close-modal", "icon-button quiet", 'aria-label="Close dialog"')}</div><div class="modal-body">${view.modalError ? feedback(esc(view.modalError), "warning") : ""}${body}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ""}</dialog>`;
}
function serviceDetails(s, w) {
    return `<dl><dt>Domain</dt><dd><code>${esc(s.domain)}</code></dd><dt>Declared Web ports</dt><dd>${s.ports.length ? s.ports.join(", ") : "No Web ports declared"}</dd><dt>Enabled</dt><dd>${s.enabled ? "Yes" : "No · persists across Work restarts"}</dd><dt>Observed</dt><dd>${badge(s.observed)}</dd>${s.operationId ? `<dt>Operation</dt><dd><button class="inline-link" data-action="operation" data-id="${s.operationId}">${s.operationId}</button></dd>` : ""}</dl>${s.error ? feedback(esc(s.error), "warning") : ""}<div class="service-controls">${btn("Start", "service-action", "small", `data-control="start" data-id="${s.id}" ${w.status === "Stopped" || s.observed === "Ready" ? "disabled" : ""}`)}${btn("Stop", "service-action", "small", `data-control="stop" data-id="${s.id}" ${w.status === "Stopped" || !s.enabled ? "disabled" : ""}`)}${btn("Restart", "service-action", "small", `data-control="restart" data-id="${s.id}" ${!s.enabled || s.observed !== "Ready" ? "disabled" : ""}`)}${btn("Retry", "service-action", "small", `data-control="retry" data-id="${s.id}" ${!s.enabled || s.observed !== "Failed" ? "disabled" : ""}`)}${btn("Remove", "service-action", "small danger", `data-control="remove" data-id="${s.id}"`)}</div><div class="logs-heading"><h3>Log snapshot</h3>${btn(`${icon("refresh", 14)} Refresh logs`, "refresh-logs", "small")}</div><pre class="logs">${esc(adapter.logs.get(s.id)?.text ?? adapter.logs.get(s.id)?.reason ?? "Logs have not been retrieved.")}</pre><p class="muted small-text">${esc(adapter.logs.get(s.id)?.status ?? "Not retrieved")} · Collected ${esc(adapter.logs.get(s.id)?.collectedAt ?? "Not provided")} · ${adapter.logs.get(s.id)?.truncated ? "Output truncated" : "Bounded snapshot"}. This is not a live stream.</p>`;
}
let focusReturn = "";
function focusKey(el) {
    if (!el)
        return "";
    if (el.id)
        return "#" + CSS.escape(el.id);
    const action = el.dataset.action;
    if (action)
        return `[data-action="${CSS.escape(action)}"]${el.dataset.id ? `[data-id="${CSS.escape(el.dataset.id)}"]` : ""}${el.dataset.path ? `[data-path="${CSS.escape(el.dataset.path)}"]` : ""}`;
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
function targetWork(el) {
    return (adapter.getWork(el.dataset.id || view.data.workId || view.data.id || route()[1]) || current());
}
async function saveFile() {
    const w = current();
    if (!w)
        return false;
    if (view.fileWriteUncertain)
        throw new Error("Reread the saved version and explicitly approve its baseline before retrying.");
    const content = view.fileDraft;
    const result = await adapter.saveFile(w.id, view.file, content, view.fileBaseline, view.fileUnprotected);
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
async function saveConfig() {
    const w = current();
    if (!w || !view.config)
        return false;
    if (!validateConfigDraft())
        return false;
    await adapter.saveConfiguration(w.id, view.config);
    view.config = structuredClone(w.config);
    view.configDirty = false;
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
async function handleAction(action, el) {
    const w = targetWork(el);
    const currentWork = current();
    const s = currentWork ? activeService(currentWork) : undefined;
    switch (action) {
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
                await openWork(w);
            }
            break;
        case "clear-search":
            view.search = "";
            render();
            break;
        case "operations":
            await adapter.recoverOperations();
            openModal("operations");
            break;
        case "account":
        case "connection":
        case "new-work":
        case "import":
        case "agent-menu":
        case "sessions":
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
        case "switch-core":
            openModal("switch-core");
            break;
        case "sign-in": {
            const account = root.querySelector("#auth-account")?.value ?? "";
            const password = root.querySelector("#auth-password")?.value ?? "";
            await adapter.signIn(view.coreAddress || adapter.state.core.address, account, password);
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
            const confirmed = await adapter.signOut();
            view.drafts = {};
            view.config = null;
            view.configDirty = false;
            view.file = "";
            closeModal();
            toast(confirmed ? "Signed out." : "Local access ended. Remote revocation could not be confirmed.");
            break;
        }
        case "reconnect":
            toast("Start piwork-cli desktop and open the fresh launch address.");
            break;
        case "confirm-switch-core":
            await adapter.switchCore(view.coreAddress);
            view.drafts = {};
            view.config = null;
            view.configDirty = false;
            closeModal();
            break;
        case "check-connection":
            await adapter.checkConnection();
            toast("Connection checked.");
            break;
        case "start-work":
            if (w)
                runAndShow(await adapter.lifecycle(w.id, w.status === "Failed" ? "retry" : "start"));
            break;
        case "confirm-stop":
            if (w)
                runAndShow(await adapter.lifecycle(w.id, "stop"));
            break;
        case "confirm-delete":
            if (w) {
                const op = await adapter.lifecycle(w.id, "delete");
                await adapter.listWorks().catch(() => undefined);
                history.replaceState(null, "", location.pathname + location.search + "#/works");
                lastRoute = location.hash;
                runAndShow(op);
            }
            break;
        case "check-work":
            if (w?.operationId)
                openModal("operation", { id: w.operationId });
            else {
                await adapter.checkConnection();
                toast("Work status checked.");
            }
            break;
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
            const op = await adapter.createWork(view.createName.trim(), config, view.createImage);
            runAndShow(op);
            break;
        }
        case "settings":
            if (w) {
                await guard(async () => {
                    await adapter.loadConfiguration(w.id);
                    view.config = structuredClone(w.config);
                    view.configDirty = false;
                    view.modal = "";
                    location.hash = `/work/${w.id}/settings`;
                    render();
                });
            }
            break;
        case "tab-Services":
        case "tab-Files":
        case "tab-Chat":
            await guard(async () => {
                view.tab = action.slice(4);
                if (action === "tab-Services" && currentWork) {
                    await adapter.loadServices(currentWork.id);
                    const service = activeService(currentWork);
                    if (service) {
                        view.service = service.id;
                        view.port = service.ports.includes(view.port) ? view.port : service.ports[0] || 0;
                        if (view.port && service.observed === "Ready")
                            await adapter.ensureServiceEntry(currentWork.id, service.id, view.port);
                    }
                }
                if (action === "tab-Files" && currentWork)
                    await adapter.loadDirectory(currentWork.id, view.path);
                view.tab = action.slice(4);
                view.modal = "";
                view.file = "";
                if (route()[2])
                    location.hash = `/work/${currentWork?.id}`;
                render();
            });
            break;
        case "focus-chat":
        case "return-service":
            await guard(() => {
                view.tab = action === "focus-chat" ? "Chat" : "Services";
                view.modal = "";
                render();
            });
            break;
        case "toggle-agent":
            view.agentOpen = !view.agentOpen;
            render();
            break;
        case "select-session":
            view.session = el.dataset.id;
            if (currentWork)
                await adapter.loadSession(currentWork.id, view.session);
            closeModal();
            break;
        case "new-session":
            if (currentWork) {
                view.session = await adapter.newSession(currentWork.id);
                closeModal();
                render();
            }
            break;
        case "suggest-message":
        case "suggest-files":
            if (currentWork) {
                if (!view.session)
                    view.session = await adapter.newSession(currentWork.id);
                view.drafts[draftKey(currentWork)] =
                    action === "suggest-message"
                        ? "Build a simple notes app and save its data in the shared workspace."
                        : "List the shared workspace files and help me analyze the data I choose.";
                render();
                root.querySelector("#composer")?.focus();
            }
            break;
        case "send-message":
            if (currentWork) {
                const originalKey = draftKey(currentWork);
                const text = view.drafts[originalKey] || "";
                if (!view.session)
                    view.session = await adapter.newSession(currentWork.id);
                adapter.selectedService = view.service;
                await adapter.send(currentWork.id, view.session, text, view.includeIdentity);
                view.drafts[draftKey(currentWork)] = "";
                view.drafts[originalKey] = "";
                view.scrollPinned = true;
                render();
            }
            break;
        case "cancel-run":
            if (currentWork)
                await adapter.cancelRun(currentWork.id);
            break;
        case "resume-run":
            if (currentWork)
                void adapter.resumeRun(currentWork.id);
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
                    view.tab = "Files";
                    await openFile(currentWork, el.dataset.path);
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
                if (adapter.serviceEmbed(currentWork.id, s.id, view.port) === "denied") {
                    const opened = window.open("about:blank", "_blank");
                    if (!opened)
                        throw new Error("Allow this browser to open the application tab, then try again.");
                    opened.opener = null;
                    try {
                        opened.location.href = await adapter.directServiceURL(currentWork.id, s.id, view.port);
                    }
                    catch (error) {
                        opened.close();
                        throw error;
                    }
                    closeModal();
                    break;
                }
                window.open(adapter.localLink(currentWork.id, s.id, view.port), "_blank", action === "open-window"
                    ? "noopener,noreferrer,width=1120,height=820"
                    : "noopener,noreferrer");
                closeModal();
            }
            break;
        case "service-details":
            if (currentWork)
                await adapter.readLogs(currentWork.id, el.dataset.id);
            openModal("service-details", { serviceId: el.dataset.id });
            break;
        case "service-action": {
            const control = el.dataset.control;
            if (control === "stop" || control === "remove")
                openModal("service-control", { serviceId: el.dataset.id, control });
            else if (currentWork)
                runAndShow(await adapter.operateService(currentWork.id, el.dataset.id, control));
            break;
        }
        case "confirm-service-control":
            if (currentWork)
                runAndShow(await adapter.operateService(currentWork.id, view.data.serviceId, view.data.control));
            break;
        case "refresh-logs":
            if (currentWork)
                await adapter.readLogs(currentWork.id, view.data.serviceId);
            render();
            break;
        case "refresh-files":
            if (currentWork) {
                await adapter.loadDirectory(currentWork.id, view.path);
                if (view.file)
                    await adapter.readFile(currentWork.id, view.file);
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
                    await adapter.loadDirectory(currentWork.id, el.dataset.path);
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
                    await openFile(currentWork, path);
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
            await saveFile();
            break;
        case "dirty-discard":
            view.fileDraft = view.fileOriginal;
            view.modal = "";
            await pendingNav?.();
            pendingNav = null;
            render();
            break;
        case "dirty-save":
            if (await saveFile()) {
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
                const results = await adapter.upload(currentWork.id, view.path, pendingUploadFiles, true);
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
                await adapter.transfer(currentWork.id, "mkdir", ["new-folder"], joinPath(view.path, name));
                await adapter.loadDirectory(currentWork.id, view.path);
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
                    all.push(...await adapter.transfer(currentWork.id, view.data.transfer === "copy" ? "copy" : "move", [paths[i]], destinations[i], view.formOverwrite));
                await adapter.loadDirectory(currentWork.id, view.path);
                adapter.state.transfers = all;
                await adapter.loadDirectory(currentWork.id, view.path);
                view.selected = [];
                closeModal();
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
                await adapter.transfer(currentWork.id, "delete", decodePaths(view.data.paths));
                await adapter.loadDirectory(currentWork.id, view.path);
                view.selected = [];
                closeModal();
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
            await saveConfig();
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
            if (await saveConfig()) {
                view.modal = "";
                await pendingNav?.();
                pendingNav = null;
                render();
            }
            break;
        case "apply-config":
            if (currentWork)
                runAndShow(await adapter.applyConfiguration(currentWork.id));
            break;
        case "refresh-config":
            if (currentWork) {
                await adapter.loadConfiguration(currentWork.id);
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
                await adapter.replaceSkill(currentWork.id, view.data.id);
                view.config = structuredClone(currentWork.config);
                view.configDirty = false;
                closeModal();
                toast("Current Core copies saved. Apply changes to load them.");
            }
            break;
        case "check-catalog":
            const available = await adapter.checkCatalog();
            toast(available ? "Core catalogs confirmed. Existing selections preserved." : `Catalog check incomplete: ${[adapter.catalog.skills.error, adapter.catalog.packages.error].filter(Boolean).join(" ")}`);
            break;
        case "skill-detail":
        case "package-detail":
            openModal(action, { id: el.dataset.id });
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
                runAndShow(await adapter.removePackage(currentWork.id, view.data.id));
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
                runAndShow(await adapter.installPackage(currentWork.id, name, `${view.installType}: ${view.installType === "Core" ? "current Core copy" : view.installSource}`, packageFiles, view.data.updateTarget));
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
            await adapter.checkInspectionImport();
            break;
        case "retry-inspection-cleanup":
            await adapter.cleanupInspection(el.dataset.id);
            break;
        case "confirm-import":
            runAndShow(await adapter.importWork(view.importName.trim()));
            break;
        case "prepare-export":
            if (w)
                runAndShow(await adapter.prepareExport(w.id));
            break;
        case "download-work":
            downloadURL(await adapter.downloadSnapshot(el.dataset.id));
            break;
        case "operation":
            openModal("operation", { id: el.dataset.id });
            break;
        case "pause-operation":
            adapter.pauseOperation(el.dataset.id);
            render();
            break;
        case "resume-operation":
            adapter.resumeOperation(el.dataset.id);
            render();
            break;
        case "check-operation":
            await adapter.checkOperation(el.dataset.id);
            break;
        case "lookup-operation": {
            const op = await adapter.checkOperation(view.operationQuery.trim());
            if (op)
                openModal("operation", { id: op.id });
            else
                throw Error("Operation not found for this Core and user. Verify the original ID.");
            break;
        }
        case "lookup-snapshot": {
            const snap = await adapter.fetchSnapshot(view.snapshotQuery.trim());
            if (snap)
                openModal("export", { id: snap.workId });
            else
                throw Error("Snapshot not found. Check its exact original ID and Core.");
            break;
        }
        case "clear-operations":
            await adapter.clearOperations();
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
    await adapter.readFile(w.id, path);
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
    if (view.config && !view.config.advancedDirty)
        synchronizeConfiguration(view.config);
    const active = document.activeElement;
    const activeKey = focusKey(active);
    const selection = active && "selectionStart" in active ? active.selectionStart : null;
    const messages = root.querySelector("#messages");
    const scroll = messages?.scrollTop || 0;
    const modalScroll = root.querySelector(".modal-body")?.scrollTop || 0;
    const r = route();
    let html = "";
    if (adapter.state.scenario === "cli-closed")
        html = `${topbar()}<main class="auth-main">${empty("terminal", "Desktop’s local connection has closed", "Start piwork-cli desktop again, then open its new launch address. A browser-only retry cannot restart the CLI.", "")}</main>`;
    else if (!adapter.state.signedIn ||
        adapter.state.scenario === "ticket-expired")
        html = signIn();
    else if (r[0] === "app") {
        const w = adapter.getWork(r[1]);
        if (w) {
            view.service = r[2];
            view.port = Number(r[3]) || 3000;
            html = `${workHeader(w, true)}<div class="standalone-label">Independent application window · Closing this tab does not stop the Service</div><main class="standalone-app">${w.status === "Stopped" ? workState(w) : services(w)}</main>`;
        }
        else
            html = works();
    }
    else if (r[0] === "work") {
        const w = adapter.getWork(r[1]);
        html = w
            ? workPage(w)
            : `${topbar()}${empty("grid", "Work not found", "Return to your Works to choose an available Work.", btn("Back to Works", "back-works", "primary"))}`;
    }
    else
        html = works();
    reconcileHTML(root, `${html}${[...adapter.cleanupPending].map(([id, pending]) => feedback(`${esc(pending.message)} <code>${esc(id)}</code>`, "warning", btn("Retry cleanup", "retry-inspection-cleanup", "small", `data-id="${esc(id)}"`))).join("")}<div id="toast" class="toast ${view.toast ? "visible" : ""}" role="status" aria-live="polite">${icon("check", 17)}${esc(view.toast)}</div>${view.modal ? modalMarkup() : ""}<input type="file" id="upload-input" multiple hidden><input type="file" id="agents-input" accept=".md,.txt" hidden><input type="file" id="create-agents-input" accept=".md,.txt" hidden><input type="file" id="json-input" accept=".json" hidden><input type="file" id="work-file-input" accept=".work" hidden><input type="file" id="package-zip-input" accept=".zip" hidden><input type="file" id="package-directory-input" webkitdirectory multiple hidden>`);
    for (const frame of root.querySelectorAll('iframe[data-service-key]'))
        if (!frame.dataset.observed) {
            frame.dataset.observed = 'true';
            frame.addEventListener('load', () => { const [workId, serviceId, port] = frame.dataset.serviceKey.split(':'); void adapter.serviceFrameLoaded(workId, serviceId, Number(port)).catch(error => toast(error.message)); });
        }
    if (actionPending)
        for (const button of root.querySelectorAll("button[data-action]"))
            button.disabled = true;
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
        if (replacement && (!dialog || dialog.contains(replacement))) {
            replacement.focus({ preventScroll: true });
            if (selection !== null &&
                replacement.setSelectionRange &&
                replacement.type !== "checkbox")
                try {
                    replacement.setSelectionRange(selection, selection);
                }
                catch { }
        }
    }
    const next = root.querySelector("#messages");
    if (next) {
        next.scrollTop = view.scrollPinned ? next.scrollHeight : scroll;
        if (!next.dataset.scrollBound) {
            next.dataset.scrollBound = "true";
            next.addEventListener("scroll", () => {
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
    if (!el || el.hasAttribute("disabled") || actionPending)
        return;
    actionPending = true;
    for (const button of root.querySelectorAll("button[data-action]"))
        button.disabled = true;
    if (!view.modal)
        focusReturn = focusKey(el);
    void handleAction(el.dataset.action, el).catch((error) => {
        if (view.modal) {
            view.modalError = error instanceof Error ? error.message : String(error);
            render();
        }
        else
            toast(error instanceof Error ? error.message : String(error));
    }).finally(() => { actionPending = false; el.removeAttribute("disabled"); render(); });
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
            if (work)
                view.drafts[draftKey(work)] = value;
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
            view.service = value;
            view.port = w?.services.find((s) => s.id === value)?.ports[0] || 3000;
            if (w && view.port)
                void adapter.ensureServiceEntry(w.id, view.service, view.port).catch(error => toast(error.message));
            render();
            break;
        case "port-select":
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
    if (input instanceof HTMLInputElement && input.type === "file")
        void handleFiles(input).catch((err) => {
            view.modalError = String(err.message || err);
            toast(view.modalError);
        });
});
async function handleFiles(input) {
    const files = Array.from(input.files || []);
    if (!files.length)
        return;
    const w = current();
    if (input.id === "upload-input" && w) {
        const results = await adapter.upload(w.id, view.path, files);
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
            throw Error("This configuration file is not valid UTF-8. Your existing draft is preserved.");
        }
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
    lastRoute = location.hash;
    view.modal = "";
    void loadRoute().catch(error => toast(error.message));
    render();
});
window.addEventListener("pagehide", () => { adapter.stopRunObservers(); adapter.abandonInspectionOnUnload(); });
window.addEventListener("beforeunload", (e) => {
    if (dirty() || view.configDirty) {
        e.preventDefault();
        e.returnValue = "";
    }
});
adapter.subscribe(render);
lastRoute = location.hash;
render();
void adapter.initialize().then(async () => { view.coreAddress = adapter.state.core.address; await loadRoute(); }).catch(error => toast(error.message));
let packageFiles = [];
let pendingUploadFiles = [];
function downloadURL(url) { const link = document.createElement('a'); link.href = url; link.download = ''; link.click(); toast('Download started. Check your browser to confirm it was saved.'); }
let routeLoad = 0;
async function loadRoute() {
    if (!adapter.state.signedIn)
        return;
    const version = ++routeLoad;
    const r = route();
    if (!['work', 'app'].includes(r[0]) || !r[1]) {
        render();
        return;
    }
    const work = await adapter.loadWork(r[1]);
    if (version !== routeLoad)
        return;
    const previous = workSelections.get(work.id);
    const service = work.services.find(s => s.id === (r[0] === 'app' ? r[2] : previous?.service ?? view.service)) ?? work.services.find(s => s.enabled && s.observed === 'Ready' && s.ports.length);
    view.service = service?.id ?? '';
    view.port = service?.ports.includes(Number(r[3]) || previous?.port || view.port) ? Number(r[3]) || previous?.port || view.port : service?.ports[0] ?? 0;
    view.session = work.sessions.find(s => s.id === (previous?.session ?? view.session))?.id ?? work.sessions[0]?.id ?? '';
    if (view.session)
        await adapter.loadSession(work.id, view.session);
    if (r[2] === 'settings')
        view.config = structuredClone(work.config);
    else if (r[0] !== 'app')
        view.tab = service ? 'Services' : 'Chat';
    if (service?.observed === 'Ready' && view.port)
        await adapter.ensureServiceEntry(work.id, service.id, view.port).catch(error => toast(error.message));
    render();
}
window.addEventListener('popstate', () => { void loadRoute().catch(error => toast(error.message)); });
/** Update existing nodes in place. In particular, never detach an unchanged Service iframe or its ancestors. */
function reconcileHTML(parent, html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const key = (node) => node instanceof Element ? node.getAttribute('data-service-key') ? `frame:${node.getAttribute('data-service-key')}` : node.id ? `id:${node.id}` : `${node.tagName}:${node.getAttribute('class')?.split(' ')[0] ?? ''}` : node.nodeType === Node.TEXT_NODE ? '#text' : '#other';
    const patch = (target, incoming) => {
        if (target instanceof Element && incoming instanceof Element) {
            if (target instanceof HTMLIFrameElement)
                return;
            for (const attr of Array.from(target.attributes))
                if (!incoming.hasAttribute(attr.name) && !(target instanceof HTMLDialogElement && attr.name === 'open') && attr.name !== 'data-observed' && attr.name !== 'data-bound' && attr.name !== 'data-scroll-bound')
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
function packageStatus(work, name) { const p = work.packageEntries?.find(p => p.name === name); return p ? `Desired: ${p.desired ? "selected" : "not selected"} · Active: ${p.active ? "selected" : "not selected"} · Runtime: ${p.runtime?.availability ?? "unknown"}` : "Saved selection · Runtime not provided"; }
// Observe only confirmed Work/Service facts; preserve the current Session, form drafts and application DOM.
let statusRefreshRunning = false;
setInterval(() => {
    const work = current();
    if (!work || !adapter.state.signedIn || document.visibilityState !== 'visible' || statusRefreshRunning)
        return;
    statusRefreshRunning = true;
    void adapter.refreshWorkStatus(work.id).catch(() => undefined).finally(() => { statusRefreshRunning = false; });
}, 5000);
//# sourceMappingURL=app.js.map