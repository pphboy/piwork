// Shared assertions for existing isolated NiceGUI browser fixtures; no product tool.
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export const queryFaultSource = `
# Controlled validation fault; injected only into an isolated fixture copy.
_awareness_original_query = Workstation.query
def _awareness_fixture_query(self, name, value):
    if (self.data / 'awareness-query-failure').exists():
        raise RuntimeError('synthetic private implementation details')
    return _awareness_original_query(self, name, value)
Workstation.query = _awareness_fixture_query
`;

export async function checkQueryFailure(frame, setFault) {
  const input = frame.getByLabel('Todo title', { exact: true });
  const draft = (await input.inputValue()) || 'keep the failure recovery draft';
  await input.fill(draft); await input.focus();
  const before = await frame.locator('body').evaluate(async () => ({
    query: await (await fetch('/ui/queries/todos')).json(),
    runtime: await (await fetch('/api/runtime-version')).json(),
  }));
  const content = frame.locator('[data-piwork-business-content]');
  const confirmed = await content.innerText();
  await setFault(true);
  try {
    await expect(frame.locator('[data-piwork-data-status]')).toContainText('outdated');
    await expect.poll(() => content.innerText()).toBe(confirmed);
    await expect(input).toHaveValue(draft); await expect(input).toBeFocused();
    const failed = await frame.locator('body').evaluate(async () => ({
      health: (await fetch('/health')).status,
      query: (await fetch('/ui/queries/todos')).status,
      runtime: await (await fetch('/api/runtime-version')).json(),
    }));
    assert.equal(failed.health, 200); assert.equal(failed.query, 500);
    assert.equal(failed.runtime.codeVersion, before.runtime.codeVersion);
    await expect(frame.locator('[data-piwork-data-status]')).not.toContainText('private implementation');
    const acted = await frame.locator('body').evaluate(async (_node, stateVersion) => {
      const response = await fetch('/ui/actions/todo_add', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: 'awareness-recovery-todo', expectedStateVersion: stateVersion, input: { title: 'Added while query unavailable' } }) });
      return { status: response.status, body: await response.json() };
    }, before.query.stateVersion);
    assert.equal(acted.status, 200); assert.equal(acted.body.state, 'succeeded', JSON.stringify({ expected: before.query.stateVersion, result: acted.body }));
  } finally { await setFault(false); }
  await expect(frame.locator('[data-piwork-data-status]')).toHaveText('');
  await expect(frame.getByText('Added while query unavailable', { exact: true })).toBeVisible();
  await expect(input).toHaveValue(draft); await expect(input).toBeFocused();
  return { queryFailureObserved: true, staleStateVisible: true, sameCodeVersion: true, recoveryObserved: true, draftAndFocusRetained: true };
}

export async function checkDesktopPageEvidence(page, frame, confirmReady) {
  const root = frame.locator('[data-piwork-app]');
  const button = frame.getByRole('button', { name: 'Add Todo', exact: true });
  const observe = () => root.evaluate(node => {
    const style = getComputedStyle(node), rect = node.getBoundingClientRect();
    const button = [...node.querySelectorAll('button')].find(value => value.textContent.includes('Add Todo'));
    const area = button.getBoundingClientRect(), hit = document.elementFromPoint(area.x + area.width / 2, area.y + area.height / 2);
    return { pathname: location.pathname, domPresent: true, display: style.display, visibility: style.visibility,
      width: rect.width, height: rect.height, overlay: hit?.hasAttribute('data-piwork-fixture-overlay') ?? false };
  });
  await confirmReady(); await expect(root).toBeVisible();
  const baseline = await observe(); assert(baseline.width > 0 && baseline.height > 0);
  await frame.locator('body').evaluate(() => {
    const style = document.createElement('style'); style.id = 'awareness-style-fault';
    style.textContent = '.nicegui-column, .nicegui-row {display:none!important}'; document.head.append(style);
  });
  let hidden;
  try {
    await expect(root).toBeHidden(); await confirmReady();
    hidden = await observe(); assert.equal(hidden.display, 'none');
    assert.equal(await frame.locator('body').evaluate(async () => (await fetch('/health')).status), 200);
  } finally { await frame.locator('body').evaluate(() => document.getElementById('awareness-style-fault')?.remove()); }
  await expect(root).toBeVisible();
  await frame.locator('body').evaluate(() => {
    const overlay = document.createElement('div'); overlay.setAttribute('data-piwork-fixture-overlay', '');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:white;pointer-events:auto'; document.body.append(overlay);
  });
  let blocked;
  try {
    blocked = await observe(); assert.equal(blocked.overlay, true); await confirmReady();
    await assert.rejects(button.click({ trial: true, timeout: 700 }), /Timeout/);
  } finally { await frame.locator('[data-piwork-fixture-overlay]').evaluate(node => node.remove()); }
  await button.click({ trial: true });
  const resource = await frame.locator('body').evaluate(() => [...document.scripts].map(node => node.src)
    .filter(Boolean).map(value => new URL(value)).find(url => /\/_nicegui\/.*\/static\/(vue[.-]|nicegui)/.test(url.pathname))?.pathname);
  assert(resource, 'Actual NiceGUI bootstrap resource was not observed');
  const entry = await frame.locator('body').evaluate(() => location.origin + location.pathname);
  const probe = await page.context().newPage();
  const errors = [], responses = [], sockets = [];
  probe.on('pageerror', () => errors.push('bootstrap-error')); // Do not retain URLs, tickets or private exception text.
  probe.on('response', response => { if (new URL(response.url()).pathname === resource) responses.push(response.status()); });
  probe.on('websocket', socket => { sockets.push({ path: new URL(socket.url()).pathname, opened: true }); });
  const matches = url => url.pathname === resource;
  try {
    await probe.route(matches, route => route.fulfill({ status: 503, contentType: 'application/javascript', body: '/* controlled bootstrap failure */' }));
    await probe.goto(entry);
    await expect(probe.locator('[data-piwork-app]')).toHaveCount(0);
    await expect.poll(() => responses.includes(503)).toBe(true);
    await confirmReady();
    assert.equal(await probe.evaluate(async () => (await fetch('/health')).status), 200);
    await probe.unroute(matches); await probe.reload();
    await expect(probe.getByRole('heading', { name: 'Updated workstation', exact: true })).toBeVisible();
    await expect.poll(() => sockets.some(socket => socket.path.includes('_nicegui_ws'))).toBe(true);
  } finally { await probe.close(); }
  await expect(root).toBeVisible();
  return { baseline, hidden, blocked, resource: { path: resource, failedStatus: 503, browserErrorCount: errors.length, recovered: true, sockets } };
}
