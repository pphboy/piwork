import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, relative, extname, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveRepositoryFile } from './resolve-change-artifact.mjs';

export const releaseMaterials = [
  'README.md', 'README.zh-CN.md', 'LICENSE',
  'deploy/docker/README.md', 'deploy/docker/README.zh-CN.md',
  'apps/ui-shared/assets/piwork-logo.png',
  'apps/ui-shared/assets/desktop-preview.png',
];
const textFile = name => ['.md', '.html'].includes(extname(name));
const imageFile = name => ['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif', '.ico'].includes(extname(name));
const installationFiles = new Set([
  'deploy/docker/docker-compose.yml', 'examples/single-host/docker-compose.yml',
  'deploy/images/web-base/requirements.lock', 'deploy/images/web-base/environment.json',
  'deploy/images/web-base/release.json', 'deploy/images/web-base/releases/fastapi-react-0.1.0.json',
]);
function allowedMaterial(name) {
  if (releaseMaterials.includes(name) || name === 'AGENTS.md' || installationFiles.has(name)) return true;
  if (/^deploy\/docker\/releases\/[^/]+\.json$/.test(name)) return true;
  return /^(?:openspec\/(?:specs|changes)\/|deploy\/|examples\/|apps\/ui-shared\/assets\/)/.test(name) && (textFile(name) || imageFile(name));
}
function rewriteLinks(text, rewrite) {
  return text.replace(/^[ \t]*```[^\n]*\n[\s\S]*?^[ \t]*```[^\n]*$|\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)|\b(?:src|href)=["']([^"']+)["']/gm,
    (match, markdown, html) => {
      const target = markdown || html;
      return target ? match.replace(target, rewrite(target)) : match;
    });
}
export function stageReleaseMaterials({ base, output, commit }) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Release materials require the actual source commit.');
  base = realpathSync(base); output = resolve(output);
  if (output === base || base.startsWith(output + sep)) throw new Error('Release output must not overwrite the source tree.');
  const git = args => execFileSync('git', ['-C', base, ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  try { if (git(['cat-file', '-t', commit]).toString().trim() !== 'commit') throw new Error(); }
  catch { throw new Error('Release materials require an existing source commit.'); }
  const selected = new Map(), localClosure = new Set(), pending = [...releaseMaterials];
  const matchingGitObject = new Map();
  const source = name => {
    if (!allowedMaterial(name)) throw new Error(`Release link target is outside allowed materials: ${name}`);
    const path = resolveRepositoryFile(base, name);
    if (path === output || path.startsWith(output + sep)) throw new Error(`Release input is inside staging output: ${name}`);
    return readFileSync(path);
  };
  const matchesCommit = (name, bytes) => {
    if (!matchingGitObject.has(name)) {
      let equal = false;
      try { equal = git(['cat-file', 'blob', `${commit}:${name}`]).equals(bytes); } catch { /* Absent objects must be bundled. */ }
      matchingGitObject.set(name, equal);
    }
    return matchingGitObject.get(name);
  };
  const locate = (name, target) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) return null;
    const [, path, suffix] = /^([^?#]*)(.*)$/.exec(target);
    const normalized = relative(base, resolve(base, dirname(name), decodeURIComponent(path))).replaceAll('\\', '/');
    return { name: normalized, suffix };
  };
  // Discover and validate the selected dependency closure before writing it.
  for (let index = 0; index < pending.length; index++) {
    const name = pending[index], bytes = selected.get(name) || source(name);
    selected.set(name, bytes);
    if (!textFile(name)) continue;
    rewriteLinks(bytes.toString('utf8'), target => {
      const link = locate(name, target);
      if (!link) return target;
      const child = source(link.name);
      const bundle = localClosure.has(name) || imageFile(link.name) || selected.has(link.name) || releaseMaterials.includes(link.name) || !matchesCommit(link.name, child);
      if (bundle) {
        const promote = !releaseMaterials.includes(link.name) && !localClosure.has(link.name);
        if (promote) localClosure.add(link.name);
        if (!selected.has(link.name) || promote) pending.push(link.name);
        selected.set(link.name, child);
      }
      return target;
    });
  }
  for (const [name, bytes] of selected) {
    const destination = join(output, name);
    mkdirSync(dirname(destination), { recursive: true });
    if (!textFile(name)) { writeFileSync(destination, bytes); continue; }
    const rendered = rewriteLinks(bytes.toString('utf8'), target => {
      const link = locate(name, target);
      if (!link || selected.has(link.name)) return target;
      if (!matchesCommit(link.name, source(link.name))) throw new Error(`Unresolved release link: ${name} -> ${target}`);
      return `https://github.com/pphboy/piwork/blob/${commit}/${link.name.split('/').map(encodeURIComponent).join('/')}${link.suffix}`;
    });
    writeFileSync(destination, rendered);
  }
  return [...selected.keys()];
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) throw new Error('usage: stage-go-release-materials.mjs <output> <source-commit>');
  stageReleaseMaterials({ base: resolve(dirname(fileURLToPath(import.meta.url)), '..'), output: resolve(process.argv[2]), commit: process.argv[3] });
}
