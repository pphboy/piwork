import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inputHash, root } from './build-web-base.mjs';

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 8 << 20 });
const metadata = JSON.parse(readFileSync(resolve(process.argv[2] || 'dist/web-base/candidate.json')));
const template = process.argv[3] || 'workstation';
assert(['workstation', 'web-app'].includes(template), 'Unknown standard template');
const serviceName = template === 'web-app' ? 'starter' : 'workstation';
assert.equal(metadata.inputHash, inputHash(), 'Candidate input changed; rebuild the complete image.');
const inspect = JSON.parse(docker('image', 'inspect', metadata.reference))[0];
assert.equal(inspect.Id, metadata.imageId);
assert.equal(inspect.Config.User, '10001:10001');
assert.equal(inspect.Architecture, 'amd64');
assert.equal(inspect.Config.Labels['io.piwork.web-base.input-sha256'], metadata.inputHash);
const tools = JSON.parse(docker('run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges', '--entrypoint', 'python', metadata.reference, '-c',
  'import sys,json,subprocess,fastapi; print(json.dumps({"python":".".join(map(str,sys.version_info[:3])),"node":subprocess.check_output(["node","--version"],text=True).strip(),"sqlite3":subprocess.check_output(["sqlite3",":memory:","select sqlite_version();"],text=True).strip(),"fastapi":fastapi.__version__}))'));
assert.equal(tools.python, metadata.environment.pythonVersion);
assert.equal(tools.node, 'v' + metadata.environment.nodeVersion);
assert.equal(tools.sqlite3, metadata.environment.sqlite3Version.split('-')[0]);

const id = 'piwork-web-base-' + randomUUID();
const volume = id + '-workspace', container = id + '-app', network = id + '-network';
const temporary = mkdtempSync(join(tmpdir(), 'piwork-web-base-'));
const identity = join(temporary, 'interaction.json');
writeFileSync(identity, JSON.stringify({ contractVersion: 1, workId: 'work-web-base-fixture-0001', serviceId: 'service-web-base-fixture-0001', serviceName,
  token: 'synthetic-web-base-test-token-' + 'a'.repeat(64), agentUrl: 'https://agentd:7444', caPath: '/etc/piwork/interaction/installation-ca.crt' }));
let coldStartMs;
try {
  docker('volume', 'create', '--label', `piwork.fixture=${id}`, volume);
  docker('network', 'create', '--internal', '--label', `piwork.fixture=${id}`, network);
  assert.equal(JSON.parse(docker('network', 'inspect', network))[0].Internal, true);
  docker('run', '--rm', '--label', `piwork.fixture=${id}`, '--user', '0:0', '--network', 'none',
    '--mount', `type=volume,src=${volume},dst=/var/data/workspace`, '--mount', `type=bind,src=${join(root, 'internal/coreassets/piwork-brain/templates', template)},dst=/template,readonly`,
    '--entrypoint', 'sh', metadata.reference, '-c', 'mkdir -p /var/data/workspace/apps/app; cp -R /template/. /var/data/workspace/apps/app/; chown -R 10001:10001 /var/data/workspace');
  docker('run', '-d', '--name', container, '--label', `piwork.fixture=${id}`, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--cpus', '.25', '--network', network, '--mount', `type=volume,src=${volume},dst=/var/data/workspace`, '--mount', `type=bind,src=${identity},dst=/etc/piwork/interaction/config.json,readonly`,
    '--workdir', '/var/data/workspace/apps/app', metadata.reference, 'piwork-web', 'run');
  const actual = JSON.parse(docker('inspect', container))[0];
  assert.equal(actual.HostConfig.Memory, 0);
  const address = `http://${Object.values(actual.NetworkSettings.Networks)[0].IPAddress}:8080`;
  const start = Date.now();
  while (true) {
    try { if ((await fetch(address + '/health', { signal: AbortSignal.timeout(1500) })).ok) break; } catch {}
    const current = JSON.parse(docker('inspect', container))[0];
    if (!current.State.Running) throw new Error('Application exited: ' + docker('logs', '--tail', '70', container));
    if (Date.now() - start > 300000) throw new Error('Readiness exceeded existing 300-second maximum: ' + docker('logs', '--tail', '70', container));
    await new Promise(done => setTimeout(done, 500));
  }
  coldStartMs = Date.now() - start;
  const version = await (await fetch(address + '/api/runtime-version')).json();
  assert.equal(version.ready, true);
  assert.match(version.codeVersion, /^[a-f0-9]{64}$/);
  assert.equal((await fetch(address + '/review')).status, 200);
  assert.equal((await fetch(address + '/api/missing')).status, 404);
  assert.equal((await fetch(address + '/pi/v1/missing')).status, 404);
  assert.equal((await fetch(address + '/api/runtime-version')).headers.get('cache-control'), 'no-store');
  const query = await (await fetch(address + '/ui/queries/todos')).json();
  assert.deepEqual(query.value, []);
  const response = await fetch(address + '/ui/actions/todo_add', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionId: 'base-check-todo', input: { title: 'Persistent base validation' }, expectedStateVersion: query.stateVersion }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state, 'succeeded');
  const sql = docker('exec', container, 'sqlite3', '-json', `/var/data/workspace/data/${serviceName}/workstation.sqlite`, 'SELECT title FROM todos;');
  assert.equal(JSON.parse(sql)[0].title, 'Persistent base validation');
  // Ensure editable dependencies are real workspace files, not a read-only image link.
  docker('exec', container, 'sh', '-c', 'test ! -L frontend/node_modules; test -w frontend/node_modules; test -s .build/checks.json');
  const checks = JSON.parse(docker('exec', container, 'cat', '/var/data/workspace/apps/app/.build/checks.json'));
  assert.equal(checks.passed, true);
  // A missing offline dependency must fail without destroying the last usable environment.
  docker('exec', container, 'node', '-e', `
    const fs=require('fs');for(const file of ['package.json','package-lock.json'])fs.copyFileSync('frontend/'+file,'.build/'+file+'.original');
    const p=JSON.parse(fs.readFileSync('frontend/package.json'));p.dependencies['piwork-offline-missing-fixture']='1.0.0';fs.writeFileSync('frontend/package.json',JSON.stringify(p));
    const l=JSON.parse(fs.readFileSync('frontend/package-lock.json'));l.packages[''].dependencies['piwork-offline-missing-fixture']='1.0.0';
    l.packages['node_modules/piwork-offline-missing-fixture']={version:'1.0.0',resolved:'https://registry.npmjs.org/piwork-offline-missing-fixture/-/piwork-offline-missing-fixture-1.0.0.tgz',integrity:'sha512-'+Buffer.alloc(64).toString('base64')};fs.writeFileSync('frontend/package-lock.json',JSON.stringify(l));`);
  try {
    assert.throws(() => docker('exec', container, 'piwork-web', 'prepare'), error => /ENOTCACHED|cache mode is .only-if-cached./.test(String(error.stderr) + String(error.stdout)));
    assert.equal(docker('exec', container, 'node', '-p', 'require("./frontend/node_modules/react/package.json").version').trim(), '19.3.0');
    assert.equal(docker('exec', container, '.venv/bin/python', '-c', 'import fastapi; print(fastapi.__version__)').trim(), '0.143.0');
  } finally {
    docker('exec', container, 'node', '-e', `const fs=require('fs');for(const file of ['package.json','package-lock.json'])fs.renameSync('.build/'+file+'.original','frontend/'+file);`);
  }
  docker('restart', container);
  for (let attempt = 0; attempt < 240; attempt++) {
    try { if ((await fetch(address + '/health', { signal: AbortSignal.timeout(1000) })).ok) break; } catch {}
    if (attempt === 239) throw new Error('Warm restart did not recover');
    await new Promise(done => setTimeout(done, 500));
  }
  assert.equal((await (await fetch(address + '/ui/queries/todos')).json()).value[0].title, 'Persistent base validation');
  docker('stop', container);
  docker('run', '--rm', '--network', 'none', '--label', `piwork.fixture=${id}`, '--mount', `type=volume,src=${volume},dst=/var/data/workspace`,
    '--workdir', '/var/data/workspace/apps/app', '--entrypoint', 'node', metadata.reference, '-e',
    `const fs=require('fs');const p='frontend/src/App.tsx';fs.copyFileSync(p,'.build/App.original.tsx');fs.appendFileSync(p,${JSON.stringify('\nconst broken: = ;\n')});`);
  docker('start', container);
  const failureDeadline = Date.now() + 120000;
  let failedBuild = false;
  while (Date.now() < failureDeadline) {
    const state = JSON.parse(docker('inspect', container))[0].State;
    if (!state.Running) { assert.notEqual(state.ExitCode, 0); failedBuild = true; break; }
    await new Promise(next => setTimeout(next, 500));
  }
  assert(failedBuild, 'Invalid frontend did not fail within readiness budget');
  const failure = docker('logs', '--tail', '60', container);
  assert.match(failure, /error TS|checks|frontend|tsc/);
  docker('run', '--rm', '--network', 'none', '--label', `piwork.fixture=${id}`, '--mount', `type=volume,src=${volume},dst=/var/data/workspace`,
    '--workdir', '/var/data/workspace/apps/app', '--entrypoint', 'node', metadata.reference, '-e',
    `const fs=require('fs');const failed=JSON.parse(fs.readFileSync('.build/checks.json'));if(failed.passed)process.exit(1);fs.renameSync('.build/App.original.tsx','frontend/src/App.tsx');`);
  const retained = docker('run', '--rm', '--network', 'none', '--label', `piwork.fixture=${id}`, '--mount', `type=volume,src=${volume},dst=/var/data/workspace`,
    '--entrypoint', 'sqlite3', metadata.reference, '-json', `/var/data/workspace/data/${serviceName}/workstation.sqlite`, 'SELECT title FROM todos;');
  assert.equal(JSON.parse(retained)[0].title, 'Persistent base validation');
  const output = join(root, 'dist/web-base'); mkdirSync(output, { recursive: true });
  writeFileSync(join(output, template === 'workstation' ? 'validation.json' : 'validation-web-app.json'), JSON.stringify({ passed: true, imageId: metadata.imageId, inputHash: metadata.inputHash,
    checkedAt: new Date().toISOString(), template, tools, coldStartMs, cpuMillis: 250, internalNetwork: true, checks: ['offline-preparation', 'missing-dependency-rollback', 'failed-build-no-ready', 'backend-tests', 'frontend-tests', 'build', 'static-api', 'sqlite3', 'readonly-root', 'workspace-dependencies', 'restart-data'] }, null, 2) + '\n');
  console.log(`Web base ${template} verified at 250 CPU ms; cold start ${coldStartMs} ms; no push performed.`);
} finally {
  try { docker('rm', '-f', container); } catch {}
  try { docker('volume', 'rm', volume); } catch {}
  try { docker('network', 'rm', network); } catch {}
  rmSync(temporary, { recursive: true, force: true });
}
