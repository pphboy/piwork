import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
export function parseTargets(args, config, fallback) {
  const explicit = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--target' || !args[i + 1]) throw new Error('usage: build-cli.mjs [--target <goos>/<goarch>]...');
    explicit.push(args[++i]);
  }
  let targets = explicit.length ? explicit : config == null ? [fallback] : config.version === 1 && Array.isArray(config.targets) && Object.keys(config).every(k => ['version', 'targets'].includes(k)) ? config.targets : [];
  if (!targets.length || targets.some(t => typeof t !== 'string' || !/^(windows|linux)\/[a-z0-9]+$/.test(t))) throw new Error('invalid or empty CLI targets');
  return [...new Set(targets)];
}
export function desktopInputHash(base = root) {
  const files = [];
  const visit = name => { for (const entry of readdirSync(join(base, name), { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name, 'en'))) {
    const child = `${name}/${entry.name}`;
    if (entry.isDirectory()) visit(child); else if (entry.isFile()) files.push(child); else throw new Error(`unsupported build input: ${child}`);
  } };
  for (const name of ['apps/desktop-webui/src', 'apps/desktop-webui/public', 'apps/desktop-webui/scripts']) visit(name);
  files.push('apps/desktop-webui/tsconfig.json', 'apps/desktop-webui/package.json', 'scripts/sync-desktop-assets.mjs', 'package-lock.json', 'docs/images/piwork-logo.png');
  const hash = createHash('sha256');
  for (const name of files.sort()) { const data = readFileSync(join(base,name)); hash.update(`${name}\0${data.length}\0`); hash.update(data); }
  return hash.digest('hex');
}
export function buildCLI(args, { base = root, run = (command, argv, options) => spawnSync(command, argv, options), nodeVersion = process.versions.node } = {}) {
  if (Number(nodeVersion.split('.')[0]) !== 24) throw new Error('CLI builds require Node 24');
  const env = { ...process.env, GOTOOLCHAIN: 'local', CGO_ENABLED: '0' };
  const invoke = (command, argv, cwd = base, extra = {}) => {
    const result = run(command, argv, { cwd, env: {...env, ...extra}, encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.stderr || result.stdout}`);
    return (result.stdout || '').trim();
  };
  if (invoke('go', ['env', 'GOVERSION']) !== 'go1.25.5') throw new Error('CLI builds require Go 1.25.5');
  const fallback = invoke('go', ['env', 'GOOS']) + '/' + invoke('go', ['env', 'GOARCH']);
  const configPath = join(base, 'config/cli-release-targets.json');
  const explicit = args.includes('--target');
  const config = !explicit && existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : null;
  const targets = parseTargets(args, config, fallback);
  const supported = new Set(invoke('go', ['tool', 'dist', 'list']).split(/\s+/));
  for (const target of targets) if (!supported.has(target)) throw new Error(`Go cannot build CLI target: ${target}`);
  const commit = invoke('git', ['rev-parse', '--verify', 'HEAD']);
  const uiHash = desktopInputHash(base);
  rmSync(join(base, 'apps/desktop-webui/dist'), { recursive: true, force: true });
  invoke(process.execPath, [join(base, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], join(base, 'apps/desktop-webui'));
  invoke(process.execPath, ['scripts/copy-static.mjs'], join(base, 'apps/desktop-webui'));
  invoke(process.execPath, ['scripts/sync-desktop-assets.mjs']);
  const version = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')).version;
  if (typeof version !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(version)) throw new Error('invalid client release version');
  const modified = Boolean(invoke('git', ['status', '--porcelain', '--untracked-files=normal']));
  const stamps = [`Version=${version}`, `Commit=${commit}`, `Modified=${modified}`, `DesktopUIHash=${uiHash}`].map(v => '-X piwork/internal/buildinfo.' + v).join(' ');
  const outputs = [];
  for (const target of targets) {
    const [goos, goarch] = target.split('/');
    const directory = join(base, 'dist/cli', `${goos}-${goarch}`);
    mkdirSync(directory, {recursive: true});
    const binary = join(directory, goos === 'windows' ? 'piwork-cli.exe' : 'piwork-cli');
    const identity = JSON.stringify({ releaseVersion: version, commit, modified, desktopUIHash: uiHash, target, goVersion: 'go1.25.5' });
    const ldflags = stamps + ` -X 'piwork/internal/buildinfo.ClientReleaseIdentity=piwork-cli-release-v1:${identity}'`;
    invoke('go', ['build', '-mod=readonly', '-trimpath', '-buildvcs=true', '-ldflags', ldflags, '-o', binary, './cmd/piwork-cli'], base, {GOOS: goos, GOARCH: goarch});
    const data = readFileSync(binary);
    const metadata = {version:1, program:'piwork-cli', releaseVersion:version, commit, modified, goVersion:'go1.25.5', target, binary:relative(directory,binary), bytes:data.length, sha256:createHash('sha256').update(data).digest('hex'), desktopUIHash:uiHash};
    writeFileSync(join(directory, 'build.json'), JSON.stringify(metadata, null, 2) + '\n');
    outputs.push(binary);
  }
  return outputs;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { for (const output of buildCLI(process.argv.slice(2))) process.stdout.write(output + '\n'); }
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
