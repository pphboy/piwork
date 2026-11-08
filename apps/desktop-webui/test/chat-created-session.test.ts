import assert from 'node:assert/strict';
import test from 'node:test';

const { DesktopAdapter } = await import(new URL('../browser/adapter.js', import.meta.url).href);

for (const failFirstRead of [false, true]) test(`created Session history ${failFirstRead ? 'can recover from a read failure' : 'confirms an empty conversation'}`, async t => {
  let reads = 0, creates = 0;
  t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
    const url = String(input), method = init?.method || 'GET';
    if (url.endsWith('/sessions') && method === 'POST') {
      creates++;
      return Response.json({ workId: 'work-1', sessionId: 'session-new', thinkingLevel: 'off', modelPreference: null });
    }
    if (url.endsWith('/history-capabilities') || url.endsWith('/chat-image-capabilities')) {
      return Response.json({ code: 'UNSUPPORTED' }, { status: 501 });
    }
    if (url.includes('/sessions/session-new') && method === 'GET') {
      reads++;
      if (failFirstRead && reads === 1) return Response.json({ code: 'UNAVAILABLE', message: 'Synthetic history error' }, { status: 503 });
      return Response.json({ session: { workId: 'work-1', sessionId: 'session-new' }, messages: [], runs: [] });
    }
    throw new Error(`Unexpected synthetic request: ${method} ${url}`);
  });
  const adapter = new DesktopAdapter();
  adapter.state.signedIn = true;
  adapter.state.works = [{ id: 'work-1', status: 'Ready', desired: 'running', sessions: [], services: [] }];
  t.after(() => adapter.clearIdentity());
  const id = await adapter.newSession('work-1');
  adapter.activateChat('work-1', id);
  if (failFirstRead) {
    await assert.rejects(adapter.loadSession('work-1', id));
    assert.ok(adapter.state.works[0].sessions[0].error);
  }
  await adapter.loadSession('work-1', id);
  const session = adapter.state.works[0].sessions[0];
  assert.equal(session.id, id);
  assert.ok(session.checkedAt);
  assert.equal(session.error, '');
  assert.deepEqual(session.messages, []);
  assert.equal(creates, 1);
  assert.equal(reads, failFirstRead ? 2 : 1);
});

test('lost creation response recovers and reads the original Session without another POST', async t => {
  let creates = 0, key = '';
  t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
    const url = String(input), method = init?.method || 'GET';
    if (url.endsWith('/sessions') && method === 'POST') {
      creates++;
      key = JSON.parse(String(init?.body)).idempotencyKey;
      throw new TypeError('Synthetic lost creation response');
    }
    if (url.includes('/sessions/submissions/')) return Response.json({ kind: 'session', key, status: 'accepted', session: { workId: 'work-1', sessionId: 'session-original', modelPreference: null, thinkingLevel: 'off' } });
    if (url.endsWith('/history-capabilities') || url.endsWith('/chat-image-capabilities')) return Response.json({ code: 'UNSUPPORTED' }, { status: 501 });
    if (url.includes('/sessions/session-original') && method === 'GET') return Response.json({ session: { workId: 'work-1', sessionId: 'session-original' }, messages: [], runs: [] });
    throw new Error(`Unexpected synthetic request: ${method} ${url}`);
  });
  const adapter = new DesktopAdapter();
  adapter.state.signedIn = true;
  adapter.state.works = [{ id: 'work-1', status: 'Ready', desired: 'running', sessions: [], services: [] }];
  t.after(() => adapter.clearIdentity());
  await assert.rejects(adapter.newSession('work-1'));
  await adapter.recoverSessionCreation('work-1');
  adapter.activateChat('work-1', 'session-original');
  await adapter.loadSession('work-1', 'session-original');
  assert.ok(adapter.state.works[0].sessions[0].checkedAt);
  assert.equal(creates, 1);
  assert.ok(key);
});

test('original creation receipt reports a later deletion without reviving the Session', async t => {
  let creates = 0, key = '';
  t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
    const url = String(input), method = init?.method || 'GET';
    if (url.endsWith('/sessions') && method === 'POST') {
      creates++;
      key = JSON.parse(String(init?.body)).idempotencyKey;
      throw new TypeError('Synthetic lost response');
    }
    if (url.includes('/sessions/submissions/')) return Response.json({ kind: 'session', key, status: 'accepted', session: { workId: 'work-1', sessionId: 'session-deleted', modelPreference: null, thinkingLevel: 'off', deletedAt: '2026-11-08T00:00:00Z' } });
    throw new Error(`Unexpected synthetic request: ${method} ${url}`);
  });
  const adapter = new DesktopAdapter();
  adapter.state.signedIn = true;
  adapter.state.works = [{ id: 'work-1', status: 'Ready', desired: 'running', sessions: [], services: [] }];
  t.after(() => adapter.clearIdentity());
  await assert.rejects(adapter.newSession('work-1'));
  const result = await adapter.recoverSessionCreation('work-1');
  assert.equal(result?.session.deletedAt, '2026-11-08T00:00:00Z');
  assert.equal(adapter.state.works[0].sessions.length, 0);
  assert.equal(adapter.sessionCreations.has('work-1'), false);
  assert.equal(creates, 1);
});

for (const firstResult of ['accepted', 'rejected'] as const) test(`late ${firstResult} creation response cannot clear a newer pending submission`, async t => {
  const releases: Array<(value: Response) => void> = [];
  const keys: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
    const url = String(input), method = init?.method || 'GET';
    if (url.endsWith('/sessions') && method === 'POST') {
      keys.push(JSON.parse(String(init?.body)).idempotencyKey);
      return await new Promise<Response>(resolve => { releases.push(resolve); });
    }
    if (url.includes('/sessions/submissions/')) {
      return Response.json({ kind: 'session', key: keys[0], status: 'accepted', session: { workId: 'work-1', sessionId: 'session-first' } });
    }
    throw new Error(`Unexpected synthetic request: ${method} ${url}`);
  });
  const adapter = new DesktopAdapter();
  adapter.state.signedIn = true;
  adapter.state.works = [{ id: 'work-1', status: 'Ready', desired: 'running', sessions: [], services: [] }];
  t.after(() => adapter.clearIdentity());
  const first = adapter.newSession('work-1');
  await adapter.recoverSessionCreation('work-1');
  const second = adapter.newSession('work-1');
  assert.equal(adapter.sessionCreations.get('work-1')?.key, keys[1]);
  releases[0]!(firstResult === 'accepted'
    ? Response.json({ workId: 'work-1', sessionId: 'session-first' })
    : Response.json({ code: 'INVALID_REQUEST' }, { status: 400 }));
  if (firstResult === 'accepted') await first;
  else await assert.rejects(first);
  assert.equal(adapter.sessionCreations.get('work-1')?.key, keys[1]);
  releases[1]!(Response.json({ workId: 'work-1', sessionId: 'session-second' }));
  await second;
  assert.equal(adapter.sessionCreations.has('work-1'), false);
});

test('Session creation and its unknown-result recovery do not block or replace message submissions', async t => {
  let creates = 0, key = '', fail = false;
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    paths.push(url);
    if (url.endsWith('/sessions') && init?.method === 'POST') {
      key = JSON.parse(String(init.body)).idempotencyKey;
      creates++;
      if (fail) throw new TypeError('Synthetic lost response');
      return Response.json({ workId: 'work-1', sessionId: 'session-created' });
    }
    if (url.includes('/sessions/submissions/')) {
      return Response.json({ kind: 'session', key, status: 'accepted', session: { workId: 'work-1', sessionId: 'session-recovered' } });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const adapter = new DesktopAdapter();
  adapter.state.signedIn = true;
  adapter.state.works = [{ id: 'work-1', status: 'Ready', desired: 'running', sessions: [], services: [] }];
  t.after(() => adapter.clearIdentity());
  const message = { kind: 'run' as const, key: 'message-key', sessionId: 'message-session', error: '' };
  adapter.chatSubmissions.set('work-1', message);
  await adapter.newSession('work-1');
  assert.equal(adapter.chatSubmissions.get('work-1'), message);
  fail = true;
  await assert.rejects(adapter.newSession('work-1'));
  assert.equal(adapter.sessionCreations.get('work-1')?.key, key);
  await assert.rejects(adapter.newSession('work-1'));
  assert.equal(creates, 2, 'only this creation guards against duplicate creation');
  await adapter.recoverSessionCreation('work-1');
  assert.equal(adapter.chatSubmissions.get('work-1'), message);
  assert.equal(adapter.sessionCreations.has('work-1'), false);
  assert.ok(paths.some(path => path.includes('/sessions/submissions/')));
  assert.ok(paths.every(path => !path.includes('/runs')));
  adapter.sessionCreations.set('work-1', { kind: 'session', key: 'pending-create', error: '' });
  adapter.clearIdentity();
  assert.equal(adapter.chatSubmissions.size, 0);
  assert.equal(adapter.sessionCreations.size, 0);
});

test('new Session model drafts are checked independently of message admission', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ workId: 'work-1', sessionId: 'session-draft' }));
  const adapter = new DesktopAdapter();
  adapter.state.signedIn = true;
  adapter.state.works = [{ id: 'work-1', status: 'Ready', desired: 'running', sessions: [], services: [] }];
  adapter.models.set('work-1', { loading: false, confirmed: true, error: '', models: [], defaultModel: { modelRef: null, label: 'Synthetic model', provider: 'fixture', model: 'one', thinkingLevels: ['off'] } });
  Object.assign(adapter.modelSelection('work-1', ''), { ref: null, thinking: 'off', phase: 'dirty', revision: 1 });
  const message = { kind: 'run' as const, key: 'message-key', sessionId: 'existing', error: '' };
  adapter.chatSubmissions.set('work-1', message);
  t.mock.method(adapter, 'saveModel', async () => undefined);
  t.after(() => adapter.clearIdentity());
  assert.equal(adapter.modelReady('work-1', ''), false, 'message admission still waits for its own previous submission');
  assert.equal(await adapter.newSession('work-1'), 'session-draft');
  assert.equal(adapter.chatSubmissions.get('work-1'), message);
});

test('recovering an original Run leaves an independent Session creation pending', async t => {
  let creationKey = '';
  t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/sessions') && init?.method === 'POST') {
      creationKey = JSON.parse(String(init.body)).idempotencyKey;
      throw new TypeError('Synthetic lost creation response');
    }
    if (url.includes('/runs/submissions/')) {
      return Response.json({ kind: 'run', key: 'run-key', status: 'accepted', run: { workId: 'work-1', sessionId: 'existing', submissionKey: 'run-key', runId: 'original-run', state: 4 } });
    }
    if (url.endsWith('/history-capabilities')) return Response.json({ code: 'UNSUPPORTED' }, { status: 501 });
    throw new Error(`Unexpected request: ${url}`);
  });
  const adapter = new DesktopAdapter();
  adapter.state.signedIn = true;
  adapter.state.works = [{ id: 'work-1', status: 'Ready', desired: 'running', sessions: [{ id: 'existing', title: 'Session existing', messages: [] }], services: [] }];
  adapter.chatSubmissions.set('work-1', { kind: 'run', key: 'run-key', sessionId: 'existing', error: '' });
  t.mock.method(adapter, 'loadSession', async () => undefined);
  t.mock.method(adapter, 'resumeRun', async () => undefined);
  t.after(() => adapter.clearIdentity());
  await assert.rejects(adapter.newSession('work-1'));
  const creation = adapter.sessionCreations.get('work-1');
  assert.equal(creation?.key, creationKey);
  const result = await adapter.recoverChatSubmission('work-1');
  assert.equal(result?.run.runId, 'original-run');
  assert.equal(adapter.chatSubmissions.has('work-1'), false);
  assert.equal(adapter.sessionCreations.get('work-1'), creation);
});

test('a late creation response cannot affect a new Desktop identity', async t => {
  let release!: (value: Response) => void;
  t.mock.method(globalThis, 'fetch', async () => await new Promise<Response>(resolve => { release = resolve; }));
  const adapter = new DesktopAdapter();
  adapter.state.signedIn = true;
  adapter.state.works = [{ id: 'work-1', status: 'Ready', desired: 'running', sessions: [], services: [] }];
  const pending = adapter.newSession('work-1');
  adapter.clearIdentity();
  adapter.state.signedIn = true;
  adapter.state.works = [{ id: 'work-1', status: 'Ready', desired: 'running', sessions: [], services: [] }];
  const creation = { kind: 'session' as const, key: 'new-identity-create', error: '' };
  const message = { kind: 'run' as const, key: 'new-identity-message', error: '' };
  adapter.sessionCreations.set('work-1', creation);
  adapter.chatSubmissions.set('work-1', message);
  t.after(() => adapter.clearIdentity());
  release(Response.json({ workId: 'work-1', sessionId: 'old-identity-session' }));
  await assert.rejects(pending);
  assert.equal(adapter.sessionCreations.get('work-1'), creation);
  assert.equal(adapter.chatSubmissions.get('work-1'), message);
  assert.equal(adapter.getWork('work-1')?.sessions.length, 0);
});

test('a late creation reply does not reapply a recovered model draft over later edits', async t => {
  let key = '', release!: (value: Response) => void;
  t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
    if (init?.method === 'POST') {
      key = JSON.parse(String(init.body)).idempotencyKey;
      return await new Promise<Response>(resolve => { release = resolve; });
    }
    assert.ok(String(input).includes('/sessions/submissions/'));
    return Response.json({ kind: 'session', key, status: 'accepted', session: { workId: 'work-1', sessionId: 'session-original' } });
  });
  const adapter = new DesktopAdapter();
  adapter.state.signedIn = true;
  adapter.state.works = [{ id: 'work-1', status: 'Ready', desired: 'running', sessions: [], services: [] }];
  adapter.models.set('work-1', { loading: false, confirmed: true, error: '', models: [], defaultModel: { modelRef: null, label: 'Synthetic model', provider: 'fixture', model: 'one', thinkingLevels: ['off'] } });
  Object.assign(adapter.modelSelection('work-1', ''), { ref: null, thinking: 'off', phase: 'dirty', revision: 1 });
  const saving = t.mock.method(adapter, 'saveModel', async () => undefined);
  t.after(() => adapter.clearIdentity());
  const pending = adapter.newSession('work-1');
  await adapter.recoverSessionCreation('work-1');
  const choice = adapter.modelSelection('work-1', 'session-original');
  Object.assign(choice, { ref: 'later-model', thinking: 'high', phase: 'dirty', revision: 2 });
  release(Response.json({ workId: 'work-1', sessionId: 'session-original' }));
  await pending;
  assert.equal(choice.ref, 'later-model');
  assert.equal(choice.thinking, 'high');
  assert.equal(choice.revision, 2);
  assert.equal(saving.mock.callCount(), 0);
});
