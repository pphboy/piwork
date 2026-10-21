import { esc, Field, Feedback, StatusLabel, icon } from './components.js';
import { pendingDots } from './pending.js';
import { blankModel, modelDraftIssue, modelErrors, modelFields, modelField, modelPlaceholder, modelProtocolHelp, readModelDraft, validateModelControl, modelTestSummary, modelTestDetails, validModelTest } from './model-form.js';
export function mountQuickSetup(root, options) {
    let stage = 'loading', notice = '', noticeError = false, modelReadError = '', disposed = false;
    let noticeNode = null, noticeMarkup = '';
    let snapshot = {}, models = [], catalogError = '', selectedRef = '', mode = 'add';
    let draft = blankModel(), revision = 0, view = 0, identity = 0, reading = false, writing = false, testing = false;
    let modelUnknown = false, runtimeUnknown = false, confirmedModel = '', pendingRuntime = null;
    let pendingModel = null, beforeModels = new Set();
    let timer, readGeneration = 0, readLock = null, polling = false;
    let testResult = null, leaveAction = null, leaveGeneration = 0;
    let preparationReadError = '', preparationReadAt = '', advancedOpen = false, baselineReady = false;
    let baselineDraft = blankModel(), baselineRef = '', confirmedReadGeneration = -1;
    let slowTimer, busySince = 0, busyPhase = '';
    let preparationTimer, preparationSince = 0;
    let autoEnter = null;
    const firstModel = () => ({ ...blankModel(), model: 'deepseek-flash', api: 'anthropic-messages', baseUrl: 'https://api.deepseek.com/anthropic' });
    const preparationNames = ['docker', 'agent', 'packageHelper', 'defaultContext', 'fileHelper', 'snapshotHelper'];
    const preparationLabels = { docker: 'Docker Engine', agent: 'Agent', packageHelper: 'Packages', defaultContext: 'Work defaults', fileHelper: 'Files', snapshotHelper: 'Snapshots' };
    class RequestError extends Error {
        status;
        unknown;
        field;
        code;
        constructor(message, status = 0, unknown = false, field = '', code = '') {
            super(message);
            this.status = status;
            this.unknown = unknown;
            this.field = field;
            this.code = code;
        }
    }
    async function request(path, method = 'GET', body, setup = false) {
        let response;
        try {
            response = await fetch(path, { method, credentials: 'same-origin', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(method === 'GET' ? {} : { 'X-Piwork-Csrf': options.csrf(), 'X-Csrf-Token': options.csrf() }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        }
        catch {
            throw new RequestError(method === 'GET' ? 'The server could not be reached. Retry this read.' : 'The result is not confirmed. Read current state before submitting again.', 0, method !== 'GET');
        }
        const value = await response.json().catch(() => null);
        if (!value || typeof value !== 'object')
            throw new RequestError('The response could not be confirmed. Read current state.', response.status, method !== 'GET');
        if (!response.ok) {
            let message = value.code === 'INVALID_REQUEST' && modelErrors[value.field?.split('.')[0]] || String(value.message || value.code || 'The request failed.');
            if (value.code === 'AUTHENTICATION_FAILED')
                message = 'The account or password is incorrect, or the account is unavailable.';
            if (value.code === 'RATE_LIMITED')
                message = `Too many sign-in attempts. Wait ${Math.max(1, Math.ceil(Number(value.retryAfterMs || 60000) / 1000))} seconds before retrying.`;
            if (value.code === 'RELEASE_DEFAULTS_UNAVAILABLE')
                message = 'The server release is incomplete. Repair the server release, then read current state.';
            throw new RequestError(message, response.status, method !== 'GET' && response.status >= 500 && value.code !== 'RELEASE_DEFAULTS_UNAVAILABLE', String(value.field || ''), String(value.code || ''));
        }
        return value;
    }
    const web = (path, method = 'GET', body, setup = false) => request('/_web/api/' + path, method, body, setup);
    const admin = (path, method = 'GET', body) => request('/console/api/admin/' + path, method, body);
    const message = (error) => error instanceof Error ? error.message : 'The request could not be confirmed.';
    const button = (text, action, primary = false, disabled = false) => `<button type="button" class="btn ${primary ? 'primary' : 'secondary'}" data-action="${action}" ${disabled ? 'disabled' : ''}>${text}</button>`;
    function current(ticket) { return !disposed && options.current() && ticket.view === view && ticket.identity === identity; }
    function context() { return { view, identity }; }
    function capture() { if (writing || modelUnknown || runtimeUnknown)
        return; const form = root.querySelector('#model-form'); if (form)
        draft = readModelDraft(form); const advanced = root.querySelector('#model-advanced'); if (advanced)
        advancedOpen = advanced.open; }
    function dirty() { capture(); return stage === 'model' && !modelUnknown && !runtimeUnknown && (mode === 'add' ? Object.keys(draft).some(key => draft[key] !== baselineDraft[key]) : selectedRef !== baselineRef); }
    function clearSecrets() { draft.key = ''; root.querySelectorAll('input[type=password]').forEach(input => { input.value = ''; }); }
    function changeStage(next) {
        if (next === stage)
            return;
        clearSecrets();
        view++;
        readGeneration++;
        readLock = null;
        reading = false;
        polling = false;
        clearTimeout(timer);
        writing = false;
        testing = false;
        stage = next;
        if (next === 'model' || next === 'preparation')
            options.step(next);
        if (next === 'preparation')
            modelReadError = '';
        root.querySelector('#test-dialog')?.close();
    }
    function steps() {
        const at = stage === 'preparation' ? 1 : 0;
        return `<ol class="setup-steps" aria-label="Quick setup progress">${['AI model', 'Prepare Piwork'].map((label, index) => `<li ${index === 1 ? 'data-preparation-step' : ''} ${at === index ? 'aria-current="step"' : ''} class="${index < at ? 'complete' : index === at ? 'current' : ''}"><span class="step-marker">${index < at ? icon('check', 13) : index + 1}</span><span class="step-label">${label}</span></li>`).join('')}</ol>`;
    }
    function diagnostics() {
        return `<details class="disclosure setup-diagnostics"><summary>Runtime diagnostics</summary><div class="disclosure-body"><dl class="summary-list"><dt>Release Agent image</dt><dd><code data-runtime-agent-image>${esc(snapshot.defaultAgentImage || 'Unavailable')}</code></dd>${snapshot.runtime?.configured ? `<dt>Saved Agent image</dt><dd><code>${esc(snapshot.runtime.agentImage)}</code></dd><dt>Saved model reference</dt><dd><code>${esc(snapshot.runtime.modelRef)}</code></dd>` : ''}</dl><p class="help">Managed by the server release. Explicitly saving Runtime uses this release for future Work; existing Work stays unchanged.</p></div></details>`;
    }
    function modelOptions() {
        return `<option value="">Choose a model</option>${models.map(model => `<option value="${esc(model.modelRef)}" ${model.modelRef === selectedRef ? 'selected' : ''} ${!model.enabled || !model.credentialAvailable ? 'disabled' : ''}>${esc(model.name || model.model)}${!model.enabled ? ' — Disabled' : !model.credentialAvailable ? ' — Key unavailable' : ''}</option>`).join('')}`;
    }
    function modelPage() {
        const unavailable = selectedRef && !models.some(model => model.modelRef === selectedRef && model.enabled && model.credentialAvailable);
        return `<p class="setup-description">Choose the model this Core uses for new Work. Saving does not call the model or create a Work.</p><div id="setup-docker" class="setup-dependency"></div><div id="catalog-note">${catalogError ? Feedback('Saved models could not be loaded. ' + catalogError + ' Automatic updates will retry.', 'warning') : ''}</div>${confirmedModel ? Feedback('Model saved. Continue to bind this model to Core runtime.', 'success') : ''}${models.length && !modelUnknown ? `<div class="setup-mode" aria-label="Model configuration"><button class="btn small" type="button" data-action="choose-model" aria-pressed="${mode === 'choose'}">Choose saved model</button><button class="btn small" type="button" data-action="add-model" aria-pressed="${mode === 'add'}">${icon('plus', 14)} Add model</button></div>` : ''}${mode === 'add' ? `<form id="model-form" class="form-grid" data-setup-model novalidate>${modelFields(draft, false, { open: advancedOpen })}<div class="form-actions"><button type="submit" class="btn primary" data-continue>Save and continue<span class="pending-slot">${icon('arrow', 16)}</span></button><button type="button" class="btn secondary" data-model-action="test">Test</button></div><p class="help">Test sends a message and shows the reply. A passed Test is not required to save, enable or select a model.</p></form><div id="model-test-result">${modelTestSummary(testResult, revision)}</div>` : `<form id="choose-form" class="form-grid" novalidate>${Field('saved-model', 'Saved model', `<select id="saved-model" name="modelRef" required>${modelOptions()}</select>`, 'Only enabled models with a saved Key can be used.')}${unavailable ? Feedback('The saved model is unavailable. Choose an enabled model with a Key or manage AI models.', 'warning') : ''}<div class="form-actions"><button type="submit" class="btn primary" data-continue>Save and continue<span class="pending-slot">${icon('arrow', 16)}</span></button></div></form>`}<div id="release-note">${snapshot.releaseError ? Feedback('The server release is incomplete. Models remain available; repair the release before binding Runtime.', 'warning') : ''}</div>`;
    }
    function render() {
        const title = stage === 'model' ? 'Set up your Core runtime' : stage === 'preparation' ? 'Preparing Piwork…' : stage === 'error' ? 'Could not read Core state' : 'Reading Core configuration…';
        let content = '';
        if (stage === 'model')
            content = modelPage();
        if (stage === 'preparation')
            content = `<p class="setup-description">Your Runtime configuration is saved on this server.</p><div id="preparation-answer" class="preparation-state" aria-live="polite" aria-atomic="true"></div><div id="preparation-failures"></div><details class="disclosure" id="preparation-details"><summary>Preparation details · 6 components</summary><ul id="preparation-components" class="preparation-list" aria-label="Required components"></ul></details><div class="form-actions"><a class="btn secondary" id="workbench-exit" role="link" tabindex="0" aria-disabled="true" aria-describedby="preparation-exit-help">Open workbench${icon('arrow', 16)}</a>${button(icon('refresh', 15) + ' Read current state', 'refresh')}</div><p id="preparation-exit-help" class="help"></p>${diagnostics()}`;
        if (stage === 'error')
            content = `<p>Your saved configuration has not been changed. Retry when the server is reachable.</p>${button('Read current state', 'refresh', true)}`;
        root.innerHTML = `${steps()}<div class="setup-heading"><h2 id="setup-title">${title}</h2></div><div id="setup-notice" aria-live="polite"></div><div id="setup-status" class="setup-status" aria-live="polite"></div>${content}<dialog id="test-dialog" class="setup-dialog" aria-labelledby="test-title"><div class="dialog-heading"><div><h2 id="test-title">Model Test</h2><p>Send one message to the specified model and inspect its reply.</p></div><button class="btn icon-button" type="button" data-action="close-test" aria-label="Close Model Test">${icon('close')}</button></div><div id="test-body" class="dialog-body"></div><div class="dialog-footer"><button class="btn secondary" type="button" data-action="close-test">Close</button></div></dialog><dialog id="leave-dialog" class="setup-dialog" aria-labelledby="leave-title"><div class="dialog-heading"><h2 id="leave-title">Unsaved model configuration</h2></div><div class="dialog-body"><p>Save and continue before leaving, discard this draft, or keep editing.</p></div><div class="dialog-footer">${button('Keep editing', 'keep-editing')}${button('Discard draft', 'discard-draft')}${button('Save and continue', 'save-leave', true)}</div></dialog>`;
        updateNotice();
        updatePreparation();
        updateLocks();
    }
    function unknownNotice() {
        if (modelUnknown)
            return 'The model save result is unconfirmed. Automatic updates will check the saved models without submitting again. If it remains unconfirmed, review saved models before choosing how to continue.';
        if (runtimeUnknown)
            return 'Runtime save is unconfirmed. Automatic updates will check the original model and server release without submitting again. If it remains unconfirmed, review the saved configuration in Admin.';
        return '';
    }
    function updateNotice() {
        const node = root.querySelector('#setup-notice');
        if (!node)
            return;
        const unresolved = stage === 'model' ? unknownNotice() : '';
        const recovery = unresolved ? '<a href="/admin/models">Review saved models</a>' : '';
        const markup = (modelReadError ? Feedback(modelReadError, 'warning') : '') + (notice ? Feedback(notice, noticeError ? 'warning' : 'success', unresolved && notice.includes(unresolved) ? recovery : '') : '') + (unresolved && !notice.includes(unresolved) ? Feedback(unresolved, 'warning', recovery) : '');
        // A repeated read must not replace the focused exceptional recovery link.
        if (node !== noticeNode || markup !== noticeMarkup) {
            node.innerHTML = markup;
            noticeNode = node;
            noticeMarkup = markup;
        }
    }
    function tell(text, error = false) { notice = text; noticeError = error; updateNotice(); }
    function updateLocks() {
        if (disposed || !options.current())
            return;
        const phase = writing ? 'save' : reading ? 'read' : testing ? 'test' : '';
        if (phase !== busyPhase) {
            busyPhase = phase;
            busySince = phase ? Date.now() : 0;
            clearTimeout(slowTimer);
            if (phase)
                slowTimer = setTimeout(() => { updateLocks(); if (testing)
                    updateTest(); }, 10000);
        }
        const slow = !!phase && Date.now() - busySince >= 10000;
        root.querySelectorAll('form input, form select').forEach(input => { input.disabled = writing || modelUnknown || runtimeUnknown; });
        root.querySelectorAll('button').forEach(node => {
            if (node.closest('dialog'))
                return;
            node.disabled = writing || (reading && node.dataset.action !== 'refresh') || ((modelUnknown || runtimeUnknown) && ['choose-model', 'add-model'].includes(node.dataset.action || '')) || (node.hasAttribute('data-continue') && (modelUnknown || runtimeUnknown || !!catalogError)) || (node.dataset.modelAction === 'test' && (testing || modelUnknown || runtimeUnknown));
            if (node.dataset.action === 'refresh') {
                node.setAttribute('aria-disabled', String(writing || reading || polling));
                node.setAttribute('aria-busy', String(reading || polling));
            }
        });
        root.querySelectorAll('[data-continue],#credentials [type=submit]').forEach(node => { node.setAttribute('aria-busy', String(writing)); });
        options.dirty(dirty());
        const status = root.querySelector('#setup-status');
        if (status)
            status.innerHTML = writing ? (slow ? 'Still waiting for the server to confirm this save. Do not submit it again.' : 'Saving. Waiting for server confirmation…') : reading ? `${stage === 'preparation' && preparationPresentation().busy ? '' : pendingDots()} ${slow ? 'Still waiting for the current server state. Your saved configuration is unchanged.' : 'Reading current state…'}` : '';
        root.querySelectorAll('[data-continue]').forEach(node => { const markup = `Save and continue<span class="pending-slot">${writing ? pendingDots() : icon('arrow', 16)}</span>`; if (node.innerHTML !== markup)
            node.innerHTML = markup; });
        root.querySelectorAll('[data-action="refresh"]').forEach(node => node.setAttribute('aria-busy', String(reading)));
        const testButton = root.querySelector('[data-model-action="test"]');
        if (testButton)
            testButton.setAttribute('aria-busy', String(testing));
    }
    function acceptSnapshot(value, generation) {
        snapshot = value;
        confirmedReadGeneration = generation;
        if (modelReadError) {
            modelReadError = '';
            updateNotice();
        }
        if (autoEnter && (!value.administrator || value.runtime?.modelRef !== autoEnter.modelRef || value.runtime?.agentImage !== autoEnter.agentImage))
            autoEnter = null;
        preparationReadError = '';
        preparationReadAt = new Date().toLocaleTimeString('en-US');
    }
    function preparationReady() {
        return !preparationReadError && snapshot.status?.ready === true && snapshot.preparation?.ready === true &&
            preparationNames.every(name => snapshot.preparation.components?.[name]?.state === 'ready');
    }
    function preparationRecovery(value) {
        switch (value.code) {
            case 'DOCKER_UNAVAILABLE': return 'Docker Engine is unavailable. Check that Docker is running and this installation can access it.';
            case 'IMAGE_UNAVAILABLE': return 'The required image is unavailable. Check the server’s network and image registry access.';
            case 'IMAGE_INCOMPATIBLE': return 'A required image or Docker API is incompatible. Check Docker compatibility and repair the server release.';
            case 'CONTEXT_PREPARATION_FAILED': return 'Work defaults could not be prepared. Check Docker and available storage on the server.';
            case 'SHUTTING_DOWN': return 'The server is shutting down. Restart Piwork, then read current state.';
            case 'RUNTIME_UNCONFIGURED': return 'Runtime is not configured. Open Admin to check the saved model and Runtime.';
            default: return 'Check this dependency in Admin or Runtime diagnostics.';
        }
    }
    function retryWait(value) {
        const seconds = value.retryAfterSeconds;
        return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0
            ? seconds === 0 ? 'Retrying shortly.' : `Retrying in ${Math.ceil(seconds)} ${Math.ceil(seconds) === 1 ? 'second' : 'seconds'}.`
            : 'Preparation will retry automatically.';
    }
    function preparationDetail(name, value) {
        const components = snapshot.preparation?.components || {};
        if (value.state === 'ready')
            return '';
        if (value.state === 'preparing')
            return name === 'docker' ? 'Checking the Docker Engine connection.' : `Preparing ${preparationLabels[name]} resources.`;
        if (value.state === 'retrying')
            return preparationRecovery(value) + ' ' + retryWait(value);
        if (value.state === 'failed' || value.state === 'unconfigured')
            return preparationRecovery(value);
        if (value.state === 'pending') {
            if (name !== 'docker' && components.docker?.state !== 'ready')
                return 'Waiting for Docker Engine.';
            if (name === 'defaultContext') {
                const dependencies = ['agent', 'packageHelper'].filter(key => components[key]?.state !== 'ready').map(key => preparationLabels[key]);
                if (dependencies.length)
                    return 'Waiting for ' + dependencies.join(' and ') + '.';
            }
            return 'Waiting for preparation to start.';
        }
        return 'Preparation status has not been confirmed. Read current state to check again.';
    }
    function preparationPresentation() {
        const components = snapshot.preparation?.components || {};
        const entries = preparationNames.map(name => ({ name, value: components[name] || {} }));
        if (preparationReadError)
            return { title: 'Preparation updates interrupted', summary: 'Current preparation status is unavailable', description: `Showing the last confirmed state${preparationReadAt ? ' from ' + preparationReadAt : ''}. ${preparationReadError} Automatic updates will retry, or choose Read current state.`, tone: 'warning', symbol: 'warning', busy: false };
        if (preparationReady())
            return { title: 'Piwork is ready', summary: 'All required components are ready', description: 'Open the workbench to start using Piwork.', tone: 'success', symbol: 'check', busy: false };
        const failed = entries.find(({ value }) => value.state === 'failed' || value.state === 'unconfigured');
        if (failed)
            return { title: 'Preparation needs attention', summary: `${preparationLabels[failed.name]} could not be prepared`, description: preparationRecovery(failed.value) + ' Resolve the issue, then read current state.', tone: 'warning', symbol: 'warning', busy: false };
        const retrying = entries.find(({ value }) => value.state === 'retrying');
        if (retrying)
            return { title: 'Preparing Piwork…', summary: `Waiting to retry ${preparationLabels[retrying.name]}`, description: preparationRecovery(retrying.value) + ' ' + retryWait(retrying.value) + ' This page updates automatically.', tone: 'warning', symbol: 'clock', busy: true };
        const active = entries.filter(({ value }) => value.state === 'preparing');
        if (active.length)
            return { title: 'Preparing Piwork…', summary: 'Preparing ' + active.map(({ name }) => preparationLabels[name]).join(' and ') + '…', description: 'Please wait while Piwork prepares the required components. This page updates automatically. First-time preparation may need to download resources.', tone: 'info', symbol: 'clock', busy: true };
        const waiting = entries.filter(({ value }) => value.state !== 'ready');
        return { title: 'Preparation status needs confirmation', summary: !snapshot.preparation ? 'Waiting for preparation status' : waiting.length ? 'Not yet confirmed: ' + waiting.map(({ name }) => preparationLabels[name]).join(', ') : 'Core readiness has not been confirmed', description: 'No active preparation has been confirmed. Read current state, or check Runtime diagnostics and the required components below.', tone: 'warning', symbol: 'warning', busy: false };
    }
    function maybeAutoEnter() {
        const intent = autoEnter;
        if (!intent || reading || writing || polling || stage !== 'preparation' || !current(intent) || intent.revision !== revision || intent.leaveGeneration !== leaveGeneration)
            return;
        if (confirmedReadGeneration < intent.minimumReadGeneration || catalogError || !preparationReady())
            return;
        if (snapshot.runtime?.modelRef !== intent.modelRef || snapshot.runtime?.agentImage !== intent.agentImage) {
            autoEnter = null;
            return;
        }
        autoEnter = null;
        options.navigate('/');
    }
    function preparationReadFailed(error) {
        autoEnter = null;
        if (stage === 'preparation') {
            preparationReadError = message(error);
            updatePreparation();
        }
        else {
            modelReadError = 'State could not be refreshed: ' + message(error);
            updateNotice();
        }
    }
    function updatePreparation() {
        const docker = root.querySelector('#setup-docker');
        if (docker) {
            const value = snapshot.preparation?.components?.docker;
            docker.innerHTML = `${icon('server', 16)}<span>Docker Engine</span>${StatusLabel(value?.state === 'unconfigured' ? 'Not checked' : value?.state || 'Checking', value?.state === 'ready' ? 'success' : 'neutral')}<span class="help">${value?.state === 'ready' ? 'Available for preparation.' : value?.state === 'unconfigured' ? 'Checked after Runtime is saved.' : 'You can save your model while Docker is unavailable.'}</span>`;
        }
        const answer = root.querySelector('#preparation-answer'), components = root.querySelector('#preparation-components'), exit = root.querySelector('#workbench-exit');
        if (!answer)
            return;
        const ready = preparationReady(), presentation = preparationPresentation();
        if (presentation.busy && !preparationSince) {
            preparationSince = Date.now();
            preparationTimer = setTimeout(() => { if (!disposed && options.current())
                updatePreparation(); }, 10000);
        }
        else if (!presentation.busy) {
            preparationSince = 0;
            clearTimeout(preparationTimer);
        }
        const slow = preparationSince && Date.now() - preparationSince >= 10000 ? ' Still waiting for the required components. You can read current state or leave this page while preparation continues.' : '';
        const markup = `<div class="feedback ${presentation.tone}" role="status">${presentation.busy ? pendingDots() : icon(presentation.symbol, 17)}<div><strong>${esc(presentation.summary)}</strong><p>${esc(presentation.description + slow)}</p></div></div>`;
        if (answer.innerHTML !== markup)
            answer.innerHTML = markup;
        root.querySelector('#setup-title').textContent = presentation.title;
        const step = root.querySelector('[data-preparation-step]');
        step.classList.toggle('complete', ready);
        step.classList.toggle('current', !ready);
        step.querySelector('.step-label').textContent = ready ? 'Ready for Work' : presentation.busy ? 'Preparing Piwork…' : 'Prepare Piwork';
        step.querySelector('.step-marker').innerHTML = ready ? icon('check', 13) : '2';
        const states = { ready: 'Ready', preparing: 'Preparing', pending: 'Waiting', retrying: 'Retrying', failed: 'Failed', unconfigured: 'Not configured' };
        if (components)
            for (const name of preparationNames) {
                const value = snapshot.preparation?.components?.[name] || {};
                let item = components.querySelector(`[data-component="${name}"]`);
                if (!item) {
                    item = document.createElement('li');
                    item.dataset.component = name;
                    item.tabIndex = -1;
                    components.append(item);
                }
                const markup = `<span>${esc(preparationLabels[name])}</span>${StatusLabel(states[value.state] || 'Not confirmed', value.state === 'ready' ? 'success' : value.state === 'failed' || value.state === 'retrying' ? 'warning' : 'neutral')}<p>${esc(preparationDetail(name, value))}${value.code ? ` <code>${esc(value.code)}</code>` : ''}</p>`;
                if (item.innerHTML !== markup)
                    item.innerHTML = markup;
            }
        const failures = root.querySelector('#preparation-failures');
        if (failures) {
            const markup = preparationNames.filter(name => ['failed', 'unconfigured'].includes(snapshot.preparation?.components?.[name]?.state)).map(name => {
                const value = snapshot.preparation.components[name];
                return `<div class="feedback warning"><div><strong>${esc(preparationLabels[name])} needs attention</strong><p>${esc(preparationRecovery(value))}</p><button class="btn secondary small" type="button" data-action="show-component" data-component-target="${name}">View ${esc(preparationLabels[name])} details</button></div></div>`;
            }).join('');
            if (failures.innerHTML !== markup)
                failures.innerHTML = markup;
        }
        if (exit) {
            exit.classList.toggle('primary', ready);
            exit.classList.toggle('secondary', !ready);
            exit.setAttribute('aria-disabled', String(!ready));
            if (ready)
                exit.setAttribute('href', '/');
            else
                exit.removeAttribute('href');
        }
        root.querySelector('#preparation-exit-help').textContent = ready ? 'Setup is complete. You can now enter Piwork.' : preparationReadError ? 'Read current state to confirm that all required components are ready.' : 'Open workbench becomes available when all required components are ready.';
    }
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
            error.textContent = text;
            error.hidden = !text;
        }
    }
    function focusModelField(id) {
        const input = root.querySelector('#' + id), advanced = input?.closest('#model-advanced');
        if (advanced) {
            advanced.open = true;
            advancedOpen = true;
        }
        input?.focus();
    }
    function validateModel() {
        capture();
        const form = root.querySelector('#model-form');
        if (!form)
            return false;
        form.querySelectorAll('[data-model-max-length]').forEach(validateModelControl);
        for (const input of form.querySelectorAll('input')) {
            fieldError(input.id, input.validationMessage);
            if (!input.validity.valid) {
                focusModelField(input.id);
                return false;
            }
        }
        const issue = modelDraftIssue(draft);
        if (issue) {
            fieldError(modelField(issue.field), issue.message);
            focusModelField(modelField(issue.field));
            return false;
        }
        return true;
    }
    function sessionFailure(error) {
        if (error instanceof RequestError && error.status === 401) {
            options.expired();
            dispose();
            return true;
        }
        return false;
    }
    function resolveUnknown() {
        if (modelUnknown && pendingModel) {
            // Full submitted public identity plus the pre-write catalog, never a name-only guess.
            const matches = models.filter(model => !beforeModels.has(model.id) && model.model === pendingModel.model && model.api === pendingModel.api && model.baseUrl === pendingModel.baseUrl && model.name === (pendingModel.name || pendingModel.model) && model.enabled && model.credentialAvailable);
            if (matches.length === 1) {
                selectedRef = confirmedModel = matches[0].modelRef;
                pendingModel = null;
                modelUnknown = false;
                mode = 'choose';
                draft = blankModel();
                tell('Model save confirmed by reading current data. Continue to bind Runtime.');
            }
            else if (matches.length > 1) {
                modelUnknown = false;
                pendingModel = null;
                mode = 'choose';
                selectedRef = '';
                tell('More than one saved model matches. Choose the intended entry before continuing.', true);
            }
        }
        if (runtimeUnknown && pendingRuntime && snapshot.runtime?.configured && snapshot.runtime.modelRef === pendingRuntime.modelRef && snapshot.runtime.agentImage === pendingRuntime.agentImage) {
            runtimeUnknown = false;
            pendingRuntime = null;
            tell('Runtime save confirmed by reading current data.');
        }
    }
    async function readCurrent(preserve = true) {
        if (disposed || !options.current() || reading || writing || polling)
            return;
        reading = true;
        const lock = Symbol();
        readLock = lock;
        clearTimeout(timer);
        const generation = ++readGeneration, ticket = context();
        updateLocks();
        try {
            const currentState = await web('onboarding');
            if (!current(ticket) || generation !== readGeneration)
                return;
            acceptSnapshot(currentState, generation);
            if (!snapshot.administrator) {
                options.expired();
                dispose();
                return;
            }
            try {
                const result = await admin('models');
                if (!current(ticket) || generation !== readGeneration)
                    return;
                if (!Array.isArray(result.models))
                    throw new Error('The model catalog response is incomplete.');
                models = result.models;
                catalogError = '';
            }
            catch (error) {
                if (!current(ticket) || generation !== readGeneration || sessionFailure(error))
                    return;
                catalogError = message(error);
                autoEnter = null;
            }
            const modelWasUnknown = modelUnknown, runtimeWasUnknown = runtimeUnknown;
            resolveUnknown();
            const recovered = modelWasUnknown !== modelUnknown || runtimeWasUnknown !== runtimeUnknown;
            let initializedBaseline = false;
            if (!baselineReady && !catalogError) {
                initializedBaseline = true;
                baselineRef = snapshot.runtime?.modelRef || '';
                selectedRef = selectedRef || baselineRef;
                if (!snapshot.runtime?.configured && models.length === 0 && revision === 0) {
                    draft = firstModel();
                    advancedOpen = false;
                }
                else
                    advancedOpen = mode === 'add';
                baselineDraft = revision === 0 ? { ...draft, key: '' } : blankModel();
                baselineReady = true;
            }
            const canPrepare = snapshot.runtime?.configured && snapshot.runtime.modelRef && snapshot.runtime.model?.credentialAvailable && (!!catalogError || models.some(model => model.modelRef === snapshot.runtime.modelRef && model.enabled && model.credentialAvailable));
            if (!preserve || stage !== 'model' || recovered || (initializedBaseline && revision === 0)) {
                if (canPrepare && !runtimeUnknown && !modelUnknown && !modelWasUnknown && (stage === 'preparation' || options.preparation || runtimeWasUnknown)) {
                    changeStage('preparation');
                }
                else {
                    changeStage('model');
                    mode = confirmedModel || models.length ? 'choose' : 'add';
                }
                if (stage === 'preparation' && root.querySelector('#preparation-answer'))
                    updatePreparation();
                else
                    render();
            }
            else {
                // Status reads never replace the active model form, focus, selection or Key.
                updatePreparation();
                const release = root.querySelector('#release-note');
                if (release)
                    release.innerHTML = snapshot.releaseError ? Feedback('The server release is incomplete. Models remain available; repair the release before binding Runtime.', 'warning') : '';
                const select = root.querySelector('#saved-model');
                if (select)
                    select.innerHTML = modelOptions();
                const note = root.querySelector('#catalog-note');
                if (note)
                    note.innerHTML = catalogError ? Feedback('Saved models could not be loaded. ' + catalogError + ' Automatic updates will retry.', 'warning') : '';
            }
        }
        catch (error) {
            if (current(ticket) && generation === readGeneration && !sessionFailure(error)) {
                preparationReadFailed(error);
                if (stage === 'loading') {
                    changeStage('error');
                    render();
                }
            }
        }
        finally {
            if (readLock === lock) {
                readLock = null;
                reading = false;
                updateLocks();
            }
            if (!reading && !writing) {
                maybeAutoEnter();
                scheduleStatus();
            }
        }
    }
    function scheduleStatus() {
        clearTimeout(timer);
        if (disposed || !options.current() || (stage !== 'model' && stage !== 'preparation'))
            return;
        const ticket = context(), generation = readGeneration;
        timer = setTimeout(async () => {
            if (!current(ticket) || generation !== readGeneration || writing || reading)
                return;
            if (stage === 'model' && (modelUnknown || runtimeUnknown || catalogError)) {
                await readCurrent(true);
                return;
            }
            polling = true;
            updateLocks();
            try {
                const value = await web('onboarding');
                if (!current(ticket) || generation !== readGeneration)
                    return;
                if (!value.administrator) {
                    options.expired();
                    dispose();
                    return;
                }
                acceptSnapshot(value, generation);
                updatePreparation();
            }
            catch (error) {
                if (current(ticket) && generation === readGeneration && !sessionFailure(error))
                    preparationReadFailed(error);
            }
            finally {
                if (current(ticket) && generation === readGeneration) {
                    polling = false;
                    updateLocks();
                    maybeAutoEnter();
                    scheduleStatus();
                }
            }
        }, 5000);
    }
    async function continueSetup(allowAutoEnter = true) {
        if (writing || reading || modelUnknown || runtimeUnknown || catalogError)
            return false;
        if (mode === 'add' && !validateModel())
            return false;
        if (mode === 'choose' && !models.some(model => model.modelRef === selectedRef && model.enabled && model.credentialAvailable)) {
            fieldError('saved-model', 'Choose an available model.');
            root.querySelector('#saved-model')?.focus();
            return false;
        }
        if (mode === 'choose' && snapshot.runtime?.configured && snapshot.runtime.modelRef === selectedRef && snapshot.runtime.agentImage === snapshot.defaultAgentImage) {
            confirmedModel = '';
            changeStage('preparation');
            tell('The saved Runtime already uses this model and server release.');
            render();
            scheduleStatus();
            return true;
        }
        capture();
        const candidate = allowAutoEnter && snapshot.administrator && snapshot.runtime?.configured === false ? { revision, leaveGeneration } : null;
        autoEnter = null;
        const submitted = { ...draft }, ticket = context();
        writing = true;
        clearTimeout(timer);
        readGeneration++;
        polling = false;
        updateLocks();
        tell('');
        // A new explicit chain owns its phase; only an unknown binding keeps a readback target.
        let binding = false;
        pendingRuntime = null;
        try {
            if (mode === 'add') {
                beforeModels = new Set(models.map(model => model.id));
                pendingModel = { name: submitted.name.trim(), model: submitted.model.trim(), api: submitted.api, baseUrl: submitted.baseUrl.trim() };
                const value = await admin('models', 'POST', { ...pendingModel, credential: submitted.key });
                if (!current(ticket))
                    return false;
                if (typeof value.modelRef !== 'string')
                    throw new RequestError('Model save is not confirmed. Read current state.', 0, true);
                selectedRef = confirmedModel = value.modelRef;
                pendingModel = null;
                models.push(value);
                draft = blankModel();
                const key = root.querySelector('#model-key');
                if (key && key.value === submitted.key)
                    key.value = '';
                tell('Model saved. Binding Core runtime…');
            }
            pendingRuntime = { modelRef: selectedRef, agentImage: snapshot.defaultAgentImage || '' };
            binding = true;
            const value = await admin('runtime', 'PUT', { modelRef: pendingRuntime.modelRef });
            if (!current(ticket))
                return false;
            if (!value.runtime?.configured || value.runtime.modelRef !== pendingRuntime.modelRef)
                throw new RequestError('Runtime save is not confirmed. Read current state.', 0, true);
            const confirmedTarget = pendingRuntime;
            snapshot = { ...snapshot, runtime: value.runtime, status: value.status, preparation: undefined };
            pendingRuntime = null;
            confirmedModel = '';
            draft = blankModel();
            revision++;
            testResult = null;
            const canAutoEnter = candidate && candidate.revision === revision - 1 && candidate.leaveGeneration === leaveGeneration && value.runtime.agentImage === confirmedTarget.agentImage && !!confirmedTarget.agentImage;
            writing = false;
            changeStage('preparation');
            if (canAutoEnter)
                autoEnter = { ...context(), revision, leaveGeneration, minimumReadGeneration: readGeneration + 1, ...confirmedTarget };
            tell('');
            render();
            await readCurrent(true);
            return true;
        }
        catch (error) {
            if (!current(ticket) || sessionFailure(error))
                return false;
            autoEnter = null;
            const unknown = error instanceof RequestError && error.unknown;
            if (binding) {
                runtimeUnknown = unknown;
                if (!unknown)
                    pendingRuntime = null;
                mode = 'choose';
                tell('Model saved. ' + (unknown ? unknownNotice() : 'Runtime was not bound. ' + message(error) + ' Continue to retry only the binding.'), true);
            }
            else {
                modelUnknown = unknown;
                tell(unknown ? unknownNotice() : message(error), true);
                if (error instanceof RequestError && error.field) {
                    fieldError(modelField(error.field), message(error));
                    focusModelField(modelField(error.field));
                }
            }
            if (confirmedModel || unknown) {
                draft.key = '';
                mode = confirmedModel ? 'choose' : mode;
                render();
            }
            else {
                const key = root.querySelector('#model-key');
                if (key && key.value === submitted.key)
                    key.value = '';
                draft.key = '';
            }
            return false;
        }
        finally {
            submitted.key = '';
            if (current(ticket)) {
                writing = false;
                updateLocks();
                scheduleStatus();
            }
        }
    }
    function updateTest() { const result = root.querySelector('#model-test-result'); if (result)
        result.innerHTML = modelTestSummary(testResult, revision); const body = root.querySelector('#test-body'); if (body)
        body.innerHTML = modelTestDetails(testResult, revision); }
    function openTest() { if (!testResult)
        return; updateTest(); root.querySelector('#test-dialog')?.showModal(); }
    async function testModel() {
        if (testing || writing || reading || modelUnknown || runtimeUnknown || !validateModel())
            return;
        const submitted = { ...draft }, ticket = context(), record = { target: { provider: draft.name || draft.model, api: draft.api, model: draft.model.trim() }, revision, pending: true, startedAt: Date.now() };
        testResult = record;
        testing = true;
        updateLocks();
        openTest();
        try {
            const value = await admin('model-tests', 'POST', { model: submitted.model.trim(), api: submitted.api, baseUrl: submitted.baseUrl.trim(), credential: submitted.key });
            if (!validModelTest(value))
                throw new Error('The Test response is incomplete.');
            if (current(ticket) && testResult === record)
                record.value = value;
        }
        catch (error) {
            if (!current(ticket) || sessionFailure(error))
                return;
            record.error = message(error);
            if (error instanceof RequestError) {
                record.errorField = error.field;
                record.notStarted = ['INVALID_REQUEST', 'NOT_FOUND', 'MODEL_UNAVAILABLE', 'MODEL_TEST_BUSY', 'UNSUPPORTED_MEDIA_TYPE'].includes(error.code);
                if (error.field)
                    fieldError(modelField(error.field), message(error));
            }
        }
        finally {
            submitted.key = '';
            if (current(ticket) && testResult === record) {
                record.pending = false;
                testing = false;
                updateTest();
                updateLocks();
            }
        }
    }
    async function action(action) {
        if (disposed || !options.current())
            return;
        if (action === 'close-test') {
            root.querySelector('#test-dialog')?.close();
            return;
        }
        if (action === 'keep-editing') {
            root.querySelector('#leave-dialog')?.close();
            leaveAction = null;
            leaveGeneration++;
            return;
        }
        if (action === 'discard-draft') {
            clearSecrets();
            draft = blankModel();
            root.querySelector('#leave-dialog')?.close();
            const leave = leaveAction;
            leaveAction = null;
            leaveGeneration++;
            leave?.();
            return;
        }
        if (action === 'save-leave') {
            root.querySelector('#leave-dialog')?.close();
            const leave = leaveAction, generation = leaveGeneration;
            leaveAction = null;
            // Entering preparation changes the form view. Only this still-mounted leave
            // intent may navigate after its read; a newer route or identity owns itself.
            if (await continueSetup(false) && !disposed && options.current() && generation === leaveGeneration) {
                leaveGeneration++;
                leave?.();
            }
            return;
        }
        if (writing || reading)
            return;
        if (action === 'refresh') {
            if (polling)
                return;
            tell('');
            await readCurrent(stage !== 'error');
            return;
        }
        if (action === 'add-model' || action === 'choose-model') {
            autoEnter = null;
            capture();
            if (action === 'choose-model' && dirty() && !confirm('Discard this model draft and choose a saved model?'))
                return;
            view++;
            readGeneration++;
            testResult = null;
            testing = false;
            draft = blankModel();
            baselineDraft = { ...draft };
            advancedOpen = true;
            confirmedModel = '';
            mode = action === 'add-model' ? 'add' : 'choose';
            render();
            scheduleStatus();
            return;
        }
    }
    const submit = (event) => { event.preventDefault(); event.stopPropagation(); void continueSetup(); };
    const input = (event) => {
        event.stopPropagation();
        autoEnter = null;
        const input = event.target;
        if (input.closest('#model-form')) {
            capture();
            revision++;
            validateModelControl(input);
            fieldError(input.id, '');
            if (input.id === 'model-api') {
                const url = root.querySelector('#model-base-url');
                if (url)
                    url.placeholder = modelPlaceholder(draft.api);
                const help = root.querySelector('#model-base-url-help');
                if (help)
                    help.textContent = modelProtocolHelp(draft.api);
            }
            updateTest();
        }
        if (input.id === 'saved-model') {
            selectedRef = input.value;
            confirmedModel = '';
            fieldError('saved-model', '');
        }
        options.dirty(dirty());
    };
    const click = (event) => {
        if (event.target.closest('#workbench-exit') && !preparationReady()) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        const element = event.target.closest('[data-action],[data-model-action]');
        if (element?.dataset.action === 'show-component') {
            event.preventDefault();
            event.stopPropagation();
            root.querySelector('#preparation-details').open = true;
            root.querySelector(`[data-component="${element.dataset.componentTarget}"]`)?.focus();
            return;
        }
        if (element) {
            event.preventDefault();
            event.stopPropagation();
            const command = element.dataset.modelAction;
            if (command === 'test')
                void testModel();
            else if (command === 'view-test')
                openTest();
            else if (command === 'edit-test') {
                root.querySelector('#test-dialog')?.close();
                focusModelField(modelField(testResult?.errorField || 'model'));
            }
            else
                void action(element.dataset.action);
            return;
        }
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
            return;
        const link = event.target.closest('a[href]');
        if (link) {
            event.preventDefault();
            event.stopPropagation();
            options.navigate(link.href);
        }
    };
    function dispose() { if (disposed)
        return; autoEnter = null; disposed = true; leaveGeneration++; leaveAction = null; view++; identity++; readGeneration++; readLock = null; reading = false; polling = false; clearTimeout(timer); clearTimeout(slowTimer); clearTimeout(preparationTimer); clearSecrets(); root.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); root.removeEventListener('submit', submit); root.removeEventListener('input', input); root.removeEventListener('click', click); }
    root.addEventListener('submit', submit);
    root.addEventListener('input', input);
    root.addEventListener('click', click);
    render();
    void readCurrent(false);
    return { dispose, requestLeave(leave) { if (disposed || !options.current())
            return; autoEnter = null; leaveGeneration++; leaveAction = null; if (!dirty()) {
            leave();
            return;
        } leaveAction = leave; root.querySelector('#leave-dialog')?.showModal(); } };
}
//# sourceMappingURL=quick-setup.js.map