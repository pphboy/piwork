import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
const run=promisify(execFile);
test('native source boundary scans scripts, runtime configuration, locks and current docs',async t=>{
 const root=await mkdtemp(join(tmpdir(),'piwork-boundary-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const dir of ['scripts','apps/agentd','packages','docs','.github'])await mkdir(join(root,dir),{recursive:true});
 await copyFile(new URL('./check-native-boundary.mjs',import.meta.url),join(root,'scripts/check-native-boundary.mjs'));
 await writeFile(join(root,'apps/agentd/package.json'),JSON.stringify({name:'@piwork/agentd'}));
 await writeFile(join(root,'package-lock.json'),JSON.stringify({packages:{}}));
 const check=()=>run(process.execPath,['scripts/check-native-boundary.mjs'],{cwd:root});
 await check();
 for(const [path,body] of [
  ['scripts/boot.mjs',"await import('../apps/core/dist/main.js')"],
  ['runtime.yaml','command: node apps/cli/dist/main.js'],
  ['package-lock.json',JSON.stringify({packages:{},hidden:'@piwork/core-store'})],
  ['docs/operations.md','Run node apps/core/dist/main.js'],
  ['.github/build.yml','run: npm run build -w @piwork/runtime-docker'],
 ]){
   await writeFile(join(root,path),body);await assert.rejects(check(),err=>err.stderr.includes('Legacy platform reference: '+path));
   if(path==='package-lock.json')await writeFile(join(root,path),JSON.stringify({packages:{}}));else await rm(join(root,path));
 }
 await writeFile(join(root,'scripts/agent.mjs'),"await import('../apps/agentd/dist/main.js'); await import('@piwork/pi-adapter');");
 await writeFile(join(root,'docs/operations.md'),'./dist/go/piwork-serve serve');
 await check();
});
