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
