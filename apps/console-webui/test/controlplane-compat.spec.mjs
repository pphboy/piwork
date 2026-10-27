import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';

if(process.env.PIWORK_TEST_BROWSER_BIN)test.use({launchOptions:{executablePath:process.env.PIWORK_TEST_BROWSER_BIN}});
let server,base;
const gate=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const fallback='/admin/setup?from=synthetic#fallback';
const shell='<!doctype html><html><body><div id="setup-app"></div><script type="module" src="/browser/onboarding.js"></script></body></html>';
test.beforeAll(async()=>{
 server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.startsWith('/browser/')){
   try{res.setHeader('Content-Type','application/javascript');res.end(await readFile(new URL('../dist/browser/'+path.slice(9),import.meta.url)));}
   catch{res.writeHead(404);res.end();}return;
  }
  if(path==='/setup/piwork-logo.png'){res.setHeader('Content-Type','image/png');res.end(await readFile(new URL('../../ui-shared/assets/piwork-logo.png',import.meta.url)));return;}
  res.setHeader('Content-Type','text/html');res.end(['/login','/setup'].includes(path)?shell:'<!doctype html><title>Synthetic destination</title><p id="destination">Synthetic destination</p>');
 });await new Promise(done=>server.listen(0,'127.0.0.1',done));base=`http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async()=>{await new Promise(done=>server.close(done));});

async function fixture(page,{authenticated=false,entry='/login',handle=()=>null}={}){
 const state={authenticated,requests:[],blocked:[]};
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==base){state.blocked.push(url.href);await route.abort();return;}
  if(!url.pathname.startsWith('/_web/api/')){await route.continue();return;}
  const request={path:url.pathname.slice('/_web/api/'.length),method:route.request().method(),body:route.request().postDataJSON()};state.requests.push(request);
  const special=await handle(request,state);if(special){await route.fulfill({status:special.status||200,json:special.json});return;}
  const values={state:{administratorInitialized:true},session:{authenticated:state.authenticated,csrfToken:'synthetic-csrf',next:fallback,...(state.authenticated?{user:{account:'synthetic-user',role:'user'}}:{})},onboarding:{status:{ready:false}}};
  if(request.path==='login'){state.authenticated=true;await route.fulfill({json:{next:fallback}});return;}
  if(request.path==='logout'){state.authenticated=false;await route.fulfill({json:{}});return;}
  if(request.path in values){await route.fulfill({json:values[request.path]});return;}
  await route.fulfill({status:404,json:{code:'NOT_FOUND'}});
 });await page.goto(base+entry);return state;
}
async function signIn(page){await page.locator('#account').fill('synthetic-user');await page.locator('#password').fill('synthetic-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();}
const storage=page=>page.evaluate(()=>({session:{...sessionStorage},local:{...localStorage}}));
async function seed(page){await page.evaluate(()=>{sessionStorage.setItem('piwork:web:first','synthetic-first');sessionStorage.setItem('piwork:web:second','synthetic-second');sessionStorage.setItem('piwork:web','keep-similar');sessionStorage.setItem('other:session','keep-other');localStorage.setItem('piwork:web:local','keep-local');});}
async function waiting(page,options={}){const state=await fixture(page,{authenticated:true,entry:'/setup',...options});await expect(page.getByRole('heading',{name:'Core setup is pending',exact:true})).toBeVisible();return state;}
const signOut=page=>page.getByRole('button',{name:'Sign out',exact:true});

for(const authenticated of [false,true]){
 const mode=authenticated?'authenticated login visit':'successful sign-in';
 test(`${mode} preserves a Service returnTo including query and hash`,async({page})=>{
  const target='/services/work-synthetic/service-synthetic/8080/app?view=two%20words&mode=preview#section-2';
  const state=await fixture(page,{authenticated,entry:'/login?returnTo='+encodeURIComponent(target)});
  if(!authenticated)await signIn(page);
  await expect(page).toHaveURL(base+target);await expect(page.locator('#destination')).toBeVisible();
  expect(state.requests.filter(r=>r.path==='login')).toHaveLength(authenticated?0:1);expect(state.blocked).toEqual([]);
 });
 for(const [name,target] of [
  ['external','https://example.invalid/services/work/service/8080/'],
  ['protocol-relative','//example.invalid/services/work/service/8080/'],
  ['non-Service','/admin/users?tab=all#users'],
  ['normalized outside Service','/services/work/service/8080/../../../../admin/users'],
  ['encoded normalized outside Service','/services/work/service/8080/%2e%2e/%2e%2e/%2e%2e/%2e%2e/admin/users'],
 ])test(`${mode} rejects ${name} returnTo and preserves the server fallback`,async({page})=>{
  const state=await fixture(page,{authenticated,entry:'/login?returnTo='+encodeURIComponent(target)});
  if(!authenticated)await signIn(page);
  await expect(page).toHaveURL(base+fallback);await expect(page.locator('#destination')).toBeVisible();expect(state.blocked).toEqual([]);
 });
}

test('successful logout clears only piwork:web: sessionStorage keys',async({page})=>{
 const state=await waiting(page);await seed(page);await signOut(page).click();await expect(page).toHaveURL(base+'/login');await expect(page.locator('#credentials')).toBeVisible();
 expect(await storage(page)).toEqual({session:{'piwork:web':'keep-similar','other:session':'keep-other'},local:{'piwork:web:local':'keep-local'}});
 expect(state.requests.filter(r=>r.method!=='GET')).toEqual([{path:'logout',method:'POST',body:{}}]);
});

test('failed logout preserves sessionStorage and stays on the current view',async({page})=>{
 await waiting(page,{handle:r=>r.path==='logout'?{status:502,json:{message:'Synthetic sign-out failure'}}:null});await seed(page);const before=await storage(page);
 await signOut(page).click();await expect(page.locator('#setup-notice')).toContainText('The request failed. Check the current state before continuing.');await expect(page.locator('#setup-notice')).not.toContainText('Synthetic sign-out failure');await expect(signOut(page)).toBeEnabled();
 expect(await storage(page)).toEqual(before);await expect(page).toHaveURL(base+'/setup');
});

test('late logout success after pagehide/pageshow cannot clear newer storage or navigate',async({page})=>{
 const oldWrite=gate(),newWrite=gate();let writes=0;
 const state=await waiting(page,{handle:async r=>{if(r.path!=='logout')return null;writes++;if(writes===1){await oldWrite.promise;return{json:{}};}await newWrite.promise;return{status:502,json:{message:'Synthetic current sign-out failure'}};}});
 await seed(page);await signOut(page).click();await expect.poll(()=>writes).toBe(1);
 await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
 await expect(signOut(page)).toBeEnabled();await page.evaluate(()=>{sessionStorage.setItem('piwork:web:first','newer-view');sessionStorage.setItem('piwork:web:new','newer-only');});const newer=await storage(page);
 await signOut(page).click();await expect.poll(()=>writes).toBe(2);
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/_web/api/logout');oldWrite.resolve();await(await response).finished();await page.evaluate(()=>new Promise(done=>setTimeout(done,0)));
 expect(await storage(page)).toEqual(newer);await expect(page).toHaveURL(base+'/setup');await expect(signOut(page)).toBeDisabled();await expect(page.locator('#setup-notice')).toHaveText('');
 newWrite.resolve();await expect(page.locator('#setup-notice')).toContainText('The request failed. Check the current state before continuing.');await expect(page.locator('#setup-notice')).not.toContainText('Synthetic current sign-out failure');await expect(signOut(page)).toBeEnabled();expect(await storage(page)).toEqual(newer);await expect(page).toHaveURL(base+'/setup');
 expect(state.requests.filter(r=>r.method!=='GET').map(r=>r.path)).toEqual(['logout','logout']);
});
