import {operatorAPI} from './native-test-core-api.mjs';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { sourceInputHash } from './build-docker-release.mjs';

const options = { core: 'dist/go/piwork-core', cli: 'dist/go/piwork-cli', image: '', mode: 'api', samples: 20, output: 'dist/work-latency/result.json', baseline: false, smoke: false };
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i].replace(/^--/, '');
  assert.ok(Object.hasOwn(options, flag), 'Unknown measurement option');
  if (typeof options[flag] === 'boolean') options[flag] = true;
  else { assert.ok(process.argv[i + 1], 'Missing measurement option value'); options[flag] = flag === 'samples' ? Number(process.argv[++i]) : process.argv[++i]; }
}
assert.ok(['api', 'browser', 'both'].includes(options.mode), 'Invalid measurement mode');
assert.ok(Number.isInteger(options.samples) && options.samples >= (options.smoke ? 1 : 20), 'Full measurement requires at least 20 samples');
const coreBinary = resolve(options.core), cliBinary = resolve(options.cli);
const dockerHost = process.env.PIWORK_TEST_DOCKER_HOST || 'unix:///var/run/docker.sock';
const root = await mkdtemp(join(process.env.PIWORK_TEST_DATA_ROOT || tmpdir(), 'piwork-latency-'));
const dataDir = join(root, 'core');
const childEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PIWORK_') && !['DOCKER_CONTEXT', 'DOCKER_CONFIG'].includes(key)));
const password = 'latency-fixture-password';
const events = [], failures = [];
let core, desktop, installationId, coreUrl, token;
let desktopText = '';
let measuringPhase = 'setup', measuringSample;
const children = [];
const report = { version: 1, baseline: options.baseline, smoke: options.smoke, samplesRequested: options.samples, mode: options.mode, failures };

function docker(args) {
  const result = spawnSync('docker', ['--host', dockerHost, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, 'Docker measurement fixture command failed');
  return result.stdout.trim();
}
async function freePort() {
  const server = createServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}
async function waitFor(check, label, timeout = 180_000, interval = 100) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const value = await check();
    if (value) return value;
    assert.ok(!core || core.exitCode === null, 'Core exited during measurement');
    await new Promise(done => setTimeout(done, interval));
  }
  throw new Error(label);
}
async function api(method, path, body) {
  const response = await fetch(coreUrl + path, { method, headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(180_000) });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}
function collectPerformance(child) {
  let pending = '';
  child.stdout.on('data', () => {});
  child.stderr.on('data', chunk => {
    pending += chunk.toString();
    let at;
    while ((at = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, at); pending = pending.slice(at + 1);
      let value;
      try { value = JSON.parse(line); } catch { continue; }
      if (value.event !== 'performance' || !Number.isFinite(value.durationMs) || value.durationMs < 0) continue;
      const safe = {};
      for (const key of ['timestamp', 'event', 'phase', 'outcome', 'durationMs', 'cacheState', 'correlationId', 'preparationCorrelationId', 'workId', 'operationId']) if (value[key] !== undefined) safe[key] = value[key];
      events.push(safe);
    }
    if (pending.length > 64 * 1024) pending = '';
  });
}
function preparationCounts() {
  const completed = events.filter(e => e.cacheState === 'prepare' && e.outcome === 'succeeded');
  return { imageChecks: completed.filter(e => e.phase === 'image-inspection').length, environmentProbes: completed.filter(e => e.phase === 'environment-probe').length };
}
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, p50Ms: sorted.length ? sorted[Math.ceil(sorted.length * .50) - 1] : null, p95Ms: sorted.length ? sorted[Math.ceil(sorted.length * .95) - 1] : null, maxMs: sorted.at(-1) ?? null };
}
async function workReady(id) {
  return waitFor(async () => { const value = await api('GET', `/api/v1/works/${id}`); assert.equal(value.status, 200, 'Work observation failed'); assert.notEqual(value.data.observedState, 'failed', 'Work initialization failed'); return value.data.observedState === 'ready'; }, 'Work readiness timeout');
}
async function lifecycle(id, action) {
  const value = await api('POST', `/api/v1/works/${id}/${action}`, { idempotencyKey: randomUUID() });
  assert.equal(value.status, 202, 'Lifecycle fixture action was not accepted');
  await waitFor(async () => { const state = (await api('GET', `/api/v1/operations/${value.data.operationId}`)).data.state; assert.ok(!['failed', 'superseded'].includes(state), 'Lifecycle fixture action failed'); return state === 'succeeded'; }, 'Lifecycle completion timeout');
}
async function retire(id) { await lifecycle(id, 'stop'); await lifecycle(id, 'delete'); }
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await new Promise(done => {
    const timer = setTimeout(done, 45_000); timer.unref();
    child.once('exit', () => { clearTimeout(timer); done(); });
  });
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); failures.push({ phase: 'shutdown', code: 'SHUTDOWN_UNCONFIRMED' }); }
}
async function cleanup() {
  for (const child of [...children].reverse()) await stop(child);
  if (!installationId) { try { installationId = JSON.parse(await readFile(join(dataDir, 'core-format.json'), 'utf8')).installationId; } catch { return; } }
  assert.match(installationId, /^[A-Za-z0-9-]+$/);
  const filter = `label=piwork.installation_id=${installationId}`;
  for (const [list, inspect, remove] of [
    [['ps', '-aq', '--filter', filter], id => ['inspect', '--format', '{{index .Config.Labels "piwork.installation_id"}}', id], id => ['rm', '-f', id]],
    [['network', 'ls', '-q', '--filter', filter], id => ['network', 'inspect', '--format', '{{index .Labels "piwork.installation_id"}}', id], id => ['network', 'rm', id]],
    [['volume', 'ls', '-q', '--filter', filter], id => ['volume', 'inspect', '--format', '{{index .Labels "piwork.installation_id"}}', id], id => ['volume', 'rm', id]],
  ]) {
    for (const id of docker(list).split('\n').filter(Boolean)) { assert.equal(docker(inspect(id)), installationId, 'Cleanup identity mismatch'); docker(remove(id)); }
    assert.equal(docker(list), '', 'Owned fixture resources remain');
  }
  report.cleanupConfirmed = true;
  await rm(root, { recursive: true, force: true });
}

try {
  const engine = JSON.parse(docker(['info', '--format', '{{json .}}']));
  const build = spawnSync('go', ['version', '-m', coreBinary], { encoding: 'utf8' });
  const buildSettings = Object.fromEntries([...build.stdout.matchAll(/build\s+(vcs\.[a-z]+|CGO_ENABLED|GOARCH|GOOS)=([^\n]+)/g)].map(m => [m[1], m[2].trim()]));
  const sourceRoot = resolve(import.meta.dirname, '..');
  const sourceCommit = spawnSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const sourceStatus = spawnSync('git', ['-C', sourceRoot, 'status', '--porcelain'], { encoding: 'utf8' });
  assert.equal(sourceCommit.status, 0, 'Source commit metadata unavailable'); assert.equal(sourceStatus.status, 0, 'Source status metadata unavailable');
  report.environment = { os: platform(), kernel: release(), cpuCount: cpus().length, cpuModel: cpus()[0]?.model, memoryBytes: totalmem(), dockerDriver: engine.Driver, dockerCpuCount: engine.NCPU, dockerMemoryBytes: engine.MemTotal,
    agentVariant: 'production', agentCpuMillis: 1000, agentMemoryBytes: 768 * 1024 * 1024, concurrentSamples: 1, buildSettings,
    checkoutAtMeasurement: { commit: sourceCommit.stdout.trim(), modified: sourceStatus.stdout.trim() !== '', sourceInputHash: sourceInputHash(sourceRoot) },
    sourceNote: 'Checkout metadata describes the measurement workspace; a baseline binary may have different compiler inputs. Binary VCS settings are retained separately when embedded.' };
  const [corePort, uiPort] = await Promise.all([freePort(), freePort()]);
  coreUrl = `http://127.0.0.1:${corePort}`;
  const coldStart = performance.now();
  core=spawn(coreBinary,['--data-dir',dataDir,'--ui-port',String(uiPort),'--core-port',String(corePort)],{stdio:['ignore','pipe','pipe'],env:{...childEnvironment,DOCKER_HOST:dockerHost,PATH:'/nonexistent'}});
  children.push(core); collectPerformance(core);
  await waitFor(async () => { try { return (await fetch(coreUrl + '/healthz')).ok; } catch { return false; } }, 'Core health timeout');
  const control=await operatorAPI(coreUrl,dataDir);
  await control('POST','admin/bootstrap',{account:'admin',password});
  await control('PUT','runtime',{provider:'openai',model:'gpt-4.1-mini',credential:'latency-fixture-key'});
  const fixedImage=(await control('GET','runtime')).agentImage;
  if(options.image)assert.equal(fixedImage,options.image,'--image asserts the measured server dependency; it cannot override it');
  const image=JSON.parse(docker(['image','inspect',fixedImage,'--format','{{json .}}']));
  assert.equal(image.Config.Labels['io.piwork.agent.variant'],'production','Performance measurement requires the production Agent');
  Object.assign(report.environment,{agentImage:fixedImage,imageBytes:image.Size,imageVersion:image.Config.Labels['io.piwork.agent.version'],historySchema:image.Config.Labels['io.piwork.work-history.schema']});
  await waitFor(async () => (await fetch(coreUrl + '/readyz')).ok, 'Core prewarm timeout', 600_000);
  report.coldCorePreparationMs = performance.now() - coldStart;
  installationId = JSON.parse(await readFile(join(dataDir, 'core-format.json'), 'utf8')).installationId;
  const login = await api('POST', '/api/v1/login', { account: 'admin', password });
  assert.equal(login.status, 200, 'Fixture login failed'); token = login.data.token;
  assert.equal(typeof token, 'string', 'Fixture login has no token');
  const warmedCounts = preparationCounts();
  if (!options.baseline) assert.ok(warmedCounts.imageChecks > 0 && warmedCounts.environmentProbes > 0, 'Default prewarm was not observable');
  report.prewarm = options.baseline ? null : warmedCounts;
  if (options.mode !== 'browser') {
    measuringPhase = 'api';
    const samples = []; report.api = { samples };
    for (let i = 0; i < options.samples; i++) {
      measuringSample = i + 1;
      const start = performance.now();
      const created = await api('POST', '/api/v1/works', { name: `Latency API ${i + 1}`, idempotencyKey: randomUUID() });
      const accepted = performance.now();
      assert.equal(created.status, 202, 'Create was not accepted');
      await workReady(created.data.workId);
      const ready = performance.now();
      samples.push({ index: i + 1, acceptanceMs: accepted - start, afterAcceptanceMs: ready - accepted, totalMs: ready - start });
      if (i === 0) {
        await lifecycle(created.data.workId, 'stop');
        const restartStart = performance.now();
        await lifecycle(created.data.workId, 'start');
        await workReady(created.data.workId);
        report.retainedStartMs = performance.now() - restartStart;
      }
      await retire(created.data.workId);
      console.log(JSON.stringify({ phase: 'api', sample: i + 1, acceptanceMs: samples.at(-1).acceptanceMs, afterAcceptanceMs: samples.at(-1).afterAcceptanceMs }));
    }
    report.api = { samples, acceptance: summary(samples.map(s => s.acceptanceMs)), afterAcceptance: summary(samples.map(s => s.afterAcceptanceMs)), total: summary(samples.map(s => s.totalMs)) };
  }
  if (options.mode !== 'api') {
    measuringPhase = 'browser'; measuringSample = undefined;
    report.browser = { samples: [] };
    const port = await freePort();
    desktop = spawn(cliBinary, ['--core', coreUrl, 'desktop', '--port', String(port), '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...childEnvironment, PATH: '/nonexistent', PIWORK_CONFIG_PATH: join(root, 'client.json') } });
    children.push(desktop);
    desktop.stdout.on('data', chunk => { desktopText = (desktopText + chunk.toString()).slice(-6000); });
    desktop.stderr.on('data', chunk => { desktopText = (desktopText + chunk.toString()).slice(-6000); });
    const launchUrl = await waitFor(() => desktopText.match(/http:\/\/desktop\.localhost:\d+\//)?.[0], 'Desktop launch timeout', 10_000);
    const { measureBrowserCreates } = await import('../apps/desktop-webui/test/work-latency.mjs');
    const samples = await measureBrowserCreates({ launchUrl, password, count: options.samples, retire, onSample: value => { measuringSample = value.index; report.browser.samples.push(value); console.log(JSON.stringify({ phase: 'browser', ...value })); } });
    report.browser = { samples, total: summary(samples.map(s => s.totalMs)) };
  }
  await new Promise(done => setTimeout(done, 100));
  const finished = preparationCounts();
  report.hotPathPreparation = options.baseline ? null : { imageChecks: finished.imageChecks - warmedCounts.imageChecks, environmentProbes: finished.environmentProbes - warmedCounts.environmentProbes };
  // Only allowlisted performance fields are retained, not raw process output.
  report.performanceEvents = events;
  if (!options.baseline) {
    measuringPhase = 'budgets'; measuringSample = undefined;
    assert.deepEqual(report.hotPathPreparation, { imageChecks: 0, environmentProbes: 0 }, 'Hot path repeated full preparation');
    if (report.api) { assert.ok(report.api.acceptance.p95Ms <= 1000, 'Acceptance P95 exceeds 1 second'); assert.ok(report.api.afterAcceptance.p95Ms <= 3000, 'Ready P95 exceeds 3 seconds'); }
    if (report.browser) assert.ok(report.browser.total.p95Ms <= 6000, 'Browser P95 exceeds 6 seconds');
  }
  report.passed = true;
} catch (error) {
  failures.push({ phase: measuringPhase, sample: measuringSample, code: error instanceof assert.AssertionError ? 'ASSERTION_FAILED' : 'MEASUREMENT_FAILED', message: String(error.message).replace(/(?:\/[A-Za-z0-9_.-]+){2,}/g, '[path]').replace(/sha256:[a-f0-9]+/g, '[digest]').replace(/([?&#](?:ticket|token|key)=)[^&\s]+/gi, '$1[redacted]').slice(0, 180) });
  report.passed = false;
  process.exitCode = 1;
} finally {
  if (report.api && !report.api.acceptance) Object.assign(report.api, { acceptance: summary(report.api.samples.map(s => s.acceptanceMs)), afterAcceptance: summary(report.api.samples.map(s => s.afterAcceptanceMs)), total: summary(report.api.samples.map(s => s.totalMs)) });
  if (report.browser && !report.browser.total) report.browser.total = summary(report.browser.samples.map(s => s.totalMs));
  try { await cleanup(); } catch { report.cleanupConfirmed = false; failures.push({ phase: 'cleanup', code: 'CLEANUP_UNCONFIRMED' }); process.exitCode = 1; }
  report.performanceEvents = events;
  await mkdir(dirname(resolve(options.output)), { recursive: true });
  await writeFile(resolve(options.output), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ passed: report.passed, cleanupConfirmed: report.cleanupConfirmed, api: report.api && { acceptance: report.api.acceptance, afterAcceptance: report.api.afterAcceptance }, browser: report.browser?.total, hotPathPreparation: report.hotPathPreparation, failures }));
}
