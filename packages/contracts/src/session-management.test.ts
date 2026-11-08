import assert from 'node:assert/strict';
import test from 'node:test';
import { Check } from 'typebox/value';
import { DeleteSessionInputSchema, RenameSessionInputSchema, SessionManagementLookupSchema, SessionManagementStateSchema } from './session-management.js';

test('Session management contracts reject malformed writes and retain target identity', () => {
  assert.equal(Check(RenameSessionInputSchema, { operationKey: 'key', expectedRevision: 0, title: '阅读计划' }), true);
  assert.equal(Check(RenameSessionInputSchema, { operationKey: 'key', expectedRevision: -1, title: 'title' }), false);
  assert.equal(Check(RenameSessionInputSchema, { operationKey: 'key', expectedRevision: 0, title: '', credential: 'synthetic' }), false);
  assert.equal(Check(DeleteSessionInputSchema, { operationKey: 'key', expectedRevision: 2 }), true);
  const state = { workId: 'work-1', sessionId: 'session-1', title: 'Reading', titleSource: 'manual', revision: 1, manualLock: true, deletedAt: null, autoState: 'eligible' };
  assert.equal(Check(SessionManagementStateSchema, state), true);
  assert.equal(Check(SessionManagementLookupSchema, { operationKey: 'key', status: 'accepted', kind: 'rename', state }), true);
  assert.equal(Check(SessionManagementLookupSchema, { operationKey: 'key', status: 'accepted', kind: 'rename', state: { ...state, sessionId: '' } }), false);
});
