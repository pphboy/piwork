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
    const manifest = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
    if (!allowedWorkspaces.has(manifest.name)) throw new Error(`Unexpected TS workspace: ${path}`);
  }
}

const forbiddenImports = /@piwork\/(?:core-store|runtime-docker|client-sdk|work-package)|apps\/(?:core|cli|console|file-helper|snapshot-helper|service-mcp|package-helper)\//;
async function scan(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.name === 'dist' || item.name === 'node_modules') continue;
    const path = join(directory, item.name);
    if (item.isDirectory()) { await scan(path); continue; }
    if (!/\.(?:ts|mjs|js)$/.test(path)) continue;
    if (forbiddenImports.test(await readFile(path, 'utf8'))) throw new Error(`Legacy platform reference: ${path}`);
  }
}
await scan('apps');
await scan('packages');
console.log('Retained TypeScript source and lockfile contain only harness and browser workspaces.');
