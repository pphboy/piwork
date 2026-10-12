import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';

function inside(base, path) {
  const part = relative(base, path);
  return part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part);
}
export function resolveRepositoryFile(base, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\')) throw new Error(`Invalid repository path: ${path}`);
  const root = realpathSync(base), target = resolve(root, path);
  if (!inside(root, target)) throw new Error(`Repository path escapes root: ${path}`);
  if (!existsSync(target)) throw new Error(`Missing repository file: ${path}`);
  if (!inside(root, realpathSync(target))) throw new Error(`Repository symlink escapes root: ${path}`);
  if (!statSync(target).isFile()) throw new Error(`Expected repository file: ${path}`);
  return target;
}
export function resolveChangeArtifact(base, { ownerChange, artifactPath, archivePath }) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(ownerChange)) throw new Error(`Invalid owner change: ${ownerChange}`);
  if (typeof artifactPath !== 'string' || !artifactPath || artifactPath.split('/').some(p => !p || p === '.' || p === '..') || isAbsolute(artifactPath) || artifactPath.includes('\\')) throw new Error(`Artifact path escapes change: ${artifactPath}`);
  const changes = resolve(base, 'openspec/changes');
  let directory;
  if (archivePath !== undefined) {
    if (!/^archive\/\d{4}-\d{2}-\d{2}-/.test(archivePath) || archivePath !== `archive/${archivePath.slice(8, 18)}-${ownerChange}`) throw new Error(`Invalid archive constraint: ${archivePath}`);
    directory = resolve(changes, archivePath);
  } else if (existsSync(resolve(changes, ownerChange))) {
    directory = resolve(changes, ownerChange);
  } else {
    const archive = resolve(changes, 'archive');
    const candidates = existsSync(archive) ? readdirSync(archive).filter(name => /^\d{4}-\d{2}-\d{2}-/.test(name) && name.slice(11) === ownerChange) : [];
    if (candidates.length !== 1) throw new Error(`${candidates.length ? 'Ambiguous' : 'Missing'} owner change: ${ownerChange}`);
    directory = resolve(archive, candidates[0]);
  }
  if (!existsSync(directory) || !statSync(directory).isDirectory()) throw new Error(`Missing owner change: ${ownerChange}`);
  const actualChanges = realpathSync(changes), actualDirectory = realpathSync(directory);
  if (!inside(actualChanges, actualDirectory)) throw new Error(`Owner change escapes changes root: ${ownerChange}`);
  const target = resolveRepositoryFile(base, relative(resolve(base), resolve(directory, artifactPath)));
  if (!inside(actualDirectory, realpathSync(target))) throw new Error(`Artifact symlink escapes change: ${artifactPath}`);
  return target;
}
export function resolveMigrationTarget(base, target) {
  if (target.ownerChange !== undefined || target.artifactPath !== undefined) {
    if (target.path !== undefined) throw new Error('Owned artifact must not contain an active repository path.');
    return resolveChangeArtifact(base, target);
  }
  if (target.kind === 'evidence' || target.path?.startsWith('openspec/changes/')) throw new Error('Change artifact requires an owner-relative locator.');
  return resolveRepositoryFile(base, target.path);
}
