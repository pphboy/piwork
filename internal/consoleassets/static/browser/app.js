import { createLanguagePicker } from './i18n.js';
import { readWithDeadline } from './read-deadline.js';
import { pendingDots } from './pending.js';
import { mountQuickSetup } from './quick-setup.js';
import { randomUUID } from './browser-crypto.js';
import { packagePhaseView, packageSteps } from './package-phase.js';
import { ModelManagement } from './model-management.js';
import { ActionState, renderActionStates } from './action-state.js';
import { adapter, ConsoleError, inspectSkillFiles, inspectPackageFiles, } from "./adapter.js";
import { t, onLocaleChange, chooseLocale, languageChoices, applyDocumentTitle, formatDateTime, formatNumber, } from './locale.js';
import { esc, icon, Button, NavLink, StatusLabel, Feedback, PageHeader, Section, Field, Input, DataTable, date, bytes, Disclosure, Copy, Empty, UploadProgress, } from "./components.js";
const app = document.querySelector("#app");
const hosted = document.querySelector('meta[name="piwork-mode"]')?.getAttribute('content') === 'hosted';
const routePath = (value) => hosted && (value === '/admin' || value.startsWith('/admin/')) ? value.slice(6) || '/' : value;
const publicPath = (value) => hosted ? '/admin' + (value === '/' ? '' : value) : value;
// Catalog keys resolved on each render so a language switch updates page titles.
const modules = [
    ["module.status", "/"],
    ["module.about", "/about"],
    ["module.users", "/users"],
    ["term.runtime", "/runtime"],
    ["module.quickSetup", "/setup"],
    ["module.models", "/models"],
    ["term.defaultWork", "/default-work"],
    ["module.skills", "/skills"],
    ["module.packages", "/packages"],
    ["module.findOperation", "/operations"],
];
const moduleTitle = (value, fallback) => {
    const entry = modules.find(([, url]) => url === value);
    return entry ? t(entry[0]) : fallback;
};
onLocaleChange(() => {
    const password = document.querySelector('#login-form #password')?.value;
    if (feedbackRenderer && feedback === renderedFeedback)
        feedback = renderedFeedback = feedbackRenderer();
    else
        feedbackRenderer = null;
    if (statusErrorRenderer && statusError === renderedStatusError)
        statusError = renderedStatusError = statusErrorRenderer();
    else
        statusErrorRenderer = null;
    renderPage();
    const input = document.querySelector('#login-form #password');
    if (input && password !== undefined)
        input.value = password;
});
if (hosted && location.hash)
    history.replaceState(null, '', location.pathname + location.search);
let quickSetup = null;
let pageURL = location.pathname + location.search;
let path = routePath(location.pathname), loadId = 0, feedback = "", health = null, statusError = "", users = [], skills = [], packages = [], runtime = null, defaults = null, defaultDraft = null, runtimeDraft = { agentImage: "", provider: "", modelId: "", baseUrl: "", modelRef: "" }, operation = null;
// Retain the identity of localized notices without changing the existing HTML
// feedback contract. A later unrelated notice supersedes this renderer.
let feedbackRenderer = null;
let renderedFeedback = '';
let statusErrorRenderer = null;
let renderedStatusError = '';
function localizedFeedback(render) {
    feedbackRenderer = render;
    return renderedFeedback = render();
}
function localizedStatusError(render) {
    statusErrorRenderer = render;
    return renderedStatusError = render();
}
let dirty = false, saving = false, readbackRequired = false, expandedUser = "", pollTimer, statusTimer, toastTimer;
let dialog = null, dialogOrigin = null, dialogAction = null, dialogDirty = false, upload = null, uploadKind = "npm", uploadTarget, uploadType = "skill", packageIntent = null, packageSourceDraft = "", intentLocked = false, rateUntil = 0, loginAccount = "";
let defaultConflicts = [];
let setupJourney = null;
let productInfo = null;
let runtimeEditing = false, defaultEditSection = null, defaultLastSaved = false, overviewDataConfirmed = false, rememberedOperation = null, lastCreatedUser = null, referenceReturn = null;
let pendingNavigation = null, modalError = "", currentModalTitle = "", submissionPending = false;
let preflightPending = false, selectionVersion = 0, signingIn = false, loginOutcomeUnknown = false, loginRecoverySequence = 0;
const actions = new ActionState(() => renderConsoleActions());
const modelManagement = new ModelManagement(() => { if (path === '/models' || path.startsWith('/models/'))
    renderPage(); }, value => { dirty = value; }, (error, identity) => isCurrentSessionError(error, identity), openModelTestDialog);
let modelCatalogError = '';
let shellView = '', pageConfirmedAt = '', preparation = null;
let pageRead = null;
let pageRetryCycle = 0, pageRetryAttempt = 0, pageRetryTimer;
let healthRead = null;
let operationRead = null;
let releaseAgentImage = '', runtimeDefaultsError = '';
let actionIdentity = adapter.identityEpoch;
const manualLabelKeys = { 'save-defaults': 'intent.savingDefaults', refresh: 'intent.readingPage', 'verify-runtime': 'intent.verifyingRuntime', 'refresh-status': 'intent.checkingStatus', 'refresh-operation': 'intent.checkingOperation', 'resume-observation': 'intent.resumingObservation', readback: 'intent.readingConfiguration', 'sign-out': 'intent.signingOut', 'retry-connection': 'intent.checkingConnection' };
function consoleIntent(button) {
    if (button.closest('#quick-setup'))
        return;
    const name = button.dataset.action || '', label = manualLabelKeys[name] ? t(manualLabelKeys[name]) : undefined;
    if (!label)
        return;
    if (name === 'save-defaults')
        return { key: 'save-defaults', kind: 'configuration', resource: 'defaults', label, target: t('term.defaultWork'), anchor: '[data-action="save-defaults"]', view: path };
    return { key: name === 'sign-out' ? `manual:${path}:${name}` : `read:${path}`, kind: name === 'sign-out' ? 'identity' : 'read', label, target: path.startsWith('/operations/') ? routeId() : name === 'sign-out' ? adapter.account : path === '/runtime' ? t('term.runtime') : path === '/default-work' ? t('term.defaultWork') : t('term.core'), anchor: `[data-action="${name}"]`, view: path };
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
    if (previous?.blocked && (document.querySelector('#dialog-submit')?.dataset.resumeSubmission === 'true' || /Resume this submission/.test(document.querySelector('#dialog-submit')?.textContent || '')))
        previous.blocked = false;
    const conflict = actions.conflict(intent);
    if (conflict) {
        showToast(t('conflict.waiting', { target: conflict.target }));
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
async function refreshConfirmed(message, read, destination = path, translate = () => message) {
    if (destination !== path)
        return;
    const record = confirmedMutation(message) || [...actions.records.values()].find(record => record.result === message);
    if (record)
        record.resultText = translate;
    feedback = localizedFeedback(() => Feedback(translate(), 'success'));
    renderPage();
    if (record) {
        await actions.refresh(record, read);
        if (destination === path && actions.current(record)) {
            if (record.refresh === 'failed') {
                feedback = localizedFeedback(() => Feedback(t('refresh.notConfirmed', { message: translate(), error: record.refreshErrorText?.() ?? record.refreshError ?? '' }), 'warning', Button(t('refresh.retry'), 'readback', 'secondary')));
            }
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
                feedback = localizedFeedback(() => Feedback(t('refresh.notConfirmed', { message: translate(), error: err(error) }), 'warning', Button(t('refresh.retry'), 'readback', 'secondary')));
                renderPage();
            }
        }
    }
}
const languagePicker = createLanguagePicker({ choices: languageChoices, label: () => t('lang.menu'), onChoose: locale => {
        const account = document.querySelector('#login-form #account');
        if (account)
            loginAccount = account.value;
        chooseLocale(locale);
    } });
function languageButtons() {
    return `<button type="button" class="btn ghost small language-trigger" data-action="language" data-language-trigger="login" aria-haspopup="listbox" aria-expanded="${languagePicker.isOpen}">${icon('globe', 16)}<span>${t('lang.menu')}</span>${icon('down', 12)}</button>`;
}
function accountMenuContent() {
    const selected = languageChoices().find(choice => choice.selected)?.label || '';
    const language = `<button class="btn quiet language-trigger" type="button" role="menuitem" data-action="language" data-language-trigger="account" tabindex="-1" aria-haspopup="listbox" aria-expanded="false">${icon('globe', 18)}<span>${t('lang.menu')}</span><span class="language-current">${esc(selected)}</span>${icon('chevron', 14)}</button>`;
    return `<div class="dropdown-title">${esc(adapter.account)}</div><div class="modal-body"><p class="account-context"><span>${t('shell.roleAdmin')}</span><span title="${esc(adapter.coreUrl)}">${t('shell.coreWithValue', { value: esc(adapter.coreUrl || t('shell.unavailable')) })}</span></p><div class="menu-list"><a class="btn" href="/about" data-nav role="menuitem" tabindex="-1">${icon('info', 18)} ${t('shell.aboutPiwork')}</a><div class="menu-separator" role="separator"></div>${language}<button class="btn danger quiet" type="button" data-action="sign-out" role="menuitem" tabindex="-1">${icon('logout', 18)} ${t('shell.signOut')}</button></div></div>`;
}
function shell(body) {
    const view = `${adapter.identityEpoch}:${loadId}:${path}`;
    const preserve = shellView === view;
    // Same-view reads must preserve both the open surface and its trigger's state.
    const accountOpen = preserve && app.querySelector('#account-dropdown')?.hidden === false;
    const navigationOpen = preserve && !!app.querySelector('.nav')?.classList.contains('open');
    if (!preserve)
        closeAccountMenu();
    const login = path === "/login", workSetup = ["/default-work", "/skills", "/packages"].some((p) => path === p || path.startsWith(p + "/"));
    const nav = [
        [t('shell.navOverview'), "/", path === "/" || path === "/runtime" || hosted && path === "/setup"],
        [t('shell.navUsers'), "/users", path === "/users"],
        [t('shell.navWorkSetup'), "/default-work", workSetup],
        [t('shell.navModels'), "/models", path === '/models' || path.startsWith('/models/')],
    ];
    const html = `<header class="topbar task-shell"><div class="topbar-inner"><a class="brand" href="/" data-nav aria-label="${t('shell.brandOverview')}"><img class="brand-logo" src="/piwork-logo.png" alt="" width="40" height="40"><span class="brand-divider"></span><span class="brand-sub">${t('term.core')}</span></a>${login ? `<div class="topbar-right">${languageButtons()}</div>` : `<nav class="nav${navigationOpen ? " open" : ""}" aria-label="${t('shell.mainNavigation')}">${nav.map(([name, url, active]) => `<a href="${url}" data-nav class="${active ? "active" : ""}" ${active ? 'aria-current="page"' : ""}>${name}</a>`).join("")}</nav><a href="/operations" data-nav class="operation-utility ${path.startsWith("/operations") ? "active" : ""}">${icon("search", 14)} ${t('shell.findOperation')}</a><button class="btn ghost mobile-menu" data-action="menu" aria-label="${t('shell.openNavigation')}" aria-expanded="${navigationOpen}">${t('shell.menu')} ${icon("down", 14)}</button><div class="topbar-account">${hosted ? `<a class="btn ghost small workbench-link" href="/" data-workbench>${icon('grid', 16)}<span>${t('shell.workbench')}</span></a>` : ''}<div class="account-menu"><button type="button" id="account-trigger" class="btn ghost account-button" aria-label="${t('shell.accountMenu')}" aria-haspopup="menu" aria-expanded="${accountOpen}" aria-controls="account-dropdown"><span class="avatar">${esc(adapter.account.slice(0, 2).toUpperCase())}</span>${icon("down", 12)}</button><div id="account-dropdown" class="admin-account-dropdown command-dropdown" role="menu" aria-label="${t('shell.accountMenu')}" hidden>${accountMenuContent()}</div></div></div>`}</div></header>${login ? "" : `<div class="context-strip">${icon("server", 15)}<span>${t('term.core')}</span><span class="context-tag">${t('shell.administrator')}</span><span class="context-end">${path === "/setup" && hosted ? t('module.quickSetup') : path === "/runtime" ? t('term.runtime') : path === "/models" || path.startsWith("/models/") ? t('module.models') : workSetup ? t('shell.navWorkSetup') : path === "/users" ? t('shell.navUsers') : path === "/about" ? t('module.about') : path.startsWith("/operations") ? t('shell.contextPackageRecovery') : t('shell.navOverview')}</span></div>`}<main id="main" class="main task-main" tabindex="-1"><div id="page-read-status" class="page-read-status" aria-live="polite"></div>${body}</main><footer class="footer"><span>${icon("shield", 13)} ${t('shell.footerIndependence')}</span><span>${t('shell.footerProduct')} </span></footer><div id="toast-root" aria-live="polite"></div>`;
    if (preserve)
        reconcileConsoleHTML(app, html);
    else
        app.innerHTML = html;
    shellView = view;
    if (hosted) {
        app.querySelectorAll('a[data-nav]').forEach(link => { const value = link.getAttribute('href') || ''; if (value.startsWith('/') && !value.startsWith('/admin'))
            link.setAttribute('href', publicPath(value)); });
        app.querySelectorAll('img[src="/piwork-logo.png"]').forEach(image => { image.src = '/admin/piwork-logo.png'; });
        const footer = app.querySelector('.footer span');
        if (footer)
            footer.textContent = t('shell.footerHosted');
    }
    applyDocumentTitle(t('title.format', { page: login ? t('title.signIn') : path === "/" ? t('title.overview') : moduleTitle(path, t('title.details')) }));
    startStatusTimer();
}
/** Same-view rendering borrows Desktop's small DOM reconciler; navigation still creates a fresh view. */
function reconcileConsoleHTML(parent, html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const focused = document.activeElement;
    const selection = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement
        ? { start: focused.selectionStart, end: focused.selectionEnd, direction: focused.selectionDirection } : null;
    const scroll = [...parent.querySelectorAll('*')].filter(node => node.scrollTop || node.scrollLeft).map(node => ({ node, top: node.scrollTop, left: node.scrollLeft }));
    const x = window.scrollX, y = window.scrollY;
    const key = (node) => {
        if (!(node instanceof Element))
            return `#${node.nodeType}`;
        if (node.id)
            return `id:${node.id}`;
        if (node.hasAttribute('data-action-status'))
            return `status:${node.getAttribute('data-action-status')}`;
        if (node.matches('button[data-action],button[data-model-action]'))
            return `action:${['action', 'model-action', 'id', 'name', 'direction', 'section', 'kind', 'locale'].map(name => node.getAttribute('data-' + name) || '').join(':')}`;
        if (node.matches('input,select,textarea'))
            return `${node.tagName}:${node.getAttribute('name') || node.getAttribute('data-default-skill') || node.getAttribute('data-default-package') || ''}`;
        if (node instanceof HTMLAnchorElement)
            return `link:${routePath(node.getAttribute('href') || '')}`;
        if (node instanceof HTMLDetailsElement)
            return `details:${node.querySelector('summary')?.textContent}`;
        if (node.tagName === 'SECTION')
            return node.querySelector('[data-model-form]') ? 'section:model-form' : `section:${node.querySelector('h2')?.textContent}`;
        return `${node.tagName}:${node.getAttribute('class')?.split(' ')[0] || ''}`;
    };
    const patch = (target, incoming) => {
        if (target instanceof Element && incoming instanceof Element) {
            // The action renderer owns its stable status regions and the open account menu.
            if (target.id === 'page-read-status' || target.id === 'toast-root' || target.id === 'account-dropdown' || target.hasAttribute('data-action-status'))
                return;
            for (const attr of [...target.attributes])
                if (!incoming.hasAttribute(attr.name) && !(target instanceof HTMLDetailsElement && attr.name === 'open') && !attr.name.startsWith('data-action-') && !(target === focused && ['aria-invalid', 'aria-errormessage'].includes(attr.name)))
                    target.removeAttribute(attr.name);
            for (const attr of [...incoming.attributes])
                if (target.getAttribute(attr.name) !== attr.value)
                    target.setAttribute(attr.name, attr.value);
            if (target instanceof HTMLInputElement && incoming instanceof HTMLInputElement) {
                if (target.type !== 'file' && target.type !== 'password' && target !== focused && target.value !== incoming.value)
                    target.value = incoming.value;
                target.checked = incoming.checked;
            }
            if (target instanceof HTMLTextAreaElement && incoming instanceof HTMLTextAreaElement) {
                if (target !== focused && target.value !== incoming.value)
                    target.value = incoming.value;
                return;
            }
            children(target, incoming);
            if (target instanceof HTMLSelectElement && incoming instanceof HTMLSelectElement && target.value !== incoming.value)
                target.value = incoming.value;
        }
        else if (target.nodeValue !== incoming.nodeValue)
            target.nodeValue = incoming.nodeValue;
    };
    const children = (target, incoming) => {
        let cursor = target.firstChild;
        const used = new Set();
        const desired = [...incoming.childNodes];
        for (const [index, child] of desired.entries()) {
            if (cursor && key(cursor) !== key(child)) {
                const remaining = new Set(desired.slice(index).map(key));
                while (cursor && !remaining.has(key(cursor))) {
                    const next = cursor.nextSibling;
                    target.removeChild(cursor);
                    cursor = next;
                }
            }
            if (cursor && key(cursor) === key(child)) {
                const next = cursor.nextSibling;
                used.add(cursor);
                patch(cursor, child);
                cursor = next;
            }
            else {
                const match = [...target.childNodes].find(node => node !== cursor && !used.has(node) && key(node) === key(child));
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
    if (focused instanceof HTMLElement && focused.isConnected && document.activeElement !== focused)
        focused.focus({ preventScroll: true });
    if (selection && (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement)) {
        try {
            focused.setSelectionRange(selection.start, selection.end, selection.direction || undefined);
        }
        catch { /* Non-text controls have no selection range. */ }
    }
    for (const item of scroll)
        if (item.node.isConnected) {
            item.node.scrollTop = item.top;
            item.node.scrollLeft = item.left;
        }
    if (window.scrollX !== x || window.scrollY !== y)
        window.scrollTo(x, y);
}
function disposeQuickSetup() { quickSetup?.dispose(); quickSetup = null; }
function renderQuickSetup() {
    // Background errors and sign-out failures must not replace the active form.
    if (quickSetup && document.querySelector('#quick-setup')) {
        document.querySelector('#quick-feedback').innerHTML = feedback;
        // The mounted form keeps its DOM, but the browser title still follows the
        // selected language, exactly as shell() would render it.
        applyDocumentTitle(t('title.format', { page: moduleTitle(path, t('title.details')) }));
        renderConsoleActions();
        return;
    }
    shell(PageHeader(t('module.quickSetup'), t('read.quickSetupDetail')) +
        `<div id="quick-feedback">${feedback}</div><section class="section quick-setup-section" aria-label="${t('module.quickSetup')}"><div id="quick-setup" class="setup-main quick-setup"></div></section>`);
    const epoch = adapter.identityEpoch, ticket = loadId;
    quickSetup = mountQuickSetup(document.querySelector('#quick-setup'), {
        csrf: () => adapter.csrfToken,
        current: () => adapter.session && epoch === adapter.identityEpoch && path === '/setup' && ticket === loadId,
        expired: () => { dirty = false; location.assign('/login'); },
        dirty: value => { dirty = value; },
        preparation: new URLSearchParams(location.search).get('step') === 'prepare',
        step: step => {
            const url = publicPath('/setup') + (step === 'preparation' ? '?step=prepare' : '');
            history.replaceState({ path }, '', url);
            pageURL = url;
        },
        navigate: href => {
            const url = new URL(href, location.origin);
            if (url.origin === location.origin && (url.pathname === '/admin' || url.pathname.startsWith('/admin/')))
                navigate(url.pathname + url.search);
            else
                leaveForWorkbench(url.href);
        },
    });
}
function leaveForWorkbench(href = '/') {
    const leave = () => { dirty = false; disposeQuickSetup(); location.assign(href); };
    if (quickSetup)
        quickSetup.requestLeave(leave);
    else if (dirty || dialogDirty)
        confirmDiscard(leave);
    else
        leave();
}
function closeAccountMenu(restore = false) {
    languagePicker.close();
    const menu = document.querySelector('#account-dropdown');
    if (menu)
        menu.hidden = true;
    const trigger = document.querySelector('#account-trigger');
    trigger?.setAttribute('aria-expanded', 'false');
    if (restore)
        trigger?.focus({ preventScroll: true });
}
function openAccountMenu(last = false) {
    languagePicker.close();
    const menu = document.querySelector('#account-dropdown'), trigger = document.querySelector('#account-trigger');
    if (!menu || !trigger)
        return;
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    const box = trigger.getBoundingClientRect();
    menu.style.right = `${Math.min(Math.max(8, innerWidth - box.right), innerWidth - menu.offsetWidth - 8)}px`;
    menu.style.top = `${Math.min(box.bottom + 6, Math.max(8, innerHeight - menu.offsetHeight - 8))}px`;
    const items = menu.querySelectorAll('[role=menuitem]:not([disabled]),[role=menuitemradio]:not([disabled])');
    (last ? items[items.length - 1] : items[0])?.focus({ preventScroll: true });
}
let accountPointerOutside = false;
document.addEventListener('pointerdown', event => {
    accountPointerOutside = !event.target.closest('#account-dropdown,#account-trigger');
});
document.addEventListener('pointerup', event => {
    if (accountPointerOutside && document.querySelector('#account-dropdown')?.hidden === false && !event.target.closest('#account-dropdown,#account-trigger'))
        closeAccountMenu();
    accountPointerOutside = false;
});
document.addEventListener('pointercancel', () => { accountPointerOutside = false; });
window.addEventListener('resize', () => closeAccountMenu());
document.addEventListener('keydown', event => {
    const target = event.target, menu = document.querySelector('#account-dropdown');
    if (target.closest('#account-trigger') && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        openAccountMenu(event.key === 'ArrowUp');
        return;
    }
    if (!menu || menu.hidden)
        return;
    if (event.key === 'Escape') {
        event.preventDefault();
        closeAccountMenu(true);
        return;
    }
    if (!menu.contains(target))
        return;
    const items = [...menu.querySelectorAll('[role=menuitem]:not([disabled]),[role=menuitemradio]:not([disabled])')], index = items.indexOf(target);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
    else if (event.key === 'Tab') {
        closeAccountMenu(true);
    }
    else if (event.key === ' ' && target instanceof HTMLAnchorElement) {
        event.preventDefault();
        target.click();
    }
});
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
            void guardIdentity().then(() => { if (path === "/" && !dialog)
                return refreshHealth(false); }).catch(error => { if (!(error instanceof ConsoleViewChanged) && !isSessionError(error) && path === "/")
                showError(error); });
        }, 15000);
}
async function guardIdentity() {
    const epoch = adapter.identityEpoch;
    await adapter.guard();
    if (epoch !== adapter.identityEpoch) {
        closeAccountMenu();
        disposeQuickSetup();
        dirty = false;
        actions.clear();
        actionIdentity = adapter.identityEpoch;
        void loadPage();
        throw new ConsoleViewChanged();
    }
}
function err(e) {
    if (e instanceof ConsoleError && e.correlationId)
        return `${e.message} ${t('errors.correlationId')} ${e.correlationId}`;
    return e instanceof Error
        ? e.message
        : t('errors.requestFailed');
}
function isCurrentSessionError(error, identity) {
    // The adapter revokes the current identity before throwing its own 401. A new
    // authenticated identity, however, must never be cleared by an older request.
    return (identity === adapter.identityEpoch || !adapter.session) && isSessionError(error);
}
function isSessionError(e) {
    if (e instanceof ConsoleError && e.code === "SESSION_EXPIRED") {
        disposeQuickSetup();
        closeAccountMenu();
        clearPolling();
        upload = null;
        packageIntent = null;
        intentLocked = false;
        closeDialog(true);
        dirty = false;
        if (hosted) {
            location.assign('/login');
            return true;
        }
        if (path !== '/login') {
            path = '/login';
            history.pushState({ path }, '', publicPath(path));
        }
        feedback = localizedFeedback(() => Feedback(e.message, "warning"));
        renderPage();
        return true;
    }
    return false;
}
function recoveryActions(e) {
    if (e instanceof ConsoleError) {
        if (e.code === "DEFAULT_REFERENCE")
            return NavLink(t('recovery.openDefaultWork'), "/default-work", "btn secondary");
        if (e.code === "PACKAGE_BUSY")
            return (NavLink(t('module.findOperation'), "/operations", "btn secondary") +
                " " +
                Button(t('recovery.refreshEntry'), "refresh"));
        if (e.code === "RESULT_UNKNOWN")
            return Button(path === "/runtime"
                ? t('recovery.readRuntime')
                : path === "/default-work"
                    ? t('recovery.readDefaults')
                    : t('recovery.refreshData'), "readback");
    }
    return "";
}
function showError(e) {
    for (const record of actions.records.values())
        if (record.pending && record.view === path)
            actions.fail(record, e);
    if (isSessionError(e))
        return;
    feedback = localizedFeedback(() => Feedback(err(e), "error", recoveryActions(e)));
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
    const destination = new URL(next, location.origin);
    next = routePath(destination.pathname);
    if (next === path && destination.search === location.search && !force)
        return;
    const execute = () => {
        disposeQuickSetup();
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
        history.pushState({ path }, "", publicPath(next) + destination.search);
        pageURL = location.pathname + location.search;
        void loadPage();
        window.scrollTo(0, 0);
    };
    if (quickSetup && !force) {
        quickSetup.requestLeave(execute);
        return;
    }
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
    confirm.innerHTML = `<div class="dialog-heading"><div><h2 id="discard-title">${t('discard.title')}</h2><p>${t('discard.detail')}</p></div></div><div class="dialog-body"><p class="muted">${t('discard.note')}</p></div><div class="dialog-footer"><button type="button" class="btn secondary" data-discard-choice="cancel">${t('common.cancel')}</button><button type="button" class="btn danger" data-discard-choice="discard">${t('discard.discard')}</button></div>`;
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
    closeAccountMenu();
    const destination = location.pathname + location.search;
    if (dirty || dialogDirty) {
        history.pushState({ path }, "", pageURL);
        if (quickSetup)
            quickSetup.requestLeave(() => navigate(destination, true));
        else
            confirmDiscard(() => navigate(destination, true));
    }
    else {
        disposeQuickSetup();
        path = routePath(location.pathname);
        pageURL = destination;
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
        void guardIdentity().catch((e) => {
            if (!(e instanceof ConsoleViewChanged) && !isSessionError(e) && path === "/")
                void refreshHealth(false);
        });
        if (path === "/")
            void refreshHealth(false);
    }
});
async function loadPage(preserve = false, automatic = false) {
    if (!automatic) {
        pageRetryCycle++;
        pageRetryAttempt = 0;
        clearTimeout(pageRetryTimer);
    }
    if (preserve && pageRead?.path === path && pageRead.view === loadId && pageRead.identity === adapter.identityEpoch)
        return pageRead.promise;
    const ticket = preserve ? loadId : ++loadId;
    if (!preserve)
        modelManagement.leave();
    if (!preserve)
        for (const [key, record] of actions.records)
            if (record.kind === 'read' && record.view === path)
                actions.records.delete(key);
    const task = { path, view: ticket, identity: adapter.identityEpoch, promise: Promise.resolve() };
    pageRead = task;
    task.promise = readPage(preserve, ticket).finally(() => { if (pageRead === task)
        pageRead = null; });
    return task.promise;
}
function schedulePageRetry(ticket, origin, identity) {
    if (pageRetryAttempt >= 2)
        return;
    const cycle = pageRetryCycle, attempt = pageRetryAttempt++;
    clearTimeout(pageRetryTimer);
    pageRetryTimer = setTimeout(() => {
        if (cycle === pageRetryCycle && ticket === loadId && origin === path && identity === adapter.identityEpoch)
            void loadPage(true, true);
    }, attempt === 0 ? 1000 : 3000);
}
async function readPage(preserve, ticket) {
    clearPolling();
    disposeQuickSetup();
    if (path !== "/login" && !adapter.session) {
        if (hosted) {
            dirty = false;
            location.replace('/login');
            return;
        }
        path = "/login";
        history.replaceState({ path }, "", publicPath(path));
    }
    if (path === "/login") {
        renderPage();
        return;
    }
    if (hosted && path === "/setup") {
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
    const initial = !preserve || shellView !== `${identity}:${ticket}:${path}`;
    if (initial)
        shell(PageHeader(moduleTitle(path, t('title.details')), t('read.loadingTitle')) + `<section class="section"><div class="section-body">${t('read.loadingDetail')}</div></section>`);
    const existingRead = [...actions.records.values()].find(record => record.pending && record.kind === 'read' && record.view === path);
    const record = existingRead || actions.begin({ key: `read:${path}`, kind: 'read', label: t('intent.readingPage'), target: moduleTitle(path, t('term.core')), anchor: '#page-read-status', view: path });
    renderConsoleActions();
    try {
        if (path === "/") {
            try {
                health = await read(adapter.health());
                preparation = hosted ? await read(readPreparation()) : null;
                statusError = "";
            }
            catch (e) {
                if (e instanceof ConsoleViewChanged || isCurrentSessionError(e, identity))
                    return;
                statusError = localizedStatusError(() => err(e));
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
        else if (path === "/about")
            productInfo = await read(adapter.about());
        else if (path === "/users") {
            users = await read(adapter.users());
            actions.reviewed(undefined, ['configuration'], originalPath);
        }
        else if (path === '/models' || path.startsWith('/models/'))
            await read(modelManagement.load(path, preserve));
        else if (path === "/runtime") {
            runtime = await read(adapter.runtime());
            releaseAgentImage = '';
            runtimeDefaultsError = '';
            try {
                releaseAgentImage = await read(adapter.runtimeDefaults());
            }
            catch (error) {
                if (error instanceof ConsoleViewChanged || error instanceof ConsoleError && ['SESSION_EXPIRED', 'SESSION_CHANGED'].includes(error.code))
                    throw error;
                runtimeDefaultsError = err(error);
            }
            try {
                await read(modelManagement.load('/models'));
                modelCatalogError = '';
            }
            catch (error) {
                if (error instanceof ConsoleViewChanged || error instanceof ConsoleError && ['SESSION_EXPIRED', 'SESSION_CHANGED'].includes(error.code))
                    throw error;
                modelCatalogError = err(error);
            }
            if (!preserve)
                runtimeEditing = !runtime;
            try {
                health = await read(adapter.health());
                statusError = "";
            }
            catch (e) {
                if (e instanceof ConsoleViewChanged || isCurrentSessionError(e, identity))
                    return;
                statusError = localizedStatusError(() => err(e));
            }
            if (!preserve || !dirty)
                runtimeDraft = runtime
                    ? {
                        agentImage: releaseAgentImage,
                        provider: runtime.provider,
                        modelId: runtime.modelId,
                        baseUrl: runtime.baseUrl,
                        modelRef: runtime.modelRef || '',
                    }
                    : { agentImage: releaseAgentImage, provider: "", modelId: "", baseUrl: "", modelRef: "" };
        }
        else if (path === "/default-work") {
            const previousDefaults = defaults;
            [defaults, skills, packages] = await read(Promise.all([
                adapter.defaults(),
                adapter.skills(),
                adapter.packages(),
            ]));
            if (!preserve) {
                defaultDraft = defaults ? structuredClone(defaults) : null;
                defaultConflicts = [];
                defaultEditSection = null;
                defaultLastSaved = false;
            }
            else if (defaults && defaultDraft && previousDefaults) {
                for (const key of ['agentImage', 'skills', 'packages', 'agentsMd']) {
                    if (JSON.stringify(defaultDraft[key]) === JSON.stringify(previousDefaults[key]))
                        Object.assign(defaultDraft, { [key]: structuredClone(defaults[key]) });
                    else if (JSON.stringify(defaults[key]) !== JSON.stringify(previousDefaults[key]) && JSON.stringify(defaults[key]) !== JSON.stringify(defaultDraft[key]) && !defaultConflicts.includes(key))
                        defaultConflicts.push(key);
                }
                dirty = changedDefaults();
            }
            else if (!dirty)
                defaultDraft = defaults ? structuredClone(defaults) : null;
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
            operation = await read(adapter.operation(routeId(), undefined, true));
            rememberedOperation = structuredClone(operation);
        }
        if (ticket !== loadId)
            return;
        if (path !== '/' || !statusError)
            pageConfirmedAt = new Date().toISOString();
        if (preserve && !statusError && !readbackRequired && ![...actions.records.values()].some(record => record.view === path && record.blocked))
            feedback = localizedFeedback(() => Feedback(t('read.confirmed'), 'success'));
        renderPage();
        if (path === '/' && statusError)
            schedulePageRetry(ticket, originalPath, identity);
        if (path.startsWith("/operations/") && operation?.state === "running")
            scheduleOperation();
    }
    catch (e) {
        if (isCurrentSessionError(e, identity))
            return;
        if (ticket !== loadId || originalPath !== path || identity !== adapter.identityEpoch)
            return;
        if (record)
            actions.fail(record, e);
        schedulePageRetry(ticket, originalPath, identity);
        if (!initial) {
            const confirmedAt = pageConfirmedAt, needsReadback = readbackRequired, readbackKey = path === '/runtime' ? 'recovery.readRuntime' : 'recovery.readDefaults';
            feedback = localizedFeedback(() => Feedback(t('read.unconfirmed', { from: confirmedAt ? t('read.from', { time: date(confirmedAt) }) : '', error: err(e), note: needsReadback ? t('read.note') : '' }), 'warning', (needsReadback ? Button(t(readbackKey), 'readback', 'secondary') : '') + Button(t('refresh.retry'), 'refresh', 'secondary')));
            renderPage();
            return;
        }
        shell(PageHeader(moduleTitle(path, t('title.details')), t('read.manageCore'), Button(`${icon("refresh", 15)} ${t('common.refresh')}`, "refresh")) +
            Feedback(err(e), "error") +
            Section(t('read.dataUnavailable'), "", Empty(t('read.couldNotLoad'), t('read.failedNotEmpty'), Button(t('read.tryAgain'), "refresh", "primary"))));
    }
    finally {
        if (record && !existingRead) {
            actions.finish(record);
            if (actions.current(record))
                actions.records.delete(record.key);
        }
        if (ticket === loadId && originalPath === path && identity === adapter.identityEpoch)
            renderConsoleActions();
    }
}
function renderPage() {
    if (hosted && path === '/setup' && adapter.session) {
        renderQuickSetup();
        return;
    }
    disposeQuickSetup();
    let body = "";
    if (path === "/login") {
        modelManagement.reset();
        body = loginPage();
    }
    else if (path === "/")
        body = statusPage();
    else if (path === "/about")
        body = productInfoPage();
    else if (path === "/users")
        body = usersPage();
    else if (path === "/runtime")
        body = runtimePage();
    else if (path === '/models' || path.startsWith('/models/'))
        body = modelManagement.markup();
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
            PageHeader(t('read.notFoundTitle'), t('read.notFoundDetail')) +
                NavLink(t('read.backToStatus'), "/", "btn secondary");
    shell(body);
    modelManagement.afterRender();
    renderConsoleActions();
}
function loginPage() {
    const unavailable = adapter.availability?.reachable === false;
    const unknown = adapter.availability === null;
    const bootstrap = adapter.availability?.administratorInitialized === false;
    return `<div class="login"><div class="login-heading"><img class="brand-logo" src="/piwork-logo.png" alt="${t('login.logoAlt')}" width="64" height="64"><h1>${t('login.title')}</h1><p class="muted">${t('login.subtitle')}</p><div class="core-login-status">${StatusLabel(unknown ? t('common.notConfirmed') : unavailable ? t('login.coreUnreachable') : t('login.coreAvailable'), unknown ? "neutral" : unavailable ? "warning" : "success")}<span class="muted">piwork-core</span></div></div>${feedback}${bootstrap ? Feedback(t('login.bootstrap'), "warning") : ""}<section class="section"><form id="login-form">${Field("account", t('login.account'), Input("account", loginAccount, `autocomplete="username" required placeholder="${t('login.accountPlaceholder')}"`))}${Field("password", t('login.password'), Input("password", "", `type="password" autocomplete="current-password" required placeholder="${t('login.passwordPlaceholder')}"`))}<div id="login-error">${loginOutcomeUnknown ? Feedback(t('login.outcomeUnknown'), 'warning', Button(t('common.retry'), 'check-login', 'secondary')) : ''}</div><button class="btn primary" type="submit" ${bootstrap || loginOutcomeUnknown ? "disabled" : ""}>${t('login.signIn')} ${icon("arrow", 15)}</button></form></section>${unavailable ? Button(t('login.retryConnection'), "retry-connection", "secondary") : ""}<p class="login-note">${t('login.note1')}<br>${t('login.note2')}</p></div>`;
}
async function checkConsoleLogin() {
    if (!loginOutcomeUnknown)
        return;
    const sequence = ++loginRecoverySequence, expected = loginAccount, origin = path;
    adapter.cancelReads(['session']);
    try {
        const authenticated = await adapter.initialize();
        if (sequence !== loginRecoverySequence || origin !== path)
            return;
        if (authenticated && adapter.account === expected) {
            loginOutcomeUnknown = false;
            feedback = '';
            navigate('/', true);
            return;
        }
        if (!authenticated) {
            loginOutcomeUnknown = false;
            feedback = localizedFeedback(() => Feedback(t('login.noSessionAfterUnknown'), 'warning'));
        }
    }
    catch { /* Keep the unknown result and its explicit readback action. */ }
    if (sequence === loginRecoverySequence && origin === path)
        renderPage();
}
function taskRail(steps, context) {
    return `<aside class="task-rail"><p class="rail-label">${t('rail.thisTask')}</p><ol>${steps.map((s, i) => `<li class="${s.state}"><span class="step-mark">${s.state === "complete" ? icon("check", 13) : i + 1}</span><div>${s.action ? `<button class="rail-link" type="button" data-action="${s.action}">${esc(s.title)}</button>` : `<strong>${esc(s.title)}</strong>`}<p>${esc(s.detail)}</p></div></li>`).join("")}</ol><div class="task-context">${context}</div></aside>`;
}
function taskFrame(rail, body) {
    return `<div class="task-layout">${rail}<div class="task-content">${body}</div></div>`;
}
function workSetupTabs() {
    return `<nav class="context-tabs" aria-label="${t('workSetup.navigation')}">${[
        [t('workSetup.startingPoint'), "/default-work"],
        [t('module.skills'), "/skills"],
        [t('module.packages'), "/packages"],
    ]
        .map(([label, url]) => `<a data-nav href="${url}" class="${path === url || path.startsWith(url + "/") ? "active" : ""}">${label}</a>`)
        .join("")}</nav>`;
}
function taskAction(iconName, title, description, meta, url) {
    return `<a class="task-action" href="${url}" data-nav><span class="task-action-icon">${icon(iconName, 21)}</span><span class="task-action-copy"><strong>${esc(title)}</strong><span>${esc(description)}</span></span><span class="task-action-meta">${esc(meta)}</span>${icon("arrow", 17)}</a>`;
}
function statusPage() {
    const stale = !!statusError, ready = !!health?.ready && !stale, hasRuntime = health?.checks.some(check => check.name === 'runtimeConfigured') ? health.checks.find(check => check.name === 'runtimeConfigured')?.state === true : !!runtime, components = Object.values(preparation?.components || {}), preparing = components.some(item => ['preparing', 'retrying'].includes(item.state)) && !components.some(item => ['failed', 'unconfigured'].includes(item.state)), known = rememberedOperation && rememberedOperation.state !== "succeeded"
        ? rememberedOperation
        : null;
    let title = t('status.readyTitle'), description = t('status.readyDescription'), label = t('status.readyLabel'), tone = "ready", action = hosted ? `<a class="btn primary" href="/" data-workbench>${t('status.openWorkbench')} ${icon('arrow', 15)}</a>` : NavLink(t('status.reviewRuntime'), "/runtime", "btn primary"), next = t('status.readyNext');
    if (stale || !health) {
        title = t('status.confirmConnectionTitle');
        description = t('status.confirmConnectionDescription');
        label = t('status.needsAttention');
        tone = "blocked";
        action = Button(`${icon("refresh", 15)} ${t('status.recheckCore')}`, "refresh-status", "primary");
        next = t('status.existingTasks');
    }
    else if (!hasRuntime) {
        title = t('status.makeReadyTitle');
        description = t('status.makeReadyDescription');
        label = t('status.startHere');
        tone = "setup";
        action = NavLink(t('runtime.configure') + " " + icon("arrow", 15), "/runtime", "btn primary");
        if (hosted)
            action = NavLink(t('module.quickSetup') + ' ' + icon('arrow', 15), '/setup', 'btn primary');
        next = t('status.accountsLater');
    }
    else if (!ready) {
        title = preparing ? t('status.preparingTitle') : t('status.runtimeAttentionTitle');
        description = preparing ? t('status.preparingDescription') : t('status.savedWithReason', { reason: health.reason || t('adapter.health.unknown') });
        label = preparing ? t('status.preparationInProgress') : t('status.needsAttention');
        tone = preparing ? 'setup' : 'blocked';
        action = hosted && preparing ? NavLink(t('status.viewPreparation') + ' ' + icon('arrow', 15), '/setup?step=prepare', 'btn primary') : NavLink(t('status.reviewRuntime'), '/runtime', 'btn primary');
        next = t('status.outcomesSeparate');
    }
    const primaryIsSetup = hosted && !stale && !!health && (!hasRuntime || !ready && preparing);
    const progress = stale || ready
        ? ""
        : `<div class="setup-progress" aria-label="${t('status.setupProgress')}"><span class="${hasRuntime ? "done" : "active"}"><i>${hasRuntime ? icon("check", 12) : "1"}</i> ${hasRuntime ? t('status.runtimeSaved') : t('status.saveRuntime')}</span><span class="progress-connector"></span><span class="${ready ? "done" : hasRuntime ? "active" : ""}"><i>${ready ? icon("check", 12) : "2"}</i> ${ready ? t('status.readinessConfirmed') : t('status.confirmReadiness')}</span></div>`;
    return `<div class="overview-heading"><div><p class="eyebrow">${t('status.eyebrow')}</p><h1>${t('status.heading')}</h1><p>${t('status.intro')}</p></div><div class="overview-check"><span>${health ? t('status.checkedAt', { time: date(health.checkedAt) }) : t('status.noConfirmedCheck')}</span>${Button(icon("refresh", 14), "refresh-status", "icon-button", `aria-label="${t('status.refreshAria')}"`)}</div></div>${feedback}<section class="task-lead ${tone}" data-testid="overview-next-task"><div class="task-lead-content"><p class="eyebrow">${label}</p><h2>${esc(title)}</h2><p class="task-lead-description">${esc(description)}</p>${progress}<div class="task-lead-actions">${action}</div></div><div class="task-lead-aside"><span class="lead-symbol">${icon(ready ? "check" : stale ? "warning" : "server", 29)}</span><p>${esc(next)}</p></div></section><div class="task-section-label"><h2>${ready ? t('status.chooseTask') : t('status.alsoPrepare')}</h2><span>${ready ? t('status.startWithOutcome') : t('status.optionalNote')}</span></div><section class="task-actions" aria-label="${t('status.adminTasks')}">${hosted && !primaryIsSetup ? taskAction('settings', t('module.quickSetup'), t('status.quickSetupDetail'), t('status.modelPreparation'), '/setup') : ''}${hasRuntime ? taskAction('settings', t('status.maintainRuntime'), t('status.maintainRuntimeDetail'), t('status.futureWorkOnly'), '/runtime') : ''}${known ? taskAction('clock', t('status.continueOperation'), known.packageName + ' · ' + known.packagePhase, t('status.knownOperation'), '/operations/' + encodeURIComponent(known.id)) : ''}${taskAction("users", t('status.giveAccess'), t('status.giveAccessDetail'), overviewDataConfirmed ? t('status.enabledAccounts', { count: users.filter((u) => u.enabled).length }) : t('status.manageAccounts'), "/users")}${taskAction("settings", t('status.shapeWork'), t('status.shapeWorkDetail'), defaults ? `${t(defaults.skills.length === 1 ? 'status.skillCountOne' : 'status.skillCountMany', { count: defaults.skills.length })} · ${t(defaults.packages.length === 1 ? 'status.packageCountOne' : 'status.packageCountMany', { count: defaults.packages.length })}` : t('status.chooseStartingPoint'), "/default-work")}${taskAction("box", t('status.addCapability'), t('status.addCapabilityDetail'), t('status.openLibrary'), "/skills")}${taskAction("search", t('status.findOperation'), t('status.findOperationDetail'), t('status.operationIdRequired'), "/operations")}</section><details class="core-diagnostics" id="core-checks"><summary><span>${icon("server", 16)} ${t('status.diagnostics')}</span><span>${StatusLabel(stale ? t('status.unconfirmed') : ready ? t('status.ready') : t('status.notReady'), stale || !ready ? "warning" : "success")}${icon("down", 14)}</span></summary><div class="diagnostics-body"><div class="diagnostic-facts"><div><span>${t('status.coreConnection')}</span><strong>${stale ? t('status.unreachable') : health ? t('status.reachable') : t('status.unknown')}</strong></div><div><span>${t('status.processHealth')}</span><strong>${health ? (stale ? t('status.lastKnownHealthy') : t('status.healthy')) : t('status.unknown')}</strong></div><div><span>${t('status.runtimeReadiness')}</span><strong>${health ? (stale ? t('status.lastKnown') : "") + (health.ready ? t('status.ready') : t('status.notReady')) : t('status.unknown')}</strong></div></div>${stale ? Feedback(statusError + " " + t('status.staleSuffix'), "warning") : ""}${health ? health.checks.map((c) => `<div class="check-row">${icon(c.state === true ? "check" : "warning", 15)}<span class="check-name">${esc(c.name)}</span><span class="check-note">${esc(c.detail)}</span>${StatusLabel(stale ? t('status.stale') : t(c.state === true ? 'adapter.health.ready' : c.state === false ? 'adapter.health.notReady' : 'adapter.health.unknown'), stale ? "neutral" : c.state === true ? "success" : "warning")}</div>`).join("") : Empty(t('status.noConfirmedChecks'), t('status.noConfirmedChecksDetail'))}<div class="section-footer"><span>${t('status.administratorValue', { account: esc(adapter.account) })}</span><span>${t('status.refreshInterval')}</span></div>${Disclosure(t('status.publicTechnicalFields'), `<pre>${esc(JSON.stringify({ core: "piwork-core", connection: "Console to Core loopback", health: health?.healthy ?? null, ready: health?.ready ?? null, reason: health?.reason ?? null, lastChecked: health?.checkedAt ?? null }, null, 2))}</pre>`)}</div></details>`;
}
function runtimePage() {
    const ready = !!health?.ready && !statusError;
    const configured = !!runtime;
    const model = modelManagement.models.find(model => model.modelRef === runtime?.modelRef);
    const rail = configured ? `<aside class="task-rail summary-context"><p class="rail-label">${t('runtime.scopeLabel')}</p><p>${t('runtime.changesFutureOnly')}</p><div class="task-context">${NavLink(t('runtime.manageModels'), '/models')}${NavLink(t('status.shapeWork'), '/default-work')}${hosted ? `<a href="/" data-workbench>${t('status.openWorkbench')}</a>` : NavLink(t('runtime.backOverview'), '/')}</div></aside>` : taskRail([
        {
            title: t('runtime.configure'),
            detail: configured ? t('runtime.savedDetail') : t('runtime.requiredBeforeWork'),
            state: runtimeEditing || !configured ? "current" : "complete",
            action: "edit-runtime",
        },
        {
            title: t('runtime.confirmStep'),
            detail: ready
                ? t('runtime.coreReady')
                : configured
                    ? t('runtime.checkSavedRuntime')
                    : t('runtime.afterSave'),
            state: ready
                ? "complete"
                : configured && !runtimeEditing
                    ? "current"
                    : "upcoming",
            action: configured && !runtimeEditing ? "verify-runtime" : undefined,
        },
    ], `<p class="rail-label">${t('runtime.scope')}</p><p>${t('runtime.changesFutureOnly')}</p><p class="rail-label">${t('runtime.afterSetup')}</p>${NavLink(t('status.giveAccess'), "/users")}${NavLink(t('status.shapeWork'), "/default-work")}`);
    const summary = runtime
        ? `<dl class="summary-list"><dt>${t('runtime.aiModel')}</dt><dd>${esc(model?.name || runtime.modelId)}</dd><dt>${t('runtime.protocol')}</dt><dd>${esc(model?.api || runtime.provider)}</dd><dt>${t('runtime.modelId')}</dt><dd><code>${esc(runtime.modelId)}</code></dd><dt>${t('runtime.customBaseUrl')}</dt><dd>${model?.baseUrl || runtime.baseUrl ? `<code>${esc(model?.baseUrl || runtime.baseUrl)}</code>` : t('runtime.providerDefault')}</dd><dt>${t('runtime.credential')}</dt><dd>${StatusLabel(runtime.credentialAvailable ? t('runtime.available') : t('shell.unavailable'), runtime.credentialAvailable ? "success" : "warning")}</dd><dt>${t('runtime.updated')}</dt><dd>${date(runtime.updatedAt)}</dd></dl>`
        : Empty(t('runtime.noRuntime'), t('runtime.noRuntimeDetail'));
    const body = runtimeEditing
        ? Section(configured ? t('runtime.editTitle') : t('runtime.configure'), t('runtime.configureDetail'), `<div class="section-body"><form id="runtime-form" class="form-grid">${runtimeDefaultsError ? Feedback(runtimeDefaultsError, "warning") : ""}${Field("modelRef", t('runtime.aiModel'), `<select id="modelRef" name="modelRef" required><option value="">${t('runtime.chooseModel')}</option>${modelManagement.models.map(m => `<option ${!m.enabled || !m.credentialAvailable ? 'disabled' : ''} value="${esc(m.modelRef)}" ${m.modelRef === runtimeDraft.modelRef ? 'selected' : ''}>${esc(m.api + ' / ' + m.name + ' (' + m.model + ') · ' + m.id.slice(-8) + (!m.enabled ? t('runtime.optionDisabled') : !m.credentialAvailable ? t('runtime.optionKeyUnavailable') : ''))}</option>`).join('')}${runtimeDraft.modelRef && !modelManagement.models.some(m => m.modelRef === runtimeDraft.modelRef) ? `<option selected disabled value="${esc(runtimeDraft.modelRef)}">${t('runtime.savedModelOption')}</option>` : ''}</select>`, t('runtime.modelHelp'))}${NavLink(t('runtime.manageModels'), "/models")}${modelCatalogError ? Feedback(t('runtime.modelListFailed', { error: modelCatalogError }), "warning") : !modelManagement.models.length ? Feedback(t('runtime.noModels'), "info") : ''}<div class="form-actions"><button type="submit" class="btn primary" ${saving || readbackRequired || !releaseAgentImage ? "disabled" : ""}>${saving ? t('common.saving') : t('status.saveRuntime')}</button>${Button(t('runtime.cancelEditing'), "cancel-runtime-edit", "secondary")}</div><p class="help form-notice">${t('runtime.saveNote')}</p></form></div>${configured ? Disclosure(t('runtime.compareSaved'), summary) : ""}`)
        : Section(t('runtime.configurationTitle'), t('runtime.configurationDetail'), `<div class="section-body">${summary}</div><div class="section-footer"><span>${t('runtime.keyNeverShown')}</span>${Button(t('runtime.editTitle'), "edit-runtime", "secondary")}</div>`) +
            Section(t('runtime.readiness'), t('runtime.readinessDetail'), `<div class="section-body"><div class="readiness-answer"><span class="system-icon ${ready ? "" : "warning"}">${icon(ready ? "check" : "warning", 19)}</span><div><h3>${ready ? t('runtime.readyForWork') : statusError ? t('runtime.readinessUnconfirmed') : t('runtime.savedNotReady')}</h3><p>${esc(statusError || health?.reason || t('runtime.readinessNeeded'))}</p><small>${health ? t('runtime.lastChecked', { time: date(health.checkedAt) }) : t('runtime.notChecked')}</small></div></div></div><div class="section-footer"><span>${t('runtime.existingWorkKeeps')}</span>${Button(t('runtime.verify'), "verify-runtime", "secondary")}</div>`);
    return (PageHeader(configured ? t('module.runtime') : t('runtime.configure'), t('runtime.pageDetail'), Button(`${icon("refresh", 15)} ${t('common.refresh')}`, "refresh"), NavLink(t('shell.navOverview'), "/") + " / " + t('module.runtime')) +
        feedback +
        taskFrame(rail, body + Disclosure(t('runtime.diagnostics'), `<dl class="summary-list"><dt>${t('runtime.modelReference')}</dt><dd><code>${esc(runtime?.modelRef || t('runtime.notConfigured'))}</code></dd><dt>${t('runtime.releaseAgentImage')}</dt><dd><code data-runtime-agent-image>${esc(releaseAgentImage || t('shell.unavailable'))}</code></dd><dt>${t('runtime.savedAgentImage')}</dt><dd><code>${esc(runtime?.agentImage || t('runtime.notConfigured'))}</code></dd></dl><p class="help">${t('runtime.saveExplicitNote')}</p>`)));
}
function defaultsSelection(kind, d) {
    if (kind === "skills")
        return `<div class="selection-heading"><span>${t('defaults.selectionSkillsCount', { count: d.skills.length })}</span>${Button(t('defaults.clearAll'), "clear-skills", "ghost small", d.skills.length ? "" : "disabled")}</div><div class="ordered-list">${d.skills.length
            ? d.skills
                .map((name, i) => {
                const item = skills.find((s) => s.name === name);
                return `<div class="ordered-item"><span class="index">${i + 1}</span><span class="item-name">${esc(name)}${!item || !item.enabled ? `<span class="subtext text-danger"> · ${!item ? t('defaults.removedFromCatalog') : t('defaults.disabled')}</span>` : ""}</span><div class="ordered-actions">${Button(icon("up", 14), "move-skill", "icon-button", `data-name="${esc(name)}" data-direction="up" aria-label="${t('defaults.moveUp', { name: esc(name) })}" ${i === 0 ? "disabled" : ""}`)}${Button(icon("down", 14), "move-skill", "icon-button", `data-name="${esc(name)}" data-direction="down" aria-label="${t('defaults.moveDown', { name: esc(name) })}" ${i === d.skills.length - 1 ? "disabled" : ""}`)}${Button(icon("close", 13), "remove-default-skill", "icon-button", `data-name="${esc(name)}" aria-label="${t('defaults.remove', { name: esc(name) })}"`)}</div></div>`;
            })
                .join("")
            : `<p class="help">${t('defaults.noSkills')}</p>`}</div><p class="selection-caption">${t('defaults.availableSkills')}</p><div class="selection-menu" id="skill-picker">${skills
            .filter((s) => s.enabled)
            .map((s) => `<label class="check-label"><input type="checkbox" data-default-skill="${esc(s.name)}" ${d.skills.includes(s.name) ? "checked" : ""}><span>${esc(s.name)}</span></label>`)
            .join("") || `<p class="help">${t('defaults.noEnabledSkills')}</p>`}</div>`;
    return `<div class="selection-heading"><span>${t('defaults.selectionPackagesCount', { count: d.packages.length })}</span>${Button(t('defaults.clearAll'), "clear-packages", "ghost small", d.packages.length ? "" : "disabled")}</div><div class="selection-menu" id="package-picker">${packages
        .filter((p) => p.enabled || d.packages.includes(p.name))
        .map((p) => `<label class="check-label"><input type="checkbox" data-default-package="${esc(p.name)}" ${d.packages.includes(p.name) ? "checked" : ""}><span>${esc(p.name)}${!p.enabled ? t('defaults.disabledReference') : ""}</span></label>`)
        .join("")}${d.packages
        .filter((n) => !packages.some((p) => p.name === n))
        .map((n) => `<label class="check-label"><input type="checkbox" data-default-package="${esc(n)}" checked><span>${esc(n)}${t('defaults.removedReference')}</span></label>`)
        .join("")}</div>${!d.packages.length ? `<p class="help">${t('defaults.noPackages')}</p>` : ""}`;
}
function defaultsEditor(section, d) {
    const content = section === "skills"
        ? Field("skill-picker", t('defaults.orderedSkills'), defaultsSelection("skills", d), t('defaults.orderedSkillsHelp'))
        : section === "packages"
            ? Field("package-picker", t('module.packages'), defaultsSelection("packages", d), t('defaults.packagesHelp'))
            : Field("agentsMd", "AGENTS.md", `<textarea class="editor" id="agentsMd" name="agentsMd" spellcheck="false">${esc(d.agentsMd)}</textarea><div class="count-row"><span id="agents-count">${t('defaults.agentsBytes', { count: formatNumber(new TextEncoder().encode(d.agentsMd).length) })}</span><label class="btn small" for="agents-file">${icon("upload", 13)} ${t('defaults.importFile')}</label><input type="file" id="agents-file" accept=".md,.txt,text/plain,text/markdown" hidden data-layout="layout-role-0"></div>`, t('defaults.agentsHelp'));
    const label = section === "skills"
        ? t('defaults.chooseOrderSkills')
        : section === "packages"
            ? t('defaults.choosePackages')
            : t('defaults.writeInstructions');
    return Section(label, t('defaults.editorDetail'), `<div class="section-body"><form id="defaults-form" class="form-grid">${content}<div class="form-actions">${Button(t('defaults.doneEditing'), "finish-default-edit", "secondary")}${section === "skills" || section === "packages" ? Button(section === "skills" ? t('defaults.addSkillToLibrary') : t('defaults.installPackage'), "open-capability-library", "ghost", `data-kind="${section}"`) : ""}</div></form></div>`);
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
    const verb = referenceReturn.action === "enable" ? t('reference.verbEnable') : referenceReturn.action === "disable" ? t('reference.verbDisable') : t('reference.verbRemove');
    return `<div class="journey-notice"><span>${icon(selected ? "warning" : "check", 17)}</span><div><strong>${selected ? t('reference.resolve') : t('reference.removed')}</strong><p>${selected ? t('reference.stillSelected', { name: esc(referenceReturn.name), action: referenceReturn.action === "remove" ? t('reference.actionRemoving') : t('reference.actionDisabling') }) : t('reference.notChanged', { action: verb })}</p></div>${selected ? Button(referenceReturn.kind === "skills" ? t('reference.editSkills') : t('reference.editPackages'), "edit-defaults", "secondary", `data-section="${referenceReturn.kind}"`) : NavLink(referenceReturn.kind === "skills" ? t('reference.returnSkill') : t('reference.returnPackage'), "/" + referenceReturn.kind + "/" + encodeURIComponent(referenceReturn.name), "btn primary")}</div>`;
}
function defaultsPage() {
    if (!defaults || !defaultDraft)
        return (PageHeader(t('status.shapeWork'), t('defaults.pageDetail')) +
            workSetupTabs() +
            feedback +
            Section(t('defaults.notAvailable'), t('defaults.notAvailableDetail'), Empty(t('defaults.configureFirst'), t('defaults.configureFirstDetail'), NavLink(t('runtime.configure'), "/runtime", "btn primary"))));
    const d = defaultDraft, changes = defaultChangedFields(), changed = (key) => changes.includes(key) ? `<span class="draft-tag">${t('defaults.edited')}</span>` : "";
    const rows = [
        [
            "skills",
            t('module.skills'),
            t('defaults.skillsDesc'),
            d.skills.length
                ? d.skills
                    .map((name, i) => `<span class="summary-token"><b>${i + 1}</b>${esc(name)}${!skills.some((s) => s.name === name && s.enabled) ? `<i>${t('shell.unavailable')}</i>` : ""}</span>`)
                    .join("")
                : `<span class="muted">${t('defaults.noSkills')}</span>`,
        ],
        [
            "packages",
            t('module.packages'),
            t('defaults.packagesDesc'),
            d.packages.length
                ? d.packages
                    .map((name) => `<span class="summary-token">${esc(name)}</span>`)
                    .join("")
                : `<span class="muted">${t('defaults.noPackages')}</span>`,
        ],
        [
            "agentsMd",
            t('defaults.instructions'),
            t('defaults.instructionsMeta'),
            `<span>${d.agentsMd ? t('defaults.bytesValue', { count: formatNumber(new TextEncoder().encode(d.agentsMd).length) }) : t('defaults.noInstructions')}</span>${d.agentsMd ? `<p class="instruction-preview">${esc(d.agentsMd.split("\n").filter(Boolean).slice(0, 2).join(" · "))}</p>` : ""}`,
        ],
    ];
    const summary = `<section class="starting-point"><div class="starting-point-heading"><div><h2>${dirty ? t('defaults.draftStartingPoint') : t('defaults.currentStartingPoint')}</h2><p>${dirty ? t('defaults.draftUnsavedDetail') : t('defaults.usedForNewWork')}</p></div>${StatusLabel(dirty ? t('defaults.unsavedDraft') : t('defaults.saved'), dirty ? "warning" : "success")}</div>${rows.map(([key, title, description, value]) => `<div class="setup-config-row" data-testid="default-summary-${key}"><div class="setup-config-label"><h3>${title} ${changed(key)}</h3><p>${description}</p></div><div class="setup-config-value">${value}</div>${Button(t('defaults.editTarget', { target: key === "agentsMd" ? t('defaults.editInstructionsTarget') : title }), "edit-defaults", "ghost small", `data-section="${key}"`)}</div>`).join("")}</section>`;
    const rail = !defaultEditSection && !dirty && !defaultLastSaved
        ? `<aside class="task-rail summary-context"><p class="rail-label">${t('defaults.railLabel')}</p><div class="saved-context">${icon("check", 16)}<strong>${t('defaults.savedOnCore')}</strong></div><p class="help">${t('defaults.newWorkUses')}</p><div class="task-context"><p class="rail-label">${t('defaults.needCapability')}</p>${Button(t('defaults.addUpdateSkill'), "open-capability-library", "ghost", `data-kind="skills"`)}${Button(t('defaults.installUpdatePackage'), "open-capability-library", "ghost", `data-kind="packages"`)}<p class="rail-note">${t('defaults.catalogSeparate')}</p></div></aside>`
        : taskRail([
            {
                title: t('status.chooseStartingPoint'),
                detail: defaultEditSection
                    ? t('defaults.editing', { target: defaultEditSection === "agentsMd" ? t('defaults.editInstructionsTarget') : defaultEditSection === "skills" ? t('defaults.targetSkills') : t('defaults.targetPackages') })
                    : t('defaults.reviewCurrent'),
                state: defaultLastSaved ? "complete" : "current",
            },
            {
                title: t('defaults.stepSave'),
                detail: defaultLastSaved
                    ? t('defaults.savedConfirmed')
                    : t('defaults.existingUnchanged'),
                state: defaultLastSaved ? "complete" : "upcoming",
            },
        ], `<p class="rail-label">${t('defaults.needCapability')}</p>${Button(t('defaults.addUpdateSkill'), "open-capability-library", "ghost", `data-kind="skills"`)}${Button(t('defaults.installUpdatePackage'), "open-capability-library", "ghost", `data-kind="packages"`)}<p class="rail-note">${t('defaults.catalogSeparate')}</p>`);
    const commit = `<div class="draft-commit ${dirty ? "has-changes" : ""}"><div><strong id="dirty-label">${dirty ? t('defaults.fieldsChanged', { count: changes.length }) : t('defaults.noUnsavedChanges')}</strong><p>${t('defaults.commitNote')}</p></div><div>${Button(t('defaults.discardDraft'), "discard-defaults", "secondary", dirty ? "" : "disabled")}${Button(t('defaults.review'), "review-defaults", "ghost", !dirty ? "disabled" : "")}${Button(saving ? t('common.saving') : t('defaults.saveDefaults'), "save-defaults", "primary", !dirty || saving || readbackRequired || defaultConflicts.length > 0 ? "disabled" : "")}</div></div>`;
    return (PageHeader(t('status.shapeWork'), t('defaults.pageDetailFull'), Button(`${icon("refresh", 15)} ${t('common.refresh')}`, "refresh")) +
        workSetupTabs() +
        feedback +
        referenceContext() +
        defaultConflictNotice() +
        taskFrame(rail, (defaultEditSection ? defaultsEditor(defaultEditSection, d) : summary) +
            commit +
            Disclosure(t('runtime.diagnostics'), `<dl class="summary-list"><dt>${t('defaults.defaultWorkImage')}</dt><dd><code>${esc(d.agentImage)}</code></dd><dt>${t('runtime.releaseAgentImage')}</dt><dd><code>${esc(releaseAgentImage || t('shell.unavailable'))}</code></dd></dl>`) +
            Disclosure(t('defaults.completeConfiguration'), `<pre>${esc(JSON.stringify(defaults?.publicConfiguration ?? null, null, 2))}</pre>`)));
}
function defaultConflictNotice() {
    return defaultConflicts.length
        ? `<div class="journey-notice"><span>${icon("warning", 17)}</span><div><strong>${t('conflicts.editedTitle')}</strong><p>${t('conflicts.fields', { fields: defaultConflicts.map((k) => (k === "agentsMd" ? "AGENTS.md" : k === "agentImage" ? t('conflicts.fieldAgentImage') : k === "skills" ? t('conflicts.fieldSkills') : t('conflicts.fieldPackages'))).join(", ") })}</p></div>${Button(t('conflicts.reviewFields'), "review-default-conflicts", "primary")}</div>`
        : "";
}
function reviewDefaultConflicts() {
    if (!defaults || !defaultDraft)
        return;
    openDialog(t('conflicts.resolveTitle'), t('conflicts.resolveDetail'), `<div class="review-list">${defaultConflicts.map((k) => `<div><h3>${esc(k)}</h3><p><span>${t('conflicts.onCore')}</span>${esc(JSON.stringify(defaults[k]))}</p><p><span>${t('conflicts.yourDraft')}</span>${esc(JSON.stringify(defaultDraft[k]))}</p></div>`).join("")}</div><p class="help">${t('conflicts.resolveHelp')}</p><div data-layout="layout-role-3">${Button(t('conflicts.useCore'), "resolve-default-conflicts-core", "secondary")}</div>`, t('conflicts.keepDraft'), () => {
        defaultConflicts = [];
        closeDialog(true);
        feedback = localizedFeedback(() => Feedback(t('conflicts.keptDraft'), "warning"));
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
        agentImage: t('conflicts.fieldAgentImage'),
        skills: t('conflicts.fieldSkills'),
        packages: t('conflicts.fieldPackages'),
        agentsMd: "AGENTS.md",
    };
    const format = (value, key) => key === "agentsMd"
        ? t('review.utf8Bytes', { count: new TextEncoder().encode(String(value)).length })
        : Array.isArray(value)
            ? value.length
                ? value.join(", ")
                : t('review.none')
            : String(value);
    openDialog(t('review.title'), t('review.detail'), `<div class="review-list">${defaultChangedFields()
        .map((key) => `<div><h3>${names[key]}</h3><p><span>${t('review.saved')}</span>${esc(format(defaults[key], key))}</p><p><span>${t('review.draft')}</span>${esc(format(defaultDraft[key], key))}</p></div>`)
        .join("")}</div><p class="help">${t('review.help')}</p>`, t('defaults.saveDefaults'), async () => {
        closeDialog(true);
        await saveDefaults();
    });
}
function usersPage() {
    return (PageHeader(t('users.pageTitle'), t('users.pageDetail'), Button(`${icon("refresh", 15)} ${t('common.refresh')}`, "refresh") +
        Button(`${icon("plus", 15)} ${t('users.createUser')}`, "create-user", "primary")) +
        feedback +
        (lastCreatedUser
            ? `<div class="access-outcome"><span class="system-icon">${icon("check", 18)}</span><div><p class="eyebrow">${t('users.accountReady')}</p><h2>${t('users.canSignInLine', { account: esc(lastCreatedUser.account) })}</h2><p>${lastCreatedUser.role === "Administrator" ? t('users.adminHint') : t('users.userHint')}</p></div>${Button(t('users.done'), "dismiss-access-outcome", "secondary")}</div>`
            : "") +
        `<div class="access-task-summary"><span>${icon("users", 17)} <strong>${t('users.enabledCount', { count: users.filter((u) => u.enabled).length })}</strong> / ${t('users.totalAccounts', { count: users.length })}</span><span>${t('users.revokeSessions')}</span></div>` +
        Section(t('users.sectionTitle'), t('users.sectionDetail', { count: users.length }), DataTable([t('login.account'), t('users.colRole'), t('module.status'), t('users.colCreated'), t('runtime.updated'), t('users.colActions')], users.map((u) => `<tr data-testid="user-row"><td class="table-name"><button class="btn ghost name-link" data-action="user-details" data-id="${esc(u.id)}" aria-expanded="${expandedUser === u.id}">${esc(u.account)}</button></td><td>${esc(u.role)}</td><td>${StatusLabel(u.enabled ? t('users.enabled') : t('defaults.disabled'), u.enabled ? "success" : "neutral")}</td><td class="nowrap">${date(u.createdAt)}</td><td class="nowrap">${date(u.updatedAt)}</td><td><div class="cell-actions">${Button(u.enabled ? t('users.disable') : t('users.enable'), "user-toggle", "small", `data-id="${esc(u.id)}"`)}${Button(t('users.resetPassword'), "user-reset", "small", `data-id="${esc(u.id)}"`)}</div></td></tr>${expandedUser === u.id ? `<tr><td colspan="6" class="table-details"><span class="small-label">${t('users.userId')}</span><div class="inline-id"><code>${esc(u.id)}</code>${Copy(u.id)}</div><p class="help">${u.id === adapter.currentUserId ? t('users.currentAccount') + ' ' : ''}${t('users.created', { time: esc(formatDateTime(u.createdAt)) })} ${u.enabled ? t('users.canSignIn') : t('users.oldSessionsRevoked')}</p></td></tr>` : ""}`), t('users.empty'))) +
        `<div class="scope-note">${icon("shield", 16)}<span>${t('users.scopeNote')}</span></div>`);
}
function setupJourneyBanner() {
    return setupJourney
        ? `<div class="journey-notice"><span>${icon("settings", 17)}</span><div><strong>${t('journey.title')}</strong><p>${t('journey.detail')}</p></div>${Button(setupJourney.section === "skills" ? t('journey.returnSkills') : t('journey.returnPackages'), "return-to-setup", "secondary")}</div>`
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
        return `<div class="journey-notice"><span>${icon("check", 17)}</span><div><strong>${t('capability.continueTitle')}</strong><p>${alreadySelected ? t('capability.alreadySelected') : t('capability.draftStillHere')}</p></div>${Button(setupJourney.section === "skills" ? t('journey.returnSkills') : t('journey.returnPackages'), "return-to-setup", "primary")}</div>`;
    const selected = defaults?.[kind].includes(name);
    if (referenceReturn?.kind === kind &&
        referenceReturn.name === name &&
        !selected)
        return Feedback(t('capability.referenceRemoved', {
            action: referenceReturn.action === "remove"
                ? t('reference.verbRemove')
                : referenceReturn.action === "disable"
                    ? t('reference.verbDisable')
                    : t('reference.verbEnable'),
        }), "info");
    return `<div class="capability-next"><span>${icon("settings", 16)} ${selected ? t('capability.selectedForWork') : t('capability.availableInLibrary')}</span>${NavLink(selected ? t('capability.reviewStartingPoint') : t('capability.chooseForNewWork'), "/default-work", "text-link")}</div>`;
}
function skillsPage() {
    return (PageHeader(t('skills.title'), t('skills.detail'), Button(icon("refresh", 15) + " " + t('common.refresh'), "refresh") +
        Button(icon("plus", 15) + " " + t('skills.add'), "add-skill", "primary")) +
        feedback +
        Section(t('skills.allTitle'), t('skills.count', { count: skills.length }), DataTable([t('field.name'), t('field.status'), t('term.defaultWork'), t('field.files'), t('field.updated'), ""], skills.map((s) => `<tr><td class="table-name">${NavLink(esc(s.name), "/skills/" + encodeURIComponent(s.name), "name-link")}<span class="subtext">${esc(s.source)}</span></td><td>${StatusLabel(s.enabled ? t('common.enabled') : t('common.disabled'), s.enabled ? "success" : "neutral")}</td><td>${defaults?.skills.includes(s.name) ? StatusLabel(t('common.default'), "info") : `<span class="muted">${t('common.notSelected')}</span>`}</td><td>${s.files} <span class="muted">· ${bytes(s.bytes)}</span></td><td class="nowrap">${date(s.updatedAt)}</td><td>${NavLink(icon("chevron", 16), "/skills/" + encodeURIComponent(s.name), "btn icon-button")}</td></tr>`), t('skills.empty'))) +
        `<div class="scope-note">${icon("book", 16)}<span>${t('skills.scopeNote')}</span></div>`);
}
function skillDetails() {
    const s = skills.find((s) => s.name === routeId());
    if (!s || adapter.scenario === "object-missing")
        return missingPage("skill", "/skills");
    return (PageHeader(s.name, t('skills.detailsDetail'), Button(icon("refresh", 15) + " " + t('common.refresh'), "refresh") +
        Button(icon("upload", 15) + " " + t('skills.updateDirectory'), "update-skill", "primary", `data-name="${esc(s.name)}"`), NavLink(t('module.skills'), "/skills") + " / " + t('common.details')) +
        feedback +
        capabilityReturn("skills", s.name) +
        Section(t('skills.detailsTitle'), "", `<div class="section-body"><div class="metadata-tags">${StatusLabel(s.enabled ? t('common.enabled') : t('common.disabled'), s.enabled ? "success" : "neutral")}${StatusLabel(defaults?.skills.includes(s.name) ? t('common.default') : t('common.notDefault'), defaults?.skills.includes(s.name) ? "info" : "neutral")}</div><dl class="summary-list" data-layout="layout-role-5"><dt>${t('field.name')}</dt><dd class="inline-id"><code>${esc(s.name)}</code>${Copy(s.name)}</dd><dt>${t('field.source')}</dt><dd>${esc(s.source)}</dd><dt>${t('field.files')}</dt><dd>${t('skills.ordinaryFiles', { count: s.files, size: bytes(s.bytes) })}</dd><dt>${t('field.updated')}</dt><dd>${date(s.updatedAt)}</dd></dl></div>`) +
        Section(t('field.availability'), t('skills.availabilityDetail'), `<div class="section-body danger-row"><div><h3>${s.enabled ? t('skills.enabledForSelection') : t('skills.disabledForSelection')}</h3><p>${t('skills.existingCopiesNote')}</p></div>${Button(s.enabled ? t('skills.disable') : t('skills.enable'), "catalog-toggle", "secondary", `data-kind="skills" data-name="${esc(s.name)}"`)}</div>`) +
        Section(t('skills.removeTitle'), "", `<div class="section-body danger-row"><p>${t('skills.removeNote')}</p>${Button(t('skills.remove'), "catalog-remove", "danger", `data-kind="skills" data-name="${esc(s.name)}"`)}</div>`, "", "danger-zone"));
}
function sourceLabel(kind) {
    return kind === "Local directory" ? t('source.localDirectory') : kind;
}
function packagesPage() {
    return (PageHeader(t('packages.title'), t('packages.detail'), Button(icon("refresh", 15) + " " + t('common.refresh'), "refresh") +
        Button(icon("plus", 15) + " " + t('packages.install'), "install-package", "primary")) +
        feedback +
        Section(t('packages.allTitle'), t('packages.count', { count: packages.length }), DataTable([
            t('field.name'),
            t('field.version'),
            t('field.source'),
            t('field.status'),
            t('term.defaultWork'),
            t('field.resources'),
            "",
        ], packages.map((p) => `<tr><td class="table-name">${NavLink(esc(p.name), "/packages/" + encodeURIComponent(p.name), "name-link")}<span class="subtext">${t('packages.updated', { date: date(p.updatedAt) })}</span></td><td class="nowrap">${esc(p.version || t('packages.notDeclared'))}</td><td class="nowrap">${esc(sourceLabel(p.sourceKind))}</td><td>${StatusLabel(p.enabled ? t('common.enabled') : t('common.disabled'), p.enabled ? "success" : "neutral")}</td><td>${defaults?.packages.includes(p.name) ? StatusLabel(t('common.default'), "info") : `<span class="muted">${t('common.notSelected')}</span>`}</td><td>${p.resources ?? t('ui.notProvided')}</td><td>${NavLink(icon("chevron", 16), "/packages/" + encodeURIComponent(p.name), "btn icon-button")}</td></tr>`), t('packages.empty'))) +
        `<div class="scope-note">${icon("box", 16)}<span>${t('packages.scopeNote')}</span></div>`);
}
function packageDetails() {
    const p = packages.find((p) => p.name === routeId());
    if (!p || adapter.scenario === "object-missing")
        return missingPage("package", "/packages");
    return (PageHeader(p.name, t('packages.detailsDetail'), Button(icon("refresh", 15) + " " + t('common.refresh'), "refresh") +
        Button(t('packages.update'), "update-package", "primary", `data-name="${esc(p.name)}"`), NavLink(t('module.packages'), "/packages") + " / " + t('common.details')) +
        feedback +
        capabilityReturn("packages", p.name) +
        Section(t('packages.detailsTitle'), "", `<div class="section-body"><div class="metadata-tags">${StatusLabel(p.enabled ? t('common.enabled') : t('common.disabled'), p.enabled ? "success" : "neutral")}${StatusLabel(defaults?.packages.includes(p.name) ? t('common.default') : t('common.notDefault'), defaults?.packages.includes(p.name) ? "info" : "neutral")}</div><dl class="summary-list" data-layout="layout-role-5"><dt>${t('field.name')}</dt><dd class="inline-id"><code>${esc(p.name)}</code>${Copy(p.name)}</dd><dt>${t('field.version')}</dt><dd>${esc(p.version || t('packages.notDeclared'))}</dd><dt>${t('field.sourceKind')}</dt><dd>${esc(sourceLabel(p.sourceKind))}</dd><dt>${t('field.resolvedSource')}</dt><dd class="inline-id"><code>${esc(p.resolvedSource)}</code>${Copy(p.resolvedSource)}</dd><dt>${t('field.resources')}</dt><dd>${p.resources ?? t('ui.notProvided')}</dd><dt>${t('field.updated')}</dt><dd>${date(p.updatedAt)}</dd></dl></div>`) +
        Section(t('field.availability'), t('packages.availabilityDetail'), `<div class="section-body danger-row"><div><h3>${p.enabled ? t('packages.enabledForSelection') : t('packages.disabledForSelection')}</h3><p>${t('packages.updateNote')}</p></div>${Button(p.enabled ? t('packages.disable') : t('packages.enable'), "catalog-toggle", "secondary", `data-kind="packages" data-name="${esc(p.name)}"`)}</div>`) +
        Section(t('packages.removeTitle'), "", `<div class="section-body danger-row"><p>${t('packages.removeNote')}</p>${Button(t('packages.remove'), "catalog-remove", "danger", `data-kind="packages" data-name="${esc(p.name)}"`)}</div>`, "", "danger-zone"));
}
function missingPage(kind, url) {
    const title = kind === "skill" ? t('missing.skillTitle') : t('missing.packageTitle');
    const back = kind === "skill" ? t('missing.backSkills') : t('missing.backPackages');
    const emptyTitle = kind === "skill" ? t('missing.skillEmptyTitle') : t('missing.packageEmptyTitle');
    return (PageHeader(title, t('missing.detail'), Button(t('common.refresh'), "refresh"), NavLink(back, url)) +
        feedback +
        Section(t('missing.sectionTitle'), "", Empty(emptyTitle, t('missing.emptyDetail'), NavLink(back, url, "btn secondary"))));
}
function findOperationPage() {
    return (PageHeader(t('operation.findTitle'), t('operation.findDetail')) +
        feedback +
        (rememberedOperation
            ? `<div class="journey-notice"><span>${icon("clock", 17)}</span><div><strong>${t('operation.alreadyOpened')}</strong><p>${esc(rememberedOperation.packageName)} · ${esc(rememberedOperation.packagePhase)} · <code>${esc(rememberedOperation.id)}</code></p></div>${NavLink(t('operation.continue'), "/operations/" + encodeURIComponent(rememberedOperation.id), "btn secondary")}</div>`
            : "") +
        Section(t('operation.lookupTitle'), t('operation.lookupDetail'), `<div class="section-body"><form id="operation-find"><label for="operation-id" class="small-label">${t('operation.idLabel')}</label><div class="lookup-row" data-layout="layout-role-6">${Input("operation-id", "", 'class="mono" required placeholder="op_…" autocomplete="off"')}<button type="submit" class="btn primary">${icon("search", 15)} ${t('operation.find')}</button></div><p class="lookup-help">${t('operation.lookupHelp')}</p></form></div>`) +
        Section(t('operation.resumeTitle'), "", `<div class="section-body"><div class="scope-note" data-layout="layout-role-8">${icon("clock", 18)}<span>${t('operation.resumeNote')}</span></div><p class="help">${t('operation.noHistory')}</p></div>`));
}
let interruptedOperation = null;
function operationPage() {
    if (!operation)
        return (PageHeader(t('operation.unavailable'), t('operation.unavailableDetail'), Button(t('common.refresh'), "refresh"), NavLink(t('module.findOperation'), "/operations")) + feedback);
    const o = operation;
    const running = o.state === "running";
    const interrupted = interruptedOperation === o.id;
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
    return (PageHeader(t('operation.packageTitle'), t('operation.packageDetail'), Button(icon("refresh", 15) + " " + t('common.refresh'), "refresh-operation"), NavLink(t('module.findOperation'), "/operations") + " / " + t('common.details')) +
        feedback + (phase.cleanupPending ? Feedback(t('operation.cleanupPending'), "warning") : "") +
        Section(t('operation.statusTitle'), "", `<div class="operation-state"><span class="system-icon ${o.state === "failed" || o.state === "superseded" ? "warning" : ""}">${running && !interrupted && !phase.cleanupPending ? pendingDots() : icon(o.state === "succeeded" ? "check" : "warning", 20)}</span><div><h3>${o.state === "succeeded" ? t('operation.published') : o.state === "failed" ? t('operation.failed') : o.state === "superseded" ? t('operation.superseded') : esc(phase.label)}</h3><p>${esc(o.packageName)}</p><div data-layout="layout-role-7">${StatusLabel(o.state, tone)}</div></div></div><div class="phase-list">${phases.map((p, i) => `<div class="phase-step ${i < idx ? "done" : i === idx ? "current" : ""}">${esc(p)}</div>`).join("")}</div><div class="section-footer"><span>${running ? (interrupted ? t('operation.observationPaused') : t('operation.checkingEvery')) : t('operation.finalState')}</span><span>${t('operation.lastConfirmed', { date: date(o.updatedAt) })}</span></div>`) +
        Section(t('operation.detailsTitle'), t('operation.detailsDetail'), `<div class="section-body"><dl class="summary-list"><dt>${t('operation.id')}</dt><dd class="inline-id"><code>${esc(o.id)}</code>${Copy(o.id)}</dd><dt>${t('operation.package')}</dt><dd>${esc(o.packageName)}</dd><dt>${t('operation.packagePhase')}</dt><dd>${esc(o.packagePhase || t('operation.phaseNotReported'))}</dd><dt>${t('operation.created')}</dt><dd>${date(o.createdAt)}</dd><dt>${t('operation.updated')}</dt><dd>${date(o.updatedAt)}</dd><dt>${t('operation.result')}</dt><dd>${esc(o.result || t('operation.noResult'))}</dd></dl>${o.diagnostic ? `<div data-layout="layout-role-4">${Feedback(o.diagnostic.message, "error")}<p class="help mono">${esc(o.diagnostic.stage)} / ${esc(o.diagnostic.code)}</p></div>` : ""}</div><div class="section-footer"><span>${t('operation.continuesNote')}</span>${o.state === "succeeded" ? NavLink(t('operation.viewPackage'), "/packages/" + encodeURIComponent(o.packageName), "btn secondary") : !running ? Button(t('operation.startNew'), "retry-operation", "secondary", `data-id="${o.id}"`) : Button(t('operation.copyId'), "copy", "secondary", `data-value="${o.id}"`)}</div>`) +
        Section(t('operation.publicTitle'), t('operation.publicDetail'), Disclosure(t('operation.viewFields'), `<pre>${esc(JSON.stringify({ id: o.id, scope: "core", state: o.state, packagePhase: o.packagePhase, packageName: o.packageName, createdAt: o.createdAt, updatedAt: o.updatedAt, result: o.result, diagnostic: o.diagnostic ?? null }, null, 2))}</pre>`)));
}
let dialogOriginQuery = "", addDefaultDraft = false, pendingSource = null;
function openDialog(title, description, body, submitLabel, action, kind = "primary", preserveDraft = false, readOnly = false) {
    const active = document.activeElement;
    const origin = dialogOrigin || active;
    if (dialog)
        closeDialog(true);
    dialogOrigin = origin;
    dialogOriginQuery = origin?.dataset.action
        ? `[data-action="${origin.dataset.action}"]${origin.dataset.id ? `[data-id="${origin.dataset.id}"]` : origin.dataset.name ? `[data-name="${CSS.escape(origin.dataset.name)}"]` : ""}`
        : origin?.dataset.modelAction ? `[data-model-action="${origin.dataset.modelAction}"]` : "";
    currentModalTitle = title;
    dialogAction = readOnly ? null : action;
    if (!preserveDraft)
        dialogDirty = false;
    dialog = document.createElement("dialog");
    dialog.setAttribute("aria-labelledby", "dialog-title");
    dialog.innerHTML = `<form id="dialog-form"><div class="dialog-heading"><div><h2 id="dialog-title">${esc(title)}</h2><p>${esc(description)}</p></div>${Button(icon("close", 17), "close-dialog", "icon-button", `aria-label="${esc(t('dialog.closeAria'))}"`)}</div><div class="dialog-body"><div id="dialog-feedback"></div>${body}</div><div class="dialog-footer">${readOnly ? Button(t('common.close'), "close-dialog", "secondary") : `${Button(t('common.cancel'), "close-dialog", "secondary")}<button type="submit" class="btn ${kind}" id="dialog-submit">${esc(submitLabel)}</button>`}</div></form>`;
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
    const focus = kind === "danger" || readOnly
        ? dialog.querySelector('[data-action="close-dialog"]')
        : dialog.querySelector("input:not([type=hidden]),select,textarea,button[type=submit]");
    setTimeout(() => focus?.focus(), 0);
}
function openModelTestDialog(body) {
    openDialog(t('dialog.modelTestTitle'), t('dialog.modelTestDetail'), body, '', () => { }, 'primary', false, true);
    const target = dialog;
    return {
        update(body) { if (dialog === target && target.isConnected)
            target.querySelector('.dialog-body').innerHTML = `<div id="dialog-feedback"></div>${body}`; },
        close() { if (dialog === target)
            closeDialog(true); },
    };
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
function dialogFeedback(message, tone = "error", buttons = "", cause) {
    for (const record of actions.records.values())
        if (record.pending && record.anchor === "#dialog-submit" && record.view === path)
            actions.fail(record, cause ?? new Error(message));
    const el = document.querySelector("#dialog-feedback");
    if (el) {
        el.innerHTML = Feedback(message, tone, buttons);
        el.scrollIntoView({ block: "nearest" });
    }
}
function dialogBusy(busy, label = t('common.saving')) {
    submissionPending = busy;
    dialog?.querySelectorAll("button").forEach((b) => {
        b.disabled = busy;
    });
    const submit = document.querySelector("#dialog-submit");
    if (submit && busy)
        submit.textContent = label;
}
function createUserDialog() {
    openDialog(t('users.createUser'), t('dialog.createDetail'), `<div class="form-grid">${Field("new-account", t('login.account'), Input("new-account", "", `required maxlength="128" autocomplete="off" placeholder="${esc(t('dialog.accountPlaceholder'))}"`), t('dialog.accountHelp'))}${Field("new-password", t('login.password'), Input("new-password", "", 'type="password" required minlength="12" maxlength="1024" autocomplete="new-password"'), t('dialog.passwordHelp'))}${Field("confirm-password", t('field.confirmPassword'), Input("confirm-password", "", 'type="password" required minlength="12" autocomplete="new-password"'))}${Field("new-role", t('users.colRole'), '<select id="new-role" name="new-role"><option>User</option><option>Administrator</option></select>', t('dialog.roleHelp'))}</div>`, t('users.createUser'), async (form) => {
        const password = String(form.get("new-password"));
        if (password !== form.get("confirm-password")) {
            setFieldError("confirm-password", t('dialog.passwordMismatch'));
            clearModalPasswords();
            return;
        }
        dialogBusy(true, t('dialog.creating'));
        try {
            const u = await awaitCurrent(adapter.createUser({
                account: String(form.get("new-account")),
                password,
                role: String(form.get("new-role")),
            }));
            dialogBusy(false);
            closeDialog(true);
            lastCreatedUser = u;
            const created = t('dialog.accountCreated', {
                account: u.account,
                hint: u.role === "Administrator" ? t('dialog.adminSignIn') : t('dialog.userSignIn'),
            });
            feedback = Feedback(created, "success");
            renderPage();
            void refreshConfirmed(created, async () => { users = await awaitCurrent(adapter.users()); }, path, () => t('dialog.accountCreated', { account: u.account, hint: u.role === 'Administrator' ? t('dialog.adminSignIn') : t('dialog.userSignIn') }));
        }
        catch (e) {
            if (e instanceof ConsoleViewChanged)
                return;
            dialogBusy(false);
            clearModalPasswords();
            if (isSessionError(e))
                return;
            dialogFeedback(err(e), "error", e instanceof ConsoleError && e.code === "RESULT_UNKNOWN"
                ? Button(t('dialog.refreshUsers'), "close-refresh", "secondary")
                : "", e);
            const submit = document.querySelector("#dialog-submit");
            if (submit) {
                submit.textContent = t('users.createUser');
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
        ? t('users.resetTitle')
        : action === "disable"
            ? t('users.disableTitle')
            : t('users.enableTitle');
    const impact = action === "enable"
        ? t('users.oldSessionsImpact')
        : t('users.revokeImpact');
    const prompt = action === "reset"
        ? t('users.promptReset', { name: `<strong>${esc(u.account)}</strong>` })
        : action === "disable"
            ? t('users.promptDisable', { name: `<strong>${esc(u.account)}</strong>` })
            : t('users.promptEnable', { name: `<strong>${esc(u.account)}</strong>` });
    openDialog(`${title}: ${u.account}`, impact, `<p class="break">${prompt}</p>${u.id === adapter.currentUserId && action !== "enable" ? Feedback(t('users.selfChangeWarning'), "warning") : ""}${action === "reset" ? `<div data-layout="layout-role-5">${Field("reset-password", t('dialog.newPassword'), Input("reset-password", "", 'type="password" required minlength="12" maxlength="1024" autocomplete="new-password"'), t('dialog.passwordHelp'))}${Field("reset-confirm", t('field.confirmPassword'), Input("reset-confirm", "", 'type="password" required minlength="12" autocomplete="new-password"'))}</div>` : `<p class="help" data-layout="layout-role-2">${action === "disable" ? t('users.adminRemains') : impact}</p>`}`, title, async (form) => {
        if (action === "reset" &&
            form.get("reset-password") !== form.get("reset-confirm")) {
            setFieldError("reset-confirm", t('dialog.passwordMismatch'));
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
                history.pushState({ path }, "", publicPath(path));
                feedback = localizedFeedback(() => Feedback(t('users.selfRevoked'), "success"));
                renderPage();
                return;
            }
            const outcome = action === "reset"
                ? t('users.outcomeReset')
                : action === "disable"
                    ? t('users.outcomeDisabled')
                    : t('users.outcomeEnabled');
            const message = t('users.actionOutcome', { account: u.account, outcome, impact });
            feedback = Feedback(message, "success");
            renderPage();
            void refreshConfirmed(message, async () => { users = await awaitCurrent(adapter.users(), true); }, path, () => t('users.actionOutcome', { account: u.account, outcome: t(action === 'reset' ? 'users.outcomeReset' : action === 'disable' ? 'users.outcomeDisabled' : 'users.outcomeEnabled'), impact: t(action === 'enable' ? 'users.oldSessionsImpact' : 'users.revokeImpact') }));
        }
        catch (e) {
            if (e instanceof ConsoleViewChanged)
                return;
            dialogBusy(false);
            clearModalPasswords();
            if (isSessionError(e))
                return;
            dialogFeedback(err(e), "error", e instanceof ConsoleError && ['USER_NOT_FOUND', 'RESULT_UNKNOWN'].includes(e.code)
                ? Button(t('dialog.refreshUsers'), "close-refresh", "secondary")
                : "", e);
            const submit = document.querySelector("#dialog-submit");
            if (submit)
                submit.textContent = title;
        }
    }, action === "enable" ? "primary" : "danger");
}
function catalogActionDialog(kind, name, action) {
    const noun = kind === "skills" ? t('catalog.skill') : t('catalog.package');
    const danger = action !== "enable";
    const verb = action === "enable"
        ? t('catalog.enable')
        : action === "disable"
            ? t('catalog.disable')
            : t('catalog.remove');
    const markedName = `<strong>${esc(name)}</strong>`;
    const prompt = action === "remove"
        ? t('catalog.removePrompt', { name: markedName })
        : action === "disable"
            ? t('catalog.disablePrompt', { name: markedName })
            : t('catalog.enablePrompt', { name: markedName });
    openDialog(`${verb} ${noun}`, `${name}`, `<p class="break">${prompt}</p><p class="help" data-layout="layout-role-2">${action === "enable" ? t('catalog.enableHelp') : t('catalog.changeHelp')}</p>${action === "remove" ? `<div data-layout="layout-role-5">${Field("confirm-name", t('catalog.typeName'), Input("confirm-name", "", 'required autocomplete="off"'), esc(name))}</div>` : ""}`, `${verb} ${noun}`, async (form) => {
        if (action === "remove" && form.get("confirm-name") !== name) {
            setFieldError("confirm-name", t('catalog.nameMismatch'));
            return;
        }
        dialogBusy(true);
        try {
            await awaitCurrent(adapter.catalogAction(kind, name, action));
            if (referenceReturn?.name === name && referenceReturn.kind === kind)
                referenceReturn = null;
            dialogBusy(false);
            closeDialog(true);
            const outcome = action === "remove"
                ? t('catalog.outcomeRemoved')
                : action === "disable"
                    ? t('catalog.outcomeDisabled')
                    : t('catalog.outcomeEnabled');
            const message = t('catalog.outcome', { name, outcome });
            feedback = Feedback(message, "success");
            confirmedMutation(message);
            if (action === "remove") {
                path = "/" + kind;
                history.pushState({ path }, "", publicPath(path));
            }
            renderPage();
            void refreshConfirmed(message, async () => { if (kind === "skills")
                skills = await awaitCurrent(adapter.skills());
            else
                packages = await awaitCurrent(adapter.packages()); }, path, () => t('catalog.outcome', { name, outcome: t(action === 'remove' ? 'catalog.outcomeRemoved' : action === 'disable' ? 'catalog.outcomeDisabled' : 'catalog.outcomeEnabled') }));
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
                ? Button(t('catalog.reviewReference'), "resolve-default-reference", "secondary")
                : e instanceof ConsoleError && e.code === "PACKAGE_BUSY"
                    ? NavLink(t('module.findOperation'), "/operations", "btn secondary")
                    : "");
            const submit = document.querySelector("#dialog-submit");
            if (submit)
                submit.textContent =
                    `${verb} ${noun}`;
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
            ? t('upload.updateSkillDirectory')
            : t('skills.add')
        : target
            ? t('packages.update')
            : t('packages.install');
    const local = uploadKind === "Local directory" || uploadKind === "ZIP";
    const fileInput = type === "skill" || uploadKind === "Local directory"
        ? `<input type="file" id="upload-files" webkitdirectory directory multiple ${!directorySupported ? "disabled" : ""} aria-label="${esc(type === "skill" ? t('upload.chooseSkillDirAria') : t('upload.choosePackageDirAria'))}">`
        : `<input type="file" id="upload-files" accept=".zip,application/zip" aria-label="${esc(t('upload.chooseZipAria'))}">`;
    const body = type === "skill"
        ? `${target ? `<p class="help" data-layout="layout-role-1">${t('upload.immutableSkillName')} <strong>${esc(target)}</strong></p>` : ""}<div class="upload-box">${icon("upload", 25)}<div><p>${t('upload.chooseCompleteSkillDir')}</p>${fileInput}<p class="help">${t('upload.skillDirHelp')}</p></div></div>${!directorySupported ? Feedback(t('upload.noDirectorySupport'), "warning") : ""}${selected}<ul class="file-limits"><li>${t('upload.skillLimitIdentity')}</li><li>${t('upload.skillLimitSize')}</li><li>${t('upload.skillLimitFiles')}</li></ul>`
        : `${target ? `<p class="help" data-layout="layout-role-1">${t('upload.updateTargetNote', { name: `<strong>${esc(target)}</strong>` })}</p>` : ""}<div class="source-options" role="group" aria-label="${esc(t('upload.packageSourceAria'))}">${["npm", "Git", "Local directory", "ZIP"].map((kind) => Button(sourceLabel(kind), "package-source", "source-option" + (kind === uploadKind ? " active" : ""), `data-kind="${kind}" ${intentLocked ? "disabled" : ""}`)).join("")}</div><div id="source-confirm"></div>${local ? `<div class="upload-box">${icon("upload", 24)}<div><p>${uploadKind === "ZIP" ? t('upload.choosePackageZip') : t('upload.choosePackageDir')}</p>${fileInput}<p class="help">${uploadKind === "ZIP" ? t('upload.zipHelp') : t('upload.dirHelp')}</p></div></div>${selected}` : Field("package-source", t('upload.sourceSpec'), Input("package-source", packageSourceDraft, `required placeholder="${uploadKind === "npm" ? "@scope/package@version" : "https://github.com/owner/repository.git#ref"}" ${intentLocked ? "disabled" : ""}`), uploadKind === "npm" ? t('upload.npmHelp') : t('upload.gitHelp'))}${!target ? `<label class="check-label" data-layout="layout-role-4"><input type="checkbox" id="add-default" ${addDefaultDraft ? "checked" : ""} ${intentLocked ? "disabled" : ""}><span>${t('upload.addDefault')}<br><span class="help">${t('upload.addDefaultHelp')}</span></span></label>` : ""}<ul class="file-limits"><li>${t('upload.packageLimitSize')}</li><li>${t('upload.packageLimitCount')}</li><li>${t('upload.packageLimitFiles')}</li><li>${t('upload.packageLimitMigration')}</li></ul>`;
    openDialog(title, type === "skill"
        ? t('upload.skillDetail')
        : t('upload.packageDetail'), body + `<div id="upload-stage"></div>`, type === "skill"
        ? t('upload.uploadSkill')
        : intentLocked
            ? t('package.resumeSubmission')
            : target
                ? t('upload.submitUpdate')
                : t('packages.install'), type === "skill" ? submitSkill : submitPackage, "primary", keep);
    if (intentLocked) {
        const submit = document.querySelector("#dialog-submit");
        if (submit)
            submit.dataset.resumeSubmission = "true";
        dialog
            ?.querySelectorAll("input")
            .forEach((i) => (i.disabled = true));
    }
}
async function submitSkill() {
    if (!upload) {
        dialogFeedback(t('upload.chooseValidSkillDir'));
        return;
    }
    dialogBusy(true, t('upload.uploading'));
    const selection = upload;
    try {
        const s = await awaitCurrent(adapter.uploadSkill(selection, uploadTarget, (sent, total) => {
            const el = document.querySelector("#upload-stage");
            if (el)
                el.innerHTML =
                    sent === total
                        ? UploadProgress(t('upload.validating'), 0, 0)
                        : UploadProgress(t('upload.uploading'), sent, total);
        }));
        dialogBusy(false);
        closeDialog(true);
        upload = null;
        dialogDirty = false;
        dirty = false;
        const confirmed = t('upload.skillConfirmed', { name: s.name });
        confirmedMutation(confirmed);
        path = "/skills/" + encodeURIComponent(s.name);
        history.pushState({ path }, "", publicPath(path));
        feedback = Feedback(confirmed, "success");
        renderPage();
        void refreshConfirmed(confirmed, async () => { skills = await awaitCurrent(adapter.skills()); defaults = await awaitCurrent(adapter.defaults()); }, path, () => t('upload.skillConfirmed', { name: s.name }));
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
            ? Button(t('upload.readSkill'), "check-skill", "secondary", `data-name="${esc(selection.name)}"`)
            : "");
        const submit = document.querySelector("#dialog-submit");
        if (submit)
            submit.textContent = t('upload.uploadSkill');
        if (unknown)
            document.querySelector("#dialog-submit").disabled =
                true;
    }
}
async function submitPackage(form) {
    if (!intentLocked) {
        const local = uploadKind === "Local directory" || uploadKind === "ZIP";
        if (local && !upload) {
            dialogFeedback(uploadKind === "ZIP"
                ? t('upload.chooseValidPackageZip')
                : t('upload.chooseValidPackageDir'));
            return;
        }
        const source = local
            ? upload.summary
            : String(form.get("package-source") || packageSourceDraft).trim();
        if (!source) {
            setFieldError("package-source", t('upload.enterSource'));
            return;
        }
        if (/(?:https?:\/\/)[^\s/]+:[^\s/]+@/.test(source)) {
            setFieldError("package-source", t('upload.noCredentials'));
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
            key: randomUUID(),
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
    dialogBusy(true, t('upload.submitting'));
    dialog
        ?.querySelectorAll("input")
        .forEach((i) => (i.disabled = true));
    try {
        const op = await awaitCurrent(adapter.submitPackage(packageIntent, (sent, total) => {
            const el = document.querySelector("#upload-stage");
            if (el)
                el.innerHTML =
                    sent === total
                        ? UploadProgress(t('upload.verifying'), 0, 0)
                        : UploadProgress(t('upload.uploading'), sent, total);
        }, upload?.bytes || 0, upload ?? undefined));
        dialogBusy(false);
        closeDialog(true);
        upload = null;
        packageIntent = null;
        intentLocked = false;
        dirty = false;
        dialogDirty = false;
        interruptedOperation = null;
        path = "/operations/" + encodeURIComponent(op.id);
        history.pushState({ path }, "", publicPath(path));
        operation = op;
        rememberedOperation = structuredClone(op);
        feedback = localizedFeedback(() => Feedback(t('upload.submissionAccepted'), "success"));
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
            : Button(t('upload.editNewIntent'), "new-package-intent", "secondary"));
        const submit = document.querySelector("#dialog-submit");
        if (submit) {
            submit.textContent = t('package.resumeSubmission');
            submit.dataset.resumeSubmission = "true";
            submit.disabled = !ambiguous;
        }
        dialog
            ?.querySelectorAll('[data-action="package-source"]')
            .forEach((b) => (b.disabled = true));
        dialog
            ?.querySelectorAll("input")
            .forEach((i) => (i.disabled = true));
    }
}
async function readPreparation() {
    // Reuse the authenticated, read-only snapshot already consumed by Quick setup.
    return readWithDeadline(async (signal) => {
        const response = await fetch('/_web/api/onboarding', { credentials: 'same-origin', signal });
        if (response.status === 401)
            throw new ConsoleError('SESSION_EXPIRED', t('prepare.sessionExpired'));
        if (!response.ok)
            throw new Error(t('prepare.readFailed'));
        const snapshot = await response.json();
        if (!snapshot || typeof snapshot.status?.ready !== 'boolean')
            throw new Error(t('prepare.incomplete'));
        return snapshot.preparation || {};
    });
}
async function refreshHealth(showNotice = true) {
    if (pageRead?.path === path && pageRead.view === loadId && pageRead.identity === adapter.identityEpoch)
        return pageRead.promise;
    if (healthRead?.path === path && healthRead.view === loadId && healthRead.identity === adapter.identityEpoch) {
        await healthRead.promise;
        if (showNotice && statusError)
            throw new Error(statusError);
        return;
    }
    const valid = currentView(false), origin = path, identity = adapter.identityEpoch;
    const task = { path, view: loadId, identity: adapter.identityEpoch, promise: Promise.resolve() };
    healthRead = task;
    task.promise = (async () => {
        try {
            const fresh = await adapter.health();
            const prepared = hosted && origin === '/' ? await readPreparation() : preparation;
            if (!valid())
                return;
            health = fresh;
            preparation = prepared;
            statusError = '';
            if (showNotice)
                feedback = localizedFeedback(() => Feedback(t('status.refreshed'), 'success'));
            if (path === '/' || path === '/runtime')
                renderPage();
        }
        catch (e) {
            if (isCurrentSessionError(e, identity) || !valid())
                return;
            statusError = localizedStatusError(() => err(e));
            if (path === '/' || path === '/runtime')
                renderPage();
            if (showNotice)
                throw e;
        }
        finally {
            if (healthRead === task)
                healthRead = null;
        }
    })();
    return task.promise;
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
    if (pageRead?.path === path && pageRead.view === loadId && pageRead.identity === adapter.identityEpoch)
        return pageRead.promise;
    if (operationRead?.path === path && operationRead.view === loadId && operationRead.identity === adapter.identityEpoch) {
        await operationRead.promise;
        if (manual && interruptedOperation === routeId())
            throw new Error(t('operation.observationNotConfirmed'));
        return;
    }
    const id = routeId(), valid = currentView(false), identity = adapter.identityEpoch;
    const task = { path, view: loadId, identity: adapter.identityEpoch, promise: Promise.resolve() };
    operationRead = task;
    task.promise = (async () => {
        try {
            const op = await adapter.operation(id);
            if (!valid())
                return;
            operation = op;
            rememberedOperation = structuredClone(op);
            interruptedOperation = null;
            feedback = '';
            renderPage();
            if (op.state === 'running')
                scheduleOperation();
        }
        catch (e) {
            if (isCurrentSessionError(e, identity) || !valid())
                return;
            clearTimeout(pollTimer);
            interruptedOperation = id;
            feedback = localizedFeedback(() => Feedback(t('operation.interruptedWith', { error: err(e) }), 'warning', Button(t('operation.resumeObservation'), 'resume-observation', 'secondary')));
            renderPage();
            if (manual)
                throw e;
        }
        finally {
            if (operationRead === task)
                operationRead = null;
        }
    })();
    return task.promise;
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
                ? t('defaults.fieldsChanged', { count: defaultChangedFields().length })
                : t('defaults.noUnsavedChanges');
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
            label.textContent = dirty ? t('defaults.unsavedChanges') : t('defaults.noUnsavedChanges');
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
            feedback = localizedFeedback(() => Feedback(matches
                ? t('runtime.readbackMatches')
                : t('runtime.readbackDiffers'), matches ? "success" : "warning"));
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
            const hasUnsaved = dirty;
            feedback = localizedFeedback(() => Feedback(hasUnsaved
                ? t('defaults.readbackUnsaved')
                : t('defaults.readbackMatch'), hasUnsaved ? "warning" : "success"));
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
    const agentImage = releaseAgentImage, modelRef = String(form.get('modelRef') || '');
    if (!agentImage) {
        feedback = localizedFeedback(() => Feedback(t('runtime.releaseUnavailable'), 'warning'));
        renderPage();
        return;
    }
    if (!modelRef) {
        setFieldError('modelRef', t('runtime.selectModel'));
        return;
    }
    runtimeDraft = { ...runtimeDraft, agentImage, modelRef };
    const valid = currentView(), submittedVersion = JSON.stringify(runtimeDraft);
    saving = true;
    const button = document.querySelector('#runtime-form button[type=submit]');
    if (button) {
        button.disabled = true;
        button.textContent = t('common.saving');
    }
    try {
        runtime = await awaitCurrent(adapter.saveRuntimeSelection(modelRef));
        if (!runtime || runtime.modelRef !== modelRef)
            throw new ConsoleError('RESULT_UNKNOWN', t('runtime.readBeforeSave'));
        dirty = JSON.stringify(runtimeDraft) !== submittedVersion;
        runtimeEditing = dirty;
        readbackRequired = false;
        if (!dirty)
            runtimeDraft = { agentImage: runtime.agentImage, provider: runtime.provider, modelId: runtime.modelId, baseUrl: runtime.baseUrl, modelRef: runtime.modelRef || '' };
        confirmedMutation(t('runtime.savedLabel'));
        feedback = localizedFeedback(() => Feedback(t('runtime.savedVerifying'), 'success'));
        renderPage();
        try {
            health = await awaitCurrent(adapter.health());
            statusError = '';
            const result = health;
            feedback = localizedFeedback(() => Feedback(result.ready ? t('runtime.savedReady') : t('runtime.savedNotReadyWithReason', { reason: result.reason || t('adapter.health.unknown') }), result.ready ? 'success' : 'warning'));
        }
        catch (error) {
            if (error instanceof ConsoleViewChanged)
                return;
            statusError = localizedStatusError(() => t('runtime.readinessUnconfirmedValue'));
            feedback = localizedFeedback(() => Feedback(t('runtime.savedReadinessUnconfirmed'), 'warning'));
        }
    }
    catch (error) {
        if (error instanceof ConsoleViewChanged || isSessionError(error))
            return;
        readbackRequired = error instanceof ConsoleError && error.code === 'RESULT_UNKNOWN';
        const unknown = readbackRequired;
        feedback = localizedFeedback(() => Feedback(err(error), unknown ? 'warning' : 'error', unknown ? Button(t('recovery.readRuntime'), 'readback') : ''));
    }
    finally {
        if (valid()) {
            saving = false;
            renderPage();
        }
    }
}
async function saveDefaults() {
    if (!defaults ||
        !defaultDraft ||
        !dirty ||
        readbackRequired ||
        defaultConflicts.length > 0)
        return;
    const d = structuredClone(defaultDraft), submittedVersion = JSON.stringify(defaultDraft), valid = currentView();
    if (new TextEncoder().encode(d.agentsMd).length > 262144) {
        defaultEditSection = "agentsMd";
        renderPage();
        setFieldError("agentsMd", t('defaults.agentsTooLarge'));
        return;
    }
    const patch = {};
    ["skills", "packages", "agentsMd"].forEach((k) => {
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
        confirmedMutation(t('defaults.savedOutcome'));
        defaultLastSaved = true;
        dirty = changedDefaults();
        readbackRequired = false;
        feedback = localizedFeedback(() => Feedback(t('defaults.savedOutcome'), "success"));
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
        const unknown = readbackRequired;
        feedback = localizedFeedback(() => Feedback(err(e), unknown ? "warning" : "error", unknown ? Button(t('recovery.readDefaults'), "readback") : ""));
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
        feedback = localizedFeedback(() => Feedback(t('defaults.importTooLarge'), "error"));
        renderPage();
        return;
    }
    let text;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    }
    catch {
        feedback = localizedFeedback(() => Feedback(t('defaults.importNotUtf8'), "error"));
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
        feedback = localizedFeedback(() => Feedback(t('defaults.imported'), "info"));
        renderPage();
    };
    if (defaultDraft.agentsMd !== defaults?.agentsMd) {
        openDialog(t('defaults.replaceDraftTitle'), t('defaults.replaceDraftDetail'), `<p class="muted">${t('defaults.replaceDraftNote')}</p>`, t('defaults.replaceDraft'), () => {
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
        el.id === "modelRef") {
        Object.assign(runtimeDraft, { [el.id]: el.value });
        updateDirty();
    }
    if (path === "/runtime" && el.id === "apiKey")
        updateDirty();
    if (path === "/default-work" && defaultDraft) {
        if (el.id === "agentsMd") {
            defaultDraft.agentsMd = el.value;
            updateDirty();
            const size = new TextEncoder().encode(el.value).length;
            const count = document.querySelector("#agents-count");
            if (count) {
                count.textContent = t('defaults.agentsBytes', { count: formatNumber(size) });
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
            showToast(t('defaults.packageLimit'));
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
        const record = actions.begin({ key: `preflight:${version}`, kind: 'read', label: t('intent.checkingFiles'), target: files[0].name,
            anchor: el.id === 'upload-files' ? '#dialog-feedback' : '#defaults-form', view: path });
        try {
            if (el.id === 'agents-file')
                await importAgents(files[0], () => version === selectionVersion && previousPath === path);
            else {
                const selection = type === 'skill' ? await inspectSkillFiles(files, target) : await inspectPackageFiles(files, kind);
                if (version !== selectionVersion || previousDialog !== dialog || previousPath !== path)
                    return;
                if (target && type === 'package' && (kind === 'Local directory' || kind === 'ZIP') && selection.name !== target)
                    throw new ConsoleError('NAME_MISMATCH', t('upload.nameMismatch', { name: target }));
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
        const submitButton = form.querySelector('button[type="submit"]');
        if (!submissionPending && !preflightPending && !submitButton?.disabled) {
            const submit = dialogAction, data = new FormData(form);
            await tracked({ key: `dialog:${path}:${currentModalTitle}`, kind: 'configuration', resource: currentModalTitle, label: t('intent.submitting'), target: `${currentModalTitle} · ${routeId() || String(data.get('new-account') || upload?.name || packageSourceDraft || t('term.core'))}`, anchor: '#dialog-submit', view: path }, async () => { await submit?.(data); });
        }
        return;
    }
    if (form.id === "login-form") {
        if (signingIn || loginOutcomeUnknown)
            return;
        signingIn = true;
        const record = actions.begin({ key: "login", kind: "identity", label: t('login.signingInLabel'), target: t('login.title'), anchor: "#login-form", view: path });
        loginAccount = String(new FormData(form).get("account") || "");
        const password = form.querySelector("#password").value;
        const button = form.querySelector("button[type=submit]");
        button.disabled = true;
        button.textContent = t('login.signingIn');
        try {
            if (Date.now() < rateUntil) {
                const remaining = Math.ceil((rateUntil - Date.now()) / 1000);
                throw new ConsoleError("RATE_LIMITED", t('login.rateLimited', { seconds: remaining }));
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
            if (e instanceof ConsoleError && ['RESULT_UNKNOWN', 'INVALID_RESPONSE'].includes(e.code)) {
                loginOutcomeUnknown = true;
                button.textContent = t('login.signIn');
                await checkConsoleLogin();
                signingIn = false;
                if (record)
                    actions.finish(record);
                return;
            }
            const message = e instanceof ConsoleError && e.code === "RATE_LIMITED"
                ? t('login.rateLimited', { seconds: Math.max(1, Math.ceil((rateUntil - Date.now()) / 1000)) })
                : err(e);
            document.querySelector("#login-error").innerHTML = Feedback(message, "error", e instanceof ConsoleError && e.code === "CORE_UNREACHABLE"
                ? Button(t('login.retryConnection'), "retry-connection", "secondary")
                : "");
            button.disabled = false;
            button.textContent = t('login.signIn');
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
                        ? t('login.rateLimited', { seconds: remaining })
                        : t('login.rateRetry'), "warning");
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
        await tracked({ key: 'save-runtime', kind: 'configuration', resource: 'runtime', label: t('intent.saving'), target: t('term.runtime'), anchor: '#runtime-form', view: path }, async () => { await saveRuntime(new FormData(form)); });
    if (form.id === "defaults-form")
        await tracked({ key: 'save-defaults', kind: 'configuration', resource: 'defaults', label: t('intent.saving'), target: t('term.defaultWork'), anchor: '#defaults-form', view: path }, async () => { await saveDefaults(); });
    if (form.id === "operation-find") {
        const id = String(new FormData(form).get("operation-id") || "").trim();
        if (id) {
            interruptedOperation = null;
            navigate("/operations/" + encodeURIComponent(id));
        }
    }
});
document.addEventListener("click", async (event) => {
    const element = event.target;
    const plain = event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
    if (element.closest('#account-trigger')) {
        const menu = document.querySelector('#account-dropdown');
        if (menu?.hidden)
            openAccountMenu();
        else
            closeAccountMenu();
        return;
    }
    const workbench = element.closest('a[data-workbench]');
    if (workbench) {
        if (plain) {
            event.preventDefault();
            closeAccountMenu();
            leaveForWorkbench(workbench.href);
        }
        return;
    }
    const link = element.closest("a[data-nav]");
    if (link && !plain)
        return;
    if (link) {
        event.preventDefault();
        const target = link.getAttribute("href");
        if (path === "/default-work" &&
            link.closest(".context-tabs") &&
            (target === "/skills" || target === "/packages")) {
            openCapabilityLibrary(target.slice(1));
            return;
        }
        interruptedOperation = null;
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
        feedback = localizedFeedback(() => Feedback(t('defaults.conflictsKept'), "info"));
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
            document.querySelector("#modelRef")?.focus();
        }
    }
    else if (action === "cancel-runtime-edit") {
        const cancel = () => {
            dirty = false;
            runtimeEditing = false;
            runtimeDraft = runtime
                ? {
                    agentImage: releaseAgentImage,
                    provider: runtime.provider,
                    modelId: runtime.modelId,
                    baseUrl: runtime.baseUrl,
                    modelRef: runtime.modelRef || "",
                }
                : { agentImage: "", provider: "", modelId: "", baseUrl: "", modelRef: "" };
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
    else if (action === "language") {
        const fromAccount = !!button.closest('#account-dropdown');
        languagePicker.open(button, {
            anchorRect: fromAccount ? document.querySelector('#account-trigger')?.getBoundingClientRect() : undefined,
            beforeOpen: () => { if (fromAccount)
                closeAccountMenu(); },
            restoreFocus: () => document.querySelector(fromAccount ? '#account-trigger' : '[data-language-trigger="login"]'),
        });
    }
    else if (action === "close-dialog")
        closeDialog();
    else if (action === "copy") {
        try {
            await navigator.clipboard.writeText(button.dataset.value || "");
            showToast(t('common.copied'));
        }
        catch {
            showToast(t('common.clipboardUnavailable'));
        }
    }
    else if (action === "refresh") {
        interruptedOperation = null;
        await loadPage(true);
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
                disposeQuickSetup();
                closeAccountMenu();
                dirty = false;
                if (hosted) {
                    location.assign('/login');
                    return;
                }
                upload = null;
                packageIntent = null;
                path = "/login";
                history.pushState({ path }, "", publicPath(path));
                feedback = localizedFeedback(() => Feedback(t('login.signedOut'), "success"));
                renderPage();
            }
            catch (e) {
                showError(new ConsoleError("SIGNOUT_FAILED", t('login.signOutFailed')));
            }
        };
        if (quickSetup && dirty)
            quickSetup.requestLeave(() => void tracked({ key: `manual:${path}:sign-out`, kind: 'identity', label: t('intent.signingOut'), target: adapter.account, view: path, anchor: '[data-action=sign-out]' }, async () => { await signOut(); }));
        else if (dirty)
            confirmDiscard(() => void signOut());
        else
            await signOut();
    }
    else if (action === "retry-connection") {
        availabilitySequence++;
        clearTimeout(availabilityTimer);
        adapter.cancelReads(['availability']);
        try {
            await adapter.connection();
            feedback = localizedFeedback(() => Feedback(t('login.coreReachable'), "success"));
        }
        catch (e) {
            feedback = localizedFeedback(() => Feedback(err(e), "error", Button(t('login.retryConnection'), "retry-connection", "secondary")));
        }
        renderPage();
    }
    else if (action === "check-login")
        await checkConsoleLogin();
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
        interruptedOperation = null;
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
            document.querySelector("#source-confirm").innerHTML = Feedback(t('upload.switchWarning'), "warning", Button(t('upload.keepSource'), "keep-source") +
                Button(t('upload.discardSource'), "discard-source", "danger"));
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
history.replaceState({ path }, "", publicPath(path) + location.search);
pageURL = location.pathname + location.search;
let startupSequence = 0, availabilitySequence = 0;
let startupTimer, availabilityTimer;
function startupStatus(message) {
    const node = app.querySelector('[data-startup-status]');
    if (node)
        node.textContent = message;
}
function availabilityNotice(message) {
    let node = document.getElementById('console-availability-notice');
    if (!node) {
        node = document.createElement('div');
        node.id = 'console-availability-notice';
        node.className = 'feedback warning';
        node.setAttribute('role', 'status');
        const text = document.createElement('span');
        text.dataset.availabilityMessage = '';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'btn secondary';
        retry.textContent = t('common.retry');
        retry.addEventListener('click', () => { void readAvailability(); });
        node.append(text, retry);
        document.body.prepend(node);
    }
    node.querySelector('[data-availability-message]').textContent = message;
}
async function readAvailability(automatic = false, attempt = 0) {
    if (!automatic) {
        availabilitySequence++;
        clearTimeout(availabilityTimer);
        adapter.cancelReads(['availability']);
    }
    const sequence = availabilitySequence, identity = adapter.identityEpoch, origin = path;
    const valid = () => sequence === availabilitySequence && identity === adapter.identityEpoch && origin === path;
    try {
        await adapter.connection();
        if (!valid())
            return;
        document.getElementById('console-availability-notice')?.remove();
        if (path === '/login') {
            const status = app.querySelector('.core-login-status');
            if (status)
                status.innerHTML = StatusLabel(t('login.coreAvailable'), 'success') + '<span class="muted">piwork-core</span>';
        }
    }
    catch (error) {
        if (!valid())
            return;
        if (path === '/login' && adapter.availability?.reachable === false)
            renderPage();
        else
            availabilityNotice(err(error));
        if (attempt < 2)
            availabilityTimer = setTimeout(() => { if (valid())
                void readAvailability(true, attempt + 1); }, attempt === 0 ? 1000 : 3000);
    }
}
async function startConsole(automatic = false, attempt = 0) {
    if (!automatic) {
        startupSequence++;
        clearTimeout(startupTimer);
        adapter.cancelReads(['session']);
        startupStatus(t('startup.opening'));
    }
    const sequence = startupSequence, origin = location.pathname + location.search;
    const valid = () => sequence === startupSequence && origin === location.pathname + location.search;
    try {
        await adapter.initialize();
        if (!valid())
            return;
        void readAvailability();
        await loadPage();
    }
    catch {
        if (!valid())
            return;
        startupStatus(t('startup.unconfirmed'));
        if (attempt < 2)
            startupTimer = setTimeout(() => { if (valid())
                void startConsole(true, attempt + 1); }, attempt === 0 ? 1000 : 3000);
    }
}
app.innerHTML = `<main class="main task-main"><p role="status" data-startup-status>${esc(t('startup.opening'))}</p><button type="button" class="btn secondary" data-startup-retry>${esc(t('common.retry'))}</button> <a href="/">${esc(t('startup.home'))}</a></main>`;
app.addEventListener('click', event => { if (event.target.closest('[data-startup-retry]'))
    void startConsole(); });
document.dispatchEvent(new Event('piwork:boot-ready'));
void startConsole();
window.addEventListener('pagehide', () => { startupSequence++; availabilitySequence++; pageRetryCycle++; clearTimeout(startupTimer); clearTimeout(availabilityTimer); clearTimeout(pageRetryTimer); adapter.cancelReads(['session', 'availability']); languagePicker.close(); modelManagement.leave(); disposeQuickSetup(); closeAccountMenu(); actions.clear(); clearPolling(); selectionVersion++; preflightPending = false; });
function productInfoPage() {
    const info = productInfo, build = info?.build, notes = info?.releaseNotes;
    const releases = `<a class="btn secondary small" href="https://github.com/pphboy/piwork/releases" target="_blank" rel="noopener noreferrer">${t('about.allReleases')}${icon('external', 15)}</a>`;
    const heading = PageHeader(t('module.about'), t('about.detail'), Button(t('common.refresh'), 'refresh', 'secondary') + releases);
    if (!build)
        return heading + feedback + Section(t('term.core'), '', Empty(t('about.versionUnavailable'), t('about.buildUnavailable')));
    const summary = Section(t('term.core'), '', `<div class="section-body"><dl class="summary-list about-build"><dt>${t('about.coreVersion')}</dt><dd class="about-version">${esc(build.version)}</dd><dt>${t('about.build')}</dt><dd class="row-line"><code>${esc(build.commit)}</code>${build.modified ? StatusLabel(t('about.modified'), 'warning') : ''}</dd><dt>${t('about.platform')}</dt><dd>${esc(build.os)} / ${esc(build.architecture)}</dd></dl></div>`);
    const changes = notes ? `<div class="release-intro"><h3>${esc(notes.title)}</h3>${notes.publishedAt ? `<p class="help">${esc(notes.publishedAt)}</p>` : ''}</div>${notes.sections.map((section) => `<div class="release-note-group"><h4>${esc(section.title)}</h4><ul>${section.items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div>`).join('')}` : `<p class="muted">${t('about.noReleaseNotes')}</p>`;
    return heading + feedback + summary + Section(t('about.releaseNotes'), notes ? t('about.version', { version: notes.version }) : '', `<div class="section-body release-notes">${changes}</div>`, '', 'about-release');
}
window.addEventListener('pageshow', event => { if (event.persisted)
    void loadPage(); });
//# sourceMappingURL=app.js.map