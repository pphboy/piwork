import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium, expect } from '@playwright/test';

const binary=process.env.PIWORK_TEST_UNIFIED_BIN || fileURLToPath(new URL('../../../../dist/go/piwork-serve',import.meta.url));
const browserOptions=process.env.PIWORK_TEST_BROWSER_BIN ? {executablePath:process.env.PIWORK_TEST_BROWSER_BIN,headless:true,args:['--no-proxy-server']} : {headless:true,channel:'chromium' as const,args:['--no-proxy-server']};
const serverIP=Object.entries(networkInterfaces()).filter(([name])=>/^(eth|en|wl)/.test(name)).flatMap(([,items])=>items||[]).find(item=>item.family==='IPv4'&&!item.internal)?.address || '127.0.0.1';

type BrowserServer={origin:string;directory:string;stop:(preserve?:boolean)=>Promise<void>;restart:()=>Promise<BrowserServer>;setupLink:()=>string;output:()=>string};
async function start(environment:Record<string,string>={}, existing?:{directory:string;port:number}):Promise<BrowserServer> {
  const directory=existing?.directory || await mkdtemp(join(tmpdir(),'piwork-unified-browser-'));
  const reserve=createServer(); await new Promise<void>(resolve=>reserve.listen(0,'0.0.0.0',resolve));
  const port=existing?.port || (reserve.address() as {port:number}).port; await new Promise<void>((resolve,reject)=>reserve.close(err=>err?reject(err):resolve()));
  const origin=`http://${serverIP}:${port}`;
  const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('PIWORK_')));
  const processHandle=spawn(binary,['--no-open','--listen',`0.0.0.0:${port}`,'--data-dir',directory,'--docker-host','unix://'+join(directory,'missing-engine.sock')],{env:{...env,...environment},stdio:['pipe','pipe','pipe']}) as ChildProcessWithoutNullStreams;
  let output='',stderr='',exited=false;
  processHandle.stdout.on('data',data=>{output+=data.toString();});
  processHandle.stderr.on('data',data=>{stderr+=data.toString();});
  processHandle.on('exit',()=>{exited=true;});
  const stop=async(preserve=false)=>{
    if(!exited) {
      processHandle.kill('SIGTERM');
      await new Promise<void>((resolve,reject)=>{
        const timeout=setTimeout(()=>{processHandle.kill('SIGKILL');reject(new Error('Unified server did not shut down within its budget.'));},50000);
        processHandle.once('exit',()=>{clearTimeout(timeout);resolve();});
      });
    }
    if(!preserve)await rm(directory,{recursive:true,force:true});
  };
  try {
    for(let i=0;i<200;i++) {
      if(exited)throw new Error(`Unified server startup failed: ${stderr}`);
      const ready=output.includes('"event":"app.listening"')&&(environment.PIWORK_ADMIN_ACCOUNT||output.includes('First-time setup:'));
      if(ready) return {origin,directory,stop,restart:async()=>{await stop(true);return start(environment,{directory,port});},setupLink:()=>output.split('\n').find(line=>line.startsWith('First-time setup: '))?.slice('First-time setup: '.length)||'',output:()=>output};
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw new Error('Unified server did not open its setup page.');
  } catch(error) {await stop();throw error;}
}

test('IP browser completes protected setup, model/runtime save, workbench and admin navigation',async()=>{
  const server=await start();
  const browser=await chromium.launch(browserOptions);
  try {
    const anonymous=await browser.newContext();
    const untrusted=await anonymous.newPage();
    await untrusted.goto(server.origin);
    await expect(untrusted.getByRole('heading',{name:'Open your setup link'})).toBeVisible();
    assert.equal(await untrusted.getByRole('button',{name:'Create administrator',exact:true}).count(),0);
    const context=await browser.newContext();
    const page=await context.newPage();
    const failures:string[]=[];
    page.on('pageerror',error=>failures.push(error.message));
    await page.goto(server.setupLink());
    await expect(page.getByRole('heading',{name:'Create your administrator'})).toBeVisible();
    assert.equal(new URL(page.url()).hash,'');
    await page.reload();
    await expect(page.getByRole('heading',{name:'Create your administrator'})).toBeVisible();
    await page.getByLabel('Account',{exact:true}).fill('admin');
    await page.getByLabel('Password',{exact:true}).fill('synthetic-password');
    await page.getByRole('button',{name:'Create administrator',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Sign in to Piwork'})).toBeVisible();
    await page.getByLabel('Account',{exact:true}).fill('admin');
    await page.getByLabel('Password',{exact:true}).fill('synthetic-password');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Set up your Core runtime'})).toBeVisible();
    await page.getByLabel('Model ID',{exact:true}).fill('synthetic-custom-model');
    await page.getByLabel('Base URL',{exact:true}).fill('https://models.example.invalid/v1');
    await page.getByLabel('API Key',{exact:true}).fill('synthetic-model-key');
    let tests=0;
    page.on('request',request=>{if(request.url().includes('/model-tests'))tests++;});
    await page.getByRole('button',{name:'Save model',exact:true}).click();
    await expect(page.getByText('Model saved. Next, save the runtime with this model.',{exact:true})).toBeVisible();
    await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('');
    await page.getByRole('button',{name:'Save runtime',exact:true}).click();
    await expect(page.getByText('Runtime saved. Dependency preparation continues in the background.',{exact:true})).toBeVisible();
    assert.equal(tests,0,'saving must not send a billed model Test');
    assert.equal(await page.locator('input[name=agentImage],select[name=agentImage]').count(),0);
    await expect(page.locator('[data-runtime-agent-image]')).not.toHaveText('Unavailable');
    const session=await page.evaluate(async()=>{const response=await fetch('/_web/api/session');return response.json();});
    assert.equal(session.authenticated,true);
    assert.equal('token' in session,false);
    const models=await page.evaluate(async()=>{const response=await fetch('/console/api/admin/models');return response.json();});
    assert.equal(models.models.length,1);
    const storage=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));
    assert.doesNotMatch(storage,/synthetic-password|synthetic-model-key/);
    await page.getByRole('link',{name:'Open workbench',exact:true}).click();
    await expect(page.locator('body')).not.toContainText('Browser access required');
    await expect(page.getByRole('heading',{name:'Works',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'New Work',exact:true}).first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('piwork-cli desktop');
    assert.equal(await page.evaluate(()=>window.isSecureContext),serverIP==='127.0.0.1');
    await page.goto(server.origin+'/admin/runtime');
    await expect(page.locator('h1')).toContainText('Runtime');
    assert.equal(new URL(page.url()).pathname,'/admin/runtime');
    await page.getByRole('link',{name:'User access',exact:true}).focus();await page.keyboard.press('Enter');
    await expect.poll(()=>new URL(page.url()).pathname).toBe('/admin/users');
    await page.reload();
    await expect(page.locator('h1')).toHaveText('Give people access');
    await page.goBack();await expect(page.locator('h1')).toContainText('Runtime');
    await page.goForward();await expect(page.locator('h1')).toHaveText('Give people access');
    await page.goto(server.origin+'/users');await expect.poll(()=>new URL(page.url()).pathname).toBe('/admin/users');
    await expect(page.locator('h1')).toHaveText('Give people access');
    await page.setViewportSize({width:360,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(failures,[]);
    await anonymous.close(); await context.close();
  } finally {await browser.close();await server.stop();}
});

test('optional ADMIN environment skips first-user setup while old model variables are ignored',async()=>{
  const server=await start({PIWORK_ADMIN_ACCOUNT:'admin',PIWORK_ADMIN_PASSWORD:'synthetic-password',PIWORK_MODEL_PROVIDER:'invalid legacy provider',PIWORK_MODEL_ID:'legacy-model',PIWORK_MODEL_API_KEY:'synthetic-ignored-key',PIWORK_AGENT_IMAGE:'invalid legacy image'});
  const browser=await chromium.launch(browserOptions);
  try {
    assert.equal(server.setupLink(),'');
    assert.doesNotMatch(server.output(),/synthetic-password|synthetic-ignored-key/);
    const page=await browser.newPage();
    await page.goto(server.origin);
    await expect(page.getByRole('heading',{name:'Sign in to Piwork'})).toBeVisible();
    await page.getByLabel('Account',{exact:true}).fill('admin');
    await page.getByLabel('Password',{exact:true}).fill('synthetic-password');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Set up your Core runtime'})).toBeVisible();
    const models=await page.evaluate(async()=>{const response=await fetch('/console/api/admin/models');return response.json();});
    assert.deepEqual(models.models,[]);
    await expect(page.getByText('Runtime not configured.',{exact:true})).toBeVisible();
  } finally {await browser.close();await server.stop();}
});


test('lost model/runtime responses are read back without replay and survive restart',async()=>{
 let server=await start({PIWORK_ADMIN_ACCOUNT:'admin',PIWORK_ADMIN_PASSWORD:'synthetic-password'});
 const browser=await chromium.launch(browserOptions);
 let releaseStale=()=>{};
 try {
  const context=await browser.newContext();const page=await context.newPage();
  await page.goto(server.origin+'/login');
  await page.getByLabel('Account',{exact:true}).fill('admin');await page.getByLabel('Password',{exact:true}).fill('synthetic-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Set up your Core runtime'})).toBeVisible();
  let held=false,captured=()=>{};
  const staleCaptured=new Promise<void>(resolve=>{captured=resolve;});
  const release=new Promise<void>(resolve=>{releaseStale=resolve;});
  await page.route('**/_web/api/onboarding',async route=>{if(held){await route.continue();return;}held=true;const response=await route.fetch();captured();await release;await route.fulfill({response});});
  await staleCaptured;
  await page.getByLabel('Model ID',{exact:true}).fill('lost-response-model');await page.getByLabel('Base URL',{exact:true}).fill('https://models.example.invalid/v1');await page.getByLabel('API Key',{exact:true}).fill('synthetic-key');
  let tests=0,models=0,runtimes=0;
  await page.route('**/console/api/admin/model-tests',async route=>{tests++;await route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({code:'MODEL_TEST_FAILED',message:'Synthetic unavailable model'})});});
  await page.getByRole('button',{name:'Test connection',exact:true}).click();
  await expect(page.locator('#test-result')).toContainText('You may still save');assert.equal(tests,1);
  await page.route('**/console/api/admin/models',async route=>{if(route.request().method()!=='POST'){await route.continue();return;}models++;await route.fetch();await route.abort('failed');});
  await page.getByRole('button',{name:'Save model',exact:true}).click();
  await expect(page.getByText('The saved model was confirmed by reading current data.',{exact:true})).toBeVisible();
  assert.equal(models,1);assert.equal(tests,1);
  await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('');
  await page.route('**/console/api/admin/runtime',async route=>{if(route.request().method()!=='PUT'){await route.continue();return;}runtimes++;await route.fetch();await route.abort('failed');});
  await page.getByRole('button',{name:'Save runtime',exact:true}).click();
  await expect(page.getByText('The saved runtime was confirmed by reading current data.',{exact:true})).toBeVisible();assert.equal(runtimes,1);
  const currentPreparation=await page.locator('#preparation-summary').innerText();
  const staleReply=page.waitForResponse(response=>new URL(response.url()).pathname==='/_web/api/onboarding');releaseStale();await staleReply;
  await expect(page.locator('#preparation-summary')).toHaveText(currentPreparation);

  await page.goto(server.origin+'/');await page.goto(server.origin+'/setup');
  await expect(page.locator('#runtime-result')).toHaveText('Runtime saved.');
  await expect(page.locator('#saved-model')).toContainText('lost-response-model');
  server=await server.restart();
  await page.goto(server.origin+'/setup');await expect(page.getByRole('heading',{name:'Sign in to Piwork'})).toBeVisible();
  await page.getByLabel('Account',{exact:true}).fill('admin');await page.getByLabel('Password',{exact:true}).fill('synthetic-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Works',exact:true})).toBeVisible();
  await page.goto(server.origin+'/setup');await expect(page.locator('#runtime-result')).toHaveText('Runtime saved.');
  await expect(page.locator('#saved-model')).toContainText('lost-response-model');
  const state=await page.evaluate(async()=>({models:await(await fetch('/console/api/admin/models')).json(),storage:JSON.stringify({local:{...localStorage},session:{...sessionStorage}})}));
  assert.equal(state.models.models.length,1);assert.doesNotMatch(state.storage,/synthetic-key|synthetic-password/);
  assert.equal(models,1);assert.equal(runtimes,1);
 }finally{releaseStale();await browser.close();await server.stop();}
});

test('lost setup responses recover through readback without replaying either mutation',async()=>{
 const server=await start();const browser=await chromium.launch(browserOptions);
 try {
  const context=await browser.newContext();const page=await context.newPage();let exchanges=0,creations=0;
  await page.route('**/_web/api/setup/redeem',async route=>{exchanges++;await route.fetch();await route.abort('failed');});
  await page.route('**/_web/api/setup/administrator',async route=>{creations++;await route.fetch();await route.abort('failed');});
  await page.goto(server.setupLink());await expect(page.getByRole('heading',{name:'Create your administrator'})).toBeVisible();
  assert.equal(exchanges,1);assert.equal(new URL(page.url()).hash,'');
  await page.getByLabel('Account',{exact:true}).fill('admin');await page.getByLabel('Password',{exact:true}).fill('synthetic-password');await page.getByRole('button',{name:'Create administrator',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Open your setup link'})).toBeVisible();assert.equal(await page.locator('[name=password]').count(),0);
  await page.getByRole('button',{name:'Check setup access',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign in to Piwork'})).toBeVisible();
  assert.equal(creations,1);assert.equal(exchanges,1);
  assert.doesNotMatch(await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}})),/synthetic-password/);
 }finally{await browser.close();await server.stop();}
});

for(const entry of ['/admin/runtime','/runtime'])test(`first runtime through ${entry} uses release Agent without an image input`,async()=>{
 const server=await start({PIWORK_ADMIN_ACCOUNT:'admin',PIWORK_ADMIN_PASSWORD:'synthetic-password'});
 const browser=await chromium.launch(browserOptions);
 try{
  const page=await browser.newPage();await page.goto(server.origin+'/login');
  await page.getByLabel('Account',{exact:true}).fill('admin');await page.getByLabel('Password',{exact:true}).fill('synthetic-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Set up your Core runtime'})).toBeVisible();
  await expect(page.locator('input[name=agentImage],select[name=agentImage]')).toHaveCount(0);await expect(page.locator('body')).not.toContainText('Advanced image override');
  await page.getByLabel('Model ID',{exact:true}).fill('custom-runtime-model');await page.getByLabel('Base URL',{exact:true}).fill('https://models.example.invalid/v1');await page.getByLabel('API Key',{exact:true}).fill('synthetic-model-key');await page.getByRole('button',{name:'Save model',exact:true}).click();
  await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('');
  const metadata=await page.evaluate(async()=>(await fetch('/console/api/admin/runtime-defaults')).json());
  await page.goto(server.origin+entry);await expect(page.locator('#runtime-form')).toBeVisible();
  assert.equal(new URL(page.url()).pathname,'/admin/runtime');await expect(page.locator('#agentImage,input[name=agentImage],select[name=agentImage]')).toHaveCount(0);
  await expect(page.locator('[data-runtime-agent-image]')).toHaveText(metadata.agentImage);
  await page.locator('#modelRef').selectOption({index:1});
  const request=page.waitForRequest(r=>r.method()==='PUT'&&new URL(r.url()).pathname==='/console/api/admin/runtime');
  await page.getByRole('button',{name:'Save runtime',exact:true}).click();
  assert.deepEqual(Object.keys((await request).postDataJSON()),['modelRef']);
  await expect(page.getByRole('button',{name:'Edit runtime',exact:true})).toBeVisible();
  const saved=await page.evaluate(async()=>(await fetch('/console/api/admin/runtime')).json());assert.equal(saved.agentImage,metadata.agentImage);
  await page.goto(server.origin+'/admin/default-work');await expect(page.locator('#default-image')).toHaveCount(0);await expect(page.getByRole('button',{name:'Edit image',exact:true})).toHaveCount(0);
 }finally{await browser.close();await server.stop();}
});
