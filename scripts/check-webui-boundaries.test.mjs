import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { checkWebuiBoundaries, importSpecifiers } from './check-webui-boundaries.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'piwork-webui-boundary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, source) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  };
  return { root, write };
}

test('lexer reads static, type-only, re-export and literal dynamic imports without matching comments or strings', () => {
  assert.deepEqual(importSpecifiers(`
    // import './not-code.js';
    const text = "import './also-not-code.js'";
    import type { Model } from './model.js';
    export { value } from './value.js';
    await import('./dynamic.js');
    const c = require('./common.js');
  `), ['./model.js', './value.js', './dynamic.js', './common.js']);
});

test('legal composition and copied-flat shared sources pass; reverse and cross-application edges fail', t => {
  const { root, write } = fixture(t);
  write('apps/desktop-webui/src/app.ts', "import './feature.js';");
  write('apps/desktop-webui/src/feature.ts', "import './notices.js';");
  write('apps/ui-shared/notices.js', 'export const policy = {};');
  assert.deepEqual(checkWebuiBoundaries(root), []);
  write('apps/ui-shared/notices.js', "export { model } from '../desktop-webui/src/feature.js';");
  assert(checkWebuiBoundaries(root).some(error => error.startsWith('Shared-to-feature')));
  write('apps/ui-shared/notices.js', '');
  write('apps/desktop-webui/src/feature.ts', "await import('./app.js');");
  assert(checkWebuiBoundaries(root).some(error => error.startsWith('Feature-to-entry')));
  write('apps/console-webui/src/model.ts', 'export const model = {};');
  write('apps/desktop-webui/src/feature.ts', "import '../../console-webui/src/model.js';");
  assert(checkWebuiBoundaries(root).some(error => error.startsWith('Cross-application')));
});

test('multi-hop dependency cycles fail with the actual edge path', t => {
  const { root, write } = fixture(t);
  for (const [from, to] of [['a', 'b'], ['b', 'c'], ['c', 'a']]) {
    write(`apps/desktop-webui/src/${from}.ts`, `export * from './${to}.js';`);
  }
  const errors = checkWebuiBoundaries(root);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /a\.ts -> .*b\.ts -> .*c\.ts -> .*a\.ts/);
});

test('multiline clauses and side effects keep real dependencies; flat shared copies participate in cycles', t => {
  assert.deepEqual(importSpecifiers(`
    import './side-effect.js';
    import type {
      Model,
    } from './model.js';
    export {
      value,
    } from './value.js';
    const pattern = /import 'fake.js'/;
    const text = \`import './template-text.js'\`;
  `), ['./side-effect.js', './model.js', './value.js']);
  const { root, write } = fixture(t);
  write('apps/desktop-webui/src/feature.ts', "import './notices.js';");
  write('apps/ui-shared/notices.js', "import '../desktop-webui/src/feature.js';");
  const errors = checkWebuiBoundaries(root);
  assert(errors.some(error => error.startsWith('Dependency cycle:') && error.includes('apps/ui-shared/notices.js')));
  assert(errors.some(error => error.startsWith('Shared-to-feature')));
});

test('flat startup presentation keeps shared dependency and cycle checks effective', t => {
  const { root, write } = fixture(t);
  write('apps/console-webui/src/consumer.ts', "import './startup-shell.js';");
  write('apps/ui-shared/startup-shell.js', 'export const startupShell = () => "";');
  assert.deepEqual(checkWebuiBoundaries(root), []);
  write('apps/ui-shared/startup-shell.js', "import '../console-webui/src/consumer.js';");
  const errors = checkWebuiBoundaries(root);
  assert(errors.some(error => error.startsWith('Shared-to-feature')));
  assert(errors.some(error => error.startsWith('Dependency cycle:')));
});

test('template expressions expose literal dependencies but template data and nonliteral targets do not', () => {
  const source = 'const view = `import("./data.js") ${await import("./app.js")} ${require("./module.js")}`;';
  assert.deepEqual(importSpecifiers(source), ['./app.js', './module.js']);
  assert.deepEqual(importSpecifiers('await import(`./literal.js`); await import(`./${name}.js`); await import(`${"./computed.js"}`);'), ['./literal.js']);
});

test('nested template expressions retain braces, strings, comments and regular-expression boundaries', () => {
  const source = [
    'const view = `outer ${({ value: `inner ${import("./nested.js")}`,',
    ' pattern: /[{}]/, text: "}", /* } import("./comment.js") */',
    ' another: /import("fake")}/ }).value} tail ${require("./last.js")}`;',
    'const escaped = `\\${import("./escaped-data.js")}`;',
    'const comment = `${ // } import("./line-comment.js")',
    ' import("./after-comment.js") }`;',
  ].join('\n');
  assert.deepEqual(importSpecifiers(source), ['./nested.js', './last.js', './after-comment.js']);
});

test('template interpolation reverse dependencies and cycles fail at their actual edges', t => {
  const { root, write } = fixture(t);
  write('apps/desktop-webui/src/app.ts', 'export const app = {};');
  write('apps/desktop-webui/src/feature.ts', 'const view = `${({ nested: `${await import("./app.js")}` }).nested}`;');
  assert(checkWebuiBoundaries(root).some(error => error.startsWith('Feature-to-entry')));
  write('apps/desktop-webui/src/feature.ts', 'const view = `${import("./other.js")}`;');
  write('apps/desktop-webui/src/other.ts', 'const view = `${require("./feature.js")}`;');
  assert(checkWebuiBoundaries(root).some(error => error.startsWith('Dependency cycle:') && error.includes('feature.ts') && error.includes('other.ts')));
});


test('control-condition regexp statements do not close template expressions or hide imports', t => {
  const source = 'const x = `${(() => { if (ok) /}}/.test(text); return import("./app.js"); })()}`;';
  assert.deepEqual(importSpecifiers(source), ['./app.js']);
  const { root, write } = fixture(t);
  write('apps/desktop-webui/src/app.ts', 'export const app = {};');
  write('apps/desktop-webui/src/feature.ts', source);
  assert(checkWebuiBoundaries(root).some(error => error.startsWith('Feature-to-entry')));
  const guarded = 'const x = `${(() => { while ((ok)) /}}import("fake")/.test(text); return import("./real.js"); })()}`;';
  assert.deepEqual(importSpecifiers(guarded), ['./real.js']);
});

test('division after calls or grouped values does not become a control-statement regexp', () => {
  const source = 'const x = `${call() / 2 + (value) / scale + obj.if(ok) / 2} ${import("./real.js")}`;';
  assert.deepEqual(importSpecifiers(source), ['./real.js']);
  const regexpDivisor = 'const x = `${value / /}}/.test(text)} ${import("./next.js")}`;';
  assert.deepEqual(importSpecifiers(regexpDivisor), ['./next.js']);
});

test('division after a regexp value cannot swallow following executable imports', () => {
  assert.deepEqual(importSpecifiers('const n = /foo/ / 2; import("./app.js");'), ['./app.js']);
  assert.deepEqual(importSpecifiers('const value = `${(() => { const n = /}}/ / 2; return import("./nested.js"); })()}`;'), ['./nested.js']);
  assert.deepEqual(importSpecifiers('const n = amount / /foo/.test(text); import("./after-divisor.js");'), ['./after-divisor.js']);
  assert.deepEqual(importSpecifiers('const n = /import("fake")/ / 2; require("./actual.js");'), ['./actual.js']);
});
