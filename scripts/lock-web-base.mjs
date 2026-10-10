import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
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
  const lines = ['# Python 3.13, linux/amd64; generated from the fixed requirements.in.'];
  for (const file of readdirSync(wheels).filter(name => name.endsWith('.whl')).sort()) {
    const [name, version] = file.split('-');
    const digest = createHash('sha256').update(readFileSync(join(wheels, file))).digest('hex');
    lines.push(`${name.replaceAll('_', '-')}==${version} --hash=sha256:${digest}`);
  }
  writeFileSync(join(source, 'requirements.lock'), lines.join('\n') + '\n');
  const frontend = join(temporary, 'frontend'); mkdirSync(frontend);
  for (const file of ['package.json', 'package-lock.json']) copyFileSync(join(source, 'frontend', file), join(frontend, file));
  execFileSync('docker', ['run', '--rm', '--platform', environment.platform, '--user', owner, '--label', 'piwork.fixture=web-base-locks',
    '--env', 'HOME=/tmp', '--mount', `type=bind,src=${frontend},dst=/app`, '--workdir', '/app', environment.nodeImage,
    'npm', 'install', '--package-lock-only', '--ignore-scripts', '--registry=https://registry.npmjs.org'], { stdio: 'inherit' });
  copyFileSync(join(frontend, 'package-lock.json'), join(source, 'frontend/package-lock.json'));
  for (const name of ['web-app', 'workstation']) {
    const template = join(root, 'internal/coreassets/piwork-brain/templates', name);
    copyFileSync(join(source, 'requirements.lock'), join(template, 'requirements.lock'));
    for (const file of ['package.json', 'package-lock.json']) copyFileSync(join(source, 'frontend', file), join(template, 'frontend', file));
  }
  console.log('Updated fixed base and template dependency locks; rebuild and revalidate before publication.');
} finally { rmSync(temporary, { recursive: true, force: true }); }
