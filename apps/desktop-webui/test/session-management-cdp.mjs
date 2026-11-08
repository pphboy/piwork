import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../dist', import.meta.url));
const names=[{sessionId:'session-1',title:null,titleSource:'default',revision:0,manualLock:false,deletedAt:null,autoState:'eligible'},{sessionId:'session-2',title:null,titleSource:'default',revision:0,manualLock:false,deletedAt:null,autoState:'eligible'}];
const operations=new Map();
const createdSessions=new Map();
let createCount=0, createMode='normal', deleteMode='normal', releaseCreate;
const server=createServer(async(req,res)=>{
  const url = new URL(req.url, 'http://localhost'), path = url.pathname.replace('/_desktop/api/', ''), method = req.method;
  let body = '';
  for await (const chunk of req) body += chunk;
  const send = (value, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  };
 if(url.pathname.startsWith('/_desktop/')) {
   const state = (s) => ({ workId: 'work-1', ...s });
   const listed = (s) => ({ workId: 'work-1', sessionId: s.sessionId, title: s.title, titleSource: s.titleSource, titleRevision: s.revision, manualTitleLock: s.manualLock, deletedAt: s.deletedAt, autoNameState: s.autoState });
  const target=names.find(s=>path.includes('/sessions/'+s.sessionId));
  if(path==='session')return send({state:'authenticated',generation:1,csrf:'local-session-csrf',coreUrl:'http://core.test',user:{account:'owner',role:'user'}});
  if(path==='preferences')return send({coreUrl:null});
  if(path==='status')return send({health:{available:true},readiness:{available:true,value:{ready:true}}});
  if(path==='works')return send({works:[{id:'work-1',name:'Recovery Work',observedState:'ready',desiredState:'running'}]});
  if(path==='works/work-1')return send({id:'work-1',name:'Recovery Work',observedState:'ready',desiredState:'running'});
  if(path==='known-operations')return send({operations:[]});
  if(path==='skills')return send({skills:[]});
  if(path==='packages'||path.endsWith('/packages'))return send({packages:[]});
  if(path.endsWith('/services'))return send({services:[]});
  if(path.endsWith('/configuration'))return send({desired:{skills:[],packages:[],agentsMd:'',modelRef:null,mcp:{servers:[]}},active:{skills:[],packages:[],agentsMd:'',modelRef:null,mcp:{servers:[]}},pendingApply:false,runtime:{state:'ready'}});
  if(path.endsWith('/session-management-capabilities'))return send({contractVersion:1});
  if(path.endsWith('/models'))return send({models:[],defaultModel:{modelRef:null,label:'Work model',provider:'fixture',model:'one'},availability:'available',checkedAt:new Date().toISOString()});
  if(path.endsWith('/sessions')&&method==='POST'){
   const input=JSON.parse(body), number=++createCount;
   if(createMode==='failure')return send({code:'WORK_BUSY'},409);
   const created={sessionId:`session-new-${number}`,title:null,titleSource:'default',revision:0,manualLock:false,deletedAt:null,autoState:'eligible'};
    names.push(created);
    createdSessions.set(input.idempotencyKey, created);
    if (createMode === 'unknown') {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.write('{\"partial\":');
      setTimeout(() => res.destroy(), 20);
      return;
    }
   if(createMode==='delayed')await new Promise(resolve=>{releaseCreate=resolve;});
   return send(listed(created),201);
  }
  if(path.includes('/sessions/submissions/')){
   const key=path.split('/').at(-1),created=createdSessions.get(key);
   return send(created?{kind:'session',key,status:'accepted',session:listed(created)}:{kind:'session',key,status:'not-found'});
  }
  if(path.endsWith('/sessions')&&method==='GET')return send({sessions:names.filter(s=>!s.deletedAt).map(listed)});
  if(target&&path.endsWith('/management')&&method==='GET')return send(state(target));
   if (target && path.endsWith('/name') && method === 'PATCH') {
     const b = JSON.parse(body);
     Object.assign(target, { title: b.title, titleSource: 'manual', manualLock: true, revision: target.revision + 1 });
     operations.set(b.operationKey, { operationKey: b.operationKey, status: 'accepted', kind: 'rename', state: state(target) });
     return send(state(target));
   }
   if (target && path.endsWith('/auto-name') && method === 'POST') {
     const b = JSON.parse(body);
     Object.assign(target, { title: 'Session session-2', titleSource: 'auto', revision: target.revision + 1, autoState: 'completed' });
     return send({ operationKey: b.operationKey, status: 'accepted', kind: 'auto-name', state: state(target) });
   }
   if (target && path.endsWith('/delete') && method === 'POST') {
     const b = JSON.parse(body);
     target.deletedAt = new Date().toISOString();
     target.revision++;
     operations.set(b.operationKey, { operationKey: b.operationKey, status: 'accepted', kind: 'delete', state: state(target) });
     if (deleteMode === 'unknown') {
       res.writeHead(200, { 'content-type': 'application/json' });
       res.write('{\"partial\":');
       setTimeout(() => res.destroy(), 20);
       return;
     } return send(state(target));
   }
  if(target&&path.includes('/management-operations/'))return send(operations.get(path.split('/').at(-1))||{operationKey:path.split('/').at(-1),status:'not-found'});
  if(target&&path.endsWith('/'+target.sessionId))return send({session:{...listed(target),modelPreference:null,source:{kind:'chat'}},messages:[],runs:[]});
  return send({code:'NOT_FOUND'},404);
 }
 let assetPath=url.pathname.startsWith('/desktop/browser/')?join(root,'browser',url.pathname.slice('/desktop/browser/'.length)):join(root,'public',url.pathname==='/style.css'?'style.css':'index.html');
  try {
    const data = await readFile(assetPath);
    res.writeHead(200, { 'content-type': assetPath.endsWith('.js') ? 'application/javascript' : assetPath.endsWith('.css') ? 'text/css' : 'text/html' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=await mkdtemp(join(tmpdir(),'piwork-cdp-'));
const chrome=spawn(process.env.PIWORK_TEST_BROWSER_BIN || '/usr/bin/chromium-browser',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
let connection;
try{
  const endpoint = await new Promise((resolve, reject) => {
    let data = '';
    let timer = setTimeout(() => reject(new Error('Chromium start timed out')), 15000);
    chrome.stderr.on('data', chunk => {
      data += chunk;
      const m = data.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    chrome.on('exit', code => reject(new Error('Chromium exited ' + code)));
  });
  const ws = new WebSocket(endpoint);
  connection = ws;
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  };
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const target = await call('Target.createTarget', { url: 'about:blank' });
  const attached = await call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const sid = attached.sessionId;
  const run = async expression => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sid);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const wait = async (expr, label) => {
    for (let i = 0; i < 150; i++) {
      if (await run(expr)) return;
      await new Promise(r => setTimeout(r, 100));
    } throw new Error('Timed out: ' + label + '; visible=' + await run('document.body.innerText.slice(0,800)'));
  };
 for(const width of [1440]){
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false},sid);
  await call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/#/work/work-1`},sid);
  await wait("!!document.querySelector('[data-action=\"sessions\"]')",'session trigger');
  await run("document.querySelector('[data-action=\"sessions\"]').click()");
  await wait("document.querySelectorAll('.session-choice-row').length===2 && !!document.querySelector('[data-action=\"new-session\"]') && !!document.querySelector('[data-action=\"toggle-session-menu\"]:not([disabled])')",'session list');
  assert.equal(await run("document.querySelectorAll('.session-choice-row').length"),2);
  assert.equal(await run("document.querySelector('[data-action=\"select-session\"][data-id=\"session-1\"]').innerText"),'Session 1');
  assert.equal(await run("document.querySelector('[data-action=\"select-session\"][data-id=\"session-2\"]').innerText"),'Session 2');
  names.reverse();
  await run("(async()=>{const {adapter}=await import('/desktop/browser/adapter.js');await adapter.loadSessions('work-1')})()");
  await wait("document.querySelector('[data-action=\"select-session\"][data-id=\"session-1\"]')?.innerText==='Session 2'",'list position renumbered');
  names.reverse();
  await run("(async()=>{const {adapter}=await import('/desktop/browser/adapter.js');await adapter.loadSessions('work-1')})()");
  await wait("document.querySelector('[data-action=\"select-session\"][data-id=\"session-1\"]')?.innerText==='Session 1'",'original list order restored');
  await run("document.querySelectorAll('[data-action=\"toggle-session-menu\"]')[1].click()");
  await wait("!!document.querySelector('[data-action=\"rename-session\"]')",'row menu');
  await run("document.querySelector('[data-action=\"rename-session\"]').click()");
  await wait("!!document.querySelector('#session-name')",'rename dialog');
  const title=`CDP renamed ${width} ${'界'.repeat(60)}`;
  await run(`document.querySelector('#session-name').value=${JSON.stringify(title)};document.querySelector('#session-name').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#session-name').focus()`);
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},sid);
  await wait(`document.body.innerText.includes(${JSON.stringify(title)})`,'long rename result');
  await run("document.querySelector('[data-action=\"rename-session\"]').click()");
  await wait("!!document.querySelector('#session-name')",'reserved-like title input');
  await run("document.querySelector('#session-name').value='Session session-2';document.querySelector('#session-name').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#session-name').focus()");
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},sid);
  await wait("document.querySelector('[data-action=\"select-session\"][data-id=\"session-2\"]')?.innerText.includes('Session session-2')",'saved title is displayed exactly');
  await wait("!!document.querySelector('[data-action=\"auto-name-session\"]')",'auto name action');
  await run("document.querySelector('[data-action=\"auto-name-session\"]').click()");
  await wait("(async()=>{const {adapter}=await import('/desktop/browser/adapter.js');const item=adapter.getWork('work-1').sessions.find(s=>s.id==='session-2');return item?.titleSource==='auto' && document.querySelector('[data-action=\"select-session\"][data-id=\"session-2\"]')?.innerText.includes('Session session-2')})()",'automatic title is displayed exactly');
  await run("document.querySelector('[data-action=\"delete-session\"]').click()");
  await wait("!!document.querySelector('[data-action=\"confirm-delete-session\"]')",'delete confirmation');
  await run("document.querySelector('[data-action=\"close-modal\"]').click()");
  await wait("!!document.querySelector('[data-action=\"delete-session\"]')",'cancel deletion');
  assert.equal(names[1].deletedAt,null);
  console.log(`Chromium CDP width ${width}: compact Session list, row menu, rename, Auto name and cancel delete passed`);
 }
 for(let i=0;i<30;i++)names.push({sessionId:`scroll-${i}`,title:null,titleSource:'default',revision:0,manualLock:false,deletedAt:null,autoState:'eligible'});
 await run("(async()=>{const {adapter}=await import('/desktop/browser/adapter.js');await adapter.loadSessions('work-1')})()");
 await wait("document.querySelectorAll('.session-choice-row').length===32",'long Session list');
 assert.equal(await run("(()=>{const body=document.querySelector('#modal .modal-body');body.scrollTop=body.scrollHeight;return body.scrollTop>0})()"),true);
 await run("document.querySelector('[data-action=\"toggle-session-menu\"][data-session=\"scroll-29\"]').click()");
 await wait("!!document.querySelector('.session-row-menu') && getComputedStyle(document.querySelector('.session-row-menu')).visibility==='visible'",'scrolled row menu');
 names.splice(2,30);
 await run("(async()=>{const {adapter}=await import('/desktop/browser/adapter.js');await adapter.loadSessions('work-1')})()");
 await wait("document.querySelectorAll('.session-choice-row').length===2",'restore Session list');
 await run("document.querySelector('[data-action=\"toggle-session-menu\"][data-session=\"session-2\"]').click()");
 await run("document.querySelector('[data-action=\"delete-session\"]').click()");
 await wait("!!document.querySelector('[data-action=\"confirm-delete-session\"]')",'confirm delete');
 await run("document.querySelector('[data-action=\"confirm-delete-session\"]').click()");
 await wait("document.querySelectorAll('.session-choice-row').length===1",'deleted row removed');
 assert.equal(createCount,0,'deleting another Session must not create one');
 await run("document.querySelector('[data-action=\"new-session\"]').click()");
 await wait("!!document.querySelector('.chat-welcome') && document.querySelector('.messages').dataset.readingKey.includes('session-new-1')",'new empty Session');

 const openPicker=async()=>{
  if(!await run("!!document.querySelector('#modal .session-list')"))await run("document.querySelector('[data-action=\"sessions\"]').click()");
  await wait("!!document.querySelector('#modal .session-list')",'Session picker');
 };
 const deleteSession=async sessionId=>{
  await openPicker();
  await run(`document.querySelector('[data-action="toggle-session-menu"][data-session="${sessionId}"]').click();document.querySelector('[data-action="delete-session"]').click()`);
  await wait("!!document.querySelector('[data-action=\"confirm-delete-session\"]')",'delete confirmation');
  await run("document.querySelector('[data-action=\"confirm-delete-session\"]').click()");
 };
 const selected=async sessionId=>wait(`document.querySelector('.messages')?.dataset.readingKey.includes(${JSON.stringify(sessionId)}) && !!document.querySelector('.chat-welcome')`, `selected ${sessionId}`);
 await deleteSession('session-new-1');
 await selected('session-new-2');
 assert.equal(createCount,2,'deleting current Session creates exactly one replacement');
 assert.ok(names.some(s=>s.sessionId==='session-1' && !s.deletedAt),'other Session is retained');
 await deleteSession('session-1');
 await wait("document.querySelectorAll('.session-choice-row').length===1",'only replacement remains');
 assert.equal(createCount,2,'deleting another Session must not create one');
 createMode='failure';
 await deleteSession('session-new-2');
 await wait("document.body.innerText.includes('The Session was deleted, but a new Session could not be created')",'replacement failure');
 assert.equal(createCount,3);
 assert.equal(names.filter(s=>!s.deletedAt).length,0);
 await run("document.querySelector('#modal [data-action=\"close-modal\"]').click()");
 createMode='normal';
 await run("document.querySelector('.composer-wrap [data-action=\"new-session\"]').click()");
 await selected('session-new-4');
 assert.equal(createCount,4,'a known failure is retried only by the user');
 createMode='unknown';
 await deleteSession('session-new-4');
 await wait("!!document.querySelector('[data-action=\"check-session-creation\"]')",'unknown replacement result');
 assert.equal(createCount,5);
 await run("document.querySelector('#modal [data-action=\"close-modal\"]').click()");
 await run("document.querySelector('[data-action=\"check-session-creation\"]').click()");
 await selected('session-new-5');
 assert.equal(createCount,5,'unknown creation is checked by original key without replay');
 names.push({sessionId:'session-stay',title:null,titleSource:'default',revision:0,manualLock:false,deletedAt:null,autoState:'eligible'});
 await run("(async()=>{const {adapter}=await import('/desktop/browser/adapter.js');await adapter.loadSessions('work-1')})()");
 createMode='delayed';
 await deleteSession('session-new-5');
 for(let i=0;i<150 && !releaseCreate;i++)await new Promise(resolve=>setTimeout(resolve,100));
 assert.ok(releaseCreate,'replacement request started');
 await openPicker();
 await run("document.querySelector('[data-action=\"select-session\"][data-id=\"session-stay\"]').click()");
 await wait("document.querySelector('.messages')?.dataset.readingKey.includes('session-stay')",'user changed Session');
 releaseCreate();
 await new Promise(resolve=>setTimeout(resolve,300));
 assert.ok((await run("document.querySelector('.messages').dataset.readingKey")).includes('session-stay'),'late creation cannot steal selection');
 createMode='normal';
 deleteMode='unknown';
 await deleteSession('session-stay');
 await wait("!!document.querySelector('[data-action=\"check-session-operation\"]')",'unknown deletion');
 assert.equal(createCount,6,'unknown deletion must not create a Session');
 deleteMode='normal';
 await run("document.querySelector('[data-action=\"check-session-operation\"]').click()");
 await selected('session-new-7');
 assert.equal(createCount,7,'confirmed original deletion starts one replacement');
 createMode='unknown';
 await deleteSession('session-new-7');
 await wait("!!document.querySelector('[data-action=\"check-session-creation\"]')",'unknown replacement that was later deleted');
 const laterDeleted=names.find(s=>s.sessionId==='session-new-8');
 assert.ok(laterDeleted);
 laterDeleted.deletedAt=new Date().toISOString();
 await run("document.querySelector('#modal [data-action=\"close-modal\"]').click()");
 await run("document.querySelector('[data-action=\"check-session-creation\"]').click()");
 await wait("document.body.innerText.includes('The Session was deleted, but a new Session could not be created')",'deleted creation receipt can be retried');
 assert.equal(createCount,8,'deleted receipt does not automatically create again');
 createMode='normal';
 await run("document.querySelector('.composer-wrap [data-action=\"new-session\"]').click()");
 await selected('session-new-9');
 createMode='delayed';
 releaseCreate=undefined;
 await deleteSession('session-new-9');
 for(let i=0;i<150 && !releaseCreate;i++)await new Promise(resolve=>setTimeout(resolve,100));
 assert.ok(releaseCreate,'replacement before navigation started');
 await run("location.hash='#/works'");
 await wait("!!document.querySelector('.works-page')",'navigate away from Work');
 releaseCreate();
 await new Promise(resolve=>setTimeout(resolve,300));
 assert.equal(await run("location.hash"),'#/works','late creation cannot undo navigation');
 createMode='normal';
 await run("location.hash='#/work/work-1'");
 await wait("!!document.querySelector('[data-action=\"sessions\"]')",'return to Work');
 await openPicker();
 names.push({sessionId:'legacy-session',title:null,titleSource:'default',revision:0,manualLock:false,deletedAt:null,autoState:'eligible'});
 await run("(async()=>{const {adapter}=await import('/desktop/browser/adapter.js');adapter.sessionManagement.capabilities.set('work-1',{loading:false,confirmed:true,supported:false,error:''});await adapter.loadSessions('work-1');adapter.emit()})()");
 await wait("!!document.querySelector('[data-action=\"toggle-session-menu\"][data-session=\"legacy-session\"]')",'legacy Session');
 assert.equal(await run("document.querySelector('[data-action=\"toggle-session-menu\"][data-session=\"legacy-session\"]').disabled"),true);
 console.log('Chromium CDP: replacement success, failure, unknown result and selection races passed');

} finally {
  connection?.close();
  chrome.kill('SIGTERM');
  await new Promise(resolve => {
    if (chrome.exitCode !== null || chrome.signalCode !== null) return resolve();
    chrome.once('exit', resolve);
  });
  server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
