import { esc, Field, Input, Feedback, date } from './components.js';
import { pendingDots } from './pending.js';
import { t, LocalizedMessage } from './locale.js';
export const blankModel = () => ({ name: '', model: '', api: 'openai-responses', baseUrl: '', key: '' });
// Sent verbatim to the model under test and validated by the server response.
export const testMessage = 'Reply with OK.';
export const modelField = (field) => ({ name: 'model-name', model: 'model-id', api: 'model-api', baseUrl: 'model-base-url', credential: 'model-key' }[field.split('.')[0]] || '');
export const modelPlaceholder = (api) => api === 'anthropic-messages' ? 'https://gateway.example' : 'https://gateway.example/v1';
export const modelProtocolHelp = (api) => api === 'anthropic-messages' ? t('modelForm.protocol.messages') : t('modelForm.protocol.responses');
export function validateModelControl(el) {
    if (el instanceof HTMLInputElement && el.dataset.modelMaxLength) {
        const max = Number(el.dataset.modelMaxLength);
        el.setCustomValidity([...el.value].length > max ? t('modelForm.maxLength', { max }) : '');
    }
}
export function readModelDraft(form) {
    const data = new FormData(form);
    return { name: String(data.get('model-name') ?? ''), model: String(data.get('model-id') ?? ''), api: String(data.get('model-api') ?? 'openai-responses'), baseUrl: String(data.get('model-base-url') ?? ''), key: String(data.get('model-key') ?? '') };
}
export function modelFields(d, editing = false, advanced) {
    const connection = `${Field('model-id', t('modelForm.modelId'), Input('model-id', d.model, 'required maxlength="512" data-model-max-length="256"'))}
 ${Field('model-api', t('modelForm.apiType'), `<select id="model-api" name="model-api"><option value="openai-responses" ${d.api === 'openai-responses' ? 'selected' : ''}>OpenAI Responses</option><option value="anthropic-messages" ${d.api === 'anthropic-messages' ? 'selected' : ''}>Anthropic Messages</option></select>`)}
 ${Field('model-base-url', t('modelForm.baseUrl'), Input('model-base-url', d.baseUrl, `required type="url" placeholder="${modelPlaceholder(d.api)}"`), modelProtocolHelp(d.api))}`;
    const key = Field('model-key', t('modelForm.apiKey'), Input('model-key', '', `type="password" autocomplete="new-password" ${editing ? '' : 'required'}`), editing ? t('modelForm.keyEditHelp') : t('modelForm.keyCreateHelp'));
    const name = Field('model-name', t('modelForm.displayName'), Input('model-name', d.name, 'maxlength="512" data-model-max-length="256"'), t('modelForm.nameHelp'));
    return advanced ? `${key}<details class="disclosure" id="model-advanced" ${advanced.open ? 'open' : ''}><summary>${t('modelForm.advanced')}</summary><div class="disclosure-body form-grid">${connection}${name}</div></details>` : `${connection}${key}${name}`;
}
export const modelErrors = {
    baseUrl: new LocalizedMessage('modelForm.error.baseUrl'),
    credential: new LocalizedMessage('modelForm.error.credential'),
    model: new LocalizedMessage('modelForm.error.model'),
    name: new LocalizedMessage('modelForm.error.name'),
    api: new LocalizedMessage('modelForm.error.api'),
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
    const summary = pending ? (result.startedAt && Date.now() - result.startedAt >= 10000 ? t('modelForm.test.slow') : t('modelForm.test.pending')) : error ? String(error) : (value ? `${value.success ? t('modelForm.test.passed') : t('modelForm.test.failed', { category: value.category, message: value.message })} ${t('modelForm.test.checked', { date: date(value.checkedAt), duration: value.durationMs })}${value.httpStatus ? t('modelForm.test.http', { status: value.httpStatus }) : ''}` : t('modelForm.test.unavailable'));
    const text = `${stale ? t('modelForm.test.previous') : ''}${summary}${stale ? t('modelForm.test.staleSuffix') : ''}`, actions = `<button type="button" class="btn secondary" data-model-action="view-test">${esc(t('modelForm.test.view'))}</button>`;
    return pending ? `<div class="feedback info" role="status">${pendingDots()}<div>${esc(text)}<div class="feedback-actions">${actions}</div></div></div>` : Feedback(text, value?.success && !stale ? 'success' : 'warning', actions);
}
export function modelTestDetails(result, currentRevision) {
    if (!result)
        return '';
    const { target, value, pending, revision, error } = result;
    const stage = pending ? t('modelForm.test.stage.pending') : error ? (result.notStarted ? t('modelForm.test.stage.notStarted') : t('modelForm.test.stage.error')) : value?.success ? t('modelForm.test.stage.received') : t('modelForm.test.stage.failed');
    const outcome = pending ? `<div class="feedback info" role="status">${pendingDots()}<div>${result.startedAt && Date.now() - result.startedAt >= 10000 ? t('modelForm.test.slow') : t('modelForm.test.pending')}</div></div>` : error ? Feedback(String(error), 'warning') : value?.success ? `<h3>${t('modelForm.test.reply')}</h3><pre data-model-test-reply>${esc(value.replyText)}</pre>${value.replyTruncated ? Feedback(t('modelForm.test.truncated'), 'warning') : ''}` : value ? `${Feedback(value.message, 'warning')}<p data-model-test-recovery>${esc(value.recovery)}</p>` : '';
    const recovery = error ? `<button type="button" class="btn secondary" data-model-action="edit-test">${t('modelForm.test.back')}</button>` : '';
    const checked = value ? `<p class="help">${t('modelForm.test.checked', { date: date(value.checkedAt), duration: value.durationMs })}${value.httpStatus ? t('modelForm.test.http', { status: value.httpStatus }) : ''}</p>` : '';
    return `<div data-model-test-dialog><dl class="summary-list"><dt>${t('modelForm.test.model')}</dt><dd>${esc(target.provider)}</dd><dt>${t('modelForm.apiType')}</dt><dd>${esc(target.api === 'openai-responses' ? 'OpenAI Responses' : 'Anthropic Messages')}</dd><dt>${t('modelForm.modelId')}</dt><dd><code>${esc(target.model)}</code></dd></dl><h3>${t('modelForm.test.testMessage')}</h3><pre>${esc(value?.testMessage || testMessage)}</pre><div aria-live="polite"><p data-model-test-stage>${esc(stage)}</p>${outcome}${recovery}${checked}${result.diagnosticId ? `<p class="help">${esc(t('modelForm.test.diagnostic', { id: result.diagnosticId }))}</p>` : ''}${revision !== currentRevision ? Feedback(t('modelForm.test.changed'), 'warning') : ''}</div><p class="help">${t('modelForm.test.advisory')}</p></div>`;
}
//# sourceMappingURL=model-form.js.map