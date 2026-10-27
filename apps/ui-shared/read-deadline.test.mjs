import assert from 'node:assert/strict';
import test from 'node:test';
import { ReadTimeout, readWithDeadline } from './read-deadline.js';

test('a read starts under the identity that requested it', async () => {
  let identity = 'old';
  let observed;
  const read = readWithDeadline(() => { observed = identity; return Promise.resolve(); });
  identity = 'new';
  await read;
  assert.equal(observed, 'old');
});

test('a hanging read ends even when its implementation ignores abort', async () => {
  let signal;
  const result = readWithDeadline(s => { signal = s; return new Promise(() => {}); }, { timeoutMs: 10 });
  await assert.rejects(result, ReadTimeout);
  assert.equal(signal.aborted, true);
});

test('the deadline includes reading the response body', async () => {
  const result = readWithDeadline(async () => {
    const response = { json: () => new Promise(() => {}) };
    return response.json();
  }, { timeoutMs: 10 });
  await assert.rejects(result, ReadTimeout);
});

test('cancellation settles the old attempt without accepting a late result', async () => {
  const controller = new AbortController();
  let complete;
  const result = readWithDeadline(() => new Promise(resolve => { complete = resolve; }), { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
  complete('late');
  assert.equal(await readWithDeadline(async () => 'new'), 'new');
});
