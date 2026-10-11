import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent';
import { WorkStore } from '@piwork/work-store';
import { CHAT_IMAGE_PROFILE,chatInputDigest,type ChatImageInput,type RunModelSnapshot } from '@piwork/contracts';
import { AgentSessionService } from './sessions.js';
import { PiSdkRunExecutor } from './pi-sdk-executor.js';

for(const action of ['handled','drop','replace','provider-drop'] as const)test(`image execution refuses an extension that would ${action} the accepted image`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'piwork-image-executor-')),workspace=join(root,'workspace'),agent=join(root,'agent');mkdirSync(workspace);mkdirSync(agent);const store=WorkStore.open(join(root,'work.sqlite'));
 let requests=0;const server=createServer((_request,response)=>{requests++;response.writeHead(500);response.end();});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
 try {
  const sessions=new AgentSessionService('w',store,workspace,join(root,'sessions'),'context'),session=sessions.create();const image:ChatImageInput={mimeType:'image/png',data:readFileSync(new URL('../../../fixtures/chat-images/png.png',import.meta.url)).toString('base64')},replacement=readFileSync(new URL('../../../fixtures/chat-images/jpeg.jpg',import.meta.url)).toString('base64');
  const model:RunModelSnapshot={modelRef:null,label:'Vision',provider:'openai',model:'gpt-5.1',api:'openai-responses',baseUrl:`http://127.0.0.1:${address.port}/v1`,thinkingLevel:'off'};
  const run=store.acceptRun({workId:'w',sessionId:session.sessionId,submissionKey:action,requestDigest:action,promptDigest:chatInputDigest('',[image]),privateInputJson:JSON.stringify({profile:CHAT_IMAGE_PROFILE,prompt:'',images:[image]}),contextIdentity:'context',memoryEnabled:false}).run;
  const executor=new PiSdkRunExecutor(sessions,agent,{provider:'openai',id:'gpt-5.1',api:'openai-responses',baseUrl:model.baseUrl,deterministic:false},{models:{async list(){throw new Error('unused');},async resolve(){return model;},async credential(){return 'synthetic-image-key';}},resolvedTools:[],resourceLoaderFactory:async()=>{
   const loader=new DefaultResourceLoader({cwd:workspace,agentDir:agent,noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,extensionFactories:[pi=>{
    if(action==='provider-drop')pi.on('before_provider_request',event=>{const payload=event.payload as any;return {...payload,input:payload.input.map((message:any)=>({...message,content:Array.isArray(message.content)?message.content.filter((part:any)=>part.type!=='input_image'):message.content}))};});
    else pi.on('input',()=>action==='handled'?{action:'handled' as const}:{action:'transform' as const,text:'',images:action==='drop'?[]:[{type:'image' as const,mimeType:'image/jpeg',data:replacement}]});
   }]});await loader.reload();return loader;
  }});
  await assert.rejects(executor.execute({workId:'w',sessionId:session.sessionId,runId:run.runId,prompt:'',images:[image],inputMode:'text',actualModel:model,contextIdentity:'context',signal:new AbortController().signal,emit(){}}));
  assert.equal(requests,0);assert.deepEqual(sessions.image(session.sessionId,run.runId,0),image);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();rmSync(root,{recursive:true,force:true});}
});
