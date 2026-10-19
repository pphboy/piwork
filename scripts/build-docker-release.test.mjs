import test from 'node:test';
import {nativeServerDefaults} from './native-server-defaults.mjs';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { identity, coreReleaseConfig, verifyImageRecords, writeMetadata, writeMaterials, roles, protocols, binaries } from './build-docker-release.mjs';

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'piwork-docker-release-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  for (const name of ['cmd', 'internal/releaseinfo', 'internal/corestore', 'proto', 'packages', 'apps/desktop-webui/src', 'apps/desktop-webui/public', 'apps/desktop-webui/scripts', 'scripts', 'config', 'deploy/docker', 'examples/single-host', 'apps/ui-shared/assets']) mkdirSync(join(base, name), { recursive: true });
  for (const name of ['apps/desktop-webui/tsconfig.json', 'apps/desktop-webui/package.json', 'scripts/sync-desktop-assets.mjs', 'package-lock.json']) writeFileSync(join(base, name), '{}');
  writeFileSync(join(base,'apps/ui-shared/browser-crypto.js'),'synthetic browser crypto');
  writeFileSync(join(base,'apps/ui-shared/tokens.css'),'synthetic shared tokens');
  writeFileSync(join(base, 'package.json'), '{"version":"0.0.1"}');
  writeFileSync(join(base,'internal/releaseinfo/notes.json'),JSON.stringify({version:1,releases:[]}));
  writeFileSync(join(base, 'apps/ui-shared/assets/piwork-logo.png'), 'synthetic-public-logo');
  writeFileSync(join(base, 'internal/corestore/store.go'), 'const Format = "piwork-go-core"\nconst SchemaVersion = 1\n');
  copyFileSync(new URL('../examples/single-host/docker-compose.yml.template', import.meta.url), join(base, 'examples/single-host/docker-compose.yml.template'));
  copyFileSync(new URL('../config/docker-release.json', import.meta.url), join(base, 'config/docker-release.json'));
  for (const name of ['src','public','scripts']) mkdirSync(join(base,'apps/console-webui',name),{recursive:true});
  for (const name of ['apps/console-webui/package.json','apps/console-webui/tsconfig.json','scripts/sync-console-assets.mjs']) writeFileSync(join(base,name),'{}');
  const environment = { PIWORK_COMMIT: 'a'.repeat(40), PIWORK_MODIFIED: 'true' };
  return { base, environment };
}
function records(metadata) {
  return Object.fromEntries(roles.map((role, i) => {
    const labels = { 'org.opencontainers.image.version': metadata.releaseVersion, 'org.opencontainers.image.revision': metadata.sourceCommit, 'io.piwork.source.modified': String(metadata.sourceModified), 'io.piwork.source.input-sha256': metadata.sourceInputHash, ...protocols[role] };
    if (role === 'cli' || role === 'core') labels['io.piwork.desktop.input-sha256'] = metadata.desktopUIHash;
    if (role === 'core') labels['io.piwork.console.input-sha256'] = metadata.consoleUIHash;
    const image = { Id: `sha256:${String(i + 1).repeat(64)}`, Os: 'linux', Architecture: 'amd64', RepoTags: [metadata.images[role]], Config: { Labels: labels } };
    const versions = Object.fromEntries(binaries[role].map(program => [program, { program, version: metadata.releaseVersion, commit: metadata.sourceCommit, modified: metadata.sourceModified, os: 'linux', architecture: 'amd64', goVersion: 'go1.25.5', ...(role === 'cli' ? { desktopUIHash: metadata.desktopUIHash } : role === 'core' ? {desktopUIHash:metadata.desktopUIHash,consoleUIHash:metadata.consoleUIHash} : {}) }]));
    return [role, { image, versions, runtimeBoundary: true, ...(role === 'core' ? { releaseConfig: coreReleaseConfig(metadata) } : {}) }];
  }));
}

test('metadata requires real identity and detects changed build inputs', t => {
  const { base, environment } = fixture(t);
  const first = identity(base, environment);
  assert.match(first.releaseId, /^0\.0\.1-a{12}-[a-f0-9]{12}-dirty$/);
  assert.equal(first.images.core, `docker.io/pphboy/piwork-core:${first.releaseId}`);
  for (const overrides of [{ PIWORK_COMMIT: 'unknown' }, { PIWORK_MODIFIED: '' }, { PIWORK_RELEASE_REGISTRY: 'https://secret@example.invalid' }, { PIWORK_SOURCE_INPUT_HASH: '0'.repeat(64) }, { PIWORK_DESKTOP_UI_HASH: '0'.repeat(64) }, { PIWORK_VERSION: 'stale' }]) assert.throws(() => identity(base, { ...environment, ...overrides }));
  writeFileSync(join(base, 'README.md'), 'Documentation changes do not create a source-hash reference cycle.');
  writeFileSync(join(base, '.env.private'), 'SYNTHETIC_CANARY=do-not-read');
  for(const directory of ['coverage','test-results','playwright-report']) {
    mkdirSync(join(base,'apps/console-webui',directory),{recursive:true});
    writeFileSync(join(base,'apps/console-webui',directory,'.last-run.json'),'Temporary browser output must not change release identity.');
  }
  assert.equal(identity(base, environment).sourceInputHash, first.sourceInputHash);
  writeFileSync(join(base, 'apps/ui-shared/assets/piwork-logo.png'), 'changed-synthetic-public-logo');
  assert.notEqual(identity(base, environment).sourceInputHash, first.sourceInputHash);
  writeFileSync(join(base,'internal/releaseinfo/notes.json'),JSON.stringify({version:1,releases:[]},null,2));
  assert.notEqual(identity(base,environment).sourceInputHash,first.sourceInputHash);
  writeFileSync(join(base, 'cmd/new.go'), 'package main');
  assert.notEqual(identity(base, environment).sourceInputHash, first.sourceInputHash);
});

test('metadata outputs nonsecret image defaults and matching client stamps', t => {
  const { base, environment } = fixture(t);
  const metadata = identity(base, environment);
  const output = join(base, 'out');
  writeMetadata(metadata, output);
  const defaults = JSON.parse(readFileSync(join(output, 'docker-release.json'), 'utf8'));
  assert.deepEqual(defaults, coreReleaseConfig(metadata));
  assert.equal(defaults.images.packageHelper, defaults.images.agent);
  assert(!/password|apiKey|token|credential/i.test(JSON.stringify(defaults)));
  assert(readFileSync(join(output, 'cli.ldflags'), 'utf8').includes(metadata.desktopUIHash));
  assert(readFileSync(join(output,'core.ldflags'),'utf8').includes(metadata.consoleUIHash));
  const flags=readFileSync(join(output,'core.ldflags'),'utf8');
  const encoded=flags.match(/EncodedImages=([^ ]+)/)[1];
  assert.deepEqual(JSON.parse(Buffer.from(encoded,'base64')),defaults.images);
});

test('candidate checks reject stale binaries, resources, protocols and missing boundary evidence', t => {
  const { base, environment } = fixture(t);
  const metadata = identity(base, environment);
  assert.equal(verifyImageRecords(metadata, records(metadata)).packageHelper.imageId, records(metadata).agent.image.Id);
  for (const mutate of [
    r => { r.core.image.Config.Labels['org.opencontainers.image.revision'] = 'b'.repeat(40); },
    r => { r.cli.versions['piwork-cli'].desktopUIHash = '0'.repeat(64); },
    r => { r.agent.image.Config.Labels['io.piwork.work-history.schema'] = '4'; },
    r => { r.fileHelper.versions['piwork-file-helper'].modified = false; },
    r => { r.snapshotHelper.image.Architecture = 'arm64'; },
    r => { r.core.runtimeBoundary = false; },
    r => { r.core.releaseConfig.images.agent = 'wrong:tag'; },
    r => { r.cli.image.Config.Healthcheck = { Test: ['CMD', 'curl'] }; },
    r => { r.core.image.RepoTags = ['another:candidate']; },
    r => { r.core.existingImageId = 'sha256:' + '0'.repeat(64); },
  ]) {
    const changed = records(metadata); mutate(changed);
    assert.throws(() => verifyImageRecords(metadata, changed));
  }
});

test('local candidates cannot be promoted using a config ID as a registry digest', t => {
  const { base, environment } = fixture(t);
  const metadata = identity(base, environment);
  const local = records(metadata);
  assert.throws(() => verifyImageRecords(metadata, local, { published: true }), /published/);
  for (const role of roles) {
    local[role].registryDigest = `sha256:${'f'.repeat(64)}`;
    local[role].anonymousReadable = true;
    local[role].publishedImageId = local[role].image.Id;
    const repository = metadata.images[role].slice(0, metadata.images[role].lastIndexOf(':'));
    local[role].image.RepoDigests = [`${repository}@${local[role].registryDigest}`];
  }
  assert.match(verifyImageRecords(metadata, local, { published: true }).core.digestReference, /@sha256:/);
  local.agent.publishedImageId = 'sha256:' + '0'.repeat(64);
  assert.throws(() => verifyImageRecords(metadata, local, { published: true }), /published/);
});

test('materials render Core-only and single-host Compose and honestly record local provenance', t => {
  const { base, environment } = fixture(t);
  const metadata = identity(base, environment);
  writeFileSync(join(base, 'deploy/docker/docker-compose.yml.template'), 'services:\n  core:\n    image: @PIWORK_CORE_IMAGE@\n');
  const output = join(base, 'out');
  writeMaterials(metadata, records(metadata), output, { base });
  const manifest = JSON.parse(readFileSync(join(output, 'release-manifest.json'), 'utf8'));
  assert.equal(manifest.state, 'candidate');
  assert.equal(manifest.images.core.digest, undefined);
  assert(!readFileSync(join(output, 'docker-compose.yml'), 'utf8').includes('@PIWORK_'));
  assert.equal(readFileSync(join(output, 'push-commands.sh'), 'utf8').match(/^docker push /gm).length, 5);
  assert.match(readFileSync(join(output, 'README.txt'), 'utf8'), /Local candidate only/);
  assert.match(readFileSync(join(output, 'SHA256SUMS'), 'utf8'), /docker-compose.yml/);
  writeFileSync(join(base, 'deploy/docker/docker-compose.yml.template'), 'services:\n  core:\n    env_file: ./core.env\n');
  assert.throws(() => writeMaterials(metadata, records(metadata), output, { base }), /standalone/);
});


test('native server stamps use the exact reviewed dependencies and both browser input identities',t=>{
 const {base,environment}=fixture(t),metadata=identity(base,environment);
 assert.deepEqual(JSON.parse(Buffer.from(nativeServerDefaults(metadata,metadata),'base64')),coreReleaseConfig(metadata).images);
 for(const key of ['desktopUIHash','consoleUIHash','sourceInputHash','sourceCommit','releaseId'])assert.throws(()=>nativeServerDefaults({...metadata,[key]:'changed'},metadata));
 assert.throws(()=>nativeServerDefaults({...metadata,images:{...metadata.images,agent:'test/other:1'}},metadata));
});
