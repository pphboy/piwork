// Re-run the existing generators; compare bytes, not git's dirty/clean state.
// Changed outputs are deliberately left for review, never reset over user edits.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const generatedChains = {
  history: {
    command: ['node', 'scripts/generate-work-history.mjs'],
    sources: ['internal/workhistory/*.sql'],
    outputs: [
      ...['brain-schema', 'schema-objects', 'schema-v8', 'schema-v8-objects', 'schema-v7', 'schema-v7-objects', 'previous-schema', 'previous-schema-objects', 'schema-v6', 'schema-v6-objects', 'schema-v5', 'schema-v5-objects', 'legacy-schema', 'legacy-schema-objects', 'memory-schema', 'memory-schema-objects'].map(name => `packages/work-store/src/${name}.ts`),
      ...['schema-objects', 'schema-v8-objects', 'schema-v7-objects', 'schema-v6-objects', 'schema-v5-objects', 'schema-v4-objects', 'memory-schema-objects'].map(name => `internal/workhistory/${name}.json`),
    ],
  },
  protocol: {
    command: ['node', 'scripts/generate-protocol.mjs'],
    sources: ['proto/agent.proto', 'proto/work-services.proto'],
    outputs: ['internal/rpc/agentv1', 'internal/rpc/servicesv1', 'internal/rpc/testdata/wire-descriptor.pb', 'packages/contracts/src/generated'],
    // The pinned generator's two proto inputs produce exactly this inventory.
    // Check extras as well as changed bytes: protoc does not remove obsolete files.
    expectedFiles: [
      'internal/rpc/agentv1/agent.pb.go',
      'internal/rpc/agentv1/agent_grpc.pb.go',
      'internal/rpc/servicesv1/work-services.pb.go',
      'internal/rpc/servicesv1/work-services_grpc.pb.go',
      'internal/rpc/testdata/wire-descriptor.pb',
      'packages/contracts/src/generated/agent.ts',
      'packages/contracts/src/generated/work-services.ts',
    ],
  },
  http: {
    command: ['make', 'generate'],
    sources: ['internal/contracts/schemas.json (frozen base plus generated additions)', 'packages/contracts/src', 'internal/workhistory/*.sql', 'proto/*.proto'],
    outputs: ['internal/workpackage/schema', 'internal/contracts/schemas.json', 'internal/contracts/dto_generated.go', 'internal/contracts/dto_generated_test.go', 'internal/contracts/history_limits_generated.go', 'internal/contracts/testdata/ts-validation.json', 'internal/contracts/testdata/history-encoding.json', 'internal/coreapp/model-sdk-catalog.json'],
  },
  ui: {
    command: ['make', 'webui-assets'],
    sources: ['apps/ui-shared', 'apps/desktop-webui/src', 'apps/desktop-webui/public', 'apps/console-webui/src', 'apps/console-webui/public'],
    outputs: ['internal/desktopassets/static', 'internal/consoleassets/static'],
  },
};

export function snapshotOutputs(root, outputs) {
  const result = new Map();
  function visit(path) {
    const full = join(root, path);
    if (!existsSync(full)) return;
    const entries = readdirSync(full, { withFileTypes: true });
    for (const entry of entries) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) visit(child);
      else result.set(child, createHash('sha256').update(readFileSync(join(root, child))).digest('hex'));
    }
  }
  for (const path of outputs) {
    if (!existsSync(join(root, path))) continue;
    try {
      result.set(path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex'));
    } catch (error) {
      if (error.code !== 'EISDIR') throw error;
      visit(path);
    }
  }
  return result;
}

export function changedOutputs(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])].filter(path => before.get(path) !== after.get(path)).sort();
}

export function checkGenerated(root, chains, run) {
  const outputs = [...new Set(chains.flatMap(chain => chain.outputs))];
  const before = snapshotOutputs(root, outputs);
  for (const chain of chains) run(chain.command);
  const after = snapshotOutputs(root, outputs);
  for (const path of outputs) {
    if (!existsSync(join(root, path))) throw new Error(`Generator omitted declared output: ${path}`);
  }
  const differences = new Set(changedOutputs(before, after));
  for (const chain of chains) {
    if (!chain.expectedFiles) continue;
    const expected = new Set(chain.expectedFiles);
    const actual = snapshotOutputs(root, chain.outputs);
    for (const file of actual.keys()) {
      if (!expected.has(file)) differences.add(file);
    }
    for (const file of expected) {
      if (!actual.has(file)) differences.add(file);
    }
  }
  return [...differences].sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const names = process.argv.slice(2);
  if (!names.length || names.some(name => !Object.hasOwn(generatedChains, name))) {
    throw new Error('Select generation chains: history, protocol, http, ui. http invokes make generate (all protocol chains).');
  }
  const root = resolve(import.meta.dirname, '..');
  const selected = names.map(name => generatedChains[name]);
  // make generate also regenerates history/protobuf: include all their outputs.
  if (names.includes('http')) selected.unshift(generatedChains.history, generatedChains.protocol);
  const seen = new Set();
  if (names.includes('http')) {
    seen.add(generatedChains.history.command.join('\0'));
    seen.add(generatedChains.protocol.command.join('\0'));
  }
  const differences = checkGenerated(root, selected, command => {
    const key = command.join('\0');
    if (seen.has(key)) return;
    seen.add(key);
    const result = spawnSync(command[0], command.slice(1), { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Generation failed: ${command.join(' ')}`);
  });
  if (differences.length) {
    console.error('Stale or unexpected generated output (regenerated bytes and unexpected files left for review):\n' + differences.join('\n'));
    process.exitCode = 1;
  } else console.log('Selected generated outputs match their source generators.');
}
