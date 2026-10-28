// UIL-I18N-001 / UIL-I18N-002 的浏览器契约测试。
//
// 轻量方案：用本地静态服务器提供构建后的 Desktop 入口与 browser 模块，并 mock
// `/_desktop/api/*`，让应用分别进入登录页（signed-out）与 Works 页（authenticated）。
// 断言文本一律取自构建产物 catalog，避免把译文写死在测试里。
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium, expect, type Page } from '@playwright/test';

const { catalog } = (await import(
  new URL('../browser/i18n/catalog.js', import.meta.url).href
)) as { catalog: Record<string, Record<string, string>> };
const runtime = (await import(new URL('../browser/i18n.js', import.meta.url).href)) as {
  LOCALE_STORAGE_KEY: string;
  matchLocale(languages?: readonly string[]): string;
  resolveLocale(options?: { storage?: Storage | null; languages?: readonly string[] }): { locale: string; saved: boolean };
};

const en = catalog.en ?? {};
const zh = catalog['zh-CN'] ?? {};
const LOCALE_KEY = runtime.LOCALE_STORAGE_KEY;

/** Catalog 值必须存在；测试失败时给出缺失的 key，而不是静默变成 undefined。 */
function text(table: Record<string, string>, key: string): string {
  const value = table[key];
  assert.equal(typeof value, 'string', `catalog 缺少 ${key}`);
  assert.notEqual(value, '', `catalog ${key} 为空`);
  return value as string;
}

const launchOptions = process.env.PIWORK_TEST_BROWSER_BIN
  ? { headless: true, executablePath: process.env.PIWORK_TEST_BROWSER_BIN }
  : { headless: true, channel: 'chromium' as const };

type SessionMode = 'signed-out' | 'authenticated';

const staticFiles: Record<string, string> = {
  '/': 'public/index.html',
  '/index.html': 'public/index.html',
  '/style.css': 'public/style.css',
  '/desktop/piwork-logo.png': 'public/piwork-logo.png',
};

/** 一次测试服务器收到的请求；path 与 adapter 使用的一致（去掉 `/_desktop/api/` 前缀）。 */
interface RecordedRequest {
  path: string;
  method: string;
  url: string;
  host: string;
  body: string;
}

/** 自定义路由的返回值；gate 让响应保持挂起，用于验证“在途请求”。 */
interface MockReply {
  status?: number;
  json?: unknown;
  body?: string;
  headers?: Record<string, string>;
  gate?: Promise<void>;
}

interface AppOptions {
  /** 先于内置 mock 处理；返回 undefined 表示交给内置逻辑。 */
  routes?: (request: RecordedRequest) => MockReply | undefined | Promise<MockReply | undefined>;
  /** 测试侧传入的请求记录数组，便于断言请求次数与方法。 */
  requests?: RecordedRequest[];
}

/** 提供构建后的入口、样式、logo、browser 模块，并 mock Desktop 本机会话/Work/Service API。 */
async function startApp(mode: SessionMode, options: AppOptions = {}): Promise<{ base: string; close: () => Promise<void>; requests: RecordedRequest[] }> {
  const now = new Date().toISOString();
  const requests = options.requests ?? [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://fixture');
      const path = url.pathname;
      const chunks: Buffer[] = [];
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        for await (const chunk of request) chunks.push(chunk as Buffer);
      }
      const record: RecordedRequest = {
        path: path.startsWith('/_desktop/api/') ? path.slice('/_desktop/api/'.length) : path,
        method: request.method ?? 'GET',
        url: `${path}${url.search}`,
        host: request.headers.host ?? '',
        body: Buffer.concat(chunks).toString(),
      };
      requests.push(record);
      const reply = await options.routes?.(record);
      if (reply) {
        if (reply.gate) await reply.gate;
        const headers: Record<string, string> = { ...(reply.headers ?? {}) };
        if (reply.json !== undefined) {
          headers['content-type'] ??= 'application/json';
          response.writeHead(reply.status ?? 200, headers);
          response.end(JSON.stringify(reply.json));
        } else {
          response.writeHead(reply.status ?? 200, headers);
          response.end(reply.body ?? '');
        }
        return;
      }
      if (path.startsWith('/_desktop/api/')) {
        const api = path.slice('/_desktop/api/'.length);
        const json = (value: unknown, status = 200) => {
          response.writeHead(status, { 'content-type': 'application/json' });
          response.end(JSON.stringify(value));
        };
        if (api === 'session') {
          const body = mode === 'authenticated'
            ? { state: 'authenticated', csrf: 'csrf-language-test', generation: 1, coreUrl: 'http://127.0.0.1:7181',
                user: { id: 'user-language', account: 'owner', role: 'user' }, lastConfirmedAt: now }
            : { state: 'signed-out', csrf: 'csrf-language-test', generation: 1, coreUrl: 'http://127.0.0.1:7181' };
          json(body);
          return;
        }
        if (api === 'status') {
          json({ health: { available: true }, readiness: { available: true, value: { ready: true } }, checkedAt: now });
          return;
        }
        if (api === 'preferences') { json({ coreUrl: null }); return; }
        if (api === 'works') {
          json({ works: [{ id: 'work-alpha', name: 'Alpha Work', desiredState: 'stopped',
            observedState: 'stopped', controlVersion: 1, updatedAt: now }] });
          return;
        }
        if (api === 'skills') { json({ skills: [] }); return; }
        if (api === 'packages') { json({ packages: [] }); return; }
        if (api === 'known-operations') { json({ operations: [] }); return; }
        // Work 详情相关的只读资源：没有显式断言时给出稳定、无写入的形状。
        const resource = /^works\/[^/]+\/(.+)$/.exec(api);
        if (resource) {
          const name = resource[1] ?? '';
          if (name === 'configuration') {
            json({ desired: { skills: [], packages: [], agentsMd: '', mcp: { servers: [] } }, active: {},
              pendingApply: false, runtime: { state: 'ready' } });
            return;
          }
          if (name === 'packages') { json({ packages: [] }); return; }
          if (name === 'services') { json({ services: [] }); return; }
          if (name === 'sessions') { json({ sessions: [] }); return; }
          if (name === 'chat-capabilities') { json({ contractVersion: 3 }); return; }
          if (name === 'chat-models' || name === 'models') {
            json({ contractVersion: 3, models: [], defaultModel: { modelRef: null, label: 'Default chat model',
              provider: 'fixture', model: 'one', thinkingLevels: ['off'], defaultThinkingLevel: 'off' },
              availability: 'available', checkedAt: now });
            return;
          }
          if (name === 'commands') { json({ contractVersion: 1, commands: [], checkedAt: now }); return; }
          if (name === 'chat-image-capabilities') { json({ profile: 'chat-images-v1' }); return; }
          if (name.startsWith('agent-requests')) { json({ items: [], nextCursor: null }); return; }
        }
        if (api.startsWith('operations/')) {
          json({ operationId: api.slice('operations/'.length), state: 'succeeded', error: null });
          return;
        }
        json({}, 404);
        return;
      }
      const file = staticFiles[path];
      if (file) {
        const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'image/png';
        response.setHeader('content-type', type);
        response.end(await readFile(new URL(`../${file}`, import.meta.url)));
        return;
      }
      if (path.startsWith('/desktop/browser/')) {
        // 保留 i18n/ 等子目录，不能摊平成 basename。
        const module = decodeURIComponent(path.slice('/desktop/browser/'.length));
        response.setHeader('content-type', module.endsWith('.js') ? 'application/javascript' : 'application/octet-stream');
        response.end(await readFile(new URL(`../browser/${module}`, import.meta.url)));
        return;
      }
      response.writeHead(404);
      response.end();
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>(resolve => { server.close(() => resolve()); }),
    requests,
  };
}

/** 在当前 origin 预置显式语言选择，模拟同源已保存的偏好。 */
async function seedLocale(page: Page, locale: string): Promise<void> {
  await page.evaluate(([key, value]) => localStorage.setItem(key!, value!), [LOCALE_KEY, locale]);
}

/** 打开登录前的账号菜单（role=menu），它的语言行是 role=menuitemradio。 */
async function openAccountMenu(page: Page): Promise<void> {
  const trigger=page.locator('[data-language-trigger="topbar"]');
  await trigger.focus();await page.keyboard.press('Enter');
  await expect(page.locator('.language-picker')).toBeVisible();
}

/** 用方向键把焦点移到指定语言行；返回是否到达。 */
async function focusLanguageRow(page: Page, locale: string): Promise<boolean> {
  for (let i = 0; i < 16; i++) {
    const active = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-locale') ?? null);
    if (active === locale) return true;
    await page.keyboard.press('ArrowDown');
  }
  return false;
}

/** 通过页面上的语言触发器切换并关闭弹出的语言对话框。 */
async function switchLocale(page: Page, locale: string): Promise<void> {
  const direct=page.locator('[data-language-trigger="topbar"],[data-language-trigger="settings"]').first();
  if(await direct.isVisible()) await direct.click();
  else {
    const work=page.locator('[data-action="work-menu"]');
    await (await work.isVisible()?work:page.locator('[data-action="account"]').first()).click();
    await page.locator('#modal [data-action="language"]').click();
  }
  await page.locator('.language-picker').waitFor();
  await page.locator(`.language-picker [data-locale="${locale}"]`).click();
  if(locale!=='auto')await expect(page.locator('html')).toHaveAttribute('lang',locale);
  await expect(page.locator('.language-picker')).toHaveCount(0);
}

/** 只统计会改变服务端状态的方法，用来证明切换语言没有产生业务写入。 */
const isWriteMethod = (method: string): boolean => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);

test('共享语言运行时按浏览器偏好顺序匹配并让显式选择优先', () => {
  assert.equal(runtime.matchLocale(['zh-CN']), 'zh-CN');
  assert.equal(runtime.matchLocale(['zh-TW']), 'zh-CN');
  assert.equal(runtime.matchLocale(['fr-FR', 'en-US']), 'en');
  assert.equal(runtime.matchLocale(['fr-FR']), 'en');
  assert.equal(runtime.matchLocale([]), 'en');

  const savedZh = { getItem: () => 'zh-CN' } as unknown as Storage;
  assert.deepEqual(runtime.resolveLocale({ storage: savedZh, languages: ['en-US'] }), { locale: 'zh-CN', saved: true });
  assert.deepEqual(runtime.resolveLocale({ storage: null, languages: ['zh-CN', 'zh-TW'] }), { locale: 'zh-CN', saved: false });
  assert.deepEqual(runtime.resolveLocale({ storage: null, languages: ['fr-FR', 'en-US'] }), { locale: 'en', saved: false });
  const invalid = { getItem: () => 'fr-FR' } as unknown as Storage;
  assert.deepEqual(runtime.resolveLocale({ storage: invalid, languages: ['en-US'] }), { locale: 'en', saved: false });
});

test('显式选择 zh-CN 时登录页、文档语言、标题和语言菜单均为中文', async () => {
  const app = await startApp('signed-out');
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(`${app.base}/`);
    await seedLocale(page, 'zh-CN');
    await page.reload();
    await page.getByRole('heading', { name: text(zh, 'auth.connectToCore'), exact: true }).waitFor();

    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page).toHaveTitle(text(zh, 'doc.connect'));
    assert.equal(await page.getByLabel(text(zh, 'auth.account'), { exact: true }).count(), 1);
    assert.equal(await page.getByLabel(text(zh, 'auth.password'), { exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: text(zh, 'auth.signIn'), exact: true }).count(), 1);

    const trigger = page.locator('[data-action="language"]').first();
    await expect(trigger).toHaveText(new RegExp(text(zh, 'lang.menu')));
    assert.equal(await trigger.getAttribute('aria-label'), text(zh, 'lang.triggerAria').replace('{language}', text(zh, 'lang.zh')));

    await trigger.click();
    await page.locator('.language-picker').waitFor();
    await expect(trigger).toHaveAttribute('aria-expanded','true');
    const triggerBox = (await trigger.boundingBox())!, pickerBox = (await page.locator('.language-picker').boundingBox())!;
    assert.ok(pickerBox.y >= triggerBox.y + triggerBox.height && pickerBox.x > triggerBox.x - 260, 'selector remains anchored to its live trigger');
    const options = page.locator('.language-picker [data-locale]');
    assert.equal(await options.count(), 3);
    await expect(page.locator('.language-picker [data-locale="zh-CN"]')).toContainText(text(zh, 'lang.zh'));
    await expect(page.locator('.language-picker [data-locale="en"]')).toContainText(text(zh, 'lang.en'));
    await expect(page.locator('.language-picker [data-locale="zh-CN"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.language-picker [data-locale="en"]')).toHaveAttribute('aria-selected', 'false');
    await page.screenshot({path:fileURLToPath(new URL('../../../../dist/language-picker-desktop-1280.png',import.meta.url))});
    await page.keyboard.press('Escape');
    await expect(page.locator('.language-picker')).toHaveCount(0);
  } finally {
    await browser.close();
    await app.close();
  }
});

test('登录前可用键盘在账号语言菜单选择 English，切换只保存 piwork.ui-locale', async () => {
  const app = await startApp('signed-out');
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(`${app.base}/`);
    await seedLocale(page, 'zh-CN');
    await page.reload();
    await page.getByRole('heading', { name: text(zh, 'auth.connectToCore'), exact: true }).waitFor();

    const beforeHistory = await page.evaluate(() => history.length);
    const beforeURL = page.url();
    await openAccountMenu(page);
    assert.equal(await focusLanguageRow(page, 'en'), true, 'English 语言行应可用方向键到达');
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: text(en, 'auth.connectToCore'), exact: true }).waitFor();

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveTitle(text(en, 'doc.connect'));
    assert.equal(page.url(), beforeURL, '切换语言不得导航');
    assert.equal(await page.evaluate(() => history.length), beforeHistory, '切换语言不得新增历史记录');

    const stored = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    assert.deepEqual(stored, { [LOCALE_KEY]: 'en' });
    assert.equal(await page.evaluate(() => localStorage.length), 1, '存储中不得出现凭证或草稿');
    assert.equal(await page.evaluate(() => Object.keys(sessionStorage).length), 0);
  } finally {
    await browser.close();
    await app.close();
  }
});

test('同源重新加载沿用显式选择：中文偏好下保存的 English 仍然生效', async () => {
  const app = await startApp('signed-out');
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(`${app.base}/`);
    await page.locator('.auth-main h1').waitFor();
    await seedLocale(page, 'en');
    await page.reload();
    await page.getByRole('heading', { name: text(en, 'auth.connectToCore'), exact: true }).waitFor();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    // 显式选择优先于浏览器偏好的另一个方向：英文浏览器下保存 zh-CN。
    await seedLocale(page, 'zh-CN');
    await page.reload();
    await page.getByRole('heading', { name: text(zh, 'auth.connectToCore'), exact: true }).waitFor();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  } finally {
    await browser.close();
    await app.close();
  }
});

test('本地存储读写抛错时页面仍可加载并切换语言', async () => {
  const app = await startApp('signed-out');
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    const denied = () => { throw new DOMException('Storage denied', 'SecurityError'); };
    Object.defineProperty(Storage.prototype, 'getItem', { configurable: true, value: denied });
    Object.defineProperty(Storage.prototype, 'setItem', { configurable: true, value: denied });
    Object.defineProperty(Storage.prototype, 'removeItem', { configurable: true, value: denied });
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  try {
    await page.goto(`${app.base}/`);
    await page.getByRole('heading', { name: text(en, 'auth.connectToCore'), exact: true }).waitFor();
    assert.equal(await page.evaluate(() => { try { localStorage.getItem('x'); return 'readable'; } catch { return 'threw'; } }), 'threw');

    await openAccountMenu(page);
    assert.equal(await focusLanguageRow(page, 'zh-CN'), true, '存储失败时仍应能到达语言行');
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: text(zh, 'auth.connectToCore'), exact: true }).waitFor();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    assert.equal(await page.getByRole('button', { name: text(zh, 'auth.signIn'), exact: true }).count(), 1);

    // 无持久存储时不得声称已保存；重载后仍按可取得的偏好加载且不白屏。
    await page.reload();
    await page.getByRole('heading', { name: text(en, 'auth.connectToCore'), exact: true }).waitFor();
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
    await app.close();
  }
});

test('360px 窄屏下语言触发器可键盘到达、菜单可用且无横向溢出', async () => {
  const app = await startApp('signed-out');
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 360, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(`${app.base}/`);
    await page.getByRole('heading', { name: text(en, 'auth.connectToCore'), exact: true }).waitFor();

    let reached = false;
    for (let i = 0; i < 8 && !reached; i++) {
      reached = await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.getAttribute('data-action') === 'language');
      if (!reached) await page.keyboard.press('Tab');
    }
    assert.equal(reached, true, '语言触发器应可用 Tab 到达');

    const trigger = page.locator('[data-action="language"]').first();
    const box = await trigger.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 360, '触发器不得溢出 360px 视口');
    await page.keyboard.press('Enter');
    await page.locator('.language-picker').waitFor();
    await expect(page.locator('.language-picker [data-locale="zh-CN"]')).toBeVisible();
    await expect(page.locator('.language-picker [data-locale="en"]')).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
      '语言菜单打开后页面不得出现横向滚动');
    await page.keyboard.press('Escape');
    await expect(page.locator('.language-picker')).toHaveCount(0);
  } finally {
    await browser.close();
    await app.close();
  }
});

test('在 Works 页切换语言不导航、不丢搜索输入', async () => {
  const app = await startApp('authenticated');
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(`${app.base}/`);
    await page.locator('.works-page').waitFor();
    const search = page.locator('#search');
    await search.fill('alpha draft note');
    await expect(search).toHaveValue('alpha draft note');

    const beforeURL = page.url();
    const beforeHistory = await page.evaluate(() => history.length);
    await switchLocale(page,'zh-CN');

    assert.equal(page.url(), beforeURL, '切换语言不得改变 URL');
    assert.equal(await page.evaluate(() => history.length), beforeHistory, '切换语言不得新增历史记录');
    await expect(page.locator('#search')).toHaveValue('alpha draft note');
    await expect(page.locator('#search')).toHaveAttribute('placeholder', text(zh, 'works.searchPlaceholder'));
    await expect(page.locator('#search')).toBeVisible();
  } finally {
    await browser.close();
    await app.close();
  }
});

// 回归用例：浏览器偏好必须生效；登录前的语言弹窗必须能用方向键选择另一种语言。
test('无显式选择时按浏览器语言 zh-CN 显示中文界面', async () => {
  const app = await startApp('signed-out');
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(`${app.base}/`);
    await page.locator('.auth-main h1').waitFor({ timeout: 5000 });
    assert.equal(await page.locator('.auth-main h1').innerText(), text(zh, 'auth.connectToCore'));
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  } finally {
    await browser.close();
    await app.close();
  }
});

test('登录前语言触发器弹出菜单可用方向键选择 English', async () => {
  const app = await startApp('signed-out');
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(`${app.base}/`);
    await seedLocale(page, 'zh-CN');
    await page.reload();
    await page.getByRole('heading', { name: text(zh, 'auth.connectToCore'), exact: true }).waitFor();
    const trigger = page.locator('[data-action="language"]').first();
    await trigger.focus();
    await page.keyboard.press('Enter');
    await page.locator('.language-picker').waitFor();
    assert.equal(await focusLanguageRow(page, 'en'), true);
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  } finally {
    await browser.close();
    await app.close();
  }
});

test('Work 页切换语言保留 Service iframe 文档、祖先节点、Chat 草稿与地址', async () => {
  const now = new Date().toISOString();
  const work = { id: 'work-alpha', name: 'Alpha Work', desiredState: 'running', observedState: 'ready',
    controlVersion: 1, updatedAt: now };
  const service = { serviceId: 'notes', name: 'Notes', enabled: true, observedState: 'ready',
    access: { hostname: 'notes.work.test', defaultPortName: 'web',
      ports: [{ name: 'web', port: 80, url: 'http://notes.work.test/' }] } };
  // 用 server 端计数证明 Service 文档没有再次加载（iframe 的 load/src 变化都不可信）。
  let frameLoads = 0;
  const app = await startApp('authenticated', {
    routes: (record) => {
      if (record.path === 'works') return { json: { works: [work] } };
      if (record.path === 'works/work-alpha') return { json: work };
      if (record.path === 'works/work-alpha/services') return { json: { services: [service] } };
      if (record.path === 'service-entries' && record.method === 'POST') {
        // origin 不带尾斜杠：adapter 的入口探测用 origin + '/' 还原同一地址。
        const origin = `http://${record.host}/_desktop/frame-app`;
        return { json: { entryId: 'entry-notes', origin, entryUrl: `${origin}/`, embed: 'allowed' } };
      }
      if (record.path === 'service-entries/entry-notes') return { json: { embed: 'allowed' } };
      if (record.path === '/_desktop/frame-app/') {
        frameLoads++;
        return { headers: { 'content-type': 'text/html' },
          body: '<!doctype html><html><head><title>Notes app</title></head><body><h1>Notes app</h1><input aria-label="Application draft"></body></html>' };
      }
      return undefined;
    },
  });
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(`${app.base}/#/work/work-alpha`);
    await page.getByRole('heading', { name: 'Alpha Work', exact: true }).waitFor();
    await expect(page.locator('iframe')).toBeVisible();
    await page.frameLocator('iframe').getByRole('heading', { name: 'Notes app' }).waitFor();
    await page.frameLocator('iframe').getByLabel('Application draft').fill('unsaved service input');
    // 等入口探测完成，避免把探测后的重渲染混入切换断言。
    await expect.poll(() => app.requests.filter(r => r.path === 'service-entries/entry-notes').length).toBeGreaterThan(0);
    await page.waitForTimeout(50);

    const composer = page.locator('#composer');
    await composer.waitFor();
    await composer.fill('unsaved chat draft');
    await page.locator('#chat-image-input').setInputFiles({ name: 'draft.png', mimeType: 'image/png', buffer: await readFile(new URL('../../../../fixtures/chat-images/png.png', import.meta.url)) });
    await expect(page.locator('.chat-image-draft')).toHaveCount(1);
    await expect(composer).toHaveValue('unsaved chat draft');

    const beforeURL = page.url();
    const beforeHistory = await page.evaluate(() => history.length);
    const beforeFrameLoads = frameLoads;
    const beforeWrites = app.requests.filter(r => isWriteMethod(r.method)).length;
    const before = await page.evaluate(() => {
      const frame = document.querySelector('iframe') as HTMLIFrameElement;
      const ancestors: Node[] = [];
      for (let node: Node | null = frame; node; node = node.parentNode) ancestors.push(node);
      (window as Window & { __frameContext?: unknown }).__frameContext = { frame, ancestors, src: frame.getAttribute('src') };
      return { src: frame.getAttribute('src'), ancestorCount: ancestors.length };
    });
    assert.ok(before.src, 'Service iframe 必须有入口地址');
    assert.ok(before.ancestorCount > 1, 'Service iframe 必须挂在 Work 工作区内');

    await switchLocale(page, 'zh-CN');
    await expect(page.frameLocator('iframe').getByLabel('Application draft')).toHaveValue('unsaved service input');
    await expect(page.locator('.chat-image-draft')).toContainText('draft.png');
    await expect(page.locator('.work-header .status')).toHaveText('就绪');
    await expect(page.locator('.service-toolbar .status')).toHaveText('就绪');

    // 呈现切到目标语言，包括 Chat 输入框的占位符。
    await expect(page.locator('[data-action="tab-Services"]')).toContainText(text(zh, 'work.tabServices'));
    await expect(page.locator('#composer')).toHaveAttribute('placeholder', text(zh, 'chat.composerPlaceholder'));
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    // The mounted document stays, but its accessible name follows the language.
    await expect(page.locator('iframe')).toHaveAttribute(
      'title',
      text(zh, 'service.applicationTitle').replace('{name}', 'Notes'),
    );

    // 不导航、不新增历史。
    assert.equal(page.url(), beforeURL, '切换语言不得改变 URL');
    assert.equal(await page.evaluate(() => history.length), beforeHistory, '切换语言不得新增历史记录');

    // 同一个 iframe 节点、同一 src、同一祖先链（没有被重建）。
    const after = await page.evaluate(() => {
      const saved = (window as Window & { __frameContext?: { frame: HTMLIFrameElement; ancestors: Node[]; src: string | null } }).__frameContext!;
      const frame = document.querySelector('iframe') as HTMLIFrameElement | null;
      const ancestors: Node[] = [];
      for (let node: Node | null = frame; node; node = node.parentNode) ancestors.push(node);
      return {
        sameNode: frame === saved.frame,
        connected: !!frame && frame.isConnected,
        src: frame?.getAttribute('src') ?? null,
        sameAncestors: ancestors.length === saved.ancestors.length
          && saved.ancestors.every((node, index) => ancestors[index] === node),
      };
    });
    assert.equal(after.sameNode, true, '切换语言必须复用同一个 Service iframe 节点');
    assert.equal(after.connected, true, '切换语言后 Service iframe 仍须连接在文档中');
    assert.equal(after.src, before.src, '切换语言不得改变 Service iframe 的 src');
    assert.equal(after.sameAncestors, true, '切换语言不得重建 Service iframe 的祖先节点');

    // 草稿与 Work 身份保留。
    await expect(page.locator('#composer')).toHaveValue('unsaved chat draft');
    await expect(page.getByRole('heading', { name: 'Alpha Work', exact: true })).toBeVisible();

    // 没有新的业务写入，也没有再次请求 Service 文档。
    assert.equal(frameLoads, beforeFrameLoads, '切换语言不得重新加载 Service 文档');
    assert.equal(app.requests.filter(r => isWriteMethod(r.method)).length, beforeWrites,
      '切换语言不得产生 POST/PATCH/PUT/DELETE 业务请求');

    await page.goto(`${app.base}/#/work/work-alpha/settings`);
    const trigger=page.locator('.settings-language [data-language-trigger]');
    await expect(trigger).toHaveCount(1);await trigger.focus();await page.keyboard.press('Enter');
    await expect(page.locator('.language-picker [role=option]')).toHaveCount(3);
    await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
    await switchLocale(page,'auto');
    await expect(page.locator('html')).toHaveAttribute('lang','en');
    assert.equal(await page.evaluate(()=>localStorage.getItem('piwork.ui-locale')),null);

  } finally {
    await browser.close();
    await app.close();
  }
});

test('Desktop 入口脚本无法加载时提供可理解的刷新入口', async () => {
  const app = await startApp('signed-out');
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ locale: 'zh-CN' });
  const page = await context.newPage();
  try {
    await page.route('**/desktop/browser/app.js', route => route.abort());
    await page.goto(app.base);
    await expect(page.locator('[data-boot-recovery]')).toHaveText('重新加载');
    await expect(page.locator('[data-boot-recovery]')).toHaveAttribute('type', 'submit');
  } finally { await browser.close(); await app.close(); }
});

test('在途 Works 刷新完成后按当前语言呈现，且不重复请求或清空已有数据', async () => {
  const now = new Date().toISOString();
  const work = { id: 'work-alpha', name: 'Alpha Work', desiredState: 'running', observedState: 'ready',
    controlVersion: 1, updatedAt: now };
  const secondWork = { id: 'work-beta', name: 'Beta Work', desiredState: 'stopped', observedState: 'stopped',
    controlVersion: 1, updatedAt: now };
  let gate: Promise<void> | undefined;
  let releaseGate: (() => void) | undefined;
  let worksReads = 0;
  const app = await startApp('authenticated', {
    routes: (record) => {
      if (record.path === 'works' && record.method === 'GET') {
        worksReads++;
        // 被 gate 的刷新返回第二份数据，用来证明放行后的响应确实被采纳。
        return { json: { works: gate ? [work, secondWork] : [work] }, ...(gate ? { gate } : {}) };
      }
      return undefined;
    },
  });
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(`${app.base}/`);
    await page.locator('.works-page').waitFor();
    await page.locator('[data-action="open-work"]').filter({ hasText: 'Alpha Work' }).waitFor();
    // 引导/路由各可能读一次列表；等计数稳定后再记录基线，避免把迟到的首次读取计入刷新。
    let stable = -1;
    while (stable !== worksReads) {
      stable = worksReads;
      await page.waitForTimeout(100);
    }
    const initialized = worksReads;
    assert.ok(initialized >= 1, '首次进入 Works 应读取一次列表');

    gate = new Promise<void>(resolve => { releaseGate = resolve; });
    const refresh = page.locator('[data-action="retry-works"]').first();
    await refresh.click();
    await expect.poll(() => worksReads).toBe(initialized + 1);
    await expect(refresh).toHaveAttribute('title', text(en, 'works.reading'));

    // 在途请求未完成时切换语言：呈现立即改用中文，但请求不重复。
    await switchLocale(page, 'zh-CN');
    await expect(page.locator('#search')).toHaveAttribute('placeholder', text(zh, 'works.searchPlaceholder'));
    await expect(refresh).toHaveAttribute('title', text(zh, 'works.reading'));
    await expect(page.locator('.works-footer')).toContainText(text(zh, 'works.count').replace('{count}', '1'));
    assert.equal(worksReads, initialized + 1, '切换语言不得重复提交 Works 刷新');
    assert.equal(app.requests.filter(r => isWriteMethod(r.method)).length, 0,
      '读取期间切换语言不得产生业务写请求');

    // 放行后：结果按当前中文呈现，且原有身份/数据没有被清空。
    releaseGate!();
    gate = undefined;
    await expect(refresh).toHaveAttribute('title', text(zh, 'works.refresh'));
    await expect(page.locator('.works-footer')).toContainText(text(zh, 'works.count').replace('{count}', '2'));
    await expect(page.locator('.works-footer')).toContainText('owner');
    await expect(page.locator('[data-action="open-work"]').filter({ hasText: 'Alpha Work' })).toBeVisible();
    await expect(page.locator('[data-action="open-work"]').filter({ hasText: 'Beta Work' })).toBeVisible();
    assert.equal(worksReads, initialized + 1, '一次在途 Works 刷新只应发送一次请求');
    assert.equal(app.requests.filter(r => isWriteMethod(r.method)).length, 0);
  } finally {
    releaseGate?.();
    await browser.close();
    await app.close();
  }
});
