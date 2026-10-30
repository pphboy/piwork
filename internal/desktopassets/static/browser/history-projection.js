import { t } from './locale.js';
import { historyMessages } from './chat-projection.js';
import { LiveMessageSources, verifyLiveCoverage } from './live-message-sources.js';
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const invalid = () => { throw new Error(t('d.history.invalidRange')); };
/** The cache contains only content explicitly read by this page. Range overlap
 * is validated by bytes, never inferred from equal messages or tool names. */
export class HistoryProjection {
    sources;
    entries = new Map();
    snapshotOrders = new Map();
    orderEdges = new Map();
    suppressed = new Set();
    resultTargets = new Map();
    visibleResults = new Map();
    /** A Run range is confirmed only after one frozen snapshot was read to its start. */
    confirmedRuns = new Map();
    constructor(sources = new LiveMessageSources()) {
        this.sources = sources;
    }
    confirmRunRange(snapshotId, runId) {
        if (!snapshotId || !runId)
            return;
        const order = this.snapshotOrders.get(snapshotId);
        if (!order || ![...order.keys()].some(id => this.entries.get(id)?.runId === runId))
            return;
        let runs = this.confirmedRuns.get(snapshotId);
        if (!runs) {
            runs = new Set();
            this.confirmedRuns.set(snapshotId, runs);
        }
        runs.add(runId);
    }
    suppress(runId) { this.suppressed.add(runId); }
    reveal(runId) { this.suppressed.delete(runId); }
    clear() { this.entries.clear(); this.snapshotOrders.clear(); this.orderEdges.clear(); this.suppressed.clear(); this.resultTargets.clear(); this.visibleResults.clear(); this.confirmedRuns.clear(); }
    orderingAnchor(runId) {
        return [...this.entries.values()].findLast(entry => entry.runId && entry.runId !== runId)?.runId;
    }
    covers(part) {
        const block = this.entries.get(part.entryId)?.blocks.get(part.blockId);
        if (!block)
            return false;
        const start = part.byteOffset, end = start + encoder.encode(part.text).length;
        if (start === end)
            return block.value.totalBytes === part.totalBytes;
        let cursor = start;
        for (const range of [...block.ranges].sort((a, b) => a.offset - b.offset)) {
            if (range.offset > cursor)
                break;
            if (range.offset + range.bytes.length > cursor)
                cursor = range.offset + range.bytes.length;
            if (cursor >= end)
                return true;
        }
        return false;
    }
    merge(page) {
        if (page.contractVersion !== 1 || !Array.isArray(page.segments) || !Array.isArray(page.runs))
            invalid();
        for (const run of page.runs) {
            const ref = run.resultRef;
            if (!ref?.entryId)
                continue;
            if (ref.runId !== run.runId || ref.workId !== page.session?.workId || ref.sessionId !== page.session?.sessionId)
                invalid();
            // A replayed old snapshot may still name the durable fallback. It must
            // not undo an explicit SDK target learned from a newer snapshot.
            if (ref.entryId !== `${run.runId}-final` || !this.resultTargets.has(run.runId))
                this.resultTargets.set(run.runId, ref.entryId);
        }
        for (const part of page.segments) {
            const raw = encoder.encode(part.text);
            if (!part.entryId || !part.blockId || !Number.isSafeInteger(part.entryOrder) || part.entryOrder < 0 || !Number.isSafeInteger(part.byteOffset) || !Number.isSafeInteger(part.totalBytes) || part.byteOffset < 0 || part.totalBytes < part.byteOffset + raw.length || raw.length > 32768 || part.complete !== (part.byteOffset + raw.length === part.totalBytes) || !Number.isSafeInteger(part.blockIndex) || part.blockIndex < 0 || part.blockIndex >= part.blockCount)
                invalid();
            if ((part.streamId === undefined) !== (part.streamOffset === undefined) || part.streamId !== undefined && (part.type !== 'text' || typeof part.streamId !== 'string' || !part.streamId || !Number.isSafeInteger(part.streamOffset) || part.streamOffset < 0 || !Number.isSafeInteger(part.streamOffset + part.totalBytes)))
                invalid();
            let entry = this.entries.get(part.entryId);
            if (!entry) {
                entry = { id: part.entryId, order: part.entryOrder, role: part.role, runId: part.runId, count: part.blockCount, blocks: new Map() };
                this.entries.set(entry.id, entry);
            }
            if (entry.role !== part.role || entry.runId !== part.runId)
                invalid();
            entry.order = part.entryOrder;
            entry.count = part.blockCount;
            if (part.type !== 'empty')
                for (const [id, b] of entry.blocks)
                    if (b.value.type === 'empty')
                        entry.blocks.delete(id);
            let block = entry.blocks.get(part.blockId);
            if (!block) {
                block = { value: { ...part, text: undefined }, ranges: [] };
                entry.blocks.set(part.blockId, block);
            }
            if (block.value.totalBytes !== part.totalBytes || block.value.type !== part.type)
                invalid();
            block.value = { ...part, text: undefined };
            let covered = false;
            for (const old of block.ranges) {
                const begin = Math.max(old.offset, part.byteOffset), end = Math.min(old.offset + old.bytes.length, part.byteOffset + raw.length);
                for (let at = begin; at < end; at++)
                    if (old.bytes[at - old.offset] !== raw[at - part.byteOffset])
                        invalid();
                if (old.offset <= part.byteOffset && old.offset + old.bytes.length >= part.byteOffset + raw.length)
                    covered = true;
            }
            if (!covered) {
                block.ranges = block.ranges.filter(old => !(part.byteOffset <= old.offset && part.byteOffset + raw.length >= old.offset + old.bytes.length));
                block.ranges.push({ offset: part.byteOffset, bytes: raw });
            }
            if (typeof page.snapshotId === 'string' && page.snapshotId) {
                let order = this.snapshotOrders.get(page.snapshotId);
                if (!order) {
                    order = new Map();
                    this.snapshotOrders.set(page.snapshotId, order);
                }
                const existing = order.get(part.entryId);
                if (existing !== undefined && existing !== part.entryOrder)
                    invalid();
                order.set(part.entryId, part.entryOrder);
            }
        }
        while (this.snapshotOrders.size > 16) {
            const [id, order] = this.snapshotOrders.entries().next().value;
            // Evict the snapshot coordinates, not the verified relationships between
            // content we still display. Otherwise ordinary long chats lose ordering.
            const ids = [...order].sort((a, b) => a[1] - b[1]).map(([id]) => id);
            for (let i = 1; i < ids.length; i++) {
                let links = this.orderEdges.get(ids[i - 1]);
                if (!links)
                    this.orderEdges.set(ids[i - 1], links = new Set());
                links.add(ids[i]);
            }
            this.snapshotOrders.delete(id);
            this.confirmedRuns.delete(id);
        }
    }
    orderedEntries() {
        // entryOrder is a coordinate inside one frozen snapshot, never a global
        // sequence. Combine the ordering facts of each snapshot by entry identity.
        const values = [...this.entries.values()], rank = new Map(values.map((entry, index) => [entry.id, index]));
        const edges = new Map(values.map(entry => [entry.id, new Set()])), indegree = new Map(values.map(entry => [entry.id, 0]));
        const connect = (from, to) => { const links = edges.get(from); if (links && rank.has(to) && from !== to && !links.has(to)) {
            links.add(to);
            indegree.set(to, indegree.get(to) + 1);
        } };
        for (const [from, links] of this.orderEdges)
            for (const to of links)
                connect(from, to);
        for (const order of this.snapshotOrders.values()) {
            const ids = [...order].filter(([id]) => rank.has(id)).sort((a, b) => a[1] - b[1]).map(([id]) => id);
            for (let i = 1; i < ids.length; i++)
                connect(ids[i - 1], ids[i]);
        }
        const pending = new Set(values.map(entry => entry.id)), result = [], uncertain = new Set(), ready = [];
        const push = (id) => { ready.push(id); let i = ready.length - 1; while (i > 0) {
            const p = Math.floor((i - 1) / 2);
            if (rank.get(ready[p]) <= rank.get(id))
                break;
            ready[i] = ready[p];
            i = p;
        } ready[i] = id; };
        const pop = () => { const first = ready[0], last = ready.pop(); if (ready.length) {
            let i = 0;
            while (i * 2 + 1 < ready.length) {
                let child = i * 2 + 1;
                if (child + 1 < ready.length && rank.get(ready[child + 1]) < rank.get(ready[child]))
                    child++;
                if (rank.get(last) <= rank.get(ready[child]))
                    break;
                ready[i] = ready[child];
                i = child;
            }
            ready[i] = last;
        } return first; };
        for (const entry of values)
            if (indegree.get(entry.id) === 0)
                push(entry.id);
        while (pending.size) {
            if (ready.length > 1) {
                uncertain.add(ready[0]);
                uncertain.add(ready[1]);
            }
            if (!ready.length) {
                for (const id of pending)
                    uncertain.add(id);
                push(pending.values().next().value);
            }
            const id = pop();
            pending.delete(id);
            result.push(this.entries.get(id));
            for (const to of edges.get(id)) {
                const next = indegree.get(to) - 1;
                indegree.set(to, next);
                if (next === 0 && pending.has(to))
                    push(to);
            }
        }
        return { result, uncertain };
    }
    /** Groups public text of one Run in the confirmed frozen range. The first
     * block must begin the interval at byte zero; a missing or hidden predecessor
     * is a gap, never a suffix that could pass a prefix comparison. */
    savedGroups(saved, snapshotId, runId) {
        const order = this.snapshotOrders.get(snapshotId);
        if (!order)
            return [];
        const toolCalls = new Map();
        const blocks = new Map();
        for (const entryId of order.keys()) {
            const entry = this.entries.get(entryId);
            if (!entry || entry.runId !== runId)
                continue;
            const indexes = new Set();
            for (const block of entry.blocks.values())
                if (Number.isSafeInteger(block.value.blockIndex))
                    indexes.add(block.value.blockIndex);
            for (const block of entry.blocks.values()) {
                const part = block.value;
                if (part.type === 'tool-call' && part.toolCallId) {
                    toolCalls.set(part.toolCallId, { entryId, blockIndex: part.blockIndex });
                    continue;
                }
                if (part.type !== 'text')
                    continue;
                const ranges = [...block.ranges].sort((a, b) => a.offset - b.offset), value = this.text(block);
                blocks.set(part.blockId, { entryId, blockIndex: part.blockIndex, start: ranges[0]?.offset, complete: value.complete, indexes });
            }
        }
        const groups = [];
        let boundary = null, current, append = true;
        let lastTool;
        const lastBlock = new Map();
        for (const [index, message] of saved.entries()) {
            if (message.runId !== runId || message.role === 'user')
                continue;
            if (message.tool) {
                const call = message.tool.id ? toolCalls.get(message.tool.id) : undefined;
                if (call) {
                    if (current)
                        current.open = false;
                    boundary = message.tool.id;
                    current = undefined;
                    append = true;
                    lastTool = call;
                    lastBlock.clear();
                }
                continue;
            }
            if (!message.id)
                continue;
            const meta = blocks.get(message.id);
            if (!meta)
                continue;
            if (!current) {
                current = { boundary, text: '', startConfirmed: false, open: true, messageIndexes: [] };
                groups.push(current);
                append = true;
                const beginsEntry = meta.blockIndex === 0;
                const afterSameEntryTool = !!lastTool && lastTool.entryId === meta.entryId && meta.blockIndex > lastTool.blockIndex;
                const startsInterval = boundary === null ? beginsEntry : beginsEntry || afterSameEntryTool;
                if (startsInterval && meta.start === 0)
                    current.startConfirmed = true;
                else
                    append = false;
            }
            if (!append)
                continue;
            const previous = lastBlock.get(meta.entryId);
            if (previous !== undefined) {
                for (let at = previous + 1; at < meta.blockIndex; at++)
                    if (!meta.indexes.has(at)) {
                        current.open = true;
                        append = false;
                        break;
                    }
                if (!append)
                    continue;
            }
            current.text += message.text;
            current.messageIndexes.push(index);
            lastBlock.set(meta.entryId, meta.blockIndex);
            if (!meta.complete) {
                current.open = true;
                append = false;
            }
        }
        return groups.filter(group => group.messageIndexes.length > 0);
    }
    text(block) {
        const ranges = [...block.ranges].sort((a, b) => a.offset - b.offset);
        if (!ranges.length)
            return { text: '', complete: block.value.totalBytes === 0 };
        const start = ranges[0].offset;
        let end = start;
        const pieces = [];
        for (const range of ranges) {
            if (range.offset > end)
                break;
            const skip = Math.max(0, end - range.offset);
            if (skip < range.bytes.length) {
                pieces.push(range.bytes.subarray(skip));
                end = range.offset + range.bytes.length;
            }
        }
        const bytes = new Uint8Array(end - start);
        let at = 0;
        for (const part of pieces) {
            bytes.set(part, at);
            at += part.length;
        }
        return { text: decoder.decode(bytes), complete: start === 0 && end === block.value.totalBytes };
    }
    project(previous, replaceRuns = new Set()) {
        const raw = [], incomplete = new Set();
        const hiddenResultText = new Set();
        const complete = (entry) => entry.blocks.size === entry.count && [...entry.blocks.values()].every(block => this.text(block).complete);
        for (const [runId, targetId] of this.resultTargets) {
            const target = this.entries.get(targetId), fallback = this.entries.get(`${runId}-final`);
            if (!target || target.runId !== runId)
                continue;
            if (!fallback || fallback === target || fallback.runId !== runId || ![...fallback.blocks.values()].some(block => block.value.type === 'run-result')) {
                this.visibleResults.set(runId, target.id);
                continue;
            }
            const visible = complete(target) ? target.id : complete(fallback) ? fallback.id : this.visibleResults.get(runId) ?? fallback.id;
            this.visibleResults.set(runId, visible);
            hiddenResultText.add(visible === target.id ? fallback.id : target.id);
        }
        const ordered = this.orderedEntries(), uncertainBlocks = new Set(), recoveryUnconfirmed = new Set();
        for (const entry of ordered.result) {
            if (this.suppressed.has(entry.runId) && entry.role !== 'user')
                continue;
            const blocks = [];
            let complete = entry.blocks.size === entry.count;
            for (const block of [...entry.blocks.values()].sort((a, b) => a.value.blockIndex - b.value.blockIndex)) {
                const part = block.value, value = this.text(block);
                complete = complete && value.complete;
                if (part.recoveryUnconfirmed) {
                    recoveryUnconfirmed.add(entry.id);
                    recoveryUnconfirmed.add(part.blockId);
                    if (part.toolCallId && entry.runId)
                        recoveryUnconfirmed.add(`${entry.runId}-tool-${part.toolCallId}`);
                }
                if (hiddenResultText.has(entry.id) && (part.type === 'text' || part.type === 'run-result'))
                    continue;
                if (part.type === 'text' || part.type === 'run-result')
                    blocks.push({ blockId: part.blockId, type: 'text', text: value.text });
                else if (part.type === 'image')
                    blocks.push({ blockId: part.blockId, type: 'image', image: part.image });
                else if (part.type === 'tool-call')
                    blocks.push({ blockId: part.blockId, type: part.type, toolCallId: part.toolCallId, toolName: part.toolName });
                else if (part.type === 'tool-result')
                    blocks.push({ blockId: part.blockId, type: part.type, toolCallId: part.toolCallId, toolName: part.toolName, result: { kind: part.resultKind, ...(part.resultKind === 'text' ? { text: value.text } : {}), truncated: part.truncated, isError: part.isError } });
            }
            if (hiddenResultText.has(entry.id) && !blocks.length)
                continue;
            if (!complete) {
                incomplete.add(entry.id);
                for (const block of blocks) {
                    incomplete.add(block.blockId);
                    if (block.toolCallId && entry.runId)
                        incomplete.add(`${entry.runId}-tool-${block.toolCallId}`);
                }
            }
            if (ordered.uncertain.has(entry.id)) {
                uncertainBlocks.add(entry.id);
                for (const block of blocks) {
                    uncertainBlocks.add(block.blockId);
                    if (block.toolCallId && entry.runId)
                        uncertainBlocks.add(`${entry.runId}-tool-${block.toolCallId}`);
                }
            }
            raw.push({ entryId: entry.id, runId: entry.runId, role: entry.role, blocks, text: '' });
        }
        // A user turn keeps its accepted identity when text blocks become durable,
        // just as an image turn does. Several SDK text blocks are one user turn.
        const userIds = new Map();
        for (const entry of raw)
            if (entry.role === 'user')
                for (const block of entry.blocks)
                    userIds.set(block.blockId, entry.entryId);
        const saved = [], users = new Map();
        for (const message of historyMessages(raw)) {
            const id = message.role === 'user' ? userIds.get(message.id ?? '') ?? message.id : message.id;
            const value = { ...message, id, historyStored: true, historyIncomplete: incomplete.has(id ?? '') || incomplete.has(message.id ?? ''), historyOrderUnconfirmed: uncertainBlocks.has(id ?? '') || uncertainBlocks.has(message.id ?? '') || !!message.tool && recoveryUnconfirmed.has(id ?? ''), historyRecoveryUnconfirmed: recoveryUnconfirmed.has(id ?? '') || recoveryUnconfirmed.has(message.id ?? '') };
            const previous = message.role === 'user' && id ? users.get(id) : undefined;
            if (previous) {
                previous.text += value.text;
                previous.historyIncomplete ||= value.historyIncomplete;
            }
            else {
                saved.push(value);
                if (message.role === 'user' && id)
                    users.set(id, value);
            }
        }
        // A recovered `-remaining-N` block is emitted only after the Agent has
        // verified N bytes against the SDK prefix for this exact Run. When the
        // complete final result matches that prefix plus the checkpoint tail,
        // the independent result entry is the same output, not another answer.
        const redundantResults = new Set(), compositeCoverage = new Map();
        for (let index = 0; index < saved.length; index++) {
            const tail = saved[index];
            if (!tail?.runId || !tail.id || tail.historyRecoveryUnconfirmed || tail.tool)
                continue;
            const prefix = `${tail.runId}-text-`;
            if (!tail.id.startsWith(prefix))
                continue;
            const match = /^\d+-remaining-(\d+)$/.exec(tail.id.slice(prefix.length));
            if (!match)
                continue;
            const prefixBytes = Number(match[1]);
            if (!Number.isSafeInteger(prefixBytes) || prefixBytes <= 0)
                continue;
            const fallback = this.entries.get(`${tail.runId}-final`);
            const resultBlock = fallback && [...fallback.blocks.values()].find(block => block.value.type === 'run-result');
            const result = resultBlock && saved.find(message => message.id === resultBlock.value.blockId && message.runId === tail.runId && !message.historyIncomplete);
            const parts = [], prefixIds = [];
            let count = 0;
            for (let at = index - 1; at >= 0 && count < prefixBytes; at--) {
                const previous = saved[at];
                if (previous.runId !== tail.runId || previous.role !== 'assistant' || previous.tool || previous.historyIncomplete || previous.historyRecoveryUnconfirmed)
                    break;
                parts.unshift(previous.text);
                if (previous.id)
                    prefixIds.push(previous.id);
                count += encoder.encode(previous.text).length;
            }
            if (count !== prefixBytes)
                continue;
            if (!tail.historyIncomplete) {
                const combined = parts.join('') + tail.text;
                compositeCoverage.set(tail.id.slice(0, tail.id.lastIndexOf('-remaining-')), combined);
                if (result && combined === result.text)
                    redundantResults.add(result.id);
            }
            else if (result) {
                const entry = [...this.entries.values()].find(entry => entry.runId === tail.runId && entry.blocks.has(tail.id));
                const block = entry?.blocks.get(tail.id), whole = encoder.encode(result.text), prefixData = encoder.encode(parts.join(''));
                if (!block || whole.length !== prefixBytes + block.value.totalBytes || prefixData.some((byte, i) => whole[i] !== byte))
                    continue;
                if (block.ranges.some(range => range.bytes.some((byte, i) => whole[prefixBytes + range.offset + i] !== byte)))
                    continue;
                redundantResults.add(tail.id);
                for (const id of prefixIds)
                    redundantResults.add(id);
                compositeCoverage.set(tail.id.slice(0, tail.id.lastIndexOf('-remaining-')), result.text);
            }
        }
        if (redundantResults.size)
            for (let index = saved.length - 1; index >= 0; index--)
                if (redundantResults.has(saved[index].id))
                    saved.splice(index, 1);
        const identity = (message) => JSON.stringify([message.runId ?? '', message.id ?? '']);
        const ids = new Set(saved.map(identity)), tools = new Set(saved.filter(m => m.tool && m.runId).map(m => `${m.runId}:${m.tool.id}`));
        const coveredLive = new Set(), unresolvedIdentity = new Set();
        // SDK blocks can use different IDs from streamed events. The Agent only
        // emits these coordinates after checking their bytes and tool boundaries
        // against the durable event stream. Require complete byte coverage here:
        // a partially loaded history must never erase a longer live response.
        const streamRanges = new Map(), streamAnchors = new Map();
        for (const entry of this.entries.values())
            for (const block of entry.blocks.values()) {
                const part = block.value;
                if (!entry.runId || !part.streamId || part.recoveryUnconfirmed)
                    continue;
                const key = JSON.stringify([entry.runId, part.streamId]), ranges = streamRanges.get(key) ?? [];
                for (const range of block.ranges)
                    ranges.push({ offset: part.streamOffset + range.offset, bytes: range.bytes });
                streamRanges.set(key, ranges);
                if (!streamAnchors.has(key))
                    streamAnchors.set(key, part.blockId);
            }
        previous.forEach((message, index) => {
            if (message.historyStored || message.role !== 'assistant' || message.tool || !message.id || !message.runId || !message.text)
                return;
            const ranges = streamRanges.get(JSON.stringify([message.runId, message.id]));
            if (!ranges)
                return;
            const live = encoder.encode(message.text);
            let end = 0;
            for (const range of [...ranges].sort((a, b) => a.offset - b.offset)) {
                if (range.offset > end)
                    break;
                const limit = Math.min(live.length, range.offset + range.bytes.length);
                for (let at = range.offset; at < limit; at++)
                    if (range.bytes[at - range.offset] !== live[at])
                        return;
                end = Math.max(end, limit);
            }
            if (end === live.length)
                coveredLive.add(index);
        });
        previous.forEach((message, index) => {
            if (message.historyStored || message.role !== 'assistant' || message.tool || !message.id)
                return;
            const complete = compositeCoverage.get(message.id);
            if (complete !== undefined && complete.startsWith(message.text))
                coveredLive.add(index);
        });
        // A checkpoint block can have the same event identity as the live stream
        // while only part of its byte range has been read. Merge verified ranges;
        // identity alone is not proof that the saved text covers the live text.
        previous.forEach((message, index) => {
            if (message.historyStored || message.role !== 'assistant' || message.tool || !message.id || !message.runId || !ids.has(identity(message)))
                return;
            const target = saved.find(item => item.id === message.id && item.runId === message.runId && !item.tool);
            const entry = [...this.entries.values()].find(item => item.runId === message.runId && item.blocks.has(message.id));
            const block = entry?.blocks.get(message.id);
            if (!target || !block || block.value.type !== 'text')
                return;
            const live = encoder.encode(message.text), ranges = [{ offset: 0, bytes: live }, ...block.ranges].sort((a, b) => a.offset - b.offset);
            let end = 0;
            const pieces = [];
            for (const range of ranges) {
                if (range.offset > end) {
                    unresolvedIdentity.add(index);
                    return;
                }
                const overlap = Math.min(end - range.offset, range.bytes.length);
                for (let at = 0; at < overlap; at++) {
                    const pos = range.offset + at;
                    if (pos < live.length && range.bytes[at] !== live[pos]) {
                        unresolvedIdentity.add(index);
                        return;
                    }
                }
                const skip = Math.max(0, end - range.offset);
                if (skip < range.bytes.length) {
                    pieces.push(range.bytes.subarray(skip));
                    end = range.offset + range.bytes.length;
                }
            }
            const bytes = new Uint8Array(end);
            let at = 0;
            for (const piece of pieces) {
                bytes.set(piece, at);
                at += piece.length;
            }
            try {
                target.text = decoder.decode(bytes);
            }
            catch {
                unresolvedIdentity.add(index);
                return;
            }
            const liveUnconfirmed = !!target.historyIncomplete || end > block.value.totalBytes;
            target.historyRecoveryUnconfirmed = !!target.historyRecoveryUnconfirmed || liveUnconfirmed;
            if (liveUnconfirmed)
                target.historyStored = false;
            coveredLive.add(index);
        });
        // Paged Agents may omit optional stream coordinates. Their Run range is
        // still trustworthy when one frozen snapshot was read to the Run's start
        // and the live side observed the same origin; only then are bytes compared.
        const compatDecisions = new Map();
        const liveSegments = new Map();
        for (const [, run] of this.sources.entries())
            for (const source of run.messages)
                if (source.role === 'assistant' && !source.tool && source.id)
                    liveSegments.set(source.id, source);
        const groupTails = new Map();
        for (const [snapshotId, runIds] of this.confirmedRuns)
            for (const runId of runIds) {
                const run = this.sources.run(runId);
                if (!run || this.suppressed.has(runId))
                    continue;
                const groups = this.savedGroups(saved, snapshotId, runId);
                if (!groups.length)
                    continue;
                for (const [sourceId, decision] of verifyLiveCoverage(run, groups)) {
                    if (compatDecisions.has(sourceId))
                        continue;
                    compatDecisions.set(sourceId, decision);
                    for (const at of decision.messageIndexes)
                        saved[at].historyDisplaySource = sourceId;
                    const first = decision.messageIndexes[0];
                    if (first !== undefined)
                        saved[first].historyDisplayKey = sourceId;
                    if (!decision.covered) {
                        const at = Math.max(...decision.messageIndexes);
                        const bucket = groupTails.get(at) ?? [];
                        bucket.push({ id: `${sourceId}-remaining-${decision.remainingBytes}`, runId, role: 'assistant', text: decision.remaining, historyRecoveryUnconfirmed: true, historyDisplaySource: sourceId });
                        groupTails.set(at, bucket);
                    }
                }
            }
        const seenSources = new Set();
        previous.forEach((message, index) => {
            if (message.historyStored || message.role !== 'assistant' || message.tool || !message.id || !message.runId)
                return;
            const remaining = /^(.*)-remaining-\d+$/.exec(message.id), sourceId = liveSegments.has(message.id) ? message.id : remaining && liveSegments.has(remaining[1]) ? remaining[1] : undefined;
            if (!sourceId || liveSegments.get(sourceId).runId !== message.runId)
                return;
            if (streamRanges.has(JSON.stringify([message.runId, sourceId])) || unresolvedIdentity.has(index))
                return;
            const decision = compatDecisions.get(sourceId);
            if (!decision) {
                const segment = liveSegments.get(sourceId);
                if (message.id === sourceId) {
                    if (message.text !== segment.text)
                        message.text = segment.text;
                }
                else if (!seenSources.has(sourceId)) {
                    seenSources.add(sourceId);
                    message.id = sourceId;
                    message.text = segment.text;
                    message.historyRecoveryUnconfirmed = true;
                }
                return;
            }
            coveredLive.add(index);
            if (decision.covered || seenSources.has(sourceId))
                return;
            seenSources.add(sourceId);
        });
        const savedPositions = new Map(saved.flatMap((message, index) => [
            ...(message.id ? [[`id:${identity(message)}`, index]] : []),
            ...(message.runId && message.tool?.id ? [[`tool:${message.runId}:${message.tool.id}`, index]] : []),
        ]));
        for (const [key, blockId] of streamAnchors) {
            const [runId, streamId] = JSON.parse(key);
            const at = savedPositions.get(`id:${JSON.stringify([runId, blockId])}`), alias = `id:${JSON.stringify([runId, streamId])}`;
            if (at !== undefined && !savedPositions.has(alias))
                savedPositions.set(alias, at);
        }
        const position = (message) => savedPositions.get(message.id ? `id:${identity(message)}` : '') ??
            (message.runId && message.tool?.id ? savedPositions.get(`tool:${message.runId}:${message.tool.id}`) : undefined);
        const following = new Array(previous.length);
        let next;
        for (let i = previous.length - 1; i >= 0; i--) {
            following[i] = next;
            const found = position(previous[i]);
            if (found !== undefined)
                next = found;
        }
        const before = new Map();
        const tail = [];
        let prior;
        previous.forEach((message, index) => {
            const current = position(message);
            if (current !== undefined)
                prior = current;
            if (message.historyStored || ids.has(identity(message)) && !unresolvedIdentity.has(index) || coveredLive.has(index) || (message.runId && message.tool?.id && tools.has(`${message.runId}:${message.tool.id}`)))
                return;
            const target = following[index];
            const lower = prior ?? -1, upper = target ?? saved.length;
            const unconfirmed = !!message.runId && replaceRuns.has(message.runId) && message.role === 'assistant' && !message.tool && !!message.text;
            const placed = upper - lower > 1 || unconfirmed || unresolvedIdentity.has(index) ? { ...message, ...(unresolvedIdentity.has(index) ? { id: `${message.id}-live-unconfirmed` } : {}), ...(upper - lower > 1 ? { historyOrderUnconfirmed: true } : {}), ...(unconfirmed || unresolvedIdentity.has(index) ? { historyRecoveryUnconfirmed: true } : {}) } : message;
            if (target === undefined)
                tail.push(placed);
            else {
                const bucket = before.get(target) ?? [];
                bucket.push(placed);
                before.set(target, bucket);
            }
        });
        return [...saved.flatMap((message, index) => [...(before.get(index) ?? []), message, ...(groupTails.get(index) ?? [])]), ...tail];
    }
}
//# sourceMappingURL=history-projection.js.map