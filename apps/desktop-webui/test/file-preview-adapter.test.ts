import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

const { DesktopAdapter } = await import(new URL('../browser/adapter.js', import.meta.url).href);
const mtime1 = 'Sat, 03 Oct 2026 01:00:00 GMT';
const mtime2 = 'Sat, 03 Oct 2026 01:00:02 GMT';
const base = '/_desktop/files/works/one/files/';
const workPath = '/_desktop/api/works/one';

type Reply = { status?: number; body?: any; headers?: Record<string, string> };
type Handler = (path: string, method: string, init: RequestInit) => Reply | Promise<Reply> | undefined | Promise<Reply | undefined>;
function fileRow(href: string, size: number, modified: string, kind = 'file'): string {
  return `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype/>${kind === 'file' ? ''
    : `<p:kind>${kind}</p:kind>`}<d:getcontentlength>${size}</d:getcontentlength><d:getlastmodified>${modified}</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
}
const multistatus = (rows: string) => `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:" xmlns:p="urn:piwork:files">${rows}</d:multistatus>`;
const text = (body: string, modified = mtime1): Reply => ({ body, headers: { 'Last-Modified': modified } });
const stat = (path: string, size: number, modified = mtime1, kind = 'file'): Reply => ({ status: 207, body: multistatus(fileRow(`${base}${path.slice(1)}`, size, modified, kind)), headers: { 'Content-Type': 'application/xml' } });

function installDavDOM(t: TestContext) {
  class XmlNode {
    children: XmlNode[] = []; text = '';
    constructor(public namespaceURI = '', public localName = '') {}
    get textContent(): string { return this.text + this.children.map(node => node.textContent).join(''); }
    getElementsByTagNameNS(ns: string, name: string): XmlNode[] { return this.children.flatMap(node => [...(node.namespaceURI === ns && node.localName === name ? [node] : []), ...node.getElementsByTagNameNS(ns, name)]); }
    querySelector(name: string) { return name === 'parsererror' ? this.getElementsByTagNameNS('', name)[0] : undefined; }
  }
  class Parser {
    parseFromString(xml: string) {
      const root = new XmlNode(), stack = [root];
      for (const token of xml.match(/<[^>]*>|[^<]+/g) ?? []) {
        if (token.startsWith('<?')) continue;
        if (token.startsWith('</')) { stack.pop(); continue; }
        if (token.startsWith('<')) {
          const match = /^<(d|p):([a-z]+)\b/.exec(token); if (!match) throw new Error('Unexpected test XML vocabulary');
          const node = new XmlNode(match[1] === 'd' ? 'DAV:' : 'urn:piwork:files', match[2]); stack.at(-1)!.children.push(node);
          if (!token.endsWith('/>')) stack.push(node);
        } else stack.at(-1)!.text += token.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      }
      return root;
    }
  }
  const original = (globalThis as any).DOMParser; (globalThis as any).DOMParser = Parser;
  t.after(() => { if (original) (globalThis as any).DOMParser = original; else delete (globalThis as any).DOMParser; });
}

async function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-13T00:00:00Z') });
  installDavDOM(t);
  const requests: Array<{ path: string; method: string }> = [];
  let handler: Handler = () => undefined;
  let sessionState: 'authenticated' | 'signed-out' = 'authenticated';
  t.mock.method(globalThis, 'fetch', async (input: any, init: RequestInit = {}) => {
    const path = String(input), method = init.method ?? 'GET'; requests.push({ path, method });
    if (path === workPath) return new Response(JSON.stringify({ id: 'one', name: 'One', observedState: 'ready', desiredState: 'running', controlVersion: 1 }));
    if (path === '/_desktop/api/session') return new Response(JSON.stringify({ state: sessionState, generation: 1, csrf: 'test-csrf', coreUrl: 'https://core.example', user: { id: 'owner', account: 'owner', role: 'user' } }));
    const reply = await handler(path, method, init);
    if (!reply) return new Response(null, { status: 404 });
    return new Response(reply.body ?? null, { status: reply.status ?? 200, headers: reply.headers });
  });
  const objects: { created: string[]; revoked: string[]; closed: number; bitmapError?: Error } = { created: [], revoked: [], closed: 0 };
  const original = { create: (URL as any).createObjectURL, revoke: (URL as any).revokeObjectURL, bitmap: (globalThis as any).createImageBitmap };
  (URL as any).createObjectURL = () => { const url = `blob:fixture-${objects.created.length + 1}`; objects.created.push(url); return url; };
  (URL as any).revokeObjectURL = (url: string) => { objects.revoked.push(url); };
  (globalThis as any).createImageBitmap = async () => { if (objects.bitmapError) throw objects.bitmapError; return { width: 1, height: 1, close() { objects.closed++; } }; };
  t.after(() => {
    if (original.create) (URL as any).createObjectURL = original.create; else delete (URL as any).createObjectURL;
    if (original.revoke) (URL as any).revokeObjectURL = original.revoke; else delete (URL as any).revokeObjectURL;
    if (original.bitmap) (globalThis as any).createImageBitmap = original.bitmap; else delete (globalThis as any).createImageBitmap;
  });
  const adapter = new DesktopAdapter();
  await adapter.refreshWorkStatus('one');
  t.after(() => adapter.clearIdentity());
  return { adapter, requests, objects, respond: (next: Handler) => { handler = next; }, setSession: (state: 'authenticated' | 'signed-out') => { sessionState = state; } };
}
function seed(adapter: any, files: any[]) { adapter.getWork('one').files = files; }
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33), view = new DataView(bytes.buffer);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}
function jpeg(width: number, height: number): Uint8Array {
  // SOI, APP0 (16-byte payload), SOF0 (8-bit, height, width), EOI.
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Uint8Array(14), 0xff, 0xc0, 0x00, 0x11, 0x08,
    height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);
  return bytes;
}

test('adapter file preview: a fresh Depth 0 check wins over same size and mtime content cache', async t => {
  const f = await fixture(t);
  seed(f.adapter, [{ path: '/note.txt', name: 'note.txt', kind: 'file', size: 5, modified: mtime1,
    preview: { kind: 'text', content: 'old!!' } }]);
  f.respond((path, method) => method === 'PROPFIND' ? stat('/note.txt', 5, mtime1) : method === 'GET' ? text('new!!') : undefined);
  const fresh = await f.adapter.readFile('one', '/note.txt');
  assert.equal(fresh.preview.kind, 'text');
  assert.equal(fresh.preview.content, 'new!!');
  assert.equal(f.requests.filter(r => r.method === 'PROPFIND').length, 1);
  assert.equal(f.requests.filter(r => r.path.startsWith(base) && r.method === 'GET').length, 1);
  assert.equal(f.requests.find(r => r.method === 'PROPFIND')?.path, `${base}note.txt`);

  // An older binary conclusion is not a cache key either: the same path can be text now.
  seed(f.adapter, [{ path: '/note.txt', name: 'note.txt', kind: 'file', size: 5, modified: mtime1,
    preview: { kind: 'download-only', reason: 'binary' } }]);
  f.respond((_path, method) => method === 'PROPFIND' ? stat('/note.txt', 5, mtime1) : text('txt!!'));
  const again = await f.adapter.readFile('one', '/note.txt');
  assert.deepEqual(again.preview, { kind: 'text', content: 'txt!!' });
});

test('adapter file preview: deletion and rename drop the target and its preview', async t => {
  const f = await fixture(t);
  seed(f.adapter, [{ path: '/gone.txt', name: 'gone.txt', kind: 'file', size: 3, modified: mtime1, preview: { kind: 'text', content: 'old' } }]);
  f.respond((_path, method) => method === 'PROPFIND' ? { status: 404 } : undefined);
  await assert.rejects(f.adapter.readFile('one', '/gone.txt'), (error: any) => error.code === 'FILE_NOT_FOUND' && error.httpStatus === 404);
  assert.equal(f.adapter.getWork('one').files.some((file: any) => file.path === '/gone.txt'), false);
  assert.equal(f.requests.filter(r => r.path.startsWith(base) && r.method === 'GET').length, 0);
});

test('adapter file preview: definitive read failures keep the last preview and name the safe code', async t => {
  const f = await fixture(t);
  seed(f.adapter, [{ path: '/note.txt', name: 'note.txt', kind: 'file', size: 4, modified: mtime1, preview: { kind: 'text', content: 'kept' } }]);
  f.respond((_path, method) => method === 'PROPFIND' ? stat('/note.txt', 4) : { status: 503, headers: { 'X-Piwork-File-Error': 'FILE_BACKEND_UNAVAILABLE' } });
  await assert.rejects(f.adapter.readFile('one', '/note.txt'), (error: any) => error.code === 'FILE_BACKEND_UNAVAILABLE' && error.httpStatus === 503 && /FILE_BACKEND_UNAVAILABLE/.test(error.message));
  const file = f.adapter.getWork('one').files.find((item: any) => item.path === '/note.txt');
  assert.deepEqual(file.preview, { kind: 'text', content: 'kept' });
});

for (const [label, reply] of [['symlink', stat('/link', 0, mtime1, 'symlink')], ['special', stat('/link', 0, mtime1, 'special')]] as const)
  test(`adapter file preview: ${label} items are returned without a GET`, async t => {
    const f = await fixture(t);
    f.respond((_path, method) => method === 'PROPFIND' ? reply : undefined);
    const file = await f.adapter.readFile('one', '/link');
    assert.equal(file.kind, 'special');
    assert.equal(file.preview, undefined);
    assert.equal(f.requests.filter(r => r.path.startsWith(base) && r.method === 'GET').length, 0);
  });

test('adapter file preview: UTF-8 text budget is exactly 1 MiB and an oversized stream is cancelled', async t => {
  const f = await fixture(t), limit = 1_048_576;
  seed(f.adapter, [{ path: '/exact.txt', name: 'exact.txt', kind: 'file', size: limit, modified: mtime1 }]);
  f.respond((_path, method) => method === 'PROPFIND' ? stat('/exact.txt', limit) : text('a'.repeat(limit)));
  const exact = await f.adapter.readFile('one', '/exact.txt');
  assert.equal(exact.preview.kind, 'text');
  assert.equal(exact.preview.content.length, limit);

  let cancelled = false;
  const oversized = new ReadableStream({
    start(controller) {
      for (let sent = 0; sent < 2_000_000; sent += 65536) controller.enqueue(new Uint8Array(65536).fill(0x61));
      controller.close();
    },
    cancel() { cancelled = true; },
  });
  f.respond((_path, method) => method === 'PROPFIND' ? stat('/large.txt', 2_000_000) : { body: oversized });
  const file = await f.adapter.readFile('one', '/large.txt');
  assert.equal(file.preview?.kind, 'download-only');
  assert.equal(file.preview.reason, 'oversized');
  assert.equal(cancelled, true);
});

function webp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30), view = new DataView(bytes.buffer);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); view.setUint32(4, 22, true); bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12); view.setUint32(16, 10, true);
  bytes[24] = (width - 1) & 0xff; bytes[25] = ((width - 1) >> 8) & 0xff; bytes[26] = ((width - 1) >> 16) & 0xff;
  bytes[27] = (height - 1) & 0xff; bytes[28] = ((height - 1) >> 8) & 0xff; bytes[29] = ((height - 1) >> 16) & 0xff;
  return bytes;
}

test('adapter file preview: PNG is identified by content, bounded, decoded and replaceable', async t => {
  const f = await fixture(t), bytes = png(120, 80);
  seed(f.adapter, [{ path: '/picture.txt', name: 'picture.txt', kind: 'file', size: bytes.length, modified: mtime1 }]);
  f.respond((_path, method) => method === 'PROPFIND' ? stat('/picture.txt', bytes.length) : { body: bytes });
  const first = await f.adapter.readFile('one', '/picture.txt');
  assert.deepEqual({ kind: first.preview.kind, mime: first.preview.mimeType, width: first.preview.width, height: first.preview.height },
    { kind: 'image', mime: 'image/png', width: 120, height: 80 });
  assert.deepEqual(f.objects.created, ['blob:fixture-1']);
  assert.equal(f.objects.closed, 1);
  const second = await f.adapter.readFile('one', '/picture.txt');
  assert.equal(second.preview.url, 'blob:fixture-2');
  assert.deepEqual(f.objects.revoked, ['blob:fixture-1'], 'the previous confirmed preview is released');
});

test('adapter file preview: JPEG and WebP signatures are recognised, corrupt or over-budget images fall back', async t => {
  const f = await fixture(t), image = jpeg(300, 200), webpImage = webp(64, 32);
  const sizes: Record<string, number> = { '/a.jpg': image.length, '/wide.png': 33, '/pixels.png': 33, '/b.webp': webpImage.length };
  seed(f.adapter, [{ path: '/a.jpg', name: 'a.jpg', kind: 'file', size: image.length, modified: mtime1 },
    { path: '/wide.png', name: 'wide.png', kind: 'file', size: 33, modified: mtime1 },
    { path: '/pixels.png', name: 'pixels.png', kind: 'file', size: 33, modified: mtime1 },
    { path: '/b.webp', name: 'b.webp', kind: 'file', size: webpImage.length, modified: mtime1 }]);
  f.respond((path, method) => {
    const target = path.slice(base.length - 1);
    if (method === 'PROPFIND') return stat(target, sizes[target] ?? 0);
    if (target === '/wide.png') return { body: png(9000, 1) };
    if (target === '/pixels.png') return { body: png(8000, 6000) };
    if (target === '/b.webp') return { body: webpImage };
    return { body: image };
  });
  const photo = await f.adapter.readFile('one', '/a.jpg');
  assert.equal(photo.preview.kind, 'image');
  assert.equal(photo.preview.mimeType, 'image/jpeg');
  const animation = await f.adapter.readFile('one', '/b.webp');
  assert.deepEqual({ kind: animation.preview.kind, mime: animation.preview.mimeType, width: animation.preview.width, height: animation.preview.height },
    { kind: 'image', mime: 'image/webp', width: 64, height: 32 });
  const wide = await f.adapter.readFile('one', '/wide.png');
  assert.deepEqual(wide.preview, { kind: 'download-only', reason: 'oversized' });
  const pixels = await f.adapter.readFile('one', '/pixels.png');
  assert.deepEqual(pixels.preview, { kind: 'download-only', reason: 'oversized' });
  assert.equal(f.objects.created.length, 2, 'no object URL for a rejected image');

  seed(f.adapter, [{ path: '/broken.png', name: 'broken.png', kind: 'file', size: 10, modified: mtime1 }]);
  f.respond((_path, method) => method === 'PROPFIND' ? stat('/broken.png', 10) : { body: png(10, 10) });
  f.objects.bitmapError = new Error('cannot decode');
  const broken = await f.adapter.readFile('one', '/broken.png');
  assert.deepEqual(broken.preview, { kind: 'download-only', reason: 'unsupported' });
  assert.equal(f.objects.created.length, 2);
});

test('adapter file preview: a replaced read aborts, releases nothing stale and cannot overwrite the new target', async t => {
  const f = await fixture(t);
  let releaseA!: (value: Uint8Array) => void;
  let startedA!: () => void;
  const pending = new Promise<Uint8Array>(resolve => { releaseA = resolve; });
  const aStarted = new Promise<void>(resolve => { startedA = resolve; });
  const originalFetch = globalThis.fetch;
  let reads = 0;
  (globalThis as any).fetch = async (input: any, init: RequestInit = {}) => {
    const path = String(input);
    if (path === workPath) return new Response(JSON.stringify({ id: 'one', name: 'One', observedState: 'ready', desiredState: 'running', controlVersion: 1 }));
    if (init.method === 'PROPFIND') return new Response(stat(path.endsWith('a.txt') ? '/a.txt' : '/b.txt', 3).body, { status: 207 });
    if (path.endsWith('a.txt')) {
      reads++; startedA();
      return new Response(new ReadableStream({
        start(controller) {
          init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
          pending.then(bytes => { try { controller.enqueue(bytes); controller.close(); } catch { /* already aborted */ } });
        },
      }));
    }
    return new Response('bbb');
  };
  try {
    const older = f.adapter.readFile('one', '/a.txt').then((file: any) => ({ ok: true, file }), (error: any) => ({ ok: false, error }));
    await aStarted;
    const newer = await f.adapter.readFile('one', '/b.txt');
    releaseA(new Uint8Array([0x61, 0x61, 0x61]));
    const result: any = await older;
    assert.equal(result.ok, false);
    assert.equal(result.error.name, 'AbortError');
    assert.equal(reads, 1);
    const a = f.adapter.getWork('one').files.find((file: any) => file.path === '/a.txt');
    assert.equal(a.preview, undefined, 'a late response cannot publish into the old target');
    assert.deepEqual(newer.preview, { kind: 'text', content: 'bbb' });
  } finally { (globalThis as any).fetch = originalFetch; }
});

test('adapter file preview: an identity change aborts an in-flight read and revokes confirmed assets', async t => {
  const f = await fixture(t);
  let getStarted!: () => void;
  const getReady = new Promise<void>(resolve => { getStarted = resolve; });
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async (input: any, init: RequestInit = {}) => {
    const path = String(input);
    if (path === workPath) return new Response(JSON.stringify({ id: 'one', name: 'One', observedState: 'ready', desiredState: 'running', controlVersion: 1 }));
    if (init.method === 'PROPFIND') return new Response(stat('/slow.txt', 3).body, { status: 207 });
    getStarted();
    return new Response(new ReadableStream({
      start(controller) { init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError'))); },
    }));
  };
  try {
    const read = f.adapter.readFile('one', '/slow.txt').then(() => 'resolved', (error: any) => error.name);
    await getReady;
    (f.adapter as any).clearIdentity();
    assert.equal(await read, 'AbortError');
    assert.equal(f.adapter.getWork('one'), undefined);
  } finally { (globalThis as any).fetch = originalFetch; }
});

test('adapter file preview: identity changes and explicit release cancel reads and revoke object URLs', async t => {
  const f = await fixture(t), bytes = png(10, 10);
  seed(f.adapter, [{ path: '/img.png', name: 'img.png', kind: 'file', size: bytes.length, modified: mtime1 }]);
  f.respond((_path, method) => method === 'PROPFIND' ? stat('/img.png', bytes.length) : { body: bytes });
  await f.adapter.readFile('one', '/img.png');
  assert.equal(f.objects.created.length, 1);
  f.adapter.releaseFilePreview('one', '/img.png');
  assert.equal(f.adapter.getWork('one').files.find((file: any) => file.path === '/img.png').preview, undefined);
  assert.deepEqual(f.objects.revoked, ['blob:fixture-1']);
  f.adapter.stopFileReads();
  assert.deepEqual(f.objects.created, ['blob:fixture-1']);
});

for (const [name, bytes] of [
  ['/document.pdf', new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n')],
  ['/animation.gif', new TextEncoder().encode('GIF89a\x01\x00\x01\x00\x00\x00\x00;')],
  ['/archive.zip', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])],
] as const) test(`adapter file preview: ${name} stays a download even when its header is ASCII`, async t => {
  const f = await fixture(t);
  seed(f.adapter, [{ path: name, name: name.slice(1), kind: 'file', size: bytes.length, modified: mtime1 }]);
  f.respond((_path, method) => method === 'PROPFIND' ? stat(name, bytes.length) : { body: bytes });
  const file = await f.adapter.readFile('one', name);
  assert.deepEqual(file.preview, { kind: 'download-only', reason: 'document' });
});

test('adapter file preview: a stopped Work releases its preview and aborts a late read', async t => {
  const f = await fixture(t), bytes = png(10, 10);
  seed(f.adapter, [{ path: '/img.png', name: 'img.png', kind: 'file', size: bytes.length, modified: mtime1 }]);
  f.respond((_path, method) => method === 'PROPFIND' ? stat('/img.png', bytes.length) : { body: bytes });
  await f.adapter.readFile('one', '/img.png');
  assert.equal(f.objects.created.length, 1);
  // The same cleanup path mapWork uses when a Work no longer retains its workspace.
  (f.adapter as any).revokeWorkFilePreviews('one');
  assert.equal(f.adapter.getWork('one').files.find((file: any) => file.path === '/img.png').preview, undefined);
  assert.deepEqual(f.objects.revoked, ['blob:fixture-1']);
});


test('adapter file preview: a 401 triggers the existing session revocation and releases the preview', async t => {
  const f = await fixture(t), bytes = png(10, 10);
  seed(f.adapter, [{ path: '/img.png', name: 'img.png', kind: 'file', size: bytes.length, modified: mtime1 }]);
  f.respond((_path, method) => method === 'PROPFIND' ? stat('/img.png', bytes.length) : { body: bytes });
  await f.adapter.readFile('one', '/img.png');
  assert.equal(f.objects.created.length, 1);
  f.setSession('signed-out');
  f.respond((_path, method) => method === 'PROPFIND' ? { status: 401, headers: { 'X-Piwork-File-Error': 'AUTH_REQUIRED' } } : { body: bytes });
  await assert.rejects(f.adapter.readFile('one', '/img.png'), (error: any) => error.httpStatus === 401 && error.code === 'AUTH_REQUIRED');
  assert.equal(f.adapter.state.signedIn, false);
  assert.equal(f.adapter.state.scenario, 'auth-expired');
  assert.equal(f.adapter.getWork('one'), undefined);
  assert.deepEqual(f.objects.revoked, ['blob:fixture-1']);
});

test('adapter file preview: a 403 with a valid session stays local to the target', async t => {
  const f = await fixture(t);
  seed(f.adapter, [{ path: '/note.txt', name: 'note.txt', kind: 'file', size: 3, modified: mtime1, preview: { kind: 'text', content: 'old' } }]);
  f.respond((_path, method) => method === 'PROPFIND' ? stat('/note.txt', 3) : { status: 403, headers: { 'X-Piwork-File-Error': 'FILE_PERMISSION_DENIED' } });
  await assert.rejects(f.adapter.readFile('one', '/note.txt'), (error: any) => error.httpStatus === 403 && error.code === 'FILE_PERMISSION_DENIED');
  assert.equal(f.adapter.state.signedIn, true);
  assert.ok(f.adapter.getWork('one'));
  assert.deepEqual(f.adapter.getWork('one').files.find((file: any) => file.path === '/note.txt').preview, { kind: 'text', content: 'old' });
});
