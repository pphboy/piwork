import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const coreBinary = resolve(process.env.PIWORK_TEST_NATIVE_CORE || join(repositoryRoot, 'dist/go/piwork-serve'));
const cliBinary = resolve(process.env.PIWORK_TEST_NATIVE_CLI || join(repositoryRoot, 'dist/go/piwork-cli'));
const image = process.env.PIWORK_TEST_NATIVE_AGENT_IMAGE || 'piwork-agentd:go-migration-acceptance';
const fileImage = process.env.PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE || 'piwork-file-helper:go-migration-acceptance';
const snapshotImage = process.env.PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE || 'piwork-snapshot-helper:go-migration-acceptance';
const browserBinary = process.env.PIWORK_TEST_BROWSER_BIN || chromium.executablePath();

async function freePort() {
  const listener = createServer();
  await new Promise((done) => listener.listen(0, '127.0.0.1', done));
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  return port;
}
async function waitFor(check, label, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) { last = error; }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`Timed out waiting for ${label}: ${last || 'no result'}`);
}
function operator(coreUrl, dataDir, args, input) {
  const result = spawnSync(coreBinary, ['--core', coreUrl, '--data-dir', dataDir, ...args],
    { input, encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent' } });
  assert.equal(result.status, 0, `${args.join(' ')}: ${result.stdout} ${result.stderr}`);
}
async function api(coreUrl, token, method, path, body) {
  const response = await fetch(coreUrl + path, { method, headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise((done) => child.once('exit', done)),
    new Promise((done) => setTimeout(done, 20_000))]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}
function capture(child) {
  let output = '';
  child.stdout?.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr?.on('data', (chunk) => { output += chunk.toString(); });
  return () => output.slice(-6000);
}
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  assert.equal(result.status, 0, `docker ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}
async function cleanupInstallation(dataDir) {
  let installationId;
  try {
    installationId = JSON.parse(await readFile(join(dataDir, 'core-format.json'), 'utf8')).installationId;
  } catch { return; }
  assert.match(installationId, /^[A-Za-z0-9-]+$/);
  const filter = `label=piwork.installation_id=${installationId}`;
  for (const [kind, list, inspectArgs, remove] of [
    ['container', ['ps', '-aq', '--filter', filter], (id) => ['inspect', '--format', '{{index .Config.Labels "piwork.installation_id"}}', id], (id) => ['rm', '-f', id]],
    ['network', ['network', 'ls', '-q', '--filter', filter], (id) => ['network', 'inspect', '--format', '{{index .Labels "piwork.installation_id"}}', id], (id) => ['network', 'rm', id]],
    ['volume', ['volume', 'ls', '-q', '--filter', filter], (id) => ['volume', 'inspect', '--format', '{{index .Labels "piwork.installation_id"}}', id], (id) => ['volume', 'rm', id]],
  ]) {
    const ids = docker(list).split('\n').filter(Boolean);
    for (const id of ids) {
      assert.equal(docker(inspectArgs(id)), installationId, `${kind} is outside the fixture installation`);
      docker(remove(id));
    }
  }
}

const root = await mkdtemp(join(process.env.PIWORK_TEST_DATA_ROOT || tmpdir(), 'piwork-desktop-real-go-'));
const dataDir = join(root, 'core');
const screenshotDir = resolve(process.env.PIWORK_TEST_SCREENSHOT_DIR || join(root, 'screenshots'));
await mkdir(screenshotDir, { recursive: true });
let core, desktop, browser, page;
let coreOutput = () => '', desktopOutput = () => '';
try {
  const [corePort, grpcPort, desktopPort] = await Promise.all([freePort(), freePort(), freePort()]);
  const coreUrl = `http://127.0.0.1:${corePort}`;
  core = spawn(coreBinary, ['serve', '--data-dir', dataDir, '--listen', `127.0.0.1:${corePort}`,
    '--agent-grpc-listen', `0.0.0.0:${grpcPort}`], { stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...process.env, PATH: '/nonexistent', PIWORK_PACKAGE_HELPER_IMAGE: image,
      PIWORK_FILE_HELPER_IMAGE: fileImage, PIWORK_SNAPSHOT_HELPER_IMAGE: snapshotImage,
    } });
  coreOutput = capture(core);
  await waitFor(async () => (await fetch(`${coreUrl}/healthz`)).ok, 'Go Core health');
  operator(coreUrl, dataDir, ['admin', 'bootstrap', '--account', 'admin', '--password-stdin'], 'real-browser-admin-password\n');
  operator(coreUrl, dataDir, ['config', 'set', '--agent-image', image,
    '--model-provider', 'piwork-deterministic', '--model', 'fixture-v1', '--api-key-stdin'], 'fixture-key\n');
  await waitFor(async () => (await fetch(`${coreUrl}/readyz`)).ok, 'Go Core readiness');
  const login = await api(coreUrl, '', 'POST', '/api/v1/login',
    { account: 'admin', password: 'real-browser-admin-password' });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const token = login.data.token;
  assert.equal(typeof token, 'string');

  desktop = spawn(cliBinary, ['--core', coreUrl, 'desktop', '--port', String(desktopPort), '--no-open'],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: '/nonexistent',
      PIWORK_CONFIG_PATH: join(root, 'client.json') } });
  desktopOutput = capture(desktop);
  const launchUrl = await waitFor(() => desktopOutput().match(/http:\/\/desktop\.localhost:\d+\/#ticket=[\w-]+/)?.[0],
    'Go Desktop bootstrap URL', 10_000);
  browser = await chromium.launch({ headless: true, executablePath: browserBinary });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  page = await context.newPage();
  page.on('pageerror', error => { console.error('Page error:', error.message); });
  await page.goto(launchUrl);
  await page.getByRole('heading', { name: 'Connect to your Core' }).waitFor();
  await page.getByRole('textbox', { name: 'Account', exact: true }).fill('admin');
  await page.getByLabel('Password').fill('real-browser-admin-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Works', exact: true }).waitFor();
  await page.screenshot({ path: join(screenshotDir, '01-empty-work-list.png'), fullPage: true });
  await page.getByRole('button', { name: 'New Work', exact: true }).first().click();
  await page.locator('#create-name').fill('Real Browser Work');
  await page.getByRole('button', { name: 'Create Work', exact: true }).click();
  const work = await waitFor(async () => (await api(coreUrl, token, 'GET', '/api/v1/works')).data.works?.find(item => item.name === 'Real Browser Work'), 'created Work');
  const workId = work.id;
  const waitState = (id, state) => waitFor(async () => (await api(coreUrl, token, 'GET', `/api/v1/works/${id}`)).data.observedState === state, `Work ${state}`, 180_000);
  await waitState(workId, 'ready');
  await page.reload();
  await page.getByRole('button', { name: /^Real Browser Work/ }).click();
  const script = "const http=require('node:http');http.createServer((req,res)=>{if(req.url==='/health'){res.end('ok');return;}res.setHeader('Content-Type','text/html');res.end('<h1>Real Service</h1><input aria-label=\"Service draft\"><button onclick=\"this.textContent=Number(this.textContent)+1\">0</button>');}).listen(8099,'0.0.0.0')";
  const definition = { name: 'browser-service', image: { reference: image }, command: 'node', args: ['-e', script], workingDirectory: '/var/data/workspace', mounts: [{ source: 'workspace', target: '/var/data/workspace', readOnly: false }], ports: [{ name: 'web', protocol: 'tcp', containerPort: 8099 }], readiness: { kind: 'http', portName: 'web', path: '/health', deadlineMs: 10000 } };
  const service = await api(coreUrl, token, 'POST', `/api/v1/works/${workId}/services`, { definition, idempotencyKey: 'browser-real-service' });
  assert.equal(service.status, 202, JSON.stringify(service.data));
  await waitFor(async () => (await api(coreUrl, token, 'GET', `/api/v1/operations/${service.data.operationId}`)).data.state === 'succeeded', 'Service operation', 180_000);
  await page.reload();
  await page.frameLocator('iframe').getByRole('heading', { name: 'Real Service' }).waitFor();
  const frame = page.frameLocator('iframe');
  await frame.getByLabel('Service draft').fill('do not lose this');
  await page.locator('#composer').fill('Say hello');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.locator('.run-strip').filter({ hasText: /succeeded/ }).waitFor({ timeout: 90_000 });
  assert.match(await page.locator('#messages').innerText(), /skill-read:/);
  assert.equal(await frame.getByLabel('Service draft').inputValue(), 'do not lose this', 'chat rerender reloaded the Service iframe');
  await page.getByRole('button', { name: 'Service options', exact: true }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  assert.equal(await frame.getByLabel('Service draft').inputValue(), 'do not lose this', 'modal rerender reloaded the Service iframe');
  await page.screenshot({ path: join(screenshotDir, '02-service-and-chat.png'), fullPage: true });
  const newPage = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Open application in new tab' }).click();
  const app = await newPage;
  await app.frameLocator('iframe').getByRole('heading', { name: 'Real Service' }).waitFor();
  assert.equal(new URL(app.url()).hostname, 'desktop.localhost');
  const uploaded = await fetch(`${coreUrl}/api/v1/works/${workId}/files/note.txt`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: 'real-browser-file' });
  assert([201,204].includes(uploaded.status), await uploaded.text());
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: /^note.txt/ }).click();
  await page.getByLabel('Edit note.txt').fill('saved by real browser Files');
  await page.getByRole('button', { name: 'Save file', exact: true }).click();
  await page.getByText('File saved.', { exact: true }).waitFor();
  const readFileThroughCore = async () => { const response = await fetch(`${coreUrl}/api/v1/works/${workId}/files/note.txt`, { headers: { Authorization: `Bearer ${token}` } }); assert.equal(response.status, 200); return response.text(); };
  assert.equal(await readFileThroughCore(), 'saved by real browser Files');
  let uncertainWrites = 0;
  const localFileUrl = `**/_desktop/files/works/${workId}/files/note.txt`;
  const loseWriteReply = async route => { if (route.request().method() !== 'PUT') return route.continue(); uncertainWrites++; const original = new URL(route.request().url()); const target = new URL(original); target.hostname = '127.0.0.1'; const response = await route.fetch({url: target.href, headers: {...route.request().headers(),host:original.host}}); assert([201,204].includes(response.status())); await route.abort('failed'); };
  await page.route(localFileUrl, loseWriteReply);
  await page.getByLabel('Edit note.txt').fill('committed with lost browser reply');
  await page.getByRole('button', { name: 'Save file', exact: true }).click();
  await page.getByText('Response lost. Refresh source and destination before trying again.', { exact: true }).first().waitFor();
  assert.equal(await readFileThroughCore(), 'committed with lost browser reply');
  assert.equal(uncertainWrites, 1);
  await page.unroute(localFileUrl, loseWriteReply);
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh files' }).click();
  await page.getByRole('button', { name: 'Back to files' }).click();
  await page.locator('#file-editor').waitFor({state:'hidden'});
  const binary = Buffer.from([0,1,2,128,255,42]);
  await page.locator('#upload-input').setInputFiles({ name: 'binary.dat', mimeType: 'application/octet-stream', buffer: binary });
  await page.getByRole('button', { name: /^binary.dat/ }).waitFor();
  const rawBinary = await fetch(`${coreUrl}/api/v1/works/${workId}/files/binary.dat`, { headers: { Authorization: `Bearer ${token}` } });
  assert.deepEqual(Buffer.from(await rawBinary.arrayBuffer()), binary);
  await page.getByRole('button', { name: 'New folder' }).click();
  await page.locator('#form-name').fill('folder');
  await page.getByRole('button', { name: 'Create folder', exact: true }).click();
  await page.getByRole('button', { name: /^folder/ }).waitFor();
  await page.screenshot({ path: join(screenshotDir, '03-files.png'), fullPage: true });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByText('Saved and active configuration are aligned', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'AGENTS.md', exact: true }).click();
  await page.locator('#agents-editor').fill('# Real browser Work\nUse the shared workspace.\n');
  await page.getByRole('button', { name: 'Save changes', exact: true }).first().click();
  await page.getByText('Not applied · Your running configuration is unchanged.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await waitFor(async () => (await api(coreUrl, token, 'GET', `/api/v1/works/${workId}/configuration`)).data.pendingApply === false, 'configuration apply', 180_000);
  console.log('Real Desktop: configuration applied');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Back to Work', exact: true }).click();
  await page.getByRole('button', { name: 'Work options' }).click();
  await page.getByRole('button', { name: 'Export Work', exact: true }).last().click();
  await page.getByText(/Stop this Work explicitly/).waitFor();
  assert.equal(await page.locator('[data-action=prepare-export]').count(), 0);
  await page.getByRole('button', { name: 'Stop Work first', exact: true }).click();
  await page.getByRole('button', { name: 'Stop Work', exact: true }).last().click();
  await waitState(workId, 'stopped');
  await app.bringToFront();
  await app.getByRole('heading', { name: 'This Work is stopped', exact: true }).waitFor({timeout:15000});
  await app.close(); await page.bringToFront();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Export Work', exact: true }).last().click();
  await page.getByRole('button', { name: 'Prepare .work package', exact: true }).click();
  await page.getByRole('button', { name: 'View package', exact: true }).waitFor({ timeout: 180_000 });
  await page.getByRole('button', { name: 'View package', exact: true }).click();
  console.log('Real Desktop: snapshot prepared');
  const downloadEvent = page.waitForEvent('download', { timeout: 180_000 });
  await page.getByRole('button', { name: 'Download .work', exact: true }).waitFor({timeout:180_000});
  await page.getByRole('button', { name: 'Download .work', exact: true }).click();
  const download = await downloadEvent; const exportedPath = join(root, 'browser-export.work'); await download.saveAs(exportedPath); assert.equal(await download.failure(), null);
  assert.equal((await readFile(exportedPath)).subarray(0,8).toString(), 'PIWORK1\n', 'export is not a real archive');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Back to Works' }).click();
  await page.getByRole('button', { name: 'Import Work', exact: true }).click();
  await page.locator('#work-file-input').setInputFiles(exportedPath);
  await page.getByText('Package format and contents verified locally.', { exact: true }).waitFor({ timeout: 180_000 });
  await page.locator('#import-name').fill('Browser Imported Work');
  await page.getByRole('button', { name: 'Import Work', exact: true }).last().click();
  const imported = await waitFor(async () => (await api(coreUrl, token, 'GET', '/api/v1/works')).data.works?.find(item => item.name === 'Browser Imported Work'), 'imported Work', 180_000);
  assert.notEqual(imported.id, workId); assert.equal(imported.observedState, 'stopped');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.reload(); await page.getByRole('button', { name: /^Browser Imported Work/ }).click();
  await page.getByRole('button', { name: 'Start Work', exact: true }).first().click();
  await waitState(imported.id, 'ready');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.reload();
  await page.frameLocator('iframe').getByRole('heading', { name: 'Real Service' }).waitFor();
  await waitFor(async () => (await page.locator('#messages').innerText()).includes('skill-read:'), 'restored session history');
  await page.screenshot({ path: join(screenshotDir, '04-restored-work.png'), fullPage: true });
  for (const width of [1440,1024,390]) { await page.setViewportSize({ width, height: 900 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `horizontal overflow at ${width}px`); await page.screenshot({ path: join(screenshotDir, `05-responsive-${width}.png`), fullPage: true }); }
  console.log(JSON.stringify({ result: 'real Go Core/CLI: lifecycle, Service iframe preservation/tab, Run, binary WebDAV, uncertain write, Save/Apply, Stop/Export/Inspect/Import/Start and responsive layout', workId, screenshots: screenshotDir }));
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(screenshotDir, '99-failure.png'), fullPage: true }).catch(() => undefined);
    console.error('Browser page:', page.url(), '\n', await page.locator('body').innerText().catch(() => 'unavailable'));
  }
  console.error(error, '\nCore:', coreOutput(), '\nDesktop:', desktopOutput().replace(/#ticket=[\w-]+/g, '#ticket=[redacted]'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stop(desktop);
  await stop(core);
  try { await cleanupInstallation(dataDir); }
  finally { await rm(root, { recursive: true, force: true }); }
}
