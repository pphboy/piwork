import { randomUUID } from './browser-crypto.js';

type Data = Record<string, any>;
export type SessionManagementKind = 'rename' | 'auto-name' | 'delete';
export type SessionManagementPhase = 'pending' | 'unknown' | 'failed';
export interface SessionManagementState {
  workId: string; sessionId: string; title: string | null; titleSource: 'default' | 'manual' | 'auto';
  revision: number; manualLock: boolean; deletedAt: string | null;
  autoState: 'eligible' | 'pending' | 'completed' | 'failed' | 'unknown';
}
export interface SessionManagementOperation {
  workId: string; sessionId: string; kind: SessionManagementKind; key: string; expectedRevision: number;
  phase: SessionManagementPhase; automaticChecks: number;
}
export interface SessionManagementPort {
  identity(): number;
  request(path: string, method?: string, body?: unknown): Promise<Data>;
  revision(workId: string, sessionId: string): number | undefined;
  canObserve(workId: string, sessionId: string): boolean;
  apply(state: SessionManagementState): void;
  emit(): void;
  error(code: string, key: string): Error;
}

export function sessionManagementState(value: Data, workId: string, sessionId: string): SessionManagementState | undefined {
  if (!value || value.workId !== workId || value.sessionId !== sessionId || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !['default', 'manual', 'auto'].includes(value.titleSource) || typeof value.manualLock !== 'boolean'
    || (value.titleSource === 'manual' && !value.manualLock)
    || !['eligible', 'pending', 'completed', 'failed', 'unknown'].includes(value.autoState)
    || (value.titleSource === 'default' ? value.title !== null : typeof value.title !== 'string' || !value.title.trim() || value.title.includes('\0') || [...value.title].length > 120 || new TextEncoder().encode(value.title).length > 480 || value.revision < 1)
    || (value.deletedAt !== null && (typeof value.deletedAt !== 'string' || !Number.isFinite(Date.parse(value.deletedAt)) || value.revision < 1))) return undefined;
  return value as SessionManagementState;
}

/** Owns original operation identity and read-only recovery for one Desktop identity. */
export class SessionManagementController {
  readonly capabilities = new Map<string, { loading: boolean; confirmed: boolean; supported: boolean; error: string }>();
  readonly operations = new Map<string, SessionManagementOperation>();
  private readonly capabilityReads = new Map<string, Promise<void>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly stateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private readonly port: SessionManagementPort) {}

  private objectKey(workId: string, sessionId: string) { return JSON.stringify([workId, sessionId]); }
  operation(workId: string, sessionId: string) { return this.operations.get(this.objectKey(workId, sessionId)); }

  reset(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const timer of this.stateTimers.values()) clearTimeout(timer);
    this.stateTimers.clear();
    this.timers.clear();
    this.operations.clear();
    this.capabilities.clear();
    this.capabilityReads.clear();
  }

  async loadCapabilities(workId: string): Promise<void> {
    const pending = this.capabilityReads.get(workId);
    if (pending) return pending;
    const epoch = this.port.identity();
    const state = this.capabilities.get(workId) ?? { loading: false, confirmed: false, supported: false, error: '' };
    state.loading = true;
    this.capabilities.set(workId, state);
    this.port.emit();
    const read = (async () => {
      try {
        const value = await this.port.request(`works/${encodeURIComponent(workId)}/session-management-capabilities`);
        if (epoch !== this.port.identity() || this.capabilities.get(workId) !== state) return;
        if (value.contractVersion !== 0 && value.contractVersion !== 1) throw this.port.error('INVALID_RESPONSE', 'd.error.invalidResponse');
        Object.assign(state, { confirmed: true, supported: value.contractVersion === 1, error: '' });
      } catch (error) {
        if (epoch !== this.port.identity() || this.capabilities.get(workId) !== state) return;
        const status = (error as { httpStatus?: number }).httpStatus;
        if (status === 404 || status === 501) Object.assign(state, { confirmed: true, supported: false, error: '' });
        else Object.assign(state, { confirmed: false, supported: false, error: String((error as Error).message || error) });
      } finally {
        if (epoch === this.port.identity() && this.capabilities.get(workId) === state) {
          state.loading = false;
          this.port.emit();
        }
      }
    })().finally(() => { if (this.capabilityReads.get(workId) === read) this.capabilityReads.delete(workId); });
    this.capabilityReads.set(workId, read);
    return read;
  }

  async readState(workId: string, sessionId: string): Promise<SessionManagementState> {
    const epoch = this.port.identity();
    const raw = await this.port.request(`works/${encodeURIComponent(workId)}/sessions/${encodeURIComponent(sessionId)}/management`);
    if (epoch !== this.port.identity()) throw this.port.error('CONNECTION_CHANGED', 'd.error.coreAccountChanged');
    const state = sessionManagementState(raw, workId, sessionId);
    if (!state) throw this.port.error('INVALID_RESPONSE', 'd.error.invalidResponse');
    this.port.apply(state);
    this.port.emit();
    return state;
  }

  /** Observe only the selected Session; stop after a bounded number of reads. */
  observeAutomatic(workId: string, sessionId: string, remaining = 30): void {
    const object = this.objectKey(workId, sessionId), epoch = this.port.identity();
    if (remaining <= 0 || this.stateTimers.has(object) || !this.capabilities.get(workId)?.supported || !this.port.canObserve(workId, sessionId)) return;
    const timer = setTimeout(() => {
      this.stateTimers.delete(object);
      if (epoch !== this.port.identity() || !this.port.canObserve(workId, sessionId)) return;
      void this.readState(workId, sessionId).then(state => {
        if (state.autoState === 'pending') this.observeAutomatic(workId, sessionId, remaining - 1);
      }).catch(() => undefined);
    }, 1_000);
    this.stateTimers.set(object, timer);
  }

  async start(workId: string, sessionId: string, kind: SessionManagementKind, title?: string): Promise<SessionManagementState | undefined> {
    const capability = this.capabilities.get(workId);
    if (!capability?.confirmed || !capability.supported) throw this.port.error('CHAT_OPTIONS_UNSUPPORTED', 'd.error.chatControlsUnsupported');
    const object = this.objectKey(workId, sessionId), existing = this.operations.get(object);
    if (existing && existing.phase !== 'failed') throw this.port.error('RESULT_UNKNOWN', 'd.error.checkOriginalSubmission');
    const revision = this.port.revision(workId, sessionId);
    if (!Number.isSafeInteger(revision) || revision! < 0) throw this.port.error('INVALID_RESPONSE', 'd.error.invalidResponse');
    if (kind === 'rename' && (!title?.trim() || [...title.trim()].length > 120 || new TextEncoder().encode(title.trim()).length > 480)) throw this.port.error('INVALID_REQUEST', 'd.error.requestFailed');
    const epoch = this.port.identity(), key = randomUUID();
    const operation: SessionManagementOperation = { workId, sessionId, kind, key, expectedRevision: revision!, phase: 'pending', automaticChecks: 0 };
    this.operations.set(object, operation);
    this.port.emit();
    const action = kind === 'rename' ? 'name' : kind;
    try {
      const raw = await this.port.request(`works/${encodeURIComponent(workId)}/sessions/${encodeURIComponent(sessionId)}/${action}`, kind === 'rename' ? 'PATCH' : 'POST',
        { operationKey: key, expectedRevision: revision, ...(kind === 'rename' ? { title: title!.trim() } : {}) });
      if (epoch !== this.port.identity() || this.operations.get(object) !== operation) throw this.port.error('CONNECTION_CHANGED', 'd.error.coreAccountChanged');
      if (kind === 'auto-name') {
        if (raw.status === 'not-found') throw this.port.error('INVALID_RESPONSE', 'd.error.invalidResponse');
        return this.acceptLookup(operation, raw);
      }
      const state = sessionManagementState(raw, workId, sessionId);
      if (!state || state.revision !== revision! + 1 || (kind === 'delete' ? !state.deletedAt : state.deletedAt !== null || state.titleSource !== 'manual')) throw this.port.error('INVALID_RESPONSE', 'd.error.invalidResponse');
      this.port.apply(state);
      this.operations.delete(object);
      this.port.emit();
      return state;
    } catch (error) {
      if (epoch === this.port.identity() && this.operations.get(object) === operation) {
        const details = error as { code?: string; httpStatus?: number };
        operation.phase = ['RESULT_UNKNOWN', 'INVALID_RESPONSE', 'CONNECTION_CHANGED', 'CORE_UNAVAILABLE', 'RUNTIME_UNAVAILABLE', 'REQUEST_TIMEOUT'].includes(details.code ?? '') || (details.httpStatus ?? 0) >= 500 ? 'unknown' : 'failed';
        this.port.emit();
      }
      throw error;
    }
  }

  private acceptLookup(operation: SessionManagementOperation, raw: Data): SessionManagementState | undefined {
    const object = this.objectKey(operation.workId, operation.sessionId);
    if (raw.operationKey !== operation.key || !['pending', 'accepted', 'failed', 'unknown', 'not-found'].includes(raw.status)) throw this.port.error('INVALID_RESPONSE', 'd.error.invalidResponse');
    if (raw.status === 'not-found') {
      operation.phase = 'unknown';
      this.port.emit();
      return undefined;
    }
    if (raw.kind !== operation.kind) throw this.port.error('INVALID_RESPONSE', 'd.error.invalidResponse');
    const state = sessionManagementState(raw.state, operation.workId, operation.sessionId);
    if (!state) throw this.port.error('INVALID_RESPONSE', 'd.error.invalidResponse');
    if (raw.status === 'accepted' && (state.revision !== operation.expectedRevision + 1 || (operation.kind === 'delete' ? !state.deletedAt : state.deletedAt !== null || state.titleSource !== (operation.kind === 'rename' ? 'manual' : 'auto')))) throw this.port.error('INVALID_RESPONSE', 'd.error.invalidResponse');
    this.port.apply(state);
    if (raw.status === 'accepted') this.operations.delete(object);
    else if (raw.status === 'failed') operation.phase = 'failed';
    else if (raw.status === 'unknown') operation.phase = 'unknown';
    else {
      operation.phase = 'pending';
      if (operation.automaticChecks < 30) this.schedule(operation);
      else operation.phase = 'unknown';
    }
    this.port.emit();
    return state;
  }

  async check(workId: string, sessionId: string, automatic = false): Promise<SessionManagementState | undefined> {
    const object = this.objectKey(workId, sessionId), operation = this.operations.get(object);
    if (!operation) return undefined;
    if (automatic) operation.automaticChecks++;
    else operation.automaticChecks = 0;
    const epoch = this.port.identity();
    try {
      const raw = await this.port.request(`works/${encodeURIComponent(workId)}/sessions/${encodeURIComponent(sessionId)}/management-operations/${encodeURIComponent(operation.key)}`);
      if (epoch !== this.port.identity() || this.operations.get(object) !== operation) return undefined;
      return this.acceptLookup(operation, raw);
    } catch (error) {
      if (epoch === this.port.identity() && this.operations.get(object) === operation) {
        operation.phase = 'unknown';
        this.port.emit();
      }
      throw error;
    }
  }

  private schedule(operation: SessionManagementOperation): void {
    const object = this.objectKey(operation.workId, operation.sessionId);
    if (this.timers.has(object)) return;
    const epoch = this.port.identity();
    const timer = setTimeout(() => {
      this.timers.delete(object);
      if (epoch === this.port.identity() && this.operations.get(object) === operation && operation.phase === 'pending') void this.check(operation.workId, operation.sessionId, true).catch(() => undefined);
    }, 1_000);
    this.timers.set(object, timer);
  }
}
