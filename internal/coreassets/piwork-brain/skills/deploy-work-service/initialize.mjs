import { cpSync, lstatSync, mkdirSync, readdirSync, chmodSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function directory(path) {
  try { mkdirSync(path); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Initialization requires a real workspace directory');
}
function writable(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error('Template links are unsupported');
  chmodSync(path, (stat.mode & 0o777) | (stat.isDirectory() ? 0o700 : 0o600));
  if (stat.isDirectory()) for (const name of readdirSync(path)) writable(join(path, name));
}

export function templateFiles(template) {
  if (!['web-app', 'workstation', 'fastapi-htmx'].includes(template)) throw new Error('Unknown template');
  const entries = new Map();
  for (const part of ['common-workstation', template]) {
    const source = join(packageRoot, 'templates', part);
    for (const name of readdirSync(source)) {
      if (entries.has(name)) throw new Error('Conflicting template input: ' + name);
      entries.set(name, join(source, name));
    }
  }
  return entries;
}

export function initialize({ name, template = 'web-app', workspace = '/var/data/workspace' }) {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(name || '') || !['web-app', 'workstation', 'fastapi-htmx'].includes(template)) {
    throw new Error('Initialization requires a valid application name and standard template');
  }
  const root = realpathSync(workspace);
  directory(join(root, 'apps'));
  const target = join(root, 'apps', name);
  // Exclusive mkdir rejects every existing target, including dangling links,
  // before the first Spec/source/registration write. Concurrent callers cannot win twice.
  mkdirSync(target);
  const entries = templateFiles(template);
  cpSync(entries.get('SPEC.md'), join(target, 'SPEC.md'), { force: false, errorOnExist: true });
  for (const [entry, source] of entries) {
    if (entry === 'SPEC.md') continue;
    cpSync(source, join(target, entry), { recursive: true, force: false, errorOnExist: true });
  }
  writable(target);
  directory(join(root, '.pi'));
  directory(join(root, '.pi/services'));
  writeFileSync(join(root, '.pi/services', name + '.json'), JSON.stringify({ contractVersion: 1, serviceName: name, apiPortName: 'web', mode: 'pi-managed' }) + '\n', { flag: 'wx' });
  return { initialized: true, name, template };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { name: { type: 'string' }, template: { type: 'string', default: 'web-app' } } });
    console.log(JSON.stringify(initialize(values)));
  } catch (error) {
    console.error('Application initialization refused: ' + (error.code === 'EEXIST' ? 'target already exists; read and update the existing application' : error.message));
    process.exitCode = 1;
  }
}
