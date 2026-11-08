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
  const chain = { command: ['fixture-generator'], outputs: ['output'], expectedFiles: ['output/wire.ts'] };
  const generate = () => writeFileSync(join(root, 'output/wire.ts'), 'export interface Wire { id: string }\n');
  assert.deepEqual(checkGenerated(root, [chain], generate), ['output/wire.ts']);
  assert.deepEqual(checkGenerated(root, [chain], generate), []);
  writeFileSync(join(root, 'output/wire.ts'), 'export interface Wire { id: number }\n');
  assert.deepEqual(checkGenerated(root, [chain], generate), ['output/wire.ts']);
  writeFileSync(join(root, 'output/obsolete.ts'), 'stale');
  // Match protoc's overwrite-only behavior; the checker must not delete a file.
  assert.deepEqual(checkGenerated(root, [chain], generate), ['output/obsolete.ts']);
  assert.equal(readFileSync(join(root, 'output/obsolete.ts'), 'utf8'), 'stale');
  assert.deepEqual(checkGenerated(root, [chain], generate), ['output/obsolete.ts']);
  rmSync(join(root, 'output/obsolete.ts'));
  assert.deepEqual(checkGenerated(root, [chain], generate), []);
  assert.deepEqual(checkGenerated(root, [{ ...chain, expectedFiles: [...chain.expectedFiles, 'output/omitted.ts'] }], generate), ['output/omitted.ts']);
  assert.equal(readFileSync(join(root, 'frozen.json'), 'utf8'), 'original artifact identity');
  assert.throws(() => checkGenerated(root, [{ command: [], outputs: ['missing.ts'] }], () => {}), /omitted declared output/);
});

test('manifest preserves old history readers and excludes frozen prototype/release identities', () => {
  assert(generatedChains.history.outputs.includes('packages/work-store/src/legacy-schema.ts'));
  assert(generatedChains.history.outputs.includes('packages/work-store/src/schema-v5.ts'));
  assert(generatedChains.history.outputs.includes('packages/work-store/src/schema-v6.ts'));
  assert(generatedChains.history.outputs.includes('packages/work-store/src/schema-v7.ts'));
  assert(generatedChains.history.outputs.includes('packages/work-store/src/schema-v7-objects.ts'));
  assert(generatedChains.history.outputs.includes('internal/workhistory/schema-v7-objects.json'));
  assert(generatedChains.history.outputs.includes('packages/work-store/src/schema-v8.ts'));
  assert(generatedChains.history.outputs.includes('internal/workhistory/schema-v8-objects.json'));
  for (const chain of Object.values(generatedChains)) {
    assert(chain.sources.length > 0);
    assert(chain.outputs.every(path => !path.startsWith('openspec/') && !path.startsWith('deploy/')));
  }
});


test('protocol inventory covers pinned outputs and rejects obsolete files without deleting them', t => {
  const root = mkdtempSync(join(tmpdir(), 'piwork-protocol-inventory-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const chain = generatedChains.protocol;
  const writeOutput = file => {
    const directory = file.slice(0, file.lastIndexOf('/'));
    mkdirSync(join(root, directory), { recursive: true });
    writeFileSync(join(root, file), 'synthetic pinned generated output\n');
  };
  const overwriteOnly = () => chain.expectedFiles.forEach(writeOutput);
  overwriteOnly();
  assert.deepEqual(checkGenerated(root, [chain], overwriteOnly), []);
  for (const stale of ['internal/rpc/agentv1/obsolete.pb.go', 'internal/rpc/servicesv1/obsolete_grpc.pb.go', 'packages/contracts/src/generated/obsolete.ts']) {
    writeOutput(stale);
    assert(checkGenerated(root, [chain], overwriteOnly).includes(stale));
    assert.equal(readFileSync(join(root, stale), 'utf8'), 'synthetic pinned generated output\n');
  }
});
