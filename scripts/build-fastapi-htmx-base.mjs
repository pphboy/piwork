import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, assertEnvironmentLocks } from './build-web-base.mjs';

export { root };
export const source = join(root, 'deploy/images/fastapi-htmx-base');
const sha = data => createHash('sha256').update(data).digest('hex');
function tree(directory, prefix = '') {
  return readdirSync(join(directory, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    assert(!entry.isSymbolicLink(), 'Image inputs must not be links');
    const name = join(prefix, entry.name);
    return entry.isDirectory() ? tree(directory, name) : [name];
  });
}
export function inputHash(directory = source) {
  const files = ['Dockerfile', 'environment.json', 'requirements.in', 'requirements.lock', ...tree(directory, 'tools'), ...tree(directory, 'vendor')];
  const shared = join(root, 'deploy/images/web-common');
  return sha(Buffer.concat([
    ...files.flatMap(name => [Buffer.from(name + '\0'), readFileSync(join(directory, name))]),
    ...tree(shared).flatMap(name => [Buffer.from('web-common/' + name + '\0'), readFileSync(join(shared, name))]),
    Buffer.from('context-ignore\0'), readFileSync(join(root, 'deploy/images/.dockerignore')),
  ]));
}
export function verifyVendor(directory = source) {
  const manifest = JSON.parse(readFileSync(join(directory, 'vendor/manifest.json')));
  for (const item of manifest.files) {
    assert.match(item.file, /^[a-zA-Z0-9_.-]+$/);
    assert.equal(sha(readFileSync(join(directory, 'vendor', item.file))), item.sha256, 'Vendor integrity mismatch: ' + item.file);
  }
}
export function candidate() {
  assertEnvironmentLocks(source);
  verifyVendor();
  const environment = JSON.parse(readFileSync(join(source, 'environment.json')));
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const modified = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
  const hash = inputHash();
  const version = `${environment.version}-${commit.slice(0, 12)}-${hash.slice(0, 12)}${modified ? '-dirty' : ''}`;
  return { state: 'candidate', contractVersion: 1, platform: environment.platform, version, commit, modified,
    reference: `docker.io/pphboy/piwork-fastapi-htmx-base:${version}`, inputHash: hash, environment };
}
export function verifyEvidence(candidate, image, reports, currentHash = inputHash()) {
  assert.equal(candidate.state, 'candidate');
  assert.equal(candidate.inputHash, currentHash, 'Image inputs changed');
  assert.equal(image.Id, candidate.imageId);
  assert.equal(image.Config.Labels['io.piwork.web-base.input-sha256'], candidate.inputHash);
  assert.equal(image.Config.User, '10001:10001');
  for (const report of reports) {
    assert.equal(report.passed, true);
    assert.equal(report.imageId, candidate.imageId);
    assert.equal(report.inputHash, candidate.inputHash);
  }
  assert(reports.length > 0, 'Validation evidence is required');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const metadata = candidate();
  execFileSync('docker', ['build', '--platform', metadata.platform, '-f', join(source, 'Dockerfile'),
    '--build-arg', `PIWORK_COMMIT=${metadata.commit}`, '--build-arg', `PIWORK_MODIFIED=${metadata.modified}`,
    '--build-arg', `PIWORK_WEB_INPUT_HASH=${metadata.inputHash}`, '-t', metadata.reference, join(root, 'deploy/images')], { stdio: 'inherit' });
  const image = JSON.parse(execFileSync('docker', ['image', 'inspect', metadata.reference], { encoding: 'utf8' }))[0];
  assert.equal(image.Config.Labels['io.piwork.web-base.input-sha256'], metadata.inputHash);
  const output = join(root, 'dist/fastapi-htmx-base');
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'candidate.json'), JSON.stringify({ ...metadata, imageId: image.Id }, null, 2) + '\n');
  console.log(`Built local candidate ${metadata.reference}; no push performed.`);
}
