import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCLI, desktopInputHash } from './build-cli.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(readFileSync(join(root, 'config/docker-release.json'), 'utf8'));
const roles = ['core', 'cli', 'agent', 'fileHelper', 'snapshotHelper'];
const protocols = {
  core: {}, cli: {},
  agent: { 'io.piwork.agent.protocol': 'v2', 'io.piwork.package-helper.contract': '2', 'io.piwork.service-mcp.contract': '1', 'io.piwork.work-history.schema': '4', 'io.piwork.run-model.contract': '1', 'io.piwork.work-feedback.contract': '1' },
  fileHelper: { 'piwork.file_protocol': '1' }, snapshotHelper: { 'piwork.snapshot_protocol': '1' },
};
const binaries = { core: ['piwork-serve'], cli: ['piwork-cli'], agent: ['piwork-package-helper', 'piwork-service-mcp'], fileHelper: ['piwork-file-helper'], snapshotHelper: ['piwork-snapshot-helper'] };
const environmentKeys = { core: 'PIWORK_CORE_IMAGE', cli: 'PIWORK_CLI_IMAGE', agent: 'PIWORK_AGENT_IMAGE', fileHelper: 'PIWORK_FILE_HELPER_IMAGE', snapshotHelper: 'PIWORK_SNAPSHOT_HELPER_IMAGE' };

function run(command, args, { stream = false, env = process.env } = {}) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', stdio: stream ? 'inherit' : 'pipe', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args[0] || ''} failed${result.error ? ': ' + result.error.message : ''}; inspect the local command output`);
  return (result.stdout || '').trim();
}
const json = (command, args) => JSON.parse(run(command, args));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function registryPrefix() {
  const registry = process.env.PIWORK_RELEASE_REGISTRY;
  if (!registry || !/^[a-z0-9][a-z0-9.:-]*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+$/.test(registry) || registry.includes('@')) throw new Error('Set PIWORK_RELEASE_REGISTRY to the actual registry/namespace prefix (no URL scheme or credentials).');
  return registry;
}

function identity() {
  if (Number(process.versions.node.split('.')[0]) !== 24 || run('go', ['env', 'GOVERSION']) !== 'go1.25.5') throw new Error('Docker releases require Node 24 and Go 1.25.5.');
  const releaseVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(releaseVersion)) throw new Error('Invalid release version.');
  const sourceCommit = run('git', ['rev-parse', '--verify', 'HEAD']);
  const sourceModified = Boolean(run('git', ['status', '--porcelain', '--untracked-files=normal']));
  const sourceFiles = [...new Set(run('git', ['ls-files', '-co', '--exclude-standard']).split('\n'))].filter(name => /^(internal\/|cmd\/|proto\/|packages\/|apps\/|scripts\/|config\/|Dockerfile|\.dockerignore$|go\.(mod|sum)$|package(-lock)?\.json$|tsconfig)/.test(name)).sort();
  const sourceHash = createHash('sha256');
  for (const name of sourceFiles) { const bytes = readFileSync(join(root, name)); sourceHash.update(`${name}\0${bytes.length}\0`); sourceHash.update(bytes); }
  return { releaseVersion, sourceCommit, sourceModified, sourceInputHash: sourceHash.digest('hex'), platform: config.platform, desktopUIHash: desktopInputHash(root), runtimeImage: config.runtimeImage };
}

function verifyImage(role, reference, expected) {
  const image = json('docker', ['image', 'inspect', reference])[0];
  if (!image || !/^sha256:[a-f0-9]{64}$/.test(image.Id) || `${image.Os}/${image.Architecture}` !== config.platform) throw new Error(`${role}: image platform/identity mismatch.`);
  const labels = image.Config.Labels || {};
  for (const [name, value] of Object.entries(protocols[role])) if (labels[name] !== value) throw new Error(`${role}: native protocol mismatch (${name}).`);
  if (labels['org.opencontainers.image.revision'] !== expected.sourceCommit || labels['org.opencontainers.image.version'] !== expected.releaseVersion || labels['io.piwork.source.modified'] !== String(expected.sourceModified)) throw new Error(`${role}: source identity mismatch.`);
  if (role === 'cli' && (image.Config.Healthcheck || labels['io.piwork.desktop.input-sha256'] !== expected.desktopUIHash)) throw new Error('CLI: unexpected image healthcheck or stale Desktop assets.');
  for (const binary of binaries[role]) {
    const version = json('docker', ['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--entrypoint', `/usr/local/bin/${binary}`, reference, '--version']);
    if (version.program !== binary || version.commit !== expected.sourceCommit || version.modified !== expected.sourceModified || version.version !== expected.releaseVersion || `${version.os}/${version.architecture}` !== config.platform || version.goVersion !== 'go1.25.5') throw new Error(`${role}: ${binary} version/build mismatch.`);
    if (role === 'cli' && version.desktopUIHash !== expected.desktopUIHash) throw new Error('CLI: embedded Desktop hash mismatch.');
  }
  if (role === 'core' || role === 'cli') {
    run('docker', ['run', '--rm', '--network', 'none', '--read-only', reference, '--help']);
    run('docker', ['run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'sh', reference, '-c', 'set -eu; command -v curl; test -s /etc/ssl/certs/ca-certificates.crt; for tool in go node python python3 docker; do if command -v "$tool" >/dev/null 2>&1; then exit 1; fi; done']);
  }
  if (role === 'cli') run('docker', ['run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'sh', reference, '-c', 'set -eu; jq --version; test "$(stat -c %a /var/lib/piwork/client)" = 700; test "$(stat -c %u /var/lib/piwork/client)" = 0; test -d /exchange']);
  return { reference, imageId: image.Id, platform: config.platform, protocolLabels: protocols[role] };
}

function build() {
  const registry = registryPrefix();
  const expected = identity();
  if (!/^alpine:3\.22@sha256:[a-f0-9]{64}$/.test(config.runtimeImage)) throw new Error('The runtime base must be a pinned Alpine 3.22 digest.');
  buildCLI([]); // Rebuild assets and all retained native CLI targets first.
  run('make', ['build-go'], { stream: true, env: { ...process.env, PIWORK_GO_BUILD_DIR: 'dist/docker/bin', PIWORK_BUILD_VERSION: expected.releaseVersion, GOOS: 'linux', GOARCH: 'amd64', CGO_ENABLED: '0' } });
  const flags = ['--platform', config.platform, '--build-arg', `PIWORK_VERSION=${expected.releaseVersion}`, '--build-arg', `PIWORK_COMMIT=${expected.sourceCommit}`, '--build-arg', `PIWORK_MODIFIED=${expected.sourceModified}`, '--build-arg', `PIWORK_DIRTY=${expected.sourceModified}`];
  const plans = {
    core: ['Dockerfile.core', 'piwork-core', []],
    cli: ['Dockerfile.cli', 'piwork-cli', ['--build-arg', `PIWORK_DESKTOP_UI_HASH=${expected.desktopUIHash}`]],
    agent: ['Dockerfile.agentd', 'piwork-agentd', ['--target', 'production', '--build-arg', 'NPM_REGISTRY=https://registry.npmjs.org']],
    fileHelper: ['Dockerfile.file-helper.native', 'piwork-file-helper', []],
    snapshotHelper: ['Dockerfile.snapshot-helper.native', 'piwork-snapshot-helper', []],
  };
  const images = {};
  for (const role of roles) {
    const [file, name, extra] = plans[role];
    const reference = `${registry}/${name}:${expected.releaseVersion}-${expected.sourceCommit.slice(0, 12)}`;
    const runtime = role === 'core' || role === 'cli' ? ['--build-arg', `PIWORK_RUNTIME_IMAGE=${config.runtimeImage}`] : [];
    run('docker', ['build', '-f', file, ...flags, ...runtime, ...extra, '-t', reference, '.'], { stream: true });
    images[role] = verifyImage(role, reference, expected);
  }
  const current = identity();
  if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('Source/build inputs changed during the build; rebuild before packaging.');
  mkdirSync(join(root, 'dist/docker'), { recursive: true });
  writeFileSync(join(root, 'dist/docker/build.json'), JSON.stringify({ ...expected, registry, images }, null, 2) + '\n');
  process.stdout.write('Verified Docker image build: dist/docker/build.json\n');
}

function packageRelease() {
  const registry = registryPrefix();
  const expected = identity();
  const buildPath = join(root, 'dist/docker/build.json');
  if (!existsSync(buildPath)) throw new Error('Build the Docker images first.');
  const built = JSON.parse(readFileSync(buildPath, 'utf8'));
  for (const key of Object.keys(expected)) if (built[key] !== expected[key]) throw new Error(`Build inputs changed (${key}); rebuild before packaging.`);
  if (built.registry !== registry) throw new Error('Registry prefix differs from the verified build.');
  const images = {};
  for (const role of roles) {
    const previous = built.images[role];
    if (!previous || !previous.reference.startsWith(registry + '/')) throw new Error(`${role}: missing release image.`);
    const inspection = json('docker', ['image', 'inspect', previous.reference])[0];
    const repository = previous.reference.slice(0, previous.reference.lastIndexOf(':'));
    // Engine canonicalizes Docker Hub RepoDigests without the docker.io prefix.
    // Keep the explicit release registry while comparing its canonical name.
    const canonicalRepository = value => value.replace(/^docker\.io\//, '');
    const published = (inspection.RepoDigests || []).find(value => {
      const [name, digest] = value.split('@');
      return canonicalRepository(name) === canonicalRepository(repository) && /^sha256:[a-f0-9]{64}$/.test(digest || '');
    });
    if (!published) throw new Error(`${role}: publish the verified image and obtain its registry digest before packaging.`);
    const reference = `${repository}@${published.split('@')[1]}`;
    // A remote manifest query proves readability; a local image cache alone
    // cannot satisfy this check. The digest must resolve to the verified build.
    const anonymousConfig = mkdtempSync(join(tmpdir(), 'piwork-registry-read-'));
    try {
      writeFileSync(join(anonymousConfig, 'config.json'), '{"auths":{}}\n', { mode: 0o600 });
      run('docker', ['manifest', 'inspect', reference], { env: { ...process.env, DOCKER_CONFIG: anonymousConfig, DOCKER_CONTEXT: '' } });
    } finally { rmSync(anonymousConfig, { recursive: true, force: true }); }
    run('docker', ['pull', '--platform', config.platform, reference], { stream: true });
    const verified = verifyImage(role, reference, expected);
    if (verified.imageId !== previous.imageId) throw new Error(`${role}: published digest points at another image.`);
    images[role] = { ...verified, digest: reference.split('@')[1] };
  }
  images.packageHelper = { ...images.agent };
  const storeSource = readFileSync(join(root, 'internal/corestore/store.go'), 'utf8');
  if (!storeSource.includes(`const Format = "${config.coreFormat}"`) || !storeSource.includes(`const SchemaVersion = ${config.coreSchemaVersion}`)) throw new Error('Core format metadata does not match source.');
  const stage = join(root, 'dist/docker/piwork-docker');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  for (const name of ['core.env.example', 'client.env.example', 'compose.core.yaml', 'compose.cli.yaml', 'compose.cli.linux.yaml', 'README.zh-CN.md']) copyFileSync(join(root, 'deploy/docker', name), join(stage, name));
  let releaseEnv = `PIWORK_RELEASE_VERSION=${expected.releaseVersion}\n`;
  for (const role of roles) releaseEnv += `${environmentKeys[role]}=${images[role].reference}\n`;
  releaseEnv += `PIWORK_PACKAGE_HELPER_IMAGE=${images.packageHelper.reference}\n`;
  writeFileSync(join(stage, 'release.env'), releaseEnv);
  const manifest = { manifestVersion: 1, releaseVersion: expected.releaseVersion, sourceCommit: expected.sourceCommit, sourceModified: expected.sourceModified, sourceInputHash: expected.sourceInputHash, desktopUIHash: expected.desktopUIHash, runtimeImage: config.runtimeImage, images, core: { format: config.coreFormat, schemaVersion: config.coreSchemaVersion }, clientCredentialVersion: config.clientCredentialVersion, compatiblePreviousReleaseVersions: [], directlyRollbackablePreviousVersions: [] };
  // First Docker release: no earlier Docker version has compatibility/rollback
  // evidence. Never infer that native releases or arbitrary tags are safe.
  writeFileSync(join(stage, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const files = readdirSync(stage).sort();
  writeFileSync(join(stage, 'SHA256SUMS'), files.map(name => `${sha(readFileSync(join(stage, name)))}  ${name}\n`).join(''));
  const archive = `piwork-docker-${expected.releaseVersion}-${expected.sourceCommit.slice(0, 12)}.tar.gz`;
  run('tar', ['-C', 'dist/docker', '-czf', `dist/docker/${archive}`, 'piwork-docker']);
  writeFileSync(join(root, 'dist/docker', archive + '.sha256'), `${sha(readFileSync(join(root, 'dist/docker', archive)))}  ${archive}\n`);
  process.stdout.write(`dist/docker/${archive}\n`);
}

const action = process.argv[2];
try {
  if (process.argv.length !== 3 || action !== 'build' && action !== 'package') throw new Error('usage: node scripts/build-docker-release.mjs <build|package> (PIWORK_RELEASE_REGISTRY is required)');
  if (action === 'build') build(); else packageRelease();
} catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
