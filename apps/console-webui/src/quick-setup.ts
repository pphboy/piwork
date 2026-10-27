import {esc,Field,Feedback,StatusLabel,icon} from './components.js';
import {pendingDots} from './pending.js';
import {blankModel,modelDraftIssue,modelErrors,modelFields,modelField,modelPlaceholder,modelProtocolHelp,readModelDraft,validateModelControl,modelTestSummary,modelTestDetails,validModelTest,type ModelTestRecord} from './model-form.js';
import {t,currentLocale,onLocaleChange,LocalizedMessage,type Feedback as FeedbackText} from './locale.js';

type Data = Record<string,any>;
type Stage = 'loading'|'model'|'preparation'|'error';
export interface QuickSetupOptions {
 csrf:()=>string;
 current:()=>boolean;
 expired:()=>void;
 navigate:(href:string)=>void;
 dirty:(value:boolean)=>void;
 step:(value:'model'|'preparation')=>void;
 preparation:boolean;
}
export interface QuickSetup {dispose:()=>void;requestLeave:(leave:()=>void)=>void;}
export function mountQuickSetup(root:HTMLElement,options:QuickSetupOptions):QuickSetup {
/** A message that joins independently localized pieces when it is displayed. */
class NoticeParts {
 constructor(readonly parts:(FeedbackText|NoticeParts)[]){}
 toString(){return this.parts.map(part=>String(part)).join(' ');}
}
/** Prefix and detail are localized at display time, not when the read failed. */
class RefreshFailure {
 constructor(readonly detail:FeedbackText){}
 toString(){return t('setup.stateRefreshFailed',{detail:noticeText(this.detail)});}
}
type Notice = FeedbackText | NoticeParts | RefreshFailure | null;
const noticeText=(value:Notice)=>value==null?'':String(value);
let stage:Stage='loading',notice:Notice='',noticeError=false,modelReadError:Notice='',disposed=false;
let noticeNode:Element|null=null,noticeMarkup='';
let snapshot:Data={},models:Data[]=[],catalogError:Notice='',selectedRef='',mode:'add'|'choose'='add';
let draft=blankModel(),revision=0,view=0,identity=0,reading=false,writing=false,testing=false;
let modelUnknown=false,runtimeUnknown=false,confirmedModel='',pendingRuntime:{modelRef:string;agentImage:string}|null=null;
let pendingModel:Data|null=null,beforeModels=new Set<string>();
let timer:ReturnType<typeof setTimeout>|undefined,readGeneration=0,readLock:symbol|null=null,polling=false;
let testResult:ModelTestRecord|null=null,leaveAction:(()=>void)|null=null,leaveGeneration=0;
let preparationReadError:Notice='',preparationReadAt='',advancedOpen=false,baselineReady=false;
let baselineDraft=blankModel(),baselineRef='',confirmedReadGeneration=-1;
let slowTimer:ReturnType<typeof setTimeout>|undefined,busySince=0,busyPhase='';
let preparationTimer:ReturnType<typeof setTimeout>|undefined,preparationSince=0;
let autoEnter:{view:number;identity:number;revision:number;leaveGeneration:number;minimumReadGeneration:number;modelRef:string;agentImage:string}|null=null;
const firstModel=()=>({...blankModel(),model:'deepseek-flash',api:'anthropic-messages' as const,baseUrl:'https://api.deepseek.com/anthropic'});
const preparationNames=['docker','agent','packageHelper','defaultContext','fileHelper','snapshotHelper'] as const;
const preparationKeys:Record<string,string>={docker:'docker',agent:'agent',packageHelper:'packages',defaultContext:'defaultContext',fileHelper:'files',snapshotHelper:'snapshots'};
const preparationLabel=(name:string)=>t('setup.component.'+(preparationKeys[name]||name));
class RequestError extends Error {
  readonly feedback:FeedbackText;
  constructor(message:FeedbackText,public status=0,public unknown=false,public field='',public code='') {
    super(noticeText(message));
    this.feedback=message;
    if(message!=null&&typeof message!=='string')Object.defineProperty(this,'message',{get:()=>String(message),configurable:true});
  }
}
async function request(path:string,method='GET',body?:unknown,setup=false):Promise<Data> {
  let response:Response;
  try {
    response=await fetch(path,{method,credentials:'same-origin',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(method==='GET'?{}:{'X-Piwork-Csrf':options.csrf(),'X-Csrf-Token':options.csrf()})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  } catch {throw new RequestError(new LocalizedMessage(method==='GET'?'net.offlineRead':'net.offlineWrite'),0,method!=='GET');}
  const value=await response.json().catch(()=>null);
  if(!value||typeof value!=='object')throw new RequestError(new LocalizedMessage('net.response'),response.status,method!=='GET');
  if(!response.ok) {
    let message:FeedbackText=value.code==='INVALID_REQUEST'?modelErrors[value.field?.split('.')[0]]:undefined;
    if(!message)message=new LocalizedMessage('net.requestFailed');
    if(value.code==='AUTHENTICATION_FAILED')message=new LocalizedMessage('net.auth');
    if(value.code==='RATE_LIMITED')message=new LocalizedMessage('net.rate',{seconds:Math.max(1,Math.ceil(Number(value.retryAfterMs||60000)/1000))});
    if(value.code==='RELEASE_DEFAULTS_UNAVAILABLE')message=new LocalizedMessage('net.release');
    throw new RequestError(message,response.status,method!=='GET'&&response.status>=500&&value.code!=='RELEASE_DEFAULTS_UNAVAILABLE',String(value.field||''),String(value.code||''));
  }
  return value;
}
const web=(path:string,method='GET',body?:unknown,setup=false)=>request('/_web/api/'+path,method,body,setup);
const admin=(path:string,method='GET',body?:unknown)=>request('/console/api/admin/'+path,method,body);
const message=(error:unknown):FeedbackText=>error instanceof RequestError?error.feedback:error instanceof Error?error.message:new LocalizedMessage('net.unconfirmed');
const button=(text:string,action:string,primary=false,disabled=false)=>`<button type="button" class="btn ${primary?'primary':'secondary'}" data-action="${action}" ${disabled?'disabled':''}>${text}</button>`;
function current(ticket:{view:number;identity:number}) {return !disposed&&options.current()&&ticket.view===view&&ticket.identity===identity;}
function context() {return {view,identity};}
function capture() {if(writing||modelUnknown||runtimeUnknown)return;const form=root.querySelector<HTMLFormElement>('#model-form');if(form)draft=readModelDraft(form);const advanced=root.querySelector<HTMLDetailsElement>('#model-advanced');if(advanced)advancedOpen=advanced.open;}
function dirty() {capture();return stage==='model'&&!modelUnknown&&!runtimeUnknown&&(mode==='add'?Object.keys(draft).some(key=>draft[key as keyof typeof draft]!==baselineDraft[key as keyof typeof baselineDraft]):selectedRef!==baselineRef);}
function clearSecrets() {draft.key='';root.querySelectorAll<HTMLInputElement>('input[type=password]').forEach(input=>{input.value='';});}
function changeStage(next:Stage) {
  if(next===stage)return;
  clearSecrets();view++;readGeneration++;readLock=null;reading=false;polling=false;clearTimeout(timer);writing=false;testing=false;stage=next;if(next==='model'||next==='preparation')options.step(next);
  if(next==='preparation')modelReadError='';
  root.querySelector<HTMLDialogElement>('#test-dialog')?.close();
}
function steps() {
 const at=stage==='preparation'?1:0;
 return `<ol class="setup-steps" aria-label="${esc(t('setup.step.progressAria'))}">${[t('setup.step.model'),t('setup.step.prepare')].map((label,index)=>`<li ${index===1?'data-preparation-step':''} ${at===index?'aria-current="step"':''} class="${index<at?'complete':index===at?'current':''}"><span class="step-marker">${index<at?icon('check',13):index+1}</span><span class="step-label">${label}</span></li>`).join('')}</ol>`;
}
function diagnostics() {
  return `<details class="disclosure setup-diagnostics"><summary>${t('setup.diagnostics.summary')}</summary><div class="disclosure-body"><dl class="summary-list"><dt>${t('setup.diagnostics.releaseImage')}</dt><dd><code data-runtime-agent-image>${esc(snapshot.defaultAgentImage||t('setup.diagnostics.unavailable'))}</code></dd>${snapshot.runtime?.configured?`<dt>${t('setup.diagnostics.savedImage')}</dt><dd><code>${esc(snapshot.runtime.agentImage)}</code></dd><dt>${t('setup.diagnostics.savedRef')}</dt><dd><code>${esc(snapshot.runtime.modelRef)}</code></dd>`:''}</dl><p class="help">${t('setup.diagnostics.help')}</p></div></details>`;
}
function modelOptions() {
  return `<option value="">${esc(t('setup.model.choosePlaceholder'))}</option>${models.map(model=>`<option value="${esc(model.modelRef)}" ${model.modelRef===selectedRef?'selected':''} ${!model.enabled||!model.credentialAvailable?'disabled':''}>${esc(model.name||model.model)}${!model.enabled?t('setup.model.disabledSuffix'):!model.credentialAvailable?t('setup.model.keyUnavailableSuffix'):''}</option>`).join('')}`;
}
function catalogNotice() {
  return catalogError?Feedback(noticeText(new NoticeParts([new LocalizedMessage('setup.model.catalogUnavailable'),noticeText(catalogError),new LocalizedMessage('setup.model.catalogRetry')])),'warning'):'';
}
function apiGuidance() {
  const link=`<a href="https://platform.deepseek.com" target="_blank" rel="noopener noreferrer" aria-label="${esc(t('setup.model.deepseekAria'))}">platform.deepseek.com${icon('external',14)}</a>`;
  return `<div class="setup-api-guidance"><p class="setup-api-guidance-title">${t('setup.model.recommend')}</p><p class="setup-api-guidance-help">${t('setup.model.getKey',{link})}</p></div>`;
}
function modelPage() {
  const unavailable=selectedRef&&!models.some(model=>model.modelRef===selectedRef&&model.enabled&&model.credentialAvailable);
  return `<p class="setup-description">${t('setup.model.description')}</p><div id="setup-docker" class="setup-dependency"></div><div id="catalog-note">${catalogNotice()}</div>${confirmedModel?Feedback(t('setup.model.savedContinue'),'success'):''}${models.length&&!modelUnknown?`<div class="setup-mode" aria-label="${esc(t('setup.model.configAria'))}"><button class="btn small" type="button" data-action="choose-model" aria-pressed="${mode==='choose'}">${t('setup.model.chooseSaved')}</button><button class="btn small" type="button" data-action="add-model" aria-pressed="${mode==='add'}">${icon('plus',14)} ${t('setup.model.add')}</button></div>`:''}${mode==='add'?`<form id="model-form" class="form-grid" data-setup-model novalidate>${apiGuidance()}${modelFields(draft,false,{open:advancedOpen})}<div class="form-actions"><button type="submit" class="btn primary" data-continue>${t('setup.model.saveContinue')}<span class="pending-slot">${icon('arrow',16)}</span></button><button type="button" class="btn secondary" data-model-action="test">${t('setup.model.test')}</button></div><p class="help">${t('setup.model.testHelp')}</p></form><div id="model-test-result">${modelTestSummary(testResult,revision)}</div>`:`<form id="choose-form" class="form-grid" novalidate>${Field('saved-model',t('setup.model.savedModel'),`<select id="saved-model" name="modelRef" required>${modelOptions()}</select>`,t('setup.model.savedModelHelp'))}${unavailable?Feedback(t('setup.model.unavailable'),'warning'):''}<div class="form-actions"><button type="submit" class="btn primary" data-continue>${t('setup.model.saveContinue')}<span class="pending-slot">${icon('arrow',16)}</span></button></div></form>`}<div id="release-note">${snapshot.releaseError?Feedback(t('setup.model.releaseIncomplete'),'warning'):''}</div>`;
}
function render() {
 const title=stage==='model'?t('setup.title.model'):stage==='preparation'?t('setup.title.preparation'):stage==='error'?t('setup.title.error'):t('setup.title.loading');
 let content='';
 if(stage==='model')content=modelPage();
 if(stage==='preparation')content=`<p class="setup-description">${t('setup.preparation.description')}</p><div id="preparation-answer" class="preparation-state" aria-live="polite" aria-atomic="true"></div><div id="preparation-failures"></div><details class="disclosure" id="preparation-details"><summary>${t('setup.preparation.details')}</summary><ul id="preparation-components" class="preparation-list" aria-label="${esc(t('setup.preparation.componentsAria'))}"></ul></details><div class="form-actions"><a class="btn secondary" id="workbench-exit" role="link" tabindex="0" aria-disabled="true" aria-describedby="preparation-exit-help">${t('setup.preparation.openWorkbench')}${icon('arrow',16)}</a>${button(icon('refresh',15)+' '+t('setup.preparation.readState'),'refresh')}</div><p id="preparation-exit-help" class="help"></p>${diagnostics()}`;
 if(stage==='error')content=`<p>${t('onboarding.error.body')}</p>${button(t('setup.preparation.readState'),'refresh',true)}`;
 root.innerHTML=`${steps()}<div class="setup-heading"><h2 id="setup-title">${title}</h2></div><div id="setup-notice" aria-live="polite"></div><div id="setup-status" class="setup-status" aria-live="polite"></div>${content}<dialog id="test-dialog" class="setup-dialog" aria-labelledby="test-title"><div class="dialog-heading"><div><h2 id="test-title">${t('setup.dialog.testTitle')}</h2><p>${t('setup.dialog.testDescription')}</p></div><button class="btn icon-button" type="button" data-action="close-test" aria-label="${esc(t('setup.dialog.closeTestAria'))}">${icon('close')}</button></div><div id="test-body" class="dialog-body"></div><div class="dialog-footer"><button class="btn secondary" type="button" data-action="close-test">${t('setup.dialog.close')}</button></div></dialog><dialog id="leave-dialog" class="setup-dialog" aria-labelledby="leave-title"><div class="dialog-heading"><h2 id="leave-title">${t('setup.dialog.leaveTitle')}</h2></div><div class="dialog-body"><p>${t('setup.dialog.leaveBody')}</p></div><div class="dialog-footer">${button(t('setup.dialog.keepEditing'),'keep-editing')}${button(t('setup.dialog.discard'),'discard-draft')}${button(t('setup.model.saveContinue'),'save-leave',true)}</div></dialog>`;
 updateNotice();updatePreparation();updateLocks();
}
function unknownNotice():FeedbackText {
  if(modelUnknown)return new LocalizedMessage('setup.unknown.model');
  if(runtimeUnknown)return new LocalizedMessage('setup.unknown.runtime');
  return '';
}
function updateNotice() {
  const node=root.querySelector('#setup-notice');if(!node)return;
  const unresolved=stage==='model'?unknownNotice():'';
  const unresolvedText=noticeText(unresolved);
  const recovery=unresolvedText?`<a href="/admin/models">${t('setup.unknown.review')}</a>`:'';
  const currentNotice=noticeText(notice);
  const markup=(modelReadError?Feedback(noticeText(modelReadError),'warning'):'')+(notice?Feedback(currentNotice,noticeError?'warning':'success',unresolvedText&&currentNotice.includes(unresolvedText)?recovery:''):'')+(unresolved&&!currentNotice.includes(unresolvedText)?Feedback(unresolvedText,'warning',recovery):'');
  // A repeated read must not replace the focused exceptional recovery link.
  if(node!==noticeNode||markup!==noticeMarkup){node.innerHTML=markup;noticeNode=node;noticeMarkup=markup;}
}
function tell(text:Notice,error=false) {notice=text;noticeError=error;updateNotice();}
function updateLocks() {
  if(disposed||!options.current())return;
  const phase=writing?'save':reading?'read':testing?'test':'';
  if(phase!==busyPhase){busyPhase=phase;busySince=phase?Date.now():0;clearTimeout(slowTimer);if(phase)slowTimer=setTimeout(()=>{updateLocks();if(testing)updateTest();},10000);}
  const slow=!!phase&&Date.now()-busySince>=10000;
  root.querySelectorAll<HTMLInputElement|HTMLSelectElement>('form input, form select').forEach(input=>{input.disabled=writing||modelUnknown||runtimeUnknown;});
  root.querySelectorAll<HTMLButtonElement>('button').forEach(node=>{
    if(node.closest('dialog'))return;
    node.disabled=writing||(reading&&node.dataset.action!=='refresh')||((modelUnknown||runtimeUnknown)&&['choose-model','add-model'].includes(node.dataset.action||''))||(node.hasAttribute('data-continue')&&(modelUnknown||runtimeUnknown||!!catalogError))||(node.dataset.modelAction==='test'&&(testing||modelUnknown||runtimeUnknown));
    if(node.dataset.action==='refresh'){node.setAttribute('aria-disabled',String(writing||reading||polling));node.setAttribute('aria-busy',String(reading||polling));}
  });
  root.querySelectorAll<HTMLButtonElement>('[data-continue],#credentials [type=submit]').forEach(node=>{node.setAttribute('aria-busy',String(writing));});
  options.dirty(dirty());
  const status=root.querySelector('#setup-status');if(status)status.innerHTML=writing?(slow?t('setup.status.slowSave'):t('setup.status.saving')):reading?`${stage==='preparation'&&preparationPresentation().busy?'':pendingDots()} ${slow?t('setup.status.slowRead'):t('setup.status.reading')}`:'';
  root.querySelectorAll<HTMLButtonElement>('[data-continue]').forEach(node=>{const markup=`${t('setup.model.saveContinue')}<span class="pending-slot">${writing?pendingDots():icon('arrow',16)}</span>`;if(node.innerHTML!==markup)node.innerHTML=markup;});
  root.querySelectorAll<HTMLButtonElement>('[data-action="refresh"]').forEach(node=>node.setAttribute('aria-busy',String(reading)));
  const testButton=root.querySelector<HTMLButtonElement>('[data-model-action="test"]');if(testButton)testButton.setAttribute('aria-busy',String(testing));
}
function acceptSnapshot(value:Data,generation:number) {
  snapshot=value;confirmedReadGeneration=generation;
  if(modelReadError){modelReadError='';updateNotice();}
  if(autoEnter&&(!value.administrator||value.runtime?.modelRef!==autoEnter.modelRef||value.runtime?.agentImage!==autoEnter.agentImage))autoEnter=null;
  preparationReadError='';
  preparationReadAt=new Date().toLocaleTimeString(currentLocale()==='zh-CN'?'zh-CN':'en-US');
}
function preparationReady() {
  return !preparationReadError&&snapshot.status?.ready===true&&snapshot.preparation?.ready===true&&
    preparationNames.every(name=>snapshot.preparation.components?.[name]?.state==='ready');
}
function preparationRecovery(value:Data) {
  switch(value.code) {
    case 'DOCKER_UNAVAILABLE':return t('setup.recovery.docker');
    case 'IMAGE_UNAVAILABLE':return t('setup.recovery.image');
    case 'IMAGE_INCOMPATIBLE':return t('setup.recovery.incompatible');
    case 'CONTEXT_PREPARATION_FAILED':return t('setup.recovery.context');
    case 'SHUTTING_DOWN':return t('setup.recovery.shutdown');
    case 'RUNTIME_UNCONFIGURED':return t('setup.recovery.runtime');
    default:return t('setup.recovery.default');
  }
}
function retryWait(value:Data) {
  const seconds=value.retryAfterSeconds;
  return typeof seconds==='number'&&Number.isFinite(seconds)&&seconds>=0
    ? seconds===0?t('setup.runtime.retryShort'):t(Math.ceil(seconds)===1?'setup.runtime.retryInOne':'setup.runtime.retryIn',{seconds:Math.ceil(seconds)})
    : t('setup.runtime.autoRetry');
}
function preparationDetail(name:string,value:Data) {
  const components=snapshot.preparation?.components||{};
  if(value.state==='ready')return '';
  if(value.state==='preparing')return name==='docker'?t('setup.preparation.checkingDocker'):t('setup.preparation.preparingResources',{name:preparationLabel(name)});
  if(value.state==='retrying')return preparationRecovery(value)+' '+retryWait(value);
  if(value.state==='failed'||value.state==='unconfigured')return preparationRecovery(value);
  if(value.state==='pending') {
    if(name!=='docker'&&components.docker?.state!=='ready')return t('setup.preparation.waitingDocker');
    if(name==='defaultContext') {
      const dependencies=['agent','packageHelper'].filter(key=>components[key]?.state!=='ready').map(key=>preparationLabel(key));
      if(dependencies.length)return t('setup.preparation.waitingFor',{names:dependencies.join(t('ui.listAnd'))});
    }
    return t('setup.preparation.waitingStart');
  }
  return t('setup.preparation.unconfirmed');
}
function preparationPresentation() {
  const components=snapshot.preparation?.components||{};
  const entries=preparationNames.map(name=>({name,value:components[name]||{}}));
  if(preparationReadError)return {title:t('setup.presentation.interruptedTitle'),summary:t('setup.presentation.interruptedSummary'),description:preparationReadAt?t('setup.presentation.interruptedWithTime',{time:preparationReadAt,detail:noticeText(preparationReadError)}):t('setup.presentation.interruptedNoTime',{detail:noticeText(preparationReadError)}),tone:'warning',symbol:'warning',busy:false};
  if(preparationReady())return {title:t('setup.presentation.readyTitle'),summary:t('setup.presentation.readySummary'),description:t('setup.presentation.readyDescription'),tone:'success',symbol:'check',busy:false};
  const failed=entries.find(({value})=>value.state==='failed'||value.state==='unconfigured');
  if(failed)return {title:t('setup.presentation.attentionTitle'),summary:t('setup.presentation.failedSummary',{name:preparationLabel(failed.name)}),description:t('setup.presentation.failedDescription',{detail:preparationRecovery(failed.value)}),tone:'warning',symbol:'warning',busy:false};
  const retrying=entries.find(({value})=>value.state==='retrying');
  if(retrying)return {title:t('setup.presentation.retryTitle'),summary:t('setup.presentation.retrySummary',{name:preparationLabel(retrying.name)}),description:t('setup.presentation.retryDescription',{detail:preparationRecovery(retrying.value),wait:retryWait(retrying.value)}),tone:'warning',symbol:'clock',busy:true};
  const active=entries.filter(({value})=>value.state==='preparing');
  if(active.length)return {title:t('setup.presentation.retryTitle'),summary:t('setup.presentation.activeSummary',{names:active.map(({name})=>preparationLabel(name)).join(t('ui.listAnd'))}),description:t('setup.presentation.activeDescription'),tone:'info',symbol:'clock',busy:true};
  const waiting=entries.filter(({value})=>value.state!=='ready');
  return {title:t('setup.presentation.waitTitle'),summary:!snapshot.preparation?t('setup.presentation.waitForStatus'):waiting.length?t('setup.presentation.notConfirmed',{names:waiting.map(({name})=>preparationLabel(name)).join(t('ui.listSeparator'))}):t('setup.presentation.coreUnconfirmed'),description:t('setup.presentation.waitDescription'),tone:'warning',symbol:'warning',busy:false};
}
function maybeAutoEnter() {
  const intent=autoEnter;
  if(!intent||reading||writing||polling||stage!=='preparation'||!current(intent)||intent.revision!==revision||intent.leaveGeneration!==leaveGeneration)return;
  if(confirmedReadGeneration<intent.minimumReadGeneration||catalogError||!preparationReady())return;
  if(snapshot.runtime?.modelRef!==intent.modelRef||snapshot.runtime?.agentImage!==intent.agentImage){autoEnter=null;return;}
  autoEnter=null;
  options.navigate('/');
}
function preparationReadFailed(error:unknown) {
  autoEnter=null;
  if(stage==='preparation'){preparationReadError=message(error);updatePreparation();}
  else {modelReadError=new RefreshFailure(message(error));updateNotice();}
}
function updatePreparation() {
  const states:Record<string,string>={ready:t('setup.state.ready'),preparing:t('setup.state.preparing'),pending:t('setup.state.pending'),retrying:t('setup.state.retrying'),failed:t('setup.state.failed'),unconfigured:t('setup.state.unconfigured')};
  const docker=root.querySelector('#setup-docker');
  if(docker){const value=snapshot.preparation?.components?.docker;docker.innerHTML=`${icon('server',16)}<span>${t('setup.component.docker')}</span>${StatusLabel(value?.state==='unconfigured'?t('setup.docker.notChecked'):states[value?.state]||t('setup.docker.checking'),value?.state==='ready'?'success':'neutral')}<span class="help">${value?.state==='ready'?t('setup.docker.available'):value?.state==='unconfigured'?t('setup.docker.checkedAfter'):t('setup.docker.unavailableHelp')}</span>`;}
  const answer=root.querySelector('#preparation-answer'),components=root.querySelector('#preparation-components'),exit=root.querySelector('#workbench-exit');
  if(!answer)return;
  const ready=preparationReady(),presentation=preparationPresentation();
  if(presentation.busy&&!preparationSince){preparationSince=Date.now();preparationTimer=setTimeout(()=>{if(!disposed&&options.current())updatePreparation();},10000);}
  else if(!presentation.busy){preparationSince=0;clearTimeout(preparationTimer);}
  const slow=preparationSince&&Date.now()-preparationSince>=10000?' '+t('setup.preparation.slow'):'';
  const markup=`<div class="feedback ${presentation.tone}" role="status">${presentation.busy?pendingDots():icon(presentation.symbol,17)}<div><strong>${esc(presentation.summary)}</strong><p>${esc(presentation.description+slow)}</p></div></div>`;
  if(answer.innerHTML!==markup)answer.innerHTML=markup;
  root.querySelector('#setup-title')!.textContent=presentation.title;
  const step=root.querySelector('[data-preparation-step]')!;
  step.classList.toggle('complete',ready);step.classList.toggle('current',!ready);
  step.querySelector('.step-label')!.textContent=ready?t('setup.step.ready'):presentation.busy?t('setup.step.preparing'):t('setup.step.prepare');
  step.querySelector('.step-marker')!.innerHTML=ready?icon('check',13):'2';
  if(components)for(const name of preparationNames){
    const value=snapshot.preparation?.components?.[name]||{};
    let item=components.querySelector<HTMLElement>(`[data-component="${name}"]`);
    if(!item){item=document.createElement('li');item.dataset.component=name;item.tabIndex=-1;components.append(item);}
    const markup=`<span>${esc(preparationLabel(name))}</span>${StatusLabel(states[value.state]||t('setup.state.notConfirmed'),value.state==='ready'?'success':value.state==='failed'||value.state==='retrying'?'warning':'neutral')}<p>${esc(preparationDetail(name,value))}${value.code?` <code>${esc(value.code)}</code>`:''}</p>`;
    if(item.innerHTML!==markup)item.innerHTML=markup;
  }
  const failures=root.querySelector('#preparation-failures');
  if(failures){const markup=preparationNames.filter(name=>['failed','unconfigured'].includes(snapshot.preparation?.components?.[name]?.state)).map(name=>{
    const value=snapshot.preparation.components[name];
    return `<div class="feedback warning"><div><strong>${esc(t('setup.failure.needsAttention',{name:preparationLabel(name)}))}</strong><p>${esc(preparationRecovery(value))}</p><button class="btn secondary small" type="button" data-action="show-component" data-component-target="${name}">${t('setup.failure.viewDetails',{name:esc(preparationLabel(name))})}</button></div></div>`;
  }).join('');if(failures.innerHTML!==markup)failures.innerHTML=markup;}
  if(exit){
    exit.classList.toggle('primary',ready);exit.classList.toggle('secondary',!ready);
    exit.setAttribute('aria-disabled',String(!ready));
    if(ready)exit.setAttribute('href','/');else exit.removeAttribute('href');
  }
  root.querySelector('#preparation-exit-help')!.textContent=ready?t('setup.exit.ready'):preparationReadError?t('setup.exit.read'):t('setup.exit.pending');
}
function fieldError(id:string,text:FeedbackText) {
  const input=root.querySelector<HTMLInputElement>('#'+id),error=root.querySelector<HTMLElement>('#'+id+'-error');
  if(input){if(text){input.setAttribute('aria-invalid','true');input.setAttribute('aria-errormessage',id+'-error');}else{input.removeAttribute('aria-invalid');input.removeAttribute('aria-errormessage');}}
  if(error){error.textContent=text==null?'':String(text);error.hidden=!text;}
}
function focusModelField(id:string) {
  const input=root.querySelector<HTMLElement>('#'+id),advanced=input?.closest<HTMLDetailsElement>('#model-advanced');
  if(advanced){advanced.open=true;advancedOpen=true;}
  input?.focus();
}
function validateModel() {
  capture();const form=root.querySelector<HTMLFormElement>('#model-form');if(!form)return false;
  form.querySelectorAll<HTMLElement>('[data-model-max-length]').forEach(validateModelControl);
  for(const input of form.querySelectorAll<HTMLInputElement>('input')) {
    fieldError(input.id,input.validationMessage);
    if(!input.validity.valid){focusModelField(input.id);return false;}
  }
  const issue=modelDraftIssue(draft);
  if(issue){fieldError(modelField(issue.field),issue.message);focusModelField(modelField(issue.field));return false;}
  return true;
}
function sessionFailure(error:unknown) {
 if(error instanceof RequestError&&error.status===401){options.expired();dispose();return true;}return false;
}
function resolveUnknown() {
  if(modelUnknown&&pendingModel) {
    // Full submitted public identity plus the pre-write catalog, never a name-only guess.
    const matches=models.filter(model=>!beforeModels.has(model.id)&&model.model===pendingModel!.model&&model.api===pendingModel!.api&&model.baseUrl===pendingModel!.baseUrl&&model.name===(pendingModel!.name||pendingModel!.model)&&model.enabled&&model.credentialAvailable);
    if(matches.length===1){selectedRef=confirmedModel=matches[0].modelRef;pendingModel=null;modelUnknown=false;mode='choose';draft=blankModel();tell(t('setup.modelSave.confirmed'));}
    else if(matches.length>1){modelUnknown=false;pendingModel=null;mode='choose';selectedRef='';tell(t('setup.modelSave.ambiguous'),true);}
  }
  if(runtimeUnknown&&pendingRuntime&&snapshot.runtime?.configured&&snapshot.runtime.modelRef===pendingRuntime.modelRef&&snapshot.runtime.agentImage===pendingRuntime.agentImage){runtimeUnknown=false;pendingRuntime=null;tell(t('setup.runtimeSave.confirmed'));}
}
async function readCurrent(preserve=true) {
  if(disposed||!options.current()||reading||writing||polling)return;
  reading=true;const lock=Symbol();readLock=lock;clearTimeout(timer);const generation=++readGeneration,ticket=context();updateLocks();
  try {
    const currentState=await web('onboarding');if(!current(ticket)||generation!==readGeneration)return;
    acceptSnapshot(currentState,generation);
    if(!snapshot.administrator){options.expired();dispose();return;}
    try {const result=await admin('models');if(!current(ticket)||generation!==readGeneration)return;if(!Array.isArray(result.models))throw new Error(t('setup.catalog.incomplete'));models=result.models;catalogError='';}
    catch(error){if(!current(ticket)||generation!==readGeneration||sessionFailure(error))return;catalogError=message(error);autoEnter=null;}
    const modelWasUnknown=modelUnknown,runtimeWasUnknown=runtimeUnknown;resolveUnknown();
    const recovered=modelWasUnknown!==modelUnknown||runtimeWasUnknown!==runtimeUnknown;
    let initializedBaseline=false;
    if(!baselineReady&&!catalogError){
      initializedBaseline=true;
      baselineRef=snapshot.runtime?.modelRef||'';selectedRef=selectedRef||baselineRef;
      if(!snapshot.runtime?.configured&&models.length===0&&revision===0){draft=firstModel();advancedOpen=false;}
      else advancedOpen=mode==='add';
      baselineDraft=revision===0?{...draft,key:''}:blankModel();baselineReady=true;
    }
    const canPrepare=snapshot.runtime?.configured&&snapshot.runtime.modelRef&&snapshot.runtime.model?.credentialAvailable&&(!!catalogError||models.some(model=>model.modelRef===snapshot.runtime.modelRef&&model.enabled&&model.credentialAvailable));
    if(!preserve||stage!=='model'||recovered||(initializedBaseline&&revision===0)) {
      if(canPrepare&&!runtimeUnknown&&!modelUnknown&&!modelWasUnknown&&(stage==='preparation'||options.preparation||runtimeWasUnknown)){changeStage('preparation');}
      else{changeStage('model');mode=confirmedModel||models.length?'choose':'add';}
      if(stage==='preparation'&&root.querySelector('#preparation-answer'))updatePreparation();else render();
    } else {
      // Status reads never replace the active model form, focus, selection or Key.
      updatePreparation();
      const release=root.querySelector('#release-note');if(release)release.innerHTML=snapshot.releaseError?Feedback(t('setup.model.releaseIncomplete'),'warning'):'';
      const select=root.querySelector<HTMLSelectElement>('#saved-model');if(select)select.innerHTML=modelOptions();
      const note=root.querySelector('#catalog-note');if(note)note.innerHTML=catalogNotice();
    }
  } catch(error){if(current(ticket)&&generation===readGeneration&&!sessionFailure(error)){preparationReadFailed(error);if(stage==='loading'){changeStage('error');render();}}}
  finally {if(readLock===lock){readLock=null;reading=false;updateLocks();}if(!reading&&!writing){maybeAutoEnter();scheduleStatus();}}
}
function scheduleStatus() {
  clearTimeout(timer);if(disposed||!options.current()||(stage!=='model'&&stage!=='preparation'))return;
  const ticket=context(),generation=readGeneration;
  timer=setTimeout(async()=>{
    if(!current(ticket)||generation!==readGeneration||writing||reading)return;
    if(stage==='model'&&(modelUnknown||runtimeUnknown||catalogError)){await readCurrent(true);return;}
    polling=true;updateLocks();
    try {const value=await web('onboarding');if(!current(ticket)||generation!==readGeneration)return;if(!value.administrator){options.expired();dispose();return;}acceptSnapshot(value,generation);updatePreparation();}
    catch(error){if(current(ticket)&&generation===readGeneration&&!sessionFailure(error))preparationReadFailed(error);}
    finally{if(current(ticket)&&generation===readGeneration){polling=false;updateLocks();maybeAutoEnter();scheduleStatus();}}
  },5000);
}
async function continueSetup(allowAutoEnter=true) {
  if(writing||reading||modelUnknown||runtimeUnknown||catalogError)return false;
  if(mode==='add'&&!validateModel())return false;
  if(mode==='choose'&&!models.some(model=>model.modelRef===selectedRef&&model.enabled&&model.credentialAvailable)){fieldError('saved-model',t('setup.error.chooseModel'));root.querySelector<HTMLElement>('#saved-model')?.focus();return false;}
  if(mode==='choose'&&snapshot.runtime?.configured&&snapshot.runtime.modelRef===selectedRef&&snapshot.runtime.agentImage===snapshot.defaultAgentImage){confirmedModel='';changeStage('preparation');tell(t('setup.runtime.exists'));render();scheduleStatus();return true;}
  capture();const candidate=allowAutoEnter&&snapshot.administrator&&snapshot.runtime?.configured===false?{revision,leaveGeneration}:null;autoEnter=null;
  const submitted={...draft},ticket=context();writing=true;clearTimeout(timer);readGeneration++;polling=false;updateLocks();tell('');
  // A new explicit chain owns its phase; only an unknown binding keeps a readback target.
  let binding=false;pendingRuntime=null;
  try {
    if(mode==='add') {
      beforeModels=new Set(models.map(model=>model.id));pendingModel={name:submitted.name.trim(),model:submitted.model.trim(),api:submitted.api,baseUrl:submitted.baseUrl.trim()};
      const value=await admin('models','POST',{...pendingModel,credential:submitted.key});
      if(!current(ticket))return false;
      if(typeof value.modelRef!=='string')throw new RequestError(new LocalizedMessage('setup.modelSave.unconfirmed'),0,true);
      selectedRef=confirmedModel=value.modelRef;pendingModel=null;models.push(value);draft=blankModel();
      const key=root.querySelector<HTMLInputElement>('#model-key');if(key&&key.value===submitted.key)key.value='';
      tell(t('setup.modelSaved.binding'));
    }
    pendingRuntime={modelRef:selectedRef,agentImage:snapshot.defaultAgentImage||''};
    binding=true;
    const value=await admin('runtime','PUT',{modelRef:pendingRuntime.modelRef});
    if(!current(ticket))return false;
    if(!value.runtime?.configured||value.runtime.modelRef!==pendingRuntime.modelRef)throw new RequestError(new LocalizedMessage('setup.runtimeSave.unconfirmed'),0,true);
    const confirmedTarget=pendingRuntime;
    snapshot={...snapshot,runtime:value.runtime,status:value.status,preparation:undefined};pendingRuntime=null;confirmedModel='';draft=blankModel();revision++;testResult=null;
    const canAutoEnter=candidate&&candidate.revision===revision-1&&candidate.leaveGeneration===leaveGeneration&&value.runtime.agentImage===confirmedTarget.agentImage&&!!confirmedTarget.agentImage;
    writing=false;changeStage('preparation');
    if(canAutoEnter)autoEnter={...context(),revision,leaveGeneration,minimumReadGeneration:readGeneration+1,...confirmedTarget};
    tell('');render();
    await readCurrent(true);return true;
  } catch(error) {
    if(!current(ticket)||sessionFailure(error))return false;
    autoEnter=null;const unknown=error instanceof RequestError&&error.unknown;
    if(binding){runtimeUnknown=unknown;if(!unknown)pendingRuntime=null;mode='choose';tell(new NoticeParts([new LocalizedMessage('setup.modelSaved'),unknown?unknownNotice():new NoticeParts([new LocalizedMessage('setup.runtimeNotBound'),message(error),new LocalizedMessage('setup.runtimeRetryBinding')])]),true);}
    else {modelUnknown=unknown;tell(unknown?unknownNotice():message(error),true);if(error instanceof RequestError&&error.field){fieldError(modelField(error.field),message(error));focusModelField(modelField(error.field));}}
    if(confirmedModel||unknown){draft.key='';mode=confirmedModel?'choose':mode;render();}
    else {const key=root.querySelector<HTMLInputElement>('#model-key');if(key&&key.value===submitted.key)key.value='';draft.key='';}
    return false;
  } finally {
    submitted.key='';if(current(ticket)){writing=false;updateLocks();scheduleStatus();}
  }
}
function updateTest() {const result=root.querySelector('#model-test-result');if(result)result.innerHTML=modelTestSummary(testResult,revision);const body=root.querySelector('#test-body');if(body)body.innerHTML=modelTestDetails(testResult,revision);}
function openTest() {if(!testResult)return;updateTest();root.querySelector<HTMLDialogElement>('#test-dialog')?.showModal();}
async function testModel() {
  if(testing||writing||reading||modelUnknown||runtimeUnknown||!validateModel())return;
  const submitted={...draft},ticket=context(),record:ModelTestRecord={target:{provider:draft.name||draft.model,api:draft.api,model:draft.model.trim()},revision,pending:true,startedAt:Date.now()};
  testResult=record;testing=true;updateLocks();openTest();
  try {const value=await admin('model-tests','POST',{model:submitted.model.trim(),api:submitted.api,baseUrl:submitted.baseUrl.trim(),credential:submitted.key});if(!validModelTest(value))throw new Error(t('setup.test.incomplete'));if(current(ticket)&&testResult===record)record.value=value;}
  catch(error){if(!current(ticket)||sessionFailure(error))return;record.error=message(error);if(error instanceof RequestError){record.errorField=error.field;record.notStarted=['INVALID_REQUEST','NOT_FOUND','MODEL_UNAVAILABLE','MODEL_TEST_BUSY','UNSUPPORTED_MEDIA_TYPE'].includes(error.code);if(error.field)fieldError(modelField(error.field),message(error));}}
  finally{submitted.key='';if(current(ticket)&&testResult===record){record.pending=false;testing=false;updateTest();updateLocks();}}
}
async function action(action:string) {
 if(disposed||!options.current())return;
 if(action==='close-test'){root.querySelector<HTMLDialogElement>('#test-dialog')?.close();return;}
 if(action==='keep-editing'){root.querySelector<HTMLDialogElement>('#leave-dialog')?.close();leaveAction=null;leaveGeneration++;return;}
 if(action==='discard-draft'){clearSecrets();draft=blankModel();root.querySelector<HTMLDialogElement>('#leave-dialog')?.close();const leave=leaveAction;leaveAction=null;leaveGeneration++;leave?.();return;}
 if(action==='save-leave'){
  root.querySelector<HTMLDialogElement>('#leave-dialog')?.close();const leave=leaveAction,generation=leaveGeneration;leaveAction=null;
  // Entering preparation changes the form view. Only this still-mounted leave
  // intent may navigate after its read; a newer route or identity owns itself.
  if(await continueSetup(false)&&!disposed&&options.current()&&generation===leaveGeneration){leaveGeneration++;leave?.();}
  return;
 }
 if(writing||reading)return;
 if(action==='refresh'){if(polling)return;tell('');await readCurrent(stage!=='error');return;}
 if(action==='add-model'||action==='choose-model'){autoEnter=null;capture();if(action==='choose-model'&&dirty()&&!confirm(t('setup.discardConfirm')))return;view++;readGeneration++;testResult=null;testing=false;draft=blankModel();baselineDraft={...draft};advancedOpen=true;confirmedModel='';mode=action==='add-model'?'add':'choose';render();scheduleStatus();return;}
}
const submit=(event:Event)=>{event.preventDefault();event.stopPropagation();void continueSetup();};
const input=(event:Event)=>{
 event.stopPropagation();autoEnter=null;const input=event.target as HTMLInputElement;
 if(input.closest('#model-form')){capture();revision++;validateModelControl(input);fieldError(input.id,'');if(input.id==='model-api'){const url=root.querySelector<HTMLInputElement>('#model-base-url');if(url)url.placeholder=modelPlaceholder(draft.api);const help=root.querySelector('#model-base-url-help');if(help)help.textContent=modelProtocolHelp(draft.api);}updateTest();}
 if(input.id==='saved-model'){selectedRef=input.value;confirmedModel='';fieldError('saved-model','');}
 options.dirty(dirty());
};
const click=(event:MouseEvent)=>{
 if((event.target as HTMLElement).closest('#workbench-exit')&&!preparationReady()){event.preventDefault();event.stopPropagation();return;}
 const element=(event.target as HTMLElement).closest<HTMLElement>('[data-action],[data-model-action]');
 if(element?.dataset.action==='show-component'){
   event.preventDefault();event.stopPropagation();root.querySelector<HTMLDetailsElement>('#preparation-details')!.open=true;
   root.querySelector<HTMLElement>(`[data-component="${element.dataset.componentTarget}"]`)?.focus();return;
 }
 if(element){event.preventDefault();event.stopPropagation();const command=element.dataset.modelAction;if(command==='test')void testModel();else if(command==='view-test')openTest();else if(command==='edit-test'){root.querySelector<HTMLDialogElement>('#test-dialog')?.close();focusModelField(modelField(testResult?.errorField||'model'));}else void action(element.dataset.action!);return;}
 if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
 const link=(event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
 if(link){
   if(link.target&&link.target!=='_self'||link.origin!==location.origin)return;
   event.preventDefault();event.stopPropagation();options.navigate(link.href);
 }
};
function relocalize(){
 if(disposed||!options.current())return;
 capture();
 const testOpen=!!root.querySelector<HTMLDialogElement>('#test-dialog')?.open;
 const leaveOpen=!!root.querySelector<HTMLDialogElement>('#leave-dialog')?.open;
 render();
 // Re-rendering must not discard a typed Key; only stage changes clear secrets.
 const keyInput=root.querySelector<HTMLInputElement>('#model-key');if(keyInput&&!writing)keyInput.value=draft.key;
 if(testOpen){updateTest();root.querySelector<HTMLDialogElement>('#test-dialog')?.showModal();}
 if(leaveOpen&&leaveAction)root.querySelector<HTMLDialogElement>('#leave-dialog')?.showModal();
}
function dispose(){if(disposed)return;autoEnter=null;disposed=true;leaveGeneration++;leaveAction=null;view++;identity++;readGeneration++;readLock=null;reading=false;polling=false;clearTimeout(timer);clearTimeout(slowTimer);clearTimeout(preparationTimer);clearSecrets();root.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog=>dialog.close());root.removeEventListener('submit',submit);root.removeEventListener('input',input);root.removeEventListener('click',click);}
root.addEventListener('submit',submit);root.addEventListener('input',input);root.addEventListener('click',click);
onLocaleChange(()=>relocalize());
render();void readCurrent(false);
return {dispose,requestLeave(leave){if(disposed||!options.current())return;autoEnter=null;leaveGeneration++;leaveAction=null;if(!dirty()){leave();return;}leaveAction=leave;root.querySelector<HTMLDialogElement>('#leave-dialog')?.showModal();}};
}
