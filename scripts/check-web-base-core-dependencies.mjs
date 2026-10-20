import {buildNativeTestServer} from './native-test-server.mjs';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { pythonDependencyRegistryProgram } from './python-dependency-fixture.mjs';

export async function runCoreDependencyChecks() {
  const root = resolve(import.meta.dirname, '..');
  const cliBinary = join(root, 'dist/go/piwork-cli');
  const agent = process.env.PIWORK_TEST_NATIVE_AGENT_IMAGE || 'piwork-agentd:go-migration-acceptance';
  const file = process.env.PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE || 'piwork-file-helper:go-migration-acceptance';
  const snapshot = process.env.PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE || 'piwork-snapshot-helper:go-migration-acceptance';
  await mkdir(join(root, 'dist/web-base'), { recursive: true });
  const temporary = await mkdtemp(join(root, 'dist/web-base/core-check-'));
  const data = join(temporary, 'core');
  const coreBinary = buildNativeTestServer(join(temporary,'bin'),{agent,packageHelper:agent,fileHelper:file,snapshotHelper:snapshot});
  const docker = args => {
    const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 8 << 20 });
    assert.equal(result.status, 0, `Docker ${args[0]} failed: ${result.stderr}`);
    return result.stdout.trim();
  };
  async function port() {
    const server = createServer(); await new Promise(done => server.listen(0, '127.0.0.1', done));
    const value = server.address().port; await new Promise(done => server.close(done)); return value;
  }
  async function wait(check, name, milliseconds = 180000) {
    const deadline = Date.now() + milliseconds; let last;
    while (Date.now() < deadline) {
      try { const value = await check(); if (value) return value; } catch (error) { last = error; }
      await new Promise(done => setTimeout(done, 250));
    }
    throw new Error(`${name} did not finish: ${last || 'no confirmed result'}`);
  }
  function output(child) {
    let text = ''; child.stdout.on('data', chunk => { text += chunk; }); child.stderr.on('data', chunk => { text += chunk; });
    return () => text.slice(-8000);
  }
  async function stop(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([new Promise(done => child.once('exit', done)), new Promise(done => setTimeout(done, 20000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  let core, desktop, browser, token, coreUrl, work, session;
  let coreOutput = () => '', desktopOutput = () => '';
  let submission = 0;
  const results = [];
  const testSessions = new Set();
  const documentResponses = [];
  async function api(method, path, body) {
    const response = await fetch(coreUrl + '/api/v1' + path, { method, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json();
    assert(response.ok, `${method} ${path}: ${value.error?.code || value.code || response.status}`);
    return value;
  }
  async function chat(prompt) {
    if (!session) session = (await api('POST', `/works/${work}/sessions`, { idempotencyKey: 'web-base-validation' })).sessionId;
    testSessions.add(session);
    const accepted = await api('POST', `/works/${work}/runs`, { sessionId: session, submissionKey: 'web-base-' + (++submission), prompt });
    const run = await wait(async () => {
      const current = await api('GET', `/works/${work}/runs/${accepted.run.runId}`);
      return current.state >= 4 ? current : false;
    }, prompt, 300000);
    assert.equal(run.state, 4, `${prompt}: Run failed`);
    results.push({ prompt, runId: run.runId, finalText: run.finalText });
    console.log('Core check SDK completed:', prompt);
    return run;
  }
  try {
    const [httpPort, grpcPort, desktopPort] = await Promise.all([port(), port(), port()]);
    coreUrl = `http://127.0.0.1:${httpPort}`;
    core = spawn(coreBinary, ['serve', '--data-dir', data, '--listen', `127.0.0.1:${httpPort}`, '--agent-grpc-listen', `0.0.0.0:${grpcPort}`],
      { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: '/nonexistent' } });
    coreOutput = output(core);
    await wait(async () => (await fetch(coreUrl + '/healthz')).ok, 'Core health');
    const operator = (args, input) => {
      const result = spawnSync(coreBinary, ['--core', coreUrl, '--data-dir', data, ...args], { input, encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent' } });
      assert.equal(result.status, 0, `Operator ${args[0]} failed: ${result.stderr}`);
    };
    operator(['admin', 'bootstrap', '--account', 'admin', '--password-stdin'], 'web-base-synthetic-password\n');
    operator(['config', 'set', '--model-provider', 'piwork-deterministic', '--model', 'fixture-v1', '--api-key-stdin'], 'synthetic-fixture-key\n');
    await wait(async () => (await fetch(coreUrl + '/readyz')).ok, 'Core readiness');
    token = (await api('POST', '/login', { account: 'admin', password: 'web-base-synthetic-password' })).token;
    const created = await api('POST', '/works', { name: 'NiceGUI dependency validation', idempotencyKey: 'web-base-validation' });
    work = created.workId;
    await wait(async () => (await api('GET', `/operations/${created.operationId}`)).state === 'succeeded', 'Work creation');
    assert.match((await chat('deploy deterministic workstation')).finalText, /workstation-deployed:/);

    desktop = spawn(cliBinary, ['--core', coreUrl, 'desktop', '--port', String(desktopPort), '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: '/nonexistent', PIWORK_CONFIG_PATH: join(temporary, 'client.json') } });
    desktopOutput = output(desktop);
    const launch = await wait(() => desktopOutput().match(/http:\/\/desktop\.localhost:\d+\//)?.[0], 'Desktop entry', 15000);
    browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--proxy-server=direct://', '--proxy-bypass-list=*'] });
    const page = await browser.newPage();
    page.on('response', response => {
      if (response.request().isNavigationRequest()) documentResponses.push({ status: response.status(), path: new URL(response.url()).pathname });
    });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(launch);
    await page.getByRole('textbox', { name: 'Account', exact: true }).fill('admin');
    await page.getByLabel('Password').fill('web-base-synthetic-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'Works', exact: true }).waitFor();
    await page.getByRole('button', { name: /^NiceGUI dependency validation/ }).click();
    await page.getByRole('button', { name: 'Services', exact: true }).click();
    const frame = page.frameLocator('iframe.real-service-frame');
    await frame.getByRole('heading', { name: 'Personal workstation', exact: true }).waitFor();
    const candidate = JSON.parse(await readFile(join(root, 'dist/web-base/candidate.json')));
    const services = (await api('GET', `/works/${work}/services`)).services;
    const application = services.find(item => item.name === 'workstation');
    assert(application);
    await frame.getByLabel('Todo title', { exact: true }).fill('Dependency source Todo');
    await frame.getByRole('button', { name: 'Add Todo', exact: true }).click();
    await expect(frame.getByText('Dependency source Todo', { exact: true })).toBeVisible();
    await frame.getByLabel('Todo title', { exact: true }).fill('kept before dependency update');
    const registryReceipt = await api('POST', `/works/${work}/services`, { idempotencyKey: 'python-registry-fixture', definition: {
      name: 'python-registry', image: { reference: candidate.reference }, command: 'python', args: ['-c', pythonDependencyRegistryProgram], workingDirectory: '/var/data/workspace', cpuMillis: 100,
      mounts: [{ source: 'workspace', target: '/var/data/workspace', readOnly: false }], ports: [{ name: 'web', protocol: 'tcp', containerPort: 8095 }], readiness: { kind: 'http', portName: 'web', path: '/health' },
    } });
    await wait(async () => (await api('GET', `/operations/${registryReceipt.operationId}`)).state === 'succeeded', 'controlled Python registry');
    assert.match((await chat('install deterministic workstation Python dependency sdk-extra')).finalText, /^workstation-python-dependency-verified:[a-f0-9]{64}$/);
    await expect(frame.getByRole('heading', { name: 'Personal workstation', exact: true })).toBeVisible({ timeout: 90000 });
    await expect(frame.getByLabel('Todo title', { exact: true })).toHaveValue('kept before dependency update');
    const dependency = await frame.getByRole('heading', { name: 'Personal workstation', exact: true }).evaluate(async () => (await fetch('/ui/queries/dependency_environment')).json());
    assert.equal(dependency.value.version, '1.0.0'); assert.match(dependency.value.pythonPrefix, /\/\.deps\//); assert(dependency.checks.every(item => item.passed));
    const registryStop = await api('POST', `/works/${work}/services/${registryReceipt.serviceId}/stop`, { idempotencyKey: 'registry-unavailable' });
    await wait(async () => (await api('GET', `/operations/${registryStop.operationId}`)).state === 'succeeded', 'registry disabled');
    const offlineRestart = await api('POST', `/works/${work}/services/${application.serviceId}/restart`, { idempotencyKey: 'python-offline-restart' });
    await wait(async () => (await api('GET', `/operations/${offlineRestart.operationId}`)).state === 'succeeded', 'offline Python dependency restart');
    await expect(frame.getByRole('heading', { name: 'Personal workstation', exact: true })).toBeVisible({ timeout: 90000 });
    assert.equal((await frame.getByRole('heading', { name: 'Personal workstation', exact: true }).evaluate(async () => (await fetch('/ui/queries/dependency_environment')).json())).value.version, '1.0.0');

    async function readSource(path) {
      const response = await fetch(`${coreUrl}/api/v1/works/${work}/files/${path}`, { headers: { Authorization: `Bearer ${token}` } });
      assert(response.ok); return response.text();
    }
    async function writeSource(path, body) {
      const response = await fetch(`${coreUrl}/api/v1/works/${work}/files/${path}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body });
      assert(response.ok, 'Source update was rejected');
    }
    const uiPath = 'apps/workstation/ui.py', uiSource = await readSource(uiPath);
    await frame.getByRole('heading', { name: 'Personal workstation', exact: true }).evaluate(() => {
      window.piworkOriginalStorage = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) { if (key.startsWith('piwork:web:')) throw new Error('synthetic draft storage failure'); return window.piworkOriginalStorage.call(this, key, value); };
    });
    await frame.getByLabel('Todo title', { exact: true }).fill('latest unsaved draft');
    await writeSource(uiPath, uiSource.replace('Personal workstation', 'Storage-safe workstation'));
    const draftRestart = await api('POST', `/works/${work}/services/${application.serviceId}/restart`, { idempotencyKey: 'draft-preparation-failure' });
    await wait(async () => (await api('GET', `/operations/${draftRestart.operationId}`)).state === 'succeeded', 'new version with unavailable draft storage');
    await expect(frame.locator('[data-piwork-status]')).toContainText('keeping your unfinished input', { timeout: 15000 });
    await expect(frame.getByLabel('Todo title', { exact: true })).toHaveValue('latest unsaved draft');
    await expect(frame.getByRole('heading', { name: 'Personal workstation', exact: true })).toBeVisible();
    await frame.getByRole('heading', { name: 'Personal workstation', exact: true }).evaluate(() => { Storage.prototype.setItem = window.piworkOriginalStorage; });
    await expect(frame.getByRole('heading', { name: 'Storage-safe workstation', exact: true })).toBeVisible({ timeout: 90000 });
    await expect(frame.getByLabel('Todo title', { exact: true })).toHaveValue('latest unsaved draft');
    console.log('Core dependency check: SDK installation, offline restart and failed draft preparation verified.');
    const histories = await Promise.all([...testSessions].map(id => api('GET', `/works/${work}/sessions/${id}`)));
    assert.equal(histories.reduce((count, history) => count + history.runs.length, 0), submission);
    assert.equal((await api('GET', `/works/${work}/configuration`)).pendingApply, false);

    const sourceWork = work;
    const sourceStop = await api('POST', `/works/${sourceWork}/stop`, { idempotencyKey: 'python-extra-share-stop' });
    await wait(async () => (await api('GET', `/operations/${sourceStop.operationId}`)).state === 'succeeded', 'extra dependency source stopped');
    const exported = await api('POST', `/works/${sourceWork}/exports`, { idempotencyKey: 'python-extra-offline-export' });
    await wait(async () => (await api('GET', `/operations/${exported.operationId}`)).state === 'succeeded', 'extra dependency export', 300000);
    const snapshotResponse = await fetch(coreUrl + `/api/v1/work-snapshots/${exported.snapshotId}/content`, { headers: { Authorization: `Bearer ${token}` } });
    assert(snapshotResponse.ok);
    const snapshotPath = join(temporary, 'extra-dependency.work');
    const snapshotHash = createHash('sha256'); let snapshotBytes = 0;
    await pipeline(Readable.fromWeb(snapshotResponse.body), new Transform({ transform(chunk, _encoding, callback) { snapshotHash.update(chunk); snapshotBytes += chunk.length; callback(null, chunk); } }), createWriteStream(snapshotPath));
    const upload = await fetch(coreUrl + '/api/v1/work-packages', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/vnd.piwork.work-package', 'Content-Length': String(snapshotBytes), 'X-Piwork-SHA256': snapshotHash.digest('hex') }, body: createReadStream(snapshotPath), duplex: 'half' });
    assert(upload.ok, 'Extra dependency snapshot upload failed');
    const uploaded = await upload.json();
    const imported = await api('POST', '/work-imports', { packageId: uploaded.packageId, name: 'Imported offline Python dependency', idempotencyKey: 'python-extra-offline-import' });
    await wait(async () => (await api('GET', `/operations/${imported.operationId}`)).state === 'succeeded', 'extra dependency import', 300000);
    assert.equal((await api('GET', `/works/${imported.workId}`)).desiredState, 'stopped');
    const importedStart = await api('POST', `/works/${imported.workId}/start`, { idempotencyKey: 'python-extra-import-start' });
    await wait(async () => (await api('GET', `/operations/${importedStart.operationId}`)).state === 'succeeded', 'imported dependency started offline', 300000);
    const importedServices = (await api('GET', `/works/${imported.workId}/services`)).services;
    assert.equal(importedServices.find(item => item.name === 'python-registry').enabled, false);
    const importedInstances = docker(['ps', '-q', '--filter', `label=piwork.work_id=${imported.workId}`, '--filter', 'label=piwork.resource_kind=service']).split('\n').filter(Boolean).map(id => JSON.parse(docker(['inspect', id]))[0]);
    const importedApp = importedInstances.find(item => item.Name.endsWith('_workstation'));
    assert(importedApp);
    const importedAddress = `http://${Object.values(importedApp.NetworkSettings.Networks)[0].IPAddress}:8080`;
    const importedDependency = await (await fetch(importedAddress + '/ui/queries/dependency_environment')).json();
    assert.equal(importedDependency.value.version, '1.0.0'); assert.match(importedDependency.value.pythonPrefix, /\/\.deps\//);
    const inheritedRequests = (await api('GET', `/works/${imported.workId}/agent-requests?limit=100`)).items;
    assert(inheritedRequests.every(item => item.disposition === 'historical'), 'Import replayed a source request');
    const before = await (await fetch(importedAddress + '/ui/queries/todos')).json();
    const independent = await fetch(importedAddress + '/ui/actions/todo_add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionId: 'import-only-todo', expectedStateVersion: before.stateVersion, input: { title: 'Imported dependency only' } }) });
    assert(independent.ok);
    assert.equal((await independent.json()).state, 'succeeded');
    console.log('Extra Python dependency survived Stop/Export/Import/Start with its package registry disabled; snapshot bytes:', snapshotBytes);
    const record = { contractVersion: 2, passed: true, checkedAt: new Date().toISOString(), imageId: candidate.imageId,
      inputHash: candidate.inputHash, snapshotBytes, checks: ['sdk-python-dependency-install', 'offline-extra-dependency-restart', 'offline-extra-dependency-import', 'draft-storage-failure-retained'], runs: results.map(({ prompt, runId }) => ({ prompt, runId })) };
    await writeFile(join(root, 'dist/web-base/core-dependencies-validation.json'), JSON.stringify(record, null, 2) + '\n');
    const main = JSON.parse(await readFile(join(root, 'dist/web-base/core-main-validation.json')));
    assert(main.passed && main.imageId === record.imageId && main.inputHash === record.inputHash, 'Main Core evidence belongs to another image/input');
    await writeFile(join(root, 'dist/web-base/core-validation.json'), JSON.stringify({ ...main, contractVersion: 2, checkedAt: record.checkedAt,
      checks: [...new Set([...main.checks, ...record.checks])], evidenceFiles: ['core-main-validation.json', 'core-dependencies-validation.json'], dependencyImportSnapshotBytes: snapshotBytes,
      runs: [...main.runs, ...record.runs] }, null, 2) + '\n');
  } catch (error) {
    console.error(coreOutput());
    console.error(desktopOutput().replace(/ticket=[\w-]+/g, 'ticket=[redacted]'));
    throw error;
  } finally {
    await browser?.close(); await stop(desktop); await stop(core);
    let installation;
    try { installation = JSON.parse(await readFile(join(data, 'core-format.json'))).installationId; } catch {}
    if (installation) {
      assert.match(installation, /^[A-Za-z0-9-]+$/);
      const filter = `label=piwork.installation_id=${installation}`;
      for (const [list, remove] of [[['ps', '-aq', '--filter', filter], ['rm', '-f']], [['network', 'ls', '-q', '--filter', filter], ['network', 'rm']], [['volume', 'ls', '-q', '--filter', filter], ['volume', 'rm']]]) {
        for (const id of docker(list).split('\n').filter(Boolean)) docker([...remove, id]);
      }
    }
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCoreDependencyChecks();
