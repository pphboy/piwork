import assert from 'node:assert/strict';
import test from 'node:test';
const { ReadFeedbackEpisodes } = await import(new URL('../browser/read-feedback.js', import.meta.url).href);
const { WorkReadFeedback, workReadMatches } = await import(new URL('../browser/work-read-feedback.js', import.meta.url).href);
const { SettingsReadFeedback, settingsReadMatches } = await import(new URL('../browser/settings-read-feedback.js', import.meta.url).href);
const { ServiceReadFeedback, serviceReadMatches } = await import(new URL('../browser/service-read-feedback.js', import.meta.url).href);
const { NoticeStore } = await import(new URL('../browser/notices.js', import.meta.url).href);
const { LocalizedMessage, chooseLocale } = await import(new URL('../browser/locale.js', import.meta.url).href);
const owner = { identity: 'identity-one', object: 'work-one', task: 'configuration', generation: 0 };
const recovery = { label: () => 'Details', run: () => {} };
const facts = (changes = {}) => ({ owner, reading: false, error: 'Original read failed', confirmedVersion: 'old-read', ...changes });

test('a read failure has stable ownership and no repeated poll success or error spam', () => {
  const episodes = new ReadFeedbackEpisodes();
  const store = new NoticeStore();
  store.setIdentity(owner.identity);
  const first = episodes.observe(facts(), recovery);
  assert.equal(store.publish(first.event), true);
  for (let i = 0; i < 5; i++) assert.equal(store.publish(episodes.observe(facts(), recovery).event), false);
  assert.equal(store.items().length, 1);
  store.dismiss(store.items()[0].id);
  assert.equal(store.publish(episodes.observe(facts(), recovery).event), false);
  store.destroy();
});

test('clearing resourceErrors before a new read never resolves the failed original read', () => {
  const episodes = new ReadFeedbackEpisodes();
  episodes.observe(facts(), recovery);
  const reset = episodes.observe(facts({ error: '' }), recovery);
  assert.equal(reset.recovered, false);
  assert.equal(reset.event.message(), 'Original read failed');
  const pending = episodes.observe(facts({ error: '', reading: true }), recovery);
  assert.equal(pending.recovered, false);
  assert.equal(pending.event.tone, 'error');
});

test('fresh successful confirmation resolves silently; same failure can occur in a later episode', () => {
  const episodes = new ReadFeedbackEpisodes();
  const store = new NoticeStore();
  store.setIdentity(owner.identity);
  store.publish(episodes.observe(facts(), recovery).event);
  const result = episodes.observe(facts({ error: '', confirmedVersion: 'fresh-read' }), recovery);
  assert.equal(result.recovered, true);
  assert.equal(result.event, undefined);
  store.resolve(result.owner);
  assert.equal(store.items().length, 0);
  assert.equal(store.publish(episodes.observe(facts({ confirmedVersion: 'fresh-read' }), recovery).event), true);
  store.destroy();
});

test('loading ending with the same confirmed version never proves a successful reread', () => {
  const episodes = new ReadFeedbackEpisodes();
  episodes.observe(facts(), recovery);
  episodes.observe(facts({ reading: true }), recovery);
  const unchanged = episodes.observe(facts({ error: '' }), recovery);
  assert.equal(unchanged.recovered, false);
  assert.equal(unchanged.event.tone, 'error');
});

test('a failed retry cannot make a later error reset look like successful confirmation', () => {
  const episodes = new ReadFeedbackEpisodes();
  episodes.observe(facts(), recovery);
  episodes.observe(facts({ reading: true }), recovery);
  episodes.observe(facts(), recovery);
  const reset = episodes.observe(facts({ error: '' }), recovery);
  assert.equal(reset.recovered, false);
  assert.equal(reset.event.tone, 'error');
});

test('initial error followed by loading still requires a confirmed result', () => {
  const episodes = new ReadFeedbackEpisodes();
  episodes.observe(facts({ confirmedVersion: undefined }), recovery);
  episodes.observe(facts({ confirmedVersion: undefined, reading: true, error: '' }), recovery);
  assert.equal(episodes.observe(facts({ confirmedVersion: undefined, error: '' }), recovery).recovered, false);
});

test('fresh result reference proves cleanup read; same retained reference does not', () => {
  const episodes = new ReadFeedbackEpisodes();
  const oldItems: unknown[] = [];
  episodes.observe(facts({ confirmedVersion: oldItems }), recovery);
  assert.equal(episodes.observe(facts({ error: '', confirmedVersion: oldItems }), recovery).recovered, false);
  assert.equal(episodes.observe(facts({ error: '', confirmedVersion: [] }), recovery).recovered, true);
});

test('different Work, resource and identity cannot resolve another read', () => {
  const episodes = new ReadFeedbackEpisodes();
  episodes.observe(facts(), recovery);
  const other = episodes.observe(facts({ owner: { ...owner, object: 'other-work' }, error: '', confirmedVersion: 'fresh' }), recovery);
  assert.equal(other.recovered, false);
  assert.equal(episodes.observe(facts({ error: '' }), recovery).recovered, false);
  const changed = episodes.observe(facts({ owner: { ...owner, identity: 'identity-two' }, error: '' }), recovery);
  assert.equal(changed.event, undefined);
  assert.equal(changed.recovered, false);
});

test('retained client message reads the current locale, raw diagnostics are not retranslated', () => {
  chooseLocale('en');
  const episodes = new ReadFeedbackEpisodes();
  const result = episodes.observe(facts({ error: new LocalizedMessage('clipboard.unavailable', { value: 'original' }) }), recovery);
  assert.match(result.event.message(), /Clipboard/);
  chooseLocale('zh-CN');
  assert.match(result.event.message(), /剪贴板/);
  chooseLocale('en');
});

test('finite Work and Settings sources preserve their actual resource owner', () => {
  const work = new WorkReadFeedback();
  for (const source of ['works', 'status', 'services']) {
    const result = work.observe({ identity: owner.identity, workId: 'work-one', source, reading: false, error: 'failed' }, recovery);
    assert.equal(result.owner.object, source === 'works' ? 'works' : 'work-one');
    assert.equal(result.owner.task, `work-read:${source}`);
  }
  const settings = new SettingsReadFeedback();
  for (const source of ['configuration', 'packages', 'catalog-skills', 'catalog-packages']) {
    const result = settings.observe({ identity: owner.identity, workId: 'work-one', source, reading: false, error: 'failed' }, recovery);
    assert.equal(result.owner.object, source.startsWith('catalog-') ? 'core-catalog' : 'work-one');
  }
});

test('coalescing accepts matching read errors only, never mutation or unrelated resource failures', () => {
  const base = { kind: 'read', key: 'read', work: 'work-one', error: 'failed' };
  const work = { identity: owner.identity, workId: 'work-one', source: 'services', reading: false, error: 'failed' };
  assert.equal(workReadMatches({ ...base, action: 'retry-services' }, work), true);
  assert.equal(workReadMatches({ ...base, kind: 'service', action: 'retry-services' }, work), false);
  assert.equal(workReadMatches({ ...base, work: 'other', action: 'retry-services' }, work), false);
  const settings = { ...work, source: 'configuration' };
  assert.equal(settingsReadMatches({ ...base, action: 'refresh-config' }, settings), true);
  assert.equal(settingsReadMatches({ ...base, key: 'read:work-one:work-one:settings', action: 'settings', resource: 'work-one' }, settings), true);
  assert.equal(settingsReadMatches({ ...base, key: 'route:work-one:1', action: undefined }, settings), false);
  assert.equal(settingsReadMatches({ ...base, kind: 'configuration', action: 'save-config' }, settings), false);
  assert.equal(settingsReadMatches({ ...base, action: 'refresh-config', error: 'other failure' }, settings), false);
  assert.equal(settingsReadMatches({ ...base, action: 'refresh-config', error: 'old-language', errorMessage: () => 'failed' }, settings), true);
});

test('Service entry and cleanup use exact original Service/port or cleanup ref', () => {
  const service = new ServiceReadFeedback();
  const input = { identity: owner.identity, workId: 'work-one', serviceId: 'notes', port: 3000, source: 'entry', reading: false, error: 'failed' };
  const first = service.observe(input, recovery);
  const other = service.observe({ ...input, port: 4000 }, recovery);
  assert.notEqual(first.owner.task, other.owner.task);
  const record = { kind: 'read', key: 'entry', work: 'work-one', resource: 'service:notes:3000', action: 'retry-service-entry', error: 'failed' };
  assert.equal(serviceReadMatches(record, input), true);
  assert.equal(serviceReadMatches(record, { ...input, port: 4000 }), false);
  assert.equal(serviceReadMatches({ ...record, action: 'refresh-temporary-cleanups', resource: 'cleanup:service:notes' }, { ...input, source: 'cleanup' }), true);
});

test('fresh read attribution can retire its exact original read, never another resource or mutation', async () => {
  const { ReadFeedbackBindings } = await import(new URL('../browser/read-feedback.js', import.meta.url).href);
  const bindings = new ReadFeedbackBindings();
  const original = { kind: 'read', key: 'read:work-one:work-one:settings' };
  const mutation = { kind: 'configuration', blocked: true };
  bindings.bind(original, owner);
  bindings.bind(mutation, owner);
  assert.equal(bindings.has(mutation), false);
  assert.equal(mutation.blocked, true);
  assert.equal(bindings.matches(original, owner), true);
  for (const changed of [{ identity: 'another-identity' }, { object: 'another-work' }, { task: 'packages' }, { generation: 1 }]) assert.equal(bindings.matches(original, { ...owner, ...changed }), false);
  assert.equal(bindings.matches({ ...original }, owner), false);
});

test('Service preview uncertainty uses actual observation and needs a new successful probe receipt', () => {
  const service = new ServiceReadFeedback();
  const receipt = {};
  const input = { identity: owner.identity, workId: 'work-one', serviceId: 'notes', port: 3000, source: 'preview', reading: false, error: '', unconfirmed: true, confirmedVersion: receipt };
  const unknown = service.observe(input, recovery);
  assert.equal(unknown.event.tone, 'unknown');
  assert.match(unknown.event.message(), /Preview not confirmed/);
  const sourceCleared = service.observe({ ...input, unconfirmed: false }, recovery);
  assert.equal(sourceCleared.recovered, false);
  assert.equal(sourceCleared.event.tone, 'unknown');
  const fresh = service.observe({ ...input, unconfirmed: false, confirmedVersion: {} }, recovery);
  assert.equal(fresh.recovered, true);
  assert.equal(fresh.event, undefined);
});

test('Service entry failures coalesce only the exact selected entry request', () => {
  const input = { identity: owner.identity, workId: 'work-one', serviceId: 'notes', port: 3000, source: 'entry', reading: false, error: 'entry failed' };
  const record = { kind: 'read', key: 'service', work: 'work-one', resource: 'service:notes:3000', action: 'select-service', error: 'entry failed' };
  assert.equal(serviceReadMatches(record, input), true);
  assert.equal(serviceReadMatches({ ...record, action: 'open-controlled-service' }, input), true);
  assert.equal(serviceReadMatches({ ...record, action: 'tab-Services', resource: '/', sourceContext: 'entry:work-one:notes:3000' }, input), true);
  assert.equal(serviceReadMatches({ ...record, action: 'tab-Services', resource: '/', sourceContext: 'entry:work-one:notes:4000' }, input), false);
});

test('published read message remains the original snapshot even after the tracker resolves', () => {
  const episodes = new ReadFeedbackEpisodes();
  const first = episodes.observe(facts(), recovery);
  episodes.observe(facts({ error: '', reading: true }), recovery);
  assert.equal(first.event.message(), 'Original read failed');
  episodes.observe(facts({ error: '', confirmedVersion: 'fresh' }), recovery);
  assert.equal(first.event.message(), 'Original read failed');
});


test('a preview HTTP read failure is error, not business-result uncertainty', () => {
  const service = new ServiceReadFeedback();
  const result = service.observe({ identity: owner.identity, workId: 'work-one', serviceId: 'notes', port: 3000, source: 'preview', reading: false, error: 'HTTP 503 read failed', unconfirmed: true }, recovery);
  assert.equal(result.event.tone, 'error');
  assert.equal(result.event.message(), 'HTTP 503 read failed');
});


test('deferred read retirement revalidates only its original proof without consuming other owners', () => {
  const episodes = new ReadFeedbackEpisodes();
  episodes.observe(facts(), recovery);
  const first = episodes.observe(facts({ error: '', confirmedVersion: 'fresh' }), recovery);
  assert.equal(first.currentConfirmation(), true);
  episodes.observe(facts({ owner: { ...owner, task: 'other' } }), recovery);
  assert.equal(first.currentConfirmation(), true);
  episodes.observe(facts({ error: '', confirmedVersion: 'fresh', reading: true }), recovery);
  assert.equal(first.currentConfirmation(), false);
  episodes.observe(facts({ error: '', confirmedVersion: 'fresh' }), recovery);
  assert.equal(first.currentConfirmation(), false);
  episodes.observe(facts({ confirmedVersion: 'fresh', error: 'new failure' }), recovery);
  assert.equal(first.currentConfirmation(), false);
  const second = episodes.observe(facts({ error: '', confirmedVersion: 'fresh-again' }), recovery);
  assert.equal(second.currentConfirmation(), true);
  episodes.observe(facts({ owner: { ...owner, identity: 'changed-identity' }, error: '' }), recovery);
  assert.equal(second.currentConfirmation(), false);
});

test('confirmed Save readback recovery retires only the exact original refresh failure', async () => {
  const { SettingsSaveReadback } = await import(new URL('../browser/settings-read-feedback.js', import.meta.url).href);
  const { ActionState } = await import(new URL('../browser/action-state.js', import.meta.url).href);
  const actions = new ActionState();
  const record = actions.begin({ key: 'save', kind: 'configuration', action: 'save-config', work: 'one', label: 'Save', target: 'one' })!;
  actions.confirm(record, 'Saved');
  const tracker = new SettingsSaveReadback();
  const facts = { identity: 'identity-one', workId: 'one', source: 'configuration', reading: false, checkedAt: 'old' };
  tracker.bind(record, facts);
  await actions.refresh(record, async () => { throw new Error('503'); });
  assert.equal(tracker.observe(record, { ...facts, error: '503' }, actions.current(record)).owned, true);
  for (const changed of [facts, { ...facts, reading: true, checkedAt: 'new' }, { ...facts, error: '503', checkedAt: 'new' }, { ...facts, workId: 'two', checkedAt: 'new' }, { ...facts, identity: 'identity-two', checkedAt: 'new' }]) {
    assert.equal(tracker.observe(record, changed, actions.current(record)).recovered, false);
  }
  assert.equal(tracker.observe(record, { ...facts, checkedAt: 'new' }, false).recovered, false);
  record.blocked = true;
  assert.equal(tracker.observe(record, { ...facts, checkedAt: 'new' }, true).recovered, false);
  assert.equal(actions.retireConfirmedRefresh(record), false);
  record.blocked = false;
  assert.equal(tracker.observe(record, { ...facts, checkedAt: 'new' }, true).recovered, true);
  assert.equal(actions.retireConfirmedRefresh(record), true);
  assert.equal(record.refresh, '');
  assert.equal(record.refreshError, undefined);
  assert.equal(record.result, 'Saved');
  actions.clear();
});

test('Save readback binding cannot adopt unknown writes or replacement actions', async () => {
  const { SettingsSaveReadback } = await import(new URL('../browser/settings-read-feedback.js', import.meta.url).href);
  const { ActionState } = await import(new URL('../browser/action-state.js', import.meta.url).href);
  const actions = new ActionState();
  const intent = { key: 'save', kind: 'configuration', action: 'save-config', work: 'one', label: 'Save', target: 'one' };
  const original = actions.begin(intent)!;
  actions.confirm(original, 'Saved');
  const tracker = new SettingsSaveReadback();
  const facts = { identity: 'identity-one', workId: 'one', source: 'configuration', reading: false, checkedAt: 'old' };
  tracker.bind(original, facts);
  await actions.refresh(original, async () => { throw new Error('503'); });
  tracker.observe(original, { ...facts, error: '503' }, true);
  const newer = actions.begin(intent)!;
  assert.equal(actions.current(original), false);
  assert.equal(tracker.observe(original, { ...facts, checkedAt: 'new' }, actions.current(original)).recovered, false);
  assert.equal(actions.retireConfirmedRefresh(original), false);
  newer.blocked = true;
  newer.error = 'unknown write';
  tracker.bind(newer, facts);
  assert.equal(tracker.observe(newer, { ...facts, checkedAt: 'new' }, true).recovered, false);
  assert.equal(actions.retireConfirmedRefresh(newer), false);
  assert.equal(newer.blocked, true);
  assert.equal(newer.error, 'unknown write');
  actions.clear();
});

test('configuration read failure denies Apply without rewriting retained pending or active facts', async () => {
  const { configurationReadAllowsApply } = await import(new URL('../browser/settings-read-feedback.js', import.meta.url).href);
  for (const pendingApply of [true, false]) {
    const config = Object.freeze({ pendingApply, active: Object.freeze({ skills: ['original'] }) });
    assert.equal(configurationReadAllowsApply('503'), false);
    assert.equal(configurationReadAllowsApply(undefined), true);
    assert.equal(config.pendingApply, pendingApply);
    assert.deepEqual(config.active.skills, ['original']);
  }
});
