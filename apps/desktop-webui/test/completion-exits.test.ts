import assert from 'node:assert/strict';
import test from 'node:test';
const { workCompletionReady, serviceCompletionReady, importCanStart } = await import(new URL('../browser/completion-exits.js', import.meta.url).href);
const op = { workId: 'one', state: 'succeeded', kind: 'Import Work' };
const work = { id: 'one', status: 'Stopped', desired: 'stopped' };
test('Work completion needs exact Work, successful original Operation and real usability', () => {
  assert.equal(workCompletionReady(op, 'one', true), true);
  assert.equal(workCompletionReady(op, 'other', true), false);
  assert.equal(workCompletionReady(op, 'one', false), false);
  for (const state of ['accepted', 'running', 'failed', 'unknown', 'superseded']) assert.equal(workCompletionReady({ ...op, state }, 'one', true), false);
});
test('Service completion additionally requires enabled Ready and declared exact port', () => {
  const service = { enabled: true, observed: 'Ready', ports: [3000] };
  assert.equal(serviceCompletionReady(op, 'one', true, service, 3000), true);
  assert.equal(serviceCompletionReady(op, 'one', true, service, 3001), false);
  assert.equal(serviceCompletionReady(op, 'one', false, service, 3000), false);
  assert.equal(serviceCompletionReady(op, 'one', true, { ...service, enabled: false }, 3000), false);
  for (const observed of ['Starting', 'Failed', 'Unknown']) assert.equal(serviceCompletionReady(op, 'one', true, { ...service, observed }, 3000), false);
});
test('Import completion only allows one explicit Start for matching stopped Work', () => {
  assert.equal(importCanStart(op, work, 'start', false), true);
  assert.equal(importCanStart(op, work, 'start', true), false);
  for (const state of ['accepted', 'running', 'failed', 'unknown', 'superseded']) assert.equal(importCanStart({ ...op, state }, work, 'start', false), false);
  assert.equal(importCanStart({ ...op, workId: 'other' }, work, 'start', false), false);
  assert.equal(importCanStart({ ...op, kind: 'Create Work' }, work, 'start', false), false);
  assert.equal(importCanStart(op, { ...work, status: 'Ready', desired: 'running' }, 'stop', false), false);
  assert.equal(importCanStart(op, work, 'check', false), false);
});
