import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { root, source } from './build-web-base.mjs';

const environment = JSON.parse(readFileSync(join(source, 'environment.json')));
mkdirSync(join(root, 'dist/web-base'), { recursive: true });
const temporary = mkdtempSync(join(root, 'dist/web-base/locks-'));
const owner = `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;
try {
  const wheels = join(temporary, 'wheels'); mkdirSync(wheels);
  execFileSync('docker', ['run', '--rm', '--platform', environment.platform, '--user', owner, '--label', 'piwork.fixture=web-base-locks',
    '--mount', `type=bind,src=${source},dst=/inputs,readonly`, '--mount', `type=bind,src=${wheels},dst=/out`,
    environment.pythonImage, 'python', '-m', 'pip', 'download', '--only-binary=:all:', '-r', '/inputs/requirements.in', '-d', '/out'], { stdio: 'inherit' });
  const lines = ['# Python 3.13, linux/amd64; fixed NiceGUI base dependencies.'];
  for (const file of readdirSync(wheels).filter(name => name.endsWith('.whl')).sort()) {
    const [name, version] = file.split('-');
    const digest = createHash('sha256').update(readFileSync(join(wheels, file))).digest('hex');
    lines.push(`${name.replaceAll('_', '-')}==${version} --hash=sha256:${digest}`);
  }
  writeFileSync(join(source, 'requirements.lock'), lines.join('\n') + '\n');
  console.log('Updated the fixed NiceGUI base lock. Applications inherit it and declare only extra dependencies.');
} finally { rmSync(temporary, { recursive: true, force: true }); }
