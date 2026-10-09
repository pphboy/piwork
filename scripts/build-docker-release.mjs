import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { desktopInputHash } from './build-cli.mjs';
import { singleHostReadme } from './docker-quickstart-content.mjs';
import { renderPublishScript } from './docker-publish-preflight.mjs';

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const roles = ['core', 'cli', 'agent', 'fileHelper', 'snapshotHelper'];
export const names = { core: 'piwork-core', cli: 'piwork-cli', agent: 'piwork-agentd', fileHelper: 'piwork-file-helper', snapshotHelper: 'piwork-snapshot-helper' };
export const binaries = { core: ['piwork-serve'], cli: ['piwork-cli'], agent: ['piwork-package-helper', 'piwork-service-mcp'], fileHelper: ['piwork-file-helper'], snapshotHelper: ['piwork-snapshot-helper'] };
export const protocols = {
  core: {}, cli: {},
  agent: { 'io.piwork.agent.protocol': 'v2', 'io.piwork.package-helper.contract': '2', 'io.piwork.service-mcp.contract': '1', 'io.piwork.work-history.schema': '5', 'io.piwork.run-model.contract': '1', 'io.piwork.work-feedback.contract': '1' },
  fileHelper: { 'piwork.file_protocol': '1' }, snapshotHelper: { 'piwork.snapshot_protocol': '1' },
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
const hashPattern = /^[a-f0-9]{64}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const canonical = reference => reference.replace(/^docker\.io\//, '');

export function sourceInputHash(base = root) {
  const files = [];
  const walk = name => {
    for (const entry of readdirSync(join(base, name), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (['dist', 'node_modules', '.git', '.cache'].includes(entry.name)) continue;
      const child = `${name}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && !/(?:^|\/)\.env|\.(?:env(?:\..*)?|pem|key|sqlite(?:-.*)?|db(?:-.*)?|work|log|tsbuildinfo)$/.test(child) && !/README(?:\.[^/]*)?$/.test(child)) files.push(child);
      else if (entry.isSymbolicLink()) throw new Error('Unsupported symbolic source input.');
    }
  };
  for (const name of ['cmd', 'internal', 'proto', 'packages', 'apps', 'scripts', 'config']) walk(name);
  for (const entry of readdirSync(base).sort()) {
    if (/^Dockerfile|^\.dockerignore$|^go\.(mod|sum)$|^package(?:-lock)?\.json$|^tsconfig.*\.json$/.test(entry)) files.push(entry);
  }
  for (const entry of readdirSync(join(base, 'deploy/docker')).sort()) {
    if (entry !== 'docker-compose.yml' && /\.(?:sh|template|ya?ml)$/.test(entry)) files.push(`deploy/docker/${entry}`);
  }
  if (readdirSync(base).includes('examples')) {
    const example = join(base, 'examples/single-host/docker-compose.yml.template');
    try { readFileSync(example); files.push('examples/single-host/docker-compose.yml.template'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  files.push('docs/images/piwork-logo.png');
  const hash = createHash('sha256');
  for (const name of files.sort()) {
    const bytes = readFileSync(join(base, name));
    hash.update(`${name}\0${bytes.length}\0`); hash.update(bytes);
  }
  return hash.digest('hex');
}

export function identity(base = root, environment = process.env) {
  const config = readJSON(join(base, 'config/docker-release.json'));
  const sourceCommit = environment.PIWORK_COMMIT;
  const modified = environment.PIWORK_MODIFIED;
  const registry = environment.PIWORK_RELEASE_REGISTRY || 'docker.io/pphboy';
  const releaseVersion = readJSON(join(base, 'package.json')).version;
  if (!/^[a-f0-9]{40}$/.test(sourceCommit || '') || /^0+$/.test(sourceCommit)) throw new Error('PIWORK_COMMIT must be the actual Git commit.');
  if (modified !== 'true' && modified !== 'false') throw new Error('PIWORK_MODIFIED must be the actual Git modification state.');
  if (!/^[a-z0-9][a-z0-9.:-]*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+$/.test(registry) || registry.includes('@')) throw new Error('Invalid release registry/namespace.');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(releaseVersion || '')) throw new Error('Invalid release version.');
  if (config.platform !== 'linux/amd64' || !/^alpine:3\.22@sha256:[a-f0-9]{64}$/.test(config.runtimeImage)) throw new Error('Invalid release platform/runtime base.');
  const sourceHash = sourceInputHash(base);
  const desktopUIHash = desktopInputHash(base);
  const metadata = { manifestVersion: 2, releaseVersion, sourceCommit, sourceModified: modified === 'true', sourceInputHash: sourceHash, desktopUIHash, registry, platform: config.platform, runtimeImage: config.runtimeImage, core: { format: config.coreFormat, schemaVersion: config.coreSchemaVersion }, clientCredentialVersion: config.clientCredentialVersion };
  metadata.releaseId = `${releaseVersion}-${sourceCommit.slice(0, 12)}-${sourceHash.slice(0, 12)}${metadata.sourceModified ? '-dirty' : ''}`;
  metadata.images = Object.fromEntries(roles.map(role => [role, `${registry}/${names[role]}:${metadata.releaseId}`]));
  for (const [key, value] of [['PIWORK_VERSION', releaseVersion], ['PIWORK_SOURCE_INPUT_HASH', sourceHash], ['PIWORK_DESKTOP_UI_HASH', desktopUIHash]]) {
    if (environment[key] !== undefined && environment[key] !== value) throw new Error(`Build input changed (${key}); regenerate metadata.`);
  }
  const store = readFileSync(join(base, 'internal/corestore/store.go'), 'utf8');
  if (!store.includes(`const Format = "${config.coreFormat}"`) || !store.includes(`const SchemaVersion = ${config.coreSchemaVersion}`)) throw new Error('Core storage metadata does not match current source.');
  return metadata;
}

export function coreReleaseConfig(metadata) {
  return { version: 1, release: { version: metadata.releaseVersion, commit: metadata.sourceCommit, modified: metadata.sourceModified, sourceInputHash: metadata.sourceInputHash }, images: { agent: metadata.images.agent, packageHelper: metadata.images.agent, fileHelper: metadata.images.fileHelper, snapshotHelper: metadata.images.snapshotHelper } };
}

export function writeMetadata(metadata, output) {
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
  writeFileSync(join(output, 'docker-release.json'), JSON.stringify(coreReleaseConfig(metadata), null, 2) + '\n');
  const clientIdentity = JSON.stringify({ releaseVersion: metadata.releaseVersion, commit: metadata.sourceCommit, modified: metadata.sourceModified, desktopUIHash: metadata.desktopUIHash, target: metadata.platform, goVersion: 'go1.25.5' });
  const common = `-s -w -X piwork/internal/buildinfo.Version=${metadata.releaseVersion} -X piwork/internal/buildinfo.Commit=${metadata.sourceCommit} -X piwork/internal/buildinfo.Modified=${metadata.sourceModified}`;
  writeFileSync(join(output, 'core.ldflags'), common);
  writeFileSync(join(output, 'cli.ldflags'), `${common} -X piwork/internal/buildinfo.DesktopUIHash=${metadata.desktopUIHash} -X 'piwork/internal/buildinfo.ClientReleaseIdentity=piwork-cli-release-v1:${clientIdentity}'`);
  for (const [key, value] of Object.entries({ version: metadata.releaseVersion, commit: metadata.sourceCommit, modified: String(metadata.sourceModified), sourceInputHash: metadata.sourceInputHash, desktopUIHash: metadata.desktopUIHash, releaseId: metadata.releaseId, registry: metadata.registry, runtimeImage: metadata.runtimeImage, ...metadata.images })) writeFileSync(join(output, key), value + '\n');
}

export function verifyImageRecords(metadata, records, { published = false } = {}) {
  const images = {};
  for (const role of roles) {
    const record = records[role];
    const image = record?.image;
    const labels = image?.Config?.Labels || {};
    if (!image || !digestPattern.test(image.Id || '') || `${image.Os}/${image.Architecture}` !== metadata.platform) throw new Error(`${role}: image platform/identity mismatch.`);
    if (record.existingImageId && record.existingImageId !== image.Id) throw new Error(`${role}: release tag already belongs to another image.`);
    if (!image.RepoTags?.some(tag => canonical(tag) === canonical(metadata.images[role]))) throw new Error(`${role}: release tag mismatch.`);
    for (const [key, value] of Object.entries({ 'org.opencontainers.image.version': metadata.releaseVersion, 'org.opencontainers.image.revision': metadata.sourceCommit, 'io.piwork.source.modified': String(metadata.sourceModified), 'io.piwork.source.input-sha256': metadata.sourceInputHash, ...protocols[role] })) {
      if (labels[key] !== value) throw new Error(`${role}: image metadata mismatch (${key}).`);
    }
    for (const program of binaries[role]) {
      const version = record.versions?.[program];
      if (!version || version.program !== program || version.version !== metadata.releaseVersion || version.commit !== metadata.sourceCommit || version.modified !== metadata.sourceModified || `${version.os}/${version.architecture}` !== metadata.platform || version.goVersion !== 'go1.25.5') throw new Error(`${role}: binary identity mismatch.`);
      if (role === 'cli' && version.desktopUIHash !== metadata.desktopUIHash) throw new Error('cli: embedded Desktop input mismatch.');
    }
    if (role === 'cli' && (image.Config.Healthcheck || labels['io.piwork.desktop.input-sha256'] !== metadata.desktopUIHash)) throw new Error('cli: image defaults/resource identity mismatch.');
    if ((role === 'core' || role === 'cli') && record.runtimeBoundary !== true) throw new Error(`${role}: runtime boundary check missing.`);
    if (role === 'core' && JSON.stringify(record.releaseConfig) !== JSON.stringify(coreReleaseConfig(metadata))) throw new Error('core: embedded release defaults mismatch.');
    const result = { reference: metadata.images[role], imageId: image.Id, platform: metadata.platform, protocolLabels: protocols[role] };
    if (published) {
      if (!digestPattern.test(record.registryDigest || '') || record.anonymousReadable !== true || record.publishedImageId !== image.Id) throw new Error(`${role}: published identity/anonymous verification missing.`);
      const repository = metadata.images[role].slice(0, metadata.images[role].lastIndexOf(':'));
      if (!image.RepoDigests?.some(ref => canonical(ref) === canonical(`${repository}@${record.registryDigest}`))) throw new Error(`${role}: registry digest mismatch.`);
      result.digest = record.registryDigest;
      result.digestReference = `${repository}@${record.registryDigest}`;
    }
    images[role] = result;
  }
  images.packageHelper = { ...images.agent };
  return images;
}

export function renderCompose(metadata, base = root, { singleHost = false } = {}) {
  const template = readFileSync(join(base, singleHost ? 'examples/single-host/docker-compose.yml.template' : 'deploy/docker/docker-compose.yml.template'), 'utf8');
  const rendered = template.replaceAll('@PIWORK_CORE_IMAGE@', metadata.images.core).replaceAll('@PIWORK_CLI_IMAGE@', metadata.images.cli);
  if (/@PIWORK_[A-Z_]+@|\benv_file:|\binclude:|\bextends:|release\.env/.test(rendered)) throw new Error('Compose is not a standalone rendered file.');
  return rendered;
}

export function writeMaterials(metadata, records, output, { published = false, base = root } = {}) {
  const images = verifyImageRecords(metadata, records, { published });
  mkdirSync(output, { recursive: true });
  const manifest = { ...metadata, state: published ? 'published' : 'candidate', images, compatiblePreviousReleaseVersions: [], directlyRollbackablePreviousVersions: [] };
  writeFileSync(join(output, 'docker-compose.yml'), renderCompose(metadata, base));
  writeFileSync(join(output, 'single-host-compose.yml'), renderCompose(metadata, base, { singleHost: true }));
  for (const [language, name] of [['en', 'single-host-README.md'], ['zh', 'single-host-README.zh-CN.md']]) writeFileSync(join(output, name), singleHostReadme(manifest, language));
  writeFileSync(join(output, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(output, 'README.txt'), `Piwork ${metadata.releaseId}\nState: ${manifest.state}\nSource: ${metadata.sourceCommit}\nInput SHA256: ${metadata.sourceInputHash}\n${published ? 'Registry identity and anonymous readability verified.' : 'Local candidate only. Public push and download have not been approved or verified.'}\ndocker-compose.yml deploys only Core; CLI uses an independent Docker command. single-host-compose.yml is the optional combined example. Core initialization requires existing host environment variables. Review before running push-commands.sh; it defaults to a no-push preflight. An authorized push requires --push.\n`);
  writeFileSync(join(output, 'push-commands.sh'), renderPublishScript(manifest), { mode: 0o755 });
  const files = ['README.txt', 'docker-compose.yml', 'single-host-compose.yml', 'single-host-README.md', 'single-host-README.zh-CN.md', 'push-commands.sh', 'release-manifest.json'];
  writeFileSync(join(output, 'SHA256SUMS'), files.map(name => `${sha(readFileSync(join(output, name)))}  ${name}\n`).join(''));
}

export function collectRecords(input) {
  return Object.fromEntries(roles.map(role => {
    const image = readJSON(join(input, `${role}.image.json`))[0];
    const versions = Object.fromEntries(binaries[role].map(program => [program, readJSON(join(input, `${role}.${program}.json`))]));
    const record = { image, versions };
    if (role === 'core' || role === 'cli') record.runtimeBoundary = readFileSync(join(input, `${role}.boundary`), 'utf8').trim() === 'true';
    if (role === 'core') record.releaseConfig = readJSON(join(input, 'core.release-config.json'));
    return [role, record];
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, output, input] = process.argv.slice(2);
    const metadata = identity();
    if (!output || !['metadata', 'image', 'records', 'materials', 'published-materials'].includes(action)) throw new Error('usage: build-docker-release.mjs <metadata|image|records|materials|published-materials> OUTPUT [INPUT]');
    if (action === 'metadata' || action === 'image') {
      if (action === 'image' && !hashPattern.test(process.env.PIWORK_SOURCE_INPUT_HASH || '')) throw new Error('Generate release metadata before building an image.');
      writeMetadata(metadata, output);
    } else if (action === 'records') {
      const saved = readJSON(join(output, 'metadata.json'));
      if (JSON.stringify(saved) !== JSON.stringify(metadata)) throw new Error('Source/build inputs changed; regenerate the complete candidate.');
      const records = collectRecords(output);
      verifyImageRecords(metadata, records);
      for (const role of roles) writeFileSync(join(output, `${role}.json`), JSON.stringify(records[role], null, 2) + '\n');
    } else {
      const saved = readJSON(join(input, 'metadata.json'));
      if (JSON.stringify(saved) !== JSON.stringify(metadata)) throw new Error('Source/build inputs changed; regenerate the complete candidate.');
      const gate = spawnSync(process.execPath, ['scripts/check-docker-quickstart.mjs'], { cwd: root, encoding: 'utf8' });
      if (gate.error || gate.status !== 0) throw new Error('Quick Start material check failed; run check-docker-quickstart.mjs for safe diagnostics.');
      const records = Object.fromEntries(roles.map(role => [role, readJSON(join(input, `${role}.json`))]));
      writeMaterials(metadata, records, output, { published: action === 'published-materials' });
    }
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
