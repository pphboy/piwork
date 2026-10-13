import test from 'node:test';
import assert from 'node:assert/strict';

const moduleURL = new URL('../browser/control-rules.js', import.meta.url).href;
const { renameField, validLocalName, canSubmitName, canDismissLightModal, pointOutsideDialog, canCancelPiRequest, modalActionRelevant } = await import(moduleURL);

const renameCases: Array<[string, boolean, string, string]> = [
  ['/notes/report.txt', false, 'report.txt', 'report'],
  ['/目录/中文文件.md', false, '中文文件.md', '中文文件'],
  ['/目录/目录.名称', true, '目录.名称', '目录.名称'],
  ['/.env', false, '.env', '.env'],
  ['/.config.json', false, '.config.json', '.config'],
  ['/archive.tar.gz', false, 'archive.tar.gz', 'archive.tar'],
  ['/README', false, 'README', 'README'],
  ['/file.', false, 'file.', 'file'],
  ['/folder.with.dots/', true, 'folder.with.dots', 'folder.with.dots'],
  ['/100%25%2F%20.txt', false, '100%25%2F%20.txt', '100%25%2F%20'],
  ['/📚笔记.txt', false, '📚笔记.txt', '📚笔记'],
  ['/space name.txt', false, 'space name.txt', 'space name'],
  ['/  preserved.txt  ', false, '  preserved.txt  ', '  preserved'],
  ['relative.txt', false, 'relative.txt', 'relative'],
];
for (const [path, directory, value, selected] of renameCases) {
  test(`rename prefill and UTF-16 selection: ${path} (${directory ? 'directory' : 'file'})`, () => {
    const result = renameField(path, directory);
    assert.deepEqual(result, { value, selectionStart: 0, selectionEnd: selected.length });
    assert.equal(result.value.slice(result.selectionStart, result.selectionEnd), selected);
    assert.ok(result.selectionEnd > 0);
  });
}
test('empty basename is not synthesized or made valid', () => {
  for (const path of ['', '/', '////']) {
    const result = renameField(path, true);
    assert.deepEqual(result, { value: '', selectionStart: 0, selectionEnd: 0 });
    assert.equal(validLocalName(result.value), false);
  }
});

const validNames = ['folder', '中文', '.env', '.config.json', 'archive.tar.gz', 'README', '  trimmed name  ', '\ttrimmed\n',
  '100%25%2F%20', 'literal%00', 'literal%2e%2e', 'a:b*?"<>|', 'trailing.', '📚笔记', '...'];
const invalidNames = ['', ' ', '\t\n', '.', '..', ' . ', ' .. ', '/root', 'one/two', 'one\\two', 'a\0b', '\0',
  'a\nb', 'a\tb', 'a\rb', 'a\x1fb', 'a\x7fb'];
test('local name admission matches trimmed names and does not decode or impose platform-specific rules', () => {
  for (const name of validNames) assert.equal(validLocalName(name), true, JSON.stringify(name));
  for (const name of invalidNames) assert.equal(validLocalName(name), false, JSON.stringify(name));
  for (let code = 0; code <= 0x1f; code++)
    assert.equal(validLocalName(`a${String.fromCharCode(code)}b`), false, `control U+${code.toString(16)}`);
});

const nameContext = {
  modal: 'new-folder', transfer: '', targetId: 'form-name', key: 'Enter', keyCode: 13,
  composing: false, isComposing: false, name: 'New folder', enabled: true,
  busy: false, blocked: false, overwrite: false,
};
test('Enter is admitted only for the current naming field of New folder or Rename', () => {
  assert.equal(canSubmitName(nameContext), true);
  assert.equal(canSubmitName({ ...nameContext, modal: 'file-transfer', transfer: 'rename', name: '新名字.md' }), true);
  for (const name of validNames) assert.equal(canSubmitName({ ...nameContext, name }), true, JSON.stringify(name));
});

const nameDenials: Array<[string, Partial<typeof nameContext>]> = [
  ['composition tracking', { composing: true }],
  ['event isComposing', { isComposing: true }],
  ['legacy IME code 229', { keyCode: 229 }],
  ['IME Process key', { key: 'Process', keyCode: 229 }],
  ['non-Enter key', { key: 'Escape' }],
  ['composer field', { targetId: 'composer' }],
  ['another naming field', { targetId: 'create-name' }],
  ['no field', { targetId: '' }],
  ['missing/disabled primary button', { enabled: false }],
  ['pending action', { busy: true }],
  ['blocked or unknown action', { blocked: true }],
  ['overwrite confirmation', { overwrite: true }],
  ['no modal', { modal: '' }],
  ['New Work', { modal: 'new-work' }],
  ['file menu', { modal: 'file-menu' }],
  ['action name is not the rename modal', { modal: 'file-rename', transfer: 'rename' }],
  ['unspecified transfer', { modal: 'file-transfer', transfer: '' }],
  ['copy transfer', { modal: 'file-transfer', transfer: 'copy' }],
  ['move transfer', { modal: 'file-transfer', transfer: 'move' }],
  ['Delete', { modal: 'file-delete' }],
  ['upload overwrite', { modal: 'upload-overwrite' }],
  ['dirty file', { modal: 'dirty-file' }],
  ['Import', { modal: 'import' }],
  ['unknown future modal', { modal: 'future-dialog' }],
];
for (const [label, patch] of nameDenials) {
  test(`naming Enter rejects ${label}`, () => assert.equal(canSubmitName({ ...nameContext, ...patch }), false));
}
test('invalid names cannot qualify for Enter in either naming modal', () => {
  for (const name of invalidNames) {
    assert.equal(canSubmitName({ ...nameContext, name }), false, `folder ${JSON.stringify(name)}`);
    assert.equal(canSubmitName({ ...nameContext, modal: 'file-transfer', transfer: 'rename', name }), false, `rename ${JSON.stringify(name)}`);
  }
});
test('Rename independently rejects every IME, disabled, busy, blocked and overwrite guard', () => {
  const context = { ...nameContext, modal: 'file-transfer', transfer: 'rename' };
  for (const patch of [{ composing: true }, { isComposing: true }, { keyCode: 229 }, { enabled: false },
    { busy: true }, { blocked: true }, { overwrite: true }])
    assert.equal(canSubmitName({ ...context, ...patch }), false, JSON.stringify(patch));
});

const lightContext = { modal: 'work-menu', busy: false, dirty: false, unknown: false };
for (const modal of ['work-menu', 'service-menu', 'work-info']) {
  test(`${modal} is dismissible only when clean, idle and confirmed`, () => {
    assert.equal(canDismissLightModal({ ...lightContext, modal }), true);
    for (const patch of [{ busy: true }, { dirty: true }, { unknown: true }])
      assert.equal(canDismissLightModal({ ...lightContext, modal, ...patch }), false, JSON.stringify(patch));
  });
}
test('all other modal names stay excluded even when idle and clean', () => {
  for (const modal of ['', 'new-folder', 'file-transfer', 'file-delete', 'upload-overwrite', 'file-menu', 'new-work',
    'stop-work', 'delete-work', 'confirm-service-control', 'service-details', 'manage-services', 'dirty-file',
    'dirty-settings', 'inspect', 'import', 'export', 'operation', 'operations', 'chat-response-settings', 'future-menu'])
    assert.equal(canDismissLightModal({ ...lightContext, modal }), false, modal);
});

const rect = { left: 100, top: 200, right: 300, bottom: 400 };
test('only strictly outside points qualify; all edges and corners count inside', () => {
  for (const [x, y] of [[99, 300], [301, 300], [200, 199], [200, 401], [-10, -10], [400, 500], [99.999, 300]])
    assert.equal(pointOutsideDialog({ x, y }, rect), true, `${x},${y}`);
  for (const [x, y] of [[200, 300], [100, 300], [300, 300], [200, 200], [200, 400],
    [100, 200], [100, 400], [300, 200], [300, 400]])
    assert.equal(pointOutsideDialog({ x, y }, rect), false, `${x},${y}`);
});
test('non-finite coordinates and empty/reversed/non-finite rects never qualify', () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.equal(pointOutsideDialog({ x: invalid, y: 0 }, rect), false);
    assert.equal(pointOutsideDialog({ x: 0, y: invalid }, rect), false);
    for (const edge of ['left', 'top', 'right', 'bottom'])
      assert.equal(pointOutsideDialog({ x: 0, y: 0 }, { ...rect, [edge]: invalid }), false, edge);
  }
  for (const patch of [{ right: rect.left }, { right: rect.left - 1 }, { bottom: rect.top }, { bottom: rect.top - 1 }])
    assert.equal(pointOutsideDialog({ x: 0, y: 0 }, { ...rect, ...patch }), false, JSON.stringify(patch));
});
test('geometry can require both endpoints outside without treating a cross-boundary drag as dismissal', () => {
  const inside = { x: 200, y: 300 }, outside = { x: 20, y: 30 };
  for (const [down, up, expected] of [[outside, outside, true], [inside, outside, false],
    [outside, inside, false], [inside, inside, false]] as const)
    assert.equal(pointOutsideDialog(down, rect) && pointOutsideDialog(up, rect), expected);
});

test('Pi cancel only admits live active states, never cancelling, history or unknown state', () => {
  for (const state of ['pending', 'running', 'waiting_result', 'waiting_apply']) {
    assert.equal(canCancelPiRequest({ disposition: 'live', state }, true), true);
    assert.equal(canCancelPiRequest({ disposition: 'historical', state }, true), false);
    assert.equal(canCancelPiRequest({ disposition: 'live', state }, false), false);
  }
  for (const state of ['cancelling', 'completed', 'failed', 'cancelled', 'needs_attention', '', 'future-state'])
    assert.equal(canCancelPiRequest({ disposition: 'live', state }, true), false);
  assert.equal(canCancelPiRequest(undefined, true), false);
});
test('accepted cancellation remains one action while authoritative state is cancelling', () => {
  let posts = 0;
  const request = { disposition: 'live', state: 'running' };
  const click = () => { if (canCancelPiRequest(request, true)) { posts++; request.state = 'cancelling'; } };
  click(); click(); click(); assert.equal(posts, 1);
});
test('light modal eligibility retains original target unknown actions across routes', () => {
  const record = { work: 'work-a', view: '#/works' };
  assert.equal(modalActionRelevant(record, '#/work/work-a', 'work-a'), true);
  assert.equal(modalActionRelevant(record, '#/work/work-b', 'work-b'), false);
  assert.equal(modalActionRelevant(record, '#/works', 'work-b'), true);
  assert.equal(modalActionRelevant({ view: '#/works' }, '#/work/work-a', 'work-a'), false);
});
