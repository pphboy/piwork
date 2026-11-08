import assert from 'node:assert/strict';
import test from 'node:test';
const { SessionManagementController } = await import(new URL('../browser/session-management.js', import.meta.url).href);
const { DesktopAdapter } = await import(new URL('../browser/adapter.js', import.meta.url).href);
type State = import('../dist/browser/session-management.js').SessionManagementState;

function fixture() {
  let identity = 1, revision = 0;
  const calls: Array<{ path: string; method: string; body: any }> = [];
  const applied: State[] = [];
  let handle = async (_path: string, _method: string, _body: any): Promise<any> => ({ contractVersion: 1 });
  const controller = new SessionManagementController({
    identity: () => identity,
    request: async (path: string, method = 'GET', body?: unknown) => {
      calls.push({ path, method, body });
      return handle(path, method, body);
    },
    revision: () => revision,
    canObserve: () => true,
    apply: (state: State) => {
      applied.push(state);
      revision = Math.max(revision, state.revision);
    },
    emit: () => undefined,
    error: (code: string, key: string) => Object.assign(new Error(key), { code }),
  });
  const state = (partial: Partial<State> = {}): State => ({ workId: 'work', sessionId: 'session', title: null, titleSource: 'default', revision: 0, manualLock: false, deletedAt: null, autoState: 'eligible', ...partial });
  return {
    controller, calls, applied, state, setHandler: (value: typeof handle) => { handle = value; }, switchIdentity: () => {
      identity++;
      controller.reset();
    }
  };
}

test('rename sends the original target and revision and applies a confirmed response', async t => {
  const f = fixture();
  t.after(() => f.controller.reset());
  await f.controller.loadCapabilities('work');
  f.setHandler(async (_path, _method, body) => f.state({ title: body.title, titleSource: 'manual', manualLock: true, revision: 1 }));
  const result = await f.controller.start('work', 'session', 'rename', '  Reading  ');
  assert.equal(result?.title, 'Reading');
  assert.equal(f.calls[1]!.path, 'works/work/sessions/session/name');
  assert.equal(f.calls[1]!.body.expectedRevision, 0);
  assert.ok(f.calls[1]!.body.operationKey);
  assert.equal(f.controller.operation('work', 'session'), undefined);
});

test('lost write is checked with the original operation key and is never replayed', async t => {
  const f = fixture();
  t.after(() => f.controller.reset());
  await f.controller.loadCapabilities('work');
  f.setHandler(async (_path, method) => {
    if (method === 'PATCH') throw Object.assign(new Error('lost'), { code: 'RESULT_UNKNOWN' });
    return {};
  });
  await assert.rejects(f.controller.start('work', 'session', 'rename', 'Reading'));
  const original = f.controller.operation('work', 'session')!;
  assert.equal(original.phase, 'unknown');
  await assert.rejects(f.controller.start('work', 'session', 'rename', 'Other'));
  f.setHandler(async () => ({ operationKey: original.key, status: 'accepted', kind: 'rename', state: f.state({ title: 'Reading', titleSource: 'manual', manualLock: true, revision: 1 }) }));
  await f.controller.check('work', 'session');
  assert.equal(f.applied.at(-1)?.title, 'Reading');
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 1);
  assert.ok(f.calls.at(-1)?.path.endsWith('/management-operations/' + original.key));
});

test('Auto name remains pending until its original result is confirmed', async t => {
  const f = fixture();
  t.after(() => f.controller.reset());
  await f.controller.loadCapabilities('work');
  f.setHandler(async (_path, _method, body) => ({ operationKey: body.operationKey, status: 'pending', kind: 'auto-name', state: f.state({ autoState: 'pending' }) }));
  await f.controller.start('work', 'session', 'auto-name');
  const original = f.controller.operation('work', 'session')!;
  assert.equal(original.phase, 'pending');
  f.setHandler(async () => ({ operationKey: original.key, status: 'accepted', kind: 'auto-name', state: f.state({ title: 'Generated', titleSource: 'auto', revision: 1, autoState: 'completed' }) }));
  await f.controller.check('work', 'session');
  assert.equal(f.applied.at(-1)?.title, 'Generated');
  assert.equal(f.controller.operation('work', 'session'), undefined);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
});

test('foreign Session responses and old identity responses never update current state', async t => {
  const f = fixture();
  t.after(() => f.controller.reset());
  await f.controller.loadCapabilities('work');
  f.setHandler(async () => f.state({ sessionId: 'other', title: 'Wrong', titleSource: 'manual', manualLock: true, revision: 1 }));
  await assert.rejects(f.controller.start('work', 'session', 'rename', 'Right'));
  assert.equal(f.controller.operation('work', 'session')?.phase, 'unknown');
  assert.deepEqual(f.applied, []);
  f.switchIdentity();
  f.setHandler(async () => ({ contractVersion: 1 }));
  await f.controller.loadCapabilities('work');
  let release!: (value: unknown) => void;
  f.setHandler(async () => await new Promise(resolve => { release = resolve; }));
  const pending = f.controller.start('work', 'session', 'rename', 'Right');
  f.switchIdentity();
  release(f.state({ title: 'Right', titleSource: 'manual', manualLock: true, revision: 1 }));
  await assert.rejects(pending);
  assert.deepEqual(f.applied, []);
});

test('an older Agent keeps management unavailable without a write', async t => {
  const f = fixture();
  t.after(() => f.controller.reset());
  f.setHandler(async () => ({ contractVersion: 0 }));
  await f.controller.loadCapabilities('work');
  await assert.rejects(f.controller.start('work', 'session', 'delete'));
  assert.equal(f.calls.filter(call => call.method !== 'GET').length, 0);
});

for (const kind of ['rename', 'delete'] as const) test(`stale list reads cannot undo a confirmed Session ${kind}`, async t => {
  let release!: (response: Response) => void;
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
    const url = String(input), method = init?.method || 'GET';
    if (url.endsWith('/session-management-capabilities')) return Response.json({ contractVersion: 1 });
    if (url.endsWith('/sessions') && method === 'GET') {
      started();
      return await new Promise<Response>(resolve => { release = resolve; });
    }
    if (url.endsWith('/sessions/session-1/name') && method === 'PATCH') return Response.json({ workId: 'work-1', sessionId: 'session-1', title: 'Renamed', titleSource: 'manual', revision: 1, manualLock: true, deletedAt: null, autoState: 'eligible' });
    if (url.endsWith('/sessions/session-1/delete') && method === 'POST') return Response.json({ workId: 'work-1', sessionId: 'session-1', title: null, titleSource: 'default', revision: 1, manualLock: false, deletedAt: '2026-11-08T00:00:00Z', autoState: 'eligible' });
    if (url.endsWith('/history-capabilities') || url.endsWith('/chat-image-capabilities')) return Response.json({ code: 'UNSUPPORTED' }, { status: 501 });
    if (url.endsWith('/sessions/session-1')) return Response.json({ session: { workId: 'work-1', sessionId: 'session-1' }, messages: [], runs: [] });
    throw new Error(`Unexpected synthetic request: ${method} ${url}`);
  });
  const adapter = new DesktopAdapter();
  adapter.state.signedIn = true;
  adapter.state.works = [{ id: 'work-1', status: 'Ready', desired: 'running', sessions: [{ id: 'session-1', title: 'Session session-1', titleRevision: 0, titleSource: 'default', messages: [] }], services: [] }];
  t.after(() => adapter.clearIdentity());
  await adapter.sessionManagement.loadCapabilities('work-1');
  const list = adapter.loadSessions('work-1');
  await reading;
  await adapter.sessionManagement.start('work-1', 'session-1', kind, kind === 'rename' ? 'Renamed' : undefined);
  release(Response.json({ sessions: [{ workId: 'work-1', sessionId: 'session-1', title: null, titleSource: 'default', titleRevision: 0, manualTitleLock: false, deletedAt: null, autoNameState: 'eligible' }] }));
  await list;
  if (kind === 'rename') assert.equal(adapter.state.works[0].sessions[0]?.title, 'Renamed');
  else assert.equal(adapter.state.works[0].sessions.length, 0);
});
