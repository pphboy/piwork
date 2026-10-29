import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {expect} from '@playwright/test';

// Only the test installation's labelled Agent is inspected or seeded.
export async function chatRecoveryAcceptance({page,coreUrl,token,api,waitFor,dataDir}) {
 const call=async(method,path,body,status=200)=>{const result=await api(coreUrl,token,method,path,body);assert.equal(result.status,status,JSON.stringify(result.data));return result.data;};
 const created=await call('POST','/api/v1/works',{name:'Chat recovery fixture',skills:[],idempotencyKey:'chat-recovery-work'},202);
 await waitFor(async()=>{const operation=await call('GET','/api/v1/operations/'+created.operationId);if(operation.state==='failed')throw new Error(operation.error?.message);return operation.state==='succeeded';},'recovery Work ready',180000);
 const work=created.workId,path=`/api/v1/works/${work}`,session=(await call('POST',path+'/sessions',{idempotencyKey:'recovery-session'},201)).sessionId;
 const {installationId}=JSON.parse(await readFile(join(dataDir,'core-format.json'),'utf8'));
 const docker=args=>{const result=spawnSync('docker',args,{encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
 const agents=docker(['ps','-q','--filter',`label=piwork.installation_id=${installationId}`,'--filter',`label=piwork.work_id=${work}`,'--filter','label=piwork.resource_kind=agent']).split('\n').filter(Boolean);assert.equal(agents.length,1);
 const program=`import {WorkStore} from '/workspace/packages/work-store/dist/index.js';import {AgentSessionService} from '/workspace/apps/agentd/dist/sessions.js';import {appendUserMessage,appendAssistantMessage} from '/workspace/packages/pi-adapter/dist/index.js';const s=WorkStore.open('/var/data/work.sqlite');const work=${JSON.stringify(work)},session=${JSON.stringify(session)},sdk=new AgentSessionService(work,s,'/var/data/workspace','/var/data/sessions').continue(session);function accept(key,now){return s.acceptRun({workId:work,sessionId:session,submissionKey:key,requestDigest:key,promptDigest:key,now}).run}const old=accept('old','2026-01-01T00:00:01.000Z');sdk.appendCustomEntry('piwork-run',{runId:old.runId});appendUserMessage(sdk,'earlier question');s.appendEvent(old.runId,'text',JSON.stringify({delta:'partial preserved'}));s.completeRun(old.runId,'cancelled',null,null);s.compactRunEvents(old.runId,1);for(const [prompt,answer,now] of [['1','answer one','2026-01-01T00:00:02.000Z'],['4','answer four','2026-01-01T00:00:03.000Z']]){const r=accept(prompt,now);sdk.appendCustomEntry('piwork-run',{runId:r.runId});appendUserMessage(sdk,prompt);appendAssistantMessage(sdk,answer);s.completeRun(r.runId,'succeeded',answer,null)}console.log(JSON.stringify({old:old.runId}));s.close();`;
 const {old}=JSON.parse(docker(['exec','--user','10001:10001',agents[0],'node','--no-warnings','--input-type=module','-e',program]));
 await page.goto(new URL(`/#/work/${work}`,page.url()).href);
 await expect(page.getByRole('heading',{name:'Chat recovery fixture',exact:true})).toBeVisible({timeout:30000});
 await expect(page.locator('#messages')).toContainText('partial preserved');
 const observed=await page.locator('#messages .message').evaluateAll(nodes=>nodes.map(node=>node.querySelector('.message-text')?.textContent?.trim()).filter(Boolean));
 assert.deepEqual(observed,['earlier question','partial preserved','1','answer one','4','answer four']);
 const statuses=[];const mutations=[];
 const responseObserver=response=>{if(new URL(response.url()).pathname.endsWith(`/runs/${old}/events`))statuses.push(response.status());};
 const requestObserver=request=>{if(request.method()==='POST'&&new URL(request.url()).pathname.startsWith(`/_desktop/api/works/${work}/`))mutations.push(request.url());};
 page.on('response',responseObserver);page.on('request',requestObserver);
 try {
  const state=await page.evaluate(async({work,old})=>{const {adapter}=await import('/desktop/browser/adapter.js');const run=await adapter.loadRunDetails(work,old);run.status='running';run.cursor=0;adapter.getWork(work).run=run;await adapter.resumeRun(work);return {status:run.status,error:run.error};},{work,old});
  assert.ok(statuses.includes(416),'the real Core did not expire the compacted cursor');assert.equal(state.status,'cancelled');assert.equal(state.error,undefined);assert.deepEqual(mutations,[]);
  await expect(page.locator('#messages')).toContainText('partial preserved');
  const after=await page.locator('#messages .message').evaluateAll(nodes=>nodes.map(node=>node.querySelector('.message-text')?.textContent?.trim()).filter(Boolean));
  assert.deepEqual(after,observed);
 } finally {page.off('response',responseObserver);page.off('request',requestObserver);}
 console.log('Chat recovery: cancelled turn, 1 and 4 stay ordered and real 416 restores partial output without mutation');
}

// Exercise the old whole-Session fallback against a real schema-4 Agent. The
// already-seen reply is seeded only into the isolated browser, just as it would
// be after observing a stream whose event cursor was subsequently compacted.
export async function chatLegacyRecoveryAcceptance({page,coreUrl,token,api,waitFor,dataDir}) {
 const call=async(method,path,body,status=200)=>{const result=await api(coreUrl,token,method,path,body);assert.equal(result.status,status,JSON.stringify(result.data));return result.data;};
 const created=await call('POST','/api/v1/works',{name:'Legacy chat recovery fixture',skills:[],idempotencyKey:'legacy-recovery-work'},202);
 await waitFor(async()=>{const operation=await call('GET','/api/v1/operations/'+created.operationId);if(operation.state==='failed')throw new Error(operation.error?.message);return operation.state==='succeeded';},'legacy Work ready',180000);
 const work=created.workId,path=`/api/v1/works/${work}`,session=(await call('POST',path+'/sessions',{idempotencyKey:'legacy-recovery-session'},201)).sessionId;
 const capability=await api(coreUrl,token,'GET',path+'/history-capabilities');assert.ok([404,501].includes(capability.status),'fixture must use the old history contract');
 const {installationId}=JSON.parse(await readFile(join(dataDir,'core-format.json'),'utf8'));
 const docker=args=>{const result=spawnSync('docker',args,{encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
 const agents=docker(['ps','-q','--filter',`label=piwork.installation_id=${installationId}`,'--filter',`label=piwork.work_id=${work}`,'--filter','label=piwork.resource_kind=agent']).split('\n').filter(Boolean);assert.equal(agents.length,1);
 const program=`import {WorkStore} from '/workspace/packages/work-store/dist/index.js';import {AgentSessionService} from '/workspace/apps/agentd/dist/sessions.js';import {appendUserMessage} from '/workspace/packages/pi-adapter/dist/index.js';const s=WorkStore.open('/var/data/work.sqlite'),work=${JSON.stringify(work)},session=${JSON.stringify(session)};const sdk=new AgentSessionService(work,s,'/var/data/workspace','/var/data/sessions').continue(session),run=s.acceptRun({workId:work,sessionId:session,submissionKey:'legacy-partial',requestDigest:'fixture',promptDigest:'fixture'}).run;sdk.appendCustomEntry('piwork-run',{runId:run.runId});appendUserMessage(sdk,'Legacy question');s.appendEvent(run.runId,'text',JSON.stringify({delta:'Legacy partial reply'}));s.completeRun(run.runId,'cancelled',null,null);s.compactRunEvents(run.runId,1);console.log(JSON.stringify({run:run.runId,schema:s.schemaVersion}));s.close();`;
 const seeded=JSON.parse(docker(['exec','--user','10001:10001',agents[0],'node','--no-warnings','--input-type=module','-e',program]));assert.equal(seeded.schema,4);
 await page.goto(new URL(`/#/work/${work}`,page.url()).href);
 await expect(page.getByRole('heading',{name:'Legacy chat recovery fixture',exact:true})).toBeVisible({timeout:30000});
 await expect(page.locator('#messages')).toContainText('Legacy question');
 const statuses=[],mutations=[];
 const responseObserver=response=>{if(new URL(response.url()).pathname.endsWith(`/runs/${seeded.run}/events`))statuses.push(response.status());};
 const requestObserver=request=>{if(request.method()==='POST'&&new URL(request.url()).pathname.startsWith(`/_desktop/api/works/${work}/`))mutations.push(request.url());};
 page.on('response',responseObserver);page.on('request',requestObserver);
 try {
  const state=await page.evaluate(async({work,session,runId})=>{const {adapter}=await import('/desktop/browser/adapter.js');const workView=adapter.getWork(work),target=workView.sessions.find(item=>item.id===session);target.messages.push({id:`${runId}-text-1`,runId,role:'assistant',text:'Legacy partial reply'});const run=await adapter.loadRunDetails(work,runId);run.status='running';run.cursor=0;workView.run=run;await adapter.resumeRun(work);return {status:run.status,messages:target.messages.map(({runId,text,historyRecoveryUnconfirmed})=>({runId,text,historyRecoveryUnconfirmed}))};},{work,session,runId:seeded.run});
  assert.ok(statuses.includes(416),'real Core did not expire the legacy cursor');assert.equal(state.status,'cancelled');
  assert.ok(state.messages.some(message=>message.runId===seeded.run&&message.text==='Legacy partial reply'&&message.historyRecoveryUnconfirmed));
  assert.deepEqual(mutations,[]);await expect(page.locator('#messages')).toContainText('Legacy partial reply');
 } finally {page.off('response',responseObserver);page.off('request',requestObserver);}
 console.log('Legacy chat recovery: real schema-4 Agent keeps observed text after Core 416 without mutation');
}
