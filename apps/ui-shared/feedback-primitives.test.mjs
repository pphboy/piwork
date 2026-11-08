import assert from 'node:assert/strict';
import test from 'node:test';
import { pendingDots, sharedIcon } from './feedback-primitives.js';

test('Refresh shares a circular pair of arrows at 18 CSS pixels in compact controls', () => {
  const icon = sharedIcon('refresh', 15);
  assert.match(icon, /width="18" height="18"/);
  assert.equal((icon.match(/<path /g) || []).length, 1);
  assert.match(icon, /M20 8a8 8/);
  assert.match(icon, /M4 16a8 8/);
});

test('Work identity and List/Grid choices have distinct shared semantics', () => {
  for (const name of ['work', 'view-list', 'view-grid']) {
    assert.match(sharedIcon(name, 18), /aria-hidden="true"/);
    assert.match(sharedIcon(name, 18), /width="18" height="18"/);
  }
  assert.notEqual(sharedIcon('work'), sharedIcon('view-grid'));
  assert.notEqual(sharedIcon('view-list'), sharedIcon('view-grid'));
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

test('Work navigation and composer use their dedicated approved glyphs without replacing global icons', () => {
  for (const name of ['nav-services', 'nav-files', 'nav-chat']) {
    const svg = sharedIcon(name, 14);
    assert.match(svg, /width="18" height="18"/);
    assert.match(svg, /stroke-width="1.75"/);
    assert.match(svg, /aria-hidden="true"/);
  }
  for (const name of ['composer-attachment', 'composer-expand', 'composer-collapse']) assert.match(sharedIcon(name, 15), /width="15" height="15"/);
  for (const name of ['grid', 'folder', 'chat']) assert.equal(sharedIcon(name), undefined);
  assert.match(sharedIcon('refresh'), /stroke-width="1.7"/);
});

test('Administration aliases preserve requested navigation and card sizes with scoped V14 strokes', () => {
  for (const name of ['admin-overview', 'admin-users', 'admin-setup', 'admin-models']) {
    assert.match(sharedIcon(name, 18), /width="18" height="18"/);
    assert.match(sharedIcon(name, 21), /width="21" height="21"/);
    assert.match(sharedIcon(name), /stroke-width="1.75"/);
    assert.match(sharedIcon(name), /stroke="currentColor"/);
    assert.match(sharedIcon(name), /aria-hidden="true"/);
  }
  assert.equal(sharedIcon('users'), undefined);
  assert.equal(sharedIcon('settings'), undefined);
});
