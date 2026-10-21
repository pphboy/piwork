// Local-only release pipeline. Ordering is explicit even when make uses -j.
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {identity,writeMetadata,root,sourceInputHash,roles,collectRecords,verifyImageRecords,writeMaterials} from './build-docker-release.mjs';

function run(command,args,env={}) {
 const result=spawnSync(command,args,{cwd:root,env:{...process.env,...env},stdio:'inherit'});
 if(result.error||result.status!==0)throw new Error(`${command} failed`);
}
function capture(command,args) {
 const result=spawnSync(command,args,{cwd:root,encoding:'utf8'});
 if(result.error||result.status!==0)throw new Error(`${command} failed`);
 return result.stdout.trim();
}
try {
 // Image building uses the local Docker service; runtime baseline validation
 // runs separately against the local isolated acceptance Engine.
 capture('docker',['version','--format','{{.Server.Version}}']);
 run('make',['harness-fixtures','webui-assets']);
 const metadata=identity(root,{...process.env,PIWORK_COMMIT:capture('git',['rev-parse','HEAD']),PIWORK_MODIFIED:String(!!capture('git',['status','--porcelain','--untracked-files=normal']))});
 mkdirSync(join(root,'dist'),{recursive:true});
 const stage=mkdtempSync(join(root,'dist/release-input-'));
 try {
  writeMetadata(metadata,stage);
  const env={PIWORK_RELEASE_METADATA:join(stage,'metadata.json'),PIWORK_RELEASE_REGISTRY:metadata.registry};
  const args=Object.entries({PIWORK_VERSION:metadata.releaseVersion,PIWORK_COMMIT:metadata.sourceCommit,PIWORK_MODIFIED:String(metadata.sourceModified),PIWORK_DIRTY:String(metadata.sourceModified),PIWORK_SOURCE_INPUT_HASH:metadata.sourceInputHash,PIWORK_DESKTOP_UI_HASH:metadata.desktopUIHash,PIWORK_CONSOLE_UI_HASH:metadata.consoleUIHash,PIWORK_RELEASE_REGISTRY:metadata.registry}).flatMap(([key,value])=>['--build-arg',`${key}=${value}`]);
  for(const [role,file,target] of [['agent','Dockerfile.agentd','production'],['fileHelper','Dockerfile.file-helper.native'],['snapshotHelper','Dockerfile.snapshot-helper.native']]) {
   run('docker',['build','--platform','linux/amd64','-f',file,...(target?['--target',target]:[]),...args,'-t',metadata.images[role],'.']);
  }
  if(sourceInputHash()!==metadata.sourceInputHash)throw new Error('Release inputs changed during image build');
  run('bash',['scripts/build-go.sh'],env);
  run('docker',['build','--platform','linux/amd64','-f','Dockerfile.core',...args,'-t',metadata.images.core,'.']);
  run('bash',['scripts/collect-docker-release.sh',stage],env);
  const records=collectRecords(stage);verifyImageRecords(metadata,records);
  if(sourceInputHash()!==metadata.sourceInputHash)throw new Error('Release inputs changed during verification');
  // Candidate materials are generated only after real image verification.
  run(process.execPath,['scripts/sync-docker-quickstart.mjs',join(stage,'metadata.json')]);
  run(process.execPath,['scripts/check-docker-quickstart.mjs']);
  writeMaterials(metadata,records,join(stage,'materials'));
  run('bash',['scripts/package-go-release.sh'],env);
 } finally {rmSync(stage,{recursive:true,force:true});}
}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
