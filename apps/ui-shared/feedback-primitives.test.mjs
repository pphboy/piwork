import assert from 'node:assert/strict';
import test from 'node:test';
import { pendingDots, sharedIcon } from './feedback-primitives.js';

test('Refresh is a shared single circular arrow at 18 CSS pixels even with a small request', () => {
  const icon = sharedIcon('refresh', 15);
  assert.match(icon, /width="18" height="18"/);
  assert.equal((icon.match(/<path /g) || []).length, 1);
  assert.doesNotMatch(icon, /M3 21v-6h6/);
});

test('Open enters a workspace rather than playing or opening an external window', () => {
  assert.match(sharedIcon('open-work'), /icon-open-work/);
  assert.equal(sharedIcon('external'), undefined);
  assert.equal(sharedIcon('play'), undefined);
  assert.equal(sharedIcon('constructor'), undefined);
  assert.equal(sharedIcon('__proto__'), undefined);
  assert.notEqual(sharedIcon('open-work'), sharedIcon('refresh'));
});

test('fixed pending markup is decorative and contains exactly three dots', () => {
  assert.match(pendingDots(), /aria-hidden="true"/);
  assert.equal((pendingDots().match(/<i>/g) || []).length, 3);
});
