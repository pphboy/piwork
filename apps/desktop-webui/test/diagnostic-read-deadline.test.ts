import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
const { DesktopAdapter } = await import(new URL('../browser/adapter.js', import.meta.url).href);
const cleanup = { workId: 'work', serviceId: 'service', runId: 'run', createOperationId: 'original-create', state: 'failed', events: [] };
for (const source of ['logs', 'run-cleanup', 'service-cleanup'] as const) {
  for (const stall of ['headers', 'body'] as const) {
    test(`${source}: ${stall} deadline retains confirmed diagnostics and permits explicit GET retry`, async t => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
      let hang = false;
      const methods: string[] = [];
      const value = source === 'logs' ? { text: 'confirmed diagnostic' } : source === 'run-cleanup' ? { items: [cleanup] } : cleanup;
      t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
        methods.push(init?.method || 'GET');
        if (hang && stall === 'headers') return new Promise<Response>(() => {});
        if (hang) return new Response(new ReadableStream({ start() {} }));
        return Response.json(value);
      });
      const adapter = new DesktopAdapter();
      t.after(() => adapter.clearIdentity());
      const read = () => source === 'logs' ? adapter.readLogs('work', 'service')
        : adapter.loadTemporaryCleanups('work', source === 'run-cleanup' ? 'run' : 'service', source === 'run-cleanup' ? 'run' : 'service');
      const state = () => source === 'logs' ? adapter.serviceLogs('work', 'service')
        : adapter.temporaryCleanups.get(`work:${source === 'run-cleanup' ? 'run:run' : 'service:service'}`);
      await read();
      const prior = source === 'logs' ? adapter.logs.get('work:service') : state().items;
      const checkedAt = state().checkedAt;
      hang = true;
      const pending = read();
      const rejected = assert.rejects(pending, /timed out/i);
      await nextTurn();
      t.mock.timers.tick(10001);
      await rejected;
      assert.equal(state().loading, false);
      assert.equal(state().checkedAt, checkedAt);
      assert.equal(source === 'logs' ? adapter.logs.get('work:service') : state().items, prior);
      assert.match(String(state().error), /timed out/i);
      hang = false;
      await read();
      assert.equal(state().error, '');
      assert.deepEqual(methods, ['GET', 'GET', 'GET']);
    });
  }
}
