import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

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
    assert.equal(docker(list), '', `fixture ${kind} cleanup left owned resources`);
  }
  console.log(JSON.stringify({ result: 'fixture installation cleaned', installationId, containers: 0, networks: 0, volumes: 0 }));
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
  const lifecycleRequests = [];
  page.on('request', request => { const path = new URL(request.url()).pathname; if (request.method() === 'POST' && (/\/_desktop\/api\/works(?:$|\/[^/]+\/(?:start|stop|retry|delete)$)/).test(path)) lifecycleRequests.push(path); });
  let mainReloads = 0; page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame() && !new URL(request.url()).pathname.startsWith('/_desktop/')) mainReloads++; });
  await page.getByRole('button', { name: 'New Work', exact: true }).first().click();
  await page.locator('#create-name').fill('Real Browser Work');
  await page.getByRole('button', { name: 'Create Work', exact: true }).click();
  const work = await waitFor(async () => (await api(coreUrl, token, 'GET', '/api/v1/works')).data.works?.find(item => item.name === 'Real Browser Work'), 'created Work');
  const workId = work.id;
  const waitState = (id, state) => waitFor(async () => (await api(coreUrl, token, 'GET', `/api/v1/works/${id}`)).data.observedState === state, `Work ${state}`, 180_000);
  await expect(page.locator('#modal')).toContainText('Operation ID');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.locator('.work-row').filter({ hasText: 'Real Browser Work' })).toContainText('Ready', { timeout: 180000 });
  await waitState(workId, 'ready');
  await page.getByRole('button', { name: /^Real Browser Work/ }).click();
  await expect(page.locator('.work-header')).toContainText('Real Browser Work');
  await expect(page.locator('.work-header')).toContainText('Ready');
  const script = "const http=require('node:http');http.createServer((req,res)=>{if(req.url==='/health'){res.end('ok');return;}res.setHeader('Content-Type','text/html');res.end('<h1>Real Service</h1><input aria-label=\"Service draft\"><button onclick=\"this.textContent=Number(this.textContent)+1\">0</button>');}).listen(8099,'0.0.0.0')";
  const definition = { name: 'browser-service', image: { reference: image }, command: 'node', args: ['-e', script], workingDirectory: '/var/data/workspace', mounts: [{ source: 'workspace', target: '/var/data/workspace', readOnly: false }], ports: [{ name: 'web', protocol: 'tcp', containerPort: 8099 }], readiness: { kind: 'http', portName: 'web', path: '/health', deadlineMs: 10000 } };
  const service = await api(coreUrl, token, 'POST', `/api/v1/works/${workId}/services`, { definition, idempotencyKey: 'browser-real-service' });
  assert.equal(service.status, 202, JSON.stringify(service.data));
  await waitFor(async () => (await api(coreUrl, token, 'GET', `/api/v1/operations/${service.data.operationId}`)).data.state === 'succeeded', 'Service operation', 180_000);
  await page.getByRole('button', { name: 'Services', exact: true }).click();
  await page.frameLocator('iframe').getByRole('heading', { name: 'Real Service' }).waitFor({ timeout: 20000 });
  const disabled = await api(coreUrl, token, 'POST', `/api/v1/works/${workId}/services`, { definition: { ...definition, name: 'disabled-service', ports: [{ name: 'web', protocol: 'tcp', containerPort: 8098 }], args: ['-e', script.replace('8099', '8098')] }, idempotencyKey: 'browser-disabled-service' });
  assert.equal(disabled.status, 202);
  await waitFor(async () => (await api(coreUrl, token, 'GET', `/api/v1/operations/${disabled.data.operationId}`)).data.state === 'succeeded', 'disabled Service create', 180000);
  const disable = await api(coreUrl, token, 'POST', `/api/v1/works/${workId}/services/${disabled.data.serviceId}/disable`, { idempotencyKey: 'browser-disable-service' });
  assert.equal(disable.status, 202);
  await waitFor(async () => (await api(coreUrl, token, 'GET', `/api/v1/operations/${disable.data.operationId}`)).data.state === 'succeeded', 'disable operation', 180000);
  const sentinel = Buffer.from('lifecycle sentinel: durable workspace\n');
  const sentinelWrite = await fetch(`${coreUrl}/api/v1/works/${workId}/files/lifecycle-sentinel.txt`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'If-None-Match': '*' }, body: sentinel });
  assert.equal(sentinelWrite.status, 201);
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
  if (process.env.PIWORK_TEST_LOCAL_AUTH_RECOVERY === '1') {
    const localOrigin = new URL(launchUrl).origin;
    const readAdapter = (code) => page.evaluate(`(async () => { const { adapter } = await import('/desktop/browser/adapter.js'); ${code} })()`);
    const helper = (action) => spawnSync(cliBinary, ['desktop', action, '--port', String(desktopPort), ...(action === 'open' ? ['--no-open'] : [])], { encoding: 'utf8', cwd: '/tmp', env: { ...process.env, PATH: '/nonexistent', PIWORK_CONFIG_PATH: '/wrong/credential', PIWORK_CORE_URL: 'invalid-core' } });
    const reopen = () => { const result = helper('open'); assert.equal(result.status, 0, result.stderr); return result.stdout.trim().replace('Piwork Desktop: ', ''); };
    const loginAgain = async (target) => {
      await target.getByRole('heading', { name: 'Connect to your Core' }).waitFor();
      await target.getByLabel('Account', { exact: true }).fill('admin'); await target.getByLabel('Password').fill('real-browser-admin-password');
      await target.getByRole('button', { name: 'Sign in', exact: true }).click(); await target.getByRole('heading', { name: 'Works', exact: true }).waitFor(); await target.evaluate(async () => { const { adapter } = await import('/desktop/browser/adapter.js'); await adapter.checkConnection(); });
    };
    const runBefore = await readAdapter('return adapter.getWork("' + workId + '")?.run?.id');
    const identityBefore = JSON.parse(await readFile(join(root, 'client.json'), 'utf8'));
    const fileBefore = await readFileThroughCore(); const pid = desktop.pid;
    let bootstrapPosts = 0, resetPosts = 0, businessWrites = 0;
    page.on('request', request => { if (request.url().endsWith('/bootstrap')) bootstrapPosts++; if (request.url().endsWith('/browser-access/reset')) resetPosts++; if (request.method() !== 'GET' && /\/(?:runs|work-imports|start|stop|retry|delete)(?:$|\?)/.test(new URL(request.url()).pathname)) businessWrites++; });
    await page.goto(launchUrl); await page.getByRole('heading', { name: 'Works', exact: true }).waitFor(); assert.equal(bootstrapPosts, 0);
    await context.clearCookies(); await page.goto(localOrigin); await page.getByRole('heading', { name: 'Browser access required' }).waitFor();
    await page.goto(reopen()); await page.getByRole('heading', { name: 'Works', exact: true }).waitFor(); assert.equal(desktop.pid, pid);
    const secondContext = await browser.newContext(); const second = await secondContext.newPage(); await second.goto(reopen()); await second.getByRole('heading', { name: 'Works', exact: true }).waitFor();
    const oldPending = reopen();
    await page.locator('[data-action=account]').click(); await page.getByRole('button', { name: 'Reset browser access', exact: true }).click(); await page.getByRole('button', { name: 'Reset browser access', exact: true }).click();
    await page.getByRole('heading', { name: 'Browser access required' }).waitFor(); assert.equal(resetPosts, 1);
    await second.reload(); await second.getByRole('heading', { name: 'Browser access required' }).waitFor(); await second.goto(oldPending); await second.getByRole('heading', { name: 'Browser access required' }).waitFor();
    assert.equal(JSON.parse(await readFile(join(root, 'client.json'), 'utf8')).token, identityBefore.token);
    await page.goto(reopen()); await page.getByRole('heading', { name: 'Works', exact: true }).waitFor();
    await page.locator('[data-action=account]').click(); await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await loginAgain(page);
    let result = helper('logout'); assert.equal(result.status, 0, result.stderr);
    await page.goto(reopen()); await loginAgain(page);
    const captured = JSON.parse(await readFile(join(root, 'client.json'), 'utf8'));
    assert([200,204].includes((await api(coreUrl, captured.token, 'POST', '/api/v1/logout')).status));
    await readAdapter('await adapter.checkBrowserAccess().catch(error => { if (error.code !== \"CONNECTION_CHANGED\") throw error; })'); await loginAgain(page);
    await readAdapter('await adapter.checkConnection()');
    // Pause only this isolated Core process; Docker workloads continue running.
    core.kill('SIGSTOP');
    try { await readAdapter('await adapter.checkBrowserAccess()'); assert.equal(await readAdapter('return adapter.state.browserAccess'), 'authorized'); assert.equal(await readAdapter('return adapter.state.scenario'), 'core-offline'); }
    finally { core.kill('SIGCONT'); }
    await readAdapter('await adapter.checkConnection()'); assert.equal(await readAdapter('return adapter.state.signedIn'), true);
    assert.equal(desktop.pid, pid); assert.equal((await api(coreUrl, token, 'GET', `/api/v1/works/${workId}`)).data.observedState, 'ready');
    assert.equal((await api(coreUrl, token, 'GET', `/api/v1/works/${workId}/services/${service.data.serviceId}`)).data.service?.observedState ?? (await api(coreUrl, token, 'GET', `/api/v1/works/${workId}/services`)).data.services?.[0]?.observedState, 'ready');
    assert.equal(await readFileThroughCore(), fileBefore); assert.equal(businessWrites, 0);
    await page.getByRole('button', { name: /^Real Browser Work/ }).click(); await page.frameLocator('iframe').getByRole('heading', { name: 'Real Service' }).waitFor();
    const savedRun = await api(coreUrl, token, 'GET', `/api/v1/works/${workId}/runs/${runBefore}`); assert.equal(savedRun.status, 200); assert.equal((savedRun.data.run ?? savedRun.data).runId, runBefore);
    await waitFor(async () => (await page.locator('#messages').innerText()).includes('skill-read:'), 'original accepted Run history after auth recovery');
    await secondContext.close();
    // Existing independent application window must also obtain new browser access.
    await app.goto(reopen()); await app.getByRole('heading', { name: 'Works', exact: true }).waitFor(); await app.getByRole('button', { name: /^Real Browser Work/ }).click();
    await page.screenshot({ path: join(screenshotDir, '06-auth-recovered.png'), fullPage: true });
    console.log(JSON.stringify({ result: 'local auth recovery: real Core login/reuse/reopen/logout/reset/revocation/offline, original PID/Work/Service/files/Run retained, no business replay', browserVersion: browser.version(), bootstrapPosts, resetPosts, businessWrites }));
  }
  await page.getByRole('button', { name: 'Work options' }).click();
  await page.getByRole('button', { name: 'Export Work', exact: true }).last().click();
  await page.getByText(/Stop this Work explicitly/).waitFor();
  assert.equal(await page.locator('[data-action=prepare-export]').count(), 0);
  await page.getByRole('button', { name: 'Stop Work first', exact: true }).click();
  await page.getByRole('button', { name: 'Stop Work', exact: true }).last().click();
  await expect(page.locator('#modal')).toContainText('Operation ID');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('heading', { name: 'This Work is stopped', exact: true })).toBeVisible({ timeout: 180000 });
  await waitState(workId, 'stopped');
  console.log('Real Desktop: first Stop confirmed');
  await app.bringToFront();
  await app.getByRole('heading', { name: 'This Work is stopped', exact: true }).waitFor({timeout:15000});
  await app.close(); await page.bringToFront();
  const installationId = JSON.parse(await readFile(join(dataDir, 'core-format.json'), 'utf8')).installationId;
  assert.equal(docker(['ps', '-q', '--filter', `label=piwork.installation_id=${installationId}`, '--filter', `label=piwork.work_id=${workId}`]), '', 'stopped Work retained running resources');
  for (const [method, path, body] of [['POST', `/api/v1/works/${workId}/runs`, { sessionId: 'stopped-probe', prompt: 'must not run' }], ['POST', `/api/v1/works/${workId}/services/${service.data.serviceId}/restart`, { idempotencyKey: 'denied-stopped-restart' }]]) {
    const rejected = await api(coreUrl, token, method, path, body);
    assert.equal(rejected.data.code, method === 'POST' && path.endsWith('/runs') ? 'WORK_UNAVAILABLE' : 'FAILED_PRECONDITION', 'stopped Work must reject runtime by its actual state');
  }
  const stoppedFiles = await fetch(`${coreUrl}/api/v1/works/${workId}/files/lifecycle-sentinel.txt`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(stoppedFiles.status, 409);
  const stoppedWrite = await fetch(`${coreUrl}/api/v1/works/${workId}/files/denied-while-stopped.txt`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'If-None-Match': '*' }, body: 'must not be committed' });
  assert.equal(stoppedWrite.status, 409);
  const stoppedService = (await api(coreUrl, token, 'GET', `/api/v1/works/${workId}/services`)).data.services.find(item => item.serviceId === service.data.serviceId);
  const stoppedGateway = await fetch(`${coreUrl}/api/v1/service-gateway/${stoppedService.access.hostname}/8099/`, { headers: { 'X-Piwork-Gateway-Token': token } });
  assert.equal((await stoppedGateway.json()).code, 'SERVICE_UNAVAILABLE');
  await page.screenshot({ path: join(screenshotDir, '07-work-stopped.png'), fullPage: true });
  await page.getByRole('button', { name: 'Start Work', exact: true }).first().click();
  await expect(page.locator('#modal')).toContainText('Operation ID'); await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.locator('.work-header')).toContainText('Ready', { timeout: 180000 });
  await page.frameLocator('iframe').getByRole('heading', { name: 'Real Service' }).waitFor({ timeout: 20000 });
  await waitState(workId, 'ready');
  console.log('Real Desktop: original Work Start confirmed');
  const restored = (await api(coreUrl, token, 'GET', `/api/v1/works/${workId}/services`)).data.services;
  assert.equal(restored.find(item => item.serviceId === service.data.serviceId)?.enabled, true);
  assert.equal(restored.find(item => item.serviceId === disabled.data.serviceId)?.enabled, false);
  assert.equal(restored.find(item => item.serviceId === disabled.data.serviceId)?.observedState, 'disabled');
  const sentinelRead = await fetch(`${coreUrl}/api/v1/works/${workId}/files/lifecycle-sentinel.txt`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(sentinelRead.status, 200); assert.deepEqual(Buffer.from(await sentinelRead.arrayBuffer()), sentinel);
  await page.screenshot({ path: join(screenshotDir, '08-work-restarted.png'), fullPage: true });
  await page.getByRole('button', { name: 'Back to Works' }).click();
  await expect(page.locator('.work-row').filter({ hasText: 'Real Browser Work' })).toContainText('Ready');
  await page.getByRole('button', { name: /^Real Browser Work/ }).click();
  await expect(page.locator('.work-header')).toContainText('Real Browser Work');
  if (process.env.PIWORK_TEST_LOCAL_AUTH_RECOVERY !== '1') assert.equal(mainReloads, 0, 'lifecycle required a page reload');
  await page.getByRole('button', { name: 'Stop Work', exact: true }).first().click();
  await page.getByRole('button', { name: 'Stop Work', exact: true }).last().click();
  await expect(page.locator('#modal')).toContainText('Operation ID'); await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('heading', { name: 'This Work is stopped', exact: true })).toBeVisible({ timeout: 180000 });
  await page.getByRole('button', { name: 'Work options' }).click();
  await page.getByRole('button', { name: 'Export Work', exact: true }).last().click();
  console.log('Real Desktop: second Stop confirmed; preparing snapshot');
  await page.getByRole('button', { name: 'Prepare .work package', exact: true }).click();
  await page.getByRole('button', { name: 'View package', exact: true }).waitFor({ timeout: 180_000 });
  await page.getByRole('button', { name: 'View package', exact: true }).click();
  console.log('Real Desktop: snapshot prepared');
  const downloadEvent = page.waitForEvent('download', { timeout: 180_000 });
  await page.getByRole('button', { name: 'Download .work', exact: true }).waitFor({timeout:180_000});
  await page.getByRole('button', { name: 'Download .work', exact: true }).click();
  const download = await downloadEvent; const exportedPath = join(root, 'browser-export.work'); await download.saveAs(exportedPath); assert.equal(await download.failure(), null);
  assert.equal((await readFile(exportedPath)).subarray(0,8).toString(), 'PIWORK1\n', 'export is not a real archive');
  await page.getByRole('button', { name: 'Close dialog' }).click({ noWaitAfter: true });
  await expect(page.locator('#modal')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to Works' }).click();
  await page.getByRole('button', { name: 'Import Work', exact: true }).click();
  await page.locator('#work-file-input').setInputFiles(exportedPath);
  await page.getByText('Package format and contents verified locally.', { exact: true }).waitFor({ timeout: 180_000 });
  await page.locator('#import-name').fill('Browser Imported Work');
  await page.getByRole('button', { name: 'Import Work', exact: true }).last().click();
  const imported = await waitFor(async () => (await api(coreUrl, token, 'GET', '/api/v1/works')).data.works?.find(item => item.name === 'Browser Imported Work'), 'imported Work', 180_000);
  assert.notEqual(imported.id, workId); assert.equal(imported.observedState, 'stopped');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.locator('.work-row').filter({ hasText: 'Browser Imported Work' })).toContainText('Stopped', { timeout: 180000 });
  await page.getByRole('button', { name: /^Browser Imported Work/ }).click();
  await page.getByRole('heading', { name: 'Browser Imported Work', exact: true }).waitFor();
  const start = page.getByRole('button', { name: 'Start Work', exact: true }).first();
  assert.equal(await start.getAttribute('data-id'), imported.id, 'Start must target the opened Work');
  await start.click();
  await page.getByRole('heading', {name:'Start Work', exact:true}).waitFor();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.locator('.work-header')).toContainText('Ready', { timeout: 180000 });
  await waitState(imported.id, 'ready');
  await page.getByRole('button', { name: 'Services', exact: true }).click();
  await page.frameLocator('iframe').getByRole('heading', { name: 'Real Service' }).waitFor();
  await waitFor(async () => (await page.locator('#messages').innerText()).includes('skill-read:'), 'restored session history');
  await page.screenshot({ path: join(screenshotDir, '04-restored-work.png'), fullPage: true });
  for (const width of [1440,1024,390]) { await page.setViewportSize({ width, height: 900 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `horizontal overflow at ${width}px`); await page.screenshot({ path: join(screenshotDir, `05-responsive-${width}.png`), fullPage: true }); }
  await page.getByRole('button', { name: 'Work options' }).click(); await page.getByRole('button', { name: 'Delete Work', exact: true }).click(); await page.locator('#delete-confirm').check(); await page.getByRole('button', { name: 'Delete Work', exact: true }).last().click();
  await expect(page.locator('#modal')).toContainText('Operation ID');
  const deleteId = await page.locator('#modal dd code').first().innerText();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.locator('.work-row').filter({ hasText: 'Browser Imported Work' })).toHaveCount(0, { timeout: 180000 });
  await page.screenshot({ path: join(screenshotDir, '09-disposable-work-deleted.png'), fullPage: true });
  await waitFor(async () => (await api(coreUrl, token, 'GET', `/api/v1/operations/${deleteId}`)).data.state === 'succeeded', 'original Delete ID', 180000);
  assert.equal((await api(coreUrl, token, 'GET', `/api/v1/works/${imported.id}`)).status, 404);
  assert.equal(lifecycleRequests.filter(path => path === '/_desktop/api/works').length, 1);
  assert.equal(lifecycleRequests.filter(path => path.endsWith(`/${workId}/stop`)).length, 2);
  assert.equal(lifecycleRequests.filter(path => path.endsWith(`/${workId}/start`)).length, 1);
  assert.equal(lifecycleRequests.filter(path => path.endsWith(`/${imported.id}/start`)).length, 1);
  assert.equal(lifecycleRequests.filter(path => path.endsWith(`/${imported.id}/delete`)).length, 1);
  if (process.env.PIWORK_TEST_LOCAL_AUTH_RECOVERY !== '1') assert.equal(mainReloads, 0, 'lifecycle required reloading the WebUI document');
  console.log(JSON.stringify({ result: 'lifecycle confirmed: enabled/disabled Service, sentinel bytes, stopped resources, Delete original ID', browserVersion: browser.version(), mainReloads, lifecycleRequests, installationId, sentinelBytes: sentinel.length, enabledService: restored.find(item => item.serviceId === service.data.serviceId)?.observedState, disabledService: restored.find(item => item.serviceId === disabled.data.serviceId)?.observedState, stoppedRunningResources: 0, stoppedFileRead: stoppedFiles.status, stoppedFileWrite: stoppedWrite.status }));
  console.log(JSON.stringify({ result: 'real Go Core/CLI: lifecycle, Service iframe preservation/tab, Run, binary WebDAV, uncertain write, Save/Apply, Stop/Export/Inspect/Import/Start and responsive layout', workId, screenshots: screenshotDir }));
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(screenshotDir, '99-failure.png'), fullPage: true }).catch(() => undefined);
    console.error('Browser page:', page.url().replace(/#ticket=[\w-]+/g, '#ticket=[redacted]'), '\n', await page.locator('body').innerText().catch(() => 'unavailable'));
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
