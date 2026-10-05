import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { platform, release, arch, tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, desktopInputHash } from './build-cli.mjs';

export const requiredScenarios = ['client-dependencies','private-storage','other-user','symlink','files','auth','desktop-control','interrupts','default-desktop','preferences-storage','preferences-api','preferences-browser','core-command-families','core-packages-snapshots','proxy-network','browser-isolation','standalone-runtime','tls-negative'];
export function redact(value, env = process.env) {
 let text = String(value);
 for (const [name,secret] of Object.entries(env)) if (/password|token|secret|credential/i.test(name) && secret && secret.length >= 3) text = text.split(secret).join('[redacted]');
 return text.replace(/(Bearer|Operator)\s+[^\s"']+/gi,'$1 [redacted]').replace(/([?&#](?:ticket|token|password)=)[^\s&#"']*/gi,'$1[redacted]').replace(/(https?:\/\/)[^\s/]+@/gi,'$1[redacted]@').replace(/((?:"?(?:password|token|secret|authorization)"?\s*[:=]\s*)")[^"]*"/gi,'$1[redacted]"');
}
export function testEvidence(output, status) {
 const events = [];
 try { for (const line of output.split(/\r?\n/).filter(Boolean)) events.push(JSON.parse(line)); } catch { return {status:'fail',diagnostic:'invalid go test evidence stream'}; }
 if (status !== 0 || events.some(event=>event.Action==='fail')) {
  const failed=events.filter(event=>event.Action==='fail'&&event.Test);
  const missing=events.filter(event=>event.Test&&/required native .*fixture unavailable/.test(event.Output||'')).map(event=>`${event.Package}:${event.Test}`);
  if(failed.length && failed.every(event=>missing.some(name=>name===`${event.Package}:${event.Test}`||name.startsWith(`${event.Package}:${event.Test}/`)))) return {status:'unverified',diagnostic:'required native fixture unavailable; failed fixture assertions were not counted as passes'};
  return {status:'fail',diagnostic:'native dependency tests failed; sanitized diagnostics are recorded'};
 }
 if (events.some(event=>event.Action==='skip' && event.Test)) return {status:'unverified',diagnostic:'native dependency test skipped a scenario'};
 const packages = new Set(events.filter(event=>event.Action==='pass' && !event.Test).map(event=>event.Package));
 const tests = events.filter(event=>event.Action==='pass' && event.Test).map(event=>event.Test);
 if (!packages.size || !tests.length) return {status:'unverified',diagnostic:'no native dependency test evidence'};
 return {status:'pass',diagnostic:`${packages.size} dependency packages, ${new Set(tests).size} assertions passed`,tests,packages};
}
function hostTarget() { return `${platform()==='win32'?'windows':platform()}/${({x64:'amd64',ia32:'386'})[arch()]||arch()}`; }
export function validateFixtures(value) {
 if (!value || value.version!==1 || !value.scenarios || Object.keys(value).some(k=>!['version','scenarios'].includes(k))) throw new Error('invalid native fixture configuration');
 for (const [id,fixture] of Object.entries(value.scenarios)) {
  if (!requiredScenarios.includes(id) || !fixture || typeof fixture.command!=='string' || !fixture.command || !Array.isArray(fixture.args) || fixture.args.some(arg=>typeof arg!=='string') || Object.keys(fixture).some(k=>!['command','args'].includes(k))) throw new Error(`invalid fixture for ${id}`);
  if (fixture.args.some(arg=>/--(?:password|token|secret)(?:=|$)|[?&#](?:ticket|token|password)=|https?:\/\/[^/]*@/i.test(arg))) throw new Error('pass test secrets through the environment, never fixture command arguments');
 }
 return value;
}
export function fixtureEvidence(executed, id, digest, target, env={}) {
 if (executed.error?.code==='ENOENT') return {status:'unverified',diagnostic:'native fixture command is unavailable'};
 try {
  const value=JSON.parse(executed.stdout);
  if(value.id!==id || value.sha256!==digest || value.target!==target || !['pass','fail','unverified'].includes(value.status) || value.status==='pass' && executed.status!==0) throw new Error('fixture identity/status mismatch');
  return {status:value.status,diagnostic:redact(value.diagnostic||'native fixture assertions executed',env)};
 } catch { return {status:'fail',diagnostic:'fixture failed or returned invalid candidate evidence'}; }
}
export function checkPlatform({buildDirectory,reportPath,fixtures={version:1,scenarios:{}},base=root}, {run=spawnSync,nodeVersion=process.versions.node,nativeTarget=hostTarget(),environment=process.env}={}) {
 if (Number(nodeVersion.split('.')[0])!==24) throw new Error('native acceptance requires Node 24');
 fixtures=validateFixtures(fixtures);
 buildDirectory=resolve(buildDirectory);reportPath=resolve(reportPath);
 const metadata=JSON.parse(readFileSync(join(buildDirectory,'build.json'),'utf8'));
 if (metadata.version!==1 || metadata.program!=='piwork-cli' || metadata.target!==nativeTarget || !['piwork-cli','piwork-cli.exe'].includes(metadata.binary)) throw new Error('acceptance must run on the candidate native target');
 const binary=join(buildDirectory,metadata.binary);
 const digest=createHash('sha256').update(readFileSync(binary)).digest('hex');
 if (digest!==metadata.sha256 || desktopInputHash(base)!==metadata.desktopUIHash) throw new Error('candidate binary or Desktop build input differs; rebuild the candidate first');
 const env={...environment,GOTOOLCHAIN:'local',CGO_ENABLED:'0',GOOS:nativeTarget.split('/')[0],GOARCH:nativeTarget.split('/')[1],PIWORK_TEST_CLI_BINARY:binary,PIWORK_TEST_NATIVE_CLI:binary,PIWORK_TEST_CLI_SHA256:digest};
 const invoke=(command,args,timeout=300000)=>run(command,args,{cwd:base,env,encoding:'utf8',timeout,maxBuffer:32<<20,shell:false});
 const go=invoke('go',['env','GOVERSION']);if(go.status!==0||go.stdout.trim()!=='go1.25.5') throw new Error('native acceptance requires Go 1.25.5');
 const report={version:1,target:metadata.target,sha256:digest,commit:metadata.commit,goVersion:metadata.goVersion,desktopUIHash:metadata.desktopUIHash,environment:`${platform()} ${release()} ${arch()}`,startedAt:new Date().toISOString(),scenarios:requiredScenarios.map(id=>({id,status:'unverified',commands:[],diagnostic:'required native scenario has not been verified'}))};
 const scene=id=>report.scenarios.find(s=>s.id===id);
 const assign=(id,value,commands)=>Object.assign(scene(id),{...value,commands});
 // Package assertions execute repository code, so bind that code to the
 // candidate too. A dirty commit/UI stamp alone cannot detect Go edits made
 // after the candidate was built. Reproducible rebuilding must yield the same
 // native bytes before source assertions can qualify this binary.
 const sourceDirectory=mkdtempSync(join(tmpdir(),'piwork-cli-source-binding-'));
 let sourceMatches=false;
 try {
  const rebuilt=join(sourceDirectory,metadata.binary);
  const identity=JSON.stringify({releaseVersion:metadata.releaseVersion,commit:metadata.commit,modified:metadata.modified,desktopUIHash:metadata.desktopUIHash,target:metadata.target,goVersion:metadata.goVersion});
  const stamps=[`Version=${metadata.releaseVersion}`,`Commit=${metadata.commit}`,`Modified=${metadata.modified}`,`DesktopUIHash=${metadata.desktopUIHash}`].map(v=>'-X piwork/internal/buildinfo.'+v).join(' ')+` -X 'piwork/internal/buildinfo.ClientReleaseIdentity=piwork-cli-release-v1:${identity}'`;
  const built=invoke('go',['build','-mod=readonly','-trimpath','-buildvcs=true','-ldflags',stamps,'-o',rebuilt,'./cmd/piwork-cli']);
  sourceMatches=built.status===0 && createHash('sha256').update(readFileSync(rebuilt)).digest('hex')===digest;
 } finally { rmSync(sourceDirectory,{recursive:true,force:true}); }
 const listed=invoke('go',['list','-deps','-f','{{if .Module}}{{if eq .Module.Path "piwork"}}{{.ImportPath}}{{end}}{{end}}','./cmd/piwork-cli']);
 const packages=listed.status===0 ? [...new Set(listed.stdout.split(/\s+/).filter(Boolean))] : [];
 if (!sourceMatches || !packages.length || packages.includes('piwork/internal/consoleapp') || packages.includes('piwork/internal/consoleassets')) assign('client-dependencies',{status:'fail',diagnostic:sourceMatches?'client dependency discovery failed or included Console':'repository Go source does not reproduce this candidate; rebuild before acceptance'},['go build <candidate stamps>; compare SHA-256; go list -deps ./cmd/piwork-cli']);
 else {
  const args=['test','-mod=readonly','-json','-count=1','-timeout=3m',...packages];
  const tested=invoke('go',args);const evidence=testEvidence(tested.stdout||'',tested.status);
  const diagnostics=redact((tested.stderr||'')+'\n'+(tested.stdout||'').split(/\r?\n/).filter(line=>{try{return JSON.parse(line).Action==='fail';}catch{return true;}}).join('\n'),env).slice(-2000);
  assign('client-dependencies',{status:evidence.status,diagnostic:evidence.diagnostic+(evidence.status==='pass'?'':`; ${diagnostics}`)},['go test -mod=readonly -json <discovered client module dependencies>']);
  if (evidence.status==='pass') {
   const groups={
    'private-storage':[/^TestWindowsPrivateCreation|^TestPrivateWrite/,/^Test.*HardLink/],
    files:[/^TestFileIdentity/,/^TestSnapshotDownloadRejects/,/^TestSnapshotImportRejects/,/^TestDesktopTransferCleanupOnly/],auth:[/^TestLogoutConcurrentLoginProcesses/,/^TestFailedLoginPreserves/],
    symlink:nativeTarget.startsWith('windows/')?[/^TestWindowsRealSymlink/,/^TestTreeRefusesUnsafeData/]:[/^TestTreeRefusesUnsafeData/,/^TestArtifactEnvironment/],
    'desktop-control':nativeTarget.startsWith('windows/')?[/^TestDesktopControlHelperProcess/,/^TestWindowsDesktopControlRoundTrip/,/^TestWindowsDesktopControl.*Forged/,/^TestWindowsDesktopControl.*CrashResiduals/]:[/^TestDesktopControlHelperProcess/,/^TestDesktopControlResources/,/^TestDesktopControlRejectsUnsafe/,/^TestDesktopControlProtocolBounds/],
    interrupts:[/^TestPackageWaitInterrupt/,/^TestNativeDesktopEmbeddedProcess/,/^TestNativeProxyProcess/,/^TestChatNativeInterrupt/],
    'default-desktop':[/^TestDefaultDesktopDispatch/,/^TestDefaultDesktopEarlyReturns/],
    'preferences-storage':[/^TestDesktopPreferencesStrictFormat/,/^TestDesktopPreferencesNativeProcessContention/],
    'preferences-api':[/^TestDesktopPreferencesAPIIsOffline/,/^TestDesktopPreferencesAPIUnknownCommit/],
    'proxy-network':[/^TestNativeProxyProcess/,/^TestNativeProxyWebDAV/,/^TestNativeProxyWebSocket/],
   };
   for(const [id,patterns] of Object.entries(groups)) if(patterns.every(pattern=>evidence.tests.some(name=>pattern.test(name)))) assign(id,{status:'pass',diagnostic:'required assertions passed in native dependency suite'},['native client dependency test assertions']);
  }
 }
 const smoked=invoke('go',['run','-mod=readonly','scripts/check-cli-native.go','--build',buildDirectory,'--root',base],60000);
 if(smoked.status===0) {try {const value=JSON.parse(smoked.stdout);for(const item of value.scenarios||[]) if(item.id==='standalone-runtime' && item.status==='pass') assign(item.id,item,item.commands);}catch{assign('standalone-runtime',{status:'fail',diagnostic:'invalid native smoke output'},['Go candidate native process smoke']);}}
 else assign('standalone-runtime',{status:'fail',diagnostic:redact(smoked.stderr||'native smoke failed',env).slice(-2000)},['Go candidate native process smoke']);
 // External fixtures must execute assertions on this candidate. Missing user,
 // symlink or deployed-Core fixtures stay unverified; no local Core is started.
 for(const [id,fixture] of Object.entries(fixtures.scenarios)) {
  const executed=invoke(fixture.command,fixture.args,600000);
  let {status,diagnostic}=fixtureEvidence(executed,id,digest,nativeTarget,env);
  // A fixture cannot erase failure/skip evidence from built-in dependency tests.
  if(scene(id).status==='fail' || id==='client-dependencies' && scene(id).status==='unverified') diagnostic='built-in verification was not qualified; '+diagnostic,status=scene(id).status;
  assign(id,{status,diagnostic},[`${basename(fixture.command)} <${fixture.args.length} fixture arguments>`]);
 }
 if(createHash('sha256').update(readFileSync(binary)).digest('hex')!==digest) assign('standalone-runtime',{status:'fail',diagnostic:'candidate changed during acceptance'},['post-acceptance candidate SHA-256']);
 mkdirSync(dirname(reportPath),{recursive:true});writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
 return report;
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {
  const options={};const args=process.argv.slice(2);for(let i=0;i<args.length;i++){if(!['--build','--report','--fixtures'].includes(args[i])||!args[i+1])throw new Error('usage: check-cli-platform.mjs --build <directory> --report <path> [--fixtures <configuration>]');options[args[i].slice(2)]=args[++i];}
  if(!options.build||!options.report)throw new Error('--build and --report are required');
  const report=checkPlatform({buildDirectory:options.build,reportPath:options.report,...(options.fixtures?{fixtures:JSON.parse(readFileSync(options.fixtures,'utf8'))}:{})});
  for(const scenario of report.scenarios) process.stdout.write(`${scenario.id}: ${scenario.status}\n`);
  if(report.scenarios.some(s=>s.status!=='pass'))process.exitCode=1;
 }catch(error){process.stderr.write(redact(error.message)+'\n');process.exitCode=1;}
}
