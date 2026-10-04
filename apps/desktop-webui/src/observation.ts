export class ObservationDeferred extends Error {}
export class ObservationStopped extends Error {}
export class ObservationTimeout extends Error {
  code = 'READ_TIMEOUT';
  constructor() { super('The status read timed out. Check the original object again.'); }
}
interface ReadState { failures: number; nextAt: number; paused: boolean; error?: string }

/** Only metadata GETs enter this coordinator. It never owns a mutation or remote cancellation. */
export class MetadataReads {
  states = new Map<string, ReadState>();
  private pending = new Map<string, Promise<unknown>>();
  private controllers = new Set<AbortController>();
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private now = () => Date.now(), private timeoutMs = 10_000) {}
  canRead(key: string) { const state = this.states.get(key); return !state || !state.paused && state.nextAt <= this.now(); }
  paused(key: string) { return this.states.get(key)?.paused === true; }
  rearm() { for (const state of this.states.values()) { state.failures = 0; state.nextAt = 0; state.paused = false; } }
  cancel() { for (const controller of this.controllers) controller.abort(new ObservationStopped('Observation ended.')); }
  clear() { this.cancel(); this.states.clear(); this.pending.clear(); }
  nextDelay(defaultMs = 2000, keys?: string[]) {
    const waits = [...this.states].filter(([key]) => !keys || keys.includes(key)).map(([, state]) => state).filter(state => !state.paused && state.failures).map(state => state.nextAt > this.now() ? state.nextAt - this.now() : defaultMs);
    return Math.min(defaultMs, ...waits);
  }
  read<T>(key: string, load: (signal: AbortSignal) => Promise<T>, explicit = false): Promise<T> {
    const existing = this.pending.get(key); if (existing) return existing as Promise<T>;
    let state = this.states.get(key);
    if (!state) { state = { failures: 0, nextAt: 0, paused: false }; this.states.set(key, state); }
    if (explicit) Object.assign(state, { failures: 0, nextAt: 0, paused: false });
    if (!this.canRead(key)) return Promise.reject(new ObservationDeferred(state.error || 'Status checking is paused.'));
    const owned = state, controller = new AbortController(); this.controllers.add(controller);
    const task = (async () => {
      let acquired = false, timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          const start = () => {
            if (controller.signal.aborted) { reject(controller.signal.reason); this.queue.shift()?.(); return; }
            if (this.active >= 4) { this.queue.push(start); return; }
            this.active++; acquired = true; resolve();
          };
          controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
          start();
        });
        timer = setTimeout(() => controller.abort(new ObservationTimeout()), this.timeoutMs);
        const result = await Promise.race([load(controller.signal), new Promise<never>((_, reject) => {
          if (controller.signal.aborted) reject(controller.signal.reason);
          else controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
        })]);
        if (this.states.get(key) === owned) Object.assign(owned, { failures: 0, nextAt: 0, paused: false, error: undefined });
        return result;
      } catch (error) {
        if (!(error instanceof ObservationStopped) && this.states.get(key) === owned) {
          owned.failures++; owned.error = error instanceof Error ? error.message : String(error);
          const status = (error as { httpStatus?: number }).httpStatus;
          owned.paused = owned.failures >= 4 || [401, 404, 410].includes(status || 0);
          owned.nextAt = this.now() + ([1000, 2000, 5000][owned.failures - 1] || 5000);
        }
        throw error;
      } finally {
        clearTimeout(timer); this.controllers.delete(controller);
        if (acquired) { this.active--; this.queue.shift()?.(); }
      }
    })();
    const pending = task.finally(() => { if (this.pending.get(key) === pending) this.pending.delete(key); });
    this.pending.set(key, pending); return pending;
  }
}
