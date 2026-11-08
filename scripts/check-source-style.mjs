// Incremental style checks: do not reformat unrelated historical source.
import { scanSourceTokens } from './check-ui-language.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Exact upstream bytes are checked by the image vendor SHA256 manifest.
export function upstreamStyleAsset(file) {
  return new Set([
    'deploy/images/fastapi-htmx-base/vendor/htmx.min.js',
    'deploy/images/fastapi-htmx-base/vendor/bootstrap.min.css',
  ]).has(file);
}

export function sourceStyleIssues(source, file) {
  const issues = [];
  const lines = source.split('\n');
  for (const [index, line] of lines.entries()) {
    if (/\s$/.test(line)) issues.push({ line: index + 1, rule: 'trailing-whitespace', text: line });
    if (/^ *\t/.test(line)) issues.push({ line: index + 1, rule: 'space-indentation', text: line });
  }
  if (source && !source.endsWith('\n')) issues.push({ line: lines.length, rule: 'final-newline', text: lines.at(-1) });
  if (file.endsWith('.css')) {
    // CSS declaration delimiters outside strings/comments/functions only.
    let quote = '', comment = false, depth = 0, parentheses = 0, line = 1;
    let lastDeclarationLine = -1;
    for (let index = 0; index < source.length; index++) {
      const char = source[index], next = source[index + 1];
      if (char === '\n') line++;
      if (comment) {
        if (char === '*' && next === '/') {
          comment = false;
          index++;
        }
        continue;
      }
      if (quote) {
        if (char === '\\') index++;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '/' && next === '*') {
        comment = true;
        index++;
        continue;
      }
      if (char === '\"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === '(') parentheses++;
      if (char === ')') parentheses--;
      if (parentheses) continue;
      if (char === '{') {
        depth++;
        lastDeclarationLine = -1;
      }
      if (char === '}') {
        depth--;
        lastDeclarationLine = -1;
      }
      if (char === ';' && depth > 0) {
        if (lastDeclarationLine === line) issues.push({ line, rule: 'one-declaration-per-line', text: lines[line - 1] });
        lastDeclarationLine = line;
      }
    }
  }
  if (/\.(?:ts|js|mjs)$/.test(file)) {
    const tokens = scanSourceTokens(source);
    const blocks = [0];
    let parentheses = 0;
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (token.kind !== 'symbol') continue;
      if (token.value === '(') parentheses++;
      if (token.value === ')') parentheses--;
      if (token.value === '{') blocks.push(parentheses);
      if (token.value === '}') blocks.pop();
      const next = tokens[index + 1];
      const typeMember = tokens[index + 2]?.value === ':' ||
        tokens[index + 2]?.value === '?' && tokens[index + 3]?.value === ':' ||
        next?.value === 'readonly' && tokens[index + 3]?.value === ':';
      if (!typeMember && token.value === ';' && parentheses === blocks.at(-1) && next && next.line === token.line && next.value !== '}') {
        issues.push({ line: token.line, rule: 'one-statement-per-line', text: lines[token.line - 1] });
      }
    }
  }

  return issues.filter((issue, index) => issues.findIndex(other => other.line === issue.line && other.rule === issue.rule) === index);
}

export function newStyleIssues(source, baseline, file) {
  const existing = new Set(sourceStyleIssues(baseline, file).map(issue => `${issue.rule}\0${issue.text}`));
  return sourceStyleIssues(source, file).filter(issue => !existing.has(`${issue.rule}\0${issue.text}`));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, '..');
  function git(args) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args[0]} failed`);
    return result.stdout;
  }
  const explicit = [];
  let base = 'HEAD';
  let suppliedBase = false;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--') {
      explicit.push(...args.slice(index + 1));
      break;
    }
    if (argument === '--base') {
      if (suppliedBase || !args[index + 1] || args[index + 1].startsWith('--')) {
        console.error('Usage: check-source-style.mjs [--base <commit-ref>] [--] [files...]');
        process.exit(1);
      }
      suppliedBase = true;
      base = args[++index];
    } else if (argument.startsWith('--')) {
      console.error(`Unknown option: ${argument}`);
      process.exit(1);
    } else explicit.push(argument);
  }
  if (suppliedBase) {
    const revision = spawnSync('git', ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], { cwd: root, encoding: 'utf8' });
    if (revision.status !== 0) {
      console.error(`Style baseline is not an available commit: ${base}`);
      process.exit(1);
    }
    base = revision.stdout.trim();
  }
  const paths = explicit.length ? explicit : [...new Set([
    ...git(['diff', '--name-only', base, '-z', '--']).split('\0'),
    ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
  ])];
  let failed = false;
  let checked = 0;
  for (const file of paths) {
    if (upstreamStyleAsset(file)) continue;
    if (!/\.(?:go|ts|js|mjs|css)$/.test(file) || !existsSync(resolve(root, file))) continue;
    if (/^(?:internal\/(?:desktopassets|consoleassets)\/static|openspec\/changes\/.*\/prototype)\//.test(file) || /(?:_generated\.go$|\/generated\/|\.d\.ts$)/.test(file)) continue;
    checked++;
    if (file.endsWith('.go')) {
      const result = spawnSync('gofmt', ['-l', file], { cwd: root, encoding: 'utf8' });
      if (result.error) {
        console.error(`${file}: gofmt unavailable (${result.error.code ?? 'spawn failure'}); provide the approved Go 1.25.5 toolchain on PATH, then rerun this check. No Go formatting result was obtained.`);
        failed = true;
        continue;
      }
      if (result.status !== 0 || result.stdout.trim()) {
        console.error(`${file}: gofmt required`);
        failed = true;
      }
      continue;
    }
    const baseline = spawnSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8' });
    const issues = newStyleIssues(readFileSync(resolve(root, file), 'utf8'), baseline.status === 0 ? baseline.stdout : '', file);
    for (const issue of issues) console.error(`${file}:${issue.line}: ${issue.rule}`);
    failed ||= issues.length > 0;
  }
  if (failed) process.exitCode = 1;
  else console.log(`Incremental source style checked (${checked} files); unchanged legacy formatting is not rewritten.`);
}
