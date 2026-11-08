// Appended ONLY to the ignored compiled copy, to use the real renderers and
// dispatchers without rewriting source modules or their business contracts.
const protoQuery=new URLSearchParams(location.search);
const prototypeState={after:protoQuery.get('mode')!=='before',grid:protoQuery.get('layout')==='grid',variant:protoQuery.get('variant')||'A',managed:'',detail:false};
const protoOriginal={works,agent,services,settingsPage,modalMarkup,render,openModal,workHeader,files,fileTarget};
const protoLabels=()=>document.documentElement.lang==='zh-CN';
const protoText=(cn,en)=>protoLabels()?cn:en;
function protoFragment(html,change){const template=document.createElement('template');template.innerHTML=html;change(template.content);template.content.querySelectorAll('.icon-refresh').forEach(svg=>{svg.innerHTML='<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>'});return template.innerHTML;}
function protoButton(label,action,classes='quiet small',attrs=''){return '<button class="button '+classes+'" data-proto="'+action+'" '+attrs+'>'+label+'</button>';}
function protoSetURL(){const query=new URLSearchParams(location.search);query.set('mode',prototypeState.after?'after':'before');query.set('revision','11');query.set('variant',prototypeState.variant);if(prototypeState.grid)query.set('layout','grid');else query.delete('layout');history.replaceState(null,'','?'+query+location.hash);}
function protoWorkIcon(){return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="16" height="15" rx="2"/><path d="M5 8h16M3 7v12a2 2 0 0 0 2 2h12"/></svg>';}
works=function(){
 const original=protoOriginal.works();if(!prototypeState.after)return original;
 return protoFragment(original,fragment=>{
  const toolbar=fragment.querySelector('.works-toolbar > .actions');
  if(toolbar){const layouts=document.createElement('div');layouts.className='proto-layout-switch';layouts.setAttribute('role','group');layouts.setAttribute('aria-label',protoText('Work 列表布局','Work layout'));
   layouts.innerHTML=protoButton(icon('note',16),'list','quiet icon-button small','aria-label="List" title="List" aria-pressed="'+!prototypeState.grid+'"')+protoButton(icon('grid',16),'grid','quiet icon-button small','aria-label="Grid" title="Grid" aria-pressed="'+prototypeState.grid+'"');toolbar.prepend(layouts);}
  fragment.querySelectorAll('.work-icon').forEach(el=>el.innerHTML=protoWorkIcon());
  const empty=fragment.querySelector('.works-page .empty'),heading=empty?.querySelector('h2');
  if(empty&&heading&&adapter.worksChecked&&!adapter.state.works.length&&heading.textContent===t('works.emptyTitle')){
   empty.classList.add('proto-empty-guidance');
   const shape=empty.querySelector(':scope > svg');if(shape){const mark=document.createElement('span');mark.className='proto-empty-work-icon';mark.setAttribute('aria-hidden','true');mark.innerHTML=protoWorkIcon();shape.replaceWith(mark);}
   heading.textContent=protoText('创建你的第一个 Work','Create your first Work');
   const description=empty.querySelector('p');if(description)description.textContent=protoText('创建后，你可以与 Agent 对话、使用 Service，并管理这项工作的文件。','A Work keeps your services, files, and Agent conversations together.');
   const create=empty.querySelector('[data-action="new-work"]'),actions=document.createElement('div');actions.className='proto-empty-actions';
   if(create)actions.append(create);
   const existing=empty.querySelector('[data-action="import"]');if(existing)actions.append(existing);else actions.insertAdjacentHTML('beforeend',btn(t('works.import'),'import'));
   empty.append(actions);
  }
  fragment.querySelectorAll('.work-row a.button').forEach(el=>{el.innerHTML=esc(protoText('打开 Work','Open Work'));el.classList.add('proto-open-work');});
  const table=fragment.querySelector('.work-table');if(prototypeState.grid&&table){table.classList.add('proto-work-grid');table.querySelector('.work-table-head')?.remove();}
 });
};
agent=function(...args){
 const html=protoOriginal.agent(...args);if(!prototypeState.after)return html;
 return protoFragment(html,fragment=>{
  fragment.querySelector('.agent-title > b')?.remove();
  const current=fragment.querySelector('.session-line button'),title=fragment.querySelector('.agent-title');
  if(current&&title){const name=document.createElement('span');name.className='proto-session-name';name.textContent=current.textContent.trim();title.append(name);}
  fragment.querySelector('.session-line')?.remove();
  const focusAction=view.layout==='chat-only'?'restore-layout':view.layout!=='workspace'&&innerWidth<900?'exit-service-focus':'focus-chat';
  fragment.querySelectorAll('.agent-header [data-action="focus-chat"],.agent-header [data-action="restore-layout"],.agent-header [data-action="exit-service-focus"],.agent-header [data-action="focus-toggle-chat"]').forEach(el=>{if(el.dataset.action!==focusAction)el.remove();});
  fragment.querySelectorAll('.agent-header .pending-dots').forEach(dots=>{const shape=document.createElement('span');shape.className='skeleton-fill proto-header-icon-skeleton';shape.setAttribute('aria-hidden','true');dots.replaceWith(shape);});
 });
};
workHeader=function(...args){
 const html=protoOriginal.workHeader(...args);if(!prototypeState.after)return html;
 return protoFragment(html,fragment=>{
  const feedback=fragment.querySelector('.work-read-feedback'),status=fragment.querySelector('.work-header-status');
  if(status&&(feedback||status.querySelector('.pending-status'))){
   const reading=feedback?.getAttribute('aria-label')||status.querySelector('.pending-status')?.textContent||t('work.reading');
   status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-busy','true');status.setAttribute('aria-label',reading);status.title=reading;
   status.innerHTML='<span class="skeleton-fill proto-header-status-skeleton" aria-hidden="true"></span>';
  }
  feedback?.remove();
  fragment.querySelectorAll('.pending-dots').forEach(dots=>{const shape=document.createElement('span');shape.className='skeleton-fill proto-header-icon-skeleton';shape.setAttribute('aria-hidden','true');dots.replaceWith(shape);});
 });
};
services=function(...args){
 const html=protoOriginal.services(...args);if(!prototypeState.after)return html;
 return protoFragment(html,fragment=>{
  fragment.querySelector('.service-trigger')?.classList.add('proto-service-trigger');
  fragment.querySelectorAll('.service-toolbar [data-action="service-requests"]').forEach(el=>el.remove());
  const status=fragment.querySelector('.service-trigger .status.ready');
  if(status)status.textContent=protoText('运行中','Running');
 });
};
files=function(...args){
 const html=protoOriginal.files(...args);if(!prototypeState.after)return html;
 return protoFragment(html,fragment=>{fragment.querySelector('#file-actions')?.classList.add('proto-compact-file-actions');});
};
fileTarget=function(...args){
 const html=protoOriginal.fileTarget(...args);if(!prototypeState.after)return html;
 return protoFragment(html,fragment=>{
  const toolbar=fragment.querySelector('.file-target-toolbar');if(!toolbar)return;
  toolbar.classList.add('proto-file-detail-toolbar');
  const back=toolbar.querySelector('[data-action="close-file"]');if(back){back.classList.add('proto-file-back');toolbar.prepend(back);}
  const heading=toolbar.querySelector('.file-target-heading'),path=heading?.querySelector('.mono'),name=heading?.querySelector('strong');
  if(path&&name){const full=path.textContent.trim(),parent=full.slice(0,full.lastIndexOf('/')+1);name.title=full;path.title=full;path.classList.add('proto-file-path');if(parent==='/')path.classList.add('sr-only');else path.textContent=parent;}
  const editor=fragment.querySelector('.editor-toolbar'),status=editor?.querySelector('.status'),actions=toolbar.querySelector('.file-toolbar-actions');
  if(status&&actions){status.classList.add('proto-file-save-state');actions.prepend(status);}
  editor?.remove();
 });
};
settingsPage=function(...args){
 const html=protoOriginal.settingsPage(...args);if(!prototypeState.after)return html;
 return protoFragment(html,fragment=>{
  fragment.querySelector('.settings-language')?.remove();
  for(const action of ['save-config','apply-config'])fragment.querySelectorAll('[data-action="'+action+'"]').forEach((el,index)=>{if(index>0)el.remove();});
  const page=fragment.querySelector('.settings-page'),nav=fragment.querySelector('.settings-tabs');if(!page||!nav)return;
  const layout=document.createElement('div'),body=document.createElement('div');layout.className='proto-settings-layout';body.className='proto-settings-content';
  let next=nav.nextSibling;while(next){const after=next.nextSibling;body.append(next);next=after;}
  nav.before(layout);layout.append(nav,body);
 });
};
let protoManageContext=false;
openModal=function(name,data={}){
 if(prototypeState.after){
  if(name==='service-control'&&view.modal==='service-picker')protoManageContext=true;
  if(name==='service-details'&&(view.modal==='service-picker'||protoManageContext)){
   prototypeState.managed=data.serviceId;prototypeState.detail=true;
   return protoOriginal.openModal('service-picker',data);
  }
  if(name==='service-picker')protoManageContext=true;
  else if(!['service-control','service-details','operation'].includes(name))protoManageContext=false;
 }
 return protoOriginal.openModal(name,data);
};
function protoServiceRows(w){
 const currentService=activeService(w);
 return w.services.filter(s=>s.observed!=='Removed').map(s=>{
  const selected=s.id===currentService?.id,managed=s.id===prototypeState.managed;
  const choose=prototypeState.variant==='B'?'data-proto="inspect"':'data-action="'+(s.ports.length?'select-service':'')+'"';
  const line='<div class="proto-service-row '+(selected?'is-selected':'')+'"><button class="button quiet proto-service-name" '+choose+' data-id="'+esc(s.id)+'" '+(!s.ports.length&&prototypeState.variant!=='B'?'disabled ':'')+'aria-label="'+esc(s.name)+'" '+(selected?'aria-current="true"':'')+'><span class="proto-service-symbol">'+icon(s.ports.length?'grid':'terminal',16)+'</span><span class="proto-service-copy"><strong>'+esc(s.name)+'</strong>'+(!s.ports.length?'<small>'+t('service.noWebEntry')+'</small>':'')+'</span>'+badge(s.enabled?s.observed:'Disabled')+'<span class="proto-service-tick" aria-hidden="true">'+(selected?icon('check',14):'')+'</span></button>'+(prototypeState.variant==='B'?'<span class="proto-service-action-space" aria-hidden="true"></span>':protoButton(icon(prototypeState.variant==='C'?'down':'more',16),'inspect','quiet icon-button small','data-id="'+esc(s.id)+'" aria-label="'+esc(s.name)+' '+esc(protoText('管理操作','management'))+'" aria-expanded="'+managed+'"'))+'</div>';
  if(prototypeState.variant==='C'&&managed){const temp=document.createElement('template');temp.innerHTML=serviceDetails(s,w);return line+'<div class="proto-inline-service">'+(temp.content.querySelector('.service-controls')?.outerHTML||'')+protoButton(protoText('详情与日志','Details & logs'),'service-detail','text-button','data-id="'+esc(s.id)+'"')+'</div>';}
  return line;
 }).join('');
}
function protoServiceInspector(w,s){
 const original=serviceDetails(s,w);
 if(prototypeState.detail)return '<div class="proto-managed-detail">'+protoButton(icon('arrow',14)+' '+protoText('返回服务列表','Back to Services'),'service-back','text-button')+original+btn(icon('copy',14)+' '+t('service.copyDomain'),'copy','text-button','data-copy="'+esc(s.domain)+'"')+'</div>';
 const temp=document.createElement('template');temp.innerHTML=original;
 return '<div class="proto-service-inspector"><div class="proto-managed-heading">'+icon(s.ports.length?'grid':'terminal',16)+'<h3>'+esc(s.name)+'</h3></div><div class="proto-service-control-content">'+badge(s.enabled?s.observed:'Disabled')+(temp.content.querySelector('.service-controls')?.outerHTML||'')+protoButton(protoText('详情与日志','Details & logs'),'service-detail','text-button','data-id="'+esc(s.id)+'"')+(prototypeState.variant==='B'&&s.ports.length?btn(protoText('切换到此应用','Switch to this app'),'select-service','small', 'data-id="'+esc(s.id)+'"'):'')+'</div></div>';
}
function protoMenuSeparatorBefore(node){
 if(!node||node.previousElementSibling?.getAttribute('role')==='separator')return;
 const separator=document.createElement('div');separator.className='proto-menu-separator';separator.setAttribute('role','separator');node.before(separator);
}
function protoCompactCommandMenu(modal,kind){
 modal.classList.add('proto-compact-menu','proto-menu-'+kind);
 const title=modal.querySelector('.dropdown-title');if(title){title.title=title.textContent;if(['agent-menu','service-menu'].includes(kind))title.remove();}
 if(kind==='account'){
  modal.classList.add('proto-compact-account');
  protoMenuSeparatorBefore(modal.querySelector('[data-action="sign-out"]'));
 }
 if(kind==='work-menu')for(const action of ['export','delete-work'])protoMenuSeparatorBefore(modal.querySelector('[data-action="'+action+'"]'));
 if(kind==='file-menu')for(const action of ['file-rename','file-delete'])protoMenuSeparatorBefore(modal.querySelector('[data-action="'+action+'"]'));
}
modalMarkup=function(){
 const html=protoOriginal.modalMarkup();if(!prototypeState.after||!html)return html;
 return protoFragment(html,fragment=>{
  const modal=fragment.querySelector('#modal');if(!modal)return;
  if(view.modal==='work-menu'){
   modal.querySelectorAll('.language-menu,[data-action="language"]').forEach(el=>el.remove());
   modal.querySelectorAll('[data-action="work-history"],[data-action="find-previous-export"],[data-action="pi-requests"]').forEach(el=>el.remove());
   const list=modal.querySelector('.menu-list');
   if(list)for(const action of ['settings','work-info','export','stop-work','delete-work']){const el=list.querySelector('[data-action="'+action+'"]');if(el)list.append(el);}
  }
  if(view.modal==='account'){
   const language=modal.querySelector('[data-action="language"]');
   if(language){language.removeAttribute('data-action');language.dataset.proto='account-language';language.classList.add('proto-language-trigger');language.setAttribute('aria-expanded',String(languagePicker.isOpen));}
  }
  if(view.modal==='account'&&adapter.state.core.role==='admin'&&adapter.hosted){
   const admin=modal.querySelector('[data-action="administration"],a[href="/admin"]');
   if(admin){const quick=document.createElement('a');quick.className='button';quick.href='/admin/setup';quick.target='_blank';quick.rel='noopener';quick.setAttribute('role','menuitem');quick.innerHTML=icon('settings',16)+' Quick Setup';admin.before(quick);}
  }
  if(view.modal==='service-menu'){
   modal.querySelectorAll('.menu-list [data-action]').forEach(el=>{if(!['copy-local','service-fullscreen'].includes(el.dataset.action))el.remove();});
   modal.querySelector('.modal-body > p.muted')?.remove();
  }
  if(view.modal==='agent-menu'){
   modal.querySelectorAll('[data-action="sessions"],[data-action="new-session"],[data-action="focus-chat"],[data-action="restore-layout"],[data-action="exit-service-focus"]').forEach(el=>el.remove());
   const entry=modal.querySelector('[data-action="pi-requests"]');if(entry){entry.innerHTML=icon('note',16)+' '+protoText('Agent 请求','Agent requests');entry.setAttribute('aria-label',protoText('此 Work 的 Agent 请求','Agent requests for this Work'));}
   if(!modal.querySelector('[data-action="reset-workspace-split"]')&&route()[0]==='work')modal.querySelector('.menu-list')?.insertAdjacentHTML('beforeend',btn(icon('reset',16)+' '+t('service.resetSplit'),'reset-workspace-split'));
  }
  if(view.modal==='service-details'){
   const fields=modal.querySelector('.property-list');
   if(fields){const copy=document.createElement('div');copy.className='proto-domain-copy';copy.innerHTML=btn(icon('copy',14)+' '+t('service.copyDomain'),'copy-domain','text-button');fields.after(copy);}
  }
  if(view.modal==='service-picker'){
   const w=current();if(!w)return;modal.classList.add('proto-service-popover','proto-service-'+prototypeState.variant);
   modal.classList.add('proto-compact-service');modal.classList.toggle('proto-compact-service-detail',prototypeState.detail);
   const title=modal.querySelector('#modal-title'),head=modal.querySelector('.modal-head');
   if(title){title.textContent=t('work.tabServices');title.classList.add('sr-only');if(head)head.replaceWith(title);}

   const body=modal.querySelector('.modal-body'),selected=w.services.find(s=>s.id===prototypeState.managed);
   if(body){
    if(prototypeState.detail&&selected)body.innerHTML=protoServiceInspector(w,selected);
    else body.innerHTML='<div class="proto-service-collection">'+protoServiceRows(w)+'</div>'+((prototypeState.variant!=='C'&&selected)?protoServiceInspector(w,selected):'');
   }
   const footer=modal.querySelector('.modal-footer');if(footer)footer.remove();
  }
  if(['account','work-menu','file-menu','service-menu','agent-menu'].includes(view.modal))protoCompactCommandMenu(modal,view.modal);
  if(view.modal==='connection'){
   modal.classList.add('proto-compact-connection');
   const slot=modal.querySelector('.core-check-slot'),head=modal.querySelector('.modal-head');
   if(slot&&head){const dots=slot.querySelector('.pending-dots');if(dots){const shape=document.createElement('span');shape.className='skeleton-fill proto-header-icon-skeleton';shape.setAttribute('aria-hidden','true');dots.replaceWith(shape);}slot.classList.add('proto-core-check-slot');head.insertBefore(slot,head.querySelector('[data-action="close-modal"]'));}

   const values=modal.querySelectorAll('.modal-body>dl>dd');
   values.forEach(value=>value.title=value.textContent.trim());
   if(values[1]&&adapter.state.lastChecked){const formatted=formatDateTime(adapter.state.lastChecked,{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});if(formatted)values[1].textContent=formatted;}
  }
  if(view.modal==='sessions'){
   modal.classList.add('proto-compact-sessions');
   const title=modal.querySelector('#modal-title'),head=modal.querySelector('.modal-head');if(title&&head){title.classList.add('sr-only');head.replaceWith(title);}
  }
  if(view.modal==='chat-response-settings')modal.classList.add('proto-compact-response-settings');
  if(view.modal==='chat-input-options'){
   modal.classList.add('proto-compact-input-options');modal.querySelector('.modal-footer')?.remove();
  }
  if(['pi-requests','pi-request-detail'].includes(view.modal)){
   modal.classList.add('proto-request-inspector');const title=modal.querySelector('#modal-title');if(title)title.textContent=view.modal==='pi-requests'?protoText('Agent 请求','Agent requests'):protoText('请求详情','Request details');
  }
 });
};
function protoOpenLanguage(trigger){
 if(view.modal!=='account')return;
 const parent=trigger.closest('#modal'),row=trigger.getBoundingClientRect(),menu=parent.getBoundingClientRect();
 languagePicker.open(trigger,{restoreFocus:()=>root.querySelector('#modal [data-proto="account-language"]')||root.querySelector('[data-action="account"]')});
 const panel=document.querySelector('.language-picker');if(!panel)return;
 panel.classList.add('proto-account-language');
 const width=panel.offsetWidth,height=panel.offsetHeight,gap=6,margin=8;
 const right=innerWidth-menu.right>=width+gap+margin;
 const left=Math.max(margin,Math.min(right?menu.right+gap:menu.left-width-gap,innerWidth-width-margin));
 const dock=document.querySelector('#prototype-controls')?.getBoundingClientRect();
 const bottom=Math.min(innerHeight-margin,dock?dock.top-margin:innerHeight-margin);
 panel.style.left=left+'px';panel.style.top=Math.max(margin,Math.min(row.top,bottom-height))+'px';
 trigger.dataset.submenuSide=right?'right':'left';panel.dataset.submenuSide=trigger.dataset.submenuSide;
}
function protoReviewText(){
 if(!prototypeState.after)return protoText('原版：当前源码页面与默认样式；数据为合成接口。','Original: current frontend and styles; synthetic API data.');
 if(route()[0]==='works')return protoText('本页调整：Work 图标与布局；账户 / Work 紧凑菜单。','Changes: Work icon, open action, List / Grid.');
 if(route()[2]==='settings')return protoText('本页调整：分类导航与间距；原有表单、状态、Save / Apply 保留。','Changes: navigation / spacing; existing forms and Save / Apply retained.');
 return protoText('本页调整：紧凑操作菜单；Files 左侧返回与单行 Header；Service 选择器；Chat 单入口。','Changes: Service selection / management, action locations, Chat heading.');
}
function protoDock(){
 const dock=document.querySelector('#prototype-controls');if(!dock)return;
 dock.innerHTML='<div class="proto-disclaimer"><strong>PROTOTYPE — NOT PRODUCTION</strong><span>'+protoText('真实页面代码 · 合成接口 · 不连接 Core','Real frontend · Synthetic API · No Core connection')+'</span></div><div class="proto-compare" role="group" aria-label="'+protoText('对照模式','Comparison mode')+'">'+protoButton(protoText('原版','Original'),'before','quiet small','aria-pressed="'+!prototypeState.after+'"')+protoButton(protoText('调整版','Proposed'),'after','quiet small','aria-pressed="'+prototypeState.after+'"')+'</div><nav aria-label="'+protoText('原型页面','Preview pages')+'">'+protoButton(protoText('首页','Works'),'home')+protoButton(protoText('工作台','Work'),'work')+protoButton(protoText('设置','Settings'),'settings')+protoButton(protoText('空态','Empty'),'empty')+'</nav><label class="proto-variant">'+protoText('Service 方案','Service option')+' <select name="prototype-variant" aria-label="'+protoText('Service 管理布局','Service management layout')+'">'+['A','B','C'].map((key,i)=>'<option value="'+key+'" '+(prototypeState.variant===key?'selected':'')+'>'+key+' '+[protoText('行菜单','Row'),protoText('分栏','Split'),protoText('行内','Inline')][i]+'</option>').join('')+'</select></label><details class="proto-review"><summary>'+protoText('改动范围','Scope')+'</summary><div><p>'+protoReviewText()+'</p><p>'+protoText('不模拟的接口会明确提示，不能据此推断功能被删除。Quick Setup 沿用现有流程，本原型仅展示入口。','Unsimulated APIs are disclosed. Quick Setup keeps its current flow; only its entry is previewed.')+'</p>'+protoButton(protoText('演示 Header 加载','Preview header loading'),'header-loading','quiet small')+'<br><a href="/__prototype/sources" target="_blank" rel="noopener">'+protoText('查看样式来源及校验值','Style sources and checksums')+'</a></div></details>';
}
render=function(...args){document.documentElement.classList.toggle('proto-after',prototypeState.after);const result=protoOriginal.render(...args);protoDock();return result;};
document.addEventListener('click',async event=>{
 const target=event.target.closest('[data-proto]');if(!target)return;
 event.preventDefault();event.stopImmediatePropagation();
 const action=target.dataset.proto;
 if(action==='account-language'){protoOpenLanguage(target);return;}
 if(action==='before'||action==='after'){prototypeState.after=action==='after';protoSetURL();render();return;}
 if(action==='grid'||action==='list'){prototypeState.grid=action==='grid';protoSetURL();render();return;}
 if(['home','work','settings','empty'].includes(action)){
  const go=async()=>{if(action==='home'||action==='empty'){await fetch('/__prototype/scenario',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene:action==='empty'?'empty':'normal'})});location.hash='/works';await adapter.listWorks();}else if(action==='settings'){location.hash='/work/work-1/settings';}else{location.hash='/work/work-1';view.tab='Services';}render();};
  await guard(go);return;
 }
 if(action==='header-loading'){
  const go=async()=>{await fetch('/__prototype/latency',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({delay:950})});closeModal(false);const target=route()[2]==='settings'?'/work/work-1':'/work/work-1/settings';location.hash=target;setTimeout(()=>{void fetch('/__prototype/latency',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({delay:0})});},2200);};
  await guard(go);return;
 }
 if(action==='inspect'){prototypeState.managed=prototypeState.managed===target.dataset.id?'':target.dataset.id;prototypeState.detail=false;render();return;}
 if(action==='service-detail'){prototypeState.managed=target.dataset.id;prototypeState.detail=true;render();const w=current();if(w)void adapter.readLogs(w.id,target.dataset.id).catch(()=>undefined);return;}
 if(action==='service-back'){prototypeState.detail=false;prototypeState.managed='';render();}
},true);
document.addEventListener('change',event=>{if(event.target.name==='prototype-variant'){prototypeState.variant=event.target.value;prototypeState.detail=false;prototypeState.managed='';protoSetURL();render();}},true);
document.addEventListener('click',event=>{if(event.target.closest('[data-action="service-picker"]')){prototypeState.detail=false;prototypeState.managed='';}},true);
window.__piworkPreview={state:prototypeState,adapter,render,view,original:protoOriginal};
if(!location.hash){const q=protoQuery.get('view');location.hash=q==='work'?'/work/work-1':q==='settings'?'/work/work-1/settings':'/works';}
onLocaleChange(protoDock);protoSetURL();render();

// ArrowRight enters the secondary list; ArrowLeft / Escape returns to its parent.
// The original language picker owns choices, storage, Up/Down, Enter and Escape.
document.addEventListener('keydown',event=>{
 if(!prototypeState.after)return;
 const trigger=event.target.closest?.('[data-proto="account-language"]');
 if(trigger&&event.key==='ArrowRight'){event.preventDefault();event.stopImmediatePropagation();protoOpenLanguage(trigger);return;}
 if(event.key==='ArrowLeft'&&event.target.closest?.('.proto-account-language')){event.preventDefault();event.stopImmediatePropagation();languagePicker.close(true);}
},true);

const protoLanguageStateObserver=new MutationObserver(()=>{
 if(!prototypeState.after)return;
 const trigger=root.querySelector('.proto-language-trigger');if(!trigger)return;
 trigger.setAttribute('aria-expanded',String(languagePicker.isOpen));
 const panel=document.querySelector('.proto-account-language');if(panel)trigger.dataset.submenuSide=panel.dataset.submenuSide;
});
protoLanguageStateObserver.observe(document.body,{childList:true,subtree:true});

// Optional deep link for reviewing the confirmed empty collection in the mock.
if(protoQuery.get('scene')==='empty')void fetch('/__prototype/scenario',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene:'empty'})}).then(()=>{if(adapter.state.signedIn)return adapter.listWorks();}).catch(()=>{});
