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
  let headerBottom = 120, closed = false, trueModal = true;
  const container = { isConnected: true, matches: selector => selector === ':modal' ? trueModal : closed, getBoundingClientRect: () => ({ left: 16, right: 374, top: 20, bottom: 780 }) };
  const header = { getBoundingClientRect: () => ({ bottom: headerBottom }) }, footer = { getBoundingClientRect: () => ({ top: 710 }) };
  host.setModalRegion({ container, header, footer });
  assert.deepEqual(observed, [container, header, footer]);
  assert.ok(!observed.includes(element));
  assert.equal(style.get('--notice-modal-top'), '128px');
  const pageHeader = { isConnected: true, getBoundingClientRect: () => ({ left: 0, right: 390, top: 0, bottom: 200 }) };
  host.setPageRegion({ header: pageHeader });
  assert.equal(style.get('--notice-modal-top'), '128px');
  assert.ok(!observed.includes(pageHeader));
  trueModal = false;
  host.setModalRegion({ container, header: null, footer });
  assert.equal(style.get('--notice-modal-top'), '208px');
  assert.ok(observed.includes(pageHeader));
  window.getComputedStyle = node => node.styleFacts || {};
  const clip = { styleFacts: { overflowY: 'hidden' }, getBoundingClientRect: () => ({ left: 0, right: 390, top: 170, bottom: 220 }) };
  let inert = false;
  const toolbar = { isConnected: true, parentElement: clip, closest: () => inert ? clip : null,
    getBoundingClientRect: () => ({ left: 0, right: 390, top: 180, bottom: 260 }) };
  host.setPageRegion({ header: pageHeader, toolbars: [toolbar] });
  assert.equal(style.get('--notice-modal-top'), '228px');
  assert.ok(observed.includes(toolbar));
  toolbar.styleFacts = { visibility: 'hidden' };
  host.setPageRegion({ header: pageHeader, toolbars: [toolbar] });
  assert.equal(style.get('--notice-modal-top'), '208px');
  toolbar.styleFacts = {};
  inert = true;
  host.setPageRegion({ header: pageHeader, toolbars: [toolbar] });
  assert.equal(style.get('--notice-modal-top'), '208px');
  inert = false;
  toolbar.isConnected = false;
  host.setPageRegion({ header: pageHeader, toolbars: [toolbar] });
  assert.ok(!observed.includes(toolbar));
  assert.equal(style.get('--notice-modal-top'), '208px');
  host.setPageRegion(null);
  trueModal = true;
  host.setModalRegion({ container, header, footer });
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

test('a global notice moves above the measured composer only when their real rectangles intersect', async () => {
  const { noticePagePlacement } = await import('./notices.js');
  const notice = { left: 794, right: 1174, top: 746, bottom: 833 };
  const control = { left: 500, right: 1174, top: 680, bottom: 789 };
  const result = noticePagePlacement({ notice, footers: [control], viewportHeight: 849 });
  assert.equal(result.top + result.maxHeight, 672);
  assert.equal(result.maxHeight, 87);
  assert.equal(noticePagePlacement({ notice: { ...notice, top: 64, bottom: 151 }, footers: [control], viewportHeight: 849 }), null);
  assert.equal(noticePagePlacement({ notice, footers: [{ ...control, right: 700 }], viewportHeight: 849 }), null);
  assert.equal(noticePagePlacement({ notice, footers: [{ left: 0, right: 0, top: 0, bottom: 0 }], viewportHeight: 849 }), null);
});
test('growing composer and a shorter visual viewport keep a positive notice area above controls', async () => {
  const { noticePagePlacement } = await import('./notices.js');
  const result = noticePagePlacement({ notice: { left: 8, right: 382, top: 64, bottom: 288 },
    footers: [{ left: 16, right: 374, top: 180, bottom: 480 }], viewportTop: 50, viewportHeight: 450 });
  assert.equal(result.top, 58);
  assert.equal(result.top + result.maxHeight, 172);
  assert.ok(result.maxHeight > 0);
});
test('modal placement wins over protected controls and closing returns to composer-safe then global placement', async () => {
  const { createNoticeHost } = await import('./notices.js');
  const style = new Map(), attributes = new Map(), listeners = new Map(), frames = new Map();
  const element = { hidden: false, style: { getPropertyValue: key => style.get(key) || '', setProperty: (key, value) => style.set(key, value), removeProperty: key => style.delete(key) },
    setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key), remove() {},
    getBoundingClientRect: () => {
      const top = attributes.has('data-page-region') ? Number.parseFloat(style.get('--notice-page-top')) : 650;
      return { left: 24, right: 374, top, bottom: top + 130 };
    } };
  let observed = [];
  const window = { innerWidth: 390, innerHeight: 800,
    requestAnimationFrame: fn => { frames.set(1, fn);
    return 1; }, cancelAnimationFrame: key => frames.delete(key),
    addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key),
    ResizeObserver: class { observe(node) { observed.push(node); } disconnect() { observed = []; } } };
  const document = { defaultView: window, documentElement: { clientWidth: 390 }, createElement: () => element,
    addEventListener: () => {}, removeEventListener: () => {} };
  const host = createNoticeHost({ items: () => [] }, { document, closeLabel: () => 'Close' });
  let visible = true;
  const composer = { isConnected: true, getBoundingClientRect: () => visible ? { left: 16, right: 374, top: 640, bottom: 790 } : { left: 0, right: 0, top: 0, bottom: 0 } };
  host.setPageRegion({ header: null, footers: [composer] });
  assert.equal(attributes.has('data-page-region'), true);
  assert.deepEqual(observed, [composer]);
  const protectedTop = style.get('--notice-page-top');
  for (let pass = 0; pass < 3; pass++) {
    listeners.get('resize')();
    for (const callback of frames.values()) callback();
    frames.clear();
    assert.equal(style.get('--notice-page-top'), protectedTop);
    assert.equal(attributes.has('data-page-region'), true);
  }
  visible = false;
  host.setPageRegion({ header: null, footers: [composer] });
  assert.equal(attributes.has('data-page-region'), false);
  assert.equal(element.hidden, false);
  visible = true;
  host.setPageRegion({ header: null, footers: [composer] });
  assert.equal(attributes.has('data-page-region'), true);
  const container = { isConnected: true, matches: () => false, getBoundingClientRect: () => ({ left: 16, right: 374, top: 20, bottom: 780 }) };
  const header = { getBoundingClientRect: () => ({ bottom: 120 }) }, footer = { getBoundingClientRect: () => ({ top: 710 }) };
  host.setModalRegion({ container, header, footer });
  assert.equal(attributes.has('data-modal-region'), true);
  assert.equal(attributes.has('data-page-region'), false);
  assert.deepEqual(observed, [container, header, footer]);
  host.setModalRegion(null);
  assert.equal(attributes.has('data-page-region'), true);
  assert.equal(attributes.has('data-modal-region'), false);
  assert.deepEqual(observed, [composer]);
  composer.isConnected = false;
  host.setPageRegion({ header: null, footers: [composer] });
  assert.equal(attributes.has('data-page-region'), false);
  assert.deepEqual(observed, []);
  assert.equal(listeners.size, 0);
  composer.isConnected = true;
  host.setPageRegion({ header: null, footers: [composer] });
  assert.equal(attributes.has('data-page-region'), true);
  host.setPageRegion(null);
  assert.equal(attributes.has('data-page-region'), false);
  assert.equal(style.size, 0);
  assert.equal(listeners.size, 0);
  assert.deepEqual(observed, []);
  host.destroy();
});

test('a complete measured notice uses a real vertical outside gap before modal body fallback', async () => {
  const { noticeModalPlacement } = await import('./notices.js');
  const facts = { width: 390, height: 800, container: { left: 16, right: 374, top: 160, bottom: 640 }, headerBottom: 240, footerTop: 570 };
  const above = noticeModalPlacement({ ...facts, noticeHeight: 100 });
  assert.equal(above.top, 52);
  assert.equal(above.maxHeight, 100);
  assert.ok(above.top + above.maxHeight <= facts.container.top - 8);
  const below = noticeModalPlacement({ ...facts, container: { ...facts.container, top: 20 }, noticeHeight: 100 });
  assert.equal(below.top, 648);
  assert.equal(below.maxHeight, 100);
  const baseline = noticeModalPlacement(facts);
  for (const noticeHeight of [0, -1, NaN, Infinity, 200]) assert.deepEqual(noticeModalPlacement({ ...facts, noticeHeight }), baseline);
  const clipped = noticeModalPlacement({ ...facts, viewportTop: 100, height: 600, noticeHeight: 100 });
  assert.ok(clipped.top >= facts.headerBottom + 8);
  assert.ok(clipped.top + clipped.maxHeight <= facts.footerTop - 8);
});

test('narrow page header and composer are protected by separate measured boundaries only on collision', async () => {
  const { noticePagePlacement } = await import('./notices.js');
  const header = { left: 16, right: 439, top: 0, bottom: 95.45 };
  const footer = { left: 16, right: 439, top: 680, bottom: 780 };
  const notice = { left: 8, right: 447, top: 63.99, bottom: 150.78 };
  const result = noticePagePlacement({ notice, header, footers: [footer], viewportHeight: 800 });
  assert.equal(result.top, 103.45);
  assert.ok(result.top + result.maxHeight <= footer.top - 8);
  const both = noticePagePlacement({ notice: { ...notice, bottom: 750 }, header, footers: [footer], viewportHeight: 800 });
  assert.equal(both.top, 103.45);
  assert.equal(both.top + both.maxHeight, 672);
  assert.equal(noticePagePlacement({ notice: { ...notice, top: 200, bottom: 287 }, header, footers: [footer], viewportHeight: 800 }), null);
  assert.equal(noticePagePlacement({ notice, header: { ...header, right: 0, left: 0 }, footers: [footer], viewportHeight: 800 }), null);
  const headerOnly = noticePagePlacement({ notice, header, footers: [], viewportHeight: 800 });
  assert.equal(headerOnly.top, 103.45);
});

test('nonmodal placement protects the measured page header without extending the real viewport bottom', async () => {
  const { noticeModalPlacement } = await import('./notices.js');
  const facts = { width: 1190, height: 849, container: { left: 410, right: 1100, top: 0, bottom: 800 }, headerBottom: 80, footerTop: 720 };
  const normal = noticeModalPlacement(facts);
  const protectedPage = noticeModalPlacement({ ...facts, pageHeaderBottom: 56 });
  assert.equal(normal.top, 8);
  assert.equal(protectedPage.top, 64);
  assert.ok(protectedPage.top + protectedPage.maxHeight <= 841);
  const offset = noticeModalPlacement({ ...facts, viewportTop: 100, height: 400, pageHeaderBottom: 156 });
  assert.ok(offset.top >= 164);
  assert.ok(offset.top + offset.maxHeight <= 492);
  assert.deepEqual(noticeModalPlacement({ ...facts, pageHeaderBottom: undefined }), normal);
});

test('shared transient menu layer is above persistent notices without changing native popover semantics', async () => {
  const { readFile } = await import('node:fs/promises');
  const tokens = await readFile(new URL('./tokens.css', import.meta.url), 'utf8');
  const controls = await readFile(new URL('./controls.css', import.meta.url), 'utf8');
  const admin = await readFile(new URL('../console-webui/public/style.css', import.meta.url), 'utf8');
  assert.match(tokens, /--layer-notice:\s*1000;/);
  assert.match(tokens, /--layer-transient-menu:\s*1001;/);
  assert.match(controls, /\.notice-host\s*\{[^}]*z-index:\s*var\(--layer-notice\)/);
  assert.match(controls, /\.language-picker\s*\{[^}]*z-index:\s*var\(--layer-transient-menu\)/);
  assert.match(admin, /\.task-shell \.nav\.open,\s*\.admin-account-dropdown:not\(\[hidden\]\)\s*\{\s*z-index:\s*var\(--layer-transient-menu\)/);
});

test('finite primary toolbar rectangles protect their actual rows without unioning gaps or unrelated page content', async () => {
  const { noticePagePlacement } = await import('./notices.js');
  const header = { left: 0, right: 455, top: 0, bottom: 96 };
  const files = { left: 16, right: 439, top: 140, bottom: 180 };
  const settings = { left: 16, right: 439, top: 190, bottom: 230 };
  const notice = { left: 16, right: 439, top: 104, bottom: 212 };
  assert.equal(noticePagePlacement({ notice, header, toolbars: [files, settings], viewportHeight: 772 }).top, 238);
  assert.equal(noticePagePlacement({ notice: { ...notice, top: 100, bottom: 130 }, header, toolbars: [files], viewportHeight: 772 }), null);
  assert.equal(noticePagePlacement({ notice, header, toolbars: [{ ...files, left: 0, right: 0 }], viewportHeight: 772 }), null);
  const footer = { left: 16, right: 439, top: 700, bottom: 760 };
  const result = noticePagePlacement({ notice: { ...notice, bottom: 750 }, header, toolbars: [files, settings], footers: [footer], viewportHeight: 772 });
  assert.equal(result.top, 238);
  assert.equal(result.top + result.maxHeight, 692);
});

test('coexisting editor, settings and composer footers use the earliest visible control row', async () => {
  const { noticePagePlacement } = await import('./notices.js');
  const notice = { left: 16, right: 439, top: 690, bottom: 760 };
  const composer = { left: 200, right: 439, top: 720, bottom: 772 };
  const editor = { left: 16, right: 250, top: 650, bottom: 700 };
  const result = noticePagePlacement({ notice, footers: [composer, editor], viewportHeight: 772 });
  assert.equal(result.top + result.maxHeight, 642);
  const reversed = noticePagePlacement({ notice, footers: [editor, composer], viewportHeight: 772 });
  assert.deepEqual(reversed, result);
  assert.equal(noticePagePlacement({ notice, footers: [{ ...editor, bottom: 0 }, composer], viewportHeight: 772 }).top + result.maxHeight, 712);
});
