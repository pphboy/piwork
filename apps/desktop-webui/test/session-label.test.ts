import assert from 'node:assert/strict';
import test from 'node:test';
import type { Session } from '../dist/browser/models.js';
const { sessionLabel } = await import(new URL('../browser/session-label.js', import.meta.url).href);

const session = (partial: Partial<Session> = {}): Session => ({
  id: 'stable-session', title: 'Session stable-session', messages: [], ...partial,
});

test('confirmed titles are shown exactly, including fallback-like text', () => {
  for (const titleSource of ['manual', 'auto'] as const) {
    assert.equal(sessionLabel(session({ titleSource, messages: [{ role: 'user', text: 'First question' }] }), 0), 'Session stable-session');
  }
});

test('an untitled Session uses its already loaded first user text', () => {
  assert.equal(sessionLabel(session({ titleSource: 'default', messages: [
    { role: 'assistant', text: 'Earlier metadata' },
    { role: 'user', text: '  Build a\nsmall   tracker  ' },
  ] }), 0), 'Build a small tracker');
  assert.equal(Array.from(sessionLabel(session({ messages: [{ role: 'user', text: '界'.repeat(200) }] }), 0)).length, 80);
});

test('empty or image-only Sessions use the current list position', () => {
  const first = session();
  const second = session({ id: 'other', title: 'Session other' });
  assert.equal(sessionLabel(first, 0), 'Session 1');
  assert.equal([second, first].map(sessionLabel)[1], 'Session 2');
  assert.equal(sessionLabel(first, -1), 'Session stable-session');
  assert.equal(sessionLabel(session({ messages: [
    { role: 'user', text: '' }, { role: 'user', text: 'A later turn' },
  ] }), 2), 'Session 3');
});
