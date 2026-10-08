import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const initializationKeys = ['PIWORK_ADMIN_ACCOUNT', 'PIWORK_ADMIN_PASSWORD', 'PIWORK_MODEL_PROVIDER', 'PIWORK_MODEL', 'PIWORK_API_KEY'];
const stateDirectory = '/var/lib/piwork/client';
const runDataDirectory = '/var/lib/piwork/quickstart/core';
const digestReference = /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/;
const imageRoles = { core: 'CORE', cli: 'CLI', agent: 'AGENT', packageHelper: 'PACKAGE_HELPER', fileHelper: 'FILE_HELPER', snapshotHelper: 'SNAPSHOT_HELPER' };

export function section(text, name) {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  if (text.split(start).length !== 2 || text.split(end).length !== 2) return null;
  const left = text.indexOf(start) + start.length;
  const right = text.indexOf(end);
  return right >= left ? text.slice(left, right).trim() : null;
}

export function codeBlocks(text) {
  return [...text.matchAll(/^```([a-z]+)\n([\s\S]*?)\n```/gm)].map(match => ({ language: match[1], code: match[2] }));
}

const logical = code => code.replace(/[ \t]*\\\n[ \t]*/g, ' ');
const unquote = token => /^(["']).*\1$/s.test(token) ? token.slice(1, -1) : token;
function dockerRun(command) {
  const tokens = (command.match(/"(?:\\.|[^"\\])*"|'[^']*'|\S+/g) || []).map(unquote);
  const options = new Map();
  const valueOptions = new Set(['--name', '--user', '--network', '--env-file', '--env', '-e', '--mount', '--volume', '-v', '--stop-timeout', '--entrypoint', '--add-host', '--publish', '-p']);
  let index = 2;
  while (tokens[index]?.startsWith('-')) {
    const token = tokens[index++];
    const equal = token.indexOf('=');
    const key = equal === -1 ? token : token.slice(0, equal);
    const value = equal !== -1 ? token.slice(equal + 1) : valueOptions.has(key) ? tokens[index++] : true;
    options.set(key, [...(options.get(key) || []), value]);
  }
  return { options, image: tokens[index], args: tokens.slice(index + 1) };
}
const values = (run, key) => run.options.get(key) || [];
const one = (run, key) => values(run, key).length === 1 ? values(run, key)[0] : undefined;
const environment = run => new Map([...values(run, '--env'), ...values(run, '-e')].map(value => {
  const equal = String(value).indexOf('=');
  return [String(value).slice(0, equal), String(value).slice(equal + 1)];
}));
const pairs = contents => new Map(contents.split('\n').filter(line => line && !line.startsWith('#')).map(line => {
  const equal = line.indexOf('=');
  return [line.slice(0, equal), line.slice(equal + 1)];
}));

export function installerFiles(contents) {
  const list = contents.match(/for\s*\(const name of \[([\s\S]*?)\]\)\s*copyFileSync/);
  return list ? [...list[1].matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]) : [];
}

export function checkQuickStart(root = projectRoot) {
  const errors = [];
  const check = (condition, file, field) => { if (!condition) errors.push(`${file}: ${field}`); };
  const read = file => {
    try { return readFileSync(join(root, file), 'utf8'); }
    catch { errors.push(`${file}: missing material`); return ''; }
  };
  const roots = ['README.md', 'README.zh-CN.md'];
  const manuals = roots.map(name => `deploy/docker/${name}`);
  const documents = [...roots, ...manuals].map(name => ({ name, text: read(name) }));
  const runTemplate = read('deploy/docker/core.run.env.example');
  const composeTemplate = read('deploy/docker/core.env.example');
  const compose = read('deploy/docker/compose.core.yaml');
  const cliImage = read('Dockerfile.cli');
  const packager = read('scripts/build-docker-release.mjs');
  const baseline = section(documents[0].text, 'docker-quickstart');
  const baselineBlocks = baseline === null ? [] : codeBlocks(baseline);

  for (const { name, text } of documents) {
    const main = section(text, 'docker-quickstart');
    check(main !== null, name, 'unique docker-quickstart section');
    if (main === null) continue;
    const blocks = codeBlocks(main);
    check(JSON.stringify(blocks) === JSON.stringify(baselineBlocks), name, 'paired terminal commands');
    check(blocks.length === 8 && blocks.every(block => block.language === 'sh'), name, 'eight complete shell blocks');
    const commands = blocks.map(block => logical(block.code)).join('\n');
    check(!/\bdesktop\b|docker compose|\bwork (?:start|list)\b|\.\.\./.test(commands), name, 'terminal-only shortest path');
    check(commands.includes('sha256sum --check --strict'), name, 'checksum failure stops installation');
    check(commands.includes('test ! -e core.run.env') && commands.includes('chmod 600 core.run.env'), name, 'private configuration without overwrite');
    check(commands.includes("if [ -f core.run.env.example ]; then") && commands.includes('cp core.run.env.example core.run.env'), name, 'new installer template');
    const heredoc = commands.match(/cat > core\.run\.env <<'EOF'\n([\s\S]*?)\nEOF/);
    check(heredoc?.[1] + '\n' === runTemplate, name, 'old installer blank template matches run example');
    check(commands.includes('s/^PIWORK_CORE_IMAGE=//p') && commands.includes('s/^PIWORK_CLI_IMAGE=//p') && commands.includes('@sha256:[0-9a-f]\\{64\\}'), name, 'fixed image references read without source');
    check(commands.includes('test -n "$PIWORK_CORE_IMAGE" && test -n "$PIWORK_CLI_IMAGE"'), name, 'both image references required');
    const runs = commands.split('\n').filter(line => line.startsWith('docker run ')).map(dockerRun);
    check(runs.length === 2, name, 'one Core run and one interactive CLI run');
    const core = runs.find(run => run.image === '$PIWORK_CORE_IMAGE');
    const cli = runs.find(run => run.image === '$PIWORK_CLI_IMAGE');
    check(Boolean(core && cli), name, 'published Core/CLI image variables');
    if (core) {
      const env = environment(core);
      check(one(core, '--network') === 'host' && core.options.has('--detach') && core.options.has('--init'), name, 'Core background host network');
      check(one(core, '--user') === '0:0' && !core.options.has('--privileged'), name, 'Core installation user');
      check(JSON.stringify(values(core, '--env-file')) === JSON.stringify(['release.env', 'core.run.env']), name, 'Core release and raw environment files');
      for (const [key, value] of Object.entries({ DOCKER_HOST: 'unix:///var/run/docker.sock', DOCKER_CONTEXT: '', PIWORK_DATA_DIR: runDataDirectory, PIWORK_CORE_URL: 'http://127.0.0.1:7171', PIWORK_LISTEN: '0.0.0.0:7171', PIWORK_AGENT_GRPC_LISTEN: '0.0.0.0:7172', PIWORK_AGENT_GRPC_ADVERTISE: 'piwork-core:7172' })) {
        check(env.has(key) && env.get(key) === value, name, `Core ${key}`);
      }
      check(one(core, '--volume') === `${runDataDirectory}:${runDataDirectory}`, name, 'Core same absolute data path');
      check(one(core, '--mount') === 'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock', name, 'existing Docker socket bind');
      check(one(core, '--stop-timeout') === '60', name, 'Core 60 second shutdown budget');
      check(JSON.stringify(core.args) === JSON.stringify(['serve', '--allow-insecure-remote']), name, 'Core existing HTTP opt-in');
      check(![...env.keys()].some(key => initializationKeys.includes(key)), name, 'Core secrets use private file');
    }
    if (cli) {
      const env = environment(cli);
      check(cli.options.has('--rm') && cli.options.has('--init') && cli.options.has('-it'), name, 'CLI removable interactive process');
      check(one(cli, '--entrypoint') === '/bin/sh' && JSON.stringify(cli.args) === '["-i"]', name, 'CLI shell overrides Desktop');
      check(one(cli, '--add-host') === 'host.docker.internal:host-gateway', name, 'Linux host-gateway');
      check(env.size === 1 && env.get('PIWORK_CORE_URL') === 'http://host.docker.internal:7171' && !values(cli, '--env-file').length, name, 'CLI environment selects only Core origin');
      check(one(cli, '--mount') === `type=volume,src=piwork-quickstart-client-state,dst=${stateDirectory}` && !values(cli, '--volume').length && !values(cli, '-v').length, name, 'CLI persistent credentials only');
      check(!['--publish', '-p', '--publish-all', '-P', '--privileged', '--network'].some(key => cli.options.has(key)), name, 'CLI no server ports or privileged network');
    }
    const ready = commands.split('\n').find(line => line.startsWith('timeout ')) || '';
    check(ready.startsWith('timeout 600 curl ') && ready.includes('${PIWORK_CORE_URL}/readyz?profile=docker-delivery'), name, 'complete delivery readiness and 600 second budget');
    for (const option of ['--fail', '--max-time 3', '--retry 120', '--retry-delay 5', '--retry-all-errors', '--output /dev/null']) check(ready.includes(option), name, `readiness ${option.split(' ')[0]}`);
    check(commands.includes('piwork-cli login --account ACCOUNT') && !commands.includes('--password-stdin'), name, 'TTY hidden-password login');
    check(commands.includes("piwork-cli work create --name 'My Work' --wait") && commands.includes("piwork-cli chat WORK_ID --message 'Hello, Piwork!'"), name, 'existing create and first-message commands');
  }

  const nativeBaseline = section(documents[0].text, 'native-quickstart');
  for (const { name, text } of documents.slice(0, 2)) {
    check(/<p align="center">\s*<img\b[^>]*src="docs\/images\/piwork-logo\.png"[^>]*width="160"[^>]*height="160"[^>]*>\s*<\/p>/.test(text), name, 'centered original 160px logo');
    check(/<details>\s*<summary>[^<]+<\/summary>\s*<!-- native-quickstart:start -->/.test(text), name, 'native CLI initially folded');
    const native = section(text, 'native-quickstart');
    check(native !== null && JSON.stringify(codeBlocks(native)) === JSON.stringify(codeBlocks(nativeBaseline || '')), name, 'paired native CLI commands');
    const commands = codeBlocks(native || '').map(block => block.code).join('\n');
    check(!/\bdesktop\b|\bwork (?:start|list)\b/.test(commands), name, 'native terminal shortest path');
    check(commands.includes('./piwork-cli --core CORE_URL login --account ACCOUNT') && commands.includes('./piwork-cli chat WORK_ID'), name, 'native explicit business commands');
  }

  const runValues = pairs(runTemplate);
  check(runValues.size === initializationKeys.length && initializationKeys.every(key => runValues.has(key) && runValues.get(key) === ''), 'deploy/docker/core.run.env.example', 'five blank raw initialization values');
  check(initializationKeys.every(key => composeTemplate.includes(`${key}=''`)), 'deploy/docker/core.env.example', 'same five blank Compose initialization keys');
  check(runTemplate.includes('# PIWORK_MODEL_BASE_URL=https://') && composeTemplate.includes("# PIWORK_MODEL_BASE_URL='https://"), 'deploy/docker', 'separate optional HTTPS syntax');
  check(cliImage.includes('PIWORK_CLI_CONTAINER_MODE=1') && cliImage.includes(`PIWORK_CONFIG_PATH=${stateDirectory}/credentials.json`) && cliImage.includes('chmod 0700 /var/lib/piwork/client'), 'Dockerfile.cli', 'private persistent state contract');

  const demoBaseline = section(documents[2].text, 'core-compose-demo');
  for (const { name, text } of documents.slice(2)) {
    const demo = section(text, 'core-compose-demo');
    check(demo !== null && JSON.stringify(codeBlocks(demo)) === JSON.stringify(codeBlocks(demoBaseline || '')), name, 'paired Core Compose Demo');
    const commands = codeBlocks(demo || '').map(block => logical(block.code)).join('\n');
    check(commands.includes('-f compose.core.yaml up -d --wait --wait-timeout 600 core'), name, 'Core Demo complete readiness');
    check(!/compose\.cli|\bdesktop\b/.test(commands), name, 'Demo Core only, terminal CLI');
    check(commands.includes(logical(baselineBlocks[4]?.code || 'missing')), name, 'Demo reuses interactive CLI');
    check(commands.includes('sudo install -d -m 0700 -o 0 -g 0 /var/lib/piwork/core') && commands.includes('cp core.env.example core.env'), name, 'Demo private independent Core data');
    check(section(text, 'terminal-operations') !== null, name, 'terminal diagnosis and recovery');
  }
  check(/image: \$\{PIWORK_CORE_IMAGE:/.test(compose) && /network_mode: host/.test(compose), 'deploy/docker/compose.core.yaml', 'Core Demo image and host network');
  check(compose.includes('DOCKER_HOST: unix:///var/run/docker.sock') && compose.includes('DOCKER_CONTEXT: ""'), 'deploy/docker/compose.core.yaml', 'explicit Engine Unix socket');
  check(compose.includes('source: ${PIWORK_DATA_DIR:') && compose.includes('target: ${PIWORK_DATA_DIR:'), 'deploy/docker/compose.core.yaml', 'Core Demo same absolute data path');
  check(composeTemplate.includes('PIWORK_DATA_DIR=/var/lib/piwork/core'), 'deploy/docker/core.env.example', 'Core Demo isolated data default');
  check(compose.includes('stop_grace_period: 60s') && compose.includes('readyz?profile=docker-delivery'), 'deploy/docker/compose.core.yaml', 'Core Demo shutdown and full readiness');
  for (const name of ['core.run.env.example', 'core.env.example', 'client.env.example', 'compose.core.yaml', 'compose.cli.yaml', 'compose.cli.linux.yaml', 'README.md', 'README.zh-CN.md']) check(installerFiles(packager).includes(name), 'scripts/build-docker-release.mjs', `installer contains ${name}`);
  check(packager.includes("run('node', ['scripts/check-docker-quickstart.mjs'])"), 'scripts/build-docker-release.mjs', 'candidate material check before copying');
  return errors;
}

// Checks material integrity only. Image/source identity and public availability
// remain the release builder's existing gates; a test fixture is not a release.
export function checkPackageMaterials(stage, root = projectRoot) {
  const errors = [];
  const fail = field => errors.push(`installer material: ${field}`);
  const read = name => { try { return readFileSync(join(stage, name)); } catch { fail(`missing ${name}`); return null; } };
  const files = installerFiles(readFileSync(join(root, 'scripts/build-docker-release.mjs'), 'utf8'));
  const expected = [...files, 'LICENSE', 'release.env', 'release-manifest.json'].sort();
  const actual = readdirSync(stage).filter(name => name !== 'SHA256SUMS').sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('complete expected file set');
  for (const name of [...files, 'LICENSE']) {
    const bytes = read(name);
    const source = readFileSync(join(root, name === 'LICENSE' ? name : `deploy/docker/${name}`));
    if (bytes && !bytes.equals(source)) fail(`source mismatch ${name}`);
  }
  const sums = read('SHA256SUMS');
  if (sums) {
    const seen = new Set();
    for (const line of sums.toString().trimEnd().split('\n')) {
      const match = line.match(/^([a-f0-9]{64})  ([a-zA-Z0-9_.-]+)$/);
      if (!match || seen.has(match?.[2])) { fail('invalid or repeated checksum entry'); continue; }
      const [, hash, name] = match;
      seen.add(name);
      const bytes = read(name);
      if (bytes && createHash('sha256').update(bytes).digest('hex') !== hash) fail(`checksum mismatch ${name}`);
    }
    if (JSON.stringify([...seen].sort()) !== JSON.stringify(expected)) fail('checksum file set');
  }
  const release = read('release.env');
  const metadata = read('release-manifest.json');
  try {
    const refs = pairs(release?.toString() || '');
    const manifest = JSON.parse(metadata?.toString() || '{}');
    for (const [role, suffix] of Object.entries(imageRoles)) {
      const reference = refs.get(`PIWORK_${suffix}_IMAGE`) || '';
      if (!digestReference.test(reference) || manifest.images?.[role]?.reference !== reference) fail(`fixed ${role} reference and manifest`);
    }
    if (refs.get('PIWORK_RELEASE_VERSION') !== manifest.releaseVersion) fail('release version and manifest');
  } catch { fail('release metadata syntax'); }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const errors = checkQuickStart();
  if (errors.length) {
    for (const error of errors) process.stderr.write(`Docker Quick Start: ${error}\n`);
    process.exitCode = 1;
  } else process.stdout.write('Docker Quick Start, Core Demo, templates and installer materials are consistent.\n');
}
