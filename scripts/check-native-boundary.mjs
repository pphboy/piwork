import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const removed = [
  'apps/core', 'apps/cli', 'apps/console', 'apps/file-helper',
  'apps/snapshot-helper', 'apps/service-mcp', 'apps/package-helper',
  'packages/core-store', 'packages/runtime-docker',
  'packages/client-sdk', 'packages/work-package',
  'Dockerfile.file-helper', 'Dockerfile.snapshot-helper',
];
for (const path of removed) {
  if (await stat(path).then(() => true, () => false)) throw new Error(`Legacy platform path remains: ${path}`);
}

const allowedWorkspaces = new Set([
  '@piwork/agentd', '@piwork/contracts', '@piwork/pi-package',
  '@piwork/pi-adapter', '@piwork/work-store',
  '@piwork/desktop-webui', '@piwork/console-webui',
]);
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
for (const [path, value] of Object.entries(lock.packages)) {
  if ((path.startsWith('apps/') || path.startsWith('packages/')) && !allowedWorkspaces.has(value.name)) {
    throw new Error(`Legacy workspace remains in lockfile: ${path}`);
  }
}
for (const root of ['apps', 'packages']) {
  for (const name of await readdir(root)) {
    const path = join(root, name);
    if (!(await stat(path)).isDirectory()) continue;
    if(path==='apps/ui-shared' && !(await stat(join(path,'package.json')).then(()=>true,()=>false)))continue;
    const manifest = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
    if (!allowedWorkspaces.has(manifest.name)) throw new Error(`Unexpected TS workspace: ${path}`);
  }
}

// Exact historical evidence files are read-only records, not current entry points.
const historical = new Set(['docs/go-migration-acceptance.md','docs/go-migration-final-report.md','docs/go-migration-scenarios.json','docs/go-migration-boundary.json','docs/go-migration-ui-review.md','docs/ui-prototypes/workspace-shell.html']);
const forbiddenImports = /@piwork\/(?:core-store|runtime-docker|client-sdk|work-package|core|cli|console|file-helper|snapshot-helper|service-mcp|package-helper)(?=[\s/\"'`]|$)|(?:apps\/(?:core|cli|console|file-helper|snapshot-helper|service-mcp|package-helper)|packages\/(?:core-store|runtime-docker|client-sdk|work-package))(?:[\/"'`\s]|$)|Dockerfile\.(?:file-helper|snapshot-helper)(?!\.native)\b/;
async function scan(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (['dist','node_modules','.git','.pi'].includes(item.name)) continue;
    const path = join(directory, item.name);
    if (item.isDirectory()) { await scan(path); continue; }
    // Exclude only this rule-bearing file and its injected-fixture test.
    if (path==='scripts/check-native-boundary.mjs'||path==='scripts/check-native-boundary.test.mjs'||historical.has(path))continue;
    if (!/\.(?:ts|mjs|js|json|yaml|yml|toml|md|html|sh)$/.test(path) && !/^(?:Dockerfile[^/]*|Makefile)$/.test(item.name)) continue;
    if (forbiddenImports.test(await readFile(path, 'utf8'))) throw new Error(`Legacy platform reference: ${path}`);
  }
}
for (const directory of ['apps','packages','scripts','docs','.github']) {
 if (await stat(directory).then(()=>true,()=>false))await scan(directory);
}
for(const item of await readdir('.',{withFileTypes:true})) {
 if(!item.isFile()|| !(/\.(?:json|yaml|yml|toml|sh)$/.test(item.name)||/^(?:Dockerfile[^/]*|Makefile)$/.test(item.name)))continue;
 if(forbiddenImports.test(await readFile(item.name,'utf8')))throw new Error(`Legacy platform reference: ${item.name}`);
}
console.log('Current sources, scripts, build/runtime configuration, locks and docs use native Go platform entry points.');
