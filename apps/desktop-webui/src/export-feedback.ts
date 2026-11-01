import type { ExportFlow } from './export-flow.js';
import type { NoticeEvent } from './notices.js';
import { t } from './locale.js';

type FlowFacts = Readonly<Pick<ExportFlow, 'id' | 'workId' | 'workName' | 'identityEpoch' | 'phase' | 'error' | 'feedbackIssue' | 'feedbackError' | 'transferConfirmation' | 'autoDeliveryConsumed'>>;
export interface LogExportFeedbackFacts {
  readonly id: string;
  readonly key: string;
  readonly phase: 'creating' | 'collecting' | 'packing' | 'ready' | 'failed' | 'interrupted' | 'expired' | 'unknown';
  readonly error: string;
  readonly restored: boolean;
  readonly intent: boolean;
  readonly complete: boolean | null;
  readonly warningCount: number;
}
type Owner = Pick<NoticeEvent, 'identity' | 'object' | 'task' | 'generation'>;
export interface ExportFeedbackRegistration<T> {
  readonly owner: Owner;
  readonly original: T;
}

/** Only page-accepted original intents, never historical exports or a request owner. */
export class ExportFeedbackRegistry {
  private identity = '';
  private originalFlows = new WeakMap<FlowFacts, ExportFeedbackRegistration<FlowFacts>>();
  private readIssues = new WeakSet<FlowFacts>();
  private unknownTransfers = new WeakMap<FlowFacts, number>();
  private flows = new Map<string, ExportFeedbackRegistration<FlowFacts>>();
  private log?: ExportFeedbackRegistration<LogExportFeedbackFacts>;
  setIdentity(identity: string): void {
    if (identity === this.identity) return;
    this.identity = identity;
    this.flows.clear();
    this.readIssues = new WeakSet();
    this.unknownTransfers = new WeakMap();
    this.originalFlows = new WeakMap();
    this.log = undefined;
  }
  acceptFlow(flow: FlowFacts): void {
    if (String(flow.identityEpoch) !== this.identity || this.flows.has(flow.id)) return;
    const registration = { original: flow, owner: Object.freeze({ identity: this.identity, object: flow.workId, task: `export:${flow.id}`, generation: flow.id }) };
    this.flows.set(flow.id, registration);
    this.originalFlows.set(flow, registration);
  }
  flowOwner(flow: FlowFacts): ExportFeedbackRegistration<FlowFacts> | undefined {
    const registration = this.originalFlows.get(flow);
    return registration && registration.owner.identity === this.identity && String(flow.identityEpoch) === this.identity &&
      registration.owner.object === flow.workId && registration.owner.task === `export:${flow.id}` ? registration : undefined;
  }
  acceptLog(state: LogExportFeedbackFacts | null): void {
    if (!state || state.restored || !state.intent || !state.key || this.log?.original === state) return;
    this.log = { original: state, owner: Object.freeze({ identity: this.identity, object: 'log-export', task: `log-export:${state.key}`, generation: state.key }) };
  }
  flowOwners(): readonly ExportFeedbackRegistration<FlowFacts>[] { return [...this.flows.values()]; }
  logOwner(state: LogExportFeedbackFacts | null): ExportFeedbackRegistration<LogExportFeedbackFacts> | undefined {
    return this.log?.original === state ? this.log : undefined;
  }
  readRecovered(registration: ExportFeedbackRegistration<FlowFacts>): boolean {
    const flow = registration.original;
    if (registration.owner.identity !== this.identity) return false;
    if (flow.phase === 'unknown' && !this.unknownTransfers.has(flow)) this.unknownTransfers.set(flow, flow.transferConfirmation || 0);
    if (flow.feedbackIssue === 'read') {
      this.readIssues.add(flow);
      return false;
    }
    if (flow.feedbackIssue || ['unknown', 'failed', 'revoked'].includes(flow.phase)) return false;
    const priorTransfer = this.unknownTransfers.get(flow);
    const transferRecovered = priorTransfer !== undefined && (flow.transferConfirmation || 0) > priorTransfer;
    if (!this.readIssues.has(flow) && !transferRecovered) return false;
    this.readIssues.delete(flow);
    this.unknownTransfers.delete(flow);
    return true;
  }
  publishedFlow(registration: ExportFeedbackRegistration<FlowFacts>, accepted: boolean): void {
    if (accepted && ['failed', 'delivered', 'revoked'].includes(registration.original.phase) && this.flows.get(registration.original.id)?.original === registration.original) {
      this.flows.delete(registration.original.id);
    }
  }
}

/** ExportFlows owns validation and delivery; this projection cannot advance or unlock it. */
export function exportFlowNotice(registration: ExportFeedbackRegistration<FlowFacts>, recovery: NoticeEvent['recovery']): NoticeEvent | undefined {
  const flow = registration.original;
  if (String(flow.identityEpoch) !== registration.owner.identity || registration.owner.object !== flow.workId || registration.owner.task !== `export:${flow.id}` || flow.phase === 'revoked') return;
  const tone = flow.phase === 'unknown' ? 'unknown' : flow.phase === 'failed' || flow.feedbackIssue ? 'error' : undefined;
  if (!tone) return;
  const phase = flow.phase, reason = ['unknown', 'failed'].includes(flow.phase) ? flow.error : flow.feedbackError, name = flow.workName;
  return { ...registration.owner, key: `${tone}:${phase}`, tone, recovery,
    message: () => `${name} · ${t(`export.phase.${phase}`)}${reason ? ` · ${reason}` : ''}` };
}

/** Original log task only. Ready means an archive is ready, not that a disk save succeeded. */
export function logExportNotice(registration: ExportFeedbackRegistration<LogExportFeedbackFacts>, recovery: NoticeEvent['recovery']): NoticeEvent | undefined {
  const state = registration.original;
  if (state.restored || !state.intent || !state.key || registration.owner.task !== `log-export:${state.key}` || state.phase === 'ready' && !state.id) return;
  const tone = state.phase === 'unknown' ? 'unknown' : state.error || ['failed', 'interrupted', 'expired'].includes(state.phase) ? 'error' : state.phase === 'ready' ? state.complete === false || state.warningCount > 0 ? 'warning' : 'success' : undefined;
  if (!tone) return;
  const phase = state.phase, reason = state.error, count = state.warningCount;
  const label = phase === 'unknown' ? 'logs.unknown' : phase === 'expired' ? 'logs.expired' : phase === 'ready' ? 'logs.ready' : phase === 'collecting' ? 'logs.collecting' : phase === 'packing' ? 'logs.packing' : 'logs.failed';
  return { ...registration.owner, key: `${tone}:${phase}`, tone, recovery,
    message: () => `${t('logs.title')} · ${t(label)}${tone === 'warning' ? ` · ${t('logs.gaps', { count })}` : ''}${reason ? ` · ${reason}` : ''}` };
}

/** Captured recovery must never display a newer task; ordinary menu opens remain current. */
export function logExportTargetAvailable(originalKey: string | undefined, current: Pick<LogExportFeedbackFacts, 'key'> | null): boolean {
  return !originalKey || current?.key === originalKey;
}

/** These ongoing phases plus a receipt are written only by an actual original response. */
export function logExportReadRecovered(
  registration: ExportFeedbackRegistration<LogExportFeedbackFacts>,
  current: LogExportFeedbackFacts | null,
  identity: string,
): boolean {
  return current === registration.original && registration.owner.identity === identity &&
    !!current?.id && !!current.key && registration.owner.task === `log-export:${current.key}` &&
    !current.restored && current.intent && !current.error && ['collecting', 'packing'].includes(current.phase);
}
