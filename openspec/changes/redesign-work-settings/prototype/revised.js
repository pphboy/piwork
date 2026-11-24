// Design prototype only. Every operation and runtime observation uses synthetic data.
const $ = selector => document.querySelector(selector);
const btn = (label,action,style='',attrs='') => '<button class="btn '+style+'" data-action="'+action+'" '+attrs+'>'+label+'</button>';
const emptyConfig = {skills:[],packages:[],agents:null};
const runtimeFor = config => ({confirmed:true,names:config.skills.map(s=>s.name)});
const state = {
  route:'settings',section:'skills',selected:'code-review',file:'SKILL.md',
  selectedBySection:{skills:'code-review',packages:'piwork-brain'},files:{'code-review':'SKILL.md'},filters:{skills:'',packages:''},
  draft:clone(initial),saved:clone(initial),active:clone(initial),serverSaved:clone(initial),serverActive:clone(initial),
  saving:false,applying:false,saveTarget:null,applyTarget:null,saveIssue:null,applyIssue:null,
  lifecycle:'running',workStatus:'ready',runtime:runtimeFor(initial),previousWork:null,
  scenario:'normal',catalogError:false,notice:null,undo:null,drawer:false
};
let epoch=0;
let menuTarget=null;
let menuAnchor=null;
let returnFocus=null;
let leaveAction=null;
const activeConfig=()=>state.active||emptyConfig;
const dirty=()=>!same(state.draft,state.saved);
const pending=()=>!same(state.saved,state.active);
const unknownSave=()=>!!state.saveIssue?.unknown;
const unknownApply=()=>!!state.applyIssue?.unknown;
const selectedSkill=()=>state.draft.skills.find(s=>s.name===state.selected);
const differences=(a,b)=>{
  const left=a||emptyConfig,right=b||emptyConfig;
  const names=new Set([...left.skills.map(s=>s.name),...right.skills.map(s=>s.name)]);
  const lines=[...names].filter(n=>!same(left.skills.find(s=>s.name===n),right.skills.find(s=>s.name===n))).map(n=>n+'：'+(!right.skills.some(s=>s.name===n)?'添加':!left.skills.some(s=>s.name===n)?'移除':'内容修改'));
  if(!same(left.packages,right.packages))lines.push('Pi Packages：配置修改');
  if(left.agents!==right.agents)lines.push('AGENTS.md：内容修改');
  return lines;
};
const canSave=()=>dirty()&&!state.saving&&!unknownSave();
const canApply=()=>pending()&&!state.saving&&!state.applying&&!dirty()&&!unknownSave()&&!unknownApply();
function clearResolvedFailures() {
  if(state.saveIssue&&!state.saveIssue.unknown&&!state.saving&&!dirty())state.saveIssue=null;
  if(state.applyIssue&&!state.applyIssue.unknown&&!state.applying&&!unknownSave()&&!pending()&&state.runtime.confirmed&&['ready','stopped'].includes(state.workStatus))state.applyIssue=null;
}
function header() {
  const labels={ready:'就绪',stopped:'已停止',initializing:'初始化中',failed:'运行失败',unknown:'状态未确认'};
  return '<header class="app-header"><div class="work-id"><img src="./piwork-logo.png" alt="Piwork"><strong>A</strong><span class="runtime '+(state.workStatus==='ready'?'':'unknown')+'" title="Work A 的运行状态"><i class="dot"></i>'+labels[state.workStatus]+'</span></div><nav class="app-nav" aria-label="Work 示例导航"><span>'+icon('grid')+'Services</span><span>'+icon('folder')+'Files</span><span>'+icon('chat')+'Chat</span></nav><span class="header-end">Work A</span></header>';
}
function editLabel() {
  if(unknownSave())return '保存结果未确认';
  if(state.saving)return same(state.draft,state.saveTarget)?'':'另有未保存更改';
  if(dirty())return '未保存';
  return '已保存';
}
function applyLabel() {
  if(unknownApply())return '应用结果未确认';
  if(state.applying)return !same(state.saved,state.applyTarget)?'另有已保存更改':'';
  if(!state.active)return '尚未应用';
  return pending()?'待应用':'已应用';
}
function changeDisclosure(label,lines,kind) {
  return '<details class="disclosure"><summary class="save-state" aria-label="'+label+'，查看'+kind+'">'+label+'</summary><div class="popover info-panel pending-review"><strong>'+kind+'</strong><ul class="change-list">'+lines.map(line=>'<li>'+esc(line)+'</li>').join('')+'</ul></div></details>';
}
function toolbarState() {
  if(!dirty()&&!pending()&&!state.saving&&!state.applying&&!state.saveIssue&&!state.applyIssue)return '<span class="save-state steady-state">所有更改已应用</span>';
  let editing=editLabel()?'<span class="save-state '+(unknownSave()?'unknown':dirty()?'dirty':'')+'">'+editLabel()+'</span>':'';
  let applying=applyLabel()?'<span class="save-state '+(unknownApply()?'unknown':'')+'">'+applyLabel()+'</span>':'';
  if(dirty()&&!state.saving&&!unknownSave())editing=changeDisclosure(editLabel(),differences(state.draft,state.saved),'未保存的更改');
  if(pending()&&!state.applying&&!unknownApply())applying=changeDisclosure(applyLabel(),differences(state.saved,state.active),'已保存，等待应用');
  let saveAction='',applyAction='';
  if(unknownSave())saveAction=btn('检查状态','check-result','primary','data-kind="save" aria-label="检查保存状态"');
  else if(dirty()||state.saving)saveAction=(!state.saving?btn('放弃更改','discard','quiet small','title="放弃所有未保存更改"'):'')+btn(state.saving?'<span class="spinner">'+icon('refresh')+'</span>保存中…':'保存全部','save','primary',state.saving?'disabled':'');
  if(unknownApply())applyAction=btn('检查状态','check-result',dirty()||unknownSave()?'':'primary','data-kind="apply" aria-label="检查应用状态"');
  const applyHint=state.applying?'正在应用已保存的更改':state.saving?'保存完成后可应用更改':unknownSave()?'先检查保存状态':'先保存未保存的更改';
  if(!unknownApply()&&(pending()||state.applying))applyAction=btn(state.applying?'<span class="spinner">'+icon('refresh')+'</span>应用中…':'应用更改','apply',dirty()||state.saving||unknownSave()?'':'primary',canApply()?'':'disabled title="'+applyHint+'"');
  return '<div class="state-part" data-state-part="editing" role="group" aria-label="保存状态">'+editing+saveAction+'</div><div class="state-part" data-state-part="application" role="group" aria-label="应用状态">'+applying+applyAction+'</div>';
}
function toolbar() {
  return '<div class="settings-toolbar"><div class="settings-title"><a class="back" href="#work" data-action="back-work" aria-label="返回 Work">'+icon('back')+'</a><button class="icon-button mobile-nav" data-action="open-navigation" aria-label="打开设置分类">'+icon('grid')+'</button><h1>Work 设置</h1></div><div id="toolbar-state" class="toolbar-state" aria-live="polite">'+toolbarState()+'</div></div>';
}
function categories() {
  return '<nav class="resource-rail category-nav" aria-label="设置分类">'+[['skills','Skills','skill'],['packages','Pi Packages','box'],['agents','AGENTS.md','file']].map(([id,label,glyph])=>'<a class="category-link '+(state.section===id?'selected':'')+'" href="#'+id+'" data-action="category" data-section="'+id+'" '+(state.section===id?'aria-current="page"':'')+'>'+icon(glyph)+'<span>'+label+'</span></a>').join('')+'</nav>';
}
function resourceFlags(item,saved,active) {
  let flags='';
  if(!same(item,saved))flags+='<span class="row-edit-status">'+(unknownSave()?'保存结果未确认':'未保存')+'</span>';
  const target=state.applyTarget?.[state.section]?.find(x=>x.name===item.name);
  if(unknownApply()&&!same(target,active))flags+='<span>应用结果未确认</span>';
  if((state.applying||unknownApply())&&!same(saved,target))flags+='<span>另有已保存更改</span>';
  else if(state.applying&&!same(target,active))flags+='<span>应用中</span>';
  else if(!unknownApply()&&!state.applying&&!same(saved,active))flags+='<span>待应用</span>';
  return flags?'<span class="row-flags">'+flags+'</span>':'';
}
function collection() {
  const kind=state.section,items=state.draft[kind],filter=state.filters[kind];
  const label=kind==='skills'?'Skills':'Pi Packages',action=kind==='skills'?'add-skill':'install-package';
  return '<aside class="collection-panel" aria-label="此 Work 的 '+label+'"><div class="collection-heading"><span>'+label+' <small>'+items.length+'</small></span>'+btn(icon('plus')+'添加',action,'quiet small','aria-label="'+(kind==='skills'?'添加 Skill':'安装包')+'" '+(unknownSave()?'disabled':''))+'</div><label class="search collection-search">'+icon('search')+'<input data-filter aria-label="查找当前分类" placeholder="查找'+(kind==='skills'?' Skill':'包')+'" value="'+esc(filter)+'"></label><div class="collection-items">'+items.filter(item=>item.name.includes(filter)||item.description.includes(filter)).map(item=>'<a class="collection-item '+(state.selected===item.name?'selected':'')+'" href="#'+kind+'/'+item.name+'" data-action="object" data-name="'+item.name+'" '+(state.selected===item.name?'aria-current="true"':'')+'><span class="collection-item-title">'+icon(kind==='skills'?'skill':'box')+'<strong>'+item.name+'</strong></span>'+resourceFlags(item,state.saved[kind].find(x=>x.name===item.name),activeConfig()[kind].find(x=>x.name===item.name))+'<span class="collection-description">'+item.description+'</span></a>').join('')+(items.length?'':'<p class="nav-empty">此 Work 尚未添加'+(kind==='skills'?' Skill':'包')+'。</p>')+'</div></aside>';
}
function mobileCollection() {
  const kind=state.section,items=state.draft[kind];
  return '<div class="mobile-collection"><label for="object-selector">'+(kind==='skills'?'Skill':'包')+'</label><select id="object-selector" aria-label="选择当前'+(kind==='skills'?' Skill':'包')+'" '+(!items.length?'disabled':'')+'>'+items.map(item=>'<option value="'+item.name+'" '+(item.name===state.selected?'selected':'')+'>'+item.name+'</option>').join('')+'</select>'+btn(icon('plus')+'添加',kind==='skills'?'add-skill':'install-package','quiet small',unknownSave()?'disabled':'')+'</div>';
}
function currentFileText() { return state.section==='agents'?state.draft.agents:selectedSkill()?.files[state.file]; }
function confirmedFileText() { return state.section==='agents'?state.saved.agents:state.saved.skills.find(s=>s.name===state.selected)?.files[state.file]; }
function fileStatus() {
  if(unknownSave()||state.saving){
    const captured=state.section==='agents'?state.saveTarget?.agents:state.saveTarget?.skills.find(s=>s.name===state.selected)?.files[state.file];
    if(captured===confirmedFileText()&&currentFileText()===captured)return '已保存';
    return currentFileText()===captured?(state.saving?'保存中…':'保存结果未确认'):'有新更改';
  }
  return currentFileText()===confirmedFileText()?'已保存':'未保存';
}
function objectToolbar() {
  let identity='',actions='';
  if(state.section==='skills'&&selectedSkill()){
    const s=selectedSkill();
    identity='<span class="parent-name">'+s.name+'</span><span class="slash">/</span><select id="file-selector" aria-label="选择 Skill 文件">'+Object.keys(s.files).map(path=>'<option value="'+esc(path)+'" '+(path===state.file?'selected':'')+'>'+esc(path)+'</option>').join('')+'</select><span class="file-save-state" data-file-status>'+fileStatus()+'</span>';
    actions='<button class="btn quiet resource-menu-trigger" id="skill-menu-trigger" data-action="skill-menu" data-name="'+s.name+'" aria-label="'+s.name+' 的 Skill 操作" aria-haspopup="menu" aria-expanded="false" aria-controls="skill-menu"><span>Skill 操作</span>'+icon('down')+'</button>';
  }else if(state.section==='agents'){
    identity='<span class="filename">AGENTS.md</span><span class="file-save-state" data-file-status>'+fileStatus()+'</span>';
    actions=btn(icon('file')+'导入文件','import-agents','quiet small',unknownSave()?'disabled':'');
  }else if(state.section==='packages'){
    identity='<span>'+esc(state.selected)+'</span>';
    actions=state.selected?btn('移除包','remove-package','quiet small danger','data-name="'+state.selected+'" '+(unknownSave()?'disabled':'')):'';
  }
  return '<div class="object-toolbar"><div class="file-identity">'+icon(state.section==='packages'?'box':'file')+'<h2>'+(identity||'Skills')+'</h2></div><div class="object-tools">'+actions+'</div></div>';
}
function codeEditor(text,kind) {
  return '<div class="code-area"><pre class="code-gutter" aria-hidden="true">'+text.split('\n').map((_,i)=>i+1).join('\n')+'</pre><textarea class="code-editor" data-editor="'+kind+'" aria-label="'+(kind==='agents'?'AGENTS.md':esc(state.selected+' / '+state.file))+' 内容" wrap="off" spellcheck="false">'+esc(text)+'</textarea></div>';
}
function packageContent() {
  const p=state.draft.packages.find(x=>x.name===state.selected);
  if(!p)return emptyContent('安装 Pi Package','从 Core 包库添加此 Work 需要的包。','install-package');
  const saved=state.saved.packages.find(x=>x.name===p.name),active=activeConfig().packages.find(x=>x.name===p.name);
  return '<div class="package-content"><h3>'+p.name+'</h3><p>'+p.description+'</p><dl class="package-definition"><dt>来源</dt><dd>'+p.source+'</dd><dt>编辑设置</dt><dd><label class="check-field"><input type="checkbox" data-package="'+p.name+'" '+(p.enabled?'checked':'')+'>在当前 Work 启用</label></dd><dt>'+(unknownSave()?'上次确认的保存':'已保存设置')+'</dt><dd>'+(!saved?'尚未添加':saved.enabled?'启用':'停用')+'</dd><dt>'+(unknownApply()?'上次确认的应用':'已应用设置')+'</dt><dd>'+(!state.active?'尚未应用':!active?'未包含此包':active.enabled?'启用':'停用')+'</dd></dl></div>';
}
function emptyContent(title,body,action){return '<div class="resource-empty"><div><h2>'+title+'</h2><p>'+body+'</p>'+btn(icon('plus')+(action==='install-package'?'安装包':'添加 Skill'),action)+'</div></div>';}
function feedback() {
  let html='';
  for(const [kind,issue] of [['save',state.saveIssue],['apply',state.applyIssue]]){
    if(!issue)continue;
    html+='<div class="local-feedback '+(issue.unknown?'unknown':'error')+'" role="'+(issue.unknown?'status':'alert')+'">'+icon('info')+'<span class="feedback-copy"><strong>'+issue.title+'</strong>'+issue.message+'</span><span class="feedback-actions">'+btn(issue.unknown?'检查状态':(kind==='save'?'重试保存':'重试应用'),issue.unknown?'check-result':kind==='save'?'save':'apply','quiet small','data-kind="'+kind+'" '+(issue.unknown?'aria-label="'+(kind==='save'?'检查保存状态':'检查应用状态')+'" ':'')+((kind==='apply'&&!issue.unknown&&!canApply())?'disabled title="先保存未保存的更改"':''))+'</span></div>';
  }
  if(state.notice)html+='<div class="local-feedback" role="status"><span class="feedback-copy">'+esc(state.notice)+'</span><span class="feedback-actions">'+(state.undo?btn('撤销','undo','quiet small'):'')+'<button class="icon-button" data-action="dismiss-notice" aria-label="关闭操作反馈">'+icon('close')+'</button></span></div>';
  return html;
}
function editorPanel() {
  let body='';
  if(state.section==='skills'){
    const s=selectedSkill();
    if(s){if(!(state.file in s.files))state.file='SKILL.md';body=codeEditor(s.files[state.file],'skill');}
    else body=emptyContent('为此 Work 添加 Skill','添加后可直接编辑 SKILL.md 和配套文件。','add-skill');
  }
  if(state.section==='agents')body=codeEditor(state.draft.agents,'agents')+'<input id="agents-import" type="file" accept=".md,.txt,text/plain,text/markdown" hidden>';
  if(state.section==='packages')body=packageContent();
  return '<section class="work-content" aria-label="当前对象编辑区">'+(state.section==='agents'?'':mobileCollection())+objectToolbar()+body+'<div id="feedback-slot">'+feedback()+'</div><footer class="editor-footer"><span>'+(state.section==='packages'?'修改后保存并应用':'UTF-8')+'</span><kbd>Ctrl / ⌘ + S 保存全部</kbd><span class="cursor-position" id="cursor-position">'+(state.section==='packages'?'':'第 1 行，第 1 列')+'</span></footer></section>';
}
const scenarios=[['normal','全部已应用'],['dirty','未保存'],['pending','已保存，待应用'],['mixed','未保存 + 待应用'],['other-file','另一个文件未保存'],['save-failure','保存失败'],['save-unknown','保存结果未确认'],['applying','应用中'],['apply-failure','应用失败'],['apply-unknown','应用结果未确认'],['stopped','Work 已停止'],['stopped-pending','已停止，有待应用更改'],['not-applied','尚未应用'],['catalog-failure','Skill 列表加载失败']];
const debugState=()=>JSON.stringify({section:state.section,selected:state.selected,file:state.file,unsaved:dirty(),pendingApply:pending(),saving:state.saving,applying:state.applying,saveIssue:state.saveIssue,applyIssue:state.applyIssue,workStatus:state.workStatus,runtime:state.runtime,draft:state.draft,saved:state.saved,active:state.active},null,2);
function dock(){return '<footer class="prototype-dock"><div class="prototype-label"><span class="english-label">PROTOTYPE — NOT PRODUCTION</span><span>设计原型 · 示例数据</span></div><div class="prototype-tools"><label><span>状态场景</span><select id="scenario" aria-label="原型状态场景" title="切换场景会重置示例数据">'+scenarios.map(([id,label])=>'<option value="'+id+'" '+(state.scenario===id?'selected':'')+'>'+label+'</option>').join('')+'</select></label><details class="disclosure"><summary aria-label="查看原型状态">状态</summary><div class="popover"><pre id="prototype-state">'+esc(debugState())+'</pre></div></details><button data-action="reset">重置</button></div></footer>';}
function render(){
  clearResolvedFailures();
  const focused=document.activeElement;
  const cursor=focused?.matches('[data-editor]')?{kind:focused.dataset.editor,start:focused.selectionStart,end:focused.selectionEnd,scroll:focused.scrollTop}:null;
  closeMenu(false);hideInfo();
  $('#app').innerHTML=header()+(state.route==='settings'?'<section class="settings-shell">'+toolbar()+'<div class="settings-body">'+categories()+'<main class="category-content '+(state.section==='agents'?'single-editor':'')+'" aria-label="'+(state.section==='skills'?'Skills':state.section==='packages'?'Pi Packages':'AGENTS.md')+' 设置">'+(state.section==='agents'?'':collection())+editorPanel()+'</main></div></section>':'<div class="work-placeholder"><div><h2>Work A</h2><p>Work 页面示意</p>'+btn('返回设置','open-settings','primary')+'</div></div>')+dock();
  const editor=$('[data-editor]');if(cursor&&editor&&editor.dataset.editor===cursor.kind){editor.focus({preventScroll:true});editor.setSelectionRange(cursor.start,cursor.end);editor.scrollTop=cursor.scroll;}
}
function refresh(){
  clearResolvedFailures();
  if($('#toolbar-state'))$('#toolbar-state').innerHTML=toolbarState();
  if($('#feedback-slot'))$('#feedback-slot').innerHTML=feedback();
  if($('[data-file-status]'))$('[data-file-status]').textContent=fileStatus();
  if($('#prototype-state'))$('#prototype-state').textContent=debugState();
  const rail=$('.collection-panel');if(rail){const pos=rail.scrollTop;rail.outerHTML=collection();$('.collection-panel').scrollTop=pos;}
  if($('.app-header'))$('.app-header').outerHTML=header();
}
function closeNavigation(){$('#navigation-dialog').close();state.drawer=false;}
function openNavigation(){
  $('#navigation-dialog').innerHTML='<div class="dialog-header"><a class="back" href="#work" data-action="back-work" aria-label="返回 Work">'+icon('back')+'</a><h2 id="navigation-title">设置分类</h2><button class="icon-button" data-action="close-navigation" aria-label="关闭设置分类">'+icon('close')+'</button></div>'+categories();
  if(!$('#navigation-dialog').open)$('#navigation-dialog').showModal();state.drawer=true;
}
function showDialog(title,description,body,footer){
  const focused=menuAnchor?.isConnected?menuAnchor:document.activeElement;
  closeMenu(false);hideInfo();closeNavigation();document.querySelectorAll('details[open]').forEach(d=>d.open=false);returnFocus=focused;
  $('#dialog').innerHTML='<div class="dialog-header"><div><h2 id="dialog-title">'+title+'</h2>'+(description?'<p>'+description+'</p>':'')+'</div><button class="icon-button" data-action="close-dialog" aria-label="关闭">'+icon('close')+'</button></div><div class="dialog-content">'+body+'</div><div class="dialog-footer">'+footer+'</div>';
  if(!$('#dialog').open)$('#dialog').showModal();
}
function closeDialog(){$('#dialog').close();if(returnFocus?.isConnected)returnFocus.focus();}
function positionFloating(element,anchor){
  const box=anchor.getBoundingClientRect(),width=Math.min(292,innerWidth-24);element.style.width=width+'px';
  element.style.left=Math.max(12,Math.min(box.right-width,innerWidth-width-12))+'px';
  element.style.top=Math.max(8,Math.min(box.bottom+6,innerHeight-element.offsetHeight-12))+'px';
}
function closeMenu(restore=true){
  const menu=$('#skill-menu');if(!menu)return;menu.hidden=true;menu.innerHTML='';
  if(menuAnchor?.isConnected){menuAnchor.setAttribute('aria-expanded','false');if(restore)menuAnchor.focus();}
  menuTarget=null;menuAnchor=null;
}
function openMenu(anchor){
  const name=anchor.dataset.name;if(menuTarget===name){closeMenu();return;}closeMenu(false);hideInfo();
  menuTarget=name;menuAnchor=anchor;anchor.setAttribute('aria-expanded','true');
  $('#skill-menu').setAttribute('aria-label',name+' 的 Skill 操作');
  $('#skill-menu').innerHTML='<div class="menu-heading"><strong>'+name+'</strong><span>当前 Work：A</span></div><button class="menu-item" role="menuitem" tabindex="-1" data-action="skill-info" data-name="'+name+'">'+icon('info')+'<span>查看详情</span></button><div role="separator" class="menu-separator"></div><button class="menu-item danger" role="menuitem" tabindex="-1" data-action="remove" data-name="'+name+'" '+(unknownSave()?'disabled':'')+'>'+icon('close')+'<span>从此 Work 移除<small>保存并应用后生效</small></span></button>';
  $('#skill-menu').hidden=false;positionFloating($('#skill-menu'),anchor);$('#skill-menu [role="menuitem"]:not(:disabled)').focus();
}
function hideInfo(restore=false){const panel=$('#resource-info');if(panel?.matches(':popover-open'))panel.hidePopover();if(restore)$('#skill-menu-trigger')?.focus();}
function showInfo(name){
  closeMenu(false);const s=state.draft.skills.find(x=>x.name===name),saved=state.saved.skills.find(x=>x.name===name),active=activeConfig().skills.find(x=>x.name===name);
  const loaded=state.workStatus==='stopped'?'未加载，Work 已停止':!state.runtime.confirmed?'加载状态未确认':state.runtime.names.includes(name)?'已加载上次应用的内容':'未加载';
  const capturedSkill=state.saveTarget?.skills.find(x=>x.name===name);
  const unchangedBySave=same(s,saved)&&same(capturedSkill,saved);
  const saveText=(unknownSave()||state.saving)&&unchangedBySave?'已保存':unknownSave()?'保存结果未确认':state.saving?'保存中…':!same(s,saved)?'未保存':'已保存';
  const target=state.applyTarget?.skills.find(x=>x.name===name);
  const applyText=unknownApply()?'应用结果未确认':state.applying?(!same(saved,target)?'应用中，另有已保存更改':'应用中…'):!state.active?'尚未应用':!same(saved,active)?'待应用':'已应用';
  $('#resource-info').innerHTML='<div class="info-title"><strong id="info-title">'+name+'</strong><button class="icon-button" data-action="close-info" aria-label="关闭 Skill 详情">'+icon('close')+'</button></div><p>'+s.description+'</p><dl><dt>保存状态</dt><dd>'+saveText+'</dd><dt>应用状态</dt><dd>'+applyText+'</dd><dt>加载状态</dt><dd>'+loaded+'</dd><dt>作用范围</dt><dd>Work A，共 '+Object.keys(s.files).length+' 个文件</dd></dl>';
  $('#resource-info').showPopover();const anchor=$('#skill-menu-trigger');if(anchor)positionFloating($('#resource-info'),anchor);$('#resource-info [data-action="close-info"]').focus();
}
function addDialog(){
  const available=templates.filter(s=>!state.draft.skills.some(x=>x.name===s.name));
  const body=state.catalogError?'<div class="catalog-error"><strong>无法加载可用 Skills</strong><p>已添加的 Skills 和未保存的更改仍保留。</p>'+btn('重新加载','retry-catalog')+'</div>':available.length?available.map(s=>'<label class="catalog-row"><input type="checkbox" name="catalog-skill" value="'+s.name+'"><span><strong>'+s.name+'</strong><small>'+s.description+'</small></span></label>').join(''):'<p>所有可用 Skills 均已添加到此 Work。</p>';
  showDialog('添加 Skill','添加到 Work A 后，可直接编辑内容。',body,btn('取消','close-dialog')+btn('添加所选 Skill','confirm-add','primary','disabled'));
}
function snapshotUndo(){state.undo={draft:clone(state.draft),section:state.section,selected:state.selected,file:state.file};}
function save(after,mode='normal'){
  if(!canSave())return;const captured=clone(state.draft),started=epoch;state.saving=true;state.saveTarget=captured;state.saveIssue=null;state.notice=null;state.undo=null;refresh();
  setTimeout(()=>{
    if(started!==epoch)return;state.saving=false;
    if(mode==='save-failure')state.saveIssue={unknown:false,title:'保存失败',message:'无法连接 Core，未保存的更改仍保留在此页。'};
    else{state.serverSaved=captured;if(mode==='save-unknown')state.saveIssue={unknown:true,title:'保存结果未确认',message:'暂时无法确认是否保存成功，编辑内容仍保留在此页。'};else state.saved=captured;}
    render();if(after&&!state.saveIssue)after();
  },500);
}
function apply(mode='normal'){
  if(!canApply())return;const captured=clone(state.saved),started=epoch;
  state.applying=true;state.applyTarget=captured;state.applyIssue=null;state.notice=null;state.previousWork={workStatus:state.workStatus,runtime:clone(state.runtime)};
  if(state.lifecycle==='running'){state.workStatus='initializing';state.runtime={confirmed:false,names:[]};}refresh();
  setTimeout(()=>{
    if(started!==epoch)return;state.applying=false;
    if(mode==='apply-failure'){
      state.workStatus=state.previousWork.workStatus;state.runtime=clone(state.previousWork.runtime);
      state.applyIssue={unknown:false,title:'上次应用失败',message:state.active?'code-review 加载失败，Work 已恢复原设置。':'code-review 加载失败，尚无已应用的设置。'};
    }else{
      state.serverActive=captured;
      if(mode==='apply-unknown'){state.workStatus='unknown';state.runtime={confirmed:false,names:[]};state.applyIssue={unknown:true,title:'应用结果未确认',message:'暂时无法确认是否应用成功，已保存的设置仍保留。'};}
      else{state.active=captured;state.workStatus=state.lifecycle==='stopped'?'stopped':'ready';state.runtime=state.lifecycle==='stopped'?{confirmed:true,names:[]}:runtimeFor(captured);}
    }
    render();
  },1200);
}
function checkResult(kind){
  if(kind==='save'&&unknownSave()){state.saved=clone(state.serverSaved);state.saveIssue=null;}
  if(kind==='apply'&&unknownApply()){state.active=clone(state.serverActive);state.applyIssue=null;state.workStatus=state.lifecycle==='stopped'?'stopped':'ready';state.runtime=state.lifecycle==='stopped'?{confirmed:true,names:[]}:runtimeFor(state.active);}
  render();
}
function reset(){
  epoch++;closeMenu(false);hideInfo();closeDialog();closeNavigation();
  Object.assign(state,{route:'settings',section:'skills',selected:'code-review',file:'SKILL.md',selectedBySection:{skills:'code-review',packages:'piwork-brain'},files:{'code-review':'SKILL.md'},filters:{skills:'',packages:''},draft:clone(initial),saved:clone(initial),active:clone(initial),serverSaved:clone(initial),serverActive:clone(initial),saving:false,applying:false,saveTarget:null,applyTarget:null,saveIssue:null,applyIssue:null,lifecycle:'running',workStatus:'ready',runtime:runtimeFor(initial),previousWork:null,notice:null,undo:null,scenario:'normal',catalogError:false});render();
}
function loadScenario(name){
  reset();state.scenario=name;
  if(!['normal','stopped','catalog-failure','other-file'].includes(name))state.draft.skills[0].files['SKILL.md']+='\n- 审查建议应包含可验证的修改方式。\n';
  if(['pending','mixed','applying','apply-failure','apply-unknown','stopped-pending'].includes(name))state.saved=clone(state.draft);
  if(name==='mixed')state.draft.skills[0].files['SKILL.md']+='\n- 将需要确认的问题单独列出。\n';
  if(name==='other-file')state.draft.skills[0].files['references/checklist.md']+='\n- 检查失败后是否保留了用户输入。\n';
  if(name==='stopped'||name==='stopped-pending'){state.lifecycle='stopped';state.workStatus='stopped';state.runtime={confirmed:true,names:[]};}
  if(name==='not-applied'){state.active=null;state.serverActive=null;state.workStatus='failed';state.runtime={confirmed:true,names:[]};state.saved=clone(state.draft);}
  state.serverSaved=clone(state.saved);render();
  if(name==='save-failure'||name==='save-unknown')save(null,name);
  if(name==='apply-failure'||name==='apply-unknown')apply(name);
  if(name==='applying')apply();
  if(name==='catalog-failure'){state.catalogError=true;addDialog();}
}
function navigate(section,name,path){
  state.section=section;
  if(section!=='agents'){
    const items=state.draft[section];state.selected=name||state.selectedBySection[section];if(!items.some(i=>i.name===state.selected))state.selected=items[0]?.name||'';state.selectedBySection[section]=state.selected;
    if(section==='skills'){state.file=path||state.files[state.selected]||'SKILL.md';state.files[state.selected]=state.file;}
  }
  const url=new URL(location.href);url.hash=section+(section==='agents'?'':'/'+state.selected)+(section==='skills'?'/'+state.file:'');history.replaceState(null,'',url);closeNavigation();render();
}
document.addEventListener('click',event=>{
  const target=event.target.closest('[data-action]');if(!target||target.disabled)return;event.preventDefault();
  const action=target.dataset.action,name=target.dataset.name,kind=target.dataset.kind;
  if(action==='category')navigate(target.dataset.section);
  if(action==='object')navigate(state.section,name);
  if(action==='open-navigation')openNavigation();if(action==='close-navigation')closeNavigation();
  if(action==='close-dialog')closeDialog();if(action==='reset')reset();
  if(action==='save')save();if(action==='apply')apply();if(action==='check-result')checkResult(kind);
  if(action==='skill-menu')openMenu(target);if(action==='skill-info')showInfo(name);if(action==='close-info')hideInfo(true);
  if(action==='add-skill')addDialog();if(action==='retry-catalog'){state.catalogError=false;addDialog();}
  if(action==='confirm-add'){
    const names=[...document.querySelectorAll('[name="catalog-skill"]:checked')].map(i=>i.value);names.forEach(id=>state.draft.skills.push(clone(templates.find(s=>s.name===id))));state.notice=null;closeDialog();navigate('skills',names[0],'SKILL.md');
  }
  if(action==='remove'||action==='remove-package'){
    closeMenu(false);snapshotUndo();const section=action==='remove'?'skills':'packages';state.draft[section]=state.draft[section].filter(item=>item.name!==name);state.notice='已移除 '+name+'，尚未保存。';navigate(section);
  }
  if(action==='undo'&&state.undo){const undo=state.undo;Object.assign(state,{draft:undo.draft,section:undo.section,selected:undo.selected,file:undo.file,notice:null,undo:null});render();}
  if(action==='dismiss-notice'){state.notice=null;state.undo=null;refresh();}
  if(action==='discard')showDialog('放弃所有未保存更改？','','<p>将恢复为上次保存的内容。已保存、待应用的更改会保留。</p>',btn('继续编辑','close-dialog')+btn('放弃更改','confirm-discard','danger'));
  if(action==='confirm-discard'){state.draft=clone(state.saved);state.saveIssue=null;state.notice=null;state.undo=null;closeDialog();render();}
  if(action==='install-package')showDialog('安装 Pi Package','添加示例包到此 Work。','<p><strong>research-tools</strong><br>检索和资料整理工具 · Core 包库</p>',btn('取消','close-dialog')+btn('添加到 Work','confirm-package','primary',state.draft.packages.some(p=>p.name==='research-tools')?'disabled':''));
  if(action==='confirm-package'){state.draft.packages.push({name:'research-tools',description:'检索和资料整理工具',source:'Core 包库',enabled:true});closeDialog();navigate('packages','research-tools');}
  if(action==='import-agents')$('#agents-import').click();
  if(action==='open-settings'){state.route='settings';render();}
  if(action==='back-work'){
    leaveAction=()=>{closeNavigation();state.route='work';render();};
    if(!dirty()&&!unknownSave()&&!unknownApply())leaveAction();
    else if(unknownSave()||unknownApply())showDialog(unknownSave()?'保存结果未确认':'应用结果未确认','','<p>编辑内容仍保留在此页。请先检查状态，再离开设置。</p>',btn('返回设置','close-dialog'));
    else showDialog('有更改尚未保存','','<p>保存不会自动应用更改。</p>',btn('继续编辑','close-dialog')+btn('放弃并离开','leave-discard','danger')+btn('保存并离开','leave-save','primary'));
  }
  if(action==='leave-discard'){state.draft=clone(state.saved);state.saveIssue=null;state.notice=null;state.undo=null;closeDialog();leaveAction();}
  if(action==='leave-save'){closeDialog();save(leaveAction);}
});
document.addEventListener('input',event=>{
  const target=event.target;
  if(target.matches('[data-editor]')){
    if(target.dataset.editor==='agents')state.draft.agents=target.value;else selectedSkill().files[state.file]=target.value;
    state.notice=null;state.undo=null;$('.code-gutter').textContent=target.value.split('\n').map((_,i)=>i+1).join('\n');refresh();
  }
  if(target.matches('[data-filter]')){const pos=target.selectionStart;state.filters[state.section]=target.value;const panel=$('.collection-panel');panel.outerHTML=collection();const input=$('[data-filter]');input.focus();input.setSelectionRange(pos,pos);}
});
document.addEventListener('change',async event=>{
  const target=event.target;
  if(target.id==='scenario')loadScenario(target.value);
  if(target.id==='object-selector')navigate(state.section,target.value);
  if(target.id==='file-selector')navigate('skills',state.selected,target.value);
  if(target.name==='catalog-skill'){const count=document.querySelectorAll('[name="catalog-skill"]:checked').length;const button=$('[data-action="confirm-add"]');button.disabled=!count;button.textContent=count?'添加 '+count+' 个 Skill':'添加所选 Skill';}
  if(target.matches('[data-package]')){state.draft.packages.find(p=>p.name===target.dataset.package).enabled=target.checked;refresh();}
  if(target.id==='agents-import'&&target.files[0]){state.draft.agents=await target.files[0].text();render();}
});
document.addEventListener('keydown',event=>{
  const menu=$('#skill-menu');
  if(!menu.hidden){
    const items=[...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')],index=items.indexOf(document.activeElement);
    if(event.key==='Escape'){event.preventDefault();closeMenu();return;}
    if(event.key==='Tab'){closeMenu();return;}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next].focus();return;}
  }
  if(event.key==='Escape'&&$('#resource-info').matches(':popover-open')){event.preventDefault();hideInfo(true);return;}
  if(event.target.matches('#skill-menu-trigger')&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();openMenu(event.target);if(event.key==='ArrowUp')[...$('#skill-menu').querySelectorAll('[role="menuitem"]:not(:disabled)')].at(-1)?.focus();return;}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();if(!$('#dialog').open)save();}
  if(event.key==='Escape')document.querySelectorAll('details[open]').forEach(d=>d.open=false);
});
document.addEventListener('click',event=>{
  if(!$('#skill-menu').hidden&&!$('#skill-menu').contains(event.target)&&!event.target.closest('[data-action="skill-menu"]'))closeMenu(false);
  document.querySelectorAll('details[open]').forEach(d=>{if(!d.contains(event.target))d.open=false;});
});
document.addEventListener('scroll',event=>{if(event.target.matches?.('[data-editor]'))$('.code-gutter').scrollTop=event.target.scrollTop;},true);
document.addEventListener('selectionchange',()=>{const area=document.activeElement;if(!area?.matches('[data-editor]')||!$('#cursor-position'))return;const before=area.value.slice(0,area.selectionStart).split('\n');$('#cursor-position').textContent='第 '+before.length+' 行，第 '+(before.at(-1).length+1)+' 列';});
$('#navigation-dialog').addEventListener('close',()=>state.drawer=false);
window.addEventListener('resize',()=>{closeMenu(false);hideInfo();});
window.addEventListener('beforeunload',event=>{if(dirty()||unknownSave()||unknownApply()){event.preventDefault();event.returnValue='';}});
const route=location.hash.slice(1).split('/');
if(route[0]==='agents')state.section='agents';
if(route[0]==='skills'&&initial.skills.some(s=>s.name===route[1])){state.selected=route[1];state.selectedBySection.skills=route[1];const path=route.slice(2).join('/');if(path&&path in selectedSkill().files)state.file=path;}
if(route[0]==='packages'&&initial.packages.some(p=>p.name===route[1])){state.section='packages';state.selected=route[1];state.selectedBySection.packages=route[1];}
render();
