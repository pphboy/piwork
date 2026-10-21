// WARN 1 acceptance: a real browser in a separate namespace with a deny-by-default firewall.
// Run from the repository: node openspec/changes/separate-control-plane-and-core/fixtures/restricted-network.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {restrictedBrowser} from './network-client.mjs';
import {expect} from '@playwright/test';

const root=resolve(import.meta.dirname,'../../../..');
const out=join(root,'dist/separate-control-plane/network');mkdirSync(out,{recursive:true,mode:0o700});
const metadata=JSON.parse(readFileSync(join(root,'dist/separate-control-plane/network/release-inputs/metadata.json')));
const base=JSON.parse(readFileSync(join(root,'dist/web-base/candidate.json')));
const model=parseEnv(readFileSync(join(root,'.env.test'),'utf8'));
const password='synthetic-cold-install-password';
const id='piwork-network-'+randomUUID(),label='piwork.acceptance.fixture='+id;
const registry=id+'-registry',objects=[],volumes=[],localTags=[];
const report={releaseId:metadata.releaseId,sourceInputHash:metadata.sourceInputHash,webBaseImageId:base.imageId,modes:[],scope:'WARN 1: separate client namespace; only server 17891 allowed'};
const save=(name,value)=>writeFileSync(join(out,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
const clean=s=>String(s).replaceAll(model.PIWORK_MODEL_API_KEY||'unlikely-empty-key','[redacted]');
async function command(args,input,allow=false){
  const child=spawn('docker',args,{cwd:root,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.stdin.on('error',()=>{});child.stdin.end(input);
  const code=await new Promise((done,reject)=>{child.on('error',reject);child.on('close',done)});
  if(code&&!allow)throw Error('Docker '+args[0]+' failed ('+code+'); private diagnostics retained');
  return{code,stdout,stderr};
}
const docker=async args=>(await command(args)).stdout.trim();
async function wait(fn,title,timeout=240000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,300))}throw Error('Timed out: '+title)}
async function loadCore(engine){
  const source=spawn('docker',['save',metadata.images.core],{stdio:['ignore','pipe','pipe']});
  const target=spawn('docker',['exec','-i',engine,'docker','load'],{stdio:['pipe','pipe','pipe']});
  source.stdout.pipe(target.stdin);target.stdin.on('error',()=>{});source.stderr.resume();target.stderr.resume();target.stdout.resume();
  const codes=await Promise.all([source,target].map(c=>new Promise((done,reject)=>{c.on('error',reject);c.on('close',done)})));
  assert.deepEqual(codes,[0,0]);
}
async function runMode(mode,mirror){
  const engine=id+'-'+mode,engineVolume=engine+'-engine',dataVolume=engine+'-data';
  const record={mode,releaseId:metadata.releaseId,steps:[],browserRequests:[],blocked:[]};report.modes.push(record);
  const step=s=>{record.steps.push(s);console.log(mode+': '+s)};
  let coreName,browser,context,installation,clientAccess;
  const inside=args=>docker(['exec',engine,'docker',...args]);
  // curl's stdin config keeps passwords, tokens, source bytes and model secrets out of arguments/logs.
  let token='';
  async function api(path,method='GET',body,raw=false){
    const config=['url = '+JSON.stringify('http://127.0.0.1:17871'+path),'request = '+JSON.stringify(method),'silent','show-error'];
    if(token)config.push('header = '+JSON.stringify('Authorization: Bearer '+token));
    if(body!==undefined){if(!raw)config.push('header = "Content-Type: application/json"');config.push('data-binary = '+JSON.stringify(raw?body:JSON.stringify(body)))}
    const r=await command(['exec','-i',engine,'docker','exec','-i',coreName,'curl','--config','-','--write-out','\n%{http_code}'],config.join('\n')+'\n');
    const split=r.stdout.lastIndexOf('\n'),status=Number(r.stdout.slice(split+1)),text=r.stdout.slice(0,split);
    assert(status>=200&&status<300,'Core '+method+' '+path+' returned '+status);
    if(raw&&method==='GET')return text;return text?JSON.parse(text):{};
  }
  async function operation(operationId){return wait(async()=>{const o=await api('/api/v1/operations/'+operationId);assert.notEqual(o.state,'failed','Operation failed: '+(o.error?.code||''));return o.state==='succeeded'},'operation')}
  try{
    for(const name of[engineVolume,dataVolume]){await docker(['volume','create','--label',label,name]);volumes.push(name)}
    await docker(['run','-d','--privileged','--name',engine,'--label',label,'--network','bridge',
      '--env','DOCKER_TLS_CERTDIR=','--mount',`type=volume,src=${engineVolume},dst=/var/lib/docker`,'--mount',`type=volume,src=${dataVolume},dst=/data`,
      'docker:28-dind','--host=unix:///var/run/docker.sock','--tls=false','--bip=172.30.0.1/24','--default-address-pool=base=10.210.0.0/16,size=24','--registry-mirror='+mirror,'--insecure-registry='+new URL(mirror).host]);objects.push(engine);
    await wait(async()=>(await command(['exec',engine,'docker','info'],undefined,true)).code===0,'empty Engine');
    record.engineVersion=await inside(['version','--format','{{.Server.Version}}']);assert(Number(record.engineVersion.split('.')[0])>=28);
    assert.equal(await inside(['image','ls','-q']),'');record.initialImageCount=0;
    await loadCore(engine);
    const before=JSON.parse(await inside(['image','inspect',metadata.images.core]));assert.equal(before.length,1);
    assert.equal((await inside(['image','ls','-q'])).split('\n').filter(Boolean).length,1);
    record.onlyInstallerPreloaded=true;
    for(const role of['agent','fileHelper','snapshotHelper'])assert.notEqual((await command(['exec',engine,'docker','image','inspect',metadata.images[role]],undefined,true)).code,0);
    const data='/data/'+mode;await docker(['exec',engine,'mkdir','-p','-m','700',data]);
    if(mode==='run'){
      coreName='piwork-cold-core';await inside(['run','-d','--name',coreName,'--network','host','--init','--user','0:0',
        '--mount','type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock','--mount',`type=bind,src=${data},dst=${data}`,
        metadata.images.core,'serve','--data-dir',data,'--no-open','--core-listen','0.0.0.0:17871']);
    }else{
      const template=readFileSync(join(root,'deploy/docker/docker-compose.yml.template'),'utf8');
      const yaml=template.replace('name: piwork-quickstart','name: piwork-cold-compose').replace('@PIWORK_CORE_IMAGE@',metadata.images.core)
        .replaceAll('/var/lib/piwork/quickstart/core',data).replace('    init: true',`    command: ["serve", "--data-dir", "${data}", "--no-open", "--core-listen", "0.0.0.0:17871"]\n    init: true`).replace('restart: unless-stopped','restart: "no"');
      const file=join(out,'compose-cold.yaml');writeFileSync(file,yaml);await docker(['cp',file,engine+':/data/compose.yaml']);
      await inside(['compose','-f','/data/compose.yaml','up','-d','--no-build','--pull','never']);coreName=await inside(['compose','-f','/data/compose.yaml','ps','-q','core']);
    }
    const image=JSON.parse(await inside(['inspect',coreName]))[0];assert.equal(image.Config.Env.some(x=>/^PIWORK_(ADMIN|MODEL)/.test(x)),false);
    record.businessEnv=false;record.coreImageId=image.Image;
    const serverIP=await docker(['inspect','--format','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',engine]);
    const origin='http://'+serverIP+':17891';record.origin=origin;record.network='separate client network namespace; firewall permits server 17891 only';
    await wait(async()=>{try{return(await fetch(origin+'/healthz')).ok}catch{return false}},'ControlPlane');
    record.managementCoreReachable=(await fetch('http://'+serverIP+':17871/control/status')).status===200;assert(record.managementCoreReachable);
    clientAccess=await restrictedBrowser({docker,command,id,label,mode,serverIP,root,record,objects});browser=clientAccess.browser;
    record.serverNamespace=await docker(['exec',engine,'readlink','/proc/self/ns/net']);assert.notEqual(record.serverNamespace,clientAccess.namespace);
    context=await browser.newContext();record.browser=browser.version();
    context.on('request',request=>{const u=new URL(request.url());if(u.origin!==origin)record.blocked.push({origin:u.origin,path:u.pathname});record.browserRequests.push({method:request.method(),path:u.pathname})});
    record.browserSockets=[];context.on('page',p=>p.on('websocket',socket=>{const u=new URL(socket.url());record.browserSockets.push({origin:u.origin.replace(/^ws/,'http'),path:u.pathname})}));
    const page=await context.newPage();await page.goto(origin);
    await expect(page.getByRole('heading',{name:'Create your administrator',exact:true})).toBeVisible();
    await page.getByLabel('Account',{exact:true}).fill('cold-admin');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByLabel('Confirm password',{exact:true}).fill(password);
    await page.getByRole('button',{name:'Create administrator',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign in to Piwork',exact:true})).toBeVisible();
    await page.getByLabel('Account',{exact:true}).fill('cold-admin');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(u=>u.pathname!=='/login');
    await page.goto(origin+'/admin/setup');await expect(page.getByRole('heading',{name:'Quick setup',exact:true})).toBeVisible();
    await page.getByLabel('Model ID',{exact:true}).fill(model.PIWORK_MODEL_ID);await page.getByLabel('API type',{exact:true}).selectOption('anthropic-messages');
    await page.getByLabel('Base URL',{exact:true}).fill(model.PIWORK_MODEL_BASE_URL);await page.getByLabel('API Key',{exact:true}).fill(model.PIWORK_MODEL_API_KEY);
    assert.equal(await page.locator('input[name=agentImage]').count(),0);await page.getByRole('button',{name:'Save and continue',exact:true}).click();
    await wait(async()=>{const r=await page.evaluate(async()=>(await fetch('/_web/api/onboarding')).json());return r.status?.ready},'cold dependency preparation');
    const runtime=await page.evaluate(async()=>(await fetch('/console/api/admin/runtime')).json());assert.equal(runtime.agentImage,metadata.images.agent);
    step('Empty Engine pulled fixed release dependencies; browser administrator and Runtime setup completed without business env');
    token=(await api('/api/v1/login','POST',{account:'cold-admin',password})).token;
    const pulled={};for(const role of['agent','fileHelper','snapshotHelper']){const actual=JSON.parse(await inside(['image','inspect',metadata.images[role]]))[0];const donor=JSON.parse(await docker(['image','inspect',metadata.images[role]]))[0];assert.equal(actual.Id,donor.Id);pulled[role]=actual.Id;}record.pulledImages=pulled;
    await page.getByRole('link',{name:'Open workbench',exact:true}).click();await page.getByRole('button',{name:'New Work',exact:true}).first().click();await page.locator('#create-name').fill('Cold '+mode);await page.getByRole('button',{name:'Create Work',exact:true}).click();
    const work=await wait(async()=>{const list=await api('/api/v1/works');return list.works.find(w=>w.name==='Cold '+mode)},'accepted Work');record.workId=work.id;
    await wait(async()=>(await api('/api/v1/works/'+work.id)).observedState==='ready','Work ready');await page.getByRole('button',{name:'Close dialog'}).click();
    await page.goto(origin+'/#/work/'+work.id);await expect(page.locator('.work-header')).toContainText('Ready');await page.locator('#composer').fill('Reply exactly PIWORK_OK. Do not use any tools.');
    const accepted=page.waitForResponse(r=>new URL(r.url()).pathname===`/_desktop/api/works/${work.id}/runs`&&r.request().method()==='POST');await page.getByRole('button',{name:'Send message',exact:true}).click();
    const run=(await(await accepted).json()).run;const reply=await wait(async()=>{const r=await api(`/api/v1/works/${work.id}/runs/${run.runId}`);assert(![5,6,7].includes(r.state),'Real model Run failed');return r.state===4?r:false},'real model reply');assert(reply.finalText?.trim());record.runId=run.runId;record.replyBytes=Buffer.byteLength(reply.finalText);record.coldInstallSuccess=true;step('Cold installation created Work and received a real model reply');
    await expect(page.getByText(reply.finalText.trim(),{exact:true}).first()).toBeVisible({timeout:30000});
    await configurationAndFiles({page,work,record,step});
    const entries=await automaticUpdate({page,context,origin,work,api,operation,record,step});
    const containers=JSON.parse(await inside(['inspect',...(await inside(['ps','-q','--filter','label=piwork.resource_kind=service'])).split('\n').filter(Boolean)]));
    const serviceIPs=[...new Set(containers.flatMap(c=>Object.values(c.NetworkSettings.Networks).map(n=>n.IPAddress)))];await clientAccess.prove(serviceIPs);
    await networkWorkflow({page,context,origin,work,api,operation,record,step,entries});
    await clientAccess.prove(serviceIPs);assert(record.browserSockets.length>0);assert(record.browserSockets.every(s=>s.origin===origin&&s.path.startsWith('/services/')));
    assert.equal(record.blocked.length,0);record.success=true;
    installation=JSON.parse(await inside(['exec',coreName,'cat',data+'/core-format.json'])).installationId;
    await inside(['stop','--time','60',coreName]);assert.equal(await inside(['ps','-q','--filter','label=piwork.installation_id='+installation]),'');record.gracefulStopConfirmed=true;
    const logs=await command(['logs',engine],undefined,true);writeFileSync(join(out,mode+'-engine.log'),clean(logs.stdout+logs.stderr),{mode:0o600});
  }finally{
    if(coreName){const log=await command(['exec',engine,'docker','logs',coreName],undefined,true);writeFileSync(join(out,mode+'-core.log'),clean(log.stdout+log.stderr),{mode:0o600});}
    const daemonLog=await command(['logs',engine],undefined,true);writeFileSync(join(out,mode+'-engine.log'),clean(daemonLog.stdout+daemonLog.stderr),{mode:0o600});
    if(clientAccess)await clientAccess.close();else await browser?.close();
    // Only these fresh Engines and volumes belong to this fixture. Outer installations are untouched.
    await command(['rm','-f','-v',engine],undefined,true);objects.splice(objects.indexOf(engine),1);
    for(const volume of[engineVolume,dataVolume]){await command(['volume','rm',volume],undefined,true);volumes.splice(volumes.indexOf(volume),1)}
    save(mode+'-cold-result.json',record);
  }
}

async function automaticUpdate({page,context,origin,work,api,operation,record,step}){
  const folder='/api/v1/works/'+work.id+'/files/apps';await api(folder,'MKCOL');
  for(const name of['update-one','update-two']){
    await api(folder+'/'+name,'MKCOL');
    for(const file of readdirSync(join(root,'internal/coreassets/piwork-brain/templates/web-app')).filter(n=>!n.endsWith('.md'))){
      const p=join(root,'internal/coreassets/piwork-brain/templates/web-app',file);try{await api(folder+'/'+name+'/'+file,'PUT',readFileSync(p,'utf8'),true)}catch(e){if(e.code!=='ENOENT')throw e}
    }
  }
  const entries=[];
  for(const name of['update-one','update-two']){
    const app='/var/data/workspace/apps/'+name;
    const accepted=await api(`/api/v1/works/${work.id}/services`,'POST',{definition:{name,image:{reference:base.reference},command:'sh',args:['-c',`piwork-web prepare --app ${app} && exec piwork-web run --app ${app}`],workingDirectory:app,mounts:[{source:'workspace',target:'/var/data/workspace',readOnly:false}],ports:[{name:'web',protocol:'tcp',containerPort:8080}],readiness:{kind:'http',portName:'web',path:'/health',deadlineMs:120000}},idempotencyKey:'create-'+name});await operation(accepted.operationId);
    await wait(async()=>(await api(`/api/v1/works/${work.id}/services/${accepted.serviceId}`)).observedState==='ready','template ready');
    const entry=await page.evaluate(async target=>{const s=await(await fetch('/_web/api/session')).json();const r=await fetch('/_desktop/api/service-entries',{method:'POST',headers:{'Content-Type':'application/json','X-Piwork-Csrf':s.csrf},body:JSON.stringify(target)});if(!r.ok)throw Error('Entry failed');return r.json()},{workId:work.id,serviceId:accepted.serviceId,port:8080});entries.push({...entry,name});
  }
  const app=await context.newPage();await app.goto(entries[0].entryUrl);await expect(app.getByLabel('Todo title',{exact:true})).toBeVisible();await app.getByLabel('Todo title',{exact:true}).fill('Network persisted Todo');await app.getByRole('button',{name:'Add Todo',exact:true}).click();await expect(app.getByText('Network persisted Todo',{exact:true})).toBeVisible();await app.getByLabel('Todo title',{exact:true}).fill('keep original draft');
  const loaded=async p=>{await p.waitForFunction(()=>Boolean(window.piworkRuntime?.frontendVersion));return p.evaluate(()=>window.piworkRuntime)};
  const second=await context.newPage();await second.goto(entries[1].entryUrl);await second.getByLabel('Todo title',{exact:true}).fill('keep independent draft');
  await loaded(second);const secondOriginal=await second.evaluate(()=>{window.piworkFixtureMount='mount-'+Math.random();return{mount:window.piworkFixtureMount,version:window.piworkRuntime.frontendVersion}});
  let secondDocuments=0;second.on('request',r=>{if(r.isNavigationRequest()&&r.frame()===second.mainFrame())secondDocuments++});
  await app.bringToFront();
  await app.getByRole('link',{name:'Personal review',exact:true}).click();await expect(app.getByRole('heading',{name:'Personal review',exact:true})).toBeVisible();const deep=entries[0].basePath+'review';assert.equal(new URL(app.url()).pathname,deep);
  const before=await loaded(app);let adoptedDocuments=0;app.on('request',r=>{if(r.isNavigationRequest()&&r.frame()===app.mainFrame())adoptedDocuments++});
  const source=readFileSync(join(root,'internal/coreassets/piwork-brain/templates/web-app/ui.py'),'utf8').replace("TITLE = 'Personal workstation'","TITLE = 'Automatically adopted candidate'");
  await api(folder+'/update-one/ui.py','PUT',source,true);
  const restart=await api(`/api/v1/works/${work.id}/services/${entries[0].serviceId}/restart`,'POST',{idempotencyKey:'updated-source-once'});await operation(restart.operationId);
  await expect(app.getByRole('heading',{name:'Automatically adopted candidate',exact:true})).toBeVisible({timeout:120000});
  const after=await loaded(app);assert.notEqual(after.frontendVersion,before.frontendVersion);assert.notEqual(after.codeVersion,before.codeVersion);assert.equal(new URL(app.url()).pathname,deep);
  await app.getByRole('link',{name:'Todos',exact:true}).click();await expect(app.getByLabel('Todo title',{exact:true})).toHaveValue('keep original draft');
  await second.bringToFront();await second.waitForTimeout(2600);await expect(second.getByLabel('Todo title',{exact:true})).toHaveValue('keep independent draft');const unchanged=await second.evaluate(()=>({mount:window.piworkFixtureMount,version:window.piworkRuntime.frontendVersion}));assert.deepEqual(unchanged,secondOriginal);assert.equal(secondDocuments,0);assert(adoptedDocuments>=1);
  record.automaticUpdate={before:{codeVersion:before.codeVersion,frontendVersion:before.frontendVersion},after:{codeVersion:after.codeVersion,frontendVersion:after.frontendVersion},pathRetained:true,draftRetained:true,otherApplicationReloads:secondDocuments,otherApplicationIdentityPreserved:true,baseImageId:base.imageId,manualReloadCalls:0};
  step('Real prefixed Service automatically adopted changed code; deep path and draft survived; second app did not reload');await app.close();await second.close();return entries;
}

try{
  await docker(['run','-d','--name',registry,'--label',label,'--network','bridge','-p','127.0.0.1::5000','registry:2']);objects.push(registry);
  const hostPort=(await docker(['port',registry,'5000/tcp'])).split('\n')[0].split(':').at(-1),address='127.0.0.1:'+hostPort;
  const registryIP=await docker(['inspect','--format','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',registry]);
  await wait(async()=>{try{return(await fetch('http://'+address+'/v2/')).ok}catch{return false}},'local fixture registry');
  for(const ref of[metadata.images.agent,metadata.images.fileHelper,metadata.images.snapshotHelper,base.reference]){
    const local=address+'/'+ref.replace(/^docker\.io\//,'');await docker(['tag',ref,local]);localTags.push(local);await docker(['push',local]);
  }
  console.log('Candidate dependencies are available only in the local test registry; no external publication.');
  for(const mode of['run','compose'])await runMode(mode,'http://'+registryIP+':5000');
  const log=await command(['logs',registry],undefined,true);writeFileSync(join(out,'local-registry.log'),log.stdout+log.stderr,{mode:0o600});
  for(const mode of report.modes){for(const role of['agent','fileHelper','snapshotHelper'])assert(log.stdout+log.stderr&& (log.stdout+log.stderr).includes(metadata.images[role].replace(/^docker\.io\//,'').split(':')[0]+'/manifests/'));}
  report.success=true;
}catch(e){report.success=false;report.failure=clean(e.message);report.failureStack=clean(e.stack);console.error(report.failure);process.exitCode=1;}
finally{
  const registryLog=await command(['logs',registry],undefined,true);writeFileSync(join(out,'local-registry.log'),registryLog.stdout+registryLog.stderr,{mode:0o600});
  for(const name of [...objects].reverse())await command(['rm','-f','-v',name],undefined,true);
  for(const volume of [...volumes].reverse())await command(['volume','rm',volume],undefined,true);
  for(const tag of localTags)await command(['image','rm',tag],undefined,true);
  save('network-only-17891-result.json',report);
}

async function browserJSON(page,path,method='GET',body){
  return page.evaluate(async({path,method,body})=>{
    const admin=path.startsWith('/console/'),session=await(await fetch(admin?'/console/api/session':'/_web/api/session')).json();const response=await fetch(path,{method,headers:{'Content-Type':'application/json',...(admin?{'X-Csrf-Token':session.csrfToken}:{'X-Piwork-Csrf':session.csrf})},body:body===undefined?undefined:JSON.stringify(body)});
    const text=await response.text();const data=text?JSON.parse(text):{};if(!response.ok)throw Error('Browser '+method+' '+path+' '+response.status+' '+(data.code||''));return data;
  },{path,method,body});
}
async function browserOperation(page,id){return wait(async()=>{const value=await browserJSON(page,'/_desktop/api/operations/'+id);assert.notEqual(value.state,'failed','Browser Operation failed: '+value.error?.code);return value.state==='succeeded'},'browser Operation',600000)}
async function configurationAndFiles({page,work,record,step}){
  const agents=await browserJSON(page,`/_desktop/api/works/${work.id}/configuration/agents`);assert.equal(typeof agents.agentsMd,'string');
  const changed=agents.agentsMd+'\n<!-- isolated browser network acceptance -->\n';
  await browserJSON(page,`/_desktop/api/works/${work.id}/configuration/agents`,'PUT',{agentsMd:changed});
  const saved=await browserJSON(page,`/_desktop/api/works/${work.id}/configuration`);assert.equal(saved.desired.agentsMd,changed);assert(saved.pendingApply);
  const applied=await browserJSON(page,`/_desktop/api/works/${work.id}/configuration/apply`,'POST',{});await browserOperation(page,applied.operationId);
  await wait(async()=>(await browserJSON(page,`/_desktop/api/works/${work.id}`)).observedState==='ready','applied Work');
  const active=await browserJSON(page,`/_desktop/api/works/${work.id}/configuration`);assert.equal(active.active.agentsMd,changed);
  const files=await page.evaluate(async work=>{const session=await(await fetch('/_web/api/session')).json(),path=`/_desktop/files/works/${work}/files/network-sentinel.txt`,headers={'X-Piwork-Csrf':session.csrf,'If-None-Match':'*'};
    const first=await fetch(path,{method:'PUT',headers,body:'network-sentinel'}),conflict=await fetch(path,{method:'PUT',headers,body:'must-not-overwrite'}),read=await fetch(path);
    const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGP4/x8AAwAB//wl3FEAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
    const imagePath=`/_desktop/files/works/${work}/files/network-image.png`;const imageWrite=await fetch(imagePath,{method:'PUT',headers:{'X-Piwork-Csrf':session.csrf,'If-None-Match':'*','Content-Type':'image/png'},body:bytes});
    const imageRead=await fetch(imagePath);const bitmap=await createImageBitmap(await imageRead.blob());
    return{write:first.status,conflict:conflict.status,text:await read.text(),imageWrite:imageWrite.status,imageWidth:bitmap.width,imageHeight:bitmap.height};},work.id);
  assert.deepEqual(files,{write:201,conflict:412,text:'network-sentinel',imageWrite:201,imageWidth:1,imageHeight:1});record.files=files;
  const packages=await browserJSON(page,`/_desktop/api/works/${work.id}/packages`);assert(packages);record.configurationApplied=true;
  step('Restricted browser saved/applied Work configuration, uploaded/read an image and retained conditional file bytes');
}
function echoApplication(){return String.raw`
const http=require('node:http'),crypto=require('node:crypto');
for(const port of[8091,8092]){const server=http.createServer((req,res)=>{const prefix=req.headers['x-forwarded-prefix']||'';
if(req.url==='/health'){res.end('ok');return}
if(req.url==='/login'){res.writeHead(302,{'Set-Cookie':'same=port-'+port+'; Path=/; HttpOnly',Location:'/'});res.end();return}
if(req.url==='/logout'){res.setHeader('Set-Cookie','same=; Path=/; Max-Age=0');res.end('ok');return}
if(req.url==='/echo'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({cookie:req.headers.cookie||'',authorization:req.headers.authorization||'',prefix,gateway:req.headers['x-piwork-gateway-token']||''}));return}
if(req.url==='/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: first\n\n');const clock=setInterval(()=>res.write('data: tick\n\n'),250);req.on('close',()=>clearInterval(clock));return}
res.setHeader('Content-Type','text/html');res.end('<h1>Restricted Service '+port+'</h1><a href="'+prefix+'/login">Application login</a>');});
server.on('upgrade',(req,socket,head)=>{const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');const echo=b=>{if((b[0]&15)===8){socket.end(Buffer.from([136,0]));return}const n=b[1]&127;if(n>125)return;const key=b.subarray(2,6),data=Buffer.from(b.subarray(6,6+n));for(let i=0;i<data.length;i++)data[i]^=key[i%4];socket.write(Buffer.concat([Buffer.from([129,data.length]),data]));};if(head.length)echo(head);socket.on('data',echo);});server.listen(port,'0.0.0.0');}`;}
async function networkWorkflow({page,context,origin,work,api,operation,record,step,entries}){
  // Setup uses the existing Core API as an application/Agent fixture; every user operation below uses the browser adapters.
  const accepted=await api(`/api/v1/works/${work.id}/services`,'POST',{definition:{name:'stream-fixture',image:{reference:metadata.images.agent},command:'node',args:['-e',echoApplication()],workingDirectory:'/',ports:[{name:'web',protocol:'tcp',containerPort:8091},{name:'other',protocol:'tcp',containerPort:8092}],readiness:{kind:'http',portName:'web',path:'/health',deadlineMs:120000}},idempotencyKey:'create-stream-fixture'});await operation(accepted.operationId);
  await wait(async()=>(await browserJSON(page,`/_desktop/api/works/${work.id}/services/${accepted.serviceId}`)).observedState==='ready','stream Service ready');
  const links=[];for(const port of[8091,8092])links.push(await browserJSON(page,'/_desktop/api/service-entries','POST',{workId:work.id,serviceId:accepted.serviceId,port}));
  assert.equal(new URL(links[0].entryUrl).origin,origin);assert.notEqual(links[0].basePath,links[1].basePath);
  const apps=[];for(const link of links){const tab=await context.newPage();await tab.goto(link.entryUrl);await tab.getByRole('link',{name:'Application login',exact:true}).click();apps.push(tab)}
  for(let n=0;n<apps.length;n++){const value=await apps[n].evaluate(async path=>(await fetch(path+'echo',{headers:{Authorization:'Bearer fixture-app-token'}})).json(),links[n].basePath);assert.equal(value.cookie,'same=port-'+(8091+n));assert.equal(value.authorization,'Bearer fixture-app-token');assert.equal(value.gateway,'');assert.equal(value.prefix,links[n].basePath.slice(0,-1));}
  await apps[0].evaluate(async path=>{await fetch(path+'logout')},links[0].basePath);assert.equal((await apps[0].evaluate(async path=>(await fetch(path+'echo')).json(),links[0].basePath)).cookie,'');assert.equal((await apps[1].evaluate(async path=>(await fetch(path+'echo')).json(),links[1].basePath)).cookie,'same=port-8092');
  await page.evaluate(url=>{const frame=document.createElement('iframe');frame.id='network-preview';frame.src=url;document.body.append(frame)},entries[0].entryUrl);
  await expect(page.frameLocator('#network-preview').getByRole('heading',{name:'Automatically adopted candidate',exact:true})).toBeVisible();await page.locator('#network-preview').evaluate(n=>n.remove());
  await apps[1].evaluate(path=>{window.fixtureSSE='opening';const event=new EventSource(path+'events');event.onmessage=()=>window.fixtureSSE='active';event.onerror=()=>{window.fixtureSSE='closed';event.close()};window.fixtureWS='opening';const socket=new WebSocket(location.origin.replace(/^http/,'ws')+path+'socket');socket.onopen=()=>socket.send('echo');socket.onmessage=e=>window.fixtureWS=e.data==='echo'?'active':'bad';socket.onclose=()=>window.fixtureWS='closed';},links[1].basePath);
  await wait(()=>apps[1].evaluate(()=>window.fixtureSSE==='active'&&window.fixtureWS==='active'),'actual SSE/WebSocket');
  const revokedAt=Date.now();const stopped=await browserJSON(page,`/_desktop/api/works/${work.id}/services/${accepted.serviceId}/stop`,'POST',{});
  await wait(()=>apps[1].evaluate(()=>window.fixtureSSE==='closed'&&window.fixtureWS==='closed'),'stream revocation',2000);record.streamRevocationMs=Date.now()-revokedAt;await browserOperation(page,stopped.operationId);
  for(const tab of apps)await tab.close();step('Restricted browser used independent tabs/iframe, two declared ports, application Cookies/Authorization, SSE and duplex WebSocket with revocation');
  await accountIsolation({page,context,origin,workId:work.id,entry:entries[0],record,step});
  const sourcePath=`/_desktop/files/works/${work.id}/files/apps/update-one/ui.py`;
  const source=await page.evaluate(async path=>(await fetch(path)).text(),sourcePath);record.sourceSha256Before=createHash('sha256').update(source).digest('hex');
  const stop=await browserJSON(page,`/_desktop/api/works/${work.id}/stop`,'POST',{});await browserOperation(page,stop.operationId);
  const exported=await browserJSON(page,`/_desktop/api/works/${work.id}/exports`,'POST',{});await browserOperation(page,exported.operationId);
  const snapshot=await browserJSON(page,'/_desktop/api/work-snapshots/'+exported.snapshotId);assert.equal(snapshot.state,'succeeded');
  step('Restricted browser stopped Work and completed its package export');
  const download=await browserJSON(page,`/_desktop/api/work-snapshots/${exported.snapshotId}/downloads`,'POST',{});assert(download.ready);
  const downloadedBytes=await page.evaluate(async id=>{const response=await fetch('/_desktop/api/downloads/'+id+'/content');if(!response.ok)throw Error('Download failed '+response.status);window.fixturePackage=await response.blob();return window.fixturePackage.size},download.transferId);
  step('Restricted browser downloaded '+downloadedBytes+' package bytes over 17891');
  const transfer=await page.evaluate(async()=>{const session=await(await fetch('/_web/api/session')).json();const blob=window.fixturePackage;try{const inspect=await fetch('/_desktop/api/work-packages',{method:'POST',headers:{'Content-Type':'application/vnd.piwork.work-package','X-Piwork-Csrf':session.csrf},body:blob});const value=await inspect.json();if(!inspect.ok)throw Error('Inspect failed '+inspect.status+' '+value.code);return{...value,downloadedBytes:blob.size};}finally{delete window.fixturePackage}});
  assert.equal(transfer.downloadedBytes,snapshot.size);record.packageBytes=transfer.downloadedBytes;assert(transfer.summary);
  const imported=await browserJSON(page,'/_desktop/api/work-imports','POST',{transferId:transfer.transferId,name:'Imported restricted network Work'});await browserOperation(page,imported.operationId);
  const list=await browserJSON(page,'/_desktop/api/works');const restored=list.works.find(w=>w.name==='Imported restricted network Work');assert(restored&&restored.observedState==='stopped');record.importedWorkId=restored.id;
  const start=await browserJSON(page,`/_desktop/api/works/${restored.id}/start`,'POST',{});await browserOperation(page,start.operationId);await wait(async()=>(await browserJSON(page,`/_desktop/api/works/${restored.id}`)).observedState==='ready','imported Work ready');
  const services=(await browserJSON(page,`/_desktop/api/works/${restored.id}/services`)).services;const app=services.find(s=>s.name==='update-one');assert(app);assert.equal(app.definition.image.reference,base.reference);
  const entry=await browserJSON(page,'/_desktop/api/service-entries','POST',{workId:restored.id,serviceId:app.serviceId,port:8080});assert.notEqual(entry.basePath,entries[0].basePath);
  const importedPage=await context.newPage();await importedPage.goto(entry.entryUrl);await expect(importedPage.getByRole('heading',{name:'Automatically adopted candidate',exact:true})).toBeVisible();await expect(importedPage.getByText('Network persisted Todo',{exact:true})).toBeVisible();await importedPage.getByLabel('Todo title',{exact:true}).fill('After restricted network import');await importedPage.getByRole('button',{name:'Add Todo',exact:true}).click();await expect(importedPage.getByText('After restricted network import',{exact:true})).toBeVisible();
  const restoredSource=await page.evaluate(async path=>(await fetch(path)).text(),`/_desktop/files/works/${restored.id}/files/apps/update-one/ui.py`);assert.equal(restoredSource,source);const sentinel=await page.evaluate(async path=>(await fetch(path)).text(),`/_desktop/files/works/${restored.id}/files/network-sentinel.txt`);assert.equal(sentinel,'network-sentinel');
  step('Restricted browser completed Stop/Export/Download/Inspect/Import/Start and operated the new Service prefix with source, image and business data preserved');
  await importedPage.close();await browserJSON(page,'/_web/api/logout','POST',{});const state=await page.evaluate(async()=>(await fetch('/_web/api/session')).json());assert.equal(state.authenticated,false);
  record.browserPackageLifecycle=true;record.logoutConfirmed=true;step('Restricted browser confirmed normal logout after the complete package lifecycle');
}
async function accountIsolation({page,context,origin,workId,entry,record,step}){
  const otherUser=await browserJSON(page,'/console/api/admin/users','POST',{account:'network-other',password:'synthetic-network-other-password',role:'admin'});
  const otherContext=await context.browser().newContext();const otherPage=await otherContext.newPage();otherContext.on('request',request=>{const u=new URL(request.url());if(u.origin!==origin)record.blocked.push({origin:u.origin,path:u.pathname});record.browserRequests.push({method:request.method(),path:u.pathname})});
  await otherPage.goto(origin+'/login');await otherPage.getByLabel('Account',{exact:true}).fill('network-other');await otherPage.getByLabel('Password',{exact:true}).fill('synthetic-network-other-password');await otherPage.getByRole('button',{name:'Sign in',exact:true}).click();await otherPage.waitForURL(u=>u.pathname!=='/login');
  const denied=await otherPage.evaluate(async path=>(await fetch(path+'ui/queries/todos')).status,entry.basePath);assert.equal(denied,404);
  // Administrators may list/control other Works, while Service and private
  // conversation/file content remain owner-only under the existing policy.
  const metadataList=await browserJSON(otherPage,'/_desktop/api/works');assert(metadataList.works.some(w=>w.id===workId));
  const privateContent=await otherPage.evaluate(async work=>({sessions:(await fetch(`/_desktop/api/works/${work}/sessions`)).status,file:(await fetch(`/_desktop/files/works/${work}/files/network-sentinel.txt`)).status}),workId);
  assert.deepEqual(privateContent,{sessions:403,file:404});record.otherAdministratorAccess={service:denied,...privateContent,metadataVisible:true};
  await browserJSON(page,'/console/api/admin/users/'+otherUser.id+'/disable','POST',{});await wait(()=>otherPage.evaluate(async()=>(await(await fetch('/_web/api/session')).json()).authenticated===false),'second user revoked',2000);await otherContext.close();
  record.twoUserIsolation=true;step('Restricted browser enforced two-account ownership and revocation; administrator metadata access did not grant private content');
}
