import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { checkRepositoryDocs } from './check-repository-docs.mjs';
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'piwork-docs-')); t.after(() => rmSync(base, { recursive: true, force: true }));
  const write = (name, contents) => { const path = join(base, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, contents); };
  const manifest = data => write('openspec/changes/fixture/evidence/migration-map.json', JSON.stringify({ version: 2, sourceFileCount: data.length, files: data }));
  manifest([]); return { base, write, manifest };
}
test('root docs fails even when it is untracked or ignored', t => {
  const { base, write } = fixture(t); write('.gitignore', 'docs/\n'); write('docs/note.md', 'note');
  assert.throws(() => checkRepositoryDocs(base), /root docs/);
});
test('current links and generator targets are checked, historical examples and user directories remain valid', t => {
  const { base, write } = fixture(t);
  write('internal/brain/SPEC.md', 'product contract'); write('fixtures/work/docs/note.md', 'user content');
  write('openspec/changes/archive/fixture/evidence/history.md', '[original](docs/old.md)');
  write('README.md', 'History mentioned `docs/old.md`.\n```sh\n[example](docs/old.md)\n```\n[product](internal/brain/SPEC.md)\n[website](https://example.invalid/docs/guide)\n');
  checkRepositoryDocs(base);
  write('README.md', '[missing section](internal/brain/SPEC.md#missing)');
  assert.throws(() => checkRepositoryDocs(base), /Missing current documentation anchor/);
  write('README.md', '[broken](docs/old.md)'); assert.throws(() => checkRepositoryDocs(base), /Missing current/);
  write('README.md', '[product](internal/brain/SPEC.md)');
  write('scripts/collect-go-migration-boundary.mjs', "await writeFile('docs/output.json', '{}');");
  assert.throws(() => checkRepositoryDocs(base), /Generator/);
});
test('migration requires present targets, unchanged frozen bytes and a real requirement', t => {
  const { base, write, manifest } = fixture(t); const digest = createHash('sha256').update('frozen').digest('hex');
  const entry = { source: 'docs/input.json', sourceSha256: digest, status: 'mapped', targets: [{ kind: 'evidence', ownerChange: 'fixture', artifactPath: 'evidence/input.json', sha256: digest }] };
  manifest([entry]); assert.throws(() => checkRepositoryDocs(base), /Missing repository file/);
  write('openspec/changes/fixture/evidence/input.json', 'frozen'); checkRepositoryDocs(base);
  write('openspec/changes/fixture/evidence/input.json', 'modified'); assert.throws(() => checkRepositoryDocs(base), /Changed migration target/);
  entry.source = 'docs/guide.md'; entry.targets = [{ kind: 'spec', path: 'openspec/specs/fixture/spec.md', requirement: 'FIXTURE-001' }];
  write(entry.targets[0].path, 'no requirement'); manifest([entry]); assert.throws(() => checkRepositoryDocs(base), /Missing mapped requirement/);
  write(entry.targets[0].path, '**Identifier:** FIXTURE-001\n'); checkRepositoryDocs(base);
  manifest([entry, entry]); assert.throws(() => checkRepositoryDocs(base), /Duplicate migration/);
});
test('the same manifest remains read-only and valid after its owner is archived', t => {
  const { base, write, manifest } = fixture(t);
  const digest = createHash('sha256').update('frozen').digest('hex');
  write('openspec/changes/fixture/evidence/input.json', 'frozen');
  write('openspec/changes/fixture/specs/fixture/spec.md', '**Identifier:** FIXTURE-001\n');
  manifest([{ source: 'docs/input.json', sourceSha256: digest, status: 'mapped', targets: [
    { kind: 'evidence', ownerChange: 'fixture', artifactPath: 'evidence/input.json', sha256: digest },
    { kind: 'spec', ownerChange: 'fixture', artifactPath: 'specs/fixture/spec.md', requirement: 'FIXTURE-001' },
  ] }]);
  const before = readFileSync(join(base, 'openspec/changes/fixture/evidence/migration-map.json'));
  checkRepositoryDocs(base);
  write('openspec/specs/fixture/spec.md', '**Identifier:** FIXTURE-001\n');
  mkdirSync(join(base, 'openspec/changes/archive'));
  renameSync(join(base, 'openspec/changes/fixture'), join(base, 'openspec/changes/archive/2026-10-12-fixture'));
  checkRepositoryDocs(base);
  assert.deepEqual(readFileSync(join(base, 'openspec/changes/archive/2026-10-12-fixture/evidence/migration-map.json')), before);
  assert.equal(existsSync(join(base, 'openspec/changes/fixture')), false);
  assert.equal(existsSync(join(base, 'docs')), false);
});
