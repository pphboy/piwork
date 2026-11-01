import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
const moduleURL = process.env.PIWORK_CONSOLE_MODULE_DIR
  ? pathToFileURL(`${process.env.PIWORK_CONSOLE_MODULE_DIR}/model-management.js`)
  : new URL('../dist/browser/model-management.js', import.meta.url);
const { ModelManagement } = await import(moduleURL);

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes;
  reject = no; });
  return { promise, resolve, reject };
};
const draft = key => ({ name: 'Fixture', model: 'fixture', api: 'openai-responses', baseUrl: 'https://model.example.invalid/v1', key });
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(overrides = {}) {
  // The feature owns events; tests need no application state, source slicing or VM.
  globalThis.document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } };
  globalThis.confirm = () => true;
  const calls = [], notices = [];
  const port = {
    identityEpoch: 1,
    readModels: async () => ({ models: [] }),
    create: async input => { calls.push(['create', input]);
    return { id: 'model-fixture' }; },
    update: async () => { throw new Error('unexpected update'); },
    setEnabled: async () => { throw new Error('unexpected enable'); },
    remove: async () => { throw new Error('unexpected removal'); },
    chooseForFutureWork: async () => { throw new Error('unexpected default'); },
    test: async () => { throw new Error('unexpected test'); },
    ...overrides,
  };
  let manager;
  manager = new ModelManagement(() => manager.markup(), () => {}, () => false, undefined, notice => notices.push(notice), port);
  return { manager, port, calls, notices };
}
test('confirmed model save is visible before catalog read; read failure never repeats the write', async () => {
  const read = deferred();
  const { manager, calls, notices } = fixture({ readModels: () => read.promise });
  manager.draft = draft('synthetic-old-key');
  const save = manager.save();
  await tick();
  assert.equal(calls.length, 1);
  assert.ok(notices.some(notice => notice.tone === 'success'));
  assert.equal(manager.saving, true);
  read.reject(new Error('Synthetic catalog unavailable'));
  await save;
  assert.equal(calls.length, 1);
  assert.equal(manager.draft.key, '');
  assert.ok(notices.some(notice => notice.tone === 'unknown'));
  assert.match(manager.markup(), /owned-feedback/);
  manager.leave();
});
test('a late old save cannot clear a newly entered model key or release a new view', async () => {
  const mutation = deferred();
  const { manager } = fixture({ create: () => mutation.promise });
  manager.draft = draft('synthetic-old-key');
  const original = manager.draft;
  const save = manager.save();
  manager.leave();
  await manager.load('/models');
  manager.draft = draft('synthetic-new-key');
  mutation.resolve({ id: 'model-fixture' });
  await save;
  assert.equal(original.key, '');
  assert.equal(manager.draft.key, 'synthetic-new-key');
  manager.leave();
});
test('optional Test in flight does not gate a legal Save or invoke unrelated model actions', async () => {
  const probe = deferred();
  const { manager, calls } = fixture({ test: () => probe.promise });
  manager.draft = draft('synthetic-key');
  const testing = manager.test();
  assert.equal(manager.testing, true);
  await manager.save();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'create');
  probe.resolve({ success: true, category: 'success', testMessage: 'Reply with OK.', replyText: 'OK', replyTruncated: false });
  await testing;
  manager.leave();
});
test('unknown model write remains locked across navigation until explicit readback', async () => {
  const error = new Error('Synthetic acceptance unknown');
  // ConsoleError is the actual contract; no copied error classifier.
  const { ConsoleError } = await import(new URL('adapter.js', moduleURL));
  let creates = 0;
  const { manager } = fixture({ create: async () => { creates++;
  throw new ConsoleError('RESULT_UNKNOWN', error.message); } });
  manager.draft = draft('synthetic-key');
  await manager.save();
  assert.equal(manager.uncertain, true);
  manager.leave();
  await manager.load('/models');
  manager.draft = draft('synthetic-second-key');
  await manager.save();
  assert.equal(creates, 1);
  assert.equal(manager.uncertain, true);
  await manager.action('read');
  assert.equal(manager.uncertain, false);
  manager.leave();
});

test('Test details remove only the repeated localized stage prefix and keep recovery guidance', async () => {
  const { modelTestDetails } = await import(new URL('./model-form.js', moduleURL));
  const { chooseLocale, LocalizedMessage, t } = await import(new URL('./locale.js', moduleURL));
  for (const locale of ['en', 'zh-CN']) {
    chooseLocale(locale);
    const error = new LocalizedMessage('adapter.error.testUnconfirmed');
    const stage = t('modelForm.test.stage.error');
    const html = modelTestDetails({ target: { provider: 'Fixture', api: 'openai-responses', model: 'fixture' }, revision: 1, pending: false, error }, 1);
    assert.equal(html.split(stage).length - 1, 1);
    assert.ok(html.includes(String(error).slice(stage.length).trimStart()));
    const different = modelTestDetails({ target: { provider: 'Fixture', api: 'openai-responses', model: 'fixture' }, revision: 1, pending: false, error: 'Different safe guidance' }, 1);
    assert.ok(different.includes('Different safe guidance'));
  }
  chooseLocale('en');
});

for (const testState of ['not-run', 'failed', 'success']) {
  for (const action of ['enable', 'default']) {
    test(`optional Test ${testState} does not gate existing ${action === 'default' ? 'Choose for future Work' : 'Enable'}`, async () => {
      const mutationCalls = [];
      let testCalls = 0;
      const model = { id: 'model-fixture', modelRef: 'model-ref', name: 'Fixture', model: 'fixture', api: 'openai-responses', baseUrl: 'https://model.example.invalid/v1', enabled: action === 'default', credentialAvailable: true };
      const { manager } = fixture({
        readModels: async () => ({ models: [model] }),
        test: async () => {
          testCalls++;
          if (testState === 'failed') throw new Error('Synthetic optional Test failure');
          return { success: true, category: 'success', testMessage: 'Reply with OK.', replyText: 'OK', replyTruncated: false };
        },
        setEnabled: async (id, enabled) => mutationCalls.push(['enable', id, enabled]),
        chooseForFutureWork: async ref => mutationCalls.push(['default', ref]),
      });
      await manager.load('/models/model-fixture');
      if (testState !== 'not-run') await manager.test();
      assert.deepEqual(mutationCalls, []);
      const markup = manager.markup();
      const actionTag = markup.match(new RegExp(`<button[^>]*data-model-action="${action}"[^>]*>`))?.[0];
      assert.ok(actionTag);
      assert.doesNotMatch(actionTag, /\sdisabled(?:\s|>|=)/);
      await manager.action(action, model.id);
      assert.deepEqual(mutationCalls, action === 'default' ? [['default', model.modelRef]] : [['enable', model.id, true]]);
      assert.equal(testCalls, testState === 'not-run' ? 0 : 1);
      manager.leave();
    });
  }
}
