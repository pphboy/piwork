// Lexical dependency graph checks for production WebUI sources, not rendered HTML.
import { scanSourceTokens } from './check-ui-language.mjs';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const roots = ['apps/ui-shared', 'apps/desktop-webui/src', 'apps/console-webui/src'];
const flatShared = new Set(['i18n.js', 'boot.js', 'read-deadline.js', 'browser-crypto.js', 'notices.js', 'feedback-primitives.js']);
const entry = /^apps\/(?:desktop|console)-webui\/src\/(?:app|main|setup)\.ts$/;

export function importSpecifiers(source) {
  const tokens = scanSourceTokens(source);
  const imports = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind !== 'string') continue;
    const previous = tokens[index - 1]?.value;
    const caller = tokens[index - 2]?.value;
    if (previous === 'import' || previous === '(' && ['import', 'require'].includes(caller)) {
      imports.push(token.value);
      continue;
    }
    if (previous !== 'from') continue;
    // from is a module clause only within an import/export statement.
    for (let cursor = index - 2; cursor >= 0; cursor--) {
      const value = tokens[cursor].value;
      if (value === ';') break;
      if (value === 'import' || value === 'export') {
        imports.push(token.value);
        break;
      }
    }
  }
  return imports;
}

export function checkWebuiBoundaries(root) {
  const files = new Map();
  function walk(directory) {
    if (!existsSync(join(root, directory))) return;
    for (const item of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${item.name}`;
      if (item.isDirectory()) walk(path);
      else if (/\.(?:ts|js|mjs)$/.test(path) && !/\.d\.ts$|\.test\.(?:ts|js|mjs)$/.test(path)) files.set(path, readFileSync(join(root, path), 'utf8'));
    }
  }
  roots.forEach(walk);
  const errors = [];
  const graph = new Map();
  function targetFor(from, specifier) {
    if (!specifier.startsWith('.')) return undefined;
    const path = relative(root, resolve(root, dirname(from), specifier)).replaceAll('\\', '/');
    const candidates = [path, path.replace(/\.js$/, '.ts'), `${path}.ts`, `${path}.js`, `${path}/index.ts`];
    const target = candidates.find(candidate => files.has(candidate));
    if (target) return target;
    // Browser compilation keeps shared modules flat; their only source lives in ui-shared.
    const name = specifier.replace(/^\.\//, '');
    if (flatShared.has(name) && files.has(`apps/ui-shared/${name}`)) return `apps/ui-shared/${name}`;
    return undefined;
  }
  for (const [file, source] of files) {
    const dependencies = [];
    for (const specifier of importSpecifiers(source, file)) {
      const target = targetFor(file, specifier);
      if (!target) continue; // External/library imports are checked by typecheck/native-boundary.
      dependencies.push(target);
      if (file.startsWith('apps/ui-shared/') && !target.startsWith('apps/ui-shared/')) errors.push(`Shared-to-feature dependency: ${file} -> ${target}`);
      if (!entry.test(file) && entry.test(target)) errors.push(`Feature-to-entry dependency: ${file} -> ${target}`);
      const app = /^apps\/(desktop|console)-webui\//.exec(file)?.[1];
      const other = /^apps\/(desktop|console)-webui\//.exec(target)?.[1];
      if (app && other && app !== other) errors.push(`Cross-application dependency: ${file} -> ${target}`);
    }
    graph.set(file, dependencies);
  }
  const active = new Set();
  const visited = new Set();
  function visit(file, path) {
    if (active.has(file)) {
      errors.push(`Dependency cycle: ${[...path.slice(path.indexOf(file)), file].join(' -> ')}`);
      return;
    }
    if (visited.has(file)) return;
    active.add(file);
    for (const target of graph.get(file) ?? []) visit(target, [...path, file]);
    active.delete(file);
    visited.add(file);
  }
  for (const file of files.keys()) visit(file, []);
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkWebuiBoundaries(resolve(import.meta.dirname, '..'));
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else console.log('WebUI dependency direction and cycles checked; state ownership still requires type and code review.');
}
