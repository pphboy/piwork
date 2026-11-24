import {buildNativeTestServer} from '../../../scripts/native-test-server.mjs';
import { test, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { createServer as createHTTPServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalog } from '../dist/browser/i18n/catalog.js';

let nativeCore = process.env.PIWORK_TEST_NATIVE_CORE || fileURLToPath(new URL("../../../dist/go/piwork-core", import.meta.url));
async function freePort() {
  const listener = createNetServer();
  await new Promise((done) => listener.listen(0, "127.0.0.1", done));
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  return port;
}
test.use({ viewport: { width: 1440, height: 900 } });
let root, core, origin, coreOrigin, coreArgs, coreEnvironment;
let nativeCoreOutput = "";
function captureProcessOutput(child, append) {
  child.stdout?.on("data", (chunk) => append(chunk.toString()));
  child.stderr?.on("data", (chunk) => append(chunk.toString()));
}
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "piwork-console-real-core-"));
  if(!process.env.PIWORK_TEST_NATIVE_CORE)nativeCore=buildNativeTestServer(join(root,'bin'),{agent:process.env.PIWORK_TEST_NATIVE_AGENT_IMAGE||'piwork-agentd:go-migration-acceptance',packageHelper:process.env.PIWORK_TEST_NATIVE_AGENT_IMAGE||'piwork-agentd:go-migration-acceptance',fileHelper:process.env.PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE||'piwork-file-helper:go-migration-acceptance',snapshotHelper:process.env.PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE||'piwork-snapshot-helper:go-migration-acceptance'});
  const [corePort,uiPort]=await Promise.all([freePort(),freePort()]);
  coreOrigin=`http://127.0.0.1:${corePort}`;origin=`http://127.0.0.1:${uiPort}`;
  coreArgs=['--data-dir',join(root,'core'),'--ui-port',String(uiPort),'--core-port',String(corePort)];
  coreEnvironment={...process.env,DISPLAY:'',WAYLAND_DISPLAY:'',PIWORK_ADMIN_ACCOUNT:'admin',PIWORK_ADMIN_PASSWORD:'correct horse battery'};
  await startCore();
});
test.afterAll(async () => {
  if (core && core.exitCode === null) { core.kill("SIGTERM"); await new Promise((done) => core.once("exit", done)); }
  if (root) await rm(root, { recursive: true, force: true });
});
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    console.error("Go Core process status:", core?.exitCode, nativeCoreOutput.slice(-3000));
  }
});

async function startCore() {
  nativeCoreOutput = "";
  core = spawn(nativeCore, coreArgs, { stdio: ["ignore", "pipe", "pipe"], env: coreEnvironment });
  captureProcessOutput(core, chunk => { nativeCoreOutput += chunk; });
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(origin + '/healthz')).ok) return; } catch {}
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error('Core UI did not start: ' + nativeCoreOutput.slice(-2000));
}
async function restartCore() {
  if (core && core.exitCode === null) { core.kill('SIGTERM'); await new Promise(done => core.once('exit', done)); }
  await startCore();
}
async function login(page) {
  await page.goto(`${origin}/login`);
  await page.getByLabel('Account', { exact: true }).fill('admin');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(url=>url.pathname!=='/login');
  await page.goto(origin+'/admin');
  await expect(page.getByRole('heading', { name: 'Overview', level: 1, exact: true })).toBeVisible();
}

for (const locale of ['en', 'zh-CN']) test(`real Core availability works before Runtime configuration in ${locale}`, async ({ browser }) => {
  const context = await browser.newContext({ locale });
  const page = await context.newPage();
  const messages = catalog[locale];
  try {
    await page.goto(origin + '/login');
    await page.getByLabel(messages['onboarding.form.account'], { exact: true }).fill('admin');
    await page.getByLabel(messages['onboarding.form.password'], { exact: true }).fill('correct horse battery');
    await page.getByRole('button', { name: messages['onboarding.form.signIn'], exact: true }).click();
    await page.waitForURL(url => url.pathname !== '/login');
    const acceptedAvailability = () => page.evaluate(async () => (await import('/admin/browser/adapter.js')).adapter.availability?.reachable);
    await expect.poll(acceptedAvailability).toBe(true);
    const runtime = await context.request.get(origin + '/console/api/admin/runtime');
    expect(runtime.status()).toBe(200);
    expect((await runtime.json()).configured).toBe(false);
    const writes = [];
    page.on('request', request => {
      if (request.method() !== 'GET') writes.push(request.method() + ' ' + new URL(request.url()).pathname);
    });
    for (const refresh of [false, true]) {
      const availability = page.waitForResponse(response => new URL(response.url()).pathname === '/console/api/availability');
      if (refresh) await page.reload();
      else await page.goto(origin + '/admin');
      const response = await availability;
      await response.finished();
      expect(response.request().method()).toBe('GET');
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ reachable: true });
      // Wait for the actual application to accept the read before asserting
      // absence of a banner; a response alone can precede its UI callback.
      await expect.poll(acceptedAvailability).toBe(true);
      await expect(page.locator('.overview-heading').getByRole('heading', { name: messages['shell.navOverview'], exact: true })).toBeVisible();
      await expect(page.locator('#console-availability-notice')).toHaveCount(0);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
    }
    expect(writes).toEqual([]);
  } finally { await context.close(); }
});

test('real Core login and administration retain identity across both languages', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN' });
  const page = await context.newPage();
  const zh = catalog['zh-CN'], en = catalog.en;
  try {
    await page.goto(`${origin}/login`);
    await page.getByLabel(zh['onboarding.form.account'], { exact: true }).fill('admin');
    await page.getByLabel(zh['onboarding.form.password'], { exact: true }).fill('correct horse battery');
    await page.getByRole('button', { name: zh['onboarding.form.signIn'], exact: true }).click();
    await page.waitForURL(url => url.pathname !== '/login');
    await page.goto(`${origin}/admin`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.locator('.overview-heading').getByRole('heading', { name: zh['shell.navOverview'], exact: true })).toBeVisible();
    await page.goto(`${origin}/admin/users`);
    await expect(page.getByRole('heading', { name: zh['users.pageTitle'], exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'admin', exact: true })).toBeVisible();
    await page.locator('#account-trigger').click();
    await page.locator('#account-dropdown [data-action="language"]').click();
    await page.locator('.language-picker [data-locale="en"]').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: en['users.pageTitle'], exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'admin', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  } finally { await context.close(); }
});
test('real message Test sends to the specified model and displays actual Responses and Messages replies in a Modal',async({page})=>{
  const captured=[];let failureStatus=0;
  const gateway=createHTTPServer(async(request,response)=>{
    const chunks=[];for await(const chunk of request)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());
    const api=request.url==='/v1/responses'?'openai-responses':'anthropic-messages';
    captured.push({api,path:request.url,body,key:request.headers.authorization||request.headers['x-api-key']});
    if(failureStatus){response.writeHead(failureStatus,{'Content-Type':'application/json'});response.end(JSON.stringify({error:{message:'private upstream error must not be shown'}}));return;}
    const text='Actual '+api+' reply from '+body.model;
    response.setHeader('Content-Type','application/json');response.end(JSON.stringify(api==='openai-responses'?{status:'completed',error:null,output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]}:{type:'message',role:'assistant',content:[{type:'text',text}]}));
  });
  await new Promise(done=>gateway.listen(0,'127.0.0.1',done));const baseUrl=`http://127.0.0.1:${gateway.address().port}`;
  try{
    await login(page);
    for(const api of ['openai-responses','anthropic-messages']){
      const provider='Message Test '+api,model='Specified '+api;
      await page.goto(origin+'/admin/models');await page.getByLabel('Display name (optional)',{exact:true}).fill(provider);await page.getByLabel('API type',{exact:true}).selectOption(api);await page.getByLabel('Base URL',{exact:true}).fill(baseUrl+'/v1/');await page.getByLabel('API Key',{exact:true}).fill('synthetic-'+api);await page.getByLabel('Model ID',{exact:true}).fill('specified-test-model');
      await page.getByRole('button',{name:'Test',exact:true}).click();
      await expect(page.locator('[data-model-test-reply]')).toHaveText('Actual '+api+' reply from specified-test-model');
      await expect(page.getByRole('dialog')).toContainText('Reply OK');
      await page.getByRole('dialog').locator('.dialog-footer').getByRole('button',{name:'Close',exact:true}).click();
      await page.getByRole('button',{name:'Add model',exact:true}).click();await page.getByRole('link',{name:provider,exact:true}).click();
      await page.getByRole('button',{name:'Test',exact:true}).click();
      await expect(page.locator('[data-model-test-reply]')).toHaveText('Actual '+api+' reply from specified-test-model');
      await page.getByRole('dialog').locator('.dialog-footer').getByRole('button',{name:'Close',exact:true}).click();
      const count=captured.length;
      await page.getByRole('button',{name:'View test result',exact:true}).click();
      await expect(page.locator('[data-model-test-reply]')).toHaveText('Actual '+api+' reply from specified-test-model');
      await page.getByRole('dialog').locator('.dialog-footer').getByRole('button',{name:'Close',exact:true}).click();
      expect(captured.length).toBe(count);
    }
    expect(captured.length).toBe(4);
    for(const request of captured){
      expect(request.body.model).toBe('specified-test-model');expect(request.body.stream).toBe(false);
      if(request.api==='openai-responses'){
        expect(request.path).toBe('/v1/responses');
        expect(request.body.input).toBe('Reply OK');
        expect(request.body.max_output_tokens).toBe(64);
        expect(request.key).toBe('Bearer synthetic-openai-responses');
      }else{
        expect(request.path).toBe('/v1/messages');
        expect(request.body.messages).toEqual([{role:'user',content:'Reply OK'}]);
        expect(request.body.max_tokens).toBe(64);
        expect(request.key).toBe('synthetic-anthropic-messages');
      }
    }
    failureStatus=404;
      await page.goto(origin+'/admin/models');
      await page.getByLabel('Display name (optional)',{exact:true}).fill('Remote failure can save');
      await page.getByLabel('API type',{exact:true}).selectOption('anthropic-messages');
      await page.getByLabel('Base URL',{exact:true}).fill(baseUrl+'/v1');
      await page.getByLabel('API Key',{exact:true}).fill('synthetic-failed-test');
      await page.getByLabel('Model ID',{exact:true}).fill('specified-test-model');
      await page.getByRole('button',{name:'Test',exact:true}).click();
      await expect(page.locator('[data-model-test-stage]')).toHaveText('Model request failed.');
      await expect(page.getByRole('dialog')).toContainText('model or endpoint');
      await expect(page.getByRole('dialog')).not.toContainText('private upstream');
      await page.getByRole('dialog').locator('.dialog-footer').getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'Add model',exact:true}).click();await page.getByRole('link',{name:'Remote failure can save',exact:true}).click();await expect(page.getByLabel('Base URL',{exact:true})).toHaveValue(baseUrl);
    failureStatus=401;
      await page.getByLabel('Model ID',{exact:true}).fill('specified-test-model');
      await page.getByRole('button',{name:'Test',exact:true}).click();
      await expect(page.getByRole('dialog')).toContainText('administrator login is still valid');
      await page.getByRole('dialog').locator('.dialog-footer').getByRole('button',{name:'Close',exact:true}).click();
      await expect(page.getByRole('heading',{name:'Remote failure can save',exact:true})).toBeVisible();
      expect(captured.length).toBe(6);
    expect(JSON.stringify(await page.context().cookies())).not.toContain('synthetic-');
  }finally{await new Promise(done=>gateway.close(done));}
});
test('delivered Core UI uses real administrator users, revocation, and browser Skill upload', async ({page}) => {
  await login(page);
  await page.getByRole('link', { name: 'Users', exact: true }).click();
  await page.getByRole('button', { name: 'Create user', exact: true }).click();
  await page.getByLabel('Account', { exact: true }).fill('new-user');
  await page.getByLabel('Password', { exact: true }).fill('new-user-password');
  await page.getByLabel('Confirm password').fill('new-user-password');
  await page.locator('#dialog-submit').click();
  const user = page.getByRole('row').filter({ has: page.getByRole('button', {name:'new-user',exact:true}) });
  await expect(user).toBeVisible();
  await user.getByRole('button', {name:'Disable',exact:true}).click();
  await page.locator('#dialog-submit').click();
  await expect(user.getByText('Disabled', {exact:true})).toBeVisible();
  await user.getByRole('button', {name:'Enable',exact:true}).click();
  await page.locator('#dialog-submit').click();
  await expect(user.getByText('Enabled', {exact:true})).toBeVisible();
  await user.getByRole('button', {name:'Reset password',exact:true}).click();
  await page.getByLabel('New password', {exact:true}).fill('replacement-password-123');
  await page.getByLabel('Confirm password', {exact:true}).fill('replacement-password-123');
  await page.locator('#dialog-submit').click();
  await expect(user).toBeVisible();
  const skillDirectory = join(root,'real-skill'); await mkdir(skillDirectory); await writeFile(join(skillDirectory,'SKILL.md'),'# Real Skill\n');
  await page.getByRole('link',{name:'Setup',exact:true}).click();
  await page.getByRole('link',{name:'Library',exact:true}).click();
  await page.getByRole('button',{name:'Add Skill',exact:true}).click();
  await page.getByLabel('Choose Skill directory').setInputFiles(skillDirectory);
  await page.getByRole('button',{name:'Upload Skill',exact:true}).click();
  await expect(page.locator('#detail-title')).toContainText('real-skill');
  expect(JSON.stringify(await page.context().cookies())).not.toContain('Bearer ');
});
async function saveFixtureRuntime(page) {
  if((await fetch(`${coreOrigin}/readyz`)).status===200)return;
  await page.goto(`${origin}/admin/models`);
  const model='Browser fixture model';
  await expect(page.getByRole('heading',{name:'AI models',exact:true})).toBeVisible();
  if(!await page.getByRole('link',{name:model,exact:true}).count()){
    await page.getByLabel('Display name (optional)',{exact:true}).fill(model);
    await page.getByLabel('Model ID',{exact:true}).fill('browser-fixture-model');
    await page.getByLabel('API type',{exact:true}).selectOption('anthropic-messages');
    await page.getByLabel('Base URL',{exact:true}).fill('http://127.0.0.1:1');
    await page.getByLabel('API Key',{exact:true}).fill('browser-acceptance-only');
    await page.getByRole('button',{name:'Add model',exact:true}).click();
    await expect(page.getByRole('link',{name:model,exact:true})).toBeVisible();
  }
  await page.goto(`${origin}/admin/runtime`);
  const edit=page.getByRole('button',{name:'Edit runtime',exact:true});
  await expect(edit.or(page.locator('#modelRef')).first()).toBeVisible();if(await edit.isVisible())await edit.click();
  const option=page.locator('#modelRef option').filter({hasText:model});await page.locator('#modelRef').selectOption(await option.getAttribute('value'));
  await expect(page.locator('#apiKey')).toHaveCount(0);
  await page.getByRole('button',{name:'Save runtime',exact:true}).click();await expect(edit).toBeVisible({timeout:90000});
  await expect.poll(async()=>(await fetch(`${coreOrigin}/readyz`)).status,{timeout:90000,message:'Core preparation requires the native acceptance image'}).toBe(200);
}
test('real Core runtime and starting point distinguish saved changes from existing Work', async ({page}) => {
  test.setTimeout(120000); await login(page); await saveFixtureRuntime(page);
  await page.getByRole('link',{name:'Setup',exact:true}).click();
  await page.locator('[data-action="edit-defaults"][data-section="agentsMd"]').click();
  await page.locator('#agentsMd').fill('# Console native default\n');
  await page.locator('[data-action="save-defaults"]').click();
  await expect(page.getByText(/Saved.*confirmed|Starting point saved|Defaults saved/).first()).toBeVisible();
  await page.reload();
  await page.locator('[data-action="edit-defaults"][data-section="agentsMd"]').click();
  await expect(page.locator('#agentsMd')).toHaveValue('# Console native default\n');
});
async function installFixturePackage(page, name) {
  const directory = join(root, name);
  await mkdir(directory);
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', pi: { prompts: ['review.md'] } }));
  await writeFile(join(directory, 'review.md'), '# Review\n');
  await page.goto(`${origin}/admin/packages`);
  await page.getByRole('button', { name: 'Install Package', exact: true }).click();
  await page.getByRole('button', { name: 'Local directory', exact: true }).click();
  await page.getByLabel('Choose Package directory').setInputFiles(directory);
  await page.locator('#dialog-submit').click();
  await expect(page.getByRole('heading', { name: 'Package operation', exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/^succeeded$/i).first()).toBeVisible({ timeout: 90000 });
}

test('real browser Package directory installs asynchronously and operation deep link recovers', async ({page}) => {
  test.setTimeout(120000);
  await login(page);
  await saveFixtureRuntime(page);
  await installFixturePackage(page, 'native-console-package');
  const operationURL = page.url(); await page.reload();
  await expect(page.getByText(/^succeeded$/i).first()).toBeVisible(); expect(page.url()).toBe(operationURL);
  await page.goto(`${origin}/admin/packages`);
  await expect(page.getByRole('button',{name:'native-console-package',exact:true})).toBeVisible();
});

test('real flat long model names round-trip through Console and Go Core without truncation',async({page})=>{
 await login(page);await page.goto(origin+'/admin/models');const model='long-'+ 'x'.repeat(251),name='😀'.repeat(256);
 await page.getByLabel('Model ID',{exact:true}).fill(model);await page.getByLabel('API type',{exact:true}).selectOption('anthropic-messages');await page.getByLabel('Base URL',{exact:true}).fill('http://127.0.0.1:1');await page.getByLabel('API Key',{exact:true}).fill('synthetic-long-model-key');await page.getByRole('button',{name:'Add model',exact:true}).click();await expect(page.getByRole('link',{name:model,exact:true})).toBeVisible();await page.getByRole('link',{name:model,exact:true}).click();await expect(page.getByLabel('Display name (optional)',{exact:true})).toHaveValue(model);
 await page.getByLabel('Display name (optional)',{exact:true}).fill(name);await page.getByRole('button',{name:'Save model',exact:true}).click();await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();await page.reload();await expect(page.getByLabel('Display name (optional)',{exact:true})).toHaveValue(name);await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('');
 await page.getByLabel('Display name (optional)',{exact:true}).fill('');await page.getByRole('button',{name:'Save model',exact:true}).click();await expect(page.getByLabel('Display name (optional)',{exact:true})).toHaveValue('');await page.reload();await expect(page.getByLabel('Display name (optional)',{exact:true})).toHaveValue(model);expect(await page.content()).not.toContain('synthetic-long-model-key');
});

test('real Core Skill content edit, defaults and embedded assets survive a restart', async ({ page, browser }) => {
  test.setTimeout(180000);
  const directory = join(root, 'content-skill');
  await mkdir(join(directory, 'references'), { recursive: true });
  await mkdir(join(directory, 'assets'), { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), '# Content Skill\n');
  await writeFile(join(directory, 'references', 'rules.md'), '# Rules\n');
  await writeFile(join(directory, 'assets', 'blob.bin'), Buffer.from([0xff, 0x00, 0xfe]));
  await login(page);
  await saveFixtureRuntime(page);
  await page.goto(origin + '/admin/skills');
  await page.getByRole('button', { name: 'Add Skill', exact: true }).click();
  await page.getByLabel('Choose Skill directory').setInputFiles(directory);
  await page.getByRole('button', { name: 'Upload Skill', exact: true }).click();
  await expect(page.locator('#detail-title')).toContainText('content-skill');
  await expect(page.locator('#file-editor')).toHaveValue('# Content Skill\n');
  await page.locator('#file-editor').fill('# Edited content\n');
  await page.locator('[data-action="save-file"]').click();
  await expect(page.locator('#editor-save-state')).toHaveText('Saved');
  await page.goto(origin + '/admin/skills/content-skill');
  await expect(page.locator('#file-editor')).toHaveValue('# Edited content\n');
  await page.getByRole('button', { name: /assets/ }).click();
  await page.getByRole('button', { name: 'blob.bin' }).click();
  await expect(page.getByRole('heading', { name: 'This file cannot be edited as text' })).toBeVisible();
  const bundle = await page.request.get(origin + '/admin/browser/app.js');
  expect(bundle.ok()).toBe(true);
  expect(await bundle.text()).toContain("t('library.title')");
  await page.goto(origin + '/admin/default-work');
  await page.locator('[data-action="edit-defaults"][data-section="skills"]').click();
  await page.locator('[data-default-skill="content-skill"]').check();
  const defaultsSaved = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/console/api/admin/default-work' && response.request().method() === 'PATCH');
  await page.locator('[data-action="save-defaults"]').click();
  const savedResponse = await defaultsSaved;
  expect(savedResponse.ok()).toBe(true);
  expect(savedResponse.request().postDataJSON()).toEqual({ skills: ['content-skill'] });
  expect((await savedResponse.json()).configuration.skills).toEqual(['content-skill']);
  await expect(page.getByText(/Saved.*confirmed|Starting point saved|Defaults saved/).first()).toBeVisible();

  const packageName = 'console-ordered-default';
  await installFixturePackage(page, packageName);
  await page.goto(origin + '/admin/default-work');
  const packagesBefore = await page.request.get(origin + '/console/api/admin/default-work');
  expect(packagesBefore.ok()).toBe(true);
  const previousPackageNames = (await packagesBefore.json()).configuration.packages.map(entry => entry.name);
  expect(previousPackageNames.length).toBeGreaterThan(0);
  await page.locator('[data-action="edit-defaults"][data-section="packages"]').click();
  await page.locator(`[data-default-package="${packageName}"]`).check();
  await page.locator('[data-action="save-defaults"]').click();
  const packageSummary = page.locator('[data-testid="default-summary-packages"] .summary-token');
  await expect(packageSummary).toHaveText([...previousPackageNames, packageName]);
  await page.locator('[data-action="edit-defaults"][data-section="packages"]').click();
  await page.locator(`[data-action="move-package"][data-name="${packageName}"][data-direction="up"]`).click();
  const orderedPackageNames = [
    ...previousPackageNames.slice(0, -1), packageName, previousPackageNames.at(-1),
  ];
  const orderSaved = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/console/api/admin/default-work' && response.request().method() === 'PATCH');
  await page.locator('[data-action="save-defaults"]').click();
  const orderResponse = await orderSaved;
  expect(orderResponse.ok()).toBe(true);
  expect(orderResponse.request().postDataJSON()).toEqual({ packages: orderedPackageNames });
  expect((await orderResponse.json()).configuration.packages.map(entry => entry.name)).toEqual(orderedPackageNames);
  await expect(packageSummary).toHaveText(orderedPackageNames);

  await restartCore();
  await login(page);
  await page.goto(origin + '/admin/default-work');
  const persistedDefaults = await page.request.get(origin + '/console/api/admin/default-work');
  expect(persistedDefaults.ok()).toBe(true);
  const persistedConfiguration = (await persistedDefaults.json()).configuration;
  expect(persistedConfiguration.skills).toEqual(['content-skill']);
  expect(persistedConfiguration.packages.map(entry => entry.name)).toEqual(orderedPackageNames);
  await expect(packageSummary).toHaveText(orderedPackageNames);
  await page.goto(origin + '/admin/skills/content-skill');
  await expect(page.locator('#file-editor')).toHaveValue('# Edited content\n');
  await expect(page.locator('.navigator-item[data-name="content-skill"] .row-note')).toHaveText('Default');
  const anonymous = await browser.newContext();
  try {
    const denied = await anonymous.request.get(origin + '/console/api/admin/skills/content-skill/file?path=SKILL.md');
    expect([401, 403]).toContain(denied.status());
  } finally { await anonymous.close(); }
});
