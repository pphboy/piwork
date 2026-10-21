// Final production artifact acceptance. The model endpoint is synthetic; the
// SDK, MCP, Docker runtime, HTTP transports and browser are the shipped code.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer,request} from 'node:http';
import {mkdtemp,readFile,writeFile,copyFile,mkdir,rm} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {chromium,expect} from '@playwright/test';

export async function verifyNativeRelease(directory) {
 const bin=resolve(directory), manifest=JSON.parse(await readFile(join(dirname(bin),'release-manifest.json'),'utf8'));
 const name='piwork-release-'+randomUUID(), engine=name+'-engine', host=name+':scratch', network=name+'-network';
 const socket=name+'-socket', data=name+'-data', root=await mkdtemp(join(tmpdir(),name));
 const containers=[];let browser,gateway;let gatewayCalls=0;
 async function run(args,input,allowFailure=false) {
  const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.stdin.end(input);
  const code=await new Promise((done,reject)=>{child.on('error',reject);child.on('close',done);});
  if(code&&!allowFailure)throw new Error(`Docker ${args[0]} failed (${code})`);
  return {code,stdout:stdout.trim(),stderr};
 }
 const docker=async args=>(await run(args)).stdout;
 async function wait(check,label,timeout=180000){const end=Date.now()+timeout;while(Date.now()<end){try{const v=await check();if(v)return v;}catch{}await new Promise(r=>setTimeout(r,400));}throw new Error('Timeout: '+label);}
 async function launch(role,program,args,extra=[]) {
  const id=name+'-'+role;
  await docker(['run','-d','--name',id,'--label','piwork.acceptance.fixture='+name,'--network','container:'+engine,'--mount',`type=volume,src=${socket},dst=/var/run`,'--mount',`type=volume,src=${data},dst=/data`,'--tmpfs','/tmp:rw,nosuid,nodev','-e','PATH=/nonexistent',...extra,'--entrypoint','/bin/'+program,host,...args]);containers.push(id);return id;
 }
 try {
  await mkdir(join(root,'bin'));
  for(const program of ['piwork-core','piwork-cli'])await copyFile(join(bin,program),join(root,'bin',program));
  await writeFile(join(root,'Dockerfile'),'FROM scratch\nCOPY bin /bin\n');
  await docker(['build','--label','piwork.acceptance.fixture='+name,'-t',host,root]);
  for(const volume of [socket,data])await docker(['volume','create','--label','piwork.acceptance.fixture='+name,volume]);
  // Explicit private subnet avoids exhausting the host's automatic pool.
  // Docker still refuses overlap; never remove another installation's network.
  let networkCreated=false;
  for(let subnet=240;subnet<255&&!networkCreated;subnet++)networkCreated=!(await run(['network','create','--subnet',`10.${subnet}.231.0/24`,'--label','piwork.acceptance.fixture='+name,network],undefined,true)).code;
  assert(networkCreated,'No isolated acceptance subnet available');
  await docker(['run','-d','--privileged','--name',engine,'--label','piwork.acceptance.fixture='+name,'-e','DOCKER_TLS_CERTDIR=','--mount',`type=volume,src=${socket},dst=/var/run`,'--mount',`type=volume,src=${data},dst=/data`,'docker:28-dind','--host=unix:///var/run/docker.sock','--tls=false']);containers.push(engine);
  await docker(['network','connect',network,engine]);
  await wait(async()=>!(await run(['exec',engine,'docker','info'],undefined,true)).code,'isolated Engine');
  const engineVersion=await docker(['exec',engine,'docker','version','--format','{{.Server.Version}}']);assert(Number(engineVersion.split('.')[0])>=28);
  const info=JSON.parse(await docker(['inspect',engine]))[0].NetworkSettings.Networks;
  const ip=info.bridge.IPAddress, otherIP=info[network].IPAddress;
  const hostGateway=await docker(['network','inspect','bridge','--format','{{(index .IPAM.Config 0).Gateway}}']);
  const images=[...new Set(['agent','fileHelper','snapshotHelper'].map(role=>manifest.images[role].reference))];
  for(const role of ['agent','fileHelper','snapshotHelper'])assert.equal(await docker(['image','inspect','--format','{{.Id}}',manifest.images[role].reference]),manifest.images[role].imageId);
  const source=spawn('docker',['save',...images],{stdio:['ignore','pipe','inherit']});
  const target=spawn('docker',['exec','-i',engine,'docker','load'],{stdio:['pipe','ignore','inherit']});source.stdout.pipe(target.stdin);
  assert.deepEqual(await Promise.all([source,target].map(c=>new Promise(r=>c.on('close',r)))),[0,0]);
  const core=await launch('core','piwork-core',['--data-dir','/data/core']);
  let base=`http://${ip}:17871`, ui=`http://${ip}:17891`;
  await wait(async()=>(await fetch(base+'/healthz')).ok,'Core health');
  for(const hostIP of [ip,otherIP])assert.equal((await fetch(`http://${hostIP}:17891/login`)).status,200);
  assert.equal(await new Promise((done,reject)=>{const req=request(ui+'/login',{headers:{Host:'untrusted.invalid:17891'}},res=>{res.resume();done(res.statusCode);});req.on('error',reject);req.end();}),400);
  console.log('Final artifacts: isolated Engine, scratch Core and two IPv4 interfaces ready.');
  browser=await chromium.launch({headless:true,channel:'chromium'});
  const context=await browser.newContext(),page=await context.newPage();
  const browserOrigins=new Set();page.on('request',r=>{if(r.url().startsWith('http'))browserOrigins.add(new URL(r.url()).origin);});
  await page.goto(ui+'/');await expect(page.getByRole('heading',{name:'Create your administrator'})).toBeVisible();
  await page.getByLabel('Account',{exact:true}).fill('admin');await page.getByLabel('Password',{exact:true}).fill('release-synthetic-password');await page.getByLabel('Confirm password',{exact:true}).fill('release-synthetic-password');
  await page.getByRole('button',{name:'Create administrator',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Sign in to Piwork'})).toBeVisible();
  await page.getByLabel('Account',{exact:true}).fill('admin');await page.getByLabel('Password',{exact:true}).fill('release-synthetic-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/admin/setup');
  console.log('Final artifacts: browser created and signed in the administrator.');
  const login=await fetch(base+'/api/v1/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:'admin',password:'release-synthetic-password'})});assert.equal(login.status,200);const {token}=await login.json();
  const api=async(path,method='GET',body)=>{const r=await fetch(base+'/api/v1'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok){const failure=await r.json();throw new Error(`${method} ${path}: ${r.status} ${failure.code} ${failure.field||""}`);}return r.status===204?null:r.json();};
  const credential=(await docker(['exec',engine,'cat','/data/core/operator.credential'])).trim();
  const control=async path=>{const r=await fetch(base+'/control/'+path,{headers:{Authorization:'Operator '+credential}});assert.equal(r.status,200);return r.json();};
  assert((await control('status')).hasUsers);
  assert.equal((await fetch(base+'/api/v1/works',{headers:{Authorization:'Operator '+credential}})).status,401);
  assert.equal((await fetch(base+'/control/runtime',{headers:{Authorization:'Bearer '+token}})).status,401);
  const browserCookie=(await context.cookies()).map(c=>c.name+'='+c.value).join('; ');
  assert.equal((await fetch(`http://${otherIP}:17891/_web/api/onboarding`,{headers:{Cookie:browserCookie}})).status,401,'Browser session must remain bound to its original entry');
  await api('/admin/users','POST',{account:'reader',password:'release-reader-password'});
  const readerLogin=await fetch(base+'/api/v1/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:'reader',password:'release-reader-password'})});assert.equal(readerLogin.status,200);
  const readerAuth={Authorization:'Bearer '+(await readerLogin.json()).token};
  assert.equal((await fetch(base+'/api/v1/admin/users',{headers:readerAuth})).status,403);
  // Real production SDK over an ordinary configured HTTP model provider.
  gateway=createServer(async(req,res)=>{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());gatewayCalls++;
   const calls=(body.messages||[]).flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(p=>p.type==='tool_use').map(p=>p.name);
   const next=['deployment_context','service_create'].find(name=>!calls.some(call=>call.endsWith(name)));
   const tool=next&&(body.tools||[]).find(t=>t.name.endsWith(next));
   const serviceCode=String.raw`const http=require('http'),fs=require('fs'),crypto=require('crypto');const file='/var/data/workspace/release-counter';const server=http.createServer((q,r)=>{if(q.url.endsWith('/health'))return r.end('ok');if(q.url.endsWith('/events')){r.writeHead(200,{'Content-Type':'text/event-stream'});return r.end('data: release sse\n\n');}let count=Number(fs.existsSync(file)?fs.readFileSync(file,'utf8'):0)+1;fs.writeFileSync(file,String(count));r.writeHead(200,{'Content-Type':'application/json','Set-Cookie':'release_counter='+count+'; Path=/; HttpOnly; SameSite=Lax'});r.end(JSON.stringify({count,cookie:q.headers.cookie||''}));});server.on('upgrade',(q,s)=>{const accept=crypto.createHash('sha1').update(q.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');s.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');s.write(Buffer.concat([Buffer.from([129,10]),Buffer.from('release ws')]));s.on('data',()=>s.end());});server.listen(8080,'0.0.0.0');`;
   const input=next==='service_create'?{definition:{name:'release-counter',image:{reference:manifest.images.agent.reference},command:'node',args:['-e',serviceCode],environment:{},secretRefs:[],workingDirectory:'/var/data/workspace',mounts:[{source:'workspace',target:'/var/data/workspace',readOnly:false}],ports:[{name:'http',containerPort:8080,protocol:'tcp'}],cpuMillis:250,memoryBytes:134217728,enabled:true,required:false,readiness:{kind:'http',portName:'http',path:'/health',deadlineMs:60000,timeoutMs:2000},restartPolicy:'bounded'},idempotencyKey:'release-counter'}:{};
   const call=!!tool;res.writeHead(200,{'Content-Type':'text/event-stream'});
   const emit=(type,value={})=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
   emit('message_start',{message:{id:'release-message',type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});
   emit('content_block_start',{index:0,content_block:call?{type:'tool_use',id:'release-tool',name:tool.name,input:{}}:{type:'text',text:''}});
   emit('content_block_delta',{index:0,delta:call?{type:'input_json_delta',partial_json:JSON.stringify(input)}:{type:'text_delta',text:'release SDK verified'}});
   emit('content_block_stop',{index:0});emit('message_delta',{delta:{stop_reason:call?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:1}});emit('message_stop');res.end();
  });await new Promise(r=>gateway.listen(0,'0.0.0.0',r));
  const model=await api('/admin/models','POST',{model:'release-model',name:'Release SDK fixture',api:'anthropic-messages',baseUrl:`http://127.0.0.1:${gateway.address().port}`,credential:'synthetic-release-key'});
  await api('/admin/runtime','PUT',{modelRef:model.modelRef});
  assert.equal((await control('runtime')).agentImage,manifest.images.agent.reference);
  await wait(async()=>(await fetch(base+'/readyz?profile=docker-delivery')).ok,'production runtime');
  console.log('Final artifacts: production runtime prepared.');
  const cli=async(args,input)=>{const r=await run(['exec','-i','-e','PIWORK_CONFIG_PATH=/data/client/client.json',core,'/bin/piwork-cli','--core',base,'--json',...args],input);return JSON.parse(r.stdout);};
  await cli(['login','--account','admin','--password-stdin'],'release-synthetic-password\n');
  const created=await cli(['work','create','--name','Release Work','--wait']);assert.equal(created.state,'succeeded');const work=created.workId;
  assert.equal((await fetch(base+`/api/v1/works/${work}`,{headers:readerAuth})).status,404,'Another user cannot read this Work');
  const agent=await docker(['exec',engine,'docker','ps','-q','--filter','label=piwork.work_id='+work,'--filter','label=piwork.resource_kind=agent']);assert(agent);
  // A test-only loopback relay exposes the synthetic provider to the unchanged
  // Agent namespace. It does not alter the production image or TLS policy.
  const relay=await docker(['exec',engine,'docker','run','-d','--network','container:'+agent,'--label','piwork.acceptance.fixture='+name,'--entrypoint','node',manifest.images.agent.reference,'-e',`const net=require('net');net.createServer(c=>{const u=net.connect(${gateway.address().port},${JSON.stringify(hostGateway)});c.pipe(u).pipe(c);c.on('error',()=>u.destroy());u.on('error',()=>c.destroy());}).listen(${gateway.address().port},'127.0.0.1');`]);
  await wait(async()=>(await docker(['exec',engine,'docker','inspect','--format','{{.State.Running}}',relay]))==='true','model relay');
  const session=await cli(['session','create',work]);
  const chat=await run(['exec','-e','PIWORK_CONFIG_PATH=/data/client/client.json',core,'/bin/piwork-cli','--core',base,'--json','chat',work,'--session',session.sessionId,'--message','Verify release deployment context']);
  assert(chat.stdout.includes('release SDK verified'));
  assert(gatewayCalls>=3,'real SDK and MCP deployment loop missing');
  const service=await wait(async()=>{const list=await api(`/works/${work}/services`);return list.services.find(s=>s.name==='release-counter'&&s.observedState==='ready');},'SDK deployed Service');
  const servicePath=`/services/${work}/${service.serviceId}/8080/`;
  const first=await page.evaluate(async path=>{const r=await fetch(path);return {status:r.status,body:await r.json()};},servicePath);assert.equal(first.status,200);assert(first.body.count>0);
  const second=await page.evaluate(async path=>(await fetch(path)).json(),servicePath);
  assert(second.cookie.includes('release_counter='+first.body.count),'Service response Cookie must round-trip through the server-side jar');
  assert(!(await context.cookies()).some(cookie=>cookie.name==='release_counter'));
  assert((await page.evaluate(async path=>(await fetch(path+'events')).text(),servicePath)).includes('release sse'));
  const ws=await page.evaluate(path=>new Promise((done,reject)=>{const socket=new WebSocket(location.origin.replace('http:','ws:')+path);socket.onmessage=e=>{done(e.data);socket.close();};socket.onerror=()=>reject(new Error('WebSocket failed'));}),servicePath);assert.equal(ws,'release ws');
  console.log('Final artifacts: SDK deployed Service; browser prefix, Cookie, SSE and WebSocket passed.');
  const file=await fetch(base+`/api/v1/works/${work}/files/release.txt`,{method:'PUT',headers:{Authorization:'Bearer '+token},body:'release durable bytes'});assert([201,204].includes(file.status));
  const desktop=await launch('desktop','piwork-cli',['--core',base,'desktop','--port','7174','--no-open'],['-e','PIWORK_CONFIG_PATH=/data/client/client.json']);
  await wait(async()=>(await docker(['logs',desktop])).includes('Piwork Desktop:'),'native Desktop');
  await docker(['stop','--time','10',desktop]);assert((await fetch(base+'/healthz')).ok);
  assert.deepEqual([...browserOrigins],[ui],'Browser must connect only to UI');
  await browser.close();browser=null;assert((await fetch(base+'/healthz')).ok);
  await docker(['exec',engine,'docker','rm','-f',relay]);
  await cli(['work','stop',work,'--wait']);
  const exported=await cli(['work','export',work,'--output','/data/client/release.work']);assert(exported.snapshotId);
  assert((await cli(['work','package','inspect','/data/client/release.work'])).integrityVerified);
  const imported=await cli(['work','import','/data/client/release.work','--name','Release restored','--wait']);assert.equal(imported.state,'succeeded');
  await cli(['work','start',imported.workId,'--wait']);
  const copied=await fetch(base+`/api/v1/works/${imported.workId}/files/release.txt`,{headers:{Authorization:'Bearer '+token}});assert.equal(await copied.text(),'release durable bytes');
  await cli(['work','start',work,'--wait']);
  const before=(await api(`/works/${work}/sessions/${session.sessionId}`)).runs;
  const foreign=await docker(['exec',engine,'docker','run','-d','--label','piwork.managed=true','--label','piwork.installation_id=fixture-other-installation','--entrypoint','node',manifest.images.agent.reference,'-e','setInterval(()=>{},1000)']);
  await docker(['stop','--time','60',core]);
  assert.equal(await docker(['inspect','--format','{{.State.ExitCode}}',core]),'0');
  assert.equal(await docker(['exec',engine,'docker','ps','-q']),foreign.slice(0,12));
  await docker(['exec',engine,'docker','rm','-f',foreign]);
  assert.equal((await docker(['exec',engine,'cat','/data/core/operator.credential'])).trim(),credential);
  await docker(['start',core]);await wait(async()=>(await fetch(base+'/healthz')).ok,'Core restart');
  assert.equal((await cli(['whoami'])).account,'admin');
  await wait(async()=>(await api(`/works/${work}`)).observedState==='ready','Work recovery');
  assert.deepEqual((await api(`/works/${work}/sessions/${session.sessionId}`)).runs,before);
  const restored=await fetch(base+`/api/v1/works/${work}/files/release.txt`,{headers:{Authorization:'Bearer '+token}});assert.equal(await restored.text(),'release durable bytes');
  await docker(['stop','--time','60',core]);
  const custom=await launch('custom','piwork-core',['--data-dir','/data/core','--ui-port','18891','--core-port','18871']);
  await wait(async()=>(await fetch(`http://${ip}:18891/healthz`)).ok,'custom UI port');
  assert((await fetch(`http://${otherIP}:18871/healthz`)).ok);
  await docker(['stop','--time','60',custom]);
  console.log(JSON.stringify({result:'PASS',release:manifest.releaseId,engine:engineVersion,host:'scratch, two unchanged production binaries',model:'synthetic HTTP responses; actual production SDK and MCP',checks:['browser bootstrap/login','two real IPv4 interfaces','operator/admin/user separation and cross-origin session rejection','native CLI/Desktop','SDK MCP','Service prefix, server-side Cookie, SSE and WebSocket','Files','Snapshot export/import','Core shutdown/restart','other installation untouched','custom HTTP ports','operator credentials and history preserved']}));
 }finally{
  await browser?.close();await new Promise(r=>gateway?gateway.close(r):r());
  for(const id of containers.reverse())await run(['rm','-fv',id],undefined,true);
  for(const id of [socket,data])await run(['volume','rm',id],undefined,true);
  await run(['network','rm',network],undefined,true);await run(['image','rm',host],undefined,true);await rm(root,{recursive:true,force:true});
 }
}
