import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkQuickStart, checkPackageMaterials, installerFiles, codeBlocks, section, projectRoot } from './check-docker-quickstart.mjs';
import { syncWebsite } from './sync-docker-website.mjs';
import { sourceInputHash, currentRelease } from './build-docker-release.mjs';
import { singleHostReadme, nativeQuickStart, quickStart } from './docker-quickstart-content.mjs';

test('published direct-entry releases describe shipped setup while older images retain their original instructions', () => {
  const release = { ...currentRelease(), state: 'published' };
  for (const language of ['en', 'zh']) {
    const old = quickStart({ ...release, releaseVersion: '0.0.8', controlPlanePort: undefined, corePort: undefined }, language, {});
    const shipped = quickStart({ ...release, releaseVersion: '0.0.9', controlPlanePort: 17891, corePort: 17871 }, language, {});
    assert.match(old, /matching release manual|对应版本手册/);
    assert.doesNotMatch(shipped, /build the current source|构建当前源码/);
    assert.match(shipped, /includes direct browser entry|包含直接访问与网页配置流程/);
  }
});

const docs = ['deploy/docker/README.md', 'deploy/docker/README.zh-CN.md'];
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'piwork-quickstart-contract-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  for (const path of ['cmd', 'internal', 'proto', 'apps', 'packages', 'scripts', 'config', 'deploy', 'examples']) cpSync(join(projectRoot, path), join(base, path), { recursive: true, filter: path => !/(?:^|\/)(?:node_modules|dist)(?:\/|$)/.test(relative(projectRoot,path)) });
  for (const name of ['README.md', 'README.zh-CN.md', 'AGENTS.md', 'LICENSE', '.dockerignore', 'go.mod', 'go.sum', 'package.json', 'package-lock.json', 'tsconfig.base.json', 'Dockerfile.core', 'Dockerfile.core.dockerignore', 'Dockerfile.agentd', 'Dockerfile.file-helper.native', 'Dockerfile.snapshot-helper.native', 'Dockerfile.docker-release']) copyFileSync(join(projectRoot, name), join(base, name));
  mkdirSync(join(base, 'apps/ui-shared/assets'), { recursive: true });
  copyFileSync(join(projectRoot, 'apps/ui-shared/assets/piwork-logo.png'), join(base, 'apps/ui-shared/assets/piwork-logo.png'));
  const candidate={...currentRelease(base),state:'candidate',controlPlanePort:17891,corePort:17871,serviceEntryMode:'path',sourceInputHash:sourceInputHash(base)};
  writeFileSync(join(base,'deploy/docker/candidate.json'),JSON.stringify(candidate,null,2)+'\n');
  for(const name of docs){
    const path=join(base,name);
    const text=readFileSync(path,'utf8');
    if(!/Local candidate|本地候选/.test(section(text,'docker-quickstart')))writeFileSync(path,text.replace('<!-- docker-quickstart:start -->','<!-- docker-quickstart:start -->\n'+(name.includes('zh-CN')?'本地候选':'Local candidate')+'\n'));
  }
  for(const [language,name] of [['en','README.md'],['zh','README.zh-CN.md']])writeFileSync(join(base,'examples/single-host',name),singleHostReadme(candidate,language));
  const input = join(base, 'dist/fixture-metadata.json'); mkdirSync(dirname(input), { recursive: true });
  writeFileSync(input, JSON.stringify(candidate));
  const sync = spawnSync(process.execPath, [join(base,'scripts/sync-docker-quickstart.mjs'),input], {cwd:base,encoding:'utf8'});
  assert.equal(sync.status,0,sync.stderr);
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
  assert.equal(baseline[0].code, './dist/go/piwork-core');
  for (const [language, name] of [['en', 'README.md'], ['zh', 'README.zh-CN.md']]) {
    const native = section(readFileSync(join(projectRoot, 'deploy/docker', name), 'utf8'), 'native-quickstart');
    assert.equal(native.trim(), nativeQuickStart(language, { buildLink: 'https://github.com/pphboy/piwork/blob/main/AGENTS.md#构建与验证' }).trim());
    assert.deepEqual(codeBlocks(native), baseline);
    for (const value of ['piwork/server', '--ui-port', '--core-port', '--data-dir', 'piwork-cli']) assert(native.includes(value), value);
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
      assert(section(text, 'native-quickstart').includes('./dist/go/piwork-core'));
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
    ['Service port drift', base => docs.forEach(name=>replace(base,name,'/services/<workId>/<serviceId>/<port>/','/old-service-ports/')), 'Service path drift'],
    ['Core bind', base => docs.forEach(name => replace(base, name, '--volume /var/lib/piwork/quickstart/core:/var/lib/piwork/quickstart/core', '--volume /var/lib/piwork/quickstart/core:/wrong')), 'complete startup'],
    ['language mismatch', base => replace(base, 'deploy/docker/README.zh-CN.md', '--stop-timeout 60', '--stop-timeout 59'), 'paired browser'],
    ['tutorial returned', base => writeFileSync(join(base, 'README.md'), readFileSync(join(base, 'README.md'), 'utf8') + '\n```sh\ndocker run old:tag\n```\n'), 'usage tutorials'],
    ['preview omitted', base => replace(base, 'README.md', '?include_prereleases', ''), 'release badge'],
    ['preview disabled', base => replace(base, 'README.md', '?include_prereleases', '?include_prereleases=false'), 'release badge'],
    ['wrong badge repository', base => replace(base, 'README.zh-CN.md', '/github/stars/pphboy/piwork', '/github/stars/example/other'), 'stars badge'],
    ['wrong release target', base => replace(base, 'README.md', '](https://github.com/pphboy/piwork/releases)', '](https://github.com/pphboy/piwork/releases/latest)'), 'release badge'],
    ['missing manual navigation', base => replace(base, 'README.md', '](deploy/docker/README.md)', '](deploy/docker/missing.md)'), 'documentation navigation'],
    ['missing native data guidance', base => replace(base, 'deploy/docker/README.md', 'piwork/server under the user configuration directory', 'Data defaults elsewhere'), 'native Linux'],
    ['Logo alignment', base => replace(base, 'README.md', '<p align="center">', '<p align="left">'), 'Logo'],
    ['old Docker build context', base => writeFileSync(join(base, 'Dockerfile.core.dockerignore'), '**\n!dist/\n'), 'source exclusions'],
    ['Compose host network', base => replace(base, 'deploy/docker/docker-compose.yml.template', 'network_mode: host', 'network_mode: bridge'), 'Core host'],
    ['Compose env file', base => replace(base, 'deploy/docker/docker-compose.yml.template', '    volumes:', '    env_file: ./core.env\n    volumes:'), 'single-file'],
    ['legacy model init returned', base => replace(base, 'deploy/docker/docker-compose.yml.template', '    volumes:', '    environment:\n      PIWORK_MODEL: synthetic\n    volumes:'), 'no business environment'],
    ['Core file includes CLI', base => replace(base, 'deploy/docker/docker-compose.yml.template', 'services:', 'services:\n  cli:\n    image: unexpected'), 'Core only'],
    ['example dependency', base => replace(base, 'examples/single-host/docker-compose.yml.template', '    volumes:', '    depends_on: [core]\n    volumes:'), 'lifecycle dependencies'],
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
  replace(base, 'Dockerfile.core', 'DOCKER_HOST=unix:///var/run/docker.sock', 'DOCKER_HOST=synthetic-canary-must-not-print');
  const result = spawnSync(process.execPath, [join(base, 'scripts/check-docker-quickstart.mjs')], { cwd: base, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /source inputs changed/);
  assert(!result.stderr.includes('synthetic-canary-must-not-print'));
});

test('server website sync preserves editorial pages, desktop downloads and historical identities', t => {
  const base = fixture(t), website = join(base, 'website');
  const release = JSON.parse(readFileSync(join(base, 'deploy/docker/candidate.json'), 'utf8'));
  const protectedFiles = new Map();
  for (const prefix of ['', 'zh/']) {
    for (const name of ['index.md', 'guide/downloads.md', 'guide/quick-start.md', 'guide/first-work.md', 'guide/index.md', 'spec/index.md']) {
      protectedFiles.set(`docs/${prefix}${name}`, `# Editorial ${prefix}${name}\n\n<Homepage />\nOne-click desktop download.\n`);
    }
  }
  protectedFiles.set('docs/.vitepress/theme/HomeStory.vue', '<template>Creative Studio</template>\n');
  protectedFiles.set('docs/.vitepress/theme/download-release.json', '{"version":"0.2.0"}\n');
  protectedFiles.set('docs/public/screenshots/work.webp', 'synthetic-image-bytes');
  for (const [name, contents] of protectedFiles) {
    const path = join(website, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, contents);
  }
  const readme = '# Editorial README\n\n<!-- server-release:start -->\nold\n<!-- server-release:end -->\n\nKeep this footer.\n';
  writeFileSync(join(website, 'README.md'), readme);
  const rootTexts = ['README.md', 'README.zh-CN.md'].map(name => [name, readFileSync(join(base, name))]);
  for (const [name] of rootTexts) writeFileSync(join(base, name), '# Piwork\n');
  syncWebsite(website, release, base);
  for (const [name, bytes] of rootTexts) writeFileSync(join(base, name), bytes);
  const assertEditorial = () => {
    for (const [name, bytes] of protectedFiles) assert.equal(readFileSync(join(website, name), 'utf8'), bytes, name);
    const updated = readFileSync(join(website, 'README.md'), 'utf8');
    assert(updated.startsWith('# Editorial README\n\n') && updated.endsWith('\n\nKeep this footer.\n'));
  };
  assertEditorial();
  for (const prefix of ['', 'zh/']) {
    const installation = readFileSync(join(website, 'docs', prefix, 'guide/installation.md'), 'utf8');
    assert(!installation.includes('undefined'));
    assert.deepEqual(codeBlocks(section(installation, 'docker-quickstart')), codeBlocks(section(readFileSync(join(base, 'deploy/docker/README.md'), 'utf8'), 'docker-quickstart')));
    const source = readFileSync(join(website, 'docs', prefix, 'guide/source-installation.md'), 'utf8');
    assert.equal(section(source, 'native-quickstart').trim(), nativeQuickStart(prefix ? 'zh' : 'en').trim());
    assert(source.includes('piwork/server') && !source.includes('piwork setup link'));
  }
  assert.deepEqual(checkQuickStart(base, { websiteRoot: website }), []);
  const next = { ...release, releaseId: release.releaseId + '-next', images: Object.fromEntries(Object.entries(release.images).map(([role, ref]) => [role, ref + '-next'])) };
  const historical = join(website, 'docs/public/install/0.0.1'); mkdirSync(historical, { recursive: true });
  writeFileSync(join(historical, 'frozen.txt'), 'old-release');
  syncWebsite(website, next, base);
  assertEditorial();
  for (const prefix of ['', 'zh/']) assert(readFileSync(join(website, 'docs', prefix, 'guide/installation.md'), 'utf8').includes(next.releaseId));
  assert.equal(readFileSync(join(historical, 'frozen.txt'), 'utf8'), 'old-release');
  syncWebsite(website, { ...release, state: 'published' }, base);
  assertEditorial();
  assert(readFileSync(join(website, 'README.md'), 'utf8').includes('state: published'));
  assert(readFileSync(join(website, 'docs/public/install', release.releaseId, 'README.txt'), 'utf8').includes('anonymous image readability verified'));
  // Sites without an explicit managed slot are entirely editorial, including README.
  writeFileSync(join(website, 'README.md'), '# No managed slot\n');
  syncWebsite(website, release, base);
  assert.equal(readFileSync(join(website, 'README.md'), 'utf8'), '# No managed slot\n');
  for (const prefix of ['', 'zh/']) for (const name of ['installation.md', 'source-installation.md']) {
    const path = join(website, 'docs', prefix, 'guide', name), original = readFileSync(path, 'utf8');
    writeFileSync(path, original + '\n' + next.images.core + '\n');
    assert(checkQuickStart(base, { websiteRoot: website }).some(message => message.includes('stale current image')), name);
    writeFileSync(path, original);
  }
  replace(website, 'docs/zh/guide/installation.md', '--stop-timeout 60', '--stop-timeout 59');
  assert(checkQuickStart(base, { websiteRoot: website }).some(message => message.includes('installation: startup commands')));
  replace(website, 'docs/guide/source-installation.md', '--data-dir', '--incorrect-data-dir');
  assert(checkQuickStart(base, { websiteRoot: website }).some(message => message.includes('native Linux instructions')));
  writeFileSync(join(website, 'docs/public/install', release.releaseId, 'docker-compose.yml'), 'different material');
  assert(checkQuickStart(base, { websiteRoot: website }).some(message => message.includes('website download')));
});
