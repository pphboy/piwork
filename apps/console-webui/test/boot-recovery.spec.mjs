import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
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
      res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': `default-src 'none'; script-src 'self' 'sha256-${hash}'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'` });
      const html = await readFile(dir + name, 'utf8');
      res.end(html.replace('<!-- PIWORK_BOOT_RECOVERY -->', `<input type="hidden" name="__piwork_boot_retry" value="${Buffer.from(req.url).toString('base64url')}">`));
    } else if (path.endsWith('/app.js') || path.endsWith('/onboarding.js')) {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(`import './work-navigation.js'; document.body.dataset.appReady = 'yes'; document.dispatchEvent(new Event('piwork:boot-ready'));`);
    } else if (path.endsWith('/work-navigation.js')) {
      res.writeHead(200, { 'content-type': 'text/javascript' }); res.end('export {};');
    } else if (path.endsWith('/boot.js') || path.endsWith('/i18n.js')) {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(await readFile(consolePublic + '../browser/' + path.split('/').pop()));
    } else if (path.endsWith('/style.css')) {
      res.writeHead(200, { 'content-type': 'text/css' });
      res.end(await readFile(consolePublic + 'style.css', 'utf8'));
    } else if (path.endsWith('/piwork-logo.png')) {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(await readFile(consolePublic + 'piwork-logo.png'));
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
  await expect(page.locator('[data-boot-error]')).toContainText('页面加载未完成');
  await expect(page.locator('[data-boot-recovery]')).toBeVisible();
  expect(entries).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('persistent module failure exhausts the budget and manual retry does not restart it', async ({ page }) => {
  let reads = 0;
  await page.route('**/work-navigation.js', route => { reads++; return route.abort('connectionrefused'); });
  await page.goto(base + '/desktop?view=example#target');
  await expect.poll(() => reads, { timeout: 8000 }).toBe(3);
  await expect(page.locator('[data-boot-error]')).toContainText('interrupted');
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
  await expect(page.locator('[data-boot-error]')).toContainText('interrupted');
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

for (const path of ['/admin', '/setup', '/login']) {
  test(`${path} shows the centered brand before handoff while the entry asset is pending`, async ({ page }) => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route(/\/(?:app|onboarding)\.js$/, async route => {
      await gate;
      await route.continue();
    });
    try {
      await page.goto(base + path, { waitUntil: 'commit' });
      await expect(page.locator('.startup-screen')).toBeVisible();
      await expect(page.locator('.startup-logo')).toBeVisible();
      await expect(page.locator('[data-boot-recovery]')).toBeHidden();
      await expect(page.locator('[data-boot-home]')).toBeHidden();
      await expect(page.locator('[data-boot-loading]')).toBeVisible();
      await expect(page.locator('.pending-dots')).toHaveCount(1);
    } finally {
      release();
    }
    await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'yes');
  });
}

const startupEvidence = new URL('../../../dist/startup-loading/', import.meta.url);
for (const viewport of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }, { width: 360, height: 800 }]) {
  for (const locale of ['en', 'zh-CN']) {
    test(`brand is centered and recovery keeps its anchor at ${viewport.width}px in ${locale}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport, locale, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await page.addInitScript(locale => {
        localStorage.setItem('piwork.ui-locale', locale);
        sessionStorage.setItem('piwork:boot:setup', '2');
      }, locale);
      // Complete parsing without handing ownership to the application. This
      // keeps fonts.ready usable for screenshots while the watchdog still owns startup.
      await page.route('**/onboarding.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export {};' }));
      try {
        await page.goto(base + '/setup');
        await expect(page.locator('.startup-screen')).toHaveAttribute('aria-busy', 'true');
        await expect(page.locator('[data-boot-loading]')).toHaveText(locale === 'en' ? 'Opening Piwork…' : '正在打开 Piwork…');
        await expect(page.locator('[data-boot-recovery]')).toBeHidden();
        const geometry = await page.locator('.startup-brand').boundingBox();
        expect(Math.abs(geometry.x + geometry.width / 2 - viewport.width / 2)).toBeLessThan(1);
        expect(Math.abs(geometry.y + geometry.height / 2 - viewport.height / 2)).toBeLessThan(3);
        expect(await page.locator('.pending-dots > i').first().evaluate(node => getComputedStyle(node).animationName)).toBe('none');
        await mkdir(startupEvidence, { recursive: true });
        await page.screenshot({ path: new URL(`setup-${locale}-${viewport.width}-pending.png`, startupEvidence).pathname });
        await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'Synthetic startup failure' })));
        await expect(page.locator('[data-boot-recovery]')).toBeVisible();
        await expect(page.locator('.startup-screen')).toHaveAttribute('aria-busy', 'false');
        expect(await page.locator('.startup-brand').boundingBox()).toEqual(geometry);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.keyboard.press('Tab');
        await expect(page.locator('[data-boot-recovery]')).toBeFocused();
        await page.screenshot({ path: new URL(`setup-${locale}-${viewport.width}-unconfirmed.png`, startupEvidence).pathname });
      } finally {
        await context.close();
      }
    });
  }
}

test('a blocked watchdog keeps native recovery reachable while a missing logo does not trigger reload', async ({ page }) => {
  await page.route(base + '/setup', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(),
      'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'" } });
  });
  await page.route('**/piwork-logo.png', route => route.abort());
  await page.goto(base + '/setup');
  await expect(page.locator('[data-boot-recovery]')).toBeVisible();
  await expect(page.locator('[data-boot-error]')).toBeVisible();
  expect(await page.locator('.startup-logo').evaluate(node => node.width)).toBe(48);
  await expect(page.locator('html')).not.toHaveAttribute('data-boot-state');
});

for (const path of ['/desktop', '/admin', '/setup']) {
  test(`${path} missing logo does not trigger the active watchdog`, async ({ page }) => {
    let documents = 0;
    page.on('request', request => { if (request.isNavigationRequest()) documents++; });
    await page.route('**/piwork-logo.png', route => route.abort('failed'));
    await page.goto(base + path);
    await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'yes');
    await expect(page.locator('html')).not.toHaveAttribute('data-boot-state', 'failed');
    await page.waitForTimeout(1200);
    expect(documents).toBe(1);
  });
}
