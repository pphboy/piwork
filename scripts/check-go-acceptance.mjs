import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function validateScenarioEvidence(records) {
  if (!Array.isArray(records) || records.length !== 970) throw new Error(`Expected 970 acceptance scenarios; found ${records?.length}`);
  if (new Set(records.map(({id}) => id)).size !== records.length) throw new Error('Duplicate acceptance scenario identities');
  const incomplete = records.filter(({ status, tests, commands, results }) =>
    status !== '通过' || [tests,commands,results].some(values=>!Array.isArray(values)||!values.length||values.some(value=>typeof value!=='string'||!value.trim())),
  );
  if (incomplete.length) throw new Error(`${incomplete.length} of ${records.length} acceptance scenarios remain unverified.\n${incomplete.slice(0,10).map(({id})=>id).join('\n')}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const records = JSON.parse(await readFile(new URL('../docs/go-migration-scenarios.json', import.meta.url), 'utf8'));
  try {validateScenarioEvidence(records);console.log(`All ${records.length} acceptance scenarios have test, command, and result evidence.`);}
  catch(error){console.error(error.message);process.exitCode=1;}
}
