import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inputHash, root } from './build-web-base.mjs';
const command = promisify(execFile);
export async function buildWorkstationFixture(_temporary, image = 'piwork-workstation:acceptance') {
  let candidate;
  try {
    const current = JSON.parse(await readFile(resolve(root, 'dist/web-base/candidate.json'), 'utf8'));
    if (current.contractVersion === 2 && current.inputHash === inputHash()) {
      const { stdout } = await command('docker', ['image', 'inspect', current.reference]);
      const actual = JSON.parse(stdout)[0];
      if (actual.Id === current.imageId && actual.Config.Labels['io.piwork.web-base.input-sha256'] === current.inputHash) candidate = current;
    }
  } catch {}
  if (!candidate) {
    await command(process.execPath, [resolve(root, 'scripts/build-web-base.mjs')], { cwd: root, timeout: 600000, maxBuffer: 16 << 20 });
    candidate = JSON.parse(await readFile(resolve(root, 'dist/web-base/candidate.json'), 'utf8'));
  }
  await command('docker', ['tag', candidate.imageId, image]);
  return image;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(await buildWorkstationFixture());
