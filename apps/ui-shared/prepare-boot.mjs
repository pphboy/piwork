import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const script = readFileSync(new URL('./boot-watchdog.js', import.meta.url), 'utf8');
if (script.includes('</script')) throw new Error('The boot watchdog cannot close its own script element');
const hash = createHash('sha256').update(script).digest('base64');

export function prepareBoot(publicDir, entries) {
  for (const [name, page] of entries) {
    const path = new URL(name, publicDir);
    const html = readFileSync(path, 'utf8');
    const marker = '<!-- PIWORK_BOOT_WATCHDOG -->';
    if (html.split(marker).length !== 2) throw new Error(`Missing unique boot marker in ${name}`);
    writeFileSync(path, html.replace(marker, `<script data-boot-watchdog data-page="${page}">${script}</script>`));
  }
  writeFileSync(new URL('boot-csp.txt', publicDir), hash + '\n');
}
