import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { ImageDrafts } = await import(new URL('../browser/images.js', import.meta.url).href);
if (!('createImageBitmap' in globalThis)) Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, writable: true, value: async () => ({ close() {} }) });
const png = await readFile(new URL('../../../../fixtures/chat-images/png.png', import.meta.url));
const image = () => new File([png], 'synthetic.png', { type: 'image/png' });
function bitmap() { return { close() {} } as ImageBitmap; }

test('image drafts: an identity clear discards a late validated image without resurrecting input', async t => {
  let resolve!: (value: ImageBitmap) => void;
  const delayed = new Promise<ImageBitmap>(done => { resolve = done; });
  t.mock.method(globalThis, 'createImageBitmap', () => delayed);
  const drafts = new ImageDrafts(() => {});
  const pending = drafts.add('one:session', [image()], () => true);
  for (let n = 0; n < 20 && !drafts.get('one:session').length; n++) await Promise.resolve();
  assert.equal(drafts.get('one:session')[0].reading, true);
  assert.throws(() => drafts.capture('one:session'), /checked/);
  drafts.clear();
  resolve(bitmap());
  await pending;
  assert.deepEqual(drafts.get('one:session'), []);
  assert.deepEqual(drafts.groups().flat(), []);
});

test('image drafts: consuming accepted original images preserves a newer draft selection', async t => {
  t.mock.method(globalThis, 'createImageBitmap', async () => bitmap());
  const drafts = new ImageDrafts(() => {});
  t.after(() => drafts.clear());
  await drafts.add('one:session', [image()], () => true);
  const original = drafts.capture('one:session');
  await drafts.add('one:session', [image()], () => true);
  const newer = drafts.get('one:session')[1];
  drafts.consume('one:session', original);
  assert.deepEqual(drafts.get('one:session'), [newer]);
});

test('image drafts: unsupported types and the fifth image remain local rejection with old images retained', async t => {
  t.mock.method(globalThis, 'createImageBitmap', async () => bitmap());
  const drafts = new ImageDrafts(() => {});
  t.after(() => drafts.clear());
  await drafts.add('one:session', [image(), image(), image(), image()], () => true);
  const original = [...drafts.get('one:session')];
  const errors = await drafts.add('one:session', [image(), new File(['x'], 'synthetic.svg', { type: 'image/svg+xml' })], () => true);
  assert.equal(errors.length, 2);
  assert.deepEqual(drafts.get('one:session'), original);
});
