import { createLanguagePicker } from './i18n.js';
import { readWithDeadline, ReadTimeout } from './read-deadline.js';
import { esc, Field, Input, Feedback, icon } from './components.js';
import { modelErrors } from './model-form.js';
import { pendingDots } from './pending.js';
import { t, onLocaleChange, chooseLocale, languageChoices, applyDocumentTitle, LocalizedMessage, messageText } from './locale.js';
const root = document.querySelector('#setup-app');
const languagePicker = createLanguagePicker({ choices: languageChoices, label: () => t('lang.menu'), onChoose: chooseLocale });
if (location.hash)
    history.replaceState(null, '', location.pathname + location.search);
let csrf = '', authenticated = false, stage = 'loading', account = '', notice = '', noticeError = false, view = 0, identity = 0, writing = false, reading = false, snapshot = {};
let readLock = null, readController = null, readCycle = 0, readRetryTimer;
let waitTimer, waitSince = 0, waitPhase = '';
let credentialUnknown = null;
let lastReadFailed = false;
class RequestError extends Error {
    status;
    unknown;
    field;
    code;
    feedback;
    constructor(message, status = 0, unknown = false, field = '', code = '') {
        super(messageText(message));
        this.status = status;
        this.unknown = unknown;
        this.field = field;
        this.code = code;
        this.feedback = message;
        if (message != null && typeof message !== 'string')
            Object.defineProperty(this, 'message', { get: () => messageText(message), configurable: true });
    }
}
async function request(path, method = 'GET', body, signal) {
    if (method === 'GET') {
        try {
            return await readWithDeadline(inner => requestOnce(path, method, body, inner), { signal });
        }
        catch (error) {
            if (error instanceof ReadTimeout)
                throw new RequestError(new LocalizedMessage('net.readTimeout'));
            throw error;
        }
    }
    return requestOnce(path, method, body);
}
async function requestOnce(path, method = 'GET', body, signal) {
    let response;
    try {
        response = await fetch(path, { method, credentials: 'same-origin', signal, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(method === 'GET' ? {} : { 'X-Piwork-Csrf': csrf, 'X-Csrf-Token': csrf }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    }
    catch {
        throw new RequestError(new LocalizedMessage(method === 'GET' ? 'net.offlineRead' : 'net.offlineWrite'), 0, method !== 'GET');
    }
    const value = await response.json().catch(() => null);
    if (!value || typeof value !== 'object')
        throw new RequestError(new LocalizedMessage('net.response'), response.status, method !== 'GET');
    if (!response.ok) {
        let message = value.code === 'INVALID_REQUEST' ? modelErrors[value.field?.split('.')[0]] : undefined;
        if (!message)
            message = new LocalizedMessage('net.requestFailed');
        if (value.code === 'AUTHENTICATION_FAILED')
            message = new LocalizedMessage('net.auth');
        if (value.code === 'CSRF_INVALID')
            message = new LocalizedMessage('net.csrf');
        if (value.code === 'RATE_LIMITED')
            message = new LocalizedMessage('net.rate', { seconds: Math.max(1, Math.ceil(Number(value.retryAfterMs || 60000) / 1000)) });
        if (value.code === 'RELEASE_DEFAULTS_UNAVAILABLE')
            message = new LocalizedMessage('net.release');
        throw new RequestError(message, response.status, method !== 'GET' && response.status >= 500 && value.code !== 'RELEASE_DEFAULTS_UNAVAILABLE', String(value.field || ''), String(value.code || ''));
    }
    return value;
}
const web = (path, method = 'GET', body, signal) => request('/_web/api/' + path, method, body, signal);
const message = (error) => error instanceof RequestError ? error.feedback : error instanceof Error ? error.message : new LocalizedMessage('net.unconfirmed');
const button = (text, action, primary = false, disabled = false) => `<button type="button" class="btn ${primary ? 'primary' : 'secondary'}" data-action="${action}" ${disabled ? 'disabled' : ''}>${text}</button>`;
function current(ticket) { return ticket.view === view && ticket.identity === identity; }
function context() { return { view, identity }; }
function clearSecrets() { root.querySelectorAll('input[type=password]').forEach(input => { input.value = ''; }); }
function changeStage(next) { if (next !== stage) {
    clearSecrets();
    view++;
    stage = next;
    writing = false;
} }
function languageMenu() {
    return `<button type="button" class="btn ghost small language-trigger" data-action="language" data-language-trigger="setup" aria-haspopup="listbox" aria-expanded="${languagePicker.isOpen}">${icon('globe', 16)}<span>${t('lang.menu')}</span>${icon('down', 12)}</button>`;
}
function sessionNavigation() {
    return authenticated ? button(t('onboarding.signOut'), 'logout') : `<a class="btn ghost small" href="/login">${t('onboarding.signIn')}</a>`;
}
function credentialForm() {
    const creating = stage === 'administrator';
    return `<form id="credentials" class="form-grid" novalidate>${Field('account', t('onboarding.form.account'), Input('account', account, 'autocomplete="username" required maxlength="128"'))}${Field('password', t('onboarding.form.password'), Input('password', '', `type="password" autocomplete="${creating ? 'new-password' : 'current-password'}" required`), creating ? t('onboarding.form.passwordHelpCreate') : t('onboarding.form.passwordHelpLogin'))}${creating ? Field('confirm-password', t('onboarding.form.confirmPassword'), Input('confirm-password', '', 'type="password" autocomplete="new-password" required'), t('onboarding.form.confirmHelp')) : ''}<div class="form-actions"><button class="btn primary" type="submit">${creating ? t('onboarding.form.createAdmin') : t('onboarding.form.signIn')}<span class="pending-slot" data-credential-pending>${icon('arrow', 16)}</span></button><span id="credential-recovery"></span></div></form>`;
}
function render() {
    const title = stage === 'administrator' ? t('onboarding.title.createAdmin') : stage === 'login' ? t('onboarding.title.login') : stage === 'waiting' ? (snapshot.status?.ready ? t('onboarding.title.ready') : t('onboarding.title.pending')) : stage === 'error' ? t('onboarding.title.error') : t('onboarding.title.loading');
    let content = '';
    if (stage === 'administrator' || stage === 'login')
        content = credentialForm();
    if (stage === 'waiting')
        content = `<p>${snapshot.status?.ready ? t('onboarding.waiting.ready') : t('onboarding.waiting.pending')}</p><div class="form-actions"><a class="btn primary" href="/">${t('onboarding.openWorkbench')}${icon('arrow', 16)}</a>${button(t('onboarding.refreshState'), 'refresh')}</div>`;
    if (stage === 'error')
        content = `<p>${t('onboarding.error.body')}</p>${button(t('onboarding.readState'), 'refresh', true)}`;
    root.innerHTML = `<header class="setup-topbar"><a href="/" class="setup-brand" aria-label="${esc(t('onboarding.brandAria'))}"><img src="/setup/piwork-logo.png" width="32" height="32" alt=""><span>Piwork</span></a><span class="product-label">CoreSetup</span><nav aria-label="${esc(t('onboarding.navAria'))}">${languageMenu()}<span data-session-navigation data-authenticated="${authenticated}">${sessionNavigation()}</span></nav></header><main class="setup-main setup-narrow"><div class="setup-heading"><p class="eyebrow">${stage === 'login' ? t('onboarding.eyebrow.welcome') : t('onboarding.eyebrow.setup')}</p><h1>${title}</h1></div><div id="setup-notice" aria-live="polite"></div><div id="setup-status" class="setup-status" aria-live="polite"></div>${content}</main>`;
    applyDocumentTitle(t('onboarding.docTitle'));
    updateNotice();
    updateLocks();
}
function updateNotice() { const node = root.querySelector('#setup-notice'); if (node)
    node.innerHTML = notice ? Feedback(messageText(notice), noticeError ? 'warning' : 'success') : ''; }
function tell(text, error = false) { notice = text; noticeError = error; updateNotice(); }
function updateLocks() {
    const navigation = root.querySelector('[data-session-navigation]');
    if (navigation && navigation.dataset.authenticated !== String(authenticated)) {
        navigation.dataset.authenticated = String(authenticated);
        navigation.innerHTML = sessionNavigation();
    }
    const phase = writing ? 'write' : reading ? 'read' : '';
    if (phase !== waitPhase) {
        waitPhase = phase;
        waitSince = phase ? Date.now() : 0;
        clearTimeout(waitTimer);
        if (phase)
            waitTimer = setTimeout(updateLocks, 10000);
    }
    const slow = !!phase && Date.now() - waitSince >= 10000;
    const recovery = root.querySelector('#credential-recovery');
    if (recovery && Boolean(recovery.firstElementChild) !== Boolean(credentialUnknown))
        recovery.innerHTML = credentialUnknown ? button(t('onboarding.readState'), 'refresh') : '';
    root.querySelectorAll('input,button').forEach(node => { if (node instanceof HTMLButtonElement && node.hasAttribute('data-language-trigger'))
        return; node.disabled = writing || (node instanceof HTMLButtonElement && reading && node.dataset.action !== 'refresh') || (node instanceof HTMLButtonElement && node.type === 'submit' && !!credentialUnknown); });
    root.querySelector('#credentials [type=submit]')?.setAttribute('aria-busy', String(writing));
    const pending = root.querySelector('[data-credential-pending]');
    if (pending)
        pending.innerHTML = writing ? pendingDots() : icon('arrow', 16);
    root.querySelectorAll('[data-action="refresh"]').forEach(node => node.setAttribute('aria-busy', String(reading)));
    const status = root.querySelector('#setup-status');
    if (status)
        status.innerHTML = writing ? (stage === 'login' ? t('onboarding.status.signingIn') : stage === 'administrator' ? t('onboarding.status.creating') : `${pendingDots()} ${t('onboarding.status.signingOut')}`) : reading ? `${pendingDots()} ${t('onboarding.status.reading')}` : '';
    if (status && slow)
        status.innerHTML += `<span class="pending-wait-message"> ${esc(t('onboarding.status.slow'))}</span>`;
}
let confirmationTouched = false;
function fieldError(id, text) {
    const input = root.querySelector('#' + id), error = root.querySelector('#' + id + '-error');
    if (input) {
        if (text) {
            input.setAttribute('aria-invalid', 'true');
            input.setAttribute('aria-errormessage', id + '-error');
        }
        else {
            input.removeAttribute('aria-invalid');
            input.removeAttribute('aria-errormessage');
        }
    }
    if (error) {
        error.textContent = messageText(text);
        error.hidden = !text;
    }
}
function validateCredentials(submitting = false) {
    const creating = stage === 'administrator', password = root.querySelector('#password')?.value || '', confirmation = root.querySelector('#confirm-password')?.value || '';
    const errors = {};
    if (submitting && !root.querySelector('#account')?.value.trim())
        errors.account = t('onboarding.error.accountRequired');
    if (submitting || root.querySelector('#password')?.getAttribute('aria-invalid') === 'true') {
        if (!password)
            errors.password = t('onboarding.error.passwordRequired');
        else if (creating && password.length < 12)
            errors.password = t('onboarding.error.passwordTooShort');
    }
    if (creating && (confirmationTouched || submitting))
        errors['confirm-password'] = !confirmation ? t('onboarding.error.confirmRequired') : confirmation !== password ? t('onboarding.error.confirmMismatch') : '';
    if (submitting)
        confirmationTouched = true;
    for (const id of ['account', 'password', 'confirm-password'])
        fieldError(id, errors[id] || '');
    const first = Object.keys(errors).find(id => !!errors[id]);
    if (submitting && first)
        root.querySelector('#' + first)?.focus();
    return !first;
}
async function credentials(form) {
    if (writing || reading || credentialUnknown || !validateCredentials(true))
        return;
    const creating = stage === 'administrator', ticket = context(), data = new FormData(form);
    account = String(data.get('account') || '');
    let password = String(data.get('password') || '');
    writing = true;
    updateLocks();
    try {
        const value = await web(creating ? 'setup/administrator' : 'login', 'POST', { account, password });
        if (!current(ticket))
            return;
        clearSecrets();
        identity++;
        location.replace(nextLocation(value.next || '/'));
    }
    catch (error) {
        if (!current(ticket))
            return;
        clearSecrets();
        tell(message(error), true);
        if (error instanceof RequestError && (error.unknown || (creating && error.status === 409))) {
            // Read back uncertain creation or sign-in; never replay the write.
            credentialUnknown = { kind: creating ? 'administrator' : 'login', account: String(data.get('account') || '') };
            writing = false;
            updateLocks();
            await load(creating);
        }
        else {
            const session = await web('session').catch(() => null);
            if (current(ticket) && session)
                csrf = session.csrfToken || '';
        }
    }
    finally {
        password = '';
        if (current(ticket)) {
            writing = false;
            updateLocks();
        }
    }
}
async function load(recoveringCreation = false, automatic = false, attempt = 0) {
    if (writing)
        return;
    if (automatic && reading)
        return;
    if (!automatic) {
        readCycle++;
        clearTimeout(readRetryTimer);
        readController?.abort();
    }
    const cycle = readCycle, controller = new AbortController(), lock = Symbol(), ticket = context(), checkedCredential = credentialUnknown;
    readController = controller;
    readLock = lock;
    reading = true;
    updateLocks();
    const currentRead = () => current(ticket) && readCycle === cycle && readLock === lock && !controller.signal.aborted;
    try {
        const state = await web('state', 'GET', undefined, controller.signal);
        if (!currentRead())
            return;
        const session = await web('session', 'GET', undefined, controller.signal);
        if (!currentRead())
            return;
        csrf = session.csrfToken || '';
        authenticated = session.authenticated === true;
        if (checkedCredential?.kind === 'login' && session.authenticated && session.user?.account !== checkedCredential.account) {
            tell(new LocalizedMessage('onboarding.error.loginDifferentAccount', { account: checkedCredential.account }), true);
            return;
        }
        if (credentialUnknown === checkedCredential)
            credentialUnknown = null;
        if (checkedCredential?.kind === 'login' && !session.authenticated)
            tell(t('onboarding.error.loginNotConfirmed'), true);
        else if (lastReadFailed && !checkedCredential)
            tell('');
        lastReadFailed = false;
        if (!state.administratorInitialized) {
            const changed = stage !== 'administrator';
            changeStage('administrator');
            if (recoveringCreation)
                tell(t('onboarding.error.recoveringAdmin'), true);
            if (changed)
                render();
            return;
        }
        if (!session.authenticated) {
            const changed = stage !== 'login';
            changeStage('login');
            if (recoveringCreation)
                tell(t('onboarding.error.recoveringLogin'));
            if (changed)
                render();
            return;
        }
        if (location.pathname === '/login') {
            location.replace(nextLocation(session.next || '/'));
            return;
        }
        if (session.user?.role === 'admin') {
            location.replace('/admin/setup');
            return;
        }
        const next = await web('onboarding', 'GET', undefined, controller.signal);
        if (!currentRead())
            return;
        snapshot = next;
        changeStage('waiting');
        render();
    }
    catch (error) {
        if (currentRead()) {
            lastReadFailed = true;
            const notice = credentialUnknown ? `${t('net.offlineWrite')} ${messageText(message(error))}` : message(error);
            if (stage === 'loading' || stage === 'error') {
                changeStage('error');
                tell(notice, true);
                render();
            }
            else
                tell(notice, true);
            if (attempt < 2) {
                const retryContext = context();
                readRetryTimer = setTimeout(() => { if (readCycle === cycle && current(retryContext) && !writing)
                    void load(recoveringCreation, true, attempt + 1); }, attempt === 0 ? 1000 : 3000);
            }
        }
    }
    finally {
        if (readLock === lock) {
            readLock = null;
            readController = null;
            reading = false;
            updateLocks();
        }
    }
}
root.addEventListener('submit', event => { event.preventDefault(); void credentials(event.target); });
root.addEventListener('input', () => { account = root.querySelector('#account')?.value || ''; validateCredentials(); });
root.addEventListener('focusout', event => { const input = event.target; if (input.id === 'confirm-password') {
    confirmationTouched = true;
    validateCredentials();
} if (input.id === 'password' && stage === 'administrator' && input.value && input.value.length < 12)
    fieldError('password', t('onboarding.error.passwordTooShort')); });
root.addEventListener('click', event => { const trigger = event.target.closest('[data-language-trigger]'); if (trigger) {
    event.preventDefault();
    languagePicker.open(trigger);
    return;
} const action = event.target.closest('[data-action]')?.dataset.action; if (!action || writing || (reading && action !== 'refresh'))
    return; event.preventDefault(); if (action === 'refresh') {
    if (!credentialUnknown)
        tell('');
    void load(credentialUnknown?.kind === 'administrator');
}
else if (action === 'logout') {
    writing = true;
    identity++;
    const ticket = context();
    clearSecrets();
    updateLocks();
    void web('logout', 'POST', {}).then(() => { if (!current(ticket))
        return; try {
        for (const key of Object.keys(sessionStorage))
            if (key.startsWith('piwork:web:'))
                sessionStorage.removeItem(key);
    }
    catch { } location.replace('/login'); }).catch(error => { if (!current(ticket))
        return; writing = false; tell(message(error), true); updateLocks(); });
} });
window.addEventListener('pagehide', () => { identity++; view++; readCycle++; readController?.abort(); readController = null; clearTimeout(readRetryTimer); readLock = null; reading = false; writing = false; clearTimeout(waitTimer); waitPhase = ''; waitSince = 0; clearSecrets(); });
window.addEventListener('pageshow', event => { if (event.persisted) {
    identity++;
    view++;
    writing = false;
    clearSecrets();
    void load();
} });
onLocaleChange(() => {
    // Keep credentials only in the current DOM across this presentation update.
    const passwords = [...root.querySelectorAll('input[type=password]')].map(input => [input.id, input.value]);
    render();
    for (const [id, value] of passwords) {
        const input = root.querySelector(`#${id}`);
        if (input)
            input.value = value;
    }
    validateCredentials();
});
render();
document.dispatchEvent(new Event('piwork:boot-ready'));
void load();
function nextLocation(fallback) {
    const target = new URLSearchParams(location.search).get('returnTo');
    if (!target || !/^\/services\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+\/[1-9][0-9]{0,4}\//.test(target))
        return fallback;
    const parsed = new URL(target, location.origin);
    return parsed.origin === location.origin && parsed.pathname.startsWith('/services/') ? parsed.pathname + parsed.search + parsed.hash : fallback;
}
//# sourceMappingURL=onboarding.js.map