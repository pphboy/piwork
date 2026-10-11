import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inputHash, root } from './build-web-base.mjs';

const candidate = JSON.parse(readFileSync(resolve(process.argv[2] || 'dist/web-base/candidate.json')));
assert.equal(candidate.inputHash, inputHash());
const id = 'piwork-python-deps-' + randomUUID();
const volume = id + '-workspace', network = id + '-network', registry = id + '-registry';
const directory = mkdtempSync(join(tmpdir(), 'piwork-python-deps-'));
let derived;
function command(args, success = true) {
  const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 8 << 20 });
  if (success) assert.equal(result.status, 0, result.stdout + result.stderr);
  return result;
}
const docker = (...args) => command(args).stdout.trim();
const shared = ['--label', `piwork.fixture=${id}`, '--network', network, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
  '--mount', `type=volume,src=${volume},dst=/var/data/workspace`];
const environment = ['--env', 'PIP_INDEX_URL=http://registry:8095/simple', '--env', 'PIP_TRUSTED_HOST=registry'];
const path = name => `/var/data/workspace/apps/${name}`;
function python(program, image = candidate.reference) {
  return docker('run', '--rm', ...shared, '--entrypoint', 'python', image, '-c', program);
}
function invocation(name, install = false, image = candidate.reference) {
  return ['run', '--rm', ...shared, ...environment, '--entrypoint', 'piwork-web', image, 'prepare', '--app', path(name), ...(install ? ['--install-deps'] : [])];
}
function initialize(name, version = '1.0.0') {
  python(`from pathlib import Path\np=Path(${JSON.stringify(path(name))});p.mkdir(parents=True);(p/'app.py').write_text('import piwork_extra_fixture as extra;print("extra-version:"+extra.VERSION)\\n');(p/'requirements.in').write_text('piwork-extra-fixture==${version}\\n');(p/'keep.txt').write_text('preserved application data')`);
}
const state = name => JSON.parse(python(`from pathlib import Path;print((Path(${JSON.stringify(path(name))})/'.deps/active.json').read_text())`));
function verify(name, version, image = candidate.reference) {
  const selected = state(name);
  const executable = selected.environmentDirectory + '/bin/python';
  assert.equal(python(`import subprocess\np=${JSON.stringify(path(name) + '/')};exe=p+${JSON.stringify(executable)}\nprint(subprocess.check_output([exe,'-c','import piwork_extra_fixture;print(piwork_extra_fixture.VERSION)'],text=True).strip())`, image), version);
  assert.equal(python(`import subprocess\np=${JSON.stringify(path(name) + '/' + selected.environmentDirectory + '/bin/piwork-extra-probe')}\nprint(subprocess.check_output([p],text=True).strip())`, image), 'console-extra:' + version);
  assert.match(python(`import subprocess\np=${JSON.stringify(path(name) + '/' + selected.environmentDirectory + '/bin/pip')}\nprint(subprocess.check_output([p,'--version'],text=True))`, image), /pip 26\.2\.1/);
  return selected;
}
function parallel(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
    child.on('error', reject); child.on('close', code => resolvePromise({ code, output }));
  });
}
try {
  docker('volume', 'create', '--label', `piwork.fixture=${id}`, volume);
  docker('network', 'create', '--internal', '--label', `piwork.fixture=${id}`, network);
  docker('run', '--rm', '--network', 'none', '--label', `piwork.fixture=${id}`, '--user', '0:0', '--mount', `type=volume,src=${volume},dst=/var/data/workspace`,
    '--entrypoint', 'sh', candidate.reference, '-c', 'mkdir -p /var/data/workspace/index /var/data/workspace/apps; chown -R 10001:10001 /var/data/workspace');
  python(`from pathlib import Path\nimport zipfile,hashlib\nindex=Path('/var/data/workspace/index');simple=index/'simple/piwork-extra-fixture';simple.mkdir(parents=True)\nlinks=[]\nfor version in ['1.0.0','2.0.0','3.0.0']:\n prefix='piwork_extra_fixture-'+version+'.dist-info/'\n files={'piwork_extra_fixture.py':'VERSION='+repr(version)+'\\ndef main(): print("console-extra:"+VERSION)\\n',prefix+'METADATA':'Metadata-Version: 2.1\\nName: piwork-extra-fixture\\nVersion: '+version+'\\n'+('Requires-Dist: nicegui<1\\n' if version=='3.0.0' else ''),prefix+'WHEEL':'Wheel-Version: 1.0\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n',prefix+'entry_points.txt':'[console_scripts]\\npiwork-extra-probe = piwork_extra_fixture:main\\n'}\n files[prefix+'RECORD']=''.join(name+',,\\n' for name in [*files,prefix+'RECORD'])\n target=index/('piwork_extra_fixture-'+version+'-py3-none-any.whl')\n with zipfile.ZipFile(target,'w') as wheel:\n  for name,content in files.items():wheel.writestr(name,content)\n digest=hashlib.sha256(target.read_bytes()).hexdigest();links.append('<a href="../../'+target.name+'#sha256='+digest+'">'+target.name+'</a>')\n(simple/'index.html').write_text('\\n'.join(links))`);
  const server = `from http.server import HTTPServer,SimpleHTTPRequestHandler\nfrom pathlib import Path\nimport time,os\nos.chdir('/var/data/workspace/index')\nclass Handler(SimpleHTTPRequestHandler):\n def do_GET(self):\n  gate=Path('delay.flag')\n  if self.path.endswith('.whl') and gate.exists():\n   Path('seen.flag').write_text('request reached registry')\n   deadline=time.monotonic()+20\n   while gate.exists() and time.monotonic()<deadline:time.sleep(.05)\n  super().do_GET()\nHTTPServer(('0.0.0.0',8095),Handler).serve_forever()\n`;
  docker('run', '-d', '--name', registry, '--network-alias', 'registry', ...shared, '--entrypoint', 'python', candidate.reference, '-c', server);
  initialize('one'); initialize('two', '2.0.0');
  docker(...invocation('one', true));
  const first = verify('one', '1.0.0');
  assert(first.wheels && Object.keys(first.wheels).length === 1);
  docker(...invocation('two', true)); verify('two', '2.0.0'); verify('one', '1.0.0');
  assert.notEqual(state('one').environmentDirectory, state('two').environmentDirectory);
  const globals = python(`import importlib.metadata as m\ntry:m.version('piwork-extra-fixture');raise RuntimeError('Base was mutated')\nexcept m.PackageNotFoundError:print('base unchanged')`);
  assert.equal(globals, 'base unchanged');
  for (const [version, pattern] of [['3.0.0', /conflict|ResolutionImpossible|Cannot install/], ['9.0.0', /No matching distribution|Could not find/]]) {
    python(`from pathlib import Path;Path(${JSON.stringify(path('one') + '/requirements.in')}).write_text('piwork-extra-fixture==${version}\\n')`);
    const failed = command(invocation('one', true), false);
    assert.notEqual(failed.status, 0); assert.match(failed.stdout + failed.stderr, pattern);
    assert.deepEqual(state('one'), first, 'Failure changed the original selected environment');
    python(`from pathlib import Path;Path(${JSON.stringify(path('one') + '/requirements.in')}).write_text('piwork-extra-fixture==1.0.0\\n')`);
    verify('one', '1.0.0');
  }
  initialize('parallel');
  const concurrent = await Promise.all([parallel(invocation('parallel', true)), parallel(invocation('parallel', true))]);
  for (const result of concurrent) assert.equal(result.code, 0, result.output);
  verify('parallel', '1.0.0');
  assert.equal(Number(python(`from pathlib import Path;print(len(list((Path(${JSON.stringify(path('parallel'))})/'.deps/envs').iterdir())))`)), 1, 'Concurrent preparation published duplicate environments');

  initialize('changing');
  python(`from pathlib import Path;Path('/var/data/workspace/index/delay.flag').write_text('hold the original dependency request')`);
  const changing = parallel(invocation('changing', true));
  let reached = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    reached = python(`from pathlib import Path;print(Path('/var/data/workspace/index/seen.flag').exists())`) === 'True';
    if (reached) break;
    await new Promise(done => setTimeout(done, 100));
  }
  assert(reached, 'Input-race fixture did not reach the package registry');
  python(`from pathlib import Path;Path(${JSON.stringify(path('changing') + '/requirements.in')}).write_text('piwork-extra-fixture==2.0.0\\n');Path('/var/data/workspace/index/delay.flag').unlink()`);
  const rejected = await changing;
  assert.notEqual(rejected.code, 0); assert.match(rejected.output, /declaration changed during preparation/);
  assert.equal(python(`from pathlib import Path;print((Path(${JSON.stringify(path('changing'))})/'.deps/active.json').exists())`), 'False');

  docker('stop', registry);
  const retained = state('one');
  docker(...invocation('one')); verify('one', '1.0.0');
  assert.deepEqual(state('one'), retained, 'Offline restart reinstalled matching dependencies');
  python(`from pathlib import Path\nimport shutil\nr=Path(${JSON.stringify(path('one'))});v=${JSON.stringify(retained)}\nshutil.rmtree(r/v['environmentDirectory'])\nw=r/v['wheelDirectory']/next(iter(v['wheels']));w.write_bytes(b'corrupt retained wheel')`);
  const damaged = command(invocation('one'), false);
  assert.notEqual(damaged.status, 0); assert.match(damaged.stdout + damaged.stderr, /missing or damaged/);
  assert.deepEqual(state('one'), retained);
  python(`from pathlib import Path\nimport shutil\nr=Path(${JSON.stringify(path('one'))});v=${JSON.stringify(retained)}\nfor name in v['wheels']:shutil.copyfile(Path('/var/data/workspace/index')/name,r/v['wheelDirectory']/name)`);
  docker(...invocation('one')); verify('one', '1.0.0');
  assert.notEqual(state('one').environmentDirectory, retained.environmentDirectory);
  const beforeMove = state('one');
  python(`from pathlib import Path;Path(${JSON.stringify(path('one'))}).rename(${JSON.stringify(path('moved'))})`);
  docker(...invocation('moved')); const moved = verify('moved', '1.0.0');
  assert.notEqual(moved.environmentDirectory, beforeMove.environmentDirectory);
  assert.equal(moved.applicationPath, path('moved'));
  assert.equal(python(`from pathlib import Path;print(Path(${JSON.stringify(path('moved') + '/keep.txt')}).read_text())`), 'preserved application data');

  const dockerfile = `FROM ${candidate.reference}\nUSER 0:0\nRUN python -c 'import json;from pathlib import Path;p=Path("/opt/piwork-web-base/environment.json");v=json.loads(p.read_text());v["dependencyAcceptanceEnvironment"]="changed";p.write_text(json.dumps(v,sort_keys=True)+"\\n")'\nUSER 10001:10001\n`;
  writeFileSync(join(directory, 'Dockerfile'), dockerfile);
  derived = id + '-environment'; docker('build', '--label', `piwork.fixture=${id}`, '-t', derived, directory);
  const original = state('moved');
  docker(...invocation('moved', false, derived)); const upgraded = verify('moved', '1.0.0', derived);
  assert.notEqual(upgraded.environmentHash, original.environmentHash);
  assert.notEqual(upgraded.environmentDirectory, original.environmentDirectory);
  const run = command(['run', '--rm', ...shared, ...environment, '--entrypoint', 'piwork-web', derived, 'run', '--app', path('moved')]);
  assert.match(run.stdout, /extra-version:1\.0\.0/);
  writeFileSync(join(root, 'dist/web-base/dependencies-validation.json'), JSON.stringify({ contractVersion: 2, passed: true,
    imageId: candidate.imageId, inputHash: candidate.inputHash, checkedAt: new Date().toISOString(), internalRegistry: true,
    checks: ['explicit-python-install', 'selected-console-interpreter', 'base-unchanged', 'application-environment-isolation', 'conflict-rollback', 'download-failure-rollback',
      'serialized-preparation', 'changed-input-no-activation', 'offline-dependency-reuse', 'damaged-wheel-rejected', 'offline-reconstruction', 'moved-app-reconstruction', 'base-environment-reconstruction', 'actual-extra-application'] }, null, 2) + '\n');
  console.log('Extra Python dependency install, exact local retention, commands, isolation, failed/concurrent preparation and offline reconstruction verified.');
} finally {
  try {
    for (const container of docker('ps', '-aq', '--filter', `label=piwork.fixture=${id}`).split('\n').filter(Boolean)) docker('rm', '-f', container);
  } catch {}
  try { docker('volume', 'rm', volume); } catch {}
  try { docker('network', 'rm', network); } catch {}
  if (derived) { try { docker('image', 'rm', derived); } catch {} }
  rmSync(directory, { recursive: true, force: true });
}
