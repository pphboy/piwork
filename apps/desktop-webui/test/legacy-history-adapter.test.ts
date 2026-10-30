import test from 'node:test';
import assert from 'node:assert/strict';
const { DesktopAdapter } = await import(new URL('../browser/adapter.js', import.meta.url).href);

test('legacy history read started under one identity cannot populate a replacement identity with the same local IDs', async t => {
  const adapter = new DesktopAdapter(); adapter.state.signedIn = true;
  const work = () => ({ id: 'work-1', status: 'Ready', desired: 'running', services: [], sessions: [{ id: 'session-1', title: 'One', messages: [] }] });
  adapter.state.works = [work()]; t.after(() => adapter.clearIdentity());
  t.mock.method(adapter, 'supportsHistory', async () => false);
  t.mock.method(adapter, 'loadImageCapabilities', async () => undefined);
  t.mock.method(adapter, 'readSessionOptions', async () => undefined);
  let release!: (value: unknown) => void, started!: () => void;
  const gate = new Promise(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
  t.mock.method(adapter, 'request', async () => { started(); return gate; });
  const reading = adapter.loadSession('work-1', 'session-1'); await entered;
  adapter.clearIdentity(); adapter.state.signedIn = true; adapter.state.works = [work()];
  release({ session: { sessionId: 'session-1' }, messages: [{ entryId: 'old', runId: 'old-run', role: 'user', text: 'Other identity content' }], runs: [] });
  await reading;
  assert.deepEqual(adapter.getWork('work-1').sessions[0].messages, []);
  assert.equal(adapter.getWork('work-1').sessions[0].checkedAt, undefined);
});
