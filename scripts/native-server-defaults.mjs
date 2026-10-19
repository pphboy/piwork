// Build-time only: bind a native server to the reviewed Docker dependency set.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {identity,coreReleaseConfig,root} from './build-docker-release.mjs';

export function nativeServerDefaults(metadata, expected) {
  for(const key of ['releaseVersion','releaseId','sourceCommit','sourceModified','sourceInputHash','desktopUIHash','consoleUIHash','platform']) {
    if(metadata[key]!==expected[key])throw new Error('Native release metadata does not match current build inputs.');
  }
  if(JSON.stringify(metadata.images)!==JSON.stringify(expected.images))throw new Error('Native release dependency references changed.');
  return Buffer.from(JSON.stringify(coreReleaseConfig(expected).images)).toString('base64').replace(/=+$/,'');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {
  if(process.argv.length!==3)throw new Error('usage: native-server-defaults.mjs METADATA_JSON');
  const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const modified=Boolean(execFileSync('git',['status','--porcelain','--untracked-files=normal'],{cwd:root,encoding:'utf8'}).trim());
  const metadata=JSON.parse(readFileSync(process.argv[2],'utf8'));
  const expected=identity(root,{PIWORK_COMMIT:commit,PIWORK_MODIFIED:String(modified),PIWORK_RELEASE_REGISTRY:metadata.registry});
  process.stdout.write(nativeServerDefaults(metadata,expected));
 }catch {process.stderr.write('Native server release inputs are missing, changed or invalid. Regenerate the complete candidate.\n');process.exitCode=1;}
}
