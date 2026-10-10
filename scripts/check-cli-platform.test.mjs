import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, testEvidence, validateFixtures } from './check-cli-platform.mjs';

test('native evidence distinguishes failures, absent tests and skipped assertions',()=>{
 const event=value=>JSON.stringify(value)+'\n';
 const passed=event({Action:'pass',Package:'piwork/internal/client',Test:'TestCredentialNative'})+event({Action:'pass',Package:'piwork/internal/client'});
 assert.equal(testEvidence(passed,0).status,'pass');
 assert.equal(testEvidence(passed,1).status,'fail');
 assert.equal(testEvidence(passed+event({Action:'fail',Test:'TestUnsafe'}),0).status,'fail');
 assert.equal(testEvidence(passed+event({Action:'skip',Test:'TestOtherSID'}),0).status,'unverified');
 assert.equal(testEvidence('',0).status,'unverified');
 assert.equal(testEvidence('not JSON',0).status,'fail');
});
test('reports filter credentials, launch tickets and URL userinfo',()=>{
 const raw='Bearer token-secret https://account:password@core.example/?ticket=ticket-value "password":"sensitive" env-password';
 const filtered=redact(raw,{PIWORK_TEST_PASSWORD:'env-password'});
 for(const value of ['token-secret','account:password','ticket-value','sensitive','env-password']) assert(!filtered.includes(value));
 assert(filtered.includes('[redacted]'));
});
test('fixture configuration cannot introduce unknown scenarios or secret arguments',()=>{
 assert.deepEqual(validateFixtures({version:1,scenarios:{'other-user':{command:'native-fixture.exe',args:['--probe']}}}).version,1);
 for(const value of [{version:2,scenarios:{}},{version:1,scenarios:{unknown:{command:'tool',args:[]}}},{version:1,scenarios:{auth:{command:'tool',args:['--password','secret']}}},{version:1,scenarios:{auth:{command:'tool',args:['https://a:p@core.example']}}}]) assert.throws(()=>validateFixtures(value));
});

test('fixtures bind this binary and keep missing native capability unverified even with nonzero exit', async()=>{
 const {fixtureEvidence}=await import('./check-cli-platform.mjs');
 const scene={id:'other-user',sha256:'candidate',target:'windows/amd64',status:'unverified',diagnostic:'second SID unavailable'};
 assert.equal(fixtureEvidence({status:1,stdout:JSON.stringify(scene)},scene.id,'candidate',scene.target).status,'unverified');
 assert.equal(fixtureEvidence({error:{code:'ENOENT'}},scene.id,'candidate',scene.target).status,'unverified');
 assert.equal(fixtureEvidence({status:1,stdout:JSON.stringify({...scene,status:'pass'})},scene.id,'candidate',scene.target).status,'fail');
 assert.equal(fixtureEvidence({status:0,stdout:JSON.stringify({...scene,status:'pass',sha256:'other candidate'})},scene.id,'candidate',scene.target).status,'fail');
 assert.equal(fixtureEvidence({status:0,stdout:JSON.stringify({...scene,status:'pass'})},scene.id,'candidate',scene.target).status,'pass');
});

test('required symlink fixture failure is unverified, while unrelated assertion failures remain failures',()=>{
 const event=value=>JSON.stringify(value)+'\n';
 const output=event({Action:'output',Package:'piwork/internal/pipackage',Test:'TestTree/link',Output:'required native symlink fixture unavailable: privilege missing'})+event({Action:'fail',Package:'piwork/internal/pipackage',Test:'TestTree/link'})+event({Action:'fail',Package:'piwork/internal/pipackage',Test:'TestTree'})+event({Action:'fail',Package:'piwork/internal/pipackage'});
 assert.equal(testEvidence(output,1).status,'unverified');
 assert.equal(testEvidence(output+event({Action:'fail',Package:'piwork/internal/client',Test:'TestUnsafeACL'}),1).status,'fail');
});

test('native acceptance rejects a foreign target, changed binary and source that cannot reproduce the candidate',async()=>{
 const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join,dirname}=await import('node:path');const {createHash}=await import('node:crypto');
 const {checkPlatform}=await import('./check-cli-platform.mjs');const {desktopInputHash}=await import('./build-cli.mjs');
 const base=mkdtempSync(join(tmpdir(),'piwork-native-binding-test-'));
 try {
  for(const dir of ['apps/desktop-webui/src','apps/desktop-webui/public','apps/desktop-webui/scripts','docs/images','build'])mkdirSync(join(base,dir),{recursive:true});
  writeFileSync(join(base,'docs/images/piwork-logo.png'),'synthetic public logo');
  for(const file of ['apps/desktop-webui/tsconfig.json','apps/desktop-webui/package.json','scripts/sync-desktop-assets.mjs','package-lock.json']){mkdirSync(dirname(join(base,file)),{recursive:true});writeFileSync(join(base,file),'{}');}
  const data=Buffer.from('native candidate fixture'),sha256=createHash('sha256').update(data).digest('hex');
  const metadata={version:1,program:'piwork-cli',target:'linux/amd64',binary:'piwork-cli',sha256,releaseVersion:'0.1.0',commit:'a'.repeat(40),modified:true,desktopUIHash:desktopInputHash(base),goVersion:'go1.25.5'};
  const path=join(base,'build','build.json'),binary=join(base,'build','piwork-cli');writeFileSync(path,JSON.stringify(metadata));writeFileSync(binary,data);
  const options={base,buildDirectory:join(base,'build'),reportPath:join(base,'evidence.json'),fixtures:{version:1,scenarios:{'client-dependencies':{command:'pretend-pass',args:[]}}}};
  const environment={nodeVersion:'24.1.0',nativeTarget:'windows/amd64'};
  assert.throws(()=>checkPlatform(options,environment),/native target/);
  environment.nativeTarget='linux/amd64';writeFileSync(binary,'changed');assert.throws(()=>checkPlatform(options,environment),/binary or Desktop/);writeFileSync(binary,data);
  let tested=false;
  const run=(command,args)=>{
   if(args.join(' ')==='env GOVERSION')return {status:0,stdout:'go1.25.5',stderr:''};
   if(args[0]==='build')return {status:1,stdout:'',stderr:'source is different'};
   if(args[0]==='list')return {status:0,stdout:'piwork/internal/client',stderr:''};
   if(args[0]==='test')tested=true;
   if(command==='pretend-pass')return {status:0,stdout:JSON.stringify({id:'client-dependencies',sha256,target:'linux/amd64',status:'pass'}),stderr:''};
   return {status:1,stdout:'',stderr:'fixture unavailable'};
  };
  const report=checkPlatform(options,{...environment,run});
  assert.equal(tested,false);assert.equal(report.scenarios.find(s=>s.id==='client-dependencies').status,'fail');
 } finally {rmSync(base,{recursive:true,force:true});}
});
