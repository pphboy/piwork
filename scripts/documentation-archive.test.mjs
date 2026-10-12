import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, copyFileSync, mkdtempSync, mkdirSync, renameSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { checkRepositoryDocs } from './check-repository-docs.mjs';
import { stageReleaseMaterials } from './stage-go-release-materials.mjs';
import { updateAcceptanceIndex, acceptanceInputPaths } from './update-go-acceptance-index.mjs';
import { resolveChangeArtifact } from './resolve-change-artifact.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
test('navigation, inventory, frozen input and staging survive physical removal of active change directories', async t => {
  const base = mkdtempSync(join(tmpdir(), 'piwork-docs-archive-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  for (const directory of ['openspec', 'deploy', 'examples', 'apps/ui-shared/assets']) cpSync(join(root, directory), join(base, directory), { recursive: true });
  for (const file of ['README.md', 'README.zh-CN.md', 'AGENTS.md', 'LICENSE']) copyFileSync(join(root, file), join(base, file));
  // The test also runs in an already archived checkout. Normalize only its copy.
  for (const [ownerChange, artifactPath] of [['remove-docs-dir', 'evidence/migration-map.json'], ['go-core-cli-migration', 'verification-matrix.md']]) {
    const artifact = resolveChangeArtifact(base, { ownerChange, artifactPath });
    const directory = ownerChange === 'remove-docs-dir' ? dirname(dirname(artifact)) : dirname(artifact);
    const active = join(base, 'openspec/changes', ownerChange);
    if (directory !== active) renameSync(directory, active);
  }
  mkdirSync(join(base, 'scripts'));
  for (const file of ['check-go-acceptance.mjs', 'update-go-acceptance-index.mjs', 'resolve-change-artifact.mjs']) copyFileSync(join(root, 'scripts', file), join(base, 'scripts', file));
  const git = args => execFileSync('git', ['-C', base, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '--quiet']);
  git(['add', 'README.md', 'README.zh-CN.md', 'LICENSE', 'AGENTS.md', 'deploy', 'examples', 'apps', 'openspec/specs']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'synthetic documentation snapshot']);
  const commit = git(['rev-parse', 'HEAD']).toString().trim();
  const original = readFileSync(join(base, 'openspec/changes/remove-docs-dir/evidence/migration-map.json'));
  const preview = readFileSync(join(base, 'apps/ui-shared/assets/desktop-preview.png'));
  const frozen = readFileSync(acceptanceInputPaths(base).frozen);
  checkRepositoryDocs(base);
  await updateAcceptanceIndex(base);
  const firstOutput = join(base, 'staging-active');
  const materials = stageReleaseMaterials({ base, output: firstOutput, commit });
  mkdirSync(join(base, 'openspec/changes/archive'), { recursive: true });
  for (const owner of ['remove-docs-dir', 'go-core-cli-migration']) {
    renameSync(join(base, 'openspec/changes', owner), join(base, 'openspec/changes/archive', `2026-10-12-${owner}`));
    assert.equal(existsSync(join(base, 'openspec/changes', owner)), false);
  }
  checkRepositoryDocs(base);
  rmSync(join(base, 'dist/verification/go-migration-scenarios.json'));
  assert.match(execFileSync(process.execPath, ['scripts/check-go-acceptance.mjs'], { cwd: base, encoding: 'utf8' }), /970 acceptance scenarios/);
  await updateAcceptanceIndex(base);
  const secondOutput = join(base, 'staging-archive');
  assert.deepEqual(stageReleaseMaterials({ base, output: secondOutput, commit }), materials);
  for (const name of materials) assert.deepEqual(readFileSync(join(secondOutput, name)), readFileSync(join(firstOutput, name)));
  assert.deepEqual(readFileSync(acceptanceInputPaths(base).frozen), frozen);
  assert.deepEqual(readFileSync(join(base, 'openspec/changes/archive/2026-10-12-remove-docs-dir/evidence/migration-map.json')), original);
  assert.deepEqual(readFileSync(join(base, 'apps/ui-shared/assets/desktop-preview.png')), preview);
  assert.equal(existsSync(join(base, 'docs')), false);
});
