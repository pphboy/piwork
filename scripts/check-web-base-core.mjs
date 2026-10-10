import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const coreBinary = join(root, 'dist/go/piwork-serve'), cliBinary = join(root, 'dist/go/piwork-cli');
const agent = process.env.PIWORK_TEST_NATIVE_AGENT_IMAGE || 'piwork-agentd:go-migration-acceptance';
const file = process.env.PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE || 'piwork-file-helper:go-migration-acceptance';
const snapshot = process.env.PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE || 'piwork-snapshot-helper:go-migration-acceptance';
await mkdir(join(root, 'dist/web-base'), { recursive: true });
const temporary = await mkdtemp(join(root, 'dist/web-base/core-check-'));
const data = join(temporary, 'core');
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
let derivedImage;
let environmentImage;
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
  return run;
}
try {
  const [httpPort, grpcPort, desktopPort] = await Promise.all([port(), port(), port()]);
  coreUrl = `http://127.0.0.1:${httpPort}`;
  core = spawn(coreBinary, ['serve', '--data-dir', data, '--listen', `127.0.0.1:${httpPort}`, '--agent-grpc-listen', `0.0.0.0:${grpcPort}`],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: '/nonexistent', PIWORK_PACKAGE_HELPER_IMAGE: agent, PIWORK_FILE_HELPER_IMAGE: file, PIWORK_SNAPSHOT_HELPER_IMAGE: snapshot } });
  coreOutput = output(core);
  await wait(async () => (await fetch(coreUrl + '/healthz')).ok, 'Core health');
  const operator = (args, input) => {
    const result = spawnSync(coreBinary, ['--core', coreUrl, '--data-dir', data, ...args], { input, encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent' } });
    assert.equal(result.status, 0, `Operator ${args[0]} failed: ${result.stderr}`);
  };
  operator(['admin', 'bootstrap', '--account', 'admin', '--password-stdin'], 'web-base-synthetic-password\n');
  operator(['config', 'set', '--agent-image', agent, '--model-provider', 'piwork-deterministic', '--model', 'fixture-v1', '--api-key-stdin'], 'synthetic-fixture-key\n');
  await wait(async () => (await fetch(coreUrl + '/readyz')).ok, 'Core readiness');
  token = (await api('POST', '/login', { account: 'admin', password: 'web-base-synthetic-password' })).token;
  const created = await api('POST', '/works', { name: 'Web base validation', idempotencyKey: 'web-base-validation' });
  work = created.workId;
  await wait(async () => (await api('GET', `/operations/${created.operationId}`)).state === 'succeeded', 'Work creation');
  assert.match((await chat('deploy deterministic workstation')).finalText, /workstation-deployed:/);

  desktop = spawn(cliBinary, ['--core', coreUrl, 'desktop', '--port', String(desktopPort), '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: '/nonexistent', PIWORK_CONFIG_PATH: join(temporary, 'client.json') } });
  desktopOutput = output(desktop);
  const launch = await wait(() => desktopOutput().match(/http:\/\/desktop\.localhost:\d+\/#ticket=[\w-]+/)?.[0], 'Desktop entry', 15000);
  browser = await chromium.launch({ headless: true, channel: 'chromium' });
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
  await page.getByRole('button', { name: /^Web base validation/ }).click();
  await page.getByRole('button', { name: 'Services', exact: true }).click();
  const frame = page.frameLocator('iframe.real-service-frame');
  await frame.getByRole('heading', { name: 'Personal workstation', exact: true }).waitFor();
  await frame.getByLabel('Todo title', { exact: true }).fill('Core CLI browser proof');
  await frame.getByRole('button', { name: 'Add Todo', exact: true }).click();
  await expect(frame.getByText('Core CLI browser proof', { exact: true })).toBeVisible();
  await frame.getByRole('button', { name: 'Complete', exact: true }).click();
  await expect(frame.getByText('Completed', { exact: true })).toBeVisible();
  await frame.getByLabel('Todo title', { exact: true }).fill('keep this unfinished input');
  await frame.getByRole('link', { name: 'Personal review', exact: true }).click();
  await expect(frame.getByText('Completed Todos: 0', { exact: true })).toBeVisible();
  // No goto/reload is performed below: version adoption belongs to the application.
  assert.match((await chat('update deterministic workstation frontend browser-frontend')).finalText, /workstation-frontend-updated:[a-f0-9]{64}/);
  await expect(frame.getByRole('heading', { name: 'Updated workstation', exact: true })).toBeVisible({ timeout: 90000 });
  await expect(frame.getByRole('heading', { name: 'Personal review', exact: true })).toBeVisible();
  assert.match((await chat('update deterministic workstation backend browser-backend')).finalText, /workstation-backend-updated:[a-f0-9]{64}/);
  await expect(frame.getByText('Completed Todos: 1', { exact: true })).toBeVisible({ timeout: 90000 });
  await frame.getByRole('link', { name: 'Todos', exact: true }).click();
  await expect(frame.getByLabel('Todo title', { exact: true })).toHaveValue('keep this unfinished input');
  const sql = await chat('inspect deterministic sqlite3');
  assert.match(sql.finalText, /sqlite3-verified:3\.40\.1/);
  assert.match(sql.finalText, /"count":1/);
  const beforeAction = (await api('GET', `/works/${work}/services`)).services.find(item => item.name === 'workstation');
  assert.equal((await chat('add deterministic workstation Todo')).finalText, 'workstation-live-todo-verified');
  await expect(frame.getByText('Agent live Todo', { exact: true })).toBeVisible({ timeout: 15000 });
  const afterAction = await api('GET', `/works/${work}/services/${beforeAction.serviceId}`);
  assert.equal(afterAction.desiredRevision, beforeAction.desiredRevision, 'Ordinary Agent Action redeployed the Service');
  const explicitRequests = (await api('GET', `/works/${work}/agent-requests?limit=100`)).items;
  assert.equal(explicitRequests.length, 1, 'The explicit Action should have its original Chat request');
  assert.equal(explicitRequests[0].source.kind, 'chat');
  assert.equal(explicitRequests[0].state, 'completed');
  const originalService = (await api('GET', `/works/${work}/services`)).services.find(item => item.name === 'workstation');
  const fields = ['name', 'image', 'command', 'args', 'environment', 'secretRefs', 'workingDirectory', 'mounts', 'ports', 'cpuMillis', 'memoryBytes', 'enabled', 'required', 'readiness', 'restartPolicy'];
  const standard = Object.fromEntries(fields.filter(key => originalService.definition[key] !== undefined).map(key => [key, originalService.definition[key]]));
  const devDefinition = { ...standard, args: ['dev', '--app', '/var/data/workspace/apps/workstation'] };
  const devReceipt = await api('PATCH', `/works/${work}/services/${originalService.serviceId}`, { definition: devDefinition, expectedRevision: originalService.desiredRevision, idempotencyKey: 'explicit-dev-mode' });
  await wait(async () => (await api('GET', `/operations/${devReceipt.operationId}`)).state === 'succeeded', 'dev mode');
  await expect(frame.getByRole('heading', { name: 'Updated workstation', exact: true })).toBeVisible({ timeout: 90000 });
  await expect(frame.locator('script[src="/@vite/client"]')).toHaveCount(1, { timeout: 90000 });
  const readSource = async path => {
    const response = await fetch(`${coreUrl}/api/v1/works/${work}/files/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200); return response.text();
  };
  const writeSource = async (path, content) => {
    const response = await fetch(`${coreUrl}/api/v1/works/${work}/files/${path}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: content });
    const result = await response.text();
    assert(response.ok, `Development source update failed (${response.status}): ${result.slice(0, 500)}`);
  };
  const beforeInitialization = await api('GET', `/works/${work}/services/${originalService.serviceId}`);
  const preserved = new Map();
  for (const path of ['apps/workstation/SPEC.md', 'apps/workstation/frontend/package-lock.json', 'apps/workstation/app.py']) {
    const changed = (await readSource(path)) + (path.endsWith('.py') ? '\n# User customization retained across rejected initialization.\n' : '\n');
    await writeSource(path, changed); preserved.set(path, changed);
  }
  const originalSession = session;
  session = (await api('POST', `/works/${work}/sessions`, { idempotencyKey: 'web-base-reinitialization' })).sessionId;
  const rejected = await chat('deploy deterministic workstation');
  session = originalSession;
  assert.equal(rejected.finalText, 'workstation-deployment-failed:initialization-refused');
  for (const [path, content] of preserved) assert.equal(await readSource(path), content, 'Repeat initialization overwrote ' + path);
  const traceResponse = await fetch(coreUrl + `/api/v1/works/${work}/runs/${rejected.runId}/events?after=0`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  assert(traceResponse.ok);
  assert.doesNotMatch(await traceResponse.text(), /work-services__(service_create|service_update|service_restart)/, 'Rejected initialization still submitted a mutation');
  const retained = await api('GET', `/works/${work}/services/${originalService.serviceId}`);
  assert.equal(retained.desiredRevision, beforeInitialization.desiredRevision);
  await expect(frame.getByText('Agent live Todo', { exact: true })).toBeVisible();
  const uiPath = 'apps/workstation/frontend/src/App.tsx', backendPath = 'apps/workstation/workstation.py';
  const [uiSource, backendSource] = await Promise.all([readSource(uiPath), readSource(backendPath)]);
  await frame.getByRole('link', { name: 'Personal review', exact: true }).click();
  await writeSource(uiPath, uiSource.replace('Updated workstation', 'Live workstation'));
  await expect(frame.getByRole('heading', { name: 'Live workstation', exact: true })).toBeVisible({ timeout: 90000 });
  await writeSource(backendPath, backendSource.replace('completed if config["includeCompleted"] else []', 'completed if config["includeCompleted"] and False else []'));
  await expect(frame.getByText('Completed Todos: 0', { exact: true })).toBeVisible({ timeout: 90000 });
  await writeSource(uiPath, uiSource);
  await writeSource(backendPath, backendSource);
  await expect(frame.getByText('Completed Todos: 1', { exact: true })).toBeVisible({ timeout: 90000 });
  const devView = await api('GET', `/works/${work}/services/${originalService.serviceId}`);
  const normalReceipt = await api('PATCH', `/works/${work}/services/${originalService.serviceId}`, { definition: standard, expectedRevision: devView.desiredRevision, idempotencyKey: 'restore-standard-mode' });
  await wait(async () => (await api('GET', `/operations/${normalReceipt.operationId}`)).state === 'succeeded', 'default mode restored');
  await expect(frame.getByRole('heading', { name: 'Updated workstation', exact: true })).toBeVisible({ timeout: 90000 });
  await expect(frame.locator('script[type="module"][src^="/assets/"]')).toHaveCount(1, { timeout: 90000 });
  await frame.getByRole('link', { name: 'Todos', exact: true }).click();
  await expect(frame.getByLabel('Todo title', { exact: true })).toHaveValue('keep this unfinished input');
  await writeSource(uiPath, uiSource + '\nconst invalid: = ;\n');
  const failedReceipt = await api('POST', `/works/${work}/services/${originalService.serviceId}/restart`, { idempotencyKey: 'failed-frontend-build' });
  const failedOperation = await wait(async () => {
    const value = await api('GET', `/operations/${failedReceipt.operationId}`);
    return ['failed', 'succeeded', 'superseded'].includes(value.state) ? value : false;
  }, 'failed build result');
  assert.equal(failedOperation.state, 'failed', 'An invalid build was reported ready');
  await writeSource(uiPath, uiSource);
  const repair = await api('POST', `/works/${work}/services/${originalService.serviceId}/restart`, { idempotencyKey: 'repair-frontend-build' });
  await wait(async () => (await api('GET', `/operations/${repair.operationId}`)).state === 'succeeded', 'repaired frontend');
  await expect(frame.getByRole('heading', { name: 'Updated workstation', exact: true })).toBeVisible({ timeout: 90000 });
  await expect(frame.getByLabel('Todo title', { exact: true })).toHaveValue('keep this unfinished input');
  const candidate = JSON.parse(await readFile(join(root, 'dist/web-base/candidate.json')));
  // Change the actual image environment, leaving all application source/locks intact.
  const environmentDirectory = join(temporary, 'environment'); await mkdir(environmentDirectory);
  await writeFile(join(environmentDirectory, 'Dockerfile'), `FROM ${candidate.reference}\nUSER 0:0\nRUN python - <<'PY'\nimport json,pathlib\np=pathlib.Path('/opt/piwork-web-base/environment.json')\nv=json.loads(p.read_text());v['acceptanceEnvironment']='upgrade-v2';p.write_text(json.dumps(v,sort_keys=True)+'\\n')\nPY\nUSER 10001:10001\n`);
  environmentImage = 'piwork-web-base-environment:' + randomUUID();
  docker(['build', '--label', 'piwork.fixture=web-base-environment', '-t', environmentImage, environmentDirectory]);
  const sourceIdentity = () => {
    const ids = docker(['ps', '-q', '--filter', `label=piwork.work_id=${work}`, '--filter', 'label=piwork.resource_kind=service']).split('\n').filter(Boolean);
    const container = ids.map(id => JSON.parse(docker(['inspect', id]))[0]).find(item => item.Name.endsWith('_workstation'));
    return docker(['exec', container.Id, 'python', '-c', "from pathlib import Path;from piwork_web import digest_tree;print(digest_tree(Path('/var/data/workspace/apps/workstation')))"]);
  };
  const unchangedSource = sourceIdentity();
  const oldVersion = await frame.getByRole('heading', { name: 'Updated workstation', exact: true }).evaluate(async () => (await fetch('/api/runtime-version')).json());
  const oldAsset = await frame.locator('script[type="module"]').getAttribute('src');
  await frame.getByRole('link', { name: 'Personal review', exact: true }).click();
  await expect(frame.getByRole('heading', { name: 'Personal review', exact: true })).toBeVisible();
  const applicationOrigin = await frame.getByRole('heading', { name: 'Personal review', exact: true }).evaluate(() => location.origin);
  const applicationFrame = page.frames().find(candidate => candidate.parentFrame() && new URL(candidate.url()).origin === applicationOrigin);
  assert(applicationFrame);
  let environmentAdoptions = 0;
  // Frame navigation events also include SPA pushState; count real document loads.
  const countAdoption = request => { if (request.isNavigationRequest() && request.frame() === applicationFrame) environmentAdoptions++; };
  page.on('request', countAdoption);
  const environmentRevision = (await api('GET', `/works/${work}/services/${originalService.serviceId}`)).desiredRevision;
  const upgradedReceipt = await api('PATCH', `/works/${work}/services/${originalService.serviceId}`, { definition: { ...standard, image: { reference: environmentImage } }, expectedRevision: environmentRevision, idempotencyKey: 'environment-only-upgrade' });
  await wait(async () => (await api('GET', `/operations/${upgradedReceipt.operationId}`)).state === 'succeeded', 'environment upgrade');
  await expect.poll(() => frame.locator('script[type="module"]').getAttribute('src'), { timeout: 90000 }).not.toBe(oldAsset);
  await expect(frame.getByRole('heading', { name: 'Personal review', exact: true })).toBeVisible();
  const newVersion = await frame.getByRole('heading', { name: 'Personal review', exact: true }).evaluate(async () => (await fetch('/api/runtime-version')).json());
  assert.notEqual(newVersion.environmentHash, oldVersion.environmentHash);
  assert.notEqual(newVersion.frontendVersion, oldVersion.frontendVersion);
  assert.notEqual(newVersion.codeVersion, oldVersion.codeVersion);
  assert.equal(sourceIdentity(), unchangedSource, 'Environment test changed application source/locks');
  await new Promise(done => setTimeout(done, 11000));
  assert.equal(environmentAdoptions, 1, 'Environment adoption did not perform exactly one application navigation');
  assert(page.frames().includes(applicationFrame), 'Environment observation replaced the application iframe');
  page.off('request', countAdoption);
  await frame.getByRole('link', { name: 'Todos', exact: true }).click();
  await expect(frame.getByLabel('Todo title', { exact: true })).toHaveValue('keep this unfinished input');
  const upgradedService = await api('GET', `/works/${work}/services/${originalService.serviceId}`);
  const restoredReceipt = await api('PATCH', `/works/${work}/services/${originalService.serviceId}`, { definition: standard, expectedRevision: upgradedService.desiredRevision, idempotencyKey: 'restore-original-environment' });
  await wait(async () => (await api('GET', `/operations/${restoredReceipt.operationId}`)).state === 'succeeded', 'original environment restored');
  await expect.poll(() => frame.locator('script[type="module"]').getAttribute('src'), { timeout: 90000 }).toBe(oldAsset);
  const memoryProgram = `import json,resource
from http.server import BaseHTTPRequestHandler,HTTPServer
memory=bytearray(192<<20)
for page in range(0,len(memory),4096): memory[page]=1
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps({'touchedBytes':len(memory),'rssKiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}).encode())
HTTPServer(('0.0.0.0',8081),Handler).serve_forever()
`;
  for (const [name, compatibility] of [['memory-omitted', {}], ['memory-legacy', { memoryBytes: 128 << 20 }]]) {
    const definition = { name, image: { reference: candidate.reference }, command: 'python', args: ['-c', memoryProgram], workingDirectory: '/', cpuMillis: 100,
      ports: [{ name: 'web', protocol: 'tcp', containerPort: 8081 }], readiness: { kind: 'http', portName: 'web', path: '/health' }, ...compatibility };
    const receipt = await api('POST', `/works/${work}/services`, { definition, idempotencyKey: name });
    await wait(async () => (await api('GET', `/operations/${receipt.operationId}`)).state === 'succeeded', name);
    const view = await api('GET', `/works/${work}/services/${receipt.serviceId}`);
    assert.equal(view.memoryLimitMode, 'unlimited');
    const ids = docker(['ps', '-q', '--filter', `label=piwork.work_id=${work}`, '--filter', 'label=piwork.resource_kind=service']).split('\n').filter(Boolean);
    const actual = ids.map(id => JSON.parse(docker(['inspect', id]))[0]).find(item => item.Name.endsWith('_' + name));
    assert(actual, `${name} runtime missing`); assert.equal(actual.HostConfig.Memory, 0);
    const address = Object.values(actual.NetworkSettings.Networks)[0].IPAddress;
    const allocated = await (await fetch(`http://${address}:8081/`)).json();
    assert.equal(allocated.touchedBytes, 192 << 20); assert(allocated.rssKiB >= 192 * 1024);
  }
  // A downstream image adds an actual locally packaged dependency and its own command.
  const derived = join(temporary, 'derived'); await mkdir(derived);
  await writeFile(join(derived, 'app.py'), `from fastapi import FastAPI\nimport uvicorn,derived_fixture\napp=FastAPI()\n@app.get('/health')\n@app.get('/')\ndef index(): return {'message':derived_fixture.message()}\nuvicorn.run(app,host='0.0.0.0',port=8090)\n`);
  await writeFile(join(derived, 'Dockerfile'), `FROM ${candidate.reference}\nUSER 0:0\nRUN python - <<'PY'\nimport zipfile\nfiles={'derived_fixture.py':'def message(): return "derived dependency installed"\\n','piwork_derived_fixture-1.0.0.dist-info/METADATA':'Metadata-Version: 2.1\\nName: piwork-derived-fixture\\nVersion: 1.0.0\\n','piwork_derived_fixture-1.0.0.dist-info/WHEEL':'Wheel-Version: 1.0\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n'}\nfiles['piwork_derived_fixture-1.0.0.dist-info/RECORD']=''.join(name+',,\\n' for name in [*files,'piwork_derived_fixture-1.0.0.dist-info/RECORD'])\nwith zipfile.ZipFile('/tmp/piwork_derived_fixture-1.0.0-py3-none-any.whl','w') as wheel:\n for name,value in files.items(): wheel.writestr(name,value)\nPY\nRUN python -m pip install --no-index --no-deps /tmp/piwork_derived_fixture-1.0.0-py3-none-any.whl\nCOPY app.py /opt/derived/app.py\nUSER 10001:10001\nCMD ["python","/opt/derived/app.py"]\n`);
  derivedImage = 'piwork-web-base-derived:' + randomUUID();
  docker(['build', '--label', 'piwork.fixture=web-base-derived', '-t', derivedImage, derived]);
  const derivedReceipt = await api('POST', `/works/${work}/services`, { idempotencyKey: 'derived-image', definition: {
    name: 'derived', image: { reference: derivedImage }, command: 'python', args: ['/opt/derived/app.py'], workingDirectory: '/', cpuMillis: 100,
    ports: [{ name: 'web', protocol: 'tcp', containerPort: 8090 }], readiness: { kind: 'http', portName: 'web', path: '/health' },
  } });
  await wait(async () => (await api('GET', `/operations/${derivedReceipt.operationId}`)).state === 'succeeded', 'derived Service');
  const ids = docker(['ps', '-q', '--filter', `label=piwork.work_id=${work}`, '--filter', 'label=piwork.resource_kind=service']).split('\n').filter(Boolean);
  const instances = ids.map(id => JSON.parse(docker(['inspect', id]))[0]);
  const extension = instances.find(item => item.Name.endsWith('_derived'));
  const extensionAddress = Object.values(extension.NetworkSettings.Networks)[0].IPAddress;
  assert.equal((await (await fetch(`http://${extensionAddress}:8090/`)).json()).message, 'derived dependency installed');
  const main = instances.find(item => item.Name.endsWith('_workstation'));
  assert.equal(main.Config.Image, candidate.imageId, 'SDK used a different base image than the candidate');
  // Simulate a retained capped container and recover it through the normal Work lifecycle.
  docker(['update', '--memory', String(128 << 20), '--memory-swap', String(256 << 20), main.Id]);
  const stopped = await api('POST', `/works/${work}/stop`, { idempotencyKey: 'memory-upgrade-stop' });
  await wait(async () => (await api('GET', `/operations/${stopped.operationId}`)).state === 'succeeded', 'Work stopped');
  const started = await api('POST', `/works/${work}/start`, { idempotencyKey: 'memory-upgrade-start' });
  await wait(async () => (await api('GET', `/operations/${started.operationId}`)).state === 'succeeded', 'Work recovered', 300000);
  const recoveredIds = docker(['ps', '-q', '--filter', `label=piwork.work_id=${work}`, '--filter', 'label=piwork.resource_kind=service']).split('\n').filter(Boolean);
  const recovered = recoveredIds.map(id => JSON.parse(docker(['inspect', id]))[0]).find(item => item.Name.endsWith('_workstation'));
  assert.notEqual(recovered.Id, main.Id); assert.equal(recovered.HostConfig.Memory, 0);
  await expect(frame.getByRole('heading', { name: 'Updated workstation', exact: true })).toBeVisible({ timeout: 90000 });
  await expect(frame.getByLabel('Todo title', { exact: true })).toHaveValue('keep this unfinished input');
  await stop(core);
  core = spawn(coreBinary, ['serve', '--data-dir', data, '--listen', `127.0.0.1:${httpPort}`, '--agent-grpc-listen', `0.0.0.0:${grpcPort}`],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: '/nonexistent', PIWORK_PACKAGE_HELPER_IMAGE: agent, PIWORK_FILE_HELPER_IMAGE: file, PIWORK_SNAPSHOT_HELPER_IMAGE: snapshot } });
  coreOutput = output(core);
  await wait(async () => (await api('GET', `/works/${work}`)).observedState === 'ready', 'graceful Core recovery', 300000);
  await expect(frame.getByRole('heading', { name: 'Updated workstation', exact: true })).toBeVisible({ timeout: 90000 });
  await expect(frame.getByLabel('Todo title', { exact: true })).toHaveValue('keep this unfinished input');
  assert.equal((await api('GET', `/works/${work}/services`)).services.filter(item => item.observedState === 'ready').length, 4);
  const histories = await Promise.all([...testSessions].map(id => api('GET', `/works/${work}/sessions/${id}`)));
  assert.equal(histories.reduce((count, history) => count + history.runs.length, 0), submission, 'Version reads unexpectedly started another Run');
  const requests = await api('GET', `/works/${work}/agent-requests?limit=100`);
  assert.deepEqual(requests.items.map(item => item.requestId).sort(), explicitRequests.map(item => item.requestId).sort(), 'Passive version observation started an Agent goal');
  assert.equal((await api('GET', `/works/${work}/configuration`)).pendingApply, false, 'Application refresh applied Work configuration');
  assert.deepEqual(errors, []);
  await writeFile(join(root, 'dist/web-base/core-validation.json'), JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), imageId: candidate.imageId,
    inputHash: candidate.inputHash, checks: ['real-sdk-mcp', 'real-core-cli-browser', 'frontend-auto-adoption', 'backend-auto-adoption', 'agent-data-auto-adoption', 'environment-auto-adoption', 'safe-repeat-initialization', 'draft-path-retained', 'failed-build-recovery', 'dev-hmr-backend-reload', 'agent-sqlite3', 'no-extra-run-or-apply', 'memory-over-128MiB', 'legacy-cap-replaced', 'derived-image-service', 'core-graceful-recovery'], runs: results.map(({ prompt, runId }) => ({ prompt, runId })) }, null, 2) + '\n');
  console.log('Real SDK/MCP/Core/CLI/browser: frontend and backend adopted automatically, draft/path retained, Agent sqlite3 executed; no manual reload or extra Run/Apply.');
} catch (error) {
  console.error('Document response status/path (no credentials):', JSON.stringify(documentResponses.slice(-12)));
  for (const context of browser?.contexts() || []) for (const page of context.pages()) for (const frame of page.frames()) {
    try {
      const diagnostic = await frame.evaluate(() => ({ path: location.pathname, scripts: document.querySelectorAll('script[type="module"]').length,
        headings: [...document.querySelectorAll('h1,h2')].map(node => node.textContent),
        codes: document.body?.innerText.match(/(?:SERVICE|WORK|CORE|SESSION|AUTH|ENTRY|PROXY|ACCESS)_[A-Z_]+/g) || [] }));
      console.error('Frame diagnostic:', JSON.stringify(diagnostic));
    } catch { console.error('Frame diagnostic unavailable'); }
  }
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
  if (derivedImage) docker(['image', 'rm', derivedImage]);
  if (environmentImage) docker(['image', 'rm', environmentImage]);
  await rm(temporary, { recursive: true, force: true });
}
