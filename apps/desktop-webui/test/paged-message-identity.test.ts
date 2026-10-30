import test from 'node:test';
import assert from 'node:assert/strict';
const { HistoryProjection } = await import(new URL('../browser/history-projection.js', import.meta.url).href);
const { LiveMessageSources } = await import(new URL('../browser/live-message-sources.js', import.meta.url).href);

const session = { sessionId: 'session-1', workId: 'work-1', modelPreference: null, thinkingLevel: 'off', source: { kind: 'chat' } };
const encoder = new TextEncoder();
const segment = (entryId: string, role: string, text: string, order: number, extra: Record<string, unknown> = {}) => ({
  entryId, entryOrder: order, role, runId: 'run-1', blockId: `${entryId}-0`, blockIndex: 0, blockCount: 1, type: 'text',
  byteOffset: 0, totalBytes: encoder.encode(text).length, text, complete: true, ...extra,
});
const toolCall = (entryId: string, order: number, callId: string) => ({
  entryId, entryOrder: order, role: 'assistant', runId: 'run-1', blockId: `${entryId}-0`, blockIndex: 0, blockCount: 1,
  type: 'tool-call', toolCallId: callId, toolName: 'read', byteOffset: 0, totalBytes: 0, text: '', complete: true,
});
const page = (segments: unknown[], snapshotId = 'snap') => ({ contractVersion: 1, session, snapshotId, segments, runs: [], nextCursor: null, hasMore: false });
const input = (text = 'Question') => ({ id: 'run-1-user', runId: 'run-1', role: 'user' as const, text });
const userSegment = (text = 'Question') => ({ ...segment('run-1-user', 'user', text, 0), runId: 'run-1', blockId: 'run-1-user-0' });

function live(sources: any, text = 'Reply', after = 0) {
  sources.acceptInput(input());
  sources.begin('run-1', after);
  sources.text('run-1', 1, text);
  return [input(), { id: 'run-1-text-1', runId: 'run-1', role: 'assistant' as const, text }];
}

test('paged protocol without source coordinates shows one answer after a confirmed Run range', () => {
  const sources = new LiveMessageSources(), projection = new HistoryProjection(sources);
  const previous = live(sources);
  projection.merge(page([userSegment(), segment('saved-reply', 'assistant', 'Reply', 1)]));
  projection.confirmRunRange('snap', 'run-1');
  const messages = projection.project(previous, new Set(['run-1']));
  assert.deepEqual(messages.map((message: any) => message.text), ['Question', 'Reply']);
  assert.equal(messages[1].historyRecoveryUnconfirmed, false);
  assert.deepEqual(projection.project(messages, new Set(['run-1'])).map((message: any) => message.text), ['Question', 'Reply']);
});

test('without a confirmed frozen Run range saved and live output both remain explicit', () => {
  const sources = new LiveMessageSources(), projection = new HistoryProjection(sources);
  const previous = live(sources);
  projection.merge(page([userSegment(), segment('saved-reply', 'assistant', 'Reply', 1)]));
  const messages = projection.project(previous, new Set(['run-1']));
  assert.deepEqual(messages.map((message: any) => message.text), ['Question', 'Reply', 'Reply']);
  assert.equal(messages[2].historyRecoveryUnconfirmed, true);
});

test('a resumed observation without the Run start never claims the saved prefix', () => {
  const sources = new LiveMessageSources(), projection = new HistoryProjection(sources);
  const previous = live(sources, 'Reply', 40);
  projection.merge(page([userSegment(), segment('saved-reply', 'assistant', 'Reply', 1)]));
  projection.confirmRunRange('snap', 'run-1');
  assert.equal(projection.project(previous, new Set(['run-1'])).length, 3);
});

test('a Run range gap or a conflicting closed range keeps both facts', () => {
  for (const [saved, extra] of [
    [{ ...segment('saved-reply', 'assistant', 'ply', 1), byteOffset: 3, totalBytes: 6 }, {}],
    [segment('saved-reply', 'assistant', 'Rep', 1), { close: true }],
  ] as const) {
    const sources = new LiveMessageSources(), projection = new HistoryProjection(sources);
    const previous = live(sources, 'Reply');
    const segments: unknown[] = [userSegment(), saved];
    if ('close' in extra && extra.close) segments.push(toolCall('saved-tool', 2, 'call-1'));
    projection.merge(page(segments));
    projection.confirmRunRange('snap', 'run-1');
    const messages = projection.project(previous, new Set(['run-1']));
    assert.ok(messages.some((message: any) => message.text === 'Reply' && !message.historyStored), 'live stays');
    assert.ok(messages.some((message: any) => message.text === (saved as any).text), 'saved stays');
  }
});

test('an open saved prefix keeps one uncovered tail and later deltas extend only that tail', () => {
  const sources = new LiveMessageSources(), projection = new HistoryProjection(sources);
  let previous = live(sources, 'Reply');
  projection.merge(page([userSegment(), segment('saved-prefix', 'assistant', 'Rep', 1)]));
  projection.confirmRunRange('snap', 'run-1');
  let messages = projection.project(previous, new Set(['run-1']));
  assert.equal(messages.filter((message: any) => message.role === 'assistant').map((message: any) => message.text).join(''), 'Reply');
  sources.text('run-1', 2, '!');
  previous = messages;
  messages = projection.project(previous, new Set(['run-1']));
  assert.equal(messages.filter((message: any) => message.role === 'assistant').map((message: any) => message.text).join(''), 'Reply!');
  assert.equal(messages.filter((message: any) => message.role === 'assistant').length, 2);
  assert.equal(messages.filter((message: any) => message.text === 'Reply!').length, 0);
});

test('the same text before and after a real tool boundary is covered by its own interval', () => {
  const sources = new LiveMessageSources(), projection = new HistoryProjection(sources);
  sources.acceptInput(input()); sources.begin('run-1', 0); sources.text('run-1', 1, 'Same');
  const tool = { id: 'run-1-tool-call-1', runId: 'run-1', role: 'assistant' as const, text: '', tool: { id: 'call-1', name: 'read', status: 'Running', content: '' } };
  sources.tool('run-1', 2, tool, 'tool-start'); sources.text('run-1', 3, 'Same');
  const previous = [input(), { id: 'run-1-text-1', runId: 'run-1', role: 'assistant' as const, text: 'Same' }, tool, { id: 'run-1-text-3', runId: 'run-1', role: 'assistant' as const, text: 'Same' }];
  projection.merge(page([
    userSegment(), segment('first', 'assistant', 'Same', 1), toolCall('call', 2, 'call-1'),
    { ...segment('result', 'toolResult', 'done', 3), type: 'tool-result', toolCallId: 'call-1', toolName: 'read', resultKind: 'text', truncated: false, isError: false },
    segment('second', 'assistant', 'Same', 4),
  ]));
  projection.confirmRunRange('snap', 'run-1');
  const messages = projection.project(previous, new Set(['run-1']));
  assert.deepEqual(messages.map((message: any) => message.tool?.id ?? message.text), ['Question', 'Same', 'call-1', 'Same']);
  assert.ok(messages.every((message: any) => !message.historyRecoveryUnconfirmed));
});

test('a durable Run result alone never claims live prose', () => {
  const sources = new LiveMessageSources(), projection = new HistoryProjection(sources);
  const previous = live(sources, 'Reply');
  projection.merge(page([userSegment(), { ...segment('run-1-final', 'assistant', 'Reply', 1, { type: 'run-result' }), runId: 'run-1' }]));
  projection.confirmRunRange('snap', 'run-1');
  const messages = projection.project(previous, new Set(['run-1']));
  assert.ok(messages.some((message: any) => message.text === 'Reply' && !message.historyStored && message.historyRecoveryUnconfirmed), 'live output stays explicit');
  assert.ok(messages.some((message: any) => message.text === 'Reply' && message.historyStored), 'saved result stays explicit');
});

test('explicit stream coordinates keep precedence over compatible inference', () => {
  const sources = new LiveMessageSources(), projection = new HistoryProjection(sources);
  const previous = live(sources, 'Reply');
  projection.merge(page([userSegment(), segment('saved-reply', 'assistant', 'Other', 1, { streamId: 'run-1-text-1', streamOffset: 0 })]));
  projection.confirmRunRange('snap', 'run-1');
  const messages = projection.project(previous, new Set(['run-1']));
  assert.ok(messages.some((message: any) => message.text === 'Reply' && message.historyRecoveryUnconfirmed));
  assert.ok(messages.some((message: any) => message.text === 'Other'));
});

test('equal text in another Run is never used as identity evidence', () => {
  const sources = new LiveMessageSources(), projection = new HistoryProjection(sources);
  const previous = live(sources, 'Same');
  projection.merge(page([{ ...segment('other-run', 'assistant', 'Same', 0), runId: 'run-2' }]));
  projection.confirmRunRange('snap', 'run-2');
  const messages = projection.project(previous, new Set(['run-1']));
  assert.equal(messages.filter((message: any) => message.text === 'Same').length, 2);
  assert.equal(messages.filter((message: any) => message.historyRecoveryUnconfirmed).length, 1);
});

test('mixed coordinate availability in one snapshot is decided per content block', () => {
  const sources = new LiveMessageSources(), projection = new HistoryProjection(sources);
  sources.acceptInput(input()); sources.begin('run-1', 0); sources.text('run-1', 1, 'A');
  const tool = { id: 'run-1-tool-call-1', runId: 'run-1', role: 'assistant' as const, text: '', tool: { id: 'call-1', name: 'read', status: 'Running', content: '' } };
  sources.tool('run-1', 2, tool, 'tool-start'); sources.text('run-1', 3, 'B');
  const previous = [input(), { id: 'run-1-text-1', runId: 'run-1', role: 'assistant' as const, text: 'A' }, tool, { id: 'run-1-text-3', runId: 'run-1', role: 'assistant' as const, text: 'B' }];
  projection.merge(page([
    userSegment(), segment('first', 'assistant', 'A', 1, { streamId: 'run-1-text-1', streamOffset: 0 }), toolCall('call', 2, 'call-1'),
    { ...segment('result', 'toolResult', 'done', 3), type: 'tool-result', toolCallId: 'call-1', toolName: 'read', resultKind: 'text', truncated: false, isError: false },
    segment('second', 'assistant', 'B', 4),
  ]));
  projection.confirmRunRange('snap', 'run-1');
  const messages = projection.project(previous, new Set(['run-1']));
  assert.deepEqual(messages.map((message: any) => message.tool?.id ?? message.text), ['Question', 'A', 'call-1', 'B']);
  assert.ok(messages.every((message: any) => !message.historyRecoveryUnconfirmed));
});

test('SDK split blocks carry one source relation and remain individually addressable', () => {
  const sources = new LiveMessageSources(), projection = new HistoryProjection(sources);
  const previous = live(sources, 'Reply');
  projection.merge(page([userSegment(), { ...segment('saved-reply', 'assistant', 'Re', 1), blockCount: 2 }, { ...segment('saved-tail', 'assistant', 'ply', 1), blockIndex: 1, blockCount: 2, blockId: 'saved-tail-0' }]));
  projection.confirmRunRange('snap', 'run-1');
  const messages = projection.project(previous, new Set(['run-1']));
  const saved = messages.filter((message: any) => message.historyStored && message.role === 'assistant');
  assert.deepEqual(saved.map((message: any) => message.text), ['Re', 'ply']);
  assert.ok(saved.every((message: any) => message.historyDisplaySource === 'run-1-text-1'));
  assert.equal(saved[0].historyDisplayKey, 'run-1-text-1');
});
