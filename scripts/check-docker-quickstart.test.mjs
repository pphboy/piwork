import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkQuickStart, checkPackageMaterials, codeBlocks, installerFiles, projectRoot, section } from './check-docker-quickstart.mjs';

const docs = ['README.md', 'README.zh-CN.md', 'deploy/docker/README.md', 'deploy/docker/README.zh-CN.md'];
const materials = ['core.run.env.example', 'core.env.example', 'client.env.example', 'compose.core.yaml', 'compose.cli.yaml', 'compose.cli.linux.yaml', 'README.md', 'README.zh-CN.md'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceBlocks = () => codeBlocks(section(readFileSync(join(projectRoot, 'README.md'), 'utf8'), 'docker-quickstart'));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'piwork-quickstart-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of [...docs, ...materials.map(name => `deploy/docker/${name}`), 'Dockerfile.cli', 'scripts/build-docker-release.mjs', 'scripts/check-docker-quickstart.mjs', 'LICENSE']) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    copyFileSync(join(projectRoot, name), join(root, name));
  }
  return root;
}
const replace = (root, name, from, to) => {
  const path = join(root, name);
  const before = readFileSync(path, 'utf8');
  assert(before.includes(from), `Fixture target exists in ${name}`);
  writeFileSync(path, before.replaceAll(from, to));
};

test('current bilingual Quick Start, Core Demo and package inputs stay coherent', () => {
  assert.deepEqual(checkQuickStart(), []);
});

test('command-line gate exits nonzero on drift and never prints a configured value', t => {
  const root = fixture(t);
  const run = () => spawnSync(process.execPath, [join(root, 'scripts/check-docker-quickstart.mjs')], { cwd: root, encoding: 'utf8' });
  assert.equal(run().status, 0);
  docs.forEach(name => replace(root, name, '--entrypoint /bin/sh', '--env PIWORK_API_KEY=synthetic-canary-must-not-print --entrypoint /bin/sh'));
  const failed = run();
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /CLI environment selects only Core origin/);
  assert(!failed.stderr.includes('synthetic-canary-must-not-print'));
});

test('drift in deployment contracts is rejected without printing configured values', async t => {
  const cases = [
    ['Core bind mismatch', root => docs.forEach(name => replace(root, name, '--volume /var/lib/piwork/quickstart/core:/var/lib/piwork/quickstart/core', '--volume /var/lib/piwork/quickstart/core:/wrong')), 'same absolute data path'],
    ['missing host-gateway', root => docs.forEach(name => replace(root, name, 'host.docker.internal:host-gateway', 'host.docker.internal:127.0.0.1')), 'host-gateway'],
    ['published CLI port', root => docs.forEach(name => replace(root, name, '--entrypoint /bin/sh', '--publish 17891:17891 --entrypoint /bin/sh')), 'no server ports'],
    ['CLI receives Core secret', root => docs.forEach(name => replace(root, name, '--entrypoint /bin/sh', '--env PIWORK_API_KEY=synthetic-canary-must-not-print --entrypoint /bin/sh')), 'selects only Core origin'],
    ['CLI reads Core env-file', root => docs.forEach(name => replace(root, name, '--entrypoint /bin/sh', '--env-file core.run.env --entrypoint /bin/sh')), 'selects only Core origin'],
    ['shutdown budget', root => docs.forEach(name => replace(root, name, '--stop-timeout 60', '--stop-timeout 10')), 'shutdown budget'],
    ['language command mismatch', root => replace(root, 'README.zh-CN.md', "--message 'Hello, Piwork!'", "--message 'Different command'"), 'paired terminal commands'],
    ['missing raw template', root => rmSync(join(root, 'deploy/docker/core.run.env.example')), 'missing material'],
    ['unexpected quoted raw value', root => replace(root, 'deploy/docker/core.run.env.example', 'PIWORK_API_KEY=\n', "PIWORK_API_KEY=''\n"), 'blank raw initialization'],
    ['stale image credential path', root => replace(root, 'Dockerfile.cli', 'PIWORK_CONFIG_PATH=/var/lib/piwork/client/credentials.json', 'PIWORK_CONFIG_PATH=/wrong/credentials.json'), 'private persistent state'],
    ['Demo network changed', root => replace(root, 'deploy/docker/compose.core.yaml', 'network_mode: host', 'network_mode: bridge'), 'Demo image and host network'],
    ['Demo data mismatch', root => replace(root, 'deploy/docker/compose.core.yaml', 'target: ${PIWORK_DATA_DIR:', 'target: ${OTHER_DIRECTORY:'), 'Demo same absolute data path'],
    ['missing packed template', root => replace(root, 'scripts/build-docker-release.mjs', "'core.run.env.example', ", ''), 'installer contains core.run.env.example'],
    ['missing packed manual', root => replace(root, 'scripts/build-docker-release.mjs', "'README.zh-CN.md'", "'missing-manual.md'"), 'installer contains README.zh-CN.md'],
    ['material gate removed', root => replace(root, 'scripts/build-docker-release.mjs', "run('node', ['scripts/check-docker-quickstart.mjs']);", ''), 'before copying'],
  ];
  for (const [name, mutate, expected] of cases) {
    await t.test(name, sub => {
      const root = fixture(sub);
      mutate(root);
      const errors = checkQuickStart(root);
      assert(errors.some(error => error.includes(expected)), `Expected field diagnostic: ${expected}`);
      assert(!errors.join('\n').includes('synthetic-canary-must-not-print'));
    });
  }
});

test('documented shell blocks parse and new/old installer branches preserve private existing config', t => {
  const blocks = sourceBlocks();
  for (const { code } of blocks) assert.equal(spawnSync('sh', ['-n'], { input: code, encoding: 'utf8' }).status, 0);
  const root = fixture(t);
  for (const modern of [true, false]) {
    const base = join(root, modern ? 'modern' : 'legacy');
    mkdirSync(base);
    if (modern) copyFileSync(join(root, 'deploy/docker/core.run.env.example'), join(base, 'core.run.env.example'));
    const options = { cwd: base, env: { ...process.env, EDITOR: 'true' }, encoding: 'utf8' };
    assert.equal(spawnSync('sh', ['-c', blocks[1].code], options).status, 0);
    assert.equal(readFileSync(join(base, 'core.run.env'), 'utf8'), readFileSync(join(root, 'deploy/docker/core.run.env.example'), 'utf8'));
    assert.equal(statSync(join(base, 'core.run.env')).mode & 0o777, 0o600);
    writeFileSync(join(base, 'core.run.env'), 'synthetic existing configuration\n');
    assert.notEqual(spawnSync('sh', ['-c', blocks[1].code], options).status, 0);
    assert.equal(readFileSync(join(base, 'core.run.env'), 'utf8'), 'synthetic existing configuration\n');
  }
});

test('actual download block stops on download, checksum and internal-integrity failures', async t => {
  const root = fixture(t);
  const payload = join(root, 'payload/piwork-docker');
  mkdirSync(payload, { recursive: true });
  const bytes = 'PIWORK_CORE_IMAGE=fixture@sha256:' + 'a'.repeat(64) + '\n';
  writeFileSync(join(payload, 'release.env'), bytes);
  const archive = join(root, 'fixture.tar.gz');
  const checksum = join(root, 'fixture.sha256');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'curl'), `#!/bin/sh
output=
url=
while [ "$#" -gt 0 ]; do
    if [ "$1" = --output ]; then shift; output=$1; else url=$1; fi
    shift
done
test "$PIWORK_DOWNLOAD_FIXTURE_MODE" != download-failure || exit 22
case "$url" in
    *.sha256) cp "$PIWORK_DOWNLOAD_FIXTURE_CHECKSUM" "$output" ;;
    *) cp "$PIWORK_DOWNLOAD_FIXTURE_ARCHIVE" "$output" ;;
esac
`, { mode: 0o755 });
  for (const mode of ['success', 'download-failure', 'wrong-checksum', 'invalid-checksum', 'invalid-internal-checksum']) {
    await t.test(mode, () => {
      const correctInternal = mode !== 'invalid-internal-checksum';
      writeFileSync(join(payload, 'SHA256SUMS'), `${correctInternal ? sha(bytes) : '0'.repeat(64)}  release.env\n`);
      assert.equal(spawnSync('tar', ['-C', join(root, 'payload'), '-czf', archive, 'piwork-docker']).status, 0);
      const archiveHash = mode === 'wrong-checksum' ? '0'.repeat(64) : sha(readFileSync(archive));
      writeFileSync(checksum, mode === 'invalid-checksum' ? 'invalid checksum\n' : `${archiveHash}  piwork-docker-0.0.1.tar.gz\n`);
      const base = join(root, mode);
      mkdirSync(base);
      const result = spawnSync('sh', ['-c', sourceBlocks()[0].code + ' && printf "continued" > installation-continued\n'], {
        cwd: base, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PIWORK_DOWNLOAD_FIXTURE_MODE: mode, PIWORK_DOWNLOAD_FIXTURE_ARCHIVE: archive, PIWORK_DOWNLOAD_FIXTURE_CHECKSUM: checksum },
      });
      const continued = join(base, 'piwork-preview-0.0.1/piwork-docker/installation-continued');
      if (mode === 'success') {
        assert.equal(result.status, 0);
        assert(existsSync(continued));
        assert(existsSync(join(base, 'piwork-preview-0.0.1/piwork-docker/release.env')));
      } else {
        assert.notEqual(result.status, 0);
        assert(!existsSync(continued));
        if (mode !== 'invalid-internal-checksum') assert(!existsSync(join(base, 'piwork-preview-0.0.1/piwork-docker')));
      }
    });
  }
});

test('material fixture archives contain both templates, exact checksums and matching fixed references', t => {
  const root = fixture(t);
  const stage = join(root, 'stage/piwork-docker');
  mkdirSync(stage, { recursive: true });
  for (const name of installerFiles(readFileSync(join(root, 'scripts/build-docker-release.mjs'), 'utf8'))) copyFileSync(join(root, 'deploy/docker', name), join(stage, name));
  copyFileSync(join(root, 'LICENSE'), join(stage, 'LICENSE'));
  const roles = { core: 'CORE', cli: 'CLI', agent: 'AGENT', packageHelper: 'PACKAGE_HELPER', fileHelper: 'FILE_HELPER', snapshotHelper: 'SNAPSHOT_HELPER' };
  const manifest = { releaseVersion: 'synthetic-material-fixture', images: {} };
  let release = `PIWORK_RELEASE_VERSION=${manifest.releaseVersion}\n`;
  for (const [role, suffix] of Object.entries(roles)) {
    const reference = `docker.io/fixture/${role.toLowerCase()}@sha256:${'a'.repeat(64)}`;
    release += `PIWORK_${suffix}_IMAGE=${reference}\n`;
    manifest.images[role] = { reference };
  }
  writeFileSync(join(stage, 'release.env'), release);
  writeFileSync(join(stage, 'release-manifest.json'), JSON.stringify(manifest));
  const names = [...materials, 'LICENSE', 'release.env', 'release-manifest.json'].sort();
  writeFileSync(join(stage, 'SHA256SUMS'), names.map(name => `${sha(readFileSync(join(stage, name)))}  ${name}\n`).join(''));
  assert.deepEqual(checkPackageMaterials(stage, root), []);
  const archive = join(root, 'material-fixture.tar.gz');
  assert.equal(spawnSync('tar', ['-C', join(root, 'stage'), '-czf', archive, 'piwork-docker']).status, 0);
  writeFileSync(archive + '.sha256', `${sha(readFileSync(archive))}  material-fixture.tar.gz\n`);
  assert.equal(spawnSync('sha256sum', ['--check', '--strict', archive + '.sha256'], { cwd: root }).status, 0);
  const unpacked = join(root, 'unpacked');
  mkdirSync(unpacked);
  assert.equal(spawnSync('tar', ['-C', unpacked, '-xzf', archive]).status, 0);
  assert.deepEqual(checkPackageMaterials(join(unpacked, 'piwork-docker'), root), []);
  writeFileSync(join(stage, 'core.run.env.example'), 'tampered material\n');
  assert(checkPackageMaterials(stage, root).some(error => error.includes('checksum mismatch core.run.env.example')));
  rmSync(join(stage, 'core.run.env.example'));
  assert(checkPackageMaterials(stage, root).some(error => error.includes('missing core.run.env.example')));
});
