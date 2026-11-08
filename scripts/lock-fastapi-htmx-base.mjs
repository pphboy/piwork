import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, source } from './build-fastapi-htmx-base.mjs';

const environment = JSON.parse(readFileSync(join(source, 'environment.json')));
mkdirSync(join(root, 'dist/fastapi-htmx-base'), { recursive: true });
const temporary = mkdtempSync(join(root, 'dist/fastapi-htmx-base/lock-'));
try {
  execFileSync('docker', ['run', '--rm', '--platform', environment.platform,
    '--label', 'piwork.fixture=fastapi-lock', '--user', `${process.getuid()}:${process.getgid()}`,
    '--mount', `type=bind,src=${source},dst=/inputs,readonly`, '--mount', `type=bind,src=${temporary},dst=/out`,
    environment.pythonImage, 'python', '-m', 'pip', 'download', '--only-binary=:all:', '-r', '/inputs/requirements.in', '-d', '/out'], { stdio: 'inherit' });
  const lines = ['# Python 3.13 Linux amd64; exact standard wheel hashes.'];
  for (const name of readdirSync(temporary).filter(name => name.endsWith('.whl')).sort()) {
    const [distribution, version] = name.split('-');
    lines.push(`${distribution.replaceAll('_', '-').toLowerCase()}==${version} --hash=sha256:${createHash('sha256').update(readFileSync(join(temporary, name))).digest('hex')}`);
  }
  writeFileSync(join(source, 'requirements.lock'), lines.join('\n') + '\n');
} finally { rmSync(temporary, { recursive: true, force: true }); }
