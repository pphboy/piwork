import {pendingDots} from './pending.js';
import {adapter,ConsoleError} from './adapter.js';
import type {ModelConfig,ModelTestResult} from '@piwork/contracts';
import {esc,PageHeader,Section,Feedback,NavLink,StatusLabel} from './components.js';
import {blankModel,modelDraftIssue,modelFields,modelField,modelPlaceholder,modelProtocolHelp,readModelDraft,validateModelControl,modelTestSummary,modelTestDetails,validModelTest,type ModelDraft,type ModelTestRecord} from './model-form.js';
import {t,currentLocale,LocalizedMessage,messageText,type Feedback as FeedbackText} from './locale.js';
const blank=blankModel;
const part=encodeURIComponent;
const message=(e:unknown):FeedbackText=>e instanceof ConsoleError?e.feedback:e instanceof Error?e.message:new LocalizedMessage('models.requestFailed');
export interface ModelTestDialog{update(body:string):void;close():void;}
type TestResult=ModelTestRecord;
export class ModelManagement{
 models:ModelConfig[]=[];
 path='/models';
 private draft=blank();private revision=0;private view=0;private loading=0;private saving=false;private testing=false;private reading=false;private pendingAction='';private pendingStarted=0;private pendingTimer:ReturnType<typeof setInterval>|undefined;private uncertain=false;private note:FeedbackText='';private noteError=false;
 private fieldError:{field:string;message:FeedbackText}|null=null;
 private testResult:TestResult|null=null;private testDialog:ModelTestDialog|null=null;private testSlowTimer:ReturnType<typeof setTimeout>|undefined;
 constructor(private render:()=>void,private dirty:(v:boolean)=>void,private sessionError:(e:unknown,identity:number)=>boolean=()=>false,private showTestDialog?:(body:string)=>ModelTestDialog){
 document.addEventListener('input',e=>{const el=e.target as HTMLElement;if(!el.closest('[data-model-form]'))return;this.capture();this.validateLength(el);this.revision++;this.dirty(true);if(el.id==='model-api'){const input=document.querySelector<HTMLInputElement>('#model-base-url');if(input)input.placeholder=modelPlaceholder(this.draft.api);const help=document.querySelector('#model-base-url-help');if(help)help.textContent=modelProtocolHelp(this.draft.api);}if(this.fieldError&&this.fieldInput(this.fieldError.field)===el){if(this.noteError&&messageText(this.note)===messageText(this.fieldError.message)){this.note='';this.noteError=false;document.querySelector('#model-note')?.replaceChildren();}this.fieldError=null;el.removeAttribute('aria-invalid');el.removeAttribute('aria-errormessage');document.querySelector('#model-field-error')?.remove();}this.markTestStale();});
 document.addEventListener('submit',e=>{if(!(e.target as HTMLFormElement).dataset.modelForm)return;e.preventDefault();void this.save();});
 document.addEventListener('click',e=>{const el=(e.target as HTMLElement).closest<HTMLElement>('[data-model-action]');if(!el)return;e.preventDefault();void this.action(el.dataset.modelAction!,el.dataset.id);});
 }
 leave(){clearInterval(this.pendingTimer);clearTimeout(this.testSlowTimer);this.pendingTimer=undefined;this.testSlowTimer=undefined;this.view++;this.draft.key='';this.testDialog?.close();this.testDialog=null;}
 reset(){this.leave();clearInterval(this.pendingTimer);this.pendingTimer=undefined;this.reading=false;this.pendingAction='';this.testDialog?.close();this.testDialog=null;this.models=[];this.draft=blank();this.testResult=null;this.fieldError=null;this.note='';this.saving=false;this.testing=false;this.uncertain=false;this.revision++;this.loading++;this.view++;}
 private model(){return this.models.find(m=>this.path==='/models/'+part(m.id));}
 private sameView(path:string,epoch:number,view:number){return path===this.path&&epoch===adapter.identityEpoch&&view===this.view;}
 async load(path:string,preserveDraft=false){
 const ticket=++this.loading,epoch=adapter.identityEpoch,changed=!preserveDraft||path!==this.path;this.path=path;
 if(changed){this.testDialog?.close();this.testDialog=null;this.view++;clearInterval(this.pendingTimer);clearTimeout(this.testSlowTimer);this.reading=false;this.pendingAction='';this.saving=false;this.testing=false;this.draft=blank();this.testResult=null;this.fieldError=null;this.note='';this.uncertain=false;}
 this.revision++;this.markTestStale();const value=await adapter.modelRequest('models');
 if(ticket!==this.loading||epoch!==adapter.identityEpoch)return;if(!Array.isArray(value.models))throw new ConsoleError('INVALID_RESPONSE',new LocalizedMessage('models.dataIncomplete'));this.models=value.models;
 const m=this.model();if(changed)this.draft=m?{name:m.name,model:m.model,api:m.api,baseUrl:m.baseUrl,key:''}:blank();
 }
 private capture(){const form=document.querySelector<HTMLFormElement>('[data-model-form]');if(form)this.draft=readModelDraft(form);}
 private validateLength(el:HTMLElement){validateModelControl(el);}
 afterRender(){document.querySelectorAll<HTMLElement>('[data-model-max-length]').forEach(el=>this.validateLength(el));const key=document.querySelector<HTMLInputElement>('#model-key');if(key)key.value=this.draft.key;if(this.fieldError){const input=this.fieldInput(this.fieldError.field);if(input){input.setAttribute('aria-invalid','true');input.setAttribute('aria-errormessage','model-field-error');document.querySelector('#model-field-error')?.remove();input.insertAdjacentHTML('afterend',`<p id="model-field-error" role="alert" class="field-error">${esc(messageText(this.fieldError.message))}</p>`);}}}
 private fieldInput(field:string){return document.getElementById(modelField(field));}
 private inputFailure(field:string,text:FeedbackText){this.fieldError={field,message:text};this.note=text;this.noteError=true;this.render();this.fieldInput(field)?.focus();}
 private markTestStale(){const el=document.querySelector('#model-test-result');if(el)el.innerHTML=this.testMarkup();this.testDialog?.update(this.testModalMarkup());}
  private testMarkup(){return modelTestSummary(this.testResult,this.revision);}
  private testModalMarkup(){return modelTestDetails(this.testResult,this.revision);}
  private openTestResult(){if(this.testResult&&this.showTestDialog){this.testDialog?.close();this.testDialog=this.showTestDialog(this.testModalMarkup());}}

 private beginPending(action:string){this.pendingAction=action;this.pendingStarted=Date.now();clearInterval(this.pendingTimer);this.pendingTimer=setInterval(()=>{if(Date.now()-this.pendingStarted>=10000)this.render();},1000);}
 private endPending(){this.pendingAction='';clearInterval(this.pendingTimer);this.pendingTimer=undefined;}
 private pendingText(action:string,idle:string){const labels:Record<string,string>={save:t('models.pending.save'),read:t('models.pending.read'),enable:t('models.pending.enable'),disable:t('models.pending.disable'),delete:t('models.pending.delete'),default:t('models.pending.default')};return this.pendingAction===action?`${pendingDots()}${labels[action]}`:idle;}
 private busy(action:string){return `aria-busy="${this.pendingAction===action}"`;}
 private form(m?:ModelConfig){const d=this.draft;return `<form data-model-form="model" class="form-grid">
 ${modelFields(d,!!m)}
 <div class="form-actions"><button class="btn primary" type="submit" ${this.saving||this.reading||this.uncertain?'disabled':''} ${this.busy('save')}>${this.pendingText('save',m?t('models.save'):t('models.add'))}</button><button class="btn secondary" type="button" data-model-action="test" ${this.testing?'disabled':''}>${t('setup.model.test')}</button></div><p class="help">${t('setup.model.testHelp')}</p></form>`;}
 markup(){const m=this.model();let body=PageHeader(t('models.pageTitle'),t('models.pageDescription'),`<button class="btn secondary" data-model-action="read" ${this.reading||this.saving?'disabled':''} ${this.busy('read')}>${this.pendingText('read',t('models.read'))}</button>${NavLink(t('models.configureRuntime'),'/runtime','btn secondary')}`,this.path!=='/models'?NavLink(t('models.all'),'/models'):'');
 body+=`<div id="model-pending-note" role="status">${this.pendingAction&&Date.now()-this.pendingStarted>=10000?t('models.pendingNote',{target:this.pendingAction==='read'?t('models.pendingRead'):t('models.pendingWrite'),seconds:Math.floor((Date.now()-this.pendingStarted)/1000)}):''}</div><div id="model-note">${this.note?Feedback(messageText(this.note),this.noteError?'warning':'success'):''}</div>`;
 if(this.path==='/models')return body+Section(t('models.sectionModels'),t('models.sectionModelsDescription'),`<div class="section-body">${this.models.length?this.models.map(m=>`<div class="catalog-row"><div><a href="/models/${part(m.id)}" data-nav><strong>${esc(m.name)}</strong></a><p>${esc(m.api==='openai-responses'?'OpenAI Responses':'Anthropic Messages')} · <code>${esc(m.model)}</code> · <small>${esc(m.id.slice(-8))}</small></p><p>${m.credentialAvailable?t('models.keyAvailable'):t('models.keyUnavailable')}</p></div>${StatusLabel(m.enabled?t('models.enabled'):t('models.disabled'),m.enabled?'success':'neutral')}</div>`).join(''):`<p>${t('models.empty')}</p>`}</div>`)+Section(t('models.addSection'),t('models.addDescription'),`<div class="section-body">${this.form()}<div id="model-test-result">${this.testMarkup()}</div></div>`);
 if(!m)return body+Feedback(t('models.unavailable'),'warning');
 return body+Section(m.name,m.api==='openai-responses'?'OpenAI Responses':'Anthropic Messages',`<div class="section-body"><p>${StatusLabel(m.enabled?t('models.enabled'):t('models.disabled'),m.enabled?'success':'neutral')}</p>${this.form(m)}<div id="model-test-result">${this.testMarkup()}</div><div class="form-actions"><button class="btn secondary" data-model-action="${m.enabled?'disable':'enable'}" data-id="${esc(m.id)}" ${this.saving||this.reading||this.uncertain?'disabled':''} ${this.busy(m.enabled?'disable':'enable')}>${this.pendingText(m.enabled?'disable':'enable',m.enabled?t('models.disableModel'):t('models.enableModel'))}</button><button class="btn danger" data-model-action="delete" data-id="${esc(m.id)}" ${this.saving||this.reading||this.uncertain?'disabled':''} ${this.busy('delete')}>${this.pendingText('delete',t('models.deleteModel'))}</button><button class="btn secondary" data-model-action="default" data-id="${esc(m.id)}" ${!m.enabled||!m.credentialAvailable||this.saving||this.reading||this.uncertain?'disabled':''} ${this.busy('default')}>${this.pendingText('default',t('models.useForFuture'))}</button></div><p class="help">${t('models.helpExisting')}</p></div>`);
 }
 private async save(){if(this.saving||this.reading||this.uncertain)return;this.capture();const issue=modelDraftIssue(this.draft,!!this.model());if(issue){this.inputFailure(issue.field,issue.message);return;}const m=this.model(),path=this.path,epoch=adapter.identityEpoch,view=this.view,submitted=this.draft;let committed=false;this.saving=true;this.beginPending('save');this.note='';this.fieldError=null;this.render();
 try{const d=submitted;const value=await adapter.modelRequest(m?'models/'+part(m.id):'models',m?'PATCH':'POST',{name:d.name.trim(),model:d.model.trim(),api:d.api,baseUrl:d.baseUrl.trim(),...(d.key?{credential:d.key}:{})});if(typeof value.id!=='string')throw new ConsoleError('RESULT_UNKNOWN',new LocalizedMessage('models.resultUnknown'));committed=true;if(!this.sameView(path,epoch,view))return;this.note=new LocalizedMessage('models.saved');this.noteError=false;this.revision++;const newerDraft=this.draft!==submitted;this.dirty(newerDraft);if(!m&&!newerDraft)this.draft=blank();await this.load(path,true);}
 catch(e){if(this.sessionError(e,epoch))return;if(this.sameView(path,epoch,view)){if(!committed&&e instanceof ConsoleError&&e.field)this.fieldError={field:e.field,message:e.feedback};this.note=committed?new LocalizedMessage('models.savedRefresh'):message(e);this.noteError=true;this.uncertain=committed||e instanceof ConsoleError&&e.code==='RESULT_UNKNOWN';}}
 finally{submitted.key='';if(this.sameView(path,epoch,view)){this.saving=false;this.endPending();this.render();}}
 }
 private async action(action:string,id?:string){
 if(action==='edit-test'){this.testDialog?.close();this.fieldInput(this.testResult?.errorField||'model')?.focus();return;}
 if(action==='test'){await this.test();return;}if(action==='view-test'){this.openTestResult();return;}
 if(action==='read'){
   if(this.reading||this.saving)return;
   const path=this.path,epoch=adapter.identityEpoch,view=this.view;
   this.capture();this.reading=true;this.beginPending('read');this.render();
   try{await this.load(path,true);if(!this.sameView(path,epoch,view))return;this.uncertain=false;this.note=new LocalizedMessage('models.readDone',{time:new Date().toLocaleTimeString(currentLocale()==='zh-CN'?'zh-CN':'en-US')});this.noteError=false;}
   catch(e){if(this.sessionError(e,epoch)||!this.sameView(path,epoch,view))return;this.note=message(e);this.noteError=true;}
   finally{if(this.sameView(path,epoch,view)){this.reading=false;this.endPending();this.render();}}
   return;
 }
 if(this.saving||this.reading||this.uncertain)return;const m=this.models.find(m=>m.id===id);if(!m)return;if(action!=='default'&&!confirm(action==='delete'?t('models.confirm.delete',{name:m.name}):action==='disable'?t('models.confirm.disable',{name:m.name}):t('models.confirm.enable',{name:m.name})))return;
 const path=this.path,epoch=adapter.identityEpoch,view=this.view;let committed=false;this.saving=true;this.beginPending(action);this.render();try{if(action==='default')await adapter.modelRequest('default-work','PATCH',{modelRef:m.modelRef});else await adapter.modelRequest('models/'+part(m.id)+(action==='delete'?'':'/'+action),action==='delete'?'DELETE':'POST',action==='delete'?undefined:{});committed=true;if(!this.sameView(path,epoch,view))return;await this.load(path,true);if(!this.sameView(path,epoch,view))return;this.note=new LocalizedMessage(action==='default'?'models.defaultSaved':'models.stateSaved');this.noteError=false;}catch(e){if(this.sessionError(e,epoch))return;if(this.sameView(path,epoch,view)){this.note=committed?new LocalizedMessage('models.stateSavedRefresh'):message(e);this.noteError=true;this.uncertain=committed||e instanceof ConsoleError&&e.code==='RESULT_UNKNOWN';}}finally{if(this.sameView(path,epoch,view)){this.saving=false;this.endPending();this.render();}}
 }
 private async test(){if(this.testing)return;this.capture();const m=this.model(),path=this.path,epoch=adapter.identityEpoch,view=this.view,revision=this.revision,d={...this.draft};const model=d.model.trim(),baseUrl=d.baseUrl.trim();if(!model||!baseUrl||!m&&!d.key.trim()){const field=!model?'model':!baseUrl?'baseUrl':'credential';this.inputFailure(field,new LocalizedMessage(field==='credential'?'models.enterKey':field==='baseUrl'?'models.enterUrl':'models.enterModel'));return;}
 const issue=modelDraftIssue(d,!!m);if(issue){this.inputFailure(issue.field,new LocalizedMessage('models.issueSuffix',{message:messageText(issue.message)}));return;}
 const input={...(m?{modelId:m.id}:{}),api:d.api,baseUrl,model,...(d.key?{credential:d.key}:{})};const record:TestResult={target:{provider:d.name||model,api:d.api,model},revision,pending:true,startedAt:Date.now()};this.note='';this.noteError=false;this.fieldError=null;this.testResult=record;this.testing=true;this.openTestResult();this.render();clearTimeout(this.testSlowTimer);this.testSlowTimer=setTimeout(()=>{if(this.sameView(path,epoch,view)&&this.testResult===record&&record.pending)this.markTestStale();},10000);
 try{const value=await adapter.modelRequest('model-tests','POST',input);if(!validModelTest(value))throw new ConsoleError('RESULT_UNKNOWN',new LocalizedMessage('models.testIncomplete'));if(this.sameView(path,epoch,view)&&this.testResult===record)record.value=value as ModelTestResult;}
 catch(e){if(this.sessionError(e,epoch))return;if(this.sameView(path,epoch,view)&&this.testResult===record){record.error=message(e);if(e instanceof ConsoleError){record.errorField=e.field;record.diagnosticId=e.correlationId;record.notStarted=['INVALID_REQUEST','NOT_FOUND','MODEL_UNAVAILABLE','MODEL_TEST_BUSY','UNSUPPORTED_MEDIA_TYPE'].includes(e.code);if(e.field)this.fieldError={field:e.field,message:e.feedback};}}}
 finally{if(this.sameView(path,epoch,view)&&this.testResult===record){clearTimeout(this.testSlowTimer);this.testSlowTimer=undefined;record.pending=false;this.testing=false;this.render();this.testDialog?.update(this.testModalMarkup());}}
 }
}
