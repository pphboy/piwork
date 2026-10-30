import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp,rm,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium,expect } from '@playwright/test';

const e=process.env,root=await mkdtemp(join(tmpdir(),'piwork-provider-browser-')),children=[];
let browser,desktop;
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function wait(check,label){for(let i=0;i<240;i++){try{const v=await check();if(v)return v;}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error('Timed out: '+label);}
function child(binary,args,env={}){const p=spawn(binary,args,{stdio:['ignore','pipe','pipe'],env:{...e,PATH:'/nonexistent',...env}});children.push(p);let output='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);return()=>output;}
try{
  const [consolePort,desktopPort]=await Promise.all([port(),port()]);
  const origin=`http://127.0.0.1:${consolePort}`;
  const output=child(e.PIWORK_TEST_HOSTED_FIXTURE,[JSON.stringify({Core:e.PIWORK_TEST_MODEL_CORE_URL,Directory:join(root,'admin'),Listen:`127.0.0.1:${consolePort}`})]);
  await wait(()=>output().includes('hosted fixture listening'),'hosted UI startup');
  browser=await chromium.launch({headless:true,channel:'chromium'});
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}}),page=await context.newPage();
  await page.goto(origin+'/login');await page.getByLabel('Account',{exact:true}).fill('admin');await page.getByLabel('Password',{exact:true}).fill('development-fixture-pass');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.waitForURL(url=>url.pathname!=='/login');await page.goto(origin+'/admin/models');
  for(const [name,api,key] of [['Browser first','openai-responses','synthetic-browser-first'],['Browser second','openai-responses','synthetic-browser-second'],['Browser Messages','anthropic-messages','synthetic-browser-messages']]){
    await page.getByLabel('Display name (optional)',{exact:true}).fill(name);await page.getByLabel('Model ID',{exact:true}).fill('browser-custom-unknown');await page.getByLabel('API type',{exact:true}).selectOption(api);await page.getByLabel('Base URL',{exact:true}).fill(e.PIWORK_TEST_MODEL_GATEWAY+'/v1/');await page.getByLabel('API Key',{exact:true}).fill(key);
    await expect(page.getByLabel('Provider name',{exact:true})).toHaveCount(0);await expect(page.locator('#model-capabilities')).toHaveCount(0);
    await page.getByRole('button',{name:'Test',exact:true}).click();await expect(page.locator('[data-model-test-reply]')).toHaveText('gateway:'+api+':browser-custom-unknown');await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'Add model',exact:true}).click();await expect(page.getByRole('link',{name,exact:true})).toBeVisible();
  }
  const desktopOutput=child(e.PIWORK_TEST_NATIVE_CLI,['--core',e.PIWORK_TEST_MODEL_CORE_URL,'desktop','--port',String(desktopPort),'--no-open'],{PIWORK_CONFIG_PATH:join(root,'client.json')});
  const launch=await wait(()=>desktopOutput().match(/http:\/\/desktop\.localhost:\d+\/(?:#ticket=[\w-]+)?/)?.[0],'Desktop startup');
  desktop=await context.newPage();await desktop.goto(launch);await desktop.getByRole('heading',{name:'Connect to your Core',exact:true}).waitFor();await desktop.getByRole('textbox',{name:'Account',exact:true}).fill('admin');await desktop.getByLabel('Password',{exact:true}).fill('development-fixture-pass');await desktop.getByRole('button',{name:'Sign in',exact:true}).click();await desktop.locator('.works-page').waitFor();
  await desktop.goto(new URL(launch).origin+'/#/work/'+e.PIWORK_TEST_MODEL_WORK_ID);await desktop.locator('[data-action=tab-Chat]').click();
  async function choose(target,name,thinking){await target.locator('#response-settings-trigger').click();await target.locator('#model-select').click();await target.getByRole('option').filter({hasText:name}).click();await target.locator('#thinking-select').click();await target.locator(`#modal [data-option-value="${thinking}"]`).click();await target.locator('#modal .modal-footer [data-action=close-modal]').click();await expect(target.locator('[data-action=send-message]')).toBeEnabled();}
  await choose(desktop,'Browser first','responses-effort-v1:high');await desktop.locator('#composer').fill('Use Responses through the browser.');await desktop.locator('[data-action=send-message]').click();await expect(desktop.locator('#messages')).toContainText('gateway:openai-responses:browser-custom-unknown',{timeout:60000});
  await choose(desktop,'Browser Messages','messages-adaptive-v1:high');await desktop.locator('#composer').fill('Use Messages in the same Session.');await desktop.locator('[data-action=send-message]').click();await expect(desktop.locator('#messages')).toContainText('gateway:anthropic-messages:browser-custom-unknown',{timeout:60000});await expect(desktop.locator('#messages')).toContainText('gateway:openai-responses:browser-custom-unknown');
  await choose(desktop,'Browser second','responses-effort-v1:xhigh');await desktop.locator('#composer').fill('Choose the other connection with the same model ID.');await desktop.locator('[data-action=send-message]').click();await expect.poll(()=>desktop.evaluate(async work=>{const{adapter}=await import('/desktop/browser/adapter.js');const runs=adapter.getWork(work)?.sessions[0]?.runs||[];return runs.filter(r=>r.status==='succeeded').length;},e.PIWORK_TEST_MODEL_WORK_ID)).toBe(3);
  assert.equal(await desktop.evaluate(async work=>{const{adapter}=await import('/desktop/browser/adapter.js');return adapter.getWork(work)?.sessions.length;},e.PIWORK_TEST_MODEL_WORK_ID),1);
  await page.setViewportSize({width:360,height:900});await page.goto(origin+'/#/work/'+e.PIWORK_TEST_MODEL_WORK_ID);await page.locator('[data-action=tab-Chat]').click();
  await choose(page,'Browser Messages','messages-budget-v1:high');await page.locator('#composer').fill('Use budget thinking in hosted Chat.');await page.locator('[data-action=send-message]').click();await expect(page.locator('#messages')).toContainText('Use budget thinking in hosted Chat.');await expect(page.locator('#messages')).toContainText('gateway:anthropic-messages:browser-custom-unknown',{timeout:60000});
  if(e.PIWORK_TEST_MODEL_SCREENSHOT_DIR){await mkdir(e.PIWORK_TEST_MODEL_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(e.PIWORK_TEST_MODEL_SCREENSHOT_DIR,'serve-models.png'),fullPage:true});await desktop.screenshot({path:join(e.PIWORK_TEST_MODEL_SCREENSHOT_DIR,'chat-two-protocols.png'),fullPage:true});}
  console.log('Actual hosted administration and hosted/independent Chat → Core → containerized Pi SDK compatible Thinking execution passed.');
}catch(error){console.error(String(error.message??error).replace(/#ticket=[\w-]+/g,'#ticket=[redacted]'));if(desktop&&!desktop.isClosed())console.error('Desktop state:',(await desktop.locator('body').innerText()).slice(0,3000));process.exitCode=1;}
finally{await browser?.close();for(const p of children.reverse()){if(p.exitCode===null){p.kill('SIGTERM');await Promise.race([new Promise(r=>p.once('exit',r)),new Promise(r=>setTimeout(r,10000))]);if(p.exitCode===null)p.kill('SIGKILL');}}await rm(root,{recursive:true,force:true});}
