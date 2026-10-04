import type { Work, Operation, Snapshot, Configuration, WorkspaceFile, RunStatus } from './models.js';
import { synchronizeConfiguration } from './configuration.js';
import { parseEntries, mutationResults } from './files.js';
import { lifecycleAction, projectWork, terminalOperation, workState } from './lifecycle.js';
import { MetadataReads, ObservationDeferred, ObservationStopped } from './observation.js';
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
    browserAccess: 'checking' as 'checking' | 'authorized' | 'required' | 'unavailable', browserAccessReason: '', browserAccessChecked: '', cleanupRequired: false,
    core: { address: '', name: 'Core', account: '', role: '', proxyPort: '', username: '' }, transfers: [] as TransferResult[], lastChecked: '' };
  status: Data = {};
  inspection: Data | null = null;
  inspectionTransfer = '';
  transferProgress: Data | null = null;
  downloads = new Map<string, Data>();
  private downloadRequests = new Map<string, Promise<string>>();
  private downloadObservers = new Map<string, { active: boolean }>();
  uploadProgress = new Map<string, Data>();
  transfersByWork = new Map<string, TransferResult[]>();
  inspectionContext: InspectionContext | null = null;
  cleanupPending = new Map<string, { message: string; localSession: string }>();
  private inspectionNonce = 0;
  private inspectionSelection = 0;
  catalog = { skills: { loading: false, error: '', confirmed: false, checkedAt: '' }, packages: { loading: false, error: '', confirmed: false, checkedAt: '' } };
  logs = new Map<string, Data>();
  directories = new Map<string, { loading: boolean; checkedAt: string; error: string }>();
  private uploadIntents = new Map<string, UploadIntent>();
  private csrf = '';
  private generation = -1;
  private epoch = 0;
  get identityEpoch() { return this.epoch; }
  private reads = new Map<string, Promise<Data>>();
  private listeners = new Set<() => void>();
  private skills: Data[] = [];
  private packages: Data[] = [];
  private entries = new Map<string, Data>();
  private entryPromises = new Map<string, Promise<void>>();
  private entryErrors = new Map<string, string>();
  private entryChecks = new Map<string, Promise<void>>();
  private pausedOperations = new Set<string>();
  private streams = new Map<string, AbortController>();
  private reconnects = new Map<string, ReturnType<typeof setTimeout>>();
  private historyObservers = new Map<string, { controller: AbortController; run: NonNullable<Work['run']>; epoch: number; failures: number }>();
  private reconnectAttempts = new Map<string, number>();
  private pollTimer?: ReturnType<typeof setTimeout>;
  private metadata = new MetadataReads();
  private mutationSequence = 0;
  private workMutations = new Map<string, number>();
  private workReads = new Map<string, number>();
  private statusSequence = 0;
  private deletedWorks = new Set<string>();
  private workSync = new Map<string, { generation: number; after: number; work: boolean; list: boolean }>();
  private pollTargets = new Map<string, { pending: boolean; nextAt: number }>();
  private terminalEvidence = new Map<string, { operation: Operation; generation: number }>();
  private observationVisible = true;
  private visibleWorkId = '';
  private capabilityReads = new Map<string, Promise<void>>();
  private sessionTimer?: ReturnType<typeof setTimeout>;
  private authCheck?: { epoch: number; sequence: number; pending: Promise<Data> };
  private authSequence = 0;
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit() { for (const listener of this.listeners) listener(); }
  getWork(id: string) { return this.state.works.find(work => work.id === id); }
  private coordinationOperations() {
    const visible = new Set(this.state.operations.map(op => op.id));
    return [...this.state.operations, ...[...this.terminalEvidence.values()].map(e => e.operation).filter(op => !visible.has(op.id))];
  }
  getOperation(id: string) { return this.state.operations.find(op => op.id === id) ?? this.terminalEvidence.get(id)?.operation; }
  project(work: Work) { return projectWork(work, this.coordinationOperations()); }
  private retainTerminal(operation: Operation) {
    if (!operation.action || !operation.workId || !terminalOperation(operation.state)) return;
    const intent = this.getWork(operation.workId)?.lifecycleIntent;
    const previous = this.terminalEvidence.get(operation.id);
    this.terminalEvidence.set(operation.id, { operation: { ...operation }, generation: previous?.generation ?? (intent?.operationId === operation.id ? intent.sequence : this.workMutations.get(operation.workId) || 0) });
  }
  getSkills() { const copies = this.state.works.flatMap(work => work.config.skills).filter((name, i, all) => all.indexOf(name) === i && !this.skills.some(s => s.id === name)); return [...this.skills, ...copies.map(name => ({ id: name, name, description: 'Saved Work copy; unavailable in current Core catalog', version: null, loaded: null, modelVisible: null }))]; }
  getPackages() { return this.packages; }
  getSnapshot(id: string) { return this.state.snapshots.find(snapshot => snapshot.id === id); }
  worksLoading = false; worksChecked = ''; worksError = '';
  private clearIdentity(preserveInspection = false) {
    const inspection = preserveInspection ? { context: this.inspectionContext, summary: this.inspection, transfer: this.inspectionTransfer, progress: this.transferProgress } : null;
    if (!preserveInspection) { this.inspectionSelection++; this.inspectionNonce++; this.inspectionContext?.xhr?.abort(); this.inspectionContext = null; this.transferProgress = null; this.cleanupPending.clear(); }
    this.epoch++; this.worksLoading = false; this.worksChecked = ''; this.state.works = []; this.state.operations = []; this.state.snapshots = []; this.state.transfers = [];
    this.terminalEvidence.clear(); this.metadata.clear(); this.pollTargets.clear(); this.workMutations.clear(); this.workReads.clear(); this.deletedWorks.clear(); this.workSync.clear(); this.capabilityReads.clear(); this.worksError = '';
    this.stopDownloadObservers(); this.downloads.clear(); this.downloadRequests.clear(); this.uploadProgress.clear();
    this.transfersByWork.clear(); this.directories.clear();
    for (const status of Object.values(this.catalog)) Object.assign(status, { loading: false, error: '', confirmed: false, checkedAt: '' });
    this.uploadIntents.clear(); this.skills = []; this.packages = []; this.entries.clear(); this.entryErrors.clear(); this.entryPromises.clear(); this.entryChecks.clear(); this.logs.clear(); this.inspection = null; this.inspectionTransfer = '';
    if (inspection) { this.inspectionContext = inspection.context; this.inspection = inspection.summary; this.inspectionTransfer = inspection.transfer; this.transferProgress = inspection.progress; }
    for (const observer of this.historyObservers.values()) observer.controller.abort(); this.historyObservers.clear();
    for (const stream of this.streams.values()) stream.abort(); this.streams.clear(); for (const timer of this.reconnects.values()) clearTimeout(timer); this.reconnects.clear(); this.reconnectAttempts.clear(); clearTimeout(this.pollTimer); this.pollTimer = undefined; this.pausedOperations.clear();
  }
  private request(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<Data> {
    if (method !== 'GET' || signal) return this.requestOnce(path, method, body, signal);
    const key = `${this.epoch}:${path === 'session' ? `${this.authSequence}:` : ''}${path}`; const old = this.reads.get(key); if (old) return old;
    const pending = this.requestOnce(path, method, body).finally(() => { if (this.reads.get(key) === pending) this.reads.delete(key); });
    this.reads.set(key, pending); return pending;
  }
  private metadataKey(path: string) {
    const match = /^works\/([^/]+)$/.exec(path);
    return `${this.epoch}:${match ? this.workMutations.get(decodeURIComponent(match[1])) || 0 : path === 'works' ? this.mutationSequence : 0}:${path}`;
  }
  private readMetadata(path: string, explicit = false) {
    return this.metadata.read(this.metadataKey(path), async signal => {
      const sequence = ++this.statusSequence;
      const value = await this.request(path, 'GET', undefined, signal);
      return { value, sequence };
    }, explicit);
  }
  private requireWorkSync(id: string) {
    if (id) this.workSync.set(id, { generation: this.workMutations.get(id) || 0, after: this.statusSequence, work: true, list: true });
  }
  private associateOperations(work: Work) {
    const related = this.coordinationOperations().filter(op => op.workId === work.id && op.action);
    const outstanding = related.filter(op => !terminalOperation(op.state));
    work.operationId = work.lifecycleIntent?.operationId ?? (outstanding.length === 1 ? outstanding[0].id : related.length === 1 ? related[0].id : undefined);
  }
  private mergeWork(raw: Data, sequence: number, mutation: number): Work | undefined {
    if (!raw || typeof raw.id !== 'string' || typeof raw.observedState !== 'string' || !['running', 'stopped', 'deleted'].includes(raw.desiredState)) throw new DesktopError('INVALID_RESPONSE', 'The Work status response is incomplete.');
    const old = this.getWork(raw.id);
    if (mutation !== (this.workMutations.get(raw.id) || 0) || sequence < (this.workReads.get(raw.id) || 0)) return old;
    if (old?.controlVersion !== undefined && raw.controlVersion !== undefined && raw.controlVersion < old.controlVersion) return old;
    this.workReads.set(raw.id, sequence);
    if (raw.observedState === 'deleted') { this.deletedWorks.add(raw.id); this.state.works = this.state.works.filter(work => work.id !== raw.id); return; }
    if (this.deletedWorks.has(raw.id)) return;
    const mapped = this.mapWork(raw, old);
    const work = old ? Object.assign(old, mapped) : mapped;
    if (!old) this.state.works.push(work);
    // A newer confirmed server target can come from a different client.
    const intent = work.lifecycleIntent;
    if (intent && intent.baseVersion !== undefined && raw.controlVersion > intent.baseVersion &&
      raw.desiredState !== (['stop', 'delete'].includes(intent.action) ? intent.action === 'delete' ? 'deleted' : 'stopped' : 'running')) delete work.lifecycleIntent;
    this.associateOperations(work); return work;
  }
  private async requestOnce(path: string, method = 'GET', body?: unknown, signal?: AbortSignal, headers: Record<string, string> = {}): Promise<Data> {
    const epoch = this.epoch, authSequence = this.authSequence;
    let response: Response;
    try { response = await fetch(`/_desktop/api/${path}`, { method, credentials: 'same-origin', signal, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Piwork-Csrf': this.csrf, ...headers }, ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }) }); }
    catch { throw new DesktopError(method === 'GET' ? 'CORE_UNAVAILABLE' : 'RESULT_UNKNOWN', method === 'GET' ? 'The local connection is unavailable. Check the CLI and Core.' : 'The response was lost. Check known operations before submitting again.'); }
    if (epoch !== this.epoch) throw new DesktopError('CONNECTION_CHANGED', 'The Core or account changed. This response was discarded.');
    const value = await response.json().catch(() => null);
    if (epoch !== this.epoch) throw new DesktopError('CONNECTION_CHANGED', 'The identity changed while reading the response.');
    if (!response.ok) {
      const code = value?.code ?? `HTTP_${response.status}`;
      if (path !== 'session' && code === 'LOCAL_AUTH_REQUIRED') this.requireBrowserAccess('Browser access ended. Use the latest reopen command.');
      else if (path !== 'session' && code === 'LOCAL_CSRF_OR_AUTH_REQUIRED') {
        await this.checkBrowserAccess().catch(() => undefined);
        throw new DesktopError(code, this.state.browserAccess === 'authorized' ? 'Browser access checked. The original action was rejected locally; submit it explicitly again if needed.' : 'Browser access ended. Reopen Desktop from the same system user’s terminal.', response.status);
      }
      else if (response.status === 401 && path !== 'login' && path !== 'session') {
        if (authSequence !== this.authSequence) throw new DesktopError('CONNECTION_CHANGED', 'A newer authentication flow owns this response.');
        const pending = this.checkBrowserAccess(), sequence = this.authSequence;
        const session = await pending;
        if (sequence !== this.authSequence) throw new DesktopError('CONNECTION_CHANGED', 'A newer authentication flow owns this readback.');
        if (session.state === 'offline') throw new DesktopError('CORE_UNAVAILABLE', 'Core is unreachable. Last confirmed data is preserved.');
        if (session.state === 'signed-out') {
          if (epoch === this.epoch) this.clearIdentity();
          this.state.signedIn = false; this.state.scenario = 'auth-expired'; this.emit();
        }
      }
      throw new DesktopError(code, value?.message ?? `Request failed (${response.status}).`, response.status);
    }
    if (!value || typeof value !== 'object') throw new DesktopError('INVALID_RESPONSE', 'The server returned an invalid response.');
    return value;
  }
  private acceptSession(value: Data) {
    const changed = this.generation !== value.generation; const previouslySignedIn = this.state.signedIn;
    if (this.csrf && this.csrf !== value.csrf || this.generation !== -1 && this.generation !== value.generation) {
      const context = this.inspectionContext;
      const preserve = !!context && context.anonymous && context.ready && context.importState === 'unsubmitted' && !this.state.signedIn && ['authenticated', 'signed-out'].includes(value.state) && context.core === value.coreUrl && context.localSession === value.csrf;
      this.clearIdentity(preserve);
      if (preserve && value.state === 'authenticated') context.anonymous = false;
    }
    this.state.browserAccess = 'authorized'; this.state.browserAccessReason = ''; this.state.browserAccessChecked = new Date().toISOString(); this.state.cleanupRequired = value.cleanupRequired === true;
    this.generation = value.generation; this.csrf = value.csrf ?? this.csrf;
    this.state.core.address = value.coreUrl ?? ''; this.state.core.name = 'Core';
    const user = value.user ?? value.lastKnownUser;
    this.state.core.account = user?.account ?? ''; this.state.core.role = user?.role ?? '';
    this.state.signedIn = value.state === 'authenticated' || value.state === 'offline' && !!value.lastKnownUser;
    if (value.state === 'offline') this.state.scenario = 'core-offline';
    else if (changed || !previouslySignedIn || !this.state.signedIn) this.state.scenario = 'normal';
    this.state.lastChecked = value.lastConfirmedAt ?? this.state.lastChecked;
  }
  private requireBrowserAccess(reason: string) {
    if (this.state.browserAccess !== 'required') this.clearIdentity();
    this.csrf = ''; this.generation = -1; this.state.signedIn = false;
    this.state.core.account = ''; this.state.core.role = ''; this.status = {};
    this.state.browserAccess = 'required'; this.state.browserAccessReason = reason;
    this.state.scenario = 'ticket-expired'; clearTimeout(this.sessionTimer); this.emit();
  }
  private unavailableBrowserAccess() {
    this.state.browserAccess = 'unavailable'; this.state.browserAccessReason = 'The local CLI could not be reached or its response could not be verified. Check browser access before continuing.';
    this.emit();
  }
  private finishAccessCheck(sequence: number) {
    if (sequence === this.authSequence && this.state.browserAccess === 'checking') this.unavailableBrowserAccess();
  }
  private sessionRead(): Promise<Data> {
    return this.request('session').then(value => {
      if (!['signed-out', 'authenticated', 'offline'].includes(value.state) || typeof value.csrf !== 'string' || !value.csrf || !Number.isInteger(value.generation) || typeof value.coreUrl !== 'string') throw new DesktopError('INVALID_RESPONSE', 'The local session response could not be verified.');
      return value;
    });
  }
  async checkBrowserAccess(): Promise<Data> {
    if (this.authCheck?.epoch === this.epoch && this.authCheck.sequence === this.authSequence) return this.authCheck.pending;
    const epoch = this.epoch, sequence = ++this.authSequence;
    let pending!: Promise<Data>;
    pending = (async () => {
      try {
        const value = await this.sessionRead();
        if (epoch !== this.epoch || sequence !== this.authSequence) throw new DesktopError('CONNECTION_CHANGED', 'An older access check was discarded.');
        this.acceptSession(value); this.scheduleSessionCheck(); this.emit(); return value;
      } catch (error) {
        if (epoch === this.epoch && sequence === this.authSequence) {
          if (error instanceof DesktopError && error.code === 'LOCAL_AUTH_REQUIRED') this.requireBrowserAccess('This browser is not authorized to connect to the local CLI. Use the latest launch address.');
          else if (!(error instanceof DesktopError && error.code === 'CONNECTION_CHANGED')) this.unavailableBrowserAccess();
        }
        throw error;
      } finally { this.finishAccessCheck(sequence); if (this.authCheck?.pending === pending) this.authCheck = undefined; }
    })();
    this.authCheck = { epoch, sequence, pending }; return pending;
  }
  async initialize() {
    const ticket = new URLSearchParams(location.hash.slice(1)).get('ticket');
    if (ticket) history.replaceState(null, '', location.pathname + location.search);
    this.state.browserAccess = 'checking'; this.emit();
    const epoch = this.epoch, sequence = ++this.authSequence;
    let value: Data;
    try {
      try { value = await this.sessionRead(); }
      catch (error) {
        if (epoch !== this.epoch || sequence !== this.authSequence) return;
        if (!(error instanceof DesktopError && error.code === 'LOCAL_AUTH_REQUIRED')) { this.unavailableBrowserAccess(); return; }
        if (!ticket) { this.requireBrowserAccess('This browser is not authorized to connect to the local CLI.'); return; }
        let redeemed = false, denied = '';
        try { await this.request('bootstrap', 'POST', { ticket }); redeemed = true; }
        catch (exchange) {
          if (exchange instanceof DesktopError && exchange.code === 'CONNECTION_CHANGED') return;
          if (exchange instanceof DesktopError && ['LOCAL_BOOTSTRAP_DENIED', 'LOCAL_SESSION_CAPACITY', 'LOCAL_SESSION_UNAVAILABLE'].includes(exchange.code)) denied = exchange.code;
        }
        // Never repeat a one-use exchange, including a lost response. Verify Cookie.
        try { value = await this.sessionRead(); }
        catch (verification) {
          if (epoch !== this.epoch || sequence !== this.authSequence) return;
          if (verification instanceof DesktopError && verification.code === 'LOCAL_AUTH_REQUIRED') {
            const reason = denied === 'LOCAL_SESSION_CAPACITY' ? 'The Desktop has reached 128 active browser sessions. In an authorized window, confirm Reset browser access, then reopen.' : redeemed ? 'The launch address was accepted, but this browser did not retain its Cookie. Allow local site Cookies, then request a new launch address.' : 'The launch address is expired, already used, or its exchange could not be confirmed. Use the most recent reopen output.';
            this.requireBrowserAccess(reason);
          } else this.unavailableBrowserAccess();
          return;
        }
      }
      if (epoch !== this.epoch || sequence !== this.authSequence) return;
      this.acceptSession(value); this.scheduleSessionCheck(); this.emit();
      if (this.state.signedIn) await this.checkConnection();
    } finally { this.finishAccessCheck(sequence); }
  }
  private scheduleSessionCheck() {
    clearTimeout(this.sessionTimer);
    if (this.state.browserAccess !== 'authorized') return;
    this.sessionTimer = setTimeout(async () => {
      try { const before = this.generation; await this.checkBrowserAccess(); if (before !== this.generation && this.state.signedIn) await this.checkConnection(); }
      catch { /* Local recovery is shown by the explicit session check. */ }
      this.scheduleSessionCheck();
    }, 15000);
  }
  reopenCommand() { return `piwork-cli desktop open --port ${this.localPort()} --no-open`; }
  logoutCommand() { return `piwork-cli desktop logout --port ${this.localPort()}`; }
  startCommand() { return `piwork-cli desktop --port ${this.localPort()} --no-open`; }
  private localPort() { const port = Number(location.port || 17891); return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 17891; }
  async resetBrowserAccess() {
    this.authSequence++;
    try {
      const result = await this.request('browser-access/reset', 'POST');
      if (result.browserAccessCleared !== true || result.coreSessionRetained !== true) throw new DesktopError('RESULT_UNKNOWN', 'Reset could not be confirmed. Check browser access.');
      this.requireBrowserAccess('Browser access was reset for all windows of this Desktop. The saved Core login and running Works are retained. Reopen from the terminal.');
    } catch (error) { await this.checkBrowserAccess().catch(() => undefined); throw error; }
  }
  async signIn(core: string, account: string, password: string) {
    this.authSequence++;
    if (core !== this.state.core.address) this.acceptSession(await this.request('connection', 'PUT', { coreUrl: core }));
    this.acceptSession(await this.request('login', 'POST', { account, password })); this.state.scenario = 'loading'; this.emit();
    const epoch = this.epoch;
    void this.checkConnection().catch(error => { if (epoch === this.epoch && this.state.signedIn) { this.state.scenario = 'list-error'; this.emit(); } });
  }
  async switchCore(core: string) { this.authSequence++; this.acceptSession(await this.request('connection', 'PUT', { coreUrl: core })); if (this.state.signedIn) await this.checkConnection(); this.emit(); }
  async signOut() { this.authSequence++; const value = await this.request('logout', 'POST'); this.clearIdentity(); this.acceptSession(value.view); this.emit(); return value; }
  async checkConnection() {
    await this.checkBrowserAccess();
    this.status = await this.request('status'); this.state.lastChecked = this.status.checkedAt ?? '';
    this.state.scenario = !this.status.health?.available ? 'core-offline' : !this.status.readiness?.available || this.status.readiness.value?.ready === false ? 'env-not-ready' : 'normal';
    if (this.state.signedIn && this.state.scenario !== 'core-offline') { await this.listWorks(); await this.checkCatalog(); await this.recoverOperations(); }
    this.emit();
  }
  async listWorks(explicit = true) {
    const epoch = this.epoch, mutations = new Map(this.workMutations); this.worksLoading = true; this.emit();
    try {
      const { value, sequence } = await this.readMetadata('works', explicit);
      if (epoch !== this.epoch) throw new ObservationStopped('The identity changed.');
      if (!Array.isArray(value.works)) throw new DesktopError('INVALID_RESPONSE', 'The Work list response is incomplete. Retry loading the list.');
      const ids = new Set(value.works.map((raw: Data) => raw.id));
      for (const raw of value.works) this.mergeWork(raw, sequence, mutations.get(raw.id) || 0);
      this.state.works = this.state.works.filter(work => ids.has(work.id) ||
        (mutations.get(work.id) || 0) !== (this.workMutations.get(work.id) || 0) || sequence < (this.workReads.get(work.id) || 0));
      for (const [id, sync] of this.workSync) {
        if (sync.generation !== (mutations.get(id) || 0) || sequence <= sync.after) continue;
        sync.list = false;
        const raw = value.works.find((item: Data) => item.id === id), work = this.getWork(id);
        if (ids.has(id) && work?.checkedAt && sequence >= (this.workReads.get(id) || 0) && (typeof raw?.controlVersion !== 'number' || raw.controlVersion >= (work.controlVersion || 0))) sync.work = false;
        if (!ids.has(id) && this.coordinationOperations().some(op => op.workId === id && op.action === 'delete' && op.state === 'succeeded')) {
          sync.work = false; this.deletedWorks.add(id);
        }
      }
      this.finishWorkSync(); this.worksError = '';
      this.worksChecked = new Date().toISOString();
      if (['loading', 'empty', 'list-error'].includes(this.state.scenario)) this.state.scenario = 'normal';
      if (!this.state.works.length && this.state.scenario === 'normal') this.state.scenario = 'empty'; this.emit();
    } catch (error) {
      if (epoch === this.epoch && this.state.signedIn && !(error instanceof ObservationStopped) && !(error instanceof ObservationDeferred)) {
        this.worksError = errorText(error); if (!this.worksChecked) this.state.scenario = 'list-error'; this.emit();
      }
      throw error;
    } finally { if (epoch === this.epoch) { this.worksLoading = false; this.emit(); } }
  }
  private mapWork(raw: Data, old?: Work): Work {
    return { ...(old ?? { network: '', services: [], files: [], sessions: [], config: blankConfig() }),
      id: raw.id, name: raw.name, description: raw.id, desired: raw.desiredState, observed: raw.observedState, status: workState(raw.observedState),
      error: typeof raw.lastError === 'string' ? raw.lastError : raw.lastError?.message, controlVersion: raw.controlVersion, checkedAt: new Date().toISOString(), statusError: undefined, updated: raw.updatedAt ?? '', color: 'blue', icon: 'grid',
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
  async refreshWorkStatus(id: string, explicit = true) {
    const epoch = this.epoch, mutation = this.workMutations.get(id) || 0, sequence = ++this.statusSequence;
    try {
      const { value: raw, sequence: readSequence } = await this.readMetadata(`works/${part(id)}`, explicit);
      const sequence = readSequence;
      if (epoch !== this.epoch) throw new ObservationStopped('The identity changed.');
      if (raw.id !== id) throw new DesktopError('INVALID_RESPONSE', 'The Work status response does not match the original Work.');
      const previous = this.getWork(id), wasUsable = previous && this.project(previous).usable;
      const work = this.mergeWork(raw, sequence, mutation);
      const sync = this.workSync.get(id);
      if (sync && sequence > sync.after && sync.generation === mutation && mutation === (this.workMutations.get(id) || 0) && sequence >= (this.workReads.get(id) || 0) && (typeof raw.controlVersion !== 'number' || raw.controlVersion >= (work?.controlVersion || 0))) sync.work = false;
      this.finishWorkSync(); this.emit();
      if (work && !wasUsable && this.project(work).usable && this.visibleWorkId === id) void this.refreshCapabilities(id);
      return work;
    } catch (error) {
      if (epoch === this.epoch && sequence >= (this.workReads.get(id) || 0) && mutation === (this.workMutations.get(id) || 0) && !(error instanceof ObservationStopped) && !(error instanceof ObservationDeferred)) {
        const work = this.getWork(id); if (work) work.statusError = errorText(error);
        if (error instanceof DesktopError && error.httpStatus === 404 && this.coordinationOperations().some(op => op.workId === id && op.action === 'delete' && op.state === 'succeeded')) {
          this.deletedWorks.add(id); this.state.works = this.state.works.filter(w => w.id !== id);
          const sync = this.workSync.get(id); if (sync) sync.work = false;
        }
        this.emit();
      }
      throw error;
    }
  }
  async loadWork(id: string) {
    const work = await this.refreshWorkStatus(id);
    if (!work) throw new DesktopError('NOT_FOUND', 'The Work is no longer available.', 404);
    work.resourceErrors = {};
    const tasks = [['services', () => this.loadServices(id)], ['configuration', () => this.loadConfiguration(id)], ['packages', () => this.loadPackages(id)]] as const;
    for (const [name, action] of tasks) { try { await action(); } catch (error) { work.resourceErrors[name] = errorText(error); } }
    if (['Ready', 'Degraded'].includes(work.status)) { try { await this.loadSessions(id); } catch (error) { work.resourceErrors.agent = errorText(error); } }
    this.emit(); return work;
  }
  async loadServices(id: string) {
    const work = this.getWork(id)!; (work.resourceLoading ??= {}).services = true; this.emit(); try { const value = await this.request(`works/${part(id)}/services`);
    if (!Array.isArray(value.services)) throw new DesktopError('INVALID_RESPONSE', 'Service listing is incomplete.'); (work.resourceChecked ??= {}).services = new Date().toISOString(); work.services = value.services.map((raw: Data) => ({ id: raw.serviceId, name: raw.name, domain: raw.access?.hostname ?? '', enabled: raw.enabled, observed: stateLabel(raw.observedState) as Work['services'][number]['observed'], ports: (raw.access?.ports ?? []).filter((p: Data) => /^https?:/.test(p.url ?? '')).sort((a: Data, b: Data) => Number(b.name === raw.access.defaultPortName) - Number(a.name === raw.access.defaultPortName)).map((p: Data) => p.port), error: typeof raw.lastError === 'string' ? raw.lastError : raw.lastError?.message }));
    if (work.resourceErrors) delete work.resourceErrors.services;
    const domain = work.services.find(service => service.domain)?.domain; work.network = domain ? domain.split('.').slice(1, -1).join('.') : '';
    this.emit();
  } catch (error) { (work.resourceErrors ??= {}).services = errorText(error); throw error; } finally { work.resourceLoading.services = false; this.emit(); }}
  async loadConfiguration(id: string) {
    const work = this.getWork(id)!; (work.resourceLoading ??= {}).configuration = true; this.emit(); try { const value = await this.request(`works/${part(id)}/configuration`); const raw = value.desired;
    work.config = { ...work.config, skills: raw.skills ?? [], packages: (raw.packages ?? []).map((p: Data) => ({ name: p.name, enabled: p.enabled, source: 'Saved Work copy' })), agents: raw.agentsMd ?? '', advanced: JSON.stringify(raw, null, 2), pendingApply: value.pendingApply, runtime: value.runtime, active: value.active, loaded: value.runtime?.state === 'ready', modelVisible: false };
    (work.resourceChecked ??= {}).configuration = new Date().toISOString(); if (work.resourceErrors) delete work.resourceErrors.configuration; this.emit(); return work.config;
  } catch (error) { (work.resourceErrors ??= {}).configuration = errorText(error); throw error; } finally { work.resourceLoading.configuration = false; this.emit(); }}
  async loadPackages(id: string) { const work = this.getWork(id)!; (work.resourceLoading ??= {}).packages = true; this.emit(); try { const value = await this.request(`works/${part(id)}/packages`); if (!Array.isArray(value.packages)) throw new DesktopError('INVALID_RESPONSE', 'Package listing is incomplete.'); (work.resourceChecked ??= {}).packages = new Date().toISOString(); work.packageEntries = value.packages; } catch (error) { (work.resourceErrors ??= {}).packages = errorText(error); throw error; } finally { work.resourceLoading.packages = false; this.emit(); }}
  async loadSessions(id: string) {
    const work = this.getWork(id)!; (work.resourceLoading ??= {}).agent = true; this.emit(); try { const value = await this.request(`works/${part(id)}/sessions`);
    if (!Array.isArray(value.sessions)) throw new DesktopError('INVALID_RESPONSE', 'Session listing is incomplete.'); (work.resourceChecked ??= {}).agent = new Date().toISOString(); const existing = new Map(work.sessions.map(session => [session.id, session])); work.sessions = value.sessions.map((raw: Data) => ({ id: raw.sessionId, title: raw.title ?? `Session ${raw.sessionId}`, messages: existing.get(raw.sessionId)?.messages ?? [] }));
    if (work.sessions[0] && !this.streams.has(id)) await this.loadSession(id, work.sessions[0].id); if (work.resourceErrors) delete work.resourceErrors.agent; this.emit();
  } catch (error) { (work.resourceErrors ??= {}).agent = errorText(error); throw error; } finally { work.resourceLoading.agent = false; this.emit(); }}
  async loadSession(id: string, sessionId: string) {
    const work = this.getWork(id); if (work?.run?.sessionId === sessionId && ['accepted', 'running', 'cancelling'].includes(work.run.status) && this.streams.has(id)) return;
    const value = await this.request(`works/${part(id)}/sessions/${part(sessionId)}`); const session = this.getWork(id)?.sessions.find(s => s.id === sessionId);
    if (session) session.messages = (value.messages ?? []).filter((message: Data) => ['user', 'assistant', 'toolResult'].includes(message.role)).map((message: Data) => message.role === 'toolResult' ? ({ role: 'assistant', text: '', tool: { name: 'Tool result', status: 'Saved result', content: message.text ?? '' } }) : ({ role: message.role, text: message.text ?? '' })); this.emit();
  }
  serviceEntryUrl(workId: string, serviceId: string, port: number) { return this.entries.get(`${workId}:${serviceId}:${port}`)?.entryUrl ?? null; }
  serviceEntryError(workId: string, serviceId: string, port: number) { return this.entryErrors.get(`${workId}:${serviceId}:${port}`) || ''; }
  servicePreviewUnconfirmed(workId: string, serviceId: string, port: number) { const entry = this.entries.get(`${workId}:${serviceId}:${port}`); return entry?.checked && entry.embed === 'unknown'; }
  async ensureServiceEntry(workId: string, serviceId: string, port: number) {
    const key = `${workId}:${serviceId}:${port}`; if (this.entries.has(key)) return;
    const epoch = this.epoch;
    let pending = this.entryPromises.get(key); if (!pending) { this.entryErrors.delete(key); pending = (async () => { try { const value = await this.request('service-entries', 'POST', { workId, serviceId, port }); this.entries.set(key, value);
        void this.serviceFrameLoaded(workId, serviceId, port).catch(error => { if (epoch === this.epoch && this.entries.get(key) === value) { value.checked = true; value.checkError = errorText(error); this.emit(); } }); }
      catch (error) { if (epoch === this.epoch) this.entryErrors.set(key, errorText(error)); throw error; }
      finally { if (this.entryPromises.get(key) === pending) this.entryPromises.delete(key); this.emit(); } })(); this.entryPromises.set(key, pending); } await pending;
  }
  serviceFrameLoaded(workId: string, serviceId: string, port: number) {
    const key = `${workId}:${serviceId}:${port}`; const old = this.entryChecks.get(key); if (old) return old;
    const pending = this.probeServiceFrame(workId, serviceId, port).finally(() => { if (this.entryChecks.get(key) === pending) this.entryChecks.delete(key); }); this.entryChecks.set(key, pending); return pending;
  }
  private async probeServiceFrame(workId: string, serviceId: string, port: number) {
    const key = `${workId}:${serviceId}:${port}`; const entry = this.entries.get(key); if (!entry) return;
    const epoch = this.epoch;
    // The first iframe load can be the ticket bootstrap, before the application response arrives.
    for (let attempt = 0; attempt < 12 && epoch === this.epoch && this.entries.get(key) === entry; attempt++) {
      const value = await this.request(`service-entries/${part(entry.entryId)}`); entry.embed = value.embed === 'blocked' ? 'denied' : value.embed;
      entry.entryUrl = entry.origin + '/'; this.emit();
      if (value.embed !== 'unknown') { entry.checked = true; this.emit(); return; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (epoch === this.epoch && this.entries.get(key) === entry) { entry.checked = true; this.emit(); }
  }
  serviceEmbed(workId: string, serviceId: string, port: number) { return this.entries.get(`${workId}:${serviceId}:${port}`)?.embed; }
  servicePreviewError(workId: string, serviceId: string, port: number) { return this.entries.get(`${workId}:${serviceId}:${port}`)?.checkError || ''; }
  async directServiceURL(workId: string, serviceId: string, port: number) { return (await this.request('service-entries', 'POST', { workId, serviceId, port })).entryUrl as string; }
  localLink(workId: string, serviceId: string, port: number) { return `${location.origin}/works/${part(workId)}/services/${part(serviceId)}?port=${port}`; }
  async readLogs(workId: string, serviceId: string) { const value = await this.request(`works/${part(workId)}/services/${part(serviceId)}/logs?tailLines=100`); this.logs.set(serviceId, value); this.emit(); }
  private accepted(value: Data, workId: string, kind: string) {
    if (!value.operationId) throw new DesktopError('INVALID_RESPONSE', 'The acceptance response has no Operation ID. Check known operations.');
    const operation: Operation = { id: value.operationId, workId: value.workId ?? workId, kind, action: lifecycleAction(kind), state: 'accepted', phase: 'Accepted', created: '', updated: '', scope: `${this.state.core.address} · ${this.state.core.account}`, snapshotId: value.snapshotId, localRecordSaved: value.localRecordSaved };
    if (operation.action && operation.workId) {
      const sequence = ++this.mutationSequence; this.workMutations.set(operation.workId, sequence);
      const work = this.getWork(operation.workId);
      if (work) { work.lifecycleIntent = { action: operation.action, operationId: operation.id, sequence, baseVersion: work.controlVersion }; work.operationId = operation.id; }
      this.requireWorkSync(operation.workId);
    }
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
  async lifecycle(id: string, action: 'start' | 'stop' | 'retry' | 'delete') { return this.accepted(await this.request(`works/${part(id)}/${action}`, 'POST'), id, `${action[0].toUpperCase()}${action.slice(1)} Work`); }
  async operateService(id: string, serviceId: string, action: string) { return this.accepted(await this.request(`works/${part(id)}/services/${part(serviceId)}/${action}`, 'POST'), id, `${action} Service`); }
  async checkOperation(id: string, explicit = true) {
    let operation = this.getOperation(id);
    let value: Data;
    try { value = (await this.readMetadata(`operations/${part(id)}`, explicit)).value; }
    catch (error) { if (operation && !(error instanceof ObservationStopped) && !(error instanceof ObservationDeferred)) { operation.observationError = errorText(error); this.emit(); } throw error; }
    if (value.operationId !== id && value.operationId !== undefined) throw new DesktopError('INVALID_RESPONSE', 'The Operation response does not match the original ID.');
    if (operation?.workId && value.workId && operation.workId !== value.workId) throw new DesktopError('INVALID_RESPONSE', 'The Operation belongs to another Work.');
    if (!operation) {
      operation = { id, workId: value.workId || '', kind: value.kind || value.type || 'Operation', state: 'unknown', phase: '', created: '', updated: '', scope: `${this.state.core.address} · ${this.state.core.account}` };
      this.state.operations.push(operation);
    }
    const previousState = operation.state;
    operation.checkedWorkId = value.operationId === id && typeof value.workId === 'string' ? value.workId : undefined;
    Object.assign(operation, { workId: value.workId ?? operation.workId, state: value.state, phase: value.packagePhase ?? value.state, created: value.createdAt ?? '', updated: value.updatedAt ?? '', error: value.error?.message ?? (typeof value.error === 'string' ? value.error : undefined), snapshotId: value.result?.snapshotId ?? operation.snapshotId, observationError: undefined });
    operation.action = lifecycleAction(value.kind || value.type || operation.kind);
    this.retainTerminal(operation);
    if (operation.workId && (previousState !== operation.state || explicit)) this.requireWorkSync(operation.workId);
    const work = this.getWork(operation.workId); if (work) this.associateOperations(work);
    if (operation.snapshotId) await this.fetchSnapshot(operation.snapshotId).catch(() => undefined);
    this.emit(); this.scheduleOperationPoll(); return operation;
  }
  async recoverOperations() {
    const value = await this.request('known-operations');
    for (const record of value.operations ?? []) if (!this.state.operations.some(o => o.id === record.operationId)) {
      this.state.operations.push({ id: record.operationId, workId: record.workId ?? '', kind: record.type, action: lifecycleAction(record.type), state: 'unknown', phase: 'Check original operation', created: record.recordedAt, updated: '', snapshotId: record.snapshotId, scope: `${this.state.core.address} · ${this.state.core.account}` });
    }
    for (const work of this.state.works) this.associateOperations(work);
    this.scheduleOperationPoll(); this.emit();
  }
  private finishWorkSync() {
    for (const [id, sync] of this.workSync) if (!sync.work && !sync.list) {
      this.workSync.delete(id);
      const work = this.getWork(id), intent = work?.lifecycleIntent;
      const evidence = intent && this.terminalEvidence.get(intent.operationId);
      if (intent && evidence?.generation === intent.sequence && evidence.operation.workId === id && terminalOperation(evidence.operation.state)) delete work!.lifecycleIntent;
    }
    for (const [id, evidence] of this.terminalEvidence) {
      const work = this.getWork(evidence.operation.workId);
      if (!this.workSync.has(evidence.operation.workId) && work?.lifecycleIntent?.operationId !== id) this.terminalEvidence.delete(id);
    }
    for (const work of this.state.works) this.associateOperations(work);
  }
  private observationTargets() {
    const active = this.state.operations.filter(op => !terminalOperation(op.state) && !this.pausedOperations.has(op.id));
    const workIds = new Set([...this.workSync].filter(([, sync]) => sync.work).map(([id]) => id));
    for (const op of active) if (op.workId) workIds.add(op.workId);
    return [
      ...active.map(op => ({ path: `operations/${part(op.id)}`, read: () => this.checkOperation(op.id, false) })),
      ...[...workIds].map(id => ({ path: `works/${part(id)}`, read: () => this.refreshWorkStatus(id, false) })),
      ...([...this.workSync.values()].some(sync => sync.list) ? [{ path: 'works', read: () => this.listWorks(false) }] : []),
    ];
  }
  private scheduleOperationPoll() {
    clearTimeout(this.pollTimer); this.pollTimer = undefined;
    if (!this.observationVisible || !this.state.signedIn) return;
    const now = Date.now(), keys = new Set<string>(), deadlines: number[] = [];
    for (const target of this.observationTargets()) {
      const key = this.metadataKey(target.path); keys.add(key);
      let record = this.pollTargets.get(key);
      if (!record) { record = { pending: false, nextAt: now + 2000 }; this.pollTargets.set(key, record); }
      if (record.pending || this.metadata.paused(key)) continue;
      deadlines.push(Math.max(record.nextAt, this.metadata.states.get(key)?.nextAt || 0));
    }
    for (const [key, record] of this.pollTargets) if (!keys.has(key) && !record.pending) this.pollTargets.delete(key);
    if (!deadlines.length) return;
    const epoch = this.epoch;
    this.pollTimer = setTimeout(() => { this.pollTimer = undefined; if (epoch === this.epoch) void this.pollOperations(false); }, Math.max(1, Math.min(...deadlines) - now));
  }
  private async pollOperations(immediate = true) {
    if (!this.observationVisible || !this.state.signedIn) return;
    const epoch = this.epoch, pending: Promise<unknown>[] = [];
    for (const target of this.observationTargets()) {
      const key = this.metadataKey(target.path);
      let record = this.pollTargets.get(key);
      if (!record) { record = { pending: false, nextAt: Date.now() }; this.pollTargets.set(key, record); }
      if (record.pending || !this.metadata.canRead(key) || !immediate && record.nextAt > Date.now()) continue;
      record.pending = true;
      const owned = record;
      const task = target.read().finally(() => {
        if (epoch !== this.epoch || this.pollTargets.get(key) !== owned) return;
        owned.pending = false;
        const readState = this.metadata.states.get(key);
        owned.nextAt = readState?.failures ? readState.nextAt : Date.now() + 2000;
        this.finishWorkSync(); this.emit(); this.scheduleOperationPoll();
      });
      pending.push(task);
    }
    // Completion of each object schedules its own next read, even while other objects hang.
    this.scheduleOperationPoll();
    await Promise.allSettled(pending);
  }
  observePage(workId: string, visible: boolean) {
    const entering = this.visibleWorkId !== workId || !this.observationVisible && visible;
    this.visibleWorkId = workId;
    if (visible !== this.observationVisible) {
      this.observationVisible = visible;
      if (!visible) { clearTimeout(this.pollTimer); this.pollTimer = undefined; this.metadata.cancel(); }
    }
    if (visible && entering) { this.metadata.rearm(); this.scheduleOperationPoll(); }
  }
  async refreshVisibleWork(id: string) {
    const work = await this.refreshWorkStatus(id, false);
    if (work && this.project(work).usable) await this.loadServices(id);
  }
  refreshCapabilities(id: string) {
    const old = this.capabilityReads.get(id); if (old) return old;
    const work = this.getWork(id); if (!work || !this.project(work).usable) return Promise.resolve();
    const pending = (async () => {
      await Promise.allSettled([this.loadServices(id), this.loadSessions(id), this.loadConfiguration(id), this.loadPackages(id)]);
    })().finally(() => { if (this.capabilityReads.get(id) === pending) this.capabilityReads.delete(id); });
    this.capabilityReads.set(id, pending); return pending;
  }
  operationPaused(id: string) { return this.pausedOperations.has(id); }
  pauseOperation(id: string) { this.pausedOperations.add(id); }
  resumeOperation(id: string) { this.pausedOperations.delete(id); this.scheduleOperationPoll(); }
  async clearOperations() {
    const epoch = this.epoch;
    const selected = this.state.operations.filter(op => terminalOperation(op.state));
    for (const operation of selected) {
      this.retainTerminal(operation);
      await this.request(`known-operations/${part(operation.id)}`, 'DELETE');
      if (epoch !== this.epoch) return;
      this.state.operations = this.state.operations.filter(op => op.id !== operation.id);
    }
    this.finishWorkSync(); this.emit();
  }
  async newSession(id: string) { const value = await this.request(`works/${part(id)}/sessions`, 'POST'); const sessionId = value.sessionId ?? value.session?.sessionId; if (typeof sessionId !== 'string' || !sessionId) throw new DesktopError('INVALID_RESPONSE', 'Session acceptance has no ID. Read Sessions before creating again.'); this.getWork(id)!.sessions.unshift({ id: sessionId, title: `Session ${sessionId}`, messages: [] }); this.emit(); return sessionId as string; }
  async send(id: string, sessionId: string, text: string, includeIdentity: boolean) {
    if (!text.trim()) throw new Error('Write a message first.'); const work = this.getWork(id)!;
    const prompt = includeIdentity ? `${text}\n\nSelected Service: ${work.services.find(s => s.id === this.selectedService)?.domain ?? ''}` : text;
    const value = await this.request(`works/${part(id)}/runs`, 'POST', { sessionId, prompt }); const raw = value.run;
    work.run = { id: raw.runId, sessionId, status: runStates[raw.state] ?? 'interrupted', cursor: 0, created: raw.acceptedAt ?? '' };
    work.sessions.find(s => s.id === sessionId)!.messages.push({ role: 'user', text }, { role: 'assistant', text: '' }); this.emit(); void this.resumeRun(id); return raw.runId as string;
  }
  selectedService = '';
  async cancelRun(id: string) { const work = this.getWork(id)!; const run = work.run; if (run && !run.cancellationRequested) { await this.request(`works/${part(id)}/runs/${part(run.id)}/cancel`, 'POST'); run.cancellationRequested = true; this.emit(); void this.request(`works/${part(id)}/runs/${part(run.id)}`).then(value => { if (work.run === run) { run.status = runStates[(value.run ?? value).state] ?? 'interrupted'; this.emit(); } }).catch(error => { if (work.run === run) { run.error = `Cancellation requested; status not confirmed: ${errorText(error)}`; this.emit(); } }); } }
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
  resumeRunConnection(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let connected = false;
      void this.resumeRun(id, () => { connected = true; resolve(); }).then(() => {
        if (!connected) reject(new Error(this.getWork(id)?.run?.error || 'Run connection was not confirmed. Read the original Run.'));
      }, reject);
    });
  }
  async resumeRun(id: string, connected?: () => void) {
    const work = this.getWork(id)!; const run = work.run; if (!run) return;
    clearTimeout(this.reconnects.get(id)); this.reconnects.delete(id); run.error = undefined;
    this.historyObservers.get(id)?.controller.abort(); this.historyObservers.delete(id);
    this.streams.get(id)?.abort(); const controller = new AbortController(); this.streams.set(id, controller); const epoch = this.epoch;
    if (run.historyRecovery) { this.streams.delete(id); const observer = { controller, run, epoch, failures: 0 }; this.historyObservers.set(id, observer); await this.recoverRunHistory(id, observer); if (!observer.failures) connected?.(); return; }
    try {
      const response = await fetch(`/_desktop/api/works/${part(id)}/runs/${part(run.id)}/events?after=${run.cursor}`, { credentials: 'same-origin', signal: controller.signal });
      if (epoch !== this.epoch || controller.signal.aborted || this.streams.get(id) !== controller || this.getWork(id)?.run !== run) return;
      if (!response.ok) { if (response.status === 410) { run.historyRecovery = true; const observer = { controller, run, epoch, failures: 0 }; this.historyObservers.set(id, observer); await this.recoverRunHistory(id, observer); if (!observer.failures) connected?.(); return; } throw new Error(`Run stream failed (${response.status}).`); }
      connected?.();
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
    const epoch = this.epoch; const work = this.getWork(id)!; const key = `${id}:${path}`, state = this.directories.get(key) || { loading: false, checkedAt: '', error: '' }; this.directories.set(key, state); state.loading = true; this.emit(); try { const base = this.fileURL(id, path).replace(/\/?$/, '/');
    const response = await fetch(base, { method: 'PROPFIND', credentials: 'same-origin', headers: { Depth: '1', 'X-Piwork-Csrf': this.csrf } }); if (!response.ok) throw new Error(`Workspace cannot be read (${response.status}).`);
    if (epoch !== this.epoch) throw new Error('The connection changed; the file listing was discarded.');
    const text = await response.text(); if (epoch !== this.epoch) throw new Error('The identity changed while reading directory metadata.'); const entries = parseEntries(text, base); state.checkedAt = new Date().toISOString(); state.error = ''; const children: WorkspaceFile[] = entries.filter(e => e.name !== '/').map(e => ({ path: (path === '/' ? '' : path) + '/' + e.name, name: e.name, kind: e.directory ? 'directory' : e.kind === 'file' ? 'file' : 'special', size: e.size ?? 0, modified: e.modified ?? '' }));
    for (const child of children) { const old = work.files.find(f => f.path === child.path); if (old?.content !== undefined && old.size === child.size && old.modified === child.modified) { child.content = old.content; child.kind = old.kind; } } work.files = [...work.files.filter(f => (f.path.slice(0, f.path.lastIndexOf('/')) || '/') !== path), ...children]; if (work.resourceErrors) delete work.resourceErrors.files; this.emit();
    } catch (error) { if (epoch === this.epoch) { (work.resourceErrors ??= {}).files = errorText(error); state.error = errorText(error); this.emit(); } throw error; } finally { state.loading = false; if (epoch === this.epoch) this.emit(); }
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
  private async uploadResponse(url: string, method: string, body: File | FormData, headers: Record<string, string>, progress: (sent: number, total?: number, sentAll?: boolean) => void) {
    const epoch = this.epoch;
    return new Promise<Response>((resolve, reject) => {
      const xhr = new XMLHttpRequest(); xhr.open(method, url); xhr.withCredentials = true;
      for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
      xhr.upload.onprogress = event => progress(event.loaded, event.lengthComputable ? event.total : undefined);
      xhr.upload.onload = () => { if (epoch === this.epoch) progress(0, undefined, true); };
      xhr.onload = () => {
        if (epoch !== this.epoch) { reject(new DesktopError('CONNECTION_CHANGED', 'The identity changed during upload.')); return; }
        const resultHeaders = new Headers(); for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) { const at = line.indexOf(':'); if (at > 0) resultHeaders.append(line.slice(0, at), line.slice(at + 1).trim()); }
        resolve(new Response(xhr.status === 204 || xhr.status === 205 ? null : xhr.responseText, { status: xhr.status, headers: resultHeaders }));
      };
      xhr.onerror = () => reject(new DesktopError('RESULT_UNKNOWN', 'Upload response lost. Check the original target before submitting again.'));
      xhr.onabort = xhr.onerror; xhr.send(body);
    });
  }
  private async writeFile(id: string, path: string, method: string, body?: BodyInit, headers: Record<string, string> = {}): Promise<TransferResult[]> {
    if (path === '/' && method !== 'MKCOL') throw new Error('The workspace root cannot be mutated.');
    const epoch = this.epoch; let response: Response; try { response = body instanceof File
      ? await this.uploadResponse(this.fileURL(id, path), method, body, { ...headers, 'X-Piwork-Csrf': this.csrf }, (sent, total, sentAll) => { const progress = this.uploadProgress.get(id); if (epoch === this.epoch && progress) { Object.assign(progress, sentAll ? { phase: 'Waiting for confirmation' } : { phase: 'Uploading', transferred: sent, total }); this.emit(); } })
      : await fetch(this.fileURL(id, path), { method, credentials: 'same-origin', headers: { ...headers, 'X-Piwork-Csrf': this.csrf }, body }); }
    catch { return [{ path, status: 'unknown', message: 'Response lost. Refresh source and destination before trying again.' }]; }
    if (epoch !== this.epoch) throw new Error('The connection changed; file results must be checked under the original account.');
    if (response.status === 207) { let result; try { result = mutationResults(await response.text()); } catch { return [{ path, status: 'unknown', message: 'The per-path result could not be read. Refresh affected paths before trying again.' }]; } return [...result.succeeded.map(path => ({ path, status: 'succeeded' as const, message: 'Confirmed' })), ...result.failed.map(path => ({ path, status: 'failed' as const, message: 'Path failed; inspect its status.' }))]; }
    if (!response.ok) { const value = await response.json().catch(() => ({})); return [{ path, status: 'failed', httpStatus: response.status, message: response.status === 412 ? 'The target changed. Your input is kept. Reread the target and explicitly confirm its version before retrying.' : value.message ?? `Request failed (${response.status}).` }]; }
    return [{ path, status: 'succeeded', message: 'Confirmed', modified: fileVersion(response.headers.get('Last-Modified')) }];
  }
  async saveFile(id: string, path: string, content: string, baseline: string, unprotectedConsent = false, confirmed?: (result: TransferResult) => void) {
    if (new TextEncoder().encode(content).length > 1_048_576) throw new Error('Text exceeds the 1 MiB editor limit.');
    const modified = fileVersion(baseline);
    if (!modified && !unprotectedConsent) throw new Error('No modification time is available. Explicitly approve an unprotected overwrite first.');
    const results = await this.writeFile(id, path, 'PUT', content, { 'Content-Type': 'text/plain; charset=utf-8', ...(modified ? { 'If-Unmodified-Since': modified } : {}) });
    const result = results[0]; this.state.transfers = results; this.transfersByWork.set(id, results);
    if (result.status === 'succeeded') {
      confirmed?.(result);
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
    this.state.transfers = results; this.transfersByWork.set(id, results); this.emit(); return results;
  }
  async upload(id: string, directory: string, files: File[], overwrite = false) {
    const epoch = this.epoch; const results: TransferResult[] = [];
    for (const file of files) {
      if (!file.name || /[\\/\x00]/.test(file.name)) throw new Error('Invalid upload file name.');
      const path = (directory === '/' ? '' : directory) + '/' + file.name; const key = `${id}:${path}`;
      this.uploadProgress.set(id, { workId: id, path, phase: 'Checking target', index: files.indexOf(file) + 1, count: files.length }); this.emit();
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
    this.state.transfers = results; this.transfersByWork.set(id, results); this.uploadProgress.delete(id); this.emit(); return results;
  }
  async saveConfiguration(id: string, config: Configuration) { const raw = synchronizeConfiguration(config); await this.request(`works/${part(id)}/configuration`, 'PUT', { configuration: raw }); this.getWork(id)!.config = structuredClone(config); this.emit(); }
  async replaceSkill(id: string, name: string) { const work = this.getWork(id)!; const skills = Array.from(new Set([...work.config.skills, name])); await this.request(`works/${part(id)}/configuration/skills`, 'PUT', { skills }); work.config = { ...work.config, skills }; this.emit(); }
  async applyConfiguration(id: string) { return this.accepted(await this.request(`works/${part(id)}/configuration/apply`, 'POST'), id, 'Apply configuration'); }
  async installPackage(id: string, name: string, sourceLabel: string, files?: File[], updateTarget?: string) {
    const kind = sourceLabel.split(': ')[0]; const spec = sourceLabel.slice(kind.length + 2); let source: Data;
    if (kind === 'Core') source = { kind: 'core', name };
    else if (kind === 'npm' || kind === 'Git') source = { kind: kind === 'Git' ? 'git' : 'npm', spec };
    else { if (!files?.length) throw new Error('Choose the actual package files.'); const form = new FormData(); form.set('kind', kind === 'ZIP' ? 'zip' : 'local'); for (const file of files) form.append(kind === 'ZIP' ? 'zip' : 'files', file, file.webkitRelativePath || file.name);
      const epoch = this.epoch; this.uploadProgress.set(id, { workId: id, path: name, phase: 'Uploading package' }); this.emit();
      const response = await this.uploadResponse(`/_desktop/api/works/${part(id)}/package-uploads`, 'POST', form, { 'X-Piwork-Csrf': this.csrf }, (sent, total, sentAll) => { const progress = this.uploadProgress.get(id); if (epoch === this.epoch && progress) { Object.assign(progress, sentAll ? { phase: 'Validating and forwarding' } : { phase: 'Uploading package', transferred: sent, total }); this.emit(); } });
      const value = await response.json(); if (!response.ok) throw new Error(value.message ?? 'Package upload failed.'); source = { kind: 'upload', uploadId: value.uploadId }; this.uploadProgress.delete(id); this.emit(); }
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
  stopDownloadObservers() { for (const observer of this.downloadObservers.values()) observer.active = false; this.downloadObservers.clear(); }
  async checkDownload(snapshotID: string) {
    const job = this.downloads.get(snapshotID); if (!job) throw new Error('No original transfer is known for this snapshot.');
    try { const value = await this.request(`downloads/${part(job.transferId)}`);
      if (this.downloads.get(snapshotID) !== job) return;
      if (!job.ready) Object.assign(job, value, { seen: true, checkedAt: new Date().toISOString(), observationError: '' });
      else { job.checkedAt = new Date().toISOString(); job.observationError = ''; }
      // A successful read resumes observation of the original transfer after a lost POST.
      job.error = '';
      this.emit(); return job;
    } catch (error) {
      if (this.downloads.get(snapshotID) !== job) throw error;
      if (error instanceof DesktopError && error.httpStatus === 404 && job.pending && !job.seen) return job;
      job.observationError = errorText(error); this.emit(); throw error;
    }
  }
  observeDownload(snapshotID: string) {
    if (this.downloadObservers.has(snapshotID)) return;
    const job = this.downloads.get(snapshotID); if (!job || job.ready) return;
    const observer = { active: true }; this.downloadObservers.set(snapshotID, observer);
    void (async () => { try {
      while (observer.active && this.downloads.get(snapshotID) === job && !job.ready && !job.error) {
        await new Promise(resolve => setTimeout(resolve, 500)); if (!observer.active) break;
        try { await this.checkDownload(snapshotID); } catch { break; }
      }
    } finally { if (this.downloadObservers.get(snapshotID) === observer) this.downloadObservers.delete(snapshotID); } })();
  }
  downloadSnapshot(id: string): Promise<string> {
    const old = this.downloads.get(id), known = this.downloadRequests.get(id);
    if (old?.ready) return Promise.resolve(`/_desktop/api/downloads/${part(old.transferId)}/content`);
    if (known) { this.observeDownload(id); return known; }
    if (old) return Promise.reject(new Error('An original transfer is already known. Check transfer before preparing again.'));
    const epoch = this.epoch; const job: Data = { transferId: crypto.randomUUID(), snapshotId: id, phase: 'Preparing', pending: true, seen: false, transferred: 0 };
    this.downloads.set(id, job); this.emit(); this.observeDownload(id);
    let pending!: Promise<string>; pending = (async () => {
      try {
        const value = await this.requestOnce(`work-snapshots/${part(id)}/downloads`, 'POST', {}, undefined, { 'X-Piwork-Transfer-Id': job.transferId });
        if (epoch !== this.epoch) throw new DesktopError('CONNECTION_CHANGED', 'The identity changed. Original transfer access ended.');
        if (value.transferId !== job.transferId || !value.ready) throw new DesktopError('RESULT_UNKNOWN', 'Download confirmation was incomplete. Check the original transfer.');
        Object.assign(job, value, { phase: 'ready', checkedAt: new Date().toISOString(), observationError: '' });
        return `/_desktop/api/downloads/${part(job.transferId)}/content`;
      } catch (error) { const failure = error instanceof DesktopError ? error : new DesktopError('RESULT_UNKNOWN', 'Download response lost. Check the original transfer.'); if (epoch === this.epoch && !job.ready) { job.error = errorText(failure); job.phase = 'Not confirmed'; } throw failure; }
      finally { if (epoch === this.epoch) { job.pending = false; this.emit(); } if (this.downloadRequests.get(id) === pending) this.downloadRequests.delete(id); }
    })(); this.downloadRequests.set(id, pending); return pending;
  }
}
export const adapter = new DesktopAdapter();
