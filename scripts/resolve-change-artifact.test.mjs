import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { resolveChangeArtifact, resolveMigrationTarget } from './resolve-change-artifact.mjs';

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'piwork-owner-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const write = (path, body = 'frozen') => { mkdirSync(dirname(join(base, path)), { recursive: true }); writeFileSync(join(base, path), body); };
  return { base, write };
}
test('owner identity survives physical archival and explicit recorded archives stay exact', t => {
  const { base, write } = fixture(t), owner = { ownerChange: 'fixture', artifactPath: 'evidence/input.json' };
  write('openspec/changes/fixture/evidence/input.json');
  assert.equal(resolveChangeArtifact(base, owner), join(base, 'openspec/changes/fixture/evidence/input.json'));
  mkdirSync(join(base, 'openspec/changes/archive'));
  renameSync(join(base, 'openspec/changes/fixture'), join(base, 'openspec/changes/archive/2026-10-12-fixture'));
  const archived = resolveChangeArtifact(base, owner);
  assert.equal(archived, join(base, 'openspec/changes/archive/2026-10-12-fixture/evidence/input.json'));
  write('openspec/changes/archive/2026-10-13-fixture/evidence/input.json', 'another version');
  assert.throws(() => resolveChangeArtifact(base, owner), /Ambiguous owner/);
  assert.equal(resolveChangeArtifact(base, { ...owner, archivePath: 'archive/2026-10-12-fixture' }), archived);
});
test('invalid owners, missing objects, traversal and escaping symlinks fail', t => {
  const { base, write } = fixture(t);
  write('openspec/changes/fixture/evidence/input.json'); write('outside.json');
  const owner = { ownerChange: 'fixture', artifactPath: 'evidence/input.json' };
  assert.throws(() => resolveChangeArtifact(base, { ...owner, ownerChange: '../fixture' }), /Invalid owner/);
  assert.throws(() => resolveChangeArtifact(base, { ...owner, ownerChange: 'missing' }), /Missing owner/);
  assert.throws(() => resolveChangeArtifact(base, { ...owner, artifactPath: 'evidence/missing.json' }), /Missing repository file/);
  for (const artifactPath of ['../outside.json', '/outside.json', 'evidence/../../outside.json', 'evidence\\input.json']) {
    assert.throws(() => resolveChangeArtifact(base, { ...owner, artifactPath }), /escapes change/);
  }
  symlinkSync(join(base, 'outside.json'), join(base, 'openspec/changes/fixture/evidence/escape.json'));
  assert.throws(() => resolveChangeArtifact(base, { ...owner, artifactPath: 'evidence/escape.json' }), /symlink escapes change/);
  assert.throws(() => resolveChangeArtifact(base, { ...owner, archivePath: 'archive/2026-10-12-other' }), /Invalid archive/);
  assert.throws(() => resolveMigrationTarget(base, { kind: 'evidence', path: 'openspec/changes/fixture/evidence/input.json' }), /requires an owner/);
  assert.throws(() => resolveMigrationTarget(base, { ...owner, path: 'outside.json' }), /must not contain/);
});
