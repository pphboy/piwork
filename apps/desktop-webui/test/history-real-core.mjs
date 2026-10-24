import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {expect} from '@playwright/test';

export async function historyAcceptance({page,coreUrl,uiUrl,token,api,waitFor,cliBinary,clientConfig,dataDir}) {
 const call=async(method,path,body,status=200)=>{const result=await api(coreUrl,token,method,path,body);assert.equal(result.status,status,JSON.stringify(result.data));return result.data;};
 const created=await call('POST','/api/v1/works',{name:'Large history acceptance',skills:[],idempotencyKey:'large-history-work'},202);
 await waitFor(async()=>{const operation=await call('GET','/api/v1/operations/'+created.operationId);if(operation.state==='failed')throw new Error(operation.error?.message);return operation.state==='succeeded';},'history Work ready',180000);
 const work=created.workId,path=`/api/v1/works/${work}`,session=(await call('POST',path+'/sessions',{idempotencyKey:'history-session'},201)).sessionId;
 const {installationId}=JSON.parse(await readFile(join(dataDir,'core-format.json'),'utf8'));
 const docker=args=>{const result=spawnSync('docker',args,{encoding:'utf8',maxBuffer:128*1024*1024});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
 const containers=docker(['ps','-q','--filter',`label=piwork.installation_id=${installationId}`,'--filter',`label=piwork.work_id=${work}`,'--filter','label=piwork.resource_kind=agent']).split('\n').filter(Boolean);assert.equal(containers.length,1);
 const program=`import {WorkStore} from '/workspace/packages/work-store/dist/index.js';import {AgentSessionService} from '/workspace/apps/agentd/dist/sessions.js';import {populateLongHistory} from '/workspace/apps/agentd/dist/history-fixture.js';const s=WorkStore.open('/var/data/work.sqlite');const work=${JSON.stringify(work)},session=${JSON.stringify(session)};const sdk=new AgentSessionService(work,s,'/var/data/workspace','/var/data/sessions').continue(session);const run=s.acceptRun({workId:work,sessionId:session,submissionKey:'seed',requestDigest:'fixture',promptDigest:'fixture'}).run;const expected=populateLongHistory(sdk,run.runId,7*1024*1024);s.completeRun(run.runId,'succeeded',expected.finalText,null);console.log(JSON.stringify({run:run.runId}));s.close();`;
 const {run}=JSON.parse(docker(['exec','--user','10001:10001',containers[0],'node','--no-warnings','--input-type=module','-e',program]));
 const cli=spawnSync(cliBinary,['--core',coreUrl,'--json','session','show',work,session],{encoding:'utf8',maxBuffer:128*1024*1024,env:{...process.env,PATH:'/nonexistent',PIWORK_CONFIG_PATH:clientConfig}});assert.equal(cli.status,0,cli.stderr);const output=JSON.parse(cli.stdout);assert.equal(output.messages.length,454);assert.equal(output.runs[0].finalText.length,7*1024*1024);
 const inspect=async(target,label)=>{
  const reads=[],writes=[];target.on('request',request=>{const url=new URL(request.url());if(url.pathname.startsWith('/_desktop/api/works/'+work+'/')){if(request.method()==='GET')reads.push(url);else writes.push(url);}});
  await target.goto(new URL(`/#/work/${work}`,label==='hosted'?uiUrl:target.url()).href);
  if(label==='hosted'){await target.getByRole('textbox',{name:'Account',exact:true}).fill('admin');await target.getByLabel('Password').fill('real-browser-admin-password');await target.getByRole('button',{name:'Sign in',exact:true}).click();await expect(target.getByRole('heading',{name:'Works',exact:true})).toBeVisible();await target.goto(new URL(`/#/work/${work}`,uiUrl).href);}
  await expect(target.getByRole('heading',{name:'Large history acceptance',exact:true})).toBeVisible({timeout:30000});
  await expect(target.locator('[data-action=load-earlier-history]')).toBeVisible();
  assert.ok(reads.some(url=>url.pathname.endsWith('/history')));assert.ok(!reads.some(url=>url.pathname.endsWith('/sessions/'+session)));assert.ok(!reads.some(url=>url.searchParams.has('cursor')));
  await target.locator('#composer').fill('Keep history draft');await target.locator('#messages').evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
  await target.locator('[data-action=load-earlier-history]').click();await expect(target.locator('[data-action=load-earlier-history]')).toBeEnabled();await expect(target.locator('#composer')).toHaveValue('Keep history draft');assert.ok(reads.some(url=>url.searchParams.has('cursor')));
  const detail=await target.evaluate(async({work,run})=>{const {adapter}=await import('/desktop/browser/adapter.js');const value=await adapter.loadRunDetails(work,run);return value.finalText.length;},{work,run});assert.equal(detail,7*1024*1024);assert.equal(writes.length,0);
  console.log(`history ${label}: 454 messages, recent page + explicit earlier page, 7 MiB result, no whole Session read or mutation`);
 };
 await inspect(page,'desktop');const hosted=await page.context().newPage();try{await inspect(hosted,'hosted');}finally{await hosted.close();}
}
