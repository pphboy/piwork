import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp,rm,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium,expect } from '@playwright/test';

const e=process.env,root=await mkdtemp(join(tmpdir(),'piwork-provider-browser-')),children=[];
let browser;
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function wait(check,label){for(let i=0;i<240;i++){try{const v=await check();if(v)return v;}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error('Timed out: '+label);}
function child(binary,args,env={}){const p=spawn(binary,args,{stdio:['ignore','pipe','pipe'],env:{...e,PATH:'/nonexistent',...env}});children.push(p);let output='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);return()=>output;}
try{
  const [consolePort,desktopPort]=await Promise.all([port(),port()]);
  const origin=`https://127.0.0.1:${consolePort}`;
  const output=child(e.PIWORK_TEST_NATIVE_CONSOLE,['serve','--core',e.PIWORK_TEST_MODEL_CORE_URL,'--listen',`127.0.0.1:${consolePort}`,'--public-origin',origin,'--data-dir',join(root,'console'),'--tls-cert',e.PIWORK_TEST_MODEL_CERT,'--tls-key',e.PIWORK_TEST_MODEL_KEY]);
  await wait(()=>output().includes('piwork-console listening at'),'Console startup');
  browser=await chromium.launch({headless:true,channel:'chromium'});
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}}),page=await context.newPage();
  await page.goto(origin+'/login');await page.getByLabel('Account',{exact:true}).fill('admin');await page.getByLabel('Password',{exact:true}).fill('development-fixture-pass');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('link',{name:'AI models',exact:true}).click();
  for(const [name,api,key] of [['Browser first','openai-responses','synthetic-browser-first'],['Browser second','openai-responses','synthetic-browser-second'],['Browser Messages','anthropic-messages','synthetic-browser-messages']]){
    await page.getByLabel('Display name (optional)',{exact:true}).fill(name);await page.getByLabel('Model ID',{exact:true}).fill('browser-custom-unknown');await page.getByLabel('API type',{exact:true}).selectOption(api);await page.getByLabel('Base URL',{exact:true}).fill(e.PIWORK_TEST_MODEL_GATEWAY+'/v1/');await page.getByLabel('API Key',{exact:true}).fill(key);
    await expect(page.getByLabel('Provider name',{exact:true})).toHaveCount(0);await expect(page.locator('#model-capabilities')).toHaveCount(0);
    await page.getByRole('button',{name:'Test',exact:true}).click();await expect(page.locator('[data-model-test-reply]')).toHaveText('gateway:'+api+':browser-custom-unknown');await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'Add model',exact:true}).click();await expect(page.getByRole('link',{name,exact:true})).toBeVisible();
  }
  const desktopOutput=child(e.PIWORK_TEST_NATIVE_CLI,['--core',e.PIWORK_TEST_MODEL_CORE_URL,'desktop','--port',String(desktopPort),'--no-open'],{PIWORK_CONFIG_PATH:join(root,'client.json')});
  const launch=await wait(()=>desktopOutput().match(/http:\/\/desktop\.localhost:\d+\/#ticket=[\w-]+/)?.[0],'Desktop startup');
  const desktop=await context.newPage();await desktop.goto(launch);await desktop.getByRole('heading',{name:'Connect to your Core',exact:true}).waitFor();await desktop.getByRole('textbox',{name:'Account',exact:true}).fill('admin');await desktop.getByLabel('Password',{exact:true}).fill('development-fixture-pass');await desktop.getByRole('button',{name:'Sign in',exact:true}).click();await desktop.getByRole('heading',{name:'Works',exact:true}).waitFor();
  await desktop.goto(new URL(launch).origin+'/#/work/'+e.PIWORK_TEST_MODEL_WORK_ID);await desktop.locator('[data-action=tab-Chat]').click();
  async function choose(name){await desktop.locator('#response-settings-trigger').click();await desktop.locator('#model-select').click();await desktop.getByRole('menuitemradio').filter({hasText:name}).click();await desktop.locator('#thinking-select').click();await desktop.locator('#modal [data-option-value=normal]').click();await desktop.locator('#modal .modal-footer [data-action=close-modal]').click();}
  await choose('Browser first');await desktop.locator('#composer').fill('Use Responses through the browser.');await desktop.locator('[data-action=send-message]').click();await expect(desktop.locator('#messages')).toContainText('gateway:openai-responses:browser-custom-unknown',{timeout:60000});
  await choose('Browser Messages');await desktop.locator('#composer').fill('Use Messages in the same Session.');await desktop.locator('[data-action=send-message]').click();await expect(desktop.locator('#messages')).toContainText('gateway:anthropic-messages:browser-custom-unknown',{timeout:60000});await expect(desktop.locator('#messages')).toContainText('gateway:openai-responses:browser-custom-unknown');
  await choose('Browser second');await desktop.locator('#composer').fill('Choose the other connection with the same model ID.');await desktop.locator('[data-action=send-message]').click();await expect.poll(()=>desktop.evaluate(async work=>{const{adapter}=await import('/desktop/browser/adapter.js');const runs=adapter.getWork(work)?.sessions[0]?.runs||[];return runs.filter(r=>r.status==='succeeded').length;},e.PIWORK_TEST_MODEL_WORK_ID)).toBe(3);
  assert.equal(await desktop.evaluate(async work=>{const{adapter}=await import('/desktop/browser/adapter.js');return adapter.getWork(work)?.sessions.length;},e.PIWORK_TEST_MODEL_WORK_ID),1);
  if(e.PIWORK_TEST_MODEL_SCREENSHOT_DIR){await mkdir(e.PIWORK_TEST_MODEL_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(e.PIWORK_TEST_MODEL_SCREENSHOT_DIR,'serve-models.png'),fullPage:true});await desktop.screenshot({path:join(e.PIWORK_TEST_MODEL_SCREENSHOT_DIR,'chat-two-protocols.png'),fullPage:true});}
  console.log('Actual Console → Core → Desktop Chat → containerized Pi SDK unknown model selection and independent connection execution passed.');
}catch(error){console.error(String(error.message??error).replace(/#ticket=[\w-]+/g,'#ticket=[redacted]'));process.exitCode=1;}
finally{await browser?.close();for(const p of children.reverse()){if(p.exitCode===null){p.kill('SIGTERM');await Promise.race([new Promise(r=>p.once('exit',r)),new Promise(r=>setTimeout(r,10000))]);if(p.exitCode===null)p.kill('SIGKILL');}}await rm(root,{recursive:true,force:true});}
