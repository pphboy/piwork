import { adapter, ConsoleError } from './adapter.js';
import { esc, Field, Input, PageHeader, Section, Feedback, NavLink, StatusLabel, date } from './components.js';
const blank = () => ({ name: '', model: '', api: 'openai-responses', baseUrl: '', key: '' });
const part = encodeURIComponent;
const message = (e) => e instanceof Error ? e.message : 'The request failed. Read current data and try again.';
const testMessage = 'Reply with OK.';
export class ModelManagement {
    render;
    dirty;
    sessionError;
    showTestDialog;
    models = [];
    path = '/models';
    draft = blank();
    revision = 0;
    view = 0;
    loading = 0;
    saving = false;
    testing = false;
    uncertain = false;
    note = '';
    noteError = false;
    fieldError = null;
    testResult = null;
    testDialog = null;
    constructor(render, dirty, sessionError = () => false, showTestDialog) {
        this.render = render;
        this.dirty = dirty;
        this.sessionError = sessionError;
        this.showTestDialog = showTestDialog;
        document.addEventListener('input', e => { const el = e.target; if (!el.closest('[data-model-form]'))
            return; this.capture(); this.validateLength(el); this.revision++; this.dirty(true); if (el.id === 'model-api') {
            const input = document.querySelector('#model-base-url');
            if (input)
                input.placeholder = this.draft.api === 'anthropic-messages' ? 'https://gateway.example' : 'https://gateway.example/v1';
        } if (this.fieldError && this.fieldInput(this.fieldError.field) === el) {
            if (this.noteError && this.note === this.fieldError.message) {
                this.note = '';
                this.noteError = false;
                document.querySelector('#model-note')?.replaceChildren();
            }
            this.fieldError = null;
            el.removeAttribute('aria-invalid');
            el.removeAttribute('aria-errormessage');
            document.querySelector('#model-field-error')?.remove();
        } this.markTestStale(); });
        document.addEventListener('submit', e => { if (!e.target.dataset.modelForm)
            return; e.preventDefault(); void this.save(); });
        document.addEventListener('click', e => { const el = e.target.closest('[data-model-action]'); if (!el)
            return; e.preventDefault(); void this.action(el.dataset.modelAction, el.dataset.id); });
    }
    reset() { this.testDialog?.close(); this.testDialog = null; this.models = []; this.draft = blank(); this.testResult = null; this.fieldError = null; this.note = ''; this.saving = false; this.testing = false; this.uncertain = false; this.revision++; this.loading++; this.view++; }
    model() { return this.models.find(m => this.path === '/models/' + part(m.id)); }
    sameView(path, epoch, view) { return path === this.path && epoch === adapter.identityEpoch && view === this.view; }
    async load(path, preserveDraft = false) {
        const ticket = ++this.loading, epoch = adapter.identityEpoch, changed = !preserveDraft || path !== this.path;
        this.path = path;
        if (changed) {
            this.testDialog?.close();
            this.testDialog = null;
            this.view++;
            this.saving = false;
            this.testing = false;
            this.draft = blank();
            this.testResult = null;
            this.fieldError = null;
            this.note = '';
            this.uncertain = false;
        }
        this.revision++;
        this.markTestStale();
        const value = await adapter.modelRequest('models');
        if (ticket !== this.loading || epoch !== adapter.identityEpoch)
            return;
        if (!Array.isArray(value.models))
            throw new ConsoleError('INVALID_RESPONSE', 'Model management data is incomplete.');
        this.models = value.models;
        const m = this.model();
        if (changed)
            this.draft = m ? { name: m.name, model: m.model, api: m.api, baseUrl: m.baseUrl, key: '' } : blank();
    }
    capture() { const form = document.querySelector('[data-model-form]'); if (!form)
        return; const data = new FormData(form); this.draft = { name: String(data.get('model-name') ?? ''), model: String(data.get('model-id') ?? ''), api: String(data.get('model-api') ?? 'openai-responses'), baseUrl: String(data.get('model-base-url') ?? ''), key: String(data.get('model-key') ?? '') }; }
    validateLength(el) { if (el instanceof HTMLInputElement && el.dataset.modelMaxLength) {
        const max = Number(el.dataset.modelMaxLength);
        el.setCustomValidity([...el.value].length > max ? `Use at most ${max} characters.` : '');
    } }
    afterRender() { document.querySelectorAll('[data-model-max-length]').forEach(el => this.validateLength(el)); const key = document.querySelector('#model-key'); if (key)
        key.value = this.draft.key; if (this.fieldError) {
        const input = this.fieldInput(this.fieldError.field);
        if (input) {
            input.setAttribute('aria-invalid', 'true');
            input.setAttribute('aria-errormessage', 'model-field-error');
            document.querySelector('#model-field-error')?.remove();
            input.insertAdjacentHTML('afterend', `<p id="model-field-error" role="alert" class="help">${esc(this.fieldError.message)}</p>`);
        }
    } }
    fieldInput(field) { const ids = { name: 'model-name', model: 'model-id', api: 'model-api', baseUrl: 'model-base-url', credential: 'model-key' }; return document.getElementById(ids[field.split('.')[0]] || ''); }
    inputFailure(field, text) { this.fieldError = { field, message: text }; this.note = text; this.noteError = true; this.render(); this.fieldInput(field)?.focus(); }
    markTestStale() { const el = document.querySelector('#model-test-result'); if (el)
        el.innerHTML = this.testMarkup(); this.testDialog?.update(this.testModalMarkup()); }
    testMarkup() {
        if (!this.testResult)
            return '';
        const { value, revision, pending, error } = this.testResult, stale = revision !== this.revision;
        const summary = pending ? 'Sending the test message…' : error || (value ? `${value.success ? 'HTTP Test passed.' : 'HTTP Test failed: ' + value.category + '. ' + value.message} Checked ${date(value.checkedAt)} · ${value.durationMs} ms${value.httpStatus ? ' · HTTP ' + value.httpStatus : ''}` : 'The Test result is unavailable.');
        return Feedback(`${stale ? 'Previous configuration: ' : ''}${summary}${stale ? ' · Configuration changed or was read again; test again.' : ''}`, value?.success && !stale ? 'success' : pending ? 'info' : 'warning', '<button type="button" class="btn secondary" data-model-action="view-test">View test result</button>');
    }
    testModalMarkup() {
        const result = this.testResult;
        if (!result)
            return '';
        const { target, value, pending, revision, error } = result;
        const stage = pending ? 'Checking configuration and requesting a reply' : error ? (result.notStarted ? 'Test not started. No model request was sent.' : 'The Test result could not be confirmed.') : value?.success ? 'Model reply received.' : 'Model request failed.';
        const outcome = pending ? Feedback('Sending the test message…', 'info') : error ? Feedback(error, 'warning') : value?.success ? `<h3>Model reply</h3><pre data-model-test-reply>${esc(value.replyText)}</pre>${value.replyTruncated ? Feedback('Reply truncated to the display limit.', 'warning') : ''}` : value ? `${Feedback(value.message, 'warning')}<p data-model-test-recovery>${esc(value.recovery)}</p>` : '';
        const recovery = error ? '<button type="button" class="btn secondary" data-model-action="edit-test">Back to configuration</button>' : '';
        return `<div data-model-test-dialog><dl class="summary-list"><dt>Model</dt><dd>${esc(target.provider)}</dd><dt>API type</dt><dd>${esc(target.api === 'openai-responses' ? 'OpenAI Responses' : 'Anthropic Messages')}</dd><dt>Model ID</dt><dd><code>${esc(target.model)}</code></dd></dl><h3>Test message</h3><pre>${esc(value?.testMessage || testMessage)}</pre><div aria-live="polite"><p data-model-test-stage>${esc(stage)}</p>${outcome}${recovery}${value ? `<p class="help">Checked ${date(value.checkedAt)} · ${value.durationMs} ms${value.httpStatus ? ' · HTTP ' + value.httpStatus : ''}</p>` : ''}${result.diagnosticId ? `<p class="help">Diagnostic ID: <code>${esc(result.diagnosticId)}</code></p>` : ''}${revision !== this.revision ? Feedback('Configuration changed or was read again. This result belongs to the previous configuration; test again.', 'warning') : ''}</div><p class="help">Test is advisory. Saving and enabling remain independent of Test results.</p></div>`;
    }
    openTestResult() { if (this.testResult && this.showTestDialog) {
        this.testDialog?.close();
        this.testDialog = this.showTestDialog(this.testModalMarkup());
    } }
    form(m) {
        const d = this.draft;
        return `<form data-model-form="model" class="form-grid">
 ${Field('model-id', 'Model ID', Input('model-id', d.model, 'required maxlength="512" data-model-max-length="256"'))}
 ${Field('model-api', 'API type', `<select id="model-api" name="model-api"><option value="openai-responses" ${d.api === 'openai-responses' ? 'selected' : ''}>OpenAI Responses</option><option value="anthropic-messages" ${d.api === 'anthropic-messages' ? 'selected' : ''}>Anthropic Messages</option></select>`)}
 ${Field('model-base-url', 'Base URL', Input('model-base-url', d.baseUrl, `required type="url" placeholder="${d.api === 'anthropic-messages' ? 'https://gateway.example' : 'https://gateway.example/v1'}"`), 'Responses appends /responses. Messages accepts a service root or /v1 and uses one /v1/messages path.')}
 ${Field('model-key', 'API Key', Input('model-key', '', `type="password" autocomplete="new-password" ${m ? '' : 'required'}`), m ? 'Write-only. Leave blank to keep the saved Key.' : 'Write-only. Used by this model only.')}
 ${Field('model-name', 'Display name (optional)', Input('model-name', d.name, 'maxlength="512" data-model-max-length="256"'), 'Defaults to the Model ID.')}
 <div class="form-actions"><button class="btn primary" type="submit" ${this.saving || this.uncertain ? 'disabled' : ''}>${this.saving ? 'Saving…' : m ? 'Save model' : 'Add model'}</button><button class="btn secondary" type="button" data-model-action="test" ${this.testing ? 'disabled' : ''}>Test</button></div><p class="help">Test sends a message and shows the reply. A passed Test is not required to save, enable or select a model.</p></form>`;
    }
    markup() {
        const m = this.model();
        let body = PageHeader('AI models', 'Add a model, test it, and choose it in Work Chat.', `<button class="btn secondary" data-model-action="read">Read current data</button>${NavLink('Configure runtime', '/runtime', 'btn secondary')}`, this.path !== '/models' ? NavLink('All models', '/models') : '');
        body += `<div id="model-note">${this.note ? Feedback(this.note, this.noteError ? 'warning' : 'success') : ''}</div>`;
        if (this.path === '/models')
            return body + Section('Models', 'Enabled models with a Key can be selected in Work Chat.', `<div class="section-body">${this.models.length ? this.models.map(m => `<div class="catalog-row"><div><a href="/models/${part(m.id)}" data-nav><strong>${esc(m.name)}</strong></a><p>${esc(m.api === 'openai-responses' ? 'OpenAI Responses' : 'Anthropic Messages')} · <code>${esc(m.model)}</code> · <small>${esc(m.id.slice(-8))}</small></p><p>${m.credentialAvailable ? 'Key available' : 'Key unavailable'}</p></div>${StatusLabel(m.enabled ? 'Enabled' : 'Disabled', m.enabled ? 'success' : 'neutral')}</div>`).join('') : '<p>No models configured. Add one below.</p>'}</div>`) + Section('Add model', 'Each model has its own connection and Key.', `<div class="section-body">${this.form()}<div id="model-test-result">${this.testMarkup()}</div></div>`);
        if (!m)
            return body + Feedback('This model is unavailable. Read the current list.', 'warning');
        return body + Section(m.name, m.api === 'openai-responses' ? 'OpenAI Responses' : 'Anthropic Messages', `<div class="section-body"><p>${StatusLabel(m.enabled ? 'Enabled' : 'Disabled', m.enabled ? 'success' : 'neutral')}</p>${this.form(m)}<div id="model-test-result">${this.testMarkup()}</div><div class="form-actions"><button class="btn secondary" data-model-action="${m.enabled ? 'disable' : 'enable'}" data-id="${esc(m.id)}" ${this.saving || this.uncertain ? 'disabled' : ''}>${m.enabled ? 'Disable' : 'Enable'} model</button><button class="btn danger" data-model-action="delete" data-id="${esc(m.id)}" ${this.saving || this.uncertain ? 'disabled' : ''}>Delete model</button><button class="btn secondary" data-model-action="default" data-id="${esc(m.id)}" ${!m.enabled || !m.credentialAvailable || this.saving || this.uncertain ? 'disabled' : ''}>Use for future Work</button></div><p class="help">Existing Work and Session choices stay unchanged.</p></div>`);
    }
    async save() {
        if (this.saving || this.uncertain)
            return;
        this.capture();
        const m = this.model(), path = this.path, epoch = adapter.identityEpoch, view = this.view, submitted = this.draft;
        let committed = false;
        this.saving = true;
        this.note = '';
        this.fieldError = null;
        this.render();
        try {
            const d = submitted;
            const value = await adapter.modelRequest(m ? 'models/' + part(m.id) : 'models', m ? 'PATCH' : 'POST', { name: d.name.trim(), model: d.model.trim(), api: d.api, baseUrl: d.baseUrl.trim(), ...(d.key ? { credential: d.key } : {}) });
            if (typeof value.id !== 'string')
                throw new ConsoleError('RESULT_UNKNOWN', 'Save result is unconfirmed. Read current data.');
            committed = true;
            if (!this.sameView(path, epoch, view))
                return;
            this.note = 'Model saved. Enabled models with a Key are available in Work Chat.';
            this.noteError = false;
            this.revision++;
            this.dirty(false);
            if (!m)
                this.draft = blank();
            await this.load(path, true);
        }
        catch (e) {
            if (this.sessionError(e))
                return;
            if (this.sameView(path, epoch, view)) {
                if (!committed && e instanceof ConsoleError && e.field)
                    this.fieldError = { field: e.field, message: e.message };
                this.note = committed ? 'Saved. Current data could not be refreshed; read current data before another change.' : message(e);
                this.noteError = true;
                this.uncertain = committed || e instanceof ConsoleError && e.code === 'RESULT_UNKNOWN';
            }
        }
        finally {
            submitted.key = '';
            if (this.sameView(path, epoch, view)) {
                this.saving = false;
                this.render();
            }
        }
    }
    async action(action, id) {
        if (action === 'edit-test') {
            this.testDialog?.close();
            this.fieldInput(this.testResult?.errorField || 'model')?.focus();
            return;
        }
        if (action === 'test') {
            await this.test();
            return;
        }
        if (action === 'view-test') {
            this.openTestResult();
            return;
        }
        if (action === 'read') {
            const path = this.path, epoch = adapter.identityEpoch, view = this.view;
            try {
                await this.load(path, true);
                if (!this.sameView(path, epoch, view))
                    return;
                this.uncertain = false;
                this.note = 'Current data loaded. Keys remain write-only.';
                this.noteError = false;
            }
            catch (e) {
                if (this.sessionError(e))
                    return;
                this.note = message(e);
                this.noteError = true;
            }
            this.render();
            return;
        }
        if (this.saving || this.uncertain)
            return;
        const m = this.models.find(m => m.id === id);
        if (!m)
            return;
        if (action !== 'default' && !confirm(`${action === 'delete' ? 'Delete' : action === 'disable' ? 'Disable' : 'Enable'} model ${m.name}? ${action === 'delete' ? 'Configuration dependencies must be removed first. History is kept.' : ''}`))
            return;
        const path = this.path, epoch = adapter.identityEpoch, view = this.view;
        let committed = false;
        this.saving = true;
        this.render();
        try {
            if (action === 'default')
                await adapter.modelRequest('default-work', 'PATCH', { modelRef: m.modelRef });
            else
                await adapter.modelRequest('models/' + part(m.id) + (action === 'delete' ? '' : '/' + action), action === 'delete' ? 'DELETE' : 'POST', action === 'delete' ? undefined : {});
            committed = true;
            if (!this.sameView(path, epoch, view))
                return;
            await this.load(path, true);
            this.note = action === 'default' ? 'Default model saved. Only future Work is affected.' : 'Model state saved.';
            this.noteError = false;
        }
        catch (e) {
            if (this.sessionError(e))
                return;
            if (this.sameView(path, epoch, view)) {
                this.note = committed ? 'State saved. Read current data before another change.' : message(e);
                this.noteError = true;
                this.uncertain = committed || e instanceof ConsoleError && e.code === 'RESULT_UNKNOWN';
            }
        }
        finally {
            if (this.sameView(path, epoch, view)) {
                this.saving = false;
                this.render();
            }
        }
    }
    async test() {
        if (this.testing)
            return;
        this.capture();
        const m = this.model(), path = this.path, epoch = adapter.identityEpoch, view = this.view, revision = this.revision, d = { ...this.draft };
        const model = d.model.trim(), baseUrl = d.baseUrl.trim();
        if (!model || !baseUrl || !m && !d.key.trim()) {
            const field = !model ? 'model' : !baseUrl ? 'baseUrl' : 'credential';
            this.inputFailure(field, 'Enter ' + (field === 'credential' ? 'an API Key' : field === 'baseUrl' ? 'a Base URL' : 'a Model ID') + ' before testing. No model request was sent.');
            return;
        }
        const input = { ...(m ? { modelId: m.id } : {}), api: d.api, baseUrl, model, ...(d.key ? { credential: d.key } : {}) };
        const record = { target: { provider: d.name || model, api: d.api, model }, revision, pending: true };
        this.note = '';
        this.noteError = false;
        this.fieldError = null;
        this.testResult = record;
        this.testing = true;
        this.openTestResult();
        this.render();
        try {
            const value = await adapter.modelRequest('model-tests', 'POST', input);
            if (typeof value.success !== 'boolean' || typeof value.category !== 'string' || value.testMessage !== testMessage || value.success && (typeof value.replyText !== 'string' || !value.replyText.trim() || typeof value.replyTruncated !== 'boolean') || !value.success && (typeof value.reason !== 'string' || typeof value.message !== 'string' || typeof value.recovery !== 'string'))
                throw new Error('The Test response is incomplete.');
            if (this.sameView(path, epoch, view) && this.testResult === record)
                record.value = value;
        }
        catch (e) {
            if (this.sessionError(e))
                return;
            if (this.sameView(path, epoch, view) && this.testResult === record) {
                record.error = message(e);
                if (e instanceof ConsoleError) {
                    record.errorField = e.field;
                    record.diagnosticId = e.correlationId;
                    record.notStarted = ['INVALID_REQUEST', 'NOT_FOUND', 'MODEL_UNAVAILABLE', 'MODEL_TEST_BUSY', 'UNSUPPORTED_MEDIA_TYPE'].includes(e.code);
                    if (e.field)
                        this.fieldError = { field: e.field, message: e.message };
                }
            }
        }
        finally {
            if (this.sameView(path, epoch, view) && this.testResult === record) {
                record.pending = false;
                this.testing = false;
                this.render();
                this.testDialog?.update(this.testModalMarkup());
            }
        }
    }
}
//# sourceMappingURL=model-management.js.map