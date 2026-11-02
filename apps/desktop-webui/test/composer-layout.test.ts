import assert from 'node:assert/strict';
import test from 'node:test';
const { composerEditorGeometry } = await import(new URL('../browser/composer-layout.js', import.meta.url).href);

test('composer geometry matches compact and expanded reference without touching draft content', () => {
  assert.deepEqual(composerEditorGeometry(20, 900, false), { height: 42, overflow: 'hidden' });
  assert.deepEqual(composerEditorGeometry(100, 900, false), { height: 100, overflow: 'hidden' });
  assert.deepEqual(composerEditorGeometry(1000, 900, false), { height: 216, overflow: 'auto' });
  assert.deepEqual(composerEditorGeometry(20, 900, true), { height: 180, overflow: 'hidden' });
  assert.deepEqual(composerEditorGeometry(1000, 900, true), { height: 390, overflow: 'auto' });
  assert.deepEqual(composerEditorGeometry(1000, 506, true), { height: 233, overflow: 'auto' });
  assert.deepEqual(composerEditorGeometry(1000, 300, false), { height: 150, overflow: 'auto' });
});
