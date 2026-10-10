import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { root } from './build-web-base.mjs';
const command = promisify(execFile);
export async function buildWorkstationFixture(_temporary, image = 'piwork-workstation:acceptance') {
  await command(process.execPath, [resolve(root, 'scripts/build-web-base.mjs')], { cwd: root, timeout: 600000, maxBuffer: 16 << 20 });
  const candidate = JSON.parse(await readFile(resolve(root, 'dist/web-base/candidate.json'), 'utf8'));
  await command('docker', ['tag', candidate.reference, image]);
  return image;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(await buildWorkstationFixture());
