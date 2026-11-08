import assert from 'node:assert/strict';
import test from 'node:test';
import { startupShell } from './startup-shell.js';

const base = { logoUrl: '/setup/piwork-logo.png', message: 'Opening Piwork…' };

test('normal startup has one labelled wait, reserved logo size and no recovery actions', () => {
  const html = startupShell({ ...base, retry: { label: 'Retry', action: 'refresh' } });
  assert.match(html, /role="status" aria-busy="true"/);
  assert.match(html, /alt="" width="48" height="48"/);
  assert.equal((html.match(/class="pending-dots"/g) || []).length, 1);
  assert.doesNotMatch(html, /<button|<a /);
});

test('unconfirmed startup escapes the original error and action descriptors', () => {
  const html = startupShell({ ...base, pending: false, error: '<script>bad</script>',
    retry: { label: '<Retry>', action: 'read"now' }, home: { label: 'Home', href: '/?a=1&b=2' } });
  assert.match(html, /aria-busy="false"/);
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(html, /data-action="read&quot;now"/);
  assert.match(html, /&lt;Retry&gt;/);
  assert.match(html, /href="\/\?a=1&amp;b=2"/);
  assert.doesNotMatch(html, /<script>/);
});

test('cold HTML provides native recovery without depending on executable modules', () => {
  const html = startupShell({ ...base, cold: true,
    retry: { label: '重新加载 / Reload', action: '' }, home: { label: '返回首页 / Home', href: '/' } });
  assert.match(html, /data-static-startup/);
  assert.match(html, /<form method="get" data-boot-recovery-form>/);
  assert.match(html, /<!-- PIWORK_BOOT_RECOVERY -->/);
  assert.match(html, /type="submit"[^>]*data-boot-recovery/);
  assert.match(html, /data-boot-error/);
  assert.doesNotMatch(html, /\shidden(?:[=> ]|$)|onclick|<script>/);
});
