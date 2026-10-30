import { randomUUID, sha256Hex } from './browser-crypto.js';
import { readWithDeadline, ReadTimeout } from './read-deadline.js';
import { LocalizedMessage, t } from './locale.js';
import { historyMessages, resultText, upsertTool } from './chat-projection.js';
import { HistoryProjection } from './history-projection.js';
import { synchronizeConfiguration } from './configuration.js';
import { parseEntries, mutationResults } from './files.js';
import { detectImageMime, imageDimensions, imageWithinLimits, FILE_IMAGE_MAX_BYTES } from './image-content.js';
import { lifecycleAction, projectWork, terminalOperation, workState } from './lifecycle.js';
import { operationKind, operationKindMatches } from './operation-recovery.js';
import { legacyOperationError, operationCorrelationId, operationDiagnostic, operationDiagnostics } from './operation-diagnostics.js';
import { MetadataReads, ObservationDeferred, ObservationStopped } from './observation.js';
import { coreAdmission } from './core-admission.js';
export function fileVersion(value) {
    const time = value ? Date.parse(value) : NaN;
    return Number.isFinite(time) ? new Date(time).toUTCString() : '';
}
export class DesktopError extends Error {
    code;
    httpStatus;
    field;
    messageKey;
    params;
    /** Untrusted server diagnostic kept beside the localized main message. */
    raw;
    constructor(code, message, httpStatus, field, messageKey, params, raw) {
        super(messageKey ? t(messageKey, params) + (raw ? ` ${raw}` : '') : message);
        this.code = code;
        this.httpStatus = httpStatus;
        this.field = field;
        this.messageKey = messageKey;
        this.params = params;
        this.raw = raw || undefined;
    }
}
/** Create a localized error whose text is re-rendered from its catalog key. */
function failure(code, key, params, httpStatus, field, raw) {
    return new DesktopError(code, key, httpStatus, field, key, params, raw);
}
const localizedMessages = new Map();
/** Intern by key, params and raw so one cached feedback value keeps a stable identity. */
function localized(key, params, raw) {
    const paramKey = params ? JSON.stringify(Object.keys(params).sort().map(name => [name, params[name]])) : '';
    const id = `${key}\u0000${paramKey}\u0000${raw ?? ''}`;
    let value = localizedMessages.get(id);
    if (!value) {
        value = new LocalizedMessage(key, params, raw);
        localizedMessages.set(id, value);
    }
    return value;
}
/** A cached localized value for fields still typed as string in the view models. */
const localizedText = (key, params) => localized(key, params);
/**
 * Render a user-facing error in the current locale. Locally produced errors
 * carry a catalog key; unknown server text is returned as diagnostic data only.
 */
export function describeError(error) {
    return String(errorFeedback(error));
}
function errorFeedback(error) {
    const value = error;
    if (value?.messageKey)
        return localized(value.messageKey, value.params, value.raw);
    return value?.message || String(error ?? '');
}
const part = encodeURIComponent;
const runStates = ['interrupted', 'accepted', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled', 'interrupted'];
const blankConfig = () => ({ skills: [], packages: [], agents: '', advanced: '{}', revision: 0, activeRevision: 0, loaded: false, modelVisible: false });
// The runtime value may be an interned LocalizedMessage; the cast keeps existing
// model fields (typed string) and String/esc interpolation working unchanged.
const errorText = (error) => errorFeedback(error);
const stateLabel = (value) => ({ ready: 'Ready', running: 'Ready', stopped: 'Stopped', degraded: 'Degraded', starting: 'Starting', recovering: 'Recovering', stopping: 'Stopping', failed: 'Failed', removed: 'Removed' }[value] ?? 'Unknown');
const diagnosticText = (value) => typeof value === 'string' ? value : '';
/** Copy only the typed public diagnostic fields; never stringify an unknown object or infer a stage. */
function serviceDiagnostic(raw, includeCause = true) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return undefined;
    const value = raw;
    const diagnostic = { code: diagnosticText(value.code), stage: diagnosticText(value.stage), message: diagnosticText(value.message), remediation: diagnosticText(value.remediation) };
    if (typeof value.retryable === 'boolean')
        diagnostic.retryable = value.retryable;
    if (typeof value.exitCode === 'number' && Number.isInteger(value.exitCode))
        diagnostic.exitCode = value.exitCode;
    if (diagnosticText(value.correlationId))
        diagnostic.correlationId = diagnosticText(value.correlationId);
    if (includeCause) {
        const cause = serviceDiagnostic(value.cause, false);
        if (cause)
            diagnostic.cause = cause;
    }
    const known = diagnostic.code || diagnostic.stage || diagnostic.message || diagnostic.remediation || diagnostic.correlationId || diagnostic.retryable !== undefined || diagnostic.exitCode !== undefined;
    return known ? diagnostic : undefined;
}
function serviceErrorText(raw) {
    if (typeof raw === 'string')
        return raw;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return undefined;
    return diagnosticText(raw.message) || undefined;
}
function mapService(raw) {
    const value = raw.temporary;
    const temporary = value && ['once', 'listener'].includes(value.mode) && typeof value.state === 'string' ? { mode: value.mode, state: value.state, ...(Number.isInteger(value.exitCode) ? { exitCode: value.exitCode } : {}), ...(typeof value.cleanupState === 'string' ? { cleanupState: value.cleanupState } : {}) } : undefined;
    const observed = temporary && raw.observedState === 'running' ? 'Running' : temporary && raw.observedState === 'completed' ? 'Completed' : stateLabel(raw.observedState);
    return { id: raw.serviceId, name: raw.name, domain: raw.access?.hostname ?? '', enabled: raw.enabled, observed, ports: (raw.access?.ports ?? []).filter((p) => /^https?:/.test(p.url ?? '')).sort((a, b) => Number(b.name === raw.access.defaultPortName) - Number(a.name === raw.access.defaultPortName)).map((p) => p.port), error: serviceErrorText(raw.lastError), diagnostic: serviceDiagnostic(raw.lastError), temporary };
}
export class DesktopAdapter {
    historySupport = new Map();
    historyProjections = new Map();
    historyControllers = new Set();
    historyReads = new Map();
    fullHistoryRuns = new Set();
    historyEventParts = new Map();
    historyProjection(id, session) { const key = `${id}:${session}`; let value = this.historyProjections.get(key); if (!value) {
        value = new HistoryProjection();
        this.historyProjections.set(key, value);
    } return value; }
    historyNotice(id) {
        return this.historySupport.get(id) === false ? t('d.error.historyNotice') : '';
    }
    legacyHistoryLimit(id, error) {
        return this.historySupport.get(id) === false && error instanceof DesktopError && ['RESPONSE_TOO_LARGE', 'RATE_LIMITED', 'HISTORY_UNSUPPORTED'].includes(error.code);
    }
    async supportsHistory(id) {
        if (this.historySupport.get(id))
            return true;
        const epoch = this.epoch;
        try {
            const value = await this.request(`works/${part(id)}/history-capabilities`);
            if (epoch !== this.epoch)
                return false;
            if (value.contractVersion !== 1 || value.profile !== 'session-history-v1' || value.pageBytes !== 524288)
                throw failure('INVALID_RESPONSE', 'd.error.historyCapabilities');
            this.historySupport.set(id, true);
            return true;
        }
        catch (error) {
            if (epoch === this.epoch && [404, 501].includes(error.httpStatus ?? 0)) {
                this.historySupport.set(id, false);
                return false;
            }
            throw error;
        }
    }
    cancelHistoryReads() { for (const controller of this.historyControllers)
        controller.abort(); this.historyControllers.clear(); this.historyReads.clear(); }
    async historyPage(id, sessionId, query, signal) {
        const value = await this.request(`works/${part(id)}/sessions/${part(sessionId)}/history?${query}`, 'GET', undefined, signal);
        if (value.contractVersion !== 1 || value.session?.workId !== id || value.session?.sessionId !== sessionId || typeof value.snapshotId !== 'string' || !Array.isArray(value.segments) || !Array.isArray(value.runs) || value.hasMore !== (typeof value.nextCursor === 'string' && !!value.nextCursor))
            throw failure('INVALID_RESPONSE', 'd.error.historyPageMismatch');
        if (query.has('snapshot') && query.get('snapshot') !== value.snapshotId || query.has('cursor') && query.get('cursor') === value.nextCursor)
            throw failure('INVALID_RESPONSE', 'd.error.historyRangeNoAdvance');
        return value;
    }
    async loadEarlierHistory(id, sessionId, reload = false) { const work = this.getWork(id); if (!work || !this.project(work).usable)
        throw failure('WORK_UNAVAILABLE', 'd.error.startBeforeHistory'); return this.loadPagedSession(id, sessionId, !reload); }
    loadPagedSession(id, sessionId, earlier = false) {
        const key = `${id}:${sessionId}:${earlier}`, pending = this.historyReads.get(key);
        if (pending)
            return pending;
        const promise = (async () => {
            const epoch = this.epoch, version = this.sessionVersions.get(id) || 0, session = this.getWork(id)?.sessions.find(s => s.id === sessionId);
            if (!session)
                return {};
            const state = session.history ??= { loading: false, error: '', cursor: null, snapshot: '', hasMore: false };
            if (earlier && (!state.cursor || state.expired))
                return {};
            const controller = new AbortController();
            this.historyControllers.add(controller);
            state.loading = true;
            state.error = '';
            if (!earlier) {
                session.loading = true;
                session.error = '';
            }
            this.emit();
            try {
                await this.loadImageCapabilities(id);
                if (epoch !== this.epoch || controller.signal.aborted)
                    return {};
                const profile = !!this.imageCapabilities.get(id)?.value, query = new URLSearchParams({ direction: 'older', ...(profile ? { imageProfile: 'chat-images-v1' } : {}), ...(earlier ? { cursor: state.cursor } : {}) });
                const page = await this.historyPage(id, sessionId, query, controller.signal);
                if (epoch !== this.epoch || controller.signal.aborted || this.getWork(id)?.sessions.find(s => s.id === sessionId) !== session)
                    return {};
                const projection = this.historyProjection(id, sessionId);
                projection.merge(page);
                const runs = page.runs.map(run => this.runRecord(run, sessionId));
                session.runs = [...(session.runs ?? []).filter(run => !runs.some(next => next.id === run.id)), ...runs];
                this.confirmSessionModel(id, session, page.session, version);
                session.imageProfile = profile;
                const active = runs.find(run => ['accepted', 'running', 'cancelling'].includes(run.status)), work = this.getWork(id);
                const restore = active && (!work.run || !['accepted', 'running', 'cancelling'].includes(work.run.status));
                if (restore) {
                    work.run = active;
                    projection.suppress(active.id);
                }
                session.messages = projection.project(session.messages);
                session.checkedAt = new Date().toISOString();
                Object.assign(state, { cursor: page.nextCursor, snapshot: page.snapshotId, hasMore: page.hasMore, expired: false, error: '' });
                if (restore)
                    void this.resumeRun(id);
                return page;
            }
            catch (error) {
                if (epoch !== this.epoch || controller.signal.aborted)
                    return {};
                state.error = errorText(error);
                state.expired = error.code === 'HISTORY_CURSOR_EXPIRED';
                if (!earlier)
                    session.error = errorText(error);
                throw error;
            }
            finally {
                this.historyControllers.delete(controller);
                if (epoch === this.epoch) {
                    state.loading = false;
                    session.loading = false;
                    this.emit();
                }
            }
        })().finally(() => { if (this.historyReads.get(key) === promise)
            this.historyReads.delete(key); });
        this.historyReads.set(key, promise);
        return promise;
    }
    async readRunResult(id, run, signal) {
        if (!run.resultRef)
            return '';
        if (run.resultRef.workId !== id || run.resultRef.sessionId !== run.sessionId || run.resultRef.runId !== run.id)
            throw failure('INVALID_RESPONSE', 'd.error.resultRefMismatch');
        const query = new URLSearchParams({ direction: 'newer', content: 'result', runId: run.id, ...(run.resultRef.snapshot ? { snapshot: run.resultRef.snapshot } : {}) });
        let cursor = null, block = '', offset = 0, complete = false;
        const text = [];
        do {
            if (cursor)
                query.set('cursor', cursor);
            const page = await this.historyPage(id, run.sessionId, query, signal);
            if (!query.has('snapshot'))
                query.set('snapshot', page.snapshotId);
            for (const part of page.segments) {
                if (part.runId !== run.id || !['text', 'run-result'].includes(part.type) || part.blockId !== block && block && !complete)
                    throw failure('INVALID_RESPONSE', 'd.error.resultConflictingRanges');
                if (part.blockId !== block) {
                    block = part.blockId;
                    offset = 0;
                }
                if (part.byteOffset !== offset)
                    throw failure('RESPONSE_INCOMPLETE', 'd.error.resultMissingRange');
                text.push(part.text);
                offset += new TextEncoder().encode(part.text).length;
                complete = part.complete;
            }
            if (page.nextCursor === cursor && cursor)
                throw failure('INVALID_RESPONSE', 'd.error.resultCursor');
            cursor = page.nextCursor;
        } while (cursor);
        if (!block || !complete)
            throw failure('RESPONSE_INCOMPLETE', 'd.error.savedResultIncomplete');
        return text.join('');
    }
    async loadSavedRun(id, run, signal) {
        const epoch = this.epoch, session = this.getWork(id)?.sessions.find(s => s.id === run.sessionId);
        if (!session)
            return;
        const projection = this.historyProjection(id, run.sessionId), runKey = `${id}:${run.id}`, profile = !!this.imageCapabilities.get(id)?.value || !!session.imageProfile;
        const query = new URLSearchParams({ direction: 'older', runId: run.id, ...(profile ? { imageProfile: 'chat-images-v1' } : {}) });
        let cursor = null;
        do {
            if (cursor)
                query.set('cursor', cursor);
            const page = await this.historyPage(id, run.sessionId, query, signal);
            if (epoch !== this.epoch || signal?.aborted)
                return;
            const covered = this.fullHistoryRuns.has(runKey) && page.segments.every((segment) => projection.covers(segment));
            projection.merge(page);
            cursor = page.nextCursor;
            if (covered)
                break;
        } while (cursor);
        this.fullHistoryRuns.add(runKey);
        projection.reveal(run.id);
        if (run.resultRef) {
            const resultQuery = new URLSearchParams({ direction: 'newer', content: 'result', runId: run.id, ...(run.resultRef.snapshot ? { snapshot: run.resultRef.snapshot } : {}) });
            cursor = null;
            do {
                if (cursor)
                    resultQuery.set('cursor', cursor);
                const page = await this.historyPage(id, run.sessionId, resultQuery, signal);
                if (epoch !== this.epoch || signal?.aborted)
                    return;
                projection.merge(page);
                cursor = page.nextCursor;
            } while (cursor);
        }
        if (epoch !== this.epoch || signal?.aborted)
            return;
        session.messages = projection.project(session.messages, new Set(['accepted', 'running', 'cancelling'].includes(run.status) ? [] : [run.id]));
        if (!['accepted', 'running', 'cancelling'].includes(run.status))
            for (const key of this.historyEventParts.keys())
                if (key.startsWith(`${id}:${run.id}:`))
                    this.historyEventParts.delete(key);
        session.checkedAt = new Date().toISOString();
        this.emit();
    }
    hosted = typeof document !== 'undefined' && document.querySelector('meta[name="piwork-mode"]')?.getAttribute('content') === 'hosted';
    about = { local: null, core: null, localError: '', coreError: '', localLoading: false, coreLoading: false, coreChecked: '' };
    loadAbout() {
        const epoch = this.epoch;
        this.about.localLoading = true;
        this.about.localError = '';
        this.emit();
        void this.request('about').then(value => { if (epoch === this.epoch)
            this.about.local = value; }).catch(error => { if (epoch === this.epoch)
            this.about.localError = errorText(error); }).finally(() => { if (epoch === this.epoch) {
            this.about.localLoading = false;
            this.emit();
        } });
        if (!this.state.signedIn) {
            this.about.coreError = localizedText('d.error.signInCoreVersion');
            return;
        }
        this.about.coreLoading = true;
        this.about.coreError = '';
        void this.request('core-about').then(value => { if (epoch === this.epoch) {
            this.about.core = value;
            this.about.coreChecked = new Date().toISOString();
        } }).catch(error => { if (epoch === this.epoch)
            this.about.coreError = error.httpStatus === 404 ? localizedText('d.error.coreVersionUnsupported') : errorText(error); }).finally(() => { if (epoch === this.epoch) {
            this.about.coreLoading = false;
            this.emit();
        } });
    }
    imageCapabilities = new Map();
    imageLoads = new Map();
    imageControllers = new Set();
    imageQueue = [];
    imageActive = 0;
    async loadImageCapabilities(id) {
        if (this.imageCapabilities.has(id)) {
            if (this.imageCapabilities.get(id)?.loading)
                await this.request(`works/${part(id)}/chat-image-capabilities`).catch(() => undefined);
            return;
        }
        const state = { loading: true, error: '', value: undefined }, epoch = this.epoch;
        this.imageCapabilities.set(id, state);
        this.emit();
        try {
            const value = await this.request(`works/${part(id)}/chat-image-capabilities`);
            if (epoch !== this.epoch)
                return;
            if (value.profile !== 'chat-images-v1')
                throw new Error(t('d.error.imageUnsupported'));
            state.value = value;
        }
        catch (error) {
            if (epoch === this.epoch)
                state.error = [404, 501].includes(error.httpStatus || 0) ? localizedText('d.error.imageUnavailable') : errorText(error);
        }
        finally {
            if (epoch === this.epoch) {
                state.loading = false;
                this.emit();
                const selected = this.chatSelection.startsWith(`${id}:`) ? this.chatSelection.slice(id.length + 1) : '', session = this.getWork(id)?.sessions.find(s => s.id === selected);
                if (state.value && session?.checkedAt && !session.imageProfile)
                    void this.loadSession(id, selected).catch(() => undefined);
            }
        }
    }
    async refreshImageCapabilities(id) {
        const epoch = this.epoch;
        if (this.imageCapabilities.get(id)?.loading)
            await this.loadImageCapabilities(id);
        if (epoch !== this.epoch)
            return;
        this.imageCapabilities.delete(id);
        return this.loadImageCapabilities(id);
    }
    imageInputReason(id, sessionId) {
        const capability = this.imageCapabilities.get(id);
        if (!capability || capability.loading)
            return t('d.error.imageChecking');
        if (!capability.value)
            return capability.error || t('d.error.imageUpdateAgent');
        const ref = this.modelSelection(id, sessionId).ref;
        const model = ref === null ? capability.value.defaultModel : capability.value.models.find((m) => m.modelRef === ref);
        return model?.availability === 'supported' ? '' : model?.availability === 'unsupported' ? t('d.error.imageModelUnsupported') : t('d.error.imageUnconfirmed');
    }
    historyImageKey(id, session, run, index) { return `${id}:${session}:${run}:${index}`; }
    loadHistoryImage(id, session, run, image) {
        const key = this.historyImageKey(id, session, run, image.imageIndex);
        if (this.imageLoads.has(key))
            return;
        const state = { phase: 'loading', url: undefined, error: '' }, epoch = this.epoch;
        this.imageLoads.set(key, state);
        this.emit();
        const start = async () => {
            this.imageActive++;
            const controller = new AbortController();
            this.imageControllers.add(controller);
            try {
                if (epoch !== this.epoch)
                    return;
                const response = await fetch(`/_desktop/api/works/${part(id)}/sessions/${part(session)}/runs/${part(run)}/images/${image.imageIndex}`, { credentials: 'same-origin', signal: controller.signal });
                if (!response.ok) {
                    const value = await response.json().catch(() => ({}));
                    if (response.status === 401)
                        await this.checkSession().catch(() => undefined);
                    throw failure('IMAGE_READ_FAILED', 'd.error.imageReadFailed', undefined, response.status, undefined, typeof value.message === 'string' && value.message ? value.message : undefined);
                }
                if (response.headers.get('Content-Type') !== image.mimeType || Number(response.headers.get('Content-Length')) !== image.byteSize || image.byteSize > 5 * 1024 ** 2)
                    throw new Error(t('d.error.imageResponseUnverified'));
                const blob = await response.blob();
                if (blob.size !== image.byteSize)
                    throw new Error(t('d.error.imageResponseIncomplete'));
                const hash = await sha256Hex(new Uint8Array(await blob.arrayBuffer()));
                if (hash !== image.sha256)
                    throw new Error(t('d.error.imageCorrupt'));
                if (epoch !== this.epoch || controller.signal.aborted)
                    return;
                state.url = URL.createObjectURL(blob);
                state.phase = 'ready';
            }
            catch (error) {
                if (epoch === this.epoch && !controller.signal.aborted) {
                    state.phase = 'error';
                    state.error = errorText(error);
                }
            }
            finally {
                this.imageControllers.delete(controller);
                this.imageActive--;
                this.imageQueue.shift()?.();
                if (epoch === this.epoch)
                    this.emit();
            }
        };
        if (this.imageActive < 2)
            void start();
        else
            this.imageQueue.push(() => { void start(); });
    }
    retryHistoryImage(id, session, run, image) { this.imageLoads.delete(this.historyImageKey(id, session, run, image.imageIndex)); this.loadHistoryImage(id, session, run, image); this.emit(); }
    stopImageReads() { for (const c of this.imageControllers)
        c.abort(); this.imageQueue = []; for (const value of this.imageLoads.values())
        if (value.url)
            URL.revokeObjectURL(value.url); this.imageLoads.clear(); }
    state = { works: [], operations: [], snapshots: [], scenario: 'loading', signedIn: false,
        sessionState: 'loading', sessionError: '', cleanupRequired: false,
        core: { address: '', name: 'Core', account: '', role: '', proxyPort: '', username: '' }, transfers: [], lastChecked: '' };
    requests = new Map();
    requestDetails = new Map();
    requestPresence = new Map();
    requestResponses = new Map();
    runDetails = new Map();
    temporaryCleanups = new Map();
    temporaryCleanupRequests = new Map();
    requestRetries = new Map();
    cancellingRequests = new Set();
    requestReadErrors = new Map();
    requestCancellations = new Map();
    models = new Map();
    modelSelections = new Map();
    chatCapabilities = new Map();
    cancelAndSendCapabilities = new Map();
    activeRuns = new Map();
    activeRevisions = new Map();
    commands = new Map();
    chatSubmissions = new Map();
    pairSaves = new Map();
    chatSelection = '';
    sessionVersions = new Map();
    activateChat(id, sessionId) { const key = `${id}:${sessionId}`; if (this.chatSelection && this.chatSelection !== key)
        this.cancelHistoryReads(); this.chatSelection = key; }
    status = {};
    coreAdmitted = false;
    coreHeld = false;
    corePaused = false;
    recoveryStartedAt = 0;
    get coreGate() {
        const gate = coreAdmission(this.status, this.coreAdmitted, this.coreHeld, this.connectionCheck.checking, this.connectionCheck.error, this.corePaused);
        return { ...gate, blocked: this.state.signedIn && this.state.sessionState === 'ready' && gate.blocked };
    }
    assertCoreReady() { if (this.coreGate.blocked)
        throw failure('CORE_NOT_READY', 'd.error.coreNotReady', undefined, 409); }
    acceptCoreStatus(status) {
        this.status = status;
        if (status.health?.available && status.readiness?.available && status.readiness.value?.ready === true) {
            this.coreAdmitted = true;
            this.coreHeld = false;
        }
        else if (status.readiness?.available && status.readiness.value?.ready === false)
            this.coreHeld = true;
    }
    inspection = null;
    inspectionTransfer = '';
    transferProgress = null;
    downloads = new Map();
    downloadRequests = new Map();
    downloadObservers = new Map();
    uploadProgress = new Map();
    transfersByWork = new Map();
    inspectionContext = null;
    cleanupPending = new Map();
    inspectionNonce = 0;
    inspectionSelection = 0;
    catalog = { skills: { loading: false, error: '', confirmed: false, checkedAt: '' }, packages: { loading: false, error: '', confirmed: false, checkedAt: '' } };
    logs = new Map();
    logStates = new Map();
    logRequests = new Map();
    directories = new Map();
    uploadIntents = new Map();
    csrf = '';
    generation = -1;
    epoch = 0;
    get identityEpoch() { return this.epoch; }
    reads = new Map();
    listeners = new Set();
    skills = [];
    packages = [];
    entries = new Map();
    entryPromises = new Map();
    entryErrors = new Map();
    entryChecks = new Map();
    entryVersions = new Map();
    serviceDenials = new Map();
    entryServiceGrants = new Map();
    serviceLoads = new Map();
    serviceReads = new Map();
    serviceSequence = 0;
    worksRequests = new Map();
    worksRequestSequence = 0;
    worksReadSequence = 0;
    pausedOperations = new Set();
    invalidOperationTargets = new Set();
    /** A dismissed terminal record remains recoverable until required object reads finish. */
    pendingOperationHides = new Map();
    closedImportOperations = new Set();
    streams = new Map();
    reconnects = new Map();
    historyObservers = new Map();
    reconnectAttempts = new Map();
    pollTimer;
    metadata = new MetadataReads();
    mutationSequence = 0;
    workMutations = new Map();
    workReads = new Map();
    statusSequence = 0;
    deletedWorks = new Set();
    workSync = new Map();
    pollTargets = new Map();
    terminalEvidence = new Map();
    observationVisible = true;
    visibleWorkId = '';
    visibleChat = true;
    interactionScope = '';
    interactionVersion = 0;
    interactionTimer;
    recoveryTimer;
    recoveryObservation = 0;
    recoveryReads = 0;
    recoveryListVisible = false;
    capabilityReads = new Map();
    sessionTimer;
    initializationTimer;
    initializationCycle = 0;
    pendingSignIn;
    get signInUnknown() { return !!this.pendingSignIn; }
    authCheck;
    authSequence = 0;
    connectionCheck = { checking: false, error: '', checkedAt: '', waiting: false };
    connectionRequest;
    preferences = { reading: false, phase: 'idle', confirmed: false, coreUrl: null, error: '', notice: '', waiting: false };
    preferenceSequence = 0;
    preferenceNotice;
    async preferenceRequest(method, coreUrl) {
        const csrf = this.csrf;
        let response;
        try {
            response = await fetch('/_desktop/api/preferences', { method, credentials: 'same-origin',
                headers: method === 'GET' ? {} : { 'X-Piwork-Csrf': csrf, ...(method === 'PUT' ? { 'Content-Type': 'application/json' } : {}) },
                ...(method === 'PUT' ? { body: JSON.stringify({ coreUrl }) } : {}) });
        }
        catch {
            throw failure(method === 'GET' ? 'PREFERENCES_UNAVAILABLE' : 'RESULT_UNKNOWN', method === 'GET' ? 'd.error.preferencesReadFailed' : 'd.error.preferencesResponseLost');
        }
        const value = await response.json().catch(() => null);
        if (csrf !== this.csrf)
            throw failure(method === 'GET' ? 'LOCAL_AUTH_REQUIRED' : 'RESULT_UNKNOWN', 'd.error.preferencesSessionChanged');
        if (!response.ok) {
            const code = value?.code || (method === 'GET' ? 'PREFERENCES_UNAVAILABLE' : 'RESULT_UNKNOWN');
            if (['LOCAL_AUTH_REQUIRED', 'LOCAL_CSRF_OR_AUTH_REQUIRED'].includes(code))
                await this.checkSession().catch(() => undefined);
            const key = { INVALID_DESKTOP_PREFERENCES: 'd.error.preferencesInvalidOrigin', DESKTOP_PREFERENCES_BUSY: 'd.error.preferencesBusy', DESKTOP_PREFERENCES_UNAVAILABLE: 'd.error.preferencesUnavailable', DESKTOP_PREFERENCES_OUTCOME_UNKNOWN: 'd.error.preferencesOutcomeUnknown' }[code] || 'd.error.preferencesUnconfirmed';
            throw failure(code, key, undefined, response.status);
        }
        if (!value || Object.keys(value).length !== 1 || !('coreUrl' in value) || value.coreUrl !== null && typeof value.coreUrl !== 'string')
            throw failure(method === 'GET' ? 'PREFERENCES_UNAVAILABLE' : 'RESULT_UNKNOWN', 'd.error.preferencesUnverified');
        return value.coreUrl;
    }
    async loadPreferences() {
        if (this.preferences.reading)
            return;
        if (this.hosted)
            return;
        if (['saving', 'clearing'].includes(this.preferences.phase))
            return;
        const sequence = ++this.preferenceSequence, unconfirmed = this.preferences.phase === 'unconfirmed';
        if (!unconfirmed)
            this.preferences.phase = 'loading';
        this.preferences.error = '';
        this.preferences.reading = true;
        this.emit();
        try {
            const coreUrl = await this.preferenceRequest('GET');
            if (sequence !== this.preferenceSequence)
                return;
            Object.assign(this.preferences, { coreUrl, confirmed: true, phase: 'idle', error: '', waiting: false });
        }
        catch (error) {
            if (sequence !== this.preferenceSequence)
                return;
            this.preferences.phase = unconfirmed ? 'unconfirmed' : 'idle';
            this.preferences.error = errorText(error);
        }
        finally {
            if (sequence === this.preferenceSequence) {
                this.preferences.reading = false;
                this.emit();
            }
        }
    }
    async savePreferences(coreUrl) {
        if (['saving', 'clearing', 'unconfirmed'].includes(this.preferences.phase))
            return;
        if (coreUrl !== null) {
            try {
                const url = new URL(coreUrl);
                if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
                    throw new Error();
            }
            catch {
                this.preferences.error = localizedText('d.error.preferencesInvalidOrigin');
                this.emit();
                return;
            }
        }
        const sequence = ++this.preferenceSequence;
        clearTimeout(this.preferenceNotice);
        Object.assign(this.preferences, { reading: false, phase: coreUrl === null ? 'clearing' : 'saving', error: '', notice: '', waiting: false });
        this.emit();
        const slow = setTimeout(() => { if (sequence === this.preferenceSequence && ['saving', 'clearing'].includes(this.preferences.phase)) {
            this.preferences.waiting = true;
            this.emit();
        } }, 10000);
        try {
            const saved = await this.preferenceRequest(coreUrl === null ? 'DELETE' : 'PUT', coreUrl ?? undefined);
            if (sequence !== this.preferenceSequence)
                return;
            Object.assign(this.preferences, { phase: 'idle', confirmed: true, coreUrl: saved, notice: saved === null ? localizedText('d.error.preferencesRestored') : localizedText('d.error.preferencesSaved'), waiting: false });
            this.preferenceNotice = setTimeout(() => { if (sequence === this.preferenceSequence) {
                this.preferences.notice = '';
                this.emit();
            } }, 3000);
        }
        catch (error) {
            if (sequence !== this.preferenceSequence)
                return;
            const unknown = error instanceof DesktopError && ['RESULT_UNKNOWN', 'DESKTOP_PREFERENCES_OUTCOME_UNKNOWN'].includes(error.code);
            Object.assign(this.preferences, { phase: unknown ? 'unconfirmed' : 'idle', error: errorText(error), waiting: false });
        }
        finally {
            clearTimeout(slow);
            if (sequence === this.preferenceSequence)
                this.emit();
        }
    }
    subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    emit() { for (const listener of this.listeners)
        listener(); }
    getWork(id) { return this.state.works.find(work => work.id === id); }
    coordinationOperations() {
        const operations = this.state.operations.filter(op => !op.terminalHint || !!op.checkedKind);
        const visible = new Set(operations.map(op => op.id));
        return [...operations, ...[...this.terminalEvidence.values()].map(e => e.operation).filter(op => !visible.has(op.id))];
    }
    operationNeedsAttention(op) {
        const work = this.getWork(op.workId);
        if (op.localRecordSaved === false || this.workSync.has(op.workId) || work?.lifecycleIntent?.operationId === op.id)
            return true;
        if (op.observationError && !op.terminalHint && !terminalOperation(op.state))
            return true;
        if (!terminalOperation(op.state) && !op.terminalHint)
            return true;
        if (!work)
            return !op.terminalHint && op.state !== 'succeeded' && op.state !== 'superseded';
        if (work.statusError || !this.worksChecked || !work.checkedAt)
            return true;
        if (op.state === 'failed' || op.terminalHint?.state === 'failed') {
            const kind = operationKind(op.checkedKind || op.kind);
            if (kind.startsWith('service:')) {
                const serviceId = op.checkedServiceId || (op.terminalHint ? op.serviceId : undefined);
                if (!serviceId || !work.resourceChecked?.services || work.resourceErrors?.services)
                    return true;
                const service = work.services.find(item => item.id === serviceId);
                const cleanup = this.temporaryCleanups.get(`${work.id}:service:${serviceId}`);
                if (kind === 'service:cleanup temporary' && (!cleanup || cleanup.loading || !cleanup.items.some(item => item.operationId === op.id)))
                    return true;
                if (cleanup?.error || cleanup?.items.some(item => item.operationId === op.id && item.state !== 'completed'))
                    return true;
                if (service?.temporary?.cleanupState && ['requested', 'running', 'pending', 'failed', 'unknown'].includes(service.temporary.cleanupState))
                    return true;
                if (!service || service.observed === 'Removed')
                    return false;
                return service.enabled ? !['Ready', 'Running', 'Completed'].includes(service.observed) : service.observed !== 'Stopped';
            }
            return work.status === 'Failed' || work.status === 'Unknown' || work.desired === 'stopped' && work.status !== 'Stopped' || work.desired === 'deleted';
        }
        if (work.desired === 'running' && ['Unknown', 'Preparing', 'Starting', 'Stopped'].includes(work.status) && ['create', 'start', 'retry'].includes(op.action || lifecycleAction(op.kind) || ''))
            return true;
        return false;
    }
    getOperation(id) { return this.state.operations.find(op => op.id === id) ?? this.terminalEvidence.get(id)?.operation; }
    project(work) { return projectWork(work, this.coordinationOperations()); }
    retainTerminal(operation) {
        if (!operation.action || !operation.workId || !terminalOperation(operation.state))
            return;
        const intent = this.getWork(operation.workId)?.lifecycleIntent;
        const previous = this.terminalEvidence.get(operation.id);
        this.terminalEvidence.set(operation.id, { operation: { ...operation }, generation: previous?.generation ?? (intent?.operationId === operation.id ? intent.sequence : this.workMutations.get(operation.workId) || 0) });
    }
    getSkills() { const copies = this.state.works.flatMap(work => work.config.skills).filter((name, i, all) => all.indexOf(name) === i && !this.skills.some(s => s.id === name)); return [...this.skills, ...copies.map(name => ({ id: name, name, description: 'Saved Work copy; unavailable in current Core catalog', version: null, loaded: null, modelVisible: null }))]; } // i18n-exempt: app.ts 用作本地占位 Skill 的比较哨兵
    getPackages() { return this.packages; }
    getSnapshot(id) { return this.state.snapshots.find(snapshot => snapshot.id === id); }
    logExport = null;
    logExportTimer;
    logExportStorageKey() { return `piwork:log-export:${this.state.core.address}:${this.state.core.account}`; }
    saveLogExportID() { try {
        if (this.logExport?.id)
            sessionStorage.setItem(this.logExportStorageKey(), this.logExport.id);
    }
    catch { } }
    loadLogExportID() { try {
        return sessionStorage.getItem(this.logExportStorageKey());
    }
    catch {
        return null;
    } }
    recoverLogExport() {
        if (this.logExport)
            return;
        const id = this.loadLogExportID();
        if (!id || !/^log-export-[A-Za-z0-9-]{16,128}$/.test(id))
            return;
        this.logExport = { id, key: '', cutoff: '', phase: 'collecting', processed: 0, total: 0, collectedBytes: 0, complete: null,
            warningCount: 0, warnings: [], filename: '', size: 0, digest: '', expiresAt: '', error: '', intent: false, restored: true, autoDelivered: true, delivered: false, polling: false };
        void this.refreshLogExport(false);
    }
    startLogExport() {
        if (this.state.core.role !== 'admin')
            return;
        this.stopLogExportPolling();
        this.logExport = { id: '', key: randomUUID(), cutoff: '', phase: 'creating', processed: 0, total: 0, collectedBytes: 0, complete: null,
            warningCount: 0, warnings: [], filename: '', size: 0, digest: '', expiresAt: '', error: '', intent: true, restored: false, autoDelivered: false, delivered: false, polling: false };
        this.emit();
        void this.createLogExport(this.logExport.key);
    }
    retryLogExportSameKey() { const state = this.logExport; if (!state || state.id || !state.key)
        return; state.phase = 'creating'; state.error = ''; this.emit(); void this.createLogExport(state.key); }
    async createLogExport(key) {
        const epoch = this.epoch;
        try {
            const value = await this.request('log-exports', 'POST', { idempotencyKey: key });
            if (epoch !== this.epoch || this.logExport?.key !== key || typeof value.exportId !== 'string')
                return;
            const state = this.logExport;
            Object.assign(state, { id: value.exportId, cutoff: typeof value.cutoffTime === 'string' ? value.cutoffTime : '', phase: this.logPhase(value.state), error: '' });
            this.saveLogExportID();
            this.emit();
            await this.refreshLogExport(false);
        }
        catch (error) {
            if (epoch !== this.epoch || !this.logExport || this.logExport.key !== key)
                return;
            if (!this.logExport.id)
                this.logExport.phase = 'unknown';
            this.logExport.error = errorText(error);
            this.logExport.polling = false;
            this.emit();
        }
    }
    logPhase(value) {
        return value === 'collecting' || value === 'packing' || value === 'ready' || value === 'failed' || value === 'interrupted' || value === 'expired' ? value : 'unknown';
    }
    async checkLogExport(explicit = true) {
        const state = this.logExport;
        if (!state)
            return;
        if (!state.id) {
            this.retryLogExportSameKey();
            return;
        }
        await this.refreshLogExport(explicit);
    }
    async refreshLogExport(explicit = true) {
        const state = this.logExport;
        if (!state?.id)
            return;
        const epoch = this.epoch;
        try {
            const value = await this.request(`log-exports/${part(state.id)}`);
            if (epoch !== this.epoch || this.logExport !== state)
                throw failure('CONNECTION_CHANGED', 'd.error.exportIdentityEnded');
            const progress = value.progress || {};
            const result = value.result || {};
            Object.assign(state, {
                cutoff: typeof value.cutoffTime === 'string' ? value.cutoffTime : state.cutoff, phase: this.logPhase(value.state),
                processed: Number(progress.processedSources) || 0, total: Number(progress.totalSources) || 0, collectedBytes: Number(progress.collectedBytes) || 0,
                complete: typeof value.complete === 'boolean' ? value.complete : null,
                warningCount: Number(value.warningCount) || 0,
                warnings: Array.isArray(value.warnings) ? value.warnings.filter((w) => w && typeof w.code === 'string' && typeof w.message === 'string').slice(0, 20) : [],
                filename: typeof result.filename === 'string' ? result.filename : '', size: Number(result.size) || 0,
                digest: typeof result.digest === 'string' ? result.digest : '', expiresAt: typeof result.expiresAt === 'string' ? result.expiresAt : '',
                error: value.error?.message || '', polling: false,
            });
            this.emit();
            if (state.phase === 'ready' && !state.autoDelivered && !state.restored) {
                state.autoDelivered = true;
                this.deliverLogExport();
            }
            if (state.phase === 'collecting' || state.phase === 'packing')
                this.scheduleLogExportPolling();
        }
        catch (error) {
            if (epoch !== this.epoch || this.logExport !== state)
                return;
            state.error = errorText(error);
            state.polling = false;
            this.emit();
            if (explicit)
                throw error;
        }
    }
    deliverLogExport() {
        const state = this.logExport;
        if (!state?.id || state.phase !== 'ready' || !state.filename)
            return;
        state.delivered = true;
        this.emit();
        if (typeof document === 'undefined')
            return;
        const link = document.createElement('a');
        link.href = `/_desktop/api/log-exports/${part(state.id)}/content`;
        link.download = state.filename;
        link.rel = 'noopener';
        document.body.append(link);
        link.click();
        link.remove();
    }
    scheduleLogExportPolling() {
        this.stopLogExportPolling();
        const state = this.logExport;
        if (!state?.id || (state.phase !== 'collecting' && state.phase !== 'packing'))
            return;
        state.polling = true;
        this.logExportTimer = setTimeout(() => { void this.refreshLogExport(false); }, 750);
    }
    stopLogExportPolling() { if (this.logExportTimer)
        clearTimeout(this.logExportTimer); this.logExportTimer = undefined; }
    worksLoading = false;
    worksChecked = '';
    worksError = '';
    clearIdentity(preserveInspection = false) {
        if (this.hosted) {
            try {
                for (const key of Object.keys(sessionStorage))
                    if (key.startsWith('piwork:web:'))
                        sessionStorage.removeItem(key);
            }
            catch { }
        }
        const inspection = preserveInspection ? { context: this.inspectionContext, summary: this.inspection, transfer: this.inspectionTransfer, progress: this.transferProgress } : null;
        if (!preserveInspection) {
            this.inspectionSelection++;
            this.inspectionNonce++;
            this.inspectionContext?.xhr?.abort();
            this.inspectionContext = null;
            this.transferProgress = null;
            this.cleanupPending.clear();
        }
        this.epoch++;
        this.coreAdmitted = false;
        this.coreHeld = false;
        this.corePaused = false;
        this.recoveryStartedAt = 0;
        this.status = {};
        this.connectionRequest = undefined;
        clearTimeout(this.recoveryTimer);
        this.recoveryTimer = undefined;
        this.recoveryObservation++;
        this.recoveryReads = 0;
        this.recoveryListVisible = false;
        Object.assign(this.connectionCheck, { checking: false, error: '', checkedAt: '', waiting: false });
        this.worksLoading = false;
        this.worksChecked = '';
        this.stopFileReads();
        this.directoryLoads.clear();
        this.state.works = [];
        this.state.operations = [];
        this.state.snapshots = [];
        this.state.transfers = [];
        clearInterval(this.interactionTimer);
        this.interactionTimer = undefined;
        this.interactionScope = '';
        this.interactionVersion++;
        this.requestPresence.clear();
        this.requestResponses.clear();
        this.runDetails.clear();
        this.temporaryCleanups.clear();
        this.temporaryCleanupRequests.clear();
        this.activeRuns.clear();
        this.activeRevisions.clear();
        this.cancelAndSendCapabilities.clear();
        this.terminalEvidence.clear();
        this.pendingOperationHides.clear();
        this.metadata.clear();
        this.pollTargets.clear();
        this.workMutations.clear();
        this.workReads.clear();
        this.deletedWorks.clear();
        this.workSync.clear();
        this.capabilityReads.clear();
        this.worksError = '';
        this.stopDownloadObservers();
        this.downloads.clear();
        this.downloadRequests.clear();
        this.uploadProgress.clear();
        this.stopLogExportPolling();
        this.logExport = null;
        Object.assign(this.about, { core: null, coreError: '', coreLoading: false, coreChecked: '' });
        this.cancelHistoryReads();
        this.historySupport.clear();
        this.historyProjections.clear();
        this.fullHistoryRuns.clear();
        this.historyEventParts.clear();
        this.stopImageReads();
        for (const value of this.imageLoads.values())
            if (value.url)
                URL.revokeObjectURL(value.url);
        this.imageLoads.clear();
        this.imageCapabilities.clear();
        this.transfersByWork.clear();
        this.directories.clear();
        this.models.clear();
        this.modelSelections.clear();
        this.chatCapabilities.clear();
        this.sessionVersions.clear();
        this.commands.clear();
        this.chatSubmissions.clear();
        this.pairSaves.clear();
        this.requests.clear();
        this.requestDetails.clear();
        this.requestRetries.clear();
        this.cancellingRequests.clear();
        this.requestReadErrors.clear();
        this.requestCancellations.clear();
        for (const status of Object.values(this.catalog))
            Object.assign(status, { loading: false, error: '', confirmed: false, checkedAt: '' });
        this.uploadIntents.clear();
        this.skills = [];
        this.packages = [];
        this.entries.clear();
        this.entryErrors.clear();
        this.entryPromises.clear();
        this.entryChecks.clear();
        this.entryVersions.clear();
        this.serviceDenials.clear();
        this.entryServiceGrants.clear();
        this.serviceLoads.clear();
        this.serviceReads.clear();
        this.worksRequests.clear();
        this.worksRequestSequence++;
        this.worksReadSequence = 0;
        this.logs.clear();
        this.logStates.clear();
        this.logRequests.clear();
        this.inspection = null;
        this.inspectionTransfer = '';
        if (inspection) {
            this.inspectionContext = inspection.context;
            this.inspection = inspection.summary;
            this.inspectionTransfer = inspection.transfer;
            this.transferProgress = inspection.progress;
        }
        for (const observer of this.historyObservers.values())
            observer.controller.abort();
        this.historyObservers.clear();
        for (const stream of this.streams.values())
            stream.abort();
        this.streams.clear();
        for (const timer of this.reconnects.values())
            clearTimeout(timer);
        this.reconnects.clear();
        this.reconnectAttempts.clear();
        clearTimeout(this.pollTimer);
        this.pollTimer = undefined;
        this.pausedOperations.clear();
        this.invalidOperationTargets.clear();
        this.closedImportOperations.clear();
    }
    request(path, method = 'GET', body, signal) {
        const runPath = /^works\/([^/]+)\/runs(?:\/|$|\?)/.exec(path), lookup = /^works\/([^/]+)\/(?:runs|sessions)\/submissions\//.exec(path), target = runPath ?? lookup;
        if (target && this.historySupport.get(decodeURIComponent(target[1]))) {
            if (method === 'POST' && /^works\/[^/]+\/runs$/.test(path))
                body = { ...body, responseProfile: 'history-v1' };
            else if (!/[?&]responseProfile=/.test(path))
                path += (path.includes('?') ? '&' : '?') + 'responseProfile=history-v1';
        }
        if (method !== 'GET' || signal)
            return this.requestOnce(path, method, body, signal);
        const key = `${this.epoch}:${path === 'session' ? `${this.authSequence}:` : ''}${path}`;
        const old = this.reads.get(key);
        if (old)
            return old;
        const pending = this.requestOnce(path, method, body).finally(() => { if (this.reads.get(key) === pending)
            this.reads.delete(key); });
        this.reads.set(key, pending);
        return pending;
    }
    metadataKey(path) {
        const match = /^works\/([^/]+)$/.exec(path);
        return `${this.epoch}:${match ? this.workMutations.get(decodeURIComponent(match[1])) || 0 : path === 'works' ? this.mutationSequence : 0}:${path}`;
    }
    readMetadata(path, explicit = false) {
        return this.metadata.read(this.metadataKey(path), async (signal) => {
            const sequence = ++this.statusSequence;
            const value = await this.request(path, 'GET', undefined, signal);
            return { value, sequence };
        }, explicit);
    }
    requireWorkSync(id, rearm = false) {
        // Ordinarily idempotent within a generation: rearming on every observation
        // prevents convergence. A Delete's first successful transition explicitly
        // creates a new post-terminal readback obligation.
        if (!id)
            return;
        const generation = this.workMutations.get(id) || 0;
        if (!rearm && this.workSync.get(id)?.generation === generation)
            return;
        this.workSync.set(id, { generation, after: this.statusSequence, work: true, list: true });
    }
    associateOperations(work) {
        const related = this.coordinationOperations().filter(op => op.workId === work.id && op.action);
        const outstanding = related.filter(op => !terminalOperation(op.state));
        work.operationId = work.lifecycleIntent?.operationId ?? (outstanding.length === 1 ? outstanding[0].id : related.length === 1 ? related[0].id : undefined);
    }
    mergeWork(raw, sequence, mutation, recoverAccess = false) {
        if (!raw || typeof raw.id !== 'string' || typeof raw.observedState !== 'string' || !['running', 'stopped', 'deleted'].includes(raw.desiredState))
            throw failure('INVALID_RESPONSE', 'd.error.workStatusIncomplete');
        const old = this.getWork(raw.id);
        if (mutation !== (this.workMutations.get(raw.id) || 0) || sequence < (this.workReads.get(raw.id) || 0))
            return old;
        if (old?.controlVersion !== undefined && raw.controlVersion !== undefined && raw.controlVersion < old.controlVersion)
            return old;
        this.workReads.set(raw.id, sequence);
        if (raw.observedState === 'deleted') {
            this.revokeWorkEntries(raw.id);
            this.deletedWorks.add(raw.id);
            this.state.works = this.state.works.filter(work => work.id !== raw.id);
            return;
        }
        if (this.deletedWorks.has(raw.id))
            return;
        const mapped = this.mapWork(raw, old);
        if (recoverAccess)
            mapped.accessRevoked = false;
        const work = old ? Object.assign(old, mapped) : mapped;
        if (!old)
            this.state.works.push(work);
        // A newer confirmed server target can come from a different client.
        const intent = work.lifecycleIntent;
        if (intent && intent.baseVersion !== undefined && raw.controlVersion > intent.baseVersion &&
            raw.desiredState !== (['stop', 'delete'].includes(intent.action) ? intent.action === 'delete' ? 'deleted' : 'stopped' : 'running'))
            delete work.lifecycleIntent;
        this.associateOperations(work);
        if (!this.project(work).retainWorkspace) {
            this.revokeWorkEntries(work.id);
            this.revokeWorkFilePreviews(work.id);
        }
        if (old && !this.project(work).usable) {
            this.cancelHistoryReads();
            this.historySupport.delete(work.id);
        }
        return work;
    }
    requestOnce(path, method = 'GET', body, signal, headers = {}) {
        const startupRead = path === 'session' || path === 'status' || path === 'works' || /^works\/[^/?]+(?:\?.*)?$/.test(path) || /^works\/[^/]+\/(?:services|configuration|packages|sessions|models)(?:\?.*)?$/.test(path);
        if (method !== 'GET' || !startupRead)
            return this.requestRaw(path, method, body, signal, headers);
        return readWithDeadline(inner => this.requestRaw(path, method, body, inner, headers), { signal })
            .catch(error => { if (error instanceof ReadTimeout)
            throw failure('READ_TIMEOUT', 'd.error.readTimeout'); throw error; });
    }
    async requestRaw(path, method = 'GET', body, signal, headers = {}) {
        if (method !== 'GET' && /^(works(?:\/|$)|work-imports$|service-entries$)/.test(path))
            this.assertCoreReady();
        const epoch = this.epoch, authSequence = this.authSequence;
        let response;
        try {
            response = await fetch(`/_desktop/api/${path}`, { method, credentials: 'same-origin', signal, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Piwork-Csrf': this.csrf, ...headers }, ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }) });
        }
        catch {
            throw failure(method === 'GET' ? 'CORE_UNAVAILABLE' : 'RESULT_UNKNOWN', method === 'GET' ? (this.hosted ? 'd.error.serverUnavailable' : 'd.error.localUnavailable') : 'd.error.responseLostOperations');
        }
        if (signal?.aborted || epoch !== this.epoch)
            throw failure('CONNECTION_CHANGED', 'd.error.coreAccountChanged');
        const value = await response.json().catch(() => null);
        if (signal?.aborted || epoch !== this.epoch)
            throw failure('CONNECTION_CHANGED', 'd.error.identityChangedReading');
        if (!response.ok) {
            const code = value?.code ?? `HTTP_${response.status}`;
            if (path !== 'session' && ['LOCAL_AUTH_REQUIRED', 'LOCAL_CSRF_OR_AUTH_REQUIRED'].includes(code)) {
                if (authSequence !== this.authSequence)
                    throw failure('CONNECTION_CHANGED', 'd.error.signInOwnsResponse');
                const pending = this.checkSession(), sequence = this.authSequence;
                await pending.catch(() => undefined);
                if (sequence !== this.authSequence)
                    throw failure('CONNECTION_CHANGED', 'd.error.signInOwnsReadback');
                throw failure(code, this.state.sessionState === 'ready' ? 'd.error.sessionRefreshed' : 'd.error.browserSessionRestore', undefined, response.status);
            }
            else if (response.status === 401 && path !== 'login' && path !== 'session') {
                if (authSequence !== this.authSequence)
                    throw failure('CONNECTION_CHANGED', 'd.error.authOwnsResponse');
                const pending = this.checkSession(), sequence = this.authSequence;
                const session = await pending;
                if (sequence !== this.authSequence)
                    throw failure('CONNECTION_CHANGED', 'd.error.authOwnsReadback');
                if (session.state === 'offline')
                    throw failure('CORE_UNAVAILABLE', 'd.error.coreUnreachable');
                if (session.state === 'signed-out') {
                    if (epoch === this.epoch)
                        this.clearIdentity();
                    this.state.signedIn = false;
                    this.state.scenario = 'auth-expired';
                    this.emit();
                }
            }
            const serviceKeys = {
                SERVICE_ENTRY_LIMIT: 'd.error.serviceEntryLimit',
                SERVICE_GENERATION_CHANGED: 'd.error.workOrServiceRestarted',
            };
            const mapped = serviceKeys[code];
            const key = mapped ?? (code === 'WORK_NAME_CONFLICT' ? 'd.error.workNameConflict' : 'd.error.requestFailed');
            // A server sentence is an untrusted diagnostic beside the localized main message.
            const raw = !mapped && code !== 'WORK_NAME_CONFLICT' && typeof value?.message === 'string' && value.message ? value.message : undefined;
            throw failure(code, key, key === 'd.error.requestFailed' ? { status: response.status } : undefined, response.status, value?.field === 'name' ? 'name' : undefined, raw);
        }
        if (!value || typeof value !== 'object')
            throw failure('INVALID_RESPONSE', 'd.error.invalidResponse');
        return value;
    }
    acceptSession(value) {
        if (this.hosted && value.state === 'signed-out') {
            this.clearIdentity();
            location.assign('/login');
            return;
        }
        const changed = this.generation !== value.generation;
        const previouslySignedIn = this.state.signedIn;
        if (this.csrf && this.csrf !== value.csrf || this.generation !== -1 && this.generation !== value.generation) {
            const context = this.inspectionContext;
            const preserve = !!context && context.anonymous && context.ready && context.importState === 'unsubmitted' && !this.state.signedIn && ['authenticated', 'signed-out'].includes(value.state) && context.core === value.coreUrl && context.localSession === value.csrf;
            this.clearIdentity(preserve);
            if (preserve && value.state === 'authenticated')
                context.anonymous = false;
        }
        this.state.sessionState = 'ready';
        this.state.sessionError = '';
        this.state.cleanupRequired = value.cleanupRequired === true;
        this.generation = value.generation;
        this.csrf = value.csrf ?? this.csrf;
        this.state.core.address = value.coreUrl ?? '';
        this.state.core.name = 'Core';
        const user = value.user ?? value.lastKnownUser;
        this.state.core.account = user?.account ?? '';
        this.state.core.role = user?.role ?? '';
        this.state.signedIn = value.state === 'authenticated' || value.state === 'offline' && !!value.lastKnownUser;
        if (value.state === 'offline')
            this.state.scenario = 'core-offline';
        else if (changed || !previouslySignedIn || !this.state.signedIn)
            this.state.scenario = 'normal';
        this.state.lastChecked = value.lastConfirmedAt ?? this.state.lastChecked;
    }
    unavailableSession(error) {
        this.state.sessionState = 'unavailable';
        this.state.sessionError = error instanceof DesktopError && error.code === 'LOCAL_SESSION_CAPACITY'
            ? t('d.error.sessionCapacity')
            : error instanceof DesktopError && error.code === 'LOCAL_SESSION_UNAVAILABLE'
                ? t('d.error.sessionCreateFailed')
                : errorText(error);
        this.emit();
    }
    sessionRead(signal) {
        return this.request('session', 'GET', undefined, signal).then(value => {
            if (!['signed-out', 'authenticated', 'offline'].includes(value.state) || typeof value.csrf !== 'string' || !value.csrf || !Number.isInteger(value.generation) || typeof value.coreUrl !== 'string')
                throw failure('INVALID_RESPONSE', 'd.error.sessionResponseUnverified');
            return value;
        });
    }
    async checkSession() {
        if (this.authCheck?.epoch === this.epoch && this.authCheck.sequence === this.authSequence)
            return this.authCheck.pending;
        const epoch = this.epoch, sequence = ++this.authSequence, controller = new AbortController();
        let pending;
        pending = (async () => {
            try {
                let value = await this.sessionRead(controller.signal);
                if (epoch !== this.epoch || sequence !== this.authSequence)
                    throw failure('CONNECTION_CHANGED', 'd.error.olderSessionDiscarded');
                if (value.sessionCreated === true) {
                    const confirmed = await this.sessionRead(controller.signal);
                    if (epoch !== this.epoch || sequence !== this.authSequence)
                        throw failure('CONNECTION_CHANGED', 'd.error.olderSessionDiscarded');
                    if (confirmed.sessionCreated === true || confirmed.csrf !== value.csrf)
                        throw failure('SESSION_COOKIE_UNAVAILABLE', 'd.error.sessionCookie');
                    value = confirmed;
                }
                this.acceptSession(value);
                const uncertain = this.pendingSignIn;
                if (uncertain && value.state !== 'offline') {
                    const account = value.user?.account;
                    if (uncertain.phase === 'connection' || value.state === 'signed-out' ||
                        value.state === 'authenticated' && value.coreUrl === uncertain.core && account === uncertain.account)
                        this.pendingSignIn = undefined;
                }
                const acceptedEpoch = this.epoch, connectionOwned = this.authCheck?.connectionOwned;
                if (this.authCheck?.pending === pending)
                    this.authCheck.acceptedEpoch = acceptedEpoch;
                this.scheduleSessionCheck();
                this.emit();
                // An explicit connection check continues against exactly this accepted
                // identity. Standalone session renewal also refreshes the new identity.
                if (epoch !== acceptedEpoch && acceptedEpoch === this.epoch && sequence === this.authSequence && this.state.signedIn && !connectionOwned)
                    void this.readConnection().catch(() => undefined);
                return value;
            }
            catch (error) {
                if (epoch !== this.epoch || sequence !== this.authSequence)
                    throw failure('CONNECTION_CHANGED', 'd.error.olderSessionDiscarded');
                if (!(error instanceof DesktopError && error.code === 'CONNECTION_CHANGED'))
                    this.unavailableSession(error);
                throw error;
            }
            finally {
                if (this.authCheck?.pending === pending)
                    this.authCheck = undefined;
            }
        })();
        this.authCheck = { epoch, sequence, pending, controller };
        return pending;
    }
    async initialize() {
        if (new URLSearchParams(location.hash.slice(1)).has('ticket'))
            history.replaceState(null, '', location.pathname + location.search);
        const cycle = ++this.initializationCycle;
        clearTimeout(this.initializationTimer);
        return this.initializeAttempt(cycle, 0, location.hash);
    }
    cancelInitialization() {
        this.initializationCycle++;
        clearTimeout(this.initializationTimer);
        this.authCheck?.controller.abort();
    }
    async initializeAttempt(cycle, attempt, route) {
        this.authSequence++;
        this.authCheck?.controller.abort();
        this.state.sessionState = 'loading';
        if (attempt === 0)
            this.state.sessionError = '';
        this.emit();
        const pending = this.checkSession(), sequence = this.authSequence;
        const slow = setTimeout(() => {
            if (sequence === this.authSequence && this.state.sessionState === 'loading') {
                this.state.sessionError = localizedText('d.error.stillReadingSession');
                this.emit();
            }
        }, 10000);
        try {
            await pending;
        }
        catch (error) {
            if (cycle !== this.initializationCycle || sequence !== this.authSequence)
                return;
            if (this.state.sessionState === 'loading')
                this.unavailableSession(error);
            if (attempt < 2) {
                const epoch = this.epoch;
                this.initializationTimer = setTimeout(() => {
                    if (cycle === this.initializationCycle && sequence === this.authSequence && epoch === this.epoch && route === location.hash)
                        void this.initializeAttempt(cycle, attempt + 1, route);
                }, attempt === 0 ? 1000 : 3000);
            }
            return;
        }
        finally {
            clearTimeout(slow);
        }
        if (sequence === this.authSequence && this.state.signedIn) {
            try {
                await this.checkConnection();
            }
            catch (error) {
                this.scheduleInitialConnectionRetry(cycle, 0, route);
                throw error;
            }
        }
    }
    scheduleInitialConnectionRetry(cycle, attempt, route) {
        if (attempt >= 2)
            return;
        const epoch = this.epoch, sequence = this.authSequence;
        clearTimeout(this.initializationTimer);
        this.initializationTimer = setTimeout(() => {
            if (cycle !== this.initializationCycle || epoch !== this.epoch || sequence !== this.authSequence || route !== location.hash || !this.state.signedIn)
                return;
            void this.checkConnection().then(() => {
                if (cycle === this.initializationCycle && epoch === this.epoch && route === location.hash)
                    window.dispatchEvent(new Event('piwork:startup-connection-recovered'));
            }).catch(() => this.scheduleInitialConnectionRetry(cycle, attempt + 1, route));
        }, attempt === 0 ? 1000 : 3000);
    }
    scheduleSessionCheck() {
        clearTimeout(this.sessionTimer);
        if (this.state.sessionState !== 'ready')
            return;
        this.sessionTimer = setTimeout(async () => {
            try {
                await this.checkSession();
            }
            catch { /* The connection error stays visible until a read succeeds. */ }
            this.scheduleSessionCheck();
        }, 15000);
    }
    logoutCommand() { return `piwork-cli desktop logout --port ${this.localPort()}`; }
    startCommand() { return `piwork-cli desktop --port ${this.localPort()} --no-open`; }
    localPort() { const port = Number(location.port || 17891); return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 17891; }
    async signIn(core, account, password) {
        if (this.pendingSignIn)
            throw failure('RESULT_UNKNOWN', 'd.error.signInUnknown');
        this.authSequence++;
        let phase = 'connection';
        try {
            if (core !== this.state.core.address)
                this.acceptSession(await this.request('connection', 'PUT', { coreUrl: core }));
            phase = 'login';
            this.acceptSession(await this.request('login', 'POST', { account, password }));
        }
        catch (error) {
            if (!(error instanceof DesktopError) || !['RESULT_UNKNOWN', 'INVALID_RESPONSE'].includes(error.code))
                throw error;
            this.pendingSignIn = { core, account, phase };
            this.emit();
            const confirmed = await this.checkSignInOutcome().catch(() => false);
            if (!confirmed)
                throw failure('RESULT_UNKNOWN', 'd.error.signInUnknown');
        }
        this.state.scenario = 'loading';
        this.emit();
        const epoch = this.epoch;
        void this.checkConnection().catch(error => { if (epoch === this.epoch && this.state.signedIn) {
            this.state.scenario = 'list-error';
            this.emit();
        } });
    }
    async checkSignInOutcome() {
        const intent = this.pendingSignIn;
        if (!intent)
            return false;
        const session = await this.checkSession();
        if (this.pendingSignIn === intent)
            throw failure('RESULT_UNKNOWN', 'd.error.signInUnknown');
        return intent.phase === 'login' && session.state === 'authenticated' && session.coreUrl === intent.core && session.user?.account === intent.account;
    }
    async switchCore(core) { this.authSequence++; this.acceptSession(await this.request('connection', 'PUT', { coreUrl: core })); if (this.state.signedIn)
        await this.checkConnection(); this.emit(); }
    async signOut() { this.authSequence++; const value = await this.request('logout', 'POST'); this.clearIdentity(); this.acceptSession(value.view); this.emit(); return value; }
    checkConnection() { this.recoveryReads = 0; this.recoveryStartedAt = Date.now(); this.corePaused = false; return this.readConnection(true); }
    readConnection(checkSession = false) {
        if (this.connectionRequest?.epoch === this.epoch)
            return this.connectionRequest.pending;
        let epoch = this.epoch;
        Object.assign(this.connectionCheck, { checking: true, error: '', waiting: false });
        this.emit();
        const slow = setTimeout(() => { if (epoch === this.epoch && this.connectionCheck.checking) {
            this.connectionCheck.waiting = true;
            this.emit();
        } }, 10000);
        let pending;
        pending = (async () => {
            try {
                if (checkSession) {
                    const session = this.checkSession(), sessionCheck = this.authCheck;
                    if (sessionCheck)
                        sessionCheck.connectionOwned = true;
                    await session;
                    // This session read may legitimately accept a new generation. Follow only
                    // the identity it accepted, never a later external switch or newer check.
                    if (sessionCheck?.acceptedEpoch !== this.epoch || sessionCheck.sequence !== this.authSequence || this.connectionRequest && this.connectionRequest.pending !== pending)
                        return;
                    if (epoch !== this.epoch) {
                        epoch = this.epoch;
                        this.connectionRequest = { epoch, pending };
                        Object.assign(this.connectionCheck, { checking: true, error: '', waiting: false });
                        this.emit();
                    }
                }
                const { value: status } = await this.readMetadata('status', true);
                if (epoch !== this.epoch)
                    return;
                this.acceptCoreStatus(status);
                this.state.lastChecked = status.checkedAt ?? new Date().toISOString();
                this.state.scenario = !status.health?.available ? 'core-offline' : !status.readiness?.available || status.readiness.value?.ready === false ? 'env-not-ready' : 'normal';
                Object.assign(this.connectionCheck, { checking: false, checkedAt: this.state.lastChecked, waiting: false });
                this.emit();
                if (this.state.signedIn && this.state.scenario !== 'core-offline') {
                    // The local record read is independent of the Work list. A failed or
                    // slow list must not hide an accepted Create, Import, or Delete.
                    const [works, records] = await Promise.allSettled([
                        (async () => { await this.listWorks(); await this.checkCatalog(); })(),
                        this.recoverOperations(),
                    ]);
                    if (works.status === 'rejected')
                        throw works.reason;
                    if (records.status === 'rejected')
                        throw records.reason;
                }
            }
            catch (error) {
                if (epoch === this.epoch && (this.connectionCheck.checking || !this.coreAdmitted) && !(error instanceof ObservationStopped) && !(error instanceof ObservationDeferred)) {
                    this.connectionCheck.error = errorText(error);
                    if (this.state.scenario === 'loading')
                        this.state.scenario = 'list-error';
                }
                throw error;
            }
            finally {
                clearTimeout(slow);
                if (epoch === this.epoch) {
                    this.connectionCheck.checking = false;
                    this.connectionCheck.waiting = false;
                    this.emit();
                }
                if (this.connectionRequest?.pending === pending)
                    this.connectionRequest = undefined;
            }
        })();
        this.connectionRequest = { epoch, pending };
        return pending;
    }
    listWorks(explicit = true, guard) {
        const direct = this.worksRequests.get(`${this.epoch}:${this.mutationSequence}:direct`);
        if (guard && direct)
            return direct;
        const key = `${this.epoch}:${this.mutationSequence}:${guard ? `recovery-${this.recoveryObservation}` : 'direct'}`, previous = this.worksRequests.get(key);
        if (previous)
            return previous;
        const requestSequence = ++this.worksRequestSequence;
        const pending = this.readWorks(explicit, requestSequence, guard).finally(() => {
            if (this.worksRequests.get(key) === pending)
                this.worksRequests.delete(key);
        });
        this.worksRequests.set(key, pending);
        return pending;
    }
    async readWorks(explicit, requestSequence, guard) {
        const epoch = this.epoch, mutations = new Map(this.workMutations);
        if (!guard) {
            this.worksLoading = true;
            this.emit();
        }
        try {
            const { value, sequence } = await this.readMetadata('works', explicit);
            if (epoch !== this.epoch)
                throw new ObservationStopped(t('d.error.identityChanged'));
            if (guard && !guard())
                return;
            if (sequence < this.worksReadSequence)
                return;
            if (!Array.isArray(value.works))
                throw failure('INVALID_RESPONSE', 'd.error.workListIncomplete');
            this.worksReadSequence = sequence;
            const ids = new Set(value.works.map((raw) => raw.id));
            for (const raw of value.works)
                this.mergeWork(raw, sequence, mutations.get(raw.id) || 0);
            const previousWorks = this.state.works;
            this.state.works = previousWorks.filter(work => ids.has(work.id) ||
                (mutations.get(work.id) || 0) !== (this.workMutations.get(work.id) || 0) || sequence < (this.workReads.get(work.id) || 0));
            for (const work of previousWorks)
                if (!this.getWork(work.id))
                    this.revokeWorkEntries(work.id);
            for (const [id, sync] of this.workSync) {
                if (sync.generation !== (mutations.get(id) || 0) || sequence <= sync.after)
                    continue;
                const raw = value.works.find((item) => item.id === id), work = this.getWork(id);
                const intent = work?.lifecycleIntent;
                const deleted = this.coordinationOperations().some(op => op.workId === id && op.action === 'delete' && op.state === 'succeeded' && (!intent || intent.operationId === op.id));
                // A missing list entry is not confirmed while a newer Work read or a
                // newer mutation kept the row. Keep the list obligation armed so the
                // next read can reconcile it instead of marking contradictory facts as
                // a completed deletion. A list still containing a successfully
                // deleted Work is likewise not a confirmation of that deletion.
                if ((!ids.has(id) && work) || (ids.has(id) && deleted)) {
                    sync.list = true;
                    continue;
                }
                sync.list = false;
                if (ids.has(id) && work?.checkedAt && sequence >= (this.workReads.get(id) || 0) && (typeof raw?.controlVersion !== 'number' || raw.controlVersion >= (work.controlVersion || 0)))
                    sync.work = false;
                if (!ids.has(id) && deleted) {
                    sync.work = false;
                    this.deletedWorks.add(id);
                }
            }
            this.finishWorkSync();
            if (requestSequence !== this.worksRequestSequence)
                return;
            this.worksError = '';
            this.worksChecked = new Date().toISOString();
            if (['loading', 'empty', 'list-error'].includes(this.state.scenario))
                this.state.scenario = 'normal';
            if (!this.state.works.length && this.state.scenario === 'normal')
                this.state.scenario = 'empty';
            this.emit();
        }
        catch (error) {
            if (epoch === this.epoch && (!guard || guard()) && requestSequence === this.worksRequestSequence && this.state.signedIn && !(error instanceof ObservationStopped) && !(error instanceof ObservationDeferred)) {
                this.worksError = errorText(error);
                if (!this.worksChecked)
                    this.state.scenario = 'list-error';
                this.emit();
            }
            throw error;
        }
        finally {
            if (!guard && epoch === this.epoch && requestSequence === this.worksRequestSequence) {
                this.worksLoading = false;
                this.emit();
            }
        }
    }
    mapWork(raw, old) {
        return { ...(old ?? { network: '', services: [], files: [], sessions: [], config: blankConfig() }),
            id: raw.id, name: raw.name, description: raw.id, desired: raw.desiredState, observed: raw.observedState, status: workState(raw.observedState),
            error: typeof raw.lastError === 'string' ? raw.lastError : raw.lastError?.message, controlVersion: raw.controlVersion, checkedAt: new Date().toISOString(), statusError: old?.accessRevoked ? old.statusError : undefined, updated: raw.updatedAt ?? '', color: 'blue', icon: 'grid',
            config: { ...(old?.config ?? blankConfig()), revision: raw.desiredRevision ?? 0, activeRevision: raw.activeRevision ?? 0 } };
    }
    async checkCatalog() {
        const epoch = this.epoch;
        for (const status of Object.values(this.catalog))
            status.loading = true;
        this.emit();
        await Promise.allSettled(['skills', 'packages'].map(async (name) => {
            const status = this.catalog[name];
            try {
                const value = await this.request(name);
                if (epoch !== this.epoch)
                    return;
                if (!Array.isArray(value[name]) || value[name].some((entry) => !entry || typeof entry.name !== 'string'))
                    throw new Error(t('d.error.catalogIncomplete', { name }));
                if (name === 'skills')
                    this.skills = value.skills.map((entry) => ({ id: entry.name, name: entry.name, description: null, version: null, loaded: null, modelVisible: null }));
                else
                    this.packages = value.packages.map((entry) => ({ ...entry, description: entry.description ?? null, version: entry.version ?? null }));
                Object.assign(status, { error: '', confirmed: true, checkedAt: new Date().toISOString() });
            }
            catch (error) {
                if (epoch === this.epoch)
                    status.error = errorText(error);
            }
            finally {
                if (epoch === this.epoch) {
                    status.loading = false;
                    this.emit();
                }
            }
        }));
        return !this.catalog.skills.error && !this.catalog.packages.error;
    }
    async refreshWorkStatus(id, explicit = true) {
        const epoch = this.epoch, mutation = this.workMutations.get(id) || 0, sequence = ++this.statusSequence;
        try {
            const { value: raw, sequence: readSequence } = await this.readMetadata(`works/${part(id)}`, explicit);
            const sequence = readSequence;
            if (epoch !== this.epoch)
                throw new ObservationStopped(t('d.error.identityChanged'));
            if (raw.id !== id)
                throw failure('INVALID_RESPONSE', 'd.error.workStatusMismatch');
            const previous = this.getWork(id), wasUsable = previous && this.project(previous).usable;
            const work = this.mergeWork(raw, sequence, mutation, true);
            if (work && sequence === this.workReads.get(id) && mutation === (this.workMutations.get(id) || 0) && !work.accessRevoked)
                work.statusError = undefined;
            const sync = this.workSync.get(id);
            if (sync && sequence > sync.after && sync.generation === mutation && mutation === (this.workMutations.get(id) || 0) && sequence >= (this.workReads.get(id) || 0) && (typeof raw.controlVersion !== 'number' || raw.controlVersion >= (work?.controlVersion || 0)))
                sync.work = false;
            this.finishWorkSync();
            this.emit();
            if (work && !wasUsable && this.project(work).usable && this.visibleWorkId === id)
                void this.refreshCapabilities(id);
            return work;
        }
        catch (error) {
            if (epoch === this.epoch && sequence >= (this.workReads.get(id) || 0) && mutation === (this.workMutations.get(id) || 0) && !(error instanceof ObservationStopped) && !(error instanceof ObservationDeferred)) {
                const work = this.getWork(id);
                if (work) {
                    work.statusError = errorText(error);
                    if (error instanceof DesktopError && [401, 403, 404, 410].includes(error.httpStatus || 0)) {
                        work.accessRevoked = true;
                        this.revokeWorkEntries(id, errorText(error));
                    }
                }
                if (error instanceof DesktopError && error.httpStatus === 404 && this.coordinationOperations().some(op => op.workId === id && op.action === 'delete' && op.state === 'succeeded')) {
                    this.deletedWorks.add(id);
                    this.state.works = this.state.works.filter(w => w.id !== id);
                    const sync = this.workSync.get(id);
                    if (sync)
                        sync.work = false;
                }
                this.emit();
            }
            throw error;
        }
    }
    async loadWork(id, includeChat = true) {
        const work = await this.refreshWorkStatus(id);
        if (!work)
            throw failure('NOT_FOUND', 'd.error.workUnavailable', undefined, 404);
        work.resourceErrors = {};
        const tasks = [['services', () => this.loadServices(id)], ['configuration', () => this.loadConfiguration(id)], ['packages', () => this.loadPackages(id)]];
        for (const [name, action] of tasks) {
            try {
                await action();
            }
            catch (error) {
                work.resourceErrors[name] = errorText(error);
            }
        }
        if (includeChat && ['Ready', 'Degraded'].includes(work.status)) {
            try {
                await Promise.all([this.loadSessions(id), this.loadModels(id)]);
            }
            catch (error) {
                work.resourceErrors.agent = errorText(error);
            }
        }
        this.emit();
        return work;
    }
    loadServices(id) {
        const key = `${this.epoch}:${this.workMutations.get(id) || 0}:${id}`, previous = this.serviceLoads.get(key);
        if (previous)
            return previous;
        const pending = this.readServices(id).finally(() => { if (this.serviceLoads.get(key) === pending)
            this.serviceLoads.delete(key); });
        this.serviceLoads.set(key, pending);
        return pending;
    }
    async readServices(id) {
        const work = this.getWork(id);
        if (!work)
            return;
        const epoch = this.epoch, mutation = this.workMutations.get(id) || 0, sequence = ++this.serviceSequence;
        this.serviceReads.set(id, sequence);
        const current = () => epoch === this.epoch && this.getWork(id) === work && mutation === (this.workMutations.get(id) || 0) && this.serviceReads.get(id) === sequence;
        (work.resourceLoading ??= {}).services = true;
        this.emit();
        try {
            // The outer coordinator scopes deduplication to the current control generation.
            const value = await this.requestOnce(`works/${part(id)}/services`);
            if (!current())
                return;
            if (!Array.isArray(value.services))
                throw failure('INVALID_RESPONSE', 'd.error.serviceListingIncomplete');
            (work.resourceChecked ??= {}).services = new Date().toISOString();
            work.services = value.services.map(mapService);
            if (work.resourceErrors)
                delete work.resourceErrors.services;
            for (const key of this.serviceEntryKeys(id)) {
                const service = work.services.find(service => key.startsWith(`${id}:${service.id}:`));
                if (!service || !service.enabled || ['Stopped', 'Removed'].includes(service.observed) || !service.ports.some(port => key === `${id}:${service.id}:${port}`))
                    this.revokeServiceEntry(key);
            }
            // Metadata confirms state, never a previously denied entry's authorization.
            const domain = work.services.find(service => service.domain)?.domain;
            work.network = domain ? domain.split('.').slice(1, -1).join('.') : '';
            this.emit();
        }
        catch (error) {
            if (current()) {
                (work.resourceErrors ??= {}).services = errorText(error);
                if (error instanceof DesktopError && [401, 403].includes(error.httpStatus || 0)) {
                    this.serviceDenials.set(id, { version: (this.serviceDenials.get(id)?.version || 0) + 1, reason: errorText(error) });
                    this.revokeWorkEntries(id, errorText(error));
                }
            }
            throw error;
        }
        finally {
            if (current()) {
                work.resourceLoading.services = false;
                this.emit();
            }
        }
    }
    async loadConfiguration(id) {
        const work = this.getWork(id);
        (work.resourceLoading ??= {}).configuration = true;
        this.emit();
        try {
            const value = await this.request(`works/${part(id)}/configuration`);
            const raw = value.desired;
            work.config = { ...work.config, skills: raw.skills ?? [], packages: (raw.packages ?? []).map((p) => ({ name: p.name, enabled: p.enabled, source: 'Saved Work copy' })), agents: raw.agentsMd ?? '', advanced: JSON.stringify(raw, null, 2), pendingApply: value.pendingApply, runtime: value.runtime, active: value.active, loaded: value.runtime?.state === 'ready', modelVisible: false }; // i18n-exempt: Pi Package source 协议值，不是显示文案
            (work.resourceChecked ??= {}).configuration = new Date().toISOString();
            if (work.resourceErrors)
                delete work.resourceErrors.configuration;
            this.emit();
            return work.config;
        }
        catch (error) {
            (work.resourceErrors ??= {}).configuration = errorText(error);
            throw error;
        }
        finally {
            work.resourceLoading.configuration = false;
            this.emit();
        }
    }
    async loadPackages(id) { const work = this.getWork(id); (work.resourceLoading ??= {}).packages = true; this.emit(); try {
        const value = await this.request(`works/${part(id)}/packages`);
        if (!Array.isArray(value.packages))
            throw failure('INVALID_RESPONSE', 'd.error.packageListingIncomplete');
        (work.resourceChecked ??= {}).packages = new Date().toISOString();
        work.packageEntries = value.packages;
        delete work.resourceErrors?.packages;
    }
    catch (error) {
        (work.resourceErrors ??= {}).packages = errorText(error);
        throw error;
    }
    finally {
        work.resourceLoading.packages = false;
        this.emit();
    } }
    requestPage(id, serviceName = '') { return this.requests.get(`${id}:${serviceName}`); }
    async loadRequestPresence(id, serviceName, explicit = false) {
        const key = `${id}:${serviceName}`, epoch = this.epoch, version = this.interactionVersion;
        const state = this.requestPresence.get(key) ?? { confirmed: false, loading: false, hasRecords: false, error: '' };
        if (state.loading)
            return;
        this.requestPresence.set(key, state);
        state.loading = true;
        try {
            const { value } = await this.readMetadata(`works/${part(id)}/agent-requests?${new URLSearchParams({ serviceName, limit: '1' })}`, explicit);
            if (epoch !== this.epoch || version !== this.interactionVersion)
                return;
            if (!Array.isArray(value.items) || value.items.some((r) => r.source?.kind !== 'service' || r.source.serviceName !== serviceName))
                throw failure('INVALID_RESPONSE', 'd.error.serviceRequestScope');
            Object.assign(state, { confirmed: true, hasRecords: value.items.length > 0, error: '' });
        }
        catch (error) {
            if (epoch === this.epoch && version === this.interactionVersion && !(error instanceof ObservationStopped) && !(error instanceof ObservationDeferred))
                state.error = errorText(error);
        }
        finally {
            if (epoch === this.epoch) {
                state.loading = false;
                this.emit();
            }
        }
    }
    async loadActiveRun(id, explicit = false) {
        if (this.cancelAndSendCapabilities.get(id) !== 1)
            return;
        const epoch = this.epoch, version = this.interactionVersion, revision = this.activeRevisions.get(id) || 0;
        const state = this.activeRuns.get(id) ?? { confirmed: false, loading: false, visibleLoading: false, run: null, error: '' };
        if (state.loading)
            return;
        this.activeRuns.set(id, state);
        state.loading = true;
        state.visibleLoading = explicit || !state.confirmed;
        if (state.visibleLoading)
            this.emit();
        try {
            const { value } = await this.readMetadata(`works/${part(id)}/runs/active`, explicit);
            if (epoch !== this.epoch || version !== this.interactionVersion || revision !== (this.activeRevisions.get(id) || 0))
                return;
            const raw = value.run;
            if (raw !== null && (!raw?.runId || !raw.sessionId || raw.workId !== id || ![1, 2, 3].includes(raw.state)))
                throw failure('INVALID_RESPONSE', 'd.error.activeRunUnconfirmed');
            Object.assign(state, { confirmed: true, error: '', run: raw === null ? null : this.runRecord(raw, raw.sessionId) });
        }
        catch (error) {
            if (epoch === this.epoch && version === this.interactionVersion && !(error instanceof ObservationStopped) && !(error instanceof ObservationDeferred))
                state.error = errorText(error);
        }
        finally {
            if (epoch === this.epoch) {
                state.loading = false;
                state.visibleLoading = false;
                this.emit();
            }
        }
    }
    async loadRunDetails(id, runId, explicit = true) {
        const epoch = this.epoch;
        await this.supportsHistory(id);
        if (epoch !== this.epoch)
            return;
        const { value } = await this.readMetadata(`works/${part(id)}/runs/${part(runId)}`, explicit), raw = value.run ?? value;
        if (raw.runId !== runId || raw.workId !== id || !raw.sessionId)
            throw failure('INVALID_RESPONSE', 'd.error.runDetailsMismatch');
        if (epoch !== this.epoch)
            return;
        const run = this.runRecord(raw, raw.sessionId);
        if (run.resultRef) {
            run.finalText = await this.readRunResult(id, run);
            if (epoch !== this.epoch)
                return;
        }
        this.runDetails.set(`${id}:${runId}`, run);
        this.emit();
        return run;
    }
    async loadTemporaryCleanups(workId, kind, ref) {
        const key = `${workId}:${kind}:${ref}`, prior = this.temporaryCleanupRequests.get(key);
        if (prior)
            return prior;
        const epoch = this.epoch, state = this.temporaryCleanups.get(key) ?? { loading: false, error: '', items: [], truncated: false };
        this.temporaryCleanups.set(key, state);
        state.loading = true;
        state.error = '';
        this.emit();
        let pending;
        pending = (async () => {
            try {
                const path = kind === 'run' ? `works/${part(workId)}/temporary-cleanups?runId=${part(ref)}` : `works/${part(workId)}/temporary-cleanups/${part(ref)}`;
                const value = await this.request(path);
                const raw = kind === 'run' ? value.items : [value];
                if (!Array.isArray(raw) || raw.length > 256)
                    throw failure('INVALID_RESPONSE', 'd.error.cleanupIncomplete');
                const items = raw.map((item) => {
                    if (!item || item.workId !== workId || typeof item.serviceId !== 'string' || typeof item.runId !== 'string' || typeof item.createOperationId !== 'string' ||
                        kind === 'run' && item.runId !== ref || kind === 'service' && item.serviceId !== ref || !Array.isArray(item.events) || item.events.length > 32)
                        throw failure('INVALID_RESPONSE', 'd.error.cleanupIdentity');
                    return { workId, serviceId: item.serviceId, runId: item.runId, createOperationId: item.createOperationId, ...(typeof item.operationId === 'string' && item.operationId ? { operationId: item.operationId } : {}),
                        state: diagnosticText(item.state), stage: diagnosticText(item.stage), trigger: diagnosticText(item.trigger), ...(diagnosticText(item.errorCode) ? { errorCode: diagnosticText(item.errorCode) } : {}),
                        ...(diagnosticText(item.logState) ? { logState: diagnosticText(item.logState) } : {}), updatedAt: diagnosticText(item.updatedAt), truncated: item.truncated === true,
                        events: item.events.map((event) => ({ at: diagnosticText(event?.at), stage: diagnosticText(event?.stage), outcome: diagnosticText(event?.outcome), ...(diagnosticText(event?.code) ? { code: diagnosticText(event.code) } : {}) })) };
                });
                if (epoch !== this.epoch || this.temporaryCleanups.get(key) !== state)
                    return;
                state.items = items;
                state.truncated = kind === 'run' && value.truncated === true;
            }
            catch (error) {
                if (epoch !== this.epoch || this.temporaryCleanups.get(key) !== state)
                    return;
                if (error instanceof DesktopError && error.httpStatus === 404) {
                    state.items = [];
                    state.truncated = false;
                }
                else {
                    state.error = errorText(error);
                    throw error;
                }
            }
            finally {
                if (this.temporaryCleanupRequests.get(key) === pending)
                    this.temporaryCleanupRequests.delete(key);
                if (epoch === this.epoch && this.temporaryCleanups.get(key) === state) {
                    state.loading = false;
                    this.emit();
                }
            }
        })();
        this.temporaryCleanupRequests.set(key, pending);
        return pending;
    }
    async loadRequests(id, serviceName = '', more = false) {
        const key = `${id}:${serviceName}`, state = this.requests.get(key) ?? { loading: false, error: '', items: [], nextCursor: null }, epoch = this.epoch;
        if (state.loading)
            return;
        this.requests.set(key, state);
        state.loading = true;
        state.error = '';
        this.emit();
        const query = new URLSearchParams({ limit: '25', ...(serviceName ? { serviceName } : {}), ...(more && state.nextCursor ? { cursor: state.nextCursor } : {}) });
        try {
            const { value } = await this.readMetadata(`works/${part(id)}/agent-requests?${query}`, true);
            if (!Array.isArray(value.items))
                throw failure('INVALID_RESPONSE', 'd.error.requestPageIncomplete');
            if (epoch !== this.epoch)
                return;
            state.items = more ? [...state.items, ...value.items] : value.items;
            state.nextCursor = value.nextCursor;
            state.checkedAt = value.checkedAt;
            if (serviceName && !more)
                this.requestPresence.set(key, { confirmed: true, loading: false, hasRecords: value.items.length > 0, error: '' });
        }
        catch (error) {
            if (epoch === this.epoch)
                state.error = errorText(error);
            throw error;
        }
        finally {
            if (epoch === this.epoch) {
                state.loading = false;
                this.emit();
            }
        }
    }
    async loadRequest(id, requestId, more = false, explicit = true) {
        const key = `${id}:${requestId}`, previous = this.requestDetails.get(key), cursor = more ? previous?.evidence?.nextCursor : null;
        if (more && !cursor)
            return previous;
        const epoch = this.epoch, version = this.interactionVersion;
        const query = new URLSearchParams({ limit: '25', ...(cursor ? { cursor } : {}) });
        const { value } = await this.readMetadata(`works/${part(id)}/agent-requests/${part(requestId)}?${query}`, explicit);
        if (value.request?.requestId !== requestId || !Array.isArray(value.request.runIds) || !Array.isArray(value.evidence?.items))
            throw failure('INVALID_RESPONSE', 'd.error.requestDetailMismatch');
        if (epoch !== this.epoch || version !== this.interactionVersion)
            return;
        if (more) {
            // A delayed evidence page cannot confirm status or replace newer request facts.
            const current = this.requestDetails.get(key);
            if (!current)
                return;
            const seen = new Set(current.evidence.items.map((item) => item.evidenceId)), items = [...current.evidence.items];
            for (const item of value.evidence.items)
                if (!seen.has(item.evidenceId)) {
                    seen.add(item.evidenceId);
                    items.push(item);
                }
            const merged = { ...current, evidence: { ...current.evidence, items, nextCursor: value.evidence.nextCursor } };
            this.requestDetails.set(key, merged);
            this.emit();
            return merged;
        }
        // A status refresh preserves evidence pages the user has already read.
        if (!explicit && previous && previous.evidence.items.length > value.evidence.items.length)
            value.evidence = previous.evidence;
        this.requestDetails.set(key, value);
        this.requestReadErrors.delete(key);
        const cancellation = this.requestCancellations.get(key);
        if (cancellation?.phase === 'accepted')
            cancellation.error = '';
        const replies = this.requestResponses.get(key);
        if (replies) {
            replies.runs = replies.runs.filter(run => value.request.runIds.includes(run.id));
            replies.errors = value.request.runIds.flatMap((runId) => replies.errorsByRun[runId] ? [replies.errorsByRun[runId]] : []);
        }
        if (["completed", "failed", "cancelled", "needs_attention"].includes(value.request.state))
            this.cancellingRequests.delete(key);
        for (const [pageKey, page] of this.requests)
            if (pageKey.startsWith(`${id}:`)) {
                page.items = page.items.map(r => r.requestId === requestId ? value.request : r);
            }
        this.emit();
        void this.loadRequestResponses(id, requestId, value.request.runIds, explicit);
        return value;
    }
    async loadRequestResponses(id, requestId, runIds, explicit) {
        const key = `${id}:${requestId}`, epoch = this.epoch, version = this.interactionVersion;
        const state = this.requestResponses.get(key) ?? { loading: false, visibleLoading: false, runs: [], errors: [], checked: {}, errorsByRun: {} };
        if (state.loading)
            return;
        this.requestResponses.set(key, state);
        state.loading = true;
        state.visibleLoading = explicit && runIds.length > 0;
        if (state.visibleLoading)
            this.emit();
        const results = await Promise.allSettled(runIds.map(runId => this.loadRunDetails(id, runId, explicit)));
        if (epoch !== this.epoch)
            return;
        state.loading = false;
        state.visibleLoading = false;
        if (version !== this.interactionVersion)
            return;
        const currentIds = this.requestDetails.get(key)?.request.runIds;
        const allowed = new Set(currentIds ?? runIds), prior = new Map(state.runs.map(run => [run.id, run]));
        results.forEach((result, index) => {
            const runId = runIds[index];
            if (!allowed.has(runId))
                return;
            if (result.status === 'fulfilled' && result.value) {
                prior.set(runId, result.value);
                state.checked[runId] = new Date().toISOString();
                delete state.errorsByRun[runId];
            }
            else if (result.status === 'rejected')
                state.errorsByRun[runId] = t('d.error.runReplyRefreshFailed', { runId, state: t(prior.has(runId) ? 'd.error.replyRetained' : 'd.error.replyUnconfirmed'), detail: errorText(result.reason) });
        });
        state.runs = [...allowed].flatMap(runId => prior.has(runId) ? [prior.get(runId)] : []);
        state.errors = [...allowed].flatMap(runId => state.errorsByRun[runId] ? [state.errorsByRun[runId]] : []);
        this.emit();
        if (currentIds && (currentIds.length !== runIds.length || currentIds.some(runId => !runIds.includes(runId))))
            void this.loadRequestResponses(id, requestId, currentIds, explicit);
    }
    requestCancellation(id, requestId) { return this.requestCancellations.get(`${id}:${requestId}`); }
    async cancelRequest(id, requestId) {
        this.assertCoreReady();
        const key = `${id}:${requestId}`, epoch = this.epoch;
        if (this.requestCancellations.has(key))
            throw failure('REQUEST_CANCEL_SUBMITTED', 'd.error.cancellationSubmitted');
        const cancellation = { phase: 'pending', error: '' };
        this.requestCancellations.set(key, cancellation);
        this.cancellingRequests.add(key);
        this.emit();
        let value;
        try {
            value = await this.request(`works/${part(id)}/agent-requests/${part(requestId)}/cancel`, 'POST', {});
            if (value.requestId !== requestId)
                throw failure('RESULT_UNKNOWN', 'd.error.cancellationReceipt');
            if (epoch !== this.epoch)
                throw failure('CONNECTION_CHANGED', 'd.error.coreAccountChanged');
            cancellation.phase = 'accepted';
            this.emit();
        }
        catch (error) {
            if (epoch === this.epoch) {
                const status = error.httpStatus;
                if (status && status >= 400 && status < 500) {
                    this.requestCancellations.delete(key);
                    this.cancellingRequests.delete(key);
                }
                else {
                    cancellation.phase = 'unknown';
                    cancellation.error = errorText(error);
                }
                this.emit();
            }
            throw error;
        }
        // Acceptance belongs to this original request, not to a later observation.
        // A failed read or stale running state must never release the cancel lock.
        try {
            await this.loadRequest(id, requestId);
        }
        catch (error) {
            if (epoch === this.epoch) {
                cancellation.error = errorText(error);
                this.emit();
            }
        }
        return value;
    }
    async retryRequest(id, requestId) {
        this.assertCoreReady();
        const original = await this.loadRequest(id, requestId);
        if (!original)
            throw failure('CONNECTION_CHANGED', 'd.error.originalRequestPreviousView');
        if (original.request.disposition !== 'live' || !['failed', 'cancelled', 'needs_attention'].includes(original.request.state))
            throw failure('REQUEST_RETRY_NOT_ALLOWED', 'd.error.retryNotAllowed');
        const key = `${id}:${requestId}`, epoch = this.epoch;
        if (this.requestRetries.get(key)?.unknown)
            throw failure('RESULT_UNKNOWN', 'd.error.retryUnknown');
        const intent = { submissionKey: randomUUID(), error: '', unknown: true };
        this.requestRetries.set(key, intent);
        this.emit();
        try {
            const value = await this.request(`works/${part(id)}/agent-requests/${part(requestId)}/retry`, 'POST', { submissionKey: intent.submissionKey });
            if (epoch !== this.epoch)
                throw failure('CONNECTION_CHANGED', 'd.error.retryIdentity');
            if (value.retryOf !== requestId || typeof value.requestId !== 'string' || value.requestId === requestId)
                throw failure('INVALID_RESPONSE', 'd.error.retryReceipt');
            if (this.requestRetries.get(key) === intent)
                this.requestRetries.delete(key);
            this.emit();
            return value;
        }
        catch (error) {
            if (epoch === this.epoch && this.requestRetries.get(key) === intent) {
                intent.error = errorText(error);
                if (!['RESULT_UNKNOWN', 'INVALID_RESPONSE', 'CORE_UNAVAILABLE', 'RUNTIME_UNAVAILABLE', 'REQUEST_TIMEOUT'].includes(error.code))
                    this.requestRetries.delete(key);
                this.emit();
            }
            throw error;
        }
    }
    async checkRequestRetry(id, requestId) {
        const key = `${id}:${requestId}`, intent = this.requestRetries.get(key), epoch = this.epoch, version = this.interactionVersion;
        if (!intent?.unknown)
            return;
        try {
            const { value } = await this.readMetadata(`works/${part(id)}/agent-requests/${part(requestId)}/retry-submission?submissionKey=${part(intent.submissionKey)}`, true);
            if (epoch !== this.epoch || version !== this.interactionVersion || this.requestRetries.get(key) !== intent)
                return;
            if (value.workId !== id || value.requestId !== requestId || value.submissionKey !== intent.submissionKey ||
                !['accepted', 'not-found'].includes(value.status) || value.status === 'not-found' && value.request !== null ||
                value.status === 'accepted' && (!value.request || value.request.retryOf !== requestId || typeof value.request.requestId !== 'string' || value.request.requestId === requestId))
                throw failure('INVALID_RESPONSE', 'd.error.retryLookupMismatch');
            if (value.status === 'accepted') {
                this.requestRetries.delete(key);
                this.emit();
                return value.request;
            }
            intent.error = localizedText('d.error.retryUnknownNoMapping');
            this.emit();
        }
        catch (error) {
            if (epoch === this.epoch && this.requestRetries.get(key) === intent) {
                intent.error = localizedText('d.error.retryUnknownDetail', { detail: errorText(error) });
                this.emit();
            }
            throw error;
        }
    }
    runRecord(raw, sessionId) { return { id: raw.runId, sessionId, status: runStates[raw.state] ?? 'interrupted', cursor: 0, resultRef: raw.resultRef, created: raw.acceptedAt ?? '', finished: raw.finishedAt, finalText: raw.finalText, error: raw.error?.message, executionError: raw.error?.message, errorCode: typeof raw.error?.code === 'string' ? raw.error.code : undefined, errorRetryable: typeof raw.error?.retryable === 'boolean' ? raw.error.retryable : undefined, actualModel: raw.actualModel ?? null, thinkingLevel: raw.thinkingLevel === undefined ? "off" : raw.thinkingLevel, thinkingProfile: raw.thinkingProfile, source: raw.source, adoptedExperienceVersion: raw.adoptedExperienceVersion }; }
    modelSelection(id, sessionId) {
        const key = `${id}:${sessionId}`;
        let state = this.modelSelections.get(key);
        if (!state) {
            const session = this.getWork(id)?.sessions.find(s => s.id === sessionId);
            state = { phase: 'clean', ref: session?.modelPreference?.modelRef ?? null, thinking: session?.thinkingLevel === undefined ? (sessionId ? 'off' : this.models.get(id)?.defaultModel?.defaultThinkingLevel ?? (this.models.get(id)?.defaultModel?.thinkingAvailability === 'unknown' ? null : 'off')) : session.thinkingLevel, profile: session?.thinkingProfile, error: '', revision: 0 };
            this.modelSelections.set(key, state);
        }
        return state;
    }
    modelReady(id, sessionId) {
        const catalog = this.models.get(id), session = this.getWork(id)?.sessions.find(s => s.id === sessionId);
        const pair = this.modelSelection(id, sessionId), selected = pair.ref === null ? catalog?.defaultModel : catalog?.models.find(m => m.modelRef === pair.ref);
        return (!session?.chatAvailability || session.chatAvailability === "available") && !pair.needsThinkingConfirmation && (pair.profile ? !!selected?.compatibleThinkingProfiles?.some(p => p.profile === pair.profile && pair.thinking !== null && p.levels.includes(pair.thinking)) || session?.thinkingProfile === pair.profile && session.thinkingLevel === pair.thinking && session.modelPreference?.modelRef === pair.ref && session.modelPreference?.availability === 'available' : selected?.thinkingAvailability === 'unknown' ? pair.thinking === null : pair.thinking !== null && ((this.chatCapabilities.get(id) ?? 0) < 1 || !selected?.thinkingLevels || selected.thinkingLevels.includes(pair.thinking))) && !!catalog?.confirmed && !catalog.error && (this.modelSelection(id, sessionId).ref === null ? !!catalog.defaultModel : catalog.models.some(m => m.modelRef === this.modelSelection(id, sessionId).ref)) && !this.chatSubmissions.has(id) && (this.modelSelection(id, sessionId).phase === 'clean' || !sessionId && this.modelSelection(id, sessionId).phase === 'dirty')
            && (!session?.modelPreference || session.modelPreference.availability === 'available');
    }
    async loadModels(id) {
        const epoch = this.epoch, state = { loading: true, confirmed: false, error: '', models: [], ...this.models.get(id) };
        state.loading = true;
        this.models.set(id, state);
        this.emit();
        try {
            try {
                const capabilities = await this.request(`works/${part(id)}/chat-capabilities`);
                if (epoch !== this.epoch)
                    return;
                this.chatCapabilities.set(id, capabilities.contractVersion === 4 ? 4 : capabilities.contractVersion === 3 ? 3 : capabilities.contractVersion === 2 ? 2 : capabilities.contractVersion === 1 ? 1 : 0);
                this.cancelAndSendCapabilities.set(id, capabilities.cancelAndSendContractVersion === 1 ? 1 : 0);
                if (this.visibleWorkId === id && this.visibleChat)
                    void this.loadActiveRun(id, true);
            }
            catch (error) {
                if (error.code === 'CONNECTION_CHANGED')
                    throw error;
                if (epoch !== this.epoch)
                    return;
                this.chatCapabilities.set(id, 0);
                if (!this.cancelAndSendCapabilities.has(id))
                    this.cancelAndSendCapabilities.set(id, 0);
            }
            const value = await this.request(`works/${part(id)}/${(this.chatCapabilities.get(id) ?? 0) >= 1 ? 'chat-models' : 'models'}`);
            if (value.availability === 'unavailable')
                throw failure('MODEL_LIST_UNAVAILABLE', 'd.error.modelsUnconfirmed');
            if (!Array.isArray(value.models) || !value.defaultModel && value.contractVersion !== 2 && value.contractVersion !== 3 && value.contractVersion !== 4)
                throw failure('INVALID_RESPONSE', 'd.error.modelListIncomplete');
            if (epoch !== this.epoch)
                return;
            Object.assign(state, { confirmed: true, models: value.models, defaultModel: value.defaultModel ?? undefined, defaultUnavailableReason: value.defaultUnavailableReason, unavailableModels: value.unavailableModels, checkedAt: value.checkedAt, error: '' });
            await this.loadCommands(id);
            const draft = this.modelSelections.get(`${id}:`);
            if (draft && !draft.revision && state.defaultModel)
                draft.thinking = state.defaultModel.defaultThinkingLevel === undefined ? 'off' : state.defaultModel.defaultThinkingLevel;
            const selected = this.chatSelection?.startsWith(`${id}:`) ? this.chatSelection.slice(id.length + 1) : '';
            if (selected)
                await this.readSessionOptions(id, selected);
        }
        catch (error) {
            if (epoch === this.epoch)
                state.error = errorText(error);
            throw error;
        }
        finally {
            if (epoch === this.epoch) {
                state.loading = false;
                this.emit();
                if (!state.error)
                    void this.refreshImageCapabilities(id);
            }
        }
    }
    selectModel(id, sessionId, ref) {
        const state = this.modelSelection(id, sessionId);
        if (state.phase === 'unknown')
            throw failure('MODEL_NOT_CONFIRMED', 'd.error.checkSessionModel');
        if (state.ref === ref)
            return;
        const previousProfile = state.profile;
        state.ref = ref;
        const catalog = this.models.get(id), model = ref === null ? catalog?.defaultModel : catalog?.models.find(m => m.modelRef === ref);
        if (previousProfile) {
            const saved = this.getWork(id)?.sessions.find(s => s.id === sessionId);
            if (state.phase !== 'saving' && saved?.modelPreference?.modelRef === ref && saved.modelPreference.availability === 'available' && saved.thinkingProfile === previousProfile && saved.thinkingLevel === state.thinking) {
                state.needsThinkingConfirmation = false;
                state.error = '';
                state.phase = 'clean';
                state.revision++;
                this.emit();
                return;
            }
            state.needsThinkingConfirmation = true;
            state.error = localizedText('d.error.compatibleThinkingUnconfirmed');
            if (state.phase !== 'saving')
                state.phase = 'dirty';
            state.revision++;
            this.emit();
            return;
        }
        state.profile = undefined;
        state.needsThinkingConfirmation = false;
        if (model?.thinkingAvailability === 'unknown') {
            if (state.thinking !== null) {
                if (!sessionId && !state.revision)
                    state.thinking = null;
                else {
                    state.needsThinkingConfirmation = true;
                    state.error = localizedText('d.error.thinkingUnconfirmed');
                    if (state.phase !== 'saving')
                        state.phase = 'dirty';
                    state.revision++;
                    this.emit();
                    return;
                }
            }
        }
        else if (model?.thinkingLevels && (state.thinking === null || !model.thinkingLevels.includes(state.thinking))) {
            state.thinking = model.defaultThinkingLevel ?? 'off';
            state.error = localizedText('d.error.thinkingAdjusted');
        }
        else
            state.error = '';
        if (state.phase !== 'saving')
            state.phase = 'dirty';
        state.revision++;
        this.emit();
        if (sessionId)
            void this.saveModel(id, sessionId).catch(() => undefined);
    }
    selectThinking(id, sessionId, thinking, profile) {
        const state = this.modelSelection(id, sessionId);
        if (state.phase === 'unknown')
            throw failure('MODEL_NOT_CONFIRMED', 'd.error.checkOriginalSettings');
        const catalog = this.models.get(id), model = state.ref === null ? catalog?.defaultModel : catalog?.models.find(m => m.modelRef === state.ref);
        if ((this.chatCapabilities.get(id) ?? 0) < 1 || !(profile ? (this.chatCapabilities.get(id) ?? 0) >= 4 && thinking !== null && model?.compatibleThinkingProfiles?.some(p => p.profile === profile && p.levels.includes(thinking)) : thinking === null ? model?.thinkingAvailability === 'unknown' : model?.thinkingLevels?.includes(thinking)))
            throw failure('THINKING_LEVEL_UNSUPPORTED', 'd.error.chooseThinking');
        state.thinking = thinking;
        state.profile = profile;
        state.needsThinkingConfirmation = false;
        if (state.phase !== 'saving')
            state.phase = 'dirty';
        state.error = '';
        state.revision++;
        this.emit();
        if (sessionId)
            void this.saveModel(id, sessionId).catch(() => undefined);
    }
    confirmSessionModel(id, session, raw, version = this.sessionVersions.get(id) || 0) {
        if (version !== (this.sessionVersions.get(id) || 0))
            return;
        if (!raw || raw.sessionId !== session.id || raw.workId !== id)
            throw failure('INVALID_RESPONSE', 'd.error.sessionModelOther');
        session.modelPreference = raw.modelPreference ?? null;
        session.thinkingLevel = raw.thinkingLevel === undefined ? 'off' : raw.thinkingLevel;
        session.thinkingProfile = raw.thinkingProfile;
        session.source = raw.source;
        const state = this.modelSelections.get(`${id}:${session.id}`);
        if (state && (state.phase === 'clean')) {
            state.ref = session.modelPreference?.modelRef ?? null;
            state.thinking = session.thinkingLevel === undefined ? 'off' : session.thinkingLevel;
            state.profile = session.thinkingProfile;
            state.needsThinkingConfirmation = false;
            state.phase = 'clean';
            state.error = '';
        }
    }
    async readSessionOptions(id, sessionId) {
        if ((this.chatCapabilities.get(id) ?? 0) < 1)
            return;
        const epoch = this.epoch, version = this.sessionVersions.get(id) || 0;
        try {
            const raw = await this.request(`works/${part(id)}/sessions/${part(sessionId)}/chat-options`);
            if (epoch !== this.epoch || version !== (this.sessionVersions.get(id) || 0) || raw.sessionId !== sessionId)
                return;
            const session = this.getWork(id)?.sessions.find(s => s.id === sessionId);
            if (!session)
                return;
            session.chatAvailability = raw.availability;
            this.confirmSessionModel(id, session, { sessionId, workId: id, modelPreference: { ...raw.model, availability: raw.availability }, thinkingLevel: raw.thinkingLevel, thinkingProfile: raw.thinkingProfile, source: session.source }, version);
            return session.chatAvailability;
        }
        catch { /* The original Session snapshot and any unknown mutation remain authoritative until explicit readback. */ }
    }
    async saveModel(id, sessionId) {
        this.assertCoreReady();
        const key = `${id}:${sessionId}`, state = this.modelSelection(id, sessionId), epoch = this.epoch;
        if (state.needsThinkingConfirmation)
            throw failure('THINKING_LEVEL_UNSUPPORTED', state.profile ? 'd.error.compatibleThinkingUnconfirmed' : 'd.error.thinkingUnconfirmed');
        const pending = this.pairSaves.get(key);
        if (pending)
            return pending;
        if (state.phase !== 'dirty')
            return;
        const catalog = this.models.get(id), model = state.ref === null ? catalog?.defaultModel : catalog?.models.find(m => m.modelRef === state.ref);
        if (!catalog?.confirmed || !model)
            throw failure('MODEL_UNAVAILABLE', 'd.error.chooseModel');
        const revision = state.revision, ref = state.ref, thinking = state.thinking, profile = state.profile;
        state.phase = 'saving';
        this.emit();
        let save;
        save = (async () => {
            try {
                const modern = (this.chatCapabilities.get(id) ?? 0) >= 1;
                const raw = await this.request(`works/${part(id)}/sessions/${part(sessionId)}/${modern ? 'chat-options' : 'model'}`, 'PATCH', modern ? { modelRef: ref, thinkingLevel: thinking, ...((this.chatCapabilities.get(id) ?? 0) >= 4 ? { thinkingProfile: profile ?? null } : {}) } : { modelRef: ref });
                if (epoch !== this.epoch)
                    return;
                if (raw.sessionId !== sessionId || modern && (raw.modelRef !== ref || raw.thinkingLevel !== thinking || (raw.thinkingProfile ?? undefined) !== profile) || !modern && raw.workId !== id)
                    throw failure('INVALID_RESPONSE', 'd.error.sessionSettingsUnconfirmed');
                const session = this.getWork(id)?.sessions.find(s => s.id === sessionId);
                if (session) {
                    if (modern)
                        session.chatAvailability = raw.availability;
                    session.modelPreference = modern ? { ...raw.model, availability: raw.availability } : raw.modelPreference ?? null;
                    session.thinkingLevel = modern ? raw.thinkingLevel : 'off';
                    session.thinkingProfile = modern ? raw.thinkingProfile : undefined;
                }
                this.sessionVersions.set(id, (this.sessionVersions.get(id) || 0) + 1);
                state.confirmedRevision = revision;
                state.phase = state.revision === revision ? 'clean' : 'dirty';
            }
            catch (error) {
                if (epoch === this.epoch) {
                    const code = error.code;
                    state.phase = ['RESULT_UNKNOWN', 'INVALID_RESPONSE', 'CORE_UNAVAILABLE', 'REQUEST_TIMEOUT', 'RUNTIME_UNAVAILABLE', 'CONNECTION_CHANGED'].includes(code) ? 'unknown' : 'dirty';
                    state.error = state.phase === 'unknown' ? t('d.error.settingsUnconfirmed') : errorText(error);
                }
                throw error;
            }
            finally {
                if (this.pairSaves.get(key) === save)
                    this.pairSaves.delete(key);
                if (epoch === this.epoch) {
                    this.emit();
                    if (state.phase === 'dirty' && !state.needsThinkingConfirmation && state.confirmedRevision === revision && this.chatSelection === key)
                        void this.saveModel(id, sessionId).catch(() => undefined);
                }
            }
        })();
        this.pairSaves.set(key, save);
        return save;
    }
    async checkSessionModel(id, sessionId) {
        if (this.pairSaves.has(`${id}:${sessionId}`))
            return;
        const epoch = this.epoch, state = this.modelSelection(id, sessionId);
        if ((this.chatCapabilities.get(id) ?? 0) >= 1) {
            const raw = await this.request(`works/${part(id)}/sessions/${part(sessionId)}/chat-options`);
            if (epoch !== this.epoch || raw.sessionId !== sessionId)
                return;
            state.ref = raw.modelRef;
            state.thinking = raw.thinkingLevel;
            state.profile = raw.thinkingProfile;
            state.needsThinkingConfirmation = false;
            state.phase = 'clean';
            state.error = '';
            const session = this.getWork(id)?.sessions.find(s => s.id === sessionId);
            if (session) {
                session.chatAvailability = raw.availability;
                session.modelPreference = { ...raw.model, availability: raw.availability };
                session.thinkingLevel = raw.thinkingLevel;
                session.thinkingProfile = raw.thinkingProfile;
            }
        }
        else {
            const raw = await this.supportsHistory(id) ? await this.historyPage(id, sessionId, new URLSearchParams({ limit: '1' })) : await this.request(`works/${part(id)}/sessions/${part(sessionId)}`);
            if (epoch !== this.epoch)
                return;
            state.phase = 'clean';
            const session = this.getWork(id)?.sessions.find(s => s.id === sessionId);
            if (session)
                this.confirmSessionModel(id, session, raw.session);
        }
        this.emit();
    }
    async loadCommands(id) {
        const state = { loading: true, confirmed: false, error: '', items: [], ...this.commands.get(id) };
        state.loading = true;
        this.commands.set(id, state);
        this.emit();
        try {
            if ((this.chatCapabilities.get(id) ?? 0) < 1)
                throw failure('CHAT_OPTIONS_UNSUPPORTED', 'd.error.chatControlsUnsupported');
            const value = await this.request(`works/${part(id)}/commands`);
            if (value.contractVersion !== 1 || !Array.isArray(value.commands))
                throw failure('INVALID_RESPONSE', 'd.error.commandDirectoryIncomplete');
            Object.assign(state, { items: value.commands, confirmed: true, error: '', checkedAt: value.checkedAt });
        }
        catch (error) {
            state.error = errorText(error);
        }
        finally {
            state.loading = false;
            this.emit();
        }
    }
    async defaultSession(id) {
        const work = this.getWork(id), epoch = this.epoch;
        if (!work)
            return '';
        const candidates = work.sessions.filter(session => session.source?.kind !== 'service');
        const ordered = candidates.length ? [candidates[0], ...candidates.slice(1).reverse()] : [];
        if ((this.chatCapabilities.get(id) ?? 0) >= 1)
            for (const session of ordered) {
                // Recheck live admission: persisted model availability is only history metadata.
                session.chatAvailability = "unconfirmed";
                const availability = await this.readSessionOptions(id, session.id);
                if (epoch !== this.epoch || this.getWork(id) !== work)
                    return '';
                if (availability === 'available')
                    return session.id;
            }
        return candidates[0]?.id ?? '';
    }
    async loadSessions(id) {
        const work = this.getWork(id), version = this.sessionVersions.get(id) || 0;
        (work.resourceLoading ??= {}).agent = true;
        this.emit();
        try {
            const value = await this.request(`works/${part(id)}/sessions`);
            if (!Array.isArray(value.sessions))
                throw failure('INVALID_RESPONSE', 'd.error.sessionListingIncomplete');
            (work.resourceChecked ??= {}).agent = new Date().toISOString();
            const existing = new Map(work.sessions.map(session => [session.id, session]));
            work.sessions = value.sessions.map((raw) => { const saved = existing.get(raw.sessionId), session = saved ?? { id: raw.sessionId, title: raw.title ?? t('d.session.defaultTitle', { id: raw.sessionId }), messages: [], runs: [] }; session.title = raw.title ?? t('d.session.defaultTitle', { id: raw.sessionId }); if (!saved || version === (this.sessionVersions.get(id) || 0)) {
                session.modelPreference = raw.modelPreference ?? null;
                session.thinkingLevel = raw.thinkingLevel === undefined ? 'off' : raw.thinkingLevel;
                session.thinkingProfile = raw.thinkingProfile;
                session.source = raw.source;
            } return session; });
            if (version !== (this.sessionVersions.get(id) || 0))
                for (const previous of existing.values()) {
                    const current = work.sessions.find(s => s.id === previous.id);
                    if (!current)
                        work.sessions.push(previous);
                    else {
                        current.modelPreference = previous.modelPreference;
                        current.thinkingLevel = previous.thinkingLevel;
                        current.thinkingProfile = previous.thinkingProfile;
                    }
                }
            if (work.sessions[0] && !this.streams.has(id))
                await this.loadSession(id, work.sessions[0].id);
            if (work.resourceErrors)
                delete work.resourceErrors.agent;
            this.emit();
        }
        catch (error) {
            (work.resourceErrors ??= {}).agent = errorText(error);
            throw error;
        }
        finally {
            work.resourceLoading.agent = false;
            this.emit();
        }
    }
    async loadSession(id, sessionId) {
        const work = this.getWork(id);
        if (work?.run?.sessionId === sessionId && ['accepted', 'running', 'cancelling'].includes(work.run.status) && this.streams.has(id))
            return;
        const epoch = this.epoch, target = work?.sessions.find(s => s.id === sessionId);
        if (!target)
            return;
        target.loading = true;
        target.error = '';
        this.emit();
        try {
            const supported = await this.supportsHistory(id);
            if (epoch !== this.epoch)
                return;
            if (supported) {
                await this.loadPagedSession(id, sessionId);
                if (epoch === this.epoch)
                    await this.readSessionOptions(id, sessionId);
                return;
            }
            return await this.loadLegacySession(id, sessionId);
        }
        catch (error) {
            if (epoch !== this.epoch)
                return;
            target.error = errorText(error);
            throw error;
        }
        finally {
            if (epoch === this.epoch) {
                target.loading = false;
                this.emit();
            }
        }
    }
    async loadLegacySession(id, sessionId) {
        const work = this.getWork(id);
        if (work?.run?.sessionId === sessionId && ['accepted', 'running', 'cancelling'].includes(work.run.status) && this.streams.has(id))
            return;
        const version = this.sessionVersions.get(id) || 0;
        const target = this.getWork(id)?.sessions.find(s => s.id === sessionId);
        if (target) {
            target.loading = true;
            target.error = '';
            this.emit();
        }
        const imageCheck = this.loadImageCapabilities(id), profile = this.imageCapabilities.get(id)?.value ? '?imageProfile=chat-images-v1' : '', epoch = this.epoch;
        let value;
        try {
            value = await this.request(`works/${part(id)}/sessions/${part(sessionId)}${profile}`);
        }
        catch (error) {
            if (target)
                target.error = errorText(error);
            throw error;
        }
        finally {
            if (target) {
                target.loading = false;
                this.emit();
            }
        }
        const session = this.getWork(id)?.sessions.find(s => s.id === sessionId);
        if (session) {
            this.confirmSessionModel(id, session, value.session, version);
            session.runs = (value.runs ?? []).map((run) => this.runRecord(run, sessionId));
        }
        if (session) {
            session.messages = historyMessages(value.messages ?? [], session.messages);
            session.checkedAt = new Date().toISOString();
            session.imageProfile = !!profile;
            const active = (value.runs ?? []).find((run) => [1, 2, 3].includes(run.state));
            const restore = active && work && (!work.run || !['accepted', 'running', 'cancelling'].includes(work.run.status));
            if (restore) {
                work.run = this.runRecord(active, sessionId);
                // Replay the active Run's retained events once; completed SDK turns of
                // that Run may already be in history. Keep its original user message.
                session.messages = session.messages.filter(m => m.runId !== work.run.id || m.role === 'user');
                this.emit();
                void this.resumeRun(id);
            }
            await this.readSessionOptions(id, sessionId);
        }
        this.emit();
        if (!profile)
            void imageCheck.then(() => { if (epoch === this.epoch && this.chatSelection === `${id}:${sessionId}` && this.imageCapabilities.get(id)?.value)
                void this.loadSession(id, sessionId).catch(() => undefined); });
    }
    serviceEntryKeys(workId) {
        return new Set([...this.entries.keys(), ...this.entryPromises.keys(), ...this.entryErrors.keys()].filter(key => key.startsWith(`${workId}:`)));
    }
    revokeServiceEntry(key, reason = '') {
        this.entryVersions.set(key, (this.entryVersions.get(key) || 0) + 1);
        this.entries.delete(key);
        this.entryChecks.delete(key);
        // Cache invalidation is not authorization recovery. A tuple denial survives
        // stopped/removed metadata until a fresh explicit matching entry succeeds.
        if (reason)
            this.entryErrors.set(key, reason);
    }
    revokeWorkEntries(workId, reason = '') { for (const key of this.serviceEntryKeys(workId))
        this.revokeServiceEntry(key, reason); }
    serviceEntryAdmitted(workId, serviceId, port) {
        const work = this.getWork(workId), service = work?.services.find(service => service.id === serviceId);
        return !!work && this.project(work).usable && !!service?.enabled && service.observed === 'Ready' && service.ports.includes(port);
    }
    serviceEntryUrl(workId, serviceId, port) {
        const work = this.getWork(workId);
        return work && this.project(work).retainWorkspace && !this.serviceEntryError(workId, serviceId, port) ? this.entries.get(`${workId}:${serviceId}:${port}`)?.entryUrl ?? null : null;
    }
    canRetainServiceFrame(workId, serviceId, port) {
        const service = this.getWork(workId)?.services.find(item => item.id === serviceId);
        return !!service?.enabled && ['Ready', 'Starting'].includes(service.observed) && service.ports.includes(port)
            && !!this.serviceEntryUrl(workId, serviceId, port) && this.serviceEmbed(workId, serviceId, port) !== 'denied';
    }
    serviceEntryError(workId, serviceId, port) {
        const key = `${workId}:${serviceId}:${port}`, denial = this.serviceDenials.get(workId);
        return this.entryErrors.get(key) || (denial && this.entryServiceGrants.get(key) !== denial.version ? denial.reason : '');
    }
    serviceEntryPending(workId, serviceId, port) { return this.entryPromises.has(`${workId}:${serviceId}:${port}`); }
    servicePreviewUnconfirmed(workId, serviceId, port) { const entry = this.entries.get(`${workId}:${serviceId}:${port}`); return entry?.checked && entry.embed === 'unknown'; }
    ensureServiceEntry(workId, serviceId, port, retry = false) {
        const key = `${workId}:${serviceId}:${port}`;
        const old = this.entryPromises.get(key);
        if (old)
            return old;
        if (this.entries.has(key) || !retry && !!this.serviceEntryError(workId, serviceId, port) || !this.serviceEntryAdmitted(workId, serviceId, port))
            return Promise.resolve();
        const epoch = this.epoch, version = this.entryVersions.get(key) || 0, serviceVersion = this.serviceDenials.get(workId)?.version || 0;
        const current = () => epoch === this.epoch && version === (this.entryVersions.get(key) || 0) && serviceVersion === (this.serviceDenials.get(workId)?.version || 0);
        let pending;
        pending = (async () => {
            try {
                const value = await this.request('service-entries', 'POST', { workId, serviceId, port });
                if (!current() || !this.serviceEntryAdmitted(workId, serviceId, port))
                    return;
                if (value.workId !== undefined && value.workId !== workId || value.serviceId !== undefined && value.serviceId !== serviceId || value.port !== undefined && value.port !== port || !value.entryId || !value.entryUrl || !value.origin)
                    throw failure('INVALID_RESPONSE', 'd.error.entryMismatch');
                this.entries.set(key, value);
                this.entryErrors.delete(key);
                this.entryServiceGrants.set(key, serviceVersion);
                void this.serviceFrameLoaded(workId, serviceId, port).catch(error => {
                    if (current() && this.entries.get(key) === value) {
                        value.checked = true;
                        value.checkError = errorText(error);
                        this.emit();
                    }
                });
            }
            catch (error) {
                if (current()) {
                    if (error instanceof DesktopError && [401, 403].includes(error.httpStatus || 0))
                        this.revokeServiceEntry(key, errorText(error));
                    else
                        this.entryErrors.set(key, errorText(error));
                }
                throw error;
            }
            finally {
                if (this.entryPromises.get(key) === pending)
                    this.entryPromises.delete(key);
                if (epoch === this.epoch)
                    this.emit();
            }
        })();
        this.entryPromises.set(key, pending);
        this.emit();
        return pending;
    }
    serviceFrameLoaded(workId, serviceId, port) {
        const key = `${workId}:${serviceId}:${port}`;
        const old = this.entryChecks.get(key);
        if (old)
            return old;
        const pending = this.probeServiceFrame(workId, serviceId, port).finally(() => { if (this.entryChecks.get(key) === pending)
            this.entryChecks.delete(key); });
        this.entryChecks.set(key, pending);
        return pending;
    }
    async probeServiceFrame(workId, serviceId, port) {
        const key = `${workId}:${serviceId}:${port}`;
        const entry = this.entries.get(key);
        if (!entry)
            return;
        const epoch = this.epoch, version = this.entryVersions.get(key) || 0;
        const current = () => epoch === this.epoch && this.entries.get(key) === entry && version === (this.entryVersions.get(key) || 0);
        try {
            // The first iframe load can be ticket bootstrap, before the application response.
            for (let attempt = 0; attempt < 12 && current(); attempt++) {
                const value = await this.request(`service-entries/${part(entry.entryId)}`);
                if (!current())
                    return;
                if (value.workId !== undefined && value.workId !== workId || value.serviceId !== undefined && value.serviceId !== serviceId || value.port !== undefined && value.port !== port)
                    throw failure('SERVICE_IDENTITY_CHANGED', 'd.error.entryIdentityChanged', undefined, 403);
                entry.embed = value.embed === 'blocked' ? 'denied' : value.embed;
                entry.entryUrl = entry.origin + (entry.basePath ?? '/');
                entry.checkError = '';
                this.emit();
                if (value.embed !== 'unknown') {
                    entry.checked = true;
                    this.emit();
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, 250));
            }
            if (current()) {
                entry.checked = true;
                this.emit();
            }
        }
        catch (error) {
            if (current()) {
                if (error instanceof DesktopError && [401, 403, 404, 410].includes(error.httpStatus || 0))
                    this.revokeServiceEntry(key, errorText(error));
                else {
                    entry.checked = true;
                    entry.checkError = errorText(error);
                }
                this.emit();
            }
            throw error;
        }
    }
    serviceEmbed(workId, serviceId, port) { return this.entries.get(`${workId}:${serviceId}:${port}`)?.embed; }
    servicePreviewError(workId, serviceId, port) { return this.entries.get(`${workId}:${serviceId}:${port}`)?.checkError || ''; }
    async directServiceURL(workId, serviceId, port) {
        const key = `${workId}:${serviceId}:${port}`, epoch = this.epoch, version = this.entryVersions.get(key) || 0, serviceVersion = this.serviceDenials.get(workId)?.version || 0;
        const current = () => epoch === this.epoch && version === (this.entryVersions.get(key) || 0) && serviceVersion === (this.serviceDenials.get(workId)?.version || 0);
        if (!this.serviceEntryAdmitted(workId, serviceId, port))
            throw failure('SERVICE_ENTRY_UNAVAILABLE', 'd.error.confirmBeforeOpen');
        try {
            // A new tab needs its own one-use bootstrap ticket, not an iframe's cached ticket.
            const value = await this.request('service-entries', 'POST', { workId, serviceId, port });
            if (!current() || !this.serviceEntryAdmitted(workId, serviceId, port))
                throw failure('CONNECTION_CHANGED', 'd.error.accessChanged');
            if (value.workId !== undefined && value.workId !== workId || value.serviceId !== undefined && value.serviceId !== serviceId || value.port !== undefined && value.port !== port || !value.entryId || !value.entryUrl || !value.origin)
                throw failure('INVALID_RESPONSE', 'd.error.entryMismatch');
            this.entryErrors.delete(key);
            this.entryServiceGrants.set(key, serviceVersion);
            return value.entryUrl;
        }
        catch (error) {
            if (current() && error instanceof DesktopError && [401, 403].includes(error.httpStatus || 0)) {
                this.revokeServiceEntry(key, errorText(error));
                this.emit();
            }
            throw error;
        }
    }
    localLink(workId, serviceId, port) { return `${location.origin}/works/${part(workId)}/services/${part(serviceId)}?port=${port}`; }
    serviceLogs(workId, serviceId) { return this.logStates.get(`${workId}:${serviceId}`); }
    readLogs(workId, serviceId) {
        const key = `${workId}:${serviceId}`, previous = this.logRequests.get(key);
        if (previous)
            return previous;
        const epoch = this.epoch, state = this.logStates.get(key) ?? { loading: false, error: '', checkedAt: '' };
        this.logStates.set(key, state);
        state.loading = true;
        state.error = '';
        let pending;
        pending = (async () => {
            try {
                const value = await this.request(`works/${part(workId)}/services/${part(serviceId)}/logs?tailLines=100`);
                if (epoch !== this.epoch || this.logStates.get(key) !== state)
                    return;
                state.value = value;
                state.checkedAt = new Date().toISOString();
                this.logs.set(key, value);
            }
            catch (error) {
                if (epoch === this.epoch && this.logStates.get(key) === state)
                    state.error = errorText(error);
                throw error;
            }
            finally {
                if (this.logRequests.get(key) === pending)
                    this.logRequests.delete(key);
                if (epoch === this.epoch && this.logStates.get(key) === state) {
                    state.loading = false;
                    this.emit();
                }
            }
        })();
        this.logRequests.set(key, pending);
        this.emit();
        return pending;
    }
    accepted(value, workId, kind, serviceId) {
        if (!value.operationId)
            throw failure('INVALID_RESPONSE', 'd.error.acceptanceNoOperation');
        if (workId && value.workId && value.workId !== workId)
            throw failure('INVALID_RESPONSE', 'd.error.operationOtherWork');
        if (serviceId && value.serviceId && value.serviceId !== serviceId)
            throw failure('INVALID_RESPONSE', 'd.error.operationOtherService');
        const operation = { id: value.operationId, workId: value.workId ?? workId, kind, action: lifecycleAction(kind), state: 'accepted', phase: t('d.operation.accepted'), created: '', updated: '', scope: `${this.state.core.address} · ${this.state.core.account}`, snapshotId: value.snapshotId, serviceId: value.serviceId ?? serviceId, checkedServiceId: serviceId && value.serviceId === serviceId && value.workId === workId ? serviceId : undefined, localRecordSaved: value.localRecordSaved };
        if (operation.action && operation.workId) {
            const sequence = ++this.mutationSequence;
            this.workMutations.set(operation.workId, sequence);
            const work = this.getWork(operation.workId);
            if (work) {
                work.lifecycleIntent = { action: operation.action, operationId: operation.id, sequence, baseVersion: work.controlVersion };
                work.operationId = operation.id;
            }
            if (['stop', 'delete'].includes(operation.action))
                this.revokeWorkEntries(operation.workId);
            this.requireWorkSync(operation.workId);
        }
        if (kind === 'Import Work' && typeof value.name === 'string' && value.name)
            operation.importName = value.name; // i18n-exempt: Operation kind 协议值，app.ts 按英文比较
        this.state.operations.unshift(operation);
        if (operation.snapshotId)
            this.state.snapshots.unshift({ id: operation.snapshotId, operationId: operation.id, workId, status: 'preparing', filename: `${workId}.work`, size: '' });
        this.scheduleOperationPoll();
        this.emit();
        return operation;
    }
    async createWork(name, config, image) {
        this.assertCoreReady();
        const payload = { name };
        if (image)
            payload.baseImage = image;
        if (config.skills !== undefined)
            payload.skills = config.skills;
        if (config.packages !== undefined)
            payload.packages = config.packages.map(p => ({ name: p.name, enabled: p.enabled }));
        if (config.agents !== undefined)
            payload.agentsMd = config.agents;
        if (config.advanced)
            payload.configuration = JSON.parse(config.advanced);
        return this.accepted(await this.request('works', 'POST', payload), '', 'Create Work'); // i18n-exempt: Operation kind 协议值，app.ts 按英文比较
    }
    async lifecycle(id, action) { return this.accepted(await this.request(`works/${part(id)}/${action}`, 'POST'), id, `${action[0].toUpperCase()}${action.slice(1)} Work`); }
    async operateService(id, serviceId, action) { return this.accepted(await this.request(`works/${part(id)}/services/${part(serviceId)}/${action}`, 'POST'), id, `${action} Service`, serviceId); }
    async checkOperation(id, explicit = true, expectedWorkId, expectedKind) {
        let operation = this.getOperation(id);
        const historical = !!operation && !this.operationNeedsAttention(operation);
        let value;
        try {
            value = (await this.readMetadata(`operations/${part(id)}`, explicit)).value;
        }
        catch (error) {
            if (operation && !(error instanceof ObservationStopped) && !(error instanceof ObservationDeferred)) {
                operation.observationError = errorText(error);
                this.emit();
            }
            throw error;
        }
        // A manually entered ID belongs to this Work only after both identities
        // have been confirmed. Do not alter another task's observation on failure.
        if (expectedWorkId && (value.operationId !== id || value.workId !== expectedWorkId))
            throw failure('INVALID_RESPONSE', 'd.error.operationOtherWork');
        const actualKind = typeof value.kind === 'string' ? value.kind : typeof value.type === 'string' ? value.type : '';
        if (expectedKind && (value.operationId !== id || operationKind(actualKind) !== expectedKind))
            throw failure('INVALID_RESPONSE', 'd.error.operationOtherType');
        const rejectMismatch = (key) => {
            const error = failure('INVALID_RESPONSE', key);
            if (operation) {
                operation.observationError = errorText(error);
                this.invalidOperationTargets.add(id);
                this.emit();
            }
            throw error;
        };
        if (value.operationId !== id && value.operationId !== undefined)
            rejectMismatch('d.error.operationMismatch');
        if (operation?.workId && value.workId && operation.workId !== value.workId)
            rejectMismatch('d.error.operationOtherWork');
        if (operation && actualKind && operationKind(operation.kind) && !operationKindMatches(operation.kind, actualKind))
            rejectMismatch('d.error.operationOtherType');
        const reportedService = operationCorrelationId(value.serviceId) ?? operationCorrelationId(value.error?.serviceId) ?? '';
        if (operation?.serviceId && reportedService && operation.serviceId !== reportedService)
            rejectMismatch('d.error.operationOtherService');
        this.invalidOperationTargets.delete(id);
        if (!operation) {
            operation = { id, workId: value.workId || '', kind: value.kind || value.type || 'Operation', state: 'unknown', phase: '', created: '', updated: '', scope: `${this.state.core.address} · ${this.state.core.account}` };
            this.state.operations.push(operation);
        }
        const previousState = operation.state;
        operation.checkedWorkId = value.operationId === id && typeof value.workId === 'string' ? value.workId : undefined;
        operation.checkedKind = value.operationId === id && actualKind ? actualKind : undefined;
        if (!operation.serviceId && reportedService && operation.checkedWorkId === operation.workId && operation.checkedKind && operationKind(operation.checkedKind).startsWith('service:'))
            operation.serviceId = reportedService;
        operation.checkedServiceId = operation.serviceId && operation.checkedWorkId === operation.workId && operation.checkedKind && operationKind(operation.checkedKind).startsWith('service:') ? operation.serviceId : undefined;
        const diagnostic = operationDiagnostic(value.error);
        Object.assign(operation, { workId: value.workId ?? operation.workId, state: value.state, phase: value.packagePhase ?? value.state, created: value.createdAt ?? '', updated: value.updatedAt ?? '', error: diagnostic?.message ?? legacyOperationError(value.error), diagnostic, diagnostics: operationDiagnostics(value.diagnostics), correlationId: operationCorrelationId(value.correlationId) ?? diagnostic?.correlationId, snapshotId: value.result?.snapshotId ?? operation.snapshotId, observationError: undefined });
        delete operation.terminalHint;
        operation.action = lifecycleAction(value.kind || value.type || operation.kind);
        this.retainTerminal(operation);
        const importingUnpublished = operationKind(operation.checkedKind || operation.kind) === 'transfer:import' && operation.state !== 'succeeded';
        if (operation.workId && !importingUnpublished && !(historical && terminalOperation(operation.state)) && (previousState !== operation.state || explicit)) {
            const intent = this.getWork(operation.workId)?.lifecycleIntent;
            // A pre-terminal list read cannot confirm a successful Delete. Rearm
            // exactly on the current Delete's transition to success, never on each
            // later poll or an older operation superseded by a newer intent.
            const terminalDelete = operation.action === 'delete' && operation.state === 'succeeded' && previousState !== 'succeeded' && (!intent || intent.operationId === operation.id);
            this.requireWorkSync(operation.workId, terminalDelete);
        }
        const work = this.getWork(operation.workId);
        if (work)
            this.associateOperations(work);
        if (work && operation.checkedServiceId && previousState !== operation.state && terminalOperation(operation.state))
            void this.loadServices(work.id).catch(() => undefined);
        if (operation.snapshotId)
            await this.fetchSnapshot(operation.snapshotId, explicit).catch(() => undefined);
        this.emit();
        this.scheduleOperationPoll();
        return operation;
    }
    async recoverOperations() {
        const value = await this.request('known-operations');
        for (const record of value.operations ?? [])
            if (!this.state.operations.some(o => o.id === record.operationId)) {
                const kind = typeof record.type === 'string' && record.type ? record.type : 'Operation';
                this.state.operations.push({ id: record.operationId, workId: record.workId ?? '', serviceId: record.serviceId, kind, action: lifecycleAction(kind), state: 'unknown', ...(record.terminal === true ? { terminalHint: { state: terminalOperation(record.terminalState) ? record.terminalState : undefined, checkedAt: record.terminalCheckedAt } } : {}), phase: t('d.lifecycle.checkOriginalPhase'), created: record.recordedAt, updated: '', snapshotId: record.snapshotId, scope: `${this.state.core.address} · ${this.state.core.account}` });
            }
        for (const work of this.state.works)
            this.associateOperations(work);
        this.scheduleOperationPoll();
        this.emit();
    }
    workSynchronizationPending(workId) { return this.workSync.has(workId); }
    finishWorkSync() {
        for (const [id, sync] of this.workSync)
            if (!sync.work && !sync.list) {
                this.workSync.delete(id);
                const work = this.getWork(id), intent = work?.lifecycleIntent;
                const evidence = intent && this.terminalEvidence.get(intent.operationId);
                if (intent && evidence?.generation === intent.sequence && evidence.operation.workId === id && terminalOperation(evidence.operation.state))
                    delete work.lifecycleIntent;
            }
        for (const [id, evidence] of this.terminalEvidence) {
            const work = this.getWork(evidence.operation.workId);
            if (!this.workSync.has(evidence.operation.workId) && work?.lifecycleIntent?.operationId !== id)
                this.terminalEvidence.delete(id);
        }
        for (const work of this.state.works)
            this.associateOperations(work);
        this.flushOperationHides();
    }
    flushOperationHides() {
        const epoch = this.epoch;
        for (const [id, operation] of this.pendingOperationHides) {
            if (operation.workId && this.workSync.has(operation.workId))
                continue;
            this.pendingOperationHides.delete(id);
            void this.request(`known-operations/${part(id)}`, 'DELETE').catch(error => {
                if (epoch !== this.epoch)
                    return;
                // The original record remains available after a failed local hide.
                operation.observationError = errorText(error);
                if (!this.state.operations.some(item => item.id === id))
                    this.state.operations.push(operation);
                this.emit();
            });
        }
    }
    observationTargets() {
        const active = this.state.operations.filter(op => !terminalOperation(op.state) && (!op.terminalHint || this.operationNeedsAttention(op)) && !this.pausedOperations.has(op.id) && !this.invalidOperationTargets.has(op.id));
        const workIds = new Set([...this.workSync].filter(([, sync]) => sync.work).map(([id]) => id));
        for (const op of active)
            if (op.workId)
                workIds.add(op.workId);
        return [
            ...active.map(op => ({ path: `operations/${part(op.id)}`, read: () => this.checkOperation(op.id, false) })),
            ...[...workIds].map(id => ({ path: `works/${part(id)}`, read: () => this.refreshWorkStatus(id, false) })),
            ...([...this.workSync.values()].some(sync => sync.list) ? [{ path: 'works', read: () => this.listWorks(false) }] : []),
        ];
    }
    scheduleOperationPoll() {
        clearTimeout(this.pollTimer);
        this.pollTimer = undefined;
        if (!this.observationVisible || !this.state.signedIn)
            return;
        const now = Date.now(), keys = new Set(), deadlines = [];
        for (const target of this.observationTargets()) {
            const key = this.metadataKey(target.path);
            keys.add(key);
            let record = this.pollTargets.get(key);
            if (!record) {
                record = { pending: false, nextAt: now + 2000 };
                this.pollTargets.set(key, record);
            }
            if (record.pending || this.metadata.paused(key))
                continue;
            deadlines.push(Math.max(record.nextAt, this.metadata.states.get(key)?.nextAt || 0));
        }
        for (const [key, record] of this.pollTargets)
            if (!keys.has(key) && !record.pending)
                this.pollTargets.delete(key);
        if (!deadlines.length)
            return;
        const epoch = this.epoch;
        this.pollTimer = setTimeout(() => { this.pollTimer = undefined; if (epoch === this.epoch)
            void this.pollOperations(false); }, Math.max(1, Math.min(...deadlines) - now));
    }
    async pollOperations(immediate = true) {
        if (!this.observationVisible || !this.state.signedIn)
            return;
        const epoch = this.epoch, pending = [];
        for (const target of this.observationTargets()) {
            const key = this.metadataKey(target.path);
            let record = this.pollTargets.get(key);
            if (!record) {
                record = { pending: false, nextAt: Date.now() };
                this.pollTargets.set(key, record);
            }
            if (record.pending || !this.metadata.canRead(key) || !immediate && record.nextAt > Date.now())
                continue;
            record.pending = true;
            const owned = record;
            const task = target.read().finally(() => {
                if (epoch !== this.epoch || this.pollTargets.get(key) !== owned)
                    return;
                owned.pending = false;
                const readState = this.metadata.states.get(key);
                owned.nextAt = readState?.failures ? readState.nextAt : Date.now() + 2000;
                this.finishWorkSync();
                this.emit();
                this.scheduleOperationPoll();
            });
            pending.push(task);
        }
        // Completion of each object schedules its own next read, even while other objects hang.
        this.scheduleOperationPoll();
        await Promise.allSettled(pending);
    }
    observePage(workId, visible, includeChat = true, serviceName = '', requestId = '', requestList = false, listService = '', worksList = false) {
        const observeRecovery = visible && this.state.signedIn && (worksList || this.coreGate.blocked || this.status.readiness?.value?.state === 'RECOVERING');
        if (observeRecovery !== this.recoveryListVisible) {
            this.recoveryListVisible = observeRecovery;
            this.recoveryObservation++;
            clearTimeout(this.recoveryTimer);
            this.recoveryTimer = undefined;
            if (!observeRecovery)
                this.metadata.cancelKey(this.metadataKey('status'));
        }
        if (observeRecovery && !this.recoveryTimer && !this.connectionCheck.error && this.needsRecoveryObservation())
            this.scheduleRecoveryRead();
        const entering = this.visibleWorkId !== workId || !this.observationVisible && visible;
        this.visibleWorkId = workId;
        this.visibleChat = includeChat;
        if (visible !== this.observationVisible) {
            this.observationVisible = visible;
            if (!visible) {
                clearTimeout(this.pollTimer);
                this.pollTimer = undefined;
                this.metadata.cancel();
            }
        }
        if (visible && entering) {
            this.metadata.rearm();
            this.scheduleOperationPoll();
        }
        const scope = visible && workId && this.getWork(workId) && this.project(this.getWork(workId)).usable ? `${this.epoch}:${workId}:${includeChat}:${serviceName}:${requestId}:${requestList}:${listService}` : '';
        if (scope !== this.interactionScope) {
            clearInterval(this.interactionTimer);
            this.interactionTimer = undefined;
            this.interactionScope = scope;
            this.interactionVersion++;
            if (scope) {
                const version = this.interactionVersion;
                const refresh = (entering = false) => {
                    if (version !== this.interactionVersion)
                        return;
                    if (serviceName)
                        void this.loadRequestPresence(workId, serviceName, entering);
                    if (includeChat)
                        void this.loadActiveRun(workId, entering);
                    const ids = new Set();
                    if (requestId)
                        ids.add(requestId);
                    if (requestList)
                        for (const record of this.requests.get(`${workId}:${listService}`)?.items ?? [])
                            if (this.cancellingRequests.has(`${workId}:${record.requestId}`))
                                ids.add(record.requestId);
                    for (const originalId of ids) {
                        const detail = this.requestDetails.get(`${workId}:${originalId}`);
                        if (detail && ['completed', 'failed', 'cancelled', 'needs_attention'].includes(detail.request.state)) {
                            this.cancellingRequests.delete(`${workId}:${originalId}`);
                            continue;
                        }
                        void this.loadRequest(workId, originalId, false, entering).catch(error => {
                            if (version !== this.interactionVersion || error instanceof ObservationStopped || error instanceof ObservationDeferred)
                                return;
                            if (detail)
                                detail.readError = errorText(error);
                            this.requestReadErrors.set(`${workId}:${originalId}`, t('d.error.cancellationStatus', { detail: errorText(error) }));
                            this.emit();
                        });
                    }
                };
                queueMicrotask(() => refresh(true));
                this.interactionTimer = setInterval(refresh, 5000);
            }
        }
    }
    needsRecoveryObservation() {
        return !!this.status.health?.available && !!this.status.readiness?.available && (this.status.readiness.value?.state === 'RECOVERING' ||
            this.state.works.some(work => ['Unknown', 'Preparing', 'Starting'].includes(work.status) || work.desired === 'running' && work.status === 'Stopped'));
    }
    scheduleRecoveryRead() {
        // Bound automatic observation to ten minutes at the normal two-second cadence.
        const limit = 300;
        if (!this.recoveryListVisible || this.recoveryTimer || this.corePaused)
            return;
        if (!this.recoveryStartedAt)
            this.recoveryStartedAt = Date.now();
        if (this.recoveryReads >= limit || Date.now() - this.recoveryStartedAt >= 600000) {
            this.corePaused = true;
            this.connectionCheck.error = t('conn.observationPaused');
            this.emit();
            return;
        }
        const epoch = this.epoch, version = this.recoveryObservation;
        this.recoveryTimer = setTimeout(async () => {
            this.recoveryReads++;
            // Keep the timer owned until both reads finish, including while rendering.
            try {
                const { value: status } = await this.readMetadata('status', false);
                if (epoch !== this.epoch || version !== this.recoveryObservation)
                    return;
                this.acceptCoreStatus(status);
                this.state.lastChecked = status.checkedAt ?? new Date().toISOString();
                this.state.scenario = !status.health?.available ? 'core-offline' : !status.readiness?.available || status.readiness.value?.ready === false ? 'env-not-ready' : 'normal';
                Object.assign(this.connectionCheck, { checkedAt: this.state.lastChecked, error: status.health?.available && !status.readiness?.available ? t('common.notConfirmed') : '' });
                await this.listWorks(false, () => epoch === this.epoch && version === this.recoveryObservation);
                if (epoch === this.epoch && version === this.recoveryObservation)
                    this.emit();
            }
            catch (error) {
                if (epoch === this.epoch && version === this.recoveryObservation && !(error instanceof ObservationStopped) && !(error instanceof ObservationDeferred)) {
                    this.connectionCheck.error = errorText(error);
                    this.emit();
                }
            }
            finally {
                if (epoch === this.epoch && version === this.recoveryObservation) {
                    this.recoveryTimer = undefined;
                    if (this.recoveryListVisible && this.needsRecoveryObservation() && !this.connectionCheck.error) {
                        if (this.recoveryReads >= limit || Date.now() - this.recoveryStartedAt >= 600000) {
                            this.corePaused = true;
                            this.connectionCheck.error = t('conn.observationPaused');
                            this.emit();
                        }
                        else
                            this.scheduleRecoveryRead();
                    }
                }
            }
        }, 2000);
    }
    async refreshVisibleWork(id) {
        const work = await this.refreshWorkStatus(id, false);
        if (work && this.project(work).usable)
            await this.loadServices(id);
    }
    refreshCapabilities(id) {
        const old = this.capabilityReads.get(id);
        if (old)
            return old;
        const work = this.getWork(id);
        if (!work || !this.project(work).usable)
            return Promise.resolve();
        const pending = (async () => {
            await Promise.allSettled([this.loadServices(id), this.loadConfiguration(id), this.loadPackages(id), ...(this.visibleWorkId === id && !this.visibleChat ? [] : [this.loadSessions(id), this.loadModels(id)])]);
        })().finally(() => { if (this.capabilityReads.get(id) === pending)
            this.capabilityReads.delete(id); });
        this.capabilityReads.set(id, pending);
        return pending;
    }
    operationPaused(id) { return this.pausedOperations.has(id) || this.invalidOperationTargets.has(id) || this.metadata.paused(this.metadataKey(`operations/${part(id)}`)); }
    pauseOperation(id) { this.pausedOperations.add(id); }
    resumeOperation(id) { this.pausedOperations.delete(id); this.scheduleOperationPoll(); }
    async dismissCompletedOperation(id) {
        const operation = this.state.operations.find(item => item.id === id);
        if (!operation || !terminalOperation(operation.state))
            return false;
        this.retainTerminal(operation);
        this.state.operations = this.state.operations.filter(item => item.id !== id);
        this.pendingOperationHides.set(id, operation);
        this.finishWorkSync();
        this.emit();
        return true;
    }
    async clearOperations() {
        for (const operation of [...this.state.operations])
            if (terminalOperation(operation.state))
                await this.dismissCompletedOperation(operation.id);
    }
    acceptChatSession(id, value) {
        const sessionId = value.sessionId ?? value.session?.sessionId;
        if (typeof sessionId !== 'string' || !sessionId)
            throw failure('INVALID_RESPONSE', 'd.error.sessionAcceptanceNoId');
        this.sessionVersions.set(id, (this.sessionVersions.get(id) || 0) + 1);
        const work = this.getWork(id);
        if (!work.sessions.some(s => s.id === sessionId))
            work.sessions.unshift({ id: sessionId, title: t('d.session.defaultTitle', { id: sessionId }), messages: [], modelPreference: value.modelPreference ?? null, thinkingLevel: value.thinkingLevel === undefined ? 'off' : value.thinkingLevel, thinkingProfile: value.thinkingProfile, source: value.source, runs: [] });
        this.emit();
        return sessionId;
    }
    async newSession(id) {
        if (this.chatSubmissions.has(id))
            throw failure('RESULT_UNKNOWN', 'd.error.checkOriginalSubmission');
        const draft = { ...this.modelSelection(id, '') };
        if (draft.needsThinkingConfirmation)
            throw failure('THINKING_LEVEL_UNSUPPORTED', draft.profile ? 'd.error.compatibleThinkingUnconfirmed' : 'd.error.thinkingUnconfirmed');
        if (draft.revision && !this.modelReady(id, ''))
            throw failure('MODEL_NOT_CONFIRMED', 'd.error.confirmModelBeforeSend');
        const intent = { kind: 'session', key: randomUUID(), error: '', pair: { ref: draft.ref, thinking: draft.thinking, profile: draft.profile, revision: draft.revision } };
        this.chatSubmissions.set(id, intent);
        this.emit();
        try {
            const value = await this.request(`works/${part(id)}/sessions`, 'POST', { idempotencyKey: intent.key });
            const sessionId = this.acceptChatSession(id, value);
            this.chatSubmissions.delete(id);
            const state = this.modelSelection(id, sessionId);
            if (draft.revision || (this.chatCapabilities.get(id) ?? 0) >= 1 && (state.ref !== draft.ref || state.thinking !== draft.thinking || state.profile !== draft.profile)) {
                Object.assign(state, { ref: draft.ref, thinking: draft.thinking, profile: draft.profile, phase: 'dirty', revision: Math.max(1, draft.revision) });
                void this.saveModel(id, sessionId).catch(() => undefined);
            }
            return sessionId;
        }
        catch (error) {
            const code = error.code;
            if (!['RESULT_UNKNOWN', 'INVALID_RESPONSE', 'RUNTIME_UNAVAILABLE', 'CORE_UNAVAILABLE', 'REQUEST_TIMEOUT'].includes(code))
                this.chatSubmissions.delete(id);
            if (code === 'WORK_BUSY' || code === 'RATE_LIMITED') {
                await this.loadSessions(id).catch(() => undefined);
                const active = this.getWork(id)?.run;
                if (code === 'WORK_BUSY' || active && ['accepted', 'running', 'cancelling'].includes(active.status))
                    error = failure('WORK_BUSY', 'd.error.runAlreadyActive');
            }
            intent.error = errorText(error);
            throw error;
        }
        finally {
            this.emit();
        }
    }
    async recoverChatSubmission(id) {
        const intent = this.chatSubmissions.get(id);
        if (!intent)
            return;
        const epoch = this.epoch;
        if (intent.kind === 'run')
            await this.supportsHistory(id);
        if (epoch !== this.epoch || this.chatSubmissions.get(id) !== intent)
            return;
        const value = await this.request(`works/${part(id)}/${intent.kind === 'session' ? 'sessions' : 'runs'}/submissions/${part(intent.key)}`);
        if (this.chatSubmissions.get(id) !== intent)
            return;
        if (value.kind !== intent.kind || value.key !== intent.key)
            throw failure('INVALID_RESPONSE', 'd.error.submissionUnconfirmed');
        if (value.status !== 'accepted') {
            intent.error = localizedText('d.error.submissionNotFound');
            this.emit();
            return;
        }
        if (intent.kind === 'session') {
            if (value.session?.workId !== id)
                throw failure('INVALID_RESPONSE', 'd.error.sessionOwnership');
            const sessionId = this.acceptChatSession(id, value.session);
            const state = this.modelSelection(id, sessionId);
            if (intent.pair && (intent.pair.revision || (this.chatCapabilities.get(id) ?? 0) >= 1 && (state.ref !== intent.pair.ref || state.thinking !== intent.pair.thinking || state.profile !== intent.pair.profile)))
                Object.assign(state, { ...intent.pair, revision: Math.max(1, intent.pair.revision), phase: 'dirty', error: t('d.error.selectedSettingsKept') });
        }
        else {
            if (value.run?.workId !== id || value.run?.sessionId !== intent.sessionId || value.run?.submissionKey !== intent.key)
                throw failure('INVALID_RESPONSE', 'd.error.runIdentity');
            const work = this.getWork(id);
            work.run = this.runRecord(value.run, value.run.sessionId);
            await this.loadSession(id, value.run.sessionId);
            void this.resumeRun(id);
        }
        if (this.chatSubmissions.get(id) === intent)
            this.chatSubmissions.delete(id);
        this.emit();
        return value;
    }
    async send(id, sessionId, text, includeIdentity, inputMode, images = [], cancelRunId) {
        this.assertCoreReady();
        if (!text.trim() && !images.length)
            throw new Error(t('d.error.writeMessageFirst'));
        const work = this.getWork(id);
        if (images.length) {
            const reason = this.imageInputReason(id, sessionId);
            if (reason)
                throw new Error(reason);
            if (inputMode !== 'text')
                throw new Error(t('d.error.imagesRequireText'));
        }
        if (!this.modelReady(id, sessionId))
            throw failure('MODEL_NOT_CONFIRMED', 'd.error.confirmModelBeforeSend');
        const prompt = includeIdentity && inputMode !== 'command' ? `${text}\n\nSelected Service: ${work.services.find(s => s.id === this.selectedService)?.domain ?? ''}` : text;
        if (cancelRunId && this.cancelAndSendCapabilities.get(id) !== 1)
            throw failure('CANCEL_AND_SEND_UNSUPPORTED', 'd.error.stopAndSendUnavailable');
        const epoch = this.epoch;
        const intent = { kind: 'run', key: randomUUID(), sessionId, cancelRunId, error: '' };
        this.chatSubmissions.set(id, intent);
        this.emit();
        try {
            const descriptors = await Promise.all(images.map(async (image, imageIndex) => { const bytes = Uint8Array.from(atob(image.data), c => c.charCodeAt(0)); const sha256 = await sha256Hex(bytes); return { imageIndex, mimeType: image.mimeType, byteSize: bytes.length, sha256 }; }));
            if (epoch !== this.epoch || this.chatSubmissions.get(id) !== intent)
                throw failure('CONNECTION_CHANGED', 'd.error.imageSubmissionIdentity');
            const value = await this.request(`works/${part(id)}/runs`, 'POST', { sessionId, prompt, submissionKey: intent.key, ...(inputMode ? { inputMode } : {}), ...(images.length ? { images } : {}), ...(cancelRunId ? { cancelRunId } : {}) });
            const raw = value.run;
            if (epoch !== this.epoch || this.chatSubmissions.get(id) !== intent)
                throw failure('CONNECTION_CHANGED', 'd.error.submissionIdentity');
            if (!raw?.runId || raw.sessionId !== sessionId)
                throw failure('INVALID_RESPONSE', 'd.error.runAcceptanceNoId');
            const acceptedWork = this.getWork(id) ?? work;
            const acceptedSession = acceptedWork.sessions.find(s => s.id === sessionId) ?? work.sessions.find(s => s.id === sessionId);
            if (!acceptedWork.sessions.includes(acceptedSession))
                acceptedWork.sessions.push(acceptedSession);
            acceptedWork.run = this.runRecord(raw, sessionId);
            (acceptedSession.runs ??= []).push(acceptedWork.run);
            this.activeRevisions.set(id, (this.activeRevisions.get(id) || 0) + 1);
            if (this.cancelAndSendCapabilities.get(id) === 1)
                this.activeRuns.set(id, { confirmed: true, loading: false, run: acceptedWork.run, error: '' });
            acceptedSession.messages.push({ id: `${raw.runId}-user`, runId: raw.runId, role: 'user', text, ...(descriptors.length ? { images: descriptors } : {}) });
            if (this.chatSubmissions.get(id) === intent)
                this.chatSubmissions.delete(id);
            this.emit();
            void this.resumeRun(id);
            return raw.runId;
        }
        catch (error) {
            const code = error.code;
            if (this.chatSubmissions.get(id) === intent && !['RESULT_UNKNOWN', 'INVALID_RESPONSE', 'RUNTIME_UNAVAILABLE', 'CORE_UNAVAILABLE', 'REQUEST_TIMEOUT'].includes(code))
                this.chatSubmissions.delete(id);
            if (epoch === this.epoch && (code === 'WORK_BUSY' || code === 'RATE_LIMITED' || code === 'CANCEL_TIMEOUT')) {
                if (this.cancelAndSendCapabilities.get(id) === 1)
                    await this.loadActiveRun(id, true);
                else
                    await this.loadSessions(id).catch(() => undefined);
                const active = this.cancelAndSendCapabilities.get(id) === 1 ? this.activeRuns.get(id)?.run : this.getWork(id)?.run;
                if (code === 'WORK_BUSY' || code === 'RATE_LIMITED' && active && ['accepted', 'running', 'cancelling'].includes(active.status))
                    error = failure('WORK_BUSY', this.cancelAndSendCapabilities.get(id) === 1 ? 'd.error.runAlreadyActiveStopAndSend' : 'd.error.runAlreadyActive');
            }
            intent.error = errorText(error);
            throw error;
        }
        finally {
            this.emit();
        }
    }
    selectedService = '';
    async cancelRun(id, runId = this.getWork(id)?.run?.id) {
        if (!runId)
            return;
        const epoch = this.epoch;
        await this.supportsHistory(id);
        if (epoch !== this.epoch)
            return;
        await this.request(`works/${part(id)}/runs/${part(runId)}/cancel`, 'POST');
        if (epoch !== this.epoch)
            return;
        const candidates = [this.getWork(id)?.run, this.activeRuns.get(id)?.run, this.runDetails.get(`${id}:${runId}`)];
        for (const run of candidates)
            if (run?.id === runId)
                run.cancellationRequested = true;
        this.emit();
        void this.loadRunDetails(id, runId).then(value => { if (epoch !== this.epoch || !value)
            return; for (const run of candidates)
            if (run?.id === runId)
                run.status = value.status; this.emit(); }).catch(() => undefined);
        void this.loadActiveRun(id, true);
    }
    stopRunObservers() {
        for (const controller of this.streams.values())
            controller.abort();
        this.streams.clear();
        for (const observer of this.historyObservers.values())
            observer.controller.abort();
        this.historyObservers.clear();
        for (const timer of this.reconnects.values())
            clearTimeout(timer);
        this.reconnects.clear();
    }
    async recoverRunHistory(id, observer) {
        const { run, controller, epoch } = observer;
        const current = () => epoch === this.epoch && !controller.signal.aborted && this.getWork(id)?.run === run && this.historyObservers.get(id) === observer;
        if (!current())
            return;
        let retry = true;
        let delay = 2000;
        try {
            if (!this.historySupport.has(id))
                await this.supportsHistory(id);
            if (!current())
                return;
            const value = await this.request(`works/${part(id)}/runs/${part(run.id)}`, 'GET', undefined, controller.signal);
            if (!current())
                return;
            const raw = value.run ?? value;
            run.status = runStates[raw.state] ?? 'interrupted';
            run.executionError = raw.error?.message;
            run.errorCode = typeof raw.error?.code === 'string' ? raw.error.code : undefined;
            run.errorRetryable = typeof raw.error?.retryable === 'boolean' ? raw.error.retryable : undefined;
            const profile = this.imageCapabilities.get(id)?.value || this.getWork(id)?.sessions.find(s => s.id === run.sessionId)?.imageProfile ? '?imageProfile=chat-images-v1' : '';
            if (this.historySupport.get(id)) {
                run.resultRef = raw.resultRef;
                await this.loadSavedRun(id, run, controller.signal);
                if (!current())
                    return;
                observer.failures = 0;
                retry = ['accepted', 'running', 'cancelling'].includes(run.status);
                run.error = run.executionError ?? (retry ? t('d.error.eventCursorExpired') : undefined);
            }
            else {
                const history = await this.request(`works/${part(id)}/sessions/${part(run.sessionId)}${profile}`, 'GET', undefined, controller.signal);
                if (!current())
                    return;
                if (!Array.isArray(history.messages))
                    throw new Error(t('d.error.savedHistoryIncomplete'));
                const session = this.getWork(id)?.sessions.find(s => s.id === run.sessionId);
                if (session) {
                    session.messages = historyMessages(history.messages, session.messages);
                    session.imageProfile = !!profile;
                    if (!['accepted', 'running', 'cancelling'].includes(run.status) && raw.finalText && !session.messages.some(m => m.role === 'assistant' && !m.tool && m.text === raw.finalText))
                        session.messages.push({ role: 'assistant', text: raw.finalText });
                }
                observer.failures = 0;
                retry = ['accepted', 'running', 'cancelling'].includes(run.status);
                run.error = run.executionError ?? (retry ? t('d.error.eventCursorExpired') : undefined);
            }
        }
        catch (error) {
            if (!current())
                return;
            const legacyLimit = this.legacyHistoryLimit(id, error);
            run.error = [run.executionError, t('d.error.historyRecoveryFailed', { detail: errorText(error) }), legacyLimit ? this.historyNotice(id) : ''].filter(Boolean).join(' ');
            delay = Math.min(30000, 2000 * 2 ** Math.min(observer.failures++, 4));
            // Terminal history errors require explicit readback; do not claim completion
            // or poll an inaccessible/deleted Run indefinitely.
            retry = !legacyLimit && ['accepted', 'running', 'cancelling'].includes(run.status) && !(error instanceof DesktopError && [401, 403, 404].includes(error.httpStatus ?? 0));
        }
        if (!current())
            return;
        this.emit();
        if (retry)
            this.reconnects.set(id, setTimeout(() => { if (current())
                void this.recoverRunHistory(id, observer); }, delay));
        else
            this.historyObservers.delete(id);
    }
    resumeRunConnection(id) {
        return new Promise((resolve, reject) => {
            let connected = false;
            void this.resumeRun(id, () => { connected = true; resolve(); }).then(() => {
                if (!connected)
                    reject(new Error(this.getWork(id)?.run?.error || t('d.error.runConnectionUnconfirmed')));
            }, reject);
        });
    }
    async resumeRun(id, connected) {
        const work = this.getWork(id);
        const run = work.run;
        if (!run)
            return;
        clearTimeout(this.reconnects.get(id));
        this.reconnects.delete(id);
        run.error = run.executionError;
        this.historyObservers.get(id)?.controller.abort();
        this.historyObservers.delete(id);
        this.streams.get(id)?.abort();
        const controller = new AbortController();
        this.streams.set(id, controller);
        const epoch = this.epoch;
        if (run.historyRecovery) {
            this.streams.delete(id);
            const observer = { controller, run, epoch, failures: 0 };
            this.historyObservers.set(id, observer);
            await this.recoverRunHistory(id, observer);
            if (!observer.failures)
                connected?.();
            return;
        }
        let retry = true;
        try {
            if (!this.historySupport.has(id))
                await this.supportsHistory(id);
            if (epoch !== this.epoch || controller.signal.aborted || this.streams.get(id) !== controller || this.getWork(id)?.run !== run)
                return;
            const response = await fetch(`/_desktop/api/works/${part(id)}/runs/${part(run.id)}/events?after=${run.cursor}${this.historySupport.get(id) ? '&responseProfile=history-v1' : ''}`, { credentials: 'same-origin', signal: controller.signal });
            if (epoch !== this.epoch || controller.signal.aborted || this.streams.get(id) !== controller || this.getWork(id)?.run !== run)
                return;
            if (!response.ok) {
                if (response.status === 410) {
                    run.historyRecovery = true;
                    const observer = { controller, run, epoch, failures: 0 };
                    this.historyObservers.set(id, observer);
                    await this.recoverRunHistory(id, observer);
                    if (!observer.failures)
                        connected?.();
                    return;
                }
                const descriptor = await response.json().catch(() => null);
                throw failure(typeof descriptor?.code === 'string' ? descriptor.code : 'RUN_STREAM_UNAVAILABLE', 'd.error.runStreamFailed', { status: response.status }, response.status, undefined, typeof descriptor?.message === 'string' && descriptor.message ? descriptor.message : undefined);
            }
            connected?.();
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            const consume = (line) => {
                if (epoch !== this.epoch || controller.signal.aborted || this.streams.get(id) !== controller || this.getWork(id)?.run !== run || !line.trim())
                    return;
                const event = JSON.parse(line);
                const sequence = Number(event.sequence);
                if (!Number.isSafeInteger(sequence) || sequence <= run.cursor)
                    return;
                const frame = event.kind?.$case === 'text' ? event.kind.text : null;
                if (frame?.byteOffset !== undefined) {
                    const key = `${id}:${run.id}:${sequence}`, offset = Number(frame.byteOffset), total = Number(frame.totalBytes), bytes = new TextEncoder().encode(frame.delta ?? '').length;
                    let pending = this.historyEventParts.get(key);
                    if (!pending) {
                        pending = { offset: 0, parts: new Map() };
                        this.historyEventParts.set(key, pending);
                    }
                    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(total) || offset < 0 || offset + bytes > total || frame.complete !== (offset + bytes === total))
                        throw new Error(t('d.error.runEventFragmentInvalid'));
                    if (pending.parts.has(offset)) {
                        if (pending.parts.get(offset) !== frame.delta)
                            throw new Error(t('d.error.runEventChanged'));
                        if (frame.complete)
                            run.cursor = sequence;
                        return;
                    }
                    if (offset !== pending.offset)
                        throw new Error(t('d.error.runEventIncomplete'));
                    pending.parts.set(offset, frame.delta ?? '');
                    pending.offset += bytes;
                    if (frame.complete)
                        run.cursor = sequence;
                }
                else
                    run.cursor = sequence;
                const session = work.sessions.find(s => s.id === run.sessionId);
                if (!session)
                    return;
                const kind = event.kind;
                if (kind?.$case === 'text') {
                    let message = session.messages.at(-1);
                    if (!message || message.role !== 'assistant' || message.tool) {
                        message = { id: `${run.id}-text-${sequence}`, runId: run.id, role: 'assistant', text: '' };
                        session.messages.push(message);
                    }
                    message.text += kind.text.delta ?? '';
                }
                else if (kind?.$case === 'tool') {
                    const tool = kind.tool;
                    upsertTool(session.messages, { id: `${run.id}-tool-${tool.toolCallId}`, runId: run.id, role: 'assistant', text: '', tool: { id: tool.toolCallId, name: tool.toolName, status: tool.phase === 'tool-end' ? (tool.isError ? 'Failed' : 'Completed') : 'Running', isError: tool.isError, content: resultText(tool.result, tool.toolName) } });
                }
                else if (kind?.$case === 'state') {
                    run.status = runStates[kind.state.state] ?? 'interrupted';
                    run.resultRef = kind.state.resultRef;
                    run.error = run.executionError = kind.state.error?.message;
                    run.errorCode = typeof kind.state.error?.code === 'string' ? kind.state.error.code : undefined;
                    run.errorRetryable = typeof kind.state.error?.retryable === 'boolean' ? kind.state.error.retryable : undefined;
                    if (kind.state.finalText && !session.messages.some(m => m.runId === run.id && m.role === 'assistant' && !!m.text))
                        session.messages.push({ id: `${run.id}-final`, runId: run.id, role: 'assistant', text: kind.state.finalText });
                }
                this.emit();
            };
            while (epoch === this.epoch && !controller.signal.aborted && this.streams.get(id) === controller && this.getWork(id)?.run === run) {
                const { value, done } = await reader.read();
                if (done) {
                    buffer += decoder.decode();
                    if (buffer.trim())
                        consume(buffer);
                    break;
                }
                buffer += decoder.decode(value, { stream: true });
                if (buffer.length > 2_097_152)
                    throw new Error(t('d.error.runEventTooLarge'));
                let index;
                while ((index = buffer.indexOf('\n')) !== -1) {
                    consume(buffer.slice(0, index));
                    buffer = buffer.slice(index + 1);
                }
            }
            if (epoch !== this.epoch || controller.signal.aborted || this.streams.get(id) !== controller || this.getWork(id)?.run !== run)
                return;
            const value = await this.request(`works/${part(id)}/runs/${part(run.id)}`);
            run.status = runStates[(value.run ?? value).state] ?? 'interrupted';
            run.executionError = (value.run ?? value).error?.message;
            run.errorCode = typeof (value.run ?? value).error?.code === 'string' ? (value.run ?? value).error.code : undefined;
            run.errorRetryable = typeof (value.run ?? value).error?.retryable === 'boolean' ? (value.run ?? value).error.retryable : undefined;
            run.resultRef = (value.run ?? value).resultRef;
            if (['accepted', 'running', 'cancelling'].includes(run.status)) {
                if (this.historySupport.get(id) && [...this.historyEventParts.keys()].some(key => key.startsWith(`${id}:${run.id}:`))) {
                    run.historyRecovery = true;
                    const observer = { controller, run, epoch, failures: 0 };
                    this.historyObservers.set(id, observer);
                    await this.recoverRunHistory(id, observer);
                }
                else
                    run.error = localizedText('d.error.eventStreamEnded');
            }
            else {
                run.error = run.executionError;
                this.reconnectAttempts.delete(id);
                if (this.historySupport.get(id))
                    await this.loadSavedRun(id, run, controller.signal);
                else
                    await this.loadSession(id, run.sessionId);
                await this.loadServices(id).catch(() => undefined);
                await this.loadConfiguration(id).catch(() => undefined);
            }
            this.emit();
        }
        catch (error) {
            if (!controller.signal.aborted && epoch === this.epoch) {
                const legacyLimit = this.legacyHistoryLimit(id, error);
                retry = !legacyLimit;
                run.error = [run.executionError, t('d.error.resumeOriginalRun', { detail: errorText(error) }), legacyLimit ? this.historyNotice(id) : ''].filter(Boolean).join(' ');
                this.emit();
            }
        }
        finally {
            if (this.streams.get(id) === controller) {
                this.streams.delete(id);
                if (retry && !run.historyRecovery && epoch === this.epoch && !controller.signal.aborted && this.getWork(id)?.run === run && ['accepted', 'running', 'cancelling'].includes(run.status)) {
                    const attempt = this.reconnectAttempts.get(id) ?? 0;
                    this.reconnectAttempts.set(id, attempt + 1);
                    this.reconnects.set(id, setTimeout(() => { if (epoch === this.epoch && this.getWork(id)?.run === run)
                        void this.resumeRun(id); }, Math.min(30000, 1500 * 2 ** Math.min(attempt, 5))));
                }
            }
        }
    }
    fileURL(id, path) { if (!path.startsWith('/') || path.split('/').some(p => p === '.' || p === '..' || /[\\\x00]/.test(p)))
        throw new Error(t('d.error.invalidWorkspacePath')); return `/_desktop/files/works/${part(id)}/files/${path.slice(1).split('/').map(part).join('/')}`; }
    directoryLoads = new Map();
    fileReaders = new Map();
    fileReadGenerations = new Map();
    releasePreview(file) { if (file?.preview?.kind === 'image')
        URL.revokeObjectURL(file.preview.url); if (file)
        delete file.preview; }
    removeFileEntry(id, path) { const work = this.getWork(id); if (!work)
        return; const file = work.files.find(item => item.path === path); this.releasePreview(file); work.files = work.files.filter(item => item.path !== path); }
    /** Stop one target's active read and release its confirmed preview asset. */
    releaseFilePreview(id, path) {
        const reader = this.fileReaders.get(id);
        if (reader?.path === path) {
            reader.controller.abort();
            this.fileReaders.delete(id);
        }
        this.releasePreview(this.getWork(id)?.files.find(file => file.path === path));
    }
    /** Stop every preview read and revoke every file preview asset. */
    stopFileReads() {
        for (const reader of this.fileReaders.values())
            reader.controller.abort();
        this.fileReaders.clear();
        this.fileReadGenerations.clear();
        for (const work of this.state.works)
            for (const file of work.files ?? [])
                this.releasePreview(file);
    }
    revokeWorkFilePreviews(id) {
        const reader = this.fileReaders.get(id);
        if (reader) {
            reader.controller.abort();
            this.fileReaders.delete(id);
        }
        this.fileReadGenerations.delete(id);
        const work = this.getWork(id);
        if (work)
            for (const file of work.files)
                this.releasePreview(file);
    }
    fileError(response, fallback) {
        // A bounded status/header only; never read or expose an unbounded body.
        const code = response.headers.get('X-Piwork-File-Error') || '';
        return code
            ? failure(code, 'd.error.fileRequestRejected', { code }, response.status)
            : failure('FILE_READ_FAILED', 'd.error.fileRequestFailed', { fallback, status: response.status }, response.status);
    }
    /** File auth failures share the existing session check/revocation path. */
    async fileAuth(response) {
        if (response.status !== 401 && response.status !== 403)
            return;
        const epoch = this.epoch;
        try {
            const session = await this.checkSession();
            if (epoch !== this.epoch)
                return;
            if (session.state === 'signed-out') {
                this.clearIdentity();
                this.state.signedIn = false;
                this.state.scenario = 'auth-expired';
                this.emit();
            }
        }
        catch {
            // The file status is still the immediate, accurate result for this target.
        }
    }
    async checkTarget(id, path, signal) {
        const epoch = this.epoch, work = this.getWork(id);
        if (!work)
            throw failure('WORK_NOT_FOUND', 'd.error.thisWorkUnavailable', undefined, 404);
        const parent = path.slice(0, path.lastIndexOf('/')) || '/';
        const parentURL = this.fileURL(id, parent).replace(/\/?$/, '/'), url = this.fileURL(id, path);
        const response = await fetch(url, { method: 'PROPFIND', credentials: 'same-origin', signal,
            headers: { Depth: '0', 'X-Piwork-Csrf': this.csrf } });
        if (epoch !== this.epoch)
            throw failure('CONNECTION_CHANGED', 'd.error.fileCheckDiscarded');
        if (response.status === 404 || response.status === 410) {
            this.removeFileEntry(id, path);
            this.emit();
            throw failure('FILE_NOT_FOUND', 'd.error.fileNotInWorkspace', undefined, response.status);
        }
        if (!response.ok) {
            await this.fileAuth(response);
            throw this.fileError(response, localizedText('d.error.currentFileCheckFailed'));
        }
        const findTarget = (rows) => rows.find(item => item.href === url) ?? rows.find(item => item.name === path.slice(path.lastIndexOf('/') + 1));
        let entries = parseEntries(await response.text(), parentURL);
        if (epoch !== this.epoch)
            throw failure('CONNECTION_CHANGED', 'd.error.identityChangedTarget');
        let entry = findTarget(entries);
        if (!entry) {
            // Some backends answer Depth 0 with the containing folder. The parent
            // listing still proves the target's current metadata, not its bytes.
            const listing = await fetch(parentURL, { method: 'PROPFIND', credentials: 'same-origin', signal,
                headers: { Depth: '1', 'X-Piwork-Csrf': this.csrf } });
            if (epoch !== this.epoch)
                throw failure('CONNECTION_CHANGED', 'd.error.identityChangedTarget');
            if (listing.status === 404 || listing.status === 410) {
                this.removeFileEntry(id, path);
                this.emit();
                throw failure('FILE_NOT_FOUND', 'd.error.fileNotInWorkspace', undefined, listing.status);
            }
            if (!listing.ok) {
                await this.fileAuth(listing);
                throw this.fileError(listing, localizedText('d.error.currentFileCheckFailed'));
            }
            entries = parseEntries(await listing.text(), parentURL);
            entry = findTarget(entries);
        }
        if (!entry) {
            this.removeFileEntry(id, path);
            this.emit();
            throw failure('FILE_NOT_FOUND', 'd.error.fileNotInWorkspace', undefined, 404);
        }
        const fresh = { path, name: entry.name, kind: entry.directory ? 'directory' : entry.kind === 'file' ? 'file' : 'special',
            size: entry.size ?? 0, modified: entry.modified ?? '' };
        // Metadata is current, but a transient read failure must retain the last
        // confirmed preview instead of presenting the target as empty.
        const existing = work.files.find(item => item.path === path);
        if (existing) {
            existing.name = fresh.name;
            existing.kind = fresh.kind;
            existing.size = fresh.size;
            existing.modified = fresh.modified;
            return { ...existing };
        }
        work.files = [...work.files, fresh];
        return fresh;
    }
    async boundedBody(response, signal) {
        const reader = response.body?.getReader();
        if (!reader)
            throw failure('FILE_READ_FAILED', 'd.error.fileContentUnavailable');
        const chunks = [];
        let size = 0, image = false, decided = false;
        const cancel = async () => { await reader.cancel().catch(() => undefined); };
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                chunks.push(value);
                size += value.byteLength;
                if (!decided && size >= 12) {
                    image = detectImageMime(this.head(chunks, 12)) !== undefined;
                    decided = true;
                }
                if (size > (image ? FILE_IMAGE_MAX_BYTES : 1_048_576)) {
                    await cancel();
                    throw failure(image ? 'FILE_PREVIEW_TOO_LARGE' : 'FILE_TEXT_TOO_LARGE', image ? 'd.error.imagePreviewTooLarge' : 'd.error.textPreviewTooLarge', undefined, 413);
                }
                if (signal.aborted) {
                    await cancel();
                    throw new DOMException('The file read was replaced.', 'AbortError');
                } // i18n-exempt: AbortError 诊断原因，不是界面文案
            }
        }
        catch (error) {
            await cancel();
            throw error;
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return bytes;
    }
    head(chunks, size) {
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            if (offset >= size)
                break;
            const part = chunk.subarray(0, size - offset);
            bytes.set(part, offset);
            offset += part.byteLength;
        }
        return bytes;
    }
    /**
     * Recheck the target's current metadata, then read bounded current bytes.
     * A directory listing never proves a file's current content or type.
     */
    async readFile(id, path, external) {
        const epoch = this.epoch, work = this.getWork(id);
        if (!work)
            throw failure('WORK_NOT_FOUND', 'd.error.thisWorkUnavailable', undefined, 404);
        const previous = this.fileReaders.get(id);
        if (previous)
            previous.controller.abort();
        const controller = new AbortController();
        const forward = () => controller.abort();
        external?.addEventListener('abort', forward, { once: true });
        this.fileReaders.set(id, { controller, path });
        const generation = (this.fileReadGenerations.get(id) || 0) + 1;
        this.fileReadGenerations.set(id, generation);
        const current = () => epoch === this.epoch && this.fileReadGenerations.get(id) === generation && !controller.signal.aborted;
        const abortIfStale = () => { if (!current())
            throw new DOMException('The file read was replaced.', 'AbortError'); }; // i18n-exempt: AbortError 诊断原因，不是界面文案
        try {
            const target = await this.checkTarget(id, path, controller.signal);
            abortIfStale();
            if (target.kind === 'directory') {
                await this.loadDirectory(id, path);
                abortIfStale();
                return { ...target };
            }
            if (target.kind === 'special')
                return { ...target };
            if (target.size > FILE_IMAGE_MAX_BYTES) {
                const file = this.getWork(id).files.find(item => item.path === path);
                this.releasePreview(file);
                file.preview = { kind: 'download-only', reason: 'oversized' };
                this.emit();
                return { ...file };
            }
            const response = await fetch(this.fileURL(id, path), { credentials: 'same-origin', signal: controller.signal });
            if (!response.ok) {
                await this.fileAuth(response);
                throw this.fileError(response, localizedText('d.error.fileReadFailed'));
            }
            const declared = Number(response.headers.get('content-length'));
            if (Number.isFinite(declared) && declared > FILE_IMAGE_MAX_BYTES) {
                await response.body?.cancel().catch(() => undefined);
                const file = this.getWork(id).files.find(item => item.path === path);
                this.releasePreview(file);
                file.preview = { kind: 'download-only', reason: 'oversized' };
                this.emit();
                return { ...file };
            }
            let bytes;
            try {
                bytes = await this.boundedBody(response, controller.signal);
            }
            catch (error) {
                if (error instanceof DesktopError && error.code === 'FILE_TEXT_TOO_LARGE') {
                    const file = this.getWork(id).files.find(item => item.path === path);
                    this.releasePreview(file);
                    file.preview = { kind: 'download-only', reason: 'oversized' };
                    this.emit();
                    return { ...file };
                }
                if (error instanceof DesktopError && error.code === 'FILE_PREVIEW_TOO_LARGE') {
                    const file = this.getWork(id).files.find(item => item.path === path);
                    this.releasePreview(file);
                    file.preview = { kind: 'download-only', reason: 'oversized' };
                    this.emit();
                    return { ...file };
                }
                throw error;
            }
            abortIfStale();
            const mime = detectImageMime(bytes);
            let preview;
            if (mime)
                preview = await this.imagePreview(bytes, mime, controller.signal);
            else if (this.binaryContainer(bytes))
                preview = { kind: 'download-only', reason: 'document' };
            else
                preview = this.textPreview(bytes);
            try {
                abortIfStale();
            }
            catch (error) {
                if (preview.kind === 'image')
                    URL.revokeObjectURL(preview.url);
                throw error;
            }
            const file = this.getWork(id).files.find(item => item.path === path);
            if (!file) {
                if (preview.kind === 'image')
                    URL.revokeObjectURL(preview.url);
                throw failure('FILE_NOT_FOUND', 'd.error.fileNotInWorkspace', undefined, 404);
            }
            this.releasePreview(file);
            file.preview = preview;
            file.size = bytes.byteLength;
            file.modified = fileVersion(response.headers.get('Last-Modified')) || file.modified;
            this.emit();
            return { ...file };
        }
        finally {
            external?.removeEventListener('abort', forward);
            if (this.fileReaders.get(id)?.controller === controller)
                this.fileReaders.delete(id);
        }
    }
    textPreview(bytes) {
        try {
            const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
            if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content))
                throw new Error('Binary control bytes'); // i18n-exempt: 内部判定信号，仅用于切换 download-only 展示
            return { kind: 'text', content };
        }
        catch {
            return { kind: 'download-only', reason: 'binary' };
        }
    }
    /** Formats that are documents, not editable text, even when their bytes are ASCII. */
    binaryContainer(bytes) {
        if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d)
            return true; // %PDF-
        if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
            return true; // GIF8
        return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04; // ZIP
    }
    async imagePreview(bytes, mime, signal) {
        let width = 0, height = 0;
        try {
            ({ width, height } = imageDimensions(mime, bytes));
        }
        catch {
            return { kind: 'download-only', reason: 'unsupported' };
        }
        if (!imageWithinLimits(width, height))
            return { kind: 'download-only', reason: 'oversized' };
        // A truncated or unsupported image must not become a broken <img>.
        let bitmap;
        const blob = new Blob([bytes.buffer], { type: mime });
        try {
            bitmap = await createImageBitmap(blob);
        }
        catch {
            return { kind: 'download-only', reason: 'unsupported' };
        }
        finally {
            bitmap?.close();
        }
        if (signal.aborted)
            throw new DOMException('The file read was replaced.', 'AbortError'); // i18n-exempt: AbortError 诊断原因，不是界面文案
        return { kind: 'image', mimeType: mime, url: URL.createObjectURL(blob), width, height };
    }
    async loadDirectory(id, path = '/') {
        const epoch = this.epoch;
        const work = this.getWork(id);
        if (!work)
            throw failure('WORK_NOT_FOUND', 'd.error.thisWorkUnavailable', undefined, 404);
        const key = `${id}:${path}`, state = this.directories.get(key) || { loading: false, checkedAt: '', error: '' };
        const generation = (this.directoryLoads.get(key) || 0) + 1;
        this.directoryLoads.set(key, generation);
        this.directories.set(key, state);
        state.loading = true;
        this.emit();
        try {
            const base = this.fileURL(id, path).replace(/\/?$/, '/');
            const response = await fetch(base, { method: 'PROPFIND', credentials: 'same-origin', headers: { Depth: '1', 'X-Piwork-Csrf': this.csrf } });
            if (!response.ok) {
                await this.fileAuth(response);
                throw this.fileError(response, localizedText('d.error.workspaceReadFailed'));
            }
            const text = await response.text();
            if (epoch !== this.epoch || this.directoryLoads.get(key) !== generation)
                throw failure('CONNECTION_CHANGED', 'd.error.fileListingDiscarded');
            const entries = parseEntries(text, base);
            state.checkedAt = new Date().toISOString();
            state.error = '';
            const children = entries.filter(e => e.name !== '/').map(e => ({ path: (path === '/' ? '' : path) + '/' + e.name, name: e.name,
                kind: e.directory ? 'directory' : e.kind === 'file' ? 'file' : 'special', size: e.size ?? 0, modified: e.modified ?? '' }));
            // A listing proves names and metadata only. Any earlier preview is stale.
            for (const old of work.files)
                if ((old.path.slice(0, old.path.lastIndexOf('/')) || '/') === path)
                    this.releasePreview(old);
            work.files = [...work.files.filter(f => (f.path.slice(0, f.path.lastIndexOf('/')) || '/') !== path), ...children];
            if (work.resourceErrors)
                delete work.resourceErrors.files;
            this.emit();
        }
        catch (error) {
            if (epoch === this.epoch && this.directoryLoads.get(key) === generation) {
                (work.resourceErrors ??= {}).files = errorText(error);
                state.error = errorText(error);
                this.emit();
            }
            throw error;
        }
        finally {
            state.loading = false;
            if (epoch === this.epoch && this.directoryLoads.get(key) === generation)
                this.emit();
        }
    }
    async uploadResponse(url, method, body, headers, progress) {
        const epoch = this.epoch;
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open(method, url);
            xhr.withCredentials = true;
            for (const [key, value] of Object.entries(headers))
                xhr.setRequestHeader(key, value);
            xhr.upload.onprogress = event => progress(event.loaded, event.lengthComputable ? event.total : undefined);
            xhr.upload.onload = () => { if (epoch === this.epoch)
                progress(0, undefined, true); };
            xhr.onload = () => {
                if (epoch !== this.epoch) {
                    reject(failure('CONNECTION_CHANGED', 'd.error.uploadIdentity'));
                    return;
                }
                const resultHeaders = new Headers();
                for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
                    const at = line.indexOf(':');
                    if (at > 0)
                        resultHeaders.append(line.slice(0, at), line.slice(at + 1).trim());
                }
                resolve(new Response(xhr.status === 204 || xhr.status === 205 ? null : xhr.responseText, { status: xhr.status, headers: resultHeaders }));
            };
            xhr.onerror = () => reject(failure('RESULT_UNKNOWN', 'd.error.uploadResponseLost'));
            xhr.onabort = xhr.onerror;
            xhr.send(body);
        });
    }
    async writeFile(id, path, method, body, headers = {}) {
        this.assertCoreReady();
        if (path === '/' && method !== 'MKCOL')
            throw new Error(t('d.error.rootCannotMutate'));
        const epoch = this.epoch;
        let response;
        try {
            response = body instanceof File
                ? await this.uploadResponse(this.fileURL(id, path), method, body, { ...headers, 'X-Piwork-Csrf': this.csrf }, (sent, total, sentAll) => { const progress = this.uploadProgress.get(id); if (epoch === this.epoch && progress) {
                    Object.assign(progress, sentAll ? { phase: t('d.action.waitingConfirmation') } : { phase: t('d.action.uploading'), transferred: sent, total });
                    this.emit();
                } })
                : await fetch(this.fileURL(id, path), { method, credentials: 'same-origin', headers: { ...headers, 'X-Piwork-Csrf': this.csrf }, body });
        }
        catch {
            return [{ path, status: 'unknown', message: t('d.error.transferResponseLost') }];
        }
        if (epoch !== this.epoch)
            throw new Error(t('d.error.fileResultsConnection'));
        if (response.status === 207) {
            try {
                return mutationResults(await response.text(), this.fileURL(id, '/')).results;
            }
            catch {
                return [{ path, status: 'unknown', message: t('d.error.perPathUnverified') }];
            }
        }
        if (!response.ok) {
            const value = await response.json().catch(() => ({}));
            const uncertain = response.status === 408 || response.status >= 500;
            const reason = value.message ?? response.headers.get('X-Piwork-File-Error') ?? t('d.error.requestFailed', { status: response.status });
            return [{ path, status: uncertain ? 'unknown' : 'failed', httpStatus: response.status, message: uncertain
                        ? t('d.error.writeUnknown', { reason })
                        : response.status === 412 ? t('d.error.targetChanged') : reason }];
        }
        return [{ path, status: 'succeeded', message: t('d.error.confirmed'), modified: fileVersion(response.headers.get('Last-Modified')) }];
    }
    async saveFile(id, path, content, baseline, unprotectedConsent = false, confirmed) {
        if (new TextEncoder().encode(content).length > 1_048_576)
            throw new Error(t('d.error.textEditorLimit'));
        const modified = fileVersion(baseline);
        if (!modified && !unprotectedConsent)
            throw new Error(t('d.error.noModificationTime'));
        const results = await this.writeFile(id, path, 'PUT', content, { 'Content-Type': 'text/plain; charset=utf-8', ...(modified ? { 'If-Unmodified-Since': modified } : {}) });
        const result = results[0];
        this.state.transfers = results;
        this.transfersByWork.set(id, results);
        if (result.status === 'succeeded') {
            confirmed?.(result);
            const file = this.getWork(id).files.find(f => f.path === path);
            if (file) {
                this.releasePreview(file);
                file.preview = { kind: 'text', content };
                file.modified = '';
            }
            // A later HEAD alone cannot establish which body it describes. Compare a fresh
            // GET with the saved bytes when PUT does not return a version.
            if (!result.modified) {
                try {
                    const fresh = await this.readFile(id, path);
                    if (fresh.preview?.kind === 'text' && fresh.preview.content === content)
                        result.modified = fileVersion(fresh.modified);
                }
                catch {
                    result.message = localizedText('d.error.savedVersionUnconfirmed');
                }
            }
            if (file)
                file.modified = result.modified ?? '';
        }
        this.emit();
        return result;
    }
    async transfer(id, action, paths, destination, overwrite = false) {
        const results = [];
        if (action === 'mkdir')
            results.push(...await this.writeFile(id, destination, 'MKCOL'));
        else
            for (const path of paths) {
                const headers = {};
                if (action === 'copy' || action === 'move') {
                    headers.Destination = new URL(this.fileURL(id, destination), location.origin).href;
                    headers.Overwrite = overwrite ? 'T' : 'F';
                    if (action === 'copy')
                        headers.Depth = 'infinity';
                }
                results.push(...await this.writeFile(id, path, action === 'delete' ? 'DELETE' : action.toUpperCase(), undefined, headers));
            }
        this.state.transfers = results;
        this.transfersByWork.set(id, results);
        this.emit();
        return results;
    }
    fileAdmissionReason(id) {
        const work = this.getWork(id);
        return !work ? t('d.error.originalWorkUnavailable') : !this.project(work).usable ? this.project(work).explanation || t('d.error.confirmWorkRunning') : '';
    }
    async upload(id, directory, files, overwrite = false) {
        const epoch = this.epoch, results = [];
        const publish = () => { if (epoch === this.epoch) {
            this.state.transfers = [...results];
            this.transfersByWork.set(id, [...results]);
            this.emit();
        } };
        try {
            for (const [index, file] of files.entries()) {
                if (!file.name || /[\\/\x00]/.test(file.name))
                    throw new Error(t('d.error.invalidUploadName'));
                const path = (directory === '/' ? '' : directory) + '/' + file.name, key = `${id}:${path}`;
                const admission = () => epoch !== this.epoch ? t('d.error.uploadStopped') : this.fileAdmissionReason(id);
                let reason = admission();
                if (reason) {
                    results.push({ path, status: 'failed', notSubmitted: true, message: t('d.error.notSubmitted', { reason }) });
                    publish();
                    continue;
                }
                this.uploadProgress.set(id, { workId: id, scope: 'files', path, phase: t('d.action.checkingTarget'), index: index + 1, count: files.length });
                this.emit();
                // Emitting progress may itself reveal a newer accepted control. Check at dispatch.
                reason = admission();
                if (reason) {
                    results.push({ path, status: 'failed', notSubmitted: true, message: t('d.error.notSubmitted', { reason }) });
                    publish();
                    continue;
                }
                let existing;
                try {
                    existing = await fetch(this.fileURL(id, path), { method: 'HEAD', credentials: 'same-origin' });
                }
                catch {
                    results.push({ path, status: 'failed', notSubmitted: true, message: t('d.error.targetCheckFailed') });
                    publish();
                    continue;
                }
                reason = admission();
                if (reason) {
                    results.push({ path, status: 'failed', notSubmitted: true, message: t('d.error.notSubmitted', { reason }) });
                    publish();
                    continue;
                }
                if (!existing.ok && existing.status !== 404) {
                    results.push({ path, status: 'failed', notSubmitted: true, httpStatus: existing.status, message: t('d.error.targetCheckStatus', { status: existing.status }) });
                    publish();
                    continue;
                }
                const version = fileVersion(existing.headers.get('Last-Modified')), absent = existing.status === 404;
                const intent = this.uploadIntents.get(key);
                if (!absent && (!overwrite || !intent || intent.file !== file || intent.absent || intent.modified !== version)) {
                    this.uploadIntents.set(key, { file, modified: version, absent: false });
                    results.push({ path, status: 'failed', notSubmitted: true, needsConsent: true, message: intent && overwrite ? t('d.error.targetChangedSinceConfirm') : version ? t('d.error.targetExists') : t('d.error.targetExistsNoTime') });
                    publish();
                    continue;
                }
                const headers = { 'Content-Type': file.type || 'application/octet-stream', ...(absent ? { 'If-None-Match': '*' } : version ? { 'If-Unmodified-Since': intent.modified } : {}) };
                reason = admission();
                if (reason) {
                    results.push({ path, status: 'failed', notSubmitted: true, message: t('d.error.notSubmitted', { reason }) });
                    publish();
                    continue;
                }
                const written = await this.writeFile(id, path, 'PUT', file, headers);
                results.push(...written);
                publish();
                if (written.every(r => r.status === 'succeeded'))
                    this.uploadIntents.delete(key);
                // Unknown PUTs retain their original evidence; no PUT is automatically repeated.
            }
            return results;
        }
        finally {
            if (epoch === this.epoch) {
                this.uploadProgress.delete(id);
                publish();
            }
        }
    }
    async saveConfiguration(id, config) { const raw = synchronizeConfiguration(config); await this.request(`works/${part(id)}/configuration`, 'PUT', { configuration: raw }); this.getWork(id).config = structuredClone(config); this.emit(); }
    async replaceSkill(id, name) { const work = this.getWork(id); const skills = Array.from(new Set([...work.config.skills, name])); await this.request(`works/${part(id)}/configuration/skills`, 'PUT', { skills }); work.config = { ...work.config, skills }; this.emit(); }
    async applyConfiguration(id) { return this.accepted(await this.request(`works/${part(id)}/configuration/apply`, 'POST'), id, 'Apply configuration'); } // i18n-exempt: Operation kind 协议值，app.ts 按英文比较
    async installPackage(id, name, sourceLabel, files, updateTarget) {
        this.assertCoreReady();
        const kind = sourceLabel.split(': ')[0];
        const spec = sourceLabel.slice(kind.length + 2);
        let source;
        if (kind === 'Core')
            source = { kind: 'core', name };
        else if (kind === 'npm' || kind === 'Git')
            source = { kind: kind === 'Git' ? 'git' : 'npm', spec };
        else {
            if (!files?.length)
                throw new Error(t('d.error.choosePackageFiles'));
            const form = new FormData();
            form.set('kind', kind === 'ZIP' ? 'zip' : 'local');
            for (const file of files)
                form.append(kind === 'ZIP' ? 'zip' : 'files', file, file.webkitRelativePath || file.name);
            const epoch = this.epoch;
            this.uploadProgress.set(id, { workId: id, scope: 'package', path: name, phase: t('d.action.uploadingPackage') });
            this.emit();
            const response = await this.uploadResponse(`/_desktop/api/works/${part(id)}/package-uploads`, 'POST', form, { 'X-Piwork-Csrf': this.csrf }, (sent, total, sentAll) => { const progress = this.uploadProgress.get(id); if (epoch === this.epoch && progress) {
                Object.assign(progress, sentAll ? { phase: t('d.action.validatingForwarding') } : { phase: t('d.action.uploadingPackage'), transferred: sent, total });
                this.emit();
            } });
            const value = await response.json();
            if (!response.ok)
                throw failure('PACKAGE_UPLOAD_FAILED', 'd.error.packageUploadFailed', undefined, response.status, undefined, typeof value.message === 'string' && value.message ? value.message : undefined);
            source = { kind: 'upload', uploadId: value.uploadId };
            this.uploadProgress.delete(id);
            this.emit();
        }
        return this.accepted(await this.request(`works/${part(id)}/packages${updateTarget ? `/${part(updateTarget)}/update` : ''}`, 'POST', { source }), id, updateTarget ? 'Update Pi Package' : 'Install Pi Package'); // i18n-exempt: Operation kind 协议值
    }
    async removePackage(id, name) { return this.accepted(await this.request(`works/${part(id)}/packages/${part(name)}`, 'DELETE'), id, 'Remove Pi Package'); } // i18n-exempt: Operation kind 协议值
    async cleanupInspection(id) {
        const pending = this.cleanupPending.get(id);
        if (!pending || pending.localSession !== this.csrf)
            return;
        try {
            const response = await fetch(`/_desktop/api/work-packages/${part(id)}`, { method: 'DELETE', credentials: 'same-origin', headers: { 'X-Piwork-Csrf': pending.localSession } });
            if (this.cleanupPending.get(id) !== pending)
                return;
            if (response.ok || response.status === 404)
                this.cleanupPending.delete(id);
            else
                pending.message = localizedText('d.error.cleanupUnconfirmed', { status: response.status });
        }
        catch {
            if (this.cleanupPending.get(id) === pending)
                pending.message = localizedText('d.error.cleanupResponseLost');
        }
        this.emit();
    }
    async abandonInspection(invalidateSelection = true) {
        if (invalidateSelection)
            this.inspectionSelection++;
        const context = this.inspectionContext;
        if (!context || context.importState !== 'unsubmitted')
            return;
        this.inspectionContext = null;
        this.inspectionNonce++;
        context.xhr?.abort();
        this.inspection = null;
        this.inspectionTransfer = '';
        this.transferProgress = null;
        this.cleanupPending.set(context.id, { message: t('d.error.releasingTransfer'), localSession: context.localSession });
        this.emit();
        await this.cleanupInspection(context.id);
    }
    abandonInspectionOnUnload() {
        const context = this.inspectionContext;
        if (context?.importState === 'unsubmitted') {
            context.xhr?.abort();
            void fetch(`/_desktop/api/work-packages/${part(context.id)}`, { method: 'DELETE', credentials: 'same-origin', keepalive: true, headers: { 'X-Piwork-Csrf': context.localSession } }).catch(() => undefined);
        }
    }
    async inspectWork(file) {
        this.assertCoreReady();
        if (this.inspectionContext && this.inspectionContext.importState !== 'unsubmitted')
            throw new Error(t('d.error.importAlreadySubmitted'));
        const selection = ++this.inspectionSelection;
        await this.abandonInspection(false);
        if (selection !== this.inspectionSelection)
            return;
        const context = { id: randomUUID(), nonce: ++this.inspectionNonce, core: this.state.core.address, localSession: this.csrf, anonymous: !this.state.signedIn, ready: false, importState: 'unsubmitted' };
        this.inspectionContext = context;
        this.inspectionTransfer = context.id;
        this.inspection = null;
        const current = () => this.inspectionContext === context && context.nonce === this.inspectionNonce;
        this.transferProgress = { phase: 'receiving', transferred: 0, total: file.size };
        this.emit();
        let polling = true;
        const observe = async () => { while (polling && current()) {
            await new Promise(resolve => setTimeout(resolve, 500));
            if (!polling || !current())
                break;
            try {
                const progress = await this.request(`work-packages/${part(context.id)}`);
                if (polling && current()) {
                    this.transferProgress = progress;
                    this.emit();
                }
            }
            catch { /* The upload may not yet have reserved its ID. */ }
        } };
        void observe();
        try {
            const value = await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                context.xhr = xhr;
                xhr.open('POST', '/_desktop/api/work-packages');
                xhr.withCredentials = true;
                xhr.setRequestHeader('Content-Type', 'application/vnd.piwork.work-package');
                xhr.setRequestHeader('X-Piwork-Csrf', context.localSession);
                xhr.setRequestHeader('X-Piwork-Transfer-Id', context.id);
                xhr.onload = () => {
                    if (!current()) {
                        if (context.importState === 'unsubmitted' && context.localSession === this.csrf) {
                            this.cleanupPending.set(context.id, { message: t('d.error.releasingLateTransfer'), localSession: context.localSession });
                            void this.cleanupInspection(context.id);
                        }
                        reject(failure('INSPECTION_ABANDONED', 'd.error.inspectionAbandoned'));
                        return;
                    }
                    let value;
                    try {
                        value = JSON.parse(xhr.responseText);
                    }
                    catch {
                        reject(new Error(t('d.error.inspectionUnreadable')));
                        return;
                    }
                    if (xhr.status >= 200 && xhr.status < 300 && value.summary && value.transferId === context.id)
                        resolve(value);
                    else
                        reject(failure('PACKAGE_INSPECTION_FAILED', 'd.error.packageInspectionFailed', undefined, xhr.status, undefined, typeof value.message === 'string' && value.message ? value.message : undefined));
                };
                xhr.onerror = () => reject(new Error(t('d.error.localTransferInterrupted')));
                xhr.onabort = () => reject(new Error(t('d.error.localUploadCancelled')));
                xhr.send(file);
            });
            if (!current())
                return;
            context.ready = true;
            this.inspection = value.summary;
            this.transferProgress = { phase: 'ready', transferred: file.size, total: file.size };
            return context.id;
        }
        catch (error) {
            if (current()) {
                this.transferProgress = { phase: 'failed', error: errorText(error) };
                throw error;
            }
        }
        finally {
            polling = false;
            if (current()) {
                context.xhr = undefined;
                this.emit();
            }
        }
    }
    async checkInspectionImport() {
        const context = this.inspectionContext;
        if (!context || !['unknown', 'accepted'].includes(context.importState))
            return;
        const state = context.importState;
        const generation = context.observationGeneration = (context.observationGeneration || 0) + 1;
        // A recovery read must start after the failed submission; an in-flight
        // progress read may have observed ready before Core received the request.
        // Explicit task-row checks remain available while dialog observation is paused.
        const value = await this.requestOnce(`work-packages/${part(context.id)}`);
        if (this.inspectionContext !== context || context.importState !== state || context.observationGeneration !== generation)
            return;
        if (value.transferId !== undefined && value.transferId !== context.id)
            throw failure('INVALID_RESPONSE', 'd.error.importTransferMismatch');
        if (value.phase === 'ready' && state === 'unknown') {
            context.importState = 'unsubmitted';
            this.transferProgress = null;
        }
        else if (value.phase === 'accepted') {
            if (typeof value.operationId === 'string' && value.operationId) {
                if (context.operationId && context.operationId !== value.operationId)
                    throw failure('INVALID_RESPONSE', 'd.error.operationMismatch');
                const existing = this.getOperation(value.operationId);
                if (existing && value.workId && existing.workId && existing.workId !== value.workId)
                    throw failure('INVALID_RESPONSE', 'd.error.operationOtherWork');
                if (!existing)
                    this.accepted(value, '', 'Import Work'); // i18n-exempt: internal Operation kind
                context.operationId = value.operationId;
                if (context.observationSuspended && !this.pausedOperations.has(value.operationId)) {
                    context.autoPausedOperation = true;
                    this.pauseOperation(value.operationId);
                    this.scheduleOperationPoll();
                }
            }
            context.importState = 'accepted';
        }
        this.emit();
    }
    suspendImportObservation() {
        const context = this.inspectionContext;
        if (!context || context.importState === 'unsubmitted')
            return;
        context.observationSuspended = true;
        context.observationGeneration = (context.observationGeneration || 0) + 1;
        if (context.operationId && !this.pausedOperations.has(context.operationId)) {
            context.autoPausedOperation = true;
            this.pauseOperation(context.operationId);
        }
        this.scheduleOperationPoll();
    }
    suspendImportOperation(id) {
        if (this.inspectionContext?.operationId === id) {
            this.suspendImportObservation();
            return;
        }
        if (!this.pausedOperations.has(id)) {
            this.closedImportOperations.add(id);
            this.pauseOperation(id);
            this.scheduleOperationPoll();
        }
    }
    resumeImportOperation(id) {
        if (this.inspectionContext?.operationId === id)
            this.resumeImportObservation();
        if (this.closedImportOperations.delete(id))
            this.resumeOperation(id);
    }
    prepareNewImport() {
        const context = this.inspectionContext;
        const operation = context?.operationId ? this.getOperation(context.operationId) : undefined;
        if (!context?.observationSuspended || !operation || !terminalOperation(operation.state))
            return false;
        if (context.autoPausedOperation)
            this.resumeOperation(operation.id);
        this.inspectionContext = null;
        this.inspectionNonce++;
        this.inspection = null;
        this.inspectionTransfer = '';
        this.transferProgress = null;
        return true;
    }
    resumeImportObservation() {
        const context = this.inspectionContext;
        if (!context?.observationSuspended)
            return;
        context.observationSuspended = false;
        if (context.operationId && context.autoPausedOperation) {
            context.autoPausedOperation = false;
            this.resumeOperation(context.operationId);
        }
        if (context.importState === 'submitting')
            this.observeImportSubmission(context);
        else if (context.importState === 'unknown')
            void this.checkInspectionImport().catch(() => undefined);
    }
    observeImportSubmission(context) {
        const generation = context.observationGeneration = (context.observationGeneration || 0) + 1;
        const current = () => this.inspectionContext === context && context.importState === 'submitting' && !context.observationSuspended && context.observationGeneration === generation;
        const observe = async () => {
            while (current()) {
                await new Promise(resolve => setTimeout(resolve, 500));
                if (!current())
                    break;
                try {
                    const progress = await this.request(`work-packages/${part(context.id)}`);
                    if (current()) {
                        this.transferProgress = progress;
                        this.emit();
                    }
                }
                catch { /* Keep the last confirmed stage while the request is pending. */ }
            }
        };
        void observe();
    }
    async importWork(name) {
        this.assertCoreReady();
        const context = this.inspectionContext;
        if (!context?.ready || !this.inspectionTransfer)
            throw new Error(t('d.error.inspectPackageFirst'));
        if (context.importState !== 'unsubmitted')
            throw new Error(t('d.error.importState', { state: context.importState, id: context.id }));
        if (context.core !== this.state.core.address || context.localSession !== this.csrf || !this.state.signedIn)
            throw new Error(t('d.error.signInBeforeImport'));
        const sourceName = !name && typeof this.inspection?.sourceName === 'string' ? this.inspection.sourceName : undefined;
        context.importState = 'submitting';
        this.transferProgress = null;
        this.emit();
        this.observeImportSubmission(context);
        try {
            const value = await this.request('work-imports', 'POST', { transferId: context.id, ...(name ? { name } : {}) });
            if (this.inspectionContext !== context)
                throw failure('CONNECTION_CHANGED', 'd.error.importIdentity');
            // Missing acceptance identity is also unknown; never offer a second POST.
            const operation = this.accepted(value, '', 'Import Work');
            operation.importSourceName = sourceName;
            context.operationId = operation.id;
            context.importState = 'accepted'; // i18n-exempt: Operation kind 协议值
            if (context.observationSuspended && !this.pausedOperations.has(operation.id)) {
                context.autoPausedOperation = true;
                this.pauseOperation(operation.id);
                this.scheduleOperationPoll();
            }
            this.emit();
            return operation;
        }
        catch (error) {
            if (this.inspectionContext === context) {
                context.importState = 'unknown';
                this.emit();
                // The CLI may have attempted Core Import even when a gateway returned an
                // HTTP error. Only confirmed local ready state permits a new explicit POST.
                if (!context.observationSuspended)
                    await this.checkInspectionImport().catch(() => undefined);
            }
            throw error;
        }
    }
    async prepareExport(id) {
        this.assertCoreReady();
        const value = await this.request(`works/${part(id)}/exports`, 'POST');
        if (value.workId !== id || typeof value.snapshotId !== 'string' || !value.snapshotId || typeof value.operationId !== 'string' || !value.operationId)
            throw failure('RESULT_UNKNOWN', 'd.error.exportAcceptanceIncomplete');
        return this.accepted(value, id, 'Export Work'); // i18n-exempt: Operation kind 协议值
    }
    async fetchSnapshot(id, explicit = true, expectedWorkId) {
        const epoch = this.epoch;
        const { value } = await this.readMetadata(`work-snapshots/${part(id)}`, explicit);
        if (epoch !== this.epoch)
            throw failure('CONNECTION_CHANGED', 'd.error.snapshotIdentityEnded');
        const known = this.getSnapshot(id);
        if (value.snapshotId !== id || typeof value.workId !== 'string' || !value.workId || expectedWorkId && value.workId !== expectedWorkId || typeof value.operationId !== 'string' || !value.operationId ||
            known && (known.workId !== value.workId || known.operationId !== value.operationId))
            throw failure('SNAPSHOT_MISMATCH', 'd.error.snapshotMismatch');
        if (!['accepted', 'pending', 'preparing', 'running', 'succeeded', 'failed', 'superseded'].includes(value.state))
            throw failure('INVALID_RESPONSE', 'd.error.snapshotStatusUnconfirmed');
        // Package facts are immutable. Missing later metadata cannot revive an expired package.
        const expiresAt = typeof known?.expiresAt === 'string' && (typeof value.expiresAt !== 'string' || Date.parse(value.expiresAt) >= Date.parse(known.expiresAt)) ? known.expiresAt : typeof value.expiresAt === 'string' ? value.expiresAt : known?.expiresAt ?? value.expiresAt;
        const packageSize = typeof value.size === 'number' && Number.isFinite(value.size) && value.size >= 0 ? value.size : known?.packageSize ?? value.size;
        const digest = typeof value.digest === 'string' ? value.digest : known?.digest ?? value.digest;
        const expired = known?.status === 'expired' || typeof expiresAt === 'string' && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now());
        const unavailable = value.state === 'succeeded' && value.size === null && value.digest === null && value.expiresAt === null;
        const snapshot = known ?? { id, workId: value.workId, operationId: value.operationId, status: 'preparing', filename: `${value.workId}.work`, size: '' };
        Object.assign(snapshot, { expiresAt, packageSize, digest,
            status: expired ? 'expired' : unavailable ? 'unavailable' : ['failed', 'superseded'].includes(value.state) ? 'failed' : value.state === 'succeeded' ? 'verified' : 'preparing',
            size: typeof packageSize === 'number' ? t('d.error.sizeBytes', { size: packageSize }) : '',
            error: value.error?.message ?? (typeof value.error === 'string' ? value.error : unavailable ? localizedText('d.error.snapshotUnavailable') : undefined) });
        if (!known)
            this.state.snapshots.push(snapshot);
        this.emit();
        return snapshot;
    }
    stopDownloadObservers() { for (const observer of this.downloadObservers.values())
        observer.active = false; this.downloadObservers.clear(); }
    validateDownload(value, job) {
        const snapshot = this.getSnapshot(job.snapshotId);
        if (value.transferId !== job.transferId || value.snapshotId !== undefined && value.snapshotId !== job.snapshotId ||
            value.workId !== undefined && value.workId !== job.workId || value.kind !== undefined && value.kind !== 'download' ||
            value.ready && (value.snapshotId !== job.snapshotId || value.workId !== job.workId ||
                snapshot?.packageSize != null && value.size !== snapshot.packageSize || snapshot?.digest != null && value.digest !== snapshot.digest))
            throw failure('SNAPSHOT_MISMATCH', 'd.error.transferMismatch');
    }
    async checkDownload(snapshotID, explicit = true) {
        const job = this.downloads.get(snapshotID);
        if (!job)
            throw new Error(t('d.error.noOriginalTransfer'));
        const epoch = this.epoch;
        try {
            const value = await this.metadata.read(this.metadataKey(`downloads/${part(job.transferId)}`), async (signal) => {
                try {
                    return await this.request(`downloads/${part(job.transferId)}`, 'GET', undefined, signal);
                }
                catch (error) {
                    // The preparation may not yet have claimed its local ID. This is not a lost POST retry.
                    if (error instanceof DesktopError && error.httpStatus === 404 && job.pending && !job.seen)
                        return null;
                    throw error;
                }
            }, explicit);
            if (epoch !== this.epoch || this.downloads.get(snapshotID) !== job)
                throw failure('CONNECTION_CHANGED', 'd.error.transferAccessEnded');
            if (!value)
                return job;
            this.validateDownload(value, job);
            if (!job.ready && !job.terminalFailure)
                Object.assign(job, value, { seen: true, checkedAt: new Date().toISOString(), observationError: '', error: '' });
            else {
                job.checkedAt = new Date().toISOString();
                job.observationError = '';
            }
            this.emit();
            return job;
        }
        catch (error) {
            if (epoch !== this.epoch || this.downloads.get(snapshotID) !== job)
                throw error;
            // A read that began before a valid ready POST cannot roll that confirmed result back.
            if (!job.ready)
                job.observationError = errorText(error);
            this.emit();
            throw error;
        }
    }
    observeDownload(snapshotID) {
        if (this.downloadObservers.has(snapshotID))
            return;
        const job = this.downloads.get(snapshotID);
        if (!job || job.ready || job.terminalFailure)
            return;
        const observer = { active: true };
        this.downloadObservers.set(snapshotID, observer);
        void (async () => {
            try {
                while (observer.active && this.downloads.get(snapshotID) === job && !job.ready && !job.error) {
                    await new Promise(resolve => { const timer = setTimeout(resolve, 500); if (typeof timer === 'object' && 'unref' in timer)
                        timer.unref(); });
                    if (!observer.active)
                        break;
                    try {
                        await this.checkDownload(snapshotID, false);
                    }
                    catch {
                        break;
                    }
                }
            }
            finally {
                if (this.downloadObservers.get(snapshotID) === observer)
                    this.downloadObservers.delete(snapshotID);
            }
        })();
    }
    retryDownloadSnapshot(id) {
        const job = this.downloads.get(id);
        if (!job?.terminalFailure || job.pending || this.downloadRequests.has(id))
            return Promise.reject(failure('RESULT_UNKNOWN', 'd.error.onlyFailedRetry'));
        const observer = this.downloadObservers.get(id);
        if (observer)
            observer.active = false;
        this.downloadObservers.delete(id);
        this.downloads.delete(id);
        return this.downloadSnapshot(id);
    }
    downloadSnapshot(id) {
        const old = this.downloads.get(id), known = this.downloadRequests.get(id);
        if (old?.ready)
            return Promise.resolve(`/_desktop/api/downloads/${part(old.transferId)}/content`);
        if (known) {
            this.observeDownload(id);
            return known;
        }
        if (old)
            return Promise.reject(failure('RESULT_UNKNOWN', 'd.error.transferAlreadyKnown'));
        const snapshot = this.getSnapshot(id);
        if (!snapshot || snapshot.status !== 'verified' || snapshot.expiresAt && Date.parse(snapshot.expiresAt) <= Date.now())
            return Promise.reject(failure('SNAPSHOT_NOT_READY', 'd.error.checkSnapshotBeforeDownload'));
        const epoch = this.epoch;
        const job = { transferId: randomUUID(), snapshotId: id, workId: snapshot.workId, phase: t('d.export.downloadPreparing'), pending: true, seen: false, transferred: 0 };
        this.downloads.set(id, job);
        this.emit();
        this.observeDownload(id);
        let pending;
        pending = (async () => {
            try {
                const value = await this.requestOnce(`work-snapshots/${part(id)}/downloads`, 'POST', {}, undefined, { 'X-Piwork-Transfer-Id': job.transferId });
                if (epoch !== this.epoch || this.downloads.get(id) !== job)
                    throw failure('CONNECTION_CHANGED', 'd.error.identityChangedTransfer');
                this.validateDownload(value, job);
                if (!value.ready)
                    throw failure('RESULT_UNKNOWN', 'd.error.downloadConfirmationIncomplete');
                // Native ready POST publishes size only after full verification; it omits progress fields.
                Object.assign(job, value, { phase: 'ready', transferred: value.size, total: value.size, checkedAt: new Date().toISOString(), observationError: '', error: '', terminalFailure: false });
                return `/_desktop/api/downloads/${part(job.transferId)}/content`;
            }
            catch (error) {
                const rejected = error instanceof DesktopError ? error : failure('RESULT_UNKNOWN', 'd.error.downloadResponseLost');
                if (epoch === this.epoch && this.downloads.get(id) === job && !job.ready) {
                    // These public CLI failures conclusively rejected/removed preparation. Unknown transport results remain locked.
                    const terminalFailure = ['TRANSFER_STORAGE_FULL', 'PACKAGE_CHANGED', 'SNAPSHOT_MISMATCH', 'SNAPSHOT_NOT_READY', 'PACKAGE_EXPIRED', 'PACKAGE_INVALID', 'PACKAGE_LIMIT_EXCEEDED'].includes(rejected.code) && rejected.httpStatus !== undefined ||
                        rejected.code === 'TRANSFER_BUSY' && rejected.httpStatus === 429 || ['CORE_UNAVAILABLE', 'TRANSFER_UNAVAILABLE'].includes(rejected.code) && rejected.httpStatus === 503 ||
                        rejected.code === 'SNAPSHOT_DOWNLOAD_FAILED' && rejected.httpStatus !== undefined && rejected.httpStatus >= 400 && rejected.httpStatus <= 599;
                    Object.assign(job, { error: errorText(rejected), errorCode: rejected.code, terminalFailure, phase: terminalFailure ? 'failed' : t('d.action.notConfirmed') });
                }
                throw rejected;
            }
            finally {
                if (epoch === this.epoch && this.downloads.get(id) === job) {
                    job.pending = false;
                    this.emit();
                }
                if (this.downloadRequests.get(id) === pending)
                    this.downloadRequests.delete(id);
            }
        })();
        this.downloadRequests.set(id, pending);
        return pending;
    }
}
export const adapter = new DesktopAdapter();
//# sourceMappingURL=adapter.js.map