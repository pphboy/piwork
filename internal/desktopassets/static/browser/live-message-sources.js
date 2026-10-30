const encoder = new TextEncoder();
/** Session-local live originals. Both history adapters read the same records,
 * so a saved prefix, a tool boundary and a replayed fragment are interpreted
 * once instead of through two independent merge rules. */
export class LiveMessageSources {
    runs = new Map();
    run(runId) { return this.runs.get(runId); }
    entries() { return this.runs.entries(); }
    source(runId) {
        let value = this.runs.get(runId);
        if (!value) {
            value = { messages: [], boundary: undefined, sequence: 0, observing: false, terminal: false, covered: false, start: undefined, toolStarts: new Set(), coverage: new Map(), events: new Map() };
            this.runs.set(runId, value);
        }
        return value;
    }
    acceptInput(message) {
        if (!message.runId)
            return;
        const run = this.source(message.runId), at = run.messages.findIndex(item => item.id === message.id);
        if (at >= 0)
            run.messages[at] = { ...message };
        else
            run.messages.push({ ...message });
    }
    /** `after` is the cursor used to subscribe: zero proves the first event is visible. */
    begin(runId, after) {
        const run = this.source(runId);
        run.observing = true;
        if (after === 0)
            run.start = true;
        else if (run.start === undefined)
            run.start = false;
        if (after === 0)
            run.boundary = null;
    }
    end(runId, terminal = false) {
        const run = this.runs.get(runId);
        if (!run)
            return;
        run.observing = false;
        run.terminal ||= terminal;
    }
    stop() { for (const id of this.runs.keys())
        this.end(id); }
    forget(runId) { this.runs.delete(runId); }
    clearFragments(runId) { this.runs.get(runId)?.events.clear(); }
    clear() { this.runs.clear(); }
    pendingFragments(runId) {
        const run = this.runs.get(runId);
        return !!run && [...run.events.values()].some(event => !event.complete);
    }
    /** Copies committed and open text into the live record. Fragments keep their
     * event identity and offsets so a replay can never append bytes twice. */
    text(runId, sequence, delta, fragment) {
        const run = this.source(runId), bytes = encoder.encode(delta).length;
        if (fragment) {
            const { byteOffset: offset, totalBytes: total } = fragment;
            if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(total) || offset < 0 || offset + bytes > total || fragment.complete !== (offset + bytes === total))
                throw new Error('invalid-run-event-fragment');
            let pending = run.events.get(sequence);
            if (!pending) {
                pending = { offset: 0, total, parts: new Map(), complete: false };
                run.events.set(sequence, pending);
            }
            if (pending.total !== total)
                throw new Error('invalid-run-event-fragment');
            if (pending.parts.has(offset)) {
                if (pending.parts.get(offset) !== delta)
                    throw new Error('changed-run-event');
                if (fragment.complete)
                    pending.complete = true;
                return;
            }
            if (offset !== pending.offset || pending.complete)
                throw new Error('incomplete-run-event');
            pending.parts.set(offset, delta);
            pending.offset += bytes;
            if (fragment.complete)
                pending.complete = true;
        }
        else if (sequence <= run.sequence)
            return;
        run.sequence = Math.max(run.sequence, sequence);
        run.covered = false;
        let message = run.messages.at(-1), created = false;
        if (!message || message.role !== 'assistant' || message.tool || message.origin !== run.boundary) {
            message = { id: `${runId}-text-${sequence}`, runId, role: 'assistant', text: '', ...(run.boundary !== undefined ? { origin: run.boundary } : {}) };
            run.messages.push(message);
            created = true;
        }
        message.text += delta;
        return { message, delta, complete: fragment ? fragment.complete === true : true, created };
    }
    tool(runId, sequence, message, phase) {
        const run = this.source(runId);
        // Parallel results may finish out of call order. Starts define boundaries.
        if (phase === 'tool-start' && message.tool?.id) {
            run.boundary = message.tool.id;
            run.toolStarts.add(message.tool.id);
        }
        else if (message.tool?.id && !run.messages.some(item => item.tool?.id === message.tool?.id))
            run.boundary = undefined;
        if (sequence <= run.sequence)
            return;
        run.sequence = sequence;
        run.covered = false;
        if (message.tool?.id) {
            const existing = run.messages.find(item => item.runId === runId && item.tool?.id === message.tool?.id);
            if (!existing)
                run.messages.push({ ...message });
            else if (existing.tool?.status !== 'Completed' && existing.tool?.status !== 'Failed')
                existing.tool = message.tool;
        }
        else
            run.messages.push({ ...message });
    }
}
/** Compare a live interval only when both sides prove the same origin. Equal
 * prose elsewhere, equal-length guesses and a closed shorter range never cover. */
export function verifyLiveCoverage(run, groups) {
    const decisions = new Map(), used = new Set();
    const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
    for (const message of run.messages) {
        if (message.role !== 'assistant' || message.tool || !message.text || message.origin === undefined)
            continue;
        if (message.origin === null && run.start !== true)
            continue;
        if (message.origin !== null && !run.toolStarts.has(message.origin))
            continue;
        const group = groups.find(item => item.boundary === message.origin && item.startConfirmed && !used.has(item) && item.text.length > 0);
        if (!group)
            continue;
        const saved = encoder.encode(group.text), live = encoder.encode(message.text);
        const shared = Math.min(saved.length, live.length);
        let matches = true;
        for (let index = 0; index < shared; index++)
            if (saved[index] !== live[index]) {
                matches = false;
                break;
            }
        if (!matches)
            continue;
        if (saved.length >= live.length) {
            used.add(group);
            run.coverage.set(message.id, live.length);
            decisions.set(message.id, { covered: true, messageIndexes: group.messageIndexes });
            continue;
        }
        if (!group.open)
            continue;
        used.add(group);
        run.coverage.set(message.id, saved.length);
        decisions.set(message.id, { covered: false, remaining: decoder.decode(live.subarray(saved.length)), remainingBytes: saved.length, messageIndexes: group.messageIndexes });
    }
    return decisions;
}
//# sourceMappingURL=live-message-sources.js.map