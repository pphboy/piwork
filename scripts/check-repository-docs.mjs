import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { resolve, join, dirname, relative, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveMigrationTarget } from './resolve-change-artifact.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function files(base, directory) {
  const path = join(base, directory);
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', 'dist', '.git', '.cache'].includes(entry.name)) return [];
    const name = join(directory, entry.name);
    return entry.isDirectory() ? files(base, name) : entry.isFile() ? [name] : [];
  });
}
export function localLinks(source) {
  const text = source.replace(/^\s*```[^\n]*\n[\s\S]*?^\s*```\s*$/gm, '');
  return [...text.matchAll(/\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)|\b(?:src|href)=["']([^"']+)["']/g)]
    .map(match => match[1] || match[2]).filter(link => !/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(link));
}
export function checkRepositoryDocs(base = root, { requireMigration = true } = {}) {
  try { lstatSync(join(base, 'docs')); throw new Error('Repository root docs entry is forbidden (including untracked files).'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const current = ['README.md', 'README.zh-CN.md', 'AGENTS.md', ...['deploy', 'examples', 'openspec/specs'].flatMap(directory => files(base, directory))]
    .filter(name => existsSync(join(base, name)) && extname(name) === '.md');
  for (const name of current) {
    for (const link of localLinks(readFileSync(join(base, name), 'utf8'))) {
      const target = resolve(base, dirname(name), decodeURIComponent(link.split(/[?#]/, 1)[0]));
      if (!target.startsWith(resolve(base) + sep) && target !== resolve(base)) throw new Error(`Documentation link escapes repository: ${name}`);
      if (!existsSync(target)) throw new Error(`Missing current documentation target: ${name} -> ${link}`);
      const fragment = link.includes('#') ? decodeURIComponent(link.slice(link.indexOf('#') + 1)) : '';
      if (fragment && extname(target) === '.md') {
        const text = readFileSync(target, 'utf8').replace(/^\s*```[^\n]*\n[\s\S]*?^\s*```\s*$/gm, '');
        const anchors = new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map(match => match[1].replaceAll('`', '').toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, '').replaceAll(' ', '-')));
        if (!anchors.has(fragment) && !text.includes(`id="${fragment}"`) && !text.includes(`name="${fragment}"`)) throw new Error(`Missing current documentation anchor: ${name} -> ${link}`);
      }
    }
  }
  for (const name of ['scripts/collect-go-migration-boundary.mjs', 'scripts/update-go-acceptance-index.mjs']) {
    if (!existsSync(join(base, name))) continue;
    const text = readFileSync(join(base, name), 'utf8');
    if (/["'`](?:\.\.?\/|\$\{root\}\/)*docs\//.test(text)) throw new Error(`Generator retains a root docs path: ${name}`);
  }
  const manifests = files(base, 'openspec/changes').filter(name => /(?:^|\/)evidence\/migration-map\.json$/.test(name));
  if (requireMigration && !manifests.length) throw new Error('Missing documentation migration manifest.');
  for (const name of manifests) {
    const manifest = JSON.parse(readFileSync(join(base, name), 'utf8'));
    if (manifest.version !== 2 || !Array.isArray(manifest.files) || manifest.sourceFileCount !== manifest.files.length) throw new Error(`Invalid migration inventory: ${name}`);
    if (new Set(manifest.files.map(entry => entry.source)).size !== manifest.files.length) throw new Error('Duplicate migration source paths.');
    for (const entry of manifest.files) {
      if (!entry.source?.startsWith('docs/') || !/^[a-f0-9]{64}$/.test(entry.sourceSha256) || entry.status !== 'mapped' || !entry.targets?.length) throw new Error(`Incomplete migration entry: ${entry.source}`);
      for (const target of entry.targets) {
        const destination = resolveMigrationTarget(base, target);
        const bytes = readFileSync(destination);
        if (!['spec', 'evidence', 'asset'].includes(target.kind)) throw new Error(`Unknown migration target kind: ${entry.source}`);
        if (target.kind === 'spec' && (!target.requirement || !bytes.toString('utf8').split('\n').some(line => line.trim() === `**Identifier:** ${target.requirement}`))) throw new Error(`Missing mapped requirement: ${entry.source}`);
        if (target.sha256 && sha(bytes) !== target.sha256) throw new Error(`Changed migration target bytes: ${entry.source}`);
        if (target.kind !== 'spec' && extname(entry.source) !== '.md' && sha(bytes) !== entry.sourceSha256) throw new Error(`Frozen evidence changed: ${entry.source}`);
      }
      if (entry.sections) {
        let next = 1;
        for (const section of entry.sections) {
          if (section.startLine !== next || section.endLine < section.startLine || !section.targetIndexes?.length || section.targetIndexes.some(index => !entry.targets[index])) throw new Error(`Invalid section coverage: ${entry.source}`);
          next = section.endLine + 1;
        }
        if (entry.sourceLines && next !== entry.sourceLines + 1) throw new Error(`Incomplete section coverage: ${entry.source}`);
      }
    }
  }
  return { currentDocuments: current.length, migrationManifests: manifests.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkRepositoryDocs();
  console.log(`Repository documentation boundaries verified: ${result.currentDocuments} current documents; ${result.migrationManifests} migration manifest(s).`);
}
