import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { WorkStore } from '@piwork/work-store';
import { appendAssistantMessage } from '@piwork/pi-adapter';
import { SessionHistoryReader } from './session-history.js';
import { AgentSessionService } from './sessions.js';
import { SessionNamingCoordinator } from './session-naming.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'piwork-naming-'));
  const store = WorkStore.open(join(root, 'work.sqlite'), { workId: 'work', targetVersion: 8 });
  store.createSession({ workId: 'work', sessionId: 'session', sdkHistoryPath: '/var/data/sessions/s.jsonl', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
  const model = { modelRef: null, label: 'fixture', provider: 'fixture', model: 'fixture-model' };
  const run = store.acceptRun({ workId: 'work', sessionId: 'session', submissionKey: 'run-key', requestDigest: 'digest', promptDigest: 'prompt', actualModelJson: JSON.stringify(model), memoryEnabled: false }).run;
  store.completeRun(run.runId, 'succeeded', 'original reply', null);
  const history = { page(_session: string, query: { content?: string }) {
    return { segments: query.content === 'result' ? [{ role: 'assistant', type: 'run-result', text: 'original reply' }] : [{ role: 'user', type: 'text', text: 'original question' }] };
  } } as unknown as Pick<SessionHistoryReader, 'page'>;
  return {
    store, run: store.getRun(run.runId)!, model, history, close: () => {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test('automatic naming runs once, uses the original model and cannot override a later Rename', async () => {
  const f = fixture();
  let release!: (value: string) => void, started!: () => void, calls = 0;
  const pending = new Promise<string>(resolve => { release = resolve; });
  const invoked = new Promise<void>(resolve => { started = resolve; });
  const naming = new SessionNamingCoordinator('work', f.store, f.history, { async generateSessionTitle(model, user, reply) {
    calls++;
    assert.deepEqual(model, f.model);
    assert.equal(user, 'original question');
    assert.equal(reply, 'original reply');
    started();
    return pending;
  } });
  try {
    naming.onSettled(f.run);
    naming.onSettled(f.run);
    await invoked;
    f.store.sessionManagement.rename('work', 'session', 0, 'Manual title', 'rename-key');
    release('Late generated title');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.store.sessionManagement.read('work', 'session').title, 'Manual title');
    assert.equal(calls, 1);
    assert.equal(f.store.listSessionRuns('work', 'session').length, 1);
  } finally {
    release('done');
    await naming.close();
    f.close();
  }
});

test('automatic naming skips initial SDK system entries to reach the first user message', async () => {
  const f = fixture();
  let pages = 0;
  const history = { page(_session: string, query: { content?: string; cursor?: string }) {
    if (query.content === 'result') return { segments: [{ role: 'assistant', type: 'text', text: 'answer' }] };
    pages++;
    return query.cursor ? { segments: [{ role: 'user', type: 'text', text: 'question' }], hasMore: false } :
      { segments: [{ role: 'system', type: 'text', text: '' }], hasMore: true, nextCursor: 'next' };
  } } as unknown as Pick<SessionHistoryReader, 'page'>;
  let received = '';
  const naming = new SessionNamingCoordinator('work', f.store, history, {
    async generateSessionTitle(_model, user) {
      received = user;
      return 'Title';
    }
  });
  try {
    naming.onSettled(f.run);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(received, 'question');
    assert.equal(pages, 2);
    assert.equal(f.store.sessionManagement.read('work', 'session').title, 'Title');
  } finally {
    await naming.close();
    f.close();
  }
});

test('explicit naming survives lost acknowledgement and restart without repeating a model call', async () => {
  const f = fixture();
  let calls = 0, started!: () => void;
  const invoked = new Promise<void>(resolve => { started = resolve; });
  const generator = { generateSessionTitle: async (_model: unknown, _user: string, _reply: string, signal: AbortSignal) => {
    calls++;
    started();
    return await new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } };
  const naming = new SessionNamingCoordinator('work', f.store, f.history, generator);
  try {
    assert.equal(naming.startExplicit('session', 0, 'original-key').status, 'pending');
    await invoked;
    assert.equal(naming.startExplicit('session', 0, 'original-key').started, false);
    await naming.close();
    assert.equal(f.store.sessionManagement.lookup('work', 'original-key')?.status, 'unknown');
    const reopened = new SessionNamingCoordinator('work', f.store, f.history, generator);
    try {
      reopened.recover();
      assert.equal(reopened.startExplicit('session', 0, 'original-key').started, false);
      assert.equal(calls, 1);
    } finally { await reopened.close(); }
  } finally {
    await naming.close();
    f.close();
  }
});

test('explicit Auto name reports its original outcome and a failed attempt preserves the title', async () => {
  const f = fixture();
  let calls = 0, fail = true;
  const naming = new SessionNamingCoordinator('work', f.store, f.history, { async generateSessionTitle() {
    calls++;
    if (fail) throw new Error('synthetic provider error');
    return 'Generated title';
  } });
  try {
    f.store.sessionManagement.rename('work', 'session', 0, 'Manual title', 'rename-key');
    assert.equal(naming.startExplicit('session', 1, 'failed-key').status, 'pending');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.store.sessionManagement.lookup('work', 'failed-key')?.status, 'failed');
    assert.equal(f.store.sessionManagement.read('work', 'session').title, 'Manual title');
    fail = false;
    assert.equal(naming.startExplicit('session', 1, 'successful-key').status, 'pending');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.store.sessionManagement.lookup('work', 'successful-key')?.status, 'accepted');
    assert.equal(f.store.sessionManagement.read('work', 'session').title, 'Generated title');
    assert.equal(naming.startExplicit('session', 1, 'successful-key').started, false);
    assert.equal(calls, 2);
    assert.equal(f.store.listSessionRuns('work', 'session').length, 1);
  } finally {
    await naming.close();
    f.close();
  }
});

test('a provider that ignores cancellation cannot leave naming pending after its deadline', async () => {
  const f = fixture();
  const naming = new SessionNamingCoordinator('work', f.store, f.history, {
    generateSessionTitle: async () => new Promise<string>(() => {}),
  }, 20);
  try {
    assert.equal(naming.startExplicit('session', 0, 'timeout-key').status, 'pending');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(f.store.sessionManagement.lookup('work', 'timeout-key')?.status, 'failed');
    assert.equal(f.store.sessionManagement.read('work', 'session').title, null);
  } finally {
    await naming.close();
    f.close();
  }
});

test('automatic naming reads the original first turn through the bounded real history reader', async () => {
  const root = mkdtempSync(join(tmpdir(), 'piwork-naming-history-'));
  const workspace = join(root, 'workspace');
  mkdirSync(workspace);
  const store = WorkStore.open(join(root, 'work.sqlite'), { workId: 'work', targetVersion: 8 });
  const sessions = new AgentSessionService('work', store, workspace, join(root, 'sessions'));
  const session = sessions.create(), sdk = sessions.continue(session.sessionId);
  const model = { modelRef: null, label: 'fixture', provider: 'fixture', model: 'fixture-model' };
  const run = store.acceptRun({ workId: 'work', sessionId: session.sessionId, submissionKey: 'run-key', requestDigest: 'digest', promptDigest: 'prompt', actualModelJson: JSON.stringify(model), memoryEnabled: false }).run;
  sdk.appendCustomEntry('piwork-run', { runId: run.runId });
  sdk.appendMessage({ role: 'user', content: [{ type: 'text', text: '原始用户问题' }], timestamp: Date.now() });
  appendAssistantMessage(sdk, '原始助手回复');
  store.completeRun(run.runId, 'succeeded', '原始助手回复', null);
  let invoked!: () => void;
  const complete = new Promise<void>(resolve => { invoked = resolve; });
  const naming = new SessionNamingCoordinator('work', store, new SessionHistoryReader('work', store), { async generateSessionTitle(actual, user, reply) {
    assert.deepEqual(actual, model);
    assert.equal(user, '原始用户问题');
    assert.equal(reply, '原始助手回复');
    invoked();
    return '会话标题';
  } });
  try {
    naming.onSettled(store.getRun(run.runId)!);
    await Promise.race([complete, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('title input was not obtained')), 2000))]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(store.sessionManagement.read('work', session.sessionId).title, '会话标题');
  } finally {
    await naming.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
