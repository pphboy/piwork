import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveChangeArtifact } from './resolve-change-artifact.mjs';
import { frozenEvidencePath } from './update-go-acceptance-index.mjs';

export function validateScenarioEvidence(records) {
  if (!Array.isArray(records) || records.length !== 970) throw new Error(`Expected 970 acceptance scenarios; found ${records?.length}`);
  if (new Set(records.map(({id}) => id)).size !== records.length) throw new Error('Duplicate acceptance scenario identities');
  const incomplete = records.filter(({ status, tests, commands, results }) =>
    status !== '通过' || [tests,commands,results].some(values=>!Array.isArray(values)||!values.length||values.some(value=>typeof value!=='string'||!value.trim())),
  );
  if (incomplete.length) throw new Error(`${incomplete.length} of ${records.length} acceptance scenarios remain unverified.\n${incomplete.slice(0,10).map(({id})=>id).join('\n')}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = await readFile(new URL('../dist/verification/go-migration-scenarios.json', import.meta.url), 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return readFile(resolveChangeArtifact(fileURLToPath(new URL('../', import.meta.url)), { ownerChange: 'go-core-cli-migration', artifactPath: frozenEvidencePath }), 'utf8');
  });
  const records = JSON.parse(text);
  try {validateScenarioEvidence(records);console.log(`All ${records.length} acceptance scenarios have test, command, and result evidence.`);}
  catch(error){console.error(error.message);process.exitCode=1;}
}
