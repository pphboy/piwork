import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 8 << 20 }).trim();
}
function inspect(reference) {
  const images = JSON.parse(docker('image', 'inspect', reference));
  assert.equal(images.length, 1, `${reference}: image is missing`);
  return images[0];
}
function nativeVersion(reference, program) {
  const raw = docker('run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--entrypoint', `/usr/local/bin/${program}`, reference, '--version');
  const version = JSON.parse(raw);
  assert.equal(version.program, program);
  assert.equal(version.os, 'linux');
  assert.equal(version.architecture, 'amd64');
  assert.match(version.goVersion, /^go1\./);
  assert.match(version.commit, /^[0-9a-f]{40}$/);
}

const retained = new Set(['contracts', 'pi-adapter', 'pi-package', 'work-store']);
for (const variant of ['production', 'acceptance']) {
  const reference = `piwork-agentd:go-migration-${variant}`;
  const image = inspect(reference);
  assert.deepEqual(image.Config.Entrypoint, ['node', '/workspace/apps/agentd/dist/main.js']);
  assert.equal(image.Config.Labels['io.piwork.agent.variant'], variant);
  assert.equal(image.Config.Labels['io.piwork.package-helper.contract'], '2');
  assert.equal(image.Config.Labels['io.piwork.work-history.schema'], '4');
  assert.equal(image.Config.Labels['io.piwork.run-model.contract'], '1');
  assert.equal(image.Config.Labels['io.piwork.work-feedback.contract'], '1');
  assert.equal(image.Config.Labels['io.piwork.service-mcp.contract'], '1');
  assert.equal(image.Config.User, '10001:10001');
  const listing = docker('run', '--rm', '--network', 'none', '--read-only', '--entrypoint', '/bin/sh',
    reference, '-c', 'find /workspace/apps /workspace/packages -type f | sort');
  const files = listing.split('\n');
  assert(files.includes('/workspace/apps/agentd/dist/main.js'));
  assert(files.includes('/workspace/packages/contracts/dist/generated/agent.js'));
  assert(files.includes('/workspace/packages/work-store/dist/store.js'));
  for (const file of files) {
    if (file.startsWith('/workspace/apps/')) {
      assert(file.startsWith('/workspace/apps/agentd/'), `${reference}: unexpected app ${file}`);
    } else {
      const name = file.split('/')[3];
      assert(retained.has(name), `${reference}: unexpected package ${file}`);
    }
    assert(!/\.(?:test|spec)\.js$|\.js\.map$|\.d\.ts$|\.py$|\/testing\//.test(file),
      `${reference}: development or legacy platform file ${file}`);
  }
  const workspaceNames = docker('run', '--rm', '--network', 'none', '--read-only', '--entrypoint', '/bin/sh',
    reference, '-c', 'ls -1 /workspace/node_modules/@piwork').split('\n');
  assert.deepEqual(workspaceNames.sort(), ['agentd', ...retained].sort());
  const compiler = docker('run', '--rm', '--network', 'none', '--read-only', '--entrypoint', '/bin/sh',
    reference, '-c', 'test -e /workspace/node_modules/typescript && echo found || echo absent');
  assert.equal(compiler, 'absent', `${reference}: build compiler reached the runtime image`);
  nativeVersion(reference, 'piwork-service-mcp');
  nativeVersion(reference, 'piwork-package-helper');
}
for (const [reference, program, label] of [
  ['piwork-file-helper:go-migration-acceptance', 'piwork-file-helper', 'piwork.file_protocol'],
  ['piwork-snapshot-helper:go-migration-acceptance', 'piwork-snapshot-helper', 'piwork.snapshot_protocol'],
]) {
  const image = inspect(reference);
  assert.deepEqual(image.Config.Entrypoint, [`/usr/local/bin/${program}`]);
  assert.equal(image.Config.Labels[label], '1');
  nativeVersion(reference, program);
}
console.log('Production and acceptance images contain the retained harness and native Go platform helpers only.');
