import type { HistoryRunRecord, RunRecord, SessionOperationState, WorkStore } from '@piwork/work-store';
import type { RunModelSnapshot } from '@piwork/contracts';
import type { SessionHistoryReader } from './session-history.js';
import type { PiSdkRunExecutor } from './pi-sdk-executor.js';
import { SessionManagementError } from '@piwork/work-store';

type Store = Pick<WorkStore, 'schemaVersion' | 'firstSuccessfulChatRun' | 'sessionManagement'>;
type History = Pick<SessionHistoryReader, 'page'>;
type Generator = Pick<PiSdkRunExecutor, 'generateSessionTitle'>;

/** Owns bounded title requests; it never submits an Agent Run or executes tools. */
export class SessionNamingCoordinator {
  private closed = false;
  private readonly controllers = new Set<AbortController>();
  private readonly jobs = new Set<Promise<void>>();

  constructor(private readonly workId: string, private readonly store: Store, private readonly history: History, private readonly generator: Generator, private readonly timeoutMs = 15_000) {}

  recover(): void {
    if (this.store.schemaVersion >= 8) this.store.sessionManagement.markInterruptedAutomaticUnknown(this.workId);
  }

  onSettled(run: RunRecord): void {
    if (this.closed || this.store.schemaVersion < 8 || run.workId !== this.workId || run.state !== 'succeeded') return;
    const first = this.store.firstSuccessfulChatRun(this.workId, run.sessionId);
    if (!first || first.runId !== run.runId) return;
    const revision = this.store.sessionManagement.claimAutomatic(this.workId, run.sessionId, run.runId);
    if (revision !== undefined) this.launch(first, revision);
  }

  startExplicit(sessionId: string, expectedRevision: number, operationKey: string): { started: boolean; status: SessionOperationState; state: ReturnType<Store['sessionManagement']['read']> } {
    if (this.closed || this.store.schemaVersion < 8) throw new Error('Session naming unavailable');
    const first = this.store.firstSuccessfulChatRun(this.workId, sessionId);
    if (!first) throw new SessionManagementError('SESSION_INVALID');
    const result = this.store.sessionManagement.beginExplicitAuto(this.workId, sessionId, first.runId, expectedRevision, operationKey);
    if (result.started) this.launch(first, expectedRevision, operationKey);
    return result;
  }

  private launch(run: HistoryRunRecord, revision: number, operationKey?: string): void {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const job = Promise.resolve().then(async () => {
      try {
        if (!run.actualModelJson) throw new Error('The original model is unavailable');
        const model = JSON.parse(run.actualModelJson) as RunModelSnapshot;
        let user = '', cursor: string | undefined;
        // A Run may begin with SDK system entries. Walk a bounded number of
        // entries until the first actual user text, without reading later turns.
        for (let page = 0; page < 8 && !user; page++) {
          const input = this.history.page(run.sessionId, { runId: run.runId, direction: 'newer', limit: 1, ...(cursor ? { cursor } : {}) });
          user = input.segments.filter(segment => segment.role === 'user' && segment.type === 'text').map(segment => segment.text).join('');
          if (!input.hasMore || !input.nextCursor) break;
          cursor = input.nextCursor;
        }
        const output = this.history.page(run.sessionId, { runId: run.runId, direction: 'newer', content: 'result', limit: 1 });
        const reply = output.segments.filter(segment => segment.role === 'assistant' && (segment.type === 'text' || segment.type === 'run-result')).map(segment => segment.text).join('');
        const title = await Promise.race([
          this.generator.generateSessionTitle(model, user, reply, controller.signal),
          new Promise<never>((_, reject) => {
            if (controller.signal.aborted) reject(new Error('Session naming aborted'));
            else controller.signal.addEventListener('abort', () => reject(new Error('Session naming aborted')), { once: true });
          }),
        ]);
        if (this.closed) return;
        if (operationKey) this.store.sessionManagement.finishExplicitAuto(this.workId, run.sessionId, run.runId, revision, operationKey, title);
        else this.store.sessionManagement.completeAutomatic(this.workId, run.sessionId, run.runId, revision, title);
      } catch {
        if (this.closed) return;
        if (operationKey) this.store.sessionManagement.finishExplicitAuto(this.workId, run.sessionId, run.runId, revision, operationKey);
        else this.store.sessionManagement.failAutomatic(this.workId, run.sessionId, run.runId, revision);
      }
    }).finally(() => {
      clearTimeout(timer);
      this.controllers.delete(controller);
      this.jobs.delete(job);
    });
    this.jobs.add(job);
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    if (this.store.schemaVersion >= 8) this.store.sessionManagement.markInterruptedAutomaticUnknown(this.workId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([Promise.allSettled([...this.jobs]), new Promise<void>(resolve => { timer = setTimeout(resolve, 1_000); })]); }
    finally { if (timer) clearTimeout(timer); }
  }
}
