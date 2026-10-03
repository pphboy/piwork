import type { Work, Operation, Snapshot, Configuration, WorkspaceFile, RunStatus } from './models.js';
import { synchronizeConfiguration } from './configuration.js';
import { parseEntries, mutationResults } from './files.js';
type Data = Record<string, any>;
export interface TransferResult { path: string; status: 'succeeded' | 'failed' | 'unknown'; message: string; httpStatus?: number; modified?: string; needsConsent?: boolean }
export function fileVersion(value: string | null | undefined): string {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toUTCString() : '';
}
interface InspectionContext { id: string; nonce: number; core: string; localSession: string; anonymous: boolean; ready: boolean; importState: 'unsubmitted' | 'submitting' | 'unknown' | 'accepted'; xhr?: XMLHttpRequest; operationId?: string }
interface UploadIntent { file: File; modified: string; absent: boolean }

export class DesktopError extends Error { constructor(public code: string, message: string, public httpStatus?: number) { super(message); } }
const part = encodeURIComponent;
const runStates: RunStatus[] = ['interrupted', 'accepted', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled', 'interrupted'];
const blankConfig = (): Configuration => ({ skills: [], packages: [], agents: '', advanced: '{}', revision: 0, activeRevision: 0, loaded: false, modelVisible: false });
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const stateLabel = (value: string) => ({ ready: 'Ready', running: 'Ready', stopped: 'Stopped', degraded: 'Degraded', starting: 'Starting', stopping: 'Stopping', failed: 'Failed', removed: 'Removed' }[value] ?? 'Unknown');
export class DesktopAdapter {
  state = { works: [] as Work[], operations: [] as Operation[], snapshots: [] as Snapshot[], scenario: 'loading', signedIn: false,
    core: { address: '', name: 'Core', account: '', role: '', proxyPort: '', username: '' }, transfers: [] as TransferResult[], lastChecked: '' };
  status: Data = {};
  inspection: Data | null = null;
  inspectionTransfer = '';
  transferProgress: Data | null = null;
  inspectionContext: InspectionContext | null = null;
  cleanupPending = new Map<string, { message: string; localSession: string }>();
  private inspectionNonce = 0;
  private inspectionSelection = 0;
  catalog = { skills: { loading: false, error: '', confirmed: false, checkedAt: '' }, packages: { loading: false, error: '', confirmed: false, checkedAt: '' } };
  logs = new Map<string, Data>();
  private uploadIntents = new Map<string, UploadIntent>();
  private csrf = '';
  private generation = -1;
  private epoch = 0;
  private listeners = new Set<() => void>();
  private skills: Data[] = [];
  private packages: Data[] = [];
  private entries = new Map<string, Data>();
  private entryPromises = new Map<string, Promise<void>>();
  private pausedOperations = new Set<string>();
  private streams = new Map<string, AbortController>();
  private reconnects = new Map<string, ReturnType<typeof setTimeout>>();
  private historyObservers = new Map<string, { controller: AbortController; run: NonNullable<Work['run']>; epoch: number; failures: number }>();
  private reconnectAttempts = new Map<string, number>();
  private pollTimer?: ReturnType<typeof setTimeout>;
  private sessionTimer?: ReturnType<typeof setTimeout>;
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit() { for (const listener of this.listeners) listener(); }
  getWork(id: string) { return this.state.works.find(work => work.id === id); }
  getSkills() { const copies = this.state.works.flatMap(work => work.config.skills).filter((name, i, all) => all.indexOf(name) === i && !this.skills.some(s => s.id === name)); return [...this.skills, ...copies.map(name => ({ id: name, name, description: 'Saved Work copy; unavailable in current Core catalog', version: null, loaded: null, modelVisible: null }))]; }
  getPackages() { return this.packages; }
  getSnapshot(id: string) { return this.state.snapshots.find(snapshot => snapshot.id === id); }
  private clearIdentity(preserveInspection = false) {
    const inspection = preserveInspection ? { context: this.inspectionContext, summary: this.inspection, transfer: this.inspectionTransfer, progress: this.transferProgress } : null;
    if (!preserveInspection) { this.inspectionSelection++; this.inspectionNonce++; this.inspectionContext?.xhr?.abort(); this.inspectionContext = null; this.transferProgress = null; this.cleanupPending.clear(); }
    this.epoch++; this.state.works = []; this.state.operations = []; this.state.snapshots = []; this.state.transfers = [];
    for (const status of Object.values(this.catalog)) Object.assign(status, { loading: false, error: '', confirmed: false, checkedAt: '' });
    this.uploadIntents.clear(); this.skills = []; this.packages = []; this.entries.clear(); this.logs.clear(); this.inspection = null; this.inspectionTransfer = '';
    if (inspection) { this.inspectionContext = inspection.context; this.inspection = inspection.summary; this.inspectionTransfer = inspection.transfer; this.transferProgress = inspection.progress; }
    for (const observer of this.historyObservers.values()) observer.controller.abort(); this.historyObservers.clear();
    for (const stream of this.streams.values()) stream.abort(); this.streams.clear(); for (const timer of this.reconnects.values()) clearTimeout(timer); this.reconnects.clear(); this.reconnectAttempts.clear(); clearTimeout(this.pollTimer);
  }
  private async request(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<Data> {
    const epoch = this.epoch;
    let response: Response;
    try { response = await fetch(`/_desktop/api/${path}`, { method, credentials: 'same-origin', signal, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Piwork-Csrf': this.csrf }, ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }) }); }
    catch { throw new DesktopError(method === 'GET' ? 'CORE_UNAVAILABLE' : 'RESULT_UNKNOWN', method === 'GET' ? 'The local connection is unavailable. Check the CLI and Core.' : 'The response was lost. Check known operations before submitting again.'); }
    if (epoch !== this.epoch) throw new DesktopError('CONNECTION_CHANGED', 'The Core or account changed. This response was discarded.');
    const value = await response.json().catch(() => null);
    if (epoch !== this.epoch) throw new DesktopError('CONNECTION_CHANGED', 'The identity changed while reading the response.');
    if (!response.ok) {
      const code = value?.code ?? `HTTP_${response.status}`;
      if (['LOCAL_AUTH_REQUIRED', 'LOCAL_CSRF_OR_AUTH_REQUIRED'].includes(code)) { this.clearIdentity(); this.state.signedIn = false; this.state.scenario = 'ticket-expired'; this.emit(); }
      else if (response.status === 401 && path !== 'login') { const session = await fetch('/_desktop/api/session', { credentials: 'same-origin' }).then(r => r.json()).catch(() => null); if (epoch !== this.epoch) throw new DesktopError('CONNECTION_CHANGED', 'The identity changed during authentication readback.'); if (session?.state === 'offline') { this.state.scenario = 'core-offline'; this.emit(); throw new DesktopError('CORE_UNAVAILABLE', 'Core is unreachable. Last confirmed data is preserved.'); } this.clearIdentity(); this.state.signedIn = false; this.state.scenario = 'auth-expired'; this.emit(); }
      throw new DesktopError(code, value?.message ?? `Request failed (${response.status}).`, response.status);
    }
    if (!value || typeof value !== 'object') throw new DesktopError('INVALID_RESPONSE', 'The server returned an invalid response.');
    return value;
  }
  private acceptSession(value: Data) {
    const changed = this.generation !== value.generation; const previouslySignedIn = this.state.signedIn;
    if (this.generation !== -1 && this.generation !== value.generation) {
      const context = this.inspectionContext;
      const preserve = !!context && context.anonymous && context.ready && context.importState === 'unsubmitted' && !this.state.signedIn && ['authenticated', 'signed-out'].includes(value.state) && context.core === value.coreUrl && context.localSession === value.csrf;
      this.clearIdentity(preserve);
      if (preserve && value.state === 'authenticated') context.anonymous = false;
    }
    this.generation = value.generation; this.csrf = value.csrf ?? this.csrf;
    this.state.core.address = value.coreUrl ?? ''; this.state.core.name = 'Core';
    const user = value.user ?? value.lastKnownUser;
    this.state.core.account = user?.account ?? ''; this.state.core.role = user?.role ?? '';
    this.state.signedIn = value.state === 'authenticated' || value.state === 'offline' && !!value.lastKnownUser;
    if (value.state === 'offline') this.state.scenario = 'core-offline';
    else if (changed || !previouslySignedIn || !this.state.signedIn) this.state.scenario = 'normal';
    this.state.lastChecked = value.lastConfirmedAt ?? this.state.lastChecked;
  }
  async initialize() {
    const ticket = new URLSearchParams(location.hash.slice(1)).get('ticket');
    if (ticket) {
      // Consume the fragment once; neither credentials nor tickets enter navigation links.
      history.replaceState(null, '', location.pathname + location.search);
      await this.request('bootstrap', 'POST', { ticket });
    }
    this.acceptSession(await this.request('session'));
    if (this.state.signedIn) await this.checkConnection();
    this.scheduleSessionCheck(); this.emit();
  }
  private scheduleSessionCheck() {
    clearTimeout(this.sessionTimer);
    this.sessionTimer = setTimeout(async () => {
      try { const before = this.generation; const value = await this.request('session');
        if (value.state === 'signed-out' && this.state.signedIn) this.clearIdentity(); this.acceptSession(value);
        if (before !== this.generation && this.state.signedIn) await this.checkConnection(); this.emit();
      } catch (error) { if (!(error instanceof DesktopError && error.code.startsWith('LOCAL_'))) { this.state.scenario = 'core-offline'; this.emit(); } }
      this.scheduleSessionCheck();
    }, 15000);
  }
  async signIn(core: string, account: string, password: string) {
    if (core !== this.state.core.address) this.acceptSession(await this.request('connection', 'PUT', { coreUrl: core }));
    this.acceptSession(await this.request('login', 'POST', { account, password })); await this.checkConnection(); this.emit();
  }
  async switchCore(core: string) { this.acceptSession(await this.request('connection', 'PUT', { coreUrl: core })); if (this.state.signedIn) await this.checkConnection(); this.emit(); }
  async signOut() { const value = await this.request('logout', 'POST'); this.clearIdentity(); this.acceptSession(value.view); this.emit(); return value.remoteRevocationConfirmed === true; }
  async checkConnection() {
    this.acceptSession(await this.request('session'));
    this.status = await this.request('status'); this.state.lastChecked = this.status.checkedAt ?? '';
    this.state.scenario = !this.status.health?.available ? 'core-offline' : !this.status.readiness?.available || this.status.readiness.value?.ready === false ? 'env-not-ready' : 'normal';
    if (this.state.signedIn && this.state.scenario !== 'core-offline') { await this.listWorks(); await this.checkCatalog(); await this.recoverOperations(); }
    this.emit();
  }
  async listWorks() {
    try {
      const value = await this.request('works'); const old = new Map(this.state.works.map(work => [work.id, work]));
      if (!Array.isArray(value.works)) throw new DesktopError('INVALID_RESPONSE', 'The Work list response is incomplete. Retry loading the list.');
      this.state.works = value.works.map((raw: Data) => { const existing = old.get(raw.id); const mapped = this.mapWork(raw, existing); if (existing) { Object.assign(existing, mapped); return existing; } return mapped; });
      if (['loading', 'empty', 'list-error'].includes(this.state.scenario)) this.state.scenario = 'normal';
      if (!this.state.works.length && this.state.scenario === 'normal') this.state.scenario = 'empty'; this.emit();
    } catch (error) {
      if (this.state.signedIn) { this.state.scenario = error instanceof DesktopError && error.code === 'CORE_UNAVAILABLE' ? 'core-offline' : 'list-error'; this.emit(); }
      throw error;
    }
  }
  private mapWork(raw: Data, old?: Work): Work {
    return { ...(old ?? { network: '', services: [], files: [], sessions: [], config: blankConfig() }),
      id: raw.id, name: raw.name, description: raw.id, desired: raw.desiredState, status: stateLabel(raw.observedState) as Work['status'], updated: raw.updatedAt ?? '', color: 'blue', icon: 'grid',
      config: { ...(old?.config ?? blankConfig()), revision: raw.desiredRevision ?? 0, activeRevision: raw.activeRevision ?? 0 } };
  }
  async checkCatalog() {
    const epoch = this.epoch;
    for (const status of Object.values(this.catalog)) status.loading = true; this.emit();
    await Promise.allSettled((['skills', 'packages'] as const).map(async name => {
      const status = this.catalog[name];
      try {
        const value = await this.request(name);
        if (epoch !== this.epoch) return;
        if (!Array.isArray(value[name]) || value[name].some((entry: Data) => !entry || typeof entry.name !== 'string')) throw new Error(`The ${name} catalog response is incomplete.`);
        if (name === 'skills') this.skills = value.skills.map((entry: Data) => ({ id: entry.name, name: entry.name, description: null, version: null, loaded: null, modelVisible: null }));
        else this.packages = value.packages.map((entry: Data) => ({ ...entry, description: entry.description ?? null, version: entry.version ?? null }));
        Object.assign(status, { error: '', confirmed: true, checkedAt: new Date().toISOString() });
      } catch (error) { if (epoch === this.epoch) status.error = errorText(error); }
      finally { if (epoch === this.epoch) { status.loading = false; this.emit(); } }
    }));
    return !this.catalog.skills.error && !this.catalog.packages.error;
  }
  async refreshWorkStatus(id: string) {
    const work = this.getWork(id); if (!work) return;
    const raw = await this.request(`works/${part(id)}`); const mapped = this.mapWork(raw, work); Object.assign(work, mapped);
    await this.loadServices(id).catch(error => { (work.resourceErrors ??= {}).services = errorText(error); });
    this.emit();
  }
  async loadWork(id: string) {
    const raw = await this.request(`works/${part(id)}`); let work = this.getWork(id);
    const mapped = this.mapWork(raw, work); if (work) Object.assign(work, mapped); else { work = mapped; this.state.works.push(work); }
    work.resourceErrors = {};
    const tasks = [['services', () => this.loadServices(id)], ['configuration', () => this.loadConfiguration(id)], ['packages', () => this.loadPackages(id)]] as const;
    for (const [name, action] of tasks) { try { await action(); } catch (error) { work.resourceErrors[name] = errorText(error); } }
    if (['Ready', 'Degraded'].includes(work.status)) { try { await this.loadSessions(id); } catch (error) { work.resourceErrors.agent = errorText(error); } }
    this.emit(); return work;
  }
  async loadServices(id: string) {
    const work = this.getWork(id)!; const value = await this.request(`works/${part(id)}/services`);
    work.services = (value.services ?? []).map((raw: Data) => ({ id: raw.serviceId, name: raw.name, domain: raw.access?.hostname ?? '', enabled: raw.enabled, observed: stateLabel(raw.observedState), ports: (raw.access?.ports ?? []).filter((p: Data) => /^https?:/.test(p.url ?? '')).sort((a: Data, b: Data) => Number(b.name === raw.access.defaultPortName) - Number(a.name === raw.access.defaultPortName)).map((p: Data) => p.port), error: typeof raw.lastError === 'string' ? raw.lastError : raw.lastError?.message }));
    if (work.resourceErrors) delete work.resourceErrors.services;
    const domain = work.services.find(service => service.domain)?.domain; work.network = domain ? domain.split('.').slice(1, -1).join('.') : '';
    this.emit();
  }
  async loadConfiguration(id: string) {
    const work = this.getWork(id)!; const value = await this.request(`works/${part(id)}/configuration`); const raw = value.desired;
    work.config = { ...work.config, skills: raw.skills ?? [], packages: (raw.packages ?? []).map((p: Data) => ({ name: p.name, enabled: p.enabled, source: 'Saved Work copy' })), agents: raw.agentsMd ?? '', advanced: JSON.stringify(raw, null, 2), pendingApply: value.pendingApply, runtime: value.runtime, active: value.active, loaded: value.runtime?.state === 'ready', modelVisible: false };
    if (work.resourceErrors) delete work.resourceErrors.configuration; this.emit(); return work.config;
  }
  async loadPackages(id: string) { const work = this.getWork(id)!; const value = await this.request(`works/${part(id)}/packages`); work.packageEntries = value.packages ?? []; }
  async loadSessions(id: string) {
    const work = this.getWork(id)!; const value = await this.request(`works/${part(id)}/sessions`);
    const existing = new Map(work.sessions.map(session => [session.id, session])); work.sessions = (value.sessions ?? []).map((raw: Data) => ({ id: raw.sessionId, title: raw.title ?? `Session ${raw.sessionId}`, messages: existing.get(raw.sessionId)?.messages ?? [] }));
    if (work.sessions[0] && !this.streams.has(id)) await this.loadSession(id, work.sessions[0].id); if (work.resourceErrors) delete work.resourceErrors.agent; this.emit();
  }
  async loadSession(id: string, sessionId: string) {
    const work = this.getWork(id); if (work?.run?.sessionId === sessionId && ['accepted', 'running', 'cancelling'].includes(work.run.status) && this.streams.has(id)) return;
    const value = await this.request(`works/${part(id)}/sessions/${part(sessionId)}`); const session = this.getWork(id)?.sessions.find(s => s.id === sessionId);
    if (session) session.messages = (value.messages ?? []).filter((message: Data) => ['user', 'assistant', 'toolResult'].includes(message.role)).map((message: Data) => message.role === 'toolResult' ? ({ role: 'assistant', text: '', tool: { name: 'Tool result', status: 'Saved result', content: message.text ?? '' } }) : ({ role: message.role, text: message.text ?? '' })); this.emit();
  }
  serviceEntryUrl(workId: string, serviceId: string, port: number) { return this.entries.get(`${workId}:${serviceId}:${port}`)?.entryUrl ?? null; }
  async ensureServiceEntry(workId: string, serviceId: string, port: number) {
    const key = `${workId}:${serviceId}:${port}`; if (this.entries.has(key)) return;
    let pending = this.entryPromises.get(key); if (!pending) { pending = (async () => { try { const value = await this.request('service-entries', 'POST', { workId, serviceId, port }); this.entries.set(key, value); }
      finally { this.entryPromises.delete(key); this.emit(); } })(); this.entryPromises.set(key, pending); } await pending;
  }
  async serviceFrameLoaded(workId: string, serviceId: string, port: number) {
    const key = `${workId}:${serviceId}:${port}`; const entry = this.entries.get(key); if (!entry) return;
    const epoch = this.epoch;
    // The first iframe load can be the ticket bootstrap, before the application response arrives.
    for (let attempt = 0; attempt < 12 && epoch === this.epoch && this.entries.get(key) === entry; attempt++) {
      const value = await this.request(`service-entries/${part(entry.entryId)}`); entry.embed = value.embed === 'blocked' ? 'denied' : value.embed;
      entry.entryUrl = entry.origin + '/'; this.emit();
      if (value.embed !== 'unknown') return;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  serviceEmbed(workId: string, serviceId: string, port: number) { return this.entries.get(`${workId}:${serviceId}:${port}`)?.embed; }
  async directServiceURL(workId: string, serviceId: string, port: number) { return (await this.request('service-entries', 'POST', { workId, serviceId, port })).entryUrl as string; }
  localLink(workId: string, serviceId: string, port: number) { return `${location.origin}/works/${part(workId)}/services/${part(serviceId)}?port=${port}`; }
  async readLogs(workId: string, serviceId: string) { const value = await this.request(`works/${part(workId)}/services/${part(serviceId)}/logs?tailLines=100`); this.logs.set(serviceId, value); this.emit(); }
  private accepted(value: Data, workId: string, kind: string) {
    if (!value.operationId) throw new DesktopError('INVALID_RESPONSE', 'The acceptance response has no Operation ID. Check known operations.');
    const operation: Operation = { id: value.operationId, workId: value.workId ?? workId, kind, state: 'accepted', phase: 'Accepted', created: '', updated: '', scope: `${this.state.core.address} · ${this.state.core.account}`, snapshotId: value.snapshotId };
    this.state.operations.unshift(operation); if (operation.snapshotId) this.state.snapshots.unshift({ id: operation.snapshotId, operationId: operation.id, workId, status: 'preparing', filename: `${workId}.work`, size: '' });
    this.scheduleOperationPoll(); this.emit(); return operation;
  }
  async createWork(name: string, config: Partial<Configuration>, image?: string) {
    const payload: Data = { name };
    if (image) payload.baseImage = image;
    if (config.skills !== undefined) payload.skills = config.skills;
    if (config.packages !== undefined) payload.packages = config.packages.map(p => ({ name: p.name, enabled: p.enabled }));
    if (config.agents !== undefined) payload.agentsMd = config.agents;
    if (config.advanced) payload.configuration = JSON.parse(config.advanced);
    return this.accepted(await this.request('works', 'POST', payload), '', 'Create Work');
  }
  async lifecycle(id: string, action: 'start' | 'stop' | 'retry' | 'delete') { const operation = this.accepted(await this.request(`works/${part(id)}/${action}`, 'POST'), id, `${action[0].toUpperCase()}${action.slice(1)} Work`); if (action !== 'delete') await this.loadWork(id).catch(() => undefined); return operation; }
  async operateService(id: string, serviceId: string, action: string) { return this.accepted(await this.request(`works/${part(id)}/services/${part(serviceId)}/${action}`, 'POST'), id, `${action} Service`); }
  async checkOperation(id: string) {
    const value = await this.request(`operations/${part(id)}`); let operation = this.state.operations.find(o => o.id === id);
    if (!operation) operation = this.accepted({ operationId: id, workId: value.workId }, value.workId ?? '', value.type ?? value.kind ?? 'Operation');
    Object.assign(operation, { workId: value.workId ?? operation.workId, state: value.state, phase: value.packagePhase ?? value.state, created: value.createdAt ?? '', updated: value.updatedAt ?? '', error: value.error?.message ?? (typeof value.error === 'string' ? value.error : undefined), snapshotId: value.result?.snapshotId ?? operation.snapshotId });
    if (operation.snapshotId) await this.fetchSnapshot(operation.snapshotId).catch(() => undefined);
    this.emit(); return operation;
  }
  async recoverOperations() { const value = await this.request('known-operations'); for (const record of value.operations ?? []) { if (!this.state.operations.some(o => o.id === record.operationId)) { this.state.operations.push({ id: record.operationId, workId: record.workId ?? '', kind: record.type, state: 'unknown', phase: 'Check original operation', created: record.recordedAt, updated: '', snapshotId: record.snapshotId, scope: `${this.state.core.address} · ${this.state.core.account}` }); } } this.scheduleOperationPoll(); }
  private scheduleOperationPoll() { clearTimeout(this.pollTimer); this.pollTimer = setTimeout(async () => {
    if (!this.state.signedIn) return; let changed = false;
    for (const operation of [...this.state.operations]) { if (!['succeeded', 'failed', 'superseded'].includes(operation.state) && !this.pausedOperations.has(operation.id)) { try { await this.checkOperation(operation.id); changed ||= ['succeeded', 'failed', 'superseded'].includes(operation.state); } catch (error) { operation.error = errorText(error); if (error instanceof DesktopError && ['NOT_FOUND','OPERATION_NOT_FOUND','AUTH_REQUIRED'].includes(error.code)) this.pausedOperations.add(operation.id); } } }
    if (changed) { await this.listWorks().catch(() => undefined); for (const work of this.state.works) if (this.state.operations.some(o => o.workId === work.id && ['succeeded', 'failed'].includes(o.state))) await this.loadWork(work.id).catch(() => undefined); }
    this.emit(); if (this.state.operations.some(o => !['succeeded', 'failed', 'superseded'].includes(o.state) && !this.pausedOperations.has(o.id))) this.scheduleOperationPoll();
  }, 2000); }
  operationPaused(id: string) { return this.pausedOperations.has(id); }
  pauseOperation(id: string) { this.pausedOperations.add(id); }
  resumeOperation(id: string) { this.pausedOperations.delete(id); this.scheduleOperationPoll(); }
  async clearOperations() { for (const operation of this.state.operations.filter(o => ['succeeded', 'failed', 'superseded'].includes(o.state))) await this.request(`known-operations/${part(operation.id)}`, 'DELETE'); this.state.operations = this.state.operations.filter(o => !['succeeded', 'failed', 'superseded'].includes(o.state)); this.emit(); }
  async newSession(id: string) { const value = await this.request(`works/${part(id)}/sessions`, 'POST'); const sessionId = value.sessionId ?? value.session?.sessionId; this.getWork(id)!.sessions.unshift({ id: sessionId, title: `Session ${sessionId}`, messages: [] }); this.emit(); return sessionId as string; }
  async send(id: string, sessionId: string, text: string, includeIdentity: boolean) {
    if (!text.trim()) throw new Error('Write a message first.'); const work = this.getWork(id)!;
    const prompt = includeIdentity ? `${text}\n\nSelected Service: ${work.services.find(s => s.id === this.selectedService)?.domain ?? ''}` : text;
    const value = await this.request(`works/${part(id)}/runs`, 'POST', { sessionId, prompt }); const raw = value.run;
    work.run = { id: raw.runId, sessionId, status: runStates[raw.state] ?? 'interrupted', cursor: 0, created: raw.acceptedAt ?? '' };
    work.sessions.find(s => s.id === sessionId)!.messages.push({ role: 'user', text }, { role: 'assistant', text: '' }); this.emit(); void this.resumeRun(id); return raw.runId as string;
  }
  selectedService = '';
  async cancelRun(id: string) { const work = this.getWork(id)!; if (work.run) { await this.request(`works/${part(id)}/runs/${part(work.run.id)}/cancel`, 'POST'); const value = await this.request(`works/${part(id)}/runs/${part(work.run.id)}`); work.run.status = runStates[(value.run ?? value).state] ?? 'interrupted'; this.emit(); } }
  stopRunObservers() {
    for (const controller of this.streams.values()) controller.abort(); this.streams.clear();
    for (const observer of this.historyObservers.values()) observer.controller.abort(); this.historyObservers.clear();
    for (const timer of this.reconnects.values()) clearTimeout(timer); this.reconnects.clear();
  }
  private async recoverRunHistory(id: string, observer: { controller: AbortController; run: NonNullable<Work['run']>; epoch: number; failures: number }) {
    const { run, controller, epoch } = observer;
    const current = () => epoch === this.epoch && !controller.signal.aborted && this.getWork(id)?.run === run && this.historyObservers.get(id) === observer;
    if (!current()) return;
    let retry = true; let delay = 2000;
    try {
      const value = await this.request(`works/${part(id)}/runs/${part(run.id)}`, 'GET', undefined, controller.signal);
      if (!current()) return;
      const raw = value.run ?? value;
      run.status = runStates[raw.state] ?? 'interrupted';
      const history = await this.request(`works/${part(id)}/sessions/${part(run.sessionId)}`, 'GET', undefined, controller.signal);
      if (!current()) return;
      if (!Array.isArray(history.messages)) throw new Error('Saved session history is incomplete.');
      const session = this.getWork(id)?.sessions.find(s => s.id === run.sessionId);
      if (session) {
        session.messages = this.historyMessages(history.messages);
        if (!['accepted', 'running', 'cancelling'].includes(run.status) && raw.finalText && !session.messages.some(m => m.role === 'assistant' && !m.tool && m.text === raw.finalText)) session.messages.push({ role: 'assistant', text: raw.finalText });
      }
      observer.failures = 0;
      retry = ['accepted', 'running', 'cancelling'].includes(run.status);
      run.error = retry ? 'The event cursor expired. Recovering through saved Run and Session history.' : undefined;
    } catch (error) {
      if (!current()) return;
      run.error = `History recovery failed: ${errorText(error)}. Reread the original Run; do not resend the prompt.`;
      delay = Math.min(30000, 2000 * 2 ** Math.min(observer.failures++, 4));
      // Terminal history errors require explicit readback; do not claim completion
      // or poll an inaccessible/deleted Run indefinitely.
      retry = ['accepted', 'running', 'cancelling'].includes(run.status) && !(error instanceof DesktopError && [401, 403, 404].includes(error.httpStatus ?? 0));
    }
    if (!current()) return;
    this.emit();
    if (retry) this.reconnects.set(id, setTimeout(() => { if (current()) void this.recoverRunHistory(id, observer); }, delay));
    else this.historyObservers.delete(id);
  }
  private historyMessages(messages: Data[]) {
    return messages.filter(message => ['user', 'assistant', 'toolResult'].includes(message.role)).map(message => message.role === 'toolResult' ? ({ role: 'assistant' as const, text: '', tool: { name: 'Tool result', status: 'Saved result', content: message.text ?? '' } }) : ({ role: message.role as 'user' | 'assistant', text: message.text ?? '' }));
  }
  async resumeRun(id: string) {
    const work = this.getWork(id)!; const run = work.run; if (!run) return;
    clearTimeout(this.reconnects.get(id)); this.reconnects.delete(id); run.error = undefined;
    this.historyObservers.get(id)?.controller.abort(); this.historyObservers.delete(id);
    this.streams.get(id)?.abort(); const controller = new AbortController(); this.streams.set(id, controller); const epoch = this.epoch;
    if (run.historyRecovery) { this.streams.delete(id); const observer = { controller, run, epoch, failures: 0 }; this.historyObservers.set(id, observer); await this.recoverRunHistory(id, observer); return; }
    try {
      const response = await fetch(`/_desktop/api/works/${part(id)}/runs/${part(run.id)}/events?after=${run.cursor}`, { credentials: 'same-origin', signal: controller.signal });
      if (epoch !== this.epoch || controller.signal.aborted || this.streams.get(id) !== controller || this.getWork(id)?.run !== run) return;
      if (!response.ok) { if (response.status === 410) { run.historyRecovery = true; const observer = { controller, run, epoch, failures: 0 }; this.historyObservers.set(id, observer); await this.recoverRunHistory(id, observer); return; } throw new Error(`Run stream failed (${response.status}).`); }
      const reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffer = '';
      const consume = (line: string) => { if (epoch !== this.epoch || controller.signal.aborted || this.streams.get(id) !== controller || this.getWork(id)?.run !== run || !line.trim()) return; const event = JSON.parse(line); const sequence = Number(event.sequence); if (!Number.isSafeInteger(sequence) || sequence <= run.cursor) return; run.cursor = sequence;
        const session = work.sessions.find(s => s.id === run.sessionId); if (!session) return;
        const kind = event.kind; if (kind?.$case === 'text') { let message = session.messages.at(-1); if (!message || message.role !== 'assistant' || message.tool) { message = { role: 'assistant', text: '' }; session.messages.push(message); } message.text += kind.text.delta ?? ''; }
        else if (kind?.$case === 'tool') { const tool = kind.tool; session.messages.push({ role: 'assistant', text: '', tool: { name: tool.toolName, status: tool.phase, content: tool.isError ? 'The tool reported an error.' : 'Tool execution event. Open session history for saved results.' } }); }
        else if (kind?.$case === 'state') { run.status = runStates[kind.state.state] ?? 'interrupted'; run.error = kind.state.error?.message; if (kind.state.finalText) { const message = session.messages.at(-1); if (message?.role === 'assistant' && !message.tool) message.text = kind.state.finalText; else session.messages.push({ role: 'assistant', text: kind.state.finalText }); } }
        this.emit(); };
      while (epoch === this.epoch && !controller.signal.aborted && this.streams.get(id) === controller && this.getWork(id)?.run === run) { const { value, done } = await reader.read(); if (done) { buffer += decoder.decode(); if (buffer.trim()) consume(buffer); break; } buffer += decoder.decode(value, { stream: true }); if (buffer.length > 2_097_152) throw new Error('Run event exceeded the supported size.'); let index; while ((index = buffer.indexOf('\n')) !== -1) { consume(buffer.slice(0, index)); buffer = buffer.slice(index + 1); } }
      if (epoch !== this.epoch || controller.signal.aborted || this.streams.get(id) !== controller || this.getWork(id)?.run !== run) return;
      const value = await this.request(`works/${part(id)}/runs/${part(run.id)}`); run.status = runStates[(value.run ?? value).state] ?? 'interrupted';
      if (['accepted', 'running', 'cancelling'].includes(run.status)) run.error = 'Event stream ended. Resume this Run to continue from its cursor.';
      else { run.error = undefined; this.reconnectAttempts.delete(id); await this.loadSession(id, run.sessionId); await this.loadServices(id).catch(() => undefined); await this.loadConfiguration(id).catch(() => undefined); } this.emit();
    } catch (error) { if (!controller.signal.aborted && epoch === this.epoch) { run.error = `${errorText(error)} Resume the original Run; do not send the prompt again.`; this.emit(); } }
    finally {
      if (this.streams.get(id) === controller) {
        this.streams.delete(id);
        if (!run.historyRecovery && epoch === this.epoch && !controller.signal.aborted && this.getWork(id)?.run === run && ['accepted', 'running', 'cancelling'].includes(run.status)) {
          const attempt = this.reconnectAttempts.get(id) ?? 0; this.reconnectAttempts.set(id, attempt + 1);
          this.reconnects.set(id, setTimeout(() => { if (epoch === this.epoch && this.getWork(id)?.run === run) void this.resumeRun(id); }, Math.min(30000, 1500 * 2 ** Math.min(attempt, 5))));
        }
      }
    }
  }
  fileURL(id: string, path: string) { if (!path.startsWith('/') || path.split('/').some(p => p === '.' || p === '..' || /[\\\x00]/.test(p))) throw new Error('Invalid workspace path.'); return `/_desktop/files/works/${part(id)}/files/${path.slice(1).split('/').map(part).join('/')}`; }
  async loadDirectory(id: string, path = '/') {
    const epoch = this.epoch; const work = this.getWork(id)!; try { const base = this.fileURL(id, path).replace(/\/?$/, '/');
    const response = await fetch(base, { method: 'PROPFIND', credentials: 'same-origin', headers: { Depth: '1', 'X-Piwork-Csrf': this.csrf } }); if (!response.ok) throw new Error(`Workspace cannot be read (${response.status}).`);
    if (epoch !== this.epoch) throw new Error('The connection changed; the file listing was discarded.');
    const entries = parseEntries(await response.text(), base); const children: WorkspaceFile[] = entries.filter(e => e.name !== '/').map(e => ({ path: (path === '/' ? '' : path) + '/' + e.name, name: e.name, kind: e.directory ? 'directory' : e.kind === 'file' ? 'file' : 'special', size: e.size ?? 0, modified: e.modified ?? '' }));
    for (const child of children) { const old = work.files.find(f => f.path === child.path); if (old?.content !== undefined && old.size === child.size && old.modified === child.modified) { child.content = old.content; child.kind = old.kind; } } work.files = [...work.files.filter(f => (f.path.slice(0, f.path.lastIndexOf('/')) || '/') !== path), ...children]; if (work.resourceErrors) delete work.resourceErrors.files; this.emit();
    } catch (error) { if (epoch === this.epoch) { (work.resourceErrors ??= {}).files = errorText(error); this.emit(); } throw error; }
  }
  async readFile(id: string, path: string) {
    const epoch = this.epoch; const work = this.getWork(id)!; let file = work.files.find(f => f.path === path); if (!file) { await this.loadDirectory(id, path.slice(0, path.lastIndexOf('/')) || '/'); file = work.files.find(f => f.path === path); }
    if (!file) throw new Error('File was not found in the current workspace listing.'); if (file.kind === 'directory') { await this.loadDirectory(id, path); return file; } if (file.kind === 'special') return file;
    if (file.size > 1_048_576) { file.kind = 'binary'; return file; }
    const response = await fetch(this.fileURL(id, path), { credentials: 'same-origin' }); if (!response.ok) throw new Error(`File cannot be read (${response.status}).`);
    const reader = response.body!.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const result = await reader.read(); if (result.done) break; size += result.value.byteLength; if (size > 1_048_576) { await reader.cancel(); file.kind = 'binary'; this.emit(); return file; } chunks.push(result.value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { file.content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); if (file.content.includes('\0')) throw new Error('Binary'); file.kind = 'text'; } catch { file.kind = 'binary'; delete file.content; } if (epoch !== this.epoch) throw new Error('The connection changed; the file response was discarded.'); file.size = size; file.modified = fileVersion(response.headers.get('Last-Modified')) || fileVersion(file.modified); this.emit(); return { ...file };
  }
  private async writeFile(id: string, path: string, method: string, body?: BodyInit, headers: Record<string, string> = {}): Promise<TransferResult[]> {
    if (path === '/' && method !== 'MKCOL') throw new Error('The workspace root cannot be mutated.');
    const epoch = this.epoch; let response: Response; try { response = await fetch(this.fileURL(id, path), { method, credentials: 'same-origin', headers: { ...headers, 'X-Piwork-Csrf': this.csrf }, body }); }
    catch { return [{ path, status: 'unknown', message: 'Response lost. Refresh source and destination before trying again.' }]; }
    if (epoch !== this.epoch) throw new Error('The connection changed; file results must be checked under the original account.');
    if (response.status === 207) { let result; try { result = mutationResults(await response.text()); } catch { return [{ path, status: 'unknown', message: 'The per-path result could not be read. Refresh affected paths before trying again.' }]; } return [...result.succeeded.map(path => ({ path, status: 'succeeded' as const, message: 'Confirmed' })), ...result.failed.map(path => ({ path, status: 'failed' as const, message: 'Path failed; inspect its status.' }))]; }
    if (!response.ok) { const value = await response.json().catch(() => ({})); return [{ path, status: 'failed', httpStatus: response.status, message: response.status === 412 ? 'The target changed. Your input is kept. Reread the target and explicitly confirm its version before retrying.' : value.message ?? `Request failed (${response.status}).` }]; }
    return [{ path, status: 'succeeded', message: 'Confirmed', modified: fileVersion(response.headers.get('Last-Modified')) }];
  }
  async saveFile(id: string, path: string, content: string, baseline: string, unprotectedConsent = false) {
    if (new TextEncoder().encode(content).length > 1_048_576) throw new Error('Text exceeds the 1 MiB editor limit.');
    const modified = fileVersion(baseline);
    if (!modified && !unprotectedConsent) throw new Error('No modification time is available. Explicitly approve an unprotected overwrite first.');
    const results = await this.writeFile(id, path, 'PUT', content, { 'Content-Type': 'text/plain; charset=utf-8', ...(modified ? { 'If-Unmodified-Since': modified } : {}) });
    const result = results[0]; this.state.transfers = results;
    if (result.status === 'succeeded') {
      const file = this.getWork(id)!.files.find(f => f.path === path); if (file) { file.content = content; file.modified = ''; }
      // A later HEAD alone cannot establish which body it describes. Compare a fresh
      // GET with the saved bytes when PUT does not return a version.
      if (!result.modified) {
        try { const fresh = await this.readFile(id, path); if (fresh.content === content) result.modified = fileVersion(fresh.modified); }
        catch { result.message = 'Saved, but the new version could not be confirmed. Reread before the next write.'; }
      }
      if (file) file.modified = result.modified ?? '';
    }
    this.emit(); return result;
  }
  async transfer(id: string, action: string, paths: string[], destination?: string, overwrite = false) {
    const results: TransferResult[] = [];
    if (action === 'mkdir') results.push(...await this.writeFile(id, destination!, 'MKCOL'));
    else for (const path of paths) { const headers: Record<string, string> = {};
      if (action === 'copy' || action === 'move') { headers.Destination = new URL(this.fileURL(id, destination!), location.origin).href; headers.Overwrite = overwrite ? 'T' : 'F'; if (action === 'copy') headers.Depth = 'infinity'; }
      results.push(...await this.writeFile(id, path, action === 'delete' ? 'DELETE' : action.toUpperCase(), undefined, headers)); }
    this.state.transfers = results; this.emit(); return results;
  }
  async upload(id: string, directory: string, files: File[], overwrite = false) {
    const epoch = this.epoch; const results: TransferResult[] = [];
    for (const file of files) {
      if (!file.name || /[\\/\x00]/.test(file.name)) throw new Error('Invalid upload file name.');
      const path = (directory === '/' ? '' : directory) + '/' + file.name; const key = `${id}:${path}`;
      let existing: Response;
      try { existing = await fetch(this.fileURL(id, path), { method: 'HEAD', credentials: 'same-origin' }); }
      catch { results.push({ path, status: 'unknown', message: 'Target check failed. Original upload input is kept.' }); continue; }
      if (epoch !== this.epoch) throw new Error('The connection changed; upload was stopped.');
      if (!existing.ok && existing.status !== 404) { results.push({ path, status: 'failed', message: `Target check failed (${existing.status}).` }); continue; }
      const version = fileVersion(existing.headers.get('Last-Modified')); const absent = existing.status === 404;
      const intent = this.uploadIntents.get(key);
      if (!absent && (!overwrite || !intent || intent.file !== file || intent.absent || intent.modified !== version)) {
        this.uploadIntents.set(key, { file, modified: version, absent: false });
        results.push({ path, status: 'failed', needsConsent: true, message: intent && overwrite ? 'Target changed since confirmation. Confirm the newly checked version again.' : version ? 'Target exists. Confirm overwrite of this checked version.' : 'Target exists without a modification time. Overwrite cannot protect against concurrent changes; explicit consent is required.' }); continue;
      }
      const headers: Record<string, string> = { 'Content-Type': file.type || 'application/octet-stream', ...(absent ? { 'If-None-Match': '*' } : version ? { 'If-Unmodified-Since': intent!.modified } : {}) };
      const written = await this.writeFile(id, path, 'PUT', file, headers); results.push(...written);
      if (written.every(r => r.status === 'succeeded')) this.uploadIntents.delete(key);
      // Retain the original File on 412/unknown. A retry must re-probe and, when
      // the version changed, ask for consent again; never retry a PUT here.
    }
    this.state.transfers = results; await this.loadDirectory(id, directory).catch(() => undefined); this.emit(); return results;
  }
  async saveConfiguration(id: string, config: Configuration) { const raw = synchronizeConfiguration(config); await this.request(`works/${part(id)}/configuration`, 'PUT', { configuration: raw }); await this.loadConfiguration(id); }
  async replaceSkill(id: string, name: string) { const work = this.getWork(id)!; await this.request(`works/${part(id)}/configuration/skills`, 'PUT', { skills: Array.from(new Set([...work.config.skills, name])) }); await this.loadConfiguration(id); }
  async applyConfiguration(id: string) { return this.accepted(await this.request(`works/${part(id)}/configuration/apply`, 'POST'), id, 'Apply configuration'); }
  async installPackage(id: string, name: string, sourceLabel: string, files?: File[], updateTarget?: string) {
    const kind = sourceLabel.split(': ')[0]; const spec = sourceLabel.slice(kind.length + 2); let source: Data;
    if (kind === 'Core') source = { kind: 'core', name };
    else if (kind === 'npm' || kind === 'Git') source = { kind: kind === 'Git' ? 'git' : 'npm', spec };
    else { if (!files?.length) throw new Error('Choose the actual package files.'); const form = new FormData(); form.set('kind', kind === 'ZIP' ? 'zip' : 'local'); for (const file of files) form.append(kind === 'ZIP' ? 'zip' : 'files', file, file.webkitRelativePath || file.name);
      const response = await fetch(`/_desktop/api/works/${part(id)}/package-uploads`, { method: 'POST', credentials: 'same-origin', headers: { 'X-Piwork-Csrf': this.csrf }, body: form }); const value = await response.json(); if (!response.ok) throw new Error(value.message ?? 'Package upload failed.'); source = { kind: 'upload', uploadId: value.uploadId }; }
    return this.accepted(await this.request(`works/${part(id)}/packages${updateTarget ? `/${part(updateTarget)}/update` : ''}`, 'POST', { source }), id, updateTarget ? 'Update Pi Package' : 'Install Pi Package');
  }
  async removePackage(id: string, name: string) { return this.accepted(await this.request(`works/${part(id)}/packages/${part(name)}`, 'DELETE'), id, 'Remove Pi Package'); }
  async cleanupInspection(id: string) {
    const pending = this.cleanupPending.get(id); if (!pending || pending.localSession !== this.csrf) return;
    try {
      const response = await fetch(`/_desktop/api/work-packages/${part(id)}`, { method: 'DELETE', credentials: 'same-origin', headers: { 'X-Piwork-Csrf': pending.localSession } });
      if (this.cleanupPending.get(id) !== pending) return;
      if (response.ok || response.status === 404) this.cleanupPending.delete(id);
      else pending.message = `Cleanup not confirmed (${response.status}). Retry releasing this local transfer.`;
    } catch { if (this.cleanupPending.get(id) === pending) pending.message = 'Cleanup response lost. Retry releasing this local transfer.'; }
    this.emit();
  }
  async abandonInspection(invalidateSelection = true) {
    if (invalidateSelection) this.inspectionSelection++;
    const context = this.inspectionContext;
    if (!context || context.importState !== 'unsubmitted') return;
    this.inspectionContext = null; this.inspectionNonce++; context.xhr?.abort();
    this.inspection = null; this.inspectionTransfer = ''; this.transferProgress = null;
    this.cleanupPending.set(context.id, { message: 'Releasing local transfer…', localSession: context.localSession }); this.emit();
    await this.cleanupInspection(context.id);
  }
  abandonInspectionOnUnload() {
    const context = this.inspectionContext;
    if (context?.importState === 'unsubmitted') { context.xhr?.abort(); void fetch(`/_desktop/api/work-packages/${part(context.id)}`, { method: 'DELETE', credentials: 'same-origin', keepalive: true, headers: { 'X-Piwork-Csrf': context.localSession } }).catch(() => undefined); }
  }
  async inspectWork(file: File) {
    if (this.inspectionContext && this.inspectionContext.importState !== 'unsubmitted') throw new Error('The original import is already submitted or unknown. Recover it by its original transfer/Operation ID before choosing another package.');
    const selection = ++this.inspectionSelection;
    await this.abandonInspection(false);
    if (selection !== this.inspectionSelection) return;
    const context: InspectionContext = { id: crypto.randomUUID(), nonce: ++this.inspectionNonce, core: this.state.core.address, localSession: this.csrf, anonymous: !this.state.signedIn, ready: false, importState: 'unsubmitted' };
    this.inspectionContext = context; this.inspectionTransfer = context.id; this.inspection = null;
    const current = () => this.inspectionContext === context && context.nonce === this.inspectionNonce;
    this.transferProgress = { phase: 'receiving', transferred: 0, total: file.size }; this.emit();
    let polling = true;
    const observe = async () => { while (polling && current()) { await new Promise(resolve => setTimeout(resolve, 500)); if (!polling || !current()) break; try { const progress = await this.request(`work-packages/${part(context.id)}`); if (polling && current()) { this.transferProgress = progress; this.emit(); } } catch { /* The upload may not yet have reserved its ID. */ } } }; void observe();
    try {
      const value = await new Promise<Data>((resolve, reject) => {
        const xhr = new XMLHttpRequest(); context.xhr = xhr; xhr.open('POST', '/_desktop/api/work-packages'); xhr.withCredentials = true;
        xhr.setRequestHeader('Content-Type', 'application/vnd.piwork.work-package'); xhr.setRequestHeader('X-Piwork-Csrf', context.localSession); xhr.setRequestHeader('X-Piwork-Transfer-Id', context.id);
        xhr.onload = () => {
          if (!current()) { if (context.importState === 'unsubmitted' && context.localSession === this.csrf) { this.cleanupPending.set(context.id, { message: 'Releasing late local transfer…', localSession: context.localSession }); void this.cleanupInspection(context.id); } reject(new Error('This inspection was abandoned.')); return; }
          let value: Data; try { value = JSON.parse(xhr.responseText); } catch { reject(new Error('Inspection result could not be read. Original transfer ID is kept for cleanup.')); return; }
          if (xhr.status >= 200 && xhr.status < 300 && value.summary && value.transferId === context.id) resolve(value); else reject(new Error(value.message ?? value.code ?? 'Package inspection failed.'));
        };
        xhr.onerror = () => reject(new Error('Local transfer was interrupted. Original transfer ID is kept for cleanup.'));
        xhr.onabort = () => reject(new Error('Local upload cancelled.')); xhr.send(file);
      });
      if (!current()) return;
      context.ready = true; this.inspection = value.summary; this.transferProgress = { phase: 'ready', transferred: file.size, total: file.size }; return context.id;
    } catch (error) { if (current()) { this.transferProgress = { phase: 'failed', error: errorText(error) }; throw error; } }
    finally { polling = false; if (current()) { context.xhr = undefined; this.emit(); } }
  }
  async checkInspectionImport() {
    const context = this.inspectionContext;
    if (!context || context.importState === 'unsubmitted') return;
    const value = await this.request(`work-packages/${part(context.id)}`);
    if (this.inspectionContext !== context) return;
    if (value.phase === 'ready') context.importState = 'unsubmitted';
    else if (value.phase === 'accepted') context.importState = 'accepted';
    this.emit();
  }
  async importWork(name: string) {
    const context = this.inspectionContext;
    if (!context?.ready || !this.inspectionTransfer) throw new Error('Inspect the actual .work package first.');
    if (context.importState !== 'unsubmitted') throw new Error(`Import is ${context.importState}. Recover the original transfer ${context.id} or known Operation; do not submit again.`);
    if (context.core !== this.state.core.address || context.localSession !== this.csrf || !this.state.signedIn) throw new Error('Sign in to the original Core before importing.');
    context.importState = 'submitting'; this.emit();
    try {
      const value = await this.request('work-imports', 'POST', { transferId: context.id, ...(name ? { name } : {}) });
      if (this.inspectionContext !== context) throw new DesktopError('CONNECTION_CHANGED', 'The identity changed during import.');
      // Missing acceptance identity is also unknown; never offer a second POST.
      const operation = this.accepted(value, '', 'Import Work'); context.operationId = operation.id; context.importState = 'accepted'; this.emit(); return operation;
    } catch (error) {
      if (this.inspectionContext === context) { context.importState = 'unknown'; this.emit();
        // The CLI may have attempted Core Import even when a gateway returned an
        // HTTP error. Only confirmed local ready state permits a new explicit POST.
        await this.checkInspectionImport().catch(() => undefined); }
      throw error;
    }
  }
  async prepareExport(id: string) { return this.accepted(await this.request(`works/${part(id)}/exports`, 'POST'), id, 'Export Work'); }
  async fetchSnapshot(id: string) { const value = await this.request(`work-snapshots/${part(id)}`); let snapshot = this.getSnapshot(id); if (!snapshot) { snapshot = { id, workId: value.workId, operationId: value.operationId, status: 'preparing', filename: `${value.workId}.work`, size: '' }; this.state.snapshots.push(snapshot); }
    Object.assign(snapshot, { status: value.expiresAt && Date.parse(value.expiresAt) <= Date.now() ? 'expired' : value.state === 'succeeded' ? 'verified' : value.state === 'failed' ? 'failed' : 'preparing', size: value.size ? `${value.size} bytes` : '' }); this.emit(); return snapshot;
  }
  async downloadSnapshot(id: string) { const value = await this.request(`work-snapshots/${part(id)}/downloads`, 'POST'); let progress = value; this.transferProgress = progress; this.emit(); while (!progress.ready && progress.phase !== 'ready') { if (['failed', 'cancelled', 'unknown'].includes(progress.phase)) throw new Error(progress.error?.message ?? 'Snapshot download failed.'); await new Promise(resolve => setTimeout(resolve, 500)); progress = await this.request(`downloads/${part(value.transferId)}`); this.transferProgress = progress; this.emit(); } return `/_desktop/api/downloads/${part(value.transferId)}/content`; }
}
export const adapter = new DesktopAdapter();
