import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { sourceStyleIssues, newStyleIssues } from './check-source-style.mjs';

test('new TS/JS must not compress independent statements into one line', () => {
  const valid = 'function run() {\n  read();\n  write();\n}\n';
  assert.deepEqual(sourceStyleIssues(valid, 'feature.ts'), []);
  assert(sourceStyleIssues('function run() { read(); write(); }\n', 'feature.ts').some(issue => issue.rule === 'one-statement-per-line'));
  assert.deepEqual(sourceStyleIssues('const html = `<p>; this is content; not code</p>`;\n', 'view.ts'), []);
});

test('CSS whitespace and final newline checks have failing synthetic examples', () => {
  assert.deepEqual(sourceStyleIssues('.notice {\n  display: flex;\n}\n', 'controls.css'), []);
  const rules = sourceStyleIssues('.notice {\n\tdisplay: flex; \n}', 'controls.css').map(issue => issue.rule);
  assert(rules.includes('space-indentation'));
  assert(rules.includes('trailing-whitespace'));
  assert(rules.includes('final-newline'));
});

test('incremental checking preserves old formatting but rejects newly compressed logic', () => {
  const baseline = 'function old() { read(); write(); }\n';
  assert.deepEqual(newStyleIssues(baseline + 'const value = 1;\n', baseline, 'feature.ts'), []);
  assert(newStyleIssues(baseline + 'function added() { open(); close(); }\n', baseline, 'feature.ts').some(issue => issue.rule === 'one-statement-per-line'));
});

test('CSS declaration lines distinguish delimiters from URL or quoted content', () => {
  assert(sourceStyleIssues('.notice { display: flex; color: red; }\n', 'controls.css').some(issue => issue.rule === 'one-declaration-per-line'));
  assert.deepEqual(sourceStyleIssues('.notice {\n  content: "; fake;";\n  background: url("data:image/svg+xml;a;b");\n}\n', 'controls.css'), []);
});


test('unavailable gofmt fails with the required action, not a stack trace or a pass', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./check-source-style.mjs', import.meta.url)), 'internal/app/run_test.go'], {
    env: { ...process.env, PATH: '' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /gofmt unavailable.*provide the approved Go 1\.25\.5/);
  assert.match(result.stderr, /No Go formatting result was obtained/);
  assert.doesNotMatch(result.stderr, /at ModuleJob|at async|throw result/);
  assert.doesNotMatch(result.stdout, /style checked/);
});


test('explicit commit baseline checks committed PR changes in a clean checkout', t => {
  const root = mkdtempSync(join(tmpdir(), 'piwork-style-base-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  for (const name of ['check-source-style.mjs', 'check-ui-language.mjs']) {
    copyFileSync(new URL(name, import.meta.url), join(root, 'scripts', name));
  }
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet']);
  git(['config', 'user.name', 'Synthetic Fixture']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  const legacy = 'function legacy() { read(); write(); }\n';
  writeFileSync(join(root, 'feature.ts'), legacy);
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'synthetic baseline']);
  const base = git(['rev-parse', 'HEAD']);
  writeFileSync(join(root, 'feature.ts'), legacy + 'function added() { open(); close(); }\n');
  writeFileSync(join(root, 'new.ts'), 'const added = true;   \n');
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'synthetic bad committed change']);
  assert.equal(git(['status', '--porcelain']), '');
  const run = args => spawnSync(process.execPath, [join(root, 'scripts/check-source-style.mjs'), ...args], { cwd: root, encoding: 'utf8' });
  const dirtyDefault = run([]);
  assert.equal(dirtyDefault.status, 0);
  assert.match(dirtyDefault.stdout, /checked \(0 files\)/);
  const checked = run(['--base', base]);
  assert.equal(checked.status, 1);
  assert.match(checked.stderr, /feature.ts:2: one-statement-per-line/);
  assert.match(checked.stderr, /new.ts:1: trailing-whitespace/);
  assert.doesNotMatch(checked.stderr, /feature.ts:1:/);
  const explicit = run(['--base', base, 'feature.ts']);
  assert.equal(explicit.status, 1);
  assert.match(explicit.stderr, /feature.ts:2: one-statement-per-line/);
  assert.doesNotMatch(explicit.stderr, /new.ts/);
  const invalid = run(['--base', 'nonexistent-synthetic-ref']);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /baseline is not an available commit/);
  assert.equal(run(['--base']).status, 1);
  assert.equal(run(['--unknown']).status, 1);
  writeFileSync(join(root, 'feature.ts'), legacy + 'function added() {\n  open();\n  close();\n}\n');
  writeFileSync(join(root, 'new.ts'), 'const added = true;\n');
  assert.equal(run(['--base', base]).status, 0);
});
