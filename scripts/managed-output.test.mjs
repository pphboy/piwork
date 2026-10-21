import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,renameSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {managedOutput,commitOutput,recoverOutput} from './managed-output.mjs';

test('managed replacement removes stale outputs and recovers interrupted commit',()=>{
 const base=mkdtempSync(join(tmpdir(),'piwork-output-'));
 try {
  const target=managedOutput('dist/release',base);
  mkdirSync(target);writeFileSync(join(target,'old.exe'),'old');
  for(const version of ['A','B','B']) {
   const stage=mkdtempSync(target+'.stage-');
   writeFileSync(join(stage,'current'),version);
   commitOutput(stage,target);
   assert.deepEqual(readdirSync(target),['current']);
   assert.equal(readFileSync(join(target,'current'),'utf8'),version);
  }
  renameSync(target,target+'.previous');recoverOutput(target);
  assert.equal(readFileSync(join(target,'current'),'utf8'),'B');
  const failed=mkdtempSync(target+'.stage-');writeFileSync(join(failed,'partial'),'bad');
  assert.equal(readFileSync(join(target,'current'),'utf8'),'B');
  assert.throws(()=>commitOutput(join(base,'wrong'),target));
 }finally{rmSync(base,{recursive:true,force:true});}
});
test('managed output refuses roots, data and symlinks',()=>{
 const base=mkdtempSync(join(tmpdir(),'piwork-output-'));
 try {
  for(const value of ['.','dist','dist/data','../go','/tmp'])assert.throws(()=>managedOutput(value,base));
  mkdirSync(join(base,'dist'));symlinkSync(tmpdir(),join(base,'dist/go'));
  assert.throws(()=>managedOutput('dist/go',base));
  rmSync(join(base,'dist/go'));symlinkSync(join(base,'missing'),join(base,'dist/go'));
  assert.throws(()=>managedOutput('dist/go',base));
 }finally{rmSync(base,{recursive:true,force:true});}
});
