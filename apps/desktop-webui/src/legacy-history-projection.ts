import type { Message } from './models.js';
import { historyMessages, mergeLegacyMessages, upsertTool } from './chat-projection.js';

type Data = Record<string, any>;
type Source = Message & { origin?: string | null };
interface RunSources {
  messages: Source[];
  boundary: string | null | undefined;
  sequence: number;
  observing: boolean;
  terminal: boolean;
  covered: boolean;
}
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

/** Session-local raw live sources are separate from their displayed tails,
 * so a later delta never appends to a clipped copy. */
export class LegacyHistoryProjection {
  private runs = new Map<string, RunSources>();
  private raw: Data[] = [];
  private finals = new Map<string, Message>();
  private latestFinal?: Message;

  private run(runId: string): RunSources {
    let value = this.runs.get(runId);
    if (!value) { value = { messages: [], boundary: undefined, sequence: 0, observing: false, terminal: false, covered: false }; this.runs.set(runId, value); }
    return value;
  }
  acceptInput(message: Message) {
    if (!message.runId) return;
    const run = this.run(message.runId), at = run.messages.findIndex(item => item.id === message.id);
    if (at >= 0) run.messages[at] = { ...message }; else run.messages.push({ ...message });
  }
  begin(runId: string, after: number) {
    const run = this.run(runId); run.observing = true;
    if (after === 0) run.boundary = null;
  }
  end(runId: string, terminal = false) {
    const run = this.runs.get(runId); if (!run) return;
    run.observing = false; run.terminal ||= terminal;
    if (run.terminal && run.covered) this.runs.delete(runId);
  }
  stop() { for (const id of this.runs.keys()) this.end(id); }
  text(runId: string, sequence: number, delta: string) {
    const run = this.run(runId);
    if (sequence <= run.sequence) return;
    run.sequence = sequence; run.covered = false;
    let message = run.messages.at(-1);
    if (!message || message.role !== 'assistant' || message.tool || message.origin !== run.boundary) {
      message = { id: `${runId}-text-${sequence}`, runId, role: 'assistant', text: '', ...(run.boundary !== undefined ? { origin: run.boundary } : {}) };
      run.messages.push(message);
    }
    message.text += delta;
  }
  tool(runId: string, sequence: number, message: Message, phase: string) {
    const run = this.run(runId);
    // Parallel results may finish out of call order. Starts define boundaries.
    if (phase === 'tool-start' && message.tool?.id) run.boundary = message.tool.id;
    else if (message.tool?.id && !run.messages.some(item => item.tool?.id === message.tool?.id)) run.boundary = undefined;
    if (sequence <= run.sequence) return;
    run.sequence = sequence; run.covered = false;
    upsertTool(run.messages, { ...message });
  }
  project(previous: Message[]): Message[] { return this.merge(this.raw, previous); }
  result(message: Message) {
    if (message.runId) { this.finals.set(message.runId, message); this.latestFinal = message; }
  }

  merge(raw: Data[], previous: Message[], final?: Message, terminalRuns: readonly string[] = []): Message[] {
    this.raw = raw;
    if (final) this.result(final);
    for (const id of terminalRuns) { const run = this.runs.get(id); if (run) run.terminal = true; }
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
    const knownSources = new Set([...this.runs.values()].flatMap(run => run.messages.map(identity)));
    const coveredFinals = new Set<string>();
    for (const [runId, result] of this.finals) {
      // Explicit terminal result refers to the last SDK answer, not any equal
      // prose elsewhere in a Run or before a tool call.
      const last = normalized.findLast(message => message.runId === runId);
      if (last?.role !== 'assistant' || !last.blocks?.length || last.blocks.some((block: Data) => block.type !== 'text')) continue;
      if (last.blocks.map((block: Data) => block.text).join('') === result.text) coveredFinals.add(identity(result));
    }
    const retained = previous.filter(message => !(message.historyLegacyProjection && message.runId && this.runs.has(message.runId)) && !knownSources.has(identity(message)) && !coveredFinals.has(identity(message)));
    const live: Message[] = [];
    for (const [runId, run] of this.runs) {
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
      if (run.terminal && !run.observing && covered) this.runs.delete(runId);
    }
    const finalSource = this.latestFinal?.runId ? this.runs.get(this.latestFinal.runId)?.messages.at(-1) : undefined;
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
