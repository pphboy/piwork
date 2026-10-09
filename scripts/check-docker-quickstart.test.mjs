import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkQuickStart, codeBlocks, section, projectRoot } from './check-docker-quickstart.mjs';
import { syncWebsite } from './sync-docker-website.mjs';
import { sourceInputHash } from './build-docker-release.mjs';

const docs = ['README.md', 'README.zh-CN.md', 'deploy/docker/README.md', 'deploy/docker/README.zh-CN.md'];
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'piwork-quickstart-contract-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  for (const path of ['cmd', 'internal', 'proto', 'apps', 'packages', 'scripts', 'config', 'deploy', 'examples']) cpSync(join(projectRoot, path), join(base, path), { recursive: true, filter: path => !/\/(?:node_modules|dist)(?:\/|$)/.test(path) });
  for (const name of ['README.md', 'README.zh-CN.md', '.dockerignore', 'go.mod', 'go.sum', 'package.json', 'package-lock.json', 'tsconfig.base.json', 'Dockerfile.core', 'Dockerfile.cli', 'Dockerfile.core.dockerignore', 'Dockerfile.cli.dockerignore', 'Dockerfile.agentd', 'Dockerfile.file-helper.native', 'Dockerfile.snapshot-helper.native', 'Dockerfile.docker-release']) copyFileSync(join(projectRoot, name), join(base, name));
  mkdirSync(join(base, 'docs/images'), { recursive: true });
  copyFileSync(join(projectRoot, 'docs/images/piwork-logo.png'), join(base, 'docs/images/piwork-logo.png'));
  refresh(base);
  return base;
}
function refresh(base) {
  const path = join(base, 'deploy/docker/release.json');
  const metadata = JSON.parse(readFileSync(path, 'utf8'));
  metadata.sourceInputHash = sourceInputHash(base);
  writeFileSync(path, JSON.stringify(metadata, null, 2) + '\n');
}
function replace(base, name, from, to) {
  const path = join(base, name), text = readFileSync(path, 'utf8');
  assert(text.includes(from), `fixture target exists: ${name}`);
  writeFileSync(path, text.replaceAll(from, to));
}

test('paired default commands are standalone, terminal-only and parse as shell', () => {
  const baseline = codeBlocks(section(readFileSync(join(projectRoot, docs[0]), 'utf8'), 'docker-quickstart'));
  for (const name of docs) {
    const blocks = codeBlocks(section(readFileSync(join(projectRoot, name), 'utf8'), 'docker-quickstart'));
    assert.deepEqual(blocks, baseline);
    for (const block of blocks) assert.equal(spawnSync('sh', ['-n'], { input: block.code }).status, 0);
  }
});

test('consistent candidate passes with current source inputs', t => {
  const base = fixture(t);
  assert.deepEqual(checkQuickStart(base), []);
});

test('semantic deployment drift fails with safe diagnostics', async t => {
  const cases = [
    ['Core bind', base => docs.forEach(name => replace(base, name, '--volume /var/lib/piwork/quickstart/core:/var/lib/piwork/quickstart/core', '--volume /var/lib/piwork/quickstart/core:/wrong')), 'complete startup'],
    ['Core secret leaked to CLI', base => docs.forEach(name => replace(base, name, '--add-host host.docker.internal:host-gateway', '--env PIWORK_API_KEY=synthetic-canary-must-not-print --add-host host.docker.internal:host-gateway')), 'complete startup'],
    ['language mismatch', base => replace(base, 'README.zh-CN.md', 'Hello, Piwork!', 'Different message'), 'paired terminal'],
    ['Arch moved back', base => replace(base, 'README.md', '## Architecture', '## Hidden Architecture'), 'Architecture'],
    ['Logo alignment', base => replace(base, 'README.md', '<p align="center">', '<p align="left">'), 'Logo'],
    ['image state path', base => replace(base, 'Dockerfile.cli', 'PIWORK_CONFIG_PATH=/var/lib/piwork/client/credentials.json', 'PIWORK_CONFIG_PATH=/wrong'), 'private persistent'],
    ['old Docker build context', base => writeFileSync(join(base, 'Dockerfile.core.dockerignore'), '**\n!dist/\n'), 'source/secret'],
    ['missing readiness', base => replace(base, 'deploy/docker/wait-core.sh', 'readyz?profile=docker-delivery', 'healthz'), 'exact full-readiness'],
    ['Compose host network', base => replace(base, 'deploy/docker/docker-compose.yml.template', 'network_mode: host', 'network_mode: bridge'), 'Core host'],
    ['Compose env file', base => replace(base, 'deploy/docker/docker-compose.yml.template', '    environment:', '    env_file: ./core.env\n    environment:'), 'single-file'],
    ['optional address empty', base => replace(base, 'deploy/docker/docker-compose.yml.template', '      PIWORK_MODEL_BASE_URL:', '      PIWORK_MODEL_BASE_URL: ""'), 'pass through by name'],
    ['CLI gets socket', base => replace(base, 'examples/single-host/docker-compose.yml.template', '      - client-state:/var/lib/piwork/client', '      - /var/run/docker.sock:/var/run/docker.sock'), 'CLI must not receive'],
    ['Core file includes CLI', base => replace(base, 'deploy/docker/docker-compose.yml.template', 'services:', 'services:\n  cli:\n    image: unexpected'), 'Core only'],
    ['example dependency', base => replace(base, 'examples/single-host/docker-compose.yml.template', '    profiles: [cli]', '    profiles: [cli]\n    depends_on: [core]'), 'lifecycle dependencies'],
    ['shutdown budget', base => replace(base, 'deploy/docker/docker-compose.yml.template', 'stop_grace_period: 60s', 'stop_grace_period: 10s'), 'shutdown budget'],
    ['generated material changed', base => replace(base, 'deploy/docker/docker-compose.yml', 'name: piwork-quickstart', 'name: another'), 'generated file'],
    ['candidate warning removed', base => {
      // This negative case must remain a candidate even when the checkout is published.
      const path = join(base, 'deploy/docker/release.json');
      const metadata = JSON.parse(readFileSync(path, 'utf8'));
      metadata.state = 'candidate';
      writeFileSync(path, JSON.stringify(metadata, null, 2) + '\n');
      for (const name of docs) {
        const file = join(base, name);
        writeFileSync(file, readFileSync(file, 'utf8').replaceAll(name.includes('zh-CN') ? '本地候选' : 'Local candidate', 'Release'));
      }
    }, 'unpublished'],
  ];
  for (const [name, mutate, expected] of cases) await t.test(name, sub => {
    const base = fixture(sub); mutate(base); refresh(base);
    const errors = checkQuickStart(base);
    assert(errors.some(message => message.includes(expected)), `expected diagnostic: ${expected}`);
    assert(!errors.join('\n').includes('synthetic-canary-must-not-print'));
  });
});

test('CLI gate reports source drift without displaying configured values', t => {
  const base = fixture(t);
  replace(base, 'Dockerfile.cli', 'PIWORK_CONFIG_PATH=/var/lib/piwork/client/credentials.json', 'PIWORK_CONFIG_PATH=synthetic-canary-must-not-print');
  const result = spawnSync(process.execPath, [join(base, 'scripts/check-docker-quickstart.mjs')], { cwd: base, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /source inputs changed/);
  assert(!result.stderr.includes('synthetic-canary-must-not-print'));
});

test('website command and download drift is checked without a sibling-repository dependency', t => {
  const base = fixture(t), website = join(base, 'website');
  const release = JSON.parse(readFileSync(join(base, 'deploy/docker/release.json'), 'utf8'));
  for (const prefix of ['', 'zh/']) {
    const guide = join(website, 'docs', prefix, 'guide'); mkdirSync(guide, { recursive: true });
    mkdirSync(join(website, 'docs', prefix, 'spec'), { recursive: true });
    writeFileSync(join(website, 'docs', prefix, 'index.md'), prefix ? '# Home\n\n## 开始使用\n' : '# Home\n\n## Get started\n');
    for (const name of ['first-work.md', 'source-installation.md', 'index.md']) writeFileSync(join(guide, name), '# Fixture\n\n```sh\ndocker run old:tag\n```\n');
    writeFileSync(join(website, 'docs', prefix, 'spec/index.md'), '# Spec\n');
  }
  writeFileSync(join(website, 'README.md'), '## Content maintenance\n\n## Build and deployment\n');
  syncWebsite(website, release, base);
  const publicPath = join(website, 'docs/public/install', release.releaseId);
  assert.deepEqual(checkQuickStart(base, { websiteRoot: website }), []);
  const next = { ...release, releaseId: release.releaseId + '-next', images: Object.fromEntries(Object.entries(release.images).map(([role, ref]) => [role, ref + '-next'])) };
  const historical = join(website, 'docs/public/install/0.0.1'); mkdirSync(historical, { recursive: true });
  writeFileSync(join(historical, 'frozen.txt'), 'old-release');
  syncWebsite(website, next, base);
  for (const prefix of ['', 'zh/']) assert(readFileSync(join(website, 'docs', prefix, 'guide/first-work.md'), 'utf8').includes(next.images.cli));
  assert.equal(readFileSync(join(historical, 'frozen.txt'), 'utf8'), 'old-release');
  syncWebsite(website, release, base);
  for (const prefix of ['', 'zh/']) for (const name of ['index.md', 'guide/first-work.md', 'guide/installation.md', 'guide/source-installation.md', 'guide/index.md', 'spec/index.md']) {
    const path = join(website, 'docs', prefix, name), original = readFileSync(path, 'utf8');
    writeFileSync(path, original + '\n' + next.images.cli + '\n');
    assert(checkQuickStart(base, { websiteRoot: website }).some(message => message.includes('stale current image')), name);
    writeFileSync(path, original);
  }
  replace(website, 'docs/zh/guide/quick-start.md', 'Hello, Piwork!', 'A different message');
  assert(checkQuickStart(base, { websiteRoot: website }).some(message => message.includes('website zh/Quick Start')));
  writeFileSync(join(publicPath, 'docker-compose.yml'), 'different material');
  assert(checkQuickStart(base, { websiteRoot: website }).some(message => message.includes('website download')));
});

test('legacy download still stops on download, checksum and internal-integrity failures', async t => {
  const base = mkdtempSync(join(tmpdir(), 'piwork-legacy-installer-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const payload = join(base, 'payload/piwork-docker'), bin = join(base, 'bin');
  mkdirSync(payload, { recursive: true }); mkdirSync(bin);
  const bytes = 'PIWORK_CORE_IMAGE=fixture@sha256:' + 'a'.repeat(64) + '\n';
  const sha = data => createHash('sha256').update(data).digest('hex');
  writeFileSync(join(payload, 'release.env'), bytes);
  const archive = join(base, 'fixture.tar.gz'), checksum = join(base, 'fixture.sha256');
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
  const download = codeBlocks(section(readFileSync(join(projectRoot, 'deploy/docker/README.md'), 'utf8'), 'legacy-docker-quickstart'))[0].code;
  for (const mode of ['success', 'download-failure', 'wrong-checksum', 'invalid-checksum', 'invalid-internal-checksum']) await t.test(mode, () => {
    writeFileSync(join(payload, 'SHA256SUMS'), `${mode === 'invalid-internal-checksum' ? '0'.repeat(64) : sha(bytes)}  release.env\n`);
    assert.equal(spawnSync('tar', ['-C', join(base, 'payload'), '-czf', archive, 'piwork-docker']).status, 0);
    writeFileSync(checksum, mode === 'invalid-checksum' ? 'invalid checksum\n' : `${mode === 'wrong-checksum' ? '0'.repeat(64) : sha(readFileSync(archive))}  piwork-docker-0.0.1.tar.gz\n`);
    const cwd = join(base, mode); mkdirSync(cwd);
    const result = spawnSync('sh', ['-c', download + ' && printf continued > installation-continued\n'], { cwd, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PIWORK_DOWNLOAD_FIXTURE_MODE: mode, PIWORK_DOWNLOAD_FIXTURE_ARCHIVE: archive, PIWORK_DOWNLOAD_FIXTURE_CHECKSUM: checksum } });
    const continued = existsSync(join(cwd, 'piwork-preview-0.0.1/piwork-docker/installation-continued'));
    assert.equal(result.status === 0, mode === 'success');
    assert.equal(continued, mode === 'success');
  });
});
