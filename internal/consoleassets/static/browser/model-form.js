import { esc, Field, Input, Feedback, date } from './components.js';
import { pendingDots } from './pending.js';
export const blankModel = () => ({ name: '', model: '', api: 'openai-responses', baseUrl: '', key: '' });
export const testMessage = 'Reply with OK.';
export const modelField = (field) => ({ name: 'model-name', model: 'model-id', api: 'model-api', baseUrl: 'model-base-url', credential: 'model-key' }[field.split('.')[0]] || '');
export const modelPlaceholder = (api) => api === 'anthropic-messages' ? 'https://gateway.example' : 'https://gateway.example/v1';
export const modelProtocolHelp = (api) => api === 'anthropic-messages' ? 'Messages accepts a service root or /v1 and uses one /v1/messages path.' : 'Responses appends /responses to the Base URL.';
export function validateModelControl(el) {
    if (el instanceof HTMLInputElement && el.dataset.modelMaxLength) {
        const max = Number(el.dataset.modelMaxLength);
        el.setCustomValidity([...el.value].length > max ? `Use at most ${max} characters.` : '');
    }
}
export function readModelDraft(form) {
    const data = new FormData(form);
    return { name: String(data.get('model-name') ?? ''), model: String(data.get('model-id') ?? ''), api: String(data.get('model-api') ?? 'openai-responses'), baseUrl: String(data.get('model-base-url') ?? ''), key: String(data.get('model-key') ?? '') };
}
export function modelFields(d, editing = false, advanced) {
    const connection = `${Field('model-id', 'Model ID', Input('model-id', d.model, 'required maxlength="512" data-model-max-length="256"'))}
 ${Field('model-api', 'API type', `<select id="model-api" name="model-api"><option value="openai-responses" ${d.api === 'openai-responses' ? 'selected' : ''}>OpenAI Responses</option><option value="anthropic-messages" ${d.api === 'anthropic-messages' ? 'selected' : ''}>Anthropic Messages</option></select>`)}
 ${Field('model-base-url', 'Base URL', Input('model-base-url', d.baseUrl, `required type="url" placeholder="${modelPlaceholder(d.api)}"`), modelProtocolHelp(d.api))}`;
    const key = Field('model-key', 'API Key', Input('model-key', '', `type="password" autocomplete="new-password" ${editing ? '' : 'required'}`), editing ? 'Write-only. Leave blank to keep the saved Key.' : 'Write-only. Used by this model only.');
    const name = Field('model-name', 'Display name (optional)', Input('model-name', d.name, 'maxlength="512" data-model-max-length="256"'), 'Defaults to the Model ID.');
    return advanced ? `${key}<details class="disclosure" id="model-advanced" ${advanced.open ? 'open' : ''}><summary>Advanced settings</summary><div class="disclosure-body form-grid">${connection}${name}</div></details>` : `${connection}${key}${name}`;
}
export const modelErrors = {
    baseUrl: 'Base URL is invalid. Enter an HTTPS URL (or loopback HTTP), without credentials, query or fragment. Messages accepts a service root or a Base URL ending in /v1.',
    credential: 'API Key is invalid. Enter a nonempty Key on a single line. Leave the edit field blank only to keep a saved Key.',
    model: 'Model ID is invalid. Enter the exact model identifier, up to 256 characters.',
    name: 'Display name is invalid. Use at most 256 characters, or leave blank to use the Model ID.',
    api: 'API type is invalid. Choose OpenAI Responses or Anthropic Messages.',
};
export function modelDraftIssue(d, editing = false) {
    if (!['openai-responses', 'anthropic-messages'].includes(d.api))
        return { field: 'api', message: modelErrors.api };
    if (!d.model.trim() || [...d.model.trim()].length > 256)
        return { field: 'model', message: modelErrors.model };
    if ([...d.name.trim()].length > 256)
        return { field: 'name', message: modelErrors.name };
    if (!editing && !d.key.trim() || /[\r\n]/.test(d.key))
        return { field: 'credential', message: modelErrors.credential };
    try {
        const url = new URL(d.baseUrl.trim()), local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local) || url.username || url.password || url.search || url.hash)
            throw new Error();
    }
    catch {
        return { field: 'baseUrl', message: modelErrors.baseUrl };
    }
    return null;
}
export function validModelTest(value) {
    return typeof value.success === 'boolean' && typeof value.category === 'string' && value.testMessage === testMessage &&
        (value.success ? typeof value.replyText === 'string' && !!value.replyText.trim() && typeof value.replyTruncated === 'boolean' : typeof value.reason === 'string' && typeof value.message === 'string' && typeof value.recovery === 'string');
}
export function modelTestSummary(result, currentRevision) {
    if (!result)
        return '';
    const { value, revision, pending, error } = result, stale = revision !== currentRevision;
    const summary = pending ? (result.startedAt && Date.now() - result.startedAt >= 10000 ? 'Still waiting for the model reply. Closing this result does not send another Test.' : 'Sending the test message…') : error || (value ? `${value.success ? 'HTTP Test passed.' : 'HTTP Test failed: ' + value.category + '. ' + value.message} Checked ${date(value.checkedAt)} · ${value.durationMs} ms${value.httpStatus ? ' · HTTP ' + value.httpStatus : ''}` : 'The Test result is unavailable.');
    const text = `${stale ? 'Previous configuration: ' : ''}${summary}${stale ? ' · Configuration changed or was read again; test again.' : ''}`, actions = '<button type="button" class="btn secondary" data-model-action="view-test">View test result</button>';
    return pending ? `<div class="feedback info" role="status">${pendingDots()}<div>${esc(text)}<div class="feedback-actions">${actions}</div></div></div>` : Feedback(text, value?.success && !stale ? 'success' : 'warning', actions);
}
export function modelTestDetails(result, currentRevision) {
    if (!result)
        return '';
    const { target, value, pending, revision, error } = result;
    const stage = pending ? 'Checking configuration and requesting a reply' : error ? (result.notStarted ? 'Test not started. No model request was sent.' : 'The Test result could not be confirmed.') : value?.success ? 'Model reply received.' : 'Model request failed.';
    const outcome = pending ? `<div class="feedback info" role="status">${pendingDots()}<div>${result.startedAt && Date.now() - result.startedAt >= 10000 ? 'Still waiting for the model reply. Closing this result does not send another Test.' : 'Sending the test message…'}</div></div>` : error ? Feedback(error, 'warning') : value?.success ? `<h3>Model reply</h3><pre data-model-test-reply>${esc(value.replyText)}</pre>${value.replyTruncated ? Feedback('Reply truncated to the display limit.', 'warning') : ''}` : value ? `${Feedback(value.message, 'warning')}<p data-model-test-recovery>${esc(value.recovery)}</p>` : '';
    const recovery = error ? '<button type="button" class="btn secondary" data-model-action="edit-test">Back to configuration</button>' : '';
    return `<div data-model-test-dialog><dl class="summary-list"><dt>Model</dt><dd>${esc(target.provider)}</dd><dt>API type</dt><dd>${esc(target.api === 'openai-responses' ? 'OpenAI Responses' : 'Anthropic Messages')}</dd><dt>Model ID</dt><dd><code>${esc(target.model)}</code></dd></dl><h3>Test message</h3><pre>${esc(value?.testMessage || testMessage)}</pre><div aria-live="polite"><p data-model-test-stage>${esc(stage)}</p>${outcome}${recovery}${value ? `<p class="help">Checked ${date(value.checkedAt)} · ${value.durationMs} ms${value.httpStatus ? ' · HTTP ' + value.httpStatus : ''}</p>` : ''}${result.diagnosticId ? `<p class="help">Diagnostic ID: <code>${esc(result.diagnosticId)}</code></p>` : ''}${revision !== currentRevision ? Feedback('Configuration changed or was read again. This result belongs to the previous configuration; test again.', 'warning') : ''}</div><p class="help">Test is advisory. Saving and enabling remain independent of Test results.</p></div>`;
}
//# sourceMappingURL=model-form.js.map