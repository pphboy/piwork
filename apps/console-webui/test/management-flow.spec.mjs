import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let server, base;
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const name = req.url.startsWith('/browser/') ? '../dist/browser/' + req.url.slice(9) : '../dist/public/' + (req.url.endsWith('/piwork-logo.png') ? 'piwork-logo.png' : req.url === '/style.css' ? 'style.css' : 'index.html');
    try {
      let body = await readFile(new URL(name, import.meta.url));
      if (name.endsWith('index.html') && req.url.startsWith('/admin')) body = Buffer.from(body.toString().replace('<head>', '<head><meta name="piwork-mode" content="hosted">'));
      res.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.png') ? 'image/png' : 'text/html'); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
const evidenceRoot=fileURLToPath(new URL('../../../dist/server-ui-core-flow/management/',import.meta.url));
async function evidence(page,name,fullPage=true){if(process.env.PIWORK_UI_EVIDENCE==='1'){await mkdir(evidenceRoot,{recursive:true});await page.screenshot({path:evidenceRoot+name+'.png',fullPage});}}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const model = { id:'model-one', modelRef:'ref-one', name:'Saved model', model:'synthetic-model', api:'anthropic-messages', baseUrl:'https://fixture.invalid/anthropic', credentialAvailable:true, enabled:true, updatedAt:'2026-10-20T00:00:00Z' };
async function fixture(page, path = '/runtime', handler = () => undefined, state = {}) {
  const requests = [];
  const user = {id:'admin-one', account:'admin', role:'admin', enabled:true};
  const values = {
    session:{authenticated:true,csrfToken:'synthetic-csrf',user}, availability:{reachable:true,administratorInitialized:true},
    'admin/status':{ready:true,state:'READY',checks:{runtimeConfigured:true}}, health:{healthy:true},
    'admin/runtime':{configured:true,agentImage:'agent:fixture',modelRef:model.modelRef,model:{provider:model.api,id:model.model,credentialAvailable:true},updatedAt:model.updatedAt},
    'admin/runtime-defaults':{agentImage:'agent:fixture'}, 'admin/models':{models:[{...model},{...model,id:'model-two',modelRef:'ref-two',name:'Second model'}]},
    'admin/default-work':{baseImage:'agent:fixture',configuration:{skills:[],packages:[],agentsMd:'saved instructions'}},
    'admin/users':{users:[user]}, 'admin/skills':{skills:[]}, 'admin/packages':{packages:[]},
    'admin/operations/op-one':{operationId:'op-one',name:'synthetic-package',state:'running',packagePhase:'validating'},
    about:{build:{version:'fixture-version',commit:'synthetic',os:'linux',architecture:'amd64'}}, ...state,
  };
  await page.route('**/console/api/**', async route => {
    const request = {path:new URL(route.request().url()).pathname.replace('/console/api/',''),method:route.request().method(),body:route.request().postData()}; requests.push(request);
    const response = await handler(request, values) || {json: values[request.path] || {}};
    if(response.abort){await route.abort('failed');return;}
    await route.fulfill({status:response.status || 200,contentType:'application/json',body:JSON.stringify(response.json || {})});
  });
  await page.route('**/_web/api/onboarding', route => route.fulfill({contentType:'application/json',body:JSON.stringify({administrator:true,status:values['admin/status'],runtime:values['admin/runtime'],preparation:values.preparation || {ready:true,components:{agent:{state:'ready'}}}})}));
  await page.goto(base+path);
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('#page-read-status [aria-busy="true"]')).toHaveCount(0);
  return {requests,values};
}

for (const scenario of ['missing','preparing','failed','unknown','ready']) test(`S08 Overview ${scenario} has one contextual main action and one Quick setup entry`, async ({page}) => {
  const ready = scenario === 'ready';
  await fixture(page,'/admin',()=>undefined,{
    'admin/status':{ready,state:ready?'READY':scenario==='missing'?'RUNTIME_NOT_CONFIGURED':'RUNTIME_UNAVAILABLE',checks:{runtimeConfigured:scenario!=='missing'}},
    ...(scenario==='missing'?{'admin/runtime':{configured:false}}:{}),
    preparation:{ready,components:{agent:{state:scenario==='preparing'?'preparing':scenario==='failed'?'failed':scenario==='unknown'?'unknown':'ready'}}},
  });
  const lead=page.locator('[data-testid="overview-next-task"]');
  await expect(lead.locator('.btn.primary')).toHaveCount(1);
  await expect(lead).toContainText(scenario==='missing'?'Quick setup':scenario==='preparing'?'View preparation':scenario==='ready'?'Open workbench':'Review runtime');
  const progress=lead.locator('.setup-progress');
  if(ready)await expect(progress).toHaveCount(0);
  else{
    await expect(progress).toContainText(scenario==='missing'?'Save runtime':'Runtime saved');
    await expect(progress).toContainText('Confirm readiness');
    await expect(progress).not.toContainText('Readiness confirmed');
    if(scenario==='missing')await expect(progress).not.toContainText('Runtime saved');
  }
  const setup=page.locator('main a[href^="/admin/setup"]');await expect(setup).toHaveCount(1);
  const compact=await page.locator('.mobile-menu').isVisible();if(compact)await page.locator('.mobile-menu').click();
  await expect(page.getByRole('navigation',{name:'Main navigation'})).toContainText('User access');
  await expect(page.getByRole('navigation',{name:'Main navigation'})).toContainText('Work setup');
  if(compact)await page.locator('.mobile-menu').click();
  await expect(page.locator('.workbench-link')).toBeVisible();
  if(['missing','ready','preparing'].includes(scenario)){
    await evidence(page,'overview-'+scenario+'-'+page.viewportSize().width+'-synthetic');
    if(process.env.PIWORK_UI_EVIDENCE==='1'){await page.setViewportSize({width:1440,height:900});await evidence(page,'overview-'+scenario+'-1440-synthetic');}
  }
});

test('S08 Overview polling retains the wide account menu, focus and expanded semantics; navigation closes it',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await page.clock.install();
  const {values}=await fixture(page,'/admin');
  const trigger=page.locator('#account-trigger'), menu=page.locator('#account-dropdown');
  await trigger.focus();await trigger.press('ArrowDown');
  await expect(menu.getByRole('menuitem',{name:'About Piwork',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const signOut=menu.getByRole('menuitem',{name:'Sign out',exact:true});
  await expect(signOut).toBeFocused();
  await page.evaluate(()=>{window.retainedShell={trigger:document.querySelector('#account-trigger'),menu:document.querySelector('#account-dropdown'),focused:document.activeElement};});
  values['admin/status']={ready:false,state:'RUNTIME_UNAVAILABLE',checks:{runtimeConfigured:true}};
  values.preparation={ready:false,components:{agent:{state:'preparing'}}};
  await page.clock.fastForward(15001);
  await expect(page.locator('[data-testid="overview-next-task"]')).toContainText('Piwork is preparing');
  await expect(menu).toBeVisible();await expect(trigger).toHaveAttribute('aria-expanded','true');await expect(signOut).toBeFocused();
  expect(await page.evaluate(()=>window.retainedShell.trigger===document.querySelector('#account-trigger')&&window.retainedShell.menu===document.querySelector('#account-dropdown')&&window.retainedShell.focused===document.activeElement)).toBe(true);
  // A full-page screenshot can resize the viewport and legitimately close this menu.
  await evidence(page,'overview-account-menu-poll-1440-synthetic',false);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();await expect(trigger).toHaveAttribute('aria-expanded','false');await expect(trigger).toBeFocused();
  await trigger.press('ArrowDown');await menu.getByRole('menuitem',{name:'About Piwork',exact:true}).click();
  await expect(page).toHaveURL(base+'/admin/about');await expect(page.getByRole('heading',{name:'About Piwork',exact:true})).toBeVisible();
  await expect(menu).toBeHidden();await expect(trigger).toHaveAttribute('aria-expanded','false');
  expect(await page.evaluate(()=>!window.retainedShell.trigger.isConnected&&!window.retainedShell.menu.isConnected)).toBe(true);
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Overview',exact:true}).click();
  await expect(page).toHaveURL(base+'/admin');await expect(menu).toBeHidden();await expect(trigger).toHaveAttribute('aria-expanded','false');
});

test('S08 Overview polling retains narrow navigation, focus and expanded semantics; navigation closes it',async({page})=>{
  await page.setViewportSize({width:360,height:900});await page.clock.install();
  const {values}=await fixture(page,'/admin');
  const trigger=page.locator('.mobile-menu'), navigation=page.getByRole('navigation',{name:'Main navigation',includeHidden:true});
  await expect(navigation).toBeHidden();await trigger.click();await expect(navigation).toBeVisible();
  const userAccess=navigation.getByRole('link',{name:'User access',exact:true});
  await userAccess.focus();
  await page.evaluate(()=>{window.retainedShell={trigger:document.querySelector('.mobile-menu'),navigation:document.querySelector('.nav'),focused:document.activeElement};});
  values['admin/status']={ready:false,state:'RUNTIME_UNAVAILABLE',checks:{runtimeConfigured:true}};
  values.preparation={ready:false,components:{agent:{state:'preparing'}}};
  await page.clock.fastForward(15001);
  await expect(page.locator('[data-testid="overview-next-task"]')).toContainText('Piwork is preparing');
  await expect(navigation).toBeVisible();await expect(navigation).toHaveClass(/\bopen\b/);await expect(trigger).toHaveAttribute('aria-expanded','true');await expect(userAccess).toBeFocused();
  expect(await page.evaluate(()=>window.retainedShell.trigger===document.querySelector('.mobile-menu')&&window.retainedShell.navigation===document.querySelector('.nav')&&window.retainedShell.focused===document.activeElement)).toBe(true);
  await evidence(page,'overview-navigation-poll-360-synthetic',false);
  await userAccess.click();await expect(page).toHaveURL(base+'/admin/users');await expect(page.getByRole('heading',{name:'Give people access',exact:true})).toBeVisible();
  await expect(navigation).toBeHidden();await expect(navigation).not.toHaveClass(/\bopen\b/);await expect(trigger).toHaveAttribute('aria-expanded','false');
  expect(await page.evaluate(()=>!window.retainedShell.trigger.isConnected&&!window.retainedShell.navigation.isConnected)).toBe(true);
  await trigger.click();await navigation.getByRole('link',{name:'Overview',exact:true}).click();
  await expect(page).toHaveURL(base+'/admin');await expect(navigation).toBeHidden();await expect(trigger).toHaveAttribute('aria-expanded','false');
});

test('S08 an identity change closes account and narrow navigation surfaces on the same path',async({page})=>{
  await page.setViewportSize({width:360,height:900});await page.clock.install();
  const {values}=await fixture(page,'/admin');
  await page.locator('.mobile-menu').click();await page.locator('#account-trigger').click();
  await expect(page.locator('.nav')).toBeVisible();await expect(page.locator('#account-dropdown')).toBeVisible();
  await page.evaluate(()=>{window.retainedShell={menu:document.querySelector('#account-dropdown'),navigation:document.querySelector('.nav')};});
  values.session={authenticated:true,csrfToken:'synthetic-new-csrf',user:{id:'new-admin',account:'new-admin',role:'admin',enabled:true}};
  await page.clock.fastForward(15001);
  await expect(page.locator('#account-dropdown .dropdown-title')).toHaveText('new-admin');await expect(page).toHaveURL(base+'/admin');
  await expect(page.locator('#account-dropdown')).toBeHidden();await expect(page.locator('#account-trigger')).toHaveAttribute('aria-expanded','false');
  await expect(page.locator('.nav')).toBeHidden();await expect(page.locator('.mobile-menu')).toHaveAttribute('aria-expanded','false');
  expect(await page.evaluate(()=>!window.retainedShell.menu.isConnected&&!window.retainedShell.navigation.isConnected)).toBe(true);
});

test('S08 stale Ready cannot remain the primary workbench action; expanded diagnostics survive recovery',async({page})=>{
  let fail=false;await fixture(page,'/admin',r=>fail&&r.path==='admin/status'?{status:503,json:{code:'CORE_UNREACHABLE'}}:undefined);
  await expect(page.locator('[data-testid="overview-next-task"]')).toContainText('Open workbench');
  await page.locator('#core-checks').evaluate(el=>{el.open=true;window.retainedDiagnostics=el;});
  fail=true;await page.locator('[data-action="refresh-status"]').first().click();
  await expect(page.locator('[data-testid="overview-next-task"]')).toContainText('Recheck Core');
  await expect(page.locator('#core-checks')).toHaveAttribute('open','');
  expect(await page.evaluate(()=>window.retainedDiagnostics===document.querySelector('#core-checks'))).toBe(true);
  await expect(page.locator('#core-checks')).toContainText('Last known: Ready');
  await expect(page.locator('main a[href^="/admin/setup"]')).toHaveCount(1);
});

for(const width of [1440,360])test(`S09 Runtime is maintenance at ${width}px with read-only technical identities`,async({page})=>{
  await page.setViewportSize({width,height:900});await fixture(page);
  await expect(page.getByRole('heading',{name:'Runtime',exact:true})).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Make this Core ready');await expect(page.locator('main .task-rail ol')).toHaveCount(0);
  await expect(page.locator('main')).toContainText('Saved model');await expect(page.locator('main')).toContainText('anthropic-messages');
  await expect(page.locator('input[name="agentImage"],input[type="password"]')).toHaveCount(0);
  await evidence(page,'runtime-maintenance-'+width+'-synthetic');
  await page.getByRole('button',{name:'Edit runtime',exact:true}).click();await expect(page.locator('#modelRef')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('S09 same-page refresh retains Runtime select node, draft, open diagnostics and focus',async({page})=>{
  const gate=deferred();let delayed=false;
  try{
    const {requests}=await fixture(page,'/runtime',async r=>{if(delayed&&r.path==='admin/runtime')await gate.promise;});
    await page.getByRole('button',{name:'Edit runtime',exact:true}).click();await page.locator('#modelRef').selectOption('ref-two');
    await page.locator('details').last().evaluate(el=>{el.open=true;window.retainedDetails=el;});
    await page.locator('#modelRef').evaluate(el=>{el.focus();window.retainedSelect=el;});
    delayed=true;const before=requests.filter(r=>r.path==='admin/runtime').length;
    await page.locator('[data-action="refresh"]').evaluate(el=>el.click());
    await expect(page.locator('#page-read-status .pending-dots')).toHaveCount(1);await expect(page.locator('dialog')).toHaveCount(0);
    await page.locator('[data-action="refresh"]').evaluate(el=>el.click());
    await evidence(page,'runtime-refresh-retained-synthetic');
    expect(requests.filter(r=>r.path==='admin/runtime').length-before).toBe(1);
    gate.resolve();await expect(page.locator('#page-read-status .pending-dots')).toHaveCount(0);
    await expect(page.locator('#modelRef')).toHaveValue('ref-two');await expect(page.locator('#modelRef')).toBeFocused();
    expect(await page.evaluate(()=>window.retainedSelect===document.querySelector('#modelRef')&&window.retainedDetails.isConnected&&window.retainedDetails.open)).toBe(true);
  }finally{gate.resolve();}
});

test('S11 Default Work refresh retains text node, selection, draft, expanded details and scroll',async({page})=>{
  const gate=deferred();let delayed=false;
  try{
    await fixture(page,'/default-work',async r=>{if(delayed&&r.path==='admin/default-work')await gate.promise;});
    await page.getByRole('button',{name:'Edit instructions',exact:true}).click();await page.locator('#agentsMd').fill('unsaved instructions\n'.repeat(90));
    await page.locator('details').last().evaluate(el=>{el.open=true;window.retainedDetails=el;});
    await page.locator('#agentsMd').evaluate(el=>{el.focus();el.setSelectionRange(5,17);el.scrollTop=80;window.retainedText=el;});
    delayed=true;await page.locator('[data-action="refresh"]').evaluate(el=>el.click());await expect(page.locator('#page-read-status .pending-dots')).toHaveCount(1);
    gate.resolve();await expect(page.locator('#page-read-status .pending-dots')).toHaveCount(0);
    expect(await page.evaluate(()=>({same:window.retainedText===document.querySelector('#agentsMd'),start:window.retainedText.selectionStart,end:window.retainedText.selectionEnd,scroll:window.retainedText.scrollTop,open:window.retainedDetails.open}))).toEqual({same:true,start:5,end:17,scroll:80,open:true});
    await expect(page.locator('#agentsMd')).toBeFocused();await expect(page.locator('#dirty-label')).toContainText('fields changed');
  }finally{gate.resolve();}
});

test('S10 Read current data owns its pending state, deduplicates, and retains model input and secret draft',async({page})=>{
  const gate=deferred();let delayed=false;
  try{
    const {requests}=await fixture(page,'/models/model-one',async r=>{if(delayed&&r.path==='admin/models')await gate.promise;});
    await expect(page.locator('.setup-api-guidance')).toHaveCount(0);
    await page.locator('#model-id').fill('unsaved-model');await page.locator('#model-key').fill('synthetic-secret-only');
    await page.locator('#model-id').evaluate(el=>{el.focus();el.setSelectionRange(1,4);window.retainedInput=el;});
    delayed=true;const before=requests.filter(r=>r.path==='admin/models').length;
    await page.locator('[data-model-action="read"]').evaluate(el=>el.click());await expect(page.locator('[data-model-action="read"] .pending-dots')).toHaveCount(1);await expect(page.locator('[data-model-form] button[type="submit"] .pending-dots')).toHaveCount(0);
    await page.locator('[data-model-action="read"]').evaluate(el=>el.click());expect(requests.filter(r=>r.path==='admin/models').length-before).toBe(1);
    gate.resolve();await expect(page.locator('[data-model-action="read"] .pending-dots')).toHaveCount(0);await expect(page.locator('#model-id')).toHaveValue('unsaved-model');await expect(page.locator('#model-key')).toHaveValue('synthetic-secret-only');
    expect(await page.evaluate(()=>window.retainedInput===document.querySelector('#model-id')&&window.retainedInput.selectionStart===1&&window.retainedInput.selectionEnd===4)).toBe(true);
  }finally{gate.resolve();}
});

for(const action of ['enable','disable','delete','default'])test(`S10 ${action} attaches pending to its actual button, never Save model`,async({page})=>{
  const gate=deferred();let began=false;
  try{
    page.on('dialog',dialog=>dialog.accept());
    const {requests}=await fixture(page,'/models/model-one',async r=>{if(r.method!=='GET'){began=true;await gate.promise;return {json:{}};}},action==='enable'?{'admin/models':{models:[{...model,enabled:false}]}}:{});
    await page.locator(`[data-model-action="${action}"]`).click();await expect.poll(()=>began).toBe(true);
    await expect(page.locator(`[data-model-action="${action}"] .pending-dots`)).toHaveCount(1);await expect(page.locator('[data-model-form] button[type="submit"] .pending-dots')).toHaveCount(0);
    await page.locator(`[data-model-action="${action}"]`).evaluate(el=>el.click());expect(requests.filter(r=>r.method!=='GET')).toHaveLength(1);
    gate.resolve();await expect(page.locator('main .pending-dots')).toHaveCount(0);
  }finally{gate.resolve();}
});

test('S10 unknown model mutation stops animation and keeps writes locked until explicit readback',async({page})=>{
  page.on('dialog',dialog=>dialog.accept());await fixture(page,'/models/model-one',r=>r.method!=='GET'?{abort:true}:undefined);
  await page.locator('[data-model-action="disable"]').click();await expect(page.locator('#model-note')).toContainText('Read the current object');
  await expect(page.locator('main .pending-dots')).toHaveCount(0);await expect(page.locator('[data-model-action="disable"]')).toBeDisabled();
  await page.locator('[data-model-action="read"]').click();await expect(page.locator('[data-model-action="disable"]')).toBeEnabled();
});

test('S13 Operation observation stops its animation when interrupted without losing original ID',async({page})=>{
  let failed=false;await fixture(page,'/operations/op-one',r=>failed&&r.path==='admin/operations/op-one'?{status:503,json:{code:'CORE_UNREACHABLE'}}:undefined);
  await expect(page.locator('.operation-state .pending-dots')).toHaveCount(1);failed=true;await page.locator('[data-action="refresh-operation"]').click();
  await expect(page.locator('main')).toContainText('Observation paused');await expect(page.locator('.operation-state .pending-dots')).toHaveCount(0);await expect(page.locator('main')).toContainText('op-one');
});

test('S14 About refresh has one aggregate pending slot and retains confirmed version after read failure',async({page})=>{
  const gate=deferred();let delayed=false;
  try{
    await fixture(page,'/about',async r=>{if(delayed&&r.path==='about'){await gate.promise;return{status:503,json:{code:'CORE_UNREACHABLE'}};}});
    delayed=true;await page.locator('[data-action="refresh"]').click();await expect(page.locator('#page-read-status .pending-dots')).toHaveCount(1);await expect(page.locator('main')).toContainText('fixture-version');
    gate.resolve();await expect(page.locator('main .pending-dots')).toHaveCount(0);await expect(page.locator('main')).toContainText('fixture-version');await expect(page.locator('main')).toContainText('last confirmed content');
  }finally{gate.resolve();}
});

test('S10 a model save keeps newer edits dirty and preserves the current input node',async({page})=>{
  const gate=deferred();
  try{
    await fixture(page,'/models/model-one',async r=>{if(r.method==='PATCH'){await gate.promise;return{json:{...model,name:'Submitted name'}};}});
    await page.locator('#model-name').fill('Submitted name');await page.getByRole('button',{name:'Save model',exact:true}).click();await expect(page.getByRole('button',{name:'Saving model',exact:true})).toBeDisabled();
    await page.locator('#model-name').fill('Newer unsaved name');await page.locator('#model-name').evaluate(el=>{window.retainedModelName=el;});
    gate.resolve();await expect(page.getByRole('button',{name:'Save model',exact:true})).toBeEnabled();await expect(page.locator('#model-name')).toHaveValue('Newer unsaved name');expect(await page.evaluate(()=>window.retainedModelName===document.querySelector('#model-name'))).toBe(true);
    await page.getByRole('link',{name:'Configure runtime',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Discard unsaved changes');
  }finally{gate.resolve();}
});

for(const path of ['/runtime','/default-work'])for(const refreshFails of [false,true])test(`S09/S11 ${path} unknown write retains explicit readback after ${refreshFails?'failed':'successful'} Refresh`,async({page})=>{
  let refreshed=false;
  const endpoint=path==='/runtime'?'admin/runtime':'admin/default-work';
  const {requests}=await fixture(page,path,r=>r.path===endpoint&&r.method!=='GET'?{abort:true}:refreshed&&refreshFails&&r.path===endpoint?{status:503,json:{code:'CORE_UNREACHABLE'}}:undefined);
  if(path==='/runtime'){await page.getByRole('button',{name:'Edit runtime',exact:true}).click();await page.locator('#modelRef').selectOption('ref-two');await page.locator('#runtime-form button[type="submit"]').click();}
  else{await page.getByRole('button',{name:'Edit instructions',exact:true}).click();await page.locator('#agentsMd').fill('unknown submitted draft');await page.locator('[data-action="save-defaults"]').click();}
  await expect(page.locator('[data-action="readback"]')).toBeVisible();refreshed=true;await page.locator('[data-action="refresh"]').first().click();
  await expect(page.locator('#page-read-status .pending-dots')).toHaveCount(0);await expect(page.locator('[data-action="readback"]')).toBeVisible();
  await expect(page.locator(path==='/runtime'?'#runtime-form button[type="submit"]':'[data-action="save-defaults"]')).toBeDisabled();expect(requests.filter(r=>r.method!=='GET')).toHaveLength(1);
  refreshed=false;await page.locator('[data-action="readback"]').click();await expect(page.locator(path==='/runtime'?'#runtime-form button[type="submit"]':'[data-action="save-defaults"]')).toBeEnabled();
});

for(const [path,selector,endpoint] of [
  ['/default-work','[data-action="refresh"]','admin/default-work'],
  ['/runtime','[data-action="verify-runtime"]','admin/status'],
  ['/operations/op-one','[data-action="refresh-operation"]','admin/operations/op-one'],
  ['/models/model-one','[data-model-action="read"]','admin/models'],
])test(`S08/S10/S13 own-session 401 during ${path} read clears the independent Console`,async({page})=>{
  let expire=false;await fixture(page,path,r=>expire&&r.path===endpoint?{status:401,json:{code:'SESSION_EXPIRED'}}:undefined);
  if(path.startsWith('/models/'))await page.locator('#model-key').fill('synthetic-key-cleared-on-401');
  expire=true;await page.locator(selector).first().click();await expect(page).toHaveURL(base+'/login');await expect(page.getByRole('heading',{name:'Administrator sign in'})).toBeVisible();await expect(page.locator('#model-key')).toHaveCount(0);await expect(page.locator('main .pending-dots')).toHaveCount(0);
});

test('S10 a late 401 from an older model read cannot sign out a newly authenticated administrator',async({page})=>{
  await page.setViewportSize({width:1440,height:900});const gate=deferred();let delayed=false;
  try{
    const {values}=await fixture(page,'/models/model-one',async r=>{if(delayed&&r.path==='admin/models'){await gate.promise;return{status:401,json:{code:'SESSION_EXPIRED'}};}});
    delayed=true;await page.locator('[data-model-action="read"]').click();await expect(page.locator('[data-model-action="read"] .pending-dots')).toHaveCount(1);
    values.session={authenticated:true,csrfToken:'synthetic-new-csrf',user:{id:'new-admin',account:'new-admin',role:'admin',enabled:true}};
    await page.evaluate(async()=>{const {adapter}=await import('/browser/adapter.js');await adapter.initialize();});
    await page.getByRole('link',{name:'User access',exact:true}).click();await expect(page).toHaveURL(base+'/users');
    gate.resolve();await page.waitForTimeout(100);await expect(page).toHaveURL(base+'/users');
    expect(await page.evaluate(async()=>{const {adapter}=await import('/browser/adapter.js');return {session:adapter.session,id:adapter.currentUserId};})).toEqual({session:true,id:'new-admin'});
  }finally{gate.resolve();}
});

test('S10 explicit model Test explains a ten-second wait in the open dialog and retained summary',async({page})=>{
  await page.clock.install();const gate=deferred();let calls=0;
  try{
    await fixture(page,'/models/model-one',async r=>{if(r.path==='admin/model-tests'){calls++;await gate.promise;return{json:{success:false,api:model.api,model:model.model,testMessage:'Reply with OK.',category:'network',reason:'timeout',message:'The provider did not respond.',recovery:'Check the connection and test explicitly.',checkedAt:new Date().toISOString(),durationMs:10001}};}});
    await page.getByRole('button',{name:'Test',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Sending the test message');
    await page.clock.fastForward(10001);await expect(page.getByRole('dialog')).toContainText('Still waiting for the model reply');await expect(page.getByRole('dialog').locator('.pending-dots')).toHaveCount(1);
    await page.getByRole('button',{name:'Close',exact:true}).click();await expect(page.locator('#model-test-result')).toContainText('Still waiting for the model reply');
    await page.getByRole('button',{name:'View test result',exact:true}).click();gate.resolve();await expect(page.getByRole('dialog')).toContainText('The provider did not respond');await expect(page.getByRole('dialog').locator('.pending-dots')).toHaveCount(0);expect(calls).toBe(1);
  }finally{gate.resolve();}
});
