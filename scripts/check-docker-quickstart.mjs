import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sourceInputHash, renderCompose, roles } from './build-docker-release.mjs';
import { coreRun, cliRun, composeCommands, firstWorkCommands, firstChatCommand, cliFileRun, singleHostReadme } from './docker-quickstart-content.mjs';

export const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const installerFiles = ['docker-compose.yml', 'single-host-compose.yml', 'single-host-README.md', 'single-host-README.zh-CN.md', 'release-manifest.json', 'README.txt', 'push-commands.sh', 'SHA256SUMS'];
export function section(text, marker) {
  const start = `<!-- ${marker}:start -->`, end = `<!-- ${marker}:end -->`;
  if (text.split(start).length !== 2 || text.split(end).length !== 2) throw new Error('Missing or duplicate document marker.');
  return text.slice(text.indexOf(start) + start.length, text.indexOf(end));
}
export function codeBlocks(text) {
  return [...text.matchAll(/^```([^\n]*)\n([\s\S]*?)^```/gm)].map(match => ({ language: match[1], code: match[2].trimEnd() }));
}
const normalize = text => text.trim().replace(/\r\n/g, '\n');
const sameCode = (first, second) => JSON.stringify(codeBlocks(first)) === JSON.stringify(codeBlocks(second));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export function checkQuickStart(base = projectRoot, { websiteRoot } = {}) {
  const errors = [];
  const check = (valid, message) => { if (!valid) errors.push(message); };
  const read = name => {
    try { return readFileSync(join(base, name), 'utf8'); }
    catch { errors.push(`${name}: missing material`); return ''; }
  };
  let release;
  try { release = JSON.parse(read('deploy/docker/release.json')); }
  catch { return [...errors, 'deploy/docker/release.json: invalid metadata']; }
  if (!release || !['candidate', 'published'].includes(release.state) || !release.images?.core || !release.images?.cli) return [...errors, 'deploy/docker/release.json: incomplete release identity'];
  try { check(sourceInputHash(base) === release.sourceInputHash, 'deploy/docker/release.json: source inputs changed; regenerate candidate'); }
  catch { check(false, 'source input inventory is unavailable'); }
  for (const role of roles) check(typeof release.images[role] === 'string' && release.images[role].endsWith(`:${release.releaseId}`) && !release.images[role].endsWith(':latest'), `deploy/docker/release.json: ${role} fixed release reference`);

  const expected = [coreRun(release.images.core), cliRun(release.images.cli), firstWorkCommands, firstChatCommand];
  const docs = ['README.md', 'README.zh-CN.md', 'deploy/docker/README.md', 'deploy/docker/README.zh-CN.md'];
  const trials = [];
  for (const name of docs) {
    const text = read(name);
    try {
      const trial = section(text, 'docker-quickstart'); trials.push(trial);
      const blocks = codeBlocks(trial);
      check(/examples\/single-host\//.test(trial), `${name}: single-host example reference missing`);
      check(!/docker compose[^\n]*run/.test(trial), `${name}: default CLI must be independent of Compose`);
      for (const command of expected) check(blocks.some(block => normalize(block.code) === normalize(command)), `${name}: complete startup and conversation commands must match the release`);
      for (const block of blocks) {
        check(block.language === 'sh', `${name}: default code uses shell language`);
        check(!/--env-file|release\.env|--entrypoint|\bdesktop\b|make build|npm ci|tar -|core\.run\.env/.test(block.code), `${name}: default trial must use direct images and terminal commands`);
        check(spawnSync('sh', ['-n'], { input: block.code, encoding: 'utf8' }).status === 0, `${name}: shell syntax is invalid`);
      }
      check(!/Download and verify the installer|Configure and start Core|下载并校验安装包|配置并启动 Core/.test(trial), `${name}: old download/configuration steps returned`);
      check(release.state !== 'candidate' || /Local candidate|本地候选/.test(trial), `${name}: unpublished candidate must be identified`);
      if (!name.startsWith('deploy/')) {
        check(/^<p align="center">\s*<img[^>]*width="160"[^>]*height="160"[^>]*>\s*<\/p>/m.test(text), `${name}: centered Logo dimensions`);
        check(text.indexOf('## Architecture') >= 0 && text.indexOf('## Architecture') < text.indexOf('## Problem'), `${name}: Architecture must precede Problem`);
        const native = section(text, 'native-quickstart');
        const before = text.slice(0, text.indexOf('<!-- native-quickstart:start -->'));
        check(/<details>\s*<summary>[^<]+<\/summary>\s*$/.test(before), `${name}: native CLI must stay folded`);
        check(!/\bdesktop\b/.test(codeBlocks(native).map(block => block.code).join('\n')), `${name}: native trial stays in the terminal`);
      }
    } catch { check(false, `${name}: missing required document sections`); }
  }
  for (const trial of trials) check(sameCode(trial, trials[0]), 'paired terminal commands differ between README/manual languages');

  const core = read('Dockerfile.core'), cli = read('Dockerfile.cli');
  check(/FROM \$\{GO_BUILDER_IMAGE\} AS build/.test(core) && /COPY --from=build/.test(core) && !/COPY[^\n]*dist\//.test(core), 'Dockerfile.core: source build must not require host dist');
  check(/PIWORK_RELEASE_CONFIG_PATH=\/etc\/piwork\/docker-release\.json/.test(core) && /PIWORK_DATA_DIR=\/var\/lib\/piwork\/quickstart\/core/.test(core) && /DOCKER_HOST=unix:\/\/\/var\/run\/docker\.sock/.test(core), 'Dockerfile.core: nonsecret release defaults and same-path data');
  check(/HEALTHCHECK/.test(core) && /readyz\?profile=docker-delivery/.test(core), 'Dockerfile.core: complete delivery healthcheck');
  check(/ENTRYPOINT \["\/usr\/local\/bin\/piwork-cli-entrypoint"\]/.test(cli) && /CMD \[\]/.test(cli) && !/HEALTHCHECK/.test(cli), 'Dockerfile.cli: default terminal and explicit command entrypoint');
  check(/PIWORK_CONFIG_PATH=\/var\/lib\/piwork\/client\/credentials\.json/.test(cli), 'Dockerfile.cli: private persistent state');
  check(/COPY --from=desktop/.test(cli) && /npm run build -w @piwork\/desktop-webui/.test(cli), 'Dockerfile.cli: fresh embedded resources');
  const entry = read('deploy/docker/cli-entrypoint.sh'), wait = read('deploy/docker/wait-core.sh');
  check(/exec piwork-cli "\$@"/.test(entry) && /timeout -s TERM 600/.test(entry) && /exec \/bin\/sh -i/.test(entry), 'CLI entrypoint: forwarding and bounded terminal readiness');
  check(/readyz\?profile=docker-delivery/.test(wait) && /piwork_wait_status" = 200/.test(wait), 'CLI readiness: exact full-readiness success');
  const mainIgnore = read('.dockerignore');
  for (const file of ['Dockerfile.core.dockerignore', 'Dockerfile.cli.dockerignore']) check(read(file) === mainIgnore, `${file}: source/secret exclusions must match main policy`);

  const template = read('deploy/docker/docker-compose.yml.template');
  check(!/\benv_file:|\binclude:|\bextends:|release\.env/.test(template), 'Compose: single-file deployment must not depend on setup files');
  check(/network_mode: host/.test(template), 'Compose: Core host networking');
  check(!/^  cli:|^volumes:|client-state|depends_on:/m.test(template), 'Compose: default file must contain Core only');
  check(/source: \/var\/lib\/piwork\/quickstart\/core\n\s+target: \/var\/lib\/piwork\/quickstart\/core/.test(template), 'Compose: same absolute data path');
  check(/source: \/var\/run\/docker\.sock\n\s+target: \/var\/run\/docker\.sock\n\s+bind:\n\s+create_host_path: false/.test(template), 'Compose: missing socket must not create a directory');
  check(/stop_grace_period: 60s/.test(template), 'Compose: shutdown budget');
  const singleHost = read('examples/single-host/docker-compose.yml.template');
  const cliService = singleHost.split('  cli:\n')[1] || '';
  check(/network_mode: host/.test(singleHost) && /host\.docker\.internal:host-gateway/.test(singleHost), 'single-host: Core host and CLI gateway networking');
  check(!/env_file:|include:|extends:|depends_on:/.test(singleHost), 'single-host: no external files or lifecycle dependencies');
  check(/PIWORK_DATA_DIR: \/var\/lib\/piwork\/examples\/single-host\/core/.test(singleHost) && /source: \/var\/lib\/piwork\/examples\/single-host\/core\n\s+target: \/var\/lib\/piwork\/examples\/single-host\/core/.test(singleHost), 'single-host: isolated same-path data');
  check(/name: piwork-single-host-client-state/.test(singleHost) && /stop_grace_period: 60s/.test(singleHost), 'single-host: independent client state and shutdown budget');
  check(/profiles: \[cli\]/.test(cliService) && /stdin_open: true/.test(cliService) && /tty: true/.test(cliService), 'single-host: interactive CLI');
  check(!/ports:|docker\.sock|PIWORK_API_KEY|PIWORK_ADMIN_PASSWORD/.test(cliService), 'single-host: CLI must not receive Core secrets or resources');
  for (const [language, name] of [['en', 'README.md'], ['zh', 'README.zh-CN.md']]) check(read('examples/single-host/' + name) === singleHostReadme(release, language), 'single-host: bilingual instructions differ from source');
  try { check(read('examples/single-host/docker-compose.yml') === renderCompose(release, base, { singleHost: true }), 'single-host: generated file differs'); }
  catch { check(false, 'single-host: rendering failed'); }
  for (const key of ['PIWORK_ADMIN_ACCOUNT', 'PIWORK_ADMIN_PASSWORD', 'PIWORK_MODEL_PROVIDER', 'PIWORK_MODEL', 'PIWORK_API_KEY', 'PIWORK_MODEL_BASE_URL']) check(new RegExp(`^      ${key}:$`, 'm').test(template), `Compose: ${key} must pass through by name`);
  try { check(read('deploy/docker/docker-compose.yml') === renderCompose(release, base), 'Compose: generated file differs from its release template'); }
  catch { check(false, 'Compose: candidate rendering failed'); }
  const demo = read('deploy/docker/compose.core.yaml');
  check(/network_mode: host/.test(demo) && /PIWORK_DATA_DIR: \/var\/lib\/piwork\/core/.test(demo) && /stop_grace_period: 60s/.test(demo) && !/env_file|release\.env/.test(demo), 'Core Demo: independent data, image defaults and shutdown');
  const builder = read('scripts/build-docker-release.mjs');
  check(/scripts\/check-docker-quickstart\.mjs/.test(builder) && /writeMaterials/.test(builder), 'materials: executable consistency gate must run before exporting');

  if (websiteRoot) {
    const siteRead = name => { try { return readFileSync(join(websiteRoot, name), 'utf8'); } catch { errors.push(`website ${name}: missing material`); return ''; } };
    for (const prefix of ['', 'zh/']) {
      try { check(sameCode(section(siteRead(`docs/${prefix}guide/quick-start.md`), 'docker-quickstart'), trials[0]), `website ${prefix}Quick Start: startup commands differ`); }
      catch { check(false, `website ${prefix}Quick Start: missing trial marker`); }
      for (const marker of ['core-compose-demo', 'terminal-operations']) {
        try { check(sameCode(section(siteRead(`docs/${prefix}guide/installation.md`), marker), section(read('deploy/docker/README.md'), marker)), `website ${prefix}installation: ${marker} commands differ`); }
        catch { check(false, `website ${prefix}installation: missing ${marker}`); }
      }
    }
    for (const prefix of ['', 'zh/']) {
      const first = siteRead(`docs/${prefix}guide/first-work.md`);
      check(codeBlocks(first).some(block => normalize(block.code) === normalize(cliFileRun(release.images.cli))), `website ${prefix}First Work: CLI reference or exchange command differs`);
      for (const name of ['index.md', 'guide/quick-start.md', 'guide/installation.md', 'guide/first-work.md', 'guide/source-installation.md', 'guide/index.md', 'spec/index.md']) {
        const text = siteRead(`docs/${prefix}${name}`);
        const refs = text.match(/(?:docker\.io\/)?pphboy\/piwork-[a-z-]+:[A-Za-z0-9_.-]+/g) || [];
        check(refs.every(ref => Object.values(release.images).some(expected => expected.replace(/^docker\.io\//, '') === ref.replace(/^docker\.io\//, ''))), `website ${prefix}${name}: stale current image reference`);
        const downloadIds = [...text.matchAll(/\/install\/([^/\s)]+)\/(?:docker-compose|single-host-compose)\.yml/g)].map(match => match[1]);
        check(downloadIds.every(id => id === release.releaseId), `website ${prefix}${name}: stale current download reference`);
      }
      check(siteRead(`docs/${prefix}guide/installation.md`).includes('examples/single-host/'), `website ${prefix}installation: single-host reference missing`);
      check(siteRead(`docs/${prefix}index.md`).includes(`/install/${release.releaseId}/docker-compose.yml`), `website ${prefix}homepage: Core download missing`);
    }
    check(siteRead(`docs/public/install/${release.releaseId}/docker-compose.yml`) === read('deploy/docker/docker-compose.yml'), 'website download: candidate Compose differs');
    check(siteRead(`docs/public/install/${release.releaseId}/single-host-compose.yml`) === read('examples/single-host/docker-compose.yml'), 'website download: single-host Compose differs');
    try { check(JSON.parse(siteRead(`docs/public/install/${release.releaseId}/release-metadata.json`)).sourceInputHash === release.sourceInputHash, 'website download: source identity differs'); } catch { check(false, 'website download: metadata invalid'); }

  }
  return [...new Set(errors)];
}

export function checkPackageMaterials(directory, base = projectRoot) {
  const errors = [];
  try {
    const release = JSON.parse(readFileSync(join(base, 'deploy/docker/release.json'), 'utf8'));
    const manifest = JSON.parse(readFileSync(join(directory, 'release-manifest.json'), 'utf8'));
    for (const name of installerFiles) if (!existsSync(join(directory, name))) errors.push('candidate material is missing');
    if (manifest.sourceInputHash !== release.sourceInputHash || manifest.releaseId !== release.releaseId || !['candidate', 'published'].includes(manifest.state)) errors.push('candidate source identity differs');
    for (const role of roles) {
      if (manifest.images?.[role]?.reference !== release.images[role] || !/^sha256:[a-f0-9]{64}$/.test(manifest.images?.[role]?.imageId || '')) errors.push(`candidate ${role} image identity differs`);
      if (manifest.state === 'published' && !/^sha256:[a-f0-9]{64}$/.test(manifest.images?.[role]?.digest || '')) errors.push(`published ${role} digest is missing`);
    }
    if (readFileSync(join(directory, 'docker-compose.yml'), 'utf8') !== renderCompose(release, base)) errors.push('candidate Compose differs from source');
    if (readFileSync(join(directory, 'single-host-compose.yml'), 'utf8') !== renderCompose(release, base, { singleHost: true })) errors.push('candidate single-host Compose differs from source');
    const lines = readFileSync(join(directory, 'SHA256SUMS'), 'utf8').trim().split('\n');
    const checked = new Set();
    for (const line of lines) {
      const match = /^([a-f0-9]{64})  ([A-Za-z0-9_.-]+)$/.exec(line);
      if (!match || checked.has(match[2])) { errors.push('candidate checksum entry is invalid'); continue; }
      checked.add(match[2]);
      if (sha(readFileSync(join(directory, match[2]))) !== match[1]) errors.push('candidate checksum mismatch');
    }
    for (const file of installerFiles.filter(name => name !== 'SHA256SUMS')) if (!checked.has(file)) errors.push('candidate checksum coverage is incomplete');
  } catch { errors.push('candidate materials are unreadable or invalid'); }
  return [...new Set(errors)];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let websiteRoot;
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--website-root') throw new Error('usage: check-docker-quickstart.mjs [--website-root PATH]');
    websiteRoot = resolve(args[1]);
  }
  const errors = checkQuickStart(projectRoot, { websiteRoot });
  if (errors.length) { process.stderr.write(errors.join('\n') + '\n'); process.exitCode = 1; }
  else process.stdout.write('Docker Quick Start, image defaults and standalone Compose are coherent.\n');
}
