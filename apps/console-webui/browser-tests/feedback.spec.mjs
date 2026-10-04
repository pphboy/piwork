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
        'admin/users': { users: [user] }, 'admin/runtime': { configured: true, agentImage: 'agent:test', model: { provider: 'test', id: 'test', credentialAvailable: true } },
        'admin/default-work': { baseImage: 'agent:test', configuration: { skills: [], packages: [], agentsMd: 'saved' } },
        'admin/skills': { skills: [{ name: 'skill', enabled: true, fileCount: 1, totalBytes: 1 }] }, 'admin/packages': { packages: [] },
        'admin/operations/op-1': { operationId: 'op-1', name: 'pkg', state: 'running', packagePhase: 'validating' },
      };
      reply = values[request.path] ? { json: values[request.path] } : { status: 404, json: { code: 'NOT_FOUND' } };
    }
    await route.fulfill({ status: reply.status || 200, contentType: 'application/json', body: JSON.stringify(reply.json || {}) });
  });
  await page.goto(base + path); await expect(page.locator('main')).not.toContainText('Loading'); return requests;
}

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

for (const phase of ['PUT', 'readiness']) for (const outcome of ['success', 'failure']) test(`W3 old Runtime ${phase} ${outcome} cannot clear a re-entered Key/draft or release a new save lock`, async ({ page }) => {
  const old = deferred(), fresh = deferred(); let puts = 0, waiting = false;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const requests = await fixture(page, async r => {
      if (r.path === 'admin/runtime' && r.method === 'PUT') {
        puts++;
        if (puts === 1 && phase === 'PUT') { waiting = true; await old.promise; if (outcome === 'failure') return { status: 503, json: { code: 'CORE_UNREACHABLE' } }; }
        if (puts === 2) await fresh.promise;
        return { json: { runtime: { configured: true, agentImage: 'agent:saved', model: { provider: 'test', id: 'test', credentialAvailable: true } } } };
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
    await page.locator('[data-action="edit-runtime"]').first().click(); await page.locator('#agentImage').fill('agent:first'); await page.locator('#apiKey').fill('fixture-key-first');
    await page.locator('#apiKey').evaluate(el => { window.originalRuntimeKeyField = el; });
    await page.locator('#runtime-form button[type="submit"]').click();
    await expect.poll(() => phase === 'PUT' ? waiting : page.evaluate(() => !!window.oldRuntimeReadinessWaiting)).toBe(true);
    if (phase === 'readiness') { await expect(page.locator('main')).toContainText('Runtime saved'); expect(await page.evaluate(() => window.originalRuntimeKeyField.value)).toBe(''); }
    await page.locator('a[data-nav][href="/default-work"]').first().click();
    if (phase === 'PUT') await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(page).toHaveURL(base + '/default-work');
    await expect(page.getByRole('heading', { name: /^(Default Work|Shape new Work)$/ })).toBeVisible();
    await page.goBack(); await page.locator('[data-action="edit-runtime"]').first().click();
    await page.locator('#agentImage').fill('agent:fresh'); await page.locator('#apiKey').fill('fixture-key-fresh');
    const submit = page.locator('#runtime-form button[type="submit"]');
    if (phase === 'readiness') { await submit.click(); await expect.poll(() => puts).toBe(2); await expect(submit).toBeDisabled(); }
    if (phase === 'PUT') {
      const response = page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith('/admin/runtime'));
      old.resolve(); await response;
    } else await page.evaluate(() => window.releaseOldRuntimeReadiness());
    // Allow the response body, view guard and finally callback to settle before checking retained input.
    await page.waitForTimeout(100);
    await expect(page.locator('#agentImage')).toHaveValue('agent:fresh'); await expect(page.locator('#apiKey')).toHaveValue('fixture-key-fresh');
    expect(await page.evaluate(() => window.originalRuntimeKeyField.value)).toBe('');
    if (phase === 'readiness') { await expect(submit).toBeDisabled(); await submit.evaluate(el => el.click()); expect(puts).toBe(2); }
    else { await expect(submit).toBeEnabled(); await submit.click(); await expect.poll(() => puts).toBe(2); await expect(submit).toBeDisabled(); }
    expect(requests.filter(r => r.method === 'PUT').length).toBe(2);
  } finally { old.resolve(); fresh.resolve(); await page.evaluate(() => window.releaseOldRuntimeReadiness?.()).catch(() => {}); }
});

test('S05 runtime saved confirmation precedes readiness; newer non-sensitive edits stay unsaved',async({page})=>{
  const post=deferred(),health=deferred();let accepted=false;
  try{
    const requests=await fixture(page,async r=>{
      if(r.path==='admin/runtime'&&r.method==='PUT'){await post.promise;accepted=true;return{json:{runtime:{configured:true,agentImage:'agent:new',model:{provider:'test',id:'test',credentialAvailable:true}}}};}
      if(accepted&&r.path==='admin/status'){await health.promise;return{status:503,json:{code:'CORE_UNREACHABLE'}};}
    },'/runtime');
    await page.locator('[data-action="edit-runtime"]').first().click();await page.locator('#agentImage').fill('agent:new');await page.locator('#apiKey').fill('test-write-only-key');await page.locator('#runtime-form button[type="submit"]').click();
    await expect(page.locator('[data-action-status]')).toContainText('Saving');await page.locator('#agentImage').fill('agent:newer');post.resolve();
    await expect(page.locator('main')).toContainText('Runtime saved');await expect(page.locator('#agentImage')).toHaveValue('agent:newer');await expect(page.locator('#apiKey')).toHaveValue('');health.resolve();await expect(page.locator('main')).toContainText('readiness could not be confirmed');await expect(page.locator('#agentImage')).toHaveValue('agent:newer');expect(requests.filter(r=>r.method==='PUT').length).toBe(1);
  }finally{post.resolve();health.resolve();}
});

for(const pagePath of ['/runtime','/default-work'])test(`S01 ${pagePath} explicit configuration read reports checking time without overwriting a newer draft`,async({page})=>{
  const gate=deferred();let armed=false;
  try{
    const endpoint=pagePath==='/runtime'?'admin/runtime':'admin/default-work';
    const requests=await fixture(page,async r=>{if(armed&&r.path===endpoint)await gate.promise;},pagePath);
    // Exercise the real recovery entry, with malformed acknowledgement deliberately requiring readback.
    if(pagePath==='/runtime'){
      await page.locator('[data-action="edit-runtime"]').first().click();await page.locator('#apiKey').fill('test-key');
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
