import assert from 'node:assert/strict';
import test from 'node:test';
const { fileReadFeedback, fileReadOwnsAction } = await import(new URL('../browser/file-read-feedback.js', import.meta.url).href);
const { NoticeStore } = await import(new URL('../browser/notices.js', import.meta.url).href);
const { LocalizedMessage, chooseLocale } = await import(new URL('../browser/locale.js', import.meta.url).href);
const directory = (state = {}) => ({ active: true, workId: 'work-original', path: '/folder', kind: 'directory', directory: { loading: false, ...state } });
const preview = (state = {}) => ({ active: true, workId: 'work-original', path: '/folder/file.txt', kind: 'preview', status: 'idle', ...state });
const recovery = { label: () => 'Retry original read', run: () => {} };
const project = (input: object) => fileReadFeedback(input, 'identity-original', recovery);

test('only the active original file target produces a projection', () => {
  assert.equal(project({ ...directory(), active: false }), undefined);
  assert.equal(project({ ...preview(), workId: '' }), undefined);
  assert.equal(project({ ...preview(), path: '' }), undefined);
  const result = project(directory({ error: 'Original directory read failed' }));
  assert.equal(result.owner.object, 'work-original');
  assert.equal(result.owner.task, 'files:directory:/folder');
  assert.equal(result.event.recovery, recovery);
  assert.equal(result.event.tone, 'error');
  assert.match(result.event.message(), /\/folder · Original directory read failed/);
});

test('a first directory read or retained pending refresh never claims recovery', () => {
  assert.equal(project(directory()).recovered, false);
  assert.equal(project(directory({ loading: true })).recovered, false);
  const pending = project(directory({ loading: true, checkedAt: 'original-confirmed', error: 'Read failed' }));
  assert.equal(pending.recovered, false);
  assert.equal(pending.event.tone, 'error');
  assert.equal(project(directory({ loading: true, checkedAt: 'original-confirmed' })).recovered, false);
  assert.equal(project(directory({ checkedAt: 'fresh-confirmed' })).recovered, true);
});

test('directory success silently retires a failure while dismissal alone does not replay it', () => {
  const store = new NoticeStore();
  store.setIdentity('identity-original');
  const failed = project(directory({ checkedAt: 'old', error: 'Read failed' }));
  assert.equal(store.publish(failed.event), true);
  const id = store.items()[0].id;
  store.dismiss(id);
  assert.equal(store.publish(failed.event), false);
  const pending = project(directory({ loading: true, checkedAt: 'old', error: 'Read failed' }));
  assert.equal(pending.recovered, false);
  assert.equal(store.publish(pending.event), false);
  const success = project(directory({ checkedAt: 'fresh' }));
  assert.equal(success.event, undefined);
  assert.equal(success.recovered, true);
  store.resolve(success.owner);
  assert.equal(store.items().length, 0);
  assert.equal(store.publish(failed.event), true);
  store.destroy();
});

test('preview error is status-owned; clearing text or retry loading is not recovery', () => {
  for (const status of ['missing', 'unavailable', 'error']) {
    const failed = project(preview({ status, error: 'Original preview read failed' }));
    assert.equal(failed.event.tone, 'error');
    assert.equal(failed.recovered, false);
  }
  assert.equal(project(preview({ status: 'loading', error: '' })).recovered, false);
  assert.equal(project(preview({ status: 'idle', error: '' })).recovered, false);
  const reread = project(preview({ status: 'ready', error: 'Earlier read error retained alongside a dirty draft' }));
  assert.equal(reread.event, undefined);
  assert.equal(reread.recovered, true);
});

test('exact read action coalesces while writes, review failures and other paths stay independent', () => {
  const result = project(directory({ error: 'Read failed' }));
  const read = { kind: 'read', work: 'work-original', resource: '/folder', action: 'refresh-files', error: 'Read failed' };
  assert.equal(fileReadOwnsAction(result, read), true);
  for (const change of [{ kind: 'files' }, { action: 'save-file' }, { work: 'other-work' }, { resource: '/other-path' }, { error: 'Another unknown-locked directory failed review' }, { error: '' }]) {
    assert.equal(fileReadOwnsAction(result, { ...read, ...change }), false);
  }
  assert.equal(fileReadOwnsAction(project(directory({ checkedAt: 'confirmed' })), read), false);
  const file = project(preview({ status: 'error', error: 'Read failed' }));
  assert.equal(fileReadOwnsAction(file, { ...read, resource: '/folder/file.txt', action: 'retry-file-preview' }), true);
  assert.equal(fileReadOwnsAction(file, { ...read, resource: '/folder/file.txt', action: 'file-path' }), false);
});

test('different Work, path, preview and identity cannot resolve the original directory failure', () => {
  const store = new NoticeStore();
  store.setIdentity('identity-original');
  const failed = project(directory({ error: 'Read failed' }));
  store.publish(failed.event);
  for (const input of [{ ...directory({ checkedAt: 'fresh' }), workId: 'other-work' }, { ...directory({ checkedAt: 'fresh' }), path: '/other-path' }, preview({ status: 'ready' })]) store.resolve(project(input).owner);
  assert.equal(store.items().length, 1);
  store.resolve({ ...failed.owner, identity: 'other-identity' });
  assert.equal(store.items().length, 1);
  store.setIdentity('other-identity');
  assert.equal(store.publish(failed.event), false);
  assert.equal(store.items().length, 0);
  store.destroy();
});

test('projection and dismissal do not mutate directory facts, file draft or unknown locks', () => {
  const state = Object.freeze({ loading: false, checkedAt: 'original-confirmed', error: 'Read failed' });
  const draft = Object.freeze({ text: 'original dirty draft', baseline: 'original version', blocked: true });
  const input = Object.freeze(directory(state));
  const store = new NoticeStore();
  store.setIdentity('identity-original');
  store.publish(project(input).event);
  store.dismiss(store.items()[0].id);
  assert.deepEqual(input.directory, state);
  assert.deepEqual(draft, { text: 'original dirty draft', baseline: 'original version', blocked: true });
  store.destroy();
});

test('retained preview error localizes at display time without a new failure event', () => {
  chooseLocale('en');
  const result = project(preview({ status: 'unavailable', error: new LocalizedMessage('fileRead.interrupted') }));
  const english = result.event.message();
  chooseLocale('zh-CN');
  assert.notEqual(result.event.message(), english);
  assert.match(result.event.message(), /\/folder\/file.txt/);
  chooseLocale('en');
});

test('a previously coalesced read cannot reappear as a generic failure after resource recovery', async () => {
  const { FileReadNoticeOwners } = await import(new URL('../browser/file-read-feedback.js', import.meta.url).href);
  const owners = new FileReadNoticeOwners();
  const record = { kind: 'read', work: 'work-original', resource: '/folder', action: 'file-path', error: 'Read failed' };
  const failed = project(directory({ error: 'Read failed' }));
  assert.equal(owners.owns(failed, record), true);
  const success = project(directory({ checkedAt: 'fresh-confirmation' }));
  assert.equal(success.recovered, true);
  assert.equal(owners.owns(success, record), true);
  assert.equal(owners.owns(undefined, record), true);
  assert.equal(record.error, 'Read failed');
  assert.equal(owners.owns(success, { ...record }), false);
  assert.equal(owners.owns(failed, { ...record, kind: 'files' }), false);
});

test('coalescing compares the current localized error rather than a frozen old-language message', () => {
  const result = project(directory({ error: 'Current localized error' }));
  assert.equal(fileReadOwnsAction(result, { kind: 'read', work: 'work-original', resource: '/folder', action: 'refresh-files', error: 'Old-language error', errorMessage: () => 'Current localized error' }), true);
});

test('first actual resource binding retires an already-published generic notice exactly once', async () => {
  const { FileReadNoticeOwners } = await import(new URL('../browser/file-read-feedback.js', import.meta.url).href);
  const store = new NoticeStore();
  store.setIdentity('identity-original');
  const owners = new FileReadNoticeOwners();
  const record = { kind: 'read', work: 'work-original', resource: '/folder', action: 'file-path', error: 'Read failed' };
  const generic = { identity: 'identity-original', object: 'work-original', task: 'read:work-original:/folder:file-path', generation: '1:7', key: 'error:', tone: 'error', message: () => 'Read failed' };
  store.publish(generic);
  assert.equal(owners.owns(undefined, record), false);
  const resource = project(directory({ error: 'Read failed' }));
  store.publish(resource.event);
  let retired = 0;
  for (let render = 0; render < 3; render++) {
    const alreadyOwned = owners.has(record);
    if (owners.owns(resource, record) && !alreadyOwned) {
      store.resolve(generic);
      retired++;
    }
  }
  assert.equal(retired, 1);
  assert.equal(store.items().length, 1);
  assert.equal(store.items()[0].task, resource.owner.task);
  assert.equal(record.error, 'Read failed');
  store.resolve(project(directory({ checkedAt: 'fresh' })).owner);
  assert.equal(store.items().length, 0);
  store.destroy();
});

test('only a freshly recovered exact attributed owner can retire its original read record', async () => {
  const { FileReadNoticeOwners } = await import(new URL('../browser/file-read-feedback.js', import.meta.url).href);
  const owners = new FileReadNoticeOwners();
  const record = { kind: 'read', work: 'work-original', resource: '/folder', action: 'file-path', error: 'Read failed' };
  const failed = project(directory({ error: 'Read failed' }));
  owners.owns(failed, record);
  const originalOwner = owners.get(record);
  assert.deepEqual(originalOwner, failed.owner);
  assert.ok(Object.isFrozen(originalOwner));
  assert.equal(owners.recoveredOwner(failed, record), undefined);
  assert.equal(owners.recoveredOwner(project(directory({ loading: true, checkedAt: 'prior-confirmed' })), record), undefined);
  const recovered = project(directory({ checkedAt: 'fresh-confirmed' }));
  assert.equal(owners.recoveredOwner(recovered, record), originalOwner);
  for (const change of [{ identity: 'another-identity' }, { object: 'another-work' }, { task: 'files:directory:/another-folder' }, { generation: 1 }]) {
    assert.equal(owners.recoveredOwner({ ...recovered, owner: { ...recovered.owner, ...change } }, record), undefined);
  }
  assert.equal(owners.recoveredOwner(recovered, { ...record }), undefined);
  assert.equal(owners.recoveredOwner(recovered, { ...record, kind: 'files' }), undefined);
  assert.equal(record.error, 'Read failed');
});

test('a later failure or selection cannot replace an already attributed owner identity', async () => {
  const { FileReadNoticeOwners } = await import(new URL('../browser/file-read-feedback.js', import.meta.url).href);
  const owners = new FileReadNoticeOwners();
  const record = { kind: 'read', work: 'work-original', resource: '/folder', action: 'file-path', error: 'Read failed' };
  const failed = project(directory({ error: 'Read failed' }));
  owners.owns(failed, record);
  const originalOwner = owners.get(record);
  owners.owns({ ...failed, owner: { ...failed.owner, identity: 'later-identity', generation: 99 } }, record);
  assert.equal(owners.get(record), originalOwner);
  assert.equal(owners.recoveredOwner(undefined, record), undefined);
  assert.equal(owners.recoveredOwner(project(preview({ status: 'ready' })), record), undefined);
});

test('actual ActionState retirement removes only the attributed read, never another path or an unknown write', async () => {
  const { FileReadNoticeOwners } = await import(new URL('../browser/file-read-feedback.js', import.meta.url).href);
  const { ActionState } = await import(new URL('../browser/action-state.js', import.meta.url).href);
  const actions = new ActionState();
  try {
    const record = actions.begin({ key: 'read-original', kind: 'read', work: 'work-original', resource: '/folder', action: 'file-path', label: 'Read folder', target: '/folder', anchor: '#original' });
    actions.fail(record, new Error('Read failed'));
    const mutation = actions.begin({ key: 'write-unknown', kind: 'files', work: 'work-original', resource: '/folder', action: 'save-file', label: 'Save', target: '/folder', anchor: '#write' });
    actions.fail(mutation, Object.assign(new Error('Write response lost'), { code: 'RESULT_UNKNOWN' }));
    const other = actions.begin({ key: 'read-other', kind: 'read', work: 'work-original', resource: '/other', action: 'file-path', label: 'Read another folder', target: '/other', anchor: '#other' });
    actions.fail(other, new Error('Another read failed'));
    const owners = new FileReadNoticeOwners();
    owners.owns(project(directory({ error: 'Read failed' })), record);
    const recovery = project(directory({ checkedAt: 'fresh' }));
    assert.ok(owners.recoveredOwner(recovery, record));
    actions.discardRead(record);
    assert.equal(actions.current(record), false);
    assert.equal(actions.current(other), true);
    assert.equal(actions.current(mutation), true);
    assert.equal(mutation.blocked, true);
    assert.equal(owners.recoveredOwner(recovery, other), undefined);
    assert.equal(owners.recoveredOwner(recovery, mutation), undefined);
  } finally {
    actions.clear();
  }
});

test('obsolete Files read ownership discards only its original read, never a newer record or unknown write', async t => {
  const { fileReadContextCurrent } = await import(new URL('../browser/file-read-feedback.js', import.meta.url).href);
  const { ActionState } = await import(new URL('../browser/action-state.js', import.meta.url).href);
  const actions = new ActionState();
  t.after(() => actions.clear());
  const original = { identity: 1, view: 'work:Files:/', choice: 3, path: '/other.txt' };
  const read = actions.begin({ key: 'old-read', kind: 'read', action: 'refresh-files', work: 'work', resource: '/other.txt', label: 'Refresh', target: 'Original file' });
  const write = actions.begin({ key: 'write', kind: 'files', work: 'work', resource: '/unknown.txt', label: 'Save', target: 'Unknown file' });
  actions.fail(write, Object.assign(new Error('Original unknown'), { code: 'RESULT_UNKNOWN' }));
  for (const changed of [{ identity: 2 }, { view: 'another view' }, { choice: 4 }, { path: '/note.txt' }]) {
    assert.equal(fileReadContextCurrent(original, { ...original, ...changed }), false);
  }
  if (!fileReadContextCurrent(original, { ...original, choice: 4, path: '/note.txt' })) actions.discardRead(read);
  actions.fail(read, Object.assign(new Error('Old listing discarded'), { code: 'CONNECTION_CHANGED' }));
  actions.finish(read);
  assert.equal(actions.current(read), false);
  assert.equal(read.error, undefined);
  assert.equal(read.checkedAt, undefined);
  assert.equal(write.blocked, true);
  const newer = actions.begin({ key: 'old-read', kind: 'read', action: 'refresh-files', work: 'work', resource: '/note.txt', label: 'Refresh', target: 'Current file' });
  actions.discardRead(read);
  assert.equal(actions.current(newer), true);
  assert.equal(newer.pending, true);
});

test('a real failure of the current original Files read stays actionable, even with CONNECTION_CHANGED code', async t => {
  const { fileReadContextCurrent } = await import(new URL('../browser/file-read-feedback.js', import.meta.url).href);
  const { ActionState } = await import(new URL('../browser/action-state.js', import.meta.url).href);
  const { actionNotice } = await import(new URL('../browser/feedback-notices.js', import.meta.url).href);
  const actions = new ActionState();
  t.after(() => actions.clear());
  const original = { identity: 1, view: 'work:Files:/', choice: 3, path: '/other.txt' };
  const read = actions.begin({ key: 'read', kind: 'read', work: 'work', resource: '/other.txt', label: 'Refresh', target: 'Original file' });
  assert.equal(fileReadContextCurrent(original, { ...original }), true);
  actions.fail(read, Object.assign(new Error('Current connection failed'), { code: 'CONNECTION_CHANGED' }));
  assert.equal(actionNotice(read, 'identity', () => actions.message(read)).tone, 'error');
  assert.match(read.error, /Current connection failed/);
});
