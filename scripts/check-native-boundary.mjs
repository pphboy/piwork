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

// Historical change evidence is outside the current source/spec scan.
const forbiddenImports = /@piwork\/(?:core-store|runtime-docker|client-sdk|work-package|core|cli|console|file-helper|snapshot-helper|service-mcp|package-helper)(?=[\s/\"'`]|$)|(?:apps\/(?:core|cli|console|file-helper|snapshot-helper|service-mcp|package-helper)|packages\/(?:core-store|runtime-docker|client-sdk|work-package))(?:[\/"'`\s]|$)|Dockerfile\.(?:file-helper|snapshot-helper)(?!\.native)\b/;
async function scan(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (['dist','node_modules','.git','.pi'].includes(item.name)) continue;
    const path = join(directory, item.name);
    if (item.isDirectory()) { await scan(path); continue; }
    // Exclude only this rule-bearing file and its injected-fixture test.
    if (path==='scripts/check-native-boundary.mjs'||path==='scripts/check-native-boundary.test.mjs')continue;
    if (!/\.(?:ts|mjs|js|json|yaml|yml|toml|md|html|sh)$/.test(path) && !/^(?:Dockerfile[^/]*|Makefile)$/.test(item.name)) continue;
    if (forbiddenImports.test(await readFile(path, 'utf8'))) throw new Error(`Legacy platform reference: ${path}`);
  }
}
for (const directory of ['apps','packages','scripts','openspec/specs','deploy','examples','.github']) {
 if (await stat(directory).then(()=>true,()=>false))await scan(directory);
}
for(const item of await readdir('.',{withFileTypes:true})) {
 // Secret-scanner exemptions name historical fixtures, not runtime dependencies.
 if(item.name === '.gitleaks.toml')continue;
 if(!item.isFile()|| !(/\.(?:json|yaml|yml|toml|sh)$/.test(item.name)||/^(?:Dockerfile[^/]*|Makefile)$/.test(item.name)))continue;
 if(forbiddenImports.test(await readFile(item.name,'utf8')))throw new Error(`Legacy platform reference: ${item.name}`);
}
for (const name of ['README.md','README.zh-CN.md','AGENTS.md']) {
 const source=await readFile(name,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
 if(forbiddenImports.test(source))throw new Error(`Legacy platform reference: ${name}`);
}
// The composition root owns lifecycle, not a shortcut around Core HTTP.
async function checkHTTPBoundary(directory) {
 if (!await stat(directory).then(() => true, () => false)) return;
 for (const item of await readdir(directory, {withFileTypes:true})) {
  const path = join(directory, item.name);
  if (item.isDirectory()) { await checkHTTPBoundary(path); continue; }
  if (!path.endsWith('.go') || path.endsWith('_test.go')) continue;
  const source = await readFile(path, 'utf8');
  if (/\b(?:NewHandlerTransport|HandlerTransport|ListenWithHandler)\b/.test(source)) throw new Error(`In-process Core transport: ${path}`);
  if (/^internal\/(?:webapp|cli|consoleapp)\//.test(path) && /"piwork\/internal\/(?:coreapp|corestore|identity)"/.test(source)) throw new Error(`Browser/Core domain dependency: ${path}`);
 }
}
await checkHTTPBoundary('internal');
console.log('Current sources, scripts, configuration, locks and main specs use native Go platform entry points.');
