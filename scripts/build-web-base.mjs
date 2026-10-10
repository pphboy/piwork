import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const source = join(root, 'deploy/images/web-base');
const sha = value => createHash('sha256').update(value).digest('hex');
export function inputHash(baseDirectory = source) {
  const paths = ['Dockerfile', '.dockerignore', 'environment.json', 'requirements.in', 'requirements.lock',
    'frontend/package.json', 'frontend/package-lock.json', ...readdirSync(join(baseDirectory, 'tools')).sort().filter(name => name.endsWith('.py') || name === 'piwork-web').map(name => `tools/${name}`)];
  return sha(Buffer.concat(paths.map(name => Buffer.concat([Buffer.from(name + '\0'), readFileSync(join(baseDirectory, name))]))));
}
export function candidate() {
  const environment = JSON.parse(readFileSync(join(source, 'environment.json')));
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const modified = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
  const hash = inputHash();
  const version = `${environment.version}-${commit.slice(0, 12)}-${hash.slice(0, 12)}${modified ? '-dirty' : ''}`;
  return { contractVersion: 1, state: 'candidate', version, commit, modified, inputHash: hash,
    platform: environment.platform, reference: `docker.io/pphboy/piwork-web-base:${version}`, environment };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const metadata = candidate();
  execFileSync('docker', ['build', '--platform', metadata.platform, '-f', join(source, 'Dockerfile'),
    '--build-arg', `PIWORK_COMMIT=${metadata.commit}`, '--build-arg', `PIWORK_MODIFIED=${metadata.modified}`,
    '--build-arg', `PIWORK_WEB_INPUT_HASH=${metadata.inputHash}`, '-t', metadata.reference, source],
    { cwd: root, stdio: 'inherit' });
  const image = JSON.parse(execFileSync('docker', ['image', 'inspect', metadata.reference], { encoding: 'utf8' }))[0];
  if (image.Config.User !== '10001:10001' || image.Config.Labels['io.piwork.web-base.input-sha256'] !== metadata.inputHash)
    throw new Error('Built image identity does not match inputs.');
  const output = join(root, 'dist/web-base'); mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'candidate.json'), JSON.stringify({ ...metadata, imageId: image.Id }, null, 2) + '\n');
  console.log(`Built local candidate ${metadata.reference} (${image.Id}); no push performed.`);
}
