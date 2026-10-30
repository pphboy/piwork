import type { Message } from './models.js';
import { historyMessages, mergeLegacyMessages, upsertTool } from './chat-projection.js';
import { LiveMessageSources } from './live-message-sources.js';

type Data = Record<string, any>;
interface Group { messages: Message[]; closed: boolean }
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const identity = (message: Message) => JSON.stringify([message.runId, message.id]);
const groupKey = (runId: string, boundary: string | null) => JSON.stringify([runId, boundary]);
const prefixMatches = (a: Uint8Array, b: Uint8Array) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return false;
  return true;
};

/** Only a unique, explicitly Run-bound input takes the accepted turn ID. */
function normalizeInputs(raw: Data[]): Data[] {
  const counts = new Map<string, number>();
  for (const message of raw) if (message.role === 'user' && message.runId) counts.set(message.runId, (counts.get(message.runId) ?? 0) + 1);
  return raw.map(message => {
    if (message.role !== 'user' || !message.runId || counts.get(message.runId) !== 1) return message;
    const id = `${message.runId}-user`, blocks: Data[] = message.blocks ?? [];
    const text = blocks.some(block => block.type === 'text') ? blocks.filter(block => block.type === 'text').map(block => block.text).join('') : message.text ?? '';
    return { ...message, entryId: id, text, blocks: [{ type: 'text', blockId: id, text }, ...blocks.filter(block => block.type === 'image')] };
  });
}

export class LegacyHistoryProjection {
  private raw: Data[] = [];
  private finals = new Map<string, Message>();
  private latestFinal?: Message;
  constructor(private readonly sources = new LiveMessageSources()) {}
  acceptInput(message: Message) { this.sources.acceptInput(message); }
  begin(runId: string, after: number) { this.sources.begin(runId, after); }
  end(runId: string, terminal = false) { this.sources.end(runId, terminal); }
  stop() { this.sources.stop(); }
  text(runId: string, sequence: number, delta: string) { this.sources.text(runId, sequence, delta); }
  tool(runId: string, sequence: number, message: Message, phase: string) { this.sources.tool(runId, sequence, message, phase); }
  project(previous: Message[]): Message[] { return this.merge(this.raw, previous); }
  result(message: Message) {
    if (message.runId) { this.finals.set(message.runId, message); this.latestFinal = message; }
  }

  merge(raw: Data[], previous: Message[], final?: Message, terminalRuns: readonly string[] = []): Message[] {
    this.raw = raw;
    if (final) this.result(final);
    for (const id of terminalRuns) this.sources.end(id, true);
    const normalized = normalizeInputs(raw), saved = historyMessages(normalized);
    const groups = new Map<string, Group>(), boundaries = new Map<string, string | null>();
    for (const message of saved) {
      if (!message.runId || message.role !== 'assistant') continue;
      const boundary = boundaries.get(message.runId) ?? null, key = groupKey(message.runId, boundary);
      if (message.tool?.id) {
        const group = groups.get(key); if (group) group.closed = true;
        boundaries.set(message.runId, message.tool.id);
      } else {
        let group = groups.get(key); if (!group) { group = { messages: [], closed: false }; groups.set(key, group); }
        group.messages.push(message);
      }
    }
    const knownSources = new Set([...this.sources.entries()].flatMap(([, run]) => run.messages.map(identity)));
    const coveredFinals = new Set<string>();
    for (const [runId, result] of this.finals) {
      // Explicit terminal result refers to the last SDK answer, not any equal
      // prose elsewhere in a Run or before a tool call.
      const last = normalized.findLast(message => message.runId === runId);
      if (last?.role !== 'assistant' || !last.blocks?.length || last.blocks.some((block: Data) => block.type !== 'text')) continue;
      if (last.blocks.map((block: Data) => block.text).join('') === result.text) coveredFinals.add(identity(result));
    }
    const retained = previous.filter(message => !(message.historyLegacyProjection && message.runId && this.sources.run(message.runId)) && !knownSources.has(identity(message)) && !coveredFinals.has(identity(message)));
    const live: Message[] = [];
    for (const [runId, run] of this.sources.entries()) {
      let covered = true;
      for (const source of run.messages) {
        const mark = (message: Message): Message => ({ ...message, historyLegacyProjection: true });
        if (source.role === 'user') {
          const target = saved.find(message => identity(message) === identity(source));
          if (!target || target.text !== source.text) covered = false;
          live.push(mark(source)); continue;
        }
        if (source.tool) {
          const tool = source.tool;
          const complete = ['Completed', 'Failed'].includes(tool.status);
          if (!tool.id || !saved.some(message => message.runId === runId && message.tool?.id === tool.id && (!complete || ['Completed', 'Failed'].includes(message.tool?.status ?? '')))) covered = false;
          live.push(mark(source)); continue;
        }
        const group = source.origin === undefined ? undefined : groups.get(groupKey(runId, source.origin));
        if (group?.messages.some(message => message.text.length)) {
          const stored = encoder.encode(group.messages.map(message => message.text).join('')), streamed = encoder.encode(source.text);
          if (prefixMatches(stored, streamed)) {
            if (stored.length >= streamed.length) { live.push(...group.messages); continue; }
            // A closed SDK interval cannot be shorter than its live interval.
            if (!group.closed) {
              live.push(...group.messages, mark({ ...source, id: `${source.id}-remaining-${stored.length}`, text: decoder.decode(streamed.subarray(stored.length)), historyRecoveryUnconfirmed: true }));
              covered = false; continue;
            }
          }
        }
        covered = false; live.push(mark(source));
      }
      run.covered = covered;
      if (run.terminal && !run.observing && covered) this.sources.forget(runId);
    }
    const finalSource = this.latestFinal?.runId ? this.sources.run(this.latestFinal.runId)?.messages.at(-1) : undefined;
    const liveCoversResult = finalSource?.role === 'assistant' && !finalSource.tool && finalSource.origin !== undefined && finalSource.text === this.latestFinal?.text;
    const fallback = this.latestFinal && !coveredFinals.has(identity(this.latestFinal)) && !liveCoversResult ? this.latestFinal : undefined;
    const result = mergeLegacyMessages(normalized, [...retained, ...live], fallback);
    // Carry accepted submission and image state onto its canonical saved turn.
    for (const source of live) if (source.role === 'user') {
      const target = result.find(message => identity(message) === identity(source));
      if (target) { if (source.submission) target.submission = source.submission; if (!target.images && source.images) target.images = source.images; }
    }
    for (const [runId, value] of this.finals) if (coveredFinals.has(identity(value))) {
      this.finals.delete(runId); if (this.latestFinal === value) this.latestFinal = undefined;
    }
    return result;
  }
}
