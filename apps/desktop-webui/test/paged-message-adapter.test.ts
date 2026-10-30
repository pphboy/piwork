import test from 'node:test';
import assert from 'node:assert/strict';
const { DesktopAdapter } = await import(new URL('../browser/adapter.js', import.meta.url).href);
type Data = Record<string, any>;
const session = { sessionId: 'session-1', workId: 'work-1', modelPreference: null, thinkingLevel: 'off', source: { kind: 'chat' } };
const encoder = new TextEncoder();
const segment = (entryId: string, role: string, text: string, order: number, extra: Data = {}) => ({
  entryId, entryOrder: order, role, runId: 'run-1', blockId: `${entryId}-0`, blockIndex: 0, blockCount: 1, type: 'text',
  byteOffset: 0, totalBytes: encoder.encode(text).length, text, complete: true, ...extra,
});
const page = (segments: Data[], snapshotId = 'frozen') => ({ contractVersion: 1, session, snapshotId, segments, runs: [], nextCursor: null, hasMore: false });
const savedPage = () => page([{ ...segment('run-1-user', 'user', 'Question', 0), blockId: 'run-1-user-0' }, segment('saved-reply', 'assistant', '你好!', 1)]);

async function fixture(t: any, events: string) {
  const adapter = new DesktopAdapter(); adapter.state.signedIn = true;
  adapter.state.works = [{ id: 'work-1', status: 'Ready', desired: 'running', services: [], sessions: [{ id: 'session-1', title: 'One', messages: [] }] }];
  t.after(() => adapter.clearIdentity());
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const url = new URL(String(input), 'http://desktop.test'); requests.push(url.pathname + url.search);
    if (url.pathname.endsWith('/history-capabilities')) return Response.json({ contractVersion: 1, profile: 'session-history-v1', pageBytes: 524288 });
    if (url.pathname.endsWith('/chat-image-capabilities')) return Response.json({ code: 'UNSUPPORTED' }, { status: 501 });
    if (url.pathname.endsWith('/events')) return new Response(events, { headers: { 'Content-Type': 'application/x-ndjson' } });
    if (/\/runs\/run-1$/.test(url.pathname) && (init?.method ?? 'GET') === 'GET') return Response.json({ run: { workId: 'work-1', sessionId: 'session-1', runId: 'run-1', state: 4, finalText: '你好!' } });
    if (url.pathname.endsWith('/history')) return Response.json(savedPage());
    if (url.pathname.endsWith('/services')) return Response.json({ services: [] });
    if (url.pathname.endsWith('/configuration')) return Response.json({ revision: 0, activeRevision: 0, loaded: true });
    return Response.json({ code: 'NOT_FOUND' }, { status: 404 });
  });
  return { adapter, requests };
}

test('terminal paged readback without coordinates covers a fragmented live answer once', async t => {
  const events = [
    { sequence: 1, kind: { $case: 'text', text: { delta: '你', byteOffset: 0, totalBytes: 7, complete: false } } },
    { sequence: 1, kind: { $case: 'text', text: { delta: '你', byteOffset: 0, totalBytes: 7, complete: false } } },
    { sequence: 1, kind: { $case: 'text', text: { delta: '好!', byteOffset: 3, totalBytes: 7, complete: true } } },
    { sequence: 2, kind: { $case: 'state', state: { state: 4, finalText: '你好!' } } },
  ].map(event => JSON.stringify(event)).join('\n') + '\n';
  const { adapter } = await fixture(t, events);
  const work = adapter.getWork('work-1'), run = { id: 'run-1', sessionId: 'session-1', status: 'running' as const, cursor: 0, created: new Date().toISOString() };
  work.run = run; work.sessions[0]!.messages = [{ id: 'run-1-user', runId: 'run-1', role: 'user', text: 'Question' }];
  const sources = adapter.liveSources('work-1', 'session-1');
  sources.acceptInput({ id: 'run-1-user', runId: 'run-1', role: 'user', text: 'Question' });
  await adapter.resumeRun('work-1');
  const messages = adapter.getWork('work-1').sessions[0]!.messages;
  assert.deepEqual(messages.map((message: any) => message.text), ['Question', '你好!']);
  assert.ok(messages.every((message: any) => !message.historyRecoveryUnconfirmed));
  assert.equal(adapter.getWork('work-1').run!.status, 'succeeded');
});

test('a paged read for another identity cannot write into a fresh Session', async t => {
  const { adapter, requests } = await fixture(t, '');
  const run = { id: 'run-1', sessionId: 'session-1', status: 'succeeded' as const, cursor: 9, created: new Date().toISOString() };
  const sources = adapter.liveSources('work-1', 'session-1');
  sources.acceptInput({ id: 'run-1-user', runId: 'run-1', role: 'user', text: 'Question' });
  sources.begin('run-1', 0); sources.text('run-1', 1, '你好!');
  adapter.getWork('work-1').sessions[0]!.messages = [{ id: 'run-1-user', runId: 'run-1', role: 'user', text: 'Question' }, { id: 'run-1-text-1', runId: 'run-1', role: 'assistant', text: '你好!' }];
  const pending = adapter.loadSavedRun('work-1', run).catch(() => undefined);
  adapter.clearIdentity(); adapter.state.signedIn = true;
  adapter.state.works = [{ id: 'work-1', status: 'Ready', desired: 'running', services: [], sessions: [{ id: 'session-1', title: 'One', messages: [] }] }];
  await pending;
  assert.deepEqual(adapter.getWork('work-1').sessions[0]!.messages, []);
  assert.ok(requests.some(path => path.includes('/history')));
});

test('a normal paged Run read without live observation leaves saved history untouched', async t => {
  const { adapter } = await fixture(t, '');
  await adapter.loadSavedRun('work-1', { id: 'run-1', sessionId: 'session-1', status: 'succeeded', cursor: 4, created: new Date().toISOString() });
  assert.deepEqual(adapter.getWork('work-1').sessions[0]!.messages.map((message: any) => message.text), ['Question', '你好!']);
});
