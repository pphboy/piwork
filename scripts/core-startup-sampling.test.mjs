import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash, randomUUID} from 'node:crypto';
import {execFile, spawn} from 'node:child_process';
import {appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {promisify} from 'node:util';
import {createStartupProbe, groupSummary, nearestRank, observeReadiness, summarize} from './core-startup-sampling.mjs';

const counts = () => ({imageExport: 0, imageScan: 0, environmentProbe: 0, agentHit: 1, fileHit: 1, snapshotHit: 1, environmentHit: 1, startupDocker: 1, workVerified: 1});

test('nearest rank includes each failed observation and applies the fixed acceptance boundary', () => {
  const samples = Array.from({length: 20}, (_, n) => ({success: true, durationMs: (n + 1) * 500, counts: counts()}));
  assert.equal(nearestRank(samples.map(s => s.durationMs), .5), 5000);
  assert.equal(nearestRank(samples.map(s => s.durationMs), .95), 9500);
  assert.deepEqual(summarize(samples, 20, 10000), {count: 20, failures: 0, timeouts: 0, p50Ms: 5000, p95Ms: 9500, maxMs: 10000, passed: true});
  samples[2] = {...samples[2], success: false, reason: 'timeout', durationMs: 30000};
  assert.equal(summarize(samples, 20, 10000).passed, false);
  assert.equal(summarize(samples, 20, 10000).timeouts, 1);
  assert.equal(summarize(samples, 20, 10000).maxMs, 30000);
  assert.equal(summarize(samples.slice(0, 19), 20, 10000).passed, false);
  assert.throws(() => nearestRank([], .95));
});

test('acceptance requires evidence of persistent hits, completed Work verification and zero heavy operations', () => {
  const samples = Array.from({length: 20}, () => ({success: true, durationMs: 5000, counts: counts()}));
  delete samples[0].counts.fileHit;
  assert.equal(summarize(samples, 20, 10000).passed, false);
  samples[0].counts.fileHit = 1;
  samples[0].counts.environmentProbe = 1;
  assert.equal(summarize(samples, 20, 10000).passed, false);
  samples[0].counts.environmentProbe = 0;
  samples[0].counts.environmentHit = 0;
  assert.equal(summarize(samples, 20, 10000).passed, false);
  assert.equal(summarize(samples, 20, 10000, false).passed, true);
});

test('group verdict requires frozen identities, unique samples and the Windows reference environment', () => {
  const samples = Array.from({length: 20}, (_, index) => ({sampleId: randomUUID(), attempt: index + 1, success: true, durationMs: 5000, counts: {...counts(), agentHit: 3}}));
  const id = 'sha256:' + 'a'.repeat(64);
  const agentDefault = 'sha256:' + 'b'.repeat(64), agentWork = 'sha256:' + 'c'.repeat(64);
  const group = {group: 'vm', environmentMode: 'required', environment: {platform: 'win32', engineVersion: '28.0.0', guest: {hypervisor: 'WHPX', vcpu: 2, memoryMiB: 4096}}, artifact: {commit: 'b'.repeat(40), dirty: true, sourceInputHash: 'e'.repeat(64), binarySha256: 'c'.repeat(64), bundleSha256: 'd'.repeat(64), images: {agent: id, agentDefault, agentWork, file: id, snapshot: id}}, samples};
  assert.equal(groupSummary(group).passed, true);
  for (const sample of group.samples) sample.durationMs = 25000;
  assert.equal(groupSummary(group).passed, true, 'the owner-approved VM P95 budget is inclusive at 25 seconds');
  group.samples[0].durationMs = 25001;
  assert.equal(groupSummary(group).passed, true, 'nearest-rank P95 preserves a single slow maximum');
  group.samples[1].durationMs = 25001;
  assert.equal(groupSummary(group).passed, false, 'a P95 above 25 seconds still fails');
  for (const sample of group.samples) sample.durationMs = 22000;
  group.samples[0].success = false;
  assert.equal(groupSummary(group).passed, false, 'a failure cannot pass under the revised time budget');
  group.samples[0].success = true;
  group.group = 'core';
  assert.equal(groupSummary(group).passed, false, 'the Core budget remains 10 seconds');
  for (const sample of group.samples) sample.durationMs = 10000;
  assert.equal(groupSummary(group).passed, true);
  group.samples[0].durationMs = group.samples[1].durationMs = 10001;
  assert.equal(groupSummary(group).passed, false, 'the Core P95 limit remains enforced');
  for (const sample of group.samples) sample.durationMs = 5000;
  group.group = 'vm';
  group.artifact.images.agentWork = agentDefault;
  assert.equal(groupSummary(group).passed, false, 'three distinct Agent images are required');
  group.artifact.images.agentWork = agentWork;
  group.samples[0].counts.agentHit = 2;
  assert.equal(groupSummary(group).passed, false, 'every reference restart needs three persistent Agent hits');
  group.samples[0].counts.agentHit = 3;
  group.group = 'core';
  group.environment.platform = 'linux';
  assert.equal(groupSummary(group).passed, false, 'a bundled Core restart must use the Windows reference environment');
  group.environment.platform = 'win32';
  assert.equal(groupSummary(group).passed, true);
  group.group = 'vm';
  group.samples[19].sampleId = group.samples[0].sampleId;
  assert.equal(groupSummary(group).passed, false);
  group.samples[19].sampleId = randomUUID();
  group.environment.guest.vcpu = 4;
  assert.equal(groupSummary(group).passed, false);
  group.environment.guest.vcpu = 2;
  group.artifact.images.file = null;
  assert.equal(groupSummary(group).passed, false);
});

test('common endpoint requires all stages together; stage durations are not summed', async () => {
  let clock = 0, call = 0;
  const observations = [
    {ui: true, agent: false, service: false, ready: false},
    {ui: false, agent: true, service: true, ready: true},
    {ui: true, agent: true, service: true, ready: true},
  ];
  const result = await observeReadiness(async () => observations[call++], {start: 0, timeoutMs: 1000, now: () => clock, wait: async ms => { clock += ms; }});
  assert.equal(result.success, true);
  assert.equal(result.durationMs, 200);
  assert.deepEqual(result.stagesMs, {ui: 0, agent: 100, service: 100, ready: 100});
  assert.notEqual(result.durationMs, Object.values(result.stagesMs).reduce((a, b) => a + b));
  clock = 0;
  const timeout = await observeReadiness(async () => ({ui: true}), {start: 0, timeoutMs: 250, now: () => clock, wait: async ms => { clock += ms; }});
  assert.equal(timeout.success, false);
  assert.equal(timeout.reason, 'timeout');
  assert.equal(timeout.durationMs, 250);
  assert.deepEqual(timeout.stagesMs, {ui: 0});
});

test('real HTTP probe uses browser authentication and the same-origin Service, not health alone', async t => {
  let serviceAvailable = false;
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/healthz') return res.end('{"status":"healthy"}');
    if (req.url === '/_web/api/state') return res.end('{"administratorInitialized":true}');
    if (req.url === '/readyz?profile=docker-delivery') return res.end('{"ready":true}');
    if (req.url === '/_web/api/session') {
      res.setHeader('Set-Cookie', 'challenge=one; HttpOnly; Path=/');
      return res.end('{"authenticated":false,"csrfToken":"test-csrf"}');
    }
    if (req.url === '/_web/api/login') {
      assert.equal(req.headers['x-piwork-csrf'], 'test-csrf');
      assert.match(req.headers.cookie ?? '', /challenge=one/);
      res.setHeader('Set-Cookie', 'session=two; HttpOnly; Path=/');
      return res.end('{"authenticated":true}');
    }
    if (req.url === '/_desktop/api/works/work-test/sessions' && /session=two/.test(req.headers.cookie ?? '')) return res.end('{"sessions":[]}');
    if (req.url === '/services/work-test/service-test/80/' && /session=two/.test(req.headers.cookie ?? '')) {
      if (!serviceAvailable) { res.statusCode = 503; return res.end('{}'); }
      return res.end('expected');
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const probe = createStartupProbe({origin, work: 'work-test', path: '/services/work-test/service-test/80/', account: 'fixture', password: 'synthetic', expected: 'expected'});
  assert.deepEqual(await probe(), {ui: true, agent: true, service: false, ready: true});
  serviceAvailable = true;
  assert.deepEqual(await probe(), {ui: true, agent: true, service: true, ready: true});
  assert.equal(requests.includes('/healthz'), false);
  assert.equal(requests.filter(path => path === '/_web/api/login').length, 1);
});

test('isolated log export verifies the downloaded bytes and never overwrites an attempt', async t => {
  await mkdir(resolve('dist'), {recursive: true});
  const fixture = await mkdtemp(join(resolve('dist'), 'startup-export-test-'));
  t.after(() => rm(fixture, {recursive: true, force: true}));
  const bytes = Buffer.from('synthetic archive bytes');
  let digest = createHash('sha256').update(bytes).digest('hex');
  const id = 'log-export-' + 'a'.repeat(32);
  const server = createServer((req, res) => {
    if (req.url === '/api/v1/login' && req.method === 'POST') return res.end('{"token":"synthetic-token"}');
    assert.equal(req.headers.authorization, 'Bearer synthetic-token');
    if (req.url === '/api/v1/log-exports' && req.method === 'POST') { res.statusCode = 202; return res.end(JSON.stringify({exportId: id})); }
    if (req.url === '/api/v1/log-exports/' + id) return res.end(JSON.stringify({state: 'ready', result: {size: bytes.length, digest}}));
    if (req.url === '/api/v1/log-exports/' + id + '/content') {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Length', bytes.length);
      res.setHeader('X-Piwork-SHA256', digest);
      return res.end(bytes);
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const env = {...process.env, PIWORK_STARTUP_ACCOUNT: 'fixture', PIWORK_STARTUP_PASSWORD: 'synthetic-password'};
  const cli = resolve('scripts/core-startup-sampling.mjs'), output = join(fixture, 'ok.zip');
  const run = promisify(execFile);
  await run(process.execPath, [cli, 'export-log', '--core', origin, '--output', output], {env});
  assert.deepEqual(await readFile(output), bytes);
  await assert.rejects(run(process.execPath, [cli, 'export-log', '--core', origin, '--output', output], {env}));
  digest = 'f'.repeat(64);
  await assert.rejects(run(process.execPath, [cli, 'export-log', '--core', origin, '--output', join(fixture, 'bad.zip')], {env}));
});

test('isolated fixture keeps Core storage empty and never overwrites a failed sample', async t => {
  const dist = resolve('dist');
  await mkdir(dist, {recursive: true});
  const fixture = await mkdtemp(join(dist, 'startup-sampling-test-'));
  t.after(() => rm(fixture, {recursive: true, force: true}));
  const data = join(fixture, 'data'), result = join(fixture, 'result.json');
  const cli = resolve('scripts/core-startup-sampling.mjs');
  const run = promisify(execFile);
  await run(process.execPath, [cli, 'init', '--data-dir', data]);
  assert.deepEqual(await readdir(data), []);
  await assert.rejects(run(process.execPath, [cli, 'init', '--data-dir', data]));
  const listener = createServer();
  await new Promise(done => listener.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => listener.close(done)));
  const port = listener.address().port;
  const args = [cli, 'sample-core', '--data-dir', data, '--core-bin', process.execPath, '--ui-port', String(port), '--core-port', String(port === 65535 ? 65534 : port + 1), '--work', 'work-test', '--service', '/services/work-test/service-test/80/', '--samples', '1', '--timeout-ms', '1000', '--output', result];
  const env = {...process.env, PIWORK_STARTUP_ACCOUNT: 'fixture', PIWORK_STARTUP_PASSWORD: 'synthetic', PIWORK_STARTUP_SERVICE_RESPONSE: 'expected'};
  await assert.rejects(run(process.execPath, args, {env}));
  const original = await readFile(result, 'utf8');
  const parsed = JSON.parse(original);
  assert.equal(parsed.samples.length, 1);
  assert.equal(parsed.samples[0].reason, 'port-unavailable');
  await assert.rejects(run(process.execPath, args, {env}));
  assert.equal(await readFile(result, 'utf8'), original);
});

test('VM observer timestamps before external launch and accepts only that run’s console evidence', {timeout: 15000}, async t => {
  const dist = resolve('dist');
  await mkdir(dist, {recursive: true});
  const fixture = await mkdtemp(join(dist, 'startup-vm-test-'));
  t.after(() => rm(fixture, {recursive: true, force: true}));
  const log = join(fixture, 'console.log'), output = join(fixture, 'sample.json');
  await writeFile(log, '', {flag: 'wx'});
  const reserve = createServer();
  await new Promise(done => reserve.listen(0, '127.0.0.1', done));
  const port = reserve.address().port;
  await new Promise(done => reserve.close(done));
  const origin = `http://127.0.0.1:${port}`;
  const args = [resolve('scripts/core-startup-sampling.mjs'), 'observe-vm', '--ui', origin, '--work', 'work-test', '--service', '/services/work-test/service-test/8099/', '--timeout-ms', '5000', '--artifact-sha256', 'a'.repeat(64), '--bundle-sha256', 'b'.repeat(64), '--commit', 'c'.repeat(40), '--dirty', 'false', '--log', log, '--output', output];
  const child = spawn(process.execPath, args, {stdio: ['pipe', 'pipe', 'pipe'], env: {...process.env, PIWORK_STARTUP_ACCOUNT: 'fixture', PIWORK_STARTUP_PASSWORD: 'synthetic', PIWORK_STARTUP_SERVICE_RESPONSE: 'expected'}});
  const exited = once(child, 'exit');
  t.after(() => child.kill('SIGKILL'));
  const lines = createInterface({input: child.stdout})[Symbol.asyncIterator]();
  assert.equal((await lines.next()).value, 'ready-for-start');
  child.stdin.write('start\n');
  assert.equal((await lines.next()).value, 'start-recorded');
  const events = ['startup-docker', 'work-verification', 'agent-image-persistent-hit', 'agent-image-persistent-hit', 'agent-image-persistent-hit', 'file-image-persistent-hit', 'snapshot-image-persistent-hit', 'environment-persistent-hit'].map(phase => JSON.stringify({event: 'performance.' + phase, fields: {phase, outcome: 'succeeded'}})).join('\n') + '\n';
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/_web/api/state') return res.end('{"administratorInitialized":true}');
    if (req.url === '/readyz?profile=docker-delivery') return res.end('{"ready":true}');
    if (req.url === '/_web/api/session') { res.setHeader('Set-Cookie', 'challenge=one; Path=/'); return res.end('{"authenticated":false,"csrfToken":"test"}'); }
    if (req.url === '/_web/api/login') { res.setHeader('Set-Cookie', 'session=two; Path=/'); return res.end('{"authenticated":true}'); }
    if (req.url === '/_desktop/api/works/work-test/sessions') return res.end('{"sessions":[]}');
    if (req.url === '/services/work-test/service-test/8099/') return res.end('expected');
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise(done => server.listen(port, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  assert.equal((await lines.next()).value, 'readiness-observed');
  await appendFile(log, events);
  const [code] = await exited;
  assert.equal(code, 0);
  const result = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(result.samples[0].success, true);
  assert.equal(result.samples[0].counts.workVerified, 1);
  assert.equal(result.summary.passed, false, 'one VM sample is not an acceptance group');
});

test('VM observer refuses an already running UI without signaling or controlling it', async t => {
  const dist = resolve('dist');
  await mkdir(dist, {recursive: true});
  const fixture = await mkdtemp(join(dist, 'startup-running-test-'));
  t.after(() => rm(fixture, {recursive: true, force: true}));
  const log = join(fixture, 'console.log'), output = join(fixture, 'sample.json');
  await writeFile(log, '', {flag: 'wx'});
  const server = createServer((req, res) => { res.end('{"status":"healthy"}'); });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  const args = [resolve('scripts/core-startup-sampling.mjs'), 'observe-vm', '--ui', `http://127.0.0.1:${server.address().port}`, '--work', 'work-test', '--service', '/services/work-test/service-test/8099/', '--timeout-ms', '1000', '--artifact-sha256', 'a'.repeat(64), '--bundle-sha256', 'b'.repeat(64), '--commit', 'c'.repeat(40), '--dirty', 'false', '--log', log, '--output', output];
  const env = {...process.env, PIWORK_STARTUP_ACCOUNT: 'fixture', PIWORK_STARTUP_PASSWORD: 'synthetic', PIWORK_STARTUP_SERVICE_RESPONSE: 'expected'};
  await assert.rejects(promisify(execFile)(process.execPath, args, {env}));
  const result = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(result.samples[0].reason, 'not-started');
  assert.equal(result.samples[0].success, false);
});
