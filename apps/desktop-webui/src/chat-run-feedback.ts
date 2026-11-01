import type { NoticeEvent } from './notices.js';
import type { Run } from './models.js';

export type RunFeedbackFacts = Pick<Run, 'id' | 'sessionId' | 'status' | 'cursor' | 'error' | 'executionError' | 'errorCode'>;
export interface RunFeedbackObservation { readonly revision: number; readonly run: Readonly<RunFeedbackFacts> }
const key = (work: string, session: string, run: string) => JSON.stringify([work, session, run]);

/** Local observation evidence only; never a Run state machine or network owner. */
export class RunFeedbackObservations {
  private sequence = 0;
  private entries = new Map<string, RunFeedbackObservation>();
  record(work: string, run: Readonly<RunFeedbackFacts>, confirmed: boolean) {
    if (!work || !run.id || !run.sessionId) return;
    const id = key(work, run.sessionId, run.id);
    const revision = confirmed ? ++this.sequence : this.entries.get(id)?.revision ?? 0;
    this.entries.set(id, { revision, run: {
      id: run.id, sessionId: run.sessionId, status: run.status, cursor: run.cursor,
      error: run.error, executionError: run.executionError, errorCode: run.errorCode,
    } });
  }
  get(work: string, session: string, run: string) { return this.entries.get(key(work, session, run)); }
  forget(work: string, session: string, run: string) { this.entries.delete(key(work, session, run)); }
  clear() { this.entries.clear(); }
}
export interface ChatRunTarget {
  readonly identity: string;
  readonly work: string;
  readonly workName?: string;
  readonly session: string;
  readonly run: string;
}
export interface ChatRunFeedbackResult {
  readonly target: ChatRunTarget;
  readonly owner: Pick<NoticeEvent, 'identity' | 'object' | 'task' | 'generation'>;
  readonly event?: NoticeEvent;
  readonly resolve: boolean;
  readonly retired: boolean;
}
interface Tracked { target: ChatRunTarget; failedAt: number; tone?: 'error' | 'unknown'; episode: number }

/** Only explicit UI acceptance registers a Run; arbitrary history reads cannot announce one. */
export class ChatRunFeedback {
  private identity = '';
  private tracked = new Map<string, Tracked>();
  setIdentity(identity: string) {
    if (identity === this.identity) return;
    this.identity = identity;
    this.tracked.clear();
  }
  accept(target: ChatRunTarget) {
    if (target.identity !== this.identity || !target.work || !target.session || !target.run) return false;
    const id = key(target.work, target.session, target.run);
    if (!this.tracked.has(id)) this.tracked.set(id, { target: { ...target }, failedAt: -1, episode: 0 });
    return true;
  }
  project(
    read: (target: ChatRunTarget) => RunFeedbackObservation | undefined,
    message: (run: Readonly<RunFeedbackFacts>, target: ChatRunTarget) => string,
    recovery: (target: ChatRunTarget) => NoticeEvent['recovery'],
  ): ChatRunFeedbackResult[] {
    const output: ChatRunFeedbackResult[] = [];
    for (const [id, entry] of this.tracked) {
      const observation = read(entry.target);
      if (!observation || observation.run.id !== entry.target.run || observation.run.sessionId !== entry.target.session) continue;
      const { run, revision } = observation;
      const owner = { identity: this.identity, object: entry.target.work, task: `chat-run:${id}`, generation: 0 };
      const tone = run.executionError || ['failed', 'interrupted'].includes(run.status) ? 'error'
        : run.error && ['accepted', 'running', 'cancelling'].includes(run.status) ? 'unknown' : undefined;
      if (tone) {
        if (entry.tone !== tone) entry.episode++;
        entry.tone = tone;
        entry.failedAt = revision;
        output.push({ target: entry.target, owner, resolve: false, retired: false, event: {
          ...owner, key: `${entry.episode}:${tone}:${run.status}:${run.errorCode || ''}`, tone,
          message: () => message(run, entry.target), recovery: recovery(entry.target),
        } });
        continue;
      }
      // Error clearing at reconnect start is not a successful observation.
      const confirmed = revision > entry.failedAt;
      const resolved = entry.tone === 'unknown' && confirmed;
      const retired = entry.tone !== 'error' && !run.error && !run.executionError && confirmed && ['succeeded', 'cancelled'].includes(run.status);
      if (resolved) entry.tone = undefined;
      output.push({ target: entry.target, owner, resolve: resolved || retired, retired });
      if (retired) this.tracked.delete(id);
    }
    return output;
  }
}
