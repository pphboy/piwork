import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// 中英文断言一律取自构建产物里的 catalog，避免测试写死文案。
import { catalog } from '../dist/browser/i18n/catalog.js';

const distRoot = fileURLToPath(new URL('../dist/', import.meta.url));
const zh = catalog['zh-CN'];
const en = catalog.en;

let server;
let base;

function send(res, body, type) {
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

test.beforeAll(async () => {
  // 最小静态服务：只提供登录页（Console index）、setup 引导页和两者加载的 browser 模块。
  server = createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    try {
      if (path.endsWith('/piwork-logo.png')) {
        send(res, await readFile(join(distRoot, 'public', 'piwork-logo.png')), 'image/png');
        return;
      }
      if (path === '/style.css' || path === '/setup/style.css') {
        send(res, await readFile(join(distRoot, 'public', 'style.css')), 'text/css; charset=utf-8');
        return;
      }
      if (path === '/setup') {
        send(res, await readFile(join(distRoot, 'public', 'setup.html')), 'text/html; charset=utf-8');
        return;
      }
      if (path.startsWith('/setup/browser/')) {
        const name = path.slice('/setup/browser/'.length);
        send(res, await readFile(join(distRoot, 'browser', name)), 'text/javascript; charset=utf-8');
        return;
      }
      if (path.startsWith('/browser/')) {
        const name = path.slice('/browser/'.length);
        send(res, await readFile(join(distRoot, 'browser', name)), 'text/javascript; charset=utf-8');
        return;
      }
      if (path === '/login' || path === '/' || path === '/admin' || path.startsWith('/admin/')) {
        let html = await readFile(join(distRoot, 'public', 'index.html'), 'utf8');
        if (path === '/admin' || path.startsWith('/admin/'))
          html = html.replace('<head>', '<head><meta name="piwork-mode" content="hosted">');
        send(res, html, 'text/html; charset=utf-8');
        return;
      }
      res.writeHead(404);
      res.end();
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** Mock Console 的会话与只读接口，使登录页和 /admin 概览无需真实 Core。 */
async function mockConsole(page, { authenticated = false } = {}) {
  const user = { id: 'admin-fixture', account: 'admin', role: 'admin', enabled: true };
  const values = {
    session: authenticated
      ? { authenticated: true, csrfToken: 'synthetic-csrf', user }
      : { authenticated: false, csrfToken: 'synthetic-csrf' },
    availability: { reachable: true, administratorInitialized: true },
    'admin/status': { ready: true, state: 'READY', checks: { runtimeConfigured: true } },
    health: { healthy: true },
    'admin/runtime': { configured: false },
    'admin/default-work': { baseImage: 'agent:fixture', configuration: { skills: [], packages: [], agentsMd: '' } },
    'admin/users': { users: [user] },
  };
  await page.route('**/console/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/console/api/', '');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(values[path] ?? {}),
    });
  });
  await page.route('**/_web/api/onboarding', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: { ready: true }, preparation: { ready: true, components: {} } }),
    }),
  );
}

/** Mock setup 引导页读取的状态与会话接口，并记录所有写请求。 */
async function mockSetup(page, requests = []) {
  await page.route('**/_web/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requests.push({ method: request.method(), path });
    let value = {};
    if (path === '/_web/api/state') value = { administratorInitialized: true };
    else if (path === '/_web/api/session') value = { authenticated: false, csrfToken: 'synthetic-csrf' };
    else if (path === '/_web/api/onboarding')
      value = { status: { ready: true }, preparation: { ready: true, components: {} } };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
  });
}

function titleText(localeCatalog) {
  return localeCatalog['title.format'].replace('{page}', localeCatalog['title.signIn']);
}

/**
 * 预置同源显式选择，让“切换语言”类用例从中文开始。
 * 浏览器语言偏好本身由第一个用例单独覆盖，避免用预置值掩盖该路径。
 */
async function seedLocale(context, locale) {
  await context.addInitScript((value) => {
    try {
      // 只播种首次文档；刷新/后续导航必须让真实持久化结果生效。
      if (window.sessionStorage.getItem('__piwork_locale_seeded')) return;
      window.localStorage.setItem('piwork.ui-locale', value);
      window.sessionStorage.setItem('__piwork_locale_seeded', '1');
    } catch {
      /* 存储被拒时由用例自行验证降级路径 */
    }
  }, locale);
}

async function openLanguage(page) {
  const account = page.locator('#account-trigger');
  if (await account.isVisible()) {
    if (await page.locator('#account-dropdown').isHidden()) await account.click();
    await page.locator('#account-dropdown [data-action="language"]').click();
  } else await page.locator('[data-language-trigger]').first().click();
  await expect(page.locator('.language-picker')).toBeVisible();
}
async function selectLanguage(page, locale) {
  await openLanguage(page);
  await page.locator(`.language-picker [data-locale="${locale}"]`).click();
  await expect(page.locator('.language-picker')).toHaveCount(0);
}

test('Console 登录页自动识别浏览器，单个图标入口展开三项选择', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 360, height: 800 } });
  const page = await context.newPage();
  try {
    await mockConsole(page); await page.goto(`${base}/login`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByRole('heading', {level:1})).toHaveText(zh['login.title']);
    expect(await page.evaluate(() => localStorage.getItem('piwork.ui-locale'))).toBeNull();
    await expect(page.locator('[data-language-trigger]')).toHaveCount(1);
    await expect(page.locator('[data-language-trigger] svg')).toHaveCount(2);
    await expect(page.locator('[data-locale]')).toHaveCount(0);
    await openLanguage(page);
    await expect(page.locator('.language-picker [role=option]')).toHaveCount(3);
    await expect(page.locator('[data-locale="auto"]')).toHaveAttribute('aria-selected','true');
    await expect(page.locator('[data-locale="zh-CN"]')).toHaveAttribute('aria-selected','false');
    await page.screenshot({path:fileURLToPath(new URL('../../../dist/language-picker-login-360.png',import.meta.url))});
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-language-trigger]')).toBeFocused();
  } finally { await context.close(); }
});

test('登录页键盘选择、刷新及恢复跟随浏览器保留密码草稿', async ({ browser }) => {
  const context=await browser.newContext({locale:'zh-CN'}); const page=await context.newPage();
  try {
    await mockConsole(page); await page.goto(`${base}/login`);
    await page.locator('#account').fill('draft-account'); await page.locator('#password').fill('draft-password');
    await page.locator('[data-language-trigger]').focus(); await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End'); await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('lang','en');
    await expect(page.locator('#account')).toHaveValue('draft-account'); await expect(page.locator('#password')).toHaveValue('draft-password');
    await expect(page.locator('.language-picker')).toHaveCount(0);
    expect(await page.evaluate(()=>localStorage.getItem('piwork.ui-locale'))).toBe('en');
    await page.reload(); await expect(page.locator('html')).toHaveAttribute('lang','en');
    await selectLanguage(page,'auto'); await expect(page.locator('html')).toHaveAttribute('lang','zh-CN');
    expect(await page.evaluate(()=>localStorage.getItem('piwork.ui-locale'))).toBeNull();
    await page.reload(); await expect(page.locator('html')).toHaveAttribute('lang','zh-CN');
  } finally {await context.close();}
});

test('异步动作等待、刷新和缓存错误按当前语言渲染', async ({ page }) => {
  await mockConsole(page, { authenticated: true });
  await page.goto(`${base}/admin`);
  const result = await page.evaluate(async () => {
    const { ActionState } = await import('/browser/action-state.js');
    const { ConsoleError } = await import('/browser/adapter.js');
    const { chooseLocale, LocalizedMessage, t } = await import('/browser/locale.js');
    const actions = new ActionState(() => {}, () => 12000);
    try {
      chooseLocale('en');
      const record = actions.begin({ key: 'test-read', kind: 'read', label: 'Core', target: 'Core' });
      record.started = 0;
      const waitingEn = actions.message(record);
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      const refresh = actions.refresh(record, () => gate);
      chooseLocale('zh-CN');
      const refreshingZh = actions.message(record);
      release();
      await refresh;
      actions.finish(record);
      const checkedZh = actions.message(record);
      chooseLocale('en');
      await actions.refresh(record, async () => { throw new ConsoleError('CORE_UNREACHABLE', new LocalizedMessage('adapter.explain.CORE_UNREACHABLE')); });
      const failedEn = actions.message(record);
      chooseLocale('zh-CN');
      const failedZh = actions.message(record);
      actions.fail(record, new ConsoleError('RESULT_UNKNOWN', new LocalizedMessage('adapter.error.resultUnknown')));
      const errorZh = actions.message(record);
      chooseLocale('en');
      const errorEn = actions.message(record);
      return { waitingEn, refreshingZh, checkedZh, failedEn, failedZh, errorZh, errorEn };
    } finally { actions.clear(); }
  });
  expect(result.waitingEn).toContain('Still waiting (12s)');
  expect(result.refreshingZh).toContain('仍在等待（12 秒）');
  expect(result.refreshingZh).toContain('正在刷新');
  expect(result.refreshingZh).not.toMatch(/Still waiting|Refreshing/);
  expect(result.checkedZh).toContain(zh['action.checked']);
  expect(result.failedEn).toContain(en['adapter.explain.CORE_UNREACHABLE']);
  expect(result.failedZh).toContain(zh['adapter.explain.CORE_UNREACHABLE']);
  expect(result.failedZh).toContain('尚未确认刷新结果');
  expect(result.failedZh).not.toContain(en['adapter.explain.CORE_UNREACHABLE']);
  expect(result.errorZh).toContain(zh['adapter.error.resultUnknown']);
  expect(result.errorEn).toContain(en['adapter.error.resultUnknown']);
});

test('已有 Core 状态反馈随语言切换，且不会再次刷新', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-US' });
  await seedLocale(context, 'en');
  const page = await context.newPage();
  try {
    await mockConsole(page, { authenticated: true });
    let reads = 0;
    page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/console/api/admin/status')) reads++; });
    await page.goto(`${base}/admin`);
    await expect(page.locator('[data-action="refresh-status"]')).toBeVisible();
    await page.locator('[data-action="refresh-status"]').click();
    await expect(page.locator('.feedback').filter({ hasText: en['status.refreshed'] })).toBeVisible();
    const before = reads;
    await selectLanguage(page, 'zh-CN');
    await expect(page.locator('.feedback').filter({ hasText: zh['status.refreshed'] })).toBeVisible();
    await expect(page.locator('.feedback').filter({ hasText: en['status.refreshed'] })).toHaveCount(0);
    expect(reads).toBe(before);
    await selectLanguage(page, 'en');
    await expect(page.locator('.feedback').filter({ hasText: en['status.refreshed'] })).toBeVisible();
    expect(reads).toBe(before);
  } finally {
    await context.close();
  }
});

test('已缓存的 Core 读取错误随语言切换', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-US' });
  await seedLocale(context, 'en');
  const page = await context.newPage();
  try {
    await mockConsole(page, { authenticated: true });
    let fail = false;
    await page.route('**/console/api/admin/status', route => fail
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'CORE_UNREACHABLE' }) })
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ready: true, state: 'READY', checks: { runtimeConfigured: true } }) }));
    await page.goto(`${base}/admin`);
    await expect(page.locator('[data-action="refresh-status"]')).toBeVisible();
    fail = true;
    await page.locator('[data-action="refresh-status"]').click();
    await expect(page.locator('#core-checks')).toContainText(en['adapter.explain.CORE_UNREACHABLE']);
    await selectLanguage(page, 'zh-CN');
    await expect(page.locator('#core-checks')).toContainText(zh['adapter.explain.CORE_UNREACHABLE']);
    await expect(page.locator('#core-checks')).not.toContainText(en['adapter.explain.CORE_UNREACHABLE']);
  } finally {
    await context.close();
  }
});

test('账号菜单只有一个语言入口，选择浮层关闭并将焦点返回头像', async ({ browser }) => {
  const context=await browser.newContext({locale:'zh-CN',viewport:{width:1440,height:900}});const page=await context.newPage();
  try {
    await mockConsole(page,{authenticated:true});await page.goto(`${base}/admin`);
    const trigger=page.locator('#account-trigger');await trigger.focus();await trigger.press('ArrowDown');
    const menu=page.locator('#account-dropdown');await expect(menu.locator('[data-locale]')).toHaveCount(0);
    await page.keyboard.press('ArrowDown');await expect(menu.locator('[data-action="language"]')).toBeFocused();
    await page.keyboard.press('Enter');await expect(menu).toBeHidden();
    await expect(page.locator('[data-locale="auto"]')).toHaveAttribute('aria-selected','true');
    await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');await expect(page.locator('html')).toHaveAttribute('lang','en');
    await expect(page.locator('.language-picker')).toHaveCount(0);await expect(trigger).toBeFocused();
    await openLanguage(page);await page.screenshot({path:fileURLToPath(new URL('../../../dist/language-picker-admin-1440.png',import.meta.url))});
    await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
  }finally{await context.close();}
});

test('setup 引导页语言切换不提交表单、不刷新并保留账号草稿', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 800 } });
  await seedLocale(context, 'zh-CN');
  const page = await context.newPage();
  const requests = [];
  try {
    await mockSetup(page, requests);
    await page.goto(`${base}/setup`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(zh['onboarding.title.login']);

    await expect(page.locator('[data-language-trigger]')).toBeVisible();

    const account = page.getByLabel(zh['onboarding.form.account'], { exact: true });
    const password = page.getByLabel(zh['onboarding.form.password'], { exact: true });
    await account.fill('draft-admin');
    await password.fill('draft-password');
    await page.evaluate(() => {
      window.__localeSwitchSurvived = true;
    });

    await selectLanguage(page, 'en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en['onboarding.title.login']);
    await expect(page).toHaveURL(`${base}/setup`);
    // 整页刷新会丢掉标记；表单提交会清空账号或跳转。
    expect(await page.evaluate(() => window.__localeSwitchSurvived)).toBe(true);
    await expect(page.getByLabel(en['onboarding.form.account'], { exact: true })).toHaveValue('draft-admin');
    await expect(page.getByLabel(en['onboarding.form.password'], { exact: true })).toHaveValue('draft-password');
    expect(requests.filter((item) => item.method === 'POST')).toHaveLength(0);

    await selectLanguage(page, 'zh-CN');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(account).toHaveValue('draft-admin');
    await expect(password).toHaveValue('draft-password');
  } finally {
    await context.close();
  }
});

test('创建管理员时切换语言保留密码与确认密码', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN' });
  const page = await context.newPage();
  try {
    await mockSetup(page);
    await page.route('**/_web/api/state', route => route.fulfill({ json: { administratorInitialized: false } }));
    await page.goto(`${base}/setup`);
    await page.getByLabel(zh['onboarding.form.password'], { exact: true }).fill('synthetic-password');
    await page.getByLabel(zh['onboarding.form.confirmPassword'], { exact: true }).fill('synthetic-password');
    await selectLanguage(page, 'en');
    await expect(page.getByLabel(en['onboarding.form.password'], { exact: true })).toHaveValue('synthetic-password');
    await expect(page.getByLabel(en['onboarding.form.confirmPassword'], { exact: true })).toHaveValue('synthetic-password');
  } finally { await context.close(); }
});

test('中英文概览对已配置但未就绪的 Runtime 判断一致', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN' });
  const page = await context.newPage();
  try {
    await mockConsole(page, { authenticated: true });
    await page.route('**/console/api/admin/status', route => route.fulfill({ json: { ready: false, checks: { runtimeConfigured: true } } }));
    await page.goto(`${base}/admin`);
    await expect(page.getByTestId('overview-next-task')).toContainText(zh['status.runtimeAttentionTitle']);
    await expect(page.getByTestId('overview-next-task')).toContainText(zh['adapter.health.unknown']);
    await switchLocaleFromAccountMenu(page, 'en');
    await expect(page.getByTestId('overview-next-task')).toContainText(en['status.runtimeAttentionTitle']);
    await expect(page.getByTestId('overview-next-task')).toContainText(en['adapter.health.unknown']);
    await switchLocaleFromAccountMenu(page, 'zh-CN');
    await expect(page.getByTestId('overview-next-task')).toContainText(zh['status.runtimeAttentionTitle']);
  } finally { await context.close(); }
});

test('引导脚本不可用时显示所选语言的刷新入口', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN' });
  const page = await context.newPage();
  try {
    await page.route('**/setup/browser/onboarding.js', route => route.abort());
    await page.goto(`${base}/setup`);
    await expect(page.locator('[data-boot-recovery]')).toHaveText('如果页面无法加载，请刷新页面。');
    await expect(page.locator('[data-boot-recovery]')).toHaveAttribute('href', '');
  } finally { await context.close(); }
});

test('管理界面入口脚本不可用时提供刷新入口', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  try {
    await page.route('**/browser/app.js', route => route.abort());
    await page.goto(`${base}/admin`);
    await expect(page.locator('[data-boot-recovery]')).toHaveText('If the page cannot load, reload it.');
  } finally { await context.close(); }
});

test('未知引导错误使用本地化说明而非上游原文', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN' });
  const page = await context.newPage();
  try {
    await mockSetup(page);
    await page.route('**/_web/api/login', route => route.fulfill({ status: 400, json: { code: 'UNKNOWN_FIXTURE', message: 'Untranslated upstream diagnostic' } }));
    await page.goto(`${base}/setup`);
    await page.getByLabel(zh['onboarding.form.account'], { exact: true }).fill('synthetic');
    await page.getByLabel(zh['onboarding.form.password'], { exact: true }).fill('synthetic-password');
    await page.locator('#credentials button[type=submit]').click();
    await expect(page.locator('#setup-notice')).toContainText(zh['net.requestFailed']);
    await expect(page.locator('#setup-notice')).not.toContainText('Untranslated upstream diagnostic');
  } finally { await context.close(); }
});

test('模型保存错误在切换语言后按当前语言呈现', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  try {
    await mockConsole(page, { authenticated: true });
    await page.route('**/console/api/admin/models', route => route.request().method() === 'GET'
      ? route.fulfill({ json: { models: [] } })
      : route.fulfill({ status: 409, json: { code: 'MODEL_IN_USE', message: 'upstream message' } }));
    await page.goto(`${base}/admin/models`);
    await page.locator('#model-id').fill('fixture-model');
    await page.locator('#model-base-url').fill('https://example.invalid/v1');
    await page.locator('#model-key').fill('synthetic-key');
    await page.locator('[data-model-form] button[type=submit]').click();
    await expect(page.locator('#model-note')).toContainText(en['adapter.explain.MODEL_IN_USE']);
    await switchLocaleFromAccountMenu(page, 'zh-CN');
    await expect(page.locator('#model-note')).toContainText(zh['adapter.explain.MODEL_IN_USE']);
  } finally { await context.close(); }
});

test('模型管理未知服务端错误使用中文主说明', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN' });
  const page = await context.newPage();
  try {
    await mockConsole(page, { authenticated: true });
    await page.route('**/console/api/admin/models', route => route.request().method() === 'GET'
      ? route.fulfill({ json: { models: [] } })
      : route.fulfill({ status: 409, json: { code: 'UNKNOWN_FIXTURE', message: 'Untranslated upstream diagnostic' } }));
    await page.goto(`${base}/admin/models`);
    await page.locator('#model-id').fill('fixture-model');
    await page.locator('#model-base-url').fill('https://example.invalid/v1');
    await page.locator('#model-key').fill('synthetic-key');
    await page.locator('[data-model-form] button[type=submit]').click();
    await expect(page.locator('#model-note')).toContainText('请求失败（UNKNOWN_FIXTURE）');
    await expect(page.locator('#model-note')).not.toContainText('Untranslated upstream diagnostic');
  } finally { await context.close(); }
});

test('localStorage 不可用时仍能切换语言并使用登录页', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 800 } });
  await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('storage denied', 'SecurityError');
      },
    });
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await mockConsole(page);
    await page.goto(`${base}/login`);
    // Storage is denied, so the browser preference still decides the first render.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(zh['login.title']);
    expect(
      await page.evaluate(() => {
        try {
          window.localStorage.getItem('piwork.ui-locale');
          return 'available';
        } catch {
          return 'denied';
        }
      }),
    ).toBe('denied');

    await selectLanguage(page, 'en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en['login.title']);
    await expect(page.getByLabel(en['login.account'], { exact: true })).toBeVisible();
    await expect(page.locator('#login-form button[type=submit]')).toContainText(en['login.signIn']);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('360px 登录页与选择浮层无溢出，Tab与外侧关闭保持焦点', async ({browser})=>{
  const context=await browser.newContext({locale:'zh-CN',viewport:{width:360,height:800}});const page=await context.newPage();
  try{
    await mockConsole(page);await page.goto(`${base}/login`);
    const trigger=page.locator('[data-language-trigger]');await trigger.focus();await page.keyboard.press('Enter');
    await expect(page.locator('.language-picker')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.keyboard.press('Tab');await expect(page.locator('.language-picker')).toHaveCount(0);await expect(trigger).not.toBeFocused();
    await openLanguage(page);await page.locator('#account').click();await expect(page.locator('.language-picker')).toHaveCount(0);await expect(page.locator('#account')).toBeFocused();
  }finally{await context.close();}
});

// ---- 上下文保持：Quick setup 保存中与缓存错误下的语言切换 ----

/** 手动放行的请求闸门，用于把保存/绑定保持在“在途”状态。 */
function gate() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function quickSetupTitle(localeCatalog) {
  return localeCatalog['title.format'].replace('{page}', localeCatalog['module.quickSetup']);
}

/**
 * 以 hosted 模式挂载真实 Console shell 中的 Quick setup（/admin/setup）。
 * mockConsole 提供会话与可用性；后注册的 models/runtime 路由优先于其通用路由。
 */
async function mockQuickSetup(page, state) {
  await mockConsole(page, { authenticated: true });
  await page.route('**/_web/api/onboarding', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.snapshot) }),
  );
  await page.route('**/console/api/admin/models', async (route) => {
    const request = route.request();
    const method = request.method();
    const body = method === 'POST' ? request.postDataJSON() : null;
    state.requests.push({ method, path: new URL(request.url()).pathname, body });
    if (method === 'GET') {
      await route.fulfill({
        status: state.catalogStatus ?? 200,
        contentType: 'application/json',
        body: JSON.stringify(state.catalogBody ?? { models: state.models }),
      });
      return;
    }
    await state.modelsGate?.promise;
    const model = {
      id: 'model-quick-1',
      modelRef: 'model-quick-1',
      name: body.name || body.model,
      model: body.model,
      api: body.api,
      baseUrl: body.baseUrl,
      enabled: true,
      credentialAvailable: true,
    };
    state.models.push(model);
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(model) });
  });
  await page.route('**/console/api/admin/runtime', async (route) => {
    const request = route.request();
    const body = request.postDataJSON();
    state.requests.push({ method: request.method(), path: new URL(request.url()).pathname, body });
    await state.runtimeGate?.promise;
    state.snapshot.runtime = {
      configured: true,
      modelRef: body.modelRef,
      agentImage: 'agent:synthetic',
      model: { provider: 'custom', id: body.modelRef, credentialAvailable: true },
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ runtime: state.snapshot.runtime, status: state.snapshot.status }),
    });
  });
}

/** 通过 Admin 账号菜单切换语言：Quick setup 与 Admin 共用同一顶栏。 */
async function switchLocaleFromAccountMenu(page, locale) { await selectLanguage(page,locale); }

function quickSetupSnapshot() {
  return {
    administrator: true,
    defaultAgentImage: 'agent:synthetic',
    runtime: { configured: false },
    status: { ready: false },
    preparation: { ready: false, components: {} },
  };
}

test('Quick setup 模型保存请求在途时切换语言只提交一次并保留非敏感草稿', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
  await seedLocale(context, 'zh-CN');
  const page = await context.newPage();
  const state = {
    models: [],
    requests: [],
    modelsGate: gate(),
    runtimeGate: gate(),
    snapshot: quickSetupSnapshot(),
  };
  const saves = () =>
    state.requests.filter((item) => item.method === 'POST' && item.path === '/console/api/admin/models');
  const bindings = () =>
    state.requests.filter((item) => item.method === 'PUT' && item.path === '/console/api/admin/runtime');
  try {
    await mockQuickSetup(page, state);
    await page.goto(`${base}/admin/setup`);
    await expect(page.locator('#setup-title')).toHaveText(zh['setup.title.model']);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');

    // 首次安装的空目录是 Key-only 草稿；展开高级项填写 Model ID。
    await page.locator('#model-key').fill('synthetic-key');
    await page.locator('#model-advanced summary').click();
    await page.locator('#model-id').fill('custom-model');
    const baseUrl = await page.locator('#model-base-url').inputValue();
    expect(baseUrl).not.toBe('');

    await page.locator('[data-continue]').click();
    await expect.poll(() => saves().length).toBe(1);
    await expect(page.locator('[data-continue]')).toHaveAttribute('aria-busy', 'true');
    const duringSave = state.requests.length;
    await page.evaluate(() => {
      window.__quickLocaleSurvived = true;
    });

    // 保存未完成时切换语言：presentation 更新，但表单与在途请求保持不变。
    await switchLocaleFromAccountMenu(page, 'en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    // 不刷新、不导航：文档存活，URL 与请求数不变。
    expect(await page.evaluate(() => window.__quickLocaleSurvived)).toBe(true);
    await expect(page).toHaveURL(`${base}/admin/setup`);
    expect(state.requests.length).toBe(duringSave);
    await expect(page.locator('#setup-status')).toContainText(en['setup.status.saving']);
    await expect(page.locator('#model-id')).toHaveValue('custom-model');
    await expect(page.locator('#model-base-url')).toHaveValue(baseUrl);
    // 敏感值不写入浏览器存储，也不在重渲染后的输入框中回显。
    await expect(page.locator('#model-key')).toHaveValue('');
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(
      'synthetic-key',
    );
    // 切换本身不触发重发，也未越过尚未完成的保存。
    expect(saves()).toHaveLength(1);
    expect(bindings()).toHaveLength(0);

    state.modelsGate.resolve();
    // 在途保存完成后，反馈使用切换后的语言（catalog 值），绑定仍只发起一次。
    await expect(page.locator('#setup-notice')).toContainText(en['setup.modelSaved.binding']);
    await expect.poll(() => bindings().length).toBe(1);

    state.runtimeGate.resolve();
    await expect(page.locator('#quick-setup')).toContainText(en['setup.preparation.description']);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    // 无自动重发：模型保存与运行时绑定各一次。
    await page.waitForTimeout(300);
    expect(saves()).toHaveLength(1);
    expect(bindings()).toHaveLength(1);
    expect(saves()[0].body).toMatchObject({ model: 'custom-model', baseUrl, credential: 'synthetic-key' });
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(
      'synthetic-key',
    );
    expect(await page.evaluate(() => window.__quickLocaleSurvived)).toBe(true);
    // 完成保存只通过 history.replaceState 把 step 写进同一文档的 URL。
    expect(new URL(page.url()).pathname).toBe('/admin/setup');
  } finally {
    await context.close();
  }
});

test('Quick setup 缓存错误切换语言后重渲染并隐藏未知上游文案', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
  await seedLocale(context, 'zh-CN');
  const page = await context.newPage();
  const state = {
    models: [],
    requests: [],
    catalogStatus: 503,
    catalogBody: { message: 'Synthetic catalog unavailable' },
    snapshot: quickSetupSnapshot(),
  };
  const reads = () =>
    state.requests.filter((item) => item.method === 'GET' && item.path === '/console/api/admin/models');
  try {
    await mockQuickSetup(page, state);
    await page.goto(`${base}/admin/setup`);
    const note = page.locator('#catalog-note');
    await expect(note).toContainText(zh['setup.model.catalogUnavailable']);
    await expect(note).toContainText(zh['setup.model.catalogRetry']);
    await expect(note).toContainText(zh['net.requestFailed']);
    await expect(note).not.toContainText('Synthetic catalog unavailable');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page).toHaveTitle(quickSetupTitle(zh));
    await expect.poll(() => reads().length).toBe(1);
    const beforeSwitch = state.requests.length;

    // 读取已经失败并缓存；切换语言只重渲染，不重新请求。
    await switchLocaleFromAccountMenu(page, 'en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(state.requests.length).toBe(beforeSwitch);
    await expect(page).toHaveURL(`${base}/admin/setup`);
    await expect(note).toContainText(en['setup.model.catalogUnavailable']);
    await expect(note).toContainText(en['setup.model.catalogRetry']);
    await expect(note).not.toContainText(zh['setup.model.catalogUnavailable']);
    // 未经确认的服务端自然语言不替代本地化说明。
    const text = await note.innerText();
    expect(text).toContain(en['net.requestFailed']);
    expect(text).not.toContain('Synthetic catalog unavailable');
    expect(reads()).toHaveLength(1);
    await page.waitForTimeout(300);
    expect(reads()).toHaveLength(1);
  } finally {
    await context.close();
  }
});

test('Quick setup 切换语言同步更新 html lang 与文档标题', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
  await seedLocale(context, 'zh-CN');
  const page = await context.newPage();
  const state = { models: [], requests: [], snapshot: quickSetupSnapshot() };
  try {
    await mockQuickSetup(page, state);
    await page.goto(`${base}/admin/setup`);
    await expect(page.locator('#setup-title')).toHaveText(zh['setup.title.model']);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page).toHaveTitle(quickSetupTitle(zh));

    await switchLocaleFromAccountMenu(page, 'en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#setup-title')).toHaveText(en['setup.title.model']);
    // 已知产品缺陷：Quick setup 已挂载时切换语言只更新 html lang，文档标题保持旧语言。
    await expect(page, 'Quick setup 切换语言后文档标题应与所选语言一致').toHaveTitle(
      quickSetupTitle(en),
      { timeout: 1500 },
    );
  } finally {
    await context.close();
  }
});
