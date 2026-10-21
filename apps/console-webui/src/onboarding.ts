import {Field,Input,Feedback,icon} from './components.js';
import {modelErrors} from './model-form.js';
import {pendingDots} from './pending.js';
type Data=Record<string,any>;
type Stage='loading'|'administrator'|'login'|'waiting'|'error';
const root=document.querySelector<HTMLElement>('#setup-app')!;
if(location.hash)history.replaceState(null,'',location.pathname+location.search);
let csrf='',authenticated=false,stage:Stage='loading',account='',notice='',noticeError=false,view=0,identity=0,writing=false,reading=false,snapshot:Data={};
let readLock:symbol|null=null,waitTimer:ReturnType<typeof setTimeout>|undefined,waitSince=0,waitPhase='';
class RequestError extends Error {
  constructor(message:string,public status=0,public unknown=false,public field='',public code='') {super(message);}
}
async function request(path:string,method='GET',body?:unknown):Promise<Data> {
  let response:Response;
  try {
    response=await fetch(path,{method,credentials:'same-origin',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(method==='GET'?{}:{'X-Piwork-Csrf':csrf,'X-Csrf-Token':csrf})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  } catch {throw new RequestError(method==='GET'?'The server could not be reached. Retry this read.':'The result is not confirmed. Read current state before submitting again.',0,method!=='GET');}
  const value=await response.json().catch(()=>null);
  if(!value||typeof value!=='object')throw new RequestError('The response could not be confirmed. Read current state.',response.status,method!=='GET');
  if(!response.ok) {
    let message=value.code==='INVALID_REQUEST'&&modelErrors[value.field?.split('.')[0]]||String(value.message||value.code||'The request failed.');
    if(value.code==='AUTHENTICATION_FAILED')message='The account or password is incorrect, or the account is unavailable.';
    if(value.code==='CSRF_INVALID')message='The form session expired. Allow browser cookies, enter your password again and submit.';
    if(value.code==='RATE_LIMITED')message=`Too many sign-in attempts. Wait ${Math.max(1,Math.ceil(Number(value.retryAfterMs||60000)/1000))} seconds before retrying.`;
    if(value.code==='RELEASE_DEFAULTS_UNAVAILABLE')message='The server release is incomplete. Repair the server release, then read current state.';
    throw new RequestError(message,response.status,method!=='GET'&&response.status>=500&&value.code!=='RELEASE_DEFAULTS_UNAVAILABLE',String(value.field||''),String(value.code||''));
  }
  return value;
}
const web=(path:string,method='GET',body?:unknown)=>request('/_web/api/'+path,method,body);
const message=(error:unknown)=>error instanceof Error?error.message:'The request could not be confirmed.';
const button=(text:string,action:string,primary=false,disabled=false)=>`<button type="button" class="btn ${primary?'primary':'secondary'}" data-action="${action}" ${disabled?'disabled':''}>${text}</button>`;
function current(ticket:{view:number;identity:number}) {return ticket.view===view&&ticket.identity===identity;}
function context() {return {view,identity};}
function clearSecrets(){root.querySelectorAll<HTMLInputElement>('input[type=password]').forEach(input=>{input.value='';});}
function changeStage(next:Stage){if(next!==stage){clearSecrets();view++;stage=next;writing=false;}}
function credentialForm() {
  const creating=stage==='administrator';
  return `<form id="credentials" class="form-grid" novalidate>${Field('account','Account',Input('account',account,'autocomplete="username" required maxlength="128"'))}${Field('password','Password',Input('password','',`type="password" autocomplete="${creating?'new-password':'current-password'}" required`),creating?'Use at least 12 characters.':'Use your account password.')}${creating?Field('confirm-password','Confirm password',Input('confirm-password','','type="password" autocomplete="new-password" required'),'Enter the same password again.'):''}<div class="form-actions"><button class="btn primary" type="submit">${creating?'Create administrator':'Sign in'}<span class="pending-slot" data-credential-pending>${icon('arrow',16)}</span></button></div></form>`;
}
function render(){
 const title=stage==='administrator'?'Create your administrator':stage==='login'?'Sign in to Piwork':stage==='waiting'?(snapshot.status?.ready?'Your Core is ready':'Core setup is pending'):stage==='error'?'Could not read Core state':'Opening Piwork…';
 let content='';
 if(stage==='administrator'||stage==='login')content=credentialForm();
 if(stage==='waiting')content=`<p>${snapshot.status?.ready?'This Core is ready. Open the workbench to use your Work.':'An administrator needs to configure the model and runtime. Available workbench features remain accessible.'}</p><div class="form-actions"><a class="btn primary" href="/">Open workbench${icon('arrow',16)}</a>${button('Refresh state','refresh')}</div>`;
 if(stage==='error')content=`<p>Your saved configuration has not been changed. Retry when the server is reachable.</p>${button('Read current state','refresh',true)}`;
 root.innerHTML=`<header class="setup-topbar"><a href="/" class="setup-brand" aria-label="Piwork workbench"><img src="/setup/piwork-logo.png" width="32" height="32" alt=""><span>Piwork</span></a><span class="product-label">CoreSetup</span><nav aria-label="Piwork navigation">${authenticated?button('Sign out','logout'):'<a class="btn ghost small" href="/login">Sign in</a>'}</nav></header><main class="setup-main setup-narrow"><div class="setup-heading"><p class="eyebrow">${stage==='login'?'WELCOME TO PIWORK':'CORE SETUP'}</p><h1>${title}</h1></div><div id="setup-notice" aria-live="polite"></div><div id="setup-status" class="setup-status" aria-live="polite"></div>${content}</main>`;
 updateNotice();updateLocks();
}
function updateNotice(){const node=root.querySelector('#setup-notice');if(node)node.innerHTML=notice?Feedback(notice,noticeError?'warning':'success'):'';}
function tell(text:string,error=false){notice=text;noticeError=error;updateNotice();}
function updateLocks(){
 const phase=writing?'write':reading?'read':'';
 if(phase!==waitPhase){waitPhase=phase;waitSince=phase?Date.now():0;clearTimeout(waitTimer);if(phase)waitTimer=setTimeout(updateLocks,10000);}
 const slow=!!phase&&Date.now()-waitSince>=10000;
 root.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,button').forEach(node=>{node.disabled=writing||(node instanceof HTMLButtonElement&&reading);});
 root.querySelector('#credentials [type=submit]')?.setAttribute('aria-busy',String(writing));
 const pending=root.querySelector('[data-credential-pending]');if(pending)pending.innerHTML=writing?pendingDots():icon('arrow',16);
 root.querySelectorAll('[data-action="refresh"]').forEach(node=>node.setAttribute('aria-busy',String(reading)));
 const status=root.querySelector('#setup-status');if(status)status.innerHTML=writing?(stage==='login'?'Signing in. Waiting for server confirmation…':stage==='administrator'?'Creating your administrator. Waiting for server confirmation…':`${pendingDots()} Signing out. Waiting for server confirmation…`):reading?`${pendingDots()} Reading current state…`:'';
 if(status&&slow)status.innerHTML+='<span class="pending-wait-message"> Still waiting for the server. No result has been confirmed; do not submit again.</span>';
}

let confirmationTouched=false;
function fieldError(id:string,text:string) {
  const input=root.querySelector<HTMLInputElement>('#'+id),error=root.querySelector<HTMLElement>('#'+id+'-error');
  if(input){if(text){input.setAttribute('aria-invalid','true');input.setAttribute('aria-errormessage',id+'-error');}else{input.removeAttribute('aria-invalid');input.removeAttribute('aria-errormessage');}}
  if(error){error.textContent=text;error.hidden=!text;}
}
function validateCredentials(submitting=false) {
  const creating=stage==='administrator',password=root.querySelector<HTMLInputElement>('#password')?.value||'',confirmation=root.querySelector<HTMLInputElement>('#confirm-password')?.value||'';
  const errors:Record<string,string>={};
  if(submitting&&!root.querySelector<HTMLInputElement>('#account')?.value.trim())errors.account='Enter your account.';
  if(submitting||root.querySelector('#password')?.getAttribute('aria-invalid')==='true') {
    if(!password)errors.password='Enter a password.';
    else if(creating&&password.length<12)errors.password='Use at least 12 characters.';
  }
  if(creating&&(confirmationTouched||submitting))errors['confirm-password']=!confirmation?'Confirm your password.':confirmation!==password?'The passwords do not match.':'';
  if(submitting)confirmationTouched=true;
  for(const id of ['account','password','confirm-password'])fieldError(id,errors[id]||'');
  const first=Object.keys(errors).find(id=>!!errors[id]);if(submitting&&first)root.querySelector<HTMLElement>('#'+first)?.focus();
  return !first;
}
async function credentials(form:HTMLFormElement) {
  if(writing||reading||!validateCredentials(true))return;
  const creating=stage==='administrator',ticket=context(),data=new FormData(form);
  account=String(data.get('account')||'');let password=String(data.get('password')||'');writing=true;updateLocks();
  try {const value=await web(creating?'setup/administrator':'login','POST',{account,password});if(!current(ticket))return;clearSecrets();identity++;location.replace(nextLocation(value.next||'/'));}
  catch(error) {
    if(!current(ticket))return;clearSecrets();tell(message(error),true);
    if(creating&&error instanceof RequestError&&(error.unknown||error.status===409)) {
      // Read back uncertain/concurrent creation; never replay the write.
      writing=false;
      await load(true);
    } else {
      const session=await web('session').catch(()=>null);
      if(current(ticket)&&session)csrf=session.csrfToken||'';
    }
  } finally {password='';if(current(ticket)){writing=false;updateLocks();}}
}
async function load(recoveringCreation=false){
 if(reading||writing)return;reading=true;const lock=Symbol();readLock=lock;updateLocks();
 const ticket=context();try{
  const state=await web('state');if(!current(ticket))return;
  const session=await web('session');if(!current(ticket))return;csrf=session.csrfToken||'';authenticated=session.authenticated===true;
  if(!state.administratorInitialized){changeStage('administrator');if(recoveringCreation)tell('Creation was not confirmed. Enter your password again before trying to create the administrator.',true);render();return;}
  if(!session.authenticated){changeStage('login');if(recoveringCreation)tell('Administrator setup is complete. Sign in to continue.');render();return;}
  if(location.pathname==='/login'){location.replace(nextLocation(session.next||'/'));return;}
  if(session.user?.role==='admin'){location.replace('/admin/setup');return;}
  snapshot=await web('onboarding');if(!current(ticket))return;changeStage('waiting');render();
 }catch(error){if(current(ticket)){changeStage('error');tell(message(error),true);render();}}
 finally{if(readLock===lock){readLock=null;reading=false;updateLocks();}}
}
root.addEventListener('submit',event=>{event.preventDefault();void credentials(event.target as HTMLFormElement);});
root.addEventListener('input',()=>{account=root.querySelector<HTMLInputElement>('#account')?.value||'';validateCredentials();});
root.addEventListener('focusout',event=>{const input=event.target as HTMLInputElement;if(input.id==='confirm-password'){confirmationTouched=true;validateCredentials();}if(input.id==='password'&&stage==='administrator'&&input.value&&input.value.length<12)fieldError('password','Use at least 12 characters.');});
root.addEventListener('click',event=>{const action=(event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;if(!action||writing||reading)return;event.preventDefault();if(action==='refresh'){tell('');void load();}else if(action==='logout'){writing=true;identity++;const ticket=context();clearSecrets();updateLocks();void web('logout','POST',{}).then(()=>{if(!current(ticket))return;try{for(const key of Object.keys(sessionStorage))if(key.startsWith('piwork:web:'))sessionStorage.removeItem(key);}catch{}location.replace('/login');}).catch(error=>{if(!current(ticket))return;writing=false;tell(message(error),true);updateLocks();});}});
window.addEventListener('pagehide',()=>{identity++;view++;readLock=null;reading=false;writing=false;clearTimeout(waitTimer);waitPhase='';waitSince=0;clearSecrets();});
window.addEventListener('pageshow',event=>{if(event.persisted){identity++;view++;writing=false;clearSecrets();void load();}});
render();void load();

function nextLocation(fallback:string):string {
  const target = new URLSearchParams(location.search).get('returnTo');
  if (!target || !/^\/services\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+\/[1-9][0-9]{0,4}\//.test(target)) return fallback;
  const parsed = new URL(target, location.origin);
  return parsed.origin === location.origin && parsed.pathname.startsWith('/services/') ? parsed.pathname + parsed.search + parsed.hash : fallback;
}
