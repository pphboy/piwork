import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const consolePublic = fileURLToPath(new URL('../dist/public/', import.meta.url));
const desktopPublic = fileURLToPath(new URL('../../desktop-webui/dist/public/', import.meta.url));
let server, base;

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = url.pathname;
    if (url.searchParams.has('__piwork_boot_retry')) {
      const target = Buffer.from(url.searchParams.get('__piwork_boot_retry'), 'base64url').toString();
      res.writeHead(303, { location: target }); res.end(); return;
    }
    if (['/desktop', '/admin', '/setup', '/login'].includes(path)) {
      const dir = path === '/desktop' ? desktopPublic : consolePublic;
      const name = path === '/setup' || path === '/login' ? 'setup.html' : 'index.html';
      const hash = (await readFile(dir + 'boot-csp.txt', 'utf8')).trim();
      res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': `default-src 'none'; script-src 'self' 'sha256-${hash}'; style-src 'self'; connect-src 'self'; form-action 'self'` });
      const html = await readFile(dir + name, 'utf8');
      res.end(html.replace('<!-- PIWORK_BOOT_RECOVERY -->', `<input type="hidden" name="__piwork_boot_retry" value="${Buffer.from(req.url).toString('base64url')}">`));
    } else if (path.endsWith('/app.js') || path.endsWith('/onboarding.js')) {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(`import './work-navigation.js'; document.body.dataset.appReady = 'yes'; document.dispatchEvent(new Event('piwork:boot-ready'));`);
    } else if (path.endsWith('/work-navigation.js') || path.endsWith('/boot.js') || path.endsWith('/i18n.js')) {
      res.writeHead(200, { 'content-type': 'text/javascript' }); res.end('export {};');
    } else if (path.endsWith('/style.css')) {
      res.writeHead(200, { 'content-type': 'text/css' }); res.end('body { color: black; }');
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });

for (const path of ['/desktop', '/admin', '/setup']) {
  test(`${path} retries a failed transitive module and keeps the original URL`, async ({ page }) => {
    let reads = 0;
    await page.route('**/work-navigation.js', route => ++reads === 1 ? route.abort('connectionrefused') : route.continue());
    await page.goto(base + path + '?view=example#target');
    await expect.poll(() => reads).toBe(2);
    await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'yes');
    await expect(page).toHaveURL(base + path + '?view=example#target');
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('piwork:boot:')))).toEqual([]);
  });
}

test('an entry script failure is retried before the application takes ownership', async ({ page }) => {
  let entries = 0;
  await page.route('**/app.js', route => ++entries === 1 ? route.abort('connectionrefused') : route.continue());
  await page.goto(base + '/admin');
  await expect.poll(() => entries).toBe(2);
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'yes');
});

test('a failed translation dependency is retried with the module graph', async ({ page }) => {
  let reads = 0;
  await page.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: `import './i18n.js'; document.body.dataset.appReady = 'yes'; document.dispatchEvent(new Event('piwork:boot-ready'));` }));
  await page.route('**/i18n.js', route => ++reads === 1 ? route.abort('connectionrefused') : route.continue());
  await page.goto(base + '/admin');
  await expect.poll(() => reads).toBe(2);
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'yes');
});

test('the watchdog detects a module that never hands over and uses the saved language', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addInitScript(() => {
    localStorage.setItem('piwork.ui-locale', 'zh-CN');
    const later = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => later(callback, delay === 10000 ? 300 : delay, ...args);
  });
  let entries = 0;
  await page.route('**/onboarding.js', route => {
    entries++;
    return route.fulfill({ contentType: 'text/javascript', body: 'export {};' });
  });
  await page.goto(base + '/setup');
  await expect(page.locator('[data-boot-loading]')).toContainText('页面加载未完成');
  await expect(page.locator('[data-boot-recovery]')).toBeVisible();
  expect(entries).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('persistent module failure exhausts the budget and manual retry does not restart it', async ({ page }) => {
  let reads = 0;
  await page.route('**/work-navigation.js', route => { reads++; return route.abort('connectionrefused'); });
  await page.goto(base + '/desktop?view=example#target');
  await expect.poll(() => reads, { timeout: 8000 }).toBe(3);
  await expect(page.locator('[data-boot-loading]')).toContainText('interrupted');
  await expect(page.locator('[data-boot-recovery]')).toBeVisible();
  await page.waitForTimeout(1200);
  expect(reads).toBe(3);
  await page.locator('[data-boot-recovery]').click();
  await expect.poll(() => reads).toBe(4);
  await expect(page).toHaveURL(base + '/desktop?view=example#target');
  await page.waitForTimeout(1200);
  expect(reads).toBe(4);
});

test('storage denial stops automatic reloads and retains bilingual recovery', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('denied'); } }); });
  let reads = 0;
  await page.route('**/work-navigation.js', route => { reads++; return route.abort('connectionrefused'); });
  await page.goto(base + '/setup');
  await expect(page.locator('[data-boot-loading]')).toContainText('interrupted');
  await page.waitForTimeout(1200);
  expect(reads).toBe(1);
  await expect(page.locator('[data-boot-recovery]')).toBeVisible();
  await expect(page.locator('[data-boot-home]')).toHaveAttribute('href', '/');
});

test('stylesheet failure after handoff remains local and does not reload the page', async ({ page }) => {
  let documents = 0;
  page.on('request', req => { if (req.isNavigationRequest()) documents++; });
  await page.route('**/style.css', route => route.abort('connectionrefused'));
  await page.goto(base + '/desktop');
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'yes');
  await expect(page.locator('#piwork-boot-style-warning')).toBeVisible();
  await page.waitForTimeout(1200);
  expect(documents).toBe(1);
});

for (const path of ['/desktop', '/admin', '/setup', '/login']) test(`${path} reloads the exact URL without scripts or styles using the keyboard`, async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 360, height: 800 } });
  const page = await context.newPage();
  const writes = [];
  page.on('request', request => { if (request.method() !== 'GET') writes.push(request.method()); });
  await page.route('**/style.css', route => route.abort());
  const original = base + path + '?view=one%20two&tag=a&tag=b&bare&_charset_=original#work/session';
  await page.goto(original);
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-boot-recovery]')).toBeFocused();
  await expect(page.locator('[data-boot-recovery]')).toHaveText('重新加载 / Reload');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(original);
  await expect(page.locator('[data-boot-recovery]')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-boot-recovery]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-boot-home]')).toBeFocused();
  await expect(page.locator('[data-boot-home]')).toHaveAttribute('href', '/');
  expect(writes).toEqual([]);
  await context.close();
});

test('manual recovery cancels a scheduled automatic retry before it fires', async ({ page }) => {
  let entries = 0, documents = 0;
  page.on('request', request => { if (request.isNavigationRequest()) documents++; });
  await page.route('**/app.js', route => ++entries === 1 ? route.abort('connectionrefused') : route.continue());
  await page.goto(base + '/desktop?view=example#target');
  await expect(page.locator('html')).toHaveAttribute('data-boot-state', 'failed');
  await page.locator('[data-boot-recovery]').click();
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'yes');
  await page.waitForTimeout(1300);
  expect(documents).toBe(2); expect(entries).toBe(2);
  await expect(page).toHaveURL(base + '/desktop?view=example#target');
});
