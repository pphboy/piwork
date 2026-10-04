import { cp, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const command = promisify(execFile);
export async function buildWorkstationFixture(temporary, image = 'piwork-workstation:acceptance') {
  const directory = join(temporary, 'workstation-image'); await mkdir(directory);
  await cp(new URL('../internal/coreassets/piwork-brain/templates/workstation/requirements.lock', import.meta.url), join(directory, 'requirements.lock'));
  await writeFile(join(directory, 'Dockerfile'), `FROM python:3.13-slim
LABEL piwork.fixture="workstation"
COPY requirements.lock /opt/workstation/requirements.lock
RUN python -m pip download --only-binary=:all: --require-hashes -r /opt/workstation/requirements.lock -d /opt/workstation/wheels
ENV PYTHONDONTWRITEBYTECODE=1
USER 10001:10001
`);
  await command('docker', ['build', '-t', image, directory], { timeout: 600000, maxBuffer: 4 * 1024 * 1024 });
  return image;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const temporary = await mkdtemp(join(tmpdir(), 'piwork-workstation-build-'));
  try { console.log(await buildWorkstationFixture(temporary)); }
  finally { await rm(temporary, { recursive: true, force: true }); }
}
