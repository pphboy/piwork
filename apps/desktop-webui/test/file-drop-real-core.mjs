import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { expect } from '@playwright/test';

// Runs only inside real-core.mjs's isolated installation and scoped cleanup.
// CDP supplies actual local files to Chromium's native DataTransfer; no fake
// FileSystemEntry or browser-side upload adapter is substituted.
export async function fileDropAcceptance({ page, browser, coreUrl, uiUrl, token, api, waitFor, fixtureRoot, screenshotDir }) {
  const name = 'Files Drop Acceptance';
  await page.getByRole('button', { name: 'New Work', exact: true }).first().click();
  await page.locator('#create-name').fill(name);
  const receipt = page.waitForResponse(response => new URL(response.url()).pathname === '/_desktop/api/works' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create Work', exact: true }).click();
  assert.ok((await (await receipt).json()).operationId);
  const work = await waitFor(async () => (await api(coreUrl, token, 'GET', '/api/v1/works')).data.works?.find(item => item.name === name), 'isolated file-drop Work');
  const workId = work.id;
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.locator('.work-row').filter({ hasText: name })).toContainText('Ready', { timeout: 180_000 });
  const filesUrl = `${coreUrl}/api/v1/works/${workId}/files/`;
  const auth = { Authorization: `Bearer ${token}` };
  const mkdirResponse = await fetch(filesUrl + 'drop-test/', { method: 'MKCOL', headers: auth });
  assert.equal(mkdirResponse.status, 201);
  const seeded = await fetch(filesUrl + 'drop-test/existing.txt', { method: 'PUT', headers: { ...auth, 'If-None-Match': '*' }, body: 'original' });
  assert.equal(seeded.status, 201);

  const source = join(fixtureRoot, 'drag-source');
  await mkdir(source, { recursive: true });
  const binary = Buffer.from([0, 1, 2, 127, 128, 255]);
  await writeFile(join(source, 'native.bin'), binary);
  await writeFile(join(source, 'empty.bin'), Buffer.alloc(0));
  await writeFile(join(source, 'existing.txt'), 'replacement');
  await writeFile(join(source, 'hosted.txt'), 'hosted browser bytes');
  const writes = [], starts = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'PUT' && path.includes('/files/')) writes.push({ path, headers: request.headers() });
    if (request.method() === 'POST' && /\/works\/[^/]+\/start$/.test(path)) starts.push(path);
  });

  await page.locator(`.work-name[data-id="${workId}"]`).click();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await page.locator('[data-action=open-file][data-path="/drop-test"]').click();
  await expect(page.locator('.breadcrumbs [data-path="/drop-test"]')).toBeVisible();
  const session = await page.context().newCDPSession(page);
  async function dragLocalFiles(names, targetPage = page, targetSession = session) {
    const area = targetPage.locator('[data-file-drop-area]');
    const box = await area.boundingBox();
    assert.ok(box);
    const data = { items: [], files: names.map(file => join(source, file)), dragOperationsMask: 1 };
    const point = { x: box.x + Math.min(80, box.width / 2), y: box.y + Math.min(100, box.height / 2) };
    await targetSession.send('Input.dispatchDragEvent', { type: 'dragEnter', ...point, data });
    await targetSession.send('Input.dispatchDragEvent', { type: 'dragOver', ...point, data });
    await expect(targetPage.locator('[data-file-drop-overlay]')).toBeVisible();
    await expect(targetPage.locator('[data-file-drop-path]')).toHaveText('/drop-test');
    await targetSession.send('Input.dispatchDragEvent', { type: 'drop', ...point, data });
  }
  await dragLocalFiles(['native.bin', 'empty.bin']);
  await expect.poll(() => writes.length, { timeout: 90_000 }).toBe(2);
  await expect(page.locator('[data-action=open-file][data-path="/drop-test/empty.bin"]')).toBeVisible({ timeout: 90_000 });
  for (const [name, expected] of [['native.bin', binary], ['empty.bin', Buffer.alloc(0)]]) {
    const read = await fetch(filesUrl + 'drop-test/' + name, { headers: auth });
    assert.equal(read.status, 200);
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), expected);
  }
  assert.deepEqual(writes.map(write => [write.path.split('/').at(-1), write.headers['if-none-match']]), [['native.bin', '*'], ['empty.bin', '*']]);
  await dragLocalFiles(['existing.txt']);
  await expect(page.locator('#modal')).toContainText('/drop-test/existing.txt');
  await page.locator('#modal .modal-footer [data-action=close-modal]').click();
  assert.equal(await (await fetch(filesUrl + 'drop-test/existing.txt', { headers: auth })).text(), 'original');
  assert.equal(writes.length, 2);
  assert.deepEqual(starts, []);

  const display = process.env.PIWORK_TEST_FILE_DROP_DISPLAY;
  if (display) {
    const managerSource = join(fixtureRoot, 'manager-source'), config = join(fixtureRoot, 'manager-config'), cache = join(fixtureRoot, 'manager-cache');
    await Promise.all([mkdir(managerSource), mkdir(config), mkdir(cache)]);
    await writeFile(join(managerSource, 'manager.txt'), 'file manager through real Core');
    const env = { ...process.env, DISPLAY: display, WAYLAND_DISPLAY: '', GDK_BACKEND: 'x11', NO_AT_BRIDGE: '1', XDG_CONFIG_HOME: config, XDG_CACHE_HOME: cache };
    const manager = spawn('dbus-run-session', ['--', 'thunar', '--window', managerSource], { env, stdio: 'ignore', detached: true });
    const xdo = (...args) => {
      const result = spawnSync('xdotool', args, { env, encoding: 'utf8' });
      assert.equal(result.status, 0, `xdotool ${args[0]}: ${result.stderr}`);
      return result.stdout.trim();
    };
    try {
      const managerWindow = await waitFor(() => {
        const result = spawnSync('xdotool', ['search', '--onlyvisible', '--name', 'manager-source'], { env, encoding: 'utf8' });
        return result.status === 0 && result.stdout.trim().split('\n')[0];
      }, 'isolated file manager window', 15_000);
      const browserWindow = xdo('search', '--onlyvisible', '--name', name).split('\n').at(-1);
      xdo('windowmove', browserWindow, '0', '0');
      xdo('windowmove', managerWindow, '1050', '0');
      xdo('windowsize', managerWindow, '500', '700');
      xdo('windowraise', browserWindow);
      xdo('windowraise', managerWindow);
      const box = await page.locator('[data-file-drop-area]').boundingBox();
      assert.ok(box);
      const chrome = await page.evaluate(() => ({ x: window.screenX, y: window.screenY, top: window.outerHeight - window.innerHeight }));
      const destination = { x: Math.round(chrome.x + box.x + Math.min(box.width / 2, 400)), y: Math.round(chrome.y + chrome.top + box.y + Math.min(box.height / 2, 200)) };
      await page.evaluate(() => {
        window.__piworkNativeDropTrusted = false;
        document.addEventListener('drop', event => { window.__piworkNativeDropTrusted = event.isTrusted; }, { capture: true, once: true });
      });
      xdo('mousemove', '--sync', '1288', '105');
      xdo('mousedown', '1');
      try {
        await page.waitForTimeout(200);
        xdo('mousemove', '--sync', '1250', '120');
        await page.waitForTimeout(300);
        xdo('mousemove', '--sync', '1000', '200');
        await page.waitForTimeout(150);
        xdo('mousemove', '--sync', '800', '300');
        await page.waitForTimeout(150);
        xdo('mousemove', '--sync', String(destination.x), String(destination.y));
        await expect(page.locator('[data-file-drop-overlay]')).toBeVisible();
        await page.screenshot({ path: join(screenshotDir, 'files-native-drag.png') });
      } finally { xdo('mouseup', '1'); }
      assert.equal(await page.evaluate(() => window.__piworkNativeDropTrusted), true);
      await expect.poll(() => writes.length, { timeout: 90_000 }).toBe(3);
      await expect(page.locator('[data-action=open-file][data-path="/drop-test/manager.txt"]')).toBeVisible({ timeout: 90_000 });
      assert.equal(await (await fetch(filesUrl + 'drop-test/manager.txt', { headers: auth })).text(), 'file manager through real Core');
      assert.equal(writes[2].headers['if-none-match'], '*');
    } finally { if (manager.pid) { try { process.kill(-manager.pid, 'SIGTERM'); } catch {} } }
  }

  const hosted = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const hostedPage = await hosted.newPage();
    hostedPage.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (request.method() === 'POST' && /\/works\/[^/]+\/start$/.test(path)) starts.push(path);
    });
    await hostedPage.goto(uiUrl + '/login');
    await hostedPage.getByLabel('Account', { exact: true }).fill('admin');
    await hostedPage.getByLabel('Password').fill('real-browser-admin-password');
    await hostedPage.getByRole('button', { name: 'Sign in', exact: true }).click();
    await hostedPage.locator('.works-page').waitFor();
    await hostedPage.locator(`.work-name[data-id="${workId}"]`).click();
    await hostedPage.getByRole('button', { name: 'Files', exact: true }).click();
    await hostedPage.locator('[data-action=open-file][data-path="/drop-test"]').click();
    await expect(hostedPage.locator('.breadcrumbs [data-path="/drop-test"]')).toBeVisible();
    const hostedSession = await hosted.newCDPSession(hostedPage);
    await dragLocalFiles(['hosted.txt'], hostedPage, hostedSession);
    await expect(hostedPage.locator('[data-action=open-file][data-path="/drop-test/hosted.txt"]')).toBeVisible({ timeout: 90_000 });
    assert.equal(await (await fetch(filesUrl + 'drop-test/hosted.txt', { headers: auth })).text(), 'hosted browser bytes');
    await hostedSession.detach();
  } finally { await hosted.close(); }
  assert.deepEqual(starts, []);
  await session.detach();
  console.log(JSON.stringify({ result: 'real Core Files drop', browserVersion: browser.version(), files: ['native.bin', 'empty.bin', 'hosted.txt', ...(display ? ['manager.txt'] : [])], conflictCancelled: true, hostedAndDesktop: true, fileManager: !!display, method: 'CDP local files and optional native file manager' }));
}
