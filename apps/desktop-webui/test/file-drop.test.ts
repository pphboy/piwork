import assert from 'node:assert/strict';
import test from 'node:test';
const { droppedFiles, sameFileDropTarget } = await import(new URL('../browser/file-drop.js', import.meta.url).href);

function item(file: File | null, isFile: boolean | undefined): DataTransferItem {
  return { kind: 'file', webkitGetAsEntry: () => isFile === undefined ? null : { isFile }, getAsFile: () => file } as DataTransferItem;
}

test('file drop accepts multiple ordinary files including an empty file', () => {
  const first = new File([], 'empty'), second = new File(['a'], 'a.txt');
  assert.deepEqual(droppedFiles([item(first, true)]), [first]);
  assert.deepEqual(droppedFiles([item(first, true), item(second, true)]), [first, second]);
});

test('file drop rejects the whole batch for directories or uncertain entries', () => {
  const file = new File([], 'file');
  for (const invalid of [item(file, false), item(file, undefined), item(null, true)])
    assert.equal(droppedFiles([item(file, true), invalid]), undefined);
  const unreadable = item(file, true);
  unreadable.getAsFile = () => { throw new Error('unreadable'); };
  assert.equal(droppedFiles([unreadable]), undefined);
  assert.equal(droppedFiles([{ kind: 'string' } as DataTransferItem]), undefined);
});

test('file drop target is bound to identity, work, view and directory', () => {
  const target = { epoch: 1, workId: 'one', directory: '/', view: 'files' };
  assert.equal(sameFileDropTarget(target, { ...target }), true);
  for (const changed of [{ epoch: 2 }, { workId: 'two' }, { directory: '/x' }, { view: 'chat' }])
    assert.equal(sameFileDropTarget(target, { ...target, ...changed }), false);
});
