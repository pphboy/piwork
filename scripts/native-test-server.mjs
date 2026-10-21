// Development fixture builder only. Images are embedded at compile time, just
// like a release; product processes receive no runtime image override.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {identity,root} from './build-docker-release.mjs';

export function fixtureServerBuild(output,images,metadata) {
  assert.deepEqual(Object.keys(images).sort(),['agent','fileHelper','packageHelper','snapshotHelper']);
  for(const value of Object.values(images))assert(typeof value==='string'&&value.length<=255&&/^[a-z0-9][a-zA-Z0-9._/:@-]+$/.test(value)&&!value.endsWith(':latest'),'Use fixed fixture image references');
  const encoded=Buffer.from(JSON.stringify(images)).toString('base64').replace(/=+$/,'');
  const stamps={Version:metadata.releaseVersion,Commit:metadata.sourceCommit,Modified:String(metadata.sourceModified),DesktopUIHash:metadata.desktopUIHash,ConsoleUIHash:metadata.consoleUIHash};
  const flags=Object.entries(stamps).map(([key,value])=>`-X piwork/internal/buildinfo.${key}=${value}`);
  flags.push(`-X piwork/internal/distribution.EncodedImages=${encoded}`);
  return ['build','-mod=readonly','-trimpath','-buildvcs=true','-ldflags',flags.join(' '),'-o',join(output,'piwork-core'),'./cmd/piwork-core'];
}
export function buildNativeTestServer(output,images,{run=spawnSync}={}) {
  const git=args=>{const result=run('git',args,{cwd:root,encoding:'utf8'});assert.equal(result.status,0,'Fixture source identity unavailable');return result.stdout.trim();};
  const metadata=identity(root,{PIWORK_COMMIT:git(['rev-parse','HEAD']),PIWORK_MODIFIED:String(!!git(['status','--porcelain','--untracked-files=normal']))});
  mkdirSync(output,{recursive:true});
  const args=fixtureServerBuild(output,images,metadata);
  const result=run('go',args,{cwd:root,encoding:'utf8',env:{...process.env,CGO_ENABLED:'0',GOTOOLCHAIN:'local'}});
  assert.equal(result.status,0,'Fixture server build failed');
  writeFileSync(join(output,'fixture-build.json'),JSON.stringify({fixture:true,...metadata,images},null,2)+'\n');
  return join(output,'piwork-core');
}
