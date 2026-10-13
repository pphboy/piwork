import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
const { DesktopAdapter } = await import(new URL('../browser/adapter.js', import.meta.url).href);
const app = readFileSync(new URL('../browser/app.js', import.meta.url), 'utf8');
// Execute the production modal renderer, not a duplicate observation projection.
const helpers = app.slice(app.indexOf('const esc ='), app.indexOf('let view ='));
const modal = app.slice(app.indexOf('function modalMarkup()'), app.indexOf('function importExitButtons('));
const phase = app.slice(app.indexOf('const phase ='), app.indexOf('\n', app.indexOf('const phase =')));
const importName = app.match(/^function importNameFeedback\([\s\S]*?^}/m)?.[0];
assert.ok(importName, 'production import name projection exists');
const renderOperation = new Function('adapter', 'id', `${helpers}\n${importName}\n${phase}\nconst view={modal:'operation',data:{id},modalError:''};const route=()=>[];const current=()=>undefined;${modal};return modalMarkup();`);
const id = 'original-operation';
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function fixture(t: TestContext, status: number) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const calls: Array<{ method: string; path: string }> = [];
  t.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const path = String(input).replace('/_desktop/api/', '');
    calls.push({ method: init?.method ?? 'GET', path });
    const session = path === 'session';
    return new Response(JSON.stringify(session ? { state: 'authenticated', csrf: 'synthetic', generation: 1, coreUrl: 'https://core.test', user: { account: 'owner', role: 'user' } } : { message: `Synthetic ${status}` }), { status: session ? 200 : status });
  });
  const adapter = new DesktopAdapter(); adapter.state.signedIn = true;
  adapter.state.operations = [{ id, workId: '', kind: 'Apply configuration', state: 'running', phase: 'running', created: '', updated: '' }];
  t.after(() => adapter.clearIdentity());
  const advance = async (ms: number) => { t.mock.timers.tick(ms); await flush(); };
  return { adapter, calls, advance };
}
for (const status of [503, 401, 404, 410]) test(`DWUI-017 paused observation ${status} is reflected in original Operation controls`, async t => {
  const f = fixture(t, status); f.adapter.scheduleOperationPoll();
  for (const ms of status === 503 ? [2000, 1000, 2000, 5000] : [2000]) await f.advance(ms);
  const key = f.adapter.metadataKey(`operations/${id}`);
  assert.equal(f.adapter.metadata.paused(key), true);
  assert.equal(f.adapter.operationPaused(id), true);
  const markup = renderOperation(f.adapter, id);
  assert.match(markup, /data-action="resume-operation"/);
  assert.doesNotMatch(markup, /data-action="pause-operation"/);
  const before = f.calls.filter(r => r.path === `operations/${id}`).length;
  await f.advance(60000);
  assert.equal(f.calls.filter(r => r.path === `operations/${id}`).length, before);
  assert.ok(f.calls.every(r => r.method === 'GET'));
});
test('DWUI-017 a scheduled backoff is not an exhausted pause and manual pause survives visibility', async t => {
  const f = fixture(t, 503); f.adapter.scheduleOperationPoll(); await f.advance(2000);
  assert.equal(f.adapter.operationPaused(id), false);
  assert.match(renderOperation(f.adapter, id), /data-action="pause-operation"/);
  f.adapter.pauseOperation(id); f.adapter.observePage('', false); f.adapter.observePage('', true);
  assert.equal(f.adapter.operationPaused(id), true);
  assert.match(renderOperation(f.adapter, id), /data-action="resume-operation"/);
  await f.advance(60000); assert.equal(f.calls.filter(r => r.path === `operations/${id}`).length, 1);
  assert.ok(f.calls.every(r => r.method === 'GET'));
});
for (const status of [404, 410]) test(`DWUI-017 failed Resume after ${status} remains paused and cannot restart infinite observation`, async t => {
  const f = fixture(t, status); f.adapter.scheduleOperationPoll(); await f.advance(2000);
  // The real app Resume handler awaits this explicit read before resumeOperation.
  await assert.rejects(f.adapter.checkOperation(id));
  assert.equal(f.adapter.operationPaused(id), true);
  await f.advance(60000);
  assert.equal(f.calls.filter(r => r.path === `operations/${id}`).length, 2);
  assert.ok(f.calls.every(r => r.method === 'GET'));
});
