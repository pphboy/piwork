// Scoped acceptance: local registry, empty Engines and the actual release candidate.
// Run from the repository: node openspec/changes/separate-control-plane-and-core/fixtures/cold-install.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium,expect} from '@playwright/test';

const root=resolve(import.meta.dirname,'../../../..');
const out=join(root,'dist/separate-control-plane/followup');mkdirSync(out,{recursive:true,mode:0o700});
const metadata=JSON.parse(readFileSync(join(out,'release-inputs/metadata.json')));
const base=JSON.parse(readFileSync(join(root,'dist/web-base/candidate.json')));
const model=parseEnv(readFileSync(join(root,'.env.test'),'utf8'));
const password='synthetic-cold-install-password';
const id='piwork-cold-'+randomUUID(),label='piwork.acceptance.fixture='+id;
const registry=id+'-registry',objects=[],volumes=[],localTags=[];
const report={releaseId:metadata.releaseId,sourceInputHash:metadata.sourceInputHash,webBaseImageId:base.imageId,modes:[],scope:'WARN 2 and 3; independent-client network WARN 1 is not covered'};
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
  let coreName,browser,context,installation;
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
    await docker(['run','-d','--privileged','--name',engine,'--label',label,'--network','bridge','-p','0.0.0.0::17891',
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
        metadata.images.core,'serve','--data-dir',data,'--no-open']);
    }else{
      const template=readFileSync(join(root,'deploy/docker/docker-compose.yml.template'),'utf8');
      const yaml=template.replace('name: piwork-quickstart','name: piwork-cold-compose').replace('@PIWORK_CORE_IMAGE@',metadata.images.core)
        .replaceAll('/var/lib/piwork/quickstart/core',data).replace('    init: true',`    command: ["serve", "--data-dir", "${data}", "--no-open"]\n    init: true`).replace('restart: unless-stopped','restart: "no"');
      const file=join(out,'compose-cold.yaml');writeFileSync(file,yaml);await docker(['cp',file,engine+':/data/compose.yaml']);
      await inside(['compose','-f','/data/compose.yaml','up','-d','--no-build','--pull','never']);coreName=await inside(['compose','-f','/data/compose.yaml','ps','-q','core']);
    }
    const image=JSON.parse(await inside(['inspect',coreName]))[0];assert.equal(image.Config.Env.some(x=>/^PIWORK_(ADMIN|MODEL)/.test(x)),false);
    record.businessEnv=false;record.coreImageId=image.Image;
    const published=await docker(['port',engine,'17891/tcp']);const port=published.split('\n')[0].split(':').at(-1);
    const serverIP=await docker(['inspect','--format','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',engine]);
    const origin='http://'+serverIP+':17891';record.origin=origin;record.network='fresh Engine bridge IP; host browser, WARN 1 unchanged';
    await wait(async()=>{try{return(await fetch(origin+'/healthz')).ok}catch{return false}},'ControlPlane');
    browser=await chromium.launch({executablePath:process.env.PIWORK_TEST_BROWSER||'/home/p/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',headless:true,args:['--no-proxy-server']});
    context=await browser.newContext();record.browser=browser.version();
    await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==origin){record.blocked.push({origin:u.origin,path:u.pathname});return route.abort()}record.browserRequests.push({method:route.request().method(),path:u.pathname});return route.continue()});
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
    if(mode==='run')await automaticUpdate({page,context,origin,work,api,operation,record,step});
    assert.equal(record.blocked.length,0);record.success=true;
    installation=JSON.parse(await inside(['exec',coreName,'cat',data+'/core-format.json'])).installationId;
    await inside(['stop','--time','60',coreName]);assert.equal(await inside(['ps','-q','--filter','label=piwork.installation_id='+installation]),'');record.gracefulStopConfirmed=true;
    const logs=await command(['logs',engine],undefined,true);writeFileSync(join(out,mode+'-engine.log'),clean(logs.stdout+logs.stderr),{mode:0o600});
  }finally{
    if(coreName){const log=await command(['exec',engine,'docker','logs',coreName],undefined,true);writeFileSync(join(out,mode+'-core.log'),clean(log.stdout+log.stderr),{mode:0o600});}
    const daemonLog=await command(['logs',engine],undefined,true);writeFileSync(join(out,mode+'-engine.log'),clean(daemonLog.stdout+daemonLog.stderr),{mode:0o600});
    await browser?.close();
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
  const app=await context.newPage();await app.goto(entries[0].entryUrl);await expect(app.getByLabel('Todo title',{exact:true})).toBeVisible();await app.getByLabel('Todo title',{exact:true}).fill('keep original draft');
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
  step('Real prefixed Service automatically adopted changed code; deep path and draft survived; second app did not reload');await app.close();await second.close();
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
  save('cold-install-result.json',report);
}
