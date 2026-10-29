import assert from 'node:assert/strict';
import { spawn,execFileSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium, expect, type Page } from '@playwright/test';

const binary=process.env.PIWORK_TEST_UNIFIED_BIN || fileURLToPath(new URL('../../../../dist/go/piwork-core',import.meta.url));
const browserOptions=process.env.PIWORK_TEST_BROWSER_BIN ? {executablePath:process.env.PIWORK_TEST_BROWSER_BIN,headless:true,args:['--no-proxy-server']} : {headless:true,channel:'chromium' as const,args:['--no-proxy-server']};
const serverIP=Object.entries(networkInterfaces()).filter(([name])=>/^(eth|en|wl)/.test(name)).flatMap(([,items])=>items||[]).find(item=>item.family==='IPv4'&&!item.internal)?.address || '127.0.0.1';

function coreOrigin(server:BrowserServer):string {
 const event=server.output().split('\n').map(line=>{try{return JSON.parse(line);}catch{return null;}}).find(value=>value?.event==='app.listening');
 assert(event?.coreUrl);assert.notEqual(event.coreUrl,server.origin);return event.coreUrl;
}
type BrowserServer={origin:string;directory:string;stop:(preserve?:boolean)=>Promise<void>;restart:()=>Promise<BrowserServer>;output:()=>string};
async function start(environment:Record<string,string>={}, existing?:{directory:string;port:number}, engineHost?:string):Promise<BrowserServer> {
  const directory=existing?.directory || await mkdtemp(join(tmpdir(),'piwork-unified-browser-'));
  const reserve=createServer(); await new Promise<void>(resolve=>reserve.listen(existing?.port || 0,'0.0.0.0',resolve));
  const port=(reserve.address() as {port:number}).port;
  const origin=`http://${serverIP}:${port}`;
  const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('PIWORK_')));
  // Keep the UI port reserved while choosing Core's port, including restarts.
  const coreReserve=createServer();await new Promise<void>(done=>coreReserve.listen(0,'127.0.0.1',done));
  const corePort=(coreReserve.address() as {port:number}).port;await new Promise<void>(done=>coreReserve.close(()=>done()));
  await new Promise<void>((resolve,reject)=>reserve.close(err=>err?reject(err):resolve()));
  const processHandle=spawn(binary,['--ui-port',String(port),'--core-port',String(corePort),'--data-dir',directory],{env:{...env,...environment,DISPLAY:'',WAYLAND_DISPLAY:'',DOCKER_HOST:engineHost||'unix://'+join(directory,'missing-engine.sock')},stdio:['pipe','pipe','pipe']}) as ChildProcessWithoutNullStreams;
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
      const ready=output.includes('"event":"app.listening"');
      if(ready) return {origin,directory,stop,restart:async()=>{await stop(true);return start(environment,{directory,port},engineHost);},output:()=>output};
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw new Error('Unified server did not open its setup page.');
  } catch(error) {await stop();throw error;}
}

test('real Go entry recovery preserves the exact URL without scripts or styles',async()=>{
  const server=await start(),browser=await chromium.launch(browserOptions);
  try {
    const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:360,height:800}}),page=await context.newPage();
    const writes:string[]=[];
    page.on('request',request=>{if(request.method()!=='GET')writes.push(request.method());});
    await page.route('**/*.css',route=>route.abort());
    const reload=async(path:string)=>{
      const original=server.origin+path;
      await page.goto(original);
      await page.keyboard.press('Tab');
      await expect(page.locator('[data-boot-recovery]')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(original);
      await expect(page.locator('[data-boot-recovery]')).toBeVisible();
    };
    await reload('/setup?view=one%20two&tag=a&tag=b&bare&_charset_=original#setup-target');
    await reload('/login?returnTo=%2Fservices%2Fw%2Fs%2F8080%2F#login-target');
    const session=await(await context.request.get(server.origin+'/_web/api/session')).json();
    const headers={'X-Piwork-Csrf':session.csrfToken,Origin:server.origin};
    const credentials={account:'admin',password:'synthetic-password'};
    const created=await context.request.post(server.origin+'/_web/api/setup/administrator',{headers,data:credentials});
    assert.equal(created.status(),201);
    const signedIn=await context.request.post(server.origin+'/_web/api/login',{headers,data:credentials});
    assert.equal(signedIn.status(),200);
    await reload('/#work/session');
    await reload('/?view=one%20two&tag=a&tag=b&bare&_charset_=original#work/session');
    await reload('/admin#admin-target');
    await reload('/admin/setup?step=prepare#admin-target');
    assert.deepEqual(writes,[]);
    await context.close();
  }finally{await browser.close();await server.stop();}
});

test('IP browser directly creates an administrator, model/runtime save, workbench and admin navigation',async()=>{
  const server=await start();
  const browser=await chromium.launch(browserOptions);
  try {
    const anonymous=await browser.newContext();
    const untrusted=await anonymous.newPage();
    await untrusted.goto(server.origin);
    await expect(untrusted.getByRole('heading',{name:'Create your administrator'})).toBeVisible();
    await expect(untrusted.getByRole('button',{name:'Create administrator',exact:true})).toBeVisible();
    assert.doesNotMatch(server.output(), /First-time setup:|#setup=/);
    const context=await browser.newContext();
    const page=await context.newPage();
    const failures:string[]=[];
    page.on('pageerror',error=>failures.push(error.message));
    await page.goto(server.origin);
    await expect(page.getByRole('heading',{name:'Create your administrator'})).toBeVisible();
    assert.equal(new URL(page.url()).hash,'');
    await page.reload();
    await expect(page.getByRole('heading',{name:'Create your administrator'})).toBeVisible();
    await page.getByLabel('Account',{exact:true}).fill('admin');
    await page.getByLabel('Password',{exact:true}).fill('synthetic-password');
    await page.getByLabel('Confirm password',{exact:true}).fill('synthetic-password');
    await page.getByRole('button',{name:'Create administrator',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Sign in to Piwork'})).toBeVisible();
    await page.getByLabel('Account',{exact:true}).fill('admin');
    await page.getByLabel('Password',{exact:true}).fill('synthetic-password');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Set up your Core runtime'})).toBeVisible();
    await openModelAdvanced(page);await page.getByLabel('Model ID',{exact:true}).fill('synthetic-custom-model');
    await page.getByLabel('Base URL',{exact:true}).fill('https://models.example.invalid/v1');
    await page.getByLabel('API Key',{exact:true}).fill('synthetic-model-key');
    let tests=0;
    page.on('request',request=>{if(request.url().includes('/model-tests'))tests++;});
    await page.getByRole('button',{name:'Save and continue',exact:true}).click();
    await expect(page.getByText('Your Runtime configuration is saved on this server.',{exact:true})).toBeVisible();
    assert.equal(tests,0,'saving must not send a billed model Test');
    assert.equal(await page.locator('input[name=agentImage],select[name=agentImage]').count(),0);
    await page.getByText('Runtime diagnostics',{exact:true}).click();
    await expect(page.locator('[data-runtime-agent-image]')).not.toHaveText('Unavailable');
    const session=await page.evaluate(async()=>{const response=await fetch('/_web/api/session');return response.json();});
    assert.equal(session.authenticated,true);
    assert.equal('token' in session,false);
    const models=await page.evaluate(async()=>{const response=await fetch('/console/api/admin/models');return response.json();});
    assert.equal(models.models.length,1);
    const storage=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));
    assert.doesNotMatch(storage,/synthetic-password|synthetic-model-key/);
    await expect(page.getByRole('link',{name:'Open workbench',exact:true})).toBeDisabled();
    await page.goto(server.origin+'/');
    await expect(page.locator('body')).not.toContainText('Browser access required');
    await expect(page.locator('.core-startup-page')).toBeVisible();
    await expect(page.getByRole('button',{name:'New Work',exact:true})).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('piwork-cli desktop');
    assert.equal(await page.evaluate(()=>window.isSecureContext),serverIP==='127.0.0.1');
    await page.goto(server.origin+'/admin/runtime');
    await expect(page.locator('h1')).toContainText('Runtime');
    await expect(page.getByRole('button',{name:'Edit runtime',exact:true})).toBeVisible();
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
    assert.doesNotMatch(server.output(),/First-time setup:|#setup=/);
    assert.doesNotMatch(server.output(),/synthetic-password|synthetic-ignored-key/);
    const page=await browser.newPage();
    await page.goto(server.origin);
    await expect(page.getByRole('heading',{name:'Sign in to Piwork'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Sign out',exact:true})).toHaveCount(0);
    await page.getByLabel('Account',{exact:true}).fill('admin');
    await page.getByLabel('Password',{exact:true}).fill('synthetic-password');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Set up your Core runtime'})).toBeVisible();
    const models=await page.evaluate(async()=>{const response=await fetch('/console/api/admin/models');return response.json();});
    assert.deepEqual(models.models,[]);
    await expect(page.getByLabel('Model ID',{exact:true})).toHaveValue('deepseek-flash');await expect(page.getByLabel('Model ID',{exact:true})).toBeHidden();
    assert.equal(await page.getByLabel('Password',{exact:true}).count(),0);
  } finally {await browser.close();await server.stop();}
});


test('lost model/runtime responses are read back without replay and survive restart',async()=>{
 let server=await start({PIWORK_ADMIN_ACCOUNT:'admin',PIWORK_ADMIN_PASSWORD:'synthetic-password'});
 const browser=await chromium.launch(browserOptions);
 let releaseStale=()=>{};
 try {
  const context=await browser.newContext();const page=await context.newPage();await page.clock.install();
  await page.goto(server.origin+'/login');
  await page.getByLabel('Account',{exact:true}).fill('admin');await page.getByLabel('Password',{exact:true}).fill('synthetic-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Set up your Core runtime'})).toBeVisible();
  let held=false,captured=()=>{};
  const staleCaptured=new Promise<void>(resolve=>{captured=resolve;});
  const release=new Promise<void>(resolve=>{releaseStale=resolve;});
  await page.route('**/_web/api/onboarding',async route=>{if(held){await route.continue();return;}held=true;const response=await route.fetch();captured();await release;await route.fulfill({response});});
  await page.clock.fastForward(5001);await staleCaptured;
  await openModelAdvanced(page);await page.getByLabel('Model ID',{exact:true}).fill('lost-response-model');await page.getByLabel('API type',{exact:true}).selectOption('openai-responses');await page.getByLabel('Base URL',{exact:true}).fill('https://models.example.invalid/v1');await page.getByLabel('API Key',{exact:true}).fill('synthetic-key');
  let tests=0,models=0,runtimes=0;
  await page.route('**/console/api/admin/model-tests',async route=>{tests++;await route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({code:'MODEL_TEST_FAILED',message:'Synthetic unavailable model'})});});
  await page.getByRole('button',{name:'Test',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('The request failed. Check the current state before continuing.');await expect(page.getByRole('dialog')).not.toContainText('Synthetic unavailable model');await page.getByRole('button',{name:'Close',exact:true}).click();assert.equal(tests,1);
  await page.route('**/console/api/admin/models',async route=>{if(route.request().method()!=='POST'){await route.continue();return;}models++;await route.fetch();await route.abort('failed');});
  await page.getByRole('button',{name:'Save and continue',exact:true}).click();
  await expect(page.locator('#setup-notice')).toContainText('The model save result is unconfirmed');
  releaseStale();
  await readSetupAutomatically(page);
  await expect(page.locator('#setup-notice')).toContainText('Model save confirmed');
  assert.equal(models,1);assert.equal(tests,1);
  assert.equal(await page.getByLabel('API Key',{exact:true}).count(),0);
  await page.route('**/console/api/admin/runtime',async route=>{if(route.request().method()!=='PUT'){await route.continue();return;}runtimes++;await route.fetch();await route.abort('failed');});
  await page.getByRole('button',{name:'Save and continue',exact:true}).click();
  await expect(page.locator('#setup-notice')).toContainText('Runtime save is unconfirmed');
  await readSetupAutomatically(page);
  await expect(page.locator('#preparation-answer')).toBeVisible();assert.equal(runtimes,1);
  await page.goto(server.origin+'/');await page.goto(server.origin+'/admin/setup?step=prepare');
  await expect(page.locator('#preparation-answer')).toBeVisible();
  server=await server.restart();
  await page.goto(server.origin+'/setup');await expect(page.getByRole('heading',{name:'Sign in to Piwork'})).toBeVisible();
  await page.getByLabel('Account',{exact:true}).fill('admin');await page.getByLabel('Password',{exact:true}).fill('synthetic-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.locator('.core-startup-page')).toBeVisible();
  await page.goto(server.origin+'/admin/setup?step=prepare');await expect(page.locator('#preparation-answer')).toBeVisible();
  const state=await page.evaluate(async()=>({models:await(await fetch('/console/api/admin/models')).json(),storage:JSON.stringify({local:{...localStorage},session:{...sessionStorage}})}));
  assert.equal(state.models.models.length,1);assert.doesNotMatch(state.storage,/synthetic-key|synthetic-password/);
  assert.equal(models,1);assert.equal(runtimes,1);
 }finally{releaseStale();await browser.close();await server.stop();}
});

test('plain IP onboarding survives new browsers, cookie clearing, legacy links and restart',async()=>{
 let server=await start();const browser=await chromium.launch(browserOptions);
 try {
  const context=await browser.newContext();const page=await context.newPage();
  const requests:string[]=[];page.on('request',r=>requests.push(new URL(r.url()).pathname));
  await page.goto(server.origin+'/setup#setup=obsolete-proof');
  await expect(page.getByRole('heading',{name:'Create your administrator'})).toBeVisible();
  assert.equal(new URL(page.url()).hash,'');
  await context.clearCookies();await page.reload();
  await expect(page.getByRole('heading',{name:'Create your administrator'})).toBeVisible();
  server=await server.restart();await page.goto(server.origin);
  await expect(page.getByRole('heading',{name:'Create your administrator'})).toBeVisible();
  await page.getByLabel('Account',{exact:true}).fill('admin');
  await page.getByLabel('Password',{exact:true}).fill('synthetic-password');
  await page.getByLabel('Confirm password',{exact:true}).fill('synthetic-password');
  await page.getByRole('button',{name:'Create administrator',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Sign in to Piwork'})).toBeVisible();
  await page.getByLabel('Account',{exact:true}).fill('admin');
  await page.getByLabel('Password',{exact:true}).fill('synthetic-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Set up your Core runtime'})).toBeVisible();
  const other=await browser.newContext();const second=await other.newPage();
  await second.goto(server.origin);
  await expect(second.getByRole('heading',{name:'Sign in to Piwork'})).toBeVisible();
  await context.clearCookies();await page.goto(server.origin);
  await expect(page.getByRole('heading',{name:'Sign in to Piwork'})).toBeVisible();
  server=await server.restart();await page.goto(server.origin+'/setup#setup=used-proof');
  await expect(page.getByRole('heading',{name:'Sign in to Piwork'})).toBeVisible();
  assert.equal(new URL(page.url()).hash,'');
  assert.equal(requests.some(path=>path.endsWith('/setup/redeem')||path.endsWith('/setup/session')),false);
  await expect(page.locator('body')).not.toContainText('Open your setup link');
  await expect(page.getByRole('button',{name:'Check setup access',exact:true})).toHaveCount(0);
 }finally{await browser.close();await server.stop();}
});

test('uncommitted administrator response only reads state and leaves an explicit create action',async()=>{
 const server=await start();const browser=await chromium.launch(browserOptions);
 try {
  const page=await browser.newPage();let creations=0;
  await page.route('**/_web/api/setup/administrator',async route=>{creations++;await route.abort('failed');});
  await page.goto(server.origin);
  await page.getByLabel('Account',{exact:true}).fill('admin');await page.getByLabel('Password',{exact:true}).fill('synthetic-password');await page.getByLabel('Confirm password',{exact:true}).fill('synthetic-password');
  await page.getByRole('button',{name:'Create administrator',exact:true}).click();
  await expect(page.locator('#setup-notice')).toContainText('Creation was not confirmed');
  await expect(page.getByRole('heading',{name:'Create your administrator'})).toBeVisible();
  await expect(page.getByLabel('Password',{exact:true})).toHaveValue('');
  assert.equal(creations,1);
  await expect(page.locator('body')).not.toContainText('Open your setup link');
  await page.unroute('**/_web/api/setup/administrator');
  await page.getByLabel('Password',{exact:true}).fill('synthetic-password');await page.getByLabel('Confirm password',{exact:true}).fill('synthetic-password');
  await page.getByRole('button',{name:'Create administrator',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Sign in to Piwork'})).toBeVisible();
 }finally{await browser.close();await server.stop();}
});

test('lost administrator creation response recovers through ordinary readback without replay',async()=>{
 const server=await start();const browser=await chromium.launch(browserOptions);
 try {
  const context=await browser.newContext();const page=await context.newPage();let creations=0;
  await page.route('**/_web/api/setup/administrator',async route=>{creations++;await route.fetch();await route.abort('failed');});
  await page.goto(server.origin);await expect(page.getByRole('heading',{name:'Create your administrator'})).toBeVisible();
  assert.equal(new URL(page.url()).hash,'');
  await page.getByLabel('Account',{exact:true}).fill('admin');await page.getByLabel('Password',{exact:true}).fill('synthetic-password');await page.getByLabel('Confirm password',{exact:true}).fill('synthetic-password');await page.getByRole('button',{name:'Create administrator',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Sign in to Piwork'})).toBeVisible();
  await expect(page.getByLabel('Password',{exact:true})).toHaveValue('');
  assert.equal(await page.getByLabel('Confirm password',{exact:true}).count(),0);
  assert.equal(creations,1);
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
  await page.route('**/console/api/admin/runtime',async route=>{if(route.request().method()==='PUT')await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'INVALID_REQUEST',message:'Synthetic binding failure'})});else await route.continue();});
  await openModelAdvanced(page);await page.getByLabel('Model ID',{exact:true}).fill('custom-runtime-model');await page.getByLabel('Base URL',{exact:true}).fill('https://models.example.invalid/v1');await page.getByLabel('API Key',{exact:true}).fill('synthetic-model-key');await page.getByRole('button',{name:'Save and continue',exact:true}).click();
  await expect(page.locator('#setup-notice')).toContainText('Model saved. Runtime was not bound.');
  await page.unroute('**/console/api/admin/runtime');
  const metadata=await page.evaluate(async()=>(await fetch('/console/api/admin/runtime-defaults')).json());
  await page.goto(server.origin+entry);await expect(page.locator('#runtime-form')).toBeVisible();
  assert.equal(new URL(page.url()).pathname,'/admin/runtime');await expect(page.locator('#agentImage,input[name=agentImage],select[name=agentImage]')).toHaveCount(0);
  await page.getByText('Runtime diagnostics',{exact:true}).click();
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

async function loginSetup(page:any,server:BrowserServer) {
 await page.goto(server.origin+'/login');
 await page.getByLabel('Account',{exact:true}).fill('admin');
 await page.getByLabel('Password',{exact:true}).fill('synthetic-password');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Set up your Core runtime'})).toBeVisible();
}
async function openModelAdvanced(page:Page) {
 const advanced=page.locator('#model-advanced');await expect(advanced).toBeAttached();
 if(!await advanced.evaluate((el:HTMLDetailsElement)=>el.open))await advanced.locator('summary').click();
 await expect(page.getByLabel('Model ID',{exact:true})).toBeVisible();
}
async function readSetupAutomatically(page:Page) {
 // Observe a new request from the existing timer, not a released older response.
 const read=page.waitForRequest(request=>new URL(request.url()).pathname==='/_web/api/onboarding'&&request.method()==='GET');
 await page.clock.fastForward(5001);
 const response=await(await read).response();assert.ok(response);
 await response.finished();
}
async function openQuickSetup(page:Page) {
 const originalDocument=await page.evaluateHandle(()=>document);
 const entry=page.locator('main a[href^="/admin/setup"]');
 await expect(entry).toHaveCount(1);await entry.click();
 await expect(page).toHaveURL(url=>url.pathname==='/admin/setup');
 // Keep pending callbacks alive when the contextual entry opens preparation.
 // Reenter the canonical model route through the existing browser-history handler.
 if(new URL(page.url()).searchParams.get('step')==='prepare')await page.evaluate(()=>{
  history.pushState(null,'','/admin/setup');window.dispatchEvent(new PopStateEvent('popstate'));
 });
 await expect(page.getByRole('heading',{name:'Set up your Core runtime'})).toBeVisible();
 assert.equal(await originalDocument.evaluate(node=>node===document),true);await originalDocument.dispose();
}
async function fillModel(page:any,name='setup-fixture') {
 await openModelAdvanced(page);
 await page.getByLabel('Model ID',{exact:true}).fill(name);
 // This fixture's /v1 address belongs to Responses, independently of first-install defaults.
 await page.getByLabel('API type',{exact:true}).selectOption('openai-responses');
 await page.getByLabel('Base URL',{exact:true}).fill('https://models.example.invalid/v1');
 await page.getByLabel('API Key',{exact:true}).fill('synthetic-model-key');
}

test('Create admin validates current passwords locally, focuses errors, and sends one existing credentials payload',async()=>{
 const server=await start(),browser=await chromium.launch(browserOptions);
 try {
  const page=await browser.newPage();let posts:any[]=[];let release=()=>{};
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/_web/api/setup/administrator',async route=>{posts.push(route.request().postDataJSON());await gate;await route.continue();});
  await page.goto(server.origin);
  await expect(page.locator('.field-error:visible')).toHaveCount(0);
  await expect(page.getByLabel('Password',{exact:true})).toHaveAttribute('autocomplete','new-password');
  await expect(page.getByLabel('Confirm password',{exact:true})).toHaveAttribute('autocomplete','new-password');
  await page.getByRole('button',{name:'Create administrator',exact:true}).click();
  await expect(page.getByLabel('Account',{exact:true})).toBeFocused();assert.equal(posts.length,0);
  await page.getByLabel('Account',{exact:true}).fill('admin');
  await page.getByLabel('Password',{exact:true}).fill('12345678901');
  await page.getByLabel('Confirm password',{exact:true}).fill('12345678901');
  await page.getByRole('button',{name:'Create administrator',exact:true}).click();
  await expect(page.getByLabel('Password',{exact:true})).toBeFocused();await expect(page.locator('#password-error')).toContainText('at least 12');assert.equal(posts.length,0);
  await page.getByLabel('Password',{exact:true}).fill('123456789012');
  await page.getByLabel('Confirm password',{exact:true}).fill('different-password');await page.keyboard.press('Tab');
  await expect(page.locator('#confirm-password-error')).toContainText('do not match');
  await page.getByRole('button',{name:'Create administrator',exact:true}).click();await expect(page.getByLabel('Confirm password',{exact:true})).toBeFocused();assert.equal(posts.length,0);
  await page.getByLabel('Confirm password',{exact:true}).fill('123456789012');await expect(page.locator('#confirm-password-error')).toBeHidden();
  await page.getByLabel('Password',{exact:true}).fill('1234567890123');await expect(page.locator('#confirm-password-error')).toContainText('do not match');assert.equal(posts.length,0);
  // Preserve the raw password, including spaces; confirmation is not trimmed.
  await page.getByLabel('Password',{exact:true}).fill(' raw-password ');
  await page.getByLabel('Confirm password',{exact:true}).fill('raw-password');await page.getByRole('button',{name:'Create administrator',exact:true}).click();assert.equal(posts.length,0);
  await page.getByLabel('Confirm password',{exact:true}).fill(' raw-password ');
  await page.getByLabel('Confirm password',{exact:true}).press('Enter');
  await expect(page.getByRole('button',{name:'Create administrator',exact:true})).toBeDisabled();
  await page.locator('#credentials').evaluate(form=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  await expect.poll(()=>posts.length).toBe(1);assert.deepEqual(posts,[{account:'admin',password:' raw-password '}]);
  release();await expect(page.getByRole('heading',{name:'Sign in to Piwork'})).toBeVisible();
  await expect(page.locator('input[type=password]')).toHaveCount(1);await expect(page.getByLabel('Password',{exact:true})).toHaveValue('');
  assert.doesNotMatch(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage})),/raw-password/);
 } finally {await browser.close();await server.stop();}
});

test('rejected admin creation clears passwords and recovers ordinary CSRF without a gate',async()=>{
 const server=await start(),browser=await chromium.launch(browserOptions);
 try {
  const page=await browser.newPage();let count=0;
  await page.route('**/_web/api/setup/administrator',async route=>{count++;await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'INVALID_REQUEST',message:'Synthetic account failure'})});});
  await page.goto(server.origin);await page.getByLabel('Account',{exact:true}).fill('admin');await page.getByLabel('Password',{exact:true}).fill('synthetic-password');await page.getByLabel('Confirm password',{exact:true}).fill('synthetic-password');await page.getByRole('button',{name:'Create administrator',exact:true}).click();
  await expect(page.locator('#setup-notice')).toContainText('The request failed. Check the current state before continuing.');await expect(page.locator('#setup-notice')).not.toContainText('Synthetic account failure');await expect(page.getByLabel('Account',{exact:true})).toHaveValue('admin');await expect(page.getByLabel('Password',{exact:true})).toHaveValue('');await expect(page.getByLabel('Confirm password',{exact:true})).toHaveValue('');assert.equal(count,1);
  await page.unroute('**/_web/api/setup/administrator');
  await page.route('**/_web/api/setup/administrator',route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({code:'CSRF_INVALID'})}));
  await page.getByLabel('Password',{exact:true}).fill('synthetic-password');await page.getByLabel('Confirm password',{exact:true}).fill('synthetic-password');await page.getByRole('button',{name:'Create administrator',exact:true}).click();await expect(page.getByRole('heading',{name:'Create your administrator'})).toBeVisible();await expect(page.locator('#setup-notice')).toContainText('form session expired');await expect(page.locator('input[type=password]')).toHaveCount(2);await expect(page.getByLabel('Password',{exact:true})).toHaveValue('');
 } finally {await browser.close();await server.stop();}
});

test('model save is confirmed separately; rejected binding retries only Runtime and never Test or Work',async()=>{
 const server=await start({PIWORK_ADMIN_ACCOUNT:'admin',PIWORK_ADMIN_PASSWORD:'synthetic-password'}),browser=await chromium.launch(browserOptions);
 try {
  const page=await browser.newPage();await loginSetup(page,server);let creates=0,bindings=0,tests=0,works=0;
  page.on('request',request=>{const path=new URL(request.url()).pathname;if(request.method()==='POST'&&path==='/console/api/admin/models')creates++;if(path.endsWith('/model-tests'))tests++;if(request.method()==='POST'&&path.endsWith('/works'))works++;});
  await page.route('**/console/api/admin/runtime',async route=>{if(route.request().method()!=='PUT'){await route.continue();return;}bindings++;if(bindings===1)await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'INVALID_REQUEST',message:'Synthetic Runtime rejection'})});else await route.continue();});
  await fillModel(page);await page.getByRole('button',{name:'Save and continue',exact:true}).dblclick();
  await expect(page.locator('#setup-notice')).toContainText('Model saved. Runtime was not bound.');await expect(page.getByLabel('API Key',{exact:true})).toHaveCount(0);await expect(page.getByLabel('Saved model',{exact:true})).toHaveValue(/model/);
  assert.equal(creates,1);assert.equal(bindings,1);
  await page.getByRole('button',{name:'Save and continue',exact:true}).click();await expect(page.locator('#preparation-answer')).toBeVisible();assert.equal(creates,1);assert.equal(bindings,2);assert.equal(tests,0);assert.equal(works,0);
  await page.getByRole('link',{name:'Overview',exact:true}).click();await page.goto(server.origin+'/admin/runtime');await expect(page.getByRole('button',{name:'Edit runtime',exact:true})).toBeVisible();await page.goto(server.origin+'/admin/setup?step=prepare');await expect(page.locator('#preparation-answer')).toBeVisible();assert.equal(bindings,2,'Reading an unchanged confirmed Runtime needs no repeated write');
 } finally {await browser.close();await server.stop();}
});

for(const outcome of ['rejected','lost-response'])test(`a new model ${outcome} after rejected Runtime binding recovers only its own save chain`,async()=>{
 const server=await start({PIWORK_ADMIN_ACCOUNT:'admin',PIWORK_ADMIN_PASSWORD:'synthetic-password'}),browser=await chromium.launch(browserOptions);
 try {
  const page=await browser.newPage();await page.clock.install();await loginSetup(page,server);
  let posts=0,bindings:string[]=[],tests=0,works=0,failRead=false,newRef='';
  page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.endsWith('/model-tests'))tests++;if(request.method()==='POST'&&path.endsWith('/works'))works++;});
  await page.route('**/console/api/admin/runtime',async route=>{
   if(route.request().method()!=='PUT'){await route.continue();return;}
   bindings.push(route.request().postDataJSON().modelRef);
   if(bindings.length===1)await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'INVALID_REQUEST',message:'Synthetic Runtime rejection'})});else await route.continue();
  });
  await page.route('**/console/api/admin/models',async route=>{
   if(route.request().method()!=='POST'){if(failRead)await route.abort('failed');else await route.continue();return;}
   posts++;
   if(posts===2&&outcome==='rejected'){await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'INVALID_REQUEST',field:'model'})});return;}
   const response=await route.fetch(),value=await response.json();if(posts>1)newRef=value.modelRef;
   if(posts===2&&outcome==='lost-response')await route.abort('failed');else await route.fulfill({response});
  });
  await fillModel(page,'first-model');const save=page.getByRole('button',{name:'Save and continue',exact:true});await save.click();
  const notice=page.locator('#setup-notice');await expect(notice).toContainText('Model saved. Runtime was not bound.');assert.equal(bindings.length,1);
  await page.getByRole('button',{name:'Add model',exact:true}).click();await fillModel(page,'second-model');await save.click();
  if(outcome==='rejected') {
   await expect(notice).toContainText('Model ID is invalid');await expect(notice).not.toContainText('Model saved.');await expect(page.locator('#model-id-error')).toContainText('Model ID is invalid');
   await expect(page.getByLabel('Model ID',{exact:true})).toHaveValue('second-model');await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('');await expect(save).toBeEnabled();
   assert.equal(posts,2);assert.equal(bindings.length,1);
   await page.getByLabel('API Key',{exact:true}).fill('synthetic-model-key');await save.click();
  } else {
   await expect(notice).toContainText('The model save result is unconfirmed');await expect(notice).not.toContainText('Runtime save is unconfirmed');await expect(save).toBeDisabled();
   assert.equal(posts,2);assert.equal(bindings.length,1);
   failRead=true;await readSetupAutomatically(page);await expect(page.locator('#catalog-note')).toContainText('could not be loaded');await expect(save).toBeDisabled();
   assert.equal(posts,2);assert.equal(bindings.length,1);
   failRead=false;await readSetupAutomatically(page);await expect(notice).toContainText('Model save confirmed');await expect(page.getByLabel('Saved model',{exact:true})).toHaveValue(newRef);await expect(save).toBeEnabled();
   assert.equal(posts,2);assert.equal(bindings.length,1);assert.notEqual(newRef,bindings[0]);await save.click();
  }
  await expect(page.locator('#preparation-answer')).toBeVisible();assert.equal(posts,outcome==='rejected'?3:2);assert.deepEqual(bindings,[bindings[0],newRef]);assert.equal(tests,0);assert.equal(works,0);
  const state=await page.evaluate(async()=>({models:await(await fetch('/console/api/admin/models')).json(),runtime:await(await fetch('/console/api/admin/runtime')).json()}));
  assert.deepEqual(state.models.models.map((model:any)=>model.model).sort(),['first-model','second-model']);assert.equal(state.runtime.modelRef,newRef);
 } finally {await browser.close();await server.stop();}
});

test('unknown model save remains read-only through failed readback, then resumes from a confirmed saved reference',async()=>{
 const server=await start({PIWORK_ADMIN_ACCOUNT:'admin',PIWORK_ADMIN_PASSWORD:'synthetic-password'}),browser=await chromium.launch(browserOptions);
 try {
  const page=await browser.newPage();await page.clock.install();await loginSetup(page,server);let posts=0,puts=0,failRead=false;
  await page.route('**/console/api/admin/models',async route=>{if(route.request().method()==='POST'){posts++;await route.fetch();await route.abort('failed');}else if(failRead)await route.abort('failed');else await route.continue();});
  page.on('request',request=>{if(request.method()==='PUT'&&request.url().endsWith('/admin/runtime'))puts++;});
  await fillModel(page);await page.getByRole('button',{name:'Save and continue',exact:true}).click();await expect(page.locator('#setup-notice')).toContainText('The model save result is unconfirmed');await expect(page.getByRole('button',{name:'Save and continue',exact:true})).toBeDisabled();assert.equal(posts,1);assert.equal(puts,0);
  failRead=true;await readSetupAutomatically(page);await expect(page.locator('#catalog-note')).toContainText('could not be loaded');assert.equal(posts,1);assert.equal(puts,0);
  failRead=false;await readSetupAutomatically(page);await expect(page.getByLabel('Saved model',{exact:true})).toBeVisible();assert.equal(puts,0);
  await page.getByRole('button',{name:'Save and continue',exact:true}).click();await expect(page.locator('#preparation-answer')).toBeVisible();assert.equal(posts,1);assert.equal(puts,1);
 } finally {await browser.close();await server.stop();}
});

test('automatic model reads retain DOM, Key, focus, selection and Test revision without a manual refresh',async()=>{
 const server=await start({PIWORK_ADMIN_ACCOUNT:'admin',PIWORK_ADMIN_PASSWORD:'synthetic-password'}),browser=await chromium.launch(browserOptions);
 try {
  const page=await browser.newPage();await page.clock.install();await loginSetup(page,server);await fillModel(page);
  await page.getByLabel('API type',{exact:true}).selectOption('anthropic-messages');await expect(page.getByLabel('Base URL',{exact:true})).toHaveAttribute('placeholder','https://gateway.example');
  let reads=0,tests=0;page.on('request',request=>{if(request.url().endsWith('/_web/api/onboarding'))reads++;});
  const field=page.getByLabel('Model ID',{exact:true});await field.focus();await field.evaluate((input:HTMLInputElement)=>{input.setSelectionRange(2,5);(window as any).keptModelInput=input;});
  await readSetupAutomatically(page);assert.equal(reads,1);await expect(field).toBeFocused();assert.deepEqual(await field.evaluate((input:HTMLInputElement)=>[input===(window as any).keptModelInput,input.selectionStart,input.selectionEnd]),[true,2,5]);await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('synthetic-model-key');
  await expect(page.getByRole('button',{name:'Read current state',exact:true})).toHaveCount(0);
  await readSetupAutomatically(page);assert.equal(reads,2);assert.equal(await field.evaluate(input=>input===(window as any).keptModelInput),true);await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('synthetic-model-key');
  let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/console/api/admin/model-tests',async route=>{tests++;await gate;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:false,category:'authentication',reason:'provider-authentication',message:'Synthetic authentication failure',recovery:'Check the saved Key.',testMessage:'Reply with OK.',checkedAt:new Date().toISOString(),durationMs:1})});});
  await page.getByRole('button',{name:'Test',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await field.fill('changed-model');release();await expect(page.locator('#model-test-result')).toContainText('Previous configuration');assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(tests,1);
  await page.getByRole('button',{name:'View test result',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('previous configuration');await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Save and continue',exact:true}).click();await expect(page.locator('#preparation-answer')).toBeVisible();assert.equal(tests,1);
 } finally {await browser.close();await server.stop();}
});

test('saved model mode retains disabled/keyless reasons and catalog failure never pretends the catalog is empty',async()=>{
 const server=await start({PIWORK_ADMIN_ACCOUNT:'admin',PIWORK_ADMIN_PASSWORD:'synthetic-password'}),browser=await chromium.launch(browserOptions);
 try {
  const page=await browser.newPage();await page.clock.install();await loginSetup(page,server);
  await page.route('**/console/api/admin/models',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({models:[{id:'disabled',modelRef:'model-disabled',model:'disabled',name:'Disabled fixture',enabled:false,credentialAvailable:true},{id:'keyless',modelRef:'model-keyless',model:'keyless',name:'Keyless fixture',enabled:true,credentialAvailable:false}]})}));
  await page.reload();await expect(page.getByLabel('Saved model',{exact:true})).toBeVisible();await expect(page.getByLabel('Model ID',{exact:true})).toHaveCount(0);await expect(page.locator('#saved-model option:disabled')).toHaveCount(2);await expect(page.locator('#saved-model')).toContainText('Key unavailable');
  const choose=page.getByRole('button',{name:'Choose saved model',exact:true});await expect(choose).toHaveAttribute('aria-pressed','true');assert.equal(await choose.evaluate(el=>el.getBoundingClientRect().height),34);const selectedBackground=await choose.evaluate(el=>getComputedStyle(el).backgroundColor);
  await page.getByRole('button',{name:'Add model',exact:true}).click();await expect(page.getByLabel('Model ID',{exact:true})).toBeVisible();await expect(page.getByLabel('Saved model',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Add model',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('button',{name:'Add model',exact:true}).locator('svg')).toHaveCount(1);assert.notEqual(await choose.evaluate(el=>getComputedStyle(el).backgroundColor),selectedBackground);
  await page.unroute('**/console/api/admin/models');await page.route('**/console/api/admin/models',route=>route.abort('failed'));await page.reload();await expect(page.locator('#catalog-note')).toContainText('could not be loaded');await expect(page.getByRole('button',{name:'Save and continue',exact:true})).toBeDisabled();await expect(page.getByRole('heading',{name:'Open your setup link'})).toHaveCount(0);
  await page.unroute('**/console/api/admin/models');await readSetupAutomatically(page);await expect(page.getByRole('heading',{name:'Set up your Core runtime'})).toBeVisible();await expect(page.locator('#catalog-note')).toBeEmpty();await expect(page.locator('#setup-notice')).toBeEmpty();
 } finally {await browser.close();await server.stop();}
});

test('network errors preserve setup and expired login clears model secrets',async()=>{
 const server=await start({PIWORK_ADMIN_ACCOUNT:'admin',PIWORK_ADMIN_PASSWORD:'synthetic-password'}),browser=await chromium.launch(browserOptions);
 try {
  const page=await browser.newPage();await page.clock.install();await loginSetup(page,server);await fillModel(page);
  await page.evaluate(async()=>{const s=await(await fetch('/_web/api/session')).json();await fetch('/_web/api/logout',{method:'POST',headers:{'Content-Type':'application/json','X-Piwork-Csrf':s.csrfToken},body:'{}'});});
  await page.route('**/_web/api/onboarding',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({code:'AUTH_REQUIRED'})}));await readSetupAutomatically(page);await expect(page.getByRole('heading',{name:'Sign in to Piwork'})).toBeVisible();await expect(page.locator('input[type=password]')).toHaveCount(1);await expect(page.getByLabel('Password',{exact:true})).toHaveValue('');
  await page.unroute('**/_web/api/onboarding');await page.route('**/_web/api/state',route=>route.abort('failed'));await page.reload();await expect(page.getByRole('heading',{name:'Could not read Core state'})).toBeVisible();await expect(page.getByRole('heading',{name:'Open your setup link'})).toHaveCount(0);
  await page.unroute('**/_web/api/state');await page.getByRole('button',{name:'Read current state',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign in to Piwork'})).toBeVisible();await loginSetup(page,server);await expect(page.locator('#setup-notice')).toBeEmpty();
 } finally {await browser.close();await server.stop();}
});

test('setup, Admin and hosted Desktop retain shared control states and wrap at 360px',async()=>{
 const server=await start(),browser=await chromium.launch(browserOptions);
 try {
  const {mkdir}=await import('node:fs/promises');
  const evidence=process.env.PIWORK_ONBOARDING_EVIDENCE_DIR||fileURLToPath(new URL('../../../../dist/align-core-setup/screenshots/',import.meta.url));await mkdir(evidence,{recursive:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto(server.origin);await expect(page.getByRole('heading',{name:'Create your administrator'})).toBeVisible();
  const appearance=async(locator:any)=>locator.evaluate((el:HTMLElement)=>{const style=getComputedStyle(el),rect=el.getBoundingClientRect();return {height:rect.height,fontSize:style.fontSize,fontWeight:style.fontWeight,padding:style.padding,borderRadius:style.borderRadius,gap:style.gap,background:style.backgroundColor,color:style.color,outline:style.outlineStyle,opacity:style.opacity};});
  const create=page.getByRole('button',{name:'Create administrator',exact:true}),normal=await appearance(create);
  assert.equal(normal.height,40);assert.equal(normal.fontSize,'13px');assert.equal(normal.borderRadius,'7px');assert.equal(normal.gap,'8px');assert.equal(normal.fontWeight,'550');assert.equal(await create.locator('svg').count(),1);
  await create.focus();assert.equal((await appearance(create)).outline,'solid');await create.hover();assert.notEqual((await appearance(create)).background,normal.background);
  await page.mouse.down();assert.notEqual((await appearance(create)).background,normal.background);await page.mouse.up();
  for(const width of [1440,360]){
   await page.setViewportSize({width,height:1000});const nav=page.getByRole('navigation',{name:'Piwork navigation'}),language=nav.locator('[data-action="language"]'),signIn=nav.getByRole('link',{name:'Sign in',exact:true});
   await expect(language).toBeVisible();await expect(signIn).toBeVisible();await language.focus();await page.keyboard.press('Tab');await expect(signIn).toBeFocused();
   for(const item of [language,signIn]){const bounds=await item.boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.x+bounds.width<=width);}
   await page.getByLabel('Account',{exact:true}).focus();await page.keyboard.press('Tab');await expect(page.getByLabel('Password',{exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByLabel('Confirm password',{exact:true})).toBeFocused();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('.setup-brand img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0),true);
   await page.screenshot({path:join(evidence,`create-admin-${width}.png`),fullPage:true});
  }
  await page.getByLabel('Account',{exact:true}).fill('admin');await page.getByLabel('Password',{exact:true}).fill('synthetic-password');await page.getByLabel('Confirm password',{exact:true}).fill('synthetic-password');await create.click();await expect(page.getByRole('heading',{name:'Sign in to Piwork'})).toBeVisible();
  await page.screenshot({path:join(evidence,'sign-in-360.png'),fullPage:true});await page.getByLabel('Account',{exact:true}).fill('admin');await page.getByLabel('Password',{exact:true}).fill('synthetic-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Set up your Core runtime'})).toBeVisible();
  await fillModel(page);await page.getByLabel('Display name (optional)',{exact:true}).fill('Long model name '.repeat(17));
  await openModelAdvanced(page);const field=page.getByLabel('Model ID',{exact:true});await field.fill('x'.repeat(257));await page.getByRole('button',{name:'Save and continue',exact:true}).click();await expect(field).toBeFocused();await expect(page.locator('#model-id-error')).toContainText('at most 256');await field.fill('layout-fixture');
  await page.getByLabel('Display name (optional)',{exact:true}).fill('Long model name '.repeat(16));
  for(const width of [1440,360]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(evidence,`model-${width}.png`),fullPage:true});}
  let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/console/api/admin/runtime',async route=>{if(route.request().method()==='PUT')await gate;await route.continue();});
  const save=page.getByRole('button',{name:'Save and continue',exact:true});await save.click();await expect(save).toHaveAttribute('aria-busy','true');await expect(save).toBeDisabled();await expect(page.getByLabel('API Key',{exact:true})).toBeDisabled();assert.equal((await appearance(save)).opacity,'0.48');await page.screenshot({path:join(evidence,'model-saving-360.png'),fullPage:true});release();await expect(page.locator('#preparation-answer')).toBeVisible();
  for(const width of [1440,360]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(evidence,`preparation-${width}.png`),fullPage:true});}
  await page.goto(server.origin+'/admin/runtime');await page.getByRole('button',{name:'Edit runtime',exact:true}).click();const adminSave=page.getByRole('button',{name:'Save runtime',exact:true});const adminStyle=await appearance(adminSave);assert.equal(adminStyle.height,normal.height);assert.equal(adminStyle.fontSize,normal.fontSize);assert.equal(adminStyle.borderRadius,normal.borderRadius);assert.equal(adminStyle.padding,normal.padding);await expect(page.locator('[data-runtime-agent-image]')).toBeHidden();
  await page.getByText('Runtime diagnostics',{exact:true}).click();await expect(page.locator('[data-runtime-agent-image]')).not.toHaveText('Unavailable');
  for(const width of [1440,360]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(evidence,`admin-runtime-${width}.png`),fullPage:true});}
  await page.goto(server.origin+'/admin/models');await page.getByRole('link',{name:'Long model name '.repeat(16).trim(),exact:true}).click();const danger=page.getByRole('button',{name:'Delete model',exact:true});await expect(danger).toBeVisible();assert.equal((await appearance(danger)).height,40);const dangerStyle=await appearance(danger);assert.equal(dangerStyle.color,'rgb(180, 35, 50)');await danger.hover();assert.notEqual((await appearance(danger)).background,dangerStyle.background);
  await page.goto(server.origin+'/');await expect(page.locator('.core-startup-page')).toBeVisible();const desktop=page.getByRole('button',{name:'Check again',exact:true});assert.equal((await appearance(desktop)).height,normal.height);await page.screenshot({path:join(evidence,'desktop-360.png'),fullPage:true});
  // A connection failure in the hosted Desktop renders the real Sign in link.
  await page.route('**/_desktop/api/session',route=>route.abort('failed'));await page.reload();const signIn=page.getByRole('link',{name:'Sign in',exact:true});await expect(signIn).toBeVisible();await expect(signIn).toHaveAttribute('href','/login');const linkStyle=await appearance(signIn);assert.equal(linkStyle.height,normal.height);assert.equal(linkStyle.padding,normal.padding);await signIn.focus();assert.equal((await appearance(signIn)).outline,'solid');await page.screenshot({path:join(evidence,'desktop-connect-360.png'),fullPage:true});
 } finally {await browser.close();await server.stop();}
});

test('ordinary users see pending setup; unavailable release metadata preserves saved model reads',async()=>{
 const server=await start({PIWORK_ADMIN_ACCOUNT:'admin',PIWORK_ADMIN_PASSWORD:'synthetic-password'}),browser=await chromium.launch(browserOptions);
 try {
  const page=await browser.newPage();await loginSetup(page,server);
  await page.route('**/_web/api/onboarding',async route=>{const response=await route.fetch(),value=await response.json();delete value.defaultAgentImage;value.releaseError='RELEASE_DEFAULTS_UNAVAILABLE';await route.fulfill({response,json:value});});
  await page.reload();await expect(page.getByRole('heading',{name:'Set up your Core runtime'})).toBeVisible();await expect(page.locator('#release-note')).toContainText('release is incomplete');await fillModel(page);
  await page.getByRole('link',{name:'Overview',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Unsaved model configuration');await page.getByRole('button',{name:'Keep editing',exact:true}).click();await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('synthetic-model-key');
  await page.getByRole('link',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'Discard draft',exact:true}).click();await expect(page.locator('main')).toContainText('What’s next');await page.goto(server.origin+'/setup');await expect(page.getByRole('heading',{name:'Set up your Core runtime'})).toBeVisible();
  await page.unroute('**/_web/api/onboarding');
  const created=await page.evaluate(async()=>{const session=await(await fetch('/_web/api/session')).json();const r=await fetch('/console/api/admin/users',{method:'POST',headers:{'Content-Type':'application/json','X-Csrf-Token':session.csrfToken},body:JSON.stringify({account:'ordinary',password:'synthetic-user-password',role:'user'})});return r.status;});assert.equal(created,201);
  await page.getByRole('button',{name:'Administrator account',exact:true}).click();await page.getByRole('menuitem',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign in to Piwork'})).toBeVisible();await page.getByLabel('Account',{exact:true}).fill('ordinary');await page.getByLabel('Password',{exact:true}).fill('synthetic-user-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.locator('.core-startup-page')).toBeVisible();
  await page.locator('[data-action=account]').click();await expect(page.getByRole('menuitem',{name:'Administration',exact:true})).toHaveCount(0);await expect(page.getByRole('menuitem',{name:'Quick setup',exact:true})).toHaveCount(0);await expect(page.getByRole('menuitem',{name:'Sign out',exact:true})).toBeVisible();await page.keyboard.press('Escape');
  await page.goto(server.origin+'/setup');await expect(page.getByRole('heading',{name:'Core setup is pending'})).toBeVisible();await expect(page.getByLabel('Model ID',{exact:true})).toHaveCount(0);await expect(page.getByRole('link',{name:'Overview',exact:true})).toHaveCount(0);await expect(page.getByRole('link',{name:'Open workbench',exact:true})).toBeVisible();
  await page.route('**/_web/api/onboarding',async route=>{const response=await route.fetch(),value=await response.json();value.status.ready=true;await route.fulfill({response,json:value});});await page.getByRole('button',{name:'Refresh state',exact:true}).click();await expect(page.getByRole('heading',{name:'Your Core is ready'})).toBeVisible();
 } finally {await browser.close();await server.stop();}
});

test('real Engine prepares fixed release dependencies and permits one explicit Work from the IP workbench',{skip:!process.env.PIWORK_RUN_ENGINE_BROWSER,timeout:360000},async()=>{
 const engineHost=process.env.PIWORK_TEST_ENGINE_HOST||'unix:///var/run/docker.sock';
 const server=await start({},undefined,engineHost),browser=await chromium.launch(browserOptions);
 let installation='';
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(server.origin);await page.getByLabel('Account',{exact:true}).fill('admin');await page.getByLabel('Password',{exact:true}).fill('synthetic-password');await page.getByLabel('Confirm password',{exact:true}).fill('synthetic-password');await page.getByRole('button',{name:'Create administrator',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Sign in to Piwork'})).toBeVisible();await loginSetup(page,server);await fillModel(page,'synthetic-no-model-request');let tests=0,works=0,modelWrites=0,runtimeWrites=0;
  page.on('request',request=>{if(request.url().includes('/model-tests'))tests++;if(request.method()==='POST'&&request.url().endsWith('/admin/models'))modelWrites++;if(request.method()==='PUT'&&request.url().endsWith('/admin/runtime'))runtimeWrites++;if(request.method()==='POST'&&new URL(request.url()).pathname==='/_desktop/api/works')works++;});
  await page.getByRole('button',{name:'Save and continue',exact:true}).click();await expect(page.locator('#preparation-answer')).toBeVisible();
  await expect.poll(async()=>page.evaluate(async()=>{const value=await(await fetch('/_web/api/onboarding')).json();return value.status?.ready&&value.preparation?.ready;}),{timeout:240000,intervals:[1000,2000,5000]}).toBe(true);
  await expect(page.locator('.works-page')).toBeVisible({timeout:12000});
  await captureFollowup(page,'engine-ready');assert.equal(works,0);assert.equal(tests,0);
  await page.locator('[data-action=account]').click();await page.getByRole('menuitem',{name:'Administration',exact:true}).click();await expect(page.locator('main h1')).toContainText('What’s next');await openQuickSetup(page);await expect(page.getByLabel('Saved model',{exact:true})).toBeVisible();await captureFollowup(page,'engine-current-model');await page.getByRole('button',{name:'Save and continue',exact:true}).click();await expect(page.locator('#preparation-answer')).toContainText('All required components are ready');assert.deepEqual({modelWrites,runtimeWrites},{modelWrites:1,runtimeWrites:1});await page.getByRole('link',{name:'Workbench',exact:true}).click();await expect(page.locator('.works-page')).toBeVisible();await captureFollowup(page,'engine-workbench');
  await page.getByRole('button',{name:'New Work',exact:true}).first().click();await page.locator('#create-name').fill('Setup acceptance Work');await page.getByRole('button',{name:'Create Work',exact:true}).click();
  const openWork=page.locator('#modal .modal-footer').getByRole('link',{name:'Open Work',exact:true});await expect(openWork).toBeVisible({timeout:120000});await openWork.click();
  await expect(page.getByRole('heading',{name:'Setup acceptance Work',exact:true})).toBeVisible({timeout:60000});
  await expect.poll(async()=>page.evaluate(async()=>{const value=await(await fetch('/_desktop/api/works')).json();return value.works?.[0]?.observedState;}),{timeout:60000}).toBe('ready');assert.equal(works,1);assert.equal(tests,0);
  const {readFile,writeFile}=await import('node:fs/promises');installation=JSON.parse(await readFile(join(server.directory,'core-format.json'),'utf8')).installationId;
  const engine=JSON.parse(execFileSync('docker',['--host',engineHost,'version','--format','{{json .Server}}'],{encoding:'utf8'}));
  const state=await page.evaluate(async()=>{const value=await(await fetch('/_web/api/onboarding')).json();return {ready:value.status.ready,deliveryReady:value.preparation.ready,agentImage:value.runtime.agentImage,modelRef:value.runtime.modelRef};});
  await writeFile(process.env.PIWORK_ONBOARDING_ENGINE_EVIDENCE_PATH||fileURLToPath(new URL('../../../../dist/align-core-setup/engine-browser.json',import.meta.url)),JSON.stringify({platform:process.platform,listen:'0.0.0.0',access:'non-loopback IPv4',engineVersion:engine.Version,engineApi:engine.ApiVersion,...state,explicitWorkCreates:works,modelTests:tests,modelWrites,runtimeWrites,adminQuickRoundTrip:true},null,2)+'\n');
 } finally {
  await browser.close();await server.stop(true);
  if(!installation){const {readFile}=await import('node:fs/promises');installation=JSON.parse(await readFile(join(server.directory,'core-format.json'),'utf8')).installationId;}
  assert.match(installation,/^[a-zA-Z0-9-]+$/);const filter='label=piwork.installation_id='+installation;
  const docker=(args:string[])=>execFileSync('docker',['--host',engineHost,...args],{encoding:'utf8'}).trim();
  const cleanupCommands:[string[],string[],string[]][]=[
   [['ps','-aq','--filter',filter],['inspect','--format','{{index .Config.Labels "piwork.installation_id"}}'],['rm','-f']],
   [['network','ls','-q','--filter',filter],['network','inspect','--format','{{index .Labels "piwork.installation_id"}}'],['network','rm']],
   [['volume','ls','-q','--filter',filter],['volume','inspect','--format','{{index .Labels "piwork.installation_id"}}'],['volume','rm']],
  ];
  for(const [list,inspect,remove] of cleanupCommands)for(const id of docker(list).split('\n').filter(Boolean)){assert.equal(docker([...inspect,id]),installation);docker([...remove,id]);}
  assert.equal(docker(['ps','-aq','--filter',filter]),'');await rm(server.directory,{recursive:true,force:true});
 }
});

test('a late Test cannot release a newer model view lock or replace its result',async()=>{
 const server=await start({PIWORK_ADMIN_ACCOUNT:'admin',PIWORK_ADMIN_PASSWORD:'synthetic-password'}),browser=await chromium.launch(browserOptions);
 let releaseOld=()=>{},releaseNew=()=>{};
 try {
  const page=await browser.newPage();await loginSetup(page,server);
  await page.route('**/console/api/admin/models',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({models:[{id:'saved',modelRef:'model-saved',model:'saved',name:'Saved fixture',enabled:true,credentialAvailable:true}]})}));await page.reload();await page.getByRole('button',{name:'Add model',exact:true}).click();await fillModel(page,'old-target');
  const oldGate=new Promise<void>(resolve=>{releaseOld=resolve;}),newGate=new Promise<void>(resolve=>{releaseNew=resolve;});let tests=0;
  await page.route('**/console/api/admin/model-tests',async route=>{const input=route.request().postDataJSON();tests++;await(input.model==='old-target'?oldGate:newGate);await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,category:'success',api:input.api,model:input.model,testMessage:'Reply with OK.',replyText:input.model+' reply',replyTruncated:false,checkedAt:new Date().toISOString(),durationMs:1})});});
  await page.getByRole('button',{name:'Test',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'Close',exact:true}).click();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Choose saved model',exact:true}).click();await page.getByRole('button',{name:'Add model',exact:true}).click();await fillModel(page,'new-target');await page.getByLabel('API Key',{exact:true}).fill('synthetic-new-key');await page.getByRole('button',{name:'Test',exact:true}).click();await expect.poll(()=>tests).toBe(2);
  releaseOld();await expect(page.getByRole('dialog')).toContainText('Sending the test message');await expect(page.getByRole('dialog')).not.toContainText('old-target reply');await expect(page.getByRole('button',{name:'Test',exact:true})).toBeDisabled();await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('synthetic-new-key');releaseNew();await expect(page.locator('[data-model-test-reply]')).toHaveText('new-target reply');await page.getByRole('button',{name:'Close',exact:true}).click();await expect(page.getByRole('button',{name:'Test',exact:true})).toBeEnabled();
 } finally {releaseOld();releaseNew();await browser.close();await server.stop();}
});

const deliveryNames=['docker','agent','packageHelper','defaultContext','fileHelper','snapshotHelper'];
function deliveryFixture(value:any,mode:string) {
 value.status.ready=mode!=='preparing';
 value.preparation={version:1,ready:mode==='ready'||mode==='partial',components:Object.fromEntries(deliveryNames.map(name=>[name,{state:'ready',attempt:1,code:null,retryAfterSeconds:null}]))};
 const components=value.preparation.components;
 if(mode==='preparing')for(const name of deliveryNames)components[name].state=name==='docker'?'preparing':'pending';
 if(mode==='helpers')components.fileHelper.state='preparing';
 if(mode==='retrying')components.fileHelper={state:'retrying',attempt:2,code:'IMAGE_UNAVAILABLE',retryAfterSeconds:5};
 if(mode==='failed')components.fileHelper={state:'failed',attempt:1,code:'IMAGE_INCOMPATIBLE',retryAfterSeconds:null};
 if(mode==='missing')delete value.preparation;
 if(mode==='partial')delete components.snapshotHelper;
 return value;
}
async function captureFollowup(page:any,name:string) {
 const directory=process.env.PIWORK_ONBOARDING_EVIDENCE_DIR;
 if(!directory)return;
 const {mkdir}=await import('node:fs/promises');await mkdir(directory,{recursive:true});
 const viewport=page.viewportSize();
 for(const width of [1440,360]) {
  await page.setViewportSize({width,height:1000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const accountMenu=name.startsWith('account');if(accountMenu&&await page.getByRole('menu').count()===0)await page.locator('[data-action=account]').click();
  await page.screenshot({path:join(directory,`${name}-${width}.png`),fullPage:!accountMenu});
 }
 if(viewport)await page.setViewportSize(viewport);
}

test('preparation explains waiting and enables its exit only after all dependencies are ready',{timeout:90000},async()=>{
 const server=await start({PIWORK_ADMIN_ACCOUNT:'admin',PIWORK_ADMIN_PASSWORD:'synthetic-password'}),browser=await chromium.launch(browserOptions);
 try {
  const page=await browser.newPage();await loginSetup(page,server);await fillModel(page);
  let mode='preparing',models=0,runtimes=0,tests=0,works=0;
  page.on('request',request=>{const path=new URL(request.url()).pathname;if(request.method()==='POST'&&path==='/console/api/admin/models')models++;if(request.method()==='PUT'&&path==='/console/api/admin/runtime')runtimes++;if(path.endsWith('/model-tests'))tests++;if(request.method()==='POST'&&path.endsWith('/works'))works++;});
  await page.route('**/_web/api/onboarding',async route=>{const response=await route.fetch();await route.fulfill({response,json:deliveryFixture(await response.json(),mode)});});
  await page.getByRole('button',{name:'Save and continue',exact:true}).click();
  await expect(page.locator('#preparation-answer')).toBeVisible();await page.reload();
  const answer=page.locator('#preparation-answer'),exit=page.locator('#workbench-exit'),refresh=page.getByRole('button',{name:'Read current state',exact:true});
  await expect(page.getByRole('heading',{name:'Preparing Piwork…',exact:true})).toBeVisible();
  await expect(answer).toContainText('Preparing Docker Engine');await expect(answer).toContainText('Please wait');await expect(answer).toContainText('updates automatically');await expect(answer.locator('.pending-dots')).toHaveCount(1);
  await expect(page.locator('[data-component=agent]')).toContainText('Waiting for Docker Engine');
  await expect(exit).toBeDisabled();await expect(exit).not.toHaveAttribute('href','/');
  await exit.evaluate((element:HTMLElement)=>element.click());await exit.focus();await page.keyboard.press('Enter');await page.keyboard.press('Space');assert.equal(new URL(page.url()).pathname,'/admin/setup');
  await expect(page.getByRole('button',{name:'Change model',exact:true})).toHaveCount(0);await expect(page.getByRole('link',{name:'Review Runtime in Admin',exact:true})).toHaveCount(0);await expect(page.getByRole('link',{name:'Overview',exact:true})).toBeVisible();
  await captureFollowup(page,'waiting');
  await refresh.focus();await exit.evaluate(element=>{(window as any).originalPreparationExit=element;});
  mode='helpers';await expect(answer).toContainText('Preparing Files',{timeout:12000});await expect(exit).toBeDisabled();await expect(refresh).toBeFocused();
  mode='missing';await refresh.click();await expect(answer).toContainText('Waiting for preparation status');await expect(exit).toBeDisabled();
  mode='partial';await refresh.click();await expect(page.locator('[data-component=snapshotHelper]')).toContainText('Not confirmed');await expect(exit).toBeDisabled();
  mode='ready';await expect(page.getByRole('heading',{name:'Piwork is ready',exact:true})).toBeVisible({timeout:12000});await expect(exit).toBeEnabled();await expect(exit).toHaveAttribute('href','/');await expect(page.locator('[data-preparation-step]')).toHaveClass('complete');
  assert.equal(new URL(page.url()).pathname,'/admin/setup');await expect(refresh).toBeFocused();assert.equal(await exit.evaluate(element=>element===(window as any).originalPreparationExit),true);
  mode='helpers';await refresh.click();await expect(exit).toBeDisabled();await expect(page.locator('[data-preparation-step]')).toHaveClass('current');
  mode='ready';await refresh.click();await expect(exit).toBeEnabled();await captureFollowup(page,'ready');
  await exit.click();await expect(page.locator('.core-startup-page')).toBeVisible();
  assert.deepEqual({models,runtimes,tests,works},{models:1,runtimes:1,tests:0,works:0});
 } finally {await browser.close();await server.stop();}
});

test('preparation separates retry, terminal failure and interrupted observation and recovers without resaving',async()=>{
 const server=await start({PIWORK_ADMIN_ACCOUNT:'admin',PIWORK_ADMIN_PASSWORD:'synthetic-password'}),browser=await chromium.launch(browserOptions);
 try {
  const page=await browser.newPage();await loginSetup(page,server);await fillModel(page);let mode='retrying',mutations=0;
  page.on('request',request=>{if(request.method()!=='GET')mutations++;});
  await page.route('**/_web/api/onboarding',async route=>{if(mode==='offline'){await route.abort('failed');return;}const response=await route.fetch();await route.fulfill({response,json:deliveryFixture(await response.json(),mode)});});
  await page.getByRole('button',{name:'Save and continue',exact:true}).click();
  await expect(page.locator('#preparation-answer')).toBeVisible();await page.reload();
  const answer=page.locator('#preparation-answer'),exit=page.locator('#workbench-exit'),refresh=page.getByRole('button',{name:'Read current state',exact:true});
  await expect(answer).toContainText('Waiting to retry Files');await expect(answer).toContainText('Retrying in 5 seconds');await expect(answer).toContainText('network and image registry access');await expect(exit).toBeDisabled();
  mode='failed';await refresh.click();await expect(page.getByRole('heading',{name:'Preparation needs attention',exact:true})).toBeVisible();await expect(answer).toContainText('repair the server release');await expect(answer).not.toContainText('Please wait');await expect(answer).not.toContainText('automatically');await expect(exit).toBeDisabled();
  mode='ready';await refresh.click();await expect(exit).toBeEnabled();
  await page.getByText('Runtime diagnostics',{exact:true}).click();
  mode='offline';await refresh.click();await expect(answer).toContainText('last confirmed state');await expect(page.getByRole('heading',{name:'Preparation updates interrupted',exact:true})).toBeVisible();await expect(page.locator('[data-component=fileHelper]')).toContainText('Ready');await expect(exit).toBeDisabled();await expect(page.locator('.setup-diagnostics')).toHaveAttribute('open','');
  mode='ready';await expect(answer).toContainText('All required components are ready',{timeout:12000});await expect(answer).not.toContainText('last confirmed');await expect(exit).toBeEnabled();await expect(page.locator('.setup-diagnostics')).toHaveAttribute('open','');assert.equal(mutations,2);
 } finally {await browser.close();await server.stop();}
});

test('hosted account management links share menu geometry, icons and keyboard navigation',async()=>{
 const server=await start({PIWORK_ADMIN_ACCOUNT:'admin',PIWORK_ADMIN_PASSWORD:'synthetic-password'}),browser=await chromium.launch(browserOptions);
 try {
  const page=await browser.newPage();await loginSetup(page,server);await page.goto(server.origin+'/');
  const trigger=page.locator('[data-action=account]');await trigger.click();const menu=page.getByRole('menu');
  const labels=['About Piwork','Export logs','Administration','Quick setup'];
  await expect(menu.getByRole('menuitem',{name:'Known operations',exact:true})).toHaveCount(0);
  await expect(menu.getByRole('menuitem',{name:'Core setup',exact:true})).toHaveCount(0);
  const items=labels.map(name=>menu.getByRole('menuitem',{name,exact:true}));
  const geometry=async(item:any)=>item.evaluate((node:HTMLElement)=>{const style=getComputedStyle(node),rect=node.getBoundingClientRect(),svg=node.querySelector('svg')!,range=document.createRange();range.selectNodeContents(node.lastChild!);return {height:rect.height,left:rect.left,width:rect.width,padding:style.padding,fontSize:style.fontSize,fontWeight:style.fontWeight,gap:style.gap,text:range.getBoundingClientRect().left-rect.left,icon:svg.getBoundingClientRect().width};});
  const baseline=await geometry(items[0]);
  for(const item of items){await expect(item.locator('svg')).toHaveCount(1);assert.deepEqual(await geometry(item),baseline);const normal=await item.evaluate(el=>getComputedStyle(el).backgroundColor);await item.hover();assert.notEqual(await item.evaluate(el=>getComputedStyle(el).backgroundColor),normal);await page.keyboard.press('Home');await item.focus();assert.equal(await item.evaluate(el=>getComputedStyle(el).outlineStyle),'solid');await page.mouse.move(0,0);}
  await expect(menu.locator('.dropdown-title')).toHaveText('admin');await expect(menu.locator('.account-context')).toContainText('Role: Administrator');await expect(menu.locator('.account-context')).toContainText('Core: '+coreOrigin(server));await expect(items[2]!).toHaveAttribute('href','/admin');await expect(items[3]!).toHaveAttribute('href','/admin/setup');assert.equal(await menu.getByRole('menuitem',{name:'Sign out',exact:true}).evaluate(el=>getComputedStyle(el).color),'rgb(180, 35, 50)');
  const language=menu.locator('[data-action="language"]');await expect(language).toHaveAttribute('aria-haspopup','listbox');
  await items[3]!.focus();await page.keyboard.press('Home');await expect(items[0]!).toBeFocused();await page.keyboard.press('ArrowDown');await expect(items[1]!).toBeFocused();await page.keyboard.press('ArrowDown');await expect(language).toBeFocused();
  await page.keyboard.press('ArrowDown');await expect(items[2]!).toBeFocused();await page.keyboard.press('ArrowDown');await expect(items[3]!).toBeFocused();await page.keyboard.press('End');await expect(menu.getByRole('menuitem',{name:'Sign out',exact:true})).toBeFocused();await page.keyboard.press('Home');await expect(items[0]!).toBeFocused();
  await language.focus();await page.keyboard.press('Enter');await expect(menu).toHaveCount(0);await expect(page.locator('.language-picker [data-locale="en"]')).toBeVisible();await expect(page.locator('.language-picker [data-locale="zh-CN"]')).toBeVisible();await page.keyboard.press('Escape');await expect(trigger).toBeFocused();await trigger.click();
  await captureFollowup(page,'account-menu');
  await language.focus();await page.keyboard.press('Enter');await expect(page.locator('.language-picker [data-locale="auto"]')).toHaveAttribute('aria-selected','true');await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(trigger).toBeFocused();await trigger.click();await page.keyboard.press('Tab');await expect(menu).toHaveCount(0);
  await trigger.click();await page.mouse.click(3,3);await expect(menu).toHaveCount(0);
  await trigger.click();await menu.getByRole('menuitem',{name:'Administration',exact:true}).focus();await page.keyboard.press('Enter');await expect.poll(()=>new URL(page.url()).pathname).toBe('/admin');
  await page.goto(server.origin+'/');await trigger.click();await menu.getByRole('menuitem',{name:'Quick setup',exact:true}).focus();await page.keyboard.press('Space');await expect(page.getByRole('heading',{name:'Set up your Core runtime'})).toBeVisible();assert.equal(new URL(page.url()).pathname,'/admin/setup');
  const longAccount='admin-'+('long'.repeat(24)),longCore='http://core-'+('x'.repeat(48))+'.example.invalid:7171';
  await page.route('**/_desktop/api/session',async route=>{const response=await route.fetch(),value=await response.json();value.user.account=longAccount;value.coreUrl=longCore;await route.fulfill({response,json:value});});
  await page.goto(server.origin+'/');await trigger.click();await expect(menu.locator('.dropdown-title')).toHaveText(longAccount);await expect(menu.locator('.account-context')).toContainText(longCore);await captureFollowup(page,'account-long');
 } finally {await browser.close();await server.stop();}
});

test('Admin Quick setup is canonical, explicit and can observe an unchanged Runtime without another write',async()=>{
 const server=await start({PIWORK_ADMIN_ACCOUNT:'admin',PIWORK_ADMIN_PASSWORD:'synthetic-password'}),browser=await chromium.launch(browserOptions);
 try{
  const page=await browser.newPage();await loginSetup(page,server);assert.equal(new URL(page.url()).pathname,'/admin/setup');await expect(page.locator('main h1')).toHaveText('Quick setup');await expect(page.locator('.setup-topbar')).toHaveCount(0);await expect(page.locator('.setup-steps li')).toHaveCount(2);
  let posts=0,puts=0,tests=0,works=0;page.on('request',r=>{const path=new URL(r.url()).pathname;if(path==='/console/api/admin/models'&&r.method()==='POST')posts++;if(path==='/console/api/admin/runtime'&&r.method()==='PUT')puts++;if(path.endsWith('/model-tests'))tests++;if(path.endsWith('/works')&&r.method()==='POST')works++;});
  await fillModel(page,'current-model');await page.getByRole('button',{name:'Save and continue',exact:true}).click();await expect(page.locator('#preparation-answer')).toBeVisible();assert.equal(new URL(page.url()).search,'?step=prepare');await page.reload();await expect(page.locator('#preparation-answer')).toBeVisible();
  await page.getByRole('link',{name:'Overview',exact:true}).click();await openQuickSetup(page);await expect(page.getByLabel('Saved model',{exact:true})).toBeVisible();await expect(page.locator('#preparation-answer')).toHaveCount(0);assert.equal(new URL(page.url()).search,'');
  const currentRef=await page.getByLabel('Saved model',{exact:true}).inputValue();assert.ok(currentRef);await expect(page.getByRole('button',{name:'Save and continue',exact:true})).toBeEnabled();assert.deepEqual({posts,puts},{posts:1,puts:1});
  await page.getByRole('button',{name:'Save and continue',exact:true}).click();await expect(page.locator('#preparation-answer')).toBeVisible();assert.equal(puts,1);
  await page.goto(server.origin+'/setup');await expect(page.getByLabel('Saved model',{exact:true})).toHaveValue(currentRef);assert.equal(new URL(page.url()).pathname,'/admin/setup');
  await page.getByRole('button',{name:'Add model',exact:true}).click();await fillModel(page,'replacement-model');await page.getByRole('button',{name:'Save and continue',exact:true}).click();await expect(page.locator('#preparation-answer')).toBeVisible();assert.deepEqual({posts,puts,tests,works},{posts:2,puts:2,tests:0,works:0});
  await page.getByRole('link',{name:'AI models',exact:true}).click();await expect(page.locator('main h1')).toHaveText('AI models');await page.goBack();await expect(page.locator('#preparation-answer')).toBeVisible();await page.goForward();await expect(page.locator('main h1')).toHaveText('AI models');
 }finally{await browser.close();await server.stop();}
});

test('Workbench link keeps draft decisions, modified navigation and an independent preparation exit',async()=>{
 const server=await start({PIWORK_ADMIN_ACCOUNT:'admin',PIWORK_ADMIN_PASSWORD:'synthetic-password'}),browser=await chromium.launch(browserOptions);
 try{
  const context=await browser.newContext(),page=await context.newPage();await loginSetup(page,server);await fillModel(page,'draft-workbench');let posts=0,puts=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/admin/models'))posts++;if(r.method()==='PUT'&&r.url().endsWith('/admin/runtime'))puts++;});
  const link=page.getByRole('link',{name:'Workbench',exact:true});await expect(link).toHaveAttribute('href','/');await expect(link.locator('svg')).toHaveCount(1);
  const popupPromise=context.waitForEvent('page');await link.click({modifiers:['Control']});const popup=await popupPromise;await expect(popup.locator('.core-startup-page')).toBeVisible();await popup.close();await expect(page.getByLabel('Model ID',{exact:true})).toHaveValue('draft-workbench');await expect(page.locator('#leave-dialog')).not.toBeVisible();
  await link.focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toContainText('Unsaved model configuration');await page.getByRole('button',{name:'Keep editing',exact:true}).click();await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('synthetic-model-key');
  await link.click();await page.getByRole('button',{name:'Discard draft',exact:true}).click();await expect(page.locator('.core-startup-page')).toBeVisible();assert.deepEqual({posts,puts},{posts:0,puts:0});
  await page.goto(server.origin+'/admin/setup');await fillModel(page,'save-before-workbench');await link.click();await page.getByRole('dialog').getByRole('button',{name:'Save and continue',exact:true}).click();await expect(page.locator('.core-startup-page')).toBeVisible();assert.deepEqual({posts,puts},{posts:1,puts:1});
  await page.goto(server.origin+'/admin/setup?step=prepare');await expect(page.locator('#workbench-exit')).toBeDisabled();await expect(link).toBeEnabled();await link.click();await expect(page.locator('.core-startup-page')).toBeVisible();
  await page.goto(server.origin+'/admin/runtime');await page.getByRole('button',{name:'Edit runtime',exact:true}).click();await page.locator('#modelRef').selectOption({index:0});await link.click();await expect(page.getByRole('dialog')).toContainText('Discard unsaved changes?');await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.locator('#runtime-form')).toBeVisible();
 }finally{await browser.close();await server.stop();}
});

test('Admin account menu shares Desktop geometry and keeps the Workbench link before its avatar',async()=>{
 const server=await start({PIWORK_ADMIN_ACCOUNT:'admin',PIWORK_ADMIN_PASSWORD:'synthetic-password'}),browser=await chromium.launch(browserOptions);
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});await loginSetup(page,server);await page.goto(server.origin+'/');await page.locator('[data-action=account]').click();
  const style=async(node:any)=>node.evaluate((el:HTMLElement)=>{const s=getComputedStyle(el);return {height:el.getBoundingClientRect().height,padding:s.padding,fontSize:s.fontSize,fontWeight:s.fontWeight,gap:s.gap,icon:el.querySelector('svg')!.getBoundingClientRect().width};});
  const desktop=await style(page.getByRole('menuitem',{name:'About Piwork',exact:true}));await page.keyboard.press('Escape');await page.goto(server.origin+'/admin/setup');const trigger=page.getByRole('button',{name:'Administrator account',exact:true});
  for(const width of [1440,360]){
   await page.setViewportSize({width,height:1000});await trigger.click();const menu=page.getByRole('menu');await expect(menu.locator('.dropdown-title')).toHaveText('admin');await expect(menu.locator('.account-context')).toContainText(coreOrigin(server));
   const about=menu.getByRole('menuitem',{name:'About Piwork',exact:true}),signout=menu.getByRole('menuitem',{name:'Sign out',exact:true});assert.deepEqual(await style(about),desktop);assert.deepEqual(await style(signout),desktop);assert.equal(await signout.evaluate(el=>getComputedStyle(el).color),'rgb(180, 35, 50)');
   const link=page.getByRole('link',{name:'Workbench',exact:true});assert.equal(await link.evaluate(el=>!!(el.compareDocumentPosition(document.querySelector('#account-trigger')!)&Node.DOCUMENT_POSITION_FOLLOWING)),true);await page.keyboard.press('Escape');await expect(trigger).toBeFocused();await link.focus();assert.equal(await link.evaluate(el=>getComputedStyle(el).outlineStyle),'solid');assert.equal(await link.evaluate(el=>el.getBoundingClientRect().height),34);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await trigger.click();if(process.env.PIWORK_ONBOARDING_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PIWORK_ONBOARDING_EVIDENCE_DIR,`admin-account-${width}.png`),fullPage:false});await page.keyboard.press('Escape');
  }
  await trigger.focus();await page.keyboard.press('ArrowUp');await expect(page.getByRole('menuitem',{name:'Sign out',exact:true})).toBeFocused();await page.keyboard.press('Home');await page.keyboard.press('Space');await expect(page.locator('main h1')).toHaveText('About Piwork');await expect(page.getByRole('menu')).toHaveCount(0);
  const longAccount='administrator-'+('long'.repeat(24)),core='http://core-'+('x'.repeat(60))+'.example.invalid:7171';await page.route('**/console/api/session',async route=>{const response=await route.fetch(),value=await response.json();value.user.account=longAccount;value.coreUrl=core;await route.fulfill({response,json:value});});await page.reload();await trigger.click();await expect(page.getByRole('menu').locator('.dropdown-title')).toHaveText(longAccount);for(const width of [1440,360]){await page.setViewportSize({width,height:1000});await trigger.click();if(process.env.PIWORK_ONBOARDING_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PIWORK_ONBOARDING_EVIDENCE_DIR,`admin-account-long-${width}.png`),fullPage:false});await page.keyboard.press('Escape');}
 }finally{await browser.close();await server.stop();}
});

test('leaving and returning to Quick setup discards late Test callbacks without unlocking the new view',async()=>{
 const server=await start({PIWORK_ADMIN_ACCOUNT:'admin',PIWORK_ADMIN_PASSWORD:'synthetic-password'}),browser=await chromium.launch(browserOptions);let oldRelease=()=>{},newRelease=()=>{};
 try{
  const page=await browser.newPage();await loginSetup(page,server);await fillModel(page,'old-view');const oldGate=new Promise<void>(r=>{oldRelease=r;}),newGate=new Promise<void>(r=>{newRelease=r;});let tests=0;
  await page.route('**/console/api/admin/model-tests',async route=>{const input=route.request().postDataJSON();tests++;await(input.model==='old-view'?oldGate:newGate);await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,api:input.api,model:input.model,category:'success',testMessage:'Reply with OK.',replyText:input.model,replyTruncated:false,checkedAt:new Date().toISOString(),durationMs:1})});});
  await page.getByRole('button',{name:'Test',exact:true}).click();await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('link',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'Discard draft',exact:true}).click();await openQuickSetup(page);await fillModel(page,'new-view');await page.getByRole('button',{name:'Test',exact:true}).click();await expect.poll(()=>tests).toBe(2);oldRelease();await expect(page.getByRole('dialog')).toContainText('Sending the test message');await expect(page.getByRole('dialog')).not.toContainText('old-view');await expect(page.getByRole('button',{name:'Test',exact:true})).toBeDisabled();await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('synthetic-model-key');newRelease();await expect(page.locator('[data-model-test-reply]')).toHaveText('new-view');await page.getByRole('button',{name:'Close',exact:true}).click();await expect(page.getByRole('button',{name:'Test',exact:true})).toBeEnabled();
 }finally{oldRelease();newRelease();await browser.close();await server.stop();}
});

test('Quick setup sign-out waits once, preserves its model view on failure and revokes only on success',async()=>{
 const server=await start({PIWORK_ADMIN_ACCOUNT:'admin',PIWORK_ADMIN_PASSWORD:'synthetic-password'}),browser=await chromium.launch(browserOptions);let release=()=>{};
 try{
  const page=await browser.newPage();await loginSetup(page,server);const original=await page.getByLabel('Model ID',{exact:true}).elementHandle();let calls=0;const gate=new Promise<void>(r=>{release=r;});
  await page.route('**/console/api/logout',async route=>{calls++;await gate;await route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({code:'CORE_UNAVAILABLE'})});});
  const trigger=page.getByRole('button',{name:'Administrator account',exact:true});await trigger.click();const signout=page.getByRole('menuitem',{name:'Sign out',exact:true});await signout.click();await expect(signout).toBeDisabled();await expect(signout).toHaveAttribute('aria-busy','true');await signout.evaluate((el:HTMLButtonElement)=>el.click());assert.equal(calls,1);release();await expect(page.locator('#quick-feedback')).toContainText('Sign out was not completed');await expect(signout).toBeEnabled();assert.equal(await original!.evaluate(el=>el===document.querySelector('#model-id')),true);await expect(page.getByRole('menu')).toBeVisible();await page.keyboard.press('Escape');
  await page.unroute('**/console/api/logout');await trigger.click();await signout.click();await expect(page.getByRole('heading',{name:'Sign in to Piwork'})).toBeVisible();await expect(page.locator('#quick-setup')).toHaveCount(0);assert.equal((await page.evaluate(async()=>(await(await fetch('/_web/api/session')).json()).authenticated)),false);
 }finally{release();await browser.close();await server.stop();}
});

test('Admin session expiry uses the unified login and clears the Quick setup draft',async()=>{
 const server=await start({PIWORK_ADMIN_ACCOUNT:'admin',PIWORK_ADMIN_PASSWORD:'synthetic-password'}),browser=await chromium.launch(browserOptions);
 try{
  const page=await browser.newPage();await loginSetup(page,server);await fillModel(page);await page.getByRole('button',{name:'Administrator account',exact:true}).click();await expect(page.getByRole('menu')).toBeVisible();
  await page.evaluate(async()=>{const session=await(await fetch('/_web/api/session')).json();await fetch('/_web/api/logout',{method:'POST',headers:{'Content-Type':'application/json','X-Piwork-Csrf':session.csrfToken},body:'{}'});window.dispatchEvent(new Event('focus'));});
  await expect(page.getByRole('heading',{name:'Sign in to Piwork'})).toBeVisible();assert.equal(new URL(page.url()).pathname,'/login');await expect(page.locator('#quick-setup')).toHaveCount(0);await expect(page.getByRole('menu')).toHaveCount(0);await expect(page.getByRole('button',{name:'Sign out',exact:true})).toHaveCount(0);await expect(page.locator('input[type=password]')).toHaveCount(1);await expect(page.getByLabel('Password',{exact:true})).toHaveValue('');
 }finally{await browser.close();await server.stop();}
});

for(const destination of ['users','new-quick-draft'])test(`a delayed save-and-leave read cannot replace the newer ${destination} view`,async()=>{
 const server=await start({PIWORK_ADMIN_ACCOUNT:'admin',PIWORK_ADMIN_PASSWORD:'synthetic-password'}),browser=await chromium.launch(browserOptions);let release=()=>{};
 try{
  const page=await browser.newPage();await loginSetup(page,server);await fillModel(page,'late-leave-model');let captured=()=>{},reads=0,posts=0,puts=0,tests=0,works=0;
  const held=new Promise<void>(resolve=>{captured=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  page.on('request',r=>{const path=new URL(r.url()).pathname;if(r.method()==='POST'&&path.endsWith('/admin/models'))posts++;if(r.method()==='PUT'&&path.endsWith('/admin/runtime'))puts++;if(path.endsWith('/model-tests'))tests++;if(r.method()==='POST'&&path.endsWith('/works'))works++;});
  await page.route('**/_web/api/onboarding',async route=>{reads++;if(reads>1){await route.continue();return;}const response=await route.fetch();captured();await gate;await route.fulfill({response});});
  await page.getByRole('link',{name:'Workbench',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Save and continue',exact:true}).click();await held;await expect(page.locator('#preparation-answer')).toBeVisible();await page.getByRole('link',{name:'User access',exact:true}).click();await expect(page.locator('main h1')).toHaveText('Give people access');
  let expected='/admin/users';
  if(destination==='new-quick-draft'){
   await page.getByRole('link',{name:'Overview',exact:true}).click();await openQuickSetup(page);await page.getByRole('button',{name:'Add model',exact:true}).click();await fillModel(page,'new-draft-after-leave');await page.getByLabel('Model ID',{exact:true}).focus();expected='/admin/setup';
   await page.getByLabel('Model ID',{exact:true}).evaluate((input:HTMLInputElement)=>{(window as any).newLeaveInput=input;input.setSelectionRange(2,5);});
  }
  const reply=page.waitForResponse(r=>r.url().endsWith('/_web/api/onboarding'));release();await reply;await page.evaluate(async()=>{await new Promise<void>(r=>setTimeout(r,0));});
  await page.waitForTimeout(250);assert.equal(new URL(page.url()).pathname,expected);
  if(destination==='new-quick-draft'){
   const field=page.getByLabel('Model ID',{exact:true});await expect(field).toHaveValue('new-draft-after-leave');await expect(field).toBeFocused();assert.deepEqual(await field.evaluate((input:HTMLInputElement)=>[input===(window as any).newLeaveInput,input.selectionStart,input.selectionEnd]),[true,2,5]);await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('synthetic-model-key');await expect(page.getByRole('button',{name:'Save and continue',exact:true})).toBeEnabled();
  }else await expect(page.locator('main h1')).toHaveText('Give people access');
  assert.deepEqual({posts,puts,tests,works},{posts:1,puts:1,tests:0,works:0});
 }finally{release();await browser.close();await server.stop();}
});
