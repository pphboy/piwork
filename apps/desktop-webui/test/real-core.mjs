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

const root = await mkdtemp(join(tmpdir(), 'piwork-desktop-real-go-'));
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
  await page.goto(launchUrl);
  await page.getByRole('heading', { name: 'Sign in to Piwork' }).waitFor();
  await page.getByRole('textbox', { name: 'Account' }).fill('admin');
  await page.getByLabel('Password').fill('real-browser-admin-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Your Works' }).waitFor();
  await page.screenshot({ path: join(screenshotDir, '01-empty-work-list.png'), fullPage: true });
  await page.getByRole('button', { name: 'New Work' }).click();
  await page.getByRole('textbox', { name: 'Work name' }).fill('Real Browser Work');
  await page.getByRole('button', { name: 'Create Work' }).click();
  const work = await waitFor(async () => {
    const response = await api(coreUrl, token, 'GET', '/api/v1/works');
    return response.data.works?.find((item) => item.name === 'Real Browser Work');
  }, 'created Work');
  const workId = work.id;
  assert.equal(typeof workId, 'string');
  await waitFor(async () => {
    const response = await api(coreUrl, token, 'GET', `/api/v1/works/${workId}`);
    return response.data.observedState === 'ready' ? response.data : undefined;
  }, 'running Work', 180_000);
  await page.reload();
  await page.getByRole('button', { name: 'Real Browser Work' }).waitFor();
  await page.screenshot({ path: join(screenshotDir, '02-running-work-list.png'), fullPage: true });
  await page.getByRole('button', { name: 'Real Browser Work' }).click();

  const script = "const http=require('node:http');http.createServer((req,res)=>{if(req.url==='/health'){res.end('ok');return;}res.setHeader('Content-Type','text/html');res.end('<h1>Real Service</h1>');}).listen(8099,'0.0.0.0')";
  const definition = { name: 'browser-service', image: { reference: image }, command: 'node', args: ['-e', script],
    workingDirectory: '/var/data/workspace',
    mounts: [{ source: 'workspace', target: '/var/data/workspace', readOnly: false }],
    ports: [{ name: 'web', protocol: 'tcp', containerPort: 8099 }],
    readiness: { kind: 'http', portName: 'web', path: '/health', deadlineMs: 10000 } };
  const service = await api(coreUrl, token, 'POST', `/api/v1/works/${workId}/services`,
    { definition, idempotencyKey: 'browser-real-service' });
  assert.equal(service.status, 202, JSON.stringify(service.data));
  await waitFor(async () => {
    const response = await api(coreUrl, token, 'GET', `/api/v1/operations/${service.data.operationId}`);
    return response.data.state === 'succeeded' ? response.data : undefined;
  }, 'Service operation', 180_000);
  await page.reload();
  await page.getByRole('combobox', { name: 'Choose Service' }).selectOption({ label: 'browser-service' });
  await page.frameLocator('iframe').getByRole('heading', { name: 'Real Service' }).waitFor();
  await page.screenshot({ path: join(screenshotDir, '03-service-preview.png'), fullPage: true });
  const newPage = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Open application tab' }).click();
  const app = await newPage;
  await app.getByRole('heading', { name: 'Real Service' }).waitFor();
  await app.screenshot({ path: join(screenshotDir, '04-service-tab.png'), fullPage: true });
  await app.close();

  const uploaded = await fetch(`${coreUrl}/api/v1/works/${workId}/files/note.txt`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: 'real-browser-file',
  });
  assert([201, 204].includes(uploaded.status), await uploaded.text());
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await page.getByRole('button', { name: 'File · note.txt' }).waitFor();
  await page.getByRole('button', { name: 'File · note.txt' }).click();
  await page.getByRole('textbox', { name: 'Edit note.txt' }).fill('saved by real browser Files');
  await page.getByRole('button', { name: 'Save file', exact: true }).click();
  await page.getByText('note.txt saved.', { exact: true }).waitFor();
  const readFileThroughCore = async () => {
    const response = await fetch(`${coreUrl}/api/v1/works/${workId}/files/note.txt`,
      { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    return response.text();
  };
  assert.equal(await readFileThroughCore(), 'saved by real browser Files');
  await page.screenshot({ path: join(screenshotDir, '05-files.png'), fullPage: true });

  const localFileUrl = `**/_desktop/files/works/${workId}/files/note.txt`;
  let uncertainWrites = 0;
  let writeFaultError;
  const loseWriteReply = async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    uncertainWrites++;
    try {
      const original = new URL(route.request().url());
      const target = new URL(original);
      target.hostname = '127.0.0.1';
      const response = await route.fetch({ url: target.href,
        headers: { ...route.request().headers(), host: original.host } });
      assert([201, 204].includes(response.status()));
    } catch { writeFaultError = new Error('Injected write forwarding failed before its response could be discarded'); }
    finally { await route.abort('failed'); }
  };
  await page.route(localFileUrl, loseWriteReply);
  await page.getByRole('button', { name: 'File · note.txt' }).click();
  await page.getByRole('textbox', { name: 'Edit note.txt' }).fill('committed with lost browser reply');
  await page.getByRole('button', { name: 'Save file', exact: true }).click();
  await page.getByText(/Save file: .*Refresh to confirm/).waitFor();
  if (writeFaultError) throw writeFaultError;
  assert.equal(await readFileThroughCore(), 'committed with lost browser reply');
  await page.screenshot({ path: join(screenshotDir, '08-file-result-unknown.png'), fullPage: true });
  await page.unroute(localFileUrl, loseWriteReply);
  assert.equal(uncertainWrites, 1, 'Desktop resubmitted a file write whose reply was lost');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh files' }).click();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByText('Saved and active configuration are aligned.', { exact: true }).waitFor();
  await page.screenshot({ path: join(screenshotDir, '06-settings.png'), fullPage: true });
  await page.getByRole('button', { name: 'AGENTS.md', exact: true }).click();
  await page.getByRole('textbox', { name: 'AGENTS.md content' }).fill('# Real browser Work\nUse the shared workspace.\n');
  await page.getByRole('button', { name: 'Save AGENTS.md', exact: true }).click();
  await page.getByText('AGENTS.md saved. Apply changes to load it.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Refresh configuration status' }).click();
  await page.getByText(/Saved changes are waiting to be applied/).waitFor();
  await page.screenshot({ path: join(screenshotDir, '09-settings-pending.png'), fullPage: true });
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await waitFor(async () => {
    const response = await api(coreUrl, token, 'GET', `/api/v1/works/${workId}/configuration`);
    return response.data.pendingApply === false && response.data.runtime?.state === 'ready';
  }, 'applied Work configuration', 180_000);
  await page.getByRole('button', { name: 'Refresh Work' }).click();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByRole('button', { name: 'New session' }).click();
  await page.getByRole('combobox', { name: 'Session', exact: true }).waitFor();
  await waitFor(() => page.getByRole('button', { name: 'Send message', exact: true }).isEnabled(), 'new Session composer');
  await page.getByRole('textbox', { name: 'Message Agent' }).fill('Say hello');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.locator('.run-status').filter({ hasText: /succeeded/ }).waitFor({ timeout: 90_000 });
  assert((await page.locator('.run-output').innerText()).length > 0, 'real SDK conversation produced no visible text');
  await page.screenshot({ path: join(screenshotDir, '07-chat.png'), fullPage: true });

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Stop Work', exact: true }).click();
  await waitFor(async () => {
    const response = await api(coreUrl, token, 'GET', `/api/v1/works/${workId}`);
    return response.data.desiredState === 'stopped' && response.data.observedState === 'stopped';
  }, 'stopped source Work', 180_000);
  await page.getByRole('button', { name: 'Refresh Work' }).click();
  await page.getByRole('button', { name: 'Prepare .work package', exact: true }).waitFor();
  await page.screenshot({ path: join(screenshotDir, '10-stopped-work.png'), fullPage: true });
  await page.getByRole('button', { name: 'Prepare .work package', exact: true }).click();
  await page.getByRole('link', { name: 'Download .work package' }).waitFor({ timeout: 180_000 });
  await page.screenshot({ path: join(screenshotDir, '11-export-ready.png'), fullPage: true });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download .work package' }).click();
  const download = await downloadEvent;
  const exportedPath = join(root, 'browser-export.work');
  await download.saveAs(exportedPath);
  assert.equal(await download.failure(), null);
  await page.getByRole('button', { name: 'All Works' }).click();
  await page.getByRole('button', { name: 'Import .work', exact: true }).click();
  await page.getByLabel('Select .work package').setInputFiles(exportedPath);
  await page.getByRole('button', { name: 'Inspect package', exact: true }).click();
  await page.getByText('Package verified. Review the summary before importing.', { exact: true }).waitFor({ timeout: 180_000 });
  await page.getByRole('textbox', { name: 'Imported Work name (optional)' }).fill('Browser Imported Work');
  await page.screenshot({ path: join(screenshotDir, '12-import-review.png'), fullPage: true });
  await page.getByRole('button', { name: 'Import inspected package', exact: true }).click();
  await page.getByText(/Browser Imported Work imported · stopped/).waitFor({ timeout: 180_000 });
  await page.screenshot({ path: join(screenshotDir, '13-import-stopped.png'), fullPage: true });
  const imported = await waitFor(async () => {
    const response = await api(coreUrl, token, 'GET', '/api/v1/works');
    return response.data.works?.find((item) => item.name === 'Browser Imported Work');
  }, 'imported Work identity');
  assert.notEqual(imported.id, workId);
  assert.equal(imported.observedState, 'stopped');
  await page.getByRole('button', { name: 'Open Work', exact: true }).click();
  await page.locator('.work-panel-header .toolbar-actions > button').filter({ hasText: /^Start Work$/ }).click();
  await waitFor(async () => {
    const response = await api(coreUrl, token, 'GET', `/api/v1/works/${imported.id}`);
    return response.data.observedState === 'ready';
  }, 'explicitly started imported Work', 180_000);
  await page.getByRole('button', { name: 'Refresh Work' }).click();
  await page.frameLocator('iframe').getByRole('heading', { name: 'Real Service' }).waitFor();
  const restoredHistory = page.locator('.agent-aside .chat-messages');
  await waitFor(async () => (await restoredHistory.innerText()).includes('skill-read:'), 'restored Session history');
  const historyBounds = await restoredHistory.boundingBox();
  assert(historyBounds && historyBounds.height <= 560, 'long Session history expanded the Service preview');
  await page.frameLocator('iframe').getByRole('heading', { name: 'Real Service' }).waitFor();
  // Give the cross-origin frame compositor a paint after the restored history reflows.
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(screenshotDir, '14-import-running.png'), fullPage: true });

  const detailUrl = `**/_desktop/api/works/${imported.id}`;
  let releaseLoading;
  const loadingBarrier = new Promise((done) => { releaseLoading = done; });
  let finishLoading;
  let loadingError;
  const loadingFinished = new Promise((done) => { finishLoading = done; });
  const holdDetail = async (route) => {
    try { await loadingBarrier; await route.continue(); }
    catch (error) { loadingError = error; }
    finally { finishLoading(); }
  };
  await page.route(detailUrl, holdDetail);
  await page.getByRole('button', { name: 'Refresh Work' }).click();
  await page.getByText('Loading Work…', { exact: true }).waitFor();
  await page.screenshot({ path: join(screenshotDir, '15-loading-work.png'), fullPage: true });
  releaseLoading();
  await loadingFinished;
  if (loadingError) throw new Error('Loading-state fixture request could not continue');
  await page.unroute(detailUrl, holdDetail);
  await page.getByRole('button', { name: 'Refresh Work' }).waitFor();
  const failDetail = async (route) => { await route.abort('failed'); };
  await page.route(detailUrl, failDetail);
  await page.getByRole('button', { name: 'Refresh Work' }).click();
  await page.getByRole('heading', { name: 'Work unavailable' }).waitFor();
  await page.screenshot({ path: join(screenshotDir, '16-work-error.png'), fullPage: true });
  await page.unroute(detailUrl, failDetail);
  console.log(JSON.stringify({ browser: browserBinary, coreUrl, workId, screenshots: screenshotDir,
    result: 'real Go Core/CLI/TS Agent: Work lifecycle, Service preview/tab, Files edit and lost reply, Save/Apply, Chat, Stop/Export/Inspect/Import/Start, empty/loading/error/unknown states' }));
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
