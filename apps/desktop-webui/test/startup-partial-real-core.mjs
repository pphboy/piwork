import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

// The parent integration test owns the isolated Core, Engine resources and
// HTTP server. This browser only uses its synthetic account and Work.
const [origin, workID, serviceID] = process.argv.slice(2);
assert.ok(origin && workID && serviceID);
const browser = await chromium.launch({ headless: true, executablePath: process.env.PIWORK_TEST_BROWSER_BIN || chromium.executablePath() });
try {
  const page = await browser.newPage();
  await page.goto(`${origin}/login`);
  await page.getByLabel('Account', { exact: true }).fill('admin');
  await page.getByLabel('Password', { exact: true }).fill('development-fixture-pass');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const row = page.locator('.work-row').filter({ hasText: 'Apply Work' });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator('.work-name').click();
  await expect(page.locator('.work-header')).toContainText('Apply Work');
  await expect(page.locator('.core-startup-page')).toHaveCount(0);
  const result = await page.evaluate(async ({ workID, serviceID }) => {
    const [status, sessions, service] = await Promise.all([
      fetch('/_desktop/api/status'),
      fetch(`/_desktop/api/works/${encodeURIComponent(workID)}/sessions`),
      fetch(`/services/${encodeURIComponent(workID)}/${encodeURIComponent(serviceID)}/8099/`),
    ]);
    const statusBody = await status.json();
    const sessionBody = await sessions.json();
    const serviceBody = await service.text();
    const { adapter } = await import('/desktop/browser/adapter.js');
    let createResult = 'submitted';
    try { await adapter.createWork('blocked default', {}); } catch (error) { createResult = error.code; }
    return { ready: statusBody.readiness?.value?.ready, sessionsStatus: sessions.status, sessions: Array.isArray(sessionBody.sessions), serviceStatus: service.status, serviceBody, createResult };
  }, { workID, serviceID });
  assert.deepEqual(result, { ready: false, sessionsStatus: 200, sessions: true, serviceStatus: 200, serviceBody: 'retained-service', createResult: 'CORE_NOT_READY' });
  console.log('Recovered Work and its Agent and Service are usable in a real browser while default preparation remains blocked.');
} finally {
  await browser.close();
}
