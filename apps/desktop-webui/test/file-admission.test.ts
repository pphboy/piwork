import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
const { DesktopAdapter } = await import(new URL('../browser/adapter.js', import.meta.url).href);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-13T00:00:00Z') });
  const requests: Array<{ path: string; method: string }> = [];
  let handler = async (_path: string, _method: string): Promise<Response> => new Response(null, { status: 404 });
  t.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const path = String(input), method = init?.method ?? 'GET'; requests.push({ path, method });
    if (path === '/_desktop/api/works/one') return new Response(JSON.stringify({ id: 'one', name: 'one', observedState: 'ready', desiredState: 'running', controlVersion: 1 }));
    if (path === '/_desktop/api/works/one/stop') return new Response(JSON.stringify({ operationId: 'stop-one', workId: 'one' }));
    return handler(path, method);
  });
  const writes: string[] = [];
  let onPut = (_path: string) => { /* pure transport mock */ };
  class XHR {
    upload: Record<string, any> = {}; status = 204; responseText = ''; onload?: () => void; onerror?: () => void; onabort?: () => void; path = '';
    open(_method: string, path: string) { this.path = path; }
    setRequestHeader() {} getAllResponseHeaders() { return ''; }
    send() { writes.push(this.path); onPut(this.path); if (this.path.includes('unknown')) this.onerror?.(); else this.onload?.(); }
  }
  const original = (globalThis as any).XMLHttpRequest; (globalThis as any).XMLHttpRequest = XHR;
  t.after(() => { if (original) (globalThis as any).XMLHttpRequest = original; else delete (globalThis as any).XMLHttpRequest; });
  const adapter = new DesktopAdapter(); await adapter.refreshWorkStatus('one'); t.after(() => adapter.clearIdentity());
  return { adapter, requests, writes, respond: (next: typeof handler) => { handler = next; }, onPut: (fn: typeof onPut) => { onPut = fn; } };
}

test('file admission: picker returns after Stop acceptance without HEAD or PUT', async t => {
  const f = await fixture(t); await f.adapter.lifecycle('one', 'stop');
  const result = await f.adapter.upload('one', '/', [new File(['draft'], 'note.txt')]);
  assert.equal(f.requests.filter(r => r.method === 'HEAD').length, 0); assert.equal(f.writes.length, 0);
  assert.equal(result[0].notSubmitted, true); assert.equal(result[0].status, 'failed');
});

test('file admission: Stop accepted while HEAD waits prevents the following PUT', async t => {
  const f = await fixture(t), head = deferred<Response>(); f.respond(async () => head.promise);
  const upload = f.adapter.upload('one', '/', [new File(['draft'], 'note.txt')]);
  await f.adapter.lifecycle('one', 'stop'); head.resolve(new Response(null, { status: 404 }));
  const result = await upload; assert.equal(f.writes.length, 0); assert.equal(result[0].notSubmitted, true);
});

test('file admission: unknown A survives when Work becomes unusable before unsent B', async t => {
  const f = await fixture(t); f.onPut(() => { f.adapter.getWork('one').statusError = 'Work status is unconfirmed'; });
  const result = await f.adapter.upload('one', '/', [new File(['A'], 'unknown-a.txt'), new File(['B'], 'b.txt')]);
  assert.equal(f.writes.length, 1); assert.equal(f.requests.filter(r => r.method === 'HEAD').length, 1);
  assert.deepEqual(result.map((r: any) => [r.path, r.status, !!r.notSubmitted]), [['/unknown-a.txt', 'unknown', false], ['/b.txt', 'failed', true]]);
  assert.deepEqual(f.adapter.transfersByWork.get('one'), result); assert.deepEqual(f.adapter.state.transfers, result);
  assert.equal(f.adapter.uploadProgress.has('one'), false);
});

test('file admission: completed A survives when Stop blocks B at the next HEAD boundary', async t => {
  const f = await fixture(t); f.onPut(() => { f.adapter.getWork('one').desired = 'stopped'; });
  const result = await f.adapter.upload('one', '/', [new File(['A'], 'a.txt'), new File(['B'], 'b.txt')]);
  assert.equal(f.writes.length, 1); assert.equal(result[0].status, 'succeeded'); assert.equal(result[1].notSubmitted, true);
});

// A tiny, deterministic DOM protocol fixture for the browser-only DOMParser API.
// This keeps adapter/result tests socket-free; real browser XML parsing is covered
// by the integration suite. Only the test's fixed DAV/XML vocabulary is supported.
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
const multistatus = (rows: string) => `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:" xmlns:p="urn:piwork:files">${rows}</d:multistatus>`;
const davRow = (href: string, status: string, code = '') => `<d:response><d:href>${href}</d:href><d:status>HTTP/1.1 ${status}</d:status>${code ? `<d:error><p:code>${code}</p:code></d:error>` : ''}</d:response>`;

test('file results: real 207 shape preserves decoded paths, public reasons and mixed outcomes', async t => {
  const f = await fixture(t); installDavDOM(t);
  const base = '/_desktop/files/works/one/files/';
  f.respond(async () => new Response(multistatus(davRow(`${base}folder/a%20one.txt`, '204 No Content') + davRow(`${base}folder/b.txt`, '403 Forbidden', 'FILE_PERMISSION_DENIED') + davRow(`${base}folder/c.txt`, '503 Service Unavailable', 'FILE_BACKEND_UNAVAILABLE')), { status: 207 }));
  const rows = await f.adapter.transfer('one', 'delete', ['/folder']);
  assert.deepEqual(rows.map((row: any) => [row.path, row.status, row.httpStatus]), [['/folder/a one.txt', 'succeeded', 204], ['/folder/b.txt', 'failed', 403], ['/folder/c.txt', 'unknown', 503]]);
  assert.equal(rows[1].message, 'FILE_PERMISSION_DENIED'); assert.equal(rows[2].message, 'FILE_BACKEND_UNAVAILABLE');
  assert.deepEqual(f.adapter.transfersByWork.get('one'), rows);
});

for (const href of ['/_desktop/files/works/other/files/a', '/_desktop/files/works/one/files/%2e%2e/a', '/_desktop/files/works/one/files/a%2Fb', '/_desktop/files/works/one/files/%00a']) test(`file results: unsafe 207 href cannot be reported as success: ${href}`, async t => {
  const f = await fixture(t); installDavDOM(t);
  f.respond(async () => new Response(multistatus(davRow(href, '204 No Content')), { status: 207 }));
  const rows = await f.adapter.transfer('one', 'delete', ['/original']);
  assert.equal(rows.length, 1); assert.equal(rows[0].path, '/original'); assert.equal(rows[0].status, 'unknown');
});

for(const status of [408,500,502,503,504])test(`single-path HTTP ${status} write remains unknown and cannot be replayed`,async t=>{
 const f=await fixture(t);f.respond(async()=>new Response(JSON.stringify({message:'Upstream did not confirm'}),{status}));
 const rows=await f.adapter.transfer('one','delete',['/important']);assert.equal(rows[0].status,'unknown');assert.equal(rows[0].httpStatus,status);assert.match(rows[0].message,/unknown.*Refresh source and destination/);
 const {FileMutationResults,UnknownFileLocks}=await import(new URL('../browser/file-results.js',import.meta.url).href);
 const targets=[{source:'/important'}],ledger=new FileMutationResults(targets);ledger.record(targets,rows);assert.deepEqual(ledger.retryTargets(['/important']),[]);
 const locks=new UnknownFileLocks();for(const row of rows)if(row.status==='unknown')locks.add('one',targets[0]);assert.ok(locks.conflict('one',targets));assert.equal(f.requests.filter(r=>r.method==='DELETE').length,1);
});
for(const status of [403,409,412])test(`single-path definitive HTTP ${status} rejection remains failed`,async t=>{
 const f=await fixture(t);f.respond(async()=>new Response('{}',{status}));const rows=await f.adapter.transfer('one','delete',['/important']);assert.equal(rows[0].status,'failed');assert.equal(rows[0].httpStatus,status);
});
