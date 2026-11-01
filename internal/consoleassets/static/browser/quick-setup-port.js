import { readWithDeadline, ReadTimeout } from './read-deadline.js';
import { modelErrors } from './model-form.js';
import { LocalizedMessage } from './locale.js';
export class SetupRequestError extends Error {
    status;
    unknown;
    field;
    code;
    feedback;
    constructor(message, status = 0, unknown = false, field = '', code = '') {
        super(String(message ?? ''));
        this.status = status;
        this.unknown = unknown;
        this.field = field;
        this.code = code;
        this.feedback = message;
        if (message != null && typeof message !== 'string') {
            Object.defineProperty(this, 'message', { get: () => String(message), configurable: true });
        }
    }
}
export function createQuickSetupPort(csrf) {
    async function requestOnce(path, method, body, signal) {
        let response;
        try {
            response = await fetch(path, {
                method,
                signal,
                credentials: 'same-origin',
                headers: {
                    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
                    ...(method === 'GET' ? {} : { 'X-Piwork-Csrf': csrf(), 'X-Csrf-Token': csrf() }),
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
        }
        catch {
            throw new SetupRequestError(new LocalizedMessage(method === 'GET' ? 'net.offlineRead' : 'net.offlineWrite'), 0, method !== 'GET');
        }
        const value = await response.json().catch(() => null);
        if (!value || typeof value !== 'object')
            throw new SetupRequestError(new LocalizedMessage('net.response'), response.status, method !== 'GET');
        if (!response.ok) {
            let message = value.code === 'INVALID_REQUEST' ? modelErrors[value.field?.split('.')[0]] : undefined;
            if (!message)
                message = new LocalizedMessage('net.requestFailed');
            if (value.code === 'AUTHENTICATION_FAILED')
                message = new LocalizedMessage('net.auth');
            if (value.code === 'RATE_LIMITED')
                message = new LocalizedMessage('net.rate', { seconds: Math.max(1, Math.ceil(Number(value.retryAfterMs || 60000) / 1000)) });
            if (value.code === 'RELEASE_DEFAULTS_UNAVAILABLE')
                message = new LocalizedMessage('net.release');
            throw new SetupRequestError(message, response.status, method !== 'GET' && response.status >= 500 && value.code !== 'RELEASE_DEFAULTS_UNAVAILABLE', String(value.field || ''), String(value.code || ''));
        }
        return value;
    }
    async function request(path, method = 'GET', body) {
        if (method !== 'GET')
            return requestOnce(path, method, body);
        try {
            return await readWithDeadline(signal => requestOnce(path, method, body, signal));
        }
        catch (error) {
            if (error instanceof ReadTimeout)
                throw new SetupRequestError(new LocalizedMessage('read.timeout'));
            throw error;
        }
    }
    return {
        readSnapshot: () => request('/_web/api/onboarding'),
        readModels: () => request('/console/api/admin/models'),
        createModel: input => request('/console/api/admin/models', 'POST', input),
        bindRuntime: modelRef => request('/console/api/admin/runtime', 'PUT', { modelRef }),
        testModel: input => request('/console/api/admin/model-tests', 'POST', input),
    };
}
//# sourceMappingURL=quick-setup-port.js.map