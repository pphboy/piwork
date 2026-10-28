import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { performance } from 'node:perf_hooks';

// This observes the delivered Desktop against a real CLI and Core. It changes
// neither application polling nor lifecycle requests for measurement purposes.
export async function measureBrowserCreates({ launchUrl, password, count, retire, onSample }) {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PIWORK_TEST_BROWSER_BIN || chromium.executablePath() });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const samples = [];
  try {
    await page.goto(launchUrl);
    await page.getByRole('heading', { name: 'Connect to your Core' }).waitFor();
    await page.getByRole('textbox', { name: 'Account', exact: true }).fill('admin');
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.locator('.works-page').waitFor();
    for (let i = 0; i < count; i++) {
      // Navigation prepares the next independent sample and is outside timing.
      if (i) { await page.goto(new URL(launchUrl).origin); await page.locator('.works-page').waitFor(); }
      const name = `Latency Browser ${i + 1}`;
      await page.getByRole('button', { name: 'New Work', exact: true }).first().click();
      await page.locator('#create-name').fill(name);
      const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/_desktop/api/works', { timeout: 180_000 });
      const start = performance.now();
      await page.getByRole('button', { name: 'Create Work', exact: true }).click();
      const response = await responsePromise;
      assert.equal(response.status(), 202, 'Desktop create was not accepted');
      const accepted = performance.now();
      const value = await response.json();
      await expect(page.locator('#modal')).toContainText('Operation ID', { timeout: 180_000 });
      await page.getByRole('button', { name: 'Close dialog' }).click();
      await expect(page.locator('.work-row').filter({ hasText: name })).toContainText('Ready', { timeout: 180_000 });
      await page.getByRole('button', { name: new RegExp(`^${name}(?:\\s|$)`) }).click();
      await expect(page.locator('.work-header')).toContainText(name);
      await expect(page.locator('.work-header')).toContainText('Ready', { timeout: 180_000 });
      const totalMs = performance.now() - start;
      const sample = { index: i + 1, acceptanceMs: accepted - start, totalMs };
      samples.push(sample); onSample(sample);
      await retire(value.workId);
    }
    return samples;
  } finally { await browser.close(); }
}
