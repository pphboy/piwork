import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
const { DesktopAdapter } = await import(new URL('../browser/adapter.js', import.meta.url).href);
const { ServiceReadFeedback } = await import(new URL('../browser/service-read-feedback.js', import.meta.url).href);

async function fixture(t: TestContext, initialStatus: number) {
  let probeStatus = initialStatus;
  t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
    const path = String(input).replace('/_desktop/api/', '');
    let body: unknown;
    let status = 200;
    if (path === 'works/one') body = { id: 'one', name: 'One', observedState: 'ready', desiredState: 'running' };
    else if (path === 'works/one/services') body = { services: [{ serviceId: 'notes', name: 'Notes', enabled: true, observedState: 'ready', access: { ports: [{ port: 3000, url: 'http://notes.test' }] } }] };
    else if (path === 'service-entries' && init?.method === 'POST') body = { entryId: 'entry-one', workId: 'one', serviceId: 'notes', port: 3000, origin: 'http://notes.test', entryUrl: 'http://notes.test/enter', embed: 'unknown' };
    else if (path === 'service-entries/entry-one') {
      status = probeStatus;
      body = status === 200 ? { workId: 'one', serviceId: 'notes', port: 3000, embed: 'allowed' } : { code: 'SYNTHETIC_READ_FAILURE', message: `Original probe HTTP ${status}` };
    } else throw new Error(`Unexpected fixture request ${path}`);
    return new Response(JSON.stringify(body), { status });
  });
  const adapter = new DesktopAdapter();
  adapter.state.signedIn = true;
  t.after(() => adapter.clearIdentity());
  await adapter.refreshWorkStatus('one');
  await adapter.loadServices('one');
  await adapter.ensureServiceEntry('one', 'notes', 3000);
  await adapter.serviceFrameLoaded('one', 'notes', 3000).catch(() => {});
  return { adapter, healthy: () => { probeStatus = 200; } };
}

test('authoritative preview 403 retains one access error, not a second identical preview failure', async t => {
  const { adapter } = await fixture(t, 403);
  const feedback = new ServiceReadFeedback();
  const target = { identity: String(adapter.identityEpoch), workId: 'one', serviceId: 'notes', port: 3000, reading: false };
  const entry = feedback.observe({ ...target, source: 'entry', error: adapter.serviceEntryError('one', 'notes', 3000), confirmedVersion: adapter.serviceEntryReadEvidence('one', 'notes', 3000) });
  const preview = feedback.observe({ ...target, source: 'preview', error: adapter.servicePreviewError('one', 'notes', 3000), unconfirmed: !!adapter.servicePreviewUnconfirmed('one', 'notes', 3000), confirmedVersion: adapter.servicePreviewReadEvidence('one', 'notes', 3000) });
  assert.equal(entry.event.tone, 'error');
  assert.match(entry.event.message(), /403/);
  assert.equal(preview.event, undefined);
  assert.equal(adapter.serviceEntryUrl('one', 'notes', 3000), null);
});

test('preview 503 retains entry and only a validated successful probe receipt resolves its read error', async t => {
  const { adapter, healthy } = await fixture(t, 503);
  const feedback = new ServiceReadFeedback();
  const facts = () => ({ identity: String(adapter.identityEpoch), workId: 'one', serviceId: 'notes', port: 3000, source: 'preview', reading: adapter.servicePreviewPending('one', 'notes', 3000), error: adapter.servicePreviewError('one', 'notes', 3000), unconfirmed: !!adapter.servicePreviewUnconfirmed('one', 'notes', 3000), confirmedVersion: adapter.servicePreviewReadEvidence('one', 'notes', 3000) });
  const receipt = adapter.serviceEntryReadEvidence('one', 'notes', 3000);
  assert.ok(receipt);
  const failed = feedback.observe(facts());
  assert.equal(failed.event.tone, 'error');
  assert.match(failed.event.message(), /503/);
  healthy();
  await adapter.serviceFrameLoaded('one', 'notes', 3000);
  assert.equal(adapter.serviceEntryReadEvidence('one', 'notes', 3000), receipt);
  assert.ok(adapter.servicePreviewReadEvidence('one', 'notes', 3000));
  const recovered = feedback.observe(facts());
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.event, undefined);
});
