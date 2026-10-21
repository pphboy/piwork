// Focused R2/R3 GUI acceptance against a real Core and Engine; synthetic data only.
import { operatorAPI } from '../../../scripts/native-test-core-api.mjs';
import { buildNativeTestServer } from '../../../scripts/native-test-server.mjs';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const output = resolve(process.env.PIWORK_LOG_EXPORT_EVIDENCE || 'dist/apply-add-log-export/gui');
await mkdir(output, { recursive: true });
const root = await mkdtemp(join(output, 'installation-'));
const dataDir = join(root, 'core');
const image = process.env.PIWORK_TEST_NATIVE_AGENT_IMAGE || 'piwork-agentd:go-migration-acceptance';
const fileImage = process.env.PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE || 'piwork-file-helper:go-migration-acceptance';
const snapshotImage = process.env.PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE || 'piwork-snapshot-helper:go-migration-acceptance';
const password = 'synthetic-log-export-admin-pass';
const freePort = async () => { const server = createServer(); await new Promise(done => server.listen(0, '127.0.0.1', done)); const port = server.address().port; await new Promise(done => server.close(done)); return port; };
async function waitFor(check, label, timeout = 120000) { const end = Date.now() + timeout; while (Date.now() < end) { const result = await check().catch(() => null); if (result) return result; await new Promise(done => setTimeout(done, 150)); } throw new Error(`Timed out: ${label}`); }
const docker = args => { const result = spawnSync('docker', args, { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
const unzip = (path, entry) => { const result = spawnSync('unzip', ['-p', path, entry], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout; };
const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex');
let core, browser, installationId;
try {
  const [corePort, uiPort] = await Promise.all([freePort(), freePort()]);
  const coreURL = `http://127.0.0.1:${corePort}`;
  const api = async (method, path, body, token = '') => {
    const response = await fetch(coreURL + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  };
  const fixtureCore = buildNativeTestServer(join(root, 'bin'), { agent: image, packageHelper: image, fileHelper: fileImage, snapshotHelper: snapshotImage });
  await writeFile(join(output, 'fixture-build.json'), await readFile(join(root, 'bin', 'fixture-build.json')));
  core = spawn(fixtureCore, ['--data-dir', dataDir, '--ui-port', String(uiPort), '--core-port', String(corePort)], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: '/nonexistent', DISPLAY: '', WAYLAND_DISPLAY: '' } });
  let coreOutput = ''; core.stdout.on('data', c => { coreOutput += c; }); core.stderr.on('data', c => { coreOutput += c; });
  await waitFor(async () => (await fetch(coreURL + '/healthz')).ok, 'Core health');
  installationId = JSON.parse(await readFile(join(dataDir, 'core-format.json'), 'utf8')).installationId;
  const control = await operatorAPI(coreURL, dataDir);
  await control('POST', 'admin/bootstrap', { account: 'admin', password });
  await control('PUT', 'runtime', { provider: 'piwork-deterministic', model: 'fixture-v1', credential: 'synthetic-model-key' });
  await waitFor(async () => (await fetch(coreURL + '/readyz')).ok, 'Core readiness');
  const login = await api('POST', '/api/v1/login', { account: 'admin', password });
  assert.equal(login.status, 200); const token = login.data.token;
  const created = await api('POST', '/api/v1/works', { name: 'Log export fault fixture', idempotencyKey: 'gui-fault-work' }, token);
  assert.equal(created.status, 202, JSON.stringify(created.data)); const workID = created.data.workId;
  await waitFor(async () => (await api('GET', `/api/v1/operations/${created.data.operationId}`, undefined, token)).data.state === 'succeeded', 'Work creation');
  const started = await api('POST', `/api/v1/works/${workID}/start`, { idempotencyKey: 'gui-start' }, token);
  assert.equal(started.status, 202);
  await waitFor(async () => (await api('GET', `/api/v1/works/${workID}`, undefined, token)).data.observedState === 'ready', 'Work ready', 180000);
  // The service genuinely fails initialization; explicit restart then archives
  // its stopped original instance before replacing it.
  const script = `for(let i=0;i<250;i++)console.log('FAULT-LINE-'+String(i).padStart(3,'0'));console.error('CONTROLLED_SERVICE_FAILURE');console.log('API_KEY=synthetic-service-secret');process.exit(17)`;
  const definition = { name: 'controlled-log-failure', image: { reference: image }, command: 'node', args: ['-e', script], workingDirectory: '/', environment: { API_KEY: 'synthetic-service-secret' }, ports: [{ name: 'web', protocol: 'tcp', containerPort: 8099 }], readiness: { kind: 'http', portName: 'web', path: '/', deadlineMs: 5000 } };
  const failed = await api('POST', `/api/v1/works/${workID}/services`, { definition, idempotencyKey: 'gui-failing-service' }, token);
  assert.equal(failed.status, 202, JSON.stringify(failed.data));
  await waitFor(async () => (await api('GET', `/api/v1/operations/${failed.data.operationId}`, undefined, token)).data.state === 'failed', 'controlled Service failure');
  const restarted = await api('POST', `/api/v1/works/${workID}/services/${failed.data.serviceId}/restart`, { idempotencyKey: 'gui-replace-failed-service' }, token);
  assert.equal(restarted.status, 202, JSON.stringify(restarted.data));
  await waitFor(async () => (await api('GET', `/api/v1/operations/${restarted.data.operationId}`, undefined, token)).data.state === 'failed', 'restart controlled failure');
  const sources = await readdir(join(dataDir, 'logs', 'works', workID));
  let sourceID;
  for (const name of sources) { const metadata = JSON.parse(await readFile(join(dataDir, 'logs', 'works', workID, name, 'metadata.json'), 'utf8').catch(() => '{}')); if (metadata.serviceId === failed.data.serviceId) { sourceID = name; break; } }
  assert.ok(sourceID, 'failed Service did not archive before removal');
  // Exercise the verified metadata-loss gap using only this dedicated fixture.
  await rm(join(dataDir, 'logs', 'works', workID, sourceID, 'metadata.json'));
  browser = await chromium.launch({ headless: true, executablePath: process.env.PIWORK_TEST_BROWSER_BIN || chromium.executablePath() });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage(); const requests = [], blocked = [], downloads = [];
  page.on('download', download => downloads.push({ path: new URL(download.url()).pathname, port: new URL(download.url()).port }));
  page.on('request', r => requests.push({ method: r.method(), path: new URL(r.url()).pathname }));
  await page.route('**/*', route => { if (Number(new URL(route.request().url()).port) === corePort) { blocked.push('direct Core request'); return route.abort(); } return route.continue(); });
  await page.goto(`http://127.0.0.1:${uiPort}/`);
  await page.getByRole('textbox', { name: 'Account', exact: true }).fill('admin');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Works', exact: true }).waitFor();
  await page.screenshot({ path: join(output, '01-fault-work.png'), fullPage: true });
  // Lose only the creation response; the real Core still completes the task.
  let originalID, originalKey, postCount = 0, failDetail = false;
  await page.route('**/_desktop/api/log-exports', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    postCount++; const key = route.request().postDataJSON().idempotencyKey;
    if (postCount === 1) { originalKey = key; const reply = await route.fetch(); assert.equal(reply.status(), 202); originalID = (await reply.json()).exportId; return route.abort('failed'); }
    assert.equal(key, originalKey, 'recovery changed the original key'); failDetail = true; return route.continue();
  });
  await page.route('**/_desktop/api/log-exports/log-export-*', async route => {
    if (route.request().method() === 'GET' && !route.request().url().endsWith('/content') && failDetail) { failDetail = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'LOG_EXPORT_STORAGE_UNAVAILABLE', message: 'Synthetic temporary detail failure' }) }); }
    return route.continue();
  });
  await page.locator('[data-action=account]').click();
  await expect(page.getByRole('menuitem', { name: 'Export logs', exact: true })).toHaveCount(1);
  await page.getByRole('menuitem', { name: 'Export logs', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry same key', exact: true })).toBeVisible();
  const task = await waitFor(async () => originalID && (await api('GET', `/api/v1/log-exports/${originalID}`, undefined, token)).data.state === 'ready' ? (await api('GET', `/api/v1/log-exports/${originalID}`, undefined, token)).data : null, 'original export ready');
  await page.getByRole('button', { name: 'Retry same key', exact: true }).click();
  await expect(page.locator('#modal')).toContainText('Synthetic temporary detail failure');
  await expect(page.getByRole('button', { name: 'Check status', exact: true })).toBeVisible();
  await page.screenshot({ path: join(output, '02-ready-detail-recovery.png'), fullPage: true });
  const downloading = page.waitForEvent('download', { timeout: 60000 });
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  const download = await downloading; const firstPath = join(output, 'fault-logs.zip'); await download.saveAs(firstPath);
  await expect(page.locator('#modal')).toContainText('gap(s) recorded');
  await page.screenshot({ path: join(output, '03-downloaded-with-gap.png'), fullPage: true });
  const manifest = JSON.parse(unzip(firstPath, 'manifest.json'));
  assert.equal(manifest.exportId, originalID); assert.equal(manifest.complete, false);
  const source = manifest.sources.find(s => s.sourceId === sourceID);
  assert.equal(source.state, 'partial');
  const stdout = unzip(firstPath, source.entries.find(e => e.endsWith('/stdout.log')));
  const stderr = unzip(firstPath, source.entries.find(e => e.endsWith('/stderr.log')));
  assert.match(stdout, /FAULT-LINE-000/); assert.match(stdout, /FAULT-LINE-249/);
  assert.doesNotMatch(stdout, /synthetic-service-secret/); assert.match(stdout, /\[redacted\]/);
  assert.match(stderr, /CONTROLLED_SERVICE_FAILURE/);
  assert.ok(Object.keys(manifest.core).length && manifest.core.files.length, 'Core logs missing');
  assert.equal(await sha256(firstPath), task.result.digest);
  const again = page.waitForEvent('download', { timeout: 60000 });
  await page.getByRole('button', { name: 'Download again', exact: true }).click();
  const secondPath = join(output, 'fault-logs-again.zip'); await (await again).saveAs(secondPath);
  assert.equal(await sha256(secondPath), task.result.digest); assert.equal(postCount, 2); assert.equal(blocked.length, 0);
  assert.equal(downloads.length, 2, 'unexpected extra automatic delivery');
  assert.ok(downloads.every(d => d.path === `/_desktop/api/log-exports/${originalID}/content` && Number(d.port) === uiPort), 'download bypassed same-origin UI');
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(output, 'requests.json'), JSON.stringify({ requests, downloads }, null, 2));
  const result = { result: 'passed', deployment: 'Linux binary + hosted Desktop', installationId, workID, exportID: originalID, digest: task.result.digest, complete: false, warningCount: task.warningCount, sameKeyReadyRecovery: true, detailRetry: true, downloads: 2, directCoreBrowserRequests: blocked.length, handoff: 'user downloads ZIP and manually sends it to maintainer', fault: 'real Service initialization exit 17; archive metadata removed in fixture', limits: ['independent Desktop and Core container deployment not rerun', 'no exhaustive fault matrix'] };
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  if (core && core.exitCode === null) { core.kill('SIGTERM'); await new Promise(done => { const timer = setTimeout(done, 45000); core.once('exit', () => { clearTimeout(timer); done(); }); }); if (core.exitCode === null) { core.kill('SIGKILL'); await new Promise(done => core.once('exit', done)); } }
  if (installationId) {
    assert.match(installationId, /^[A-Za-z0-9-]+$/);
    const filter = `label=piwork.installation_id=${installationId}`;
    for (const [list, inspect, remove] of [
      [['ps', '-aq', '--filter', filter], id => ['inspect', '--format', '{{index .Config.Labels "piwork.installation_id"}}', id], id => ['rm', '-f', id]],
      [['network', 'ls', '-q', '--filter', filter], id => ['network', 'inspect', '--format', '{{index .Labels "piwork.installation_id"}}', id], id => ['network', 'rm', id]],
      [['volume', 'ls', '-q', '--filter', filter], id => ['volume', 'inspect', '--format', '{{index .Labels "piwork.installation_id"}}', id], id => ['volume', 'rm', id]],
    ]) { for (const id of docker(list).split('\n').filter(Boolean)) { assert.equal(docker(inspect(id)), installationId); docker(remove(id)); } }
  }
  await rm(root, { recursive: true, force: true });
}
