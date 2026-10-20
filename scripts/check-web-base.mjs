import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { inputHash, root } from './build-web-base.mjs';
import { prefixFixture } from './web-base-prefix-fixture.mjs';
import { queryFaultSource, checkQueryFailure } from './check-application-awareness-page.mjs';

const metadata = JSON.parse(readFileSync(resolve(process.argv[2] || 'dist/web-base/candidate.json')));
const template = process.argv[3] || 'workstation';
assert(['workstation', 'web-app'].includes(template));
assert.equal(metadata.inputHash, inputHash(), 'Rebuild the current complete image');
assert.equal(metadata.contractVersion, 2);
const serviceName = template === 'web-app' ? 'starter' : 'workstation';
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 8 << 20 });
const inspect = JSON.parse(docker('image', 'inspect', metadata.reference))[0];
assert.equal(inspect.Id, metadata.imageId);
assert.equal(inspect.Config.User, '10001:10001');
assert.equal(inspect.Config.Labels['io.piwork.web-base.contract'], '2');
assert.equal(inspect.Config.Labels['io.piwork.web-base.input-sha256'], metadata.inputHash);
const tools = JSON.parse(docker('run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'python', metadata.reference, '-c',
  'import sys,json,subprocess,shutil,nicegui,pip;print(json.dumps({"python":sys.version.split()[0],"nicegui":nicegui.__version__,"pip":pip.__version__,"node":shutil.which("node"),"npm":shutil.which("npm"),"sqlite3":subprocess.check_output(["sqlite3",":memory:","select sqlite_version();"],text=True).strip()}))'));
assert.equal(tools.python, metadata.environment.pythonVersion);
assert.equal(tools.nicegui, metadata.environment.niceguiVersion);
assert.equal(tools.pip, metadata.environment.pipVersion);
assert.equal(tools.node, null); assert.equal(tools.npm, null);
assert.equal(tools.sqlite3, metadata.environment.sqlite3Version.split('-')[0]);
const id = 'piwork-nicegui-base-' + randomUUID();
const volume = id + '-workspace', container = id + '-app', network = id + '-network', plain = id + '-plain';
const temporary = mkdtempSync(join(tmpdir(), 'piwork-nicegui-base-'));
const identity = join(temporary, 'interaction.json');
writeFileSync(identity, JSON.stringify({ contractVersion: 1, workId: 'work-base-fixture-0001', serviceId: 'service-base-fixture-0001', serviceName,
  token: 'synthetic-base-test-token-' + 'a'.repeat(64), agentUrl: 'https://agentd:7444', caPath: '/etc/piwork/interaction/installation-ca.crt' }));
let browser, prefixed;
const app = '/var/data/workspace/apps/app';
const python = program => docker('exec', container, 'python', '-c', program);
async function ready(address, name = container) {
  const start = Date.now();
  while (Date.now() - start < 300000) {
    try { if ((await fetch(address + '/health', { signal: AbortSignal.timeout(1500) })).ok) return Date.now() - start; } catch {}
    const current = JSON.parse(docker('inspect', name))[0];
    if (!current.State.Running) throw new Error('Application exited: ' + docker('logs', '--tail', '70', name));
    await new Promise(done => setTimeout(done, 250));
  }
  throw new Error('Readiness exceeded the existing maximum: ' + docker('logs', '--tail', '70', name));
}
function expectedFailure(args, pattern) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, pattern);
}
try {
  docker('volume', 'create', '--label', `piwork.fixture=${id}`, volume);
  docker('network', 'create', '--internal', '--label', `piwork.fixture=${id}`, network);
  assert.equal(JSON.parse(docker('network', 'inspect', network))[0].Internal, true);
  docker('run', '--rm', '--label', `piwork.fixture=${id}`, '--user', '0:0', '--network', 'none',
    '--mount', `type=volume,src=${volume},dst=/var/data/workspace`, '--mount', `type=bind,src=${join(root, 'internal/coreassets/piwork-brain/templates', template)},dst=/template,readonly`,
    '--entrypoint', 'sh', metadata.reference, '-c', 'mkdir -p /var/data/workspace/apps/app; cp -R /template/. /var/data/workspace/apps/app/; chown -R 10001:10001 /var/data/workspace');
  const preparationStarted = Date.now();
  docker('run', '--rm', '--network', 'none', '--label', `piwork.fixture=${id}`, '--mount', `type=volume,src=${volume},dst=/var/data/workspace`,
    '--entrypoint', 'python', metadata.reference, '-c', `from pathlib import Path\np=Path(${JSON.stringify(app + '/workstation.py')});p.write_text(p.read_text()+${JSON.stringify(queryFaultSource)})`);
  docker('run', '--rm', '--label', `piwork.fixture=${id}`, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--cpus', '.25', '--network', network,
    '--mount', `type=volume,src=${volume},dst=/var/data/workspace`, '--entrypoint', 'piwork-web', metadata.reference, 'prepare', '--app', app);
  const preparationMs = Date.now() - preparationStarted;
  docker('run', '-d', '--name', container, '--label', `piwork.fixture=${id}`, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--cpus', '.25', '--network', network,
    '--mount', `type=volume,src=${volume},dst=/var/data/workspace`, '--mount', `type=bind,src=${identity},dst=/etc/piwork/interaction/config.json,readonly`,
    '--workdir', app, metadata.reference, 'piwork-web', 'run');
  const actual = JSON.parse(docker('inspect', container))[0];
  assert.equal(actual.HostConfig.Memory, 0);
  assert.equal(actual.HostConfig.ReadonlyRootfs, true);
  const address = `http://${Object.values(actual.NetworkSettings.Networks)[0].IPAddress}:8080`;
  const coldStartMs = await ready(address);
  const version = await (await fetch(address + '/api/runtime-version')).json();
  assert(version.ready); assert.equal(version.mode, 'nicegui');
  assert.match(version.codeVersion, /^[a-f0-9]{64}$/);
  assert.equal((await fetch(address + '/review')).status, 200);
  assert.equal((await fetch(address + '/api/missing')).status, 404);
  assert.equal((await fetch(address + '/pi/v1/missing')).status, 404);
  assert.equal((await fetch(address + '/api/runtime-version')).headers.get('cache-control'), 'no-store');
  const query = await (await fetch(address + '/ui/queries/todos')).json();
  assert.deepEqual(query.value, []);
  const result = await fetch(address + '/ui/actions/todo_add', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionId: 'base-check-todo', input: { title: 'Persistent base validation' }, expectedStateVersion: query.stateVersion }) });
  assert.equal(result.status, 200); assert.equal((await result.json()).state, 'succeeded');
  assert.equal(JSON.parse(docker('exec', container, 'sqlite3', '-json', `/var/data/workspace/data/${serviceName}/workstation.sqlite`, 'SELECT title FROM todos;'))[0].title, 'Persistent base validation');
  python(`from pathlib import Path\nr=Path(${JSON.stringify(app)})\nassert not (r/'.venv').exists() and not (r/'.deps').exists() and not (r/'frontend').exists()\nassert (r/'.cache/home').is_dir() and (r/'.tmp').is_dir()`);
  const passedChecks = python(`from pathlib import Path;print((Path(${JSON.stringify(app)})/'.build/checks.json').read_text(),end='')`);
  assert(JSON.parse(passedChecks).passed);
  python(`from pathlib import Path\np=Path('requirements.in');p.rename('.build/requirements.original');p.write_text('piwork-offline-missing-fixture==1.0.0\\n')`);
  expectedFailure(['exec', container, 'piwork-web', 'prepare'], /explicitly use --install-deps/);
  python(`from pathlib import Path;Path('.build/requirements.original').replace('requirements.in')`);
  const restartStarted = Date.now(); docker('restart', container); await ready(address);
  const warmRestartMs = Date.now() - restartStarted;
  assert.equal(python(`from pathlib import Path;print(Path('.build/checks.json').read_text(),end='')`), passedChecks, 'Unchanged input repeated application checks');
  const workspaceBytes = Number(python(`from pathlib import Path;print(sum(p.stat().st_size for p in Path('/var/data/workspace').rglob('*') if p.is_file()))`).trim());
  assert.equal((await (await fetch(address + '/ui/queries/todos')).json()).value[0].title, 'Persistent base validation');

  browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--proxy-server=direct://', '--proxy-bypass-list=*'] });
  const page = await browser.newPage();
  prefixed = await prefixFixture(address);
  const browserAddress = prefixed.url;
  const errors = [], external = [], sockets = [], requests = [];
  page.on('request', req => requests.push(req.url()));
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => sockets.push(socket.url()));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== prefixed.origin || !new URL(route.request().url()).pathname.startsWith(prefixed.prefix + '/')) { external.push(new URL(route.request().url()).origin); return route.abort(); }
    return route.continue();
  });
  await page.goto(browserAddress);
  await page.getByRole('heading', { name: 'Personal workstation', exact: true }).waitFor();
  await page.getByLabel('Todo title', { exact: true }).fill('NiceGUI browser proof');
  await page.getByRole('button', { name: 'Add Todo', exact: true }).click();
  await expect(page.getByText('NiceGUI browser proof', { exact: true })).toBeVisible();
  const row = page.locator('.webapp-todo-row, .workstation-todo-row').filter({ hasText: 'NiceGUI browser proof' });
  await row.getByRole('button', { name: 'Complete', exact: true }).click();
  await expect(row.getByText('Completed', { exact: true })).toBeVisible();
  await page.getByLabel('Todo title', { exact: true }).fill('draft survives navigation');
  await page.getByRole('link', { name: 'Personal review', exact: true }).click();
  await page.getByRole('heading', { name: 'Personal review', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Todos', exact: true }).click();
  await expect(page.getByLabel('Todo title', { exact: true })).toHaveValue('draft survives navigation');
  assert(sockets.some(url => url.includes(prefixed.prefix + '/_nicegui_ws/')), 'No prefixed NiceGUI WebSocket');
  await page.reload();
  await expect(page.getByLabel('Todo title', { exact: true })).toHaveValue('draft survives navigation');
  assert(requests.every(raw => new URL(raw).pathname.startsWith(prefixed.prefix + '/')), 'Browser escaped its Service path');
  assert.deepEqual(external, [], 'Standard page requested a CDN or external resource');
  assert.deepEqual(errors, []);
  await checkQueryFailure(page, enabled => python(`from pathlib import Path\np=Path('/var/data/workspace/data/${serviceName}/awareness-query-failure')\n${enabled ? "p.write_text('controlled fixture failure')" : 'p.unlink()'}`));
  const recoveredTodos = (await (await fetch(address + '/ui/queries/todos')).json()).value;
  mkdirSync(join(root, 'dist/web-base'), { recursive: true });
  await page.screenshot({ path: join(root, 'dist/web-base', `nicegui-${template}.png`), fullPage: true });
  await browser.close(); browser = undefined;
  const originalMarker = python(`from pathlib import Path;print(Path('.build/runtime.json').read_text(),end='')`);
  python(`import json\nfrom pathlib import Path\np=Path('.build/runtime.json');v=json.loads(p.read_text());v['codeVersion']='fake-marker';p.write_text(json.dumps(v))`);
  const spoofed = await (await fetch(address + '/api/runtime-version')).json();
  assert.equal(spoofed.codeVersion, version.codeVersion); assert.equal(spoofed.ready, false);
  python(`from pathlib import Path;Path('.build/runtime.json').write_text(${JSON.stringify(originalMarker)})`);
  docker('stop', container);
  docker('run', '--rm', '--network', 'none', '--label', `piwork.fixture=${id}`, '--mount', `type=volume,src=${volume},dst=/var/data/workspace`, '--workdir', app,
    '--entrypoint', 'python', metadata.reference, '-c', `from pathlib import Path\np=Path('ui.py');Path('.build/ui.original').write_bytes(p.read_bytes());p.write_text(p.read_text()+'\\ninvalid syntax = ;\\n')`);
  docker('start', container);
  const failureStart = Date.now();
  while (JSON.parse(docker('inspect', container))[0].State.Running) {
    assert(Date.now() - failureStart < 120000, 'Invalid Python did not fail within the existing readiness budget');
    await new Promise(done => setTimeout(done, 250));
  }
  assert.notEqual(JSON.parse(docker('inspect', container))[0].State.ExitCode, 0);
  docker('run', '--rm', '--network', 'none', '--label', `piwork.fixture=${id}`, '--mount', `type=volume,src=${volume},dst=/var/data/workspace`, '--workdir', app,
    '--entrypoint', 'python', metadata.reference, '-c', `from pathlib import Path\nimport json\nassert not json.loads(Path('.build/checks.json').read_text())['passed'];Path('.build/ui.original').replace('ui.py')`);
  docker('start', container); await ready(address);
  assert.deepEqual((await (await fetch(address + '/ui/queries/todos')).json()).value, recoveredTodos);
  const plainSource = `from nicegui import app,ui\n@app.get('/health')\ndef health(): return {'ready':True}\nui.label('Generic NiceGUI application').props('role=heading aria-level=1')\nui.run(host='0.0.0.0',port=8081,show=False,reload=False,tailwind=False,show_welcome_message=False)\n`;
  python(`from pathlib import Path\np=Path('/var/data/workspace/apps/plain');p.mkdir();(p/'app.py').write_text(${JSON.stringify(plainSource)})`);
  docker('run', '-d', '--name', plain, '--label', `piwork.fixture=${id}`, '--network', network, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--mount', `type=volume,src=${volume},dst=/var/data/workspace`, '--workdir', '/var/data/workspace/apps/plain', '--entrypoint', 'python', metadata.reference, 'app.py');
  const plainInfo = JSON.parse(docker('inspect', plain))[0];
  const plainAddress = `http://${Object.values(plainInfo.NetworkSettings.Networks)[0].IPAddress}:8081`;
  await ready(plainAddress, plain);
  assert((await (await fetch(plainAddress)).text()).includes('Generic NiceGUI application'));
  const record = { contractVersion: 2, passed: true, imageId: metadata.imageId, inputHash: metadata.inputHash, checkedAt: new Date().toISOString(), template,
    tools, preparationMs, coldStartMs, warmRestartMs, workspaceBytes, cpuMillis: 250, internalNetwork: true,
    checks: ['offline-standard-environment', 'missing-extra-dependency-no-implicit-install', 'failed-check-no-ready', 'python-tests', 'nicegui-http-websocket', 'dynamic-service-prefix', 'prefix-draft-deep-refresh', 'sqlite3', 'readonly-root', 'base-dependency-reuse', 'restart-data', 'checked-input-cache', 'loaded-version-fixed', 'generic-nicegui-service'] };
  writeFileSync(join(root, 'dist/web-base', template === 'workstation' ? 'validation.json' : 'validation-web-app.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(`NiceGUI ${template}: prepare ${preparationMs} ms, prepared start ${coldStartMs} ms, restart ${warmRestartMs} ms, workspace ${workspaceBytes} bytes; no push.`);
} finally {
  await browser?.close();
  await prefixed?.close();
  for (const name of [container, plain]) { try { docker('rm', '-f', name); } catch {} }
  try { docker('volume', 'rm', volume); } catch {}
  try { docker('network', 'rm', network); } catch {}
  rmSync(temporary, { recursive: true, force: true });
}
