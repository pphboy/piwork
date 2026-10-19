const root = document.querySelector('#setup-app');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const proof = new URLSearchParams(location.hash.slice(1)).get('setup');
if (location.hash)
    history.replaceState(null, '', location.pathname);
let csrf = '', setupCSRF = '', busy = false, notice = '', stage = 'loading', account = '';
let snapshot = {}, models = [], selectedRef = '', modelUnknown = false, runtimeUnknown = false;
let pendingRuntime = null;
let pendingModel = null, beforeModels = new Set();
let draft = { model: '', api: 'openai-responses', baseUrl: '', name: '' };
let timer;
let statusEpoch = 0;
class RequestError extends Error {
    status;
    unknown;
    constructor(message, status = 0, unknown = false) {
        super(message);
        this.status = status;
        this.unknown = unknown;
    }
}
async function request(path, method = 'GET', body, setup = false) {
    let response;
    try {
        response = await fetch(path, { method, credentials: 'same-origin', headers: {
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
                ...(method === 'GET' ? {} : { 'X-Piwork-Csrf': setup ? setupCSRF : csrf, 'X-Csrf-Token': setup ? setupCSRF : csrf }),
            }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    }
    catch {
        throw new RequestError(method === 'GET' ? 'The server could not be reached. Retry this read.' : 'The result is not confirmed. Read current state before submitting again.', 0, method !== 'GET');
    }
    const value = await response.json().catch(() => null);
    if (!value || typeof value !== 'object')
        throw new RequestError('The response could not be confirmed. Read current state.', response.status, method !== 'GET');
    if (!response.ok) {
        let message = String(value.message || value.code || 'The request failed.');
        if (value.code === 'AUTHENTICATION_FAILED')
            message = 'The account or password is incorrect, or the account is unavailable.';
        if (value.code === 'RATE_LIMITED')
            message = `Too many sign-in attempts. Wait ${Math.max(1, Math.ceil(Number(value.retryAfterMs || 60000) / 1000))} seconds before retrying.`;
        if (value.field)
            message += ` Check ${value.field}.`;
        throw new RequestError(message, response.status, method !== 'GET' && response.status >= 500);
    }
    return value;
}
const web = (path, method = 'GET', body, setup = false) => request('/_web/api/' + path, method, body, setup);
const admin = (path, method = 'GET', body) => request('/console/api/admin/' + path, method, body);
const field = (label, name, value = '', type = 'text', extra = '') => `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const button = (label, action, primary = false, disabled = false) => `<button type="button" class="btn ${primary ? 'primary' : 'secondary'}" data-action="${action}" ${busy || disabled ? 'disabled' : ''}>${label}</button>`;
function render() {
    const title = stage === 'administrator' ? 'Create your administrator' : stage === 'login' ? 'Sign in to Piwork' : stage === 'wizard' ? 'Set up your Core runtime' : stage === 'authorization' ? 'Open your setup link' : stage === 'waiting' ? 'Core setup is pending' : 'Opening Piwork…';
    let content = '';
    if (stage === 'authorization')
        content = `<p>First-time setup requires the private link printed in the installer terminal.</p><p>To replace an expired or lost link, run <code>piwork setup link</code> in that terminal using this installation’s data directory. In Docker, run the command inside the server container.</p>${button('Check setup access', 'refresh', true)}`;
    if (stage === 'administrator' || stage === 'login')
        content = `<form id="credentials">${field('Account', 'account', account, 'text', 'autocomplete="username" required maxlength="128"')}${field('Password', 'password', '', 'password', `autocomplete="${stage === 'administrator' ? 'new-password' : 'current-password'}" required ${stage === 'administrator' ? 'minlength="12"' : ''}`)}<p class="help">${stage === 'administrator' ? 'Use at least 12 characters. This creates the persistent first administrator.' : 'Your credentials stay on this server; this browser receives an opaque session cookie.'}</p><button class="btn primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Waiting for confirmation…' : stage === 'administrator' ? 'Create administrator' : 'Sign in'}</button></form>`;
    if (stage === 'waiting')
        content = `<p>An administrator needs to configure the model and runtime. Available workbench features remain accessible.</p><a class="btn primary" href="/">Open workbench</a>${button('Refresh state', 'refresh')}`;
    if (stage === 'wizard') {
        const runtime = snapshot.runtime || {}, configured = runtime.configured === true;
        content = `<p>Save a model connection, then bind it to the runtime. Preparation continues in the background. Saving does not call the model or create a Work.</p>
      <section class="section"><h2>1. Model connection</h2><label class="field"><span>Saved model</span><select id="saved-model" aria-label="Saved model"><option value="">Choose a model</option>${models.map(m => `<option value="${esc(m.modelRef)}" ${m.modelRef === selectedRef ? 'selected' : ''} ${!m.enabled || !m.credentialAvailable ? 'disabled' : ''}>${esc(m.name || m.model)}${!m.enabled ? ' — Disabled' : !m.credentialAvailable ? ' — Key unavailable' : ''}</option>`).join('')}</select></label>
      ${modelUnknown ? '<p role="status">The model save result is not confirmed. Read saved models and select the confirmed entry; do not create it again.</p>' : ''}
      <form id="model"><h3>Add a model</h3>${field('Model ID', 'model', draft.model, 'text', 'required maxlength="256"')}<label class="field"><span>API type</span><select name="api" aria-label="API type"><option value="openai-responses" ${draft.api === 'openai-responses' ? 'selected' : ''}>OpenAI Responses</option><option value="anthropic-messages" ${draft.api === 'anthropic-messages' ? 'selected' : ''}>Anthropic Messages</option></select></label>${field('Base URL', 'baseUrl', draft.baseUrl, 'url', 'required placeholder="https://api.example.com/v1"')}${field('API Key', 'credential', '', 'password', 'required autocomplete="off"')}<details><summary>Optional display name</summary>${field('Display name', 'name', draft.name)}</details><div class="form-actions">${button('Test connection', 'test-model')}<button class="btn primary" type="submit" ${busy || modelUnknown ? 'disabled' : ''}>Save model</button></div><p class="help">Test sends a real request and may incur provider charges. It is optional and does not save or change configuration.</p><p id="test-result" role="status"></p></form></section>
      <section class="section"><h2>2. Core runtime</h2><p>${configured ? 'A runtime is already saved. Existing Work configurations remain unchanged.' : 'The release Agent image is supplied automatically.'}</p><p>Release Agent image: <code data-runtime-agent-image>${esc(snapshot.defaultAgentImage || "Unavailable")}</code></p>${configured ? `<p>Saved Agent image: <code>${esc(runtime.agentImage)}</code></p>` : ""}${!snapshot.defaultAgentImage ? '<p role="alert">The release Agent image is unavailable. Repair the server release, then read current state.</p>' : ""}<div class="form-actions">${button('Save runtime', 'save-runtime', true, !selectedRef || runtimeUnknown || !snapshot.defaultAgentImage)}${button('Read current state', 'refresh')}</div><p id="runtime-result" role="status">${runtimeUnknown ? 'Runtime result is not confirmed. Read current state before another save.' : configured ? 'Runtime saved.' : 'Runtime not configured.'}</p></section>
      <section class="section"><h2>3. Dependency preparation</h2><p id="preparation-summary"></p><ul id="preparation-components"></ul><p>Docker, image pulls and Work readiness are checked separately. Failed dependencies retry automatically after the reported delay; restore Docker or image network access, then read current state. You can leave this page and return later.</p></section>
      <div class="form-actions"><a class="btn primary" href="/">Open workbench</a><a class="btn secondary" href="/admin">Administration</a>${button('Sign out', 'logout')}</div>`;
    }
    root.innerHTML = `<div class="${stage === 'wizard' ? '' : 'login'}"><h1 class="login-heading">${title}</h1>${notice ? `<p class="form-notice" role="alert">${esc(notice)}</p>` : ''}${content}</div>`;
    updatePreparation();
}
function updatePreparation() {
    const summary = document.querySelector('#preparation-summary');
    if (summary)
        summary.textContent = snapshot.status?.ready ? 'Core is ready for Work operations.' : `Core state: ${snapshot.status?.state || 'Checking'}`;
    const components = document.querySelector('#preparation-components');
    if (components)
        components.innerHTML = Object.entries(snapshot.preparation?.components || {}).map(([name, raw]) => { const value = raw; return `<li>${esc(name)}: ${esc(value.state || 'Not configured')}${value.code ? ' — ' + esc(value.code) : ''}${value.retryAfterSeconds != null ? ' · Retrying in ' + esc(value.retryAfterSeconds) + ' seconds' : ''}</li>`; }).join('');
}
async function loadWizard() {
    const epoch = ++statusEpoch;
    clearTimeout(timer);
    const current = await web('onboarding');
    if (epoch !== statusEpoch)
        return;
    snapshot = current;
    if (!snapshot.administrator) {
        stage = 'waiting';
        render();
        return;
    }
    const result = await admin('models');
    if (epoch !== statusEpoch)
        return;
    models = result.models || [];
    if (!selectedRef)
        selectedRef = snapshot.runtime?.modelRef || '';
    if (modelUnknown && pendingModel) {
        const matches = models.filter(m => !beforeModels.has(m.id) && m.model === pendingModel.model && m.api === pendingModel.api && m.baseUrl === pendingModel.baseUrl && (!pendingModel.name || m.name === pendingModel.name));
        if (matches.length === 1) {
            selectedRef = matches[0].modelRef;
            modelUnknown = false;
            pendingModel = null;
            notice = 'The saved model was confirmed by reading current data.';
        }
    }
    if (runtimeUnknown && pendingRuntime && snapshot.runtime?.configured && snapshot.runtime.modelRef === pendingRuntime.modelRef && snapshot.runtime.agentImage === pendingRuntime.agentImage) {
        runtimeUnknown = false;
        pendingRuntime = null;
        notice = 'The saved runtime was confirmed by reading current data.';
    }
    stage = 'wizard';
    render();
    scheduleStatus();
}
function scheduleStatus() {
    clearTimeout(timer);
    const epoch = statusEpoch;
    timer = setTimeout(async () => {
        if (stage !== 'wizard' || epoch !== statusEpoch)
            return;
        try {
            const value = await web('onboarding');
            if (epoch !== statusEpoch)
                return;
            snapshot = value;
            updatePreparation();
        }
        catch (error) {
            const el = document.querySelector('#preparation-summary');
            if (el)
                el.textContent = `State could not be refreshed: ${error.message}`;
        }
        if (epoch === statusEpoch)
            scheduleStatus();
    }, 5000);
}
async function load() {
    clearTimeout(timer);
    const state = await web('state');
    if (!state.administratorInitialized) {
        const access = await web('setup/session');
        setupCSRF = access.csrfToken || '';
        stage = access.authorized ? 'administrator' : 'authorization';
        render();
        return;
    }
    const session = await web('session');
    csrf = session.csrfToken || '';
    if (!session.authenticated) {
        stage = 'login';
        render();
        return;
    }
    if (location.pathname === '/login') {
        location.replace(session.next || '/');
        return;
    }
    await loadWizard();
}
function capture() {
    const form = document.querySelector('#model');
    if (form) {
        const data = new FormData(form);
        draft = { ...draft, model: String(data.get('model') || ''), api: String(data.get('api') || ''), baseUrl: String(data.get('baseUrl') || ''), name: String(data.get('name') || '') };
    }
}
function setBusy(value) {
    busy = value;
    if (value) {
        statusEpoch++;
        clearTimeout(timer);
    }
    else if (stage === 'wizard') {
        scheduleStatus();
    }
    root.querySelectorAll('button').forEach(button => { button.disabled = value; });
    const bind = root.querySelector('[data-action=save-runtime]');
    if (bind)
        bind.disabled = value || !selectedRef || runtimeUnknown || !snapshot.defaultAgentImage;
    const save = root.querySelector('#model [type=submit]');
    if (save)
        save.disabled = value || modelUnknown;
}
root.addEventListener('input', capture);
root.addEventListener('change', event => { const target = event.target; if (target.id === 'saved-model')
    selectedRef = target.value; capture(); setBusy(busy); });
root.addEventListener('submit', event => { event.preventDefault(); if (busy)
    return; const form = event.target; void submit(form).catch(error => { notice = error.message; render(); }); });
async function submit(form) {
    const data = new FormData(form);
    if (form.id === 'credentials') {
        account = String(data.get('account') || '');
        const password = String(data.get('password') || '');
        const creating = stage === 'administrator';
        setBusy(true);
        const passwordField = form.querySelector('[name=password]');
        try {
            const value = await web(creating ? 'setup/administrator' : 'login', 'POST', { account, password }, creating);
            passwordField.value = '';
            location.replace(value.next || '/');
        }
        catch (error) {
            passwordField.value = '';
            notice = error.message;
            if (error instanceof RequestError && error.unknown) {
                notice += ' Check whether the administrator was created before trying again.';
                stage = 'authorization';
            }
            if (!creating) {
                const session = await web('session').catch(() => ({}));
                csrf = session.csrfToken || '';
            }
        }
        finally {
            busy = false;
            render();
        }
        return;
    }
    if (form.id === 'model') {
        if (modelUnknown)
            return;
        capture();
        const input = { name: draft.name.trim(), model: draft.model.trim(), api: draft.api, baseUrl: draft.baseUrl.trim(), credential: String(data.get('credential') || '') };
        beforeModels = new Set(models.map(model => model.id));
        pendingModel = { name: input.name, model: input.model, api: input.api, baseUrl: input.baseUrl };
        setBusy(true);
        try {
            const value = await admin('models', 'POST', input);
            if (typeof value.modelRef !== 'string')
                throw new RequestError('Model save is not confirmed. Read saved models.', 0, true);
            selectedRef = value.modelRef;
            pendingModel = null;
            notice = 'Model saved. Next, save the runtime with this model.';
            draft = { ...draft, model: '', baseUrl: '', name: '' };
        }
        catch (error) {
            modelUnknown = error instanceof RequestError && error.unknown;
            notice = error.message;
        }
        finally {
            input.credential = '';
            const key = form.querySelector('[name=credential]');
            if (key)
                key.value = '';
            busy = false;
        }
        await loadWizard();
    }
}
root.addEventListener('click', event => { const action = event.target.closest('[data-action]')?.dataset.action; if (action && !busy)
    void act(action).catch(error => { busy = false; notice = error.message; render(); }); });
async function act(action) {
    capture();
    if (action === 'refresh') {
        notice = '';
        await load();
        return;
    }
    if (action === 'logout') {
        setBusy(true);
        try {
            await web('logout', 'POST', {});
            location.replace('/login');
        }
        finally {
            busy = false;
        }
        return;
    }
    if (action === 'save-runtime') {
        if (!selectedRef || runtimeUnknown || !snapshot.defaultAgentImage)
            return;
        pendingRuntime = { agentImage: snapshot.defaultAgentImage, modelRef: selectedRef };
        setBusy(true);
        try {
            const value = await admin('runtime', 'PUT', { modelRef: pendingRuntime.modelRef });
            if (!value.runtime?.configured || value.runtime.modelRef !== selectedRef)
                throw new RequestError('Runtime save is not confirmed. Read current state.', 0, true);
            notice = 'Runtime saved. Dependency preparation continues in the background.';
            pendingRuntime = null;
        }
        catch (error) {
            runtimeUnknown = error instanceof RequestError && error.unknown;
            notice = error.message;
        }
        finally {
            busy = false;
        }
        await loadWizard();
        return;
    }
    if (action === 'test-model') {
        const form = document.querySelector('#model');
        if (!form.reportValidity())
            return;
        const data = new FormData(form);
        const input = { model: draft.model.trim(), api: draft.api, baseUrl: draft.baseUrl.trim(), credential: String(data.get('credential') || '') };
        setBusy(true);
        const result = document.querySelector('#test-result');
        result.textContent = 'Testing the model connection…';
        try {
            const value = await admin('model-tests', 'POST', input);
            result.textContent = value.success ? `Test succeeded: ${value.replyText || 'Model replied.'}` : `Test failed: ${value.message || value.reason || 'Check the connection.'} ${value.recovery || ''} You may still save valid configuration.`;
        }
        catch (error) {
            result.textContent = `Test could not be confirmed: ${error.message} No configuration was saved. You may still save valid configuration.`;
        }
        finally {
            input.credential = '';
            setBusy(false);
        }
    }
}
void (async () => {
    render();
    if (proof) {
        try {
            await web('setup/redeem', 'POST', { proof }, true);
        }
        catch {
            notice = 'Setup authorization could not be confirmed. Checking the current setup session; an expired link can be replaced from the installer terminal.';
        }
    }
    await load();
})().catch(error => { stage = 'authorization'; notice = error.message; render(); });
window.addEventListener('beforeunload', event => { capture(); if (draft.model || draft.baseUrl || draft.name) {
    event.preventDefault();
} });
export {};
//# sourceMappingURL=onboarding.js.map