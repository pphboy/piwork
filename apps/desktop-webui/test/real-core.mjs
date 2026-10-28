import {operatorAPI} from '../../../scripts/native-test-core-api.mjs';
import {buildNativeTestServer} from '../../../scripts/native-test-server.mjs';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
let coreBinary = resolve(process.env.PIWORK_TEST_NATIVE_CORE || join(repositoryRoot, 'dist/go/piwork-core'));
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
  const [corePort, uiPort, desktopPort] = await Promise.all([freePort(), freePort(), freePort()]);
  const coreUrl = `http://127.0.0.1:${corePort}`;
  if(!process.env.PIWORK_TEST_NATIVE_CORE)coreBinary=buildNativeTestServer(join(root,'bin'),{agent:image,packageHelper:image,fileHelper:fileImage,snapshotHelper:snapshotImage});
  core=spawn(coreBinary,['--data-dir',dataDir,'--ui-port',String(uiPort),'--core-port',String(corePort)],{stdio:['ignore','pipe','pipe'],env:{...process.env,PATH:'/nonexistent',DISPLAY:'',WAYLAND_DISPLAY:''}});
  coreOutput = capture(core);
  await waitFor(async () => (await fetch(`${coreUrl}/healthz`)).ok, 'Go Core health');
  const control=await operatorAPI(coreUrl,dataDir);
  await control('POST','admin/bootstrap',{account:'admin',password:'real-browser-admin-password'});
  await control('PUT','runtime',{provider:'piwork-deterministic',model:'fixture-v1',credential:'fixture-key'});
  await waitFor(async () => (await fetch(`${coreUrl}/readyz`)).ok, 'Go Core readiness');
  const login = await api(coreUrl, '', 'POST', '/api/v1/login',
    { account: 'admin', password: 'real-browser-admin-password' });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const token = login.data.token;
  assert.equal(typeof token, 'string');
  const skillForm = new FormData();
  skillForm.set('directoryName', 'workspace-review');
  skillForm.append('files', new Blob(['---\nname: workspace-review\ndescription: Review this Work using its supporting note\n---\nsupport: note.md\nRead the supporting note before replying.\n']), 'SKILL.md');
  skillForm.append('files', new Blob(['Workspace UX integration supporting note\n']), 'note.md');
  const skillUpload = await fetch(coreUrl + '/api/v1/admin/skills', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: skillForm });
  assert.equal(skillUpload.status, 201, await skillUpload.text());

  desktop = spawn(cliBinary, ['--core', coreUrl, 'desktop', '--port', String(desktopPort), '--no-open'],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: '/nonexistent',
      PIWORK_CONFIG_PATH: join(root, 'client.json') } });
  desktopOutput = capture(desktop);
  const launchUrl = await waitFor(() => desktopOutput().match(/http:\/\/desktop\.localhost:\d+\//)?.[0],
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
  await page.locator('.works-page').waitFor();
  await page.screenshot({ path: join(screenshotDir, '01-empty-work-list.png'), fullPage: true });
  const runChatControls=async()=>{const {chatControlsAcceptance}=await import('./chat-controls-real-core.mjs');await chatControlsAcceptance({page,coreUrl,token,api,waitFor,cliBinary,clientConfig:join(root,'client.json'),repositoryRoot,image,screenshotDir,fixtureRoot:root});};
  if(process.env.PIWORK_TEST_HISTORY==='only'){const {historyAcceptance}=await import('./history-real-core.mjs');await historyAcceptance({page,coreUrl,uiUrl:`http://127.0.0.1:${uiPort}`,token,api,waitFor,cliBinary,clientConfig:join(root,'client.json'),dataDir});}
  else if(process.env.PIWORK_TEST_CHAT_CONTROLS==='only')await runChatControls();
  else {
  const lifecycleRequests = [];
  page.on('request', request => { const path = new URL(request.url()).pathname; if (request.method() === 'POST' && (/\/_desktop\/api\/works(?:$|\/[^/]+\/(?:start|stop|retry|delete)$)/).test(path)) lifecycleRequests.push(path); });
  let mainReloads = 0; page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame() && !new URL(request.url()).pathname.startsWith('/_desktop/')) mainReloads++; });
  await page.getByRole('button', { name: 'New Work', exact: true }).first().click();
  await page.locator('#create-name').fill('Real Browser Work');
  await page.locator('[data-action=toggle-create-advanced]').click();
  await page.locator('#create-skill-mode').selectOption('choose');
  await page.getByLabel('workspace-review', { exact: true }).check();
  await page.getByRole('button', { name: 'Create Work', exact: true }).click();
  const work = await waitFor(async () => (await api(coreUrl, token, 'GET', '/api/v1/works')).data.works?.find(item => item.name === 'Real Browser Work'), 'created Work');
  const workId = work.id;
  const waitState = (id, state) => waitFor(async () => (await api(coreUrl, token, 'GET', `/api/v1/works/${id}`)).data.observedState === state, `Work ${state}`, 180_000);
  await expect(page.locator('#modal')).toContainText('Operation ID');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.locator('.work-row').filter({ hasText: 'Real Browser Work' })).toContainText('Ready', { timeout: 180000 });
  await waitState(workId, 'ready');
  await page.getByRole('button', { name: 'New Work', exact: true }).first().click();
  await page.locator('#create-name').fill('Real Browser Work');
  const nameConflictResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/_desktop/api/works' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create Work', exact: true }).click();
  const nameConflict = await nameConflictResponse;
  assert.equal(nameConflict.status(), 409);
  assert.equal((await nameConflict.json()).field, 'name');
  await expect(page.locator('#create-name-error')).toContainText('Choose a different name.');
  await expect(page.locator('#create-name')).toHaveValue('Real Browser Work');
  await page.screenshot({ path: join(screenshotDir, '00-create-name-conflict.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close dialog' }).click();
  assert.equal((await api(coreUrl, token, 'GET', '/api/v1/works')).data.works.length, 1);
  await page.getByRole('link', { name: /^Real Browser Work/ }).click();
  await expect(page.locator('.work-header')).toContainText('Real Browser Work');
  await expect(page.locator('.work-header')).toContainText('Ready');
  const localeURL = page.url();
  const lifecycleBeforeLocale = lifecycleRequests.length;
  await page.locator('.work-header [data-action="work-menu"]').click();
  await page.locator('#modal [data-action="language"]').click();
  await page.locator('.language-picker [data-locale="zh-CN"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('.work-header .status')).toContainText('就绪');
  await page.keyboard.press('Escape');
  await page.locator('.work-header [data-action="work-menu"]').click();
  await page.locator('#modal [data-action="language"]').click();
  await page.locator('.language-picker [data-locale="en"]').click();
  await expect(page.locator('.work-header .status')).toContainText('Ready');
  await page.keyboard.press('Escape');
  assert.equal(page.url(), localeURL);
  assert.equal(lifecycleRequests.length, lifecycleBeforeLocale);
  const script = "const http=require('node:http');http.createServer((req,res)=>{if(req.url==='/health'){res.end('ok');return;}res.setHeader('Content-Type','text/html');res.end('<h1>Real Service</h1><input aria-label=\"Service draft\"><button onclick=\"this.textContent=Number(this.textContent)+1\">0</button>');}).listen(8099,'0.0.0.0')";
  const definition = { name: 'browser-service', image: { reference: image }, command: 'node', args: ['-e', script], workingDirectory: '/var/data/workspace', mounts: [{ source: 'workspace', target: '/var/data/workspace', readOnly: false }], ports: [{ name: 'web', protocol: 'tcp', containerPort: 8099 }], readiness: { kind: 'http', portName: 'web', path: '/health', deadlineMs: 10000 } };
  const service = await api(coreUrl, token, 'POST', `/api/v1/works/${workId}/services`, { definition, idempotencyKey: 'browser-real-service' });
  assert.equal(service.status, 202, JSON.stringify(service.data));
  await waitFor(async () => (await api(coreUrl, token, 'GET', `/api/v1/operations/${service.data.operationId}`)).data.state === 'succeeded', 'Service operation', 180_000);
  await page.getByRole('button', { name: 'Services', exact: true }).click();
  await page.frameLocator('iframe').getByRole('heading', { name: 'Real Service' }).waitFor({ timeout: 20000 });
  await page.frameLocator('iframe').getByLabel('Service draft').fill('bilingual service draft');
  await page.locator('#composer').fill('bilingual chat draft');
  await page.locator('.work-header [data-action="work-menu"]').click();
  await page.locator('#modal [data-action="language"]').click();
  await page.locator('.language-picker [data-locale="zh-CN"]').click();
  await expect(page.frameLocator('iframe').getByLabel('Service draft')).toHaveValue('bilingual service draft');
  await expect(page.locator('#composer')).toHaveValue('bilingual chat draft');
  await expect(page.locator('.service-toolbar .status')).toContainText('就绪');
  await page.keyboard.press('Escape');
  await page.locator('.work-header [data-action="work-menu"]').click();
  await page.locator('#modal [data-action="language"]').click();
  await page.locator('.language-picker [data-locale="en"]').click();
  await page.keyboard.press('Escape');
  await page.frameLocator('iframe').getByLabel('Service draft').fill('');
  await page.locator('#composer').fill('');
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
  const commands = await api(coreUrl, token, 'GET', `/api/v1/works/${workId}/commands`);
  assert.equal(commands.status, 200, JSON.stringify(commands.data));
  assert(commands.data.commands.some(command => command.command === '/skill:workspace-review'));
  await page.locator('#composer').fill('/model');
  await page.locator('#composer').press('Escape');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Response settings', exact: true })).toBeVisible();
  // Model and Thinking share the current settings dialog. Keep validating the
  // actual default-model selection and preserved command below.
  if (await page.locator('#model-select').getAttribute('aria-expanded') !== 'true') await page.locator('#model-select').click();
  await expect(page.locator('#composer')).toHaveValue('/model');
  await page.locator('#modal [data-action=choose-chat-setting][data-option-value=""]').click();
  await expect(page.locator('#composer')).toHaveValue('');
  await page.locator('#modal').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('#modal')).toHaveCount(0);
  await page.locator('#composer').fill('/skill:workspace-review "preserved argument"');
  await page.locator('#composer').press('Escape');
  const runAcceptance = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/${workId}/runs`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const accepted = await runAcceptance;
  assert.equal(accepted.status(), 202, await accepted.text());
  assert.equal(accepted.request().postDataJSON().inputMode, 'command');
  assert.equal(accepted.request().postDataJSON().prompt, '/skill:workspace-review "preserved argument"');
  const acceptedRun = (await accepted.json()).run;
  await page.locator('.message-execution').filter({ has: page.locator(`[data-action=run-details][data-run-id="${acceptedRun.runId}"]`), hasText: /succeeded/ }).waitFor({ timeout: 90_000 });
  let originalSessionId = acceptedRun.sessionId;
  const options = await api(coreUrl, token, 'GET', `/api/v1/works/${workId}/sessions/${originalSessionId}/chat-options`);
  assert.equal(options.status, 200); assert.equal(options.data.thinkingLevel, 'off');
  const savedPair = await api(coreUrl, token, 'PATCH', `/api/v1/works/${workId}/sessions/${originalSessionId}/chat-options`, { modelRef: null, thinkingLevel: 'off' });
  assert.equal(savedPair.status, 200); assert.equal(savedPair.data.thinkingLevel, 'off');
  assert.match(await page.locator('#messages').innerText(), /skill-read:/);
  await expect(page.locator('.activity')).toHaveCount(1);
  await expect(page.locator('.activity > summary')).toContainText('2 tools');
  await page.locator('.activity > summary').click();
  const activityKey = await page.locator('.activity').getAttribute('data-activity-key');
  await page.locator('#composer').fill('Focus draft stays here');
  const configurationBeforeFocus = (await api(coreUrl, token, 'GET', `/api/v1/works/${workId}/configuration`)).data;
  const historyBeforeFocus = (await api(coreUrl, token, 'GET', `/api/v1/works/${workId}/sessions/${originalSessionId}`)).data;
  let focusMutations = 0;
  const countFocusMutation = request => { if (new URL(request.url()).pathname.startsWith('/_desktop/api/') && ['POST','PUT','PATCH','DELETE'].includes(request.method())) focusMutations++; };
  page.on('request', countFocusMutation);
  await page.evaluate(() => {
    window.uxFrame = document.querySelector('iframe'); window.uxComposer = document.querySelector('#composer');
    window.uxAncestors = []; for (let node = window.uxFrame; node; node = node.parentNode) window.uxAncestors.push(node);
    window.uxFrameLoads = 0; window.uxFrame.addEventListener('load', () => window.uxFrameLoads++);
  });
  await page.locator('[data-action=service-focus]').click();
  await page.locator('[data-action=focus-chat]:visible').click();
  await expect(page.locator('#app')).toHaveAttribute('data-layout','chat-only');
  await expect(page.getByRole('button',{name:'Restore layout',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Exit focus',exact:true})).toBeVisible();
  await page.screenshot({path:join(screenshotDir,'02-focused-chat.png'),fullPage:true});
  await page.locator('[data-action=restore-layout]:visible').click();
  await expect(page.locator('#app')).toHaveAttribute('data-layout','service-chat');
  await page.locator('[data-action=focus-toggle-chat]').click();
  await page.locator('[data-action=focus-toggle-chat]').click();
  await page.getByRole('button', { name: 'Service options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Browser full screen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.evaluate(() => document.exitFullscreen());
  await page.locator('[data-action=exit-service-focus]').click();
  await page.locator('[data-action=service-focus]').click();await page.locator('[data-action=focus-chat]:visible').click();
  await page.locator('[data-action=exit-service-focus]:visible').click();
  await expect(page.locator('#app')).toHaveAttribute('data-layout','workspace');
  page.off('request',countFocusMutation);assert.equal(focusMutations,0,'layout navigation wrote business state');
  assert(await page.evaluate(() => { let node = document.querySelector('iframe'); return window.uxAncestors.every(ancestor => {const same = ancestor === node; node = node?.parentNode; return same;}) && window.uxFrameLoads === 0; }),'Focus reloaded or moved an iframe ancestor');
  const configurationAfterFocus = (await api(coreUrl, token, 'GET', `/api/v1/works/${workId}/configuration`)).data;
  assert.deepEqual(configurationAfterFocus.desired,configurationBeforeFocus.desired);assert.deepEqual(configurationAfterFocus.active,configurationBeforeFocus.active);
  const historyAfterFocus = (await api(coreUrl, token, 'GET', `/api/v1/works/${workId}/sessions/${originalSessionId}`)).data;
  assert.deepEqual(historyAfterFocus.session,historyBeforeFocus.session);assert.deepEqual(historyAfterFocus.messages,historyBeforeFocus.messages);assert.deepEqual(historyAfterFocus.runs,historyBeforeFocus.runs);
  assert(await page.evaluate(() => window.uxFrame === document.querySelector('iframe') && window.uxComposer === document.querySelector('#composer')));
  assert.equal(await page.locator('#composer').inputValue(), 'Focus draft stays here');
  assert.equal(await page.locator('.activity').getAttribute('data-activity-key'), activityKey);
  assert.equal(await page.locator('.activity').evaluate(node => node.open), true);
  assert.equal(await frame.getByLabel('Service draft').inputValue(), 'do not lose this', 'chat rerender reloaded the Service iframe');
  await page.getByRole('button', { name: 'Service options', exact: true }).click();
  await page.keyboard.press('Escape');
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
  await page.getByRole('button', { name: 'Refresh file' }).click();
  await page.getByRole('button', { name: 'Back to files' }).click();
  await page.locator('#file-editor').waitFor({state:'hidden'});
  const binary = Buffer.from([0,1,2,128,255,42]);
  await page.getByRole('button', { name: 'More file actions', exact: true }).click();
  const uploadChooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Upload files', exact: true }).click();
  await (await uploadChooser).setFiles({ name: 'binary.dat', mimeType: 'application/octet-stream', buffer: binary });
  await page.getByRole('button', { name: /^binary.dat/ }).waitFor();
  const rawBinary = await fetch(`${coreUrl}/api/v1/works/${workId}/files/binary.dat`, { headers: { Authorization: `Bearer ${token}` } });
  assert.deepEqual(Buffer.from(await rawBinary.arrayBuffer()), binary);
  await page.getByRole('button', { name: 'More file actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New folder', exact: true }).click();
  await page.locator('#form-name').fill('folder');
  await page.getByRole('button', { name: 'Create folder', exact: true }).click();
  await page.getByRole('button', { name: /^folder/ }).waitFor();
  await page.screenshot({ path: join(screenshotDir, '03-files.png'), fullPage: true });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.configuration-compact').getByText('Configuration in use', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'AGENTS.md', exact: true }).click();
  await page.locator('#agents-editor').fill('# Real browser Work\nUse the shared workspace.\n');
  await page.getByRole('button', { name: 'Save changes', exact: true }).first().click();
  await page.locator('.configuration-state').getByText('Saved changes are not active yet.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await waitFor(async () => (await api(coreUrl, token, 'GET', `/api/v1/works/${workId}/configuration`)).data.pendingApply === false, 'configuration apply', 180_000);
  console.log('Real Desktop: configuration applied');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Back to Work', exact: true }).click();
  // Apply creates a different active context. Keep the earlier Session as history,
  // then explicitly create the Session whose current context will be exported and continued.
  const priorOptions = await api(coreUrl, token, 'GET', `/api/v1/works/${workId}/sessions/${originalSessionId}/chat-options`);
  assert.equal(priorOptions.data.availability, 'unavailable');
  await page.locator('#composer').fill('/new');await page.locator('#composer').press('Escape');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('#composer')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  const currentAcceptance = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/${workId}/runs`) && response.request().method() === 'POST');
  await page.locator('#composer').fill('/skill:workspace-review "current context"');await page.locator('#composer').press('Escape');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const currentResponse = await currentAcceptance;
  assert.equal(currentResponse.status(), 202, await currentResponse.text());
  const currentRun = (await currentResponse.json()).run;
  originalSessionId = currentRun.sessionId;
  await page.locator('.message-execution').filter({ has: page.locator(`[data-action=run-details][data-run-id="${currentRun.runId}"]`), hasText: /succeeded/ }).waitFor({ timeout: 90_000 });
  if (process.env.PIWORK_TEST_LOCAL_AUTH_RECOVERY === '1') {
    const localOrigin = new URL(launchUrl).origin;
    const readAdapter = (code) => page.evaluate(`(async () => { const { adapter } = await import('/desktop/browser/adapter.js'); ${code} })()`);
    const helper = (action) => spawnSync(cliBinary, ['desktop', action, '--port', String(desktopPort), ...(action === 'open' ? ['--no-open'] : [])], { encoding: 'utf8', cwd: '/tmp', env: { ...process.env, PATH: '/nonexistent', PIWORK_CONFIG_PATH: '/wrong/credential', PIWORK_CORE_URL: 'invalid-core' } });
    const reopen = () => { const result = helper('open'); assert.equal(result.status, 0, result.stderr); return result.stdout.trim().replace('Piwork Desktop: ', ''); };
    const loginAgain = async (target) => {
      await target.getByRole('heading', { name: 'Connect to your Core' }).waitFor();
      await target.getByLabel('Account', { exact: true }).fill('admin'); await target.getByLabel('Password').fill('real-browser-admin-password');
      await target.getByRole('button', { name: 'Sign in', exact: true }).click(); await target.locator('.works-page').waitFor(); await target.evaluate(async () => { const { adapter } = await import('/desktop/browser/adapter.js'); await adapter.checkConnection(); });
    };
    const runBefore = await readAdapter('return adapter.getWork("' + workId + '")?.run?.id');
    const identityBefore = JSON.parse(await readFile(join(root, 'client.json'), 'utf8'));
    const fileBefore = await readFileThroughCore(); const pid = desktop.pid;
    let bootstrapPosts = 0, resetPosts = 0, businessWrites = 0;
    page.on('request', request => { if (request.url().endsWith('/bootstrap')) bootstrapPosts++; if (request.url().endsWith('/browser-access/reset')) resetPosts++; if (request.method() !== 'GET' && /\/(?:runs|work-imports|start|stop|retry|delete)(?:$|\?)/.test(new URL(request.url()).pathname)) businessWrites++; });
    await page.goto(launchUrl); await page.locator('.works-page').waitFor(); assert.equal(bootstrapPosts, 0);
    await context.clearCookies(); await page.goto(localOrigin); await page.locator('.works-page').waitFor();
    await page.goto(reopen()); await page.locator('.works-page').waitFor(); assert.equal(desktop.pid, pid);
    const secondContext = await browser.newContext(); const second = await secondContext.newPage(); await second.goto(reopen()); await second.locator('.works-page').waitFor();
    assert.equal(reopen(), launchUrl);
    await page.locator('[data-action=account]').click();
    await expect(page.getByRole('menuitem', { name: 'Reset browser access', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await secondContext.clearCookies(); await second.reload(); await second.locator('.works-page').waitFor();
    assert.equal(bootstrapPosts, 0); assert.equal(resetPosts, 0);
    assert.equal(JSON.parse(await readFile(join(root, 'client.json'), 'utf8')).token, identityBefore.token);
    await page.goto(reopen()); await page.locator('.works-page').waitFor();
    await page.locator('[data-action=account]').click(); await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click(); await loginAgain(page);
    let result = helper('logout'); assert.equal(result.status, 0, result.stderr);
    await page.goto(reopen()); await loginAgain(page);
    const captured = JSON.parse(await readFile(join(root, 'client.json'), 'utf8'));
    assert([200,204].includes((await api(coreUrl, captured.token, 'POST', '/api/v1/logout')).status));
    await readAdapter('await adapter.checkSession().catch(error => { if (error.code !== \"CONNECTION_CHANGED\") throw error; })'); await loginAgain(page);
    await readAdapter('await adapter.checkConnection()');
    // Pause only this isolated Core process; Docker workloads continue running.
    core.kill('SIGSTOP');
    try { await readAdapter('await adapter.checkSession()'); assert.equal(await readAdapter('return adapter.state.sessionState'), 'ready'); assert.equal(await readAdapter('return adapter.state.scenario'), 'core-offline'); }
    finally { core.kill('SIGCONT'); }
    await readAdapter('await adapter.checkConnection()'); assert.equal(await readAdapter('return adapter.state.signedIn'), true);
    assert.equal(desktop.pid, pid); assert.equal((await api(coreUrl, token, 'GET', `/api/v1/works/${workId}`)).data.observedState, 'ready');
    assert.equal((await api(coreUrl, token, 'GET', `/api/v1/works/${workId}/services/${service.data.serviceId}`)).data.service?.observedState ?? (await api(coreUrl, token, 'GET', `/api/v1/works/${workId}/services`)).data.services?.[0]?.observedState, 'ready');
    assert.equal(await readFileThroughCore(), fileBefore); assert.equal(businessWrites, 0);
    await page.getByRole('link', { name: /^Real Browser Work/ }).click(); await page.frameLocator('iframe').getByRole('heading', { name: 'Real Service' }).waitFor();
    const savedRun = await api(coreUrl, token, 'GET', `/api/v1/works/${workId}/runs/${runBefore}`); assert.equal(savedRun.status, 200); assert.equal((savedRun.data.run ?? savedRun.data).runId, runBefore);
    await waitFor(async () => (await page.locator('#messages').innerText()).includes('skill-read:'), 'original accepted Run history after auth recovery');
    await secondContext.close();
    // The existing application window also resumes through the ordinary address.
    await app.goto(reopen()); await app.locator('.works-page').waitFor(); await app.getByRole('link', { name: /^Real Browser Work/ }).click();
    await page.screenshot({ path: join(screenshotDir, '06-auth-recovered.png'), fullPage: true });
    console.log(JSON.stringify({ result: 'ordinary session recovery: real Core login/reuse/reopen/logout/revocation/offline, original PID/Work/Service/files/Run retained, no business replay', browserVersion: browser.version(), bootstrapPosts, resetPosts, businessWrites }));
  }
  // Delivered files: Agent-generated link, current-path reread, image/PDF fallback,
  // standalone/hosted downloads and cross-account denial.
  const fileEndpoint = name => `${coreUrl}/api/v1/works/${workId}/files/${name.split('/').map(encodeURIComponent).join('/')}`;
  const coreFile = (name, init = {}) => fetch(fileEndpoint(name), { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', ...(init.headers ?? {}) } });
  const digestOf = bytes => createHash('sha256').update(bytes).digest('hex');
  const deliveryAcceptance = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/${workId}/runs`) && response.request().method() === 'POST');
  await page.locator('#composer').fill('deliver workspace file fixture');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const deliveryResponse = await deliveryAcceptance;
  assert.equal(deliveryResponse.status(), 202, await deliveryResponse.text());
  const deliveryRun = (await deliveryResponse.json()).run;
  await page.locator('.message-execution').filter({ has: page.locator(`[data-action=run-details][data-run-id="${deliveryRun.runId}"]`), hasText: /succeeded/ }).waitFor({ timeout: 90_000 });
  // The Agent created both files through real tools; verify the binary image link,
  // browser decode and the bytes downloaded from the same current file.
  const agentImageLink = page.locator('a.chat-file-link[data-path="/output/图片.png"]').last();
  await expect(agentImageLink).toBeVisible();
  await agentImageLink.click();
  await expect(page.locator('.file-image-preview img')).toBeVisible();
  await expect.poll(() => page.locator('.file-image-preview img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  const agentImageDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download file', exact: true }).click();
  const agentImageFile = join(root, 'agent-image.png');
  await (await agentImageDownload).saveAs(agentImageFile);
  const agentImageCore = Buffer.from(await (await coreFile('output/图片.png')).arrayBuffer());
  assert.equal(digestOf(await readFile(agentImageFile)), digestOf(agentImageCore));
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  const deliveredLink = page.locator('a.chat-file-link[data-path="/output/报告.txt"]').last();
  await expect(deliveredLink).toBeVisible();
  assert.match(await deliveredLink.getAttribute('href'), new RegExp(`^#/work/${workId}/files/`));
  await deliveredLink.click();
  await expect(page.locator('.file-target-toolbar')).toContainText('报告.txt');
  await expect(page.locator('#file-editor')).toHaveValue('交付文件\n');
  let mutation = await coreFile('output/报告.txt', { method: 'PUT', body: 'changed by another writer\n' });
  assert([200, 201, 204].includes(mutation.status), await mutation.text());
  await page.locator('.file-target-toolbar [data-action="refresh-files"]').click();
  await expect(page.locator('#file-editor')).toHaveValue('changed by another writer\n');
  mutation = await coreFile('output/报告.txt', { method: 'DELETE' });
  assert([200, 204, 207].includes(mutation.status), await mutation.text());
  await page.locator('.file-target-toolbar [data-action="refresh-files"]').click();
  await expect(page.locator('.main-panel')).toContainText('File not found');
  mutation = await coreFile('output/报告.txt', { method: 'PUT', headers: { 'If-None-Match': '*' }, body: '交付文件\n' });
  assert([200, 201, 204].includes(mutation.status), await mutation.text());
  await page.locator('[data-action="retry-file-preview"]').click();
  await expect(page.locator('#file-editor')).toHaveValue('交付文件\n');
  const png = await readFile(join(repositoryRoot, 'fixtures/chat-images/png.png'));
  for (const [name, body] of [['output/picture.png', png], ['output/document.pdf', Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n')]]) {
    const upload = await coreFile(name, { method: 'PUT', headers: { 'If-None-Match': '*' }, body });
    assert([200, 201, 204].includes(upload.status), await upload.text());
  }
  await page.locator('.file-target-toolbar [data-action="close-file"]').click();
  await page.locator('[data-action="open-file"][data-path="/output/picture.png"]').click();
  await expect(page.locator('.file-image-preview img')).toBeVisible();
  await expect.poll(() => page.locator('.file-image-preview img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.locator('.file-target-toolbar [data-action="close-file"]').click();
  await page.locator('[data-action="open-file"][data-path="/output/document.pdf"]').click();
  await expect(page.locator('.main-panel')).toContainText('PDF, GIF and archive files are not previewed');
  await page.locator('.file-target-toolbar [data-action="close-file"]').click();
  await page.locator('[data-action="open-file"][data-path="/output/报告.txt"]').click();
  const standaloneDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download saved version', exact: true }).click();
  const standaloneFile = join(root, 'standalone-file.txt');
  await (await standaloneDownload).saveAs(standaloneFile);
  const coreBytes = Buffer.from(await (await coreFile('output/报告.txt')).arrayBuffer());
  assert.equal(digestOf(await readFile(standaloneFile)), digestOf(coreBytes));
  // Hosted workbench served by Core's UI listener.
  const hostedContext = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  try {
    const hosted = await hostedContext.newPage();
    await hosted.goto(`http://127.0.0.1:${uiPort}/login`);
    await hosted.getByLabel('Account', { exact: true }).fill('admin');
    await hosted.getByLabel('Password').fill('real-browser-admin-password');
    await hosted.getByRole('button', { name: 'Sign in', exact: true }).click();
    await hosted.waitForURL(url => url.pathname !== '/login');
    await hosted.locator('.works-page').waitFor();
    await hosted.getByRole('link', { name: /^Real Browser Work/ }).click();
    await hosted.getByRole('button', { name: 'Files', exact: true }).click();
    await hosted.locator('[data-action="open-file"][data-path="/output"]').click();
    await hosted.locator('[data-action="open-file"][data-path="/output/报告.txt"]').click();
    const hostedDownload = hosted.waitForEvent('download');
    await hosted.getByRole('button', { name: 'Download saved version', exact: true }).click();
    const hostedFile = join(root, 'hosted-file.txt');
    await (await hostedDownload).saveAs(hostedFile);
    assert.equal(digestOf(await readFile(hostedFile)), digestOf(coreBytes));
  } finally { await hostedContext.close(); }
  const otherUser = await fetch(`${coreUrl}/api/v1/admin/users`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ account: 'file-other', password: 'file-other-password' }) });
  assert.equal(otherUser.status, 201, await otherUser.text());
  const otherLogin = await api(coreUrl, '', 'POST', '/api/v1/login', { account: 'file-other', password: 'file-other-password' });
  assert.equal(otherLogin.status, 200, JSON.stringify(otherLogin.data));
  const denied = await fetch(fileEndpoint('output/报告.txt'), { headers: { Authorization: `Bearer ${otherLogin.data.token}` } });
  assert([403, 404].includes(denied.status), `cross-account file access returned ${denied.status}`);
  console.log(JSON.stringify({ result: 'delivered file current content, Agent-generated image preview/download, PDF download, reread/delete/recreate, standalone+hosted download hashes and cross-account denial verified', deliveryRun: deliveryRun.runId, agentImageSha256: digestOf(agentImageCore), textSha256: digestOf(coreBytes) }));
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByRole('button', { name: 'Work options' }).click();
  await page.getByRole('menuitem', { name: 'Export Work', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop and export', exact: true })).toBeVisible();
  assert.equal(await page.locator('[data-action=prepare-export]').count(), 0);
  // This first cycle checks ordinary Stop/Start retention; do not authorize export yet.
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Work options' }).click();
  await page.getByRole('menuitem', { name: 'Stop Work', exact: true }).click();
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
  await expect(page.locator('.object-control-progress [data-action=operation]')).toBeVisible();
  await expect(page.locator('#modal')).toHaveCount(0);
  await expect(page.locator('.work-header')).toContainText('Ready', { timeout: 180000 });
  await page.getByRole('button', { name: 'Services', exact: true }).click();
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
  await page.getByRole('link', { name: /^Real Browser Work/ }).click();
  await expect(page.locator('.work-header')).toContainText('Real Browser Work');
  if (process.env.PIWORK_TEST_LOCAL_AUTH_RECOVERY !== '1') assert.equal(mainReloads, 0, 'lifecycle required a page reload');
  await page.getByRole('button', { name: 'Work options' }).click();
  await page.getByRole('menuitem', { name: 'Stop Work', exact: true }).click();
  await page.getByRole('button', { name: 'Stop Work', exact: true }).last().click();
  await expect(page.locator('#modal')).toContainText('Operation ID'); await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('heading', { name: 'This Work is stopped', exact: true })).toBeVisible({ timeout: 180000 });
  await page.getByRole('button', { name: 'Work options' }).click();
  console.log('Real Desktop: second Stop confirmed; exporting current content and downloading');
  const exportRequests = [];
  const exportDownloads = [];
  const recordExportDownload = download => exportDownloads.push(new URL(download.url()).pathname);
  const recordExportRequest = request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path === `/_desktop/api/works/${workId}/exports` ||
        request.method() === 'POST' && /^\/_desktop\/api\/work-snapshots\/[^/]+\/downloads$/.test(path)) exportRequests.push({ path, method: request.method() });
  };
  page.on('request', recordExportRequest);
  // Chromium's anchor-download request is absent from request/route events.
  // Count its actual download event and verify the saved bytes below.
  page.on('download', recordExportDownload);
  const exportResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/_desktop/api/works/${workId}/exports` && response.request().method() === 'POST', { timeout: 180_000 });
  const preparationResponse = page.waitForResponse(response => /^\/_desktop\/api\/work-snapshots\/[^/]+\/downloads$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST', { timeout: 180_000 });
  const downloadEvent = page.waitForEvent('download', { timeout: 180_000 });
  // Arm every observer before the single Export action, and keep fixture cleanup reachable on early timeout.
  void exportResponse.catch(() => undefined); void preparationResponse.catch(() => undefined); void downloadEvent.catch(() => undefined);
  await page.getByRole('menuitem', { name: 'Export Work', exact: true }).click();
  const acceptanceResponse = await exportResponse;
  assert.equal(acceptanceResponse.status(), 202, `Export acceptance: ${await acceptanceResponse.text()}`);
  const acceptance = await acceptanceResponse.json(); assert.equal(acceptance.workId, workId); assert.ok(acceptance.operationId); assert.ok(acceptance.snapshotId);
  const download = await downloadEvent; const exportedPath = join(root, 'browser-export.work'); await download.saveAs(exportedPath); assert.equal(await download.failure(), null);
  const exportedBytes = await readFile(exportedPath);
  assert.equal(exportedBytes.subarray(0,8).toString(), 'PIWORK1\n', 'export is not a real archive');
  const readyResponse = await preparationResponse; assert.equal(readyResponse.status(), 200);
  const ready = await readyResponse.json();
  assert.equal(ready.ready, true); assert.equal(ready.workId, workId); assert.equal(ready.snapshotId, acceptance.snapshotId);
  assert.equal(ready.size, exportedBytes.length); assert.equal(ready.digest, createHash('sha256').update(exportedBytes).digest('hex'));
  assert.equal(new URL(download.url()).pathname, `/_desktop/api/downloads/${ready.transferId}/content`);
  const snapshot = (await api(coreUrl, token, 'GET', `/api/v1/work-snapshots/${acceptance.snapshotId}`)).data;
  assert.equal(snapshot.workId, workId); assert.equal(snapshot.operationId, acceptance.operationId);
  assert.equal(snapshot.state, 'succeeded'); assert.equal(snapshot.size, ready.size); assert.equal(snapshot.digest, ready.digest);
  assert.deepEqual(exportRequests, [
    { method: 'POST', path: `/_desktop/api/works/${workId}/exports` },
    { method: 'POST', path: `/_desktop/api/work-snapshots/${acceptance.snapshotId}/downloads` },
  ]);
  assert.deepEqual(exportDownloads, [`/_desktop/api/downloads/${ready.transferId}/content`]);
  page.off('request', recordExportRequest);
  page.off('download', recordExportDownload);
  console.log(JSON.stringify({ result: 'single browser export/download verified', exportPosts: 1, preparationPosts: 1, downloads: exportDownloads.length, bytes: exportedBytes.length }));
  await expect(page.locator('#modal')).toContainText('Download started');
  await expect(page.getByRole('button', { name: 'Download again', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Close dialog' }).click({ noWaitAfter: true });
  await expect(page.locator('#modal')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to Works' }).click();
  await page.getByRole('button', { name: 'Import Work', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import Work', exact: true })).toBeVisible();
  await page.locator('#work-file-input').setInputFiles(exportedPath);
  await page.getByText('Package format and contents verified locally.', { exact: true }).waitFor({ timeout: 180_000 });
  await expect(page.locator('.inspection-summary')).toContainText('Real Browser Work');
  await page.locator('#import-name').fill('Real Browser Work');
  const explicitConflictResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/_desktop/api/work-imports' && response.request().method() === 'POST', { timeout: 180_000 });
  await page.getByRole('button', { name: 'Import Work', exact: true }).last().click();
  const explicitConflict = await explicitConflictResponse;
  assert.equal(explicitConflict.status(), 409, await explicitConflict.text());
  assert.equal((await explicitConflict.json()).field, 'name');
  await expect(page.locator('#import-name-error')).toContainText('let Core choose one');
  await expect(page.locator('#import-name')).toHaveValue('Real Browser Work');
  await page.screenshot({ path: join(screenshotDir, '02-import-name-conflict.png'), fullPage: true });
  await expect(page.locator('.inspection-summary')).toBeVisible();
  await page.locator('#import-name').fill('');
  const importResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/_desktop/api/work-imports' && response.request().method() === 'POST', { timeout: 180_000 });
  await page.getByRole('button', { name: 'Import Work', exact: true }).last().click();
  const importAcceptance = await importResponse;
  assert.equal(importAcceptance.status(), 202, `Import acceptance: ${await importAcceptance.text()}`);
  assert.equal((await importAcceptance.json()).name, 'Real Browser Work-2');
  await expect(page.locator('.import-name-feedback')).toContainText('Real Browser Work-2');
  await expect(page.locator('.import-name-feedback')).toContainText('because the source name was unavailable');
  await page.screenshot({ path: join(screenshotDir, '03-import-automatic-name.png'), fullPage: true });
  const imported = await waitFor(async () => (await api(coreUrl, token, 'GET', '/api/v1/works')).data.works?.find(item => item.name === 'Real Browser Work-2'), 'imported Work', 180_000);
  assert.notEqual(imported.id, workId); assert.equal(imported.observedState, 'stopped');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.locator('.work-row').filter({ hasText: 'Real Browser Work-2' })).toContainText('Stopped', { timeout: 180000 });
  await page.getByRole('link', { name: /^Real Browser Work-2/ }).click();
  await page.getByRole('heading', { name: 'Real Browser Work-2', exact: true }).waitFor();
  const start = page.getByRole('button', { name: 'Start Work', exact: true }).first();
  assert.equal(await start.getAttribute('data-id'), imported.id, 'Start must target the opened Work');
  await start.click();
  await expect(page.locator('.object-control-progress [data-action=operation]')).toBeVisible();
  await expect(page.locator('#modal')).toHaveCount(0);
  await expect(page.locator('.work-header')).toContainText('Ready', { timeout: 180000 });
  await waitState(imported.id, 'ready');
  await page.getByRole('button', { name: 'Services', exact: true }).click();
  await page.frameLocator('iframe').getByRole('heading', { name: 'Real Service' }).waitFor();
  await waitFor(async () => (await page.locator('#messages').innerText()).includes('skill-read:'), 'restored session history');
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  await page.locator(`[data-action=select-session][data-id="${originalSessionId}"]`).click();
  const importedLink = page.locator('a.chat-file-link[data-path="/output/报告.txt"]').last();
  await expect(importedLink).toBeVisible();
  await importedLink.click();
  await expect(page.locator('.file-target-toolbar')).toContainText('报告.txt');
  await expect(page.locator('#file-editor')).toHaveValue('交付文件\n');
  await page.locator('.file-target-toolbar [data-action="close-file"]').click();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  const importedOptions = await api(coreUrl, token, 'GET', `/api/v1/works/${imported.id}/sessions/${originalSessionId}/chat-options`);
  assert.equal(importedOptions.status, 200, JSON.stringify(importedOptions.data));
  assert.equal(importedOptions.data.thinkingLevel, 'off');
  assert.equal(importedOptions.data.availability, 'available', JSON.stringify(importedOptions.data));
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  await page.locator(`[data-action=select-session][data-id="${originalSessionId}"]`).click();
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await page.locator('#composer').fill('/skill:workspace-review "after import"');
  await page.locator('#composer').press('Escape');
  const continuedAcceptance = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/${imported.id}/runs`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const continuedResponse = await continuedAcceptance;
  assert.equal(continuedResponse.status(), 202, await continuedResponse.text());
  const continuedRun = (await continuedResponse.json()).run;
  await page.locator('.message-execution').filter({ has: page.locator(`[data-action=run-details][data-run-id="${continuedRun.runId}"]`), hasText: /succeeded/ }).waitFor({ timeout: 90_000 });
  await expect(page.locator('.activity')).toHaveCount(3); // original Skill run + delivered-file run + continued run
  console.log(JSON.stringify({ result: 'workspace UX: active Skill directory, complete settings pair, command parameters, ordered tool history, stable Focus/fullscreen, exported/imported Thinking and continued original Session', browserVersion: browser.version(), originalSessionId }));
  await page.screenshot({ path: join(screenshotDir, '04-restored-work.png'), fullPage: true });
  for (const width of [1440,1024,390]) { await page.setViewportSize({ width, height: 900 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `horizontal overflow at ${width}px`); await page.screenshot({ path: join(screenshotDir, `05-responsive-${width}.png`), fullPage: true }); }
  await page.getByRole('button', { name: 'Work options' }).click(); await page.getByRole('menuitem', { name: 'Delete Work', exact: true }).click(); await page.locator('#delete-confirm').check(); await page.getByRole('button', { name: 'Delete Work', exact: true }).last().click();
  await expect(page.locator('#modal')).toContainText('Operation ID');
  const deleteId = await page.locator('#modal dd code').first().innerText();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.locator('.work-row').filter({ hasText: 'Real Browser Work-2' })).toHaveCount(0, { timeout: 180000 });
  await page.screenshot({ path: join(screenshotDir, '09-disposable-work-deleted.png'), fullPage: true });
  await waitFor(async () => (await api(coreUrl, token, 'GET', `/api/v1/operations/${deleteId}`)).data.state === 'succeeded', 'original Delete ID', 180000);
  assert.equal((await api(coreUrl, token, 'GET', `/api/v1/works/${imported.id}`)).status, 404);
  assert.equal(lifecycleRequests.filter(path => path === '/_desktop/api/works').length, 2, 'one accepted creation and one explicit name-conflict attempt');
  assert.equal(lifecycleRequests.filter(path => path.endsWith(`/${workId}/stop`)).length, 2);
  assert.equal(lifecycleRequests.filter(path => path.endsWith(`/${workId}/start`)).length, 1);
  assert.equal(lifecycleRequests.filter(path => path.endsWith(`/${imported.id}/start`)).length, 1);
  assert.equal(lifecycleRequests.filter(path => path.endsWith(`/${imported.id}/delete`)).length, 1);
  if (process.env.PIWORK_TEST_LOCAL_AUTH_RECOVERY !== '1') assert.equal(mainReloads, 0, 'lifecycle required reloading the WebUI document');
  console.log(JSON.stringify({ result: 'lifecycle confirmed: enabled/disabled Service, sentinel bytes, stopped resources, Delete original ID', browserVersion: browser.version(), mainReloads, lifecycleRequests, installationId, sentinelBytes: sentinel.length, enabledService: restored.find(item => item.serviceId === service.data.serviceId)?.observedState, disabledService: restored.find(item => item.serviceId === disabled.data.serviceId)?.observedState, stoppedRunningResources: 0, stoppedFileRead: stoppedFiles.status, stoppedFileWrite: stoppedWrite.status }));
  if(process.env.PIWORK_TEST_CHAT_CONTROLS==='1')await runChatControls();

  // Source Core offline: import the exported package into a second isolated Core,
  // start it, and open the delivered link from the restored history. The link has
  // no source address and resolves only against the receiving Work.
  const [corePortB, uiPortB] = await Promise.all([freePort(), freePort()]);
  const coreBUrl = `http://127.0.0.1:${corePortB}`, dataDirB = join(root, 'core-b');
  let coreB;
  try {
    await stop(desktop); await stop(core);
    console.log('Real Desktop: source Core stopped; importing into a second Core');
    coreB = spawn(coreBinary, ['--data-dir', dataDirB, '--ui-port', String(uiPortB), '--core-port', String(corePortB)], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: '/nonexistent', DISPLAY: '', WAYLAND_DISPLAY: '' } });
    await waitFor(async () => (await fetch(`${coreBUrl}/healthz`)).ok, 'second Core health', 90_000);
    const controlB = await operatorAPI(coreBUrl, dataDirB);
    await controlB('POST', 'admin/bootstrap', { account: 'admin', password: 'real-browser-admin-password' });
    await controlB('PUT', 'runtime', { provider: 'piwork-deterministic', model: 'fixture-v1', credential: 'fixture-key' });
    await waitFor(async () => (await fetch(`${coreBUrl}/readyz`)).ok, 'second Core readiness', 180_000);
    const tokenB = (await api(coreBUrl, '', 'POST', '/api/v1/login', { account: 'admin', password: 'real-browser-admin-password' })).data.token;
    assert.equal(typeof tokenB, 'string');
    const packageBytes = await readFile(exportedPath);
    const uploadedB = await fetch(`${coreBUrl}/api/v1/work-packages`, { method: 'POST', headers: { Authorization: `Bearer ${tokenB}`,
      'Content-Type': 'application/vnd.piwork.work-package', 'X-Piwork-SHA256': createHash('sha256').update(packageBytes).digest('hex') }, body: packageBytes });
    const uploadedBText = await uploadedB.text();
    assert.equal(uploadedB.status, 201, uploadedBText);
    const packageB = JSON.parse(uploadedBText);
    const importB = await fetch(`${coreBUrl}/api/v1/work-imports`, { method: 'POST', headers: { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId: packageB.packageId, idempotencyKey: 'source-offline-import' }) });
    const importBText = await importB.text();
    assert.equal(importB.status, 202, importBText);
    const importedB = JSON.parse(importBText);
    await waitFor(async () => (await api(coreBUrl, tokenB, 'GET', `/api/v1/operations/${importedB.operationId}`)).data.state === 'succeeded', 'second Core import', 180_000);
    assert.equal((await api(coreBUrl, tokenB, 'GET', `/api/v1/works/${importedB.workId}`)).data.observedState, 'stopped');
    const startB = await fetch(`${coreBUrl}/api/v1/works/${importedB.workId}/start`, { method: 'POST', headers: { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: 'source-offline-start' }) });
    const startBText = await startB.text();
    assert.equal(startB.status, 202, startBText);
    const startBReceipt = JSON.parse(startBText);
    await waitFor(async () => (await api(coreBUrl, tokenB, 'GET', `/api/v1/operations/${startBReceipt.operationId}`)).data.state === 'succeeded', 'second Core start', 180_000);
    await waitFor(async () => (await api(coreBUrl, tokenB, 'GET', `/api/v1/works/${importedB.workId}`)).data.observedState === 'ready', 'second Core Work ready', 180_000);
    const contextB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const pageB = await contextB.newPage();
      await pageB.goto(`http://127.0.0.1:${uiPortB}/login`);
      await pageB.getByLabel('Account', { exact: true }).fill('admin');
      await pageB.getByLabel('Password').fill('real-browser-admin-password');
      await pageB.getByRole('button', { name: 'Sign in', exact: true }).click();
      await pageB.waitForURL(url => url.pathname !== '/login');
      await pageB.locator('.works-page').waitFor();
      await pageB.getByRole('link', { name: /^Real Browser Work/ }).click();
      await pageB.getByRole('button', { name: 'Chat', exact: true }).click();
      await pageB.getByRole('button', { name: 'Sessions', exact: true }).click();
      await pageB.locator(`[data-action=select-session][data-id="${originalSessionId}"]`).click();
      const importedLinkB = pageB.locator('a.chat-file-link[data-path="/output/报告.txt"]').last();
      await expect(importedLinkB).toBeVisible();
      const hrefB = await importedLinkB.getAttribute('href');
      assert.match(hrefB, new RegExp(`^#/work/${importedB.workId}/files/`));
      assert.doesNotMatch(hrefB, /^https?:|127\.0\.0\.1|localhost/, 'file link must not carry a source Core address');
      await importedLinkB.click();
      await expect(pageB.locator('.file-target-toolbar')).toContainText('报告.txt');
      await expect(pageB.locator('#file-editor')).toHaveValue('交付文件\n');
    } finally { await contextB.close(); }
    console.log(JSON.stringify({ result: 'source Core offline import: history link resolved in the receiving Work', sourceCoreStopped: true, importedWork: importedB.workId, session: originalSessionId }));
  } finally {
    await stop(coreB);
    await cleanupInstallation(dataDirB);
  }
  console.log(JSON.stringify({ result: 'real Go Core/CLI: lifecycle, Service iframe preservation/tab, Run, binary WebDAV, uncertain write, Save/Apply, Stop/Export/Inspect/Import/Start and responsive layout', workId, screenshots: screenshotDir }));
  }
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
