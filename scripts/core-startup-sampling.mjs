import {spawn, spawnSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir, open, readFile, readdir, realpath, rename, stat, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {arch, cpus, platform, release, totalmem} from 'node:os';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {sourceInputHash} from './build-docker-release.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const fixtureMarkerSuffix = '.piwork-startup-fixture.json';
const stages = ['ui', 'agent', 'service', 'ready'];

export function nearestRank(values, percentile) {
  if (!values.length || !Number.isFinite(percentile) || percentile <= 0 || percentile > 1 || values.some(v => !Number.isFinite(v) || v < 0)) throw new Error('invalid sample values');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(percentile * sorted.length) - 1];
}

// Never replace a failed or timed-out sample with a later run. Percentiles are
// informative even for a failed group; acceptance requires every sample.
export function summarize(samples, minimum, thresholdMs, requireEnvironment = true) {
  if (!Array.isArray(samples) || !Number.isInteger(minimum) || minimum < 1 || !Number.isFinite(thresholdMs) || thresholdMs <= 0) throw new Error('invalid summary input');
  for (const sample of samples) {
    if (typeof sample.success !== 'boolean' || !Number.isFinite(sample.durationMs) || sample.durationMs < 0) throw new Error('invalid sample');
  }
  const values = samples.map(sample => sample.durationMs);
  const result = {count: samples.length, failures: samples.filter(sample => !sample.success).length, timeouts: samples.filter(sample => sample.reason === 'timeout').length};
  if (values.length) Object.assign(result, {p50Ms: nearestRank(values, .5), p95Ms: nearestRank(values, .95), maxMs: Math.max(...values)});
  result.passed = samples.length >= minimum && result.failures === 0 && result.p95Ms <= thresholdMs && samples.every(sample => {
    const c = sample.counts;
    return c && c.imageExport === 0 && c.imageScan === 0 && c.environmentProbe === 0 && c.agentHit > 0 && c.fileHit > 0 && c.snapshotHit > 0 && (!requireEnvironment || c.environmentHit > 0) && c.startupDocker > 0 && c.workVerified > 0;
  });
  return result;
}

// Every endpoint must succeed in the same observation. First-success stage
// timings are reported separately and are never summed to obtain total time.
export async function observeReadiness(probe, {start = performance.now(), timeoutMs, intervalMs = 100, now = () => performance.now(), wait = ms => new Promise(done => setTimeout(done, ms)), signal}) {
  const first = {};
  while (true) {
    const elapsed = now() - start;
    if (signal?.aborted) return {success: false, reason: 'cancelled', durationMs: elapsed, stagesMs: first};
    if (elapsed >= timeoutMs) return {success: false, reason: 'timeout', durationMs: elapsed, stagesMs: first};
    let values = {};
    try { values = await probe(); } catch { /* retain this observation as incomplete */ }
    const observed = now() - start;
    for (const stage of stages) if (values[stage] === true && first[stage] === undefined) first[stage] = observed;
    if (observed <= timeoutMs && stages.every(stage => values[stage] === true)) return {success: true, durationMs: observed, stagesMs: first};
    if (observed >= timeoutMs) return {success: false, reason: 'timeout', durationMs: observed, stagesMs: first};
    await wait(Math.min(intervalMs, timeoutMs - observed));
  }
}

function options(args) {
  const result = {};
  for (let n = 0; n < args.length; n += 2) {
    const key = args[n];
    if (!key?.startsWith('--') || args[n + 1] === undefined || args[n + 1].startsWith('--') || result[key] !== undefined) throw new Error('invalid arguments');
    result[key] = args[n + 1];
  }
  return result;
}

function numberOption(value, minimum, maximum) {
  if (!/^\d+$/.test(value ?? '')) throw new Error('invalid numeric argument');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error('numeric argument out of range');
  return number;
}

async function withinDist(path, {existing = true} = {}) {
  await mkdir(dist, {recursive: true});
  const rootReal = await realpath(dist);
  const absolute = resolve(path);
  const check = existing ? await realpath(absolute) : resolve(await realpath(dirname(absolute)), absolute.split(sep).at(-1));
  const child = relative(rootReal, check);
  if (!child || child.startsWith('..' + sep) || child === '..' || isAbsolute(child)) throw new Error('path must be inside dist');
  return check;
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function git(...args) {
  const value = spawnSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
  return value.status === 0 ? value.stdout.trim() : null;
}

function environment() {
  return {platform: platform(), release: release(), architecture: arch(), cpuCount: cpus().length, memoryBytes: totalmem(), node: process.version};
}

function engineVersion(o) {
  let version = o['--engine-version'];
  if (!version) {
    const result = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']});
    version = result.status === 0 ? result.stdout.trim() : null;
  }
  if (version !== null && !/^[A-Za-z0-9.+_-]{1,64}$/.test(version)) throw new Error('invalid Engine version');
  return version;
}

function imageIDs(o) {
  const images = {};
  for (const [kind, option] of [['agent', '--agent-image-id'], ['agentDefault', '--default-agent-image-id'], ['agentWork', '--work-agent-image-id'], ['file', '--file-image-id'], ['snapshot', '--snapshot-image-id']]) {
    const value = o[option] ?? null;
    if (value !== null && !/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error('invalid immutable image id');
    images[kind] = value;
  }
  return images;
}

function verifyLocalImages(images) {
  for (const id of Object.values(images)) {
    if (id === null) continue;
    const result = spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', id], {encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore']});
    if (result.status !== 0 || result.stdout.trim() !== id) throw new Error('fixture image identity unavailable');
  }
}

export function groupSummary(group) {
  const summary = summarize(group.samples, 20, group.group === 'vm' ? 25000 : 10000, group.environmentMode !== 'none');
  const artifact = group.artifact ?? {}, images = artifact.images ?? {}, env = group.environment ?? {};
  const guest = env.guest ?? {};
  const ids = group.samples.map(sample => sample.sampleId);
  const windowsReference = group.group === 'vm' || artifact.bundleSha256 != null;
  const agentImages = [images.agent, images.agentDefault, images.agentWork];
  const referenceComplete = !windowsReference || /^[a-f0-9]{64}$/.test(artifact.bundleSha256 ?? '') && env.platform === 'win32' && guest.hypervisor === 'WHPX' && guest.vcpu === 2 && guest.memoryMiB === 4096 && agentImages.every(id => /^sha256:[a-f0-9]{64}$/.test(id ?? '')) && new Set(agentImages).size === 3 && group.samples.every(sample => sample.counts?.agentHit >= 3);
  summary.metadataComplete = !group.inputsChanged && /^[a-f0-9]{40,64}$/.test(artifact.commit ?? '') && typeof artifact.dirty === 'boolean' && /^[a-f0-9]{64}$/.test(artifact.binarySha256 ?? '') && /^[a-f0-9]{64}$/.test(artifact.sourceInputHash ?? '') && ['agent', 'file', 'snapshot'].every(kind => /^sha256:[a-f0-9]{64}$/.test(images[kind] ?? '')) && typeof env.engineVersion === 'string' && env.engineVersion.length > 0 && ids.every(id => /^[a-f0-9-]{36}$/.test(id ?? '')) && new Set(ids).size === ids.length && group.samples.every((sample, index) => sample.attempt === index + 1) && referenceComplete;
  summary.passed = summary.passed && summary.metadataComplete;
  return summary;
}

async function writeResult(path, value) {
  const target = await withinDist(path, {existing: false});
  const temporary = target + '.tmp-' + randomUUID();
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
  await rename(temporary, target);
}

async function createResult(path, value) {
  const target = await withinDist(path, {existing: false});
  await writeFile(target, JSON.stringify(value, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
}

async function initFixture(directory) {
  const parent = resolve(directory);
  const child = relative(dist, parent);
  if (!child || child === '..' || child.startsWith('..' + sep) || isAbsolute(child)) throw new Error('fixture must be inside dist');
  await mkdir(parent, {recursive: true});
  const target = await withinDist(parent);
  if ((await readdir(target)).length) throw new Error('fixture directory must be empty');
  // Core requires a recognized data directory, so the marker is a sibling,
  // never a file inside its storage root.
  await writeFile(target + fixtureMarkerSuffix, JSON.stringify({version: 1, fixtureId: randomUUID()}) + '\n', {mode: 0o600, flag: 'wx'});
}

async function ensureFixture(directory) {
  const target = await withinDist(directory);
  const markerPath = await withinDist(target + fixtureMarkerSuffix);
  const marker = JSON.parse(await readFile(markerPath, 'utf8'));
  if (marker.version !== 1 || typeof marker.fixtureId !== 'string' || !/^[a-f0-9-]{36}$/.test(marker.fixtureId)) throw new Error('invalid fixture marker');
  return target;
}

function servicePath(value, work) {
  if (typeof value !== 'string' || !value.startsWith('/services/' + work + '/') || value.includes('?') || value.includes('#') || value.includes('\\') || value.includes('..')) throw new Error('invalid same-origin Service path');
  return value;
}

function endpointOptions(o) {
  const url = new URL(o['--ui']);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('invalid UI origin');
  const work = o['--work'];
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(work ?? '')) throw new Error('invalid Work id');
  const account = process.env[o['--account-env'] ?? 'PIWORK_STARTUP_ACCOUNT'];
  const password = process.env[o['--password-env'] ?? 'PIWORK_STARTUP_PASSWORD'];
  const expected = process.env[o['--expected-env'] ?? 'PIWORK_STARTUP_SERVICE_RESPONSE'];
  if (!account || !password || expected === undefined || Buffer.byteLength(expected) > 65536) throw new Error('fixture account, password and expected Service response are required in environment');
  return {origin: url.origin, work, path: servicePath(o['--service'], work), account, password, expected};
}

function cookieHeader(jar) { return [...jar].map(([key, value]) => key + '=' + value).join('; '); }

export function createStartupProbe(config, signal) {
  const jar = new Map();
  let signedIn = false;
  async function request(path, init = {}) {
    const headers = new Headers(init.headers);
    if (jar.size) headers.set('Cookie', cookieHeader(jar));
    const deadline = AbortSignal.timeout(750);
    const response = await fetch(config.origin + path, {...init, headers, redirect: 'manual', signal: signal ? AbortSignal.any([deadline, signal]) : deadline});
    for (const raw of response.headers.getSetCookie()) {
      const first = raw.split(';', 1)[0];
      const at = first.indexOf('=');
      if (at > 0) {
        const key = first.slice(0, at), value = first.slice(at + 1);
        if (value) jar.set(key, value); else jar.delete(key);
      }
    }
    return response;
  }
  async function login() {
    if (signedIn) return true;
    const challenge = await request('/_web/api/session');
    if (!challenge.ok) return false;
    const value = await challenge.json();
    if (value.authenticated === true) return (signedIn = true);
    if (typeof value.csrfToken !== 'string') return false;
    const result = await request('/_web/api/login', {method: 'POST', headers: {'Content-Type': 'application/json', 'Origin': config.origin, 'X-Piwork-Csrf': value.csrfToken}, body: JSON.stringify({account: config.account, password: config.password})});
    if (!result.ok) return false;
    return (signedIn = (await result.json()).authenticated === true);
  }
  return async () => {
    const [ui, ready] = await Promise.all([
      request('/_web/api/state').then(async r => r.ok && (await r.json()).administratorInitialized === true).catch(() => false),
      request('/readyz?profile=docker-delivery').then(async r => r.ok && (await r.json()).ready === true).catch(() => false),
    ]);
    const authenticated = await login().catch(() => false);
    if (!authenticated) return {ui, agent: false, service: false, ready};
    const [agent, service] = await Promise.all([
      request('/_desktop/api/works/' + config.work + '/sessions').then(async r => r.ok && Array.isArray((await r.json()).sessions)).catch(() => false),
      request(config.path).then(async r => r.ok && (await r.text()) === config.expected).catch(() => false),
    ]);
    return {ui, agent, service, ready};
  };
}

async function portAvailable(port) {
  return new Promise(done => {
    const server = createServer();
    server.once('error', () => done(false));
    server.listen(port, '127.0.0.1', () => server.close(() => done(true)));
  });
}

function emptyCounts() {
  return {imageExport: 0, imageScan: 0, environmentProbe: 0, agentHit: 0, fileHit: 0, snapshotHit: 0, environmentHit: 0, startupDocker: 0, workVerified: 0};
}

function consumeLine(line, counts) {
  if (line.length > 65536) return;
  try {
    const event = JSON.parse(line);
    let phase, outcome;
    if (event.event === 'performance') {
      ({phase, outcome} = event);
    } else if (event.fields && typeof event.fields.phase === 'string' && event.event === 'performance.' + event.fields.phase) {
      ({phase, outcome} = event.fields);
    } else return;
    if (outcome === 'started') {
      if (phase === 'image-export') counts.imageExport++;
      if (phase === 'image-scan') counts.imageScan++;
      if (phase === 'environment-probe-execute') counts.environmentProbe++;
    }
    if (outcome === 'succeeded') {
      if (phase === 'agent-image-persistent-hit') counts.agentHit++;
      if (phase === 'file-image-persistent-hit') counts.fileHit++;
      if (phase === 'snapshot-image-persistent-hit') counts.snapshotHit++;
      if (phase === 'environment-persistent-hit') counts.environmentHit++;
      if (phase === 'startup-docker') counts.startupDocker++;
      if (phase === 'work-verification') counts.workVerified++;
    }
  } catch { /* unrelated console output is intentionally not copied */ }
}

function consumePerformance(child, counts) {
  let pending = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop().slice(-65536);
    for (const line of lines) consumeLine(line, counts);
  });
}

async function stopChild(child, exited) {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  let timer;
  const result = await Promise.race([exited, new Promise(done => { timer = setTimeout(() => done(null), 70000); })]);
  clearTimeout(timer);
  if (result === null) {
    child.kill('SIGKILL');
    await exited;
    return false;
  }
  return result.code === 0 && result.signal === null;
}

// Explicitly requested against an isolated test installation after timing.
// This uses the public authenticated log export rather than a VM control pipe.
async function exportCoreLogs(o) {
  const url = new URL(o['--core']);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('invalid Core origin');
  const account = process.env[o['--account-env'] ?? 'PIWORK_STARTUP_ACCOUNT'];
  const password = process.env[o['--password-env'] ?? 'PIWORK_STARTUP_PASSWORD'];
  if (!account || !password) throw new Error('test administrator credentials required');
  const timeoutMs = o['--timeout-ms'] === undefined ? 120000 : numberOption(o['--timeout-ms'], 1000, 300000);
  const target = await withinDist(o['--output'], {existing: false});
  const file = await open(target, 'wx', 0o600);
  try {
    const deadline = performance.now() + timeoutMs;
    async function request(path, method = 'GET', body, token, maxWaitMs = 10000) {
      const remaining = Math.floor(deadline - performance.now());
      if (remaining <= 0) throw new Error('log export timed out');
      return fetch(url.origin + path, {method, headers: {
        ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
        ...(token ? {Authorization: `Bearer ${token}`} : {}),
      }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(Math.min(remaining, maxWaitMs))});
    }
    const login = await request('/api/v1/login', 'POST', {account, password});
    if (login.status !== 200) throw new Error('test login failed');
    const token = (await login.json()).token;
    if (typeof token !== 'string' || !token) throw new Error('test login failed');
    const accepted = await request('/api/v1/log-exports', 'POST', {idempotencyKey: randomUUID()}, token);
    if (accepted.status !== 202) throw new Error('log export was not accepted');
    const id = (await accepted.json()).exportId;
    if (!/^log-export-[A-Za-z0-9-]{16,128}$/.test(id ?? '')) throw new Error('invalid log export identity');
    let result;
    while (performance.now() < deadline) {
      const response = await request('/api/v1/log-exports/' + encodeURIComponent(id), 'GET', undefined, token);
      if (response.status !== 200) throw new Error('log export status unavailable');
      const view = await response.json();
      if (view.state === 'ready') { result = view.result; break; }
      if (['failed', 'interrupted', 'expired'].includes(view.state)) throw new Error('log export did not complete');
      await new Promise(done => setTimeout(done, 150));
    }
    if (!result || !Number.isSafeInteger(result.size) || result.size < 0 || result.size > (1 << 30) || !/^[a-f0-9]{64}$/.test(result.digest ?? '')) throw new Error('invalid log export result');
    const response = await request('/api/v1/log-exports/' + encodeURIComponent(id) + '/content', 'GET', undefined, token, timeoutMs);
    if (response.status !== 200 || response.headers.get('content-type') !== 'application/zip' || response.headers.get('x-piwork-sha256') !== result.digest || Number(response.headers.get('content-length')) !== result.size || !response.body) throw new Error('log export download identity mismatch');
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > result.size) throw new Error('log export exceeds its size');
      hash.update(chunk);
      await file.writeFile(chunk);
    }
    if (size !== result.size || hash.digest('hex') !== result.digest) throw new Error('log export content mismatch');
    await file.sync();
  } finally {
    await file.close();
  }
  process.stdout.write('isolated Core log export saved\n');
  return true;
}

async function sampleCore(o) {
  const directory = await ensureFixture(o['--data-dir']);
  const binary = await realpath(o['--core-bin']);
  const uiPort = numberOption(o['--ui-port'], 1, 65535), corePort = numberOption(o['--core-port'], 1, 65535);
  const count = numberOption(o['--samples'], 1, 1000), timeoutMs = numberOption(o['--timeout-ms'], 1000, 600000);
  if (uiPort === corePort || uiPort === 7172 || corePort === 7172) throw new Error('ports must be distinct');
  const config = endpointOptions({...o, '--ui': 'http://127.0.0.1:' + uiPort});
  const environmentMode = o['--environment'] ?? 'required';
  if (!['required', 'none'].includes(environmentMode)) throw new Error('invalid environment mode');
  const group = o['--group'] ?? 'core';
  if (!['core', 'cold'].includes(group)) throw new Error('invalid group');
  const gitStatus = git('status', '--porcelain');
  const artifact = {commit: git('rev-parse', 'HEAD'), dirty: gitStatus === null ? null : gitStatus.length > 0, sourceInputHash: sourceInputHash(root), binarySha256: await sha256(binary), images: imageIDs(o)};
  verifyLocalImages(artifact.images);
  const result = {version: 1, group, environment: {...environment(), engineVersion: engineVersion(o)}, environmentMode, artifact, samples: []};
  await createResult(o['--output'], result);
  for (let index = 0; index < count; index++) {
    const counts = emptyCounts();
    const sampleId = randomUUID();
    result.samples.push({sampleId, attempt: index + 1, success: false, reason: 'interrupted', durationMs: 0, stagesMs: {}, counts});
    await writeResult(o['--output'], result);
    let sample;
    if (await sha256(binary) !== artifact.binarySha256 || sourceInputHash(root) !== artifact.sourceInputHash) {
      sample = {success: false, reason: 'artifact-changed', durationMs: 0, stagesMs: {}, counts};
      result.inputsChanged = true;
    } else if (!await portAvailable(uiPort) || !await portAvailable(corePort)) {
      sample = {success: false, reason: 'port-unavailable', durationMs: 0, stagesMs: {}, counts};
    } else {
      const start = performance.now();
      const child = spawn(binary, ['--data-dir', directory, '--ui-port', String(uiPort), '--core-port', String(corePort)], {stdio: ['ignore', 'ignore', 'pipe'], env: process.env});
      consumePerformance(child, counts);
      const exited = new Promise(done => { child.once('error', () => done({code: -1, signal: null})); child.once('close', (code, signal) => done({code, signal})); });
      const abort = new AbortController();
      const observation = observeReadiness(createStartupProbe(config, abort.signal), {start, timeoutMs, signal: abort.signal});
      const premature = exited.then(() => ({success: false, reason: 'process-exited', durationMs: performance.now() - start, stagesMs: {}}));
      sample = await Promise.race([observation, premature]);
      abort.abort();
      await observation;
      const clean = await stopChild(child, exited);
      if (!clean && sample.success) sample = {...sample, success: false, reason: 'shutdown-failed'};
      sample.counts = counts;
    }
    result.samples[index] = {sampleId, attempt: index + 1, ...sample};
    result.summary = groupSummary(result);
    await writeResult(o['--output'], result);
    process.stdout.write(`sample ${index + 1}/${count}: ${sample.success ? 'success' : sample.reason}\n`);
  }
  if (await sha256(binary) !== artifact.binarySha256 || sourceInputHash(root) !== artifact.sourceInputHash) {
    result.inputsChanged = true;
    result.summary = groupSummary(result);
    await writeResult(o['--output'], result);
  }
  return group === 'cold' ? !result.inputsChanged && result.samples.every(sample => sample.success) : result.summary.passed;
}

// The external controller signals stdin immediately before launching an
// isolated VM. This process observes HTTP and a new console log only; it does
// not connect to, stop, restart, or otherwise manage the VM control channel.
async function observeExternal(o, group) {
  const config = endpointOptions(o);
  const timeoutMs = numberOption(o['--timeout-ms'], 1000, 600000);
  const metricsTimeoutMs = o['--metrics-timeout-ms'] === undefined ? 5000 : numberOption(o['--metrics-timeout-ms'], 1000, 300000);
  const environmentMode = o['--environment'] ?? 'required';
  if (!['required', 'none'].includes(environmentMode)) throw new Error('invalid environment mode');
  const binarySha256 = o['--artifact-sha256'], bundleSha256 = o['--bundle-sha256'], commit = o['--commit'], dirty = o['--dirty'];
  if (!/^[a-f0-9]{64}$/.test(binarySha256 ?? '') || !/^[a-f0-9]{64}$/.test(bundleSha256 ?? '') || !/^[a-f0-9]{40,64}$/.test(commit ?? '') || !['true', 'false'].includes(dirty)) throw new Error('frozen artifact identity required');
  const consolePath = await withinDist(o['--log']);
  const initial = await stat(consolePath);
  if (!initial.isFile() || initial.size !== 0) throw new Error('a new isolated console log is required for every sample');
  const sampleId = randomUUID();
  const hypervisor = o['--hypervisor'] ?? null;
  if (hypervisor !== null && !/^[A-Za-z0-9_-]{1,32}$/.test(hypervisor)) throw new Error('invalid hypervisor');
  const guest = {hypervisor, vcpu: o['--vcpu'] ? numberOption(o['--vcpu'], 1, 1024) : null, memoryMiB: o['--memory-mib'] ? numberOption(o['--memory-mib'], 128, 1048576) : null};
  const inputHash = o['--source-input-sha256'] ?? null;
  if (inputHash !== null && !/^[a-f0-9]{64}$/.test(inputHash)) throw new Error('invalid source input hash');
  const result = {version: 1, group, environment: {...environment(), engineVersion: engineVersion(o), guest}, environmentMode, artifact: {commit, dirty: dirty === 'true', sourceInputHash: inputHash, binarySha256, bundleSha256, images: imageIDs(o)}, samples: [{sampleId, attempt: 1, success: false, reason: 'not-started', durationMs: 0, stagesMs: {}, counts: emptyCounts()}]};
  await createResult(o['--output'], result);
  const health = await fetch(config.origin + '/healthz', {signal: AbortSignal.timeout(750)}).then(r => r.ok).catch(() => false);
  if (health) throw new Error('the observed VM is already running');
  // The controller waits for this handshake, signals start, then waits for
  // start-recorded before starting its isolated launcher. This prevents any
  // work before the observer's monotonic timestamp from being left out.
  process.stdout.write('ready-for-start\n');
  await new Promise((done, reject) => {
    const ended = () => reject(new Error('start signal missing'));
    process.stdin.once('data', () => {
      process.stdin.pause();
      process.stdin.removeListener('end', ended);
      process.stdin.destroy();
      done();
    });
    process.stdin.once('end', ended);
    process.stdin.resume();
  });
  const start = performance.now();
  process.stdout.write('start-recorded\n');
  result.samples[0].reason = 'interrupted';
  await writeResult(o['--output'], result);
  const sample = await observeReadiness(createStartupProbe(config), {start, timeoutMs});
  if (sample.success) process.stdout.write('readiness-observed\n');
  const counts = emptyCounts();
  // The log belongs to the new isolated launcher and must remain the same
  // file. Allow its final pre-readiness lines to be flushed after measurement.
  const metricsDeadline = performance.now() + metricsTimeoutMs;
  while (performance.now() < metricsDeadline) {
    const current = await stat(consolePath);
    if (current.dev !== initial.dev || current.ino !== initial.ino || current.size > 16 * 1024 * 1024) break;
    const raw = await readFile(consolePath, 'utf8');
    const observed = emptyCounts();
    for (const line of raw.split('\n')) consumeLine(line, observed);
    Object.assign(counts, observed);
    if (counts.startupDocker > 0 && counts.workVerified > 0 && counts.agentHit >= 3 && counts.fileHit > 0 && counts.snapshotHit > 0 && (environmentMode === 'none' || counts.environmentHit > 0)) break;
    await new Promise(done => setTimeout(done, 250));
  }
  if (sample.success && (!counts.startupDocker || !counts.workVerified || counts.agentHit < 3 || !counts.fileHit || !counts.snapshotHit || environmentMode === 'required' && !counts.environmentHit)) {
    sample.success = false;
    sample.reason = 'metrics-unconfirmed';
  }
  result.samples[0] = {sampleId, attempt: 1, ...sample, counts};
  result.summary = groupSummary(result);
  await writeResult(o['--output'], result);
  process.stdout.write(`${group} sample: ${sample.success ? 'success' : sample.reason}\n`);
  return sample.success;
}

async function combineSamples(o, onlyVM = false) {
  const names = (o['--inputs'] ?? '').split(',');
  if (!names.length || names.some(name => !name) || names.length > 1000) throw new Error('invalid inputs');
  const files = await Promise.all(names.map(name => withinDist(name)));
  if (new Set(files).size !== files.length) throw new Error('duplicate input');
  const groups = await Promise.all(files.map(async file => JSON.parse(await readFile(file, 'utf8'))));
  const first = groups[0];
  if (first.version !== 1 || !['vm', 'core'].includes(first.group) || onlyVM && first.group !== 'vm') throw new Error('invalid external sample');
  const samples = [], ids = new Set();
  for (const group of groups) {
    if (group.version !== 1 || group.group !== first.group || group.environmentMode !== first.environmentMode || JSON.stringify(group.environment) !== JSON.stringify(first.environment) || JSON.stringify(group.artifact) !== JSON.stringify(first.artifact) || !Array.isArray(group.samples) || group.samples.length !== 1) throw new Error('sample identities differ');
    const sample = group.samples[0];
    if (!/^[a-f0-9-]{36}$/.test(sample.sampleId ?? '') || ids.has(sample.sampleId)) throw new Error('duplicate sample');
    ids.add(sample.sampleId);
    samples.push({...sample, attempt: samples.length + 1});
  }
  const result = {...first, samples};
  result.summary = groupSummary(result);
  await createResult(o['--output'], result);
  process.stdout.write(JSON.stringify(result.summary) + '\n');
  return result.summary.passed;
}

async function main(argv) {
  const [command, ...rest] = argv;
  const o = options(rest);
  if (command === 'init') {
    await initFixture(o['--data-dir']);
    process.stdout.write('isolated fixture created\n');
    return true;
  }
  if (command === 'sample-core') return sampleCore(o);
  if (command === 'export-log') return exportCoreLogs(o);
  if (command === 'observe-vm') return observeExternal(o, 'vm');
  if (command === 'observe-core') return observeExternal(o, 'core');
  if (command === 'combine-vm') return combineSamples(o, true);
  if (command === 'combine-samples') return combineSamples(o);
  if (command === 'summarize') {
    const input = await withinDist(o['--input']);
    const value = JSON.parse(await readFile(input, 'utf8'));
    if (!['core', 'vm'].includes(value.group) || !Array.isArray(value.samples)) throw new Error('invalid sample group');
    const summary = groupSummary(value);
    process.stdout.write(JSON.stringify(summary) + '\n');
    return summary.passed;
  }
  throw new Error('unknown sampling command');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(ok => { if (!ok) process.exitCode = 1; }).catch(() => { process.stderr.write('startup sampling failed: invalid input or isolated execution error\n'); process.exitCode = 1; });
}
