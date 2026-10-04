import { packagePhaseView, packageSteps } from './package-phase.js';
import { ActionState, renderActionStates } from './action-state.js';
import { adapter, ConsoleError, inspectSkillFiles, inspectPackageFiles, } from "./adapter.js";
import { esc, icon, Button, NavLink, StatusLabel, Feedback, PageHeader, Section, Field, Input, DataTable, date, bytes, Disclosure, Copy, Empty, UploadProgress, } from "./components.js";
const app = document.querySelector("#app");
const modules = [
    ["Status", "/"],
    ["Users", "/users"],
    ["Runtime", "/runtime"],
    ["Default Work", "/default-work"],
    ["Skills", "/skills"],
    ["Packages", "/packages"],
    ["Find Operation", "/operations"],
];
let path = location.pathname, loadId = 0, feedback = "", health = null, statusError = "", users = [], skills = [], packages = [], runtime = null, defaults = null, defaultDraft = null, runtimeDraft = { agentImage: "", provider: "", modelId: "", baseUrl: "" }, operation = null;
let dirty = false, saving = false, readbackRequired = false, expandedUser = "", pollTimer, statusTimer, toastTimer;
let dialog = null, dialogOrigin = null, dialogAction = null, dialogDirty = false, upload = null, uploadKind = "npm", uploadTarget, uploadType = "skill", packageIntent = null, packageSourceDraft = "", intentLocked = false, rateUntil = 0, loginAccount = "";
let defaultConflicts = [];
let setupJourney = null;
let runtimeEditing = false, defaultEditSection = null, defaultLastSaved = false, overviewDataConfirmed = false, rememberedOperation = null, lastCreatedUser = null, referenceReturn = null;
let pendingNavigation = null, modalError = "", currentModalTitle = "", submissionPending = false;
let preflightPending = false, selectionVersion = 0, signingIn = false;
const actions = new ActionState(() => renderConsoleActions());
let actionIdentity = adapter.identityEpoch;
const manualLabels = { 'save-defaults': 'Saving defaults', refresh: 'Reading current page', 'verify-runtime': 'Verifying runtime', 'refresh-status': 'Checking status', 'refresh-operation': 'Checking Operation', 'resume-observation': 'Resuming observation', readback: 'Reading configuration', 'sign-out': 'Signing out', 'retry-connection': 'Checking connection' };
function consoleIntent(button) {
    const name = button.dataset.action || '', label = manualLabels[name];
    if (!label || name === 'refresh' && dirty)
        return;
    if (name === 'save-defaults')
        return { key: 'save-defaults', kind: 'configuration', resource: 'defaults', label, target: 'Default Work', anchor: '[data-action="save-defaults"]', view: path };
    return { key: `manual:${path}:${name}`, kind: name === 'sign-out' ? 'identity' : 'read', label, target: path.startsWith('/operations/') ? routeId() : name === 'sign-out' ? adapter.account : path === '/runtime' ? 'Runtime' : path === '/default-work' ? 'Default Work' : 'Core', anchor: `[data-action="${name}"]`, view: path };
}
function renderConsoleActions() {
    if (actionIdentity !== adapter.identityEpoch) {
        actionIdentity = adapter.identityEpoch;
        actions.clear();
        return;
    }
    renderActionStates(document.body, actions, path, consoleIntent);
}
class ConsoleViewChanged extends Error {
}
function currentView(includeDialog = true, allowIdentityChange = false) {
    const originalPath = path, originalLoad = loadId, originalDialog = dialog, identity = adapter.identityEpoch;
    return () => originalPath === path && originalLoad === loadId && (!includeDialog || originalDialog === dialog) && (allowIdentityChange || identity === adapter.identityEpoch);
}
async function awaitCurrent(promise, allowIdentityChange = false) {
    const valid = currentView(true, allowIdentityChange);
    try {
        const value = await promise;
        if (!valid())
            throw new ConsoleViewChanged();
        return value;
    }
    catch (error) {
        if (error instanceof ConsoleError && error.code === 'SESSION_EXPIRED')
            throw error;
        if (!valid())
            throw new ConsoleViewChanged();
        throw error;
    }
}
async function tracked(intent, perform) {
    const previous = actions.records.get(intent.key);
    if (previous?.blocked && /Resume this submission/.test(document.querySelector('#dialog-submit')?.textContent || ''))
        previous.blocked = false;
    const conflict = actions.conflict(intent);
    if (conflict) {
        showToast(`${conflict.target}: waiting for confirmation.`);
        return;
    }
    const record = actions.begin(intent);
    try {
        await perform(record);
        actions.finish(record);
    }
    catch (error) {
        if (error instanceof ConsoleViewChanged) {
            actions.finish(record);
            return;
        }
        const explained = feedback.includes(err(error)) || statusError === err(error);
        actions.fail(record, error);
        if (record.view === path && actions.current(record)) {
            if (!isSessionError(error) && !explained)
                showError(error);
        }
    }
}
function confirmedMutation(message) {
    const record = [...actions.records.values()].find(record => record.pending && record.kind !== 'read' && record.view === path);
    if (record)
        actions.confirm(record, message);
    return record;
}
async function refreshConfirmed(message, read, destination = path) {
    if (destination !== path)
        return;
    const record = confirmedMutation(message) || [...actions.records.values()].find(record => record.result === message);
    feedback = Feedback(message, 'success');
    renderPage();
    if (record) {
        await actions.refresh(record, read);
        if (destination === path && actions.current(record)) {
            if (record.refresh === 'failed')
                feedback = Feedback(`${message} Current list/status not confirmed: ${esc(record.refreshError)}`, 'warning', Button('Retry refresh', 'readback', 'secondary'));
            renderPage();
        }
    }
    else {
        try {
            await read();
            if (destination === path)
                renderPage();
        }
        catch (error) {
            if (destination === path && !isSessionError(error)) {
                feedback = Feedback(`${message} Current list/status not confirmed: ${err(error)}`, 'warning', Button('Retry refresh', 'readback', 'secondary'));
                renderPage();
            }
        }
    }
}
function shell(body) {
    const login = path === "/login", workSetup = ["/default-work", "/skills", "/packages"].some((p) => path === p || path.startsWith(p + "/"));
    const nav = [
        ["Overview", "/", path === "/" || path === "/runtime"],
        ["User access", "/users", path === "/users"],
        ["Work setup", "/default-work", workSetup],
    ];
    app.innerHTML = `<header class="topbar task-shell"><div class="topbar-inner"><a class="brand" href="/" data-nav><span class="brand-mark">${icon("box", 20)}</span>PiWork<span class="brand-divider"></span><span class="brand-sub">Serve</span></a>${login ? "" : `<nav class="nav" aria-label="Main navigation">${nav.map(([name, url, active]) => `<a href="${url}" data-nav class="${active ? "active" : ""}" ${active ? 'aria-current="page"' : ""}>${name}</a>`).join("")}</nav><a href="/operations" data-nav class="operation-utility ${path.startsWith("/operations") ? "active" : ""}">${icon("search", 14)} Find operation</a><button class="btn ghost mobile-menu" data-action="menu" aria-label="Open navigation" aria-expanded="false">Menu ${icon("down", 14)}</button><details class="account-menu"><summary aria-label="Administrator account"><span class="avatar">${esc(adapter.account.slice(0, 2).toUpperCase())}</span>${icon("down", 12)}</summary><div class="account-popover"><p><strong>${esc(adapter.account)}</strong></p><p class="muted">Administrator</p>${Button("Sign out", "sign-out", "secondary")}</div></details>`}</div></header>${login ? "" : `<div class="context-strip">${icon("server", 15)}<span>Core</span><span class="context-tag">Administrator</span><span class="context-end">${path === "/runtime" ? "Core setup" : workSetup ? "Work setup" : path === "/users" ? "User access" : path.startsWith("/operations") ? "Package recovery" : "Overview"}</span></div>`}<main id="main" class="main task-main" tabindex="-1">${body}</main><footer class="footer"><span>${icon("shield", 13)} Core runs independently from this console</span><span>PiWork Serve </span></footer><div id="toast-root" aria-live="polite"></div>`;
    document.title = `${login ? "Sign in" : path === "/" ? "Overview" : modules.find(([, p]) => p === path)?.[0] || "Details"} · PiWork Serve`;
    startStatusTimer();
}
function showToast(message) {
    const el = document.querySelector("#toast-root");
    if (el) {
        el.innerHTML = `<div class="toast">${esc(message)}</div>`;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            el.innerHTML = "";
        }, 3000);
    }
}
function clearPolling() {
    clearTimeout(pollTimer);
    clearInterval(statusTimer);
}
function startStatusTimer() {
    clearInterval(statusTimer);
    if (path !== "/login")
        statusTimer = setInterval(() => {
            if (document.visibilityState !== "visible")
                return;
            void adapter.guard().then(() => { if (path === "/" && !dialog)
                return refreshHealth(false); }).catch(error => { if (!isSessionError(error) && path === "/")
                showError(error); });
        }, 15000);
}
function err(e) {
    if (e instanceof ConsoleError && e.correlationId)
        return `${e.message} Correlation ID: ${e.correlationId}`;
    return e instanceof Error
        ? e.message
        : "The request failed. Please try again.";
}
function isSessionError(e) {
    if (e instanceof ConsoleError && e.code === "SESSION_EXPIRED") {
        clearPolling();
        upload = null;
        packageIntent = null;
        intentLocked = false;
        closeDialog(true);
        dirty = false;
        path = "/login";
        history.pushState({ path }, "", path);
        feedback = Feedback(e.message, "warning");
        renderPage();
        return true;
    }
    return false;
}
function recoveryActions(e) {
    if (e instanceof ConsoleError) {
        if (e.code === "DEFAULT_REFERENCE")
            return NavLink("Open Default Work", "/default-work", "btn secondary");
        if (e.code === "PACKAGE_BUSY")
            return (NavLink("Find Operation", "/operations", "btn secondary") +
                " " +
                Button("Refresh entry", "refresh"));
        if (e.code === "RESULT_UNKNOWN")
            return Button(path === "/runtime"
                ? "Read current runtime"
                : path === "/default-work"
                    ? "Read current defaults"
                    : "Refresh current data", "readback");
    }
    return "";
}
function showError(e) {
    for (const record of actions.records.values())
        if (record.pending && record.view === path)
            actions.fail(record, e);
    if (isSessionError(e))
        return;
    feedback = Feedback(err(e), "error", recoveryActions(e));
    renderPage();
}
function routeId() {
    try {
        return decodeURIComponent(path.split("/").slice(2).join("/"));
    }
    catch {
        return "";
    }
}
function navigate(next, force = false) {
    if (next === path && !force)
        return;
    const execute = () => {
        clearPolling();
        dirty = false;
        feedback = "";
        statusError = "";
        readbackRequired = false;
        saving = false;
        operation = null;
        upload = null;
        packageIntent = null;
        intentLocked = false;
        closeDialog(true);
        path = next;
        history.pushState({ path }, "", next);
        void loadPage();
        window.scrollTo(0, 0);
    };
    if ((dirty || dialogDirty) && !force) {
        confirmDiscard(execute);
        return;
    }
    execute();
}
function trapDialogFocus(el) {
    el.addEventListener("keydown", (event) => {
        if (event.key !== "Tab")
            return;
        const nodes = [
            ...el.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]'),
        ].filter((n) => n.getClientRects().length && !n.hasAttribute("hidden"));
        if (!nodes.length) {
            event.preventDefault();
            el.focus();
            return;
        }
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey &&
            (document.activeElement === first || !el.contains(document.activeElement))) {
            event.preventDefault();
            last.focus();
        }
        else if (!event.shiftKey &&
            (document.activeElement === last || !el.contains(document.activeElement))) {
            event.preventDefault();
            first.focus();
        }
    });
}
function confirmDiscard(action) {
    const origin = document.activeElement;
    const confirm = document.createElement("dialog");
    confirm.setAttribute("aria-labelledby", "discard-title");
    confirm.innerHTML = `<div class="dialog-heading"><div><h2 id="discard-title">Discard unsaved changes?</h2><p>Your unsaved draft will be lost.</p></div></div><div class="dialog-body"><p class="muted">Leave without saving? Any entered password, API Key, or selected files will be cleared.</p></div><div class="dialog-footer"><button type="button" class="btn secondary" data-discard-choice="cancel">Cancel</button><button type="button" class="btn danger" data-discard-choice="discard">Discard changes</button></div>`;
    document.body.append(confirm);
    const cancel = () => {
        confirm.close();
        confirm.remove();
        if (origin?.isConnected)
            origin.focus();
    };
    confirm.addEventListener("cancel", (e) => {
        e.preventDefault();
        cancel();
    });
    confirm.addEventListener("click", (e) => {
        const choice = e.target.closest("[data-discard-choice]")?.dataset.discardChoice;
        if (!choice)
            return;
        e.stopPropagation();
        if (choice === "cancel")
            cancel();
        else {
            confirm.close();
            confirm.remove();
            action();
        }
    });
    trapDialogFocus(confirm);
    confirm.showModal();
    confirm.querySelector("button")?.focus();
}
window.addEventListener("popstate", () => {
    const next = location.pathname;
    if (dirty || dialogDirty) {
        history.pushState({ path }, "", path);
        confirmDiscard(() => navigate(next, true));
    }
    else {
        path = next;
        clearPolling();
        feedback = "";
        void loadPage();
    }
});
window.addEventListener("beforeunload", (e) => {
    if (dirty || dialogDirty) {
        e.preventDefault();
        e.returnValue = "";
    }
});
window.addEventListener("focus", () => {
    if (adapter.session && path !== "/login") {
        void adapter.guard().catch((e) => {
            if (!isSessionError(e) && path === "/")
                void refreshHealth(false);
        });
        if (path === "/")
            void refreshHealth(false);
    }
});
async function loadPage() {
    const ticket = ++loadId;
    clearPolling();
    if (path !== "/login" && !adapter.session) {
        path = "/login";
        history.replaceState({ path }, "", path);
    }
    if (path === "/login") {
        renderPage();
        return;
    }
    const originalPath = path, identity = adapter.identityEpoch;
    const read = async (pending) => {
        const value = await pending;
        if (ticket !== loadId || originalPath !== path || identity !== adapter.identityEpoch)
            throw new ConsoleViewChanged();
        return value;
    };
    shell(`<div class="page-header"><div><h1>${esc(modules.find(([, p]) => p === path)?.[0] || "Details")}</h1><p>Loading current Core data…</p></div></div><div class="skeleton"><span><span class="spinner"></span> Reading Core data</span></div>`);
    try {
        if (path === "/") {
            try {
                health = await read(adapter.health());
                statusError = "";
            }
            catch (e) {
                if (e instanceof ConsoleViewChanged || isSessionError(e))
                    return;
                statusError = err(e);
                health = adapter.lastHealth;
            }
            if (!statusError) {
                [runtime, defaults, users] = await read(Promise.all([
                    adapter.runtime(),
                    adapter.defaults(),
                    adapter.users(),
                ]));
                overviewDataConfirmed = true;
            }
        }
        else if (path === "/users")
            users = await read(adapter.users());
        else if (path === "/runtime") {
            runtime = await read(adapter.runtime());
            runtimeEditing = !runtime;
            try {
                health = await read(adapter.health());
                statusError = "";
            }
            catch (e) {
                if (e instanceof ConsoleViewChanged || isSessionError(e))
                    return;
                statusError = err(e);
            }
            runtimeDraft = runtime
                ? {
                    agentImage: runtime.agentImage,
                    provider: runtime.provider,
                    modelId: runtime.modelId,
                    baseUrl: runtime.baseUrl,
                }
                : { agentImage: "", provider: "", modelId: "", baseUrl: "" };
        }
        else if (path === "/default-work") {
            [defaults, skills, packages] = await read(Promise.all([
                adapter.defaults(),
                adapter.skills(),
                adapter.packages(),
            ]));
            defaultDraft = defaults ? structuredClone(defaults) : null;
            defaultConflicts = [];
            defaultEditSection = null;
            defaultLastSaved = false;
            if (setupJourney && defaults && defaultDraft) {
                const kept = setupJourney;
                for (const key of [
                    "agentImage",
                    "skills",
                    "packages",
                    "agentsMd",
                ]) {
                    if (JSON.stringify(kept.draft[key]) !==
                        JSON.stringify(kept.baseline[key])) {
                        if (JSON.stringify(defaults[key]) !==
                            JSON.stringify(kept.baseline[key]) &&
                            JSON.stringify(defaults[key]) !== JSON.stringify(kept.draft[key]))
                            defaultConflicts.push(key);
                        Object.assign(defaultDraft, {
                            [key]: structuredClone(kept.draft[key]),
                        });
                    }
                }
                defaultEditSection = kept.section;
                dirty = changedDefaults();
                setupJourney = null;
            }
            else if (referenceReturn &&
                defaults?.[referenceReturn.kind].includes(referenceReturn.name)) {
                defaultEditSection = referenceReturn.kind;
            }
        }
        else if (path.startsWith("/skills")) {
            [skills, defaults] = await read(Promise.all([
                adapter.skills(),
                adapter.defaults(),
            ]));
        }
        else if (path.startsWith("/packages")) {
            [packages, defaults] = await read(Promise.all([
                adapter.packages(),
                adapter.defaults(),
            ]));
            if (path.startsWith("/packages/")) {
                const detail = await read(adapter.packageDetails(routeId()));
                packages = [...packages.filter(p => p.name !== detail.name), detail];
            }
        }
        else if (path.startsWith("/operations/")) {
            operation = await read(adapter.operation(routeId()));
            rememberedOperation = structuredClone(operation);
        }
        if (ticket !== loadId)
            return;
        renderPage();
        if (path.startsWith("/operations/") && operation?.state === "running")
            scheduleOperation();
    }
    catch (e) {
        if (ticket !== loadId || isSessionError(e))
            return;
        shell(PageHeader(modules.find(([, p]) => p === path)?.[0] || "Details", "Manage this Core with confidence.", Button(icon("refresh", 15) + " Refresh", "refresh")) +
            Feedback(err(e), "error") +
            Section("Data unavailable", "", Empty("Could not load this page", "A failed request does not mean the catalog is empty.", Button("Try again", "refresh", "primary"))));
    }
}
function renderPage() {
    let body = "";
    if (path === "/login")
        body = loginPage();
    else if (path === "/")
        body = statusPage();
    else if (path === "/users")
        body = usersPage();
    else if (path === "/runtime")
        body = runtimePage();
    else if (path === "/default-work")
        body = defaultsPage();
    else if (path === "/skills")
        body = workSetupTabs() + setupJourneyBanner() + skillsPage();
    else if (path.startsWith("/skills/"))
        body = workSetupTabs() + skillDetails();
    else if (path === "/packages")
        body = workSetupTabs() + setupJourneyBanner() + packagesPage();
    else if (path.startsWith("/packages/"))
        body = workSetupTabs() + packageDetails();
    else if (path === "/operations")
        body = findOperationPage();
    else if (path.startsWith("/operations/"))
        body = operationPage();
    else
        body =
            PageHeader("Page not found", "This console page is unavailable.") +
                NavLink("Back to Status", "/", "btn secondary");
    shell(body);
    renderConsoleActions();
}
function loginPage() {
    const unavailable = adapter.availability?.reachable === false;
    const bootstrap = adapter.availability?.administratorInitialized === false;
    return `<div class="login"><div class="login-heading"><span class="brand-mark">${icon("box", 24)}</span><h1>Administrator sign in</h1><p class="muted">Manage your PiWork Core</p><div class="core-login-status">${StatusLabel(unavailable ? "Core unreachable" : "Core available", unavailable ? "warning" : "success")}<span class="muted">piwork-core</span></div></div>${feedback}${bootstrap ? Feedback("Initialize the first administrator using the CLI or environment configuration. Bootstrap is not available in this console.", "warning") : ""}<section class="section"><form id="login-form">${Field("account", "Account", Input("account", loginAccount, 'autocomplete="username" required placeholder="Your administrator account"'))}${Field("password", "Password", Input("password", "", 'type="password" autocomplete="current-password" required placeholder="Enter your password"'))}<div id="login-error"></div><button class="btn primary" type="submit" ${bootstrap ? "disabled" : ""}>Sign in ${icon("arrow", 15)}</button></form></section>${unavailable ? Button("Retry connection", "retry-connection", "secondary") : ""}<p class="login-note">Administrator access only. For your own Work,<br>use PiWork Desktop or the user CLI.</p></div>`;
}
function taskRail(steps, context) {
    return `<aside class="task-rail"><p class="rail-label">THIS TASK</p><ol>${steps.map((s, i) => `<li class="${s.state}"><span class="step-mark">${s.state === "complete" ? icon("check", 13) : i + 1}</span><div>${s.action ? `<button class="rail-link" type="button" data-action="${s.action}">${esc(s.title)}</button>` : `<strong>${esc(s.title)}</strong>`}<p>${esc(s.detail)}</p></div></li>`).join("")}</ol><div class="task-context">${context}</div></aside>`;
}
function taskFrame(rail, body) {
    return `<div class="task-layout">${rail}<div class="task-content">${body}</div></div>`;
}
function workSetupTabs() {
    return `<nav class="context-tabs" aria-label="Work setup navigation">${[
        ["Starting point", "/default-work"],
        ["Skills", "/skills"],
        ["Packages", "/packages"],
    ]
        .map(([label, url]) => `<a data-nav href="${url}" class="${path === url || path.startsWith(url + "/") ? "active" : ""}">${label}</a>`)
        .join("")}</nav>`;
}
function taskAction(iconName, title, description, meta, url) {
    return `<a class="task-action" href="${url}" data-nav><span class="task-action-icon">${icon(iconName, 21)}</span><span class="task-action-copy"><strong>${esc(title)}</strong><span>${esc(description)}</span></span><span class="task-action-meta">${esc(meta)}</span>${icon("arrow", 17)}</a>`;
}
function statusPage() {
    const stale = !!statusError, ready = !!health?.ready && !stale, hasRuntime = !!runtime, known = rememberedOperation && rememberedOperation.state !== "succeeded"
        ? rememberedOperation
        : null;
    let title = "Your Core is ready", description = "The runtime is configured and readiness is confirmed. Choose what you want to do next.", label = "READY TO USE", tone = "ready", action = NavLink("Review Core setup", "/runtime", "btn secondary"), next = "People can create Work using the current runtime.";
    if (stale || !health) {
        title = "Confirm the Core connection";
        description =
            "The current state is unconfirmed. Reconnect before relying on the last reported readiness.";
        label = "NEEDS ATTENTION";
        tone = "blocked";
        action = Button(icon("refresh", 15) + " Recheck Core", "refresh-status", "primary");
        next = "Existing Core tasks continue independently of this console.";
    }
    else if (!hasRuntime) {
        title = "Make this Core ready";
        description =
            "Configure the Agent image and model credentials. Then confirm that Core can use them.";
        label = "START HERE";
        tone = "setup";
        action = NavLink("Configure runtime " + icon("arrow", 15), "/runtime", "btn primary");
        next = "Creating user accounts and choosing default capabilities can wait.";
    }
    else if (!ready) {
        title = "Finish checking the runtime";
        description =
            "Your configuration is saved. " +
                health.reason +
                ". Check readiness before handing this Core over.";
        label = "SETUP IN PROGRESS";
        tone = "blocked";
        action = Button("Check readiness " + icon("arrow", 15), "refresh-status", "primary");
        next = "Saving configuration and being ready are separate outcomes.";
    }
    else if (known) {
        title =
            known.state === "running"
                ? "Continue your package installation"
                : "Resolve the package operation";
        description = `${known.packageName} · Last confirmed: ${known.packagePhase}. Return using the Operation ID already opened in this tab.`;
        label = "CONTINUE YOUR TASK";
        tone = "setup";
        action = NavLink("Continue operation " + icon("arrow", 15), "/operations/" + encodeURIComponent(known.id), "btn primary");
        next =
            "Only this known operation is retained in the tab. This is not an operation history.";
    }
    const progress = stale || ready
        ? ""
        : `<div class="setup-progress" aria-label="Core setup progress"><span class="${hasRuntime ? "done" : "active"}"><i>${hasRuntime ? icon("check", 12) : "1"}</i> Runtime saved</span><span class="progress-connector"></span><span class="${ready ? "done" : hasRuntime ? "active" : ""}"><i>${ready ? icon("check", 12) : "2"}</i> Readiness confirmed</span></div>`;
    return `<div class="overview-heading"><div><p class="eyebrow">CORE OPERATIONS</p><h1>What’s next for your Core?</h1><p>Prepare the platform, open access, and shape how new Work begins.</p></div><div class="overview-check"><span>${health ? "Checked " + date(health.checkedAt) : "No confirmed check"}</span>${Button(icon("refresh", 14), "refresh-status", "icon-button", 'aria-label="Refresh Core status"')}</div></div>${feedback}<section class="task-lead ${tone}" data-testid="overview-next-task"><div class="task-lead-content"><p class="eyebrow">${label}</p><h2>${esc(title)}</h2><p class="task-lead-description">${esc(description)}</p>${progress}<div class="task-lead-actions">${action}${!ready && hasRuntime ? NavLink("Review runtime", "/runtime", "text-link") : ""}</div></div><div class="task-lead-aside"><span class="lead-symbol">${icon(ready ? "check" : stale ? "warning" : "server", 29)}</span><p>${esc(next)}</p>${known && ready ? `<code>${esc(known.id)}</code>` : ""}</div></section><div class="task-section-label"><h2>${ready ? "Choose a task" : "You can also prepare"}</h2><span>${ready ? "Start with the outcome you need" : "Optional · these do not block Core readiness"}</span></div><section class="task-actions" aria-label="Administrator tasks">${taskAction("users", "Give someone access", "Create an account, or change an existing account’s access.", overviewDataConfirmed ? `${users.filter((u) => u.enabled).length} enabled accounts` : "Manage accounts", "/users")}${taskAction("settings", "Shape new Work", "Choose default Skills, Packages, and working instructions.", defaults ? `${defaults.skills.length} ${defaults.skills.length === 1 ? "Skill" : "Skills"} · ${defaults.packages.length} ${defaults.packages.length === 1 ? "Package" : "Packages"}` : "Choose a starting point", "/default-work")}${taskAction("box", "Add a capability", "Add a Skill or install a Package, then select it for future Work.", "Open capability library", "/skills")}${taskAction("search", "Find a package operation", "Resume a known installation or investigate a result using its ID.", "Operation ID required", "/operations")}</section><details class="core-diagnostics" id="core-checks"><summary><span>${icon("server", 16)} Core state and diagnostics</span><span>${StatusLabel(stale ? "Unconfirmed" : ready ? "Ready" : "Not ready", stale || !ready ? "warning" : "success")}${icon("down", 14)}</span></summary><div class="diagnostics-body"><div class="diagnostic-facts"><div><span>Core connection</span><strong>${stale ? "Unreachable" : health ? "Reachable" : "Unknown"}</strong></div><div><span>Process health</span><strong>${health ? (stale ? "Last known: healthy" : "Healthy") : "Unknown"}</strong></div><div><span>Runtime readiness</span><strong>${health ? (stale ? "Last known: " : "") + (health.ready ? "Ready" : "Not ready") : "Unknown"}</strong></div></div>${stale ? Feedback(statusError + " Last confirmed data is marked above.", "warning") : ""}${health ? health.checks.map((c) => `<div class="check-row">${icon(c.state === "Passed" ? "check" : "warning", 15)}<span class="check-name">${esc(c.name)}</span><span class="check-note">${esc(c.detail)}</span>${StatusLabel(stale ? "Stale" : c.state, stale ? "neutral" : c.state === "Passed" ? "success" : "warning")}</div>`).join("") : Empty("No confirmed checks", "Recheck the connection to obtain current health and readiness.")}<div class="section-footer"><span>Administrator: ${esc(adapter.account)}</span><span>Refreshes every 15 seconds while this page is visible</span></div>${Disclosure("Public technical fields", `<pre>${esc(JSON.stringify({ core: "piwork-core", connection: "Console to Core loopback", health: health?.healthy ?? null, ready: health?.ready ?? null, reason: health?.reason ?? null, lastChecked: health?.checkedAt ?? null }, null, 2))}</pre>`)}</div></details>`;
}
function runtimePage() {
    const ready = !!health?.ready && !statusError;
    const configured = !!runtime;
    const rail = taskRail([
        {
            title: "Configure runtime",
            detail: configured ? "Configuration saved" : "Required before new Work",
            state: runtimeEditing || !configured ? "current" : "complete",
            action: "edit-runtime",
        },
        {
            title: "Confirm readiness",
            detail: ready
                ? "Core is ready"
                : configured
                    ? "Check the saved runtime"
                    : "After the runtime is saved",
            state: ready
                ? "complete"
                : configured && !runtimeEditing
                    ? "current"
                    : "upcoming",
            action: configured && !runtimeEditing ? "verify-runtime" : undefined,
        },
    ], `<p class="rail-label">SCOPE</p><p>Changes affect only future Work. Existing Work keeps its current runtime.</p><p class="rail-label">AFTER SETUP</p>${NavLink("Give someone access", "/users")}${NavLink("Shape new Work", "/default-work")}`);
    const summary = runtime
        ? `<dl class="summary-list"><dt>Agent image</dt><dd><code>${esc(runtime.agentImage)}</code></dd><dt>Model provider</dt><dd>${esc(runtime.provider)}</dd><dt>Model ID</dt><dd><code>${esc(runtime.modelId)}</code></dd><dt>Custom Base URL</dt><dd>${runtime.baseUrl ? `<code>${esc(runtime.baseUrl)}</code>` : "Provider default"}</dd><dt>Credential</dt><dd>${StatusLabel(runtime.credentialAvailable ? "Available" : "Unavailable", runtime.credentialAvailable ? "success" : "warning")}</dd><dt>Updated</dt><dd>${date(runtime.updatedAt)}</dd></dl>`
        : Empty("No runtime saved yet", "Add the image and model configuration to continue.");
    const body = runtimeEditing
        ? Section(configured ? "Edit runtime" : "Configure runtime", "Enter the image, model, and a complete API Key.", `<div class="section-body"><form id="runtime-form" class="form-grid">${Field("agentImage", "Agent image", Input("agentImage", runtimeDraft.agentImage, 'required placeholder="ghcr.io/piwork/agent:stable"'))}${Field("provider", "Model provider", Input("provider", runtimeDraft.provider, 'required placeholder="openai"'))}${Field("modelId", "Model ID", Input("modelId", runtimeDraft.modelId, 'required placeholder="Model identifier"'))}${Field("baseUrl", "Custom Base URL", Input("baseUrl", runtimeDraft.baseUrl, 'type="url" placeholder="https://… (optional)"'), "Leave blank to use the provider default.")}${Field("apiKey", "API Key", Input("apiKey", "", 'type="password" autocomplete="new-password" required placeholder="Enter the complete API Key"'), "Write-only. Enter it again for every save; it is never returned.")}<div class="form-actions"><button type="submit" class="btn primary" ${saving || readbackRequired ? "disabled" : ""}>${saving ? "Saving…" : "Save runtime"}</button>${Button("Cancel editing", "cancel-runtime-edit", "secondary")}</div><p class="help form-notice">After saving, check readiness separately. No existing Work is changed.</p></form></div>${configured ? Disclosure("Compare with saved configuration", summary) : ""}`)
        : Section("Runtime configuration", "The configuration currently saved on Core.", `<div class="section-body">${summary}</div><div class="section-footer"><span>The stored API Key is never shown.</span>${Button("Edit runtime", "edit-runtime", "secondary")}</div>`) +
            Section("Readiness", "Confirm that Core can use the saved runtime.", `<div class="section-body"><div class="readiness-answer"><span class="system-icon ${ready ? "" : "warning"}">${icon(ready ? "check" : "warning", 19)}</span><div><h3>${ready ? "Core is ready for new Work" : statusError ? "Readiness is unconfirmed" : "Runtime saved. Core is not ready yet."}</h3><p>${esc(statusError || health?.reason || "A current readiness check is needed.")}</p><small>${health ? "Last checked " + date(health.checkedAt) : "Not checked yet"}</small></div></div></div><div class="section-footer"><span>${ready ? "Required setup is complete." : "Configuration remains saved while readiness is checked."}</span>${ready ? NavLink("Back to overview", "/", "btn primary") : Button("Check readiness", "verify-runtime", "primary")}</div>`);
    return (PageHeader("Make this Core ready", "Save the runtime. Confirm readiness. Then let people create Work.", Button(icon("refresh", 15) + " Refresh", "refresh"), NavLink("Overview", "/") + " / Core setup") +
        feedback +
        taskFrame(rail, body));
}
function defaultsSelection(kind, d) {
    if (kind === "skills")
        return `<div class="selection-heading"><span>${d.skills.length} selected · Used in this order</span>${Button("Clear all", "clear-skills", "ghost small", d.skills.length ? "" : "disabled")}</div><div class="ordered-list">${d.skills.length
            ? d.skills
                .map((name, i) => {
                const item = skills.find((s) => s.name === name);
                return `<div class="ordered-item"><span class="index">${i + 1}</span><span class="item-name">${esc(name)}${!item || !item.enabled ? `<span class="subtext text-danger"> · ${!item ? "Removed from catalog" : "Disabled"}</span>` : ""}</span><div class="ordered-actions">${Button(icon("up", 14), "move-skill", "icon-button", `data-name="${esc(name)}" data-direction="up" aria-label="Move up ${esc(name)}" ${i === 0 ? "disabled" : ""}`)}${Button(icon("down", 14), "move-skill", "icon-button", `data-name="${esc(name)}" data-direction="down" aria-label="Move down ${esc(name)}" ${i === d.skills.length - 1 ? "disabled" : ""}`)}${Button(icon("close", 13), "remove-default-skill", "icon-button", `data-name="${esc(name)}" aria-label="Remove ${esc(name)}"`)}</div></div>`;
            })
                .join("")
            : '<p class="help">No Skills selected</p>'}</div><p class="selection-caption">AVAILABLE SKILLS</p><div class="selection-menu" id="skill-picker">${skills
            .filter((s) => s.enabled)
            .map((s) => `<label class="check-label"><input type="checkbox" data-default-skill="${esc(s.name)}" ${d.skills.includes(s.name) ? "checked" : ""}><span>${esc(s.name)}</span></label>`)
            .join("") || '<p class="help">No enabled Skills are available.</p>'}</div>`;
    return `<div class="selection-heading"><span>${d.packages.length} / 64 selected</span>${Button("Clear all", "clear-packages", "ghost small", d.packages.length ? "" : "disabled")}</div><div class="selection-menu" id="package-picker">${packages
        .filter((p) => p.enabled || d.packages.includes(p.name))
        .map((p) => `<label class="check-label"><input type="checkbox" data-default-package="${esc(p.name)}" ${d.packages.includes(p.name) ? "checked" : ""}><span>${esc(p.name)}${!p.enabled ? " · Disabled reference" : ""}</span></label>`)
        .join("")}${d.packages
        .filter((n) => !packages.some((p) => p.name === n))
        .map((n) => `<label class="check-label"><input type="checkbox" data-default-package="${esc(n)}" checked><span>${esc(n)} · Removed from catalog</span></label>`)
        .join("")}</div>${!d.packages.length ? '<p class="help">No Packages selected</p>' : ""}`;
}
function defaultsEditor(section, d) {
    const content = section === "skills"
        ? Field("skill-picker", "Ordered Skills", defaultsSelection("skills", d), "Choose enabled entries. This does not install, enable, or remove catalog items.")
        : section === "packages"
            ? Field("package-picker", "Packages", defaultsSelection("packages", d), "At most 64 Packages. Existing Work copies remain unchanged.")
            : section === "agentImage"
                ? Field("default-image", "Agent image", Input("default-image", d.agentImage, "required"), "The base image used to create future Work.")
                : Field("agentsMd", "AGENTS.md", `<textarea class="editor" id="agentsMd" name="agentsMd" spellcheck="false">${esc(d.agentsMd)}</textarea><div class="count-row"><span id="agents-count">${new TextEncoder().encode(d.agentsMd).length.toLocaleString()} / 262,144 UTF-8 bytes</span><label class="btn small" for="agents-file">${icon("upload", 13)} Import file</label><input type="file" id="agents-file" accept=".md,.txt,text/plain,text/markdown" hidden data-layout="layout-role-0"></div>`, "Importing only fills this draft. Empty text clears AGENTS.md.");
    const label = section === "skills"
        ? "Choose and order Skills"
        : section === "packages"
            ? "Choose Packages"
            : section === "agentImage"
                ? "Set the Agent image"
                : "Write working instructions";
    return Section(label, "Edit this part of the starting point. Save when you are ready.", `<div class="section-body"><form id="defaults-form" class="form-grid">${content}<div class="form-actions">${Button("Done editing", "finish-default-edit", "secondary")}${section === "skills" || section === "packages" ? Button(section === "skills" ? "Add a Skill to the library" : "Install a Package", "open-capability-library", "ghost", `data-kind="${section}"`) : ""}</div></form></div>`);
}
function defaultChangedFields() {
    return defaults && defaultDraft
        ? ["agentImage", "skills", "packages", "agentsMd"].filter((k) => JSON.stringify(defaults[k]) !== JSON.stringify(defaultDraft[k]))
        : [];
}
function referenceContext() {
    if (!referenceReturn || !defaults)
        return "";
    const selected = defaults[referenceReturn.kind].includes(referenceReturn.name);
    return `<div class="journey-notice"><span>${icon(selected ? "warning" : "check", 17)}</span><div><strong>${selected ? "Resolve the default reference" : "Reference removed. Return to the original task."}</strong><p>${selected ? `${esc(referenceReturn.name)} is still selected for new Work. Remove it here and save before ${referenceReturn.action === "remove" ? "removing" : "disabling"} the catalog entry.` : `The catalog entry has not been changed. Go back and confirm ${referenceReturn.action} again.`}</p></div>${selected ? Button(referenceReturn.kind === "skills" ? "Edit Skills" : "Edit Packages", "edit-defaults", "secondary", `data-section="${referenceReturn.kind}"`) : NavLink(referenceReturn.kind === "skills" ? "Return to Skill" : "Return to Package", "/" + referenceReturn.kind + "/" + encodeURIComponent(referenceReturn.name), "btn primary")}</div>`;
}
function defaultsPage() {
    if (!defaults || !defaultDraft)
        return (PageHeader("Shape new Work", "Choose a starting point for Work created in the future.") +
            workSetupTabs() +
            feedback +
            Section("Defaults are not available yet", "Core has not returned a default configuration.", Empty("Configure Runtime first", "After the runtime is saved, come back to choose default capabilities and instructions.", NavLink("Configure runtime", "/runtime", "btn primary"))));
    const d = defaultDraft, changes = defaultChangedFields(), changed = (key) => changes.includes(key) ? '<span class="draft-tag">Edited</span>' : "";
    const rows = [
        [
            "agentImage",
            "Agent image",
            "The environment new Work starts in",
            `<code>${esc(d.agentImage)}</code>`,
        ],
        [
            "skills",
            "Skills",
            "Selected capabilities, in order",
            d.skills.length
                ? d.skills
                    .map((name, i) => `<span class="summary-token"><b>${i + 1}</b>${esc(name)}${!skills.some((s) => s.name === name && s.enabled) ? "<i>Unavailable</i>" : ""}</span>`)
                    .join("")
                : '<span class="muted">No Skills selected</span>',
        ],
        [
            "packages",
            "Packages",
            "Packages selected for new Work",
            d.packages.length
                ? d.packages
                    .map((name) => `<span class="summary-token">${esc(name)}</span>`)
                    .join("")
                : '<span class="muted">No Packages selected</span>',
        ],
        [
            "agentsMd",
            "Working instructions",
            "AGENTS.md · UTF-8 text",
            `<span>${d.agentsMd ? new TextEncoder().encode(d.agentsMd).length.toLocaleString() + " bytes" : "No instructions"}</span>${d.agentsMd ? `<p class="instruction-preview">${esc(d.agentsMd.split("\n").filter(Boolean).slice(0, 2).join(" · "))}</p>` : ""}`,
        ],
    ];
    const summary = `<section class="starting-point"><div class="starting-point-heading"><div><h2>${dirty ? "Your draft starting point" : "Current starting point"}</h2><p>${dirty ? "Changes below have not been saved." : "Used only when a new Work is created."}</p></div>${StatusLabel(dirty ? "Unsaved draft" : "Saved", dirty ? "warning" : "success")}</div>${rows.map(([key, title, description, value]) => `<div class="setup-config-row" data-testid="default-summary-${key}"><div class="setup-config-label"><h3>${title} ${changed(key)}</h3><p>${description}</p></div><div class="setup-config-value">${value}</div>${Button("Edit " + (key === "agentsMd" ? "instructions" : key === "agentImage" ? "image" : title), "edit-defaults", "ghost small", `data-section="${key}"`)}</div>`).join("")}</section>`;
    const rail = !defaultEditSection && !dirty && !defaultLastSaved
        ? `<aside class="task-rail summary-context"><p class="rail-label">CURRENT STARTING POINT</p><div class="saved-context">${icon("check", 16)}<strong>Saved on Core</strong></div><p class="help">New Work uses this configuration. Edit only the part you want to change.</p><div class="task-context"><p class="rail-label">NEED A CAPABILITY?</p>${Button("Add or update a Skill", "open-capability-library", "ghost", `data-kind="skills"`)}${Button("Install or update a Package", "open-capability-library", "ghost", `data-kind="packages"`)}<p class="rail-note">Catalog entries and default selections are managed separately.</p></div></aside>`
        : taskRail([
            {
                title: "Choose a starting point",
                detail: defaultEditSection
                    ? "Editing " +
                        (defaultEditSection === "agentsMd"
                            ? "instructions"
                            : defaultEditSection)
                    : "Review the current configuration",
                state: defaultLastSaved ? "complete" : "current",
            },
            {
                title: "Save for future Work",
                detail: defaultLastSaved
                    ? "Saved and confirmed by Core"
                    : "Existing Work stays unchanged",
                state: defaultLastSaved ? "complete" : "upcoming",
            },
        ], `<p class="rail-label">NEED A CAPABILITY?</p>${Button("Add or update a Skill", "open-capability-library", "ghost", `data-kind="skills"`)}${Button("Install or update a Package", "open-capability-library", "ghost", `data-kind="packages"`)}<p class="rail-note">Catalog entries and default selections are managed separately.</p>`);
    const commit = `<div class="draft-commit ${dirty ? "has-changes" : ""}"><div><strong id="dirty-label">${dirty ? changes.length + " fields changed" : "No unsaved changes"}</strong><p>Only edited fields are submitted. Other public settings are preserved.</p></div><div>${Button("Discard draft", "discard-defaults", "secondary", dirty ? "" : "disabled")}${Button("Review", "review-defaults", "ghost", !dirty ? "disabled" : "")}${Button(saving ? "Saving…" : "Save defaults", "save-defaults", "primary", !dirty || saving || readbackRequired || defaultConflicts.length > 0 ? "disabled" : "")}</div></div>`;
    return (PageHeader("Shape new Work", "Choose the capabilities and instructions every new Work starts with.", Button(icon("refresh", 15) + " Refresh", "refresh")) +
        workSetupTabs() +
        feedback +
        referenceContext() +
        defaultConflictNotice() +
        taskFrame(rail, (defaultEditSection ? defaultsEditor(defaultEditSection, d) : summary) +
            commit +
            Disclosure("Complete public configuration", `<pre>${esc(JSON.stringify(defaults?.publicConfiguration ?? null, null, 2))}</pre>`)));
}
function defaultConflictNotice() {
    return defaultConflicts.length
        ? `<div class="journey-notice"><span>${icon("warning", 17)}</span><div><strong>Core changed while you were adding a capability</strong><p>${defaultConflicts.map((k) => (k === "agentsMd" ? "AGENTS.md" : k === "agentImage" ? "Agent image" : k === "skills" ? "Skills" : "Packages")).join(", ")} changed in both your draft and the saved configuration. Review the difference before saving; neither version has been discarded.</p></div>${Button("Review changed fields", "review-default-conflicts", "primary")}</div>`
        : "";
}
function reviewDefaultConflicts() {
    if (!defaults || !defaultDraft)
        return;
    openDialog("Resolve changed fields", "Choose which values to keep before saving your draft.", `<div class="review-list">${defaultConflicts.map((k) => `<div><h3>${esc(k)}</h3><p><span>On Core</span>${esc(JSON.stringify(defaults[k]))}</p><p><span>Your draft</span>${esc(JSON.stringify(defaultDraft[k]))}</p></div>`).join("")}</div><p class="help">Keeping your draft replaces these current Core values when you explicitly save. Using Core values preserves confirmed additions and keeps other draft edits.</p><div data-layout="layout-role-3">${Button("Use Core values", "resolve-default-conflicts-core", "secondary")}</div>`, "Keep my draft", () => {
        defaultConflicts = [];
        closeDialog(true);
        feedback = Feedback("Your draft values were kept for the reviewed fields. Save defaults to apply them.", "warning");
        renderPage();
    });
}
function reviewDefaults() {
    if (defaultConflicts.length) {
        reviewDefaultConflicts();
        return;
    }
    if (!dirty || !defaults || !defaultDraft || readbackRequired)
        return;
    const names = {
        agentImage: "Agent image",
        skills: "Skills",
        packages: "Packages",
        agentsMd: "AGENTS.md",
    };
    const format = (value, key) => key === "agentsMd"
        ? `${new TextEncoder().encode(String(value)).length} UTF-8 bytes`
        : Array.isArray(value)
            ? value.length
                ? value.join(", ")
                : "None"
            : String(value);
    openDialog("Review changes", "Only future Work will use these defaults.", `<div class="review-list">${defaultChangedFields()
        .map((key) => `<div><h3>${names[key]}</h3><p><span>Saved</span>${esc(format(defaults[key], key))}</p><p><span>Draft</span>${esc(format(defaultDraft[key], key))}</p></div>`)
        .join("")}</div><p class="help">Only these changed fields are submitted. Existing Work and catalog entries stay unchanged.</p>`, "Save defaults", async () => {
        closeDialog(true);
        await saveDefaults();
    });
}
function usersPage() {
    return (PageHeader("Give people access", "Create accounts, then help each person sign in to the right place.", Button(icon("refresh", 15) + " Refresh", "refresh") +
        Button(icon("plus", 15) + " Create user", "create-user", "primary")) +
        feedback +
        (lastCreatedUser
            ? `<div class="access-outcome"><span class="system-icon">${icon("check", 18)}</span><div><p class="eyebrow">ACCOUNT READY</p><h2>${esc(lastCreatedUser.account)} can sign in</h2><p>${lastCreatedUser.role === "Administrator" ? "Use this Serve console for administration, or Desktop / the user CLI for Work." : "Use PiWork Desktop or the user CLI. This account cannot open the administrator console."}</p></div>${Button("Done", "dismiss-access-outcome", "secondary")}</div>`
            : "") +
        `<div class="access-task-summary"><span>${icon("users", 17)} <strong>${users.filter((u) => u.enabled).length} enabled</strong> / ${users.length} total accounts</span><span>Disabling or resetting revokes all sessions</span></div>` +
        Section("Accounts on this Core", `${users.length} accounts · Includes enabled and disabled users`, DataTable(["Account", "Role", "Status", "Created", "Updated", "Actions"], users.map((u) => `<tr data-testid="user-row"><td class="table-name"><button class="btn ghost name-link" data-action="user-details" data-id="${esc(u.id)}" aria-expanded="${expandedUser === u.id}">${esc(u.account)}</button></td><td>${esc(u.role)}</td><td>${StatusLabel(u.enabled ? "Enabled" : "Disabled", u.enabled ? "success" : "neutral")}</td><td class="nowrap">${date(u.createdAt)}</td><td class="nowrap">${date(u.updatedAt)}</td><td><div class="cell-actions">${Button(u.enabled ? "Disable" : "Enable", "user-toggle", "small", `data-id="${esc(u.id)}"`)}${Button("Reset password", "user-reset", "small", `data-id="${esc(u.id)}"`)}</div></td></tr>${expandedUser === u.id ? `<tr><td colspan="6" class="table-details"><span class="small-label">USER ID</span><div class="inline-id"><code>${esc(u.id)}</code>${Copy(u.id)}</div><p class="help">${u.id === adapter.currentUserId ? "Your current administrator account. " : ""}Created ${esc(new Date(u.createdAt).toLocaleString())}. ${u.enabled ? "Account can sign in." : "Old sessions remain revoked."}</p></td></tr>` : ""}`), "No accounts returned. Refresh to check the Core.")) +
        `<div class="scope-note">${icon("shield", 16)}<span>Disabling an account or resetting its password revokes all of that account’s sessions. Enabling an account does not restore old sessions.</span></div>`);
}
function setupJourneyBanner() {
    return setupJourney
        ? `<div class="journey-notice"><span>${icon("settings", 17)}</span><div><strong>Adding a capability to your starting point</strong><p>Your Work setup draft is preserved. Add the capability here, then return and choose it explicitly.</p></div>${Button(setupJourney.section === "skills" ? "Return to Skills selection" : "Return to Packages selection", "return-to-setup", "secondary")}</div>`
        : "";
}
function openCapabilityLibrary(kind) {
    if (defaultDraft && defaults)
        setupJourney = {
            draft: structuredClone(defaultDraft),
            baseline: structuredClone(defaults),
            section: kind,
        };
    navigate("/" + kind, true);
}
function capabilityReturn(kind, name) {
    const alreadySelected = !!defaults?.[kind].includes(name);
    if (setupJourney)
        return `<div class="journey-notice"><span>${icon("check", 17)}</span><div><strong>Continue shaping new Work</strong><p>${alreadySelected ? "Core confirms this capability is already selected in Default Work. Your earlier draft will be compared with the current saved values when you return." : "Your earlier draft is still here. Select this capability explicitly when you return; it has not been added to defaults."}</p></div>${Button(setupJourney.section === "skills" ? "Return to Skills selection" : "Return to Packages selection", "return-to-setup", "primary")}</div>`;
    const selected = defaults?.[kind].includes(name);
    if (referenceReturn?.kind === kind &&
        referenceReturn.name === name &&
        !selected)
        return Feedback("The default reference is removed. Review the entry and confirm " +
            referenceReturn.action +
            " again.", "info");
    return `<div class="capability-next"><span>${icon("settings", 16)} ${selected ? "Selected for future Work" : "Available in the Core library"}</span>${NavLink(selected ? "Review starting point" : "Choose for new Work", "/default-work", "text-link")}</div>`;
}
function skillsPage() {
    return (PageHeader("Add capabilities with Skills", "Add to the library first. Then choose what new Work should use.", Button(icon("refresh", 15) + " Refresh", "refresh") +
        Button(icon("plus", 15) + " Add Skill", "add-skill", "primary")) +
        feedback +
        Section("All Skills", `${skills.length} Skills · Sorted by name`, DataTable(["Name", "Status", "Default Work", "Files", "Updated", ""], skills.map((s) => `<tr><td class="table-name">${NavLink(esc(s.name), "/skills/" + encodeURIComponent(s.name), "name-link")}<span class="subtext">${esc(s.source)}</span></td><td>${StatusLabel(s.enabled ? "Enabled" : "Disabled", s.enabled ? "success" : "neutral")}</td><td>${defaults?.skills.includes(s.name) ? StatusLabel("Default", "info") : '<span class="muted">Not selected</span>'}</td><td>${s.files} <span class="muted">· ${bytes(s.bytes)}</span></td><td class="nowrap">${date(s.updatedAt)}</td><td>${NavLink(icon("chevron", 16), "/skills/" + encodeURIComponent(s.name), "btn icon-button")}</td></tr>`), "No Skills yet. Add a Skill from a directory on this device.")) +
        `<div class="scope-note">${icon("book", 16)}<span>Core Skills are available for future Work. Updating or removing an entry does not change copies in existing Work.</span></div>`);
}
function skillDetails() {
    const s = skills.find((s) => s.name === routeId());
    if (!s || adapter.scenario === "object-missing")
        return missingPage("Skill", "/skills");
    return (PageHeader(s.name, "Skill details and availability.", Button(icon("refresh", 15) + " Refresh", "refresh") +
        Button(icon("upload", 15) + " Update directory", "update-skill", "primary", `data-name="${esc(s.name)}"`), NavLink("Skills", "/skills") + " / Details") +
        feedback +
        capabilityReturn("skills", s.name) +
        Section("Skill details", "", `<div class="section-body"><div class="metadata-tags">${StatusLabel(s.enabled ? "Enabled" : "Disabled", s.enabled ? "success" : "neutral")}${StatusLabel(defaults?.skills.includes(s.name) ? "Default" : "Not default", defaults?.skills.includes(s.name) ? "info" : "neutral")}</div><dl class="summary-list" data-layout="layout-role-5"><dt>Name</dt><dd class="inline-id"><code>${esc(s.name)}</code>${Copy(s.name)}</dd><dt>Source</dt><dd>${esc(s.source)}</dd><dt>Files</dt><dd>${s.files} ordinary files · ${bytes(s.bytes)}</dd><dt>Updated</dt><dd>${date(s.updatedAt)}</dd></dl></div>`) +
        Section("Availability", "Control whether this Skill can be selected for future Work.", `<div class="section-body danger-row"><div><h3>${s.enabled ? "Enabled for selection" : "Disabled for selection"}</h3><p>Existing Work copies are unchanged. Remove a default reference explicitly in Default Work before disabling.</p></div>${Button(s.enabled ? "Disable Skill" : "Enable Skill", "catalog-toggle", "secondary", `data-kind="skills" data-name="${esc(s.name)}"`)}</div>`) +
        Section("Remove Skill", "", `<div class="section-body danger-row"><p>Remove this Skill from the Core catalog. This does not delete copies already used by Work.</p>${Button("Remove Skill", "catalog-remove", "danger", `data-kind="skills" data-name="${esc(s.name)}"`)}</div>`, "", "danger-zone"));
}
function packagesPage() {
    return (PageHeader("Install and maintain Packages", "Publish a capability to Core, then choose it for new Work.", Button(icon("refresh", 15) + " Refresh", "refresh") +
        Button(icon("plus", 15) + " Install Package", "install-package", "primary")) +
        feedback +
        Section("All Packages", `${packages.length} Packages · Includes enabled and disabled entries`, DataTable([
            "Name",
            "Version",
            "Source",
            "Status",
            "Default Work",
            "Resources",
            "",
        ], packages.map((p) => `<tr><td class="table-name">${NavLink(esc(p.name), "/packages/" + encodeURIComponent(p.name), "name-link")}<span class="subtext">Updated ${date(p.updatedAt)}</span></td><td class="nowrap">${esc(p.version || "Not declared")}</td><td class="nowrap">${esc(p.sourceKind)}</td><td>${StatusLabel(p.enabled ? "Enabled" : "Disabled", p.enabled ? "success" : "neutral")}</td><td>${defaults?.packages.includes(p.name) ? StatusLabel("Default", "info") : '<span class="muted">Not selected</span>'}</td><td>${p.resources ?? "Not provided"}</td><td>${NavLink(icon("chevron", 16), "/packages/" + encodeURIComponent(p.name), "btn icon-button")}</td></tr>`), "No Packages yet. Install from npm, Git, a local directory, or ZIP.")) +
        `<div class="scope-note">${icon("box", 16)}<span>A Core Package is a source of Agent capabilities. It does not indicate whether a Package is loaded in any Work.</span></div>`);
}
function packageDetails() {
    const p = packages.find((p) => p.name === routeId());
    if (!p || adapter.scenario === "object-missing")
        return missingPage("Package", "/packages");
    return (PageHeader(p.name, "Package source, resources, and availability.", Button(icon("refresh", 15) + " Refresh", "refresh") +
        Button("Update Package", "update-package", "primary", `data-name="${esc(p.name)}"`), NavLink("Packages", "/packages") + " / Details") +
        feedback +
        capabilityReturn("packages", p.name) +
        Section("Package details", "", `<div class="section-body"><div class="metadata-tags">${StatusLabel(p.enabled ? "Enabled" : "Disabled", p.enabled ? "success" : "neutral")}${StatusLabel(defaults?.packages.includes(p.name) ? "Default" : "Not default", defaults?.packages.includes(p.name) ? "info" : "neutral")}</div><dl class="summary-list" data-layout="layout-role-5"><dt>Name</dt><dd class="inline-id"><code>${esc(p.name)}</code>${Copy(p.name)}</dd><dt>Version</dt><dd>${esc(p.version || "Not declared")}</dd><dt>Source kind</dt><dd>${esc(p.sourceKind)}</dd><dt>Resolved source</dt><dd class="inline-id"><code>${esc(p.resolvedSource)}</code>${Copy(p.resolvedSource)}</dd><dt>Resources</dt><dd>${p.resources ?? "Not provided"}</dd><dt>Updated</dt><dd>${date(p.updatedAt)}</dd></dl></div>`) +
        Section("Availability", "Enabled Packages can be selected for future Work.", `<div class="section-body danger-row"><div><h3>${p.enabled ? "Enabled for selection" : "Disabled for selection"}</h3><p>Updating retains the enabled state and default reference. Existing Work copies stay unchanged.</p></div>${Button(p.enabled ? "Disable Package" : "Enable Package", "catalog-toggle", "secondary", `data-kind="packages" data-name="${esc(p.name)}"`)}</div>`) +
        Section("Remove Package", "", `<div class="section-body danger-row"><p>Remove this entry from the Core catalog. Default references and running operations must be resolved first.</p>${Button("Remove Package", "catalog-remove", "danger", `data-kind="packages" data-name="${esc(p.name)}"`)}</div>`, "", "danger-zone"));
}
function missingPage(noun, url) {
    return (PageHeader(noun + " unavailable", "The entry may have been removed or changed.", Button("Refresh", "refresh"), NavLink("Back to " + noun + "s", url)) +
        feedback +
        Section("Entry not found", "", Empty("This " + noun + " is no longer available", "Refresh the catalog to see current entries.", NavLink("Back to " + noun + "s", url, "btn secondary"))));
}
function findOperationPage() {
    return (PageHeader("Find a package operation", "Resume observation or investigate a result using a known Operation ID.") +
        feedback +
        (rememberedOperation
            ? `<div class="journey-notice"><span>${icon("clock", 17)}</span><div><strong>Already opened in this tab</strong><p>${esc(rememberedOperation.packageName)} · ${esc(rememberedOperation.packagePhase)} · <code>${esc(rememberedOperation.id)}</code></p></div>${NavLink("Continue operation", "/operations/" + encodeURIComponent(rememberedOperation.id), "btn secondary")}</div>`
            : "") +
        Section("Look up an Operation", "Any active administrator can query a known Core-scope package Operation.", `<div class="section-body"><form id="operation-find"><label for="operation-id" class="small-label">OPERATION ID</label><div class="lookup-row" data-layout="layout-role-6">${Input("operation-id", "", 'class="mono" required placeholder="op_…" autocomplete="off"')}<button type="submit" class="btn primary">${icon("search", 15)} Find Operation</button></div><p class="lookup-help">Use the ID saved when the submission was accepted. Work-scope and unavailable IDs return the same unavailable state.</p></form></div>`) +
        Section("Resume without resubmitting", "", `<div class="section-body"><div class="scope-note" data-layout="layout-role-8">${icon("clock", 18)}<span>Closing this console, signing out, or losing your connection only stops observation. Accepted operations continue on Core.</span></div><p class="help">There is no operation history in this console. Keep the Operation ID before leaving the page.</p></div>`));
}
function operationPage() {
    if (!operation)
        return (PageHeader("Operation unavailable", "Use a known Core-scope package Operation ID.", Button("Refresh", "refresh"), NavLink("Find Operation", "/operations")) + feedback);
    const o = operation;
    const running = o.state === "running";
    const interrupted = feedback.includes("Observation interrupted");
    const tone = o.state === "succeeded"
        ? "success"
        : o.state === "failed"
            ? "error"
            : o.state === "superseded"
                ? "warning"
                : "info";
    const phases = packageSteps;
    const phase = packagePhaseView(o.packagePhase, o.state);
    const idx = phase.index;
    return (PageHeader("Package operation", "Track a single accepted operation on this Core.", Button(icon("refresh", 15) + " Refresh", "refresh-operation"), NavLink("Find Operation", "/operations") + " / Details") +
        feedback + (phase.cleanupPending ? Feedback("Package cleanup is pending. Review the original Operation diagnostic; this is separate from publication.", "warning") : "") +
        Section("Operation status", "", `<div class="operation-state"><span class="system-icon ${o.state === "failed" || o.state === "superseded" ? "warning" : ""}">${running ? '<span class="spinner"></span>' : icon(o.state === "succeeded" ? "check" : "warning", 20)}</span><div><h3>${o.state === "succeeded" ? "Package published" : o.state === "failed" ? "Operation failed" : o.state === "superseded" ? "Operation superseded" : esc(phase.label)}</h3><p>${esc(o.packageName)}</p><div data-layout="layout-role-7">${StatusLabel(o.state, tone)}</div></div></div><div class="phase-list">${phases.map((p, i) => `<div class="phase-step ${i < idx ? "done" : i === idx ? "current" : ""}">${esc(p)}</div>`).join("")}</div><div class="section-footer"><span>${running ? (interrupted ? "Observation paused" : "Checking approximately every 2 seconds") : "Final state · Observation stopped"}</span><span>Last confirmed ${date(o.updatedAt)}</span></div>`) +
        Section("Operation details", "Save this ID to return from another device or after restarting the console.", `<div class="section-body"><dl class="summary-list"><dt>Operation ID</dt><dd class="inline-id"><code>${esc(o.id)}</code>${Copy(o.id)}</dd><dt>Package</dt><dd>${esc(o.packageName)}</dd><dt>Package phase</dt><dd>${esc(o.packagePhase || "Not reported by Core yet")}</dd><dt>Created</dt><dd>${date(o.createdAt)}</dd><dt>Updated</dt><dd>${date(o.updatedAt)}</dd><dt>Result</dt><dd>${esc(o.result || "No final result yet")}</dd></dl>${o.diagnostic ? `<div data-layout="layout-role-4">${Feedback(o.diagnostic.message, "error")}<p class="help mono">${esc(o.diagnostic.stage)} / ${esc(o.diagnostic.code)}</p></div>` : ""}</div><div class="section-footer"><span>Accepted operations continue independently of this page.</span>${o.state === "succeeded" ? NavLink("View Package", "/packages/" + encodeURIComponent(o.packageName), "btn secondary") : !running ? Button("Start a new submission", "retry-operation", "secondary", `data-id="${o.id}"`) : Button("Copy Operation ID", "copy", "secondary", `data-value="${o.id}"`)}</div>`) +
        Section("Public technical details", "No raw script logs are exposed.", Disclosure("View safe operation fields", `<pre>${esc(JSON.stringify({ id: o.id, scope: "core", state: o.state, packagePhase: o.packagePhase, packageName: o.packageName, createdAt: o.createdAt, updatedAt: o.updatedAt, result: o.result, diagnostic: o.diagnostic ?? null }, null, 2))}</pre>`)));
}
let dialogOriginQuery = "", addDefaultDraft = false, pendingSource = null;
function openDialog(title, description, body, submitLabel, action, kind = "primary", preserveDraft = false) {
    const active = document.activeElement;
    const origin = dialogOrigin || active;
    if (dialog)
        closeDialog(true);
    dialogOrigin = origin;
    dialogOriginQuery = origin?.dataset.action
        ? `[data-action="${origin.dataset.action}"]${origin.dataset.id ? `[data-id="${origin.dataset.id}"]` : origin.dataset.name ? `[data-name="${CSS.escape(origin.dataset.name)}"]` : ""}`
        : "";
    currentModalTitle = title;
    dialogAction = action;
    if (!preserveDraft)
        dialogDirty = false;
    dialog = document.createElement("dialog");
    dialog.setAttribute("aria-labelledby", "dialog-title");
    dialog.innerHTML = `<form id="dialog-form"><div class="dialog-heading"><div><h2 id="dialog-title">${esc(title)}</h2><p>${esc(description)}</p></div>${Button(icon("close", 17), "close-dialog", "icon-button", 'aria-label="Close dialog"')}</div><div class="dialog-body"><div id="dialog-feedback"></div>${body}</div><div class="dialog-footer">${Button("Cancel", "close-dialog", "secondary")}<button type="submit" class="btn ${kind}" id="dialog-submit">${esc(submitLabel)}</button></div></form>`;
    document.body.append(dialog);
    dialog.addEventListener("cancel", (event) => {
        if (submissionPending) {
            event.preventDefault();
            return;
        }
        event.preventDefault();
        closeDialog();
    });
    trapDialogFocus(dialog);
    dialog.showModal();
    const focus = kind === "danger"
        ? dialog.querySelector('[data-action="close-dialog"]')
        : dialog.querySelector("input:not([type=hidden]),select,textarea,button[type=submit]");
    setTimeout(() => focus?.focus(), 0);
}
function closeDialog(force = false) {
    if (submissionPending && !force)
        return;
    selectionVersion++;
    preflightPending = false;
    if (force)
        submissionPending = false;
    const origin = dialogOrigin;
    const query = dialogOriginQuery;
    dialog?.close();
    dialog?.remove();
    dialog = null;
    dialogAction = null;
    dialogDirty = false;
    dialogOrigin = null;
    modalError = "";
    if (!force) {
        upload = null;
        packageIntent = null;
        intentLocked = false;
        packageSourceDraft = "";
        if (origin?.isConnected)
            origin.focus();
        else if (query)
            document.querySelector(query)?.focus();
    }
}
function dialogFeedback(message, tone = "error", buttons = "") {
    for (const record of actions.records.values())
        if (record.pending && record.anchor === "#dialog-submit" && record.view === path)
            actions.fail(record, new Error(message));
    const el = document.querySelector("#dialog-feedback");
    if (el) {
        el.innerHTML = Feedback(message, tone, buttons);
        el.scrollIntoView({ block: "nearest" });
    }
}
function dialogBusy(busy, label = "Saving…") {
    submissionPending = busy;
    dialog?.querySelectorAll("button").forEach((b) => {
        b.disabled = busy;
    });
    const submit = document.querySelector("#dialog-submit");
    if (submit && busy)
        submit.textContent = label;
}
function createUserDialog() {
    openDialog("Create user", "Create an account on this Core.", `<div class="form-grid">${Field("new-account", "Account", Input("new-account", "", 'required maxlength="128" autocomplete="off" placeholder="e.g. jamie.chen"'), "1–128 characters. Start with a letter or number. Then use letters, numbers, . _ : or -.")}${Field("new-password", "Password", Input("new-password", "", 'type="password" required minlength="12" maxlength="1024" autocomplete="new-password"'), "Between 12 and 1,024 characters.")}${Field("confirm-password", "Confirm password", Input("confirm-password", "", 'type="password" required minlength="12" autocomplete="new-password"'))}${Field("new-role", "Role", '<select id="new-role" name="new-role"><option>User</option><option>Administrator</option></select>', "Users access their Work through PiWork Desktop or the user CLI. Administrators can also use this console.")}</div>`, "Create user", async (form) => {
        const password = String(form.get("new-password"));
        if (password !== form.get("confirm-password")) {
            setFieldError("confirm-password", "Passwords do not match. Enter both passwords again.");
            clearModalPasswords();
            return;
        }
        dialogBusy(true, "Creating…");
        try {
            const u = await awaitCurrent(adapter.createUser({
                account: String(form.get("new-account")),
                password,
                role: String(form.get("new-role")),
            }));
            dialogBusy(false);
            closeDialog(true);
            lastCreatedUser = u;
            feedback = Feedback(`Account ${u.account} created. ${u.role === "Administrator" ? "This administrator can sign in to this console." : "Use PiWork Desktop or the user CLI to sign in."}`, "success");
            renderPage();
            void refreshConfirmed(`Account ${u.account} created. ${u.role === "Administrator" ? "This administrator can sign in to this console." : "Use PiWork Desktop or the user CLI to sign in."}`, async () => { users = await awaitCurrent(adapter.users()); });
        }
        catch (e) {
            if (e instanceof ConsoleViewChanged)
                return;
            dialogBusy(false);
            clearModalPasswords();
            if (isSessionError(e))
                return;
            dialogFeedback(err(e), "error", e instanceof ConsoleError && e.code === "RESULT_UNKNOWN"
                ? Button("Refresh Users", "close-refresh", "secondary")
                : "");
            const submit = document.querySelector("#dialog-submit");
            if (submit) {
                submit.textContent = "Create user";
                if (e instanceof ConsoleError && e.code === "RESULT_UNKNOWN")
                    submit.disabled = true;
            }
            if (e instanceof ConsoleError && e.code === "ACCOUNT_INVALID")
                setFieldError("new-account", e.message);
        }
    });
}
function clearModalPasswords() {
    dialog
        ?.querySelectorAll("input[type=password]")
        .forEach((i) => (i.value = ""));
}
function setFieldError(id, message) {
    const input = document.getElementById(id);
    const error = document.getElementById(id + "-error");
    if (input) {
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", id + "-error");
        input.classList.add("error-border");
        input.focus();
    }
    if (error) {
        error.textContent = message;
        error.hidden = false;
    }
}
function userActionDialog(id, action) {
    const u = users.find((u) => u.id === id);
    if (!u)
        return;
    const title = action === "reset"
        ? "Reset password"
        : action === "disable"
            ? "Disable account"
            : "Enable account";
    const impact = action === "enable"
        ? "Old sessions will not be restored. The user must sign in again."
        : "All sessions for this account will be revoked.";
    openDialog(`${title}: ${u.account}`, impact, `<p class="break">${action === "reset" ? "Set a new password for" : action === "disable" ? "Disable" : "Enable"} <strong>${esc(u.account)}</strong>.</p>${u.id === adapter.currentUserId && action !== "enable" ? Feedback("This is your account. After Core confirms the change, you will return to sign in.", "warning") : ""}${action === "reset" ? `<div data-layout="layout-role-5">${Field("reset-password", "New password", Input("reset-password", "", 'type="password" required minlength="12" maxlength="1024" autocomplete="new-password"'), "Between 12 and 1,024 characters.")}${Field("reset-confirm", "Confirm password", Input("reset-confirm", "", 'type="password" required minlength="12" autocomplete="new-password"'))}</div>` : `<p class="help" data-layout="layout-role-2">${action === "disable" ? "At least one enabled administrator must remain. The account changes only after Core confirms." : impact}</p>`}`, title, async (form) => {
        if (action === "reset" &&
            form.get("reset-password") !== form.get("reset-confirm")) {
            setFieldError("reset-confirm", "Passwords do not match. Enter both passwords again.");
            clearModalPasswords();
            return;
        }
        dialogBusy(true);
        try {
            const result = await awaitCurrent(adapter.userAction(id, action, String(form.get("reset-password") || "")), true);
            dialogBusy(false);
            closeDialog(true);
            if (result.selfRevoked) {
                dirty = false;
                path = "/login";
                history.pushState({ path }, "", path);
                feedback = Feedback("Account updated. All your sessions were revoked. Sign in again.", "success");
                renderPage();
                return;
            }
            feedback = Feedback(`${u.account}: ${action === "reset" ? "password reset" : action === "disable" ? "account disabled" : "account enabled"}. ${impact}`, "success");
            renderPage();
            void refreshConfirmed(`${u.account}: ${action === "reset" ? "password reset" : action === "disable" ? "account disabled" : "account enabled"}. ${impact}`, async () => { users = await awaitCurrent(adapter.users(), true); });
        }
        catch (e) {
            if (e instanceof ConsoleViewChanged)
                return;
            dialogBusy(false);
            clearModalPasswords();
            if (isSessionError(e))
                return;
            dialogFeedback(err(e), "error", e instanceof ConsoleError && e.code === "USER_NOT_FOUND"
                ? Button("Refresh Users", "close-refresh", "secondary")
                : "");
            const submit = document.querySelector("#dialog-submit");
            if (submit)
                submit.textContent = title;
        }
    }, action === "enable" ? "primary" : "danger");
}
function catalogActionDialog(kind, name, action) {
    const noun = kind === "skills" ? "Skill" : "Package";
    const danger = action !== "enable";
    openDialog(`${action === "enable" ? "Enable" : action === "disable" ? "Disable" : "Remove"} ${noun}`, `${name}`, `<p class="break">${action === "remove" ? "Remove" : action === "disable" ? "Disable" : "Enable"} <strong>${esc(name)}</strong> ${action === "remove" ? "from the Core catalog" : action === "disable" ? "for future selection" : "for future selection"}?</p><p class="help" data-layout="layout-role-2">${action === "enable" ? "This does not restore or modify any Work copies." : "Existing Work copies remain unchanged. Default Work references must be removed separately before this action."}</p>${action === "remove" ? `<div data-layout="layout-role-5">${Field("confirm-name", "Type the name to confirm", Input("confirm-name", "", 'required autocomplete="off"'), esc(name))}</div>` : ""}`, `${action === "enable" ? "Enable" : action === "disable" ? "Disable" : "Remove"} ${noun}`, async (form) => {
        if (action === "remove" && form.get("confirm-name") !== name) {
            setFieldError("confirm-name", "The name does not match.");
            return;
        }
        dialogBusy(true);
        try {
            await awaitCurrent(adapter.catalogAction(kind, name, action));
            if (referenceReturn?.name === name && referenceReturn.kind === kind)
                referenceReturn = null;
            dialogBusy(false);
            closeDialog(true);
            feedback = Feedback(`${name} ${action === "remove" ? "removed" : action === "disable" ? "disabled" : "enabled"}. Existing Work copies are unchanged.`, "success");
            confirmedMutation(`${name} ${action === "remove" ? "removed" : action === "disable" ? "disabled" : "enabled"}. Existing Work copies are unchanged.`);
            if (action === "remove") {
                path = "/" + kind;
                history.pushState({ path }, "", path);
            }
            renderPage();
            void refreshConfirmed(`${name} ${action === "remove" ? "removed" : action === "disable" ? "disabled" : "enabled"}. Existing Work copies are unchanged.`, async () => { if (kind === "skills")
                skills = await awaitCurrent(adapter.skills());
            else
                packages = await awaitCurrent(adapter.packages()); });
        }
        catch (e) {
            if (e instanceof ConsoleViewChanged)
                return;
            dialogBusy(false);
            if (isSessionError(e))
                return;
            if (e instanceof ConsoleError && e.code === "DEFAULT_REFERENCE")
                referenceReturn = { kind, name, action };
            dialogFeedback(err(e), "error", e instanceof ConsoleError && e.code === "DEFAULT_REFERENCE"
                ? Button("Review default reference", "resolve-default-reference", "secondary")
                : e instanceof ConsoleError && e.code === "PACKAGE_BUSY"
                    ? NavLink("Find Operation", "/operations", "btn secondary")
                    : "");
            const submit = document.querySelector("#dialog-submit");
            if (submit)
                submit.textContent =
                    `${action === "enable" ? "Enable" : action === "disable" ? "Disable" : "Remove"} ${noun}`;
        }
    }, danger ? "danger" : "primary");
}
function uploadChooser(type, target, keep = false) {
    if (!keep) {
        upload = null;
        packageIntent = null;
        intentLocked = false;
        packageSourceDraft = "";
        addDefaultDraft = false;
        uploadKind = "npm";
    }
    uploadType = type;
    uploadTarget = target;
    const directorySupported = "webkitdirectory" in document.createElement("input");
    const selected = upload
        ? `<div class="upload-summary">${icon("box", 19)}<div><strong>${esc(upload.name)}</strong><p class="help">${esc(upload.summary)} · ${bytes(upload.bytes)}</p></div></div>`
        : "";
    const title = type === "skill"
        ? target
            ? "Update Skill directory"
            : "Add Skill"
        : target
            ? "Update Package"
            : "Install Package";
    const local = uploadKind === "Local directory" || uploadKind === "ZIP";
    const fileInput = type === "skill" || uploadKind === "Local directory"
        ? `<input type="file" id="upload-files" webkitdirectory directory multiple ${!directorySupported ? "disabled" : ""} aria-label="Choose ${type === "skill" ? "Skill" : "Package"} directory">`
        : '<input type="file" id="upload-files" accept=".zip,application/zip" aria-label="Choose Package ZIP">';
    const body = type === "skill"
        ? `${target ? `<p class="help" data-layout="layout-role-1">Immutable Skill name: <strong>${esc(target)}</strong></p>` : ""}<div class="upload-box">${icon("upload", 25)}<div><p>Choose a complete Skill directory</p>${fileInput}<p class="help">From this device. Root SKILL.md is required.</p></div></div>${!directorySupported ? Feedback("This browser does not support directory selection. Use a browser with directory upload support.", "warning") : ""}${selected}<ul class="file-limits"><li>Directory name is the Skill identity: lowercase letters, numbers, or hyphens; 1–64 characters.</li><li>Up to 2,048 ordinary files, 8 MiB per file, 32 MiB total.</li><li>Symlinks and special files are not supported. Core validates the complete content.</li></ul>`
        : `${target ? `<p class="help" data-layout="layout-role-1">Update target <strong>${esc(target)}</strong> cannot be changed. Enabled status and default references are preserved.</p>` : ""}<div class="source-options" role="group" aria-label="Package source">${["npm", "Git", "Local directory", "ZIP"].map((kind) => Button(kind, "package-source", "source-option" + (kind === uploadKind ? " active" : ""), `data-kind="${kind}" ${intentLocked ? "disabled" : ""}`)).join("")}</div><div id="source-confirm"></div>${local ? `<div class="upload-box">${icon("upload", 24)}<div><p>${uploadKind === "ZIP" ? "Choose a Package ZIP" : "Choose a Package directory"}</p>${fileInput}<p class="help">${uploadKind === "ZIP" ? "Core validates a single legal root and package.json.name." : "Root package.json is required. Identity comes from its name field."}</p></div></div>${selected}` : Field("package-source", "Source specification", Input("package-source", packageSourceDraft, `required placeholder="${uploadKind === "npm" ? "@scope/package@version" : "https://github.com/owner/repository.git#ref"}" ${intentLocked ? "disabled" : ""}`), uploadKind === "npm" ? "Enter the exact npm specification to install." : "Enter an explicit Git source and optional ref. Credentials must not be embedded in the URL.")}${!target ? `<label class="check-label" data-layout="layout-role-4"><input type="checkbox" id="add-default" ${addDefaultDraft ? "checked" : ""} ${intentLocked ? "disabled" : ""}><span>Add to Default Work after installation<br><span class="help">Installation and the default reference succeed or fail together.</span></span></label>` : ""}<ul class="file-limits"><li>ZIP ≤ 256 MiB; expanded content ≤ 1 GiB; each file ≤ 64 MiB.</li><li>Up to 100,000 entries and 64 levels. package.json ≤ 1 MiB.</li><li>Directory upload sends ordinary files only. Use ZIP when permissions or symlinks matter.</li><li>A .work migration file is not a Pi Package. Full validation is performed by Core.</li></ul>`;
    openDialog(title, type === "skill"
        ? "Upload from your browser’s device to the Core catalog."
        : "Choose a source explicitly. Uploading is not the same as publication.", body + `<div id="upload-stage"></div>`, type === "skill"
        ? "Upload Skill"
        : intentLocked
            ? "Resume this submission"
            : target
                ? "Submit update"
                : "Install Package", type === "skill" ? submitSkill : submitPackage, "primary", keep);
    if (intentLocked)
        dialog
            ?.querySelectorAll("input")
            .forEach((i) => (i.disabled = true));
}
async function submitSkill() {
    if (!upload) {
        dialogFeedback("Choose a valid Skill directory before uploading.");
        return;
    }
    dialogBusy(true, "Uploading…");
    const selection = upload;
    try {
        const s = await awaitCurrent(adapter.uploadSkill(selection, uploadTarget, (sent, total) => {
            const el = document.querySelector("#upload-stage");
            if (el)
                el.innerHTML =
                    sent === total
                        ? UploadProgress("Validating with Core", 0, 0)
                        : UploadProgress("Uploading", sent, total);
        }));
        dialogBusy(false);
        closeDialog(true);
        upload = null;
        dialogDirty = false;
        dirty = false;
        confirmedMutation(`Skill ${s.name} confirmed by Core. Existing Work copies are unchanged.`);
        path = "/skills/" + encodeURIComponent(s.name);
        history.pushState({ path }, "", path);
        feedback = Feedback(`Skill ${s.name} confirmed by Core. Existing Work copies are unchanged.`, "success");
        renderPage();
        void refreshConfirmed(`Skill ${s.name} confirmed by Core. Existing Work copies are unchanged.`, async () => { skills = await awaitCurrent(adapter.skills()); defaults = await awaitCurrent(adapter.defaults()); });
    }
    catch (e) {
        if (e instanceof ConsoleViewChanged)
            return;
        dialogBusy(false);
        if (isSessionError(e))
            return;
        const unknown = e instanceof ConsoleError &&
            ["RESULT_UNKNOWN", "UPLOAD_INTERRUPTED"].includes(e.code);
        dialogFeedback(err(e), unknown ? "warning" : "error", unknown
            ? Button("Read current Skill", "check-skill", "secondary", `data-name="${esc(selection.name)}"`)
            : "");
        const submit = document.querySelector("#dialog-submit");
        if (submit)
            submit.textContent = "Upload Skill";
        if (unknown)
            document.querySelector("#dialog-submit").disabled =
                true;
    }
}
async function submitPackage(form) {
    if (!intentLocked) {
        const local = uploadKind === "Local directory" || uploadKind === "ZIP";
        if (local && !upload) {
            dialogFeedback("Choose a valid Package " +
                (uploadKind === "ZIP" ? "ZIP" : "directory") +
                " before submitting.");
            return;
        }
        const source = local
            ? upload.summary
            : String(form.get("package-source") || packageSourceDraft).trim();
        if (!source) {
            setFieldError("package-source", "Enter an explicit source.");
            return;
        }
        if (/(?:https?:\/\/)[^\s/]+:[^\s/]+@/.test(source)) {
            setFieldError("package-source", "Do not include credentials in source URLs.");
            return;
        }
        const inferred = uploadKind === "npm"
            ? source.replace(/@[^@/]+$/, "")
            : uploadKind === "Git"
                ? source
                    .split("/")
                    .pop()
                    ?.replace(/\.git(?:#.*)?$/, "")
                    .replace(/#.*$/, "") || "package-from-git"
                : upload?.name || "Package pending Core identity";
        packageIntent = {
            key: crypto.randomUUID(),
            kind: uploadKind,
            source,
            name: uploadTarget || inferred,
            addDefault: uploadTarget
                ? false
                : !!document.querySelector("#add-default")?.checked,
            target: uploadTarget,
        };
        packageSourceDraft = source;
        intentLocked = true;
    }
    dialogBusy(true, "Submitting…");
    dialog
        ?.querySelectorAll("input")
        .forEach((i) => (i.disabled = true));
    try {
        const op = await awaitCurrent(adapter.submitPackage(packageIntent, (sent, total) => {
            const el = document.querySelector("#upload-stage");
            if (el)
                el.innerHTML =
                    sent === total
                        ? UploadProgress("Verifying and transmitting", 0, 0)
                        : UploadProgress("Uploading", sent, total);
        }, upload?.bytes || 0, upload ?? undefined));
        dialogBusy(false);
        closeDialog(true);
        upload = null;
        packageIntent = null;
        intentLocked = false;
        dirty = false;
        dialogDirty = false;
        path = "/operations/" + encodeURIComponent(op.id);
        history.pushState({ path }, "", path);
        operation = op;
        rememberedOperation = structuredClone(op);
        feedback = Feedback("Submission accepted. Save the Operation ID. Core will continue even if this console closes.", "success");
        renderPage();
        scheduleOperation();
    }
    catch (e) {
        if (e instanceof ConsoleViewChanged)
            return;
        dialogBusy(false);
        if (isSessionError(e))
            return;
        const ambiguous = e instanceof ConsoleError &&
            ["ACCEPTANCE_UNKNOWN", "UPLOAD_INTERRUPTED"].includes(e.code);
        dialogFeedback(err(e), ambiguous ? "warning" : "error", ambiguous
            ? ""
            : Button("Edit source as a new intent", "new-package-intent", "secondary"));
        document.querySelector("#dialog-submit").textContent =
            "Resume this submission";
        document.querySelector("#dialog-submit").disabled =
            !ambiguous;
        dialog
            ?.querySelectorAll('[data-action="package-source"]')
            .forEach((b) => (b.disabled = true));
        dialog
            ?.querySelectorAll("input")
            .forEach((i) => (i.disabled = true));
    }
}
async function refreshHealth(showNotice = true) {
    const origin = path;
    try {
        const fresh = await adapter.health();
        if (origin !== path)
            return;
        health = fresh;
        statusError = "";
        if (showNotice)
            feedback = Feedback("Core status refreshed.", "success");
        if (path === "/" || path === "/runtime")
            renderPage();
    }
    catch (e) {
        if (isSessionError(e))
            return;
        if (origin !== path)
            return;
        statusError = err(e);
        if (path === "/" || path === "/runtime")
            renderPage();
        if (showNotice)
            throw e;
    }
}
function scheduleOperation() {
    clearTimeout(pollTimer);
    if (operation?.state !== "running" || !path.startsWith("/operations/"))
        return;
    pollTimer = setTimeout(() => {
        if (document.visibilityState === "visible")
            void refreshOperation();
        else
            scheduleOperation();
    }, 2000);
}
async function refreshOperation(manual = false) {
    const id = routeId();
    try {
        const op = await adapter.operation(id);
        if (path !== "/operations/" + encodeURIComponent(id) && routeId() !== id)
            return;
        operation = op;
        rememberedOperation = structuredClone(op);
        feedback = "";
        renderPage();
        if (op.state === "running")
            scheduleOperation();
    }
    catch (e) {
        if (isSessionError(e))
            return;
        clearTimeout(pollTimer);
        feedback = Feedback("Observation interrupted. " + err(e), "warning", Button("Resume observation", "resume-observation", "secondary"));
        renderPage();
        if (manual)
            throw e;
    }
}
function changedDefaults() {
    if (!defaultDraft || !defaults)
        return false;
    return ["agentImage", "skills", "packages", "agentsMd"].some((k) => JSON.stringify(defaultDraft[k]) !==
        JSON.stringify(defaults[k]));
}
function updateDirty() {
    dirty = path === "/default-work" ? changedDefaults() : true;
    if (path === "/default-work") {
        defaultLastSaved = false;
        const review = document.querySelector("[data-action=review-defaults]");
        if (review)
            review.disabled = !dirty;
        const save = document.querySelector("[data-action=save-defaults]");
        if (save)
            save.disabled = saving || !dirty || readbackRequired || defaultConflicts.length > 0;
        const discard = document.querySelector("[data-action=discard-defaults]");
        if (discard)
            discard.disabled = !dirty;
        const label = document.querySelector("#dirty-label");
        if (label)
            label.textContent = dirty
                ? defaultChangedFields().length + " fields changed"
                : "No unsaved changes";
        document
            .querySelector(".draft-commit")
            ?.classList.toggle("has-changes", dirty);
    }
    const form = document.querySelector("#defaults-form");
    if (form) {
        const save = form.querySelector("button[type=submit]");
        if (save)
            save.disabled = saving || !dirty || readbackRequired;
        const discard = form.querySelector('[data-action="discard-defaults"]');
        if (discard)
            discard.disabled = !dirty;
        const label = document.querySelector("#dirty-label");
        if (label)
            label.textContent = dirty ? "Unsaved changes" : "No unsaved changes";
    }
    if (path === "/runtime") {
        const discard = document.querySelector('[data-action="discard-runtime"]');
        if (discard)
            discard.disabled = !dirty;
    }
}
async function readback() {
    if (path === "/runtime") {
        const draft = { ...runtimeDraft };
        try {
            runtime = await awaitCurrent(adapter.runtime());
            actions.reviewed(undefined, ['configuration'], path);
            readbackRequired = false;
            const matches = runtime &&
                Object.entries(draft).every(([k, v]) => runtime[k] === v);
            feedback = Feedback(matches
                ? "Current runtime matches the submitted non-sensitive fields. Credential availability is shown separately."
                : "Current runtime differs from the draft. Review the current values before deciding to save again.", matches ? "success" : "warning");
            renderPage();
        }
        catch (e) {
            if (e instanceof ConsoleViewChanged)
                return;
            showError(e);
        }
    }
    else if (path === "/default-work") {
        const draft = defaultDraft ? structuredClone(defaultDraft) : null;
        try {
            defaults = await awaitCurrent(adapter.defaults());
            actions.reviewed(undefined, ['configuration'], path);
            readbackRequired = false;
            dirty = changedDefaults();
            feedback = Feedback(dirty
                ? "Current defaults were read. The remaining draft differences are still unsaved."
                : "Current defaults match the draft. No additional save is needed.", dirty ? "warning" : "success");
            renderPage();
        }
        catch (e) {
            if (e instanceof ConsoleViewChanged)
                return;
            showError(e);
        }
    }
    else {
        dirty = false;
        await loadPage();
    }
}
async function saveRuntime(form) {
    const input = {
        agentImage: String(form.get("agentImage")).trim(),
        provider: String(form.get("provider")).trim(),
        modelId: String(form.get("modelId")).trim(),
        baseUrl: String(form.get("baseUrl")).trim(),
    };
    runtimeDraft = input;
    const submittedVersion = JSON.stringify(input), valid = currentView();
    for (const id of ["agentImage", "provider", "modelId"])
        if (!input[id]) {
            setFieldError(id, "This field is required.");
            return;
        }
    const key = String(form.get("apiKey") || "");
    if (!key) {
        setFieldError("apiKey", "Enter the complete API Key for this save.");
        return;
    }
    const submittedKeyField = document.querySelector('#apiKey');
    saving = true;
    const button = document.querySelector("#runtime-form button[type=submit]");
    button.disabled = true;
    button.textContent = "Saving…";
    try {
        runtime = await awaitCurrent(adapter.saveRuntime(input, key));
        if (submittedKeyField)
            submittedKeyField.value = '';
        dirty = JSON.stringify(runtimeDraft) !== submittedVersion;
        runtimeEditing = dirty;
        readbackRequired = false;
        confirmedMutation('Runtime saved');
        feedback = Feedback('Runtime saved. Verifying readiness.', 'success');
        renderPage();
        try {
            health = await awaitCurrent(adapter.health());
            statusError = "";
            feedback = Feedback(health.ready
                ? "Runtime saved. Core is ready."
                : "Runtime saved. Core is not ready yet. " + health.reason, health.ready ? "success" : "warning", NavLink("View Core status", "/", "btn secondary"));
        }
        catch (error) {
            if (error instanceof ConsoleViewChanged)
                return;
            statusError = "Current readiness could not be confirmed after saving.";
            feedback = Feedback("Runtime saved. Current readiness could not be confirmed.", "warning", NavLink("Refresh status", "/", "btn secondary"));
        }
    }
    catch (e) {
        if (e instanceof ConsoleViewChanged)
            return;
        if (isSessionError(e))
            return;
        for (const record of actions.records.values())
            if (record.pending && record.kind === 'configuration' && record.view === path)
                actions.fail(record, e);
        readbackRequired = e instanceof ConsoleError && e.code === "RESULT_UNKNOWN";
        feedback = Feedback(err(e), readbackRequired ? "warning" : "error", readbackRequired ? Button("Read current runtime", "readback") : "");
    }
    finally {
        if (valid())
            saving = false;
        if (submittedKeyField)
            submittedKeyField.value = '';
    }
    renderPage();
}
async function saveDefaults() {
    if (!defaults ||
        !defaultDraft ||
        !dirty ||
        readbackRequired ||
        defaultConflicts.length > 0)
        return;
    const d = structuredClone(defaultDraft), submittedVersion = JSON.stringify(defaultDraft), valid = currentView();
    if (!d.agentImage.trim()) {
        defaultEditSection = "agentImage";
        renderPage();
        setFieldError("default-image", "Enter an Agent image before saving.");
        return;
    }
    if (new TextEncoder().encode(d.agentsMd).length > 262144) {
        defaultEditSection = "agentsMd";
        renderPage();
        setFieldError("agentsMd", "AGENTS.md exceeds 256 KiB of UTF-8 text.");
        return;
    }
    const patch = {};
    ["agentImage", "skills", "packages", "agentsMd"].forEach((k) => {
        if (JSON.stringify(d[k]) !== JSON.stringify(defaults[k]))
            Object.assign(patch, { [k]: d[k] });
    });
    saving = true;
    renderPage();
    try {
        defaults = await awaitCurrent(adapter.saveDefaults(patch));
        if (JSON.stringify(defaultDraft) === submittedVersion) {
            defaultDraft = structuredClone(defaults);
            defaultEditSection = null;
        }
        confirmedMutation('Defaults saved. Only future Work is affected.');
        defaultLastSaved = true;
        dirty = changedDefaults();
        readbackRequired = false;
        feedback = Feedback("Defaults saved. Only future Work is affected.", "success");
    }
    catch (e) {
        if (e instanceof ConsoleViewChanged)
            return;
        if (isSessionError(e))
            return;
        for (const record of actions.records.values())
            if (record.pending && record.kind === 'configuration' && record.view === path)
                actions.fail(record, e);
        readbackRequired = e instanceof ConsoleError && e.code === "RESULT_UNKNOWN";
        feedback = Feedback(err(e), readbackRequired ? "warning" : "error", readbackRequired ? Button("Read current defaults", "readback") : "");
    }
    finally {
        if (valid())
            saving = false;
    }
    if (valid())
        renderPage();
}
async function importAgents(file, stillCurrent = () => true) {
    if (!defaultDraft)
        return;
    if (file.size > 262144) {
        feedback = Feedback("File exceeds the 256 KiB limit. The existing draft was preserved.", "error");
        renderPage();
        return;
    }
    let text;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    }
    catch {
        feedback = Feedback("Could not read this file as UTF-8. The existing draft was preserved.", "error");
        renderPage();
        return;
    }
    if (!stillCurrent())
        return;
    const apply = () => {
        if (!stillCurrent() || !defaultDraft)
            return;
        defaultDraft.agentsMd = text;
        dirty = changedDefaults();
        feedback = Feedback("File imported into the draft. Save defaults to persist it.", "info");
        renderPage();
    };
    if (defaultDraft.agentsMd !== defaults?.agentsMd) {
        openDialog("Replace the AGENTS.md draft?", "The imported file will replace your unsaved text.", '<p class="muted">Cancel keeps the current draft. Importing does not save to Core.</p>', "Replace draft", () => {
            closeDialog(true);
            apply();
        }, "danger");
    }
    else
        apply();
}
document.addEventListener("input", (event) => {
    const el = event.target;
    if (dialog?.contains(el)) {
        dialogDirty = true;
        if (el.id === "package-source")
            packageSourceDraft = el.value;
        return;
    }
    if (path === "/runtime" &&
        ["agentImage", "provider", "modelId", "baseUrl"].includes(el.id)) {
        Object.assign(runtimeDraft, { [el.id]: el.value });
        updateDirty();
    }
    if (path === "/runtime" && el.id === "apiKey")
        updateDirty();
    if (path === "/default-work" && defaultDraft) {
        if (el.id === "default-image") {
            defaultDraft.agentImage = el.value;
            updateDirty();
        }
        if (el.id === "agentsMd") {
            defaultDraft.agentsMd = el.value;
            updateDirty();
            const size = new TextEncoder().encode(el.value).length;
            const count = document.querySelector("#agents-count");
            if (count) {
                count.textContent = size.toLocaleString() + " / 262,144 UTF-8 bytes";
                count.classList.toggle("text-danger", size > 262144);
            }
        }
    }
});
document.addEventListener("change", async (event) => {
    const el = event.target;
    if (el.id === "add-default")
        addDefaultDraft = el.checked;
    if (el.dataset.defaultSkill && defaultDraft) {
        const name = el.dataset.defaultSkill;
        defaultDraft.skills = el.checked
            ? Array.from(new Set([...defaultDraft.skills, name]))
            : defaultDraft.skills.filter((s) => s !== name);
        dirty = changedDefaults();
        renderPage();
    }
    if (el.dataset.defaultPackage && defaultDraft) {
        const name = el.dataset.defaultPackage;
        if (el.checked && defaultDraft.packages.length >= 64) {
            el.checked = false;
            showToast("Select at most 64 Packages.");
            return;
        }
        defaultDraft.packages = el.checked
            ? [...defaultDraft.packages, name]
            : defaultDraft.packages.filter((x) => x !== name);
        dirty = changedDefaults();
        renderPage();
    }
    if ((el.id === 'agents-file' || el.id === 'upload-files') && el.files?.length) {
        const version = ++selectionVersion, previous = upload, previousDialog = dialog, previousPath = path;
        const type = uploadType, kind = uploadKind, target = uploadTarget, files = [...el.files];
        preflightPending = true;
        const submit = document.querySelector('#dialog-submit');
        if (submit)
            submit.disabled = true;
        const record = actions.begin({ key: `preflight:${version}`, kind: 'read', label: 'Checking selected files', target: files[0].name,
            anchor: el.id === 'upload-files' ? '#dialog-feedback' : '#defaults-form', view: path });
        try {
            if (el.id === 'agents-file')
                await importAgents(files[0], () => version === selectionVersion && previousPath === path);
            else {
                const selection = type === 'skill' ? await inspectSkillFiles(files, target) : await inspectPackageFiles(files, kind);
                if (version !== selectionVersion || previousDialog !== dialog || previousPath !== path)
                    return;
                if (target && type === 'package' && (kind === 'Local directory' || kind === 'ZIP') && selection.name !== target)
                    throw new ConsoleError('NAME_MISMATCH', 'package.json.name must match ' + target + '.');
                upload = selection;
                uploadChooser(type, target, true);
                dialogDirty = true;
            }
            actions.finish(record);
        }
        catch (error) {
            if (version !== selectionVersion || previousPath !== path || previousDialog !== dialog)
                return;
            upload = previous;
            actions.fail(record, error);
            dialogFeedback(err(error));
        }
        finally {
            if (version === selectionVersion) {
                preflightPending = false;
                if (submit?.isConnected)
                    submit.disabled = false;
            }
            actions.records.delete(record.key);
            renderConsoleActions();
        }
    }
});
document.addEventListener("submit", async (event) => {
    const form = event.target;
    event.preventDefault();
    if (form.id === "dialog-form") {
        if (!submissionPending && !preflightPending) {
            const submit = dialogAction, data = new FormData(form);
            await tracked({ key: `dialog:${path}:${currentModalTitle}`, kind: 'configuration', resource: currentModalTitle, label: 'Submitting', target: `${currentModalTitle} · ${routeId() || String(data.get('new-account') || upload?.name || packageSourceDraft || 'Core')}`, anchor: '#dialog-submit', view: path }, async () => { await submit?.(data); });
        }
        return;
    }
    if (form.id === "login-form") {
        if (signingIn)
            return;
        signingIn = true;
        const record = actions.begin({ key: "login", kind: "identity", label: "Signing in", target: "Administrator sign in", anchor: "#login-form", view: path });
        loginAccount = String(new FormData(form).get("account") || "");
        const password = form.querySelector("#password").value;
        const button = form.querySelector("button[type=submit]");
        button.disabled = true;
        button.textContent = "Signing in…";
        try {
            if (Date.now() < rateUntil) {
                const remaining = Math.ceil((rateUntil - Date.now()) / 1000);
                throw new ConsoleError("RATE_LIMITED", `Too many sign-in attempts. Try again in ${remaining} seconds.`);
            }
            await adapter.login(loginAccount, password);
            feedback = "";
            navigate("/", true);
        }
        catch (e) {
            if (record)
                actions.fail(record, e);
            if (e instanceof ConsoleError && e.code === "RATE_LIMITED")
                rateUntil = Date.now() + e.retryAfterMs;
            form.querySelector("#password").value = "";
            const message = e instanceof ConsoleError && e.code === "RATE_LIMITED"
                ? `Too many sign-in attempts. Try again in ${Math.max(1, Math.ceil((rateUntil - Date.now()) / 1000))} seconds.`
                : err(e);
            document.querySelector("#login-error").innerHTML = Feedback(message, "error", e instanceof ConsoleError && e.code === "CORE_UNREACHABLE"
                ? Button("Retry connection", "retry-connection", "secondary")
                : "");
            button.disabled = false;
            button.textContent = "Sign in";
            if (e instanceof ConsoleError && e.code === "RATE_LIMITED") {
                button.disabled = true;
                const timer = setInterval(() => {
                    const remaining = Math.max(0, Math.ceil((rateUntil - Date.now()) / 1000));
                    const area = document.querySelector("#login-error");
                    if (path !== "/login" || !area) {
                        clearInterval(timer);
                        return;
                    }
                    area.innerHTML = Feedback(remaining
                        ? `Too many sign-in attempts. Try again in ${remaining} seconds.`
                        : "You can try signing in again.", "warning");
                    if (!remaining) {
                        button.disabled = false;
                        clearInterval(timer);
                    }
                }, 1000);
            }
        }
        signingIn = false;
        if (record)
            actions.finish(record);
        return;
    }
    if (form.id === "runtime-form")
        await tracked({ key: 'save-runtime', kind: 'configuration', resource: 'runtime', label: 'Saving', target: 'Runtime', anchor: '#runtime-form', view: path }, async () => { await saveRuntime(new FormData(form)); });
    if (form.id === "defaults-form")
        await tracked({ key: 'save-defaults', kind: 'configuration', resource: 'defaults', label: 'Saving', target: 'Default Work', anchor: '#defaults-form', view: path }, async () => { await saveDefaults(); });
    if (form.id === "operation-find") {
        const id = String(new FormData(form).get("operation-id") || "").trim();
        if (id)
            navigate("/operations/" + encodeURIComponent(id));
    }
});
document.addEventListener("click", async (event) => {
    const element = event.target;
    const link = element.closest("a[data-nav]");
    if (link) {
        event.preventDefault();
        const target = link.getAttribute("href");
        if (path === "/default-work" &&
            link.closest(".context-tabs") &&
            (target === "/skills" || target === "/packages")) {
            openCapabilityLibrary(target.slice(1));
            return;
        }
        navigate(target);
        return;
    }
    const button = element.closest("[data-action]");
    if (!button || button.disabled)
        return;
    const intent = consoleIntent(button);
    if (intent)
        await tracked(intent, async () => { await handleConsoleAction(button); });
    else
        await handleConsoleAction(button);
});
async function handleConsoleAction(button) {
    const action = button.dataset.action;
    const name = button.dataset.name || "";
    if (action === "review-default-conflicts") {
        reviewDefaultConflicts();
    }
    else if (action === "resolve-default-conflicts-core") {
        if (defaults && defaultDraft)
            for (const key of defaultConflicts)
                Object.assign(defaultDraft, { [key]: structuredClone(defaults[key]) });
        defaultConflicts = [];
        dirty = changedDefaults();
        closeDialog(true);
        feedback = Feedback("Current Core values kept for conflicting fields. Your other draft edits are preserved.", "info");
        renderPage();
    }
    else if (action === "resolve-default-reference") {
        dialogDirty = false;
        closeDialog(true);
        navigate("/default-work", true);
    }
    else if (action === "open-capability-library") {
        openCapabilityLibrary(button.dataset.kind);
    }
    else if (action === "return-to-setup") {
        navigate("/default-work", true);
    }
    else if (action === "edit-runtime") {
        if (!runtimeEditing) {
            runtimeEditing = true;
            renderPage();
            document.querySelector("#agentImage")?.focus();
        }
    }
    else if (action === "cancel-runtime-edit") {
        const cancel = () => {
            dirty = false;
            runtimeEditing = false;
            runtimeDraft = runtime
                ? {
                    agentImage: runtime.agentImage,
                    provider: runtime.provider,
                    modelId: runtime.modelId,
                    baseUrl: runtime.baseUrl,
                }
                : { agentImage: "", provider: "", modelId: "", baseUrl: "" };
            renderPage();
        };
        if (dirty)
            confirmDiscard(cancel);
        else
            cancel();
    }
    else if (action === "verify-runtime") {
        await refreshHealth();
    }
    else if (action === "edit-defaults") {
        defaultEditSection = button.dataset.section;
        defaultLastSaved = false;
        renderPage();
        document
            .querySelector("#defaults-form input,#defaults-form textarea")
            ?.focus();
    }
    else if (action === "finish-default-edit") {
        defaultEditSection = null;
        renderPage();
    }
    else if (action === "review-defaults") {
        reviewDefaults();
    }
    else if (action === "save-defaults") {
        await saveDefaults();
    }
    else if (action === "dismiss-access-outcome") {
        lastCreatedUser = null;
        renderPage();
    }
    else if (action === "menu") {
        const nav = document.querySelector(".nav");
        nav?.classList.toggle("open");
        button.setAttribute("aria-expanded", String(nav?.classList.contains("open")));
    }
    else if (action === "close-dialog")
        closeDialog();
    else if (action === "copy") {
        try {
            await navigator.clipboard.writeText(button.dataset.value || "");
            showToast("Copied to clipboard");
        }
        catch {
            showToast("Clipboard unavailable. Select and copy the visible ID.");
        }
    }
    else if (action === "refresh") {
        if (dirty)
            confirmDiscard(() => {
                dirty = false;
                void tracked({ key: `manual:${path}:refresh`, kind: "read", label: "Reading current page", target: path, view: path }, async () => { await loadPage(); });
            });
        else
            await loadPage();
    }
    else if (action === "refresh-status")
        await refreshHealth();
    else if (action === "refresh-operation" || action === "resume-observation") {
        await refreshOperation(true);
    }
    else if (action === "sign-out") {
        const signOut = async () => {
            try {
                await adapter.signOut();
                dirty = false;
                upload = null;
                packageIntent = null;
                path = "/login";
                history.pushState({ path }, "", path);
                feedback = Feedback("Signed out. The console session was revoked.", "success");
                renderPage();
            }
            catch (e) {
                showError(new ConsoleError("SIGNOUT_FAILED", "Sign out was not completed because Core could not be reached. Retry sign out."));
            }
        };
        if (dirty)
            confirmDiscard(() => void signOut());
        else
            await signOut();
    }
    else if (action === "retry-connection") {
        try {
            await adapter.connection();
            feedback = Feedback("Core is reachable. You can sign in.", "success");
        }
        catch (e) {
            feedback = Feedback(err(e), "error", Button("Retry connection", "retry-connection", "secondary"));
        }
        renderPage();
    }
    else if (action === "create-user")
        createUserDialog();
    else if (action === "user-details") {
        expandedUser = expandedUser === button.dataset.id ? "" : button.dataset.id;
        renderPage();
    }
    else if (action === "user-toggle") {
        const u = users.find((u) => u.id === button.dataset.id);
        if (u)
            userActionDialog(u.id, u.enabled ? "disable" : "enable");
    }
    else if (action === "user-reset")
        userActionDialog(button.dataset.id, "reset");
    else if (action === "close-refresh") {
        closeDialog(true);
        void loadPage();
    }
    else if (action === "discard-runtime" || action === "discard-defaults")
        confirmDiscard(() => {
            dirty = false;
            void loadPage();
        });
    else if (action === "readback")
        await readback();
    else if (action === "clear-skills" && defaultDraft) {
        defaultDraft.skills = [];
        dirty = changedDefaults();
        renderPage();
    }
    else if (action === "clear-packages" && defaultDraft) {
        defaultDraft.packages = [];
        dirty = changedDefaults();
        renderPage();
    }
    else if (action === "move-skill" && defaultDraft) {
        const i = defaultDraft.skills.indexOf(name), j = i + (button.dataset.direction === "up" ? -1 : 1);
        if (i >= 0 && j >= 0 && j < defaultDraft.skills.length) {
            [defaultDraft.skills[i], defaultDraft.skills[j]] = [
                defaultDraft.skills[j],
                defaultDraft.skills[i],
            ];
            dirty = changedDefaults();
            renderPage();
            document
                .querySelector(`[data-action="move-skill"][data-name="${CSS.escape(name)}"][data-direction="${button.dataset.direction}"]`)
                ?.focus();
        }
    }
    else if (action === "remove-default-skill" && defaultDraft) {
        defaultDraft.skills = defaultDraft.skills.filter((s) => s !== name);
        dirty = changedDefaults();
        renderPage();
    }
    else if (action === "add-skill")
        uploadChooser("skill");
    else if (action === "update-skill")
        uploadChooser("skill", name);
    else if (action === "install-package")
        uploadChooser("package");
    else if (action === "update-package")
        uploadChooser("package", name);
    else if (action === "catalog-toggle") {
        const kind = button.dataset.kind;
        const item = (kind === "skills" ? skills : packages).find((s) => s.name === name);
        if (item)
            catalogActionDialog(kind, name, item.enabled ? "disable" : "enable");
    }
    else if (action === "catalog-remove")
        catalogActionDialog(button.dataset.kind, name, "remove");
    else if (action === "package-source") {
        const kind = button.dataset.kind;
        if (kind === uploadKind)
            return;
        if (upload) {
            pendingSource = kind;
            document.querySelector("#source-confirm").innerHTML = Feedback("Switching sources will discard the selected files.", "warning", Button("Keep current source", "keep-source") +
                Button("Discard files and switch", "discard-source", "danger"));
        }
        else {
            uploadKind = kind;
            packageSourceDraft = "";
            uploadChooser("package", uploadTarget, true);
        }
    }
    else if (action === "keep-source") {
        pendingSource = null;
        document.querySelector("#source-confirm").innerHTML = "";
    }
    else if (action === "discard-source") {
        upload = null;
        packageSourceDraft = "";
        uploadKind = pendingSource;
        pendingSource = null;
        uploadChooser("package", uploadTarget, true);
    }
    else if (action === "new-package-intent") {
        intentLocked = false;
        packageIntent = null;
        uploadChooser("package", uploadTarget, true);
    }
    else if (action === "check-skill") {
        dialogDirty = false;
        closeDialog(true);
        navigate("/skills/" + encodeURIComponent(name), true);
    }
    else if (action === "retry-operation") {
        const op = adapter.store.operations.find((o) => o.id === button.dataset.id);
        if (op) {
            uploadChooser("package", op.target);
            uploadKind = op.sourceKind;
            packageSourceDraft = op.source;
            uploadChooser("package", op.target, true);
        }
    }
}
history.replaceState({ path }, "", path);
void adapter.initialize().then(async () => { await adapter.connection().catch(() => undefined); await loadPage(); }).catch(async () => { path = "/login"; history.replaceState({ path }, "", path); try {
    await adapter.initialize();
}
catch { /* availability shown by login */ } await loadPage(); });
window.addEventListener('pagehide', () => { actions.clear(); clearPolling(); selectionVersion++; preflightPending = false; });
//# sourceMappingURL=app.js.map