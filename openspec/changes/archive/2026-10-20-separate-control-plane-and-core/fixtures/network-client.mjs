// Firewall changes apply only inside the named fixture namespace, never the host.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';

export async function restrictedBrowser({docker,command,id,label,mode,serverIP,root,record,objects}){
  const net=id+'-'+mode+'-client-net',client=id+'-'+mode+'-browser';
  const remove=async name=>{await command(['rm','-f','-v',name],undefined,true);const index=objects.indexOf(name);if(index>=0)objects.splice(index,1)};
  let browser;
  try{
    await docker(['run','-d','--name',net,'--label',label,'--network','bridge','--cap-drop','ALL','--cap-add','NET_ADMIN','--entrypoint','/bin/sh','docker:28-dind','-c','sleep 36000']);objects.push(net);
    const rules=`*filter\n:INPUT ACCEPT [0:0]\n:FORWARD DROP [0:0]\n:OUTPUT DROP [0:0]\n-A OUTPUT -o lo -j ACCEPT\n-A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT\n-A OUTPUT -d ${serverIP}/32 -p tcp --dport 17891 -j ACCEPT\n-A OUTPUT -j REJECT --reject-with icmp-admin-prohibited\nCOMMIT\n`;
    await command(['exec','-i',net,'iptables-restore'],rules);
    await command(['exec','-i',net,'ip6tables-restore'],'*filter\n:INPUT ACCEPT [0:0]\n:FORWARD DROP [0:0]\n:OUTPUT DROP [0:0]\n-A OUTPUT -o lo -j ACCEPT\n-A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT\n-A OUTPUT -j REJECT --reject-with icmp6-adm-prohibited\nCOMMIT\n');
    const source=`const {chromium}=require('/source/node_modules/playwright');(async()=>{const server=await chromium.launchServer({host:'0.0.0.0',port:39999,headless:true,executablePath:'/ms-playwright/chromium-1212/chrome-linux64/chrome',args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server']});console.log(server.wsEndpoint());process.on('SIGTERM',async()=>{await server.close();process.exit(0)});})().catch(e=>{console.error(e.stack);process.exit(1)});`;
    await docker(['run','-d','--name',client,'--label',label,'--network','container:'+net,'--cap-drop','ALL','--security-opt','no-new-privileges','--shm-size','1g','--mount',`type=bind,src=${root},dst=/source,readonly`,'--entrypoint','node','piwork-browser:unified-fixture','-e',source]);objects.push(client);
    const clientIP=await docker(['inspect','--format','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',net]);
    let endpoint;
    for(let n=0;n<100&&!endpoint;n++){const logs=await command(['logs',client],undefined,true);endpoint=(logs.stdout.match(/ws:\/\/[^\s]+/)||[])[0];if(!endpoint)await new Promise(r=>setTimeout(r,100))}
    assert(endpoint,'Browser fixture did not start');const url=new URL(endpoint);url.hostname=clientIP;
    browser=await chromium.connect(url.toString());
    const namespace=await docker(['exec',net,'readlink','/proc/self/ns/net']);
    record.clientNetwork={ip:clientIP,namespace,allowedDestination:serverIP+':17891',policy:'new remote TCP connections only to ControlPlane; IPv4 and IPv6 OUTPUT default DROP',browserControl:'inbound Playwright fixture channel, no product data proxy',probes:[]};
    async function prove(targets=[]){
      const pairs=[{host:serverIP,port:17891,allowed:true},...([17871,7171,7172,17892,17954].map(port=>({host:serverIP,port,allowed:false}))),...targets.map(host=>({host,port:8080,allowed:false}))];
      const program=`const net=require('node:net');const pairs=JSON.parse(process.argv[1]);(async()=>{const out=[];for(const p of pairs){const connected=await new Promise(resolve=>{const s=net.connect(p.port,p.host);s.setTimeout(1500);let done=false;const finish=value=>{if(done)return;done=true;s.destroy();resolve(value)};s.on('connect',()=>finish(true));s.on('error',()=>finish(false));s.on('timeout',()=>finish(false));});out.push({...p,connected});}console.log(JSON.stringify(out));})();`;
      const actual=JSON.parse(await docker(['exec',client,'node','-e',program,JSON.stringify(pairs)]));
      for(const probe of actual)assert.equal(probe.connected,probe.allowed,'Unexpected network access: '+probe.host+':'+probe.port);
      record.clientNetwork.probes.push(...actual);record.clientNetwork.ipv4Rules=await docker(['exec',net,'iptables-save','-c']);record.clientNetwork.ipv6Rules=await docker(['exec',net,'ip6tables-save','-c']);return actual;
    }
    await prove();
    return{browser,prove,namespace,close:async()=>{await browser.close();await remove(client);await remove(net)}};
  }catch(e){await browser?.close();await remove(client);await remove(net);throw e}
}
