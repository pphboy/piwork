import test from 'node:test';
import assert from 'node:assert/strict';
const { desktopNoticePageRegion } = await import(new URL('../browser/notice-page-region.js', import.meta.url).href);
const headerSelector = '.work-header, .topbar-works';
const toolbarSelectors = ['#workspace-main > .files-toolbar', '#workspace-main > .service-toolbar', '.settings-page > .settings-navigation', '.settings-page > .settings-heading', '.settings-page > .configuration-state', '.settings-layout > .settings-tabs', '.agent-panel > .agent-header', '.messages .message-submission.failed', '#workspace-main > .file-target-toolbar', '.settings-page > .settings-back', '.settings-page > .feedback [data-action="refresh-config"]'];
const footerSelectors = ['#workspace-main > .editor-footer', '.settings-page > .settings-savebar', '.composer-wrap'];
function fixture(header: object | null, toolbars: readonly object[], footers: readonly object[]) {
  const calls: string[] = [];
  return { calls, root: {
    querySelector(selector: string) {
      calls.push(selector);
      assert.equal(selector, headerSelector);
      return header;
    },
    querySelectorAll(selector: string) {
      calls.push(selector);
      if (selector === toolbarSelectors.join(', ')) return toolbars;
      assert.equal(selector, footerSelectors.join(', '));
      return footers;
    },
  } };
}

test('Desktop notice wiring supplies only the finite approved rows and all simultaneous footer refs', () => {
  const header = Object.freeze({ id: 'work-header' });
  const toolbars = Object.freeze(toolbarSelectors.map(id => Object.freeze({ id })));
  const footers = Object.freeze(footerSelectors.map(id => Object.freeze({ id })));
  const f = fixture(header, toolbars, footers);
  const region = desktopNoticePageRegion(f.root);
  assert.equal(region.header, header);
  assert.deepEqual(region.toolbars, toolbars);
  assert.deepEqual(region.footers, footers);
  assert.equal(region.footers[0], footers[0]);
  assert.equal(region.footers[2], footers[2]);
  assert.deepEqual(f.calls, [headerSelector, toolbarSelectors.join(', '), footerSelectors.join(', ')]);
});

test('Desktop notice wiring returns null for an absent region and never queries body or iframe content', () => {
  const f = fixture(null, [], []);
  assert.equal(desktopNoticePageRegion(f.root), null);
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(selector => !selector.includes('body') && !selector.includes('iframe')));
});

test('Desktop notice wiring retains supplied node identity for shared visibility and clipping ownership', () => {
  const detached = Object.freeze({ isConnected: false });
  const hidden = Object.freeze({ hidden: true });
  const region = desktopNoticePageRegion(fixture(null, [detached], [hidden]).root);
  assert.equal(region.toolbars[0], detached);
  assert.equal(region.footers[0], hidden);
});
