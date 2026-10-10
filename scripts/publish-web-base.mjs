import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { inputHash, root } from './build-web-base.mjs';

const digest = /^sha256:[a-f0-9]{64}$/;
export const baseChecks = ['offline-preparation', 'missing-dependency-rollback', 'failed-build-no-ready', 'backend-tests', 'frontend-tests', 'build', 'static-api', 'sqlite3', 'readonly-root', 'workspace-dependencies', 'restart-data'];
export const coreChecks = ['real-sdk-mcp', 'real-core-cli-browser', 'frontend-auto-adoption', 'backend-auto-adoption', 'environment-auto-adoption', 'safe-repeat-initialization', 'draft-path-retained', 'failed-build-recovery', 'agent-sqlite3', 'no-extra-run-or-apply', 'dev-hmr-backend-reload', 'memory-over-128MiB', 'legacy-cap-replaced', 'derived-image-service', 'core-graceful-recovery'];

export function verifyCandidate(candidate, image, validation, coreValidation, currentHash, starterValidation) {
  assert.match(candidate.reference, /^docker\.io\/pphboy\/piwork-web-base:[A-Za-z0-9._-]+$/);
  assert.match(candidate.imageId, digest);
  assert.equal(candidate.platform, 'linux/amd64');
  assert.equal(candidate.inputHash, currentHash, 'Image inputs changed after build');
  assert.equal(image.Id, candidate.imageId, 'Local tag was changed after validation');
  assert.equal(image.Architecture, 'amd64'); assert.equal(image.Os, 'linux');
  assert.equal(image.Config.User, '10001:10001');
  assert.equal(image.Config.Labels['io.piwork.web-base.input-sha256'], candidate.inputHash);
  assert.equal(image.Config.Labels['org.opencontainers.image.revision'], candidate.commit);
  for (const [record, required] of [[validation, baseChecks], [coreValidation, coreChecks], [starterValidation, baseChecks]]) {
    assert(record, 'Standard starter validation is missing');
    assert.equal(record.passed, true, 'Candidate validation is incomplete');
    assert.equal(record.imageId, candidate.imageId, 'Validation belongs to a different image');
    assert.equal(record.inputHash, candidate.inputHash, 'Validation belongs to different inputs');
    for (const name of required) assert(record.checks.includes(name), `Missing validation: ${name}`);
  }
  assert.equal(validation.internalNetwork, true, 'Offline validation must block registry egress');
  assert.equal(starterValidation.template, 'web-app');
  assert.equal(starterValidation.internalNetwork, true);
}

export function configIdentity(manifest) {
  if (manifest.schemaVersion !== 2 || !digest.test(manifest.config?.digest || '')) throw new Error('Unknown remote image identity');
  return manifest.config.digest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const load = name => JSON.parse(readFileSync(join(root, 'dist/web-base', name), 'utf8'));
  const candidate = load('candidate.json');
  const docker = (args, options = {}) => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 8 << 20, ...options });
  const image = JSON.parse(docker(['image', 'inspect', candidate.reference]))[0];
  verifyCandidate(candidate, image, load('validation.json'), load('core-validation.json'), inputHash(), load('validation-web-app.json'));
  const remote = spawnSync('docker', ['buildx', 'imagetools', 'inspect', candidate.reference, '--raw'], { encoding: 'utf8' });
  if (remote.status === 0) {
    let manifest = JSON.parse(remote.stdout);
    if (manifest.manifests) {
      const matching = manifest.manifests.filter(item => item.platform?.os === 'linux' && item.platform?.architecture === 'amd64');
      assert.equal(matching.length, 1, 'Remote linux/amd64 identity is ambiguous');
      const repository = candidate.reference.slice(0, candidate.reference.lastIndexOf(':'));
      manifest = JSON.parse(docker(['buildx', 'imagetools', 'inspect', `${repository}@${matching[0].digest}`, '--raw']));
    }
    assert.equal(configIdentity(manifest), candidate.imageId, 'Fixed remote tag already contains different content');
  } else if (!/not found|manifest unknown|404/i.test(remote.stderr) || /unauthorized|denied|timeout|network|connection/i.test(remote.stderr)) {
    throw new Error('Cannot confirm remote tag availability; no push performed: ' + remote.stderr.trim());
  }
  if (!process.argv.includes('--push')) {
    console.log(`Verified local evidence and remote identity for ${candidate.reference}; no push performed.`);
  } else {
    docker(['push', candidate.reference], { stdio: 'inherit' });
    const descriptor = JSON.parse(docker(['buildx', 'imagetools', 'inspect', candidate.reference, '--format', '{{json .Manifest}}']));
    assert.match(descriptor.digest, digest);
    const repository = candidate.reference.slice(0, candidate.reference.lastIndexOf(':'));
    const fixed = `${candidate.reference}@${descriptor.digest}`;
    const anonymous = mkdtempSync(join(tmpdir(), 'piwork-base-anonymous-'));
    try {
      writeFileSync(join(anonymous, 'config.json'), '{}\n');
      docker(['--config', anonymous, 'pull', fixed], { stdio: 'inherit' });
      const actual = JSON.parse(docker(['--config', anonymous, 'image', 'inspect', fixed]))[0];
      assert.equal(actual.Id, candidate.imageId);
      assert(actual.RepoDigests.includes(`${repository.replace(/^docker\.io\//, '')}@${descriptor.digest}`));
      const manifest = JSON.parse(docker(['--config', anonymous, 'run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'cat', fixed, '/opt/piwork-web-base/environment.json']));
      assert.equal(manifest.inputHash, candidate.inputHash);
      writeFileSync(join(root, 'dist/web-base/published.json'), JSON.stringify({ ...candidate, state: 'published', registryDigest: descriptor.digest,
        fixedReference: fixed, anonymousReadable: true, checkedAt: new Date().toISOString() }, null, 2) + '\n');
      console.log(`Published and anonymously verified ${fixed}`);
    } finally { rmSync(anonymous, { recursive: true, force: true }); }
  }
}
