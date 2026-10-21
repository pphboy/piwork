import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';

if(process.env.PIWORK_TEST_BROWSER_BIN)test.use({launchOptions:{executablePath:process.env.PIWORK_TEST_BROWSER_BIN}});
let server,base;
const names=['docker','agent','packageHelper','defaultContext','fileHelper','snapshotHelper'];
const gate=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const savedModel=(ref='model-synthetic')=>({id:ref,modelRef:ref,name:'Saved model',model:'custom-model',api:'openai-responses',baseUrl:'https://models.example.invalid/v1',enabled:true,credentialAvailable:true});
const preparation=(state='ready')=>({ready:state==='ready',components:Object.fromEntries(names.map(name=>[name,{state}]))});
const shell=`<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><main class="setup-main" id="quick"></main><script type="module">
import {mountQuickSetup} from '/browser/quick-setup.js';
window.log={dirty:false,navigations:[],expired:0,step:'model'};window.active=true;
window.mount=()=>{window.setup?.dispose();window.setup=mountQuickSetup(document.querySelector('#quick'),{csrf:()=> 'synthetic-csrf',current:()=>window.active,expired:()=>window.log.expired++,navigate:href=>window.log.navigations.push(href),dirty:value=>window.log.dirty=value,step:value=>window.log.step=value,preparation:new URLSearchParams(location.search).has('prepare')});};window.mount();
</script></body></html>`;
test.beforeAll(async()=>{
 server=createServer(async(req,res)=>{
  if(req.url.startsWith('/browser/')){try{res.setHeader('Content-Type','application/javascript');res.end(await readFile(new URL('../dist/browser/'+req.url.slice(9),import.meta.url)));}catch{res.writeHead(404);res.end();}return;}
  if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end((await Promise.all(['../../ui-shared/tokens.css','../../ui-shared/controls.css','../public/style.css'].map(path=>readFile(new URL(path,import.meta.url),'utf8')))).join('\n'));return;}
  if(req.url==='/setup/piwork-logo.png'){res.setHeader('Content-Type','image/png');res.end(await readFile(new URL('../../ui-shared/assets/piwork-logo.png',import.meta.url)));return;}
  res.setHeader('Content-Type','text/html');res.end(req.url.startsWith('/setup')||req.url.startsWith('/login')?'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="setup-app"></div><script type="module" src="/browser/onboarding.js"></script></body></html>':shell);
 });await new Promise(done=>server.listen(0,'127.0.0.1',done));base=`http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async()=>{await new Promise(done=>server.close(done));});
async function fixture(page,{configured=false,models=[],ready=false,prepare=false,handle=()=>null}={}){
 const state={models:[...models],requests:[],snapshot:{administrator:true,defaultAgentImage:'agent:synthetic',runtime:configured?{configured:true,modelRef:models[0]?.modelRef||'model-synthetic',agentImage:'agent:synthetic',model:{credentialAvailable:true}}:{configured:false},status:{ready},preparation:preparation(ready?'ready':'preparing')}};
 await page.route('**/*/api/**',async route=>{
  const r={path:new URL(route.request().url()).pathname,method:route.request().method(),body:route.request().postDataJSON()};state.requests.push(r);
  const reply=await handle(r,state,route);if(reply==='handled')return;if(reply){await route.fulfill({status:reply.status||200,json:reply.json});return;}
  if(r.path==='/_web/api/onboarding'){await route.fulfill({json:state.snapshot});return;}
  if(r.path==='/console/api/admin/models'){
   if(r.method==='GET'){await route.fulfill({json:{models:state.models}});return;}
   const model={...savedModel('model-'+(state.models.length+1)),...r.body,name:r.body.name||r.body.model};delete model.credential;state.models.push(model);await route.fulfill({status:201,json:model});return;
  }
  if(r.path==='/console/api/admin/runtime'){
   state.snapshot.runtime={configured:true,modelRef:r.body.modelRef,agentImage:'agent:synthetic',model:{credentialAvailable:true}};
   await route.fulfill({json:{runtime:state.snapshot.runtime,status:state.snapshot.status}});return;
  }
  if(r.path==='/console/api/admin/model-tests'){await route.fulfill({json:{success:true,category:'success',api:r.body.api,model:r.body.model,testMessage:'Reply with OK.',replyText:'Synthetic OK',replyTruncated:false,checkedAt:'2026-10-20T00:00:00Z',durationMs:5}});return;}
  await route.fulfill({status:404,json:{code:'NOT_FOUND'}});
 });await page.goto(base+(prepare?'/?prepare':''));await expect(page.locator('#setup-title')).not.toHaveText('Reading Core configuration…');return state;
}
async function autoRead(page){const reply=page.waitForResponse(response=>new URL(response.url()).pathname==='/_web/api/onboarding');await page.clock.fastForward(5001);await (await reply).finished();}
const refresh=page=>page.getByRole('button',{name:'Read current state',exact:true}).click();
const nav=page=>page.evaluate(()=>window.log.navigations);
const writes=state=>state.requests.filter(r=>r.method!=='GET');
async function key(page){await page.getByLabel('API Key',{exact:true}).fill('synthetic-key');}
async function advanced(page){const details=page.locator('#model-advanced');if(!(await details.evaluate(el=>el.open)))await details.locator('summary').click();}

async function evidence(page,name){
 if(process.env.PIWORK_UI_EVIDENCE!=='1')return;
 const directory=new URL('../../../dist/server-ui-core-flow/onboarding/',import.meta.url);await mkdir(directory,{recursive:true});const size=page.viewportSize();
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:new URL(`${name}-${width}.png`,directory).pathname,fullPage:true});}
 if(size)await page.setViewportSize(size);
}

test('first empty draft is Key-only, uses exact defaults and compares dirty against its baseline',async({page})=>{
 const state=await fixture(page);await expect(page.getByRole('button',{name:'Read current state',exact:true})).toHaveCount(0);await expect(page.getByRole('link',{name:/Manage AI models|Review saved models/})).toHaveCount(0);await expect(page.locator('.setup-diagnostics')).toHaveCount(0);await evidence(page,'key-only-clean');await expect(page.locator('#model-id')).toHaveValue('deepseek-flash');await expect(page.locator('#model-api')).toHaveValue('anthropic-messages');await expect(page.locator('#model-base-url')).toHaveValue('https://api.deepseek.com/anthropic');await expect(page.locator('#model-id')).toBeHidden();expect(await page.evaluate(()=>window.log.dirty)).toBe(false);
 await key(page);expect(await page.evaluate(()=>window.log.dirty)).toBe(true);await page.getByLabel('API Key',{exact:true}).fill('');expect(await page.evaluate(()=>window.log.dirty)).toBe(false);
 await advanced(page);await page.getByLabel('Model ID',{exact:true}).fill('other');expect(await page.evaluate(()=>window.log.dirty)).toBe(true);await page.getByLabel('Model ID',{exact:true}).fill('deepseek-flash');expect(await page.evaluate(()=>window.log.dirty)).toBe(false);expect(writes(state)).toEqual([]);
});

test('Key-only save serializes defaults, never implicitly Tests and enters once after confirmed readiness',async({page})=>{
 const state=await fixture(page,{ready:true});await key(page);await page.getByRole('button',{name:'Save and continue',exact:true}).click();await expect.poll(()=>nav(page)).toEqual(['/']);
 const sent=writes(state);expect(sent.map(r=>r.path)).toEqual(['/console/api/admin/models','/console/api/admin/runtime']);expect(sent[0].body).toEqual({name:'',model:'deepseek-flash',api:'anthropic-messages',baseUrl:'https://api.deepseek.com/anthropic',credential:'synthetic-key'});expect(sent[1].body).toEqual({modelRef:'model-1'});
 await refresh(page);expect(await nav(page)).toEqual(['/']);await expect(page.locator('#workbench-exit')).toHaveAttribute('href','/');await expect(page.locator('#quick input[type=password]')).toHaveCount(0);expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('synthetic-key');
});

test('advanced errors expand and focus without a write, while reads preserve draft and focus',async({page})=>{
 await page.clock.install();
 const state=await fixture(page);await key(page);await advanced(page);await page.getByLabel('Base URL',{exact:true}).fill('not-a-url');await page.locator('#model-advanced summary').click();await page.getByRole('button',{name:'Save and continue',exact:true}).click();await expect(page.locator('#model-base-url')).toBeFocused();await expect(page.locator('#model-advanced')).toHaveAttribute('open','');expect(writes(state)).toEqual([]);
 await page.getByLabel('Base URL',{exact:true}).fill('https://custom.example.invalid/anthropic');await page.getByLabel('Model ID',{exact:true}).fill('custom');await page.locator('#model-id').evaluate(el=>{window.original=el;el.focus();el.setSelectionRange(1,3);});await autoRead(page);await expect(page.locator('#setup-status .pending-dots')).toHaveCount(0);expect(await page.locator('#model-id').evaluate(el=>[el===window.original,document.activeElement===el,el.selectionStart,el.selectionEnd])).toEqual([true,true,1,3]);await expect(page.locator('#model-key')).toHaveValue('synthetic-key');await expect(page.locator('#model-base-url')).toHaveValue('https://custom.example.invalid/anthropic');
});

test('existing choices keep their baseline and additional models never receive first-install defaults',async({page})=>{
 await page.clock.install();
 const models=[savedModel('first'),savedModel('second')];await fixture(page,{models,configured:true,ready:true});await expect(page.locator('#saved-model')).toHaveValue('first');expect(await page.evaluate(()=>window.log.dirty)).toBe(false);await page.locator('#saved-model').selectOption('second');expect(await page.evaluate(()=>window.log.dirty)).toBe(true);await autoRead(page);await expect(page.locator('#saved-model')).toHaveValue('second');await page.locator('#saved-model').selectOption('first');expect(await page.evaluate(()=>window.log.dirty)).toBe(false);
 await page.getByRole('button',{name:'Add model',exact:true}).click();await expect(page.locator('#model-id')).toHaveValue('');await expect(page.locator('#model-api')).toHaveValue('openai-responses');await expect(page.locator('#model-base-url')).toHaveValue('');await expect(page.locator('#model-advanced')).toHaveAttribute('open','');expect(await page.evaluate(()=>window.log.dirty)).toBe(false);
});

test('catalog failure is not an empty installation and read recovery does not overwrite an edited draft',async({page})=>{
 await page.clock.install();
 let fail=true;const state=await fixture(page,{handle:r=>r.path.endsWith('/admin/models')&&r.method==='GET'&&fail?{status:502,json:{message:'Synthetic catalog unavailable'}}:null});await expect(page.locator('#catalog-note')).toContainText('could not be loaded');await expect(page.locator('#model-id')).toHaveValue('');await expect(page.locator('[data-continue]')).toBeDisabled();await advanced(page);await page.locator('#model-id').fill('custom-after-error');await page.locator('#model-base-url').fill('https://custom.example.invalid');await key(page);await page.locator('#model-id').evaluate(el=>{window.catalogInput=el;window.catalogKey=document.querySelector('#model-key');el.focus();el.setSelectionRange(2,5);});fail=false;await autoRead(page);await expect(page.locator('#catalog-note')).toHaveText('');expect(await page.locator('#model-id').evaluate(el=>[el===window.catalogInput,document.querySelector('#model-key')===window.catalogKey,document.activeElement===el,el.selectionStart,el.selectionEnd])).toEqual([true,true,true,2,5]);await expect(page.locator('#model-id')).toHaveValue('custom-after-error');await expect(page.locator('#model-key')).toHaveValue('synthetic-key');expect(await page.evaluate(()=>window.log.dirty)).toBe(true);expect(writes(state)).toEqual([]);
});

for(const missing of names)test(`all six readiness checks remain mandatory: ${missing}`,async({page})=>{
 const state=await fixture(page,{models:[savedModel()],configured:true,ready:true,prepare:true});state.snapshot.preparation.components[missing]={state:'pending'};await refresh(page);await expect(page.locator('#workbench-exit')).toHaveAttribute('aria-disabled','true');await expect(page.locator('#preparation-answer .pending-dots')).toHaveCount(0);delete state.snapshot.preparation.components[missing];await refresh(page);await expect(page.locator('#workbench-exit')).toHaveAttribute('aria-disabled','true');expect(await nav(page)).toEqual([]);
});

test('preparation has one waiting indicator, folded details, visible failures and static unknown recovery',async({page})=>{
 const state=await fixture(page,{models:[savedModel()],configured:true,prepare:true});await evidence(page,'preparing');await expect(page.locator('#preparation-answer .pending-dots')).toHaveCount(1);await expect(page.locator('#preparation-components .pending-dots')).toHaveCount(0);expect(await page.locator('#preparation-details').evaluate(el=>el.open)).toBe(false);
 state.snapshot.preparation=preparation();state.snapshot.preparation.ready=false;state.snapshot.preparation.components.fileHelper={state:'retrying',code:'IMAGE_UNAVAILABLE',retryAfterSeconds:4};await refresh(page);await expect(page.locator('#preparation-answer')).toContainText('Retrying in 4 seconds');await expect(page.locator('#preparation-answer .pending-dots')).toHaveCount(1);
 state.snapshot.preparation.components.fileHelper={state:'failed',code:'IMAGE_INCOMPATIBLE'};await refresh(page);await expect(page.locator('#preparation-answer .pending-dots')).toHaveCount(0);await expect(page.locator('#preparation-failures')).toContainText('Docker API is incompatible');await page.getByRole('button',{name:'View Files details',exact:true}).click();await expect(page.locator('[data-component=fileHelper]')).toBeFocused();
 delete state.snapshot.preparation;await refresh(page);await expect(page.locator('#preparation-answer')).toContainText('No active preparation has been confirmed');await expect(page.locator('#preparation-answer .pending-dots')).toHaveCount(0);await expect(page.locator('#workbench-exit')).toBeDisabled();
});

test('initial Ready, configured management and remount never auto-enter',async({page})=>{
 const state=await fixture(page,{models:[savedModel()],configured:true,ready:true,prepare:true});await evidence(page,'ready-manual');await expect(page.locator('#workbench-exit')).toBeEnabled();expect(await nav(page)).toEqual([]);await page.evaluate(()=>window.mount());await expect(page.locator('#workbench-exit')).toBeEnabled();expect(await nav(page)).toEqual([]);expect(writes(state)).toEqual([]);
 await page.goto(base);await expect(page.locator('#saved-model')).toBeVisible();await page.getByRole('button',{name:'Save and continue',exact:true}).click();await expect(page.locator('#workbench-exit')).toBeEnabled();expect(await nav(page)).toEqual([]);expect(writes(state)).toEqual([]);
});

test('save-and-leave keeps its explicit destination even if preparation is already Ready',async({page})=>{
 await fixture(page,{ready:true});await key(page);await page.evaluate(()=>window.setup.requestLeave(()=>window.log.navigations.push('/admin/runtime')));await page.locator('#leave-dialog').getByRole('button',{name:'Save and continue',exact:true}).click();await expect.poll(()=>nav(page)).toEqual(['/admin/runtime']);await refresh(page);expect(await nav(page)).toEqual(['/admin/runtime']);
});

for(const invalidate of ['leave','new edit','identity','read error','configuration change'])test(`first-setup automatic entry is revoked by ${invalidate}`,async({page})=>{
 let fail=false;const state=await fixture(page,{handle:r=>r.path==='/_web/api/onboarding'&&fail?{status:502,json:{message:'Synthetic read failed'}}:null});await key(page);await page.getByRole('button',{name:'Save and continue',exact:true}).click();await expect(page.locator('#preparation-answer')).toContainText('Preparing');
 if(invalidate==='leave')await page.evaluate(()=>window.setup.requestLeave(()=>window.log.navigations.push('/admin/users')));
 if(invalidate==='new edit')await page.locator('#quick').dispatchEvent('input');
 if(invalidate==='identity'){state.snapshot.administrator=false;await refresh(page);await expect.poll(()=>page.evaluate(()=>window.log.expired)).toBe(1);}
 if(invalidate==='read error'){fail=true;await refresh(page);await expect(page.locator('#preparation-answer')).toContainText('updates will retry');await expect(page.locator('#preparation-answer .pending-dots')).toHaveCount(0);fail=false;}
 if(invalidate==='configuration change'){state.snapshot.runtime.agentImage='agent:changed';await refresh(page);state.snapshot.runtime.agentImage='agent:synthetic';}
 state.snapshot.status.ready=true;state.snapshot.preparation=preparation();if(invalidate!=='identity')await refresh(page);expect(await nav(page)).toEqual(invalidate==='leave'?['/admin/users']:[]);
});

test('a late read cannot navigate, clear secrets or unlock a newly mounted view',async({page})=>{
 const held=gate();let block=false,started=0;const state=await fixture(page,{ready:true,handle:async r=>{if(r.path==='/_web/api/onboarding'&&block){started++;await held.promise;return{json:structuredClone(state.snapshot)};}return null;}});await key(page);block=true;await page.getByRole('button',{name:'Save and continue',exact:true}).click();await expect.poll(()=>started).toBe(1);block=false;await page.evaluate(()=>window.mount());await expect(page.locator('#saved-model')).toBeVisible();await page.getByRole('button',{name:'Add model',exact:true}).click();await page.locator('#model-id').fill('new-draft');await key(page);held.resolve();await expect(page.locator('#model-key')).toHaveValue('synthetic-key');expect(await nav(page)).toEqual([]);
});

test('model success and Runtime failure retain the reference; only the binding is retried',async({page})=>{
 let fail=true;const state=await fixture(page,{handle:r=>r.path.endsWith('/admin/runtime')&&fail?{status:400,json:{code:'INVALID_REQUEST',message:'Synthetic binding rejected'}}:null});await key(page);await page.getByRole('button',{name:'Save and continue',exact:true}).click();await expect(page.locator('#setup-notice')).toContainText('Model saved. Runtime was not bound');await expect(page.locator('#saved-model')).toHaveValue('model-1');fail=false;await page.getByRole('button',{name:'Save and continue',exact:true}).click();await expect(page.locator('#preparation-answer')).toBeVisible();expect(writes(state).filter(r=>r.path.endsWith('/models'))).toHaveLength(1);expect(writes(state).filter(r=>r.path.endsWith('/runtime'))).toHaveLength(2);
});

test('unknown Runtime outcome reads back without replay or recovering automatic navigation',async({page})=>{
 await page.clock.install();
 let unknown=true;const state=await fixture(page,{ready:true,handle:(r,s)=>{if(r.path.endsWith('/admin/runtime')&&unknown){s.snapshot.runtime={configured:true,modelRef:r.body.modelRef,agentImage:'agent:synthetic',model:{credentialAvailable:true}};return{status:502,json:{code:'CORE_UNAVAILABLE'}};}return null;}});await key(page);await page.getByRole('button',{name:'Save and continue',exact:true}).click();await expect(page.locator('#setup-notice')).toContainText('Runtime save is unconfirmed');unknown=false;await autoRead(page);await expect(page.locator('#workbench-exit')).toBeEnabled();expect(await nav(page)).toEqual([]);expect(writes(state)).toHaveLength(2);
});

test('Test has its own pending and stale result; explicit failure still permits save',async({page})=>{
 const held=gate();const state=await fixture(page,{handle:async r=>{if(r.path.endsWith('/model-tests')){await held.promise;return{json:{success:false,category:'authentication',testMessage:'Reply with OK.',reason:'provider-authentication',message:'Synthetic Key rejected.',recovery:'Check the Key.',checkedAt:'2026-10-20T00:00:00Z',durationMs:1}};}return null;}});await key(page);await page.getByRole('button',{name:'Test',exact:true}).click();await expect(page.locator('#test-dialog .pending-dots')).toHaveCount(1);await expect(page.getByRole('button',{name:'Test',exact:true})).toBeDisabled();await page.locator('#test-dialog').getByRole('button',{name:'Close',exact:true}).click();await advanced(page);await page.locator('#model-id').fill('edited');held.resolve();await expect(page.locator('#model-test-result')).toContainText('Previous configuration');await expect(page.locator('#model-test-result .pending-dots')).toHaveCount(0);await page.getByRole('button',{name:'Save and continue',exact:true}).click();await expect(page.locator('#preparation-answer')).toBeVisible();expect(writes(state).map(r=>r.path)).toEqual(['/console/api/admin/model-tests','/console/api/admin/models','/console/api/admin/runtime']);
});

const identityWrites=state=>state.requests.filter(request=>request.method!=='GET');
const expectPlainSession=state=>expect(state.requests.filter(request=>['setup/session','setup/redeem'].includes(request.path))).toEqual([]);
async function fillCredentials(page,{creating=true,account='admin',password='synthetic-password'}={}){
 await page.locator('#account').fill(account);await page.locator('#password').fill(password);
 if(creating)await page.locator('#confirm-password').fill(password);
}
async function restoreIdentityPage(page){
 await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
}
async function releaseIdentityResponse(page,held,path){
 const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/_web/api/'+path);held.resolve();await(await response).finished();await page.evaluate(()=>new Promise(done=>setTimeout(done,0)));
}
async function identityFixture(page,{initialized=false,authenticated=false,entry,waitForForm=true,handle=()=>null}={}){
 const state={initialized,authenticated,csrfToken:'synthetic-session-csrf',requests:[]};
 await page.route('**/_web/api/**',async route=>{
  const path=new URL(route.request().url()).pathname.split('/_web/api/')[1],request={path,method:route.request().method(),body:route.request().postDataJSON(),headers:route.request().headers()};state.requests.push(request);
  const special=await handle(request,state,route);if(special==='handled')return;if(special){await route.fulfill({status:special.status||200,json:special.json});return;}
  const values={state:{administratorInitialized:state.initialized},session:{authenticated:state.authenticated,csrfToken:state.csrfToken,...(state.authenticated?{user:{account:'ordinary',role:'user'}}:{})},onboarding:{status:{ready:false}}};
  if(path==='setup/administrator'){state.initialized=true;await route.fulfill({json:{next:'/login'}});return;}
  if(path==='login'){await route.fulfill({status:401,json:{code:'AUTHENTICATION_FAILED'}});return;}
  if(path in values){await route.fulfill({json:values[path]});return;}
  await route.fulfill({status:404,json:{code:'NOT_FOUND'}});
 });await page.goto(base+(entry||(initialized?'/login':'/setup')));if(waitForForm)await expect(page.locator('#credentials')).toBeVisible();return state;
}

test('plain-session creation keeps password validation, single submit and CSRF, then requires a manual sign-in',async({page})=>{
 const held=gate();const state=await identityFixture(page,{handle:async r=>{if(r.path==='setup/administrator')await held.promise;return null;}});await evidence(page,'create-admin');expect(new URL(page.url()).hash).toBe('');expect(state.requests.map(r=>r.path)).toEqual(['state','session']);await expect(page.locator('#confirm-password-error')).toBeHidden();await page.locator('#account').fill('admin');await page.locator('#password').fill('synthetic-password');await page.locator('#confirm-password').fill('different-password');await page.locator('#confirm-password').press('Enter');await expect(page.locator('#confirm-password')).toBeFocused();expect(state.requests.filter(r=>r.path==='setup/administrator')).toHaveLength(0);
 await page.locator('#confirm-password').fill('synthetic-password');await page.getByRole('button',{name:'Create administrator',exact:true}).click();await expect(page.locator('#credentials .pending-dots')).toHaveCount(1);await page.locator('#credentials').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(state.requests.filter(r=>r.path==='setup/administrator')).toHaveLength(1);held.resolve();await expect(page.getByRole('heading',{name:'Sign in to Piwork',exact:true})).toBeVisible();await expect(page.locator('#password')).toHaveValue('');await expect(page.locator('#confirm-password')).toHaveCount(0);expect(state.requests.filter(r=>r.path==='login')).toHaveLength(0);
 const create=state.requests.find(r=>r.path==='setup/administrator');expect(create.body).toEqual({account:'admin',password:'synthetic-password'});expect(create.headers['x-piwork-csrf']).toBe('synthetic-session-csrf');expect(create.headers['x-csrf-token']).toBe('synthetic-session-csrf');expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('synthetic-password');
 await page.locator('#account').fill('admin');await page.locator('#password').fill('synthetic-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.locator('#setup-notice')).toContainText('account or password is incorrect');expect(state.requests.filter(r=>r.path==='login')).toHaveLength(1);expect(state.requests.find(r=>r.path==='login').headers['x-piwork-csrf']).toBe('synthetic-session-csrf');await expect(page.locator('#password')).toHaveValue('');await expect(page.locator('#credentials .pending-dots')).toHaveCount(0);expectPlainSession(state);
});

test('plain-session first setup completes creation, manual sign-in, Key save, all six checks and once-only entry',async({page})=>{
 const state={initialized:false,authenticated:false,models:[],requests:[],snapshot:{administrator:true,defaultAgentImage:'agent:synthetic',runtime:{configured:false},status:{ready:false},preparation:preparation('preparing')}};
 await page.route('**/*/api/**',async route=>{
  const r={path:new URL(route.request().url()).pathname,method:route.request().method(),body:route.request().postDataJSON(),headers:route.request().headers()};state.requests.push(r);
  if(r.path==='/_web/api/state'){await route.fulfill({json:{administratorInitialized:state.initialized}});return;}
  if(r.path==='/_web/api/session'){await route.fulfill({json:{authenticated:state.authenticated,csrfToken:'synthetic-csrf',...(state.authenticated?{user:{account:'admin',role:'admin'}}:{})}});return;}
  if(r.path==='/_web/api/setup/administrator'){state.initialized=true;await route.fulfill({status:201,json:{next:'/login'}});return;}
  if(r.path==='/_web/api/login'){state.authenticated=true;await route.fulfill({json:{next:'/admin/setup'}});return;}
  if(r.path==='/_web/api/onboarding'){await route.fulfill({json:state.snapshot});return;}
  if(r.path==='/console/api/admin/models'){
   if(r.method==='GET'){await route.fulfill({json:{models:state.models}});return;}
   const model={...savedModel('model-first-setup'),...r.body,name:r.body.name||r.body.model};delete model.credential;state.models.push(model);await route.fulfill({status:201,json:model});return;
  }
  if(r.path==='/console/api/admin/runtime'){state.snapshot.runtime={configured:true,modelRef:r.body.modelRef,agentImage:'agent:synthetic',model:{credentialAvailable:true}};await route.fulfill({json:{runtime:state.snapshot.runtime,status:state.snapshot.status}});return;}
  await route.fulfill({status:404,json:{code:'NOT_FOUND'}});
 });
 await page.goto(base+'/setup');await expect(page.getByRole('heading',{name:'Create your administrator',exact:true})).toBeVisible();await fillCredentials(page);await page.getByRole('button',{name:'Create administrator',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign in to Piwork',exact:true})).toBeVisible();expect(new URL(page.url()).pathname).toBe('/login');await expect(page.locator('#password')).toHaveValue('');await expect(page.locator('#confirm-password')).toHaveCount(0);expect(writes(state).map(r=>r.path)).toEqual(['/_web/api/setup/administrator']);
 await fillCredentials(page,{creating:false});await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.locator('#setup-title')).toHaveText('Set up your Core runtime');expect(new URL(page.url()).pathname).toBe('/admin/setup');await expect(page.locator('#model-id')).toHaveValue('deepseek-flash');await expect(page.locator('#model-id')).toBeHidden();await key(page);await page.getByRole('button',{name:'Save and continue',exact:true}).click();await expect(page.locator('#preparation-answer')).toContainText('Preparing');await expect(page.locator('[data-action=refresh]')).toHaveAttribute('aria-busy','false');expect(await nav(page)).toEqual([]);
 state.snapshot.status.ready=true;
 for(const missing of names){state.snapshot.preparation=preparation();state.snapshot.preparation.components[missing]={state:'pending'};await refresh(page);await expect(page.locator('[data-action=refresh]')).toHaveAttribute('aria-busy','false');await expect(page.locator('#workbench-exit')).toBeDisabled();expect(await nav(page)).toEqual([]);}
 state.snapshot.preparation=preparation();await refresh(page);await expect.poll(()=>nav(page)).toEqual(['/']);await expect(page.locator('#workbench-exit')).toHaveAttribute('href','/');await refresh(page);await expect(page.locator('[data-action=refresh]')).toHaveAttribute('aria-busy','false');expect(await nav(page)).toEqual(['/']);
 const sent=writes(state);expect(sent.map(r=>[r.method,r.path])).toEqual([['POST','/_web/api/setup/administrator'],['POST','/_web/api/login'],['POST','/console/api/admin/models'],['PUT','/console/api/admin/runtime']]);expect(sent.slice(0,2).map(r=>r.body)).toEqual([{account:'admin',password:'synthetic-password'},{account:'admin',password:'synthetic-password'}]);expect(sent[2].body).toEqual({name:'',model:'deepseek-flash',api:'anthropic-messages',baseUrl:'https://api.deepseek.com/anthropic',credential:'synthetic-key'});expect(sent[3].body).toEqual({modelRef:'model-first-setup'});for(const r of sent){expect(r.headers['x-piwork-csrf']).toBe('synthetic-csrf');expect(r.headers['x-csrf-token']).toBe('synthetic-csrf');}expect(state.requests.filter(r=>/\/setup\/(session|redeem)$/.test(r.path))).toEqual([]);await expect(page.locator('#quick input[type=password]')).toHaveCount(0);expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toMatch(/synthetic-password|synthetic-key/);
});

for(const path of ['state','session'])test(`ordinary ${path} reads have one local pending, stop on failure and recover without setup authorization`,async({page})=>{
 await page.clock.install();const failed=gate(),recovery=gate();let failures=true;
 const state=await identityFixture(page,{entry:'/setup#setup=synthetic-obsolete-proof',waitForForm:false,handle:async r=>{
  if(r.path!==path)return null;if(failures){await failed.promise;return{status:502,json:{message:`Synthetic ${path} failure`}};}await recovery.promise;return null;
 }});
 await expect(page.locator('#setup-status .pending-dots')).toHaveCount(1);await expect(page.locator('#credentials')).toHaveCount(0);expect(new URL(page.url()).hash).toBe('');
 await page.clock.fastForward(10001);await expect(page.locator('#setup-status')).toContainText('Still waiting for the server');expect(state.requests.filter(r=>r.path===path)).toHaveLength(1);expect(identityWrites(state)).toEqual([]);
 failed.resolve();await expect(page.getByRole('heading',{name:'Could not read Core state'})).toBeVisible();await expect(page.locator('#setup-notice')).toContainText(`Synthetic ${path} failure`);await expect(page.locator('#setup-status .pending-dots')).toHaveCount(0);await expect(page.locator('#setup-status')).toHaveText('');
 failures=false;const retry=page.getByRole('button',{name:'Read current state',exact:true});await retry.click();await expect(retry).toBeDisabled();await expect(retry).toHaveAttribute('aria-busy','true');await expect(page.locator('#setup-status .pending-dots')).toHaveCount(1);await retry.evaluate(button=>button.click());await expect.poll(()=>state.requests.filter(r=>r.path===path).length).toBe(2);
 recovery.resolve();await expect(page.getByRole('heading',{name:'Create your administrator',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Create administrator',exact:true})).toBeEnabled();await expect(page.locator('#setup-status')).toHaveText('');await page.clock.fastForward(10001);await expect(page.locator('#setup-status')).toHaveText('');expect(identityWrites(state)).toEqual([]);expectPlainSession(state);await expect(page.getByRole('button',{name:'Check setup access',exact:true})).toHaveCount(0);await expect(page.locator('body')).not.toContainText('Open your setup link');expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('synthetic-obsolete-proof');
});

for(const outcome of ['uncommitted network failure','committed server error','concurrent 409'])test(`${outcome} reads administrator state once, clears passwords and never replays creation or signs in`,async({page})=>{
 const readback=gate();let recovering=false,fail=true;
 const state=await identityFixture(page,{handle:async(r,s,route)=>{
  if(r.path==='setup/administrator'&&fail){recovering=true;s.initialized=outcome!=='uncommitted network failure';if(!s.initialized){await route.abort('failed');return'handled';}return{status:outcome==='concurrent 409'?409:502,json:{code:outcome==='concurrent 409'?'ADMINISTRATOR_ALREADY_INITIALIZED':'CORE_UNAVAILABLE'}};}
  if(r.path==='state'&&recovering)await readback.promise;return null;
 }});
 await fillCredentials(page);await page.getByRole('button',{name:'Create administrator',exact:true}).click();await expect.poll(()=>state.requests.filter(r=>r.path==='state').length).toBe(2);await expect(page.locator('#password')).toHaveValue('');await expect(page.locator('#confirm-password')).toHaveValue('');await expect(page.locator('#credentials .pending-dots')).toHaveCount(0);await expect(page.locator('#setup-status .pending-dots')).toHaveCount(1);await expect(page.getByRole('button',{name:'Create administrator',exact:true})).toBeDisabled();
 await page.locator('#credentials').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(identityWrites(state).map(r=>r.path)).toEqual(['setup/administrator']);readback.resolve();
 await expect(page.getByRole('heading',{name:state.initialized?'Sign in to Piwork':'Create your administrator',exact:true})).toBeVisible();await expect(page.locator('#setup-notice')).toContainText(state.initialized?'Administrator setup is complete. Sign in to continue.':'Creation was not confirmed. Enter your password again');await expect(page.locator('#account')).toHaveValue('admin');await expect(page.locator('#password')).toHaveValue('');await expect(page.locator('#setup-status')).toHaveText('');await expect(page.locator('#credentials [type=submit]')).toBeEnabled();expect(state.requests.map(r=>r.path)).toEqual(['state','session','setup/administrator','state','session']);expect(identityWrites(state)).toHaveLength(1);expect(new URL(page.url()).pathname).toBe('/setup');
 if(!state.initialized){await expect(page.locator('#confirm-password')).toHaveValue('');fail=false;await fillCredentials(page);await page.getByRole('button',{name:'Create administrator',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign in to Piwork',exact:true})).toBeVisible();expect(identityWrites(state).map(r=>r.path)).toEqual(['setup/administrator','setup/administrator']);}
 expect(state.requests.filter(r=>r.path==='login')).toHaveLength(0);expectPlainSession(state);expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('synthetic-password');
});

test('failed administrator readback stops pending and only an explicit read recovers the manual sign-in',async({page})=>{
 let failReadback=true;const state=await identityFixture(page,{handle:(r,s)=>{
  if(r.path==='setup/administrator'){s.initialized=true;return{status:502,json:{code:'CORE_UNAVAILABLE'}};}
  if(r.path==='state'&&s.initialized&&failReadback)return{status:502,json:{message:'Synthetic readback unavailable'}};return null;
 }});
 await fillCredentials(page);await page.getByRole('button',{name:'Create administrator',exact:true}).click();await expect(page.getByRole('heading',{name:'Could not read Core state',exact:true})).toBeVisible();await expect(page.locator('#setup-notice')).toContainText('Synthetic readback unavailable');await expect(page.locator('.pending-dots')).toHaveCount(0);await expect(page.locator('input[type=password]')).toHaveCount(0);expect(identityWrites(state)).toHaveLength(1);
 failReadback=false;await page.getByRole('button',{name:'Read current state',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign in to Piwork',exact:true})).toBeVisible();await expect(page.locator('#password')).toHaveValue('');await expect(page.locator('#credentials [type=submit]')).toBeEnabled();expect(identityWrites(state).map(r=>r.path)).toEqual(['setup/administrator']);expectPlainSession(state);
});

for(const creating of [true,false])test(`${creating?'administrator creation':'sign-in'} rejection clears secrets and awaits ordinary session CSRF recovery before another submit`,async({page})=>{
 const refreshed=gate();let rejected=false;const path=creating?'setup/administrator':'login';
 const state=await identityFixture(page,{initialized:!creating,handle:async(r,s)=>{
  if(r.path===path){rejected=true;s.csrfToken='synthetic-refreshed-session-csrf';return{status:403,json:{code:'CSRF_INVALID'}};}
  if(r.path==='session'&&rejected)await refreshed.promise;return null;
 }});
 await fillCredentials(page,{creating});const submit=page.locator('#credentials [type=submit]');await submit.click();await expect(page.locator('#setup-notice')).toContainText('form session expired');await expect(page.locator('#password')).toHaveValue('');if(creating)await expect(page.locator('#confirm-password')).toHaveValue('');await expect(page.locator('#account')).toHaveValue('admin');await expect(submit).toBeDisabled();await expect(submit).toHaveAttribute('aria-busy','true');await expect(page.locator('#credentials .pending-dots')).toHaveCount(1);await expect(page.locator('#setup-status .pending-dots')).toHaveCount(0);await page.locator('#credentials').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(identityWrites(state)).toHaveLength(1);
 refreshed.resolve();await expect(submit).toBeEnabled();await expect(submit).toHaveAttribute('aria-busy','false');await expect(page.locator('#credentials .pending-dots')).toHaveCount(0);await fillCredentials(page,{creating});await submit.click();await expect.poll(()=>identityWrites(state).length).toBe(2);await expect(submit).toBeEnabled();await expect(page.locator('#password')).toHaveValue('');expect(identityWrites(state).map(r=>r.headers['x-piwork-csrf'])).toEqual(['synthetic-session-csrf','synthetic-refreshed-session-csrf']);expect(identityWrites(state).map(r=>r.headers['x-csrf-token'])).toEqual(['synthetic-session-csrf','synthetic-refreshed-session-csrf']);expect(state.requests.filter(r=>r.path==='state')).toHaveLength(1);expectPlainSession(state);
});

for(const path of ['state','session'])test(`a late ${path} response after pagehide cannot finish or replace the bfcache restoration read`,async({page})=>{
 const oldRead=gate(),newRead=gate();let reads=0;
 const state=await identityFixture(page,{waitForForm:false,handle:async r=>{
  if(r.path!==path)return null;reads++;if(reads===1){await oldRead.promise;return{json:path==='state'?{administratorInitialized:false}:{authenticated:true,csrfToken:'stale-session-csrf',user:{role:'admin'}}};}if(reads===2)await newRead.promise;return null;
 }});
 await expect.poll(()=>reads).toBe(1);state.initialized=true;await restoreIdentityPage(page);await expect.poll(()=>reads).toBe(2);await expect(page.locator('#setup-status .pending-dots')).toHaveCount(1);await releaseIdentityResponse(page,oldRead,path);await expect(page.locator('#setup-status .pending-dots')).toHaveCount(1);await expect(page.locator('#credentials')).toHaveCount(0);expect(new URL(page.url()).pathname).toBe('/setup');expect(identityWrites(state)).toEqual([]);
 newRead.resolve();await expect(page.getByRole('heading',{name:'Sign in to Piwork',exact:true})).toBeVisible();await expect(page.locator('#credentials [type=submit]')).toBeEnabled();await expect(page.locator('#setup-status')).toHaveText('');expect(state.requests.filter(r=>r.path==='state')).toHaveLength(2);expect(state.requests.filter(r=>r.path==='session')).toHaveLength(path==='state'?1:2);expectPlainSession(state);
});

for(const creating of [true,false])for(const staleSuccess of [true,false])test(`late ${creating?'creation':'sign-in'} ${staleSuccess?'success':'failure'} cannot clear or unlock a newer bfcache-restored submission`,async({page})=>{
 await page.clock.install();const oldWrite=gate(),newWrite=gate();const path=creating?'setup/administrator':'login';let writes=0;
 const state=await identityFixture(page,{initialized:!creating,handle:async r=>{
  if(r.path!==path)return null;writes++;if(writes===1){await oldWrite.promise;return staleSuccess?{json:{next:'/login?stale=1'}}:{status:401,json:{code:'AUTHENTICATION_FAILED'}};}await newWrite.promise;return{status:400,json:{message:'Synthetic current submission rejected'}};
 }});
 await fillCredentials(page,{creating});await page.locator('#credentials [type=submit]').click();await expect.poll(()=>writes).toBe(1);await page.clock.fastForward(10001);await expect(page.locator('#setup-status')).toContainText('Still waiting for the server');
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await expect(page.locator('#password')).toHaveValue('');if(creating)await expect(page.locator('#confirm-password')).toHaveValue('');await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await expect(page.locator('#credentials [type=submit]')).toBeEnabled();await expect(page.locator('#setup-status')).toHaveText('');
 await fillCredentials(page,{creating,account:'current-admin',password:'synthetic-current-password'});await page.locator('#credentials [type=submit]').click();await expect.poll(()=>writes).toBe(2);await expect(page.locator('#credentials .pending-dots')).toHaveCount(1);await expect(page.locator('#setup-status')).not.toContainText('Still waiting');await releaseIdentityResponse(page,oldWrite,path);
 await expect(page.locator('#credentials [type=submit]')).toBeDisabled();await expect(page.locator('#credentials [type=submit]')).toHaveAttribute('aria-busy','true');await expect(page.locator('#credentials .pending-dots')).toHaveCount(1);await expect(page.locator('#account')).toHaveValue('current-admin');await expect(page.locator('#password')).toHaveValue('synthetic-current-password');await expect(page.locator('#setup-notice')).toHaveText('');expect(new URL(page.url()).search).toBe('');expect(state.requests.filter(r=>r.path==='session')).toHaveLength(2);
 newWrite.resolve();await expect(page.locator('#setup-notice')).toContainText('Synthetic current submission rejected');await expect(page.locator('#credentials [type=submit]')).toBeEnabled();await expect(page.locator('#credentials .pending-dots')).toHaveCount(0);await expect(page.locator('#password')).toHaveValue('');if(creating)await expect(page.locator('#confirm-password')).toHaveValue('');await page.clock.fastForward(10001);await expect(page.locator('#setup-status')).toHaveText('');expect(identityWrites(state)).toHaveLength(2);expectPlainSession(state);expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toMatch(/synthetic-password|synthetic-current-password/);
});

for(const staleSuccess of [true,false])test(`late sign-out ${staleSuccess?'success':'failure'} cannot navigate or unlock a newer restored sign-out`,async({page})=>{
 const oldWrite=gate(),newWrite=gate();let writes=0;
 const state=await identityFixture(page,{initialized:true,authenticated:true,entry:'/setup',waitForForm:false,handle:async r=>{
  if(r.path!=='logout')return null;writes++;if(writes===1){await oldWrite.promise;return staleSuccess?{json:{}}:{status:502,json:{message:'Synthetic stale sign-out failure'}};}await newWrite.promise;return{status:502,json:{message:'Synthetic current sign-out failure'}};
 }});
 await expect(page.getByRole('heading',{name:'Core setup is pending',exact:true})).toBeVisible();const signout=page.getByRole('button',{name:'Sign out',exact:true});await signout.click();await expect.poll(()=>writes).toBe(1);await expect(page.locator('#setup-status .pending-dots')).toHaveCount(1);await restoreIdentityPage(page);await expect(signout).toBeEnabled();await expect(page.locator('#setup-status')).toHaveText('');await signout.click();await expect.poll(()=>writes).toBe(2);
 await releaseIdentityResponse(page,oldWrite,'logout');await expect(signout).toBeDisabled();await expect(page.locator('#setup-status .pending-dots')).toHaveCount(1);await expect(page.locator('#setup-notice')).toHaveText('');expect(new URL(page.url()).pathname).toBe('/setup');newWrite.resolve();await expect(page.locator('#setup-notice')).toContainText('Synthetic current sign-out failure');await expect(signout).toBeEnabled();await expect(page.locator('#setup-status .pending-dots')).toHaveCount(0);expect(identityWrites(state).map(r=>r.path)).toEqual(['logout','logout']);expectPlainSession(state);
});

test('an unknown model save only reads back the unique public identity and never replays or auto-enters',async({page})=>{
 await page.clock.install();
 let unknown=true;const state=await fixture(page,{ready:true,handle:(r,s)=>{if(r.path.endsWith('/admin/models')&&r.method==='POST'&&unknown){s.models.push({...savedModel('model-unknown'),...r.body,name:r.body.name||r.body.model});delete s.models[0].credential;return{status:502,json:{code:'CORE_UNAVAILABLE'}};}return null;}});await key(page);await page.getByRole('button',{name:'Save and continue',exact:true}).click();await expect(page.locator('#quick')).toContainText('model save result is unconfirmed');unknown=false;await autoRead(page);await expect(page.locator('#saved-model')).toHaveValue('model-unknown');expect(writes(state)).toHaveLength(1);expect(await nav(page)).toEqual([]);
});

test('the existing Messages SDK preserves the Anthropic prefix and appends one messages path',async()=>{
 const {stream}=await import('@earendil-works/pi-ai/api/anthropic-messages');const requests=[];
 const model={id:'deepseek-flash',name:'deepseek-flash',provider:'custom',api:'anthropic-messages',baseUrl:'https://api.deepseek.com/anthropic',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:64000,maxTokens:4096};
 const result=await stream(model,{messages:[{role:'user',content:'Synthetic path check.',timestamp:0}]},{apiKey:'synthetic-path-key',maxRetries:0,fetch:async url=>{requests.push(new URL(String(url)));return new Response(JSON.stringify({type:'error',error:{type:'authentication_error',message:'Synthetic response; no external request'}}),{status:401,headers:{'content-type':'application/json'}});}}).result();
 expect(result.stopReason).toBe('error');expect(requests).toHaveLength(1);expect(requests[0].origin).toBe('https://api.deepseek.com');expect(requests[0].pathname).toBe('/anthropic/v1/messages');
});


test('a slow save explains the outstanding confirmation without replay or a fabricated timeout',async({page})=>{
 await page.clock.install();const held=gate();const state=await fixture(page,{handle:async r=>{if(r.path.endsWith('/admin/models')&&r.method==='POST')await held.promise;return null;}});await key(page);const save=page.getByRole('button',{name:'Save and continue',exact:true});const before=await save.boundingBox();await save.click();await expect(save.locator('.pending-dots')).toHaveCount(1);expect((await save.boundingBox()).width).toBe(before.width);await page.clock.fastForward(10001);await expect(page.locator('#setup-status')).toContainText('Still waiting for the server to confirm this save');expect(writes(state)).toHaveLength(1);held.resolve();await expect(page.locator('#preparation-answer')).toBeVisible();await expect(page.locator('#setup-status')).toHaveText('');await page.clock.fastForward(10001);await expect(page.locator('#preparation-answer')).toContainText('Still waiting for the required components');expect(writes(state)).toHaveLength(2);
});


test('unknown model readback preserves the exceptional recovery link and disclosure without replay',async({page})=>{
 await page.clock.install();const state=await fixture(page,{handle:r=>r.method==='POST'&&r.path.endsWith('/admin/models')?{status:502,json:{message:'Synthetic unconfirmed write'}}:null});
 await key(page);await page.getByRole('button',{name:'Save and continue',exact:true}).click();
 const recovery=page.getByRole('link',{name:'Review saved models',exact:true});await expect(recovery).toBeVisible();await expect(page.locator('#setup-notice .feedback')).toHaveCount(1);await expect(page.getByRole('button',{name:'Test',exact:true})).toBeDisabled();await expect(page.locator('#model-key')).toHaveValue('');
 await advanced(page);await recovery.evaluate(el=>{window.recovery=el;window.advanced=document.querySelector('#model-advanced');el.focus();});
 for(let i=0;i<2;i++){await autoRead(page);await expect(page.locator('#setup-status')).toHaveText('');await expect(recovery).toBeFocused();expect(await recovery.evaluate(el=>el===window.recovery)).toBe(true);expect(await page.locator('#model-advanced').evaluate(el=>el===window.advanced&&el.open)).toBe(true);await expect(page.locator('[data-continue]')).toBeDisabled();}
 await page.locator('[data-model-action=test]').evaluate(el=>{el.disabled=false;el.click();});expect(writes(state)).toHaveLength(1);await evidence(page,'unknown-model-recovery');
 await recovery.click();expect(await nav(page)).toEqual([base+'/admin/models']);expect(writes(state)).toHaveLength(1);
});

test('multiple exact model matches require an explicit choice and remove the unknown recovery link',async({page})=>{
 await page.clock.install();const state=await fixture(page,{handle:(r,s)=>{if(r.method==='POST'&&r.path.endsWith('/admin/models')){for(const ref of ['candidate-a','candidate-b'])s.models.push({...savedModel(ref),...r.body,name:r.body.name||r.body.model,credential:undefined});return{status:502,json:{message:'Synthetic unknown write'}};}return null;}});
 await key(page);await page.locator('[data-continue]').click();await expect(page.getByRole('link',{name:'Review saved models',exact:true})).toBeVisible();await autoRead(page);await expect(page.locator('#saved-model')).toHaveValue('');await expect(page.locator('#setup-notice')).toContainText('More than one saved model matches');await expect(page.getByRole('link',{name:'Review saved models',exact:true})).toHaveCount(0);expect(writes(state)).toHaveLength(1);expect(await nav(page)).toEqual([]);
});

test('unknown Runtime keeps the original target lock until both model and release match',async({page})=>{
 await page.clock.install();const state=await fixture(page,{ready:true,handle:r=>r.method==='PUT'&&r.path.endsWith('/admin/runtime')?{status:502,json:{message:'Synthetic unknown binding'}}:null});await key(page);await page.locator('[data-continue]').click();await expect(page.locator('#setup-notice')).toContainText('Runtime save is unconfirmed');
 state.snapshot.runtime={configured:true,modelRef:'another-model',agentImage:'agent:synthetic',model:{credentialAvailable:true}};await autoRead(page);await expect(page.locator('[data-continue]')).toBeDisabled();await expect(page.getByRole('link',{name:'Review saved models',exact:true})).toBeVisible();
 state.snapshot.runtime.modelRef='model-1';state.snapshot.runtime.agentImage='agent:other';await autoRead(page);await expect(page.locator('[data-continue]')).toBeDisabled();expect(writes(state)).toHaveLength(2);expect(await nav(page)).toEqual([]);
 state.snapshot.runtime.agentImage='agent:synthetic';await autoRead(page);await expect(page.locator('#workbench-exit')).toBeEnabled();await expect(page.getByRole('link',{name:'Review saved models',exact:true})).toHaveCount(0);expect(writes(state)).toHaveLength(2);expect(await nav(page)).toEqual([]);
});

test('automatic model reads clear their transient error while preserving focused draft and no footer entries',async({page})=>{
 await page.clock.install();let fail=false;const state=await fixture(page,{handle:r=>r.path==='/_web/api/onboarding'&&fail?{status:502,json:{message:'Synthetic read unavailable'}}:null});await key(page);await page.locator('#model-key').evaluate(el=>{window.keyInput=el;el.focus();});fail=true;await autoRead(page);await expect(page.locator('#setup-notice')).toContainText('State could not be refreshed');await expect(page.getByRole('link',{name:'Review saved models',exact:true})).toHaveCount(0);fail=false;await autoRead(page);await expect(page.locator('#setup-notice')).toHaveText('');expect(await page.locator('#model-key').evaluate(el=>el===window.keyInput&&el===document.activeElement)).toBe(true);await expect(page.locator('#model-key')).toHaveValue('synthetic-key');await expect(page.locator('.setup-local-actions,.setup-diagnostics')).toHaveCount(0);expect(writes(state)).toEqual([]);
});

test('healthy automatic read preserves an unrelated definite save error without offering exceptional recovery',async({page})=>{
 await page.clock.install();const state=await fixture(page,{handle:r=>r.method==='POST'&&r.path.endsWith('/admin/models')?{status:400,json:{message:'Synthetic explicit rejection'}}:null});await key(page);await page.locator('[data-continue]').click();await expect(page.locator('#setup-notice')).toContainText('Synthetic explicit rejection');await autoRead(page);await expect(page.locator('#setup-notice')).toContainText('Synthetic explicit rejection');await expect(page.getByRole('link',{name:'Review saved models',exact:true})).toHaveCount(0);await expect(page.locator('[data-continue]')).toBeEnabled();expect(writes(state)).toHaveLength(1);
});

test('unknown write remains a single warning through a failed and recovered automatic read',async({page})=>{
 await page.clock.install();let fail=false;const state=await fixture(page,{handle:r=>r.method==='POST'&&r.path.endsWith('/admin/models')?{status:502,json:{message:'Synthetic unknown write'}}:r.path==='/_web/api/onboarding'&&fail?{status:502,json:{message:'Synthetic read unavailable'}}:null});await key(page);await page.locator('[data-continue]').click();await expect(page.locator('#setup-notice .feedback')).toHaveCount(1);fail=true;await autoRead(page);await expect(page.locator('#setup-notice .feedback')).toHaveCount(2);await expect(page.getByRole('link',{name:'Review saved models',exact:true})).toHaveCount(1);fail=false;await autoRead(page);await expect(page.locator('#setup-notice .feedback')).toHaveCount(1);await expect(page.locator('#setup-notice')).not.toContainText('State could not be refreshed');await expect(page.locator('[data-continue]')).toBeDisabled();expect(writes(state)).toHaveLength(1);expect(await nav(page)).toEqual([]);
});


test('a recovered new model does not advance using an unrelated already-configured Runtime',async({page})=>{
 await page.clock.install();const state=await fixture(page,{configured:true,ready:true,models:[savedModel('old-runtime-model')],handle:(r,s)=>{if(r.method==='POST'&&r.path.endsWith('/admin/models')){s.models.push({...savedModel('new-model'),...r.body,name:r.body.name||r.body.model,credential:undefined});return{status:502,json:{message:'Synthetic unknown write'}};}return null;}});
 await page.getByRole('button',{name:'Add model',exact:true}).click();await page.locator('#model-id').fill('new-target');await page.locator('#model-base-url').fill('https://new.example.invalid');await key(page);await page.locator('[data-continue]').click();await expect(page.getByRole('link',{name:'Review saved models',exact:true})).toBeVisible();await autoRead(page);await expect(page.locator('#saved-model')).toHaveValue('new-model');await expect(page.locator('#preparation-answer')).toHaveCount(0);await expect(page.locator('[data-continue]')).toBeEnabled();expect(state.snapshot.runtime.modelRef).toBe('old-runtime-model');expect(writes(state)).toHaveLength(1);expect(await nav(page)).toEqual([]);
});

test('a failed read and its recovery do not erase an earlier definite save rejection',async({page})=>{
 await page.clock.install();let fail=false;const state=await fixture(page,{handle:r=>r.method==='POST'&&r.path.endsWith('/admin/models')?{status:400,json:{message:'Synthetic explicit rejection'}}:r.path==='/_web/api/onboarding'&&fail?{status:502,json:{message:'Synthetic read unavailable'}}:null});await key(page);await page.locator('[data-continue]').click();await expect(page.locator('#setup-notice')).toContainText('Synthetic explicit rejection');fail=true;await autoRead(page);await expect(page.locator('#setup-notice')).toContainText('State could not be refreshed');await expect(page.locator('#setup-notice')).toContainText('Synthetic explicit rejection');fail=false;await autoRead(page);await expect(page.locator('#setup-notice')).not.toContainText('State could not be refreshed');await expect(page.locator('#setup-notice')).toContainText('Synthetic explicit rejection');await expect(page.getByRole('link',{name:'Review saved models',exact:true})).toHaveCount(0);expect(writes(state)).toHaveLength(1);
});


test('repeated failed recovery reads do not replace the focused exceptional recovery link',async({page})=>{
 await page.clock.install();let fail=false;const state=await fixture(page,{handle:r=>r.method==='POST'&&r.path.endsWith('/admin/models')?{status:502,json:{message:'Synthetic unknown write'}}:r.path==='/_web/api/onboarding'&&fail?{status:502,json:{message:'Synthetic same read failure'}}:null});await key(page);await page.locator('[data-continue]').click();await expect(page.getByRole('link',{name:'Review saved models',exact:true})).toBeVisible();fail=true;await autoRead(page);await expect(page.locator('#setup-notice .feedback')).toHaveCount(2);const link=page.getByRole('link',{name:'Review saved models',exact:true});await link.evaluate(el=>{window.recoveryLink=el;el.focus();});await autoRead(page);await expect(link).toBeFocused();expect(await link.evaluate(el=>el===window.recoveryLink)).toBe(true);await expect(page.locator('#setup-notice .feedback')).toHaveCount(2);await expect(page.locator('[data-continue]')).toBeDisabled();expect(writes(state)).toHaveLength(1);
});


test('initial configuration read failure retains its cause and original error-page retry',async({page})=>{
 let fail=true;const state=await fixture(page,{handle:r=>r.path==='/_web/api/onboarding'&&fail?{status:502,json:{message:'Synthetic first configuration read unavailable'}}:null});await expect(page.locator('#setup-title')).toHaveText('Could not read Core state');await expect(page.locator('#setup-notice')).toContainText('Synthetic first configuration read unavailable');await expect(page.getByRole('button',{name:'Read current state',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Review saved models',exact:true})).toHaveCount(0);fail=false;await refresh(page);await expect(page.locator('#model-form')).toBeVisible();await expect(page.locator('#setup-notice')).toHaveText('');await expect(page.getByRole('button',{name:'Read current state',exact:true})).toHaveCount(0);expect(writes(state)).toEqual([]);
});
