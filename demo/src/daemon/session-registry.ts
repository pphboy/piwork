/**
 * Tracks live sessions.
 *
 * Deliberately generic: it owns lifecycle and the busy flag but knows nothing
 * about the pi SDK, so the SDK stays confined to pi-backend.
 */
export interface SessionEntry<T> {
  readonly id: string;
  readonly value: T;
  /** True while an ask is in flight; a session answers one question at a time. */
  busy: boolean;
  readonly dispose: () => Promise<void> | void;
}

export class SessionRegistry<T> {
  private readonly entries = new Map<string, SessionEntry<T>>();

  get size(): number {
    return this.entries.size;
  }

  get(id: string): SessionEntry<T> | undefined {
    return this.entries.get(id);
  }

  add(id: string, value: T, dispose: () => Promise<void> | void): SessionEntry<T> {
    if (this.entries.has(id)) {
      throw new Error(`session ${id} is already registered`);
    }
    const entry: SessionEntry<T> = { id, value, busy: false, dispose };
    this.entries.set(id, entry);
    return entry;
  }

  markBusy(id: string, busy: boolean): void {
    const entry = this.entries.get(id);
    if (entry !== undefined) entry.busy = busy;
  }

  async remove(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (entry === undefined) return false;
    this.entries.delete(id);
    await entry.dispose();
    return true;
  }

  async disposeAll(): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) {
      await entry.dispose();
    }
  }
}
