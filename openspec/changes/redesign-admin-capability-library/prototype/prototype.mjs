/* Selected design: B, Skill -> inline file tree -> raw-text editor.
   Save applies to the current file. Shared Piwork colors remain unchanged.
   All mutations are in memory. File contents are never sent over the network. */
const $ = (selector) => document.querySelector(selector);
const app = $('#app');
const flowDialog = $('#flow-dialog');
const unsavedDialog = $('#unsaved-dialog');
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
  folder:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z"/><path d="M3 10h18"/>',
  skill:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z"/><path d="m12 10-1 3h3l-1 3"/>',
  box:'<path d="m12 3 9 5v9l-9 5-9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v9M8 5l9 5"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 3M18 18A8 8 0 0 1 5 15"/>',
  search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  chevron:'<path d="m9 5 6 7-6 7"/>',
  left:'<path d="m15 5-6 7 6 7"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  file:'<path d="M5 3h9l5 5v13H5Z"/><path d="M14 3v5h5M8 12h8M8 16h6"/>',
  settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  warning:'<path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3h.01"/>',
  copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  more:'<circle cx="5" cy="12" r=".9"/><circle cx="12" cy="12" r=".9"/><circle cx="19" cy="12" r=".9"/>',
};
const icon = (name, size = 18, css = '') => `<svg class="${css}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.box}</svg>`;
const button = (label, action, css = '', attrs = '') => `<button type="button" class="btn ${css}" data-action="${action}" ${attrs}>${label}</button>`;
const bytes = (number) => number < 1024 ? `${number} B` : number < 1048576 ? `${(number / 1024).toFixed(1)} KiB` : `${(number / 1048576).toFixed(1)} MiB`;
const kindIcon = (kind, size = 19) => `<span class="kind-icon ${kind === 'package' ? 'package' : ''}">${icon(kind === 'skill' ? 'skill' : 'box', size)}</span>`;
const status = (item) => `<span class="status ${item.enabled ? '' : 'disabled'}">${item.enabled ? '已启用' : '已禁用'}</span>`;
const itemKey = (item) => `${item.kind}:${item.name}`;
let tab = new URL(location.href).searchParams.get('type') === 'packages' ? 'package' : 'skill';
let query = '', selected = null, detailError = '';
let noticeTimer, flow = null, operation = null, mockSequence = 0, mobileDetail = false;
let editor = null, expandedSkill = null, pendingTransition = null;
const scheme = '3';
let menuOwnerKey=null,menuTrigger=null;
let defaultsView = new URL(location.href).searchParams.get('view') === 'defaults' && scheme === '3';
let defaultsSurface = '', defaultDraft = null;
let defaultOrder = ['skill:code-review','skill:frontend-design','package:@piwork/developer-tools'];
const openFolders = new Set();
const fileStore = new Map();
const utf8 = new TextEncoder();
const catalog = [
  {kind:'skill',name:'browser-tools',enabled:true,isDefault:false,files:12,size:88576,created:'2026-11-12 14:32',updated:'2026-11-16 09:41'},
  {kind:'skill',name:'code-review',enabled:true,isDefault:true,files:8,size:45260,created:'2026-11-10 10:24',updated:'2026-11-16 16:25'},
  {kind:'skill',name:'document-writing',enabled:true,isDefault:false,files:5,size:21811,created:'2026-11-11 09:18',updated:'2026-11-15 11:09'},
  {kind:'skill',name:'frontend-design',enabled:true,isDefault:true,files:6,size:36966,created:'2026-11-11 15:40',updated:'2026-11-17 09:12'},
  {kind:'skill',name:'legacy-notes',enabled:false,isDefault:false,files:2,size:5837,created:'2026-10-28 17:30',updated:'2026-11-08 15:36'},
  {kind:'package',name:'@piwork/developer-tools',version:'1.4.0',source:'npm',resolvedSource:'npm:@piwork/developer-tools@1.4.0',enabled:true,isDefault:true,resources:{extensions:2,skills:3,prompts:2,themes:0}},
  {kind:'package',name:'research-kit',version:'0.8.2',source:'Git',resolvedSource:'https://github.com/example/research-kit.git#v0.8.2',enabled:true,isDefault:false,resources:{extensions:1,skills:2,prompts:1,themes:0}},
  {kind:'package',name:'team-prompts',version:null,source:'本地目录',resolvedSource:'上传的本地目录',enabled:false,isDefault:false,resources:{extensions:0,skills:0,prompts:5,themes:0}},
];
const findSelected = () => catalog.find(item => itemKey(item) === selected);
const count = (kind) => catalog.filter(item => item.kind === kind).length;
const filtered = (kind) => catalog.filter(item => item.kind === kind && item.name.toLowerCase().includes(query.toLowerCase())).sort((a,b) => a.name.localeCompare(b.name));

function currentDefaultKeys() {
  const actual=catalog.filter(item=>item.isDefault).map(itemKey);
  return [...defaultOrder.filter(key=>actual.includes(key)),...actual.filter(key=>!defaultOrder.includes(key))];
}
const defaultsDirty = () => !!defaultDraft && JSON.stringify(defaultDraft)!==JSON.stringify(currentDefaultKeys());

function applyDefaultKeys(keys) {
  if(keys.some(key=>!catalog.find(item=>itemKey(item)===key)?.enabled)) { toast('请先启用所选能力，再加入默认选择。'); return false; }
  for(const item of catalog)item.isDefault=keys.includes(itemKey(item));
  defaultOrder=[...keys]; return true;
}

function schemeSwitcher() {
  document.querySelector('a.brand').href='/admin/packages?v=6';
}

function defaultChoices(kind) {
  return `<div class="default-choice-list">${catalog.filter(item=>item.kind===kind).sort((a,b)=>a.name.localeCompare(b.name)).map(item=>`<label class="default-choice ${item.enabled?'':'unavailable'}"><input type="checkbox" data-default-choice="${escapeHTML(itemKey(item))}" ${defaultDraft?.includes(itemKey(item))?'checked':''} ${!item.enabled?'disabled':''}><span>${escapeHTML(item.name)}</span><small>${!item.enabled?'已禁用':''}</small></label>`).join('')}</div>`;
}

function defaultOrderRows(kind) {
  const keys=(defaultDraft||[]).filter(key=>catalog.some(item=>itemKey(item)===key&&item.kind===kind));
  return keys.length?`<ol class="default-order-list">${keys.map((key,index)=>{const item=catalog.find(item=>itemKey(item)===key);return `<li><span class="order-index">${index+1}</span><span class="order-name">${escapeHTML(item.name)}</span><span class="order-actions">${button('上移','move-default','ghost',`data-key="${escapeHTML(key)}" data-direction="up" aria-label="上移 ${escapeHTML(item.name)}" ${index===0?'disabled':''}`)}${button('下移','move-default','ghost',`data-key="${escapeHTML(key)}" data-direction="down" aria-label="下移 ${escapeHTML(item.name)}" ${index===keys.length-1?'disabled':''}`)}</span></li>`;}).join('')}</ol>`:'<p class="default-empty">未选择，新增 Work 时不会默认使用。</p>';
}

function defaultConfigBody() {
  return `<p class="defaults-scope">只影响之后新建的 Work，已有 Work 保持原配置。</p><div class="default-config-grid"><section><h3>选择 Skills</h3>${defaultChoices('skill')}<h3 class="default-package-title">选择 Packages</h3>${defaultChoices('package')}</section><section class="default-selected"><h3>Skills 的使用顺序</h3>${defaultOrderRows('skill')}<h3 class="default-package-title">默认 Packages</h3>${defaultOrderRows('package')}</section></div>`;
}

function renderDefaultsDialog() {
  flow=null;
  flowShell('新 Work 默认','选择新建 Work 时自动使用的能力。',defaultConfigBody(),`<span class="defaults-feedback">${defaultsDirty()?'有未保存的修改':'当前默认选择'}</span><div class="heading-actions">${button('取消','cancel-defaults')}${button('保存默认选择','save-defaults','primary',defaultsDirty()?'':'disabled')}</div>`);
  if(!flowDialog.open)flowDialog.showModal();
}

function renderDefaultsPage() {
  return `<section class="default-settings-view"><div class="default-settings-heading"><h2>新 Work 默认</h2><p>新建 Work 时，自动选用以下 Skills 和 Packages。</p></div>${defaultConfigBody()}</section>`;
}

function sidebarDefaults() {
  if(scheme!=='2')return '';
  const editing=defaultsSurface==='inline';
  return `<section class="sidebar-defaults"><div class="sidebar-defaults-heading"><span>${icon('check',13)}${editing?'选择新 Work 的默认能力':'默认选用'}<small>${editing?'':catalog.filter(item=>item.kind===tab&&item.isDefault).length}</small></span>${editing?'':button(icon('settings',14),'defaults','icon ghost','aria-label="编辑默认选择" title="编辑默认选择"')}</div>${editing?`<p>勾选左侧条目；右侧文件可继续编辑。</p><div class="inline-default-order">${defaultOrderRows(tab)}</div>`:'<p>新建 Work 时自动使用</p>'}</section>`;
}

function sidebarFooter(total) {
  return defaultsSurface==='inline'?`<div class="sidebar-defaults-actions">${button('取消','cancel-defaults')}${button('保存默认选择','save-defaults','primary',defaultsDirty()?'':'disabled')}</div>`:`<div class="navigator-footer"><span>${total} 个${query?'结果':tab==='skill'?' Skills':' Packages'}</span>${button(icon('refresh',13),'refresh','icon ghost','aria-label="刷新能力库"')}</div>`;
}

function redrawDefaults() {
  const active=document.activeElement;
  const choice=active?.dataset.defaultChoice,key=active?.dataset.key,direction=active?.dataset.direction;
  if(defaultsSurface==='dialog')renderDefaultsDialog();else render();
  if(choice)[...document.querySelectorAll('[data-default-choice]')].find(node=>node.dataset.defaultChoice===choice)?.focus();
  else if(key&&direction)[...document.querySelectorAll('[data-action="move-default"]')].find(node=>node.dataset.key===key&&node.dataset.direction===direction&&!node.disabled)?.focus();
}

function changeDefaultDraft(key,checked) {
  if(!defaultDraft)return;
  defaultDraft=checked?[...defaultDraft.filter(value=>value!==key),key]:defaultDraft.filter(value=>value!==key);
  redrawDefaults();
}

function moveDefaultDraft(key,direction) {
  if(!defaultDraft)return;
  const item=catalog.find(item=>itemKey(item)===key);if(!item)return;
  const family=defaultDraft.filter(value=>catalog.some(entry=>itemKey(entry)===value&&entry.kind===item.kind));
  const index=family.indexOf(key),other=family[index+(direction==='up'?-1:1)];if(!other)return;
  const a=defaultDraft.indexOf(key),b=defaultDraft.indexOf(other);[defaultDraft[a],defaultDraft[b]]=[defaultDraft[b],defaultDraft[a]];
  redrawDefaults();
}

function saveDefaults() {
  if(!defaultDraft||!applyDefaultKeys(defaultDraft))return;
  const surface=defaultsSurface;
  if(surface==='dialog'){defaultsSurface='';defaultDraft=null;flowDialog.close();}
  else if(surface==='inline'){defaultsSurface='';defaultDraft=null;}
  else defaultDraft=currentDefaultKeys();
  detailError='';render();toast('已保存默认选择，仅影响新建 Work。');
}

function cancelDefaults() {
  const surface=defaultsSurface;defaultsSurface='';defaultDraft=null;
  if(surface==='dialog')flowDialog.close();
  if(surface==='page')defaultsView=false;
  syncURL();render();
}

function showDefaultsView(show) {
  if(show===defaultsView)return;
  if(!show&&defaultsDirty()&&!window.confirm('放弃未保存的默认选择？'))return;
  requestTransition(()=>{defaultsView=show;defaultsSurface=show?'page':'';defaultDraft=show?currentDefaultKeys():null;syncURL();render();});
}

function libraryHeader() {
  const title=`<nav class="work-view-tabs" role="tablist" aria-label="Work 设置视图"><button type="button" role="tab" data-action="work-view" data-view="library" aria-selected="${!defaultsView}">能力库</button><button type="button" role="tab" data-action="work-view" data-view="defaults" aria-selected="${defaultsView}">新 Work 默认</button></nav>`;
  const actions=defaultsView?`${button('取消','cancel-defaults')}${button('保存默认选择','save-defaults','primary',defaultsDirty()?'':'disabled')}`:button(icon('plus',15)+(tab==='skill'?' 添加 Skill':' 安装 Package'),'open-upload','primary',`data-kind="${tab}"`);
  return `<div class="library-toolbar">${title}<div class="heading-actions">${actions}</div></div>`;
}

function textFile(path, text) { return {path,text,size:utf8.encode(text).length,binary:false}; }

function updateFileStats(item) {
  const files = fileStore.get(item.name) || [];
  item.files = files.length;
  item.size = files.reduce((sum,file) => sum+file.size,0);
}

function seedSkillFiles() {
  const fixtures = {
    'code-review': {
      'SKILL.md': ['---','name: code-review','description: 审查代码改动，定位缺陷并给出可执行的修复建议。','---','','# 代码审查','','## 使用时机','','当用户要求审查改动、检查潜在问题，或准备合并代码时使用。','','## 工作方式','','1. 阅读改动，确认预期行为和影响范围。','2. 沿调用关系检查边界条件与错误处理。','3. 优先报告能够复现的问题，并注明文件和位置。','4. 给出最小修复建议，避免扩大改动。','','## 输出要求','','- 按影响程度排序，先写问题，再给证据。','- 说明触发条件、实际结果和预期结果。','- 没有发现问题时直接说明，并列出未验证的部分。','','## 相关文件','','- references/checklist.md：审查检查项。','- references/report-format.md：问题描述格式。','- scripts/check.sh：本地检查入口。',''].join('\n'),
      'references/checklist.md': ['# 审查检查项','','## 行为','','- 输入为空、超限或格式错误时，结果是否明确？','- 失败之后是否保留原来的可用状态？','- 重复操作是否会产生意外副作用？','','## 边界','','- 用户只能访问自己有权限的资源。','- 文件路径不能逃出目标目录。','- 错误消息不包含密码、token 或内部路径。','','## 验证','','针对发生变化的行为执行相应检查，并记录未覆盖的部分。',''].join('\n'),
      'references/report-format.md': ['# 问题描述格式','','## 标题','','用一句话描述具体问题及其影响。','','## 触发条件','','说明什么输入或操作会触发问题。','','## 证据','','给出文件位置，以及实际行为与预期行为的差异。','','## 修复建议','','描述能够解决问题的最小改动。',''].join('\n'),
      'scripts/check.sh': ['#!/usr/bin/env bash','set -euo pipefail','','# 示例：检查当前改动中的空白错误。','git diff --check','','# 根据项目类型，在这里加入对应的检查命令。','printf "检查完成\\n"',''].join('\n'),
    },
    'browser-tools': {
      'SKILL.md': ['---','name: browser-tools','description: 通过浏览器检查页面和用户操作流程。','---','','# 浏览器检查','','## 使用时机','','需要核对页面布局、复现交互问题或验证用户流程时使用。','','## 工作方式','','1. 打开目标页面，确认操作对象。','2. 依照用户的实际路径逐步操作。','3. 记录实际反馈和控制台错误。','4. 必要时保存截图以便对照。','','## 参考','','- references/browser-checks.md','- scripts/example.mjs',''].join('\n'),
      'references/browser-checks.md': ['# 页面检查','','- 页面初次加载是否显示真实内容？','- 主要操作能否完成？','- 错误后是否有明确的下一步？','- 窄屏下，按钮和正文是否可访问？',''].join('\n'),
      'scripts/example.mjs': ['// 浏览器操作示例；原型不会执行此文件。','export async function inspect(page, url) {','  await page.goto(url);','  return {','    title: await page.title(),','    heading: await page.locator("h1").innerText(),','  };','}',''].join('\n'),
    },
    'document-writing': {
      'SKILL.md': ['---','name: document-writing','description: 编写结构清楚、便于阅读和维护的文档。','---','','# 文档写作','','先明确读者和需要完成的任务，再安排内容。','','## 工作方式','','1. 收集写作所需的事实。','2. 先写结论和读者最需要的信息。','3. 用具体例子解释复杂概念。','4. 检查术语、链接和操作步骤。','','## 参考文件','','- references/style.md','- templates/guide.md',''].join('\n'),
      'references/style.md': ['# 写作约定','','使用简短、具体的句子。每段只表达一个主要意思。','','标题说明内容，按钮写出动作。避免重复解释读者已经知道的事。',''].join('\n'),
      'templates/guide.md': ['# 使用指南','','## 适用场景','','说明读者什么时候需要这份指南。','','## 操作步骤','','1. 准备必要的信息。','2. 执行操作。','3. 确认完成结果。',''].join('\n'),
    },
    'frontend-design': {
      'SKILL.md': ['---','name: frontend-design','description: 设计清晰、克制，并符合现有产品习惯的界面。','---','','# 界面设计','','从用户任务出发，先确定信息结构和操作顺序。','','## 原则','','- 沿用产品已有的颜色和组件。','- 每个区域只保留必要的信息和动作。','- 将低频管理操作放在次级入口。','- 用真实内容检查密度和阅读体验。','','## 工作方式','','1. 明确用户当前要完成的任务。','2. 比较结构上不同的方案。','3. 选择一个方案制作可交互原型。','4. 根据实际操作反馈调整。','','## 相关文件','','- references/components.md','- references/layout.md',''].join('\n'),
      'references/components.md': ['# 组件选择','','按钮执行操作，链接切换位置。','','简短的聚焦任务使用对话框；持续阅读和编辑使用稳定的主区域。','','不要仅因为视觉相似而替换组件的语义。',''].join('\n'),
      'references/layout.md': ['# 布局约定','','先建立主要对象和它的下级对象，再决定展示方式。','','左侧用于选择对象，右侧显示选中对象的内容。','','通过间距和文字层级组织信息，减少重复标题。',''].join('\n'),
    },
    'legacy-notes': {
      'SKILL.md': ['---','name: legacy-notes','description: 整理已有笔记。','---','','# 笔记整理','','将零散信息整理为简短、可检索的笔记。','','此 Skill 在示例库中处于禁用状态；管理员仍可查看和修改内容。',''].join('\n'),
      'references/notes.md': ['# 笔记格式','','- 主题','- 已验证事实','- 待确认问题','- 下一步',''].join('\n'),
    },
  };
  for (const item of catalog.filter(item=>item.kind === 'skill')) {
    fileStore.set(item.name,Object.entries(fixtures[item.name]).map(([path,text])=>textFile(path,text)));
    updateFileStats(item);
  }
}

const activeRecord = () => editor ? (fileStore.get(editor.name) || []).find(file=>file.path === editor.path) : null;
const isDirty = () => !!editor && !editor.loading && !editor.binary && !editor.error && editor.draft !== activeRecord()?.text;

function fileType(path) {
  const extension = path.split('.').pop().toLowerCase();
  return ({md:'Markdown',sh:'Shell',js:'JavaScript',mjs:'JavaScript',ts:'TypeScript',json:'JSON',yaml:'YAML',yml:'YAML',py:'Python',css:'CSS',html:'HTML'})[extension] || '文本';
}

function lineNumbers(text) { return Array.from({length:text.split('\n').length},(_,index)=>index+1).join('\n'); }

function updateEditorUI() {
  const dirty = isDirty();
  const save = $('[data-action="save-file"]');
  if (save) save.disabled = !dirty;
  const state = $('#editor-save-state');
  if (state) { state.textContent = editor?.loading?'读取中':editor?.binary?'不可编辑':dirty?'未保存':'已保存'; state.classList.toggle('dirty',dirty); }
  for (const row of document.querySelectorAll('.skill-file-row')) {
    const marker = row.querySelector('.file-dirty');
    if (marker) marker.hidden = !(dirty && row.dataset.path === editor?.path);
  }
  const input = $('#file-editor');
  if (!input) return;
  const numbers = $('#line-numbers');
  if (numbers) { const value=lineNumbers(input.value); if(numbers.textContent!==value)numbers.textContent=value; numbers.scrollTop=input.scrollTop; }
  const cursor = $('#editor-cursor');
  if (cursor) { const before=input.value.slice(0,input.selectionStart).split('\n'); cursor.textContent=`第 ${before.length} 行，第 ${before.at(-1).length+1} 列`; }
}

async function loadFileNow(path, showMobile = false) {
  const item = findSelected();
  if (!item || item.kind !== 'skill') return;
  const record = (fileStore.get(item.name) || []).find(file=>file.path === path);
  if (!record) return;
  const current = {name:item.name,path,draft:record.text ?? '',loading:record.text == null && !record.binary,binary:!!record.binary,error:''};
  editor = current;
  if (showMobile) mobileDetail = true;
  render();
  if (!current.loading) return;
  try {
    const data = new Uint8Array(await record.file.arrayBuffer());
    if (data.subarray(0,8192).includes(0)) record.binary = true;
    else record.text = new TextDecoder('utf-8',{fatal:true}).decode(data);
  } catch { record.binary = true; }
  if (editor !== current) return;
  current.loading = false; current.binary = !!record.binary; current.draft = record.text ?? '';
  render();
}

function activateEntry(key, showMobile = false) {
  selected = key; detailError = ''; mobileDetail = false; openFolders.clear();
  const item = findSelected();
  if (item?.kind === 'skill') { expandedSkill = key; void loadFileNow('SKILL.md',showMobile); }
  else { expandedSkill = null; editor = null; render(); }
}

function saveCurrentFile(showNotice = true) {
  if (!isDirty()) return true;
  const record = activeRecord(); const item = findSelected();
  if (!record || !item) return false;
  const newSize = utf8.encode(editor.draft).length;
  if (newSize > 8*1048576 || item.size-record.size+newSize > 32*1048576) { toast('文件或 Skill 总大小超过上传限制，请减少内容后保存。'); return false; }
  record.text = editor.draft; record.size = newSize;
  updateFileStats(item); item.updated = new Date().toLocaleString('sv-SE',{hour12:false});
  updateEditorUI();
  if (showNotice) toast(`已保存 ${editor.path}`);
  return true;
}

function requestTransition(next) {
  if (!isDirty()) { next(); return; }
  pendingTransition = next;
  unsavedDialog.innerHTML = `<div class="flow-header"><div><h2 id="unsaved-title">有未保存的修改</h2><p>${escapeHTML(editor.path)}</p></div>${button(icon('close',17),'cancel-transition','icon ghost','aria-label="继续编辑"')}</div><div class="flow-body"><p class="confirm-note">切换前，要保存当前文件的修改吗？</p></div><div class="flow-footer">${button('继续编辑','cancel-transition')}${button('放弃修改','discard-transition')}${button('保存并切换','save-transition','primary')}</div>`;
  unsavedDialog.showModal();
}

function finishTransition(save) {
  if (save && !saveCurrentFile(false)) return;
  const next = pendingTransition; pendingTransition = null;
  if (!save && editor) editor.draft = activeRecord()?.text ?? '';
  unsavedDialog.close(); next?.();
}

function fileNodes(files) {
  const root = new Map();
  for (const file of files) {
    let nodes=root; let path='';
    const parts=file.path.split('/');
    parts.forEach((name,index)=>{
      path += (path ? '/' : '')+name;
      if (!nodes.has(name)) nodes.set(name,{name,path,folder:index<parts.length-1,children:new Map()});
      nodes=nodes.get(name).children;
    });
  }
  return root;
}

function renderFileNodes(nodes, depth = 0) {
  const sorted=[...nodes.values()].sort((a,b)=>a.name==='SKILL.md' ? -1 : b.name==='SKILL.md' ? 1 : Number(b.folder)-Number(a.folder) || a.name.localeCompare(b.name));
  return sorted.map(node=>node.folder
    ? `<li><button type="button" class="skill-folder-row" style="--depth:${depth}" data-action="folder" data-path="${escapeHTML(node.path)}" aria-expanded="${openFolders.has(node.path)}">${icon('chevron',12,openFolders.has(node.path)?'folder-open':'')}${icon('folder',14)}<span>${escapeHTML(node.name)}</span></button>${openFolders.has(node.path)?`<ul>${renderFileNodes(node.children,depth+1)}</ul>`:''}</li>`
    : `<li><button type="button" class="skill-file-row ${editor?.path===node.path?'active-file':''}" style="--depth:${depth}" data-action="open-file" data-path="${escapeHTML(node.path)}" aria-current="${editor?.path===node.path?'true':'false'}" title="${escapeHTML(node.path)}">${icon('file',14)}<span>${escapeHTML(node.name)}</span><span class="file-dirty" ${isDirty()&&editor.path===node.path?'':'hidden'} aria-label="未保存">•</span></button></li>`).join('');
}

function skillEditor(item) {
  const ready = editor && editor.name === item.name;
  const path = ready ? editor.path : 'SKILL.md';
  return `<button type="button" class="mobile-detail-back" data-action="back-to-list">${icon('left',14)}文件列表</button><div class="file-heading"><h2 id="detail-title"><span class="file-owner">${escapeHTML(item.name)}</span>${icon('chevron',12)}<span class="file-path">${escapeHTML(path)}</span></h2><div class="inspector-actions">${button('保存','save-file','primary',isDirty()?'':'disabled')}</div></div>${detailError?`<div class="inline-error editor-notice" role="alert">${icon('info',16)}<div>${escapeHTML(detailError)}<button type="button" class="text-button" data-action="defaults">打开默认 Work</button></div></div>`:''}${!ready||editor.loading?'<div class="editor-placeholder" role="status">正在读取文件…</div>':editor.binary?`<div class="editor-placeholder">${icon('file',25)}<h3>此文件无法作为文本编辑</h3><p>可在左侧 Skill 的菜单中选择“更新文件夹”。</p></div>`:`<div class="code-editor"><pre id="line-numbers" class="line-numbers" aria-hidden="true">${lineNumbers(editor.draft)}</pre><textarea id="file-editor" aria-label="文件内容" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off">${escapeHTML(editor.draft)}</textarea></div>`}<div class="editor-footer"><span>${ready&&editor.binary?'二进制文件':fileType(path)}${ready&&!editor.binary?'<span class="editor-encoding">UTF-8</span>':''}</span><span><span id="editor-save-state" class="${isDirty()?'dirty':''}">${!ready||editor.loading?'读取中':editor.binary?'不可编辑':isDirty()?'未保存':'已保存'}</span><span id="editor-cursor" ${!ready||editor.binary||editor.loading?'hidden':''}>第 1 行，第 1 列</span></span></div>`;
}

function skillInfo(key) {
  const item=catalog.find(item=>itemKey(item)===key);if(!item)return;
  flow=null;
  const details=item.kind==='skill'?`<dt>文件</dt><dd>${item.files} 个 / ${bytes(item.size)}</dd><dt>更新于</dt><dd>${escapeHTML(item.updated)}</dd><dt>创建于</dt><dd>${escapeHTML(item.created)}</dd>`:`<dt>版本</dt><dd>${escapeHTML(item.version||'未声明')}</dd><dt>来源</dt><dd>${escapeHTML(item.source)}</dd><dt>地址</dt><dd>${escapeHTML(item.resolvedSource)}</dd>`;
  flowShell(item.name,item.kind==='skill'?'Skill 信息':'Package 信息',`<dl class="inspector-properties"><dt>状态</dt><dd>${status(item)}</dd><dt>新 Work 默认</dt><dd>${item.isDefault?'已选用':'未选用'}</dd>${details}</dl><p class="detail-note">已有 Work 中的副本保持不变。</p>`,button('关闭','close-flow'));
  flowDialog.showModal();
}

function syncURL() {
  const url = new URL(location.href);
  url.searchParams.delete('variant');
  url.searchParams.delete('scheme');
  url.searchParams.set('v','6');
  if(defaultsView)url.searchParams.set('view','defaults');else url.searchParams.delete('view');
  if (tab === 'package') url.searchParams.set('type','packages'); else url.searchParams.delete('type');
  history.replaceState({},'',url);
}

function typeTabs(help = false) {
  return `<div class="type-tabs" role="tablist" aria-label="能力类型">${['skill','package'].map(kind => `<button type="button" role="tab" aria-selected="${tab === kind}" tabindex="${tab === kind ? '0' : '-1'}" class="${tab === kind ? 'active' : ''}" data-action="tab" data-kind="${kind}">${kind === 'skill' ? 'Skills' : 'Packages'}<span class="count">${count(kind)}</span></button>`).join('')}${help ? `<span class="tab-help">Skills 是完整目录；Packages 可包含多种资源</span>` : ''}</div>`;
}

function search() {
  return `<label class="search">${icon('search',16)}<input id="catalog-search" type="search" aria-label="搜索名称" placeholder="搜索${tab === 'package' ? ' Package' : ' Skill'} 名称" value="${escapeHTML(query)}"></label>`;
}

function empty(kind) {
  const name = kind === 'skill' ? 'Skill' : 'Package';
  return `<div class="empty">${icon(kind === 'skill' ? 'folder' : 'box',24)}<h3>${query ? `未找到 ${name}` : `还没有 ${name}`}</h3>${query ? button('清除搜索','clear-filter') : button(kind === 'skill' ? '添加 Skill' : '安装 Package','open-upload','primary',`data-kind="${kind}"`)}</div>`;
}

function inspectorDetail(item) {
  if(!item)return `<div class="detail-empty">${icon('folder',24)}<p>选择一个 ${tab==='skill'?'Skill':'Package'}</p></div>`;
  if(item.kind==='skill')return skillEditor(item);
  const resources={extensions:'扩展',skills:'Skills',prompts:'提示词',themes:'主题'};
  return `<button type="button" class="mobile-detail-back" data-action="back-to-list">${icon('left',14)}Packages</button><div class="inspector-heading"><div><h2 id="detail-title">${escapeHTML(item.name)}</h2><p>Pi package</p></div></div><dl class="inspector-properties"><dt>状态</dt><dd>${status(item)}</dd><dt>新 Work 默认</dt><dd>${item.isDefault?'已选用':'未选用'}</dd><dt>版本</dt><dd>${escapeHTML(item.version||'未声明')}</dd><dt>来源</dt><dd>${escapeHTML(item.source)}</dd><dt>地址</dt><dd class="source-address">${escapeHTML(item.resolvedSource)}</dd><dt>资源</dt><dd><div class="resource-counts">${Object.entries(item.resources).filter(([,value])=>value>0).map(([name,value])=>`<span>${value} ${resources[name]}</span>`).join('')||'无'}</div></dd></dl><p class="inspector-footnote">管理此 Package，请使用左侧对应行的操作菜单。</p>`;
}

function libraryB() {
  const visible = filtered(tab);
  return `<section class="inspector-layout ${mobileDetail ? 'mobile-inspecting' : ''}" aria-label="能力库双栏"><div class="navigator">${typeTabs()}${search()}${sidebarDefaults()}<div class="navigator-list">${visible.map(item => `<div class="skill-group"><div class="skill-row-wrap">${defaultsSurface==='inline'?`<input class="inline-default-checkbox" type="checkbox" data-default-choice="${escapeHTML(itemKey(item))}" aria-label="默认选用 ${escapeHTML(item.name)}" ${defaultDraft?.includes(itemKey(item))?'checked':''} ${!item.enabled?'disabled':''}>`:''}<button type="button" class="navigator-item ${selected === itemKey(item) ? 'selected' : ''} ${item.enabled ? '' : 'item-disabled'}" data-action="detail" data-key="${escapeHTML(itemKey(item))}" ${item.kind==='skill'?`aria-expanded="${expandedSkill===itemKey(item)}"`:`aria-pressed="${selected===itemKey(item)}"`} title="${escapeHTML(item.name)}">${item.kind==='skill'?icon('chevron',12,expandedSkill===itemKey(item)?'folder-open':''):''}${kindIcon(item.kind)}<span class="item-copy"><strong>${escapeHTML(item.name)}</strong></span><span class="row-note">${!item.enabled ? '已禁用' : defaultsSurface==='inline' ? (defaultDraft?.includes(itemKey(item))?'已选':'') : item.isDefault ? '默认' : ''}</span></button>${button(icon('more',15),'catalog-more','icon ghost catalog-more',`data-key="${escapeHTML(itemKey(item))}" aria-label="${escapeHTML(item.name)} 的操作" aria-haspopup="menu" aria-expanded="false" aria-controls="catalog-menu"`)}</div>${item.kind==='skill'&&expandedSkill===itemKey(item)?`<ul class="skill-files" aria-label="${escapeHTML(item.name)} 的文件">${renderFileNodes(fileNodes(fileStore.get(item.name)||[]))}</ul>`:''}</div>`).join('') || empty(tab)}</div>${sidebarFooter(visible.length)}</div><div class="inspector-content ${findSelected()?.kind==='skill'?'editor-pane':''}">${inspectorDetail(findSelected())}</div></section>`;
}

function render() {
  const focused = document.activeElement;
  const focusId = focused && app.contains(focused) ? focused.id : null;
  let position;
  try { position = focused?.selectionStart; } catch {}
  schemeSwitcher();
  if (location.pathname.startsWith('/admin/operations/')) { renderOperation(); return; }
  if(defaultsView){defaultsSurface='page';if(!defaultDraft)defaultDraft=currentDefaultKeys();}
  app.innerHTML=libraryHeader()+(defaultsView?renderDefaultsPage():libraryB());
  if (focusId && document.getElementById(focusId)) {
    const next = document.getElementById(focusId); next.focus({preventScroll:true});
    if (typeof position === 'number') { try { next.setSelectionRange(position,position); } catch {} }
  }
  const input = $('#file-editor');
  if (input) {
    input.addEventListener('scroll',()=>{ $('#line-numbers').scrollTop=input.scrollTop; if(editor)editor.scrollTop=input.scrollTop; });
    if(editor?.scrollTop) { input.scrollTop=editor.scrollTop; $('#line-numbers').scrollTop=input.scrollTop; }
  }
  updateEditorUI();
}

function toast(message) {
  clearTimeout(noticeTimer); const el = $('#notice'); el.textContent = message; el.hidden = false;
  noticeTimer = setTimeout(() => { el.hidden = true; },4000);
}

function openDetail(key) {
  if (key===selected && findSelected()?.kind==='skill') { expandedSkill=expandedSkill===key?null:key; render(); return; }
  requestTransition(()=>activateEntry(key));
}

function switchTab(kind) {
  if(defaultsSurface==='inline'){toast('请先保存或取消默认选择。');return;}
  requestTransition(()=>{ tab=kind; query=''; syncURL(); const first=filtered(kind)[0]; activateEntry(first?itemKey(first):null); });
}

function flowShell(title, description, content, footer, extra = '') {
  flowDialog.innerHTML = `<div class="flow-header"><div><h2 id="flow-title">${escapeHTML(title)}</h2>${description ? `<p>${escapeHTML(description)}</p>` : ''}</div>${button(icon('close',17),'close-flow','icon ghost','aria-label="关闭对话框"')}</div><div class="flow-body">${content}</div><div class="flow-footer">${footer}</div>${extra}`;
}

function openUpload(kind, target) {
  flow = {kind,target,selection:null,error:'',sourceType:'npm',sourceText:'',addDefault:false,busy:false};
  renderUpload(); if (!flowDialog.open) flowDialog.showModal();
}

function selectionFromFiles(fileList) {
  const entries = Array.from(fileList).map(file => ({path:file.webkitRelativePath || file.name,size:file.size,file}));
  const roots = new Set(entries.map(item => item.path.split('/')[0]));
  const root = roots.size === 1 && entries.every(item => item.path.includes('/')) ? [...roots][0] : '';
  return {root,files:entries.map(item => ({...item,path:root ? item.path.slice(root.length+1) : item.path})),multipleRoots:roots.size !== 1};
}

function validateSelection(selection) {
  const isSkill = flow.kind === 'skill';
  if (!selection.root || selection.multipleRoots) return '一次只能添加一个文件夹，请重新选择。';
  if (!selection.files.length) return '文件夹为空，请重新选择。';
  if (isSkill && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(selection.root)) return '请重命名文件夹：1–64 个小写字母、数字或连字符，以字母或数字开头。';
  if (isSkill && flow.target && selection.root !== flow.target) return `请选择名为 ${flow.target} 的文件夹。当前选择：${selection.root}。`;
  const required = isSkill ? 'SKILL.md' : 'package.json';
  if (!selection.files.some(file => file.path === required)) return `文件夹根目录中没有 ${required}。请检查 ${selection.root}，然后重新选择。`;
  const limit = isSkill ? {files:2048,total:32*1048576,file:8*1048576} : {files:100000,total:1073741824,file:64*1048576};
  if (selection.files.length > limit.files) return `文件数超过 ${limit.files.toLocaleString()} 个，请精简目录后重新选择。`;
  if (selection.files.some(file => file.size > limit.file)) return `有文件超过单文件上限 ${bytes(limit.file)}，请调整后重新选择。`;
  if (selection.files.reduce((sum,item) => sum+item.size,0) > limit.total) return `目录总大小超过 ${bytes(limit.total)}，请调整后重新选择。`;
  if (isSkill && !flow.target && catalog.some(item => item.kind === 'skill' && item.name === selection.root)) return `${selection.root} 已存在。请在左侧 Skill 的菜单中选择“更新文件夹”。`;
  return '';
}

async function acceptSelection(selection) {
  if (!flow || flow.busy) return;
  const current = flow;
  flow.selection = selection; flow.error = selection.zip ? '' : validateSelection(selection);
  if (!flow.error && flow.kind === 'package' && !selection.zip) {
    const manifestFile = selection.files.find(item => item.path === 'package.json');
    if (manifestFile?.file) {
      if (manifestFile.size > 1048576) flow.error = 'package.json 超过 1 MiB，请调整后重新选择。';
      else try {
        const manifest = JSON.parse(await manifestFile.file.text());
        if (flow !== current) return;
        if (typeof manifest.name !== 'string' || !manifest.name) flow.error = 'package.json 中缺少 name，无法确认 Package 名称。';
        else { selection.packageName = manifest.name; selection.version = typeof manifest.version === 'string' ? manifest.version : null; }
      } catch { if (flow === current) flow.error = 'package.json 无法读取，请检查 JSON 格式后重新选择。'; }
    }
    if (!flow.error && flow.target && selection.packageName !== flow.target) flow.error = `Package 名称不匹配：正在更新 ${flow.target}，所选 package.json 声明 ${selection.packageName || '未知名称'}。`;
  }
  if (flow !== current) return;
  renderUpload();
}

function selectionSummary(selection) {
  const valid = !flow.error;
  const total = selection.files.reduce((sum,file) => sum+file.size,0);
  return `<div class="selected-folder"><div class="selected-folder-header">${kindIcon(flow.kind,23)}<div><h3>${escapeHTML(selection.root || '未识别文件夹')}</h3><p>${selection.files.length} 个${selection.zip ? ' ZIP ' : ''}文件 / ${bytes(total)}${selection.example ? ' / 示例' : ''}</p></div><button type="button" class="text-button" data-action="browse">更换</button></div>${valid ? `<div class="validation-ok">${icon('check',14)}${selection.zip ? '已选择 ZIP，安装时将校验内容' : flow.kind === 'skill' ? 'SKILL.md 已找到' : `package.json 已找到${selection.packageName ? '：'+escapeHTML(selection.packageName) : ''}`}</div>` : ''}${!selection.zip ? `<details class="file-tree"><summary>查看文件</summary><div class="tree-lines">${selection.files.slice(0,80).map(file => `<div class="tree-line" style="padding-left:${Math.min(file.path.split('/').length-1,5)*14}px">${icon('file',12)}<span class="${file.path === 'SKILL.md' ? 'required' : ''}">${escapeHTML(file.path)}</span></div>`).join('')}${selection.files.length > 80 ? `<p class="small muted">还有 ${selection.files.length-80} 个文件</p>` : ''}</div></details>` : ''}</div>`;
}

function prototypeTools() {
  return `<details class="prototype-examples"><summary>原型示例</summary><div class="prototype-tools"><button type="button" data-action="example" data-example="valid">有效文件夹</button><button type="button" data-action="example" data-example="missing">缺少 ${flow.kind === 'skill' ? 'SKILL.md' : 'package.json'}</button>${flow.kind === 'skill' && !flow.target ? '<button type="button" data-action="example" data-example="duplicate">同名文件夹</button>' : ''}</div></details>`;
}

function uploadDropzone() {
  const zip = flow.kind === 'package' && flow.sourceType === 'ZIP';
  return `<div class="dropzone" id="upload-dropzone"><span class="upload-folder">${icon(zip ? 'file' : 'folder',28)}</span><h3>${zip ? '选择 ZIP 文件' : flow.kind === 'skill' ? '拖入 Skill 文件夹' : '拖入 Package 文件夹'}</h3><p>${zip ? '根目录或唯一外层目录中需有 package.json' : '子文件夹和文件会一并添加'}</p>${button(zip ? '选择 ZIP' : '选择文件夹','browse')}</div>`;
}

function renderUpload() {
  if (!flow) return;
  const isSkill = flow.kind === 'skill';
  const local = isSkill || ['目录','ZIP'].includes(flow.sourceType);
  const zip = !isSkill && flow.sourceType === 'ZIP';
  const title = isSkill ? flow.target ? '更新文件夹' : '添加 Skill' : flow.target ? '更新 Package' : '安装 Package';
  const selectedContent = flow.selection ? selectionSummary(flow.selection) : uploadDropzone();
  const directorySupported = 'webkitdirectory' in document.createElement('input');
  let content = flow.target ? `<div class="target-note"><strong>${escapeHTML(flow.target)}</strong><br>更新会替换当前内容，启用状态与默认选择保持不变。</div>` : '';
  if (!isSkill) content += `<div class="source-options" role="group" aria-label="Package 来源">${['npm','Git','目录','ZIP'].map(source => `<button type="button" class="source-option ${flow.sourceType === source ? 'active' : ''}" data-action="source" data-source="${source}" aria-pressed="${flow.sourceType === source}">${source === '目录' ? '本地目录' : source}</button>`).join('')}</div>`;
  if (local) content += `${selectedContent}<input type="file" id="folder-input" ${zip ? 'accept=".zip,application/zip"' : 'webkitdirectory directory multiple'} hidden aria-label="${zip ? '选择 ZIP 文件' : '选择 Skill 或 Package 文件夹'}"><p class="upload-guidance">${isSkill ? '文件夹名称将用作 Skill 名称。' : zip ? '名称取自 package.json。请上传 Pi package 的 ZIP 文件。' : '名称取自 package.json。需保留执行权限或符号链接时，请用 ZIP。'}</p><details class="upload-limits"><summary>文件要求</summary><p class="limits">${isSkill ? '根目录包含 SKILL.md；最多 2,048 个文件、总大小 32 MiB、单文件 8 MiB。仅保留普通文件和相对路径。' : zip ? 'ZIP 最大 256 MiB、展开内容最大 1 GiB、单文件 64 MiB、最多 100,000 条目、64 层目录；package.json 最大 1 MiB。' : '根目录包含 package.json；最多 100,000 个文件、64 层目录、总大小 1 GiB、单文件 64 MiB；package.json 最大 1 MiB。仅保留普通文件和相对路径。'}</p></details>${!zip && !directorySupported ? '<div class="inline-error" role="alert">此浏览器不支持文件夹选择，请更换浏览器后重试。</div>' : ''}`;
  else content += `<label class="field-label" for="package-source">${flow.sourceType === 'npm' ? 'npm 包' : 'Git 地址'}</label><input type="text" id="package-source" class="text-input" value="${escapeHTML(flow.sourceText)}" placeholder="${flow.sourceType === 'npm' ? '@scope/package@1.2.0' : 'https://github.com/owner/repository.git#v1.0.0'}" autocomplete="off"><p class="field-help">${flow.sourceType === 'npm' ? '支持指定版本。' : '支持分支、标签或提交。地址中不要包含密码或 token。'}</p>`;
  if (flow.error) content += `<div class="inline-error" role="alert">${icon('warning',17)}<div>${escapeHTML(flow.error)}</div></div>`;
  if (!isSkill && !flow.target) content += `<label class="check-option"><input type="checkbox" id="add-default" ${flow.addDefault ? 'checked' : ''}><span>加入默认 Work<small>安装成功后，新建 Work 时默认选用。</small></span></label>`;
  if (local) content += prototypeTools();
  const canSubmit = local ? flow.selection && !flow.error && (zip || directorySupported) : flow.sourceText.trim();
  const label = isSkill ? flow.target ? '更新文件夹' : '添加 Skill' : flow.target ? '更新 Package' : '安装 Package';
  flowShell(title,isSkill ? flow.target ? '选择同名文件夹。' : '选择根目录中包含 SKILL.md 的文件夹。' : '从一种来源安装。',content,`<div class="heading-actions">${button('取消','close-flow')}${button(label,'submit-upload','primary',canSubmit ? '' : 'disabled')}</div>`);
  const input = $('#folder-input');
  if (input) input.onchange = event => {
    if (!event.target.files.length) return;
    if (zip) {
      const file = event.target.files[0];
      flow.selection = {zip:true,root:file.name,files:[{path:file.name,size:file.size,file}]};
      flow.error = !file.name.toLowerCase().endsWith('.zip') ? '请选择 .zip 文件。' : file.size > 256*1048576 ? 'ZIP 超过 256 MiB。' : '';
      renderUpload();
    } else void acceptSelection(selectionFromFiles(event.target.files));
  };
  if ($('#upload-dropzone') && !zip) wireDropzone($('#upload-dropzone'),acceptSelection);
}

function exampleSelection(which) {
  if (!flow) return;
  const root = which === 'duplicate' ? 'code-review' : flow.target || (flow.kind === 'skill' ? 'release-checklist' : 'workspace-tools');
  const files = flow.kind === 'skill' ? [{path:'SKILL.md',size:3560},{path:'references/checklist.md',size:8120},{path:'references/release-notes.md',size:4280},{path:'scripts/check.sh',size:1750},{path:'assets/template.md',size:2190}] : [{path:'package.json',size:680},{path:'skills/checks/SKILL.md',size:3560},{path:'extensions/checks.ts',size:8120},{path:'prompts/review.md',size:4280}];
  if (flow.kind==='skill') for(const file of files) {
    file.text=file.path==='SKILL.md'?`---\nname: ${root}\ndescription: 发布前检查版本、构建与验证结果。\n---\n\n# 发布检查\n\n## 工作方式\n\n1. 确认版本与变更内容。\n2. 执行必要的构建和检查。\n3. 核对结果与交付材料。\n\n## 参考\n\n- references/checklist.md\n- references/release-notes.md\n- scripts/check.sh\n` : file.path==='scripts/check.sh' ? '#!/usr/bin/env bash\nset -euo pipefail\n\ngit diff --check\nprintf "检查完成\\n"\n' : `# ${file.path.split('/').pop().replace('.md','')}\n\n这是示例 Skill 中的参考文件。\n\n- 确认输入和预期结果。\n- 记录检查结果。\n- 明确下一步操作。\n`;
    file.size=utf8.encode(file.text).length;
  }
  if (which === 'missing') files.shift();
  if (flow.sourceType === 'ZIP') {
    flow.selection = {root:root+'.zip',zip:true,example:true,packageName:root,files:[{path:root+'.zip',size:18432}]}; flow.error = ''; renderUpload(); return;
  }
  void acceptSelection({root,files,example:true,packageName:flow.kind === 'package' ? root : undefined,version:'1.0.0'});
}

async function readDirectory(entry, prefix = '') {
  if (entry.isFile) {
    const file = await new Promise((resolve,reject) => entry.file(resolve,reject));
    return [{path:prefix+entry.name,size:file.size,file}];
  }
  const reader = entry.createReader(); let result = [], batch;
  do {
    batch = await new Promise((resolve,reject) => reader.readEntries(resolve,reject));
    for (const child of batch) {
      result.push(...await readDirectory(child,prefix+entry.name+'/'));
      if (result.length > 100000) throw new Error('所选目录超过文件数量上限。');
    }
  } while (batch.length);
  return result;
}

function wireDropzone(zone, accept) {
  zone.addEventListener('dragover',event => { event.preventDefault(); zone.classList.add('dragging'); });
  zone.addEventListener('dragleave',event => { if (!zone.contains(event.relatedTarget)) zone.classList.remove('dragging'); });
  zone.addEventListener('drop',async event => {
    event.preventDefault(); zone.classList.remove('dragging');
    // Capture handles before awaiting: browsers clear DataTransfer after the event.
    const entries = Array.from(event.dataTransfer.items).filter(item => item.kind === 'file').map(item => item.webkitGetAsEntry?.() || item.getAsEntry?.());
    if (entries.length !== 1 || !entries[0]?.isDirectory) {
      if (!flowDialog.open) openUpload('skill');
      flow.error = '请拖入一个完整文件夹。单独的 SKILL.md 文件不能表示整个 Skill。'; renderUpload(); return;
    }
    const root = entries[0].name;
    try {
      const files = (await readDirectory(entries[0])).map(file => ({...file,path:file.path.slice(root.length+1)}));
      await accept({root,files});
    } catch {
      if (!flowDialog.open) openUpload('skill');
      flow.error = '无法读取所拖入的目录。请使用“选择文件夹”重试。'; renderUpload();
    }
  });
}

const pause = milliseconds => new Promise(resolve => setTimeout(resolve,milliseconds));

async function submitUpload() {
  if (!flow || flow.busy) return;
  const current = flow;
  const local = current.kind === 'skill' || ['目录','ZIP'].includes(current.sourceType);
  if (local && (!current.selection || current.error)) return;
  if (!local && !current.sourceText.trim()) return;
  current.busy = true;
  if (local) {
    const total = current.selection.files.reduce((sum,file) => sum+file.size,0);
    for (const progress of [15,55,100]) {
      if (flow !== current) return;
      flowShell(progress === 100 ? '正在校验' : '正在上传','原型演示',`<div class="transfer-progress"><h3>${escapeHTML(current.selection.root)}</h3><p>${progress === 100 ? '文件已传输，等待内容校验。' : '正在传输文件。'}</p><progress value="${progress}" max="100" aria-label="模拟上传字节进度"></progress><div class="small muted"><span>${bytes(Math.round(total*progress/100))} / ${bytes(total)}</span><span>${progress === 100 ? '校验中' : progress+'%'}</span></div></div>`,button('关闭','close-flow'));
      await pause(350);
    }
  }
  if (flow !== current) return;
  if (current.kind === 'skill') {
    const name = current.selection.root;
    const now = new Intl.DateTimeFormat('sv-SE',{dateStyle:'short',timeStyle:'short'}).format(new Date());
    let item = catalog.find(item => item.kind === 'skill' && item.name === current.target);
    if (!item) { item = {kind:'skill',name,enabled:true,isDefault:false,created:now}; catalog.push(item); }
    fileStore.set(name,current.selection.files.map(file=>({...file,text:typeof file.text==='string'?file.text:file.file?null:'',binary:false})));
    updateFileStats(item); item.updated = now;
    tab = 'skill'; query = ''; current.busy = false;
    flow = null; flowDialog.close(); syncURL(); activateEntry(itemKey(item),true);
    toast(`${current.target ? '已更新' : '已添加'} ${name}`);
    return;
  }

  const sourceName = current.sourceType === '目录' ? '本地目录' : current.sourceType;
  const packageName = current.target || current.selection?.packageName || 'workspace-tools';
  operation = {id:'prototype-install-'+(++mockSequence),name:packageName,version:current.selection?.version || '1.0.0',source:sourceName,resolvedSource:local ? '本地上传（原型示例）' : current.sourceText,phase:0,addDefault:current.addDefault,target:current.target};
  flowDialog.close(); flow = null; selected = null; tab = 'package';
  editor = null;
  history.pushState({},'',`/admin/operations/${operation.id}?v=6`);
  render();
  const currentOperation = operation;
  for (let phase = 1; phase <= 5; phase++) {
    await pause(650);
    if (operation !== currentOperation) return;
    operation.phase = phase;
    if (phase === 5) {
      let item = catalog.find(item => item.kind === 'package' && item.name === packageName);
      if (!item) { item = {kind:'package',name:packageName,enabled:true,isDefault:current.addDefault,resources:{extensions:1,skills:2,prompts:1,themes:0}}; catalog.push(item); }
      Object.assign(item,{source:sourceName,resolvedSource:currentOperation.resolvedSource,version:currentOperation.version});
    }
    if (location.pathname.startsWith('/admin/operations/')) render();
  }
}

function renderOperation() {
  // A direct reload is a labelled demonstration, never a claim about a real job.
  if (!operation) operation = {id:location.pathname.split('/').pop(),name:'workspace-tools',phase:5,source:'npm',resolvedSource:'原型演示来源'};
  const stages = ['已受理','解析来源','准备资源','校验内容','发布','已完成'];
  const done = operation.phase === 5;
  app.innerHTML = `<nav class="context-tabs"><button type="button" data-action="library">返回能力库</button></nav><div class="page-heading"><div><h1>${done ? 'Package 安装完成' : '正在安装 Package'}</h1><p>后台安装反馈演示。下方阶段为原型模拟数据。</p></div></div><section class="operation-surface"><div class="operation-title"><span class="kind-icon">${icon(done ? 'check' : 'refresh',23,done ? '' : 'spin')}</span><div><h2>${escapeHTML(operation.name)}</h2><p>${done ? '已发布到 Core 能力库' : stages[operation.phase]}</p></div></div><div class="operation-steps">${stages.map((stage,index) => `<div class="operation-step ${index < operation.phase ? 'done' : index === operation.phase ? 'current' : ''}">${stage}</div>`).join('')}</div><dl class="metadata"><dt>操作 ID</dt><dd>${escapeHTML(operation.id)} ${button(icon('copy',13),'copy-operation','icon ghost','aria-label="复制操作 ID"')}</dd><dt>来源</dt><dd>${escapeHTML(operation.source)}</dd><dt>当前阶段</dt><dd>${stages[operation.phase]} <span class="small muted">(${['queued','source','prepare','validate','publish','succeeded'][operation.phase]})</span></dd><dt>结果</dt><dd>${done ? 'Package 已安装'+(operation.addDefault ? '，已加入默认 Work。' : '，未更改默认 Work。') : '已受理，等待安装完成。'}</dd></dl><div class="operation-foot"><p>正式产品中，关闭页面不会取消已受理的安装任务。</p>${button(done ? '查看 Package' : '返回能力库',done ? 'view-installed' : 'library',done ? 'primary' : '')}</div></section>`;
}

function defaultsPreview() {
  closeItemMenu();if(flowDialog.open)flowDialog.close();showDefaultsView(true);
}

function removeItem(key) {
  const item=catalog.find(item=>itemKey(item)===key);if(!item)return;
  if(item.isDefault){protectedDefault(item);return;}
  flow={removeKey:key};
  flowShell(`移除 ${item.name}？`,'',`<p class="confirm-note">移除后，新 Work 将无法选用此${item.kind==='skill'?' Skill':' Package'}。已有 Work 中的副本会保留。${key===selected&&isDirty()?'此 Skill 中未保存的修改也会被放弃。':''}</p>`,`<div class="heading-actions">${button('取消','close-flow')}${button('移除','confirm-remove','danger')}</div>`);
  if(!flowDialog.open)flowDialog.showModal();
}

function protectedDefault(item) {
  flow=null;
  flowShell(`${item.name} 正在默认选用`,'',`<p class="confirm-note">请先在“新 Work 默认”中移除此项，再禁用或移除${item.kind==='skill'?' Skill':' Package'}。</p>`,`${button('返回','close-flow')}${button('前往新 Work 默认','defaults','primary')}`);
  if(!flowDialog.open)flowDialog.showModal();
}

function returnToLibrary() {
  history.pushState({},'',`/admin/packages?v=6${tab === 'package' ? '&type=packages' : ''}`);
  if(!findSelected()) { const first=filtered(tab)[0]; activateEntry(first?itemKey(first):null); } else render();
}

function focusCatalogButton(key) {
  [...document.querySelectorAll('[data-action="catalog-more"]')].find(button=>button.dataset.key===key)?.focus();
}

function closeItemMenu(restoreFocus=false) {
  const menu=$('#catalog-menu');if(!menu||menu.hidden)return;
  menu.hidden=true;menuTrigger?.setAttribute('aria-expanded','false');
  const key=menuOwnerKey;menuOwnerKey=null;menuTrigger=null;
  if(restoreFocus)focusCatalogButton(key);
}

function openCatalogMenu(trigger) {
  const key=trigger.dataset.key;
  const menu=$('#catalog-menu');
  if(!menu.hidden&&menuOwnerKey===key){closeItemMenu(true);return;}
  closeItemMenu();
  const item=catalog.find(item=>itemKey(item)===key);if(!item)return;
  const kind=item.kind==='skill'?'Skill':'Package';
  menuOwnerKey=key;menuTrigger=trigger;
  menu.setAttribute('aria-label',`${item.name} 的操作`);
  menu.innerHTML=`<div class="menu-target" role="presentation">${escapeHTML(item.name)}</div><button type="button" role="menuitem" data-action="skill-info" data-key="${escapeHTML(key)}">${kind} 信息</button><button type="button" role="menuitem" data-action="update" data-key="${escapeHTML(key)}">${item.kind==='skill'?'更新文件夹':'更新 Package'}</button><button type="button" role="menuitem" data-action="toggle" data-key="${escapeHTML(key)}">${item.enabled?'禁用':'启用'} ${kind}</button><button type="button" role="menuitem" class="danger-text" data-action="remove" data-key="${escapeHTML(key)}">移除 ${kind}</button>`;
  menu.hidden=false;trigger.setAttribute('aria-expanded','true');
  const box=trigger.getBoundingClientRect(),width=menu.offsetWidth,height=menu.offsetHeight;
  menu.style.left=`${Math.max(8,Math.min(box.right-width,innerWidth-width-8))}px`;
  menu.style.top=`${box.bottom+height+5<innerHeight?box.bottom+5:Math.max(8,box.top-height-5)}px`;
  menu.querySelector('[role="menuitem"]')?.focus();
}

document.addEventListener('click',async event => {
  const brand=event.target.closest('a.brand');
  if(brand&&isDirty()) { event.preventDefault(); requestTransition(()=>location.assign(brand.href)); return; }
  if (!event.target.closest('[data-action="catalog-more"],#catalog-menu')) closeItemMenu();
  const target = event.target.closest('[data-action]'); if (!target) return;
  const action = target.dataset.action;
  if (action === 'scope') {
    flow = null;
    flowShell(target.dataset.label,'本原型聚焦于 Skills 与 Packages 的信息结构及上传体验。','<p class="small muted">其他管理页面沿用现有产品。本入口用于保留真实导航上下文。</p>',button('返回能力库','close-flow','primary'));
    flowDialog.showModal();
  }
  if (action === 'library') { if(defaultsView){showDefaultsView(false);return;} if (flowDialog.open) flowDialog.close(); returnToLibrary(); }
  if (action === 'tab') switchTab(target.dataset.kind);
  if (action === 'refresh') toast('已刷新');
  if (action === 'clear-filter') { query = ''; render(); }
  if (action === 'detail') openDetail(target.dataset.key);
  if (action === 'folder') { const path=target.dataset.path; openFolders.has(path)?openFolders.delete(path):openFolders.add(path); render(); }
  if (action === 'open-file') {
    const path=target.dataset.path;
    if(editor?.path===path) { mobileDetail=true; render(); }
    else requestTransition(()=>void loadFileNow(path,true));
  }
  if (action === 'save-file') saveCurrentFile();
  if (action === 'cancel-transition') { pendingTransition=null; unsavedDialog.close(); }
  if (action === 'save-transition') finishTransition(true);
  if (action === 'discard-transition') finishTransition(false);
  if (action === 'back-to-list') { mobileDetail = false; render(); $('.skill-file-row.active-file')?.focus(); }
  if (action === 'skill-info') { const key=target.dataset.key;closeItemMenu();skillInfo(key); }
  if(action==='catalog-more')openCatalogMenu(target);
  if(action==='save-defaults')saveDefaults();
  if(action==='cancel-defaults')cancelDefaults();
  if(action==='move-default')moveDefaultDraft(target.dataset.key,target.dataset.direction);
  if(action==='work-view')showDefaultsView(target.dataset.view==='defaults');
  if (action === 'open-upload') requestTransition(()=>openUpload(target.dataset.kind));
  if (action === 'browse') $('#folder-input').click();
  if (action === 'close-flow') flowDialog.close();
  if (action === 'example') exampleSelection(target.dataset.example);
  if (action === 'source') {
    if (flow.selection && !window.confirm('切换来源将清除本次选择的文件。继续切换？')) return;
    flow.sourceType = target.dataset.source; flow.selection = null; flow.error = ''; flow.sourceText = ''; renderUpload();
  }
  if (action === 'submit-upload') void submitUpload();
  if (action === 'update') { closeItemMenu(); const item = catalog.find(item => itemKey(item) === target.dataset.key); if (item) requestTransition(()=>openUpload(item.kind,item.name)); }
  if (action === 'toggle') {
    closeItemMenu();
    const key=target.dataset.key; const item=catalog.find(item=>itemKey(item)===key); if(!item)return;
    if (item.isDefault && item.enabled) { protectedDefault(item); return; }
    item.enabled = !item.enabled; detailError = ''; render(); toast(`${item.enabled ? '已启用' : '已禁用'} ${item.name}`); focusCatalogButton(key);
  }
  if (action === 'remove') { closeItemMenu(); removeItem(target.dataset.key); }
  if(action==='confirm-remove'&&flow?.removeKey){
    const key=flow.removeKey,item=catalog.find(item=>itemKey(item)===key);if(!item)return;
    const current=selected===key;
    catalog.splice(catalog.indexOf(item),1);if(item.kind==='skill')fileStore.delete(item.name);
    flowDialog.close();flow=null;
    if(current){editor=null;const first=filtered(tab)[0];activateEntry(first?itemKey(first):null);}else render();
    toast(`已移除 ${item.name}`);
  }
  if (action === 'defaults') defaultsPreview();
  if (action === 'view-installed') { const item = catalog.find(item => item.kind === 'package' && item.name === operation.name); tab = 'package'; returnToLibrary(); if (item) openDetail(itemKey(item)); }
  if (action === 'copy-operation') {
    const input = document.createElement('textarea'); input.value = operation.id; input.style.position='fixed'; input.style.opacity='0'; document.body.append(input); input.select();
    try { const copied = document.execCommand('copy'); toast(copied ? '操作 ID 已复制。' : '请在详情中选择并复制操作 ID。'); } catch { toast('请在详情中选择并复制操作 ID。'); }
    input.remove(); target.focus();
  }
});

document.addEventListener('input',event => {
  if (event.target.id==='file-editor'&&editor) { editor.draft=event.target.value; updateEditorUI(); }
  if (event.target.id === 'catalog-search') { query = event.target.value; render(); }
  if (event.target.id === 'package-source' && flow) { flow.sourceText = event.target.value; const submit = flowDialog.querySelector('[data-action="submit-upload"]'); if (submit) submit.disabled = !flow.sourceText.trim(); }
});
document.addEventListener('change',event => {
  if(event.target.matches('[data-default-choice]'))changeDefaultDraft(event.target.dataset.defaultChoice,event.target.checked);
  if (event.target.id === 'add-default' && flow) flow.addDefault = event.target.checked;
});
document.addEventListener('keydown',event => {
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&editor&&!defaultsView&&!flowDialog.open&&!unsavedDialog.open) { event.preventDefault(); saveCurrentFile(); return; }
  const menu = $('#catalog-menu:not([hidden])');
  if (menu) {
    if (event.key === 'Escape') { event.preventDefault(); closeItemMenu(true); return; }
    if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault(); const entries = [...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')];
      const index = entries.indexOf(document.activeElement);
      entries[event.key === 'Home' ? 0 : event.key === 'End' ? entries.length-1 : (index+(event.key === 'ArrowDown' ? 1 : entries.length-1))%entries.length]?.focus();
      return;
    }
    if (event.key === 'Tab') closeItemMenu(true);
  }
  if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
  if (event.target.matches('input,textarea,select,[contenteditable="true"]') || flowDialog.open || unsavedDialog.open) return;
  const tabTarget = event.target.closest('[role="tab"]');
  if (tabTarget) {
    if(tabTarget.closest('.work-view-tabs')){event.preventDefault();showDefaultsView(!defaultsView);return;}
    event.preventDefault(); switchTab(tab==='skill'?'package':'skill'); document.querySelector('[role="tab"][aria-selected="true"]')?.focus(); return;
  }
});
flowDialog.addEventListener('close',() => { if (flow?.busy) flow = null; if(defaultsSurface==='dialog'){defaultsSurface='';defaultDraft=null;render();} });
window.addEventListener('resize',()=>closeItemMenu());
document.addEventListener('scroll',event=>{if(!event.target.closest?.('#catalog-menu'))closeItemMenu();},true);
unsavedDialog.addEventListener('close',()=>{ pendingTransition=null; updateEditorUI(); });
document.addEventListener('keyup',event=>{if(event.target.id==='file-editor')updateEditorUI();});
document.addEventListener('click',event=>{if(event.target.id==='file-editor')updateEditorUI();});
window.addEventListener('beforeunload',event=>{if(isDirty()||defaultsDirty()){event.preventDefault();event.returnValue='';}});
window.addEventListener('popstate',() => { requestTransition(()=>{tab = new URL(location.href).searchParams.get('type') === 'packages' ? 'package' : 'skill'; const first=filtered(tab)[0]; activateEntry(first?itemKey(first):null);}); });
seedSkillFiles();
syncURL();
activateEntry(tab==='skill'?'skill:code-review':itemKey(filtered('package')[0]));
