import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkQuickStart, checkPackageMaterials, installerFiles, codeBlocks, section, projectRoot } from './check-docker-quickstart.mjs';
import { syncWebsite } from './sync-docker-website.mjs';
import { sourceInputHash, currentRelease } from './build-docker-release.mjs';
import { singleHostReadme, nativeQuickStart } from './docker-quickstart-content.mjs';

const docs = ['deploy/docker/README.md', 'deploy/docker/README.zh-CN.md'];
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'piwork-quickstart-contract-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  for (const path of ['cmd', 'internal', 'proto', 'apps', 'packages', 'scripts', 'config', 'deploy', 'examples']) cpSync(join(projectRoot, path), join(base, path), { recursive: true, filter: path => !/\/(?:node_modules|dist)(?:\/|$)/.test(path) });
  for (const name of ['README.md', 'README.zh-CN.md', 'AGENTS.md', 'LICENSE', '.dockerignore', 'go.mod', 'go.sum', 'package.json', 'package-lock.json', 'tsconfig.base.json', 'Dockerfile.core', 'Dockerfile.cli', 'Dockerfile.core.dockerignore', 'Dockerfile.cli.dockerignore', 'Dockerfile.agentd', 'Dockerfile.file-helper.native', 'Dockerfile.snapshot-helper.native', 'Dockerfile.docker-release']) copyFileSync(join(projectRoot, name), join(base, name));
  mkdirSync(join(base, 'apps/ui-shared/assets'), { recursive: true });
  copyFileSync(join(projectRoot, 'apps/ui-shared/assets/piwork-logo.png'), join(base, 'apps/ui-shared/assets/piwork-logo.png'));
  const candidate={...currentRelease(base),state:'candidate',sourceInputHash:sourceInputHash(base)};
  writeFileSync(join(base,'deploy/docker/candidate.json'),JSON.stringify(candidate,null,2)+'\n');
  for(const name of docs){
    const path=join(base,name);
    const text=readFileSync(path,'utf8');
    if(!/Local candidate|本地候选/.test(section(text,'docker-quickstart')))writeFileSync(path,text.replace('<!-- docker-quickstart:start -->','<!-- docker-quickstart:start -->\n'+(name.includes('zh-CN')?'本地候选':'Local candidate')+'\n'));
  }
  for(const [language,name] of [['en','README.md'],['zh','README.zh-CN.md']])writeFileSync(join(base,'examples/single-host',name),singleHostReadme(candidate,language));
  refresh(base);
  return base;
}
function refresh(base) {
  const path = join(base, 'deploy/docker/candidate.json');
  const metadata = JSON.parse(readFileSync(path, 'utf8'));
  if (metadata.state === 'candidate') metadata.sourceInputHash = sourceInputHash(base);
  writeFileSync(path, JSON.stringify(metadata, null, 2) + '\n');
}
function replace(base, name, from, to) {
  const path = join(base, name), text = readFileSync(path, 'utf8');
  assert(text.includes(from), `fixture target exists: ${name}`);
  writeFileSync(path, text.replaceAll(from, to));
}

test('paired default commands are standalone, browser-first and parse as shell', () => {
  for(const name of docs){const text=readFileSync(join(projectRoot,name),'utf8');assert(text.includes('Save and continue'));}
  const baseline = codeBlocks(section(readFileSync(join(projectRoot, docs[0]), 'utf8'), 'docker-quickstart'));
  for (const name of docs) {
    const blocks = codeBlocks(section(readFileSync(join(projectRoot, name), 'utf8'), 'docker-quickstart'));
    assert.deepEqual(blocks, baseline);
    for (const block of blocks) assert.equal(spawnSync('sh', ['-n'], { input: block.code }).status, 0);
  }
});

test('native Linux instructions retain startup, data, setup and historical client boundaries', () => {
  const baseline = codeBlocks(nativeQuickStart('en'));
  assert.deepEqual(baseline, [{ language: 'sh', code: './dist/go/piwork --no-open' }]);
  for (const [language, name] of [['en', 'README.md'], ['zh', 'README.zh-CN.md']]) {
    const native = section(readFileSync(join(projectRoot, 'deploy/docker', name), 'utf8'), 'native-quickstart');
    assert.equal(native.trim(), nativeQuickStart(language, { buildLink: '../../AGENTS.md#构建与验证' }).trim());
    assert.deepEqual(codeBlocks(native), baseline);
    for (const value of ['piwork/server', '0.0.0.0:7171', '--data-dir', 'piwork-cli', 'piwork-console', 'releases/download/v0.0.7/', 'releases/download/v0.0.5/']) assert(native.includes(value), value);
    for (const block of codeBlocks(native)) assert.equal(spawnSync('sh', ['-n'], { input: block.code }).status, 0);
  }
});

test('material synchronization leaves short READMEs and published history untouched across releases', t => {
  const base = fixture(t);
  const roots = ['README.md', 'README.zh-CN.md'];
  const texts = roots.map(name => `# Piwork\n\n[Documentation](deploy/docker/${name})\n`);
  roots.forEach((name, index) => writeFileSync(join(base, name), texts[index]));
  const published = readFileSync(join(base, 'deploy/docker/release.json'));
  const legacy = docs.filter(name => name.startsWith('deploy/')).map(name => readFileSync(join(base, name), 'utf8').split('## Legacy 0.0.1 installer')[1]);
  const original = currentRelease(base);
  for (const next of [false, false, true]) {
    const metadata = next ? { ...original, releaseId: original.releaseId + '-next', images: Object.fromEntries(Object.entries(original.images).map(([role, reference]) => [role, reference + '-next'])) } : original;
    const input = join(base, 'dist/sync-input.json'); mkdirSync(dirname(input), { recursive: true });
    writeFileSync(input, JSON.stringify(metadata));
    const result = spawnSync(process.execPath, [join(base, 'scripts/sync-docker-quickstart.mjs'), input], { cwd: base, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    roots.forEach((name, index) => assert.equal(readFileSync(join(base, name), 'utf8'), texts[index]));
    assert.deepEqual(readFileSync(join(base, 'deploy/docker/release.json')), published);
    docs.filter(name => name.startsWith('deploy/')).forEach((name, index) => {
      const text = readFileSync(join(base, name), 'utf8');
      assert.equal(text.split('## Legacy 0.0.1 installer')[1], legacy[index]);
      assert(section(text, 'docker-quickstart').includes(metadata.images.core));
      if (next) assert(!section(text, 'docker-quickstart').includes(original.images.core + '\n'));
      assert(section(text, 'native-quickstart').includes('./dist/go/piwork --no-open'));
    });
  }
});

test('candidate synchronization preserves the last published artifact identity', t => {
 const base=fixture(t);
 const path=join(base,'deploy/docker/release.json');const original=readFileSync(path,'utf8');
 writeFileSync(join(base,'cmd/new-development-input.go'),'// New candidate input.\n');
 assert(checkQuickStart(base).some(message=>message.includes('source inputs changed')));
 refresh(base);assert.deepEqual(checkQuickStart(base),[]);
 assert.equal(readFileSync(path,'utf8'),original);
});

test('packaged candidate is checked against current review inputs while published provenance stays unchanged', t => {
  const base=fixture(t), release=currentRelease(base), output=join(base,'dist/installer');
  mkdirSync(output,{recursive:true});
  const manifest={...release,images:Object.fromEntries(Object.entries(release.images).map(([role,reference])=>[role,{reference,imageId:'sha256:'+'a'.repeat(64)}]))};
  for(const name of installerFiles.filter(name=>name!=='SHA256SUMS'))writeFileSync(join(output,name),name==='release-manifest.json'?JSON.stringify(manifest):name);
  copyFileSync(join(base,'deploy/docker/docker-compose.yml'),join(output,'docker-compose.yml'));
  copyFileSync(join(base,'examples/single-host/docker-compose.yml'),join(output,'single-host-compose.yml'));
  writeFileSync(join(output,'SHA256SUMS'),installerFiles.filter(name=>name!=='SHA256SUMS').map(name=>createHash('sha256').update(readFileSync(join(output,name))).digest('hex')+'  '+name+'\n').join(''));
  assert.deepEqual(checkPackageMaterials(output,base),[]);
  manifest.sourceInputHash='b'.repeat(64);writeFileSync(join(output,'release-manifest.json'),JSON.stringify(manifest));
  assert(checkPackageMaterials(output,base).includes('candidate source identity differs'));
});

test('a consistent local candidate requires current inputs and an explicit candidate label', t => {
  const base = fixture(t);
  const path = join(base, 'deploy/docker/candidate.json');
  const metadata = JSON.parse(readFileSync(path, 'utf8'));
  metadata.state = 'candidate';
  writeFileSync(path, JSON.stringify(metadata));
  writeFileSync(join(base, 'examples/single-host/README.md'), singleHostReadme(metadata, 'en'));
  writeFileSync(join(base, 'examples/single-host/README.zh-CN.md'), singleHostReadme(metadata, 'zh'));
  for (const name of docs) {
    const file = join(base, name);
    writeFileSync(file, readFileSync(file, 'utf8').replace('<!-- docker-quickstart:start -->', '<!-- docker-quickstart:start -->\nLocal candidate / 本地候选\n'));
  }
  refresh(base);
  assert.deepEqual(checkQuickStart(base), []);
  writeFileSync(join(base, 'cmd/new-candidate-input.go'), '// Changed after candidate preparation.\n');
  assert(checkQuickStart(base).some(error => error.includes('source inputs changed')));
});

test('semantic deployment drift fails with safe diagnostics', async t => {
  const cases = [
    ['Core bind', base => docs.forEach(name => replace(base, name, '--volume /var/lib/piwork/quickstart/core:/var/lib/piwork/quickstart/core', '--volume /var/lib/piwork/quickstart/core:/wrong')), 'complete startup'],
    ['Core secret leaked to CLI', base => replace(base, 'examples/single-host/docker-compose.yml.template', '      PIWORK_CORE_URL:', '      PIWORK_API_KEY: synthetic-canary-must-not-print\n      PIWORK_CORE_URL:'), 'CLI must not receive'],
    ['language mismatch', base => replace(base, 'deploy/docker/README.zh-CN.md', '--stop-timeout 60', '--stop-timeout 59'), 'paired browser'],
    ['tutorial returned', base => writeFileSync(join(base, 'README.md'), readFileSync(join(base, 'README.md'), 'utf8') + '\n```sh\ndocker run old:tag\n```\n'), 'usage tutorials'],
    ['preview omitted', base => replace(base, 'README.md', '?include_prereleases', ''), 'release badge'],
    ['preview disabled', base => replace(base, 'README.md', '?include_prereleases', '?include_prereleases=false'), 'release badge'],
    ['wrong badge repository', base => replace(base, 'README.zh-CN.md', '/github/stars/pphboy/piwork', '/github/stars/example/other'), 'stars badge'],
    ['wrong release target', base => replace(base, 'README.md', '](https://github.com/pphboy/piwork/releases)', '](https://github.com/pphboy/piwork/releases/latest)'), 'release badge'],
    ['missing manual navigation', base => replace(base, 'README.md', '](deploy/docker/README.md)', '](deploy/docker/missing.md)'), 'documentation navigation'],
    ['missing native data guidance', base => replace(base, 'deploy/docker/README.md', 'Data defaults to `piwork/server`', 'Data defaults elsewhere'), 'native Linux'],
    ['Logo alignment', base => replace(base, 'README.md', '<p align="center">', '<p align="left">'), 'Logo'],
    ['image state path', base => replace(base, 'Dockerfile.cli', 'PIWORK_CONFIG_PATH=/var/lib/piwork/client/credentials.json', 'PIWORK_CONFIG_PATH=/wrong'), 'private persistent'],
    ['old Docker build context', base => writeFileSync(join(base, 'Dockerfile.core.dockerignore'), '**\n!dist/\n'), 'source/secret'],
    ['missing readiness', base => replace(base, 'deploy/docker/wait-core.sh', 'readyz?profile=docker-delivery', 'healthz'), 'exact full-readiness'],
    ['Compose host network', base => replace(base, 'deploy/docker/docker-compose.yml.template', 'network_mode: host', 'network_mode: bridge'), 'Core host'],
    ['Compose env file', base => replace(base, 'deploy/docker/docker-compose.yml.template', '    volumes:', '    env_file: ./core.env\n    volumes:'), 'single-file'],
    ['legacy model init returned', base => replace(base, 'deploy/docker/docker-compose.yml.template', '    volumes:', '    environment:\n      PIWORK_MODEL: synthetic\n    volumes:'), 'no business environment'],
    ['CLI gets socket', base => replace(base, 'examples/single-host/docker-compose.yml.template', '      - client-state:/var/lib/piwork/client', '      - /var/run/docker.sock:/var/run/docker.sock'), 'CLI must not receive'],
    ['Core file includes CLI', base => replace(base, 'deploy/docker/docker-compose.yml.template', 'services:', 'services:\n  cli:\n    image: unexpected'), 'Core only'],
    ['example dependency', base => replace(base, 'examples/single-host/docker-compose.yml.template', '    profiles: [cli]', '    profiles: [cli]\n    depends_on: [core]'), 'lifecycle dependencies'],
    ['shutdown budget', base => replace(base, 'deploy/docker/docker-compose.yml.template', 'stop_grace_period: 60s', 'stop_grace_period: 10s'), 'shutdown budget'],
    ['generated material changed', base => replace(base, 'deploy/docker/docker-compose.yml', 'name: piwork-quickstart', 'name: another'), 'generated file'],
    ['candidate warning removed', base => {
      // This negative case must remain a candidate even when the checkout is published.
      const path = join(base, 'deploy/docker/candidate.json');
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
  const path = join(base, 'deploy/docker/candidate.json');
  const metadata = JSON.parse(readFileSync(path, 'utf8'));
  metadata.state = 'candidate';
  writeFileSync(path, JSON.stringify(metadata));
  refresh(base);
  replace(base, 'Dockerfile.cli', 'PIWORK_CONFIG_PATH=/var/lib/piwork/client/credentials.json', 'PIWORK_CONFIG_PATH=synthetic-canary-must-not-print');
  const result = spawnSync(process.execPath, [join(base, 'scripts/check-docker-quickstart.mjs')], { cwd: base, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /source inputs changed/);
  assert(!result.stderr.includes('synthetic-canary-must-not-print'));
});

test('website command and download drift is checked without a sibling-repository dependency', t => {
  const base = fixture(t), website = join(base, 'website');
  const release = JSON.parse(readFileSync(join(base, 'deploy/docker/candidate.json'), 'utf8'));
  for (const prefix of ['', 'zh/']) {
    const guide = join(website, 'docs', prefix, 'guide'); mkdirSync(guide, { recursive: true });
    mkdirSync(join(website, 'docs', prefix, 'spec'), { recursive: true });
    writeFileSync(join(website, 'docs', prefix, 'index.md'), prefix ? '# Home\n\n## 开始使用\n' : '# Home\n\n## Get started\n');
    for (const name of ['first-work.md', 'source-installation.md', 'index.md']) writeFileSync(join(guide, name), '# Fixture\n\n```sh\ndocker run old:tag\n```\n');
    writeFileSync(join(website, 'docs', prefix, 'spec/index.md'), '# Spec\n');
  }
  writeFileSync(join(website, 'README.md'), '## Content maintenance\n\n## Build and deployment\n');
  const rootTexts = ['README.md', 'README.zh-CN.md'].map(name => [name, readFileSync(join(base, name))]);
  for (const [name] of rootTexts) writeFileSync(join(base, name), '# Piwork\n');
  syncWebsite(website, release, base);
  for (const [name, bytes] of rootTexts) writeFileSync(join(base, name), bytes);
  const publicPath = join(website, 'docs/public/install', release.releaseId);
  for (const prefix of ['', 'zh/']) {
    const quickStart = readFileSync(join(website, 'docs', prefix, 'guide/quick-start.md'), 'utf8');
    assert(!quickStart.includes('undefined'));
    const native = section(quickStart, 'native-quickstart');
    assert.deepEqual(codeBlocks(native), codeBlocks(nativeQuickStart('en')));
    assert(native.includes(`](/${prefix}guide/source-installation.html)`));
    assert(native.includes('piwork/server') && !native.includes('piwork setup link'));
    assert(native.includes(prefix ? '停止受管 Work' : 'stops managed Works'));
    const source = readFileSync(join(website, 'docs', prefix, 'guide/source-installation.md'), 'utf8');
    assert(source.includes('blob/main/openspec/specs/docker-delivery/spec.md'));
    for (const name of ['quick-start.md', 'installation.md', 'source-installation.md']) {
      assert(!readFileSync(join(website, 'docs', prefix, 'guide', name), 'utf8').includes('openspec/changes/remove-docs-dir/'));
    }
  }
  assert.deepEqual(checkQuickStart(base, { websiteRoot: website }), []);
  const next = { ...release, releaseId: release.releaseId + '-next', images: Object.fromEntries(Object.entries(release.images).map(([role, ref]) => [role, ref + '-next'])) };
  const historical = join(website, 'docs/public/install/0.0.1'); mkdirSync(historical, { recursive: true });
  writeFileSync(join(historical, 'frozen.txt'), 'old-release');
  syncWebsite(website, next, base);
  for (const prefix of ['', 'zh/']) assert(readFileSync(join(website, 'docs', prefix, 'index.md'), 'utf8').includes(next.releaseId));
  assert.equal(readFileSync(join(historical, 'frozen.txt'), 'utf8'), 'old-release');
  syncWebsite(website, {...release,state:'published'}, base);
  for(const prefix of ['', 'zh/']) {
    const home=readFileSync(join(website,'docs',prefix,'index.md'),'utf8');
    assert(!home.includes('Candidate images have not been published.'));
    assert(!home.includes('候选镜像尚未公开发布'));
    assert(home.includes(prefix?'镜像已发布并完成匿名核验':'Images are published and anonymously verified'));
  }
  assert(readFileSync(join(publicPath,'README.txt'),'utf8').includes('anonymous image readability verified'));
  assert(!readFileSync(join(website,'README.md'),'utf8').includes('Candidate image/download availability is not public'));
  assert.equal(readFileSync(join(historical, 'frozen.txt'), 'utf8'), 'old-release');
  syncWebsite(website, release, base);
  for (const prefix of ['', 'zh/']) for (const name of ['index.md', 'guide/first-work.md', 'guide/installation.md', 'guide/source-installation.md', 'guide/index.md', 'spec/index.md']) {
    const path = join(website, 'docs', prefix, name), original = readFileSync(path, 'utf8');
    writeFileSync(path, original + '\n' + next.images.cli + '\n');
    assert(checkQuickStart(base, { websiteRoot: website }).some(message => message.includes('stale current image')), name);
    writeFileSync(path, original);
  }
  replace(website, 'docs/zh/guide/quick-start.md', '--stop-timeout 60', '--stop-timeout 59');
  assert(checkQuickStart(base, { websiteRoot: website }).some(message => message.includes('website zh/Quick Start')));
  replace(website, 'docs/guide/quick-start.md', '--data-dir', '--incorrect-data-dir');
  assert(checkQuickStart(base, { websiteRoot: website }).some(message => message.includes('native Linux instructions')));
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
