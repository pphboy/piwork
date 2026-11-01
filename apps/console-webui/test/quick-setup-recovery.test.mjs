import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { setupRoot, settle, deferred, model, initialSnapshot } from './fixtures/quick-setup-fixture.mjs';
const moduleURL = process.env.PIWORK_CONSOLE_MODULE_DIR
  ? pathToFileURL(`${process.env.PIWORK_CONSOLE_MODULE_DIR}/quick-setup.js`)
  : new URL('../dist/browser/quick-setup.js', import.meta.url);
const { mountQuickSetup } = await import(moduleURL);
const { SetupRequestError } = await import(new URL('quick-setup-port.js', moduleURL));

function fixture(t, overrides = {}, options = {}) {
  const root = setupRoot(), calls = [], notices = [], resolutions = [], navigations = [];
  let active = true;
  const port = {
    readSnapshot: async () => { calls.push('read-snapshot');
    return initialSnapshot(); },
    readModels: async () => { calls.push('read-models');
    return { models: [] }; },
    createModel: async () => { calls.push('create-model');
    throw new SetupRequestError('Synthetic acceptance lost', 0, true); },
    bindRuntime: async () => { calls.push('bind-runtime');
    throw new Error('Unexpected bind'); },
    testModel: async () => { calls.push('test-model');
    throw new Error('Unexpected Test'); },
    ...overrides,
  };
  const setup = mountQuickSetup(root, {
    port, csrf: () => 'synthetic-csrf', current: () => active, identity: () => 'fixture-identity',
    expired: () => { active = false; }, navigate: href => navigations.push(href),
    dirty: () => {}, step: () => {}, preparation: false,
    notify: notice => notices.push(notice), resolve: owner => resolutions.push(owner), ...options,
  });
  t.after(() => setup.dispose());
  return { root, calls, notices, resolutions, navigations, port, setup, deactivate: () => { active = false; } };
}

for (const count of [0, 1, 2]) test(`unknown model readback with ${count} exact new matches never repeats create or binds Runtime`, async t => {
  let models = [];
  const f = fixture(t, { readModels: async () => ({ models }) });
  await settle();
  f.root.input('model-key', 'synthetic-key');
  f.root.fire('submit');
  await settle();
  assert.equal(f.calls.filter(call => call === 'create-model').length, 1);
  assert.ok(f.notices.some(notice => notice.tone === 'unknown'));
  models = Array.from({ length: count }, (_, index) => model('match-' + index));
  f.root.action('refresh');
  await settle();
  assert.equal(f.calls.filter(call => call === 'create-model').length, 1);
  assert.ok(!f.calls.includes('bind-runtime'));
  assert.deepEqual(f.navigations, []);
  if (count === 0) assert.match(f.root.output(), /is unconfirmed/);
  if (count === 1) assert.ok(f.notices.some(notice => /Continue to bind Runtime/.test(notice.message())));
  if (count === 2) assert.ok(f.notices.some(notice => /More than one saved model matches/.test(notice.message())));
});
for (const field of ['name', 'model', 'api', 'baseUrl', 'enabled', 'credentialAvailable']) test(`unknown model readback rejects mismatched ${field}`, async t => {
  let models = [];
  const f = fixture(t, { readModels: async () => ({ models }) });
  await settle();
  f.root.input('model-key', 'synthetic-key');
  f.root.fire('submit');
  await settle();
  models = [model('not-original', { [field]: typeof model()[field] === 'boolean' ? false : 'different' })];
  f.root.action('refresh');
  await settle();
  assert.match(f.root.output(), /is unconfirmed/);
  assert.equal(f.calls.filter(call => call === 'create-model').length, 1);
  assert.ok(!f.calls.includes('bind-runtime'));
});
test('read failure and recovery retain the original unknown write and stable recovery markup', async t => {
  let fail = false;
  const f = fixture(t, { readSnapshot: async () => {
    if (fail) throw new Error('Synthetic read interrupted');
    return initialSnapshot();
  } });
  await settle();
  f.root.input('model-key', 'synthetic-key');
  f.root.fire('submit');
  await settle();
  fail = true;
  f.root.action('refresh');
  await settle();
  assert.match(f.root.output(), /Synthetic read interrupted/);
  assert.match(f.root.output(), /is unconfirmed/);
  fail = false;
  f.root.action('refresh');
  await settle();
  assert.doesNotMatch(f.root.output(), /Synthetic read interrupted/);
  assert.match(f.root.output(), /is unconfirmed/);
  assert.equal(f.calls.filter(call => call === 'create-model').length, 1);
});
test('catalog read failure is not an empty installation and explicit retry recovers without writes', async t => {
  let fail = true;
  const f = fixture(t, { readModels: async () => {
    if (fail) throw new Error('Synthetic catalog failure');
    return { models: [model()] };
  } });
  await settle();
  assert.match(f.root.output(), /Synthetic catalog failure/);
  fail = false;
  f.root.action('refresh');
  await settle();
  assert.doesNotMatch(f.root.output(), /Synthetic catalog failure/);
  assert.ok(!f.calls.includes('create-model'));
});
for (const invalidate of ['dispose', 'identity']) test(`a late initial read after ${invalidate} cannot render or navigate`, async t => {
  const gate = deferred();
  const f = fixture(t, { readSnapshot: () => gate.promise });
  const original = f.root.innerHTML;
  if (invalidate === 'dispose') f.setup.dispose();
  else f.deactivate();
  gate.resolve(initialSnapshot());
  await settle();
  assert.equal(f.root.innerHTML, original);
  assert.deepEqual(f.navigations, []);
  assert.ok(!f.calls.includes('read-models'));
});
test('initial failure retains its cause and error-page Retry performs only reads', async t => {
  let fail = true;
  const f = fixture(t, { readSnapshot: async () => {
    if (fail) throw new Error('Synthetic initial failure');
    return initialSnapshot();
  } });
  await settle();
  assert.match(f.root.output(), /Synthetic initial failure/);
  assert.match(f.root.output(), /data-action="refresh"/);
  fail = false;
  f.root.action('refresh');
  await settle();
  assert.match(f.root.innerHTML, /id="model-form"/);
  assert.ok(!f.calls.includes('create-model'));
});
for (const mismatch of ['unconfigured', 'model', 'release', 'none']) test(`unknown Runtime ${mismatch} readback keeps the original target and never rebinds`, async t => {
  let snapshot = initialSnapshot(), models = [], writes = 0;
  const f = fixture(t, {
    readSnapshot: async () => snapshot,
    readModels: async () => ({ models }),
    createModel: async () => { models = [model()];
    return models[0]; },
    bindRuntime: async () => { writes++;
    throw new SetupRequestError('Synthetic binding lost', 0, true); },
  });
  await settle();
  f.root.input('model-key', 'synthetic-key');
  f.root.fire('submit');
  await settle();
  assert.equal(writes, 1);
  assert.match(f.root.output(), /is unconfirmed/);
  snapshot = { ...initialSnapshot(), runtime: { configured: true, modelRef: model().modelRef, agentImage: 'agent:fixture', model: { credentialAvailable: true } } };
  if (mismatch === 'unconfigured') snapshot.runtime.configured = false;
  if (mismatch === 'model') snapshot.runtime.modelRef = 'different-model';
  if (mismatch === 'release') snapshot.runtime.agentImage = 'different-release';
  f.root.action('refresh');
  await settle();
  assert.equal(writes, 1);
  assert.deepEqual(f.navigations, []);
  if (mismatch !== 'none') assert.match(f.root.output(), /is unconfirmed/);
  else assert.match(f.root.innerHTML, /id="preparation-answer"/);
});
test('a previous catalog member does not resolve a later unknown create with the same public identity', async t => {
  let models = [model('old-model')];
  const f = fixture(t, { readModels: async () => ({ models }) });
  await settle();
  f.root.action('add-model');
  f.root.input('model-key', 'synthetic-key');
  f.root.fire('submit');
  await settle();
  f.root.action('refresh');
  await settle();
  assert.match(f.root.output(), /is unconfirmed/);
  models = [...models, model('new-model')];
  f.root.action('refresh');
  await settle();
  assert.ok(f.notices.some(notice => /Continue to bind Runtime/.test(notice.message())));
  assert.ok(!f.calls.includes('bind-runtime'));
});
test('omitted display name resolves only the server default Model ID name', async t => {
  let models = [];
  const f = fixture(t, { readModels: async () => ({ models }) });
  await settle();
  f.root.input('model-name', '');
  f.root.input('model-key', 'synthetic-key');
  f.root.fire('submit');
  await settle();
  models = [model('default-name', { name: model().model })];
  f.root.action('refresh');
  await settle();
  assert.ok(f.notices.some(notice => /Continue to bind Runtime/.test(notice.message())));
});
for (const state of ['healthy', 'unknown', 'catalog-failed']) test(`${state} automatic observation selects only the required read path and never writes`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let snapshotReads = 0, modelReads = 0;
  const f = fixture(t, {
    readSnapshot: async () => { snapshotReads++;
    return initialSnapshot(); },
    readModels: async () => {
      modelReads++;
      if (state === 'catalog-failed') throw new Error('Synthetic catalog failure');
      return { models: [] };
    },
  });
  await settle();
  if (state === 'unknown') {
    f.root.input('model-key', 'synthetic-key');
    f.root.fire('submit');
    await settle();
  }
  const beforeModels = modelReads, beforeSnapshots = snapshotReads;
  t.mock.timers.tick(5000);
  await settle();
  assert.equal(snapshotReads, beforeSnapshots + 1);
  assert.equal(modelReads, beforeModels + (state === 'healthy' ? 0 : 1));
  assert.equal(f.calls.filter(call => call === 'create-model').length, state === 'unknown' ? 1 : 0);
  assert.ok(!f.calls.includes('bind-runtime'));
});
test('disposed scheduled observation does not start another request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const f = fixture(t);
  await settle();
  const before = f.calls.length;
  f.setup.dispose();
  t.mock.timers.tick(60000);
  await settle();
  assert.equal(f.calls.length, before);
});
test('repeated failed reads keep one unknown explanation and do not replace the recovery container', async t => {
  let fail = false;
  const f = fixture(t, { readSnapshot: async () => {
    if (fail) throw new Error('Synthetic repeating read failure');
    return initialSnapshot();
  } });
  await settle();
  f.root.input('model-key', 'synthetic-key');
  f.root.fire('submit');
  await settle();
  const node = f.root.nodes.get('#setup-notice');
  let markup = node.innerHTML, writes = 0;
  Object.defineProperty(node, 'innerHTML', { get: () => markup, set: value => { markup = value;
  writes++; } });
  fail = true;
  f.root.action('refresh');
  await settle();
  const originalWrites = writes;
  f.root.action('refresh');
  await settle();
  assert.equal(writes, originalWrites);
  assert.equal((markup.match(/is unconfirmed/g) || []).length, 1);
  assert.equal((markup.match(/Review saved models/g) || []).length, 1);
});
for (const guard of ['reading', 'writing', 'unknown']) test(`Test does not start while ${guard} owns admission`, async t => {
  const gate = deferred();
  const f = fixture(t, guard === 'reading' ? { readSnapshot: () => gate.promise } : guard === 'writing' ? { createModel: () => gate.promise } : {});
  if (guard !== 'reading') {
    await settle();
    f.root.input('model-key', 'synthetic-key');
    f.root.fire('submit');
    await settle();
  }
  f.root.modelAction('test');
  await settle();
  assert.ok(!f.calls.includes('test-model'));
  f.setup.dispose();
  gate.resolve(initialSnapshot());
});
test('a legitimate optional Test in flight does not gate Save and continue', async t => {
  const probe = deferred();
  const f = fixture(t, { testModel: () => probe.promise });
  await settle();
  f.root.input('model-key', 'synthetic-key');
  f.root.modelAction('test');
  await settle();
  f.root.fire('submit');
  await settle();
  assert.equal(f.calls.filter(call => call === 'create-model').length, 1);
  probe.resolve({ success: true, category: 'success', testMessage: 'Reply with OK.', replyText: 'OK', replyTruncated: false });
  await settle();
});
test('a definite write rejection survives read failure and recovery without being retried', async t => {
  let fail = false, writes = 0;
  const f = fixture(t, {
    readSnapshot: async () => {
      if (fail) throw new Error('Synthetic read failure');
      return initialSnapshot();
    },
    createModel: async () => { writes++;
    throw new SetupRequestError('Synthetic write rejection', 400, false); },
  });
  await settle();
  f.root.input('model-key', 'synthetic-key');
  f.root.fire('submit');
  await settle();
  assert.match(f.root.output(), /Synthetic write rejection/);
  fail = true;
  f.root.action('refresh');
  await settle();
  assert.match(f.root.output(), /Synthetic write rejection/);
  assert.match(f.root.output(), /Synthetic read failure/);
  fail = false;
  f.root.action('refresh');
  await settle();
  assert.match(f.root.output(), /Synthetic write rejection/);
  assert.doesNotMatch(f.root.output(), /Synthetic read failure/);
  assert.equal(writes, 1);
});
test('already-ready preparation only observes lightweight snapshots and never invents automatic entry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let snapshots = 0, catalogs = 0;
  const f = fixture(t, {
    readSnapshot: async () => {
      snapshots++;
      return { ...initialSnapshot(), runtime: { configured: true, modelRef: model().modelRef, agentImage: 'agent:fixture', model: { credentialAvailable: true } },
        status: { ready: true }, preparation: { ready: true, components: Object.fromEntries(['docker','agent','packageHelper','defaultContext','fileHelper','snapshotHelper'].map(name => [name, { state: 'ready' }])) } };
    },
    readModels: async () => { catalogs++;
    return { models: [model()] }; },
  }, { preparation: true });
  await settle();
  assert.match(f.root.innerHTML, /id="preparation-answer"/);
  t.mock.timers.tick(5000);
  await settle();
  assert.equal(snapshots, 2);
  assert.equal(catalogs, 1);
  assert.deepEqual(f.navigations, []);
});
test('late old catalog response cannot change the remounted form or clear its new Key', async t => {
  const catalog = deferred();
  const f = fixture(t, { readModels: () => catalog.promise });
  await settle();
  f.setup.dispose();
  const replacement = mountQuickSetup(f.root, {
    csrf: () => 'synthetic-csrf', current: () => true, expired: () => {}, navigate: () => {},
    dirty: () => {}, step: () => {}, preparation: false,
    port: { readSnapshot: async () => initialSnapshot(), readModels: async () => ({ models: [] }),
      createModel: async () => { throw new Error('Unexpected write'); }, bindRuntime: async () => { throw new Error('Unexpected bind'); }, testModel: async () => { throw new Error('Unexpected Test'); } },
  });
  t.after(() => replacement.dispose());
  await settle();
  f.root.input('model-key', 'synthetic-new-key');
  const markup = f.root.innerHTML;
  catalog.resolve({ models: [model('old-response')] });
  await settle();
  assert.equal(f.root.innerHTML, markup);
  assert.equal(f.root.values['model-key'], 'synthetic-new-key');
});

test('a confirmed original first-setup intent enters only after its new complete readiness read', async t => {
  let bound = false;
  const readyRead = deferred();
  const writes = [];
  const configured = { configured: true, modelRef: model().modelRef, agentImage: 'agent:fixture', model: { credentialAvailable: true } };
  const f = fixture(t, {
    readSnapshot: async () => bound ? readyRead.promise : initialSnapshot(),
    readModels: async () => ({ models: bound ? [model()] : [] }),
    createModel: async () => { writes.push('create');
    return model(); },
    bindRuntime: async ref => { writes.push(['bind', ref]);
    bound = true;
    return { runtime: configured, status: { ready: false } }; },
  });
  await settle();
  f.root.input('model-key', 'synthetic-key');
  f.root.fire('submit');
  await settle();
  assert.deepEqual(writes, ['create', ['bind', model().modelRef]]);
  assert.deepEqual(f.navigations, []);
  readyRead.resolve({ ...initialSnapshot(), runtime: configured, status: { ready: true }, preparation: { ready: true,
    components: Object.fromEntries(['docker', 'agent', 'packageHelper', 'defaultContext', 'fileHelper', 'snapshotHelper'].map(name => [name, { state: 'ready' }])) } });
  await settle();
  assert.deepEqual(f.navigations, ['/']);
  assert.deepEqual(writes, ['create', ['bind', model().modelRef]]);
});
