import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildCLI, desktopInputHash, parseTargets } from './build-cli.mjs';

test('CLI target selection is explicit, validated and never hides a bad configured list', () => {
 assert.throws(()=>parseTargets(['--target','windows/amd64'],null,'linux/amd64'));
 assert.throws(()=>parseTargets([],null,'linux/arm64'));
 for (const config of [{}, {version:1,targets:[]}, {version:1,targets:['linux/amd64'],other:true}, {version:1,targets:['../wrong']}]) assert.throws(() => parseTargets([],config,'linux/amd64'));
 assert.throws(() => parseTargets(['--target'],null,'linux/amd64'));
});

test('CLI build prepares fresh Desktop once and builds only the requested clients', () => {
 const base=mkdtempSync(join(tmpdir(),'piwork-cli-build-'));
 try {
  for (const directory of ['apps/desktop-webui/src','apps/desktop-webui/public','apps/desktop-webui/scripts','apps/desktop-webui/dist','scripts','apps/ui-shared/assets','internal/releaseinfo']) mkdirSync(join(base,directory),{recursive:true});
  for (const name of ['apps/desktop-webui/tsconfig.json','apps/desktop-webui/package.json','scripts/sync-desktop-assets.mjs','package-lock.json']) writeFileSync(join(base,name),'{}');
  writeFileSync(join(base,'apps/ui-shared/browser-crypto.js'),'synthetic browser crypto');
  writeFileSync(join(base,'apps/ui-shared/tokens.css'),'synthetic shared tokens');
  writeFileSync(join(base,'apps/ui-shared/controls.css'),'synthetic shared controls');
  writeFileSync(join(base,'package.json'),'{"version":"0.1.0"}');
  writeFileSync(join(base,'apps/ui-shared/assets/piwork-logo.png'),'fixture logo');
  writeFileSync(join(base,'apps/desktop-webui/dist/stale.js'),'old UI');
  writeFileSync(join(base,'internal/releaseinfo/notes.json'),JSON.stringify({version:1,releases:[]}));
  const calls=[];
  const run=(command,args,options) => {
   calls.push({command,args,options});
   const key=args.join(' ');
   let stdout=({'env GOVERSION':'go1.25.5','env GOOS':'linux','env GOARCH':'amd64','tool dist list':'linux/amd64\nwindows/amd64','rev-parse --verify HEAD':'a'.repeat(40),'status --porcelain --untracked-files=normal':''})[key] || '';
   if (args[0]==='build') writeFileSync(args[args.indexOf('-o')+1],'candidate '+options.env.GOOS);
   if (args.includes('tsconfig.json')) assert.equal(existsSync(join(base,'apps/desktop-webui/dist/stale.js')),false);
   return {status:0,stdout,stderr:''};
  };
  const outputs=buildCLI(['--target','linux/amd64'],{base,run,nodeVersion:'24.20.0'});
  assert.equal(outputs.length,1);
  const builds=calls.filter(call=>call.args[0]==='build');
  assert.equal(builds.length,1);
  assert.equal(calls.filter(call=>call.args.includes('tsconfig.json')).length,1);
  for (const call of builds) {
   assert.equal(call.args.at(-1),'./cmd/piwork-cli');
   assert.equal(call.options.env.CGO_ENABLED,'0');
   assert.equal(call.options.env.GOTOOLCHAIN,'local');
   assert(call.args.includes('-mod=readonly')); assert(call.args.includes('-trimpath'));
  }
  assert(!calls.some(call=>call.command==='npm'||call.command==='docker'||call.command==='bash'||call.args.some(arg=>arg.includes('console'))));
  const metadata=JSON.parse(readFileSync(join(dirname(outputs[0]),'build.json'),'utf8'));
  assert.match(metadata.desktopUIHash,/^[a-f0-9]{64}$/); assert.match(metadata.sha256,/^[a-f0-9]{64}$/);
  assert.equal(desktopInputHash(base),metadata.desktopUIHash);
  assert.match(metadata.releaseInfoHash,/^[a-f0-9]{64}$/);
  writeFileSync(join(base,'apps/ui-shared/controls.css'),'updated shared controls');
  assert.notEqual(desktopInputHash(base),metadata.desktopUIHash);
  writeFileSync(join(base,'apps/ui-shared/controls.css'),'synthetic shared controls');
  writeFileSync(join(base,'apps/ui-shared/assets/piwork-logo.png'),'updated fixture logo');
  assert.notEqual(desktopInputHash(base),metadata.desktopUIHash);
  assert.throws(()=>buildCLI([],{base,run,nodeVersion:'25.0.0'}),/Node 24/);
 } finally {rmSync(base,{recursive:true,force:true});}
});
