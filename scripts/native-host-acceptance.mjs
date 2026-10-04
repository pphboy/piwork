// The driver runs on the development machine. Product processes run in scratch,
// with only the release binaries, data, and an independent Engine Unix socket.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createTCPServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repository = resolve(import.meta.dirname, '..');
const binaries = resolve(process.env.PIWORK_TEST_RELEASE_BIN || join(repository, 'dist/go'));
const agentImage = process.env.PIWORK_TEST_NATIVE_AGENT_IMAGE || 'piwork-agentd:go-migration-acceptance';
const fileImage = process.env.PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE || 'piwork-file-helper:go-migration-acceptance';
const snapshotImage = process.env.PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE || 'piwork-snapshot-helper:go-migration-acceptance';
const identity = `piwork-native-host-${randomUUID()}`;
const label = `piwork.acceptance.fixture=${identity}`;
const root = await mkdtemp(join(tmpdir(), `${identity}-`));
const engine = `${identity}-engine`, hostImage = `${identity}:scratch`;
const socketVolume = `${identity}-socket`, dataVolume = `${identity}-data`;
const containers = [];
const relayConnections = new Set();
let browserRelay;
const publicCodes = [...(await readFile(new URL('../internal/contracts/errors.go', import.meta.url), 'utf8')).matchAll(/^\s*"([A-Z][A-Z_]+)"\s*:/gm)].map(match => match[1]);
const observationCodes = ['OPERATION_WAIT_TIMEOUT', 'OPERATION_OBSERVATION_UNAVAILABLE'];

async function command(program, args, { input, allowFailure = false } = {}) {
  const child = spawn(program, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.end(input);
  const code = await new Promise((done, reject) => { child.on('error', reject); child.on('close', done); });
  // Arguments and diagnostics may contain test credentials. Keep them out of logs.
  if (!allowFailure && code !== 0) {
    const reasons = [...publicCodes, ...observationCodes].filter(reason => new RegExp(`\\b${reason}\\b`).test(`${stdout}\n${stderr}`));
    throw new Error(`${program} ${args[0]} failed (${code})${reasons.length ? `: ${reasons.join(', ')}` : ''}`);
  }
  return { code, stdout, stderr };
}
const docker = async (args, options) => (await command('docker', args, options)).stdout.trim();
async function waitFor(check, label, timeout = 180_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const result = await check(); if (result) return result; } catch { /* startup */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function startHost(name, program, args, environment = []) {
  const container = `${identity}-${name}`;
  await docker(['run', '-d', '--name', container, '--label', label,
    '--network', `container:${engine}`, '--tmpfs', '/tmp:rw,noexec,nosuid,nodev', '--mount', `type=volume,src=${socketVolume},dst=/var/run`,
    '--mount', `type=volume,src=${dataVolume},dst=/data`, '--mount', `type=bind,src=${join(root, 'tls')},dst=/tls,readonly`,
    '-e', 'PATH=/nonexistent', ...environment.flatMap((value) => ['-e', value]),
    '--entrypoint', `/bin/${program}`, hostImage, ...args]);
  containers.push(container);
  return container;
}
async function loadImages() {
  const source = spawn('docker', ['save', agentImage, fileImage, snapshotImage, 'python:3.13-slim', 'piwork-workstation:acceptance'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const target = spawn('docker', ['exec', '-i', engine, 'docker', 'load'], { stdio: ['pipe', 'pipe', 'pipe'] });
  source.stdout.pipe(target.stdin);
  target.stdin.on('error', () => {});
  source.stderr.resume(); target.stderr.resume(); target.stdout.resume();
  const codes = await Promise.all([source, target].map((child) => new Promise((done, reject) => {
    child.on('error', reject); child.on('close', done);
  })));
  assert.deepEqual(codes, [0, 0], 'independent Engine image load failed');
}
async function insideHTTP(url, headers = [], tls = false) {
  const result = await command('docker', ['exec', engine, 'wget', '-q', '-O', '-',
    ...(tls ? ['--no-check-certificate'] : []), ...headers.flatMap((header) => ['--header', header]), url]);
  return result.stdout;
}

try {
  await mkdir(join(root, 'bin'));
  await mkdir(join(root, 'tls'));
  for (const program of ['piwork-serve', 'piwork-cli', 'piwork-console']) {
    await copyFile(join(binaries, program), join(root, 'bin', program));
  }
  await symlink('piwork-serve', join(root, 'bin', 'piwork'));
  await writeFile(join(root, 'Dockerfile'), 'FROM scratch\nCOPY bin/ /bin/\n');
  // Fixture preparation only; openssl is absent from the product host.
  await command('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-keyout', join(root, 'tls/key.pem'), '-out', join(root, 'tls/cert.pem'),
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1']);
  await docker(['build', '--label', label, '-t', hostImage, root]);
  for (const volume of [socketVolume, dataVolume]) await docker(['volume', 'create', '--label', label, volume]);
  await docker(['run', '-d', '--privileged', '--name', engine, '--label', label,
    '-e', 'DOCKER_TLS_CERTDIR=', '--mount', `type=volume,src=${socketVolume},dst=/var/run`,
    '--mount', `type=volume,src=${dataVolume},dst=/data`, '-p', '127.0.0.1::7171',
    'docker:27-dind', '--host=unix:///var/run/docker.sock', '--tls=false']);
  containers.push(engine);
  await waitFor(async () => (await command('docker', ['exec', engine, 'docker', 'info'], { allowFailure: true })).code === 0, 'independent Engine');
  await loadImages();
  console.log('Independent Engine ready; fixture images loaded.');
  const core = await startHost('core', 'piwork-serve', ['serve', '--data-dir', '/data/core',
    '--listen', '0.0.0.0:7171', '--allow-insecure-remote', '--agent-grpc-listen', '0.0.0.0:7172'], [
    `PIWORK_PACKAGE_HELPER_IMAGE=${agentImage}`, `PIWORK_FILE_HELPER_IMAGE=${fileImage}`,
    `PIWORK_SNAPSHOT_HELPER_IMAGE=${snapshotImage}`,
  ]);
  const address = await docker(['port', engine, '7171/tcp']);
  const base = `http://${address}`;
  await waitFor(async () => (await fetch(`${base}/healthz`)).ok, 'scratch Core health');
  const operator = (args, input) => docker(['exec', '-i', core, '/bin/piwork-serve',
    '--core', 'http://127.0.0.1:7171', '--data-dir', '/data/core', ...args], { input });
  await operator(['admin', 'bootstrap', '--account', 'admin', '--password-stdin'], 'native-host-fixture-password\n');
  await operator(['config', 'set', '--agent-image', agentImage, '--model-provider', 'piwork-deterministic',
    '--model', 'fixture-v1', '--api-key-stdin'], 'fixture-key\n');
  await waitFor(async () => (await fetch(`${base}/readyz`)).ok, 'scratch Core readiness');
  console.log('Scratch Core initialized and ready.');
  const cli = async (args, input) => {
    const result = await command('docker', ['exec', '-i', '-e', 'PIWORK_CONFIG_PATH=/data/client/client.json', core,
      '/bin/piwork-cli', '--core', 'http://127.0.0.1:7171', '--json', ...args], { input, allowFailure: true });
    if (result.code === 0) return result.stdout.trim();
    let accepted; try { accepted = JSON.parse(result.stdout); } catch { /* No acceptance identity is available. */ }
    if (args.includes('--wait') && result.code === 5 && accepted?.state === 'waiting' &&
        typeof accepted.operationId === 'string' && observationCodes.includes(accepted.error?.code)) {
      console.log('CLI observation interrupted; checking the original accepted Operation without resubmitting.');
      const terminal = await waitFor(async () => {
        const original = JSON.parse(await cli(['operation', 'show', accepted.operationId]));
        return ['succeeded', 'failed', 'superseded'].includes(original.state) ? original : undefined;
      }, 'original CLI Operation', 300_000);
      assert.equal(terminal.state, 'succeeded', publicCodes.includes(terminal.error?.code) ? terminal.error.code : 'Original Operation failed');
      return JSON.stringify(terminal);
    }
    const reasons = [...publicCodes, ...observationCodes].filter(reason => new RegExp(`\\b${reason}\\b`).test(`${result.stdout}\n${result.stderr}`));
    throw new Error(`Native CLI failed (${result.code})${reasons.length ? `: ${reasons.join(', ')}` : ''}`);
  };
  const wrongIdentity = await command('docker', ['exec', core, '/bin/piwork', 'chat', 'work-invalid'], { allowFailure: true });
  assert.equal(wrongIdentity.code, 2, 'operator compatibility alias must reject user chat');
  assert(JSON.parse(await operator(['--json', 'status'])).state, 'operator status must use operator credentials');
  await cli(['login', '--account', 'admin', '--password-stdin'], 'native-host-fixture-password\n');
  const login = await fetch(`${base}/api/v1/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'admin', password: 'native-host-fixture-password' }) });
  assert.equal(login.status, 200);
  const token = (await login.json()).token;
  const created = JSON.parse(await cli(['work', 'create', '--name', 'Native host Work', '--wait']));
  assert.equal(created.state, 'succeeded');
  const workId = created.workId;
  assert.equal(typeof workId, 'string');
  const session = JSON.parse(await cli(['session', 'create', workId]));
  const chat = await cli(['chat', workId, '--session', session.sessionId, '--message', 'deploy deterministic service']);
  for (const tool of ['deployment_context', 'service_create', 'operation_get', 'service_get']) {
    assert(chat.includes(`work-services__${tool}`), `real SDK did not invoke Go MCP ${tool}`);
  }
  const service = JSON.parse(await cli(['work', 'service', 'list', workId])).services[0];
  assert.equal(service.observedState, 'ready');
  console.log('Real TS SDK deployed a durable Service through Go MCP.');
  const proxy = await startHost('proxy', 'piwork-cli', ['--core', 'http://127.0.0.1:7171', 'proxy', '--port', '7175'],
    ['PIWORK_CONFIG_PATH=/data/client/client.json']);
  const proxyLogs = await waitFor(async () => {
    const output = await docker(['logs', proxy]); return output.includes('WebDAV status: available') && output;
  }, 'scratch proxy');
  const password = proxyLogs.match(/WebDAV password: (\S+)/)?.[1];
  assert(password);
  const first = JSON.parse(await docker(['exec', '-e', 'http_proxy=http://127.0.0.1:7175', engine,
    'wget', '-q', '-O', '-', `http://${service.access.hostname}/`]));
  assert.equal(typeof first.count, 'number');
  const davAuth = `Authorization: Basic ${Buffer.from(`piwork:${password}`).toString('base64')}`;
  const files = await fetch(`${base}/api/v1/works/${workId}/files/native-host.txt`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: 'native host durable bytes',
  });
  assert([201, 204].includes(files.status));
  assert.equal(await insideHTTP(`http://127.0.0.1:7175/works/${workId}/files/native-host.txt`, [davAuth]), 'native host durable bytes');
  const desktop = await startHost('desktop', 'piwork-cli', ['--core', 'http://127.0.0.1:7171', 'desktop', '--port', '7174', '--no-open'],
    ['PIWORK_CONFIG_PATH=/data/client/client.json']);
  await waitFor(async () => (await docker(['logs', desktop])).includes('Piwork Desktop:'), 'scratch Desktop');
  assert(/piwork/i.test(await insideHTTP('http://127.0.0.1:7174/', ['Host: desktop.localhost:7174'])));
  assert((await insideHTTP('http://127.0.0.1:7174/desktop/browser/app.js', ['Host: desktop.localhost:7174'])).includes('Pi requests'));
  const consoleHost = await startHost('console', 'piwork-console', ['serve', '--core', 'http://127.0.0.1:7171', '--listen', '127.0.0.1:7173',
    '--public-origin', 'https://127.0.0.1:7173', '--tls-cert', '/tls/cert.pem', '--tls-key', '/tls/key.pem', '--data-dir', '/data/console']);
  await waitFor(async () => (await insideHTTP('https://127.0.0.1:7173/login', [], true)).includes('PiWork Serve'), 'scratch Console');
  assert((await insideHTTP('https://127.0.0.1:7173/browser/app.js', [], true)).includes('Default Work'));
  console.log('Scratch Service proxy, WebDAV, Desktop and Console are accessible.');

  const api = async (path, method = 'GET', body) => {
    const response = await fetch(`${base}/api/v1${path}`, {method, headers:{Authorization:`Bearer ${token}`, 'Content-Type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {})});
    assert(response.ok, `Native brain API ${method} ${path}: ${response.status}`);
    return response.json();
  };
  const sdkChat = async (work, prompt) => {
    const session = JSON.parse(await cli(['session','create',work]));
    await cli(['chat',work,'--session',session.sessionId,'--message',prompt]);
    const history = await api(`/works/${work}/sessions/${session.sessionId}`);
    assert(history.runs.some(run => run.state === 4), 'Actual SDK run must succeed');
    return history.runs.at(-1);
  };
  const feedback = async (work, fragment, state) => waitFor(async () => {
    const page=await api(`/works/${work}/agent-requests?limit=100`);
    const request=page.items.find(r=>r.disposition==='live' && r.goal.includes(fragment));
    if (!request || request.state!==state) return;
    return api(`/works/${work}/agent-requests/${request.requestId}`);
  }, `actual feedback ${fragment}: ${state}`, 180000);
  // Development-only TCP transport into the Engine loopback namespace. The
  // released proxy keeps its required loopback binding; Service ports stay private.
  browserRelay = createTCPServer(socket => {
    const child = spawn('docker',['exec','-i',engine,'nc','127.0.0.1','7175'],{stdio:['pipe','pipe','pipe']});
    const connection={socket,child}; relayConnections.add(connection);
    child.stderr.resume(); child.stdin.on('error',()=>socket.destroy());
    socket.on('error',()=>child.kill()); child.on('error',()=>socket.destroy());
    socket.pipe(child.stdin); child.stdout.pipe(socket);
    child.on('close',()=>{socket.destroy();relayConnections.delete(connection);});
    socket.on('close',()=>{child.kill();relayConnections.delete(connection);});
  });
  await new Promise((resolve,reject)=>{browserRelay.once('error',reject);browserRelay.listen(0,'127.0.0.1',resolve);});
  const browserProxy = `http://127.0.0.1:${browserRelay.address().port}`;
  const {chromium,expect} = await import('@playwright/test');
  await sdkChat(workId, 'deploy deterministic workstation');
  const workstation=(await api(`/works/${workId}/services`)).services.find(s=>s.name==='workstation');
  assert(workstation && workstation.observedState==='ready');
  const browser=await chromium.launch({headless:true,channel:'chromium',proxy:{server:browserProxy}});
  try {
    const page=await browser.newPage();
    await page.goto(`http://${workstation.access.hostname}/`);
    await page.getByLabel('Todo title',{exact:true}).fill('Scratch host completed Todo');
    await page.getByRole('button',{name:'Add Todo',exact:true}).click();
    await expect(page.getByText('Scratch host completed Todo',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Complete',exact:true}).click();
    await page.getByRole('link',{name:'Personal review'}).click();
    await expect(page.getByText('Completed Todos: 0',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Report missing completed Todos',exact:true}).click();
    await feedback(workId,'personal review omits','completed');
    await page.getByRole('button',{name:'Refresh review',exact:true}).click();
    await expect(page.getByText('Completed Todos: 1',{exact:true})).toBeVisible({timeout:30000});
    const receipt=await page.evaluate(async()=>{const response=await fetch('/ui/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:'export_review',goal:'Export the personal review and verify its original Job'})});return {status:response.status,value:await response.json()};});
    assert.equal(receipt.status,200,'User feedback HTTP must reach the real workstation');
    await feedback(workId,'Export','waiting_result');
    const cognition=await sdkChat(workId,'inspect piwork brain cognition');
    assert(cognition.adoptedExperienceVersion>0 && cognition.finalText.endsWith(':true'));
    await feedback(workId,'Export','completed');
  } finally {await browser.close();}
  const candidateProof = async (work,key) => {
    await sdkChat(work,`prepare workstation brain candidate ${key}`);
    const original=await feedback(work,`prepare workstation brain candidate ${key}`,'waiting_apply');
    assert.equal(JSON.parse(await cli(['work','stop',work,'--wait'])).state,'succeeded');
    assert.equal(JSON.parse(await cli(['work','start',work,'--wait'])).state,'succeeded');
    const retained=await api(`/works/${work}/agent-requests/${original.request.requestId}`);
    assert.equal(retained.request.autoRunCount,original.request.autoRunCount);
    assert.equal(retained.request.waitRef.deadlineAt,original.request.waitRef.deadlineAt);
    const apply=await api(`/works/${work}/configuration/apply`,'POST',{idempotencyKey:`${key}-apply`});
    await waitFor(async()=> (await api(`/operations/${apply.operationId}`)).state==='succeeded','candidate explicit Apply');
    const done=await feedback(work,`prepare workstation brain candidate ${key}`,'completed');
    assert(done.evidence.items.some(e=>e.kind==='sdk' && e.verified),'Each environment needs its actual SDK behavior proof');
  };
  await candidateProof(workId,'scratch-original');
  await operator(['config','set','--agent-image',agentImage,'--model-provider','piwork-deterministic','--model','fixture-v2','--api-key-stdin'],'fixture-two-key\n');
  const models=await api(`/works/${workId}/models`);
  assert.equal(models.models.length,2);
  const modelSession=JSON.parse(await cli(['session','create',workId]));
  await api(`/works/${workId}/sessions/${modelSession.sessionId}/model`,'PATCH',{modelRef:models.models.find(m=>m.model==='fixture-v2').modelRef});
  await cli(['chat',workId,'--session',modelSession.sessionId,'--message','identify current model']);
  const modelHistory=await api(`/works/${workId}/sessions/${modelSession.sessionId}`);
  assert.equal(modelHistory.runs.at(-1).actualModel.model,'fixture-v2');
  assert.equal(modelHistory.runs.at(-1).finalText,'piwork-deterministic/fixture-v2');
  console.log('Scratch Go host: actual browser observations, automatic repair, Job continuation, experience adoption, candidate Apply/recovery and model selection passed.');

  assert.equal(JSON.parse(await cli(['work', 'stop', workId, '--wait'])).state, 'succeeded');
  const exportPath = `/data/client/${workId}.work`;
  const exported = JSON.parse(await docker(['exec', '-w', '/data/client', '-e', 'PIWORK_CONFIG_PATH=/data/client/client.json', core,
    '/bin/piwork-cli', '--core', 'http://127.0.0.1:7171', '--json', 'work', 'export', workId]));
  assert(exported.size > 0 && exported.snapshotId);
  const inspected = JSON.parse(await cli(['work', 'package', 'inspect', exportPath]));
  assert.equal(inspected.integrityVerified, true);
  assert.equal(inspected.installationValidated, false);
  const imported = JSON.parse(await cli(['work', 'import', exportPath, '--name', 'Native host restored', '--wait']));
  assert.equal(imported.state, 'succeeded');
  assert.notEqual(imported.workId, workId);
  assert.equal(JSON.parse(await cli(['work', 'start', imported.workId, '--wait'])).state, 'succeeded');
  const restoredFile = await fetch(`${base}/api/v1/works/${imported.workId}/files/native-host.txt`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(restoredFile.status, 200);
  assert.equal(await restoredFile.text(), 'native host durable bytes');

  const copiedProof = async (work,key) => {
    const requests=await api(`/works/${work}/agent-requests?limit=100`);
    assert(requests.items.length>0 && requests.items.every(r=>r.disposition==='historical'));
    const services=await api(`/works/${work}/services`);
    const service=services.services.find(s=>s.name==='workstation');
    const copiedBrowser=await chromium.launch({headless:true,channel:'chromium',proxy:{server:browserProxy}});
    try {
      const page=await copiedBrowser.newPage();await page.goto(`http://${service.access.hostname}/review`);
      await page.getByRole('button',{name:'Report missing completed Todos',exact:true}).click();
      await feedback(work,'personal review omits','completed');
    } finally {await copiedBrowser.close();}
    await candidateProof(work,key);
    assert.equal(JSON.parse(await cli(['work','stop',work,'--wait'])).state,'succeeded');
  };
  await copiedProof(imported.workId,'scratch-copy-one');
  const secondCopy=JSON.parse(await cli(['work','import',exportPath,'--name','Native host second copy','--wait']));
  assert.equal(secondCopy.state,'succeeded');assert.notEqual(secondCopy.workId,imported.workId);assert.notEqual(secondCopy.workId,workId);
  assert.equal(JSON.parse(await cli(['work','start',secondCopy.workId,'--wait'])).state,'succeeded');
  await copiedProof(secondCopy.workId,'scratch-copy-two');
  assert.equal(JSON.parse(await cli(['work','start',imported.workId,'--wait'])).state,'succeeded');
  console.log('Two scratch imports retained historical records and each produced independent new feedback and actual SDK candidate proof.');

  const execution = [];
  for (const container of containers.filter((value) => value !== engine)) {
    const output = await docker(['top', container, '-eo', 'pid,comm']);
    const processes = output.split('\n').slice(1).map((line) => line.trim().split(/\s+/).slice(1).join(' '));
    assert(processes.length > 0 && processes.every((name) => name.startsWith('piwork-')));
    execution.push({ role: container.slice(identity.length + 1), processes });
    for (const tool of ['node', 'npm', 'python', 'go', 'docker', 'openssl', 'sh']) {
      for (const directory of ['/bin', '/usr/bin', '/usr/local/bin']) {
        assert.notEqual((await command('docker', ['exec', container, `${directory}/${tool}`, '--version'], { allowFailure: true })).code, 0);
      }
    }
  }
  const sdkContainers = (await docker(['exec', engine, 'docker', 'ps', '-q', '--filter', 'label=piwork.resource_kind=agent'])).split('\n').filter(Boolean);
  assert(sdkContainers.length > 0);
  const sdkProcesses = await docker(['exec', engine, 'docker', 'top', sdkContainers[0], '-eo', 'pid,comm,args']);
  assert(sdkProcesses.includes('node') && sdkProcesses.includes('piwork-service'), 'TS SDK and Go MCP did not run together');
  const independent = JSON.parse(await cli(['work', 'create', '--name', 'Console independent']));
  await docker(['stop', '--time', '10', consoleHost]);
  await waitFor(async () => JSON.parse(await cli(['operation', 'show', independent.operationId])).state === 'succeeded', 'accepted Work after Console exit');
  assert((await fetch(`${base}/healthz`)).ok);
  assert.equal(JSON.parse(await cli(['whoami'])).account, 'admin');
  assert(JSON.parse(await operator(['--json', 'status'])).state);
  console.log('Console exit leaves Core, operator/user CLI and the accepted Work Operation running.');
  console.log(JSON.stringify({ result: 'PASS', fixture: identity, independentEngine: 'Unix socket',
    productHost: 'scratch: three release binaries, no interpreter or external tool',
    execution, checks: ['bootstrap/runtime', 'Work', 'real SDK→Go MCP deployment', 'Service proxy', 'WebDAV',
      'embedded Desktop/Console', 'Stop/Export/Inspect/Import/Start', 'restored workspace', 'brain default creation', 'page/action observations', 'automatic feedback and async Job', 'Service improvement and experience', 'brain SDK adoption', 'Stop/Start original candidate recovery', 'two independent copies with new SDK proof', 'actual chat model selection'] }));
} finally {
  for (const {socket,child} of relayConnections) {socket.destroy();child.kill();}
  if (browserRelay) await new Promise(resolve=>browserRelay.close(resolve));
  for (const container of containers.reverse()) {
    const owner = await command('docker', ['inspect', '--format', '{{index .Config.Labels "piwork.acceptance.fixture"}}', container], { allowFailure: true });
    if (owner.stdout.trim() === identity) await command('docker', ['rm', '-f', '-v', container], { allowFailure: true });
  }
  for (const volume of [socketVolume, dataVolume]) {
    const owner = await command('docker', ['volume', 'inspect', '--format', '{{index .Labels "piwork.acceptance.fixture"}}', volume], { allowFailure: true });
    if (owner.stdout.trim() === identity) await command('docker', ['volume', 'rm', volume], { allowFailure: true });
  }
  await command('docker', ['image', 'rm', hostImage], { allowFailure: true });
  await rm(root, { recursive: true, force: true });
}
