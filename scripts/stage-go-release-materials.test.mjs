import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { stageReleaseMaterials, releaseMaterials } from './stage-go-release-materials.mjs';

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'piwork-materials-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const write = (name, text) => { mkdirSync(dirname(join(base, name)), { recursive: true }); writeFileSync(join(base, name), text); };
  const git = args => execFileSync('git', ['-C', base, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  for (const name of releaseMaterials) write(name, 'synthetic ' + name);
  write('deploy/fixture/spec.md', '# Rule\nOriginal contract.\n');
  write('deploy/docker/README.md', '[中文](README.zh-CN.md)\n[spec](<../fixture/spec.md?view=1#rule> "Rule")\n<img src="../../apps/ui-shared/assets/piwork-logo.png">\n```sh\n[example](missing-command-argument)\n```\n[external](https://example.invalid/guide)\n');
  git(['init', '--quiet']); git(['add', '.']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'synthetic materials']);
  const commit = git(['rev-parse', 'HEAD']).toString().trim();
  const output = join(base, 'staging');
  return { base, write, git, commit, output, stage: () => stageReleaseMaterials({ base, output, commit }) };
}
test('clean deep links pin an existing byte-identical Git object and explicit materials remain local', t => {
  const { base, commit, output, stage, git } = fixture(t);
  stage();
  const readme = readFileSync(join(output, 'deploy/docker/README.md'), 'utf8');
  assert.ok(readme.includes('[中文](README.zh-CN.md)'));
  assert.ok(readme.includes(`blob/${commit}/deploy/fixture/spec.md?view=1#rule`));
  assert.deepEqual(git(['cat-file', 'blob', `${commit}:deploy/fixture/spec.md`]), readFileSync(join(base, 'deploy/fixture/spec.md')));
  assert.ok(readme.includes('src="../../apps/ui-shared/assets/piwork-logo.png"'));
  assert.ok(readme.includes('[example](missing-command-argument)'));
  assert.ok(readme.includes('[external](https://example.invalid/guide)'));
  assert.equal(existsSync(join(output, 'deploy/fixture/spec.md')), false);
  for (const name of releaseMaterials.filter(name => !name.endsWith('.md'))) assert.deepEqual(readFileSync(join(output, name)), readFileSync(join(base, name)));
  assert.equal(existsSync(join(output, 'docs')), false);
  assert.equal(existsSync(join(output, 'openspec/changes/go-core-cli-migration/evidence/legacy-docs/go-migration-scenarios.json')), false);
  assert.throws(() => stageReleaseMaterials({ base, output, commit: 'HEAD' }), /actual source commit/);
  assert.throws(() => stageReleaseMaterials({ base, output, commit: 'a'.repeat(40) }), /existing source commit/);
});
test('new uncommitted documents retain relative document and image closure including cycles', t => {
  const { base, write, commit, output, stage, git } = fixture(t);
  write('deploy/docker/README.md', '[new](../new/spec.md#new)');
  write('deploy/new/spec.md', '# New\n[clean](../fixture/spec.md#rule)\n[child](child.md)\n<img src="image%20one.png?raw=1">\n');
  write('deploy/new/child.md', '[back](spec.md#new)');
  write('deploy/new/image one.png', 'synthetic PNG');
  assert.throws(() => git(['cat-file', '-e', `${commit}:deploy/new/spec.md`]));
  const files = stage();
  assert.equal(readFileSync(join(output, 'deploy/docker/README.md'), 'utf8'), '[new](../new/spec.md#new)');
  for (const name of ['deploy/new/spec.md', 'deploy/new/child.md', 'deploy/new/image one.png', 'deploy/fixture/spec.md']) {
    assert.deepEqual(readFileSync(join(output, name)), readFileSync(join(base, name)));
    assert.equal(files.filter(item => item === name).length, 1);
  }
});
test('modified committed documents bundle the selected bytes instead of linking stale Git content', t => {
  const { base, write, output, commit, git, stage } = fixture(t);
  write('deploy/fixture/spec.md', '# Rule\nModified contract.\n');
  stage();
  assert.notDeepEqual(git(['cat-file', 'blob', `${commit}:deploy/fixture/spec.md`]), readFileSync(join(base, 'deploy/fixture/spec.md')));
  assert.deepEqual(readFileSync(join(output, 'deploy/fixture/spec.md')), readFileSync(join(base, 'deploy/fixture/spec.md')));
  assert.ok(readFileSync(join(output, 'deploy/docker/README.md'), 'utf8').includes('](<../fixture/spec.md?view=1#rule> "Rule")'));
});
test('missing, unsafe or escaping local targets fail before writing package materials', t => {
  const { base, write, stage, output } = fixture(t);
  write('deploy/docker/README.md', '[missing](../missing/spec.md)');
  assert.throws(stage, /Missing repository file/);
  assert.equal(existsSync(output), false);
  write('deploy/docker/README.md', '[secret](.env)'); write('.env', 'synthetic secret');
  assert.throws(stage, /outside allowed materials/);
  write('deploy/docker/README.md', '[escape](../../../outside.md)');
  assert.throws(stage, /outside allowed materials/);
  write('deploy/docker/README.md', '[escape](../escape.md)');
  symlinkSync(tmpdir(), join(base, 'deploy/escape.md'));
  assert.throws(stage, /symlink escapes root/);
});
