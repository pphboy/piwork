import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

let server, base;
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const path = req.url.startsWith('/browser/') ? '../dist/browser/' + req.url.slice(9) : '../dist/public/' + (req.url === '/style.css' ? 'style.css' : 'index.html');
    try { res.setHeader('Content-Type', path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html'); res.end(await readFile(new URL(path, import.meta.url))); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(page, handler = () => undefined, path = '/') {
  const requests = [];
  const user = { id: 'admin-1', account: 'admin', role: 'admin', enabled: true };
  await page.route('**/console/api/**', async route => {
    const request = { path: new URL(route.request().url()).pathname.replace('/console/api/', ''), method: route.request().method(), body: route.request().postData() };
    requests.push(request); let reply = await handler(request);
    if (!reply) {
      const values = {
        session: { authenticated: true, csrfToken: 'test-csrf', user }, availability: { reachable: true, administratorInitialized: true },
        'admin/status': { ready: true, state: 'READY', checks: { runtimeConfigured: true } }, health: { healthy: true },
        'admin/users': { users: [user] }, 'admin/runtime': { configured: true, agentImage: 'agent:test', modelRef: 'model-test-00000001', model: { provider: 'test', id: 'test', credentialAvailable: true } },
        'admin/default-work': { baseImage: 'agent:test', configuration: { skills: [], packages: [], agentsMd: 'saved' } },
        'admin/model-providers': {providers:[]}, 'admin/models': {models:[{id:'managed-test-00001',providerId:'provider-test-00001',modelRef:'model-test-00000001',name:'Test model',model:'test',providerName:'Fixture provider',api:'openai-responses',enabled:true,providerEnabled:true,credentialAvailable:true,capabilityStatus:'sdk'}]},
        'admin/skills': { skills: [{ name: 'skill', enabled: true, fileCount: 1, totalBytes: 1 }] }, 'admin/packages': { packages: [] },
        'admin/operations/op-1': { operationId: 'op-1', name: 'pkg', state: 'running', packagePhase: 'validating' },
      };
      reply = values[request.path] ? { json: values[request.path] } : { status: 404, json: { code: 'NOT_FOUND' } };
    }
    await route.fulfill({ status: reply.status || 200, contentType: 'application/json', body: JSON.stringify(reply.json || {}) });
  });
  await page.goto(base + path); await expect(page.locator('main')).not.toContainText('Loading'); return requests;
}

async function modelsFixture(page,intercept=()=>undefined){
 const models=[],writes=[],tests=[];let counter=1;const id=p=>p+'-'+String(counter++).padStart(16,'0'),now=()=>new Date().toISOString();
 const requests=await fixture(page,async r=>{const special=await intercept(r,{models,writes,tests});if(special)return special;const body=r.body?JSON.parse(r.body):{};
 if(r.path==='admin/models'){if(r.method==='GET')return{json:{models}};writes.push(r);const m={id:id('managed-model'),name:body.name||body.model,model:body.model,api:body.api,baseUrl:body.baseUrl,modelRef:id('model-config'),enabled:true,credentialAvailable:true,createdAt:now(),updatedAt:now()};models.push(m);return{status:201,json:m};}
 if(r.path==='admin/model-tests'){tests.push(body);return{json:{success:false,api:body.api,model:body.model,testMessage:'Reply with OK.',category:'authentication',reason:'provider-authentication',message:'The provider rejected the request credentials.',recovery:'Check the model API Key and access.',httpStatus:401,checkedAt:now(),durationMs:12}};}
 if(r.path.startsWith('admin/models/')){const parts=r.path.split('/'),m=models.find(m=>m.id===parts[2]);if(!m)return{status:404,json:{code:'NOT_FOUND'}};if(r.method==='PATCH'){writes.push(r);const {credential,...publicBody}=body;Object.assign(m,publicBody);return{json:m};}if(r.method==='DELETE'){models.splice(models.indexOf(m),1);return{json:{}};}if(parts[3])m.enabled=parts[3]==='enable';return{json:m};}
 },'/models');return{models,writes,tests,requests};
}

async function closeModelTest(page){await page.getByRole('button',{name:'Close',exact:true}).click();await expect(page.locator('dialog')).toHaveCount(0);}

for(const reason of ['provider-authentication','model-unavailable','rate-limited','dns','tls','connection','network','timeout','provider-error','protocol-mismatch','empty-reply','response-too-large'])test(`message Test ${reason} feedback explains recovery and never blocks save or expires administrator login`,async({page})=>{
  let calls=0;
  const categories={'provider-authentication':'authentication','model-unavailable':'model','rate-limited':'rate-limit',dns:'network',tls:'network',connection:'network',network:'network',timeout:'timeout','provider-error':'protocol','protocol-mismatch':'protocol','empty-reply':'protocol','response-too-large':'response-limit'};
  const state=await modelsFixture(page,r=>{if(r.path==='admin/model-tests'){calls++;return{json:{success:false,api:'anthropic-messages',model:'fixture',testMessage:'Reply with OK.',category:categories[reason],reason,message:'Specific '+reason+' failure.',recovery:'Fix '+reason+' and test explicitly.',checkedAt:new Date().toISOString(),durationMs:1}};}});
  await page.getByLabel('Display name (optional)',{exact:true}).fill('Provider '+reason);await page.getByLabel('API type',{exact:true}).selectOption('anthropic-messages');await page.getByLabel('Base URL',{exact:true}).fill('https://fixture.invalid/v1');await page.getByLabel('API Key',{exact:true}).fill('synthetic-error-key');await page.getByLabel('Model ID',{exact:true}).fill('fixture');await page.getByRole('button',{name:'Test',exact:true}).click();
  await expect(page.locator('[data-model-test-stage]')).toHaveText('Model request failed.');await expect(page.getByRole('dialog')).toContainText('Specific '+reason+' failure.');await expect(page.locator('[data-model-test-recovery]')).toHaveText('Fix '+reason+' and test explicitly.');
  await closeModelTest(page);await expect(page).toHaveURL(base+'/models');await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('synthetic-error-key');await expect(page.getByRole('button',{name:'Add model',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Add model',exact:true}).click();await expect(page.getByRole('link',{name:'Provider '+reason,exact:true})).toBeVisible();expect(calls).toBe(1);expect(state.writes).toHaveLength(1);
});

test('unconfirmed message Test has its own recovery and does not become an unknown configuration write',async({page})=>{
  const state=await modelsFixture(page);let calls=0;
  await page.route('**/console/api/admin/model-tests',async route=>{calls++;await route.abort('failed');});
  await page.getByLabel('Display name (optional)',{exact:true}).fill('Offline Test provider');await page.getByLabel('Base URL',{exact:true}).fill('https://fixture.invalid');await page.getByLabel('API Key',{exact:true}).fill('synthetic');await page.getByLabel('Model ID',{exact:true}).fill('fixture');await page.getByRole('button',{name:'Test',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('The Test result could not be confirmed');await expect(page.getByRole('dialog')).not.toContainText('write result');await expect(page.locator('[data-model-test-stage]')).not.toContainText('No model request was sent');await closeModelTest(page);await expect(page.getByRole('button',{name:'Add model',exact:true})).toBeEnabled();expect(calls).toBe(1);expect(state.writes).toHaveLength(0);
});

test('message Test explains rejected Base URL and required draft fields without losing the draft',async({page})=>{
  let requests=0;
  await modelsFixture(page,r=>{if(r.path==='admin/model-tests'){requests++;return{status:400,json:{code:'INVALID_REQUEST',field:'baseUrl',message:'Request fields are invalid'}};}});
  await page.getByLabel('API type',{exact:true}).selectOption('anthropic-messages');await expect(page.getByLabel('Base URL',{exact:true})).toHaveAttribute('placeholder','https://gateway.example');
  await page.getByLabel('Model ID',{exact:true}).fill('specified-model');await page.getByRole('button',{name:'Test',exact:true}).click();await expect(page.locator('main')).toContainText('Enter a Base URL before testing');expect(requests).toBe(0);
  await page.getByLabel('Base URL',{exact:true}).fill('ftp://fixture.invalid');await page.getByRole('button',{name:'Test',exact:true}).click();await expect(page.locator('main')).toContainText('Enter an API Key before testing');expect(requests).toBe(0);
  await page.getByLabel('API Key',{exact:true}).fill('synthetic-validation-key');await page.getByRole('button',{name:'Test',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Base URL is invalid');await expect(page.getByRole('dialog')).toContainText('Messages accepts a service root or a Base URL ending in /v1');await expect(page.getByRole('dialog')).not.toContainText('Request fields are invalid');await expect(page.locator('main')).not.toContainText('Enter an API Key before testing');expect(requests).toBe(1);
  await expect(page.locator('[data-model-test-stage]')).toContainText('No model request was sent');await page.getByRole('button',{name:'Back to configuration',exact:true}).click();await expect(page.getByLabel('Base URL',{exact:true})).toBeFocused();await expect(page.getByLabel('Base URL',{exact:true})).toHaveAttribute('aria-invalid','true');await expect(page.getByLabel('Base URL',{exact:true})).toHaveValue('ftp://fixture.invalid');await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('synthetic-validation-key');await page.getByLabel('Base URL',{exact:true}).fill('https://fixture.invalid/v1');await expect(page.locator('#model-field-error')).toHaveCount(0);
});

test('flat unknown models save once and appear in Runtime without another Key or capability form',async({page})=>{
 await page.setViewportSize({width:1440,height:900});const state=await modelsFixture(page);
 await expect(page.getByLabel('Provider name',{exact:true})).toHaveCount(0);await expect(page.locator('#model-capabilities')).toHaveCount(0);
 await page.getByLabel('Model ID',{exact:true}).fill('unknown-custom');await page.getByLabel('Base URL',{exact:true}).fill('https://fixture.invalid/v1');await page.getByLabel('API Key',{exact:true}).fill('synthetic-browser-key');
 await page.getByRole('button',{name:'Test',exact:true}).click();await expect(page.locator('#model-test-result')).toContainText('authentication');await closeModelTest(page);
 await page.getByRole('button',{name:'Add model',exact:true}).click();await expect(page.getByRole('link',{name:'unknown-custom',exact:true})).toBeVisible();expect(state.writes).toHaveLength(1);expect(JSON.parse(state.writes[0].body)).toEqual({name:'',model:'unknown-custom',api:'openai-responses',baseUrl:'https://fixture.invalid/v1',credential:'synthetic-browser-key'});
 await page.getByRole('link',{name:'unknown-custom',exact:true}).click();await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('');await page.getByLabel('Display name (optional)',{exact:true}).fill('Renamed');await page.getByRole('button',{name:'Save model',exact:true}).click();expect(JSON.parse(state.writes.at(-1).body)).not.toHaveProperty('credential');
 await page.getByRole('link',{name:'Configure runtime',exact:true}).click();await page.getByRole('button',{name:'Edit runtime',exact:true}).click();await page.locator('#modelRef').selectOption(state.models[0].modelRef);await expect(page.locator('#apiKey')).toHaveCount(0);
 expect(state.requests.some(r=>r.path.includes('model-providers'))).toBe(false);expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('synthetic-browser-key');
});
test('Messages models have independent lifecycle and distinguish identical IDs on narrow screens',async({page})=>{
 await page.setViewportSize({width:360,height:800});const state=await modelsFixture(page);page.on('dialog',d=>d.accept());
 for(const name of ['First','Second']){await page.getByLabel('Display name (optional)',{exact:true}).fill(name);await page.getByLabel('Model ID',{exact:true}).fill('custom-same');await page.getByLabel('API type',{exact:true}).selectOption('anthropic-messages');await page.getByLabel('Base URL',{exact:true}).fill('https://messages-fixture.invalid/v1');await page.getByLabel('API Key',{exact:true}).fill('synthetic-'+name);await page.getByRole('button',{name:'Add model',exact:true}).click();await expect(page.getByRole('link',{name,exact:true})).toBeVisible();}
 await page.getByRole('link',{name:'First',exact:true}).click();await expect(page.getByLabel('API type',{exact:true})).toBeEnabled();await page.getByRole('button',{name:'Disable model',exact:true}).click();expect(state.models[1].enabled).toBe(true);await expect(page.getByRole('button',{name:'Enable model',exact:true})).toBeVisible();await page.getByRole('button',{name:'Enable model',exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
for(const change of ['endpoint','Key'])test(`AI model Test readback invalidates a changed saved ${change}`,async({page})=>{
 const state=await modelsFixture(page);state.models.push({id:'managed-readback',name:'Saved model',api:'openai-responses',baseUrl:'https://old-fixture.invalid/v1',model:'gpt-5.1',modelRef:'model-readback',enabled:true,credentialAvailable:true});
 await page.getByRole('button',{name:'Read current data',exact:true}).click();await page.getByRole('link',{name:'Saved model',exact:true}).click();await page.getByLabel('Model ID',{exact:true}).fill('unsaved-model-draft');await page.getByRole('button',{name:'Test',exact:true}).click();await closeModelTest(page);
 if(change==='endpoint')state.models[0].baseUrl='https://new-fixture.invalid/v1';await page.getByRole('button',{name:'Read current data',exact:true}).click();await expect(page.locator('#model-test-result')).toContainText('Configuration changed');await expect(page.getByLabel('Model ID',{exact:true})).toHaveValue('unsaved-model-draft');await page.getByRole('button',{name:'Test',exact:true}).click();await expect.poll(()=>state.tests.length).toBe(2);expect(state.tests.at(-1).modelId).toBe('managed-readback');expect(state.tests.at(-1).model).toBe('unsaved-model-draft');expect(state.writes).toHaveLength(0);
});

test('AI model readback invalidates a Test still in flight without discarding visible connection drafts',async({page})=>{
  const gate=deferred();let started=false;
  try{
    const state=await modelsFixture(page,async r=>{if(r.path==='admin/model-tests'){started=true;await gate.promise;return{json:{success:true,api:'openai-responses',model:'draft-model',testMessage:'Reply with OK.',replyText:'Actual late reply',replyTruncated:false,category:'success',checkedAt:new Date().toISOString(),durationMs:1}};}});
    await page.getByLabel('Display name (optional)',{exact:true}).fill('Unsaved provider');await page.getByLabel('Base URL',{exact:true}).fill('https://draft-fixture.invalid/v1');await page.getByLabel('API Key',{exact:true}).fill('synthetic-inflight-key');await page.getByLabel('Model ID',{exact:true}).fill('draft-model');
    await page.getByRole('button',{name:'Test',exact:true}).click();await expect.poll(()=>started).toBe(true);
    await closeModelTest(page);
    await page.getByRole('button',{name:'Read current data',exact:true}).click();await expect(page.getByLabel('Base URL',{exact:true})).toHaveValue('https://draft-fixture.invalid/v1');await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('synthetic-inflight-key');
    gate.resolve();await expect(page.locator('#model-test-result')).toContainText('Configuration changed');await expect(page.locator('dialog')).toHaveCount(0);
    await page.getByRole('button',{name:'View test result',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('previous configuration');await expect(page.locator('[data-model-test-reply]')).toHaveText('Actual late reply');expect(state.writes).toHaveLength(0);
  }finally{gate.resolve();}
});

for(const api of ['openai-responses','anthropic-messages'])test(`message Test Modal displays actual ${api} reply as text and keeps drafts without another request`,async({page})=>{
  await page.setViewportSize({width:360,height:800});const gate=deferred();let count=0;
  const reply='Actual '+api+' reply\n<img src=x onerror="window.testInjected=true">\n'+'long'.repeat(1000);
  try{
    const state=await modelsFixture(page,async r=>{if(r.path==='admin/model-tests'){count++;await gate.promise;const body=JSON.parse(r.body);return{json:{success:true,api,model:body.model,testMessage:'Reply with OK.',replyText:reply,replyTruncated:true,category:'success',httpStatus:200,checkedAt:new Date().toISOString(),durationMs:42}};}});
    await page.getByLabel('Display name (optional)',{exact:true}).fill('Modal provider');await page.getByLabel('API type',{exact:true}).selectOption(api);await page.getByLabel('Base URL',{exact:true}).fill('https://fixture.invalid');await page.getByLabel('API Key',{exact:true}).fill('synthetic-modal-key');await page.getByLabel('Model ID',{exact:true}).fill('specified-model');
    await page.getByRole('button',{name:'Test',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('Sending the test message');await expect(dialog).toContainText('specified-model');await expect(dialog).toContainText('Reply with OK.');
    gate.resolve();await expect(page.locator('[data-model-test-reply]')).toHaveText(reply);await expect(dialog).toContainText('Reply truncated');await expect(dialog).toContainText('42 ms');await expect(dialog.locator('img')).toHaveCount(0);
    expect(await page.evaluate(()=>window.testInjected)).toBeUndefined();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.keyboard.press('Escape');await expect(page.locator('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'Test',exact:true})).toBeFocused();await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('synthetic-modal-key');
    await page.getByRole('button',{name:'View test result',exact:true}).click();await expect(page.locator('[data-model-test-reply]')).toHaveText(reply);expect(count).toBe(1);await closeModelTest(page);expect(state.writes).toHaveLength(0);
    expect(await page.content()).not.toContain('synthetic-modal-key');expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain(reply);
  }finally{gate.resolve();}
});

test('message Test closed or navigated away cannot replace a discard dialog or a newer target',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  const old=deferred(),fresh=deferred();let count=0;
  try{
    const state=await modelsFixture(page,async r=>{if(r.path==='admin/model-tests'){const current=++count,body=JSON.parse(r.body);await(current===1?old.promise:fresh.promise);return{json:{success:true,api:'openai-responses',model:body.model,testMessage:'Reply with OK.',replyText:body.model+' actual reply',replyTruncated:false,category:'success',checkedAt:new Date().toISOString(),durationMs:1}};}});
    const fill=async model=>{await page.getByLabel('Display name (optional)',{exact:true}).fill(model+' provider');await page.getByLabel('Base URL',{exact:true}).fill('https://fixture.invalid/v1');await page.getByLabel('API Key',{exact:true}).fill('synthetic-key');await page.getByLabel('Model ID',{exact:true}).fill(model);};
    await fill('old-model');await page.getByRole('button',{name:'Test',exact:true}).click();await expect.poll(()=>count).toBe(1);await closeModelTest(page);
    await page.getByRole('link',{name:'User access',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Discard unsaved changes?');
    // The pending request remains alive while a different modal owns focus.
    await page.getByRole('button',{name:'Discard changes',exact:true}).click();await page.getByRole('link',{name:'AI models',exact:true}).click();await fill('fresh-model');await page.getByRole('button',{name:'Test',exact:true}).click();await expect.poll(()=>count).toBe(2);
    old.resolve();await page.waitForTimeout(50);await expect(page.getByRole('dialog')).toContainText('fresh-model');await expect(page.getByRole('dialog')).toContainText('Sending the test message');await expect(page.getByRole('dialog')).not.toContainText('old-model actual reply');
    fresh.resolve();await expect(page.locator('[data-model-test-reply]')).toHaveText('fresh-model actual reply');expect(state.writes).toHaveLength(0);
  }finally{old.resolve();fresh.resolve();}
});

test('message Test completion leaves an unrelated discard dialog intact',async({page})=>{
  await page.setViewportSize({width:1440,height:900});const gate=deferred();let count=0;
  try{
    await modelsFixture(page,async r=>{if(r.path==='admin/model-tests'){count++;await gate.promise;return{json:{success:true,api:'openai-responses',model:'one',testMessage:'Reply with OK.',replyText:'Actual reply',replyTruncated:false,category:'success',checkedAt:new Date().toISOString(),durationMs:1}};}});
    await page.getByLabel('Display name (optional)',{exact:true}).fill('Draft provider');await page.getByLabel('Base URL',{exact:true}).fill('https://fixture.invalid');await page.getByLabel('API Key',{exact:true}).fill('synthetic');await page.getByLabel('Model ID',{exact:true}).fill('one');await page.getByRole('button',{name:'Test',exact:true}).click();await expect.poll(()=>count).toBe(1);await closeModelTest(page);
    await page.getByRole('link',{name:'User access',exact:true}).click();gate.resolve();await expect(page.locator('#model-test-result')).toContainText('HTTP Test passed');await expect(page.getByRole('dialog')).toContainText('Discard unsaved changes?');await expect(page.locator('[data-model-test-dialog]')).toHaveCount(0);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByLabel('Display name (optional)',{exact:true})).toHaveValue('Draft provider');await expect(page.locator('dialog')).toHaveCount(0);
  }finally{gate.resolve();}
});

test('model page header actions align on desktop and narrow screens',async({page})=>{
 const state=await modelsFixture(page);state.models.push({id:'managed-header',name:'Header model',api:'openai-responses',baseUrl:'https://fixture.invalid/v1',model:'custom-header',modelRef:'model-header',enabled:true,credentialAvailable:true});
 for(const width of [1440,360])for(const path of ['/models','/models/managed-header']){await page.setViewportSize({width,height:900});await page.goto(base+path);const actions=page.locator('.page-header .header-actions');await expect(actions.getByRole('button',{name:'Read current data',exact:true})).toBeVisible();await expect(actions.getByRole('link',{name:'Configure runtime',exact:true})).toBeVisible();if(path!=='/models')await expect(page.locator('.breadcrumb').getByRole('link',{name:'All models',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
});

test('AI model lost acceptance requires explicit readback and expired sessions clear the Key',async({page})=>{
  let lost=true,expired=false;const state=await modelsFixture(page,async r=>{
    if(r.path==='admin/models'&&r.method==='POST'&&lost)return{json:{}};
    if(r.path==='admin/model-tests'&&expired)return{status:401,json:{code:'AUTHENTICATION_REQUIRED'}};
  });
  await page.getByLabel('Display name (optional)',{exact:true}).fill('Unconfirmed');await page.getByLabel('Model ID',{exact:true}).fill('unknown');await page.getByLabel('Base URL',{exact:true}).fill('https://fixture.invalid/v1');await page.getByLabel('API Key',{exact:true}).fill('synthetic-uncertain');await page.getByRole('button',{name:'Add model',exact:true}).click();
  await expect(page.locator('main')).toContainText('unconfirmed');await expect(page.getByRole('button',{name:'Add model',exact:true})).toBeDisabled();await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('');
  lost=false;await page.getByRole('button',{name:'Read current data',exact:true}).click();await expect(page.getByRole('button',{name:'Add model',exact:true})).toBeEnabled();
  expired=true;await page.getByLabel('API Key',{exact:true}).fill('synthetic-expired');await page.getByLabel('Model ID',{exact:true}).fill('one');await page.getByRole('button',{name:'Test',exact:true}).click();await expect(page).toHaveURL(base+'/login');await expect(page.locator('#model-key')).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});

test('AI provider late save cannot erase a re-entered Key or release the new view save lock',async({page})=>{
  await page.setViewportSize({width:1440,height:900});const old=deferred(),fresh=deferred();let writes=0;
  try{
    await modelsFixture(page,async r=>{if(r.path==='admin/models'&&r.method==='POST'){writes++;if(writes===1)await old.promise;else await fresh.promise;}});
    await page.getByLabel('Display name (optional)',{exact:true}).fill('Old model');await page.getByLabel('Model ID',{exact:true}).fill('old-id');await page.getByLabel('Base URL',{exact:true}).fill('https://fixture.invalid/v1');await page.getByLabel('API Key',{exact:true}).fill('synthetic-old-view');await page.getByRole('button',{name:'Add model',exact:true}).click();await expect.poll(()=>writes).toBe(1);
    await page.getByRole('link',{name:'User access',exact:true}).click();await page.getByRole('button',{name:'Discard changes',exact:true}).click();await expect(page).toHaveURL(base+'/users');
    await page.getByRole('link',{name:'AI models',exact:true}).click();await page.getByLabel('Display name (optional)',{exact:true}).fill('Fresh provider');await page.getByLabel('Model ID',{exact:true}).fill('fresh-id');await page.getByLabel('Base URL',{exact:true}).fill('https://fixture.invalid/v1');await page.getByLabel('API Key',{exact:true}).fill('synthetic-fresh-view');await page.getByRole('button',{name:'Add model',exact:true}).click();await expect.poll(()=>writes).toBe(2);
    old.resolve();await page.waitForTimeout(100);await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('synthetic-fresh-view');await expect(page.getByRole('button',{name:'Saving…',exact:true})).toBeDisabled();expect(writes).toBe(2);
    fresh.resolve();await expect(page.getByRole('link',{name:'Fresh provider',exact:true})).toBeVisible();await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('');
  }finally{old.resolve();fresh.resolve();}
});

for (const [action, path, endpoint] of [
  ['refresh-status', '/', 'admin/status'], ['verify-runtime', '/runtime', 'admin/status'],
  ['retry-connection', '/login', 'availability'], ['refresh-operation', '/operations/op-1', 'admin/operations/op-1'],
  ['resume-observation', '/operations/op-1', 'admin/operations/op-1'], ['sign-out', '/users', 'logout'],
]) test(`S01 ${action} publishes before response and prevents duplicate queries`, async ({ page }) => {
  const gate = deferred(); let armed = false;
  try {
    const requests = await fixture(page, async r => {
      if (armed && r.path === endpoint) { await gate.promise; return r.path === 'logout' ? { json: {} } : undefined; }
      if (action === 'retry-connection' && r.path === 'availability') return { json: { reachable: false } };
    }, path);
    // Resume only appears when observation has failed.
    if (action === 'resume-observation') {
      await page.route('**/console/api/admin/operations/op-1', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":"CORE_UNREACHABLE"}' }));
      await page.locator('[data-action="refresh-operation"]').click(); await expect(page.locator('[data-action="resume-observation"]')).toBeVisible(); await page.unroute('**/console/api/admin/operations/op-1');
    }
    if (action === 'sign-out') await page.locator('summary[aria-label="Administrator account"]').click();
    const button = page.locator(`[data-action="${action}"]`).first();
    armed = true; const before = requests.filter(r => r.path === endpoint).length;
    await button.click(); await expect(page.locator('[data-action-status]').filter({ hasText: action === 'sign-out' ? 'Signing out' : action === 'verify-runtime' ? 'Verifying' : action === 'resume-observation' ? 'Resuming' : 'Checking' })).toBeVisible();
    await expect(button).toBeDisabled(); await page.evaluate(action => document.querySelector(`[data-action="${action}"]`)?.click(), action);
    if(action === 'refresh-operation') await page.waitForTimeout(2200);
    expect(requests.filter(r => r.path === endpoint).length - before).toBe(1); gate.resolve();
  } finally { gate.resolve(); }
});

test('S03 user confirmation survives slow and failed Users refresh without another POST', async ({ page }) => {
  const mutation = deferred(), refresh = deferred(); let changed = false;
  try {
    const requests = await fixture(page, async r => {
      if (r.path === 'admin/users' && r.method === 'POST') { await mutation.promise; changed = true; return { json: { id: 'new-1', account: 'new-user', role: 'user', enabled: true } }; }
      if (r.path === 'admin/users' && changed) { await refresh.promise; return { status: 503, json: { code: 'CORE_UNREACHABLE' } }; }
    }, '/users');
    await page.getByRole('button', { name: 'Create user', exact: true }).click();
    await page.locator('#new-account').fill('new-user'); await page.locator('#new-password').fill('test-password-only'); await page.locator('#confirm-password').fill('test-password-only');
    await page.locator('#dialog-submit').click(); await expect(page.locator('#dialog-submit')).toContainText('Creating');
    mutation.resolve(); await expect(page.locator('main')).toContainText('Account new-user created'); await expect(page.locator('[data-action-status]')).toContainText('Refreshing');
    refresh.resolve(); await expect(page.locator('main')).toContainText('not confirmed'); await expect(page.locator('[data-action="readback"]')).toBeVisible();
    expect(requests.filter(r => r.method === 'POST').length).toBe(1); expect(await page.locator('body').innerText()).not.toContain('test-password-only');
  } finally { mutation.resolve(); refresh.resolve(); }
});

for (const action of ['disable','enable','reset']) test(`S03 ${action} confirms before Users refresh and clears credential input`,async({page})=>{
  const post=deferred(),get=deferred();let accepted=false;
  try{
    const requests=await fixture(page,async r=>{
      if(r.path==='admin/users'&&r.method==='GET'){if(accepted)await get.promise;return{json:{users:[{id:'other',account:'other',role:'user',enabled:action!=='enable'}]}};}
      if(r.path===`admin/users/other/${action==='reset'?'reset-credential':action}`){await post.promise;accepted=true;return{json:{}};}
    },'/users');
    await page.locator(`[data-action="${action==='reset'?'user-reset':'user-toggle'}"]`).click();
    if(action==='reset'){await page.locator('#reset-password').fill('test-credential');await page.locator('#reset-confirm').fill('test-credential');}
    await page.locator('#dialog-submit').click();await expect(page.locator('[data-action-status]')).toContainText('other');post.resolve();
    await expect(page.locator('main')).toContainText(action==='reset'?'password reset':`account ${action==='enable'?'enabled':'disabled'}`);await expect(page.locator('dialog')).toHaveCount(0);await expect(page.locator('input[type="password"]')).toHaveCount(0);
    expect(requests.filter(r=>r.method==='POST').length).toBe(1);get.resolve();
  }finally{post.resolve();get.resolve();}
});

for(const kind of ['skills','packages'])for(const action of ['disable','enable','remove'])test(`S04 ${kind} ${action} keeps its confirmation through a failed catalog read`,async({page})=>{
  const post=deferred(),get=deferred();let accepted=false;
  try{
    const requests=await fixture(page,async r=>{
      if(r.path===`admin/${kind}`&&r.method==='GET'){if(accepted){await get.promise;return{status:503,json:{code:'CORE_UNREACHABLE'}};}return{json:{[kind]:[{name:'item',enabled:action!=='enable',fileCount:1,totalBytes:2,source:{kind:'npm',spec:'item'},size:2}]}};}
      if(r.path===`admin/${kind}/item${action==='remove'?'':'/'+action}`&&r.method!=='GET'){await post.promise;accepted=true;return{status:204};}
      if(r.path===`admin/packages/item`&&r.method==='GET')return{json:{name:'item',enabled:action!=='enable',source:{kind:'npm',spec:'item'},state:'installed'}};
    },'/'+kind+'/item');
    await page.locator(`[data-action="${action==='remove'?'catalog-remove':'catalog-toggle'}"]`).click();if(action==='remove')await page.locator('#confirm-name').fill('item');
    await page.locator('#dialog-submit').click();await expect(page.locator('[data-action-status]')).toContainText('item');post.resolve();
    await expect(page.locator('main')).toContainText(`item ${action==='remove'?'removed':action==='enable'?'enabled':'disabled'}`);await expect(page.locator('dialog')).toHaveCount(0);get.resolve();await expect(page.locator('main')).toContainText('not confirmed');expect(requests.filter(r=>r.method!=='GET').length).toBe(1);
  }finally{post.resolve();get.resolve();}
});

for (const phase of ['PUT', 'readiness']) for (const outcome of ['success', 'failure']) test(`W3 old Runtime ${phase} ${outcome} cannot clear a newer model/draft or release a new save lock`, async ({ page }) => {
  const old = deferred(), fresh = deferred(); let puts = 0, waiting = false;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const requests = await fixture(page, async r => {
      if (r.path === 'admin/runtime' && r.method === 'PUT') {
        puts++;
        if (puts === 1 && phase === 'PUT') { waiting = true; await old.promise; if (outcome === 'failure') return { status: 503, json: { code: 'CORE_UNREACHABLE' } }; }
        if (puts === 2) await fresh.promise;
        return { json: { runtime: { configured: true, agentImage: 'agent:saved', modelRef: 'model-test-00000001', model: { provider: 'test', id: 'test', credentialAvailable: true } } } };
      }
    }, '/runtime');
    if (phase === 'readiness') await page.evaluate(async outcome => {
      const { adapter } = await import('/browser/adapter.js');
      const readHealth = adapter.health.bind(adapter); let held = false;
      // Delay the first post-save continuation after its HTTP reads. Later route reads stay usable.
      adapter.health = async () => {
        const health = await readHealth(); if (held) return health; held = true;
        window.oldRuntimeReadinessWaiting = true;
        await new Promise(resolve => { window.releaseOldRuntimeReadiness = resolve; });
        if (outcome === 'failure') throw new Error('fixture readiness callback failed');
        return health;
      };
    }, outcome);
    await page.locator('[data-action="edit-runtime"]').first().click(); await page.locator('#agentImage').fill('agent:first'); await page.locator('#modelRef').selectOption('model-test-00000001');
    await expect(page.locator('#apiKey')).toHaveCount(0);
    await page.locator('#runtime-form button[type="submit"]').click();
    await expect.poll(() => phase === 'PUT' ? waiting : page.evaluate(() => !!window.oldRuntimeReadinessWaiting)).toBe(true);
    if (phase === 'readiness') { await expect(page.locator('main')).toContainText('Runtime saved'); await expect(page.locator('#apiKey')).toHaveCount(0); }
    await page.locator('a[data-nav][href="/default-work"]').first().click();
    if (phase === 'PUT') await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(page).toHaveURL(base + '/default-work');
    await expect(page.getByRole('heading', { name: /^(Default Work|Shape new Work)$/ })).toBeVisible();
    await page.goBack(); await page.locator('[data-action="edit-runtime"]').first().click();
    await page.locator('#agentImage').fill('agent:fresh'); await page.locator('#modelRef').selectOption('model-test-00000001');
    const submit = page.locator('#runtime-form button[type="submit"]');
    if (phase === 'readiness') { await submit.click(); await expect.poll(() => puts).toBe(2); await expect(submit).toBeDisabled(); }
    if (phase === 'PUT') {
      const response = page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith('/admin/runtime'));
      old.resolve(); await response;
    } else await page.evaluate(() => window.releaseOldRuntimeReadiness());
    // Allow the response body, view guard and finally callback to settle before checking retained input.
    await page.waitForTimeout(100);
    await expect(page.locator('#agentImage')).toHaveValue('agent:fresh'); await expect(page.locator('#modelRef')).toHaveValue('model-test-00000001');
    await expect(page.locator('#apiKey')).toHaveCount(0);
    if (phase === 'readiness') { await expect(submit).toBeDisabled(); await submit.evaluate(el => el.click()); expect(puts).toBe(2); }
    else { await expect(submit).toBeEnabled(); await submit.click(); await expect.poll(() => puts).toBe(2); await expect(submit).toBeDisabled(); }
    expect(requests.filter(r => r.method === 'PUT').length).toBe(2);
  } finally { old.resolve(); fresh.resolve(); await page.evaluate(() => window.releaseOldRuntimeReadiness?.()).catch(() => {}); }
});

test('S05 runtime saved confirmation precedes readiness; newer non-sensitive edits stay unsaved',async({page})=>{
  const post=deferred(),health=deferred();let accepted=false;
  try{
    const requests=await fixture(page,async r=>{
      if(r.path==='admin/runtime'&&r.method==='PUT'){await post.promise;accepted=true;return{json:{runtime:{configured:true,agentImage:'agent:new',modelRef:'model-test-00000001',model:{provider:'test',id:'test',credentialAvailable:true}}}};}
      if(accepted&&r.path==='admin/status'){await health.promise;return{status:503,json:{code:'CORE_UNREACHABLE'}};}
    },'/runtime');
    await page.locator('[data-action="edit-runtime"]').first().click();await page.locator('#agentImage').fill('agent:new');await page.locator('#modelRef').selectOption('model-test-00000001');await page.locator('#runtime-form button[type="submit"]').click();
    await expect(page.locator('[data-action-status]')).toContainText('Saving');await page.locator('#agentImage').fill('agent:newer');post.resolve();
    await expect(page.locator('main')).toContainText('Runtime saved');await expect(page.locator('#agentImage')).toHaveValue('agent:newer');await expect(page.locator('#apiKey')).toHaveCount(0);health.resolve();await expect(page.locator('main')).toContainText('readiness could not be confirmed');await expect(page.locator('#agentImage')).toHaveValue('agent:newer');expect(requests.filter(r=>r.method==='PUT').length).toBe(1);
  }finally{post.resolve();health.resolve();}
});

for(const pagePath of ['/runtime','/default-work'])test(`S01 ${pagePath} explicit configuration read reports checking time without overwriting a newer draft`,async({page})=>{
  const gate=deferred();let armed=false;
  try{
    const endpoint=pagePath==='/runtime'?'admin/runtime':'admin/default-work';
    const requests=await fixture(page,async r=>{if(armed&&r.path===endpoint)await gate.promise;},pagePath);
    // Exercise the real recovery entry, with malformed acknowledgement deliberately requiring readback.
    if(pagePath==='/runtime'){
      await page.locator('[data-action="edit-runtime"]').first().click();await page.locator('#modelRef').selectOption('model-test-00000001');
      await page.route('**/console/api/admin/runtime',route=>route.request().method()==='PUT'?route.fulfill({status:200,contentType:'application/json',body:'{}'}):route.fallback());
      await page.locator('#runtime-form button[type="submit"]').click();await expect(page.locator('[data-action="readback"]')).toBeVisible();
    }else{
      await page.locator('[data-action="edit-defaults"][data-section="agentsMd"]').click();await page.locator('#agentsMd').fill('submitted');
      await page.route('**/console/api/admin/default-work',route=>route.request().method()==='PATCH'?route.abort('failed'):route.fallback());await page.locator('[data-action="save-defaults"]').click();await expect(page.locator('[data-action="readback"]')).toBeVisible();
    }
    armed=true;await page.locator('[data-action="readback"]').click();await expect(page.locator('[data-action-status][aria-busy="true"]')).toBeVisible();
    const field=pagePath==='/runtime'?'#agentImage':'#agentsMd';await page.locator(field).fill('newer draft');gate.resolve();await expect(page.locator(field)).toHaveValue('newer draft');await expect(page.locator('[data-action-status]').filter({hasText:'Checked'}).first()).toContainText(/\d{4}-\d{2}-\d{2}T/);expect(requests.filter(r=>r.path===endpoint).length).toBeGreaterThan(1);
  }finally{gate.resolve();}
});

for(const source of ['Skill directory','Package directory','Package ZIP','AGENTS.md'])test(`S02 ${source} preflight publishes and cannot apply stale selected files`,async({page})=>{
  const root=await mkdtemp(join(tmpdir(),'piwork-feedback-files-'));
  try{
    const skill=join(root,'skill');await mkdir(skill);await writeFile(join(skill,'SKILL.md'),'---\nname: skill\ndescription: fixture\n---\nfixture');
    const pkg=join(root,'pkg');await mkdir(pkg);await writeFile(join(pkg,'package.json'),'{"name":"pkg","version":"1.0.0"}');const zip=join(root,'pkg.zip');execFileSync('zip',['-q','-r',zip,'.'],{cwd:pkg});
    await fixture(page,()=>undefined,source==='AGENTS.md'?'/default-work':source.startsWith('Skill')?'/skills':'/packages');
    if(source==='AGENTS.md')await page.locator('[data-action="edit-defaults"][data-section="agentsMd"]').click();
    else {await page.locator(`[data-action="${source.startsWith('Skill')?'add-skill':'install-package'}"]`).click();if(source.startsWith('Package'))await page.getByRole('button',{name:source.endsWith('ZIP')?'ZIP':'Local directory',exact:true}).click();}
    await page.evaluate(()=>{
      (window).feedbackObserved=[];new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node instanceof HTMLElement&&node.matches('[data-action-status]'))(window).feedbackObserved.push(node.textContent);}).observe(document.body,{childList:true,subtree:true});
      const text=File.prototype.text,buffer=File.prototype.arrayBuffer;File.prototype.text=function(){return new Promise(resolve=>{window.releaseSelected=()=>text.call(this).then(resolve);});};File.prototype.arrayBuffer=function(){return new Promise(resolve=>{window.releaseSelected=()=>buffer.call(this).then(resolve);});};
    });
    if(source==='AGENTS.md')await page.locator('#agents-file').setInputFiles({name:'instructions.md',mimeType:'text/plain',buffer:Buffer.from('old selected draft')});
    else await page.locator('#upload-files').setInputFiles(source.startsWith('Skill')?skill:source.endsWith('ZIP')?zip:pkg);
    if(source==='Skill directory'){
      // Skill selection is bounded synchronous metadata validation, with no content read to delay.
      await expect.poll(()=>page.evaluate(()=>window.feedbackObserved.some(text=>text.includes('Checking selected files')))).toBe(true);
      await expect(page.locator('#dialog-submit')).toBeEnabled();
    }else{
      await expect(page.locator('[data-action-status][aria-busy="true"]')).toContainText('Checking selected files');
      if(source!=='AGENTS.md'){await expect(page.locator('#dialog-submit')).toBeDisabled();await page.locator('[data-action="close-dialog"]').first().click();}
      else {await page.locator('[data-action="menu"]').click();await page.locator('a[data-nav][href="/users"]').click();}
      await page.evaluate(()=>window.releaseSelected());
      await expect(page.locator('dialog')).toHaveCount(0);await expect(page.locator('body')).not.toContainText('old selected draft');
    }
  }finally{await rm(root,{recursive:true,force:true});}
});

for (const update of [false, true]) test(`S04 Skill ${update ? 'update' : 'add'} confirms before both auxiliary reads and preserves the selected multipart filename`,async({page})=>{
  const root=await mkdtemp(join(tmpdir(),'piwork-feedback-skill-'));const dir=join(root,'skill');await mkdir(dir);await writeFile(join(dir,'SKILL.md'),'---\nname: skill\ndescription: fixture\n---\nactual fixture');
  const post=deferred(),reads=deferred();let accepted=false;
  try{
    const requests=await fixture(page,async r=>{
      if(r.path===(update?'admin/skills/skill':'admin/skills')&&r.method===(update?'PUT':'POST')){await post.promise;accepted=true;return{json:{name:'skill'}};}
      if(accepted&&r.method==='GET'&&(r.path==='admin/skills'||r.path==='admin/default-work')){await reads.promise;return{status:503,json:{code:'CORE_UNREACHABLE'}};}
    },update?'/skills/skill':'/skills');
    await page.locator(`[data-action="${update?'update-skill':'add-skill'}"]`).click();await page.locator('#upload-files').setInputFiles(dir);await page.locator('#dialog-submit').click();
    await expect(page.locator('#dialog-submit')).toContainText('Uploading');post.resolve();await expect(page.locator('main')).toContainText('Skill skill confirmed');await expect(page.locator('dialog')).toHaveCount(0);reads.resolve();await expect(page.locator('main')).toContainText('not confirmed');
    const request=requests.find(r=>r.method===(update?'PUT':'POST'));expect(request.body).toContain('filename="SKILL.md"');expect(requests.filter(r=>r.method===(update?'PUT':'POST')).length).toBe(1);
  }finally{post.resolve();reads.resolve();await rm(root,{recursive:true,force:true});}
});

test('SUI-006 user acknowledgement after navigation cannot close a new Skill dialog',async({page})=>{
  const gate=deferred();
  try{
    await fixture(page,async r=>{if(r.path==='admin/users'&&r.method==='POST'){await gate.promise;return{json:{id:'new',account:'new-user',role:'user',enabled:true}};}},'/users');
    await page.locator('[data-action="create-user"]').click();await page.locator('#new-account').fill('new-user');await page.locator('#new-password').fill('test-password');await page.locator('#confirm-password').fill('test-password');await page.locator('#dialog-submit').click();
    await page.evaluate(()=>{history.pushState(null,'','/skills');window.dispatchEvent(new PopStateEvent('popstate'));});await page.getByRole('button',{name:'Discard changes',exact:true}).click();await page.locator('[data-action="add-skill"]').click();gate.resolve();
    await expect(page.locator('#dialog-title')).toContainText('Add Skill');await expect(page.locator('main')).not.toContainText('Account new-user created');
  }finally{gate.resolve();}
});

test('S05 Login request is visible and keyboard repeat never sends a second credential POST',async({page})=>{
  const gate=deferred();let authenticated=false;
  try{
    const requests=await fixture(page,async r=>{
      if(r.path==='session')return{json:{authenticated,csrfToken:'test-csrf',user:{id:'admin-1',account:'admin',role:'admin',enabled:true}}};
      if(r.path==='login'){await gate.promise;authenticated=true;return{json:{}};}
    },'/login');
    await page.locator('#account').fill('admin');await page.locator('#password').fill('test-password');await page.locator('#login-form button[type="submit"]').click();await expect(page.locator('[data-action-status][aria-busy="true"]')).toContainText('Signing in');await page.locator('#password').press('Enter');expect(requests.filter(r=>r.path==='login').length).toBe(1);gate.resolve();await expect(page.locator('main')).not.toContainText('Signing in');
  }finally{gate.resolve();}
});


test('S05 Defaults save confirms the submitted draft while newer edits remain unsaved',async({page})=>{
  const gate=deferred();
  try{
    const requests=await fixture(page,async r=>{if(r.path==='admin/default-work'&&r.method==='PATCH'){await gate.promise;return{json:{baseImage:'agent:test',configuration:{skills:[],packages:[],agentsMd:'submitted'}}};}},'/default-work');
    await page.locator('[data-action="edit-defaults"][data-section="agentsMd"]').click();await page.locator('#agentsMd').fill('submitted');await page.locator('[data-action="save-defaults"]').click();
    await expect(page.locator('[data-action-status][aria-busy="true"]')).toContainText('Saving defaults');await page.locator('#agentsMd').fill('newer unsaved draft');await expect(page.locator('[data-action="save-defaults"]')).toBeDisabled();
    gate.resolve();await expect(page.locator('main')).toContainText('Defaults saved');await expect(page.locator('#agentsMd')).toHaveValue('newer unsaved draft');await expect(page.locator('#dirty-label')).toContainText('fields changed');expect(requests.filter(r=>r.method==='PATCH').length).toBe(1);
  }finally{gate.resolve();}
});

test('S01 long waiting and diagnostics wrap on desktop and narrow screens with live status',async({page})=>{
  const gate=deferred();let armed=false;
  try{
    const requests=await fixture(page,async r=>{if(armed&&r.path==='admin/operations/op-1'){await gate.promise;return{json:{operationId:'op-1',name:'pkg',state:'failed',packagePhase:'validate',error:{message:'A bounded diagnostic detail. '.repeat(12)}}};}},'/operations/op-1');
    armed=true;const before=requests.filter(r=>r.path==='admin/operations/op-1').length;await page.locator('[data-action="refresh-operation"]').click();
    await expect(page.locator('[data-action-status][aria-busy="true"]')).toHaveAttribute('role','status');await expect(page.locator('[data-action-status][aria-busy="true"]')).toHaveAttribute('aria-live','polite');await expect(page.locator('[data-action-status]')).toContainText('Still waiting',{timeout:12000});expect(requests.filter(r=>r.path==='admin/operations/op-1').length-before).toBe(1);
    gate.resolve();await expect(page.locator('main')).toContainText('A bounded diagnostic detail.');
    const screenshots='/tmp/piwork-feedback-screens';await mkdir(screenshots,{recursive:true});for(const width of [1440,390]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:join(screenshots,`serve-long-status-${width}.png`),fullPage:true});}
  }finally{gate.resolve();}
});

test('flat long model defaults and 256-character names remain editable on narrow screens',async({page})=>{
 await page.setViewportSize({width:360,height:800});const state=await modelsFixture(page),model='m'.repeat(129),name='名'.repeat(256);
 await expect(page.getByLabel('Display name (optional)',{exact:true})).toHaveAttribute('data-model-max-length','256');
 await page.getByLabel('Model ID',{exact:true}).fill(model);await page.getByLabel('Base URL',{exact:true}).fill('https://fixture.invalid');await page.getByLabel('API Key',{exact:true}).fill('synthetic-long-browser');await page.getByRole('button',{name:'Add model',exact:true}).click();
 await expect(page.getByRole('link',{name:model,exact:true})).toBeVisible();await page.getByRole('link',{name:model,exact:true}).click();await expect(page.getByLabel('Display name (optional)',{exact:true})).toHaveValue(model);await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('');
 await page.getByLabel('Display name (optional)',{exact:true}).fill(name);await page.getByRole('button',{name:'Save model',exact:true}).click();await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();expect(state.models[0].name).toBe(name);expect(JSON.parse(state.writes.at(-1).body)).not.toHaveProperty('credential');
 await page.reload();await expect(page.getByLabel('Display name (optional)',{exact:true})).toHaveValue(name);
 const before=state.writes.length;await page.getByLabel('Display name (optional)',{exact:true}).fill('x'.repeat(257));expect(await page.getByLabel('Display name (optional)',{exact:true}).evaluate(input=>input.checkValidity())).toBe(false);await page.getByRole('button',{name:'Save model',exact:true}).click();expect(state.writes.length).toBe(before);await page.getByLabel('Display name (optional)',{exact:true}).fill('😀'.repeat(256));expect(await page.getByLabel('Display name (optional)',{exact:true}).evaluate(input=>input.checkValidity())).toBe(true);await page.getByRole('button',{name:'Save model',exact:true}).click();await expect(page.getByRole('heading',{name:'😀'.repeat(256),exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.content()).not.toContain('synthetic-long-browser');
});

test('flat model name errors describe the 256-character optional name instead of legacy provider limits',async({page})=>{
 await modelsFixture(page,r=>r.path==='admin/models'&&r.method==='POST'?{status:400,json:{code:'INVALID_REQUEST',field:'name',message:'Request fields are invalid'}}:undefined);
 await page.getByLabel('Model ID',{exact:true}).fill('model');await page.getByLabel('Display name (optional)',{exact:true}).fill('名'.repeat(256));await page.getByLabel('Base URL',{exact:true}).fill('https://fixture.invalid');await page.getByLabel('API Key',{exact:true}).fill('synthetic-name-error');await page.getByRole('button',{name:'Add model',exact:true}).click();
 await expect(page.locator('#model-field-error')).toContainText('256 characters');await expect(page.locator('#model-field-error')).toContainText('leave blank');await expect(page.locator('#model-field-error')).not.toContainText('128');await expect(page.getByLabel('Display name (optional)',{exact:true})).toHaveValue('名'.repeat(256));
});
