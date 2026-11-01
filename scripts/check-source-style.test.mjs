import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
