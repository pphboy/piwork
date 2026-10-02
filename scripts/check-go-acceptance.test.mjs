import assert from 'node:assert/strict';
import test from 'node:test';
import {validateScenarioEvidence} from './check-go-acceptance.mjs';
const fixture=()=>Array.from({length:970},(_,index)=>({id:`gate-fixture/${index}`,status:'通过',tests:['test fixture'],commands:['fixture command'],results:['fixture executed']}));
test('acceptance gate rejects missing, pending and falsely checked browser or crash evidence',()=>{
  validateScenarioEvidence(fixture());
  for(const change of [row=>{row.status='未验证';},row=>{row.tests=[];},row=>{row.commands=[];},row=>{row.results=[];},row=>{row.results=[' '];}]){
    const records=fixture();change(records[969]);assert.throws(()=>validateScenarioEvidence(records),/unverified/);
  }
  assert.throws(()=>validateScenarioEvidence(fixture().slice(0,969)),/970/);
  const duplicates=fixture();duplicates[969].id=duplicates[0].id;assert.throws(()=>validateScenarioEvidence(duplicates),/Duplicate/);
});
