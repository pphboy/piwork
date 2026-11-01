import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkGenerated, generatedChains } from './check-generated.mjs';

test('regeneration detects stale, missing, extra and interface-mismatched output without changing frozen evidence', t => {
  const root = mkdtempSync(join(tmpdir(), 'piwork-generated-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'output'));
  writeFileSync(join(root, 'frozen.json'), 'original artifact identity');
  const chain = { command: ['fixture-generator'], outputs: ['output'] };
  const generate = () => writeFileSync(join(root, 'output/wire.ts'), 'export interface Wire { id: string }\n');
  assert.deepEqual(checkGenerated(root, [chain], generate), ['output/wire.ts']);
  assert.deepEqual(checkGenerated(root, [chain], generate), []);
  writeFileSync(join(root, 'output/wire.ts'), 'export interface Wire { id: number }\n');
  assert.deepEqual(checkGenerated(root, [chain], generate), ['output/wire.ts']);
  writeFileSync(join(root, 'output/obsolete.ts'), 'stale');
  assert.deepEqual(checkGenerated(root, [chain], () => {
    rmSync(join(root, 'output/obsolete.ts'));
    generate();
  }), ['output/obsolete.ts']);
  assert.equal(readFileSync(join(root, 'frozen.json'), 'utf8'), 'original artifact identity');
  assert.throws(() => checkGenerated(root, [{ command: [], outputs: ['missing.ts'] }], () => {}), /omitted declared output/);
});

test('manifest preserves old history readers and excludes frozen prototype/release identities', () => {
  assert(generatedChains.history.outputs.includes('packages/work-store/src/legacy-schema.ts'));
  assert(generatedChains.history.outputs.includes('packages/work-store/src/schema-v5.ts'));
  assert(generatedChains.history.outputs.includes('packages/work-store/src/schema-v6.ts'));
  for (const chain of Object.values(generatedChains)) {
    assert(chain.sources.length > 0);
    assert(chain.outputs.every(path => !path.startsWith('openspec/') && !path.startsWith('deploy/')));
  }
});
