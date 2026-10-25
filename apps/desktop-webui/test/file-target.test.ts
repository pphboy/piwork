import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const { pendingDots } = await import(new URL('../browser/pending.js', import.meta.url).href);

const source = readFileSync(new URL('../browser/app.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('const esc ='), source.indexOf('let view ='));
function extract(...names: string[]) {
  return names.map(name => {
    const match = source.match(new RegExp('^(?:async )?function ' + name + '\\([\\s\\S]*?^}', 'm'));
    assert.ok(match, `production function ${name}`); return match[0];
  }).join('\n');
}
function fixture() {
  const work: any = { id: 'work-a', name: 'A', services: [], files: [], resourceErrors: {} };
  const c: any = {
    pendingDots, filesRestoreNotice: '', fileActionsContext: '', fileSourceReturn: undefined,
    view: { tab: 'Files', path: '/output', file: '', fileStatus: 'idle', fileError: '', selected: [],
      fileDraft: '', fileOriginal: '', fileBaseline: '', fileEditable: false, fileReread: null,
      fileWriteUncertain: false, fileUnprotected: false, modal: '', data: {} },
    adapter: { identityEpoch: 1, directories: new Map(), state: { scenario: 'normal' } },
    current: () => work, location: { hash: '#/work/work-a/files/%2Foutput%2Fa.txt' }, TextEncoder,
  };
  c.dirty = () => c.view.file && c.view.fileDraft !== c.view.fileOriginal;
  c.fileReadPending = () => false;
  c.fileRefreshButton = () => '<button data-action="refresh-files"></button>';
  c.uploadProgressMarkup = () => '';
  c.transferResults = () => '';
  c.size = (n: number) => `${n} B`;
  vm.createContext(c); vm.runInContext(helpers, c);
  vm.runInContext(extract('files', 'fileTarget', 'fileTargetBackLink', 'imagePreview', 'downloadOnlyPreview', 'textEditor'), c);
  return { c, work };
}
function ready(c: any, work: any, file: any) {
  work.files = [file];
  c.view.file = file.path; c.view.fileStatus = 'ready';
}

test('a Files target shell reports loading without offering the wrong actions', () => {
  const { c, work } = fixture();
  c.view.file = '/output/a.txt'; c.view.fileStatus = 'loading';
  const html = c.files(work);
  assert.match(html, /Reading a\.txt/);
  assert.match(html, /read-placeholder/);
  assert.match(html, /Back to files/);
  assert.doesNotMatch(html, /id="file-editor"|Save file|Download file/);
});

test('missing, unavailable and failed targets keep the explicit path and offer Retry', () => {
  for (const [status, error, label] of [['missing', '', /File not found/], ['unavailable', 'The Work is not running. Start it to open its files.', /not running/], ['error', 'The file could not be read.', /could not be read/]] as const) {
    const { c, work } = fixture();
    c.view.file = '/output/a.txt'; c.view.fileStatus = status; c.view.fileError = error;
    const html = c.files(work);
    assert.match(html, label, status);
    assert.match(html, /\/output\/a\.txt/, status);
    assert.match(html, /data-action="retry-file-preview"/, status);
    assert.match(html, /data-action="close-file"/, status);
    assert.doesNotMatch(html, /id="file-editor"|class="file-image-preview"/, status);
  }
});

test('a ready text target keeps the editor, Save/Download semantics and Back to files', () => {
  const { c, work } = fixture();
  ready(c, work, { path: '/output/a.txt', name: 'a.txt', kind: 'file', size: 5, modified: 'now', preview: { kind: 'text', content: 'hello' } });
  c.view.fileDraft = 'hello'; c.view.fileOriginal = 'hello'; c.view.fileEditable = true; c.view.fileBaseline = 'now';
  const html = c.files(work);
  assert.match(html, /<textarea id="file-editor"/);
  assert.match(html, /Saved/);
  assert.match(html, /Download saved version/);
  assert.match(html, /Save file/);
  assert.match(html, /Back to files/);
});

test('an image target is a read-only preview with no Save or Saved claim', () => {
  const { c, work } = fixture();
  ready(c, work, { path: '/output/p.png', name: 'p.png', kind: 'file', size: 33, modified: 'now',
    preview: { kind: 'image', mimeType: 'image/png', url: 'blob:image-1', width: 120, height: 80 } });
  const html = c.files(work);
  assert.match(html, /<figure class="file-image-preview">/);
  assert.match(html, /<img src="blob:image-1" alt="p\.png"/);
  assert.match(html, /PNG image · 120×80 · 33 B/);
  assert.match(html, /Download file/);
  assert.match(html, /Read-only preview/);
  assert.doesNotMatch(html, /id="file-editor"|Save file|Saved|Unsaved/);
});

test('download-only and special targets explain the boundary and offer only a real exit', () => {
  for (const [preview, text, download] of [
    [{ kind: 'download-only', reason: 'binary' }, /not UTF-8 text/, true],
    [{ kind: 'download-only', reason: 'oversized' }, /preview limits/, true],
    [{ kind: 'download-only', reason: 'unsupported' }, /not a valid PNG, JPEG or WebP/, true],
    [{ kind: 'download-only', reason: 'document' }, /PDF, GIF and archive files are not previewed/, true],
  ] as const) {
    const { c, work } = fixture();
    ready(c, work, { path: '/output/f.bin', name: 'f.bin', kind: 'file', size: 99, modified: 'now', preview });
    const html = c.files(work);
    assert.match(html, text);
    if (download) assert.match(html, /Download file/);
    assert.doesNotMatch(html, /id="file-editor"/);
  }
  const { c, work } = fixture();
  ready(c, work, { path: '/output/link', name: 'link', kind: 'special', size: 0, modified: '' });
  const html = c.files(work);
  assert.match(html, /special filesystem item/);
  assert.doesNotMatch(html, /Download file|id="file-editor"/);
});

test('a request-detail source offers Back to request for its exact target only', () => {
  const { c, work } = fixture();
  ready(c, work, { path: '/output/a.txt', name: 'a.txt', kind: 'file', size: 1, modified: 'now', preview: { kind: 'text', content: 'x' } });
  c.view.fileEditable = true;
  c.fileSourceReturn = { epoch: 1, workId: 'work-a', path: '/output/a.txt', tab: 'Chat', modal: 'pi-request-detail', data: { requestId: 'r' }, scroll: 4 };
  assert.match(c.files(work), /data-action="back-to-file-source"/);
  c.fileSourceReturn.path = '/output/other.txt';
  assert.doesNotMatch(c.files(work), /data-action="back-to-file-source"/);
  c.fileSourceReturn.path = '/output/a.txt'; c.fileSourceReturn.epoch = 2;
  assert.doesNotMatch(c.files(work), /data-action="back-to-file-source"/);
});

test('preview layout stays inside the Files region at narrow widths', () => {
  const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.file-target-heading \{[^}]*min-width: 0/);
  assert.match(css, /\.file-image-preview img \{[^}]*max-width: 100%/);
  assert.match(css, /\.file-image-preview img \{ max-height: 55vh; \}/);
  assert.match(css, /\.file-image-preview \{ padding: 12px 8px; \}/);
});
