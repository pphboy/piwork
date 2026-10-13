import assert from 'node:assert/strict';
import test from 'node:test';
const { restoreSelection, parentDirectory, missingFileTarget } = await import(new URL('../browser/work-navigation.js', import.meta.url).href);
test('first Work visit defaults to Services without another Work selection', () => {
  assert.deepEqual(restoreSelection(), { area: 'Services', path: '/', file: '', service: '', port: 0, session: '' });
});
for (const area of ['Chat', 'Files', 'Services']) test(`restore ${area} with exact path file and per-Work context`, () => {
  const saved = { area, path: '/tree/中文', file: '/tree/中文/.env', service: 'service-a', port: 3001, session: 'session-a' };
  assert.deepEqual(restoreSelection(saved), saved); assert.notEqual(restoreSelection(saved), saved);
});
test('Settings and unknown areas are not restored as a workspace area', () => {
  for (const area of ['Settings', 'Future', '']) assert.equal(restoreSelection({ area }).area, 'Services');
});
test('missing directories walk to nearest parent, preserve literal percent text', () => {
  for (const [path, parent] of [['/tree/a', '/tree'], ['/tree/a/', '/tree'], ['/tree', '/'], ['/', '/'], ['/目录/%2F/file', '/目录/%2F']]) assert.equal(parentDirectory(path), parent);
});
test('only authoritative missing statuses permit path fallback', () => {
  for (const status of [404, 410]) assert.equal(missingFileTarget(status), true);
  for (const status of [undefined, 401, 403, 408, 429, 500, 503]) assert.equal(missingFileTarget(status), false);
});
