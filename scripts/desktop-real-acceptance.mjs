import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { chromium } from '@playwright/test';
import { FileCredentialStore, PiworkClient } from '@piwork/client-sdk';
import { randomUUID, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

const root = new URL('../', import.meta.url).pathname;
const core = process.env.PIWORK_LIVE_CORE_URL;
const config = process.env.PIWORK_LIVE_CONFIG_PATH;
const workId = process.env.PIWORK_LIVE_WORK_ID;
const dataDir = process.env.PIWORK_LIVE_DATA_DIR;
const browsers = process.env.PIWORK_LIVE_BROWSERS?.split(':').filter(Boolean) ?? [];
if (!core || !config || !workId || !dataDir || !browsers.length) throw new Error('Missing live smoke settings');
const secondConfig = join(dirname(config), 'desktop-second-user.json');
const secondAccount = `desktop-second-${process.pid}`;
const secondPassword = `desktop-second-password-${process.pid}`;
const secondWorkName = `desktop-second-work-${process.pid}`;
function command(path, args, configPath, input) {
  const result = spawnSync(process.execPath, [path, '--core', core, ...args], {
    cwd: root, env: { ...process.env, PIWORK_CONFIG_PATH: configPath }, input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`${path} ${args.slice(0, 3).join(' ')} failed (${result.status}): ${result.stderr.slice(0, 1000)}`);
  return result.stdout;
}
const userCli = (args, input) => command('apps/cli/dist/main.js', args, secondConfig, input);
const records = (value) => value.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
let secondWorkId;
const freePort = async () => {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address(); assert(address && typeof address !== 'string');
  await new Promise((done) => server.close(done));
  return address.port;
};
async function startDesktop(configPath) {
  const port = await freePort();
  const child = spawn(process.execPath, ['apps/cli/dist/main.js', '--core', core, 'desktop', '--port', String(port), '--no-open'],
    { cwd: root, env: { ...process.env, PIWORK_CONFIG_PATH: configPath }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  const launch = await Promise.race([
    new Promise((done, fail) => {
      child.stdout.on('data', (chunk) => {
        const match = String(chunk).match(/http:\/\/desktop\.localhost:\d+\/#ticket=[A-Za-z0-9_-]+/);
        if (match) done(match[0]);
      });
      child.once('exit', (code) => fail(new Error(`Desktop exited ${code}: ${stderr}`)));
    }),
    new Promise((_, fail) => setTimeout(() => fail(new Error('Desktop startup timed out')), 10000)),
  ]);
  return { child, launch };
}
async function stopDesktop(value) {
  if (value?.child.exitCode === null) {
    const exited = new Promise((done) => value.child.once('exit', done));
    value.child.kill('SIGINT');
    await exited;
  }
}
async function waitOperation(client, id) {
  for (let attempt = 0; attempt < 180; attempt++) {
    const value = await client.operation(id);
    if (value.state === 'succeeded') return value;
    if (value.state === 'failed' || value.state === 'superseded') throw new Error(`Operation ${id} ended ${value.state}`);
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error(`Operation ${id} did not finish`);
}
try {
  command('apps/core/dist/cli.js', ['--data-dir', dataDir, 'admin', 'users', 'create', '--account', secondAccount, '--password-stdin'],
    config, `${secondPassword}\n`);
  userCli(['--json', 'login', '--account', secondAccount, '--password-stdin'], `${secondPassword}\n`);
  const created = records(userCli(['--json', 'work', 'create', '--name', secondWorkName, '--wait']));
  secondWorkId = created[0]?.workId;
  assert(secondWorkId && created.at(-1)?.state === 'succeeded', 'second owner Work was not created');
  assert.match(userCli(['--json', 'chat', secondWorkId, '--message', 'deploy deterministic service']), /service-deployed:service-/);
  const secondService = records(userCli(['--json', 'work', 'service', 'list', secondWorkId]))[0]?.services?.[0];
  assert.equal(secondService?.access?.status, 'available');
for (const binary of browsers) {
  const port = await freePort();
  const cli = spawn(process.execPath, ['apps/cli/dist/main.js', '--core', core, 'desktop', '--port', String(port), '--no-open'],
    { cwd: root, env: { ...process.env, PIWORK_CONFIG_PATH: config }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  cli.stderr.on('data', (chunk) => { stderr += String(chunk); });
  let browser;
  let secondDesktop;
  try {
    const launch = await Promise.race([
      new Promise((done, fail) => {
        cli.stdout.on('data', (chunk) => {
          const match = String(chunk).match(/http:\/\/desktop\.localhost:\d+\/#ticket=[A-Za-z0-9_-]+/);
          if (match) done(match[0]);
        });
        cli.once('exit', (code) => fail(new Error(`Desktop exited ${code}: ${stderr}`)));
      }),
      new Promise((_, fail) => setTimeout(() => fail(new Error('Desktop startup timed out')), 10000)),
    ]);
    browser = await chromium.launch({ executablePath: binary, headless: true });
    const page = await browser.newPage();
    await page.goto(launch);
    await page.getByRole('heading', { name: 'Your Works' }).waitFor({ timeout: 10000 });
    assert(await page.getByRole('button', { name: 'acceptance-service', exact: true }).count() === 1,
      'the administrator can see the original Work');
    await page.getByRole('button', { name: 'acceptance-service', exact: true }).click();
    await page.getByRole('heading', { name: 'acceptance-service' }).waitFor();
    const frame = page.frameLocator('iframe');
    await frame.locator('body').getByText(/count/).waitFor({ timeout: 15000 });
    await frame.locator('body').evaluate(() => { location.href = '/private'; });
    await frame.locator('body').getByText('Sign in to the app').waitFor();
    await frame.locator('body').evaluate(() => { location.href = '/login'; });
    await frame.getByRole('textbox', { name: 'Password' }).fill('service-secret');
    await frame.getByRole('button', { name: 'Sign in' }).click();
    await frame.locator('body').getByText('private-ok').waitFor();
    const streams = await frame.locator('body').evaluate(async () => {
      const event = await new Promise((done, fail) => {
        const source = new EventSource('/events');
        source.onmessage = (item) => { source.close(); done(item.data); };
        source.onerror = () => { source.close(); fail(new Error('SSE failed')); };
      });
      const ws = await new Promise((done, fail) => {
        const socket = new WebSocket(`ws://${location.host}/ws`);
        socket.onopen = () => socket.send('desktop-live');
        socket.onmessage = (item) => { socket.close(); done(item.data); };
        socket.onerror = () => fail(new Error('WebSocket failed'));
      });
      return { event, ws };
    });
    assert.equal(streams.event, 'first');
    assert.equal(streams.ws, 'desktop-live');
    const popupPromise = page.context().waitForEvent('page');
    await page.getByRole('button', { name: 'Open application tab' }).click();
    const popup = await popupPromise;
    await popup.waitForURL(/\.desktop\.localhost:\d+\//);
    await popup.waitForLoadState('domcontentloaded');
    assert.equal(new URL(popup.url()).host.includes('.desktop.localhost:'), true);
    await popup.goto(new URL('/private', popup.url()).href);
    await popup.getByText('private-ok').waitFor();
    await popup.close();
    await page.bringToFront();
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await page.getByRole('heading', { name: 'Workspace files' }).waitFor({ timeout: 10000 });
    await page.locator('.file-status').getByText(/Loaded|folder|files|empty/i).waitFor({ timeout: 15000 });
    const fileName = binary.includes('msedge') ? 'desktop-live-edge.txt' : 'desktop-live-chrome.txt';
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    await (await chooser).setFiles({ name: fileName, mimeType: 'text/plain', buffer: Buffer.from('desktop live file\n') });
    await page.getByText('1 file uploaded.').waitFor({ timeout: 20000 }).catch(async (error) => {
      throw new Error(`Files upload failed: ${await page.locator('.file-status').textContent()} · ${String(error)}`);
    });
    await page.getByRole('button', { name: `File · ${fileName}` }).waitFor();
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await page.getByRole('textbox', { name: 'Message Agent' }).waitFor({ timeout: 10000 });
    await page.getByRole('textbox', { name: 'Message Agent' }).fill('desktop live smoke');
    await page.getByRole('button', { name: 'Send message' }).click();
    await page.locator('.run-output').getByText(/skill-read:/).waitFor({ timeout: 30000 });
    const secondPort = await freePort();
    secondDesktop = spawn(process.execPath, ['apps/cli/dist/main.js', '--core', core, 'desktop', '--port', String(secondPort), '--no-open'],
      { cwd: root, env: { ...process.env, PIWORK_CONFIG_PATH: secondConfig }, stdio: ['ignore', 'pipe', 'pipe'] });
    const secondLaunch = await Promise.race([
      new Promise((done, fail) => {
        secondDesktop.stdout.on('data', (chunk) => {
          const match = String(chunk).match(/http:\/\/desktop\.localhost:\d+\/#ticket=[A-Za-z0-9_-]+/);
          if (match) done(match[0]);
        });
        secondDesktop.once('exit', (code) => fail(new Error(`Second Desktop exited ${code}`)));
      }),
      new Promise((_, fail) => setTimeout(() => fail(new Error('Second Desktop startup timed out')), 10000)),
    ]);
    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await secondPage.goto(secondLaunch);
    await secondPage.getByRole('heading', { name: 'Your Works' }).waitFor();
    await secondPage.getByRole('button', { name: secondWorkName, exact: true }).waitFor();
    assert.equal(await secondPage.locator('.work-row').count(), 1);
    assert.equal(await secondPage.getByRole('button', { name: 'acceptance-service', exact: true }).count(), 0);
    assert.equal(await secondPage.evaluate(async (id) => (await fetch(`/_desktop/api/works/${id}`)).status, workId), 404);
    await secondPage.getByRole('button', { name: secondWorkName, exact: true }).click();
    await secondPage.getByRole('heading', { name: secondWorkName }).waitFor();
    await secondPage.frameLocator('iframe').locator('body').getByText(/count/).waitFor({ timeout: 15000 });
    await secondPage.getByRole('button', { name: 'Files', exact: true }).click();
    await secondPage.getByRole('heading', { name: 'Workspace files' }).waitFor();
    await secondPage.locator('.file-status').getByText(/files/i).waitFor();
    assert.equal(await secondPage.getByRole('button', { name: `File · ${fileName}` }).count(), 0,
      'the first owner workspace file must not appear in the second Work');
    if (!binary.includes('msedge')) {
      const chooser = secondPage.waitForEvent('filechooser');
      await secondPage.getByRole('button', { name: 'Upload', exact: true }).click();
      await (await chooser).setFiles({ name: 'migration.txt', mimeType: 'text/plain', buffer: Buffer.from('migration bytes\n') });
      await secondPage.getByText('1 file uploaded.').waitFor({ timeout: 20000 });
    }
    await secondPage.getByRole('button', { name: 'Chat', exact: true }).click();
    const previousSession = await secondPage.locator('select[aria-label="Session"]').inputValue();
    await secondPage.getByRole('button', { name: 'New session' }).click();
    await secondPage.waitForFunction((old) => {
      const selector = document.querySelector('select[aria-label="Session"]');
      return selector instanceof HTMLSelectElement && !!selector.value && selector.value !== old;
    }, previousSession);
    await secondPage.getByRole('textbox', { name: 'Message Agent' }).waitFor();
    await secondPage.getByRole('textbox', { name: 'Message Agent' }).fill('desktop second owner');
    await secondPage.getByRole('button', { name: 'Send message' }).click();
    await secondPage.locator('.run-output').getByText(/skill-read:/).waitFor({ timeout: 90000 }).catch(async (error) => {
      const output = await secondPage.locator('.run-output').allTextContents();
      const notice = await secondPage.locator('.operation-notice').allTextContents();
      const status = await secondPage.locator('.run-status').allTextContents();
      throw new Error(`Second owner Agent Run did not finish: ${JSON.stringify({ output, notice, status }).slice(0, 1000)} · ${String(error)}`);
    });
    await secondPage.getByRole('button', { name: 'Settings', exact: true }).click();
    await secondPage.getByRole('button', { name: 'AGENTS.md', exact: true }).click();
    await secondPage.getByRole('textbox', { name: 'AGENTS.md content' }).fill(`Desktop acceptance instructions for ${binary.includes('msedge') ? 'Edge' : 'Chrome'}.`);
    await secondPage.getByRole('button', { name: 'Save AGENTS.md' }).click();
    await secondPage.getByText('AGENTS.md saved. Apply changes to load it.').waitFor();
    await secondPage.getByRole('button', { name: 'Apply changes' }).click();
    await secondPage.locator('.operation-notice').getByText(/Apply .* · succeeded/).waitFor({ timeout: 30000 });
    await secondPage.getByRole('button', { name: 'Services', exact: true }).click();
    const secondPopupPromise = secondContext.waitForEvent('page');
    await secondPage.getByRole('button', { name: 'Open application tab' }).click();
    const secondPopup = await secondPopupPromise;
    await secondPopup.waitForURL(/\.desktop\.localhost:\d+\//);
    const serviceLink = new URL('/', secondPopup.url()).href;
    await secondPopup.close();
    await secondPage.getByRole('button', { name: 'Sign out' }).click();
    await secondPage.getByRole('heading', { name: 'Sign in to Piwork' }).waitFor();
    const revokedService = await secondPage.goto(serviceLink);
    assert.equal(revokedService?.status(), 401, 'sign-out must revoke the local Service link');
    await secondContext.close();
    userCli(['--json', 'login', '--account', secondAccount, '--password-stdin'], `${secondPassword}\n`);
    console.log(`${binary.includes('msedge') ? 'Edge' : 'Chrome'}: real Core Service app login, HTTP/SSE/WS, separate tab, Files upload, Agent Run, Apply and Service-link revocation passed for Work ${workId}`);
  } finally {
    if (secondDesktop?.exitCode === null) { const exited = new Promise((done) => secondDesktop.once('exit', done)); secondDesktop.kill('SIGINT'); await exited; }
    await browser?.close();
    if (cli.exitCode === null) { const exited = new Promise((done) => cli.once('exit', done)); cli.kill('SIGINT'); await exited; }
  }
}
  const access = spawnSync(process.execPath, ['scripts/desktop-real-access-acceptance.mjs'], {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PIWORK_LIVE_SECOND_CONFIG_PATH: secondConfig,
      PIWORK_LIVE_SECOND_WORK_ID: secondWorkId, PIWORK_LIVE_SECOND_WORK_NAME: secondWorkName },
  });
  if (access.status !== 0) throw new Error('Desktop access acceptance failed (' + access.status + '): '
    + (access.stdout + '\n' + access.stderr).slice(-4000));
  process.stdout.write(access.stdout);
  const saved = await new FileCredentialStore(secondConfig).load();
  assert(saved?.token);
  const client = new PiworkClient({ coreUrl: core, token: saved.token });
  let migrationDesktop;
  let migrationBrowser;
  let importedId;
  let edgeImportedId;
  try {
    migrationDesktop = await startDesktop(secondConfig);
    migrationBrowser = await chromium.launch({ executablePath: browsers[0], headless: true });
    let page = await migrationBrowser.newPage();
    page.setDefaultTimeout(120000);
    page.on('dialog', (dialog) => { void dialog.accept(); });
    await page.goto(migrationDesktop.launch);
    await page.getByRole('button', { name: secondWorkName, exact: true }).click();
    await page.getByRole('button', { name: 'Stop Work', exact: true }).click();
    await page.locator('.operation-notice').getByText(/stop .* · succeeded/).waitFor();
    await page.getByRole('button', { name: 'All Works' }).click();
    await page.getByRole('button', { name: secondWorkName, exact: true }).click();
    await page.getByRole('heading', { name: 'Work is stopped' }).waitFor();
    const competing = await client.exportWork(secondWorkId, randomUUID());
    await page.getByRole('button', { name: 'Prepare .work package' }).click();
    await page.getByText(/Core rejected Export:/).waitFor({ timeout: 15000 }).catch(async () => {
      const notice = await page.locator('.operation-notice').innerText();
      const snapshot = await client.workSnapshot(competing.snapshotId);
      throw new Error(`Expected live Core lock rejection; Desktop showed ${JSON.stringify(notice)}, first snapshot state ${snapshot.state}`);
    });
    assert.match(await page.locator('.operation-notice').innerText(), /busy|lock|snapshot/i);
    await waitOperation(client, competing.operationId);
    assert.equal((await client.workSnapshot(competing.snapshotId)).state, 'succeeded');
    await migrationBrowser.close(); migrationBrowser = undefined;
    await stopDesktop(migrationDesktop); migrationDesktop = undefined;

    migrationDesktop = await startDesktop(secondConfig);
    migrationBrowser = await chromium.launch({ executablePath: browsers[0], headless: true });
    page = await migrationBrowser.newPage();
    page.setDefaultTimeout(120000);
    page.on('dialog', (dialog) => { void dialog.accept(); });
    await page.goto(migrationDesktop.launch);
    await page.getByRole('heading', { name: 'Your Works' }).waitFor();
    await page.getByRole('textbox', { name: 'Snapshot ID' }).fill(competing.snapshotId);
    await page.getByRole('button', { name: 'Prepare original Snapshot', exact: true }).click();
    await page.getByRole('link', { name: 'Download .work package' }).waitFor({ timeout: 240000 }).catch(async (error) => {
      throw new Error('Original Snapshot download did not become ready: '
        + (await page.locator('body').innerText()).slice(0, 1800) + ' · ' + String(error));
    });
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download .work package' }).click();
    const download = await downloadEvent;
    const packagePath = await download.path();
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(packagePath)) hash.update(chunk);
    assert.equal(hash.digest('hex'), (await client.workSnapshot(competing.snapshotId)).digest);
    await page.getByRole('button', { name: 'Import .work' }).click();
    await page.getByLabel('Select .work package').setInputFiles(packagePath);
    await page.getByRole('button', { name: 'Inspect package' }).click();
    await page.getByText(/Package verified/).waitFor({ timeout: 180000 }).catch(async (error) => {
      throw new Error('Original Snapshot Inspect did not finish: '
        + (await page.locator('body').innerText()).slice(0, 1800) + ' · ' + String(error));
    });
    const importedName = `${secondWorkName}-copy`;
    await page.getByRole('textbox', { name: 'Imported Work name (optional)' }).fill(importedName);
    await page.getByRole('button', { name: 'Import inspected package' }).click();
    await page.locator('.import-outcome').getByText(/imported · stopped/).waitFor();
    importedId = records(userCli(['--json', 'work', 'list']))[0].works.find((work) => work.name === importedName)?.id;
    assert(importedId);
    await page.locator('.import-outcome').getByRole('button', { name: 'Start Work', exact: true }).click();
    await page.locator('.operation-notice').getByText(/start .* · succeeded/).waitFor();
    await page.locator('.import-outcome').getByRole('button', { name: 'Open Work', exact: true }).click();
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await page.getByRole('button', { name: 'File · migration.txt' }).click();
    assert.equal(await page.getByRole('textbox', { name: 'Edit migration.txt' }).inputValue(), 'migration bytes\n');
    console.log(`Chrome: real Core lock rejection, original snapshot recovery after Desktop restart, Import/Start and workspace byte equality passed`);
    if (browsers.some((binary) => binary.includes('msedge'))) {
      await migrationBrowser.close(); migrationBrowser = undefined;
      await stopDesktop(migrationDesktop); migrationDesktop = undefined;
      migrationDesktop = await startDesktop(secondConfig);
      migrationBrowser = await chromium.launch({ executablePath: browsers.find((binary) => binary.includes('msedge')), headless: true });
      page = await migrationBrowser.newPage();
      page.setDefaultTimeout(120000);
      page.on('dialog', (dialog) => { void dialog.accept(); });
      await page.goto(migrationDesktop.launch);
      await page.getByRole('heading', { name: 'Your Works' }).waitFor();
      await page.getByRole('textbox', { name: 'Snapshot ID' }).fill(competing.snapshotId);
      await page.getByRole('button', { name: 'Prepare original Snapshot', exact: true }).click();
      await page.getByRole('link', { name: 'Download .work package' }).waitFor();
      const edgeDownloadEvent = page.waitForEvent('download');
      await page.getByRole('link', { name: 'Download .work package' }).click();
      const edgeDownload = await edgeDownloadEvent;
      const edgePackagePath = await edgeDownload.path();
      const edgeHash = createHash('sha256');
      for await (const chunk of createReadStream(edgePackagePath)) edgeHash.update(chunk);
      assert.equal(edgeHash.digest('hex'), (await client.workSnapshot(competing.snapshotId)).digest);
      await page.getByRole('button', { name: 'Import .work' }).click();
      await page.getByLabel('Select .work package').setInputFiles(edgePackagePath);
      await page.getByRole('button', { name: 'Inspect package' }).click();
      await page.getByText(/Package verified/).waitFor();
      const edgeName = `${secondWorkName}-edge-copy`;
      await page.getByRole('textbox', { name: 'Imported Work name (optional)' }).fill(edgeName);
      await page.getByRole('button', { name: 'Import inspected package' }).click();
      await page.locator('.import-outcome').getByText(/imported · stopped/).waitFor();
      edgeImportedId = records(userCli(['--json', 'work', 'list']))[0].works.find((work) => work.name === edgeName)?.id;
      assert(edgeImportedId);
      await page.locator('.import-outcome').getByRole('button', { name: 'Start Work', exact: true }).click();
      await page.locator('.operation-notice').getByText(/start .* · succeeded/).waitFor();
      await page.locator('.import-outcome').getByRole('button', { name: 'Open Work', exact: true }).click();
      await page.getByRole('button', { name: 'Files', exact: true }).click();
      await page.getByRole('button', { name: 'File · migration.txt' }).click();
      assert.equal(await page.getByRole('textbox', { name: 'Edit migration.txt' }).inputValue(), 'migration bytes\n');
      await page.reload();
      await page.getByRole('heading', { name: edgeName }).waitFor();
      await page.getByRole('button', { name: 'Sign out' }).click();
      await page.getByRole('heading', { name: 'Sign in to Piwork' }).waitFor();
      assert.equal(await page.evaluate(async () => (await fetch('/_desktop/api/works')).status), 401);
      await page.getByRole('textbox', { name: 'Account' }).fill(secondAccount);
      await page.getByLabel('Password').fill(secondPassword);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('heading', { name: 'Your Works' }).waitFor();
      const oldLink = migrationDesktop.launch.split('#')[0];
      await migrationBrowser.close(); migrationBrowser = undefined;
      await stopDesktop(migrationDesktop); migrationDesktop = undefined;
      await assert.rejects(fetch(oldLink));
      const resumed = await new FileCredentialStore(secondConfig).load();
      assert(resumed?.token);
      await new PiworkClient({ coreUrl: core, token: resumed.token }).work(secondWorkId);
      console.log('Edge: real Core snapshot recovery, Import/Start, reload, sign-out/relogin, CLI exit and workspace byte equality passed');
    }
  } finally {
    await migrationBrowser?.close();
    await stopDesktop(migrationDesktop);
    if (edgeImportedId) userCli(['--json', 'work', 'delete', edgeImportedId, '--wait']);
    if (importedId) userCli(['--json', 'work', 'delete', importedId, '--wait']);
  }
} finally {
  if (secondWorkId) {
    userCli(['--json', 'login', '--account', secondAccount, '--password-stdin'], `${secondPassword}\n`);
    userCli(['--json', 'work', 'delete', secondWorkId, '--wait']);
  }
}
