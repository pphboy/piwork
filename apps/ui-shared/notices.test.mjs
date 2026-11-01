import test from 'node:test';
import assert from 'node:assert/strict';
import { NoticeStore } from './notices.js';

const event = (overrides = {}) => ({ identity: 'core:alice:1', key: 'unknown', object: 'work:a', task: 'save', generation: 1, tone: 'unknown', message: () => 'Unconfirmed', ...overrides });
function store() {
  const value = new NoticeStore();
  value.setIdentity('core:alice:1');
  return value;
}

test('deduplicates events, including dismissed events, without business callbacks', () => {
  const value = store();
  let writes = 0;
  const notice = event({ recovery: { label: () => 'Check', run: () => writes++ } });
  assert.equal(value.publish(notice), true);
  assert.equal(value.publish(notice), false);
  value.dismiss(value.items()[0].id);
  assert.equal(value.publish(notice), false);
  assert.equal(writes, 0);
  value.destroy();
});

test('unrelated success cannot replace unknown; matching task confirmation can', () => {
  const value = store();
  value.publish(event());
  value.publish(event({ key: 'saved', task: 'rename', tone: 'success' }));
  value.publish(event({ key: 'saved', object: 'work:b', tone: 'success' }));
  assert.equal(value.items().length, 3);
  assert.equal(value.items()[0].tone, 'unknown');
  value.publish(event({ key: 'checked', tone: 'success' }));
  assert.equal(value.items().length, 3);
  assert.equal(value.items().some(item => item.tone === 'unknown'), false);
  value.destroy();
});

test('language is evaluated at display time without republishing', () => {
  const value = store();
  let language = 'en';
  value.publish(event({ message: () => language === 'en' ? 'Unknown' : '未确认' }));
  language = 'zh';
  assert.equal(value.items()[0].message(), '未确认');
  assert.equal(value.items().length, 1);
  value.destroy();
});

test('errors and unknown never have expiration; success is at most three seconds', () => {
  const value = store();
  value.publish(event());
  value.publish(event({ key: 'failed', task: 'read', tone: 'error' }));
  value.publish(event({ key: 'saved', task: 'rename', tone: 'success' }));
  assert.equal(value.items()[0].expires, undefined);
  assert.equal(value.items()[1].expires, undefined);
  assert.ok(value.items()[2].expires <= Date.now() + 3000);
  value.destroy();
});

test('identity reset drops content and refuses late results', () => {
  const value = store();
  value.publish(event());
  value.setIdentity('core:bob:2');
  assert.equal(value.items().length, 0);
  assert.equal(value.publish(event()), false);
  value.destroy();
});

test('different task generations cannot confirm an old unknown', () => {
  const value = store();
  value.publish(event());
  value.publish(event({ key: 'saved', generation: 2, tone: 'success' }));
  assert.equal(value.items()[0].tone, 'unknown');
  value.destroy();
});

test('read recovery silently resolves only its exact owner and identity', () => {
  const value = store();
  value.publish(event());
  value.resolve({ ...event(), generation: 2 });
  value.resolve({ ...event(), identity: 'other' });
  assert.equal(value.items().length, 1);
  value.resolve(event());
  assert.equal(value.items().length, 0);
  value.destroy();
});

test('confirmed read recovery permits a later failure but dismissal does not', () => {
  const value = store();
  const read = event({ task: 'runtime-read', key: '503', tone: 'error' });
  value.publish(event());
  value.publish(read);
  value.dismiss(value.items().find(item => item.task === read.task).id);
  assert.equal(value.publish(read), false);
  value.resolve(read);
  assert.equal(value.publish(read), true);
  assert.equal(value.items().length, 2);
  assert.equal(value.items()[0].tone, 'unknown');
  value.resolve(read);
  assert.equal(value.items().length, 1);
  assert.equal(value.publish(read), true);
  value.destroy();
});

test('same task state transitions can recover without replaying unchanged or dismissed events', () => {
  const value = store();
  const confirmed = event({ key: 'confirmed', tone: 'success' });
  const refreshFailed = event({ key: 'refresh-failed', tone: 'error' });
  assert.equal(value.publish(confirmed), true);
  assert.equal(value.publish(confirmed), false);
  assert.equal(value.publish(refreshFailed), true);
  assert.equal(value.publish(confirmed), true);
  assert.equal(value.items().length, 1);
  assert.equal(value.items()[0].tone, 'success');
  value.dismiss(value.items()[0].id);
  assert.equal(value.publish(confirmed), false);
  value.destroy();
});

test('modal placement avoids measured header/footer at narrow, wide and scrolled viewport sizes', async () => {
  const { noticeModalPlacement } = await import('./notices.js');
  for (const facts of [
    { width: 455, height: 772, container: { left: 16, right: 439, top: 29.86, bottom: 741.96 }, headerBottom: 114.25, footerTop: 677.07 },
    { width: 390, height: 800, container: { left: 16, right: 374, top: 20, bottom: 780 }, headerBottom: 120, footerTop: 710 },
    { width: 1400, height: 900, container: { left: 410, right: 990, top: 200, bottom: 700 }, headerBottom: 285, footerTop: 630 },
    { width: 390, height: 500, viewportTop: 100, container: { left: 16, right: 374, top: 20, bottom: 780 }, headerBottom: 70, footerTop: 710 },
  ]) {
    const result = noticeModalPlacement(facts);
    const outsideSide = result.left >= facts.container.right + 8 || result.left + result.width <= facts.container.left - 8;
    if (!outsideSide) {
      assert.ok(result.top >= facts.headerBottom + 8);
      assert.ok(result.top + result.maxHeight <= facts.footerTop - 8);
    }
    assert.ok(result.left >= 8);
    assert.ok(result.left + result.width <= facts.width - 8);
    assert.ok(result.maxHeight > 0);
  }
});
test('tiny body uses genuine outside free space, and impossible bounds never create a hidden zero-height host', async () => {
  const { noticeModalPlacement } = await import('./notices.js');
  const result = noticeModalPlacement({ width: 390, height: 800, container: { left: 16, right: 374, top: 250, bottom: 450 }, headerBottom: 340, footerTop: 360 });
  assert.ok(result.top >= 458 || result.top + result.maxHeight <= 242);
  assert.equal(noticeModalPlacement({ width: 390, height: 100, container: { left: 0, right: 390, top: 0, bottom: 100 }, headerBottom: 70, footerTop: 40 }), null);
});
test('actual host placement observes only boundaries and cleans up replacement, detachment and destroy', async () => {
  const { createNoticeHost } = await import('./notices.js');
  const events = () => {
    const listeners = new Map();
    return { listeners, addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) };
  };
  const style = new Map(), attributes = new Map(), frames = new Map();
  const element = { style: { getPropertyValue: key => style.get(key) || '', setProperty: (key, value) => style.set(key, value), removeProperty: key => style.delete(key) },
    setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key), remove() {}, hidden: false };
  let observed = [], disconnected = 0, sequence = 0;
  const window = { ...events(), innerWidth: 390, innerHeight: 800,
    requestAnimationFrame(fn) { frames.set(++sequence, fn);
    return sequence; }, cancelAnimationFrame: key => frames.delete(key),
    ResizeObserver: class { observe(node) { observed.push(node); } disconnect() { observed = [];
    disconnected++; } },
  };
  const document = { ...events(), defaultView: window, documentElement: { clientWidth: 390 }, createElement: () => element };
  const store = { items: () => [] };
  const host = createNoticeHost(store, { document, closeLabel: () => 'Close' });
  let headerBottom = 120, closed = false;
  const container = { isConnected: true, matches: () => closed, getBoundingClientRect: () => ({ left: 16, right: 374, top: 20, bottom: 780 }) };
  const header = { getBoundingClientRect: () => ({ bottom: headerBottom }) }, footer = { getBoundingClientRect: () => ({ top: 710 }) };
  host.setModalRegion({ container, header, footer });
  assert.deepEqual(observed, [container, header, footer]);
  assert.ok(!observed.includes(element));
  assert.equal(style.get('--notice-modal-top'), '128px');
  headerBottom = 150;
  window.listeners.get('resize')();
  for (const fn of frames.values()) fn();
  frames.clear();
  assert.equal(style.get('--notice-modal-top'), '158px');
  host.setModalRegion({ container, header: null, footer });
  assert.ok(disconnected >= 2);
  assert.deepEqual(observed, [container, footer]);
  container.isConnected = false;
  host.render();
  assert.equal(attributes.has('data-modal-region'), false);
  assert.equal(style.size, 0);
  assert.equal(window.listeners.size, 0);
  assert.equal(document.listeners.size, 0);
  container.isConnected = true;
  host.setModalRegion({ container, header, footer });
  closed = true;
  host.render();
  assert.equal(attributes.has('data-modal-region'), false);
  assert.equal(observed.length, 0);
  assert.equal(window.listeners.size, 0);
  assert.equal(document.listeners.size, 0);
  closed = false;
  host.setModalRegion({ container, header, footer });
  window.listeners.get('resize')();
  assert.equal(frames.size, 1);
  assert.equal(observed.length, 3);
  host.destroy();
  assert.equal(observed.length, 0);
  assert.equal(frames.size, 0);
  assert.equal(window.listeners.size, 0);
  assert.equal(document.listeners.size, 0);
});

test('wide dialogs use a genuinely usable side gap while narrow dialogs retain body placement', async () => {
  const { noticeModalPlacement } = await import('./notices.js');
  const wide = noticeModalPlacement({ width: 1190, height: 849, container: { left: 305, right: 885, top: 120, bottom: 729 }, headerBottom: 200, footerTop: 660 });
  assert.ok(wide.left >= 893);
  assert.ok(wide.width >= 240 && wide.width <= 380);
  assert.ok(wide.left + wide.width <= 1182);
  const narrow = noticeModalPlacement({ width: 390, height: 800, container: { left: 16, right: 374, top: 20, bottom: 780 }, headerBottom: 120, footerTop: 710 });
  assert.ok(narrow.left >= 24 && narrow.left + narrow.width <= 366);
  assert.ok(narrow.top >= 128 && narrow.top + narrow.maxHeight <= 702);
});
