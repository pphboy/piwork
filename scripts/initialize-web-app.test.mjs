import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { initialize } from '../internal/coreassets/piwork-brain/skills/deploy-work-service/initialize.mjs';
const command = promisify(execFile);
const moduleURL = new URL('../internal/coreassets/piwork-brain/skills/deploy-work-service/initialize.mjs', import.meta.url).href;

test('standard initialization preserves editable files and rejects repeats before any write', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'piwork-initialize-'));
  try {
    for (const template of ['web-app', 'workstation']) {
      assert.equal(initialize({ workspace, name: template, template }).initialized, true);
      const app = join(workspace, 'apps', template);
      const original = new URL(`../internal/coreassets/piwork-brain/templates/${template}/prepare.sh`, import.meta.url);
      assert.equal(statSync(join(app, 'prepare.sh')).mode & 0o111, statSync(original).mode & 0o111);
      assert(statSync(join(app, 'prepare.sh')).mode & 0o200);
      mkdirSync(join(workspace, 'data', template), { recursive: true });
      const paths = ['SPEC.md', 'app.py', 'frontend/package-lock.json'].map(name => join(app, name));
      paths.push(join(workspace, 'data', template, 'business.txt'), join(workspace, '.pi/services', template + '.json'));
      for (const path of paths) writeFileSync(path, 'user content: ' + path);
      assert.throws(() => initialize({ workspace, name: template, template }), { code: 'EEXIST' });
      for (const path of paths) assert.equal(readFileSync(path, 'utf8'), 'user content: ' + path);
    }
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test('empty directories, files and links cannot be adopted as new applications', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'piwork-initialize-'));
  try {
    mkdirSync(join(workspace, 'apps'));
    mkdirSync(join(workspace, 'apps/empty'));
    writeFileSync(join(workspace, 'apps/file'), 'original');
    symlinkSync(join(workspace, 'missing'), join(workspace, 'apps/link'));
    for (const name of ['empty', 'file', 'link']) assert.throws(() => initialize({ workspace, name }), { code: 'EEXIST' });
    assert.equal(readFileSync(join(workspace, 'apps/file'), 'utf8'), 'original');
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test('concurrent initializers have exactly one writer', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'piwork-initialize-'));
  try {
    const script = `import {initialize} from ${JSON.stringify(moduleURL)}; initialize(${JSON.stringify({ workspace, name: 'concurrent' })});`;
    const results = await Promise.allSettled([command(process.execPath, ['--input-type=module', '-e', script]), command(process.execPath, ['--input-type=module', '-e', script])]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    assert.equal(JSON.parse(readFileSync(join(workspace, '.pi/services/concurrent.json'))).serviceName, 'concurrent');
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});
