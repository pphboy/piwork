import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { chromium } from '@playwright/test';
import { FileCredentialStore, PiworkClient } from '@piwork/client-sdk';

const root = new URL('../', import.meta.url).pathname;
const core = process.env.PIWORK_LIVE_CORE_URL;
const adminConfig = process.env.PIWORK_LIVE_CONFIG_PATH;
const ownerConfig = process.env.PIWORK_LIVE_SECOND_CONFIG_PATH;
const ownerWork = process.env.PIWORK_LIVE_SECOND_WORK_ID;
const ownerWorkName = process.env.PIWORK_LIVE_SECOND_WORK_NAME;
const dataDir = process.env.PIWORK_LIVE_DATA_DIR;
const browsers = process.env.PIWORK_LIVE_BROWSERS?.split(':').filter(Boolean) ?? [];
const rcloneBinary = process.env.PIWORK_RCLONE_BIN || 'rclone';
if (!core || !adminConfig || !ownerConfig || !ownerWork || !ownerWorkName || !dataDir || !browsers.length)
  throw new Error('Missing real Desktop access acceptance settings');
const temporary = dirname(ownerConfig);
const otherAccount = 'desktop-peer-' + process.pid;
let otherPassword = 'desktop-peer-password-' + randomUUID();
const otherConfig = join(temporary, 'desktop-peer-user.json');
const davConfig = join(temporary, 'desktop-rclone.conf');
const fileName = 'desktop-dav-alternating.txt';
const filePath = join(temporary, fileName);
const returnedPath = join(temporary, 'desktop-dav-returned.txt');
const now = () => Date.now();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function checked(binary, args, input, env = process.env) {
  const result = spawnSync(binary, args, { cwd: root, env, input, encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024, timeout: 120_000 });
  if (result.status !== 0) throw new Error(binary + ' ' + args.slice(0, 2).join(' ')
    + ' failed (' + result.status + '): ' + String(result.stderr).slice(0, 800));
  return result.stdout.trim();
}
const otherCli = (args) => checked(process.execPath,
  ['apps/cli/dist/main.js', '--core', core, '--json', ...args], undefined,
  { ...process.env, PIWORK_CONFIG_PATH: otherConfig });
const rclone = (...args) => checked(rcloneBinary, args, undefined,
  { ...process.env, RCLONE_CONFIG: davConfig });
async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
async function startCli(configPath, action, port) {
  const child = spawn(process.execPath,
    ['apps/cli/dist/main.js', '--core', core, action, '--port', String(port), '--no-open'].filter((item) => item !== '--no-open' || action === 'desktop'),
    { cwd: root, env: { ...process.env, PIWORK_CONFIG_PATH: configPath },
      stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', (bytes) => { output += String(bytes); });
  child.stderr.on('data', (bytes) => { errors += String(bytes); });
  const ready = action === 'desktop'
    ? /http:\/\/desktop\.localhost:\d+\/#ticket=[A-Za-z0-9_-]+/
    : /WebDAV password: ([A-Za-z0-9_-]+)/;
  const deadline = now() + 20_000;
  while (!ready.test(output) && child.exitCode === null && now() < deadline) await delay(50);
  const match = ready.exec(output);
  if (!match) { child.kill('SIGINT'); throw new Error(action + ' startup failed: ' + errors.slice(0, 800)); }
  return { child, port, output: () => output, value: action === 'desktop' ? match[0] : match[1] };
}
async function stopCli(item) {
  if (!item || item.child.exitCode !== null) return;
  const exited = new Promise((done) => item.child.once('exit', done));
  item.child.kill('SIGINT');
  await Promise.race([exited, delay(20_000).then(() => { throw new Error('CLI shutdown timed out'); })]);
}
async function waitOperation(client, operationId, allowFailed = false) {
  for (let attempt = 0; attempt < 180; attempt++) {
    const item = await client.operation(operationId);
    if (item.state === 'succeeded' || allowFailed && item.state === 'failed') return item;
    if (item.state === 'failed' || item.state === 'superseded')
      throw new Error('Operation ' + operationId + ' ended ' + item.state + ': ' + JSON.stringify(item));
    await delay(1000);
  }
  throw new Error('Operation ' + operationId + ' timed out');
}
async function waitUntil(check, label, timeout = 15_000) {
  const deadline = now() + timeout;
  while (now() < deadline) {
    if (await check()) return;
    await delay(75);
  }
  throw new Error(label + ' timed out');
}
async function browseWork(browser, executable, configPath, workName) {
  const port = await freePort();
  const desktop = await startCli(configPath, 'desktop', port);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(desktop.value);
  await page.getByRole('heading', { name: 'Your Works' }).waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: workName, exact: true }).waitFor();
  return { desktop, context, page, executable };
}
async function deniedCrossAccess(page, otherWork, otherService) {
  return page.evaluate(async ({ workId, serviceId }) => {
    const session = await (await fetch('/_desktop/api/session')).json();
    const work = await fetch('/_desktop/api/works/' + workId);
    const files = await fetch('/_desktop/files/works/' + workId + '/files/');
    const service = await fetch('/_desktop/api/service-entries', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-piwork-csrf': session.csrf },
      body: JSON.stringify({ workId, serviceId }),
    });
    return { work: work.status, files: files.status, service: service.status };
  }, { workId: otherWork, serviceId: otherService });
}
async function writeDavConfig(port, workId, password) {
  const obscured = checked(rcloneBinary, ['obscure', '-'], password + '\n');
  const content = '[owner]\ntype = webdav\nvendor = other\nurl = http://127.0.0.1:'
    + port + '/works/' + workId + '/files/\nuser = piwork\npass = ' + obscured + '\n';
  await writeFile(davConfig, content, { mode: 0o600 });
  await chmod(davConfig, 0o600);
}
async function refreshFiles(page) {
  await page.getByRole('button', { name: 'Refresh files' }).click();
  await page.waitForFunction(() => document.querySelector('.file-status')?.textContent?.startsWith('Files last checked'));
}
async function davAlternation(page, configPath, workId) {
  const proxyPort = await freePort();
  let proxy = await startCli(configPath, 'proxy', proxyPort);
  try {
    await writeDavConfig(proxyPort, workId, proxy.value);
    await writeFile(filePath, 'from rclone one\n');
    rclone('copyto', '--ignore-times', filePath, 'owner:' + fileName);
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await page.getByRole('heading', { name: 'Workspace files' }).waitFor();
    await refreshFiles(page);
    await page.getByRole('button', { name: 'File · ' + fileName }).click();
    const editor = page.getByRole('textbox', { name: 'Edit ' + fileName });
    assert.equal(await editor.inputValue(), 'from rclone one\n');
    await editor.fill('from browser Files\n');
    await page.getByRole('button', { name: 'Save file' }).click();
    await page.getByText(fileName + ' saved').waitFor();
    rclone('copyto', '--ignore-times', 'owner:' + fileName, returnedPath);
    assert.equal(await readFile(returnedPath, 'utf8'), 'from browser Files\n');
    await writeFile(filePath, 'from rclone two\n');
    rclone('copyto', '--ignore-times', filePath, 'owner:' + fileName);
    await refreshFiles(page);
    await page.getByRole('button', { name: 'File · ' + fileName }).click();
    assert.equal(await page.getByRole('textbox', { name: 'Edit ' + fileName }).inputValue(), 'from rclone two\n');
    assert.equal((await page.locator('body').innerText()).includes(proxy.value), false,
      'WebDAV password must remain in the terminal');
    const oldPassword = proxy.value;
    await stopCli(proxy);
    proxy = await startCli(configPath, 'proxy', proxyPort);
    assert.notEqual(proxy.value, oldPassword);
    const oldBasic = 'Basic ' + Buffer.from('piwork:' + oldPassword).toString('base64');
    const oldAccess = await fetch('http://127.0.0.1:' + proxyPort + '/works/' + workId + '/files/' + fileName,
      { headers: { Authorization: oldBasic } });
    assert.equal(oldAccess.status, 401, 'old proxy password must expire on restart');
    await writeDavConfig(proxyPort, workId, proxy.value);
    rclone('copyto', '--ignore-times', 'owner:' + fileName, returnedPath);
    assert.equal(await readFile(returnedPath, 'utf8'), 'from rclone two\n');
    await refreshFiles(page);
    assert.equal((await page.locator('body').innerText()).includes(proxy.value), false);
  } finally { await stopCli(proxy); }
}
async function serviceProbe(page, workId, serviceId) {
  const knownPages = new Set(page.context().pages());
  const opening = page.context().waitForEvent('page', { timeout: 8_000 });
  const servicesTab = page.getByRole('button', { name: 'Services', exact: true });
  if (await servicesTab.getAttribute('aria-current') !== 'page') await servicesTab.click();
  await page.getByRole('button', { name: 'Open application tab' }).click();
  let popup;
  try { popup = await opening; }
  catch (error) {
    popup = page.context().pages().find((candidate) => !knownPages.has(candidate));
    if (popup) return await readyServicePopup(popup);
    const state = await page.evaluate(async ({ workId, serviceId }) => {
      const session = await (await fetch('/_desktop/api/session')).json();
      const port = Number(document.querySelector('.service-port')?.value);
      const entry = await fetch('/_desktop/api/service-entries', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-piwork-csrf': session.csrf },
        body: JSON.stringify({ workId, serviceId, port }) });
      return { url: location.href, text: document.body.innerText.slice(0, 2500),
        message: document.querySelector('.message')?.textContent, port,
        session: { state: session.state, generation: session.generation },
        entry: { status: entry.status, text: (await entry.text()).slice(0, 300) } };
    }, { workId, serviceId }).catch(() => null);
    throw new Error('Service popup did not open: ' + JSON.stringify({ ...state,
      pages: page.context().pages().map((candidate) => candidate.url()) }) + ' · ' + String(error));
  }
  return await readyServicePopup(popup);
}
async function readyServicePopup(popup) {
  await popup.waitForURL((url) => url.hostname.endsWith('.desktop.localhost')
    && url.pathname === '/' && url.hash === '', { waitUntil: 'domcontentloaded' });
  await popup.evaluate(async () => {
    const probe = { sseClosedAt: 0, wsClosedAt: 0 };
    window.__desktopProbe = probe;
    const source = new EventSource('/events-hold');
    const socket = new WebSocket('ws://' + location.host + '/ws-hold');
    let receivedSse = false;
    const sseReady = new Promise((done, fail) => {
      source.onmessage = () => { receivedSse = true; done(); };
      source.onerror = () => {
        if (!receivedSse) fail(new Error('SSE failed before revocation'));
        else { probe.sseClosedAt = Date.now(); source.close(); }
      };
    });
    socket.onclose = () => { probe.wsClosedAt = Date.now(); };
    await Promise.all([
      sseReady,
      new Promise((done, fail) => { socket.onopen = done; socket.onerror = () => fail(new Error('WebSocket failed before revocation')); }),
    ]);
  });
  return popup;
}
async function directServiceProbe(page, workId, serviceId) {
  await page.getByRole('combobox', { name: 'Web port' }).waitFor();
  const entry = await page.evaluate(async ({ workId, serviceId }) => {
    const session = await (await fetch('/_desktop/api/session')).json();
    const port = Number(document.querySelector('.service-port')?.value);
    const response = await fetch('/_desktop/api/service-entries', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-piwork-csrf': session.csrf },
      body: JSON.stringify({ workId, serviceId, port }) });
    return { status: response.status, result: await response.json() };
  }, { workId, serviceId });
  assert.equal(entry.status, 200, 'fresh login must be able to issue a new Service entry');
  const popup = await page.context().newPage();
  await popup.goto(entry.result.entryUrl);
  return readyServicePopup(popup);
}
async function browserAuthorization(page, port) {
  const cookies = await page.context().cookies('http://desktop.localhost:' + port);
  const cookie = cookies.find((item) => item.name === '__Host-piwork-desktop-' + port);
  assert(cookie, 'Desktop browser session cookie missing');
  const session = await page.evaluate(async () => (await fetch('/_desktop/api/session')).json());
  return { cookie: cookie.name + '=' + cookie.value, csrf: session.csrf };
}
function activeJobs(workId) {
  const db = new DatabaseSync(join(dataDir, 'core.sqlite'), { readOnly: true });
  try {
    return db.prepare("SELECT kind FROM work_file_jobs WHERE work_id = ? AND state != 'cleaned'")
      .all(workId).map((item) => item.kind);
  } finally { db.close(); }
}
function fileJournal(workId) {
  const db = new DatabaseSync(join(dataDir, 'core.sqlite'), { readOnly: true });
  try {
    return db.prepare('SELECT kind, state, error_code FROM work_file_jobs WHERE work_id = ?')
      .all(workId);
  } finally { db.close(); }
}
async function heldFiles(page, port, workId) {
  const auth = await browserAuthorization(page, port);
  const path = '/_desktop/files/works/' + workId + '/files/';
  const headers = { Host: 'desktop.localhost:' + port, Origin: 'http://desktop.localhost:' + port,
    Cookie: auth.cookie, 'Sec-Fetch-Site': 'same-origin' };
  let getResponse;
  const getRequest = httpRequest({ host: '127.0.0.1', port, path: path + 'desktop-held-read.bin',
    method: 'GET', headers }, (response) => {
    getResponse = response;
    response.on('data', () => { response.pause(); setTimeout(() => response.resume(), 15); });
    response.resume();
  });
  const getResult = new Promise((done) => {
    getRequest.once('error', () => done({ closed: true, complete: false }));
    getRequest.once('close', () => done({ closed: true, complete: getResponse?.complete === true }));
    getRequest.once('response', (response) => {
      response.once('close', () => done({ closed: true, complete: response.complete, status: response.statusCode }));
    });
  });
  getRequest.end();
  await waitUntil(() => getResponse !== undefined, 'held GET response');
  assert.equal(getResponse.statusCode, 200);
  const putRequest = httpRequest({ host: '127.0.0.1', port, path: path + 'desktop-held-put.bin',
    method: 'PUT', headers: { ...headers, 'X-Piwork-Csrf': auth.csrf, 'Content-Type': 'application/octet-stream',
      'Transfer-Encoding': 'chunked' } });
  const putResult = new Promise((done) => {
    putRequest.once('error', () => done({ closed: true, status: 0 }));
    putRequest.once('close', () => done({ closed: true, status: 0 }));
    putRequest.once('response', (response) => {
      response.resume();
      response.once('end', () => done({ closed: true, status: response.statusCode }));
      response.once('close', () => done({ closed: true, status: response.statusCode }));
    });
  });
  putRequest.write(Buffer.alloc(16 * 1024, 7));
  await waitUntil(() => {
    const jobs = activeJobs(workId);
    return jobs.includes('GET') && jobs.includes('PUT');
  }, 'concurrent live GET/PUT file jobs', 20_000);
  let getState = 'pending', putState = 'pending';
  void getResult.then((value) => { getState = value; });
  void putResult.then((value) => { putState = value; });
  return {
    getRequest, putRequest,
    async waitClosed() {
      const [get, put] = await Promise.race([
        Promise.all([getResult, putResult]),
        delay(15_000).then(() => { throw new Error('active Files streams did not close: '
          + JSON.stringify({ getState, putState, jobs: activeJobs(workId) })); }),
      ]);
      assert.equal(get.complete, false, 'held GET must end before full transfer');
      assert.notEqual(put.status, 200, 'stalled PUT must not commit');
      assert.notEqual(put.status, 201, 'stalled PUT must not commit');
      assert.notEqual(put.status, 204, 'stalled PUT must not commit');
    },
    close() { getRequest.destroy(); putRequest.destroy(); },
  };
}
function serviceContainer(workId) {
  const service = checked('docker', ['ps', '-q', '--filter', 'label=piwork.work_id=' + workId,
    '--filter', 'label=piwork.resource_kind=service']).split('\n').filter(Boolean);
  assert.equal(service.length, 1, 'expected one running acceptance Service');
  return service[0];
}
async function extendServiceFixture(client, workId, serviceId) {
  const originalImport = 'import base64, hashlib, json, os, struct, threading';
  const originalSocket = '        elif self.path == "/ws" and self.headers.get("Upgrade", "").lower() == "websocket":';
  const heldEvents = [
    '        elif self.path == "/events-hold":',
    '            self.send_response(200)',
    '            self.send_header("Content-Type", "text/event-stream")',
    '            self.end_headers()',
    '            try:',
    '                self.wfile.write(b"data: ready\\n\\n"); self.wfile.flush()',
    '                while True:',
    '                    time.sleep(0.2)',
    '                    self.wfile.write(b": keepalive\\n\\n"); self.wfile.flush()',
    '            except (BrokenPipeError, ConnectionResetError): pass',
    '            return',
  ].join('\n');
  const oldRead = '            head = self.rfile.read(2)';
  const heldSocket = '            if self.path == "/ws-hold":\n                self.rfile.read(1)\n                return\n' + oldRead;
  const edits = [
    [originalImport, originalImport + ', time'],
    [originalSocket, heldEvents + '\n' + originalSocket.replace('self.path == "/ws"', 'self.path in ("/ws", "/ws-hold")')],
    [oldRead, heldSocket],
  ];
  const python = [
    'import json, sys',
    'from pathlib import Path',
    'path = Path("/var/data/workspace/apps/demo/server.py")',
    'source = path.read_text()',
    'for old, new in json.loads(sys.argv[1]):',
    '    assert old in source, old',
    '    source = source.replace(old, new, 1)',
    'path.write_text(source)',
  ].join('\n');
  checked('docker', ['exec', serviceContainer(workId), 'python3', '-c', python, JSON.stringify(edits)]);
  await waitOperation(client, (await client.workServiceAction(workId, serviceId, 'restart', randomUUID())).operationId);
}
async function prepareLargeFile(workId) {
  checked('docker', ['exec', serviceContainer(workId), 'python3', '-c',
    "with open('/var/data/workspace/desktop-held-read.bin','wb') as f: f.truncate(128 * 1024 * 1024)"]);
}
async function assertProbeClosed(popup, triggeredAt, label) {
  try {
    await popup.waitForFunction(() => window.__desktopProbe?.sseClosedAt && window.__desktopProbe?.wsClosedAt,
      undefined, { timeout: 5000 });
  } catch (error) {
    const state = await popup.evaluate(() => window.__desktopProbe).catch(() => null);
    throw new Error(label + ' streams stayed open: ' + JSON.stringify(state) + ' · ' + String(error));
  }
  const result = await popup.evaluate(() => window.__desktopProbe);
  assert(result.sseClosedAt - triggeredAt < 2000, label + ' SSE exceeded two-second revocation boundary');
  assert(result.wsClosedAt - triggeredAt < 2000, label + ' WebSocket exceeded two-second revocation boundary');
}
async function serviceUnavailable(popup) {
  const link = new URL('/', popup.url()).href;
  const response = await popup.goto(link);
  assert([401, 503].includes(response?.status()), 'old local Service link remained available');
  return response.status();
}

const adminRecord = await new FileCredentialStore(adminConfig).load();
const ownerRecord = await new FileCredentialStore(ownerConfig).load();
assert(adminRecord?.token && ownerRecord?.token);
const administrator = new PiworkClient({ coreUrl: core, token: adminRecord.token });
const ownerClient = new PiworkClient({ coreUrl: core, token: ownerRecord.token });
assert.equal((await ownerClient.me()).role, 'user');
const ownerService = (await ownerClient.workServices(ownerWork)).services[0];
assert(ownerService?.serviceId);
const other = await administrator.adminCreateUser({ account: otherAccount, password: otherPassword, role: 'user' });
let otherWork, otherClient;
try {
  const login = await new PiworkClient({ coreUrl: core }).login(otherAccount, otherPassword);
  otherClient = new PiworkClient({ coreUrl: core, token: login.token });
  await new FileCredentialStore(otherConfig).save({ version: 1, coreUrl: core, ...login });
  assert.equal((await otherClient.me()).role, 'user');
  const created = await otherClient.createWork({ name: 'desktop-peer-work-' + process.pid, idempotencyKey: randomUUID() });
  otherWork = created.workId;
  await waitOperation(otherClient, created.operationId);
  otherCli(['chat', otherWork, '--message', 'deploy deterministic service']);
  const otherService = (await otherClient.workServices(otherWork)).services[0];
  assert(otherService?.serviceId);
  await extendServiceFixture(otherClient, otherWork, otherService.serviceId);
  prepareLargeFile(otherWork);
  const rcloneVersion = checked(rcloneBinary, ['version']).split('\n')[0];
  for (const executable of browsers) {
    const browser = await chromium.launch({ executablePath: executable, headless: true });
    const label = executable.includes('msedge') ? 'Edge' : 'Chrome';
    let owner, peer, popup, files;
    try {
      owner = await browseWork(browser, executable, ownerConfig, ownerWorkName);
      peer = await browseWork(browser, executable, otherConfig, 'desktop-peer-work-' + process.pid);
      assert.equal(await owner.page.getByRole('button', { name: 'desktop-peer-work-' + process.pid, exact: true }).count(), 0);
      assert.equal(await peer.page.getByRole('button', { name: ownerWorkName, exact: true }).count(), 0);
      assert.deepEqual(await deniedCrossAccess(owner.page, otherWork, otherService.serviceId),
        { work: 404, files: 404, service: 404 });
      assert.deepEqual(await deniedCrossAccess(peer.page, ownerWork, ownerService.serviceId),
        { work: 404, files: 404, service: 404 });
      await owner.page.getByRole('button', { name: ownerWorkName, exact: true }).click();
      await davAlternation(owner.page, ownerConfig, ownerWork);
      await peer.page.getByRole('button', { name: 'desktop-peer-work-' + process.pid, exact: true }).click();
      await peer.page.getByRole('button', { name: 'Files', exact: true }).click();
      await peer.page.getByRole('heading', { name: 'Workspace files' }).waitFor();
      assert.equal(await peer.page.getByRole('button', { name: 'File · ' + fileName }).count(), 0);
      popup = await serviceProbe(peer.page, otherWork, otherService.serviceId);
      files = await heldFiles(peer.page, peer.desktop.port, otherWork);
      const newPassword = 'desktop-peer-reset-' + randomUUID();
      await administrator.adminResetUserCredential(other.id, newPassword);
      otherPassword = newPassword;
      const revokedAt = now();
      await assertProbeClosed(popup, revokedAt, label + ' session revoke');
      await files.waitClosed(); files = undefined;
      assert.equal(await serviceUnavailable(popup), 401);
      await popup.close(); popup = undefined;
      await peer.page.getByRole('heading', { name: 'Sign in to Piwork' }).waitFor({ timeout: 10_000 });
      await peer.page.getByRole('textbox', { name: 'Account' }).fill(otherAccount);
      await peer.page.getByLabel('Password').fill(otherPassword);
      await peer.page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await peer.page.getByRole('heading', { name: 'Your Works' }).waitFor();
      const refreshed = await new FileCredentialStore(otherConfig).load();
      assert(refreshed?.token);
      otherClient = new PiworkClient({ coreUrl: core, token: refreshed.token });
      await peer.page.getByRole('button', { name: 'desktop-peer-work-' + process.pid, exact: true }).click();
      popup = await directServiceProbe(peer.page, otherWork, otherService.serviceId);
      files = await heldFiles(peer.page, peer.desktop.port, otherWork);
      const accepted = await otherClient.workAction(otherWork, 'stop', randomUUID());
      const stoppedAt = now();
      await assertProbeClosed(popup, stoppedAt, label + ' Work stop');
      await files.waitClosed(); files = undefined;
      const stopped = await waitOperation(otherClient, accepted.operationId, true);
      let stopRecovery = 'initial Stop succeeded';
      if (stopped.state === 'failed') {
        const work = await otherClient.work(otherWork);
        assert.equal(work.desiredState, 'stopped');
        assert.equal(work.observedState, 'failed');
        await waitUntil(() => fileJournal(otherWork).every((job) => job.state === 'cleaned'),
          'Files cleanup after failed Stop', 15_000);
        await peer.page.reload();
        try { await peer.page.getByRole('heading', { name: 'Stop was not confirmed' }).waitFor({ timeout: 5_000 }); }
        catch (error) {
          throw new Error('Desktop failed Stop state mismatch: ' + JSON.stringify({
            url: peer.page.url(), text: (await peer.page.locator('body').innerText()).slice(0, 1500),
            work: await otherClient.work(otherWork),
          }) + ' · ' + String(error));
        }
        assert.equal(await peer.page.getByRole('button', { name: 'Prepare .work package' }).count(), 0);
        await waitOperation(otherClient, (await otherClient.workAction(otherWork, 'stop', randomUUID())).operationId);
        stopRecovery = 'initial Stop failed safely; explicit second Stop succeeded';
      }
      assert.equal(await serviceUnavailable(popup), 503);
      await popup.close(); popup = undefined;
      await peer.page.reload();
      await peer.page.getByRole('heading', { name: 'Work is stopped' }).waitFor({ timeout: 15_000 });
      const start = await otherClient.workAction(otherWork, 'start', randomUUID());
      await waitOperation(otherClient, start.operationId);
      console.log(label + ': real Core two ordinary users isolated; ' + rcloneVersion
        + ' and browser Files alternated; async revoke and Work stop closed Service SSE/WS and Files GET/PUT; ' + stopRecovery);
    } finally {
      files?.close();
      await popup?.close().catch(() => undefined);
      if (owner) { await owner.context.close(); await stopCli(owner.desktop); }
      if (peer) { await peer.context.close(); await stopCli(peer.desktop); }
      await browser.close();
    }
  }
} finally {
  if (otherWork) {
    try {
      const fresh = await new PiworkClient({ coreUrl: core }).login(otherAccount, otherPassword);
      const cleanup = new PiworkClient({ coreUrl: core, token: fresh.token });
      await waitOperation(cleanup, (await cleanup.workAction(otherWork, 'delete', randomUUID())).operationId);
    } catch (error) { throw new Error('Peer Work cleanup failed: ' + String(error)); }
  }
  await rm(davConfig, { force: true });
  await rm(filePath, { force: true });
  await rm(returnedPath, { force: true });
  await rm(otherConfig, { force: true });
}
