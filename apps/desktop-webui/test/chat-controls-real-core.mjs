import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createReadStream } from 'node:fs';
import { stat, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expect } from '@playwright/test';

// Uses the owning real-core fixture's isolated installation and exact cleanup.
export async function chatControlsAcceptance({page,coreUrl,token,api,waitFor,cliBinary,clientConfig,repositoryRoot,image,screenshotDir,fixtureRoot}) {
  await page.setViewportSize({width:1440,height:1000});
  const call=async(method,path,body,status=200)=>{const result=await api(coreUrl,token,method,path,body);assert.equal(result.status,status,JSON.stringify(result.data));return result.data;};
  const operation=async receipt=>waitFor(async()=>{const value=await call('GET',`/api/v1/operations/${receipt.operationId}`);if(value.state==='failed')throw new Error(value.error?.message || 'Operation failed');return value.state==='succeeded';},'original Operation',180000);
  const created=await call('POST','/api/v1/works',{name:'Chat controls acceptance',skills:[],idempotencyKey:'chat-controls-work'},202);await operation(created);
  const id=created.workId,path=`/api/v1/works/${id}`;
  const install=spawnSync(cliBinary,['--core',coreUrl,'work','packages','install',id,join(repositoryRoot,'fixtures/pi-packages/chat-controls'),'--wait'],{encoding:'utf8',env:{...process.env,PATH:'/nonexistent',PIWORK_CONFIG_PATH:clientConfig}});
  assert.equal(install.status,0,install.stderr);
  await operation(await call('POST',path+'/configuration/apply',{idempotencyKey:'chat-controls-apply'},202));
  const capabilities=await call('GET',path+'/chat-capabilities');assert.equal(capabilities.cancelAndSendContractVersion,1);
  const makeSession=async key=>(await call('POST',path+'/sessions',{idempotencyKey:key},201)).sessionId;
  const submit=async(sessionId,prompt,key)=>(await call('POST',path+'/runs',{sessionId,prompt,submissionKey:key,inputMode:'text'},202)).run;
  const settled=async runId=>waitFor(async()=>{const run=await call('GET',path+'/runs/'+runId);return run.state>=4?run:false;},'actual Run settled',30000);
  const file=async(name,method,body)=>{const response=await fetch(coreUrl+path+'/files/'+name,{method,headers:{Authorization:'Bearer '+token},body});assert.ok([200,201,204].includes(response.status),`${method} fixture file: ${response.status}`);};
  console.log('Chat controls: fixture ready');
  const main=await makeSession('chat-controls-main');await settled((await submit(main,'identify current model','chat-controls-initial')).runId);
  const serviceScript=String.raw`const fs=require('node:fs'),http=require('node:http'),https=require('node:https');
const c=JSON.parse(fs.readFileSync('/etc/piwork/interaction/config.json','utf8'));
fs.mkdirSync('/var/data/workspace/.pi/services',{recursive:true});fs.writeFileSync('/var/data/workspace/.pi/services/controls-service.json',JSON.stringify({contractVersion:1,serviceName:'controls-service',apiPortName:'web',mode:'pi-managed'}));
let count=0;
http.createServer((req,res)=>{
 if(req.url==='/health'){res.end('ok');return;}
 if(req.url==='/pi/v1/capabilities'){if(req.headers.authorization!=='Bearer '+c.token){res.writeHead(401);res.end('{}');return;}res.setHeader('content-type','application/json');res.end(JSON.stringify({contractVersion:1,logicalServiceName:c.serviceName,codeVersion:'fixture-code',stateVersion:'fixture-state',queries:{},actions:{},events:{facts:[],requestReasons:['report']},jobs:false}));return;}
 if(req.url.startsWith('/emit')){const event={contractVersion:1,eventId:'chat-controls-event-'+(++count),origin:{workId:c.workId,serviceId:c.serviceId},serviceName:c.serviceName,type:'agent.requested',occurredAt:new Date().toISOString(),stateVersion:'fixture-state',actor:'user',payload:{reason:'report',goal:req.url.includes('quick')?'Return a short report for visibility verification':'wait for abort: requested report '+count,evidenceRefs:[]}};
 const body=JSON.stringify(event);const r=https.request(c.agentUrl+'/pi/v1/events',{method:'POST',agent:false,ca:fs.readFileSync(c.caPath),headers:{authorization:'Bearer '+c.token,'content-type':'application/json'}},rr=>{let data=[];rr.on('data',x=>data.push(x));rr.on('end',()=>{res.writeHead(rr.statusCode);res.end(Buffer.concat(data));});});r.on('error',()=>{res.writeHead(503);res.end('{}');});r.end(body);return;}
 res.setHeader('content-type','text/html');res.end('<h1>Chat controls Service</h1><input aria-label="Service draft"><button onclick="fetch(\'/emit\').then(r=>r.json()).then(v=>document.querySelector(\'output\').textContent=JSON.stringify(v))">Request Agent</button><output></output>');
}).listen(8099,'0.0.0.0');`;
  const service=await call('POST',path+'/services',{definition:{name:'controls-service',image:{reference:image},command:'node',args:['-e',serviceScript],mounts:[{source:'workspace',target:'/var/data/workspace',readOnly:false}],ports:[{name:'web',protocol:'tcp',containerPort:8099}],readiness:{kind:'http',portName:'web',path:'/health',deadlineMs:10000}},idempotencyKey:'chat-controls-service'},202);await operation(service);
  await page.evaluate(id=>{location.hash='/work/'+id;},id);await expect(page.getByRole('heading',{name:'Chat controls acceptance',exact:true})).toBeVisible();
  const frame=page.frameLocator('iframe');await expect(frame.getByRole('heading',{name:'Chat controls Service'})).toBeVisible();await frame.getByLabel('Service draft').fill('Keep Service state');
  await expect(page.locator('[data-action=service-requests]')).toHaveCount(0);
  await page.locator('#composer').fill('Keep Main draft');await page.evaluate(()=>{window.controlsFrame=document.querySelector('iframe');window.controlsLoads=0;window.controlsFrame.addEventListener('load',()=>window.controlsLoads++);});
  await frame.getByRole('button',{name:'Request Agent'}).click();
  await expect(page.locator('[data-action=service-requests]')).toBeVisible({timeout:15000});
  const requests=await call('GET',path+'/agent-requests?serviceName=controls-service&limit=25');assert.equal(requests.items.length,1);const requestId=requests.items[0].requestId;
  await waitFor(async()=>(await call('GET',path+'/agent-requests/'+requestId)).request.state==='running','Service Run');
  await page.locator('[data-action=service-requests]').click();await expect(page.locator('#pi-service-filter')).toHaveValue('controls-service');await page.locator('[data-action=pi-request-detail]').click();await expect(page.locator('#modal h2')).toHaveText('Agent request');
  await expect(page.locator('#modal')).toContainText('wait for abort: requested report 1');
  await page.locator('[data-action=back-pi-requests]').click();await expect(page.locator('#pi-service-filter')).toHaveValue('controls-service');
  await page.locator(`[data-action=pi-request-detail][data-id="${requestId}"]`).click();await file('chat-controls-hold','PUT','hold');
  await page.locator('#modal [data-action=cancel-pi-request]').click();await expect(page.locator('#modal')).toContainText(/cancelling/i);
  await waitFor(async()=>{const r=await fetch(coreUrl+path+'/files/chat-controls-shutdown',{headers:{Authorization:'Bearer '+token}});return r.ok;},'original request cancellation SDK shutdown held');
  await file('chat-controls-hold','DELETE');
  await waitFor(async()=>(await call('GET',path+'/agent-requests/'+requestId)).request.state==='cancelled','cancelled Service request');
  await expect(page.locator('#modal')).toContainText(/cancelled/i,{timeout:15000});
  await page.locator('#modal .modal-footer [data-action=close-modal]').click();await file('chat-controls-shutdown','DELETE');
  await expect(page.locator('#composer')).toHaveValue('Keep Main draft');assert.equal(await page.evaluate(()=>window.controlsFrame===document.querySelector('iframe') && window.controlsLoads===0),true);await expect(frame.getByLabel('Service draft')).toHaveValue('Keep Service state');
  console.log('Chat controls: Service visibility and cancellation passed');
  const sendReplacement=async old=>{
    await expect(page.locator('[data-action=send-message]')).toHaveAttribute('data-cancel-run-id',old.runId,{timeout:15000});await expect(page.getByRole('button',{name:'Stop and send',exact:true})).toBeEnabled();await page.locator('#composer').fill('identify current model');
    const response=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/runs') && r.request().method()==='POST');
    await page.getByRole('button',{name:'Stop and send',exact:true}).click();const result=await response;assert.equal(result.status(),202,await result.text());
    const input=result.request().postDataJSON(),run=(await result.json()).run;assert.equal(input.cancelRunId,old.runId);assert.equal(input.sessionId,main);assert.equal(run.sessionId,main);assert.notEqual(run.runId,old.runId);
    assert.equal((await settled(old.runId)).state,6);assert.equal((await settled(run.runId)).state,4);
    assert.equal((await call('GET',path+'/runs/submissions/'+input.submissionKey)).run.runId,run.runId);return {run,key:input.submissionKey};
  };
  const other=await makeSession('chat-controls-other'),old=await submit(other,'wait for abort','chat-controls-old');const replacement=await sendReplacement(old);
  await frame.getByRole('button',{name:'Request Agent'}).click();const second=await waitFor(async()=>{const page=await call('GET',path+'/agent-requests?serviceName=controls-service&limit=25');return page.items.find(r=>r.requestId!==requestId && r.state==='running');},'second Service request');
  const automatic=await call('GET',path+'/runs/'+second.runIds[0]);await sendReplacement(automatic);assert.equal((await call('GET',path+'/agent-requests/'+second.requestId)).request.state,'cancelled');
  console.log('Chat controls: cross-Session and Service replacement passed');
  // Read a genuine automatic reply, then fail only the browser's refresh.
  await frame.locator('body').evaluate(()=>fetch('/emit?quick=1').then(r=>r.json()));
  const answered=await waitFor(async()=>{const items=(await call('GET',path+'/agent-requests?serviceName=controls-service&limit=25')).items;return items.find(r=>!r.goal.includes('wait for abort')&&['completed','failed','needs_attention'].includes(r.state));},'automatic report result',30000);
  const answeredRun=await call('GET',path+'/runs/'+answered.runIds.at(-1));assert.ok(answeredRun.finalText);
  await page.locator('[data-action=service-requests]').click();await page.locator(`[data-action=pi-request-detail][data-id="${answered.requestId}"]`).click();
  await expect(page.locator('#modal')).toContainText(answeredRun.finalText);
  // History-capable Desktop appends responseProfile to this read.
  const replyPath=`**/_desktop/api/works/${id}/runs/${answeredRun.runId}*`;
  await page.route(replyPath,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'RUNTIME_UNAVAILABLE',message:'Acceptance refresh unavailable'})}));
  await page.locator('#modal .modal-footer [data-action=pi-request-detail]').click();
  await expect(page.locator('#modal')).toContainText('reply refresh failed');await expect(page.locator('#modal')).toContainText(answeredRun.finalText);await expect(page.locator('#modal')).toContainText('Last confirmed');
  await page.unroute(replyPath);await page.locator('#modal .modal-footer [data-action=pi-request-detail]').click();await expect(page.locator('#modal')).not.toContainText('reply refresh failed');
  await page.locator('[data-action=back-pi-requests]').click();await page.locator('#modal .modal-footer [data-action=close-modal]').click();
  console.log('Chat controls recovery: real reply retained across browser 503');

  // The Retry is accepted by the real Core/Agentd; only its local receipt is lost.
  assert.ok(['failed','needs_attention'].includes(answered.state));
  await page.getByRole('button',{name:'Pi requests for this Work',exact:true}).click();await page.locator(`[data-action=pi-request-detail][data-id="${answered.requestId}"]`).click();
  let retryKey='',retryPosts=0,retryGets=0;
  const retryPath=`**/_desktop/api/works/${id}/agent-requests/${answered.requestId}/retry`;
  page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/retry-submission'))retryGets++;});
  let retryReceiptError='';
  await page.route(retryPath,async route=>{
    retryPosts++;retryKey=route.request().postDataJSON().submissionKey;
    try {
      const originalUrl=new URL(route.request().url()),localUrl=new URL(originalUrl);
      localUrl.hostname='127.0.0.1';
      const headers=await route.request().allHeaders();headers.host=originalUrl.host;
      const receipt=await route.fetch({url:localUrl.href,headers});
      if(receipt.status()!==200)retryReceiptError=`Real Retry receipt status ${receipt.status()}`;
    } catch(error){retryReceiptError=error.message.split('\n')[0];}
    await route.abort('failed').catch(()=>undefined);
  });
  await page.locator('[data-action=retry-pi-request]').click();await expect(page.locator('#modal')).toContainText('response was lost');assert.equal(retryReceiptError,'');
  const retried=await waitFor(async()=>{const items=(await call('GET',path+'/agent-requests?serviceName=controls-service&limit=25')).items;return items.find(r=>r.retryOf===answered.requestId&&['completed','failed','cancelled','needs_attention'].includes(r.state));},'legitimate Retry phases finished',30000);
  const beforeLookup=(await call('GET',path+'/agent-requests?serviceName=controls-service&limit=25')).items;
  await page.locator('#modal .modal-footer [data-action=pi-request-detail]').click();await expect(page.locator('#modal .request-evidence')).toContainText(retried.requestId);
  const lookup=await call('GET',path+'/agent-requests/'+answered.requestId+'/retry-submission?submissionKey='+retryKey);
  assert.equal(lookup.status,'accepted');assert.equal(lookup.request.requestId,retried.requestId);assert.equal(lookup.request.retryOf,answered.requestId);
  assert.equal(retryPosts,1);assert.equal(retryGets,1);
  const afterLookup=(await call('GET',path+'/agent-requests?serviceName=controls-service&limit=25')).items;assert.deepEqual(afterLookup,beforeLookup);
  assert.equal((await call('GET',path+'/agent-requests/'+answered.requestId+'/retry-submission?submissionKey=missing')).status,'not-found');
  await call('GET',path+'/agent-requests/'+requestId+'/retry-submission?submissionKey='+retryKey,undefined,409);
  await page.unroute(retryPath);
  await page.locator('[data-action=back-pi-requests]').click();await page.locator('#modal .modal-footer [data-action=close-modal]').click();
  console.log('Chat controls recovery: accepted lost Retry located by original key without new writes');

  await page.locator('#composer').fill('chat-controls-fail-manual');
  const failedResponse=page.waitForResponse(r=>new URL(r.url()).pathname===`/_desktop/api/works/${id}/runs` && r.request().method()==='POST');
  await page.locator('[data-action=send-message]').click();
  const failedReceipt=await failedResponse;assert.equal(failedReceipt.status(),202,await failedReceipt.text());
  const failedManual=(await failedReceipt.json()).run;
  const failedResult=await settled(failedManual.runId);assert.equal(failedResult.state,5);assert.ok(failedResult.error?.message);
  await page.evaluate(async({id,main})=>{const {adapter}=await import('/desktop/browser/adapter.js');await adapter.loadSession(id,main);},{id,main});
  await frame.getByRole('button',{name:'Request Agent'}).click();
  const background=await waitFor(async()=>{const items=(await call('GET',path+'/agent-requests?serviceName=controls-service&limit=25')).items;return items.find(r=>r.state==='running');},'background while manual failure');
  await expect(page.locator('[data-action=send-message]')).toHaveAttribute('data-cancel-run-id',background.runIds.at(-1),{timeout:15000});
  await expect(page.locator('.message-execution').filter({has:page.locator(`[data-action=run-details][data-run-id="${failedManual.runId}"]`)})).toContainText(failedResult.error.message);
  await expect(page.locator(`[data-action=run-details][data-run-id="${failedManual.runId}"]`)).toHaveAttribute('data-run-id',failedManual.runId);
  await page.locator(`[data-action=run-details][data-run-id="${failedManual.runId}"]`).click();await expect(page.locator('#modal')).toContainText(failedManual.runId);
  await page.locator('#modal .modal-footer [data-action=close-modal]').click();
  // Expire only the browser event read. Original Run/Session data still comes
  // from the real Core/Agentd, including the actual execution failure.
  const expiredEvents=`**/_desktop/api/works/${id}/runs/${failedManual.runId}/events?*`;
  let expiredReads=0,historyWrites=0,originalRunReads=0,originalSessionReads=0;
  const observeWrites=request=>{
    const pathname=new URL(request.url()).pathname;
    if(request.method()==='POST'&&pathname.startsWith(`/_desktop/api/works/${id}/`))historyWrites++;
    if(request.method()==='GET'&&pathname===`/_desktop/api/works/${id}/runs/${failedManual.runId}`)originalRunReads++;
    if(request.method()==='GET'&&(pathname===`/_desktop/api/works/${id}/sessions/${main}` || pathname===`/_desktop/api/works/${id}/sessions/${main}/history`))originalSessionReads++;
  };
  page.on('request',observeWrites);
  await page.route(expiredEvents,route=>{expiredReads++;return route.fulfill({status:410,contentType:'application/json',body:JSON.stringify({code:'EVENT_CURSOR_EXPIRED'})});});
  try {
    const recovered=await page.evaluate(async({id,runId})=>{
      const {adapter}=await import('/desktop/browser/adapter.js');
      // Establish the interrupted original observer from its real readback.
      // The browser may currently be observing the newer background Service.
      const run=await adapter.loadRunDetails(id,runId);
      if(!run||run.id!==runId)throw new Error('Original failed Run was not confirmed');
      adapter.getWork(id).run=run;
      run.historyRecovery=false;await adapter.resumeRun(id);
      return{runId:run.id,error:run.error,activeId:adapter.activeRuns.get(id)?.run?.id};
    },{id,runId:failedManual.runId});
    assert.deepEqual(recovered,{runId:failedManual.runId,error:failedResult.error.message,activeId:background.runIds.at(-1)});
    await expect(page.locator('.message-execution').filter({has:page.locator(`[data-action=run-details][data-run-id="${failedManual.runId}"]`)})).toContainText(failedResult.error.message);
    await expect(page.locator(`[data-action=run-details][data-run-id="${failedManual.runId}"]`)).toHaveAttribute('data-run-id',failedManual.runId);
    await expect(page.locator('[data-action=send-message]')).toHaveAttribute('data-cancel-run-id',background.runIds.at(-1));
    assert.equal(expiredReads,1);assert.equal(historyWrites,0);
    assert.ok(originalRunReads>=2,'Original Run was not read again after 410');
    assert.ok(originalSessionReads>=1,'Original Session history was not read after 410');
  } finally {
    page.off('request',observeWrites);await page.unroute(expiredEvents);
  }
  console.log('Chat controls recovery: real failed Run retains execution error after readonly 410 history recovery');
  await call('POST',path+'/agent-requests/'+background.requestId+'/cancel',{});
  await waitFor(async()=>(await call('GET',path+'/agent-requests/'+background.requestId)).request.state==='cancelled','background cancelled');
  assert.equal(await page.evaluate(()=>window.controlsFrame===document.querySelector('iframe') && window.controlsLoads===0),true);
  await expect(frame.getByLabel('Service draft')).toHaveValue('Keep Service state');
  console.log('Chat controls recovery: original failed Chat remains visible beside active Service');

  // A real SDK extension deliberately holds shutdown after the model has returned.

  await file('chat-controls-hold','PUT','hold');const hanging=await submit(other,'identify current model','chat-controls-hanging');
  await waitFor(async()=>{const r=await fetch(coreUrl+path+'/files/chat-controls-shutdown',{headers:{Authorization:'Bearer '+token}});return r.ok;},'SDK shutdown held');
  await expect(page.locator('[data-action=send-message]')).toHaveAttribute('data-cancel-run-id',hanging.runId,{timeout:15000});await expect(page.getByRole('button',{name:'Stop and send',exact:true})).toBeEnabled();await page.locator('#composer').fill('Timeout draft');
  const response=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/runs') && r.request().method()==='POST'),start=Date.now();
  await page.getByRole('button',{name:'Stop and send',exact:true}).click();const timeout=await response,elapsed=Date.now()-start;
  assert.equal(timeout.status(),409);assert.equal((await timeout.json()).code,'CANCEL_TIMEOUT');assert.ok(elapsed>=4900&&elapsed<10000,`Cancellation wait ${elapsed}ms`);
  const unknownKey=timeout.request().postDataJSON().submissionKey;assert.equal((await call('GET',path+'/runs/active')).run.runId,hanging.runId);assert.equal((await call('GET',path+'/runs/'+hanging.runId)).state,3);await expect(page.locator('#composer')).toHaveValue('Timeout draft');
  await file('chat-controls-hold','DELETE');assert.equal((await settled(hanging.runId)).state,6);assert.equal((await call('GET',path+'/runs/submissions/'+unknownKey)).status,'not-found');
  await new Promise(resolve=>setTimeout(resolve,5500));assert.equal((await call('GET',path+'/runs/active')).run,null);assert.equal((await call('GET',path+'/runs/submissions/'+unknownKey)).status,'not-found');
  const finalRequests=(await call('GET',path+'/agent-requests?serviceName=controls-service&limit=25')).items;assert.equal(finalRequests.length,5);assert.ok(finalRequests.filter(r=>[requestId,second.requestId].includes(r.requestId)).every(r=>r.state==='cancelled'&&r.runIds.length===1));
  await page.screenshot({path:join(screenshotDir,'chat-controls-timeout.png'),fullPage:true});
  await operation(await call('POST',path+'/stop',{idempotencyKey:'chat-controls-stop'},202));
  console.log('Chat controls: cancellation timeout passed; exporting history');
  const archive=join(fixtureRoot,'chat-controls.work');
  const exported=spawnSync(cliBinary,['--core',coreUrl,'work','export',id,'--output',archive,'--idempotency-key','chat-controls-export'],{encoding:'utf8',env:{...process.env,PATH:'/nonexistent',PIWORK_CONFIG_PATH:clientConfig}});assert.equal(exported.status,0,exported.stderr);
  const hash=createHash('sha256');for await(const chunk of createReadStream(archive))hash.update(chunk);
  const uploadedResponse=await fetch(coreUrl+'/api/v1/work-packages',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/vnd.piwork.work-package','Content-Length':String((await stat(archive)).size),'X-Piwork-SHA256':hash.digest('hex')},body:createReadStream(archive),duplex:'half'});assert.ok([200,201].includes(uploadedResponse.status));const uploaded=await uploadedResponse.json();
  const imported=await call('POST','/api/v1/work-imports',{packageId:uploaded.packageId,name:'Imported Chat controls',idempotencyKey:'chat-controls-import'},202);await operation(imported);
  const importedPath='/api/v1/works/'+imported.workId;assert.equal((await call('GET',importedPath)).observedState,'stopped');
  await operation(await call('POST',importedPath+'/start',{idempotencyKey:'chat-controls-import-start'},202));
  assert.equal((await call('GET',importedPath+'/runs/active')).run,null);
  for(const run of [old,hanging])assert.equal((await call('GET',importedPath+'/runs/'+run.runId)).state,6);
  assert.equal((await call('GET',importedPath+'/runs/submissions/'+replacement.key)).run.runId,replacement.run.runId);
  assert.equal((await call('GET',importedPath+'/runs/submissions/'+unknownKey)).status,'not-found');
  const replay=await call('POST',importedPath+'/runs',{sessionId:main,prompt:'identify current model',inputMode:'text',cancelRunId:old.runId,submissionKey:replacement.key},202);assert.equal(replay.run.runId,replacement.run.runId);assert.equal(replay.reused,true);
  const historical=(await call('GET',importedPath+'/agent-requests?serviceName=controls-service&limit=25')).items;assert.equal(historical.length,finalRequests.length);assert.ok(historical.every(r=>r.disposition==='historical'));
  for(const original of finalRequests)assert.equal(historical.find(r=>r.requestId===original.requestId).state,original.state);
  const historicalRetry=await call('GET',importedPath+'/agent-requests/'+answered.requestId+'/retry-submission?submissionKey='+retryKey);
  assert.equal(historicalRetry.workId,imported.workId);assert.equal(historicalRetry.status,'accepted');assert.equal(historicalRetry.request.requestId,retried.requestId);assert.equal(historicalRetry.request.retryOf,answered.requestId);assert.equal(historicalRetry.request.disposition,'historical');
  await call('GET',importedPath+'/agent-requests/'+requestId+'/retry-submission?submissionKey='+retryKey,undefined,409);
  await call('POST',importedPath+'/agent-requests/'+answered.requestId+'/retry',{submissionKey:'historical-new-key'},409);
  await new Promise(resolve=>setTimeout(resolve,5500));assert.equal((await call('GET',importedPath+'/runs/active')).run,null);assert.equal((await call('GET',importedPath+'/runs/submissions/'+unknownKey)).status,'not-found');
  await operation(await call('POST',importedPath+'/stop',{idempotencyKey:'chat-controls-import-stop'},202));await rm(archive);
  console.log(JSON.stringify({result:'chat controls complete package round trip passed',oldAndNewRunsPreserved:true,acceptedKeyReplayed:true,unacceptedKeyAbsent:true,historicalRequestsReadOnly:true}));
  console.log(JSON.stringify({result:'chat controls real Core/Agentd/Desktop passed',normalReplacement:replacement.run.runId,serviceRequests:5,retryPosts,retryGets,replyRetained:true,manualFailureVisible:true,cancelledWithoutResume:true,cancellationWaitMs:elapsed,lateSubmission:false}));
  return {id,old,replacement,hanging,unknownKey};
}
